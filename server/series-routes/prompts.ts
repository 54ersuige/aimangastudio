import { getConfig } from '../config.js';
import type { Series, SeriesCharacter, Chapter, Panel, SeriesPage } from '../series-store.js';
import type { DnaKey } from '../../shared/types.js';
import { withDnaImagePrompt } from '../dna-inject.js';
import { logGeneration } from '../utils.js';
import { mapConcurrent } from '../concurrency.js';
import { saveDataUrlImage, resolveImageData, loadStyleReferenceImages } from '../image-store.js';
import { getImageProvider, iterAllChapters, callStructuredJson } from './helpers.js';
import { z } from 'zod';
import { guardedImage, checkGenderConsistency } from '../limb-guard.js';
import { validatePage, validateCharacter } from '../series-store/validate.js';
import { appendPanelAudit, hashImageDataUrl, type PanelAuditRecord } from '../audit/panel-audit.js';
import { reviewPanel, summarizeFailure, REGENERATE_THRESHOLD, DIMENSION_LABELS_ZH } from '../audit/comic-reviewer.js';
import { extractAlignmentItems, verifyAlignment, type AlignmentAudit } from '../alignment-guard.js';

/**
 * 把「signature」里的持有型描述从角色参考图 prompt 中拆出来。
 *
 * 背景：signature 写成「手握随行杯」「拎公文包」时，T2I 模型在 4 视图参考表里
 * 会画成「手里端杯子 / 拎包」—— 这是侧面+ 3/4 视角下诱发多胳膊伪影的最常见源。
 *
 * 策略：
 *  - 持有型动词（握 / 拿 / 拎 / 端 / 抓 / 抱 / 提 / 背 / 挎）+ 对象物：剥离为
 *    「随身携带 X（参考图不入画，分镜中由剧情驱动画出）」，既保留人物识别度，
 *    又让模型的角色图保持空手姿态。
 *  - 非持有动作（习惯性皱眉 / 写字转笔 / 走路靠左 / 说话手势）原样保留。
 *  - 多句 signature 用常见分隔符（。；；；， / .）逐句处理。
 *  - 极端情况（整段都是持有型描述）：仍返回剥离结果以便 LLM 至少保留"此人物有 X"
 *    的记忆，但不强制画出手持动作。
 *
 * 注意：这里是清洗**提示词文本**，不影响 series.characters[].signature 原值
 * （原值仍然进入分镜生成 prompt，避免改动业务数据）。
 */
export function sanitizeSignatureForReferenceSheet(sig: string): string {
  if (!sig) return sig;
  // 把"持有动作"显式标出 — 用常见的「动+名」结构（手握X / 拎着X / 拿着X）
  // 也覆盖 LLM 可能用的更文雅说法（端着 / 怀抱 / 怀抱 / 握在手中 / 握着）。
  const holdVerbs = ['握', '拿', '拎', '端', '抓', '抱', '提', '背', '挎', '提', '揣', '托', '举'];
  // 按"。" / "；" / "；" / "," 拆句，逐一扫描；若一句含持有动词，抽走片段并替换成"随身携带 X（参考图不入画）"
  const sentenceSplitter = /([。；;，,]|\.\s+)/;
  const parts = sig.split(sentenceSplitter);
  const remapped: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    // 跳过空白 / 标点本身
    if (/^[\s。；;，,.]+$/.test(p)) {
      remapped.push(p);
      continue;
    }
    // 检测是否含持有动词
    const holdsSomething = holdVerbs.some(v => p.includes(v));
    if (holdsSomething) {
      // 把持物短语剪掉：如果该句几乎全部由"持有 + 物件"组成，直接替为"随身携带物件（不在画面中）"
      // 简化处理：先整句改写为「其人随身携带：{原句}（参考图不绘制，分镜中再画）」
      // —— 信息保留、姿态不画
      remapped.push(`随身携带：${p}（参考图不绘制，分镜中由剧情驱动出现）`);
    } else {
      remapped.push(p);
    }
  }
  let out = remapped.join('').trim();
  // 兜底：如果清洗后整段由"参考图不绘制..."开了头，加一句隐式反提示，
  // 提醒模型不要在角色图里出现该物件。
  if (out.includes('参考图不绘制')) {
    out += `\n（参考图里禁止出现任何被握持 / 拎拿 / 抱提的物件，角色双手空空自然下垂。）`;
  }
  return out;
}

/**
 * 构造角色参考图的生图 prompt（批量生成 / 手动添加 / 重生成图 三处共用）。
 *
 * 一致性问题的两个根因与对策：
 *  1. 旧 prompt 只带 appearance 一段自然语言，图像模型对自由文本外貌的遵循度低
 *     → 把 hair/eyes/outfit/build/signature/visualAnchors 等结构化字段全部拼入，
 *       每个字段独立成行，越具体越容易被模型执行；
 *  2. 旧 prompt 没有强约束"单人"，"林远"曾生成出两个人
 *     → 明确写「画面中有且仅有一个人」，并禁止出现第二个角色。
 *  3. 旧版只生成 1 张正面立绘，几十页分镜图里角色常需要侧面/特写/远景——
 *     「同一张脸多个角度」靠 1 张图喂不过去。
 *     → 现在每个角色生成 1 张 4 视图参考表（character sheet），2x2 网格包含
 *       正面全身 / 3-4 半身 / 侧面半身 / 面部特写。后续分镜图全部喂这张。
 *
 * 注意：DNA 仍通过 withDnaImagePrompt 完整注入（风格约束是产品核心，不能削），
 * 这里只负责把角色外貌部分做成结构化、末尾强调的形式（注意力对末尾更敏感）。
 */
export function buildCharacterImagePrompt(
  c: {
    name: string;
    appearance: string;
    age?: string;
    height?: string;
    build?: string;
    hair?: string;
    eyes?: string;
    outfit?: string;
    signature?: string;
    visualAnchors?: string[];
    /** 性别枚举（2026-09-01）：'female' / 'male' / 'ambiguous' / 'nonbinary' */
    gender?: 'female' | 'male' | 'ambiguous' | 'nonbinary';
    /** 年龄段枚举（2026-09-01）：child / teen / young_adult / middle_aged / elderly */
    ageBand?: 'child' | 'teen' | 'young_adult' | 'middle_aged' | 'elderly';
    /** 性别可辨识外部特征短句（2026-09-01，由 LLM 在生成 character 时输出） */
    sexTraits?: string;
  },
  worldview: { artStyle: string; paletteMood: string } | undefined,
  shot: CharacterShot,
): string {
  const shotSpec = CHARACTER_REFERENCE_SHOTS.find(s => s.id === shot)!;
  // 结构化外貌清单：只拼非空字段，避免一堆空行稀释注意力
  const traits: string[] = [];
  // 2026-09-09 人种锚定：graphic novel 风格词在图像模型训练分布里带"欧美脸"先验，
  // 必须在结构化外貌清单首位钉死东亚面孔（角色数据暂无 ethnicity 字段，产品当前
  // 定位中文都市叙事 → 默认东亚中国人；将来有明确的多民族角色需求再参数化）。
  traits.push('人种/面孔：东亚中国人（黑直发、面部较平、眉骨低平、眼裂细长、鼻梁适中；禁止欧美深目高鼻面孔）');
  // 2026-09-01 新增：性别与年龄段作为生图模型的硬约束，优先于 age/build 自由文本。
  // 用最短的英文 token 表达（图像模型训练分布里 gender: female / age: young_adult 这种
  // 英文标签命中率最高，长描述反而稀释注意力、推高 prompt 长度）。每个标签 30-40 字符以内。
  if (c.gender) {
    const gMap: Record<string, string> = {
      female: 'Gender: female.',
      male: 'Gender: male.',
      ambiguous: 'Gender: androgynous.',
      nonbinary: 'Gender: nonbinary.',
    };
    traits.push(gMap[c.gender] || `Gender: ${c.gender}.`);
  }
  if (c.ageBand) {
    const aMap: Record<string, string> = {
      child: 'Age: child.',
      teen: 'Age: teen.',
      young_adult: 'Age: young adult.',
      middle_aged: 'Age: middle-aged.',
      elderly: 'Age: elderly.',
    };
    traits.push(aMap[c.ageBand] || `Age: ${c.ageBand}.`);
  }
  if (c.sexTraits) {
    // 性别可辨识外部特征短句 —— LLM 输出通常 12-30 字，统一样式 "Sex traits: ..." 让模型识别为同一字段。
    // 长度 < 80 字符：避免稀释硬性要求段。截断时按字符边界，从尾部裁短（保留头部特征）。
    let traits2 = c.sexTraits.trim();
    if (traits2.length > 80) traits2 = traits2.slice(0, 78) + '…';
    traits.push(`Sex traits: ${traits2}`);
  }
  if (c.age) traits.push(`年龄：${c.age}`);
  if (c.height) traits.push(`身高：${c.height}`);
  if (c.build) traits.push(`体型：${c.build}`);
  if (c.hair) traits.push(`发型与发色：${c.hair}`);
  if (c.eyes) traits.push(`眼睛：${c.eyes}`);
  if (c.outfit) traits.push(`服装：${c.outfit}`);
  if (c.signature) {
    // 2026-09-03 复盘：「signature = 手握随行杯」这类"持有型"签字物进角色参考图后，
    // 会被模型画成"手里端着杯子"，而"握住物体的侧面+ 3/4 view"恰是 T2I 多胳膊
    // 伪影的高发姿态（杯子变成第三只手，或手指多指）。
    // → 角色参考图（character sheet）的目的是"复现一张脸"，不应自带道具；
    //    道具由分镜描述（panel.description）按剧情加进来。
    // → 把"持有型动词 + 物件"从 signature 里摘出来，改写为 "随身携带 X（不入画）"，
    //   既不丢失人物识别信息，又让模型不画持有动作。
    const sanitized = sanitizeSignatureForReferenceSheet(c.signature);
    if (sanitized) traits.push(`标志物/习惯动作：${sanitized}`);
  }
  const anchors = c.visualAnchors ?? [];
  const anchorText = anchors.length > 0 ? `\n视觉锚点（必须全部出现在画面中）：${anchors.join('、')}` : '';
  const traitText = traits.length > 0 ? `\n${traits.join('\n')}` : '';

  const styleMood = worldview
    ? `系列基调参考：${worldview.artStyle}，${worldview.paletteMood}（若与系统规范冲突，以系统规范为准）。`
    : '';

  // shot-specific emphasis (v3: 仅 sheet)
  //   - 'sheet' (4 视图参考表)：核心职责是 4 view 同一人，由 promptTail 详细约束
  const shotEmphasis =
    `\n【本张图的核心职责】这是一张"4 视图参考表"（character sheet）。后续分镜图需要从这张图里"借"角色，4 个 view 共享同一张脸是这张图存在的全部理由。`;

  // 把【镜头】promptTail 移到最前面 —— 模型对 prompt 开头的指令注意力最强，
  // 关键是 promptTail 是 face closeup / sheet 的核心构图描述，必须放最前。
  // 综合外貌 / 硬性要求放在 promptTail 之后作为补充约束。
  return `角色设定图（character reference — ${shotSpec.label}）。
${shotSpec.promptTail}
${shotEmphasis}
${styleMood}
综合外貌：${c.appearance}${traitText}${anchorText}

【硬性要求 —— 生图时必须逐条检查，任何一条不满足即视为失败】
1. 【仅一人】画面中只允许出现一个人物。禁止：第二个人物、双胞胎、镜像、对照组、剪影、背景人物、影子中的人形、画中画。
2. 【纸色底】背景必须是单一纯色纸底，颜色严格遵循上方系统规范的 [PALETTE] 段（如奶油黄/燕麦/暖米白纸色，带印刷纸感）。禁止：纯白 #FFFFFF、冷蓝灰、渐变、阴影、纹理、场景元素、道具、文字、边框、水印。
3. 【发型与发色】上面的"发型与发色"字段必须严格遵循（写"短发"就不能画长发；写"黑发"就不能画其他色）。
4. 【年龄 / 体型 / 服装】上面的"年龄 / 体型 / 服装"字段必须严格遵循。
5. 【视觉锚点】上面的"视觉锚点"（如有）必须全部可识别。
6. 【镜头结构】必须严格遵循镜头规格：${shotSpec.label}。不要输出其他结构。
7. 【柔和光照】均匀柔和的正前方/45度前上方光照，避免侧光造成的半脸阴影。
8. 【线型统一】线型与上色方式必须与系统规范的 [LINEWORK] 段完全一致（由该系列 DNA 定义——细匀线平涂或钢笔交叉排线，以系统规范为准），禁止水彩/素描/照片混合质感。
9. Sex traits visibility: the character's Gender and Age fields above MUST appear visibly in the image (e.g. female → no masculine jawline / no Adam's apple; elderly → visible age lines / grey hair; child → rounded face / small frame). If Sex traits listed, every trait must be drawn. Failure = invalid output.` +
    // 2026-09-03 复盘：用户截图里的 4 视图角色参考图出现「多胳膊」（手杯被画成第三只手）。
    // 末尾高注意力位置再压一条「严格 2 手 2 臂」短指令 —— 负面表 + promptTail 之后，
    // 用最简的中文句子作为决定性锚（图像模型对中文表意短句 + 精确数字的组合非常敏感）。
    `10. 【肢体最后一道闸】每个角色的全身 view 必须正好 2 只手臂 + 2 只手，每只手正好 5 根手指；手臂自然垂在身体两侧，绝不可与任何道具重叠，绝不可交叉抱胸，绝不可插兜，绝不可握持任何物件。如有任何肢体数 ≠ 2 / 手指数 ≠ 5 / 出现额外肢体 / 肢体与道具粘连融合的情况，输出视为失败，必须重画。`;
  }

