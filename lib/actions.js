/**
 * 待办中心 —— 宿主侧共享动作。
 *
 * 这些函数被 HTTP 路由与 Agent 工具**共用**，保证「人在界面上做的」和
 * 「模型调工具做的」走同一条校验与持久化路径，不会看到两份不同的状态。
 *
 * @module dsh-todos/actions
 */

import { localDateKey, addDays } from './store.js';
import { parseQuickAdd } from './quickadd.js';
import { compareTasks } from './select.js';

/**
 * 把一行自然语言落成一条任务；`#项目` / `@标签` 指向不存在的名字时按需新建。
 *
 * @param {object} store
 * @param {string} input
 * @param {object} [options]
 * @param {boolean} [options.createMissing] 缺省 true。
 * @param {object} [options.extra] 额外的任务字段（覆盖解析结果）。
 */
export function quickAdd(store, input, options = {}) {
  const today = options.today ?? localDateKey();
  const state = store.snapshot();
  const parsed = parseQuickAdd(input, {
    today,
    projects: state.projects,
    labels: state.labels,
  });

  const createdProjects = [];
  const createdLabels = [];

  let projectId = parsed.projectId;
  if (projectId === null && parsed.projectName !== null && options.createMissing !== false) {
    const project = store.upsertProject({ name: parsed.projectName });
    projectId = project.id;
    createdProjects.push(project.name);
  }

  const labelIds = parsed.labelIds.slice();
  if (options.createMissing !== false) {
    for (const name of parsed.labelNames) {
      const label = store.upsertLabel({ name });
      labelIds.push(label.id);
      createdLabels.push(label.name);
    }
  }

  const task = store.createTask({
    title: parsed.title,
    dueDate: parsed.dueDate,
    dueTime: parsed.dueTime,
    priority: parsed.priority,
    repeat: parsed.repeat,
    projectId,
    labelIds,
    ...(options.extra ?? {}),
  });

  return { task, parsed, created: { projects: createdProjects, labels: createdLabels } };
}

/**
 * 按视图/条件筛选任务（`todos_list` 的实现）。
 *
 * @param {object} state store 快照
 * @param {object} [query]
 */
export function filterTasks(state, query = {}) {
  const today = query.today ?? localDateKey();
  const horizon = addDays(today, 30);
  const projectByName = new Map(state.projects.map((p) => [p.name.toLowerCase(), p.id]));
  const labelByName = new Map(state.labels.map((l) => [l.name.toLowerCase(), l.id]));

  const wantCompleted = query.includeCompleted === true;
  const view = query.view ?? (wantCompleted ? 'all' : 'active');

  let rows = state.tasks.filter((task) => task.deletedAt === null);
  if (!wantCompleted) rows = rows.filter((task) => !task.completed);

  if (view === 'today') rows = rows.filter((t) => t.dueDate !== null && t.dueDate <= today);
  else if (view === 'upcoming') rows = rows.filter((t) => t.dueDate !== null && t.dueDate > today && t.dueDate <= horizon);
  else if (view === 'inbox') rows = rows.filter((t) => t.dueDate === null);
  else if (view === 'overdue') rows = rows.filter((t) => t.dueDate !== null && t.dueDate < today);
  else if (view === 'completed') rows = rows.filter((t) => t.completed);

  if (typeof query.project === 'string' && query.project.trim() !== '') {
    const wanted = query.project.trim().toLowerCase();
    const id = projectByName.get(wanted) ?? (query.project === 'inbox' ? null : query.project);
    rows = rows.filter((t) => t.projectId === id);
  }
  if (typeof query.label === 'string' && query.label.trim() !== '') {
    const id = labelByName.get(query.label.trim().toLowerCase()) ?? query.label;
    rows = rows.filter((t) => t.labelIds.includes(id));
  }
  if (typeof query.priority === 'string' && /^p[1-4]$/.test(query.priority)) {
    rows = rows.filter((t) => t.priority === query.priority);
  }
  if (typeof query.dueFrom === 'string') rows = rows.filter((t) => t.dueDate !== null && t.dueDate >= query.dueFrom);
  if (typeof query.dueTo === 'string') rows = rows.filter((t) => t.dueDate !== null && t.dueDate <= query.dueTo);
  if (typeof query.text === 'string' && query.text.trim() !== '') {
    const needle = query.text.trim().toLowerCase();
    rows = rows.filter(
      (t) => t.title.toLowerCase().includes(needle) || t.note.toLowerCase().includes(needle),
    );
  }

  rows = rows.slice().sort(compareTasks);
  const limit = Number.isInteger(query.limit) && query.limit > 0 ? Math.min(query.limit, 500) : 100;
  return { total: rows.length, tasks: rows.slice(0, limit), today };
}

