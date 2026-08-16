import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  ScrollView,
  Switch,
  ActivityIndicator,
  Platform,
  Alert,
  Image,
  BackHandler,
  Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import { Video, ResizeMode } from 'expo-av';
import { COLORS } from '../constants/reasons';
import { TOP_INSET } from '../constants/safeArea';
import { generateId, getQuickMemos, addQuickMemo, updateQuickMemo, deleteQuickMemo, getCachedMemoAnalysis } from '../utils/storage';
import { QuickMemo, HighlightRange } from '../types';
import { scheduleMemoReminder, cancelMemoReminder } from '../utils/reminder';
import { deleteMemoMediaDir, copyMediaToMemo, getMemoMediaUri } from '../utils/memoMedia';
import { analyzeMemos, hasApiKey, MemoAnalysisResult } from '../utils/ai';
import { onDataReset } from '../utils/appEvents';

const HL_COLORS = ['#FDE68A', '#BBF7D0', '#BFDBFE', '#FBCFE8'];

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const weekdayLabel = (ts: number): string => WEEKDAYS[new Date(ts).getDay()];

// 内容超过该字数视为「过长」，需要折叠并提供「展开全文」按钮
const LONG_CONTENT_THRESHOLD = 100;

// 日期分组：按自然日（本地时区）聚合
const dayKeyOf = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};
const dayKeyToTs = (key: string): number => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
};

interface MemoGroup {
  key: string;
  label: string; // 轴上显示：M/D 或「置顶」
  sub?: string; // 次要信息：周几
  items: QuickMemo[];
  isPinned?: boolean;
}

