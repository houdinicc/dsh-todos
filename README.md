# 待办中心（`dsh-todos`）

一个 DeepSeek Harness 插件：类 Todoist 的待办管理 + 仪表盘，挂在 DSH Web GUI 的
侧边栏与主面板上，并把待办**开放给 Agent**（DeepSeek 能直接读写你的待办）。

- 侧边栏「待办」图标 → 主面板整页 UI（今天 / 即将到来 / 收件箱 / 仪表盘 / 已完成 / 回收站 / 设置）
- 自然语言快速添加：`明天下午3点 交报告 #Q4汇报 @写作 p1`
- 仪表盘：6 个 KPI、完成/新增趋势、优先级与项目/标签分布、90 天热力图、每周目标、规则生成的洞察
- 到点提醒：官方的 `shell.overlay` 全局浮层，可一键完成 / 推迟到明天
- Agent 工具：`todos_list` / `todos_create` / `todos_update` / `todos_complete` / `todos_delete` / `todos_stats` / `todos_projects`
- 导入导出：JSON 整库备份 + Markdown 清单

## 安装

**给别人用**：让 TA 打开 设置 → 插件 → **插件市场**，搜 `dsh-todos`（需先装 `dshmarket`），
或让 TA 的 Agent 执行下面的 `install_bundle`。**完整的三种分发渠道见 [PUBLISHING.md](PUBLISHING.md)。**

**本机开发安装**：用 `plugin_manager` 工具（或 Web 的 Plugins 页）指向本目录：

```
plugin_manager install_bundle target=<本目录的绝对路径>
```

读返回值的 `application` 与 `warnings` 判断是否真的生效——不要靠日志或页面 boot payload。
全新安装需要用 `cordis_inspect_query`（host `Config.listConfigs`、client `Slots.listSubTree`）复核。

> ⚠️ **改包名必须同时改三处，漏一处 DSH 就会加载失败**：`package.json` 的 `name`、
> 客户端 bundle 自注册的 `id`（`lib/client.js` 里的 `window.__ModuleLoader__.load({ id })`）、
> 以及 profile 里的依赖与 `dsh.profile.bundles` 条目（后两处只能靠**卸载再重装**更新）。
> loader 要求 bundle 的 `id` 与条目名完全一致，不一致时报
> `loaded without registering "…" via __ModuleLoader__.load`。
> `scripts/preflight.mjs` 会替你检查前两处，但它**不会**替你重装。

安装后，本 bundle 的 `cordis.patch.yml` 会插入插件行 `id: todos`
（`config` 里可调 `weekGoal` / `remindEnabled` / `dailyDigest`）。

## 目录

```
package.json          清单：dsh.bundle.patch + dsh.client(platform=web) + exports["./client"]
cordis.patch.yml      本 bundle 贡献的配置层（只插入插件行；分发文件，不含本机路径）
icon.svg              插件卡片图标
LICENSE               许可证
PUBLISHING.md         分发指南：npm / git-tarball / 社区目录上架
locale/{en,zh}.json   插件在 Plugins 页的显示名与描述
lib/index.js          宿主半入口：apply(ctx, config)
lib/store.js          数据层：单文件 JSON 持久化 + 规范化 + 迁移钩子
lib/select.js         派生视图：侧边栏计数、仪表盘统计（纯函数）
lib/quickadd.js       自然语言解析（纯函数，中英双语语法）
lib/actions.js        界面与工具共用的写动作 + Markdown 渲染
lib/tools.js          七个 todos_* Agent 工具（原始 JSON Schema，零 import）
lib/routes.js         Web GUI 的 HTTP 路由 + 回环信任围栏
lib/remind.js         到点提醒的判定（纯函数）
lib/client.js         客户端半：手写的 window.__ModuleLoader__ bundle（唯一构建产物）
scripts/preflight.mjs 发布前自检（npm pack/publish 自动跑）
test/                 四套测试，见下
dev/                  开发期可选配置（不随插件分发）
```

## 设计取舍（为什么长这样）

**零依赖、零 `import`。** 宿主半不 `import` 任何 `@deepseek-ai/*` 包，客户端半只
`require('react')`（平台冻结模块表里的）。因此这个包没有 `dependencies`、
没有 `peerDependencies`、不需要构建工具链，也不会因为 DSH 升级而链接失败。
代价是数据层自己写（`store.js`），而不是用 `ctx.storageDomain`。

