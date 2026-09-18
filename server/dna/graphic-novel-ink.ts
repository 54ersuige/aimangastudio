// @dna-checksum: 1a40b7bd35a0810bc7269ed40cf8a5999253fe08575fdf29abb6474e8aa94020
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DNA 预设四：排线文学 Graphic Novel（Graphic Novel Ink）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  适合题材：都市情感、家庭剧、职场现实、生活观察、公众号长漫。
 *  灵感：欧美成人写实 Graphic Novel —— David Mazzucchelli（《Asterios Polyp》
 *  前的都市写实）、Sean Phillips（《Criminal》）、Craig Thompson 的排线质感。
 *
 *  2026-09-09 实测依据（tools/style-bakeoff.mjs）：
 *  agnes-image-2.1-flash 的训练分布偏向高信息密度写实渲染，
 *  「细密排线 + 4-5 色有限色板」在两场景对照中风格签名最稳定、零 anime 漂移，
 *  是该模型最可靠的漫画风格；细线极简（new-yorker-noir）则是其短板风格。
 *
 *  人类可读版本：docs/style-dna/graphic-novel-ink.md
 *
 *  ⚠ 这是"硬约束"风格，与其他三套 DNA 互斥。
 *  系列创建后不允许切换 DNA（防风格漂移）。
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const VISUAL_DEFINITION = `
排线文学 Graphic Novel——画面的第一感受是"我在读一本严肃的欧美成人漫画小说"。
不是日系动漫、不是照片、不是水彩插画。是一种"钢笔排线构建体积、有限色板上色"的视觉：
细密而自信的墨线、交叉排线塑造明暗、4-5 色的克制色板、米纸暖底的留白呼吸感。
气质参考：David Mazzucchelli 的都市写实、Sean Phillips 的冷硬犯罪分镜、
Craig Thompson 的排线密度——文学性藏在排线的耐心里，情绪藏在色板的克制里。
`;

export const VISUAL_KEYWORDS = [
  '欧美写实 Graphic Novel 细密排线',
  '钢笔交叉排线', '自信墨线', '线即是阴影',
  '4-5 色有限色板', '暖灰主调', '砖红点缀', '墨青阴影', '米纸黄暖底',
  '都市写实', '日常肌理', '克制的情绪',
  '中景', '过肩', '视线高度', '留白呼吸感',
  'David Mazzucchelli', 'Sean Phillips', 'Craig Thompson',
  '写实当代', '文学性分镜',
];

export const VISUAL_FORBIDDEN = [
  '日系动漫', '大眼睛', '二次元', '赛璐璐高光', '贴纸质感',
  '新海诚', '吉卜力', '迪士尼', '皮克斯', 'chibi',
  '照片写实', '摄影质感', '3D 渲染', 'CGI',
  '水彩晕染', '铅笔草稿感', '纯白背景模板',
  '高饱和', '糖果色', '荧光色', '霓虹灯', '赛博朋克',
  '速度线', '爆炸光效', '爱心气泡', '樱花飘落',
  '漫画分格多格', '对话气泡', '图内文字',
];

/**
 * Negative prompt —— 以 "Avoid:" 文本注入 prompt 末尾（Agnes 不接收
 * negative_prompt 参数，见 dna-inject.ts）。必须包含 photograph /
 * photorealistic（防玻璃幕墙/晨光反射等场景词把模型拖进摄影分布，
 * 2026-08-31 风格回归复盘）与 anti-anime 全套词。
 */
export const IMAGE_NEGATIVE_PROMPT = [
  'anime', 'manga', 'big eyes', 'anime eyes', 'chibi',
  'cel shading', 'anime shine', 'sparkles', 'glow effect',
  'shinkai makoto', 'ghibli', 'disney', 'pixar',
  'photograph', 'photorealistic', 'photo', '3d render', 'cgi', 'unreal engine',
  'watercolor', 'pencil sketch', 'model sheet', 'white background sketch',
  'high saturation', 'candy color', 'fluorescent', 'neon', 'cyberpunk',
  'speed lines', 'action lines', 'energy burst',
  'cherry blossom petals', 'heart shape', 'bubble effect',
  'western face', 'caucasian face', 'deep-set eyes', 'high nose bridge',
  'comic panel grid', 'multiple panels', 'speech bubbles', 'text', 'watermark', 'signature',
].join(', ');

