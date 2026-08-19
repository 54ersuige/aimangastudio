/**
 * 一次性脚本：用 v1.1 DNA 生成参考图，保存到 docs/references/。
 * 与 server/graphic-novel-dna.ts 中 v1.1 的 IMAGE_SYSTEM_PROMPT 保持一致。
 * 运行：node tools/regen-dna-reference.cjs
 */
const fs = require('fs');
const path = require('path');
// API key 从环境变量读取：set AGNES_API_KEY=sk-xxx && node tools/regen-dna-reference.cjs
const API_KEY = process.env.AGNES_API_KEY;
if (!API_KEY) {
  console.error('Missing AGNES_API_KEY environment variable. Example: AGNES_API_KEY=sk-xxx node tools/regen-dna-reference.cjs');
  process.exit(1);
}
const BASE_URL = 'https://apihub.agnes-ai.cn/v1';

const IMAGE_SYSTEM_PROMPT = `
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
    beauty marks. The skin looks like ordinary young-to-middle-
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

const NEGATIVE = [
  'anime', 'manga', 'chibi', 'cartoon', 'big eyes', 'cute style',
  'large eyes', 'huge eyes', 'anime eyes', 'eye highlights',
  'sparkly eyes', 'glossy eyes',
  'exaggerated expression', 'shock face', 'laughing loudly',
  'high saturation', 'neon colors', 'candy colors', 'fluorescent',
  'magenta', 'electric blue',
  'cold blue-grey', 'pure white background',
  'glossy skin', 'plastic skin', 'pores, freckles, beauty marks',
  'speed lines', 'action lines', 'thick cartoon outlines', 'bold outlines',
  'thick lines', 'heavy lines', 'painterly',
  '3D render', 'CGI', 'game CG',
  'commercial illustration', 'stock illustration style',
  'speech bubbles', 'thought bubbles', 'narrator boxes',
  'dramatic lighting', 'rim light', 'chiaroscuro', 'key light',
  'cinematic backlight',
  'perfect body', 'perfect face', 'flawless skin',
  'looking at camera', 'eye contact with viewer',
].join(', ');

const SCENES = [
  {
    filename: '01-two-shot-coffee-shop.png',
    prompt: `Two modern Chinese people in their early 30s sitting across from each other in an ordinary, slightly worn chain coffee shop on a weekday afternoon. The woman has just finished saying something. The man is looking out the window at the street, not responding to her. Natural soft window light from the right. He wears a plain modern navy t-shirt, she wears a simple light beige cardigan over a plain white t-shirt. Plain wooden table between them with two paper coffee cups, one nearly finished. The wall behind is cream/oatmeal colored, with a small framed picture. Outside the window: ordinary Chinese street, low-rise buildings, a tree.`,
  },
  {
    filename: '02-over-shoulder-silence.png',
    prompt: `Over-the-shoulder shot in an ordinary Chinese apartment living room on a late weekday afternoon. A young Chinese woman (about 30) is in the foreground, slightly out of focus, her back to the camera, sitting on a worn sofa. In the background, a young Chinese man (about 32) is visible sitting on a wooden chair across the room, his face turned three-quarters toward a window on the right. He is not speaking, just sitting there. The room is plainly furnished: an old wooden bookshelf with mixed books, a small TV on a low cabinet, a mug on a side table. The wall is warm cream. Soft diffuse window light. Real lived-in clutter: a pair of shoes by the door, a folded blanket on the sofa arm.`,
  },
  {
    filename: '03-detail-empty-coffee.png',
    prompt: `Detail shot of a wooden kitchen table in a Chinese apartment, late morning. On the table: a half-finished ceramic mug of coffee, an open paperback Chinese novel face-down with a folded corner, a pair of black reading glasses folded on the book, a small bunch of keys. Background: a kitchen counter, slightly out of focus, with a dish towel hanging from a drawer pull. The wall is warm cream. Soft natural window light from the left. No people in the frame. The table has water marks and small scratches. Empty shot — the absence of a person is the point.`,
  },
];

async function genImage(prompt, filename) {
  const body = {
    model: 'agnes-image-2.1-flash',
    prompt: `${IMAGE_SYSTEM_PROMPT}\n\n---\n\n[Scene]\n${prompt}`,
    n: 1,
    aspect_ratio: '3:4',
    negative_prompt: NEGATIVE,
  };
  console.log(`生成 ${filename}...`);
  const res = await fetch(`${BASE_URL}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  const data = await res.json();
  const first = data.data?.[0];
  let b64;
  if (first.b64_json) b64 = first.b64_json;
  else if (first.url) {
    const imgRes = await fetch(first.url);
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    b64 = buffer.toString('base64');
  } else throw new Error('No image data');

  const outPath = path.join(__dirname, '..', 'docs', 'references', filename);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
  const kb = (b64.length * 0.75 / 1024).toFixed(0);
  console.log(`  ✓ ${filename} (${kb} KB)`);
}

(async () => {
  for (const s of SCENES) {
    await genImage(s.prompt, s.filename);
  }
  console.log('\n=== 全部完成 ===');
  console.log('输出位置：docs/references/');
})().catch(e => { console.error('失败:', e); process.exit(1); });