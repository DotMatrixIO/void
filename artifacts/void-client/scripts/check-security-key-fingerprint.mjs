#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * check-security-key-fingerprint.mjs
 *
 * Fails (exit 1) if the committed PGP public key file disagrees with the
 * security contact details published in SECURITY.md.
 *
 * Why this exists. SECURITY.md tells researchers to encrypt vulnerability
 * reports to a specific PGP key, and pins that key two ways: a human-readable
 * V4 fingerprint string, and a committed armored public-key file
 * (`security-contact.asc`). If the key file is ever rotated/replaced but the
 * fingerprint text is not (or vice versa), researchers would verify against a
 * fingerprint that no longer matches the key — or encrypt to a key the
 * maintainer cannot read. Either way reports get lost or leak. Nothing forced
 * these two to stay in sync, so this guard does — the same net the other
 * doc/asset drift guards (check-doc-code-drift.mjs, check-signaling-envelope.mjs)
 * cast over security-relevant prose.
 *
 * What it asserts:
 *   1. `security-contact.asc` parses as an OpenPGP public key, and its
 *      computed V4 fingerprint (RFC 4880 §12.2: SHA-1 over 0x99 ‖ 2-octet
 *      length ‖ the public-key packet body) equals the fingerprint string
 *      published in SECURITY.md, compared digit-for-digit ignoring spacing.
 *   2. The key's User ID is the pseudonymous `dot_matrix_apps@proton.me`
 *      with NO real name attached, and SECURITY.md names that same UID.
 *   3. The key is not expired. The self-signature's key-expiration-time
 *      subpacket (RFC 4880 §5.2.3.6) is read from the latest self-signature
 *      issued by the key itself (a direct-key signature, type 0x1F, or a
 *      primary-UID certification, types 0x10–0x13). The absolute expiry is
 *      the key's creation time plus that subpacket's value. The check FAILS
 *      if the key has already expired, and WARNS (without failing) if it
 *      expires within the next 30 days. A key with no key-expiration-time
 *      subpacket never expires and passes. This catches a silently-expired
 *      contact key that researchers could otherwise encrypt a report to.
 *
 * The fingerprint is computed in pure Node (node:crypto SHA-1) so the check
 * has no dependency on gpg or any PGP library being installed in CI.
 *
 * Run via:
 *
 *     pnpm --filter @workspace/void-client run check:security-key-fingerprint
 *
 * Wired into CI as part of the `marketing-voice` validation workflow (the
 * same gate as the other repo-wide static doc/asset drift checks).
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(CLIENT_ROOT, "..", "..");

const KEY_FILE = resolve(REPO_ROOT, "security-contact.asc");
const SECURITY_MD = resolve(REPO_ROOT, "SECURITY.md");

const EXPECTED_EMAIL = "dot_matrix_apps@proton.me";

const violations = [];

function read(path) {
  return readFileSync(path, "utf8");
}

function rel(path) {
  return relative(REPO_ROOT, path);
}

/**
 * Strip the ASCII armor from a PGP key block and return the decoded binary
 * packet stream. Drops the armor header lines (everything up to the first
 * blank line), any armor headers, and the trailing CRC-24 checksum line
 * (the one that begins with "=").
 */
function dearmor(armored) {
  const lines = armored.split(/\r?\n/);
  const start = lines.findIndex((l) => l.includes("BEGIN PGP PUBLIC KEY BLOCK"));
  const end = lines.findIndex((l) => l.includes("END PGP PUBLIC KEY BLOCK"));
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("no PGP PUBLIC KEY BLOCK armor found");
  }
  const b64 = [];
  let inHeaders = true;
  for (let i = start + 1; i < end; i++) {
    const line = lines[i];
    if (inHeaders) {
      // Armor headers (e.g. "Version: …") run until the first blank line.
      if (line.trim() === "") inHeaders = false;
      continue;
    }
    if (line.startsWith("=")) continue; // CRC-24 checksum line
    b64.push(line.trim());
  }
  const data = Buffer.from(b64.join(""), "base64");
  if (data.length === 0) throw new Error("armor decoded to zero bytes");
  return data;
}

