import {
  addEventRecord,
  listEventRecords,
  updateEventRecord,
  pruneEventRecords,
} from '../lib/db.js';
import { emitEvent } from './events.js';

/**
 * 统一事件中心(Event Center 2.0):
 * - 告警/巡检/部署/回滚/Agent/GitOps/工作流 全部收敛为 event_records 单一事实来源;
 * - 提供统一查询(按类型/级别/状态过滤)与状态流转(open → acknowledged → resolved → closed);
 * - 记录时同步广播到实时订阅者(EventCenter WS)。
 */

export function recordEvent({ eventType = 'alert', source = 'system', title, detail = '', severity = 'info', status = 'open', assetId = null, assetName = '', payload = {} }) {
  const record = addEventRecord({ eventType, source, title, detail, severity, status, assetId, assetName, payload });
  emitEvent({ type: 'event', eventType, ...record });
  return record;
}

export function queryEvents({ eventType = '', severity = '', status = '', limit = 100 } = {}) {
  return listEventRecords({ eventType, severity, status, limit });
}

export function updateEvent(id, patch = {}) {
  return updateEventRecord(id, patch);
}

export function pruneEvents(days = 30) {
  return pruneEventRecords(days);
}

/** 事件中心统计:按类型/级别/状态聚合,供前端概览。 */
export function eventStats() {
  const events = listEventRecords({ limit: 500 });
  const byType = {};
  const bySeverity = {};
  const byStatus = {};
  for (const event of events) {
    byType[event.eventType] = (byType[event.eventType] || 0) + 1;
    bySeverity[event.severity] = (bySeverity[event.severity] || 0) + 1;
    byStatus[event.status] = (byStatus[event.status] || 0) + 1;
  }
  return {
    total: events.length,
    open: byStatus.open || 0,
    byType,
    bySeverity,
    byStatus,
  };
}