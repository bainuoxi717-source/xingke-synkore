// 极简 SVG 图表（不引入任何图表库）
const COLORS = ['#2563eb', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

export default function Chart({ spec }) {
  if (!spec || !spec.labels?.length || !spec.values?.length) return null;
  const { type = 'bar', title, labels, values } = spec;
  const nums = values.map((v) => Number(v) || 0);
  const max = Math.max(...nums, 1);
  const total = nums.reduce((a, b) => a + b, 0) || 1;

  if (type === 'pie') {
    let acc = 0;
    const R = 62, C = 80;
    const slices = nums.map((v, i) => {
      const frac = v / total;
      const a0 = acc * 2 * Math.PI - Math.PI / 2;
      acc += frac;
      const a1 = acc * 2 * Math.PI - Math.PI / 2;
      const large = frac > 0.5 ? 1 : 0;
      const x0 = C + R * Math.cos(a0), y0 = C + R * Math.sin(a0);
      const x1 = C + R * Math.cos(a1), y1 = C + R * Math.sin(a1);
      return { d: `M ${C} ${C} L ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`, color: COLORS[i % COLORS.length], label: labels[i], v };
    });
    return (
      <div className="chart-box">
        {title && <div className="chart-title">{title}</div>}
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <svg width="160" height="160" viewBox="0 0 160 160">
            {slices.map((s, i) => <path key={i} d={s.d} fill={s.color} stroke="#fff" strokeWidth="1.5" />)}
          </svg>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {slices.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                <span className="dot" style={{ background: s.color }} />
                <span>{s.label}</span>
                <span style={{ color: 'var(--text-2)' }}>{((s.v / total) * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const W = 460, H = 200, pad = { l: 40, r: 16, t: 16, b: 34 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const step = iw / nums.length;

  return (
    <div className="chart-box">
      {title && <div className="chart-title">{title}</div>}
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: W }}>
        {/* 网格 */}
        {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
          const y = pad.t + ih * (1 - f);
          return (
            <g key={i}>
              <line x1={pad.l} y1={y} x2={W - pad.r} y2={y} stroke="var(--border)" strokeDasharray="3 3" />
              <text x={pad.l - 6} y={y + 4} textAnchor="end" fontSize="10" fill="var(--text-2)">{Math.round(max * f)}</text>
            </g>
          );
        })}
        {type === 'line' ? (
          <>
            <polyline
              fill="none" stroke={COLORS[0]} strokeWidth="2"
              points={nums.map((v, i) => `${pad.l + step * (i + 0.5)},${pad.t + ih * (1 - v / max)}`).join(' ')}
            />
            {nums.map((v, i) => (
              <g key={i}>
                <circle cx={pad.l + step * (i + 0.5)} cy={pad.t + ih * (1 - v / max)} r="3.5" fill={COLORS[0]} />
                <text x={pad.l + step * (i + 0.5)} y={H - pad.b + 14} textAnchor="middle" fontSize="10" fill="var(--text-2)">
                  {String(labels[i]).slice(0, 6)}
                </text>
              </g>
            ))}
          </>
        ) : (
          nums.map((v, i) => {
            const h = ih * (v / max);
            const bw = Math.min(step * 0.62, 46);
            return (
              <g key={i}>
                <rect x={pad.l + step * (i + 0.5) - bw / 2} y={pad.t + ih - h} width={bw} height={h} rx="3" fill={COLORS[i % COLORS.length]} />
                <text x={pad.l + step * (i + 0.5)} y={pad.t + ih - h - 4} textAnchor="middle" fontSize="10" fill="var(--text)">{v}</text>
                <text x={pad.l + step * (i + 0.5)} y={H - pad.b + 14} textAnchor="middle" fontSize="10" fill="var(--text-2)">
                  {String(labels[i]).slice(0, 6)}
                </text>
              </g>
            );
          })
        )}
      </svg>
    </div>
  );
}
