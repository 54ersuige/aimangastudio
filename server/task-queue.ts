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
 * @param fn    实际执行函数；resolve 值会作为 task.result 返回给轮询方
 * @returns taskId
 */
export function runTask<T>(key: string, kind: string, fn: () => Promise<T>): string {
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
      const result = await fn();
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

export function getTask(id: string): TaskState | undefined {
  cleanup();
  const t = tasks.get(id);
  if (!t) return undefined;
  // 不向前端暴露内部 key
  const { key: _key, ...state } = t as TaskState & { key?: string };
  return state;
}

/** 调试：列出所有内存中的 task（不含内部 key）。仅本地使用。 */
export function listTasks(): TaskState[] {
  cleanup();
  const out: TaskState[] = [];
  for (const t of tasks.values()) {
    const { key: _key, ...state } = t as TaskState & { key?: string };
    out.push(state);
  }
  return out;
}