/**
 * Read one OpenPGP packet header at `off`. Returns { tag, bodyStart, bodyEnd }.
 * Supports new- and old-format headers and definite lengths (the only shapes
 * a serialized public key uses). Partial/indeterminate lengths are rejected.
 */
function readPacket(data, off) {
  const tagByte = data[off++];
  if (!(tagByte & 0x80)) {
    throw new Error(`byte 0x${tagByte.toString(16)} is not a packet header`);
  }
  let tag;
  let len;
  if (tagByte & 0x40) {
    // New format.
    tag = tagByte & 0x3f;
    const o = data[off++];
    if (o < 192) {
      len = o;
    } else if (o < 224) {
      len = ((o - 192) << 8) + data[off++] + 192;
    } else if (o === 255) {
      len = data.readUInt32BE(off);
      off += 4;
    } else {
      throw new Error("partial-length packets are not supported");
    }
  } else {
    // Old format.
    tag = (tagByte >> 2) & 0x0f;
    const lengthType = tagByte & 0x03;
    if (lengthType === 0) {
      len = data[off++];
    } else if (lengthType === 1) {
      len = data.readUInt16BE(off);
      off += 2;
    } else if (lengthType === 2) {
      len = data.readUInt32BE(off);
      off += 4;
    } else {
      throw new Error("indeterminate-length packets are not supported");
    }
  }
  return { tag, bodyStart: off, bodyEnd: off + len };
}

/**
 * Walk every packet in the stream, returning [{ tag, body }, …].
 */
function parsePackets(data) {
  const packets = [];
  let off = 0;
  while (off < data.length) {
    const { tag, bodyStart, bodyEnd } = readPacket(data, off);
    if (bodyEnd > data.length) {
      throw new Error(`packet (tag ${tag}) claims length past end of data`);
    }
    packets.push({ tag, body: data.subarray(bodyStart, bodyEnd) });
    off = bodyEnd;
  }
  return packets;
}

/**
 * Compute the V4 fingerprint of a public-key packet body (RFC 4880 §12.2):
 * SHA-1 over 0x99 ‖ high/low octets of the body length ‖ the body itself.
 * Returns the uppercase hex string (40 chars). Rejects non-V4 keys.
 */
function v4Fingerprint(pkBody) {
  if (pkBody[0] !== 0x04) {
    throw new Error(`expected a version-4 public key (got version ${pkBody[0]})`);
  }
  const len = pkBody.length;
  if (len > 0xffff) throw new Error("public-key packet too large for V4 framing");
  const prefix = Buffer.from([0x99, (len >> 8) & 0xff, len & 0xff]);
  return createHash("sha1")
    .update(prefix)
    .update(pkBody)
    .digest("hex")
    .toUpperCase();
}

/** Strip all whitespace from a fingerprint string for digit-wise comparison. */
function normalizeFp(s) {
  return s.replace(/\s+/g, "").toUpperCase();
}

/**
 * Read the creation time (seconds since the Unix epoch) of a V4 public-key
 * packet body (RFC 4880 §5.5.2: 1 octet version ‖ 4 octets creation time ‖ …).
 */
function keyCreationTime(pkBody) {
  if (pkBody[0] !== 0x04) {
    throw new Error(`expected a version-4 public key (got version ${pkBody[0]})`);
  }
  return pkBody.readUInt32BE(1);
}

/**
 * Parse a V4 signature packet body (RFC 4880 §5.2.3) far enough to recover the
 * fields this guard cares about, reading only the HASHED subpacket area (the
 * unhashed area is not protected by the signature and must not be trusted):
 *
 *   - signature type (octet 1)
 *   - signature creation time      (subpacket type 2,  §5.2.3.4)
 *   - key expiration time          (subpacket type 9,  §5.2.3.6)
 *   - issuer fingerprint           (subpacket type 33, §5.2.3.28)
 *   - issuer key ID                (subpacket type 16, §5.2.3.5)
 *
 * The high bit (0x80) of a subpacket type octet is the "critical" flag and is
 * masked off before matching. Returns null for any field that is absent.
 */
