/**
 * 图文对齐门禁（2026-09-11）
 * ─────────────────────────────────────────────
 * 目的：把「漫画看不懂 / 图文对不齐」从"用户主观感受"变成"可拦截的量化信号"。
 *
 * 为什么存在：8 维评审管"画得质量好不好"（风格/构图/情绪），但它不管"画没画到"。
 * 本系列分镜 description 往往写得很满（具体道具+状态、人数、动作），
 * 而 agnes-image-2.1-flash 这类快速模型经常画不全：空咖啡杯没画、掀起的纸角没画、
 * "过肩中景"画成两个主角各站一边…… 于是图上没杯子、图下旁白写"桌上三只空杯"，
 * 读者就"看不懂"。
 *
 * 两步式（防幻觉，区别 8 维审核的三个已知陷阱）：
 *  1. extractAlignmentItems —— 用【文本模型】从 description 抽取 2-5 个
 *     **可核验实体要素**（具体道具+状态 / 人物数量+身份 / 具体动作）。
 *     要点：只抽"画面里看得出有/没有"的实词，不抽情绪、视线、氛围——
 *     否则视觉模型会像 8 维审核一样脑补缺陷（如幻"沈砚缺眼镜"）。
 *  2. verifyAlignment —— 用【视觉模型】读图，逐项核对 present true/false。
 *     缺任何一项 → mismatch → 调用方判定重画，并把"缺什么"注入修正 prompt。
 *
 * 防幻觉护栏：
 *  - 核对项**必须**来自 description（先抽取、再核对），视觉模型没有自由发挥空间；
 *  - prompt 显式禁止"脑补描述里没写的元素" "因画风/镜头/透视而误判缺失"；
 *  - 任何失败（未配置 / 抽取空 / 解析失败）→ 返回 null（fail-open，绝不阻塞主流程）；
 *  - JSON 解析复用 8 维审核总结过的三层修复（截断不救 / 括号错位补 / 信封剥壳）。
 */

import { z } from 'zod';
import { getConfig } from './config.js';
import { getTextProvider } from './series-routes/helpers.js';
import { repairUnbalancedJson } from './audit/comic-reviewer.js';
import { logGeneration } from './utils.js';

// ── 第一步：从 description 抽取可核验实体要素 ──────────────────────────────

/**
 * 2026-10-15 实测修正：模型**稳定返回** `{"items":["文本", ...]}`（纯字符串数组），
 * 而原来的 schema 要求 `{"items":[{"text":"..."}]}`（对象数组）——
 * 于是每一次抽取都 zod 失败走 null 分支，对齐闸实际处于**完全静默失效**状态。
 * 实测日志里 alignment-extract-schema-fail 累计 15 次，而审计记录 alignmentAudit 恒为 null。
 *
 * 修法：schema 同时接受两种形状（z.union），prompt 也改成模型自然会给的简单形式。
 * 不改成"只认一种"——那是把容错换成了另一种单点故障。
 */
const AlignmentItemsZ = z.object({
  /** 每项 ≤ 40 字，必须是"画面里看得出有/没有"的实词。字符串或 {text} 对象都接受。 */
  items: z.array(z.union([
    z.string().min(2).max(40),
    z.object({ text: z.string().min(2).max(40) }),
  ])).max(5),
});

