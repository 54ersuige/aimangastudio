import { Router } from 'express';
import { z } from 'zod';
import { getConfig } from '../config.js';
import { sendError, logGeneration } from '../utils.js';
import { withDnaImagePrompt } from '../dna-inject.js';
import { runTask, DuplicateTaskError } from '../task-queue.js';
import { saveDataUrlImage } from '../image-store.js';
import { getSeries, updateSeries, addCharacter, updateCharacter, removeCharacter } from '../series-store.js';
import type { SeriesCharacter } from '../series-store.js';
import { seriesDnaKey, callStructuredJson, CharacterListZ, getImageProvider } from './helpers.js';
import { generateCharacterReferenceSet, CHARACTER_REFERENCE_SHOTS, buildCharacterImagePrompt, getStyleRefs } from './prompts.js';
import { guardedImage } from '../limb-guard.js';
import { validateCharacter } from '../series-store/validate.js';

const router = Router();

// ========== Step 2: 角色 ==========

const CharacterSchema = {
  type: 'object',
  properties: {
    characters: {
      type: 'array',
      minItems: 1,
      maxItems: 6,
      items: {
        type: 'object',
        // 「角色圣经」—— 按形象可复现最佳实践拆分的字段。AI 必须按以下维度组织。
        // 短摘要字段（description/appearance/roleInStory）必须是结构化的"列表式"或"分号分隔"，便于卡片展示。
        // 视觉锚点（visualAnchors）3-6 条，是单页分镜 prompt 必带入的元素。
        properties: {
          name: { type: 'string' },
          role: { type: 'string', enum: ['protagonist', 'antagonist', 'supporting'] },
          /** 故事内定位（1 句话：此人在剧情里扮演什么角色）。 */
          roleInStory: { type: 'string' },
          /** 性别枚举（2026-09-01 新增）—— 必须在 appearance 里写出对应的可辨识性征。 */
          gender: { type: 'string', enum: ['female', 'male', 'ambiguous', 'nonbinary'] },
          /** 年龄段枚举（2026-09-01 新增）—— 必须在 appearance 里写出对应的体型与面部特征。 */
          ageBand: { type: 'string', enum: ['child', 'teen', 'young_adult', 'middle_aged', 'elderly'] },
          /**
           * 外貌里"性别可辨识外部特征"的简短描述（2026-09-01 新增）。
           * 例：female → "柔和下颌线、小巧耳垂、明显的锁骨弧线、无喉结、细眉";
           *      male   → "偏硬的下颌线、可见喉结、稍宽的肩颈";
           *      child  → "圆润脸庞、额头占面部比例偏大、身高约 130 cm";
           *      elderly → "法令纹与眼角纹明显、灰白发丝、姿态略前倾"；
           * 这一段会被原样注入生图 prompt 的「硬性要求」段，避免模型把
           * "20 出头、齐耳短发、瘦小"的女生画成"少年感中性脸"。
           */
          sexTraits: { type: 'string' },
          /** 综合简介（2-3 句话：性格核心 + 处境）。 */
          description: { type: 'string' },
          /** 综合外貌（按"体型 → 发型 → 脸 → 眼睛"顺序写，3-5 句话；只写不可变特征，禁止写服装及其演变）。 */
          appearance: { type: 'string' },
          age: { type: 'string' },
          height: { type: 'string' },
          build: { type: 'string' },
          hair: { type: 'string' },
          eyes: { type: 'string' },
          /** 标志服装 ——【唯一事实源】只能写一套确定装束；禁止"去某处换成XX/逐渐变成XX/分场合切换"等可变描述。 */
          outfit: { type: 'string' },
          signature: { type: 'string' },
          personality: { type: 'string' },
          occupation: { type: 'string' },
          backstory: { type: 'string' },
          motivation: { type: 'string' },
          goal: { type: 'string' },
          arc: { type: 'string' },
          internalConflict: { type: 'string' },
          externalConflict: { type: 'string' },
          voice: { type: 'string' },
          catchphrase: { type: 'string' },
          visualAnchors: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 6 },
        },
        required: ['name', 'role', 'description', 'appearance', 'visualAnchors', 'gender', 'ageBand', 'sexTraits'],
      },
    },
  },
  required: ['characters'],
} as const;

