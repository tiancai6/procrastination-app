import React, { useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { COLORS } from '../constants/reasons';
import { TOP_INSET } from '../constants/safeArea';
import { getAllRecords } from '../utils/storage';
import { calculateCategoryStats, calculateTimePatterns, generateInsights, convertTimeToActivities, formatDuration, formatDurationLong } from '../utils/analytics';
import { getAIInsights, hasApiKey, loadCachedInsight, AIInsightResult } from '../utils/ai';
import { ProcrastinationRecord } from '../types';
import PieChart from '../components/PieChart';
import { onDataReset } from '../utils/appEvents';

type TimeRange = 'day' | 'week' | 'month' | 'year';

const PortraitPage: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const navigation = useNavigation();
  const [timeRange, setTimeRange] = useState<TimeRange>('month');
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [records, setRecords] = useState<ProcrastinationRecord[]>([]);
  const [insights, setInsights] = useState({
    mostFrequentTimeRange: '',
    mostCommonReason: '',
    longestDurationReason: '',
    peakHours: [] as number[],
  });
  const [categoryStats, setCategoryStats] = useState<{ name: string; duration: number; count: number; percentage: number }[]>([]);
  const [trendData, setTrendData] = useState<{ label: string; duration: number }[]>([]);
  const [trendDimension, setTrendDimension] = useState<'hour' | 'weekday'>('weekday');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [tempDate, setTempDate] = useState<Date>(new Date());

  const [showActivityModal, setShowActivityModal] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<{ title: string; desc: string; icon: any; value: string; hint: string } | null>(null);

  const [aiInsight, setAiInsight] = useState<AIInsightResult | null>(null);
  const [aiStatus, setAiStatus] = useState<'idle' | 'loading' | 'done' | 'error' | 'disabled'>('idle');
  const [aiSource, setAiSource] = useState<'cache' | 'api' | 'none'>('none');

  useEffect(() => {
    loadRecords();
    // 清除/导入备份后全局通知重拉，确保画像与首页/统计同步
    const off = onDataReset(loadRecords);
    return off;
  }, [timeRange, currentDate, trendDimension]);

  const fetchAIInsights = async (
    period: TimeRange,
    recs: ProcrastinationRecord[],
    force = false,
  ) => {
    const hasKey = await hasApiKey();
    if (!hasKey || recs.length === 0) {
      setAiStatus('disabled');
      setAiInsight(null);
      return;
    }
    setAiStatus('loading');
    try {
      const { result, source } = await getAIInsights(period, recs, force);
      if (result) {
        setAiInsight(result);
        setAiSource(source);
        setAiStatus('done');
      } else {
        setAiInsight(null);
        setAiStatus('error');
      }
    } catch (e) {
      console.error('[AI] fetch failed', e);
      setAiInsight(null);
      setAiStatus('error');
    }
  };

  // 进入页面/切换周期时调用：只读缓存展示，不联网分析
  const loadAICache = async (
    period: TimeRange,
    recs: ProcrastinationRecord[],
  ) => {
    const hasKey = await hasApiKey();
    if (!hasKey || recs.length === 0) {
      setAiStatus('disabled');
      setAiInsight(null);
      return;
    }
    const cached = await loadCachedInsight(period);
    if (cached) {
      setAiInsight(cached);
      setAiSource('cache');
      setAiStatus('done');
    } else {
      setAiInsight(null);
      setAiStatus('idle');
    }
  };

  const getStartOfWeek = (date: Date): Date => {
    const d = new Date(date);
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  const filterByRange = (all: ProcrastinationRecord[], range: TimeRange, base: Date): ProcrastinationRecord[] => {
    switch (range) {
      case 'day':
        return all.filter(r => new Date(r.startTime).toDateString() === base.toDateString());
      case 'week': {
        const ws = getStartOfWeek(base);
        const we = new Date(ws);
        we.setDate(ws.getDate() + 7);
        return all.filter(r => r.startTime >= ws.getTime() && r.startTime < we.getTime());
      }
      case 'month': {
        const ms = new Date(base.getFullYear(), base.getMonth(), 1);
        const me = new Date(base.getFullYear(), base.getMonth() + 1, 1);
        return all.filter(r => r.startTime >= ms.getTime() && r.startTime < me.getTime());
      }
      case 'year': {
        const ys = new Date(base.getFullYear(), 0, 1);
        const ye = new Date(base.getFullYear() + 1, 0, 1);
        return all.filter(r => r.startTime >= ys.getTime() && r.startTime < ye.getTime());
      }
      default:
        return [];
    }
  };

  const calculateTrend = (recs: ProcrastinationRecord[], dimension: 'hour' | 'weekday') => {
    if (dimension === 'hour') {
      const hourMap = new Map<number, number>();
      for (let i = 0; i < 24; i++) hourMap.set(i, 0);
      recs.forEach(r => {
        const h = new Date(r.startTime).getHours();
        hourMap.set(h, (hourMap.get(h) || 0) + r.duration);
      });
      return Array.from(hourMap.entries()).map(([hour, duration]) => ({
        label: `${hour}:00`,
        duration,
      }));
    } else {
      const weekDays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
      const dayMap = new Map<number, number>();
      for (let i = 0; i < 7; i++) dayMap.set(i, 0);
      recs.forEach(r => {
        const d = new Date(r.startTime).getDay();
        const adj = d === 0 ? 6 : d - 1;
        dayMap.set(adj, (dayMap.get(adj) || 0) + r.duration);
      });
      return Array.from(dayMap.entries()).map(([i, duration]) => ({
        label: weekDays[i],
        duration,
      }));
    }
  };

  const loadRecords = async () => {
    const all = await getAllRecords();
    const filtered = filterByRange(all, timeRange, currentDate);
    setRecords(filtered);
    setInsights(generateInsights(filtered));
    setCategoryStats(calculateCategoryStats(filtered));
    setTrendData(calculateTrend(filtered, trendDimension));
    await loadAICache(timeRange, filtered);
  };

  const navigatePeriod = (direction: 'prev' | 'next') => {
    const newDate = new Date(currentDate);
    switch (timeRange) {
      case 'day':
        newDate.setDate(newDate.getDate() + (direction === 'prev' ? -1 : 1));
        break;
      case 'week':
        newDate.setDate(newDate.getDate() + (direction === 'prev' ? -7 : 7));
        break;
      case 'month':
        newDate.setMonth(newDate.getMonth() + (direction === 'prev' ? -1 : 1));
        break;
      case 'year':
        newDate.setFullYear(newDate.getFullYear() + (direction === 'prev' ? -1 : 1));
        break;
    }
    setCurrentDate(newDate);
  };

  const goToCurrent = () => setCurrentDate(new Date());

  const openDatePicker = () => {
    setTempDate(new Date(currentDate));
    setShowDatePicker(true);
  };

  const onDateChange = (event: any, date?: Date) => {
    if (date) setTempDate(date);
    if (Platform.OS === 'android') {
      if (event.type === 'set' && date) {
        setCurrentDate(date);
      }
      setShowDatePicker(false);
    }
  };

  const getPeriodLabel = (): string => {
    switch (timeRange) {
      case 'day':
        return `${currentDate.getFullYear()}年${currentDate.getMonth() + 1}月${currentDate.getDate()}日`;
      case 'week': {
        const ws = getStartOfWeek(currentDate);
        const we = new Date(ws);
        we.setDate(ws.getDate() + 6);
        return `${ws.getMonth() + 1}月${ws.getDate()}日 - ${we.getMonth() + 1}月${we.getDate()}日`;
      }
      case 'month':
        return `${currentDate.getFullYear()}年${currentDate.getMonth() + 1}月`;
      case 'year':
        return `${currentDate.getFullYear()}年`;
      default:
        return '';
    }
  };

  const totalDuration = records.reduce((sum, r) => sum + r.duration, 0);
  const recordCount = records.length;
  const avgDuration = recordCount > 0 ? Math.round(totalDuration / recordCount) : 0;
  const longestDuration = records.length > 0 ? Math.max(...records.map(r => r.duration)) : 0;
  const divisor = timeRange === 'day' ? 1 : timeRange === 'week' ? 7 : timeRange === 'month' ? 30 : 365;
  const dailyAvg = Math.round(totalDuration / divisor);

  const timePatterns = calculateTimePatterns(records);
  const activities = convertTimeToActivities(totalDuration);

  const timeRanges: { value: TimeRange; label: string }[] = [
    { value: 'day', label: '日' },
    { value: 'week', label: '周' },
    { value: 'month', label: '月' },
    { value: 'year', label: '年' },
  ];

  const pieColors = ['#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#BFDBFE', '#DBEAFE'];
  const pieChartData = categoryStats.map((item, index) => ({
    name: item.name,
    percentage: item.percentage,
    color: pieColors[index % pieColors.length],
  }));

  const timeSlots = [
    { start: 0, end: 6, label: '凌晨' },
    { start: 6, end: 9, label: '早上' },
    { start: 9, end: 12, label: '上午' },
    { start: 12, end: 14, label: '中午' },
    { start: 14, end: 17, label: '下午' },
    { start: 17, end: 20, label: '傍晚' },
    { start: 20, end: 24, label: '晚上' },
  ];

  const getSlotDuration = (start: number, end: number) => {
    return timePatterns
      .filter(p => p.hour >= start && p.hour < end)
      .reduce((sum, p) => sum + p.duration, 0);
  };

  const maxSlotDuration = Math.max(...timeSlots.map(s => getSlotDuration(s.start, s.end)), 1);
  const topSlot = timeSlots.reduce((prev, curr) =>
    getSlotDuration(curr.start, curr.end) > getSlotDuration(prev.start, prev.end) ? curr : prev
  );

  return (
    <>
      <ScrollView style={[styles.container, embedded && { paddingTop: 0 }]}>
        <View style={[styles.header, embedded && { paddingTop: 8 }]}>
          {!embedded && <Text style={styles.title}>画像</Text>}
          <View style={styles.timeRangeButtons}>
            {timeRanges.map((range) => (
              <TouchableOpacity
                key={range.value}
                style={[styles.timeRangeButton, timeRange === range.value && styles.timeRangeButtonActive]}
                onPress={() => setTimeRange(range.value)}
              >
                <Text style={[styles.timeRangeButtonText, timeRange === range.value && styles.timeRangeButtonTextActive]}>{range.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.periodNavRow}>
            <TouchableOpacity style={styles.periodNavBtn} onPress={() => navigatePeriod('prev')}>
              <Ionicons name="chevron-back-outline" size={20} color={COLORS.text} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.periodNavLabelBtn} onPress={openDatePicker}>
              <Ionicons name="calendar-outline" size={16} color={COLORS.primary} />
              <Text style={styles.periodNavLabel}>{getPeriodLabel()}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.periodNavBtn} onPress={() => navigatePeriod('next')}>
              <Ionicons name="chevron-forward-outline" size={20} color={COLORS.text} />
            </TouchableOpacity>
          </View>
        </View>

        {/* AI 智能分析卡片 */}
        <View style={styles.aiCard}>
          <View style={styles.aiHeader}>
            <Ionicons name="sparkles" size={20} color={COLORS.primary} />
            <Text style={styles.aiTitle}>AI 智能分析</Text>
            {aiStatus === 'loading' && <Text style={styles.aiBadge}>分析中…</Text>}
            {aiStatus === 'done' && aiSource === 'cache' && <Text style={styles.aiBadgeCache}>缓存</Text>}
            {aiStatus === 'done' && aiSource === 'api' && <Text style={styles.aiBadgeFresh}>已更新</Text>}
          </View>

          {aiStatus === 'disabled' && (
            <View>
              <Text style={styles.aiHint}>
                未开启 AI 分析。在「我的 → AI 智能分析」填入 GLM API Key 后即可使用（仅上传匿名统计摘要，原始记录不出手机）。
              </Text>
              <TouchableOpacity style={styles.aiStartBtn} onPress={() => (navigation as any).navigate('settings')}>
                <Ionicons name="key-outline" size={16} color="#fff" />
                <Text style={styles.aiStartText}>去设置 API Key</Text>
              </TouchableOpacity>
            </View>
          )}

          {aiStatus === 'idle' && (
            <View>
              <Text style={styles.aiHint}>点击下方按钮，根据当前周期的匿名统计摘要生成 AI 洞察（仅上传统计数字，原始记录不出手机）。</Text>
              <TouchableOpacity
                style={styles.aiStartBtn}
                onPress={() => fetchAIInsights(timeRange, records, true)}
              >
                <Ionicons name="sparkles-outline" size={16} color="#fff" />
                <Text style={styles.aiStartText}>开始 AI 分析</Text>
              </TouchableOpacity>
            </View>
          )}

          {aiStatus === 'error' && (
            <View>
              <Text style={styles.aiHint}>AI 调用失败（网络或 Key 错误），已使用上方本地分析。</Text>
              <TouchableOpacity style={styles.aiRetry} onPress={() => fetchAIInsights(timeRange, records, true)}>
                <Text style={styles.aiRetryText}>重试</Text>
              </TouchableOpacity>
            </View>
          )}

          {aiStatus === 'loading' && (
            <View style={styles.aiLoadingRow}>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text style={styles.aiHint}>正在根据你的统计数据生成洞察…</Text>
            </View>
          )}

          {aiStatus === 'done' && aiInsight && (
            <View>
              {aiInsight.findings.length > 0 && (
                <View style={styles.aiBlock}>
                  <Text style={styles.aiBlockTitle}>核心发现</Text>
                  {aiInsight.findings.map((f, i) => (
                    <View key={`f-${i}`} style={styles.aiBulletRow}>
                      <Text style={styles.aiBullet}>•</Text>
                      <Text style={styles.aiBulletText}>{f}</Text>
                    </View>
                  ))}
                </View>
              )}

              {aiInsight.triggers.length > 0 && (
                <View style={styles.aiBlock}>
                  <Text style={styles.aiBlockTitle}>高风险时段</Text>
                  {aiInsight.triggers.map((t, i) => (
                    <View key={`t-${i}`} style={styles.aiTriggerRow}>
                      <Text style={styles.aiTriggerTime}>{t.时段}</Text>
                      <Text
                        style={[
                          styles.aiTriggerRisk,
                          t.风险 === '高' && styles.riskHigh,
                          t.风险 === '中' && styles.riskMid,
                        ]}
                      >
                        {t.风险}危
                      </Text>
                      <Text style={styles.aiTriggerReason}>{t.原因}</Text>
                    </View>
                  ))}
                </View>
              )}

              {aiInsight.suggestions.length > 0 && (
                <View style={styles.aiBlock}>
                  <Text style={styles.aiBlockTitle}>改善建议</Text>
                  {aiInsight.suggestions.map((s, i) => (
                    <View key={`s-${i}`} style={styles.aiBulletRow}>
                      <Text style={styles.aiBullet}>✓</Text>
                      <Text style={styles.aiBulletText}>{s}</Text>
                    </View>
                  ))}
                </View>
              )}

              <TouchableOpacity style={styles.aiRefresh} onPress={() => fetchAIInsights(timeRange, records, true)}>
                <Ionicons name="refresh-outline" size={14} color={COLORS.primary} />
                <Text style={styles.aiRefreshText}>重新分析</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={styles.statsCards}>
          <View style={styles.statCard}>
            <Ionicons name="time-outline" style={styles.statIcon} color={COLORS.primary} size={18} />
            <Text style={styles.statValue}>{formatDurationLong(totalDuration)}</Text>
            <Text style={styles.statLabel}>总时长</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="stats-chart-outline" style={styles.statIcon} color={COLORS.primary} size={18} />
            <Text style={styles.statValue}>{recordCount}</Text>
            <Text style={styles.statLabel}>次数</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="bar-chart-outline" style={styles.statIcon} color={COLORS.primary} size={18} />
            <Text style={styles.statValue}>{formatDurationLong(dailyAvg)}</Text>
            <Text style={styles.statLabel}>日均</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="flash-outline" style={styles.statIcon} color={COLORS.primary} size={18} />
            <Text style={styles.statValue}>{formatDurationLong(longestDuration)}</Text>
            <Text style={styles.statLabel}>最长</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>时间成本换算</Text>
          <View style={styles.activitiesGrid}>
            <TouchableOpacity
              style={styles.activityCard}
              activeOpacity={0.8}
              onPress={() => {
                setSelectedActivity({
                  icon: 'film-outline',
                  title: '电影',
                  desc: '每部按 120 分钟（2小时）计算',
                  value: `${activities.movies} 部`,
                  hint: '相当于你拖延的总时长可以看完这么多部电影，这些时间本可以用来享受一部好电影。',
                });
                setShowActivityModal(true);
              }}
            >
              <Ionicons name="film-outline" style={styles.activityIcon} color={COLORS.primary} size={24} />
              <Text style={styles.activityValue}>{activities.movies}</Text>
              <Text style={styles.activityLabel}>部电影</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.activityCard}
              activeOpacity={0.8}
              onPress={() => {
                setSelectedActivity({
                  icon: 'book-outline',
                  title: '书',
                  desc: '每本按 6 小时（360 分钟）阅读计算',
                  value: `${activities.books} 本`,
                  hint: '相当于你拖延的总时长可以读完这么多本书，这些时间本可以用来充实自己。',
                });
                setShowActivityModal(true);
              }}
            >
              <Ionicons name="book-outline" style={styles.activityIcon} color={COLORS.primary} size={24} />
              <Text style={styles.activityValue}>{activities.books}</Text>
              <Text style={styles.activityLabel}>本书</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.activityCard}
              activeOpacity={0.8}
              onPress={() => {
                setSelectedActivity({
                  icon: 'barbell',
                  title: '健身',
                  desc: '每次按 1 小时（60 分钟）计算',
                  value: `${activities.workouts} 次`,
                  hint: '相当于你拖延的总时长可以进行这么多次健身，这些时间本可以用来强健身体。',
                });
                setShowActivityModal(true);
              }}
            >
              <Ionicons name="barbell" style={styles.activityIcon} color={COLORS.primary} size={24} />
              <Text style={styles.activityValue}>{activities.workouts}</Text>
              <Text style={styles.activityLabel}>次健身</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.activityCard}
              activeOpacity={0.8}
              onPress={() => {
                setSelectedActivity({
                  icon: 'airplane-outline',
                  title: '旅行',
                  desc: '每天按 8 小时（480 分钟）计算',
                  value: `${activities.travels} 天`,
                  hint: '相当于你拖延的总时长可以进行这么多天旅行，这些时间本可以用来探索世界。',
                });
                setShowActivityModal(true);
              }}
            >
              <Ionicons name="airplane-outline" style={styles.activityIcon} color={COLORS.primary} size={24} />
              <Text style={styles.activityValue}>{activities.travels}</Text>
              <Text style={styles.activityLabel}>天旅行</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>拖延触发器</Text>
          <View style={styles.triggerCard}>
            <View style={styles.triggerHeader}>
              <Text style={styles.triggerNumber}>1</Text>
              <Text style={styles.triggerTitle}>{insights.mostFrequentTimeRange}是高发期</Text>
              <Text style={styles.triggerLevel}>中危</Text>
            </View>
            <Text style={styles.triggerDesc}>这个时段最容易拖延</Text>
            <View style={styles.tipRow}>
              <Ionicons name="bulb-outline" style={styles.tipIcon} color="#FF9800" size={14} />
              <Text style={styles.triggerTip}>把最重要的任务安排在精力最好的时段，避开这个陷阱时段</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>分类占比</Text>
          <View style={styles.categoryChartContainer}>
            <View style={styles.pieChartContainer}>
              {categoryStats.length > 0 ? (
                <PieChart data={pieChartData} size={90} strokeWidth={15} />
              ) : (
                <View style={styles.pieChartEmpty}>
                  <Text style={styles.pieEmptyText}>暂无数据</Text>
                </View>
              )}
              <View style={styles.pieCenter}>
                <Text style={styles.pieCenterValue}>{formatDuration(totalDuration)}</Text>
                <Text style={styles.pieCenterLabel}>合计</Text>
              </View>
            </View>
            <View style={styles.categoryList}>
              {categoryStats.map((item, index) => (
                <View key={item.name} style={styles.categoryItem}>
                  <View style={[styles.categoryDot, { backgroundColor: pieColors[index % pieColors.length] }]} />
                  <Text style={styles.categoryName}>{item.name}</Text>
                  <Text style={styles.categoryPercentage}>{item.percentage}%</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>拖延趋势</Text>
            <View style={styles.chartTypeButtons}>
              <TouchableOpacity
                style={[styles.chartTypeButton, trendDimension === 'hour' && styles.chartTypeButtonActive]}
                onPress={() => setTrendDimension('hour')}
              >
                <Text style={[styles.chartTypeButtonText, trendDimension === 'hour' && styles.chartTypeButtonTextActive]}>小时</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.chartTypeButton, trendDimension === 'weekday' && styles.chartTypeButtonActive]}
                onPress={() => setTrendDimension('weekday')}
              >
                <Text style={[styles.chartTypeButtonText, trendDimension === 'weekday' && styles.chartTypeButtonTextActive]}>按周</Text>
              </TouchableOpacity>
            </View>
          </View>
          {trendDimension === 'hour' ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hourChartScroll}>
              <View style={styles.hourChartContainer}>
                {trendData.map((item, index) => {
                  const maxDuration = Math.max(...trendData.map(d => d.duration), 1);
                  const heightPercent = (item.duration / maxDuration) * 100;
                  const isPeak = item.duration === maxDuration && item.duration > 0;
                  return (
                    <View key={index} style={styles.hourBarWrapper}>
                      <Text style={styles.hourBarValue}>{item.duration > 0 ? `${item.duration}m` : ''}</Text>
                      <View style={styles.hourBarTrack}>
                        <View
                          style={[
                            styles.hourBar,
                            { height: `${Math.max(heightPercent, 3)}%` },
                            isPeak && styles.hourBarPeak,
                          ]}
                        />
                      </View>
                      <Text style={[styles.hourBarLabel, isPeak && styles.hourBarLabelPeak]}>{item.label}</Text>
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          ) : (
            <View style={styles.chartContainer}>
              {trendData.map((item, index) => {
                const maxDuration = Math.max(...trendData.map(d => d.duration), 1);
                const heightPercent = (item.duration / maxDuration) * 100;
                return (
                  <View key={index} style={styles.chartBarWrapper}>
                    <View
                      style={[styles.chartBar, { height: `${Math.max(heightPercent, 5)}%` }]}
                    />
                    <Text style={styles.chartLabel}>{item.label}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>原因模式</Text>
          <View style={styles.reasonPatternCard}>
            <View style={styles.reasonList}>
              {categoryStats.slice(0, 3).map((item, index) => (
                <View key={item.name} style={styles.reasonItem}>
                  <Text style={styles.reasonName}>{item.name}</Text>
                  <View style={styles.reasonBarContainer}>
                    <View style={[styles.reasonBar, { width: `${item.percentage}%` }]} />
                  </View>
                  <Text style={styles.reasonPercentage}>{item.percentage}%</Text>
                </View>
              ))}
            </View>
            <Text style={styles.reasonPatternText}>
              「{insights.longestDurationReason}」是你拖延时间最长的原因，共 {formatDurationLong(categoryStats[0]?.duration || 0)}（{categoryStats[0]?.count || 0}次，平均每次{Math.round((categoryStats[0]?.duration || 0) / (categoryStats[0]?.count || 1))}m）。
            </Text>
            <View style={styles.tipRow}>
              <Ionicons name="bulb-outline" style={styles.tipIcon} color="#FF9800" size={14} />
              <Text style={styles.reasonPatternTip}>先休息5分钟再回来，别硬撑着耗时间。</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>时段分布</Text>
          <View style={styles.timeSlotCard}>
            <Text style={styles.timeSlotText}>
              你在{topSlot.label}的拖延时间最长，共 {formatDurationLong(getSlotDuration(topSlot.start, topSlot.end))}。
            </Text>
            <View style={styles.tipRow}>
              <Ionicons name="bulb-outline" style={styles.tipIcon} color="#FF9800" size={14} />
              <Text style={styles.timeSlotTip}>{topSlot.label}容易犯困？试试15分钟的小憩再开工。</Text>
            </View>
            <View style={styles.timeSlotChart}>
              {timeSlots.map((slot) => (
                <View key={slot.label} style={styles.timeSlotItem}>
                  <View style={[styles.timeSlotBar, { height: `${(getSlotDuration(slot.start, slot.end) / maxSlotDuration) * 100}%` }]} />
                  <Text style={styles.timeSlotLabel}>{slot.label}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>单次时长</Text>
          <View style={styles.durationCard}>
            <Text style={styles.durationText}>
              平均每次{avgDuration}分钟，中位数{Math.round(totalDuration / recordCount)}分钟，最长{longestDuration}分钟，最短{records.length > 0 ? Math.min(...records.map(r => r.duration)) : 0}分钟。
            </Text>
            <View style={styles.tipRow}>
              <Ionicons name="bulb-outline" style={styles.tipIcon} color="#FF9800" size={14} />
              <Text style={styles.durationTip}>中等时长的拖延为主，试试番茄工作法，25分钟专注+5分钟休息。最长的{longestDuration}分钟拖延远超平时，留意是不是某类任务特别容易陷进去。</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      <Modal
        visible={showActivityModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowActivityModal(false)}
      >
        <TouchableOpacity
          style={styles.activityModalOverlay}
          activeOpacity={1}
          onPress={() => setShowActivityModal(false)}
        >
          <View style={styles.activityModalContent}>
            <View style={styles.activityModalHeader}>
              <Ionicons name={selectedActivity?.icon} size={32} color={COLORS.primary} />
              <Text style={styles.activityModalTitle}>{selectedActivity?.title}</Text>
            </View>
            <Text style={styles.activityModalDesc}>{selectedActivity?.desc}</Text>
            <View style={styles.activityModalValueRow}>
              <Text style={styles.activityModalValue}>{selectedActivity?.value}</Text>
            </View>
            <Text style={styles.activityModalHint}>{selectedActivity?.hint}</Text>
            <TouchableOpacity
              style={styles.activityModalCloseBtn}
              onPress={() => setShowActivityModal(false)}
            >
              <Text style={styles.activityModalCloseText}>知道了</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 日期选择器移出 ScrollView，避免 VirtualizedList 嵌套告警 */}
      {showDatePicker && Platform.OS === 'android' && (
        <DateTimePicker
          value={tempDate}
          mode="date"
          display="default"
          onChange={onDateChange}
        />
      )}
      <Modal
        visible={showDatePicker && Platform.OS === 'ios'}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowDatePicker(false)}
      >
        <View style={styles.iosDatePickerOverlay}>
          <View style={styles.iosDatePickerSheet}>
            <View style={styles.iosDatePickerHeader}>
              <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                <Text style={styles.iosDatePickerCancel}>取消</Text>
              </TouchableOpacity>
              <Text style={styles.iosDatePickerTitle}>选择日期</Text>
              <TouchableOpacity onPress={() => { setCurrentDate(tempDate); setShowDatePicker(false); }}>
                <Text style={styles.iosDatePickerConfirm}>确定</Text>
              </TouchableOpacity>
            </View>
            <DateTimePicker
              value={tempDate}
              mode="date"
              display="spinner"
              onChange={onDateChange}
              textColor={COLORS.text}
              style={styles.iosDatePicker}
            />
          </View>
        </View>
      </Modal>
    </>
  );
};

const cardShadow = {
  shadowColor: COLORS.shadow,
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 8,
  elevation: 2,
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingTop: TOP_INSET,
  },
  header: {
    padding: 20,
        paddingTop: 30,
      },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 16,
  },
  timeRangeButtons: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: COLORS.card,
    padding: 4,
    borderRadius: 20,
    ...cardShadow,
  },
  timeRangeButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 16,
    alignItems: 'center',
  },
  timeRangeButtonActive: {
    backgroundColor: COLORS.primary,
  },
  timeRangeButtonText: {
    fontSize: 14,
    color: COLORS.textLight,
    fontWeight: '500',
  },
  timeRangeButtonTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  periodNavRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
    marginTop: 12,
  },
  periodNavBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  periodNavLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  periodNavLabelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  coreInsightCard: {
    marginHorizontal: 16,
    padding: 20,
    backgroundColor: COLORS.secondary,
    borderRadius: 16,
    marginBottom: 20,
    ...cardShadow,
  },
  insightIcon: {
    fontSize: 20,
    marginBottom: 8,
  },
  insightTitle: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '600',
    marginBottom: 8,
  },
  insightText: {
    fontSize: 16,
    color: COLORS.text,
    lineHeight: 24,
  },
  statsCards: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  statCard: {
    flex: 1,
    padding: 12,
    backgroundColor: COLORS.card,
    borderRadius: 16,
    alignItems: 'center',
    ...cardShadow,
  },
  statIcon: {
    fontSize: 18,
    marginBottom: 4,
    color: COLORS.primary,
  },
  statValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 10,
    color: COLORS.textLight,
  },
  section: {
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  activitiesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  activityCard: {
    width: '48%',
    padding: 16,
    backgroundColor: COLORS.card,
    borderRadius: 16,
    alignItems: 'center',
    ...cardShadow,
  },
  activityIcon: {
    fontSize: 24,
    marginBottom: 8,
    color: COLORS.primary,
  },
  activityValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 4,
  },
  activityLabel: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  triggerCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    ...cardShadow,
  },
  triggerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  triggerNumber: {
    width: 24,
    height: 24,
    borderRadius: '50%',
    backgroundColor: COLORS.primary,
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center',
    textAlignVertical: 'center',
  },
  triggerTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  triggerLevel: {
    fontSize: 12,
    color: COLORS.accent,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  triggerDesc: {
    fontSize: 14,
    color: COLORS.textLight,
    marginBottom: 8,
  },
  triggerTip: {
    fontSize: 13,
    color: COLORS.textLight,
    fontStyle: 'italic',
    flex: 1,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tipIcon: {
    marginTop: 2,
  },
  reasonPatternCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    ...cardShadow,
  },
  reasonList: {
    gap: 8,
    marginBottom: 12,
  },
  reasonItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  reasonName: {
    width: 60,
    fontSize: 14,
    color: COLORS.text,
  },
  reasonBarContainer: {
    flex: 1,
    height: 8,
    backgroundColor: COLORS.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  reasonBar: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 4,
  },
  reasonPercentage: {
    width: 40,
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'right',
  },
  reasonPatternText: {
    fontSize: 14,
    color: COLORS.text,
    marginBottom: 8,
  },
  reasonPatternTip: {
    fontSize: 13,
    color: COLORS.textLight,
    fontStyle: 'italic',
  },
  categoryChartContainer: {
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    gap: 16,
    ...cardShadow,
  },
  pieChartContainer: {
    width: 100,
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  pieCenter: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 50,
    height: 50,
    borderRadius: '50%',
    backgroundColor: COLORS.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pieCenterValue: {
    fontSize: 12,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  pieCenterLabel: {
    fontSize: 10,
    color: COLORS.textLight,
  },
  pieChartEmpty: {
    width: 90,
    height: 90,
    borderRadius: '50%',
    backgroundColor: COLORS.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pieEmptyText: {
    fontSize: 10,
    color: COLORS.textLight,
  },
  categoryList: {
    flex: 1,
    gap: 8,
  },
  categoryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
  },
  categoryName: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
  },
  categoryPercentage: {
    fontSize: 14,
    color: COLORS.textLight,
  },
  chartContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 150,
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    paddingTop: 20,
    ...cardShadow,
  },
  chartBarWrapper: {
    flex: 1,
    alignItems: 'center',
    height: '100%',
    justifyContent: 'flex-end',
    gap: 8,
  },
  chartBar: {
    width: '60%',
    backgroundColor: COLORS.primary,
    borderRadius: 4,
    minHeight: 4,
  },
  chartLabel: {
    fontSize: 8,
    color: COLORS.textLight,
    textAlign: 'center',
  },
  chartTypeButtons: {
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    padding: 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chartTypeButton: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  chartTypeButtonActive: {
    backgroundColor: COLORS.primary,
  },
  chartTypeButtonText: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  chartTypeButtonTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  hourChartScroll: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    ...cardShadow,
  },
  hourChartContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 16,
    paddingBottom: 12,
  },
  hourBarWrapper: {
    width: 40,
    height: 150,
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginRight: 4,
  },
  hourBarValue: {
    fontSize: 9,
    color: COLORS.primary,
    fontWeight: '600',
    marginBottom: 4,
  },
  hourBarTrack: {
    width: 20,
    height: 100,
    justifyContent: 'flex-end',
  },
  hourBar: {
    width: '100%',
    backgroundColor: COLORS.primaryLight,
    borderRadius: 4,
    minHeight: 3,
  },
  hourBarPeak: {
    backgroundColor: COLORS.primary,
  },
  hourBarLabel: {
    fontSize: 9,
    color: COLORS.textLight,
    marginTop: 6,
  },
  hourBarLabelPeak: {
    color: COLORS.primary,
    fontWeight: 'bold',
  },
  timeSlotCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    ...cardShadow,
  },
  timeSlotText: {
    fontSize: 14,
    color: COLORS.text,
    marginBottom: 8,
  },
  timeSlotTip: {
    fontSize: 13,
    color: COLORS.textLight,
    fontStyle: 'italic',
    marginBottom: 12,
  },
  timeSlotChart: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 60,
  },
  timeSlotItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  timeSlotBar: {
    width: 20,
    backgroundColor: COLORS.primaryLight,
    borderRadius: 4,
    minHeight: 2,
  },
  timeSlotLabel: {
    fontSize: 10,
    color: COLORS.textLight,
  },
  durationCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    ...cardShadow,
  },
  durationText: {
    fontSize: 14,
    color: COLORS.text,
    marginBottom: 8,
  },
  durationTip: {
    fontSize: 13,
    color: COLORS.textLight,
    fontStyle: 'italic',
  },
  activityModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  activityModalContent: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 8,
  },
  activityModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  activityModalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  activityModalDesc: {
    fontSize: 14,
    color: COLORS.textLight,
    marginBottom: 12,
    lineHeight: 20,
  },
  activityModalValueRow: {
    alignItems: 'center',
    marginBottom: 12,
  },
  activityModalValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  activityModalHint: {
    fontSize: 13,
    color: COLORS.textLight,
    fontStyle: 'italic',
    marginBottom: 20,
    lineHeight: 18,
  },
  activityModalCloseBtn: {
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  activityModalCloseText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  aiCard: {
    marginHorizontal: 16,
    padding: 20,
    backgroundColor: COLORS.card,
    borderRadius: 16,
    marginBottom: 20,
    ...cardShadow,
  },
  aiHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  aiTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    flex: 1,
  },
  aiBadge: {
    fontSize: 12,
    color: COLORS.primary,
    backgroundColor: COLORS.secondary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  aiBadgeCache: {
    fontSize: 12,
    color: COLORS.textLight,
    backgroundColor: COLORS.border,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  aiBadgeFresh: {
    fontSize: 12,
    color: '#16A34A',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  aiHint: {
    fontSize: 14,
    color: COLORS.textLight,
    lineHeight: 22,
  },
  aiLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  aiBlock: {
    marginBottom: 14,
  },
  aiBlockTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
    marginBottom: 8,
  },
  aiBulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginBottom: 6,
  },
  aiBullet: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '700',
    marginTop: 1,
  },
  aiBulletText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 22,
  },
  aiTriggerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.background,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  aiTriggerTime: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    width: 92,
  },
  aiTriggerRisk: {
    fontSize: 12,
    color: '#16A34A',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  riskHigh: {
    color: '#DC2626',
    backgroundColor: '#FEE2E2',
  },
  riskMid: {
    color: '#D97706',
    backgroundColor: '#FEF3C7',
  },
  aiTriggerReason: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textLight,
    lineHeight: 18,
  },
  aiRefresh: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 6,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.primaryLight,
    backgroundColor: COLORS.secondary,
  },
  aiRefreshText: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '600',
  },
  aiRetry: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.primaryLight,
    backgroundColor: COLORS.secondary,
  },
  aiRetryText: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '600',
  },
  aiStartBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 11,
  },
  aiStartText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  iosDatePickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  iosDatePickerSheet: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 40,
  },
  iosDatePickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  iosDatePickerCancel: {
    fontSize: 16,
    color: COLORS.textLight,
  },
  iosDatePickerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  iosDatePickerConfirm: {
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: '600',
  },
  iosDatePicker: {
    backgroundColor: COLORS.card,
  },
});

export default PortraitPage;
