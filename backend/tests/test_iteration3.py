"""Iteration 3 tests: Push notifications, Broker mirror, Razorpay webhook+subscription, yfinance historical."""
import os
import hmac
import hashlib
import json
import uuid
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://trader-simulator-7.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
WEBHOOK_SECRET = "options_master_demo_secret"

# unique username so we get a clean state
USER = f"itr3{uuid.uuid4().hex[:6]}"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def user(session):
    r = session.post(f"{API}/auth/login", json={"username": USER})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def open_trade(session, user):
    # apply a strategy to create an OPEN trade
    r = session.post(f"{API}/trades/apply", json={
        "username": USER, "strategy_id": "iron_condor", "symbol": "NIFTY", "lots": 1
    })
    assert r.status_code == 200, r.text
    t = r.json()
    assert t["status"] == "OPEN"
    return t


# ---------------- Broker Mirror ----------------
class TestBrokerMirror:
    def test_mirror_first_call(self, session, open_trade):
        r = session.post(f"{API}/broker/mirror", json={"username": USER, "trade_id": open_trade["id"]})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["mirrored"] is True
        assert body["using_real_broker"] is False
        assert body["broker"] == "MOCK_BROKER"
        orders = body["orders"]
        assert len(orders) == len(open_trade["legs"])
        for o in orders:
            assert o["order_id"].startswith("SIM-")
            assert o["broker"] == "MOCK_BROKER"
            assert o["status"] == "COMPLETE"

    def test_mirror_idempotent(self, session, open_trade):
        r = session.post(f"{API}/broker/mirror", json={"username": USER, "trade_id": open_trade["id"]})
        assert r.status_code == 200
        body = r.json()
        assert body.get("already_mirrored") is True
        assert body["mirrored"] is True
        assert all(o.startswith("SIM-") for o in body["broker_order_ids"])

    def test_mirror_unknown_trade(self, session):
        r = session.post(f"{API}/broker/mirror", json={"username": USER, "trade_id": "nonexistent"})
        assert r.status_code == 404


# ---------------- Push Notifications ----------------
class TestNotifications:
    def test_register_token(self, session, user):
        token = "ExponentPushToken[TEST-itr3-token-1]"
        r = session.post(f"{API}/notifications/register", json={
            "username": USER, "push_token": token, "platform": "ios"
        })
        assert r.status_code == 200
        assert r.json()["registered"] is True

    def test_register_token_idempotent(self, session, user):
        token = "ExponentPushToken[TEST-itr3-token-1]"
        r = session.post(f"{API}/notifications/register", json={
            "username": USER, "push_token": token, "platform": "android"
        })
        assert r.status_code == 200

    def test_send_alert_creates_inapp(self, session, user):
        r = session.post(f"{API}/notifications/send", json={
            "username": USER, "title": "Hello", "body": "Test body", "data": {"k": "v"}
        })
        assert r.status_code == 200
        b = r.json()
        assert "alert" in b
        assert b["alert"]["title"] == "Hello"
        assert b["alert"]["body"] == "Test body"
        assert "push" in b

    def test_strategy_alert(self, session, user):
        r = session.post(f"{API}/notifications/{USER}/strategy-alert")
        assert r.status_code == 200
        b = r.json()
        alert = b["alert"]
        # title must include a strategy name from catalog
        assert "NIFTY" in alert["title"]
        body = alert["body"]
        assert "₹" in body
        # one of the regime names appears (title-cased with spaces)
        assert any(r in body for r in ["Bullish", "Bearish", "Volatile", "Range Bound"])
        # tagline check — body has separator
        assert " · " in body

    def test_list_alerts_sorted_desc(self, session, user):
        r = session.get(f"{API}/notifications/{USER}")
        assert r.status_code == 200
        alerts = r.json()
        assert isinstance(alerts, list) and len(alerts) >= 2
        dates = [a["created_at"] for a in alerts]
        assert dates == sorted(dates, reverse=True)


# ---------------- Historical / Backtest v2 ----------------
class TestHistorical:
    def test_synthetic_source(self, session):
        r = session.get(f"{API}/historical/NIFTY", params={"days": 30, "source": "synthetic"})
        assert r.status_code == 200
        b = r.json()
        assert b["source"] == "synthetic"
        assert len(b["series"]) >= 20

    def test_yfinance_or_fallback(self, session):
        r = session.get(f"{API}/historical/NIFTY", params={"days": 30, "source": "yfinance"}, timeout=30)
        assert r.status_code == 200
        b = r.json()
        assert b["source"] in ("yfinance", "synthetic_fallback")
        assert len(b["series"]) >= 20

    def test_backtest_v2_synthetic(self, session):
        r = session.post(f"{API}/backtest/v2", json={
            "symbol": "NIFTY", "strategy_id": "iron_condor", "lots": 1, "source": "synthetic", "days": 90
        })
        assert r.status_code == 200
        b = r.json()
        assert b["source"] == "synthetic"
        assert b["stats"]["total_trades"] >= 0

    def test_backtest_v2_yfinance(self, session):
        r = session.post(f"{API}/backtest/v2", json={
            "symbol": "NIFTY", "strategy_id": "iron_condor", "lots": 1, "source": "yfinance", "days": 90
        }, timeout=30)
        assert r.status_code == 200
        b = r.json()
        assert b["source"] in ("yfinance", "synthetic_fallback")


