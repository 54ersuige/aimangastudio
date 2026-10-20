import { Router } from 'express';
import { z } from 'zod';
import { getConfig } from '../config.js';
import { sendError, logGeneration, sendFriendlyError } from '../utils.js';
import { withDnaImagePrompt } from '../dna-inject.js';
import { runTask, setTaskProgress, DuplicateTaskError } from '../task-queue.js';
import { deleteStoredImage, isStoredImagePath, saveDataUrlImage } from '../image-store.js';
import { getSeries, updatePage, replacePanels, insertPanel, deletePanel } from '../series-store.js';
import type { Chapter, SeriesPage } from '../series-store.js';
import { callStructuredJson, seriesDnaKey, findPage, sanitizePanels, iterAllChapters, PanelBreakdownZ, PanelRewriteZ, getImageProvider } from './helpers.js';
import { collectPanelCharacterRefs, generatePanelImages, describePanelFailures, buildPanelImagePrompt, buildRecentContext, getStyleRefs } from './prompts.js';

const router = Router();

// ========== Step 4: 单页分镜 + 页面生成 ==========

const PanelBreakdownSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    sceneDescription: { type: 'string', description: '本批整体场景描述，1-2 句' },
    panels: {
      type: 'array',
      minItems: 2,
      maxItems: 8,
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          description: { type: 'string', description: '单格画面描述，60-120字：人物位置与相对距离、具体动作/手势、视线方向（最重要，必须写明看谁/看哪）、1-2个关键道具及其状态。一画一念：只写清本格的焦点，其余要素一句带过，画面留一个视觉焦点。道具/环境承担叙事（空/满/旧/摊开）。道具一律无字（禁止"印着XX/写着XX"）。服装与角色设定一致。' },
          dialogue: { type: 'string', description: '画面里正在发生/正在说的文字（1句，≤15字），必须在画面中有物理锚点（说话的人/讲到的物件/看到的景），与 description 共同解释同一件事——禁止旁白讲画面里没有的东西。能靠表情/肢体/道具讲清的情绪不写文字。必填，不可为空。如"他把钥匙推了过来"或"「今天就走。」"。' },
          camera: { type: 'string', description: '镜头景别+角度，取值：远景/全景/中景/中近景/近景/特写，可加角度后缀（如"中景，轻微仰角"）。' },
          characterIds: {
            type: 'array',
            items: { type: 'string' },
            description: '出场角色 ID 列表（仅限角色库中的主要角色）',
          },
          extraCharacters: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: '无名配角称呼，如"前台接待员"' },
                appearance: { type: 'string', description: '一句话外貌（性别+年龄+发型+服装+体态），必须与角色库中所有角色明显不同' },
              },
              required: ['name', 'appearance'],
            },
            description: '本格出现但不在角色库中的一次性配角（前台、路人、同事等）。画面里出现的每一个人都必须被登记：要么在 characterIds，要么在 extraCharacters。',
          },
        },
        required: ['index', 'description', 'characterIds'],
      },
    },
  },
  required: ['title', 'sceneDescription', 'panels'],
} as const;

/**
 * 专业分镜规则 —— breakdown / continue / rewrite 三处共用。
 * 老油条案例复盘：分镜"不专业"的根因是系统从未向模型提出任何镜头语言要求，
 * 模型只会按句子平均切格、景别随机、人物登记混乱。
 */
