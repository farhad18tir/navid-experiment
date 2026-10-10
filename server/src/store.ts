import { randomInt, randomUUID } from 'node:crypto';
import { EMOTION_ITEMS, MANIPULATION_ITEMS } from '../../protocol/content';
import type { ClientEvent } from '../../protocol/events';
import { appendPracticeRound, buildStimulusPlan, findPlanTrial, type AnyTrial } from '../../protocol/generate';
import { expandStageList, type ManifestError, manifestHash, validateManifest } from '../../protocol/manifest';
import { mulberry32 } from '../../protocol/rng';
import { balanceAfter, passedPracticeGate, PROTOCOL_SETTINGS, rewardCountForTokens } from '../../protocol/settings';
import { recognitionClass, summarizeSession, type ScoreQuestionnaire, type ScoreTrial } from '../../protocol/scoring';
import {
  MAIN_STAGE_ORDER,
  PROTOCOL_VERSION,
  type Checkpoint,
  type GameOrder,
  type GroupName,
  type SessionMode,
  type StageName,
  type StimulusManifest,
  type StimulusPlan,
} from '../../protocol/types';
import { transaction, type Database, type SqlRow } from './db';

export class StoreError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'StoreError';
  }
}

export interface AppDeps {
  db: Database;
  manifestPath: string;
  stimuliRoot: string;
  loadManifest: () => unknown;
}

const now = () => new Date().toISOString();

export function readManifest(deps: AppDeps): { manifest: StimulusManifest; issues: string[] } {
  try {
    const manifest = validateManifest(deps.loadManifest(), deps.stimuliRoot);
    return { manifest, issues: [] };
  } catch (error) {
    const issues = (error as ManifestError).issues ?? [error instanceof Error ? error.message : 'خطای محرک‌ها'];
    return { manifest: emptyManifest(), issues };
  }
}

function emptyManifest(): StimulusManifest {
  return { version: 1, products: [], recognitionNewWords: [], recognitionOld: { mode: 'randomPerSession' }, baselineStages: [] };
}

export function createSchool(db: Database, input: { id: string; name: string; gender: 'girls' | 'boys'; region: string | null }): void {
  if (!input.id.trim() || !input.name.trim()) throw new StoreError('شناسه و نام مدرسه لازم است.', 400);
  const existing = db.prepare('SELECT id FROM schools WHERE id = ?').get(input.id);
  if (existing) throw new StoreError('این شناسهٔ مدرسه قبلاً ثبت شده است.', 409);
  db.prepare('INSERT INTO schools (id, name, gender, region, created_at) VALUES (?, ?, ?, ?, ?)').run(
    input.id.trim(),
    input.name.trim(),
    input.gender,
    input.region,
    now(),
  );
}

export function listSchools(db: Database): SqlRow[] {
  return db.prepare('SELECT id, name, gender, region, created_at FROM schools ORDER BY created_at').all();
}

