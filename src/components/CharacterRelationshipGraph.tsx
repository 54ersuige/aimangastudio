import React, { useMemo } from 'react';
import type { SeriesCharacter } from '../types';

interface Props {
  characters: SeriesCharacter[];
  /** 高度（宽度自适应容器）。默认 160。 */
  height?: number;
}

/**
 * 人物关系图（轻量 SVG，不需要外部库）。
 *
 * 节点布局：主角放中心，反派和配角环绕。
 * 边：根据角色关系推断（无显式关系数据时用 role 类型启发式）：
 *   - protagonist <-> antagonist  = 对手
 *   - protagonist <-> supporting  = 盟友
 *   - supporting <-> antagonist   = 冲突
 *   - supporting <-> supporting   = 中立
 */
export function CharacterRelationshipGraph({ characters, height = 160 }: Props): React.ReactElement {
  const graph = useMemo(() => buildLayout(characters), [characters]);

  if (characters.length === 0) {
    return <div className="text-[11px] text-gray-400 italic">暂无角色</div>;
  }

  const w = 320;
  const h = height;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: h }}>
      {/* 边 */}
      {graph.edges.map((e, i) => {
        const a = graph.nodes[e.from];
        const b = graph.nodes[e.to];
        const dashArray = e.kind === 'rival' ? '4 3' : e.kind === 'neutral' ? '2 3' : undefined;
        const color = e.kind === 'ally' ? '#10b981' : e.kind === 'rival' ? '#ef4444' : '#9ca3af';
        return (
          <line
            key={i}
            x1={a.x} y1={a.y}
            x2={b.x} y2={b.y}
            stroke={color}
            strokeWidth={1.5}
            strokeDasharray={dashArray}
            opacity={0.7}
          />
        );
      })}
      {/* 节点 */}
      {graph.nodes.map((n, i) => {
        const c = characters[i];
        const ringColor = c.role === 'protagonist' ? '#3b82f6' : c.role === 'antagonist' ? '#ef4444' : '#6b7280';
        return (
          <g key={c.id} transform={`translate(${n.x}, ${n.y})`}>
            <circle r={n.r} fill="white" stroke={ringColor} strokeWidth={2} />
            {(c.referenceImages?.[0] || c.referenceImage) ? (
              <>
                <defs>
                  <clipPath id={`clip-${c.id}`}>
                    <circle r={n.r - 1} />
                  </clipPath>
                </defs>
                <image
                  href={(c.referenceImages && c.referenceImages[0]) || c.referenceImage}
                  width={n.r * 2}
                  height={n.r * 2}
                  x={-n.r}
                  y={-n.r}
                  preserveAspectRatio="xMidYMid slice"
                  clipPath={`url(#clip-${c.id})`}
                />
              </>
            ) : (
              <text textAnchor="middle" dominantBaseline="central" fontSize={n.r * 0.7} fill={ringColor} fontWeight="bold">
                {c.name.slice(0, 1)}
              </text>
            )}
            <text textAnchor="middle" y={n.r + 12} fontSize={10} fill="#374151" fontWeight="500">
              {c.name}
            </text>
          </g>
        );
      })}
      {/* 图例 */}
      <g transform={`translate(${w - 90}, 12)`}>
        <rect width="80" height="46" fill="white" stroke="#e5e7eb" rx="4" />
        <line x1="6" y1="12" x2="22" y2="12" stroke="#10b981" strokeWidth="1.5" />
        <text x="26" y="15" fontSize="9" fill="#374151">盟友</text>
        <line x1="6" y1="26" x2="22" y2="26" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4 3" />
        <text x="26" y="29" fontSize="9" fill="#374151">对手</text>
        <line x1="6" y1="40" x2="22" y2="40" stroke="#9ca3af" strokeWidth="1.5" strokeDasharray="2 3" />
        <text x="26" y="43" fontSize="9" fill="#374151">中立</text>
      </g>
    </svg>
  );
}

interface NodePos { x: number; y: number; r: number; }
interface Edge { from: number; to: number; kind: 'ally' | 'rival' | 'neutral'; }

function buildLayout(chars: SeriesCharacter[]): { nodes: NodePos[]; edges: Edge[] } {
  const w = 320;
  const h = 160;
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) * 0.32;

  const protagonist = chars.find(c => c.role === 'protagonist');
  const antagonist = chars.find(c => c.role === 'antagonist');
  const supporting = chars.filter(c => c.role === 'supporting');

  const nodes: NodePos[] = [];
  const charIndex: Record<string, number> = {};

  // 主角：中心
  if (protagonist) {
    charIndex[protagonist.id] = 0;
    nodes.push({ x: cx, y: cy, r: 26 });
  }

  // 反派：左
  if (antagonist) {
    charIndex[antagonist.id] = nodes.length;
    nodes.push({ x: cx - R * 1.1, y: cy, r: 22 });
  }

  // 配角：均匀环绕右上、右、下
  const supR = R * 0.9;
  supporting.forEach((c, i) => {
    charIndex[c.id] = nodes.length;
    const angle = -Math.PI / 2 + (Math.PI * 2 * i) / Math.max(supporting.length, 1);
    nodes.push({ x: cx + supR * Math.cos(angle), y: cy + supR * Math.sin(angle), r: 20 });
  });

  // 边：启发式
  const edges: Edge[] = [];
  if (protagonist) {
    chars.forEach((c, i) => {
      if (c.id === protagonist.id) return;
      const pi = charIndex[protagonist.id];
      const ci = charIndex[c.id];
      if (c.role === 'antagonist') edges.push({ from: pi, to: ci, kind: 'rival' });
      else edges.push({ from: pi, to: ci, kind: 'ally' });
    });
  }
  // 配角之间：取决于是否有反派
  if (antagonist) {
    supporting.forEach((c) => {
      const ci = charIndex[c.id];
      const ai = charIndex[antagonist.id];
      edges.push({ from: ci, to: ai, kind: 'neutral' });
    });
  }
  // 配角互相中立连线
  for (let i = 0; i < supporting.length; i++) {
    for (let j = i + 1; j < supporting.length; j++) {
      edges.push({
        from: charIndex[supporting[i].id],
        to: charIndex[supporting[j].id],
        kind: 'neutral',
      });
    }
  }

  return { nodes, edges };
}