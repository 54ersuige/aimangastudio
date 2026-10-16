import React, { useEffect, useState, useCallback } from 'react';

/**
 * 连载漫画审核大师 · 审计卡（2026-09-07 重写）。
 *
 * 显示：
 *  - 本 series 的整体连载质量分（0-100，加权 8 维评审）
 *  - 8 维评审雷达图：人物连续性 / 镜头语言 / 构图 / 风格 / 表情 / 装束 / 场景 / 节奏
 *  - 最近 N 次评审 + 每格的 topIssue（编辑评语）
 *
 * 与之前那个"driftScore=100 健康"的装饰品不同 —— 这里每次出图都被真正的
 * vision model 当作 Shueisha / New Yorker 主编审过一遍，UI 是评审结果的可视化。
 */
export interface AuditRecord {
  ts: string;
  seriesId: string;
  seriesTitle?: string;
  pageNumber: number;
  panelIndex: number;
  chapterTitle?: string;
  action: string;
  dnaKey: string;
  promptLen: number;
  refCount: number;
  styleRefCount: number;
  limbGuard: { abnormal: boolean; reason: string; confidence: number } | null;
  genderAudit: { mismatch: boolean; expected: string; observed: string[]; reason: string; confidence: number } | null;
  review: {
    overall: number;
    dimensions: Record<string, { score: number; reason: string }>;
    topIssue: string;
    verdict: 'publish' | 'revise' | 'reject';
    confidence: number;
  } | null;
  /**
   * 图文对齐门禁结果。
   * 注意：这个字段后端从 2026-09-11 起就在写，但前端类型一直漏着，
   * 所以对齐这一道闸的结果从来没在 UI 上显示过（2026-10-16 补上）。
   */
  alignmentAudit?: {
    ok: boolean;
    items: string[];
    missing: string[];
    reason: string;
    confidence: number;
  } | null;
  attempt: number;
  totalAttempts: number;
  regenReason: string;
  finalImageHash: string;
  costMs: number;
  error?: string;
}

interface Props {
  seriesId?: string;
}

/** 列表默认展开条数；超出折叠为「显示更多」。 */
const LIST_PAGE = 15;

const DIMS: Array<{ key: string; label: string }> = [  { key: 'D1_character_consistency', label: '人物连续' },
  { key: 'D2_cinematography', label: '镜头语言' },
  { key: 'D3_composition', label: '构图分镜' },
  { key: 'D4_style_consistency', label: '风格一致' },
  { key: 'D5_expression_emotion', label: '表情情绪' },
  { key: 'D6_outfit_consistency', label: '装束一致' },
  { key: 'D7_scene_continuity', label: '场景连贯' },
  { key: 'D8_visual_pacing', label: '视觉节奏' },
];

function scoreColor(s: number): string {
  if (s >= 85) return '#16a34a';
  if (s >= 70) return '#d97706';
  if (s >= 50) return '#ea580c';
  return '#dc2626';
}
function scoreLabel(s: number): string {
  if (s >= 85) return '健康（publishable）';
  if (s >= 70) return '注意（revise）';
  if (s >= 50) return '警告（reject）';
  return '严重';
}

