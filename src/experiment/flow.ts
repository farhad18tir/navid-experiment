import { balanceAfter } from '../../protocol/settings';
import type { Checkpoint, RunPhase, StageName, StagePlan, StimulusPlan } from '../../protocol/types';

export interface Runnable {
  id: string;
}

export function listTrials(stage: StagePlan, round: number): Runnable[] {
  switch (stage.stage) {
    case 'spatialPractice':
    case 'switchPractice':
      return stage.rounds[round] ?? [];
    case 'switch':
      return stage.blocks[round] ?? [];
    case 'recall':
    case 'manipulation':
      return [];
    default:
      return stage.trials;
  }
}

export function itemCount(stage: StagePlan, round: number): number {
  if (stage.stage === 'recall') return stage.questions.length;
  if (stage.stage === 'manipulation') return stage.items.length;
  return listTrials(stage, round).length;
}

export function openingPhase(stage: StagePlan): RunPhase {
  if (stage.stage === 'encoding' || stage.stage === 'tokenGames' || stage.stage === 'emotion' || stage.stage === 'manipulation' || stage.stage === 'recall') {
    return 'stimulus';
  }
  return 'fixation';
}

export function restMs(stage: StageName, plan: StimulusPlan): number | null {
  if (stage === 'encoding') return plan.encodingRestMs;
  if (stage === 'shopping' || stage === 'recognition' || stage === 'emotion') return 30_000;
  if (stage === 'tokenGames' || stage === 'spatial') return 5_000;
  return null;
}

export function tokenBalance(plan: StimulusPlan, appliedTrials: number): number {
  return balanceAfter(plan.initialTokens ?? 0, plan.tokenDeltas, appliedTrials);
}

export function tokenBand(initialTokens: number): { min: number; max: number } {
  return initialTokens === 1 ? { min: 0, max: 2 } : { min: 1, max: 3 };
}

const LIVE_PHASES = new Set(['stimulus', 'feedback', 'cue', 'pretarget']);

export function resumePastLiveTrial(checkpoint: Checkpoint, stage: StagePlan): Checkpoint | null {
  if (!LIVE_PHASES.has(checkpoint.phase)) return null;
  const count = itemCount(stage, checkpoint.practiceRound);
  if (!listTrials(stage, checkpoint.practiceRound)[checkpoint.trialIndex]) return null;
  const nextIndex = checkpoint.trialIndex + 1;
  if (nextIndex >= count) return bump(checkpoint, { trialIndex: count, phase: 'instruction' });
  return bump(checkpoint, { trialIndex: nextIndex, phase: openingPhase(stage) });
}

export function bump(checkpoint: Checkpoint, patch: Partial<Checkpoint>): Checkpoint {
  return {
    ...checkpoint,
    ...patch,
    seq: checkpoint.seq + 1,
    updatedAt: new Date().toISOString(),
  };
}

export function instructionFor(stage: StageName, blockNote: string | null): string {
  const notes: Record<StageName, string> = {
    encoding: 'به صفحه نگاه کنید و واژه‌ها را تا حد امکان در ذهن خود نگه دارید. ممکن است بعداً دربارهٔ آن‌ها سؤال شود.',
    shopping:
      'در این بخش بیست تصویر از خوراکی‌ها و کالاهای روزمره نشان داده می‌شود. ده مورد را که بیشتر دوست دارید انتخاب کنید. پاسخ درست یا غلطی وجود ندارد. سه تصویر اول فقط تمرین است.\n\nF یعنی می‌خواهم و J یعنی نمی‌خواهم.',
    tokenGames:
      'در این بازی موجودی توکن شما تغییر می‌کند. اگر در پایان صفر یا یک توکن داشته باشید، هیچ کالایی نمی‌گیرید. با دو توکن، دو کالا و با سه توکن، سه کالا از انتخاب‌های خودتان در نظر گرفته می‌شود.\n\nدر بازی شمارش، اگر تعداد نقطه‌ها بیشتر از ۱۲ است F و اگر ۱۲ یا کمتر است J را بزنید. در بازی مقایسه، F یعنی سمت چپ بیشتر است و J یعنی سمت راست.',
    spatialPractice: 'تمرین: اگر قلب دیدید، کلید همان سمت را بزنید. اگر گل دیدید، کلید سمت مخالف را بزنید. قلب چپ = F، قلب راست = J، گل چپ = J، گل راست = F.',
    spatial: 'قانون همان تمرین است. قلب یعنی همان سمت و گل یعنی سمت مخالف. این بار بازخورد هر پاسخ نشان داده نمی‌شود.',
    recognition: 'آیا این واژه را در ابتدای آزمایش دیده‌اید؟ F یعنی دیده‌ام و J یعنی ندیده‌ام.',
    emotion: 'هر واژه را بر اساس احساس همین لحظه از ۱ (اصلاً) تا ۵ (خیلی زیاد) نمره‌دهی کنید.',
    recall: 'به سؤال‌ها بر اساس تجربهٔ خودتان پاسخ دهید.',
    switchPractice:
      'اگر نشانهٔ «بزرگی» قرمز بود: عدد کوچک‌تر از ۵ را با F و بزرگ‌تر از ۵ را با J پاسخ دهید.\nاگر نشانهٔ «زوجیت» آبی بود: عدد فرد را با F و عدد زوج را با J پاسخ دهید.',
    switch: 'قانون همان تمرین است. این بار بازخورد درستی پاسخ نشان داده نمی‌شود. سریع و دقیق پاسخ دهید.',
    manipulation:
      'به مرحله‌ای فکر کنید که تعداد توکن‌های شما کم و زیاد می‌شد. هر جمله را از ۱ (کاملاً مخالفم) تا ۷ (کاملاً موافقم) پاسخ دهید. پاسخ درست یا غلطی وجود ندارد.',
  };
  return blockNote ? `${blockNote}\n\n${notes[stage]}` : notes[stage];
}
