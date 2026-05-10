// app.jsx — main React app, loads pre-computed data/stats.json
const { useState, useMemo, useEffect } = React;

const PERIODS = [
  { id: 'today', label: '오늘',    cls: 'c-coral'  },
  { id: 'week',  label: '이번 주', cls: 'c-sky'    },
  { id: 'all',   label: '전체',   cls: 'c-yellow' },
];

const App = () => {
  const [loading, setLoading]       = useState(true);
  const [statsData, setStatsData]   = useState(null);
  const [playersRaw, setPlayersRaw] = useState([]);
  const [traitNames, setTraitNames] = useState({});
  const [season, setSeason]         = useState('all');
  const [period, setPeriod]         = useState('all');
  const [modalOpen, setModalOpen]   = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('data/stats.json').then(r => r.json()).catch(() => null),
      fetch('data/players.json').then(r => r.json()).catch(() => null),
      fetch('data/trait_names.json').then(r => r.json()).catch(() => ({})),
    ]).then(([stats, pj, traits]) => {
      setStatsData(stats);
      setPlayersRaw(pj?.players || []);
      setTraitNames(traits || {});
      if (stats?.available_sets?.length > 0) {
        setSeason(`set_${stats.available_sets[0]}`);
      }
      setLoading(false);
    });
  }, []);

  const playerNames    = useMemo(() => statsData?.players || [], [statsData]);
  const availableSets  = useMemo(() => statsData?.available_sets || [], [statsData]);
  const recentMatches  = useMemo(() => statsData?.recent_shared_matches || [], [statsData]);
  const lastUpdated    = statsData?.last_updated;

  const playerMetaMap = useMemo(() => {
    const m = {};
    playersRaw.forEach(p => { m[p.name] = p; });
    return m;
  }, [playersRaw]);

  const h2hKey  = TFTUtils.getH2HKey(season, period);
  const cardKey = TFTUtils.getCardKey(season);

  const playerStats = useMemo(() => {
    if (!statsData) return {};
    return TFTUtils.computePlayerStats(statsData, playerNames, h2hKey, cardKey, playerMetaMap);
  }, [statsData, playerNames, h2hKey, cardKey, playerMetaMap]);

  const allPlayers = useMemo(() =>
    playerNames.map(n => playerStats[n]).filter(Boolean),
    [playerNames, playerStats]
  );

  const ranked = useMemo(() =>
    [...allPlayers].sort((a, b) => b.score - a.score),
    [allPlayers]
  );

  const rankedWithGames = ranked.filter(s => s.wins + s.losses + s.draws > 0);

  const seasonOptions = [
    { id: 'all', label: '전체 시즌' },
    ...availableSets.map(s => ({ id: `set_${s}`, label: `세트 ${s}` })),
  ];

  const h2hData = statsData?.[h2hKey] || {};

  const resolveTraitName = (apiName) =>
    traitNames[apiName] || apiName.replace(/^TFT\d+_/, '');

  if (loading) return <div className="container"><Loading /></div>;

  if (!statsData) return (
    <div className="container">
      <div className="card">
        <div className="empty">
          <div className="big">데이터를 불러올 수 없어요 :(</div>
          <div>data/stats.json 파일을 확인해주세요.</div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="container">

      {/* Banner */}
      <div className="banner">
        <div className="banner-cluster">
          {ranked.slice(0, 4).map((p, i) => (
            <div key={p.id} style={{ position: 'absolute', left: i * 22, top: i % 2 ? 18 : 0 }}>
              <Avatar p={p} size={42} ring="var(--panel)" />
            </div>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="banner-eyebrow">우리 단톡방 ♡</div>
          <div className="banner-title">TFT 같이 한 사람들</div>
          <div className="banner-meta">
            {playerNames.length}명
            {recentMatches.length > 0 && <> · 최근 공유 게임 {recentMatches.length}판 기록됨</>}
            {lastUpdated && <> · 업데이트 {TFTUtils.fmtRelDate(new Date(lastUpdated).getTime())}</>}
          </div>
        </div>
        <button className="btn-add" onClick={() => setModalOpen(true)}>+ 친구 추가</button>
      </div>

      {/* Season pills */}
      {seasonOptions.length > 1 && (
        <div className="pill-row">
          {seasonOptions.map(s => (
            <button
              key={s.id}
              className={`pill ${season === s.id ? 'is-active c-yellow' : ''}`}
              onClick={() => setSeason(s.id)}
            >{s.label}</button>
          ))}
        </div>
      )}

      {/* Period pills */}
      <div className="pill-row">
        {PERIODS.map(p => (
          <button
            key={p.id}
            className={`pill ${period === p.id ? 'is-active ' + p.cls : ''}`}
            onClick={() => setPeriod(p.id)}
          >{p.label}</button>
        ))}
        <div className="pill-formula">누적점수 = ∑(상대등수 − 내등수) ✿</div>
      </div>

      {/* No games for this period */}
      {rankedWithGames.length === 0 ? (
        <div className="card"><EmptyState /></div>
      ) : (
        <>
          {/* Player cards */}
          <div className="card">
            <div className="card-title">친구들 <small>최근 랭크 폼은 색깔로</small></div>
            <div className="player-grid">
              {ranked.map(s => {
                const flairs = TFTUtils.autoFlair(s, ranked);
                return (
                  <div className="player" key={s.id}>
                    <Avatar p={s} size={64} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="name">
                        <span>{s.name}</span>
                        {flairs.slice(0, 1).map(f => (
                          <span key={f} className="flair">{f}</span>
                        ))}
                      </div>
                      <div className="meta">
                        {TFTUtils.fmtTier(s.tier, s.rank, s.lp)}
                        {s.sharedRankedGames > 0 &&
                          <> · 같이 {s.sharedRankedGames}판 · 평균 {s.sharedRankedAvg}등</>
                        }
                      </div>
                      <FormStrip form={s.recentForm} />
                      {s.topTraits.length > 0 && (
                        <div className="trait-row">
                          {s.topTraits.map((t, i) => (
                            <TraitBadge
                              key={i}
                              name={resolveTraitName(t.name)}
                              style={t.style}
                              count={t.count}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                    <ScoreChip score={s.score} />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Standings */}
          <div className="card">
            <div className="card-title">🏆 종합 순위 <small>오늘의 1등은 누구일까~?</small></div>
            {rankedWithGames.length >= 3 && (
              <div className="podium">
                {[1, 0, 2].map(idx => {
                  const p = rankedWithGames[idx];
                  if (!p) return null;
                  const heights    = [92, 60, 38];
                  const blockBgs   = ['var(--yellow)', '#E8EEF2', '#F2D2BE'];
                  const scoreColors = ['var(--yellow-deep)', 'var(--sky)', 'var(--coral)'];
                  return (
                    <div className="podium-col" key={p.id}>
                      <Medal n={idx + 1} />
                      <Avatar p={p} size={56} />
                      <div className="podium-name">{p.name}</div>
                      <div className="podium-score" style={{ color: scoreColors[idx] }}>
                        {p.score >= 0 ? '+' : ''}{p.score}
                      </div>
                      <div className="podium-block" style={{ height: heights[idx], background: blockBgs[idx] }}>
                        {idx + 1}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {rankedWithGames.length > 3 && (
              <div className="standings">
                {rankedWithGames.slice(3).map((p, i) => {
                  const cls = p.score > 0 ? 'pos' : p.score < 0 ? 'neg' : 'zero';
                  const flairs = TFTUtils.autoFlair(p, ranked);
                  return (
                    <div className="standings-row" key={p.id}>
                      <div className="rank">{i + 4}</div>
                      <Avatar p={p} size={36} />
                      <div className="name">{p.name}</div>
                      <div className="flairs">{flairs.join(' · ')}</div>
                      <div className={`score ${cls}`}>{p.score >= 0 ? '+' : ''}{p.score}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* H2H Matrix */}
          <div className="card">
            <div className="card-title">일대일 누가 더 셀까? <small>마우스 올리면 상세</small></div>
            <div className="matrix-wrap">
              <table className="matrix">
                <thead>
                  <tr>
                    <th></th>
                    {ranked.map(p => <th key={p.id}>{p.name}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {ranked.map(row => (
                    <tr key={row.id}>
                      <th className="row">{row.name}</th>
                      {ranked.map(col => {
                        if (row.id === col.id) {
                          return <td key={col.id} className="empty">·</td>;
                        }
                        const cell = h2hData[row.id]?.[col.id];
                        if (!cell || cell.shared_games === 0) {
                          return <td key={col.id} className="empty" style={{ fontSize: 13, color: 'var(--ink-mute)' }}>—</td>;
                        }
                        const v = cell.score;
                        const intensity = Math.min(1, Math.abs(v) / Math.max(8, cell.shared_games * 2));
                        const bg = v > 0
                          ? `oklch(${94 - intensity * 16}% ${0.04 + intensity * 0.10} 150)`
                          : v < 0
                            ? `oklch(${94 - intensity * 14}% ${0.04 + intensity * 0.10} 12)`
                            : 'var(--bg-soft)';
                        const color = v > 0 ? 'var(--mint-deep)' : v < 0 ? '#a13b4d' : 'var(--ink-soft)';
                        return (
                          <td key={col.id} className="cell" style={{ background: bg, color }}>
                            {v > 0 ? '+' : ''}{v}
                            <div className="matrix-tip">
                              {row.name} vs {col.name} · {cell.shared_games}판 · {row.name} {cell.wins}승
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent shared matches feed */}
          {recentMatches.length > 0 && (
            <div className="card">
              <div className="card-title">방금 끝난 판들</div>
              <div className="feed">
                {recentMatches.slice(0, 6).map((m, idx) => {
                  const entries = m.results || [];
                  if (entries.length < 2) return null;
                  const first = entries[0];
                  const last  = entries[entries.length - 1];
                  const fp = { id: first.name, name: first.name, hue: TFTUtils.hueFor(first.name) };
                  const lp = { id: last.name,  name: last.name,  hue: TFTUtils.hueFor(last.name)  };
                  const firstBubble =
                    first.placement === 1 ? '나 1등 ㅎㅎ 캐리' :
                    first.placement <= 3  ? `${first.placement}등 했다~` :
                                            `오늘은 ${first.placement}등이 최고`;
                  const lastBubble =
                    last.placement === 8 ? '아 ㅋㅋ 또 8등이야 ㅠㅠ' :
                    last.placement >= 6  ? `${last.placement}등 했어... 다음판 가즈아` :
                                           `${last.placement}등으로 마무리`;
                  return (
                    <div className="feed-item" key={idx}>
                      <div className="feed-meta">
                        <span>{TFTUtils.fmtRelDate(m.game_datetime)}</span>
                        <span>·</span>
                        {entries.map((e, j) => (
                          <span className="pip" key={j}>
                            <span className={`r ${e.placement === 1 ? 'first' : e.placement === 8 ? 'last' : ''}`}>
                              {e.placement}
                            </span>
                            <span>{e.name}</span>
                          </span>
                        ))}
                      </div>
                      <div className="bubble-row">
                        <Avatar p={fp} size={36} />
                        <div className="bubble-col">
                          <div className="bubble-name">{first.name}</div>
                          <div className="bubble left">{firstBubble}</div>
                        </div>
                      </div>
                      {first.name !== last.name && (
                        <div className="bubble-row right">
                          <div className="bubble-col">
                            <div className="bubble-name">{last.name}</div>
                            <div className="bubble right">{lastBubble}</div>
                          </div>
                          <Avatar p={lp} size={36} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      <div className="footer">made with ♡ for friends — TFT 친구 상대전적</div>
      <AddPlayerModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
