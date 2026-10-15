/**
 * 肢体异常自动修复（性价比版 · 零依赖实现）
 * ─────────────────────────────────────────────────────────────────────
 *
 * 目标：在出图流程里夹一道「多胳膊 / 多手 / 6 根手指」自动巡检，发现问题
 * 就**只重画出错的局部**（inpaint），而不是整张重抽。绝大多数图本来就没
 * 问题 —— 通过 Gemini 多模态打分判断要不要修复，是零/低额外成本。
 *
 * 设计原则：
 *  - 失败永远不阻塞主流程：哪怕巡检/inpaint 全炸，最终也回退到原图落盘。
 *  - 自检超时 / 自检失败 → 视作"图片 OK"直接通过。
 *  - 一个图最多尝试 2 次 inpaint；2 次都不行 → 退回原图，绝不纠缠。
 *
 * 为什么是"prompt 文本坐标"而不是真正的 mask 接口：
 *  - 主流图片 API（agnes / openai-compatible / gemini）都没有显式 mask 端点
 *  - 业内 inpaint 多用"原图 + 红/灰 mask"双联图作为参考，但需手写 PNG 合成，零依赖难做
 *  - 退而求其次：把 mask 区域以"归一化百分比 bbox"写到 prompt 里，
 *    同时把原图作 referenceImages[0] 喂回 provider —— 等于"看着原图、按区域改"
 *  - 这是 OpenAI / agnes / Gemini 都吃且零依赖的格式。ROI 最高。
 *
 * 与项目其余部分的关系：
 *  - 调用方（characters.ts / generatePanelImages）出图后传入原图；
 *    本模块把"修复后版本"的 dataURL 返回，调用方落盘。
 */

import { getConfig } from './config.js';
import { getImageProvider, getTextProvider } from './series-routes/helpers.js';
import { imagePathToDataUrl } from './image-store.js';
import { logGeneration } from './utils.js';

/** 自检结果 */
export interface LimbAudit {
  people: number;
  hands: number;
  arms: number;
  abnormal: boolean;
  reason: string;
  /** 异常 bbox（归一化 0..1，左上原点） */
  regions: Array<{ x: number; y: number; w: number; h: number; label: string }>;
  confidence: number;
}

/**
 * 性别一致性自检结果（2026-09-07 引擎层 P3）。
 *
 * 与 LimbAudit 是独立维度：
 *  - LimbAudit 管"有没有多胳膊"
 *  - GenderAudit 管"主角的脸 / 装束是不是这个性别"
 *
 * 出图自检时两者并行跑（共享 vision 调用，但 prompt 不同）。
 * 如果 expectedGender 与图中观察到的性别不一致 → 记 mismatch，
 +  // 调用方可决定要不要 inpaint 重画脸 / 上半身。
 */
export interface GenderAudit {
  /** 图像中每个可识别的人物的性别猜测（按从左到右顺序）。 */
  observedGenders: Array<'female' | 'male' | 'ambiguous'>;
  /** 期望性别（由 character.gender 推断）。 */
  expectedGender: 'female' | 'male' | 'ambiguous';
  /** 是否存在「图中性别 ≠ 期望性别」的人物。 */
  mismatch: boolean;
  /** 不一致人物的索引（observedGenders 中的位置）。 */
  mismatchIndices: number[];
  reason: string;
  confidence: number;
}

/** 调独立配置的视觉模型（多模态）做肢体巡检。
 *  返回结构化 JSON；失败 → 返回 null（不修复）。
 * 2026-09-03：与 text 模型解耦，单独走 config.vision（见 server/config.ts）。
 * - enabled=false → 返回 null（视作通过，绝不阻塞主流程）
 * - apiKey / baseUrl 缺失 → 返回 null（优雅降级，不报 500）
 */