/** 把内部任务对象压成模型可读的扁平结构（用 '' 而不是 null，避免 schema 里出现联合类型）。 */
export function presentTask(task, state) {
  const project = state.projects.find((p) => p.id === task.projectId);
  const labels = task.labelIds
    .map((id) => state.labels.find((l) => l.id === id))
    .filter(Boolean)
    .map((l) => l.name);
  return {
    id: task.id,
    title: task.title,
    note: task.note,
    project: project === undefined ? '' : project.name,
    projectId: task.projectId ?? '',
    labels,
    priority: task.priority,
    dueDate: task.dueDate ?? '',
    dueTime: task.dueTime ?? '',
    completed: task.completed,
    completedAt: task.completedAt ?? '',
    repeat: task.repeat === null ? '' : describeRepeat(task.repeat),
    parentId: task.parentId ?? '',
  };
}

/** 重复规则的人类可读描述。 */
export function describeRepeat(rule) {
  const every = rule.interval > 1 ? `每 ${rule.interval} ` : '每';
  if (rule.freq === 'daily') return rule.interval > 1 ? `${every}天` : '每天';
  if (rule.freq === 'weekly') {
    const names = ['日', '一', '二', '三', '四', '五', '六'];
    const suffix = Array.isArray(rule.weekdays) ? `周${rule.weekdays.map((d) => names[d]).join('、')}` : '周';
    return rule.interval > 1 ? `${every}周（${suffix}）` : `${suffix}`;
  }
  if (rule.freq === 'monthly') {
    return rule.monthDay === undefined ? (rule.interval > 1 ? `${every}月` : '每月') : `每月 ${rule.monthDay} 号`;
  }
  return rule.interval > 1 ? `${every}年` : '每年';
}

/** Markdown 清单里的一行任务。 */
function markdownLine(task, state) {
  const view = presentTask(task, state);
  const bits = [];
  if (view.dueDate !== '') bits.push(view.dueTime === '' ? view.dueDate : `${view.dueDate} ${view.dueTime}`);
  if (view.labels.length > 0) bits.push(view.labels.map((l) => `@${l}`).join(' '));
  if (view.priority !== 'p4') bits.push(view.priority.toUpperCase());
  if (view.repeat !== '') bits.push(`↻${view.repeat}`);
  const note = view.note.trim() === '' ? '' : ` — ${view.note.replace(/\n+/g, ' ').trim()}`;
  const tail = bits.length === 0 ? '' : `  \`${bits.join(' · ')}\``;
  return `${view.title}${note}${tail}`;
}

/**
 * 把整库渲染成 Markdown 清单：按项目分组，收件箱在前，已完成排在各组末尾。
 *
 * @param {object} state store 快照
 * @param {string} stamp 导出日期（写在标题里）
 */
export function renderMarkdown(state, stamp) {
  const active = state.tasks.filter((task) => task.deletedAt === null);
  const groups = [
    { id: null, name: '收件箱' },
    ...state.projects.slice().sort((a, b) => a.order - b.order).map((p) => ({ id: p.id, name: p.name })),
  ];

  const lines = [`# 待办清单（导出于 ${stamp}）`, ''];
  const emitted = new Set();

  for (const group of groups) {
    const rows = active.filter((task) => task.projectId === group.id);
    if (rows.length === 0) continue;
    for (const task of rows) emitted.add(task.id);
    const open = rows.filter((task) => !task.completed).sort(compareTasks);
    const done = rows.filter((task) => task.completed).sort(compareTasks);
    lines.push(`## ${group.name}`, '');
    for (const task of open) lines.push(`- [ ] ${markdownLine(task, state)}`);
    for (const task of done) lines.push(`- [x] ${markdownLine(task, state)}`);
    lines.push('');
  }

  // 兜底：项目被删但引用没清干净（正常不该发生）的任务也不会被丢掉。
  const orphans = active.filter((task) => !emitted.has(task.id));
  if (orphans.length > 0) {
    lines.push('## 其他', '');
    for (const task of orphans.sort(compareTasks)) {
      lines.push(`- [${task.completed ? 'x' : ' '}] ${markdownLine(task, state)}`);
    }
    lines.push('');
  }

  const trashCount = state.tasks.filter((task) => task.deletedAt !== null).length;
  if (trashCount > 0) lines.push(`> 回收站中还有 ${trashCount} 条任务，未包含在本清单内。`, '');
  return lines.join('\n');
}
