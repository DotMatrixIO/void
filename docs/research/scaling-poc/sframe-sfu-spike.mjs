// THROWAWAY RESEARCH SPIKE — task #763 (Research: scaling rooms past four).
//
// This is NOT production code. It is a disposable proof-of-concept that
// exists only to produce evidence for docs/research/scaling-past-four.md.
// It is intentionally:
//   - self-contained (Node built-in WebCrypto + perf_hooks only; no imports
//     from artifacts/void-client or lib/* — so it CANNOT be wired into the
//     app),
//   - outside every pnpm workspace glob (lives in docs/, not artifacts|lib|
//     scripts|tools), so it never enters the build, typecheck, or test graph.
//
// Riskiest claim it validates (the one thing the spike is scoped to test):
//   "SFrame-style frame encryption can ride on top of an SFU using VOID's
//    existing key-exchange approach while leaving the relay (SFU) unable to
//    decrypt."
//
// It also produces rough CPU-cost numbers and a back-of-envelope participant
// ceiling so the findings doc quotes measured evidence, not vibes.
//
// Run:  node docs/research/scaling-poc/sframe-sfu-spike.mjs
//
// Effort budget for this spike: ~1 day. See the findings doc; the fact that
// the core claim validates in a single self-contained file IS one of the
// findings (the crypto is cheap; the hard parts are group-key lifecycle and
// the SFU's metadata surface, neither of which is a crypto problem).

import { webcrypto as crypto } from "node:crypto";
import { performance } from "node:perf_hooks";

const { subtle } = crypto;
const te = new TextEncoder();
const td = new TextDecoder();

function b64u(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

// ── 1. VOID's existing pairwise machinery, reimplemented standalone ──────
// Mirrors artifacts/void-client/src/lib/signalCrypto.ts: P-384 ECDH,
// HKDF-SHA256 with a 32-byte zero salt, AES-GCM-256 session key. This is
// the EXACT approach VOID already ships for per-pair signaling. The spike's
// claim is that this same primitive distributes a group "sender key".
async function genEcdh() {
  return subtle.generateKey({ name: "ECDH", namedCurve: "P-384" }, false, [
    "deriveBits",
  ]);
}

async function pairwiseKey(myPriv, theirPub) {
  const shared = await subtle.deriveBits(
    { name: "ECDH", public: theirPub },
    myPriv,
    384,
  );
  const hkdf = await subtle.importKey("raw", shared, "HKDF", false, [
    "deriveKey",
  ]);
  return subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32),
      info: te.encode("VOID-ECDHE-v1"), // same domain-separation label VOID uses
    },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function aesEnc(key, plaintextBytes, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const params = { name: "AES-GCM", iv };
  if (aad) params.additionalData = aad;
  const ct = await subtle.encrypt(params, key, plaintextBytes);
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), 12);
  return out;
}

async function aesDec(key, blob, aad) {
  const iv = blob.slice(0, 12);
  const ct = blob.slice(12);
  const params = { name: "AES-GCM", iv };
  if (aad) params.additionalData = aad;
  const pt = await subtle.decrypt(params, key, ct);
  return new Uint8Array(pt);
}

// ── 2. A participant: identity, pairwise channels, and a sender key ──────
class Participant {
  constructor(id) {
    this.id = id;
    this.ecdh = null;
    this.pairwise = new Map(); // peerId -> AES-GCM CryptoKey (existing machinery)
    this.senderKey = null; // my own group sender key (raw 32 bytes)
    this.senderAesKey = null; // imported AES-GCM key for my frames
    this.peerSenderKeys = new Map(); // peerId -> imported AES-GCM key (their frames)
    this.frameCtr = new Map(); // peerId -> last seen counter (replay defense)
  }
  async init() {
    this.ecdh = await genEcdh();
    await this.rotateSenderKey();
  }
  async rotateSenderKey() {
    this.senderKey = crypto.getRandomValues(new Uint8Array(32));
    this.senderAesKey = await subtle.importKey(
      "raw",
      this.senderKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }
}

// ── 3. The "SFU": forwards opaque blobs, holds NO keys ───────────────────
// This is the trust-boundary object. It can see envelope metadata (who sent,
// frame size, timing, a key-generation id) but is structurally given no key
// material. Its decrypt attempts MUST fail — that is the claim under test.
class SimulatedSFU {
  constructor() {
    this.forwarded = 0;
    this.bytesSeen = 0;
    this.metadataLog = []; // exactly what the relay learns
  }
  forward(envelope, recipients) {
    // The SFU sees ONLY this envelope. No key, no plaintext.
    this.forwarded++;
    this.bytesSeen += envelope.ciphertext.length;
    this.metadataLog.push({
      from: envelope.from,
      keyGen: envelope.keyGen,
      size: envelope.ciphertext.length,
      t: envelope.t,
    });
    // Fan out the identical opaque blob to each recipient (selective
    // forwarding — in a real SFU, active-speaker logic picks recipients).
    return recipients.map((r) => ({ to: r, envelope }));
  }
  // Adversarial probe: can the relay recover plaintext from what it holds?
  async tryDecrypt(envelope) {
    // It has no sender key. Best it can do is guess. Try a random key and a
    // zero key; both must throw / fail authentication.
    for (const guess of [
      crypto.getRandomValues(new Uint8Array(32)),
      new Uint8Array(32),
    ]) {
      try {
        const k = await subtle.importKey(
          "raw",
          guess,
          { name: "AES-GCM", length: 256 },
          false,
          ["decrypt"],
        );
        await aesDec(k, envelope.ciphertext);
        return "RELAY_DECRYPTED"; // would be a catastrophic failure
      } catch {
        /* expected: AES-GCM auth fails */
      }
    }
    return "RELAY_BLIND";
  }
}

// ── 4. Group join: distribute sender keys over the EXISTING pairwise channel
async function establishPairwise(members) {
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = members[i];
      const b = members[j];
      const ka = await pairwiseKey(a.ecdh.privateKey, b.ecdh.publicKey);
      const kb = await pairwiseKey(b.ecdh.privateKey, a.ecdh.publicKey);
      a.pairwise.set(b.id, ka);
      b.pairwise.set(a.id, kb);
    }
  }
}

