import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ChevronLeft, Plus, Trash2, Save, ArrowUp, ArrowDown } from "lucide-react-native";
import { api, session, type PayoffResultT } from "../src/api";
import { theme, formatINR } from "../src/theme";
import PayoffChart from "../src/components/PayoffChart";

type LegInput = { action: "BUY" | "SELL"; type: "CE" | "PE" | "FUT"; offset: number };

const SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY"];

export default function Editor() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("NIFTY");
  const [legs, setLegs] = useState<LegInput[]>([
    { action: "SELL", type: "CE", offset: 2 },
    { action: "SELL", type: "PE", offset: -2 },
  ]);
  const [preview, setPreview] = useState<PayoffResultT | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const screenWidth = Dimensions.get("window").width;

  // Live payoff preview: create a temporary custom strategy server-side, fetch payoff, delete.
  // To keep it simple, we save-on-preview only when user explicitly hits Preview.
  const refreshPreview = async () => {
    const u = await session.get();
    if (!u || legs.length === 0) return;
    setPreviewLoading(true);
    try {
      // Create temporary
      const tmp = await api.createCustomStrategy({
        username: u,
        name: name || "(preview)",
        legs,
      });
      try {
        const p = await api.payoffFor(tmp.id, symbol, 1, u);
        setPreview(p);
      } finally {
        // Clean up the temp strategy (won't block UI on failure)
        api.deleteCustomStrategy(tmp.id, u).catch(() => {});
      }
    } catch (e: any) {
      Alert.alert("Preview failed", e.message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const addLeg = () => {
    if (legs.length >= 6) {
      Alert.alert("Max 6 legs", "Strategies are capped at 6 legs.");
      return;
    }
    setLegs([...legs, { action: "BUY", type: "CE", offset: 0 }]);
  };

  const removeLeg = (idx: number) => setLegs(legs.filter((_, i) => i !== idx));

  const updateLeg = (idx: number, patch: Partial<LegInput>) =>
    setLegs(legs.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const save = async () => {
    const u = await session.get();
    if (!u) return;
    if (!name.trim()) {
      Alert.alert("Name required", "Give your strategy a name.");
      return;
    }
    if (legs.length === 0) {
      Alert.alert("Need at least 1 leg");
      return;
    }
    setSaving(true);
    try {
      await api.createCustomStrategy({ username: u, name: name.trim(), legs });
      Alert.alert("Saved", `"${name}" is now in your Strategies tab.`, [
        { text: "OK", onPress: () => router.replace("/(tabs)/strategies") },
      ]);
    } catch (e: any) {
      Alert.alert("Save failed", e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity testID="editor-back" onPress={() => router.back()} style={styles.backBtn}>
            <ChevronLeft size={22} color={theme.colors.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Strategy Editor</Text>
            <Text style={styles.subtitle}>Compose your own multi-leg strategy</Text>
          </View>
          <TouchableOpacity testID="editor-save-btn" onPress={save} style={styles.saveBtn} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Save size={16} color="#fff" />}
            <Text style={styles.saveText}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>NAME</Text>
          <TextInput
            testID="editor-name-input"
            value={name}
            onChangeText={setName}
            placeholder="e.g. Iron Butterfly"
            placeholderTextColor={theme.colors.textTertiary}
            style={styles.input}
          />

          <Text style={[styles.label, { marginTop: 16 }]}>UNDERLYING</Text>
          <View style={styles.chipRow}>
            {SYMBOLS.map((s) => (
              <TouchableOpacity
                key={s}
                testID={`editor-sym-${s}`}
                style={[styles.chip, symbol === s && styles.chipActive]}
                onPress={() => setSymbol(s)}
              >
                <Text style={[styles.chipText, symbol === s && styles.chipTextActive]}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.legsHeader}>
            <Text style={styles.label}>LEGS ({legs.length}/6)</Text>
            <TouchableOpacity testID="add-leg-btn" onPress={addLeg} style={styles.addBtn}>
              <Plus size={14} color={theme.colors.brand} />
              <Text style={styles.addText}>Add Leg</Text>
            </TouchableOpacity>
          </View>

          {legs.map((leg, idx) => (
            <View key={idx} style={styles.legCard} testID={`leg-${idx}`}>
              <View style={styles.legRow}>
                <Toggle
                  options={["BUY", "SELL"]}
                  value={leg.action}
                  onChange={(v) => updateLeg(idx, { action: v as "BUY" | "SELL" })}
                  testIdPrefix={`leg-${idx}-action`}
                  activeColors={{ BUY: theme.colors.profit, SELL: theme.colors.loss }}
                />
                <Toggle
                  options={["CE", "PE", "FUT"]}
                  value={leg.type}
                  onChange={(v) => updateLeg(idx, { type: v as "CE" | "PE" | "FUT" })}
                  testIdPrefix={`leg-${idx}-type`}
                />
                <TouchableOpacity
                  testID={`leg-${idx}-delete`}
                  onPress={() => removeLeg(idx)}
                  style={styles.deleteBtn}
                >
                  <Trash2 size={14} color={theme.colors.loss} />
                </TouchableOpacity>
              </View>

              {leg.type !== "FUT" && (
                <View style={styles.offsetRow}>
                  <Text style={styles.offsetLabel}>STRIKE OFFSET (ATM + n×step)</Text>
                  <View style={styles.stepper}>
                    <TouchableOpacity
                      testID={`leg-${idx}-offset-dec`}
                      onPress={() => updateLeg(idx, { offset: leg.offset - 1 })}
                      style={styles.stepBtn}
                    >
                      <ArrowDown size={14} color={theme.colors.textPrimary} />
                    </TouchableOpacity>
                    <Text style={styles.offsetValue}>
                      {leg.offset > 0 ? `+${leg.offset}` : leg.offset}
                    </Text>
                    <TouchableOpacity
                      testID={`leg-${idx}-offset-inc`}
                      onPress={() => updateLeg(idx, { offset: leg.offset + 1 })}
                      style={styles.stepBtn}
                    >
                      <ArrowUp size={14} color={theme.colors.textPrimary} />
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          ))}

          <TouchableOpacity testID="preview-btn" onPress={refreshPreview} style={styles.previewBtn} disabled={previewLoading}>
            {previewLoading ? (
              <ActivityIndicator color={theme.colors.brand} />
            ) : (
              <Text style={styles.previewText}>Preview Payoff</Text>
            )}
          </TouchableOpacity>

          {preview && (
            <View style={styles.previewCard}>
              <Text style={styles.label}>PAYOFF AT EXPIRY</Text>
              <View style={{ alignItems: "center", marginTop: 10 }}>
                <PayoffChart
                  points={preview.points}
                  breakevens={preview.breakevens}
                  currentSpot={preview.snapshot.spot}
                  width={screenWidth - 64}
                  height={180}
                />
              </View>
              <View style={styles.previewStats}>
                <Stat label="Max Profit" value={formatINR(preview.max_profit)} color={theme.colors.profit} />
                <Stat label="Max Loss" value={formatINR(preview.max_loss)} color={theme.colors.loss} />
                <Stat
                  label="Breakevens"
                  value={
                    preview.breakevens.length
                      ? preview.breakevens.map((b) => `₹${b.toFixed(0)}`).join(", ")
                      : "—"
                  }
                />
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const Toggle = ({
  options,
  value,
  onChange,
  testIdPrefix,
  activeColors,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  testIdPrefix?: string;
  activeColors?: Record<string, string>;
}) => (
  <View style={styles.toggle}>
    {options.map((o) => {
      const active = value === o;
      const activeColor = activeColors?.[o] || theme.colors.brand;
      return (
        <TouchableOpacity
          key={o}
          testID={testIdPrefix ? `${testIdPrefix}-${o}` : undefined}
          onPress={() => onChange(o)}
          style={[
            styles.toggleOption,
            active && { backgroundColor: activeColor, borderColor: activeColor },
          ]}
        >
          <Text style={[styles.toggleText, active && { color: "#fff" }]}>{o}</Text>
        </TouchableOpacity>
      );
    })}
  </View>
);

const Stat = ({ label, value, color }: { label: string; value: string; color?: string }) => (
  <View style={styles.previewStat}>
    <Text style={styles.previewStatLabel}>{label}</Text>
    <Text style={[styles.previewStatValue, color && { color }]} numberOfLines={1}>
      {value}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  header: { flexDirection: "row", alignItems: "center", padding: 12, gap: 8 },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: theme.colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: theme.colors.textPrimary, fontSize: 20, fontWeight: "800", letterSpacing: -0.3 },
  subtitle: { color: theme.colors.textTertiary, fontSize: 12, marginTop: 2 },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: theme.colors.brand,
    borderRadius: 10,
  },
  saveText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  label: { color: theme.colors.textTertiary, fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  input: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: theme.colors.textPrimary,
    fontSize: 16,
    marginTop: 8,
  },
  chipRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipActive: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  chipText: { color: theme.colors.textSecondary, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: "#fff" },
  legsHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 20, marginBottom: 8 },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "rgba(37,99,235,0.12)",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.brand,
  },
  addText: { color: theme.colors.brand, fontSize: 12, fontWeight: "700" },
  legCard: {
    backgroundColor: theme.colors.surface,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: 8,
  },
  legRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  toggle: {
    flexDirection: "row",
    backgroundColor: theme.colors.bg,
    borderRadius: 8,
    padding: 2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  toggleOption: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "transparent",
  },
  toggleText: { color: theme.colors.textSecondary, fontSize: 12, fontWeight: "700" },
  deleteBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: theme.colors.lossBg,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: "auto",
  },
  offsetRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10 },
  offsetLabel: { color: theme.colors.textTertiary, fontSize: 10, letterSpacing: 0.4, flex: 1 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 6 },
  stepBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: theme.colors.bg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  offsetValue: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: "700",
    width: 36,
    textAlign: "center",
  },
  previewBtn: {
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "rgba(37,99,235,0.1)",
    borderWidth: 1,
    borderColor: theme.colors.brand,
    alignItems: "center",
  },
  previewText: { color: theme.colors.brand, fontSize: 14, fontWeight: "700" },
  previewCard: {
    marginTop: 16,
    padding: 14,
    backgroundColor: theme.colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  previewStats: { flexDirection: "row", gap: 8, marginTop: 12 },
  previewStat: {
    flex: 1,
    padding: 10,
    backgroundColor: theme.colors.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  previewStatLabel: { color: theme.colors.textTertiary, fontSize: 10, letterSpacing: 0.4 },
  previewStatValue: { color: theme.colors.textPrimary, fontSize: 13, fontWeight: "700", marginTop: 4 },
});
