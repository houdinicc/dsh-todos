/**
 * 待办中心 —— Web GUI 的 HTTP 路由。
 *
 * 客户端半用**文档相对路径** `fetch('api/dsh-todos/...')` 调这里
 * （GUI 用 `<base href="./">`，根绝对路径会在子路径部署下逃出前缀）。
 * 注册时相反，必须是带前导斜杠的绝对路径。
 *
 * 安全：所有路由都过 `isLoopbackRequest` —— 只接受本机回环连接、
 * 回环 Host 头、且非 cross-site 的请求。
 *
 * @module dsh-todos/routes
 */

import { StoreError, localDateKey } from './store.js';
import { deriveCounts, computeStats } from './select.js';
import { quickAdd, renderMarkdown } from './actions.js';
import { parseQuickAdd } from './quickadd.js';
import { dueNotifications } from './remind.js';

const ROUTE_PREFIX = '/api/dsh-todos';
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** 只有本机页面能调这些路由。 */
export function isLoopbackRequest(req) {
  const address = req.socket?.remoteAddress ?? '';
  const loopback =
    address === '::1' ||
    address.startsWith('127.') ||
    address.startsWith('::ffff:127.');
  if (!loopback) return false;

  let hostname;
  try {
    hostname = new URL(`http://${req.headers.host ?? ''}`).hostname;
  } catch {
    return false;
  }
  if (!(hostname === 'localhost' || hostname === '[::1]' || /^127\./.test(hostname))) return false;

  return req.headers['sec-fetch-site'] !== 'cross-site';
}

function writeJson(res, status, body) {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(text);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new StoreError('payload-too-large', '请求体过大');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new StoreError('invalid-json', '请求体不是合法 JSON');
  }
}

/**
 * 组装路由表。
 *
 * @param {object} store - `createStore()` 的产物。
 * @param {object} [options]
 * @param {() => string} [options.today] 便于测试注入的「今天」。
 * @returns {Array<{kind:'exact',path:string,handler:Function}>}
 */
