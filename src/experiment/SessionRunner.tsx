import { useEffect, useRef, useState } from 'react';
import type { ClientEvent } from '../../protocol/events';
import type {
  Checkpoint,
  EmotionTrial,
  RunPhase,
  SpatialTrial,
  StagePlan,
  StimulusPlan,
  SwitchTrial,
  TokenTrial,
} from '../../protocol/types';
import { createOutbox, api, type Outbox, type SaveState } from '../api';
import { bump, instructionFor, itemCount, listTrials, openingPhase, restMs, resumePastLiveTrial, tokenBalance, tokenBand } from './flow';

interface Bundle {
  session: { id: string; status: string; mode: string };
  plan: StimulusPlan;
  checkpoint: Checkpoint;
  trialIds: string[];
}

interface RunState {
  bundle: Bundle;
  checkpoint: Checkpoint;
  feedback: string | null;
  dotsHidden: boolean;
  gateNote: string | null;
  choiceId: string | null;
  otherText: string;
  onsetAt: string | null;
  stimulusAt: number;
  holding: boolean;
  error: string | null;
  finished: boolean;
  save: SaveState;
  knownTrials: string[];
}

export function SessionRunner({ sessionId }: { sessionId: string }) {
  const [run, setRun] = useState<RunState | null>(null);
  const runRef = useRef<RunState | null>(null);
  const outboxRef = useRef<Outbox | null>(null);

  function commit(checkpoint: Checkpoint, extra?: Partial<RunState>, events: ClientEvent[] = []): void {
    const prev = runRef.current;
    if (!prev) return;
    const enteredStimulus =
      checkpoint.phase === 'stimulus' &&
      (prev.checkpoint.phase !== 'stimulus' ||
        prev.checkpoint.trialIndex !== checkpoint.trialIndex ||
        prev.checkpoint.stageIndex !== checkpoint.stageIndex ||
        prev.checkpoint.practiceRound !== checkpoint.practiceRound);
    const next: RunState = {
      ...prev,
      ...extra,
      checkpoint,
      feedback: extra?.feedback ?? (checkpoint.phase === 'feedback' ? prev.feedback : null),
      dotsHidden: extra?.dotsHidden ?? (enteredStimulus ? false : prev.dotsHidden),
      choiceId: extra?.choiceId ?? (enteredStimulus ? null : prev.choiceId),
      otherText: extra?.otherText ?? (enteredStimulus ? '' : prev.otherText),
      onsetAt: enteredStimulus ? new Date().toISOString() : (extra?.onsetAt ?? prev.onsetAt),
      stimulusAt: enteredStimulus ? performance.now() : (extra?.stimulusAt ?? prev.stimulusAt),
    };
    runRef.current = next;
    setRun(next);
    const checkpointEvent: ClientEvent = {
      kind: 'checkpoint',
      clientEventId: `cp:${sessionId}:${checkpoint.seq}`,
      checkpoint,
    };
    void outboxRef.current?.send([checkpointEvent, ...events]).catch((error: unknown) => {
      const current = runRef.current;
      if (!current) return;
      const message = error instanceof Error ? error.message : 'ذخیره ناموفق بود';
      const failed = { ...current, error: message, save: 'failed' as const };
      runRef.current = failed;
      setRun(failed);
    });
  }

  useEffect(() => {
    let cancel = false;
    const outbox = createOutbox(sessionId, (save) => {
      const current = runRef.current;
      if (!current || current.save === save) return;
      const next = { ...current, save };
      runRef.current = next;
      setRun(next);
    });
    outboxRef.current = outbox;
    void (async () => {
      try {
        let bundle = await api<Bundle>(`/api/sessions/${sessionId}`);
        if (cancel) return;
        await outbox.flush();
        if (cancel) return;
        bundle = await api<Bundle>(`/api/sessions/${sessionId}`);
        if (bundle.session.status === 'completed') {
          const done = blankState(bundle, 'saved');
          done.finished = true;
          runRef.current = done;
          setRun(done);
          return;
        }
        const known = new Set(bundle.trialIds);
        let checkpoint = bundle.checkpoint;
        const stage = bundle.plan.stages[checkpoint.stageIndex];
        const resumed = stage ? resumePastLiveTrial(checkpoint, stage) : null;
        if (stage && resumed) {
          const trial = listTrials(stage, checkpoint.practiceRound)[checkpoint.trialIndex];
          if (trial && !known.has(trial.id)) {
            await outbox.send([
              {
                kind: 'interrupt',
                clientEventId: `interrupt:${trial.id}`,
                trialId: trial.id,
                checkpoint: resumed,
              },
            ]);
            known.add(trial.id);
          } else {
            await outbox.send([
              {
                kind: 'checkpoint',
                clientEventId: `cp:${sessionId}:${resumed.seq}`,
                checkpoint: resumed,
              },
            ]);
          }
          checkpoint = resumed;
        }
        const state = blankState(bundle, 'saved');
        state.checkpoint = checkpoint;
        state.knownTrials = [...known];
        runRef.current = state;
        setRun(state);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'جلسه بارگذاری نشد';
        const failed = blankState(emptyBundle(sessionId), 'failed');
        failed.error = message;
        runRef.current = failed;
        setRun(failed);
      }
    })();
    const retry = window.setInterval(() => {
      if (outbox.blocked()) return;
      void outbox.flush().catch(() => undefined);
    }, 4000);
    const onHide = () => {
      const current = runRef.current;
      const live = current?.checkpoint.phase;
      if (!current || (live !== 'stimulus' && live !== 'cue' && live !== 'feedback')) return;
      const stage = current.bundle.plan.stages[current.checkpoint.stageIndex];
      const trial = stage ? listTrials(stage, current.checkpoint.practiceRound)[current.checkpoint.trialIndex] : undefined;
      if (!trial || current.knownTrials.includes(trial.id)) return;
      const payload = JSON.stringify({
        events: [
          {
            kind: 'interrupt',
            clientEventId: `interrupt:${trial.id}`,
            trialId: trial.id,
            checkpoint: current.checkpoint,
          },
        ],
      });
      navigator.sendBeacon(`/api/sessions/${sessionId}/events`, new Blob([payload], { type: 'application/json' }));
    };
    window.addEventListener('pagehide', onHide);
    return () => {
      cancel = true;
      window.clearInterval(retry);
      window.removeEventListener('pagehide', onHide);
    };
  }, [sessionId]);

  useEffect(() => {
    if (!run || run.holding || run.finished) return;
    const stage = run.bundle.plan.stages[run.checkpoint.stageIndex];
    if (!stage) return;
    if (['rest', 'shopping-review', 'remove-want', 'midpoint', 'feedback', 'blank', 'isi', 'cue', 'pretarget', 'fixation', 'stimulus'].includes(run.checkpoint.phase)) {
      return;
    }
    if (run.checkpoint.trialIndex >= itemCount(stage, run.checkpoint.practiceRound) && itemCount(stage, run.checkpoint.practiceRound) > 0) {
      void finishStage();
    }
  }, [run?.checkpoint.seq]);

  useEffect(() => {
    if (!run) return;
    const ms = timerMs(run);
    if (ms === null) return;
    const id = window.setTimeout(() => onTimeout(), ms);
    return () => window.clearTimeout(id);
  }, [run?.checkpoint.seq, run?.checkpoint.phase, run?.dotsHidden, run?.holding]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const current = runRef.current;
      if (!current || current.holding || current.finished || current.checkpoint.phase === 'shopping-review' || current.checkpoint.phase === 'remove-want') return;
      const stage = current.bundle.plan.stages[current.checkpoint.stageIndex];
      if (!stage) return;
      if (current.checkpoint.phase === 'instruction' || current.checkpoint.phase === 'midpoint') {
        event.preventDefault();
        if (current.checkpoint.phase === 'instruction') beginTrials(current);
        else {
          const next = bump(current.checkpoint, { trialIndex: current.checkpoint.trialIndex + 1, phase: openingPhase(stage) });
          commit(next, { dotsHidden: false, feedback: null });
        }
        return;
      }
      if (current.checkpoint.phase !== 'stimulus') return;
      const key = responseKey(event);
      if (!key) return;
      event.preventDefault();
      answer(current, stage, key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sessionId]);

  function beginTrials(current: RunState): void {
    const stage = current.bundle.plan.stages[current.checkpoint.stageIndex];
    if (!stage) return;
    if (current.checkpoint.trialIndex >= itemCount(stage, current.checkpoint.practiceRound) && itemCount(stage, current.checkpoint.practiceRound) > 0) {
      void finishStage();
      return;
    }
    const next = bump(current.checkpoint, { phase: openingPhase(stage), trialIndex: current.checkpoint.trialIndex });
    const open: ClientEvent = {
      kind: 'open-stage',
      clientEventId: `open:${sessionId}:${stage.stage}:${current.checkpoint.practiceRound}`,
      stage: stage.stage,
      practiceRound: current.checkpoint.practiceRound,
      startedAt: new Date().toISOString(),
    };
    commit(next, { gateNote: null }, [open]);
  }

  function answer(current: RunState, stage: StagePlan, key: string): void {
    const rt = Math.max(0, Math.round(performance.now() - current.stimulusAt));
    if (stage.stage === 'shopping') {
      const trial = stage.trials[current.checkpoint.trialIndex];
      if (!trial || (key !== 'f' && key !== 'j')) return;
      if (!trial.practice && key === 'f' && current.checkpoint.shoppingWants.length >= 10 && !current.checkpoint.shoppingWants.includes(trial.productId)) {
        commit(bump(current.checkpoint, { phase: 'remove-want', pendingProductId: trial.productId }));
        return;
      }
      const wants = trial.practice
        ? current.checkpoint.shoppingWants
        : key === 'f'
          ? [...current.checkpoint.shoppingWants, trial.productId]
          : current.checkpoint.shoppingWants.filter((id) => id !== trial.productId);
      commit(bump(current.checkpoint, { phase: 'blank', shoppingWants: wants, pendingProductId: null }), {}, [
        trialEvent(current, trial.id, 'response', key, rt),
      ]);
      return;
    }
    if (stage.stage === 'tokenGames') {
      const trial = stage.trials[current.checkpoint.trialIndex];
      if (!trial || (key !== 'f' && key !== 'j')) return;
      commit(bump(current.checkpoint, { phase: 'feedback' }), { feedback: tokenMessage(current.bundle.plan, trial) }, [
        trialEvent(current, trial.id, 'response', key, rt),
      ]);
      return;
    }
    if (stage.stage === 'spatial' || stage.stage === 'spatialPractice') {
      const trial = listTrials(stage, current.checkpoint.practiceRound)[current.checkpoint.trialIndex];
      if (!trial || (key !== 'f' && key !== 'j')) return;
      commit(bump(current.checkpoint, { phase: 'isi' }), {}, [trialEvent(current, trial.id, 'response', key, rt)]);
      return;
    }
    if (stage.stage === 'recognition') {
      const trial = stage.trials[current.checkpoint.trialIndex];
      if (!trial || (key !== 'f' && key !== 'j')) return;
      commit(bump(current.checkpoint, { phase: 'blank' }), {}, [trialEvent(current, trial.id, 'response', key, rt)]);
      return;
    }
    if (stage.stage === 'switch' || stage.stage === 'switchPractice') {
      const trial = listTrials(stage, current.checkpoint.practiceRound)[current.checkpoint.trialIndex] as SwitchTrial | undefined;
      if (!trial || (key !== 'f' && key !== 'j')) return;
      const phase: RunPhase = stage.stage === 'switchPractice' ? 'feedback' : 'isi';
      commit(bump(current.checkpoint, { phase }), { feedback: key === trial.correctKey ? 'درست' : 'نادرست' }, [
        trialEvent(current, trial.id, 'response', key, rt),
      ]);
      return;
    }
    if (stage.stage === 'emotion' || stage.stage === 'manipulation') {
      const score = Number(key);
      const max = stage.stage === 'emotion' ? 5 : 7;
      if (!Number.isInteger(score) || score < 1 || score > max) return;
      const itemId =
        stage.stage === 'emotion'
          ? stage.trials[current.checkpoint.trialIndex]?.itemId
          : stage.items[current.checkpoint.trialIndex]?.id;
      if (!itemId) return;
      const instrument = stage.stage === 'emotion' ? 'panas' : 'manipulation';
      commit(bump(current.checkpoint, { phase: 'blank' }), {}, [questionEvent(instrument, itemId, String(score), null, rt)]);
      return;
    }
  }

  function onTimeout(): void {
    const current = runRef.current;
    if (!current || current.holding || current.finished) return;
    const stage = current.bundle.plan.stages[current.checkpoint.stageIndex];
    if (!stage) return;
    const phase = current.checkpoint.phase;
    if (phase === 'rest') {
      moveNext(current);
      return;
    }
    if (phase === 'fixation') {
      const preBlank = stage.stage === 'spatial' || stage.stage === 'spatialPractice' || stage.stage === 'switch' || stage.stage === 'switchPractice';
      commit(bump(current.checkpoint, { phase: preBlank ? 'blank' : 'stimulus' }));
      return;
    }
    if (phase === 'blank') {
      if (stage.stage === 'spatial' || stage.stage === 'spatialPractice') {
        commit(bump(current.checkpoint, { phase: 'stimulus' }));
        return;
      }
      if (stage.stage === 'switch' || stage.stage === 'switchPractice') {
        commit(bump(current.checkpoint, { phase: 'cue' }));
        return;
      }
      if (stage.stage === 'emotion' || stage.stage === 'manipulation') {
        goForward(current);
        return;
      }
      goForward(current);
      return;
    }
    if (phase === 'cue') {
      commit(bump(current.checkpoint, { phase: 'pretarget' }));
      return;
    }
    if (phase === 'pretarget') {
      commit(bump(current.checkpoint, { phase: 'stimulus' }));
      return;
    }
    if (phase === 'feedback') {
      commit(bump(current.checkpoint, { phase: 'isi' }));
      return;
    }
    if (phase === 'isi') {
      goForward(current);
      return;
    }
    if (phase !== 'stimulus') return;
    if (stage.stage === 'encoding') {
      const trial = stage.trials[current.checkpoint.trialIndex];
      if (!trial) return;
      commit(bump(current.checkpoint, { phase: 'blank' }), {}, [trialEvent(current, trial.id, 'encoding', null, null)]);
      return;
    }
    if (stage.stage === 'tokenGames') {
      const trial = stage.trials[current.checkpoint.trialIndex];
      if (!trial) return;
      if (trial.gameType === 'count' && !current.dotsHidden) {
        const next = { ...current, dotsHidden: true };
        runRef.current = next;
        setRun(next);
        return;
      }
      commit(bump(current.checkpoint, { phase: 'feedback' }), { feedback: tokenMessage(current.bundle.plan, trial) }, [
        trialEvent(current, trial.id, 'omission', null, null),
      ]);
      return;
    }
    if (stage.stage === 'emotion') {
      const trial = stage.trials[current.checkpoint.trialIndex];
      if (!trial) return;
      commit(bump(current.checkpoint, { phase: 'blank' }), {}, [questionEvent('panas', trial.itemId, null, null, null)]);
      return;
    }
    if (stage.stage === 'manipulation') {
      const item = stage.items[current.checkpoint.trialIndex];
      if (!item) return;
      commit(bump(current.checkpoint, { phase: 'blank' }), {}, [questionEvent('manipulation', item.id, null, null, null)]);
      return;
    }
    if (stage.stage === 'switch' || stage.stage === 'switchPractice') {
      const trial = listTrials(stage, current.checkpoint.practiceRound)[current.checkpoint.trialIndex];
      if (!trial) return;
      const nextPhase: RunPhase = stage.stage === 'switchPractice' ? 'feedback' : 'isi';
      commit(bump(current.checkpoint, { phase: nextPhase }), { feedback: 'پاسخ ندادید' }, [trialEvent(current, trial.id, 'omission', null, null)]);
      return;
    }
    const trial = listTrials(stage, current.checkpoint.practiceRound)[current.checkpoint.trialIndex];
    if (!trial) return;
    const nextPhase: RunPhase = stage.stage === 'spatial' || stage.stage === 'spatialPractice' ? 'isi' : 'blank';
    commit(bump(current.checkpoint, { phase: nextPhase }), {}, [trialEvent(current, trial.id, 'omission', null, null)]);
  }

  function goForward(current: RunState): void {
    const stage = current.bundle.plan.stages[current.checkpoint.stageIndex];
    if (!stage) return;
    const count = itemCount(stage, current.checkpoint.practiceRound);
    const trial = stage.stage === 'shopping' ? stage.trials[current.checkpoint.trialIndex] : undefined;
    if (trial && trial.mainOrdinal === 9 && current.checkpoint.phase !== 'midpoint' && current.checkpoint.trialIndex + 1 < count) {
      commit(bump(current.checkpoint, { phase: 'midpoint' }));
      return;
    }
    if (current.checkpoint.trialIndex + 1 < count) {
      commit(bump(current.checkpoint, { trialIndex: current.checkpoint.trialIndex + 1, phase: openingPhase(stage), pendingProductId: null }), {
        dotsHidden: false,
        feedback: null,
      });
      return;
    }
    if (stage.stage === 'shopping') {
      commit(bump(current.checkpoint, { phase: 'shopping-review' }));
      return;
    }
    void finishStage();
  }

  async function finishStage(): Promise<void> {
    const current = runRef.current;
    const outbox = outboxRef.current;
    if (!current || !outbox || current.holding) return;
    const stage = current.bundle.plan.stages[current.checkpoint.stageIndex];
    if (!stage) return;
    const locked = { ...current, holding: true };
    runRef.current = locked;
    setRun(locked);
    try {
      if (stage.stage === 'switch' && current.checkpoint.practiceRound < stage.blocks.length - 1) {
        const next = bump(current.checkpoint, { practiceRound: current.checkpoint.practiceRound + 1, trialIndex: 0, phase: 'instruction' });
        commit(next, { holding: false, gateNote: 'بلوک بعدی.' });
        return;
      }
      if (stage.stage === 'spatialPractice' || stage.stage === 'switchPractice') {
        const result = await outbox.send([
          {
            kind: 'close-practice',
            clientEventId: `close:${sessionId}:${stage.stage}:${current.checkpoint.practiceRound}`,
            stage: stage.stage,
            practiceRound: current.checkpoint.practiceRound,
          },
        ]);
        if (!result.practice) throw new Error('نتیجهٔ تمرین برنگشت.');
        if (!result.practice.passed) {
          const next = bump(current.checkpoint, { practiceRound: current.checkpoint.practiceRound + 1, trialIndex: 0, phase: 'instruction' });
          const latest = runRef.current ?? current;
          runRef.current = { ...latest, bundle: { ...latest.bundle, plan: result.plan } };
          commit(next, { holding: false, gateNote: 'دقت تمرین کمتر از ۹۰ درصد بود. تمرین تکرار می‌شود.' });
          return;
        }
      } else {
        await outbox.send([
          {
            kind: 'close-stage',
            clientEventId: `close:${sessionId}:${stage.stage}:${current.checkpoint.practiceRound}`,
            stage: stage.stage,
            practiceRound: current.checkpoint.practiceRound,
          },
        ]);
      }
      const rest = restMs(stage.stage, current.bundle.plan);
      if (rest) {
        commit(bump(current.checkpoint, { phase: 'rest' }), { holding: false, gateNote: null });
        return;
      }
      moveNext(runRef.current ?? current);
    } catch (error) {
      const latest = runRef.current ?? current;
      const failed = { ...latest, holding: false, error: error instanceof Error ? error.message : 'ثبت مرحله ناموفق بود' };
      runRef.current = failed;
      setRun(failed);
    }
  }

  function moveNext(current: RunState): void {
    const nextIndex = current.checkpoint.stageIndex + 1;
    if (nextIndex >= current.bundle.plan.stages.length) {
      void finishExperiment();
      return;
    }
    const next = bump(current.checkpoint, {
      stageIndex: nextIndex,
      trialIndex: 0,
      practiceRound: 0,
      phase: 'instruction',
      pendingProductId: null,
      shoppingWants: [],
    });
    commit(next, { holding: false, gateNote: null, feedback: null, dotsHidden: false });
  }

  async function finishExperiment(): Promise<void> {
    const current = runRef.current;
    if (!current) return;
    try {
      await outboxRef.current?.flush();
      await api(`/api/sessions/${sessionId}/complete`, { method: 'POST', body: '{}' });
      const done = { ...current, finished: true, holding: false, error: null };
      runRef.current = done;
      setRun(done);
    } catch (error) {
      const failed = { ...current, holding: false, error: error instanceof Error ? error.message : 'پایان جلسه ثبت نشد' };
      runRef.current = failed;
      setRun(failed);
    }
  }

  function trialEvent(current: RunState, trialId: string, responseKind: 'response' | 'omission' | 'encoding', response: string | null, rtMs: number | null): ClientEvent {
    current.knownTrials = current.knownTrials.includes(trialId) ? current.knownTrials : [...current.knownTrials, trialId];
    return {
      kind: 'trial',
      clientEventId: `trial:${trialId}`,
      trialId,
      onsetAt: current.onsetAt,
      offsetAt: new Date().toISOString(),
      response,
      responseKind,
      rtMs,
    };
  }

  function questionEvent(
    instrument: 'panas' | 'recall' | 'manipulation',
    itemId: string,
    rawValue: string | null,
    otherText: string | null,
    rtMs: number | null,
  ): ClientEvent {
    return {
      kind: 'questionnaire',
      clientEventId: `q:${sessionId}:${instrument}:${itemId}`,
      instrument,
      itemId,
      rawValue,
      otherText,
      rtMs,
    };
  }

  async function confirmShopping(): Promise<void> {
    const current = runRef.current;
    const outbox = outboxRef.current;
    if (!current || !outbox || current.checkpoint.shoppingWants.length !== 10) return;
    const locked = { ...current, holding: true };
    runRef.current = locked;
    setRun(locked);
    try {
      await outbox.send([
        {
          kind: 'shopping-final',
          clientEventId: `shop-final:${sessionId}`,
          productIds: current.checkpoint.shoppingWants,
        },
      ]);
      const released = { ...(runRef.current ?? locked), holding: false };
      runRef.current = released;
      setRun(released);
      void finishStage();
    } catch (error) {
      const failed = { ...(runRef.current ?? current), holding: false, error: error instanceof Error ? error.message : 'انتخاب نهایی ثبت نشد' };
      runRef.current = failed;
      setRun(failed);
    }
  }

  function removeWant(productId: string): void {
    const current = runRef.current;
    if (!current || !current.checkpoint.pendingProductId) return;
    const stage = current.bundle.plan.stages[current.checkpoint.stageIndex];
    if (stage?.stage !== 'shopping') return;
    const trial = stage.trials[current.checkpoint.trialIndex];
    if (!trial) return;
    const rt = Math.max(0, Math.round(performance.now() - current.stimulusAt));
    const wants = [...current.checkpoint.shoppingWants.filter((id) => id !== productId), current.checkpoint.pendingProductId];
    commit(bump(current.checkpoint, { phase: 'blank', shoppingWants: wants, pendingProductId: null }), {}, [
      trialEvent(current, trial.id, 'response', 'f', rt),
    ]);
  }

  function toggleWant(productId: string): void {
    const current = runRef.current;
    if (!current) return;
    const has = current.checkpoint.shoppingWants.includes(productId);
    const shoppingWants = has
      ? current.checkpoint.shoppingWants.filter((id) => id !== productId)
      : [...current.checkpoint.shoppingWants, productId];
    if (shoppingWants.length > 10) return;
    commit(bump(current.checkpoint, { shoppingWants }));
  }

  function chooseRecall(optionId: string): void {
    const current = runRef.current;
    if (!current) return;
    const state = { ...current, choiceId: optionId };
    runRef.current = state;
    setRun(state);
  }

  async function submitRecall(): Promise<void> {
    const current = runRef.current;
    if (!current || !current.choiceId) return;
    const stage = current.bundle.plan.stages[current.checkpoint.stageIndex];
    if (stage?.stage !== 'recall') return;
    const question = stage.questions[current.checkpoint.trialIndex];
    const option = question?.options.find((item) => item.id === current.choiceId);
    if (!question || !option) return;
    if (option.allowsText && !current.otherText.trim()) return;
    const rt = Math.max(0, Math.round(performance.now() - current.stimulusAt));
    const count = stage.questions.length;
    if (current.checkpoint.trialIndex + 1 < count) {
      commit(
        bump(current.checkpoint, { trialIndex: current.checkpoint.trialIndex + 1, phase: 'stimulus' }),
        { choiceId: null, otherText: '' },
        [questionEvent('recall', question.id, option.id, option.allowsText ? current.otherText.trim() : null, rt)],
      );
      return;
    }
    commit(bump(current.checkpoint, { phase: 'blank' }), {}, [
      questionEvent('recall', question.id, option.id, option.allowsText ? current.otherText.trim() : null, rt),
    ]);
  }

  if (!run) return <main className="stage">در حال بارگذاری جلسه...</main>;
  if (run.finished) {
    return (
      <main className="stage">
        <h1>آزمایش به پایان رسید، از همکاری شما سپاسگزاریم.</h1>
      </main>
    );
  }
  const stage = run.bundle.plan.stages[run.checkpoint.stageIndex];
  if (!stage) {
    return (
      <main className="stage">
        {run.error ? <p className="error">{run.error}</p> : <p>مرحله‌ای برای اجرا باقی نمانده است.</p>}
      </main>
    );
  }
  return (
    <main className="stage" data-stage={stage.stage} data-phase={run.checkpoint.phase}>
      {stage.stage === 'tokenGames' ? <div className="token">توکن: {shownTokens(run)}</div> : null}
      <div className="save">{run.save === 'saved' ? 'ذخیره شد' : run.save === 'pending' ? 'در حال ذخیره' : 'ذخیره ناموفق'}</div>
      {run.error ? <p className="error">{run.error}</p> : null}
      {renderStage(run, stage)}
      {run.checkpoint.phase === 'shopping-review' ? (
        <ShoppingReview run={run} onToggle={toggleWant} onConfirm={() => void confirmShopping()} />
      ) : null}
      {run.checkpoint.phase === 'remove-want' && stage.stage === 'shopping' ? (
        <div className="panel">
          <p>شما بیش از ده مورد انتخاب کرده‌اید. یکی از انتخاب‌های قبلی را حذف کنید.</p>
          {run.checkpoint.shoppingWants.map((productId) => {
            const product = stage.trials.find((trial) => trial.productId === productId);
            return (
              <button key={productId} type="button" onClick={() => removeWant(productId)}>
                حذف {product?.nameFa ?? productId}
              </button>
            );
          })}
        </div>
      ) : null}
    </main>
  );

  function renderStage(current: RunState, currentStage: StagePlan) {
    const phase = current.checkpoint.phase;
    if (phase === 'instruction' || phase === 'midpoint') {
      const text =
        phase === 'midpoint'
          ? 'نیمهٔ اول به پایان رسید. ادامه دهید.'
          : instructionFor(currentStage.stage, current.gateNote);
      return (
        <div>
          <p className="instruction">{text}</p>
          <p className="hint">برای ادامه کلیدی را فشار دهید.</p>
        </div>
      );
    }
    if (phase === 'rest') return <p className="instruction">کمی استراحت کنید. مرحلهٔ بعد خودش شروع می‌شود.</p>;
    if (phase === 'fixation') return <div className="word">+</div>;
    if (phase === 'blank' || phase === 'pretarget') return <div className="stage" />;
    if (phase === 'feedback') {
      return <p className="instruction">{current.feedback}</p>;
    }
    if (phase === 'isi' || phase === 'shopping-review' || phase === 'remove-want') return null;
    if (phase === 'cue' && (currentStage.stage === 'switch' || currentStage.stage === 'switchPractice')) {
      const trial = listTrials(currentStage, current.checkpoint.practiceRound)[current.checkpoint.trialIndex] as SwitchTrial | undefined;
      return <p className={`cue-word ${trial?.cueColor ?? 'red'}`}>{trial?.cue}</p>;
    }
    if (phase !== 'stimulus') return null;
    if (currentStage.stage === 'encoding') return <p className="word">{currentStage.trials[current.checkpoint.trialIndex]?.text}</p>;
    if (currentStage.stage === 'shopping') {
      const trial = currentStage.trials[current.checkpoint.trialIndex];
      return trial ? (
        <div>
          <img className="product" alt={trial.nameFa} src={`/stimuli/${trial.imageSrc}`} />
          <p className="hint">F می‌خواهم &nbsp;&nbsp; J نمی‌خواهم</p>
        </div>
      ) : null;
    }
    if (currentStage.stage === 'tokenGames') {
      const trial = currentStage.trials[current.checkpoint.trialIndex];
      if (!trial) return null;
      return trial.gameType === 'count' ? <CountField trial={trial} hidden={current.dotsHidden} /> : <CompareField trial={trial} />;
    }
    if (currentStage.stage === 'spatial' || currentStage.stage === 'spatialPractice') {
      const trial = listTrials(currentStage, current.checkpoint.practiceRound)[current.checkpoint.trialIndex] as SpatialTrial | undefined;
      return trial ? <SpatialField trial={trial} /> : null;
    }
    if (currentStage.stage === 'recognition') return <p className="word">{currentStage.trials[current.checkpoint.trialIndex]?.text}</p>;
    if (currentStage.stage === 'emotion') {
      const trial = currentStage.trials[current.checkpoint.trialIndex] as EmotionTrial | undefined;
      return (
        <div>
          <p className="word">{trial?.text}</p>
          <p className="hint">۱ اصلاً تا ۵ خیلی زیاد</p>
        </div>
      );
    }
    if (currentStage.stage === 'switch' || currentStage.stage === 'switchPractice') {
      const trial = listTrials(currentStage, current.checkpoint.practiceRound)[current.checkpoint.trialIndex] as SwitchTrial | undefined;
      return <p className={`number ${trial?.cueColor ?? 'red'}`}>{trial?.number}</p>;
    }
    if (currentStage.stage === 'manipulation') {
      const item = currentStage.items[current.checkpoint.trialIndex];
      return (
        <div className="panel">
          <p className="instruction">{item?.text}</p>
          <p className="hint">۱ کاملاً مخالفم تا ۷ کاملاً موافقم</p>
        </div>
      );
    }
    if (currentStage.stage === 'recall') {
      const question = currentStage.questions[current.checkpoint.trialIndex];
      if (!question) return null;
      const selected = question.options.find((option) => option.id === current.choiceId);
      return (
        <div className="panel">
          <p className="instruction">{question.prompt}</p>
          {question.options.map((option) => (
            <button key={option.id} type="button" className={option.id === current.choiceId ? 'choice selected' : 'choice'} onClick={() => chooseRecall(option.id)}>
              {option.label}
            </button>
          ))}
          {selected?.allowsText ? (
            <textarea
              value={current.otherText}
              onChange={(event) => {
                const latest = runRef.current;
                if (!latest) return;
                const state = { ...latest, otherText: event.target.value };
                runRef.current = state;
                setRun(state);
              }}
            />
          ) : null}
          <button type="button" disabled={!current.choiceId || (selected?.allowsText === true && !current.otherText.trim())} onClick={() => void submitRecall()}>
            ثبت پاسخ
          </button>
        </div>
      );
    }
    return null;
  }
}

