# PRD — Options Master

## 1. Vision
A mobile-first paper-trading platform that teaches Indian retail traders how to deploy automated multi-leg options strategies on Nifty / BankNifty / FinNifty — every paper trade is structured exactly like a real broker order so winners can be replicated on Zerodha, Upstox, Dhan, etc.

## 2. Target User
Beginner-to-intermediate Indian options traders who want to learn structured strategies (Iron Condor, Strangles, Spreads, Straddles) without risking real capital.

## 3. Core Features (MVP — shipped through Iteration 3)
- **Username-only auth** with persistent AsyncStorage session.
- **Mock real-time market** (Nifty 50, Bank Nifty, Fin Nifty) — deterministic by date + 30 s intraday ticks. Regime classification: BULLISH / BEARISH / RANGE_BOUND / VOLATILE.
- **NSE-style option chain** with 11 strikes around ATM, CE/PE LTP, IV, OI per row — priced via proper Black-Scholes.
- **5 pre-built strategies** with structural leg definitions:
  - Iron Condor, Short Strangle (Neutral)
  - Bull Put Spread, Covered Call (Bullish)
  - Long Straddle (Volatile)
- **AI Strategy Advisor** (Claude Sonnet 4.5 via Emergent LLM key) — explains "why this strategy today" in 3 bullets based on live regime + IV.
- **Greeks per leg + net** (Δ, Γ, Θ, Vega) computed via Black-Scholes.
- **Visual payoff diagrams at expiry** rendered with react-native-svg.
- **Strategy back-tester** on 1-year **real NSE data** (yfinance: ^NSEI, ^NSEBANK, NIFTY_FIN_SERVICE.NS) with synthetic fallback. Configurable entry/exit rules. Equity curve, win-rate, max drawdown.
- **Multi-leg paper trade execution** with live unrealized P&L, square-off.
- **Broker mirror** — `/api/broker/mirror` simulates Zerodha Kite order routing; switches to real Kite when `KITE_API_KEY` is set.
- **Real Razorpay payment** for Pro upgrade (₹999 / 30 days, one-time order) with HMAC signature verification.
- **Razorpay subscription endpoint** (`/api/payments/create-subscription`) with graceful fallback to simulated subscriptions when test key lacks Plans scope.
- **Razorpay webhook** (`/api/payments/webhook`) — HMAC-SHA256 signature verified, auto-upgrades user on `subscription.activated` / `subscription.charged` / `payment.captured`.
- **Push notifications** via Expo Push Service — token registration, in-app alerts list, AI-generated strategy alerts on demand.
- **Gamification** — XP, streak, level, badges, daily reward.

## 4. Tech Stack
- **Frontend**: Expo SDK 54, expo-router, React Native 0.81, lucide-react-native, AsyncStorage, react-native-svg (charts), react-native-webview (Razorpay), expo-notifications + expo-device (push).
- **Backend**: FastAPI + Motor (MongoDB), proper Black-Scholes pricing & Greeks, deterministic synthetic + real yfinance historical data, python-razorpay, httpx (Expo Push), emergentintegrations.
- **AI**: Claude Sonnet 4.5 with rule-based fallback.
- **Payments**: Razorpay Standard Checkout (test mode) + subscriptions + webhook.
- **Push**: Expo Push API (free, no keys).

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
