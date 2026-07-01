// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type PeerSAS,
  type CryptoMismatchPeers,
  type SecureChannelFailures,
  type RekeyHandler,
  type SilentRekeyHandler,
} from "@/lib/webrtc";

export type VerifyState = "pending" | "unverified" | "verified" | "mismatch";

// How long the subtle, non-modal "keys rotated" indicator lingers after
// a silent continuity-bound rekey before it auto-clears. Long enough to
// be noticed, short enough to stay unobtrusive.
const SILENT_REKEY_NOTICE_MS = 10_000;

export interface UseRoomCryptoApi {
  peerSAS: PeerSAS;
  setPeerSAS: React.Dispatch<React.SetStateAction<PeerSAS>>;
  cryptoMismatch: CryptoMismatchPeers;
  setCryptoMismatch: React.Dispatch<React.SetStateAction<CryptoMismatchPeers>>;
  secureChannelFailures: SecureChannelFailures;
  setSecureChannelFailures: React.Dispatch<
    React.SetStateAction<SecureChannelFailures>
  >;

  peerVerification: Record<
    string,
    { sasFingerprint: string; status: "verified" | "mismatch" }
  >;
  setPeerVerification: React.Dispatch<
    React.SetStateAction<
      Record<string, { sasFingerprint: string; status: "verified" | "mismatch" }>
    >
  >;

  verificationOpenFor: string | null;
  setVerificationOpenFor: React.Dispatch<React.SetStateAction<string | null>>;
  verificationAnchor: HTMLElement | null;
  setVerificationAnchor: React.Dispatch<
    React.SetStateAction<HTMLElement | null>
  >;

  phraseChangedNotice: Record<string, true>;
  setPhraseChangedNotice: React.Dispatch<
    React.SetStateAction<Record<string, true>>
  >;

  // Subtle, non-modal "keys rotated" indicator raised by a SILENT
  // continuity-bound rekey. Auto-clears after SILENT_REKEY_NOTICE_MS.
  // Distinct from `phraseChangedNotice`, which is the persistent loud
  // RE-VERIFY banner for an identity-change rekey.
  silentRekeyNotice: Record<string, true>;

  peerKeyFingerprintsRef: React.MutableRefObject<Record<string, string>>;
  e2eKeyRef: React.MutableRefObject<CryptoKey | null>;

  handleRekey: RekeyHandler;
  handleRekeyRef: React.MutableRefObject<RekeyHandler>;
  handleSilentRekey: SilentRekeyHandler;
  handleSilentRekeyRef: React.MutableRefObject<SilentRekeyHandler>;
  resetPhraseChangeTracking: () => void;

  sasFingerprintFor: (peerId: string) => string | null;
  verifyStateFor: (pid: string) => VerifyState;
  setVerifyStatus: (pid: string, status: "verified" | "mismatch") => void;
}

// Task #467: extracted from RoomPage. Owns all SAS / verification /
// rotated-keys / secure-channel-failure state plus the helpers that
// derive a UI-facing verification status from a peer's current SAS
// and the user's last verdict. Pure UI state — does not own the
// WebRTC manager itself; callers wire the returned setters into
// WebRTCManager callbacks (onSASUpdate, onSecureChannelFailure, etc.).
export interface UseRoomCryptoOptions {
  /**
   * Optional seed for the secure-channel-failure map. Used by the
   * snapshot/smoke harness (`SmokeRoom.tsx`, task #519) so the layout
   * pass can mount RoomPage with every tile already showing the
   * failure overlay + RETRY button, without faking WebRTC state.
   */
  initialSecureChannelFailures?: SecureChannelFailures;
}

