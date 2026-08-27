import { EventEmitter } from 'node:events';

/**
 * 进程内批量任务广播 hub。
 *
 * 广播只转发轻量变更信号（jobId + event + 精简字段），不携带任务正文；
 * 订阅方收到信号后自行查询 DB（DB 是唯一事实来源），保证多标签页与重连一致。
 * 无需额外依赖，模块加载时创建一个单例 EventEmitter。
 */
const emitter = new EventEmitter();

/** 订阅批量任务更新事件，返回取消订阅函数。 */
export function subscribeJobEvents(listener) {
  emitter.on('job:update', listener);
  return () => emitter.off('job:update', listener);
}

/** 广播一次批量任务更新信号。 */
export function emitJobUpdate(jobId, detail = {}) {
  emitter.emit('job:update', { jobId, ...detail });
}
