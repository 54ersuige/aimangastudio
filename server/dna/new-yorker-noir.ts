// @dna-checksum: f64dc6cd890b47937f2a6b40bc2ea1caddd6af8dd2439e7978ba7350644b76c0
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DNA 预设一：New Yorker × Tomine 都市写实 × Graphic Novel（v1.1）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  本预设是该项目的"默认 DNA"。
 *  原 graphic-novel-dna.ts 的全部内容迁移到此 key 下；
 *  system 级 /api/text、/api/image 与所有业务端点统一通过 dna-inject 注入。
 *
 *  人类可读版本：docs/style-dna/new-yorker-noir.md
 *
 *  修改本文件后请同步修改 .md，并保留 README 中描述的 7 个导出字段顺序与名称。
 *  @dna-checksum 由 server/dna/checksum.ts 启动时重算校验。
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const VISUAL_DEFINITION = `
New Yorker 单幅叙事 × Adrian Tomine 都市写实 × 欧美独立 Graphic Novel 的文学气质。
New Yorker 是 "皮"（色调、印刷感、单幅成立）、Tomine 是 "骨"（人物克制、距离感、日常诚实）、
Graphic Novel 是 "形"（电影化镜头、留白、一格一帧）。
用一幅安静、克制、真实的画面，捕捉普通人生活中一个值得思考的瞬间。
整体气质参考 New Yorker 杂志插画、Adrian Tomine 作品、欧美独立 Graphic Novel。
强调：克制、真实、安静、细腻、留白、生活感、印刷质感。
画面像一部安静的独立电影，被切成了一组适合手机阅读的漫画镜头。

幽默定位（Style Bible V1.0 融合）：
New Yorker 式的幽默是"观察型"而非"表演型"——画面平静、可信，
轻微的荒诞与讽刺藏在情境本身；笑点被读者发现，而不是被宣布。
像真的生活一样画，像没发生什么一样讲笑话。
`;

export const VISUAL_KEYWORDS = [
  'New Yorker 单幅叙事', '杂志插画质感', '印刷品质感',
  '欧美文艺', '独立漫画', 'Graphic Novel', '都市生活',
  '写实但不照片化', '克制', '安静', '内敛', '温和', '微妙',
  '真实', '生活感', '文学感', '电影感', '留白',
  '观察型幽默', '冷幽默', '轻微荒诞', '编辑部漫画',
  '不煽情', '不说教', '不刻意可爱', '不商业插画化', '不网红漫画化',
  '奶油黄底', '燕麦色', '粉赭红棕点缀', '单幅独立成立',
];

export const VISUAL_FORBIDDEN = [
  '动画片', '商业儿童绘本', '网红漫画', '日漫', '二次元',
  '迪士尼式角色', '皮克斯式3D', '美漫超级英雄', '网络表情包', '萌系',
  'Q版', '大头', '大眼', '夸张五官', '过度精致', '网红脸',
  '明显的动漫脸', '过度年轻化', '完美身材', '塑料质感',
  '高饱和', '荧光色', '糖果色', '强烈渐变', '霓虹色',
  '游戏UI式配色', '巨大光束', 'HDR', '强烈轮廓光',
  '夸张动态线', '速度线', '厚重卡通描边',
  '大哭', '大笑', '愤怒咆哮', '震惊表情', '夸张瞪眼', '夸张张嘴',
  '对话气泡', '旁白框', '大段解释性文字', '心理活动描写',
  '心灵鸡汤感', '说教感', '正能量宣传画', '教育漫画感',
  'AI漂亮插画', '视觉过度刺激',
];

/**
 * v1.0-locked：注意 Agnes content policy 会拒绝包含 crying/tears 等词过密的 prompt，
 * 所以这里集中放在一个 negative_prompt 字段里、prompt 正文中不再列负面词。
 */
