import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { api } from "./api";

export async function registerForPushNotifications(username: string): Promise<string | null> {
  try {
    if (Platform.OS === "web") {
      // Expo Push doesn't deliver to web; fall back to in-app alerts list only.
      return null;
    }
    if (!Device.isDevice) {
      return null;
    }
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") {
      return null;
    }
    const tokenData = await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;
    if (token) {
      await api.registerPushToken(username, token, Platform.OS);
    }
    return token;
  } catch (e) {
    console.warn("push registration failed", e);
    return null;
  }
}
