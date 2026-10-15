/**
 * 角色与分镜的契约校验 —— 根治"字段缺失导致生图漂移"的根因。
 *
 * 设计原则（2026-09-07 三层架构 · 契约层）：
 *  - 这些字段缺失不会直接抛错（保留向后兼容），而是返回错误清单
 *    让调用方决定「硬拒」还是「标记 legacy」。
 *  - 凡是「带参考图的角色」「参与 panel 出图的角色」必须通过硬校验，
 *    否则图片模型对自由文本外貌的遵循度太低，必然出现 P3 林屿变女性这类问题。
 *  - legacy 标记：旧数据启动扫描时被标 legacy，但不阻塞已有图访问；
 *    用户在 UI 顶部红条里点"补全字段"才会触发硬校验。
 */
import type { SeriesCharacter, Panel, SeriesPage } from '../../shared/types.js';

/** 校验结果：errors 为空表示通过；否则列出每个字段的失败原因。 */
export interface ValidationResult {
  ok: boolean;
  errors: string[];
  /** 标记为 legacy（字段缺失但不影响功能，仅用于 UI 提示）。 */
  legacy?: boolean;
  /**
   * 2026-09-08：所有错误是否都属于「可自动修复」类
   * （当前仅：一次性配角 appearance 缺性别标签 —— LLM 可推断补全）。
   * 为 true 时调用方应先尝试自动修复再决定是否拒绝，而不是直接卡死用户。
   */
  repairable?: boolean;
}

/**
 * 角色必填字段校验。创建 / 编辑角色时硬拒；启动扫描时只记 legacy。
 *
 * 必填：
 *  - gender: 决定生图模型怎么画脸（林屿变女性就是这个根因）
 *  - ageBand: 决定模型画老人还是小孩
 *  - outfit: 防止几十页后服装漂移（服装单一事实源）
 *  - visualAnchors ≥ 2: 几十页后"还是不是这张脸"的高辨识度特征
 *
 * 不硬拒：
 *  - description / appearance 必填（已有校验）
 *  - referenceImages：允许空（用户可后补生成）
 */
export function validateCharacter(c: Partial<SeriesCharacter> & { name: string }): ValidationResult {
  const errors: string[] = [];
  if (!c.gender) errors.push('gender 必填（female/male/ambiguous/nonbinary）');
  if (!c.ageBand) errors.push('ageBand 必填（child/teen/young_adult/middle_aged/elderly）');
  if (!c.outfit || c.outfit.trim().length < 4) errors.push('outfit 必填且 ≥ 4 字（服装唯一事实源，禁止演变句）');
  const anchors = c.visualAnchors ?? [];
  if (anchors.length < 2) errors.push(`visualAnchors 至少 2 条（当前 ${anchors.length}）`);
  return { ok: errors.length === 0, errors };
}

/**
 * 软校验：只标记 legacy，不阻塞。供启动扫描使用。
 */
export function auditCharacter(c: SeriesCharacter): 'ok' | 'legacy' {
  return validateCharacter(c).ok ? 'ok' : 'legacy';
}

/**
 * 分镜必填校验。生成图片前调用 —— 字段缺失就拒绝出图。
 *
 * 必填：
 *  - description ≥ 60 字（避免"一句话概览"导致生图信息密度太低）
 *  - 出场角色（characterIds + extraCharacters）必须都有"性别标签"
 *    文字描述（避免模型自动假设性别）
 *
 * 2026-09-18：`description 太短` 从 fatal 降为 repairable —— 调用方
 * （generatePanelImages）应先尝试 LLM 自动补全 description 到 ≥ 60 字，
 * 补全后再 validate；只有补全也失败时才抛错。这样 LLM 偶尔写 50-58 字
 * 不会卡死整页生成。
 */
export function validatePanel(p: Panel, characterMap: Map<string, SeriesCharacter>): ValidationResult {
  const errors: string[] = [];
  const repairableErrors: string[] = [];
  const fatalErrors: string[] = [];
  const desc = (p.description || '').trim();
  if (desc.length < 60) {
    repairableErrors.push(`description 太短 ${desc.length}/60 字（信息密度太低会让画面失焦）`);
  }
  // 校验出场角色都有结构化字段
  for (const cid of p.characterIds || []) {
    const c = characterMap.get(cid);
    if (!c) {
      fatalErrors.push(`characterId ${cid} 在角色库中不存在`);
      continue;
    }
    const cv = validateCharacter(c);
    if (!cv.ok) {
      fatalErrors.push(`出场角色 ${c.name} 字段不全：${cv.errors.join('；')}`);
    }
  }
  // 校验 extraCharacters 描述里含性别词（男/女/男生/女生/lad/woman/man 等）
  // 注意：宽松检查 —— 出现任一性别相关词即通过，避免误判"中性角色"。
  // 2026-09-08：这类错误标记为「可自动修复」（LLM 可从上下文推断性别补全），
  // 不再直接卡死整页生成。
  const genderHints = ['男', '女', '先生', '女士', '小伙', '姑娘', 'man', 'woman', 'male', 'female', '他', '她', 'boy', 'girl', 'lady', 'gentleman'];
  for (const ec of p.extraCharacters || []) {
    const ap = (ec.appearance || '').toLowerCase();
    if (!genderHints.some(h => ap.includes(h.toLowerCase()))) {
      repairableErrors.push(`一次性配角 ${ec.name} 的 appearance 必须含性别标签（例：中年女/年轻小伙）`);
    }
  }
  errors.push(...fatalErrors, ...repairableErrors);
  return {
    ok: errors.length === 0,
    errors,
    // 只有当全部错误都是可修复类时才标 repairable；混入 fatal 则必须人工处理
    repairable: fatalErrors.length === 0 && repairableErrors.length > 0,
  };
}

/**
 * 一页整体校验 —— generate 入口用。
 * 单页只要有任一格失败，整页拒绝出图（避免半成品入库）。
 */
export function validatePage(page: SeriesPage, characterMap: Map<string, SeriesCharacter>): ValidationResult {
  const errors: string[] = [];
  let allRepairable = true;
  let hasError = false;
  if (page.panels.length === 0) {
    return { ok: false, errors: ['页面无分镜，请先 breakdown'] };
  }
  page.panels.forEach((pn, i) => {
    const r = validatePanel(pn, characterMap);
    if (!r.ok) {
      hasError = true;
      errors.push(`第 ${i + 1} 格：${r.errors.join('；')}`);
      if (!r.repairable) allRepairable = false;
    }
  });
  return { ok: !hasError, errors, repairable: hasError && allRepairable };
}

/**
 * 整本 series 扫描：统计 legacy 角色，给 UI 顶部红条用。
 */
export function scanLegacyCharacters(series: { characters: SeriesCharacter[]; title: string; id: string }): SeriesCharacter[] {
  return series.characters.filter(c => auditCharacter(c) === 'legacy');
}