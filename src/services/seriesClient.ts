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
/**
 * 单次轮询请求自身的超时（毫秒）。
 * 2026-10-15：此前 `request()` 里的 fetch 没有 AbortController —— 一旦这次请求挂住，
 * `await` 永不返回，外层的总超时检查（位于循环顶部）**永远执行不到**，
 * UI 就会无限转圈。给单次请求加超时，挂了才能进入下一轮或触发总超时。
 */
const TASK_POLL_TIMEOUT_MS = 20_000;
/**
 * 整任务最大等待时间（毫秒），默认 30 分钟。
 *
 * 2026-10-15：从 10 分钟上调，并与后端并发改造后的最坏耗时对齐 ——
 * 单图超时 240s × 最多 3 轮 × ceil(格数/并发3) 轮次，6 格最坏仍可到 ~24 分钟。
 * 原来的 10 分钟会让「后端还在正常画、前端先报失败」，用户重试 = 重复扣费。
 * 真正的兜底交给总超时 + 后端 progress，而不是一个比后端更短的猜测值。
 */
const TASK_DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

export interface TaskState {
  id: string;
  kind: string;
  status: 'running' | 'done' | 'error';
  result?: unknown;
  error?: string;
  /** 进度 0-100，仅 running 时更新。 */
  progress?: number;
  /**
   * 任务正在处理的资源（2026-10-20）。
   * type='arc' 时 id 就是 arcId —— 前端据此判断「是哪一季在跑」，
   * 避免把同一份进度画到每一季头上。
   */
  target?: { type: string; id: string };
}

export interface PostTaskOptions {
  /** 总超时（毫秒），默认 30 分钟。 */
  timeoutMs?: number;
  /**
   * 进度回调（每 2 秒一次）。
   * 后端从 2026-10-15 起会真正上报 progress（出图按"完成格数/总格数"），
   * 不再是恒 0。UI 应展示它，否则用户面对长任务仍然两眼一抹黑。
   */
  onProgress?: (progress: number, kind: string) => void;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function postTask<T>(path: string, body?: unknown, opts: PostTaskOptions = {}): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? TASK_DEFAULT_TIMEOUT_MS;
  const startRes = await request<{ taskId: string }>(path, {
    method: 'POST',
    body: JSON.stringify(body || {}),
  });
  const taskId = startRes.taskId;
  const startedAt = Date.now();
  for (;;) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(
        `任务等待超时（${Math.round(timeoutMs / 1000)}s 未完成）。可能是服务重启，请重新发起生成。`,
      );
    }
    await sleep(TASK_POLL_INTERVAL);
    let task: TaskState;
    try {
      const res = await request<{ task: TaskState }>(`/api/tasks/${taskId}`, {
        // 单次请求也带超时：否则请求挂住会让上面的总超时检查永远轮不到。
        signal: AbortSignal.timeout(TASK_POLL_TIMEOUT_MS),
      });
      task = res.task;
    } catch (e: any) {
      // 轮询失败本身不该终止整个任务：后端任务还在跑，
      // 只有"查不到任务"（服务重启）才值得放弃。
      if (/任务等待超时/.test(String(e?.message || ''))) throw e;
      const msg = String(e?.message || '');
      if (/not found|不存在|404/i.test(msg)) {
        throw new Error('任务已不存在（服务可能已重启），请重新发起生成');
      }
      // 单次查询抖动：继续下一轮，总超时仍会兜底。
      continue;
    }
    if (typeof task.progress === 'number' && opts.onProgress) {
      try { opts.onProgress(task.progress, task.kind); } catch { /* ignore */ }
    }
    if (task.status === 'done') return task.result as T;
    if (task.status === 'error') throw new Error(task.error || '任务执行失败');
    // running → 继续轮询
  }
}