router.post('/series/:id/characters/generate', async (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  if (!series.worldview) return sendError(res, 400, '请先生成世界观');
  const dnaKey = seriesDnaKey(series);
  const worldview = series.worldview; // 闭包内使用，收窄类型
  const bodySchema = z.object({ hint: z.string().max(2000).optional() });
  const body = bodySchema.safeParse(req.body || {});
  const hint = body.success ? body.data.hint?.trim() : undefined;

  // 每个角色要出参考图，整体耗时数分钟 —— 走后台任务
  let taskId: string;
  try {
    taskId = runTask(`series:${series.id}:characters`, 'characters-generate', async () => {
      try {
        const prevBlock = series.characters.filter(c => c.source !== 'manual').length > 0
          ? `\n\n上一版角色（用户要求在其基础上修改，同名角色尽量保持人设连续性）：\n${series.characters.map(c => `- ${c.name}（${c.role}）：${c.description} / 外貌：${c.appearance}`).join('\n')}\n`
          : '';
        const hintBlock = hint
          ? `\n\n用户对上一版的修改意见（本次生成必须逐条体现）：${hint}\n`
          : '';
        // —— 蓝图优先（避免数量漂移）；缺字段时按 background+plotOutline 推断 ——
        const blueprints = worldview.characterBlueprints ?? [];
        const plotOutline = worldview.plotOutline ?? worldview.background;
        const conflicts = worldview.conflicts ?? [];
        const locations = worldview.locations ?? [];
        const blueprintBlock = blueprints.length > 0
          ? `\n\n【世界观已锁定角色蓝图 —— 严格按此清单生成，数量与定位都不能改】\n${blueprints.map((b, i) => `  ${i + 1}. ${b.name}（${b.role}）—— ${b.roleInStory}；动机：${b.motivation}`).join('\n')}\n请把每个蓝图展开为完整角色（含 description / appearance / voiceTone），name 与 role 与蓝图保持一致；不要新增或删除角色。`
          : `\n\n【无角色蓝图 —— 按以下剧情/矛盾推断角色清单（2-4 个，必含反派时再含反派）】`;
        const conflictsBlock = conflicts.length > 0 ? `\n核心矛盾：${conflicts.join('；')}` : '';
        const locationsBlock = locations.length > 0 ? `\n关键场景：${locations.join('；')}` : '';
        const CHARACTER_BIBLE_GUIDE = `\n\n【角色圣经生成指引 —— 必须按以下结构填充每个字段；这是「几十页后角色依然可辨认」的关键】

  基础身份：name / role(protagonist|antagonist|supporting) / roleInStory / occupation / age
  形象（appearance 是综合描述，必须按「体型→发型→脸→眼睛」顺序写 3-5 句话，**不写服装**；以下拆分字段如能填满尽量填满）：
    appearance  —— 综合外貌（用于生图主提示词；只描述不可变特征：体型/发型/脸/眼睛，禁止写服装及其演变）
    age          —— 年龄段
    height / build —— 身高 + 体型
    hair         —— 发型/发色
    eyes         —— 眼睛
    outfit       —— 标志服装 ·【唯一事实源】只能写「一套确定装束」（如"深灰西服+白衬衫+深蓝领带"）。
                    禁止写两套以上、禁止写"去某处时换成XX""随着剧情逐渐变成XX""下班时松开XX"这类
                    分场合/可变的服装描述 —— 服装在整部作品里必须全程一致，唯一换装由分镜剧情明确驱动。
    signature    —— 习惯性动作 / 随身物
  性别与年龄段（2026-09-01 新增 —— 解决"女生被画成男生"问题）：
    gender       —— 枚举 female / male / ambiguous / nonbinary。绝对禁止省略或写"未知"。
    ageBand      —— 枚举 child(<13) / teen(13-19) / young_adult(20-34) / middle_aged(35-54) / elderly(≥55)。
                   根据 occupation / 故事设定自主判断；不准写 narrative / unknown。
    sexTraits    —— 4-12 字的"性别/年龄段可辨识外部特征"短句，会原样注入生图 prompt。
      → female：柔和下颌线、小巧耳垂、明显锁骨弧线、无喉结、细眉、修长脖颈（任选 3-5 个）
      → male  ：偏硬的下颌线、可见或隐隐的喉结、稍宽肩颈（任选 3-5 个）
      → child / elderly：参照对应年龄段体质特征，如"圆润脸庞、额头比例偏大"或"法令纹、灰白发丝"
      → ambiguous / nonbinary：写明"刻意中性化/模糊性别化处理"，让模型有意走雌雄莫辨分布
    严禁出现中性面孔或"少年感"逃避 —— 这是导致画面"看不出男女"的根因，必须正面表达。
  性格与背景：
    personality  —— 性格核心（2-3 句）
    backstory    —— 关键经历（1 段）
  故事弧：
    motivation   —— 核心动机（"为什么"）
    goal         —— 表层目标（"做什么"）
    arc          —— 弧光：从起点状态 → 终点状态
    internalConflict / externalConflict —— 内外冲突
  台词声音：
    voice        —— 说话风格（短句节奏、词汇偏好）
    catchphrase  —— 口头禅
  视觉锚点（visualAnchors —— 数组 3-6 条，每条 4-10 字）：
    —— 这些是「每一页分镜都会强制带入」的高辨识度特征。
    例如：黑色短发、左眼下痣、银色项链、左手小指缺一节、说话皱眉、右肩斜挎帆布包。
    必须是眼睛/画面能看到的物理特征，不能是性格/背景。`;

        const prompt = `基于以下漫画设定，生成角色。${blueprintBlock}${prevBlock}${hintBlock}\n世界观：\n时代：${worldview.era}\n背景：${worldview.background}\n风格：${worldview.artStyle}\n剧情大纲：${plotOutline}${conflictsBlock}${locationsBlock}\n\n故事简介：${series.logline}${CHARACTER_BIBLE_GUIDE}`;
        const result = await callStructuredJson<z.infer<typeof CharacterListZ>>(
          prompt,
          '你是一位漫画角色设计师。请输出严格的 JSON 格式。',
          CharacterSchema as Record<string, unknown>,
          {
            dnaKey,
            logKind: 'characters',
            logMeta: { seriesId: series.id, hint },
            validate: raw => CharacterListZ.parse(raw),
          },
        );

        // P2-13：同名 AI 角色复用原 ID，维持既有分镜引用
        const oldAi = series.characters.filter(c => c.source !== 'manual');
        const idByName = new Map(oldAi.map(c => [c.name, c.id]));
        const generated: SeriesCharacter[] = [];
        // 全部角色一次性并发生成 2 张参考图（每角色 2 张，共 2*N 次 API 调用 → 并发执行）
        // v3：只生成 sheet 一张参考图（每个角色内部独立，角色间可并发）
        // 但角色之间仍并行 —— 节约 wall-clock 时间到 ~1 张图的耗时。
        const setResults = await Promise.all(
          result.characters.map(c => generateCharacterReferenceSet(c, worldview, dnaKey)),
        );
        for (let i = 0; i < result.characters.length; i++) {
          const c = result.characters[i];
          const set = setResults[i];
          // 图片生成失败（如 Agnes 队列拥堵）时保留同 ID 旧角色的参考图，
          // 避免把已有的参考图静默清空 —— 这是"重新生成后卡片看起来没变化/丢图"的根因之一。
          const oldChar = oldAi.find(o => o.id === idByName.get(c.name));
          const fallbackRefs = oldChar?.referenceImages ?? [];
          // v3：只有 sheet 一张，referenceImages 直接是单元素
          const orderedRefs: string[] = typeof set.sheet === 'string'
            ? [set.sheet]
            : fallbackRefs;
          // 主参考图：sheet 即唯一参考图
          const mainRef = set.sheet || orderedRefs[0] || '';
          generated.push({
            id: idByName.get(c.name) || crypto.randomUUID(),
            name: c.name,
            role: c.role,
            roleInStory: c.roleInStory || '',
            // 2026-09-01 新增：把 AI 推断的性别/年龄段落库；如果用户已经在
            // 上一轮手动修改过（旧角色），优先保留旧值。
            gender: c.gender || oldChar?.gender,
            ageBand: c.ageBand || oldChar?.ageBand,
            // sexTraits 不入数据，只在本次生图 prompt 里用 —— 改 prompt 永远是
            // 用最新一次 AI 推断的最新版本（避免老数据污染）。
            description: c.description || '',
            appearance: c.appearance,
            age: c.age || '',
            build: c.build || '',
            hair: c.hair || '',
            eyes: c.eyes || '',
            outfit: c.outfit || '',
            signature: c.signature || '',
            personality: c.personality || '',
            occupation: c.occupation || '',
            backstory: c.backstory || '',
            motivation: c.motivation || '',
            goal: c.goal || '',
            arc: c.arc || '',
            internalConflict: c.internalConflict || '',
            externalConflict: c.externalConflict || '',
            voice: c.voice || '',
            catchphrase: c.catchphrase || '',
            visualAnchors: c.visualAnchors,
            referenceImage: mainRef,
            referenceImages: orderedRefs,
            source: 'ai',
          });
        }
        // P2-13：只替换 AI 角色，手工添加的角色保留
        const manual = series.characters.filter(c => c.source === 'manual');
        const merged = [...generated, ...manual];
        updateSeries(series.id, { characters: merged });
        // 参考图生成失败不能静默成功 —— 否则前端"看起来点了没反应"。
        // 先落盘文字部分，再抛错让任务标记为 error，前端能展示明确原因。
        const noImage = generated.filter(g => !g.referenceImages || g.referenceImages.length === 0);
        if (noImage.length > 0) {
          throw new Error(
            `角色文字已生成并保存，但 ${noImage.length} 位角色（${noImage.map(c => c.name).join('、')}）的参考图因图片服务繁忙未能生成，` +
            `可在角色卡上点击"重生成图"补齐。`,
          );
        }
        return { characters: merged };
      } catch (e: any) {
        throw new Error(e.message || 'Character generation failed');
      }
    });
  } catch (e: any) {
    if (e instanceof DuplicateTaskError) return sendError(res, 409, '角色正在生成中，请稍候');
    // 友好化：runTask 内层 LLM 调用可能抛 429 限流
    if (e.status === 429 || /429|rate.limit|too.many/i.test(e.message || '')) return sendError(res, 429, '上游模型接口限流，请稍后重试');
    return sendError(res, 500, e.message || 'Failed to start task');
  }
  res.json({ taskId });
});

