/**
 * 待办中心 —— Agent 工具。
 *
 * 七个 `todos_*` 工具，全部走 actions.js 与界面同一条写入路径。
 * 本文件不 import 任何 `@deepseek-ai/*` 包：工具定义用**原始 JSON Schema**，
 * 由 `ctx.tools.register()` 直接接收（与已安装的 WeKnora 插件同构）。
 *
 * 命名用 `todos_` 前缀，避开 DSH 内置的 `todo_write`（那个是 Agent 自己的
 * 内部计划清单，与本插件的用户待办是两件事）。
 *
 * @module dsh-todos/tools
 */

import { quickAdd, filterTasks, presentTask, describeRepeat } from './actions.js';
import { computeStats, deriveCounts } from './select.js';
import { localDateKey } from './store.js';

const text = (value) => [{ type: 'text', text: value }];

const STRING_ARRAY = { type: 'array', items: { type: 'string' } };

const PRIORITY = { type: 'string', enum: ['p1', 'p2', 'p3', 'p4'] };

const REPEAT = {
  type: 'object',
  properties: {
    freq: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'yearly'] },
    interval: { type: 'integer' },
    weekdays: { type: 'array', items: { type: 'integer' } },
    monthDay: { type: 'integer' },
    endDate: { type: 'string' },
  },
  required: ['freq'],
  additionalProperties: false,
};

const TASK_ITEM = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '任务标题。与 input 二选一。' },
    input: {
      type: 'string',
      description:
        '自然语言写法，交给快速添加解析器（例：「明天下午3点 交报告 #Q4汇报 @写作 p1」）。给了 input 就不必再给其它字段。',
    },
    note: { type: 'string' },
    project: { type: 'string', description: '项目名；不存在时按 createMissingProjects 决定是否新建。' },
    labels: { ...STRING_ARRAY, description: '标签名列表；不存在时按需新建。' },
    priority: PRIORITY,
    dueDate: { type: 'string', description: '本地日期 YYYY-MM-DD。' },
    dueTime: { type: 'string', description: '本地时间 HH:mm，留空表示全天。' },
    repeat: REPEAT,
    parentId: { type: 'string', description: '父任务 id，用于创建子任务。' },
  },
  additionalProperties: false,
};

// ------------------------------------------------------------------ 辅助

function resolveProjectId(store, state, value, createMissing) {
  if (typeof value !== 'string' || value.trim() === '') return { id: null, created: null };
  const name = value.trim();
  if (name.toLowerCase() === 'inbox' || name === '收件箱') return { id: null, created: null };
  const existing = state.projects.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (existing !== undefined) return { id: existing.id, created: null };
  if (createMissing === false) return { id: null, created: null };
  const project = store.upsertProject({ name });
  return { id: project.id, created: project.name };
}

function resolveLabelIds(store, state, values, createMissing) {
  const ids = [];
  const created = [];
  for (const raw of Array.isArray(values) ? values : []) {
    if (typeof raw !== 'string' || raw.trim() === '') continue;
    const name = raw.trim();
    const existing = state.labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (existing !== undefined) {
      ids.push(existing.id);
      continue;
    }
    if (createMissing === false) continue;
    const label = store.upsertLabel({ name });
    ids.push(label.id);
    created.push(label.name);
  }
  return { ids, created };
}

/**
 * 把**已经规范化过的任务视图**（`presentTask` 的产物）渲染成一行。
 *
 * 注意：这里刻意不再调 `presentTask`——工具的返回值统一都是视图，
 * render 只做格式化；重复规范化会把 `labels` 从字符串数组当成 id 数组再解一次。
 */
function summariseView(view) {
  const bits = [];
  if (view.dueDate !== '') bits.push(view.dueTime === '' ? view.dueDate : `${view.dueDate} ${view.dueTime}`);
  if (view.project !== '') bits.push(`#${view.project}`);
  if (view.labels.length > 0) bits.push(view.labels.map((l) => `@${l}`).join(' '));
  if (view.priority !== 'p4') bits.push(view.priority.toUpperCase());
  if (view.repeat !== '') bits.push(`↻${view.repeat}`);
  return `- [${view.completed ? 'x' : ' '}] ${view.title}${bits.length === 0 ? '' : `  (${bits.join(' · ')})`}  id=${view.id}`;
}

// ------------------------------------------------------------------- 工具

/**
 * 组装工具定义数组。
 *
 * @param {object} store
 * @param {object} [config]
 * @returns {Array<object>} 可直接交给 `ctx.tools.register()` 的定义。
 */
