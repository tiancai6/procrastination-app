import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { Svg, Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/reasons';
import LineChart, { ChartPoint } from '../components/LineChart';
import {
  getBodyProfileHistory,
  getAllDailyActivity,
  BodyProfileSnapshot,
  DailyActivity,
} from '../utils/storage';
import { getActiveConfig } from '../utils/modelConfig';
import { postChat } from '../utils/model';

// 运动类型稳定调色板（与运动页保持一致）
const TYPE_PALETTE = ['#2563EB', '#0EA5E9', '#6366F1', '#8B5CF6', '#EC4899', '#14B8A6', '#F59E0B', '#84CC16'];

// 训练时段
const TIME_SLOTS: { key: string; label: string }[] = [
  { key: 'morning', label: '晨' },
  { key: 'forenoon', label: '上午' },
  { key: 'afternoon', label: '下午' },
  { key: 'evening', label: '晚上' },
  { key: 'night', label: '夜' },
];

// 本地离线估算运动消耗（kcal），仅用于趋势展示兜底
const estKcalLocal = (type: string, min: number): number => {
  const t = type.toLowerCase();
  let rate = 6;
  if (t.includes('跑') || t.includes('骑') || t.includes('游') || t.includes('跳') || t.includes('球') || t.includes('hiit')) rate = 10;
  else if (t.includes('力量') || t.includes('瑜伽') || t.includes('拉伸') || t.includes('普拉提')) rate = 5;
  else if (t.includes('走') || t.includes('散步')) rate = 4;
  return Math.round(rate * min);
};

type Tab = 'body' | 'exercise' | 'slot';

interface TrendPageProps {
  visible: boolean;
  onClose: () => void;
}

const dLabel = (d: string) => (d.length >= 10 ? d.slice(5) : d); // YYYY-MM-DD -> MM-DD

// 类别占比环形图（SVG 实现）
const DonutChart: React.FC<{ segments: { label: string; value: number }[]; size?: number; thickness?: number }> = ({
  segments,
  size = 148,
  thickness = 22,
}) => {
  const cx = size / 2;
  const radius = (size - thickness) / 2;
  const circ = 2 * Math.PI * radius;
  const total = segments.reduce((s, d) => s + d.value, 0);
  let acc = 0;
  const colored = segments.filter((s) => s.value > 0);
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Circle cx={cx} cy={cx} r={radius} stroke={COLORS.border} strokeWidth={thickness} fill="none" />
      {total > 0 &&
        colored.map((s, i) => {
          const len = (s.value / total) * circ;
          const el = (
            <Circle
              key={s.label}
              cx={cx}
              cy={cx}
              r={radius}
              stroke={TYPE_PALETTE[i % TYPE_PALETTE.length]}
              strokeWidth={thickness}
              fill="none"
              strokeDasharray={`${len} ${circ - len}`}
              strokeDashoffset={-acc}
              rotation="-90"
              originX={cx}
              originY={cx}
            />
          );
          acc += len;
          return el;
        })}
    </Svg>
  );
};

const EXERCISE_AI_PROMPT = `你是专业的健身与身体管理教练。用户给你一份已脱敏的运动与身体数据摘要（仅含数字，无个人身份信息）。
请基于这些数据，用中文输出一份亲切、有数据支撑的分析与可执行建议，结构如下（用换行分段，不要输出 JSON）：
一、整体运动情况（训练频率、总时长、消耗是否达标）
二、训练结构点评（各类别占比是否合理，力量/有氧/柔韧是否均衡）
三、身体趋势点评（体重/体脂/肌肉变化方向与速度，是否正常）
四、下周具体建议（3-5 条，具体到「练什么、练几次、每次多久」）
要求：语气鼓励、不评判；结论必须有数据支撑；不要编造摘要里没有的信息；总长度控制在 400 字以内。`;

