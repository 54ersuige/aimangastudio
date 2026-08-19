export interface Shape {
  id: string;
  type: 'panel' | 'text' | 'bubble' | 'drawing' | 'image' | 'arrow';
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
}

export interface PanelShape extends Shape {
  type: 'panel';
  points: { x: number; y: number }[];
  width: number;
  height: number;
}

export interface TextShape extends Shape {
  type: 'text';
  text: string;
  fontSize: number;
  width: number;
  height: number;
}

export interface BubbleShape extends Shape {
    type: 'bubble';
    bubbleType: 'rounded' | 'oval' | 'rect';
    width: number;
    height: number;
    text: string;
    tail?: { x: number; y: number };
}

export interface DrawingShape extends Shape {
    type: 'drawing';
    points: { x: number; y: number }[][];
    strokeColor: string;
    strokeWidth: number;
}

export interface ArrowShape extends Shape {
  type: 'arrow';
  points: [{ x: number; y: number }, { x: number; y: number }];
  strokeColor: string;
  strokeWidth: number;
}

export interface SkeletonData {
  [key: string]: { x: number; y: number };
  // Making these optional for backward compatibility with saved data.
  // The editor will provide defaults if they are missing.
  leftEye?: { x: number; y: number };
  rightEye?: { x: number; y: number };
  nose?: { x: number; y: number };
  mouth?: { x: number; y: number };
}

export interface SkeletonPose {
  type: 'skeleton';
  preset: 'full' | 'upper' | 'lower' | 'face';
  data: SkeletonData;
  comment: string;
}

export type Pose = 
  | SkeletonPose
  | { type: 'image'; href: string; }
  // Points are normalized to the character's bounding box [0, 1]
  | { type: 'drawing'; points: { x: number; y: number }[][]; };


export interface ImageShape extends Shape {
    type: 'image';
    href: string; // base64
    characterId: string;
    panelIndex: number;
    width: number;
    height: number;
    pose?: Pose;
}


export type CanvasShape = PanelShape | TextShape | BubbleShape | DrawingShape | ImageShape | ArrowShape;

export interface GeneratedContent {
    image: string | null;
    text: string | null;
}

export interface Character {
    id: string;
    name: string;
    referenceImages: string[]; // Original uploaded images
    sheetImage: string; // AI-generated sheet
    description?: string; // Optional character description/setting
}

export interface ViewTransform {
    scale: number;
    x: number;
    y: number;
}

export interface Page {
    id:string;
    name: string;
    shapes: CanvasShape[];
    shapesHistory: CanvasShape[][];
    shapesHistoryIndex: number;
    panelLayoutImage: string | null;
    sceneDescription: string; // AI-generated, user-editable script. No longer nullable.
    panelCharacterMap: { [panelIndex: number]: string }; // Kept for reference, but image shapes are primary
    generatedImage: string | null;
    generatedText: string | null;
    generatedColorMode: 'color' | 'monochrome' | null;
    aspectRatio: string;
    viewTransform: ViewTransform;
    shouldReferencePrevious: boolean;
    assistantProposalImage: string | null;
    proposalOpacity: number;
    isProposalVisible: boolean;
    proposedShapes: CanvasShape[] | null;
}

export interface StorySuggestion {
  summary: string;
  panels: {
    panel: number;
    description: string;
    dialogue?: string;
  }[];
}

export interface AnalysisResult {
  analysis: string;
  has_discrepancies: boolean;
  correction_prompt: string;
}

// Types for AI Video Producer
export interface AISuggestions {
  transition: string;
  vfx: string;
  camera: string;
  narrative: string;
}

export type VideoModelId = 'seedance' | 'hailuo' | 'veo' | 'kling' | 'agnes';

export interface VideoScene {
  id: string;
  description: string;
  duration: number;
  startFrame?: string;
  endFrame?: string;
  aiSuggestions?: AISuggestions;
  finalPrompt?: string;
  sourcePageIndex: number;
  charactersInScene: string[];
  isLoading: boolean;
  prompts?: {
    seedance?: string;
    hailuo?: string;
    veo?: string;
    kling?: string;
    agnes?: string;
  };
  recommendedModel?: VideoModelId;
  reasoning?: string;
  generatedVideoUrl?: string;
  videoGenerationStatus?: 'idle' | 'pending' | 'done' | 'error';
  videoGenerationProgress?: string;
}

export interface InitialSceneData {
    sceneDescription: string;
    narrative: string;
    duration: number;
    charactersInScene: string[];
    sourcePageIndex: number;
    recommendedModel: VideoModelId;
    reasoning: string;
}

// Intermediate type from the first Gemini call in the storyboard generation process
export interface SceneAnalysis {
    sceneDescription: string;
    duration: number;
    startFramePrompt: string;
    endFramePrompt: string;
    aiSuggestions: AISuggestions;
    finalPrompt: string;
    sourcePageIndex: number;
    charactersInScene: string[];
    // FIX: Added missing 'narrative' property to align with the schema used in videoGeminiService.
    narrative: string;
}

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
  referenceImage?: string;
  voiceTone: string;
}

export interface Panel {
  index: number;
  description: string;
  dialogue?: string;
  characterIds: string[];
  imageUrl?: string;
}

export type PageStatus = 'draft' | 'generating' | 'done' | 'error';

export interface SeriesPage {
  id: string;
  pageNumber: number;
  title: string;
  sceneDescription: string;
  panels: Panel[];
  generatedImage?: string;
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
  style: string;
  characters: SeriesCharacter[];
  chapters: Chapter[];
  createdAt: string;
  updatedAt: string;
}

export type StoryCreatorStep = 'logline' | 'worldview' | 'characters' | 'chapters' | 'pages';

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