**数据是单个 JSON 文件。** 落在 `$DSH_HOME/dsh-todos/todos.json`，写入是「临时文件 +
rename」的原子替换，读坏时先备份现场再重开。单文件让「整库导出/导入」退化成一次文件拷贝。

**提醒不往会话里注入消息。** 宿主确实可以 `agent.inject()` / `agent.followup()` 把提醒
塞进会话，但那会让模型在没有用户输入的情况下自己发起一轮。改为渲染到官方
`shell.overlay` 浮层：DSH 开着就能看到，一键完成或推迟，不产生模型开销。

**客户端 bundle 是手写的，没有构建步骤。** 产物格式是
`window.__ModuleLoader__.load({ id, factory })`，用 `React.createElement` 而不是 JSX。
主机端的客户端 HMR 每 500ms 轮询 bundle 的 mtime/ctime/size，所以改
`lib/client.js` 即时生效、不必重启。

**样式只引用真实存在的主题 token——这一条会咬人。** 主题包
（`@deepseek-ai/dsh-client-ui-theme`）只**声明** token（400 多个），真实定义在 shell
的样式表里，而 shell 只定义了 **95 个**。引用一个不存在的 token 不会报错：那条声明
静默失效并回退继承，于是可能得到「浅底浅字」这种完全看不见的按钮（本项目真的踩过）。
所以：

- 用 `test/theme-tokens.json`（从 shell CSS 抽出的真实名单）当唯一依据；
- `test/client-render.mjs` 会扫描 `lib/client.js` 里所有 `var(--dsw-*)` 引用并逐个比对，
  引用不存在的 token 直接让测试失败；
- 拿不准某个控件该怎么配色时，去 shell CSS 里搜宿主自己的同名控件（例如
  `--dsw-alias-button-primary-fill` + `--dsw-alias-label-primary-foreground` 就是宿主
  主按钮的固定搭配），照抄它的 token 组合最稳。

## 开发

客户端半（`lib/client.js`）**天生是热的**：`dsh-client-hmr` 每 500ms 轮询每个 bundle 的
mtime/ctime/size，改完约 1 秒生效，不用重启、不用刷新。

宿主半（`lib/*.js`）是 ESM，Node 按 URL 永久缓存模块，而 `plugin_manager` 的
disable/enable 只重挂 loader 行、不会重新 import —— 所以**默认改一行就要重启整个 DSH**。
想让宿主半也热起来，把 `dev/cordis.patch.dev.yml` 那段追加到**你自己的 profile 补丁层**
（`$DSH_HOME/profiles/<profile>/cordis.patch.yml`）并改成你的检出路径，重启一次即可。
那一段刻意不放在插件自己的 `cordis.patch.yml` 里：那是要分发给别人的文件，
写死某个人的本机绝对路径没有意义。

**改 `package.json`、改包名、或替换已安装的包，一定需要重启 DSH。**

### 测试

```bash
node test/quickadd.mjs      # 自然语言解析：26 例
node test/smoke.mjs         # 数据层 + 路由处理函数（假 req/res）：25 例
node test/tools.mjs         # 七个 Agent 工具：19 例
node test/client-render.mjs # jsdom + 真实 React 渲染客户端半：49 例
node scripts/preflight.mjs  # 发布前自检（不跑测试，只查分发契约）
```

前三套零依赖。第四套需要 jsdom 与 React，装在插件包**之外**的
`../dsh-todos-dev/`（插件本身保持零依赖）：

```bash
cd ../dsh-todos-dev && pnpm install
```

`client-render.mjs` 会真的把面板渲染进 jsdom、真的点击、断言发出的 HTTP 请求——
「面板点开是空白」这类问题因此能在本地抓到，而不必靠目视。

## 数据与口径

- 所有日期按**本地时区**的 `YYYY-MM-DD`；全天任务视为当天 00:00 到期。
- 侧边栏计数只统计未完成、未删除的任务。
- 完成率 = 本期完成 ÷ (本期完成 + 本期新增)，口径在仪表盘的 KPI 上方可切换范围。
- 连续完成天数从今天（或昨天）往前数，只要当天有完成记录就连续。
- 回收站保留 30 天，插件每次激活时清理过期内容。
