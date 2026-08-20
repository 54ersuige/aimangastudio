/**
 * registry-bridge —— 把 registry 的多个 DNA 字段拼装成"system directive"字符串。
 *
 * 此前这些拼装逻辑写在 graphic-novel-dna.ts 内（buildImageSystemDirective 等），
 * 现在抽到这里，dna-inject.ts 调用，本文件不关心"具体某套 DNA 的内容"，
 * 只负责"按字段顺序拼接"。
 *
 * ⚠ 此处的字段顺序与 IMAGE_SYSTEM_PROMPT / CHARACTER_HARD_CONSTRAINTS 等命名是
 * 与每个 dna/*.ts 文件约定好的契约。新增字段请同步更新 DnaPreset 接口。
 */
import { getDna, type DnaKey } from './registry.js';

/** 出图 prompt 前缀的标准拼装顺序。 */
const IMAGE_DIRECTIVE_ORDER: ReadonlyArray<keyof ReturnType<typeof getDna>> = [
  'IMAGE_SYSTEM_PROMPT',
  'CHARACTER_HARD_CONSTRAINTS',
  'COMPOSITION_HARD_CONSTRAINTS',
  'EXPRESSION_HARD_CONSTRAINTS',
  'SCENE_HARD_CONSTRAINTS',
  'TEXT_VS_IMAGE_RULES',
];

const TEXT_DIRECTIVE_ORDER: ReadonlyArray<keyof ReturnType<typeof getDna>> = [
  'IMAGE_SYSTEM_PROMPT',
  'CHARACTER_HARD_CONSTRAINTS',
  'COMPOSITION_HARD_CONSTRAINTS',
  'SCENE_HARD_CONSTRAINTS',
  'EXPRESSION_HARD_CONSTRAINTS',
  'TEXT_VS_IMAGE_RULES',
  'STORYTELLING_TONE_RULES',
];

export function buildImageDirective(key: DnaKey, opts: {
  includeCharacter?: boolean;
  includeScene?: boolean;
} = {}): string {
  const dna = getDna(key);
  const parts: string[] = [];
  for (const k of IMAGE_DIRECTIVE_ORDER) {
    if (k === 'CHARACTER_HARD_CONSTRAINTS' && opts.includeCharacter === false) continue;
    if (k === 'SCENE_HARD_CONSTRAINTS' && opts.includeScene === false) continue;
    parts.push(String(dna[k] ?? ''));
  }
  return parts.join('\n\n');
}

export function buildTextDirective(key: DnaKey): string {
  const dna = getDna(key);
  const parts: string[] = [];
  for (const k of TEXT_DIRECTIVE_ORDER) {
    parts.push(String(dna[k] ?? ''));
  }
  return parts.join('\n\n');
}

// 兼容旧 import 路径（graphic-novel-dna 已被替代）
export { buildImageDirective as buildImageSystemDirective, buildTextDirective as buildTextSystemDirective };