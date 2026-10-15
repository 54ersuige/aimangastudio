/**
 * 分镜出图「四闸合一」（2026-10-15）。
 *
 * ## 为什么合并
 * 合并前，一张图要过四道闸，每道闸各调一次 vision：
 *
 *   | 闸 | 调用 | 输入图 | maxTokens | 内部重试 |
 *   |---|---|---|---|---|
 *   | limb-guard | 1 次 | 1 张 | 8000 | — |
 *   | gender-audit | 1 次 | 1 张 | 8000 | — |
 *   | comic-reviewer | 1~3 次 | 1 + ≤4 张参考图 | 16000 | 3 |
 *   | alignment-guard | 1 次 | 1 张 | 8000 | — |
 *
 * 即**典型 4 次、最坏 6 次 vision 调用**，而其中 3 次读的是**同一张图**、
 * 问的是**互相独立**的子问题。推理型视觉模型的思考 token 是主要开销，
 * 三次重读同一张图并不会让它想得更准，只是把同一份推理付三遍钱。
 *
 * 合并后：**1 次调用**同时返回肢体 / 性别 / 8 维评分 / 图文对齐四块，
 * 四块共用同一份视觉编码与推理上下文。
 *
 * ## 合并没有牺牲什么
 *  - 肢体修复（inpaint）**保留且独立** —— 见 `limb-guard.repairLimbRegions`。
 *    检测合并、修复不动，因为局部修补是唯一能保住"已付费的好图"的手段。
 *  - 四道闸的**判定逻辑与阈值一字未改**（REGENERATE_THRESHOLD / 0.6 置信度 /
 *    alignment 缺一即重画），只是"谁来问"换了。
 *  - 任一块解析失败 → 该块返回 null → 上游按 fail-open 视作通过，与原行为一致。
 *
 * ## 省 token 的三招
 *  1. **一次调用代替四次**（最大头）。
 *  2. **按图片 + 输入指纹缓存**（`gateKey`）：同一张图在同一套检查条件下
 *     只审一次。命中场景：limb inpaint 后复审、重画路径复审同一张图、
 *     审计 Tab 重新拉取。
 *  3. **定向复审**（`focusDimensions`）：第 2 轮起只让模型重新叙述上一轮
 *     失分的维度，省掉其余 6 维的输出与思考。未复核的维度**继承上一轮的真实分数**，
 *     不落到"未评分=5 分"的默认值 —— 否则审计数据会被污染，
 *     而审计的用途恰恰是回答"审核到底有没有用"。
 */
import { createHash } from 'crypto';
import { getConfig } from './config.js';
import { getTextProvider } from './series-routes/helpers.js';
import { logGeneration } from './utils.js';
import { hashImageDataUrl } from './audit/panel-audit.js';
import {
  repairUnbalancedJson,
  DIMENSION_WEIGHTS,
  DIMENSION_LABELS_ZH,
  REGENERATE_THRESHOLD,
  type DimensionKey,
  type DimensionScore,
  type PanelReview,
} from './audit/comic-reviewer.js';
import type { LimbAudit, GenderAudit } from './limb-guard.js';
import type { AlignmentAudit } from './alignment-guard.js';

const ALL_DIMENSIONS: DimensionKey[] = [
  'D1_character_consistency',
  'D2_cinematography',
  'D3_composition',
  'D4_style_consistency',
  'D5_expression_emotion',
  'D6_outfit_consistency',
  'D7_scene_continuity',
  'D8_visual_pacing',
];

