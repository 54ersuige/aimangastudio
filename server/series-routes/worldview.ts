import { Router } from 'express';
import { z } from 'zod';
import { sendError } from '../utils.js';
import { getSeries, updateSeries } from '../series-store.js';
import type { Worldview } from '../series-store.js';
import { getDna } from '../dna/registry.js';
import { callStructuredJson, seriesDnaKey, WorldviewZ, warnStyleWords } from './helpers.js';

const router = Router();

// ========== Step 1: 世界观 ==========

const WorldviewSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '一句话世界观简介' },
    background: { type: 'string', description: '世界背景故事，2-3 段' },
    era: { type: 'string', description: '时代设定，必须是现实当代或近代中国，如"2020 年代上海"' },
    artStyle: { type: 'string', description: '美术风格关键词，必须在系统规范内细化：New Yorker 单幅插画 × Adrian Tomine 都市写实细线 × 独立 Graphic Novel，如"New Yorker 式细线写实 + 大量留白"' },
    paletteMood: { type: 'string', description: '色调氛围，必须是暖色印刷感：如"奶油黄/燕麦底色 + 粉赭红棕点缀，低饱和"' },
    // —— 系列漫画蓝图字段（避免后续生成全凭 LLM 自由发挥）——
    characterBlueprints: {
      type: 'array',
      minItems: 2,
      maxItems: 6,
      description: '本系列涉及的全部角色蓝图（按重要性排序，含主角）。禁止写外貌等冗长字段。',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '暂定名字，2-4 字中文名' },
          role: { type: 'string', enum: ['protagonist', 'antagonist', 'supporting'], description: '主角/反派/配角' },
          roleInStory: { type: 'string', description: '一句话定位，不超过 20 字（例：主角的职场导师）' },
          motivation: { type: 'string', description: '一句话核心动机 / 弧光，不超过 30 字' },
        },
        required: ['name', 'role', 'roleInStory', 'motivation'],
      },
    },
    plotOutline: {
      type: 'string',
      description: '整体剧情大纲，3-5 幕/段，每段一行，控制在 150 字以内。后续章节拆分严格按此切页。',
    },
    conflicts: {
      type: 'array',
      minItems: 2,
      maxItems: 5,
      description: '核心矛盾 / 张力点，每条一句话，不超过 30 字。驱动后续分镜情绪曲线。',
      items: { type: 'string' },
    },
    locations: {
      type: 'array',
      minItems: 2,
      maxItems: 4,
      description: '关键场景（地点 + 一句话氛围，≤ 25 字），分镜 prompt 复用。',
      items: { type: 'string' },
    },
    // —— 季/卷蓝图：整本连载的剧情节奏骨架 —— 
    arcBlueprints: {
      type: 'array',
      minItems: 2,
      maxItems: 6,
      description: '把整本连载切成 2-6 季；每季只给 title + premise + plannedChapterCount，不写每话细节（避免 token 膨胀）。',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '季标题：本季剧情主题的极短概括（2-6 字）。禁止包含「季/卷/章/话/页」等结构字，例："觉醒""都市入局"' },
          premise: { type: 'string', description: '一句话剧情走向 / 主题，≤ 40 字' },
          plannedChapterCount: { type: 'integer', minimum: 2, maximum: 8, description: '计划本季话数（2-8）' },
        },
        required: ['title', 'premise', 'plannedChapterCount'],
      },
    },
  },
  required: ['summary', 'background', 'era', 'artStyle', 'paletteMood', 'characterBlueprints', 'plotOutline', 'conflicts', 'locations', 'arcBlueprints'],
} as const;

router.post('/series/:id/worldview/generate', async (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  const dnaKey = seriesDnaKey(series);
  const dna = getDna(dnaKey);
  // P1-5：接收用户对上一版的修改意见
  const bodySchema = z.object({ hint: z.string().max(2000).optional() });
  const body = bodySchema.safeParse(req.body || {});
  const hint = body.success ? body.data.hint?.trim() : undefined;
  try {
    const prevBlock = series.worldview
      ? `\n\n上一版世界观（用户要求在其基础上修改，不要推倒重来）：\n${JSON.stringify(series.worldview, null, 2)}\n`
      : '';
    const hintBlock = hint
      ? `\n\n用户对上一版的修改意见（本次生成必须逐条体现）：${hint}\n`
      : '';
    const prompt = `用户想创作的漫画：\n标题：${series.title}\n一句话简介：${series.logline}${prevBlock}${hintBlock}\n请根据这些信息设计一个详细的世界观设定。\n\n【画风硬约束】本系列画风已被系统 Art Direction 锁定为：${dna.VISUAL_DEFINITION.trim()}。你输出的 artStyle 与 paletteMood 必须在该范围内细化，严禁出现 ${dna.VISUAL_FORBIDDEN.slice(0, 8).join('、')} 等词。era 与世界观必须符合本系列的题材方向。\n\n【系列蓝图硬约束 —— 后续所有生成都基于本输出】\n1) characterBlueprints：必须列出本故事**全部**涉及的角色（含主角 + 必要配角 + 反派），2-6 个；只给 name / role / roleInStory / motivation，**不要**写外貌 / 详细背景。\n2) plotOutline：3-5 段/幕剧情大纲，每段一行，控制在 150 字以内；后续按这条切话目，**禁止**自己重新编剧情。\n3) conflicts：2-5 条核心矛盾，每条一句话（≤30 字）。驱动后续分镜张力曲线。\n4) locations：2-4 个关键场景（地点 + 一句话氛围，≤25 字）。分镜 prompt 复用以保证视觉一致。\n5) **arcBlueprints**：把整本连载切成 **2-6 季**。每季只给 title + premise（≤40 字）+ plannedChapterCount（2-8）；**禁止**写每话细节——逐季生成时 AI 会基于 premise + 上一季结尾再展开。季标题**禁止**包含「季/卷/章/话/页」等结构字（序号由系统显示，标题只写主题词）。\n\n注意：这些蓝图字段会被前端折叠展示给用户确认 / 在聊天里修改。文字膨胀会撑爆图片生成模型的理解窗口，请严格控制在字数内。`;
    const worldview = await callStructuredJson<Worldview>(
      prompt,
      '你是一位资深漫画编辑，擅长世界设定。请输出严格的 JSON 格式。',
      WorldviewSchema as Record<string, unknown>,
      {
        dnaKey,
        logKind: 'worldview',
        logMeta: { seriesId: series.id, hint },
        validate: (raw): Worldview => {
          const v = WorldviewZ.parse(raw);
          warnStyleWords('worldview artStyle', v.artStyle);
          warnStyleWords('worldview paletteMood', v.paletteMood);
          return v;
        },
      },
    );
    updateSeries(series.id, { worldview });
    res.json({ worldview });
  } catch (e: any) {
    sendError(res, 502, e.message || 'Worldview generation failed');
  }
});

export default router;