const STORYBOARD_RULES = `
【分格数量 —— 硬性要求】本批固定拆成 6 格，不多不少。此要求覆盖其他任何格数建议（包括世界观描述中的格数说法）。
【分镜专业规则 —— 必须逐条遵守】
1. 镜头节奏：景别变化必须服务叙事。同一场戏的连续对话允许同机位/同景别连续 2-3 格（Adrian Tomine 的对话段就是这样画的），禁止为了"景别曲线"而强行切机位 —— 那会让画面变碎。开篇可用一格全景交代空间，之后优先用稳定机位推进。
2. 视线与轴线：对话格优先用过肩或3/4侧面，保持人物左右位置全批一致（180度轴线）；人物视线方向要与下一格画面衔接。
3. 一画一念（每格一个焦点）：每格只传递一个主导信息 —— 人物 / 情绪 / 动作 三者取其一为主，其余为辅。禁止把多个重要元素（多人+多点+长对话）并置到同一格；多个焦点=必定失焦。参考本画风的克制中景：一格只讲"一件事"。
4. 空镜按需使用：当剧情需要停顿/转场时可以用一格空镜或人物极小的环境格，但不是每批必需。
5. 人物登记完整性：画面中出现的每一个人都必须登记 —— 角色库中的人用 characterIds（填其 ID），一次性配角（前台/路人/同事）用 extraCharacters（给称呼+一句话外貌，外貌必须明显区别于角色库所有人物，避免混淆）。
6. 图文相互依存（核心 · 画面与文字必须互相解释）：每格 dialogue 必须是画面里"正在发生/正在说"的事，并在画面中有明确的物理锚点 —— 说话的人、讲到的物件、看到的景。禁止"画面在演 A、旁白在讲 B"。若情绪是回忆/心理/过去时，description 必须用画面符号（特写、空杯、虚化的景、某个旧物件）承载它表达，让读者能看到这个情绪对应的画面，而不是让旁白空谈。dialogue 不是镜头指令，但它必须能"从画面上读出来"。本画风（New Yorker × Tomine 都市写实）靠安静克制的画面讲故事：一个道具、一次视线的错开，就胜过一段旁白。
7. description 信息密度（防"AI 自由猜测"）：每格 description 至少写清 ①每个出场人物的位置与相对距离 ②人物正在做的具体动作/手势 ③视线方向（看谁/看哪/看地面，视线是本格最重要的叙事动词，必须写明）④1-2 个关键道具及其状态。目标 60-120 字，禁止只写"某某坐在工位上"这类一句话概览。但密度高不等于塞满 —— 只有"焦点"相关的元素写细，其余要素给一句即可，画面必须留白、留一个视觉焦点。
8. 服装连续性 · 整话跨批硬一致（防人物变装）：每个角色的服装是唯一的，以角色库 outfit 字段与参考图为唯一来源，贯穿本话所有批次、所有格 —— 禁止因镜头、场景、时间、光线、情绪而自行更换/增减/改色；整话只允许"一套默认装束"。唯一例外：剧情明确要求（换班/回家/隔天/季节/剧情事件）时，才可在 description 里写明"已换穿……"并附明确理由；且一旦换穿，后续格必须持续保持该新装束，不得再变回。description 里任何与 outfit 字段矛盾的自创服装/换装描述都是失败品。
9. 道具一律无字（防乱码）：任何书籍/手册/招牌/屏幕/卡片/文件/海报都不得指定可读文字 —— 禁止"印着『XX』『写着XX』"这类写法，一律写"无字/字迹虚化"。图内出现任何可读文字都是失败品。
10. 批内与批间一致性：整批共用同一时间点、同一光源（如"傍晚自然窗光"）、同一地点；相邻批尽量延续同一场景与动作流，除非剧情推进需要换场。光线方向与人物外观状态不得跳变。
11. 语言经济（文字只写画面讲不清的）：每格 dialogue 控制在 1 句（≤15 字），落笔前先自问"删掉它画面还讲得清吗"—— 能靠表情/肢体/道具讲清的情绪不写文字，文字只承载画面不易传达的部分（一句话的指代、名字、时间信息）。禁止用旁白复述画面里已经画出来的东西（那是"装饰图"而非"叙事图"）。旁白框必须有画面锚点，不能凭空出声。
12. 道具/环境承担叙事（不是背景装饰）：每格至少 1 件道具或环境元素是"情节的一部分"，必须点名它此刻的状态（空/满/旧/裂/摊开/合上/被拿起/越过某处）以及它为何承载这一格的情绪。参考图：空咖啡杯+摊开的书+眼镜+钥匙 = "他走了、不会再回来"；桌上三杯咖啡却只有两人 = "有人在等谁/有人已缺席"。禁止"一个普通咖啡馆"这类零信息环境的写法，道具与环境是从世界观里挑出的具体物件，帮助读者一句话读懂人物处境。
13.【2026-09-03 · 图下方文字三件套】每格除了 description（出图用）+ dialogue（对白）外，必须额外输出 narration 与 innerThought 两个字段，三者互补：
    - narration（上帝视角叙述/场景交代）：20-80 字。是【作者】的声音，不是角色在说话。
        * 适合：开篇交代时间/空间/原因；中段解释为什么这件事发生；过渡格提示走向。
        * 不可写：角色的对白、角色心理（内心独白归 innerThought）、描述画面已经在做的事（与 description 重复）。
        * 不需要每格都写 —— 6 格中至少 2 格要有；首格、情绪转折、场景切换时优先级最高。
    - innerThought（主角内心独白）：0-50 字。是【主角（系列主角，若本话无主视角则不开）】在自己心里默默说的话。
        * 适合：选择前的犹豫；听到一句话后的反应；发现某件事真相的瞬间；与重要决定关联的瞬间。
        * 不适合：默认每格都写。每话最多 2-3 格用内心独白；其余段落全靠 narration 或 dialogue。
        * 与 dialogue 严格分开：dialogue 是嘴上说出的话，innerThought 是心里想的话。
    - 实在没有可写的格：narration/innerThought 都设为空字符串，前端不会显示空块（不强行占位）。
`;

router.post('/series/:id/pages/:pageId/breakdown', async (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  const found = findPage(series, req.params.pageId);
  if (!found) return sendError(res, 404, 'Page not found');
  const dnaKey = seriesDnaKey(series);
  const { chapter: targetChapter, page: targetPage } = found;
  try {
    // P2-9：跨章收集最近 3 页前文，AI 不再对之前发生的事一无所知
    const recentContext = buildRecentContext(series, targetPage.id, false, 3);
    // 角色库只给"名字 + 定位 + 一句话核心外貌"，完整外貌在出图阶段才需要。
    // 此前把整段 appearance 塞进 breakdown prompt，既撑长上下文又稀释模型对分镜规则的注意力。
    const charLib = series.characters.map(c => {
      const brief = (c.roleInStory || c.description || c.appearance || '').replace(/\s+/g, ' ').slice(0, 40);
      return `- id=${c.id} 名字=${c.name}（${c.role}）：${brief}`;
    }).join('\n');
    const prompt = `为以下漫画批次拆出恰好 6 个分镜（每批固定 6 格）。\n\n系列：${series.title}\n世界观：${series.worldview?.era} / ${series.worldview?.artStyle}\n所属话：《${targetChapter.title}》 - ${targetChapter.summary}\n\n角色库（主要角色）：\n${charLib}\n\n前文剧情（保持连续，不要重复已发生的情节）：\n${recentContext}\n\n当前批次：第 ${targetPage.pageNumber} 批（属于"${targetChapter.title}"这一话）\n\n【2026-09-03 图下方文字三件套 · 必须严格输出】\n每格除了 description（出图用）+ dialogue（对白 ≤15 字）外，必须额外输出两个字段 —— 缺一个就读不懂这格漫画。\n- narration（20-80 字）=【作者】的声音，交代场景/时间/原因/走向；本批 6 格中至少 2-4 格要有；首格必须有；情绪转折时必须有。**严禁与 description 重复**（不要复述画面已经在做的事）。**严禁填"无"/"省略"等占位词**（要填就写一段真叙述；不要就空串）。\n- innerThought（0-50 字）=【主角】的内心独白；本批 6 格中至少 0-2 格要有；只在"主角选择/迷茫/觉醒/重要发现"的瞬间用，**用第一称**（如"我意识到…""我不明白…""这就是…"）。\n- narration 和 innerThought 都允许空串。空串表示"这格不需要额外的文字层"，前端不会显示空块。**严禁用占位词填充**。\n\n请把这一批拆成恰好 6 个分镜。${STORYBOARD_RULES}\n\n核心要求：每个分镜的 dialogue 是"读者在画面上看到的文字"（1 句，≤15 字），description 是"镜头里正在发生的事"（画面本身）。两者必须互相解释、指向同一件事、同一个焦点 —— dialogue 必须能在 description 的画面里找到"它是谁说的/对着哪个物件说的/看着哪里说的"。禁止画面在演 A、旁白在讲 B。写 description 时先想清这一格的"一念"是什么（人物/情绪/动作），再让 dialogue 和道具共同强化它。`;
    const result = await callStructuredJson<z.infer<typeof PanelBreakdownZ>>(
      prompt,
      '你是一位漫画分镜师。请输出严格的 JSON 格式。',
      PanelBreakdownSchema as Record<string, unknown>,
      {
        dnaKey,
        logKind: 'breakdown',
        logMeta: { seriesId: series.id, pageId: targetPage.id },
        validate: raw => {
          const v = PanelBreakdownZ.parse(raw);
          // 单页固定 6 格：不符则打回重试（callStructuredJson 会带着更严格的提示重问）
          if (v.panels.length !== 6) throw new Error(`本批必须恰好 6 格，模型输出了 ${v.panels.length} 格，请重新输出恰好 6 格。`);
          return v;
        },
      },
    );
    // P1-8：幻觉角色 ID 过滤 + index 规整
    const validIds = new Set(series.characters.map(c => c.id));
    const panels = sanitizePanels(result.panels, validIds, `breakdown 第${targetPage.pageNumber}页`);
    if (!panels) return sendError(res, 502, '模型未返回有效分镜，请重试');
    const allCharIds = new Set<string>();
    panels.forEach(p => p.characterIds.forEach(id => allCharIds.add(id)));
    // 重新设计分镜：旧分镜已作废，清理其已落盘图片（IO 失败不阻断）
    let removedImages = 0;
    for (const pn of targetPage.panels) {
      if (pn.imageUrl && isStoredImagePath(pn.imageUrl) && deleteStoredImage(pn.imageUrl)) removedImages += 1;
    }
    const updated = updatePage(series.id, targetChapter.id, targetPage.id, {
      title: result.title || targetPage.title,
      sceneDescription: result.sceneDescription,
      panels,
      characterIds: Array.from(allCharIds),
      // 状态重置回草稿：旧图已删，不能再让前端误判"已完成"
      status: 'draft',
      errorMessage: undefined,
    });
    if (removedImages > 0) console.log(`[pages] 重新拆解第 ${targetPage.pageNumber} 页：清理旧图 ${removedImages} 张`);
    res.json({ page: updated });
  } catch (e: any) {
    // 2026-09-07：原本吞掉异常只返回 message，用户看不到根因。
    // 这里把堆栈 + 关键请求上下文打到日志便于排查 + 自动翻译为用户友好提示。
    console.error(`[breakdown] 第${targetPage.pageNumber}页 失败:`, e?.message || e);
    if (e?.stack) console.error(e.stack.split('\n').slice(0, 6).join('\n'));
    sendFriendlyError(res, e, 'Page breakdown failed');
  }
});

