/**
 * 从分镜 description 中提取面向读者的可读文字。
 * description 通常以镜头术语开头（"远景，""中景，""特写，"等），
 * 后面才是可读的叙事文字。去掉镜头术语部分，返回剩余内容。
 * 如果无法提取（太短或全是术语），返回空字符串。
 */
function extractReadableText(description: string): string {
  if (!description) return '';
  // 去掉开头的镜头术语：远景/中景/近景/特写/全景/侧影/俯拍/仰拍/跟拍 等
  const cleaned = description.replace(
    /^(远景|中景|近景|特写|全景|侧影|俯拍|仰拍|跟拍|鸟瞰|微距|长镜头)[，,。\s]*/i,
    '',
  );
  // 去掉括号里的镜头标注，如"（侧影）""（背影）"
  const noBrackets = cleaned.replace(/[（(][^）)]*(?:侧影|背影|正面|侧面|背影|特写)[^）)]*[）)]/g, '');
  // 如果剩余文字太短（< 5 字），说明没有可读内容
  if (noBrackets.replace(/\s/g, '').length < 5) return '';
  return noBrackets.trim();
}

/**
 * 把"旁白"和"对话"在视觉上区分开：
 *  - 旁白（narration）：灰色、居中或左对齐，无名字前缀，描述场景/心理/客观叙述
 *  - 对话（dialogue）：斜体、引号包裹，开头带角色名（"周默：..." 或 "「周默：...」"）
 *
 * 判断"是不是对话"的启发式：
 *  - dialogue 以「 开头  → 对话（不加前缀）
 *  - dialogue 含「角色名：」或「"角色名："」→ 对话（已经有名字）
 *  - 否则 → 视为旁白（不强制加名字）
 *
 * 当判断为对话但缺名字时，由 caller 用 panel.characterIds 决定要不要补。
 */
function splitNarrative(panel: { dialogue?: string; description: string; characterIds: string[] }, speakerName?: string): {
  dialogue: string;
  narration: string;
} {
  const raw = (panel.dialogue || '').trim();
  const descReadable = extractReadableText(panel.description);
  if (!raw) return { dialogue: '', narration: descReadable };
  // dialogue 看起来已经是带引号的对白（「...」）
  if (/^[「『]/.test(raw)) {
    return { dialogue: raw, narration: descReadable };
  }
  // dialogue 自带"名字："前缀 → 对话
  if (/^[\s\u4e00-\u9fff]{1,8}[：:]/.test(raw) && (panel.characterIds.length === 0 || raw.length < 80)) {
    return { dialogue: speakerName ? `「${speakerName}：${raw}」` : `「${raw}」`, narration: descReadable };
  }
  // 否则视为旁白（描述场景/心理，灰色不带名字）
  return { dialogue: '', narration: raw };
}

export { extractReadableText, splitNarrative };