export const IMAGE_NEGATIVE_PROMPT = [
  'anime', 'manga', 'chibi', 'cartoon', 'big eyes', 'cute style',
  'large eyes', 'huge eyes', 'anime eyes', 'eye highlights',
  'sparkly eyes', 'glossy eyes',
  'exaggerated expression', 'shock face', 'laughing loudly',
  'high saturation', 'neon colors', 'candy colors', 'fluorescent',
  'glossy skin', 'plastic skin', 'smooth airbrushed skin',
  'speed lines', 'action lines', 'thick cartoon outlines', 'bold outlines',
  'thick lines', 'heavy lines', 'painterly',
  // 2026-08-31 复盘补充：玻璃幕墙/晨光反射类场景描述会把模型拽进摄影分布，
  // 原负面表只挡了 3D/CGI，没挡"照片"本身 —— 导致整张输出成实景照片。
  'photograph', 'photorealistic', 'photography', 'realistic photo', 'photo background',
  // 角色设定表（2x2 grid）模板词会把模型拽向"设定表训练分布"：
  // 白底素描 / 水彩写实 / 铅笔淡彩 —— 与 New Yorker 平涂细线直接冲突。
  'watercolor', 'watercolor painting', 'pencil sketch', 'rough sketch',
  'faint sketchy lines', 'washed-out pale colors', 'pure white background',
  '3D render', 'CGI', 'game CG',
  "children's book illustration", 'Disney style', 'Pixar style',
  'superhero comic',
  'commercial illustration', 'stock illustration style',
  'speech bubbles', 'thought bubbles', 'narrator boxes',
  'drama lighting', 'rim light', 'chiaroscuro',
  'perfect body', 'perfect face', 'flawless skin',
  'looking at camera', 'eye contact with viewer',
  // 2026-09-03 复盘：用户截图显示角色参考图（4 视图参考表）出现「多胳膊」
  // —— 直接成因是手里拿保温杯的姿态下，文本里没有任何肢体负面约束。
  // T2I 模型对自然语言"两只手"的描述不敏感，必须用负面词显式排除最常见
  // 的肢体伪影。注意这些词长度都 ≤15 字符，对 prompt 长度影响极小，
  // 但命中率显著高于正面的「anatomically correct」短语。
  'extra arms', 'extra hands', 'extra fingers', 'extra limbs',
  'third arm', 'third hand', 'fourth arm',
  'mutated hands', 'bad hands', 'malformed hands',
  'mutated arms', 'bad arms', 'malformed arms',
  'too many fingers', 'six fingers', 'seven fingers',
  'fused fingers', 'missing fingers', 'missing arms',
  'asymmetric arms', 'wrong hand count', 'duplicate arms',
  'bad anatomy', 'anatomical errors', 'deformed limbs',
  'body horror', 'twisted limbs',
  // 4 视图参考表里曾出现「额外道具」（手杯被误画成多一只手），
  // 角色图必须保持手空或自然下垂，禁止自带道具：
  'holding object', 'holding cup', 'holding bottle', 'holding bag',
  // 平衡姿态：避免转身 3/4 视角容易诱发的手臂叠影
  'overlapping arms in confusing way',
].join(', ');

