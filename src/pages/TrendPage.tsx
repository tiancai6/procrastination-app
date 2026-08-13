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
import { COLORS } from '../constants/reasons';
import LineChart, { ChartPoint } from '../components/LineChart';
import {
  getBodyProfileHistory,
  getAllDailyActivity,
  BodyProfileSnapshot,
  DailyActivity,
} from '../utils/storage';

// 运动类型稳定调色板（与运动日历保持一致）
const TYPE_PALETTE = ['#2563EB', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#EF4444', '#84CC16'];
const hashType = (t: string): string => {
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return TYPE_PALETTE[h % TYPE_PALETTE.length];
};

// 本地离线估算运动消耗（kcal），无需联网；仅用于趋势展示的兜底填充
const estKcalLocal = (type: string, min: number): number => {
  const t = type.toLowerCase();
  let rate = 6;
  if (t.includes('跑') || t.includes('骑') || t.includes('游') || t.includes('跳') || t.includes('球') || t.includes('hiit')) rate = 10;
  else if (t.includes('力量') || t.includes('瑜伽') || t.includes('拉伸') || t.includes('普拉提')) rate = 5;
  else if (t.includes('走') || t.includes('散步')) rate = 4;
  return Math.round(rate * min);
};

type Tab = 'body' | 'exercise';

interface TrendPageProps {
  visible: boolean;
  onClose: () => void;
}

const dLabel = (d: string) => (d.length >= 10 ? d.slice(5) : d); // YYYY-MM-DD -> MM-DD

const TrendPage: React.FC<TrendPageProps> = ({ visible, onClose }) => {
  const [tab, setTab] = useState<Tab>('body');
  const [loading, setLoading] = useState(false);
  const [body, setBody] = useState<BodyProfileSnapshot[]>([]);
  const [activity, setActivity] = useState<Record<string, DailyActivity>>({});

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    (async () => {
      setLoading(true);
      const [b, a] = await Promise.all([
        getBodyProfileHistory(),
        getAllDailyActivity(),
      ]);
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
  // 补齐缺失的 kcal：exKcal 没填时按类型/时长本地估算，让「消耗」曲线不再一片 0
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

  // 运动汇总（覆盖有记录的日期）
  const exTotalMin = exDuration.reduce((s, p) => s + p.value, 0);
  const exTotalKcal = exKcal.reduce((s, p) => s + p.value, 0);
  const exDays = exDates.filter((d) => (activity[d].exercises.length || 0) > 0).length;

  // 运动类型分布（累计时长，用于横向条形）
  const typeMinutes: Record<string, number> = {};
  exDates.forEach((d) => {
    activity[d].exercises.forEach((e) => {
      typeMinutes[e.type] = (typeMinutes[e.type] || 0) + (e.durationMin || 0);
    });
  });
  const typeRows = Object.entries(typeMinutes)
    .sort((a, b) => b[1] - a[1])
    .map(([type, min]) => ({ type, min }));
  const typeMax = typeRows.reduce((m, r) => Math.max(m, r.min), 0);

  // 身体成分（可选字段，有数据才画）
  const bodyFat: ChartPoint[] = body.map((s) => ({ label: dLabel(s.date), value: s.bodyFatPct || 0 }));
  const bodyMuscle: ChartPoint[] = body.map((s) => ({ label: dLabel(s.date), value: s.muscleMass || 0 }));
  const hasBodyFat = body.some((s) => s.bodyFatPct != null);
  const hasMuscle = body.some((s) => s.muscleMass != null);

  // —— 身体指标与运动记录（已移除手环健康数据） ——

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
      <ChartCard title="每日运动消耗 (kcal)" data={exKcal} color={COLORS.success} unit="kcal" />
      <ChartCard title="每日运动次数" data={exCount} color={COLORS.accent} unit="次" />

      {typeRows.length > 0 && (
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>运动类型分布（累计时长）</Text>
          {typeRows.map((r) => (
            <View key={r.type} style={styles.typeRow}>
              <Text style={styles.typeName}>{r.type}</Text>
              <View style={styles.typeBarTrack}>
                <View style={[styles.typeBar, { width: `${typeMax ? (r.min / typeMax) * 100 : 0}%`, backgroundColor: hashType(r.type) }]} />
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
        </View>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={COLORS.primary} />
          </View>
        ) : (
          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            {tab === 'body' && renderBody()}
            {tab === 'exercise' && renderExercise()}
            <View style={{ height: 40 }} />
          </ScrollView>
        )}
      </View>
    </Modal>
  );
};

const TabBtn: React.FC<{ label: string; active: boolean; onPress: () => void }> = ({
  label,
  active,
  onPress,
}) => (
  <TouchableOpacity style={[styles.tabBtn, active && styles.tabBtnActive]} onPress={onPress}>
    <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
  </TouchableOpacity>
);

const StatCard: React.FC<{ label: string; value: string; tone?: 'good' | 'warn' }> = ({
  label,
  value,
  tone,
}) => (
  <View style={styles.statCard}>
    <Text style={styles.statLabel}>{label}</Text>
    <Text style={[styles.statValue, tone === 'good' && styles.statGood, tone === 'warn' && styles.statWarn]}>
      {value}
    </Text>
  </View>
);

const ChartCard: React.FC<{
  title: string;
  data: ChartPoint[];
  color: string;
  unit?: string;
}> = ({ title, data, color, unit }) => (
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
  typeMin: { width: 38, textAlign: 'right', fontSize: 12, color: COLORS.textLight },
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
});

export default TrendPage;
