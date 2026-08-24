import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Switch,
  Alert,
  AppState,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { COLORS } from '../constants/reasons';
import { TOP_INSET } from '../constants/safeArea';
import SwipeableRow from '../components/SwipeableRow';
import {
  getChatSessions,
  deleteChatSession,
  renameChatSession,
  createChatSession,
  ChatSession,
} from '../utils/storage';
import { getSavedChats, deleteSavedChat, SavedChat } from '../utils/savedChat';
import type { DataCategory } from '../utils/chatContext';
import {
  evaluateGreeting,
  markGreetingShown,
  snoozeGreeting,
  dismissGreetingToday,
  remainingToday,
  createCasualGreetingSession,
  GreetingResult,
} from '../utils/proactive';

const DATA_CATS: { key: DataCategory; label: string }[] = [
  { key: 'meal', label: '餐饮' },
  { key: 'plan', label: '规划打卡' },
  { key: 'focus', label: '专注计时' },
  { key: 'memo', label: '随手记' },
  { key: 'exercise', label: '运动健身' },
  { key: 'chat', label: '聊天记录' },
];

const fmtTime = (ts: number): string => {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const diff = today.getTime() - d.getTime();
  if (diff < 7 * 86400000) return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
};

const previewOf = (s: ChatSession): string => {
  const last = s.messages[s.messages.length - 1];
  if (!last) return '还没有消息';
  const role = last.role === 'user' ? '我：' : 'AI：';
  const txt = (last.content || '[图片]').replace(/\n/g, ' ').slice(0, 30);
  return role + txt + (last.content && last.content.length > 30 ? '…' : '');
};