function ShoppingReview({ run, onToggle, onConfirm }: { run: RunState; onToggle: (productId: string) => void; onConfirm: () => void }) {
  const stage = run.bundle.plan.stages[run.checkpoint.stageIndex];
  if (stage?.stage !== 'shopping') return null;
  const products = stage.trials.filter((trial) => !trial.practice);
  return (
    <div className="panel">
      <p>انتخاب نهایی باید دقیقاً ده کالا باشد. الان {run.checkpoint.shoppingWants.length} کالا انتخاب شده است.</p>
      {products.map((product) => {
        const selected = run.checkpoint.shoppingWants.includes(product.productId);
        return (
          <button key={product.productId} type="button" className={selected ? 'choice selected' : 'choice'} onClick={() => onToggle(product.productId)}>
            {selected ? 'انتخاب شده: ' : 'انتخاب: '}
            {product.nameFa}
          </button>
        );
      })}
      <button type="button" disabled={run.checkpoint.shoppingWants.length !== 10 || run.holding} onClick={onConfirm}>
        تأیید ده انتخاب
      </button>
    </div>
  );
}

function CountField({ trial, hidden }: { trial: TokenTrial; hidden: boolean }) {
  if (trial.gameType !== 'count') return null;
  return (
    <div>
      <div className="field" style={{ width: 600, height: 400 }}>
        {hidden ? null : trial.dots.map((dot, index) => <span key={index} className="dot" style={{ left: dot.x, top: dot.y }} />)}
      </div>
      <p className="hint">بیشتر از ۱۲؟ F بله &nbsp;&nbsp; J خیر</p>
    </div>
  );
}

