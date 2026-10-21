/**
 * 图下文字三件套的回归测试（2026-10-20）。
 *
 * 病根：公众号预览和长图导出**只渲染对白**，把旁白（场景交代）和
 * 内心独白整层漏掉了 —— 读者看到的只有"图 + 台词"，
 * 时间、地点、前情、主角心理全部消失。
 * 而 HTML 导出（wechatHtmlExport）一直是对的 —— 两条路径结果不一致。
 *
 * 数据实测（2026-10-20）：210 格里 166 格有旁白、61 格有内心独白，
 * 也就是说**素材本来就在**，纯粹是渲染端漏了。
 */
import { describe, it, expect } from 'vitest';
import { buildPanelTextSegments, wrapRich } from './stripExport.js';

/** mock 的 canvas ctx：每个字符固定 10px 宽，够用来验证换行与字体切换。 */
function mockCtx() {
  const state = { font: '19px serif', fontsSeen: [] as string[] };
  const ctx: any = {
    get font() { return state.font; },
    set font(v: string) { state.font = v; state.fontsSeen.push(v); },
    measureText: (t: string) => ({ width: [...t].length * 10 }),
  };
  return { ctx, state };
}

describe('buildPanelTextSegments —— 图下文字三层', () => {
  it('旁白在最前，内心独白其次，对白最后（阅读节奏：由远及近）', () => {
    const segs = buildPanelTextSegments({
      dialogue: '给，先拿卡。',
      narration: '早上八点四十七分，陆远提前到了写字楼。',
      innerThought: '他不该来。',
    });
    const flat = segs.map(s => s.text).join('');
    const iNar = flat.indexOf('早上八点四十七分');
    const iInner = flat.indexOf('他不该来');
    const iDlg = flat.indexOf('给，先拿卡');
    expect(iNar).toBeGreaterThanOrEqual(0);
    expect(iInner).toBeGreaterThan(iNar);
    expect(iDlg).toBeGreaterThan(iInner);
  });

  it('旁白带「——」前缀，且不带说话人名', () => {
    const segs = buildPanelTextSegments({
      dialogue: '嗯。',
      narration: '闸机里面已经开始上班。',
      speakerName: '陆远',
    });
    const flat = segs.map(s => s.text).join('');
    expect(flat).toContain('—— ');
    expect(flat).not.toContain('陆远：闸机');
  });

  it('内心独白带 💭 前缀且是斜体', () => {
    const segs = buildPanelTextSegments({ dialogue: '嗯。', innerThought: '他不该来。' });
    const inner = segs.filter(s => s.text.includes('他不该来') || s.text.includes('💭'));
    expect(inner.length).toBeGreaterThan(0);
    expect(inner.every(s => s.italic)).toBe(true);
  });

  it('只有对白时，行为和以前完全一致（不引入多余的前缀/换行）', () => {
    const segs = buildPanelTextSegments({ dialogue: '给，先拿卡。' });
    const flat = segs.map(s => s.text).join('');
    expect(flat).toBe('给，先拿卡。');
    expect(segs.some(s => s.italic)).toBe(false);
  });

  it('说话人名仍然是砖红强调色，正文是常规色', () => {
    const segs = buildPanelTextSegments({ dialogue: '陆远：早上好。', speakerName: '陆远' });
    const speaker = segs.find(s => s.text.includes('陆远：'));
    const body = segs.find(s => s.text.includes('早上好'));
    expect(speaker).toBeDefined();
    expect(body).toBeDefined();
    expect(speaker!.color).not.toBe(body!.color);
  });

  it('空白字段不产生空段（narration/innerThought 为空串或 undefined 都要跳过）', () => {
    const segs = buildPanelTextSegments({
      dialogue: '嗯。',
      narration: '   ',
      innerThought: '',
    });
    const flat = segs.map(s => s.text).join('');
    expect(flat).not.toContain('——');
    expect(flat).not.toContain('💭');
  });

  it('不渲染 description（那是 AI 生图指令，不属于漫画正文）', () => {
    const segs = buildPanelTextSegments({
      dialogue: '嗯。',
      narration: '场景交代。',
    } as any);
    const flat = segs.map(s => s.text).join('');
    expect(flat).not.toContain('远景');
    expect(flat).not.toContain('玻璃闸机');
  });
});

describe('wrapRich —— 三层之间的换行与斜体（canvas 长图路径）', () => {
  it('\\n 强制断行，三层各自成行', () => {
    const { ctx } = mockCtx();
    const segs = buildPanelTextSegments({
      dialogue: '给，先拿卡。',
      narration: '早上八点四十七分。',
      innerThought: '他不该来。',
    });
    const lines = wrapRich(ctx, segs, 1000);
    const texts = lines.map(l => l.map(s => s.text).join(''));
    expect(texts.length).toBe(3);
    expect(texts[0]).toContain('早上八点四十七分');
    expect(texts[1]).toContain('他不该来');
    expect(texts[2]).toContain('给，先拿卡');
  });

  it('内心独白那行用斜体字体测量，旁白和对白用常规字体', () => {
    const { ctx, state } = mockCtx();
    const segs = buildPanelTextSegments({
      dialogue: '嗯。',
      narration: '场景。',
      innerThought: '心声。',
    });
    wrapRich(ctx, segs, 1000);
    expect(state.fontsSeen.some(f => f.startsWith('italic'))).toBe(true);
    expect(state.fontsSeen.some(f => f.startsWith('19px'))).toBe(true);
  });

  it('超宽自动折行（每行不超过 maxWidth）', () => {
    const { ctx } = mockCtx();
    const segs = [{ text: '一'.repeat(50), color: '#000' }];
    const lines = wrapRich(ctx, segs, 100); // 每字 10px → 每行 10 字
    expect(lines.length).toBe(5);
    for (const l of lines) {
      const w = l.reduce((a, s) => a + [...s.text].length * 10, 0);
      expect(w).toBeLessThanOrEqual(100);
    }
  });

  it('只有对白时不会多出空行（不引入回归）', () => {
    const { ctx } = mockCtx();
    const segs = buildPanelTextSegments({ dialogue: '给，先拿卡。' });
    const lines = wrapRich(ctx, segs, 1000);
    expect(lines.length).toBe(1);
    expect(lines[0].map(s => s.text).join('')).toBe('给，先拿卡。');
  });
});
