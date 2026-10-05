/**
 * 待办中心 —— 派生视图（不落盘的纯计算）。
 *
 * 列表筛选放在客户端做（数据量小、交互要即时）；这里只算那些
 * 「多端必须一致」的聚合口径：侧边栏计数、仪表盘 KPI 与图表数据。
 *
 * @module dsh-todos/select
 */

import { localDateKey, addDays } from './store.js';

const ACTIVE = (task) => task.deletedAt === null;
const OPEN = (task) => task.deletedAt === null && !task.completed;

/** 优先级排序权重：p1 最靠前，无优先级最后。 */
const PRIORITY_RANK = { p1: 0, p2: 1, p3: 2, p4: 3 };

/** 任务的规范排序：到期日 → 优先级 → 手动顺序。 */
export function compareTasks(a, b) {
  const ad = a.dueDate ?? '9999-12-31';
  const bd = b.dueDate ?? '9999-12-31';
  if (ad !== bd) return ad < bd ? -1 : 1;
  const at = a.dueTime ?? '99:99';
  const bt = b.dueTime ?? '99:99';
  if (at !== bt) return at < bt ? -1 : 1;
  const ap = PRIORITY_RANK[a.priority] ?? 3;
  const bp = PRIORITY_RANK[b.priority] ?? 3;
  if (ap !== bp) return ap - bp;
  if (a.order !== b.order) return a.order - b.order;
  return String(a.createdAt).localeCompare(String(b.createdAt));
}

/** 侧边栏与导航用的计数。 */
export function deriveCounts(state, today = localDateKey()) {
  const counts = {
    today: 0,
    overdue: 0,
    upcoming: 0,
    inbox: 0,
    done: 0,
    trash: 0,
    active: 0,
    byProject: {},
    byLabel: {},
  };
  const horizon = addDays(today, 30);
  for (const task of state.tasks) {
    if (!ACTIVE(task)) {
      counts.trash += 1;
      continue;
    }
    if (task.completed) {
      counts.done += 1;
      continue;
    }
    counts.active += 1;
    if (task.dueDate === null) {
      counts.inbox += 1;
    } else {
      if (task.dueDate < today) counts.overdue += 1;
      if (task.dueDate <= today) counts.today += 1;
      if (task.dueDate > today && task.dueDate <= horizon) counts.upcoming += 1;
    }
    if (task.projectId !== null) {
      counts.byProject[task.projectId] = (counts.byProject[task.projectId] ?? 0) + 1;
    }
    for (const labelId of task.labelIds) {
      counts.byLabel[labelId] = (counts.byLabel[labelId] ?? 0) + 1;
    }
  }
  return counts;
}

/** 把 `YYYY-MM-DD`/`HH:mm` 合成一个本地时间戳；无日期返回 null。 */
export function dueTimestamp(task) {
  if (task.dueDate === null) return null;
  const [y, m, d] = task.dueDate.split('-').map(Number);
  const [hh, mm] = (task.dueTime ?? '00:00').split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}

/** 把时间范围键翻成 `[from, to]` 两个本地日键（含端点）。 */
export function resolveRange(range, today = localDateKey()) {
  switch (range) {
    case 'today':
      return { from: today, to: today };
    case 'week': {
      const weekday = new Date(`${today}T00:00:00`).getDay();
      const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
      const from = addDays(today, mondayOffset);
      return { from, to: addDays(from, 6) };
    }
    case 'month': {
      const [y, m] = today.split('-').map(Number);
      const from = localDateKey(new Date(y, m - 1, 1));
      const to = localDateKey(new Date(y, m, 0));
      return { from, to };
    }
    case 'last30':
      return { from: addDays(today, -29), to: today };
    case 'last90':
      return { from: addDays(today, -89), to: today };
    default:
      return { from: addDays(today, -29), to: today };
  }
}

/**
 * 仪表盘统计。
 *
 * @param {object} state
 * @param {string} range - `today|week|month|last30|last90`
 * @param {string} [today]
 */
