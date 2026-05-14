# PRD — Options Master

## 1. Vision
A mobile-first paper-trading platform that teaches Indian retail traders how to deploy automated multi-leg options strategies on Nifty / BankNifty / FinNifty — every paper trade is structured exactly like a real broker order so winners can be replicated on Zerodha, Upstox, Dhan, etc.

## 2. Target User
Beginner-to-intermediate Indian options traders who want to learn structured strategies (Iron Condor, Strangles, Spreads, Straddles) without risking real capital.

## 3. Core Features (MVP — shipped through Iteration 5)
- Username-only auth, persistent session.
- Mock real-time market (Nifty / Bank Nifty / Fin Nifty), regime detection.
- NSE-style option chain (11 strikes around ATM, proper Black-Scholes pricing).
- **5 pre-built strategies** + **unlimited custom strategies** built in the in-app Strategy Editor.
- **Marketplace** — publish your custom strategies to a public board, browse community strategies, 1-click install any of them into your own library; install counter per source; owners can't install their own.
- AI Strategy Advisor (Claude Sonnet 4.5 via Emergent LLM).
- Greeks per leg + net, visual payoff diagrams (react-native-svg).
- Strategy back-tester on 1Y real NSE data (yfinance) with synthetic fallback.
- Multi-leg paper trade execution, square-off, **broker mirror** (Zerodha Kite stub).
- **Razorpay** payment + subscription + webhook (HMAC-SHA256 verified).
- **Push notifications** via Expo Push Service + in-app alerts.
- **Real-time WebSocket** option chain (`/api/ws/chain/{symbol}`) AND **live portfolio P&L** (`/api/ws/positions/{username}`) — both with automatic polling fallback and visible LIVE/POLLING badge.
- Gamification: XP, streak, level, badges, daily reward.

## 4. Tech Stack
- **Frontend**: Expo SDK 54, expo-router, RN 0.81, lucide-react-native, AsyncStorage, react-native-svg, react-native-webview, expo-notifications, native WebSocket.
- **Backend**: FastAPI + Motor (MongoDB), 2 WebSocket endpoints, proper Black-Scholes & Greeks, yfinance, python-razorpay, httpx, emergentintegrations.
- **AI**: Claude Sonnet 4.5 with rule-based fallback.
- **Payments**: Razorpay (test mode) — one-time + recurring + webhooks.
- **Push**: Expo Push API.

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