// 手动编辑：保存 page 元数据（页标题/场景描述/角色清单等）
const UpdatePageSchema = z.object({
  title: z.string().optional(),
  sceneDescription: z.string().optional(),
  characterIds: z.array(z.string()).optional(),
});

router.patch('/series/:id/pages/:pageId', (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  const found = findPage(series, req.params.pageId);
  if (!found) return sendError(res, 404, 'Page not found');
  const parsed = UpdatePageSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, parsed.error.message);
  const updated = updatePage(series.id, found.chapter.id, found.page.id, parsed.data);
  if (!updated) return sendError(res, 500, 'Failed to update page');
  res.json({ page: updated });
});

// 手动编辑：保存 page 的 panels（整体替换）。改完后退回 draft。
const ReplacePanelsSchema = z.object({
  panels: z.array(z.object({
    id: z.string().optional(),
    index: z.number().optional(),
    description: z.string(),
    dialogue: z.string().default(''),
    // 历史版本用 'characters'；新版本统一 'characterIds'。两者都接受，内部归一为 characterIds。
    characterIds: z.array(z.string()).optional().default([]),
    characters: z.array(z.string()).optional().default([]),
    camera: z.string().default('mid'),
    emotion: z.string().default(''),
    extraCharacters: z.array(z.object({
      name: z.string().min(1),
      appearance: z.string().min(1),
    })).optional(),
  })),
});

router.put('/series/:id/pages/:pageId/panels', (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  const found = findPage(series, req.params.pageId);
  if (!found) return sendError(res, 404, 'Page not found');
  const parsed = ReplacePanelsSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, parsed.error.message);
  // 归一化 characterIds（兼容旧字段 characters）
  const normalizedPanels = parsed.data.panels.map(p => ({
    ...p,
    characterIds: p.characterIds && p.characterIds.length > 0 ? p.characterIds : p.characters,
  }));
  const updated = replacePanels(series.id, found.chapter.id, found.page.id, normalizedPanels as any);
  if (!updated) return sendError(res, 500, 'Failed to replace panels');
  res.json({ page: updated });
});

// 手动编辑：在 page 中插入新 panel
router.post('/series/:id/pages/:pageId/panels/insert', (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  const found = findPage(series, req.params.pageId);
  if (!found) return sendError(res, 404, 'Page not found');
  const insertAt = typeof req.body?.insertAt === 'number' ? req.body.insertAt : undefined;
  const updated = insertPanel(series.id, found.chapter.id, found.page.id, insertAt);
  if (!updated) return sendError(res, 500, 'Failed to insert panel');
  res.json({ page: updated });
});

// 精细编辑：直接改某一格的 dialogue 字段（旁白或对话），不重生成图片。
router.patch('/series/:id/pages/:pageId/panels/:panelIndex/dialogue', (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  const found = findPage(series, req.params.pageId);
  if (!found) return sendError(res, 404, 'Page not found');
  const idx = Number(req.params.panelIndex);
  const target = found.page.panels.find(p => p.index === idx);
  if (!target) return sendError(res, 404, `Panel #${idx + 1} not found`);
  const dialogue = typeof req.body?.dialogue === 'string' ? req.body.dialogue : '';
  // 走 store 的整体替换接口（replacePanels）持久化，避免内部改对象+saveSeries 散落在多处。
  const newPanels = found.page.panels.map(p => p.index === idx ? { ...p, dialogue } : p);
  const updated = replacePanels(series.id, found.chapter.id, found.page.id, newPanels);
  if (!updated) return sendError(res, 500, 'Failed to update panel dialogue');
  res.json({ page: updated });
});

