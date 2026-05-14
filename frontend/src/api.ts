import AsyncStorage from "@react-native-async-storage/async-storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
const API = `${BASE}/api`;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export const api = {
  login: (username: string) =>
    request<UserT>("/auth/login", { method: "POST", body: JSON.stringify({ username }) }),
  getUser: (username: string) => request<UserT>(`/user/${username}`),
  upgrade: (username: string) => request<UserT>(`/user/${username}/upgrade`, { method: "POST" }),
  dailyReward: (username: string) =>
    request<{ claimed: boolean; message: string; user: UserT }>(`/user/${username}/daily-reward`, { method: "POST" }),
  marketSnapshot: () => request<Record<string, MarketSnapshotT>>("/market/snapshot"),
  optionChain: (symbol: string) => request<OptionChainT>(`/market/option-chain/${symbol}`),
  strategies: () => request<StrategyT[]>("/strategies"),
  recommended: (symbol: string) =>
    request<{ snapshot: MarketSnapshotT; strategy: StrategyT }>(`/strategies/recommended?symbol=${symbol}`),
  advisor: (username: string, symbol: string) =>
    request<{ snapshot: MarketSnapshotT; strategy: StrategyT; explanation: string }>("/advisor", {
      method: "POST",
      body: JSON.stringify({ username, symbol }),
    }),
  applyStrategy: (username: string, strategy_id: string, symbol: string, lots: number) =>
    request<TradeT>("/trades/apply", {
      method: "POST",
      body: JSON.stringify({ username, strategy_id, symbol, lots }),
    }),
  listTrades: (username: string) => request<TradeT[]>(`/trades/${username}`),
  closeTrade: (username: string, trade_id: string) =>
    request<TradeT>("/trades/close", { method: "POST", body: JSON.stringify({ username, trade_id }) }),
  portfolio: (username: string) => request<PortfolioT>(`/portfolio/${username}`),
  greeks: (strategy_id: string, symbol: string, lots: number) =>
    request<GreeksResultT>("/greeks", {
      method: "POST",
      body: JSON.stringify({ strategy_id, symbol, lots }),
    }),
  payoff: (strategy_id: string, symbol: string, lots: number) =>
    request<PayoffResultT>("/payoff", {
      method: "POST",
      body: JSON.stringify({ strategy_id, symbol, lots }),
    }),
  backtest: (params: BacktestParamsT) =>
    request<BacktestResultT>("/backtest", {
      method: "POST",
      body: JSON.stringify(params),
    }),
  paymentsConfig: () =>
    request<{ key_id: string; amount_paise: number; currency: string }>("/payments/config"),
  createOrder: (username: string) =>
    request<{ order_id: string; amount: number; currency: string; key_id: string }>("/payments/create-order", {
      method: "POST",
      body: JSON.stringify({ username }),
    }),
  verifyPayment: (
    username: string,
    razorpay_order_id: string,
    razorpay_payment_id: string,
    razorpay_signature: string,
  ) =>
    request<{ verified: boolean; user: UserT }>("/payments/verify", {
      method: "POST",
      body: JSON.stringify({
        username,
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
      }),
    }),
  checkoutUrl: (order_id: string) => `${API}/payments/checkout/${order_id}`,
  // Iteration 3
  mirrorBroker: (username: string, trade_id: string) =>
    request<MirrorResultT>("/broker/mirror", {
      method: "POST",
      body: JSON.stringify({ username, trade_id }),
    }),
  registerPushToken: (username: string, push_token: string, platform: string) =>
    request<{ registered: boolean }>("/notifications/register", {
      method: "POST",
      body: JSON.stringify({ username, push_token, platform }),
    }),
  listAlerts: (username: string) => request<AlertT[]>(`/notifications/${username}`),
  triggerStrategyAlert: (username: string) =>
    request<{ alert: AlertT; push: any }>(`/notifications/${username}/strategy-alert`, { method: "POST" }),
  historical: (symbol: string, days: number, source: "yfinance" | "synthetic" = "yfinance") =>
    request<{ source: string; series: { date: string; close: number; iv: number }[] }>(
      `/historical/${symbol}?days=${days}&source=${source}`
    ),
  backtestV2: (params: BacktestParamsT & { source: "yfinance" | "synthetic" }) =>
    request<BacktestResultT & { source: string }>("/backtest/v2", {
      method: "POST",
      body: JSON.stringify(params),
    }),
  createSubscription: (username: string) =>
    request<{ subscription_id: string; plan_id: string; key_id: string; amount_paise: number }>(
      "/payments/create-subscription",
      { method: "POST", body: JSON.stringify({ username }) }
    ),
  // Iteration 4 — custom strategies
  createCustomStrategy: (payload: {
    username: string;
    name: string;
    category?: string;
    tagline?: string;
    description?: string;
    legs: { action: string; type: string; offset: number }[];
  }) =>
    request<StrategyT & { is_custom?: boolean }>("/strategies/custom", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  listCustomStrategies: (username: string) =>
    request<(StrategyT & { is_custom?: boolean })[]>(`/strategies/custom/${username}`),
  deleteCustomStrategy: (strategy_id: string, username: string) =>
    request<{ deleted: boolean }>(`/strategies/custom/${strategy_id}?username=${username}`, {
      method: "DELETE",
    }),
  // Greeks / Payoff with optional username (custom strategies)
  greeksFor: (strategy_id: string, symbol: string, lots: number, username?: string) =>
    request<GreeksResultT>("/greeks", {
      method: "POST",
      body: JSON.stringify({ strategy_id, symbol, lots, username }),
    }),
  payoffFor: (strategy_id: string, symbol: string, lots: number, username?: string) =>
    request<PayoffResultT>("/payoff", {
      method: "POST",
      body: JSON.stringify({ strategy_id, symbol, lots, username }),
    }),
  // WebSocket URL helper
  chainWsUrl: (symbol: string) => {
    const httpBase = process.env.EXPO_PUBLIC_BACKEND_URL || "";
    const wsBase = httpBase.replace(/^http/, "ws");
    return `${wsBase}/api/ws/chain/${symbol}`;
  },
  positionsWsUrl: (username: string) => {
    const httpBase = process.env.EXPO_PUBLIC_BACKEND_URL || "";
    const wsBase = httpBase.replace(/^http/, "ws");
    return `${wsBase}/api/ws/positions/${username}`;
  },
  // Iteration 5 — Marketplace
  publishStrategy: (username: string, strategy_id: string) =>
    request<{ published: boolean }>("/marketplace/publish", {
      method: "POST",
      body: JSON.stringify({ username, strategy_id }),
    }),
  unpublishStrategy: (username: string, strategy_id: string) =>
    request<{ unpublished: boolean }>("/marketplace/unpublish", {
      method: "POST",
      body: JSON.stringify({ username, strategy_id }),
    }),
  listMarketplace: () => request<MarketplaceItemT[]>("/marketplace"),
  installStrategy: (username: string, strategy_id: string) =>
    request<StrategyT & { is_custom?: boolean }>("/marketplace/install", {
      method: "POST",
      body: JSON.stringify({ username, strategy_id }),
    }),
};

export type MarketplaceItemT = {
  id: string;
  name: string;
  category: string;
  tagline: string;
  description: string;
  legs: { action: string; type: string; offset: number }[];
  creator: string;
  installs: number;
  published_at: string | null;
};

export type PositionWsT = {
  type: "positions";
  ts: string;
  open_count: number;
  total_unrealized_pnl: number;
  positions: {
    id: string;
    symbol: string;
    strategy_name: string;
    leg_count: number;
    unrealized_pnl: number;
    current_spot: number;
    spot_at_entry: number;
  }[];
};

export type MirrorResultT = {
  mirrored: boolean;
  already_mirrored?: boolean;
  broker: string;
  using_real_broker: boolean;
  orders: { order_id: string; status: string; broker: string }[];
  message: string;
};

export type AlertT = {
  id: string;
  username: string;
  title: string;
  body: string;
  data: Record<string, any>;
  created_at: string;
  read: boolean;
};

// ---- Session ----
const KEY = "om_username";
export const session = {
  get: () => AsyncStorage.getItem(KEY),
  set: (u: string) => AsyncStorage.setItem(KEY, u),
  clear: () => AsyncStorage.removeItem(KEY),
};

// ---- Types ----
export type UserT = {
  username: string;
  is_pro: boolean;
  capital: number;
  xp: number;
  level: number;
  streak: number;
  badges: string[];
  last_reward_date: string | null;
  pro_days_left: number;
  created_at: string;
};

export type MarketSnapshotT = {
  symbol: string;
  name: string;
  spot: number;
  change: number;
  change_pct: number;
  iv: number;
  regime: "BULLISH" | "BEARISH" | "VOLATILE" | "RANGE_BOUND";
  lot: number;
  step: number;
};

export type OptionChainRowT = {
  strike: number;
  ce: { ltp: number; iv: number; oi: number };
  pe: { ltp: number; iv: number; oi: number };
};

export type OptionChainT = {
  snapshot: MarketSnapshotT;
  atm: number;
  expiry_days: number;
  rows: OptionChainRowT[];
};

export type StrategyT = {
  id: string;
  name: string;
  category: string;
  tagline: string;
  description: string;
  risk: string;
  reward: string;
  best_regime: string;
  legs: { action: string; type: string; offset: number }[];
};

export type TradeLegT = {
  action: string;
  opt_type: string;
  strike: number;
  qty: number;
  entry_price: number;
};

export type TradeT = {
  id: string;
  username: string;
  symbol: string;
  strategy_id: string;
  strategy_name: string;
  legs: TradeLegT[];
  status: "OPEN" | "CLOSED";
  opened_at: string;
  closed_at: string | null;
  realized_pnl: number;
  spot_at_entry: number;
  unrealized_pnl?: number;
  current_spot?: number;
};

export type PortfolioT = {
  capital: number;
  unrealized_pnl: number;
  realized_pnl: number;
  open_count: number;
  closed_count: number;
  win_rate: number;
  total_value: number;
};

export type GreeksValuesT = {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
};

export type GreeksLegT = {
  action: string;
  type: string;
  strike: number;
  qty: number;
  price: number;
  per_unit: GreeksValuesT;
  contribution: GreeksValuesT;
};

export type GreeksResultT = {
  snapshot: MarketSnapshotT;
  strategy: { id: string; name: string };
  legs: GreeksLegT[];
  net: GreeksValuesT;
};

export type PayoffPointT = { spot: number; pnl: number };

export type PayoffResultT = {
  snapshot: MarketSnapshotT;
  atm: number;
  legs: { action: string; type: string; strike: number; entry_price: number; qty: number }[];
  points: PayoffPointT[];
  max_profit: number;
  max_loss: number;
  breakevens: number[];
};

export type BacktestParamsT = {
  symbol: string;
  strategy_id: string;
  lots: number;
  entry_rule: "WEEKLY_MONDAY" | "DAILY";
  exit_rule: "EXPIRY_5D" | "TARGET_SL";
  target_pct?: number;
  stoploss_pct?: number;
  days?: number;
};

export type BacktestTradeT = {
  entry_date: string;
  exit_date: string;
  entry_spot: number;
  exit_spot: number;
  pnl: number;
};

export type BacktestResultT = {
  symbol: string;
  strategy_id: string;
  strategy_name: string;
  params: BacktestParamsT;
  stats: {
    total_trades: number;
    wins: number;
    losses: number;
    win_rate: number;
    avg_win: number;
    avg_loss: number;
    total_pnl: number;
    max_drawdown: number;
  };
  trades: BacktestTradeT[];
  equity_curve: { date: string; equity: number }[];
};