/**
 * 角色设定图镜头类型 —— 2026-08-31 v3 简化方案：
 *   只保留 4 视图参考表作为唯一参考图。
 *
 * 删除 closeup 的原因：
 *   - 行业最佳实践（YarnSaga / COMICPAD / 即梦 AI / Leonardo 等）都用多视图参考表
 *     作为唯一主参考，没有独立脸模
 *   - closeup + sheet 两张图各自由 T2I 生成，脸部细节容易对不上
 *   - 在分镜 close-up panel 时，4 视图参考表的第 4 格本身就是面部特写，
 *     足以支撑 close-up 镜头的人物一致性
 *
 * 老数据结构兼容：
 *   - 旧版本生成的角色 referenceImages 长度可能是 2（sheet+closeup）或 4（老 4 张），
 *     pickCharacterReference 会统一回退到 sheet（idx 0 / sheet 索引）
 */
export type CharacterShot = 'sheet';

/** 角色设定集镜头规格。prompt 后缀 + aspectRatio 一并在此。
 *
 * 设计原则（v2 — 2 张图方案）：
 *   1. **sheet（4 视图参考表）**：1 张图，2x2 网格，放正面全身 / 3-4 半身 / 侧面半身 / 面部特写。
 *      一次生图内 4 个 view 共享同一张脸，由模型在同一张画布上"对齐"—— 这是保证人物一致性的
 *      核心机制（旧 4 张独立生成的方案一致性最差）。
 *   2. **closeup（独立脸模）**：1 张图，1:1，正面头部特写（head 占比 45-55%，真实证件照比例）。
 *      用 sheet 作为 in-context 参考生成，确保与 sheet 中的 closeup 面板严格一致；
 *      作为后续分镜图生成时的脸模（喂给 provider.reference_images）。
 *   3. **纸色底**：统一为 DNA [PALETTE] 规定的单一纸色底（new-yorker-noir 为奶油/燕麦暖白），
 *      与后续分镜图的纸色一致，保证角色模板和成片色调统一（不要纯白）。
 *   4. **仅一人**：禁止镜像/双胞胎/背景人物 —— 否则会被当作"另一身份"被记入角色库，
 *      破坏后续分镜的人物一致性。
 *
 * 旧的 4 张独立生成方案（front_full / three_quarter / side / closeup）已废弃，
 * 保留 CharacterShot 类型以兼容老数据结构；老角色 referenceImages 长度=4 在前端走兼容路径。
 */
export const CHARACTER_REFERENCE_SHOTS: ReadonlyArray<{
  id: CharacterShot;
  /** 显示标签。 */
  label: string;
  /** 图片 prompt 后缀片段。 */
  promptTail: string;
  /** 输出宽高比。sheet 走 1:1（2x2 网格整齐）；closeup 走 1:1。 */
  aspectRatio: string;
  /** 简短描述，用于日志/UI。 */
  description: string;
}> = [
  {
    id: 'sheet',
    label: '4 视图参考表',
    description: '1 张图，2x2 网格，覆盖正面全身 / 3-4 半身 / 侧面半身 / 面部特写，是人物一致性的核心锚点',
    promptTail:
      // 2026-08-31 风格锁定：实测 "character sheet / 2x2 grid" 模板词会把模型拽向
      // "设定表"训练分布（白底素描 / 水彩写实 / 铅笔淡彩 / 人物占比失控），
      // 必须把风格锚点放在最前压制模板词的分布引力。
      '【风格锁定 —— 优先级最高】最终画面必须是"New Yorker 杂志单幅插画"质感：' +
      '清晰均匀的墨线描边（人物/物件都有明确轮廓，粗细一致不粗不虚）、平涂色块加单层赛璐璐阴影、奶油/燕麦纸色底带印刷感。' +
      'Style lock: the finished artwork must look like a New Yorker magazine spot illustration — ' +
      'clean even ink outlines, FLAT color fills with simple cel shadows, warm cream paper background. ' +
      'NOT a faint pencil sketch, NOT watercolor, NOT a realistic portrait rendering, ' +
      'NOT a pure white background.' +
      // 行业最佳实践（character reference sheet / LoRA 训练数据标准）：
      //   - 用「character reference sheet」+ 「2x2 grid」+ 「four-view turnaround」等英文模板词
      //   - 用每个 view 的具体英文描述（front view full body / three-quarter half-body / side view / face closeup）
      //   - 强调 "same face across all 4 panels"
      '【画布】character reference sheet, 2x2 grid layout (four equal panels, clean alignment), ' +
      'flat uniform background in the paper tone defined by the style directive [PALETTE] above ' +
      '(e.g. cream / oatmeal warm off-white for print-style illustration; NEVER pure #FFFFFF, NEVER cold blue-grey).' +
      'Overall canvas 1:1 square.' +
      '【4 panel contents — English terms so the model maps to training data correctly】' +
      'top-left panel: front view, full body (head to toe, feet shoulder-width apart, facing camera).' +
      'top-right panel: three-quarter view, half body from waist up (body angled 30-45 degrees to camera left).' +
      'bottom-left panel: side view, half body from waist up (face in profile, full ear visible).' +
      'bottom-right panel: face closeup, extreme closeup portrait, face filling 60-70% of the panel, ' +
      'hairline at top edge of panel, jawline at lower third, neck visible to collarbone only.' +
      '【hard constraints】' +
      '1. SAME face across all 4 panels — same hairstyle, same facial features, same face shape, ' +
      'same skin tone, same outfit. Model must self-align; this is the entire point of the sheet.' +
      '2. ONLY ONE person total. No second person, no mirror twin, no shadow figure, no other body parts.' +
      // 2026-08-31 复盘：人物曾缩在格子中央只占面板 20-30% 高度，整张变成"铅笔淡彩小人"。
      '3. FIGURE SCALE: the figure fills 75-85% of each panel\'s height, centered, confidently drawn. ' +
      'No tiny figures floating in empty panels.' +
      '4. Each panel background must be the same flat paper tone as the style directive [PALETTE] specifies ' +
      '(NOT pure white). Gutters between panels (about 5% of canvas width) use the same paper tone.' +
      '5. NO text, NO labels, NO view names, NO axes, NO camera icons, NO borders, NO frames.' +
      '6. NO scene elements, NO props (except clothing/accessories worn by the character), NO shadow gradient, NO texture.' +
      '7. Standing pose in every panel (no weird pose), clothing consistent.' +
      // 2026-09-03 复盘：用户截图显示 4 视图角色设定表里出现「多胳膊」+「自带保温杯」。
      //   ① 自带道具是主因之一（手里握住东西的侧面+ 3/4 view 极易诱发模型把道具画成
      //     「第三只手」「手指多指」或「道具+手臂重叠成两个人形」）。
      //   ② 转身 3/4 视图 + 双臂交叉/插兜/抱胸/握物会让模型对肢体数量的分布产生歧义。
      //   → 角色参考图必须保持"空手 + 自然下垂 + 同一姿态"，道具一律在分镜里再加。
      //   → 这是「同一张脸后续几十页都不能错」的人口 —— 第一张图就不允许脏。
      '8. 【HAND COUNT — 严格 2 手】Every panel must show EXACTLY 2 hands total ' +
      '(one per arm, dangling naturally at the sides or resting on the hips). ' +
      'NO cup, NO bottle, NO bag, NO phone, NO prop being held in ANY panel ' +
      '(holding anything dramatically raises multi-arm / extra-finger artifacts and is forbidden here). ' +
      'Hands must be open or relaxed fists, NEVER gripping an object.' +
      '9. 【ARM COUNT — 严格 2 臂】Every figure has exactly 2 arms and 2 hands, with correct left/right placement. ' +
      'NO third arm, NO extra limb, NO shoulder duplication, NO arm growing from torso.' +
      '5 fingers per hand, NEVER 6/7, NEVER fused fingers.' +
      '10. 【POSE — 静立、面向】Front-view panel = body facing camera, feet shoulder-width apart, both arms hanging down or one slightly forward, NEVER crossed arms. ' +
      'Three-quarter panel = body angled 30° to one side, NOT 90° turn, hands at sides. ' +
      'Side panel = pure profile (face in profile, body in profile), hands at sides. ' +
      'Close-up panel = neck down to upper chest visible, hands NOT in frame at all.',
    aspectRatio: '1:1',
  },
];

