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

/**
 * 世界观蓝图 —— 系列创作的总纲。后续角色 / 章节 / 分镜 都从这里派生。
 *
 * 新增字段 (2026-08)：
 * - characterBlueprints：所有涉及角色的清单（按此生成，禁止数量漂移）
 * - plotOutline：整体剧情大纲（按此拆章节）
 * - conflicts：核心矛盾 / 张力曲线（驱动分镜）
 * - locations：关键场景（保证视觉一致 + 复用 prompt）
 *
 * 旧数据兼容：上述字段都是 optional。缺字段时，由对应生成端点按
 * background + logline 在 prompt 里"按需推断"，不报错、不迁移数据。
 */
export interface Worldview {
  summary: string;
  background: string;
  era: string;
  artStyle: string;
  paletteMood: string;
  /** 涉及的角色蓝图清单。生成角色时严格按此数量 + 定位。 */
  characterBlueprints?: CharacterBlueprint[];
  /** 整体剧情大纲（3-5 段/幕）。章节拆分时按此切分。 */
  plotOutline?: string;
  /** 3-5 条核心矛盾 / 张力点。驱动后续分镜的情绪曲线。 */
  conflicts?: string[];
  /** 2-4 个关键场景设定（地点 + 氛围一句话）。分镜 prompt 复用。 */
  locations?: string[];
  /** 季/卷蓝图（2-6 段）。整本连载的剧情节奏骨架；逐季生成时按此切章。 */
  arcBlueprints?: ArcBlueprint[];
}

/**
 * 季蓝图 —— 一句话定位 + 计划章数。逐季生成时 AI 根据此 + 上一季结尾
 * 推断本章内容；不在蓝图里写每章细节，避免一次塞太多 token 撑爆图片模型。
 */
export interface ArcBlueprint {
  /** 暂定季标题，例"第一季 觉醒"。 */
  title: string;
  /** 一句话剧情走向 / 主题（≤ 40 字）。 */
  premise: string;
  /** 计划本章数；生成时可微调。 */
  plannedChapterCount: number;
}

/**
 * 角色蓝图 —— 仅含"它是谁、为什么在故事里"，**不**含外貌 / 详细设定
 * （避免一次塞太多文字超出图片生成模型的理解上限；详细设定留到
 * 角色生成端点根据本蓝图再展开）。
 */
export interface CharacterBlueprint {
  /** 暂定名字。角色生成时可微调，但同名优先复用旧 ID（P2-13）。 */
  name: string;
  role: CharacterRole;
  /** 一句话定位 / 在故事里的功能（例：主角的职场导师）。 */
  roleInStory: string;
  /** 一句话核心动机 / 弧光（例：想保住铁饭碗却不得不站队）。 */
  motivation: string;
}

export type CharacterRole = 'protagonist' | 'antagonist' | 'supporting';

/**
 * 角色性别（2026-09-01 新增）。
 * 用于在角色参考图与分镜出图的 prompt 中显式标注「画面中的人是什么性别」，
 * 解决 LLM + 图像模型把"短发、瘦小"的女生画成中性偏男生面孔的根因。
 *
 * 设计为枚举（不让 LLM 自由发挥）：
 *  - 'female'：女性（默认女生）
 *  - 'male'：男性
 *  - 'ambiguous'：刻意的中性 / 性别不明（如雌雄莫辨的反派、反传统中性角色）
 *  - 'nonbinary'：非二元 / 跨性别表达（需显式标注，不要让 LLM 猜）
 *
 * 缺失字段视为 undefined —— 生图时如果用户没填、LLM 也没推断出来，
 * 就退回到「appearance / visualAnchors 自然文本」的老路径，由用户反馈触发补全。
 */
export type CharacterGender = 'female' | 'male' | 'ambiguous' | 'nonbinary';

/** 性别枚举的所有合法值集合（前后端共用，避免字面量重复）。 */
export const CHARACTER_GENDERS: readonly CharacterGender[] = ['female', 'male', 'ambiguous', 'nonbinary'];

/**
 * 角色年龄段（2026-09-01 新增）。
 * 把"年龄"从纯文本字段升级为枚举，让生图 prompt 显式写出
 * "child / teen / young adult / middle-aged / elderly" 这种
 * 图像模型训练分布里扎实的词，解决"老年人画成年轻人""小孩画成大人"问题。
 *
 * 不存出生年份 —— 出生年份会随剧情时间漂移，枚举更稳定。
 */
export type CharacterAgeBand = 'child' | 'teen' | 'young_adult' | 'middle_aged' | 'elderly';

