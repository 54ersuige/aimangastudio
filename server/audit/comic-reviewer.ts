/**
 * 连载漫画审核师（2026-09-07 · 漫画审核大师重构）。
 *
 * 取代之前那个"靠元数据打分"的虚架子 —— 现在每次出图调用 vision provider
 * 按 8 个维度给单格评分，像 Shueisha 编辑部 / New Yorker 主编那样审稿。
 *
 * 设计原则：
 *  - 复用现有的 vision provider (minimax / agnes)，调用方式同 limb-guard
 *  - 8 维独立打分，每维 0-10；加权得 0-100 总分
 *  - 每维必须给 "pass/fail + 一句中文原因"，便于 UI 展示
 *  - 总分 <70 → 触发自动重生成闭环（在 generatePanelImages 里接入）
 *  - 调用失败 / 未启用 → 返回 null（绝不阻塞主流程）
 */
import { getConfig } from '../config.js';
import { getTextProvider } from '../series-routes/helpers.js';
import { logGeneration } from '../utils.js';
import { hashImageDataUrl } from './panel-audit.js';

/** 8 维度评分键。 */
export type DimensionKey =
  | 'D1_character_consistency'
  | 'D2_cinematography'
  | 'D3_composition'
  | 'D4_style_consistency'
  | 'D5_expression_emotion'
  | 'D6_outfit_consistency'
  | 'D7_scene_continuity'
  | 'D8_visual_pacing';

/** 8 维度权重：人物连续性 / 镜头语言 / 构图 / 风格 / 表情 / 装束 / 场景 / 节奏。 */
export const DIMENSION_WEIGHTS: Record<DimensionKey, number> = {
  D1_character_consistency: 0.22, // 连载命脉：人物必须稳定
  D2_cinematography: 0.18,        // New Yorker DNA 核心要求
  D3_composition: 0.14,
  D4_style_consistency: 0.12,
  D5_expression_emotion: 0.12,    // 表情克制是 DNA 硬约束
  D6_outfit_consistency: 0.10,
  D7_scene_continuity: 0.06,
  D8_visual_pacing: 0.06,
};

export const DIMENSION_LABELS_ZH: Record<DimensionKey, string> = {
  D1_character_consistency: '人物连续性',
  D2_cinematography: '镜头语言',
  D3_composition: '构图分镜',
  D4_style_consistency: '风格一致性',
  D5_expression_emotion: '表情情绪',
  D6_outfit_consistency: '装束一致性',
  D7_scene_continuity: '场景连贯',
  D8_visual_pacing: '视觉节奏',
};

/** 单维评分（0-10 + 一句原因）。 */
export interface DimensionScore {
  score: number;       // 0-10
  reason: string;      // 一句中文原因（≤40 字）
}

/** 单格评审结果。 */
export interface PanelReview {
  /** 8 维独立评分。 */
  dimensions: Record<DimensionKey, DimensionScore>;
  /** 加权总分（0-100）。 */
  overall: number;
  /** 最重要的一条修改建议（≤40 字中文）。 */
  topIssue: string;
  /** 评审意见：publish / revise / reject。 */
  verdict: 'publish' | 'revise' | 'reject';
  /** vision model 自身的置信度（0-1）。 */
  confidence: number;
}

export interface PanelReviewContext {
  /** 本格 sceneDescription（页 scene 长描述）。 */
  sceneDescription: string;
  /** 本格 description（分镜长描述）。 */
  panelDescription: string;
  /** 出场角色描述（每条 ≤ 30 字中文 + gender）。 */
  characterSummaries: string[];
  /** 角色参考图（dataURL 数组）—— 多模态模型可以同时看到脸/装束/出图三者。 */
  referenceImages: string[];
  /** 本系列 worldview 摘要（artStyle + paletteMood）。 */
  worldview?: string;
}

/**
 * 主审入口 —— 调用 vision provider 评审一张分镜，返回结构化 PanelReview。
 *
 * 失败/未启用 → 返回 null（绝不阻塞主流程）。
 */
/**
 * 单次评审调用（内部）。返回 null 表示本次尝试失败。
 */
