import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/opsdash.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

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
`);

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

export default db;
