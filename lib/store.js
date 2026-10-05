/**
 * 待办中心 —— 数据层。
 *
 * 设计取舍：**零依赖 + 单文件持久化**。
 *  - 不 import 任何 `@deepseek-ai/*` 包，因此插件不需要 pnpm 安装、没有版本漂移；
 *  - 全部数据落在 `$DSH_HOME/dsh-todos/todos.json` 一个文件里，写入是
 *    「写临时文件 + rename」的原子替换，断电不会写坏；
 *  - 单文件让「整库导出/导入」这个需求变成一次文件拷贝。
 *
 * 本模块不依赖 Cordis，可单独测试。
 *
 * @module dsh-todos/store
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 数据格式版本。字段或语义变更时递增，并在 `migrate()` 里补迁移。 */
export const SCHEMA_VERSION = 1;

/** 回收站保留天数。 */
const TRASH_RETENTION_DAYS = 30;

const PRIORITIES = ['p1', 'p2', 'p3', 'p4'];

/** `$DSH_HOME`（缺省 `~/.dsh`）下的插件私有数据目录。 */
export function resolveDataDir() {
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME.trim()
    : path.join(os.homedir(), '.dsh');
  return path.join(home, 'dsh-todos');
}

// ------------------------------------------------------------------ 工具函数

/** 本地时区的 `YYYY-MM-DD`（所有日期口径统一为本地日）。 */
export function localDateKey(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 在本地日 `key` 上加减天数。 */
export function addDays(key, delta) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return localDateKey(dt);
}

function asString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function asTrimmed(value, max) {
  const s = typeof value === 'string' ? value.trim() : '';
  return max !== undefined && s.length > max ? s.slice(0, max) : s;
}

