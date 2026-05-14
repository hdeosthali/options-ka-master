import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, type OptionChainT } from "../../src/api";
import { theme } from "../../src/theme";

const SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY"];

export default function Chain() {
  const [symbol, setSymbol] = useState("NIFTY");
  const [chain, setChain] = useState<OptionChainT | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.optionChain(symbol);
      setChain(data);
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Option Chain</Text>
        {chain && (
          <Text style={styles.subtitle}>
            ATM ₹{chain.atm.toLocaleString("en-IN")} • Spot ₹{chain.snapshot.spot.toLocaleString("en-IN")} • IV {chain.snapshot.iv}%
          </Text>
        )}
      </View>

      <View style={styles.symRow}>
        {SYMBOLS.map((s) => (
          <TouchableOpacity
            key={s}
            testID={`chain-sym-${s}`}
            style={[styles.symChip, symbol === s && styles.symChipActive]}
            onPress={() => setSymbol(s)}
          >
            <Text style={[styles.symChipText, symbol === s && styles.symChipTextActive]}>
              {s}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading || !chain ? (
        <ActivityIndicator color={theme.colors.brand} style={{ marginTop: 40 }} />
      ) : (
        <>
          <View style={styles.tableHead}>
            <Text style={[styles.headCell, { flex: 1, color: theme.colors.profit }]}>CALL</Text>
            <Text style={[styles.headCell, { width: 80, textAlign: "center" }]}>STRIKE</Text>
            <Text style={[styles.headCell, { flex: 1, textAlign: "right", color: theme.colors.loss }]}>PUT</Text>
          </View>
          <View style={styles.subHead}>
            <Text style={[styles.subHeadCell, { flex: 1 }]}>OI · IV · LTP</Text>
            <Text style={[styles.subHeadCell, { width: 80, textAlign: "center" }]}>₹</Text>
            <Text style={[styles.subHeadCell, { flex: 1, textAlign: "right" }]}>LTP · IV · OI</Text>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
            {chain.rows.map((r) => {
              const isAtm = r.strike === chain.atm;
              return (
                <View
                  key={r.strike}
                  style={[styles.row, isAtm && styles.atmRow]}
                  testID={`chain-row-${r.strike}`}
                >
                  <View style={[styles.side, { backgroundColor: theme.colors.profitBg }]}>
                    <Text style={styles.metaSm}>{(r.ce.oi / 1000).toFixed(1)}k</Text>
                    <Text style={styles.metaSm}>{r.ce.iv}%</Text>
                    <Text style={[styles.ltp, { color: theme.colors.profit }]}>₹{r.ce.ltp}</Text>
                  </View>
                  <View style={styles.strikeCol}>
                    <Text style={[styles.strikeText, isAtm && { color: theme.colors.accent }]}>
                      {r.strike.toLocaleString("en-IN")}
                    </Text>
                    {isAtm && <Text style={styles.atmTag}>ATM</Text>}
                  </View>
                  <View style={[styles.side, { backgroundColor: theme.colors.lossBg, alignItems: "flex-end" }]}>
                    <Text style={[styles.ltp, { color: theme.colors.loss }]}>₹{r.pe.ltp}</Text>
                    <Text style={styles.metaSm}>{r.pe.iv}%</Text>
                    <Text style={styles.metaSm}>{(r.pe.oi / 1000).toFixed(1)}k</Text>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  title: { color: theme.colors.textPrimary, fontSize: 28, fontWeight: "800", letterSpacing: -0.5 },
  subtitle: { color: theme.colors.textTertiary, fontSize: 12, marginTop: 4 },
  symRow: { flexDirection: "row", paddingHorizontal: 16, gap: 8, marginVertical: 12 },
  symChip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: theme.colors.surface,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  symChipActive: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  symChipText: { color: theme.colors.textSecondary, fontSize: 12, fontWeight: "600" },
  symChipTextActive: { color: "#fff" },
  tableHead: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1, borderBottomWidth: 1,
    borderColor: theme.colors.border,
  },
  headCell: { fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  subHead: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderColor: theme.colors.border,
  },
  subHeadCell: { color: theme.colors.textTertiary, fontSize: 10, letterSpacing: 0.4 },
  row: {
    flexDirection: "row",
    minHeight: 56,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    alignItems: "center",
  },
  atmRow: { backgroundColor: "rgba(245,158,11,0.06)" },
  side: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 8,
  },
  metaSm: { color: theme.colors.textSecondary, fontSize: 11, fontFamily: "Courier" },
  ltp: { fontSize: 14, fontWeight: "700", fontFamily: "Courier" },
  strikeCol: {
    width: 80, alignItems: "center", justifyContent: "center",
    borderLeftWidth: 1, borderRightWidth: 1,
    borderColor: theme.colors.border,
    paddingVertical: 8,
  },
  strikeText: { color: theme.colors.textPrimary, fontSize: 14, fontWeight: "700" },
  atmTag: { color: theme.colors.accent, fontSize: 9, fontWeight: "800", marginTop: 2, letterSpacing: 0.5 },
});
