import React, { useEffect, useState } from 'react';

/**
 * 手动编辑的 3 个 modal：
 *   - <CharacterEditor>    编辑角色的名字 / 描述 / 性格 / 动机 / 视觉锚点
 *   - <ChapterEditor>      编辑章节的标题 / 剧情摘要 / 核心冲突 / 预计页数
 *   - <PanelsEditor>       编辑页的 panel 列表（增/删/改文案/重排）
 *
 * 设计目标：用户可以在不调用 AI 的前提下直接修改 AI 已生成的产物并保存；
 *          对话式 AI 修改仍保留为另一条路径。
 */
import type { SeriesCharacter, Chapter, SeriesPage, Panel, CharacterGender, CharacterAgeBand } from '../types';
import { CHARACTER_GENDERS, CHARACTER_AGE_BANDS } from '../types';
import type { PanelInput } from '../services/seriesClient';

/** 性别枚举 → 中文 UI 标签（2026-09-01 新增，集中一处避免散落）。 */
const GENDER_LABEL: Record<CharacterGender, string> = {
  female: '女（女性角色）',
  male: '男（男性角色）',
  ambiguous: '中性（性别模糊的角色）',
  nonbinary: '非二元（不按二元性别表达）',
};
/** 年龄段枚举 → 中文 UI 标签（2026-09-01 新增）。 */
const AGE_BAND_LABEL: Record<CharacterAgeBand, string> = {
  child: '儿童 (<13 岁)',
  teen: '青少年 (13-19 岁)',
  young_adult: '青年 (20-34 岁)',
  middle_aged: '中年 (35-54 岁)',
  elderly: '老年 (≥55 岁)',
};

