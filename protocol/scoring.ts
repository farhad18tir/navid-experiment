import type { RecognitionClass, SessionScores } from './types';

export interface ScoreTrial {
  stage: string;
  response: string | null;
  responseKind: string;
  correct: boolean | null;
  rtMs: number | null;
  stimulusType?: string;
  valence?: string;
  recognitionClass?: RecognitionClass | null;
  excludeFromSwitchCost?: boolean;
}

export interface ScoreQuestionnaire {
  instrument: string;
  itemId: string;
  rawValue: string | null;
  reversedValue: number | null;
  valence?: 'positive' | 'negative';
  reverse?: boolean;
}

const PROBIT_A = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239] as const;
const PROBIT_B = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1] as const;
const PROBIT_C = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783] as const;
const PROBIT_D = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416] as const;

export function probit(p: number): number {
  if (p <= 0) return -3.5;
  if (p >= 1) return 3.5;
  const q = p - 0.5;
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    return (
      (q * (((((PROBIT_A[0] * r + PROBIT_A[1]) * r + PROBIT_A[2]) * r + PROBIT_A[3]) * r + PROBIT_A[4]) * r + PROBIT_A[5])) /
      (((((PROBIT_B[0] * r + PROBIT_B[1]) * r + PROBIT_B[2]) * r + PROBIT_B[3]) * r + PROBIT_B[4]) * r + 1)
    );
  }
  const tail = Math.sqrt(-Math.log(p < 0.5 ? p : 1 - p));
  let x =
    (((((PROBIT_C[0] * tail + PROBIT_C[1]) * tail + PROBIT_C[2]) * tail + PROBIT_C[3]) * tail + PROBIT_C[4]) * tail + PROBIT_C[5]) /
    ((((PROBIT_D[0] * tail + PROBIT_D[1]) * tail + PROBIT_D[2]) * tail + PROBIT_D[3]) * tail + 1);
  if (p < 0.5) x = -x;
  return x;
}

export function adjustRate(count: number, total: number): number {
  if (total === 0) return 0.5;
  if (count === 0) return 1 / (2 * total);
  if (count === total) return 1 - 1 / (2 * total);
  return count / total;
}

export function dPrimeFromCounts(hits: number, oldTotal: number, falseAlarms: number, newTotal: number): number {
  return probit(adjustRate(hits, oldTotal)) - probit(adjustRate(falseAlarms, newTotal));
}

