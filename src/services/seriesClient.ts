import type {
  Series,
  SeriesCharacter,
  CharacterGender,
  CharacterAgeBand,
  Worldview,
  Chapter,
  Arc,
  SeriesPage,
  Panel,
} from '../types';

function apiUrl(path: string): string {
  // 与 modelClient 保持一致：通过 Vite 代理走 /api
  return path;
}

async function request<T>(input: string, init: RequestInit = {}): Promise<T> {
  // 2026-09-03：抓 `net::ERR_NETWORK_IO_SUSPENDED` 这种"fetch 被中断"的偶发问题。
  // Vite HMR 在热重载时会把当前页面的 fetch 请求 cancel（Chromium 报 ERR_NETWORK_IO_SUSPENDED），
  // 上一行的模块热替换尚未稳定，但用户已经点过 button —— 不重试直接报红，体验差。
  // 解决：捕获这个错时再试一次（最多 2 次），第二次成功就当无事发生。
  const MAX_RETRY = 2;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    try {
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
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message || e || '');
      const isNetworkSuspend = /NETWORK_IO_SUSPENDED|Failed to fetch|NetworkError|aborted/i.test(msg);
      if (!isNetworkSuspend || attempt === MAX_RETRY - 1) throw e;
      // 退避 200ms 再试；这段时间足以让 HMR 模块替换完成。
      await new Promise(r => setTimeout(r, 200));
      continue;
    }
  }
  // 不应该到这里 —— 但保险起见，把最后一次错抛出去
  throw lastErr;
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
  // 2026-09-01 新增：手动添加角色时也允许指定性别 / 年龄段，这是"图片里男女老少一目了然"的第一道闸门。
  gender?: CharacterGender;
  ageBand?: CharacterAgeBand;
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

/** 重生成角色参考图。
 * - 不传 shot：整组重生成；用于老角色升级。
 * - 传 shot（'sheet'）：仅重生成该镜头。 */
export async function regenerateCharacterImage(
  seriesId: string,
  characterId: string,
  shot?: 'sheet',
): Promise<{ character: SeriesCharacter }> {
  return postTask(`/api/series/${seriesId}/characters/${characterId}/regenerate-image`, shot ? { shot } : {});
}

// ============ Arcs / Chapters ============

/**
 * 把世界观里的 arcBlueprints 物化成空 arc 列表（一次性）。
 * 后续按 arc.id 逐季生成 chapter。
 */
export async function generateArcs(seriesId: string): Promise<{ arcs: Arc[] }> {
  return request(`/api/series/${seriesId}/arcs/generate`, { method: 'POST', body: JSON.stringify({}) });
}

/** 一次生成指定 arc 的所有 chapter（基于 arc.premise + 前情提要）。 */
export async function generateArcChapters(
  seriesId: string,
  arcId: string,
  options: { targetPageCount?: number; hint?: string } = {},
): Promise<{ arc: Arc; chapters: Chapter[] }> {
  return request(`/api/series/${seriesId}/arcs/${arcId}/generate-chapters`, {
    method: 'POST',
    body: JSON.stringify({ targetPageCount: options.targetPageCount, hint: options.hint }),
  });
}

/** 逐章生成：在指定 arc 末尾追加下一章。 */
export async function appendNextChapter(
  seriesId: string,
  arcId: string,
  options: { pageCount?: number; hint?: string } = {},
): Promise<{ arc: Arc; chapter: Chapter | null }> {
  return request(`/api/series/${seriesId}/arcs/${arcId}/append-next-chapter`, {
    method: 'POST',
    body: JSON.stringify({ pageCount: options.pageCount, hint: options.hint }),
  });
}

/** 兼容旧端点：直接挂顶层的 chapter 生成（无 arc 数据时）。 */
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

