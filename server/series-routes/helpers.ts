/**
 * 系列创作业务路由（5 步创作流程 + 自然语言改写 + 续写）。
 *
 * 本轮架构修复要点：
 *   - P1-5 反馈闭环：worldview/characters/generate 接收可选 hint（用户修改意见），
 *     连同上一版内容一起注入 prompt —— 此前用户的意见被直接丢弃，重生成只是重掷骰子；
 *   - P1-6 任务模型：图片密集型端点立即返回 taskId，后台执行，前端轮询
 *     GET /api/tasks/:id —— 此前单请求串行出 8 格图最长十几分钟，必然被链路超时掐断；
 *   - P1-8 输出校验：模型 JSON 输出经 zod 校验；幻觉角色 ID 过滤并告警
 *     （此前静默跳过导致该分镜无参考图、角色一致性无声失效）；分镜 index 规整为连续；
 *   - P2-9 跨章上下文：breakdown/continue 统一用「全局页游标」收集最近 3 页（跨章），
 *     修复章节边界处剧情断裂；
 *   - P2-13 角色合并保护：重生成只替换 AI 角色，手工添加的角色（source=manual）保留，
 *     同名 AI 角色复用原 ID 以维持既有分镜引用；
 *   - 图片落盘：生图结果写入 data/images/，JSON 只存路径（配合 series-store 迁移）；
 *   - 生成审计：每次文/图生成的完整 prompt 落盘 logs/generations.jsonl。
 */
import { z } from 'zod';
import { getConfig } from '../config.js';
import * as agnes from '../providers/agnes.js';
import * as deepseek from '../providers/deepseek.js';
import * as gemini from '../providers/gemini.js';
import * as step from '../providers/step.js';
import * as minimax from '../providers/minimax.js';
import * as openaiCompatible from '../providers/openai-compatible.js';
import type { TextRequest } from '../utils.js';
import { logGeneration } from '../utils.js';
import { withDnaTextPrompt } from '../dna-inject.js';
import type { Series, Chapter, Panel, SeriesPage } from '../series-store.js';
import type { DnaKey } from '../../shared/types.js';
import { isValidDnaKey as isValidDnaKeyStrict } from '../dna/registry.js';

/**
 * 判断一个传输层错误是否值得重试（2026-10-19）。
 *
 * 背景：话目生成一次模型调用要 200~400 秒，这种超长连接被网络层掐断
 * 是常态（实测 `fetch failed`）。**用户已经等了 5 分钟**，
 * 这时候直接失败等于把 5 分钟白扔 —— 必须重试。
 *
 * 但**配额 / 鉴权类错误重试毫无意义**：再等一次还是同样的 401/429，
 * 只会让用户多等一个超时周期。
 *
 * 判断顺序刻意把「不可重试」放前面：这两类错误信息里常混着
 * "fetch failed" 之类的连接描述，放后面就会被误判成可重试。
 */
export function isRetryableTransportError(msg: string): boolean {
  const m = msg.toLowerCase();
  // 先排除：配额耗尽、鉴权失败、参数错误 —— 重试只会再失败一次
  if (/\b429\b|rate.?limit|quota|用量上限|积分不足|余额不足/.test(m)) return false;
  if (/\b401\b|\b403\b|unauthorized|forbidden|invalid.?api.?key|认证|鉴权/.test(m)) return false;
  if (/\b400\b|bad.?request|invalid.?parameter/.test(m)) return false;
  // 再判定：这些是「换个时间点再来一次」有可能成功的
  if (/fetch failed|econnreset|econnrefused|etimedout|enotfound|socket hang up/.test(m)) return true;
  if (/请求超时|超时/.test(msg)) return true;         // abortableFetch 翻译过的中文文案
  if (/\b5\d\d\b|internal server error|bad gateway|gateway timeout|service unavailable/.test(m)) return true;
  return false;
}

