/**
 * .env 解析与序列化工具(与具体存储位置解耦,便于独立单测)。
 *
 * 格式说明(兼容 docker compose / dotenv 常见语法):
 *  - 行首 `#` 为整行注释;行内 ` #` 起始的注释可附加到条目(仅单行值场景)。
 *  - 支持 `KEY=v`、`KEY='v'`、`KEY="v"`、`export KEY=v`。
 *  - 引号内的 `#` 不会被视为注释,支持基础转义。
 *  - 空行与纯注释行保留在 raw 中,序列化时尽量保持原样。
 *
 * 敏感变量识别:KEY 中含 SECRET / TOKEN / PASSWORD / PASSWD / PASS / API_KEY 等。
 */

const SECRET_PATTERN = /(SECRET|TOKEN|PASSWORD|PASSWD|\bPASS\b|(?:API|PRIVATE|ACCESS|SECRET|AUTH|SIGNING)[_-]?KEY)/i;

/** 判断键名是否应默认脱敏。 */
export function isSecretKey(key) {
  return SECRET_PATTERN.test(key || '');
}

/**
 * 解析 .env 文本为结构化条目数组(reversible)。
 * @param {string} text
 * @returns {Array<{key:string, value:string, comment?:string, isSecret:boolean}>}
 */
export function parseDotenv(text) {
  const entries = [];
  if (!text) return entries;
  const lines = String(text).split(/\r?\n/);
  let pendingComment = null;
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue; // 空行跳过(不保留位置语义,raw 编辑下无损)
    if (/^\s*#/.test(line)) {
      pendingComment = line.trim().replace(/^#\s*/, '');
      continue;
    }
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line.trim());
    if (!match) continue; // 语法不合法行跳过(保存时回退 raw)
    const key = match[1];
    let value = match[2].trim();
    let comment;
    // 注释:行尾 ` #...`(仅在非引号内)
    const after = extractTrailingComment(value);
    if (after) {
      value = after.value;
      comment = after.comment;
    }
    // 去引号
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // 行内注释优先;否则使用行前独立注释
    const resolvedComment = comment ?? pendingComment ?? undefined;
    entries.push({
      key,
      value,
      comment: resolvedComment,
      isSecret: isSecretKey(key),
    });
    pendingComment = null;
  }
  return entries;
}

/** 从值中提取行尾 `# comment`(不处理引号内 #)。 */
function extractTrailingComment(value) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble && (i === 0 || /\s/.test(value[i - 1]))) {
      return { value: value.slice(0, i).trimEnd(), comment: value.slice(i + 1).trim() };
    }
  }
  return null;
}

/**
 * 序列化结构化条目为 .env 文本。条目按给定顺序输出。
 */
export function serializeDotenv(entries) {
  return (entries || [])
    .map((entry) => {
      const key = String(entry.key || '').trim();
      if (!key) return '';
      const lines = [];
      if (entry.comment) lines.push(`# ${entry.comment}`);
      // 含空格/引号/特殊字符时用双引号包裹
      const value = String(entry.value ?? '');
      const needsQuote = /[\s"'#=]/.test(value);
      lines.push(`${key}=${needsQuote ? `"${value.replaceAll('"', '\\"')}"` : value}`);
      return lines.join('\n');
    })
    .filter(Boolean)
    .join('\n') + '\n';
}

/**
 * 校验 .env 语法:不允许格式错误的行静默写入。返回 { ok, errors }。
 */
export function validateDotenv(text) {
  const errors = [];
  if (text == null) return { ok: true, errors };
  const lines = String(text).split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || /^\s*#/.test(line) || /^export\s+[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line)) return;
    if (!/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line)) {
      errors.push(`第 ${index + 1} 行不是合法的 KEY=VALUE 格式:${rawLine.trim().slice(0, 60)}`);
    }
  });
  return { ok: errors.length === 0, errors };
}