export const IMAGE_SYSTEM_PROMPT = `
[STYLE LOCK — READ FIRST]

This is a standalone illustration from a European adult literary
graphic novel in the tradition of David Mazzucchelli, Sean Phillips
and Craig Thompson. The rendering is INK LINEWORK WITH CROSS-
HATCHING over a LIMITED MUTED PALETTE of 4-5 tones (warm grey,
brick red, ink-blue shadow, cream paper yellow). Every form is
built by confident pen strokes and cross-hatching — never by soft
airbrush, never by photographic rendering, never by anime cel
shading. This style lock overrides anything else in the prompt.

[LINEWORK — THE BONES]

Ink line is the structural truth of the image. Line weight varies
with light: thin dry strokes on lit planes, dense cross-hatching
in shadow. Hatching follows the form — curved on a shoulder,
angular on a table edge. Small imperfections in the line are
welcome; they read as hand-made. NO soft gradients, NO airbrush,
NO digital glow. Shadow is BUILT FROM LINES, not from a dark
transparency layer.

[PALETTE — 4-5 TONES, NO MORE]

A limited palette of warm grey (dominant), cream paper yellow
(light), ink-blue (shadow), brick red (single accent), olive or
ochre (secondary). Flat but slightly uneven color fills, like a
hand-printed book. Large areas stay calm and muted; one brick-red
object per frame may carry the emphasis. No high saturation, no
candy color, no neon, no glossy black.

[FACES — ORDINARY PEOPLE, DRAWN NOT AIRBRUSHED]

Faces are adult, specific, lived-in. Eyes are small and realistic
— never enlarged, never sparkling, never anime. Wrinkles, eye
bags and stubble are drawn with a few precise strokes. Aging is
visible: a 45-year-old looks 45. Hair is drawn as masses with
linear texture, not shiny CG clumps. Bodies have ordinary
proportions and ordinary posture — slightly tired, slightly
hunched from work and life.

[ETHNICITY — EAST ASIAN BY DEFAULT]

The graphic-novel lineage named above is about ART STYLE ONLY —
it never changes the characters' ethnicity. Unless the prompt
states otherwise, every character has an East Asian Chinese face:
straight black hair; a relatively flat facial plane with a low
brow ridge; narrower, longer eye openings; a lower, softer nose
bridge; gentle cheekbones. NEVER draw Western/Caucasian faces —
no deep-set eyes, no high prominent nose bridge, no heavy brow
ridge. Only if the prompt explicitly states another ethnicity
may you deviate.

[CLOTHING — WORN, NOT STYLED]

Everyday clothes: wrinkled shirts, unglamorous jackets, soft
collars. Rendered with simple line folds and two-tone fills.
No fashion editorial, no pristine uniforms, no glowing fabric.

[SCENE — REAL PLACES, DRAWN WITH PATIENCE]

Real urban places: a small apartment kitchen, a subway platform,
an office corridor, a street food stall at dusk, a hospital
waiting area. Backgrounds are drawn with quieter, thinner lines
so the figures come forward. Everyday props matter: a chipped
mug, a lunch box, a folding umbrella, stacked bills. The city is
realistic and contemporary — no fantasy, no cyberpunk, no neon.

[LIGHTING — SIMPLE AND PHYSICAL]

One clear light source per frame: a window, a streetlamp, an
overhead bulb. Light and shadow are expressed through hatching
density. Dusk and overcast are the natural mood; warm pools of
interior light against cool streets are welcome. No dramatic rim
light, no volumetric god rays, no lens flare.

[COMPOSITION — QUIET AND LITERARY]

Camera at the subject's eye level. Medium shots and over-the-
shoulder frames preferred; the subject is often slightly off-
center with breathing room of cream-paper stillness around them.
The frame observes rather than performs. It is a page from a
novel, not a movie poster.

[WHAT THIS IS NOT]

NOT anime. NOT manga screentone. NOT a photograph. NOT a 3D
render. NOT a watercolor painting. NOT a children's book. NOT a
multi-panel comic page — this is ONE standalone illustration,
full-bleed, no borders, no speech bubbles, no text.

THIS IS a single standalone illustration from a serious European
adult graphic novel about ordinary contemporary life. The viewer
should believe the ink was laid down by a patient human hand.
`;

export const CHARACTER_HARD_CONSTRAINTS = `
Character design rules (graphic novel ink edition):
- Ordinary contemporary people of any age. A 40-year-old looks 40
  — visible aging, realistic face structure.
- Faces are drawn, not airbrushed: small realistic eyes, precise
  wrinkle strokes, ordinary noses. NO enlarged anime eyes, NO
  sparkle highlights, NO pretty-boy/girl template faces.
- Bodies have realistic proportions and habitual posture (a
  carrying shoulder, a tired neck). Hands are drawn carefully —
  they are doing ordinary things.
- Clothing is unremarkable and slightly worn; folds are stated
  with line, fills stay within the 4-5 tone palette.
- Character identity must stay consistent: hair shape, glasses,
  build and dominant clothing color are the identity anchors.
- Era is realistic contemporary. No fantasy costume, no uniform
  fantasy armor, no neon streetwear.
`;