/** 年龄段枚举的所有合法值集合（前后端共用）。 */
export const CHARACTER_AGE_BANDS: readonly CharacterAgeBand[] = ['child', 'teen', 'young_adult', 'middle_aged', 'elderly'];

/**
 * 角色档案（Character Bible）—— 按「形象可复现」最佳实践拆分的字段。
 *
 * 设计原则：
 *  - 所有新字段均 optional；旧数据（只有 name/role/description/appearance/voiceTone）零迁移成本。
 *  - 描述字段全部自由文本（不强行枚举），AI 在生成时会被提示按结构化维度组织。
 *  - 「视觉锚点」是单页 prompt 强制带入的元素，决定几十页后角色是否仍然一致。
 *  - 「动机 / 弧光」对齐 CharacterBlueprint，便于世界观蓝图→角色档案的稳定映射。
 */
export interface SeriesCharacter {
  id: string;
  name: string;
  role: CharacterRole;

  /** 故事内定位（例："主角的职场导师"、"公司里唯一反对 AI 的中层"）。 */
  roleInStory?: string;

  /**
   * 性别（手动优先于 AI 推断）。
   * 用户在 UI 上手动填的，生成参考图 / 分镜图时 100% 信任；AI 推断的会被同样的标签覆盖，
   * 避免模型一上来就把"短发瘦小女生"画成中性偏男生。
   * 字段缺失视为未指定 —— 生图时降级到「appearance 文本+视觉锚点」。
   */
  gender?: CharacterGender;

  /**
   * 年龄段（手动优先于 AI 推断）。
   * 把年龄从 free text 升级为枚举，让生图 prompt 写出训练分布里扎实的词
   * （child / teen / young_adult / middle_aged / elderly），显著提升老幼人群辨识度。
   * 字段缺失视为未指定 —— 生图时降级到「age 文本」。
   */
  ageBand?: CharacterAgeBand;

  // ============ 形象 ============
  /** 综合外貌（旧字段；自由文本，AI 生成时通常按"体型 → 发型 → 脸 → 服装"顺序写）。 */
  appearance: string;
  /** 综合简介（旧字段；短摘要，用于卡片展示。详细拆分见下面细分字段）。 */
  description: string;
  /** 年龄段（例："28 / 视感 25-30"）。 */
  age?: string;
  /** 身高体型（例："176 cm，偏瘦"。可与 height/build 二选一）。 */
  height?: string;
  /** 体型（例："运动员体型 / 微胖 / 瘦削"）。 */
  build?: string;
  /** 发型与发色（例："黑色短发，左分，露出额头"）。 */
  hair?: string;
  /** 眼睛（例："深棕色，常见微眯；左眼下有一颗小痣"）。 */
  eyes?: string;
  /** 标志服装（例："深蓝西装外套 + 白衬衫，不打领带；左手常戴银色戒指"）。 */
  outfit?: string;
  /** 习惯性动作 / 标志物（例："说话时双手插兜；思考时摸下巴；随身带不锈钢保温杯"）。 */
  signature?: string;

  // ============ 性格 / 背景 ============
  /** 性格概述（例："表面冷淡、内心脆弱；用幽默掩饰焦虑"）。 */
  personality?: string;
  /** 职业 / 身份（例："急诊科医生 / 三年级小学生"）。 */
  occupation?: string;
  /** 关键经历 / 出身（一段话，建议 50-150 字）。 */
  backstory?: string;

  // ============ 故事弧 ============
  /** 核心动机（与 CharacterBlueprint.motivation 对齐）。 */
  motivation?: string;
  /** 表层目标（与 motivation 区分：动机是"为什么"，目标是"做什么"）。 */
  goal?: string;
  /** 弧光（例："从'明哲保身'到'敢为同事发声'"）。 */
  arc?: string;
  /** 内部冲突（例："怕被孤立 vs. 怕错失真相"）。 */
  internalConflict?: string;
  /** 外部冲突（例："与上司立场对立 / 被行业潜规则反噬"）。 */
  externalConflict?: string;

  // ============ 台词声音 ============
  /** 说话风格（旧字段别名；保留以兼容旧数据）。 */
  voice?: string;
  /** 口头禅（例："听我说完。"）。 */
  catchphrase?: string;

  // ============ 视觉锚点（每页分镜必带入） ============
  visualAnchors?: string[];

