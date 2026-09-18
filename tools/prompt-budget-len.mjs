// 测量 buildCharacterImagePrompt 的旧→新版本长度增量 + Step 512 截断实测
const characterNew = {
  name: '周薇',
  appearance: '齐耳黑色短发、瘦小、约 165cm、皮肤偏白、五官小巧；职业装偏清新简约；眼神敏感',
  gender: 'female',
  ageBand: 'young_adult',
  sexTraits: '柔和下颌线、小巧耳垂、明显锁骨弧线、无喉结、细眉',
  age: '22',
  height: '165cm',
  build: '瘦小',
  hair: '黑色齐耳短发，左分',
  eyes: '深棕，常见微眯',
  outfit: '白衬衫 + 浅灰九分裤 + 帆布鞋',
  signature: '思考时咬笔；随身带不锈钢保温杯',
  visualAnchors: ['齐耳黑色短发', '左眼下小痣', '右肩斜挎帆布包', '银色细项链'],
};

const worldview = { artStyle: 'New Yorker 城市叙事 × Tomine 都市写实', paletteMood: '奶油/燕麦暖白 + 蓝灰墨绿' };

function buildCharPrompt(c) {
  const traits = [];
  // v2 紧凑版（2026-09-01）
  if (c.gender) traits.push(`Gender: female.`);
  if (c.ageBand) traits.push(`Age: young adult.`);
  if (c.sexTraits) traits.push(`Sex traits: ${c.sexTraits.length > 80 ? c.sexTraits.slice(0, 78) + '…' : c.sexTraits}`);
  const allTraits = traits.concat([
    c.age ? `年龄：${c.age}` : '',
    c.height ? `身高：${c.height}` : '',
    c.build ? `体型：${c.build}` : '',
    c.hair ? `发型与发色：${c.hair}` : '',
    c.eyes ? `眼睛：${c.eyes}` : '',
    c.outfit ? `服装：${c.outfit}` : '',
    c.signature ? `标志物/习惯动作：${c.signature}` : '',
  ]).filter(Boolean);
  const anchorText = `\n视觉锚点（必须全部出现在画面中）：${c.visualAnchors.join('、')}`;
  const traitText = `\n${allTraits.join('\n')}`;
  const styleMood = `\n系列基调参考：${worldview.artStyle}，${worldview.paletteMood}（若与系统规范冲突，以系统规范为准）。`;
  const shotEmphasis = `\n【本张图的核心职责】这是一张"4 视图参考表"（character sheet）。后续分镜图需要从这张图里"借"角色，4 个 view 共享同一张脸是这张图存在的全部理由。`;
  // 4 视图 promptTail 的近似长度（实际 ~1350 字符）
  const promptTail = '\n【风格锁定...Style lock...character reference sheet, 2x2 grid...four-view turnaround...hard constraints × 7]';
  const hardReqs = `
【硬性要求 —— 生图时必须逐条检查，任何一条不满足即视为失败】
1. 【仅一人】...
2. 【纸色底】...
3. 【发型与发色】...
4. 【年龄 / 体型 / 服装】...
5. 【视觉锚点】...
6. 【镜头结构】...
7. 【柔和光照】...
8. 【线型统一】...
9. Sex traits visibility...`;
  return `角色设定图（character reference — 4 视图参考表）。${promptTail}${shotEmphasis}${styleMood}\n综合外貌：${c.appearance}${traitText}${anchorText}\n${hardReqs}`;
}

