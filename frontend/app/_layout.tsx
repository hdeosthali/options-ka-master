import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#09090B" } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="backtest" />
        <Stack.Screen name="alerts" />
        <Stack.Screen name="editor" />
        <Stack.Screen name="marketplace" />
        <Stack.Screen name="payment" options={{ presentation: "modal" }} />
      </Stack>
    </SafeAreaProvider>
  );
}
