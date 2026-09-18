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

/**
 * 出图 prompt 前缀的标准拼装顺序。
 *
 * 注意 IMAGE_SYSTEM_PROMPT 与 IMAGE_CHARACTER_SYSTEM_PROMPT 是互斥的：
 *  - 场景图（purpose='scene' 或不传）：用 IMAGE_SYSTEM_PROMPT，里面有完整的
 *    场景描写（咖啡馆、街道、医院……）
 *  - 角色参考图（purpose='character'）：用 IMAGE_CHARACTER_SYSTEM_PROMPT，里面
 *    跳过 [SCENE] 段落，避免模型把咖啡馆画到角色图上
 */
const IMAGE_DIRECTIVE_ORDER: ReadonlyArray<keyof ReturnType<typeof getDna>> = [
  'IMAGE_SYSTEM_PROMPT',
  'CHARACTER_HARD_CONSTRAINTS',
  'COMPOSITION_HARD_CONSTRAINTS',
  'EXPRESSION_HARD_CONSTRAINTS',
  'SCENE_HARD_CONSTRAINTS',
  'TEXT_VS_IMAGE_RULES',
];

const CHARACTER_DIRECTIVE_ORDER: ReadonlyArray<keyof ReturnType<typeof getDna>> = [
  'IMAGE_CHARACTER_SYSTEM_PROMPT',
  'CHARACTER_HARD_CONSTRAINTS',
];

/**
 * 分镜图（panel）专用紧凑指令顺序 —— 2026-08-31 新增。
 *
 * 背景：场景全量指令（IMAGE_SYSTEM_PROMPT + 5 个 HARD_CONSTRAINTS）约 9000 字符，
 * 加上分镜业务 prompt 与负面词后超过 Agnes 10000 字符上限，旧截断逻辑会砍掉
 * 业务 prompt 尾部 —— 恰恰是角色一致性/单人性等最关键的约束，导致分镜图质量崩盘。
 *
 * 对策：IMAGE_SYSTEM_PROMPT 本身已包含 [FACES]/[EXPRESSION]/[SCENE]/[PALETTE] 等段落，
 * CHARACTER/EXPRESSION/SCENE 三个 HARD_CONSTRAINTS 与其高度重复，对 panel 场景直接去掉；
 * 保留 COMPOSITION（电影化镜头规则，分镜核心）与 TEXT_VS_IMAGE（画面内禁文字）。
 * 压缩后约 6500 字符 + 业务 ~1700 + 负面 ~700 ≈ 8900 < 9500，不再触发截断。
 */
const PANEL_DIRECTIVE_ORDER: ReadonlyArray<keyof ReturnType<typeof getDna>> = [
  'IMAGE_SYSTEM_PROMPT',
  'COMPOSITION_HARD_CONSTRAINTS',
  'TEXT_VS_IMAGE_RULES',
];

const TEXT_DIRECTIVE_ORDER: ReadonlyArray<keyof ReturnType<typeof getDna>> = [
  'VISUAL_DEFINITION',
  'STORYTELLING_RULES',
];

export function buildImageDirective(key: DnaKey, opts: {
  includeCharacter?: boolean;
  includeScene?: boolean;
  /**
   * 用途：
   *  - 'scene'（默认）：通用场景图。注入全部 DNA 指令（构图/场景/角色/表情等）。
   *  - 'panel'：漫画分镜出图。走 PANEL_DIRECTIVE_ORDER 紧凑指令集 —— 全量指令
   *    ~9000 字符会把业务 prompt 挤出 Agnes 10000 上限（截断丢一致性约束），
   *    分镜图只保留 IMAGE_SYSTEM_PROMPT + COMPOSITION + TEXT_VS_IMAGE。
   *  - 'character'：角色参考图（character card）。
   *    走独立的字段顺序 CHARACTER_DIRECTIVE_ORDER：
   *      - IMAGE_CHARACTER_SYSTEM_PROMPT（角色专用 system prompt，跳过 [SCENE] 段落，避免咖啡馆画到角色图上）
   *      - CHARACTER_HARD_CONSTRAINTS（人物约束）
   *      - EXPRESSION_HARD_CONSTRAINTS（表情约束）
   *      - TEXT_VS_IMAGE_RULES（不要对话气泡）
   *    显式跳过 COMPOSITION_HARD_CONSTRAINTS（要求 medium two-shot / 双人物）
   *    和 SCENE_HARD_CONSTRAINTS（场景描写）。
   */
  purpose?: 'scene' | 'character' | 'panel';
} = {}): string {
  const dna = getDna(key);
  const parts: string[] = [];
  if (opts.purpose === 'panel') {
    for (const k of PANEL_DIRECTIVE_ORDER) parts.push(String(dna[k] ?? ''));
    return parts.join('\n\n');
  }
  if (opts.purpose === 'character') {
    // 角色参考图：走独立的字段顺序 + IMAGE_CHARACTER_SYSTEM_PROMPT（无场景）
    // 2026-08-31 精简：去掉 EXPRESSION_HARD_CONSTRAINTS / TEXT_VS_IMAGE_RULES ——
    //   前者的表情约束已被 IMAGE_CHARACTER_SYSTEM_PROMPT 的 [EXPRESSION] 段 +
    //   CHARACTER_HARD_CONSTRAINTS 双重覆盖；后者的"禁气泡文字"已被 sheet
    //   promptTail 的 NO text 硬约束覆盖。保留它们会把 sheet 总长顶过 9500，
    //   触发截断时被砍掉的恰是刚加强的负面词（photograph/watercolor 等）。
    for (const k of CHARACTER_DIRECTIVE_ORDER) {
      if (k === 'CHARACTER_HARD_CONSTRAINTS' && opts.includeCharacter === false) continue;
      parts.push(String(dna[k] ?? ''));
    }
    return parts.join('\n\n');
  }
  // 场景图：走全量 IMAGE_DIRECTIVE_ORDER
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