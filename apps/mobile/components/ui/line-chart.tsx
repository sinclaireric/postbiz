import { useState } from "react";
import { Text, View } from "react-native";
import Svg, { Circle, G, Line, Path, Text as SvgText } from "react-native-svg";

export type ChartPoint = { label: string; value: number };

/** Courbe simple (react-native-svg) : grille, axe vertical à gauche, quelques repères en bas, point sur le maximum. */
export function LineChart({ points, color = "#2F4A00", height = 190 }: { points: ChartPoint[]; color?: string; height?: number }) {
  const [width, setWidth] = useState(0);
  const padL = 30;
  const padR = 10;
  const padT = 12;
  const padB = 26;
  const max = Math.max(1, ...points.map((p) => p.value));
  // Axe vertical : valeurs entières, 4 graduations.
  const top = Math.max(4, Math.ceil(max / 4) * 4);
  const innerW = Math.max(1, width - padL - padR);
  const innerH = height - padT - padB;
  const x = (i: number) => padL + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / top) * innerH;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  const peakIndex = points.reduce((best, p, i) => (p.value > points[best].value ? i : best), 0);
  const ticks = [0, 1, 2, 3, 4].map((k) => (top / 4) * k);
  const labelIdx = points.length <= 5 ? points.map((_, i) => i) : [0, Math.round((points.length - 1) / 3), Math.round(((points.length - 1) * 2) / 3), points.length - 1];

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height }}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          {ticks.map((t) => (
            <G key={t}>
              <Line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke="#E7E5DF" strokeWidth={1} strokeDasharray={t === 0 ? undefined : "3 4"} />
              <SvgText x={padL - 8} y={y(t) + 4} fontSize={11} fill="#9A9890" textAnchor="end">
                {Number.isInteger(t) ? String(t) : t.toFixed(1)}
              </SvgText>
            </G>
          ))}
          {points.length > 0 ? <Path d={path} stroke={color} strokeWidth={3} fill="none" strokeLinejoin="round" strokeLinecap="round" /> : null}
          {points.length > 0 && max > 0 ? <Circle cx={x(peakIndex)} cy={y(points[peakIndex].value)} r={5} fill={color} stroke="#FFFFFF" strokeWidth={2} /> : null}
          {labelIdx.map((i) => (
            <SvgText key={i} x={x(i)} y={height - 6} fontSize={11} fill="#9A9890" textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}>
              {points[i]?.label}
            </SvgText>
          ))}
        </Svg>
      ) : (
        <Text />
      )}
    </View>
  );
}