export function createRoutes(store, options = {}) {
  const today = options.today ?? (() => new Date());

  /** 把一个处理函数包成 WebRoute：围栏 → 方法校验 → JSON 信封 → 错误归一。 */
  function endpoint(method, path, handle) {
    return {
      kind: 'exact',
      path: `${ROUTE_PREFIX}${path}`,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) {
          writeJson(res, 403, { error: { code: 'forbidden', message: '只允许本机回环请求' } });
          return;
        }
        if (req.method !== method) {
          res.setHeader('allow', method);
          writeJson(res, 405, { error: { code: 'method-not-allowed', message: `请用 ${method}` } });
          return;
        }
        try {
          const body = method === 'GET' ? {} : await readJsonBody(req);
          const value = await handle(body, req);
          writeJson(res, 200, { ok: true, value });
        } catch (error) {
          const code = error instanceof StoreError ? error.code : 'internal';
          const status = code === 'internal' ? 500 : 400;
          writeJson(res, status, {
            error: { code, message: String(error?.message ?? error) },
          });
        }
      },
    };
  }

  const todayKey = () => localDateKey();

  return [
    // 自检：不碰数据，专门用来确认插件路由真的挂上了。
    endpoint('GET', '/health', () => ({
      plugin: 'dsh-todos',
      dataFile: store.file,
      serverTime: new Date().toISOString(),
    })),

    endpoint('GET', '/snapshot', () => {
      const state = store.snapshot();
      const today = todayKey();
      return {
        today,
        serverTime: new Date().toISOString(),
        dataFile: store.file,
        tasks: state.tasks,
        projects: state.projects,
        labels: state.labels,
        settings: state.settings,
        counts: deriveCounts(state, today),
        stats: computeStats(state, 'last30', today),
      };
    }),

    endpoint('GET', '/stats', (_body, req) => {
      const url = new URL(`http://${req.headers.host ?? 'localhost'}${req.url ?? ''}`);
      const range = url.searchParams.get('range') ?? 'last30';
      return computeStats(store.snapshot(), range, todayKey());
    }),

    endpoint('POST', '/tasks/create', (body) => {
      const items = Array.isArray(body.items) ? body.items : [body];
      const created = items.map((item) => store.createTask(item));
      return { created };
    }),

    endpoint('POST', '/tasks/update', (body) => {
      const updates = Array.isArray(body.updates) ? body.updates : [body];
      const updated = updates.map((entry) => {
        const { id, ...patch } = entry;
        if (typeof id !== 'string' || id === '') throw new StoreError('missing-id', '缺少任务 id');
        return store.updateTask(id, patch);
      });
      return { updated };
    }),

    endpoint('POST', '/tasks/complete', (body) => {
      const ids = Array.isArray(body.ids) ? body.ids : [];
      const completed = body.completed !== false;
      return store.completeTasks(ids, completed);
    }),

    endpoint('POST', '/tasks/delete', (body) => ({
      deleted: store.deleteTasks(Array.isArray(body.ids) ? body.ids : []),
    })),

    endpoint('POST', '/tasks/restore', (body) => ({
      restored: store.restoreTasks(Array.isArray(body.ids) ? body.ids : []),
    })),

    endpoint('POST', '/tasks/purge', (body) => ({
      removed: store.purgeTasks(Array.isArray(body.ids) ? body.ids : []),
    })),

    endpoint('POST', '/projects/save', (body) => ({ project: store.upsertProject(body) })),
    endpoint('POST', '/projects/delete', (body) => {
      if (typeof body.id !== 'string' || body.id === '') throw new StoreError('missing-id', '缺少项目 id');
      return { deleted: store.deleteProject(body.id) };
    }),

    endpoint('POST', '/labels/save', (body) => ({ label: store.upsertLabel(body) })),
    endpoint('POST', '/labels/delete', (body) => {
      if (typeof body.id !== 'string' || body.id === '') throw new StoreError('missing-id', '缺少标签 id');
      return { deleted: store.deleteLabel(body.id) };
    }),

    endpoint('POST', '/settings/update', (body) => store.updateSettings(body)),

    endpoint('GET', '/export', () => store.exportState()),
    endpoint('POST', '/import', (body) => store.importState(body.payload ?? body, body.mode === 'merge' ? 'merge' : 'replace')),

    // 浏览器直接下载的导出入口：靠 Content-Disposition 触发「另存为」，
    // 客户端只需渲染一个 <a download>，不必自己造 Blob 与临时节点。
    {
      kind: 'exact',
      path: `${ROUTE_PREFIX}/export/download`,
      handler: (req, res) => {
        if (!isLoopbackRequest(req)) {
          writeJson(res, 403, { error: { code: 'forbidden', message: '只允许本机回环请求' } });
          return;
        }
        if (req.method !== 'GET') {
          res.setHeader('allow', 'GET');
          writeJson(res, 405, { error: { code: 'method-not-allowed', message: '请用 GET' } });
          return;
        }
        const stamp = localDateKey();
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.setHeader('content-disposition', `attachment; filename="dsh-todos-${stamp}.json"`);
        res.setHeader('cache-control', 'no-store');
        res.end(JSON.stringify(store.exportState(), null, 2));
      },
    },

    // Markdown 导出：按项目分组，便于直接贴进周报。
    {
      kind: 'exact',
      path: `${ROUTE_PREFIX}/export/markdown`,
      handler: (req, res) => {
        if (!isLoopbackRequest(req)) {
          writeJson(res, 403, { error: { code: 'forbidden', message: '只允许本机回环请求' } });
          return;
        }
        if (req.method !== 'GET') {
          res.setHeader('allow', 'GET');
          writeJson(res, 405, { error: { code: 'method-not-allowed', message: '请用 GET' } });
          return;
        }
        const stamp = localDateKey();
        res.statusCode = 200;
        res.setHeader('content-type', 'text/markdown; charset=utf-8');
        res.setHeader('content-disposition', `attachment; filename="dsh-todos-${stamp}.md"`);
        res.setHeader('cache-control', 'no-store');
        res.end(renderMarkdown(store.snapshot(), stamp));
      },
    },

    // 到点提醒：全局浮层轮询这个路由。
    endpoint('GET', '/due', () => dueNotifications(store)),

    // 自然语言快速添加：只解析不落库，供界面做预览高亮。
    endpoint('POST', '/tasks/parse', (body) => {
      const state = store.snapshot();
      const input = typeof body.input === 'string' ? body.input : '';
      return parseQuickAdd(input, {
        today: todayKey(),
        projects: state.projects,
        labels: state.labels,
      });
    }),

    // 落库版本：`#项目` / `@标签` 不存在时按 createMissing 决定是否新建。
    endpoint('POST', '/tasks/quick-add', (body) => {
      const inputs = Array.isArray(body.inputs) ? body.inputs : [body.input];
      const createMissing = body.createMissing !== false;
      const results = [];
      for (const raw of inputs) {
        if (typeof raw !== 'string' || raw.trim() === '') {
          throw new StoreError('invalid-task', 'input 不能为空');
        }
        results.push(quickAdd(store, raw, { today: todayKey(), createMissing }));
      }
      return { results };
    }),
  ];
}
