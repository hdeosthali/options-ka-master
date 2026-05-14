import { useCallback, useState } from "react";
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
import { useFocusEffect, useRouter } from "expo-router";
import { ChevronLeft, Store, Download, User as UserIcon, TrendingUp } from "lucide-react-native";
import { api, session, type MarketplaceItemT } from "../src/api";
import { theme } from "../src/theme";

const formatDate = (iso: string | null) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  } catch {
    return iso;
  }
};

export default function Marketplace() {
  const router = useRouter();
  const [items, setItems] = useState<MarketplaceItemT[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const u = await session.get();
      setMe(u);
      const data = await api.listMarketplace();
      setItems(data);
    } catch (e: any) {
      Alert.alert("Failed to load", e.message);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const install = async (item: MarketplaceItemT) => {
    const u = await session.get();
    if (!u) return;
    setInstalling(item.id);
    try {
      await api.installStrategy(u, item.id);
      Alert.alert("Installed", `"${item.name}" by @${item.creator} added to your Strategies.`, [
        { text: "OK", onPress: () => router.replace("/(tabs)/strategies") },
      ]);
      await load();
    } catch (e: any) {
      Alert.alert("Install failed", e.message);
    } finally {
      setInstalling(null);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity testID="market-back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Marketplace</Text>
          <Text style={styles.subtitle}>Community strategies · {items.length} live</Text>
        </View>
        <View style={styles.iconBubble}>
          <Store size={18} color={theme.colors.brand} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.brand} />}
      >
        {items.length === 0 ? (
          <View style={styles.empty}>
            <Store size={40} color={theme.colors.textTertiary} strokeWidth={1.5} />
            <Text style={styles.emptyTitle}>No strategies published yet</Text>
            <Text style={styles.emptySub}>
              Be the first — open Strategies → tap your custom strategy → Publish.
            </Text>
          </View>
        ) : (
          items.map((s) => {
            const isMine = me === s.creator;
            return (
              <View key={s.id} style={styles.card} testID={`market-${s.id}`}>
                <View style={styles.cardHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardName}>{s.name}</Text>
                    <View style={styles.creatorRow}>
                      <UserIcon size={11} color={theme.colors.textTertiary} />
                      <Text style={styles.creator}>@{s.creator}</Text>
                      <Text style={styles.dot}>·</Text>
                      <Text style={styles.publishDate}>{formatDate(s.published_at)}</Text>
                    </View>
                  </View>
                  <View style={styles.installsPill}>
                    <Download size={11} color={theme.colors.accent} />
                    <Text style={styles.installsText}>{s.installs}</Text>
                  </View>
                </View>

                <Text style={styles.tagline}>{s.tagline}</Text>

                <View style={styles.legsRow}>
                  {s.legs.map((l, i) => (
                    <View key={i} style={styles.legPill}>
                      <Text
                        style={[
                          styles.legAction,
                          { color: l.action === "BUY" ? theme.colors.profit : theme.colors.loss },
                        ]}
                      >
                        {l.action[0]}
                      </Text>
                      <Text style={styles.legText}>
                        {l.type}
                        {l.type !== "FUT" ? ` ${l.offset >= 0 ? "+" : ""}${l.offset}` : ""}
                      </Text>
                    </View>
                  ))}
                </View>

                <TouchableOpacity
                  testID={`install-${s.id}`}
                  style={[styles.installBtn, isMine && styles.installBtnDisabled]}
                  onPress={() => install(s)}
                  disabled={isMine || installing === s.id}
                >
                  {installing === s.id ? (
                    <ActivityIndicator color={theme.colors.brand} />
                  ) : isMine ? (
                    <>
                      <TrendingUp size={14} color={theme.colors.textTertiary} />
                      <Text style={styles.installTextDisabled}>Your strategy</Text>
                    </>
                  ) : (
                    <>
                      <Download size={14} color={theme.colors.brand} />
                      <Text style={styles.installText}>Install to my library</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            );
          })
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
  iconBubble: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: "rgba(37,99,235,0.12)",
    alignItems: "center", justifyContent: "center",
  },
  title: { color: theme.colors.textPrimary, fontSize: 22, fontWeight: "800", letterSpacing: -0.3 },
  subtitle: { color: theme.colors.textTertiary, fontSize: 12, marginTop: 2 },
  empty: { alignItems: "center", padding: 40, gap: 10 },
  emptyTitle: { color: theme.colors.textPrimary, fontSize: 16, fontWeight: "700" },
  emptySub: { color: theme.colors.textTertiary, fontSize: 13, textAlign: "center", lineHeight: 20 },
  card: {
    padding: 14,
    backgroundColor: theme.colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  cardHead: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  cardName: { color: theme.colors.textPrimary, fontSize: 17, fontWeight: "700" },
  creatorRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  creator: { color: theme.colors.brand, fontSize: 12, fontWeight: "600" },
  dot: { color: theme.colors.textTertiary, fontSize: 12 },
  publishDate: { color: theme.colors.textTertiary, fontSize: 12 },
  installsPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "rgba(245,158,11,0.12)",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.accent,
  },
  installsText: { color: theme.colors.accent, fontSize: 11, fontWeight: "700" },
  tagline: { color: theme.colors.textSecondary, fontSize: 13, marginTop: 10 },
  legsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  legPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: theme.colors.bg,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  legAction: { fontSize: 11, fontWeight: "800" },
  legText: { color: theme.colors.textPrimary, fontSize: 11, fontWeight: "600" },
  installBtn: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "rgba(37,99,235,0.12)",
    borderWidth: 1,
    borderColor: theme.colors.brand,
  },
  installBtnDisabled: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
  },
  installText: { color: theme.colors.brand, fontSize: 13, fontWeight: "700" },
  installTextDisabled: { color: theme.colors.textTertiary, fontSize: 13, fontWeight: "600" },
});
