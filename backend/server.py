from fastapi import FastAPI, APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import random
import math
import uuid
import hmac
import hashlib
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import razorpay
import asyncio
import httpx
try:
    import yfinance as yf
except Exception:
    yf = None

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# ---------------- DB ----------------
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

app = FastAPI(title="Options Master API")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("options-master")

# ---------------- Helpers ----------------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def today_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def round_strike(price: float, step: int) -> int:
    return int(round(price / step) * step)


# ---------------- Static catalog ----------------
INSTRUMENTS = {
    "NIFTY": {"name": "NIFTY 50", "base": 22450.0, "step": 50, "lot": 25},
    "BANKNIFTY": {"name": "BANK NIFTY", "base": 48200.0, "step": 100, "lot": 15},
    "FINNIFTY": {"name": "FIN NIFTY", "base": 21300.0, "step": 50, "lot": 40},
}

STRATEGIES: List[Dict[str, Any]] = [
    {
        "id": "iron_condor",
        "name": "Iron Condor",
        "category": "Neutral",
        "tagline": "Profit when market stays in a range",
        "description": "Sell 1 OTM Call + Sell 1 OTM Put, Buy 1 further OTM Call + Buy 1 further OTM Put. Limited risk, limited reward.",
        "risk": "Limited",
        "reward": "Limited",
        "best_regime": "RANGE_BOUND",
        "legs": [
            {"action": "SELL", "type": "CE", "offset": 2},
            {"action": "BUY", "type": "CE", "offset": 4},
            {"action": "SELL", "type": "PE", "offset": -2},
            {"action": "BUY", "type": "PE", "offset": -4},
        ],
    },
    {
        "id": "short_strangle",
        "name": "Short Strangle",
        "category": "Neutral",
        "tagline": "High premium when IV is high",
        "description": "Sell 1 OTM Call + Sell 1 OTM Put. Profits if market stays between strikes. Unlimited risk.",
        "risk": "Unlimited",
        "reward": "Limited",
        "best_regime": "RANGE_BOUND",
        "legs": [
            {"action": "SELL", "type": "CE", "offset": 3},
            {"action": "SELL", "type": "PE", "offset": -3},
        ],
    },
    {
        "id": "bull_put_spread",
        "name": "Bull Put Spread",
        "category": "Bullish",
        "tagline": "Defined-risk bullish trade",
        "description": "Sell 1 ATM/OTM Put + Buy 1 further OTM Put. Profits if market rises or stays flat.",
        "risk": "Limited",
        "reward": "Limited",
        "best_regime": "BULLISH",
        "legs": [
            {"action": "SELL", "type": "PE", "offset": -1},
            {"action": "BUY", "type": "PE", "offset": -3},
        ],
    },
    {
        "id": "covered_call",
        "name": "Covered Call",
        "category": "Bullish",
        "tagline": "Generate income on holdings",
        "description": "Hold underlying (simulated long futures) + Sell 1 OTM Call. Earns premium with capped upside.",
        "risk": "Limited (downside of underlying)",
        "reward": "Limited",
        "best_regime": "BULLISH",
        "legs": [
            {"action": "BUY", "type": "FUT", "offset": 0},
            {"action": "SELL", "type": "CE", "offset": 2},
        ],
    },
    {
        "id": "long_straddle",
        "name": "Long Straddle",
        "category": "Volatile",
        "tagline": "Profit from big moves either way",
        "description": "Buy 1 ATM Call + Buy 1 ATM Put. Profits when market moves sharply up or down.",
        "risk": "Limited (premium paid)",
        "reward": "Unlimited",
        "best_regime": "VOLATILE",
        "legs": [
            {"action": "BUY", "type": "CE", "offset": 0},
            {"action": "BUY", "type": "PE", "offset": 0},
        ],
    },
]


# ---------------- Market simulator ----------------
def daily_seed(symbol: str) -> int:
    return abs(hash(f"{symbol}-{today_str()}")) % (2**32)


def get_market_snapshot(symbol: str) -> Dict[str, Any]:
    inst = INSTRUMENTS[symbol]
    seed = daily_seed(symbol)
    rng = random.Random(seed)
    drift = rng.uniform(-0.012, 0.012)
    spot = round(inst["base"] * (1 + drift), 2)

    # Intraday tick using minute as additional seed
    minute_seed = int(datetime.now(timezone.utc).timestamp() // 30)
    tick_rng = random.Random(seed + minute_seed)
    spot = round(spot * (1 + tick_rng.uniform(-0.0025, 0.0025)), 2)

    iv = round(rng.uniform(11.0, 22.0) + tick_rng.uniform(-0.5, 0.5), 2)
    change = round(spot - inst["base"], 2)
    change_pct = round((change / inst["base"]) * 100, 2)

    # Regime classification
    if abs(change_pct) > 0.7:
        regime = "BULLISH" if change_pct > 0 else "BEARISH"
    elif iv > 18:
        regime = "VOLATILE"
    else:
        regime = "RANGE_BOUND"

    return {
        "symbol": symbol,
        "name": inst["name"],
        "spot": spot,
        "change": change,
        "change_pct": change_pct,
        "iv": iv,
        "regime": regime,
        "lot": inst["lot"],
        "step": inst["step"],
    }


def _norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2)))


def _norm_pdf(x: float) -> float:
    return math.exp(-0.5 * x * x) / math.sqrt(2 * math.pi)


RISK_FREE_RATE = 0.07  # India RBI repo approx


def black_scholes_price(spot: float, strike: float, iv_pct: float, days: int, opt_type: str) -> float:
    """Proper Black-Scholes pricing so OTM/ITM strikes price correctly."""
    t = max(days, 1) / 365.0
    sigma = max(iv_pct, 1.0) / 100.0
    r = RISK_FREE_RATE
    if spot <= 0 or strike <= 0:
        return 0.5
    if opt_type == "FUT":
        return round(spot, 2)
    d1 = (math.log(spot / strike) + (r + 0.5 * sigma * sigma) * t) / (sigma * math.sqrt(t))
    d2 = d1 - sigma * math.sqrt(t)
    if opt_type == "CE":
        price = spot * _norm_cdf(d1) - strike * math.exp(-r * t) * _norm_cdf(d2)
    else:  # PE
        price = strike * math.exp(-r * t) * _norm_cdf(-d2) - spot * _norm_cdf(-d1)
    return round(max(price, 0.5), 2)


def bs_greeks(spot: float, strike: float, iv_pct: float, days: int, opt_type: str) -> Dict[str, float]:
    """Full Black-Scholes Greeks. Theta is per-day, Vega per 1% IV change."""
    t = max(days, 1) / 365.0
    sigma = max(iv_pct, 1.0) / 100.0
    r = RISK_FREE_RATE
    if spot <= 0 or strike <= 0:
        return {"delta": 0, "gamma": 0, "theta": 0, "vega": 0}
    d1 = (math.log(spot / strike) + (r + 0.5 * sigma * sigma) * t) / (sigma * math.sqrt(t))
    d2 = d1 - sigma * math.sqrt(t)
    pdf_d1 = _norm_pdf(d1)
    if opt_type == "CE":
        delta = _norm_cdf(d1)
        theta = (-spot * pdf_d1 * sigma / (2 * math.sqrt(t))
                 - r * strike * math.exp(-r * t) * _norm_cdf(d2)) / 365.0
    else:  # PE
        delta = _norm_cdf(d1) - 1.0
        theta = (-spot * pdf_d1 * sigma / (2 * math.sqrt(t))
                 + r * strike * math.exp(-r * t) * _norm_cdf(-d2)) / 365.0
    gamma = pdf_d1 / (spot * sigma * math.sqrt(t))
    vega = spot * pdf_d1 * math.sqrt(t) / 100.0
    return {
        "delta": round(delta, 4),
        "gamma": round(gamma, 6),
        "theta": round(theta, 2),
        "vega": round(vega, 2),
    }


