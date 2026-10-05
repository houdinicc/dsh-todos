/**
 * 待办中心 —— 客户端半的离线渲染测试。
 *
 * 客户端 bundle 是 `window.__ModuleLoader__.load({ id, factory })` 形式的
 * 自注册脚本，浏览器之外跑不了。这里用 jsdom + 真实 React 18 复现宿主环境：
 *
 *   1. 装好 window.__ModuleLoader__ 与 DOM；
 *   2. import 客户端 bundle，捕获它登记的定义；
 *   3. 用假 ctx 调 apply()，检查它往哪些 slot 注册了什么；
 *   4. 用假 fetch 喂快照，真实渲染、真实点击，断言 DOM 与发出的请求。
 *
 * 这样「面板点开是空白 / 一按就崩」这类问题能在本地抓到，不必靠目视。
 *
 * 依赖（仅开发期，装在插件包之外的 `../dsh-todos-dev/`）：
 *   react / react-dom / jsdom
 *
 * 运行：node test/client-render.mjs
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(here, '..');
const devtools = process.env.DSH_TODOS_DEVTOOLS ?? path.resolve(pluginDir, '..', 'dsh-todos-dev');

if (!fs.existsSync(path.join(devtools, 'node_modules', 'react'))) {
  console.error(`找不到开发依赖目录：${devtools}\n请先在其下安装 react/react-dom/jsdom。`);
  process.exit(2);
}

const devRequire = createRequire(path.join(devtools, 'package.json'));
const { JSDOM } = devRequire('jsdom');

// ------------------------------------------------------------- 1. 宿主环境

const dom = new JSDOM(
  '<!doctype html><html><head></head><body><div id="root"></div><div id="overlay"></div></body></html>',
  { url: 'http://127.0.0.1:19387/', pretendToBeVisual: true },
);
globalThis.window = dom.window;
globalThis.document = dom.window.document;
// Node 24 的 globalThis.navigator 只有 getter，用 defineProperty 覆盖。
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Event = dom.window.Event;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.FileReader = dom.window.FileReader;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const registered = [];
dom.window.__ModuleLoader__ = { load: (definition) => registered.push(definition) };

// ------------------------------------------------------------ 2. 载入 bundle

const React = devRequire('react');
const ReactDOMClient = devRequire('react-dom/client');
const { act } = React;
const h = React.createElement;

await import(path.join(pluginDir, 'lib', 'client.js'));

assert.equal(registered.length, 1, '客户端 bundle 应恰好登记一个模块定义');
const definition = registered[0];
assert.equal(definition.id, 'dsh-todos', '模块 id 必须等于包名');
assert.equal(typeof definition.factory, 'function', 'factory 必须是函数');

// ------------------------------------------------------- 3. 收集 slot 注册

const dictionaries = new Map();
const slotRegistrations = [];
const effects = [];
const warns = [];

const fakeCtx = {
  logger: { warn: (m) => warns.push(String(m)) },
  effect(fn, label) {
    effects.push({ label, dispose: fn() });
    return () => {};
  },
  locale: {
    register(namespace, dicts) {
      dictionaries.set(namespace, dicts);
      return () => {};
    },
    bind(namespace) {
      return (key, params) => {
        const dicts = dictionaries.get(namespace) ?? {};
        const template = dicts.zh?.[key] ?? dicts.en?.[key] ?? key;
        if (params === undefined) return template;
        return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`));
      };
    },
  },
  slots: {
    inject(owner, callback) {
      callback();
      return () => {};
    },
    register(options, Component) {
      slotRegistrations.push({ options, Component });
      return () => {};
    },
  },
};

const moduleExports = definition.factory((specifier) => {
  if (specifier === 'react') return React;
  if (specifier === 'react/jsx-runtime') return devRequire('react/jsx-runtime');
  throw new Error(`客户端 bundle 不应 require ${specifier}`);
});

assert.deepEqual(moduleExports.inject, ['slots', 'locale'], '客户端服务依赖应只有 slots / locale');
assert.equal(typeof moduleExports.apply, 'function');
moduleExports.apply(fakeCtx);

// ------------------------------------------------------------ 4. 断言装配

const bySlot = new Map(slotRegistrations.map((r) => [r.options.name, r]));
const panellist = bySlot.get('sidebar.panellist');
const main = bySlot.get('main');
const overlay = bySlot.get('shell.overlay');

assert.ok(panellist !== undefined, '应注册到 sidebar.panellist');
assert.ok(main !== undefined, '应注册到 main');
assert.ok(overlay !== undefined, '应注册到 shell.overlay（到点提醒的全局浮层）');
assert.equal(panellist.options.id, 'todos', '侧边栏条目 id 必须是 todos');
assert.equal(main.options.key, 'todos', 'main 的 key 必须与侧边栏 id 相同，否则点击会抛错');
assert.equal(panellist.options.order, 30);
assert.equal(typeof panellist.options.label, 'function', 'label 应为函数，以便跟随语言切换');
assert.equal(panellist.options.label(), '待办');
assert.equal(main.options.locale, 'todos');
assert.equal(overlay.options.id, 'todos-reminder');
assert.equal(typeof overlay.Component, 'function');
assert.equal(typeof panellist.Component, 'function', '侧边栏应提供字形组件');
assert.equal(typeof main.Component, 'function', 'main 应提供面板组件');

const styleTag = document.querySelector('style[data-plugin-css="dsh-todos"]');
assert.ok(styleTag !== null, '应注入带 data-plugin-css 的样式标签');
assert.ok(styleTag.textContent.includes('--dsw-alias-'), '样式必须走主题 token');
assert.ok(!styleTag.textContent.includes('#'), '样式里不应出现字面色值（除非是 artwork）');

// **回归护栏**：DSH 的主题包只“声明” token，真实定义在 shell 的样式表里，
// 两者并不一致（主题包声明 400+ 个，shell 只定义 95 个）。引用一个不存在的
// token 不会报错，只会让那条声明失效并回退继承——「添加」按钮曾经就是这样
// 变成浅底浅字、完全看不见。这里把客户端半里所有 `var(--dsw-*)` 引用逐个比对
// 真实名单，引用不存在的 token 直接让测试失败。
const themeFixture = JSON.parse(fs.readFileSync(path.join(pluginDir, 'test', 'theme-tokens.json'), 'utf8'));
const knownTokens = new Set(themeFixture.tokens);
const clientSource = fs.readFileSync(path.join(pluginDir, 'lib', 'client.js'), 'utf8');
const referencedTokens = [...new Set([...clientSource.matchAll(/var\((--dsw-[a-z0-9-]+)/g)].map((m) => m[1]))].sort();
const unknownTokens = referencedTokens.filter((token) => !knownTokens.has(token));
const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

check(
  `引用的 ${referencedTokens.length} 个 --dsw-* token 全部真实存在（不存在会让声明静默失效）`,
  unknownTokens.length === 0,
);
if (unknownTokens.length > 0) console.error('  引用但不存在的 token：', unknownTokens.join(', '));

// ------------------------------------------------- 5. 假 fetch / 假数据
const TODAY = '2026-10-04';

function consecutiveDays(count) {
  const [y, m, d] = TODAY.split('-').map(Number);
  const out = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const dt = new Date(y, m - 1, d - i);
    out.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`);
  }
  return out;
}
const TREND_DAYS = consecutiveDays(14);
const HEATMAP_DAYS = consecutiveDays(90);

const task = (over) => ({
  id: 't',
  title: '任务',
  note: '',
  projectId: null,
  labelIds: [],
  priority: 'p4',
  dueDate: null,
  dueTime: null,
  parentId: null,
  repeat: null,
  order: 0,
  completed: false,
  completedAt: null,
  createdAt: `${TODAY}T00:00:00.000Z`,
  updatedAt: `${TODAY}T00:00:00.000Z`,
  deletedAt: null,
  ...over,
});

const FIXTURE = {
  today: TODAY,
  serverTime: `${TODAY}T01:00:00.000Z`,
  dataFile: '/tmp/todos.json',
  settings: { weekGoal: 15, remindEnabled: true, dailyDigest: false, digestTime: '09:00', defaultRemindLead: 0, weekStartsOn: 0 },
  projects: [{ id: 'p1', name: 'Q4汇报', color: null, order: 0, archived: false, createdAt: TODAY }],
  labels: [{ id: 'l1', name: '写作', color: null, order: 0, createdAt: TODAY }],
  tasks: [
    task({
      id: 't1',
      title: '交季度报告',
      note: '附上三季度数据',
      projectId: 'p1',
      labelIds: ['l1'],
      priority: 'p1',
      dueDate: TODAY,
      dueTime: '15:00',
      order: 0,
    }),
    task({ id: 't2', title: '预约体检', order: 1 }),
    task({ id: 't3', title: '整理素材', parentId: 't2', order: 2 }),
    task({ id: 't4', title: '已完成的旧事', completed: true, completedAt: `${TODAY}T02:00:00.000Z`, order: 3 }),
  ],
  counts: { today: 1, overdue: 0, upcoming: 0, inbox: 2, done: 1, trash: 0, active: 3, byProject: { p1: 1 }, byLabel: { l1: 1 } },
  stats: {
    range: { key: 'last30', from: '2026-09-05', to: TODAY },
    kpi: { dueToday: 1, overdue: 1, completed: 4, created: 6, completionRate: 40, streak: 3, active: 3, prevCompleted: 2, deltaCompleted: 2 },
    trend: TREND_DAYS.map((date, i) => ({ date, completed: i % 3, created: i % 2 })),
    heatmap: HEATMAP_DAYS.map((date, i) => ({ date, count: i % 4 })),
    priority: { p1: 1, p2: 0, p3: 0, p4: 2 },
    breakdown: {
      projects: [{ id: 'p1', name: 'Q4汇报', count: 1 }, { id: '__inbox__', name: '收件箱', count: 2 }],
      labels: [{ id: 'l1', name: '写作', count: 1 }],
    },
    weekdayOverdue: [0, 1, 0, 0, 0, 0, 0],
  },
};

const DUE = {
  today: TODAY,
  now: `${TODAY}T07:00:00.000Z`,
  items: [
    { ...task({ id: 't1', title: '交季度报告', dueDate: TODAY, dueTime: '15:00' }), project: 'Q4汇报', labels: ['写作'], priority: 'p1', overdue: false, overdueDays: 0 },
  ],
};

const fetchCalls = [];
const payload = (value) => ({ ok: true, status: 200, json: async () => ({ ok: true, value }) });

globalThis.fetch = async (url, init) => {
  const target = String(url);
  const method = init?.method ?? 'GET';
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
  fetchCalls.push({ url: target, method, body });
  assert.ok(!target.startsWith('/'), `必须用文档相对路径，实际是 ${target}`);

  if (target.includes('/snapshot')) return payload(FIXTURE);
  if (target.includes('/due')) return payload(DUE);
  if (target.includes('/tasks/parse')) {
    return payload({
      title: '交报告',
      dueDate: '2026-10-05',
      dueTime: '15:00',
      priority: 'p1',
      repeat: null,
      projectId: 'p1',
      projectName: 'Q4汇报',
      labelIds: ['l1'],
      labelNames: [],
      matched: ['明天', '下午3点', '#Q4汇报', '@写作', 'p1'],
    });
  }
  if (target.includes('/stats')) return payload(FIXTURE.stats);
  return payload({});
};

// ------------------------------------------------- 6. 渲染面板并断言

const t = fakeCtx.locale.bind('todos');
const root = ReactDOMClient.createRoot(document.getElementById('root'));

const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

await act(async () => {
  root.render(h(main.Component, { t }));
});
await settle();

const html = () => document.getElementById('root').innerHTML;
const buttons = () => [...document.querySelectorAll('button.dsht-navrow')];
const findButton = (text) => buttons().find((b) => b.textContent.includes(text));
const click = async (element) => {
  await act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  });
  await settle();
};


check('渲染出当前视图名「今天」', html().includes('今天'));
check('渲染出今日任务标题', html().includes('交季度报告'));
check('今日视图不含无日期任务（口径正确）', !html().includes('预约体检'));
check('渲染出备注', html().includes('附上三季度数据'));
check('渲染出项目名', html().includes('Q4汇报'));
check('渲染出标签', html().includes('@写作'));
check('渲染出到期时间', html().includes('今天 15:00'));
check('无渲染期崩溃日志', warns.length === 0);
check('确实调用了宿主快照路由', fetchCalls.some((c) => c.url.includes('/snapshot')));

// 收件箱：无日期任务 + 子任务缩进
const inboxButton = findButton('收件箱');
check('存在「收件箱」导航项', inboxButton !== undefined);
if (inboxButton !== undefined) {
  await click(inboxButton);
  check('收件箱视图渲染出无日期任务', html().includes('预约体检'));
  check('收件箱视图不含今日任务', !html().includes('交季度报告'));
  check('子任务挂在其父任务下并显示进度', html().includes('整理素材') && /子任务\s*0\/1/.test(html()));
}

// 搜索
const searchInput = document.querySelector('input.dsht-search');
check('存在搜索框', searchInput !== null);
if (searchInput !== null) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
    setter.call(searchInput, '季度报告');
    searchInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  await settle();
  check('搜索命中标题', html().includes('交季度报告'));
  check('搜索排除未命中的任务', !html().includes('预约体检'));
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
    setter.call(searchInput, '');
    searchInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  await settle();
}

// 勾选完成：应发出 complete 请求
const before = fetchCalls.length;
const checkbox = document.querySelector('button.dsht-check');
check('存在完成勾选框', checkbox !== null);
if (checkbox !== null) {
  await click(checkbox);
  const call = fetchCalls.slice(before).find((c) => c.url.includes('/tasks/complete'));
  check('勾选会调用宿主完成路由', call !== undefined);
  check('完成请求带上了任务 id 与 completed=true', call !== undefined && Array.isArray(call.body?.ids) && call.body.completed === true);
}

// 快速添加：带预览
const quickInput = document.querySelector('input.dsht-input:not(.dsht-search)');
check('存在快速添加输入框', quickInput !== null);
if (quickInput !== null) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
    setter.call(quickInput, '明天下午3点 交报告 #Q4汇报 @写作 p1');
    quickInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 320));
  });
  await settle();
  check('快速添加会请求解析预览', fetchCalls.some((c) => c.url.includes('/tasks/parse')));
  check('预览显示出识别到的字段', html().includes('已识别') && html().includes('#Q4汇报') && html().includes('2026-10-05'));
}

// 仪表盘
const dashButton = findButton('仪表盘');
check('存在「仪表盘」导航项', dashButton !== undefined);
if (dashButton !== undefined) {
  await click(dashButton);
  const dash = html();
  check('仪表盘渲染出 KPI「今日待办」', dash.includes('今日待办'));
  check('仪表盘渲染出「逾期」', dash.includes('逾期'));
  check('仪表盘渲染出「连续完成」', dash.includes('连续完成'));
  check('仪表盘渲染出趋势图标题', dash.includes('完成 vs 新增'));
  check('仪表盘渲染出热力图标题', dash.includes('完成热力图'));
  check('仪表盘渲染出标签分布', dash.includes('标签分布'));
  check('仪表盘渲染出星期分布', dash.includes('逾期集中在星期几'));
  check('仪表盘渲染出每周目标', dash.includes('每周完成目标'));
  check('仪表盘渲染出范围切换', dash.includes('近 30 天'));
  check('仪表盘渲染出洞察列表', dash.includes('本周洞察'));
  check('洞察里出现了逾期洞察', dash.includes('逾期'));
}

// 设置
const settingsButton = findButton('设置');
check('存在「设置」导航项', settingsButton !== undefined);
if (settingsButton !== undefined) {
  await click(settingsButton);
  const settings = html();
  check('设置页渲染出每周目标', settings.includes('每周完成目标'));
  check('设置页渲染出提醒开关', settings.includes('到期提醒') && settings.includes('role="switch"'));
  check('设置页渲染出导出链接', settings.includes('/export/download') && settings.includes('/export/markdown'));
  check('设置页渲染出导入控件', settings.includes('导入 JSON'));
  check('设置页显示数据文件路径', settings.includes('/tmp/todos.json'));
}

// 回收站空态
const trashButton = findButton('回收站');
if (trashButton !== undefined) {
  await click(trashButton);
  check('空回收站显示空态而非崩溃', html().includes('回收站'));
}

await act(async () => {
  root.unmount();
});

// ---------------------------------------------- 7. 到点提醒浮层

const overlayRoot = ReactDOMClient.createRoot(document.getElementById('overlay'));
await act(async () => {
  overlayRoot.render(h(overlay.Component, { t }));
});
await settle();

const overlayHtml = document.getElementById('overlay').innerHTML;
check('浮层渲染出提醒标题', overlayHtml.includes('待办提醒'));
check('浮层渲染出到点任务标题', overlayHtml.includes('交季度报告'));
check('浮层渲染出「完成」按钮', overlayHtml.includes('完成'));
check('浮层渲染出「推迟到明天」按钮', overlayHtml.includes('推迟到明天'));

const beforeSnooze = fetchCalls.length;
const snooze = [...document.querySelectorAll('#overlay button')].find((b) => b.textContent.includes('推迟到明天'));
check('浮层存在推迟按钮元素', snooze !== undefined);
if (snooze !== undefined) {
  await click(snooze);
  const call = fetchCalls.slice(beforeSnooze).find((c) => c.url.includes('/tasks/update'));
  check('推迟会把到期日推到下一天', call !== undefined && call.body?.updates?.[0]?.dueDate === '2026-10-05');
  check('推迟后提醒消失', !document.getElementById('overlay').innerHTML.includes('交季度报告'));
}

await act(async () => {
  overlayRoot.unmount();
});
for (const effect of effects) {
  if (typeof effect.dispose === 'function') effect.dispose();
}

// ---------------------------------------------------------------- 报告

let failed = 0;
for (const item of checks) {
  if (!item.ok) failed += 1;
  console.log(`${item.ok ? '  ok  ' : ' FAIL '} ${item.name}`);
}
console.log(`\n${checks.length - failed}/${checks.length} 通过`);
if (warns.length > 0) console.log('警告：', warns);
process.exit(failed === 0 ? 0 : 1);