function CompareField({ trial }: { trial: TokenTrial }) {
  if (trial.gameType !== 'compare') return null;
  return (
    <div>
      <div className="pair">
        <div className="field" style={{ width: 300, height: 300 }}>
          {trial.leftDots.map((dot, index) => <span key={index} className="dot" style={{ left: dot.x, top: dot.y }} />)}
        </div>
        <div className="field" style={{ width: 300, height: 300 }}>
          {trial.rightDots.map((dot, index) => <span key={index} className="dot" style={{ left: dot.x, top: dot.y }} />)}
        </div>
      </div>
      <p className="hint">کدام سمت بیشتر است؟ F چپ &nbsp;&nbsp; J راست</p>
    </div>
  );
}

function SpatialField({ trial }: { trial: SpatialTrial }) {
  const icon = trial.stimulus === 'heart' ? <HeartIcon /> : <FlowerIcon />;
  return (
    <div className="spatial">
      <div style={{ width: 140 }}>{trial.side === 'left' ? icon : null}</div>
      <div style={{ width: 140 }}>{trial.side === 'right' ? icon : null}</div>
    </div>
  );
}

function HeartIcon() {
  return (
    <svg width="120" height="120" viewBox="0 0 32 32" aria-label="قلب">
      <path fill="#c41212" d="M16 28s-9.5-6.2-12.4-11.2C1.2 12.8 3.2 8 7.6 8c2.2 0 3.8 1.1 4.8 2.7C13.4 9.1 15 8 17.2 8c4.4 0 6.4 4.8 4 8.8C22.4 21.8 16 28 16 28z" />
    </svg>
  );
}

