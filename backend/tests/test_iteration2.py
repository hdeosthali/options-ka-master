"""Iteration 2 backend tests: Greeks, Payoff, Backtest, Razorpay Payments."""
import os
import uuid
import hmac
import hashlib
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

TEST_USER = f"test_{uuid.uuid4().hex[:8]}"
RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "")


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    # ensure test user exists
    s.post(f"{API}/auth/login", json={"username": TEST_USER})
    yield s
    s.close()


# ---------------- Greeks ----------------
class TestGreeks:
    def test_greeks_iron_condor(self, client):
        r = client.post(f"{API}/greeks", json={"strategy_id": "iron_condor", "symbol": "NIFTY", "lots": 1})
        assert r.status_code == 200, r.text
        j = r.json()
        assert "legs" in j and "net" in j and "snapshot" in j
        assert len(j["legs"]) == 4
        for leg in j["legs"]:
            assert "per_unit" in leg and "contribution" in leg
            for k in ["delta", "gamma", "theta", "vega"]:
                assert k in leg["per_unit"]
                assert k in leg["contribution"]
        for k in ["delta", "gamma", "theta", "vega"]:
            assert k in j["net"]
            assert isinstance(j["net"][k], (int, float))

    @pytest.mark.parametrize("sid", ["short_strangle", "bull_put_spread", "covered_call", "long_straddle"])
    def test_greeks_all_strategies(self, client, sid):
        r = client.post(f"{API}/greeks", json={"strategy_id": sid, "symbol": "NIFTY", "lots": 1})
        assert r.status_code == 200, r.text
        j = r.json()
        assert len(j["legs"]) >= 2
        for k in ["delta", "gamma", "theta", "vega"]:
            assert k in j["net"]

    def test_greeks_invalid_strategy(self, client):
        r = client.post(f"{API}/greeks", json={"strategy_id": "bogus", "symbol": "NIFTY", "lots": 1})
        assert r.status_code == 404


# ---------------- Payoff ----------------
class TestPayoff:
    def test_payoff_iron_condor(self, client):
        r = client.post(f"{API}/payoff", json={"strategy_id": "iron_condor", "symbol": "NIFTY", "lots": 1})
        assert r.status_code == 200, r.text
        j = r.json()
        assert "points" in j and "max_profit" in j and "max_loss" in j and "breakevens" in j
        assert len(j["points"]) == 41
        for p in j["points"]:
            assert "spot" in p and "pnl" in p
        assert j["max_profit"] > 0, f"iron_condor should have positive max_profit, got {j['max_profit']}"
        assert j["max_loss"] < 0, f"iron_condor should have negative max_loss, got {j['max_loss']}"
        assert isinstance(j["breakevens"], list)

    def test_payoff_long_straddle(self, client):
        r = client.post(f"{API}/payoff", json={"strategy_id": "long_straddle", "symbol": "NIFTY", "lots": 1})
        assert r.status_code == 200
        j = r.json()
        # debit strategy: max_loss is negative (premium paid), max_profit positive
        assert j["max_loss"] < 0
        assert j["max_profit"] > 0

    def test_payoff_lots_scaling(self, client):
        r1 = client.post(f"{API}/payoff", json={"strategy_id": "iron_condor", "symbol": "NIFTY", "lots": 1}).json()
        r2 = client.post(f"{API}/payoff", json={"strategy_id": "iron_condor", "symbol": "NIFTY", "lots": 2}).json()
        # max profit should roughly double with double lots
        assert r2["max_profit"] > r1["max_profit"]
        assert r2["max_loss"] < r1["max_loss"]


