import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Crown, LogOut, Award, Check } from "lucide-react-native";
import { api, session, type UserT } from "../../src/api";
import { theme, formatINR } from "../../src/theme";

const PRO_BENEFITS = [
  "₹10,00,000 virtual capital",
  "Live AI strategy advisor (Claude)",
  "All advanced strategies unlocked",
  "Multi-leg auto-execution",
  "Priority option chain refresh",
  "Premium badges & XP boost",
];

export default function Profile() {
  const router = useRouter();
  const [user, setUser] = useState<UserT | null>(null);
  const [upgrading, setUpgrading] = useState(false);

  const load = useCallback(async () => {
    const u = await session.get();
    if (!u) {
      router.replace("/");
      return;
    }
    try {
      const usr = await api.getUser(u);
      setUser(usr);
    } catch {
      router.replace("/");
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const upgrade = async () => {
    if (!user) return;
    setUpgrading(true);
    try {
      const u = await api.upgrade(user.username);
      setUser(u);
      Alert.alert(
        "Welcome to PRO",
        "Your virtual capital is now ₹10,00,000 with 30 days of Pro access."
      );
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setUpgrading(false);
    }
  };

  const logout = async () => {
    Alert.alert("Sign Out", "End your session?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          await session.clear();
          router.replace("/");
        },
      },
    ]);
  };

  if (!user) {
    return (
      <View style={[styles.screen, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color={theme.colors.brand} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user.username[0]?.toUpperCase()}</Text>
          </View>
          <Text style={styles.username}>@{user.username}</Text>
          <View style={styles.levelRow}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{user.level}</Text>
              <Text style={styles.statLabel}>LEVEL</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{user.xp}</Text>
              <Text style={styles.statLabel}>XP</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{user.streak}</Text>
              <Text style={styles.statLabel}>STREAK</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{formatINR(user.capital)}</Text>
              <Text style={styles.statLabel}>CAPITAL</Text>
            </View>
          </View>
        </View>

        {/* Pro Card */}
        {user.is_pro ? (
          <View style={[styles.proCard, styles.proActive]}>
            <Crown size={28} color={theme.colors.accent} fill={theme.colors.accent} />
            <Text style={styles.proActiveTitle}>You're a PRO member</Text>
            <Text style={styles.proActiveSub}>
              {user.pro_days_left} days remaining
            </Text>
          </View>
        ) : (
          <View style={styles.proCard}>
            <Image
              source={{
                uri: "https://images.unsplash.com/photo-1760902419069-466f6f82c8b2?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2NzB8MHwxfHNlYXJjaHwxfHxjcmVkaXQlMjBjYXJkJTIwYmxhY2slMjBwcmVtaXVtJTIwM2R8ZW58MHx8fHwxNzc4NzMzMDU3fDA&ixlib=rb-4.1.0&q=85",
              }}
              style={styles.proImage}
              resizeMode="cover"
            />
            <View style={styles.proOverlay} />
            <View style={styles.proContent}>
              <View style={styles.proBadge}>
                <Crown size={12} color="#000" fill="#000" />
                <Text style={styles.proBadgeText}>OPTIONS MASTER PRO</Text>
              </View>
              <Text style={styles.proTitle}>Unlock 10x{"\n"}your virtual capital</Text>
              <Text style={styles.proPrice}>₹0 / 30 days · Free preview</Text>

              <View style={styles.benefits}>
                {PRO_BENEFITS.map((b, i) => (
                  <View key={i} style={styles.benefit}>
                    <Check size={14} color={theme.colors.profit} strokeWidth={3} />
                    <Text style={styles.benefitText}>{b}</Text>
                  </View>
                ))}
              </View>

              <TouchableOpacity
                testID="upgrade-pro-btn"
                style={styles.upgradeBtn}
                onPress={upgrade}
                disabled={upgrading}
              >
                {upgrading ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <Text style={styles.upgradeBtnText}>Activate Pro</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Badges */}
        <Text style={styles.sectionTitle}>Achievements</Text>
        {user.badges.length === 0 ? (
          <View style={styles.emptyBadges}>
            <Award size={32} color={theme.colors.textTertiary} strokeWidth={1.5} />
            <Text style={styles.emptyBadgesText}>
              Place trades and claim rewards to earn badges.
            </Text>
          </View>
        ) : (
          <View style={styles.badgeGrid}>
            {user.badges.map((b) => (
              <View key={b} style={styles.badgePill}>
                <Award size={14} color={theme.colors.accent} />
                <Text style={styles.badgeText}>{b}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Settings */}
        <Text style={styles.sectionTitle}>Account</Text>
        <TouchableOpacity testID="logout-btn" style={styles.settingRow} onPress={logout}>
          <LogOut size={18} color={theme.colors.loss} />
          <Text style={[styles.settingText, { color: theme.colors.loss }]}>Sign Out</Text>
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          Educational paper-trading platform.{"\n"}Not real money. Not SEBI registered investment advice.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  header: { alignItems: "center", paddingTop: 16, paddingBottom: 20, paddingHorizontal: 16 },
  avatar: {
    width: 80, height: 80, borderRadius: 999,
    backgroundColor: theme.colors.brand,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { color: "#fff", fontSize: 32, fontWeight: "800" },
  username: { color: theme.colors.textPrimary, fontSize: 20, fontWeight: "700", marginTop: 12 },
  levelRow: { flexDirection: "row", gap: 8, marginTop: 18, width: "100%" },
  statBox: {
    flex: 1,
    padding: 10,
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
    borderWidth: 1, borderColor: theme.colors.border,
    alignItems: "center",
  },
  statValue: { color: theme.colors.textPrimary, fontSize: 14, fontWeight: "700" },
  statLabel: { color: theme.colors.textTertiary, fontSize: 9, fontWeight: "700", marginTop: 2, letterSpacing: 0.5 },
  proCard: {
    marginHorizontal: 16,
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.colors.border,
    minHeight: 200,
    position: "relative",
  },
  proActive: {
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    backgroundColor: theme.colors.surface,
    minHeight: 140,
  },
  proActiveTitle: { color: theme.colors.textPrimary, fontSize: 18, fontWeight: "700", marginTop: 10 },
  proActiveSub: { color: theme.colors.textSecondary, fontSize: 13, marginTop: 4 },
  proImage: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  proOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(9,9,11,0.7)" },
  proContent: { padding: 20 },
  proBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    backgroundColor: theme.colors.accent,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  proBadgeText: { color: "#000", fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  proTitle: {
    color: "#fff",
    fontSize: 26,
    fontWeight: "800",
    marginTop: 12,
    letterSpacing: -0.5,
    lineHeight: 32,
  },
  proPrice: { color: theme.colors.textSecondary, fontSize: 13, marginTop: 6 },
  benefits: { marginTop: 18, gap: 8 },
  benefit: { flexDirection: "row", alignItems: "center", gap: 8 },
  benefitText: { color: "#FAFAFA", fontSize: 13 },
  upgradeBtn: {
    marginTop: 20,
    backgroundColor: theme.colors.accent,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  upgradeBtnText: { color: "#000", fontSize: 15, fontWeight: "800" },
  sectionTitle: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
    paddingHorizontal: 20,
    marginTop: 24,
    marginBottom: 12,
  },
  badgeGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 16, gap: 8 },
  badgePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(245,158,11,0.08)",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.accent,
  },
  badgeText: { color: theme.colors.accent, fontSize: 12, fontWeight: "600" },
  emptyBadges: {
    marginHorizontal: 16,
    padding: 24,
    backgroundColor: theme.colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    gap: 10,
  },
  emptyBadgesText: { color: theme.colors.textTertiary, fontSize: 13, textAlign: "center" },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  settingText: { fontSize: 14, fontWeight: "600" },
  disclaimer: {
    color: theme.colors.textTertiary,
    fontSize: 11,
    textAlign: "center",
    marginTop: 28,
    paddingHorizontal: 24,
    lineHeight: 16,
  },
});
