import type { Series, SeriesCharacter, CharacterGender, CharacterAgeBand } from '../../types';
import { CHARACTER_GENDERS, CHARACTER_AGE_BANDS } from '../../types';
import { PlusIcon, RedoAltIcon } from '../icons';

/**
 * 性别 / 年龄段枚举的中文展示标签（2026-09-01）。
 * 把"english enum → 中文UI" 集中在此处，前后端共用字符映射，
 * 避免出现"页面英文 / 数据中文"的混搭导致的判定错误。
 */
const GENDER_LABEL: Record<CharacterGender, string> = {
  female: '女',
  male: '男',
  ambiguous: '中性',
  nonbinary: '非二元',
};
const AGE_BAND_LABEL: Record<CharacterAgeBand, string> = {
  child: '儿童',
  teen: '青少年',
  young_adult: '青年',
  middle_aged: '中年',
  elderly: '老年',
};

function CharactersCard({
  series, onGenerate, onAddChar, onDeleteChar, onRegenCharImg, onRegenCharShot, onEdit, onView, busy,
}: {
  series: Series;
  onGenerate: () => void;
  onAddChar: () => void;
  onDeleteChar: (id: string) => void | Promise<void>;
  onRegenCharImg: (id: string) => void | Promise<void>;
  onRegenCharShot: (id: string, shot: 'sheet') => void | Promise<void>;
  onEdit: (char: SeriesCharacter) => void;
  onView: (char: SeriesCharacter) => void;
  busy: boolean;
}) {
  if (series.characters.length === 0) {
    const blueprints = series.worldview?.characterBlueprints ?? [];
    const subtitle = blueprints.length > 0
      ? `AI 会按世界观的 ${blueprints.length} 人角色蓝图展开为完整角色（含外貌 + 参考图），之后每一格画到这个角色都会用这张图保持一致。`
      : `AI 会根据剧情大纲 / 矛盾推断核心角色（2-4 人），并为每人生成一张参考图；之后每一格画到这个角色都会用这张图保持一致。`;
    return (
      <div>
        <p className="deck" style={{ marginBottom: '1rem' }}>{subtitle}</p>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={() => onGenerate()} disabled={busy} className="btn btn--primary">
            {busy ? '生成中…' : '按世界观生成角色 ▸'}
          </button>
          <button onClick={onAddChar} className="btn btn--ghost">手动添加</button>
        </div>
      </div>
    );
  }
  const roleLabel = (r: string) => r === 'protagonist' ? '主角' : r === 'antagonist' ? '反派' : '配角';
  // 角色参考图（v3）：仅 sheet 一张图（4 视图参考表，2x2 网格）。
  // 兼容老结构 referenceImages.length === 2/4（取 idx 0 作 sheet 兜底）。
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(15rem, 1fr))', gap: '1rem' }}>
        {series.characters.map(c => {
          const refs = c.referenceImages && c.referenceImages.length > 0
            ? c.referenceImages
            : (c.referenceImage ? [c.referenceImage] : []);
          // 主视图：sheet 优先（idx 0），老 4 张结构时也取 idx 0
          const main = refs[0];
          return (
          <div
            key={c.id}
            role="button"
            tabIndex={0}
            onClick={() => onView(c)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onView(c); } }}
            title={'点击查看「' + c.name + '」的完整信息'}
            style={{ background: 'var(--bg-soft)', cursor: 'pointer', transition: 'box-shadow 0.15s' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 2px 12px rgba(0,0,0,0.08)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'none'; }}
          >
            <div style={{ aspectRatio: '1 / 1', background: 'var(--bg-paper-2)', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {main ? (
                <>
                  <img src={main} alt={c.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  {/* v3：参考图集只有 sheet 一张（= 主图），缩略图不再重复渲染，
                      改为角标点击看大图 */}
                  <button
                    title="4 视图参考表（点击看大图）"
                    onClick={(e) => { e.stopPropagation(); window.open(main, '_blank'); }}
                    style={{
                      position: 'absolute', bottom: 2, left: 2,
                      background: 'rgba(250,247,238,0.85)', color: 'var(--ink-1)',
                      fontSize: '0.5625rem', padding: '0.0625rem 0.25rem', borderRadius: 1,
                      border: 'none', cursor: 'zoom-in',
                    }}
                  >参考表</button>
                </>
              ) : (
                <span style={{ fontSize: '0.6875rem', color: 'var(--ink-3)' }}>暂无参考图</span>
              )}
            </div>
            <div style={{ padding: '0.625rem 0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{c.name}</span>
                <span className="kicker" style={{ fontSize: '0.5625rem', color: c.role === 'protagonist' ? 'var(--accent)' : 'var(--ink-3)' }}>
                  {roleLabel(c.role)}
                </span>
              </div>
              {/* 2026-09-01 新增：性别 / 年龄段 chip。
                   这是用户一眼看出"这个角色性别 / 年龄是否清楚"的最快通道；
                   同时让用户感知到"如果不显示，就是 LLM 没标，参考图可能糊"。 */}
              <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.375rem', flexWrap: 'wrap' }}>
                {c.gender && (
                  <span
                    title="性别（手动优先于 AI 推断）"
                    style={{
                      fontSize: '0.5625rem',
                      background: 'var(--bg-paper-2)',
                      border: '1px solid var(--rule-soft)',
                      padding: '0.0625rem 0.375rem',
                      borderRadius: '2px',
                      color: 'var(--ink-2)',
                    }}
                  >
                    {GENDER_LABEL[c.gender]}
                  </span>
                )}
                {c.ageBand && (
                  <span
                    title="年龄段（手动优先于 AI 推断）"
                    style={{
                      fontSize: '0.5625rem',
                      background: 'var(--bg-paper-2)',
                      border: '1px solid var(--rule-soft)',
                      padding: '0.0625rem 0.375rem',
                      borderRadius: '2px',
                      color: 'var(--ink-2)',
                    }}
                  >
                    {AGE_BAND_LABEL[c.ageBand]}
                  </span>
                )}
                {!c.gender && !c.ageBand && (
                  <span
                    title="点击「编辑」补全性别 / 年龄段，可显著改善参考图里看不出来是男是女 / 老幼的问题"
                    style={{
                      fontSize: '0.5625rem',
                      color: 'var(--ink-3)',
                      fontStyle: 'italic',
                    }}
                  >
                    未标注性别/年龄段
                  </span>
                )}
              </div>
              <p style={{ fontSize: '0.6875rem', color: 'var(--ink-2)', marginTop: '0.375rem', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{c.description}</p>
              {c.roleInStory && (
                <p style={{ fontSize: '0.625rem', color: 'var(--ink-3)', marginTop: '0.25rem', lineHeight: 1.35 }}>· {c.roleInStory}</p>
              )}
              {/* v3：参考图集仅 sheet 一张（已作为主图展示），此处不再重复渲染缩略图 */}
              {(c.visualAnchors ?? []).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.375rem' }}>
                  {(c.visualAnchors ?? []).slice(0, 3).map((a, i) => (
                    <span key={i} style={{ background: 'var(--bg-paper-2)', border: '1px solid var(--rule-soft)', padding: '0.125rem 0.375rem', borderRadius: '2px', fontSize: '0.625rem', color: 'var(--ink-2)' }}>
                      {a}
                    </span>
                  ))}
                  {(c.visualAnchors ?? []).length > 3 && (
                    <span style={{ fontSize: '0.625rem', color: 'var(--ink-3)' }}>+{(c.visualAnchors ?? []).length - 3}</span>
                  )}
                </div>
              )}
              <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.5rem' }}>
                <button onClick={(e) => { e.stopPropagation(); onRegenCharImg(c.id); }} disabled={busy} className="btn btn--link" style={{ fontSize: '0.6875rem', padding: 0 }}>重生成图</button>
                <span style={{ flex: 1 }} />
                <button onClick={(e) => { e.stopPropagation(); onEdit(c); }} className="btn btn--link" style={{ fontSize: '0.6875rem', padding: 0 }}>编辑</button>
                <button onClick={(e) => { e.stopPropagation(); onDeleteChar(c.id); }} className="btn btn--link" style={{ fontSize: '0.6875rem', padding: 0, color: 'var(--danger)' }}>删除</button>
              </div>
            </div>
          </div>
          );
        })}
      </div>
      <hr className="rule-soft" />
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button onClick={() => onGenerate()} disabled={busy} className="btn btn--link" style={{ fontSize: '0.8125rem' }}>
          <RedoAltIcon className="w-3.5 h-3.5" />{busy ? '生成中…' : '按世界观重新生成'}
        </button>
        <span style={{ flex: 1 }} />
        <button onClick={onAddChar} className="btn btn--ghost" style={{ fontSize: '0.8125rem' }}>
          <PlusIcon className="w-3.5 h-3.5" />手动添加
        </button>
      </div>
    </div>
  );
}

export { CharactersCard };
