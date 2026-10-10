import { EMOTION_ITEMS, ENCODING_WORDS, MANIPULATION_ITEMS, findEncodingWord, recallQuestions } from './content';
import { integer, pick, shuffle, type Rng } from './rng';
import { legalDeltas, tokenBounds } from './settings';
import type {
  CompareTrial,
  CountTrial,
  Dot,
  EncodingTrial,
  GameOrder,
  GroupName,
  RecognitionTrial,
  ShoppingTrial,
  SpatialTrial,
  StageName,
  StagePlan,
  StimulusManifest,
  StimulusPlan,
  SwitchTrial,
  TokenTrial,
} from './types';

const TOKEN_TRIALS = 48;
const SWITCH_BLOCK_LENGTH = 122;
const SWITCH_LEAD_IN = 2;

export function buildStimulusPlan(input: {
  seed: number;
  manifest: StimulusManifest;
  manifestHash: string;
  group: GroupName;
  stageNames: readonly StageName[];
  gameOrder: GameOrder | null;
  rng: Rng;
}): StimulusPlan {
  const bounds = tokenBounds(input.group);
  const includesTokens = input.stageNames.includes('tokenGames');
  const tokenDeltas = includesTokens ? buildTokenDeltas(bounds, TOKEN_TRIALS, input.rng) : [];
  const gameOrder = includesTokens ? input.gameOrder ?? 'count-compare' : null;
  const stages = input.stageNames.map((stage) =>
    buildStage({
      stage,
      manifest: input.manifest,
      group: input.group,
      rng: input.rng,
      gameOrder: gameOrder ?? 'count-compare',
      tokenDeltas,
    }),
  );
  return {
    seed: input.seed,
    manifestHash: input.manifestHash,
    encodingRestMs: integer(input.rng, 15_000, 20_000),
    gameOrder,
    initialTokens: includesTokens ? bounds.start : null,
    tokenDeltas,
    stages,
  };
}

export function buildTokenDeltas(
  bounds: { min: number; max: number; start: number },
  steps: number,
  rng: Rng,
): Array<-1 | 0 | 1> {
  const deltas: Array<-1 | 0 | 1> = [];
  let balance = bounds.start;
  for (let step = 0; step < steps; step += 1) {
    const delta = pick(rng, legalDeltas(balance, bounds.min, bounds.max));
    balance += delta;
    deltas.push(delta);
  }
  return deltas;
}

export function appendPracticeRound(
  plan: StimulusPlan,
  stage: 'spatialPractice' | 'switchPractice',
  rng: Rng,
): StimulusPlan {
  const stages = plan.stages.map((item) => {
    if (item.stage !== stage) return item;
    if (item.stage === 'spatialPractice') {
      const round = item.rounds.length;
      return { ...item, rounds: [...item.rounds, buildSpatialTrials(rng, 6, 6, 'spatialPractice', round)] };
    }
    const round = item.rounds.length;
    return { ...item, rounds: [...item.rounds, buildSwitchTrials(rng, 20, 0, 'switchPractice', 0, round)] };
  });
  return { ...plan, stages };
}

