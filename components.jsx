// components.jsx — reusable UI components
const { useState } = React;

const Avatar = ({ p, size = 56, ring }) => (
  <div
    className="av"
    style={{
      width: size, height: size,
      fontSize: size * 0.42,
      background: `radial-gradient(circle at 35% 30%, oklch(88% 0.08 ${p.hue}), oklch(60% 0.13 ${p.hue}))`,
      color: `oklch(28% 0.10 ${p.hue})`,
      boxShadow: ring ? `0 0 0 3px ${ring}` : 'none',
    }}
  >{(p.name || '?').slice(0, 1)}</div>
);

const Medal = ({ n }) => {
  const palette = [
    { bg: 'var(--yellow)',  ribbon: 'var(--coral)', label: '1ST' },
    { bg: '#D7DDE2',        ribbon: 'var(--sky)',   label: '2ND' },
    { bg: '#E8B380',        ribbon: 'var(--coral)', label: '3RD' },
  ];
  const m = palette[n - 1];
  if (!m) return null;
  return (
    <div className="medal">
      <div className="ribbon" style={{ background: m.ribbon }} />
      <div className="disc" style={{ background: m.bg }}>{m.label}</div>
    </div>
  );
};

const ScoreChip = ({ score }) => {
  const cls = score > 0 ? 'pos' : score < 0 ? 'neg' : 'zero';
  return (
    <div className={`score-chip ${cls}`}>
      {score > 0 ? '+' : ''}{score}
    </div>
  );
};

const FormStrip = ({ form }) => (
  <div className="form">
    {(form || []).slice(-8).map((r, k) => (
      <div key={k} className={`form-cell fc-${r}`}>{r}</div>
    ))}
    {(form || []).length === 0 && (
      <div style={{ fontSize: 11, color: 'var(--ink-mute)' }}>같이 한 판 없음</div>
    )}
  </div>
);

const TraitBadge = ({ name, style, count }) => (
  <span className={`trait-badge trait-style-${style}`} title={`${name} · ${count}게임`}>
    {name}
  </span>
);

const Loading = () => (
  <div className="loading">
    <div className="loading-dot"/><div className="loading-dot"/><div className="loading-dot"/>
    <div style={{ marginTop: 12 }}>친구들 데이터 가져오는 중...</div>
  </div>
);

const EmptyState = ({ message }) => (
  <div className="empty">
    <div className="big">{message || '이 기간엔 같이 한 게임이 없어요 ✿'}</div>
    <div>다른 기간이나 시즌을 선택해보세요!</div>
  </div>
);

const AddPlayerModal = ({ open, onClose }) => {
  const [name, setName] = useState('');
  const [riotId, setRiotId] = useState('');
  if (!open) return null;
  const entry = { name: name.trim() || '이름', riot_id: riotId.trim() || 'RiotID#KR1' };
  const json = JSON.stringify(entry, null, 2);
  const copy = () => navigator.clipboard?.writeText(json);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>친구 추가</h3>
        <div className="sub">
          정보를 입력하면 <code>data/players.json</code>에 추가할 JSON을 만들어줘요.<br/>
          GitHub에서 직접 붙여넣어 저장하세요.
        </div>
        <label>이름 (단톡방에서 부르는 별명)
          <input value={name} onChange={e => setName(e.target.value)} placeholder="예) 또또" />
        </label>
        <label>Riot ID
          <input value={riotId} onChange={e => setRiotId(e.target.value)} placeholder="예) 또또#KR1" />
        </label>
        {(name || riotId) && (
          <>
            <pre>{json}</pre>
            <div className="hint">
              <a href="https://github.com/gkdncks/tft-tracker/edit/main/data/players.json" target="_blank" rel="noopener">GitHub에서 players.json 편집 →</a>
            </div>
          </>
        )}
        <div className="modal-actions">
          {(name || riotId) && <button className="btn" onClick={copy}>복사</button>}
          <button className="btn primary" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { Avatar, Medal, ScoreChip, FormStrip, TraitBadge, Loading, EmptyState, AddPlayerModal });