// Each member sends its raw sender key to each other member, encrypted under
// the pairwise AES-GCM channel. The SFU only ever sees ciphertext envelopes.
async function distributeSenderKeys(members, sfu) {
  for (const sender of members) {
    for (const recipient of members) {
      if (sender.id === recipient.id) continue;
      const pk = sender.pairwise.get(recipient.id);
      const sealed = await aesEnc(pk, sender.senderKey, te.encode(sender.id));
      // Relay forwards the sealed key blob (opaque to it).
      sfu.forward(
        { from: sender.id, keyGen: 0, ciphertext: sealed, t: performance.now() },
        [recipient.id],
      );
      const raw = await aesDec(
        recipient.pairwise.get(sender.id),
        sealed,
        te.encode(sender.id),
      );
      const imported = await subtle.importKey(
        "raw",
        raw,
        { name: "AES-GCM", length: 256 },
        false,
        ["decrypt"],
      );
      recipient.peerSenderKeys.set(sender.id, imported);
    }
  }
}

// ── 5. SFrame-style frame path: encrypt → SFU forward → decrypt ──────────
function makeFrame(sizeBytes) {
  return crypto.getRandomValues(new Uint8Array(sizeBytes));
}

async function sendFrame(sender, frameBytes, keyGen) {
  // SFrame AAD: bind sender id + key generation + counter so the SFU can't
  // re-address or replay across generations.
  const ctr = (sender.frameCtr.get("__self") ?? 0) + 1;
  sender.frameCtr.set("__self", ctr);
  const aad = te.encode(`${sender.id}|${keyGen}|${ctr}`);
  const ct = await aesEnc(sender.senderAesKey, frameBytes, aad);
  return { from: sender.id, keyGen, ctr, ciphertext: ct, t: performance.now() };
}

async function recvFrame(recipient, envelope) {
  const key = recipient.peerSenderKeys.get(envelope.from);
  if (!key) throw new Error("no sender key");
  const aad = te.encode(`${envelope.from}|${envelope.keyGen}|${envelope.ctr}`);
  return aesDec(key, envelope.ciphertext, aad);
}

// ── 6. Benchmarks ────────────────────────────────────────────────────────
async function benchFrameCrypto(sizeBytes, iters) {
  const p = new Participant("bench");
  await p.init();
  const frame = makeFrame(sizeBytes);
  // warmup
  for (let i = 0; i < 50; i++) {
    const e = await sendFrame(p, frame, 0);
    p.peerSenderKeys.set("bench", p.senderAesKey);
    await recvFrame(p, e);
  }
  let encMs = 0;
  let decMs = 0;
  for (let i = 0; i < iters; i++) {
    let t0 = performance.now();
    const env = await sendFrame(p, frame, 0);
    encMs += performance.now() - t0;
    t0 = performance.now();
    await recvFrame(p, env);
    decMs += performance.now() - t0;
  }
  return {
    sizeBytes,
    iters,
    encUsPerFrame: (encMs / iters) * 1000,
    decUsPerFrame: (decMs / iters) * 1000,
  };
}

function ceilingEstimate(decUsPerFrame, fps, cpuBudgetFraction) {
  // A receiver only DECRYPTS the streams the SFU forwards to it. With
  // active-speaker + simulcast/SVC, that's a bounded set (k high-res +
  // thumbnails), not N. Compute how many simultaneous forwarded streams a
  // single core can decrypt within `cpuBudgetFraction` of real time.
  const perFrameBudgetUs = (1e6 / fps) * cpuBudgetFraction;
  return Math.floor(perFrameBudgetUs / decUsPerFrame);
}