// 单格（重）生成：只出这一格的图，不改文字。已有图时视为重掷。
export async function generatePanel(seriesId: string, pageId: string, panelIndex: number): Promise<{ page: SeriesPage }> {
  return postTask(`/api/series/${seriesId}/pages/${pageId}/panels/${panelIndex}/generate`, {});
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

// ============ Manual editing endpoints ============

/** 手动编辑：更新 chapter 元数据（标题/剧情摘要/核心冲突/预计页数）。 */
export async function updateChapter(seriesId: string, chapterId: string, patch: Partial<Pick<Chapter, 'title' | 'summary' | 'conflict' | 'pageCount' | 'tagline' | 'endingQuote' | 'nextPreview'>>): Promise<{ chapter: Chapter }> {
  return request(`/api/series/${seriesId}/chapters/${chapterId}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

/** AI 生成本话的公众号发布文案（话头副题/结尾金句/下话预告），保存到章上。 */
export async function generatePublishCopy(seriesId: string, chapterId: string): Promise<{ chapter: Chapter }> {
  return request(`/api/series/${seriesId}/chapters/${chapterId}/publish-copy`, { method: 'POST', body: JSON.stringify({}) });
}

/** 手动编辑：调整章节顺序（仅同 arc 内相邻交换）。 */
export async function moveChapter(seriesId: string, chapterId: string, direction: 'up' | 'down'): Promise<{ success: boolean }> {
  return request(`/api/series/${seriesId}/chapters/${chapterId}/move`, { method: 'POST', body: JSON.stringify({ direction }) });
}

/** 手动编辑：删除一个 chapter。 */
export async function deleteChapter(seriesId: string, chapterId: string): Promise<{ success: boolean }> {
  return request(`/api/series/${seriesId}/chapters/${chapterId}`, { method: 'DELETE' });
}

/** 手动编辑：更新 page 元数据（页标题/场景描述/角色清单）。 */
export async function updatePage(seriesId: string, pageId: string, patch: Partial<Pick<SeriesPage, 'title' | 'sceneDescription' | 'characterIds'>>): Promise<{ page: SeriesPage }> {
  return request(`/api/series/${seriesId}/pages/${pageId}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

/** 精细编辑：直接改某一格的 dialogue（旁白或对话），不重生成图片。 */
export async function updatePanelDialogue(seriesId: string, pageId: string, panelIndex: number, dialogue: string): Promise<{ page: SeriesPage }> {
  return request(`/api/series/${seriesId}/pages/${pageId}/panels/${panelIndex}/dialogue`, { method: 'PATCH', body: JSON.stringify({ dialogue }) });
}

// 2026-09-03：三合一改写 —— 同时可改 dialogue / narration（叙述）/ innerThought（内心独白）。
// 任意字段缺省视为不动。
export async function updatePanelText(
  seriesId: string,
  pageId: string,
  panelIndex: number,
  text: { dialogue?: string; narration?: string; innerThought?: string },
): Promise<{ page: SeriesPage }> {
  return request(`/api/series/${seriesId}/pages/${pageId}/panels/${panelIndex}/text`, { method: 'PATCH', body: JSON.stringify(text) });
}

// 2026-09-03：让 AI 仅重写一格的"图下文字"（不动 description、不重出图）。
export async function rewritePanelText(
  seriesId: string,
  pageId: string,
  panelIndex: number,
  instruction: string,
  pageContext?: string,
): Promise<{ page: SeriesPage }> {
  return request(`/api/series/${seriesId}/pages/${pageId}/panels/${panelIndex}/rewrite-text`, {
    method: 'POST',
    body: JSON.stringify({ instruction, pageContext }),
  });
}

/** 手动编辑：整体替换 panels（增删改全部 panel 后调一次）。 */
export async function replacePanels(seriesId: string, pageId: string, panels: Panel[]): Promise<{ page: SeriesPage }> {
  return request(`/api/series/${seriesId}/pages/${pageId}/panels`, { method: 'PUT', body: JSON.stringify({ panels }) });
}

/** 手动编辑：在 page 中插入一个新 panel。 */
export async function insertPanel(seriesId: string, pageId: string, insertAt?: number): Promise<{ page: SeriesPage }> {
  return request(`/api/series/${seriesId}/pages/${pageId}/panels/insert`, { method: 'POST', body: JSON.stringify({ insertAt }) });
}

/** 手动编辑：删除 page 中一个 panel。 */
export async function deletePanelApi(seriesId: string, pageId: string, panelId: string): Promise<{ page: SeriesPage }> {
  return request(`/api/series/${seriesId}/pages/${pageId}/panels/${panelId}`, { method: 'DELETE' });
}

// 便捷类型导出
export type { Series, SeriesCharacter, Worldview, Chapter, SeriesPage, Panel };
