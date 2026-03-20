import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type BetterSqlite3 from 'better-sqlite3'

// better-sqlite3 是 CommonJS 模块，通过 createRequire 加载
const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Database = require('better-sqlite3') as typeof BetterSqlite3

type BetterSqlite3Database = InstanceType<typeof Database>

interface SqliteVecModule {
  load(db: { loadExtension(path: string, entryPoint?: string): void }): void
}

interface SqliteVecStatus {
  available: boolean
  error?: string
}

let db: BetterSqlite3Database | null = null
let sqliteVecStatus: SqliteVecStatus = { available: false }

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function ensureColumn(
  database: BetterSqlite3Database,
  tableName: string,
  columnName: string,
  definition: string,
): void {
  const columns = database.pragma(`table_info(${tableName})`) as Array<{ name: string }>
  const existingColumnNames = new Set(columns.map((column) => column.name))

  if (!existingColumnNames.has(columnName)) {
    database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`)
  }
}

function ensureMemorySchema(database: BetterSqlite3Database): void {
  ensureColumn(database, 'memories', 'embedding_status', `TEXT NOT NULL DEFAULT 'pending'`)
  ensureColumn(database, 'memories', 'embedding_model', 'TEXT')
  ensureColumn(database, 'memories', 'embedded_at', 'INTEGER')
  ensureColumn(database, 'memories', 'embedding_error', 'TEXT')
  ensureColumn(database, 'memories', 'is_pinned', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(database, 'memories', 'pinned_at', 'INTEGER')
  ensureColumn(database, 'memories', 'pin_source', 'TEXT')
  ensureColumn(database, 'memories', 'pin_reason', 'TEXT')

  database.exec(`
    CREATE TABLE IF NOT EXISTS memory_embeddings (
      memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
      embedding BLOB NOT NULL,
      embedding_model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
}

function ensureSessionSchema(database: BetterSqlite3Database): void {
  ensureColumn(database, 'sessions', 'registry_snapshot', 'TEXT')
}

function ensureProviderSettingsSchema(database: BetterSqlite3Database): void {
  ensureColumn(database, 'provider_settings', 'settings_json', 'TEXT')
}

function ensureTaskSchema(database: BetterSqlite3Database): void {
  ensureColumn(database, 'tasks', 'kind', `TEXT NOT NULL DEFAULT 'orchestration'`)
  ensureColumn(database, 'tasks', 'registry_snapshot', 'TEXT')
  ensureColumn(database, 'tasks', 'pipeline_id', 'TEXT')
  ensureColumn(database, 'tasks', 'pipeline_version', 'INTEGER')
}

function ensureSkillSchema(database: BetterSqlite3Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS skill_settings (
      skill_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      trusted INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
  `)
}

function ensurePipelineSchema(database: BetterSqlite3Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS pipelines (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      definition TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
}

function tryLoadSqliteVec(database: BetterSqlite3Database): void {
  try {
    const sqliteVec = require('sqlite-vec') as SqliteVecModule
    sqliteVec.load(database)
    database.prepare('SELECT vec_version() AS version').get()
    sqliteVecStatus = { available: true }
  } catch (error) {
    sqliteVecStatus = {
      available: false,
      error: toErrorMessage(error),
    }
  }
}

function resolveSchemaPath(): string {
  const candidates = [
    join(__dirname, 'schema.sql'),
    join(process.cwd(), 'src', 'storage', 'schema.sql'),
    join(process.cwd(), 'server', 'src', 'storage', 'schema.sql'),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  throw new Error(`Schema file not found. Tried: ${candidates.join(', ')}`)
}

export function initDb(dbPath: string): BetterSqlite3Database {
  if (db) {
    return db
  }

  db = new Database(dbPath)

  // 开启 WAL 模式提高并发性能
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // 执行 schema 初始化
  const schemaPath = resolveSchemaPath()
  const schema = readFileSync(schemaPath, 'utf8')
  db.exec(schema)

  ensureSessionSchema(db)
  ensureProviderSettingsSchema(db)
  ensureTaskSchema(db)
  ensureSkillSchema(db)
  ensurePipelineSchema(db)
  ensureMemorySchema(db)
  tryLoadSqliteVec(db)

  // 安全迁移：为已存在的 task_steps 表补充新列（如 DB 已存在则 CREATE TABLE IF NOT EXISTS 不会重建）
  const taskStepColumns = db.pragma('table_info(task_steps)') as Array<{ name: string }>
  const existingColumnNames = new Set(taskStepColumns.map((c) => c.name))
  if (!existingColumnNames.has('summary')) {
    db.exec(`ALTER TABLE task_steps ADD COLUMN summary TEXT`)
  }

  return db
}

export function getDb(): BetterSqlite3Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb(dbPath) first.')
  }
  return db
}

export function getDbCapabilities(): { sqliteVec: SqliteVecStatus } {
  return {
    sqliteVec: { ...sqliteVecStatus },
  }
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }

  sqliteVecStatus = { available: false }
}