/**
 * 生成一个角色的唯一参考图（4 视图参考表 sheet）。
 *
 * v3 简化方案（2026-08-31）：删除独立脸模（closeup），只保留 sheet 作为参考图。
 * 行业共识（YarnSaga / COMICPAD / 即梦 AI / Leonardo）都用多视图参考表作唯一主参考。
 * sheet 内的第 4 格本身就是面部特写，足以支撑 close-up 分镜的人物一致性。
 *
 * @param dnaKey  系列级 DNA（必须传，避免风格漂移到默认 DNA）
 */
export async function generateCharacterReferenceSet(
  c: {
    name: string;
    appearance: string;
    age?: string;
    height?: string;
    build?: string;
    hair?: string;
    eyes?: string;
    outfit?: string;
    signature?: string;
    visualAnchors?: string[];
    gender?: 'female' | 'male' | 'ambiguous' | 'nonbinary';
    ageBand?: 'child' | 'teen' | 'young_adult' | 'middle_aged' | 'elderly';
    /**
     * 性别可辨识外部特征短句（2026-09-01）。
     * AI 生成角色时输出；不会持久化到 character 数据里，
     * 而是每次生图时由调用方重新计算（避免历史数据被写死污染）。
     */
    sexTraits?: string;
  },
  worldview: { artStyle: string; paletteMood: string } | undefined,
  dnaKey: DnaKey,
): Promise<Record<CharacterShot, string | null>> {
  const config = getConfig().image;
  const provider = getImageProvider(config);

  /**
   * 单张图带重试 —— Provider 偶发 5xx / 网络瞬断不应让整套参考图残缺。
   * Agnes 图片 API 高频返回 503 "text image queue is full"（实测约 1/3 概率），
   * 1s/2s 的短退避扛不住排队拥堵 —— 改为 5 次尝试、4s/8s/12s/16s 递增退避。
   * 全部失败 → 记 null，调用方根据 totalRefs 决定是否提示用户。
   */
  async function generateOne(
    shot: typeof CHARACTER_REFERENCE_SHOTS[number],
  ): Promise<[CharacterShot, string | null]> {
    const styleRefsChar = getStyleRefs(dnaKey);
    const prompt = buildCharacterImagePrompt(c, worldview, shot.id) + styleRefsChar.note;
    const baseReq = withDnaImagePrompt(
      {
        prompt,
        aspectRatio: shot.aspectRatio,
        // 画风基准稿作为参考图注入 —— 与分镜出图同一锚定机制。
        // sheet 是纯文本生图的历史路径，Provider 接口相同（分镜已在传参考图）。
        referenceImages: styleRefsChar.images.length > 0 ? styleRefsChar.images : undefined,
      },
      { dnaKey, purpose: 'character', shotKind: shot.id },
    );
    if (baseReq.prompt.length > 8000) {
      // 2026-09-01 微调：>8000 时同时打 head/tail 样本 + Provider 实际限值提示。
      // 真正的截断诊断在 dna-inject.ts 里 —— 这里只做"早预警"。
      const limit = config.provider === 'step' ? 512 : 9500;
      console.warn(
        `[series-routes] 角色 ${c.name} ${shot.label} prompt ${baseReq.prompt.length} 接近上限 ${limit}\n` +
        `  head(150): ${JSON.stringify(baseReq.prompt.slice(0, 150))}\n` +
        `  tail(150): ${JSON.stringify(baseReq.prompt.slice(-150))}`,
      );
    } else {
      console.log(`[series-routes:debug] 角色 ${c.name} ${shot.label} prompt.length=${baseReq.prompt.length} styleRefCount=${styleRefsChar.images.length}`);
    }
    let lastErr: string | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const img = await provider.generateImage(config, baseReq);
        // 2026-09-03 limb-guard：同上，角色参考图必经巡检。
        // 2026-09-07：guardedImage 现在返回 { image, audit }。
        const guarded = await guardedImage(img.image, baseReq.prompt, dnaKey);
        logGeneration('character-reference-image', {
          model: config.model,
          characterName: c.name,
          shot: shot.id,
          attempt,
          hasRefImages: styleRefsChar.images.length > 0,
          prompt: baseReq.prompt,
          dnaKey,
        });
        return [shot.id, saveDataUrlImage(guarded.image)];
      } catch (e: any) {
        lastErr = (e?.message || String(e)).slice(0, 200);
        console.warn(`[series-routes] 角色 ${c.name} ${shot.label} 第 ${attempt + 1} 次生成失败：${lastErr}`);
        if (attempt < 4) await new Promise(r => setTimeout(r, 4000 * (attempt + 1)));
      }
    }
    console.warn(`[series-routes] 角色 ${c.name} ${shot.label} 5 次尝试仍失败，最终丢弃：${lastErr}`);
    return [shot.id, null];
  }

  const sheetSpec = CHARACTER_REFERENCE_SHOTS.find(s => s.id === 'sheet')!;
  const [_, sheetPath] = await generateOne(sheetSpec);

  return {
    sheet: sheetPath,
  } as Record<CharacterShot, string | null>;
}

/** 2 张图是否全部成功 —— 用于提示用户"角色形象已完整生成"。 */
export function allShotsPresent(set: Record<CharacterShot, string | null>): set is Record<CharacterShot, string> {
  return CHARACTER_REFERENCE_SHOTS.every(s => set[s.id]);
}

/** 把分镜镜头标签归类到角色参考图。v3 只剩 sheet 一种参考图。
 *
 * 函数依然存在并返回 'sheet'，是为了在分镜代码中保留抽象层（未来若重新引入第二张
 * 参考图，只改这里一行即可，不用动下游所有调用）。
 *
 *  - close-up / extreme / 特写 → sheet（4 视图参考表，其中第 4 格就是面部特写，
 *    足以支撑 close-up 镜头的人物一致性）
 *  - 其他（mid / wide / 过肩 / 半身 / 中景 / 远景 / 全景 / 未指定） → sheet
 */
export function pickReferenceShotForPanel(camera?: string): CharacterShot {
  return 'sheet';
}

/** 选取一个角色的参考图。v3 单一参考图 —— 不再区分 shot。
 *
 * 兼容策略：
 *  - 新结构 referenceImages.length === 1：直接取 arr[0]
 *  - 旧结构 referenceImages.length === 2：sheet + closeup，只取 sheet (idx 0)
 *  - 老结构 referenceImages.length === 4：front_full / three_quarter / side / closeup，
 *    sheet 角色覆盖正面全身 + 3-4 半身 + 侧面半身 + 面部特写 —— 取 idx 0（正面全身）作兜底
 *  - 都没有：降级到 referenceImage 单字段
 */
export function pickCharacterReference(
  c: { referenceImages?: string[]; referenceImage?: string },
  shot: CharacterShot,
): string | undefined {
  const arr = c.referenceImages;
  if (arr && arr.length > 0) {
    // 兼容：旧 2 张（sheet, closeup）或 4 张结构 —— 一律取 sheet（idx 0）
    if (arr[0]) return arr[0];
  }
  return c.referenceImage;
}

