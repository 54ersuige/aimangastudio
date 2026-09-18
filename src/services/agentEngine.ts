/**
 * Agent 引擎 —— 聊天驱动创作流程的状态机
 *
 * 设计原则：
 *   - 用户在聊天框里的每条消息是一条"指令"。Agent 解析后调用现有的
 *     SeriesContext API（已经在用），并把阶段性产物以"内嵌审核卡"形式
 *     推回聊天。
 *   - 4 个关键节点（世界观 / 角色 / 话目大纲 / 逐话分镜）必须停下来
 *     等用户确认；其他过程自动推进。
 *   - 用户可以随时输入"修改为..."、"重新生成"、"删除 X"、"出图第 3 话"、
 *     "重出第 5 格" 等自然语言指令；引擎做最宽松的语义匹配。
 *   - 2026-09-02 对齐话级模型：发布/创作最小单位是「话」（≈15 格），
 *     page 只是内部批次。助手话术与左侧工作台（季蓝图→季骨架→逐季话目→逐话出图）
 *     完全同构，所有面向用户的文案不再出现"页"。
 */

import type {
  AgentStage,
  ChatMessage,
  Series,
  Worldview,
  SeriesCharacter,
  Chapter,
  Arc,
  SeriesPage,
} from '../types';
import {
  generateWorldview,
  generateCharacters,
  generateChapters,
  breakdownPage,
  generatePage,
  regeneratePage,
  rewritePage,
  continueNextPage,
} from './seriesClient';

// ──────────────────────────────────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────────────────────────────────

const newId = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36));

const ts = () => Date.now();

const userMsg = (text: string): ChatMessage => ({ id: newId(), role: 'user', text, ts: ts() });
const agentMsg = (text: string, extras: Partial<ChatMessage> = {}): ChatMessage => ({
  id: newId(),
  role: 'agent',
  text,
  ts: ts(),
  ...extras,
});
const systemMsg = (text: string): ChatMessage => ({ id: newId(), role: 'system', text, ts: ts() });

/** 简单规则匹配"通过 / 重新生成 / 修改"语义。 */
function detectIntent(text: string): {
  approve?: boolean;
  regenerate?: boolean;
  intent?: string;
  isFreeform: boolean;
} {
  const t = text.trim().toLowerCase();
  if (/^(好|ok|okay|可以|通过|没问题|yes|继续|下一|next|approve|accept|✓)$/i.test(t)) {
    return { approve: true, isFreeform: false };
  }
  if (/^(重做|重来|重新生成|重新来|regen|retry|again|再试)$/i.test(t)) {
    return { regenerate: true, isFreeform: false };
  }
  return { intent: text.trim(), isFreeform: true };
}

/** "删除 X" / "改成 X" 的轻量语义。
 * 注意：画风 (style) 已从 Series 整体移除，改为创建时锁定的 DNA —— 不可在运行时变更。
 * 因此不再支持"画风改 X"指令；用户若需要换画风，需要新建一个系列。
 */
function detectMutation(text: string): { action: 'delete' | 'rename'; target?: string; value?: string } | null {
  const t = text.trim();
  const m = t.match(/^删除\s*(.+)$/);
  if (m) return { action: 'delete', target: m[1].trim() };
  const r = t.match(/^(?:把|将)\s*(.+?)\s*(?:改名|改名为|叫做)\s*(.+)$/);
  if (r) return { action: 'rename', target: r[1].trim(), value: r[2].trim() };
  return null;
}

// ──────────────────────────────────────────────────────────────────────────
// 引擎主类
// ──────────────────────────────────────────────────────────────────────────
export class AgentEngine {
  constructor() {
    // 无参数；deps 通过 setDeps() 注入（getter 形式避免闭包陷阱）。
  }
  private messages: ChatMessage[] = [];
  private stage: AgentStage = 'idle';
  private listeners: Array<() => void> = [];

  // 引擎所需的 SeriesContext 子集（由 React 层注入，全部为 getter 形式以避免闭包陷阱）。
  private getSeries: () => Series | null;
  private ensureSeries: (input: { title: string; logline: string }) => Promise<Series>;
  private patchSeries: (patch: Partial<Pick<Series, 'title' | 'logline'>>) => Promise<Series | null>;
  private genWorldview: (hint?: string) => Promise<Worldview | null>;
  private genCharacters: (hint?: string) => Promise<SeriesCharacter[] | null>;
  private genChapters: (target?: number) => Promise<Chapter[] | null>;
  private breakdownPage: (pageId: string) => Promise<SeriesPage | null>;
  private generatePage: (pageId: string) => Promise<SeriesPage | null>;
  private regeneratePage: (pageId: string) => Promise<SeriesPage | null>;
  private rewritePage: (pageId: string, instruction: string) => Promise<SeriesPage | null>;
  private continueNextPage: (pageId: string) => Promise<SeriesPage | null>;
  private deleteCharacter: (id: string) => Promise<void>;
  private selectPage: (id: string | null) => void;
  private getSelectedPageId: () => string | null;
  // —— 话级模型（2026-09-02） ——
  private genArcs: () => Promise<Arc[] | null>;
  private genArcChapters: (arcId: string, opts?: { targetPageCount?: number; hint?: string }) => Promise<Chapter[] | null>;
  private generatePanel: (pageId: string, panelIndex: number) => Promise<SeriesPage | null>;
  private selectEpisode: (chapterId: string | null) => void;
  private getSelectedEpisodeId: () => string | null;