# ---------------- Backtest ----------------
class TestBacktest:
    def test_backtest_short_strangle_expiry(self, client):
        payload = {
            "strategy_id": "short_strangle",
            "symbol": "NIFTY",
            "lots": 1,
            "entry_rule": "WEEKLY_MONDAY",
            "exit_rule": "EXPIRY_5D",
            "days": 252,
        }
        r = client.post(f"{API}/backtest", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "stats" in j and "equity_curve" in j and "trades" in j
        s = j["stats"]
        for k in ["total_trades", "win_rate", "total_pnl", "max_drawdown"]:
            assert k in s
        assert s["total_trades"] > 0
        assert len(j["equity_curve"]) > 0
        assert len(j["trades"]) == s["total_trades"]
        for t in j["trades"]:
            for k in ["entry_date", "exit_date", "entry_spot", "exit_spot", "pnl"]:
                assert k in t

    def test_backtest_target_sl_differs(self, client):
        base = {"strategy_id": "short_strangle", "symbol": "NIFTY", "lots": 1,
                "entry_rule": "WEEKLY_MONDAY", "days": 252}
        r1 = client.post(f"{API}/backtest", json={**base, "exit_rule": "EXPIRY_5D"}, timeout=30).json()
        r2 = client.post(f"{API}/backtest", json={**base, "exit_rule": "TARGET_SL",
                                                  "target_pct": 30, "stoploss_pct": 50}, timeout=30).json()
        # different exit rules should produce different total pnl OR different number of trades
        assert (r1["stats"]["total_pnl"] != r2["stats"]["total_pnl"]) or \
               (r1["stats"]["total_trades"] != r2["stats"]["total_trades"]), \
               "TARGET_SL produced identical results to EXPIRY_5D"


# ---------------- Razorpay Payments ----------------
class TestPayments:
    def test_payments_config(self, client):
        r = client.get(f"{API}/payments/config")
        assert r.status_code == 200
        j = r.json()
        assert j["key_id"].startswith("rzp_test_"), f"key_id not test key: {j['key_id']}"
        assert j["amount_paise"] == 99900
        assert j["currency"] == "INR"

    def test_create_order(self, client):
        r = client.post(f"{API}/payments/create-order", json={"username": TEST_USER}, timeout=20)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["order_id"].startswith("order_"), f"order_id missing 'order_' prefix: {j['order_id']}"
        assert j["amount"] == 99900
        assert j["currency"] == "INR"
        # store for next tests
        pytest.shared_order_id = j["order_id"]

    def test_checkout_html(self, client):
        # depends on test_create_order
        order_id = getattr(pytest, "shared_order_id", None)
        if not order_id:
            r = client.post(f"{API}/payments/create-order", json={"username": TEST_USER}).json()
            order_id = r["order_id"]
        r = client.get(f"{API}/payments/checkout/{order_id}")
        assert r.status_code == 200
        body = r.text.lower()
        assert "razorpay" in body

    def test_verify_invalid_signature(self, client):
        order_id = getattr(pytest, "shared_order_id", None) or \
                   client.post(f"{API}/payments/create-order", json={"username": TEST_USER}).json()["order_id"]
        r = client.post(f"{API}/payments/verify", json={
            "username": TEST_USER,
            "razorpay_order_id": order_id,
            "razorpay_payment_id": "pay_fakepayment123",
            "razorpay_signature": "deadbeef" * 8,
        })
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"

    def test_verify_valid_signature_makes_pro(self, client):
        # create a fresh user + order for this
        uname = f"pay_{uuid.uuid4().hex[:6]}"
        client.post(f"{API}/auth/login", json={"username": uname})
        order = client.post(f"{API}/payments/create-order", json={"username": uname}).json()
        order_id = order["order_id"]
        payment_id = f"pay_{uuid.uuid4().hex[:14]}"
        body = f"{order_id}|{payment_id}".encode()
        sig = hmac.new(RAZORPAY_KEY_SECRET.encode(), body, hashlib.sha256).hexdigest()

        r = client.post(f"{API}/payments/verify", json={
            "username": uname,
            "razorpay_order_id": order_id,
            "razorpay_payment_id": payment_id,
            "razorpay_signature": sig,
        })
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["verified"] is True
        assert j["user"]["is_pro"] is True
        assert j["user"]["capital"] >= 1000000

        # verify persistence
        u = client.get(f"{API}/user/{uname}").json()
        assert u["is_pro"] is True
        assert u["capital"] >= 1000000


# ---------------- Regression: old endpoints still alive ----------------
class TestRegression:
    def test_old_login_works(self, client):
        r = client.post(f"{API}/auth/login", json={"username": f"regr_{uuid.uuid4().hex[:6]}"})
        assert r.status_code == 200

    def test_snapshot_chain_strategies(self, client):
        for path in ["/market/snapshot", "/market/option-chain/NIFTY", "/strategies"]:
            r = client.get(f"{API}{path}")
            assert r.status_code == 200, f"{path} failed: {r.status_code}"

    def test_advisor_apply_close_portfolio(self, client):
        uname = f"reg_{uuid.uuid4().hex[:6]}"
        client.post(f"{API}/auth/login", json={"username": uname})
        adv = client.post(f"{API}/advisor", json={"username": uname, "symbol": "NIFTY"}, timeout=60)
        assert adv.status_code == 200
        ap = client.post(f"{API}/trades/apply",
                         json={"username": uname, "strategy_id": "bull_put_spread", "symbol": "NIFTY", "lots": 1})
        assert ap.status_code == 200, ap.text
        tid = ap.json()["id"]
        cl = client.post(f"{API}/trades/close", json={"username": uname, "trade_id": tid})
        assert cl.status_code == 200
        pf = client.get(f"{API}/portfolio/{uname}")
        assert pf.status_code == 200
        dr = client.post(f"{API}/user/{uname}/daily-reward")
        assert dr.status_code == 200
