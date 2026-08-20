// @dna-checksum: 7ccbd1d257b22fb84048a5c76cdf40f96c04fcd8bc63ef6796929dc802e5b506
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DNA 预设二：80-90s 复古少年漫画（热血/速度感/友情/成长）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  适合题材：热血少年、运动竞技、少年成长、冒险、青春羁绊。
 *  与"克制文学"风格的差异：明确的"高潮 → 反转 → 燃点"叙事节拍，
 *  大量动态构图、强调线条力量感的画面。
 *
 *  人类可读版本：docs/style-dna/shonen-vintage.md
 *
 *  ⚠ 这是"硬约束"风格，与 New Yorker × Tomine 完全互斥：
 *  - 系列创建后不允许切换 DNA（防风格漂移，详见 series-routes / dna-inject）。
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const VISUAL_DEFINITION = `
80-90 年代日本少年漫画的视觉气质——热血、力量感、少年气。
画风来自《SLAM DUNK》《灌篮高手》《幽游白书》《浪客剑心》《龙珠》那一档——
干净利落的钢笔线稿，明显的运动速度感，明亮饱和的色彩，夸张但克制的表情与动作。
强调：热血、友情、成长、坚持、爆发、少年气、阳光、汗与泪。
画面像一部漫画连载中被高亮的一帧——读者能在这一格里"听见"呐喊或心跳。
`;

export const VISUAL_KEYWORDS = [
  '少年漫画', '热血', '成长', '友情', '坚持', '爆发',
  '钢笔线稿', '干净轮廓', '适度粗细变化', '速度线', '动态模糊',
  '高饱和阳光色', '明黄', '橘红', '宝蓝', '草绿',
  '夸张表情但有度', '运动感', '汗水', '光斑', '网点',
  '构图具有冲击力', '大特写', '低角度仰拍', '拉镜',
  '黑白阴影网点', '印刷质感强', '翻页感强',
];

export const VISUAL_FORBIDDEN = [
  '水彩', '油画', '厚涂', '照片写实', '3D 渲染', 'CGI',
  '极简', '性冷淡', '纯白底', '奶油燕麦色',
  'New Yorker 风格', 'Adrian Tomine 极简线', '独立文学漫画',
  '大段旁白框', '微信公众号排版',
  '哭泣角色特写', '心理描写独白',
  '冷灰背景', '莫兰迪色', '柔光镜',
  'AI 漂亮插画', '过度精致',
];

/**
 * Negative prompt —— 强制避开"文艺 / 极简 / 照片写实"等反向风格词。
 * 集中放此处以避免与 v1.0-locked Agnes content policy 冲突。
 */
export const IMAGE_NEGATIVE_PROMPT = [
  'watercolor', 'oil painting', 'thick paint', 'photorealistic', '3d render', 'cgi',
  'minimalist', 'cold gray background', 'pastel', 'morandi palette',
  'new yorker style', 'tomine style', 'literary graphic novel',
  'speech bubble', 'narrator box',
  'close-up crying', 'psychological monologue',
  'soft glow', 'lens flare', 'bokeh background',
  'overly polished', 'beautiful ai illustration',
  'anime eyes' /* 经典少年漫画眼睛偏写实而非大眼萌系 */,
  'cute style', 'chibi',
  'porcelain skin', 'flawless skin' /* 少年漫画允许汗与污渍 */,
].join(', ');