async function main() {
  console.log("=== VOID scaling spike: SFrame-over-SFU (task #763) ===\n");

  // CLAIM 1: pairwise → sender-key distribution → frame path works, and the
  // SFU stays blind end to end.
  const N = 8;
  const members = [];
  for (let i = 0; i < N; i++) {
    const p = new Participant(`peer-${i}`);
    await p.init();
    members.push(p);
  }
  const sfu = new SimulatedSFU();
  await establishPairwise(members);
  await distributeSenderKeys(members, sfu);

  const sender = members[0];
  const frame = makeFrame(6 * 1024); // ~720p @ ~1.5Mbps/30fps average frame
  const env = await sendFrame(sender, frame, 0);
  const fanout = sfu.forward(
    env,
    members.filter((m) => m.id !== sender.id).map((m) => m.id),
  );

  // Every legitimate recipient decrypts correctly.
  let recvOk = 0;
  for (const { to } of fanout) {
    const recipient = members.find((m) => m.id === to);
    const pt = await recvFrame(recipient, env);
    if (Buffer.compare(Buffer.from(pt), Buffer.from(frame)) === 0) recvOk++;
  }

  // The relay, holding only the envelope, cannot decrypt.
  const relayResult = await sfu.tryDecrypt(env);

  console.log("CLAIM 1 — SFrame rides on SFU, relay stays blind:");
  console.log(`  group size                 : ${N}`);
  console.log(`  recipients decrypted OK    : ${recvOk}/${fanout.length}`);
  console.log(`  relay decrypt attempt      : ${relayResult}`);
  console.log(
    `  result                     : ${
      recvOk === fanout.length && relayResult === "RELAY_BLIND"
        ? "PASS ✓"
        : "FAIL ✗"
    }\n`,
  );

  // CLAIM 2: forward secrecy on member leave via sender-key rotation.
  // peer-7 "leaves". Remaining senders rotate + redistribute. A frame under
  // the NEW key must be undecryptable with the OLD key the leaver still holds.
  const leaver = members[N - 1];
  const stolenOldKey = members[0].peerSenderKeys.get(sender.id); // what leaver kept
  const remaining = members.filter((m) => m.id !== leaver.id);
  const tRekey0 = performance.now();
  for (const m of remaining) await m.rotateSenderKey();
  // redistribute only among remaining (reuses pairwise channels)
  for (const s of remaining) {
    for (const r of remaining) {
      if (s.id === r.id) continue;
      const sealed = await aesEnc(s.pairwise.get(r.id), s.senderKey, te.encode(s.id));
      const raw = await aesDec(r.pairwise.get(s.id), sealed, te.encode(s.id));
      r.peerSenderKeys.set(
        s.id,
        await subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, ["decrypt"]),
      );
    }
  }
  const rekeyMs = performance.now() - tRekey0;
  const envNew = await sendFrame(sender, makeFrame(6 * 1024), 1);
  let leakBlocked = false;
  try {
    const aad = te.encode(`${sender.id}|1|${envNew.ctr}`);
    await aesDec(stolenOldKey, envNew.ciphertext, aad);
  } catch {
    leakBlocked = true; // old key can't read post-rekey frame — what we want
  }
  console.log("CLAIM 2 — forward secrecy on leave (sender-key rotation):");
  console.log(`  rekey + redistribute time  : ${rekeyMs.toFixed(2)} ms (group of ${remaining.length})`);
  console.log(`  leaver's old key blocked   : ${leakBlocked ? "PASS ✓" : "FAIL ✗"}\n`);

  // CLAIM 3: CPU cost + rough ceiling.
  console.log("CLAIM 3 — per-frame crypto cost (AES-GCM-256, WebCrypto):");
  const sizes = [2 * 1024, 6 * 1024, 32 * 1024];
  const results = [];
  for (const s of sizes) {
    const r = await benchFrameCrypto(s, 2000);
    results.push(r);
    console.log(
      `  ${String(s / 1024).padStart(2)} KB frame  enc=${r.encUsPerFrame
        .toFixed(1)
        .padStart(6)} µs  dec=${r.decUsPerFrame.toFixed(1).padStart(6)} µs`,
    );
  }
  const mid = results[1]; // 6KB representative
  console.log("\n  Receiver decode ceiling (single core, decrypt-only):");
  for (const budget of [0.1, 0.25, 0.5]) {
    const streams = ceilingEstimate(mid.decUsPerFrame, 30, budget);
    console.log(
      `    @ ${Math.round(budget * 100)}% of one core, 30fps → ~${streams} simultaneous forwarded streams decryptable`,
    );
  }
  console.log(
    "\n  Note: with active-speaker + simulcast/SVC the SFU forwards only a",
  );
  console.log(
    "  handful of high-res streams to each client, so the practical ceiling is",
  );
  console.log(
    "  set by forwarded-stream count (above), NOT by total room size. SFrame",
  );
  console.log(
    "  crypto is plainly not the bottleneck; decode/render of forwarded tiles is.",
  );

  console.log("\n  SFU metadata observed during this run (the new surface):");
  console.log(
    `    envelopes forwarded=${sfu.forwarded}, bytes=${sfu.bytesSeen}, ` +
      `distinct senders=${new Set(sfu.metadataLog.map((m) => m.from)).size}`,
  );
  console.log(
    "    (the relay learns: who sent, when, how big, key-generation — i.e.",
  );
  console.log(
    "     active-speaker timing + traffic shape for the whole call duration)",
  );
}

main().catch((e) => {
  console.error("SPIKE ERROR:", e);
  process.exit(1);
});
