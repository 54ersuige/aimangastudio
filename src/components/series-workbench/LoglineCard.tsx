import type { Series } from '../../types';
import type { DnaMeta } from '../../services/modelConfig';

function LoglineCard({ series, dnaList = [] }: { series: Series; dnaList?: DnaMeta[] }) {
  // series.dnaKey 在创建时被冻结；找不到 metadata 时回退到 key 字符串，避免「未加载 DNA 元数据」时显示空白。
  const dnaMeta = dnaList.find(d => d.key === series.dnaKey);
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        <div>
          <div className="kicker">故事简介</div>
          <p style={{ fontSize: '1rem', lineHeight: 1.6, color: 'var(--ink)', marginTop: '0.5rem' }}>{series.logline}</p>
        </div>
        <div>
          <div className="kicker">画风 DNA（创建后不可更改）</div>
          {dnaMeta ? (
            <>
              <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--ink)', marginTop: '0.5rem' }}>{dnaMeta.name}</p>
              <p style={{ fontSize: '0.8125rem', color: 'var(--ink-2)', lineHeight: 1.4, marginTop: '0.25rem' }}>{dnaMeta.tagline}</p>
            </>
          ) : (
            <p style={{ fontSize: '0.9375rem', color: 'var(--ink-2)', marginTop: '0.5rem' }}>{series.dnaKey || '（加载中…）'}</p>
          )}
        </div>
      </div>
      <hr className="rule-soft" />
      <div className="kicker">这些信息是后续每一步 AI 生成的依据，可在聊天中修改（画风除外）。</div>
    </div>
  );
}

export { LoglineCard };
