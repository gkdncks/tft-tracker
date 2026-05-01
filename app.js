// app.js

async function loadData() {
  const [playersData, statsData] = await Promise.all([
    fetch("data/players.json").then((r) => r.json()),
    fetch("data/stats.json").then((r) => r.json()),
  ]);
  return { players: playersData.players, stats: statsData };
}

// Build sorted leaderboard for a given period
function computeLeaderboard(stats, period) {
  return stats.players
    .map((player) => {
      let totalScore = 0,
        totalWins = 0,
        totalLosses = 0,
        totalDraws = 0,
        totalGames = 0;
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

  container.innerHTML = rows
    .map(
      (r, i) => `
      <div class="leaderboard-row rank-${i + 1}">
        <span class="rank">${i + 1}</span>
        <span class="player-name">${r.player}</span>
        <span class="record">${r.totalWins}승 ${r.totalLosses}패${r.totalDraws > 0 ? ` ${r.totalDraws}무` : ""}</span>
        <span class="games">(${r.totalGames}게임)</span>
        <span class="score ${r.totalScore > 0 ? "positive" : r.totalScore < 0 ? "negative" : ""}">
          ${r.totalScore > 0 ? "+" : ""}${r.totalScore}점
        </span>
      </div>`
    )
    .join("");
}

function renderH2HMatrix(stats, period) {
  const players = stats.players;
  const container = document.getElementById("h2h-matrix");

  let html = '<div class="matrix-scroll"><table class="h2h-table"><thead><tr><th class="corner-cell"></th>';
  players.forEach((p) => {
    html += `<th class="col-header">${p}</th>`;
  });
  html += "</tr></thead><tbody>";

  players.forEach((p1) => {
    html += `<tr><th class="row-header">${p1}</th>`;
    players.forEach((p2) => {
      if (p1 === p2) {
        html += '<td class="self-cell">—</td>';
      } else {
        const h2h = stats[period]?.[p1]?.[p2] ?? {
          wins: 0,
          losses: 0,
          draws: 0,
          score: 0,
          shared_games: 0,
        };
        const cls = h2h.score > 0 ? "win" : h2h.score < 0 ? "loss" : "neutral";
        const sign = h2h.score > 0 ? "+" : "";
        const draws = h2h.draws > 0 ? ` ${h2h.draws}무` : "";
        const tooltip = `${h2h.wins}승 ${h2h.losses}패${draws} (${h2h.shared_games}경기)`;
        html += `
          <td class="h2h-cell ${cls}" title="${tooltip}">
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

// Show the most recent games that had 2+ tracked players
function renderRecentGames(stats, period) {
  // Recent games data isn't in stats.json yet — placeholder for future
  const container = document.getElementById("recent-games");
  container.innerHTML = '<p class="no-data">최근 경기 상세 기록은 준비 중입니다.</p>';
}

function renderAll(stats, period) {
  renderLeaderboard(stats, period);
  renderH2HMatrix(stats, period);
  renderRecentGames(stats, period);
}

async function init() {
  try {
    const { stats } = await loadData();

    if (stats.last_updated) {
      document.getElementById("last-updated").textContent =
        "최종 업데이트: " + new Date(stats.last_updated).toLocaleString("ko-KR");
    }

    let currentPeriod = "today";
    renderAll(stats, currentPeriod);

    document.querySelectorAll(".period-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".period-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        currentPeriod = btn.dataset.period;
        renderAll(stats, currentPeriod);
      });
    });
  } catch (err) {
    const el = document.getElementById("error-banner");
    el.textContent =
      "데이터를 불러올 수 없습니다. GitHub Actions가 아직 실행되지 않았거나 players.json 설정이 필요합니다.";
    el.classList.remove("hidden");
    console.error(err);
  }
}

document.addEventListener("DOMContentLoaded", init);