function parseSignature(sigBody) {
  if (sigBody[0] !== 0x04) {
    throw new Error(`expected a version-4 signature (got version ${sigBody[0]})`);
  }
  const type = sigBody[1];
  let p = 4; // skip version, type, pk-algo, hash-algo
  const hashedLen = sigBody.readUInt16BE(p);
  p += 2;
  const hashedEnd = p + hashedLen;
  if (hashedEnd > sigBody.length) {
    throw new Error("hashed subpacket area runs past the end of the signature");
  }

  let creationTime = null;
  let keyExpiration = null;
  let issuerFp = null;
  let issuerKeyId = null;

  while (p < hashedEnd) {
    let subLen;
    const fo = sigBody[p];
    if (fo < 192) {
      subLen = fo;
      p += 1;
    } else if (fo < 255) {
      if (p + 2 > hashedEnd) throw new Error("truncated 2-octet subpacket length");
      subLen = ((fo - 192) << 8) + sigBody[p + 1] + 192;
      p += 2;
    } else {
      if (p + 5 > hashedEnd) throw new Error("truncated 5-octet subpacket length");
      subLen = sigBody.readUInt32BE(p + 1);
      p += 5;
    }
    if (subLen < 1) throw new Error("zero-length signature subpacket");
    // The subpacket length counts the 1-octet type that follows it, so the
    // type octet plus its body must fit entirely inside the hashed area.
    if (p + subLen > hashedEnd) {
      throw new Error("signature subpacket runs past the hashed subpacket area");
    }
    const stype = sigBody[p] & 0x7f;
    const sub = sigBody.subarray(p + 1, p + subLen);
    p += subLen;

    if (stype === 2 && sub.length >= 4) {
      creationTime = sub.readUInt32BE(0);
    } else if (stype === 9 && sub.length >= 4) {
      keyExpiration = sub.readUInt32BE(0);
    } else if (stype === 33 && sub.length >= 1) {
      // 1 octet key version ‖ the fingerprint octets.
      issuerFp = sub.subarray(1).toString("hex").toUpperCase();
    } else if (stype === 16 && sub.length === 8) {
      issuerKeyId = sub.toString("hex").toUpperCase();
    }
  }

  return { type, creationTime, keyExpiration, issuerFp, issuerKeyId };
}

// ─── Parse the key file ──────────────────────────────────────────────

let packets;
try {
  packets = parsePackets(dearmor(read(KEY_FILE)));
} catch (err) {
  console.error(`security-key-fingerprint check failed: cannot parse ${rel(KEY_FILE)}.`);
  console.error(`  ${err.message}`);
  process.exit(1);
}

const keyPacket = packets.find((p) => p.tag === 6); // Public-Key packet
const uidPackets = packets.filter((p) => p.tag === 13); // every User ID packet

let computedFp = null;
if (!keyPacket) {
  violations.push({
    where: rel(KEY_FILE),
    msg: "no Public-Key packet (tag 6) found in the armored key",
  });
} else {
  try {
    computedFp = v4Fingerprint(keyPacket.body);
  } catch (err) {
    violations.push({ where: rel(KEY_FILE), msg: `fingerprint computation failed: ${err.message}` });
  }
}

// ─── Check 1: fingerprint matches SECURITY.md ────────────────────────

const securitySrc = read(SECURITY_MD);

