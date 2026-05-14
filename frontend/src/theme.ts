// Centralized theme tokens for Options Master (Dark Mode, Swiss & High-Contrast)
export const theme = {
  colors: {
    bg: "#09090B",
    surface: "#18181B",
    surfaceElevated: "#27272A",
    border: "#27272A",
    borderSoft: "#2A2A2E",
    textPrimary: "#FAFAFA",
    textSecondary: "#A1A1AA",
    textTertiary: "#71717A",
    brand: "#2563EB",
    brandHover: "#3B82F6",
    accent: "#F59E0B",
    profit: "#10B981",
    profitBg: "rgba(16, 185, 129, 0.12)",
    loss: "#EF4444",
    lossBg: "rgba(239, 68, 68, 0.12)",
    info: "#3B82F6",
  },
  spacing: { s2: 8, s3: 12, s4: 16, s6: 24, s8: 32, s12: 48 },
  radius: { sm: 4, md: 8, lg: 12, xl: 16, xxl: 24 },
  font: {
    h1: { fontSize: 32, fontWeight: "800" as const, letterSpacing: -0.5 },
    h2: { fontSize: 24, fontWeight: "700" as const, letterSpacing: -0.3 },
    h3: { fontSize: 20, fontWeight: "600" as const },
    h4: { fontSize: 18, fontWeight: "600" as const },
    body: { fontSize: 16, fontWeight: "400" as const },
    small: { fontSize: 14, fontWeight: "500" as const },
    micro: { fontSize: 12, fontWeight: "500" as const, letterSpacing: 0.5 },
    mono: { fontFamily: "Courier" as const },
  },
};

export const formatINR = (n: number) => {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}₹${abs.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
};

export const formatPct = (n: number) =>
  `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