/**
 * 把镜头规格合并到角色外貌 prompt 后面。共享一段外貌文字（保证 4 张图脸一致），
 * 末尾换 shotTail —— 这是「同一张脸多个角度」的关键。
 *
 * 实现见上方第一个 buildCharacterImagePrompt 定义。
 */

export function buildCharacterDescLine(c: SeriesCharacter): string {
  // 服装一致性「单一事实源」：服装只认 outfit 字段与参考图，不认 appearance 文本。
  // 原因：appearance 是自由文本，可能含"衣着从A逐渐变成B""去公司时换成C"这类演变句，
  // 一旦整段注入，模型每格都读到"可以换装"，就会随镜头/批次自由发挥 → 同话服装跳变。
  //
  // 2026-09-03 复盘（沈也、陆远）：
  //   - 沈也 appearance 结尾写"衣着从浅灰蓝衬衫…逐渐变成更简洁的针织衫与低跟鞋"，
  //     与 outfit（固定"浅灰蓝衬衫+深灰西裤"）和参考图直接矛盾；
  //   - 陆远 outfit 里也写"常穿雾蓝色旧连帽衫…去公司时换成普通夹克"，同为可变描述。
  // 最佳实践（角色设定图 = 脸/发型/服装的唯一权威）：有结构化字段时只用结构化字段，
  // 只有旧数据完全没有结构字段时才回退到 appearance 文本。
  const hasStructured = Boolean(
    c.gender || c.ageBand || c.age || c.build || c.hair || c.eyes || c.outfit || c.signature,
  );
  if (!hasStructured) {
    // 旧数据兜底：无结构化字段时才用 appearance（无 演变句 风险，因为字段本身不存在）。
    return `- ${c.name}：${c.appearance}`;
  }
  const parts: string[] = [];
  // 2026-09-09 人种锚定：分镜描述行首钉死东亚面孔，与角色 sheet 的参考图双保险。
  parts.push('东亚中国面孔');
  // 2026-09-01 v2 紧凑版：在分镜 prompt 中用最短标签标注性别与年龄段。
  // 用英文 token（女性/F / female 都能识别），保持整行 ≤ 25 字符。
  if (c.gender) {
    const gMap: Record<string, string> = {
      female: 'F',
      male: 'M',
      ambiguous: 'X',
      nonbinary: 'NB',
    };
    parts.push(gMap[c.gender] || c.gender);
  }
  if (c.ageBand) {
    const aMap: Record<string, string> = {
      child: 'child',
      teen: 'teen',
      young_adult: 'young',
      middle_aged: 'mid',
      elderly: 'elderly',
    };
    parts.push(aMap[c.ageBand] || c.ageBand);
  }
  if (c.age) parts.push(c.age);
  if (c.build) parts.push(c.build);
  if (c.hair) parts.push(c.hair);
  if (c.eyes) parts.push(c.eyes);
  // 服装唯一来源：outfit 字段。绝不回退 appearance 里的服装描述。
  if (c.outfit) parts.push(`服装：${c.outfit}`);
  if (c.signature) parts.push(c.signature);
  return `- ${c.name}：${parts.join('；')}`;
}

/**
 * 全局页游标：按全系列顺序收集目标页之前（可选含目标页）的最近 count 页，
 * 跨章节边界 —— 修复「续写时上一章结尾不在上下文」「breakdown 对前文一无所知」。
 */
export function buildRecentContext(series: Series, pageId: string, includeTarget: boolean, count = 3): string {
  const flat: { ch: Chapter; p: SeriesPage }[] = [];
  for (const ch of iterAllChapters(series)) for (const p of ch.pages) flat.push({ ch, p });
  const idx = flat.findIndex(x => x.p.id === pageId);
  if (idx < 0) return '';
  const end = includeTarget ? idx + 1 : idx;
  const slice = flat.slice(Math.max(0, end - count), end).filter(x => x.p.panels.length > 0);
  if (slice.length === 0) return '（这是故事的开头，没有前文。）';
  // 2026-09-03 服装一致性：把最近几页出场角色的"服装锚点"一并给到分镜/续写模型，
  // 让它在写 description 时知道每个角色本话已确认的装束，避免自己发明新服装 → 同话服装跳变。
  const charMap = new Map(series.characters.map(c => [c.id, c]));
  const outfitIds = new Set<string>();
  for (const x of slice) for (const pn of x.p.panels) for (const cid of pn.characterIds) outfitIds.add(cid);
  const outfitBlockLines = [...outfitIds]
    .map(id => charMap.get(id))
    .filter((c): c is SeriesCharacter => Boolean(c && (c.outfit || c.visualAnchors)))
    .map(c => `- ${c.name}：${c.outfit ? `服装=${c.outfit}` : '见角色设定'}（${(c.visualAnchors ?? []).join('、')}）`);
  const outfitBlock = outfitBlockLines.length > 0
    ? `\n本话已确立的出场角色装束与视觉锚点（服装必须全程一致，仅当剧情明确换装时才改变，禁止自行发明）：\n${outfitBlockLines.join('\n')}`
    : '';
  return slice.map(x =>
    `第 ${x.p.pageNumber} 页（${x.ch.title}）：${x.p.title}\n` +
    `场景：${x.p.sceneDescription}\n` +
    `分镜：\n${x.p.panels.map(pn => `  ${pn.index}. ${pn.description}${pn.dialogue ? `（对白："${pn.dialogue}"）` : ''}`).join('\n')}`
  ).join('\n\n') + outfitBlock;
}

// ── 分镜出图（generate / regenerate / rewrite 共用）──────────────────────

/**
 * 画风基准参考图（用户确认过的基准稿，落盘在 server/data/style-refs/<dnaKey>/）
 * + 注入说明。进程内按 DNA 缓存，目录为空时降级为纯文本锚定。
 *
 * 2026-08-31 复盘：纯文本 DNA 锚定会随题材漂移（纯场景格变照片、设定表
 * 模板词把画风拽向白底素描）。确认稿作为 reference images 直接注入每次
 * 生图请求，是画风一致性的硬锚点 —— 只学画风，严禁抄内容。
 *
 * 2026-09-10 两处修复：
 *  1) 基准图按 DNA 取（loadStyleReferenceImages(dnaKey)）—— 旧实现是全局一份
 *     "New Yorker 细线平涂"确认稿注入所有 DNA 的生图请求，换 DNA 之后
 *     等于每张图都在教模型画回旧风格（图像参考的权重远大于文字）。
 *  2) note 去掉硬编码的画风描述 —— "细而均匀的单一线宽墨线、灰调平涂上色"
 *     是 new-yorker-noir 的措辞，与 graphic-novel-ink 的交叉排线要求直接冲突，
 *     且位于 prompt 尾部（高注意力）。画风由 DNA 系统指令统一规定，
 *     此处不得重复规定，只保留"只学画风、严禁抄内容"的职责。
 */
const styleRefCache = new Map<DnaKey, { images: { data: string; mimeType: string }[]; note: string }>();

export function getStyleRefs(dnaKey: DnaKey): { images: { data: string; mimeType: string }[]; note: string } {
  const cached = styleRefCache.get(dnaKey);
  if (cached) return cached;
  const images = loadStyleReferenceImages(dnaKey).map(data => ({ data, mimeType: 'image/jpeg' }));
  const note = images.length > 0
    ? `\n【画风参考图】最后 ${images.length} 张是本系列的画风基准：只学习其线条处理方式、上色方式、纸面质感与构图气质，用于校准画风（具体画风以系统规范为准）。严禁把参考图中的人物、家具、窗景等具体内容画进画面——参考图中的人物不是本格出场角色，严禁出现在结果里。`
    : '';
  const entry = { images, note };
  styleRefCache.set(dnaKey, entry);
  return entry;
}

/**
 * 构造单格分镜的出图 prompt（含参考图身份绑定）。
 * generatePanelImages 与 panel-rewrite 共用，避免两处逻辑漂移。
 *
 * 修复的三个质量问题（2026-08-31 老油条案例复盘）：
 *  1. 「单人单场景」硬编码与双人对话格自相矛盾 → 按本格实际人数写「有且仅有 N 人」；
 *  2. 多参考图无身份绑定，模型把第二个角色画成第一个的复制品 → 每张参考图
 *     显式绑定到角色名（"参考图1 = 林小满"），并写明"不同角色必须长相/体型/服装明显不同"；
 *  3. 无名配角（前台/路人）只存在于 description 文字里，模型手边唯一的"人"是主角
 *     → extraCharacters 以文字描述注入，并明确"此人不是参考图中人物，禁止与参考图相似"；
 *  4. dialogue（读者旁白）不再注入图像 prompt —— DNA 规则要求画面内无文字，
 *     注入对白只会诱导模型画出乱码招牌/气泡。
 */