export async function callLimbAuditor(imageDataUrl: string): Promise<LimbAudit | null> {
  const cfg = getConfig().vision;
  if (!cfg.enabled) return null; // 用户没启用 → 跳过
  if (!cfg.apiKey || !cfg.baseUrl) {
    // 视觉 provider 没配好 → 静默跳过（不影响主流程）
    return null;
  }

  const systemInstruction = [
    'You are an image quality auditor for a comic character reference sheet / single panel.',
    'Your ONLY job is to count limbs and detect anatomical artifacts.',
    'Inspect every visible human figure. For each figure, count exactly:',
    '  arms (must ≤2 per person), hands (must ≤2 per person), fingers per hand (must = 5).',
    'Also detect: extra arms from torso, hands merging into objects like extra fingers,',
    '  near-identical mirror twin figures, stray second head/torso/legs, hand-on-prop illusions.',
    '',
    'Return strict JSON with these fields:',
    '  people: integer (number of visible human figures)',
    '  hands: integer (total visible hands across the image)',
    '  arms:  integer (total visible arms across the image)',
    '  abnormal: boolean (true if ANY artifact detected)',
    '  reason: short string describing the issue (empty if normal)',
    '  regions: array of {x, y, w, h, label} in NORMALIZED coords (0..1, top-left origin)',
    '          covering each misleading pixel cluster; empty array if normal',
    '  confidence: 0..1 (how sure you are)',
  ].join('\n');

  const userText = 'Audit this image. Respond with JSON only.';

  // 2026-09-03：直接复用项目内的 text provider 接口（providers/gemini.ts 等都实现了
  // generateText + 支持 referenceImages 多模态），不再手撕 HTTP，零分支判断。
  try {
    // vision 字段虽然类型上是 VisionModelConfig，但结构与 TextModelConfig 一致；
    // 复用 getTextProvider 让 provider 适配器走对应协议（gemini / agnes / minimax / openai）。
    const provider = getTextProvider({ provider: cfg.provider as any });
    const resp = await provider.generateText(cfg as any, {
      prompt: userText,
      systemInstruction,
      referenceImages: [{ data: imageDataUrl, mimeType: 'image/png' }],
      jsonMode: true,
      temperature: 0,
      // 2026-09-10：原 600 对推理型视觉模型（DeepSeek V4.1 Flash）不够用 —— 会吃光配额
      // → content 为空 → 巡检静默失效。
      // 实测探针：单张图思考量 2208~3193 tokens，正文仅约 400 tokens，故 4000 仍贴边。
      // 提到 8000 留一倍余量（max_tokens 是上限，模型写完即停，不增加费用）。
      maxTokens: 8000,
    });
    const txt = (resp.text || '').trim();
    if (!txt) return null;
    const p = JSON.parse(txt);
    const audit: LimbAudit = {
      people: Number(p.people) || 0,
      hands: Number(p.hands) || 0,
      arms: Number(p.arms) || 0,
      abnormal: Boolean(p.abnormal),
      reason: String(p.reason || '').slice(0, 200),
      regions: Array.isArray(p.regions)
        ? p.regions
            .filter((r: any) => r && typeof r.x === 'number' && typeof r.y === 'number')
            .map((r: any) => ({
              x: Math.max(0, Math.min(1, r.x)),
              y: Math.max(0, Math.min(1, r.y)),
              w: Math.max(0, Math.min(1, r.w ?? 0.15)),
              h: Math.max(0, Math.min(1, r.h ?? 0.15)),
              label: String(r.label || 'limb artifact').slice(0, 80),
            }))
        : [],
      confidence: typeof p.confidence === 'number' ? Math.max(0, Math.min(1, p.confidence)) : 0.5,
    };
    return audit;
  } catch (e: any) {
    return null;
  }
}

/**
 * 2026-09-07 引擎层 P3：性别一致性自检。
 *
 * 解决 boy_up 这种"主角是 male，模型却画成女性"的根因。
 *
 * 工作方式：
 *  - 复用 vision provider（同 LimbAudit），但 prompt 不同 —— 让模型按人物从左到右报性别；
 *  - 与 expectedGender 比对，不一致 → 算 mismatch；
 *  - 不做修复（inpaint 风险大），只审计 —— 调用方按 mismatch 决定整张重生成。
 *
 * 失败 / 不启用 → 返回 null（视作通过，绝不阻塞）。
 */
