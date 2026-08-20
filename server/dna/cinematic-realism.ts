// @dna-checksum: 507fd3d403407b7318777119cd021ae5efecf788a50940c1eba6318a98304a7f
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DNA 预设三：电影化写实（Cine-Photo Realism）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  适合题材：现代都市、家庭剧、刑侦/律政、医疗、社会派。
 *  灵感：法语/意大利/韩国现实主义电影（如《无主之作》《燃烧》《薄荷糖》），
 *  视觉接近"电影截帧 + 电影感调色"，而非漫画笔触感。
 *
 *  人类可读版本：docs/style-dna/cinematic-realism.md
 *
 *  ⚠ 这是"硬约束"风格，与 New Yorker × Tomine / Shonen-Vintage 互斥。
 *  系列创建后不允许切换 DNA（防风格漂移）。
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const VISUAL_DEFINITION = `
电影化写实——画面的第一感受是"我从一部严肃电影里截了一帧"。
不是漫画笔触、不是插画、不是商业海报。是一种"几乎像剧照，但又经过细心构图"的视觉：
浅景深、自然光为主、有颗粒感的胶片质地、色温随剧情调冷或调暖、人物皮肤可见纹理与毛孔。
气质参考：《燃烧》《薄荷糖》《一次别离》《无主之作》《海边的曼彻斯特》——
真实场景、真实光、真实人物，不煽情、不说教，让观众自行判断。
`;

export const VISUAL_KEYWORDS = [
  '电影截帧感', '胶片颗粒', '自然光', '浅景深',
  '真实皮肤', '可见毛孔', '雀斑', '眼纹', '唇裂',
  '暖白平衡', '冷青阴影', '清晨 / 黄昏 / 雨夜',
  '韩国/意大利/法国现实主义电影',
  '人物即是观众', '不发问的镜头', '中景', '过肩',
  '手持微晃', '低饱和但有血色', '高光柔过渡',
];

export const VISUAL_FORBIDDEN = [
  '漫画线条', '勾线', '钢笔线', '网点', '速度线',
  '夸张五官', '大眼睛', '二次元眼',
  '新海诚', '吉卜力', '迪士尼', '皮克斯',
  'AI 漂亮插画', '商业海报', '海报式打光',
  '新纪元运动', '极简插画', 'New Yorker 单幅插画',
  '少年漫画', '热血', '爆炸光效', '七彩光',
  '粉红', '天蓝', '糖果色', '荧光色',
  '樱花飘落', '爱心', '气泡特效',
];

/**
 * Negative prompt —— 强制避开"插画/动漫/AI 风"等所有反向词。
 * 注意 cine-photo realism 的核心是"我看着不像 AI 出的"。
 */
export const IMAGE_NEGATIVE_PROMPT = [
  'illustration', 'manga', 'anime', 'comic', 'linework', 'ink line', 'pen drawing',
  'cute style', 'big eyes', 'anime eyes', 'sparkles', 'glow effect',
  'shinkai makoto', 'ghibli', 'disney', 'pixar',
  'beautiful ai illustration', 'commercial poster', 'poster lighting',
  'new yorker style', 'tomine hairlines', 'literary graphic novel',
  'shonen', 'action lines', 'speed lines', 'energy burst',
  'pastel pink', 'pastel blue', 'candy color', 'fluorescent',
  'cherry blossom petals', 'heart shape', 'bubble effect',
  '3d render', 'cgi', 'unreal engine',
  'flat color', 'cel shading',
  'porcelain skin', 'flawless skin' /* 电影化写实允许真实毛孔 */,
  'lens flare', 'god rays' /* 电影化写实不要炫光 */,
].join(', ');

