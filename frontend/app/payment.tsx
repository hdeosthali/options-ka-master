import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { useRouter } from "expo-router";
import { X, ShieldCheck } from "lucide-react-native";
import { api, session } from "../src/api";
import { theme } from "../src/theme";

export default function PaymentScreen() {
  const router = useRouter();
  const [orderUrl, setOrderUrl] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usernameRef = useRef<string | null>(null);

  useEffect(() => {
    (async () => {
      const u = await session.get();
      if (!u) {
        router.replace("/");
        return;
      }
      usernameRef.current = u;
      try {
        const order = await api.createOrder(u);
        setOrderId(order.order_id);
        setOrderUrl(api.checkoutUrl(order.order_id));
      } catch (e: any) {
        setError(e.message || "Failed to create order");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleMessage = async (raw: string) => {
    let msg: any = null;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const u = usernameRef.current;
    if (!u || !orderId) return;

    if (msg.type === "dismissed") {
      Alert.alert("Payment cancelled", "You can try again anytime.");
      router.back();
      return;
    }
    if (msg.type === "failed") {
      Alert.alert("Payment failed", msg.data?.description || "Please try again.");
      router.back();
      return;
    }
    if (msg.type === "success") {
      setVerifying(true);
      try {
        await api.verifyPayment(
          u,
          msg.data.razorpay_order_id,
          msg.data.razorpay_payment_id,
          msg.data.razorpay_signature
        );
        Alert.alert("Welcome to PRO", "Capital boosted to ₹10,00,000 for 30 days.", [
          { text: "OK", onPress: () => router.replace("/(tabs)/profile") },
        ]);
      } catch (e: any) {
        Alert.alert("Verification failed", e.message || "Try again");
        router.back();
      } finally {
        setVerifying(false);
      }
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn} testID="payment-close-btn">
          <X size={20} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Activate Pro</Text>
        <View style={styles.secureBadge}>
          <ShieldCheck size={12} color={theme.colors.profit} />
          <Text style={styles.secureText}>Razorpay Secure</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.brand} size="large" />
          <Text style={styles.loadingText}>Preparing payment…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => router.back()}>
            <Text style={styles.retryText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      ) : orderUrl ? (
        <View style={{ flex: 1 }}>
          {Platform.OS === "web" ? (
            <iframe
              src={orderUrl}
              style={{ flex: 1, border: "none", width: "100%", height: "100%" } as any}
              title="Razorpay Checkout"
            />
          ) : (
            <WebView
              source={{ uri: orderUrl }}
              onMessage={(e) => handleMessage(e.nativeEvent.data)}
              javaScriptEnabled
              domStorageEnabled
              originWhitelist={["*"]}
              startInLoadingState
              renderLoading={() => (
                <View style={styles.center}>
                  <ActivityIndicator color={theme.colors.brand} />
                </View>
              )}
            />
          )}
        </View>
      ) : null}

      {verifying && (
        <View style={styles.verifyingOverlay}>
          <ActivityIndicator color={theme.colors.brand} size="large" />
          <Text style={styles.verifyingText}>Verifying payment…</Text>
        </View>
      )}

      {Platform.OS === "web" && !loading && (
        <View style={styles.webNotice}>
          <Text style={styles.webNoticeText}>
            On the device, payment completes via in-app WebView. On the web preview, use any Razorpay test card (e.g. 4111 1111 1111 1111, any CVV, any future date).
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: theme.colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    flex: 1,
    color: theme.colors.textPrimary,
    fontSize: 17,
    fontWeight: "700",
    marginLeft: 12,
  },
  secureBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: theme.colors.profitBg,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  secureText: { color: theme.colors.profit, fontSize: 10, fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { color: theme.colors.textSecondary, fontSize: 13 },
  errorText: { color: theme.colors.loss, fontSize: 14, textAlign: "center", paddingHorizontal: 24 },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: theme.colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  retryText: { color: theme.colors.textPrimary, fontSize: 14, fontWeight: "600" },
  verifyingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(9,9,11,0.85)",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
  },
  verifyingText: { color: theme.colors.textPrimary, fontSize: 14 },
  webNotice: {
    padding: 12,
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderColor: theme.colors.border,
  },
  webNoticeText: {
    color: theme.colors.textTertiary,
    fontSize: 11,
    textAlign: "center",
    lineHeight: 16,
  },
});