export function buildPanelImagePrompt(opts: {
  style: string;
  mood: string;
  sceneDescription: string;
  description: string;
  /** 有参考图的角色（appearance 描述行），顺序与 refImages 一致。 */
  charDescLines: string[];
  /** 角色名列表，与 charDescLines / refImages 一一对应。 */
  boundCharNames: string[];
  anchorText: string;
  extraCharacters?: { name: string; appearance: string }[];
}): string {
  const n = opts.boundCharNames.length + (opts.extraCharacters?.length ?? 0);
  // description 兜底清洗：旧数据/模型违规会把旁白写成"（对白："…）"塞进画面描述。
  // 旁白进图像 prompt 会诱导模型画出乱码文字（TEXT_VS_IMAGE 规则要求画面内无字）。
  let cleanDescription = opts.description
    .replace(/（\s*对白[：:][^）]*）/g, '')
    .replace(/\(\s*对白[：:][^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // 2026-09-02 乱码修复：分镜文本若给道具指定可读文字（印着「朝九晚六」的手册、
  // 写着「灵气」的卡片），图像模型会强行渲染中文 → 乱码。统一清洗为无字。
  cleanDescription = cleanDescription.replace(/[「『][^」』]{0,30}[」』]/g, '（无字）');
  const sceneDescription = opts.sceneDescription.replace(/[「『][^」』]{0,30}[」』]/g, '（无字）');
  const bindText = opts.boundCharNames.length > 0
    ? `\n参考图身份绑定（第 i 张参考图 = 第 i 个角色，严禁张冠李戴）。注意：每张参考图都是同一人物的多角度设定图（全身/半身/侧面/面部特写拼在一张里），它代表 1 个人，不是多个人 —— 画面中该角色只出现 1 次，取与当前镜头最贴合的那一个视角形象来画：\n${opts.boundCharNames.map((name, i) => `- 参考图${i + 1} = ${name}`).join('\n')}`
    : '';
  const extraText = opts.extraCharacters && opts.extraCharacters.length > 0
    ? `\n其他出场人物（无参考图，仅文字描述 —— 他们不是参考图中的人物，外貌必须与参考图人物明显不同，禁止画成参考图人物的复制品）：\n${opts.extraCharacters.map(ec => `- ${ec.name}：${ec.appearance}`).join('\n')}`
    : '';
  const distinctText = n > 1
    ? `\n【多人区分】画面中有且仅有 ${n} 个人物。不同人物必须是不同的脸、不同的发型、不同的体型与服装，一眼可辨；严禁出现双胞胎、镜像、复制人，严禁把某一角色的脸复制给另一角色。`
    : n === 1
      ? `\n【单人性】画面中有且仅有 1 个人物。禁止第二个人物、镜像、剪影、复制人。`
      : `\n【无人物】本格画面中不出现任何人物，只画场景与物件。`;
  // 2026-09-01 新增（v2 紧凑版）：把"出场人物的性别年龄段必须匹配"压成一行短 token，
  // 避免分镜 prompt 长度被中文长描述推高。注意 buildCharacterDescLine 已包含性别/年龄，
  // 这里只是兜底钉一次，避免参考图脸错了分镜也错。
  const genderHintText = opts.boundCharNames.length > 0
    ? `\nGender/Age must match each character's data above. Ethnicity: East Asian Chinese faces for all characters (follow the reference sheets); never draw Western/Caucasian facial features.`
    : '';
  // 2026-08-31 复盘：纯场景格（无人物）+ 玻璃幕墙/晨光反射类描述会把模型拽进摄影分布，
  // 整张输出成实景照片（负面表已补 photograph/photorealistic，这里再加正向硬约束双保险）。
  //
  // 2026-09-10 修复指令打架：这里原本硬编码「平涂色块、细匀墨线」（new-yorker-noir 遗留措辞）。
  // 该段位于 prompt 尾部（注意力最高位），且落在 req.prompt 内 —— 而 dna-inject 的策略是
  // "永不截断业务 prompt"，所以它一定会被完整送到模型，稳定压过头部 DNA 注入的画风指令
  // （graphic-novel-ink 要求钢笔交叉排线、明确禁止平涂）。结果就是画面被拉回旧风格。
  // 现在此段只保留其本职功能 —— "防止画成照片"，具体画风（排线/平涂/色板）一律交给 DNA。
  const noPhotoText = n === 0
    ? `\n【媒介约束】本格为手绘插画，画风严格遵循前述系统规范。绝不能是照片、实景摄影、真实质感渲染 —— 哪怕画的是玻璃幕墙、车流、街景，也必须呈现为"画出来的插画"。`
    : `\n【媒介约束】最终画面是手绘插画（画风严格遵循前述系统规范），不是照片。`;
  // 2026-09-02 人物一致性：服装/发型硬约束 —— 模型会自行"换装"（灰西装被画成粉T恤），
  // 在 prompt 尾部（注意力高位置）钉死"服装只按参考图与 outfit 字段来"。
  // 2026-09-03 强化：服装是单一事实源，禁止因场景亮度/时间/镜头/情绪而自行增减或更换
  // —— 同话跨格必须稳定，唯一的换装入口是"画面内容"里明确写出的带理由的换装行为。
  const outfitLockText = opts.boundCharNames.length > 0
    ? `\n【服装硬约束】每个角色的服装/发型是唯一的：以该角色 reference sheet（参考图）与角色描述中的"服装"字段为准，本格与相邻各格、本话各格必须完全一致，禁止因场景、时间、光线、镜头、情绪而自行更换/增减/改色。唯一的换装例外：仅当"画面内容"明确写出该角色正在换装/已换衣（含明确理由，如"隔天上班换了外套"）时，才按该描述执行该格；否则一律保持同一套服装。`
    : '';
  return `单幅画面（standalone illustration，禁止多格拼接）。画风与色调遵循前述系统规范；系列基调参考：${opts.style}，${opts.mood}（若与系统规范冲突，以系统规范为准）。\n场景：${sceneDescription}\n画面内容：${cleanDescription}${opts.charDescLines.length > 0 ? `\n出场角色（参考图已提供）：\n${opts.charDescLines.join('\n')}` : ''}${bindText}${extraText}${opts.anchorText}${distinctText}${genderHintText}\n要求：画面聚焦于"画面内容"描述的瞬间；有参考图的人物必须严格按对应参考图的脸部/发型/服装/年龄绘制；不要输出多格拼接图，不要在画面内写任何文字（场景中书籍/招牌/屏幕/文件等道具一律无字）。${outfitLockText}${noPhotoText}`;
}

/**
 * 2026-09-10 新增：把上一轮"不达标"的具体原因转成修正指令，注入重试的 prompt。
 *
 * 背景（重试形同重掷骰子）：旧实现把出图请求建在重试循环**外**，三次尝试用的是
 * 完全相同的 prompt。而 8 维评审已经明确产出了 topIssue（例如"主角无眼镜且长发"），
 * 这个信息却被直接丢弃 —— 于是"发现问题→修正"退化成"同一 prompt 抽三次奖"。
 *
 * 设计约束：
 *  - 只追加"上一版哪里不对"，**不重复描述画风**（画风归 DNA 统一管，这里再写会打架）；
 *  - 明确要求保持画风/身份/服装不变 —— 否则重试容易顺手把人物画漂；
 *  - 文本要短：它落在 req.prompt 内（不会被截断），但整体 prompt 逼近 9500 上限时
 *    会先把 avoidText 挤掉，负面护栏丢失反而更糟。
 */
function buildPanelCorrectionText(issues: {
  reviewIssue?: string;
  limbReason?: string;
  genderReason?: string;
  /** 2026-09-11 图文对齐门禁：description 里的关键要素（道具/人数/动作）没画出来。 */
  alignmentReason?: string;
}): string {
  const lines: string[] = [];
  if (issues.reviewIssue) lines.push(`- 画质评审指出的问题：${issues.reviewIssue}`);
  if (issues.limbReason) lines.push(`- 肢体结构问题：${issues.limbReason}`);
  if (issues.genderReason) lines.push(`- 角色性别不符：${issues.genderReason}`);
  // 对齐缺失信息量最高：直接告诉模型"上一版缺了哪些描述要素"，比画质评语更能指导重画。
  if (issues.alignmentReason) lines.push(`- 描述要素缺失（画面里必须画出）：${issues.alignmentReason}`);
  if (lines.length === 0) return '';
  return [
    '',
    '【上一版问题修正（必须整改，本版严禁重复出现）】',
    ...lines,
    '请在保持画风、人物身份（脸型/发型/年龄）、服装与场景不变的前提下，针对上述问题重新绘制。',
  ].join('\n');
}

/** 收集一格分镜的参考图与角色描述（出图与重写共用）。 */
export function collectPanelCharacterRefs(
  series: Series,
  panel: Pick<Panel, 'characterIds' | 'camera'>,
): { refImages: { data: string; mimeType: string }[]; charDescLines: string[]; boundCharNames: string[]; anchorText: string } {
  const charMap = new Map(series.characters.map(c => [c.id, c]));
  const refImages: { data: string; mimeType: string }[] = [];
  const charDescLines: string[] = [];
  const boundCharNames: string[] = [];
  const anchorLines: string[] = [];
  const shot = pickReferenceShotForPanel(panel.camera);
  for (const charId of panel.characterIds) {
    const c = charMap.get(charId);
    if (!c) continue;
    charDescLines.push(buildCharacterDescLine(c));
    boundCharNames.push(c.name);
    // 强制把每个出场角色的 visualAnchors（高辨识度物理特征）带入 prompt，
    // 解决「几十页后角色换脸」的问题。这是「形象一致性」的核心。
    const anchors = c.visualAnchors ?? [];
    if (anchors.length > 0) anchorLines.push(`- ${c.name} 的视觉锚点（必须全部出现在画面中）：${anchors.join('、')}`);
    const refPath = pickCharacterReference(c, shot);
    const data = refPath ? resolveImageData(refPath) : null;
    if (data) refImages.push({ data, mimeType: 'image/png' });
  }
  const anchorText = anchorLines.length > 0 ? `\n视觉锚点（一致性约束）：\n${anchorLines.join('\n')}` : '';
  return { refImages, charDescLines, boundCharNames, anchorText };
}

/**
 * 2026-09-08 自动修复：一次性配角 appearance 缺性别标签时，
 * 调 text LLM 从上下文（分镜描述 + 场景）推断性别标签并就地补全
 * （直接修改传入的 panels 对象 —— 调用方持有的就是 store 里的引用，随后会随 persist 落盘）。
 *
 * 返回 true 表示至少补全了一条；失败抛错由调用方决定降级策略。
 */
const GenderFixZ = z.object({
  fixes: z.array(z.object({
    key: z.string().min(1),
    genderDescriptor: z.string().min(1).max(20),
  })).min(1),
});
const GenderFixSchema = {
  type: 'object',
  properties: {
    fixes: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: '输入列表里的 key，原样返回' },
          genderDescriptor: { type: 'string', description: '性别描述词，如：中年女/年轻男/30岁左右男/数名男女混合' },
        },
        required: ['key', 'genderDescriptor'],
      },
    },
  },
  required: ['fixes'],
} as Record<string, unknown>;