function buildStage(input: {
  stage: StageName;
  manifest: StimulusManifest;
  group: GroupName;
  rng: Rng;
  gameOrder: GameOrder;
  tokenDeltas: Array<-1 | 0 | 1>;
}): StagePlan {
  switch (input.stage) {
    case 'encoding':
      return { stage: 'encoding', trials: buildEncoding(input.rng) };
    case 'shopping':
      return { stage: 'shopping', trials: buildShopping(input.manifest, input.rng) };
    case 'tokenGames':
      return {
        stage: 'tokenGames',
        gameOrder: input.gameOrder,
        trials: buildTokenTrials(input.rng, input.gameOrder, input.tokenDeltas),
      };
    case 'spatialPractice':
      return { stage: 'spatialPractice', rounds: [buildSpatialTrials(input.rng, 6, 6, 'spatialPractice', 0)] };
    case 'spatial':
      return { stage: 'spatial', trials: buildSpatialTrials(input.rng, 30, 30, 'spatial', 0) };
    case 'recognition':
      return { stage: 'recognition', trials: buildRecognition(input.manifest, input.rng) };
    case 'emotion':
      return {
        stage: 'emotion',
        trials: shuffle(EMOTION_ITEMS, input.rng).map((item, index) => ({
          id: `emotion:0:${index}`,
          index,
          itemId: item.id,
          text: item.text,
          valence: item.valence,
        })),
      };
    case 'recall':
      return { stage: 'recall', form: input.group, questions: recallQuestions(input.group) };
    case 'switchPractice':
      return { stage: 'switchPractice', rounds: [buildSwitchTrials(input.rng, 20, 0, 'switchPractice', 0, 0)] };
    case 'switch':
      return {
        stage: 'switch',
        blocks: [0, 1].map((block) => buildSwitchTrials(input.rng, SWITCH_BLOCK_LENGTH, SWITCH_LEAD_IN, 'switch', block, 0)),
      };
    case 'manipulation':
      return { stage: 'manipulation', items: MANIPULATION_ITEMS.map((item) => ({ ...item })) };
    default: {
      const unknown: never = input.stage;
      throw new Error(`Unknown stage ${String(unknown)}`);
    }
  }
}

function buildEncoding(rng: Rng): EncodingTrial[] {
  for (let attempt = 0; attempt < 2000; attempt += 1) {
    const ordered = shuffle(ENCODING_WORDS, rng);
    const adjacent = ordered.some((word, index) => index > 0 && word.domain === ordered[index - 1]?.domain);
    if (!adjacent) {
      return ordered.map((word, index) => ({
        id: `encoding:0:${index}`,
        index,
        wordId: word.id,
        text: word.text,
        domain: word.domain,
      }));
    }
  }
  throw new Error('Could not build an encoding order without adjacent domains');
}

function buildShopping(manifest: StimulusManifest, rng: Rng): ShoppingTrial[] {
  const practice = shuffle(manifest.products.filter((item) => item.isPractice), rng);
  const main = shuffle(manifest.products.filter((item) => !item.isPractice), rng);
  return [...practice, ...main].map((product, index) => ({
    id: `shopping:0:${index}`,
    index,
    productId: product.id,
    nameFa: product.nameFa,
    imageSrc: product.imageSrc,
    practice: product.isPractice,
    mainOrdinal: product.isPractice ? null : index - practice.length,
  }));
}

function buildTokenTrials(rng: Rng, order: GameOrder, deltas: Array<-1 | 0 | 1>): TokenTrial[] {
  const counts = buildCountTrials(rng);
  const compares = buildCompareTrials(rng);
  const ordered = order === 'count-compare' ? [...counts, ...compares] : [...compares, ...counts];
  return ordered.map((trial, index) => ({
    ...trial,
    id: `tokenGames:0:${index}`,
    index,
    tokenDelta: deltas[index] ?? 0,
  }));
}

function buildCountTrials(rng: Rng): Omit<CountTrial, 'id' | 'index' | 'tokenDelta'>[] {
  const low = [8, 9, 10, 11, 12, 8, 9, 10, 11, 12, 8, 12];
  const high = [13, 14, 15, 16, 17, 13, 14, 15, 16, 17, 13, 17];
  return shuffle([...low, ...high], rng).map((count) => ({
    gameType: 'count' as const,
    count,
    correctKey: count > 12 ? ('f' as const) : ('j' as const),
    dots: placeDots(count, 600, 400, rng),
  }));
}