export interface PanelGateInput {
  /** 待审图（dataURL）。 */
  imageDataUrl: string;
  sceneDescription: string;
  panelDescription: string;
  characterSummaries: string[];
  /** 角色参考图 dataURL（调用方已截到 ≤4 张）。 */
  referenceImages: string[];
  worldview: string;
  /** 主角期望性别；null = 不做性别校验。 */
  expectedGender: 'female' | 'male' | 'ambiguous' | null;
  /** 抽取好的可核验要素清单；null / 空 = 不做对齐校验。 */
  alignmentItems: string[] | null;
  /**
   * 定向复审：只复核这几维，其余维度继承 previousReview。
   * 传 null = 全量打分（第 1 轮）。
   */
  focusDimensions?: DimensionKey[] | null;
  /** 上一轮评审结果（focusDimensions 非 null 时用于继承未复核的维度）。 */
  previousReview?: PanelReview | null;
}

export interface PanelGateResult {
  limb: LimbAudit | null;
  gender: GenderAudit | null;
  review: PanelReview | null;
  alignment: AlignmentAudit | null;
  /** 本次结果是否来自缓存（true = 没花钱）。 */
  cached: boolean;
}

// ── 缓存 ──────────────────────────────────────────────────────────────────

interface CacheEntry {
  result: Omit<PanelGateResult, 'cached'>;
  expiresAt: number;
}

/** 24 小时：图不会在同一天内变，但跨天必须重审（风格参考图可能被重生成）。 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** 上限防止内存无界增长；超出按插入顺序丢最旧的。 */
const CACHE_MAX = 200;
const gateCache = new Map<string, CacheEntry>();

/** 测试用：清空审核缓存。 */
export function clearGateCache(): void {
  gateCache.clear();
}

/** 测试用：当前缓存条目数。 */
export function gateCacheSize(): number {
  return gateCache.size;
}

/**
 * 缓存键 = 图片 hash + **全部**会影响结果的输入。
 *
 * 刻意把 referenceImages 的 hash 也算进去：D1/D6（人物/装束连续性）
 * 是拿参考图对比出来的，换了参考图就换了判分依据。
 * 少算一项 = 会把"参考图已经换了"的旧结论当成新结论 —— 这是最危险的一种缓存错误。
 */
export function buildGateKey(input: PanelGateInput): string {
  const refHashes = input.referenceImages.map(hashImageDataUrl).join(',');
  const fingerprint = JSON.stringify({
    img: hashImageDataUrl(input.imageDataUrl),
    scene: input.sceneDescription,
    panel: input.panelDescription,
    chars: input.characterSummaries,
    refs: refHashes,
    world: input.worldview,
    gender: input.expectedGender,
    align: input.alignmentItems,
    focus: input.focusDimensions ?? null,
  });
  return createHash('sha1').update(fingerprint).digest('hex');
}

function readCache(key: string): Omit<PanelGateResult, 'cached'> | null {
  const hit = gateCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    gateCache.delete(key);
    return null;
  }
  return hit.result;
}