const GENDER_HINTS_FOR_REPAIR = ['男', '女', '先生', '女士', '小伙', '姑娘', 'man', 'woman', 'male', 'female', '他', '她', 'boy', 'girl', 'lady', 'gentleman'];

/**
 * 自动补全分镜 description 到 ≥ 60 字。
 *
 * 2026-09-18：validatePanel 把 description < 60 改为 repairable 类，
 * generatePanelImages 入口先调本函数把描述补齐再校验，避免 LLM 偶尔写
 * 50-58 字导致整页生图被卡死。
 *
 * 设计原则：
 *  - 不重写整段，只在末尾追加"细化场景细节"（位置/姿态/视线/关键道具），
 *    避免改变原意。
 *  - 一次调用补齐所有不合格 panel（≤ 6 个），单次输出 JSON 数组。
 *  - 任何 LLM 错误 / 返回过短 → 返回 null，由调用方降级为 warning。
 */
const DescriptionRepairSchema = {
  type: 'object',
  properties: {
    fixes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer', description: 'panel 在原数组中的 0-based 序号' },
          extendedDescription: {
            type: 'string',
            description: '在原 description 基础上追加细节，使总长 ≥ 60 字。保留原文不删减，必要时改写不通顺处。',
          },
        },
        required: ['index', 'extendedDescription'],
      },
    },
  },
  required: ['fixes'],
} as Record<string, unknown>;

const DescriptionRepairZ = z.object({
  fixes: z.array(z.object({
    index: z.number().int().nonnegative(),
    extendedDescription: z.string().min(40),
  })).min(1),
});

export async function repairShortDescriptions(
  panels: Panel[],
  sceneDescription: string,
  dnaKey: DnaKey,
): Promise<boolean> {
  const items = panels
    .map((p, idx) => ({ idx, p, len: (p.description || '').trim().length }))
    .filter(it => it.len < 60 && it.len > 0); // 完全空的不修，避免给 LLM 编造整段画面
  if (items.length === 0) return false;

  const prompt = [
    '为以下漫画分镜补全 description 到 ≥ 60 字（中文字符），不要删减原文，必要时改写不通顺处。',
    '补全方向：①每个人的具体位置与相对距离 ②正在做的具体动作/手势 ③视线方向（看哪/看谁/看地面）④1-2 个关键道具及其状态。',
    '',
    `场景：${sceneDescription.slice(0, 300)}`,
    '',
    '分镜列表（index | 当前描述）：',
    ...items.map(it => `- ${it.idx} | ${it.p.description || ''}`),
    '',
    '严格输出 JSON，extendedDescription 必须包含原文并在其基础上扩写到 ≥ 60 字。',
  ].join('\n');

  let result: z.infer<typeof DescriptionRepairZ>;
  try {
    result = await callStructuredJson<z.infer<typeof DescriptionRepairZ>>(
      prompt,
      '你是一位漫画分镜顾问。输出严格 JSON。',
      DescriptionRepairSchema,
      {
        dnaKey,
        temperature: 0.3,
        logKind: 'repair-short-descriptions',
        validate: raw => DescriptionRepairZ.parse(raw),
      },
    );
  } catch (e: any) {
    console.warn(`[repair-short-descriptions] LLM 调用失败：${e?.message || e}`);
    return false;
  }

  let patched = 0;
  for (const fix of result.fixes) {
    const it = items.find(x => x.idx === fix.index);
    if (!it) continue;
    const extended = (fix.extendedDescription || '').trim();
    if (extended.length < 60) continue;
    it.p.description = extended;
    patched++;
  }
  console.log(`[repair-short-descriptions] 自动补全 ${patched}/${items.length} 个分镜的 description`);
  return patched > 0;
}

export async function repairExtraCharacterGenders(
  panels: Panel[],
  sceneDescription: string,
  dnaKey: DnaKey,
): Promise<boolean> {
  // 1) 收集缺性别标签的配角（key = "格索引:配角索引"，用于回填）
  const items: Array<{ key: string; name: string; appearance: string; context: string }> = [];
  const positions: Array<{ panelIdx: number; ecIdx: number }> = [];
  panels.forEach((p, pi) => {
    (p.extraCharacters || []).forEach((ec, ei) => {
      const ap = (ec.appearance || '').toLowerCase();
      if (!GENDER_HINTS_FOR_REPAIR.some(h => ap.includes(h.toLowerCase()))) {
        items.push({
          key: `${pi}:${ei}`,
          name: ec.name,
          appearance: (ec.appearance || '').trim(),
          context: (p.description || '').replace(/\s+/g, ' ').slice(0, 160),
        });
        positions.push({ panelIdx: pi, ecIdx: ei });
      }
    });
  });
  if (items.length === 0) return false;

  // 2) 一次 LLM 调用推断全部性别标签
  const prompt = [
    '为以下漫画一次性配角推断性别描述词（用于图像生成提示词，必须明确性别）。',
    '',
    `场景：${sceneDescription.slice(0, 300)}`,
    '',
    '配角列表（key | 名字 | 当前外貌描述 | 所在分镜描述）：',
    ...items.map(it => `- ${it.key} | ${it.name} | ${it.appearance || '（空）'} | ${it.context}`),
    '',
    '规则：',
    '- 根据名字、外貌描述、分镜上下文推断最可能的性别与年龄段，如：中年女 / 年轻男 / 30岁左右男 / 老年男。',
    '- 若是多人群体（如"散会同事（数人）"）且无法确定单一性别，用「数名男女混合」这类群体描述。',
    '- 完全无法推断时，给出该场景下最合理的默认值（如办公室场景用「30岁左右男」或「中年女」），不要输出空串。',
    '- genderDescriptor ≤ 20 字，中文。',
  ].join('\n');
  const result = await callStructuredJson<z.infer<typeof GenderFixZ>>(
    prompt,
    '你是一位漫画分镜顾问。输出严格的 JSON。',
    GenderFixSchema,
    {
      dnaKey,
      temperature: 0.2,
      logKind: 'repair-gender-tags',
      validate: raw => GenderFixZ.parse(raw),
    },
  );

  // 3) 就地回填 appearance（保留原描述，把性别词前置）
  let patched = 0;
  for (const fix of result.fixes) {
    const pos = positions[items.findIndex(it => it.key === fix.key)];
    if (!pos) continue;
    const ec = panels[pos.panelIdx].extraCharacters?.[pos.ecIdx];
    if (!ec) continue;
    const ap = (ec.appearance || '').trim();
    ec.appearance = ap ? `${fix.genderDescriptor}，${ap}` : fix.genderDescriptor;
    patched++;
  }
  console.log(`[repair-gender-tags] 自动补全 ${patched}/${items.length} 个一次性配角的性别标签`);
  return patched > 0;
}

/**
 * 单格出图失败的信息（2026-10-15 新增）。
 * 单格失败不再炸整页 —— 前面几格的钱已经花了、图已经落盘，
 * 让它们变成没人引用的孤儿文件等于让用户重跑再付一遍。
 */
export interface PanelGenFailure {
  /** panel 自身的下标（不是 sorted 数组下标）。 */
  panelIndex: number;
  reason: string;
}

/** 单批（整页 / 单格 / 重写）出图的结算结果。 */
export interface PanelGenResult {
  /**
   * 与入参 `panels` **同序同长**；成功的格有 web 路径，失败的格为 `null`。
   * 保序是硬要求 —— 调用方普遍用 `paths[i]` 对应 `panels[i]` 写回 imageUrl。
   */
  paths: Array<string | null>;
  /** 失败格清单（供调用方拼错误文案 + 保留成功结果）。 */
  failures: PanelGenFailure[];
}

export interface GeneratePanelImagesOptions {
  /**
   * 出图并发数（默认 3）。
   * 每格最坏要跑 3 轮 × 5 次模型调用，串行时整页线性叠加；
   * 3 路是「明显提速」与「不打爆上游限流」的折中。
   * 设为 1 可退回串行（排查用）。
   */
  concurrency?: number;
  /**
   * 进度回调：每完成一格触发一次（含失败格）。
   * 调用方通常接 `(d, t) => setTaskProgress(taskId, Math.round(d / t * 100))`。
   */
  onProgress?: (done: number, total: number) => void;
}

/**
 * 出图的默认并发数。
 * 集中一处，便于按上游实际限流表现调整。
 */
const DEFAULT_PANEL_CONCURRENCY = 3;

/**
 * 把失败格清单拼成一句用户能直接照做的文案。
 *
 * 关键是**说清楚"成功的图已经保住了"** —— 否则用户看到红色报错会以为整页白跑，
 * 从而把已经付过钱的图重画一遍（这正是并发改造要避免的行为）。
 */
export function describePanelFailures(failures: PanelGenFailure[], total: number): string {
  const idxs = failures.map(f => `第${f.panelIndex + 1}格`);
  const shown = idxs.slice(0, 8).join('、');
  const more = idxs.length > 8 ? ` 等 ${idxs.length} 格` : '';
  const firstReason = failures[0]?.reason ? `（首个原因：${failures[0].reason}）` : '';
  const ok = total - failures.length;
  return ok > 0
    ? `${ok}/${total} 格已生成并保留；失败 ${shown}${more}${firstReason}。可只重试失败的格，不必重画整批。`
    : `${total} 格全部失败${firstReason}。`;
}

