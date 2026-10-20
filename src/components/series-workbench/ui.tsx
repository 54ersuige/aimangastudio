import React from 'react';
import { extractReadableText } from './text';

type CardStatus = 'pending' | 'in_progress' | 'done';

function CardSection({
  index, kicker, status, title, badgeText, active, children,
}: {
  index: string;
  kicker: string;
  status: CardStatus;
  title: string;
  /**
   * 2026-10-19：覆盖徽章文案，不改状态样式。
   *
   * 为什么需要：`status` 只有 pending / in_progress / done 三档，
   * 而「季骨架已就绪、还没拆话」这个状态被迫塞进 `in_progress` → 显示「进行中」。
   * 但那个时刻**没有任何任务在跑** —— 徽章在骗人，还直接把用户引向
   * 「那按钮为什么还能点」的误解。给这个真实存在的第四种状态一个真实文案，
   * 不再让状态位承担它讲不了的意思。
   */
  badgeText?: string;
  active?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  const badge =
    status === 'done'
      ? { text: '已完成', color: 'var(--ink-2)', bg: 'var(--bg-soft)' }
      : status === 'in_progress'
      ? { text: '进行中', color: 'var(--paper)', bg: 'var(--accent)' }
      : { text: '未开始', color: 'var(--ink-3)', bg: 'transparent' };
  const label = badgeText ?? badge.text;

  return (
    <section
      className={`card fade-in ${active ? 'card--active' : ''}`}
      style={{
        padding: '1.5rem 1.75rem',
        marginBottom: '1.5rem',
        background: active ? '#FFFCF3' : 'var(--bg-card)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '1rem', marginBottom: '1rem', borderBottom: '1px solid var(--rule-soft)', paddingBottom: '0.75rem' }}>
        <span className="chapter-num" style={{ fontSize: '1.75rem' }}>§ {index}</span>
        <div style={{ flex: 1 }}>
          <div className="kicker kicker--accent">{kicker}</div>
          <h2 className="headline headline--lg" style={{ marginTop: '0.125rem' }}>{title}</h2>
        </div>
        <span style={{
          fontSize: '0.625rem', letterSpacing: '0.18em', textTransform: 'uppercase',
          color: badge.color, background: badge.bg,
          padding: '0.25rem 0.625rem',
          border: status === 'pending' ? '1px solid var(--rule-soft)' : 'none',
        }}>
          {label}
        </span>
      </div>
      <div>{children}</div>
    </section>
  );
}

/** 旋转 loader；small=true 时是 12px 文字前用；否则 22px。 */
function Spinner({ small = false }: { small?: boolean }) {
  const size = small ? 12 : 22;
  return (
    <>
      <style>{`@keyframes spinRot{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
      <span
        style={{
          display: 'inline-block', width: size, height: size,
          border: '2px solid currentColor', borderTopColor: 'transparent',
          borderRadius: '50%', animation: 'spinRot 0.9s linear infinite',
        }}
      />
    </>
  );
}

/** 单格正在生成时的占位（不显示图，显示分镜描述 + spinner）。
 *  这里展示的是"这个分镜大概画了什么"，属于镜头描述，是给编辑者确认用的元信息；
 *  读者最终看到的对话/旁白在面板下方单独展示。 */
function GeneratingPanelPlaceholder({ description }: { description: string }) {
  const readable = extractReadableText(description);
  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: '0.5rem', padding: '0.75rem',
      background: 'linear-gradient(135deg, #FAF7EE 0%, #F2EBD5 100%)',
      color: '#1B1A17',
    }}>
      <Spinner />
      {readable && (
        <div style={{ fontSize: '0.625rem', textAlign: 'center', color: '#5B5547', lineHeight: 1.4, maxHeight: '60%', overflow: 'hidden' }}>
          {readable}
        </div>
      )}
    </div>
  );
}

/* —— 罗马数字 —— */
function toRoman(n: number): string {
  const map: [number, string][] = [[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
  let r = ''; let v = n;
  for (const [k, s] of map) { while (v >= k) { r += s; v -= k; } }
  return r;
}

export { CardSection, Spinner, GeneratingPanelPlaceholder, toRoman };