function writeCache(key: string, result: Omit<PanelGateResult, 'cached'>): void {
  if (gateCache.size >= CACHE_MAX) {
    const oldest = gateCache.keys().next();
    if (!oldest.done) gateCache.delete(oldest.value);
  }
  gateCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ── prompt ────────────────────────────────────────────────────────────────

function buildSystemInstruction(): string {
  return [
    'You are the senior editor of a prestige comic magazine (Shueisha / New Yorker / Le Journal)',
    'AND its anatomy & continuity inspector, reviewing ONE comic panel image.',
    'You perform FOUR independent checks in a single pass and return all four in one JSON object.',
    'You are rigorous, specific, and brief. You NEVER score without justification.',
    'You ALWAYS output strict JSON — no commentary outside JSON.',
    '',
    '=== CHECK 1: ANATOMY (limb) ===',
    'Count for every visible human figure: arms (must be exactly 2), hands (exactly 2),',
    'fingers per hand (exactly 5). Detect extra arms from the torso, hands melting into props,',
    'near-identical mirror twins, a stray second head/torso, hand-on-prop illusions.',
    'Output "limb": { "abnormal": bool, "reason": str, "confidence": 0..1,',
    '                  "regions": [{x,y,w,h,label}] in NORMALIZED coords (0..1, top-left origin) }',
    'regions must be EMPTY when normal.',
    '',
    '=== CHECK 2: GENDER ===',
    'Report each visible figure\'s gender left-to-right using PHYSICAL cues only',
    '(never clothing alone): female = soft jawline, narrow shoulders, finer brow;',
    'male = hinted Adam\'s apple, harder jaw, broader shoulders, thicker brow;',
    'ambiguous = cannot tell. Be conservative: output "ambiguous" rather than guessing.',
    'Output "gender": { "observed": ["female"|"male"|"ambiguous", ...], "confidence": 0..1 }',
    'Omit this block entirely if no expected gender was given.',
    '',
    '=== CHECK 3: TEXT-IMAGE ALIGNMENT ===',
    'A fixed checklist of story elements is supplied. Decide for each whether it is',
    'VISIBLY depicted.',
    '  - present=true if clearly recognizable (partial occlusion or cropping by camera framing',
    '    still counts as present if the main body is recognizable).',
    '  - present=false ONLY if clearly absent or clearly depicted wrongly.',
    '  - NEVER mark missing because of art style, perspective, small size, or lighting.',
    '  - NEVER invent elements that are not on the checklist.',
    'Output "alignment": { "results": [{ "text": str, "present": bool, "reason": str }] }',
    'reason is one short clause (max 20 chars), only when present=false.',
    'Omit this block entirely if no checklist was supplied.',
    '',
    '=== CHECK 4: EDITORIAL SCORING (8 dimensions) ===',
    'Each dimension is 0..10 (10 = meets professional publication standard):',
    '  8 = publishable with light touch-ups; 6 = solid amateur work;',
    '  4 = needs revision; 2 = amateur mistakes; 0 = unacceptable.',
    '  reason MUST be ONE concise Chinese sentence (<= 40 chars) explaining pass/fail.',
    '  top_issue MUST be the SINGLE most important fix (<= 40 chars Chinese).',
    '  overall is a weighted average x 10 (so 0..100).',
    '  verdict: "publish" (>=85), "revise" (50-84), "reject" (<50).',
    '',
    'Strict JSON schema:',
    '{',
    '  "limb":  { "abnormal": boolean, "reason": string, "confidence": number, "regions": [...] },',
    '  "gender": { "observed": [string], "confidence": number },',
    '  "alignment": { "results": [ { "text": string, "present": boolean, "reason": string } ] },',
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
    '  "overall": number, "top_issue": string, "verdict": string, "confidence": number',
    '}',
  ].join('\n');
}

function buildUserPrompt(input: PanelGateInput): string {
  const lines: string[] = [];
  lines.push('Review this panel. Context:');
  if (input.worldview) lines.push(`世界观/画风：${input.worldview}`);
  lines.push(`场景：${input.sceneDescription}`);
  lines.push(`本分镜：${input.panelDescription}`);
  if (input.characterSummaries.length > 0) {
    lines.push('出场角色：');
    for (const cs of input.characterSummaries.slice(0, 6)) lines.push(`- ${cs}`);
  }
  lines.push('');

  if (input.expectedGender) {
    lines.push(`[CHECK 2] Expected dominant gender of the protagonist: ${input.expectedGender}.`);
    lines.push('');
  }
  if (input.alignmentItems && input.alignmentItems.length > 0) {
    lines.push('[CHECK 3] Story-element checklist to verify against the image:');
    input.alignmentItems.forEach((t, i) => lines.push(`${i + 1}. ${t}`));
    lines.push('');
  }

  const focus = input.focusDimensions;
  if (focus && focus.length > 0) {
    // 定向复审：只问失分维度，其余继承上一轮 —— 省掉 6 维的输出与思考。
    lines.push('[CHECK 4] RE-CHECK MODE. The previous version failed on these dimensions only.');
    for (const k of focus) {
      lines.push(`  Re-score ONLY: ${k} (${DIMENSION_LABELS_ZH[k]})`);
    }
    lines.push('Score those dimensions again against the fixes that were just applied.');
    lines.push('For all OTHER dimensions, output your previous score unchanged.');
    lines.push('');
  } else {
    lines.push('[CHECK 4] Score all 8 dimensions.');
    lines.push('');
  }

  lines.push('Compare image[0] against reference images[1..N] (same characters/look).');
  lines.push('Return ONLY the JSON object — no preamble.');
  return lines.join('\n');
}

// ── 解析 ──────────────────────────────────────────────────────────────────

/** 与 comic-reviewer.parseLooseJson 同款三层修复：剥标签 → parse → 补括号 → 剥信封。 */
function parseLooseJson(s: string): any {
  const cleaned = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(cleaned); } catch { /* fallthrough */ }
  const repaired = repairUnbalancedJson(cleaned);
  if (repaired) {
    try { return JSON.parse(repaired); } catch { /* fallthrough */ }
  }
  return null;
}

