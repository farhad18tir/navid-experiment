import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ENCODING_WORDS } from '../protocol/content';
import { buildStimulusPlan, buildTokenDeltas, spatialRunOk } from '../protocol/generate';
import { validateManifest } from '../protocol/manifest';
import { mulberry32 } from '../protocol/rng';
import { dPrimeFromCounts, probit, reverseLikert7 } from '../protocol/scoring';
import { legalDeltas, passedPracticeGate, rewardCountForTokens, tokenBounds } from '../protocol/settings';
import { MAIN_STAGE_ORDER } from '../protocol/types';
import { writeStudyFixture } from './fixture';

describe('protocol generators', () => {
  it('keeps encoding words inside their domains and uses the proposal list', () => {
    expect(ENCODING_WORDS).toHaveLength(16);
    expect(ENCODING_WORDS.map((word) => word.text)).toContain('کوله‌پشتی');
    const manifest = writeStudyFixture(mkdtempSync(path.join(tmpdir(), 'navid-')), ['encoding']);
    for (let seed = 1; seed <= 30; seed += 1) {
      const plan = buildStimulusPlan({
        seed,
        manifest,
        manifestHash: 'hash',
        group: 'scarcity',
        stageNames: ['encoding'],
        gameOrder: null,
        rng: mulberry32(seed),
      });
      const stage = plan.stages[0];
      if (stage?.stage !== 'encoding') throw new Error('missing encoding');
      expect(stage.trials).toHaveLength(16);
      expect(stage.trials.some((trial, index) => index > 0 && trial.domain === stage.trials[index - 1]?.domain)).toBe(false);
    }
  });

  it('keeps the token path inside the group band and independent of accuracy', () => {
    for (const group of ['scarcity', 'control'] as const) {
      const bounds = tokenBounds(group);
      for (let seed = 1; seed <= 40; seed += 1) {
        const deltas = buildTokenDeltas(bounds, 48, mulberry32(seed));
        let balance = bounds.start;
        expect(balance).toBeGreaterThanOrEqual(bounds.min);
        expect(balance).toBeLessThanOrEqual(bounds.max);
        for (const delta of deltas) {
          expect([-1, 0, 1]).toContain(delta);
          expect(legalDeltas(balance, bounds.min, bounds.max)).toContain(delta);
          balance += delta;
          expect(balance).toBeGreaterThanOrEqual(bounds.min);
          expect(balance).toBeLessThanOrEqual(bounds.max);
        }
      }
    }
    expect(rewardCountForTokens(0)).toBe(0);
    expect(rewardCountForTokens(1)).toBe(0);
    expect(rewardCountForTokens(2)).toBe(2);
    expect(rewardCountForTokens(3)).toBe(3);
    expect(rewardCountForTokens(4)).toBeNull();
  });

  it('builds spatial sequences without long runs and balanced switch blocks', () => {
    const manifest = writeStudyFixture(mkdtempSync(path.join(tmpdir(), 'navid-')), ['spatial', 'switch']);
    const plan = buildStimulusPlan({
      seed: 7,
      manifest,
      manifestHash: 'hash',
      group: 'control',
      stageNames: ['spatialPractice', 'spatial', 'switchPractice', 'switch'],
      gameOrder: null,
      rng: mulberry32(7),
    });
    const practice = plan.stages.find((stage) => stage.stage === 'spatialPractice');
    const main = plan.stages.find((stage) => stage.stage === 'spatial');
    const switching = plan.stages.find((stage) => stage.stage === 'switch');
    if (practice?.stage !== 'spatialPractice' || main?.stage !== 'spatial' || switching?.stage !== 'switch') {
      throw new Error('missing spatial or switch plan');
    }
    expect(practice.rounds[0]).toHaveLength(12);
    expect(practice.rounds[0]?.filter((trial) => trial.stimulus === 'heart')).toHaveLength(6);
    expect(spatialRunOk(practice.rounds[0] ?? [])).toBe(true);
    expect(main.trials).toHaveLength(60);
    expect(main.trials.filter((trial) => trial.stimulus === 'flower')).toHaveLength(30);
    expect(spatialRunOk(main.trials)).toBe(true);
    for (const block of switching.blocks) {
      expect(block).toHaveLength(122);
      const analyzed = block.filter((trial) => !trial.excludeFromSwitchCost);
      expect(analyzed.filter((trial) => trial.stimulusType === 'switch')).toHaveLength(60);
      expect(analyzed.filter((trial) => trial.stimulusType === 'repeat')).toHaveLength(60);
      expect(block.slice(0, 2).every((trial) => trial.excludeFromSwitchCost)).toBe(true);
      expect(block.every((trial) => [1, 2, 3, 4, 6, 7, 8, 9].includes(trial.number))).toBe(true);
    }
  });

  it('rejects an incomplete manifest and scores the gate, reversal, and d prime', () => {
    expect(() => validateManifest({ version: 1, products: [], recognitionNewWords: [], recognitionOld: { mode: 'randomPerSession' }, baselineStages: [] }, tmpdir())).toThrow();
    expect(passedPracticeGate(11, 12)).toBe(true);
    expect(passedPracticeGate(10, 12)).toBe(false);
    expect(passedPracticeGate(18, 20)).toBe(true);
    expect(passedPracticeGate(17, 20)).toBe(false);
    expect(reverseLikert7(7)).toBe(1);
    expect(reverseLikert7(1)).toBe(7);
    expect(dPrimeFromCounts(8, 8, 0, 8)).toBeCloseTo(probit(1 - 1 / 16) - probit(1 / 16), 5);
    expect(MAIN_STAGE_ORDER[0]).toBe('encoding');
  });
});
