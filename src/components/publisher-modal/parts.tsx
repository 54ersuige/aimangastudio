import React from 'react';
import type { DraftBlock } from '../../types';

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section style={{ marginBottom: '1.25rem' }}>
      <h4 className="kicker" style={{ marginBottom: '0.5rem' }}>{title}</h4>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div style={{ marginBottom: '0.6rem' }}>
      <span className="field-label">{label}</span>
      {children}
    </div>
  );
}

function BlockRow(props: {
  index: number;
  total: number;
  block: DraftBlock;
  onMoveUp(): void;
  onMoveDown(): void;
  onRemove(): void;
  onDuplicate(): void;
  onEditText(t: string): void;
}): React.ReactElement {
  const { index, total, block, onMoveUp, onMoveDown, onRemove, onDuplicate, onEditText } = props;
  const label = (() => {
    switch (block.kind) {
      case 'heading': return `H${block.level} · 标题`;
      case 'paragraph': return '段落';
      case 'quote': return '引用';
      case 'image': return '图片';
      case 'divider': return '分割线';
      case 'cast': return '人物表';
      case 'panel': return `分镜 #${block.panelIndex + 1}`;
      case 'page': return `页：${block.title}`;
    }
  })();
  return (
    <div style={{
      border: '1px solid var(--rule-soft)',
      padding: '0.4rem 0.5rem',
      marginBottom: '0.4rem',
      background: 'var(--bg-card)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.3rem' }}>
        <span className="kicker" style={{ fontSize: '0.5625rem', flex: 1 }}>{label}</span>
        <button className="iconbtn" style={{ padding: '0.1rem 0.3rem' }} disabled={index === 0} onClick={onMoveUp} aria-label="上移">▲</button>
        <button className="iconbtn" style={{ padding: '0.1rem 0.3rem' }} disabled={index === total - 1} onClick={onMoveDown} aria-label="下移">▼</button>
        <button className="iconbtn" style={{ padding: '0.1rem 0.3rem' }} onClick={onDuplicate} aria-label="复制" title="复制此块">⎘</button>
        <button className="iconbtn" style={{ padding: '0.1rem 0.3rem', color: 'var(--danger)' }} onClick={onRemove} aria-label="删除">✕</button>
      </div>
      {block.kind === 'heading' || block.kind === 'paragraph' || block.kind === 'quote' ? (
        <textarea
          className="field-textarea"
          value={block.text}
          rows={block.kind === 'paragraph' ? 3 : 2}
          onChange={e => onEditText(e.target.value)}
          style={{ fontSize: '0.8125rem' }}
        />
      ) : block.kind === 'image' ? (
        <div style={{ fontSize: '0.75rem', color: 'var(--ink-3)', wordBreak: 'break-all' }}>{block.url}</div>
      ) : block.kind === 'cast' ? (
        <div style={{ display: 'grid', gap: '0.3rem' }}>
          <textarea
            className="field-textarea"
            value={block.title || ''}
            rows={1}
            onChange={e => onEditText(e.target.value)}
            style={{ fontSize: '0.75rem' }}
            placeholder="人物表标题（如『主要人物』）"
          />
          <div style={{ fontSize: '0.7rem', color: 'var(--ink-2)' }}>
            {block.characters.map(cm => (
              <div key={cm.name} style={{ marginBottom: '0.15rem' }}>
                <strong>{cm.name}</strong>{cm.role ? `（${cm.role}）` : ''} — {cm.intro}
              </div>
            ))}
          </div>
        </div>
      ) : block.kind === 'panel' ? (
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <img src={block.imageUrl} alt="" style={{ width: 60, height: 60, objectFit: 'cover', border: '1px solid var(--rule-soft)' }} />
          <div style={{ flex: 1, fontSize: '0.7rem', color: 'var(--ink-2)' }}>
            {block.dialogue && <div>对白：{block.dialogue}</div>}
            {block.narration && <div>旁白：{block.narration.slice(0, 60)}{block.narration.length > 60 ? '…' : ''}</div>}
            {block.innerThought && <div>内心：{block.innerThought.slice(0, 40)}{block.innerThought.length > 40 ? '…' : ''}</div>}
          </div>
        </div>
      ) : block.kind === 'page' ? (
        <div style={{ fontSize: '0.75rem', color: 'var(--ink-2)' }}>
          {block.sceneDescription && <div>{block.sceneDescription.slice(0, 80)}{block.sceneDescription.length > 80 ? '…' : ''}</div>}
        </div>
      ) : (
        <div style={{ height: 1, background: 'var(--rule-soft)' }} />
      )}
    </div>
  );
}

export { Section, Field, BlockRow };
