"""Iteration 4 tests: Custom Strategies + WebSocket live option chain + regression."""
import os
import asyncio
import json
import uuid
import pytest
import requests
import websockets

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://trader-simulator-7.preview.emergentagent.com").rstrip("/")
LOCAL = "http://localhost:8001"  # for WS test (ingress may not proxy ws)
UN = f"itr4{uuid.uuid4().hex[:6]}"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    # create test user
    r = sess.post(f"{BASE_URL}/api/auth/login", json={"username": UN})
    assert r.status_code == 200
    return sess


# ---------------- Custom strategies ----------------
class TestCustomStrategies:
    def test_create_custom_valid(self, s):
        payload = {"username": UN, "name": "TEST_MyStrat",
                   "legs": [{"action": "BUY", "type": "CE", "offset": 0},
                            {"action": "SELL", "type": "CE", "offset": 2}]}
        r = s.post(f"{BASE_URL}/api/strategies/custom", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["id"].startswith("custom_")
        assert d["is_custom"] is True
        assert len(d["legs"]) == 2
        pytest.custom_id = d["id"]

    def test_create_empty_legs_400(self, s):
        r = s.post(f"{BASE_URL}/api/strategies/custom",
                   json={"username": UN, "name": "x", "legs": []})
        assert r.status_code == 400

    def test_create_too_many_legs_400(self, s):
        legs = [{"action": "BUY", "type": "CE", "offset": i} for i in range(7)]
        r = s.post(f"{BASE_URL}/api/strategies/custom",
                   json={"username": UN, "name": "x", "legs": legs})
        assert r.status_code == 400

    def test_create_invalid_action_400(self, s):
        r = s.post(f"{BASE_URL}/api/strategies/custom",
                   json={"username": UN, "name": "x",
                         "legs": [{"action": "HOLD", "type": "CE", "offset": 0}]})
        assert r.status_code == 400

    def test_create_invalid_type_400(self, s):
        r = s.post(f"{BASE_URL}/api/strategies/custom",
                   json={"username": UN, "name": "x",
                         "legs": [{"action": "BUY", "type": "XX", "offset": 0}]})
        assert r.status_code == 400

    def test_list_custom_sorted_desc(self, s):
        # create a second so we can verify order
        s.post(f"{BASE_URL}/api/strategies/custom",
               json={"username": UN, "name": "TEST_Second",
                     "legs": [{"action": "BUY", "type": "PE", "offset": -1}]})
        r = s.get(f"{BASE_URL}/api/strategies/custom/{UN}")
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 2
        assert items[0]["created_at"] >= items[1]["created_at"]

    def test_greeks_with_custom(self, s):
        cid = pytest.custom_id
        r = s.post(f"{BASE_URL}/api/greeks",
                   json={"symbol": "NIFTY", "strategy_id": cid, "lots": 1, "username": UN})
        assert r.status_code == 200, r.text
        assert "net" in r.json() and "legs" in r.json()

    def test_greeks_custom_without_username_404(self, s):
        cid = pytest.custom_id
        r = s.post(f"{BASE_URL}/api/greeks",
                   json={"symbol": "NIFTY", "strategy_id": cid, "lots": 1})
        assert r.status_code == 404

    def test_payoff_with_custom(self, s):
        cid = pytest.custom_id
        r = s.post(f"{BASE_URL}/api/payoff",
                   json={"symbol": "NIFTY", "strategy_id": cid, "lots": 1, "username": UN})
        assert r.status_code == 200
        d = r.json()
        assert "points" in d and len(d["points"]) == 41

    def test_apply_custom_trade(self, s):
        cid = pytest.custom_id
        r = s.post(f"{BASE_URL}/api/trades/apply",
                   json={"username": UN, "strategy_id": cid, "symbol": "NIFTY", "lots": 1})
        assert r.status_code == 200, r.text
        assert r.json()["strategy_id"] == cid

    def test_delete_custom(self, s):
        cid = pytest.custom_id
        r = s.delete(f"{BASE_URL}/api/strategies/custom/{cid}?username={UN}")
        assert r.status_code == 200
        # verify gone
        r2 = s.delete(f"{BASE_URL}/api/strategies/custom/{cid}?username={UN}")
        assert r2.status_code == 404


# ---------------- WebSocket ----------------
class TestWebSocket:
    def test_ws_chain_nifty(self):
        async def go():
            uri = f"ws://localhost:8001/api/ws/chain/NIFTY"
            msgs = []
            async with websockets.connect(uri) as ws:
                for _ in range(2):
                    raw = await asyncio.wait_for(ws.recv(), timeout=5)
                    msgs.append(json.loads(raw))
            return msgs
        msgs = asyncio.get_event_loop().run_until_complete(go())
        assert len(msgs) == 2
        for m in msgs:
            assert m["type"] == "chain"
            assert "snapshot" in m["data"]
            assert "atm" in m["data"]
            assert len(m["data"]["rows"]) == 11

    def test_ws_invalid_symbol_closes(self):
        async def go():
            uri = f"ws://localhost:8001/api/ws/chain/INVALID"
            try:
                async with websockets.connect(uri) as ws:
                    await asyncio.wait_for(ws.recv(), timeout=3)
                return "open"
            except websockets.exceptions.InvalidStatus as e:
                return f"status:{e.response.status_code}"
            except websockets.exceptions.ConnectionClosed as e:
                return f"closed:{e.code}"
            except Exception as e:
                return f"err:{type(e).__name__}"
        res = asyncio.get_event_loop().run_until_complete(go())
        assert "4404" in res or "closed" in res or "status" in res, f"got {res}"


# ---------------- Regression (sample) ----------------
class TestRegression:
    def test_market_snapshot(self, s):
        r = s.get(f"{BASE_URL}/api/market/snapshot")
        assert r.status_code == 200
        assert "NIFTY" in r.json()

    def test_option_chain(self, s):
        r = s.get(f"{BASE_URL}/api/market/option-chain/NIFTY")
        assert r.status_code == 200
        assert len(r.json()["rows"]) == 11

    def test_strategies_list(self, s):
        r = s.get(f"{BASE_URL}/api/strategies")
        assert r.status_code == 200 and len(r.json()) >= 5

    def test_recommended(self, s):
        r = s.get(f"{BASE_URL}/api/strategies/recommended?symbol=NIFTY")
        assert r.status_code == 200

    def test_apply_builtin(self, s):
        r = s.post(f"{BASE_URL}/api/trades/apply",
                   json={"username": UN, "strategy_id": "iron_condor", "symbol": "NIFTY", "lots": 1})
        assert r.status_code == 200

    def test_portfolio(self, s):
        r = s.get(f"{BASE_URL}/api/portfolio/{UN}")
        assert r.status_code == 200

    def test_greeks_builtin(self, s):
        r = s.post(f"{BASE_URL}/api/greeks",
                   json={"symbol": "NIFTY", "strategy_id": "long_straddle", "lots": 1})
        assert r.status_code == 200

    def test_payoff_builtin(self, s):
        r = s.post(f"{BASE_URL}/api/payoff",
                   json={"symbol": "NIFTY", "strategy_id": "long_straddle", "lots": 1})
        assert r.status_code == 200

    def test_backtest_v2_synth(self, s):
        r = s.post(f"{BASE_URL}/api/backtest/v2",
                   json={"symbol": "NIFTY", "strategy_id": "short_strangle",
                         "lots": 1, "entry_rule": "WEEKLY_MONDAY",
                         "exit_rule": "EXPIRY_5D", "days": 90, "source": "synthetic"})
        assert r.status_code == 200

    def test_payments_config(self, s):
        r = s.get(f"{BASE_URL}/api/payments/config")
        assert r.status_code == 200