/**
 * 批量为分镜出图。
 *
 * 2026-10-15 行为变更（并发 + 失败隔离）：
 *  - 原来是 `for...of` **完全串行**，每格最坏 3 轮 × 5 次模型调用，
 *    6 格整页最坏 ~96 次外部调用、最坏 72 分钟，而前端 10 分钟就超时 ——
 *    用户看到失败，后端还在继续烧钱。
 *  - 现在走有界并发（默认 3），且**单格失败不再中断整批**：
 *    成功的格照常回写 imageUrl，失败的格进 `failures`。
 *  - 全部格都失败才抛错（一无所获时才值得硬失败）。
 */
export async function generatePanelImages(
  series: Series,
  sceneDescription: string,
  panels: Panel[],
  logCtx: string,
  dnaKey: DnaKey,
  options: GeneratePanelImagesOptions = {},
): Promise<PanelGenResult> {
  // 世界观是分镜出图的硬前置 —— 画风 artStyle / paletteMood 由世界观提供。
  // 调用方（生成/重生成/续写整页）已确保 worldview 存在；这里再兜底一次以防路由层后续改动遗漏。
  if (!series.worldview) {
    throw new Error('请先生成世界观，再出图');
  }
  // 2026-09-07 引擎层 P1：分镜出图前必填校验。
  // 旧数据里 boy_up 这种"角色缺 gender/ageBand/outfit/visualAnchors"的状态下，
  // 生图 prompt 拿不到事实依据，必然漂移。这里直接抛错，让用户在 UI 上补字段。
  const charMap = new Map(series.characters.map(c => [c.id, c]));
  const sorted = [...panels].sort((a, b) => a.index - b.index);
  // 构造一个临时 page 用于 validatePage（避免破坏函数签名）
  const tempPage: SeriesPage = {
    id: 'tmp', pageNumber: 0, title: '', sceneDescription, panels: sorted, characterIds: [], status: 'draft',
  };
  const pageV = validatePage(tempPage, charMap);
  if (!pageV.ok) {
    if (pageV.repairable) {
      // 2026-09-18：repairable 现在包含两类：
      //   - 「一次性配角缺性别标签」 → repairExtraCharacterGenders
      //   - 「description 太短」       → repairShortDescriptions
      // 两类独立修复，串行跑（先短文补全、再性别标签），任意一步降级为 warning 继续。
      let descRepaired = false;
      try {
        descRepaired = await repairShortDescriptions(sorted, sceneDescription, dnaKey);
      } catch (e: any) {
        console.warn(`[generatePanelImages] description 补全调用失败（降级继续）：${e?.message || e}`);
      }

      try {
        const repaired = await repairExtraCharacterGenders(sorted, sceneDescription, dnaKey);
        if (repaired || descRepaired) {
          const reV = validatePage(tempPage, charMap);
          if (reV.ok) {
            console.log('[generatePanelImages] 分镜校验问题已自动修复，继续生成');
          } else {
            console.warn(`[generatePanelImages] 自动修复后仍有残余问题（降级继续）：${reV.errors.join('；')}`);
          }
        } else {
          console.warn('[generatePanelImages] 无可修复项（降级继续）');
        }
      } catch (e: any) {
        console.warn(`[generatePanelImages] 性别标签自动修复调用失败（降级继续）：${e?.message || e}`);
      }
    } else {
      // 含 fatal 错误（角色必填字段缺失 / characterId 不存在）→ 必须人工处理
      // 2026-09-18：description 太短 已不再属于 fatal；只有真正的角色数据不全才会抛错。
      throw new Error(`分镜校验失败：${pageV.errors.join('；')}`);
    }
  }
  const config = getConfig().image;
  const imageProvider = getImageProvider(config);
  const style = series.worldview.artStyle;
  const mood = series.worldview.paletteMood;

  // 2026-10-15：串行 for → 有界并发池。
  // 每格的逻辑完全自包含（只读 series / config / provider，产物写各自的落盘路径），
  // 唯一共享的是 appendPanelAudit —— 它用 appendFileSync，同步调用，
  // 在 Node 单线程下天然原子，并发写 jsonl 不会串行交错。
  const { values, failures } = await mapConcurrent(
    sorted,
    (panel) => generateOnePanelImage({
      series, sceneDescription, panel, logCtx, dnaKey, config, imageProvider, style, mood,
    }),
    {
      limit: options.concurrency ?? DEFAULT_PANEL_CONCURRENCY,
      onSettled: options.onProgress,
    },
  );

  const paths: Array<string | null> = values.map(v => v ?? null);
  const panelFailures: PanelGenFailure[] = failures.map(f => ({
    panelIndex: sorted[f.index]?.index ?? f.index,
    reason: f.error instanceof Error ? f.error.message : String(f.error),
  }));

  // 全灭才算硬失败：一无所获时抛错，让页面红条明确提示。
  // 部分失败绝不抛 —— 成功的图必须写回，否则用户白花钱。
  if (panelFailures.length > 0 && panelFailures.length === sorted.length) {
    throw new Error(
      `本批 ${sorted.length} 格全部出图失败：${panelFailures.map(f => `第${f.panelIndex + 1}格 ${f.reason}`).join('；')}`,
    );
  }
  if (panelFailures.length > 0) {
    console.warn(
      `[generatePanelImages] ${logCtx}：${sorted.length - panelFailures.length}/${sorted.length} 格成功，` +
      `失败 ${panelFailures.map(f => `第${f.panelIndex + 1}格`).join('、')}（已保留成功图）`,
    );
  }
  return { paths, failures: panelFailures };
}

/** 单格出图所需的外部依赖（每格共享，提前取好避免在并发体内反复构造）。 */
interface GenerateOnePanelArgs {
  series: Series;
  sceneDescription: string;
  panel: Panel;
  logCtx: string;
  dnaKey: DnaKey;
  config: ReturnType<typeof getConfig>['image'];
  imageProvider: ReturnType<typeof getImageProvider>;
  style: string;
  mood: string;
}

/**
 * 单格出图（含 limb-guard / gender-audit / 8 维评审 / 图文对齐四道闸门与重试闭环）。
 * 返回落盘后的 web 路径；彻底失败才抛。
 */
