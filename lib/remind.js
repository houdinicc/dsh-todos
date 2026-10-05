/**
 * 待办中心 —— 到点提醒的判定（纯函数）。
 *
 * 设计取舍：提醒**不往会话里注入消息**。
 *
 * 宿主侧确实可以 `agent.inject()` / `agent.followup()` 把提醒塞进某个会话，
 * 但那会让模型在没有用户输入的情况下自己发起一轮，开销与打扰都不小，而且
 * 用户没开着的会话收到的提醒也没人看见。所以提醒走 GUI：
 * 客户端半把本模块的判定结果渲染到官方的 `shell.overlay` 全局浮层里，
 * 只要 DSH 开着、且当前有待办到点，就能看到并一键「完成 / 推迟到明天」。
 *
 * 本模块不做任何写入，也不记录「已提醒过」——去重交给渲染层（一次页面
 * 生命周期内只提示一次），这样宿主状态保持纯函数、可反复查询。
 *
 * @module dsh-todos/remind
 */

import { localDateKey } from './store.js';
import { presentTask } from './actions.js';

/** 到期时间是否已经过了（全天任务视为当天 00:00 到期，永远算已到）。 */
function timeReached(task, now) {
  if (task.dueDate === null) return false;
  if (task.dueTime === null) return true;
  const [y, m, d] = task.dueDate.split('-').map(Number);
  const [hh, mm] = task.dueTime.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime() <= now.getTime();
}

/**
 * 当前该提醒的任务：未完成、未删除、有到期日，且「已逾期」或「今天且时间已到」。
 *
 * @param {object} store
 * @param {object} [options]
 * @param {Date} [options.now]
 * @returns {{ today: string, now: string, items: Array<object> }}
 */
export function dueNotifications(store, options = {}) {
  const now = options.now ?? new Date();
  const today = options.today ?? localDateKey(now);
  const state = store.snapshot();
  const items = [];

  for (const task of state.tasks) {
    if (task.deletedAt !== null || task.completed) continue;
    if (task.dueDate === null || task.dueDate > today) continue;
    const overdue = task.dueDate < today;
    if (!overdue && !timeReached(task, now)) continue;
    const view = presentTask(task, state);
    items.push({
      ...view,
      overdue,
      // 逾期天数，供 UI 措辞使用。
      overdueDays: overdue
        ? Math.round((new Date(`${today}T00:00:00`) - new Date(`${task.dueDate}T00:00:00`)) / 86_400_000)
        : 0,
    });
  }

  // 逾期最久的排前面，其次按时间。
  items.sort((a, b) => {
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    return String(a.dueTime).localeCompare(String(b.dueTime));
  });

  return { today, now: now.toISOString(), items };
}
