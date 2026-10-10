import type { Checkpoint } from './types';

export type ClientEvent =
  | {
      kind: 'checkpoint';
      clientEventId: string;
      checkpoint: Checkpoint;
    }
  | {
      kind: 'open-stage';
      clientEventId: string;
      stage: string;
      practiceRound: number;
      startedAt: string;
    }
  | {
      kind: 'trial';
      clientEventId: string;
      trialId: string;
      onsetAt: string | null;
      offsetAt: string | null;
      response: string | null;
      responseKind: 'response' | 'omission' | 'encoding';
      rtMs: number | null;
    }
  | {
      kind: 'interrupt';
      clientEventId: string;
      trialId: string;
      checkpoint: Checkpoint;
    }
  | {
      kind: 'questionnaire';
      clientEventId: string;
      instrument: 'panas' | 'recall' | 'manipulation';
      itemId: string;
      rawValue: string | null;
      otherText: string | null;
      rtMs: number | null;
    }
  | {
      kind: 'shopping-final';
      clientEventId: string;
      productIds: string[];
    }
  | {
      kind: 'close-stage';
      clientEventId: string;
      stage: string;
      practiceRound: number;
    }
  | {
      kind: 'close-practice';
      clientEventId: string;
      stage: 'spatialPractice' | 'switchPractice';
      practiceRound: number;
    };

export function isClientEvent(value: unknown): value is ClientEvent {
  if (!value || typeof value !== 'object') return false;
  const row = value as { kind?: unknown; clientEventId?: unknown };
  return typeof row.kind === 'string' && typeof row.clientEventId === 'string' && row.clientEventId.length > 0;
}
