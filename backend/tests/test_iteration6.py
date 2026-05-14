"""Iteration 6 tests: Marketplace publish/install + Live Positions WebSocket + regression."""
import os
import asyncio
import json
import uuid
import pytest
import requests
import websockets

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://trader-simulator-7.preview.emergentagent.com",
).rstrip("/")
LOCAL_WS = "ws://localhost:8001"  # for WebSocket testing (ingress may not proxy ws)

CREATOR = f"itr6c{uuid.uuid4().hex[:6]}"
BUYER = f"itr6b{uuid.uuid4().hex[:6]}"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    # provision both users
    for u in (CREATOR, BUYER):
        r = sess.post(f"{BASE_URL}/api/auth/login", json={"username": u})
        assert r.status_code == 200, r.text
    return sess


@pytest.fixture(scope="module")
def custom_strategy_id(s):
    """Create a custom strategy owned by CREATOR and return its id."""
    payload = {
        "username": CREATOR,
        "name": "TEST_MarketStrat",
        "tagline": "shared via marketplace",
        "description": "Iteration 6 marketplace publish/install test",
        "legs": [
            {"action": "BUY", "type": "CE", "offset": 0},
            {"action": "SELL", "type": "CE", "offset": 2},
        ],
    }
    r = s.post(f"{BASE_URL}/api/strategies/custom", json=payload)
    assert r.status_code == 200, r.text
    return r.json()["id"]


