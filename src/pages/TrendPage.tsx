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
  const exDuration: ChartPoint[] = exDates.map((d) => ({
    label: dLabel(d),
    value: activity[d].exercises.reduce((s, e) => s + (e.durationMin || 0), 0),
  }));
  const exKcal: ChartPoint[] = exDates.map((d) => ({
    label: dLabel(d),
    value: activity[d].exercises.reduce((s, e) => s + (e.kcal || 0), 0),
  }));
  const exCount: ChartPoint[] = exDates.map((d) => ({
    label: dLabel(d),
    value: activity[d].exercises.length,
  }));

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
      {body.length < 2 && (
        <Text style={styles.hint}>
          提示：每次在「身体信息」里保存，都会记录一条快照。多保存几次就能看到变化曲线。
        </Text>
      )}
    </View>
  );

  const renderExercise = () => (
    <View>
      <ChartCard title="每日运动时长 (分钟)" data={exDuration} color={COLORS.primary} unit="分钟" />
      <ChartCard title="每日运动消耗 (kcal)" data={exKcal} color={COLORS.success} unit="kcal" />
      <ChartCard title="每日运动次数" data={exCount} color={COLORS.accent} unit="次" />
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