function FlowerIcon() {
  return (
    <svg width="120" height="120" viewBox="0 0 32 32" aria-label="گل">
      <circle cx="16" cy="8" r="5" fill="#f4a7c5" />
      <circle cx="24" cy="14" r="5" fill="#f4a7c5" />
      <circle cx="21" cy="23" r="5" fill="#f4a7c5" />
      <circle cx="11" cy="23" r="5" fill="#f4a7c5" />
      <circle cx="8" cy="14" r="5" fill="#f4a7c5" />
      <circle cx="16" cy="16" r="4" fill="#e45b90" />
    </svg>
  );
}

function shownTokens(run: RunState): number {
  const plan = run.bundle.plan;
  const stage = plan.stages[run.checkpoint.stageIndex];
  if (stage?.stage !== 'tokenGames' || plan.initialTokens === null) return plan.initialTokens ?? 0;
  if (run.checkpoint.phase === 'instruction' || run.checkpoint.phase === 'rest') return plan.initialTokens;
  const trial = stage.trials[run.checkpoint.trialIndex];
  const applied = run.checkpoint.phase === 'feedback' || run.checkpoint.phase === 'isi' ? (trial?.index ?? 0) + 1 : (trial?.index ?? 0);
  return tokenBalance(plan, applied);
}

function tokenMessage(plan: StimulusPlan, trial: TokenTrial): string {
  const before = tokenBalance(plan, trial.index);
  const after = before + trial.tokenDelta;
  const change = trial.tokenDelta === 1 ? 'یک توکن اضافه شد' : trial.tokenDelta === -1 ? 'یک توکن کم شد' : 'موجودی تغییر نکرد';
  const band = tokenBand(plan.initialTokens ?? 1);
  const extra = after === 0 ? '\nدر آستانهٔ باخت هستید؛ برای ادامه باید حداقل یک پاسخ درست بدهید' : after >= band.max ? '\nعملکرد عالی، ادامه دهید' : '';
  return `${change}\nموجودی: ${after}${extra}`;
}