export const IMAGE_SYSTEM_PROMPT = `
You are capturing a SINGLE FILM FRAME from a serious contemporary
cinema — the spirit of Hong Sang-soo (The Day He Arrives, Right
Now, Wrong Then), Nuri Bilge Ceylan (Winter Sleep, Burning),
Asghar Farhadi (A Separation), Lee Chang-dong (Burning, Peppermint
Candy), Kenneth Lonergan (Manchester by the Sea).

[TONE — FILM STILL, NOT COMIC PANEL]

This is not a panel. It is not an illustration. It is a 4:3 or
16:9 still from a feature film that is being shot on actual
locations by a director who insisted on real light, real rooms,
real weather, real silences. The viewer is reading the moment
before or after — never the climax. The camera is rarely in
the most dramatic place; it is in the most truthful place.
Skin has texture. The walls have marks. The light falls
unevenly. This is cinema — not illustration, not anime,
  not "AI art".

[LINEWORK — NONE]

There is NO ink line, NO pen stroke, NO outline. Everything is
rendered by light, focus, and color. The image is photographic
in its rendering. If you must mention "edges", describe them
as "naturally defined by light and focus", never as "outlined".

[FACES — REAL HUMANS, NOT CHARACTERS]

Faces are adult, lived-in, slightly imperfect. The pores are
visible. The eyes have dark circles. The hair is unstyled or
very simply maintained. There is no "anime shine", no "IG
filter glow". Light from the window or streetlamp falls
naturally on the cheekbone, leaving the other half in
unflattering but honest shadow. Aging is visible — a 45-year-
old looks 45. A 30-year-old looks 30. The viewer should feel
"I have seen this person somewhere".

Specifically:
  - Eyes: real human eyes. No enlarged iris, no sparkles, no
    anime shine. Bags, slight redness, and natural moisture
    are allowed and encouraged. Off-camera gaze preferred.
  - Eyebrows: slightly uneven, natural growth pattern.
  - Skin: visible texture, pores, fine lines, sun damage,
    mild redness. NO plastic / airbrushed smoothness.
    Foundation if any, is imperfect.
  - Lips: dry, sometimes chapped. Natural tone. No gloss.
  - Jaw: ordinary. A 50-year-old has softening, not a
    defined jawline.
  - Hair: unstyled. Windblown, slept-on. Slightly grey at
    temples on older characters.
  - Body posture: slightly tired, slightly tense, slightly
    unresolved. Hands are doing ordinary things (holding a
    cup, holding a phone, hanging by the side).

[CLOTHING — UNREMARKABLE]

Clothes are unremarkable. They have been worn. Maybe slightly
wrinkled, slightly pilled. Colors are muted — grey, navy,
olive, off-white, brown, charcoal. The protagonist does NOT
look fashionable. They look like a person who got dressed
this morning without thinking about it. A t-shirt with a
small visible brand logo is acceptable; a designer logo on a
plain t-shirt is not.

[SCENE — REAL LOCATIONS, NATURAL LIGHT]

The setting is a real place, photographed with a real camera.
- Living rooms with old sofas, real books on shelves, a working
  kitchen in the back.
- Offices with fluorescent lights and a dying plant on the desk.
- Cafés that have been there for 20 years, with a chalkboard
  menu and wooden chairs that don't match.
- Streets at 7am, in late autumn, with low sun raking across
  parked cars.
- Train compartments, hospital corridors, school gates at
  dismissal time, a friend's apartment at midnight.

The light comes from a real source: a window, a streetlamp, a
TV screen, an overhead kitchen light. The light has COLOR
TEMPERATURE — morning is bluish, sunset is orange, fluorescent
is greenish, tungsten is amber. The white balance is real.

[PALETTE — DESATURATED BUT ALIVE]

Backgrounds: muted earth tones, off-whites, faded blues,
weathered wood, old tile. Skin: natural, slightly warm,
slightly tired. Accent colors: a single warm object in an
otherwise cool room — a yellow notebook, a red mug, a child's
red coat in the distance. The palette should look like a
movie print, not a magazine spread.

[LIGHTING — NATURAL, FALLIBLE]

Available light is the default. Window light is the most
common. Practical lights (lamps, screens) are visible and
cast their own warm pools. Shadows are soft but real —
they fall where physics says they should. No Hollywood key
light, no dramatic rim, no "AI cinematic backlight". The
viewer should feel they could walk into the scene and find
the light switch.

[COMPOSITION — OBSERVED, NOT DESIGNED]

The camera is HANDHELD with subtle micro-movement. Slight
off-center framing. The subject is not always centered. The
viewer often sees the back of the protagonist's head
(over-the-shoulder). Depth of field is shallow — the
foreground OR the background is slightly out of focus, like
a 50mm f/1.8 lens. The camera is at the subject's eye
level, NOT below (no low-angle hero shots) and NOT above
(no god's-eye view). The frame does not call attention to
itself. It is a window, not a stage.

[WHAT THIS IS NOT]

NOT an illustration. NOT a comic panel. NOT anime. NOT manga.
NOT a "beautiful AI illustration". NOT a commercial poster.
NOT a music video still. NOT a stock photo. NOT a glamour
shot.

THIS IS a single 4:3 still from a serious contemporary film
about real people in real places. The viewer should believe
this room exists and these people will continue living in it
after the frame ends.
`;