function clamp01(n: number): number { return Math.max(0, Math.min(1, n)); }

function parseLimb(p: any): LimbAudit | null {
  const b = p?.limb;
  if (!b || typeof b !== 'object' || typeof b.abnormal !== 'boolean') return null;
  return {
    people: Number(b.people) || 0,
    hands: Number(b.hands) || 0,
    arms: Number(b.arms) || 0,
    abnormal: b.abnormal,
    reason: String(b.reason || '').slice(0, 200),
    regions: Array.isArray(b.regions)
      ? b.regions
        .filter((r: any) => r && typeof r.x === 'number' && typeof r.y === 'number')
        .map((r: any) => ({
          x: clamp01(r.x),
          y: clamp01(r.y),
          w: clamp01(r.w ?? 0.15),
          h: clamp01(r.h ?? 0.15),
          label: String(r.label || 'limb artifact').slice(0, 80),
        }))
      : [],
    confidence: typeof b.confidence === 'number' ? clamp01(b.confidence) : 0.5,
  };
}

function parseGender(p: any, expected: 'female' | 'male' | 'ambiguous'): GenderAudit | null {
  const g = p?.gender;
  if (!g || !Array.isArray(g.observed) || g.observed.length === 0) return null;
  const observed = g.observed.map((s: any) => {
    const v = String(s || '').toLowerCase().trim();
    if (v.startsWith('f')) return 'female' as const;
    if (v.startsWith('m')) return 'male' as const;
    return 'ambiguous' as const;
  });
  const mismatchIndices: number[] = [];
  observed.forEach((g2: 'female' | 'male' | 'ambiguous', i: number) => {
    if (g2 === 'ambiguous') return; // ambiguous 视为通过 —— 不误判中性角色
    if (g2 !== expected) mismatchIndices.push(i);
  });
  return {
    observedGenders: observed,
    expectedGender: expected,
    mismatch: mismatchIndices.length > 0,
    mismatchIndices,
    reason: mismatchIndices.length > 0
      ? `图中有 ${mismatchIndices.length} 个人物性别与预期不符（预期 ${expected}）`
      : '',
    confidence: typeof g.confidence === 'number' ? clamp01(g.confidence) : 0.5,
  };
}

function parseAlignment(p: any, items: string[]): AlignmentAudit | null {
  const a = p?.alignment;
  if (!a || !Array.isArray(a.results) || a.results.length === 0) return null;
  const missing = a.results
    .filter((r: any) => r && r.present !== true)
    .map((r: any) => String(r.text || '').trim())
    .filter(Boolean);
  return {
    // 硬标准：缺任意 1 项 → 不达标（与原 verifyAlignment 一致）。
    ok: missing.length === 0,
    items,
    missing,
    reason: missing.length > 0 ? `缺：${missing.slice(0, 3).join('、')}` : '',
    confidence: a.results.length > 0 ? clamp01(a.results.filter((r: any) => r?.present === true).length / a.results.length) : 0,
  };
}

