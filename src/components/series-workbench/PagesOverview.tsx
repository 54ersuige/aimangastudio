import type { Series } from '../../types';

/**
 * 话级总览 —— 发布/创作最小单位是「话」。
 * 每话一张卡：全局话号 + 进度（已生成格数），点击进入该话的分镜卡。
 * （page 只是内部 6 格一批的生成批次，这里完全不暴露。）
 */
function EpisodesOverview({ series, onPickEpisode }: { series: Series; onPickEpisode: (chapterId: string) => void }) {
  const allChapters = series.arcs && series.arcs.length > 0
    ? series.arcs.flatMap(a => a.chapters)
    : (series.chapters ?? []);
  return (
    <div>
      <p className="deck" style={{ marginBottom: '1rem' }}>从下面选一话开始，或点上方「章节大纲」里任一话的缩略图。</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
        {allChapters.map((ch, i) => {
          const panels = ch.pages.flatMap(p => p.panels);
          const done = panels.filter(pn => !!pn.imageUrl).length;
          const firstImg = panels.find(pn => pn.imageUrl)?.imageUrl;
          const complete = panels.length > 0 && done === panels.length;
          return (
            <button
              key={ch.id}
              onClick={() => onPickEpisode(ch.id)}
              className="card"
              style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', padding: '0.75rem 1rem', cursor: 'pointer', textAlign: 'left' }}
            >
              <div className="panel-thumb" style={{ width: '3rem', aspectRatio: '3 / 4', flexShrink: 0 }}>
                {firstImg ? <img src={firstImg} alt="" /> : <span style={{ color: 'var(--ink-3)' }}>{i + 1}</span>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '0.9375rem' }}>
                  第 {i + 1} 话《{ch.title}》
                </div>
                {ch.summary && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--ink-2)', lineHeight: 1.5, marginTop: '0.125rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ch.summary}
                  </div>
                )}
              </div>
              <span className="mono tnum" style={{ fontSize: '0.6875rem', color: complete ? 'var(--accent)' : 'var(--ink-3)', flexShrink: 0 }}>
                {panels.length > 0 ? `已生成 ${done}/${panels.length} 格` : '未拆解'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { EpisodesOverview };
