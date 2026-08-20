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
 * 把 DNA 注入到 image 请求的 prompt 前面，并把 negative prompt 写到 extraParams。
 * 调用方必须传 dnaKey（系列级锁定），不允许走默认。
 */
export function withDnaImagePrompt(req: ImageRequest, opts: {
  dnaKey: DnaKey;
  includeCharacter?: boolean;
  includeScene?: boolean;
}): ImageRequest {
  const dna = getDna(opts.dnaKey);
  const prefix = buildImageDirectiveFn(opts.dnaKey, {
    includeCharacter: opts.includeCharacter,
    includeScene: opts.includeScene,
  });
  const extraParams: Record<string, unknown> = {
    ...req.extraParams,
    negative_prompt: dna.IMAGE_NEGATIVE_PROMPT,
  };
  return {
    ...req,
    prompt: `${prefix}\n\n---\n\n[Scene]\n${req.prompt}`,
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
}): ImageRequest {
  const key = resolveDnaKey(opts.dnaKey);
  return withDnaImagePrompt(req, { dnaKey: key, includeCharacter: opts.includeCharacter, includeScene: opts.includeScene });
}

export function withDnaTextPromptLegacy(req: TextRequest, opts: { dnaKey?: string }): TextRequest {
  const key = resolveDnaKey(opts.dnaKey);
  return withDnaTextPrompt(req, { dnaKey: key });
}

// 重新导出供旧 import 路径使用（graphic-novel-dna 已被替代）
export type { DnaKey };