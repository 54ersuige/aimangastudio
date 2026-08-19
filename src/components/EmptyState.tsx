import React from 'react';

/* —— EmptyState：杂志"卷首语"风格的空状态/引导卡 —— */

export interface EmptyStateProps {
  title: string;
  deck?: string;
  primaryLabel?: string;
  onPrimary?: () => void;
  children?: React.ReactNode;
}

export function EmptyState(props: EmptyStateProps): React.ReactElement {
  const { title, deck, primaryLabel, onPrimary, children } = props;
  return (
    <div className="card fade-in" style={{ padding: '2.25rem 2.5rem', maxWidth: '44rem', margin: '0 auto' }}>
      <div className="kicker kicker--accent" style={{ marginBottom: '0.75rem' }}>
        欢迎 · 第一步
      </div>
      <h2 className="headline headline--xxl" style={{ marginBottom: '0.75rem' }}>{title}</h2>
      {deck && (
        <p className="deck" style={{ marginBottom: '1.5rem', fontSize: '1.0625rem' }}>{deck}</p>
      )}
      {children}
      {primaryLabel && onPrimary && (
        <div style={{ marginTop: '1.75rem' }}>
          <button className="btn btn--primary" onClick={onPrimary}>
            {primaryLabel} ▸
          </button>
        </div>
      )}
    </div>
  );
}

/* —— 教程卡：三张"杂志专栏"风格的开场介绍 —— */
export function OnboardingArticles(): React.ReactElement {
  const items: Array<{ kicker: string; title: string; body: string }> = [
    {
      kicker: '方法 · 流程',
      title: '五个步骤，从一句话到完整连载',
      body: '灵感 → 世界观 → 角色 → 章节 → 逐页生成。每张卡里的 AI 产物都可独立修改或重新生成。',
    },
    {
      kicker: '特色 · 一致性',
      title: '每个角色都有一张"身份证"图',
      body: '系统在生成角色时会产出一张参考图；之后每一页画到这个角色都会带上这张图，保证几十页不"换脸"。',
    },
    {
      kicker: '协作 · 改稿',
      title: '用自然语言改任何东西',
      body: '对单格、整页、整个分镜说「换成黄昏」「让角色笑一下」，AI 会按你的意图重画。',
    },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '1.25rem' }}>
      {items.map((it, i) => (
        <article key={i} className="card" style={{ padding: '1.5rem 1.5rem 1.75rem' }}>
          <div className="kicker kicker--accent" style={{ marginBottom: '0.625rem' }}>{it.kicker}</div>
          <h3 className="headline headline--lg" style={{ marginBottom: '0.5rem', fontSize: '1.125rem' }}>{it.title}</h3>
          <p style={{ color: 'var(--ink-2)', fontSize: '0.875rem', lineHeight: 1.55 }}>{it.body}</p>
        </article>
      ))}
    </div>
  );
}