const TrendPage: React.FC<TrendPageProps> = ({ visible, onClose }) => {
  const [tab, setTab] = useState<Tab>('body');
  const [loading, setLoading] = useState(false);
  const [body, setBody] = useState<BodyProfileSnapshot[]>([]);
  const [activity, setActivity] = useState<Record<string, DailyActivity>>({});
  const [analysis, setAnalysis] = useState('');
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    (async () => {
      setLoading(true);
      const [b, a] = await Promise.all([getBodyProfileHistory(), getAllDailyActivity()]);
      if (!alive) return;
      setBody(b);
      setActivity(a);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [visible]);

  // —— 身体指标 ——
  const bodyWeight: ChartPoint[] = body.map((s) => ({ label: dLabel(s.date), value: s.weight }));
  const bodyBmi: ChartPoint[] = body.map((s) => ({ label: dLabel(s.date), value: s.bmi }));
  const firstBody = body[0];
  const lastBody = body[body.length - 1];

  // —— 运动记录（按日期聚合）——
  const exDates = Object.keys(activity).sort();
  const exKcalFilled: Record<string, number> = {};
  exDates.forEach((d) => {
    let sum = 0;
    activity[d].exercises.forEach((e) => {
      sum += e.kcal && e.kcal > 0 ? e.kcal : estKcalLocal(e.type, e.durationMin || 0);
    });
    exKcalFilled[d] = sum;
  });
  const exDuration: ChartPoint[] = exDates.map((d) => ({
    label: dLabel(d),
    value: activity[d].exercises.reduce((s, e) => s + (e.durationMin || 0), 0),
  }));
  const exKcal: ChartPoint[] = exDates.map((d) => ({ label: dLabel(d), value: exKcalFilled[d] }));
  const exCount: ChartPoint[] = exDates.map((d) => ({
    label: dLabel(d),
    value: activity[d].exercises.length,
  }));

  const exTotalMin = exDuration.reduce((s, p) => s + p.value, 0);
  const exTotalKcal = exKcal.reduce((s, p) => s + p.value, 0);
  const exDays = exDates.filter((d) => (activity[d].exercises.length || 0) > 0).length;

  const typeMinutes: Record<string, number> = {};
  const slotMinutes: Record<string, number> = { morning: 0, forenoon: 0, afternoon: 0, evening: 0, night: 0 };
  exDates.forEach((d) => {
    activity[d].exercises.forEach((e) => {
      typeMinutes[e.type] = (typeMinutes[e.type] || 0) + (e.durationMin || 0);
      if (e.timeOfDay) slotMinutes[e.timeOfDay] = (slotMinutes[e.timeOfDay] || 0) + (e.durationMin || 0);
    });
  });
  const typeRows = Object.entries(typeMinutes)
    .sort((a, b) => b[1] - a[1])
    .map(([type, min]) => ({ type, min, pct: exTotalMin ? Math.round((min / exTotalMin) * 100) : 0 }));
  const typeMax = typeRows.reduce((m, r) => Math.max(m, r.min), 0);
  const slotTotal = Object.values(slotMinutes).reduce((s, v) => s + v, 0);
  const slotMax = Math.max(...Object.values(slotMinutes), 0);
  const favSlot = slotTotal > 0 ? TIME_SLOTS.reduce((a, b) => (slotMinutes[b.key] > slotMinutes[a.key] ? b : a)).label : '';

  const bodyFat: ChartPoint[] = body.map((s) => ({ label: dLabel(s.date), value: s.bodyFatPct || 0 }));
  const bodyMuscle: ChartPoint[] = body.map((s) => ({ label: dLabel(s.date), value: s.muscleMass || 0 }));
  const hasBodyFat = body.some((s) => s.bodyFatPct != null);
  const hasMuscle = body.some((s) => s.muscleMass != null);

  const fmtDur = (m: number): string => {
    const min = Math.max(0, Math.round(m));
    const h = Math.floor(min / 60);
    const mm = min % 60;
    return h > 0 ? `${h}:${String(mm).padStart(2, '0')}` : `${min}′`;
  };

  // —— AI 分析（页面最底部次要按钮）——
  const analyze = async () => {
    setAnalyzing(true);
    setAnalysis('');
    const cfg = await getActiveConfig(false);
    if (!cfg) {
      setAnalysis('未配置 AI 模型，请先到「我的 → 管理 AI 模型」添加模型。');
      setAnalyzing(false);
      return;
    }
    const summary: Record<string, unknown> = {
      训练天数: exDays,
      总时长分钟: exTotalMin,
      总消耗kcal: exTotalKcal,
      日均分钟: exDays ? Math.round(exTotalMin / exDays) : 0,
      类别时长占比: typeRows.map((r) => ({ 类型: r.type, 分钟: r.min, 占比: r.pct + '%' })),
      训练时段分钟: TIME_SLOTS.map((s) => ({ 时段: s.label, 分钟: slotMinutes[s.key] || 0 })),
      身体趋势:
        body.length > 0
          ? {
              记录条数: body.length,
              开始体重: firstBody?.weight,
              最新体重: lastBody?.weight,
              体重变化: ((lastBody?.weight ?? 0) - (firstBody?.weight ?? 0) >= 0 ? '+' : '') + Math.round(((lastBody?.weight ?? 0) - (firstBody?.weight ?? 0)) * 10) / 10 + 'kg',
              最新BMI: lastBody?.bmi,
              体脂率: hasBodyFat ? `${firstBody?.bodyFatPct}→${lastBody?.bodyFatPct}%` : '无数据',
              肌肉量: hasMuscle ? `${firstBody?.muscleMass}→${lastBody?.muscleMass}kg` : '无数据',
            }
          : '无身体数据',
    };
    try {
      const content = await postChat(
        cfg,
        [
          { role: 'system', content: EXERCISE_AI_PROMPT },
          { role: 'user', content: `以下是我的运动与身体数据摘要：\n${JSON.stringify(summary, null, 2)}\n请给我一份中文分析与建议。` },
        ],
        { temperature: 0.6, maxTokens: 1200 },
      );
      setAnalysis(content || '（AI 返回为空）');
    } catch (e: any) {
      setAnalysis('分析失败：' + (e?.message || '未知错误'));
    }
    setAnalyzing(false);
  };

  const renderBody = () => (
    <View>
      {firstBody && lastBody && (
        <View style={styles.statRow}>
          <StatCard label="当前体重" value={`${lastBody.weight} kg`} />
          <StatCard label="当前 BMI" value={`${lastBody.bmi}`} />
          <StatCard
            label="体重变化"
            value={`${lastBody.weight - firstBody.weight >= 0 ? '+' : ''}${Math.round((lastBody.weight - firstBody.weight) * 10) / 10} kg`}
            tone={lastBody.weight - firstBody.weight <= 0 ? 'good' : 'warn'}
          />
        </View>
      )}
      <ChartCard title="体重 (kg)" data={bodyWeight} color={COLORS.primary} unit="kg" />
      <ChartCard title="BMI" data={bodyBmi} color={COLORS.accent} />
      {hasBodyFat && <ChartCard title="体脂率 (%)" data={bodyFat} color="#F59E0B" unit="%" />}
      {hasMuscle && <ChartCard title="肌肉量 (kg)" data={bodyMuscle} color="#10B981" unit="kg" />}
      {body.length < 2 && (
        <Text style={styles.hint}>
          提示：每次在「身体信息」里保存，都会记录一条快照。多保存几次就能看到变化曲线。
        </Text>
      )}
    </View>
  );

  const renderExercise = () => (
    <View>
      {exDays > 0 && (
        <View style={styles.statRow}>
          <StatCard label="训练天数" value={`${exDays} 天`} />
          <StatCard label="总时长" value={`${exTotalMin} 分`} />
          <StatCard label="总消耗" value={`${exTotalKcal} kcal`} tone="good" />
        </View>
      )}
      <ChartCard title="每日运动时长 (分钟)" data={exDuration} color={COLORS.primary} unit="分钟" />
      <ChartCard title="每日运动消耗 (kcal)" data={exKcal} color={COLORS.primaryLight} unit="kcal" />
      <ChartCard title="每日运动次数" data={exCount} color={COLORS.accent} unit="次" />

      {typeRows.length > 0 && (
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>训练类别占比（环形图）</Text>
          <View style={styles.donutWrap}>
            <View style={styles.donutBox}>
              <DonutChart segments={typeRows.map((r) => ({ label: r.type, value: r.min }))} />
              <View style={styles.donutCenter}>
                <Text style={styles.donutCenterNum}>{fmtDur(exTotalMin)}</Text>
                <Text style={styles.donutCenterLabel}>总时长</Text>
              </View>
            </View>
            <View style={styles.donutLegend}>
              {typeRows.map((r, i) => (
                <View key={r.type} style={styles.legendRow}>
                  <View style={[styles.legendDot, { backgroundColor: TYPE_PALETTE[i % TYPE_PALETTE.length] }]} />
                  <Text style={styles.legendName}>{r.type}</Text>
                  <Text style={styles.legendPct}>{r.pct}%</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      )}

      {typeRows.length > 0 && (
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>运动类型分布（累计时长）</Text>
          {typeRows.map((r) => (
            <View key={r.type} style={styles.typeRow}>
              <Text style={styles.typeName}>{r.type}</Text>
              <View style={styles.typeBarTrack}>
                <View style={[styles.typeBar, { width: `${typeMax ? (r.min / typeMax) * 100 : 0}%`, backgroundColor: TYPE_PALETTE[typeRows.indexOf(r) % TYPE_PALETTE.length] }]} />
              </View>
              <Text style={styles.typeMin}>{r.min}′</Text>
            </View>
          ))}
        </View>
      )}

      {exDates.length === 0 && (
        <Text style={styles.hint}>还没有运动记录。在「今日活动量」里点「加运动记录」即可。</Text>
      )}
    </View>
  );

  const renderSlot = () => (
    <View>
      {slotTotal > 0 ? (
        <View>
          <View style={styles.statRow}>
            <StatCard label="带时段训练" value={`${fmtDur(slotTotal)}`} />
            <StatCard label="最常练时段" value={favSlot} />
            <StatCard label="训练天数" value={`${exDays} 天`} />
          </View>
          <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>训练时段分布（按具体时间）</Text>
            {TIME_SLOTS.map((s) => {
              const min = slotMinutes[s.key] || 0;
              return (
                <View key={s.key} style={styles.typeRow}>
                  <Text style={styles.typeName}>{s.label}</Text>
                  <View style={styles.typeBarTrack}>
                    <View style={[styles.typeBar, { width: `${slotMax ? (min / slotMax) * 100 : 0}%`, backgroundColor: COLORS.primaryLight }]} />
                  </View>
                  <Text style={styles.typeMin}>{min > 0 ? fmtDur(min) : '·'}</Text>
                </View>
              );
            })}
          </View>
          <Text style={styles.hint}>时段数据来自我在运动面板添加训练时选的「晨/上午/下午/晚上/夜」。</Text>
        </View>
      ) : (
        <Text style={styles.hint}>还没有带时段的训练记录。在「统计中心 → 运动」添加训练时选一下时段，这里就能看出你习惯什么时间练。</Text>
      )}
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.backBtn}>
            <Text style={styles.backText}>‹ 返回</Text>
          </TouchableOpacity>
          <Text style={styles.title}>健身与身体趋势</Text>
          <View style={styles.backBtn} />
        </View>

        <View style={styles.tabs}>
          <TabBtn label="身体指标" active={tab === 'body'} onPress={() => setTab('body')} />
          <TabBtn label="运动记录" active={tab === 'exercise'} onPress={() => setTab('exercise')} />
          <TabBtn label="训练时段" active={tab === 'slot'} onPress={() => setTab('slot')} />
        </View>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={COLORS.primary} />
          </View>
        ) : (
          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            {tab === 'body' && renderBody()}
            {tab === 'exercise' && renderExercise()}
            {tab === 'slot' && renderSlot()}

            {/* —— AI 分析：页面最底部次要按钮（先看原始数据） —— */}
            <View style={styles.aiBox}>
              <TouchableOpacity style={styles.aiBtnSecondary} onPress={analyze} disabled={analyzing}>
                {analyzing ? (
                  <ActivityIndicator size="small" color={COLORS.primary} />
                ) : (
                  <Ionicons name="sparkles-outline" size={16} color={COLORS.primary} />
                )}
                <Text style={styles.aiBtnSecondaryText}>{analyzing ? '分析中…' : analysis ? '重新分析' : 'AI 分析我的运动与身体趋势'}</Text>
              </TouchableOpacity>
              {analysis ? <Text style={styles.aiText}>{analysis}</Text> : null}
            </View>
            <View style={{ height: 40 }} />
          </ScrollView>
        )}
      </View>
    </Modal>
  );
};

const TabBtn: React.FC<{ label: string; active: boolean; onPress: () => void }> = ({ label, active, onPress }) => (
  <TouchableOpacity style={[styles.tabBtn, active && styles.tabBtnActive]} onPress={onPress}>
    <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
  </TouchableOpacity>
);

const StatCard: React.FC<{ label: string; value: string; tone?: 'good' | 'warn' }> = ({ label, value, tone }) => (
  <View style={styles.statCard}>
    <Text style={styles.statLabel}>{label}</Text>
    <Text style={[styles.statValue, tone === 'good' && styles.statGood, tone === 'warn' && styles.statWarn]}>{value}</Text>
  </View>
);

const ChartCard: React.FC<{ title: string; data: ChartPoint[]; color: string; unit?: string }> = ({ title, data, color, unit }) => (
  <View style={styles.chartCard}>
    <Text style={styles.chartTitle}>{title}</Text>
    <LineChart data={data} color={color} unit={unit} />
  </View>
);

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 48,
    paddingBottom: 10,
    paddingHorizontal: 16,
    backgroundColor: COLORS.card,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backBtn: { width: 64, alignItems: 'flex-start' },
  backText: { color: COLORS.primary, fontSize: 16 },
  title: { fontSize: 17, fontWeight: 'bold', color: COLORS.text },
  tabs: { flexDirection: 'row', backgroundColor: COLORS.card, paddingHorizontal: 8, paddingBottom: 8 },
  tabBtn: { flex: 1, paddingVertical: 8, marginHorizontal: 4, borderRadius: 10, backgroundColor: COLORS.background },
  tabBtnActive: { backgroundColor: COLORS.secondary },
  tabText: { textAlign: 'center', color: COLORS.textLight, fontSize: 13 },
  tabTextActive: { color: COLORS.primary, fontWeight: 'bold' },
  content: { flex: 1, padding: 16 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  chartCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chartTitle: { fontSize: 14, fontWeight: 'bold', color: COLORS.text, marginBottom: 8 },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  typeName: { width: 64, fontSize: 12.5, color: COLORS.text, fontWeight: '600' },
  typeBarTrack: { flex: 1, height: 14, backgroundColor: COLORS.background, borderRadius: 7, overflow: 'hidden' },
  typeBar: { height: '100%', borderRadius: 7, minWidth: 4 },
  typeMin: { width: 40, textAlign: 'right', fontSize: 12, color: COLORS.textLight },
  statRow: { flexDirection: 'row', marginBottom: 14 },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 12,
    marginRight: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statLabel: { fontSize: 11, color: COLORS.textLight },
  statValue: { fontSize: 17, fontWeight: 'bold', color: COLORS.text, marginTop: 4 },
  statGood: { color: COLORS.success },
  statWarn: { color: COLORS.warning },
  hint: { color: COLORS.textLight, fontSize: 12, lineHeight: 18, marginTop: 4, paddingHorizontal: 4 },

  donutWrap: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  donutBox: { position: 'relative', width: 148, height: 148 },
  donutCenter: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  donutCenterNum: { fontSize: 20, fontWeight: 'bold', color: COLORS.text },
  donutCenterLabel: { fontSize: 11, color: COLORS.textLight, marginTop: 2 },
  donutLegend: { flex: 1, gap: 8 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendName: { flex: 1, fontSize: 13, color: COLORS.text, fontWeight: '500' },
  legendPct: { fontSize: 13, fontWeight: '600', color: COLORS.textLight },

  aiBox: { marginTop: 6, marginBottom: 8 },
  aiBtnSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: COLORS.primary,
    backgroundColor: 'transparent',
  },
  aiBtnSecondaryText: { color: COLORS.primary, fontSize: 14, fontWeight: '600' },
  aiText: { fontSize: 13.5, color: COLORS.text, lineHeight: 22, marginTop: 12 },
});

export default TrendPage;