/**
 * 列出后端当前任务队列（2026-10-19）。
 *
 * 为什么需要它：`postTask` 把 taskId 存在**函数局部变量**里，
 * 轮询只发生在本标签页、本次 JS 上下文。于是任何让 React `busy` 归零的路径
 * （F5 刷新 / Vite 热重载 / 从右侧创作助手发起）都会让按钮错误地恢复可点，
 * 而后端 `runTask` 的互斥仍在生效 —— 用户点下去只会撞 409，白等好几分钟。
 *
 * 这是**补充**判据而非替代：本地 busy 仍是首选（响应快、无额外请求），
 * 这里的查询负责覆盖本地丢失的那部分真相。
 */
export async function listTasks(): Promise<{ tasks: TaskState[] }> {
  return request('/api/tasks');
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

/**
 * 新增角色的入参。字段与后端 `AddCharacterSchema`
 * （server/series-routes/characters.ts）一一对应。
 *
 * 2026-10-15：此前这段内联类型在三个地方各写了一份且互不一致 ——
 * seriesClient / SeriesContext 的 interface / addChar 实现处。
 * SeriesContext 那份漏掉了 visualAnchors，导致 SeriesWorkbench 手动加角色时
 * 传 visualAnchors 触发 TS2353（严格模式下直接报错，宽松模式下则一直没人发现）。
 * 现统一到单一事实源。
 */
export interface AddCharacterInput {
  name: string;
  role: 'protagonist' | 'antagonist' | 'supporting';
  description: string;
  appearance: string;
  roleInStory?: string;
  /** 2026-09-01：性别 / 年龄段 —— "图片里男女老少一目了然"的第一道闸门。 */
  gender?: CharacterGender;
  ageBand?: CharacterAgeBand;
  /** 高辨识度视觉锚点，生图 prompt 每页强制带入；驱动跨页角色一致性。 */
  visualAnchors?: string[];
  /** 【服装唯一事实源】只能写一套确定装束，禁止写"逐渐变成/分场合切换"。 */
  outfit?: string;
  hair?: string;
  eyes?: string;
  height?: string;
  build?: string;
  signature?: string;
  personality?: string;
  occupation?: string;
  backstory?: string;
  motivation?: string;
  goal?: string;
  arc?: string;
  catchphrase?: string;
  voice?: string;
  /** 兼容旧前端：仍可传 voiceTone，后端会自动合并到 voice 字段。 */
  voiceTone?: string;
  autoGenerateImage?: boolean;
}

export async function addCharacter(seriesId: string, input: AddCharacterInput): Promise<{ character: SeriesCharacter }> {
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

/**
 * 一次生成指定 arc 的所有 chapter（基于 arc.premise + 前情提要）。
 *
 * 2026-10-16：改走 postTask（task 队列 + 进度轮询）。
 * 此前是同步 HTTP 等待，实测要转 **8 分钟**（16:13 点 → 16:21 出结果，
 * 中间还有一轮字数不够的整轮重写）。前端只有一句不动的「生成中…」，
 * 用户据此以为失败又连点两次，第二次反撞 409「该季已有 chapter」。
 * 长任务没有进度 = 每次都会重演这次误会。
 */
export async function generateArcChapters(
  seriesId: string,
  arcId: string,
  options: { targetPageCount?: number; hint?: string } = {},
  opts: PostTaskOptions = {},
): Promise<{ arc: Arc; chapters: Chapter[] }> {
  return postTask<{ arc: Arc; chapters: Chapter[] }>(
    `/api/series/${seriesId}/arcs/${arcId}/generate-chapters`,
    { targetPageCount: options.targetPageCount, hint: options.hint },
    opts,
  );
}

/**
 * 逐章生成：在指定 arc 末尾追加下一章。
 * 2026-10-16 同 generateArcChapters：改走 task 队列（实测单话 60~120s）。
 */
export async function appendNextChapter(
  seriesId: string,
  arcId: string,
  options: { pageCount?: number; hint?: string } = {},
  opts: PostTaskOptions = {},
): Promise<{ arc: Arc; chapter: Chapter | null }> {
  return postTask<{ arc: Arc; chapter: Chapter | null }>(
    `/api/series/${seriesId}/arcs/${arcId}/append-next-chapter`,
    { pageCount: options.pageCount, hint: options.hint },
    opts,
  );
}

/**
 * 重新规划一话（2026-10-16 新增）。
 *
 * 三个生成入口全是「新建」，没有任何入口能改写已存在的某一话。
 * 但用户最常要的恰恰是「这一话太平了，重新给一版有张力的」。
 * notes / stalePanels 是给界面如实提示用的：旧分镜图是照着旧剧情画的。
 */
export async function replanChapter(
  seriesId: string,
  chapterId: string,
  options: { hint?: string; keepTitle?: boolean } = {},
  opts: PostTaskOptions = {},
): Promise<{ chapter: Chapter; notes: string[]; stalePanels: number }> {
  return postTask<{ chapter: Chapter; notes: string[]; stalePanels: number }>(
    `/api/series/${seriesId}/chapters/${chapterId}/replan`,
    { hint: options.hint, keepTitle: options.keepTitle !== false },
    opts,
  );
}

/** 兼容旧端点：直接挂顶层的 chapter 生成（无 arc 数据时）。 */
export async function generateChapters(seriesId: string, targetPageCount = 12): Promise<{ chapters: Chapter[] }> {
  return request(`/api/series/${seriesId}/chapters/generate`, { method: 'POST', body: JSON.stringify({ targetPageCount }) });
}

// ============ Pages ============

export async function breakdownPage(seriesId: string, pageId: string): Promise<{ page: SeriesPage }> {
  return request(`/api/series/${seriesId}/pages/${pageId}/breakdown`, { method: 'POST', body: JSON.stringify({}) });
}

/**
 * 以下 5 个出图类端点全部支持进度回传（2026-10-15）。
 *
 * 此前 `onProgress` 定义了却零传入 —— 后端上报的 progress 在 seriesClient:116
 * 被直接丢弃，用户只能盯着一个没有数字的"生成中"。现在把 opts 一路透传到 postTask。
 */

export async function generatePage(seriesId: string, pageId: string, opts?: PostTaskOptions): Promise<{ page: SeriesPage }> {
  return postTask(`/api/series/${seriesId}/pages/${pageId}/generate`, {}, opts);
}

export async function regeneratePage(seriesId: string, pageId: string, opts?: PostTaskOptions): Promise<{ page: SeriesPage }> {
  return postTask(`/api/series/${seriesId}/pages/${pageId}/regenerate`, {}, opts);
}

// 单格（重）生成：只出这一格的图，不改文字。已有图时视为重掷。
export async function generatePanel(seriesId: string, pageId: string, panelIndex: number, opts?: PostTaskOptions): Promise<{ page: SeriesPage }> {
  return postTask(`/api/series/${seriesId}/pages/${pageId}/panels/${panelIndex}/generate`, {}, opts);
}

// 自然语言改写整页
export async function rewritePage(seriesId: string, pageId: string, instruction: string, opts?: PostTaskOptions): Promise<{ page: SeriesPage }> {
  return postTask(`/api/series/${seriesId}/pages/${pageId}/rewrite`, { instruction }, opts);
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

/**
 * 手动保存 panels 时的上行载荷。
 *
 * 与后端 `ReplacePanelsSchema`（server/series-routes/pages.ts）一致：`index` 是
 * **可选**的，缺省时后端按数组位置重新编号。
 *
 * 2026-10-15：此前这里声明成 `Panel[]`（`Panel.index` 是必填 number），但手动编辑
 * 保存时前端会刻意把 index 抹掉交给后端编号 —— 类型与实际发出的报文不一致，
 * 开 strict 后直接报错。改为显式区分"线上载荷"与"存储模型"。
 */
export type PanelInput = Omit<Panel, 'index'> & { index?: number };

/** 手动编辑：整体替换 panels（增删改全部 panel 后调一次）。 */
export async function replacePanels(seriesId: string, pageId: string, panels: PanelInput[]): Promise<{ page: SeriesPage }> {
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
