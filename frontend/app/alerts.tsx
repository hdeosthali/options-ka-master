import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { ChevronLeft, Bell, BellRing, Sparkles } from "lucide-react-native";
import { api, session, type AlertT } from "../src/api";
import { theme } from "../src/theme";

const formatTime = (iso: string) => {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" });
  } catch {
    return iso;
  }
};

export default function Alerts() {
  const router = useRouter();
  const [alerts, setAlerts] = useState<AlertT[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const u = await session.get();
    if (!u) return router.replace("/");
    try {
      const data = await api.listAlerts(u);
      setAlerts(data);
    } catch (e) {
      console.warn(e);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const sendNow = async () => {
    const u = await session.get();
    if (!u) return;
    setSending(true);
    try {
      const res = await api.triggerStrategyAlert(u);
      Alert.alert("Alert sent", res.alert.title);
      await load();
    } catch (e: any) {
      Alert.alert("Failed", e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity testID="alerts-back" onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Strategy Alerts</Text>
          <Text style={styles.subtitle}>AI signals · Trade updates · Pro events</Text>
        </View>
      </View>

      <TouchableOpacity testID="trigger-alert-btn" style={styles.triggerBtn} onPress={sendNow} disabled={sending}>
        {sending ? (
          <ActivityIndicator color={theme.colors.brand} />
        ) : (
          <>
            <Sparkles size={16} color={theme.colors.brand} />
            <Text style={styles.triggerText}>Send me today's AI strategy alert</Text>
          </>
        )}
      </TouchableOpacity>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 10 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.brand} />}
      >
        {alerts.length === 0 ? (
          <View style={styles.empty}>
            <Bell size={40} color={theme.colors.textTertiary} strokeWidth={1.5} />
            <Text style={styles.emptyTitle}>No alerts yet</Text>
            <Text style={styles.emptySub}>
              Strategy recommendations and position updates will appear here.
            </Text>
          </View>
        ) : (
          alerts.map((a) => (
            <View key={a.id} style={styles.alertCard} testID={`alert-${a.id}`}>
              <View style={styles.alertIconWrap}>
                <BellRing size={16} color={theme.colors.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.alertTitle}>{a.title}</Text>
                <Text style={styles.alertBody}>{a.body}</Text>
                <Text style={styles.alertTime}>{formatTime(a.created_at)}</Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  header: { flexDirection: "row", alignItems: "center", padding: 12, gap: 8 },
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: theme.colors.surface,
    alignItems: "center", justifyContent: "center",
  },
  title: { color: theme.colors.textPrimary, fontSize: 22, fontWeight: "800", letterSpacing: -0.3 },
  subtitle: { color: theme.colors.textTertiary, fontSize: 12, marginTop: 2 },
  triggerBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    marginHorizontal: 16, marginBottom: 8,
    paddingVertical: 14, borderRadius: 12,
    backgroundColor: "rgba(37,99,235,0.12)",
    borderWidth: 1, borderColor: theme.colors.brand,
  },
  triggerText: { color: theme.colors.brand, fontSize: 13, fontWeight: "700" },
  empty: { alignItems: "center", padding: 40, gap: 10 },
  emptyTitle: { color: theme.colors.textPrimary, fontSize: 16, fontWeight: "700" },
  emptySub: { color: theme.colors.textTertiary, fontSize: 13, textAlign: "center", lineHeight: 20 },
  alertCard: {
    flexDirection: "row",
    gap: 12,
    padding: 14,
    backgroundColor: theme.colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  alertIconWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: "rgba(37,99,235,0.12)",
    alignItems: "center", justifyContent: "center",
  },
  alertTitle: { color: theme.colors.textPrimary, fontSize: 14, fontWeight: "700" },
  alertBody: { color: theme.colors.textSecondary, fontSize: 13, marginTop: 4, lineHeight: 18 },
  alertTime: { color: theme.colors.textTertiary, fontSize: 11, marginTop: 6 },
});