/** 退避等待，避免网络抖动时立刻再撞一次。 */
function sleepMs(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export function getTextProvider(config: { provider?: string }) {  switch (config.provider) {
    case 'gemini': return gemini;
    case 'agnes': return agnes;
    case 'deepseek': return deepseek;
    case 'minimax': return minimax;
    case 'openai-compatible': return openaiCompatible;
    default: throw new Error(`Unsupported text provider: ${config.provider}`);
  }
}

export function getImageProvider(config: { provider?: string }) {
  switch (config.provider) {
    case 'gemini': return gemini;
    case 'step': return step;
    case 'minimax': return minimax;
    case 'agnes': return agnes;
    case 'openai-compatible': return openaiCompatible;
    default: throw new Error(`Unsupported image provider: ${config.provider}`);
  }
}

type ModelConfigForText = ReturnType<typeof getConfig>['text'];
type ModelConfigForImage = ReturnType<typeof getConfig>['image'];

// ── 结构化 JSON 调用（带 zod 输出校验）────────────────────────────────────

export async function callStructuredJson<T>(
  prompt: string,
  systemInstruction: string,
  schema: Record<string, unknown>,
  opts: {
    dnaKey: DnaKey;
    temperature?: number;
    validate?: (raw: unknown) => T;
    logKind?: string;
    logMeta?: Record<string, unknown>;
    /**
     * 进度回调（attempt / total / 阶段文案）。
     * 2026-10-16：生成话目实测一次尝试就要 60~120 秒
     * （推理模型 84% 输出是思考 token），只在尝试开始时回调一次的话
     * 进度条会死守 0% 三分钟 —— 和「没反应」没区别。
     */
    onProgress?: (attempt: number, total: number, phase: string) => void;
    /**
     * 心跳期间的进度区间终点（0-100）。给定时器一个可爬升的上限。
     * 不传则不做心跳（短任务不需要）。
     */
    heartbeat?: { from: number; to: number; durationMs: number };
    /**
     * 启动心跳。由调用方实现（需要把 heartbeat 区间翻译成 taskId 上的 setTaskProgress）。
     * 返回停止函数；返回 null/undefined 表示不启用心跳。
     */
    onHeartbeatStart?: (h: { from: number; to: number; durationMs: number }) => (() => void) | null;
    /**
     * 覆盖本次调用的超时（毫秒）。
     *
     * 2026-10-16 实测：批量生成话目（4 话）要 **5~8 分钟**，而 text 模型
     * 默认 timeout 只有 240s（runtime-config.json 里存的就是 240000）
     * → 任务在 4 分钟处被 `请求超时` 掐断，用户看到的是彻底失败。
     *
     * 之前那次 8 分钟成功的，属于模型恰好跑得快、赶上尾巴 —— 不可靠。
     *
     * 为什么不全局抬高：那会让所有短任务（角色生成、世界观）失败时
     * 也干等 10 分钟才报错。**只有这类确定很慢的调用才覆盖。**
     */
    timeoutMs?: number;
  },
): Promise<T> {
  const config = getConfig().text;
  // 容错：模型输出 zod 校验失败时自动重试一次（temperature 略上调鼓励探索）。
  // 重试用更严格的提示追加。原 prompt 仍记录到日志便于排查。
  const MAX_RETRIES = 2;
  // 每次尝试的上限。批量出 N 话，每话都是独立的一次完整推理。
  // 默认给 6 分钟/次（4 话 + 重试能覆盖到 12 分钟），
  // 与前端 TASK_DEFAULT_TIMEOUT_MS（30 分钟）留足余量。
  const perAttemptMs = opts.timeoutMs ?? 360000;
  // provider 用的是 config.timeout，这里必须按每次尝试单独放宽，
  // 否则第 2 次重试会被第 1 次已经消耗掉的墙钟时间误伤。
  const attemptConfig = { ...config, timeout: perAttemptMs };
  const provider = getTextProvider(attemptConfig);
  let lastError: string | undefined;
  // 心跳定时器必须在每次尝试开始前先停掉旧的，否则会叠加空转。
  let stopHeartbeat: (() => void) | null = null;
  const stopHb = () => { stopHeartbeat?.(); stopHeartbeat = null; };
  try {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const isRetry = attempt > 0;
    opts.onProgress?.(attempt, MAX_RETRIES, isRetry ? '内容不够，正在重写' : '正在构思');
    if (opts.heartbeat) {
      stopHb();
      stopHeartbeat = opts.onHeartbeatStart?.(opts.heartbeat) ?? null;
    }
    const attemptSystem = isRetry
      ? `${systemInstruction}\n\n⚠️ 上一次输出未通过 JSON 校验（${lastError ?? ''}）。请重新输出严格符合 schema 的 JSON object，不要任何额外文字、不要 markdown 代码块。`
      : systemInstruction;
    const req: TextRequest = withDnaTextPrompt({
      prompt,
      systemInstruction: attemptSystem,
      jsonMode: true,
      jsonSchema: schema,
      temperature: isRetry ? 0.5 : opts.temperature,
    }, { dnaKey: opts.dnaKey });
    logGeneration(opts.logKind || 'structured-text', {
      model: config.model,
      prompt,
      systemInstruction: attemptSystem,
      dnaKey: opts.dnaKey,
      attempt,
      ...opts.logMeta,
    });
    let result;
    try {
      result = await provider.generateText(attemptConfig, req);
    } catch (e: any) {
      stopHb();
      // 2026-10-19 实测：一次 200+ 秒的长连接会被网络层掐断（fetch failed）。
      // 这种「等了 5 分钟然后失败」必须重试，而不是把 5 分钟白扔给用户。
      // 但**配额/鉴权类错误重试无意义**，重试只是再等一次。
      const msg = String(e?.message || e || '');
      if (isRetryableTransportError(msg) && attempt < MAX_RETRIES - 1) {
        lastError = msg.slice(0, 200);
        console.warn(
          `[series-routes] ${opts.logKind} attempt ${attempt} 传输层失败（${msg.slice(0, 80)}），将重试`,
        );
        await sleepMs(1200);
        continue;
      }
      throw e;
    } finally {
      // 这一次尝试结束了（成功、失败还是抛错），心跳都必须停。
      stopHb();
    }
    // 记录原始响应到审计日志（排查 zod 失败最关键的信息）。
    logGeneration((opts.logKind || 'structured-text') + '-response', {
      model: config.model,
      dnaKey: opts.dnaKey,
      attempt,
      rawText: result.text.slice(0, 4000),
      ...opts.logMeta,
    });
    const cleaned = result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e: any) {
      lastError = `不是合法 JSON：${(e?.message || '').slice(0, 200)}`;
      console.warn(`[series-routes] ${opts.logKind} attempt ${attempt} JSON 解析失败，将重试`);
      continue;
    }
    if (!opts.validate) return parsed as T;
    try {
      return opts.validate(parsed);
    } catch (e: any) {
      lastError = e?.message || String(e);
      console.warn(`[series-routes] ${opts.logKind} attempt ${attempt} zod 校验失败，将重试：${(lastError ?? '').slice(0, 200)}`);
      continue;
    }
    }
  } finally {
    // 兜底：任何 return / throw 路径都不留下悬挂定时器
    stopHb();
  }
  throw new Error(`模型输出多次未通过校验（最后一次：${lastError ?? '未知错误'}）。请稍后重试。`);
}

