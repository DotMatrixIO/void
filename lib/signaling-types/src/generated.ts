// AUTO-GENERATED — do not edit manually.
// Re-generate with: pnpm --filter @workspace/api-spec run codegen
// Source: lib/api-spec/asyncapi.yaml

/** 32-character lowercase hex room ID derived from the VOID Phrase. */
export type RoomCode = string;

/** Per-peer identifier minted by the client. */
export type PeerId = string;

/** Room type. VOID is a single human-only product; `human` is the only room type. */
export type RoomType =
  | "human";

/** Paid tier. `standard` = 65-minute room. `day` = 24-hour room. Legacy `week` JWTs (pre-Task #115) are clamped to `day`. */
export type RoomTier =
  | "standard"
  | "day";

/** Unix epoch in milliseconds. */
export type EpochMs = number;

/** Compact-serialized HS256 JWT minted by `POST /paywall/status/{paymentHash}` (or `POST /paywall/recover`). Required for `create-room` and `extend-room`; optional on `join-room` to claim host on a host-less room. */
export type PaywallJwt = string;

/** Shared enumeration of every error code the signaling channel may emit (in ack callbacks, `screen-share-denied`, or connection-time middleware errors). Clients should treat any future, unknown value as a generic failure. */
export type SignalingErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_CODE"
  | "INVALID_ROOM_ID"
  | "INVALID_EXTENSION"
  | "PAYMENT_REQUIRED"
  | "TOKEN_ALREADY_USED"
  | "ROOM_CAP_REACHED"
  | "ROOM_EXISTS"
  | "ROOM_NOT_FOUND"
  | "ROOM_EXPIRED"
  | "ROOM_LOCKED"
  | "ROOM_FULL"
  | "EXTENSION_CAPPED"
  | "KNOCK_PENDING"
  | "KNOCK_NOT_FOUND"
  | "KNOCK_QUEUE_FULL"
  | "NOT_HOST"
  | "NOT_IN_ROOM"
  | "NO_RESERVATION"
  | "NOT_SHARING"
  | "SLOT_OCCUPIED"
  | "SLOT_RESERVED"
  | "RATE_LIMITED"
  | "TOO_MANY_CONNECTIONS";

export interface RequestScreenShareAckPayload {
  success: boolean;
  error?: SignalingErrorCode;
  /** Per-grant idempotency nonce, present only on `success: true`. The client tracks the last-acted nonce and ignores any duplicate ack carrying the same value so a retransmit or out-of-order delivery cannot promote the same grant twice and double-book the presenter slot. */
  nonce?: string;
}

export interface ScreenShareGrantedPayload {
  code: RoomCode;
  /** Per-grant idempotency nonce. Matches the `nonce` returned on the `request-screen-share` ack for the same grant. */
  nonce: string;
}

export interface SimpleAckPayload {
  success: boolean;
  error?: SignalingErrorCode;
}

export interface CreateRoomRequestPayload {
  roomId: RoomCode;
  token: PaywallJwt;
  /** Force every peer connection in the room to use the TURN relay (no host-candidate fallback). */
  relayOnly?: boolean;
  roomType?: RoomType;
}

export interface CreateRoomAckPayload {
  success?: boolean;
  error?: SignalingErrorCode;
  relayOnly?: boolean;
  roomType?: RoomType;
  tier?: RoomTier;
  expiresAt?: EpochMs | null;
  serverNow?: EpochMs;
}

export interface JoinRoomRequestPayload {
  code: RoomCode;
  peerId: PeerId;
  /** Optional. If present and valid, the joining socket may claim host on a host-less room whose stored `paymentHash` set contains the JWT's `paymentHash`. */
  token?: PaywallJwt;
}