interface ModalShellProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}
export function ModalShell({ open, title, onClose, children, footer, width = 520 }: ModalShellProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  // 颜色用硬编码而非 CSS 变量，避免某些环境（Tailwind CDN / 主题未加载）下变量失效导致弹窗全透明。
  const overlayBg = 'rgba(20, 18, 14, 0.55)';
  const cardBg = '#FAF7EE';          // 米黄纸面
  const cardBorder = '#E6DFCB';
  const titleColor = '#1B1A17';
  const textColor = '#2C2A24';
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: overlayBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: cardBg,
          color: textColor,
          border: '1px solid ' + cardBorder,
          borderRadius: '8px',
          padding: '1.25rem 1.5rem',
          width: 'min(92vw, ' + width + 'px)',
          maxHeight: '85vh',
          overflowY: 'auto',
          boxShadow: '0 10px 40px rgba(0,0,0,0.35)',
        }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.875rem', color: titleColor }}>
          <h3 style={{ fontFamily: 'var(--font-display), serif', fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>{title}</h3>
          <button onClick={onClose} className="btn btn--link" style={{ fontSize: '0.875rem', color: titleColor }}>✕</button>
        </div>
        <div style={{ color: textColor }}>{children}</div>
        {footer && (
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid ' + cardBorder }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

const Field = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
  <label style={{ display: 'block', marginBottom: '0.75rem' }}>
    <span style={{ display: 'block', fontSize: '0.75rem', color: '#5B5547', marginBottom: '0.25rem', fontWeight: 500 }}>{label}</span>
    {children}
    {hint && <span style={{ display: 'block', fontSize: '0.625rem', color: '#8A8270', marginTop: '0.125rem' }}>{hint}</span>}
  </label>
);
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '0.5rem 0.625rem',
  border: '1px solid #C8C0A8', borderRadius: '4px',
  fontSize: '0.8125rem',
  background: '#FFFFFF', color: '#1B1A17',
  boxSizing: 'border-box',
  outline: 'none',
};
const textAreaStyle: React.CSSProperties = {
  ...inputStyle, fontFamily: 'inherit', resize: 'vertical', minHeight: '4.5rem',
};

// ============ CharacterEditor ============
export function CharacterEditor({
  open, character, onClose, onSave,
}: {
  open: boolean;
  character: SeriesCharacter | null;
  onClose: () => void;
  onSave: (patch: Partial<SeriesCharacter>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<SeriesCharacter | null>(character);
  const [busy, setBusy] = useState(false);
  const [newAnchor, setNewAnchor] = useState('');
  useEffect(() => { setDraft(character); }, [character]);
  if (!draft) return null;
  const save = async () => {
    setBusy(true);
    try { await onSave(draft); onClose(); } finally { setBusy(false); }
  };
  const set = <K extends keyof SeriesCharacter>(k: K, v: SeriesCharacter[K]) => setDraft(d => d ? { ...d, [k]: v } : d);
  // 「角色圣经」分组 —— 每组是一个可折叠 details；第一组默认展开
  return (
    <ModalShell
      open={open}
      title={'编辑角色 · ' + draft.name}
      onClose={onClose}
      width={640}
      footer={
        <>
          <button onClick={onClose} className="btn btn--ghost" disabled={busy}>取消</button>
          <button onClick={save} className="btn btn--primary" disabled={busy}>{busy ? '保存中…' : '保存'}</button>
        </>
      }>
      {/* —— 基础身份（默认展开） —— */}
      <Section title="基础身份" defaultOpen>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.5rem' }}>
          <Field label="名字">
            <input style={inputStyle} value={draft.name} onChange={e => set('name', e.target.value)} />
          </Field>
          <Field label="定位">
            <select style={inputStyle} value={draft.role} onChange={e => set('role', e.target.value as SeriesCharacter['role'])}>
              <option value="protagonist">主角</option>
              <option value="antagonist">反派</option>
              <option value="supporting">配角</option>
            </select>
          </Field>
        </div>
        <Field label="故事内定位（一句话：此人在剧情里扮演什么）" hint="例：「主角的职场导师」「公司里唯一反对 AI 的中层」">
          <input style={inputStyle} value={draft.roleInStory ?? ''} onChange={e => set('roleInStory', e.target.value)} />
        </Field>
        <Field label="职业 / 身份">
          <input style={inputStyle} value={draft.occupation ?? ''} onChange={e => set('occupation', e.target.value)} placeholder="例：急诊科医生 / 三年级小学生" />
        </Field>
        {/* —— 2026-09-01 新增：性别 / 年龄段下拉框（手动优先于 AI 推断）。
            这是「画面里男女老少一目了然」的第一道闸门 —— 没填的话就让 LLM 自由发挥，
            经验上是女生被画成中性偏男生面孔的根因。 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
          <Field
            label="性别"
            hint="手动指定后，AI 生成参考图/分镜时一定画出相应特征（如女=柔和下颌线、锁骨弧线）"
          >
            <select
              style={inputStyle}
              value={draft.gender ?? ''}
              onChange={e => set('gender', (e.target.value || undefined) as CharacterGender | undefined)}
            >
              <option value="">（未指定 — 让 AI 推断）</option>
              {CHARACTER_GENDERS.map(g => (
                <option key={g} value={g}>{GENDER_LABEL[g]}</option>
              ))}
            </select>
          </Field>
          <Field
            label="年龄段"
            hint="手动指定后，AI 会画出对应体质（老年=法令纹/花白头发；儿童=圆润脸庞）"
          >
            <select
              style={inputStyle}
              value={draft.ageBand ?? ''}
              onChange={e => set('ageBand', (e.target.value || undefined) as CharacterAgeBand | undefined)}
            >
              <option value="">（未指定 — 让 AI 推断）</option>
              {CHARACTER_AGE_BANDS.map(a => (
                <option key={a} value={a}>{AGE_BAND_LABEL[a]}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="综合简介（卡片展示）" hint="2-3 句话 · 性格核心 + 处境">
          <textarea style={textAreaStyle} value={draft.description} onChange={e => set('description', e.target.value)} />
        </Field>
      </Section>

      {/* —— 形象 —— */}
      <Section title="形象（拆字段——保证几十页后角色仍然可辨认）">
        <Field label="综合外貌（用于生图主提示词）" hint="按「体型→发型→脸→眼睛→服装」顺序写，3-5 句话">
          <textarea style={textAreaStyle} value={draft.appearance} onChange={e => set('appearance', e.target.value)} />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
          <Field label="年龄"><input style={inputStyle} value={draft.age ?? ''} onChange={e => set('age', e.target.value)} placeholder="25-30" /></Field>
          <Field label="身高"><input style={inputStyle} value={draft.height ?? ''} onChange={e => set('height', e.target.value)} placeholder="175cm" /></Field>
          <Field label="体型"><input style={inputStyle} value={draft.build ?? ''} onChange={e => set('build', e.target.value)} placeholder="偏瘦" /></Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
          <Field label="发型 / 发色"><input style={inputStyle} value={draft.hair ?? ''} onChange={e => set('hair', e.target.value)} placeholder="黑色短发，左分" /></Field>
          <Field label="眼睛"><input style={inputStyle} value={draft.eyes ?? ''} onChange={e => set('eyes', e.target.value)} placeholder="深棕，左眼下痣" /></Field>
        </div>
        <Field label="标志服装">
          <input style={inputStyle} value={draft.outfit ?? ''} onChange={e => set('outfit', e.target.value)} placeholder="例：深蓝西装外套 + 白衬衫，不打领带" />
        </Field>
        <Field label="习惯性动作 / 标志物">
          <input style={inputStyle} value={draft.signature ?? ''} onChange={e => set('signature', e.target.value)} placeholder="例：说话时双手插兜；随身带不锈钢保温杯" />
        </Field>
      </Section>

      {/* —— 性格与背景 —— */}
      <Section title="性格 / 背景">
        <Field label="性格概述">
          <textarea style={textAreaStyle} value={draft.personality ?? ''} onChange={e => set('personality', e.target.value)} />
        </Field>
        <Field label="关键经历 / 出身" hint="一段话，50-150 字">
          <textarea style={{ ...textAreaStyle, minHeight: '3.5rem' }} value={draft.backstory ?? ''} onChange={e => set('backstory', e.target.value)} />
        </Field>
      </Section>

      {/* —— 故事弧 —— */}
      <Section title="故事弧（角色从哪里来、到哪里去）">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
          <Field label="核心动机（为什么）"><textarea style={{ ...textAreaStyle, minHeight: '3rem' }} value={draft.motivation ?? ''} onChange={e => set('motivation', e.target.value)} /></Field>
          <Field label="表层目标（做什么）"><textarea style={{ ...textAreaStyle, minHeight: '3rem' }} value={draft.goal ?? ''} onChange={e => set('goal', e.target.value)} /></Field>
        </div>
        <Field label="弧光（起点→终点）" hint="例：「从『明哲保身』到『敢为同事发声』」">
          <input style={inputStyle} value={draft.arc ?? ''} onChange={e => set('arc', e.target.value)} />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
          <Field label="内部冲突"><textarea style={{ ...textAreaStyle, minHeight: '3rem' }} value={draft.internalConflict ?? ''} onChange={e => set('internalConflict', e.target.value)} /></Field>
          <Field label="外部冲突"><textarea style={{ ...textAreaStyle, minHeight: '3rem' }} value={draft.externalConflict ?? ''} onChange={e => set('externalConflict', e.target.value)} /></Field>
        </div>
      </Section>

      {/* —— 台词声音 —— */}
      <Section title="台词声音">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
          <Field label="说话风格"><input style={inputStyle} value={draft.voice ?? ''} onChange={e => set('voice', e.target.value)} placeholder="短句节奏、低声、停顿多" /></Field>
          <Field label="口头禅"><input style={inputStyle} value={draft.catchphrase ?? ''} onChange={e => set('catchphrase', e.target.value)} placeholder="例：「听我说完。」" /></Field>
        </div>
      </Section>

      {/* —— 视觉锚点（核心：决定每页一致性） —— */}
      <Section title="视觉锚点（3-6 条；每格分镜强制带入）" defaultOpen>
        <p style={{ fontSize: '0.75rem', color: '#5B5547', margin: '0 0 0.625rem' }}>
          这些是「画面里能看到的物理特征」。写得好，几十页后角色依然可辨认。
          例：黑色短发、左眼下痣、银色项链、左手小指缺一节、说话皱眉。
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginBottom: '0.5rem' }}>
          {(draft.visualAnchors ?? []).map((a, i) => (
            <span key={i} style={{ background: '#FFFFFF', border: '1px solid #C8C0A8', padding: '0.25rem 0.5rem', borderRadius: '3px', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.375rem', color: '#1B1A17' }}>
              {a}
              <button onClick={() => set('visualAnchors', (draft.visualAnchors ?? []).filter((_, j) => j !== i))} style={{ padding: 0, fontSize: '0.75rem', color: '#B0413E', background: 'transparent', border: 0, cursor: 'pointer' }}>×</button>
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '0.375rem' }}>
          <input
            style={{ ...inputStyle, flex: 1 }}
            value={newAnchor}
            onChange={e => setNewAnchor(e.target.value)}
            placeholder="如：黑色短发、左眼下痣、银色项链"
            onKeyDown={e => {
              if (e.key === 'Enter' && newAnchor.trim()) {
                set('visualAnchors', [...(draft.visualAnchors ?? []), newAnchor.trim()]);
                setNewAnchor('');
              }
            }}
          />
          <button
            onClick={() => {
              if (newAnchor.trim()) {
                set('visualAnchors', [...(draft.visualAnchors ?? []), newAnchor.trim()]);
                setNewAnchor('');
              }
            }}
            className="btn btn--ghost"
          >添加</button>
        </div>
      </Section>
    </ModalShell>
  );
}

/** 角色圣经分组小标题。可折叠。 */
function Section({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} style={{ marginBottom: '0.875rem', borderTop: '1px dashed #E6DFCB', paddingTop: '0.625rem' }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.8125rem', color: '#1B1A17', marginBottom: '0.625rem', listStyle: 'revert' }}>
        {title}
      </summary>
      <div>{children}</div>
    </details>
  );
}

// ============ CharacterViewer ============
// 只读的角色详情弹窗。点击角色卡片时打开，集中展示：
//   - 身份 / 定位 / 综合简介
//   - 形象各字段（外貌 / 年龄 / 身高 / 体型 / 发型 / 眼睛 / 服装 / 习惯）
//   - 性格 / 背景 / 故事弧
//   - 台词声音
//   - 视觉锚点（每页分镜强制带入）
//   - 参考图集（v3：1 张图 — sheet 4 视图参考表）
export function CharacterViewer({
  open, character, onClose, onEdit, onRegenShot,
}: {
  open: boolean;
  character: SeriesCharacter | null;
  onClose: () => void;
  onEdit?: (c: SeriesCharacter) => void;
  /** 重生成整张参考图（v3 只剩一张）。 */
  onRegenShot?: (c: SeriesCharacter, shot: 'sheet') => void | Promise<void>;
}) {
  // 单张大图查看器
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  useEffect(() => { if (!open) setZoomUrl(null); }, [open]);
  if (!character) return null;
  const roleLabel = (r: string) => r === 'protagonist' ? '主角' : r === 'antagonist' ? '反派' : '配角';
  // v3：唯一参考图 sheet。兼容老结构 referenceImages.length === 2/4，取 idx 0
  const refs = (character.referenceImages && character.referenceImages.length > 0)
    ? character.referenceImages
    : (character.referenceImage ? [character.referenceImage] : []);
  const sheetUrl = refs[0];

  // 文本字段渲染：有值才显示这一行
  const Row = ({ label, value }: { label: string; value?: string | null }) => {
    if (!value || !value.trim()) return null;
    return (
      <div style={{ marginBottom: '0.5rem' }}>
        <div className="kicker" style={{ fontSize: '0.5625rem', color: '#8A8270', marginBottom: '0.125rem' }}>{label}</div>
        <div style={{ fontSize: '0.8125rem', color: '#1B1A17', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{value}</div>
      </div>
    );
  };

  return (
    <>
      <ModalShell
        open={open}
        title={'查看角色 · ' + character.name}
        onClose={onClose}
        width={680}
        footer={
          <>
            <span style={{ flex: 1 }} />
            <button onClick={onClose} className="btn btn--ghost">关闭</button>
            {onEdit && (
              <button onClick={() => { onEdit(character); onClose(); }} className="btn btn--primary">编辑此角色</button>
            )}
          </>
        }
      >
        {/* —— 基础身份 —— */}
        <Section title="基础身份" defaultOpen>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <span style={{ fontFamily: 'var(--font-display), serif', fontSize: '1.125rem', fontWeight: 600, color: '#1B1A17' }}>{character.name}</span>
            <span className="kicker" style={{ fontSize: '0.625rem', color: character.role === 'protagonist' ? 'var(--accent)' : '#8A8270' }}>
              {roleLabel(character.role)}
            </span>
            <span style={{ fontSize: '0.625rem', color: '#8A8270' }}>· 来源：{character.source === 'manual' ? '手动添加' : 'AI 生成'}</span>
          </div>
          <Row label="故事内定位" value={character.roleInStory} />
          <Row label="职业 / 身份" value={character.occupation} />
          {/* 2026-09-01 新增：把性别 / 年龄段显式呈现，用户一眼能确认"是不是有标"。
              如果缺字段，会在 characters.ts 重新生成前先补齐，否则参考图可能糊。 */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
            {character.gender ? (
              <span style={{ fontSize: '0.75rem', color: '#1B1A17', background: '#FFFFFF', border: '1px solid #C8C0A8', padding: '0.125rem 0.5rem', borderRadius: '3px' }}>
                性别：{GENDER_LABEL[character.gender]}
              </span>
            ) : (
              <span style={{ fontSize: '0.75rem', color: '#B0413E', fontStyle: 'italic' }}>性别未标注（参考图可能糊）</span>
            )}
            {character.ageBand ? (
              <span style={{ fontSize: '0.75rem', color: '#1B1A17', background: '#FFFFFF', border: '1px solid #C8C0A8', padding: '0.125rem 0.5rem', borderRadius: '3px' }}>
                年龄段：{AGE_BAND_LABEL[character.ageBand]}
              </span>
            ) : (
              <span style={{ fontSize: '0.75rem', color: '#B0413E', fontStyle: 'italic' }}>年龄段未标注</span>
            )}
          </div>
          <Row label="综合简介" value={character.description} />
        </Section>

        {/* —— 形象 —— */}
        <Section title="形象（拆字段——保证几十页后角色仍然可辨认）" defaultOpen>
          <Row label="综合外貌" value={character.appearance} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <Row label="年龄" value={character.age} />
            <Row label="身高" value={character.height} />
            <Row label="体型" value={character.build} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <Row label="发型 / 发色" value={character.hair} />
            <Row label="眼睛" value={character.eyes} />
          </div>
          <Row label="标志服装" value={character.outfit} />
          <Row label="习惯性动作 / 标志物" value={character.signature} />
        </Section>

        {/* —— 性格 / 背景 —— */}
        <Section title="性格 / 背景">
          <Row label="性格概述" value={character.personality} />
          <Row label="关键经历 / 出身" value={character.backstory} />
        </Section>

        {/* —— 故事弧 —— */}
        <Section title="故事弧（角色从哪里来、到哪里去）">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem' }}>
            <Row label="核心动机（为什么）" value={character.motivation} />
            <Row label="表层目标（做什么）" value={character.goal} />
          </div>
          <Row label="弧光（起点→终点）" value={character.arc} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem' }}>
            <Row label="内部冲突" value={character.internalConflict} />
            <Row label="外部冲突" value={character.externalConflict} />
          </div>
        </Section>

        {/* —— 台词声音 —— */}
        <Section title="台词声音">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem' }}>
            <Row label="说话风格" value={character.voice} />
            <Row label="口头禅" value={character.catchphrase} />
          </div>
        </Section>

        {/* —— 视觉锚点 —— */}
        <Section title={'视觉锚点（' + (character.visualAnchors?.length ?? 0) + ' 条 · 每格分镜强制带入）'}>
          {(!character.visualAnchors || character.visualAnchors.length === 0) ? (
            <div style={{ fontSize: '0.75rem', color: '#8A8270' }}>暂无视觉锚点</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
              {character.visualAnchors.map((a, i) => (
                <span
                  key={i}
                  style={{
                    background: '#FFFFFF', border: '1px solid #C8C0A8',
                    padding: '0.25rem 0.5rem', borderRadius: '3px',
                    fontSize: '0.75rem', color: '#1B1A17',
                  }}
                >{a}</span>
              ))}
            </div>
          )}
        </Section>

        {/* —— 参考图集 —— */}
        <Section title={'参考图集（4 视图参考表，2x2 网格：全身 / 3-4 / 侧面 / 特写）'} defaultOpen>
          {!sheetUrl ? (
            <div style={{ fontSize: '0.75rem', color: '#8A8270' }}>暂无参考图</div>
          ) : (
            <div style={{ background: '#FFFFFF', border: '1px solid #C8C0A8', padding: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                <div className="kicker" style={{ fontSize: '0.5625rem', color: '#8A8270' }}>
                  4 视图参考表（点击看大图）
                </div>
                {onRegenShot && (
                  <button
                    onClick={() => onRegenShot(character, 'sheet')}
                    className="btn btn--link"
                    style={{ fontSize: '0.625rem', padding: 0, color: 'var(--accent)' }}
                    title="重生成整张参考表"
                  >↻ 重生成整张</button>
                )}
              </div>
              <button
                onClick={() => setZoomUrl(sheetUrl)}
                style={{
                  background: 'transparent', border: 0, padding: 0,
                  cursor: 'zoom-in', textAlign: 'left', width: '100%',
                }}
              >
                <img
                  src={sheetUrl}
                  alt={`${character.name} 参考表`}
                  style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', display: 'block' }}
                />
              </button>
            </div>
          )}
        </Section>
      </ModalShell>

      {/* —— 单张大图查看（套在 ModalShell 外层，便于一键关闭） —— */}
      {zoomUrl && (
        <div
          onClick={() => setZoomUrl(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1100,
            background: 'rgba(20, 18, 14, 0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '2rem', cursor: 'zoom-out',
          }}
        >
          <img
            src={zoomUrl}
            alt={character.name + ' 大图'}
            style={{ maxWidth: '92vw', maxHeight: '92vh', objectFit: 'contain', boxShadow: '0 10px 40px rgba(0,0,0,0.5)' }}
          />
        </div>
      )}
    </>
  );
}

// ============ ChapterEditor ============
export function ChapterEditor({
  open, chapter, onClose, onSave, onDelete, onMove, siblings,
}: {
  open: boolean;
  chapter: Chapter | null;
  onClose: () => void;
  onSave: (patch: Partial<Chapter>) => Promise<void>;
  onDelete?: () => Promise<void>;
  onMove?: (dir: 'up' | 'down') => Promise<void>;
  siblings?: { id: string; title: string }[];
}) {
  const [draft, setDraft] = useState<Chapter | null>(chapter);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { setDraft(chapter); setConfirmDelete(false); }, [chapter]);
  if (!draft) return null;
  const idx = siblings?.findIndex(s => s.id === draft.id) ?? -1;
  const isFirst = idx <= 0;
  const isLast = idx >= (siblings?.length ?? 1) - 1;
  const save = async () => {
    setBusy(true);
    try { await onSave(draft); onClose(); } finally { setBusy(false); }
  };
  return (
    <ModalShell
      open={open}
      title={'编辑章节 · ' + draft.title}
      onClose={onClose}
      width={580}
      footer={
        <>
          {onMove && (
            <>
              <button onClick={() => onMove('up')} className="btn btn--ghost" disabled={busy || isFirst}>↑ 上移</button>
              <button onClick={() => onMove('down')} className="btn btn--ghost" disabled={busy || isLast}>↓ 下移</button>
            </>
          )}
          <span style={{ flex: 1 }} />
          {onDelete && (
            confirmDelete ? (
              <>
                <button onClick={() => setConfirmDelete(false)} className="btn btn--ghost" disabled={busy}>取消</button>
                <button onClick={async () => { await onDelete(); onClose(); }} className="btn btn--danger" disabled={busy}>确认删除</button>
              </>
            ) : (
              <button onClick={() => setConfirmDelete(true)} className="btn btn--link" disabled={busy} style={{ color: 'var(--danger)' }}>删除章节</button>
            )
          )}
          <button onClick={onClose} className="btn btn--ghost" disabled={busy}>取消</button>
          <button onClick={save} className="btn btn--primary" disabled={busy}>{busy ? '保存中…' : '保存'}</button>
        </>
      }>
      <Field label="标题">
        <input style={inputStyle} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} />
      </Field>
      <Field label="剧情摘要">
        <textarea style={textAreaStyle} value={draft.summary} onChange={e => setDraft({ ...draft, summary: e.target.value })} />
      </Field>
      <Field label="核心冲突">
        <textarea style={{ ...textAreaStyle, minHeight: '3rem' }} value={draft.conflict ?? ''} onChange={e => setDraft({ ...draft, conflict: e.target.value })} placeholder="本章要解决的核心冲突 / 悬念..." />
      </Field>
      <Field label="预计页数" hint="页数增加会自动创建新页（状态 draft）；减少会自动删除末尾页（连同分镜）。">
        <input type="number" min={2} max={8} style={inputStyle} value={draft.pageCount} onChange={e => setDraft({ ...draft, pageCount: Math.max(2, Math.min(8, parseInt(e.target.value) || 2)) })} />
      </Field>
    </ModalShell>
  );
}

// ============ PanelsEditor ============
export function PanelsEditor({
  open, page, onClose, onSavePanels, onInsertPanel, onDeletePanel,
}: {
  open: boolean;
  page: SeriesPage | null;
  onClose: () => void;
  onSavePanels: (panels: PanelInput[]) => Promise<void>;
  onInsertPanel: (insertAt: number) => Promise<void>;
  onDeletePanel: (panelId: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<SeriesPage['panels']>([]);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setDraft(page?.panels ?? []); setDirty(false); }, [page]);
  if (!page) return null;
  const setPanel = (i: number, patch: Partial<SeriesPage['panels'][number]>) => {
    setDraft(d => d.map((p, j) => (j === i ? { ...p, ...patch } : p)));
    setDirty(true);
  };
  const move = (i: number, dir: -1 | 1) => {
    setDraft(d => {
      const next = [...d];
      const j = i + dir;
      if (j < 0 || j >= next.length) return d;
      [next[i], next[j]] = [next[j], next[i]];
      return next.map((p, k) => ({ ...p, index: k }));
    });
    setDirty(true);
  };
  const remove = (i: number) => {
    setDraft(d => d.filter((_, j) => j !== i).map((p, k) => ({ ...p, index: k })));
    setDirty(true);
  };
  const insertLocal = (i: number) => {
    setDraft(d => {
      const next = [...d];
      next.splice(i, 0, { index: i, description: '', dialogue: '', characterIds: [], imageUrl: undefined });
      return next.map((p, k) => ({ ...p, index: k }));
    });
    setDirty(true);
  };
  const save = async () => {
    setBusy(true);
    try {
      // index 抹掉交给后端按数组位置重编号（ReplacePanelsSchema.index 可选）。
      // 注：draft 在 move/remove/insertLocal 三处都已重新映射过 index，
      // 这里抹掉其实是冗余的；但删除属于行为变更，未随本次 strict 改造一并执行。
      await onSavePanels(draft.map(p => ({ ...p, index: undefined })));
      setDirty(false); onClose();
    } finally { setBusy(false); }
  };
  return (
    <ModalShell
      open={open}
      title={'编辑分镜 · ' + (page.title || '第 ' + page.pageNumber + ' 页')}
      onClose={onClose}
      width={680}
      footer={
        <>
          <button onClick={() => insertLocal(draft.length)} className="btn btn--ghost" disabled={busy}>+ 末尾新增</button>
          <span style={{ flex: 1 }} />
          {!dirty && <span style={{ fontSize: '0.75rem', color: 'var(--ink-3)', alignSelf: 'center' }}>（未改动）</span>}
          <button onClick={onClose} className="btn btn--ghost" disabled={busy}>取消</button>
          <button onClick={save} className="btn btn--primary" disabled={busy || !dirty}>{busy ? '保存中…' : '保存分镜'}</button>
        </>
      }>
      <p className="deck" style={{ marginBottom: '0.75rem', fontSize: '0.75rem' }}>
        修改描述 / 对话 / 人物后点「保存分镜」即生效；图会在下一次生成时按新分镜重画。
      </p>
      {draft.map((p, i) => (
        <div key={p.id ?? i} style={{ background: 'var(--bg-soft)', padding: '0.75rem', marginBottom: '0.625rem', borderRadius: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span className="kicker" style={{ fontSize: '0.625rem' }}>第 {i + 1} 格</span>
            <div style={{ display: 'flex', gap: '0.25rem' }}>
              <button onClick={() => move(i, -1)} className="btn btn--link" disabled={i === 0 || busy} style={{ fontSize: '0.75rem', padding: '0.125rem 0.375rem' }}>↑</button>
              <button onClick={() => move(i, 1)} className="btn btn--link" disabled={i === draft.length - 1 || busy} style={{ fontSize: '0.75rem', padding: '0.125rem 0.375rem' }}>↓</button>
              <button onClick={() => remove(i)} className="btn btn--link" disabled={busy} style={{ fontSize: '0.75rem', padding: '0.125rem 0.375rem', color: 'var(--danger)' }}>删除</button>
            </div>
          </div>
          <Field label="镜头描述">
            <textarea style={textAreaStyle} value={p.description} onChange={e => setPanel(i, { description: e.target.value })} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            <Field label="对话">
              <input style={inputStyle} value={p.dialogue ?? ''} onChange={e => setPanel(i, { dialogue: e.target.value })} />
            </Field>
            <Field label="情绪 / 备注">
              <input style={inputStyle} value={p.emotion ?? ''} onChange={e => setPanel(i, { emotion: e.target.value })} />
            </Field>
          </div>
          <button onClick={() => insertLocal(i + 1)} className="btn btn--link" style={{ fontSize: '0.75rem', padding: 0, marginTop: '0.125rem' }}>+ 在此处后插入新格子</button>
        </div>
      ))}
      {draft.length === 0 && <p style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '1rem' }}>暂无分镜，点击「末尾新增」开始添加</p>}
    </ModalShell>
  );
}