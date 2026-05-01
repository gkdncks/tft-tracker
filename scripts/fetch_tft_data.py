import os
import json
import requests
import time
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

API_KEY = os.environ.get("RIOT_API_KEY", "")
if not API_KEY:
    raise ValueError("RIOT_API_KEY environment variable not set")

HEADERS = {"X-Riot-Token": API_KEY}
ASIA_BASE = "https://asia.api.riotgames.com"
KR_BASE = "https://kr.api.riotgames.com"

DATA_DIR = Path(__file__).parent.parent / "data"
MATCH_RETENTION_DAYS = 90
REQUEST_DELAY = 1.5


def api_get(url, params=None):
    for attempt in range(3):
        resp = requests.get(url, headers=HEADERS, params=params, timeout=10)
        if resp.status_code == 429:
            wait = int(resp.headers.get("Retry-After", 10))
            log.warning(f"Rate limited. Waiting {wait}s...")
            time.sleep(wait)
            continue
        if not resp.ok:
            log.error(f"HTTP {resp.status_code} for {url} | body: {resp.text}")
            resp.raise_for_status()
        return resp.json()
    raise RuntimeError(f"Failed after 3 attempts: {url}")


def get_puuid(game_name: str, tag_line: str) -> str:
    url = f"{ASIA_BASE}/riot/account/v1/accounts/by-riot-id/{game_name}/{tag_line}"
    return api_get(url)["puuid"]


def resolve_player(riot_id: str) -> tuple:
    """Returns (puuid, summoner_id)"""
    game_name, tag = riot_id.split("#", 1)
    puuid = get_puuid(game_name, tag)
    log.info(f"  Account PUUID: {puuid}")
    time.sleep(REQUEST_DELAY)
    summoner = api_get(f"{KR_BASE}/tft/summoner/v1/summoners/by-puuid/{quote(puuid, safe='')}")
    log.info(f"  Summoner API fields: {list(summoner.keys())}")
    summoner_id = summoner.get("id", "")
    log.info(f"  lv.{summoner.get('summonerLevel', '?')}, summoner_id: {'OK' if summoner_id else 'MISSING'}")
    return summoner["puuid"], summoner_id


def get_league_entry(puuid: str) -> dict:
    entries = api_get(f"{KR_BASE}/tft/league/v1/by-puuid/{quote(puuid, safe='')}")
    for e in entries:
        if e.get("queueType") == "RANKED_TFT":
            return e
    return {}


def get_match_ids(puuid: str, count: int = 30) -> list:
    url = f"{ASIA_BASE}/tft/match/v1/matches/by-puuid/{quote(puuid, safe='')}/ids"
    return api_get(url, params={"count": count})


def get_match(match_id: str) -> dict:
    return api_get(f"{ASIA_BASE}/tft/match/v1/matches/{match_id}")


def load_json(filename: str) -> dict:
    path = DATA_DIR / filename
    if path.exists():
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_json(filename: str, data):
    DATA_DIR.mkdir(exist_ok=True)
    path = DATA_DIR / filename
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    log.info(f"Saved {path}")


def prune_matches(matches: dict) -> dict:
    cutoff_ms = (
        datetime.now(timezone.utc) - timedelta(days=MATCH_RETENTION_DAYS)
    ).timestamp() * 1000
    pruned = {
        mid: m for mid, m in matches.items()
        if m.get("info", {}).get("game_datetime", 0) >= cutoff_ms
    }
    removed = len(matches) - len(pruned)
    if removed:
        log.info(f"Pruned {removed} old matches")
    return pruned