function parseReview(
  p: any,
  focus: DimensionKey[] | null,
  previous: PanelReview | null,
): PanelReview | null {
  const dims = p?.dimensions;
  if (!dims || typeof dims !== 'object') return null;

  const scores: Record<string, DimensionScore> = {};
  let weightedSum = 0;
  let weightTotal = 0;
  const focusSet = focus && focus.length > 0 ? new Set(focus) : null;

  for (const k of ALL_DIMENSIONS) {
    // 定向复审时，未列入 focus 的维度继承上一轮真实分数；
    // 没有上一轮可继承（全量模式却缺这一维）才落 5 分默认值。
    const prevScore = previous?.dimensions?.[k];
    const d = dims[k];
    if (!d || typeof d.score !== 'number') {
      scores[k] = prevScore && typeof prevScore.score === 'number'
        ? { score: prevScore.score, reason: prevScore.reason ?? '' }
        : { score: 5, reason: '未评分' };
    } else {
      const score = Math.max(0, Math.min(10, d.score));
      scores[k] = {
        score,
        reason: typeof d.reason === 'string' ? d.reason.slice(0, 60) : '',
      };
    }
    // 定向复审里若模型仍把非 focus 维写成了 5 分占位，以继承值为准（防止刷分）。
    if (focusSet && !focusSet.has(k) && prevScore && scores[k].score !== prevScore.score) {
      scores[k] = { score: prevScore.score, reason: prevScore.reason ?? '' };
    }
    weightedSum += scores[k].score * DIMENSION_WEIGHTS[k];
    weightTotal += DIMENSION_WEIGHTS[k];
  }

  const pick = (key: string): unknown => (p[key] !== undefined ? p[key] : dims[key]);
  const verdictRaw = pick('verdict');
  return {
    dimensions: scores as Record<DimensionKey, DimensionScore>,
    overall: Math.round((weightedSum / weightTotal) * 10),
    topIssue: typeof pick('top_issue') === 'string' ? (pick('top_issue') as string).slice(0, 60) : (previous?.topIssue ?? ''),
    verdict: verdictRaw === 'publish' || verdictRaw === 'revise' || verdictRaw === 'reject'
      ? verdictRaw
      : (previous?.verdict ?? 'revise'),
    confidence: typeof pick('confidence') === 'number' ? clamp01(pick('confidence') as number) : (previous?.confidence ?? 0.5),
  };
}

// ── 主入口 ────────────────────────────────────────────────────────────────

/**
 * 跑四闸合一。
 *
 * 失败 / 未启用 → 全部字段 null（fail-open，上游视作通过，绝不阻塞出图）。
 * **不做内部重试**（原 comic-reviewer 内部重试 3 次）：
 * 网关偶发空响应确实存在，但一次调用失败时，这张图已经由其余三闸判过了，
 * 重试同一份 10MB payload 换来的是整体延迟翻倍；真正的兜底是
 * "审查失败 → 视作通过 → 图照常落盘"，用户永远不会因为审核失败而拿不到图。
 */