if (computedFp) {
  // Pull every spaced-hex fingerprint-looking run out of SECURITY.md and
  // require the key's computed fingerprint to be among them. A fingerprint
  // is 40 hex digits, conventionally printed in ten 4-digit groups.
  const docFps = [];
  const fpRe = /`([0-9A-Fa-f]{4}(?:\s+[0-9A-Fa-f]{4}){9})`/g;
  let m;
  while ((m = fpRe.exec(securitySrc)) !== null) docFps.push(m[1]);

  if (docFps.length === 0) {
    violations.push({
      where: rel(SECURITY_MD),
      msg:
        "no PGP fingerprint string found. Expected the key's fingerprint, " +
        `formatted as ten 4-digit groups: \`${computedFp.match(/.{1,4}/g).join(" ")}\`.`,
    });
  } else {
    // EVERY fingerprint-looking string in SECURITY.md must match the key.
    // Requiring all of them (not just one) means a second, divergent
    // fingerprint added later — exactly the drift this guard exists to
    // catch — fails the check instead of slipping through.
    const mismatched = docFps.filter((d) => normalizeFp(d) !== computedFp);
    if (mismatched.length > 0) {
      violations.push({
        where: rel(SECURITY_MD),
        msg:
          "documented PGP fingerprint does not match the committed key " +
          `${rel(KEY_FILE)}.\n` +
          `    Key file fingerprint: ${computedFp.match(/.{1,4}/g).join(" ")}\n` +
          `    SECURITY.md says:     ${mismatched.join(" / ")}\n` +
          "    The key and the published fingerprint have drifted apart. Update " +
          "the fingerprint in SECURITY.md to match the key (or restore the " +
          "correct key file).",
      });
    }
  }
}

// ─── Check 2: User ID is the pseudonymous email with no real name ────

if (uidPackets.length === 0) {
  violations.push({
    where: rel(KEY_FILE),
    msg: "no User ID packet (tag 13) found in the armored key",
  });
} else {
  // Validate EVERY User ID on the key, not just the first. A key can carry
  // multiple UIDs; a real name hidden in a later UID would still
  // de-pseudonymize the contact, so each one must be the bare email.
  let sawExpectedEmail = false;
  for (const pkt of uidPackets) {
    const uid = pkt.body.toString("utf8");
    // A UID is "Name <email>" or just "email". Extract the angle-bracket
    // address if present, plus the free-text name portion before it.
    const angle = /^(.*?)<([^>]*)>\s*$/.exec(uid);
    const namePart = angle ? angle[1].trim() : "";
    const emailPart = angle ? angle[2].trim() : uid.trim();

    if (emailPart === EXPECTED_EMAIL) sawExpectedEmail = true;

    if (emailPart !== EXPECTED_EMAIL) {
      violations.push({
        where: rel(KEY_FILE),
        msg:
          `key User ID email is "${emailPart}", expected the pseudonymous ` +
          `"${EXPECTED_EMAIL}". UID string: "${uid}".`,
      });
    }

    // "No real name attached": the name portion must be empty, or be the
    // email itself (ProtonMail self-signs UIDs as "email <email>"). Anything
    // else is a real name that should not be published.
    if (namePart !== "" && namePart !== EXPECTED_EMAIL) {
      violations.push({
        where: rel(KEY_FILE),
        msg:
          `key User ID carries a real name ("${namePart}"). The security ` +
          "contact is pseudonymous — the UID must be just the email address " +
          "with no real name attached.",
      });
    }
  }

  if (!sawExpectedEmail) {
    violations.push({
      where: rel(KEY_FILE),
      msg: `no User ID on the key carries the expected email "${EXPECTED_EMAIL}".`,
    });
  }

  // And SECURITY.md must name the same pseudonymous UID.
  if (!securitySrc.includes(EXPECTED_EMAIL)) {
    violations.push({
      where: rel(SECURITY_MD),
      msg: `does not mention the security contact User ID "${EXPECTED_EMAIL}".`,
    });
  }
}

// ─── Check 3: the key has not expired (RFC 4880 §5.2.3.6) ────────────

// Warn (but do not fail) when the key is valid but expires soon, so the
// maintainer has lead time to rotate before researchers are left with an
// unusable key.
const EXPIRY_WARN_DAYS = 30;
const SECONDS_PER_DAY = 86400;

const warnings = [];
let expirySummary = "the key has no expiration date set (it does not expire)";