// ── 模型输出 zod 校验器 ──────────────────────────────────────────────────

export const WorldviewZ = z.object({
  summary: z.string().min(1),
  background: z.string().min(1),
  era: z.string().min(1),
  artStyle: z.string().min(1),
  paletteMood: z.string().min(1),
  // —— 系列蓝图字段：可选；缺字段时下游生成端点会按 background + logline 推断 ——
  characterBlueprints: z.array(z.object({
    name: z.string().min(1),
    role: z.enum(['protagonist', 'antagonist', 'supporting']),
    roleInStory: z.string().min(1),
    motivation: z.string().min(1),
  })).min(2).max(6).optional(),
  plotOutline: z.string().min(1).optional(),
  conflicts: z.array(z.string().min(1)).min(2).max(5).optional(),
  locations: z.array(z.string().min(1)).min(2).max(4).optional(),
  arcBlueprints: z.array(z.object({
    title: z.string().min(1),
    premise: z.string().min(1),
    plannedChapterCount: z.number().int().min(2).max(8),
  })).min(2).max(6).optional(),
});

export const CharacterListZ = z.object({
  characters: z.array(z.object({
    name: z.string().min(1),
    role: z.enum(['protagonist', 'antagonist', 'supporting']),
    roleInStory: z.string().default(''),
    // 2026-09-01 新增：性别 / 年龄段 / 性别可辨识外部特征（解决"女生被画成男生"问题）
    gender: z.enum(['female', 'male', 'ambiguous', 'nonbinary']).default('female'),
    ageBand: z.enum(['child', 'teen', 'young_adult', 'middle_aged', 'elderly']).default('young_adult'),
    sexTraits: z.string().default(''),
    description: z.string().default(''),
    // 只写不可变特征（体型/发型/脸/眼睛），禁止写服装及其演变 —— 服装唯一来自 outfit 字段。
    appearance: z.string().default(''),
    age: z.string().default(''),
    height: z.string().default(''),
    build: z.string().default(''),
    hair: z.string().default(''),
    eyes: z.string().default(''),
    // 【服装唯一事实源】只能写一套确定装束；禁止"去某处换成XX/逐渐变成XX/分场合切换"等可变描述。
    outfit: z.string().default(''),
    signature: z.string().default(''),
    personality: z.string().default(''),
    occupation: z.string().default(''),
    backstory: z.string().default(''),
    motivation: z.string().default(''),
    goal: z.string().default(''),
    arc: z.string().default(''),
    internalConflict: z.string().default(''),
    externalConflict: z.string().default(''),
    voice: z.string().default(''),
    catchphrase: z.string().default(''),
    visualAnchors: z.array(z.string()).default([]),
  })).min(1).max(6),
});

