import { describe, expect, it } from 'vitest';
import { resumePastLiveTrial } from '../src/experiment/flow';
import type { Checkpoint, StagePlan } from '../protocol/types';

const stage: StagePlan = {
  stage: 'encoding',
  trials: [
    { id: 'encoding:0:0', index: 0, wordId: 'a', text: 'میز', domain: 'furniture' },
    { id: 'encoding:0:1', index: 1, wordId: 'b', text: 'کتاب', domain: 'study' },
  ],
};

function checkpoint(trialIndex: number, phase: Checkpoint['phase']): Checkpoint {
  return {
    seq: 4,
    stageIndex: 0,
    trialIndex,
    practiceRound: 0,
    phase,
    shoppingWants: [],
    pendingProductId: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('resume', () => {
  it('advances one trial after an in-flight encoding trial', () => {
    const next = resumePastLiveTrial(checkpoint(0, 'stimulus'), stage);
    expect(next?.trialIndex).toBe(1);
    expect(next?.phase).toBe('stimulus');
    expect(next?.seq).toBe(5);
  });

  it('reaches the stage end only after the last in-flight trial', () => {
    const next = resumePastLiveTrial(checkpoint(1, 'feedback'), stage);
    expect(next?.trialIndex).toBe(2);
    expect(next?.phase).toBe('instruction');
  });

  it('leaves an instruction checkpoint in place', () => {
    expect(resumePastLiveTrial(checkpoint(1, 'instruction'), stage)).toBeNull();
  });
});
