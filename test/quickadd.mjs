/**
 * 待办中心 —— 自然语言快速添加解析器的测试。
 *
 * 参考日固定为 2026-10-05（周一），这样星期推算的期望值可以硬写。
 *
 * 运行：node test/quickadd.mjs
 */

import assert from 'node:assert/strict';
import { parseQuickAdd } from '../lib/quickadd.js';

const TODAY = '2026-10-05'; // 周一

const PROJECTS = [
  { id: 'proj-q4', name: 'Q4汇报' },
  { id: 'proj-life', name: '个人' },
];
const LABELS = [
  { id: 'lbl-write', name: '写作' },
  { id: 'lbl-call', name: '电话' },
];

const parse = (input) => parseQuickAdd(input, { today: TODAY, projects: PROJECTS, labels: LABELS });

const cases = [];
function it(name, fn) {
  cases.push({ name, fn });
}
function eq(actual, expected, what) {
  assert.deepEqual(actual, expected, `${what}：期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}

// ------------------------------------------------------- PRD 的验收例句

it('PRD 验收句：明天下午3点 交季度报告 #Q4汇报 @写作 p1', () => {
  const r = parse('明天下午3点 交季度报告 #Q4汇报 @写作 p1');
  eq(r.title, '交季度报告', 'title');
  eq(r.dueDate, '2026-10-06', 'dueDate');
  eq(r.dueTime, '15:00', 'dueTime');
  eq(r.priority, 'p1', 'priority');
  eq(r.projectId, 'proj-q4', 'projectId');
  eq(r.labelIds, ['lbl-write'], 'labelIds');
  eq(r.repeat, null, 'repeat');
});

it('同一句不带空格也要能解析（中文常见写法）', () => {
  const r = parse('明天下午3点交季度报告#Q4汇报 p1');
  eq(r.title, '交季度报告', 'title');
  eq(r.dueDate, '2026-10-06', 'dueDate');
  eq(r.dueTime, '15:00', 'dueTime');
  eq(r.priority, 'p1', 'priority');
  eq(r.projectId, 'proj-q4', 'projectId');
});

// ---------------------------------------------------------------- 日期

it('相对日：今天 / 明天 / 后天 / 昨天', () => {
  eq(parse('今天 写周报').dueDate, '2026-10-05', '今天');
  eq(parse('明天 写周报').dueDate, '2026-10-06', '明天');
  eq(parse('后天 写周报').dueDate, '2026-10-07', '后天');
  eq(parse('昨天 写周报').dueDate, '2026-10-04', '昨天');
  eq(parse('3天后 写周报').dueDate, '2026-10-08', '3天后');
});

it('星期：周三 / 下周三 / 本周五 / 周一', () => {
  eq(parse('周三 开会').dueDate, '2026-10-07', '周三（最近的周三）');
  eq(parse('下周三 开会').dueDate, '2026-10-14', '下周三');
  eq(parse('本周五 开会').dueDate, '2026-10-09', '本周五');
  eq(parse('周一 开会').dueDate, '2026-10-12', '周一（下周一，因为今天就是周一）');
  eq(parse('星期日 开会').dueDate, '2026-10-11', '星期日');
});

it('绝对日期：N月N日 / N/N / 月底 / 下月底 / 下个月N号', () => {
  eq(parse('11月20日 交材料').dueDate, '2026-11-20', '11月20日');
  eq(parse('11/20 交材料').dueDate, '2026-11-20', '11/20');
  eq(parse('月底 对账').dueDate, '2026-10-31', '月底');
  eq(parse('下月底 对账').dueDate, '2026-11-30', '下月底');
  eq(parse('下个月3号 交材料').dueDate, '2026-11-03', '下个月3号');
});

it('已过去很久的月日会滚到明年（不产生「过去」的默认日期）', () => {
  eq(parse('3月5日 交材料').dueDate, '2027-03-05', '3月5日');
});

it('非法月日不会造出崩溃日期', () => {
  // 11月31日：未来月份，只做夹取。
  eq(parse('11月31日 交材料').dueDate, '2026-11-30', '11月31日 → 夹到当月最后一天');
  // 2月30日：既夹取也因已过去而滚到明年。
  eq(parse('2月30日 交材料').dueDate, '2027-02-28', '2月30日 → 夹到 2 月末');
});

it('英文日期：today / tomorrow / next monday / in 3 days', () => {
  eq(parse('today write report').dueDate, '2026-10-05', 'today');
  eq(parse('tomorrow write report').dueDate, '2026-10-06', 'tomorrow');
  eq(parse('next monday write report').dueDate, '2026-10-12', 'next monday');
  eq(parse('in 3 days write report').dueDate, '2026-10-08', 'in 3 days');
});

// ---------------------------------------------------------------- 时间

it('中文时间：下午3点 / 晚上8点半 / 早上9点 / 中午', () => {
  eq(parse('下午3点 开会').dueTime, '15:00', '下午3点');
  eq(parse('晚上8点半 打电话').dueTime, '20:30', '晚上8点半');
  eq(parse('早上9点 站会').dueTime, '09:00', '早上9点');
  eq(parse('下午3点15分 开会').dueTime, '15:15', '下午3点15分');
  eq(parse('中午 吃饭').dueTime, '12:00', '中午');
  eq(parse('凌晨1点 部署').dueTime, '01:00', '凌晨1点');
});

it('数字时间：15:00 与英文 3pm', () => {
  eq(parse('15:00 开会').dueTime, '15:00', '15:00');
  eq(parse('at 3pm write report').dueTime, '15:00', 'at 3pm');
  eq(parse('at 9:30am standup').dueTime, '09:30', 'at 9:30am');
});

it('只给时间不给日期时，按今天算', () => {
  const r = parse('下午3点 交报告');
  eq(r.dueDate, TODAY, 'dueDate 应为今天');
  eq(r.dueTime, '15:00', 'dueTime');
});

it('给了日期不给时间时，dueTime 保持为空（全天任务）', () => {
  const r = parse('明天 交报告');
  eq(r.dueDate, '2026-10-06', 'dueDate');
  eq(r.dueTime, null, 'dueTime');
});

// ---------------------------------------------------------------- 重复

it('重复：每天 / 每2天 / 每周一 / 每2周 / 每月1号 / 每年', () => {
  eq(parse('每天 喝水').repeat, { freq: 'daily', interval: 1 }, '每天');
  eq(parse('每2天 浇花').repeat, { freq: 'daily', interval: 2 }, '每2天');
  eq(parse('每周一 复盘').repeat, { freq: 'weekly', interval: 1, weekdays: [1] }, '每周一');
  eq(parse('每2周 复盘').repeat, { freq: 'weekly', interval: 2 }, '每2周');
  eq(parse('每月1号 交房租').repeat, { freq: 'monthly', interval: 1, monthDay: 1 }, '每月1号');
  eq(parse('每年 体检').repeat, { freq: 'yearly', interval: 1 }, '每年');
});

it('重复词不会被当成日期吃掉', () => {
  const r = parse('每周一 复盘');
  eq(r.dueDate, null, 'daily/weekly 规则不应同时产生到期日');
  eq(r.title, '复盘', 'title 应只剩「复盘」');
});

it('英文重复：every day / every monday', () => {
  eq(parse('every day drink water').repeat, { freq: 'daily', interval: 1 }, 'every day');
  eq(parse('every monday review').repeat, { freq: 'weekly', interval: 1, weekdays: [1] }, 'every monday');
});

// -------------------------------------------------------------- 优先级

it('优先级：p1 / !p2 / 优先级3 / !!!', () => {
  eq(parse('p1 交报告').priority, 'p1', 'p1');
  eq(parse('!p2 交报告').priority, 'p2', '!p2');
  eq(parse('优先级3 交报告').priority, 'p3', '优先级3');
  eq(parse('!!! 交报告').priority, 'p1', '!!!');
  eq(parse('!! 交报告').priority, 'p2', '!!');
  eq(parse('! 交报告').priority, 'p3', '!');
  eq(parse('交报告').priority, 'p4', '默认 p4');
});

it('优先级词从标题里摘干净', () => {
  eq(parse('p1 交报告').title, '交报告', 'title');
  eq(parse('!!! 交报告').title, '交报告', 'title');
});

// ------------------------------------------------------------ 项目/标签

it('项目与标签解析成 id；不存在的留在名字里待调用方决定', () => {
  const hit = parse('#Q4汇报 写材料');
  eq(hit.projectId, 'proj-q4', 'projectId');
  eq(hit.title, '写材料', 'title');

  const miss = parse('#不存在的项目 写材料');
  eq(miss.projectId, null, 'projectId');
  eq(miss.projectName, '不存在的项目', 'projectName');

  const label = parse('@写作 写材料');
  eq(label.labelIds, ['lbl-write'], 'labelIds');
  eq(label.labelNames, [], 'labelNames');

  const labelMiss = parse('@不存在 写材料');
  eq(labelMiss.labelIds, [], 'labelIds');
  eq(labelMiss.labelNames, ['不存在'], 'labelNames');
});

it('项目名大小写不敏感匹配', () => {
  eq(parse('#q4汇报 写材料').projectId, 'proj-q4', 'projectId');
});

it('多个标签都识别', () => {
  const r = parse('@写作 @电话 联系客户');
  eq(r.labelIds, ['lbl-write', 'lbl-call'], 'labelIds');
  eq(r.title, '联系客户', 'title');
});

// ------------------------------------------------------------ 边界情况

it('纯文本不被改动', () => {
  const r = parse('写季度总结');
  eq(r.title, '写季度总结', 'title');
  eq(r.dueDate, null, 'dueDate');
  eq(r.dueTime, null, 'dueTime');
  eq(r.priority, 'p4', 'priority');
  eq(r.matched, [], 'matched');
});

it('整行都是语法时，标题退回原文而不是空', () => {
  eq(parse('明天').title, '明天', 'title');
  eq(parse('p1').title, 'p1', 'title');
});

it('多余空白被折叠', () => {
  eq(parse('明天   交   报告').title, '交 报告', 'title');
});

it('空输入不抛错', () => {
  const r = parse('');
  eq(r.title, '', 'title');
  eq(r.dueDate, null, 'dueDate');
});

it('title 里的井号/at 不会误伤（后接空白）', () => {
  const r = parse('讨论 # 与 @ 的用法');
  eq(r.projectName, null, 'projectName');
  eq(r.labelNames, [], 'labelNames');
  eq(r.title, '讨论 # 与 @ 的用法', 'title');
});

it('matched 记录了被摘走的片段，便于 UI 高亮', () => {
  const r = parse('明天下午3点 交报告 #Q4汇报 @写作 p1');
  assert.ok(r.matched.length >= 4, `matched 应记录多段，实际 ${JSON.stringify(r.matched)}`);
});

// ------------------------------------------------------------------ 执行

let failed = 0;
for (const item of cases) {
  try {
    item.fn();
    console.log(`  ok   ${item.name}`);
  } catch (error) {
    failed += 1;
    console.log(` FAIL  ${item.name}\n        → ${error.message}`);
  }
}
console.log(`\n${cases.length - failed}/${cases.length} 通过`);
process.exit(failed === 0 ? 0 : 1);
