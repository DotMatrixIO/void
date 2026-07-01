// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useRef, useState } from "react";
import { getSocket } from "@/lib/socket";
import { uiClick } from "@/lib/uiSounds";
import { initialIceTransportPolicy } from "@/lib/origin";

// Task #490: extracted from RoomPage. Owns the room-moderation +
// peer-membership state plus the host-decisioned moderation handlers
// (lock/unlock, knock approve/deny, relay-only request/respond) and
// the small flash-toast helpers that go with them.
//
// What is NOT here (intentionally):
//   - The Socket.io `setup()` effect itself, which is deeply
//     interleaved with WebRTCManager construction, media-pipeline
//     setup, host-token persistence, and BURN coordination. Splitting
//     it would force a hook signature with ~20 dependencies and would
//     not improve testability. Setup mutates the setters this hook
//     exposes; the hook owns the state, not the wiring.
//   - `performLocalBurn`, which spans media + signaling + storage and
//     must remain the single BURN coordinator. The hook provides a
//     `resetSignalingState()` the coordinator can call.
//
// Pure-React state surface — no socket subscriptions are owned here.
// All event listeners are still attached inside RoomPage's setup()
// effect; this hook just provides the setters they call into.
export interface PeerMediaInfo {
  camOff: boolean;
  micMuted: boolean;
  voiceMode?: number;
  viaOnion?: boolean;
}

export interface UseRoomSignalingOptions {
  // Task #1024: the live rendezvous handle (per-epoch for human rooms,
  // durable id for agent/hybrid). All control-plane emits route on this.
  wireCodeRef: React.MutableRefObject<string>;
  initialPeers?: string[];
  initialJoined?: boolean;
  initialIsHost?: boolean;
  initialHostPresent?: boolean;
  initialHostPeerId?: string | null;
  initialPeerMediaState?: Record<string, PeerMediaInfo>;
}

export interface UseRoomSignalingApi {
  peers: string[];
  setPeers: React.Dispatch<React.SetStateAction<string[]>>;
  joined: boolean;
  setJoined: React.Dispatch<React.SetStateAction<boolean>>;

  isHost: boolean;
  setIsHost: React.Dispatch<React.SetStateAction<boolean>>;
  isHostRef: React.MutableRefObject<boolean>;

  hostPresent: boolean;
  setHostPresent: React.Dispatch<React.SetStateAction<boolean>>;
  hostPeerId: string | null;
  setHostPeerId: React.Dispatch<React.SetStateAction<string | null>>;

  roomLocked: boolean;
  setRoomLocked: React.Dispatch<React.SetStateAction<boolean>>;
  maxUsers: number;
  setMaxUsers: React.Dispatch<React.SetStateAction<number>>;

  knockMode: boolean;
  setKnockMode: React.Dispatch<React.SetStateAction<boolean>>;
  knockPending: boolean;
  setKnockPending: React.Dispatch<React.SetStateAction<boolean>>;
  pendingKnocks: string[];
  setPendingKnocks: React.Dispatch<React.SetStateAction<string[]>>;

  relayOnly: boolean;
  setRelayOnly: React.Dispatch<React.SetStateAction<boolean>>;
  relayRequestSent: boolean;
  setRelayRequestSent: React.Dispatch<React.SetStateAction<boolean>>;
  pendingRelayRequests: string[];
  setPendingRelayRequests: React.Dispatch<React.SetStateAction<string[]>>;
  relayResponseNotice: string | null;
  setRelayResponseNotice: React.Dispatch<React.SetStateAction<string | null>>;
  relayResponseNoticeTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  relayRequestedBy: string | null;
  setRelayRequestedBy: React.Dispatch<React.SetStateAction<string | null>>;
  relayRequestedByTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  iceTransportPolicyRef: React.MutableRefObject<RTCIceTransportPolicy>;

  peerMediaState: Record<string, PeerMediaInfo>;
  setPeerMediaState: React.Dispatch<
    React.SetStateAction<Record<string, PeerMediaInfo>>
  >;

  flashRelayResponseNotice: (text: string) => void;
  handleToggleLock: () => void;
  handleToggleKnock: () => void;
  handleApproveKnock: (knockPeerId: string) => void;
  handleDenyKnock: (knockPeerId: string) => void;
  handleRequestRelayOnly: () => void;
  handleRespondRelayRequest: (requesterPeerId: string, accept: boolean) => void;
}