  /** 一组 dep 函数。React 层每次重渲染都重新构造 deps 并调用此方法。 */
  setDeps(deps: {
    getSeries: () => Series | null;
    ensureSeries: (input: { title: string; logline: string }) => Promise<Series>;
    patchSeries: (patch: Partial<Pick<Series, 'title' | 'logline'>>) => Promise<Series | null>;
    genWorldview: (hint?: string) => Promise<Worldview | null>;
    genCharacters: (hint?: string) => Promise<SeriesCharacter[] | null>;
    genChapters: (target?: number) => Promise<Chapter[] | null>;
    breakdownPage: (pageId: string) => Promise<SeriesPage | null>;
    generatePage: (pageId: string) => Promise<SeriesPage | null>;
    regeneratePage: (pageId: string) => Promise<SeriesPage | null>;
    rewritePage: (pageId: string, instruction: string) => Promise<SeriesPage | null>;
    continueNextPage: (pageId: string) => Promise<SeriesPage | null>;
    deleteCharacter: (id: string) => Promise<void>;
    selectPage: (id: string | null) => void;
    getSelectedPageId: () => string | null;
    genArcs: () => Promise<Arc[] | null>;
    genArcChapters: (arcId: string, opts?: { targetPageCount?: number; hint?: string }) => Promise<Chapter[] | null>;
    generatePanel: (pageId: string, panelIndex: number) => Promise<SeriesPage | null>;
    selectEpisode: (chapterId: string | null) => void;
    getSelectedEpisodeId: () => string | null;
  }) {
    this.getSeries = deps.getSeries;
    this.ensureSeries = deps.ensureSeries;
    this.patchSeries = deps.patchSeries;
    this.genWorldview = deps.genWorldview;
    this.genCharacters = deps.genCharacters;
    this.genChapters = deps.genChapters;
    this.breakdownPage = deps.breakdownPage;
    this.generatePage = deps.generatePage;
    this.regeneratePage = deps.regeneratePage;
    this.rewritePage = deps.rewritePage;
    this.continueNextPage = deps.continueNextPage;
    this.deleteCharacter = deps.deleteCharacter;
    this.selectPage = deps.selectPage;
    this.getSelectedPageId = deps.getSelectedPageId;
    this.genArcs = deps.genArcs;
    this.genArcChapters = deps.genArcChapters;
    this.generatePanel = deps.generatePanel;
    this.selectEpisode = deps.selectEpisode;
    this.getSelectedEpisodeId = deps.getSelectedEpisodeId;
  }