# ---------------- Subscription + Webhook ----------------
class TestSubscriptionAndWebhook:
    def test_create_subscription(self, session, user):
        r = session.post(f"{API}/payments/create-subscription", json={"username": USER}, timeout=30)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["subscription_id"].startswith("sub_")
        assert b["plan_id"].startswith("plan_")
        assert b["amount_paise"] == 99900

    def test_webhook_bad_signature(self, session):
        r = session.post(f"{API}/payments/webhook",
                         data=b'{"event":"subscription.activated"}',
                         headers={"x-razorpay-signature": "bad", "Content-Type": "application/json"})
        assert r.status_code == 400

    def test_webhook_valid_signature_activates_pro(self, session, user):
        # ensure user not pro
        u = session.get(f"{API}/user/{USER}").json()
        # Build payload
        payload = {
            "event": "subscription.activated",
            "payload": {
                "subscription": {
                    "entity": {
                        "id": f"sub_test_{uuid.uuid4().hex[:8]}",
                        "status": "active",
                        "notes": {"username": USER},
                    }
                }
            }
        }
        body = json.dumps(payload).encode()
        sig = hmac.new(WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
        r = session.post(f"{API}/payments/webhook", data=body,
                         headers={"x-razorpay-signature": sig, "Content-Type": "application/json"})
        assert r.status_code == 200, r.text
        assert r.json()["ok"] is True
        # verify user is now pro
        u2 = session.get(f"{API}/user/{USER}").json()
        assert u2["is_pro"] is True
        assert u2["pro_days_left"] == 30


# ---------------- Regression: iteration 1 + 2 endpoints ----------------
class TestRegression:
    def test_market_snapshot(self, session):
        r = session.get(f"{API}/market/snapshot")
        assert r.status_code == 200
        assert "NIFTY" in r.json()

    def test_option_chain(self, session):
        r = session.get(f"{API}/market/option-chain/NIFTY")
        assert r.status_code == 200
        assert "rows" in r.json()

    def test_strategies(self, session):
        r = session.get(f"{API}/strategies")
        assert r.status_code == 200 and len(r.json()) >= 5

    def test_advisor(self, session, user):
        r = session.post(f"{API}/advisor", json={"username": USER, "symbol": "NIFTY"}, timeout=30)
        assert r.status_code == 200
        assert "explanation" in r.json()

    def test_portfolio(self, session, user):
        r = session.get(f"{API}/portfolio/{USER}")
        assert r.status_code == 200
        b = r.json()
        assert "capital" in b and "unrealized_pnl" in b

    def test_greeks(self, session):
        r = session.post(f"{API}/greeks", json={"symbol": "NIFTY", "strategy_id": "iron_condor", "lots": 1})
        assert r.status_code == 200
        assert "net" in r.json()

    def test_payoff(self, session):
        r = session.post(f"{API}/payoff", json={"symbol": "NIFTY", "strategy_id": "iron_condor", "lots": 1})
        assert r.status_code == 200
        assert len(r.json()["points"]) == 41

    def test_backtest_v1(self, session):
        r = session.post(f"{API}/backtest", json={"symbol": "NIFTY", "strategy_id": "iron_condor", "lots": 1, "days": 90})
        assert r.status_code == 200
        assert "stats" in r.json()

    def test_payments_config(self, session):
        r = session.get(f"{API}/payments/config")
        assert r.status_code == 200
        assert r.json()["amount_paise"] == 99900

    def test_payments_create_order(self, session, user):
        r = session.post(f"{API}/payments/create-order", json={"username": USER}, timeout=30)
        assert r.status_code == 200
        b = r.json()
        assert b["order_id"].startswith("order_")

    def test_payments_checkout_html(self, session, user):
        # First create an order to test checkout page
        order = session.post(f"{API}/payments/create-order", json={"username": USER}, timeout=30).json()
        r = session.get(f"{API}/payments/checkout/{order['order_id']}")
        assert r.status_code == 200
        assert "Razorpay" in r.text or "razorpay" in r.text