export const IMAGE_SYSTEM_PROMPT = `
You are drawing a single panel for an adult literary graphic novel,
in the tradition of New Yorker spot illustration crossed with
Adrian Tomine (Shortcomings, Killing and Dying).

[STYLE LOCK — HIGHEST PRIORITY]

Final artwork = clean even ink outlines (one weight, clearly
visible) + FLAT color fills + at most ONE cel-shadow tone +
warm cream / oatmeal paper with print grain. If anything below,
any reference image, or any scene description pulls toward
watercolor, airbrush gradients, pencil sketch, anime gloss,
or photorealism, THIS LOCK WINS.

[TONE — NEW YORKER × TOMINE]

This is one frame from a quiet independent film, set down on paper.
The image should look like it could appear as a stand-alone
New Yorker cover or spot illustration: it tells its whole story
in a single still moment. Cream / oatmeal paper tone, soft
muted palette with small touches of dusty rose, ochre, and
brick red. The mood is gentle, slightly autumnal, literary.
Not melancholy — quiet. The kind of quiet where you can hear
the air conditioner.

When the scene carries irony or absurdity, play it deadpan:
every face stays calm, nothing is mugged for the audience.
The joke is discovered, never announced — like a real
New Yorker panel.

[LINEWORK]

Like a 0.4mm technical pen printed on paper: one consistent
line weight, never thick, never faint, never sketchy.
NO hatching, NO crosshatching, NO rough sketch lines, NO
airbrush gradients. (Flat fills + single cel shadow are
defined in the STYLE LOCK above.)

[FACES — MODERN 21st-CENTURY REAL CHINESE]

Real modern Chinese faces. Not the "internet celebrity" face,
not the "anime / manga" face, not the "video game NPC" face.
The kind of face you would actually see in a Shanghai,
Beijing, Shenzhen, or Chengdu coffee shop at 4pm on a Tuesday.

Specifically:
  - Eyes: SMALL, narrow, ALMOND-SHAPED. Not "anime big". Not
    "Western round". Ordinary Chinese eyes. The whites of the
    eyes should be barely visible. Single eyelids or shallow
    double eyelids are both fine. NO eye highlights, NO sparkles,
    NO enlarged iris, NO lash-line emphasis.
  - Eyebrows: natural, not shaped, not bold, not thin.
  - Nose: medium bridge, natural width, ordinary for an East
    Asian face. NOT a "high Western nose bridge". NOT a flat
    caricature nose.
  - Mouth: closed or slightly relaxed. Natural lip color.
    Not glossy, not painted, not full.
  - Jaw / face shape: ordinary. Could be round, oval, or
    slightly square. NOT heart-shaped, NOT "V-line", NOT
    a sharp chin. NOT a wide caricature jaw either.
  - Skin: CLEAN, SMOOTH, NATURAL SKIN TONE. Normal Chinese
    skin color (warm beige to light tan, not porcelain,
    not yellow). NO visible pores, NO freckles, NO
    beauty marks. Skin looks like ordinary young-to-middle-
    aged Chinese skin — healthy, untreated, well-rested.
  - Hair: modern cut. Could be a bob, shoulder-length, short
    crop, or short back and sides for men. Natural color
    (black or very dark brown). Not styled, not dyed.

The faces must look like they belong to ordinary people you
might sit next to on the subway. NOT celebrities. NOT models.
NOT characters from any animated work.

[EXPRESSION — restrained, calm, inward]

Neutral. Faces turned three-quarters or in profile.
NEVER staring straight into the camera. Between characters,
natural conversation gaze is allowed (two people may look at
each other, as in Adrian Tomine's dialogue panels), but the
mood stays quiet and understated. Quiet, slight tiredness,
slight distance. Faces are calm. Eyes are calm. Mouths are
closed or slightly relaxed. No visible emotion on the face
itself — emotion lives in the posture and gaze direction.

[CLOTHING]

Real contemporary Chinese clothing for the role: cotton
t-shirts, simple cardigans, plain trousers, jeans, simple
shoes. Modern fits (not vintage, not oversized, not costume).
NO logos. NO prints. NO fashion-editor styling. Hair is
modern, natural, not styled.

[SCENE — ordinary, lived-in, warm]

Real ordinary Chinese environment: a chain cafe, a home, an
elevator, a street, a subway. Plain wooden table. Plain paper
cups, plain dishes. Natural window light. The wall behind is
warm off-white / cream / oatmeal (NOT cold blue-grey) with
maybe a small framed picture. Outside a window you might see
ordinary low-rise buildings or a tree-lined street. Slightly
worn, lived-in atmosphere. NOT designed, NOT stylish, NOT
stark.

Detail economy: a FEW accurate details beat many details.
One lit computer, one cold coffee, a few papers, a tired
person — that already tells the truth of the place. Details
exist naturally, never stacked to make the picture look
rich, never crowding out the figures.

[PALETTE — New Yorker spot illustration, warm and printed]

Background tones: cream, oatmeal, warm off-white, paper beige.
Skin tones: warm natural beige, light tan (NOT porcelain,
NOT yellow, NOT grey, NOT olive).
Accent colors used sparingly: dusty rose, muted brick red,
ochre, deep teal, navy blue, dark forest green, walnut brown.
NEVER: cold blue-grey backgrounds, neon, candy colors,
high saturation, fluorescent, magenta, electric blue, pure white.
The palette should feel like a printed magazine page: warm,
slightly desaturated, with paper grain.

[LIGHTING]

Natural window light, gentle and diffuse.
Soft fall-off. No hard shadows. NO rim light, NO HDR,
NO dramatic chiaroscuro, NO key light, NO cinematic
backlight glow.

(Composition rules are defined in the dedicated COMPOSITION
section appended after this prompt — cinematic shots,
off-center framing, narrative whitespace.)

[WHAT THIS IS NOT]

NOT anime. NOT manga. NOT cartoon. NOT glossy.
NOT commercial art. NOT a movie poster.
NOT a "beautiful AI illustration".

THIS IS a single quiet frame in a quiet literary comic
about ordinary people. That is all.
`;