const ChatSessionsPage: React.FC = () => {
  const navigation = useNavigation<any>();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [saved, setSaved] = useState<SavedChat[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [renameTarget, setRenameTarget] = useState<ChatSession | null>(null);
  const [renameText, setRenameText] = useState('');

  // 新建面板状态
  const [newTitle, setNewTitle] = useState('');
  const [carryProfile, setCarryProfile] = useState(true);
  const [carryCats, setCarryCats] = useState<DataCategory[]>([]);

  const refresh = async () => {
    setSessions(await getChatSessions());
    setSaved(await getSavedChats());
  };

  useEffect(() => {
    refresh();
  }, []);

  const openSession = (s: ChatSession) => {
    navigation.navigate('Chat', { id: s.id, title: s.title });
  };

  const handleNew = async () => {
    const s = await createChatSession({
      title: newTitle,
      carryProfile,
      carryDataCats: carryCats,
    });
    setShowNew(false);
    setNewTitle('');
    setCarryProfile(true);
    setCarryCats([]);
    navigation.navigate('Chat', { id: s.id, title: s.title });
  };

  const handleDelete = (s: ChatSession) => {
    Alert.alert('删除会话', `确定删除「${s.title}」吗？该会话内的全部消息会被移除，且不可恢复。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await deleteChatSession(s.id);
          refresh();
        },
      },
    ]);
  };

  const handleRename = async () => {
    if (!renameTarget) return;
    await renameChatSession(renameTarget.id, renameText);
    setRenameTarget(null);
    refresh();
  };

  // —— AI 主动问候 ——
  const [greeting, setGreeting] = useState<GreetingResult | null>(null);
  const [greetingRemain, setGreetingRemain] = useState(0);
  const [greetingLoading, setGreetingLoading] = useState(false);
  const greetingRef = useRef<GreetingResult | null>(null);

  // 评估是否弹卡：开关/免打扰/次数/未结束话题/纯闲聊 全部满足才弹；正在展示时不再重复评估
  const checkGreeting = useCallback(async () => {
    if (greetingRef.current) return;
    setGreetingLoading(true);
    try {
      const result = await evaluateGreeting();
      if (result) {
        greetingRef.current = result;
        setGreeting(result);
        await markGreetingShown(); // 弹卡即消耗一次（并设 30 分钟冷却）
        setGreetingRemain(await remainingToday());
      }
    } finally {
      setGreetingLoading(false);
    }
  }, []);

  // 切回「AI 对话」tab 时检查
  useFocusEffect(
    useCallback(() => { checkGreeting(); }, [checkGreeting])
  );

  // App 从后台回到前台时也检查
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') checkGreeting();
    });
    return () => sub.remove();
  }, [checkGreeting]);

  const handleGreetingChat = async () => {
    if (!greeting) return;
    let id = greeting.sessionId;
    // 未结束话题 → 打开原会话；纯闲聊 → 新建一个会话并把问候语作为 AI 首条消息
    if (!id) id = await createCasualGreetingSession(greeting.text);
    greetingRef.current = null;
    setGreeting(null);
    navigation.navigate('Chat', { id, title: greeting.isCasual ? 'AI 主动问候' : undefined });
  };

  const handleGreetingLater = async () => {
    await snoozeGreeting(); // 收起，本次冷却 3 小时
    greetingRef.current = null;
    setGreeting(null);
  };

  const handleGreetingMute = async () => {
    await dismissGreetingToday(); // 今天之内不再弹
    greetingRef.current = null;
    setGreeting(null);
  };

  return (
    <View style={styles.container}>
      {/* 顶部栏 */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>AI 对话</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.iconBtn} onPress={() => setShowSaved(true)}>
            <Ionicons name="bookmark-outline" size={20} color={COLORS.textLight} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={() => setShowNew(true)}>
            <Ionicons name="add" size={24} color={COLORS.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* AI 主动问候卡：加载中 */}
      {greetingLoading && !greeting && (
        <View style={styles.greetingCard}>
          <View style={styles.greetingTop}>
            <View style={styles.greetingAvatar}>
              <Ionicons name="sparkles" size={16} color="#fff" />
            </View>
            <Text style={styles.greetingTitle}>AI 主动问候</Text>
          </View>
          <Text style={styles.greetingText}>正在想一个话题…</Text>
        </View>
      )}

      {/* AI 主动问候卡 */}
      {greeting && (
        <View style={styles.greetingCard}>
          <View style={styles.greetingTop}>
            <View style={styles.greetingAvatar}>
              <Ionicons name="sparkles" size={16} color="#fff" />
            </View>
            <Text style={styles.greetingTitle}>AI 主动问候</Text>
            <View style={styles.greetingRemainWrap}>
              <Text style={styles.greetingRemain}>今日剩 {greetingRemain} 次</Text>
            </View>
          </View>
          <Text style={styles.greetingText}>{greeting.text}</Text>
          <View style={styles.greetingActions}>
            <TouchableOpacity style={styles.greetingChat} onPress={handleGreetingChat}>
              <Text style={styles.greetingChatText}>聊两句</Text>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', marginLeft: 'auto', gap: 10 }}>
              <TouchableOpacity style={styles.greetingLater} onPress={handleGreetingLater}>
                <Text style={styles.greetingLaterText}>等下再说</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.greetingMute} onPress={handleGreetingMute}>
                <Text style={styles.greetingMuteText}>不打扰</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="chatbubbles-outline" size={40} color={COLORS.textLighter} />
            <Text style={styles.emptyText}>还没有对话</Text>
            <Text style={styles.emptySub}>点右上角「+」开始一个新话题</Text>
          </View>
        }
        renderItem={({ item }) => (
          <SwipeableRow onDelete={() => handleDelete(item)}>
            <TouchableOpacity style={styles.item} onPress={() => openSession(item)} onLongPress={() => { setRenameTarget(item); setRenameText(item.title); }}>
              <View style={styles.itemIconWrap}>
                <Ionicons name="chatbubble-ellipses-outline" size={20} color={COLORS.primary} />
              </View>
              <View style={styles.itemBody}>
                <View style={styles.itemTop}>
                  <Text style={styles.itemTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.itemTime}>{fmtTime(item.updatedAt)}</Text>
                </View>
                <Text style={styles.itemPreview} numberOfLines={1}>{previewOf(item)}</Text>
                <View style={styles.itemTags}>
                  {item.carryProfile ? <Text style={styles.tagPill}>带画像</Text> : null}
                  {item.carryDataCats.map((c) => (
                    <Text key={c} style={styles.tagPillGhost}>{DATA_CATS.find((x) => x.key === c)?.label}</Text>
                  ))}
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textLighter} />
            </TouchableOpacity>
          </SwipeableRow>
        )}
      />

      {/* 新建会话面板 */}
      <Modal visible={showNew} transparent animationType="slide" onRequestClose={() => setShowNew(false)}>
        <KeyboardAvoidingView style={styles.sheetBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity style={styles.sheetMask} activeOpacity={1} onPress={() => setShowNew(false)} />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>开始新对话</Text>
            <TextInput
              style={styles.titleInput}
              placeholder="给这个对话起个标题（可留空，自动用首条消息）"
              placeholderTextColor={COLORS.textLighter}
              value={newTitle}
              onChangeText={setNewTitle}
            />
            <View style={styles.switchRow}>
              <View style={styles.switchLeft}>
                <Ionicons name="person-outline" size={16} color={COLORS.textLight} />
                <Text style={styles.switchLabel}>携带个人画像</Text>
              </View>
              <Switch value={carryProfile} onValueChange={setCarryProfile} trackColor={{ false: COLORS.border, true: COLORS.primary }} thumbColor="#fff" />
            </View>
            <Text style={styles.subLabel}>携带个人数据（AI 可参考，可不选）</Text>
            <View style={styles.chips}>
              {DATA_CATS.map((c) => {
                const on = carryCats.includes(c.key);
                return (
                  <TouchableOpacity
                    key={c.key}
                    style={[styles.chip, on && styles.chipActive]}
                    onPress={() => setCarryCats((prev) => (on ? prev.filter((x) => x !== c.key) : [...prev, c.key]))}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextActive]}>{c.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity style={styles.confirmBtn} onPress={handleNew}>
              <Text style={styles.confirmBtnText}>开始对话</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowNew(false)}>
              <Text style={styles.cancelBtnText}>取消</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 重命名面板 */}
      <Modal visible={renameTarget !== null} transparent animationType="fade" onRequestClose={() => setRenameTarget(null)}>
        <KeyboardAvoidingView style={styles.sheetBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity style={styles.sheetMask} activeOpacity={1} onPress={() => setRenameTarget(null)} />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>重命名对话</Text>
            <TextInput style={styles.titleInput} value={renameText} onChangeText={setRenameText} placeholder="对话标题" placeholderTextColor={COLORS.textLighter} />
            <TouchableOpacity style={styles.confirmBtn} onPress={handleRename}>
              <Text style={styles.confirmBtnText}>保存</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setRenameTarget(null)}>
              <Text style={styles.cancelBtnText}>取消</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 已保存对话稿 */}
      <Modal visible={showSaved} transparent animationType="slide" onRequestClose={() => setShowSaved(false)}>
        <View style={styles.savedBackdrop}>
          <View style={styles.savedSheet}>
            <View style={styles.savedHeader}>
              <Text style={styles.sheetTitle}>已保存的对话稿</Text>
              <TouchableOpacity onPress={() => setShowSaved(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={saved}
              keyExtractor={(i) => i.id}
              contentContainerStyle={styles.savedList}
              ListEmptyComponent={<Text style={styles.emptySub}>还没有保存的对话稿</Text>}
              renderItem={({ item }) => (
                <View style={styles.savedItem}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.savedTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.savedMeta}>{item.messageCount} 条 · {item.format === 'md' ? 'Markdown' : '带时间文本'} · {fmtTime(item.createdAt)}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.savedDel}
                    onPress={() => { Alert.alert('删除', '确定删除这份保存？', [{ text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: async () => { await deleteSavedChat(item.id); refresh(); } }]); }}
                  >
                    <Ionicons name="trash-outline" size={18} color={COLORS.textLight} />
                  </TouchableOpacity>
                </View>
              )}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: TOP_INSET + 14, paddingBottom: 10, paddingHorizontal: 16,
    backgroundColor: COLORS.card, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: { padding: 6, marginLeft: 6 },
  list: { padding: 12, paddingBottom: 30 },
  empty: { alignItems: 'center', marginTop: 100 },
  emptyText: { fontSize: 15, color: COLORS.textLight, marginTop: 12 },
  emptySub: { fontSize: 12.5, color: COLORS.textLighter, marginTop: 6, textAlign: 'center' },
  item: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.card,
    borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.border,
  },
  itemIconWrap: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: COLORS.secondary,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  itemBody: { flex: 1, marginRight: 8 },
  itemTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  itemTitle: { flex: 1, fontSize: 15, fontWeight: '600', color: COLORS.text, marginRight: 8 },
  itemTime: { fontSize: 11, color: COLORS.textLighter },
  itemPreview: { fontSize: 13, color: COLORS.textLight, marginTop: 3 },
  itemTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  tagPill: { fontSize: 10.5, color: COLORS.primary, backgroundColor: COLORS.secondary, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, fontWeight: '600' },
  tagPillGhost: { fontSize: 10.5, color: COLORS.textLight, backgroundColor: COLORS.background, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  // 底部面板
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end' },
  sheetMask: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: COLORS.card, borderTopLeftRadius: 18, borderTopRightRadius: 18,
    padding: 18, paddingBottom: 28,
  },
  sheetTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text, marginBottom: 14, textAlign: 'center' },
  titleInput: {
    backgroundColor: COLORS.background, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11,
    fontSize: 14, color: COLORS.text, marginBottom: 14, borderWidth: 0.5, borderColor: COLORS.border,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  switchLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  switchLabel: { fontSize: 14, color: COLORS.text, fontWeight: '500' },
  subLabel: { fontSize: 12.5, color: COLORS.textLight, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14,
    backgroundColor: COLORS.background, borderWidth: 0.5, borderColor: COLORS.border,
  },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { fontSize: 13, color: COLORS.text },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  confirmBtn: { backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginBottom: 8 },
  confirmBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  cancelBtn: { backgroundColor: COLORS.background, borderRadius: 12, paddingVertical: 11, alignItems: 'center', borderWidth: 0.5, borderColor: COLORS.border },
  cancelBtnText: { color: COLORS.textLight, fontSize: 14, fontWeight: '500' },
  // 已保存
  savedBackdrop: { flex: 1, backgroundColor: COLORS.background },
  savedSheet: { flex: 1, backgroundColor: COLORS.background, paddingTop: TOP_INSET + 14, paddingHorizontal: 14 },
  savedHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  savedList: { paddingTop: 10 },
  savedItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.card, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 0.5, borderColor: COLORS.border },
  savedTitle: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  savedMeta: { fontSize: 11.5, color: COLORS.textLighter, marginTop: 3 },
  savedDel: { padding: 8, marginLeft: 8 },
  // AI 主动问候卡
  greetingCard: { backgroundColor: COLORS.primary, borderRadius: 16, padding: 14, margin: 12, marginBottom: 4, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  greetingTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  greetingAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.28)', alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  greetingTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: '#fff' },
  greetingRemainWrap: { backgroundColor: 'rgba(255,255,255,0.22)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  greetingRemain: { fontSize: 11, color: '#fff', fontWeight: '600' },
  greetingText: { fontSize: 15, color: '#fff', lineHeight: 22, marginBottom: 12 },
  greetingActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  greetingChat: { backgroundColor: '#fff', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 18 },
  greetingChatText: { color: COLORS.primary, fontSize: 14, fontWeight: '700' },
  greetingLater: { paddingVertical: 8, paddingHorizontal: 4 },
  greetingLaterText: { color: 'rgba(255,255,255,0.92)', fontSize: 13 },
  greetingMute: { paddingVertical: 8, paddingHorizontal: 4 },
  greetingMuteText: { color: 'rgba(255,255,255,0.92)', fontSize: 13 },
});

export default ChatSessionsPage;
