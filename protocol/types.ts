export const PROTOCOL_VERSION = '2.0.0';

export type GroupName = 'scarcity' | 'control';
export type SessionMode = 'baseline' | 'main';
export type MeasurementPeriod = 'pre' | 'post';
export type SessionStatus = 'inProgress' | 'interrupted' | 'completed';
export type SaveStatus = 'pending' | 'saved' | 'failed';
export type GameOrder = 'count-compare' | 'compare-count';

export const TASK_STAGES = [
  'encoding',
  'shopping',
  'tokenGames',
  'spatial',
  'recognition',
  'emotion',
  'recall',
  'switch',
  'manipulation',
] as const;

export type TaskStage = (typeof TASK_STAGES)[number];

export const PRACTICE_STAGES = ['spatialPractice', 'switchPractice'] as const;
export type PracticeStage = (typeof PRACTICE_STAGES)[number];

export type StageName = TaskStage | PracticeStage;

export const MAIN_STAGE_ORDER: readonly StageName[] = [
  'encoding',
  'shopping',
  'tokenGames',
  'spatialPractice',
  'spatial',
  'recognition',
  'emotion',
  'recall',
  'switchPractice',
  'switch',
  'manipulation',
];

export interface WordStimulus {
  id: string;
  text: string;
  domain: string;
}

export interface ProductStimulus {
  id: string;
  nameFa: string;
  imageSrc: string;
  isPractice: boolean;
}

export type RecognitionOldRule =
  | { mode: 'fixed'; words: string[] }
  | { mode: 'randomPerSession' };

export interface StimulusManifest {
  version: 1;
  products: ProductStimulus[];
  recognitionNewWords: string[];
  recognitionOld: RecognitionOldRule;
  baselineStages: string[];
}

export interface Dot {
  x: number;
  y: number;
}

export interface EncodingTrial {
  id: string;
  index: number;
  wordId: string;
  text: string;
  domain: string;
}

export interface ShoppingTrial {
  id: string;
  index: number;
  productId: string;
  nameFa: string;
  imageSrc: string;
  practice: boolean;
  mainOrdinal: number | null;
}

export interface CountTrial {
  id: string;
  index: number;
  gameType: 'count';
  count: number;
  correctKey: 'f' | 'j';
  dots: Dot[];
  tokenDelta: -1 | 0 | 1;
}

export interface CompareTrial {
  id: string;
  index: number;
  gameType: 'compare';
  left: number;
  right: number;
  difference: number;
  correctKey: 'f' | 'j';
  leftDots: Dot[];
  rightDots: Dot[];
  tokenDelta: -1 | 0 | 1;
}

export type TokenTrial = CountTrial | CompareTrial;

export interface SpatialTrial {
  id: string;
  index: number;
  stimulus: 'heart' | 'flower';
  side: 'left' | 'right';
  stimulusType: 'congruent' | 'incongruent';
  correctKey: 'f' | 'j';
}

export interface RecognitionTrial {
  id: string;
  index: number;
  wordId: string;
  text: string;
  wordType: 'old' | 'new';
  correctKey: 'f' | 'j';
}

export interface EmotionTrial {
  id: string;
  index: number;
  itemId: string;
  text: string;
  valence: 'positive' | 'negative';
}

export interface SwitchTrial {
  id: string;
  index: number;
  blockIndex: number;
  task: 'magnitude' | 'parity';
  number: number;
  cue: string;
  cueColor: 'red' | 'blue';
  correctKey: 'f' | 'j';
  stimulusType: 'start' | 'repeat' | 'switch';
  excludeFromSwitchCost: boolean;
  blankBeforeCueMs: number;
  blankBeforeTargetMs: number;
}

export interface ChoiceOption {
  id: string;
  label: string;
  allowsText: boolean;
}

export interface ChoiceQuestion {
  id: string;
  prompt: string;
  options: ChoiceOption[];
}

export interface LikertItem {
  id: string;
  text: string;
  reverse: boolean;
}

export type StagePlan =
  | { stage: 'encoding'; trials: EncodingTrial[] }
  | { stage: 'shopping'; trials: ShoppingTrial[] }
  | { stage: 'tokenGames'; gameOrder: GameOrder; trials: TokenTrial[] }
  | { stage: 'spatialPractice'; rounds: SpatialTrial[][] }
  | { stage: 'spatial'; trials: SpatialTrial[] }
  | { stage: 'recognition'; trials: RecognitionTrial[] }
  | { stage: 'emotion'; trials: EmotionTrial[] }
  | { stage: 'recall'; form: GroupName; questions: ChoiceQuestion[] }
  | { stage: 'switchPractice'; rounds: SwitchTrial[][] }
  | { stage: 'switch'; blocks: SwitchTrial[][] }
  | { stage: 'manipulation'; items: LikertItem[] };

export interface StimulusPlan {
  seed: number;
  manifestHash: string;
  encodingRestMs: number;
  gameOrder: GameOrder | null;
  initialTokens: number | null;
  tokenDeltas: Array<-1 | 0 | 1>;
  stages: StagePlan[];
}

export interface ProtocolSettings {
  protocolVersion: string;
  tokenBounds: {
    scarcity: { min: 0; max: 2; start: 1 };
    control: { min: 1; max: 3; start: 3 };
  };
  tokenStep: 'uniform-legal-delta';
  tokenSource: 'programmed-random';
  rewardCountByFinalTokens: { '0': 0; '1': 0; '2': 2; '3': 3 };
  stage4Exclusion: { minRtMs: 150; sdAboveMean: 3; maxOmissionRate: 0.2 };
  countRanges: { low: [8, 12]; high: [13, 17] };
  compareDifference: [2, 3, 4, 5];
  cues: { magnitude: 'بزرگی'; parity: 'زوجیت' };
  practiceGate: 0.9;
  educationLevels: { code: number; label: string }[];
}

export type RunPhase =
  | 'instruction'
  | 'fixation'
  | 'blank'
  | 'stimulus'
  | 'cue'
  | 'pretarget'
  | 'feedback'
  | 'isi'
  | 'rest'
  | 'midpoint'
  | 'remove-want'
  | 'shopping-review'
  | 'practice-feedback'
  | 'done';

export interface Checkpoint {
  seq: number;
  stageIndex: number;
  trialIndex: number;
  practiceRound: number;
  phase: RunPhase;
  shoppingWants: string[];
  pendingProductId: string | null;
  updatedAt: string;
}

export type RecognitionClass = 'hit' | 'miss' | 'falseAlarm' | 'correctRejection' | 'omission';

export interface SessionScores {
  inhibitionCost: number | null;
  inhibitionExcluded: boolean;
  inhibitionExclusionReason: string | null;
  dPrime: number | null;
  recognitionMeanCorrectRt: number | null;
  switchCost: number | null;
  panasPositive: number | null;
  panasNegative: number | null;
  manipulationMean: number | null;
  detail: Record<string, unknown>;
}
