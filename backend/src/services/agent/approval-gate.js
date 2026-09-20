/**
 * ApprovalGate:会话级审批门控。
 * 借鉴 EnsoCode src/agent/approval.ts,按 ComposeOps 确认门改造:
 *  - sessionAllowed:本会话内"总是允许"的工具集合(工具名+参数域指纹)
 *  - mode 三档:'ask'(默认,逐次确认)/ 'allow_writes'(放行非高危)/ 'full'(仅 critical 仍需确认)
 *  高危(critical)操作在 allow_writes 模式下仍需确认;full 模式也保留 critical 确认(fail-closed)。
 */

const MODES = new Set(['ask', 'allow_writes', 'full']);

/** 参数域指纹:运维场景下同工具不同容器/项目风险不同,按可辨识维度记忆。 */
function paramsFingerprint(params = {}) {
  const keys = ['projectId', 'containerId', 'service', 'image', 'volume', 'network'];
  const parts = keys.filter((k) => params[k]).map((k) => `${k}=${params[k]}`);
  return parts.join('|');
}

export class ApprovalGate {
  constructor() {
    // sessionId -> { mode, allowed: Set<string> }
    this.sessions = new Map();
  }

  _session(sessionId) {
    const key = String(sessionId || 'default');
    if (!this.sessions.has(key)) this.sessions.set(key, { mode: 'ask', allowed: new Set() });
    return this.sessions.get(key);
  }

  getMode(sessionId) { return this._session(sessionId).mode; }

  setMode(sessionId, mode) {
    if (!MODES.has(mode)) return false;
    this._session(sessionId).mode = mode;
    return true;
  }

  /** 是否需要向用户确认。risk 为 assessRisk 的结果(low/medium/high/critical)。 */
  needsConfirmation(sessionId, toolName, params, risk, toolConfirmationRequired) {
    const session = this._session(sessionId);
    const key = `${toolName}:${paramsFingerprint(params)}`;
    if (session.allowed.has(key) || session.allowed.has(toolName)) return false;
    if (risk === 'critical') return true; // 任何模式都确认
    if (session.mode === 'full') return false;
    if (session.mode === 'allow_writes') return risk === 'high' || false;
    return toolConfirmationRequired || risk === 'high';
  }

  /** 用户选择"本会话不再询问"时调用。scope: 'call'(精确参数) | 'tool'(整个工具) */
  allowForSession(sessionId, toolName, params, scope = 'call') {
    const session = this._session(sessionId);
    session.allowed.add(scope === 'tool' ? toolName : `${toolName}:${paramsFingerprint(params)}`);
  }

  clearSession(sessionId) {
    this.sessions.delete(String(sessionId || 'default'));
  }
}

let singleton = null;
export function getApprovalGate() {
  if (!singleton) singleton = new ApprovalGate();
  return singleton;
}