def compute_player_cards(matches: dict, players: list, set_filter: int = None) -> dict:
    all_puuids = {p["puuid"] for p in players if "puuid" in p}
    cards = {}
    for player in players:
        if "puuid" not in player:
            continue
        puuid = player["puuid"]
        ranked, shared, shared_ranked = [], [], []
        for match in matches.values():
            info = match.get("info", {})
            if set_filter is not None and info.get("tft_set_number") != set_filter:
                continue
            is_ranked = info.get("queue_id") == 1100
            participants_puuids = {p.get("puuid") for p in info.get("participants", [])}
            is_shared = len(all_puuids & participants_puuids) >= 2
            for p in info.get("participants", []):
                if p.get("puuid") == puuid:
                    entry = (info.get("game_datetime", 0), p["placement"])
                    if is_ranked:
                        ranked.append(entry)
                    if is_shared:
                        shared.append(entry)
                    if is_ranked and is_shared:
                        shared_ranked.append(entry)
                    break
        for lst in (ranked, shared, shared_ranked):
            lst.sort(reverse=True)
        r_p  = [p for _, p in ranked]
        sh_p = [p for _, p in shared]
        sr_p = [p for _, p in shared_ranked]

        def stats(pl):
            return {
                "total_games": len(pl),
                "avg_placement": round(sum(pl) / len(pl), 2) if pl else 0,
                "top1_count": sum(1 for p in pl if p == 1),
                "top4_rate": round(sum(1 for p in pl if p <= 4) / len(pl) * 100, 1) if pl else 0,
            }

        cards[player["name"]] = {
            "tier": player.get("tier", "UNRANKED"),
            "rank": player.get("rank", ""),
            "lp": player.get("lp", 0),
            **stats(r_p),
            "recent_placements": r_p[:10],
            "shared": stats(sh_p),
            "shared_recent_placements": sh_p[:10],
            "shared_ranked": stats(sr_p),
            "shared_ranked_recent_placements": sr_p[:10],
        }
    return cards


def compute_recent_shared_matches(matches: dict, players: list, limit: int = 30) -> list:
    puuid_map = {p["puuid"]: p["name"] for p in players if "puuid" in p}
    tracked = set(puuid_map.keys())

    shared = []
    for match in matches.values():
        info = match.get("info", {})
        results = []
        for p in info.get("participants", []):
            if p.get("puuid") not in tracked:
                continue
            results.append({
                "name": puuid_map[p["puuid"]],
                "placement": p.get("placement", 0),
                "last_round": p.get("last_round", 0),
                "time_eliminated": round(p.get("time_eliminated", 0)),
            })
        if len(results) >= 2:
            results.sort(key=lambda x: x["placement"])
            shared.append({
                "game_datetime": info.get("game_datetime", 0),
                "set_number": info.get("tft_set_number", 0),
                "results": results,
            })

    shared.sort(key=lambda x: -x["game_datetime"])
    return shared[:limit]