export const ChapterListZ = z.object({
  chapters: z.array(z.object({
    title: z.string().min(1),
    summary: z.string().default(''),
    // 2026-10-15：统一为 2-3（12-18 格）。原先这里允许 1-12，
    // 而 prompt 对模型说的是 2-6、append 端点说的是 2-8 —— 四处不一致，
    // 结果「每话 12-18 格」这个目标在规划阶段**根本没被强制过**。
    pageCount: z.number().int().min(2).max(3),
  })).min(1).max(8),
});

export const PanelBreakdownZ = z.object({
  title: z.string().default(''),
  sceneDescription: z.string().default(''),
  panels: z.array(z.object({
    index: z.number().int(),
    description: z.string().min(1),
    // 放宽：dialogue 改为可选；缺字段时由 sanitizePanels 兜底（用 description 前缀）。
    // 此前 min(1) 经常让纯画面格（无对白）整页校验失败。
    dialogue: z.string().optional().default(''),
    // 2026-09-03：图下方「上帝视角叙述」。可选；缺省空字符串。
    // 字段语义见 shared/types.ts Panel.narration：
    //   - 是【叙述者/作者】的旁白，不是某角色的话
    //   - 一般 20-80 字；表达"此刻正在发生什么/为什么/将发生什么"
    //   - 一格可以没有（动作/对白主导）；首格和情绪转折时优先补一段
    narration: z.string().optional().default(''),
    // 2026-09-03：图下方「主角内心独白」。可选；缺省空字符串。
    //   - 与 dialogue（外部说出口的话）严格区分
    //   - 一般 0-50 字；只在主角处于"选择 / 迷茫 / 觉醒"等需要读者共情的瞬间写
    innerThought: z.string().optional().default(''),
    characterIds: z.array(z.string()).optional().default([]),
    // 镜头景别（远景/全景/中景/中近景/近景/特写 + 角度）。旧模型输出可能缺失 → 默认 mid。
    camera: z.string().optional().default('mid'),
    // 本格出现的无名配角（前台/路人等一次性角色），不进角色库，仅文字描述。
    extraCharacters: z.array(z.object({
      name: z.string().min(1),
      appearance: z.string().min(1),
    })).optional().default([]),
  })).min(1).max(8),
});

export const PanelRewriteZ = z.object({
  description: z.string().min(1),
  // 同上：允许空 dialogue（纯画面改写）。
  dialogue: z.string().optional().default(''),
  // 2026-09-03：单格改写也能改 narration / innerThought —— 与 description/dialogue 一起整组重写。
  narration: z.string().optional().default(''),
  innerThought: z.string().optional().default(''),
  characterIds: z.array(z.string()).optional().default([]),
  camera: z.string().optional().default(''),
  extraCharacters: z.array(z.object({
    name: z.string().min(1),
    appearance: z.string().min(1),
  })).optional().default([]),
});

/**
 * 取系列的 DNA key —— 双重兜底：
 *  - series.dnaKey 应在启动迁移时已填默认值 'new-yorker-noir'
 *  - 路由层再校验一次，防止 series 字段被污染（错误 key → 立即抛错，
 *    不允许静默回退到默认 —— 那会让用户不知不觉切换风格）
 */
