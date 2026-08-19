/**
 * DNA 自动注入工具 —— 把 graphic-novel-dna.ts 的内容强制注入到所有 AI 请求。
 *
 * 规则：
 *  - 文字生成：把 dnaText() 拼接到 systemInstruction 前面（systemInstruction 仍然以调用方的内容为主）
 *  - 图片生成：把 dnaImage() 拼接到 prompt 前面；把 negativePrompt 加到 extraParams（如果模型支持）
 *
 * 这个文件被 series-routes.ts 和 routes.ts 调用，
 * 实现"任何出图/出文都自动符合 Art Direction 宪法"。
 */
import {
  buildImageSystemDirective,
  buildTextSystemDirective,
  IMAGE_NEGATIVE_PROMPT,
} from './graphic-novel-dna.js';
import type { TextRequest, ImageRequest } from './utils.js';

/** 用纯文本方式注入 DNA 到 system instruction。 */
export function dnaText(): string {
  return buildTextSystemDirective();
}

/** 把 DNA 注入到 image 请求的 prompt 前面。 */
export function withDnaImagePrompt(req: ImageRequest, opts: { includeCharacter?: boolean; includeScene?: boolean } = {}): ImageRequest {
  const prefix = buildImageSystemDirective(opts);
  // 把 negative prompt 塞进请求级 extraParams —— provider 会把它合并进最终请求体
  // （config.extraParams 之后展开，请求级覆盖配置级）。
  const extraParams: Record<string, unknown> = {
    ...req.extraParams,
    negative_prompt: IMAGE_NEGATIVE_PROMPT,
  };
  return {
    ...req,
    prompt: `${prefix}\n\n---\n\n[Scene to render]\n${req.prompt}`,
    extraParams,
  };
}

/** 把 DNA 注入到 text 请求的 system instruction。 */
export function withDnaTextPrompt(req: TextRequest): TextRequest {
  const dna = dnaText();
  return {
    ...req,
    systemInstruction: req.systemInstruction
      ? `${dna}\n\n---\n\n[Task-specific instructions]\n${req.systemInstruction}`
      : dna,
  };
}