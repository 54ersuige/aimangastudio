// @dna-checksum: 800b15eef10b0fb30ff06b389f23ae030de6c7f29904f7b3a6a8330d07584c72
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
`;

export const VISUAL_KEYWORDS = [
  'New Yorker 单幅叙事', '杂志插画质感', '印刷品质感',
  '欧美文艺', '独立漫画', 'Graphic Novel', '都市生活',
  '写实但不照片化', '克制', '安静', '内敛', '温和', '微妙',
  '真实', '生活感', '文学感', '电影感', '留白',
  '不煽情', '不说教', '不刻意可爱', '不商业插画化', '不网红漫画化',
  '奶油黄底', '燕麦色', '粉赭红棕点缀', '单幅独立成立',
];

export const VISUAL_FORBIDDEN = [
  '动画片', '商业儿童绘本', '网红漫画', '日漫', '二次元',
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
  '3D render', 'CGI', 'game CG',
  'commercial illustration', 'stock illustration style',
  'speech bubbles', 'thought bubbles', 'narrator boxes',
  'dramatic lighting', 'rim light', 'chiaroscuro',
  'perfect body', 'perfect face', 'flawless skin',
  'looking at camera', 'eye contact with viewer',
].join(', ');

export const IMAGE_SYSTEM_PROMPT = `
You are drawing a single panel for an adult literary graphic novel,
in the tradition of New Yorker spot illustration crossed with
Adrian Tomine (Shortcomings, Killing and Dying).

[TONE — NEW YORKER × TOMINE]

This is one frame from a quiet independent film, set down on paper.
The image should look like it could appear as a stand-alone
New Yorker cover or spot illustration: it tells its whole story
in a single still moment. Cream / oatmeal paper tone, soft
muted palette with small touches of dusty rose, ochre, and
brick red. The mood is gentle, slightly autumnal, literary.
Not melancholy — quiet. The kind of quiet where you can hear
the air conditioner.

[LINEWORK]

Pencil-fine black ink lines. As thin as a single hair.
Same width everywhere — no thick outlines anywhere.
Lines look printed, not painted. Like a 0.3mm pen drawing.
NO hatching, NO crosshatching, NO shadow lines, NO painterly.
The figure is defined by OUTLINE only, with FLAT color fills
inside (no airbrush shading).

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
Eyes are looking AWAY from camera — out a window, at an object,
at the table. NOT at the viewer. NOT at the other character.
Quiet, slight tiredness, slight distance.
Faces are calm. Eyes are calm. Mouths are closed or slightly
relaxed. No visible emotion on the face itself — emotion lives
in the posture and gaze direction.

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
minimalist, NOT artisan, NOT stark.

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

[COMPOSITION]

Cinematic. Medium two-shot, medium shot, or wider.
Off-center framing. At least 25% of the frame should be wall,
table, window, or pure negative space — not crowded with detail.
Empty space is REQUIRED, not optional. Allow the eye to rest.

[WHAT THIS IS NOT]

NOT anime. NOT manga. NOT cartoon. NOT illustration.
NOT commercial art. NOT glossy. NOT cinematic-CG.
NOT a movie poster. NOT a key visual.
NOT 3D render. NOT painterly.
NOT a "beautiful AI illustration".

THIS IS a single quiet frame in a quiet literary comic
about ordinary people. That is all.
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
- Negative space / whitespace is REQUIRED and varies with narrative.
  A shot can be 30% subject and 70% empty wall, table, or window.
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
- Most dialogue, narration, and inner monologue go OUTSIDE the image,
  carried by the WeChat article body text, NOT in the image.
- The image may contain text ONLY when it exists in the real scene:
  phone screens, street signs, storefronts, book covers, product labels.
- NEVER add speech bubbles, thought bubbles, or narrator boxes.
  The image should read like a film still, not a comic panel.
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
];

export const STORYTELLING_TONE_RULES = STORYTELLING_RULES;