async function reviewPanelOnce(
  imageDataUrl: string,
  ctx: PanelReviewContext,
): Promise<PanelReview | null> {
  const cfg = getConfig().vision;
  const sysInstruction = buildReviewerSystemInstruction();
  const userText = buildReviewerUserPrompt(ctx);

  try {
    const provider = getTextProvider({ provider: cfg.provider as any });
    const refImages: Array<{ data: string; mimeType: string }> = [
      { data: imageDataUrl, mimeType: 'image/png' },
      ...ctx.referenceImages.slice(0, 4).map(d => ({ data: d, mimeType: 'image/png' })),
    ];
    const resp = await provider.generateText(cfg as any, {
      prompt: userText,
      systemInstruction: sysInstruction,
      referenceImages: refImages,
      jsonMode: true,
      temperature: 0,
      // 2026-09-10 实测（api.deepseek.com 直连探针，usage 字段）：DeepSeek V4.1 Flash 是推理模型，
      //   「单张图」评审 → reasoning_tokens 2208~3193，正文仅 ~630 字符（约 400 tokens）。
      //   即 max_tokens 的绝大部分被"思考"吃掉，正文极小。
      // 本评审输入 = 本格图 + 最多 4 张角色参考图（共 5 张），推理量随图片数上升，
      //   8000 会被思考吃光 → 正文在 "D6_outfit_consistency" 处被截断。提高配额不增加费用
      //   （max_tokens 只是上限，模型写完即停）。探针已验证 API 接受 16000（finish_reason: stop）。
      maxTokens: 16000,
    });
    const txt = (resp.text || '').trim();
    if (!txt) {
      // 模型返回空 —— 通常是该模型不支持图片输入（如纯文本模型），
      // 静默吞掉会让用户以为在审、实际没审。留痕 + 醒目警告。
      logGeneration('comic-reviewer-empty', { model: cfg.model, provider: cfg.provider });
      console.warn('[comic-reviewer] vision 返回空文本 —— 大概率该模型不支持图片输入。请到设置里换支持视觉的 provider（如 Gemini）。');
      return null;
    }
    const parsed = parseReviewerResponse(txt);
    if (!parsed) {
      logGeneration('comic-reviewer-parse-fail', {
        model: cfg.model,
        rawLen: txt.length,
        rawHead: txt.slice(0, 400),
        // 尾部 + 长度是判别「结构错位」与「max_tokens 截断」的关键证据：
        // 停在字符串中间(尾部无 '}') = 截断；尾部有完整 '}' = 结构错位。
        rawTail: txt.slice(-200),
      });
      console.warn('[comic-reviewer] vision 返回 JSON 解析失败，已留痕');
      return null;
    }
    return parsed;
  } catch (e: any) {
    logGeneration('comic-reviewer-error', { model: cfg.model, error: String(e?.message || e).slice(0, 300) });
    console.warn('[comic-reviewer] 调用失败:', e?.message || e);
    return null;
  }
}

export async function reviewPanel(
  imageDataUrl: string,
  ctx: PanelReviewContext,
): Promise<PanelReview | null> {
  const cfg = getConfig().vision;
  if (!cfg.enabled) return null;
  if (!cfg.apiKey || !cfg.baseUrl) {
    // 视觉 provider 没配好 → 跳过（留痕，不再无限静默）
    logGeneration('comic-reviewer-skip', { reason: 'vision apiKey/baseUrl 未配置' });
    return null;
  }
  // 2026-09-08：Agnes 网关偶发空响应/瞬时 500（实测约 1/3 概率），最多重试 2 次兜底
  //（3 次全失败概率 ≈ 4%）。
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await reviewPanelOnce(imageDataUrl, ctx);
    if (r) return r;
    if (attempt < 3) logGeneration('comic-reviewer-retry', { model: cfg.model, attempt });
  }
  return null;
}

/**
 * 系统 prompt：让模型进入"集英社主编 / New Yorker 主编"人设。
 */