export function reverseLikert7(raw: number): number {
  return 8 - raw;
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sd(values: number[]): number {
  if (values.length === 0) return 0;
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function summarizeSession(trials: ScoreTrial[], questionnaires: ScoreQuestionnaire[]): SessionScores {
  const spatial = trials.filter((trial) => trial.stage === 'spatial' && trial.responseKind !== 'interrupted');
  const omissions = spatial.filter((trial) => trial.responseKind === 'omission').length;
  const omissionRate = spatial.length === 0 ? 0 : omissions / spatial.length;
  const responded = spatial.filter((trial) => trial.rtMs !== null).map((trial) => trial.rtMs as number);
  const center = mean(responded) ?? 0;
  const spread = sd(responded);
  const rtExcluded = new Set<ScoreTrial>();
  for (const trial of spatial) {
    if (trial.rtMs === null) continue;
    if (trial.rtMs < 150 || (spread > 0 && trial.rtMs > center + 3 * spread)) rtExcluded.add(trial);
  }
  let inhibitionCost: number | null = null;
  let inhibitionExcluded = false;
  let inhibitionExclusionReason: string | null = null;
  if (spatial.length === 0) {
    inhibitionCost = null;
  } else if (omissionRate > 0.2) {
    inhibitionExcluded = true;
    inhibitionExclusionReason = 'omissions-over-20-percent';
  } else {
    const usable = spatial.filter((trial) => trial.correct === true && trial.rtMs !== null && !rtExcluded.has(trial));
    const congruent = mean(usable.filter((trial) => trial.stimulusType === 'congruent').map((trial) => trial.rtMs as number));
    const incongruent = mean(usable.filter((trial) => trial.stimulusType === 'incongruent').map((trial) => trial.rtMs as number));
    inhibitionCost = congruent === null || incongruent === null ? null : incongruent - congruent;
    if (inhibitionCost === null) {
      inhibitionExcluded = true;
      inhibitionExclusionReason = 'no-correct-trials-after-rt-filter';
    }
  }

  const recognition = trials.filter((trial) => trial.stage === 'recognition' && trial.responseKind !== 'interrupted');
  const oldTrials = recognition.filter((trial) => trial.stimulusType === 'old');
  const newTrials = recognition.filter((trial) => trial.stimulusType === 'new');
  const hits = oldTrials.filter((trial) => trial.recognitionClass === 'hit').length;
  const falseAlarms = newTrials.filter((trial) => trial.recognitionClass === 'falseAlarm').length;
  const dPrime = recognition.length === 0 ? null : dPrimeFromCounts(hits, oldTrials.length, falseAlarms, newTrials.length);
  const recognitionMeanCorrectRt = mean(
    recognition.filter((trial) => trial.correct === true && trial.rtMs !== null).map((trial) => trial.rtMs as number),
  );

  const switching = trials.filter(
    (trial) => trial.stage === 'switch' && trial.correct === true && trial.rtMs !== null && trial.excludeFromSwitchCost !== true && trial.responseKind === 'response',
  );
  const repeatRt = mean(switching.filter((trial) => trial.stimulusType === 'repeat').map((trial) => trial.rtMs as number));
  const switchRt = mean(switching.filter((trial) => trial.stimulusType === 'switch').map((trial) => trial.rtMs as number));
  const switchCost = repeatRt === null || switchRt === null ? null : switchRt - repeatRt;

  const panas = questionnaires.filter((item) => item.instrument === 'panas');
  const positive = panas.filter((item) => item.valence === 'positive' && item.rawValue !== null);
  const negative = panas.filter((item) => item.valence === 'negative' && item.rawValue !== null);
  const panasPositive = positive.length === 5 ? positive.reduce((sum, item) => sum + Number(item.rawValue), 0) : null;
  const panasNegative = negative.length === 5 ? negative.reduce((sum, item) => sum + Number(item.rawValue), 0) : null;

  const manipulation = questionnaires.filter((item) => item.instrument === 'manipulation');
  const scored = manipulation
    .map((item) => {
      const raw = item.rawValue === null ? null : Number(item.rawValue);
      if (raw === null || Number.isNaN(raw)) return null;
      return item.reverse ? reverseLikert7(raw) : raw;
    })
    .filter((value): value is number => value !== null);
  const manipulationMean = manipulation.length === 4 && scored.length === 4 ? mean(scored) : null;

  return {
    inhibitionCost,
    inhibitionExcluded,
    inhibitionExclusionReason,
    dPrime,
    recognitionMeanCorrectRt,
    switchCost,
    panasPositive,
    panasNegative,
    manipulationMean,
    detail: {
      spatialTrials: spatial.length,
      spatialOmissions: omissions,
      spatialRtExcluded: rtExcluded.size,
      recognition: {
        hits,
        misses: oldTrials.filter((trial) => trial.recognitionClass === 'miss').length,
        falseAlarms,
        correctRejections: newTrials.filter((trial) => trial.recognitionClass === 'correctRejection').length,
        oldOmissions: oldTrials.filter((trial) => trial.recognitionClass === 'omission').length,
        newOmissions: newTrials.filter((trial) => trial.recognitionClass === 'omission').length,
      },
    },
  };
}

export function recognitionClass(wordType: 'old' | 'new', response: 'f' | 'j' | null): RecognitionClass {
  if (!response) return 'omission';
  if (wordType === 'old') return response === 'f' ? 'hit' : 'miss';
  return response === 'f' ? 'falseAlarm' : 'correctRejection';
}