// 2026-09-03：精细编辑三合一 —— 改 narration（上帝叙述）/ innerThought（内心独白）/ dialogue（对白），
// 不重生成图片。前端可一键保存一格的"图下文字"。每个字段独立可选（缺字段保持原值）。
const UpdatePanelTextZ = z.object({
  dialogue: z.string().optional(),
  narration: z.string().optional(),
  innerThought: z.string().optional(),
});
router.patch('/series/:id/pages/:pageId/panels/:panelIndex/text', (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  const found = findPage(series, req.params.pageId);
  if (!found) return sendError(res, 404, 'Page not found');
  const idx = Number(req.params.panelIndex);
  const target = found.page.panels.find(p => p.index === idx);
  if (!target) return sendError(res, 404, `Panel #${idx} not found`);
  const parsed = UpdatePanelTextZ.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, parsed.error.message);
  // 修剪与清空：用 '' 传过来会把该字段彻底清空（区别于 undefined = 不动）。
  // 这样前端"删除整段叙述"按钮就能用空串实现。
  const trimOpt = (v: unknown): string | undefined => {
    if (v === undefined) return undefined;
    if (typeof v !== 'string') return undefined;
    const t = v.trim();
    return t === '' ? '' : t;
  };
  const dlg = trimOpt(parsed.data.dialogue);
  const nar = trimOpt(parsed.data.narration);
  const inner = trimOpt(parsed.data.innerThought);
  const newPanels = found.page.panels.map(p => {
    if (p.index !== idx) return p;
    const next: typeof p = { ...p };
    if (dlg !== undefined) next.dialogue = dlg;
    if (nar !== undefined) next.narration = nar || undefined; // '' 视作用户主动清空，存 undefined 让前端不渲染空块
    if (inner !== undefined) next.innerThought = inner || undefined;
    return next;
  });
  const updated = replacePanels(series.id, found.chapter.id, found.page.id, newPanels);
  if (!updated) return sendError(res, 500, 'Failed to update panel text');
  res.json({ page: updated });
});

// 2026-09-03：仅重写文字 AI endpoint —— 接受一格现有 description + 上下文，让 LLM
// 仅输出"图下文字"（narration/innerThought），不动 description 和 imageUrl。
// 这是与「重出一格」(重画图片) 并列的「重写此格文字」操作。
//
// 实现要点：
//  - 用户给"重写该格文字"的指令，原 description 仍然给 LLM 当画面上下文。
//  - 输出严格限于 { narration, innerThought, dialogue } —— 不动 description。
//  - LLM 输出走 PanelBreakdownZ 校验（narration/innerThought 字段已有）。
//  - 不重出图，最便宜最直观的修改手段。
const RewritePanelTextZ = z.object({
  instruction: z.string().min(1).max(500), // 用户改写指示，如"再加一段上帝视角叙述"
  characterIds: z.array(z.string()).optional(),
  pageContext: z.string().optional(), // 前端传入本页 sceneDescription 提高续写连贯
});
router.post('/series/:id/pages/:pageId/panels/:panelIndex/rewrite-text', async (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  const found = findPage(series, req.params.pageId);
  if (!found) return sendError(res, 404, 'Page not found');
  const idx = Number(req.params.panelIndex);
  const target = found.page.panels.find(p => p.index === idx);
  if (!target) return sendError(res, 404, `Panel #${idx} not found`);
  const parsed = RewritePanelTextZ.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, parsed.error.message);
  const dnaKey = seriesDnaKey(series);

  // 把本话近 1-2 页以及本格上下文一并给到模型，避免风格漂移。
  // 复用 buildRecentContext 但只取 1 页就够。
  const ctx = buildRecentContext(series, found.page.id, false, 1);
  const charLib = series.characters.map(c => {
    const brief = (c.roleInStory || c.description || c.appearance || '').replace(/\s+/g, ' ').slice(0, 40);
    return `- id=${c.id} 名字=${c.name}（${c.role}）：${brief}`;
  }).join('\n');

  const prompt = `你是漫画分镜的文字编辑。仅重写下列一格的"图下文字"（narration + innerThought + dialogue）。
【本格原文】
- index: ${target.index}
- description（画面描述，不允许改）：${target.description}
- dialogue（对白原值，可能为空）：${target.dialogue ?? ''}
- narration（叙述原值，可能为空）：${target.narration ?? ''}
- innerThought（内心独白原值，可能为空）：${target.innerThought ?? ''}

【用户改写指示】
${parsed.data.instruction}

【本话/上下文】
${parsed.data.pageContext || ctx}

【角色库（含 ID）】
${charLib}

【输出严格 JSON】
{
  "index": ${target.index},
  "dialogue": "≤30 字对白（按指示重写或保持原值；不需要改时给原值）",
  "narration": "20-80 字上帝视角叙述（按指示写，不需要时给空串）",
  "innerThought": "0-50 字主角内心独白（按指示写，不需要时给空串）"
}

注意：
1. description 字段不在你的输出里 —— 它由调用方保留原值，本任务严格只改三件图下文字。
2. 按用户指示保留原 dialogue（如未要求改），或按指示生成新对白。
3. narration 用作者口吻（不是角色在说话）。
4. innerThought 用主角内心语气（区分对白与内心）。
5. 旧值与新值有冲突时，新值优先（用户在当下表达更强）。`;

  try {
    const result = await callStructuredJson<z.infer<typeof PanelBreakdownZ>>(
      prompt,
      '你是漫画分镜文字编辑。请只输出 JSON，不要任何额外文字。',
      PanelBreakdownSchema as Record<string, unknown>,
      {
        dnaKey,
        logKind: 'panel-text-rewrite',
        logMeta: { seriesId: series.id, pageId: found.page.id, panelIndex: idx },
        validate: raw => PanelBreakdownZ.parse(raw),
      },
    );
    // 只取本格（模型可能错返回多格 —— 取 index 匹配的）
    const rew = result.panels.find(p => p.index === idx) ?? result.panels[0];
    if (!rew) return sendError(res, 502, '模型未返回有效字段');
    const newPanels = found.page.panels.map(p => {
      if (p.index !== idx) return p;
      // description 完全不动；
      // dialogue / narration / innerThought 仅当模型给出非空值才覆盖；
      // 否则使用 sanitizePanels 已有的兜底（但为了让用户能在图中看到自身编辑过的值，
      //   这里优先用上方 result 的原始字段 trimmed）。
      const trimmedDlg = (rew.dialogue || '').trim();
      const trimmedNar = (rew.narration || '').trim();
      const trimmedInner = (rew.innerThought || '').trim();
      return {
        ...p,
        dialogue: trimmedDlg || p.dialogue,
        narration: trimmedNar || undefined,
        innerThought: trimmedInner || undefined,
      };
    });
    const updated = replacePanels(series.id, found.chapter.id, found.page.id, newPanels);
    if (!updated) return sendError(res, 500, 'Failed to save rewritten text');
    res.json({ page: updated });
  } catch (e: any) {
    sendFriendlyError(res, e, '重写图下文字失败');
  }
});