const AddCharacterSchema = z.object({
  name: z.string().min(1),
  role: z.enum(['protagonist', 'antagonist', 'supporting']),
  roleInStory: z.string().default(''),
  // 2026-09-01 新增：手工添加角色时也强制要求性别 / 年龄段，
  // 这是「图片里男女老少一目了然」的第一道闸门 —— 没填的也允许，
  // 但会在生图 prompt 上额外补一条「未指定，按 appearance 推断」的兜底。
  gender: z.enum(['female', 'male', 'ambiguous', 'nonbinary']).optional(),
  ageBand: z.enum(['child', 'teen', 'young_adult', 'middle_aged', 'elderly']).optional(),
  description: z.string().min(1),
  // 只写不可变特征（体型/发型/脸/眼睛），禁止写服装及其演变 —— 服装唯一来自 outfit 字段。
  appearance: z.string().min(1),
  age: z.string().default(''),
  height: z.string().default(''),
  build: z.string().default(''),
  hair: z.string().default(''),
  eyes: z.string().default(''),
  // 【服装唯一事实源】只能写一套确定装束；禁止"去某处换成XX/逐渐变成XX/分场合切换"等可变描述。
  outfit: z.string().default(''),
  signature: z.string().default(''),
  personality: z.string().default(''),
  occupation: z.string().default(''),
  backstory: z.string().default(''),
  motivation: z.string().default(''),
  goal: z.string().default(''),
  arc: z.string().default(''),
  internalConflict: z.string().default(''),
  externalConflict: z.string().default(''),
  voice: z.string().default(''),
  catchphrase: z.string().default(''),
  visualAnchors: z.array(z.string()).default([]),
  /** 兼容旧前端：仍可传 voiceTone，会自动合并到 voice 字段。 */
  voiceTone: z.string().optional(),
  autoGenerateImage: z.boolean().default(true),
});