if (keyPacket && computedFp) {
  let keyCreation = null;
  try {
    keyCreation = keyCreationTime(keyPacket.body);
  } catch (err) {
    violations.push({
      where: rel(KEY_FILE),
      msg: `cannot read the key creation time: ${err.message}`,
    });
  }

  if (keyCreation !== null) {
    // The effective key expiration lives in a self-signature issued by the
    // key itself: a direct-key signature (0x1F) or a primary-UID
    // certification (0x10–0x13). Third-party certifications (e.g. the
    // ProtonMail CA's 0x10 cert) have a different issuer and are ignored.
    // When several self-signatures exist, the most recent one wins.
    const lastFour = computedFp.slice(-16); // key ID = low 64 bits of the fp
    let selfSig = null;
    for (const pkt of packets.filter((p) => p.tag === 2)) {
      let sig;
      try {
        sig = parseSignature(pkt.body);
      } catch {
        continue; // not a V4 signature we understand; skip
      }
      const isSelfSigType = sig.type === 0x1f || (sig.type >= 0x10 && sig.type <= 0x13);
      if (!isSelfSigType) continue;
      const issuedByThisKey =
        (sig.issuerFp && sig.issuerFp === computedFp) ||
        (!sig.issuerFp && sig.issuerKeyId && sig.issuerKeyId === lastFour);
      if (!issuedByThisKey) continue;
      if (!selfSig || (sig.creationTime ?? 0) > (selfSig.creationTime ?? 0)) {
        selfSig = sig;
      }
    }

    if (!selfSig) {
      violations.push({
        where: rel(KEY_FILE),
        msg:
          "no self-signature issued by the key itself was found, so the key's " +
          "expiration cannot be verified. The contact key must carry a valid " +
          "self-signature.",
      });
    } else if (selfSig.keyExpiration != null && selfSig.keyExpiration > 0) {
      const absExpiry = keyCreation + selfSig.keyExpiration;
      const now = Math.floor(Date.now() / 1000);
      const expiryIso = new Date(absExpiry * 1000).toISOString().slice(0, 10);
      if (absExpiry <= now) {
        const daysAgo = Math.floor((now - absExpiry) / SECONDS_PER_DAY);
        violations.push({
          where: rel(KEY_FILE),
          msg:
            `the security contact key EXPIRED on ${expiryIso} (${daysAgo} day(s) ` +
            "ago). Researchers can no longer encrypt reports to it. Rotate the " +
            "key (extend its expiry or publish a new one), update the " +
            "fingerprint and UID in SECURITY.md, and re-commit security-contact.asc.",
        });
      } else {
        const daysLeft = Math.ceil((absExpiry - now) / SECONDS_PER_DAY);
        expirySummary = `the key expires on ${expiryIso} (${daysLeft} day(s) away)`;
        if (daysLeft <= EXPIRY_WARN_DAYS) {
          warnings.push({
            where: rel(KEY_FILE),
            msg:
              `the security contact key expires on ${expiryIso} — only ${daysLeft} ` +
              `day(s) away (warning threshold is ${EXPIRY_WARN_DAYS} days). Rotate ` +
              "or extend it before it expires so researchers are never left with " +
              "an unusable contact key.",
          });
        }
      }
    }
  }
}

// ─── Report ──────────────────────────────────────────────────────────

if (violations.length > 0) {
  console.error(`security-key-fingerprint check failed: ${violations.length} violation(s).\n`);
  for (const v of violations) {
    console.error(`  ${v.where}`);
    console.error(`    ${v.msg}\n`);
  }
  console.error(
    "The committed PGP key (security-contact.asc) and the contact details\n" +
      "published in SECURITY.md must stay in lockstep. If the key was rotated,\n" +
      "update the fingerprint and UID prose in SECURITY.md to match the new key.\n" +
      "If SECURITY.md is right, restore the correct key file. This guard exists\n" +
      "so researchers never encrypt a report to the wrong key.",
  );
  process.exit(1);
}

if (warnings.length > 0) {
  console.warn(`security-key-fingerprint check: ${warnings.length} warning(s).\n`);
  for (const w of warnings) {
    console.warn(`  ${w.where}`);
    console.warn(`    ${w.msg}\n`);
  }
}

console.log(
  "security-key-fingerprint check passed: security-contact.asc computes to " +
    `${computedFp.match(/.{1,4}/g).join(" ")}, matching the fingerprint in ` +
    `SECURITY.md, the key UID is the pseudonymous ${EXPECTED_EMAIL} with ` +
    `no real name, and ${expirySummary}.`,
);
