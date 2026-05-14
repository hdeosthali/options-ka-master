import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { TrendingUp, ShieldAlert, X, BarChart3, Activity, LineChart } from "lucide-react-native";
import { api, session, type StrategyT, type GreeksResultT, type PayoffResultT } from "../../src/api";
import { theme, formatINR } from "../../src/theme";
import PayoffChart from "../../src/components/PayoffChart";

const CATS = ["All", "Bullish", "Bearish", "Neutral", "Volatile"] as const;
type Cat = (typeof CATS)[number];

const catColor = (c: string) => {
  if (c === "Bullish") return theme.colors.profit;
  if (c === "Bearish") return theme.colors.loss;
  if (c === "Volatile") return theme.colors.accent;
  return theme.colors.info;
};

const SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY"];

export default function Strategies() {
  const router = useRouter();
  const [strategies, setStrategies] = useState<StrategyT[]>([]);
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState<Cat>("All");
  const [selected, setSelected] = useState<StrategyT | null>(null);
  const [symbol, setSymbol] = useState("NIFTY");
  const [lots, setLots] = useState(1);
  const [applying, setApplying] = useState(false);
  const [greeks, setGreeks] = useState<GreeksResultT | null>(null);
  const [payoff, setPayoff] = useState<PayoffResultT | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const screenWidth = Dimensions.get("window").width;

  useEffect(() => {
    (async () => {
      try {
        const u = await session.get();
        const [builtIn, custom] = await Promise.all([
          api.strategies(),
          u ? api.listCustomStrategies(u) : Promise.resolve([] as any),
        ]);
        setStrategies([...builtIn, ...custom]);
      } catch (e: any) {
        Alert.alert("Error", e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Load analysis when modal opens or symbol/lots change
  useEffect(() => {
    if (!selected) {
      setGreeks(null);
      setPayoff(null);
      return;
    }
    let cancelled = false;
    setAnalysisLoading(true);
    (async () => {
      try {
        const u = await session.get();
        const [g, p] = await Promise.all([
          api.greeksFor(selected.id, symbol, lots, u || undefined),
          api.payoffFor(selected.id, symbol, lots, u || undefined),
        ]);
        if (!cancelled) {
          setGreeks(g);
          setPayoff(p);
        }
      } catch (e) {
        // silent — modal still works for trade placement
      } finally {
        if (!cancelled) setAnalysisLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, symbol, lots]);

  const filtered =
    cat === "All" ? strategies : strategies.filter((s) => s.category === cat);

  const apply = async () => {
    if (!selected) return;
    const u = await session.get();
    if (!u) return;
    setApplying(true);
    try {
      const trade = await api.applyStrategy(u, selected.id, symbol, lots);
      Alert.alert(
        "Paper Trade Placed",
        `${trade.strategy_name} on ${trade.symbol}\n${trade.legs.length} legs at ATM ₹${trade.spot_at_entry}`
      );
      setSelected(null);
    } catch (e: any) {
      Alert.alert("Trade failed", e.message);
    } finally {
      setApplying(false);
    }
  };

  const openBacktest = () => {
    if (!selected) return;
    const sid = selected.id;
    const sym = symbol;
    setSelected(null);
    setTimeout(() => router.push({ pathname: "/backtest", params: { strategyId: sid, symbol: sym } }), 100);
  };

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Strategy Hub</Text>
          <Text style={styles.subtitle}>{strategies.length} strategies · tap any to apply</Text>
        </View>
        <TouchableOpacity
          testID="open-editor-btn"
          style={styles.newBtn}
          onPress={() => router.push("/editor")}
        >
          <Text style={styles.newBtnText}>+ New</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.catRow}
      >
        {CATS.map((c) => (
          <TouchableOpacity
            key={c}
            testID={`cat-${c}`}
            onPress={() => setCat(c)}
            style={[styles.catChip, cat === c && styles.catChipActive]}
          >
            <Text style={[styles.catChipText, cat === c && styles.catChipTextActive]}>
              {c}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <ActivityIndicator color={theme.colors.brand} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}>
          {filtered.map((s) => (
            <TouchableOpacity
              key={s.id}
              testID={`strategy-card-${s.id}`}
              style={styles.card}
              onPress={() => setSelected(s)}
            >
              <View style={styles.cardHeader}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
                  <Text style={styles.cardName}>{s.name}</Text>
                  {(s as any).is_custom && (
                    <View style={styles.customBadge}>
                      <Text style={styles.customBadgeText}>CUSTOM</Text>
                    </View>
                  )}
                </View>
                <View
                  style={[
                    styles.catPill,
                    { borderColor: catColor(s.category), backgroundColor: `${catColor(s.category)}1A` },
                  ]}
                >
                  <Text style={[styles.catPillText, { color: catColor(s.category) }]}>
                    {s.category}
                  </Text>
                </View>
              </View>
              <Text style={styles.cardTagline}>{s.tagline}</Text>
              <View style={styles.metaRow}>
                <Meta
                  icon={<ShieldAlert size={14} color={theme.colors.textSecondary} />}
                  label="Risk"
                  value={s.risk}
                />
                <Meta
                  icon={<TrendingUp size={14} color={theme.colors.textSecondary} />}
                  label="Reward"
                  value={s.reward}
                />
                <Meta
                  icon={<BarChart3 size={14} color={theme.colors.textSecondary} />}
                  label="Legs"
                  value={String(s.legs.length)}
                />
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Detail Modal */}
      <Modal
        visible={!!selected}
        animationType="slide"
        transparent
        onRequestClose={() => setSelected(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            {selected && (
              <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
                <View style={styles.modalHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalTitle}>{selected.name}</Text>
                    <Text style={styles.modalTag}>{selected.tagline}</Text>
                  </View>
                  <TouchableOpacity
                    testID="modal-close-btn"
                    onPress={() => setSelected(null)}
                    style={styles.modalClose}
                  >
                    <X size={20} color={theme.colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                <Text style={styles.modalDesc}>{selected.description}</Text>

                {/* Payoff Diagram */}
                {payoff && (
                  <View style={styles.payoffWrap}>
                    <View style={styles.payoffHead}>
                      <Text style={styles.modalSectionLabel}>PAYOFF AT EXPIRY</Text>
                      {payoff.breakevens.length > 0 && (
                        <Text style={styles.payoffBe}>
                          BE: {payoff.breakevens.map((b) => `₹${b.toFixed(0)}`).join(", ")}
                        </Text>
                      )}
                    </View>
                    <PayoffChart
                      points={payoff.points}
                      breakevens={payoff.breakevens}
                      currentSpot={payoff.snapshot.spot}
                      width={screenWidth - 80}
                      height={180}
                    />
                    <View style={styles.payoffStats}>
                      <View style={styles.payoffStat}>
                        <Text style={styles.payoffStatLabel}>Max Profit</Text>
                        <Text style={[styles.payoffStatValue, { color: theme.colors.profit }]}>
                          {formatINR(payoff.max_profit)}
                        </Text>
                      </View>
                      <View style={styles.payoffStat}>
                        <Text style={styles.payoffStatLabel}>Max Loss</Text>
                        <Text style={[styles.payoffStatValue, { color: theme.colors.loss }]}>
                          {formatINR(payoff.max_loss)}
                        </Text>
                      </View>
                      <View style={styles.payoffStat}>
                        <Text style={styles.payoffStatLabel}>Spot</Text>
                        <Text style={styles.payoffStatValue}>
                          ₹{payoff.snapshot.spot.toLocaleString("en-IN")}
                        </Text>
                      </View>
                    </View>
                  </View>
                )}

                {/* Greeks */}
                {greeks && (
                  <View>
                    <Text style={styles.modalSectionLabel}>NET GREEKS</Text>
                    <View style={styles.greeksRow}>
                      <GreekBox label="Δ Delta" value={greeks.net.delta.toFixed(2)} hint="Directional risk" />
                      <GreekBox label="Γ Gamma" value={greeks.net.gamma.toFixed(4)} hint="Delta change" />
                      <GreekBox label="Θ Theta" value={greeks.net.theta.toFixed(0)} hint="₹/day decay" />
                      <GreekBox label="V Vega" value={greeks.net.vega.toFixed(0)} hint="₹/1% IV" />
                    </View>
                  </View>
                )}

                {analysisLoading && (
                  <ActivityIndicator color={theme.colors.brand} style={{ marginTop: 12 }} />
                )}

                <Text style={styles.modalSectionLabel}>STRUCTURE</Text>
                {selected.legs.map((l, i) => (
                  <View key={i} style={styles.legRow}>
                    <Text
                      style={[
                        styles.legAction,
                        { color: l.action === "BUY" ? theme.colors.profit : theme.colors.loss },
                      ]}
                    >
                      {l.action}
                    </Text>
                    <Text style={styles.legText}>
                      {l.type === "FUT" ? "Futures" : `ATM ${l.offset >= 0 ? "+" : ""}${l.offset} ${l.type}`}
                    </Text>
                  </View>
                ))}

                <Text style={styles.modalSectionLabel}>UNDERLYING</Text>
                <View style={styles.symRow}>
                  {SYMBOLS.map((s) => (
                    <TouchableOpacity
                      key={s}
                      testID={`sym-${s}`}
                      style={[styles.symChip, symbol === s && styles.symChipActive]}
                      onPress={() => setSymbol(s)}
                    >
                      <Text style={[styles.symChipText, symbol === s && styles.symChipTextActive]}>
                        {s}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.modalSectionLabel}>LOTS</Text>
                <View style={styles.lotsRow}>
                  <TouchableOpacity
                    style={styles.lotBtn}
                    onPress={() => setLots(Math.max(1, lots - 1))}
                  >
                    <Text style={styles.lotBtnText}>-</Text>
                  </TouchableOpacity>
                  <Text style={styles.lotValue}>{lots}</Text>
                  <TouchableOpacity
                    style={styles.lotBtn}
                    onPress={() => setLots(Math.min(10, lots + 1))}
                  >
                    <Text style={styles.lotBtnText}>+</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  testID="apply-strategy-btn"
                  style={styles.applyBtn}
                  onPress={apply}
                  disabled={applying}
                >
                  {applying ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.applyBtnText}>Place Paper Trade</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  testID="open-backtest-btn"
                  style={styles.backtestBtn}
                  onPress={openBacktest}
                >
                  <LineChart size={16} color={theme.colors.accent} />
                  <Text style={styles.backtestBtnText}>Backtest on 1Y History</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const Meta = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) => (
  <View style={styles.meta}>
    {icon}
    <View style={{ marginLeft: 6 }}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue} numberOfLines={1}>{value}</Text>
    </View>
  </View>
);

const GreekBox = ({ label, value, hint }: { label: string; value: string; hint: string }) => (
  <View style={styles.greekBox}>
    <Text style={styles.greekLabel}>{label}</Text>
    <Text style={styles.greekValue}>{value}</Text>
    <Text style={styles.greekHint}>{hint}</Text>
  </View>
);

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  title: { color: theme.colors.textPrimary, fontSize: 28, fontWeight: "800", letterSpacing: -0.5 },
  subtitle: { color: theme.colors.textTertiary, fontSize: 13, marginTop: 4 },
  newBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: theme.colors.brand,
    borderRadius: 10,
  },
  newBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  customBadge: {
    backgroundColor: "rgba(245,158,11,0.15)",
    borderColor: theme.colors.accent,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  customBadgeText: { color: theme.colors.accent, fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  catRow: { paddingHorizontal: 16, gap: 8, paddingVertical: 4 },
  catChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginRight: 8,
  },
  catChipActive: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  catChipText: { color: theme.colors.textSecondary, fontSize: 13, fontWeight: "600" },
  catChipTextActive: { color: "#fff" },
  card: {
    padding: 16,
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardName: { color: theme.colors.textPrimary, fontSize: 18, fontWeight: "700" },
  catPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  catPillText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
  cardTagline: { color: theme.colors.textSecondary, fontSize: 13, marginTop: 6 },
  metaRow: { flexDirection: "row", marginTop: 14, gap: 12 },
  meta: { flexDirection: "row", alignItems: "center", flex: 1 },
  metaLabel: { color: theme.colors.textTertiary, fontSize: 10, letterSpacing: 0.4 },
  metaValue: { color: theme.colors.textPrimary, fontSize: 12, fontWeight: "600" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: "85%",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: theme.colors.border,
    alignSelf: "center",
    marginBottom: 16,
  },
  modalHeader: { flexDirection: "row", alignItems: "flex-start", marginBottom: 8 },
  modalTitle: { color: theme.colors.textPrimary, fontSize: 24, fontWeight: "800" },
  modalTag: { color: theme.colors.textSecondary, fontSize: 13, marginTop: 4 },
  modalClose: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: theme.colors.surfaceElevated,
    alignItems: "center", justifyContent: "center",
  },
  modalDesc: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 22, marginTop: 10 },
  modalSectionLabel: {
    color: theme.colors.textTertiary,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    marginTop: 20,
    marginBottom: 10,
  },
  legRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    gap: 12,
  },
  legAction: { fontSize: 12, fontWeight: "800", letterSpacing: 0.5, width: 50 },
  legText: { color: theme.colors.textPrimary, fontSize: 14 },
  symRow: { flexDirection: "row", gap: 8 },
  symChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: theme.colors.bg,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  symChipActive: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  symChipText: { color: theme.colors.textSecondary, fontSize: 13, fontWeight: "600" },
  symChipTextActive: { color: "#fff" },
  lotsRow: { flexDirection: "row", alignItems: "center", gap: 20 },
  lotBtn: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: theme.colors.bg,
    borderWidth: 1, borderColor: theme.colors.border,
    alignItems: "center", justifyContent: "center",
  },
  lotBtnText: { color: theme.colors.textPrimary, fontSize: 22, fontWeight: "700" },
  lotValue: { color: theme.colors.textPrimary, fontSize: 24, fontWeight: "800", width: 50, textAlign: "center" },
  applyBtn: {
    marginTop: 24,
    backgroundColor: theme.colors.brand,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
  },
  applyBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  backtestBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "rgba(245,158,11,0.08)",
    borderWidth: 1,
    borderColor: theme.colors.accent,
  },
  backtestBtnText: { color: theme.colors.accent, fontSize: 14, fontWeight: "700" },
  payoffWrap: { marginTop: 16 },
  payoffHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  payoffBe: { color: theme.colors.accent, fontSize: 11, fontWeight: "600" },
  payoffStats: { flexDirection: "row", gap: 8, marginTop: 10 },
  payoffStat: {
    flex: 1,
    backgroundColor: theme.colors.bg,
    borderRadius: 10,
    padding: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
  },
  payoffStatLabel: { color: theme.colors.textTertiary, fontSize: 10, letterSpacing: 0.4 },
  payoffStatValue: { color: theme.colors.textPrimary, fontSize: 13, fontWeight: "700", marginTop: 2 },
  greeksRow: { flexDirection: "row", gap: 8 },
  greekBox: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    backgroundColor: theme.colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
  },
  greekLabel: { color: theme.colors.textSecondary, fontSize: 11, fontWeight: "600" },
  greekValue: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: "800",
    marginTop: 6,
    fontFamily: "Courier",
  },
  greekHint: { color: theme.colors.textTertiary, fontSize: 9, marginTop: 4, letterSpacing: 0.3 },
});