export function createTools(store, config = {}) {
  const weekGoal = Number.isFinite(config.weekGoal) ? config.weekGoal : 15;

  return [
    // ------------------------------------------------------------ 查询
    {
      name: 'todos_list',
      description:
        '查询用户自己的待办任务（不是 Agent 的内部计划清单）。'
        + '默认只返回未完成任务，并按到期日 → 优先级 → 手动顺序排序。'
        + 'view 支持 today / upcoming / inbox / overdue / completed / all。',
      parameters: {
        type: 'object',
        properties: {
          view: { type: 'string', enum: ['active', 'today', 'upcoming', 'inbox', 'overdue', 'completed', 'all'] },
          project: { type: 'string', description: '项目名，或 "inbox"。' },
          label: { type: 'string' },
          priority: PRIORITY,
          text: { type: 'string', description: '在标题与备注里模糊匹配。' },
          dueFrom: { type: 'string' },
          dueTo: { type: 'string' },
          includeCompleted: { type: 'boolean' },
          limit: { type: 'integer', description: '缺省 100，最多 500。' },
        },
        additionalProperties: false,
      },
      timeoutMs: 5000,
      isConcurrencySafe: () => true,
      output: {
        schema: {
          type: 'object',
          properties: {
            total: { type: 'integer' },
            count: { type: 'integer' },
            today: { type: 'string' },
            tasks: { type: 'array', items: { type: 'object' } },
          },
          required: ['total', 'count', 'today', 'tasks'],
        },
        render: (_args, value) => {
          if (value.count === 0) return text(`没有符合条件的任务（参考日 ${value.today}）。`);
          const lines = value.tasks.map((t) => `- [${t.completed ? 'x' : ' '}] ${t.title}  id=${t.id}`
            + (t.dueDate === '' ? '' : `  ${t.dueDate}${t.dueTime === '' ? '' : ` ${t.dueTime}`}`)
            + (t.project === '' ? '' : `  #${t.project}`)
            + (t.labels.length === 0 ? '' : `  ${t.labels.map((l) => `@${l}`).join(' ')}`)
            + (t.priority === 'p4' ? '' : `  ${t.priority.toUpperCase()}`));
          const more = value.total > value.count ? `\n（共 ${value.total} 条，只列出前 ${value.count} 条）` : '';
          return text(`${value.count} 条任务（参考日 ${value.today}）：\n${lines.join('\n')}${more}`);
        },
      },
      execute(args) {
        const state = store.snapshot();
        const result = filterTasks(state, args ?? {});
        return {
          total: result.total,
          count: result.tasks.length,
          today: result.today,
          tasks: result.tasks.map((task) => presentTask(task, state)),
        };
      },
    },

    // ------------------------------------------------------------ 新建
    {
      name: 'todos_create',
      description:
        '为用户新建待办任务，支持批量。'
        + '每个条目给 title 走结构化字段，或给 input 走自然语言解析（「明天下午3点 交报告 #Q4汇报 @写作 p1」）。'
        + '项目名或标签名不存在时默认新建。',
      parameters: {
        type: 'object',
        properties: {
          items: { type: 'array', items: TASK_ITEM, description: '要创建的任务，可一次多条。' },
          createMissingProjects: { type: 'boolean', description: '缺省 true。' },
        },
        required: ['items'],
        additionalProperties: false,
      },
      timeoutMs: 15000,
      isConcurrencySafe: () => false,
      output: {
        schema: {
          type: 'object',
          properties: {
            created: { type: 'array', items: { type: 'object' } },
            createdProjects: { type: 'array', items: { type: 'string' } },
            createdLabels: { type: 'array', items: { type: 'string' } },
            failed: { type: 'array', items: { type: 'string' } },
          },
          required: ['created', 'createdProjects', 'createdLabels', 'failed'],
        },
        render: (_args, value) => {
          const lines = value.created.map((t) => `- ${t.title}${t.dueDate === '' ? '' : `  ${t.dueDate}${t.dueTime === '' ? '' : ` ${t.dueTime}`}`}${t.project === '' ? '' : `  #${t.project}`}  id=${t.id}`);
          const extra = [];
          if (value.createdProjects.length > 0) extra.push(`新建项目：${value.createdProjects.join('、')}`);
          if (value.createdLabels.length > 0) extra.push(`新建标签：${value.createdLabels.join('、')}`);
          if (value.failed.length > 0) extra.push(`失败：${value.failed.join('；')}`);
          const head = `已创建 ${value.created.length} 条任务。`;
          const tail = extra.length === 0 ? '' : `\n${extra.join('\n')}`;
          return text(`${head}${lines.length === 0 ? '' : `\n${lines.join('\n')}`}${tail}`);
        },
      },
      execute(args) {
        const items = Array.isArray(args?.items) ? args.items : [];
        const createMissing = args?.createMissingProjects !== false;
        const created = [];
        const createdProjects = [];
        const createdLabels = [];
        const failed = [];

        for (const item of items) {
          try {
            if (typeof item?.input === 'string' && item.input.trim() !== '') {
              const extra = {};
              if (typeof item.priority === 'string') extra.priority = item.priority;
              if (typeof item.parentId === 'string') extra.parentId = item.parentId;
              const result = quickAdd(store, item.input, { createMissing, extra });
              createdProjects.push(...result.created.projects);
              createdLabels.push(...result.created.labels);
              created.push(presentTask(result.task, store.snapshot()));
              continue;
            }

            const title = typeof item?.title === 'string' ? item.title.trim() : '';
            if (title === '') {
              failed.push('条目既没有 title 也没有 input');
              continue;
            }
            const state = store.snapshot();
            const project = resolveProjectId(store, state, item.project, createMissing);
            if (project.created !== null) createdProjects.push(project.created);
            const labels = resolveLabelIds(store, state, item.labels, createMissing);
            createdLabels.push(...labels.created);

            const task = store.createTask({
              title,
              note: typeof item.note === 'string' ? item.note : '',
              projectId: project.id,
              labelIds: labels.ids,
              priority: item.priority,
              dueDate: item.dueDate,
              dueTime: item.dueTime,
              repeat: item.repeat,
              parentId: typeof item.parentId === 'string' && item.parentId !== '' ? item.parentId : null,
            });
            created.push(presentTask(task, store.snapshot()));
          } catch (error) {
            failed.push(String(error?.message ?? error));
          }
        }

        return {
          created,
          createdProjects: [...new Set(createdProjects)],
          createdLabels: [...new Set(createdLabels)],
          failed,
        };
      },
    },

    // ------------------------------------------------------------ 修改
    {
      name: 'todos_update',
      description:
        '修改已有任务。用 id 定位（先用 todos_list 拿到 id）。'
        + '只传要改的字段。project 传空串可移回收件箱。',
      parameters: {
        type: 'object',
        properties: {
          updates: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                note: { type: 'string' },
                project: { type: 'string' },
                labels: STRING_ARRAY,
                priority: PRIORITY,
                dueDate: { type: 'string', description: '空串表示清空到期日。' },
                dueTime: { type: 'string', description: '空串表示清空时间。' },
                repeat: REPEAT,
                completed: { type: 'boolean' },
              },
              required: ['id'],
              additionalProperties: false,
            },
          },
          createMissingProjects: { type: 'boolean' },
        },
        required: ['updates'],
        additionalProperties: false,
      },
      timeoutMs: 15000,
      isConcurrencySafe: () => false,
      output: {
        schema: {
          type: 'object',
          properties: {
            updated: { type: 'array', items: { type: 'object' } },
            failed: { type: 'array', items: { type: 'string' } },
          },
          required: ['updated', 'failed'],
        },
        render: (_args, value) => {
          const lines = value.updated.map((t) => summariseView(t));
          const tail = value.failed.length === 0 ? '' : `\n失败：${value.failed.join('；')}`;
          return text(`已更新 ${value.updated.length} 条任务。${lines.length === 0 ? '' : `\n${lines.join('\n')}`}${tail}`);
        },
      },
      execute(args) {
        const updates = Array.isArray(args?.updates) ? args.updates : [];
        const createMissing = args?.createMissingProjects !== false;
        const updated = [];
        const failed = [];

        for (const entry of updates) {
          try {
            const id = typeof entry?.id === 'string' ? entry.id : '';
            if (id === '') throw new Error('缺少任务 id');
            const patch = {};
            for (const key of ['title', 'note', 'priority']) {
              if (entry[key] !== undefined) patch[key] = entry[key];
            }
            if (entry.dueDate !== undefined) patch.dueDate = entry.dueDate === '' ? null : entry.dueDate;
            if (entry.dueTime !== undefined) patch.dueTime = entry.dueTime === '' ? null : entry.dueTime;
            if (entry.repeat !== undefined) patch.repeat = entry.repeat;
            if (entry.completed !== undefined) patch.completed = entry.completed;
            if (entry.completed !== undefined) patch.completedAt = entry.completed ? new Date().toISOString() : null;

            if (entry.project !== undefined) {
              const state = store.snapshot();
              patch.projectId = resolveProjectId(store, state, entry.project, createMissing).id;
            }
            if (entry.labels !== undefined) {
              const state = store.snapshot();
              patch.labelIds = resolveLabelIds(store, state, entry.labels, createMissing).ids;
            }

            const task = store.updateTask(id, patch);
            updated.push(presentTask(task, store.snapshot()));
          } catch (error) {
            failed.push(String(error?.message ?? error));
          }
        }

        return { updated, failed };
      },
    },

    // -------------------------------------------------------- 完成 / 删除
    {
      name: 'todos_complete',
      description:
        '把任务标记为完成或未完成。完成一条带重复规则的任务时，会自动补出下一次。',
      parameters: {
        type: 'object',
        properties: {
          ids: { ...STRING_ARRAY, description: '任务 id 列表。' },
          completed: { type: 'boolean', description: '缺省 true；传 false 表示取消完成。' },
        },
        required: ['ids'],
        additionalProperties: false,
      },
      timeoutMs: 10000,
      isConcurrencySafe: () => false,
      output: {
        schema: {
          type: 'object',
          properties: {
            completed: { type: 'array', items: { type: 'object' } },
            spawned: { type: 'array', items: { type: 'object' } },
          },
          required: ['completed', 'spawned'],
        },
        render: (_args, value) => {
          const done = value.completed.filter((t) => t.completed).length;
          const undone = value.completed.length - done;
          const parts = [];
          if (done > 0) parts.push(`完成 ${done} 条`);
          if (undone > 0) parts.push(`取消完成 ${undone} 条`);
          const spawn = value.spawned.length === 0
            ? ''
            : `\n已按重复规则补出下一次：${value.spawned.map((t) => `${t.title}（${t.dueDate}）`).join('、')}`;
          return text(`${parts.length === 0 ? '没有匹配到可操作的任务' : parts.join('，')}。${spawn}`);
        },
      },
      execute(args) {
        const ids = (Array.isArray(args?.ids) ? args.ids : []).filter((id) => typeof id === 'string' && id !== '');
        const result = store.completeTasks(ids, args?.completed !== false);
        const state = store.snapshot();
        return {
          completed: result.touched.map((task) => presentTask(task, state)),
          spawned: result.spawned.map((task) => presentTask(task, state)),
        };
      },
    },

    {
      name: 'todos_delete',
      description:
        '删除任务。默认进回收站（30 天内可恢复）；permanent 为 true 时彻底删除。',
      parameters: {
        type: 'object',
        properties: {
          ids: { ...STRING_ARRAY, description: '任务 id 列表。' },
          permanent: { type: 'boolean', description: '缺省 false。' },
        },
        required: ['ids'],
        additionalProperties: false,
      },
      timeoutMs: 10000,
      isConcurrencySafe: () => false,
      output: {
        schema: {
          type: 'object',
          properties: {
            deleted: { type: 'integer' },
            permanent: { type: 'boolean' },
          },
          required: ['deleted', 'permanent'],
        },
        render: (_args, value) =>
          text(
            value.deleted === 0
              ? '没有匹配到可删除的任务。'
              : value.permanent
                ? `已彻底删除 ${value.deleted} 条任务。`
                : `已把 ${value.deleted} 条任务移入回收站（30 天内可恢复）。`,
          ),
      },
      execute(args) {
        const ids = (Array.isArray(args?.ids) ? args.ids : []).filter((id) => typeof id === 'string' && id !== '');
        const permanent = args?.permanent === true;
        const deleted = permanent ? store.purgeTasks(ids) : store.deleteTasks(ids).length;
        return { deleted, permanent };
      },
    },

    // ------------------------------------------------------------ 统计
    {
      name: 'todos_stats',
      description:
        '统计用户待办：今日待办数、逾期数、本期完成数、完成率、连续完成天数、'
        + '近 14 天完成/新增趋势、优先级分布、项目分布、90 天完成热力图。'
        + '适合回答「我这周完成得怎么样」。',
      parameters: {
        type: 'object',
        properties: {
          range: { type: 'string', enum: ['today', 'week', 'month', 'last30', 'last90'] },
        },
        additionalProperties: false,
      },
      timeoutMs: 5000,
      isConcurrencySafe: () => true,
      output: {
        schema: {
          type: 'object',
          properties: {
            range: { type: 'object' },
            kpi: { type: 'object' },
            trend: { type: 'array', items: { type: 'object' } },
            priority: { type: 'object' },
            projects: { type: 'array', items: { type: 'object' } },
            labels: { type: 'array', items: { type: 'object' } },
            heatmap: { type: 'array', items: { type: 'object' } },
          },
          required: ['range', 'kpi', 'trend', 'priority', 'projects', 'labels', 'heatmap'],
        },
        render: (args, value) => {
          const k = value.kpi;
          const delta = k.deltaCompleted === 0 ? '与上期持平' : k.deltaCompleted > 0 ? `比上期多 ${k.deltaCompleted}` : `比上期少 ${-k.deltaCompleted}`;
          const lines = [
            `范围：${value.range.from} ~ ${value.range.to}`,
            `今日待办 ${k.dueToday} 条，逾期 ${k.overdue} 条，活跃 ${k.active} 条`,
            `本期完成 ${k.completed} 条（${delta}），新增 ${k.created} 条，完成率 ${k.completionRate}%`,
            `连续完成 ${k.streak} 天；每周目标 ${weekGoal} 条`,
          ];
          const projects = value.projects.filter((p) => p.count > 0).slice(0, 5);
          if (projects.length > 0) lines.push(`项目分布：${projects.map((p) => `${p.name} ${p.count}`).join('、')}`);
          return text(lines.join('\n'));
        },
      },
      execute(args) {
        const state = store.snapshot();
        const stats = computeStats(state, args?.range ?? 'last30', localDateKey());
        return {
          range: stats.range,
          kpi: stats.kpi,
          trend: stats.trend,
          priority: stats.priority,
          projects: stats.breakdown.projects,
          labels: stats.breakdown.labels,
          heatmap: stats.heatmap,
        };
      },
    },

    // ------------------------------------------------------- 项目 / 标签
    {
      name: 'todos_projects',
      description:
        '列出、新建或删除项目与标签。用户说「放进 X 项目」而 X 不存在时，用 action=create 建它。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'create', 'delete'] },
          kind: { type: 'string', enum: ['project', 'label'], description: '缺省 project。' },
          name: { type: 'string', description: 'create 时的名字。' },
          id: { type: 'string', description: 'delete 时的 id。' },
        },
        required: ['action'],
        additionalProperties: false,
      },
      timeoutMs: 5000,
      isConcurrencySafe: () => false,
      output: {
        schema: {
          type: 'object',
          properties: {
            kind: { type: 'string' },
            projects: { type: 'array', items: { type: 'object' } },
            labels: { type: 'array', items: { type: 'object' } },
            message: { type: 'string' },
          },
          required: ['kind', 'projects', 'labels', 'message'],
        },
        render: (_args, value) => {
          if (value.message !== '') return text(value.message);
          const lines = [];
          if (value.projects.length > 0) {
            lines.push(`项目：${value.projects.map((p) => `${p.name}（${p.open} 条未完成，id=${p.id}）`).join('；')}`);
          }
          if (value.labels.length > 0) {
            lines.push(`标签：${value.labels.map((l) => `${l.name}（${l.open} 条，id=${l.id}）`).join('；')}`);
          }
          return text(lines.length === 0 ? '还没有任何项目或标签。' : lines.join('\n'));
        },
      },
      execute(args) {
        const kind = args?.kind === 'label' ? 'label' : 'project';
        const empty = { kind, projects: [], labels: [], message: '' };

        if (args?.action === 'create') {
          const name = typeof args.name === 'string' ? args.name.trim() : '';
          if (name === '') return { ...empty, message: '缺少 name。' };
          if (kind === 'label') {
            const label = store.upsertLabel({ name });
            return { ...empty, message: `已新建标签「${label.name}」（id=${label.id}）。` };
          }
          const project = store.upsertProject({ name });
          return { ...empty, message: `已新建项目「${project.name}」（id=${project.id}）。` };
        }

        if (args?.action === 'delete') {
          const id = typeof args.id === 'string' ? args.id : '';
          if (id === '') return { ...empty, message: '缺少 id。' };
          if (kind === 'label') {
            store.deleteLabel(id);
            return { ...empty, message: '已删除该标签，并从相关任务上摘掉。' };
          }
          store.deleteProject(id);
          return { ...empty, message: '已删除该项目，其下任务已回到收件箱。' };
        }

        const state = store.snapshot();
        const counts = deriveCounts(state, localDateKey());
        return {
          kind,
          projects: state.projects.map((p) => ({ id: p.id, name: p.name, open: counts.byProject[p.id] ?? 0 })),
          labels: state.labels.map((l) => ({ id: l.id, name: l.name, open: counts.byLabel[l.id] ?? 0 })),
          message: '',
        };
      },
    },
  ];
}

export { describeRepeat };
