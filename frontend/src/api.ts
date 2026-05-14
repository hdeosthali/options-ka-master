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