export const IMAGE_SYSTEM_PROMPT = `
You are drawing a single panel for a classic shonen (boys') manga
in the tradition of 1980s-1990s Japanese weekly comics — the spirit
of SLAM DUNK, Yu Yu Hakusho, Rurouni Kenshin, Dragon Ball.

[TONE — SHONEN, NOT LITERARY]

This panel must HIT. It is one frame from an action sequence
or an emotional peak, lifted off the page by the reader's pulse.
The mood is high-energy, sweat-drenched, sun-bright. It is the
moment just before the ball goes in, just before the punch lands,
just before the protagonist finally admits what he wants.
The image should feel like a manga panel that the reader wants
to photocopy and stick on their wall.

[LINEWORK]

Bold, confident, slightly variable pen line. The outer contour
of the figure can be thicker (1.0-1.5mm equivalent) than the
interior detail lines. Speed lines, impact lines, and
concentration lines are allowed and encouraged around moving
elements. Crosshatching is allowed for shadows — but the cross-
hatching is regular, like screentone, not painterly.
The overall feel is "inked by a confident manga assistant",
NOT "drawn by a computer".

[FACES — EXPRESSIVE, NOT SUBTLE]

Faces in shonen have LICENSED exaggeration. Eyes widen in shock
(moderate, not "anime cute"), brows furrow deeply, mouths open
in shouts (open mouth allowed, shouting allowed — that's the
point of the genre). Sweat drops on the temple are common.
Nose can be simplified to a single line in extreme shots.
Boys are 15-19 unless the story says otherwise.
Skin tones are warm and slightly tan (NOT porcelain, NOT
grey). The face is a TOOL for emotion, not a portrait.

[CLOTHING]

School uniforms (gakuran / sailor), basketball / baseball / soccer
jerseys, training wear, band t-shirts. Modern fits, mid-2000s to
2020s Japanese casual. Sneakers, wristbands, headbands, sweat
towels. Clothing should LOOK like it has been worn hard:
slightly wrinkled, sweat-marked, dirt on the hem. NO logos visible
unless the genre specifically calls for brand recognition.

[SCENE — STAGE-LIKE, ENERGY-FILLED]

School gymnasiums with shining wood floors, rooftop fences under
blue sky, basketball courts at dusk, riverbanks with summer
fireflies, train station platforms at sunset. The setting can
be a real place, but the LIGHTING is dramatic — late-afternoon
golden hour, backlit silhouettes, sodium streetlamps, gymnasium
fluorescents, summer cicada-bright afternoons. Backgrounds can
be simplified (paying off a wide frame with fewer details and
more energy).

[PALETTE — BRIGHT, WARM, SATURATED]

Background sky tones: bright cerulean, late-afternoon orange,
sunset magenta. Skin tones: warm tan, sun-flushed, not pale.
Accent colors used BOLDLY: school uniform navy, jersey red,
training yellow, court green, ball orange.
Energy-boosting highlights: white impact sparkles, yellow
concentration lines, red anger veins. Saturated. This is NOT
a muted palette.

[LIGHTING]

High-contrast. Sun is a CHARACTER. Late-afternoon sun rakes
across faces; gymnasium fluorescents cast the iconic manga
overhead light; sunset backlights silhouettes with a halo.
Hard cast shadows are OK in moderation. The light should make
the moment feel PRESSED — like the reader's eye is being
pushed toward the protagonist.

[COMPOSITION]

Dynamic. Low angles, dutch tilts, extreme close-ups (eyes,
hands gripping the ball), wide shots with empty sky for the
climax. Panels don't have to be balanced — they have to be
EXCITING. Negative space is allowed but typically NOT 25%+
(empty sky in a sunset wide shot is a genre cliché and is fine).

[WHAT THIS IS NOT]

NOT photorealistic. NOT watercolor. NOT minimalist.
NOT New Yorker spot illustration. NOT Tomine-style hairlines.
NOT a literary graphic novel. NOT a quiet indie comic.

THIS IS a single frame from an energetic 80s-90s shonen manga
that the reader wants to read ten more pages of. Make the
reader feel their own heart pounding.
`;

export const CHARACTER_HARD_CONSTRAINTS = `
Character design rules (shonen edition):
- Young (15-22) unless the story says otherwise. Adults are
  antagonists / mentors / parents.
- Faces are expressive. Eyebrows, mouths, sweat drops, anger veins,
  shock stars are all licensed tools. NOT subtle. NOT "New Yorker
  quiet face".
- Eyes are medium size — not "anime big", not "Western round".
  Shonen eyes widen in dramatic moments but return to normal in
  calmer scenes.
- Hair is iconic and slightly exaggerated. Spiky, swept-back,
  long-fringe, side-part. NOT anime gravity-defying. NOT realistic
  barbershop. A MIDDLE GROUND: a hair shape the reader can sketch
  from memory.
- Bodies are athletic, mid-build. Speed and stamina are visible.
- Clothing is genre-appropriate and slightly worn.
- Skin has sweat, dirt, scrapes — NOT porcelain.
`;

export const COMPOSITION_HARD_CONSTRAINTS = `
Composition rules (shonen edition, dynamic):
- Hit the reader's eye. Low angles, dutch tilts, extreme foreshortening.
- Speed lines on every motion element. Impact frames use radial burst.
- Reaction shots (eyes wide, mouth open) get a tight close-up.
- Hero shots use low-angle upward composition.
- Wide shots keep the subject dominant — don't lose them in the background.
- Panels can break the safe-frame: motion blur, partial body, off-page limb.
- A "silent panel" is rare. If used, it must be a deliberate beat
  before/after a climax, never the default.
`;