router.post('/series/:id/characters', async (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  const dnaKey = seriesDnaKey(series);
  const parsed = AddCharacterSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, parsed.error.message);
  const input = parsed.data;
  let referenceImage: string | undefined;
  let referenceImages: string[] = [];
  if (input.autoGenerateImage) {
    // 手动添加角色时世界观可能尚未生成 —— 没有 worldview 时也照常生成（DNA 接管画风）
    try {
      const set = await generateCharacterReferenceSet(input, series.worldview, dnaKey);
      // v3：只有 sheet 一张（set.sheet 内部已走 limb-guard，这里无需再次处理）
      referenceImages = typeof set.sheet === 'string' ? [set.sheet] : [];
      referenceImage = set.sheet || referenceImages[0];
    } catch (e: any) {
      console.warn('Auto image generation failed:', e.message);
    }
  }
  // 兼容旧 voiceTone → 新 voice 字段
  const voice = input.voice || input.voiceTone || '';
  // 2026-09-07 契约层 P3：手工添加角色时硬校验必填字段。
  // 避免"建空壳角色 → 后续 panel 引用 → 生图漂移"的死循环。
  const v = validateCharacter({ ...input, name: input.name });
  if (!v.ok) return sendError(res, 400, `角色校验失败：${v.errors.join('；')}`);
  const character = addCharacter(series.id, {
    name: input.name,
    role: input.role,
    roleInStory: input.roleInStory,
    // 2026-09-01：手动添加也带上性别/年龄段，保证后续生图 prompt 立刻拥有性别标签。
    gender: input.gender,
    ageBand: input.ageBand,
    description: input.description,
    appearance: input.appearance,
    age: input.age,
    build: input.build,
    hair: input.hair,
    eyes: input.eyes,
    outfit: input.outfit,
    signature: input.signature,
    personality: input.personality,
    occupation: input.occupation,
    backstory: input.backstory,
    motivation: input.motivation,
    goal: input.goal,
    arc: input.arc,
    internalConflict: input.internalConflict,
    externalConflict: input.externalConflict,
    voice,
    catchphrase: input.catchphrase,
    visualAnchors: input.visualAnchors,
    referenceImage,
    referenceImages,
    source: 'manual', // P2-13：手工添加的角色在 AI 重生成时保留
  });
  res.json({ character });
});