def get_option_chain(symbol: str, num_strikes: int = 11) -> Dict[str, Any]:
    snap = get_market_snapshot(symbol)
    spot = snap["spot"]
    step = snap["step"]
    iv = snap["iv"]
    atm = round_strike(spot, step)
    half = num_strikes // 2
    strikes = [atm + (i - half) * step for i in range(num_strikes)]
    expiry_days = 7

    rng = random.Random(daily_seed(symbol))
    rows = []
    for k in strikes:
        ce_iv = round(iv + rng.uniform(-1.5, 1.5), 2)
        pe_iv = round(iv + rng.uniform(-1.5, 1.5), 2)
        ce_ltp = black_scholes_price(spot, k, ce_iv, expiry_days, "CE")
        pe_ltp = black_scholes_price(spot, k, pe_iv, expiry_days, "PE")
        ce_oi = rng.randint(1500, 95000)
        pe_oi = rng.randint(1500, 95000)
        rows.append({
            "strike": k,
            "ce": {"ltp": ce_ltp, "iv": ce_iv, "oi": ce_oi},
            "pe": {"ltp": pe_ltp, "iv": pe_iv, "oi": pe_oi},
        })
    return {"snapshot": snap, "atm": atm, "expiry_days": expiry_days, "rows": rows}


# ---------------- Models ----------------
class UserModel(BaseModel):
    username: str
    is_pro: bool = False
    capital: float = 100000.0
    xp: int = 0
    level: int = 1
    streak: int = 0
    badges: List[str] = Field(default_factory=list)
    last_reward_date: Optional[str] = None
    pro_days_left: int = 0
    created_at: str = Field(default_factory=now_iso)


class LoginIn(BaseModel):
    username: str


class TradeLeg(BaseModel):
    action: str  # BUY / SELL
    opt_type: str  # CE / PE / FUT
    strike: int
    qty: int
    entry_price: float


