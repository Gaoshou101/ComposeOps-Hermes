import Database from 'better-sqlite3';
import { chmodSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/opsdash.db');

const db = new Database(DB_PATH);
chmodSync(DB_PATH, 0o600);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 建表：平台配置（KV）与 AI 对话历史
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ai_history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    role       TEXT NOT NULL,          -- user | assistant | system
    content    TEXT NOT NULL,
    context    TEXT,                    -- JSON: 关联的日志/compose 文件等上下文标记
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS project_preferences (
    project_id TEXT PRIMARY KEY,
    managed INTEGER NOT NULL DEFAULT 0,
    favorite INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS compose_backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    content TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT 'save',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS operation_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT,
    project_name TEXT,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// 兼容已有数据库：新增项目纳管白名单，历史项目默认不自动获得操作权限。
const projectPreferenceColumns = db.prepare('PRAGMA table_info(project_preferences)').all();
if (!projectPreferenceColumns.some((column) => column.name === 'managed')) {
  db.exec('ALTER TABLE project_preferences ADD COLUMN managed INTEGER NOT NULL DEFAULT 0');
}

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

export function addAiMessage(role, content, context = null) {
  db.prepare(
    'INSERT INTO ai_history(role, content, context) VALUES(?, ?, ?)'
  ).run(role, content, context ? JSON.stringify(context) : null);
  return db.prepare('SELECT last_insert_rowid() AS id').get().id;
}

export function getAiHistory(limit = 50) {
  return db.prepare(
    'SELECT id, role, content, context, created_at FROM ai_history ORDER BY id DESC LIMIT ?'
  ).all(limit).reverse();
}

export function clearAiHistory() {
  db.prepare('DELETE FROM ai_history').run();
}

export function createSession(tokenHash, expiresAt) {
  db.prepare("DELETE FROM sessions WHERE julianday(expires_at) <= julianday('now')").run();
  db.prepare('INSERT INTO sessions(token_hash, expires_at) VALUES(?, ?)').run(tokenHash, expiresAt);
}

export function hasSession(tokenHash) {
  return !!db.prepare(
    "SELECT 1 FROM sessions WHERE token_hash = ? AND julianday(expires_at) > julianday('now')"
  ).get(tokenHash);
}

export function deleteSession(tokenHash) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

export function clearSessions() {
  db.prepare('DELETE FROM sessions').run();
}

export function getProjectPreference(projectId) {
  return db.prepare(
    'SELECT managed, favorite, note FROM project_preferences WHERE project_id = ?'
  ).get(projectId) || { managed: 0, favorite: 0, note: '' };
}

export function setProjectPreference(projectId, { managed, favorite, note }) {
  const current = getProjectPreference(projectId);
  const nextManaged = typeof managed === 'boolean' ? Number(managed) : current.managed;
  const nextFavorite = typeof favorite === 'boolean' ? Number(favorite) : current.favorite;
  const nextNote = typeof note === 'string' ? note.slice(0, 500) : current.note;
  db.prepare(`
    INSERT INTO project_preferences(project_id, managed, favorite, note, updated_at)
    VALUES(?, ?, ?, ?, datetime('now'))
    ON CONFLICT(project_id) DO UPDATE SET
      managed = excluded.managed,
      favorite = excluded.favorite,
      note = excluded.note,
      updated_at = excluded.updated_at
  `).run(projectId, nextManaged, nextFavorite, nextNote);
  return { managed: !!nextManaged, favorite: !!nextFavorite, note: nextNote };
}

export function setProjectManagement(discoveredProjectIds, managedProjectIds) {
  const managedSet = new Set(managedProjectIds);
  const update = db.transaction(() => {
    // 保存的是完整允许列表；先撤销旧授权，避免暂时消失的项目日后自动恢复权限。
    db.prepare("UPDATE project_preferences SET managed = 0, updated_at = datetime('now') WHERE managed <> 0").run();
    for (const projectId of discoveredProjectIds.filter((id) => managedSet.has(id))) {
      setProjectPreference(projectId, { managed: true });
    }
  });
  update();
  return { managedProjectIds: discoveredProjectIds.filter((id) => managedSet.has(id)) };
}

export function addComposeBackup(projectId, filePath, content, reason = 'save') {
  const result = db.prepare(
    'INSERT INTO compose_backups(project_id, file_path, content, reason) VALUES(?, ?, ?, ?)'
  ).run(projectId, filePath, content, reason);
  db.prepare(`
    DELETE FROM compose_backups
    WHERE project_id = ? AND id NOT IN (
      SELECT id FROM compose_backups WHERE project_id = ? ORDER BY id DESC LIMIT 20
    )
  `).run(projectId, projectId);
  return Number(result.lastInsertRowid);
}

export function listComposeBackups(projectId) {
  return db.prepare(`
    SELECT id, project_id AS projectId, file_path AS filePath, reason, created_at AS createdAt,
           length(content) AS size
    FROM compose_backups WHERE project_id = ? ORDER BY id DESC LIMIT 20
  `).all(projectId);
}

export function getComposeBackup(projectId, id) {
  return db.prepare(`
    SELECT id, project_id AS projectId, file_path AS filePath, content, reason,
           created_at AS createdAt
    FROM compose_backups WHERE project_id = ? AND id = ?
  `).get(projectId, id);
}

export function addOperation({ projectId = null, projectName = null, action, status, detail = '' }) {
  const result = db.prepare(`
    INSERT INTO operation_history(project_id, project_name, action, status, detail)
    VALUES(?, ?, ?, ?, ?)
  `).run(projectId, projectName, action, status, String(detail || '').slice(-20000));
  return Number(result.lastInsertRowid);
}

export function listOperations(limit = 100) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  return db.prepare(`
    SELECT id, project_id AS projectId, project_name AS projectName, action, status, detail,
           created_at AS createdAt
    FROM operation_history ORDER BY id DESC LIMIT ?
  `).all(safeLimit);
}

export function exportUserData() {
  const settings = Object.fromEntries(
    db.prepare("SELECT key, value FROM settings WHERE key NOT IN ('ai.api_key', 'auth.password_hash', 'notifications.config')").all()
      .map((row) => [row.key, row.value])
  );
  return {
    exportedAt: new Date().toISOString(),
    settings,
    projectPreferences: db.prepare(
      'SELECT project_id AS projectId, managed, favorite, note, updated_at AS updatedAt FROM project_preferences'
    ).all(),
    operations: listOperations(500),
  };
}

export function importUserData(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('导入文件格式无效');
  const allowedSettings = new Set([
    'ai.base_url', 'ai.model', 'ai.system_prompt', 'ui.refresh_interval', 'ui.log_tail',
    'updates.auto_enabled', 'updates.interval_hours',
  ]);
  const transaction = db.transaction(() => {
    for (const [key, value] of Object.entries(payload.settings || {})) {
      if (allowedSettings.has(key) && typeof value === 'string') setSetting(key, value);
    }
    for (const preference of payload.projectPreferences || []) {
      if (typeof preference?.projectId !== 'string') continue;
      setProjectPreference(preference.projectId, {
        managed: !!preference.managed,
        favorite: !!preference.favorite,
        note: typeof preference.note === 'string' ? preference.note : '',
      });
    }
  });
  transaction();
  return { ok: true };
}

export default db;