/**
 * 角色参考图专用 system prompt（character reference sheet）。
 *
 * 与 IMAGE_SYSTEM_PROMPT 的关键差异：
 *  - 角色图是「白底中性模板」——只画一个角色，不画场景
 *  - IMAGE_SYSTEM_PROMPT 里 [SCENE — ordinary, lived-in, warm] 段落列举了大量
 *    咖啡馆、家里、电梯、街道等场景例子，会把场景画到角色图上
 *  - 本字段只保留 [TONE / LINEWORK / FACES / EXPRESSION / CLOTHING / PALETTE / LIGHTING] 这七个
 *    跟角色外观相关的段落，**跳过 [SCENE]**，确保角色图是白底中性立绘
 *  - 风格色调仍然保留（New Yorker 的奶油底色 / 燕麦色 / 0.3mm 钢笔细线 / 暖色调），
 *    确保角色模板与后续分镜图风格一致
 */
export const IMAGE_CHARACTER_SYSTEM_PROMPT = `
You are drawing a single character portrait for an adult literary
graphic novel in the tradition of New Yorker spot illustration
crossed with Adrian Tomine (Shortcomings, Killing and Dying).
The portrait will be reused as the visual anchor for every page
the character appears on, so it must be neutral, repeatable, and
consistent — NOT a moment captured in a location.

[TONE — NEUTRAL PORTRAIT, NOT SCENE]

This is a single character portrait on a neutral background.
It is NOT a frame from a film. It is NOT set in a cafe, an
apartment, a street. The character could be from one of those
films, but here they are presented as themselves, on paper.

[LINEWORK]

Clean, even ink outlines around every figure and object —
clearly visible, confident, one consistent weight. Never
thick, never faint, never sketchy. Like a 0.4mm technical
pen, printed on paper. NO hatching, NO crosshatching, NO
rough sketch lines. Colors are FLAT fills with at most ONE
simple cel-shadow tone (a single darker shade on the shadow
side of walls, furniture, clothing). NO airbrush gradients,
NO painterly.

[FACES — MODERN 21st-CENTURY REAL CHINESE]

Real modern Chinese faces. Not the "internet celebrity" face,
not the "anime / manga" face, not the "video game NPC" face.
The kind of face you would actually see in a Shanghai, Beijing,
Shenzhen, or Chengdu coffee shop at 4pm on a Tuesday.

Specifically:
  - Eyes: SMALL, narrow, ALMOND-SHAPED. Not "anime big". Not
    "Western round". Ordinary Chinese eyes. The whites of the
    eyes should be barely visible. Single eyelids or shallow
    double eyelids are both fine. NO eye highlights, NO
    sparkles, NO enlarged iris, NO lash-line emphasis.
  - Eyebrows: natural, not shaped, not bold, not thin.
  - Nose: medium bridge, natural width, ordinary for an East
    Asian face. NOT a "high Western nose bridge". NOT a flat
    caricature nose.
  - Mouth: closed or slightly relaxed. Natural lip color.
    Not glossy, not painted, not full.
  - Jaw / face shape: ordinary. Could be round, oval, or
    slightly square. NOT heart-shaped, NOT "V-line", NOT
    a sharp chin. NOT a wide caricature jaw either.
  - Skin: CLEAN, SMOOTH, NATURAL SKIN TONE. Normal Chinese
    skin color (warm beige to light tan, not porcelain,
    not yellow). NO visible pores, NO freckles, NO
    beauty marks. Skin looks like ordinary young-to-middle-
    aged Chinese skin — healthy, untreated, well-rested.
  - Hair: modern cut. Could be a bob, shoulder-length, short
    crop, or short back and sides for men. Natural color
    (black or very dark brown). Not styled, not dyed.

The face must look like it belongs to an ordinary person you
might sit next to on the subway. NOT a celebrity. NOT a model.
NOT a character from any animated work.

[EXPRESSION — restrained, calm, inward]

Neutral. Eyes are looking AWAY from camera — slightly to the
side, slightly down, slightly past the viewer. NOT direct eye
contact (direct gaze is reserved for important narrative beats,
not the default portrait). Quiet, slight tiredness, slight
distance. Faces are calm. Mouths are closed or slightly relaxed.
No visible emotion on the face itself — emotion lives in
posture and gaze direction.

[CLOTHING]

Real contemporary Chinese clothing for the role: cotton t-shirts,
simple cardigans, plain trousers, jeans, simple shoes. Modern
fits (not vintage, not oversized, not costume). NO logos. NO
prints. NO fashion-editor styling. Hair is modern, natural,
not styled.

[PALETTE — New Yorker spot illustration, warm and printed]

Background: clean cream / oatmeal / warm off-white / paper
beige (the New Yorker paper tone, NOT pure white, NOT cold
blue-grey). Skin tones: warm natural beige, light tan (NOT
porcelain, NOT yellow, NOT grey, NOT olive). Accent colors
used sparingly: dusty rose, muted brick red, ochre, deep
teal, navy blue, dark forest green, walnut brown. NEVER neon,
candy colors, high saturation, fluorescent, magenta, electric
blue, pure white. The palette should feel like a printed
magazine page: warm, slightly desaturated, with paper grain.

[LIGHTING]

Natural window light, gentle and diffuse. Soft fall-off.
No hard shadows. NO rim light, NO HDR, NO dramatic chiaroscuro,
NO key light, NO cinematic backlight glow.

[WHAT THIS IS NOT]

NOT anime. NOT manga. NOT cartoon. NOT glossy.
NOT commercial art. NOT a movie poster.
NOT a "beautiful AI illustration".
NOT set in any specific location (no cafe, no apartment,
no street visible in the background).

THIS IS a single character portrait that will be reused as
the visual anchor for every page the character appears on.
It is neutral, repeatable, and consistent.
`;

