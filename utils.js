// utils.js — data helpers for stats.json-based tracker
window.TFTUtils = (function () {

  function hueFor(name) {
    let h = 0;
    const s = String(name);
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h) % 360;
  }

  // stats.json uses period keys: 'today', 'week', 'all'
  // per-set keys: 'set_14_today', 'set_14_week', 'set_14_all'
  function getH2HKey(season, period) {
    return season === 'all' ? period : `${season}_${period}`;
  }

  function getCardKey(season) {
    return season; // 'all' | 'set_14' | ...
  }

  // Aggregate per-player H2H stats for a given key
  function computePlayerStats(statsData, playerNames, h2hKey, cardKey, playerMetaMap) {
    const h2h = statsData[h2hKey] || {};
    const cards = statsData.player_cards?.[cardKey] || {};
    const result = {};
    for (const name of playerNames) {
      const myH2H = h2h[name] || {};
      let score = 0, wins = 0, losses = 0, draws = 0;
      for (const opp of playerNames) {
        if (opp === name) continue;
        const cell = myH2H[opp];
        if (!cell) continue;
        score  += cell.score  || 0;
        wins   += cell.wins   || 0;
        losses += cell.losses || 0;
        draws  += cell.draws  || 0;
      }
      const card = cards[name] || {};
      const meta = playerMetaMap[name] || {};
      result[name] = {
        id: name, name,
        hue: hueFor(name),
        score, wins, losses, draws,
        sharedGames:      card.shared?.total_games       || 0,
        sharedAvg:        card.shared?.avg_placement     || 0,
        sharedRankedGames: card.shared_ranked?.total_games || 0,
        sharedRankedAvg:  card.shared_ranked?.avg_placement || 0,
        top4Rate:         card.shared_ranked?.top4_rate  || 0,
        recentForm:       card.shared_ranked_recent_placements || [],
        topTraits:        card.top_traits || [],
        tier: meta.tier || 'UNRANKED',
        rank: meta.rank || '',
        lp:   meta.lp   || 0,
      };
    }
    return result;
  }

  function autoFlair(standing, allStandings) {
    const out = [];
    if (standing.wins + standing.losses + standing.draws === 0) return out;
    const withGames = allStandings.filter(s => s.wins + s.losses + s.draws > 0);
    const sorted = [...withGames].sort((a, b) => b.score - a.score);
    if (sorted.length && standing.name === sorted[0].name) out.push('🏆 1위');
    if (sorted.length > 2 && standing.name === sorted[sorted.length - 1].name) out.push('오늘의 호구');
    if (standing.wins >= 3) out.push('캐리장인');
    return out;
  }

  function fmtRelDate(ms) {
    if (!ms) return '';
    const d = new Date(typeof ms === 'string' ? ms : ms);
    const now = new Date();
    const mins = Math.floor((now - d) / 60000);
    if (mins < 1) return '방금';
    if (mins < 60) return mins + '분 전';
    const time = d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
    if (d.toDateString() === now.toDateString()) return '오늘 ' + time;
    const yest = new Date(now); yest.setDate(now.getDate() - 1);
    if (d.toDateString() === yest.toDateString()) return '어제 ' + time;
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + time;
  }

  const TIER_KR = {
    IRON: '아이언', BRONZE: '브론즈', SILVER: '실버', GOLD: '골드',
    PLATINUM: '플래티넘', EMERALD: '에메랄드', DIAMOND: '다이아',
    MASTER: '마스터', GRANDMASTER: '그랜드마스터', CHALLENGER: '챌린저',
  };

  function fmtTier(tier, rank, lp) {
    if (!tier || tier === 'UNRANKED') return '언랭';
    const kr = TIER_KR[tier] || tier;
    if (['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tier)) return `${kr} ${lp}LP`;
    return `${kr} ${rank} ${lp}LP`;
  }

  return { hueFor, getH2HKey, getCardKey, computePlayerStats, autoFlair, fmtRelDate, fmtTier };
})();