async function generateOnePanelImage(args: GenerateOnePanelArgs): Promise<string> {
  const { series, sceneDescription, panel, logCtx, dnaKey, config, imageProvider, style, mood } = args;
  const { refImages, charDescLines, boundCharNames, anchorText } = collectPanelCharacterRefs(series, panel);
  const styleRefs = getStyleRefs(dnaKey);
  const prompt = buildPanelImagePrompt({
    style,
    mood,
    sceneDescription,
    description: panel.description,
    charDescLines,
    boundCharNames,
    anchorText,
    extraCharacters: panel.extraCharacters,
  }) + styleRefs.note;
  const allRefs = [...refImages, ...styleRefs.images];
  // 2026-09-10：finalReq 改为 let，重试时按 attempt 重建（见下方重试循环）——
  // 不再让三次尝试复用同一个不可变请求。此处先建首轮请求，用于长度预警。
  let finalReq = withDnaImagePrompt({
    prompt,
    referenceImages: allRefs.length > 0 ? allRefs : undefined,
    aspectRatio: '3:4',
  }, { dnaKey, purpose: 'panel' });
  // 上一轮不达标原因转成的修正指令；'' = 首轮无修正（见 buildPanelCorrectionText）
  let correctionText = '';
  // 2026-09-01 微调：>8000 时打印 head/tail 早预警（截断诊断在 dna-inject.ts 统一处理）
  if (finalReq.prompt.length > 8000) {
    console.warn(
      `[series-routes] 分镜 ${logCtx} prompt ${finalReq.prompt.length} 接近上限\n` +
      `  head(150): ${JSON.stringify(finalReq.prompt.slice(0, 150))}`,
    );
  }

  // 主角性别（用于 gender-audit 校验）。主角 = characterIds[0]，
  // 若没设 characterIds 则跳过 gender 校验。
  const protagonistId = panel.characterIds[0];
  const protagonist = protagonistId ? series.characters.find(c => c.id === protagonistId) : null;
  const expectedGender: 'female' | 'male' | 'ambiguous' | null =
    protagonist?.gender === 'female' || protagonist?.gender === 'male' || protagonist?.gender === 'ambiguous'
      ? protagonist.gender
      : null;

  // 2026-09-07 引擎层 P4：自动重生成闭环。
  // 首张出图后跑 limb-guard + gender-audit；
  // 任一不达标 → 重生成（最多 2 次），全部失败 → 用最后一次。
  // 每次都写一条审计记录（含 attempt / 不达标原因）。
  const MAX_TOTAL_ATTEMPTS = 3; // 1 次首试 + 最多 2 次重试
  let finalImage: string | null = null;
  let limbGuardResult: { abnormal: boolean; reason: string; confidence: number } | null = null;
  let genderResult: { mismatch: boolean; expected: string; observed: string[]; reason: string; confidence: number } | null = null;
  // 2026-09-07 漫画审核大师：8 维评审结果（提升到循环外 —— 审计落盘在循环后引用）
  let reviewResult: PanelAuditRecord['review'] = null;
  // 2026-09-11 图文对齐门禁：每格先抽一次"可核验要素清单"（文本调用，一次即可），
  // 各 attempt 出图后逐项核对 —— 把"description 没画出来"变成可修正的重画信号。
  let alignmentItems: string[] | null = null;
  let alignmentResult: AlignmentAudit | null = null;
  try {
    const extracted = await extractAlignmentItems(panel.description, sceneDescription);
    if (extracted && extracted.items.length > 0) alignmentItems = extracted.items;
  } catch (e: any) {
    console.warn(`[generatePanelImages] 对齐要素抽取失败（跳过本格门禁）：${e?.message || e}`);
  }
  let regenReason = 'ok';
  let finalAttempt = 1; // 真实尝试次数（不能用 regenReason 正则解析 —— review(59) 里的 59 是评分不是次数）
  const t0 = Date.now();

  for (let attempt = 1; attempt <= MAX_TOTAL_ATTEMPTS; attempt++) {
    // 2026-09-10：重试时把上一轮的具体问题注入 prompt —— 让重试成为"针对性修正"。
    // 首轮 correctionText 为空，直接复用上面建好的 finalReq。
    if (correctionText) {
      finalReq = withDnaImagePrompt({
        prompt: `${prompt}${correctionText}`,
        referenceImages: allRefs.length > 0 ? allRefs : undefined,
        aspectRatio: '3:4',
      }, { dnaKey, purpose: 'panel' });
      console.warn(`[generatePanelImages] 第 ${attempt} 次尝试已注入修正指令（prompt ${finalReq.prompt.length} 字符）`);
    }
    try {
      const img = await imageProvider.generateImage(config, finalReq);
      // limb-guard（多胳膊 / 多手指）走局部 inpaint 修复
      let candidate = img.image;
      let localLimbAudit: { abnormal: boolean; reason: string; confidence: number } | null = null;
      try {
        const inpaintPrompt = buildPanelImagePrompt({
          style,
          mood,
          sceneDescription,
          description: panel.description,
          charDescLines,
          boundCharNames,
          anchorText,
          extraCharacters: panel.extraCharacters,
        });
        const guardResult = await guardedImage(img.image, inpaintPrompt, dnaKey);
        candidate = guardResult.image;
        localLimbAudit = guardResult.audit;
      } catch (e: any) {
        console.warn(`[generatePanelImages] limb-guard 流程异常，使用原图：${e?.message || e}`);
      }
      // 更新本次尝试的 limb-guard 结果（用于审计 + 是否重试）
      limbGuardResult = localLimbAudit;
      // gender-audit（仅在有 expectedGender 时跑）—— 不做 inpaint，仅判断
      if (expectedGender) {
        const ga = await checkGenderConsistency(candidate, expectedGender);
        if (ga) {
          genderResult = {
            mismatch: ga.mismatch,
            expected: ga.expectedGender,
            observed: ga.observedGenders,
            reason: ga.reason,
            confidence: ga.confidence,
          };
        }
      }
      // 2026-09-07 漫画审核大师 P5：8 维评审（核心 —— 真审）
      // 调用 vision provider 当主编，按 8 维评分；
      // 总分 < REGENERATE_THRESHOLD(70) → 算不达标，需要重画。
      // reviewResult 声明在循环外（审计落盘在循环后引用）。
      const characterSummaries = (panel.characterIds || [])
        .slice(0, 6)
        .map(cid => {
          const c = series.characters.find(x => x.id === cid);
          if (!c) return '';
          // 简短的角色摘要：名字 + 性别 + 装束
          return `${c.name}（${c.gender}，${c.ageBand}）：${(c.outfit || '').slice(0, 30)}`;
        })
        .filter(Boolean);
      const refImagesForReview = (panel.characterIds || [])
        .slice(0, 4)
        .map(cid => {
          const c = series.characters.find(x => x.id === cid);
          if (!c) return null;
          // 2026-09-08 修复：referenceImages/referenceImage 存的是 web 路径（/data/images/xx.png），
          // 必须经 resolveImageData 转成 dataURL —— 直接塞路径会让网关尝试加载相对 URL 而报 500。
          const raw = c.referenceImages?.[0] ?? c.referenceImage ?? null;
          return raw ? resolveImageData(raw) : null;
        })
        .filter((s): s is string => !!s);
      const worldviewStr = `${style} · ${mood}`;
      const review = await reviewPanel(candidate, {
        sceneDescription: sceneDescription.slice(0, 400),
        panelDescription: (panel.description || '').slice(0, 400),
        characterSummaries,
        referenceImages: refImagesForReview,
        worldview: worldviewStr,
      });
      if (review) {
        reviewResult = {
          overall: review.overall,
          dimensions: review.dimensions,
          topIssue: review.topIssue,
          verdict: review.verdict,
          confidence: review.confidence,
        };
      }
      // 2026-09-11 图文对齐门禁：出图后逐项核对 description 里的可核验要素。
      // 缺失 → 触发重画（与 review/limb/gender 并列的第 4 道闸）。
      if (alignmentItems && alignmentItems.length > 0) {
        const va = await verifyAlignment(candidate, alignmentItems);
        if (va) {
          alignmentResult = va;
          if (!va.ok) {
            console.warn(`[generatePanelImages] 图文对齐不达标：${va.reason}`);
          }
        }
      }
      // 判定本轮是否通过
      const limbOk = !limbGuardResult || !limbGuardResult.abnormal;
      const genderOk = !genderResult || !genderResult.mismatch;
      // review 的判定：null（未启用/失败）→ 视作通过；否则看 overall
      const reviewOk = reviewResult == null || reviewResult.overall >= REGENERATE_THRESHOLD;
      // alignment 的判定：items 空 / 核验失败 → 视作通过；否则必须 ok
      const alignmentOk = alignmentItems == null || alignmentItems.length === 0
        || alignmentResult == null
        || alignmentResult.ok;
      if (limbOk && genderOk && reviewOk && alignmentOk) {
        finalImage = candidate;
        finalAttempt = attempt;
        if (attempt > 1) regenReason = `第 ${attempt} 次达标`;
        break;
      }
      // 本轮不达标：记录原因，准备重试
      const reasons: string[] = [];
      if (!limbOk) reasons.push(`limb: ${limbGuardResult?.reason || 'abnormal'}`);
      if (!genderOk) reasons.push(`gender: ${genderResult?.reason || 'mismatch'}`);
      const reviewIssueText = (!reviewOk && reviewResult)
        ? (reviewResult.topIssue || summarizeFailure({ ...reviewResult, dimensions: reviewResult.dimensions as any, verdict: reviewResult.verdict } as any))
        : '';
      if (reviewIssueText && reviewResult) reasons.push(`review(${reviewResult.overall}): ${reviewIssueText}`);
      // 对齐缺失信息量最高：缺的道具/人数/动作直接告诉模型，重画才有的放矢。
      if (!alignmentOk && alignmentResult && alignmentResult.missing.length > 0) {
        reasons.push(`alignment: ${alignmentResult.reason}`);
      }
      regenReason = reasons.join('；');
      console.warn(`[generatePanelImages] 第 ${attempt} 次不达标：${regenReason}`);
      // 2026-09-10：把本轮不达标原因转成下一轮的修正指令 —— 重试不再是重掷骰子。
      // 仅当后面还有尝试时才生成（最后一轮之后 correctionText 已无意义）。
      if (attempt < MAX_TOTAL_ATTEMPTS) {
        correctionText = buildPanelCorrectionText({
          reviewIssue: reviewIssueText || undefined,
          limbReason: !limbOk ? (limbGuardResult?.reason || '肢体结构异常') : undefined,
          genderReason: !genderOk ? (genderResult?.reason || '性别与设定不符') : undefined,
          alignmentReason: (!alignmentOk && alignmentResult && alignmentResult.missing.length > 0)
            ? `上一版漏画了这些要素，本版必须全部画出：${alignmentResult.missing.join('；')}`
            : undefined,
        });
      }
      if (attempt === MAX_TOTAL_ATTEMPTS) {
        // 用最后一次结果兜底，不阻塞流程
        finalImage = candidate;
        finalAttempt = attempt;
      }
    } catch (e: any) {
      console.warn(`[generatePanelImages] 第 ${attempt} 次生成失败：${e?.message || e}`);
      if (attempt === MAX_TOTAL_ATTEMPTS) {
        // 用上次的结果或 null
        finalImage = finalImage ?? null;
        regenReason = `生成失败：${e?.message || e}`;
      }
    }
  }

  if (!finalImage) {
    throw new Error(`分镜 ${panel.index} 三次尝试均失败`);
  }

  // 审计记录（2026-09-07 反馈层 P2）
  const finalPath = saveDataUrlImage(finalImage);
  const pageInfo = findPageContext(series, panel);
  appendPanelAudit({
    ts: new Date().toISOString(),
    seriesId: series.id,
    seriesTitle: series.title,
    pageNumber: pageInfo.pageNumber,
    panelIndex: panel.index,
    chapterTitle: pageInfo.chapterTitle,
    action: logCtx.includes('panel-rewrite') ? 'panel-rewrite' : logCtx.includes('regenerate') ? 'regenerate' : 'generate',
    dnaKey,
    promptLen: finalReq.prompt.length,
    refCount: refImages.length,
    styleRefCount: styleRefs.images.length,
    limbGuard: limbGuardResult,
    genderAudit: genderResult,
    review: reviewResult,
    alignmentAudit: alignmentResult
      ? {
        ok: alignmentResult.ok,
        items: alignmentItems ?? [],
        missing: alignmentResult.missing,
        reason: alignmentResult.reason,
        confidence: alignmentResult.confidence,
      }
      : null,
    attempt: finalImage === null ? 0 : finalAttempt,
    totalAttempts: MAX_TOTAL_ATTEMPTS,
    regenReason,
    finalImageHash: hashImageDataUrl(finalImage),
    costMs: Date.now() - t0,
  });
  return finalPath;
}

/** 辅助：根据 panel 找到它所属的 chapter / page 信息（用于审计日志）。 */
function findPageContext(series: Series, panel: Panel): { pageNumber: number; chapterTitle: string } {
  for (const ch of iterAllChapters(series)) {
    for (const p of ch.pages) {
      if (p.panels.some(pn => pn.index === panel.index && pn === panel)) {
        return { pageNumber: p.pageNumber, chapterTitle: ch.title };
      }
    }
  }
  return { pageNumber: 0, chapterTitle: '' };
}