export const COMPOSITION_HARD_CONSTRAINTS = `
Composition rules (graphic novel ink edition):
- Single standalone illustration. Full-bleed. NO panel borders,
  NO gutters, NO multi-panel grid, NO speech balloons.
- Camera at eye level. Medium shot or over-the-shoulder by
  default; wide shots only when the city itself is the subject.
- Subject slightly off-center (rule of thirds), with quiet cream-
  paper negative space around the figure for breathing room.
- Foreground/background separation comes from line density:
  figures hatched denser, backgrounds thinner and lighter.
- No dutch angles, no fish-eye distortion, no low-angle hero
  shots, no god's-eye view.
`;

export const SCENE_HARD_CONSTRAINTS = `
Scene rules (graphic novel ink edition):
- Real, contemporary, urban-ordinary locations: apartment
  kitchens, subway platforms, offices, schools, streets, small
  restaurants, hospital corridors.
- Lived-in props: chipped mugs, lunch boxes, umbrellas, old
  sofas, stacked dishes. Drawn with quieter lines than the
  figures.
- Time of day is realistic and specific: 6:50am kitchen light,
  9pm platform after work, overcast Sunday afternoon.
- Weather and season stay ordinary: rain, heat, overcast, first
  cold snap. NO perpetually golden hour.
- NO fantasy locations, NO cyberpunk streets, NO neon nightscapes,
  NO pristine showrooms, NO luxury penthouses unless the story
  demands one.
`;

export const TEXT_VS_IMAGE_RULES = `
Text rules (graphic novel ink edition):
- NO text inside the image. NO speech bubbles, NO thought
  bubbles, NO narrator captions, NO sound-effect lettering, NO
  watermarks, NO signatures.
- All dialogue and narration live OUTSIDE the illustration, in
  the article body below the image.
- If the real scene contains signage, render it as vague
  suggestion (a few abstract marks), never as readable letters —
  invented letterforms drift into gibberish and break the page.
`;

export const EXPRESSION_HARD_CONSTRAINTS = `
Expression rules (graphic novel ink edition):
- Default register: restrained, inward, literary. The face is a
  few honest strokes — a lowered gaze, a tired blink, the
  beginnings of a smile quickly put away.
- Emotion is carried by posture, hand position, distance between
  people, and where the eyes are NOT looking.
- Forbidden: exaggerated shock, streaming tears, theatrical
  anger, open-mouthed anime shouting, sweat-drop comedy marks.
- If a moment needs strong emotion, show the aftermath: the
  gripped handrail, the untouched cup, the turned back.
`;

/**
 * 角色参考图专用 system prompt（character reference sheet）。
 *
 * 2026-08-31 复盘教训：'character sheet / 2x2 grid' 模板词会把模型拖向
 * model-sheet 训练分布（白底素描 / 水彩写实 / 淡铅笔人）。所以：
 *  - STYLE LOCK 放在最前面；
 *  - 明确 NOT a model sheet / NOT white-background sketch；
 *  - 人物占画面高度 75-85%；
 *  - 背景用米纸暖底而非纯白。
 */
export const IMAGE_CHARACTER_SYSTEM_PROMPT = `
[STYLE LOCK — READ FIRST]

A single character reference illustration drawn in the SAME
European adult graphic novel style as the series: ink linework
with cross-hatching, limited muted palette (warm grey, brick red,
ink-blue, cream paper yellow), confident hand-made pen strokes.
NOT a model sheet. NOT a white-background sketch. NOT anime. NOT
a photograph. NOT watercolor.

[FRAMING — ONE FIGURE, FULLY PRESENT]

Exactly one character, standing, full body visible from head to
feet, the figure filling 75-85% of the frame height, centered
slightly off-axis. A neutral warm cream-paper background with a
soft ink-line ground shadow — no furniture, no scenery, no props
except what the character always carries (e.g. glasses, a bag).

[FACES — DRAWN, SPECIFIC, LIVED-IN]

Small realistic eyes, precise wrinkle strokes, ordinary nose and
jaw, hair drawn as linear masses. Aging is visible and correct
for the stated age. No anime enlargement, no airbrush, no
sparkle.

[ETHNICITY — EAST ASIAN BY DEFAULT]

The graphic-novel art style NEVER implies Western faces. Unless
the prompt states otherwise, this character has an East Asian
Chinese face: straight black hair; flat facial plane, low brow
ridge; narrower longer eye openings; lower softer nose bridge;
gentle cheekbones. NEVER draw a Caucasian face — no deep-set
eyes, no high prominent nose bridge, no heavy brow. Deviate only
if the prompt explicitly states another ethnicity.

[VIEWS — ONE POSE, THREE ANCHORS]

Front-facing three-quarter view by default; if multiple views
are explicitly requested, keep the SAME face, hair, build and
outfit across views, aligned on one shared horizon line, evenly
spaced, with NO labels, NO arrows, NO annotation text between
them.

[PALETTE — SAME LIMITED PALETTE]

Skin in warm paper tones with light hatch shading; clothing in
the series palette (warm grey / brick red / ink-blue / olive),
flat uneven fills like a hand-printed book.

THIS IS the visual anchor for one character who must stay
identical across every page of a serialized graphic novel.
`;

