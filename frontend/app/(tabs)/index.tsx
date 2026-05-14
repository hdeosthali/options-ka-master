import { useCallback, useEffect, useState } from "react";
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
import {
  Sparkles,
  Flame,
  Gift,
  TrendingUp,
  TrendingDown,
  Zap,
  ChevronRight,
  Bell,
} from "lucide-react-native";
import {
  api,
  session,
  type UserT,
  type MarketSnapshotT,
  type PortfolioT,
  type StrategyT,
} from "../../src/api";
import { theme, formatINR, formatPct } from "../../src/theme";
import { registerForPushNotifications } from "../../src/push";

const regimeColor = (r: string) => {
  if (r === "BULLISH") return theme.colors.profit;
  if (r === "BEARISH") return theme.colors.loss;
  if (r === "VOLATILE") return theme.colors.accent;
  return theme.colors.info;
};

export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState<UserT | null>(null);
  const [market, setMarket] = useState<Record<string, MarketSnapshotT> | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioT | null>(null);
  const [advisor, setAdvisor] = useState<{ snapshot: MarketSnapshotT; strategy: StrategyT; explanation: string } | null>(null);
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadAll = useCallback(async () => {
    const u = await session.get();
    if (!u) {
      router.replace("/");
      return;
    }
    try {
      const [usr, snap, port] = await Promise.all([
        api.getUser(u),
        api.marketSnapshot(),
        api.portfolio(u),
      ]);
      setUser(usr);
      setMarket(snap);
      setPortfolio(port);
    } catch (e: any) {
      console.warn(e);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadAll();
    }, [loadAll])
  );

  useEffect(() => {
    (async () => {
      const u = await session.get();
      if (u) registerForPushNotifications(u);
    })();
  }, []);

  useEffect(() => {
    const id = setInterval(loadAll, 20000);
    return () => clearInterval(id);
  }, [loadAll]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  };

  const fetchAdvisor = async () => {
    if (!user) return;
    setAdvisorLoading(true);
    try {
      const data = await api.advisor(user.username, "NIFTY");
      setAdvisor(data);
    } catch (e: any) {
      Alert.alert("Advisor error", e.message);
    } finally {
      setAdvisorLoading(false);
    }
  };

  const claimReward = async () => {
    if (!user) return;
    try {
      const res = await api.dailyReward(user.username);
      Alert.alert(res.claimed ? "Reward Claimed" : "Already Claimed", res.message);
      setUser(res.user);
    } catch (e: any) {
      Alert.alert("Error", e.message);
    }
  };

  const applyRecommended = async () => {
    if (!user || !advisor) return;
    try {
      const trade = await api.applyStrategy(
        user.username,
        advisor.strategy.id,
        advisor.snapshot.symbol,
        1
      );
      Alert.alert(
        "Paper Trade Placed",
        `${trade.strategy_name} on ${trade.symbol}\n${trade.legs.length} legs executed.`
      );
      await loadAll();
    } catch (e: any) {
      Alert.alert("Trade failed", e.message);
    }
  };

  if (!user || !market || !portfolio) {
    return (
      <View style={[styles.screen, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color={theme.colors.brand} size="large" />
      </View>
    );
  }

  const totalPnl = portfolio.unrealized_pnl + portfolio.realized_pnl;
  const pnlPositive = totalPnl >= 0;

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.brand} />
        }
        testID="home-scroll"
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Namaste,</Text>
            <Text style={styles.username}>{user.username}</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <TouchableOpacity
              testID="open-alerts-btn"
              style={styles.bellBtn}
              onPress={() => router.push("/alerts")}
            >
              <Bell size={18} color={theme.colors.textPrimary} />
            </TouchableOpacity>
            <View style={styles.levelPill}>
              <Zap size={14} color={theme.colors.accent} fill={theme.colors.accent} />
              <Text style={styles.levelText}>LVL {user.level}</Text>
            </View>
          </View>
        </View>

        {/* Portfolio Card */}
        <View style={styles.portfolioCard} testID="portfolio-summary-card">
          <Text style={styles.cardLabel}>VIRTUAL CAPITAL</Text>
          <Text style={styles.capitalText}>{formatINR(portfolio.total_value)}</Text>
          <View style={styles.pnlRow}>
            <View
              style={[
                styles.pnlPill,
                { backgroundColor: pnlPositive ? theme.colors.profitBg : theme.colors.lossBg },
              ]}
            >
              {pnlPositive ? (
                <TrendingUp size={14} color={theme.colors.profit} />
              ) : (
                <TrendingDown size={14} color={theme.colors.loss} />
              )}
              <Text
                style={[
                  styles.pnlText,
                  { color: pnlPositive ? theme.colors.profit : theme.colors.loss },
                ]}
              >
                {formatINR(totalPnl)} total P&L
              </Text>
            </View>
            {user.is_pro && (
              <View style={styles.proBadge}>
                <Text style={styles.proBadgeText}>PRO</Text>
              </View>
            )}
          </View>
          <View style={styles.miniStats}>
            <MiniStat label="Open" value={String(portfolio.open_count)} />
            <MiniStat label="Closed" value={String(portfolio.closed_count)} />
            <MiniStat label="Win Rate" value={`${portfolio.win_rate}%`} />
          </View>
        </View>

        {/* Market Tickers */}
        <Text style={styles.sectionTitle}>Live Market</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
        >
          {Object.values(market).map((m) => (
            <View key={m.symbol} style={styles.tickerCard} testID={`ticker-${m.symbol}`}>
              <Text style={styles.tickerSym}>{m.name}</Text>
              <Text style={styles.tickerPrice}>₹{m.spot.toLocaleString("en-IN")}</Text>
              <View style={styles.tickerFooter}>
                <Text
                  style={[
                    styles.tickerChange,
                    { color: m.change >= 0 ? theme.colors.profit : theme.colors.loss },
                  ]}
                >
                  {formatPct(m.change_pct)}
                </Text>
                <View style={[styles.regimeDot, { backgroundColor: regimeColor(m.regime) }]} />
                <Text style={[styles.regimeLabel, { color: regimeColor(m.regime) }]}>
                  {m.regime.replace("_", " ")}
                </Text>
              </View>
              <Text style={styles.tickerIv}>IV {m.iv}%</Text>
            </View>
          ))}
        </ScrollView>

        {/* AI Advisor */}
        <View style={styles.advisorCard}>
          <View style={styles.advisorHeader}>
            <View style={styles.advisorIconWrap}>
              <Sparkles size={18} color={theme.colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.advisorTitle}>AI Strategy Advisor</Text>
              <Text style={styles.advisorSub}>
                Get today's best options play, explained by Claude.
              </Text>
            </View>
          </View>

          {advisor ? (
            <View style={{ marginTop: 14 }}>
              <View style={styles.recoBadge}>
                <Text style={styles.recoBadgeText}>RECOMMENDED</Text>
              </View>
              <Text style={styles.recoStrategy}>{advisor.strategy.name}</Text>
              <Text style={styles.recoTag}>{advisor.strategy.tagline}</Text>
              <View style={styles.divider} />
              <Text style={styles.advisorExplain} testID="advisor-explanation">
                {advisor.explanation}
              </Text>
              <TouchableOpacity
                testID="apply-recommended-btn"
                style={styles.primaryBtn}
                onPress={applyRecommended}
              >
                <Text style={styles.primaryBtnText}>Apply Strategy (1 lot)</Text>
                <ChevronRight size={18} color="#fff" />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              testID="get-advisor-btn"
              style={styles.advisorCta}
              onPress={fetchAdvisor}
              disabled={advisorLoading}
            >
              {advisorLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Sparkles size={16} color="#fff" />
                  <Text style={styles.advisorCtaText}>Get Today's Best Strategy</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* Gamification */}
        <Text style={styles.sectionTitle}>Your Progress</Text>
        <View style={styles.gameRow}>
          <View style={styles.gameCard}>
            <Flame size={20} color={theme.colors.accent} />
            <Text style={styles.gameValue}>{user.streak}</Text>
            <Text style={styles.gameLabel}>Day Streak</Text>
          </View>
          <View style={styles.gameCard}>
            <Zap size={20} color={theme.colors.brand} />
            <Text style={styles.gameValue}>{user.xp}</Text>
            <Text style={styles.gameLabel}>Total XP</Text>
          </View>
          <View style={styles.gameCard}>
            <Gift size={20} color={theme.colors.profit} />
            <Text style={styles.gameValue}>{user.badges.length}</Text>
            <Text style={styles.gameLabel}>Badges</Text>
          </View>
        </View>

        <TouchableOpacity
          testID="claim-reward-btn"
          style={styles.rewardBtn}
          onPress={claimReward}
        >
          <Gift size={18} color={theme.colors.accent} />
          <Text style={styles.rewardBtnText}>Claim Daily Reward (+50 XP)</Text>
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          Educational paper-trading tool. Not real money. Not SEBI registered advice.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const MiniStat = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.miniStat}>
    <Text style={styles.miniStatValue}>{value}</Text>
    <Text style={styles.miniStatLabel}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  greeting: { color: theme.colors.textTertiary, fontSize: 13, letterSpacing: 0.5 },
  username: { color: theme.colors.textPrimary, fontSize: 22, fontWeight: "700", marginTop: 2 },
  levelPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(245,158,11,0.12)",
    borderColor: theme.colors.accent,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  levelText: { color: theme.colors.accent, fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  bellBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  portfolioCard: {
    marginHorizontal: 16,
    padding: 20,
    borderRadius: 20,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  cardLabel: {
    color: theme.colors.textTertiary,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
  },
  capitalText: {
    color: theme.colors.textPrimary,
    fontSize: 32,
    fontWeight: "800",
    marginTop: 6,
    letterSpacing: -0.5,
  },
  pnlRow: { flexDirection: "row", alignItems: "center", marginTop: 10, gap: 8 },
  pnlPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  pnlText: { fontSize: 13, fontWeight: "600" },
  proBadge: {
    backgroundColor: theme.colors.accent,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  proBadgeText: { color: "#000", fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  miniStats: { flexDirection: "row", justifyContent: "space-between", marginTop: 18 },
  miniStat: { alignItems: "center", flex: 1 },
  miniStatValue: { color: theme.colors.textPrimary, fontSize: 18, fontWeight: "700" },
  miniStatLabel: {
    color: theme.colors.textTertiary,
    fontSize: 11,
    marginTop: 2,
    letterSpacing: 0.4,
  },
  sectionTitle: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
    paddingHorizontal: 20,
    marginTop: 24,
    marginBottom: 12,
  },
  tickerCard: {
    width: 160,
    padding: 14,
    backgroundColor: theme.colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  tickerSym: { color: theme.colors.textTertiary, fontSize: 11, fontWeight: "600", letterSpacing: 0.5 },
  tickerPrice: { color: theme.colors.textPrimary, fontSize: 18, fontWeight: "700", marginTop: 6 },
  tickerFooter: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  tickerChange: { fontSize: 13, fontWeight: "600" },
  regimeDot: { width: 6, height: 6, borderRadius: 999, marginLeft: 4 },
  regimeLabel: { fontSize: 10, fontWeight: "600", letterSpacing: 0.3 },
  tickerIv: { color: theme.colors.textSecondary, fontSize: 11, marginTop: 6 },
  advisorCard: {
    marginHorizontal: 16,
    marginTop: 20,
    padding: 18,
    backgroundColor: theme.colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  advisorHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  advisorIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: "rgba(245,158,11,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  advisorTitle: { color: theme.colors.textPrimary, fontSize: 16, fontWeight: "700" },
  advisorSub: { color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 },
  advisorCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: theme.colors.brand,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 16,
  },
  advisorCtaText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  recoBadge: {
    alignSelf: "flex-start",
    backgroundColor: theme.colors.profitBg,
    borderColor: theme.colors.profit,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  recoBadgeText: {
    color: theme.colors.profit,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  recoStrategy: {
    color: theme.colors.textPrimary,
    fontSize: 22,
    fontWeight: "700",
    marginTop: 8,
  },
  recoTag: { color: theme.colors.textSecondary, fontSize: 13, marginTop: 2 },
  divider: { height: 1, backgroundColor: theme.colors.border, marginVertical: 12 },
  advisorExplain: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    lineHeight: 22,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: theme.colors.brand,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 16,
  },
  primaryBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  gameRow: { flexDirection: "row", gap: 12, paddingHorizontal: 16 },
  gameCard: {
    flex: 1,
    padding: 14,
    backgroundColor: theme.colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
  },
  gameValue: { color: theme.colors.textPrimary, fontSize: 22, fontWeight: "700", marginTop: 8 },
  gameLabel: { color: theme.colors.textTertiary, fontSize: 11, marginTop: 2, letterSpacing: 0.4 },
  rewardBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 14,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "rgba(245,158,11,0.1)",
    borderWidth: 1,
    borderColor: theme.colors.accent,
  },
  rewardBtnText: { color: theme.colors.accent, fontSize: 14, fontWeight: "700" },
  disclaimer: {
    color: theme.colors.textTertiary,
    fontSize: 11,
    textAlign: "center",
    paddingHorizontal: 24,
    marginTop: 20,
    lineHeight: 16,
  },
});