// 手动编辑：删除 page 中一个 panel
router.delete('/series/:id/pages/:pageId/panels/:panelId', (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  const found = findPage(series, req.params.pageId);
  if (!found) return sendError(res, 404, 'Page not found');
  const updated = deletePanel(series.id, found.chapter.id, found.page.id, req.params.panelId);
  if (!updated) return sendError(res, 500, 'Failed to delete panel');
  res.json({ page: updated });
});

router.post('/series/:id/pages/:pageId/generate', async (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  const found = findPage(series, req.params.pageId);
  if (!found) return sendError(res, 404, 'Page not found');
  const dnaKey = seriesDnaKey(series);
  const { chapter: targetChapter, page: targetPage } = found;
  if (targetPage.panels.length === 0) return sendError(res, 400, '请先生成分镜');
  if (targetPage.status === 'generating') return sendError(res, 409, '该页正在生成中，请稍候');
  // 2026-10-20：**先查缺不缺图，再置 generating**。
  // 原来的顺序是先置 generating 再查 —— 于是「本批已出齐」这个 400 分支
  // 会把一个**已经完成**的批次留在 'generating' 状态，
  // 用户再点只会撞 409「正在生成中」，而那个任务早就不存在了。
  // 增量语义（只补缺失格，已有图不动）本身没问题，坏的只是这两行的先后。
  const sortedAll = [...targetPage.panels].sort((a, b) => a.index - b.index);
  const missingPanels = sortedAll.filter(p => !p.imageUrl);
  if (missingPanels.length === 0) return sendError(res, 400, '本批分镜图已齐全；如需整批重画请用「重画此批」');
  // 同步置为 generating：利用单线程原子性挡住并发重复点击
  updatePage(series.id, targetChapter.id, targetPage.id, { status: 'generating', errorMessage: undefined });
  let taskId: string;
  try {
    taskId = runTask(`page:${targetPage.id}`, 'page-generate', async (tid) => {
      try {
        const { paths, failures, hints } = await generatePanelImages(
          series, targetPage.sceneDescription, missingPanels,
          `generate 第${targetPage.pageNumber}页`, dnaKey,
          { onProgress: (d, t) => setTaskProgress(tid, Math.round((d / t) * 100)) },
        );
        // 只回写成功的格：失败格保持原样（无图），绝不把 null 当成 imageUrl 写进去。
        const pathByIndex = new Map<number, string>();
        missingPanels.forEach((p, i) => { const v = paths[i]; if (v) pathByIndex.set(p.index, v); });
        const updatedPanels = sortedAll.map(p =>
          p.imageUrl || !pathByIndex.has(p.index) ? p : { ...p, imageUrl: pathByIndex.get(p.index)! },
        );
        const updated = updatePage(series.id, targetChapter.id, targetPage.id, {
          panels: updatedPanels,
          // 部分失败也算这一批没跑完：红条列出哪几格失败 + 明说成功的已保留，
          // 用户可只补那几格，而不是重画整批再付一遍钱。
          status: failures.length > 0 ? 'error' : 'done',
          errorMessage: failures.length > 0 ? describePanelFailures(failures, missingPanels.length) : undefined,
          // 2026-10-20：描述偏短的提示 —— 成功但建议你再看一眼，和"失败"是两回事。
          hint: hints && hints.length > 0 ? hints.join('；') : undefined,
        });
        return { page: updated };
      } catch (e: any) {
        updatePage(series.id, targetChapter.id, targetPage.id, { status: 'error', errorMessage: e.message });
        throw e;
      }
    });
  } catch (e: any) {
    if (e instanceof DuplicateTaskError) {
      return sendError(res, 409, '该页正在生成中，请稍候');
    }
    updatePage(series.id, targetChapter.id, targetPage.id, { status: 'error', errorMessage: e.message });
    return sendError(res, 500, e.message || 'Failed to start task');
  }
  res.json({ taskId });
});

// 单个分镜重生（整页重画）
router.post('/series/:id/pages/:pageId/regenerate', async (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  const found = findPage(series, req.params.pageId);
  if (!found) return sendError(res, 404, 'Page not found');
  const dnaKey = seriesDnaKey(series);
  const { chapter: targetChapter, page: targetPage } = found;
  if (targetPage.panels.length === 0) return sendError(res, 400, '请先生成分镜');
  if (targetPage.status === 'generating') return sendError(res, 409, '该页正在生成中，请稍候');
  updatePage(series.id, targetChapter.id, targetPage.id, { status: 'generating', errorMessage: undefined });

  let taskId: string;
  try {
    taskId = runTask(`page:${targetPage.id}`, 'page-regenerate', async (tid) => {
      try {
        const { paths, failures } = await generatePanelImages(
          series, targetPage.sceneDescription, targetPage.panels,
          `regenerate 第${targetPage.pageNumber}页`, dnaKey,
          { onProgress: (d, t) => setTaskProgress(tid, Math.round((d / t) * 100)) },
        );
        const sortedPanels = [...targetPage.panels].sort((a, b) => a.index - b.index);
        const reasonByIndex = new Map(failures.map(f => [f.panelIndex, f.reason]));
        // 重画路径：失败格保留它原来的旧图，不清空 —— 宁可留旧图也不要留空洞。
        // 但必须标记 stale：否则「6 格齐全」是假象，其中那格其实还是上次的图，
        // 而用户以为自己也看过新版了（2026-10-16 新增）。
        const updatedPanels = sortedPanels.map((p, i) => {
          const next = paths[i];
          if (next) return { ...p, imageUrl: next, stale: undefined, staleReason: undefined };
          if (!p.imageUrl) return { ...p, stale: undefined, staleReason: undefined };
          return { ...p, stale: true, staleReason: reasonByIndex.get(p.index) || '本轮出图失败' };
        });
        const updated = updatePage(series.id, targetChapter.id, targetPage.id, {
          panels: updatedPanels,
          status: failures.length > 0 ? 'error' : 'done',
          errorMessage: failures.length > 0 ? describePanelFailures(failures, sortedPanels.length) : undefined,
        });
        return { page: updated };
      } catch (e: any) {
        updatePage(series.id, targetChapter.id, targetPage.id, { status: 'error', errorMessage: e.message });
        throw e;
      }
    });
  } catch (e: any) {
    if (e instanceof DuplicateTaskError) {
      return sendError(res, 409, '该页正在生成中，请稍候');
    }
    updatePage(series.id, targetChapter.id, targetPage.id, { status: 'error', errorMessage: e.message });
    return sendError(res, 500, e.message || 'Failed to start task');
  }
  res.json({ taskId });
});

