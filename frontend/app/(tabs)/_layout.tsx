import { Tabs } from "expo-router";
import { Home, LayoutGrid, Table, Briefcase, User } from "lucide-react-native";
import { theme } from "../../src/theme";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
          borderTopWidth: 1,
          height: 64,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarActiveTintColor: theme.colors.brand,
        tabBarInactiveTintColor: theme.colors.textTertiary,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => <Home color={color} size={size} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="strategies"
        options={{
          title: "Strategies",
          tabBarIcon: ({ color, size }) => <LayoutGrid color={color} size={size} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="chain"
        options={{
          title: "Chain",
          tabBarIcon: ({ color, size }) => <Table color={color} size={size} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="portfolio"
        options={{
          title: "Portfolio",
          tabBarIcon: ({ color, size }) => <Briefcase color={color} size={size} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => <User color={color} size={size} strokeWidth={2} />,
        }}
      />
    </Tabs>
  );
}
