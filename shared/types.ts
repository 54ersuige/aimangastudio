/**
 * 前后端共享的领域类型 —— 单一事实来源。
 *
 * src/types.ts 与 server/series-store.ts 均从此处 re-export，
 * 避免两侧字段漂移（此前 Series/Character/Panel 在两端各定义一份，
 * 已经产生过 Promise 类型错误与 generatedImage 残留字段等问题）。
 *
 * 注意：本文件只允许放「纯类型」，不得引入任何运行时代码，
 * 因为 server（NodeNext，.js 后缀导入）与 src（vite bundler 解析）
 * 两侧都要引用它。
 */

// ========== 系列漫画（多章多页）==========

export interface Worldview {
  summary: string;
  background: string;
  era: string;
  artStyle: string;
  paletteMood: string;
}

export type CharacterRole = 'protagonist' | 'antagonist' | 'supporting';

export interface SeriesCharacter {
  id: string;
  name: string;
  role: CharacterRole;
  description: string;
  appearance: string;
  /** 参考图。生成后为 web 路径（/data/images/xxx.png），兼容历史 data URL。 */
  referenceImage?: string;
  voiceTone: string;
  /**
   * 角色来源：'ai' = AI 批量生成（重生成时会被整体替换）；
   * 'manual' = 用户手工添加（重生成时保留）。旧数据缺省视为 'ai'。
   */
  source?: 'ai' | 'manual';
}

export interface Panel {
  index: number;
  description: string;
  dialogue?: string;
  characterIds: string[];
  /** 分镜图。生成后为 web 路径（/data/images/xxx.png），兼容历史 data URL。 */
  imageUrl?: string;
}

export type PageStatus = 'draft' | 'generating' | 'done' | 'error';

export interface SeriesPage {
  id: string;
  /** 全系列连续编号（跨章不重复），与 Agent「跳到第 X 页」的全局语义一致。 */
  pageNumber: number;
  title: string;
  sceneDescription: string;
  panels: Panel[];
  characterIds: string[];
  status: PageStatus;
  errorMessage?: string;
}

export interface Chapter {
  id: string;
  title: string;
  summary: string;
  pageCount: number;
  pages: SeriesPage[];
}

export interface Series {
  id: string;
  title: string;
  logline: string;
  worldview?: Worldview;
  characters: SeriesCharacter[];
  chapters: Chapter[];
  /**
   * 视觉 DNA key。创建时从 config.dnaKey 冻结，**之后不可改**——
   * 这是「防止风格漂移」的硬约束。改 DNA 等于全页重画，不在系统能力内。
   * 旧数据缺省视为 'new-yorker-noir'。
   */
  dnaKey?: DnaKey;
  createdAt: string;
  updatedAt: string;
}

/** DNA key 字面量类型（与 server/dna/registry.ts 的 DNA_KEYS 保持一一对应）。 */
export type DnaKey = 'new-yorker-noir' | 'shonen-vintage' | 'cinematic-realism';

export type StoryCreatorStep = 'logline' | 'worldview' | 'characters' | 'chapters' | 'pages';

// ========== 后台任务（长耗时生图轮询）==========

export interface TaskState {
  id: string;
  kind: string;
  status: 'running' | 'done' | 'error';
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