  // ── 订阅 ──
  subscribe(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter(l => l !== fn); };
  }
  private emit() { this.listeners.forEach(fn => fn()); }

  getMessages(): ChatMessage[] { return this.messages; }
  getStage(): AgentStage { return this.stage; }

  /** 兼容 arcs（新结构）+ chapters（旧结构）的话目平铺。 */
  private flattenEpisodes(s: Series | null): Chapter[] {
    if (!s) return [];
    return s.arcs && s.arcs.length > 0 ? s.arcs.flatMap(a => a.chapters ?? []) : (s.chapters ?? []);
  }

  /** 根据季蓝图/已有结构计算推荐话数（每话一件完整的事，约 15 格）。 */
  private getEpisodePlan(): { totalEpisodes: number; source: 'arcBlueprints' | 'arcs' | 'chapters' | 'default' } {
    const s = this.getSeries();
    if (!s) return { totalEpisodes: 6, source: 'default' };

    if (s.worldview?.arcBlueprints && s.worldview.arcBlueprints.length > 0) {
      return { totalEpisodes: s.worldview.arcBlueprints.reduce((sum, a) => sum + a.plannedChapterCount, 0), source: 'arcBlueprints' };
    }
    if (s.arcs && s.arcs.length > 0) {
      const planned = s.arcs.reduce((sum, a) => sum + (a.plannedChapterCount ?? 0), 0)
        || s.arcs.reduce((sum, a) => sum + a.chapters.length, 0);
      return { totalEpisodes: planned, source: 'arcs' };
    }
    if (s.chapters && s.chapters.length > 0) {
      return { totalEpisodes: s.chapters.length, source: 'chapters' };
    }
    return { totalEpisodes: 6, source: 'default' };
  }

  /** 话级进度汇总：共 X 话 / Y 格 / 已生成 Z 格。 */
  private getEpisodeProgress(): { episodes: Chapter[]; totalPanels: number; donePanels: number } {
    const episodes = this.flattenEpisodes(this.getSeries());
    let totalPanels = 0;
    let donePanels = 0;
    for (const ch of episodes) {
      for (const p of ch.pages) {
        for (const pn of p.panels) {
          totalPanels++;
          if (pn.imageUrl) donePanels++;
        }
      }
    }
    return { episodes, totalPanels, donePanels };
  }

  /** 切换系列时重置内部状态。 */
  reset(): void {
    this.messages = [];
    this.stage = 'idle';
    this.emit();
  }

  /** 让 Agent 主动打个招呼（用于切换到空系列 / 首次进入）。 */
  greet(): void {
    const s = this.getSeries();
    if (!s) {
      this.stage = 'awaiting_logline';
      this.messages = [
        agentMsg(
          '你好！我是你的漫画创作助手 🤖。先告诉我你想画什么样的故事？\n\n' +
          '比如：「标题 **雾都孤儿 2049**；一句话简介 **一名被扫地出门的少年侦探在赛博朋克城市里追查父亲失踪案**；画风 **日式赛博朋克**」\n\n' +
          '随时少打字也行，我会尽量从你的话里猜。',
        ),
      ];
      this.emit();
      return;
    }
    // 已有系列 —— 根据当前进度选择开场白。
    // P0-2：不再自动触发生成（快速切换系列会产生飞行中的并发生成任务，
    // 与用户主动操作交错导致数据竞态）。改为发确认消息，用户点头才开始。
    if (!s.worldview) {
      this.stage = 'reviewing_worldview';
      this.messages = [
        agentMsg(`欢迎回到 **${s.title}**。这个系列还没有世界观设定 —— 回复「**开始**」我就生成，或者直接说出你的想法（我会当作修改意见）。`),
      ];
      this.emit();
    } else if (s.characters.length === 0) {
      this.stage = 'reviewing_characters';
      this.messages = [
        agentMsg(`欢迎回到 **${s.title}**。世界观已就绪，还差角色设定 —— 回复「**开始**」我就生成核心角色（主角 + 配角 + 反派），也可以先说说你的要求。`),
      ];
      this.emit();
    } else if (this.flattenEpisodes(s).length === 0) {
      this.stage = 'reviewing_chapters';
      const plan = this.getEpisodePlan();
      let hint = '';
      if (plan.source === 'arcBlueprints' && s.worldview?.arcBlueprints) {
        const arcSummary = s.worldview.arcBlueprints.map(a => `${a.title}（${a.plannedChapterCount} 话）`).join('、');
        hint = `你的季蓝图规划了 ${s.worldview.arcBlueprints.length} 季共 **${plan.totalEpisodes} 话**（${arcSummary}），每话一件完整的事、约 15 格。`;
      } else if (plan.source === 'arcs' && s.arcs) {
        hint = `已规划 ${s.arcs.length} 季共 **${plan.totalEpisodes} 话**，每话一件完整的事、约 15 格。`;
      } else {
        hint = `推荐先规划 **${plan.totalEpisodes} 话** 左右（每话一件完整的事，约 15 格）。`;
      }
      this.messages = [
        agentMsg(`角色已确认 ✅。接下来规划话目：${hint}\n\n直接说「**开始拆分**」我就按规划拆出每话大纲；也可以说「**拆 8 话**」指定话数。`),
      ];
      this.emit();
    } else {
      this.stage = 'producing_pages';
      const { episodes, totalPanels, donePanels } = this.getEpisodeProgress();
      const missing = totalPanels - donePanels;
      const curIdx = episodes.findIndex(c => c.id === this.getSelectedEpisodeId());
      this.messages = [
        agentMsg(`欢迎回到 **${s.title}**。目前共 **${episodes.length}** 话、**${totalPanels}** 格，已生成 **${donePanels}** 格${missing > 0 ? `，还缺 **${missing}** 格` : '（全部完成 🎉）'}。${curIdx >= 0 ? `左侧正看着第 ${curIdx + 1} 话《${episodes[curIdx].title}》。` : ''}\n` +
          '可以对我说：\n' +
          '• 「**出图第 X 话**」—— 补齐该话缺图（已有图不会重画）\n' +
          '• 「**自动跑**」—— 从当前话起依次跑完全部\n' +
          '• 「**重出第 N 格**」—— 重画当前话第 N 格\n' +
          '• 「**续写本话**」—— 基于剧情追加约 6 格\n' +
          '• 「**跳到第 X 话**」—— 切换左侧话卡片'),
      ];
      this.emit();
    }
  }

  /** 用户发了一条消息。引擎把它当指令解析并执行。 */
  async onUserMessage(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.messages.push(userMsg(trimmed));
    this.emit();

    // 全局指令
    if (/^(清空对话|reset|清除|重新开始)$/i.test(trimmed)) {
      this.messages = [systemMsg('对话已清空。')];
      this.emit();
      return;
    }

    // 没有当前系列 → 进入灵感阶段
    if (!this.getSeries()) {
      await this.handleLoglinePhase(trimmed);
      return;
    }

    // 全局 mutation
    const mutation = detectMutation(trimmed);
    if (mutation) {
      await this.handleMutation(mutation);
      return;
    }

    // 阶段相关
    switch (this.stage) {
      case 'awaiting_logline':
        await this.handleLoglinePhase(trimmed);
        return;
      case 'reviewing_worldview': {
        const intent = detectIntent(trimmed);
        if (intent.approve) {
          await this.approveWorldview();
          return;
        }
        if (intent.regenerate) {
          await this.runGenerateWorldview();
          return;
        }
        // 还没有世界观时，「开始/生成」= 首次生成
        if (!this.getSeries()?.worldview && /^(开始|开始生成|生成|go|start)$/i.test(trimmed)) {
          await this.runGenerateWorldview();
          return;
        }
        // 自由文本：当作"修改意见"，让 AI 重新生成并应用（hint 会进入后端 prompt）
        await this.regenerateWorldviewWithHint(trimmed);
        return;
      }
      case 'reviewing_characters': {
        const intent = detectIntent(trimmed);
        if (intent.approve) {
          await this.approveCharacters();
          return;
        }
        if (intent.regenerate) {
          await this.runGenerateCharacters();
          return;
        }
        // 还没有角色时，「开始/生成」= 首次生成
        if ((this.getSeries()?.characters.length ?? 0) === 0 && /^(开始|开始生成|生成|go|start)$/i.test(trimmed)) {
          await this.runGenerateCharacters();
          return;
        }
        await this.regenerateCharactersWithHint(trimmed);
        return;
      }
      case 'reviewing_chapters': {
        const hasChapters = this.flattenEpisodes(this.getSeries()).length > 0;
        const intent = detectIntent(trimmed);
        // 有话目时「通过」= 确认大纲进入逐话；还没话目时「通过/开始拆分」= 先拆
        if (intent.approve) {
          if (hasChapters) {
            await this.approveChapters();
          } else {
            await this.runGenerateChapters();
          }
          return;
        }
        if (intent.regenerate) {
          if (hasChapters) {
            this.messages.push(agentMsg('好，重新规划话目大纲。'));
            this.emit();
          }
          await this.runGenerateChapters();
          return;
        }
        // 「开始拆分 / 开始」
        if (/^(开始拆分|开始|拆分|拆章节|生成话目|go|start)$/i.test(trimmed)) {
          await this.runGenerateChapters();
          return;
        }
        // 指定话数（"拆 8 话"）；有话目时自由文本默认当作确认进入逐话
        const epCount = this.parseEpisodeCount(trimmed);
        if (epCount) {
          await this.runGenerateChapters(epCount);
          return;
        }
        if (hasChapters) {
          await this.approveChapters();
          return;
        }
        await this.runGenerateChapters();
        return;
      }
      case 'producing_pages': {
        await this.handleProducingPhase(trimmed);
        return;
      }
      default:
        this.messages.push(agentMsg('收到。可以输入「开始」让我带你从头创建；或点击左侧项目继续。'));
        this.emit();
    }
  }

  // ── 用户快捷按钮 ──
  /** 「通过」：有可审阅产物时确认进入下一阶段；无产物时按规划开始拆分。 */
  async approveCurrent(): Promise<void> {
    if (this.stage === 'reviewing_worldview') return this.approveWorldview();
    if (this.stage === 'reviewing_characters') return this.approveCharacters();
    if (this.stage === 'reviewing_chapters') {
      if (this.flattenEpisodes(this.getSeries()).length > 0) return this.approveChapters();
      return this.runGenerateChapters();
    }
  }
  async regenerateCurrent(): Promise<void> {
    if (this.stage === 'reviewing_worldview') return this.runGenerateWorldview();
    if (this.stage === 'reviewing_characters') return this.runGenerateCharacters();
    if (this.stage === 'reviewing_chapters') return this.runGenerateChapters();
  }

  // ── 各阶段实现 ──

  /** 解析并执行一句话简介 → 创建系列 → 生成世界观。 */
  private async handleLoglinePhase(text: string): Promise<void> {
    const { title, logline } = parseLogline(text);
    if (!title || !logline) {
      this.messages.push(agentMsg(
        '我没识别到标题或简介 😕。可以这样写：\n\n' +
        '「标题 **XXX**；简介 **YYY**」\n\n' +
        '画风请在左侧工作台创建系列时选择 DNA（创建后不可更改）。',
      ));
      this.emit();
      return;
    }
    this.messages.push(agentMsg(`好的，我来创建：**${title}**\n简介：${logline}`));
    this.emit();
    try {
      await this.ensureSeries({ title, logline });
      this.messages.push(agentMsg('项目已创建 ✅。现在我开始生成世界观，请稍候 30-60 秒……'));
      this.emit();
      await this.runGenerateWorldview();
    } catch (e: any) {
      this.messages.push(agentMsg(`创建失败：${e.message || e}`, { error: e.message || String(e) }));
      this.emit();
    }
  }

  private async runGenerateWorldview(hint?: string): Promise<void> {
    this.stage = 'reviewing_worldview';
    this.messages.push(agentMsg(hint ? '正在按你的意见重新生成世界观…' : '正在生成世界观…', { pending: true }));
    this.emit();
    try {
      const w = await this.genWorldview(hint);
      // 移除 pending
      this.messages = this.messages.filter(m => !m.pending);
      if (!w) throw new Error('生成世界观失败');
      this.messages.push(agentMsg(
        hint ? '已按你的意见重新生成世界观。请审阅：' : '这是根据你的简介生成的世界观。请审阅：',
        { card: { kind: 'worldview', worldview: w } },
      ));
      this.emit();
    } catch (e: any) {
      this.messages = this.messages.filter(m => !m.pending);
      this.messages.push(agentMsg(`生成世界观失败：${e.message || e}`, { error: e.message || String(e) }));
      this.emit();
    }
  }

  private async regenerateWorldviewWithHint(hint: string): Promise<void> {
    this.messages.push(agentMsg(`好，按你说的偏好重新生成：${hint}`));
    this.emit();
    await this.runGenerateWorldview(hint);
  }

  private async approveWorldview(): Promise<void> {
    this.stage = 'reviewing_characters';
    this.messages.push(agentMsg('世界观已确认 ✅。我开始生成 3-4 个核心角色，请稍候…'));
    this.emit();
    await this.runGenerateCharacters();
  }

  private async runGenerateCharacters(hint?: string): Promise<void> {
    this.stage = 'reviewing_characters';
    this.messages.push(agentMsg(hint ? '正在按你的意见重新生成角色（每个角色会附带参考图）…' : '正在生成角色（每个角色会附带参考图）…', { pending: true }));
    this.emit();
    try {
      const chars = await this.genCharacters(hint);
      this.messages = this.messages.filter(m => !m.pending);
      if (!chars || chars.length === 0) throw new Error('生成角色失败');
      this.messages.push(agentMsg(
        hint ? `已按你的意见重新生成了 **${chars.length}** 个角色。请审阅：` : `生成了 **${chars.length}** 个核心角色。请审阅：`,
        { card: { kind: 'characters', characters: chars } },
      ));
      this.emit();
    } catch (e: any) {
      this.messages = this.messages.filter(m => !m.pending);
      this.messages.push(agentMsg(`生成角色失败：${e.message || e}`, { error: e.message || String(e) }));
      this.emit();
    }
  }

  private async regenerateCharactersWithHint(hint: string): Promise<void> {
    this.messages.push(agentMsg(`好，按你的反馈重做：${hint}`));
    this.emit();
    await this.runGenerateCharacters(hint);
  }

  private async approveCharacters(): Promise<void> {
    this.stage = 'reviewing_chapters';
    const plan = this.getEpisodePlan();
    const prefix = plan.source === 'arcBlueprints' ? '季蓝图共规划' : '推荐';
    this.messages.push(agentMsg(
      `角色已确认 ✅。接下来规划话目：${prefix} **${plan.totalEpisodes} 话**（每话一件完整的事，约 15 格）。\n` +
      `直接回复「**开始拆分**」按规划处理，或说「**拆 8 话**」指定话数。`,
    ));
    this.emit();
  }

  /**
   * 规划话目大纲。与左侧工作台同构：
   *   季蓝图就绪 → 物化季骨架 → 逐季生成话目；已有 arcs → 补齐空季；否则走旧版直接拆章。
   * episodesHint：用户指定的话数（仅旧结构路径用于换算目标页数，每话 ≈ 2 页 ≈ 15 格）。
   */
  private async runGenerateChapters(episodesHint?: number): Promise<void> {
    const s = this.getSeries();
    if (!s) return;
    this.stage = 'reviewing_chapters';
    this.messages.push(agentMsg('正在规划话目大纲…', { pending: true }));
    this.emit();
    try {
      // 路由 1：蓝图就绪但还没季骨架 → 先物化季骨架（同左侧「生成季骨架」）
      let arcs = s.arcs && s.arcs.length > 0 ? s.arcs : null;
      const blueprints = s.worldview?.arcBlueprints ?? [];
      if (!arcs && blueprints.length > 0) {
        this.messages.push(agentMsg(`按蓝图物化 **${blueprints.length}** 个季骨架…`, { pending: true }));
        this.emit();
        const generated = await this.genArcs();
        if (!generated || generated.length === 0) throw new Error('生成季骨架失败');
        arcs = generated;
      }

      let all: Chapter[] = [];
      // 路由 2：有 arcs → 逐季生成话目（同左侧「生成本章话目」）
      if (arcs && arcs.length > 0) {
        for (const arc of arcs) {
          if (arc.chapters.length > 0) {
            all.push(...arc.chapters);
            continue;
          }
          // 每话 ≈ 2 页（15 格）；plannedChapterCount 缺省按 2 话
          const target = Math.max(2, (arc.plannedChapterCount ?? 2) * 2);
          const chs = await this.genArcChapters(arc.id, { targetPageCount: target });
          if (chs && chs.length > 0) all.push(...chs);
        }
      } else {
        // 路由 3：旧结构直接拆章
        const target = episodesHint ? Math.max(2, episodesHint * 2) : 12;
        const chs = await this.genChapters(target);
        if (chs) all = chs;
      }

      this.messages = this.messages.filter(m => !m.pending);
      if (all.length === 0) throw new Error('生成话目失败');
      const totalPanels = all.reduce((sum, c) => sum + c.pages.reduce((n, p) => n + p.panels.length, 0), 0);
      this.messages.push(agentMsg(
        `话目大纲出来了：共 **${all.length}** 话 / 约 **${totalPanels}** 格。请审阅：`,
        { card: { kind: 'chapters', chapters: all } },
      ));
      this.emit();
    } catch (e: any) {
      this.messages = this.messages.filter(m => !m.pending);
      this.messages.push(agentMsg(`生成话目失败：${e.message || e}`, { error: e.message || String(e) }));
      this.emit();
    }
  }

  private async approveChapters(): Promise<void> {
    this.stage = 'producing_pages';
    const episodes = this.flattenEpisodes(this.getSeries());
    const first = episodes[0];
    if (first) this.selectEpisode(first.id);
    this.messages.push(agentMsg(
      (first ? `话目大纲已确认 ✅。已为你定位到 **第 1 话《${first.title}》**。\n` : '话目大纲已确认 ✅。\n') +
      '现在可以：\n' +
      '• 说「**拆解分镜**」拆当前批的分镜\n' +
      '• 说「**出图第 1 话**」整话补图（已有图不重画）\n' +
      '• 说「**自动跑**」从第 1 话开始连跑\n' +
      '• 说「**跳到第 X 话**」切换话卡片',
    ));
    this.emit();
  }

  // ── 逐话生成阶段：自然语言指令 ──

  private async handleProducingPhase(text: string): Promise<void> {
    const s = this.getSeries();
    if (!s) {
      // 不太可能走到这
      this.stage = 'awaiting_logline';
      this.greet();
      return;
    }
    const { episodes, totalPanels, donePanels } = this.getEpisodeProgress();
    const t = text.trim();

    // 跳到第 X 话
    const jump = t.match(/^(?:跳到|打开|切到|去|go to)?\s*第?\s*(\d+)\s*话$/);
    if (jump) {
      const idx = parseInt(jump[1], 10) - 1;
      const ch = episodes[idx];
      if (ch) {
        this.selectEpisode(ch.id);
        const epPanels = ch.pages.reduce((n, p) => n + p.panels.length, 0);
        const epDone = ch.pages.reduce((n, p) => n + p.panels.filter(pn => pn.imageUrl).length, 0);
        this.messages.push(agentMsg(`已切到 **第 ${idx + 1} 话《${ch.title}》**（已生成 ${epDone}/${epPanels} 格），左侧卡片已同步。`));
        this.emit();
      } else {
        this.messages.push(agentMsg(`目前共 ${episodes.length} 话，没有第 ${idx + 1} 话。`));
        this.emit();
      }
      return;
    }

    // 出图/生成 第 X 话（整话增量补图）
    const genEp = t.match(/^(?:出图|生成|画|跑完?)\s*第?\s*(\d+)\s*话$/);
    if (genEp) {
      const idx = parseInt(genEp[1], 10) - 1;
      const ch = episodes[idx];
      if (!ch) {
        this.messages.push(agentMsg(`目前共 ${episodes.length} 话，没有第 ${idx + 1} 话。`));
        this.emit();
        return;
      }
      this.selectEpisode(ch.id);
      await this.runGenerateEpisode(idx, ch);
      return;
    }

    // 自动跑 [N 话]
    const auto = t.match(/^(?:自动跑|连续跑|跑完|一直跑)\s*(\d+)?\s*话?$/);
    if (auto) {
      const n = auto[1] ? parseInt(auto[1], 10) : episodes.length;
      if (totalPanels === 0) {
        this.messages.push(agentMsg('还没有话目分镜。先说「开始拆分」规划话目。'));
        this.emit();
        return;
      }
      const missing = totalPanels - donePanels;
      this.messages.push(agentMsg(
        missing > 0
          ? `好的，从当前话起跑 **最多 ${n}** 话，共缺 **${missing}** 格。出图较慢（每格 ~40s），你可以挂着去做别的事，我会按话汇报进度。`
          : '目前全部格都已完成，没有需要跑的。可以说「续写本话」追加剧情。',
      ));
      this.emit();
      await this.autoRunEpisodes(n);
      return;
    }

    // 生成/重出 第 N 格（相对当前话的整话连续格号）
    const panelGen = t.match(/^(?:生成|重出|重画|画)\s*第?\s*(\d+)\s*格$/);
    if (panelGen) {
      const n = parseInt(panelGen[1], 10);
      const curEp = episodes.find(c => c.id === this.getSelectedEpisodeId())
        ?? episodes.find(c => c.pages.some(p => p.id === this.getSelectedPageId()));
      if (!curEp) {
        this.messages.push(agentMsg('先在左侧选一话（或说「跳到第 X 话」）再操作单格。'));
        this.emit();
        return;
      }
      const pages = [...curEp.pages].sort((a, b) => a.pageNumber - b.pageNumber);
      let acc = 0;
      let target: { pageId: string; panelIndex: number } | null = null;
      for (const pg of pages) {
        if (n > acc && n <= acc + pg.panels.length) {
          target = { pageId: pg.id, panelIndex: pg.panels.map(pn => pn.index).sort((a, b) => a - b)[n - acc - 1] };
          break;
        }
        acc += pg.panels.length;
      }
      if (!target) {
        this.messages.push(agentMsg(`《${curEp.title}》共 ${acc} 格，没有第 ${n} 格。`));
        this.emit();
        return;
      }
      this.messages.push(agentMsg(`正在重出《${curEp.title}》第 ${n} 格（只动这一格，约 40s）…`, { pending: true }));
      this.emit();
      try {
        await this.generatePanel(target.pageId, target.panelIndex);
        this.messages = this.messages.filter(m => !m.pending);
        this.messages.push(agentMsg(`✅ 第 ${n} 格已重出。不满意可以再来一次，或说「改这一格：xxx」换内容。`));
        this.emit();
      } catch (e: any) {
        this.messages = this.messages.filter(m => !m.pending);
        this.messages.push(agentMsg(`单格生成失败：${e.message || e}`, { error: e.message || String(e) }));
        this.emit();
      }
      return;
    }

    // —— 当前批（page）操作：沿用左侧选中状态 ——
    const pageId = this.getSelectedPageId();

    // 拆解分镜
    if (/^(拆解分镜|拆分分镜|拆镜|breakdown)$/i.test(t)) {
      if (!pageId) {
        this.messages.push(agentMsg('先在左侧选一话再拆解。'));
        this.emit();
        return;
      }
      await this.runBreakdownPage(pageId);
      return;
    }
    // 出图当前批（增量）
    if (/^(整页出图|出图|出图此批|生成此批|画这批|generate page)$/i.test(t)) {
      if (!pageId) {
        this.messages.push(agentMsg('先在左侧选一话。'));
        this.emit();
        return;
      }
      await this.runGenerateBatch(pageId);
      return;
    }
    // 重画当前批
    if (/^(重新生成|重画|重画此批|regen|再来)$/i.test(t)) {
      if (!pageId) {
        this.messages.push(agentMsg('先在左侧选一话。'));
        this.emit();
        return;
      }
      await this.runRegeneratePage(pageId);
      return;
    }
    // 续写本话
    if (/^(续写下一页|续写本话|续写|下一|next|continue)$/i.test(t)) {
      const curEp = episodes.find(c => c.id === this.getSelectedEpisodeId())
        ?? episodes.find(c => c.pages.some(p => p.id === pageId));
      const lastPage = curEp ? [...curEp.pages].sort((a, b) => a.pageNumber - b.pageNumber).slice(-1)[0] : null;
      if (!lastPage) {
        this.messages.push(agentMsg('先在左侧选一话再续写。'));
        this.emit();
        return;
      }
      await this.runContinueNextPage(lastPage.id);
      return;
    }
    // 用一句话改当前批
    const rewriteMatch = t.match(/^(?:改写|修改|改这批|改这一批|rewrite)[:：\s]+(.+)$/);
    if (rewriteMatch) {
      if (!pageId) {
        this.messages.push(agentMsg('先在左侧选一话再改。'));
        this.emit();
        return;
      }
      await this.runRewritePage(pageId, rewriteMatch[1]);
      return;
    }

    // 没匹配到具体指令 → 当作通用对话（带系列上下文）
    await this.askFreeformQuestion(t);
  }

  /** 解析"拆 N 话"的话数。 */
  private parseEpisodeCount(text: string): number | null {
    const m = text.match(/(\d+)\s*话/);
    if (m) return Math.max(1, Math.min(30, parseInt(m[1], 10)));
    return null;
  }

  /** 整话增量出图：缺格补齐、已有图不动。返回是否跑完（false = 中途失败）。 */
  private async runGenerateEpisode(epIdx: number, ch: Chapter): Promise<boolean> {
    this.selectEpisode(ch.id); // 左侧话卡片跟随
    const epPanels = ch.pages.reduce((n, p) => n + p.panels.length, 0);
    this.messages.push(agentMsg(`▶ 开始出图 **第 ${epIdx + 1} 话《${ch.title}》**（${epPanels} 格，每格 ~40s）…`, { pending: true }));
    this.emit();
    try {
      const pages = [...ch.pages].sort((a, b) => a.pageNumber - b.pageNumber);
      for (const pg of pages) {
        if (pg.panels.length === 0) {
          await this.breakdownPage(pg.id);
        }
        const fresh = this.flattenEpisodes(this.getSeries())
          .find(c => c.id === ch.id)?.pages.find(p => p.id === pg.id);
        if (fresh && fresh.panels.length > 0 && fresh.panels.every(pn => pn.imageUrl)) continue;
        const r = await this.generatePage(pg.id);
        if (!r) throw new Error('生成中断');
      }
      this.messages = this.messages.filter(m => !m.pending);
      const done = this.flattenEpisodes(this.getSeries())
        .find(c => c.id === ch.id)?.pages.reduce((n, p) => n + p.panels.filter(pn => pn.imageUrl).length, 0) ?? 0;
      this.messages.push(agentMsg(
        `✅ 第 ${epIdx + 1} 话《${ch.title}》出图完成（${done} 格）。可以说「**公众号预览**」去审阅，或「**重出第 N 格**」微调单格。`,
      ));
      this.emit();
      return true;
    } catch (e: any) {
      this.messages = this.messages.filter(m => !m.pending);
      const done = this.flattenEpisodes(this.getSeries())
        .find(c => c.id === ch.id)?.pages.reduce((n, p) => n + p.panels.filter(pn => pn.imageUrl).length, 0) ?? 0;
      this.messages.push(agentMsg(
        `第 ${epIdx + 1} 话出图中断（${e.message || e}）。已完成 ${done} 格，修好后说「**出图第 ${epIdx + 1} 话**」继续 —— 已有图不会重画。`,
        { error: e.message || String(e) },
      ));
      this.emit();
      return false;
    }
  }

  /** 自动跑：从当前话起逐话补齐缺图。 */
  private async autoRunEpisodes(n: number): Promise<void> {
    const { episodes } = this.getEpisodeProgress();
    if (episodes.length === 0) return;
    let startIdx = episodes.findIndex(c => c.id === this.getSelectedEpisodeId());
    if (startIdx < 0) startIdx = 0;
    let processed = 0;
    for (let i = startIdx; i < episodes.length && processed < n; i++, processed++) {
      const ok = await this.runGenerateEpisode(i, episodes[i]);
      if (!ok) {
        this.messages.push(agentMsg('已停下。修一下再继续？'));
        this.emit();
        return;
      }
    }
    const { totalPanels, donePanels } = this.getEpisodeProgress();
    this.messages.push(agentMsg(`🎉 跑完了 ${processed} 话。目前总进度 ${donePanels}/${totalPanels} 格。`));
    this.emit();
  }

  private async runBreakdownPage(pageId: string): Promise<void> {
    this.messages.push(agentMsg('正在拆解分镜…', { pending: true }));
    this.emit();
    try {
      const page = await this.breakdownPage(pageId);
      this.messages = this.messages.filter(m => !m.pending);
      if (!page) throw new Error('拆解失败');
      const ch = this.flattenEpisodes(this.getSeries()).find(c => c.pages.some(p => p.id === pageId));
      this.messages.push(agentMsg(
        `已拆出 **${page.panels.length}** 个分镜。请审阅：`,
        { card: { kind: 'page_preview', chapterTitle: ch?.title || '', page } },
      ));
      this.emit();
    } catch (e: any) {
      this.messages = this.messages.filter(m => !m.pending);
      this.messages.push(agentMsg(`拆解失败：${e.message || e}`, { error: e.message || String(e) }));
      this.emit();
    }
  }

  private async runGenerateBatch(pageId: string): Promise<void> {
    this.messages.push(agentMsg('正在出图当前批（增量：缺哪格补哪格，已有图不重画）…', { pending: true }));
    this.emit();
    try {
      const page = await this.generatePage(pageId);
      this.messages = this.messages.filter(m => !m.pending);
      if (!page) throw new Error('生成失败');
      const done = page.panels.filter(p => !!p.imageUrl).length;
      const allDone = page.panels.length > 0 && done === page.panels.length;
      this.messages.push(agentMsg(
        allDone
          ? `✅ 本批 ${page.panels.length} 格全部生成完成。还想调吗？可以说「**改写：xxx**」换内容，或「**重出第 N 格**」重画单格。`
          : `本批状态：${page.status}${page.errorMessage ? ` — ${page.errorMessage}` : ''}（已完成 ${done}/${page.panels.length} 格）`,
      ));
      this.emit();
    } catch (e: any) {
      this.messages = this.messages.filter(m => !m.pending);
      this.messages.push(agentMsg(`生成失败：${e.message || e}`, { error: e.message || String(e) }));
      this.emit();
    }
  }

  private async runRegeneratePage(pageId: string): Promise<void> {
    this.messages.push(agentMsg('正在重画当前批（整批全部重画）…', { pending: true }));
    this.emit();
    try {
      await this.regeneratePage(pageId);
      this.messages = this.messages.filter(m => !m.pending);
      this.messages.push(agentMsg('已重画完成。'));
      this.emit();
    } catch (e: any) {
      this.messages = this.messages.filter(m => !m.pending);
      this.messages.push(agentMsg(`重画失败：${e.message || e}`, { error: e.message || String(e) }));
      this.emit();
    }
  }

  private async runRewritePage(pageId: string, instruction: string): Promise<void> {
    this.messages.push(agentMsg(`好的，我会按「${instruction}」改这一批（内容+图都会更新）。`, { pending: true }));
    this.emit();
    try {
      await this.rewritePage(pageId, instruction);
      this.messages = this.messages.filter(m => !m.pending);
      this.messages.push(agentMsg('✅ 已按你的要求重写并出图。'));
      this.emit();
    } catch (e: any) {
      this.messages = this.messages.filter(m => !m.pending);
      this.messages.push(agentMsg(`改写失败：${e.message || e}`, { error: e.message || String(e) }));
      this.emit();
    }
  }

  private async runContinueNextPage(pageId: string): Promise<void> {
    this.messages.push(agentMsg('正在续写本话（基于已生成格 + 前文剧情，追加约 6 格）…', { pending: true }));
    this.emit();
    try {
      const page = await this.continueNextPage(pageId);
      this.messages = this.messages.filter(m => !m.pending);
      if (!page) throw new Error('续写失败');
      this.messages.push(agentMsg(`✅ 已为本话追加一批（${page.panels.length} 格），左侧已同步。可以继续「出图此批」补图。`));
      this.emit();
    } catch (e: any) {
      this.messages = this.messages.filter(m => !m.pending);
      this.messages.push(agentMsg(`续写失败：${e.message || e}`, { error: e.message || String(e) }));
      this.emit();
    }
  }

  private async askFreeformQuestion(text: string): Promise<void> {
    // 走文字生成接口，做"普通对话"。由前端调用 modelClient。带上系列实际进度，回答才不悬空。
    this.messages.push(agentMsg('正在思考…', { pending: true }));
    this.emit();
    try {
      const { generateText } = await import('./modelClient');
      const s = this.getSeries();
      const { episodes, totalPanels, donePanels } = this.getEpisodeProgress();
      const curIdx = episodes.findIndex(c => c.id === this.getSelectedEpisodeId());
      const ctxLine = s
        ? `当前系列「${s.title}」：世界观${s.worldview ? '已生成' : '未生成'}、角色 ${s.characters.length} 位、话目 ${episodes.length} 话、分镜已完成 ${donePanels}/${totalPanels} 格${curIdx >= 0 ? `、左侧正看着第 ${curIdx + 1} 话《${episodes[curIdx].title}》` : ''}。创作单位是「话」（每话一件完整的事，约 15 格），内部不分页。`
        : '尚未创建系列。';
      const r = await generateText({
        prompt: `你是一个漫画创作助手。${ctxLine}\n用户说：${text}\n\n用简短中文回答（不超过 120 字）。不要编造不存在的进度或功能；如果用户想要的操作你有对应指令（如「出图第 X 话」「重出第 N 格」「续写本话」），提示他说这句指令。`,
      }, 30000);
      this.messages = this.messages.filter(m => !m.pending);
      this.messages.push(agentMsg(r.text));
      this.emit();
    } catch (e: any) {
      this.messages = this.messages.filter(m => !m.pending);
      this.messages.push(agentMsg(`（暂时没法回答：${e.message || e}）`));
      this.emit();
    }
  }

  private async handleMutation(m: { action: 'delete' | 'rename'; target?: string; value?: string }): Promise<void> {
    const s = this.getSeries();
    if (!s) return;
    if (m.action === 'delete' && m.target) {
      const target = m.target;
      // 找匹配角色
      const ch = s.characters.find(c => c.name.includes(target));
      if (ch) {
        await this.deleteCharacter(ch.id);
        this.messages.push(agentMsg(`已删除角色 **${ch.name}**。`));
        this.emit();
        return;
      }
      this.messages.push(agentMsg(`没找到名为「${target}」的角色。可以试试「删除 林宇」这种格式。`));
      this.emit();
      return;
    }
    if (m.action === 'rename' && m.target && m.value) {
      const ch = s.characters.find(c => c.name.includes(m.target!));
      if (ch) {
        // 通过 SeriesContext.updateCharacterInCurrent
        // 这里我们没有直接的入口，借助 ensureSeries 的 patch 不支持 characters，
        // 所以走"通用 mutation" 通过 API 更新角色。
        // 让前端在 React 层另提供 update 入口较复杂，这里跳过并给出提示。
        this.messages.push(agentMsg('暂时不支持改角色名。请到左侧"角色"卡片上点击编辑。'));
        this.emit();
        return;
      }
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 解析一句话简介
// ──────────────────────────────────────────────────────────────────────────

/**
 * 把用户的一段话拆成 {title, logline}。
 * 支持：
 *   "标题 X；简介 Y"
 *   "我想画 X，标题是 Y"
 *   "X"（单句）
 * 画风不再从此处接受 —— 创建系列时由 DNA 选择器统一锁定（见 SeriesWorkbench / shared/types）。
 */
export function parseLogline(text: string): { title?: string; logline?: string } {
  // 1) "标题 **xxx**" / "标题：xxx" / "标题 xxx"
  const title = extract(text, /标题\s*[:：]?\s*\*?\*?\s*([^；;。\n]+?)(?=\s*(?:；|;|\n|简介|$))/, /标题\s*[:：]?\s*\*?\*?\s*(.+?)(?=\s|$)/);
  const logline = extract(text, /(?:简介|一句话故事)\s*[:：]?\s*\*?\*?\s*([^；;。\n]+?)(?=\s*(?:；|;|\n|$))/, /(?:简介|一句话故事)\s*[:：]?\s*\*?\*?\s*(.+?)(?=\s|$)/);

  if (title && logline) return { title: title.trim(), logline: logline.trim() };
  // 没有明确标记时，整段当作 logline，标题取前 12 字
  if (!title && !logline && text.length > 0) {
    const first = text.split(/[。\n;；]/)[0].trim();
    return { title: first.slice(0, 12) || '未命名系列', logline: text.trim() };
  }
  return { title: title?.trim(), logline: logline?.trim() };
}

function extract(text: string, primary: RegExp, fallback?: RegExp): string | undefined {
  const m = text.match(primary);
  if (m && m[1]) return m[1].replace(/\*+/g, '').trim();
  if (fallback) {
    const m2 = text.match(fallback);
    if (m2 && m2[1]) return m2[1].replace(/\*+/g, '').trim();
  }
  return undefined;
}