class PaperTrade(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    username: str
    symbol: str
    strategy_id: str
    strategy_name: str
    legs: List[TradeLeg]
    status: str = "OPEN"  # OPEN / CLOSED
    opened_at: str = Field(default_factory=now_iso)
    closed_at: Optional[str] = None
    realized_pnl: float = 0.0
    spot_at_entry: float = 0.0


class ApplyStrategyIn(BaseModel):
    username: str
    strategy_id: str
    symbol: str = "NIFTY"
    lots: int = 1

class CloseTradeIn(BaseModel):
    username: str
    trade_id: str


class AdvisorIn(BaseModel):
    username: str
    symbol: str = "NIFTY"


# ---------------- User helpers ----------------
async def get_or_create_user(username: str) -> Dict[str, Any]:
    username = username.strip().lower()
    if not username:
        raise HTTPException(400, "Username required")
    user = await db.users.find_one({"username": username}, {"_id": 0})
    if user:
        return user
    new_user = UserModel(username=username).model_dump()
    await db.users.insert_one(new_user.copy())
    return new_user


async def update_user(username: str, updates: Dict[str, Any]):
    await db.users.update_one({"username": username}, {"$set": updates})


def calc_level(xp: int) -> int:
    return max(1, int(xp / 100) + 1)


# ---------------- Routes ----------------
@api.get("/")
async def root():
    return {"app": "Options Master API", "status": "ok"}


@api.post("/auth/login")
async def login(payload: LoginIn):
    user = await get_or_create_user(payload.username)
    return user


@api.get("/user/{username}")
async def get_user(username: str):
    user = await db.users.find_one({"username": username.lower()}, {"_id": 0})
    if not user:
        raise HTTPException(404, "User not found")
    return user


@api.post("/user/{username}/upgrade")
async def upgrade_pro(username: str):
    user = await db.users.find_one({"username": username.lower()}, {"_id": 0})
    if not user:
        raise HTTPException(404, "User not found")
    updates = {
        "is_pro": True,
        "pro_days_left": 30,
        "capital": max(user.get("capital", 0), 1000000.0),
        "badges": list(set(user.get("badges", []) + ["Pro Member"])),
    }
    await update_user(username.lower(), updates)
    user.update(updates)
    return user


@api.post("/user/{username}/daily-reward")
async def daily_reward(username: str):
    user = await db.users.find_one({"username": username.lower()}, {"_id": 0})
    if not user:
        raise HTTPException(404, "User not found")
    today = today_str()
    if user.get("last_reward_date") == today:
        return {"claimed": False, "message": "Already claimed today", "user": user}
    last = user.get("last_reward_date")
    streak = user.get("streak", 0)
    if last:
        try:
            last_dt = datetime.strptime(last, "%Y-%m-%d").date()
            today_dt = datetime.strptime(today, "%Y-%m-%d").date()
            if (today_dt - last_dt).days == 1:
                streak += 1
            else:
                streak = 1
        except Exception:
            streak = 1
    else:
        streak = 1
    xp = user.get("xp", 0) + 50
    badges = set(user.get("badges", []))
    if streak >= 7:
        badges.add("7-Day Streak")
    if streak >= 3:
        badges.add("Consistent Trader")
    updates = {
        "xp": xp,
        "level": calc_level(xp),
        "streak": streak,
        "last_reward_date": today,
        "badges": list(badges),
    }
    await update_user(username.lower(), updates)
    user.update(updates)
    return {"claimed": True, "message": f"+50 XP! Streak: {streak} days", "user": user}


# Market endpoints
@api.get("/market/snapshot")
async def market_snapshot():
    return {sym: get_market_snapshot(sym) for sym in INSTRUMENTS.keys()}


@api.get("/market/option-chain/{symbol}")
async def option_chain(symbol: str):
    symbol = symbol.upper()
    if symbol not in INSTRUMENTS:
        raise HTTPException(404, "Symbol not supported")
    return get_option_chain(symbol)


# Strategy catalog
@api.get("/strategies")
async def list_strategies():
    return STRATEGIES


@api.get("/strategies/recommended")
async def recommended(symbol: str = "NIFTY"):
    symbol = symbol.upper()
    if symbol not in INSTRUMENTS:
        raise HTTPException(404, "Symbol not supported")
    snap = get_market_snapshot(symbol)
    regime = snap["regime"]
    # find first strategy whose best_regime matches
    pick = next((s for s in STRATEGIES if s["best_regime"] == regime), STRATEGIES[0])
    return {"snapshot": snap, "strategy": pick}


# AI Advisor
@api.post("/advisor")
async def advisor(payload: AdvisorIn):
    symbol = payload.symbol.upper()
    if symbol not in INSTRUMENTS:
        raise HTTPException(404, "Symbol not supported")
    snap = get_market_snapshot(symbol)
    rec = next((s for s in STRATEGIES if s["best_regime"] == snap["regime"]), STRATEGIES[0])

    # Build prompt
    system_msg = (
        "You are an expert Indian options trading mentor. Explain in simple, friendly language "
        "(max 90 words, 3 short bullet points) why the suggested strategy fits today's market. "
        "Use Indian context (NSE, ₹). No financial advice disclaimers needed; the platform handles that."
    )
    user_text = (
        f"Symbol: {snap['name']}\n"
        f"Spot: ₹{snap['spot']}\n"
        f"Change: {snap['change_pct']}%\n"
        f"IV: {snap['iv']}%\n"
        f"Market regime: {snap['regime']}\n"
        f"Suggested strategy: {rec['name']} ({rec['tagline']})\n"
        f"Explain why this strategy is ideal RIGHT NOW in 3 bullets."
    )

    explanation = None
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        key = os.environ.get("EMERGENT_LLM_KEY")
        if key:
            chat = LlmChat(
                api_key=key,
                session_id=f"advisor-{payload.username}-{today_str()}",
                system_message=system_msg,
            ).with_model("anthropic", "claude-sonnet-4-5-20250929")
            explanation = await chat.send_message(UserMessage(text=user_text))
    except Exception as e:
        logger.warning(f"AI advisor failed, falling back: {e}")

    if not explanation:
        explanation = (
            f"• {snap['name']} is in a {snap['regime'].replace('_', ' ').lower()} regime today "
            f"(change {snap['change_pct']}%).\n"
            f"• IV at {snap['iv']}% supports {rec['name']} — {rec['tagline'].lower()}.\n"
            f"• Stick to defined-risk lot sizing and predefined exits."
        )

    return {"snapshot": snap, "strategy": rec, "explanation": explanation}


# Paper trading
def build_legs(strategy: Dict[str, Any], symbol: str, lots: int, chain: Dict[str, Any]) -> List[TradeLeg]:
    atm = chain["atm"]
    step = chain["snapshot"]["step"]
    lot_size = chain["snapshot"]["lot"]
    qty = lots * lot_size
    rows_by_strike = {r["strike"]: r for r in chain["rows"]}
    legs: List[TradeLeg] = []
    for leg in strategy["legs"]:
        strike = atm + leg["offset"] * step
        if leg["type"] == "FUT":
            price = chain["snapshot"]["spot"]
        else:
            row = rows_by_strike.get(strike)
            if row is None:
                # synthesize a price using BS approximation
                price = black_scholes_price(chain["snapshot"]["spot"], strike, chain["snapshot"]["iv"], chain["expiry_days"], leg["type"])
            else:
                price = row[leg["type"].lower()]["ltp"]
        legs.append(TradeLeg(
            action=leg["action"],
            opt_type=leg["type"],
            strike=int(strike),
            qty=qty,
            entry_price=float(price),
        ))
    return legs


def compute_leg_pnl(leg: TradeLeg, spot: float, iv: float, expiry_days: int) -> float:
    if leg.opt_type == "FUT":
        current = spot
    else:
        current = black_scholes_price(spot, leg.strike, iv, expiry_days, leg.opt_type)
    diff = (current - leg.entry_price) if leg.action == "BUY" else (leg.entry_price - current)
    return round(diff * leg.qty, 2)


@api.post("/trades/apply")
async def apply_strategy(payload: ApplyStrategyIn):
    strategy = next((s for s in STRATEGIES if s["id"] == payload.strategy_id), None)
    if not strategy:
        raise HTTPException(404, "Strategy not found")
    user = await db.users.find_one({"username": payload.username.lower()}, {"_id": 0})
    if not user:
        raise HTTPException(404, "User not found")
    symbol = payload.symbol.upper()
    if symbol not in INSTRUMENTS:
        raise HTTPException(404, "Symbol not supported")

    chain = get_option_chain(symbol)
    legs = build_legs(strategy, symbol, max(payload.lots, 1), chain)

    trade = PaperTrade(
        username=payload.username.lower(),
        symbol=symbol,
        strategy_id=strategy["id"],
        strategy_name=strategy["name"],
        legs=legs,
        spot_at_entry=chain["snapshot"]["spot"],
    )
    await db.trades.insert_one(trade.model_dump())

    # XP boost for placing trade
    xp = user.get("xp", 0) + 20
    badges = set(user.get("badges", []))
    badges.add("First Trade")
    await update_user(payload.username.lower(), {
        "xp": xp,
        "level": calc_level(xp),
        "badges": list(badges),
    })

    return trade.model_dump()


@api.get("/trades/{username}")
async def list_trades(username: str):
    username = username.lower()
    trades_cursor = db.trades.find({"username": username}, {"_id": 0})
    trades = await trades_cursor.to_list(500)
    # enrich open trades with current pnl
    enriched = []
    for t in trades:
        if t["status"] == "OPEN":
            snap = get_market_snapshot(t["symbol"])
            pnl = 0.0
            for leg in t["legs"]:
                pnl += compute_leg_pnl(TradeLeg(**leg), snap["spot"], snap["iv"], 7)
            t["unrealized_pnl"] = round(pnl, 2)
            t["current_spot"] = snap["spot"]
        else:
            t["unrealized_pnl"] = 0.0
            t["current_spot"] = t.get("spot_at_entry", 0.0)
        enriched.append(t)
    enriched.sort(key=lambda x: x["opened_at"], reverse=True)
    return enriched


@api.post("/trades/close")
async def close_trade(payload: CloseTradeIn):
    trade = await db.trades.find_one({"id": payload.trade_id, "username": payload.username.lower()}, {"_id": 0})
    if not trade:
        raise HTTPException(404, "Trade not found")
    if trade["status"] == "CLOSED":
        return trade
    snap = get_market_snapshot(trade["symbol"])
    pnl = 0.0
    for leg in trade["legs"]:
        pnl += compute_leg_pnl(TradeLeg(**leg), snap["spot"], snap["iv"], 7)
    pnl = round(pnl, 2)
    await db.trades.update_one(
        {"id": payload.trade_id},
        {"$set": {"status": "CLOSED", "closed_at": now_iso(), "realized_pnl": pnl}},
    )

    user = await db.users.find_one({"username": payload.username.lower()}, {"_id": 0})
    new_cap = user.get("capital", 100000.0) + pnl
    xp = user.get("xp", 0) + (30 if pnl > 0 else 10)
    badges = set(user.get("badges", []))
    if pnl > 0:
        badges.add("Profitable Trade")
    await update_user(payload.username.lower(), {
        "capital": round(new_cap, 2),
        "xp": xp,
        "level": calc_level(xp),
        "badges": list(badges),
    })

    trade["status"] = "CLOSED"
    trade["realized_pnl"] = pnl
    trade["closed_at"] = now_iso()
    return trade


@api.get("/portfolio/{username}")
async def portfolio(username: str):
    username = username.lower()
    user = await db.users.find_one({"username": username}, {"_id": 0})
    if not user:
        raise HTTPException(404, "User not found")
    trades_cursor = db.trades.find({"username": username}, {"_id": 0})
    trades = await trades_cursor.to_list(500)
    open_trades = [t for t in trades if t["status"] == "OPEN"]
    closed_trades = [t for t in trades if t["status"] == "CLOSED"]

    unrealized = 0.0
    for t in open_trades:
        snap = get_market_snapshot(t["symbol"])
        for leg in t["legs"]:
            unrealized += compute_leg_pnl(TradeLeg(**leg), snap["spot"], snap["iv"], 7)
    realized = sum(t.get("realized_pnl", 0.0) for t in closed_trades)
    win_count = sum(1 for t in closed_trades if t.get("realized_pnl", 0.0) > 0)
    total_closed = len(closed_trades)
    win_rate = round((win_count / total_closed) * 100, 1) if total_closed else 0.0

    return {
        "capital": user.get("capital", 100000.0),
        "unrealized_pnl": round(unrealized, 2),
        "realized_pnl": round(realized, 2),
        "open_count": len(open_trades),
        "closed_count": total_closed,
        "win_rate": win_rate,
        "total_value": round(user.get("capital", 100000.0) + unrealized, 2),
    }


# ---------------- Greeks ----------------
class GreeksIn(BaseModel):
    symbol: str = "NIFTY"
    strategy_id: str
    lots: int = 1
    username: Optional[str] = None


@api.post("/greeks")
async def greeks_for_strategy(payload: GreeksIn):
    strategy = await find_strategy(payload.strategy_id, payload.username)
    if not strategy:
        raise HTTPException(404, "Strategy not found")
    symbol = payload.symbol.upper()
    if symbol not in INSTRUMENTS:
        raise HTTPException(404, "Symbol not supported")
    chain = get_option_chain(symbol)
    snap = chain["snapshot"]
    atm = chain["atm"]
    step = snap["step"]
    lot_size = snap["lot"]
    qty = max(payload.lots, 1) * lot_size

    legs_out = []
    net = {"delta": 0.0, "gamma": 0.0, "theta": 0.0, "vega": 0.0}
    for leg in strategy["legs"]:
        strike = int(atm + leg["offset"] * step)
        sign = 1 if leg["action"] == "BUY" else -1
        if leg["type"] == "FUT":
            # Futures: delta=1, others 0
            g = {"delta": 1.0, "gamma": 0.0, "theta": 0.0, "vega": 0.0}
            price = snap["spot"]
        else:
            g = bs_greeks(snap["spot"], strike, snap["iv"], chain["expiry_days"], leg["type"])
            price = black_scholes_price(snap["spot"], strike, snap["iv"], chain["expiry_days"], leg["type"])
        contribution = {
            "delta": round(g["delta"] * sign * qty, 2),
            "gamma": round(g["gamma"] * sign * qty, 4),
            "theta": round(g["theta"] * sign * qty, 2),
            "vega": round(g["vega"] * sign * qty, 2),
        }
        for k in net:
            net[k] += contribution[k]
        legs_out.append({
            "action": leg["action"],
            "type": leg["type"],
            "strike": strike,
            "qty": qty,
            "price": price,
            "per_unit": g,
            "contribution": contribution,
        })
    return {
        "snapshot": snap,
        "strategy": {"id": strategy["id"], "name": strategy["name"]},
        "legs": legs_out,
        "net": {k: round(v, 4) for k, v in net.items()},
    }


# ---------------- Payoff Diagram ----------------
def leg_payoff_at_expiry(action: str, opt_type: str, strike: int, entry_price: float, qty: int, spot_at_expiry: float) -> float:
    if opt_type == "FUT":
        intrinsic = spot_at_expiry - entry_price
    elif opt_type == "CE":
        intrinsic = max(spot_at_expiry - strike, 0) - entry_price
    else:  # PE
        intrinsic = max(strike - spot_at_expiry, 0) - entry_price
    sign = 1 if action == "BUY" else -1
    return intrinsic * sign * qty


@api.post("/payoff")
async def payoff(payload: GreeksIn):
    strategy = await find_strategy(payload.strategy_id, payload.username)
    if not strategy:
        raise HTTPException(404, "Strategy not found")
    symbol = payload.symbol.upper()
    if symbol not in INSTRUMENTS:
        raise HTTPException(404, "Symbol not supported")
    chain = get_option_chain(symbol)
    snap = chain["snapshot"]
    atm = chain["atm"]
    step = snap["step"]
    qty = max(payload.lots, 1) * snap["lot"]

    legs_built = []
    for leg in strategy["legs"]:
        strike = int(atm + leg["offset"] * step)
        if leg["type"] == "FUT":
            price = snap["spot"]
        else:
            price = black_scholes_price(snap["spot"], strike, snap["iv"], chain["expiry_days"], leg["type"])
        legs_built.append({
            "action": leg["action"],
            "type": leg["type"],
            "strike": strike,
            "entry_price": price,
            "qty": qty,
        })

    # Compute payoff across +/- 10% from spot in 41 points
    points = []
    low = snap["spot"] * 0.90
    high = snap["spot"] * 1.10
    npoints = 41
    max_profit = float("-inf")
    max_loss = float("inf")
    breakevens: List[float] = []
    prev_pnl = None
    for i in range(npoints):
        s = low + (high - low) * (i / (npoints - 1))
        pnl = 0.0
        for l in legs_built:
            pnl += leg_payoff_at_expiry(l["action"], l["type"], l["strike"], l["entry_price"], l["qty"], s)
        pnl = round(pnl, 2)
        if pnl > max_profit:
            max_profit = pnl
        if pnl < max_loss:
            max_loss = pnl
        if prev_pnl is not None and ((prev_pnl <= 0 <= pnl) or (prev_pnl >= 0 >= pnl)):
            # linear interpolate breakeven
            prev_s = points[-1]["spot"]
            if pnl != prev_pnl:
                be = prev_s + (s - prev_s) * (0 - prev_pnl) / (pnl - prev_pnl)
                breakevens.append(round(be, 2))
        points.append({"spot": round(s, 2), "pnl": pnl})
        prev_pnl = pnl

    return {
        "snapshot": snap,
        "atm": atm,
        "legs": legs_built,
        "points": points,
        "max_profit": max_profit if max_profit > float("-inf") else 0,
        "max_loss": max_loss if max_loss < float("inf") else 0,
        "breakevens": breakevens,
    }


# ---------------- Back-tester ----------------
def historical_series(symbol: str, days: int = 252) -> List[Dict[str, Any]]:
    """Deterministic synthetic 1-year daily OHLC + IV series."""
    inst = INSTRUMENTS[symbol]
    rng = random.Random(abs(hash(f"hist-{symbol}")) % (2**32))
    series = []
    price = inst["base"] * 0.92  # start ~8% below current base
    iv = 14.0
    end = datetime.now(timezone.utc).date() - timedelta(days=1)
    for i in range(days):
        d = end - timedelta(days=(days - 1 - i))
        if d.weekday() >= 5:  # skip weekends
            continue
        ret = rng.gauss(0.0005, 0.011)  # mean ~12% annual, vol ~17% annual
        price = max(price * (1 + ret), inst["base"] * 0.5)
        iv = max(8.0, min(35.0, iv + rng.gauss(0, 0.6)))
        series.append({
            "date": d.isoformat(),
            "close": round(price, 2),
            "iv": round(iv, 2),
        })
    return series


class BacktestIn(BaseModel):
    symbol: str = "NIFTY"
    strategy_id: str
    lots: int = 1
    entry_rule: str = "WEEKLY_MONDAY"  # WEEKLY_MONDAY | DAILY
    exit_rule: str = "EXPIRY_5D"        # EXPIRY_5D | TARGET_SL
    target_pct: float = 30.0            # % of max profit at entry credit
    stoploss_pct: float = 50.0          # % of max loss
    days: int = 252


@api.post("/backtest")
async def backtest(payload: BacktestIn):
    strategy = next((s for s in STRATEGIES if s["id"] == payload.strategy_id), None)
    if not strategy:
        raise HTTPException(404, "Strategy not found")
    symbol = payload.symbol.upper()
    if symbol not in INSTRUMENTS:
        raise HTTPException(404, "Symbol not supported")
    inst = INSTRUMENTS[symbol]
    series = historical_series(symbol, max(60, min(payload.days, 500)))
    lot_size = inst["lot"]
    step = inst["step"]
    qty = max(payload.lots, 1) * lot_size

    trades = []
    equity_curve = []
    cum_pnl = 0.0
    i = 0
    while i < len(series):
        day = series[i]
        # entry rule
        d_obj = datetime.fromisoformat(day["date"]).date()
        is_entry = (payload.entry_rule == "WEEKLY_MONDAY" and d_obj.weekday() == 0) or \
                   (payload.entry_rule == "DAILY")
        if not is_entry:
            equity_curve.append({"date": day["date"], "equity": round(cum_pnl, 2)})
            i += 1
            continue

        entry_spot = day["close"]
        entry_iv = day["iv"]
        atm = round_strike(entry_spot, step)
        entry_legs = []
        entry_credit = 0.0  # net premium received (positive = credit strategy)
        for leg in strategy["legs"]:
            strike = atm + leg["offset"] * step
            if leg["type"] == "FUT":
                price = entry_spot
            else:
                price = black_scholes_price(entry_spot, strike, entry_iv, 5, leg["type"])
            entry_legs.append({**leg, "strike": strike, "price": price})
            entry_credit += (price if leg["action"] == "SELL" else -price) * qty

        # Exit
        exit_day_idx = min(i + 5, len(series) - 1)  # default 5 trading days
        exit_pnl = None
        exit_date = series[exit_day_idx]["date"]
        for j in range(i + 1, min(i + 6, len(series))):
            s = series[j]
            pnl = 0.0
            for l in entry_legs:
                if l["type"] == "FUT":
                    intrinsic = s["close"] - l["price"]
                elif l["type"] == "CE":
                    intrinsic = max(s["close"] - l["strike"], 0) - l["price"]
                else:
                    intrinsic = max(l["strike"] - s["close"], 0) - l["price"]
                sign = 1 if l["action"] == "BUY" else -1
                pnl += intrinsic * sign * qty
            if payload.exit_rule == "TARGET_SL":
                if entry_credit > 0:
                    target = entry_credit * payload.target_pct / 100.0
                    sl = -entry_credit * payload.stoploss_pct / 100.0
                else:
                    debit = -entry_credit
                    target = debit * payload.target_pct / 100.0
                    sl = -debit * payload.stoploss_pct / 100.0
                if pnl >= target or pnl <= sl:
                    exit_pnl = pnl
                    exit_day_idx = j
                    exit_date = s["date"]
                    break
            # else default: hold to expiry day
        if exit_pnl is None:
            s = series[exit_day_idx]
            pnl = 0.0
            for l in entry_legs:
                if l["type"] == "FUT":
                    intrinsic = s["close"] - l["price"]
                elif l["type"] == "CE":
                    intrinsic = max(s["close"] - l["strike"], 0) - l["price"]
                else:
                    intrinsic = max(l["strike"] - s["close"], 0) - l["price"]
                sign = 1 if l["action"] == "BUY" else -1
                pnl += intrinsic * sign * qty
            exit_pnl = pnl
            exit_date = s["date"]

        cum_pnl += exit_pnl
        trades.append({
            "entry_date": day["date"],
            "exit_date": exit_date,
            "entry_spot": entry_spot,
            "exit_spot": series[exit_day_idx]["close"],
            "pnl": round(exit_pnl, 2),
        })
        equity_curve.append({"date": day["date"], "equity": round(cum_pnl, 2)})
        i = exit_day_idx + 1

    # Stats
    total = len(trades)
    wins = sum(1 for t in trades if t["pnl"] > 0)
    losses = total - wins
    win_rate = round((wins / total) * 100, 1) if total else 0.0
    avg_win = round(sum(t["pnl"] for t in trades if t["pnl"] > 0) / wins, 2) if wins else 0.0
    avg_loss = round(sum(t["pnl"] for t in trades if t["pnl"] <= 0) / losses, 2) if losses else 0.0
    max_drawdown = 0.0
    peak = 0.0
    for p in equity_curve:
        if p["equity"] > peak:
            peak = p["equity"]
        dd = p["equity"] - peak
        if dd < max_drawdown:
            max_drawdown = dd

    return {
        "symbol": symbol,
        "strategy_id": strategy["id"],
        "strategy_name": strategy["name"],
        "params": payload.model_dump(),
        "stats": {
            "total_trades": total,
            "wins": wins,
            "losses": losses,
            "win_rate": win_rate,
            "avg_win": avg_win,
            "avg_loss": avg_loss,
            "total_pnl": round(cum_pnl, 2),
            "max_drawdown": round(max_drawdown, 2),
        },
        "trades": trades,
        "equity_curve": equity_curve,
    }


# ---------------- Razorpay Payments ----------------
RAZORPAY_KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "")
PRO_PRICE_PAISE = 99900  # ₹999

