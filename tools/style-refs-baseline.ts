// 生成 graphic-novel-ink 的画风基准图候选（供用户挑选后放入 server/data/style-refs/graphic-novel-ink/）。
// 运行：cd server && node --import tsx ../tools/style-refs-baseline.ts
//
// 要点：
//  - 走与生产分镜完全相同的 prompt 组装路径（buildPanelImagePrompt + withDnaImagePrompt purpose:'panel'），
//    这样基准图与正式出图的"分布"一致，画风迁移才有效。
//  - 不使用任何角色参考图（该 DNA 目前没有基准图，正是要用这批补上）。
//  - 场景刻意避开本系列（加油boy）的角色与标志物（连帽卫衣/工牌），
//    避免基准图把人物身份带进画面（基准图说明里也明令禁止参考图人物出现在结果中）。
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../server/config.js';
import { getImageProvider } from '../server/series-routes/helpers.js';
import { buildPanelImagePrompt } from '../server/series-routes/prompts.js';
import { withDnaImagePrompt } from '../server/dna-inject.js';

const dnaKey = 'graphic-novel-ink' as const;
// 取自系列「加油boy」worldview，保证与生产一致的画风/色调措辞
const STYLE = '钢笔细线交叉排线构建体积，Mazzucchelli 与 Sean Phillips 式都市写实、冷硬克制的文学分镜，实心墨块压暗部，米纸暖底大量留白，不用网点、不用高光、不用描边光效。';
const MOOD = '奶油米纸底 + 赭石棕、暗砖红、灰蓝墨、一点哑金，共 4-5 色，低饱和印刷颗粒感。';

type Candidate = {
  id: string;
  scene: string;
  desc: string;
  extras?: { name: string; appearance: string }[];
};

// 6 个候选，覆盖不同景别/主体，用来考察同一画风是否在不同内容上稳定自洽
const CANDIDATES: Candidate[] = [
  {
    id: '01-still-life-desk',
    scene: '深夜的开放式办公区一角，只剩一盏台灯亮着，光锥落在桌面上',
    desc: '静物空镜：桌面上一只喝了一半的搪瓷马克杯、摊开的笔记本、一支扣着笔帽的钢笔、一只未拆的快递纸盒。侧顶光拉开长阴影，桌面木纹与纸页厚度用密集排线刻画',
  },
  {
    id: '02-midshot-clerk',
    scene: '凌晨的便利店收银台后，冷白灯管与货架的纵深',
    desc: '中景：一个二十出头的东亚青年店员靠着收银台站着，视线落在门外雨里，一只手撑着台面。深色围裙工作服，肩背略塌，脸上是熬到后半夜的钝感',
    extras: [{ name: '店员', appearance: '东亚中国面孔，二十出头男性，偏瘦，黑色短发被压扁贴在额上，单眼皮，眼下一圈淡青' }],
  },
  {
    id: '03-closeup-face',
    scene: '清晨出租屋窗边，百叶窗把光切成横条落在人的半张脸上',
    desc: '面部近景特写：一个四十岁上下的东亚男性侧脸，颧骨薄、下颌线清楚，法令纹浅，眼神停住不动。面部体积完全靠交叉排线的疏密来塑造，暗部用实心墨块压住',
    extras: [{ name: '中年男性', appearance: '东亚中国面孔，四十岁上下男性，脸型偏长，短发，胡渣淡，颈侧有细纹' }],
  },
  {
    id: '04-city-street',
    scene: '雨夜的城市街道，人行道上的积水映着楼上的灯，远处是公交站台',
    desc: '远景全景：湿透的柏油路面、行道树的枝干、街边停着的自行车、玻璃幕墙立面。所有招牌一律处理成无字的抽象色块与几何图形，画面里不出现任何可读文字',
  },
  {
    id: '05-over-shoulder-two',
    scene: '晚高峰的地铁车厢，扶手杆与吊环在头顶连成一片',
    desc: '过肩双人：从一个人肩后望过去，对面坐着一男一女，各自低头看着手里的手机，互不交流。车厢连接处的光从侧面扫进来，人物轮廓几乎融进暗部',
    extras: [
      { name: '乘客甲', appearance: '东亚中国面孔，三十岁上下男性，寸头，圆领针织衫，肩宽' },
      { name: '乘客乙', appearance: '东亚中国面孔，二十多岁女性，齐耳短发，米色风衣，脖颈细' },
    ],
  },
  {
    id: '06-hands-cup',
    scene: '走廊尽头的暖气片旁，光线从高处斜切下来',
    desc: '手部近景特写：一双成年人的手交叠着握住一只纸杯，指节清楚、指甲修短，拇指压着杯壁的接缝。手指的圆柱体积与杯口的椭圆透视都要准确，排线顺着指背的走向走',
  },
];

const config = getConfig().image;
const provider = getImageProvider(config);
const OUT = (n: string) => fileURLToPath(new URL(`./style-bakeoff/${n}`, import.meta.url));

for (const c of CANDIDATES) {
  const prompt = buildPanelImagePrompt({
    style: STYLE,
    mood: MOOD,
    sceneDescription: c.scene,
    description: c.desc,
    charDescLines: [],
    boundCharNames: [],
    anchorText: '',
    extraCharacters: c.extras,
  });
  const req = withDnaImagePrompt({ prompt, aspectRatio: '3:4' }, { dnaKey, purpose: 'panel' });
  let done = false;
  for (let attempt = 1; attempt <= 4 && !done; attempt++) {
    try {
      const img = await provider.generateImage(config, req);
      fs.writeFileSync(OUT(`gni-baseline-${c.id}.png`), Buffer.from(img.image.split(',')[1], 'base64'));
      console.log(`✅ ${c.id} 已生成（prompt ${req.prompt.length} 字符）`);
      done = true;
    } catch (e: any) {
      console.warn(`⚠️  ${c.id} 第 ${attempt} 次失败：${String(e?.message || e).slice(0, 160)}`);
      if (attempt < 4) await new Promise(r => setTimeout(r, attempt * 4000));
    }
  }
  if (!done) console.log(`❌ ${c.id} 全部尝试失败`);
}
console.log('\n输出目录：tools/style-bakeoff/gni-baseline-*.png');