export const CHARACTER_HARD_CONSTRAINTS = `
Character design rules (cine-photo realism edition):
- Real humans of any age. The protagonist can be 22 or 62.
- Faces are NOT attractive-by-default. Realistic skin texture
  with pores, fine lines, slight redness, occasional blemish,
  visible under-eye area. Airbrushed "IG model" faces are wrong.
- Eyes look away from camera in 80%+ of frames. Direct gaze is
  a narrative beat, not default.
- Hair is unstyled, uncolored. Windblown, slept-on, slightly
  messy. No "anime gravity-defying" shapes.
- Bodies are ordinary. Realistic proportions. Slight posture
  habits (one shoulder higher, head tilted). No "ideal" fitness
  bodies unless the story is about a sportsperson.
- Clothing is unremarkable, slightly worn. Real colors, real fits.
  Brand logos only if naturally present (e.g. a t-shirt the
  character actually bought).
- Aging is visible. A 50-year-old is NOT a 30-year-old with grey
  hair — they have softening, posture, eye-area changes.
`;

export const COMPOSITION_HARD_CONSTRAINTS = `
Composition rules (cine-photo realism edition):
- 50mm lens equivalent. Subtle wide or tight if the moment calls.
- Camera is at the SUBJECT'S eye level. No low-angle hero shots.
  No high-angle god view. The viewer sits with the character,
  not above or below them.
- Over-the-shoulder frames for dialogue moments. The viewer often
  sees the listener's neck/shoulder in the foreground, soft-focus.
- Depth of field: shallow (f/1.8-f/2.8 equivalent). One plane sharp,
  others fall naturally.
- Handheld micro-movement is acceptable — slight tilt, slight drift.
- Subject is often OFF-CENTER (rule of thirds). Negative space
  is real space (a wall, a window, an empty chair) — not designed.
- The frame does not "perform" for the viewer. It observes.
`;

export const SCENE_HARD_CONSTRAINTS = `
Scene rules (cine-photo realism edition):
- Locations are REAL: actual apartments, actual cafés, actual
  streets, actual offices. The viewer can smell the room.
- Time of day is realistic: morning before work, late afternoon
  on a Sunday, midnight in a hospital corridor. NOT golden hour
  unless the scene demands it.
- Weather is realistic: rain, snow, grey overcast, humid summer.
  NOT perpetually sunset.
- Sound of the space is implied: kitchen noise, distant traffic,
  a TV in the next room, kids playing downstairs.
- Props are LIVED-IN: a chipped mug, a worn sofa, a stack of
  unpaid bills, a child's drawing stuck to the fridge. NOT
  designer props.
- NO fantasy locations. NO cyberpunk streets. NO pristine
  showrooms.
`;

export const TEXT_VS_IMAGE_RULES = `
Text rules (cine-photo realism edition):
- Almost NO text inside the image. Real-world text (street signs,
  book covers, newspaper headlines, phone screens) is allowed
  but should be incidental, not featured.
- No speech bubbles. No thought bubbles. No narrator boxes.
- All dialogue, narration, and inner monologue live OUTSIDE the
  image, in the WeChat article body text. The image is silent
  and the words carry the voice.
- Sound design implied by image: a coffee cup being set down,
  rain on a window, the hum of a fridge — but these are
  described in the article text, not visually over-stylized.
`;

export const EXPRESSION_HARD_CONSTRAINTS = `
Expression rules (cine-photo realism edition):
- Default: inward, slightly tired, slightly unresolved. The
  character is not performing for the camera.
- Allowed subtle states: a half-finished smile, a long stare
  out a window, hands still in lap, a slow breath in. The viewer
  reads these as the trace of something that just happened or
  is about to happen.
- Forbidden: anything that reads as "performance" — exaggerated
  shock, dramatic tears, theatrical anger, anime-style shouting.
  If the character is shouting, the camera is on someone else
  in the room reacting, not on the shouter.
- Emotion is communicated by: gaze direction, posture, distance
  between bodies, the rhythm of breath implied by stillness,
  the WAY hands hold objects (gripping a cup, twisting a ring).
- The viewer should NOT be told what the character feels.
  The viewer should be left guessing — and that guessing is
  the genre's pleasure.
`;