function asBoolean(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function asNumber(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asDateKey(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const probe = new Date(y, m - 1, d);
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d ? s : null;
}

function asTimeKey(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (match === null) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh > 23 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function asPriority(value) {
  return PRIORITIES.includes(value) ? value : 'p4';
}

function asIdArray(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const id = entry.trim();
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

// -------------------------------------------------------------- 规范化与迁移

/** 把任意输入修成合法任务；无法修复的返回 null。 */
function normalizeTask(raw) {
  if (raw === null || typeof raw !== 'object') return null;
  const title = asTrimmed(raw.title, 200);
  if (title === '') return null;
  const now = new Date().toISOString();
  const completed = asBoolean(raw.completed);
  return {
    id: asTrimmed(raw.id) || randomUUID(),
    title,
    note: asString(raw.note).slice(0, 20_000),
    projectId: asTrimmed(raw.projectId) || null,
    labelIds: asIdArray(raw.labelIds),
    priority: asPriority(raw.priority),
    dueDate: asDateKey(raw.dueDate),
    dueTime: asTimeKey(raw.dueTime),
    parentId: asTrimmed(raw.parentId) || null,
    repeat: normalizeRepeat(raw.repeat),
    order: asNumber(raw.order, 0),
    completed,
    completedAt: completed ? asString(raw.completedAt) || now : null,
    createdAt: asString(raw.createdAt) || now,
    updatedAt: asString(raw.updatedAt) || now,
    deletedAt: typeof raw.deletedAt === 'string' && raw.deletedAt !== '' ? raw.deletedAt : null,
  };
}

/** 重复规则：无法识别时降级为「不重复」。 */
function normalizeRepeat(raw) {
  if (raw === null || typeof raw !== 'object') return null;
  const freq = raw.freq;
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(freq)) return null;
  const interval = Math.min(Math.max(Math.floor(asNumber(raw.interval, 1)), 1), 365);
  const repeat = { freq, interval };
  if (freq === 'weekly' && Array.isArray(raw.weekdays)) {
    const days = raw.weekdays
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
      .filter((n, i, arr) => arr.indexOf(n) === i)
      .sort((a, b) => a - b);
    if (days.length > 0) repeat.weekdays = days;
  }
  if (freq === 'monthly') {
    const day = Math.floor(asNumber(raw.monthDay, 0));
    if (day >= 1 && day <= 31) repeat.monthDay = day;
  }
  const end = asDateKey(raw.endDate);
  if (end !== null) repeat.endDate = end;
  return repeat;
}

function normalizeProject(raw) {
  if (raw === null || typeof raw !== 'object') return null;
  const name = asTrimmed(raw.name, 80);
  if (name === '') return null;
  return {
    id: asTrimmed(raw.id) || randomUUID(),
    name,
    color: asTrimmed(raw.color, 32) || null,
    order: asNumber(raw.order, 0),
    archived: asBoolean(raw.archived),
    createdAt: asString(raw.createdAt) || new Date().toISOString(),
  };
}

function normalizeLabel(raw) {
  if (raw === null || typeof raw !== 'object') return null;
  const name = asTrimmed(raw.name, 40);
  if (name === '') return null;
  return {
    id: asTrimmed(raw.id) || randomUUID(),
    name,
    color: asTrimmed(raw.color, 32) || null,
    order: asNumber(raw.order, 0),
    createdAt: asString(raw.createdAt) || new Date().toISOString(),
  };
}

function normalizeSettings(raw, fallback) {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  return {
    weekGoal: Math.min(Math.max(Math.floor(asNumber(source.weekGoal, fallback.weekGoal)), 0), 999),
    remindEnabled: asBoolean(source.remindEnabled, fallback.remindEnabled),
    dailyDigest: asBoolean(source.dailyDigest, fallback.dailyDigest),
    digestTime: asTimeKey(source.digestTime) ?? fallback.digestTime,
    defaultRemindLead: Math.min(Math.max(Math.floor(asNumber(source.defaultRemindLead, 0)), 0), 10_080),
    weekStartsOn: source.weekStartsOn === 1 ? 1 : 0,
  };
}

// ------------------------------------------------------------------- Store

/**
 * 打开（或初始化）待办数据的单文件存储。
 *
 * @param {object} options
 * @param {string} [options.dir] 数据目录，缺省 `resolveDataDir()`。
 * @param {object} [options.defaults] patch 行带来的缺省设置。
 * @returns {object} store 句柄。
 */
export function createStore(options = {}) {
  const dir = options.dir ?? resolveDataDir();
  const file = path.join(dir, 'todos.json');
  const fallbackSettings = {
    weekGoal: 15,
    remindEnabled: true,
    dailyDigest: false,
    digestTime: '09:00',
    defaultRemindLead: 0,
    weekStartsOn: 0,
    ...(options.defaults ?? {}),
  };

  let state = emptyState(fallbackSettings);

  function emptyState(settings) {
    const now = new Date().toISOString();
    return {
      schemaVersion: SCHEMA_VERSION,
      tasks: [],
      projects: [],
      labels: [],
      settings: normalizeSettings(settings, fallbackSettings),
      meta: { createdAt: now, updatedAt: now },
    };
  }

  /** 把任意结构修成合法状态；同时清掉越界的父子引用。 */
  function repair(raw) {
    const base = emptyState(fallbackSettings);
    if (raw === null || typeof raw !== 'object') return base;
    const tasks = Array.isArray(raw.tasks) ? raw.tasks.map(normalizeTask).filter(Boolean) : [];
    const projects = Array.isArray(raw.projects) ? raw.projects.map(normalizeProject).filter(Boolean) : [];
    const labels = Array.isArray(raw.labels) ? raw.labels.map(normalizeLabel).filter(Boolean) : [];
    const ids = new Set(tasks.map((t) => t.id));
    const projectIds = new Set(projects.map((p) => p.id));
    const labelIds = new Set(labels.map((l) => l.id));
    for (const task of tasks) {
      if (task.parentId !== null && !ids.has(task.parentId)) task.parentId = null;
      if (task.projectId !== null && !projectIds.has(task.projectId)) task.projectId = null;
      task.labelIds = task.labelIds.filter((id) => labelIds.has(id));
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      tasks,
      projects,
      labels,
      settings: normalizeSettings(raw.settings, fallbackSettings),
      meta: {
        createdAt: asString(raw.meta?.createdAt) || base.meta.createdAt,
        updatedAt: asString(raw.meta?.updatedAt) || base.meta.updatedAt,
      },
    };
  }

  function migrate(loaded) {
    // v1 是首个版本；后续版本在这里按 schemaVersion 逐级补迁移。
    return loaded;
  }

  function load() {
    try {
      const text = fs.readFileSync(file, 'utf8');
      state = migrate(repair(JSON.parse(text)));
    } catch (error) {
      if (error?.code === 'ENOENT') {
        state = emptyState(fallbackSettings);
        return { ok: true, fresh: true };
      }
      // 文件存在但读不了/解析不了：留一份现场再重开，绝不静默覆盖。
      try {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        fs.mkdirSync(dir, { recursive: true });
        fs.copyFileSync(file, path.join(dir, `todos.corrupt-${stamp}.json`));
      } catch {
        /* 备份失败不阻塞恢复 */
      }
      state = emptyState(fallbackSettings);
      return { ok: false, fresh: true, error: String(error?.message ?? error) };
    }
    return { ok: true, fresh: false };
  }

  /** 原子写入：临时文件 + rename。 */
  function save() {
    state.meta.updatedAt = new Date().toISOString();
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return state.meta.updatedAt;
  }

  /** 落盘前的深拷贝，防止调用方改到内存态。 */
  function snapshot() {
    return JSON.parse(JSON.stringify(state));
  }

  function findTask(id) {
    return state.tasks.find((t) => t.id === id) ?? null;
  }

  function nextOrder(items) {
    if (items.length === 0) return 0;
    return Math.min(...items.map((i) => i.order)) - 1;
  }

  function createTask(input) {
    const now = new Date().toISOString();
    const task = normalizeTask({
      ...input,
      id: randomUUID(),
      order: nextOrder(state.tasks.filter((t) => t.deletedAt === null)),
      createdAt: now,
      updatedAt: now,
    });
    if (task === null) throw new StoreError('invalid-task', '标题不能为空');
    // 相对日期由调用方（解析器）翻成绝对日期后再进来。
    state.tasks.push(task);
    save();
    return task;
  }

  function updateTask(id, patch) {
    const task = findTask(id);
    if (task === null) throw new StoreError('missing-task', `找不到任务 ${id}`);
    const merged = normalizeTask({ ...task, ...patch, id: task.id, updatedAt: new Date().toISOString() });
    if (merged === null) throw new StoreError('invalid-task', '标题不能为空');
    Object.assign(task, merged);
    save();
    return task;
  }

  /**
   * 完成 / 取消完成若干任务。
   * 完成带重复规则的任务时，按规则补出下一次。
   */
  function completeTasks(ids, completed = true) {
    const now = new Date().toISOString();
    const touched = [];
    const spawned = [];
    for (const id of ids) {
      const task = findTask(id);
      if (task === null || task.deletedAt !== null) continue;
      task.completed = completed;
      task.completedAt = completed ? now : null;
      task.updatedAt = now;
      touched.push(task);
      if (completed && task.repeat !== null) {
        const next = spawnNextOccurrence(task);
        if (next !== null) {
          state.tasks.push(next);
          spawned.push(next);
        }
      }
    }
    if (touched.length > 0) save();
    return { touched, spawned };
  }

  /** 由一条重复任务推出下一次到期日；无到期日的重复任务不生成。 */
  function spawnNextOccurrence(task) {
    const base = task.dueDate ?? localDateKey();
    const rule = task.repeat;
    let next = null;
    if (rule.freq === 'daily') {
      next = addDays(base, rule.interval);
    } else if (rule.freq === 'weekly') {
      const days = Array.isArray(rule.weekdays) && rule.weekdays.length > 0
        ? rule.weekdays
        : [new Date(`${base}T00:00:00`).getDay()];
      for (let step = 1; step <= 7 * rule.interval + 7; step += 1) {
        const candidate = addDays(base, step);
        const weekday = new Date(`${candidate}T00:00:00`).getDay();
        if (days.includes(weekday)) {
          next = candidate;
          break;
        }
      }
    } else if (rule.freq === 'monthly') {
      const [y, m] = base.split('-').map(Number);
      const day = rule.monthDay ?? Number(base.slice(8, 10));
      const target = new Date(y, m - 1 + rule.interval, day);
      next = localDateKey(target);
    } else if (rule.freq === 'yearly') {
      const [y, m, d] = base.split('-').map(Number);
      next = localDateKey(new Date(y + rule.interval, m - 1, d));
    }
    if (next === null) return null;
    if (typeof rule.endDate === 'string' && next > rule.endDate) return null;
    const now = new Date().toISOString();
    return normalizeTask({
      ...task,
      id: randomUUID(),
      dueDate: next,
      completed: false,
      completedAt: null,
      order: nextOrder(state.tasks),
      createdAt: now,
      updatedAt: now,
      repeat: rule,
    });
  }

  /** 软删除：进回收站。 */
  function deleteTasks(ids) {
    const now = new Date().toISOString();
    const touched = [];
    for (const id of ids) {
      const task = findTask(id);
      if (task === null || task.deletedAt !== null) continue;
      task.deletedAt = now;
      task.updatedAt = now;
      touched.push(task);
      // 子任务随父任务一起进回收站。
      for (const child of state.tasks) {
        if (child.parentId === id && child.deletedAt === null) {
          child.deletedAt = now;
          child.updatedAt = now;
          touched.push(child);
        }
      }
    }
    if (touched.length > 0) save();
    return touched;
  }

  function restoreTasks(ids) {
    const now = new Date().toISOString();
    const touched = [];
    for (const id of ids) {
      const task = findTask(id);
      if (task === null || task.deletedAt === null) continue;
      task.deletedAt = null;
      task.updatedAt = now;
      touched.push(task);
    }
    if (touched.length > 0) save();
    return touched;
  }

  /** 彻底删除；`ids` 省略时清空回收站。 */
  function purgeTasks(ids) {
    const before = state.tasks.length;
    if (Array.isArray(ids) && ids.length > 0) {
      const set = new Set(ids);
      state.tasks = state.tasks.filter((t) => !set.has(t.id));
    } else {
      state.tasks = state.tasks.filter((t) => t.deletedAt === null);
    }
    const removed = before - state.tasks.length;
    if (removed > 0) save();
    return removed;
  }

  /** 顺带清掉超过保留期的回收站内容。 */
  function sweepTrash() {
    const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 86_400_000).toISOString();
    const before = state.tasks.length;
    state.tasks = state.tasks.filter((t) => t.deletedAt === null || t.deletedAt > cutoff);
    const removed = before - state.tasks.length;
    if (removed > 0) save();
    return removed;
  }

  function upsertProject(input) {
    const project = normalizeProject(input);
    if (project === null) throw new StoreError('invalid-project', '项目名不能为空');
    const existing = state.projects.find((p) => p.id === project.id);
    if (existing !== undefined) {
      Object.assign(existing, project, { createdAt: existing.createdAt });
    } else {
      project.order = nextOrder(state.projects);
      state.projects.push(project);
    }
    save();
    return existing ?? project;
  }

  function deleteProject(id) {
    state.projects = state.projects.filter((p) => p.id !== id);
    // 项目下的任务回到收件箱，而不是被连带删除。
    for (const task of state.tasks) if (task.projectId === id) task.projectId = null;
    save();
    return true;
  }

  function upsertLabel(input) {
    const label = normalizeLabel(input);
    if (label === null) throw new StoreError('invalid-label', '标签名不能为空');
    const existing = state.labels.find((l) => l.id === label.id);
    if (existing !== undefined) {
      Object.assign(existing, label, { createdAt: existing.createdAt });
    } else {
      label.order = nextOrder(state.labels);
      state.labels.push(label);
    }
    save();
    return existing ?? label;
  }

  function deleteLabel(id) {
    state.labels = state.labels.filter((l) => l.id !== id);
    for (const task of state.tasks) task.labelIds = task.labelIds.filter((l) => l !== id);
    save();
    return true;
  }

  function updateSettings(patch) {
    state.settings = normalizeSettings({ ...state.settings, ...(patch ?? {}) }, fallbackSettings);
    save();
    return state.settings;
  }

  /** 整库导出（导入导出功能与 Agent 工具共用）。 */
  function exportState() {
    return { exportedAt: new Date().toISOString(), schemaVersion: SCHEMA_VERSION, data: snapshot() };
  }

  /**
   * 整库导入。
   * @param {object} payload - `exportState()` 的产物，或裸的 data 对象。
   * @param {'replace'|'merge'} mode
   */
  function importState(payload, mode = 'replace') {
    const incoming = repair(payload?.data ?? payload);
    if (mode === 'merge') {
      const known = new Set(state.tasks.map((t) => t.id));
      const knownProjects = new Set(state.projects.map((p) => p.id));
      const knownLabels = new Set(state.labels.map((l) => l.id));
      for (const p of incoming.projects) if (!knownProjects.has(p.id)) state.projects.push(p);
      for (const l of incoming.labels) if (!knownLabels.has(l.id)) state.labels.push(l);
      for (const t of incoming.tasks) if (!known.has(t.id)) state.tasks.push(t);
    } else {
      // 保留本机设置：设置是设备偏好，不是任务数据。
      const keepSettings = state.settings;
      state = { ...incoming, settings: keepSettings };
    }
    save();
    return { tasks: state.tasks.length, projects: state.projects.length, labels: state.labels.length };
  }

  load();

  return {
    dir,
    file,
    get state() {
      return state;
    },
    snapshot,
    save,
    load,
    createTask,
    updateTask,
    completeTasks,
    deleteTasks,
    restoreTasks,
    purgeTasks,
    sweepTrash,
    upsertProject,
    deleteProject,
    upsertLabel,
    deleteLabel,
    updateSettings,
    exportState,
    importState,
  };
}

/** store 抛出的可识别错误。 */
export class StoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
  }
}
