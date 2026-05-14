import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { TrendingUp, TrendingDown, Inbox, Radio } from "lucide-react-native";
import { api, session, type TradeT, type PortfolioT, type PositionWsT } from "../../src/api";
import { theme, formatINR, formatPct } from "../../src/theme";

type Tab = "OPEN" | "CLOSED";

export default function Portfolio() {
  const [trades, setTrades] = useState<TradeT[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioT | null>(null);
  const [tab, setTab] = useState<Tab>("OPEN");
  const [refreshing, setRefreshing] = useState(false);
  const [live, setLive] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const usernameRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    const u = await session.get();
    if (!u) return;
    usernameRef.current = u;
    try {
      const [t, p] = await Promise.all([api.listTrades(u), api.portfolio(u)]);
      setTrades(t);
      setPortfolio(p);
    } catch (e) {
      console.warn(e);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Live positions WebSocket — patches open-trade unrealized_pnl in place
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const u = await session.get();
      if (!u) return;
      try {
        const ws = new WebSocket(api.positionsWsUrl(u));
        wsRef.current = ws;
        ws.onopen = () => !cancelled && setLive(true);
        ws.onmessage = (e) => {
          try {
            const msg: PositionWsT = JSON.parse(e.data as string);
            if (msg.type !== "positions") return;
            const byId = new Map(msg.positions.map((p) => [p.id, p]));
            setTrades((prev) =>
              prev.map((t) => {
                const p = byId.get(t.id);
                if (!p || t.status !== "OPEN") return t;
                return { ...t, unrealized_pnl: p.unrealized_pnl, current_spot: p.current_spot };
              })
            );
            setPortfolio((prev) =>
              prev
                ? {
                    ...prev,
                    unrealized_pnl: msg.total_unrealized_pnl,
                    total_value: prev.capital + msg.total_unrealized_pnl,
                  }
                : prev
            );
          } catch {}
        };
        ws.onerror = () => !cancelled && setLive(false);
        ws.onclose = () => !cancelled && setLive(false);
      } catch {
        setLive(false);
      }
    })();
    return () => {
      cancelled = true;
      if (wsRef.current) {
        try { wsRef.current.close(); } catch {}
        wsRef.current = null;
      }
    };
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const closeTrade = async (id: string) => {
    const u = await session.get();
    if (!u) return;
    Alert.alert("Square Off", "Close this position at current market price?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Square Off",
        style: "destructive",
        onPress: async () => {
          try {
            const t = await api.closeTrade(u, id);
            Alert.alert(
              "Position Closed",
              `Realized P&L: ${formatINR(t.realized_pnl)}`
            );
            await load();
          } catch (e: any) {
            Alert.alert("Error", e.message);
          }
        },
      },
    ]);
  };

  const mirror = async (id: string) => {
    const u = await session.get();
    if (!u) return;
    try {
      const res = await api.mirrorBroker(u, id);
      const orderIds = res.orders.map((o) => o.order_id).join("\n");
      Alert.alert(
        res.using_real_broker ? "Mirrored to Zerodha Kite" : "Mirrored to Mock Broker",
        `${res.message}\n\nOrder IDs:\n${orderIds}`
      );
      await load();
    } catch (e: any) {
      Alert.alert("Mirror failed", e.message);
    }
  };

  const filtered = trades.filter((t) => t.status === tab);

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Portfolio</Text>
          {portfolio && (
            <Text style={styles.subtitle}>
              Capital {formatINR(portfolio.capital)} · {portfolio.win_rate}% win rate
            </Text>
          )}
        </View>
        <View
          testID="portfolio-live-badge"
          style={[
            styles.liveBadge,
            { backgroundColor: live ? theme.colors.profitBg : theme.colors.surface },
          ]}
        >
          <View style={[styles.liveDot, { backgroundColor: live ? theme.colors.profit : theme.colors.textTertiary }]} />
          <Text style={[styles.liveText, { color: live ? theme.colors.profit : theme.colors.textTertiary }]}>
            {live ? "LIVE" : "POLLING"}
          </Text>
        </View>
      </View>

      {portfolio && (
        <View style={styles.summary}>
          <Card label="UNREALIZED" value={portfolio.unrealized_pnl} />
          <Card label="REALIZED" value={portfolio.realized_pnl} />
        </View>
      )}

      <View style={styles.tabs}>
        {(["OPEN", "CLOSED"] as Tab[]).map((t) => (
          <TouchableOpacity
            key={t}
            testID={`tab-${t}`}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t} ({trades.filter((x) => x.status === t).length})
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.brand}
          />
        }
      >
        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <Inbox size={48} color={theme.colors.textTertiary} strokeWidth={1.5} />
            <Text style={styles.emptyTitle}>No {tab.toLowerCase()} positions</Text>
            <Text style={styles.emptySub}>
              {tab === "OPEN"
                ? "Apply a strategy from the Strategies tab to start paper trading."
                : "Square off open positions to see them here."}
            </Text>
          </View>
        ) : (
          filtered.map((t) => {
            const pnl = t.status === "OPEN" ? (t.unrealized_pnl || 0) : t.realized_pnl;
            const positive = pnl >= 0;
            return (
              <View key={t.id} style={styles.tradeCard} testID={`trade-${t.id}`}>
                <View style={styles.tradeHead}>
                  <View>
                    <Text style={styles.tradeName}>{t.strategy_name}</Text>
                    <Text style={styles.tradeSymbol}>{t.symbol} · {t.legs.length} legs</Text>
                  </View>
                  <View
                    style={[
                      styles.pnlPill,
                      { backgroundColor: positive ? theme.colors.profitBg : theme.colors.lossBg },
                    ]}
                  >
                    {positive ? (
                      <TrendingUp size={12} color={theme.colors.profit} />
                    ) : (
                      <TrendingDown size={12} color={theme.colors.loss} />
                    )}
                    <Text
                      style={[
                        styles.pnlText,
                        { color: positive ? theme.colors.profit : theme.colors.loss },
                      ]}
                    >
                      {formatINR(pnl)}
                    </Text>
                  </View>
                </View>

                <View style={styles.legsBox}>
                  {t.legs.map((l, i) => (
                    <View key={i} style={styles.legLine}>
                      <Text
                        style={[
                          styles.legAction,
                          { color: l.action === "BUY" ? theme.colors.profit : theme.colors.loss },
                        ]}
                      >
                        {l.action}
                      </Text>
                      <Text style={styles.legDetail}>
                        {l.qty} {l.strike} {l.opt_type}
                      </Text>
                      <Text style={styles.legPrice}>@ ₹{l.entry_price.toFixed(2)}</Text>
                    </View>
                  ))}
                </View>

                <View style={styles.tradeFoot}>
                  <Text style={styles.foot}>
                    Entry spot ₹{t.spot_at_entry?.toLocaleString("en-IN")}
                    {t.current_spot ? `  →  Now ₹${t.current_spot.toLocaleString("en-IN")}` : ""}
                  </Text>
                  {t.status === "OPEN" && (
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <TouchableOpacity
                        testID={`mirror-${t.id}`}
                        style={styles.mirrorBtn}
                        onPress={() => mirror(t.id)}
                      >
                        <Radio size={12} color={theme.colors.brand} />
                        <Text style={styles.mirrorText}>
                          {(t as any).broker_order_ids?.length ? "Mirrored" : "Mirror to Broker"}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        testID={`square-off-${t.id}`}
                        style={styles.sqOffBtn}
                        onPress={() => closeTrade(t.id)}
                      >
                        <Text style={styles.sqOffText}>Square Off</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const Card = ({ label, value }: { label: string; value: number }) => {
  const positive = value >= 0;
  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>{label}</Text>
      <Text
        style={[
          styles.cardValue,
          { color: positive ? theme.colors.profit : theme.colors.loss },
        ]}
      >
        {formatINR(value)}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8, flexDirection: "row", alignItems: "center", gap: 10 },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  liveDot: { width: 6, height: 6, borderRadius: 999 },
  liveText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  title: { color: theme.colors.textPrimary, fontSize: 28, fontWeight: "800", letterSpacing: -0.5 },
  subtitle: { color: theme.colors.textTertiary, fontSize: 12, marginTop: 4 },
  summary: { flexDirection: "row", gap: 12, paddingHorizontal: 16, marginVertical: 12 },
  card: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  cardLabel: {
    color: theme.colors.textTertiary,
    fontSize: 11,
    letterSpacing: 0.5,
    fontWeight: "700",
  },
  cardValue: { fontSize: 20, fontWeight: "800", marginTop: 4 },
  tabs: { flexDirection: "row", paddingHorizontal: 16, gap: 8, marginBottom: 8 },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  tabActive: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  tabText: { color: theme.colors.textSecondary, fontSize: 12, fontWeight: "700" },
  tabTextActive: { color: "#fff" },
  tradeCard: {
    backgroundColor: theme.colors.surface,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  tradeHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  tradeName: { color: theme.colors.textPrimary, fontSize: 16, fontWeight: "700" },
  tradeSymbol: { color: theme.colors.textTertiary, fontSize: 12, marginTop: 2 },
  pnlPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  pnlText: { fontSize: 13, fontWeight: "700" },
  legsBox: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    gap: 6,
  },
  legLine: { flexDirection: "row", alignItems: "center", gap: 10 },
  legAction: { fontSize: 11, fontWeight: "800", width: 40 },
  legDetail: { color: theme.colors.textPrimary, fontSize: 13, flex: 1 },
  legPrice: { color: theme.colors.textSecondary, fontSize: 12, fontFamily: "Courier" },
  tradeFoot: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  foot: { color: theme.colors.textTertiary, fontSize: 11, flex: 1 },
  sqOffBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: theme.colors.lossBg,
    borderColor: theme.colors.loss,
    borderWidth: 1,
    borderRadius: 8,
  },
  sqOffText: { color: theme.colors.loss, fontSize: 12, fontWeight: "700" },
  mirrorBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(37,99,235,0.12)",
    borderColor: theme.colors.brand,
    borderWidth: 1,
    borderRadius: 8,
  },
  mirrorText: { color: theme.colors.brand, fontSize: 12, fontWeight: "700" },
  empty: { alignItems: "center", padding: 40, gap: 12 },
  emptyTitle: { color: theme.colors.textPrimary, fontSize: 16, fontWeight: "700" },
  emptySub: {
    color: theme.colors.textTertiary,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 20,
  },
});