// ========== 单格（重）生成 ==========
// 只出这一格的图，不改文字描述。已有图时视为重掷（换一张），文字修改走 rewrite / dialogue 端点。
router.post('/series/:id/pages/:pageId/panels/:panelIndex/generate', async (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  const found = findPage(series, req.params.pageId);
  if (!found) return sendError(res, 404, 'Page not found');
  const { chapter: targetChapter, page: targetPage } = found;
  if (targetPage.panels.length === 0) return sendError(res, 400, '请先生成分镜');
  if (targetPage.status === 'generating') return sendError(res, 409, '该页正在生成中，请稍候');
  const panelIndex = Number(req.params.panelIndex);
  const targetPanel = targetPage.panels.find(p => p.index === panelIndex);
  if (!targetPanel) return sendError(res, 404, 'Panel not found');
  const dnaKey = seriesDnaKey(series);

  // 不整页置 generating（避免其余格全部显示"生成中"）；
  // 单格互斥键 = `panel:${pageId}#${idx}`，与整页 generate 互不阻塞。
  // 同 page 内 panel-generate 串行（同 panel 不能并发）。
  let taskId: string;
  try {
    taskId = runTask(`panel:${targetPage.id}#${panelIndex}`, 'panel-generate', async () => {
      try {
        const { paths, failures } = await generatePanelImages(
          series, targetPage.sceneDescription, [targetPanel],
          `panel 第${targetPage.pageNumber}页#${panelIndex}`, dnaKey,
        );
        const single = paths[0];
        if (!single) {
          // 单格唯一一格失败 → 不写回，保持面板可重试，错误信息透出
          const reason = failures[0]?.reason || '出图失败';
          updatePage(series.id, targetChapter.id, targetPage.id, {
            status: 'error', errorMessage: `第${panelIndex + 1}格出图失败：${reason}`,
          });
          throw new Error(`第${panelIndex + 1}格出图失败：${reason}`);
        }
        const updatedPanels = [...targetPage.panels]
          .sort((a, b) => a.index - b.index)
          .map(p => p.index === panelIndex ? { ...p, imageUrl: single } : p);
        const allDone = updatedPanels.every(p => !!p.imageUrl);
        const updated = updatePage(series.id, targetChapter.id, targetPage.id, {
          panels: updatedPanels,
          status: allDone ? 'done' : 'draft',
          errorMessage: undefined,
        });
        return { page: updated };
      } catch (e: any) {
        updatePage(series.id, targetChapter.id, targetPage.id, { status: 'error', errorMessage: e.message });
        throw e;
      }
    });
  } catch (e: any) {
    if (e instanceof DuplicateTaskError) {
      return sendError(res, 409, '该页正在生成中，请稍候');
    }
    return sendError(res, 500, e.message || 'Failed to start task');
  }
  res.json({ taskId });
});

// ========== 自然语言改写单页 ==========

const PageRewriteSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    sceneDescription: { type: 'string' },
    panels: {
      type: 'array',
      minItems: 2,
      maxItems: 8,
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          description: { type: 'string' },
          dialogue: { type: 'string' },
          camera: { type: 'string', description: '镜头景别+角度：远景/全景/中景/中近景/近景/特写' },
          characterIds: { type: 'array', items: { type: 'string' } },
          extraCharacters: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                appearance: { type: 'string' },
              },
              required: ['name', 'appearance'],
            },
            description: '不在角色库中的一次性配角（画面里出现的每个人都要登记）',
          },
        },
        required: ['index', 'description', 'characterIds'],
      },
    },
  },
  required: ['title', 'sceneDescription', 'panels'],
} as const;

