/**
 * RunawayGuard:检测 Agent 死循环并在工具结果前注入提醒。
 * 借鉴 EnsoCode src/agent/runawayGuard.ts 的思路,按运维场景裁剪。
 *
 * 四条独立 streak,任一命中即在当轮工具结果前注入 <system-reminder>:
 *  - repeat_action:同一工具+相同参数指纹连续 N 次
 *  - repeat_result:连续 N 次工具结果完全相同(轮询无变化)
 *  - repeat_error:连续 N 次同族错误(取错误首行作族指纹)
 *  - polling_repeat:轮询型工具(ps/logs/stats/inspect)连续调用且无参数变化
 */

const STREAK_LIMIT = 3;
const POLLING_TOOLS = /^(container\.(list|logs|stats|inspect)|project\.(get|list)|docker\.(ps|stats))/;

function fingerprint(value) {
  try {
    return JSON.stringify(value, Object.keys(value || {}).sort()).slice(0, 4096) || '';
  } catch {
    return String(value).slice(0, 4096);
  }
}

function resultFingerprint(result) {
  const text = typeof result === 'string' ? result : JSON.stringify(result ?? null);
  return text.slice(0, 4096);
}

function errorFamily(message) {
  return String(message || '').split('\n')[0].slice(0, 80);
}

export class RunawayGuard {
  constructor(limit = STREAK_LIMIT) {
    this.limit = limit;
    this.resetTurn();
  }

  resetTurn() {
    this.actionStreak = { key: '', count: 0 };
    this.resultStreak = { key: '', count: 0 };
    this.errorStreak = { key: '', count: 0 };
    this.pollingStreak = { key: '', count: 0 };
    this.reminded = false;
  }

  _bump(streak, key) {
    if (streak.key === key) streak.count += 1;
    else { streak.key = key; streak.count = 1; }
    return streak.count;
  }

  /**
   * 在每次工具调用完成后记录,返回需要注入的提醒文本(无则 null)。
   * 每轮最多注入一次。
   */
  observe({ toolName, params, result, error }) {
    if (this.reminded) return null;
    const actionKey = `${toolName}:${fingerprint(params)}`;
    const actionCount = this._bump(this.actionStreak, actionKey);

    let reminder = null;
    if (error) {
      const errCount = this._bump(this.errorStreak, errorFamily(error));
      this.resultStreak.count = 0;
      if (errCount >= this.limit) {
        reminder = `同一类错误已连续出现 ${errCount} 次(${errorFamily(error)})。不要再重复同样的调用,换一种诊断思路或直接向用户说明阻塞原因。`;
      }
    } else {
      this.errorStreak.count = 0;
      const resultCount = this._bump(this.resultStreak, resultFingerprint(result));
      if (resultCount >= this.limit) {
        reminder = `最近 ${resultCount} 次工具调用的结果完全相同,继续轮询不会有新信息。请基于现有信息给出结论或改用其他手段。`;
      }
    }

    if (!reminder && POLLING_TOOLS.test(toolName)) {
      const pollCount = this._bump(this.pollingStreak, actionKey);
      if (pollCount >= this.limit) {
        reminder = `轮询工具 ${toolName} 已连续调用 ${pollCount} 次。如果状态没有变化,请停止轮询并给出结论。`;
      }
    } else if (!reminder) {
      this.pollingStreak.count = 0;
    }

    if (!reminder && actionCount >= this.limit + 1) {
      reminder = `完全相同的调用(${toolName},相同参数)已重复 ${actionCount} 次,这通常意味着陷入了循环。请停下来重新规划。`;
    }

    if (reminder) this.reminded = true;
    return reminder;
  }
}