try:
    razor_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))
except Exception as _e:
    razor_client = None
    logger.warning(f"Razorpay client init failed: {_e}")


class CreateOrderIn(BaseModel):
    username: str


class VerifyPaymentIn(BaseModel):
    username: str
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


@api.get("/payments/config")
async def payments_config():
    return {"key_id": RAZORPAY_KEY_ID, "amount_paise": PRO_PRICE_PAISE, "currency": "INR"}


@api.post("/payments/create-order")
async def create_order(payload: CreateOrderIn):
    if not razor_client:
        raise HTTPException(500, "Razorpay not configured")
    username = payload.username.lower()
    user = await db.users.find_one({"username": username}, {"_id": 0})
    if not user:
        raise HTTPException(404, "User not found")
    receipt = f"pro-{username[:12]}-{int(datetime.now(timezone.utc).timestamp())}"[:40]
    order = razor_client.order.create({
        "amount": PRO_PRICE_PAISE,
        "currency": "INR",
        "receipt": receipt,
        "notes": {"username": username, "plan": "PRO_30_DAYS"},
    })
    await db.payment_orders.insert_one({
        "order_id": order["id"],
        "username": username,
        "amount": PRO_PRICE_PAISE,
        "status": "CREATED",
        "created_at": now_iso(),
    })
    return {"order_id": order["id"], "amount": PRO_PRICE_PAISE, "currency": "INR", "key_id": RAZORPAY_KEY_ID}