export function useRoomCrypto(opts: UseRoomCryptoOptions = {}): UseRoomCryptoApi {
  const [peerSAS, setPeerSAS] = useState<PeerSAS>({});
  const [cryptoMismatch, setCryptoMismatch] = useState<CryptoMismatchPeers>({});
  const [secureChannelFailures, setSecureChannelFailures] =
    useState<SecureChannelFailures>(opts.initialSecureChannelFailures ?? {});
  const [peerVerification, setPeerVerification] = useState<
    Record<string, { sasFingerprint: string; status: "verified" | "mismatch" }>
  >({});
  const [verificationOpenFor, setVerificationOpenFor] = useState<string | null>(
    null,
  );
  const [verificationAnchor, setVerificationAnchor] =
    useState<HTMLElement | null>(null);
  const [phraseChangedNotice, setPhraseChangedNotice] = useState<
    Record<string, true>
  >({});
  const [silentRekeyNotice, setSilentRekeyNotice] = useState<
    Record<string, true>
  >({});

  const peerKeyFingerprintsRef = useRef<Record<string, string>>({});
  const e2eKeyRef = useRef<CryptoKey | null>(null);
  // Per-peer auto-clear timers for the silent "keys rotated" indicator.
  const silentNoticeTimers = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({});

  // First fingerprint per peer is the baseline; any subsequent change
  // invalidates that peer's verified state and raises the rotated-keys
  // notice that stays until the user issues a fresh verdict.
  const handleRekey = useCallback<RekeyHandler>((pid, fp) => {
    const prev = peerKeyFingerprintsRef.current[pid];
    peerKeyFingerprintsRef.current = {
      ...peerKeyFingerprintsRef.current,
      [pid]: fp,
    };
    if (!prev || prev === fp) return;
    setPeerVerification((current) => {
      if (!current[pid]) return current;
      const next = { ...current };
      delete next[pid];
      return next;
    });
    setPhraseChangedNotice((prevNotice) =>
      prevNotice[pid] ? prevNotice : { ...prevNotice, [pid]: true as const },
    );
  }, []);
  const handleRekeyRef = useRef<RekeyHandler>(handleRekey);
  useEffect(() => {
    handleRekeyRef.current = handleRekey;
  }, [handleRekey]);

  // SILENT continuity-bound rekey: the rotation rode the verified
  // session key, so identity continuity is cryptographically proven.
  // We advance the baseline fingerprint (so a LATER identity-change
  // rekey is still detected by `handleRekey`) and carry any prior
  // "verified" verdict forward onto the fresh SAS — never arming the
  // loud RE-VERIFY banner. A subtle, auto-clearing indicator is raised
  // instead.
  const handleSilentRekey = useCallback<SilentRekeyHandler>((pid, fp, sas) => {
    peerKeyFingerprintsRef.current = {
      ...peerKeyFingerprintsRef.current,
      [pid]: fp,
    };
    const newSasFingerprint = `${sas[0]}|${sas[1]}`;
    setPeerVerification((current) => {
      const entry = current[pid];
      // Only re-anchor a previously-verified verdict. If the peer was
      // never verified (or was a mismatch), leave it — the new SAS will
      // simply read as "unverified" via `verifyStateFor`.
      if (!entry || entry.status !== "verified") return current;
      if (entry.sasFingerprint === newSasFingerprint) return current;
      return {
        ...current,
        [pid]: { sasFingerprint: newSasFingerprint, status: "verified" },
      };
    });
    setSilentRekeyNotice((prev) => (prev[pid] ? prev : { ...prev, [pid]: true as const }));
    if (typeof setTimeout !== "undefined") {
      const existing = silentNoticeTimers.current[pid];
      if (existing) clearTimeout(existing);
      silentNoticeTimers.current[pid] = setTimeout(() => {
        setSilentRekeyNotice((prev) => {
          if (!(pid in prev)) return prev;
          const next = { ...prev };
          delete next[pid];
          return next;
        });
        delete silentNoticeTimers.current[pid];
      }, SILENT_REKEY_NOTICE_MS);
    }
  }, []);
  const handleSilentRekeyRef = useRef<SilentRekeyHandler>(handleSilentRekey);
  useEffect(() => {
    handleSilentRekeyRef.current = handleSilentRekey;
  }, [handleSilentRekey]);

  // Clear any pending auto-clear timers on unmount so a late timer
  // never calls setState on an unmounted hook.
  useEffect(() => {
    const timers = silentNoticeTimers.current;
    return () => {
      for (const t of Object.values(timers)) clearTimeout(t);
    };
  }, []);

  const resetPhraseChangeTracking = useCallback(() => {
    peerKeyFingerprintsRef.current = {};
    setPhraseChangedNotice({});
    for (const t of Object.values(silentNoticeTimers.current)) clearTimeout(t);
    silentNoticeTimers.current = {};
    setSilentRekeyNotice({});
  }, []);

  const sasFingerprintFor = useCallback(
    (peerId: string): string | null => {
      const sas = peerSAS[peerId];
      if (!sas) return null;
      return `${sas[0]}|${sas[1]}`;
    },
    [peerSAS],
  );

  const verifyStateFor = useCallback(
    (pid: string): VerifyState => {
      const fp = sasFingerprintFor(pid);
      if (!fp) return "pending";
      const entry = peerVerification[pid];
      if (!entry || entry.sasFingerprint !== fp) return "unverified";
      return entry.status;
    },
    [sasFingerprintFor, peerVerification],
  );

  const setVerifyStatus = useCallback(
    (pid: string, status: "verified" | "mismatch") => {
      const fp = sasFingerprintFor(pid);
      if (!fp) return;
      setPeerVerification((prev) => ({
        ...prev,
        [pid]: { sasFingerprint: fp, status },
      }));
      // A fresh user verdict clears the persistent rotated-keys notice.
      setPhraseChangedNotice((prev) => {
        if (!(pid in prev)) return prev;
        const next = { ...prev };
        delete next[pid];
        return next;
      });
    },
    [sasFingerprintFor],
  );

  return {
    peerSAS,
    setPeerSAS,
    cryptoMismatch,
    setCryptoMismatch,
    secureChannelFailures,
    setSecureChannelFailures,
    peerVerification,
    setPeerVerification,
    verificationOpenFor,
    setVerificationOpenFor,
    verificationAnchor,
    setVerificationAnchor,
    phraseChangedNotice,
    setPhraseChangedNotice,
    silentRekeyNotice,
    peerKeyFingerprintsRef,
    e2eKeyRef,
    handleRekey,
    handleRekeyRef,
    handleSilentRekey,
    handleSilentRekeyRef,
    resetPhraseChangeTracking,
    sasFingerprintFor,
    verifyStateFor,
    setVerifyStatus,
  };
}
