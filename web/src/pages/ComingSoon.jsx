import { Construction } from 'lucide-react';

export default function ComingSoon({ title, desc, points = [] }) {
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">{title}</div>
          <div className="page-sub">功能开发中，随数据接入逐步上线</div>
        </div>
      </div>
      <div className="card" style={{ maxWidth: 680 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <Construction size={40} color="var(--accent)" style={{ flexShrink: 0, marginTop: 4 }} />
          <div>
            <h3 style={{ fontSize: 16, marginBottom: 6 }}>{title}</h3>
            <p style={{ color: 'var(--text-2)', marginBottom: 12 }}>{desc}</p>
            <ul style={{ paddingLeft: 20, color: 'var(--text-2)', fontSize: 13 }}>
              {points.map((p) => (
                <li key={p} style={{ marginBottom: 4 }}>{p}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