  /** 参考图。生成后为 web 路径（/data/images/xxx.png），兼容历史 data URL。
   *  旧版字段：只存一张主参考图。新流程不再写入，但读取时仍兼容（启动迁移到 referenceImages）。 */
  referenceImage?: string;
  /**
   * 角色设定集（character reference sheet）：多角度 + 面部特写。
   * 典型 4 张：正面全身 / 3-4 角度半身 / 侧面半身 / 面部特写。
   * 后续分镜图根据镜头（camera）自动挑最相关的图作 referenceImages。
   * 缺省视为空数组 —— 启动迁移会把旧 referenceImage 单字段迁入。
   */
  referenceImages?: string[];

  /**
   * 角色来源：'ai' = AI 批量生成（重生成时会被整体替换）；
   * 'manual' = 用户手工添加（重生成时保留）。旧数据缺省视为 'ai'。
   */
  source?: 'ai' | 'manual';
}

export interface Panel {
  /** 可选；仅手动编辑模式使用，便于增量更新。 */
  id?: string;
  index: number;
  description: string;
  dialogue?: string;
  /**
   * 上帝视角叙述 / 场景交代（图下方文字 · 外置 caption block）。
   * 2026-09-03 增：不动 description，叙述由 AI 在生成面板时一同输出，公众号版渲染为「叙述块」。
   * - 表达"场景在发生什么 / 为什么 / 下一步会发生什么"；
   * - 一般 20-80 字，避免与 description 重复；
   * - 在 EpisodeCard 预视为图下"灰字"块；在公众号版作为"caption block"。
   * 旧数据缺省为 undefined（向后兼容，不强填）。
   */
  narration?: string;
  /**
   * 主角（或视角角色）内心独白（图下方文字 · 斜体块）。
   * 2026-09-03 增：与 narration 互补，区别在于叙述是【上帝】而 innerThought 是【主角心内发言】。
   * 一般 0-50 字，没有就跳空（很多格不需要内心独白）。
   * 旧数据缺省为 undefined。
   */
  innerThought?: string;
  characterIds: string[];
  /** 镜头（特写/中景/远景等）；旧数据缺省视为 'mid'。可手动编辑。 */
  camera?: string;
  /** 情绪 / 备注；旧数据缺省视为 ''。可手动编辑。 */
  emotion?: string;
  /**
   * 本格出现的无名配角（一次性角色，不进角色库）。
   * 出图时以文字外貌描述注入 prompt，并明确告知模型"此人不是参考图中的人物"，
   * 修复"前台/路人被画成主角复制品"的人物区隔问题。
   */
  extraCharacters?: { name: string; appearance: string }[];
  /** 分镜图。生成后为 web 路径（/data/images/xxx.png），兼容历史 data URL。 */
  imageUrl?: string;
  /**
   * 这一格的图是**上一轮留下来的**，不是本轮生成的（2026-10-16 新增）。
   *
   * 场景：重画整批时，个别格出图失败。策略是保留它原来的旧图
   * （宁可留旧图也不要留空洞，前面的钱已经花了），但这样一来
   * 「6 格齐全」就可能是假象 —— 其中 1 格其实是上次的图，
   * 而用户在界面上完全看不出来。
   *
   * 真正的代价不是那格图旧，是**用户以为自己看过新版了**。
   * 所以把它显式标出来，而不是悄悄留在那儿。
   */
  stale?: boolean;
  /** 变成旧图的原因（失败原因），用于在 UI 上说明为什么没更新。 */
  staleReason?: string;
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
  /** 所属季/卷 ID。旧数据（直接挂 series）缺省视为 ''（无 arc / 旧结构）。 */
  arcId?: string;
  title: string;
  summary: string;
  /** 章节核心冲突（AI 生成时输出；可手动编辑；旧数据缺省视为 ''）。 */
  conflict?: string;
  pageCount: number;
  pages: SeriesPage[];
  // —— 公众号发布元数据（一话一件完整的事）：AI 生成、预览页可改 ——
  /** 话头副题：一句话点题（如 '说"不"不是终点。知道为什么说"不"，才是。'）。 */
  tagline?: string;
  /** 结尾金句：整话收尾的大字强调句。 */
  endingQuote?: string;
  /** 下话预告：2-3 句悬念文案。 */
  nextPreview?: string;
}

/**
 * 季 / 卷（Arc）。把整本连载切成 2-6 段大剧情弧；
 * 每季内含若干章；每章内若干话（page）。
 * 缺失时视为旧结构，兼容未升级数据。
 */
