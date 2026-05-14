# PRD — Options Master

## 1. Vision
A mobile-first paper-trading platform that teaches Indian retail traders how to deploy automated multi-leg options strategies on Nifty / BankNifty / FinNifty — every paper trade is structured exactly like a real broker order so winners can be replicated on Zerodha, Upstox, Dhan, etc.

## 2. Target User
Beginner-to-intermediate Indian options traders who want to learn structured strategies (Iron Condor, Strangles, Spreads, Straddles) without risking real capital.

## 3. Core Features (MVP — shipped through Iteration 4)
- **Username-only auth** with persistent AsyncStorage session.
- **Mock real-time market** (Nifty 50, Bank Nifty, Fin Nifty) — deterministic by date + 30 s intraday ticks. Regime classification: BULLISH / BEARISH / RANGE_BOUND / VOLATILE.
- **NSE-style option chain** with 11 strikes around ATM, CE/PE LTP, IV, OI per row — priced via proper Black-Scholes.
- **5 pre-built strategies**: Iron Condor, Short Strangle (Neutral), Bull Put Spread, Covered Call (Bullish), Long Straddle (Volatile).
- **Strategy Editor** — compose custom multi-leg strategies (1-6 legs, BUY/SELL × CE/PE/FUT × strike offset from ATM) with live payoff preview; save to user's library; appears in Strategies tab with CUSTOM badge; per-user isolation (cannot read other users' customs).
- **AI Strategy Advisor** (Claude Sonnet 4.5 via Emergent LLM key) — explains "why this strategy today" in 3 bullets based on live regime + IV.
- **Greeks per leg + net** (Δ, Γ, Θ, Vega) via Black-Scholes.
- **Visual payoff diagrams at expiry** rendered with react-native-svg.
- **Strategy back-tester** on 1-year **real NSE data** (yfinance) with synthetic fallback. Configurable entry/exit rules; equity curve, win-rate, max drawdown.
- **Multi-leg paper trade execution** for built-in AND custom strategies.
- **Broker mirror** — `/api/broker/mirror` simulates Zerodha Kite order routing.
- **Real Razorpay payment + Subscription + Webhook** — one-time ₹999 order, monthly subscription (graceful fallback when test key lacks Plans scope), HMAC-SHA256 webhook verification.
- **Push notifications** via Expo Push Service + in-app alerts list.
- **Real-time WebSocket option chain** at `/api/ws/chain/{symbol}` — pushes updates every 2 seconds; frontend Chain tab shows LIVE/POLLING badge with automatic polling fallback.
- **Gamification** — XP, streak, level, badges, daily reward.

## 4. Tech Stack
- **Frontend**: Expo SDK 54, expo-router, RN 0.81, lucide-react-native, AsyncStorage, react-native-svg, react-native-webview, expo-notifications, native WebSocket.
- **Backend**: FastAPI + Motor (MongoDB), WebSocket support, proper Black-Scholes pricing & Greeks, yfinance, python-razorpay, httpx, emergentintegrations.
- **AI**: Claude Sonnet 4.5 with rule-based fallback.
- **Payments**: Razorpay (test mode) — one-time + recurring + webhooks.
- **Push**: Expo Push API (free).

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