export const VISUAL_PHILOSOPHY = `
本系列不是"画一幅好看的图"，而是"让观众相信自己看到了一帧真实电影"。
不是"制造场景感"，而是"让场景呼吸"。
不是"告诉观众应该怎么感受"，而是"把观众放进一个房间里，让感受自己发生"。
不是"角色生活在虚构漫画世界"，而是"普通人生活在真实世界里，而我们忠实地截了一帧"。

电影化写实的精神：让观众走出影院还带着那间房间的气味。
`;

/**
 * 文字生成侧的叙事节拍：电影剧本式，强调"前因后果的隐含感"。
 * 与 New Yorker × Tomine（文学漫画）的差异：电影化写实允许"场景戏"
 * ——一段没有对话、只通过动作推进的镜头。
 */
export const STORYTELLING_RULES = `
You are writing for a serious contemporary cinematic drama.
The output reads like scene descriptions and dialogue in a
screenplay — sparse, observed, subtext-heavy.

Storytelling rules:
- Each scene has a TIME and a PLACE stated before action begins.
- The viewer is given enough context to picture the room before
  any character speaks. Always ground the scene with concrete
  physical details (light, sound, weather, props).
- Dialogue is SUBTEXT-DRIVEN. What characters do NOT say is
  more important than what they say. They avoid, deflect,
  speak about other things.
- Long passages of action WITHOUT dialogue are encouraged.
  A character can do laundry, drink water, fold a shirt, and
  through that act alone, the viewer understands what just
  happened off-screen.
- Camera is mentioned sparingly — only when the angle
  reframes the meaning. (E.g. "She does not look up. The
  camera stays on her hands.")
- Avoid summarizing emotion. Show it through action: the
  character changes the subject, picks up a glass of water,
  turns to the window.
- The climax is OFF-SCREEN or barely shown. The story is
  about the AFTERMATH, not the peak. The peak has already
  happened.
- The ending is unresolved. The viewer leaves the cinema
  thinking about the character for days.
- Dialogue formatting follows screenplay convention:
  CHARACTER NAME (centered or caps)
  Action in present tense.
  Dialogue in standard quotation.
- The story should leave the viewer uncertain, slightly
  unsettled, and quiet. NOT inspired, NOT pumped, NOT
  preached at.
`;

export const STORYTELLING_TONE_RULES = STORYTELLING_RULES;

export const IMAGE_SELF_CHECK_ITEMS: Array<{ id: string; question: string; failMeans: string }> = [
  { id: 'photo-not-illustration', question: '画面看起来像照片 / 电影截帧，而不是插画 / 漫画？', failMeans: '画面太"画"了' },
  { id: 'no-line', question: '没有任何勾线 / 钢笔线 / 网点 / 速写感？', failMeans: '画面混入了漫画 DNA' },
  { id: 'skin-texture', question: '皮肤有真实纹理（毛孔 / 细纹 / 血色 / 黑眼圈），不是磨皮瓷肌？', failMeans: '皮肤过度修图' },
  { id: 'natural-light', question: '光源是自然的（窗光 / 路灯 / 室内灯），不是电影主光 / 逆光 / HDR？', failMeans: '打光太"电影海报"' },
  { id: 'real-prop', question: '道具是真实的旧物（用过的杯子、磨损的沙发），不是设计款？', failMeans: '场景太"摆"' },
  { id: 'ordinary-clothes', question: '服装日常普通（不是时尚大片，不是戏服）？', failMeans: '角色太"漂亮"' },
  { id: 'eye-level', question: '镜头在角色视线高度（不仰拍、不俯拍）？', failMeans: '镜头在"表演"' },
  { id: 'shallow-dof', question: '景深浅（f/1.8-2.8 感），有自然的前景 / 后景虚化？', failMeans: '景深太均匀像插画' },
  { id: 'off-center', question: '构图偏中线之外，不刻意平衡？', failMeans: '构图太对称' },
  { id: 'no-fantasy', question: '场景是真实世界（无未来 / 奇幻 / 赛博朋克 / 神话）？', failMeans: '场景脱离现实' },
  { id: 'cinema-feel', question: '整体感觉像韩国/意大利/法国现实主义电影一帧，而不是 AI 漂亮图？', failMeans: '太"AI 漂亮"' },
  { id: 'no-bubbles', question: '画面里没有对话气泡 / 旁白框 / 文字水印？', failMeans: '文字溢出到图里' },
];