export function createParticipant(
  db: Database,
  input: { id: string; schoolId: string; consentParent: boolean; consentStudent: boolean },
): { id: string; groupName: GroupName } {
  if (!input.id.trim()) throw new StoreError('شناسهٔ شرکت‌کننده لازم است.', 400);
  const school = db.prepare('SELECT id FROM schools WHERE id = ?').get(input.schoolId);
  if (!school) throw new StoreError('مدرسه پیدا نشد.', 404);
  if (db.prepare('SELECT id FROM participants WHERE id = ?').get(input.id)) {
    throw new StoreError('این شناسه قبلاً ثبت شده است.', 409);
  }
  const groupName = assignGroup(db, input.schoolId);
  db.prepare(
    'INSERT INTO participants (id, school_id, group_name, consent_parent, consent_student, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(input.id.trim(), input.schoolId, groupName, input.consentParent ? 1 : 0, input.consentStudent ? 1 : 0, now());
  return { id: input.id.trim(), groupName };
}

function assignGroup(db: Database, schoolId: string): GroupName {
  const rows = db
    .prepare('SELECT group_name, COUNT(*) AS c FROM participants WHERE school_id = ? GROUP BY group_name')
    .all(schoolId);
  const count = (name: GroupName) => Number(rows.find((row) => row.group_name === name)?.c ?? 0);
  const scarcity = count('scarcity');
  const control = count('control');
  if (scarcity < control) return 'scarcity';
  if (control < scarcity) return 'control';
  return randomInt(0, 2) === 0 ? 'scarcity' : 'control';
}

export function listParticipants(db: Database): SqlRow[] {
  return db
    .prepare(
      `SELECT p.id, p.school_id, p.group_name, p.consent_parent, p.consent_student, p.created_at,
              s.name AS school_name,
              (SELECT COUNT(*) FROM demographics d WHERE d.participant_id = p.id) AS has_demographics
       FROM participants p JOIN schools s ON s.id = p.school_id
       ORDER BY p.created_at DESC`,
    )
    .all();
}

export function saveDemographics(db: Database, participantId: string, input: DemographicsInput): void {
  if (!db.prepare('SELECT id FROM participants WHERE id = ?').get(participantId)) {
    throw new StoreError('شرکت‌کننده پیدا نشد.', 404);
  }
  const age = optionalInt(input.ageYears, 13, 15, 'سن');
  const gpa = optionalNumber(input.recentGpa, 0, 20, 'معدل');
  const siblings = optionalInt(input.siblingCount, 0, 20, 'تعداد خواهر و برادر');
  const father = optionalInt(input.fatherEducation, 1, 9, 'تحصیلات پدر');
  const mother = optionalInt(input.motherEducation, 1, 9, 'تحصیلات مادر');
  const books = optionalInt(input.homeBookCount, 0, 100000, 'تعداد کتاب');
  const income = optionalNumber(input.monthlyIncomePerCapita, 0, 1_000_000_000_000, 'درآمد سرانه');
  const ownership = input.homeOwnership;
  if (ownership !== null && ownership !== 0 && ownership !== 1) throw new StoreError('مالکیت خانه نامعتبر است.', 400);
  const area = optionalInt(input.homeAreaLevel, 1, 4, 'مساحت خانه');
  let appliancesJson: string | null = null;
  let applianceCount: number | null = null;
  let applianceGt6: number | null = null;
  if (input.appliances) {
    const keys = ['fridge', 'tv', 'car', 'washer', 'dishwasher', 'stove', 'sofa', 'dining', 'chandelier'];
    const record: Record<string, boolean> = {};
    for (const key of keys) {
      const value = input.appliances[key];
      if (typeof value !== 'boolean') throw new StoreError('هر ۹ وسیله باید بله یا خیر داشته باشد.', 400);
      record[key] = value;
    }
    applianceCount = keys.filter((key) => record[key]).length;
    applianceGt6 = applianceCount > 6 ? 1 : 0;
    appliancesJson = JSON.stringify(record);
  }
  db.prepare(
    `INSERT INTO demographics (
      participant_id, age_years, recent_gpa, sibling_count, father_education, mother_education,
      home_book_count, monthly_income_per_capita, income_unit, income_collected_on, home_ownership,
      home_area_level, area_above_regional_median, appliances_json, appliance_count, appliance_gt6,
      asset_index, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?)
    ON CONFLICT(participant_id) DO UPDATE SET
      age_years = excluded.age_years,
      recent_gpa = excluded.recent_gpa,
      sibling_count = excluded.sibling_count,
      father_education = excluded.father_education,
      mother_education = excluded.mother_education,
      home_book_count = excluded.home_book_count,
      monthly_income_per_capita = excluded.monthly_income_per_capita,
      income_unit = excluded.income_unit,
      income_collected_on = excluded.income_collected_on,
      home_ownership = excluded.home_ownership,
      home_area_level = excluded.home_area_level,
      appliances_json = excluded.appliances_json,
      appliance_count = excluded.appliance_count,
      appliance_gt6 = excluded.appliance_gt6,
      updated_at = excluded.updated_at`,
  ).run(
    participantId,
    age,
    gpa,
    siblings,
    father,
    mother,
    books,
    income,
    income === null ? null : 'toman-per-month',
    input.incomeCollectedOn,
    ownership,
    area,
    appliancesJson,
    applianceCount,
    applianceGt6,
    now(),
  );
}

export interface DemographicsInput {
  ageYears: number | null;
  recentGpa: number | null;
  siblingCount: number | null;
  fatherEducation: number | null;
  motherEducation: number | null;
  homeBookCount: number | null;
  monthlyIncomePerCapita: number | null;
  incomeCollectedOn: string | null;
  homeOwnership: number | null;
  homeAreaLevel: number | null;
  appliances: Record<string, boolean> | null;
}

export function createSession(deps: AppDeps, participantId: string, mode: SessionMode): { sessionId: string } {
  const loaded = readManifest(deps);
  if (loaded.issues.length > 0) {
    throw new StoreError(`جلسه شروع نمی‌شود تا فایل محرک‌ها کامل شود.\n${loaded.issues.join('\n')}`, 409);
  }
  const participant = deps.db.prepare('SELECT id, group_name, consent_parent, consent_student FROM participants WHERE id = ?').get(participantId);
  if (!participant) throw new StoreError('شرکت‌کننده پیدا نشد.', 404);
  if (Number(participant.consent_parent) !== 1 || Number(participant.consent_student) !== 1) {
    throw new StoreError('رضایت والد و دانش‌آموز هر دو لازم است.', 409);
  }
  const existing = deps.db.prepare('SELECT id, status FROM sessions WHERE participant_id = ? AND mode = ?').get(participantId, mode);
  if (existing) throw new StoreError('برای این نوبت قبلاً جلسه ساخته شده است. همان جلسه را ادامه دهید.', 409);

  const group = participant.group_name as GroupName;
  const stageNames = (mode === 'main' ? [...MAIN_STAGE_ORDER] : expandStageList(loaded.manifest.baselineStages)) as StageName[];
  const seed = randomInt(1, 2_147_483_646);
  const gameOrder = stageNames.includes('tokenGames') ? chooseGameOrder(deps.db, group) : null;
  const plan = buildStimulusPlan({
    seed,
    manifest: loaded.manifest,
    manifestHash: manifestHash(loaded.manifest),
    group,
    stageNames,
    gameOrder,
    rng: mulberry32(seed),
  });
  const sessionId = randomUUID();
  const created = now();
  const checkpoint: Checkpoint = {
    seq: 1,
    stageIndex: 0,
    trialIndex: 0,
    practiceRound: 0,
    phase: 'instruction',
    shoppingWants: [],
    pendingProductId: null,
    updatedAt: created,
  };
  transaction(deps.db, () => {
    deps.db
      .prepare(
        `INSERT INTO sessions (
          id, participant_id, mode, measurement_period, status, save_status, protocol_version,
          protocol_settings_json, game_order, manifest_hash, created_at, started_at
        ) VALUES (?, ?, ?, ?, 'inProgress', 'saved', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sessionId,
        participantId,
        mode,
        mode === 'baseline' ? 'pre' : 'post',
        PROTOCOL_VERSION,
        JSON.stringify(PROTOCOL_SETTINGS),
        gameOrder,
        plan.manifestHash,
        created,
        created,
      );
    deps.db.prepare('INSERT INTO stimulus_plans (session_id, seed, plan_json) VALUES (?, ?, ?)').run(sessionId, seed, JSON.stringify(plan));
    deps.db
      .prepare('INSERT INTO checkpoints (session_id, seq, payload_json, updated_at) VALUES (?, ?, ?, ?)')
      .run(sessionId, checkpoint.seq, JSON.stringify(checkpoint), created);
  });
  return { sessionId };
}

function chooseGameOrder(db: Database, group: GroupName): GameOrder {
  const rows = db
    .prepare(
      `SELECT s.game_order AS game_order, COUNT(*) AS c
       FROM sessions s JOIN participants p ON p.id = s.participant_id
       WHERE p.group_name = ? AND s.game_order IS NOT NULL
       GROUP BY s.game_order`,
    )
    .all(group);
  const count = (order: GameOrder) => Number(rows.find((row) => row.game_order === order)?.c ?? 0);
  const countFirst = count('count-compare');
  const compareFirst = count('compare-count');
  if (countFirst < compareFirst) return 'count-compare';
  if (compareFirst < countFirst) return 'compare-count';
  return randomInt(0, 2) === 0 ? 'count-compare' : 'compare-count';
}

export interface SessionBundle {
  session: SqlRow;
  plan: StimulusPlan;
  checkpoint: Checkpoint;
  trialIds: string[];
  stageRuns: SqlRow[];
  notes?: SqlRow[];
  rewards?: SqlRow[];
  shopping?: SqlRow[];
  scores?: SqlRow;
  participant?: SqlRow;
  demographics?: SqlRow;
}

export function getSession(db: Database, sessionId: string, admin: boolean): SessionBundle {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) throw new StoreError('جلسه پیدا نشد.', 404);
  const planRow = db.prepare('SELECT plan_json FROM stimulus_plans WHERE session_id = ?').get(sessionId);
  if (!planRow) throw new StoreError('برنامهٔ محرک‌ها پیدا نشد.', 500);
  const checkpointRow = db.prepare('SELECT payload_json FROM checkpoints WHERE session_id = ?').get(sessionId);
  const bundle: SessionBundle = {
    session: admin ? session : publicSession(session),
    plan: JSON.parse(String(planRow.plan_json)) as StimulusPlan,
    checkpoint: checkpointRow ? (JSON.parse(String(checkpointRow.payload_json)) as Checkpoint) : defaultCheckpoint(),
    trialIds: db.prepare('SELECT id FROM trials WHERE session_id = ?').all(sessionId).map((row) => String(row.id)),
    stageRuns: db.prepare('SELECT stage, practice_round, passed_gate, accuracy, complete, interrupted_trial_id FROM stage_runs WHERE session_id = ?').all(sessionId),
  };
  if (admin) {
    bundle.notes = db.prepare('SELECT id, stage, note, created_at FROM observer_notes WHERE session_id = ? ORDER BY created_at').all(sessionId);
    bundle.rewards = db.prepare('SELECT product_id, delivered FROM reward_deliveries WHERE session_id = ?').all(sessionId);
    bundle.shopping = db.prepare('SELECT product_id, initial_response, final_selected FROM shopping_choices WHERE session_id = ?').all(sessionId);
    bundle.scores = db.prepare('SELECT * FROM session_scores WHERE session_id = ?').get(sessionId);
    bundle.participant = db.prepare('SELECT * FROM participants WHERE id = ?').get(String(session.participant_id));
    bundle.demographics = db.prepare('SELECT * FROM demographics WHERE participant_id = ?').get(String(session.participant_id));
  }
  return bundle;
}

function publicSession(session: SqlRow): SqlRow {
  return {
    id: session.id,
    mode: session.mode,
    measurement_period: session.measurement_period,
    status: session.status,
    save_status: session.save_status,
    final_tokens: session.final_tokens,
    reward_count: session.reward_count,
    reward_status: session.reward_status,
  };
}

export function findOpenSession(db: Database, participantId: string): SqlRow | undefined {
  return db
    .prepare(
      `SELECT id, mode, status FROM sessions
       WHERE participant_id = ? AND status IN ('inProgress', 'interrupted')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(participantId);
}

export function applyEvents(db: Database, sessionId: string, events: ClientEvent[]): { accepted: string[]; plan: StimulusPlan; practice: { stage: string; practiceRound: number; accuracy: number; passed: boolean } | null } {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) throw new StoreError('جلسه پیدا نشد.', 404);
  if (session.status === 'completed') throw new StoreError('این جلسه بسته شده است.', 409);
  const planRow = db.prepare('SELECT plan_json FROM stimulus_plans WHERE session_id = ?').get(sessionId);
  if (!planRow) throw new StoreError('برنامهٔ محرک‌ها پیدا نشد.', 500);
  let plan = JSON.parse(String(planRow.plan_json)) as StimulusPlan;
  const accepted: string[] = [];
  let practice: { stage: string; practiceRound: number; accuracy: number; passed: boolean } | null = null;
  try {
    transaction(db, () => {
      for (const event of events) {
        const seen = db.prepare('SELECT client_event_id FROM applied_events WHERE client_event_id = ?').get(event.clientEventId);
        if (seen) {
          accepted.push(event.clientEventId);
          if (event.kind === 'close-practice') {
            const row = db
              .prepare('SELECT accuracy, passed_gate FROM stage_runs WHERE session_id = ? AND stage = ? AND practice_round = ?')
              .get(sessionId, event.stage, event.practiceRound);
            if (row) {
              practice = {
                stage: event.stage,
                practiceRound: event.practiceRound,
                accuracy: Number(row.accuracy ?? 0),
                passed: Number(row.passed_gate) === 1,
              };
            }
          }
          continue;
        }
        const result = applyOne(db, sessionId, plan, event);
        plan = result.plan;
        if (result.practice) practice = result.practice;
        db.prepare('INSERT INTO applied_events (client_event_id, session_id, kind, created_at) VALUES (?, ?, ?, ?)').run(
          event.clientEventId,
          sessionId,
          event.kind,
          now(),
        );
        accepted.push(event.clientEventId);
      }
      db.prepare('UPDATE stimulus_plans SET plan_json = ? WHERE session_id = ?').run(JSON.stringify(plan), sessionId);
      db.prepare("UPDATE sessions SET save_status = 'saved' WHERE id = ?").run(sessionId);
    });
  } catch (error) {
    db.prepare("UPDATE sessions SET save_status = 'failed' WHERE id = ?").run(sessionId);
    throw error;
  }
  return { accepted, plan, practice };
}

function applyOne(
  db: Database,
  sessionId: string,
  plan: StimulusPlan,
  event: ClientEvent,
): { plan: StimulusPlan; practice: { stage: string; practiceRound: number; accuracy: number; passed: boolean } | null } {
  if (event.kind === 'checkpoint') {
    saveCheckpoint(db, sessionId, event.checkpoint);
    markRunning(db, sessionId);
    return { plan, practice: null };
  }
  if (event.kind === 'open-stage') {
    db.prepare(
      `INSERT INTO stage_runs (id, session_id, stage, practice_round, started_at, complete)
       VALUES (?, ?, ?, ?, ?, 0)
       ON CONFLICT(session_id, stage, practice_round) DO NOTHING`,
    ).run(randomUUID(), sessionId, event.stage, event.practiceRound, event.startedAt);
    if (event.stage === 'tokenGames') ensureTokenInit(db, sessionId, plan, event.clientEventId);
    markRunning(db, sessionId);
    return { plan, practice: null };
  }
  if (event.kind === 'trial') {
    insertTrial(db, sessionId, plan, event);
    markRunning(db, sessionId);
    return { plan, practice: null };
  }
  if (event.kind === 'interrupt') {
    insertInterrupt(db, sessionId, plan, event);
    saveCheckpoint(db, sessionId, event.checkpoint);
    db.prepare("UPDATE sessions SET status = 'interrupted' WHERE id = ? AND status != 'completed'").run(sessionId);
    return { plan, practice: null };
  }
  if (event.kind === 'questionnaire') {
    insertQuestionnaire(db, sessionId, plan, event);
    markRunning(db, sessionId);
    return { plan, practice: null };
  }
  if (event.kind === 'shopping-final') {
    saveShoppingFinal(db, sessionId, plan, event.productIds);
    markRunning(db, sessionId);
    return { plan, practice: null };
  }
  if (event.kind === 'close-practice') {
    const result = closePractice(db, sessionId, plan, event);
    return result;
  }
  if (event.kind === 'close-stage') {
    closeStage(db, sessionId, plan, event.stage, event.practiceRound);
    markRunning(db, sessionId);
    return { plan, practice: null };
  }
  const unknown: never = event;
  throw new StoreError(`رویداد ناشناخته است: ${String(unknown)}`, 400);
}

function saveCheckpoint(db: Database, sessionId: string, checkpoint: Checkpoint): void {
  if (typeof checkpoint.seq !== 'number') throw new StoreError('شمارهٔ نقطهٔ بازیابی لازم است.', 400);
  const current = db.prepare('SELECT seq FROM checkpoints WHERE session_id = ?').get(sessionId);
  if (current && Number(current.seq) >= checkpoint.seq) return;
  db.prepare(
    `INSERT INTO checkpoints (session_id, seq, payload_json, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET seq = excluded.seq, payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
  ).run(sessionId, checkpoint.seq, JSON.stringify(checkpoint), now());
}

function markRunning(db: Database, sessionId: string): void {
  db.prepare("UPDATE sessions SET status = 'inProgress' WHERE id = ? AND status = 'interrupted'").run(sessionId);
}

function ensureTokenInit(db: Database, sessionId: string, plan: StimulusPlan, clientEventId: string): void {
  const existing = db.prepare("SELECT id FROM token_events WHERE session_id = ? AND event_type = 'initialization'").get(sessionId);
  if (existing || plan.initialTokens === null) return;
  db.prepare(
    `INSERT INTO token_events (
      id, session_id, trial_id, client_event_id, event_type, trial_index, tokens_before, delta, tokens_after,
      actual_response, actual_correct, source, created_at
    ) VALUES (?, ?, NULL, ?, 'initialization', NULL, ?, 0, ?, NULL, NULL, 'programmed-random', ?)`,
  ).run(randomUUID(), sessionId, `${clientEventId}:init`, plan.initialTokens, plan.initialTokens, now());
}

function insertTrial(db: Database, sessionId: string, plan: StimulusPlan, event: Extract<ClientEvent, { kind: 'trial' }>): void {
  const found = findPlanTrial(plan, event.trialId);
  if (!found) throw new StoreError('آزمون در برنامهٔ این جلسه نیست.', 400);
  if (db.prepare('SELECT id FROM trials WHERE id = ?').get(event.trialId)) {
    throw new StoreError('این آزمون قبلاً ثبت شده است.', 409);
  }
  const responseKind = event.responseKind;
  const response = responseKind === 'response' ? event.response : null;
  if (responseKind === 'response' && response !== 'f' && response !== 'j' && found.stage !== 'emotion') {
    if (response !== 'f' && response !== 'j') throw new StoreError('پاسخ باید f یا j باشد.', 400);
  }
  const rtMs = responseKind === 'response' ? event.rtMs : null;
  if (responseKind === 'response' && (rtMs === null || rtMs < 0)) throw new StoreError('زمان واکنش پاسخ لازم است.', 400);
  const scored = scoreTrial(found.trial, response);
  const created = now();
  db.prepare(
    `INSERT INTO trials (
      id, session_id, client_event_id, stage, trial_index, practice_round, stimulus_id, stimulus_json,
      response, response_kind, correct, rt_ms, recognition_class, onset_at, offset_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    event.trialId,
    sessionId,
    event.clientEventId,
    found.stage,
    found.trial.index,
    roundOf(found.stage, event.trialId),
    scored.stimulusId,
    JSON.stringify(found.trial),
    response,
    responseKind,
    scored.correct,
    rtMs,
    scored.recognition,
    event.onsetAt,
    event.offsetAt,
    created,
  );
  if (found.stage === 'shopping' && 'practice' in found.trial && !found.trial.practice && response) {
    db.prepare(
      `INSERT INTO shopping_choices (session_id, product_id, initial_response, final_selected) VALUES (?, ?, ?, 0)
       ON CONFLICT(session_id, product_id) DO NOTHING`,
    ).run(sessionId, found.trial.productId, response);
  }
  if (found.stage === 'tokenGames' && 'tokenDelta' in found.trial && (responseKind === 'response' || responseKind === 'omission')) {
    writeToken(db, sessionId, plan, event.trialId, event.clientEventId, found.trial.index, response, scored.correct);
  }
}

function insertInterrupt(db: Database, sessionId: string, plan: StimulusPlan, event: Extract<ClientEvent, { kind: 'interrupt' }>): void {
  if (db.prepare('SELECT id FROM trials WHERE id = ?').get(event.trialId)) return;
  const found = findPlanTrial(plan, event.trialId);
  if (!found) throw new StoreError('آزمون قطع‌شده در برنامه نیست.', 400);
  db.prepare(
    `INSERT INTO trials (
      id, session_id, client_event_id, stage, trial_index, practice_round, stimulus_id, stimulus_json,
      response, response_kind, correct, rt_ms, recognition_class, onset_at, offset_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'interrupted', NULL, NULL, NULL, NULL, NULL, ?)`,
  ).run(
    event.trialId,
    sessionId,
    event.clientEventId,
    found.stage,
    found.trial.index,
    roundOf(found.stage, event.trialId),
    stimulusIdOf(found.trial),
    JSON.stringify(found.trial),
    now(),
  );
  db.prepare(
    `UPDATE stage_runs SET interrupted_trial_id = ? WHERE session_id = ? AND stage = ? AND practice_round = ?`,
  ).run(event.trialId, sessionId, found.stage, roundOf(found.stage, event.trialId));
}

function writeToken(
  db: Database,
  sessionId: string,
  plan: StimulusPlan,
  trialId: string,
  clientEventId: string,
  index: number,
  response: string | null,
  correct: number | null,
): void {
  if (plan.initialTokens === null) throw new StoreError('این جلسه مسیر توکن ندارد.', 400);
  const delta = plan.tokenDeltas[index];
  if (delta === undefined) throw new StoreError('تغییر توکن این آزمون در مسیر نیست.', 400);
  const before = balanceAfter(plan.initialTokens, plan.tokenDeltas, index);
  db.prepare(
    `INSERT INTO token_events (
      id, session_id, trial_id, client_event_id, event_type, trial_index, tokens_before, delta, tokens_after,
      actual_response, actual_correct, source, created_at
    ) VALUES (?, ?, ?, ?, 'response', ?, ?, ?, ?, ?, ?, 'programmed-random', ?)`,
  ).run(randomUUID(), sessionId, trialId, `${clientEventId}:token`, index, before, delta, before + delta, response, correct, now());
}

function insertQuestionnaire(db: Database, sessionId: string, plan: StimulusPlan, event: Extract<ClientEvent, { kind: 'questionnaire' }>): void {
  if (db.prepare('SELECT id FROM questionnaire_responses WHERE session_id = ? AND instrument = ? AND item_id = ?').get(sessionId, event.instrument, event.itemId)) {
    throw new StoreError('این پاسخ پرسشنامه قبلاً ثبت شده است.', 409);
  }
  let reversed: number | null = null;
  if (event.instrument === 'manipulation') {
    const item = MANIPULATION_ITEMS.find((entry) => entry.id === event.itemId);
    if (!item) throw new StoreError('گویهٔ بررسی کمبود نامعتبر است.', 400);
    if (event.rawValue !== null) {
      const raw = Number(event.rawValue);
      if (!Number.isInteger(raw) || raw < 1 || raw > 7) throw new StoreError('پاسخ بررسی کمبود باید بین ۱ و ۷ باشد.', 400);
      reversed = item.reverse ? 8 - raw : raw;
    }
  } else if (event.instrument === 'panas') {
    const item = EMOTION_ITEMS.find((entry) => entry.id === event.itemId);
    if (!item) throw new StoreError('گویهٔ هیجان نامعتبر است.', 400);
    if (event.rawValue !== null) {
      const raw = Number(event.rawValue);
      if (!Number.isInteger(raw) || raw < 1 || raw > 5) throw new StoreError('پاسخ هیجان باید بین ۱ و ۵ باشد.', 400);
    }
  } else {
    if (event.rawValue === null) throw new StoreError('پاسخ یادآوری لازم است.', 400);
    const recall = plan.stages.find((stage) => stage.stage === 'recall');
    if (!recall || recall.stage !== 'recall') throw new StoreError('این جلسه یادآوری ندارد.', 400);
    const question = recall.questions.find((entry) => entry.id === event.itemId);
    if (!question) throw new StoreError('سؤال یادآوری نامعتبر است.', 400);
    const option = question.options.find((entry) => entry.id === event.rawValue);
    if (!option) throw new StoreError('گزینهٔ یادآوری نامعتبر است.', 400);
    if (option.allowsText && !event.otherText?.trim()) throw new StoreError('برای گزینهٔ سایر، توضیح لازم است.', 400);
  }
  db.prepare(
    `INSERT INTO questionnaire_responses (
      id, session_id, client_event_id, instrument, item_id, raw_value, reversed_value, other_text, rt_ms, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), sessionId, event.clientEventId, event.instrument, event.itemId, event.rawValue, reversed, event.otherText, event.rtMs, now());
}

function saveShoppingFinal(db: Database, sessionId: string, plan: StimulusPlan, productIds: string[]): void {
  const shopping = plan.stages.find((stage) => stage.stage === 'shopping');
  if (!shopping || shopping.stage !== 'shopping') throw new StoreError('این جلسه مرحلهٔ خرید ندارد.', 400);
  const main = shopping.trials.filter((trial) => !trial.practice);
  if (productIds.length !== 10 || new Set(productIds).size !== 10) throw new StoreError('باید دقیقاً ده کالای نهایی انتخاب شود.', 400);
  const allowed = new Set(main.map((trial) => trial.productId));
  for (const productId of productIds) {
    if (!allowed.has(productId)) throw new StoreError('کالای نهایی در مجموعهٔ اصلی نیست.', 400);
  }
  const selected = new Set(productIds);
  for (const trial of main) {
    db.prepare(
      `INSERT INTO shopping_choices (session_id, product_id, initial_response, final_selected) VALUES (?, ?, NULL, ?)
       ON CONFLICT(session_id, product_id) DO UPDATE SET final_selected = excluded.final_selected`,
    ).run(sessionId, trial.productId, selected.has(trial.productId) ? 1 : 0);
  }
}

function closePractice(
  db: Database,
  sessionId: string,
  plan: StimulusPlan,
  event: Extract<ClientEvent, { kind: 'close-practice' }>,
): { plan: StimulusPlan; practice: { stage: string; practiceRound: number; accuracy: number; passed: boolean } } {
  const stage = plan.stages.find((item) => item.stage === event.stage);
  if (!stage || (stage.stage !== 'spatialPractice' && stage.stage !== 'switchPractice')) {
    throw new StoreError('مرحلهٔ تمرین در برنامه نیست.', 400);
  }
  const roundTrials = stage.rounds[event.practiceRound];
  if (!roundTrials) throw new StoreError('این دور تمرین وجود ندارد.', 400);
  const closed = db.prepare('SELECT ended_at, passed_gate, accuracy FROM stage_runs WHERE session_id = ? AND stage = ? AND practice_round = ?').get(sessionId, event.stage, event.practiceRound);
  if (closed?.ended_at) {
    return {
      plan,
      practice: {
        stage: event.stage,
        practiceRound: event.practiceRound,
        accuracy: Number(closed.accuracy ?? 0),
        passed: Number(closed.passed_gate) === 1,
      },
    };
  }
  const rows = db.prepare('SELECT id, correct FROM trials WHERE session_id = ? AND stage = ? AND practice_round = ?').all(sessionId, event.stage, event.practiceRound);
  const byId = new Map(rows.map((row) => [String(row.id), Number(row.correct)]));
  let correct = 0;
  for (const trial of roundTrials) {
    if (byId.get(trial.id) === 1) correct += 1;
  }
  const accuracy = roundTrials.length === 0 ? 0 : correct / roundTrials.length;
  const passed = passedPracticeGate(correct, roundTrials.length);
  db.prepare(
    `INSERT INTO stage_runs (id, session_id, stage, practice_round, ended_at, passed_gate, accuracy, complete)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id, stage, practice_round) DO UPDATE SET
       ended_at = excluded.ended_at, passed_gate = excluded.passed_gate, accuracy = excluded.accuracy, complete = excluded.complete`,
  ).run(randomUUID(), sessionId, event.stage, event.practiceRound, now(), passed ? 1 : 0, accuracy, passed ? 1 : 0);
  let nextPlan = plan;
  if (!passed) {
    const rng = mulberry32((plan.seed + (stage.rounds.length + 1) * 997) >>> 0);
    nextPlan = appendPracticeRound(plan, event.stage, rng);
  }
  return { plan: nextPlan, practice: { stage: event.stage, practiceRound: event.practiceRound, accuracy, passed } };
}

function closeStage(db: Database, sessionId: string, plan: StimulusPlan, stageName: string, practiceRound: number): void {
  const missing = missingStageRecords(db, sessionId, plan, stageName);
  if (missing.length > 0) throw new StoreError(`مرحله هنوز کامل نیست: ${missing.slice(0, 5).join('، ')}`, 409);
  db.prepare(
    `INSERT INTO stage_runs (id, session_id, stage, practice_round, ended_at, complete)
     VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT(session_id, stage, practice_round) DO UPDATE SET ended_at = excluded.ended_at, complete = 1`,
  ).run(randomUUID(), sessionId, stageName, practiceRound, now());
  if (stageName === 'tokenGames') storeReward(db, sessionId, plan);
}

function missingStageRecords(db: Database, sessionId: string, plan: StimulusPlan, stageName: string): string[] {
  const stage = plan.stages.find((item) => item.stage === stageName);
  if (!stage) return [`مرحلهٔ ${stageName} در برنامه نیست`];
  if (stage.stage === 'spatialPractice' || stage.stage === 'switchPractice') {
    const passed = db.prepare('SELECT id FROM stage_runs WHERE session_id = ? AND stage = ? AND passed_gate = 1').get(sessionId, stageName);
    return passed ? [] : ['قبولی تمرین ۹۰ درصد'];
  }
  if (stage.stage === 'emotion') return missingItems(db, sessionId, 'panas', stage.trials.map((trial) => trial.itemId));
  if (stage.stage === 'recall') return missingItems(db, sessionId, 'recall', stage.questions.map((question) => question.id));
  if (stage.stage === 'manipulation') return missingItems(db, sessionId, 'manipulation', stage.items.map((item) => item.id));
  if (stage.stage === 'shopping') {
    const missing = missingTrials(db, sessionId, stage.trials.map((trial) => trial.id));
    const finals = db.prepare('SELECT COUNT(*) AS c FROM shopping_choices WHERE session_id = ? AND final_selected = 1').get(sessionId);
    if (Number(finals?.c ?? 0) !== 10) missing.push('ده انتخاب نهایی');
    return missing;
  }
  if (stage.stage === 'switch') {
    return missingTrials(db, sessionId, stage.blocks.flatMap((block) => block.map((trial) => trial.id)));
  }
  if ('trials' in stage) return missingTrials(db, sessionId, stage.trials.map((trial) => trial.id));
  return [];
}

function missingTrials(db: Database, sessionId: string, ids: string[]): string[] {
  const existing = new Set(db.prepare('SELECT id FROM trials WHERE session_id = ?').all(sessionId).map((row) => String(row.id)));
  return ids.filter((id) => !existing.has(id));
}

function missingItems(db: Database, sessionId: string, instrument: string, ids: string[]): string[] {
  const existing = new Set(
    db.prepare('SELECT item_id FROM questionnaire_responses WHERE session_id = ? AND instrument = ?').all(sessionId, instrument).map((row) => String(row.item_id)),
  );
  return ids.filter((id) => !existing.has(id));
}

function storeReward(db: Database, sessionId: string, plan: StimulusPlan): void {
  const last = db
    .prepare("SELECT tokens_after FROM token_events WHERE session_id = ? AND event_type = 'response' ORDER BY trial_index DESC LIMIT 1")
    .get(sessionId);
  const tokens = last ? Number(last.tokens_after) : plan.initialTokens;
  const reward = tokens === null ? null : rewardCountForTokens(tokens);
  db.prepare('UPDATE sessions SET final_tokens = ?, reward_count = ?, reward_status = ? WHERE id = ?').run(
    tokens,
    reward,
    reward === null ? 'ruleNotSpecified' : 'determined',
    sessionId,
  );
}

export function completeSession(db: Database, sessionId: string): void {
  const session = db.prepare('SELECT status FROM sessions WHERE id = ?').get(sessionId);
  if (!session) throw new StoreError('جلسه پیدا نشد.', 404);
  if (session.status === 'completed') return;
  const plan = loadPlan(db, sessionId);
  const missing: string[] = [];
  for (const stage of plan.stages) {
    const gap = missingStageRecords(db, sessionId, plan, stage.stage);
    if (gap.length > 0) missing.push(stage.stage);
    const closed = db.prepare('SELECT id FROM stage_runs WHERE session_id = ? AND stage = ? AND complete = 1').get(sessionId, stage.stage);
    if (!closed) missing.push(`${stage.stage}:open`);
  }
  if (missing.length > 0) throw new StoreError(`جلسه هنوز کامل نیست: ${[...new Set(missing)].join('، ')}`, 409);
  transaction(db, () => {
    db.prepare("UPDATE sessions SET status = 'completed', save_status = 'saved', completed_at = ? WHERE id = ?").run(now(), sessionId);
    writeScores(db, sessionId);
  });
}

export function writeScores(db: Database, sessionId: string): void {
  const trials = db.prepare('SELECT * FROM trials WHERE session_id = ?').all(sessionId).map(toScoreTrial);
  const questionnaires = db.prepare('SELECT * FROM questionnaire_responses WHERE session_id = ?').all(sessionId).map(toScoreQuestion);
  const scores = summarizeSession(trials, questionnaires);
  const encodingInterrupted = trials.filter((trial) => trial.stage === 'encoding' && trial.responseKind === 'interrupted').length;
  db.prepare(
    `INSERT INTO session_scores (
      session_id, inhibition_cost, inhibition_excluded, inhibition_exclusion_reason, d_prime,
      recognition_mean_correct_rt, switch_cost, panas_positive, panas_negative, manipulation_mean, detail_json, computed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      inhibition_cost = excluded.inhibition_cost,
      inhibition_excluded = excluded.inhibition_excluded,
      inhibition_exclusion_reason = excluded.inhibition_exclusion_reason,
      d_prime = excluded.d_prime,
      recognition_mean_correct_rt = excluded.recognition_mean_correct_rt,
      switch_cost = excluded.switch_cost,
      panas_positive = excluded.panas_positive,
      panas_negative = excluded.panas_negative,
      manipulation_mean = excluded.manipulation_mean,
      detail_json = excluded.detail_json,
      computed_at = excluded.computed_at`,
  ).run(
    sessionId,
    scores.inhibitionCost,
    scores.inhibitionExcluded ? 1 : 0,
    scores.inhibitionExclusionReason,
    scores.dPrime,
    scores.recognitionMeanCorrectRt,
    scores.switchCost,
    scores.panasPositive,
    scores.panasNegative,
    scores.manipulationMean,
    JSON.stringify({ ...scores.detail, encodingInterrupted }),
    now(),
  );
}

function toScoreTrial(row: SqlRow): ScoreTrial {
  const stimulus = JSON.parse(String(row.stimulus_json ?? '{}')) as {
    stimulusType?: string;
    wordType?: string;
    valence?: 'positive' | 'negative';
    excludeFromSwitchCost?: boolean;
  };
  return {
    stage: String(row.stage),
    response: row.response === null || row.response === undefined ? null : String(row.response),
    responseKind: String(row.response_kind),
    correct: row.correct === null || row.correct === undefined ? null : Number(row.correct) === 1,
    rtMs: row.rt_ms === null || row.rt_ms === undefined ? null : Number(row.rt_ms),
    stimulusType: stimulus.stimulusType ?? stimulus.wordType,
    valence: stimulus.valence,
    recognitionClass: (row.recognition_class as ScoreTrial['recognitionClass']) ?? null,
    excludeFromSwitchCost: stimulus.excludeFromSwitchCost,
  };
}

function toScoreQuestion(row: SqlRow): ScoreQuestionnaire {
  const itemId = String(row.item_id);
  const emotion = EMOTION_ITEMS.find((item) => item.id === itemId);
  const manipulation = MANIPULATION_ITEMS.find((item) => item.id === itemId);
  return {
    instrument: String(row.instrument),
    itemId,
    rawValue: row.raw_value === null || row.raw_value === undefined ? null : String(row.raw_value),
    reversedValue: row.reversed_value === null || row.reversed_value === undefined ? null : Number(row.reversed_value),
    valence: emotion?.valence,
    reverse: manipulation?.reverse,
  };
}

export function addNote(db: Database, sessionId: string, note: string, stage: string | null): void {
  if (!db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId)) throw new StoreError('جلسه پیدا نشد.', 404);
  if (!note.trim()) throw new StoreError('یادداشت خالی است.', 400);
  db.prepare('INSERT INTO observer_notes (id, session_id, stage, note, created_at) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), sessionId, stage, note.trim(), now());
}

export function setDeliveredRewards(db: Database, sessionId: string, productIds: string[]): void {
  const selected = db.prepare('SELECT product_id FROM shopping_choices WHERE session_id = ? AND final_selected = 1').all(sessionId);
  if (selected.length === 0) throw new StoreError('انتخاب نهایی خرید هنوز ثبت نشده است.', 409);
  const allowed = new Set(selected.map((row) => String(row.product_id)));
  for (const productId of productIds) {
    if (!allowed.has(productId)) throw new StoreError('فقط کالاهای انتخاب‌شده قابل تحویل هستند.', 400);
  }
  const chosen = new Set(productIds);
  transaction(db, () => {
    for (const productId of allowed) {
      db.prepare(
        `INSERT INTO reward_deliveries (session_id, product_id, delivered) VALUES (?, ?, ?)
         ON CONFLICT(session_id, product_id) DO UPDATE SET delivered = excluded.delivered`,
      ).run(sessionId, productId, chosen.has(productId) ? 1 : 0);
    }
  });
}

export function loadPlan(db: Database, sessionId: string): StimulusPlan {
  const row = db.prepare('SELECT plan_json FROM stimulus_plans WHERE session_id = ?').get(sessionId);
  if (!row) throw new StoreError('برنامهٔ محرک‌ها پیدا نشد.', 404);
  return JSON.parse(String(row.plan_json)) as StimulusPlan;
}

export function listSessions(db: Database): SqlRow[] {
  return db
    .prepare(
      `SELECT s.id, s.participant_id, s.mode, s.measurement_period, s.status, s.save_status, s.final_tokens, s.reward_count, s.created_at, s.completed_at,
              p.group_name, p.school_id
       FROM sessions s JOIN participants p ON p.id = s.participant_id
       ORDER BY s.created_at DESC`,
    )
    .all();
}

function scoreTrial(trial: AnyTrial, response: string | null): { correct: number | null; recognition: string | null; stimulusId: string } {
  const key = response === 'f' || response === 'j' ? response : null;
  if ('wordType' in trial) {
    return {
      correct: key ? (key === trial.correctKey ? 1 : 0) : null,
      recognition: recognitionClass(trial.wordType, key),
      stimulusId: trial.wordId,
    };
  }
  if ('productId' in trial) return { correct: null, recognition: null, stimulusId: trial.productId };
  if ('wordId' in trial && !('correctKey' in trial)) return { correct: null, recognition: null, stimulusId: trial.wordId };
  return {
    correct: key ? (key === trial.correctKey ? 1 : 0) : null,
    recognition: null,
    stimulusId: trial.id,
  };
}

function stimulusIdOf(trial: AnyTrial): string {
  return scoreTrial(trial, null).stimulusId;
}

function roundOf(stage: string, trialId: string): number {
  const parts = trialId.split(':');
  if (stage === 'spatialPractice') return Number(parts[1] ?? 0);
  if (stage === 'switchPractice') return Number(parts[2] ?? 0);
  if (stage === 'switch') return Number(parts[1] ?? 0);
  return 0;
}

function defaultCheckpoint(): Checkpoint {
  return { seq: 0, stageIndex: 0, trialIndex: 0, practiceRound: 0, phase: 'instruction', shoppingWants: [], pendingProductId: null, updatedAt: now() };
}

function optionalInt(value: number | null, min: number, max: number, label: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < min || value > max) throw new StoreError(`${label} خارج از بازهٔ مجاز است.`, 400);
  return value;
}

function optionalNumber(value: number | null, min: number, max: number, label: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < min || value > max) throw new StoreError(`${label} خارج از بازهٔ مجاز است.`, 400);
  return value;
}
