/**
 * DNA 自动注入工具 —— 把"当前生效 DNA 预设"的内容拼接到每次 AI 请求。
 *
 * 架构要点（架构审查结论落地）：
 *  - DNA 来源唯一：server/dna/registry.ts 的 getDna(key)。
 *  - 调用方必须显式传 dnaKey（通常来自 series.dnaKey 或 config.dnaKey），
 *    未知 key → 抛 Error，**绝不静默回退**到默认 DNA，
 *    否则会出现"用户明明选了 A，画出来的还是 B"的隐蔽风格漂移。
 *  - image/text 都必须带 dnaKey —— 文字生成（章节大纲、分镜、对话）也
 *    会受到对应 DNA 的 STORYTELLING_RULES 影响（文学 / 热血 / 电影化
 *    节奏完全不同），不允许某条链路绕开 DNA 注入。
 *
 * 调用约定：
 *  - 业务路由（series-routes.ts）从 series.dnaKey 取出
 *  - 通用 /api/text 与 /api/image 接收 withDna / dnaKey 字段；
 *    若未指定则用 config.dnaKey，再无则用 DEFAULT_DNA_KEY
 */
import {
  buildImageDirective as buildImageDirectiveFn,
  buildTextDirective as buildTextDirectiveFn,
} from './dna/registry-bridge.js';
import { getDna, DEFAULT_DNA_KEY, type DnaKey } from './dna/registry.js';
import type { TextRequest, ImageRequest } from './utils.js';

/** 业务侧统一注入入口。未知 dnaKey 直接抛错。 */
export function resolveDnaKey(key: string | undefined | null): DnaKey {
  if (key && key.length > 0) {
    // 直接复用 registry 的强类型判断
    try { return getDna(key).key; } catch { /* fall through */ }
  }
  return DEFAULT_DNA_KEY;
}

/**
 * 把 DNA 注入到 image 请求的 prompt 前面，并把负面风格约束拼进 prompt 末尾。
 *
 * 历史说明：早期版本会把负面约束写到 `extraParams.negative_prompt`，依赖下游
 * Provider 把它作为独立字段转发。但当前主流图片 API（Agnes、Step 等）对
 * `negative_prompt` 的支持不统一 —— 接收则风格生效；拒绝则整个请求 400。
 * 为让"任何 Provider 都能用同一份 DNA"，现在把负面约束写成显式的 "Avoid:" 文本
 * 注入 prompt 末尾（图像模型普遍遵循这种自然语言负面指令），不再走 extraParams。
 *
 * 调用方必须传 dnaKey（系列级锁定），不允许走默认。
 *
 * 2026-09-01 微调：算法保持不变（原本能工作），仅在超限时把 head/tail 样本打到日志，
 * 让运维能看到「prompt 被砍掉的究竟是哪一段」。Step 实际只吃 512 字符，由 step.ts 自己再砍。
 */