export async function runPanelGate(input: PanelGateInput): Promise<PanelGateResult> {
  const cfg = getConfig().vision;
  const disabled: PanelGateResult = { limb: null, gender: null, review: null, alignment: null, cached: false };
  if (!cfg.enabled) return disabled;
  if (!cfg.apiKey || !cfg.baseUrl) {
    logGeneration('panel-gate-skip', { reason: 'vision apiKey/baseUrl 未配置' });
    return disabled;
  }

  const key = buildGateKey(input);
  const cached = readCache(key);
  if (cached) return { ...cached, cached: true };

  try {
    const provider = getTextProvider({ provider: cfg.provider as any });
    const refImages: Array<{ data: string; mimeType: string }> = [
      { data: input.imageDataUrl, mimeType: 'image/png' },
      ...input.referenceImages.slice(0, 4).map(d => ({ data: d, mimeType: 'image/png' })),
    ];
    const resp = await provider.generateText(cfg as any, {
      prompt: buildUserPrompt(input),
      systemInstruction: buildSystemInstruction(),
      referenceImages: refImages,
      jsonMode: true,
      temperature: 0,
      // 2026-10-15：原 comic-reviewer 单审就是 16000（实测 DeepSeek V4.1 Flash
      // 在 5 张图下思考 2208~3193 tokens，正文会截断）。
      // 现在正文多了 limb/gender/alignment 三块，且**四块共用同一次推理** ——
      // 思考量不随检查项数线性增长，是最大的一笔共享成本。
      // 20000 是给正文留的余量；max_tokens 只是上限，模型写完即停，不增加费用。
      maxTokens: 20000,
    });

    const txt = (resp.text || '').trim();
    if (!txt) {
      logGeneration('panel-gate-empty', { model: cfg.model, provider: cfg.provider });
      console.warn('[panel-gate] vision 返回空文本 —— 大概率该模型不支持图片输入。四闸全部视作通过。');
      return disabled;
    }
    let p = parseLooseJson(txt);
    if (!p) {
      logGeneration('panel-gate-parse-fail', {
        model: cfg.model,
        rawLen: txt.length,
        rawHead: txt.slice(0, 400),
        rawTail: txt.slice(-200),
      });
      console.warn('[panel-gate] vision 返回 JSON 解析失败，四闸全部视作通过');
      return disabled;
    }
    // 剥信封：{"type":"json_object","content":{...}}
    if (!p.dimensions && p.content && typeof p.content === 'object') p = p.content;

    const result: Omit<PanelGateResult, 'cached'> = {
      limb: parseLimb(p),
      gender: input.expectedGender ? parseGender(p, input.expectedGender) : null,
      review: parseReview(p, input.focusDimensions ?? null, input.previousReview ?? null),
      alignment: input.alignmentItems && input.alignmentItems.length > 0
        ? parseAlignment(p, input.alignmentItems)
        : null,
    };
    if (!result.limb && !result.gender && !result.review && !result.alignment) {
      // 一次都没解析出来 —— 说明模型返回的结构整体不对，静默视作通过会掩盖问题。
      logGeneration('panel-gate-all-blocks-unparsed', { rawHead: txt.slice(0, 300) });
      console.warn('[panel-gate] 四块结果全部解析失败（结构可能已变），本次视作通过');
      return disabled;
    }
    writeCache(key, result);
    return { ...result, cached: false };
  } catch (e: any) {
    logGeneration('panel-gate-error', { model: cfg.model, error: String(e?.message || e).slice(0, 300) });
    console.warn('[panel-gate] 调用失败，四闸视作通过:', e?.message || e);
    return disabled;
  }
}

// ── 判定规则（与拆分版逐字一致，上游共用，避免两处漂移）────────────────────

/** 肢体：置信度 ≥ 0.6 才算异常（低置信度误报会白白丢掉整张图）。 */
export const LIMB_CONFIDENCE_FLOOR = 0.6;

export interface GateVerdict {
  ok: boolean;
  /** 各闸未通过的原因，'gate: 原因' 形式，可直接进审计。 */
  reasons: string[];
}

export function judgePanel(
  gate: PanelGateResult,
  opts: { alignmentItems: string[] | null },
): GateVerdict {
  const reasons: string[] = [];

  const limbOk = !gate.limb || !(gate.limb.abnormal && gate.limb.confidence >= LIMB_CONFIDENCE_FLOOR);
  if (!limbOk) reasons.push(`limb: ${gate.limb?.reason || 'abnormal'}`);

  const genderOk = !gate.gender || !gate.gender.mismatch;
  if (!genderOk) reasons.push(`gender: ${gate.gender?.reason || 'mismatch'}`);

  const reviewOk = gate.review == null || gate.review.overall >= REGENERATE_THRESHOLD;
  if (!reviewOk && gate.review) {
    reasons.push(`review(${gate.review.overall}): ${gate.review.topIssue || '质量未达'}`);
  }

  const alignmentOk = !opts.alignmentItems || opts.alignmentItems.length === 0
    || gate.alignment == null
    || gate.alignment.ok;
  if (!alignmentOk && gate.alignment && gate.alignment.missing.length > 0) {
    reasons.push(`alignment: ${gate.alignment.reason}`);
  }

  return { ok: reasons.length === 0, reasons };
}

