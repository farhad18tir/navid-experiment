import { EDUCATION_LEVELS } from './content';
import { PROTOCOL_VERSION, type GroupName, type ProtocolSettings } from './types';

export const PROTOCOL_SETTINGS: ProtocolSettings = {
  protocolVersion: PROTOCOL_VERSION,
  tokenBounds: {
    scarcity: { min: 0, max: 2, start: 1 },
    control: { min: 1, max: 3, start: 3 },
  },
  tokenStep: 'uniform-legal-delta',
  tokenSource: 'programmed-random',
  rewardCountByFinalTokens: { '0': 0, '1': 0, '2': 2, '3': 3 },
  stage4Exclusion: { minRtMs: 150, sdAboveMean: 3, maxOmissionRate: 0.2 },
  countRanges: { low: [8, 12], high: [13, 17] },
  compareDifference: [2, 3, 4, 5],
  cues: { magnitude: 'بزرگی', parity: 'زوجیت' },
  practiceGate: 0.9,
  educationLevels: EDUCATION_LEVELS.map((level) => ({ code: level.code, label: level.label })),
};

export function tokenBounds(group: GroupName): { min: number; max: number; start: number } {
  return PROTOCOL_SETTINGS.tokenBounds[group];
}

export function rewardCountForTokens(tokens: number): number | null {
  if (tokens === 0 || tokens === 1) return 0;
  if (tokens === 2) return 2;
  if (tokens === 3) return 3;
  return null;
}

export function passedPracticeGate(correct: number, total: number): boolean {
  if (total <= 0) return false;
  return correct / total >= PROTOCOL_SETTINGS.practiceGate;
}

export function legalDeltas(balance: number, min: number, max: number): Array<-1 | 0 | 1> {
  const deltas: Array<-1 | 0 | 1> = [];
  for (const delta of [-1, 0, 1] as const) {
    const next = balance + delta;
    if (next >= min && next <= max) deltas.push(delta);
  }
  return deltas;
}

export function balanceAfter(start: number, deltas: readonly number[], count: number): number {
  let balance = start;
  for (let i = 0; i < count; i += 1) {
    balance += deltas[i] ?? 0;
  }
  return balance;
}