router.patch('/series/:id/characters/:characterId', (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  const schema = z.object({
    name: z.string().optional(),
    role: z.enum(['protagonist', 'antagonist', 'supporting']).optional(),
    description: z.string().optional(),
    appearance: z.string().optional(),
    voiceTone: z.string().optional(),
    referenceImage: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, parsed.error.message);
  const updated = updateCharacter(series.id, req.params.characterId, parsed.data);
  if (!updated) return sendError(res, 404, 'Character not found');
  res.json({ character: updated });
});

router.delete('/series/:id/characters/:characterId', (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  const ok = removeCharacter(series.id, req.params.characterId);
  if (!ok) return sendError(res, 404, 'Character not found');
  res.json({ success: true });
});

// 手动编辑：保存角色元数据（名字/描述/特征/性格/视觉锚点/参考图）
const UpdateCharacterSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(['protagonist', 'antagonist', 'supporting']).optional(),
  archetype: z.string().optional(),
  description: z.string().optional(),
  // 只写不可变特征（体型/发型/脸/眼睛），禁止写服装及其演变 —— 服装唯一来自 outfit 字段。
  appearance: z.string().optional(),
  personality: z.string().optional(),
  motivation: z.string().optional(),
  visualAnchors: z.array(z.string()).optional(),
  // 【服装唯一事实源】只能写一套确定装束；禁止"去某处换成XX/逐渐变成XX/分场合切换"等可变描述。
  outfit: z.string().optional(),
  // 2026-09-01 新增：前端"性别 / 年龄段"手动选择时同步到这里。
  gender: z.enum(['female', 'male', 'ambiguous', 'nonbinary']).optional(),
  ageBand: z.enum(['child', 'teen', 'young_adult', 'middle_aged', 'elderly']).optional(),
  // 允许用户上传/粘贴一张或多张图片作为参考图（前端可上传本地图片，由前端转 data URL 后端保存为文件）
  referenceImage: z.string().optional(),
  referenceImages: z.array(z.string()).optional(),
});