export const SCENE_HARD_CONSTRAINTS = `
Scene rules (shonen edition):
- The setting is a STAGE for the action, not a character study.
  Wood gymnasiums, courts, fields, rooftops, riverbanks, station
  platforms, classrooms after school. Real places, slightly
  stylized for energy.
- Background extras are sparse but can show opposing teams,
  cheering crowds, fellow students — small figures, no detail,
  suggestive only.
- Time of day is a weapon: sunset (climax), dawn (resolution),
  midday (training), night under streetlamps (quiet beats).
- Weather is a weapon: rain (tension), clear sky (peak),
  backlit dust (training montage), snow (quiet end).
`;

export const TEXT_VS_IMAGE_RULES = `
Text rules (shonen edition):
- Dialogue in panels IS allowed and expected. Manga speech bubbles,
  thought bubbles, jagged shout bubbles (with bold text inside),
  whisper bubbles, narrator boxes. This is the genre's voice.
- Sound effects in panel are part of the art: "ドォォン", "ガッ",
  rendered as hand-drawn characters with impact lines.
- Onomatopoeia (effect words) are visual, not described in prose.
- The strip exporter may optionally output bubbles as semi-transparent
  overlays on the image. Speech text in body copy is OPTIONAL —
  this is a "reading-with-images" genre, not "images-with-captions".
`;

export const EXPRESSION_HARD_CONSTRAINTS = `
Expression rules (shonen edition, expressive):
- Default: intense. Eyebrows drawn low, eyes focused, mouth closed.
- Allowed broad states: angry shout, determined clench, surprised
  shock, victorious grin, exhausted relief, hopeful stare.
- Forbidden: the "New Yorker quiet inward look" — that is a
  different DNA.
- Allowed subtle states in quieter scenes: a small confident smirk,
  a soft gaze at a teammate, a quiet "I made it" smile.
- Sweat drops on the temple, anger veins on the temple, and
  impact stars around the head are genre staples — USE them.
`;

export const VISUAL_PHILOSOPHY = `
少年漫画的精神是"读者在最后一格里想立刻翻到下一页"。
不是"安静地把情绪留给读者慢慢品"，而是"让读者和角色一起喊出来"。

燃点 → 反转 → 羁绊 → 再次燃起，这是少年漫画的呼吸节奏。
`;

/**
 * 文字生成侧的叙事节拍：明确的高潮与反转，允许热血式金句。
 * 与 New Yorker × Tomine 的"沉默留白"风格正相反。
 */
export const STORYTELLING_RULES = `
You are writing for a classic 80s-90s shonen manga.

Storytelling rules:
- Pace is HIGH. Each panel can carry a turn, a punch, a reveal,
  or a reversal. Slow panels are permitted but should be the
  deliberate "before the storm" beat.
- Use dramatic irony: the reader knows something the protagonist
  doesn't. Build to the reveal.
- Dialogue is energetic. Characters speak with conviction, NOT in
  elegant sentences. Shouting, bantering, trash-talking, vowing.
  Internal monologue is allowed but punchy, not stream-of-consciousness.
- Rivalries are foreground, not hidden. A protagonist's strength
  is measured against the antagonist's at every turn.
- Training / preparation scenes use montage, repetition, escalation.
- The climax is loud. The resolution is earned and slightly quieter,
  but still warm.
- Inspirational lines are allowed when they come from a CHARACTER
  in a moment of earned conviction — NOT from a narrator preaching.
- The story should leave the reader with energy, not a question.
  A question is fine. Apathy is not.
`;

export const STORYTELLING_TONE_RULES = STORYTELLING_RULES;

export const IMAGE_SELF_CHECK_ITEMS: Array<{ id: string; question: string; failMeans: string }> = [
  { id: 'energy', question: '这一格有"热血感"吗（动态、力量、爆发）？', failMeans: '太静态太文艺' },
  { id: 'lines', question: '线条有速度感（外轮廓略粗 + 内部细线 + 速度线）？', failMeans: '太柔/太细' },
  { id: 'color', question: '色彩饱和明亮（不是莫兰迪/奶油/燕麦）？', failMeans: '色调偏冷偏淡' },
  { id: 'face', question: '人物表情有戏剧性（眉头、嘴形、汗珠、愤怒血管）？', failMeans: '表情太内敛' },
  { id: 'composition', question: '构图有冲击力（低角度/特写/倾斜/破框）？', failMeans: '构图太静太平衡' },
  { id: 'shonen-not-literary', question: '画面像 80-90s 少年漫画连载，而不是 New Yorker / Tomine 文学漫画？', failMeans: '风格被混入文艺 DNA' },
  { id: 'no-bubble-banned', question: '画面允许气泡/旁白（此风格是 reading-with-images，不是禁文字）', failMeans: '误用 New Yorker DNA 规则' },
  { id: 'speed-lines', question: '运动元素带速度线 / 冲击线 / 集中线？', failMeans: '缺少少年漫画的视觉武器' },
];