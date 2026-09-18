// 探测脚本：验证「参考图 → agnes 请求体」的链路是否完整、字段是否正确。
// 不真实调用 agnes API（不消耗额度），只打印最终 HTTP body。
//
// 用法：
//   cd server
//   node --import tsx tools/verify-ref-payload.mjs
import { CHARACTER_REFERENCE_SHOTS } from '../series-routes.ts';
import { buildImageDirective } from '../dna/registry-bridge.ts';
import { getDna } from '../dna/registry.ts';
import { withDnaImagePrompt } from '../dna-inject.ts';

function check(label, cond, detail) {
  console.log(`${cond ? '✅' : '❌'} ${label}${detail ? `  →  ${detail}` : ''}`);
  return cond;
}

console.log('\n=== Part 1: closeup promptTail 静态校验 ===\n');
const sheet = CHARACTER_REFERENCE_SHOTS.find(s => s.id === 'sheet');
const closeup = CHARACTER_REFERENCE_SHOTS.find(s => s.id === 'closeup');

check('sheet promptTail 包含 2x2 grid', /2x2 grid/.test(sheet.promptTail));
check('sheet promptTail 包含 front view full body', /front view, full body/.test(sheet.promptTail));
check('closeup promptTail 包含 passport photo 关键词', /passport photo/.test(closeup.promptTail));
check('closeup promptTail 包含 face reference 关键词', /face reference/.test(closeup.promptTail));
check('closeup promptTail 包含 TIGHT CROP', /TIGHT CROP/.test(closeup.promptTail));
check('closeup promptTail 包含 hairline touches top edge', /hairline touches the top edge/.test(closeup.promptTail));
check('closeup promptTail 包含 chin sits at bottom edge', /chin sits at the bottom edge/.test(closeup.promptTail));
check('closeup promptTail 包含 IGNORE outfit 指令', /IGNORE the outfit/.test(closeup.promptTail));
check('closeup promptTail 不含 NO full body 负向词', !/NO full body/.test(closeup.promptTail));
check('closeup promptTail 不含 NO xxx 系列负向词（不应回退到负向清单）', !/\bNO (shoulders|chest|torso|arms|hands|waist|legs|feet)\b/i.test(closeup.promptTail));
check('closeup aspectRatio === 1:1', closeup.aspectRatio === '1:1', `当前值：${closeup.aspectRatio}`);
check('closeup promptTail 长度合理（400-1100 字符）', closeup.promptTail.length > 400 && closeup.promptTail.length < 1100, `当前：${closeup.promptTail.length}`);

console.log('\n=== Part 2: DNA 注入链路校验 ===\n');
for (const dnaKey of ['new-yorker-noir', 'cinematic-realism', 'shonen-vintage']) {
  try {
    const dna = getDna(dnaKey);
    const directive = buildImageDirective(dnaKey, { purpose: 'character', shotKind: 'closeup' });
    check(`[${dnaKey}] IMAGE_CHARACTER_SYSTEM_PROMPT 已加载`, directive.includes(dna.IMAGE_CHARACTER_SYSTEM_PROMPT.slice(0, 80)), `长度：${directive.length}`);
    check(`[${dnaKey}] closeup 跳掉了 EXPRESSION_HARD_CONSTRAINTS`, !directive.includes(dna.EXPRESSION_HARD_CONSTRAINTS.slice(0, 80)));
    check(`[${dnaKey}] closeup 跳掉了 TEXT_VS_IMAGE_RULES`, !directive.includes(dna.TEXT_VS_IMAGE_RULES.slice(0, 80)));
  } catch (e) {
    check(`[${dnaKey}] DNA 可正常加载`, false, String(e).slice(0, 100));
  }
}

console.log('\n=== Part 3: DNA 负面词 vs closeup 关键词 冲突检测 ===\n');
for (const dnaKey of ['new-yorker-noir', 'cinematic-realism', 'shonen-vintage']) {
  const dna = getDna(dnaKey);
  const neg = dna.IMAGE_NEGATIVE_PROMPT.toLowerCase();
  const conflicts = [];
  for (const word of ['full body', 'half body', 'waist up', 'standing pose', 'legs']) {
    if (neg.includes(word)) conflicts.push(word);
  }
  check(`[${dnaKey}] DNA IMAGE_NEGATIVE_PROMPT 不含 closeup 反向词`, conflicts.length === 0, conflicts.length > 0 ? `冲突词：${conflicts.join(', ')}` : '（无冲突）');
}

console.log('\n=== Part 4: agnes provider 请求构造验证（不真实调用） ===\n');
const fakeRefDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const req = {
  prompt: '[mock panel prompt] 单人单场景，画面聚焦于这一格的描述内容。',
  referenceImages: [
    { data: fakeRefDataUrl, mimeType: 'image/png' },
    { data: fakeRefDataUrl, mimeType: 'image/png' },
  ],
  aspectRatio: '3:4',
};
const finalReq = withDnaImagePrompt(req, { dnaKey: 'new-yorker-noir' });

check('withDnaImagePrompt 不丢失 referenceImages', finalReq.referenceImages?.length === 2, `length=${finalReq.referenceImages?.length}`);
check('withDnaImagePrompt 不丢失 aspectRatio 3:4', finalReq.aspectRatio === '3:4');
check('withDnaImagePrompt 注入了 system prompt', finalReq.prompt.length > req.prompt.length, `原长 ${req.prompt.length} → 后 ${finalReq.prompt.length}`);

const body = {
  model: 'agnes-image-2.1-flash',
  prompt: finalReq.prompt.slice(0, 80) + '...(省略)',
  n: 1,
  aspect_ratio: finalReq.aspectRatio,
};
if (finalReq.referenceImages && finalReq.referenceImages.length > 0) {
  body.image = finalReq.referenceImages.map(img => img.data.slice(0, 40) + '...(省略 base64)');
}

check('agnes HTTP body.image 字段含 2 张参考图', Array.isArray(body.image) && body.image.length === 2, `body.image 长度：${body.image?.length}`);
check('agnes HTTP body.aspect_ratio === 3:4', body.aspect_ratio === '3:4');

console.log('\n=== Part 5: 完整模拟的 agnes body 长这样（关键字段） ===\n');
console.log(JSON.stringify({
  ...body,
  image: body.image ? `[${body.image.length} 张 base64 data URL]` : undefined,
}, null, 2));

console.log('\n=== 完成 ===\n');
console.log('所有 ✅ 表示链路完整。');