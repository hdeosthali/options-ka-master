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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TrendingUp, ShieldAlert, X, BarChart3 } from "lucide-react-native";
import { api, session, type StrategyT } from "../../src/api";
import { theme } from "../../src/theme";

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
  const [strategies, setStrategies] = useState<StrategyT[]>([]);
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState<Cat>("All");
  const [selected, setSelected] = useState<StrategyT | null>(null);
  const [symbol, setSymbol] = useState("NIFTY");
  const [lots, setLots] = useState(1);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.strategies();
        setStrategies(data);
      } catch (e: any) {
        Alert.alert("Error", e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Strategy Hub</Text>
        <Text style={styles.subtitle}>{strategies.length} pre-built strategies</Text>
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
                <Text style={styles.cardName}>{s.name}</Text>
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  title: { color: theme.colors.textPrimary, fontSize: 28, fontWeight: "800", letterSpacing: -0.5 },
  subtitle: { color: theme.colors.textTertiary, fontSize: 13, marginTop: 4 },
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
});