router.patch('/series/:id/characters/:characterId', (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  const parsed = UpdateCharacterSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, parsed.error.message);
  // 2026-09-07 契约层 P3：PATCH 也校验 —— 合并 patch 与旧值，确保更新后仍通过校验。
  const existing = series.characters.find(c => c.id === req.params.characterId);
  if (!existing) return sendError(res, 404, 'Character not found');
  const merged = { ...existing, ...parsed.data };
  const v = validateCharacter(merged);
  if (!v.ok) return sendError(res, 400, `角色校验失败：${v.errors.join('；')}`);
  const updated = updateCharacter(series.id, req.params.characterId, parsed.data);
  if (!updated) return sendError(res, 404, 'Character not found');
  res.json({ character: updated });
});

router.post('/series/:id/characters/:characterId/regenerate-image', async (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  const dnaKey = seriesDnaKey(series);
  const character = series.characters.find(c => c.id === req.params.characterId);
  if (!character) return sendError(res, 404, 'Character not found');
  // 可选 body：{ shot?: CharacterShot } 单镜头重生成；不传则整组重生成
  const bodySchema = z.object({ shot: z.enum(['sheet']).optional() });
  const body = bodySchema.safeParse(req.body || {});
  const onlyShot = body.success ? body.data.shot : undefined;
  let taskId: string;
  try {
    taskId = runTask(`character:${character.id}:${onlyShot ?? 'all'}`, 'character-image-regen', async () => {
      try {
        if (!series.worldview) throw new Error('请先生成世界观，再生成角色参考图');
        const config = getConfig().image;
        const provider = getImageProvider(config);
        if (onlyShot) {
          // v3 单镜头重生成：仅支持 sheet（独立脸模已删除）
          if (onlyShot !== 'sheet') {
            throw new Error(`v3 已删除 ${onlyShot} 镜头规格，请只重生成 sheet`);
          }
          const shotSpec = CHARACTER_REFERENCE_SHOTS.find(s => s.id === 'sheet')!;
          const styleRefsRegen = getStyleRefs(dnaKey);
          const prompt = buildCharacterImagePrompt(character, series.worldview, 'sheet') + styleRefsRegen.note;
          const baseReq = withDnaImagePrompt(
            {
              prompt,
              aspectRatio: shotSpec.aspectRatio,
              referenceImages: styleRefsRegen.images.length > 0 ? styleRefsRegen.images : undefined,
            },
            { dnaKey, purpose: 'character', shotKind: 'sheet' },
          );
          let lastErr: string | undefined;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const img = await provider.generateImage(config, baseReq);
              // 2026-09-03 limb-guard：4 视图角色设定表最容易出现多胳膊，
              // 这里必须接巡检；任何异常自动局部 inpaint 重画。
              // 2026-09-07：guardedImage 返回 { image, audit }。
              const guarded = await guardedImage(img.image, prompt, dnaKey);
              logGeneration('character-reference-image', { seriesId: series.id, character: character.name, shot: 'sheet', model: config.model, prompt, dnaKey });
              const newPath = saveDataUrlImage(guarded.image);
              const updated = updateCharacter(series.id, character.id, {
                referenceImages: [newPath],
                referenceImage: newPath,
              });
              return { character: updated };
            } catch (e: any) {
              lastErr = (e?.message || String(e)).slice(0, 200);
              console.warn(`[series-routes] 角色 ${character.name} sheet 第 ${attempt + 1} 次生成失败：${lastErr}`);
              if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
            }
          }
          throw new Error(`角色 ${character.name} sheet 3 次尝试仍失败：${lastErr}`);
        }
        // 整组重生成（v3）：复用 generateCharacterReferenceSet，输出单张 sheet
        const set = await generateCharacterReferenceSet(character, series.worldview, dnaKey);
        // 生成失败时保留旧图 —— 清空旧图会让用户以为"点了没反应"
        const newSheet = set.sheet || character.referenceImages?.[0] || '';
        const updated = updateCharacter(series.id, character.id, {
          referenceImages: newSheet ? [newSheet] : [],
          referenceImage: newSheet || '',
        });
        return { character: updated };
      } catch (e: any) {
        throw new Error(e.message || 'Image regeneration failed');
      }
    });
  } catch (e: any) {
    if (e instanceof DuplicateTaskError) return sendError(res, 409, '该角色参考图正在生成中');
    return sendError(res, 500, e.message || 'Failed to start task');
  }
  res.json({ taskId });
});

export default router;
