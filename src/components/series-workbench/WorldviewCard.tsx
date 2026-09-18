import React from 'react';
import type { Series } from '../../types';
import { RedoAltIcon } from '../icons';

function WorldviewCard({ series, onGenerate, busy }: { series: Series; onGenerate: () => void; busy: boolean }) {
  if (!series.worldview) {
    return (
      <div>
        <p className="deck" style={{ marginBottom: '1rem' }}>AI 会根据你的简介设定时代、背景、画风、色调。</p>
        <button onClick={() => onGenerate()} disabled={busy} className="btn btn--primary">
          {busy ? '生成中…' : '生成世界观 ▸'}
        </button>
      </div>
    );
  }
  const w = series.worldview;
  const blueprints = w.characterBlueprints ?? [];
  const conflicts = w.conflicts ?? [];
  const locations = w.locations ?? [];
  const arcBlueprints = w.arcBlueprints ?? [];
  return (
    <div>
      <p className="italic-serif" style={{ fontSize: '1.125rem', color: 'var(--ink-2)', marginBottom: '1rem' }}>
        {w.summary}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.625rem', marginBottom: '1rem' }}>
        <InfoChip label="时代" value={w.era} />
        <InfoChip label="画风" value={w.artStyle} />
        <InfoChip label="色调" value={w.paletteMood} />
      </div>
      {/* —— 蓝图统计卡：让用户一眼看出"涉及几个角色 / 几条矛盾 / 几个场景"，按下方按钮会按此生成 —— */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem', marginBottom: '1rem', fontSize: '0.75rem', color: 'var(--ink-2)' }}>
        <BlueprintStat label="涉及角色" count={blueprints.length} suffix="人" />
        <BlueprintStat label="核心矛盾" count={conflicts.length} suffix="条" />
        <BlueprintStat label="关键场景" count={locations.length} suffix="处" />
        <BlueprintStat label="季" count={arcBlueprints.length} suffix="季" />
      </div>
      <details>
        <summary className="kicker" style={{ cursor: 'pointer' }}>展开世界观蓝图 ▾</summary>
        <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.875rem' }}>
          <BlueprintSection title="背景设定">
            <div style={{ fontSize: '0.9375rem', lineHeight: 1.7, whiteSpace: 'pre-wrap', color: 'var(--ink-2)' }}>{w.background}</div>
          </BlueprintSection>
          {w.plotOutline && (
            <BlueprintSection title="剧情大纲（章节拆分按此）">
              <div style={{ fontSize: '0.875rem', lineHeight: 1.7, whiteSpace: 'pre-wrap', color: 'var(--ink-2)' }}>{w.plotOutline}</div>
            </BlueprintSection>
          )}
          {blueprints.length > 0 && (
            <BlueprintSection title={`角色蓝图（${blueprints.length} 人，角色生成按此）`}>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}>
                {blueprints.map((b, i) => (
                  <li key={i} style={{ background: 'var(--bg-soft)', padding: '0.5rem 0.75rem', borderRadius: '0.375rem' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{b.name}</span>
                      <span className="kicker" style={{ fontSize: '0.5625rem' }}>
                        {b.role === 'protagonist' ? '主角' : b.role === 'antagonist' ? '反派' : '配角'}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--ink-2)', marginTop: '0.25rem' }}>
                      {b.roleInStory} · 动机：{b.motivation}
                    </div>
                  </li>
                ))}
              </ul>
            </BlueprintSection>
          )}
          {conflicts.length > 0 && (
            <BlueprintSection title="核心矛盾">
              <ol style={{ margin: 0, paddingLeft: '1.125rem', fontSize: '0.8125rem', lineHeight: 1.7, color: 'var(--ink-2)' }}>
                {conflicts.map((c, i) => <li key={i}>{c}</li>)}
              </ol>
            </BlueprintSection>
          )}
          {locations.length > 0 && (
            <BlueprintSection title="关键场景">
              <ul style={{ margin: 0, paddingLeft: '1.125rem', fontSize: '0.8125rem', lineHeight: 1.7, color: 'var(--ink-2)' }}>
                {locations.map((l, i) => <li key={i}>{l}</li>)}
              </ul>
            </BlueprintSection>
          )}
          {arcBlueprints.length > 0 && (
            <BlueprintSection title={`连载结构（${arcBlueprints.length} 季，逐季生成）`}>
              <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}>
                {arcBlueprints.map((a, i) => (
                  <li key={i} style={{ background: 'var(--bg-soft)', padding: '0.5rem 0.75rem', borderRadius: '0.375rem', borderLeft: '2px solid var(--accent)' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
                      <span className="kicker" style={{ fontSize: '0.5625rem', color: 'var(--accent)' }}>第 {i + 1} 季</span>
                      <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{a.title}</span>
                      <span style={{ marginLeft: 'auto', fontSize: '0.6875rem', color: 'var(--ink-3)' }}>计划 {a.plannedChapterCount} 章</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--ink-2)', marginTop: '0.25rem' }}>{a.premise}</div>
                  </li>
                ))}
              </ol>
            </BlueprintSection>
          )}
          {/* 老数据缺蓝图字段时给一个温和的提示 */}
          {blueprints.length === 0 && !w.plotOutline && (
            <div style={{ fontSize: '0.75rem', color: 'var(--ink-3)', padding: '0.5rem 0.75rem', background: 'var(--bg-soft)', borderRadius: '0.375rem' }}>
              这是早期生成的世界观（无蓝图字段）。点击「重新生成」会按新规范产出 characterBlueprints / plotOutline / conflicts / locations。
            </div>
          )}
        </div>
      </details>
      <hr className="rule-soft" />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={() => onGenerate()} disabled={busy} className="btn btn--link" style={{ fontSize: '0.8125rem' }}>
          <RedoAltIcon className="w-3.5 h-3.5" />重新生成
        </button>
      </div>
    </div>
  );
}

/** 蓝图区段（折叠面板里的小标题 + 内容） */
function BlueprintSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="kicker" style={{ marginBottom: '0.375rem' }}>{title}</div>
      {children}
    </div>
  );
}

/** 蓝图统计（"涉及角色 3 人" 这种紧凑胶囊） */
function BlueprintStat({ label, count, suffix }: { label: string; count: number; suffix: string }) {
  return (
    <div style={{ background: 'var(--bg-soft)', padding: '0.5rem 0.625rem', borderRadius: '0.375rem', display: 'flex', alignItems: 'baseline', gap: '0.375rem' }}>
      <span style={{ fontWeight: 600, fontSize: '1.0625rem' }}>{count}</span>
      <span style={{ fontSize: '0.6875rem', color: 'var(--ink-3)' }}>{suffix}</span>
      <span style={{ marginLeft: 'auto', fontSize: '0.6875rem' }}>{label}</span>
    </div>
  );
}

function InfoChip({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'var(--bg-soft)', padding: '0.625rem 0.75rem' }}>
      <div className="kicker" style={{ fontSize: '0.5625rem' }}>{label}</div>
      <div style={{ fontSize: '0.8125rem', fontWeight: 600, lineHeight: 1.35, marginTop: '0.25rem' }}>{value}</div>
    </div>
  );
}

export { WorldviewCard, BlueprintSection, BlueprintStat, InfoChip };
