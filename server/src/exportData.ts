import type { Database, SqlRow } from './db';
import { writeScores } from './store';

export function trialsCsv(db: Database): string {
  const rows = db
    .prepare(
      `SELECT t.session_id, s.participant_id, p.school_id, p.group_name, s.mode, s.measurement_period,
              t.stage, t.id AS trial_id, t.trial_index, t.practice_round, t.stimulus_id, t.response,
              t.response_kind, t.correct, t.rt_ms, t.recognition_class, t.onset_at, t.offset_at, t.stimulus_json
       FROM trials t
       JOIN sessions s ON s.id = t.session_id
       JOIN participants p ON p.id = s.participant_id
       ORDER BY s.created_at, t.stage, t.trial_index`,
    )
    .all();
  const spatial = rows.filter((row) => row.stage === 'spatial');
  const excluded = stage4Excluded(spatial);
  return toCsv(
    rows.map((row) => {
      const flagged = excluded.get(String(row.trial_id));
      return {
        session_id: row.session_id,
        participant_id: row.participant_id,
        school_id: row.school_id,
        group_name: row.group_name,
        mode: row.mode,
        measurement_period: row.measurement_period,
        stage: row.stage,
        trial_id: row.trial_id,
        trial_index: row.trial_index,
        practice_round: row.practice_round,
        stimulus_id: row.stimulus_id,
        response: row.response,
        response_kind: row.response_kind,
        correct: row.correct,
        rt_ms: row.rt_ms,
        recognition_class: row.recognition_class,
        onset_at: row.onset_at,
        offset_at: row.offset_at,
        analysis_exclusion: flagged ?? '',
      };
    }),
  );
}

export function questionnairesCsv(db: Database): string {
  const rows = db
    .prepare(
      `SELECT q.session_id, s.participant_id, p.school_id, p.group_name, s.mode, s.measurement_period,
              q.instrument, q.item_id, q.raw_value, q.reversed_value, q.other_text, q.rt_ms
       FROM questionnaire_responses q
       JOIN sessions s ON s.id = q.session_id
       JOIN participants p ON p.id = s.participant_id
       ORDER BY s.created_at, q.instrument, q.item_id`,
    )
    .all();
  return toCsv(rows);
}

export function participantPeriodCsv(db: Database): string {
  const sessions = db.prepare('SELECT id FROM sessions').all();
  for (const session of sessions) writeScores(db, String(session.id));
  const rows = db
    .prepare(
      `SELECT s.participant_id, s.id AS session_id, p.school_id, sc.gender AS school_gender,
              CASE p.group_name WHEN 'scarcity' THEN 1 ELSE 0 END AS treatment,
              CASE s.measurement_period WHEN 'post' THEN 1 ELSE 0 END AS post,
              s.mode, s.status,
              d.age_years, d.recent_gpa, d.sibling_count, d.father_education, d.mother_education,
              d.home_book_count, d.monthly_income_per_capita, d.home_ownership, d.home_area_level,
              d.appliance_count, d.appliance_gt6, d.area_above_regional_median, d.asset_index,
              scs.inhibition_cost, scs.inhibition_excluded, scs.d_prime, scs.switch_cost,
              scs.panas_positive, scs.panas_negative, scs.manipulation_mean
       FROM sessions s
       JOIN participants p ON p.id = s.participant_id
       JOIN schools sc ON sc.id = p.school_id
       LEFT JOIN demographics d ON d.participant_id = p.id
       LEFT JOIN session_scores scs ON scs.session_id = s.id
       ORDER BY s.participant_id, s.measurement_period`,
    )
    .all();
  return toCsv(rows);
}

export function sessionJson(db: Database, sessionId: string, applicationVersion: string): Record<string, unknown> {
  writeScores(db, sessionId);
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) return {};
  const participant = db.prepare('SELECT * FROM participants WHERE id = ?').get(String(session.participant_id));
  const school = participant ? db.prepare('SELECT * FROM schools WHERE id = ?').get(String(participant.school_id)) : undefined;
  const plan = db.prepare('SELECT plan_json, seed FROM stimulus_plans WHERE session_id = ?').get(sessionId);
  return {
    schemaVersion: 1,
    protocolVersion: session.protocol_version,
    applicationVersion,
    sessionMetadata: { session, participant, school },
    protocolSettings: JSON.parse(String(session.protocol_settings_json)),
    stimulusPlan: plan ? JSON.parse(String(plan.plan_json)) : null,
    rawResponses: db.prepare('SELECT * FROM trials WHERE session_id = ? ORDER BY created_at').all(sessionId),
    tokenEvents: db.prepare('SELECT * FROM token_events WHERE session_id = ? ORDER BY created_at').all(sessionId),
    questionnaireResponses: db.prepare('SELECT * FROM questionnaire_responses WHERE session_id = ?').all(sessionId),
    shoppingChoices: db.prepare('SELECT * FROM shopping_choices WHERE session_id = ?').all(sessionId),
    rewardDeliveries: db.prepare('SELECT * FROM reward_deliveries WHERE session_id = ?').all(sessionId),
    stageExecutions: db.prepare('SELECT * FROM stage_runs WHERE session_id = ?').all(sessionId),
    observerNotes: db.prepare('SELECT * FROM observer_notes WHERE session_id = ? ORDER BY created_at').all(sessionId),
    analysisSummary: db.prepare('SELECT * FROM session_scores WHERE session_id = ?').get(sessionId) ?? null,
    qualityReport: {
      status: session.status,
      saveStatus: session.save_status,
      completed: session.status === 'completed',
    },
  };
}

function stage4Excluded(rows: SqlRow[]): Map<string, string> {
  const bySession = new Map<string, SqlRow[]>();
  for (const row of rows) {
    const key = String(row.session_id);
    const list = bySession.get(key) ?? [];
    list.push(row);
    bySession.set(key, list);
  }
  const flags = new Map<string, string>();
  for (const list of bySession.values()) {
    const answered = list.filter((row) => row.rt_ms !== null && row.rt_ms !== undefined).map((row) => Number(row.rt_ms));
    const avg = answered.length === 0 ? 0 : answered.reduce((sum, value) => sum + value, 0) / answered.length;
    const variance = answered.length === 0 ? 0 : answered.reduce((sum, value) => sum + (value - avg) ** 2, 0) / answered.length;
    const spread = Math.sqrt(variance);
    const omissions = list.filter((row) => row.response_kind === 'omission').length;
    const omissionRate = list.length === 0 ? 0 : omissions / list.length;
    for (const row of list) {
      if (row.rt_ms === null || row.rt_ms === undefined) continue;
      const rt = Number(row.rt_ms);
      if (rt < 150) flags.set(String(row.trial_id), 'rt-below-150');
      else if (spread > 0 && rt > avg + 3 * spread) flags.set(String(row.trial_id), 'rt-above-3sd');
    }
    if (omissionRate > 0.2) {
      for (const row of list) flags.set(String(row.trial_id), flags.get(String(row.trial_id)) ?? 'participant-omissions-over-20-percent');
    }
  }
  return flags;
}

export function toCsv(rows: Array<SqlRow | Record<string, unknown>>): string {
  if (rows.length === 0) return '\uFEFF';
  const headers = Object.keys(rows[0] ?? {});
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => csvCell(row[header])).join(','));
  }
  return `\uFEFF${lines.join('\n')}`;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
