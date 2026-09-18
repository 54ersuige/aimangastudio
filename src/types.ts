// ========== 系列漫画（多章多页）==========
// 领域类型统一收口在 shared/types.ts（前后端单一事实来源），此处仅 re-export。

export type {
  Worldview,
  CharacterBlueprint,
  ArcBlueprint,
  CharacterRole,
  // 2026-09-01 新增：性别 / 年龄段枚举与常量
  CharacterGender,
  CharacterAgeBand,
  SeriesCharacter,
  Panel,
  PageStatus,
  SeriesPage,
  Chapter,
  Arc,
  Series,
  StoryCreatorStep,
  TaskState,
  DraftBlock,
  CastMember,
  DraftTypography,
  DraftTemplateId,
  ArticleDraft,
  TitleSuggestion,
} from '../shared/types';

export { CHARACTER_GENDERS, CHARACTER_AGE_BANDS } from '../shared/types';

import type { Worldview, SeriesCharacter, Chapter, SeriesPage } from '../shared/types';

// ========== 会话式 Agent 工作台 ==========

/** 创作工作流中的一个逻辑阶段。决定了"下一步要做什么"。 */
export type AgentStage =
  | 'idle'                 // 还没开始（首页 / 项目列表）
  | 'awaiting_logline'     // 等用户提供一句话简介
  | 'reviewing_worldview'  // 世界观生成完毕，等用户审核
  | 'reviewing_characters' // 角色生成完毕，等用户审核
  | 'reviewing_chapters'   // 章节大纲生成完毕，等用户审核
  | 'producing_pages'      // 逐页生成中（用户在聊天里下指令）
  | 'exporting';           // 导出阶段

/** 聊天里的一条消息。 */
export interface ChatMessage {
  id: string;
  role: 'agent' | 'user' | 'system';
  /** 纯文本部分。 */
  text: string;
  /** 内嵌卡片的 payload —— 当 AI 给出一个可审批对象时挂在这里。 */
  card?: AgentCard;
  /** 是否在等用户回复（agent 消息会有 pending 状态）。 */
  pending?: boolean;
  error?: string;
  /** 用于在系列被切换/重置时丢弃旧消息。 */
  ts: number;
}

/** 审核卡。嵌在 agent 消息里，在右侧聊天流里直接渲染并提供按钮。 */
export type AgentCard =
  | { kind: 'worldview'; worldview: Worldview }
  | { kind: 'characters'; characters: SeriesCharacter[] }
  | { kind: 'chapters'; chapters: Chapter[] }
  | { kind: 'page_preview'; chapterTitle: string; page: SeriesPage };

/** Agent 内部状态。 */
export interface AgentState {
  stage: AgentStage;
  /** 当 stage 在 *reviewing_* 时，表示这块内容 AI 已经提了建议但用户还没点头。 */
  pending: {
    worldview?: Worldview;
    characters?: SeriesCharacter[];
    chapters?: Chapter[];
  };
}
