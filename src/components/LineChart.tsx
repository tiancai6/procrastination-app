import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Svg, { Polyline, Line, Circle, Text as SvgText, Rect } from 'react-native-svg';

export interface ChartPoint {
  label: string; // x 轴标签（如日期 MM-DD）
  value: number;
}

interface LineChartProps {
  data: ChartPoint[];
  color?: string;
  unit?: string;
  height?: number;
  valueFormat?: (n: number) => string;
}

const PAD_L = 38;
const PAD_R = 12;
const PAD_T = 14;
const PAD_B = 26;

const LineChart: React.FC<LineChartProps> = ({
  data,
  color = '#1D4ED8',
  unit = '',
  height = 180,
  valueFormat,
}) => {
  const screenW = Dimensions.get('window').width;
  const width = Math.min(screenW - 32, 460);
  const fmt = valueFormat || ((n: number) => `${Math.round(n * 10) / 10}`);

  if (!data || data.length === 0) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.emptyText}>暂无数据</Text>
      </View>
    );
  }

  if (data.length === 1) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.emptyText}>至少需要 2 条记录才能画趋势</Text>
        <Text style={styles.emptySub}>
          当前：{fmt(data[0].value)}
          {unit ? ` ${unit}` : ''}（{data[0].label}）
        </Text>
      </View>
    );
  }

  const values = data.map((d) => d.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    // 所有值相等，给一点上下空间
    min -= 1;
    max += 1;
  }
  const range = max - min;
  const pad = range * 0.12;
  min -= pad;
  max += pad;
  if (min < 0 && Math.min(...values) >= 0) min = 0; // 非负指标不下探到负

  const plotW = width - PAD_L - PAD_R;
  const plotH = height - PAD_T - PAD_B;
  const xAt = (i: number) => PAD_L + (plotW * i) / (data.length - 1);
  const yAt = (v: number) => PAD_T + plotH * (1 - (v - min) / (max - min));

  const points = data.map((d, i) => `${xAt(i)},${yAt(d.value)}`).join(' ');

  // y 轴网格线（4 条）
  const gridVals = [0, 1, 2, 3].map((k) => min + ((max - min) * k) / 3);
  // x 轴标签：最多显示 5 个，避免拥挤
  const maxLabels = 5;
  const labelIdx = new Set<number>();
  if (data.length <= maxLabels) {
    data.forEach((_, i) => labelIdx.add(i));
  } else {
    for (let k = 0; k < maxLabels; k++) {
      labelIdx.add(Math.round((k * (data.length - 1)) / (maxLabels - 1)));
    }
  }

  return (
    <View style={{ width }}>
      <Svg width={width} height={height}>
        {/* 网格线 + y 轴标签 */}
        {gridVals.map((gv, k) => {
          const y = yAt(gv);
          return (
            <React.Fragment key={k}>
              <Line x1={PAD_L} y1={y} x2={width - PAD_R} y2={y} stroke="#EEE" strokeWidth={1} />
              <SvgText x={PAD_L - 6} y={y + 4} fontSize={10} fill="#9CA3AF" textAnchor="end">
                {fmt(gv)}
              </SvgText>
            </React.Fragment>
          );
        })}
        {/* 折线 */}
        <Polyline points={points} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {/* 数据点 */}
        {data.map((d, i) => (
          <Circle key={i} cx={xAt(i)} cy={yAt(d.value)} r={3} fill={color} />
        ))}
        {/* x 轴标签 */}
        {data.map((d, i) =>
          labelIdx.has(i) ? (
            <SvgText key={i} x={xAt(i)} y={height - 8} fontSize={10} fill="#9CA3AF" textAnchor="middle">
              {d.label}
            </SvgText>
          ) : null,
        )}
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
  },
  emptyText: { color: '#9CA3AF', fontSize: 13 },
  emptySub: { color: '#9CA3AF', fontSize: 11, marginTop: 6 },
});

export default LineChart;
