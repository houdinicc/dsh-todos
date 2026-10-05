/**
 * 待办中心（dsh-todos）—— 客户端半（浏览器 bundle）。
 *
 * 这是宿主 `exports["./client"]` 指向的产物：一个自注册的懒工厂，由
 * `window.__ModuleLoader__` 在浏览器里登记。`id` 必须等于包名。
 *
 * 约束（官方 `cordis-plugin-development` skill 的 UI 规则）：
 *  - 只从平台冻结模块表 require（react），不 import 任何其它 Harness Client 包；
 *  - 只用 `--dsw-alias-*` 主题 token，不写字面色值（图形例外）；
 *  - 通过 slot 扩展，不写组件之外的 DOM、不 append 到 body；
 *  - 工厂体内无副作用，资源都在 `apply` 里用 ctx.effect 注册并返回清理函数。
 *
 * 数据通道：宿主 HTTP 路由。用**文档相对路径**（GUI 用 `<base href="./">`，
 * 根绝对路径会在子路径部署下逃出前缀）。
 */

window.__ModuleLoader__.load({
  id: 'dsh-todos',

  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'todos';
    const API = 'api/dsh-todos';

    // ---------------------------------------------------------------- 文案

    const zh = {
      'entry.label': '待办',
      'panel.title': '待办中心',
      'panel.newTask': '新建任务',
      'nav.today': '今天',
      'nav.upcoming': '即将到来',
      'nav.inbox': '收件箱',
      'nav.dashboard': '仪表盘',
      'nav.done': '已完成',
      'nav.trash': '回收站',
      'nav.settings': '设置',
      'group.projects': '项目',
      'group.labels': '标签',
      'group.views': '视图',
      'quick.placeholder': '添加任务，回车确认（试试「明天下午3点 交报告 #Q4汇报 @写作 p1」）',
      'quick.add': '添加',
      'quick.understood': '已识别：{parts}',
      'quick.titleOnly': '只识别到标题',
      'search.placeholder': '搜索标题与备注…',
      'sort.label': '排序',
      'sort.due': '到期日',
      'sort.manual': '手动',
      'sort.priority': '优先级',
      'empty.today': '今天没有到期的任务。',
      'empty.upcoming': '接下来 30 天没有安排。',
      'empty.inbox': '收件箱是空的。',
      'empty.projects': '还没有创建项目。',
      'empty.project': '「{name}」里还没有任务。',
      'empty.label': '没有带「{name}」标签的任务。',
      'empty.done': '还没有完成任何任务。',
      'empty.trash': '回收站是空的。',
      'empty.dashboard': '完成第一条任务后，这里会开始出现趋势。',
      'empty.dashboard.hint': '先去「今天」或「收件箱」加一条任务，然后勾掉它。',
      'empty.search': '没有匹配「{query}」的任务。',
      'state.loading': '加载中…',
      'state.failed': '加载失败：{error}',
      'state.retry': '重试',
      'state.saving': '保存中…',
      'task.due.today': '今天',
      'task.due.tomorrow': '明天',
      'task.due.yesterday': '昨天',
      'task.due.overdueDays': '逾期 {days} 天',
      'task.due.on': '{month}月{day}日',
      'task.priority.p1': 'P1 最高',
      'task.priority.p2': 'P2 高',
      'task.priority.p3': 'P3 中',
      'task.priority.p4': '无优先级',
      'task.repeat': '重复',
      'task.subtask': '子任务',
      'task.edit': '编辑',
      'task.delete': '删除',
      'task.restore': '恢复',
      'task.purge': '彻底删除',
      'task.complete': '标记完成',
      'task.uncomplete': '标记未完成',
      'task.addSubtask': '添加子任务',
      'task.note': '备注',
      'task.project': '项目',
      'task.labels': '标签',
      'task.priority': '优先级',
      'task.dueDate': '到期日',
      'task.dueTime': '时间',
      'task.inbox': '收件箱',
      'task.subtasksOf': '子任务',
      'editor.save': '保存',
      'editor.cancel': '取消',
      'editor.title': '编辑任务',
      'subtask.placeholder': '子任务标题，回车确认',
      'projects.new': '新建项目',
      'projects.namePlaceholder': '项目名',
      'projects.rename': '重命名',
      'labels.new': '新建标签',
      'labels.namePlaceholder': '标签名',
      'row.delete.confirm': '确定删除「{name}」？{detail}',
      'row.delete.detail.project': '其下的任务会回到收件箱。',
      'row.delete.detail.label': '该标签会从所有任务上摘掉。',
      'kpi.dueToday': '今日待办',
      'kpi.overdue': '逾期',
      'kpi.completed': '本期完成',
      'kpi.rate': '完成率',
      'kpi.streak': '连续完成',
      'kpi.active': '活跃任务',
      'kpi.days': '{n} 天',
      'kpi.deltaUp': '比上期多 {n}',
      'kpi.deltaDown': '比上期少 {n}',
      'kpi.deltaFlat': '与上期持平',
      'chart.trend': '完成 vs 新增（近 14 天）',
      'chart.trend.legend.completed': '完成',
      'chart.trend.legend.created': '新增',
      'chart.priority': '优先级分布（未完成）',
      'chart.breakdown': '项目分布（未完成）',
      'chart.labels': '标签分布（未完成）',
      'chart.heatmap': '完成热力图（近 90 天）',
      'chart.weekday': '逾期集中在星期几',
      'chart.none': '暂无数据',
      'goal.title': '每周完成目标',
      'goal.progress': '{done} / {goal}',
      'goal.reached': '本周目标已达成 🎉',
      'goal.remaining': '还差 {n} 条',
      'insights.title': '本周洞察',
      'insight.completedUp': '本期完成 {n} 条，比上期多 {delta} 条 ↑',
      'insight.completedDown': '本期完成 {n} 条，比上期少 {delta} 条 ↓',
      'insight.completedFlat': '本期完成 {n} 条，与上期持平',
      'insight.overdue': '逾期 {n} 条，其中「{project}」占 {count} 条',
      'insight.overduePlain': '有 {n} 条逾期，建议先处理掉',
      'insight.streak': '连续 {n} 天有完成记录，保持住',
      'insight.streakNone': '今天还没有完成记录，挑一条最轻的先做掉',
      'insight.goalLeft': '距离本周目标还差 {n} 条',
      'insight.goalDone': '本周目标已达成',
      'insight.weekday': '你在周{day}最容易逾期（{n} 条）',
      'weekday.0': '日',
      'weekday.1': '一',
      'weekday.2': '二',
      'weekday.3': '三',
      'weekday.4': '四',
      'weekday.5': '五',
      'weekday.6': '六',
      'range.week': '本周',
      'range.month': '本月',
      'range.last30': '近 30 天',
      'range.last90': '近 90 天',
      'settings.title': '设置',
      'settings.weekGoal': '每周完成目标',
      'settings.weekGoalHint': '仪表盘的进度环与「还差几条」都用它。',
      'settings.remindEnabled': '到期提醒',
      'settings.remindEnabledHint': '任务到点时在界面右下角弹出提醒（需要 DSH 开着）。',
      'settings.data': '数据',
      'settings.dataFile': '数据文件：{path}',
      'settings.export': '导出 JSON',
      'settings.exportHint': '完整备份（含项目、标签、回收站）。',
      'settings.exportMarkdown': '导出 Markdown',
      'settings.exportMarkdownHint': '按项目分组，便于贴进周报。',
      'settings.import': '导入 JSON',
      'settings.importHint': '选择之前导出的文件。',
      'import.mode': '导入方式',
      'import.replace': '覆盖（用文件里的数据替换）',
      'import.merge': '合并（只补充文件里有、本地没有的）',
      'import.confirm': '确定导入？覆盖模式会替换当前全部任务（设置保留）。',
      'import.done': '导入完成：{tasks} 条任务、{projects} 个项目、{labels} 个标签。',
      'import.failed': '导入失败：{error}',
      'settings.saved': '已保存',
      'reminder.title': '待办提醒',
      'reminder.overdue': '已逾期 {days} 天',
      'reminder.dueNow': '现在到点',
      'reminder.more': '还有 {n} 条也到点了',
      'reminder.complete': '完成',
      'reminder.snooze': '推迟到明天',
      'reminder.dismiss': '稍后',
      'trash.purgeAll': '清空回收站',
      'trash.purgeAllConfirm': '确定清空回收站？此操作不可撤销。',
    };

    const en = {
      'entry.label': 'Todos',
      'panel.title': 'Todo Center',
      'panel.newTask': 'New task',
      'nav.today': 'Today',
      'nav.upcoming': 'Upcoming',
      'nav.inbox': 'Inbox',
      'nav.dashboard': 'Dashboard',
      'nav.done': 'Completed',
      'nav.trash': 'Trash',
      'nav.settings': 'Settings',
      'group.projects': 'Projects',
      'group.labels': 'Labels',
      'group.views': 'Views',
      'quick.placeholder': 'Add a task, press Enter (try "tomorrow 3pm write report #Q4 @writing p1")',
      'quick.add': 'Add',
      'quick.understood': 'Parsed: {parts}',
      'quick.titleOnly': 'Title only',
      'search.placeholder': 'Search titles and notes…',
      'sort.label': 'Sort',
      'sort.due': 'Due date',
      'sort.manual': 'Manual',
      'sort.priority': 'Priority',
      'empty.today': 'Nothing due today.',
      'empty.upcoming': 'Nothing scheduled in the next 30 days.',
      'empty.inbox': 'Your inbox is empty.',
      'empty.projects': 'No projects yet.',
      'empty.project': 'Nothing in “{name}” yet.',
      'empty.label': 'No tasks labelled “{name}”.',
      'empty.done': 'Nothing completed yet.',
      'empty.trash': 'Trash is empty.',
      'empty.dashboard': 'Trends appear once you complete your first task.',
      'empty.dashboard.hint': 'Add a task in Today or Inbox, then tick it off.',
      'empty.search': 'Nothing matches “{query}”.',
      'state.loading': 'Loading…',
      'state.failed': 'Load failed: {error}',
      'state.retry': 'Retry',
      'state.saving': 'Saving…',
      'task.due.today': 'Today',
      'task.due.tomorrow': 'Tomorrow',
      'task.due.yesterday': 'Yesterday',
      'task.due.overdueDays': '{days} days overdue',
      'task.due.on': '{month}/{day}',
      'task.priority.p1': 'P1 highest',
      'task.priority.p2': 'P2 high',
      'task.priority.p3': 'P3 medium',
      'task.priority.p4': 'No priority',
      'task.repeat': 'Repeats',
      'task.subtask': 'Subtask',
      'task.edit': 'Edit',
      'task.delete': 'Delete',
      'task.restore': 'Restore',
      'task.purge': 'Delete forever',
      'task.complete': 'Mark complete',
      'task.uncomplete': 'Mark incomplete',
      'task.addSubtask': 'Add subtask',
      'task.note': 'Note',
      'task.project': 'Project',
      'task.labels': 'Labels',
      'task.priority': 'Priority',
      'task.dueDate': 'Due date',
      'task.dueTime': 'Time',
      'task.inbox': 'Inbox',
      'task.subtasksOf': 'Subtasks',
      'editor.save': 'Save',
      'editor.cancel': 'Cancel',
      'editor.title': 'Edit task',
      'subtask.placeholder': 'Subtask title, press Enter',
      'projects.new': 'New project',
      'projects.namePlaceholder': 'Project name',
      'projects.rename': 'Rename',
      'labels.new': 'New label',
      'labels.namePlaceholder': 'Label name',
      'row.delete.confirm': 'Delete “{name}”? {detail}',
      'row.delete.detail.project': 'Its tasks move back to Inbox.',
      'row.delete.detail.label': 'It is removed from every task.',
      'kpi.dueToday': 'Due today',
      'kpi.overdue': 'Overdue',
      'kpi.completed': 'Completed',
      'kpi.rate': 'Completion rate',
      'kpi.streak': 'Streak',
      'kpi.active': 'Active tasks',
      'kpi.days': '{n} d',
      'kpi.deltaUp': '{n} more than last period',
      'kpi.deltaDown': '{n} fewer than last period',
      'kpi.deltaFlat': 'Same as last period',
      'chart.trend': 'Completed vs created (14 days)',
      'chart.trend.legend.completed': 'Completed',
      'chart.trend.legend.created': 'Created',
      'chart.priority': 'Priority (open)',
      'chart.breakdown': 'Projects (open)',
      'chart.labels': 'Labels (open)',
      'chart.heatmap': 'Completion heatmap (90 days)',
      'chart.weekday': 'Overdue by weekday',
      'chart.none': 'No data yet',
      'goal.title': 'Weekly goal',
      'goal.progress': '{done} / {goal}',
      'goal.reached': 'Weekly goal reached 🎉',
      'goal.remaining': '{n} to go',
      'insights.title': 'This week',
      'insight.completedUp': 'Completed {n} this period, {delta} more than last ↑',
      'insight.completedDown': 'Completed {n} this period, {delta} fewer than last ↓',
      'insight.completedFlat': 'Completed {n} this period, same as last',
      'insight.overdue': '{n} overdue, {count} of them in “{project}”',
      'insight.overduePlain': '{n} overdue — clear those first',
      'insight.streak': '{n} days in a row with a completion, keep it up',
      'insight.streakNone': 'Nothing completed today — pick the easiest one',
      'insight.goalLeft': '{n} more to hit this week’s goal',
      'insight.goalDone': 'This week’s goal is met',
      'insight.weekday': 'You slip most on {day} ({n} overdue)',
      'weekday.0': 'Sun',
      'weekday.1': 'Mon',
      'weekday.2': 'Tue',
      'weekday.3': 'Wed',
      'weekday.4': 'Thu',
      'weekday.5': 'Fri',
      'weekday.6': 'Sat',
      'range.week': 'This week',
      'range.month': 'This month',
      'range.last30': '30 days',
      'range.last90': '90 days',
      'settings.title': 'Settings',
      'settings.weekGoal': 'Weekly goal',
      'settings.weekGoalHint': 'Used by the dashboard progress ring and “to go”.',
      'settings.remindEnabled': 'Due reminders',
      'settings.remindEnabledHint': 'Pops a reminder in the corner when a task comes due (DSH must be open).',
      'settings.data': 'Data',
      'settings.dataFile': 'Data file: {path}',
      'settings.export': 'Export JSON',
      'settings.exportHint': 'Full backup including projects, labels and trash.',
      'settings.exportMarkdown': 'Export Markdown',
      'settings.exportMarkdownHint': 'Grouped by project, handy for a weekly report.',
      'settings.import': 'Import JSON',
      'settings.importHint': 'Pick a file you exported earlier.',
      'import.mode': 'Import mode',
      'import.replace': 'Replace (use the file’s data)',
      'import.merge': 'Merge (only add what is missing)',
      'import.confirm': 'Import now? Replace wipes current tasks (settings are kept).',
      'import.done': 'Imported {tasks} tasks, {projects} projects, {labels} labels.',
      'import.failed': 'Import failed: {error}',
      'settings.saved': 'Saved',
      'reminder.title': 'Todo reminder',
      'reminder.overdue': '{days} days overdue',
      'reminder.dueNow': 'Due now',
      'reminder.more': '{n} more are due too',
      'reminder.complete': 'Complete',
      'reminder.snooze': 'Snooze to tomorrow',
      'reminder.dismiss': 'Later',
      'trash.purgeAll': 'Empty trash',
      'trash.purgeAllConfirm': 'Empty the trash? This cannot be undone.',
    };

    // --------------------------------------------------------------- 样式

    const CSS = `
.dsht-root{display:flex;height:100%;min-height:0;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.dsht-side{flex:0 0 212px;min-width:0;display:flex;flex-direction:column;gap:2px;padding:12px 8px;overflow:auto;border-right:1px solid var(--dsw-alias-border-l1)}
.dsht-sidegroup{margin:10px 8px 2px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dsht-navrow{display:flex;align-items:center;gap:8px;width:100%;text-align:left;color:var(--dsw-alias-label-secondary);background:0 0;border:0;border-radius:6px;padding:5px 8px;font:inherit;cursor:pointer}
.dsht-navrow:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsht-navrow.is-active{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary);font-weight:600}
.dsht-navrow-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsht-navrow-count{flex:0 0 auto;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dsht-nav-actions{flex:0 0 auto;display:none;gap:2px}
.dsht-navrow:hover .dsht-nav-actions,.dsht-navrow:focus-within .dsht-nav-actions{display:flex}
.dsht-dot{flex:0 0 auto;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-brand-primary)}
.dsht-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column}
.dsht-header{display:flex;align-items:center;gap:8px;padding:14px 20px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dsht-title{margin:0;font-size:16px;font-weight:600;flex:0 0 auto;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsht-header-spacer{flex:1 1 auto}
.dsht-primary{color:var(--dsw-alias-label-primary-foreground);background:var(--dsw-alias-button-primary-fill);border:0;border-radius:6px;padding:5px 12px;font:inherit;cursor:pointer;flex:0 0 auto}
.dsht-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.dsht-primary:disabled{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-dimmed);cursor:default}
.dsht-ghost{color:var(--dsw-alias-label-secondary);background:0 0;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:4px 10px;font:inherit;cursor:pointer;flex:0 0 auto;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
.dsht-ghost:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsht-icon{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;color:var(--dsw-alias-label-secondary);background:0 0;border:0;border-radius:6px;cursor:pointer;padding:0}
.dsht-icon:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsht-icon.is-danger:hover{color:var(--dsw-alias-label-error);background:var(--dsw-alias-interactive-bg-hover-danger)}
.dsht-quick{display:flex;flex-direction:column;gap:4px;padding:12px 20px 4px}
.dsht-quickrow{display:flex;align-items:center;gap:8px}
.dsht-input{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:6px 10px;font:inherit}
.dsht-input:focus{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color);outline-offset:-1px}
.dsht-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dsht-search{flex:0 1 200px;min-width:90px}
.dsht-body{flex:1 1 auto;min-height:0;overflow:auto;padding:8px 20px 24px}
.dsht-empty{color:var(--dsw-alias-label-secondary);max-width:56ch;padding:16px 0}
.dsht-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;margin-top:4px}
.dsht-error{display:flex;align-items:center;gap:10px;margin:12px 0;padding:10px 12px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:8px;color:var(--dsw-alias-label-primary)}
.dsht-task{display:flex;align-items:flex-start;gap:10px;padding:7px 8px;border-radius:8px;border:1px solid transparent}
.dsht-task:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsht-task.is-done .dsht-task-title{color:var(--dsw-alias-label-tertiary);text-decoration:line-through}
.dsht-task.is-dragover{border-color:var(--dsw-alias-brand-primary)}
.dsht-task.is-sub{border-left:2px solid var(--dsw-alias-border-l2);margin-left:22px}
.dsht-check{flex:0 0 auto;width:18px;height:18px;margin-top:2px;padding:0;border-radius:5px;border:1.5px solid var(--dsw-alias-border-l2);background:0 0;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-primary-foreground)}
.dsht-check:hover{border-color:var(--dsw-alias-brand-primary)}
.dsht-check.is-done{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.dsht-task-main{flex:1 1 auto;min-width:0}
.dsht-task-title{overflow-wrap:anywhere}
.dsht-task-note{color:var(--dsw-alias-label-secondary);font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}
.dsht-chips{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:2px;font-size:12px}
.dsht-chip{display:inline-flex;align-items:center;gap:4px;padding:0 6px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1)}
.dsht-chip.is-due{color:var(--dsw-alias-label-primary)}
.dsht-chip.is-overdue{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.dsht-chip.is-today{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.dsht-pri{flex:0 0 auto;width:3px;align-self:stretch;border-radius:2px;margin-top:2px}
.dsht-pri.p1{background:var(--dsw-alias-state-error-primary)}
.dsht-pri.p2{background:var(--dsw-alias-state-warn-primary)}
.dsht-pri.p3{background:var(--dsw-alias-brand-primary)}
.dsht-pri.p4{background:0 0}
.dsht-task-actions{flex:0 0 auto;display:flex;gap:2px;opacity:0}
.dsht-task:hover .dsht-task-actions,.dsht-task:focus-within .dsht-task-actions{opacity:1}
.dsht-editor{margin:6px 0 12px;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);display:grid;grid-template-columns:1fr 1fr;gap:10px}
.dsht-field{display:flex;flex-direction:column;gap:3px;min-width:0}
.dsht-field.is-wide{grid-column:1 / -1}
.dsht-label{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dsht-editor-actions{grid-column:1 / -1;display:flex;gap:8px;justify-content:flex-end}
.dsht-select{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:5px 8px;font:inherit}
.dsht-inline-form{display:flex;gap:6px;padding:2px 8px 6px}
.dsht-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:8px 0 4px}
.dsht-kpi{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;background:var(--dsw-alias-bg-layer-1)}
.dsht-kpi-value{font-size:22px;font-weight:600;line-height:30px}
.dsht-kpi-label{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dsht-kpi-delta{font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsht-card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:12px;margin:10px 0;background:var(--dsw-alias-bg-layer-1)}
.dsht-card-title{margin:0 0 8px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.dsht-legend{display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:var(--dsw-alias-label-tertiary);margin-bottom:6px}
.dsht-swatch{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px;vertical-align:middle}
.dsht-grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px}
.dsht-bar-row{display:flex;align-items:center;gap:8px;font-size:12px;margin:3px 0}
.dsht-bar-name{flex:0 0 96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}
.dsht-bar-track{flex:1 1 auto;height:10px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.dsht-bar-fill{height:100%;border-radius:5px;background:var(--dsw-alias-brand-primary)}
.dsht-bar-value{flex:0 0 34px;text-align:right;color:var(--dsw-alias-label-tertiary)}
.dsht-goal{display:flex;align-items:center;gap:14px}
.dsht-goal-text{font-size:13px;color:var(--dsw-alias-label-secondary)}
.dsht-insights{margin:0;padding-left:18px}
.dsht-insights li{margin:3px 0;color:var(--dsw-alias-label-secondary)}
.dsht-settings{max-width:64ch;display:flex;flex-direction:column;gap:14px}
.dsht-setting{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:12px;background:var(--dsw-alias-bg-layer-1)}
.dsht-setting-row{display:flex;align-items:center;gap:10px}
.dsht-switch{flex:0 0 auto;width:36px;height:20px;border:0;border-radius:999px;background:var(--dsw-alias-border-l3);position:relative;cursor:pointer;padding:2px}
.dsht-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary)}
.dsht-switch:disabled{cursor:default;opacity:.5}
.dsht-switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-primary-foreground);transition:left .12s ease}
.dsht-switch[aria-checked="false"]::after{background:var(--dsw-alias-switch-thumb)}
.dsht-switch[aria-checked="true"]::after{left:18px}
.dsht-glyph{display:inline-flex}
.dsht-svgtext{font-size:9px;fill:var(--dsw-alias-label-tertiary)}
.dsht-toast{position:fixed;right:20px;bottom:20px;z-index:60;max-width:360px;border:1px solid var(--dsw-elevation-stroke-color);border-radius:10px;background:var(--dsw-alias-toast-bg);color:var(--dsw-alias-toast-label);box-shadow:var(--dsw-shadow-lv3);padding:12px 14px}
.dsht-toast-title{font-size:13px;font-weight:600;margin-bottom:6px}
.dsht-toast-task{font-size:13px;overflow-wrap:anywhere}
.dsht-toast-meta{font-size:12px;color:var(--dsw-alias-label-tertiary);margin:2px 0 10px}
.dsht-toast-actions{display:flex;flex-wrap:wrap;gap:6px}
@media (max-width:820px){.dsht-side{flex-basis:150px}.dsht-editor{grid-template-columns:1fr}.dsht-search{flex-basis:110px}}
`;

    const STYLE_TAG_ID = 'dsh-todos';

    /** 幂等地把样式注入 document.head；返回移除函数。 */
    function installStyles() {
      if (typeof document === 'undefined') return () => {};
      const selector = `style[data-plugin-css=${JSON.stringify(STYLE_TAG_ID)}]`;
      const existing = document.querySelector(selector);
      if (existing !== null) return () => {};
      const tag = document.createElement('style');
      tag.dataset.pluginCss = STYLE_TAG_ID;
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return () => {
        if (tag.parentNode !== null) tag.parentNode.removeChild(tag);
      };
    }

    // ------------------------------------------------------------ 数据通道

    async function request(path, init) {
      const response = await fetch(`${API}${path}`, {
        headers: init?.body === undefined ? undefined : { 'content-type': 'application/json' },
        ...init,
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        throw new Error(`HTTP ${response.status}`);
      }
      if (!response.ok || payload?.ok !== true) {
        throw new Error(payload?.error?.message ?? `HTTP ${response.status}`);
      }
      return payload.value;
    }

    const json = (body) => ({ method: 'POST', body: JSON.stringify(body) });

    const api = {
      snapshot: () => request('/snapshot'),
      stats: (range) => request(`/stats?range=${encodeURIComponent(range)}`),
      due: () => request('/due'),
      parse: (input) => request('/tasks/parse', json({ input })),
      quickAdd: (inputs) => request('/tasks/quick-add', json({ inputs })),
      update: (updates) => request('/tasks/update', json({ updates })),
      complete: (ids, completed) => request('/tasks/complete', json({ ids, completed })),
      remove: (ids) => request('/tasks/delete', json({ ids })),
      restore: (ids) => request('/tasks/restore', json({ ids })),
      purge: (ids) => request('/tasks/purge', json({ ids })),
      saveProject: (project) => request('/projects/save', json(project)),
      deleteProject: (id) => request('/projects/delete', json({ id })),
      saveLabel: (label) => request('/labels/save', json(label)),
      deleteLabel: (id) => request('/labels/delete', json({ id })),
      saveSettings: (patch) => request('/settings/update', json(patch)),
      importState: (payload, mode) => request('/import', json({ payload, mode })),
    };

    // -------------------------------------------------------------- 小工具

    const PRIORITY_RANK = { p1: 0, p2: 1, p3: 2, p4: 3 };
    const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

    function compareTasks(a, b) {
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

    function sortFor(mode, rows) {
      const copy = rows.slice();
      if (mode === 'manual') {
        return copy.sort((a, b) => a.order - b.order || String(a.createdAt).localeCompare(String(b.createdAt)));
      }
      if (mode === 'priority') {
        return copy.sort(
          (a, b) => (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) || compareTasks(a, b),
        );
      }
      return copy.sort(compareTasks);
    }

    function addDays(key, delta) {
      const [y, m, d] = key.split('-').map(Number);
      const dt = new Date(y, m - 1, d);
      dt.setDate(dt.getDate() + delta);
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    }

    function daysBetween(from, to) {
      return Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86_400_000);
    }

    function dueLabel(task, today, t) {
      if (task.dueDate === null) return null;
      const delta = daysBetween(today, task.dueDate);
      let text;
      if (delta === 0) text = t('task.due.today');
      else if (delta === 1) text = t('task.due.tomorrow');
      else if (delta === -1) text = t('task.due.yesterday');
      else if (delta < -1) text = t('task.due.overdueDays', { days: -delta });
      else {
        const [, month, day] = task.dueDate.split('-');
        text = t('task.due.on', { month: Number(month), day: Number(day) });
      }
      return task.dueTime === null ? text : `${text} ${task.dueTime}`;
    }

    function dueClass(task, today) {
      if (task.dueDate === null) return '';
      const delta = daysBetween(today, task.dueDate);
      if (delta < 0) return ' is-overdue';
      if (delta === 0) return ' is-today';
      return ' is-due';
    }

    const cls = (...parts) => parts.filter(Boolean).join(' ');

    /** 把解析结果显示成一行「已识别」提示。 */
    function describeParsed(parsed, t) {
      const parts = [];
      if (parsed.dueDate !== null) parts.push(parsed.dueTime === null ? parsed.dueDate : `${parsed.dueDate} ${parsed.dueTime}`);
      if (parsed.projectName !== null) parts.push(`#${parsed.projectName}`);
      for (const name of parsed.labelNames) parts.push(`@${name}`);
      if (parsed.priority !== 'p4') parts.push(parsed.priority.toUpperCase());
      if (parsed.repeat !== null) parts.push(t('task.repeat'));
      return parts;
    }

    // ------------------------------------------------------------ 侧边栏字形

    function TodosGlyph({ size = 16 }) {
      return h(
        'svg',
        {
          className: 'dsht-glyph',
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': true,
          focusable: false,
        },
        h('rect', { x: 3, y: 3, width: 18, height: 18, rx: 4.5, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', {
          d: 'M7.5 12.2l2.6 2.6 6-6.4',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      );
    }

    // ---------------------------------------------------------------- 图标

    const icon = (paths, size = 15) =>
      h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          focusable: false,
        },
        paths.map((d, i) => h('path', { key: i, d })),
      );

    const IconCheck = (props) => icon(['M20 6L9 17l-5-5'], props?.size);
    const IconPencil = (props) => icon(['M12 20h9', 'M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z'], props?.size);
    const IconTrash = (props) => icon(['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6'], props?.size);
    const IconUndo = (props) => icon(['M3 7v6h6', 'M3.5 13a9 9 0 106-8.7'], props?.size);
    const IconPlus = (props) => icon(['M12 5v14', 'M5 12h14'], props?.size);

    // -------------------------------------------------------- 主题色常量
    // 只取 cordis_inspect_query Theme 确认过的 token。

    const STATE_SUCCESS = 'var(--dsw-alias-state-success-primary)';
    const STATE_WARN = 'var(--dsw-alias-state-warn-primary)';
    const STATE_ERROR = 'var(--dsw-alias-state-error-primary)';
    const BRAND = 'var(--dsw-alias-brand-primary)';
    const IDLE = 'var(--dsw-alias-state-idle-primary)';

    // -------------------------------------------------------------- 子组件

    function NavRow({ active, label, count, color, onClick, actions }) {
      return h(
        'div',
        { className: cls('dsht-navrow', active && 'is-active') },
        h(
          'button',
          {
            type: 'button',
            className: 'dsht-navrow',
            style: { padding: 0, background: 'none', flex: '1 1 auto', minWidth: 0 },
            'aria-current': active ? 'true' : undefined,
            onClick,
          },
          color === undefined ? null : h('span', { className: 'dsht-dot', style: { background: color } }),
          h('span', { className: 'dsht-navrow-label' }, label),
        ),
        count === undefined || count === 0 ? null : h('span', { className: 'dsht-navrow-count' }, String(count)),
        actions === undefined ? null : h('span', { className: 'dsht-nav-actions' }, actions),
      );
    }

    function TaskRow(props) {
      const { task, today, t, projectName, labelNames, busy, depth, draggable, dragOver, handlers } = props;
      const due = dueLabel(task, today, t);
      return h(
        'div',
        {
          className: cls('dsht-task', task.completed && 'is-done', depth > 0 && 'is-sub', dragOver && 'is-dragover'),
          draggable: draggable ? 'true' : undefined,
          onDragStart: handlers?.onDragStart,
          onDragOver: handlers?.onDragOver,
          onDragLeave: handlers?.onDragLeave,
          onDrop: handlers?.onDrop,
          onDragEnd: handlers?.onDragEnd,
        },
        h('span', { className: cls('dsht-pri', task.priority), 'aria-hidden': true }),
        h(
          'button',
          {
            type: 'button',
            className: cls('dsht-check', task.completed && 'is-done'),
            role: 'checkbox',
            'aria-checked': task.completed ? 'true' : 'false',
            'aria-label': task.completed ? t('task.uncomplete') : t('task.complete'),
            disabled: busy,
            onClick: () => props.onToggle(task),
          },
          task.completed ? h(IconCheck, { size: 12 }) : null,
        ),
        h(
          'div',
          { className: 'dsht-task-main' },
          h('div', { className: 'dsht-task-title' }, task.title),
          task.note === '' ? null : h('div', { className: 'dsht-task-note' }, task.note),
          h(
            'div',
            { className: 'dsht-chips' },
            due === null ? null : h('span', { className: cls('dsht-chip', dueClass(task, today)) }, due),
            task.projectId === null || projectName === undefined ? null : h('span', { className: 'dsht-chip' }, projectName),
            ...task.labelIds.map((id) =>
              labelNames.get(id) === undefined ? null : h('span', { key: id, className: 'dsht-chip' }, `@${labelNames.get(id)}`),
            ),
            task.priority === 'p4' ? null : h('span', { className: 'dsht-chip' }, t(`task.priority.${task.priority}`)),
            task.repeat === null ? null : h('span', { className: 'dsht-chip' }, t('task.repeat')),
            props.subtaskCount > 0
              ? h('span', { className: 'dsht-chip' }, `${t('task.subtask')} ${props.subtaskDone}/${props.subtaskCount}`)
              : null,
          ),
        ),
        h(
          'div',
          { className: 'dsht-task-actions' },
          task.deletedAt !== null
            ? [
                h(
                  'button',
                  {
                    key: 'restore',
                    type: 'button',
                    className: 'dsht-icon',
                    title: t('task.restore'),
                    'aria-label': t('task.restore'),
                    onClick: () => props.onRestore(task),
                  },
                  h(IconUndo, {}),
                ),
                h(
                  'button',
                  {
                    key: 'purge',
                    type: 'button',
                    className: 'dsht-icon is-danger',
                    title: t('task.purge'),
                    'aria-label': t('task.purge'),
                    onClick: () => props.onPurge(task),
                  },
                  h(IconTrash, {}),
                ),
              ]
            : [
                h(
                  'button',
                  {
                    key: 'sub',
                    type: 'button',
                    className: 'dsht-icon',
                    title: t('task.addSubtask'),
                    'aria-label': t('task.addSubtask'),
                    onClick: () => props.onAddSubtask(task),
                  },
                  h(IconPlus, {}),
                ),
                h(
                  'button',
                  {
                    key: 'edit',
                    type: 'button',
                    className: 'dsht-icon',
                    title: t('task.edit'),
                    'aria-label': t('task.edit'),
                    onClick: () => props.onEdit(task),
                  },
                  h(IconPencil, {}),
                ),
                h(
                  'button',
                  {
                    key: 'delete',
                    type: 'button',
                    className: 'dsht-icon is-danger',
                    title: t('task.delete'),
                    'aria-label': t('task.delete'),
                    onClick: () => props.onDelete(task),
                  },
                  h(IconTrash, {}),
                ),
              ],
        ),
      );
    }

    function TaskEditor({ task, projects, labels, subtasks, t, onSave, onCancel, onAddSubtask }) {
      const [draft, setDraft] = React.useState({
        title: task.title,
        note: task.note,
        projectId: task.projectId ?? '',
        priority: task.priority,
        dueDate: task.dueDate ?? '',
        dueTime: task.dueTime ?? '',
        labelIds: task.labelIds.slice(),
      });
      const [subtaskDraft, setSubtaskDraft] = React.useState('');
      const set = (key) => (event) => setDraft({ ...draft, [key]: event.target.value });
      const toggleLabel = (id) =>
        setDraft({
          ...draft,
          labelIds: draft.labelIds.includes(id) ? draft.labelIds.filter((x) => x !== id) : draft.labelIds.concat([id]),
        });

      return h(
        'form',
        {
          className: 'dsht-editor',
          onSubmit: (event) => {
            event.preventDefault();
            if (draft.title.trim() === '') return;
            onSave({
              title: draft.title.trim(),
              note: draft.note,
              projectId: draft.projectId === '' ? null : draft.projectId,
              priority: draft.priority,
              dueDate: draft.dueDate === '' ? null : draft.dueDate,
              dueTime: draft.dueTime === '' ? null : draft.dueTime,
              labelIds: draft.labelIds,
            });
          },
        },
        h(
          'label',
          { className: 'dsht-field is-wide' },
          h('span', { className: 'dsht-label' }, t('editor.title')),
          h('input', { className: 'dsht-input', value: draft.title, onChange: set('title'), autoFocus: true }),
        ),
        h(
          'label',
          { className: 'dsht-field is-wide' },
          h('span', { className: 'dsht-label' }, t('task.note')),
          h('textarea', { className: 'dsht-input', rows: 2, value: draft.note, onChange: set('note') }),
        ),
        h(
          'label',
          { className: 'dsht-field' },
          h('span', { className: 'dsht-label' }, t('task.dueDate')),
          h('input', { type: 'date', className: 'dsht-input', value: draft.dueDate, onChange: set('dueDate') }),
        ),
        h(
          'label',
          { className: 'dsht-field' },
          h('span', { className: 'dsht-label' }, t('task.dueTime')),
          h('input', { type: 'time', className: 'dsht-input', value: draft.dueTime, onChange: set('dueTime') }),
        ),
        h(
          'label',
          { className: 'dsht-field' },
          h('span', { className: 'dsht-label' }, t('task.project')),
          h(
            'select',
            { className: 'dsht-select', value: draft.projectId, onChange: set('projectId') },
            h('option', { value: '' }, t('task.inbox')),
            ...projects.map((p) => h('option', { key: p.id, value: p.id }, p.name)),
          ),
        ),
        h(
          'label',
          { className: 'dsht-field' },
          h('span', { className: 'dsht-label' }, t('task.priority')),
          h(
            'select',
            { className: 'dsht-select', value: draft.priority, onChange: set('priority') },
            ...['p1', 'p2', 'p3', 'p4'].map((p) => h('option', { key: p, value: p }, t(`task.priority.${p}`))),
          ),
        ),
        labels.length === 0
          ? null
          : h(
              'div',
              { className: 'dsht-field is-wide' },
              h('span', { className: 'dsht-label' }, t('task.labels')),
              h(
                'div',
                { className: 'dsht-chips' },
                ...labels.map((label) =>
                  h(
                    'button',
                    {
                      key: label.id,
                      type: 'button',
                      className: cls('dsht-chip', draft.labelIds.includes(label.id) && 'is-due'),
                      'aria-pressed': draft.labelIds.includes(label.id) ? 'true' : 'false',
                      onClick: () => toggleLabel(label.id),
                    },
                    `@${label.name}`,
                  ),
                ),
              ),
            ),
        h(
          'div',
          { className: 'dsht-field is-wide' },
          h('span', { className: 'dsht-label' }, `${t('task.subtasksOf')}${subtasks.length === 0 ? '' : ` · ${subtasks.length}`}`),
          ...subtasks.map((child) =>
            h(
              'div',
              { key: child.id, className: 'dsht-chips' },
              h('span', { className: cls('dsht-chip', child.completed && 'is-due') }, child.title),
            ),
          ),
          h('input', {
            className: 'dsht-input',
            placeholder: t('subtask.placeholder'),
            value: subtaskDraft,
            onChange: (event) => setSubtaskDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              const title = subtaskDraft.trim();
              if (title === '') return;
              setSubtaskDraft('');
              onAddSubtask(task.id, title);
            },
          }),
        ),
        h(
          'div',
          { className: 'dsht-editor-actions' },
          h('button', { type: 'button', className: 'dsht-ghost', onClick: onCancel }, t('editor.cancel')),
          h('button', { type: 'submit', className: 'dsht-primary' }, t('editor.save')),
        ),
      );
    }

    function KpiCard({ label, value, delta, tone }) {
      return h(
        'div',
        { className: 'dsht-kpi' },
        h('div', { className: 'dsht-kpi-value', style: tone === undefined ? undefined : { color: tone } }, String(value)),
        h('div', { className: 'dsht-kpi-label' }, label),
        delta === undefined ? null : h('div', { className: 'dsht-kpi-delta' }, delta),
      );
    }

    /** 完成 vs 新增：分组柱状图（手绘 SVG）。 */
    function TrendChart({ data, t }) {
      const width = 560;
      const height = 150;
      const pad = { left: 6, right: 6, top: 10, bottom: 22 };
      const inner = width - pad.left - pad.right;
      const innerH = height - pad.top - pad.bottom;
      const max = Math.max(1, ...data.map((d) => Math.max(d.completed, d.created)));
      const slot = inner / Math.max(1, data.length);
      const barW = Math.max(3, slot / 2 - 2);
      const y = (v) => pad.top + innerH - (v / max) * innerH;

      const bars = [];
      data.forEach((d, i) => {
        const x = pad.left + i * slot + slot / 2;
        bars.push(
          h('rect', {
            key: `c${d.date}`,
            x: x - barW - 1,
            y: y(d.completed),
            width: barW,
            height: Math.max(0, pad.top + innerH - y(d.completed)),
            rx: 1.5,
            fill: STATE_SUCCESS,
          }),
          h('rect', {
            key: `n${d.date}`,
            x: x + 1,
            y: y(d.created),
            width: barW,
            height: Math.max(0, pad.top + innerH - y(d.created)),
            rx: 1.5,
            fill: IDLE,
          }),
        );
        if (i % 3 === 0 || i === data.length - 1) {
          bars.push(
            h('text', { key: `t${d.date}`, x, y: height - 6, textAnchor: 'middle', className: 'dsht-svgtext' }, d.date.slice(5).replace('-', '/')),
          );
        }
      });

      return h(
        'div',
        { className: 'dsht-card' },
        h('h3', { className: 'dsht-card-title' }, t('chart.trend')),
        h(
          'div',
          { className: 'dsht-legend' },
          h('span', {}, h('span', { className: 'dsht-swatch', style: { background: STATE_SUCCESS } }), t('chart.trend.legend.completed')),
          h('span', {}, h('span', { className: 'dsht-swatch', style: { background: IDLE } }), t('chart.trend.legend.created')),
        ),
        h(
          'svg',
          { viewBox: `0 0 ${width} ${height}`, width: '100%', height: '150', role: 'img', 'aria-label': t('chart.trend') },
          h('line', {
            x1: pad.left,
            y1: pad.top + innerH,
            x2: width - pad.right,
            y2: pad.top + innerH,
            stroke: 'var(--dsw-alias-border-l1)',
          }),
          ...bars,
        ),
      );
    }

    /** 横向条形分布。 */
    function Breakdown({ title, buckets, t }) {
      const max = Math.max(1, ...buckets.map((b) => b.count));
      return h(
        'div',
        { className: 'dsht-card' },
        h('h3', { className: 'dsht-card-title' }, title),
        buckets.length === 0
          ? h('div', { className: 'dsht-hint' }, t('chart.none'))
          : buckets.slice(0, 8).map((bucket) =>
              h(
                'div',
                { key: bucket.id, className: 'dsht-bar-row' },
                h('span', { className: 'dsht-bar-name', title: bucket.name }, bucket.name),
                h('span', { className: 'dsht-bar-track' }, h('span', { className: 'dsht-bar-fill', style: { width: `${(bucket.count / max) * 100}%` } })),
                h('span', { className: 'dsht-bar-value' }, String(bucket.count)),
              ),
            ),
      );
    }

    /** 优先级堆叠条。 */
    function PriorityBar({ priority, t }) {
      const order = ['p1', 'p2', 'p3', 'p4'];
      const colors = { p1: STATE_ERROR, p2: STATE_WARN, p3: BRAND, p4: IDLE };
      const total = order.reduce((sum, key) => sum + (priority[key] ?? 0), 0);
      return h(
        'div',
        { className: 'dsht-card' },
        h('h3', { className: 'dsht-card-title' }, t('chart.priority')),
        total === 0
          ? h('div', { className: 'dsht-hint' }, t('chart.none'))
          : [
              h(
                'div',
                { key: 'bar', style: { display: 'flex', height: '12px', borderRadius: '6px', overflow: 'hidden', background: 'var(--dsw-alias-bg-layer-2)' } },
                ...order.map((key) =>
                  (priority[key] ?? 0) === 0
                    ? null
                    : h('span', {
                        key,
                        style: { width: `${((priority[key] ?? 0) / total) * 100}%`, background: colors[key] },
                        title: `${t(`task.priority.${key}`)}: ${priority[key]}`,
                      }),
                ),
              ),
              h(
                'div',
                { key: 'legend', className: 'dsht-legend', style: { marginTop: '8px', marginBottom: 0 } },
                ...order.map((key) =>
                  h('span', { key }, h('span', { className: 'dsht-swatch', style: { background: colors[key] } }), `${t(`task.priority.${key}`)} ${priority[key] ?? 0}`),
                ),
              ),
            ],
      );
    }

    /** 逾期按星期的分布。 */
    function WeekdayChart({ counts, t }) {
      const max = Math.max(1, ...counts);
      const total = counts.reduce((a, b) => a + b, 0);
      return h(
        'div',
        { className: 'dsht-card' },
        h('h3', { className: 'dsht-card-title' }, t('chart.weekday')),
        total === 0
          ? h('div', { className: 'dsht-hint' }, t('chart.none'))
          : h(
              'div',
              { style: { display: 'flex', alignItems: 'flex-end', gap: '6px', height: '80px' } },
              ...counts.map((count, weekday) =>
                h(
                  'div',
                  { key: weekday, style: { flex: '1 1 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' } },
                  h('span', { className: 'dsht-hint', style: { margin: 0 } }, count === 0 ? '' : String(count)),
                  h('span', {
                    style: {
                      width: '100%',
                      height: `${Math.max(2, (count / max) * 52)}px`,
                      borderRadius: '4px',
                      background: count === 0 ? 'var(--dsw-alias-bg-layer-2)' : STATE_ERROR,
                    },
                  }),
                  h('span', { className: 'dsht-hint', style: { margin: 0 } }, t(`weekday.${weekday}`)),
                ),
              ),
            ),
      );
    }

    /** 90 天完成热力图。 */
    function Heatmap({ data, t }) {
      const weeks = Math.ceil(data.length / 7);
      const cell = 11;
      const gap = 2;
      const width = weeks * (cell + gap) + 30;
      const height = 7 * (cell + gap) + 14;
      const max = Math.max(1, ...data.map((d) => d.count));
      // 用同一支绿色 token 的三档不透明度表达强度，避免引用不存在的中间色。
      const shade = (count) => {
        if (count === 0) return { fill: 'var(--dsw-alias-bg-layer-2)', opacity: 1 };
        const step = count / max;
        if (step > 0.66) return { fill: STATE_SUCCESS, opacity: 1 };
        if (step > 0.33) return { fill: STATE_SUCCESS, opacity: 0.6 };
        return { fill: STATE_SUCCESS, opacity: 0.32 };
      };
      const cells = [];
      data.forEach((d, i) => {
        const weekday = new Date(`${d.date}T00:00:00`).getDay();
        // 非法日期（宿主不应产生，但绝不因此画出 NaN 坐标）直接跳过。
        if (!Number.isFinite(weekday)) return;
        const week = Math.floor(i / 7);
        const paint = shade(d.count);
        cells.push(
          h('rect', {
            key: d.date,
            x: 26 + week * (cell + gap),
            y: 4 + weekday * (cell + gap),
            width: cell,
            height: cell,
            rx: 2,
            fill: paint.fill,
            fillOpacity: paint.opacity,
          }, h('title', {}, `${d.date}: ${d.count}`)),
        );
      });
      return h(
        'div',
        { className: 'dsht-card' },
        h('h3', { className: 'dsht-card-title' }, t('chart.heatmap')),
        h('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height: String(height), role: 'img', 'aria-label': t('chart.heatmap') }, ...cells),
      );
    }

    /** 每周完成目标进度环。 */
    function GoalRing({ done, goal, t }) {
      const ratio = goal <= 0 ? 0 : Math.min(1, done / goal);
      const r = 26;
      const c = 2 * Math.PI * r;
      return h(
        'div',
        { className: 'dsht-card' },
        h('h3', { className: 'dsht-card-title' }, t('goal.title')),
        h(
          'div',
          { className: 'dsht-goal' },
          h(
            'svg',
            { width: 68, height: 68, viewBox: '0 0 68 68', role: 'img', 'aria-label': t('goal.progress', { done, goal }) },
            h('circle', { cx: 34, cy: 34, r, fill: 'none', stroke: 'var(--dsw-alias-bg-layer-2)', strokeWidth: 7 }),
            h('circle', {
              cx: 34,
              cy: 34,
              r,
              fill: 'none',
              stroke: ratio >= 1 ? STATE_SUCCESS : BRAND,
              strokeWidth: 7,
              strokeLinecap: 'round',
              strokeDasharray: `${c * ratio} ${c}`,
              transform: 'rotate(-90 34 34)',
            }),
            h('text', { x: 34, y: 39, textAnchor: 'middle', fontSize: 15, fontWeight: 600, fill: 'var(--dsw-alias-label-primary)' }, `${Math.round(ratio * 100)}%`),
          ),
          h(
            'div',
            {},
            h('div', { style: { fontSize: 15, fontWeight: 600 } }, t('goal.progress', { done, goal })),
            h('div', { className: 'dsht-goal-text' }, ratio >= 1 ? t('goal.reached') : t('goal.remaining', { n: Math.max(0, goal - done) })),
          ),
        ),
      );
    }

    /** 规则生成的洞察文案（不调用模型）。 */
    function Insights({ stats, weekGoal, t }) {
      const kpi = stats.kpi;
      const lines = [];
      if (kpi.deltaCompleted > 0) lines.push(t('insight.completedUp', { n: kpi.completed, delta: kpi.deltaCompleted }));
      else if (kpi.deltaCompleted < 0) lines.push(t('insight.completedDown', { n: kpi.completed, delta: -kpi.deltaCompleted }));
      else lines.push(t('insight.completedFlat', { n: kpi.completed }));

      if (kpi.overdue > 0) {
        const top = stats.breakdown.projects[0];
        if (top !== undefined && top.count > 0) lines.push(t('insight.overdue', { n: kpi.overdue, project: top.name, count: top.count }));
        else lines.push(t('insight.overduePlain', { n: kpi.overdue }));
      }

      if (kpi.streak > 0) lines.push(t('insight.streak', { n: kpi.streak }));
      else lines.push(t('insight.streakNone'));

      if (weekGoal > 0) {
        lines.push(kpi.completed >= weekGoal ? t('insight.goalDone') : t('insight.goalLeft', { n: weekGoal - kpi.completed }));
      }

      const worst = stats.weekdayOverdue.indexOf(Math.max(...stats.weekdayOverdue));
      if (stats.weekdayOverdue[worst] > 0) {
        lines.push(t('insight.weekday', { day: WEEKDAY_NAMES[worst], n: stats.weekdayOverdue[worst] }));
      }

      return h(
        'div',
        { className: 'dsht-card' },
        h('h3', { className: 'dsht-card-title' }, t('insights.title')),
        h('ul', { className: 'dsht-insights' }, ...lines.map((line, i) => h('li', { key: i }, line))),
      );
    }

    const RANGES = ['week', 'month', 'last30', 'last90'];

    function Dashboard({ stats, t, weekGoal, range, onRange }) {
      const kpi = stats.kpi;
      const switcher = h(
        'div',
        { className: 'dsht-chips', style: { marginBottom: '6px' } },
        ...RANGES.map((key) =>
          h(
            'button',
            {
              key,
              type: 'button',
              className: cls('dsht-chip', key === range && 'is-due'),
              'aria-pressed': key === range ? 'true' : 'false',
              onClick: () => onRange(key),
            },
            t(`range.${key}`),
          ),
        ),
      );
      if (kpi.active === 0 && kpi.completed === 0) {
        return h(
          'div',
          { className: 'dsht-body' },
          switcher,
          h('p', { className: 'dsht-empty' }, t('empty.dashboard')),
          h('p', { className: 'dsht-hint' }, t('empty.dashboard.hint')),
        );
      }

      const delta =
        kpi.deltaCompleted === 0
          ? t('kpi.deltaFlat')
          : kpi.deltaCompleted > 0
            ? t('kpi.deltaUp', { n: kpi.deltaCompleted })
            : t('kpi.deltaDown', { n: -kpi.deltaCompleted });

      return h(
        'div',
        { className: 'dsht-body' },
        switcher,
        h(
          'div',
          { className: 'dsht-kpis' },
          h(KpiCard, { label: t('kpi.dueToday'), value: kpi.dueToday, tone: kpi.dueToday > 0 ? STATE_WARN : undefined }),
          h(KpiCard, { label: t('kpi.overdue'), value: kpi.overdue, tone: kpi.overdue > 0 ? STATE_ERROR : undefined }),
          h(KpiCard, { label: t('kpi.completed'), value: kpi.completed, delta }),
          h(KpiCard, { label: t('kpi.rate'), value: `${kpi.completionRate}%` }),
          h(KpiCard, { label: t('kpi.streak'), value: t('kpi.days', { n: kpi.streak }) }),
          h(KpiCard, { label: t('kpi.active'), value: kpi.active }),
        ),
        h(Insights, { stats, weekGoal, t }),
        h(GoalRing, { done: kpi.completed, goal: weekGoal, t }),
        h(TrendChart, { data: stats.trend, t }),
        h(
          'div',
          { className: 'dsht-grid2' },
          h(PriorityBar, { priority: stats.priority, t }),
          h(Breakdown, { title: t('chart.breakdown'), buckets: stats.breakdown.projects, t }),
          h(Breakdown, { title: t('chart.labels'), buckets: stats.breakdown.labels, t }),
          h(WeekdayChart, { counts: stats.weekdayOverdue, t }),
        ),
        h(Heatmap, { data: stats.heatmap, t }),
      );
    }

    /** 设置：目标、提醒开关、导入导出。 */
    function SettingsView({ settings, t, dataFile, busy, onSave, onImport, notice }) {
      const [weekGoal, setWeekGoal] = React.useState(String(settings.weekGoal));
      const [importMode, setImportMode] = React.useState('merge');
      const fileRef = React.useRef(null);

      React.useEffect(() => {
        setWeekGoal(String(settings.weekGoal));
      }, [settings.weekGoal]);

      const toggle = (key) => () => onSave({ [key]: !settings[key] });

      return h(
        'div',
        { className: 'dsht-body' },
        h(
          'div',
          { className: 'dsht-settings' },
          notice === null ? null : h('div', { className: 'dsht-card' }, notice),

          h(
            'div',
            { className: 'dsht-setting' },
            h('div', { className: 'dsht-setting-row' },
              h('label', { className: 'dsht-label', htmlFor: 'dsht-weekgoal', style: { flex: '1 1 auto' } }, t('settings.weekGoal')),
              h('input', {
                id: 'dsht-weekgoal',
                type: 'number',
                min: 0,
                max: 999,
                className: 'dsht-input',
                style: { flex: '0 0 90px' },
                value: weekGoal,
                onChange: (event) => setWeekGoal(event.target.value),
                onBlur: () => {
                  const value = Number(weekGoal);
                  if (Number.isFinite(value) && value >= 0) onSave({ weekGoal: value });
                },
              }),
            ),
            h('div', { className: 'dsht-hint' }, t('settings.weekGoalHint')),
          ),

          h(
            'div',
            { className: 'dsht-setting' },
            h('div', { className: 'dsht-setting-row' },
              h('span', { className: 'dsht-label', style: { flex: '1 1 auto' } }, t('settings.remindEnabled')),
              h('button', {
                type: 'button',
                className: 'dsht-switch',
                role: 'switch',
                'aria-checked': settings.remindEnabled ? 'true' : 'false',
                'aria-label': t('settings.remindEnabled'),
                disabled: busy,
                onClick: toggle('remindEnabled'),
              }),
            ),
            h('div', { className: 'dsht-hint' }, t('settings.remindEnabledHint')),
          ),

          h(
            'div',
            { className: 'dsht-setting' },
            h('div', { className: 'dsht-label' }, t('settings.data')),
            h('div', { className: 'dsht-hint' }, t('settings.dataFile', { path: dataFile })),
            h(
              'div',
              { className: 'dsht-chips', style: { marginTop: '10px' } },
              h('a', { className: 'dsht-ghost', href: `${API}/export/download`, download: '' }, t('settings.export')),
              h('a', { className: 'dsht-ghost', href: `${API}/export/markdown`, download: '' }, t('settings.exportMarkdown')),
            ),
            h('div', { className: 'dsht-hint' }, t('settings.exportHint')),
            h('div', { className: 'dsht-hint' }, t('settings.exportMarkdownHint')),
            h('div', { className: 'dsht-chips', style: { marginTop: '12px' } },
              h('select', {
                className: 'dsht-select',
                value: importMode,
                onChange: (event) => setImportMode(event.target.value),
                'aria-label': t('import.mode'),
              },
                h('option', { value: 'merge' }, t('import.merge')),
                h('option', { value: 'replace' }, t('import.replace')),
              ),
              h(
                'button',
                { type: 'button', className: 'dsht-ghost', disabled: busy, onClick: () => fileRef.current?.click() },
                t('settings.import'),
              ),
              h('input', {
                ref: fileRef,
                type: 'file',
                accept: 'application/json,.json',
                style: { display: 'none' },
                onChange: (event) => {
                  const file = event.target.files?.[0];
                  if (file === undefined) return;
                  const reader = new FileReader();
                  reader.onload = () => onImport(String(reader.result ?? ''), importMode);
                  reader.readAsText(file);
                  event.target.value = '';
                },
              }),
            ),
            h('div', { className: 'dsht-hint' }, t('settings.importHint')),
          ),
        ),
      );
    }

    /** 到点提醒：注册到 shell.overlay 的全局浮层。 */
    function ReminderOverlay({ t }) {
      const [items, setItems] = React.useState([]);
      const dismissed = React.useRef(new Set());

      React.useEffect(() => {
        let alive = true;
        let timer = null;
        const poll = async () => {
          try {
            const value = await api.due();
            if (!alive) return;
            setItems(Array.isArray(value.items) ? value.items : []);
          } catch {
            /* 宿主不可用时静默：提醒失败不该打扰用户 */
          }
        };
        poll();
        timer = setInterval(poll, 60_000);
        return () => {
          alive = false;
          if (timer !== null) clearInterval(timer);
        };
      }, []);

      const pending = items.filter((item) => !dismissed.current.has(item.id));
      if (pending.length === 0) return null;
      const head = pending[0];

      const act = async (fn) => {
        dismissed.current.add(head.id);
        setItems(items.filter((item) => item.id !== head.id));
        try {
          await fn();
        } catch {
          /* 失败时下一次轮询会重新提示 */
        }
      };

      const meta = head.overdue
        ? t('reminder.overdue', { days: head.overdueDays })
        : t('reminder.dueNow');

      return h(
        'div',
        { className: 'dsht-toast', role: 'status' },
        h('div', { className: 'dsht-toast-title' }, t('reminder.title')),
        h('div', { className: 'dsht-toast-task' }, head.title),
        h('div', { className: 'dsht-toast-meta' }, pending.length > 1 ? `${meta} · ${t('reminder.more', { n: pending.length - 1 })}` : meta),
        h(
          'div',
          { className: 'dsht-toast-actions' },
          h('button', { type: 'button', className: 'dsht-primary', onClick: () => act(() => api.complete([head.id], true)) }, t('reminder.complete')),
          h(
            'button',
            {
              type: 'button',
              className: 'dsht-ghost',
              onClick: () => act(() => api.update([{ id: head.id, dueDate: head.dueDate === '' ? null : addDays(head.dueDate, 1) }])),
            },
            t('reminder.snooze'),
          ),
          h('button', { type: 'button', className: 'dsht-ghost', onClick: () => act(async () => {}) }, t('reminder.dismiss')),
        ),
      );
    }

    // -------------------------------------------------------------- 主面板

    const VIEWS = [
      { id: 'today', label: 'nav.today' },
      { id: 'upcoming', label: 'nav.upcoming' },
      { id: 'inbox', label: 'nav.inbox' },
      { id: 'dashboard', label: 'nav.dashboard' },
      { id: 'done', label: 'nav.done' },
      { id: 'trash', label: 'nav.trash' },
    ];

    const SORTS = ['due', 'manual', 'priority'];

    function TodosPanel({ t }) {
      const [state, setState] = React.useState({ status: 'loading' });
      const [view, setView] = React.useState({ kind: 'today' });
      const [sortMode, setSortMode] = React.useState('due');
      const [draft, setDraft] = React.useState('');
      const [preview, setPreview] = React.useState(null);
      const [query, setQuery] = React.useState('');
      const [editing, setEditing] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [stats, setStats] = React.useState(null);
      const [range, setRange] = React.useState('last30');
      const [errors, setErrors] = React.useState([]);
      const [notice, setNotice] = React.useState(null);
      const [dragId, setDragId] = React.useState(null);
      const [dragOverId, setDragOverId] = React.useState(null);

      const load = React.useCallback(async () => {
        try {
          const value = await api.snapshot();
          setState({ status: 'ready', data: value });
          setStats(value.stats ?? null);
        } catch (error) {
          setState({ status: 'failed', error: String(error?.message ?? error) });
        }
      }, []);

      React.useEffect(() => {
        load();
      }, [load]);

      const reloadStats = React.useCallback(async (next) => {
        setRange(next);
        if (next === 'last30') return;
        try {
          setStats(await api.stats(next));
        } catch (error) {
          setErrors([String(error?.message ?? error)]);
        }
      }, []);

      // 快速添加预览：输入停顿 250ms 后问宿主怎么解析。
      React.useEffect(() => {
        const text = draft.trim();
        if (text === '') {
          setPreview(null);
          return undefined;
        }
        let alive = true;
        const timer = setTimeout(async () => {
          try {
            const parsed = await api.parse(text);
            if (alive) setPreview(parsed);
          } catch {
            if (alive) setPreview(null);
          }
        }, 250);
        return () => {
          alive = false;
          clearTimeout(timer);
        };
      }, [draft]);

      const run = React.useCallback(
        async (label, fn) => {
          setBusy(true);
          setErrors([]);
          try {
            await fn();
            await load();
          } catch (error) {
            setErrors([`${label}: ${String(error?.message ?? error)}`]);
          } finally {
            setBusy(false);
          }
        },
        [load],
      );

      const data = state.status === 'ready' ? state.data : null;
      const today = data?.today ?? new Date().toISOString().slice(0, 10);
      const projectName = new Map((data?.projects ?? []).map((p) => [p.id, p.name]));
      const labelNames = new Map((data?.labels ?? []).map((l) => [l.id, l.name]));

      const tasks = data?.tasks ?? [];
      const open = tasks.filter((task) => task.deletedAt === null && !task.completed);
      const horizon = addDays(today, 30);

      let visible = [];
      let heading = t('nav.today');
      let emptyText = t('empty.today');

      if (view.kind === 'today') {
        visible = open.filter((task) => task.dueDate !== null && task.dueDate <= today);
      } else if (view.kind === 'upcoming') {
        visible = open.filter((task) => task.dueDate !== null && task.dueDate > today && task.dueDate <= horizon);
        emptyText = t('empty.upcoming');
      } else if (view.kind === 'inbox') {
        visible = open.filter((task) => task.dueDate === null);
        emptyText = t('empty.inbox');
      } else if (view.kind === 'project') {
        visible = open.filter((task) => task.projectId === view.id);
        heading = projectName.get(view.id) ?? t('nav.projects');
        emptyText = t('empty.project', { name: heading });
      } else if (view.kind === 'label') {
        visible = open.filter((task) => task.labelIds.includes(view.id));
        heading = `@${labelNames.get(view.id) ?? ''}`;
        emptyText = t('empty.label', { name: labelNames.get(view.id) ?? '' });
      } else if (view.kind === 'done') {
        visible = tasks
          .filter((task) => task.deletedAt === null && task.completed)
          .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
        heading = t('nav.done');
        emptyText = t('empty.done');
      } else if (view.kind === 'trash') {
        visible = tasks.filter((task) => task.deletedAt !== null).sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
        heading = t('nav.trash');
        emptyText = t('empty.trash');
      } else if (view.kind === 'dashboard') {
        heading = t('nav.dashboard');
      } else if (view.kind === 'settings') {
        heading = t('nav.settings');
      }

      // 搜索：在所有任务里匹配标题/备注，并保留匹配项的父任务。
      const needle = query.trim().toLowerCase();
      if (needle !== '' && view.kind !== 'dashboard' && view.kind !== 'settings') {
        const matched = tasks.filter(
          (task) =>
            task.deletedAt === null &&
            (task.title.toLowerCase().includes(needle) || task.note.toLowerCase().includes(needle)),
        );
        const ids = new Set(matched.map((task) => task.id));
        for (const task of matched) {
          if (task.parentId !== null && !ids.has(task.parentId)) {
            const parent = tasks.find((candidate) => candidate.id === task.parentId);
            if (parent !== undefined) matched.push(parent);
          }
        }
        visible = view.kind === 'done' ? matched : matched.filter((task) => !task.completed);
        if (view.kind === 'trash') visible = matched;
        emptyText = t('empty.search', { query: query.trim() });
      }

      visible = sortFor(view.kind === 'done' || view.kind === 'trash' ? 'due' : sortMode, visible);

      // 子任务：把可见任务的子任务挂到父任务下面展示。
      const visibleIds = new Set(visible.map((task) => task.id));
      const childrenByParent = new Map();
      for (const task of tasks) {
        if (task.deletedAt !== null || task.parentId === null) continue;
        const list = childrenByParent.get(task.parentId) ?? [];
        list.push(task);
        childrenByParent.set(task.parentId, list);
      }
      const roots = visible.filter((task) => task.parentId === null || !visibleIds.has(task.parentId));
      const searchMode = needle !== '';

      const counts = data?.counts ?? { today: 0, upcoming: 0, inbox: 0, done: 0, trash: 0, byProject: {}, byLabel: {} };
      const projects = data?.projects ?? [];
      const labels = data?.labels ?? [];

      // ------------------------------------------------------------ 动作

      const submitDraft = async () => {
        const text = draft.trim();
        if (text === '') return;
        setDraft('');
        setPreview(null);
        await run(t('quick.add'), async () => {
          const value = await api.quickAdd([text]);
          const first = value.results[0];
          // 在当前项目/标签视图里补上归属，免得新任务“消失”。
          const extra = {};
          if (view.kind === 'project' && first.task.projectId === null) extra.projectId = view.id;
          if (view.kind === 'label') extra.labelIds = [view.id];
          if (Object.keys(extra).length > 0) {
            await api.update([{ id: first.task.id, ...extra }]);
          }
        });
      };

      const toggle = (task) => run(t('task.complete'), () => api.complete([task.id], !task.completed));
      const remove = (task) => run(t('task.delete'), () => api.remove([task.id]));
      const restore = (task) => run(t('task.restore'), () => api.restore([task.id]));
      const purge = (task) => run(t('task.purge'), () => api.purge([task.id]));

      /** 子任务必须带 parentId，走结构化创建接口（快速添加不认 parentId）。 */
      const addChild = (parentId, title) =>
        run(t('task.addSubtask'), async () => {
          await request('/tasks/create', json({ items: [{ title, parentId }] }));
        });

      const reorder = (draggedId, targetId) => {
        const target = tasks.find((task) => task.id === targetId);
        if (target === undefined) return undefined;
        return run(t('sort.manual'), () => api.update([{ id: draggedId, order: target.order - 0.5 }]));
      };

      const saveSettings = (patch) => run(t('settings.saved'), () => api.saveSettings(patch));

      const doImport = async (text, mode) => {
        if (mode === 'replace' && typeof window !== 'undefined' && !window.confirm(t('import.confirm'))) return;
        let payload = null;
        try {
          payload = JSON.parse(text);
        } catch (error) {
          setNotice(t('import.failed', { error: String(error?.message ?? error) }));
          return;
        }
        await run(t('settings.import'), async () => {
          const value = await api.importState(payload, mode);
          setNotice(t('import.done', { tasks: value.tasks, projects: value.projects, labels: value.labels }));
        });
      };

      // ---------------------------------------------------------- 侧边栏

      const navRow = (entry) =>
        h(NavRow, {
          key: entry.id,
          active: view.kind === entry.id,
          label: t(entry.label),
          count:
            entry.id === 'today'
              ? counts.today
              : entry.id === 'upcoming'
                ? counts.upcoming
                : entry.id === 'inbox'
                  ? counts.inbox
                  : entry.id === 'done'
                    ? counts.done
                    : entry.id === 'trash'
                      ? counts.trash
                      : undefined,
          onClick: () => {
            setEditing(null);
            setNotice(null);
            setView({ kind: entry.id });
          },
        });

      const entityRow = (kind, entity, count) =>
        h(NavRow, {
          key: entity.id,
          active: view.kind === kind && view.id === entity.id,
          label: kind === 'label' ? `@${entity.name}` : entity.name,
          count,
          color: kind === 'project' ? BRAND : undefined,
          onClick: () => {
            setEditing(null);
            setView({ kind, id: entity.id });
          },
          actions: h(React.Fragment, null,
            h(
              'button',
              {
                type: 'button',
                className: 'dsht-icon',
                title: t('projects.rename'),
                'aria-label': t('projects.rename'),
                onClick: (event) => {
                  event.stopPropagation();
                  const next = typeof window === 'undefined' ? null : window.prompt(t('projects.rename'), entity.name);
                  if (next === null || next.trim() === '' || next === entity.name) return;
                  run(t('projects.rename'), () =>
                    kind === 'project' ? api.saveProject({ id: entity.id, name: next.trim() }) : api.saveLabel({ id: entity.id, name: next.trim() }),
                  );
                },
              },
              h(IconPencil, { size: 13 }),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsht-icon is-danger',
                title: t('task.delete'),
                'aria-label': t('task.delete'),
                onClick: (event) => {
                  event.stopPropagation();
                  const detail = t(kind === 'project' ? 'row.delete.detail.project' : 'row.delete.detail.label');
                  const ok = typeof window === 'undefined' ? true : window.confirm(t('row.delete.confirm', { name: entity.name, detail }));
                  if (!ok) return;
                  run(t('task.delete'), () =>
                    kind === 'project' ? api.deleteProject(entity.id) : api.deleteLabel(entity.id),
                  ).then(() => {
                    if (view.kind === kind && view.id === entity.id) setView({ kind: 'inbox' });
                  });
                },
              },
              h(IconTrash, { size: 13 }),
            ),
          ),
        });

      const sidebar = h(
        'div',
        { className: 'dsht-side' },
        h('div', { className: 'dsht-sidegroup' }, t('group.views')),
        ...VIEWS.map(navRow),
        h('div', { className: 'dsht-sidegroup' }, t('group.projects')),
        ...projects.map((project) => entityRow('project', project, counts.byProject?.[project.id] ?? 0)),
        h(ProjectCreate, { t, onCreate: (name) => run(t('projects.new'), () => api.saveProject({ name })) }),
        labels.length === 0 ? null : h('div', { className: 'dsht-sidegroup' }, t('group.labels')),
        ...labels.map((label) => entityRow('label', label, counts.byLabel?.[label.id] ?? 0)),
        h(ProjectCreate, {
          t,
          placeholder: t('labels.namePlaceholder'),
          action: t('labels.new'),
          onCreate: (name) => run(t('labels.new'), () => api.saveLabel({ name })),
        }),
        h('div', { style: { flex: '1 1 auto' } }),
        h(NavRow, {
          active: view.kind === 'settings',
          label: t('nav.settings'),
          onClick: () => {
            setEditing(null);
            setView({ kind: 'settings' });
          },
        }),
      );

      // ------------------------------------------------------------ 任务行

      const renderRow = (task, depth, subtasks) => {
        const rows = [];
        const doneCount = subtasks.filter((child) => child.completed).length;
        rows.push(
          h(TaskRow, {
            key: task.id,
            task,
            today,
            t,
            depth,
            projectName: task.projectId === null ? undefined : projectName.get(task.projectId),
            labelNames,
            busy,
            subtaskCount: subtasks.length,
            subtaskDone: doneCount,
            draggable: sortMode === 'manual' && !task.completed && depth === 0,
            dragOver: dragOverId === task.id,
            handlers: {
              onDragStart: () => setDragId(task.id),
              onDragOver: (event) => {
                if (dragId === null || dragId === task.id) return;
                event.preventDefault();
                setDragOverId(task.id);
              },
              onDragLeave: () => setDragOverId((current) => (current === task.id ? null : current)),
              onDrop: (event) => {
                event.preventDefault();
                setDragOverId(null);
                if (dragId !== null && dragId !== task.id) reorder(dragId, task.id);
                setDragId(null);
              },
              onDragEnd: () => {
                setDragId(null);
                setDragOverId(null);
              },
            },
            onToggle: toggle,
            onEdit: (target) => setEditing(target.id),
            onDelete: remove,
            onRestore: restore,
            onPurge: purge,
            onAddSubtask: (target) => setEditing(`${target.id}:sub`),
          }),
        );
        if (editing === task.id) {
          rows.push(
            h(TaskEditor, {
              key: `${task.id}-editor`,
              task,
              projects,
              labels,
              subtasks,
              t,
              onCancel: () => setEditing(null),
              onAddSubtask: addChild,
              onSave: async (patch) => {
                setEditing(null);
                await run(t('editor.save'), () => api.update([{ id: task.id, ...patch }]));
              },
            }),
          );
        } else if (editing === `${task.id}:sub`) {
          rows.push(
            h(NewSubtask, {
              key: `${task.id}-sub`,
              t,
              onCancel: () => setEditing(null),
              onSubmit: async (title) => {
                setEditing(null);
                await addChild(task.id, title);
              },
            }),
          );
        }
        for (const child of subtasks) rows.push(...renderRow(child, depth + 1, []));
        return rows;
      };

      const canQuickAdd = view.kind !== 'dashboard' && view.kind !== 'settings' && view.kind !== 'done' && view.kind !== 'trash';

      const body =
        state.status === 'loading'
          ? h('div', { className: 'dsht-body' }, h('p', { className: 'dsht-empty' }, t('state.loading')))
          : state.status === 'failed'
            ? h(
                'div',
                { className: 'dsht-body' },
                h(
                  'div',
                  { className: 'dsht-error' },
                  h('span', {}, t('state.failed', { error: state.error })),
                  h('button', { type: 'button', className: 'dsht-ghost', onClick: load }, t('state.retry')),
                ),
              )
            : view.kind === 'dashboard'
              ? stats === null
                ? h('div', { className: 'dsht-body' }, h('p', { className: 'dsht-empty' }, t('empty.dashboard')))
                : h(Dashboard, { stats, t, weekGoal: data.settings.weekGoal, range, onRange: reloadStats })
              : view.kind === 'settings'
                ? h(SettingsView, {
                    settings: data.settings,
                    t,
                    dataFile: data.dataFile,
                    busy,
                    notice,
                    onSave: saveSettings,
                    onImport: doImport,
                  })
                : h(
                    'div',
                    { className: 'dsht-body' },
                    ...errors.map((message, i) => h('div', { key: i, className: 'dsht-error' }, h('span', {}, message))),
                    view.kind === 'trash' && visible.length > 0
                      ? h(
                          'div',
                          { className: 'dsht-chips', style: { marginBottom: '8px' } },
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'dsht-ghost',
                              onClick: () => {
                                const ok = typeof window === 'undefined' ? true : window.confirm(t('trash.purgeAllConfirm'));
                                if (ok) run(t('trash.purgeAll'), () => api.purge([]));
                              },
                            },
                            t('trash.purgeAll'),
                          ),
                        )
                      : null,
                    roots.length === 0 && editing === null ? h('p', { className: 'dsht-empty' }, emptyText) : null,
                    ...roots.flatMap((task) => {
                      const children = (childrenByParent.get(task.id) ?? []).filter(
                        (child) => !child.completed || view.kind === 'done' || searchMode,
                      );
                      return renderRow(task, 0, children);
                    }),
                  );

      return h(
        'div',
        { className: 'dsht-root' },
        sidebar,
        h(
          'div',
          { className: 'dsht-main' },
          h(
            'header',
            { className: 'dsht-header' },
            h('h1', { className: 'dsht-title' }, heading),
            h('div', { className: 'dsht-header-spacer' }),
            busy ? h('span', { className: 'dsht-hint' }, t('state.saving')) : null,
            view.kind === 'dashboard' || view.kind === 'settings'
              ? null
              : h(
                  'select',
                  {
                    className: 'dsht-select',
                    value: sortMode,
                    'aria-label': t('sort.label'),
                    onChange: (event) => setSortMode(event.target.value),
                  },
                  ...SORTS.map((mode) => h('option', { key: mode, value: mode }, t(`sort.${mode}`))),
                ),
            view.kind === 'dashboard' || view.kind === 'settings'
              ? null
              : h('input', {
                  className: 'dsht-input dsht-search',
                  placeholder: t('search.placeholder'),
                  value: query,
                  onChange: (event) => setQuery(event.target.value),
                }),
          ),
          canQuickAdd
            ? h(
                'div',
                { className: 'dsht-quick' },
                h(
                  'div',
                  { className: 'dsht-quickrow' },
                  h('input', {
                    className: 'dsht-input',
                    placeholder: t('quick.placeholder'),
                    value: draft,
                    disabled: busy,
                    onChange: (event) => setDraft(event.target.value),
                    onKeyDown: (event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        submitDraft();
                      }
                    },
                  }),
                  h('button', { type: 'button', className: 'dsht-primary', disabled: busy || draft.trim() === '', onClick: submitDraft }, t('quick.add')),
                ),
                preview === null
                  ? null
                  : h(
                      'div',
                      { className: 'dsht-hint' },
                      (() => {
                        const parts = describeParsed(preview, t);
                        return parts.length === 0
                          ? `${t('quick.titleOnly')}：${preview.title}`
                          : `${t('quick.understood', { parts: parts.join(' · ') })} → ${preview.title}`;
                      })(),
                    ),
              )
            : null,
          body,
        ),
      );
    }

    /** 新建子任务的内联输入。 */
    function NewSubtask({ t, onSubmit, onCancel }) {
      const [title, setTitle] = React.useState('');
      return h(
        'div',
        { className: 'dsht-inline-form', style: { paddingLeft: '48px' } },
        h('input', {
          className: 'dsht-input',
          placeholder: t('subtask.placeholder'),
          value: title,
          autoFocus: true,
          onChange: (event) => setTitle(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Escape') onCancel();
            if (event.key !== 'Enter') return;
            event.preventDefault();
            const value = title.trim();
            if (value === '') return;
            onSubmit(value);
          },
          onBlur: () => {
            if (title.trim() === '') onCancel();
          },
        }),
      );
    }

    /** 「新建项目 / 新建标签」的小内联表单。 */
    function ProjectCreate({ t, onCreate, placeholder, action }) {
      const [open, setOpen] = React.useState(false);
      const [name, setName] = React.useState('');
      if (!open) {
        return h(
          'button',
          { type: 'button', className: 'dsht-navrow', onClick: () => setOpen(true) },
          h('span', { className: 'dsht-navrow-label', style: { color: 'var(--dsw-alias-label-tertiary)' } }, action ?? t('projects.new')),
        );
      }
      return h(
        'form',
        {
          className: 'dsht-inline-form',
          onSubmit: (event) => {
            event.preventDefault();
            const value = name.trim();
            if (value === '') return;
            setName('');
            setOpen(false);
            onCreate(value);
          },
        },
        h('input', {
          className: 'dsht-input',
          placeholder: placeholder ?? t('projects.namePlaceholder'),
          value: name,
          autoFocus: true,
          onChange: (event) => setName(event.target.value),
          onBlur: () => {
            if (name.trim() === '') setOpen(false);
          },
        }),
      );
    }

    // ------------------------------------------------------------ 插件装配

    return {
      // 客户端**服务名**依赖（与 package.json 的 dsh.client.inject 不同，后者是包 id 排序）。
      inject: ['slots', 'locale'],

      apply(ctx) {
        ctx.effect(installStyles, 'dsh-todos: styles');
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-todos: dictionaries');
        const t = ctx.locale.bind(NS);

        // 侧边栏「全局面板图标」：id 必须与下面 main 的 key 相同，
        // shell 才能把点击接到这个面板上。
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: 'todos', order: 30, label: () => t('entry.label') },
            TodosGlyph,
          ),
        );

        // 中央主面板：root 作用域的 keyed slot，按侧边栏条目 id 分发。
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'todos', locale: NS }, TodosPanel),
        );

        // 到点提醒：帧级浮层，与当前选中的面板无关。
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            { name: 'shell.overlay', id: 'todos-reminder', order: 60, locale: NS },
            ReminderOverlay,
          ),
        );
      },
    };
  },
});
