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
    session_id INTEGER NOT NULL DEFAULT 0,
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
    mount_enabled INTEGER NOT NULL DEFAULT 0,
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

  CREATE TABLE IF NOT EXISTS alert_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    key        TEXT NOT NULL DEFAULT '',
    title      TEXT NOT NULL DEFAULT '',
    detail     TEXT NOT NULL DEFAULT '',
    priority   TEXT NOT NULL DEFAULT 'warning',
    target     TEXT,
    read       INTEGER NOT NULL DEFAULT 0,
    muted      INTEGER NOT NULL DEFAULT 0,
    logs       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_alert_events_created ON alert_events(created_at);

  CREATE TABLE IF NOT EXISTS background_jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    total INTEGER NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    finished_at TEXT
  );

  CREATE TABLE IF NOT EXISTS background_job_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL REFERENCES background_jobs(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    project_name TEXT NOT NULL,
    status TEXT NOT NULL,
    output TEXT NOT NULL DEFAULT '',
    exit_code INTEGER,
    started_at TEXT,
    finished_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_background_job_items_job ON background_job_items(job_id, id);

  CREATE TABLE IF NOT EXISTS agent_plans (
    id TEXT PRIMARY KEY,
    session_id INTEGER NOT NULL DEFAULT 0,
    user_message TEXT NOT NULL,
    plan_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    result_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    executed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS agent_executions (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES agent_plans(id) ON DELETE CASCADE,
    tool_name TEXT NOT NULL,
    parameters TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    result TEXT,
    error TEXT,
    duration_ms INTEGER,
    confirmed_by TEXT,
    confirmed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS performance_baselines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL DEFAULT '',
    snapshot TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_agent_plans_session ON agent_plans(session_id);
  CREATE INDEX IF NOT EXISTS idx_agent_executions_plan ON agent_executions(plan_id);
`);

/**
 * 迁移清单。序号即目标 user_version,必须单调递增且只追加,不要修改已发布的条目。
 *
 * 历史库在引入版本号之前就已经通过 PRAGMA table_info 探测补齐了这些列,
 * 且它们的 user_version 仍是 0,因此每条迁移都必须保持幂等:
 * 加列前先探测,已存在就跳过,重放时不会因重复列而失败。
 */
const MIGRATIONS = [
  {
    version: 1,
    name: '项目纳管白名单与会话/告警/Agent 反馈列',
    up(database) {
      addColumn(database, 'project_preferences', 'managed', 'INTEGER NOT NULL DEFAULT 0');
      addColumn(database, 'project_preferences', 'mount_enabled', 'INTEGER NOT NULL DEFAULT 0');
      addColumn(database, 'ai_history', 'session_id', 'INTEGER NOT NULL DEFAULT 0');
      addColumn(database, 'alert_events', 'logs', "TEXT NOT NULL DEFAULT ''");
      addColumn(database, 'agent_plans', 'rating', 'INTEGER');
      addColumn(database, 'agent_plans', 'feedback_text', "TEXT NOT NULL DEFAULT ''");
      addColumn(database, 'agent_plans', 'feedback_at', 'TEXT');
    },
  },
];

/** 幂等加列:列已存在时直接返回 false,不抛错。 */
export function addColumn(database, table, column, definition) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((item) => item.name === column)) return false;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

/**
 * 按 user_version 顺序执行未应用的迁移。每条迁移单独一个事务,
 * 版本号与数据变更一起提交,中途失败不会留下"半应用"的版本号。
 * @returns {number[]} 本次实际应用的版本号
 */
export function runMigrations(database = db, migrations = MIGRATIONS) {
  const current = database.pragma('user_version', { simple: true });
  const applied = [];
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    const apply = database.transaction(() => {
      migration.up(database);
      database.pragma(`user_version = ${migration.version}`);
    });
    apply();
    applied.push(migration.version);
    console.log(`[db] 已应用迁移 v${migration.version}: ${migration.name}`);
  }
  return applied;
}

runMigrations();

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

export function addAiMessage(role, content, context = null, sessionId = null) {
  db.prepare(
    'INSERT INTO ai_history(role, content, context, session_id) VALUES(?, ?, ?, ?)'
  ).run(role, content, context ? JSON.stringify(context) : null, sessionId == null ? 0 : sessionId);
  return db.prepare('SELECT last_insert_rowid() AS id').get().id;
}

export function getAiHistory(limit = 50, sessionId = null) {
  if (sessionId != null) {
    return db.prepare(
      'SELECT id, role, content, context, session_id AS sessionId, created_at FROM ai_history WHERE session_id = ? ORDER BY id DESC LIMIT ?'
    ).all(sessionId, limit).reverse();
  }
  return db.prepare(
    'SELECT id, role, content, context, session_id AS sessionId, created_at FROM ai_history ORDER BY id DESC LIMIT ?'
  ).all(limit).reverse();
}

export function listAiSessions(limit = 30) {
  const sessions = db.prepare(`
    SELECT session_id AS sessionId,
           MAX(created_at) AS createdAt,
           (SELECT content FROM ai_history h2 WHERE h2.session_id = h.session_id AND h2.role = 'user' ORDER BY h2.id ASC LIMIT 1) AS firstUserMessage,
           COUNT(*) AS messageCount
    FROM ai_history h
    WHERE session_id <> 0
    GROUP BY session_id
    ORDER BY MAX(id) DESC
    LIMIT ?
  `).all(Math.max(1, Math.min(Number(limit) || 30, 100)));
  return sessions.map((session) => ({
    ...session,
    title: String(session.firstUserMessage || '').replace(/\s+/g, ' ').slice(0, 60),
  }));
}

export function clearAiSession(sessionId) {
  db.prepare('DELETE FROM ai_history WHERE session_id = ?').run(sessionId);
}

export function clearAiHistory() {
  db.prepare('DELETE FROM ai_history').run();
}

/** 创建 Agent 执行计划,返回 planId。 */
export function createAgentPlan(sessionId, userMessage, planJson) {
  const planId = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  db.prepare(
    'INSERT INTO agent_plans(id, session_id, user_message, plan_json, status) VALUES(?, ?, ?, ?, ?)'
  ).run(planId, sessionId == null ? 0 : Number(sessionId), String(userMessage || ''), JSON.stringify(planJson || {}), 'pending');
  return planId;
}

export function getAgentPlan(planId) {
  return db.prepare('SELECT * FROM agent_plans WHERE id = ?').get(planId) || null;
}

export function updateAgentPlan(planId, patch = {}) {
  const current = getAgentPlan(planId);
  if (!current) return null;
  const status = patch.status !== undefined ? String(patch.status) : current.status;
  const resultJson = patch.resultJson !== undefined ? JSON.stringify(patch.resultJson) : current.result_json;
  const executedAt = patch.executedAt !== undefined ? patch.executedAt : current.executed_at;
  db.prepare(`
    UPDATE agent_plans
    SET status = ?, result_json = ?, executed_at = ?
    WHERE id = ?
  `).run(status, resultJson, executedAt, planId);
  return getAgentPlan(planId);
}

export function listAgentPlans(limit = 30) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 30, 100));
  return db.prepare('SELECT * FROM agent_plans ORDER BY id DESC LIMIT ?').all(safeLimit);
}

export function recordAgentExecution(planId, toolName, params, status = 'pending') {
  const execId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  db.prepare(
    'INSERT INTO agent_executions(id, plan_id, tool_name, parameters, status) VALUES(?, ?, ?, ?, ?)'
  ).run(execId, planId, String(toolName || ''), JSON.stringify(params || {}), String(status || 'pending'));
  return execId;
}

export function updateAgentExecution(execId, { status, result, error, durationMs, confirmedBy, confirmedAt } = {}) {
  const current = db.prepare('SELECT * FROM agent_executions WHERE id = ?').get(execId);
  if (!current) return null;
  const nextStatus = status !== undefined ? String(status) : current.status;
  const nextResult = result !== undefined ? JSON.stringify(result) : current.result;
  const nextError = error !== undefined ? String(error) : current.error;
  const nextDuration = durationMs !== undefined ? Number(durationMs) : current.duration_ms;
  const nextConfirmedBy = confirmedBy !== undefined ? confirmedBy : current.confirmed_by;
  const nextConfirmedAt = confirmedAt !== undefined ? confirmedAt : current.confirmed_at;
  db.prepare(`
    UPDATE agent_executions
    SET status = ?, result = ?, error = ?, duration_ms = ?, confirmed_by = ?, confirmed_at = ?
    WHERE id = ?
  `).run(nextStatus, nextResult, nextError, nextDuration, nextConfirmedBy, nextConfirmedAt, execId);
  return db.prepare('SELECT * FROM agent_executions WHERE id = ?').get(execId);
}

export function listAgentExecutions(planId, limit = 100) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  if (planId) {
    return db.prepare('SELECT * FROM agent_executions WHERE plan_id = ? ORDER BY id ASC LIMIT ?').all(planId, safeLimit);
  }
  return db.prepare('SELECT * FROM agent_executions ORDER BY id DESC LIMIT ?').all(safeLimit);
}

/** 记录用户对某次执行计划的评分与反馈。 */
export function recordAgentFeedback(planId, rating, feedbackText = '') {
  const current = getAgentPlan(planId);
  if (!current) return null;
  const safeRating = rating == null ? null : Math.max(1, Math.min(Number(rating) || 5, 5));
  db.prepare(`
    UPDATE agent_plans
    SET rating = ?, feedback_text = ?, feedback_at = ?
    WHERE id = ?
  `).run(safeRating, String(feedbackText || '').slice(0, 2000), new Date().toISOString(), planId);
  return getAgentPlan(planId);
}

/** 带反馈的计划列表,供反馈循环 UI 使用。 */
export function listAgentFeedback(limit = 50) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  return db.prepare(`
    SELECT id, user_message AS userMessage, status, rating, feedback_text AS feedbackText,
           feedback_at AS feedbackAt, created_at AS createdAt
    FROM agent_plans
    WHERE feedback_text <> '' OR rating IS NOT NULL
    ORDER BY id DESC LIMIT ?
  `).all(safeLimit);
}

export function addPerformanceBaseline(label, snapshot) {
  const result = db.prepare(
    'INSERT INTO performance_baselines(label, snapshot) VALUES(?, ?)'
  ).run(String(label || ''), JSON.stringify(snapshot || {}));
  return Number(result.lastInsertRowid);
}

export function listPerformanceBaselines(limit = 20) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
  return db.prepare('SELECT * FROM performance_baselines ORDER BY id DESC LIMIT ?').all(safeLimit);
}

export function addAlertEvent({ key, title, detail, priority = 'warning', to = null, logs = '' }) {
  // 同一 key 的未读事件先静默,避免重复刷屏
  db.prepare('UPDATE alert_events SET muted = 1 WHERE key = ? AND read = 0 AND muted = 0').run(key);
  const result = db.prepare(`
    INSERT INTO alert_events(key, title, detail, priority, target, logs)
    VALUES(?, ?, ?, ?, ?, ?)
  `).run(key || '', String(title || ''), String(detail || ''), String(priority || 'warning'), to || null, String(logs || '').slice(0, 20000));
  return db.prepare('SELECT * FROM alert_events WHERE id = ?').get(Number(result.lastInsertRowid));
}

export function listAlertEvents(limit = 50) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  return db.prepare('SELECT * FROM alert_events ORDER BY id DESC LIMIT ?').all(safeLimit);
}

export function updateAlertEvent(id, patch = {}) {
  const current = db.prepare('SELECT * FROM alert_events WHERE id = ?').get(id);
  if (!current) return null;
  const read = patch.read !== undefined ? (patch.read ? 1 : 0) : current.read;
  const muted = patch.muted !== undefined ? (patch.muted ? 1 : 0) : current.muted;
  db.prepare("UPDATE alert_events SET read = ?, muted = ?, updated_at = datetime('now') WHERE id = ?").run(read, muted, id);
  return db.prepare('SELECT * FROM alert_events WHERE id = ?').get(id);
}

export function pruneAlertEvents(days = 7) {
  const safeDays = Math.max(1, Number(days) || 7);
  return db.prepare("DELETE FROM alert_events WHERE julianday('now') - julianday(created_at) > ?").run(safeDays);
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

export function getProjectMountEnabled(projectId) {
  return !!db.prepare('SELECT mount_enabled FROM project_preferences WHERE project_id = ?').get(projectId)?.mount_enabled;
}

export function setProjectPreference(projectId, { managed, mountEnabled, favorite, note }) {
  const current = getProjectPreference(projectId);
  const currentMountEnabled = getProjectMountEnabled(projectId);
  const nextManaged = typeof managed === 'boolean' ? Number(managed) : current.managed;
  const nextMountEnabled = typeof mountEnabled === 'boolean' ? Number(mountEnabled) : Number(currentMountEnabled);
  const nextFavorite = typeof favorite === 'boolean' ? Number(favorite) : current.favorite;
  const nextNote = typeof note === 'string' ? note.slice(0, 500) : current.note;
  db.prepare(`
    INSERT INTO project_preferences(project_id, managed, mount_enabled, favorite, note, updated_at)
    VALUES(?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(project_id) DO UPDATE SET
      managed = excluded.managed,
      mount_enabled = excluded.mount_enabled,
      favorite = excluded.favorite,
      note = excluded.note,
      updated_at = excluded.updated_at
  `).run(projectId, nextManaged, nextMountEnabled, nextFavorite, nextNote);
  return { managed: !!nextManaged, favorite: !!nextFavorite, note: nextNote };
}

export function setProjectManagement(discoveredProjectIds, managedProjectIds, mountProjectIds = null) {
  const managedSet = new Set(managedProjectIds);
  const mountSet = new Set(mountProjectIds || []);
  const update = db.transaction(() => {
    // 保存的是完整允许列表；先撤销旧授权，避免暂时消失的项目日后自动恢复权限。
    db.prepare("UPDATE project_preferences SET managed = 0, mount_enabled = 0, updated_at = datetime('now') WHERE managed <> 0 OR mount_enabled <> 0").run();
    for (const projectId of discoveredProjectIds.filter((id) => managedSet.has(id))) {
      setProjectPreference(projectId, { managed: true, mountEnabled: mountSet.has(projectId) });
    }
  });
  update();
  return {
    managedProjectIds: discoveredProjectIds.filter((id) => managedSet.has(id)),
    mountProjectIds: discoveredProjectIds.filter((id) => managedSet.has(id) && mountSet.has(id)),
  };
}

export function setProjectMounts(discoveredProjectIds, managedProjectIds, mountProjectIds) {
  return setProjectManagement(discoveredProjectIds, managedProjectIds, mountProjectIds);
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

export function listProjectOperations(projectId, limit = 50) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  return db.prepare(`
    SELECT id, project_id AS projectId, project_name AS projectName, action, status, detail,
           created_at AS createdAt
    FROM operation_history WHERE project_id = ? ORDER BY id DESC LIMIT ?
  `).all(projectId, safeLimit);
}

export function createBackgroundJob({ id, type, action, projects }) {
  const insert = db.transaction(() => {
    db.prepare('INSERT INTO background_jobs(id, type, action, status, total) VALUES(?, ?, ?, ?, ?)')
      .run(id, type, action, 'queued', projects.length);
    const statement = db.prepare('INSERT INTO background_job_items(job_id, project_id, project_name, status) VALUES(?, ?, ?, ?)');
    for (const project of projects) statement.run(id, project.id, project.projectName, 'pending');
  });
  insert();
  return getBackgroundJob(id);
}

export function updateBackgroundJob(id, status, completed = null) {
  const timestamps = status === 'running'
    ? "started_at = COALESCE(started_at, datetime('now'))"
    : ['success', 'failed', 'interrupted'].includes(status) ? "finished_at = datetime('now')" : 'finished_at = finished_at';
  db.prepare(`UPDATE background_jobs SET status = ?, completed = COALESCE(?, completed), ${timestamps} WHERE id = ?`)
    .run(status, completed, id);
}

export function updateBackgroundJobItem(id, { status, output = '', exitCode = null }) {
  const timestamps = status === 'running'
    ? "started_at = COALESCE(started_at, datetime('now'))"
    : ['success', 'failed', 'interrupted'].includes(status) ? "finished_at = datetime('now')" : 'finished_at = finished_at';
  db.prepare(`UPDATE background_job_items SET status = ?, output = ?, exit_code = ?, ${timestamps} WHERE id = ?`)
    .run(status, String(output || '').slice(-20000), exitCode, id);
}

export function getBackgroundJob(id) {
  const job = db.prepare(`
    SELECT id, type, action, status, total, completed, created_at AS createdAt,
           started_at AS startedAt, finished_at AS finishedAt
    FROM background_jobs WHERE id = ?
  `).get(id);
  if (!job) return null;
  job.items = db.prepare(`
    SELECT id, project_id AS projectId, project_name AS projectName, status, output,
           exit_code AS exitCode, started_at AS startedAt, finished_at AS finishedAt
    FROM background_job_items WHERE job_id = ? ORDER BY id
  `).all(id);
  return job;
}

export function listBackgroundJobs(limit = 20) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
  return db.prepare(`
    SELECT id, type, action, status, total, completed, created_at AS createdAt,
           started_at AS startedAt, finished_at AS finishedAt
    FROM background_jobs ORDER BY created_at DESC, rowid DESC LIMIT ?
  `).all(safeLimit);
}

export function interruptRunningBackgroundJobs() {
  const jobs = db.prepare("SELECT id FROM background_jobs WHERE status IN ('queued', 'running')").all();
  const interrupt = db.transaction(() => {
    db.prepare("UPDATE background_job_items SET status = 'interrupted', finished_at = datetime('now') WHERE status IN ('pending', 'running')").run();
    db.prepare("UPDATE background_jobs SET status = 'interrupted', finished_at = datetime('now') WHERE status IN ('queued', 'running')").run();
  });
  interrupt();
  return jobs.map((job) => job.id);
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
      'SELECT project_id AS projectId, managed, mount_enabled AS mountEnabled, favorite, note, updated_at AS updatedAt FROM project_preferences'
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
        mountEnabled: !!preference.mountEnabled,
        favorite: !!preference.favorite,
        note: typeof preference.note === 'string' ? preference.note : '',
      });
    }
  });
  transaction();
  return { ok: true };
}

export default db;
