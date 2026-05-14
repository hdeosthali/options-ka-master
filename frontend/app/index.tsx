import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Image,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { TrendingUp, ShieldCheck, Sparkles } from "lucide-react-native";
import { api, session } from "../src/api";
import { theme } from "../src/theme";

export default function Login() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [bootChecking, setBootChecking] = useState(true);

  useEffect(() => {
    (async () => {
      const saved = await session.get();
      if (saved) {
        router.replace("/(tabs)");
      } else {
        setBootChecking(false);
      }
    })();
  }, []);

  const handleLogin = async () => {
    const cleaned = username.trim().toLowerCase();
    if (cleaned.length < 3) {
      Alert.alert("Invalid username", "Use at least 3 characters.");
      return;
    }
    setLoading(true);
    try {
      await api.login(cleaned);
      await session.set(cleaned);
      router.replace("/(tabs)");
    } catch (e: any) {
      Alert.alert("Login failed", e.message || "Try again");
    } finally {
      setLoading(false);
    }
  };

  if (bootChecking) {
    return (
      <View style={[styles.container, { justifyContent: "center" }]}>
        <ActivityIndicator color={theme.colors.brand} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <View style={styles.hero}>
          <Image
            source={{
              uri: "https://images.unsplash.com/photo-1651341050677-24dba59ce0fd?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDk1ODF8MHwxfHNlYXJjaHwzfHxhYnN0cmFjdCUyMHN0b2NrJTIwbWFya2V0JTIwZ3JhcGglMjBkYXJrfGVufDB8fHx8MTc3ODczMzAzN3ww&ixlib=rb-4.1.0&q=85",
            }}
            style={styles.heroImage}
            resizeMode="cover"
          />
          <View style={styles.heroOverlay} />
          <View style={styles.heroContent}>
            <View style={styles.brandPill}>
              <TrendingUp size={14} color={theme.colors.brand} strokeWidth={2.5} />
              <Text style={styles.brandPillText}>OPTIONS MASTER</Text>
            </View>
            <Text style={styles.title}>Trade options.{"\n"}Zero risk.</Text>
            <Text style={styles.subtitle}>
              Practice multi-leg Nifty/BankNifty strategies on paper money.
              Replicate winners on your real broker.
            </Text>
          </View>
        </View>

        <View style={styles.formCard}>
          <Text style={styles.label}>USERNAME</Text>
          <TextInput
            testID="login-username-input"
            value={username}
            onChangeText={setUsername}
            placeholder="e.g. rohit_trader"
            placeholderTextColor={theme.colors.textTertiary}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={handleLogin}
          />
          <TouchableOpacity
            testID="login-submit-btn"
            style={styles.primaryBtn}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>Start Paper Trading</Text>
            )}
          </TouchableOpacity>

          <View style={styles.featuresRow}>
            <Feature icon={<ShieldCheck size={16} color={theme.colors.profit} />} label="Zero Risk" />
            <Feature icon={<Sparkles size={16} color={theme.colors.accent} />} label="AI Advisor" />
            <Feature icon={<TrendingUp size={16} color={theme.colors.brand} />} label="Real Data" />
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const Feature = ({ icon, label }: { icon: React.ReactNode; label: string }) => (
  <View style={styles.feature}>
    {icon}
    <Text style={styles.featureText}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg },
  hero: { height: 340, position: "relative" },
  heroImage: { width: "100%", height: "100%" },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(9,9,11,0.55)",
  },
  heroContent: {
    position: "absolute",
    bottom: 24,
    left: 20,
    right: 20,
  },
  brandPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(37,99,235,0.15)",
    borderColor: theme.colors.brand,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    alignSelf: "flex-start",
    marginBottom: 14,
  },
  brandPillText: {
    color: theme.colors.brand,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: 36,
    fontWeight: "800",
    letterSpacing: -0.8,
    lineHeight: 42,
  },
  subtitle: {
    color: theme.colors.textSecondary,
    fontSize: 15,
    marginTop: 10,
    lineHeight: 22,
  },
  formCard: {
    margin: 20,
    padding: 20,
    backgroundColor: theme.colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  label: {
    color: theme.colors.textTertiary,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: 8,
  },
  input: {
    backgroundColor: theme.colors.bg,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: theme.colors.textPrimary,
    fontSize: 16,
    marginBottom: 16,
  },
  primaryBtn: {
    backgroundColor: theme.colors.brand,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  primaryBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  featuresRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 18,
  },
  feature: { flexDirection: "row", alignItems: "center", gap: 6 },
  featureText: { color: theme.colors.textSecondary, fontSize: 13 },
});