export interface JoinRoomAckPayload {
  success: boolean;
  error?: SignalingErrorCode;
  /** Peer IDs of every other socket already in the room at the moment this socket was admitted. Excludes the joiner's own peerId. */
  peers: PeerId[];
  locked?: boolean;
  maxUsers?: number;
  /** Set when `error == "KNOCK_PENDING"`. Indicates the socket has been added to the room's `:knocking` waiting room and should now wait for `knock-approved` or `knock-denied`. */
  knockPending?: boolean;
  knockMode?: boolean;
  relayOnly?: boolean;
  roomType?: RoomType;
  tier?: RoomTier | null;
  isHost?: boolean;
  expiresAt?: EpochMs | null;
  serverNow?: EpochMs;
  screenSharePeerId?: PeerId | null;
  screenShareReservedByPeerId?: PeerId | null;
}

export interface LeaveRoomRequestPayload {
  code: RoomCode;
  peerId: PeerId;
}

export interface DestroyRoomRequestPayload {
  code: RoomCode;
}

export interface BurnRoomRequestPayload {
  code: RoomCode;
  peerId: PeerId;
}

export interface ExtendRoomRequestPayload {
  code: RoomCode;
  token: PaywallJwt;
}

export interface ExtendRoomAckPayload {
  success: boolean;
  error?: SignalingErrorCode;
  expiresAt?: EpochMs;
  serverNow?: EpochMs;
  tier?: RoomTier;
}

export interface RoomCodeOnlyPayload {
  code: RoomCode;
}

export interface SetKnockModeRequestPayload {
  code: RoomCode;
  enabled: boolean;
}

export interface CodeAndPeerPayload {
  code: RoomCode;
  peerId: PeerId;
}

export interface RelaySignalInPayload {
  code: RoomCode;
  toPeerId: PeerId;
  fromPeerId: PeerId;
  /** Opaque WebRTC signaling payload (offer / answer / ICE candidate / etc). The server never inspects this field. */
  payload: unknown;
}

export interface RelaySignalOutPayload {
  fromPeerId: PeerId;
  /** Opaque WebRTC signaling payload, forwarded as-is. */
  payload: unknown;
}

/** Event whose wire payload is the empty object `{}`. Used for `room-locked` / `room-unlocked`, which the server emits as `emit(event, {})`. Distinct from `room-expired` / `room-destroyed`, which are emitted with no argument at all (`payload: { type: "null" }` on those messages). */
export type EmptyObjectPayload = Record<string, never>;

export interface PeerOnlyPayload {
  peerId: PeerId;
}

export interface RoomExtendedPayload {
  expiresAt: EpochMs;
  serverNow: EpochMs;
  tier: RoomTier;
}

export interface KnockRequestPayload {
  peerId: PeerId;
  code: RoomCode;
}

export interface KnockModeChangedPayload {
  enabled: boolean;
}

export interface KnockApprovedPayload {
  code: RoomCode;
  peers: PeerId[];
  relayOnly?: boolean;
  roomType?: RoomType;
  tier?: RoomTier | null;
  expiresAt?: EpochMs | null;
  serverNow?: EpochMs;
  screenSharePeerId?: PeerId | null;
  screenShareReservedByPeerId?: PeerId | null;
}

export interface ScreenShareDeniedPayload {
  code: RoomCode;
  /** One of `SLOT_OCCUPIED` (another peer is actively sharing) or `SLOT_RESERVED` (another peer is mid-reservation). Other `SignalingErrorCode` values may appear if the room state changed between request and response. */
  reason?: SignalingErrorCode;
}

export interface ScreenShareStatePayload {
  /** Peer currently sharing their screen, or `null` if the slot is unused. */
  activeScreenSharePeerId: PeerId | null;
  /** Peer that holds an unconfirmed reservation (12-second TTL), or `null` if no reservation is pending. */
  reservedByPeerId: PeerId | null;
}

export interface HostChangedPayload {
  hostPresent: boolean;
  hostPeerId: PeerId | null;
}

export interface PeerOnlyOutPayload {
  peerId: PeerId;
}

export interface RequestRelayOnlyAckPayload {
  success?: boolean;
  error?: SignalingErrorCode;
  /** Set to `true` when the room was already in relay-only mode at request time. The server skips the `room-relay-mode-enabled` broadcast in that case. */
  alreadyEnabled?: boolean;
}

export interface RespondRelayOnlyRequestPayload {
  code: RoomCode;
  peerId: PeerId;
  accept: boolean;
}