export const VISUAL_PHILOSOPHY = `
本系列不是"画一张漂亮的图"，而是"用耐心排线记录普通人的生活"。
不是"炫技的墨线"，而是"线即是阴影、线即是时间的投入"。
不是"高饱和的情绪轰炸"，而是"4-5 个颜色里安放的全部悲欢"。
不是"角色生活在虚构漫画世界"，而是"普通人生活在真实城市里，而我们用钢笔忠实记下了一页"。

排线文学 Graphic Novel 的精神：读者合上书后，还会想起那格排线里的沉默。
`;

/**
 * 文字生成侧的叙事节拍：文学 Graphic Novel 式——观察、留白、潜台词。
 * 与电影化写实的差异：允许"页码感"的章节呼吸，允许少量内心独白。
 */
export const STORYTELLING_RULES = `
You are writing for a European adult literary graphic novel about
ordinary contemporary life.

Storytelling rules:
- Ground every scene in concrete physical detail: the light, the
  sound, the props, the weather. The reader must be able to draw
  the room before anyone speaks.
- Dialogue is short, oblique, subtext-heavy. Characters deflect,
  talk about dinner, and mean something else.
- Interior monologue is allowed but rationed — at most one short
  passage per scene, plain words, no purple prose.
- Ordinary actions carry the plot: packing a lunch box, missing
  a train, washing a single bowl. The reader understands the
  marriage, the job, the debt — from these acts.
- The climactic moment usually happens OFF the page; what lands
  on the page is the silence right after it.
- End scenes unresolved. The reader should want to turn the page,
  not feel lectured.
- Dialogue is natural, age-appropriate, spoken Chinese as people
  actually talk — never expository, never slogan-like.
- Chapter rhythm: each installment is a quiet complete breath —
  a small question raised, a small truth revealed, life going on.
`;

export const STORYTELLING_TONE_RULES = STORYTELLING_RULES;

export const IMAGE_SELF_CHECK_ITEMS: Array<{ id: string; question: string; failMeans: string }> = [
  { id: 'ink-hatching', question: '画面以钢笔排线构建体积（线即阴影），而不是软喷笔 / 照片渲染？', failMeans: '排线骨架丢失' },
  { id: 'limited-palette', question: '色板克制在 4-5 色内（暖灰主调 + 米纸黄 + 墨青 + 砖红点缀）？', failMeans: '色板失控、色彩过饱和' },
  { id: 'not-anime', question: '眼睛小而写实，无 anime 大眼 / 高光星芒 / 赛璐璐分色？', failMeans: '漂移进动漫分布' },
  { id: 'not-photo', question: '画面是手绘排线质感，而不是照片 / 3D 渲染？', failMeans: '被场景词拖进摄影分布' },
  { id: 'not-watercolor', question: '没有水彩晕染 / 铅笔草稿感 / 白底模板感？', failMeans: '混入 model-sheet 分布' },
  { id: 'age-correct', question: '角色年龄与设定一致（40 岁画成 40 岁）？', failMeans: '年龄漂移' },
  { id: 'lived-in-props', question: '道具是真实的旧物（缺口杯子、饭盒），不是设计款？', failMeans: '场景太"摆"' },
  { id: 'eye-level', question: '镜头在视线高度，构图安静偏中轴之外？', failMeans: '镜头在"表演"' },
  { id: 'no-text', question: '图内无对话气泡 / 文字 / 水印，路牌只作抽象暗示？', failMeans: '图内出现乱码假字' },
  { id: 'single-illustration', question: '是单幅完整插画（无分格 / 无边框 / 无多格）？', failMeans: '出现漫画分格' },
  { id: 'paper-breathing', question: '画面有米纸色留白呼吸感，而不是塞满细节？', failMeans: '背景过密压住人物' },
];