export function computeStats(state, range = 'last30', today = localDateKey()) {
  const { from, to } = resolveRange(range, today);
  const tasks = state.tasks.filter(ACTIVE);
  const open = tasks.filter((t) => !t.completed);

  const createdInRange = tasks.filter((t) => (t.createdAt ?? '').slice(0, 10) >= from && (t.createdAt ?? '').slice(0, 10) <= to);
  const completedInRange = tasks.filter(
    (t) => t.completed && t.completedAt !== null && t.completedAt.slice(0, 10) >= from && t.completedAt.slice(0, 10) <= to,
  );

  const overdue = open.filter((t) => t.dueDate !== null && t.dueDate < today);
  const dueToday = open.filter((t) => t.dueDate !== null && t.dueDate <= today);

  // 近 14 天「完成 vs 新增」。
  const trend = [];
  for (let i = 13; i >= 0; i -= 1) {
    const day = addDays(today, -i);
    trend.push({
      date: day,
      completed: tasks.filter((t) => t.completed && t.completedAt !== null && t.completedAt.slice(0, 10) === day).length,
      created: tasks.filter((t) => (t.createdAt ?? '').slice(0, 10) === day).length,
    });
  }

  // 近 90 天热力图。
  const heatmap = [];
  for (let i = 89; i >= 0; i -= 1) {
    const day = addDays(today, -i);
    heatmap.push({
      date: day,
      count: tasks.filter((t) => t.completed && t.completedAt !== null && t.completedAt.slice(0, 10) === day).length,
    });
  }

  // 优先级分布（仅未完成）。
  const priority = { p1: 0, p2: 0, p3: 0, p4: 0 };
  for (const task of open) priority[task.priority] = (priority[task.priority] ?? 0) + 1;

  // 项目 / 标签分布（仅未完成）。
  const projectName = new Map(state.projects.map((p) => [p.id, p.name]));
  const labelName = new Map(state.labels.map((l) => [l.id, l.name]));
  const projectBuckets = new Map();
  const labelBuckets = new Map();
  let noProject = 0;
  for (const task of open) {
    if (task.projectId === null) noProject += 1;
    else projectBuckets.set(task.projectId, (projectBuckets.get(task.projectId) ?? 0) + 1);
    if (task.labelIds.length === 0) labelBuckets.set('__none__', (labelBuckets.get('__none__') ?? 0) + 1);
    for (const id of task.labelIds) labelBuckets.set(id, (labelBuckets.get(id) ?? 0) + 1);
  }
  const toBuckets = (map, nameOf) =>
    [...map.entries()]
      .map(([id, count]) => ({ id, name: id === '__none__' ? '无标签' : (nameOf.get(id) ?? '已删除'), count }))
      .sort((a, b) => b.count - a.count);
  const breakdown = {
    projects: [...toBuckets(projectBuckets, projectName), ...(noProject > 0 ? [{ id: '__inbox__', name: '收件箱', count: noProject }] : [])]
      .sort((a, b) => b.count - a.count),
    labels: toBuckets(labelBuckets, labelName),
  };

  // 连续完成天数（streak）：从今天或昨天往前数。
  const doneDays = new Set(tasks.filter((t) => t.completedAt !== null).map((t) => t.completedAt.slice(0, 10)));
  let streak = 0;
  let cursor = today;
  if (!doneDays.has(cursor)) cursor = addDays(today, -1);
  while (doneDays.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  const denom = completedInRange.length + createdInRange.length;
  const completionRate = denom === 0 ? 0 : Math.round((completedInRange.length / denom) * 100);

  // 环比：与上一个等长区间比较完成数。
  const spanDays = Math.max(1, Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86_400_000) + 1);
  const prevFrom = addDays(from, -spanDays);
  const prevTo = addDays(from, -1);
  const prevCompleted = tasks.filter(
    (t) => t.completed && t.completedAt !== null && t.completedAt.slice(0, 10) >= prevFrom && t.completedAt.slice(0, 10) <= prevTo,
  ).length;

  // 星期分布：哪一天最容易逾期。
  const weekdayOverdue = [0, 0, 0, 0, 0, 0, 0];
  for (const task of overdue) {
    const weekday = new Date(`${task.dueDate}T00:00:00`).getDay();
    weekdayOverdue[weekday] += 1;
  }

  return {
    range: { key: range, from, to },
    kpi: {
      dueToday: dueToday.length,
      overdue: overdue.length,
      completed: completedInRange.length,
      created: createdInRange.length,
      completionRate,
      streak,
      active: open.length,
      prevCompleted,
      deltaCompleted: completedInRange.length - prevCompleted,
    },
    trend,
    heatmap,
    priority,
    breakdown,
    weekdayOverdue,
  };
}
