/**
 * 待办中心（dsh-todos）—— 宿主半入口。
 *
 * 本文件不 import 任何 `@deepseek-ai/*` 包：数据与路由都是插件自管的。
 * 可选服务用 `ctx.inject([...], cb)` 声明，缺了它的 profile 里插件只是
 * 少一块能力，而不是抛错。
 *
 * @module dsh-todos
 */

import { createStore, resolveDataDir } from './store.js';
import { createRoutes } from './routes.js';
import { createTools } from './tools.js';

/** profile 的 cordis.patch.yml 未给 config 时的缺省值。 */
const DEFAULT_CONFIG = {
  remindEnabled: true,
  weekGoal: 15,
  dailyDigest: false,
};

/**
 * 插件入口。
 *
 * @param {object} ctx - Cordis 上下文。
 * @param {object} [config] - patch 行的 `config:` 对象。
 */
export function apply(ctx, config) {
  const resolved = { ...DEFAULT_CONFIG, ...(config ?? {}) };

  const store = createStore({
    dir: resolveDataDir(),
    defaults: {
      weekGoal: resolved.weekGoal,
      remindEnabled: resolved.remindEnabled,
      dailyDigest: resolved.dailyDigest,
    },
  });
  // 清掉超过保留期的回收站内容；没有可清的就不落盘。
  store.sweepTrash();

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => {
      const routes = createRoutes(store);
      const disposers = routes.map((route) => webCtx.webServer.register(route));
      webCtx.logger?.info?.(`dsh-todos: 已注册 ${disposers.length} 条路由`);
      return () => {
        for (const dispose of disposers) dispose();
      };
    }, 'dsh-todos: web routes');
  });

  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.effect(() => {
      const definitions = createTools(store, resolved);
      const disposers = definitions.map((definition) => toolCtx.tools.register(definition));
      toolCtx.logger?.info?.(
        `dsh-todos: 已注册 ${definitions.length} 个 Agent 工具（${definitions.map((d) => d.name).join(', ')}）`,
      );
      return () => {
        for (const dispose of disposers) if (typeof dispose === 'function') dispose();
      };
    }, 'dsh-todos: agent tools');
  });

  ctx.logger?.info?.(`dsh-todos: 宿主半已激活（数据文件 ${store.file}）`);
}
