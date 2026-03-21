CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  metadata TEXT,
  registry_snapshot TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  token_count INTEGER
);

CREATE TABLE IF NOT EXISTS provider_settings (
  provider TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  endpoint TEXT,
  settings_json TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  kind TEXT NOT NULL DEFAULT 'orchestration',
  run_version INTEGER NOT NULL DEFAULT 1,
  team_members TEXT NOT NULL,
  objective TEXT NOT NULL,
  plan TEXT,
  registry_snapshot TEXT,
  pipeline_id TEXT,
  pipeline_version INTEGER,
  result TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS task_steps (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  run_version INTEGER NOT NULL DEFAULT 1,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  objective TEXT NOT NULL,
  result TEXT,
  error TEXT,
  summary TEXT,
  token_count INTEGER,
  started_at INTEGER,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS task_messages (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  run_version INTEGER NOT NULL DEFAULT 1,
  role TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'chat',
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_messages_task_id ON task_messages(task_id, created_at);

CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_input TEXT NOT NULL,
  tool_output TEXT,
  is_error INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
CREATE INDEX IF NOT EXISTS idx_tool_calls_task_id ON tool_calls(task_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_step_id ON tool_calls(step_id);

CREATE TABLE IF NOT EXISTS skill_settings (
  skill_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  trusted INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS imported_skills (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  original_filename TEXT,
  sha256 TEXT NOT NULL,
  imported_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pipelines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  definition TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  agent_id TEXT,
  task_id TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at INTEGER NOT NULL,
  embedding_status TEXT NOT NULL DEFAULT 'pending',
  embedding_model TEXT,
  embedded_at INTEGER,
  embedding_error TEXT,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  pinned_at INTEGER,
  pin_source TEXT,
  pin_reason TEXT
);

CREATE TABLE IF NOT EXISTS memory_embeddings (
  memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  embedding BLOB NOT NULL,
  embedding_model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content,
  agent_id UNINDEXED,
  task_id UNINDEXED,
  category UNINDEXED,
  content='memories',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content, agent_id, task_id, category)
  VALUES (new.rowid, new.content, new.agent_id, new.task_id, new.category);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, agent_id, task_id, category)
  VALUES ('delete', old.rowid, old.content, old.agent_id, old.task_id, old.category);
END;

-- Entity table for Knowledge Graph
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT,
  source_memory_id TEXT REFERENCES memories(id) ON DELETE SET NULL,
  embedding_status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Relation table for Knowledge Graph
CREATE TABLE IF NOT EXISTS relations (
  id TEXT PRIMARY KEY,
  source_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  target_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  source_memory_id TEXT REFERENCES memories(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);

-- Entity embeddings for deduplication
CREATE TABLE IF NOT EXISTS entity_embeddings (
  entity_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  embedding BLOB NOT NULL,
  embedding_model TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