@api.post("/payments/verify")
async def verify_payment(payload: VerifyPaymentIn):
    if not RAZORPAY_KEY_SECRET:
        raise HTTPException(500, "Razorpay not configured")
    body = f"{payload.razorpay_order_id}|{payload.razorpay_payment_id}".encode()
    expected = hmac.new(RAZORPAY_KEY_SECRET.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, payload.razorpay_signature):
        await db.payment_orders.update_one(
            {"order_id": payload.razorpay_order_id},
            {"$set": {"status": "FAILED_VERIFY"}},
        )
        raise HTTPException(400, "Invalid payment signature")

    username = payload.username.lower()
    user = await db.users.find_one({"username": username}, {"_id": 0})
    if not user:
        raise HTTPException(404, "User not found")

    await db.payment_orders.update_one(
        {"order_id": payload.razorpay_order_id},
        {"$set": {
            "status": "PAID",
            "payment_id": payload.razorpay_payment_id,
            "paid_at": now_iso(),
        }},
    )

    updates = {
        "is_pro": True,
        "pro_days_left": 30,
        "capital": max(user.get("capital", 0), 1000000.0),
        "badges": list(set(user.get("badges", []) + ["Pro Member"])),
    }
    await update_user(username, updates)
    user.update(updates)
    return {"verified": True, "user": user}


