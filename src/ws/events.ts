import type { ErrorCode } from '../errors.js';
import type { PointSystem, RevealPayload, Selection } from '../types.js';

// The full set of Socket.IO event names used on this wire protocol, shared by
// the server (handlers.ts) and its tests — one declaration instead of raw
// string literals repeated (and potentially drifting) across both files.
export const WsEvent = {
  Join: 'join',
  AdminAuth: 'admin-auth',
  SelectSquare: 'select-square',
  EndSession: 'end-session',
  SessionInfo: 'session-info',
  Joined: 'joined',
  AdminAcknowledged: 'admin-acknowledged',
  SelectionAcknowledged: 'selection-acknowledged',
  SessionEnded: 'session-ended',
  Error: 'error',
} as const;
export type WsEvent = (typeof WsEvent)[keyof typeof WsEvent];

// Client -> server. Keying off WsEvent's own values (not fresh string
// literals) means a typo'd event name fails to compile instead of silently
// going unheard.
export interface ClientToServerEvents {
  [WsEvent.Join]: (name: string) => void;
  [WsEvent.AdminAuth]: (adminToken: string) => void;
  [WsEvent.SelectSquare]: (payload: { time: number; resource: number }) => void;
  [WsEvent.EndSession]: (adminToken: string) => void;
}

// Server -> client. The 'error' payload's `error` field is optional: the
// "not identified yet" case (handlers.ts) has no dedicated ErrorCode and
// emits message-only, by design (decision #22a).
// Connection-scoped state Socket.IO attaches to each socket as `socket.data`
// — the built-in slot for exactly this, instead of a hand-rolled closure
// variable. Set by handleJoin/handleAdminAuth, read by handleSelectSquare;
// never trust the client — it's never read from an incoming payload.
export interface SocketData {
  participantId?: string;
}

export interface ServerToClientEvents {
  [WsEvent.SessionInfo]: (payload: {
    sessionId: string;
    pointSystem: PointSystem;
    ended: boolean;
  }) => void;
  [WsEvent.Joined]: (payload: { participantId: string; name: string }) => void;
  [WsEvent.AdminAcknowledged]: (payload: {
    participantId: string;
    name: string;
    selection: Selection | null;
  }) => void;
  [WsEvent.SelectionAcknowledged]: (payload: { time: number; resource: number }) => void;
  [WsEvent.SessionEnded]: (payload: RevealPayload) => void;
  [WsEvent.Error]: (payload: { error?: ErrorCode; message: string }) => void;
}
