import type {
  Series,
  SeriesCharacter,
  Worldview,
  Chapter,
  SeriesPage,
  Panel,
} from '../types';

function apiUrl(path: string): string {
  // 与 modelClient 保持一致：通过 Vite 代理走 /api
  return path;
}

async function request<T>(input: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(apiUrl(input), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try {
      const data = await res.json();
      if (data.error) message = data.error;
    } catch {
      try { message = await res.text() || message; } catch {}
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

// ============ 后台任务轮询（P1-6）============
// 图片密集型端点（整页出图/重生成/改写/角色生成）现在返回 taskId，
// 由本封装轮询直到完成 —— 对上层调用方完全透明，签名不变。

const TASK_POLL_INTERVAL = 2000;

interface TaskState {
  id: string;
  kind: string;
  status: 'running' | 'done' | 'error';
  result?: unknown;
  error?: string;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function postTask<T>(path: string, body?: unknown): Promise<T> {
  const startRes = await request<{ taskId: string }>(path, {
    method: 'POST',
    body: JSON.stringify(body || {}),
  });
  const taskId = startRes.taskId;
  for (;;) {
    await sleep(TASK_POLL_INTERVAL);
    let task: TaskState;
    try {
      const res = await request<{ task: TaskState }>(`/api/tasks/${taskId}`);
      task = res.task;
    } catch (e: any) {
      throw new Error(e.message || '任务查询失败（服务可能已重启），请重新发起生成');
    }
    if (task.status === 'done') return task.result as T;
    if (task.status === 'error') throw new Error(task.error || '任务执行失败');
    // running → 继续轮询
  }
}

// ============ Series CRUD ============

export async function listSeries(): Promise<{ series: Series[] }> {
  return request('/api/series');
}

export async function createSeries(input: { title: string; logline: string; dnaKey?: string }): Promise<{ series: Series }> {
  return request('/api/series', { method: 'POST', body: JSON.stringify(input) });
}

export async function getSeries(id: string): Promise<{ series: Series }> {
  return request(`/api/series/${id}`);
}

export async function patchSeries(id: string, patch: Partial<Pick<Series, 'title' | 'logline'>>): Promise<{ series: Series }> {
  return request(`/api/series/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export async function deleteSeries(id: string): Promise<{ success: boolean }> {
  return request(`/api/series/${id}`, { method: 'DELETE' });
}

// ============ Worldview ============
// hint：用户对上一版的自然语言修改意见（P1-5 反馈闭环，此前被丢弃）

export async function generateWorldview(seriesId: string, hint?: string): Promise<{ worldview: Worldview }> {
  return request(`/api/series/${seriesId}/worldview/generate`, { method: 'POST', body: JSON.stringify({ hint }) });
}

// ============ Characters ============

export async function generateCharacters(seriesId: string, hint?: string): Promise<{ characters: SeriesCharacter[] }> {
  return postTask(`/api/series/${seriesId}/characters/generate`, { hint });
}

export async function addCharacter(seriesId: string, input: {
  name: string;
  role: 'protagonist' | 'antagonist' | 'supporting';
  description: string;
  appearance: string;
  voiceTone?: string;
  autoGenerateImage?: boolean;
}): Promise<{ character: SeriesCharacter }> {
  return request(`/api/series/${seriesId}/characters`, { method: 'POST', body: JSON.stringify(input) });
}

export async function updateCharacter(seriesId: string, characterId: string, patch: Partial<SeriesCharacter>): Promise<{ character: SeriesCharacter }> {
  return request(`/api/series/${seriesId}/characters/${characterId}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export async function deleteCharacter(seriesId: string, characterId: string): Promise<{ success: boolean }> {
  return request(`/api/series/${seriesId}/characters/${characterId}`, { method: 'DELETE' });
}

export async function regenerateCharacterImage(seriesId: string, characterId: string): Promise<{ character: SeriesCharacter }> {
  return postTask(`/api/series/${seriesId}/characters/${characterId}/regenerate-image`, {});
}

// ============ Chapters ============

export async function generateChapters(seriesId: string, targetPageCount = 12): Promise<{ chapters: Chapter[] }> {
  return request(`/api/series/${seriesId}/chapters/generate`, { method: 'POST', body: JSON.stringify({ targetPageCount }) });
}

// ============ Pages ============

export async function breakdownPage(seriesId: string, pageId: string): Promise<{ page: SeriesPage }> {
  return request(`/api/series/${seriesId}/pages/${pageId}/breakdown`, { method: 'POST', body: JSON.stringify({}) });
}

export async function generatePage(seriesId: string, pageId: string): Promise<{ page: SeriesPage }> {
  return postTask(`/api/series/${seriesId}/pages/${pageId}/generate`, {});
}

export async function regeneratePage(seriesId: string, pageId: string): Promise<{ page: SeriesPage }> {
  return postTask(`/api/series/${seriesId}/pages/${pageId}/regenerate`, {});
}

// 自然语言改写整页
export async function rewritePage(seriesId: string, pageId: string, instruction: string): Promise<{ page: SeriesPage }> {
  return postTask(`/api/series/${seriesId}/pages/${pageId}/rewrite`, { instruction });
}

// 自然语言改写单分镜
export async function rewritePanel(seriesId: string, pageId: string, panelIndex: number, instruction: string): Promise<{ panel: Panel }> {
  return postTask(`/api/series/${seriesId}/pages/${pageId}/panels/${panelIndex}/rewrite`, { instruction });
}

// 一键续写：从当前页自动生成下一页草稿
export async function continueNextPage(seriesId: string, pageId: string): Promise<{ page: SeriesPage }> {
  return request(`/api/series/${seriesId}/pages/${pageId}/continue`, { method: 'POST', body: JSON.stringify({}) });
}

// 便捷类型导出
export type { Series, SeriesCharacter, Worldview, Chapter, SeriesPage, Panel };
