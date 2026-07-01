// SPDX-License-Identifier: AGPL-3.0-or-later
import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  SimpleAckPayload,
} from "@workspace/signaling-types";

// Extension events that the server emits / the client handles but that are
// not yet reflected in asyncapi.yaml (Task #202). When these are added to
// the spec, remove the corresponding lines here.
type ServerToClientEventsExtended = ServerToClientEvents & {
  "host-changed": (data: { hostPresent: boolean; hostPeerId: string | null }) => void;
  "relay-only-requested": (data: { peerId: string }) => void;
  "relay-only-request-declined": () => void;
  "room-relay-mode-enabled": (data: { requestedBy?: string }) => void;
  // Task #229: a peer that hit a secure-channel failure clicked "Retry"
  // and signals us to clear our own failure entry for them so their
  // fresh ECDHE offer is not silently dropped. Emitted/consumed in
  // src/lib/webrtc.ts and src/hooks/useRoomConnection.ts; not yet in
  // asyncapi.yaml (Task #202).
  "peer-secure-channel-retry": (data: { fromPeerId: string }) => void;
  // server-shutdown is also exported by the generated
  // ServerToClientEvents (asyncapi-derived), but we re-list it here for
  // local clarity. Removing it from `generated.ts` would break the
  // shutdown banner contract; keep both in sync.
  "server-shutdown": (data: { reason: string; drainMs: number }) => void;
};

type ClientToServerEventsExtended = ClientToServerEvents & {
  "request-relay-only": (data: { code: string }, cb?: (result: SimpleAckPayload & { alreadyEnabled?: boolean }) => void) => void;
  "respond-relay-only-request": (data: { code: string; peerId: string; accept: boolean }, cb?: (result: SimpleAckPayload) => void) => void;
};

/** Typed Socket.io socket for the VOID signaling channel. */
export type VoidSocket = Socket<ServerToClientEventsExtended, ClientToServerEventsExtended>;

let socket: VoidSocket | null = null;

export function getSocket(): VoidSocket {
  if (!socket) {
    socket = io({
      path: "/api/socket.io",
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    }) as VoidSocket;
  }
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