export function AuditCard({ seriesId }: Props) {
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [score, setScore] = useState<number | null>(null);
  const [averages, setAverages] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const reload = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await fetch('/api/audit/recent?limit=50', { signal });
      if (!r.ok) return;
      const j = await r.json();
      let list: AuditRecord[] = j.records || [];
      if (seriesId) list = list.filter(x => x.seriesId === seriesId);
      if (signal?.aborted) return;
      setRecords(list);
      if (seriesId) {
        const [ds, ad] = await Promise.all([
          fetch(`/api/audit/drift-score?seriesId=${encodeURIComponent(seriesId)}`, { signal }),
          fetch(`/api/audit/dimensions?seriesId=${encodeURIComponent(seriesId)}`, { signal }),
        ]);
        if (signal?.aborted) return;
        if (ds.ok) {
          const j2 = await ds.json();
          if (!signal?.aborted) setScore(j2.score);
        }
        if (ad.ok) {
          const j3 = await ad.json();
          if (!signal?.aborted) setAverages(j3.dimensions || {});
        }
      }
    } catch (e: any) {
      // 用户主动取消（HMR / StrictMode 双调用 / 组件卸载）— 静默，不打 console。
      if (e?.name === 'AbortError') return;
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [seriesId]);

  useEffect(() => {
    const controller = new AbortController();
    reload(controller.signal);
    const t = setInterval(() => reload(controller.signal), 15000);
    return () => {
      clearInterval(t);
      controller.abort();
    };
  }, [reload]);

  const reviewed = records.filter(r => r.review != null);
  const flagged = records.filter(r => r.regenReason !== 'ok' || r.limbGuard?.abnormal || r.genderAudit?.mismatch);
  const passed = records.filter(r => !flagged.includes(r));
  const unreviewed = records.filter(r => r.review == null);

  /**
   * 2026-10-16：这个列表只挑「不达标」，达标的一条都不显示，
   * 于是用户看到空列表或几条红条时会以为"只有这几张审过"。
   * 实际每张出图都进了 records（上面雷达图和 8 维均分就是从它们算的）。
   * 补三个计数行，把"审了多少 / 过了多少 / 有问题多少 / 没审到多少"说清楚，
   * 并且让「未审到」单独一栏 —— 它既不是通过也不是不通过，
   * 混进红条里会让人以为是张 0 分的烂图（这正是 2026-10-16 实测里发生过的事）。
   */
  const counts = [
    { label: '已审', value: reviewed.length, color: '#374151' },
    { label: '达标', value: passed.length, color: '#16a34a' },
    { label: '不达标', value: flagged.length, color: '#d97706' },
    { label: '未审到', value: unreviewed.length, color: '#9ca3af' },
  ];

  return (
    <section
      className="card fade-in"
      style={{
        padding: '1.5rem 1.75rem',
        marginBottom: '1.5rem',
        background: 'var(--bg-card)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '1rem', marginBottom: '1rem', borderBottom: '1px solid var(--rule-soft)', paddingBottom: '0.75rem' }}>
        <div style={{ flex: 1 }}>
          <div className="kicker kicker--accent">连载漫画审核大师</div>
          <h2 className="headline headline--lg" style={{ marginTop: '0.125rem' }}>分镜出图审计</h2>
          <p className="kicker" style={{ marginTop: '0.25rem' }}>
            {seriesId ? '本系列最近 50 条出图 · 8 维评审 + 重生成原因' : '全局最近 50 条出图'}
          </p>
        </div>
      </div>

      <div>
      {loading ? (
        <div className="kicker">加载中…</div>
      ) : reviewed.length === 0 ? (
        <div className="kicker" style={{ color: 'var(--ink-3, #888)' }}>
          {records.length === 0
            ? '本系列还没有出图记录。出图后会在这里看到评审结果。'
            : 'vision provider 未启用或评审尚未运行。开启 vision key 后下次出图会自动评审。'}
        </div>
      ) : (
        <>
          {/* 总分 + 8 维雷达图 并排 */}
          <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'stretch', marginBottom: '1rem', flexWrap: 'wrap' }}>
            {score !== null && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: '0.75rem',
                  padding: '0.75rem 1rem',
                  background: 'var(--paper-2, #fafaf7)',
                  border: `2px solid ${scoreColor(score)}`,
                  borderRadius: '8px',
                  minWidth: '260px',
                }}
              >
                <div style={{ fontSize: '2.5rem', fontWeight: 700, color: scoreColor(score) }}>
                  {score}
                </div>
                <div>
                  <div style={{ fontWeight: 600, color: scoreColor(score) }}>
                    连载质量分 · {scoreLabel(score)}
                  </div>
                  <div className="kicker" style={{ fontSize: '0.7rem' }}>
                    基于最近 200 格 8 维评审加权
                  </div>
                </div>
              </div>
            )}
            <RadarChart dimensions={averages} />
          </div>

          {/* 8 维详情柱状列表 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.5rem', marginBottom: '1.25rem' }}>
            {DIMS.map(d => {
              const v = averages[d.key];
              const avg = typeof v === 'number' ? v : null;
              const color = avg === null ? '#9ca3af' : scoreColor(avg * 10);
              return (
                <div key={d.key} style={{ border: '1px solid var(--rule-soft)', borderRadius: '6px', padding: '0.5rem 0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.25rem' }}>
                    <strong style={{ fontSize: '0.85rem' }}>{d.label}</strong>
                    <span style={{ color, fontWeight: 700, fontSize: '0.9rem' }}>
                      {avg === null ? '—' : avg.toFixed(1)}
                    </span>
                  </div>
                  <div style={{ height: '4px', background: '#eee', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{
                      width: `${avg === null ? 0 : avg * 10}%`,
                      height: '100%',
                      background: color,
                      transition: 'width 0.4s',
                    }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* 计数行：让"每张都审了，但只列不达标的"这件事可见 */}
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            {counts.map(c => (
              <div key={c.label} style={{
                border: '1px solid var(--rule-soft)', borderRadius: '6px',
                padding: '0.35rem 0.7rem', display: 'flex', alignItems: 'baseline', gap: '0.4rem',
              }}>
                <span className="kicker" style={{ fontSize: '0.7rem' }}>{c.label}</span>
                <strong style={{ color: c.color, fontSize: '1rem' }}>{c.value}</strong>
              </div>
            ))}
          </div>

          {/* 审核记录（全量）：用户要能一眼看出「审完了没」和「每张结果是什么」 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div className="kicker kicker--accent">
              审核记录（{records.length} 条 · 已审 {reviewed.length} · 未审到 {unreviewed.length}
              {unreviewed.length > 0 ? ' —— 审核未跑完，下面标「未审到」的格子可重新审核' : ' —— 全部审完'})
            </div>
            {(showAll ? records : records.slice(0, LIST_PAGE)).map((r, i) => {
              const isFlagged = flagged.includes(r);
              const isUnreviewed = r.review == null;
              const statusColor = isUnreviewed ? '#9ca3af' : isFlagged ? '#d97706' : '#16a34a';
              const statusText = isUnreviewed ? '未审到' : isFlagged ? '不达标' : '达标';
              return (
                <div key={`${r.ts}-${i}`} style={{
                  border: `1px solid ${isUnreviewed ? 'var(--rule-soft)' : 'var(--rule)'}`,
                  borderLeft: `3px solid ${statusColor}`,
                  borderRadius: '6px', padding: '0.5rem 0.75rem', fontSize: '0.8rem',
                  opacity: isUnreviewed ? 0.75 : 1,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.25rem', gap: '0.5rem' }}>
                    <strong style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ color: statusColor, fontSize: '0.7rem', fontWeight: 700 }}>{statusText}</span>
                      <span>
                        {r.seriesTitle || r.seriesId.slice(0, 8)} · 第{r.pageNumber}页 · 第{r.panelIndex + 1}格
                      </span>
                      {r.review && <span style={{ color: scoreColor(r.review.overall) }}>{r.review.overall}/100</span>}
                      {r.review && (
                        <span className="kicker" style={{ fontSize: '0.65rem' }}>
                          {r.review.verdict === 'publish' ? '可直接发布' : r.review.verdict === 'revise' ? '可发布但有改进点' : '建议重画'}
                        </span>
                      )}
                    </strong>
                    <span className="kicker" style={{ fontSize: '0.65rem', whiteSpace: 'nowrap' }}>
                      {new Date(r.ts).toLocaleString('zh-CN', { hour12: false })}
                    </span>
                  </div>

                  {isUnreviewed ? (
                    <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>
                      审核调用失败或模型没收到图 —— 按「视作通过」处理，未计入分数。这一格不能算审过。
                    </div>
                  ) : (
                    <>
                      {r.review?.topIssue && (
                        <div style={{ color: scoreColor(r.review.overall), marginBottom: '0.25rem', fontWeight: 500 }}>
                          📝 {r.review.topIssue}
                        </div>
                      )}
                      {/* 只展开失分维度：达标的图没必要把 8 维全铺开 */}
                      {r.review && (Object.entries(r.review.dimensions) as Array<[string, { score: number; reason: string }]>)
                        .filter(([, v]) => v.score < 7)
                        .slice(0, 3)
                        .map(([k, v]) => {
                          const label = DIMS.find(d => d.key === k)?.label ?? k;
                          return (
                            <div key={k} style={{ color: '#6b7280', fontSize: '0.75rem' }}>
                              · {label} {v.score.toFixed(1)}/10 — {v.reason}
                            </div>
                          );
                        })}
                      {(r.limbGuard?.abnormal || r.genderAudit?.mismatch) && (
                        <div style={{ color: '#d97706', fontSize: '0.75rem', marginTop: '0.2rem' }}>
                          {r.limbGuard?.abnormal ? `🦴 肢体异常：${r.limbGuard.reason}` : ''}
                          {r.genderAudit?.mismatch ? ` ⚧ 性别不符：${r.genderAudit.reason}` : ''}
                        </div>
                      )}
                      {r.alignmentAudit && !r.alignmentAudit.ok && (
                        <div style={{ color: '#d97706', fontSize: '0.75rem' }}>
                          🎯 图文对齐：{r.alignmentAudit.reason}
                        </div>
                      )}
                    </>
                  )}

                  {r.regenReason !== 'ok' && (
                    <div style={{ color: '#d97706', marginTop: '0.25rem', fontSize: '0.75rem' }}>
                      🔄 重生成: {r.regenReason}（第{r.attempt}/{r.totalAttempts}次达标）
                    </div>
                  )}
                  <div className="kicker" style={{ fontSize: '0.62rem', marginTop: '0.2rem' }}>
                    {Math.round((r.costMs || 0) / 1000)}s · {r.action} · prompt {r.promptLen} 字符
                  </div>
                </div>
              );
            })}
            {records.length > LIST_PAGE && (
              <button
                type="button"
                onClick={() => setShowAll(v => !v)}
                style={{
                  alignSelf: 'flex-start', padding: '0.3rem 0.8rem', fontSize: '0.75rem',
                  border: '1px solid var(--rule)', borderRadius: '6px',
                  background: 'var(--paper-2, #fafaf7)', cursor: 'pointer',
                }}
              >
                {showAll ? '收起' : `显示更多（还有 ${records.length - LIST_PAGE} 条）`}
              </button>
            )}
          </div>
        </>
      )}
      </div>
    </section>
  );
}