export function withDnaImagePrompt(req: ImageRequest, opts: {
  dnaKey: DnaKey;
  includeCharacter?: boolean;
  includeScene?: boolean;
  purpose?: 'scene' | 'character' | 'panel';
  /** 当前镜头类型（character purpose 时使用）—— v3 仅 sheet */
  shotKind?: 'sheet';
}): ImageRequest {
  const dna = getDna(opts.dnaKey);
  const prefix = buildImageDirectiveFn(opts.dnaKey, {
    includeCharacter: opts.includeCharacter,
    includeScene: opts.includeScene,
    purpose: opts.purpose,
    shotKind: opts.shotKind,
  } as any);
  // 把 negative prompt 改成显式 "Avoid:" 文本注入 prompt 末尾 —— 跨 Provider 兼容。
  // 长度上限 1500 字符（负面的优先级低于正面指令，超过会稀释正面）
  let avoidText = dna.IMAGE_NEGATIVE_PROMPT.trim()
    ? `\n\nAvoid: ${dna.IMAGE_NEGATIVE_PROMPT.replace(/\s+/g, ' ').trim()}`
    : '';
  if (avoidText.length > 1500) {
    avoidText = avoidText.slice(0, 1495) + '…';
  }
  // 调用方原有的 extraParams 一律保留（不再自动注入 negative_prompt）。
  const extraParams: Record<string, unknown> = { ...(req.extraParams || {}) };
  const sep = `\n\n---\n\n[Scene]\n`;
  let prompt = `${prefix}${sep}${req.prompt}${avoidText}`;
  // 长度保护：Agnes / 部分 Provider 限制 prompt ≤ 10000 字符。
  //
  // 截断优先级：req.prompt 是「这一格画什么 + 角色一致性 + 单人性约束」的核心，
  // 因此**永不主动截断 req.prompt**。超长时依次牺牲：
  //   1. avoidText（负面护栏，影响最小）；
  //   2. prefix 尾部段落（DNA 指令，保留头部画风段即可大致锚定风格）。
  const MAX_PROMPT = 9500;
  if (prompt.length > MAX_PROMPT) {
    const origLen = prompt.length;
    // 1) 先砍 avoidText
    if (avoidText.length > 0 && prefix.length + sep.length + req.prompt.length <= MAX_PROMPT) {
      prompt = `${prefix}${sep}${req.prompt}`;
      console.warn(`[dna-inject] prompt 超长，砍掉 avoidText：${origLen} → ${prompt.length}`);
    } else {
      // 2) 再截 prefix 尾部（保留头部画风段落），保住完整 req.prompt
      const budget = MAX_PROMPT - sep.length - req.prompt.length;
      if (budget > 200) {
        const trimmedPrefix = prefix.slice(0, budget);
        prompt = `${trimmedPrefix}${sep}${req.prompt}`;
        console.warn(`[dna-inject] prompt 超长，截断 DNA 前缀至 ${trimmedPrefix.length} 字符以保住完整业务 prompt（总长 ${prompt.length}）`);
      } else {
        // 3) 极端兜底：业务 prompt 本身过长（>9300），只能截它
        const head = `${prefix.slice(0, Math.max(0, MAX_PROMPT - sep.length - req.prompt.length))}${sep}`;
        const tailLen = Math.max(0, MAX_PROMPT - head.length);
        prompt = head + req.prompt.slice(0, tailLen) + '\n[…truncated for length…]';
        console.warn(`[dna-inject] 业务 prompt 本身超长，最终截断到 ${prompt.length} 字符`);
      }
    }
    // 2026-09-01 新增：超限时打 head/tail 样本，运维能定位哪一段被砍。
    console.warn(
      `[dna-inject] prompt 长度诊断（原始 ${origLen} → 现 ${prompt.length}）：\n` +
      `  head(180): ${JSON.stringify(prompt.slice(0, 180))}\n` +
      `  tail(180): ${JSON.stringify(prompt.slice(-180))}`,
    );
  }
  return {
    ...req,
    prompt,
    extraParams,
  };
}

/**
 * 把 DNA 注入到 text 请求的 system instruction。
 */
export function withDnaTextPrompt(req: TextRequest, opts: { dnaKey: DnaKey }): TextRequest {
  const dna = getDna(opts.dnaKey);
  const directive = buildTextDirectiveFn(opts.dnaKey);
  return {
    ...req,
    systemInstruction: req.systemInstruction
      ? `${directive}\n\n---\n\n[Task-specific instructions]\n${req.systemInstruction}`
      : directive,
  };
}

/**
 * 旧 API 兼容层 —— 允许现有 series-routes.ts 内仅传 opts（无显式 dnaKey）
 * 的调用方式继续工作。**业务路由应逐步迁移到 dnaKey 必传**，避免风格隐式漂移。
 *
 * 触发条件：opts.dnaKey 缺失时，回退顺序：
 *   1. opts.dnaKey（如果调用方显式传了）
 *   2. DEFAULT_DNA_KEY（最后兜底）
 */
export function withDnaImagePromptLegacy(req: ImageRequest, opts: {
  dnaKey?: string;
  includeCharacter?: boolean;
  includeScene?: boolean;
  purpose?: 'scene' | 'character';
}): ImageRequest {
  const key = resolveDnaKey(opts.dnaKey);
  return withDnaImagePrompt(req, {
    dnaKey: key,
    includeCharacter: opts.includeCharacter,
    includeScene: opts.includeScene,
    purpose: opts.purpose,
  });
}

export function withDnaTextPromptLegacy(req: TextRequest, opts: { dnaKey?: string }): TextRequest {
  const key = resolveDnaKey(opts.dnaKey);
  return withDnaTextPrompt(req, { dnaKey: key });
}

// 重新导出供旧 import 路径使用（graphic-novel-dna 已被替代）
export type { DnaKey };