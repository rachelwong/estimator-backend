export const PointSystemType = {
  Numerical: 'numerical',
  Fibonacci: 'fibonacci',
} as const;

export type PointSystemType = (typeof PointSystemType)[keyof typeof PointSystemType];

export interface PointSystem {
  type: PointSystemType;
  sliderMax: number;
  axisValues: number[];
}

export interface Selection {
  time: number;
  resource: number;
}

export interface Participant {
  id: string;
  name: string;
  selection: Selection | null;
  isAdmin: boolean;
}

export interface SessionState {
  id: string;
  adminToken: string;
  adminParticipantId: string;
  pointSystem: PointSystem;
  participants: Map<string, Participant>;
  ended: boolean;
  createdAt: Date;
  // When somebody last did something to this session — created it, joined it,
  // voted in it, or opened it. It's what an open session's TTL counts from; an
  // ended session counts from endedAt instead.
  lastActivityAt: Date;
  endedAt: Date | null;
}

export interface RevealSquare {
  time: number;
  resource: number;
  names: string[];
}

export interface RevealPayload {
  squares: RevealSquare[];
  abstained: string[];
}