router.post('/series/:id/pages/:pageId/rewrite', async (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  const found = findPage(series, req.params.pageId);
  if (!found) return sendError(res, 404, 'Page not found');
  const dnaKey = seriesDnaKey(series);
  const { chapter: targetChapter, page: targetPage } = found;

  const schema = z.object({
    instruction: z.string().min(1).max(2000),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, parsed.error.message);
  if (targetPage.status === 'generating') return sendError(res, 409, '该页正在生成中，请稍候');
  updatePage(series.id, targetChapter.id, targetPage.id, { status: 'generating', errorMessage: undefined });

  let taskId: string;
  try {
    taskId = runTask(`page:${targetPage.id}`, 'page-rewrite', async (tid) => {
      try {
        // 1) 文字模型按用户指令重写分镜
        const rewritePrompt = `用户在修改第 ${targetPage.pageNumber} 页（章节：${targetChapter.title}）。\n\n用户原始内容：\n页标题：${targetPage.title}\n场景：${targetPage.sceneDescription}\n当前分镜：\n${targetPage.panels.map(p => `${p.index}. [${p.camera || 'mid'}] ${p.description}${p.dialogue ? `（对白："${p.dialogue}"）` : ''} → 角色：${p.characterIds.join(',') || '无'}${p.extraCharacters?.length ? `；配角：${p.extraCharacters.map(e => e.name).join(',')}` : ''}`).join('\n')}\n\n用户的新指令：${parsed.data.instruction}\n\n请输出改写后的页面（保留原分镜数量或合理调整）。${STORYBOARD_RULES}\ncharacterIds 必须从下列 ID 中选：${series.characters.map(c => `${c.id}=${c.name}`).join('，')}。`;
        const rewritten = await callStructuredJson<z.infer<typeof PanelBreakdownZ>>(
          rewritePrompt,
          '你是一位漫画编剧。用户要修改当前页，请根据指令输出新的分镜描述。严格输出 JSON。',
          PageRewriteSchema as Record<string, unknown>,
          {
            dnaKey,
            temperature: 0.8,
            logKind: 'page-rewrite',
            logMeta: { seriesId: series.id, pageId: targetPage.id, instruction: parsed.data.instruction },
            validate: raw => PanelBreakdownZ.parse(raw),
          },
        );
        const validIds = new Set(series.characters.map(c => c.id));
        const panels = sanitizePanels(rewritten.panels, validIds, `rewrite 第${targetPage.pageNumber}页`);
        if (!panels) throw new Error('模型未返回有效分镜');
        const allCharIds = new Set<string>();
        panels.forEach(p => p.characterIds.forEach(id => allCharIds.add(id)));
        updatePage(series.id, targetChapter.id, targetPage.id, {
          title: rewritten.title || targetPage.title,
          sceneDescription: rewritten.sceneDescription,
          panels,
          characterIds: Array.from(allCharIds),
        });
        // 2) 按新分镜重新出图
        const fresh = getSeries(series.id);
        const freshFound = fresh ? findPage(fresh, targetPage.id) : null;
        if (!freshFound) throw new Error('页面数据丢失');
        const { paths, failures } = await generatePanelImages(
          series, rewritten.sceneDescription, panels,
          `rewrite 第${targetPage.pageNumber}页`, dnaKey,
          { onProgress: (d, t) => setTaskProgress(tid, Math.round((d / t) * 100)) },
        );
        const sortedPanels = [...panels].sort((a, b) => a.index - b.index);
        // 改写路径：分镜文本已换成新的，失败格无旧图可留，只能留空等重试。
        const updatedPanels = sortedPanels.map((p, i) => {
          const next = paths[i];
          return next ? { ...p, imageUrl: next } : { ...p, imageUrl: undefined };
        });
        const updated = updatePage(series.id, targetChapter.id, targetPage.id, {
          panels: updatedPanels,
          status: failures.length > 0 ? 'error' : 'done',
          errorMessage: failures.length > 0 ? describePanelFailures(failures, sortedPanels.length) : undefined,
        });
        return { page: updated };
      } catch (e: any) {
        updatePage(series.id, targetChapter.id, targetPage.id, { status: 'error', errorMessage: e.message });
        throw e;
      }
    });
  } catch (e: any) {
    if (e instanceof DuplicateTaskError) {
      updatePage(series.id, targetChapter.id, targetPage.id, { status: targetPage.status, errorMessage: undefined });
      return sendError(res, 409, '该页正在生成中，请稍候');
    }
    updatePage(series.id, targetChapter.id, targetPage.id, { status: 'error', errorMessage: e.message });
    return sendError(res, 500, e.message || 'Failed to start task');
  }
  res.json({ taskId });
});

// ========== 单分镜自然语言改写 ==========

const PanelRewriteSchema = {
  type: 'object',
  properties: {
    description: { type: 'string' },
    dialogue: { type: 'string' },
    camera: { type: 'string', description: '镜头景别+角度：远景/全景/中景/中近景/近景/特写' },
    characterIds: { type: 'array', items: { type: 'string' } },
    extraCharacters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          appearance: { type: 'string' },
        },
        required: ['name', 'appearance'],
      },
      description: '不在角色库中的一次性配角（画面里出现的每个人都要登记）',
    },
  },
  required: ['description'],
} as const;

