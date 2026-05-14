import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Path, Line, Circle, Text as SvgText, Defs, LinearGradient, Stop, Rect } from "react-native-svg";
import { theme } from "../theme";
import type { PayoffPointT } from "../api";

type Props = {
  points: PayoffPointT[];
  width?: number;
  height?: number;
  breakevens?: number[];
  currentSpot?: number;
};

export default function PayoffChart({
  points,
  width = 320,
  height = 200,
  breakevens = [],
  currentSpot,
}: Props) {
  if (!points.length) return <View style={{ width, height }} />;
  const padding = { l: 36, r: 12, t: 12, b: 24 };
  const innerW = width - padding.l - padding.r;
  const innerH = height - padding.t - padding.b;

  const xs = points.map((p) => p.spot);
  const ys = points.map((p) => p.pnl);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const yPad = (maxY - minY) * 0.1 || 1;
  const lo = minY - yPad;
  const hi = maxY + yPad;

  const sx = (x: number) => padding.l + ((x - minX) / (maxX - minX)) * innerW;
  const sy = (y: number) => padding.t + (1 - (y - lo) / (hi - lo)) * innerH;
  const zeroY = sy(0);

  // Build the line path
  let linePath = "";
  points.forEach((p, i) => {
    const cx = sx(p.spot);
    const cy = sy(p.pnl);
    linePath += i === 0 ? `M ${cx} ${cy}` : ` L ${cx} ${cy}`;
  });

  // Profit area (above 0)
  let profitArea = `M ${sx(minX)} ${zeroY}`;
  points.forEach((p) => {
    profitArea += ` L ${sx(p.spot)} ${sy(Math.max(p.pnl, 0))}`;
  });
  profitArea += ` L ${sx(maxX)} ${zeroY} Z`;

  // Loss area (below 0)
  let lossArea = `M ${sx(minX)} ${zeroY}`;
  points.forEach((p) => {
    lossArea += ` L ${sx(p.spot)} ${sy(Math.min(p.pnl, 0))}`;
  });
  lossArea += ` L ${sx(maxX)} ${zeroY} Z`;

  const fmt = (n: number) => {
    const abs = Math.abs(n);
    if (abs >= 1000) return `${n < 0 ? "-" : ""}${(abs / 1000).toFixed(1)}k`;
    return n.toFixed(0);
  };

  return (
    <View>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="prof" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={theme.colors.profit} stopOpacity={0.35} />
            <Stop offset="1" stopColor={theme.colors.profit} stopOpacity={0.0} />
          </LinearGradient>
          <LinearGradient id="loss" x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor={theme.colors.loss} stopOpacity={0.35} />
            <Stop offset="1" stopColor={theme.colors.loss} stopOpacity={0.0} />
          </LinearGradient>
        </Defs>

        {/* Plot bg */}
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

        {/* Area fills */}
        <Path d={profitArea} fill="url(#prof)" />
        <Path d={lossArea} fill="url(#loss)" />

        {/* Zero line */}
        <Line
          x1={padding.l}
          x2={padding.l + innerW}
          y1={zeroY}
          y2={zeroY}
          stroke={theme.colors.textTertiary}
          strokeDasharray="3 3"
          strokeWidth={1}
        />

        {/* Payoff line */}
        <Path d={linePath} stroke={theme.colors.brand} strokeWidth={2.5} fill="none" />

        {/* Breakevens */}
        {breakevens.map((be, i) => (
          <Line
            key={`be-${i}`}
            x1={sx(be)}
            x2={sx(be)}
            y1={padding.t}
            y2={padding.t + innerH}
            stroke={theme.colors.accent}
            strokeDasharray="2 4"
            strokeWidth={1}
          />
        ))}

        {/* Current spot marker */}
        {currentSpot !== undefined && currentSpot >= minX && currentSpot <= maxX && (
          <>
            <Line
              x1={sx(currentSpot)}
              x2={sx(currentSpot)}
              y1={padding.t}
              y2={padding.t + innerH}
              stroke={theme.colors.textSecondary}
              strokeWidth={1}
            />
            <Circle cx={sx(currentSpot)} cy={zeroY} r={4} fill={theme.colors.textPrimary} />
          </>
        )}

        {/* Y labels */}
        <SvgText x={padding.l - 4} y={sy(maxY) + 4} fontSize={9} fill={theme.colors.textTertiary} textAnchor="end">
          {fmt(maxY)}
        </SvgText>
        <SvgText x={padding.l - 4} y={zeroY + 3} fontSize={9} fill={theme.colors.textTertiary} textAnchor="end">
          0
        </SvgText>
        <SvgText x={padding.l - 4} y={sy(minY) + 4} fontSize={9} fill={theme.colors.textTertiary} textAnchor="end">
          {fmt(minY)}
        </SvgText>

        {/* X labels */}
        <SvgText
          x={padding.l}
          y={padding.t + innerH + 14}
          fontSize={9}
          fill={theme.colors.textTertiary}
        >
          {Math.round(minX)}
        </SvgText>
        <SvgText
          x={padding.l + innerW}
          y={padding.t + innerH + 14}
          fontSize={9}
          fill={theme.colors.textTertiary}
          textAnchor="end"
        >
          {Math.round(maxX)}
        </SvgText>
      </Svg>
      <Text style={styles.caption}>Profit / Loss at expiry (₹) vs Spot</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  caption: {
    color: theme.colors.textTertiary,
    fontSize: 10,
    textAlign: "center",
    marginTop: 4,
    letterSpacing: 0.3,
  },
});