/** 抽取结果：核验要素清单；null = 抽取失败（调用方跳过本格门禁）。 */
export async function extractAlignmentItems(
  description: string,
  sceneDescription: string,
): Promise<{ items: string[] } | null> {
  const cfg = getConfig().text;
  const provider = getTextProvider(cfg);
  const prompt = [
    '你是一名漫画分镜对齐审核员，任务是从一格分镜的"画面描述"里抽取**可核验的实体要素清单**，供后续读图核对。',
    '',
    '画面描述：',
    description,
    sceneDescription ? `\n整版场景：${sceneDescription}` : '',
    '',
    '抽取规则（只抽"画面里看得出有/没有"的实词）：',
    '1. 关键道具及其状态：如「桌上三只空咖啡杯且无人收走」「被撕成两半的A4文件」「胸前的工牌」。',
    '2. 人物数量与身份：如「长桌两端一男一女」「画面中两人：苏曼按稿、沈砚站着」；若描述点名了人数必须抽。',
    '3. 正在发生的具体动作：如「苏曼把白瓷壶里的水倒进酒杯」「田经理把清单甩在桌面」。',
    '4. 每项 ≤ 40 字，2-5 项，宁少勿滥，只抽本格最重要的叙事要素。',
    '',
    // 2026-10-20：以下三类是实测里的误报重灾区，必须排除。
    '严禁抽取以下三类（2026-10-20 实测 32 条不达标里绝大多数是这三类）：',
    '①【方位与位置】任何方位词：左侧/右侧/左边/右边/上方/下方/角落/身后/对面/走近/后退。',
    '  原因：「陆远站在柜台左侧」里的"左侧"可以指画面左侧也可以指陆远自己的左侧，',
    '  分镜作者与视觉模型理解不一致 → 必然误判缺失。位置错位不是这一层要抓的问题。',
    '②【质感与微状态】反光/映射/泛光/泛白/发亮/微微/轻微/僵直/微缩/晃动的衣角/翘起的纸角/镀金属扣。',
    '  原因：这类"有没有"视觉模型判不准（表带明明在手腕上，它说"缺反光"）。',
    '③【剧情因果句与内部标记】"将…带进…""因为…所以…"这类叙述句；以及任何形如（7245a507）的内部 ID。',
    '  原因：它们根本不是"画面里看得出有/没有"的东西。',
    '',
    '严禁抽取：情绪、心理、视线方向（除非描述明确写"看着某物"且是该格的焦点）、颜色、光线氛围、画风词汇。',
    '严禁添加 description 里没有的内容 —— 核对项必须能在描述原文里找到依据。',
    '',
    '输出严格 JSON：{"items": ["要素一", "要素二"]}',
  ].join('\n');
  try {
    const resp = await provider.generateText(cfg, {
      prompt,
      systemInstruction: '你只输出严格 JSON，不要任何额外文字。',
      jsonMode: true,
      temperature: 0.2,
      maxTokens: 2000,
    });
    const txt = (resp.text || '').trim();
    if (!txt) return null;
    const p = parseLooseJson(txt);
    if (!p) {
      logGeneration('alignment-extract-parse-fail', { rawLen: txt.length });
      return null;
    }
    const v = AlignmentItemsZ.safeParse(p);
    if (!v.success) {
      logGeneration('alignment-extract-schema-fail', { error: v.error.message.slice(0, 200) });
      return null;
    }
    const items = v.data.items
      .map(i => (typeof i === 'string' ? i : i.text).trim())
      .filter(Boolean);
    return items.length > 0 ? { items } : null;
  } catch (e: any) {
    logGeneration('alignment-extract-error', { error: String(e?.message || e).slice(0, 300) });
    return null;
  }
}

// ── 第二步：视觉模型读图，逐项核对 ────────────────────────────────────────

const AlignmentVerifyZ = z.object({
  results: z.array(z.object({
    text: z.string(),
    present: z.boolean(),
    reason: z.string().default(''),
    /**
     * 2026-10-20 新增：present=false 时，这一项缺失的**严重程度**。
     * critical = 大问题（必须重画）· minor = 细节（不必浪费一次重画）。
     */
    severity: z.enum(['critical', 'minor']).default('critical'),
  })),
});

export interface AlignmentAudit {
  /** 是否全部**大问题**都画出来了（细节缺失不计入）。 */
  ok: boolean;
  /** 抽取的全部核对项。 */
  items: string[];
  /** 缺失/画错的要素原文列表（全部，含细节）。 */
  missing: string[];
  /** 只含"大问题"的缺失项 —— 只有这些会触发重画。 */
  criticalMissing: string[];
  /** 一句汇总（≤ 60 字，用于注入修正 prompt 与审计）。 */
  reason: string;
  confidence: number;
}

/**
 * 读图核对。失败 / 未启用 → 返回 null（调用方视作通过）。
 */
