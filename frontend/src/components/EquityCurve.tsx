import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Path, Line, Defs, LinearGradient, Stop, Rect } from "react-native-svg";
import { theme } from "../theme";

type Props = {
  series: { date: string; equity: number }[];
  width?: number;
  height?: number;
};

export default function EquityCurve({ series, width = 320, height = 180 }: Props) {
  if (!series.length) return <View style={{ width, height }} />;
  const padding = { l: 36, r: 12, t: 12, b: 22 };
  const innerW = width - padding.l - padding.r;
  const innerH = height - padding.t - padding.b;
  const ys = series.map((p) => p.equity);
  const minY = Math.min(0, ...ys);
  const maxY = Math.max(0, ...ys);
  const span = maxY - minY || 1;

  const sx = (i: number) => padding.l + (i / (series.length - 1 || 1)) * innerW;
  const sy = (y: number) => padding.t + (1 - (y - minY) / span) * innerH;
  const zeroY = sy(0);

  let path = "";
  let area = `M ${sx(0)} ${zeroY}`;
  series.forEach((p, i) => {
    const x = sx(i);
    const y = sy(p.equity);
    path += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    area += ` L ${x} ${y}`;
  });
  area += ` L ${sx(series.length - 1)} ${zeroY} Z`;
  const finalEquity = series[series.length - 1].equity;
  const positive = finalEquity >= 0;
  const stroke = positive ? theme.colors.profit : theme.colors.loss;

  const fmt = (n: number) => {
    const abs = Math.abs(n);
    if (abs >= 1000) return `${n < 0 ? "-" : ""}${(abs / 1000).toFixed(1)}k`;
    return n.toFixed(0);
  };

  return (
    <View>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={stroke} stopOpacity={0.4} />
            <Stop offset="1" stopColor={stroke} stopOpacity={0.0} />
          </LinearGradient>
        </Defs>
        <Rect
          x={padding.l}
          y={padding.t}
          width={innerW}
          height={innerH}
          fill={theme.colors.bg}
          stroke={theme.colors.border}
          strokeWidth={1}
          rx={8}
        />
        <Path d={area} fill="url(#eq)" />
        <Line
          x1={padding.l}
          x2={padding.l + innerW}
          y1={zeroY}
          y2={zeroY}
          stroke={theme.colors.textTertiary}
          strokeDasharray="3 3"
          strokeWidth={1}
        />
        <Path d={path} stroke={stroke} strokeWidth={2} fill="none" />
      </Svg>
      <View style={styles.legend}>
        <Text style={styles.legendItem}>Start ₹{fmt(0)}</Text>
        <Text style={[styles.legendItem, { color: stroke, fontWeight: "700" }]}>End ₹{fmt(finalEquity)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    marginTop: 4,
  },
  legendItem: { color: theme.colors.textTertiary, fontSize: 11 },
});