export interface Arc {
  id: string;
  /** 季序号（从 1 开始，全系列唯一）。 */
  index: number;
  title: string;
  /** 一句话剧情走向 / 主题。 */
  premise: string;
  /** 计划本章数；实际 chapter 数允许偏离 ±1（AI 自由决定）。 */
  plannedChapterCount: number;
  chapters: Chapter[];
}

export interface Series {
  id: string;
  title: string;
  logline: string;
  worldview?: Worldview;
  characters: SeriesCharacter[];
  /** 连载结构：季 / 卷。空数组代表旧结构（chapter 直接挂 series）。 */
  arcs: Arc[];
  /**
   * 向后兼容：旧 series 直接把 chapter 挂在这里、没有 arc 层。
   * 新流程下，chapter 都挂在 arc.chapters；此字段保留以读取旧数据，
   * 但不在新流程里写入。
   */
  chapters?: Chapter[];
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
export type DnaKey = 'graphic-novel-ink' | 'new-yorker-noir' | 'shonen-vintage' | 'cinematic-realism';

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
  /**
   * 进度 0-100，仅对 status='running' 的任务有意义。
   * 任务执行者通过 task-queue 的 setTaskProgress(id, progress) 主动上报；
   * 上报失败 / 未上报时 progress 可能为 0 或保持上一份值，前端 UI 应容忍。
   * 2026-09-18 新增。
   */
  progress?: number;
}

// ========== 公众号图文草稿（第一阶段）==========

/** 人名卡项：出场人物的一句话介绍（用于"人物表"）。 */
export interface CastMember {
  name: string;
  /** 定位：主角 / 反派 / 配角。 */
  role?: string;
  /** 一句话出场介绍（≤ 40 字）。 */
  intro: string;
  /** 人物参考图（web path）。可空 —— 空则不渲染头像。 */
  portrait?: string;
}

/** 草稿中的一个内容块。图片与文字独立，渲染时按顺序排列。 */
export type DraftBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'image'; url: string; alt?: string; caption?: string }
  | { kind: 'divider' }
  | {
      kind: 'cast';
      /** 小节标题，如「主要人物」。 */
      title?: string;
      characters: CastMember[];
    }
  | {
      kind: 'panel';
      /** 引用原始 SeriesPage.id，便于用户编辑后回到原页定位。 */
      pageId: string;
      panelIndex: number;
      imageUrl: string;
      dialogue?: string;
      description?: string;
      /** 2026-09-11：panel 块补齐「图文三件套」—— narration/innerThought
       *  此前只带 dialogue，公众号导出时读者看不见上帝视角叙述与内心独白，
       *  导致"只有图和对白、没有场景事件"。 */
      narration?: string;
      innerThought?: string;
    }
  | {
      kind: 'page';
      pageId: string;
      title: string;
      sceneDescription?: string;
      /** 该页正文（来自 page.title + sceneDescription + 对白）。 */
      summary?: string;
    };

/** 排版参数：用户可调节的视觉变量；生成 HTML / 预览时注入。 */
export interface DraftTypography {
  /** 主题色（标题 / 强调色）。 */
  accent: string;
  /** 正文字号（px，公众号正文常见 16-17）。 */
  bodySize: number;
  /** 行高倍数。 */
  lineHeight: number;
  /** 段间距（em）。 */
  paragraphSpacing: number;
  /** 标题字体：'serif' 衬线 / 'sans' 无衬线。 */
  titleFamily: 'serif' | 'sans';
  /** 是否在文末加「— 完 —」收尾。 */
  endMark: boolean;
}

/** 预设模板：决定整体版式与默认排版。 */
export type DraftTemplateId = 'magazine' | 'literary' | 'minimal';

/** 公众号图文草稿（仅前端状态，不入库）。 */
export interface ArticleDraft {
  id: string;
  /** 草稿标题——独立于系列，可独立发布。 */
  title: string;
  /** 副标题 / 导语，可选。 */
  subtitle?: string;
  /** 作者署名，可选。 */
  author?: string;
  /** 选用的模板。 */
  template: DraftTemplateId;
  /** 排版参数。 */
  typography: DraftTypography;
  /** 来源系列 ID，便于后续回到原系列编辑。 */
  sourceSeriesId?: string;
  /** 内容块顺序。图片与文字独立，按数组顺序排列。 */
  blocks: DraftBlock[];
  /** 创建时间（毫秒）。 */
  createdAt: number;
  /** 最近修改时间（毫秒）。 */
  updatedAt: number;
}

/** 标题建议（用于 UI 列表展示）。 */
export interface TitleSuggestion {
  text: string;
  /** 简单说明这条建议来自什么。 */
  reason: string;
}