// 旧版 prompt（不含性别/年龄/sexTraits）
function buildCharPromptOld(c) {
  const traits = [
    c.age ? `年龄：${c.age}` : '',
    c.height ? `身高：${c.height}` : '',
    c.build ? `体型：${c.build}` : '',
    c.hair ? `发型与发色：${c.hair}` : '',
    c.eyes ? `眼睛：${c.eyes}` : '',
    c.outfit ? `服装：${c.outfit}` : '',
    c.signature ? `标志物/习惯动作：${c.signature}` : '',
  ].filter(Boolean);
  const anchorText = `\n视觉锚点（必须全部出现在画面中）：${c.visualAnchors.join('、')}`;
  const traitText = `\n${traits.join('\n')}`;
  const styleMood = `\n系列基调参考：${worldview.artStyle}，${worldview.paletteMood}（若与系统规范冲突，以系统规范为准）。`;
  const shotEmphasis = `\n【本张图的核心职责】这是一张"4 视图参考表"（character sheet）。后续分镜图需要从这张图里"借"角色，4 个 view 共享同一张脸是这张图存在的全部理由。`;
  const promptTail = '\n【风格锁定...Style lock...character reference sheet, 2x2 grid...four-view turnaround...hard constraints × 7]';
  const hardReqs = `
【硬性要求 —— 生图时必须逐条检查，任何一条不满足即视为失败】
1. 【仅一人】...
2. 【纸色底】...
3. 【发型与发色】...
4. 【年龄 / 体型 / 服装】...
5. 【视觉锚点】...
6. 【镜头结构】...
7. 【柔和光照】...
8. 【线型统一】...`;
  return `角色设定图（character reference — 4 视图参考表）。${promptTail}${shotEmphasis}${styleMood}\n综合外貌：${c.appearance}${traitText}${anchorText}\n${hardReqs}`;
}

const oldChar = { ...characterNew, gender: undefined, ageBand: undefined, sexTraits: undefined };

const oldPrompt = buildCharPromptOld(oldChar);
const v1Prompt = buildCharPrompt(oldChar).replace(/Gender: female\.\nAge: young adult\.\nSex traits: /, '性别 Gender：female (woman / girl)\n年龄段 Age band：young adult (20-34 years old)\n性别可辨识外部特征 Sex-distinctive traits（必须全部画出）：');

const oldP = buildCharPromptOld(oldChar);
const newP = buildCharPrompt(oldChar);

console.log('=== 角色参考图 prompt 长度对比（promptTail 用 ~600 字符近似） ===');
console.log(`纯业务段 prompt（旧版）：${oldP.length} 字符`);
console.log(`v1 中文长描述版       ：${v1Prompt.length} 字符（增量 +${v1Prompt.length - oldP.length}）`);
console.log(`v2 紧凑英文 token 版  ：${newP.length} 字符（增量 +${newP.length - oldP.length}）`);

console.log('\n=== 假设包含完整 prefix 与业务 prompt（约 9500 字符）===');
const prefixApprox = 6500; // 估算 IMAGE_SYSTEM_PROMPT 等总和
const totalP1 = prefixApprox + sepLen() + v1Prompt.length;
const totalP2 = prefixApprox + sepLen() + newP.length;
console.log(`Agnes 路径：prefix(6500) + sep(12) + 业务 prompt = 总 ${prefixApprox + 12 + newP.length} 字符`);
console.log(`          旧版本：${prefixApprox + 12 + oldP.length} 字符`);
console.log(`是否触发 9500 截断：${prefixApprox + 12 + newP.length > 9500 ? '是' : '否'}`);

console.log('\n=== Step provider 512 截断实测 ===');
const stepNew = newP.slice(-512);
const stepOld = oldP.slice(-512);
console.log(`旧版最后 512 字符：含「性别」？${/性别/.test(stepOld)}, 含「年龄」？${/年龄/.test(stepOld)}, 含「Age」？${/Age/.test(stepOld)}`);
console.log(`新版最后 512 字符：含「性别」？${/性别/.test(stepNew)}, 含「年龄」？${/年龄/.test(stepNew)}, 含「Age」？${/Age/.test(stepNew)}, 含「Sex」？${/Sex/.test(stepNew)}`);

// 模拟真实 promptTail 长度：约 1300 字符
function realLengthTest() {
  const traitLenNew = newP.length - oldP.length; // 增量
  console.log(`\n=== 加上更真实的 promptTail（~1350 字符）+ styleRefs note（~250 字符） ===`);
  console.log(`真实 prompt（v2 紧凑）：${oldP.length + 1350 - 600 + traitLenNew} 字符（估算，业务 + 1350 + styleRefs）`);
  // 整体：prefix(6500) + sep(12) + 业务(约 800) + styleRefs note(250) ≈ 7562, < 9500 OK
  const total = 6500 + 12 + newP.length + 250;
  console.log(`  全套组合估算：约 ${total} 字符（Agnes 9500 上限内）`);
}
realLengthTest();

function sepLen() { return `\n\n---\n\n[Scene]\n`.length; }