export const CHARACTER_HARD_CONSTRAINTS = `
Character design rules (must obey strictly):
- Real Chinese person, ordinary build, ordinary features, ordinary clothing
- No large eyes, no anime-style eyes, no eye highlights, no sparkles
- No exaggerated expressions: never crying loudly, laughing wildly,
  shouting, shocked face, or any theatrical emotion
- Subtle emotion only: a slight frown, a pause, eyes looking away,
  a quiet mouth. Emotion lives in posture and gaze, not on the face.
- Realistic skin: clean and natural, no plastic airbrushed look
- Clothing is plain and lived-in: cotton t-shirts, simple cardigans,
  plain trousers, simple shoes. No fashion-editor styling, no accessories.
- Hair is normal hair, not anime hair. No unusual colors.
- Age visible: people should look their age, neither aged up nor down.
- Body proportions are realistic. No elongated limbs, no tiny heads,
  no large heads on small bodies.
`;

export const COMPOSITION_HARD_CONSTRAINTS = `
Composition rules (cinematic, not comic-strip):
- Treat each frame as a single film shot, NOT a comic panel
- Preferred shot types: wide / long shot, medium shot, two-shot,
  over-the-shoulder, three-quarter view, detail close-up
- AVOID frontal mug-shot compositions. Slight angles feel more cinematic.
- Whitespace varies with the narrative beat: some shots are
  mostly empty wall or window, others are fuller lived-in
  interiors (bookshelves, a TV wall, a cluttered kitchen).
  Never crowded to the edges; the composition stays calm.
- Eyes looking AWAY from camera (off-screen gaze) is preferred over
  looking at camera. Direct eye contact only for important narrative beats.
- Light comes from a natural source (window, ceiling, lamp) in the scene.
  NOT a Hollywood key light.
- Background environment is described but kept simple. The scene should
  feel like a place you have actually been, not a designed set.
`;

