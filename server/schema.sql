PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('girls', 'boys')),
  region TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  group_name TEXT NOT NULL CHECK (group_name IN ('scarcity', 'control')),
  consent_parent INTEGER NOT NULL DEFAULT 0,
  consent_student INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS demographics (
  participant_id TEXT PRIMARY KEY REFERENCES participants(id),
  age_years INTEGER,
  recent_gpa REAL,
  sibling_count INTEGER,
  father_education INTEGER,
  mother_education INTEGER,
  home_book_count INTEGER,
  monthly_income_per_capita REAL,
  income_unit TEXT,
  income_collected_on TEXT,
  home_ownership INTEGER,
  home_area_level INTEGER,
  area_above_regional_median INTEGER,
  appliances_json TEXT,
  appliance_count INTEGER,
  appliance_gt6 INTEGER,
  asset_index REAL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id),
  mode TEXT NOT NULL CHECK (mode IN ('baseline', 'main')),
  measurement_period TEXT NOT NULL CHECK (measurement_period IN ('pre', 'post')),
  status TEXT NOT NULL CHECK (status IN ('inProgress', 'interrupted', 'completed')),
  save_status TEXT NOT NULL CHECK (save_status IN ('pending', 'saved', 'failed')),
  protocol_version TEXT NOT NULL,
  protocol_settings_json TEXT NOT NULL,
  game_order TEXT,
  manifest_hash TEXT NOT NULL,
  final_tokens INTEGER,
  reward_count INTEGER,
  reward_status TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  UNIQUE (participant_id, mode)
);

CREATE TABLE IF NOT EXISTS stimulus_plans (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id),
  seed INTEGER NOT NULL,
  plan_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stage_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  stage TEXT NOT NULL,
  practice_round INTEGER NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  passed_gate INTEGER,
  accuracy REAL,
  interrupted_trial_id TEXT,
  complete INTEGER NOT NULL DEFAULT 0,
  UNIQUE (session_id, stage, practice_round)
);

CREATE TABLE IF NOT EXISTS trials (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  client_event_id TEXT NOT NULL UNIQUE,
  stage TEXT NOT NULL,
  trial_index INTEGER NOT NULL,
  practice_round INTEGER,
  stimulus_id TEXT,
  stimulus_json TEXT NOT NULL,
  response TEXT,
  response_kind TEXT NOT NULL,
  correct INTEGER,
  rt_ms INTEGER,
  recognition_class TEXT,
  onset_at TEXT,
  offset_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS token_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  trial_id TEXT,
  client_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  trial_index INTEGER,
  tokens_before INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  tokens_after INTEGER NOT NULL,
  actual_response TEXT,
  actual_correct INTEGER,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS questionnaire_responses (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  client_event_id TEXT NOT NULL UNIQUE,
  instrument TEXT NOT NULL,
  item_id TEXT NOT NULL,
  raw_value TEXT,
  reversed_value REAL,
  other_text TEXT,
  rt_ms INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE (session_id, instrument, item_id)
);

CREATE TABLE IF NOT EXISTS shopping_choices (
  session_id TEXT NOT NULL REFERENCES sessions(id),
  product_id TEXT NOT NULL,
  initial_response TEXT,
  final_selected INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, product_id)
);

CREATE TABLE IF NOT EXISTS reward_deliveries (
  session_id TEXT NOT NULL REFERENCES sessions(id),
  product_id TEXT NOT NULL,
  delivered INTEGER NOT NULL,
  PRIMARY KEY (session_id, product_id)
);

CREATE TABLE IF NOT EXISTS observer_notes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  stage TEXT,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checkpoints (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id),
  seq INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS applied_events (
  client_event_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_scores (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id),
  inhibition_cost REAL,
  inhibition_excluded INTEGER NOT NULL,
  inhibition_exclusion_reason TEXT,
  d_prime REAL,
  recognition_mean_correct_rt REAL,
  switch_cost REAL,
  panas_positive REAL,
  panas_negative REAL,
  manipulation_mean REAL,
  detail_json TEXT NOT NULL,
  computed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_participants_school ON participants(school_id);
CREATE INDEX IF NOT EXISTS idx_sessions_participant ON sessions(participant_id);
CREATE INDEX IF NOT EXISTS idx_trials_session ON trials(session_id);
CREATE INDEX IF NOT EXISTS idx_token_session ON token_events(session_id);
