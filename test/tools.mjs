/**
 * 待办中心 —— Agent 工具的测试。
 *
 * 直接调 `createTools()` 产出的 `execute`（不经过模型），验证：
 *  - 七个工具的定义形状齐全（name/description/parameters/output.schema/render/execute）；
 *  - 自然语言入口能落库并自动建项目/标签；
 *  - render 一定返回 `{type:'text'}` 内容块（模型看到的就是它）。
 *
 * 运行：node test/tools.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createStore, localDateKey, addDays } from '../lib/store.js';
import { createTools } from '../lib/tools.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-todos-tools-'));
const store = createStore({ dir, defaults: { weekGoal: 15 } });
const tools = createTools(store, { weekGoal: 15 });
const byName = new Map(tools.map((t) => [t.name, t]));
const today = localDateKey();

const cases = [];
const it = (name, fn) => cases.push({ name, fn });
const eq = (a, b, what) => assert.deepEqual(a, b, `${what}：期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`);

const run = (name, args) => {
  const tool = byName.get(name);
  assert.ok(tool !== undefined, `工具不存在：${name}`);
  return tool.execute(args, { signal: undefined });
};

// -------------------------------------------------------- 定义形状

it('注册了七个 todos_* 工具，且不与内置 todo_write 撞名', () => {
  eq(
    tools.map((t) => t.name),
    ['todos_list', 'todos_create', 'todos_update', 'todos_complete', 'todos_delete', 'todos_stats', 'todos_projects'],
    '工具名',
  );
  assert.ok(!tools.some((t) => t.name === 'todo_write'), '不得占用内置的 todo_write');
});

it('每个工具的定义形状齐全', () => {
  for (const tool of tools) {
    assert.equal(typeof tool.name, 'string', `${tool.name}: name`);
    assert.ok(tool.name.startsWith('todos_'), `${tool.name}: 前缀`);
    assert.ok(typeof tool.description === 'string' && tool.description.length > 10, `${tool.name}: description`);
    assert.equal(tool.parameters.type, 'object', `${tool.name}: parameters 必须是 object schema`);
    assert.ok(tool.output !== undefined && typeof tool.output.render === 'function', `${tool.name}: output.render`);
    assert.equal(tool.output.schema.type, 'object', `${tool.name}: output.schema 必须是 object schema`);
    assert.equal(typeof tool.execute, 'function', `${tool.name}: execute`);
  }
});

it('每个工具的 output.schema 是合法 JSON Schema 形状', () => {
  const walk = (node, at) => {
    if (node === null || typeof node !== 'object') return;
    if (node.type !== undefined) {
      const types = Array.isArray(node.type) ? node.type : [node.type];
      for (const t of types) {
        assert.ok(
          ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(t),
          `${at}: 未知 type ${t}`,
        );
      }
    }
    if (node.properties !== undefined) {
      assert.equal(node.type, 'object', `${at}: 有 properties 就必须是 object`);
      for (const [key, child] of Object.entries(node.properties)) walk(child, `${at}.${key}`);
    }
    if (node.items !== undefined) {
      assert.equal(node.type, 'array', `${at}: 有 items 就必须是 array`);
      walk(node.items, `${at}[]`);
    }
  };
  for (const tool of tools) walk(tool.output.schema, tool.name);
});

// -------------------------------------------------------- 自然语言建卡

it('todos_create 的 input 入口会解析自然语言并自动建项目/标签', async () => {
  const result = await run('todos_create', {
    items: [{ input: `明天下午3点 交季度报告 #Q4汇报 @写作 p1` }],
  });
  eq(result.failed, [], 'failed');
  eq(result.created.length, 1, 'created 数量');
  eq(result.createdProjects, ['Q4汇报'], '自动建的项目');
  eq(result.createdLabels, ['写作'], '自动建的标签');
  eq(result.created[0].title, '交季度报告', 'title');
  eq(result.created[0].dueDate, addDays(today, 1), 'dueDate');
  eq(result.created[0].dueTime, '15:00', 'dueTime');
  eq(result.created[0].priority, 'p1', 'priority');
  eq(result.created[0].project, 'Q4汇报', 'project');
  eq(result.created[0].labels, ['写作'], 'labels');
});

it('todos_create 的结构化入口按名字解析已有的项目/标签', async () => {
  const result = await run('todos_create', {
    items: [{ title: '预约体检', dueDate: today, labels: ['写作'] }],
  });
  eq(result.created.length, 1, 'created 数量');
  eq(result.created[0].labels, ['写作'], 'labels 应复用已建标签');
  eq(result.createdProjects, [], '不应重复建项目');
});

it('todos_create 会报告失败条目而不是整体抛错', async () => {
  const result = await run('todos_create', { items: [{ note: '没有标题' }, { title: '正常任务' }] });
  eq(result.created.length, 1, '成功一条');
  eq(result.failed.length, 1, '失败一条');
});

it('todos_create 支持子任务（parentId）', async () => {
  const parent = await run('todos_create', { items: [{ title: '父任务' }] });
  const child = await run('todos_create', { items: [{ title: '子任务', parentId: parent.created[0].id }] });
  eq(child.created[0].parentId, parent.created[0].id, 'parentId');
});

// -------------------------------------------------------------- 查询

it('todos_list 默认只返回未完成，且支持 view/priority/text 过滤', async () => {
  const all = await run('todos_list', {});
  assert.ok(all.count >= 4, `应有若干未完成任务，实际 ${all.count}`);
  assert.ok(all.tasks.every((t) => !t.completed), '默认不含已完成');

  const todayView = await run('todos_list', { view: 'today' });
  assert.ok(todayView.tasks.every((t) => t.dueDate !== '' && t.dueDate <= today), 'today 视图口径');

  const inbox = await run('todos_list', { view: 'inbox' });
  assert.ok(inbox.tasks.every((t) => t.dueDate === ''), 'inbox 口径');

  const p1 = await run('todos_list', { priority: 'p1' });
  assert.ok(p1.tasks.every((t) => t.priority === 'p1'), 'priority 过滤');

  const byText = await run('todos_list', { text: '体检' });
  eq(byText.count, 1, 'text 过滤');
});

it('todos_list 的 limit 生效并如实报告 total', async () => {
  const result = await run('todos_list', { limit: 2 });
  assert.ok(result.count <= 2, 'count 受 limit 限制');
  assert.ok(result.total >= result.count, 'total 是过滤后的总数');
});

it('todos_list 的项目过滤接受项目名', async () => {
  const result = await run('todos_list', { project: 'Q4汇报' });
  assert.ok(result.count >= 1, '应能按项目名过滤');
  assert.ok(result.tasks.every((t) => t.project === 'Q4汇报'), '项目口径');
});

// -------------------------------------------------------------- 修改

it('todos_update 能改字段、清空到期日、移回收件箱', async () => {
  const created = await run('todos_create', { items: [{ title: '待改任务', dueDate: today, priority: 'p3' }] });
  const id = created.created[0].id;

  const updated = await run('todos_update', {
    updates: [{ id, title: '改过的任务', dueDate: '', project: '', priority: 'p2' }],
  });
  eq(updated.failed, [], 'failed');
  eq(updated.updated[0].title, '改过的任务', 'title');
  eq(updated.updated[0].dueDate, '', 'dueDate 应被清空');
  eq(updated.updated[0].projectId, '', 'projectId 应为空（收件箱）');
  eq(updated.updated[0].priority, 'p2', 'priority');
});

it('todos_update 对不存在的 id 报失败而不是抛错', async () => {
  const result = await run('todos_update', { updates: [{ id: 'no-such-id', title: 'x' }] });
  eq(result.updated.length, 0, 'updated');
  eq(result.failed.length, 1, 'failed');
});

// -------------------------------------------------------- 完成 / 删除

it('todos_complete 完成并支持撤销；重复任务会补出下一次', async () => {
  const created = await run('todos_create', {
    items: [{ title: '每周复盘', dueDate: today, repeat: { freq: 'weekly', interval: 1, weekdays: [5] } }],
  });
  const id = created.created[0].id;

  const done = await run('todos_complete', { ids: [id] });
  eq(done.completed.length, 1, '完成数量');
  eq(done.completed[0].completed, true, 'completed');
  eq(done.spawned.length, 1, '应补出下一次');
  assert.ok(done.spawned[0].dueDate > today, '下一次到期日在未来');

  const undone = await run('todos_complete', { ids: [id], completed: false });
  eq(undone.completed[0].completed, false, '撤销完成');
  eq(undone.completed[0].completedAt, '', 'completedAt 应清空');
});

it('todos_delete 默认进回收站，permanent 才彻底删除', async () => {
  const created = await run('todos_create', { items: [{ title: '要删的任务' }] });
  const id = created.created[0].id;

  const soft = await run('todos_delete', { ids: [id] });
  eq(soft.deleted, 1, '软删数量');
  eq(soft.permanent, false, 'permanent');
  const afterSoft = await run('todos_list', { view: 'all', includeCompleted: true });
  assert.ok(!afterSoft.tasks.some((t) => t.id === id), '软删后不应出现在列表里');

  const hard = await run('todos_delete', { ids: [id], permanent: true });
  eq(hard.deleted, 1, '彻底删除数量');
  eq(hard.permanent, true, 'permanent');
});

// -------------------------------------------------------------- 统计

it('todos_stats 返回 KPI/趋势/分布/热力图，且与列表口径一致', async () => {
  const stats = await run('todos_stats', { range: 'last30' });
  assert.ok(stats.kpi.active >= 1, 'active');
  assert.equal(stats.trend.length, 14, 'trend 长度');
  assert.equal(stats.heatmap.length, 90, 'heatmap 长度');
  assert.ok(Array.isArray(stats.projects), 'projects');
  assert.ok(Array.isArray(stats.labels), 'labels');
  assert.equal(typeof stats.kpi.completionRate, 'number', 'completionRate');

  const list = await run('todos_list', { view: 'active' });
  eq(stats.kpi.active, list.total, 'KPI 的活跃数应等于 active 视图总数');
});

// ------------------------------------------------------- 项目 / 标签

it('todos_projects 能列出、新建、删除项目与标签', async () => {
  const listed = await run('todos_projects', { action: 'list' });
  assert.ok(listed.projects.some((p) => p.name === 'Q4汇报'), '应能列出已建项目');
  assert.ok(listed.labels.some((l) => l.name === '写作'), '应能列出已建标签');
  assert.ok(listed.projects.every((p) => Number.isInteger(p.open)), 'open 计数应是整数');

  const created = await run('todos_projects', { action: 'create', kind: 'project', name: '新项目' });
  assert.ok(created.message.includes('新项目'), '创建回执');
  const createdLabel = await run('todos_projects', { action: 'create', kind: 'label', name: '临时标签' });
  assert.ok(createdLabel.message.includes('临时标签'), '创建标签回执');

  const afterCreate = await run('todos_projects', { action: 'list' });
  const target = afterCreate.projects.find((p) => p.name === '新项目');
  const removed = await run('todos_projects', { action: 'delete', kind: 'project', id: target.id });
  assert.ok(removed.message.includes('删除'), '删除回执');
  const afterDelete = await run('todos_projects', { action: 'list' });
  assert.ok(!afterDelete.projects.some((p) => p.name === '新项目'), '删除后不应再出现');
});

it('缺少必填参数时给出可读回执而不是崩溃', async () => {
  const noName = await run('todos_projects', { action: 'create' });
  assert.ok(noName.message.includes('name'), '缺 name');
  const noId = await run('todos_projects', { action: 'delete' });
  assert.ok(noId.message.includes('id'), '缺 id');
});

// ------------------------------------------------ render 契约（模型看到的东西）

it('所有工具的 render 都返回非空 text 内容块', async () => {
  const samples = {
    todos_list: await run('todos_list', {}),
    todos_create: await run('todos_create', { items: [{ title: '渲染用例' }] }),
    todos_update: await run('todos_update', { updates: [] }),
    todos_complete: await run('todos_complete', { ids: [] }),
    todos_delete: await run('todos_delete', { ids: [] }),
    todos_stats: await run('todos_stats', {}),
    todos_projects: await run('todos_projects', { action: 'list' }),
  };
  for (const tool of tools) {
    const blocks = tool.output.render({}, samples[tool.name]);
    assert.ok(Array.isArray(blocks) && blocks.length > 0, `${tool.name}: render 必须返回内容块数组`);
    for (const block of blocks) {
      assert.equal(block.type, 'text', `${tool.name}: 内容块类型`);
      assert.equal(typeof block.text, 'string', `${tool.name}: text`);
      assert.ok(block.text.length > 0, `${tool.name}: text 不应为空`);
    }
  }
});

it('空结果也有可读文案（模型不会拿到空白）', async () => {
  const empty = await run('todos_list', { text: '绝不存在的关键字zzz' });
  const blocks = byName.get('todos_list').output.render({}, empty);
  assert.ok(blocks[0].text.includes('没有符合条件'), '空结果文案');
});

// ------------------------------------------------------------------ 执行

let failed = 0;
for (const item of cases) {
  try {
    await item.fn();
    console.log(`  ok   ${item.name}`);
  } catch (error) {
    failed += 1;
    console.log(` FAIL  ${item.name}\n        → ${error.message}`);
  }
}
console.log(`\n${cases.length - failed}/${cases.length} 通过`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