function buildReviewerSystemInstruction(): string {
  return [
    'You are a senior editor at a prestige comic magazine (Shueisha / New Yorker / Le Journal).',
    'Your only job is to REVIEW a single comic panel image against 8 serialization-critical criteria.',
    'You are rigorous, specific, and brief. You NEVER score without justification.',
    'You ALWAYS output strict JSON with the schema below — no commentary outside JSON.',
    '',
    'Scoring rules:',
    '  - Each dimension is 0..10 (10 = meets professional publication standard).',
    '  - 8 = publishable with light touch-ups',
    '  - 6 = solid amateur work',
    '  - 4 = needs revision',
    '  - 2 = amateur mistakes',
    '  - 0 = unacceptable / violates the rule',
    '  - reason MUST be ONE concise Chinese sentence (≤ 40 chars) explaining pass/fail.',
    '  - top_issue MUST be the SINGLE most important fix (≤ 40 chars Chinese).',
    '  - overall is a weighted average × 10 (so 0..100).',
    '  - verdict: "publish" (overall ≥ 85), "revise" (overall 50-84), "reject" (overall < 50).',
    '',
    'Strict JSON schema:',
    '{',
    '  "dimensions": {',
    '    "D1_character_consistency": { "score": number, "reason": string },',
    '    "D2_cinematography":        { "score": number, "reason": string },',
    '    "D3_composition":           { "score": number, "reason": string },',
    '    "D4_style_consistency":     { "score": number, "reason": string },',
    '    "D5_expression_emotion":    { "score": number, "reason": string },',
    '    "D6_outfit_consistency":    { "score": number, "reason": string },',
    '    "D7_scene_continuity":      { "score": number, "reason": string },',
    '    "D8_visual_pacing":         { "score": number, "reason": string }',
    '  },',
    '  "overall":    number,',
    '  "top_issue":  string,',
    '  "verdict":    "publish" | "revise" | "reject",',
    '  "confidence": number (0..1)',
    '}',
  ].join('\n');
}

/**
 * 用户 prompt：把场景 / 分镜 / 角色 / 参考图喂给模型。
 */
function buildReviewerUserPrompt(ctx: PanelReviewContext): string {
  const lines: string[] = [];
  lines.push('Review this panel. Context:');
  if (ctx.worldview) lines.push(`世界观/画风：${ctx.worldview}`);
  lines.push(`场景：${ctx.sceneDescription}`);
  lines.push(`本分镜：${ctx.panelDescription}`);
  if (ctx.characterSummaries.length > 0) {
    lines.push('出场角色：');
    for (const cs of ctx.characterSummaries.slice(0, 6)) lines.push(`- ${cs}`);
  }
  lines.push('');
  lines.push('Compare image[0] against reference images[1..N] (same characters/look).');
  lines.push('Return ONLY the JSON object — no preamble.');
  return lines.join('\n');
}

/**
 * 解析 vision 返回的 JSON 并按权重计算 overall。
 * 容错：解析失败 / 字段缺失 → 返回 null（视作调用失败）。
 */
function tryParseJson(s: string): any {
  try { return JSON.parse(s); } catch { return null; }
}

/**
 * 补全「字符串都已闭合、只是括号没配平」的 JSON；不能安全抢救时返回 null。
 *
 * 2026-09-10 实测（10 次连续调用复现 3 次）：DeepSeek V4.1 Flash 会把
 * overall/top_issue/verdict/confidence 直接写进 dimensions 里，漏掉 dimensions 的
 * 收尾括号，于是整个对象少一个 '}' —— JSON.parse 报
 * "Expected ',' or '}' after property value in JSON at position <末尾>"。
 * 这是**结构错位**而非截断：文本末尾的 '}' 是完整的，只是层级少收了一层。
 *
 * 反向保护：若扫描结束时仍在字符串内（说明是 max_tokens 真截断），不抢救 ——
 * 否则会把残缺的 8 维评分当成有效评审，让缺失维度按 5 分计入总分。
 */
export function repairUnbalancedJson(s: string): string | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
  }
  if (inStr || depth <= 0) return null;
  return s + '}'.repeat(depth);
}