export const SCENE_HARD_CONSTRAINTS = `
Scene / environment rules:
- Settings are everyday real places: homes (living room, kitchen,
  bedroom, hallway), cafes (ordinary chain cafes, not artisan),
  offices, elevators, supermarkets, parks, subways, buses, streets,
  restaurants, hospitals, schools.
- Settings should feel USED: a bit cluttered, with personal items,
  ordinary furniture, lived-in details. NOT minimal, NOT designed,
  NOT styled for the camera.
- Lived-in details: a coffee mug on a table, a coat on a chair,
  a phone face-down, dishes in the sink, laundry on a rack.
  These details carry narrative weight.
- Avoid: futuristic cities, fantasy realms, neon-lit cyberpunk streets,
  pristine showrooms, designer interiors. The world is the present-day
  ordinary world.
`;

export const TEXT_VS_IMAGE_RULES = `
Text rules:
- All dialogue, narration, and inner monologue go OUTSIDE the
  image, carried by the article body text, NOT in the image.
- The image contains NO readable text AT ALL: phone screens,
  signs, storefronts, book covers, labels, documents, posters
  are BLANK or faintly illegible. Rendered Chinese always comes
  out garbled — any text in the image is a FAILED output.
- NEVER add speech bubbles, thought bubbles, or narrator boxes.
- The image builds the situation; the caption completes the twist.
  Never repeat in words what the image already shows.
`;

export const EXPRESSION_HARD_CONSTRAINTS = `
Expression rules (this is critical):
- Default expression: neutral, calm, slightly inward.
- Allowed subtle states: thoughtful, hesitant, tired, mildly amused,
  quietly sad, indifferent, faintly smiling, looking away.
- Forbidden: crying, screaming, laughing with open mouth wide,
  shocked with mouth open, angry shouting, dramatic tears.
- Emotion is communicated by:
  · the angle and direction of the gaze (looking away, looking down,
    looking past someone, avoiding eye contact)
  · posture (slightly turned away, shoulders lowered, hands still)
  · distance between people (close but not touching, or apart)
  · what is NOT being said (silence)
- The reader should feel the emotion, not be told what it is.
`;

export const VISUAL_PHILOSOPHY = `
本系列不是"把现实画得漂亮"，而是"认真观察现实"。
不是"制造情绪"，而是"捕捉已经存在的情绪"。
不是"告诉读者应该怎么想"，而是"给读者一个值得想一想的瞬间"。
不是"漫画人物生活在漫画世界"，而是"普通人生活在真实世界里，只不过被我们认真地记录下来"。

New Yorker × Tomine × Graphic Novel 三维融合：
New Yorker 是 "皮"（色调、印刷感、单幅成立）、
Tomine 是 "骨"（人物克制、距离感、日常诚实）、
Graphic Novel 是 "形"（电影化镜头、留白、一格一帧）。
`;