function responseKey(event: KeyboardEvent): string | null {
  if (event.code === 'KeyF') return 'f';
  if (event.code === 'KeyJ') return 'j';
  const digit = /^Digit([1-7])$/.exec(event.code) ?? /^Numpad([1-7])$/.exec(event.code);
  return digit?.[1] ?? null;
}

function timerMs(run: RunState): number | null {
  if (run.holding || run.finished) return null;
  const stage = run.bundle.plan.stages[run.checkpoint.stageIndex];
  if (!stage) return null;
  const phase = run.checkpoint.phase;
  if (phase === 'rest') return restMs(stage.stage, run.bundle.plan);
  if (phase === 'fixation') return stage.stage === 'recognition' ? 300 : 500;
  if (phase === 'blank') {
    if (stage.stage === 'spatial' || stage.stage === 'spatialPractice') return 200;
    if (stage.stage === 'shopping') return 1500;
    if (stage.stage === 'recognition' || stage.stage === 'emotion' || stage.stage === 'manipulation') return 300;
    if (stage.stage === 'switch' || stage.stage === 'switchPractice') {
      const trial = listTrials(stage, run.checkpoint.practiceRound)[run.checkpoint.trialIndex] as SwitchTrial | undefined;
      return trial?.blankBeforeCueMs ?? 500;
    }
    return 500;
  }
  if (phase === 'cue') return 800;
  if (phase === 'pretarget') {
    const trial = listTrials(stage, run.checkpoint.practiceRound)[run.checkpoint.trialIndex] as SwitchTrial | undefined;
    return trial?.blankBeforeTargetMs ?? 500;
  }
  if (phase === 'feedback') return stage.stage === 'switchPractice' ? 600 : 800;
  if (phase === 'isi') {
    if (stage.stage === 'spatial' || stage.stage === 'spatialPractice') return 1500;
    if (stage.stage === 'switch' || stage.stage === 'switchPractice') return 1000;
    const trial = stage.stage === 'tokenGames' ? stage.trials[run.checkpoint.trialIndex] : undefined;
    return trial?.gameType === 'compare' ? 800 : 1000;
  }
  if (phase === 'stimulus') {
    if (stage.stage === 'encoding' || stage.stage === 'shopping') return 3000;
    if (stage.stage === 'recognition') return 3000;
    if (stage.stage === 'emotion') return 4000;
    if (stage.stage === 'spatial' || stage.stage === 'spatialPractice') return 1500;
    if (stage.stage === 'switch' || stage.stage === 'switchPractice') return 2000;
    if (stage.stage === 'tokenGames') {
      const trial = stage.trials[run.checkpoint.trialIndex];
      if (!trial) return null;
      if (trial.gameType === 'compare') return 1200;
      const elapsed = performance.now() - run.stimulusAt;
      return run.dotsHidden ? Math.max(0, 2000 - elapsed) : Math.max(0, 1500 - elapsed);
    }
  }
  return null;
}

function blankState(bundle: Bundle, save: SaveState): RunState {
  return {
    bundle,
    checkpoint: bundle.checkpoint,
    feedback: null,
    dotsHidden: false,
    gateNote: null,
    choiceId: null,
    otherText: '',
    onsetAt: null,
    stimulusAt: 0,
    holding: false,
    error: null,
    finished: false,
    save,
    knownTrials: bundle.trialIds,
  };
}

function emptyBundle(sessionId: string): Bundle {
  return {
    session: { id: sessionId, status: 'inProgress', mode: 'main' },
    plan: { seed: 0, manifestHash: '', encodingRestMs: 0, gameOrder: null, initialTokens: null, tokenDeltas: [], stages: [] },
    checkpoint: { seq: 0, stageIndex: 0, trialIndex: 0, practiceRound: 0, phase: 'instruction', shoppingWants: [], pendingProductId: null, updatedAt: '' },
    trialIds: [],
  };
}