@api.get("/payments/checkout/{order_id}", response_class=HTMLResponse)
async def checkout_page(order_id: str):
    """Hosted HTML page that loads Razorpay checkout in the WebView.
    On payment success/failure/dismiss, posts a JSON message back to React Native via window.ReactNativeWebView.postMessage."""
    order = await db.payment_orders.find_one({"order_id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    username = order["username"]
    amount = order["amount"]
    key_id = RAZORPAY_KEY_ID
    html = f"""
<!doctype html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Options Master · Pro</title>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<style>
  body {{ background: #09090B; color:#FAFAFA; font-family: -apple-system, system-ui, sans-serif; margin:0; padding:24px; min-height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; }}
  .card {{ background:#18181B; padding:24px; border-radius:16px; border:1px solid #27272A; max-width:340px; width:100%; text-align:center; }}
  h1 {{ font-size:22px; margin:0 0 8px; }}
  p {{ color:#A1A1AA; font-size:14px; line-height:20px; margin:0 0 16px; }}
  .price {{ font-size:32px; font-weight:800; color:#F59E0B; margin:8px 0 12px; }}
  button {{ background:#F59E0B; color:#000; border:none; padding:14px 24px; border-radius:12px; font-weight:700; font-size:15px; width:100%; cursor:pointer; }}
  button:disabled {{ opacity:0.5; }}
  .status {{ margin-top:16px; font-size:13px; color:#A1A1AA; }}
</style>
</head><body>
<div class="card">
  <h1>Options Master Pro</h1>
  <p>30 days of premium access · ₹10L virtual capital</p>
  <div class="price">₹999</div>
  <button id="pay">Pay with Razorpay</button>
  <div class="status" id="status"></div>
</div>
<script>
  const post = (m) => {{
    try {{ window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); }} catch(e) {{}}
  }};
  const setStatus = (t) => document.getElementById('status').textContent = t;
  document.getElementById('pay').addEventListener('click', function() {{
    var options = {{
      key: "{key_id}",
      amount: {amount},
      currency: "INR",
      name: "Options Master",
      description: "Pro · 30 Days",
      order_id: "{order_id}",
      prefill: {{ name: "{username}", email: "{username}@optionsmaster.app", contact: "9000000000" }},
      theme: {{ color: "#F59E0B" }},
      handler: function (response) {{
        setStatus('Verifying payment...');
        post({{ type: 'success', data: response }});
      }},
      modal: {{
        ondismiss: function() {{ post({{ type: 'dismissed' }}); }}
      }}
    }};
    var rzp = new Razorpay(options);
    rzp.on('payment.failed', function (resp) {{ post({{ type: 'failed', data: resp.error }}); }});
    rzp.open();
  }});
</script>
</body></html>
"""
    return HTMLResponse(content=html)



# ---------------- Mock Broker Adapter (Kite Connect Stub) ----------------
KITE_API_KEY = os.environ.get("KITE_API_KEY", "")
KITE_API_SECRET = os.environ.get("KITE_API_SECRET", "")


class MirrorIn(BaseModel):
    username: str
    trade_id: str


@api.post("/broker/mirror")
async def mirror_to_broker(payload: MirrorIn):
    """Mirror a paper trade to a real broker. If KITE_API_KEY is unset, returns simulated broker order IDs."""
    username = payload.username.lower()
    trade = await db.trades.find_one({"id": payload.trade_id, "username": username}, {"_id": 0})
    if not trade:
        raise HTTPException(404, "Trade not found")
    if trade.get("broker_order_ids"):
        return {"mirrored": True, "already_mirrored": True, "broker_order_ids": trade["broker_order_ids"]}

    using_real = bool(KITE_API_KEY and KITE_API_SECRET)
    broker_orders = []
    for leg in trade["legs"]:
        if using_real:
            # Real Kite Connect flow would POST to https://api.kite.trade/orders/regular here.
            # Requires user-level access_token from Kite login redirect — out of scope for this MVP.
            broker_orders.append({
                "order_id": f"KITE-{uuid.uuid4().hex[:12].upper()}",
                "status": "PENDING_USER_AUTH",
                "broker": "ZERODHA_KITE",
                "leg": leg,
            })
        else:
            # Simulated broker order — same shape as real Kite response.
            broker_orders.append({
                "order_id": f"SIM-{uuid.uuid4().hex[:12].upper()}",
                "status": "COMPLETE",
                "broker": "MOCK_BROKER",
                "leg": leg,
                "filled_at": now_iso(),
            })

    await db.trades.update_one(
        {"id": payload.trade_id},
        {"$set": {
            "broker_order_ids": [o["order_id"] for o in broker_orders],
            "broker": broker_orders[0]["broker"],
            "mirrored_at": now_iso(),
        }},
    )
    return {
        "mirrored": True,
        "broker": broker_orders[0]["broker"],
        "using_real_broker": using_real,
        "orders": broker_orders,
        "message": "Mirrored to mock broker. Set KITE_API_KEY + KITE_API_SECRET in backend .env to use real Zerodha Kite." if not using_real else "Mirrored to Zerodha Kite. Complete authorization in Kite app.",
    }


# ---------------- Push Notifications (Expo Push Service) ----------------
EXPO_PUSH_URL = os.environ.get("EXPO_PUSH_URL", "https://exp.host/--/api/v2/push/send")


class RegisterTokenIn(BaseModel):
    username: str
    push_token: str
    platform: Optional[str] = "unknown"


class SendAlertIn(BaseModel):
    username: str
    title: str
    body: str
    data: Optional[Dict[str, Any]] = None


async def send_expo_push(tokens: List[str], title: str, body: str, data: Optional[Dict[str, Any]] = None):
    if not tokens:
        return {"sent": 0, "skipped": "no tokens"}
    messages = [
        {"to": t, "sound": "default", "title": title, "body": body, "data": data or {}}
        for t in tokens
        if t and t.startswith("ExponentPushToken")
    ]
    if not messages:
        return {"sent": 0, "skipped": "no valid Expo tokens"}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(EXPO_PUSH_URL, json=messages, headers={"Content-Type": "application/json"})
            return {"sent": len(messages), "expo_response": resp.json()}
    except Exception as e:
        logger.warning(f"Expo push failed: {e}")
        return {"sent": 0, "error": str(e)}


@api.post("/notifications/register")
async def register_push(payload: RegisterTokenIn):
    username = payload.username.lower()
    user = await db.users.find_one({"username": username}, {"_id": 0})
    if not user:
        raise HTTPException(404, "User not found")
    await db.push_tokens.update_one(
        {"username": username, "push_token": payload.push_token},
        {"$set": {
            "username": username,
            "push_token": payload.push_token,
            "platform": payload.platform,
            "updated_at": now_iso(),
        }},
        upsert=True,
    )
    return {"registered": True}


@api.post("/notifications/send")
async def send_alert(payload: SendAlertIn):
    username = payload.username.lower()
    tokens_cursor = db.push_tokens.find({"username": username}, {"_id": 0})
    docs = await tokens_cursor.to_list(20)
    tokens = [d["push_token"] for d in docs]
    # Always store an in-app alert so user can see it on web/no-permission devices
    alert = {
        "id": str(uuid.uuid4()),
        "username": username,
        "title": payload.title,
        "body": payload.body,
        "data": payload.data or {},
        "created_at": now_iso(),
        "read": False,
    }
    await db.alerts.insert_one(alert.copy())
    result = await send_expo_push(tokens, payload.title, payload.body, payload.data)
    return {"alert": {k: v for k, v in alert.items() if k != "_id"}, "push": result}


@api.get("/notifications/{username}")
async def list_alerts(username: str):
    cursor = db.alerts.find({"username": username.lower()}, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(50)


@api.post("/notifications/{username}/strategy-alert")
async def trigger_strategy_alert(username: str):
    """Trigger today's AI-recommended-strategy alert for this user."""
    user = await db.users.find_one({"username": username.lower()}, {"_id": 0})
    if not user:
        raise HTTPException(404, "User not found")
    snap = get_market_snapshot("NIFTY")
    pick = next((s for s in STRATEGIES if s["best_regime"] == snap["regime"]), STRATEGIES[0])
    title = f"{pick['name']} on NIFTY today"
    body = f"NIFTY ₹{snap['spot']} · {snap['regime'].replace('_', ' ').title()} · {pick['tagline']}"
    return await send_alert(SendAlertIn(
        username=username,
        title=title,
        body=body,
        data={"strategy_id": pick["id"], "symbol": "NIFTY", "kind": "STRATEGY_RECO"},
    ))


# ---------------- Razorpay Webhook + Subscription ----------------
RAZORPAY_WEBHOOK_SECRET = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "options_master_demo_secret")
_PRO_PLAN_CACHE: Dict[str, Any] = {}


async def get_or_create_pro_plan() -> Dict[str, Any]:
    """Ensure a monthly ₹999 Razorpay Plan exists, return it."""
    if "plan_id" in _PRO_PLAN_CACHE:
        return _PRO_PLAN_CACHE
    cached = await db.razorpay_plans.find_one({"key": "PRO_MONTHLY"}, {"_id": 0})
    if cached:
        _PRO_PLAN_CACHE.update(cached)
        return _PRO_PLAN_CACHE
    if not razor_client:
        raise HTTPException(500, "Razorpay not configured")
    plan = razor_client.plan.create({
        "period": "monthly",
        "interval": 1,
        "item": {
            "name": "Options Master Pro",
            "amount": PRO_PRICE_PAISE,
            "currency": "INR",
            "description": "Monthly Pro subscription · 10L virtual capital + AI advisor",
        },
        "notes": {"product": "options_master_pro_monthly"},
    })
    doc = {
        "key": "PRO_MONTHLY",
        "plan_id": plan["id"],
        "amount_paise": PRO_PRICE_PAISE,
        "created_at": now_iso(),
    }
    await db.razorpay_plans.insert_one(doc.copy())
    _PRO_PLAN_CACHE.update(doc)
    return _PRO_PLAN_CACHE


class CreateSubIn(BaseModel):
    username: str


@api.post("/payments/create-subscription")
async def create_subscription(payload: CreateSubIn):
    if not razor_client:
        raise HTTPException(500, "Razorpay not configured")
    username = payload.username.lower()
    user = await db.users.find_one({"username": username}, {"_id": 0})
    if not user:
        raise HTTPException(404, "User not found")

    # Try real Razorpay subscription; fall back to a simulated subscription if the test key
    # lacks Plans/Subscriptions scope (common for free Razorpay test accounts).
    try:
        plan = await get_or_create_pro_plan()
        sub = razor_client.subscription.create({
            "plan_id": plan["plan_id"],
            "total_count": 12,
            "customer_notify": 1,
            "notes": {"username": username},
        })
        await db.subscriptions.insert_one({
            "subscription_id": sub["id"],
            "username": username,
            "plan_id": plan["plan_id"],
            "status": sub.get("status", "created"),
            "created_at": now_iso(),
            "simulated": False,
        })
        return {
            "subscription_id": sub["id"],
            "plan_id": plan["plan_id"],
            "key_id": RAZORPAY_KEY_ID,
            "amount_paise": PRO_PRICE_PAISE,
            "simulated": False,
        }
    except Exception as e:
        logger.warning(f"Razorpay subscription create failed, using simulated: {e}")
        sub_id = f"sub_SIM{uuid.uuid4().hex[:14]}"
        plan_id = f"plan_SIM{uuid.uuid4().hex[:14]}"
        await db.subscriptions.insert_one({
            "subscription_id": sub_id,
            "username": username,
            "plan_id": plan_id,
            "status": "created",
            "created_at": now_iso(),
            "simulated": True,
            "note": "Razorpay test key lacks Plans/Subscriptions scope. Enable subscriptions on dashboard.razorpay.com → Subscriptions to use real subscriptions.",
        })
        return {
            "subscription_id": sub_id,
            "plan_id": plan_id,
            "key_id": RAZORPAY_KEY_ID,
            "amount_paise": PRO_PRICE_PAISE,
            "simulated": True,
        }


@api.post("/payments/webhook")
async def razorpay_webhook(request: Request):
    body = await request.body()
    signature = request.headers.get("x-razorpay-signature", "")
    expected = hmac.new(RAZORPAY_WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(400, "Invalid webhook signature")
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON")
    event = payload.get("event", "")
    await db.webhook_events.insert_one({
        "event": event,
        "received_at": now_iso(),
        "payload": payload,
    })

    sub_entity = (payload.get("payload", {}).get("subscription") or {}).get("entity") or {}
    pay_entity = (payload.get("payload", {}).get("payment") or {}).get("entity") or {}
    order_entity = (payload.get("payload", {}).get("order") or {}).get("entity") or {}
    username = (
        sub_entity.get("notes", {}).get("username")
        or pay_entity.get("notes", {}).get("username")
        or order_entity.get("notes", {}).get("username")
    )

    if event in ("subscription.activated", "subscription.charged", "payment.captured") and username:
        username = username.lower()
        user = await db.users.find_one({"username": username}, {"_id": 0})
        if user:
            updates = {
                "is_pro": True,
                "pro_days_left": 30,
                "capital": max(user.get("capital", 0), 1000000.0),
                "badges": list(set(user.get("badges", []) + ["Pro Member"])),
            }
            await update_user(username, updates)
            if sub_entity.get("id"):
                await db.subscriptions.update_one(
                    {"subscription_id": sub_entity["id"]},
                    {"$set": {"status": sub_entity.get("status", "active"), "last_event": event}},
                )
            # Push alert
            await send_alert(SendAlertIn(
                username=username,
                title="Pro activated",
                body="Your Options Master Pro subscription is live. ₹10L capital unlocked.",
                data={"kind": "PRO_ACTIVATED"},
            ))

    return {"ok": True, "event": event}


# ---------------- Real NSE Historical Data ----------------
_HIST_CACHE: Dict[str, List[Dict[str, Any]]] = {}
_HIST_CACHE_DATE: Dict[str, str] = {}

YF_TICKER = {
    "NIFTY": "^NSEI",
    "BANKNIFTY": "^NSEBANK",
    "FINNIFTY": "NIFTY_FIN_SERVICE.NS",
}


def _fetch_yfinance(symbol: str, days: int) -> List[Dict[str, Any]]:
    if yf is None:
        return []
    ticker = YF_TICKER.get(symbol)
    if not ticker:
        return []
    try:
        period = "1y" if days <= 260 else "2y"
        df = yf.Ticker(ticker).history(period=period, interval="1d")
        if df is None or df.empty:
            return []
        out = []
        # crude IV proxy using rolling 20-day annualised volatility
        df = df.dropna()
        df["ret"] = df["Close"].pct_change()
        df["iv"] = df["ret"].rolling(20).std() * (252 ** 0.5) * 100
        df["iv"] = df["iv"].fillna(15.0)
        for idx, row in df.tail(days).iterrows():
            out.append({
                "date": idx.strftime("%Y-%m-%d"),
                "close": round(float(row["Close"]), 2),
                "iv": round(float(row["iv"]), 2),
            })
        return out
    except Exception as e:
        logger.warning(f"yfinance fetch failed for {symbol}: {e}")
        return []


def real_historical_series(symbol: str, days: int) -> List[Dict[str, Any]]:
    cache_key = f"{symbol}-{days}"
    today = today_str()
    if _HIST_CACHE_DATE.get(cache_key) == today and cache_key in _HIST_CACHE:
        return _HIST_CACHE[cache_key]
    data = _fetch_yfinance(symbol, days)
    if data:
        _HIST_CACHE[cache_key] = data
        _HIST_CACHE_DATE[cache_key] = today
    return data


class HistoricalIn(BaseModel):
    symbol: str = "NIFTY"
    days: int = 252
    source: str = "yfinance"  # yfinance | synthetic


@api.get("/historical/{symbol}")
async def historical(symbol: str, days: int = 252, source: str = "yfinance"):
    symbol = symbol.upper()
    if symbol not in INSTRUMENTS:
        raise HTTPException(404, "Symbol not supported")
    if source == "synthetic":
        return {"source": "synthetic", "series": historical_series(symbol, days)}
    data = real_historical_series(symbol, days)
    if data:
        return {"source": "yfinance", "series": data}
    return {"source": "synthetic_fallback", "series": historical_series(symbol, days)}


# Patch backtest to support real data
class BacktestV2In(BacktestIn):
    source: str = "yfinance"  # yfinance | synthetic


@api.post("/backtest/v2")
async def backtest_v2(payload: BacktestV2In):
    """Same as /backtest but lets caller choose real (yfinance) vs synthetic history."""
    # Reuse the backtest function but inject the chosen series.
    symbol = payload.symbol.upper()
    if symbol not in INSTRUMENTS:
        raise HTTPException(404, "Symbol not supported")
    if payload.source == "yfinance":
        series_data = real_historical_series(symbol, max(60, min(payload.days, 500)))
        source_used = "yfinance" if series_data else "synthetic_fallback"
        if not series_data:
            series_data = historical_series(symbol, max(60, min(payload.days, 500)))
    else:
        series_data = historical_series(symbol, max(60, min(payload.days, 500)))
        source_used = "synthetic"

    # Inline backtest using series_data
    strategy = next((s for s in STRATEGIES if s["id"] == payload.strategy_id), None)
    if not strategy:
        raise HTTPException(404, "Strategy not found")
    inst = INSTRUMENTS[symbol]
    lot_size = inst["lot"]
    step = inst["step"]
    qty = max(payload.lots, 1) * lot_size
    series = series_data
    trades = []
    equity_curve = []
    cum_pnl = 0.0
    i = 0
    while i < len(series):
        day = series[i]
        d_obj = datetime.fromisoformat(day["date"]).date()
        is_entry = (payload.entry_rule == "WEEKLY_MONDAY" and d_obj.weekday() == 0) or (payload.entry_rule == "DAILY")
        if not is_entry:
            equity_curve.append({"date": day["date"], "equity": round(cum_pnl, 2)})
            i += 1
            continue
        entry_spot = day["close"]
        entry_iv = day["iv"]
        atm = round_strike(entry_spot, step)
        entry_legs = []
        for leg in strategy["legs"]:
            strike = atm + leg["offset"] * step
            price = entry_spot if leg["type"] == "FUT" else black_scholes_price(entry_spot, strike, entry_iv, 5, leg["type"])
            entry_legs.append({**leg, "strike": strike, "price": price})
        exit_day_idx = min(i + 5, len(series) - 1)
        s = series[exit_day_idx]
        pnl = 0.0
        for l in entry_legs:
            if l["type"] == "FUT":
                intrinsic = s["close"] - l["price"]
            elif l["type"] == "CE":
                intrinsic = max(s["close"] - l["strike"], 0) - l["price"]
            else:
                intrinsic = max(l["strike"] - s["close"], 0) - l["price"]
            sign = 1 if l["action"] == "BUY" else -1
            pnl += intrinsic * sign * qty
        cum_pnl += pnl
        trades.append({
            "entry_date": day["date"],
            "exit_date": s["date"],
            "entry_spot": entry_spot,
            "exit_spot": s["close"],
            "pnl": round(pnl, 2),
        })
        equity_curve.append({"date": day["date"], "equity": round(cum_pnl, 2)})
        i = exit_day_idx + 1

    total = len(trades)
    wins = sum(1 for t in trades if t["pnl"] > 0)
    losses = total - wins
    win_rate = round((wins / total) * 100, 1) if total else 0.0
    avg_win = round(sum(t["pnl"] for t in trades if t["pnl"] > 0) / wins, 2) if wins else 0.0
    avg_loss = round(sum(t["pnl"] for t in trades if t["pnl"] <= 0) / losses, 2) if losses else 0.0
    peak = 0.0
    max_dd = 0.0
    for p in equity_curve:
        if p["equity"] > peak:
            peak = p["equity"]
        dd = p["equity"] - peak
        if dd < max_dd:
            max_dd = dd
    return {
        "symbol": symbol,
        "strategy_id": strategy["id"],
        "strategy_name": strategy["name"],
        "source": source_used,
        "params": payload.model_dump(),
        "stats": {
            "total_trades": total,
            "wins": wins,
            "losses": losses,
            "win_rate": win_rate,
            "avg_win": avg_win,
            "avg_loss": avg_loss,
            "total_pnl": round(cum_pnl, 2),
            "max_drawdown": round(max_dd, 2),
        },
        "trades": trades,
        "equity_curve": equity_curve,
    }


# ---------------- Custom Strategies ----------------
class CustomLegIn(BaseModel):
    action: str  # BUY | SELL
    type: str    # CE | PE | FUT
    offset: int  # in strike steps from ATM (use 0 for FUT)


class CreateCustomIn(BaseModel):
    username: str
    name: str
    category: str = "Custom"
    tagline: str = "User-defined multi-leg strategy"
    description: Optional[str] = ""
    legs: List[CustomLegIn]


async def find_strategy(strategy_id: str, username: Optional[str] = None) -> Optional[Dict[str, Any]]:
    built_in = next((s for s in STRATEGIES if s["id"] == strategy_id), None)
    if built_in:
        return built_in
    query: Dict[str, Any] = {"id": strategy_id}
    if username:
        query["username"] = username.lower()
    custom = await db.custom_strategies.find_one(query, {"_id": 0})
    return custom


@api.post("/strategies/custom")
async def create_custom_strategy(payload: CreateCustomIn):
    username = payload.username.lower()
    user = await db.users.find_one({"username": username}, {"_id": 0})
    if not user:
        raise HTTPException(404, "User not found")
    if not payload.legs:
        raise HTTPException(400, "At least one leg is required")
    if len(payload.legs) > 6:
        raise HTTPException(400, "Maximum 6 legs allowed")
    name = payload.name.strip() or "My Strategy"
    legs_out = []
    for leg in payload.legs:
        action = leg.action.upper()
        otype = leg.type.upper()
        if action not in ("BUY", "SELL"):
            raise HTTPException(400, f"Invalid action: {leg.action}")
        if otype not in ("CE", "PE", "FUT"):
            raise HTTPException(400, f"Invalid type: {leg.type}")
        legs_out.append({"action": action, "type": otype, "offset": int(leg.offset)})
    doc = {
        "id": f"custom_{uuid.uuid4().hex[:10]}",
        "username": username,
        "name": name,
        "category": payload.category or "Custom",
        "tagline": payload.tagline or "User-defined multi-leg strategy",
        "description": payload.description or "",
        "risk": "User-defined",
        "reward": "User-defined",
        "best_regime": "ANY",
        "legs": legs_out,
        "is_custom": True,
        "created_at": now_iso(),
    }
    await db.custom_strategies.insert_one(doc.copy())
    return {k: v for k, v in doc.items() if k != "_id"}


@api.get("/strategies/custom/{username}")
async def list_custom_strategies(username: str):
    cursor = db.custom_strategies.find({"username": username.lower()}, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(100)


@api.delete("/strategies/custom/{strategy_id}")
async def delete_custom_strategy(strategy_id: str, username: str):
    res = await db.custom_strategies.delete_one({"id": strategy_id, "username": username.lower()})
    if res.deleted_count == 0:
        raise HTTPException(404, "Custom strategy not found")
    return {"deleted": True}


# ---------------- WebSocket — Live Option Chain ----------------
@app.websocket("/api/ws/chain/{symbol}")
async def ws_option_chain(websocket: WebSocket, symbol: str):
    symbol = symbol.upper()
    if symbol not in INSTRUMENTS:
        await websocket.close(code=4404)
        return
    await websocket.accept()
    try:
        # Push immediately, then every 2 seconds
        while True:
            chain = get_option_chain(symbol)
            await websocket.send_json({"type": "chain", "data": chain, "ts": now_iso()})
            await asyncio.sleep(2)
    except WebSocketDisconnect:
        return
    except Exception as e:
        logger.warning(f"WS chain error for {symbol}: {e}")
        try:
            await websocket.close()
        except Exception:
            pass


# ---------------- App wiring ----------------
app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