export async function checkGenderConsistency(
  imageDataUrl: string,
  expectedGender: 'female' | 'male' | 'ambiguous',
): Promise<GenderAudit | null> {
  const cfg = getConfig().vision;
  if (!cfg.enabled) return null;
  if (!cfg.apiKey || !cfg.baseUrl) {
    // 视觉 provider 没配好 → 静默跳过（不阻塞）
    return null;
  }
  const systemInstruction = [
    'You are an image auditor for a single comic panel.',
    'Your ONLY job is to report the visible gender of each human figure.',
    'Inspect every visible human figure from left to right.',
    'For each figure, output one of: "female" / "male" / "ambiguous".',
    'Use these physical cues ONLY (do not infer from clothing alone):',
    '  - female: visible Adam\'s apple absent, soft jawline, narrow shoulders, longer hair,',
    '    small / narrow eyes, finer brow.',
    '  - male:   visible or hinted Adam\'s apple, harder jawline, broader shoulders,',
    '    shorter hair or receding hairline, thicker brow.',
    '  - ambiguous: short hair on female-presenting face, or features that could go either way.',
    'Be conservative: if you can\'t tell, output "ambiguous" rather than guessing.',
    '',
    'Return strict JSON:',
    '  observed: array of strings, each "female"/"male"/"ambiguous", in left-to-right order.',
    '  confidence: number 0..1 (how confident you are in the overall assessment).',
  ].join('\n');
  const userText = `Audit this image. Expected dominant gender: ${expectedGender}. Report observed genders of all visible figures.`;
  try {
    const provider = getTextProvider({ provider: cfg.provider as any });
    const resp = await provider.generateText(cfg as any, {
      prompt: userText,
      systemInstruction,
      referenceImages: [{ data: imageDataUrl, mimeType: 'image/png' }],
      jsonMode: true,
      temperature: 0,
      // 2026-09-10：同上，单张图思考量 2208~3193 tokens，原 300/4000 都贴边。提到 8000。
      maxTokens: 8000,
    });
    const txt = (resp.text || '').trim();
    if (!txt) return null;
    const p = JSON.parse(txt);
    const observedRaw = Array.isArray(p.observed) ? p.observed : [];
    const observed = observedRaw
      .map((s: any) => {
        const v = String(s || '').toLowerCase().trim();
        if (v.startsWith('f')) return 'female' as const;
        if (v.startsWith('m')) return 'male' as const;
        return 'ambiguous' as const;
      });
    const mismatchIndices: number[] = [];
    observed.forEach((g: 'female' | 'male' | 'ambiguous', i: number) => {
      // ambiguous 视为通过 —— 不误判中性角色
      if (g === 'ambiguous') return;
      if (g !== expectedGender) mismatchIndices.push(i);
    });
    return {
      observedGenders: observed,
      expectedGender,
      mismatch: mismatchIndices.length > 0,
      mismatchIndices,
      reason: mismatchIndices.length > 0
        ? `图中有 ${mismatchIndices.length} 个人物性别与预期不符（预期 ${expectedGender}）`
        : '',
      confidence: typeof p.confidence === 'number' ? Math.max(0, Math.min(1, p.confidence)) : 0.5,
    };
  } catch (e: any) {
    return null;
  }
}

/**
 * 把 mask 区域以"归一化百分比坐标"形式序列化为 prompt 文本片段。
 * 配套：原图通过 referenceImages 喂给 provider，prompt 描述 bbox → 它就能定位。
 * 这种"自由格式 inpainting"对 OpenAI / agnes / Gemini 全友好，零依赖。
 */
function regionsAsPromptBlock(regions: LimbAudit['regions']): string {
  if (regions.length === 0) return '';
  return regions
    .map((r, i) => {
      const x = (r.x * 100).toFixed(1);
      const y = (r.y * 100).toFixed(1);
      const w = (r.w * 100).toFixed(1);
      const h = (r.h * 100).toFixed(1);
      return `[Region ${i + 1}] top-left=(${x}%, ${y}%) size=(${w}% × ${h}%) — ${r.label}`;
    })
    .join('\n');
}

/** repairLimbRegions 的返回。 */
export interface LimbRepairResult {
  /** 修复后的图；失败/未修复时为原图。 */
  image: string;
  /** 审计结果（与 guardedImage 返回同形，便于统一落盘）。 */
  audit: { abnormal: boolean; reason: string; confidence: number };
  /** 是否真的重画过（false = 原图直接放行）。 */
  repaired: boolean;
}

/**
 * 对已判定"肢体异常"的图做**局部 inpaint 修复**（2026-10-15 从 guardedImage 抽出）。
 *
 * 为什么抽出来：2026-10-15 之后分镜出图走「四闸合一」（server/panel-gate.ts），
 * 肢体检测由合一闸一次返回，不再单独调 callLimbAuditor；但**修复动作**仍要保留 ——
 * 它是唯一能把"已付费的好图"保住的手段（整张重抽＝再花钱 + 可能更差）。
 * 于是：检测合并、修复独立。
 *
 * 入参要求：调用方已经拿到 LimbAudit（abnormal=true 且有 regions）。
 */
