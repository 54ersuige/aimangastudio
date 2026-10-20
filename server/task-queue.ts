/**
 * 后台任务队列 —— 解决「单 HTTP 请求内串行生成 8 格图最长十几分钟」的问题。
 *
 * 此前 /pages/:id/generate 在一个请求里同步等所有分镜出图：
 *   - Node 默认 requestTimeout 300s / vite 代理链路超时 → 前端报错但后端还在烧钱；
 *   - 用户重试 → 重复计费；
 *   - 中途重启 → 页面永久卡在 generating。
 *
 * 现在：POST 立即返回 taskId，后台执行，前端轮询 GET /api/tasks/:id。
 * 带 key 的任务互斥（同一页/同一角色不允许并发重复生成）。
 *
 * 2026-09-18 调整：
 *   - cleanup() 改为延迟到每次 getTask/listTasks 时跑，避免与 runTask 入口
 *     之间的潜在竞态（Node 单线程下不会真正并发，但语义更清晰）；
 *   - 新增可选 `progress` 字段（0-100），供前端做进度条；任务执行者
 *     通过 `setTaskProgress(id, progress)` 主动上报。
 */
import { randomUUID } from 'crypto';
import type { TaskState } from '../shared/types.js';

const tasks = new Map<string, TaskState & { key?: string }>();

/** 完成任务保留 30 分钟供查询，之后清理防内存泄漏。 */
const MAX_AGE_MS = 30 * 60 * 1000;

/** 周期清理（惰性触发：每次 getTask / listTasks / runTask 时调用）。 */
function cleanup(): void {
  const now = Date.now();
  for (const [id, t] of tasks) {
    if (t.status !== 'running' && now - new Date(t.updatedAt).getTime() > MAX_AGE_MS) {
      tasks.delete(id);
    }
  }
}

export class DuplicateTaskError extends Error {
  constructor(key: string) {
    super(`TASK_BUSY:${key}`);
    this.name = 'DuplicateTaskError';
  }
}

function isKeyBusy(key: string): boolean {
  for (const t of tasks.values()) {
    if (t.status === 'running' && (t as TaskState & { key?: string }).key === key) return true;
  }
  return false;
}

/**
 * 启动一个后台任务。
 * @param key   互斥键（如 `page:<pageId>` 或 `panel:<pageId>#<idx>`）。
 *              同 key 任务运行中时抛 DuplicateTaskError。
 * @param kind  任务类型标识（用于日志与前端提示）
 * @param fn    实际执行函数；resolve 值会作为 task.result 返回给轮询方。
 *              **2026-10-15**：形参新增 taskId —— 执行体可据此调用
 *              `setTaskProgress(taskId, n)` 上报进度。旧调用方忽略该形参即可，
 *              无需改动（TS 允许少接形参）。
 * @returns taskId
 */
export function runTask<T>(key: string, kind: string, fn: (taskId: string) => Promise<T>): string {
  // cleanup 仅惰性触发，不影响 runTask 主路径；
  // Node 单线程下 runTask 入口到 isKeyBusy 检查 + tasks.set 全部连续语句，
  // 不会被打断 → 同 key 的两个请求不可能都通过 isKeyBusy。
  if (isKeyBusy(key)) throw new DuplicateTaskError(key);
  const id = randomUUID();
  const now = new Date().toISOString();
  const task: TaskState & { key?: string } = {
    id, kind, status: 'running', createdAt: now, updatedAt: now, key, progress: 0,
  };
  tasks.set(id, task);
  void (async () => {
    try {
      const result = await fn(id);
      const cur = tasks.get(id);
      if (cur) {
        cur.status = 'done';
        cur.result = result;
        cur.progress = 100;
        cur.updatedAt = new Date().toISOString();
      }
    } catch (e: any) {
      const cur = tasks.get(id);
      if (cur) {
        cur.status = 'error';
        cur.error = e?.message || String(e);
        cur.updatedAt = new Date().toISOString();
      }
      console.error(`[task ${id} (${kind})] failed:`, e?.message || e);
    } finally {
      cleanup();
    }
  })();
  return id;
}

/**
 * 由任务执行函数主动上报进度（0-100）。用于 progress bar。
 * 非 task 内部调用一律 no-op。
 */
export function setTaskProgress(taskId: string, progress: number): void {
  const t = tasks.get(taskId);
  if (!t || t.status !== 'running') return;
  const clamped = Math.max(0, Math.min(100, Math.round(progress)));
  t.progress = clamped;
  t.updatedAt = new Date().toISOString();
}

/**
 * 心跳式进度（2026-10-16）。
 *
 * 问题：话目生成这类任务，一次模型调用就要 60~120 秒，而 `onProgress`
 * 只在**每次尝试开始时**回调一次 —— 于是第一轮全程显示 0%。
 * 「0% 停了 3 分钟」和「没反应」的观感几乎没区别，
 * 用户正是因此以为卡死、去重启了服务，把正在跑的任务一起杀掉。
 *
 * 做法：在 [from, to) 区间内按时间线性爬升，永远不撞到 to。
 * 真正完成/重写时由调用方显式 setTaskProgress 覆盖，不会被心跳拉回去。
 *
 * 关键：**必须能在任务结束时取消定时器**，否则会往已结束的 task 上空转。
 */
export function startTaskHeartbeat(
  taskId: string,
  from: number,
  to: number,
  durationMs: number,
  intervalMs = 2000,
): () => void {
  const span = Math.max(1, to - from);
  const start = Date.now();
  const timer = setInterval(() => {
    const t = tasks.get(taskId);
    if (!t || t.status !== 'running') {
      clearInterval(timer);
      return;
    }
    const elapsed = Date.now() - start;
    const ratio = Math.min(0.97, elapsed / durationMs);
    setTaskProgress(taskId, from + span * ratio);
  }, intervalMs);
  // 不阻止进程退出（这里只是进度显示，业务任务另有生命周期）
  timer.unref?.();
  return () => clearInterval(timer);
}

/**
 * 从互斥键解析出「正在处理哪个资源」。
 *
 * 2026-10-20：前端需要知道**是哪一季**在生成，才能只把进度条画在那儿。
 * 但 key 本身（`arc-chapters:<id>`）是内部格式，不该让前端去解析字符串 ——
 * 所以这里翻译成结构化的 target，key 继续对前端隐身。
 */
function parseTarget(key?: string): { type: string; id: string } | undefined {
  if (!key) return undefined;
  const i = key.indexOf(':');
  if (i < 0) return undefined;
  const kind = key.slice(0, i);
  const id = key.slice(i + 1);
  if (!id) return undefined;
  if (kind === 'arc-chapters' || kind === 'append-chapter') return { type: 'arc', id };
  if (kind === 'replan-chapter') return { type: 'chapter', id };
  return { type: kind, id };
}

export function getTask(id: string): TaskState | undefined {
  cleanup();
  const t = tasks.get(id);
  if (!t) return undefined;
  // 不向前端暴露内部 key —— 改为给出结构化的「正在处理哪个资源」
  const { key: _key, ...state } = t as TaskState & { key?: string };
  const target = parseTarget(_key);
  return target ? { ...state, target } : state;
}
/** 调试：列出所有内存中的 task（不含内部 key）。仅本地使用。 */
export function listTasks(): TaskState[] {
  cleanup();
  const out: TaskState[] = [];
  for (const t of tasks.values()) {
    const { key: _key, ...state } = t as TaskState & { key?: string };
    const target = parseTarget(_key);
    out.push(target ? { ...state, target } : state);
  }
  return out;
}