const formatDateTime = (ts: number): string => {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const renderHighlighted = (text: string, ranges: HighlightRange[], collapsed = false) => {
  if (!text) return <Text style={styles.cardText}>（空）</Text>;
  const rs = [...ranges].sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let i = 0;
  for (const r of rs) {
    const s = Math.max(r.start, cursor);
    const e = Math.min(r.end, text.length);
    if (e <= s) continue;
    if (s > cursor) parts.push(<Text key={`n${i}`} style={styles.cardText}>{text.slice(cursor, s)}</Text>);
    parts.push(<Text key={`h${i}`} style={[styles.cardText, { backgroundColor: r.color }]}>{text.slice(s, e)}</Text>);
    cursor = e;
    i++;
    if (cursor >= text.length) break;
  }
  if (cursor < text.length) parts.push(<Text key="tail" style={styles.cardText}>{text.slice(cursor)}</Text>);
  return (
    <Text numberOfLines={collapsed ? 3 : undefined} ellipsizeMode="tail">
      {parts}
    </Text>
  );
};

const QuickMemoPage: React.FC = () => {
  const [memos, setMemos] = useState<QuickMemo[]>([]);
  const [search, setSearch] = useState('');

  // 编辑弹窗
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftId, setDraftId] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [draftHighlights, setDraftHighlights] = useState<HighlightRange[]>([]);
  const [draftPinned, setDraftPinned] = useState(false);
  const [draftMedia, setDraftMedia] = useState<QuickMemo['media']>([]);
  const [draftTags, setDraftTags] = useState('');
  const [draftCreatedAt, setDraftCreatedAt] = useState<number>(Date.now());
  const [draftReminder, setDraftReminder] = useState<QuickMemo['reminder'] | undefined>(undefined);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [showReminderEditor, setShowReminderEditor] = useState(false);

  // 日期选择器（提醒 / 自定义分析区间 / 随手记发布时间）
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [dateTarget, setDateTarget] = useState<'reminder' | 'customStart' | 'customEnd' | 'memoDate'>('reminder');
  const [tempDate, setTempDate] = useState<Date>(new Date());

  // 媒体查看
  const [viewer, setViewer] = useState<{ type: 'image' | 'video'; uri: string } | null>(null);

  // AI 分析弹窗
  const [analysisVisible, setAnalysisVisible] = useState(false);
  const [analysisRange, setAnalysisRange] = useState<'week' | 'month' | 'quarter' | 'custom'>('month');
  const [customStart, setCustomStart] = useState<Date>(new Date());
  const [customEnd, setCustomEnd] = useState<Date>(new Date());
  const [analysisStatus, setAnalysisStatus] = useState<'idle' | 'loading' | 'done' | 'error' | 'disabled' | 'empty'>('idle');
  const [analysisResult, setAnalysisResult] = useState<MemoAnalysisResult | null>(null);
  const [analysisSource, setAnalysisSource] = useState<'cache' | 'api' | 'none'>('none');
  const [analysisTime, setAnalysisTime] = useState<number | null>(null);

  // 展开/收起状态：单条内容、日期分组、全局
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [allCollapsed, setAllCollapsed] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    loadMemos();
  }, []);

  // 清除/导入备份后全局通知重拉，确保随手记与其他页面同步
  useEffect(() => {
    const off = onDataReset(loadMemos);
    return off;
  }, []);

  // 编辑层改为普通 View 后，Android 需自行处理返回键关闭
  useEffect(() => {
    if (Platform.OS !== 'android' || !modalVisible) return;
    const onBack = () => {
      if (showDatePicker || viewer) return false; // 交给子 Modal 处理
      closeModal();
      return true;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [modalVisible, showDatePicker, viewer]);

  const loadMemos = async () => {
    const list = await getQuickMemos();
    setMemos(list);
  };

  // 历史用过的标签：按最近使用排序，去重后取最近 10 个
  const recentTags = useMemo(() => {
    const seen = new Map<string, number>();
    const sorted = [...memos].sort((a, b) => b.createdAt - a.createdAt);
    for (const m of sorted) {
      for (const t of m.tags) {
        if (!seen.has(t)) seen.set(t, m.createdAt);
      }
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map((e) => e[0]);
  }, [memos]);

  // 点击历史标签：追加到草稿标签（去重）
  const addHistoryTag = (tag: string) => {
    const current = draftTags
      .split(/[,，\s]+/)
      .map((t) => t.trim().replace(/^#/, ''))
      .filter(Boolean);
    if (!current.includes(tag)) current.push(tag);
    setDraftTags(current.join(', '));
  };

  const groups = useMemo(() => {
    const filtered = memos.filter((m) => {
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return (
        (m.content || '').toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
    // 置顶分组始终排在最前
    const pinned = filtered.filter((m) => m.pinned).sort((a, b) => b.createdAt - a.createdAt);
    // 其余按自然日分组，日期倒序，组内按创建时间倒序（与卡片显示一致）
    const byDay = new Map<string, QuickMemo[]>();
    for (const m of filtered) {
      if (m.pinned) continue;
      const key = dayKeyOf(m.createdAt);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(m);
    }
    const dayGroups: MemoGroup[] = [...byDay.keys()]
      .sort((a, b) => dayKeyToTs(b) - dayKeyToTs(a))
      .map((key) => {
        const items = byDay.get(key)!.sort((a, b) => b.createdAt - a.createdAt);
        const d = new Date(items[0].createdAt);
        return {
          key,
          label: `${d.getMonth() + 1}/${d.getDate()}`,
          sub: weekdayLabel(items[0].createdAt),
          items,
        };
      });
    const groups: MemoGroup[] = [];
    if (pinned.length) {
      groups.push({ key: 'pinned', label: '置顶', isPinned: true, items: pinned });
    }
    groups.push(...dayGroups);
    return groups;
  }, [memos, search]);

  // 某分组是否处于收起状态：全局收起优先，其次单组覆盖
  const isGroupCollapsed = (key: string): boolean => (allCollapsed ? true : !!collapsedGroups[key]);

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [key]: !isGroupCollapsed(key) }));
  };

  const toggleAll = () => {
    const nv = !allCollapsed;
    setAllCollapsed(nv);
    setCollapsedGroups({});
  };

  const toggleCard = (id: string) => {
    setExpandedCards((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // ---------- 编辑 ----------
  const openNew = () => {
    setEditingId(null);
    setDraftId(generateId());
    setDraftContent('');
    setDraftHighlights([]);
    setDraftPinned(false);
    setDraftMedia([]);
    setDraftTags('');
    setDraftCreatedAt(Date.now());
    setDraftReminder(undefined);
    setShowReminderEditor(false);
    setModalVisible(true);
  };

  const openEdit = (memo: QuickMemo) => {
    setEditingId(memo.id);
    setDraftId(memo.id);
    setDraftContent(memo.content);
    setDraftHighlights(memo.highlightRanges);
    setDraftPinned(memo.pinned);
    setDraftMedia(memo.media);
    setDraftTags(memo.tags.join(', '));
    setDraftCreatedAt(memo.createdAt);
    setDraftReminder(memo.reminder);
    setShowReminderEditor(false);
    setModalVisible(true);
  };

  const closeModal = () => {
    // 新建但未保存：清理可能已写入的媒体
    if (!editingId) {
      deleteMemoMediaDir(draftId);
    }
    setModalVisible(false);
  };

  const addHighlight = (color: string) => {
    if (!selection || selection.end <= selection.start) {
      Alert.alert('提示', '请先在输入框中选中要划线的文字');
      return;
    }
    setDraftHighlights((prev) => [...prev, { start: selection.start, end: selection.end, color }]);
  };

  // 编辑层已改为全屏 View 覆盖层（非 RN Modal），故相册选择器可在正常视图层级直接弹出，
  // 不再受 iOS Modal 独立 window 遮挡。mediaTypes 在 v15 必须传小写数组（原生期望），故 as any 桥接。
  const openPicker = async (type: 'image' | 'video') => {
    if (!draftId) {
      Alert.alert('提示', '请先保存草稿再添加媒体');
      return;
    }
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      // status 为 granted 时，iOS 14+ 的「部分访问」会在 accessPrivileges 标为 'limited'，二者都允许继续
      if (perm.status !== 'granted' && perm.accessPrivileges !== 'limited') {
        Alert.alert('需要相册权限', '请在系统设置中允许访问照片，才能导入图片/视频。');
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: (type === 'image' ? ['images'] : ['videos']) as any,
        quality: 0.8,
        // 图片支持一次多选（最多 9 张）；视频保持单条
        allowsMultipleSelection: type === 'image',
        selectionLimit: type === 'image' ? 9 : 1,
      });
      if (!res.canceled && res.assets && res.assets.length) {
        for (const asset of res.assets) {
          const file = await copyMediaToMemo(draftId, asset.uri);
          setDraftMedia((prev) => [...prev, { type, file }]);
        }
      }
    } catch (e: any) {
      console.error('[openPicker] failed', e);
      Alert.alert('导入失败', e?.message ? String(e.message) : '无法打开相册，请重试');
    }
  };

  const removeMedia = (idx: number) => {
    setDraftMedia((prev) => prev.filter((_, i) => i !== idx));
  };

  const saveReminderDraft = (datetime: Date, repeat: 'none' | 'daily' | 'weekly', channel: 'banner' | 'sound' | 'silent') => {
    setDraftReminder({ datetime: datetime.toISOString(), repeat, channel });
    setShowReminderEditor(false);
  };

  const saveMemo = async () => {
    const now = Date.now();
    const tags = draftTags
      .split(/[,，\s]+/)
      .map((t) => t.trim().replace(/^#/, ''))
      .filter(Boolean);

    const memo: QuickMemo = {
      id: draftId,
      content: draftContent,
      highlightRanges: draftHighlights,
      createdAt: draftCreatedAt || now,
      updatedAt: now,
      pinned: draftPinned,
      media: draftMedia,
      tags,
      reminder: draftReminder,
    };

    // 取消旧提醒
    const oldMemo = editingId ? memos.find((m) => m.id === editingId) : undefined;
    if (oldMemo?.reminder?.notificationId) {
      await cancelMemoReminder(oldMemo.reminder.notificationId);
    }

    // 调度新提醒
    let finalReminder = memo.reminder;
    if (memo.reminder) {
      const nid = await scheduleMemoReminder(memo);
      finalReminder = nid ? { ...memo.reminder, notificationId: nid } : memo.reminder;
    }
    memo.reminder = finalReminder;

    if (editingId) {
      await updateQuickMemo(memo);
    } else {
      await addQuickMemo(memo);
    }
    await loadMemos();
    setModalVisible(false);
  };

  const confirmDelete = (memo: QuickMemo) => {
    Alert.alert('删除随手记', '确定删除这条记录吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          if (memo.reminder?.notificationId) await cancelMemoReminder(memo.reminder.notificationId);
          await deleteMemoMediaDir(memo.id);
          await deleteQuickMemo(memo.id);
          await loadMemos();
        },
      },
    ]);
  };

  const togglePin = async (memo: QuickMemo) => {
    const updated = { ...memo, pinned: !memo.pinned, updatedAt: Date.now() };
    await updateQuickMemo(updated);
    await loadMemos();
  };

  // 分享某条随手记到微信（通过系统分享面板，需本机已安装微信）。
  // 文字 + 图片一起发：iOS 系统分享面板原生支持「文字 + 单张图」；多图时先发文字+首图，
  // 其余图片可再次点分享逐张发送（RN 原生分享单次只带一张图）。
  const shareMemo = async (memo: QuickMemo) => {
    const text = (memo.content || '').trim();
    const images = memo.media.filter((m) => m.type === 'image').map((m) => getMemoMediaUri(memo.id, m.file));
    try {
      if (images.length === 0) {
        await Share.share({ message: text || '随手记', title: '随手记' });
      } else {
        // iOS：message 作为正文、url 作为附件，微信会一并带上
        await Share.share({ message: text, url: images[0], title: '随手记' });
      }
    } catch (e: any) {
      // 用户取消分享（iOS: User did not share / Android: E_MAIL）属正常，不提示
      const canceled = e?.message === 'User did not share' || e?.name === 'E_MAIL' || e?.code === 'E_MAIL';
      if (!canceled) {
        console.error('[QuickMemo] share failed', e);
        Alert.alert('分享失败', '请确认已安装微信，或通过系统分享面板选择微信后再试');
      }
    }
  };

  // ---------- 日期选择器 ----------
  const openDatePicker = (target: 'reminder' | 'customStart' | 'customEnd' | 'memoDate', initial?: Date) => {
    setDateTarget(target);
    setTempDate(initial || new Date());
    setShowDatePicker(true);
  };

  const onDateChange = (event: any, date?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }
    if (event.type === 'set' && date) {
      setTempDate(date);
      if (Platform.OS === 'ios') {
        // iOS 由确认按钮提交
      }
    }
  };

  const confirmDate = () => {
    if (dateTarget === 'reminder') {
      const repeat = draftReminder?.repeat || 'none';
      const channel = draftReminder?.channel || 'banner';
      saveReminderDraft(tempDate, repeat, channel);
    } else if (dateTarget === 'customStart') {
      setCustomStart(tempDate);
    } else if (dateTarget === 'customEnd') {
      setCustomEnd(tempDate);
    } else if (dateTarget === 'memoDate') {
      setDraftCreatedAt(tempDate.getTime());
    }
    setShowDatePicker(false);
  };

  // ---------- AI 分析 ----------
  const computeRange = () => {
    const now = new Date();
    if (analysisRange === 'week') {
      const d = new Date(now);
      const day = d.getDay() || 7;
      d.setDate(d.getDate() - day + 1);
      d.setHours(0, 0, 0, 0);
      return { start: d, end: now, label: '本周', key: 'memo-week' };
    }
    if (analysisRange === 'month') {
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: d, end: now, label: '本月', key: 'memo-month' };
    }
    if (analysisRange === 'quarter') {
      const q = Math.floor(now.getMonth() / 3);
      const d = new Date(now.getFullYear(), q * 3, 1);
      return { start: d, end: now, label: '本季度', key: 'memo-quarter' };
    }
    return {
      start: customStart,
      end: customEnd,
      label: '自定义',
      key: `memo-custom-${customStart.toISOString().slice(0, 10)}_${customEnd.toISOString().slice(0, 10)}`,
    };
  };

  const openAnalysis = async () => {
    const hasKey = await hasApiKey();
    const { start, end, key } = computeRange();
    const inRange = memos.filter((m) => m.createdAt >= start.getTime() && m.createdAt <= end.getTime());
    if (!hasKey) {
      setAnalysisStatus('disabled');
    } else if (inRange.length === 0) {
      setAnalysisStatus('empty');
    } else {
      const cached = await getCachedMemoAnalysis(key);
      if (cached) {
        setAnalysisResult(cached.result);
        setAnalysisSource('cache');
        setAnalysisTime(cached.timestamp);
        setAnalysisStatus('done');
      } else {
        setAnalysisTime(null);
        setAnalysisStatus('idle');
      }
    }
    setAnalysisVisible(true);
  };

  const runAnalysis = async (force = true) => {
    const hasKey = await hasApiKey();
    if (!hasKey) {
      setAnalysisStatus('disabled');
      return;
    }
    const { start, end, label, key } = computeRange();
    const inRange = memos.filter((m) => m.createdAt >= start.getTime() && m.createdAt <= end.getTime());
    if (inRange.length === 0) {
      setAnalysisStatus('empty');
      return;
    }
    setAnalysisStatus('loading');
    const { result, source } = await analyzeMemos(key, label, inRange, force);
    if (result) {
      setAnalysisResult(result);
      setAnalysisSource(source);
      setAnalysisTime(Date.now());
      setAnalysisStatus('done');
    } else {
      setAnalysisStatus('error');
    }
  };

  // ---------- 渲染 ----------
  const renderMemoCard = (item: QuickMemo) => {
    const isLong = item.content.length > LONG_CONTENT_THRESHOLD;
    const collapsed = isLong && !expandedCards[item.id];
    return (
      <TouchableOpacity style={styles.card} activeOpacity={0.9} onPress={() => openEdit(item)}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardDate}>{formatDateTime(item.createdAt)}</Text>
          {item.pinned && <Ionicons name="bookmark" size={14} color={COLORS.primary} />}
        </View>
        {renderHighlighted(item.content, item.highlightRanges, collapsed)}
        {isLong && (
          <TouchableOpacity style={styles.expandBtnWrap} onPress={() => toggleCard(item.id)}>
            <Text style={styles.expandBtn}>{collapsed ? '展开全文' : '收起'}</Text>
          </TouchableOpacity>
        )}
        {item.media.length > 0 && (
          <View style={styles.mediaRow}>
            {item.media.map((m, idx) => (
              <TouchableOpacity
                key={idx}
                style={styles.mediaThumb}
                onPress={() => setViewer({ type: m.type, uri: getMemoMediaUri(item.id, m.file) })}
              >
                {m.type === 'image' ? (
                  <Image source={{ uri: getMemoMediaUri(item.id, m.file) }} style={styles.mediaThumbImg} />
                ) : (
                  <View style={styles.videoThumb}>
                    <Ionicons name="play" size={18} color="#fff" />
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}
        {item.tags.length > 0 && (
          <View style={styles.tagRow}>
            {item.tags.map((t, i) => (
              <Text key={i} style={styles.tag}>#{t}</Text>
            ))}
          </View>
        )}
        {item.reminder && (
          <View style={styles.reminderChip}>
            <Ionicons name="alarm-outline" size={12} color={COLORS.warning} />
            <Text style={styles.reminderText}>
              提醒 {new Date(item.reminder.datetime).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
        )}
        <View style={styles.cardActions}>
          <TouchableOpacity style={styles.actionBtn} onPress={() => shareMemo(item)}>
            <Ionicons name="share-outline" size={16} color={COLORS.primary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => togglePin(item)}>
            <Ionicons name={item.pinned ? 'bookmark' : 'bookmark-outline'} size={16} color={item.pinned ? COLORS.primary : COLORS.textLight} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => confirmDelete(item)}>
            <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>随手记</Text>
        <TouchableOpacity style={styles.analyzeBtn} onPress={openAnalysis}>
          <Ionicons name="analytics-outline" size={16} color="#fff" />
          <Text style={styles.analyzeBtnText}>回顾分析</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchBox}>
        <Ionicons name="search-outline" size={16} color={COLORS.textLight} />
        <TextInput
          style={styles.searchInput}
          placeholder="搜索内容或标签"
          placeholderTextColor={COLORS.textLighter}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <ScrollView style={styles.timelineScroll} contentContainerStyle={styles.timelineContent}>
        {memos.length === 0 ? (
          <Text style={styles.emptyText}>还没有记录，点右下角 + 记一笔吧</Text>
        ) : (
          <>
            <View style={styles.groupBar}>
              <TouchableOpacity style={styles.collapseAllBtn} onPress={toggleAll} activeOpacity={0.7}>
                <Ionicons
                  name={allCollapsed ? 'chevron-expand-outline' : 'chevron-collapse-outline'}
                  size={16}
                  color={COLORS.primary}
                />
                <Text style={styles.collapseAllText}>{allCollapsed ? '全部展开' : '全部收起'}</Text>
              </TouchableOpacity>
              <Text style={styles.groupCount}>
                {groups.length} 个日期 · {memos.length} 条
              </Text>
            </View>

            <View style={styles.axisWrap}>
              <View style={styles.axisLineCont} />
              {groups.map((g) => {
              const collapsed = isGroupCollapsed(g.key);
              return (
                <View style={styles.dateRow} key={g.key}>
                  <TouchableOpacity style={styles.axisCol} onPress={() => toggleGroup(g.key)} activeOpacity={0.6}>
                    <View style={[styles.axisNode, g.isPinned && styles.axisNodePinned]}>
                      <Ionicons
                        name={g.isPinned ? 'bookmark' : collapsed ? 'add' : 'remove'}
                        size={g.isPinned ? 13 : 16}
                        color={g.isPinned ? '#fff' : collapsed ? COLORS.primary : COLORS.textLight}
                      />
                    </View>
                    <Text style={[styles.axisDate, g.isPinned && styles.axisDatePinned]} numberOfLines={1}>
                      {g.label}
                    </Text>
                    <Text style={styles.axisCount} numberOfLines={1}>
                      {g.isPinned ? '置顶' : `${g.items.length}条`}
                    </Text>
                  </TouchableOpacity>

                  <View style={styles.dateContent}>
                    {collapsed ? (
                      <TouchableOpacity style={styles.collapsedHint} onPress={() => toggleGroup(g.key)} activeOpacity={0.7}>
                        <Ionicons name="chevron-down-outline" size={14} color={COLORS.textLight} />
                        <Text style={styles.collapsedHintText}>已收起 {g.items.length} 条 · 点击展开</Text>
                      </TouchableOpacity>
                    ) : (
                      g.items.map((item) => <View key={item.id}>{renderMemoCard(item)}</View>)
                    )}
                  </View>
                </View>
              );
            })}
            </View>
          </>
        )}
      </ScrollView>

      <TouchableOpacity style={styles.fab} onPress={openNew}>
        <Ionicons name="add" size={26} color="#fff" />
      </TouchableOpacity>

      {/* 编辑弹窗 */}
      {modalVisible && (
        <View style={styles.editorOverlay}>
          <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{editingId ? '编辑随手记' : '新建随手记'}</Text>
                <TouchableOpacity onPress={closeModal}>
                  <Ionicons name="close" size={22} color={COLORS.textLight} />
                </TouchableOpacity>
              </View>

              <TextInput
                style={styles.editorInput}
                multiline
                placeholder="此刻在想什么、发生了什么…"
                placeholderTextColor={COLORS.textLighter}
                value={draftContent}
                onChangeText={setDraftContent}
                onSelectionChange={(e) => setSelection(e.nativeEvent.selection)}
                textAlignVertical="top"
              />

              <View style={styles.hlBar}>
                {HL_COLORS.map((c, i) => (
                  <TouchableOpacity key={i} style={[styles.hlDot, { backgroundColor: c }]} onPress={() => addHighlight(c)} />
                ))}
                <TouchableOpacity style={styles.hlClear} onPress={() => setDraftHighlights([])}>
                  <Text style={styles.hlClearText}>清除</Text>
                </TouchableOpacity>
                <Text style={styles.hlHint}>选中文字后点色块划线</Text>
              </View>

              {draftHighlights.length > 0 && (
                <View style={styles.previewBox}>
                  {renderHighlighted(draftContent, draftHighlights)}
                </View>
              )}

              <View style={styles.mediaRow}>
                {draftMedia.map((m, idx) => (
                  <View key={idx} style={styles.mediaThumb}>
                    {m.type === 'image' ? (
                      <Image source={{ uri: getMemoMediaUri(draftId, m.file) }} style={styles.mediaThumbImg} />
                    ) : (
                      <View style={styles.videoThumb}>
                        <Ionicons name="play" size={18} color="#fff" />
                      </View>
                    )}
                    <TouchableOpacity style={styles.mediaRemove} onPress={() => removeMedia(idx)}>
                      <Ionicons name="close" size={12} color="#fff" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
              <View style={styles.mediaBtns}>
                <TouchableOpacity style={styles.mediaBtn} onPress={() => openPicker('image')}>
                  <Ionicons name="image-outline" size={16} color={COLORS.primary} />
                  <Text style={styles.mediaBtnText}>图片</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.mediaBtn} onPress={() => openPicker('video')}>
                  <Ionicons name="videocam-outline" size={16} color={COLORS.primary} />
                  <Text style={styles.mediaBtnText}>视频</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>标签（逗号分隔）</Text>
                <TextInput
                  style={styles.tagInput}
                  placeholder="如：灵感, 工作"
                  placeholderTextColor={COLORS.textLighter}
                  value={draftTags}
                  onChangeText={setDraftTags}
                />
              </View>

              {recentTags.length > 0 && (
                <View style={styles.tagHistory}>
                  <Text style={styles.tagHistoryLabel}>历史标签 · 点击添加（最近 10 个）</Text>
                  <View style={styles.tagHistoryRow}>
                    {recentTags.map((t) => (
                      <TouchableOpacity key={t} style={styles.tagHistoryChip} onPress={() => addHistoryTag(t)}>
                        <Text style={styles.tagHistoryChipText}>#{t}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>置顶</Text>
                <Switch value={draftPinned} onValueChange={setDraftPinned} thumbColor={draftPinned ? COLORS.primary : '#fff'} />
              </View>

              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>发布时间</Text>
                <TouchableOpacity style={styles.dateChip} onPress={() => openDatePicker('memoDate', new Date(draftCreatedAt))}>
                  <Text style={styles.dateChipText}>{formatDateTime(draftCreatedAt)}</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={styles.reminderRow} onPress={() => setShowReminderEditor((v) => !v)}>
                <Ionicons name="alarm-outline" size={18} color={COLORS.warning} />
                <Text style={styles.reminderRowText}>
                  {draftReminder
                    ? `提醒 ${new Date(draftReminder.datetime).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${draftReminder.repeat === 'none' ? '不重复' : draftReminder.repeat === 'daily' ? '每天' : '每周'} · ${draftReminder.channel === 'sound' ? '声音' : '横幅'}`
                    : '设置提醒（备忘某事）'}
                </Text>
                {draftReminder && (
                  <TouchableOpacity onPress={() => setDraftReminder(undefined)}>
                    <Ionicons name="close-circle" size={18} color={COLORS.textLight} />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>

              {showReminderEditor && (
                <View style={styles.reminderEditor}>
                  <TouchableOpacity style={styles.dateBtn} onPress={() => openDatePicker('reminder', draftReminder ? new Date(draftReminder.datetime) : new Date())}>
                    <Text style={styles.dateBtnText}>选择时间</Text>
                    <Text style={styles.dateBtnValue}>
                      {draftReminder ? new Date(draftReminder.datetime).toLocaleString('zh-CN') : tempDate.toLocaleString('zh-CN')}
                    </Text>
                  </TouchableOpacity>
                  <Text style={styles.subLabel}>重复</Text>
                  <View style={styles.segRow}>
                    {(['none', 'daily', 'weekly'] as const).map((r) => (
                      <TouchableOpacity
                        key={r}
                        style={[styles.seg, (draftReminder?.repeat || 'none') === r && styles.segActive]}
                        onPress={() => setDraftReminder((prev) => ({ datetime: prev?.datetime || tempDate.toISOString(), repeat: r, channel: prev?.channel || 'banner' }))}
                      >
                        <Text style={[styles.segText, (draftReminder?.repeat || 'none') === r && styles.segTextActive]}>
                          {r === 'none' ? '不重复' : r === 'daily' ? '每天' : '每周'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={styles.subLabel}>通知方式</Text>
                  <View style={styles.segRow}>
                    {(['banner', 'sound', 'silent'] as const).map((c) => (
                      <TouchableOpacity
                        key={c}
                        style={[styles.seg, (draftReminder?.channel || 'banner') === c && styles.segActive]}
                        onPress={() => setDraftReminder((prev) => ({ datetime: prev?.datetime || tempDate.toISOString(), repeat: prev?.repeat || 'none', channel: c }))}
                      >
                        <Text style={[styles.segText, (draftReminder?.channel || 'banner') === c && styles.segTextActive]}>
                          {c === 'banner' ? '横幅' : c === 'sound' ? '声音' : '静默'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              <TouchableOpacity style={styles.saveBtn} onPress={saveMemo}>
                <Text style={styles.saveBtnText}>保存</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
        </View>
      )}

      {/* 日期选择器 */}
      <Modal visible={showDatePicker} transparent animationType="slide" onRequestClose={() => setShowDatePicker(false)}>
        <View style={styles.iosDatePickerOverlay}>
          <View style={styles.iosDatePickerSheet}>
            <View style={styles.iosDatePickerHeader}>
              <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                <Text style={styles.iosDatePickerCancel}>取消</Text>
              </TouchableOpacity>
              <Text style={styles.iosDatePickerTitle}>选择日期</Text>
              <TouchableOpacity onPress={confirmDate}>
                <Text style={styles.iosDatePickerConfirm}>确定</Text>
              </TouchableOpacity>
            </View>
            <DateTimePicker
              value={tempDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={onDateChange}
              textColor={COLORS.text}
            />
            {dateTarget !== 'reminder' && (
              <DateTimePicker
                value={tempDate}
                mode="time"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={onDateChange}
                textColor={COLORS.text}
                style={{ marginTop: 8 }}
              />
            )}
          </View>
        </View>
      </Modal>

      {/* 媒体查看 */}
      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <View style={styles.viewerOverlay}>
          <TouchableOpacity style={styles.viewerClose} onPress={() => setViewer(null)}>
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>
          {viewer ? (
            viewer.type === 'image' ? (
              <Image source={{ uri: viewer.uri }} style={styles.viewerImg} resizeMode="contain" />
            ) : (
              <Video source={{ uri: viewer.uri }} useNativeControls resizeMode={ResizeMode.CONTAIN} style={styles.viewerImg} />
            )
          ) : null}
        </View>
      </Modal>

      {/* AI 分析 */}
      <Modal visible={analysisVisible} animationType="slide" transparent onRequestClose={() => setAnalysisVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <ScrollView style={styles.modalScroll}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>回顾分析</Text>
                <TouchableOpacity onPress={() => setAnalysisVisible(false)}>
                  <Ionicons name="close" size={22} color={COLORS.textLight} />
                </TouchableOpacity>
              </View>

              <View style={styles.segRow}>
                {([['week', '本周'], ['month', '本月'], ['quarter', '本季度'], ['custom', '自定义']] as const).map(([k, label]) => (
                  <TouchableOpacity
                    key={k}
                    style={[styles.seg, analysisRange === k && styles.segActive]}
                    onPress={() => setAnalysisRange(k)}
                  >
                    <Text style={[styles.segText, analysisRange === k && styles.segTextActive]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {analysisRange === 'custom' && (
                <View style={styles.customRange}>
                  <TouchableOpacity style={styles.dateBtn} onPress={() => openDatePicker('customStart', customStart)}>
                    <Text style={styles.dateBtnText}>开始</Text>
                    <Text style={styles.dateBtnValue}>{customStart.toLocaleDateString('zh-CN')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.dateBtn} onPress={() => openDatePicker('customEnd', customEnd)}>
                    <Text style={styles.dateBtnText}>结束</Text>
                    <Text style={styles.dateBtnValue}>{customEnd.toLocaleDateString('zh-CN')}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {analysisStatus === 'disabled' && (
                <Text style={styles.analyzeHint}>未开启 AI 分析。前往「我的 → AI 智能分析」填入 GLM API Key 即可使用（仅上传匿名文本，媒体不出手机）。</Text>
              )}
              {analysisStatus === 'empty' && <Text style={styles.analyzeHint}>该时间段内还没有随手记。</Text>}
              {analysisStatus === 'error' && <Text style={styles.analyzeHint}>分析失败，请检查网络或 API Key 后重试。</Text>}

              {(analysisStatus === 'idle' || analysisStatus === 'loading') && (
                <TouchableOpacity
                  style={[styles.saveBtn, analysisStatus === 'loading' && styles.saveBtnDisabled]}
                  onPress={() => runAnalysis(true)}
                  disabled={analysisStatus === 'loading'}
                >
                  {analysisStatus === 'loading' ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.saveBtnText}>开始AI分析</Text>
                  )}
                </TouchableOpacity>
              )}

              {analysisStatus === 'done' && analysisResult && (
                <View style={styles.resultCard}>
                  <View style={styles.resultHeadRow}>
                    {analysisSource === 'cache' && <Text style={styles.cacheBadge}>缓存</Text>}
                    {analysisTime ? (
                      <Text style={styles.analysisTime}>上次分析 {formatDateTime(analysisTime)}</Text>
                    ) : null}
                    <View style={styles.headSpacer} />
                    <TouchableOpacity style={styles.headAnalyzeBtn} onPress={() => runAnalysis(true)}>
                      <Text style={styles.headAnalyzeBtnText}>开始AI分析</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.resultSection}>主线主题</Text>
                  {analysisResult.mainThemes.map((t, i) => <Text key={i} style={styles.resultItem}>· {t}</Text>)}
                  <Text style={styles.resultSection}>关键事件</Text>
                  {analysisResult.keyEvents.map((t, i) => <Text key={i} style={styles.resultItem}>· {t}</Text>)}
                  <Text style={styles.resultSection}>高频主题</Text>
                  {analysisResult.topTopics.map((t, i) => <Text key={i} style={styles.resultItem}>· {t}</Text>)}
                  <Text style={styles.resultSection}>情绪基调</Text>
                  <Text style={styles.resultItem}>{analysisResult.mood}</Text>
                  <Text style={styles.resultSection}>反思建议</Text>
                  {analysisResult.reflections.map((t, i) => <Text key={i} style={styles.resultItem}>· {t}</Text>)}
                  <Text style={styles.resultFoot}>仅上传匿名文本，媒体与原始记录不出手机</Text>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, paddingTop: TOP_INSET },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 10, backgroundColor: COLORS.card,
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: COLORS.text },
  analyzeBtn: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primary,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, gap: 4,
  },
  analyzeBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.card,
    marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, gap: 6,
  },
  searchInput: { flex: 1, fontSize: 14, color: COLORS.text },
  timelineScroll: { flex: 1 },
  timelineContent: { paddingHorizontal: 12, paddingBottom: 110, paddingTop: 4 },
  groupBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 10,
  },
  collapseAllBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLORS.card, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    borderWidth: 0.5, borderColor: COLORS.border,
  },
  collapseAllText: { fontSize: 13, color: COLORS.primary, fontWeight: '600' },
  groupCount: { fontSize: 12, color: COLORS.textLighter },
  dateRow: { flexDirection: 'row', alignItems: 'flex-start' },
  axisWrap: { position: 'relative' },
  axisCol: {
    width: 58, alignItems: 'center', paddingTop: 16, paddingBottom: 12, position: 'relative',
  },
  axisLineCont: {
    position: 'absolute', top: 0, bottom: 0, left: 28, width: 2,
    backgroundColor: COLORS.border, zIndex: 0,
  },
  axisNode: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: COLORS.card,
    borderWidth: 1.5, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center',
    zIndex: 1,
  },
  axisNodePinned: {
    backgroundColor: COLORS.primary, borderColor: COLORS.primary,
  },
  axisDate: { fontSize: 12, color: COLORS.text, fontWeight: '600', marginTop: 6, textAlign: 'center' },
  axisDatePinned: { color: COLORS.primary, fontSize: 11 },
  axisCount: { fontSize: 10, color: COLORS.textLighter, marginTop: 1, textAlign: 'center' },
  dateContent: { flex: 1, paddingLeft: 6, paddingRight: 2, paddingTop: 8 },
  collapsedHint: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    backgroundColor: COLORS.card, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12,
    borderWidth: 0.5, borderColor: COLORS.border, marginBottom: 12,
  },
  collapsedHintText: { fontSize: 12, color: COLORS.textLight },
  expandBtnWrap: { alignSelf: 'flex-start', marginTop: 4, paddingVertical: 2 },
  expandBtn: { fontSize: 13, color: COLORS.primary, fontWeight: '600' },
  emptyText: { textAlign: 'center', color: COLORS.textLighter, marginTop: 60, fontSize: 14 },
  fab: {
    position: 'absolute', right: 20, bottom: 28, width: 56, height: 56, borderRadius: 28,
    backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center',
    shadowColor: COLORS.shadow, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  card: {
    backgroundColor: COLORS.card, borderRadius: 14, padding: 14, marginBottom: 12,
    borderWidth: 0.5, borderColor: COLORS.border,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  cardDate: { fontSize: 12, color: COLORS.textLighter },
  cardText: { fontSize: 15, color: COLORS.text, lineHeight: 22 },
  mediaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  mediaThumb: { width: 72, height: 72, borderRadius: 10, overflow: 'hidden', backgroundColor: COLORS.background, position: 'relative' },
  mediaThumbImg: { width: '100%', height: '100%' },
  videoThumb: { width: '100%', height: '100%', backgroundColor: '#1E293B', alignItems: 'center', justifyContent: 'center' },
  mediaRemove: {
    position: 'absolute', top: 2, right: 2, width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center',
  },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  tag: { fontSize: 12, color: COLORS.primary, backgroundColor: COLORS.secondary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  reminderChip: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, backgroundColor: '#FFFBEB', alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  reminderText: { fontSize: 11, color: COLORS.warning },
  cardActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16, marginTop: 8 },
  actionBtn: { padding: 4 },
  // 编辑层改为全屏绝对定位覆盖层（非 RN Modal），让原生相册/相机选择器能在正常视图层级弹出
  editorOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end', zIndex: 1000,
  },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: COLORS.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '92%', width: '100%' },
  modalScroll: { padding: 20, paddingBottom: 36, maxHeight: '92%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text },
  editorInput: {
    borderWidth: 0.5, borderColor: COLORS.border, borderRadius: 12, padding: 12,
    fontSize: 15, color: COLORS.text, minHeight: 120, backgroundColor: COLORS.background,
  },
  hlBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  hlDot: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border },
  hlClear: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: COLORS.background },
  hlClearText: { fontSize: 12, color: COLORS.textLight },
  hlHint: { fontSize: 11, color: COLORS.textLighter },
  previewBox: { marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: COLORS.background, borderWidth: 0.5, borderColor: COLORS.border },
  fieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  fieldLabel: { fontSize: 14, color: COLORS.text, fontWeight: '600' },
  tagInput: {
    flex: 1, marginLeft: 12, borderWidth: 0.5, borderColor: COLORS.border, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 7, fontSize: 14, color: COLORS.text, textAlign: 'right',
  },
  dateChip: {
    marginLeft: 12, backgroundColor: COLORS.background, borderWidth: 0.5, borderColor: COLORS.border,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, minWidth: 120, alignItems: 'flex-end',
  },
  dateChipText: { fontSize: 14, color: COLORS.text, fontWeight: '600' },
  tagHistory: { marginTop: 12 },
  tagHistoryLabel: { fontSize: 12, color: COLORS.textLight, marginBottom: 8 },
  tagHistoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagHistoryChip: {
    backgroundColor: COLORS.secondary, borderWidth: 0.5, borderColor: COLORS.border,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12,
  },
  tagHistoryChipText: { fontSize: 12, color: COLORS.primary, fontWeight: '500' },
  mediaBtns: { flexDirection: 'row', gap: 10, marginTop: 10 },
  mediaBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 10, backgroundColor: COLORS.secondary, borderWidth: 0.5, borderColor: COLORS.border,
  },
  mediaBtnText: { fontSize: 13, color: COLORS.primary, fontWeight: '600' },
  reminderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, backgroundColor: '#FFFBEB', padding: 12, borderRadius: 12 },
  reminderRowText: { flex: 1, fontSize: 13, color: COLORS.text },
  reminderEditor: { marginTop: 10, padding: 12, backgroundColor: COLORS.background, borderRadius: 12 },
  dateBtn: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, backgroundColor: COLORS.card, borderRadius: 10, borderWidth: 0.5, borderColor: COLORS.border },
  dateBtnText: { fontSize: 14, color: COLORS.textLight },
  dateBtnValue: { fontSize: 14, color: COLORS.text, fontWeight: '600' },
  subLabel: { fontSize: 13, color: COLORS.textLight, marginTop: 12, marginBottom: 6 },
  segRow: { flexDirection: 'row', gap: 8 },
  seg: { flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: COLORS.card, borderWidth: 0.5, borderColor: COLORS.border, alignItems: 'center' },
  segActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  segText: { fontSize: 13, color: COLORS.textLight },
  segTextActive: { color: '#fff', fontWeight: '600' },
  customRange: { flexDirection: 'row', gap: 10, marginTop: 12 },
  saveBtn: { marginTop: 20, backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  saveBtnDisabled: { opacity: 0.7 },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  iosDatePickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  iosDatePickerSheet: { backgroundColor: COLORS.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16 },
  iosDatePickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  iosDatePickerCancel: { fontSize: 15, color: COLORS.textLight },
  iosDatePickerTitle: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  iosDatePickerConfirm: { fontSize: 15, color: COLORS.primary, fontWeight: '600' },
  viewerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center' },
  viewerClose: { position: 'absolute', top: 50, right: 20, zIndex: 1 },
  viewerImg: { width: '90%', height: '70%' },
  analyzeHint: { fontSize: 13, color: COLORS.textLight, lineHeight: 20, marginTop: 14 },
  resultCard: { marginTop: 16, padding: 14, backgroundColor: COLORS.background, borderRadius: 12, borderWidth: 0.5, borderColor: COLORS.border },
  cacheBadge: { fontSize: 11, color: COLORS.textLighter, backgroundColor: COLORS.card, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, marginRight: 8 },
  resultSection: { fontSize: 14, fontWeight: '700', color: COLORS.primary, marginTop: 10, marginBottom: 4 },
  resultItem: { fontSize: 14, color: COLORS.text, lineHeight: 21, marginBottom: 2 },
  resultFoot: { fontSize: 11, color: COLORS.textLighter, marginTop: 10 },
  resultHeadRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' },
  analysisTime: { fontSize: 12, color: COLORS.textLighter },
  headSpacer: { flex: 1 },
  headAnalyzeBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primary, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16 },
  headAnalyzeBtnDisabled: { opacity: 0.6 },
  headAnalyzeBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
});

export default QuickMemoPage;
