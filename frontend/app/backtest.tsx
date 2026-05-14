import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, TrendingUp, TrendingDown, Activity } from "lucide-react-native";
import { api, type BacktestResultT, type StrategyT } from "../src/api";
import { theme, formatINR } from "../src/theme";
import EquityCurve from "../src/components/EquityCurve";

const ENTRY_RULES = [
  { id: "WEEKLY_MONDAY", label: "Every Monday" },
  { id: "DAILY", label: "Every Day" },
];
const EXIT_RULES = [
  { id: "EXPIRY_5D", label: "Hold 5 Days" },
  { id: "TARGET_SL", label: "Target / SL" },
];
const SOURCES = [
  { id: "yfinance", label: "Real NSE (Yahoo)" },
  { id: "synthetic", label: "Simulated" },
];

export default function BacktestScreen() {
  const router = useRouter();
  const { strategyId, symbol } = useLocalSearchParams<{ strategyId: string; symbol: string }>();
  const [strategy, setStrategy] = useState<StrategyT | null>(null);
  const [entry, setEntry] = useState<"WEEKLY_MONDAY" | "DAILY">("WEEKLY_MONDAY");
  const [exit, setExit] = useState<"EXPIRY_5D" | "TARGET_SL">("EXPIRY_5D");
  const [result, setResult] = useState<BacktestResultT | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const list = await api.strategies();
        setStrategy(list.find((s) => s.id === strategyId) || null);
      } catch (e: any) {
        Alert.alert("Error", e.message);
      }
    })();
  }, [strategyId]);

  const run = async () => {
    if (!strategyId || !symbol) return;
    setRunning(true);
    try {
      const data = await api.backtestV2({
        strategy_id: String(strategyId),
        symbol: String(symbol),
        lots: 1,
        entry_rule: entry,
        exit_rule: exit,
        target_pct: 30,
        stoploss_pct: 50,
        days: 252,
        source,
      });
      setResult(data);
    } catch (e: any) {
      Alert.alert("Backtest failed", e.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity testID="back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <View>
          <Text style={styles.title}>Backtest</Text>
          <Text style={styles.subtitle}>
            {strategy?.name || "..."} on {symbol} · 1Y simulated history
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={styles.controls}>
          <Text style={styles.label}>ENTRY RULE</Text>
          <View style={styles.chipRow}>
            {ENTRY_RULES.map((r) => (
              <TouchableOpacity
                key={r.id}
                testID={`entry-${r.id}`}
                style={[styles.chip, entry === r.id && styles.chipActive]}
                onPress={() => setEntry(r.id as any)}
              >
                <Text style={[styles.chipText, entry === r.id && styles.chipTextActive]}>
                  {r.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.label, { marginTop: 16 }]}>EXIT RULE</Text>
          <View style={styles.chipRow}>
            {EXIT_RULES.map((r) => (
              <TouchableOpacity
                key={r.id}
                testID={`exit-${r.id}`}
                style={[styles.chip, exit === r.id && styles.chipActive]}
                onPress={() => setExit(r.id as any)}
              >
                <Text style={[styles.chipText, exit === r.id && styles.chipTextActive]}>
                  {r.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.label, { marginTop: 16 }]}>DATA SOURCE</Text>
          <View style={styles.chipRow}>
            {SOURCES.map((r) => (
              <TouchableOpacity
                key={r.id}
                testID={`source-${r.id}`}
                style={[styles.chip, source === r.id && styles.chipActive]}
                onPress={() => setSource(r.id as any)}
              >
                <Text style={[styles.chipText, source === r.id && styles.chipTextActive]}>
                  {r.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity testID="run-backtest-btn" style={styles.runBtn} onPress={run} disabled={running}>
            {running ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Activity size={16} color="#fff" />
                <Text style={styles.runBtnText}>Run Backtest</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {result && (
          <>
            <View style={styles.chartCard}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={styles.cardLabel}>EQUITY CURVE</Text>
                <Text style={styles.cardLabel}>SOURCE: {result.source?.toUpperCase() || "—"}</Text>
              </View>
              <View style={{ alignItems: "center", marginTop: 8 }}>
                <EquityCurve series={result.equity_curve} width={320} height={180} />
              </View>
            </View>

            <View style={styles.statsRow}>
              <Stat label="Total P&L" value={formatINR(result.stats.total_pnl)} positive={result.stats.total_pnl >= 0} />
              <Stat label="Win Rate" value={`${result.stats.win_rate}%`} />
            </View>
            <View style={styles.statsRow}>
              <Stat label="Trades" value={`${result.stats.total_trades}`} />
              <Stat label="Wins / Losses" value={`${result.stats.wins} / ${result.stats.losses}`} />
            </View>
            <View style={styles.statsRow}>
              <Stat label="Avg Win" value={formatINR(result.stats.avg_win)} positive={true} />
              <Stat label="Avg Loss" value={formatINR(result.stats.avg_loss)} positive={false} />
            </View>
            <View style={styles.statsRow}>
              <Stat label="Max Drawdown" value={formatINR(result.stats.max_drawdown)} positive={false} />
              <Stat label="Lots" value="1" />
            </View>

            <Text style={styles.sectionLabel}>RECENT TRADES</Text>
            {result.trades.slice(-12).reverse().map((t, i) => (
              <View key={i} style={styles.tradeRow} testID={`bt-trade-${i}`}>
                <View>
                  <Text style={styles.tradeDate}>{t.entry_date} → {t.exit_date}</Text>
                  <Text style={styles.tradeSpot}>
                    ₹{t.entry_spot.toLocaleString("en-IN")} → ₹{t.exit_spot.toLocaleString("en-IN")}
                  </Text>
                </View>
                <View style={styles.tradePnl}>
                  {t.pnl >= 0 ? (
                    <TrendingUp size={14} color={theme.colors.profit} />
                  ) : (
                    <TrendingDown size={14} color={theme.colors.loss} />
                  )}
                  <Text style={[styles.pnlText, { color: t.pnl >= 0 ? theme.colors.profit : theme.colors.loss }]}>
                    {formatINR(t.pnl)}
                  </Text>
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const Stat = ({ label, value, positive }: { label: string; value: string; positive?: boolean }) => (
  <View style={styles.statCard}>
    <Text style={styles.statLabel}>{label}</Text>
    <Text
      style={[
        styles.statValue,
        positive === true && { color: theme.colors.profit },
        positive === false && { color: theme.colors.loss },
      ]}
    >
      {value}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: theme.colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: theme.colors.textPrimary, fontSize: 22, fontWeight: "800", letterSpacing: -0.3 },
  subtitle: { color: theme.colors.textTertiary, fontSize: 12, marginTop: 2 },
  controls: {
    marginHorizontal: 16,
    padding: 16,
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  label: { color: theme.colors.textTertiary, fontSize: 11, fontWeight: "700", letterSpacing: 1, marginBottom: 8 },
  chipRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: theme.colors.bg,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipActive: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  chipText: { color: theme.colors.textSecondary, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: "#fff" },
  runBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: theme.colors.brand,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 18,
  },
  runBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  chartCard: {
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  cardLabel: { color: theme.colors.textTertiary, fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  statsRow: { flexDirection: "row", gap: 12, paddingHorizontal: 16, marginTop: 12 },
  statCard: {
    flex: 1,
    padding: 12,
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  statLabel: { color: theme.colors.textTertiary, fontSize: 10, letterSpacing: 0.5, fontWeight: "700" },
  statValue: { color: theme.colors.textPrimary, fontSize: 16, fontWeight: "700", marginTop: 4 },
  sectionLabel: {
    color: theme.colors.textTertiary,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    paddingHorizontal: 20,
    marginTop: 20,
    marginBottom: 8,
  },
  tradeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  tradeDate: { color: theme.colors.textPrimary, fontSize: 12, fontWeight: "600" },
  tradeSpot: { color: theme.colors.textTertiary, fontSize: 11, marginTop: 2 },
  tradePnl: { flexDirection: "row", alignItems: "center", gap: 4 },
  pnlText: { fontSize: 13, fontWeight: "700" },
});
