from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import random
import math
import uuid
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta

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


def black_scholes_price(spot: float, strike: float, iv_pct: float, days: int, opt_type: str) -> float:
    # Simplified pricing for mock — not financially accurate but stable.
    t = max(days, 1) / 365.0
    sigma = max(iv_pct, 5.0) / 100.0
    moneyness = (spot - strike) if opt_type == "CE" else (strike - spot)
    intrinsic = max(moneyness, 0.0)
    time_value = spot * sigma * math.sqrt(t) * 0.4
    return round(max(intrinsic + time_value, 0.5), 2)


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