/**
 * Typed Socket.IO event maps generated from asyncapi.yaml.
 *
 * Usage on the server:
 *   import { Server } from "socket.io";
 *   const io = new Server<ClientToServerEvents, ServerToClientEvents>(...);
 *
 * Usage on the client:
 *   import { io } from "socket.io-client";
 *   const socket = io(...) as Socket<ServerToClientEvents, ClientToServerEvents>;
 */

/** Events emitted by the server and received by the client. */
export interface ServerToClientEvents {
  "peer-joined": (data: PeerOnlyPayload) => void;
  "peer-left": (data: PeerOnlyPayload) => void;
  "room-locked": (data: EmptyObjectPayload) => void;
  "room-unlocked": (data: EmptyObjectPayload) => void;
  "room-extended": (data: RoomExtendedPayload) => void;
  "room-expired": () => void;
  "room-destroyed": () => void;
  "server-shutdown": (data: {
  reason: string;
  drainMs: number;
}) => void;
  "knock-request": (data: KnockRequestPayload) => void;
  "knock-mode-changed": (data: KnockModeChangedPayload) => void;
  "knock-approved": (data: KnockApprovedPayload) => void;
  "knock-denied": (data: RoomCodeOnlyPayload) => void;
  "relay-signal": (data: RelaySignalOutPayload) => void;
  "screen-share-granted": (data: ScreenShareGrantedPayload) => void;
  "screen-share-denied": (data: ScreenShareDeniedPayload) => void;
  "screen-share-state": (data: ScreenShareStatePayload) => void;
  "relay-only-requested": (data: PeerOnlyOutPayload) => void;
  "relay-only-request-declined": (data: EmptyObjectPayload) => void;
  "room-relay-mode-enabled": (data: EmptyObjectPayload) => void;
  "host-changed": (data: HostChangedPayload) => void;
}

/** Events emitted by the client and received by the server. */
export interface ClientToServerEvents {
  "create-room": (data: CreateRoomRequestPayload, cb?: (result: CreateRoomAckPayload) => void) => void;
  "join-room": (data: JoinRoomRequestPayload, cb?: (result: JoinRoomAckPayload) => void) => void;
  "leave-room": (data: LeaveRoomRequestPayload) => void;
  "destroy-room": (data: DestroyRoomRequestPayload, cb?: (result: SimpleAckPayload) => void) => void;
  "burn-room": (data: BurnRoomRequestPayload, cb?: (result: SimpleAckPayload) => void) => void;
  "extend-room": (data: ExtendRoomRequestPayload, cb?: (result: ExtendRoomAckPayload) => void) => void;
  "lock-room": (data: RoomCodeOnlyPayload, cb?: (result: SimpleAckPayload) => void) => void;
  "unlock-room": (data: RoomCodeOnlyPayload, cb?: (result: SimpleAckPayload) => void) => void;
  "set-knock-mode": (data: SetKnockModeRequestPayload, cb?: (result: SimpleAckPayload) => void) => void;
  "approve-knock": (data: CodeAndPeerPayload, cb?: (result: SimpleAckPayload) => void) => void;
  "deny-knock": (data: CodeAndPeerPayload, cb?: (result: SimpleAckPayload) => void) => void;
  "cancel-knock": (data: RoomCodeOnlyPayload) => void;
  "relay-signal": (data: RelaySignalInPayload) => void;
  "request-screen-share": (data: CodeAndPeerPayload, cb?: (result: RequestScreenShareAckPayload) => void) => void;
  "screen-share-started": (data: CodeAndPeerPayload, cb?: (result: SimpleAckPayload) => void) => void;
  "screen-share-stopped": (data: CodeAndPeerPayload, cb?: (result: SimpleAckPayload) => void) => void;
  "request-relay-only": (data: RoomCodeOnlyPayload, cb?: (result: RequestRelayOnlyAckPayload) => void) => void;
  "respond-relay-only-request": (data: RespondRelayOnlyRequestPayload, cb?: (result: SimpleAckPayload) => void) => void;
}