export async function repairLimbRegions(
  originalDataUrl: string,
  initialAudit: LimbAudit,
  fallbackPrompt: string,
): Promise<LimbRepairResult> {
  // 3) 构造 inpaint prompt —— 极简但结构化
  const regionBlock = regionsAsPromptBlock(initialAudit.regions);
  const inpaintPrompt = [
    fallbackPrompt,
    '',
    '【Inpaint 局部修复任务】在原图（referenceImages[0]）上，仅修改以下 bounding box 包围的区域，区域外严格保持像素、线条、颜色、构图完全一致。',
    regionBlock,
    '',
    '【修复硬约束 · 严格 2 臂 2 手 5 指】',
    '修复区内的人体必须严格：每人正好 2 臂 + 2 手 + 每手 5 指 + 无道具粘连 + 无镜像。',
    '禁止多胳膊 / 多手指 / 6-7 指 / 手与人形道具 / 双手臂重叠错位 / 第四肢。',
  ]
    .filter(Boolean)
    .join('\n');

  // 4) 调 image provider 局部重画 —— 把原图喂回去，让模型"看着改"
  const config = getConfig().image;
  const provider = getImageProvider(config);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await provider.generateImage(config, {
        prompt: inpaintPrompt,
        referenceImages: [
          // 仅把原图喂给 provider（mask 区域已经写进 prompt）
          { data: originalDataUrl, mimeType: 'image/png' },
        ],
        aspectRatio: '1:1',
      } as any);

      // 5) 自检修复结果 —— 防止 inpaint 反而引入新问题
      const postAudit = await callLimbAuditor(result.image);
      if (postAudit && (postAudit.abnormal && postAudit.confidence > 0.7)) {
        logGeneration('limb-guard-inpaint-still-bad', {
          attempt,
          reason: postAudit.reason,
        });
        if (attempt === 0) continue;
        return {
          image: originalDataUrl,
          audit: {
            abnormal: true,
            reason: `inpaint 失败退回原图：${postAudit.reason}`,
            confidence: postAudit.confidence,
          },
          repaired: false,
        };
      }
      // 修复成功（自检通过 / 自检失败但至少不是恶化）
      return {
        image: result.image,
        audit: {
          abnormal: false,
          reason: postAudit?.reason || '',
          confidence: postAudit?.confidence ?? initialAudit.confidence,
        },
        repaired: true,
      };
    } catch (e: any) {
      console.warn(`[limb-guard] inpaint 第 ${attempt + 1} 次失败：${e?.message || e}`);
      if (attempt === 1) {
        return {
          image: originalDataUrl,
          audit: {
            abnormal: true,
            reason: `inpaint 失败退回原图：${e?.message || e}`,
            confidence: initialAudit.confidence,
          },
          repaired: false,
        };
      }
    }
  }
  return {
    image: originalDataUrl,
    audit: {
      abnormal: true,
      reason: 'inpaint 未启动重试',
      confidence: initialAudit.confidence,
    },
    repaired: false,
  };
}

/**
 * 对外接口：检查 + 就地修复一张图。
 *
 * @param originalWebOrDataUrl 原图（web 路径或 dataURL）
 * @param fallbackPrompt       用于 inpaint 的 prompt（建议简短）
 * @param dnaKey               DNA key（保留参数，便于日后让 inpaint 走同一套注入）
 * @returns  最终 dataURL + 审计结果（OK / 修复成功 / 修复失败退回，都给 dataURL）
 *           2026-09-07 反馈层 P2：返回审计结果，调用方可写到 panel-audit JSONL。
 *
 * 2026-10-15：分镜出图路径已改走「四闸合一」（server/panel-gate.ts），不再调本函数；
 * 本函数保留给角色参考表（characters.ts）与风格参考图（prompts.ts:383）两条路径。
 */
export async function guardedImage(
  originalWebOrDataUrl: string,
  fallbackPrompt: string,
  dnaKey: string,
): Promise<{ image: string; audit: { abnormal: boolean; reason: string; confidence: number } | null }> {
  // 1) 统一为 dataURL
  const originalDataUrl = originalWebOrDataUrl.startsWith('data:')
    ? originalWebOrDataUrl
    : (imagePathToDataUrl(originalWebOrDataUrl) || '');
  if (!originalDataUrl) return { image: originalWebOrDataUrl, audit: null };

  // 2) 自检（多模态调用约 1-2s，失败/配错就静默跳过）
  const initialAudit = await callLimbAuditor(originalDataUrl);
  if (!initialAudit) return { image: originalDataUrl, audit: null }; // 巡检失败 → 视作通过
  const initialAbnormal = initialAudit.abnormal && initialAudit.confidence >= 0.6;
  if (!initialAbnormal || initialAudit.regions.length === 0) {
    return {
      image: originalDataUrl,
      audit: {
        abnormal: false,
        reason: '',
        confidence: initialAudit.confidence,
      },
    };
  }

  logGeneration('limb-guard-detected', {
    people: initialAudit.people,
    hands: initialAudit.hands,
    arms: initialAudit.arms,
    reason: initialAudit.reason,
    regions: initialAudit.regions,
    confidence: initialAudit.confidence,
  });

  const repaired = await repairLimbRegions(originalDataUrl, initialAudit, fallbackPrompt);
  return { image: repaired.image, audit: repaired.audit };
}
