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
  /**
   * 画面里有没有可读文字（含伪汉字乱码）——2026-10-20 新增。
   *
   * 之前这个检查**根本不存在**：只有 prompt 里"叫模型别写字"、描述清洗、
   * DNA 里的一句约束（全是预防），出图真出了字没人查。
   * 2026-10-20 实测抓到一格屏幕上的伪汉字（"跛剃流搬己治云"）—— 漫画里
   * 出现乱码是最扎眼的硬伤之一，却一路无人拦下。
   */
  textInImage: TextInImageAudit | null;
  /** 本次结果是否来自缓存（true = 没花钱）。 */
  cached: boolean;
}

/** 画面内可读文字检查结果。 */
export interface TextInImageAudit {
  /** true = 画面里出现了可读文字或伪汉字（失败品）。 */
  hasReadableText: boolean;
  reason: string;
  confidence: number;
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

/** 2026-10-20 导出：让测试能直接锁住「分级规则写进 prompt 了」这件事。 */
export function buildSystemInstruction(): string {
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
    '',
    // 2026-10-20：把"缺了"再分成"大问题"和"细节" —— 只有大的才值得重画一次。
    'SEVERITY — classify every present=false item:',
    '  severity="critical" (a REAL problem worth redrawing the whole panel):',
    '    - a person who must be in this panel is entirely absent;',
    '    - a key story prop is entirely absent (the cup, the torn document, the key);',
    '    - the depicted action contradicts the description (sitting vs standing,',
    '      tearing the sheet vs handing it over);',
    '    - the number of people is wrong (three drawn where one is described).',
    '  severity="minor" (do NOT redraw for this — it is not worth the cost):',
    '    - the element is there but a secondary detail differs (a reflection, a',
    '      highlight, a tint, a slightly different angle, a minor accessory);',
    '    - the element is drawn but less prominent, smaller, or less detailed than',
    '      the description implies;',
    '    - a supporting background element is missing (a screen, a doorframe, a',
    '      second cup) while the main subject and main action are correct.',
    '',
    'IMPORTANT — these are NOT critical, do not mark them critical:',
    '  - a missing reflection / highlight / sheen / gloss / glint',
    '  - a missing colour nuance, shading, or texture',
    '  - a small pose or finger-position nuance',
    '  - the subject placed slightly differently than described',
    '  - a facial micro-expression, gaze direction, or subtle body tension',
    '  - any element that IS visible but not described with equal detail.',
    '  When in doubt, choose "minor". A wrong "critical" costs a full redraw.',
    '',
    'Output "alignment": { "results": [{ "text": str, "present": bool, "reason": str, "severity": "critical"|"minor" }] }',
    'reason is one short clause (max 20 chars), only when present=false.',
    'Omit this block entirely if no checklist was supplied.',
    '',
    '=== CHECK 5: READABLE TEXT IN IMAGE ===',
    'This magazine never prints readable text inside a panel. Screens, signage,',
    'posters, books, documents, product labels, clothing prints, licence plates —',
    'all must be blank, blurred, or reduced to abstract marks.',
    '',
    'Report whether the image contains ANY readable characters:',
    '  - real Chinese/Japanese/Latin words or sentences → hasReadableText = true',
    '  - GIBBERISH that imitates characters (fake strokes that look like',
    '    "跛剃流搬" or scrambled pseudo-Chinese) → hasReadableText = true',
    '    (this is a FAILURE, even though no real word is present)',
    '  - abstract strokes, scribbles, blurred smudges, non-character shapes → false',
    '  - a signature-like flourish with no legible characters → false',
    '',
    'IMPORTANT — do NOT report as text:',
    '  - panel borders, speech-bubble outlines without content, speed lines;',
    '  - patterns, hatching, or decorative marks that do not form characters;',
    '  - text that is too small/blurred to read as characters.',
    'When in doubt, report false. Only flag characters that are actually legible',
    'or clearly imitate characters.',
    'Output "textInImage": { "hasReadableText": bool, "reason": str, "confidence": 0..1 }',
    '',
    '=== CHECK 4: EDITORIAL SCORING (8 dimensions) ===',    'Each dimension is 0..10 (10 = meets professional publication standard):',
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
    '  "alignment": { "results": [ { "text": string, "present": boolean, "reason": string, "severity": "critical"|"minor" } ] },',
    '  "textInImage": { "hasReadableText": boolean, "reason": string, "confidence": number },',
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

/**
 * 图文对齐的分级判据：**只有 critical 缺失才不达标**。
 *
 * 2026-10-20 新增。旧判据是「呈现率 ≥ 60%」（isAlignmentAcceptable），
 * 问题在于呈现率**分不出大小** —— 抽 5 项、画对 4 项（其中 1 项是"缺反光"）
 * 照样判不通过 → 整格重画。
 *
 * 2026-10-20 实测一天：32 条触发重画，逐条看下来绝大多数是**细节级**缺失
 * （反光 / 泛白 / 微表情 / 位置偏差 / 次要背景物），画面其实是对的。
 *
 * 有 severity 字段 → 按 severity 判（只有 critical 才拦）；
 * 老数据没有 → 退回呈现率判据（向后兼容）。
 */
export function evaluateAlignmentResults(
  results: Array<{ text: string; present: boolean; reason?: string; severity?: 'critical' | 'minor' }>,
): { ok: boolean; missing: string[]; criticalMissing: string[]; reason: string } {
  const missing = results
    .filter(r => r && r.present !== true)
    .map(r => String(r.text || '').trim())
    .filter(Boolean);
  const hasSeverity = results.some(r => r && (r.severity === 'critical' || r.severity === 'minor'));
  if (!hasSeverity) {
    const presentCount = results.filter(r => r && r.present === true).length;
    const ok = isAlignmentAcceptable(presentCount, results.length);
    return {
      ok,
      missing: ok ? [] : missing,
      criticalMissing: [],
      reason: ok ? '' : `缺：${missing.slice(0, 3).join('、')}`,
    };
  }
  const criticalMissing = results
    .filter(r => r && r.present !== true && r.severity === 'critical')
    .map(r => String(r.text || '').trim())
    .filter(Boolean);
  const ok = criticalMissing.length === 0;
  const reasonItems = criticalMissing.length > 0 ? criticalMissing : missing;
  return {
    ok,
    missing: ok ? [] : reasonItems,
    criticalMissing: ok ? [] : criticalMissing,
    reason: ok ? '' : `缺：${reasonItems.slice(0, 3).join('、')}`,
  };
}

function parseTextInImage(p: any): TextInImageAudit | null {
  const t = p?.textInImage;
  if (!t || typeof t.hasReadableText !== 'boolean') return null;
  return {
    hasReadableText: t.hasReadableText === true,
    reason: String(t.reason || '').trim(),
    confidence: typeof t.confidence === 'number' ? clamp01(t.confidence) : 0.5,
  };
}

function parseAlignment(p: any, items: string[]): AlignmentAudit | null {
  const a = p?.alignment;
  if (!a || !Array.isArray(a.results) || a.results.length === 0) return null;
  const present = a.results.filter((r: any) => r && r.present === true);
  const verdict = evaluateAlignmentResults(a.results);
  return {
    ok: verdict.ok,
    items,
    // 只在真的不达标时才记缺失项：达标但漏了一两个是正常的，
    // 全量塞进审计只会让人以为出了大问题。
    missing: verdict.missing,
    criticalMissing: verdict.criticalMissing,
    reason: verdict.reason,
    confidence: a.results.length > 0 ? clamp01(present.length / a.results.length) : 0,
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

  const pick = (k: string): unknown => (p[k] !== undefined ? p[k] : dims[k]);
  const confidence = typeof pick('confidence') === 'number' ? clamp01(pick('confidence') as number) : (previous?.confidence ?? 0.5);

  // ── 「没审到」必须与「审了但是 0 分」区分开 ──
  // 2026-10-16 实测抓到：某一格模型**没收到图**，回了
  //   dimensions 全 0 + reason「无图像输入，无法评分。」+ confidence 0
  // 解析器把它当成一次有效评审，overall=0 < 阈值 → 触发重画。
  // 代价有三：白白重画一次、把 0 分写进连载质量分与 8 维均分、
  // 在审计面板上显示成刺眼的红色 0/100，让人以为是"最差的图"。
  //
  // 判据：overall 恰好为 0 **且** confidence 为 0。
  // 真·糟糕的图模型照样会给分（低分但非 0），且 confidence 不会是 0；
  // 只有"根本没审"才会同时出现 0 分和 0 置信度。
  // 命中 → 返回 null，走 fail-open（视作通过），与其它解析失败路径一致。
  const overall = Math.round((weightedSum / weightTotal) * 10);
  if (overall === 0 && confidence === 0) {
    logGeneration('panel-gate-not-reviewed', {
      reason: '全部维度 0 分且 confidence=0 —— 判定为未审到（模型未收到图）',
      topIssue: typeof pick('top_issue') === 'string' ? (pick('top_issue') as string).slice(0, 120) : '',
    });
    return null;
  }

  const verdictRaw = pick('verdict');
  return {
    dimensions: scores as Record<DimensionKey, DimensionScore>,
    overall,
    topIssue: typeof pick('top_issue') === 'string' ? (pick('top_issue') as string).slice(0, 60) : (previous?.topIssue ?? ''),
    verdict: verdictRaw === 'publish' || verdictRaw === 'revise' || verdictRaw === 'reject'
      ? verdictRaw
      : (previous?.verdict ?? 'revise'),
    confidence,
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
  const disabled: PanelGateResult = { limb: null, gender: null, review: null, alignment: null, textInImage: null, cached: false };
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
      // 2026-10-20：画面内可读文字检查（新增第五道闸）。
      // 复用同一次 vision 调用，不增加任何调用成本。
      textInImage: parseTextInImage(p),
    };
    if (!result.limb && !result.gender && !result.review && !result.alignment && !result.textInImage) {
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

/**
 * 肢体：置信度 ≥ 0.7 才算异常（2026-10-15 由 0.6 上调）。
 * 低置信度的"疑似多一根手指"会触发 inpaint 局部重画 —— 而局部重画本身
 * 有可能把原本没问题的区域改坏，代价远大于收益。宁可放过，不可改坏。
 */
export const LIMB_CONFIDENCE_FLOOR = 0.7;

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
  if (!alignmentOk && gate.alignment && gate.alignment.criticalMissing.length > 0) {
    reasons.push(`alignment: ${gate.alignment.reason}`);
  }

  // 2026-10-20：画面内出现可读文字（含伪汉字）→ 不通过，重画。
  // 这是**大问题**：漫画里出现乱码是最扎眼的硬伤，而此前根本没人查。
  const textOk = !gate.textInImage || !gate.textInImage.hasReadableText;
  if (!textOk && gate.textInImage) {
    reasons.push(`text: ${gate.textInImage.reason || '画面内出现可读文字'}`);
  }

  return { ok: reasons.length === 0, reasons };
}

/** limb 异常且有 bbox → 需要走 inpaint 局部修复。 */
export function needsLimbRepair(gate: PanelGateResult): LimbAudit | null {
  const l = gate.limb;
  if (!l || !l.abnormal || l.confidence < LIMB_CONFIDENCE_FLOOR) return null;
  return l.regions.length > 0 ? l : null;
}

/**
 * 要素呈现率下限（2026-10-15，70 判据 → 60 判据）。
 *
 * 原来是「缺任意 1 项 → 重画」。实跑里最离谱的一格是 3 个要素画出了 2 个
 * （缺「双手握着背包肩带」），被判不达标、重画了 3 次 —— 而画面里人坐在工位上
 * 手放在桌面，故事完全说得通。
 *
 * 现在的判据是用户真正在意的那句：**能讲清楚故事内容和情绪就行**。
 * - 呈现率 ≥ 60% → 通过（3 项画 2 项 = 67% ✓）
 * - 至少要画出来 1 项 → 全判 missing 说明模型没理解画面，值得重来一次
 * - 全缺 / 低于 60% → 才重画
 */
export const ALIGNMENT_PRESENT_RATIO = 0.6;

/** 由「画出来的项数 / 总项数」判达标。纯函数，便于测试与两个调用点共用。 */
export function isAlignmentAcceptable(presentCount: number, totalCount: number): boolean {
  if (totalCount <= 0) return true;      // 没有清单 → 不参与判定
  if (presentCount <= 0) return false;  // 一项都没画出来 → 画面根本没对上文本
  return presentCount / totalCount >= ALIGNMENT_PRESENT_RATIO;
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
    /** 只含"大问题"的缺失项 —— 只有这些会触发重画（2026-10-20）。 */
    criticalMissing: string[];
    reason: string;
    confidence: number;
  } | null;
  /** 画面内可读文字检查（2026-10-20 新增第五道闸）。 */
  textInImage: {
    hasReadableText: boolean;
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
        criticalMissing: gate.alignment.criticalMissing,
        reason: gate.alignment.reason,
        confidence: gate.alignment.confidence,
      }
      : null,
    textInImage: gate.textInImage
      ? {
        hasReadableText: gate.textInImage.hasReadableText,
        reason: gate.textInImage.reason,
        confidence: gate.textInImage.confidence,
      }
      : null,
  };
}

export { ALL_DIMENSIONS };