function buildCompareTrials(rng: Rng): Omit<CompareTrial, 'id' | 'index' | 'tokenDelta'>[] {
  const drafts: Array<{ difference: number; larger: 'left' | 'right' }> = [];
  for (const difference of [2, 3, 4, 5]) {
    for (let copy = 0; copy < 3; copy += 1) {
      drafts.push({ difference, larger: 'left' }, { difference, larger: 'right' });
    }
  }
  return shuffle(drafts, rng).map((draft) => {
    const smaller = integer(rng, 6, 12);
    const bigger = smaller + draft.difference;
    const left = draft.larger === 'left' ? bigger : smaller;
    const right = draft.larger === 'right' ? bigger : smaller;
    return {
      gameType: 'compare' as const,
      left,
      right,
      difference: draft.difference,
      correctKey: left > right ? ('f' as const) : ('j' as const),
      leftDots: placeDots(left, 300, 300, rng),
      rightDots: placeDots(right, 300, 300, rng),
    };
  });
}

export function placeDots(count: number, width: number, height: number, rng: Rng): Dot[] {
  const radius = 8;
  const minDist = 18;
  const dots: Dot[] = [];
  let guard = 0;
  while (dots.length < count && guard < 8000) {
    guard += 1;
    const dot = {
      x: radius + rng() * (width - radius * 2),
      y: radius + rng() * (height - radius * 2),
    };
    const clear = dots.every((other) => (other.x - dot.x) ** 2 + (other.y - dot.y) ** 2 >= minDist ** 2);
    if (clear) dots.push(dot);
  }
  if (dots.length < count) {
    const cols = Math.ceil(Math.sqrt(count));
    for (let i = dots.length; i < count; i += 1) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      dots.push({
        x: ((col + 0.5) * width) / cols,
        y: ((row + 0.5) * height) / Math.ceil(count / cols),
      });
    }
  }
  return dots;
}

export function buildSpatialTrials(
  rng: Rng,
  hearts: number,
  flowers: number,
  stage: 'spatial' | 'spatialPractice',
  round: number,
): SpatialTrial[] {
  const pool: Array<Pick<SpatialTrial, 'stimulus' | 'side'>> = [];
  for (let i = 0; i < hearts / 2; i += 1) {
    pool.push({ stimulus: 'heart', side: 'left' }, { stimulus: 'heart', side: 'right' });
  }
  for (let i = 0; i < flowers / 2; i += 1) {
    pool.push({ stimulus: 'flower', side: 'left' }, { stimulus: 'flower', side: 'right' });
  }
  for (let attempt = 0; attempt < 5000; attempt += 1) {
    const shuffled = shuffle(pool, rng);
    if (spatialRunOk(shuffled)) {
      return shuffled.map((item, index) => ({
        id: `${stage}:${round}:${index}`,
        index,
        stimulus: item.stimulus,
        side: item.side,
        stimulusType: item.stimulus === 'heart' ? 'congruent' : 'incongruent',
        correctKey: spatialKey(item.stimulus, item.side),
      }));
    }
  }
  throw new Error(`Could not build a ${stage} sequence`);
}

export function spatialRunOk(trials: readonly { stimulus: string; side: string }[]): boolean {
  let shapeRun = 1;
  let sideRun = 1;
  for (let i = 1; i < trials.length; i += 1) {
    const prev = trials[i - 1];
    const current = trials[i];
    if (!prev || !current) return false;
    shapeRun = current.stimulus === prev.stimulus ? shapeRun + 1 : 1;
    sideRun = current.side === prev.side ? sideRun + 1 : 1;
    if (shapeRun > 3 || sideRun > 3) return false;
  }
  return true;
}

function spatialKey(stimulus: 'heart' | 'flower', side: 'left' | 'right'): 'f' | 'j' {
  const same = side === 'left' ? 'f' : 'j';
  const opposite = side === 'left' ? 'j' : 'f';
  return stimulus === 'heart' ? same : opposite;
}

