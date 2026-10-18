/**
 * 待办中心 —— 冒烟测试。
 *
 * 不启动 DSH：直接驱动数据层、派生视图与**路由处理函数**（用假的 req/res），
 * 覆盖验收标准里能自动化的部分。运行：
 *
 *   node test/smoke.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createStore, localDateKey, addDays } from '../lib/store.js';
import { createAuthorize, createRoutes } from '../lib/routes.js';
import { computeStats, deriveCounts } from '../lib/select.js';

// ------------------------------------------------------------------ 测试替身

function makeReq(method, body, options = {}) {
  const host = options.host ?? '127.0.0.1:19387';
  const remote = options.remote ?? '127.0.0.1';
  const text = body === undefined ? '' : JSON.stringify(body);
  return {
    method,
    url: options.url ?? '/',
    headers: { host, ...(options.headers ?? {}) },
    socket: { remoteAddress: remote },
    async *[Symbol.asyncIterator]() {
      if (text !== '') yield Buffer.from(text, 'utf8');
    },
  };
}

function makeRes() {
  const res = {
    statusCode: 0,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    end(text) {
      this.body = text === undefined ? undefined : JSON.parse(text);
    },
  };
  return res;
}

async function call(routes, method, path, body, options) {
  const [pathname, search] = path.split('?');
  const route = routes.find((r) => r.path === pathname);
  assert.ok(route !== undefined, `路由不存在：${pathname}`);
  const res = makeRes();
  const req = makeReq(method, body, {
    ...options,
    url: search === undefined ? pathname : `${pathname}?${search}`,
  });
  await route.handler(req, res);
  return res;
}

// ---------------------------------------------------------------------- 用例

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error: error?.message ?? String(error) });
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-todos-test-'));
const store = createStore({ dir, defaults: { weekGoal: 15 } });
const routes = createRoutes(store);
const today = localDateKey();

await test('health 路由返回插件身份与数据文件路径', async () => {
  const res = await call(routes, 'GET', '/api/dsh-todos/health');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.value.plugin, 'dsh-todos');
  assert.equal(res.body.value.dataFile, path.join(dir, 'todos.json'));
});

await test('非回环来源被拒绝（403）', async () => {
  const res = await call(routes, 'GET', '/api/dsh-todos/snapshot', undefined, { remote: '10.0.0.7' });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'forbidden');
});

await test('非回环 Host 头被拒绝（403）', async () => {
  const res = await call(routes, 'GET', '/api/dsh-todos/snapshot', undefined, { host: 'evil.example.com' });
  assert.equal(res.statusCode, 403);
});

await test('cross-site 请求被拒绝（403）', async () => {
  const res = await call(routes, 'GET', '/api/dsh-todos/snapshot', undefined, {
    headers: { 'sec-fetch-site': 'cross-site' },
  });
  assert.equal(res.statusCode, 403);
});

// ---------------------------------------------- 准入委派给官方 connection（issue #1）
//
// 这些用例把 `authorize` 换成受控的假 connection，验证：
// 委托生效、401/403 如实透传、服务缺席与抛异常都回退到纯回环判定（不崩、不放行）。

function routesWithAuthorize(connection) {
  return createRoutes(store, { authorize: createAuthorize(() => connection) });
}

await test('准入：官方放行时，公网 Host 的转发请求也可以通过', async () => {
  const forwarded = routesWithAuthorize({ requestRejection: () => undefined });
  // 非回环 socket + 非回环 Host：纯回环判定会拒，官方放行则应放行。
  const res = await call(forwarded, 'GET', '/api/dsh-todos/snapshot', undefined, {
    remote: '10.0.0.7',
    host: 'deploy.example.com:3080',
  });
  assert.equal(res.statusCode, 200, '委托后应放行');
  assert.ok(res.body.value.tasks !== undefined);
});

await test('准入：官方返回 401 时透传 401 unauthorized 信封', async () => {
  const guarded = routesWithAuthorize({ requestRejection: () => 401 });
  const res = await call(guarded, 'GET', '/api/dsh-todos/snapshot');
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error.code, 'unauthorized');
});

await test('准入：官方返回 403 时透传 403 forbidden 信封', async () => {
  const guarded = routesWithAuthorize({ requestRejection: () => 403 });
  const res = await call(guarded, 'GET', '/api/dsh-todos/snapshot');
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'forbidden');
});

await test('准入：connection 服务缺席时回退纯回环判定', async () => {
  const fallback = routesWithAuthorize(undefined);
  const local = await call(fallback, 'GET', '/api/dsh-todos/snapshot');
  assert.equal(local.statusCode, 200, '本机回环仍应放行');
  const remote = await call(fallback, 'GET', '/api/dsh-todos/snapshot', undefined, { remote: '10.0.0.7' });
  assert.equal(remote.statusCode, 403, '非回环仍应拒绝');
});

await test('准入：requestRejection 抛异常时回退纯回环判定且不崩', async () => {
  const broken = routesWithAuthorize({
    requestRejection() {
      throw new Error('connection service is broken');
    },
  });
  const local = await call(broken, 'GET', '/api/dsh-todos/snapshot');
  assert.equal(local.statusCode, 200, '服务抛异常不应让面板整体不可用');
  const remote = await call(broken, 'GET', '/api/dsh-todos/snapshot', undefined, { remote: '10.0.0.7' });
  assert.equal(remote.statusCode, 403, '回退后仍须拒绝非回环');
});

await test('准入：取 connection 本身抛异常时也回退，不崩', async () => {
  const routes2 = createRoutes(store, {
    authorize: createAuthorize(() => {
      throw new Error('ctx.get exploded');
    }),
  });
  const res = await call(routes2, 'GET', '/api/dsh-todos/snapshot');
  assert.equal(res.statusCode, 200, '本机回环应放行');
});

await test('准入：放行之后方法校验与业务逻辑照常生效', async () => {
  const open = routesWithAuthorize({ requestRejection: () => undefined });
  const wrongMethod = await call(open, 'POST', '/api/dsh-todos/snapshot', {});
  assert.equal(wrongMethod.statusCode, 405, '放行不等于跳过方法校验');
  const created = await call(open, 'POST', '/api/dsh-todos/tasks/create', { title: '准入放行后仍能写入' });
  assert.equal(created.statusCode, 200);
  // 自行清理，避免影响后续依赖固定任务数的用例。
  const ids = created.body.value.created.map((t) => t.id);
  await call(routes, 'POST', '/api/dsh-todos/tasks/purge', { ids });
});

await test('准入：被拒绝的请求不会落库', async () => {
  const before = (await call(routes, 'GET', '/api/dsh-todos/snapshot')).body.value.tasks.length;
  const denied = routesWithAuthorize({ requestRejection: () => 401 });
  await call(denied, 'POST', '/api/dsh-todos/tasks/create', { title: '不该被写入的任务' });
  const after = (await call(routes, 'GET', '/api/dsh-todos/snapshot')).body.value.tasks.length;
  assert.equal(after, before, '被拒请求不应改变数据');
});

await test('准入：官方返回意料之外的值时按拒绝处理，不静默放行', async () => {
  // 官方契约是 401 | 403 | undefined。若未来语义变化，安全默认必须是拒绝。
  for (const weird of [true, 'allow', 0, null]) {
    const routes2 = routesWithAuthorize({ requestRejection: () => weird });
    const remote = await call(routes2, 'GET', '/api/dsh-todos/snapshot', undefined, { remote: '10.0.0.7' });
    assert.equal(remote.statusCode, 403, `返回值 ${JSON.stringify(weird)} 不应放行非回环请求`);
    const local = await call(routes2, 'GET', '/api/dsh-todos/snapshot');
    assert.equal(local.statusCode, 200, '回退后本机回环仍应可用');
  }
});

await test('准入：导出路由同样受委托约束', async () => {
  const guarded = routesWithAuthorize({ requestRejection: () => 401 });
  const res = await call(guarded, 'GET', '/api/dsh-todos/export/download');
  assert.equal(res.statusCode, 401, '独立围栏的导出路由也必须委托');
});

await test('方法不匹配返回 405 且带 Allow', async () => {
  const res = await call(routes, 'POST', '/api/dsh-todos/snapshot', {});
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'GET');
});

await test('非法 JSON 返回 400 invalid-json', async () => {
  const route = routes.find((r) => r.path === '/api/dsh-todos/tasks/create');
  const res = makeRes();
  const req = {
    method: 'POST',
    url: '/',
    headers: { host: '127.0.0.1:19387' },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from('{ not json', 'utf8');
    },
  };
  await route.handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.code, 'invalid-json');
});

await test('创建任务：空标题被拒，合法标题入库', async () => {
  const bad = await call(routes, 'POST', '/api/dsh-todos/tasks/create', { title: '   ' });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.body.error.code, 'invalid-task');

  const good = await call(routes, 'POST', '/api/dsh-todos/tasks/create', {
    title: '交季度报告',
    dueDate: today,
    priority: 'p1',
  });
  assert.equal(good.statusCode, 200);
  assert.equal(good.body.value.created.length, 1);
  assert.equal(good.body.value.created[0].title, '交季度报告');
  assert.equal(good.body.value.created[0].priority, 'p1');
});

await test('批量创建 + 快照计数正确', async () => {
  const res = await call(routes, 'POST', '/api/dsh-todos/tasks/create', {
    items: [
      { title: '预约体检' },
      { title: '整理会议纪要', dueDate: addDays(today, 3), priority: 'p2' },
    ],
  });
  assert.equal(res.body.value.created.length, 2);

  const snap = await call(routes, 'GET', '/api/dsh-todos/snapshot');
  assert.equal(snap.body.value.tasks.length, 3);
  assert.equal(snap.body.value.counts.active, 3);
  assert.equal(snap.body.value.counts.inbox, 1);
  assert.equal(snap.body.value.counts.today, 1);
  assert.equal(snap.body.value.counts.upcoming, 1);
});

await test('非法优先级/日期被规范化而不是报错', async () => {
  const res = await call(routes, 'POST', '/api/dsh-todos/tasks/create', {
    title: '边界用例',
    priority: 'P9',
    dueDate: '2026-02-30',
    dueTime: '25:99',
  });
  const task = res.body.value.created[0];
  assert.equal(task.priority, 'p4');
  assert.equal(task.dueDate, null);
  assert.equal(task.dueTime, null);
});

await test('完成 / 取消完成', async () => {
  const snap = await call(routes, 'GET', '/api/dsh-todos/snapshot');
  const target = snap.body.value.tasks.find((t) => t.title === '交季度报告');
  const done = await call(routes, 'POST', '/api/dsh-todos/tasks/complete', { ids: [target.id] });
  assert.equal(done.body.value.touched.length, 1);
  assert.equal(done.body.value.touched[0].completed, true);
  assert.ok(done.body.value.touched[0].completedAt !== null);

  const undo = await call(routes, 'POST', '/api/dsh-todos/tasks/complete', { ids: [target.id], completed: false });
  assert.equal(undo.body.value.touched[0].completed, false);
  assert.equal(undo.body.value.touched[0].completedAt, null);
});

await test('重复任务：完成后按规则补出下一次', async () => {
  const created = await call(routes, 'POST', '/api/dsh-todos/tasks/create', {
    title: '每周复盘',
    dueDate: today,
    repeat: { freq: 'weekly', interval: 1, weekdays: [5] },
  });
  const id = created.body.value.created[0].id;
  const done = await call(routes, 'POST', '/api/dsh-todos/tasks/complete', { ids: [id] });
  assert.equal(done.body.value.spawned.length, 1, '完成重复任务应补出下一次');
  const next = done.body.value.spawned[0];
  assert.equal(next.completed, false);
  assert.ok(next.dueDate > today, `下一次到期日应在今天之后，实际 ${next.dueDate}`);
  assert.equal(new Date(`${next.dueDate}T00:00:00`).getDay(), 5, '应落在周五');
});

await test('软删除进回收站，可恢复、可彻底删除', async () => {
  const snap = await call(routes, 'GET', '/api/dsh-todos/snapshot');
  const target = snap.body.value.tasks.find((t) => t.title === '预约体检');
  await call(routes, 'POST', '/api/dsh-todos/tasks/delete', { ids: [target.id] });

  const afterDelete = await call(routes, 'GET', '/api/dsh-todos/snapshot');
  assert.equal(afterDelete.body.value.counts.trash, 1);
  assert.ok(afterDelete.body.value.tasks.find((t) => t.id === target.id).deletedAt !== null);

  await call(routes, 'POST', '/api/dsh-todos/tasks/restore', { ids: [target.id] });
  const afterRestore = await call(routes, 'GET', '/api/dsh-todos/snapshot');
  assert.equal(afterRestore.body.value.counts.trash, 0);

  await call(routes, 'POST', '/api/dsh-todos/tasks/delete', { ids: [target.id] });
  const purged = await call(routes, 'POST', '/api/dsh-todos/tasks/purge', { ids: [target.id] });
  assert.equal(purged.body.value.removed, 1);
  const final = await call(routes, 'GET', '/api/dsh-todos/snapshot');
  assert.equal(final.body.value.tasks.find((t) => t.id === target.id), undefined);
});

await test('项目：保存、任务关联、删除后任务回收件箱', async () => {
  const project = await call(routes, 'POST', '/api/dsh-todos/projects/save', { name: 'Q4汇报' });
  const projectId = project.body.value.project.id;

  const task = await call(routes, 'POST', '/api/dsh-todos/tasks/create', {
    title: '写汇报提纲',
    projectId,
  });
  const taskId = task.body.value.created[0].id;

  await call(routes, 'POST', '/api/dsh-todos/projects/delete', { id: projectId });
  const snap = await call(routes, 'GET', '/api/dsh-todos/snapshot');
  assert.equal(snap.body.value.projects.length, 0);
  // 删项目不连带删任务，任务回到收件箱。
  assert.equal(snap.body.value.tasks.find((t) => t.id === taskId).projectId, null);
});

await test('标签：保存与关联；删除标签会从任务上摘掉', async () => {
  const label = await call(routes, 'POST', '/api/dsh-todos/labels/save', { name: '写作' });
  const labelId = label.body.value.label.id;
  const task = await call(routes, 'POST', '/api/dsh-todos/tasks/create', {
    title: '写一段说明',
    labelIds: [labelId],
  });
  assert.deepEqual(task.body.value.created[0].labelIds, [labelId]);

  await call(routes, 'POST', '/api/dsh-todos/labels/delete', { id: labelId });
  const snap = await call(routes, 'GET', '/api/dsh-todos/snapshot');
  assert.deepEqual(snap.body.value.labels, []);
  assert.deepEqual(snap.body.value.tasks.find((t) => t.title === '写一段说明').labelIds, []);
});

await test('无法识别的父任务引用被自动清掉', async () => {
  const task = await call(routes, 'POST', '/api/dsh-todos/tasks/create', {
    title: '孤儿任务',
    parentId: 'nonexistent-id',
  });
  // createTask 不做引用校验（父任务可能后到），但重新加载时 repair 会清掉。
  assert.ok(task.body.value.created[0].id);
  const store2 = createStore({ dir });
  assert.equal(store2.snapshot().tasks.find((t) => t.title === '孤儿任务').parentId, null);
});

await test('设置更新与规范化', async () => {
  const res = await call(routes, 'POST', '/api/dsh-todos/settings/update', { weekGoal: 999, remindEnabled: false });
  assert.equal(res.body.value.weekGoal, 999);
  assert.equal(res.body.value.remindEnabled, false);
  const bad = await call(routes, 'POST', '/api/dsh-todos/settings/update', { digestTime: '99:99' });
  assert.equal(bad.body.value.digestTime, '09:00');
});

await test('统计：KPI/趋势/热力图/分布口径自洽', async () => {
  const res = await call(routes, 'GET', '/api/dsh-todos/stats?range=last30');
  const stats = res.body.value;
  assert.equal(res.statusCode, 200);
  assert.equal(stats.trend.length, 14);
  assert.equal(stats.heatmap.length, 90);
  assert.ok(stats.kpi.completionRate >= 0 && stats.kpi.completionRate <= 100);
  assert.ok(Number.isInteger(stats.kpi.streak));
  assert.ok(Array.isArray(stats.breakdown.projects));
  assert.ok(Array.isArray(stats.breakdown.labels));
  assert.equal(Object.keys(stats.priority).sort().join(','), 'p1,p2,p3,p4');
  assert.equal(stats.weekdayOverdue.length, 7);
  // 趋势最后一天必须是今天。
  assert.equal(stats.trend[13].date, today);
  assert.equal(stats.heatmap[89].date, today);
});

await test('统计与列表口径一致：完成后计数增加', async () => {
  const before = (await call(routes, 'GET', '/api/dsh-todos/stats?range=last30')).body.value.kpi.completed;
  const snap = await call(routes, 'GET', '/api/dsh-todos/snapshot');
  const open = snap.body.value.tasks.filter((t) => !t.completed && t.deletedAt === null);
  await call(routes, 'POST', '/api/dsh-todos/tasks/complete', { ids: [open[0].id] });
  const after = (await call(routes, 'GET', '/api/dsh-todos/stats?range=last30')).body.value.kpi.completed;
  assert.equal(after, before + 1);
});

await test('自然语言快速添加：解析且 #项目/@标签 按需新建', async () => {
  const parsed = await call(routes, 'POST', '/api/dsh-todos/tasks/parse', {
    input: `明天下午3点 交季度报告 #新项目 @新标签 p1`,
  });
  assert.equal(parsed.statusCode, 200, 'parse 状态码');
  assert.equal(parsed.body.value.title, '交季度报告');
  assert.equal(parsed.body.value.dueTime, '15:00');
  assert.equal(parsed.body.value.priority, 'p1');

  const created = await call(routes, 'POST', '/api/dsh-todos/tasks/quick-add', {
    input: `明天下午3点 交季度报告 #新项目 @新标签 p1`,
  });
  assert.equal(created.statusCode, 200, 'quick-add 状态码');
  const result = created.body.value.results[0];
  assert.equal(result.task.title, '交季度报告');
  assert.deepEqual(result.created.projects, ['新项目']);
  assert.deepEqual(result.created.labels, ['新标签']);
  assert.ok(result.task.projectId !== null, '项目应已落库');
  assert.equal(result.task.labelIds.length, 1, '标签应已落库');

  const snap = await call(routes, 'GET', '/api/dsh-todos/snapshot');
  assert.ok(snap.body.value.projects.some((p) => p.name === '新项目'));
  assert.ok(snap.body.value.labels.some((l) => l.name === '新标签'));
});

await test('快速添加空输入被拒', async () => {
  const res = await call(routes, 'POST', '/api/dsh-todos/tasks/quick-add', { input: '   ' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.code, 'invalid-task');
});

await test('到点提醒：逾期与今天已到点的任务会被列出，未来任务不会', async () => {
  // 前面的「设置更新与规范化」用例把 remindEnabled 关掉了，这里先显式打开，
  // 避免用例之间靠执行顺序隐式传递状态。
  await call(routes, 'POST', '/api/dsh-todos/settings/update', { remindEnabled: true });

  const overdue = await call(routes, 'POST', '/api/dsh-todos/tasks/create', {
    title: '昨天就该做的事',
    dueDate: addDays(localDateKey(), -1),
  });
  assert.equal(overdue.statusCode, 200);

  await call(routes, 'POST', '/api/dsh-todos/tasks/create', {
    title: '很久以后的事',
    dueDate: addDays(localDateKey(), 30),
  });

  const due = await call(routes, 'GET', '/api/dsh-todos/due');
  assert.equal(due.statusCode, 200);
  const titles = due.body.value.items.map((t) => t.title);
  assert.ok(titles.includes('昨天就该做的事'), '逾期任务应被提醒');
  assert.ok(!titles.includes('很久以后的事'), '未来任务不应被提醒');
  const first = due.body.value.items.find((t) => t.title === '昨天就该做的事');
  assert.equal(first.overdue, true);
  assert.equal(first.overdueDays, 1);

  // 关掉「到期提醒」后必须一条都不返回 —— 否则这个开关等于装饰（issue #2）。
  await call(routes, 'POST', '/api/dsh-todos/settings/update', { remindEnabled: false });
  const off = await call(routes, 'GET', '/api/dsh-todos/due');
  assert.equal(off.statusCode, 200);
  assert.equal(off.body.value.items.length, 0, 'remindEnabled=false 时不应返回任何提醒');
  await call(routes, 'POST', '/api/dsh-todos/settings/update', { remindEnabled: true });

  // 完成之后不再提醒
  const snap = await call(routes, 'GET', '/api/dsh-todos/snapshot');
  const target = snap.body.value.tasks.find((t) => t.title === '昨天就该做的事');
  await call(routes, 'POST', '/api/dsh-todos/tasks/complete', { ids: [target.id] });
  const after = await call(routes, 'GET', '/api/dsh-todos/due');
  assert.ok(!after.body.value.items.some((t) => t.title === '昨天就该做的事'), '完成后不应再提醒');
});

await test('导出 / 导入（replace 与 merge）', async () => {
  const exported = (await call(routes, 'GET', '/api/dsh-todos/export')).body.value;
  assert.ok(Array.isArray(exported.data.tasks));

  const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-todos-test2-'));
  const otherStore = createStore({ dir: otherDir });
  otherStore.importState(exported, 'replace');
  assert.equal(otherStore.snapshot().tasks.length, exported.data.tasks.length);
  assert.deepEqual(otherStore.snapshot().projects, exported.data.projects);

  const before = otherStore.snapshot().tasks.length;
  otherStore.importState(exported, 'merge');
  assert.equal(otherStore.snapshot().tasks.length, before, 'merge 不应重复插入同 id 任务');
});

await test('损坏的数据文件被备份后重开，不静默丢数据', async () => {
  const brokenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-todos-broken-'));
  fs.writeFileSync(path.join(brokenDir, 'todos.json'), '{ 这不是 JSON', 'utf8');
  const brokenStore = createStore({ dir: brokenDir });
  assert.equal(brokenStore.snapshot().tasks.length, 0);
  const backups = fs.readdirSync(brokenDir).filter((f) => f.startsWith('todos.corrupt-'));
  assert.equal(backups.length, 1, '应留下现场备份');
});

await test('落盘可读：写出的文件是合法 JSON 且能被新实例加载', async () => {
  store.save();
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'todos.json'), 'utf8'));
  assert.equal(raw.schemaVersion, 1);
  assert.ok(Array.isArray(raw.tasks));
  const reloaded = createStore({ dir });
  assert.equal(reloaded.snapshot().tasks.length, raw.tasks.length);
});

await test('派生计数与列表一致（交叉校验）', async () => {
  const snap = store.snapshot();
  const counts = deriveCounts(snap, today);
  const open = snap.tasks.filter((t) => t.deletedAt === null && !t.completed);
  assert.equal(counts.active, open.length);
  const manualToday = open.filter((t) => t.dueDate !== null && t.dueDate <= today).length;
  assert.equal(counts.today, manualToday);
  const stats = computeStats(snap, 'last30', today);
  assert.equal(stats.kpi.active, open.length);
});

// ---------------------------------------------------------------------- 报告

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}${r.ok ? '' : `\n        → ${r.error}`}`);
}
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed.length === 0 ? 0 : 1);
