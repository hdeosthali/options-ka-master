# PRD — Options Master

## 1. Vision
A mobile-first paper-trading platform that teaches Indian retail traders how to deploy automated multi-leg options strategies on Nifty / BankNifty / FinNifty — every paper trade is structured exactly like a real broker order so winners can be replicated on Zerodha, Upstox, Dhan, etc.

## 2. Target User
Beginner-to-intermediate Indian options traders who want to learn structured strategies (Iron Condor, Strangles, Spreads, Straddles) without risking real capital.

## 3. Core Features (MVP — shipped)
- **Username-only auth** with persistent AsyncStorage session.
- **Mock real-time market** (Nifty 50, Bank Nifty, Fin Nifty) — deterministic by date + 30 s intraday ticks. Regime classification: BULLISH / BEARISH / RANGE_BOUND / VOLATILE.
- **NSE-style option chain** with 11 strikes around ATM, CE/PE LTP, IV, OI per row — priced via proper Black-Scholes.
- **5 pre-built strategies** with structural leg definitions:
  - Iron Condor, Short Strangle (Neutral)
  - Bull Put Spread, Covered Call (Bullish)
  - Long Straddle (Volatile)
- **AI Strategy Advisor** (Claude Sonnet 4.5 via Emergent LLM key) — explains "why this strategy today" in 3 bullets based on live regime + IV.
- **Greeks per leg + net** (Δ, Γ, Θ, Vega) computed via Black-Scholes, shown inside strategy detail modal.
- **Visual payoff diagram at expiry** rendered with react-native-svg — profit/loss zones, breakevens, current-spot marker, Max Profit / Max Loss / Spot stats.
- **Strategy back-tester** on 1-year deterministic synthetic history — configurable entry rule (every Monday / every day) and exit rule (5-day hold or target/SL). Returns equity curve, win-rate, avg win/loss, max drawdown, recent trades.
- **Multi-leg paper trade execution** — applying a strategy auto-fills every leg at current chain LTPs.
- **Portfolio** with live unrealized P&L per open trade, square-off button, trade history, win-rate.
- **Gamification** — XP per trade/reward, streak, level, badges.
- **Real Razorpay payment** for Pro upgrade (₹999 / 30 days) — backend creates order, hosted HTML checkout loaded in WebView, HMAC-SHA256 signature verified server-side before flipping `is_pro=true` and boosting capital to ₹10L.

## 4. Tech Stack
- **Frontend**: Expo SDK 54, expo-router (file-based), React Native 0.81, lucide-react-native icons, AsyncStorage, react-native-svg for charts, react-native-webview for Razorpay checkout.
- **Backend**: FastAPI + Motor (MongoDB), proper Black-Scholes pricing & Greeks, deterministic historical simulator.
- **AI**: emergentintegrations → Anthropic Claude Sonnet 4.5 with rule-based fallback.
- **Payments**: Razorpay Standard Checkout (test mode) — order creation via python-razorpay SDK, signature verification via HMAC-SHA256.

## 5. Smart Business Enhancement
The Pro upgrade card is positioned at the top of the Profile tab with a premium 3D asset and 6 concrete benefits — this is the conversion surface. The Daily Reward + Streak loop drives D1/D7 retention by giving users a reason to return every day, which directly grows the funnel for the future paid tier (Stripe/Razorpay).

## 6. Replication on Real Broker — Roadmap
Each PaperTrade is stored with `legs[]` containing exact `{action, opt_type, strike, qty, entry_price}`. To go live:
1. Add broker adapter (Zerodha Kite Connect / Upstox / Angel One) behind `/api/trades/apply`.
2. Replace `get_market_snapshot` and `get_option_chain` with broker WebSocket feeds.
3. Gate live mode behind 2FA + risk checks.
Everything else (UI, strategy catalog, AI advisor, portfolio) ports unchanged.

## 7. Out of Scope (MVP)
- Real-money trading, real broker keys
- Payments (Razorpay/Stripe)
- Strategy back-tester / payoff charts
- Push notifications

## 8. Open Items / Future Iterations
- Visual payoff diagrams per strategy (SVG)
- Greeks (delta/gamma/theta) per leg
- Strategy back-tester on historical data
- Real Stripe/Razorpay payment for Pro
- Optional broker integration (Kite Connect)