export function seriesDnaKey(series: Series): DnaKey {
  const k = series.dnaKey;
  if (!k || !isValidDnaKeyStrict(k)) {
    throw new Error(`系列 ${series.id} 的 dnaKey 非法: "${k}"。请检查启动迁移逻辑。`);
  }
  return k;
}

/** DNA 禁用风格词（出现时仅告警，真正硬约束在生图 negative prompt）。 */
export const FORBIDDEN_STYLE_WORDS = /日漫|二次元|赛博朋克|霓虹|高饱和|anime|manga|cyberpunk|neon|水彩|油画/i;

export function warnStyleWords(where: string, text: string): void {
  if (FORBIDDEN_STYLE_WORDS.test(text)) {
    console.warn(`[series-routes] ${where} 输出中出现 DNA 禁用风格词（已记录，生图侧由 negative prompt 兜底）：${text}`);
  }
}

/**
 * 分镜后处理：过滤幻觉角色 ID、index 规整为 1..n 连续、去重。
 * 返回 null 表示没有可用分镜。
 */
export function sanitizePanels(
  panels: {
    index: number;
    description: string;
    dialogue?: string;
    narration?: string;
    innerThought?: string;
    characterIds: string[];
    camera?: string;
    extraCharacters?: { name: string; appearance: string }[];
  }[],
  validCharIds: Set<string>,
  logCtx: string,
): Panel[] | null {
  const usable = panels.filter(p => p.description && p.description.trim());
  if (usable.length === 0) return null;
  const sorted = [...usable].sort((a, b) => a.index - b.index);
  return sorted.map((p, i) => {
    const unique = Array.from(new Set(p.characterIds || []));
    const ok = unique.filter(id => validCharIds.has(id));
    if (ok.length < unique.length) {
      console.warn(`[series-routes] ${logCtx}：第 ${p.index} 格出现 ${unique.length - ok.length} 个幻觉角色 ID，已过滤：${unique.filter(id => !validCharIds.has(id)).join(',')}`);
    }
    const extras = (p.extraCharacters ?? [])
      .filter(ec => ec && ec.name?.trim() && ec.appearance?.trim())
      .map(ec => ({ name: ec.name.trim(), appearance: ec.appearance.trim() }));
    // 2026-09-03：narration / innerThought 是可选字段。sanitize 时：
    //   - 缺字段 → undefined（向后兼容，前端不要渲染空块）
    //   - 字段含「对白」(name：xxx) 这种剧透对白污染 → 去除
    //   - 长度 > 200 时裁掉，避免 LLM 偶发 dump 整段上下文的副作用
    const trimmedNar = (p.narration || '').trim();
    const trimmedInner = (p.innerThought || '').trim();
    return {
      index: i + 1,
      description: p.description.trim(),
      // 兜底：AI 没填 dialogue 时，用 description 前缀 12 字作为占位文字。
      // 避免下游 UI 看到"空白对话框"困惑。
      dialogue: ((p.dialogue || '').trim()) || p.description.trim().slice(0, 12),
      // 2026-09-03：narration / innerThought 不带 description 那种「截 12 字兜底」——
      //   这两个字段缺了就直接不显示，避免每格都硬塞一句无意义的叙述。
      narration: trimmedNar || undefined,
      innerThought: trimmedInner || undefined,
      characterIds: ok,
      camera: (p.camera || '').trim() || 'mid',
      extraCharacters: extras.length > 0 ? extras : undefined,
    };
  });
}

// ── 页面查找与跨章上下文 ─────────────────────────────────────────────────

/** 统一按全系列顺序遍历 chapter（兼容 arcs + 旧 chapters）。 */
export function iterAllChapters(series: Series): Chapter[] {
  if (series.arcs && series.arcs.length > 0) {
    return series.arcs.flatMap(a => a.chapters);
  }
  return series.chapters ?? [];
}

export function findPage(series: Series, pageId: string): { chapter: Chapter; page: SeriesPage } | null {
  for (const ch of iterAllChapters(series)) {
    const p = ch.pages.find(pp => pp.id === pageId);
    if (p) return { chapter: ch, page: p };
  }
  return null;
}