export function useRoomSignaling({
  wireCodeRef,
  initialPeers = [],
  initialJoined = false,
  initialIsHost = false,
  initialHostPresent = true,
  initialHostPeerId = null,
  initialPeerMediaState = {},
}: UseRoomSignalingOptions): UseRoomSignalingApi {
  const [peers, setPeers] = useState<string[]>(initialPeers);
  const [joined, setJoined] = useState(initialJoined);

  const [isHost, setIsHost] = useState(initialIsHost);
  const isHostRef = useRef(initialIsHost);
  isHostRef.current = isHost;

  // Defaults to `true`: until the join callback resolves, the safest
  // assumption is that moderation is intact (the alternative would
  // flash a misleading "offline" pill on every fresh load).
  const [hostPresent, setHostPresent] = useState(initialHostPresent);
  const [hostPeerId, setHostPeerId] = useState<string | null>(initialHostPeerId);

  const [roomLocked, setRoomLocked] = useState(false);
  const [maxUsers, setMaxUsers] = useState(4);

  const [knockMode, setKnockMode] = useState(false);
  const [knockPending, setKnockPending] = useState(false);
  const [pendingKnocks, setPendingKnocks] = useState<string[]>([]);

  const [relayOnly, setRelayOnly] = useState(false);
  const [relayRequestSent, setRelayRequestSent] = useState(false);
  const [pendingRelayRequests, setPendingRelayRequests] = useState<string[]>([]);
  const [relayResponseNotice, setRelayResponseNotice] = useState<string | null>(
    null,
  );
  const relayResponseNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [relayRequestedBy, setRelayRequestedBy] = useState<string | null>(null);
  const relayRequestedByTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // Onion origin: pin local iceTransportPolicy to "relay" regardless of
  // the room-wide setting. See audit §2.3.
  const iceTransportPolicyRef = useRef<RTCIceTransportPolicy>(
    initialIceTransportPolicy(),
  );

  const [peerMediaState, setPeerMediaState] = useState<
    Record<string, PeerMediaInfo>
  >(initialPeerMediaState);

  const flashRelayResponseNotice = useCallback((text: string) => {
    if (relayResponseNoticeTimerRef.current) {
      clearTimeout(relayResponseNoticeTimerRef.current);
      relayResponseNoticeTimerRef.current = null;
    }
    setRelayResponseNotice(text);
    relayResponseNoticeTimerRef.current = setTimeout(() => {
      setRelayResponseNotice(null);
      relayResponseNoticeTimerRef.current = null;
    }, 4000);
  }, []);

  const handleToggleLock = useCallback(() => {
    uiClick();
    const socket = getSocket();
    if (roomLocked) {
      socket.emit("unlock-room", { code: wireCodeRef.current });
    } else {
      socket.emit("lock-room", { code: wireCodeRef.current });
    }
  }, [wireCodeRef, roomLocked]);

  const handleToggleKnock = useCallback(() => {
    uiClick();
    const socket = getSocket();
    socket.emit("set-knock-mode", { code: wireCodeRef.current, enabled: !knockMode });
  }, [wireCodeRef, knockMode]);

  const handleApproveKnock = useCallback(
    (knockPeerId: string) => {
      uiClick();
      const socket = getSocket();
      socket.emit("approve-knock", { code: wireCodeRef.current, peerId: knockPeerId });
      setPendingKnocks((prev) => prev.filter((p) => p !== knockPeerId));
    },
    [wireCodeRef],
  );

  const handleDenyKnock = useCallback(
    (knockPeerId: string) => {
      uiClick();
      const socket = getSocket();
      socket.emit("deny-knock", { code: wireCodeRef.current, peerId: knockPeerId });
      setPendingKnocks((prev) => prev.filter((p) => p !== knockPeerId));
    },
    [wireCodeRef],
  );

  // Cooperative relay-only request flow (Task #106). The host can still
  // decline; this only sends the ask. Locally we flip `relayRequestSent`
  // so the button disables and the user sees a clear "asked, waiting"
  // state until the host answers.
  const handleRequestRelayOnly = useCallback(() => {
    uiClick();
    setRelayRequestSent(true);
    const socket = getSocket();
    socket.emit(
      "request-relay-only",
      { code: wireCodeRef.current },
      (result: { success: boolean; error?: string; alreadyEnabled?: boolean }) => {
        if (!result.success) {
          // Couldn't deliver — re-enable the button so the user can retry,
          // and surface the reason.
          setRelayRequestSent(false);
          if (result.error === "RATE_LIMITED") {
            flashRelayResponseNotice("TOO MANY REQUESTS · TRY AGAIN LATER");
          } else if (result.error === "NO_HOST") {
            flashRelayResponseNotice("NO HOST IN ROOM TO ASK");
          } else {
            flashRelayResponseNotice("REQUEST FAILED");
          }
          return;
        }
        // The room was already relay-only — the broadcast handler may
        // not fire for this client, so reset the local pending flag.
        if (result.alreadyEnabled) {
          setRelayRequestSent(false);
        }
      },
    );
  }, [wireCodeRef, flashRelayResponseNotice]);

  const handleRespondRelayRequest = useCallback(
    (requesterPeerId: string, accept: boolean) => {
      uiClick();
      setPendingRelayRequests((prev) => prev.filter((p) => p !== requesterPeerId));
      const socket = getSocket();
      socket.emit("respond-relay-only-request", {
        code: wireCodeRef.current,
        peerId: requesterPeerId,
        accept,
      });
    },
    [wireCodeRef],
  );

  return {
    peers,
    setPeers,
    joined,
    setJoined,
    isHost,
    setIsHost,
    isHostRef,
    hostPresent,
    setHostPresent,
    hostPeerId,
    setHostPeerId,
    roomLocked,
    setRoomLocked,
    maxUsers,
    setMaxUsers,
    knockMode,
    setKnockMode,
    knockPending,
    setKnockPending,
    pendingKnocks,
    setPendingKnocks,
    relayOnly,
    setRelayOnly,
    relayRequestSent,
    setRelayRequestSent,
    pendingRelayRequests,
    setPendingRelayRequests,
    relayResponseNotice,
    setRelayResponseNotice,
    relayResponseNoticeTimerRef,
    relayRequestedBy,
    setRelayRequestedBy,
    relayRequestedByTimerRef,
    iceTransportPolicyRef,
    peerMediaState,
    setPeerMediaState,
    flashRelayResponseNotice,
    handleToggleLock,
    handleToggleKnock,
    handleApproveKnock,
    handleDenyKnock,
    handleRequestRelayOnly,
    handleRespondRelayRequest,
  };
}