function buildRecognition(manifest: StimulusManifest, rng: Rng): RecognitionTrial[] {
  const oldWords =
    manifest.recognitionOld.mode === 'fixed'
      ? manifest.recognitionOld.words.map((text) => {
          const found = findEncodingWord(text);
          if (!found) throw new Error(`Old word is not in the encoding list: ${text}`);
          return found;
        })
      : shuffle([...ENCODING_WORDS], rng).slice(0, 8);
  const items = [
    ...oldWords.map((word) => ({
      wordId: word.id,
      text: word.text,
      wordType: 'old' as const,
      correctKey: 'f' as const,
    })),
    ...manifest.recognitionNewWords.map((text, index) => ({
      wordId: `new-${index}`,
      text,
      wordType: 'new' as const,
      correctKey: 'j' as const,
    })),
  ];
  return shuffle(items, rng).map((item, index) => ({ id: `recognition:0:${index}`, index, ...item }));
}

export function buildSwitchTrials(
  rng: Rng,
  count: number,
  leadIn: number,
  stage: 'switch' | 'switchPractice',
  block: number,
  round: number,
): SwitchTrial[] {
  const analyzed = count - leadIn;
  const switchCount = Math.floor(analyzed / 2);
  const repeatCount = analyzed - switchCount;
  const analyzedTransitions = shuffle(
    [...Array<'switch'>(switchCount).fill('switch'), ...Array<'repeat'>(repeatCount).fill('repeat')],
    rng,
  );
  const leadTransitions: Array<'switch' | 'repeat'> = [];
  for (let i = 0; i < leadIn; i += 1) {
    leadTransitions.push(rng() < 0.5 ? 'switch' : 'repeat');
  }
  const transitions = [...leadTransitions, ...analyzedTransitions];
  const numbers = balancedNumbers(count, rng);
  let task: 'magnitude' | 'parity' = rng() < 0.5 ? 'magnitude' : 'parity';
  const trials: SwitchTrial[] = [];
  for (let index = 0; index < count; index += 1) {
    if (index > 0 && transitions[index - 1] === 'switch') {
      task = task === 'magnitude' ? 'parity' : 'magnitude';
    }
    const previous = trials[index - 1];
    const number = numbers[index] ?? 1;
    trials.push({
      id: `${stage}:${block}:${round}:${index}`,
      index,
      blockIndex: block,
      task,
      number,
      cue: task === 'magnitude' ? 'بزرگی' : 'زوجیت',
      cueColor: task === 'magnitude' ? 'red' : 'blue',
      correctKey: task === 'magnitude' ? (number < 5 ? 'f' : 'j') : number % 2 !== 0 ? 'f' : 'j',
      stimulusType: index === 0 ? 'start' : task === previous?.task ? 'repeat' : 'switch',
      excludeFromSwitchCost: index < leadIn,
      blankBeforeCueMs: integer(rng, 500, 800),
      blankBeforeTargetMs: integer(rng, 500, 800),
    });
  }
  return trials;
}

function balancedNumbers(count: number, rng: Rng): number[] {
  const base = [1, 2, 3, 4, 6, 7, 8, 9];
  const out: number[] = [];
  while (out.length + base.length <= count) out.push(...base);
  while (out.length < count) out.push(pick(rng, base));
  return shuffle(out, rng);
}

export type AnyTrial = EncodingTrial | ShoppingTrial | TokenTrial | SpatialTrial | RecognitionTrial | SwitchTrial;

export function findPlanTrial(plan: StimulusPlan, trialId: string): { stage: StageName; trial: AnyTrial } | null {
  for (const stage of plan.stages) {
    if ('trials' in stage && stage.stage !== 'emotion') {
      const trial = stage.trials.find((item) => item.id === trialId);
      if (trial) return { stage: stage.stage, trial };
    } else if (stage.stage === 'spatialPractice' || stage.stage === 'switchPractice') {
      for (const round of stage.rounds) {
        const trial = round.find((item) => item.id === trialId);
        if (trial) return { stage: stage.stage, trial };
      }
    } else if (stage.stage === 'switch') {
      for (const block of stage.blocks) {
        const trial = block.find((item) => item.id === trialId);
        if (trial) return { stage: stage.stage, trial };
      }
    }
  }
  return null;
}