/**
 * 8 维雷达图（纯 SVG，避免引入图表库）。
 * 半径 110px，居中放置，每个顶点画轴线 + 多边形 + 标签。
 */
function RadarChart({ dimensions }: { dimensions: Record<string, number | null> }) {
  const size = 280;
  const cx = size / 2;
  const cy = size / 2;
  const r = 100;
  const n = DIMS.length;
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const point = (i: number, val: number) => {
    const a = angle(i);
    const rr = (val / 10) * r;
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
  };
  // 当前多边形
  const points = DIMS.map((d, i) => {
    const v = dimensions[d.key];
    return point(i, typeof v === 'number' ? v : 0).join(',');
  }).join(' ');
  return (
    <div style={{ background: 'var(--paper-2, #fafaf7)', border: '1px solid var(--rule-soft)', borderRadius: '8px', padding: '0.75rem 1rem', minWidth: 300 }}>
      <div className="kicker kicker--accent" style={{ marginBottom: '0.25rem' }}>8 维评审雷达图</div>
      <svg width={size} height={size} style={{ display: 'block' }}>
        {/* 网格圈 */}
        {[2, 4, 6, 8, 10].map(v => {
          const r2 = (v / 10) * r;
          const pts = DIMS.map((_, i) => {
            const a = angle(i);
            return `${cx + Math.cos(a) * r2},${cy + Math.sin(a) * r2}`;
          }).join(' ');
          return <polygon key={v} points={pts} fill="none" stroke="#e5e7eb" strokeWidth="0.5" />;
        })}
        {/* 轴线 */}
        {DIMS.map((_, i) => {
          const a = angle(i);
          return <line key={i} x1={cx} y1={cy} x2={cx + Math.cos(a) * r} y2={cy + Math.sin(a) * r} stroke="#e5e7eb" strokeWidth="0.5" />;
        })}
        {/* 当前数据多边形 */}
        <polygon points={points} fill="rgba(217, 119, 6, 0.2)" stroke="#d97706" strokeWidth="2" />
        {/* 顶点 */}
        {DIMS.map((d, i) => {
          const v = dimensions[d.key];
          const [px, py] = point(i, typeof v === 'number' ? v : 0);
          const color = typeof v === 'number' ? scoreColor(v * 10) : '#9ca3af';
          return <circle key={d.key} cx={px} cy={py} r="3" fill={color} />;
        })}
        {/* 标签 */}
        {DIMS.map((d, i) => {
          const a = angle(i);
          const lr = r + 18;
          const x = cx + Math.cos(a) * lr;
          const y = cy + Math.sin(a) * lr;
          const v = dimensions[d.key];
          const color = typeof v === 'number' ? scoreColor(v * 10) : '#6b7280';
          return (
            <text
              key={d.key}
              x={x}
              y={y}
              fontSize="11"
              fill={color}
              textAnchor="middle"
              dominantBaseline="middle"
              fontWeight="600"
            >
              {d.label}
              {typeof v === 'number' && <tspan x={x} dy="12" fontSize="10" fill={color}>{v.toFixed(1)}</tspan>}
            </text>
          );
        })}
      </svg>
    </div>
  );
}