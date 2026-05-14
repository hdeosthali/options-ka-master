"""Backend tests for Options Master API"""
import os
import uuid
import time
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

# Load frontend .env for EXPO_PUBLIC_BACKEND_URL
load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

# Use a unique username for full isolation per test run
TEST_USER = f"test_{uuid.uuid4().hex[:8]}"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    yield s
    s.close()


# ---------------- Health ----------------
def test_health_root(client):
    r = client.get(f"{API}/")
    assert r.status_code == 200
    j = r.json()
    assert j.get("status") == "ok"


# ---------------- Auth ----------------
def test_auth_login_creates_user(client):
    r = client.post(f"{API}/auth/login", json={"username": TEST_USER})
    assert r.status_code == 200, r.text
    u = r.json()
    assert u["username"] == TEST_USER
    assert u["capital"] == 100000.0
    assert u["level"] == 1
    assert u["is_pro"] is False
    assert u["xp"] == 0


def test_auth_login_rohit_idempotent(client):
    # ensure rohit exists; spec says capital=100000, level=1 on first creation
    r = client.post(f"{API}/auth/login", json={"username": "rohit"})
    assert r.status_code == 200
    u = r.json()
    assert u["username"] == "rohit"
    # capital and level should be present (>=100000 even if used before)
    assert "capital" in u and "level" in u


# ---------------- Market ----------------
def test_market_snapshot(client):
    r = client.get(f"{API}/market/snapshot")
    assert r.status_code == 200
    j = r.json()
    for sym in ["NIFTY", "BANKNIFTY", "FINNIFTY"]:
        assert sym in j, f"missing {sym}"
        s = j[sym]
        for k in ["spot", "change_pct", "iv", "regime"]:
            assert k in s, f"missing field {k} in {sym}"
        assert s["regime"] in ("BULLISH", "BEARISH", "VOLATILE", "RANGE_BOUND")
        assert s["spot"] > 0


def test_option_chain_nifty(client):
    r = client.get(f"{API}/market/option-chain/NIFTY")
    assert r.status_code == 200
    j = r.json()
    assert "snapshot" in j and "atm" in j and "rows" in j
    rows = j["rows"]
    assert len(rows) == 11
    atm = j["atm"]
    strikes = [row["strike"] for row in rows]
    assert atm in strikes
    for row in rows:
        assert "strike" in row
        assert "ce" in row and "ltp" in row["ce"]
        assert "pe" in row and "ltp" in row["pe"]


def test_option_chain_invalid_symbol(client):
    r = client.get(f"{API}/market/option-chain/INVALID")
    assert r.status_code == 404


# ---------------- Strategies ----------------
def test_list_strategies(client):
    r = client.get(f"{API}/strategies")
    assert r.status_code == 200
    arr = r.json()
    assert isinstance(arr, list)
    ids = {s["id"] for s in arr}
    expected = {"iron_condor", "short_strangle", "bull_put_spread", "covered_call", "long_straddle"}
    assert expected.issubset(ids), f"missing strategies: {expected - ids}"
    assert len(arr) == 5


def test_recommended_strategy(client):
    r = client.get(f"{API}/strategies/recommended", params={"symbol": "NIFTY"})
    assert r.status_code == 200
    j = r.json()
    assert "snapshot" in j and "strategy" in j
    assert j["strategy"]["id"] in {"iron_condor", "short_strangle", "bull_put_spread", "covered_call", "long_straddle"}


# ---------------- Advisor ----------------
def test_advisor(client):
    r = client.post(f"{API}/advisor", json={"username": TEST_USER, "symbol": "NIFTY"}, timeout=60)
    assert r.status_code == 200, r.text
    j = r.json()
    assert "explanation" in j and isinstance(j["explanation"], str) and len(j["explanation"]) > 10
    assert "strategy" in j and "snapshot" in j


# ---------------- Trades ----------------
@pytest.fixture(scope="module")
def applied_trade_id(client):
    # ensure user exists
    client.post(f"{API}/auth/login", json={"username": TEST_USER})
    r = client.post(
        f"{API}/trades/apply",
        json={"username": TEST_USER, "strategy_id": "iron_condor", "symbol": "NIFTY", "lots": 1},
    )
    assert r.status_code == 200, r.text
    t = r.json()
    assert t["status"] == "OPEN"
    assert t["strategy_id"] == "iron_condor"
    assert len(t["legs"]) == 4
    return t["id"]


def test_apply_increments_xp(client, applied_trade_id):
    r = client.get(f"{API}/user/{TEST_USER}")
    assert r.status_code == 200
    u = r.json()
    assert u["xp"] >= 20, f"xp should be >=20, got {u['xp']}"


def test_list_trades_has_unrealized(client, applied_trade_id):
    r = client.get(f"{API}/trades/{TEST_USER}")
    assert r.status_code == 200
    arr = r.json()
    assert len(arr) >= 1
    open_t = [t for t in arr if t["id"] == applied_trade_id][0]
    assert "unrealized_pnl" in open_t
    assert open_t["status"] == "OPEN"


def test_portfolio(client, applied_trade_id):
    r = client.get(f"{API}/portfolio/{TEST_USER}")
    assert r.status_code == 200
    j = r.json()
    for k in ["capital", "unrealized_pnl", "realized_pnl", "open_count", "closed_count", "win_rate"]:
        assert k in j
    assert j["open_count"] >= 1


def test_close_trade(client, applied_trade_id):
    cap_before = client.get(f"{API}/user/{TEST_USER}").json()["capital"]
    r = client.post(
        f"{API}/trades/close",
        json={"username": TEST_USER, "trade_id": applied_trade_id},
    )
    assert r.status_code == 200, r.text
    t = r.json()
    assert t["status"] == "CLOSED"
    assert "realized_pnl" in t
    # verify capital updated
    u = client.get(f"{API}/user/{TEST_USER}").json()
    assert round(u["capital"], 2) == round(cap_before + t["realized_pnl"], 2)


# ---------------- Daily reward ----------------
def test_daily_reward_first_then_second(client):
    uname = f"reward_{uuid.uuid4().hex[:6]}"
    client.post(f"{API}/auth/login", json={"username": uname})
    r1 = client.post(f"{API}/user/{uname}/daily-reward")
    assert r1.status_code == 200
    j1 = r1.json()
    assert j1["claimed"] is True
    assert j1["user"]["xp"] >= 50

    r2 = client.post(f"{API}/user/{uname}/daily-reward")
    assert r2.status_code == 200
    j2 = r2.json()
    assert j2["claimed"] is False


# ---------------- Upgrade Pro ----------------
def test_upgrade_pro(client):
    uname = f"pro_{uuid.uuid4().hex[:6]}"
    client.post(f"{API}/auth/login", json={"username": uname})
    r = client.post(f"{API}/user/{uname}/upgrade")
    assert r.status_code == 200
    u = r.json()
    assert u["is_pro"] is True
    assert u["capital"] >= 1000000
    assert u["pro_days_left"] == 30
