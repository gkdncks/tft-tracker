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
REQUEST_DELAY = 1.5  # seconds between API calls


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


def get_puuid_via_summoner(riot_id: str) -> str:
    """Account API 대신 TFT Summoner API를 통해 PUUID를 가져옴 (KR 플랫폼 호환)"""
    game_name, tag = riot_id.split("#", 1)
    # 1단계: Account API로 PUUID 조회
    puuid = get_puuid(game_name, tag)
    log.info(f"  Account API PUUID: {puuid}")
    time.sleep(REQUEST_DELAY)
    # 2단계: KR Summoner API로 PUUID 검증 및 플랫폼 호환 PUUID 취득
    encoded = quote(puuid, safe="")
    summoner = api_get(f"{KR_BASE}/tft/summoner/v1/summoners/by-puuid/{encoded}")
    platform_puuid = summoner["puuid"]
    log.info(f"  Summoner API PUUID: {platform_puuid}")
    log.info(f"  Summoner name: {summoner.get('name', '?')}, level: {summoner.get('summonerLevel', '?')}")
    return platform_puuid


def get_match_ids(puuid: str, count: int = 100) -> list:
    encoded = quote(puuid, safe="")
    url = f"{ASIA_BASE}/tft/match/v1/matches/by-puuid/{encoded}/ids"
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
        mid: m
        for mid, m in matches.items()
        if m.get("info", {}).get("game_datetime", 0) >= cutoff_ms
    }
    removed = len(matches) - len(pruned)
    if removed:
        log.info(f"Pruned {removed} matches older than {MATCH_RETENTION_DAYS} days")
    return pruned


def compute_stats(matches: dict, players: list) -> dict:
    """
    Head-to-head scoring: when A and B are in the same game,
    score = (B_placement - A_placement).
    Positive score means A outperformed B in that game.
    Cumulative score captures both win/loss and margin of victory.
    Example: A=1st B=8th → A scores +7; A=3rd B=4th → A scores +1.
    """
    puuid_map = {p["puuid"]: p["name"] for p in players if "puuid" in p}
    tracked = set(puuid_map.keys())
    player_names = [p["name"] for p in players if "puuid" in p]

    now = datetime.now(timezone.utc)
    periods = {
        "today": now - timedelta(days=1),
        "week": now - timedelta(days=7),
        "all": None,
    }

    def empty_h2h():
        return {"wins": 0, "losses": 0, "draws": 0, "score": 0, "shared_games": 0}

    def init_period():
        return {
            p1: {p2: empty_h2h() for p2 in player_names if p2 != p1}
            for p1 in player_names
        }

    period_data = {p: init_period() for p in periods}

    for match in matches.values():
        info = match.get("info", {})
        game_dt = datetime.fromtimestamp(
            info.get("game_datetime", 0) / 1000, tz=timezone.utc
        )
        in_game = {
            p["puuid"]: p["placement"]
            for p in info.get("participants", [])
            if p["puuid"] in tracked
        }
        if len(in_game) < 2:
            continue

        tracked_list = [(puuid_map[uid], place) for uid, place in in_game.items()]

        for period, cutoff in periods.items():
            if cutoff and game_dt < cutoff:
                continue
            for i in range(len(tracked_list)):
                for j in range(i + 1, len(tracked_list)):
                    name_a, place_a = tracked_list[i]
                    name_b, place_b = tracked_list[j]
                    score = place_b - place_a  # positive → A did better

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

    return {
        "players": player_names,
        "last_updated": now.isoformat(),
        **period_data,
    }


def main():
    players_data = load_json("players.json")
    players = players_data.get("players", [])

    if not players:
        log.error("No players in data/players.json")
        return

    # Resolve PUUIDs — always re-fetch to ensure KR-platform compatibility
    puuid_updated = False
    for player in players:
        if "puuid" not in player:
            parts = player["riot_id"].split("#", 1)
            if len(parts) != 2:
                log.error(f"Invalid riot_id format for {player['name']}: {player['riot_id']}")
                continue
            log.info(f"Resolving PUUID for {player['name']} ({player['riot_id']})...")
            player["puuid"] = get_puuid_via_summoner(player["riot_id"])
            puuid_updated = True
            time.sleep(REQUEST_DELAY)

    if puuid_updated:
        save_json("players.json", players_data)

    matches = load_json("matches.json")
    existing_ids = set(matches.keys())
    new_count = 0

    for player in players:
        if "puuid" not in player:
            continue
        log.info(f"Fetching match list for {player['name']}...")
        match_ids = get_match_ids(player["puuid"], count=100)
        log.info(f"  Got {len(match_ids)} match IDs")
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
