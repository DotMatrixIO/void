// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useEffect, useRef, useState } from "react";
import { getSocket } from "@/lib/socket";
import { uiClick, uiSlide } from "@/lib/uiSounds";
import { persistHostToken } from "@/lib/hostTokenStorage";

// Task #502: extracted from RoomPage. Owns the host top-up flow
// (extend modal + extend-room emit + ack handling) and the small
// flash-toast for success/failure messages. Cross-cutting effects on
// the countdown and expiry-warning hooks happen through injected
// callbacks: `onExtended` applies the new server-issued window and
// `resetExpiryWarning` re-arms the wrap-it-up toast machine.
export interface UseRoomExtensionOptions {
  // Task #1024: live rendezvous handle — `extend-room` routes on this value.
  wireCodeRef: React.MutableRefObject<string>;
  voidPhrase: string;
  onExtended: (
    expiresAt: number,
    serverNow: number,
    tier?: "standard" | "day",
  ) => void;
  resetExpiryWarning: () => void;
  // Task #926: fired exactly once per *successful* paid extend, on the
  // host who paid (the local extend-room ack — NOT the room-extended
  // broadcast, which lands on every peer). RoomPage uses it to re-raise
  // the Lightning IP-linkage reminder when the room is loaded over a
  // .onion origin, since a clearnet top-up leaks the host's IP to the
  // payment server exactly like the original paid create did.
  onPaidExtendSuccess?: () => void;
}

export interface UseRoomExtensionApi {
  extendModalOpen: boolean;
  setExtendModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  extendInFlight: boolean;
  extendNotice: string | null;
  flashExtendNotice: (msg: string) => void;
  handleOpenExtend: () => void;
  handleExtendPaid: (token: string) => Promise<void>;
}

export function useRoomExtension({
  wireCodeRef,
  voidPhrase,
  onExtended,
  resetExpiryWarning,
  onPaidExtendSuccess,
}: UseRoomExtensionOptions): UseRoomExtensionApi {
  const [extendModalOpen, setExtendModalOpen] = useState(false);
  const [extendInFlight, setExtendInFlight] = useState(false);
  const [extendNotice, setExtendNotice] = useState<string | null>(null);
  const extendNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const flashExtendNotice = useCallback((msg: string) => {
    setExtendNotice(msg);
    if (extendNoticeTimerRef.current) clearTimeout(extendNoticeTimerRef.current);
    extendNoticeTimerRef.current = setTimeout(() => {
      setExtendNotice(null);
      extendNoticeTimerRef.current = null;
    }, 4000);
  }, []);

  const handleOpenExtend = useCallback(() => {
    uiClick();
    setExtendModalOpen(true);
  }, []);

  const handleExtendPaid = useCallback(
    async (token: string) => {
      // Drop the cached create-room token so this freshly-paid invoice
      // can't accidentally be reused later for a brand-new room. Once
      // we hand it to the server for extension it's spent.
      try {
        sessionStorage.removeItem("void_token");
      } catch {}
      // Task #171 / #191: stash the extension token as a host-claim
      // credential BEFORE handing it to the server. The server side
      // effect of `extend-room` is to register this token's
      // `paymentHash` on the room, so even if the original creation
      // token has been wiped (or this is a long-lived room past
      // creation-token expiry), the host can still reclaim host on
      // rejoin — including across full browser-tab restarts on
      // day-tier rooms (encrypted-at-rest in localStorage; see
      // hostTokenStorage.ts).
      //
      // We *await* persistence here (rather than fire-and-forget) so
      // that a host who immediately closes the tab right after paying
      // for the extension cannot lose the JWT to a half-completed
      // crypto.subtle pipeline. persistHostToken is best-effort
      // internally (swallows quota/crypto failures), so awaiting it
      // cannot throw — it only ensures the localStorage write has
      // actually landed before we tell the server about the extension.
      await persistHostToken(voidPhrase, token);
      setExtendModalOpen(false);
      setExtendInFlight(true);
      const socket = getSocket();
      socket.emit(
        "extend-room",
        { code: wireCodeRef.current, token },
        (result: {
          success: boolean;
          error?: string;
          expiresAt?: number;
          serverNow?: number;
          tier?: "standard" | "day";
        }) => {
          setExtendInFlight(false);
          if (
            !result ||
            !result.success ||
            typeof result.expiresAt !== "number" ||
            typeof result.serverNow !== "number"
          ) {
            const err = result?.error ?? "UNKNOWN_ERROR";
            // Task #181: the server emits a dedicated
            // TOKEN_ALREADY_USED when a host tries to spend the same
            // paid extension token twice. Surface plain language
            // instead of leaking the raw wire code, which reads like a
            // generic failure and gives no hint that the payment itself
            // was real.
            if (err === "TOKEN_ALREADY_USED") {
              flashExtendNotice(
                "THIS PAYMENT WAS ALREADY USED — PAY AGAIN TO EXTEND",
              );
              return;
            }
            // Task #485: surface plain-language sentences for the wire
            // codes the server can return on extend-room rejection,
            // instead of leaking internal identifiers nobody outside
            // the source can decode. Voice stays brutalist all-caps to
            // match the rest of the modal copy.
            if (err === "EXTENSION_CAPPED") {
              flashExtendNotice(
                "THIS ROOM HAS HIT ITS EXTENSION LIMIT — START A NEW ROOM TO KEEP GOING",
              );
              return;
            }
            if (err === "INVALID_EXTENSION") {
              flashExtendNotice(
                "EXTENSION TOKEN EXPIRED OR INVALID — REOPEN THE PAYWALL AND TRY AGAIN",
              );
              return;
            }
            flashExtendNotice(`COULDN’T EXTEND: ${err}`);
            return;
          }
          // The server also broadcasts room-extended to everyone in the
          // room (including this socket); applying the new countdown
          // here is idempotent if the broadcast lands a moment later.
          onExtended(result.expiresAt, result.serverNow, result.tier);
          resetExpiryWarning();
          flashExtendNotice("ROOM EXTENDED ✓");
          uiSlide();
          // Task #926: the top-up just settled. If this room is loaded over
          // a .onion origin, RoomPage re-raises the Lightning IP-linkage
          // reminder — a clearnet wallet leaks the host's IP on extend the
          // same way it does on the original paid create.
          onPaidExtendSuccess?.();
        },
      );
    },
    [
      wireCodeRef,
      voidPhrase,
      flashExtendNotice,
      onExtended,
      resetExpiryWarning,
      onPaidExtendSuccess,
    ],
  );

  useEffect(() => {
    return () => {
      if (extendNoticeTimerRef.current) {
        clearTimeout(extendNoticeTimerRef.current);
        extendNoticeTimerRef.current = null;
      }
    };
  }, []);

  return {
    extendModalOpen,
    setExtendModalOpen,
    extendInFlight,
    extendNotice,
    flashExtendNotice,
    handleOpenExtend,
    handleExtendPaid,
  };
}