router.post('/series/:id/pages/:pageId/panels/:panelIndex/rewrite', async (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  const found = findPage(series, req.params.pageId);
  if (!found) return sendError(res, 404, 'Page not found');
  const dnaKey = seriesDnaKey(series);
  const { chapter: targetChapter, page: targetPage } = found;

  const panelIndex = Number(req.params.panelIndex);
  const targetPanel = targetPage.panels.find(p => p.index === panelIndex);
  if (!targetPanel) return sendError(res, 404, 'Panel not found');

  const schema = z.object({ instruction: z.string().min(1).max(2000) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, parsed.error.message);
  if (targetPage.status === 'generating') return sendError(res, 409, '该页正在生成中，请稍候');

  let taskId: string;
  try {
    // 2026-09-18：单格 rewrite 也用 `panel:${pageId}#${idx}` 锁，与 panel-generate
    // 互斥（同 panel 不允许同时改写 + 重生），但与整页 / 其它 panel 不互斥。
    taskId = runTask(`panel:${targetPage.id}#${panelIndex}`, 'panel-rewrite', async () => {
      try {
        // 1) 文字模型重写这一格的描述
        const rewritePrompt = `当前是漫画第 ${targetPage.pageNumber} 页（章节：${targetChapter.title}）中的第 ${panelIndex} 格。\n\n原描述：${targetPanel.description}\n原镜头：${targetPanel.camera || 'mid'}\n${targetPanel.dialogue ? `原对白："${targetPanel.dialogue}"` : ''}\n\n用户的新指令：${parsed.data.instruction}\n\n请改写这一格的画面描述、镜头（camera）、对白、出场角色（characterIds 仅从下列 ID 中选：${series.characters.map(c => `${c.id}=${c.name}`).join('，')}；画面里出现的一次性配角放 extraCharacters）。严格输出 JSON。`;
        const rewritten = await callStructuredJson<z.infer<typeof PanelRewriteZ>>(
          rewritePrompt,
          '你是一位漫画分镜师。用户要修改单格画面，请输出新的描述。严格输出 JSON。',
          PanelRewriteSchema as Record<string, unknown>,
          {
            dnaKey,
            temperature: 0.8,
            logKind: 'panel-rewrite',
            logMeta: { seriesId: series.id, pageId: targetPage.id, panelIndex, instruction: parsed.data.instruction },
            validate: raw => PanelRewriteZ.parse(raw),
          },
        );
        const validIds = new Set(series.characters.map(c => c.id));
        const okIds = Array.from(new Set(rewritten.characterIds || [])).filter(id => validIds.has(id));
        if (okIds.length < (rewritten.characterIds || []).length) {
          console.warn(`[series-routes] panel-rewrite：过滤 ${(rewritten.characterIds || []).length - okIds.length} 个幻觉角色 ID`);
        }
        // 2) 重新出这一格的图（与整页出图共用 prompt 构建，避免逻辑漂移）
        if (!series.worldview) throw new Error('请先生成世界观，再生成图像');
        const config = getConfig().image;
        const imageProvider = getImageProvider(config);
        const { refImages, charDescLines, boundCharNames, anchorText } = collectPanelCharacterRefs(series, {
          characterIds: okIds,
          camera: rewritten.camera || targetPanel.camera,
        });
        const styleRefsRewrite = getStyleRefs(dnaKey);
        const newExtras = (rewritten.extraCharacters ?? []).filter(ec => ec?.name?.trim() && ec?.appearance?.trim());
        const prompt = buildPanelImagePrompt({
          style: series.worldview.artStyle,
          mood: series.worldview.paletteMood,
          sceneDescription: targetPage.sceneDescription,
          description: rewritten.description,
          charDescLines,
          boundCharNames,
          anchorText,
          extraCharacters: newExtras.length > 0 ? newExtras : targetPanel.extraCharacters,
        }) + styleRefsRewrite.note;
        const allRefsRewrite = [...refImages, ...styleRefsRewrite.images];
        const finalReq = withDnaImagePrompt({
          prompt,
          referenceImages: allRefsRewrite.length > 0 ? allRefsRewrite : undefined,
          aspectRatio: '3:4',
        }, { dnaKey, purpose: 'panel' });
        const img = await imageProvider.generateImage(config, finalReq);
        logGeneration('panel-image', { seriesId: series.id, ctx: `panel-rewrite p${targetPage.pageNumber}#${panelIndex}`, model: config.model, prompt: finalReq.prompt, promptLen: finalReq.prompt.length, refCount: refImages.length, styleRefCount: styleRefsRewrite.images.length, dnaKey });
        // 3) 替换原 panel
        const updatedPanels = targetPage.panels.map(p =>
          p.index === panelIndex
            ? {
              ...p,
              description: rewritten.description,
              dialogue: rewritten.dialogue || '',
              characterIds: okIds,
              camera: rewritten.camera || p.camera,
              extraCharacters: newExtras.length > 0 ? newExtras : p.extraCharacters,
              imageUrl: saveDataUrlImage(img.image),
            }
            : p,
        );
        const updated = updatePage(series.id, targetChapter.id, targetPage.id, { panels: updatedPanels, status: 'done', errorMessage: undefined });
        const panel = updatedPanels.find(p => p.index === panelIndex);
        return { panel };
      } catch (e: any) {
        throw new Error(e.message || 'Panel rewrite failed');
      }
    });
  } catch (e: any) {
    if (e instanceof DuplicateTaskError) return sendError(res, 409, '该页正在处理中，请稍候');
    return sendError(res, 500, e.message || 'Failed to start task');
  }
  res.json({ taskId });
});

// ========== 一键续写：基于已完成的页自动生成下一个空白页的草稿 ==========

router.post('/series/:id/pages/:pageId/continue', async (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  const found = findPage(series, req.params.pageId);
  if (!found) return sendError(res, 404, 'Page not found');
  const dnaKey = seriesDnaKey(series);
  const { chapter: targetChapter, page: targetPage } = found;

  // 找全局顺序的下一页（先当前章节，再下一章节）
  const flat: { ch: Chapter; p: SeriesPage }[] = [];
  for (const ch of iterAllChapters(series)) for (const p of ch.pages) flat.push({ ch, p });
  const idx = flat.findIndex(x => x.p.id === targetPage.id);
  const next = flat[idx + 1];
  if (!next) return sendError(res, 400, '已经是最后一页，没有可续写的下一页');
  if (next.p.status === 'done' || next.p.panels.length > 0) {
    return sendError(res, 400, '下一页已经有内容，请直接编辑或重生成');
  }

  try {
    // P2-9：跨章收集最近 3 页（含当前页）作为上下文
    const contextText = buildRecentContext(series, targetPage.id, true, 3);
    const charLib = series.characters.map(c => {
      const brief = (c.roleInStory || c.description || c.appearance || '').replace(/\s+/g, ' ').slice(0, 40);
      return `- id=${c.id} 名字=${c.name}（${c.role}）：${brief}`;
    }).join('\n');
    const continuePrompt = `你正在为连载漫画《${series.title}》的《${next.ch.title}》续写新一批内容。\n\n世界观：${series.worldview?.era} / ${series.worldview?.artStyle}\n本话剧情：${next.ch.title} - ${next.ch.summary}\n\n角色库（主要角色）：\n${charLib}\n\n前文剧情（按顺序，保持连续，不要重复已发生的情节）：\n${contextText}\n\n现在要写本话的第 ${next.p.pageNumber} 批。请输出恰好 6 个分镜（每批固定 6 格），让故事自然承接。${STORYBOARD_RULES}\ncharacterIds 仅从上
述 ID 中选。`;
    const breakdown = await callStructuredJson<z.infer<typeof PanelBreakdownZ>>(
      continuePrompt,
      '你是一位漫画编剧。请输出严格的 JSON 格式。',
      PanelBreakdownSchema as Record<string, unknown>,
      {
        dnaKey,
        temperature: 0.8,
        logKind: 'continue',
        logMeta: { seriesId: series.id, pageId: next.p.id },
        validate: raw => {
          const v = PanelBreakdownZ.parse(raw);
          if (v.panels.length !== 6) throw new Error(`本批必须恰好 6 格，模型输出了 ${v.panels.length} 格，请重新输出恰好 6 格。`);
          return v;
        },
      },
    );
    const validIds = new Set(series.characters.map(c => c.id));
    const panels = sanitizePanels(breakdown.panels, validIds, `continue 第${next.p.pageNumber}页`);
    if (!panels) return sendError(res, 502, '模型未返回有效分镜，请重试');
    const allCharIds = new Set<string>();
    panels.forEach(p => p.characterIds.forEach(id => allCharIds.add(id)));
    const updated = updatePage(series.id, next.ch.id, next.p.id, {
      title: breakdown.title || next.p.title,
      sceneDescription: breakdown.sceneDescription,
      panels,
      characterIds: Array.from(allCharIds),
      status: 'draft',
    });
    res.json({ page: updated });
  } catch (e: any) {
    sendFriendlyError(res, e, 'Continue generation failed');
  }
});

export default router;