def compute_stats(matches: dict, players: list) -> dict:
    """
    Head-to-head scoring: score = (opponent_placement - my_placement) per shared game.
    Positive total = I outperformed the opponent overall.
    1st vs 8th = +7, 3rd vs 4th = +1 (margin matters).
    Periods: today/week/all (all seasons) + set_N_today/set_N_week/set_N_all (per season).
    """
    puuid_map = {p["puuid"]: p["name"] for p in players if "puuid" in p}
    tracked = set(puuid_map.keys())
    player_names = [p["name"] for p in players if "puuid" in p]

    now = datetime.now(timezone.utc)

    available_sets = sorted(set(
        m.get("info", {}).get("tft_set_number", 0)
        for m in matches.values()
        if m.get("info", {}).get("tft_set_number", 0) > 0
    ), reverse=True)

    # (time_cutoff, set_filter): both can apply simultaneously
    time_cutoffs = {
        "today": now - timedelta(days=1),
        "week":  now - timedelta(days=7),
        "all":   None,
    }
    periods = {}
    for tp, cutoff in time_cutoffs.items():
        periods[tp] = (cutoff, None)
    for s in available_sets:
        for tp, cutoff in time_cutoffs.items():
            periods[f"set_{s}_{tp}"] = (cutoff, s)

    def empty_h2h():
        return {"wins": 0, "losses": 0, "draws": 0, "score": 0, "shared_games": 0}

    def init_period():
        return {p1: {p2: empty_h2h() for p2 in player_names if p2 != p1} for p1 in player_names}

    period_data = {p: init_period() for p in periods}

    for match in matches.values():
        info = match.get("info", {})
        game_dt = datetime.fromtimestamp(info.get("game_datetime", 0) / 1000, tz=timezone.utc)
        set_num = info.get("tft_set_number", 0)
        in_game = {
            p["puuid"]: p["placement"]
            for p in info.get("participants", [])
            if p["puuid"] in tracked
        }
        if len(in_game) < 2:
            continue
        tracked_list = [(puuid_map[uid], place) for uid, place in in_game.items()]

        for period, (time_cutoff, set_filter) in periods.items():
            if time_cutoff and game_dt < time_cutoff:
                continue
            if set_filter is not None and set_num != set_filter:
                continue

            for i in range(len(tracked_list)):
                for j in range(i + 1, len(tracked_list)):
                    name_a, place_a = tracked_list[i]
                    name_b, place_b = tracked_list[j]
                    score = place_b - place_a

                    period_data[period][name_a][name_b]["shared_games"] += 1
                    period_data[period][name_b][name_a]["shared_games"] += 1
                    period_data[period][name_a][name_b]["score"] += score
                    period_data[period][name_b][name_a]["score"] -= score

                    if place_a < place_b:
                        period_data[period][name_a][name_b]["wins"] += 1
                        period_data[period][name_b][name_a]["losses"] += 1
                    elif place_b < place_a:
                        period_data[period][name_b][name_a]["wins"] += 1
                        period_data[period][name_a][name_b]["losses"] += 1
                    else:
                        period_data[period][name_a][name_b]["draws"] += 1
                        period_data[period][name_b][name_a]["draws"] += 1

    # Player cards per set + overall
    player_cards = {"all": compute_player_cards(matches, players)}
    for s in available_sets:
        player_cards[f"set_{s}"] = compute_player_cards(matches, players, set_filter=s)

    return {
        "players": player_names,
        "last_updated": now.isoformat(),
        "available_sets": available_sets,
        "player_cards": player_cards,
        "recent_shared_matches": compute_recent_shared_matches(matches, players),
        **period_data,
    }


def main():
    players_data = load_json("players.json")
    players = players_data.get("players", [])
    if not players:
        log.error("No players in data/players.json")
        return

    # Resolve PUUID + summoner_id for new players
    players_updated = False
    for player in players:
        if not player.get("puuid") or not player.get("summoner_id"):
            log.info(f"Resolving {player['name']} ({player['riot_id']})...")
            player["puuid"], player["summoner_id"] = resolve_player(player["riot_id"])
            players_updated = True
            time.sleep(REQUEST_DELAY)

    # Fetch tier/rank for all players
    for player in players:
        if "puuid" not in player:
            continue
        log.info(f"Fetching rank for {player['name']}...")
        try:
            entry = get_league_entry(player["puuid"])
            player["tier"] = entry.get("tier", "UNRANKED")
            player["rank"] = entry.get("rank", "")
            player["lp"] = entry.get("leaguePoints", 0)
            players_updated = True
        except Exception as e:
            log.warning(f"  League data failed: {e}")
        time.sleep(REQUEST_DELAY)

    if players_updated:
        save_json("players.json", players_data)

    # Fetch new matches
    matches = load_json("matches.json")
    existing_ids = set(matches.keys())
    new_count = 0

    for player in players:
        if "puuid" not in player:
            continue
        log.info(f"Fetching matches for {player['name']}...")
        match_ids = get_match_ids(player["puuid"], count=30)
        log.info(f"  Got {len(match_ids)} IDs")
        time.sleep(REQUEST_DELAY)
        for match_id in match_ids:
            if match_id in existing_ids:
                continue
            log.info(f"  Downloading {match_id}...")
            matches[match_id] = get_match(match_id)
            existing_ids.add(match_id)
            new_count += 1
            time.sleep(REQUEST_DELAY)

    log.info(f"Downloaded {new_count} new matches")
    matches = prune_matches(matches)
    save_json("matches.json", matches)

    stats = compute_stats(matches, players)
    save_json("stats.json", stats)
    log.info("Done!")


if __name__ == "__main__":
    main()
