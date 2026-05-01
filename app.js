// app.js

const TIER_INFO = {
  IRON:        { label: "아이언",       color: "#7d6e5e" },
  BRONZE:      { label: "브론즈",       color: "#8c523a" },
  SILVER:      { label: "실버",         color: "#82878f" },
  GOLD:        { label: "골드",         color: "#c8aa6e" },
  PLATINUM:    { label: "플래티넘",     color: "#4a9e8e" },
  EMERALD:     { label: "에메랄드",     color: "#4a9e5c" },
  DIAMOND:     { label: "다이아몬드",   color: "#576bce" },
  MASTER:      { label: "마스터",       color: "#9d48e0" },
  GRANDMASTER: { label: "그랜드마스터", color: "#e84057" },
  CHALLENGER:  { label: "챌린저",       color: "#f4c874" },
  UNRANKED:    { label: "언랭크",       color: "#475569" },
};

const NO_RANK_TIERS = new Set(["MASTER", "GRANDMASTER", "CHALLENGER"]);

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDate(ms) {
  const d = new Date(ms);
  return d.toLocaleDateString("ko-KR", { month: "short", day: "numeric" }) +
    " " + d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function buildSetTabs(stats) {
  const nav = document.querySelector(".period-tabs");
  const sets = stats.available_sets || [];
  if (!sets.length) return;

  const sep = document.createElement("span");
  sep.className = "tab-sep";
  sep.textContent = "|";
  nav.appendChild(sep);

  sets.forEach((s) => {
    const btn = document.createElement("button");
    btn.className = "period-btn";
    btn.dataset.period = `set_${s}`;
    btn.textContent = `Set ${s}`;
    nav.appendChild(btn);
  });
}

// ── Player Cards ─────────────────────────────────────────────────────────────

function renderPlayerCards(stats, period) {
  // time-based tabs → 'all' card data / set tabs → 'set_N' card data
  const cardKey = period.startsWith("set_") ? period : "all";
  const cards = stats.player_cards?.[cardKey] || {};
  const container = document.getElementById("player-cards");

  if (!Object.keys(cards).length) {
    container.innerHTML = '<p class="no-data">데이터를 불러오는 중입니다.</p>';
    return;
  }

  container.innerHTML = Object.entries(cards).map(([name, c]) => {
    const tier = TIER_INFO[c.tier] || TIER_INFO.UNRANKED;
    const rankStr = NO_RANK_TIERS.has(c.tier)
      ? `${tier.label} ${c.lp}LP`
      : c.tier === "UNRANKED"
      ? tier.label
      : `${tier.label} ${c.rank} ${c.lp}LP`;

    const forms = (c.recent_placements || []).map((p) => {
      const cls = p === 1 ? "form-1" : p <= 4 ? "form-top4" : "form-bot";
      return `<span class="form-badge ${cls}">${p}</span>`;
    }).join("");

    return `
      <div class="player-card" style="--tier-color: ${tier.color}">
        <div class="card-header">
          <span class="card-name">${name}</span>
          <span class="card-tier" style="color: ${tier.color}">${rankStr}</span>
        </div>
        <div class="card-stats">
          <div class="stat-block">
            <div class="stat-value">${c.avg_placement || "—"}위</div>
            <div class="stat-label">평균 순위</div>
          </div>
          <div class="stat-block">
            <div class="stat-value gold">${c.top1_count}회</div>
            <div class="stat-label">1등</div>
          </div>
          <div class="stat-block">
            <div class="stat-value ${c.top4_rate >= 50 ? "positive" : ""}">${c.top4_rate}%</div>
            <div class="stat-label">탑4율</div>
          </div>
          <div class="stat-block">
            <div class="stat-value">${c.total_games}</div>
            <div class="stat-label">게임 수</div>
          </div>
        </div>
        <div class="card-recent">
          <span class="recent-label">최근 ${(c.recent_placements || []).length}게임</span>
          <div class="recent-forms">${forms}</div>
        </div>
      </div>`;
  }).join("");
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

function computeLeaderboard(stats, period) {
  return stats.players
    .map((player) => {
      let totalScore = 0, totalWins = 0, totalLosses = 0, totalDraws = 0, totalGames = 0;
      stats.players.forEach((opp) => {
        if (opp === player) return;
        const h2h = stats[period]?.[player]?.[opp];
        if (!h2h) return;
        totalScore += h2h.score;
        totalWins += h2h.wins;
        totalLosses += h2h.losses;
        totalDraws += h2h.draws;
        totalGames += h2h.shared_games;
      });
      return { player, totalScore, totalWins, totalLosses, totalDraws, totalGames };
    })
    .sort((a, b) => b.totalScore - a.totalScore || b.totalWins - a.totalWins);
}

function renderLeaderboard(stats, period) {
  const rows = computeLeaderboard(stats, period);
  const container = document.getElementById("leaderboard");
  if (rows.every((r) => r.totalGames === 0)) {
    container.innerHTML = '<p class="no-data">이 기간에 함께 플레이한 기록이 없습니다.</p>';
    return;
  }
  container.innerHTML = rows.map((r, i) => `
    <div class="leaderboard-row rank-${i + 1}">
      <span class="rank">${i + 1}</span>
      <span class="player-name">${r.player}</span>
      <span class="record">${r.totalWins}승 ${r.totalLosses}패${r.totalDraws > 0 ? ` ${r.totalDraws}무` : ""}</span>
      <span class="games">(${r.totalGames}게임)</span>
      <span class="score ${r.totalScore > 0 ? "positive" : r.totalScore < 0 ? "negative" : ""}">
        ${r.totalScore > 0 ? "+" : ""}${r.totalScore}점
      </span>
    </div>`).join("");
}

// ── H2H Matrix ────────────────────────────────────────────────────────────────

function renderH2HMatrix(stats, period) {
  const players = stats.players;
  const container = document.getElementById("h2h-matrix");
  let html = '<div class="matrix-scroll"><table class="h2h-table"><thead><tr><th class="corner-cell"></th>';
  players.forEach((p) => { html += `<th class="col-header">${p}</th>`; });
  html += "</tr></thead><tbody>";
  players.forEach((p1) => {
    html += `<tr><th class="row-header">${p1}</th>`;
    players.forEach((p2) => {
      if (p1 === p2) {
        html += '<td class="self-cell">—</td>';
      } else {
        const h2h = stats[period]?.[p1]?.[p2] ?? { wins: 0, losses: 0, draws: 0, score: 0, shared_games: 0 };
        const cls = h2h.score > 0 ? "win" : h2h.score < 0 ? "loss" : "neutral";
        const sign = h2h.score > 0 ? "+" : "";
        const draws = h2h.draws > 0 ? ` ${h2h.draws}무` : "";
        html += `
          <td class="h2h-cell ${cls}" title="${h2h.wins}승 ${h2h.losses}패${draws} (${h2h.shared_games}경기)">
            <span class="h2h-score">${sign}${h2h.score}</span>
            <span class="h2h-record">${h2h.wins}W ${h2h.losses}L</span>
          </td>`;
      }
    });
    html += "</tr>";
  });
  html += "</tbody></table></div>";
  container.innerHTML = html;
}

// ── Recent Shared Matches ─────────────────────────────────────────────────────

function placeBadgeClass(p) {
  if (p === 1) return "place-1";
  if (p <= 4)  return "place-top4";
  return "place-bot";
}

function renderRecentGames(stats, period) {
  let matches = stats.recent_shared_matches || [];

  // 세트 탭 선택 시 해당 세트 경기만 표시
  if (period.startsWith("set_")) {
    const setNum = parseInt(period.replace("set_", ""), 10);
    matches = matches.filter((m) => m.set_number === setNum);
  }

  const container = document.getElementById("recent-games");
  if (!matches.length) {
    container.innerHTML = '<p class="no-data">공동 경기 기록이 없습니다.</p>';
    return;
  }

  container.innerHTML = matches.map((match) => {
    const rows = match.results.map((r) => `
      <tr>
        <td><span class="place-badge ${placeBadgeClass(r.placement)}">${r.placement}위</span></td>
        <td class="match-player-name">${r.name}</td>
        <td class="match-round">라운드 ${r.last_round}</td>
        <td class="match-time">${formatDuration(r.time_eliminated)}</td>
      </tr>`).join("");

    return `
      <div class="match-card">
        <div class="match-header">
          <span class="match-date">${formatDate(match.game_datetime)}</span>
          <span class="match-set">Set ${match.set_number}</span>
        </div>
        <table class="match-table">
          <thead><tr><th>순위</th><th>소환사</th><th>라운드</th><th>플레이타임</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join("");
}

// ── Init ──────────────────────────────────────────────────────────────────────

function renderAll(stats, period) {
  renderPlayerCards(stats, period);
  renderLeaderboard(stats, period);
  renderH2HMatrix(stats, period);
  renderRecentGames(stats, period);
}

async function init() {
  try {
    const stats = await fetch("data/stats.json").then((r) => r.json());

    if (stats.last_updated) {
      document.getElementById("last-updated").textContent =
        "최종 업데이트: " + new Date(stats.last_updated).toLocaleString("ko-KR");
    }

    buildSetTabs(stats);

    let currentPeriod = "today";
    renderAll(stats, currentPeriod);

    document.querySelector(".period-tabs").addEventListener("click", (e) => {
      const btn = e.target.closest(".period-btn");
      if (!btn) return;
      document.querySelectorAll(".period-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentPeriod = btn.dataset.period;
      renderAll(stats, currentPeriod);
    });
  } catch (err) {
    const el = document.getElementById("error-banner");
    el.textContent = "데이터를 불러올 수 없습니다. GitHub Actions가 아직 실행되지 않았거나 players.json 설정이 필요합니다.";
    el.classList.remove("hidden");
    console.error(err);
  }
}

document.addEventListener("DOMContentLoaded", init);
