/**
 * 重生成风格基准图（New Yorker × Tomine × Graphic Novel）。
 * 与 tools/regen-dna-reference.cjs 的场景一致，但 prompt 前置强化"非动漫"锚点，
 * 每场景生成 2 个候选供人工目检。输出：tools/style-candidates/
 */
import fs from 'fs';
import path from 'path';

const API_KEY = process.env.IMAGE_API_KEY || '';
const BASE_URL = 'https://apihub.agnes-ai.cn/v1';
const OUT = path.join(process.cwd(), 'tools', 'style-candidates');

// 前置风格锚点 —— 图像模型对开头 token 权重最高
const STYLE_LEAD = `
EDITORIAL MAGAZINE ILLUSTRATION for The New Yorker, in the manner of
Adrian Tomine's graphic novels (Shortcomings, Killing and Dying) and
Chris Ware's literary comics. Grown-up literary graphic novel art.
Flat matte gouache-style color, thin even black pen lines (single weight),
muted dusty palette, heavy visible paper grain, generous negative space.

ABSOLUTELY FORBIDDEN: anime, manga, webtoon, moe faces, big glossy eyes,
pointed chins, idol-pretty faces, bold outlines, saturated candy colors,
clean digital vector lineart, glossy skin. This is NOT Japanese comic art.
The people look like ordinary real Chinese adults seen on a subway:
small narrow almond eyes, natural brows, ordinary jaws, flat calm expressions.
`;

const NEGATIVE = [
  'anime', 'manga', 'webtoon', 'chibi', 'cartoon', 'big eyes', 'cute style',
  'anime eyes', 'eye highlights', 'sparkly eyes', 'pointed chin', 'idol face',
  'high saturation', 'neon colors', 'candy colors', 'fluorescent',
  'magenta', 'electric blue', 'cold blue-grey', 'pure white background',
  'glossy skin', 'plastic skin',
  'speed lines', 'action lines', 'thick cartoon outlines', 'bold outlines',
  'painterly', '3D render', 'CGI', 'game CG',
  'commercial illustration', 'stock illustration style',
  'speech bubbles', 'thought bubbles', 'narrator boxes',
  'dramatic lighting', 'rim light', 'chiaroscuro', 'cinematic backlight',
  'looking at camera',
].join(', ');

const SCENES = [
  {
    id: '01',
    name: '01-two-shot-coffee-shop',
    prompt: `Two modern Chinese people in their early 30s sitting across from each other in an ordinary, slightly worn chain coffee shop on a weekday afternoon. The woman has just finished saying something. The man is looking out the window at the street, not responding. Natural soft window light from the right. He wears a plain navy t-shirt, she wears a simple beige cardigan over a white t-shirt. Plain wooden table with two paper coffee cups. Cream wall with one small framed picture. Outside the window: ordinary low-rise Chinese street, a tree. Off-center framing, at least a quarter of the frame is quiet empty wall.`,
  },
  {
    id: '02',
    name: '02-over-shoulder-silence',
    prompt: `Over-the-shoulder shot in an ordinary Chinese apartment living room, late weekday afternoon. A woman (about 30) in the foreground, back to the camera, slightly out of focus, sitting on a worn sofa. In the background a man (about 32) sits on a wooden chair, face turned three-quarters toward a window, not speaking. Plainly furnished: old wooden bookshelf with mixed books, small TV on a low cabinet, a mug on a side table. Warm cream walls, soft diffuse window light, lived-in clutter: shoes by the door, a folded blanket on the sofa arm.`,
  },
  {
    id: '03',
    name: '03-detail-empty-coffee',
    prompt: `Detail shot of a wooden kitchen table in a Chinese apartment, late morning, no people. On the table: a half-finished ceramic mug of coffee, an open paperback Chinese novel face-down with a folded corner, folded black reading glasses, a small bunch of keys. Background: slightly out-of-focus kitchen counter with a dish towel. Warm cream wall, soft natural window light from the left. Water marks and small scratches on the table. The absence of a person is the point.`,
  },
];

async function genImage(prompt, outFile) {
  const body = {
    model: 'agnes-image-2.1-flash',
    prompt: `${STYLE_LEAD}\n---\n[Scene]\n${prompt}\n\nRemember: New Yorker editorial illustration, flat matte color, thin even ink lines, muted dusty palette, paper grain, realistic ordinary Chinese adults, quiet literary mood. NO anime, NO manga, NO webtoon, NO big glossy eyes, NO bold outlines, NO candy colors.`,
    n: 1,
    aspect_ratio: '3:4',
  };
  const res = await fetch(`${BASE_URL}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const first = data.data?.[0];
  let b64;
  if (first.b64_json) b64 = first.b64_json;
  else if (first.url) {
    const imgRes = await fetch(first.url);
    b64 = Buffer.from(await imgRes.arrayBuffer()).toString('base64');
  } else throw new Error('No image data');
  fs.writeFileSync(outFile, Buffer.from(b64, 'base64'));
  console.log(`  ✓ ${path.basename(outFile)} (${Math.round(b64.length * 0.75 / 1024)} KB)`);
}

fs.mkdirSync(OUT, { recursive: true });
for (const s of SCENES) {
  for (const tag of ['a', 'b']) {
    console.log(`生成 ${s.name}-${tag}...`);
    await genImage(s.prompt, path.join(OUT, `${s.id}-${tag}.png`));
  }
}
console.log('\n完成，候选在 tools/style-candidates/');