export async function verifyAlignment(
  imageDataUrl: string,
  items: string[],
): Promise<AlignmentAudit | null> {
  const cfg = getConfig().vision;
  if (!cfg.enabled) return null;
  if (!cfg.apiKey || !cfg.baseUrl) return null;

  const itemList = items.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const systemInstruction = [
    'You are a panel-text alignment auditor for a single comic panel.',
    'Your ONLY job: check whether a fixed checklist of story elements is VISIBLY',
    'depicted in the image. You never judge style, linework, or beauty.',
    '',
    'Checking rules:',
    '  - present=true if the element is clearly recognizable in the picture.',
    '  - present=false ONLY if it is clearly absent or clearly depicted wrongly',
    '    (e.g. the prop is missing entirely, or the action shown contradicts the item).',
    '  - If an element is partially occluded or cropped by the chosen camera',
    '    framing but its main body remains recognizable, treat it as present.',
    '  - NEVER mark an element missing just because of art style, perspective,',
    '    small size, or lighting. NEVER invent elements that are not on the list.',
    '  - reason: one short clause (max 20 chars) only when present=false.',
    '',
    // 2026-10-20：把"缺了"再分成"大问题"和"细节" —— 只有大的才值得重画一次。
    'SEVERITY — you must classify every present=false item:',
    '  severity="critical" (a REAL problem worth redrawing the panel):',
    '    - a person who must be in this panel is entirely absent;',
    '    - a key story prop is entirely absent (the cup, the torn document, the key);',
    '    - the depicted action contradicts the description (sitting vs standing,',
    '      tearing the sheet vs handing it over);',
    '    - the number of people is wrong (three people drawn where one is described).',
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
    'Return strict JSON:',
    '  "results": [{ "text": string, "present": boolean, "reason": string, "severity": "critical"|"minor" }]',
  ].join('\n');
  const userText = [
    'Panel description checklist to verify against the image:',
    itemList,
    '',
    'Check each item. Return ONLY the JSON array wrapper object.',
  ].join('\n');

  try {
    const provider = getTextProvider({ provider: cfg.provider as any });
    const resp = await provider.generateText(cfg as any, {
      prompt: userText,
      systemInstruction,
      referenceImages: [{ data: imageDataUrl, mimeType: 'image/png' }],
      jsonMode: true,
      temperature: 0,
      // 2026-09-10 实测：推理型视觉模型单张图思考量 2208~3193 tokens，
      // 正文极小；8000 留一倍余量（上限，写完即停，不增加费用）。
      maxTokens: 8000,
    });
    const txt = (resp.text || '').trim();
    if (!txt) return null;
    let p = parseLooseJson(txt);
    if (!p) return null;
    // 剥信封：{"type":"json_object","content":{...}}
    if (!p.results && p.content && typeof p.content === 'object') p = p.content;
    const v = AlignmentVerifyZ.safeParse(p);
    if (!v.success) {
      logGeneration('alignment-verify-schema-fail', {
        rawLen: txt.length,
        rawHead: txt.slice(0, 300),
        error: v.error.message.slice(0, 200),
      });
      return null;
    }
    const results = v.data.results;
    const missing = results.filter(r => !r.present).map(r => r.text.trim()).filter(Boolean);
    // 2026-10-20：**只有"大问题"才判不达标**。
    //
    // 原判据是「缺任意 1 项 → 重画」。抽 5 项、判错 1 项就整格重画，
    // 误报被放大了 5 倍。2026-10-20 实测一天：32 条触发重画，
    // 而逐条看下来绝大多数是**细节级**缺失（反光/泛白/微表情/位置偏差），
    // 画面其实是对的 —— 白烧了几十次重画。
    //
    // 现在：缺「关键人物/关键道具/动作相反/人数不对」才重画；
    // 缺「反光/颜色/角度/次要背景物」只记录，不浪费一次重画。
    const criticalMissing = results
      .filter(r => !r.present && r.severity === 'critical')
      .map(r => r.text.trim())
      .filter(Boolean);
    const confidence = results.length > 0
      ? Math.max(0, Math.min(1, results.filter(r => r.present).length / results.length))
      : 0;
    const reason = criticalMissing.length > 0 ? `缺：${criticalMissing.slice(0, 3).join('、')}` : '';
    return {
      ok: criticalMissing.length === 0,
      items,
      missing,
      criticalMissing,
      reason,
      confidence,
    };
  } catch (e: any) {
    logGeneration('alignment-verify-error', { error: String(e?.message || e).slice(0, 300) });
    return null;
  }
}

// ── 宽松 JSON 解析：剥 ```json 标签 → 直接 parse → 括号错位补 → 信封剥壳。
// 与 comic-reviewer 同一套修复哲学（详见 comic-reviewer repairUnbalancedJson 注释）。
function parseLooseJson(s: string): any {
  const cleaned = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(cleaned); } catch { /* fallthrough */ }
  const repaired = repairUnbalancedJson(cleaned);
  if (repaired) {
    try { return JSON.parse(repaired); } catch { /* fallthrough */ }
  }
  return null;
}