# ---------------- Marketplace ----------------
class TestMarketplace:
    def test_publish_non_owned_returns_404(self, s, custom_strategy_id):
        # BUYER attempts to publish CREATOR's strategy → 404
        r = s.post(
            f"{BASE_URL}/api/marketplace/publish",
            json={"username": BUYER, "strategy_id": custom_strategy_id},
        )
        assert r.status_code == 404, r.text

    def test_publish_flips_is_public(self, s, custom_strategy_id):
        r = s.post(
            f"{BASE_URL}/api/marketplace/publish",
            json={"username": CREATOR, "strategy_id": custom_strategy_id},
        )
        assert r.status_code == 200, r.text
        assert r.json().get("published") is True

    def test_listing_excludes_private_includes_public(self, s, custom_strategy_id):
        r = s.get(f"{BASE_URL}/api/marketplace")
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        ids = [it["id"] for it in items]
        assert custom_strategy_id in ids, f"published strat not visible. ids={ids[:10]}"
        # find item and verify shape
        item = next(it for it in items if it["id"] == custom_strategy_id)
        assert item["creator"] == CREATOR
        assert "legs" in item and len(item["legs"]) == 2
        assert "installs" in item
        # no private fields leak
        assert "username" not in item

    def test_install_own_strategy_returns_400(self, s, custom_strategy_id):
        r = s.post(
            f"{BASE_URL}/api/marketplace/install",
            json={"username": CREATOR, "strategy_id": custom_strategy_id},
        )
        assert r.status_code == 400, r.text

    def test_install_clones_into_buyer_library(self, s, custom_strategy_id):
        # listing before install (to read install count)
        before = s.get(f"{BASE_URL}/api/marketplace").json()
        before_count = next(
            it for it in before if it["id"] == custom_strategy_id
        )["installs"]

        r = s.post(
            f"{BASE_URL}/api/marketplace/install",
            json={"username": BUYER, "strategy_id": custom_strategy_id},
        )
        assert r.status_code == 200, r.text
        cloned = r.json()
        assert cloned["id"].startswith("custom_")
        assert cloned["id"] != custom_strategy_id
        assert cloned["username"] == BUYER
        assert cloned.get("installed_from") == custom_strategy_id
        assert cloned.get("is_custom") is True
        pytest.cloned_id = cloned["id"]

        # source counter incremented
        after = s.get(f"{BASE_URL}/api/marketplace").json()
        after_count = next(
            it for it in after if it["id"] == custom_strategy_id
        )["installs"]
        assert after_count == before_count + 1

    def test_buyer_sees_clone_in_custom_list(self, s):
        r = s.get(f"{BASE_URL}/api/strategies/custom/{BUYER}")
        assert r.status_code == 200
        ids = [it["id"] for it in r.json()]
        assert pytest.cloned_id in ids

    def test_buyer_can_apply_cloned(self, s):
        # apply the cloned strategy via /api/trades/apply
        payload = {
            "username": BUYER,
            "symbol": "NIFTY",
            "strategy_id": pytest.cloned_id,
            "lots": 1,
        }
        r = s.post(f"{BASE_URL}/api/trades/apply", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        # trade applied should reference cloned strategy
        assert "id" in d or "trade_id" in d or "status" in d

    def test_unpublish_reverts_public(self, s, custom_strategy_id):
        r = s.post(
            f"{BASE_URL}/api/marketplace/unpublish",
            json={"username": CREATOR, "strategy_id": custom_strategy_id},
        )
        assert r.status_code == 200, r.text
        # ensure it no longer appears in listing
        items = s.get(f"{BASE_URL}/api/marketplace").json()
        ids = [it["id"] for it in items]
        assert custom_strategy_id not in ids

    def test_unpublish_non_owned_404(self, s, custom_strategy_id):
        r = s.post(
            f"{BASE_URL}/api/marketplace/unpublish",
            json={"username": BUYER, "strategy_id": custom_strategy_id},
        )
        assert r.status_code == 404


# ---------------- Live Positions WebSocket ----------------
class TestPositionsWS:
    def test_ws_zero_trades(self):
        async def run():
            uri = f"{LOCAL_WS}/api/ws/positions/{CREATOR}"
            async with websockets.connect(uri, open_timeout=5) as ws:
                msg = await asyncio.wait_for(ws.recv(), timeout=5)
                data = json.loads(msg)
                assert data["type"] == "positions"
                # creator has no open trades
                assert data["open_count"] == 0
                assert data["total_unrealized_pnl"] == 0
                assert data["positions"] == []

        asyncio.run(run())

    def test_ws_with_open_trades(self):
        # BUYER applied a trade in TestMarketplace.test_buyer_can_apply_cloned
        async def run():
            uri = f"{LOCAL_WS}/api/ws/positions/{BUYER}"
            async with websockets.connect(uri, open_timeout=5) as ws:
                msg = await asyncio.wait_for(ws.recv(), timeout=5)
                data = json.loads(msg)
                assert data["type"] == "positions"
                assert data["open_count"] >= 1
                pos = data["positions"][0]
                assert "unrealized_pnl" in pos
                assert "symbol" in pos
                assert "strategy_name" in pos

        asyncio.run(run())

    def test_ws_streams_every_2s(self):
        async def run():
            uri = f"{LOCAL_WS}/api/ws/positions/{CREATOR}"
            async with websockets.connect(uri, open_timeout=5) as ws:
                m1 = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
                m2 = json.loads(await asyncio.wait_for(ws.recv(), timeout=6))
                assert m1["type"] == "positions"
                assert m2["type"] == "positions"
                # both timestamped
                assert m1["ts"] != m2["ts"]

        asyncio.run(run())


# ---------------- Regression (iter1-5 endpoints) ----------------
class TestRegression:
    def test_auth_login(self, s):
        r = s.post(f"{BASE_URL}/api/auth/login", json={"username": CREATOR})
        assert r.status_code == 200
        assert "username" in r.json() or "user" in r.json() or "id" in r.json()

    def test_market_snapshot(self, s):
        r = s.get(f"{BASE_URL}/api/market/snapshot")
        assert r.status_code == 200

    def test_option_chain(self, s):
        r = s.get(f"{BASE_URL}/api/market/option-chain/NIFTY")
        assert r.status_code == 200

    def test_builtin_strategies(self, s):
        r = s.get(f"{BASE_URL}/api/strategies")
        assert r.status_code == 200
        assert len(r.json()) >= 5

    def test_advisor(self, s):
        r = s.post(
            f"{BASE_URL}/api/advisor",
            json={"username": CREATOR, "symbol": "NIFTY"},
        )
        assert r.status_code == 200

    def test_portfolio(self, s):
        r = s.get(f"{BASE_URL}/api/portfolio/{BUYER}")
        assert r.status_code == 200
        body = r.json()
        assert "open_count" in body or "trades" in body or "unrealized_pnl" in body

    def test_greeks_builtin(self, s):
        r = s.post(
            f"{BASE_URL}/api/greeks",
            json={"username": CREATOR, "symbol": "NIFTY", "strategy_id": "iron_condor", "lots": 1},
        )
        assert r.status_code == 200

    def test_payoff_builtin(self, s):
        r = s.post(
            f"{BASE_URL}/api/payoff",
            json={"username": CREATOR, "symbol": "NIFTY", "strategy_id": "iron_condor", "lots": 1},
        )
        assert r.status_code == 200

    def test_backtest_v1(self, s):
        r = s.post(
            f"{BASE_URL}/api/backtest",
            json={"username": CREATOR, "symbol": "NIFTY", "strategy_id": "iron_condor", "lots": 1, "days": 30},
        )
        assert r.status_code == 200

    def test_notifications(self, s):
        r = s.get(f"{BASE_URL}/api/notifications/{CREATOR}")
        assert r.status_code == 200

    def test_historical(self, s):
        r = s.get(f"{BASE_URL}/api/historical/NIFTY?days=10")
        assert r.status_code == 200