function parseReviewerResponse(txt: string): PanelReview | null {
  // 有些模型会在 JSON 前后塞 ```json``` 标签，剥掉
  const cleaned = txt.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  let p = tryParseJson(cleaned);
  if (!p) {
    const repaired = repairUnbalancedJson(cleaned);
    if (repaired) p = tryParseJson(repaired);
  }
  if (!p || typeof p !== 'object') return null;
  // 2026-09-10 实测第三种形态（logs/generations.jsonl 留痕）：模型偶尔把答案套一层信封 ——
  // {"type":"json_object","content":{"dimensions":{...},"overall":...}}
  // JSON 合法但 dimensions 取不到。剥掉这层信封再继续。
  if (!p.dimensions && p.content && typeof p.content === 'object') p = p.content;
  const dims = p.dimensions;
  if (!dims || typeof dims !== 'object') return null;
  // 上面「summary 字段被误嵌进 dimensions」的修复结果里，overall/top_issue/verdict
  // 位于 dimensions 内 —— 顶层取不到时回退到 dimensions 内，避免修正指令丢失 topIssue。
  const pick = (k: string): unknown => (p[k] !== undefined ? p[k] : dims[k]);
  const result: PanelReview = {
    dimensions: {} as Record<DimensionKey, DimensionScore>,
    overall: 0,
    topIssue: typeof pick('top_issue') === 'string' ? (pick('top_issue') as string).slice(0, 60) : '',
    verdict: (() => {
      const v = pick('verdict');
      return v === 'publish' || v === 'revise' || v === 'reject' ? v : 'revise';
    })(),
    confidence: clamp01(typeof pick('confidence') === 'number' ? (pick('confidence') as number) : 0.5),
  };
  let weightedSum = 0;
  let weightTotal = 0;
  const keys: DimensionKey[] = [
    'D1_character_consistency', 'D2_cinematography', 'D3_composition',
    'D4_style_consistency', 'D5_expression_emotion', 'D6_outfit_consistency',
    'D7_scene_continuity', 'D8_visual_pacing',
  ];
  for (const k of keys) {
    const d = dims[k];
    if (!d || typeof d.score !== 'number') {
      result.dimensions[k] = { score: 5, reason: '未评分' };
      continue;
    }
    const score = clamp(d.score, 0, 10);
    const reason = typeof d.reason === 'string' ? d.reason.slice(0, 60) : '';
    result.dimensions[k] = { score, reason };
    weightedSum += score * DIMENSION_WEIGHTS[k];
    weightTotal += DIMENSION_WEIGHTS[k];
  }
  // overall = 加权平均 × 10（让 0-10 → 0-100）
  result.overall = Math.round((weightedSum / weightTotal) * 10);
  return result;
}

function clamp01(n: number): number { return Math.max(0, Math.min(1, n)); }
function clamp(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, n)); }

/**
 * 阈值：总分 < 此值 → 触发自动重画。
 *
 * 2026-10-15：70 → 78。
 * 依据是真实出图跑出来的数据，不是拍脑袋 ——
 * 一次 6 格实跑里，审核给出的分数是 66 / 67 / 79 / 84，
 * 但那几张图**故事说得清、情绪也对**（用户看过原图确认）。
 * 70 的线会把这种图拖进重试，而每次重试 = 一次出图 + 一次审核 ≈ 2 分钟。
 * 门槛定在"只有明显不合格才重来"，配合重试次数降到 1 次（见 prompts.ts
 * MAX_TOTAL_ATTEMPTS），最坏情况也不会停滞。
 */
export const REGENERATE_THRESHOLD = 78;

/**
 * 总结一次评审的失败原因（用于审计 + UI）。
 */
export function summarizeFailure(review: PanelReview): string {
  if (review.verdict === 'publish') return 'ok';
  // 找最低分维度作为主要问题
  let worst: DimensionKey = 'D1_character_consistency';
  let worstScore = 99;
  for (const k of Object.keys(review.dimensions) as DimensionKey[]) {
    if (review.dimensions[k].score < worstScore) {
      worstScore = review.dimensions[k].score;
      worst = k;
    }
  }
  const label = DIMENSION_LABELS_ZH[worst];
  const reason = review.dimensions[worst].reason || '质量未达';
  return `${label}(${worstScore}/10)：${reason}`.slice(0, 100);
}

/** 用于审计的 hash 辅助（避免导入循环）。 */
export function safeImageHash(d: string): string {
  return hashImageDataUrl(d);
}