export const STORYTELLING_RULES = `
You are writing for a literary graphic novel in the style of an
independent European / American comic. Your job is NOT to make the
story "exciting". Your job is to make it true.

Storytelling rules:
- Pace is slow. A panel can be just "a person sitting there."
- Use whitespace / silence / empty shots as narrative devices.
- Do not explain emotion. Show it through gesture, gaze, distance.
- Do not preach. Do not moralize. Do not write inspirational lines.
  Parents in the story do not know the "right answer" either.
- Avoid clichéd comic beats: setup → punchline → reversal → moral.
  Allow unresolved endings, ambiguity, no climax.
- Dialogue should be sparse, ordinary, real. People do not speak
  in elegant sentences in real life.
- The story should leave the reader with a question, not a moral.

Observational humour rules (New Yorker register):
- The joke is discovered, never announced. Build a real, calm,
  believable scene that contains one visible logical contradiction
  (e.g. the wall poster says WORK-LIFE BALANCE; the clock says 11:47pm;
  three cold coffees; everyone perfectly calm).
- Characters earnestly do unreasonable things. Nobody knows they
  are funny. No mugging, no reaction shots for the audience.
- Prefer the contrast between image and caption over any direct joke:
  the image sets up the situation, one short line completes the turn.
- Subjects: workplace absurdity, social habits, modern loneliness,
  quiet self-contradictions of ordinary life. Irony stays warm,
  never cynical for its own sake, and never preachy.
`;

export const IMAGE_SELF_CHECK_ITEMS: Array<{ id: string; question: string; failMeans: string }> = [
  { id: 'anime', question: '这张图不像日漫 / 二次元 / Q版？', failMeans: '画面太"漫画"了' },
  { id: 'cartoon-face', question: '人物面孔是现代 21 世纪真实华人（没有大眼/网红脸/二次元眼/夸张五官）？', failMeans: '面孔偏离真实' },
  { id: 'clean-skin', question: '皮肤是干净的（没有刻意放大毛孔/雀斑/瑕疵），是普通人正常皮肤状态？', failMeans: '皮肤过度修图' },
  { id: 'lines', question: '线条是细匀的（接近 0.5mm 工程笔感），不是粗描边/速写感？', failMeans: '线条过粗或太草' },
  { id: 'color-newyorker', question: '色调是 New Yorker 印刷感的暖底（奶油/燕麦/暖白），不是冷灰/亮蓝/纯白？', failMeans: '色调偏冷或偏数码' },
  { id: 'color-saturated', question: '色彩低饱和、有限、自然，不是糖果色/荧光/霓虹？', failMeans: '色彩偏离' },
  { id: 'expression', question: '表情克制（不哭不叫不瞪眼），情绪靠眼神/姿势传递？', failMeans: '表情夸张' },
  { id: 'composition', question: '构图是电影镜头感，有留白，不挤满？', failMeans: '构图太满或太漫画' },
  { id: 'real-place', question: '场景是真实生活空间（不是设计场景）？', failMeans: '场景太"舞台"' },
  { id: 'real-people', question: '人物是"你真能在街上遇到的人"（不是漫画角色）？', failMeans: '人物太"漂亮"' },
  { id: 'no-bubbles', question: '画面里没有对话气泡/旁白框/大段文字？', failMeans: '文字溢出到图里' },
  { id: 'newyorker-feel', question: '整体感觉像"New Yorker 杂志单幅插画"，而不是"AI 漂亮插画"？', failMeans: '太"AI 插画"' },
  { id: 'movie-still', question: '整体感觉像"安静的独立电影一帧"，而非"漫画格"？', failMeans: '太"漫画"' },
  { id: 'detail-economy', question: '细节是"少量准确"（凉咖啡/亮电脑）而不是堆砌？', failMeans: '细节堆砌' },
  { id: 'deadpan', question: '若有反讽/荒诞，画面是否全程平静、笑点藏在情境里被发现？', failMeans: '表演型幽默' },
];

export const STORYTELLING_TONE_RULES = STORYTELLING_RULES;