/**
 * Agent 引擎 —— 聊天驱动创作流程的状态机
 *
 * 设计原则：
 *   - 用户在聊天框里的每条消息是一条"指令"。Agent 解析后调用现有的
 *     SeriesContext API（已经在用），并把阶段性产物以"内嵌审核卡"形式
 *     推回聊天。
 *   - 4 个关键节点（世界观 / 角色 / 章节大纲 / 逐页分镜）必须停下来
 *     等用户确认；其他过程自动推进。
 *   - 用户可以随时输入"修改为..."、"重新生成"、"删除 X"、"重新写一遍
 *     第 3 章第 2 页" 等自然语言指令；引擎做最宽松的语义匹配。
 */

import type {
  AgentStage,
  ChatMessage,
  Series,
  Worldview,
  SeriesCharacter,
  Chapter,
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
  }

  // ── 订阅 ──
  subscribe(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter(l => l !== fn); };
  }
  private emit() { this.listeners.forEach(fn => fn()); }

  getMessages(): ChatMessage[] { return this.messages; }
  getStage(): AgentStage { return this.stage; }

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
    } else if (s.chapters.length === 0) {
      this.stage = 'reviewing_chapters';
      this.messages = [
        agentMsg(`角色已确认。请告诉我你的总页数（推荐 8-20 页），或者直接说「开始拆分章节」。我会按页数自动拆章节。`),
      ];
      this.emit();
    } else {
      this.stage = 'producing_pages';
      this.messages = [
        agentMsg(`欢迎回到 **${s.title}**。所有准备工作已完成，可以开始逐页生成了。\n` +
          '从左侧选一页，告诉我「拆解分镜」或「整页出图」，我都能执行。\n' +
          '也可以说「全部自动跑」让我按顺序把所有草稿出完。'),
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
        const intent = detectIntent(trimmed);
        if (intent.approve) {
          await this.approveChapters();
          return;
        }
        if (intent.regenerate) {
          await this.runGenerateChapters(this.parsePageCount(trimmed) ?? 12);
          return;
        }
        const pc = this.parsePageCount(trimmed);
        await this.runGenerateChapters(pc ?? 12);
        return;
      }
      case 'producing_pages': {
        await this.handleProducingPhase(trimmed);
        return;
      }
      default:
        this.messages.push(agentMsg('收到。你可以输入「开始」让我带你从头创建；或点击左侧项目继续。'));
        this.emit();
    }
  }

  // ── 用户快捷按钮 ──
  async approveCurrent(): Promise<void> {
    if (this.stage === 'reviewing_worldview') return this.approveWorldview();
    if (this.stage === 'reviewing_characters') return this.approveCharacters();
    if (this.stage === 'reviewing_chapters') return this.approveChapters();
  }
  async regenerateCurrent(): Promise<void> {
    if (this.stage === 'reviewing_worldview') return this.runGenerateWorldview();
    if (this.stage === 'reviewing_characters') return this.runGenerateCharacters();
    if (this.stage === 'reviewing_chapters') return this.runGenerateChapters(12);
  }

  // ── 各阶段实现 ──

  private async handleLoglinePhase(text: string): Promise<void> {
    // 解析一句话里的标题 / 简介（画风已统一由创建系列时的 DNA 预设锁定，不再从聊天中接受）
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
    this.messages.push(agentMsg(
      '角色已确认 ✅。请告诉我**总页数**（推荐 8-20 页），我会自动拆章节。\n' +
      '或者直接回复「开始拆分」按默认 12 页处理。',
    ));
    this.emit();
  }

  private async runGenerateChapters(target = 12): Promise<void> {
    this.stage = 'reviewing_chapters';
    this.messages.push(agentMsg(`正在按 **${target}** 页拆分章节…`, { pending: true }));
    this.emit();
    try {
      const chs = await this.genChapters(target);
      this.messages = this.messages.filter(m => !m.pending);
      if (!chs || chs.length === 0) throw new Error('生成章节失败');
      const totalPages = chs.reduce((sum, c) => sum + c.pages.length, 0);
      this.messages.push(agentMsg(
        `生成了 **${chs.length}** 个章节，共 **${totalPages}** 页。请审阅：`,
        { card: { kind: 'chapters', chapters: chs } },
      ));
      this.emit();
    } catch (e: any) {
      this.messages = this.messages.filter(m => !m.pending);
      this.messages.push(agentMsg(`生成章节失败：${e.message || e}`, { error: e.message || String(e) }));
      this.emit();
    }
  }

  private async approveChapters(): Promise<void> {
    this.stage = 'producing_pages';
    // 自动跳到第一页
    const s = this.getSeries();
    const firstPage = s?.chapters?.[0]?.pages?.[0];
    if (firstPage) this.selectPage(firstPage.id);
    this.messages.push(agentMsg(
      '章节大纲已确认 ✅。已经为你跳到 **第 1 章 第 1 页**。\n' +
      '现在可以：\n' +
      '• 说「**拆解分镜**」让我拆这页的分镜\n' +
      '• 说「**整页出图**」直接出整页图\n' +
      '• 说「**自动跑 N 页**」让我连出 N 页\n' +
      '• 说「**跳到第 X 页**」切到指定页',
    ));
    this.emit();
  }

  // ── 逐页生成阶段：自然语言指令 ──

  private async handleProducingPhase(text: string): Promise<void> {
    const s = this.getSeries();
    if (!s) {
      // 不太可能走到这
      this.stage = 'awaiting_logline';
      this.greet();
      return;
    }
    const pageId = this.getSelectedPageId();
    const t = text.trim();

    // 跳页
    const jump = t.match(/^(?:跳到|打开|切到|去|go to)?\s*第?\s*(\d+)\s*页$/);
    if (jump) {
      const idx = parseInt(jump[1], 10) - 1;
      const allPages = s.chapters.flatMap(c => c.pages);
      if (allPages[idx]) {
        this.selectPage(allPages[idx].id);
        this.messages.push(agentMsg(`已跳到第 ${idx + 1} 页。`));
        this.emit();
      } else {
        this.messages.push(agentMsg(`只有 ${allPages.length} 页，没有第 ${idx + 1} 页。`));
        this.emit();
      }
      return;
    }

    // 自动跑 N 页
    const auto = t.match(/^(?:自动跑|连续跑|跑完|一直跑)\s*(\d+)?\s*页?$/);
    if (auto) {
      const n = auto[1] ? parseInt(auto[1], 10) : 999;
      this.messages.push(agentMsg(`好的，我会从当前页起跑 **最多 ${n}** 页。出图可能较慢（每页 2-6 分钟），你可以挂着去做别的事，我会汇报每页的进度。`));
      this.emit();
      await this.autoRunPages(n);
      return;
    }

    // 拆解分镜
    if (/^(拆解分镜|拆分分镜|拆镜|breakdown)$/i.test(t)) {
      if (!pageId) {
        this.messages.push(agentMsg('先选一页再拆解。'));
        this.emit();
        return;
      }
      await this.runBreakdownPage(pageId);
      return;
    }
    // 整页出图
    if (/^(整页出图|出图|生成页面|画这页|generate page)$/i.test(t)) {
      if (!pageId) {
        this.messages.push(agentMsg('先选一页。'));
        this.emit();
        return;
      }
      await this.runGeneratePage(pageId);
      return;
    }
    // 重生
    if (/^(重新生成|重画|regen|再来)$/i.test(t)) {
      if (!pageId) {
        this.messages.push(agentMsg('先选一页。'));
        this.emit();
        return;
      }
      await this.runRegeneratePage(pageId);
      return;
    }
    // 续写下一页
    if (/^(续写下一页|下一|next|continue)$/i.test(t)) {
      if (!pageId) {
        this.messages.push(agentMsg('先选一页。'));
        this.emit();
        return;
      }
      await this.runContinueNextPage(pageId);
      return;
    }
    // 用一句话改这一页
    const rewriteMatch = t.match(/^(?:改写|修改|改这页|rewrite)[:：\s]+(.+)$/);
    if (rewriteMatch) {
      if (!pageId) {
        this.messages.push(agentMsg('先选一页再改。'));
        this.emit();
        return;
      }
      await this.runRewritePage(pageId, rewriteMatch[1]);
      return;
    }

    // 没匹配到具体指令 → 当作通用对话（让模型用文字回答）
    // 这里直接走"通用对话"通道：把问题送进文字生成模型，回复一段自然语言
    await this.askFreeformQuestion(t);
  }

  private parsePageCount(text: string): number | null {
    const m = text.match(/(\d+)\s*页/);
    if (m) return Math.max(4, Math.min(60, parseInt(m[1], 10)));
    return null;
  }

  private async runBreakdownPage(pageId: string): Promise<void> {
    this.messages.push(agentMsg('正在拆解分镜…', { pending: true }));
    this.emit();
    try {
      const page = await this.breakdownPage(pageId);
      this.messages = this.messages.filter(m => !m.pending);
      if (!page) throw new Error('拆解失败');
      const ch = this.getSeries()?.chapters.find(c => c.pages.some(p => p.id === pageId));
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

  private async runGeneratePage(pageId: string): Promise<void> {
    this.messages.push(agentMsg('正在生成整页图片（分镜逐格出图，可能需要几分钟）…', { pending: true }));
    this.emit();
    try {
      const page = await this.generatePage(pageId);
      this.messages = this.messages.filter(m => !m.pending);
      if (!page) throw new Error('生成失败');
      // P2-14：页级 generatedImage 已废弃，改判「每格都有图」
      const allDone = page.panels.length > 0 && page.panels.every(p => !!p.imageUrl);
      this.messages.push(agentMsg(
        allDone
          ? `✅ 第 ${page.pageNumber} 页生成完成（${page.panels.length} 格）。还想调吗？可以说「**改这一页：xxx**」。`
          : `第 ${page.pageNumber} 页状态：${page.status}${page.errorMessage ? ` — ${page.errorMessage}` : ''}`,
      ));
      this.emit();
    } catch (e: any) {
      this.messages = this.messages.filter(m => !m.pending);
      this.messages.push(agentMsg(`生成失败：${e.message || e}`, { error: e.message || String(e) }));
      this.emit();
    }
  }

  private async runRegeneratePage(pageId: string): Promise<void> {
    this.messages.push(agentMsg('正在重新生成…', { pending: true }));
    this.emit();
    try {
      await this.regeneratePage(pageId);
      this.messages = this.messages.filter(m => !m.pending);
      this.messages.push(agentMsg('已重新生成。'));
      this.emit();
    } catch (e: any) {
      this.messages = this.messages.filter(m => !m.pending);
      this.messages.push(agentMsg(`重新生成失败：${e.message || e}`, { error: e.message || String(e) }));
      this.emit();
    }
  }

  private async runRewritePage(pageId: string, instruction: string): Promise<void> {
    this.messages.push(agentMsg(`好的，我会按「${instruction}」改这一页。`, { pending: true }));
    this.emit();
    try {
      const page = await this.rewritePage(pageId, instruction);
      this.messages = this.messages.filter(m => !m.pending);
      if (!page) throw new Error('改写失败');
      this.messages.push(agentMsg(`✅ 第 ${page.pageNumber} 页已按你的要求重写并出图。`));
      this.emit();
    } catch (e: any) {
      this.messages = this.messages.filter(m => !m.pending);
      this.messages.push(agentMsg(`改写失败：${e.message || e}`, { error: e.message || String(e) }));
      this.emit();
    }
  }

  private async runContinueNextPage(pageId: string): Promise<void> {
    this.messages.push(agentMsg('正在续写下一页（剧情 + 分镜 + 图片）…', { pending: true }));
    this.emit();
    try {
      const page = await this.continueNextPage(pageId);
      this.messages = this.messages.filter(m => !m.pending);
      if (!page) throw new Error('续写失败');
      this.messages.push(agentMsg(`✅ 第 ${page.pageNumber} 页已生成（自动跳过去）。`));
      this.emit();
    } catch (e: any) {
      this.messages = this.messages.filter(m => !m.pending);
      this.messages.push(agentMsg(`续写失败：${e.message || e}`, { error: e.message || String(e) }));
      this.emit();
    }
  }

  private async autoRunPages(n: number): Promise<void> {
    const s0 = this.getSeries();
    if (!s0) return;
    const allPages = s0.chapters.flatMap(c => c.pages);
    const startIdx = allPages.findIndex(p => p.id === this.getSelectedPageId());
    if (startIdx < 0) {
      this.messages.push(agentMsg('请先选一页再开始自动跑。'));
      this.emit();
      return;
    }
    let processed = 0;
    for (let i = startIdx; i < allPages.length && processed < n; i++, processed++) {
      const p = allPages[i];
      this.selectPage(p.id);
      this.messages.push(agentMsg(`▶ 正在处理第 ${p.pageNumber} 页…`, { pending: true }));
      this.emit();
      try {
        let cur = this.getSeries()?.chapters.flatMap(c => c.pages).find(x => x.id === p.id);
        // 若没拆过分镜，先拆
        if (!cur || cur.panels.length === 0) {
          cur = await this.breakdownPage(p.id) || cur || null;
        }
        // 出图
        if (cur) {
          await this.generatePage(p.id);
        }
      } catch (e: any) {
        this.messages = this.messages.filter(m => !m.pending);
        this.messages.push(agentMsg(`第 ${p.pageNumber} 页失败：${e.message || e}`, { error: e.message || String(e) }));
        this.emit();
        // 失败则停下让用户决定
        this.messages.push(agentMsg('已停下。修一下再继续？'));
        this.emit();
        return;
      }
    }
    this.messages = this.messages.filter(m => !m.pending);
    this.messages.push(agentMsg(`🎉 跑完了 ${processed} 页。`));
    this.emit();
  }

  private async askFreeformQuestion(text: string): Promise<void> {
    // 走文字生成接口，做"普通对话"。由前端调用 modelClient。
    this.messages.push(agentMsg('正在思考…', { pending: true }));
    this.emit();
    try {
      const { generateText } = await import('./modelClient');
      const r = await generateText({
        prompt: `你是一个漫画创作助手。用户问：${text}\n\n用简短中文回答（不超过 80 字）。`,
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