/** limb 异常且有 bbox → 需要走 inpaint 局部修复。 */
export function needsLimbRepair(gate: PanelGateResult): LimbAudit | null {
  const l = gate.limb;
  if (!l || !l.abnormal || l.confidence < LIMB_CONFIDENCE_FLOOR) return null;
  return l.regions.length > 0 ? l : null;
}

/** gate → 审计字段的形状（与 PanelAuditRecord 中四个闸字段逐字对齐）。 */
export interface GateAuditFields {
  limbGuard: { abnormal: boolean; reason: string; confidence: number } | null;
  genderAudit: { mismatch: boolean; expected: string; observed: string[]; reason: string; confidence: number } | null;
  review: {
    overall: number;
    dimensions: Record<DimensionKey, DimensionScore>;
    topIssue: string;
    verdict: 'publish' | 'revise' | 'reject';
    confidence: number;
  } | null;
  alignmentAudit: {
    ok: boolean;
    items: string[];
    missing: string[];
    reason: string;
    confidence: number;
  } | null;
}

/**
 * 把合一闸结果翻译成审计结构 —— **纯函数，无条件覆盖**。
 *
 * 为什么必须是纯函数而不是就地赋值：审计变量声明在出图重试循环**外**（落盘在循环后），
 * 一旦写成 `if (gate.gender) genderAudit = ...`，第 1 轮的结论就会漏进第 2 轮的审计 ——
 * 表现为「审计说这张图性别不符，但它其实没问题」。
 * 而 audit 的存在意义恰恰是回答"审核到底有没有用、重画有没有真的提分"，
 * 被污染的审计比没有审计更糟。
 *
 * 抽成纯函数后，"每轮全覆盖"由返回类型保证，不依赖谁记得多写一个 else。
 *
 * @param gate            本轮的闸结果（inpaint 修补后应传入**修补后那张图**的结果）
 * @param alignmentItems  本格的抽取清单（null/空 = 未做对齐校验）
 * @param limbRepairNote  inpaint 修补失败的诊断信息，会并进 limb 的 reason
 */
export function gateToAuditFields(
  gate: PanelGateResult,
  alignmentItems: string[] | null,
  limbRepairNote: string | null = null,
): GateAuditFields {
  return {
    limbGuard: gate.limb
      ? {
        abnormal: gate.limb.abnormal,
        reason: limbRepairNote ? `${gate.limb.reason}；${limbRepairNote}` : gate.limb.reason,
        confidence: gate.limb.confidence,
      }
      : null,
    genderAudit: gate.gender
      ? {
        mismatch: gate.gender.mismatch,
        expected: gate.gender.expectedGender,
        observed: gate.gender.observedGenders,
        reason: gate.gender.reason,
        confidence: gate.gender.confidence,
      }
      : null,
    review: gate.review
      ? {
        overall: gate.review.overall,
        dimensions: gate.review.dimensions,
        topIssue: gate.review.topIssue,
        verdict: gate.review.verdict,
        confidence: gate.review.confidence,
      }
      : null,
    alignmentAudit: gate.alignment
      ? {
        ok: gate.alignment.ok,
        items: alignmentItems ?? gate.alignment.items,
        missing: gate.alignment.missing,
        reason: gate.alignment.reason,
        confidence: gate.alignment.confidence,
      }
      : null,
  };
}

export { ALL_DIMENSIONS };
