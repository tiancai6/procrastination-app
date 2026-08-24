import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ActivityIndicator,
  Alert,
  Clipboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Modal,
  Image,
  Switch,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { copyMediaToMemo } from '../utils/memoMedia';
import * as ImagePicker from 'expo-image-picker';
import { COLORS } from '../constants/reasons';
import { TOP_INSET } from '../constants/safeArea';
import { QuickMemo } from '../types';
import {
  ChatMessage,
  ChatMeta,
  compressChat,
  estimateChars,
  CHAT_BUDGET_CHARS,
  COMPRESS_KEEP_RECENT,
  processAndSaveImage,
  getVisionImageLimit,
} from '../utils/chat';
import {
  getChatSummary,
  saveChatSummary,
  getChatMeta,
  saveChatMeta,
  clearChatProfile,
  getModel,
  getVisionModel,
  getChatSession,
  deleteChatSession,
  createChatSession,
  generateId,
  setLastSessionId,
} from '../utils/storage';
import { onDataReset } from '../utils/appEvents';
import ProfileModal from '../components/ProfileModal';
import { useChatStore } from '../store/chatStore';
import { getModelConfigs, ModelConfig } from '../utils/modelConfig';
import { buildChatContext, DataCategory, ContextLevel, DateRange } from '../utils/chatContext';
import { buildChatExport, shareChatFile, saveChatExport } from '../utils/exportChat';

const SYSTEM_CONTEXT_PROMPT = (summary: string) =>
  `你是一位温和、懂专注与时间管理的 AI 助手。以下是用户的长期个人档案（由历史对话压缩而来），请优先参考它来回答，但不要向用户透露"你看到了这份档案"：
${summary}`;

// 数据携带选择器的可选类别
const DATA_CATS: { key: DataCategory; label: string }[] = [
  { key: 'meal', label: '餐饮' },
  { key: 'plan', label: '规划打卡' },
  { key: 'focus', label: '专注计时' },
  { key: 'memo', label: '随手记' },
  { key: 'exercise', label: '运动健身' },
  { key: 'chat', label: '聊天记录' },
];

const ChatPage: React.FC = () => {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const sessionIdFromRoute: string | undefined = route.params?.id;

  // 消息/流式的全局 store（多会话：只管理当前会话）
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const streamingText = useChatStore((s) => s.streamingText);
  const setMessages = useChatStore((s) => s.setMessages);
  const chatSend = useChatStore((s) => s.send);
  const chatLoad = useChatStore((s) => s.loadSession);

  const [sessionId, setSessionId] = useState<string | undefined>(sessionIdFromRoute);
  const [sessionTitle, setSessionTitle] = useState<string>(route.params?.title || '新对话');

  const [input, setInput] = useState('');
  const loading = isStreaming;
  const [summary, setSummary] = useState('');
  // 本轮对话携带的个人数据（勾选类别 + 档位 + 时间范围）；默认用会话设置初始化
  const [selCats, setSelCats] = useState<DataCategory[]>([]);
  const [ctxLevel, setCtxLevel] = useState<ContextLevel>('summary');
  const [ctxRange, setCtxRange] = useState<DateRange>('today');
  const [carryProfile, setCarryProfile] = useState(true);
  // 联网搜索开关
  const [webSearch, setWebSearch] = useState(false);
  // 对话可选模型
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [selModelId, setSelModelId] = useState('');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [toolPanelExpanded, setToolPanelExpanded] = useState(false);
  const selCfg: ModelConfig | undefined = selModelId ? models.find((m) => m.id === selModelId) || undefined : undefined;
  const [meta, setMeta] = useState<ChatMeta>({ compressCount: 0, lastCompressedAt: null });
  const [compressLoading, setCompressLoading] = useState(false);

  const [model, setModel] = useState('glm-4-flash');
  const [visionModel, setVisionModel] = useState('glm-4v-flash');
  const [pendingImages, setPendingImages] = useState<string[]>([]);

  // 批量删除选择模式
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<{ [id: string]: boolean }>({});
  const [copyText, setCopyText] = useState<string | null>(null);
  const [profileVisible, setProfileVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [exportVisible, setExportVisible] = useState(false);

  const flatRef = useRef<FlatList>(null);
  const loaded = useRef(false);

  // 加载会话设置（携带画像/数据类别默认勾选）
  const applySessionSettings = useCallback(async (id: string) => {
    const s = await getChatSession(id);
    if (s) {
      setSessionTitle(s.title);
      setCarryProfile(s.carryProfile);
      setSelCats(s.carryDataCats);
      setCtxLevel(s.ctxLevel);
      setCtxRange(s.ctxRange);
    }
  }, []);

  const reload = async () => {
    const [sum, m, md, vmd] = await Promise.all([
      getChatSummary(),
      getChatMeta(),
      getModel(),
      getVisionModel(),
    ]);
    setSummary(sum);
    setMeta(m);
    setModel(md || 'glm-4-flash');
    setVisionModel(vmd || 'glm-4v-flash');
    setModels(await getModelConfigs());
  };

  useEffect(() => {
    (async () => {
      let id = sessionIdFromRoute;
      if (!id) {
        const s = await createChatSession();
        navigation.setParams({ id: s.id, title: s.title });
        id = s.id;
      }
      setSessionId(id);
      await setLastSessionId(id);
      await applySessionSettings(id);
      chatLoad(id);
      await reload();
      loaded.current = true;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const off = onDataReset(reload);
    return off;
  }, []);

  const scrollToEnd = useCallback(() => {
    setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 50);
  }, []);

  const estimated = estimateChars(messages, summary);
  const overBudget = estimated > CHAT_BUDGET_CHARS;
  const selectedCount = Object.values(selectedIds).filter(Boolean).length;

  const handleSend = async () => {
    const text = input.trim();
    if ((!text && pendingImages.length === 0) || isStreaming || compressLoading) return;
    const sid = sessionId;
    if (!sid) return;
    setInput('');
    setPendingImages([]);
    scrollToEnd();
    try {
      const summaryCtx = carryProfile && summary ? SYSTEM_CONTEXT_PROMPT(summary) : undefined;
      let dataCtx: string | undefined;
      if (selCats.length > 0) {
        dataCtx = await buildChatContext(selCats, ctxLevel, ctxRange);
      }
      const finalCtx = [summaryCtx, dataCtx && dataCtx.trim() ? dataCtx : undefined]
        .filter(Boolean)
        .join('\n\n');
      await chatSend(sid, text, pendingImages, finalCtx || undefined, webSearch, selCfg);
    } catch (e: any) {
      Alert.alert('发送失败', e?.message ? String(e.message) : '请检查网络或 API Key');
    }
  };

  const startImagePick = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted' && perm.accessPrivileges !== 'limited') {
        Alert.alert('需要相册权限', '请在系统设置中允许访问照片后重试。');
        return;
      }
      const cap = getVisionImageLimit(visionModel);
      if (pendingImages.length >= cap) {
        Alert.alert(
          '已达图片上限',
          `当前图片模型「${visionModel}」最多支持 ${cap} 张${cap === 1 ? '。如需一次发多张，请在「我的 → AI 智能分析」把图片模型改成 glm-4v 或 glm-4v-plus（最多 5 张）' : ''}。`,
        );
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'] as any,
        quality: 1,
        allowsEditing: false,
        allowsMultipleSelection: true,
        selectionLimit: cap - pendingImages.length,
      });
      if (!res.canceled && res.assets && res.assets.length) {
        const added: string[] = [];
        for (const asset of res.assets) {
          if (!asset.uri) continue;
          const uri = await processAndSaveImage(asset.uri);
          added.push(uri);
        }
        if (added.length) setPendingImages((prev) => [...prev, ...added].slice(0, cap));
      }
    } catch (e: any) {
      console.error('[Chat] pickImage failed', e);
      Alert.alert('选择图片失败', e?.message ? String(e.message) : '无法打开相册，请重试');
    }
  };

  const handleCompress = async () => {
    if (!sessionId || loading || compressLoading) return;
    if (messages.length <= COMPRESS_KEEP_RECENT) {
      Alert.alert('暂不需要压缩', `当前对话只有 ${messages.length} 条，还不到压缩阈值。`);
      return;
    }
    const old = messages.slice(0, messages.length - COMPRESS_KEEP_RECENT);
    const recent = messages.slice(messages.length - COMPRESS_KEEP_RECENT);
    setCompressLoading(true);
    try {
      const newMd = await compressChat(summary, old);
      const newMeta: ChatMeta = { compressCount: meta.compressCount + 1, lastCompressedAt: Date.now() };
      setSummary(newMd);
      setMeta(newMeta);
      setMessages(recent);
      await Promise.all([saveChatSummary(newMd), saveChatMeta(newMeta), useChatStore.getState().saveMessages(recent)]);
      Alert.alert('已压缩', '旧对话已压成摘要，下次对话会参考这份摘要。');
    } catch (e: any) {
      Alert.alert('压缩失败', e?.message ? String(e.message) : '请稍后重试');
    } finally {
      setCompressLoading(false);
    }
  };

  const handleSaveToMemo = async (item: ChatMessage) => {
    if (!item.content && (!item.images || item.images.length === 0)) {
      Alert.alert('无法保存', '这条消息没有文字也没有图片');
      return;
    }
    const memoId = generateId();
    const media: { type: 'image'; file: string }[] = [];
    for (const uri of item.images || []) {
      try {
        const file = await copyMediaToMemo(memoId, uri);
        media.push({ type: 'image', file });
      } catch (e) {
        console.error('[ChatPage] 复制聊天图片到随手记失败', uri, e);
      }
    }
    const memo: QuickMemo = {
      id: memoId,
      content: item.content || (item.images && item.images.length > 0 ? '[图片消息]' : ''),
      highlightRanges: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pinned: false,
      media,
      tags: ['AI对话'],
    };
    try {
      const { addQuickMemo } = await import('../utils/storage');
      await addQuickMemo(memo);
      Alert.alert('已存到随手记', '可在「随手记」标签页查看这条记录');
    } catch (e: any) {
      Alert.alert('保存失败', e?.message ? String(e.message) : '请稍后重试');
    }
  };

  // —— 删除三动作（区分）——
  const handleClearCurrent = () => {
    if (!sessionId) return;
    Alert.alert('清空当前对话', '将删除这个会话里的全部聊天消息，但个人画像与其他会话不受影响。', [
      { text: '取消', style: 'cancel' },
      {
        text: '清空',
        style: 'destructive',
        onPress: async () => {
          await useChatStore.getState().clearSession(sessionId);
          setMessages([]);
        },
      },
    ]);
  };

  const handleDeleteProfile = () => {
    Alert.alert(
      '删除个人画像',
      '将删除由历史对话压缩而成的长期个人档案（"个人 Skill"）。所有会话的「携带画像」都会失效，且不可恢复。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            await clearChatProfile();
            setSummary('');
            Alert.alert('已删除', '长期个人画像已清空。');
          },
        },
      ],
    );
  };

  const handleDeleteSession = () => {
    if (!sessionId) return;
    Alert.alert('删除此会话', `将移除「${sessionTitle}」整个对话（含全部消息）。其他会话不受影响。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await deleteChatSession(sessionId);
          navigation.goBack();
        },
      },
    ]);
  };

  // —— 导出选择 ——
  const doExport = async (format: 'md' | 'txt', saveOnly: boolean) => {
    const ids = Object.keys(selectedIds).filter((k) => selectedIds[k]);
    const chosen = ids.length ? messages.filter((m) => ids.includes(m.id)) : messages;
    if (chosen.length === 0) {
      Alert.alert('没有内容', '请先选择要导出的消息');
      return;
    }
    const content = buildChatExport(chosen, sessionTitle, format);
    setExportVisible(false);
    try {
      if (saveOnly) {
        await saveChatExport(content, sessionTitle, format, chosen.length);
        Alert.alert('已保存', '对话稿已存到「AI 对话 → 右上角书签」里的「已保存的对话稿」');
      } else {
        await shareChatFile(content, sessionTitle, format);
      }
    } catch (e: any) {
      // 分享不可用时改存到我的保存
      try {
        await saveChatExport(content, sessionTitle, format, chosen.length);
        Alert.alert('已存到我的保存', '当前环境不支持系统分享，已改为存到「已保存的对话稿」');
      } catch {
        Alert.alert('导出失败', e?.message ? String(e.message) : '请稍后重试');
      }
    }
  };

  // —— 批量删除选择 ——
  const enterSelecting = useCallback(() => {
    setIsSelecting(true);
    setSelectedIds({});
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const cancelSelect = useCallback(() => {
    setIsSelecting(false);
    setSelectedIds({});
  }, []);

  const deleteSelected = () => {
    const ids = Object.keys(selectedIds).filter((k) => selectedIds[k]);
    if (ids.length === 0) return;
    Alert.alert('删除选中', `确定删除选中的 ${ids.length} 条消息吗？此操作不可撤销。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          const removeSet = new Set(ids);
          const next = messages.filter((m) => !removeSet.has(m.id));
          setMessages(next);
          setIsSelecting(false);
          setSelectedIds({});
          await useChatStore.getState().saveMessages(next);
        },
      },
    ]);
  };

  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => (
      <ChatRow
        item={item}
        isSelecting={isSelecting}
        selected={!!selectedIds[item.id]}
        onCopy={setCopyText}
        onToggleSelect={toggleSelect}
        onSaveToMemo={handleSaveToMemo}
      />
    ),
    [isSelecting, selectedIds, setCopyText, toggleSelect, handleSaveToMemo],
  );

  return (
    <View style={{ flex: 1 }}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
      >
        {/* 顶部栏 */}
        {isSelecting ? (
          <View style={styles.headerSelect}>
            <TouchableOpacity style={styles.cancelBtn} onPress={cancelSelect}>
              <Text style={styles.cancelText}>取消</Text>
            </TouchableOpacity>
            <Text style={styles.selTitle}>已选 {selectedCount} 条</Text>
            <View style={styles.selActions}>
              <TouchableOpacity style={styles.selExportBtn} onPress={() => setExportVisible(true)}>
                <Ionicons name="share-outline" size={18} color={COLORS.primary} />
                <Text style={styles.selExportText}>导出</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.delSelBtn, selectedCount === 0 && styles.delSelDisabled]}
                onPress={deleteSelected}
                disabled={selectedCount === 0}
              >
                <Ionicons name="trash" size={18} color={selectedCount === 0 ? COLORS.textLighter : '#fff'} />
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.header}>
            <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="chevron-back" size={24} color={COLORS.text} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerTitleWrap} onPress={() => navigation.goBack()}>
              <Text style={styles.headerTitle} numberOfLines={1}>{sessionTitle}</Text>
            </TouchableOpacity>
            <View style={styles.headerActions}>
              <TouchableOpacity style={styles.iconBtn} onPress={enterSelecting}>
                <Ionicons name="checkbox-outline" size={20} color={COLORS.textLight} />
              </TouchableOpacity>
              {summary ? (
                <View style={styles.summaryBadge}>
                  <Ionicons name="layers-outline" size={13} color={COLORS.primary} />
                  <Text style={styles.summaryBadgeText}>已压缩 {meta.compressCount} 次</Text>
                </View>
              ) : null}
              <TouchableOpacity style={styles.iconBtn} onPress={() => setProfileVisible(true)}>
                <Ionicons name="book-outline" size={20} color={COLORS.textLight} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconBtn} onPress={() => setMenuVisible(true)}>
                <Ionicons name="ellipsis-vertical" size={20} color={COLORS.textLight} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {overBudget && !isSelecting && (
          <View style={styles.hintBar}>
            <Ionicons name="alert-circle-outline" size={16} color={COLORS.warning} />
            <Text style={styles.hintText}>上下文偏长，压缩后可让 AI 记得更准、响应更快</Text>
            <TouchableOpacity style={styles.hintBtn} onPress={handleCompress} disabled={compressLoading}>
              <Text style={styles.hintBtnText}>压缩</Text>
            </TouchableOpacity>
          </View>
        )}

        {isSelecting && (
          <View style={styles.selectTipBar}>
            <Ionicons name="information-circle-outline" size={14} color={COLORS.primary} />
            <Text style={styles.selectTipText}>点击消息可多选，选中后可「导出」或「删除」</Text>
          </View>
        )}

        {/* 消息列表 */}
        <FlatList
          ref={flatRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          extraData={selectedIds}
          style={{ flex: 1 }}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={scrollToEnd}
          ListFooterComponent={
            isStreaming && streamingText
              ? () => (
                  <View style={[styles.row, styles.rowBot]}>
                    <View style={[styles.bubble, styles.bubbleBot]}>
                      <Text style={[styles.bubbleText, styles.bubbleTextBot]}>{streamingText}</Text>
                    </View>
                  </View>
                )
              : null
          }
          initialNumToRender={12}
          maxToRenderPerBatch={8}
          windowSize={6}
          removeClippedSubviews={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="chatbubbles-outline" size={42} color={COLORS.textLighter} />
              <Text style={styles.emptyText}>和 AI 聊聊你的专注、规划与随手记吧</Text>
              <Text style={styles.emptySub}>对话变长时，点右上角「压缩」可生成长期摘要</Text>
            </View>
          }
        />

        {/* 输入栏（可折叠：默认收起，只留模型选择 + 展开按钮） */}
        {!isSelecting && (
          <View style={styles.dataBar}>
            <View style={styles.modelPickRow}>
              <TouchableOpacity
                style={styles.modelPickMain}
                onPress={() => {
                  if (!toolPanelExpanded) setToolPanelExpanded(true);
                  setShowModelPicker((v) => !v);
                }}
              >
                <Ionicons name="swap-horizontal-outline" size={14} color={COLORS.primary} />
                <Text style={styles.modelPickText} numberOfLines={1}>
                  {selCfg ? selCfg.name : '默认（' + (models.find((m) => m.isDefault)?.name || '未配置') + '）'}
                </Text>
                <Ionicons name={showModelPicker ? 'chevron-up' : 'chevron-down'} size={14} color={COLORS.textLight} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.toolExpandBtn}
                onPress={() => {
                  setToolPanelExpanded((v) => !v);
                  setShowModelPicker(false);
                }}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Ionicons name={toolPanelExpanded ? 'chevron-down' : 'chevron-up'} size={18} color={COLORS.textLight} />
              </TouchableOpacity>
            </View>
            {showModelPicker && (
              <View style={styles.modelPickBox}>
                <TouchableOpacity
                  style={[styles.modelPickItem, !selModelId && styles.modelPickItemActive]}
                  onPress={() => { setSelModelId(''); setShowModelPicker(false); }}
                >
                  <Text style={styles.modelPickItemText}>默认（{models.find((m) => m.isDefault)?.name || '未配置'}）</Text>
                </TouchableOpacity>
                {models.map((m) => (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.modelPickItem, selModelId === m.id && styles.modelPickItemActive]}
                    onPress={() => { setSelModelId(m.id); setShowModelPicker(false); }}
                  >
                    <Text style={styles.modelPickItemText}>
                      {m.name}{m.isVision ? ' · 视觉' : ''}{m.webSearch ? ' · 搜索' : ''}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {toolPanelExpanded && (
              <>
                <View style={styles.dataBarHead}>
                  <Ionicons name="folder-open-outline" size={14} color={COLORS.textLight} />
                  <Text style={styles.dataBarTitle}>携带数据（AI 可参考）</Text>
                  {selCats.length > 0 && (
                    <TouchableOpacity onPress={() => setSelCats([])} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                      <Text style={styles.dataClear}>清空</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={styles.dataChips}>
                  {DATA_CATS.map((c) => {
                    const on = selCats.includes(c.key);
                    return (
                      <TouchableOpacity
                        key={c.key}
                        style={[styles.dataChip, on && styles.dataChipActive]}
                        onPress={() => setSelCats((prev) => (on ? prev.filter((x) => x !== c.key) : [...prev, c.key]))}
                      >
                        <Text style={[styles.dataChipText, on && styles.dataChipTextActive]}>{c.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View style={styles.searchRow}>
                  <Ionicons name="person-outline" size={14} color={COLORS.textLight} />
                  <Text style={styles.searchLabel}>携带个人画像（长期记忆）</Text>
                  <Switch
                    value={carryProfile}
                    onValueChange={setCarryProfile}
                    trackColor={{ false: COLORS.border, true: COLORS.primary }}
                    thumbColor="#fff"
                    style={styles.searchSwitch}
                  />
                </View>
                <View style={styles.searchRow}>
                  <Ionicons name="globe-outline" size={14} color={COLORS.textLight} />
                  <Text style={styles.searchLabel}>联网搜索（实时联网，查最新信息）</Text>
                  <Switch
                    value={webSearch}
                    onValueChange={setWebSearch}
                    trackColor={{ false: COLORS.border, true: COLORS.primary }}
                    thumbColor="#fff"
                    style={styles.searchSwitch}
                  />
                </View>
                {selCats.length > 0 && (
                  <View style={styles.dataSubRow}>
                    <View style={styles.segGroup}>
                      {(['summary', 'raw'] as ContextLevel[]).map((lv) => (
                        <TouchableOpacity
                          key={lv}
                          style={[styles.segBtn, ctxLevel === lv && styles.segBtnActive]}
                          onPress={() => setCtxLevel(lv)}
                        >
                          <Text style={[styles.segText, ctxLevel === lv && styles.segTextActive]}>
                            {lv === 'summary' ? '总结' : '原始明细'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <View style={styles.segGroup}>
                      {(['today', '7d', 'month'] as DateRange[]).map((rg) => (
                        <TouchableOpacity
                          key={rg}
                          style={[styles.segBtn, ctxRange === rg && styles.segBtnActive]}
                          onPress={() => setCtxRange(rg)}
                        >
                          <Text style={[styles.segText, ctxRange === rg && styles.segTextActive]}>
                            {rg === 'today' ? '今天' : rg === '7d' ? '近7天' : '本月'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}
              </>
            )}
          </View>
        )}

        {!isSelecting && (
          <View style={styles.inputBar}>
            {pendingImages.length > 0 && (
              <View style={styles.pendingImages}>
                {pendingImages.map((uri) => (
                  <View key={uri} style={styles.pendingImgWrap}>
                    <Image source={{ uri }} style={styles.pendingImg} resizeMode="cover" />
                    <TouchableOpacity style={styles.pendingImgRemove} onPress={() => setPendingImages((prev) => prev.filter((u) => u !== uri))}>
                      <Ionicons name="close" size={12} color="#fff" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
            <View style={styles.inputRow}>
              <TouchableOpacity style={styles.imgPickBtn} onPress={startImagePick} disabled={loading}>
                <Ionicons name="image-outline" size={22} color={COLORS.primary} />
              </TouchableOpacity>
              <TextInput
                style={styles.input}
                placeholder="说点什么…"
                placeholderTextColor={COLORS.textLighter}
                value={input}
                onChangeText={setInput}
                multiline
              />
              <TouchableOpacity
                style={[styles.sendBtn, ((!input.trim() && pendingImages.length === 0) || loading) && styles.sendBtnDisabled]}
                onPress={handleSend}
                disabled={(!input.trim() && pendingImages.length === 0) || loading}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="send" size={18} color="#fff" />
                )}
              </TouchableOpacity>
            </View>
            {pendingImages.length > 0 && (
              <Text style={styles.visionHint}>
                含图片，将使用视觉模型 {visionModel} 识别（最多 {getVisionImageLimit(visionModel)} 张）
              </Text>
            )}
          </View>
        )}
      </KeyboardAvoidingView>

      {/* 复制浮层 */}
      <Modal visible={copyText !== null} transparent animationType="fade" onRequestClose={() => setCopyText(null)}>
        <TouchableOpacity style={styles.copyOverlay} activeOpacity={1} onPress={() => setCopyText(null)}>
          <View style={styles.copyCard} onStartShouldSetResponder={() => true}>
            <View style={styles.copyCardHeader}>
              <Text style={styles.copyCardTitle}>复制内容</Text>
              <TouchableOpacity onPress={() => setCopyText(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={20} color={COLORS.textLight} />
              </TouchableOpacity>
            </View>
            <TextInput style={styles.copyTextInput} value={copyText || ''} editable={false} multiline selectTextOnFocus textAlignVertical="top" />
            <TouchableOpacity style={styles.copyAllBtn} onPress={() => { if (copyText) Clipboard.setString(copyText); }}>
              <Ionicons name="copy-outline" size={16} color="#fff" />
              <Text style={styles.copyAllText}>复制全部</Text>
            </TouchableOpacity>
            <Text style={styles.copyHint}>长按上方文字可选择任意一段，再点系统「复制」；或点上面「复制全部」</Text>
            <TouchableOpacity style={styles.copyDoneBtn} onPress={() => setCopyText(null)}>
              <Text style={styles.copyDoneText}>完成</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ⋯ 菜单：删除区分 + 压缩 + 档案 */}
      <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <TouchableOpacity style={styles.copyOverlay} activeOpacity={1} onPress={() => setMenuVisible(false)}>
          <View style={styles.menuCard} onStartShouldSetResponder={() => true}>
            <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuVisible(false); handleCompress(); }}>
              <Ionicons name="layers-outline" size={20} color={COLORS.primary} />
              <Text style={styles.menuItemText}>压缩旧对话为摘要</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuVisible(false); setProfileVisible(true); }}>
              <Ionicons name="book-outline" size={20} color={COLORS.textLight} />
              <Text style={styles.menuItemText}>查看 / 编辑个人画像</Text>
            </TouchableOpacity>
            <View style={styles.menuDivider} />
            <Text style={styles.menuGroupLabel}>删除</Text>
            <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuVisible(false); handleClearCurrent(); }}>
              <Ionicons name="trash-outline" size={20} color={COLORS.textLight} />
              <View style={styles.menuItemBody}>
                <Text style={styles.menuItemText}>清空当前对话</Text>
                <Text style={styles.menuItemSub}>仅删除本会话消息，不影响画像与其他会话</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.menuItem, styles.menuItemDanger]} onPress={() => { setMenuVisible(false); handleDeleteProfile(); }}>
              <Ionicons name="person-remove-outline" size={20} color="#E5484D" />
              <View style={styles.menuItemBody}>
                <Text style={[styles.menuItemText, styles.menuItemTextDanger]}>删除个人画像</Text>
                <Text style={styles.menuItemSub}>清空长期记忆，所有会话的「携带画像」失效</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.menuItem, styles.menuItemDanger]} onPress={() => { setMenuVisible(false); handleDeleteSession(); }}>
              <Ionicons name="close-circle-outline" size={20} color="#E5484D" />
              <View style={styles.menuItemBody}>
                <Text style={[styles.menuItemText, styles.menuItemTextDanger]}>删除此会话</Text>
                <Text style={styles.menuItemSub}>移除整个对话（含全部消息），其他会话不受影响</Text>
              </View>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 导出面板 */}
      <Modal visible={exportVisible} transparent animationType="fade" onRequestClose={() => setExportVisible(false)}>
        <TouchableOpacity style={styles.copyOverlay} activeOpacity={1} onPress={() => setExportVisible(false)}>
          <View style={styles.menuCard} onStartShouldSetResponder={() => true}>
            <Text style={styles.menuGroupLabel}>导出当前选择（{selectedCount || messages.length} 条）</Text>
            <TouchableOpacity style={styles.menuItem} onPress={() => doExport('md', false)}>
              <Ionicons name="logo-markdown" size={20} color={COLORS.primary} />
              <View style={styles.menuItemBody}>
                <Text style={styles.menuItemText}>分享为 Markdown（.md）</Text>
                <Text style={styles.menuItemSub}>带角色与时间，适合存档/再编辑</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => doExport('txt', false)}>
              <Ionicons name="document-text-outline" size={20} color={COLORS.primary} />
              <View style={styles.menuItemBody}>
                <Text style={styles.menuItemText}>分享为带时间文本（.txt）</Text>
                <Text style={styles.menuItemSub}>每行 [时间] 角色：内容</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => doExport('md', true)}>
              <Ionicons name="bookmark-outline" size={20} color={COLORS.textLight} />
              <View style={styles.menuItemBody}>
                <Text style={styles.menuItemText}>存到我的保存</Text>
                <Text style={styles.menuItemSub}>存进 App 内「已保存的对话稿」，可随时回看</Text>
              </View>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <ProfileModal
        visible={profileVisible}
        summary={summary}
        onClose={() => setProfileVisible(false)}
        onSaved={async () => {
          const s = await getChatSummary();
          setSummary(s);
        }}
        onRequestCompress={handleCompress}
      />
    </View>
  );
};

// 单条消息气泡
const ChatRow = memo(
  ({
    item,
    isSelecting,
    selected,
    onCopy,
    onToggleSelect,
    onSaveToMemo,
  }: {
    item: ChatMessage;
    isSelecting: boolean;
    selected: boolean;
    onCopy: (text: string) => void;
    onToggleSelect: (id: string) => void;
    onSaveToMemo: (item: ChatMessage) => void;
  }) => {
    const isUser = item.role === 'user';

    const imagesBlock =
      item.images && item.images.length > 0 ? (
        <View style={styles.bubbleImages}>
          {item.images.map((uri, idx) => (
            <Image key={idx} source={{ uri }} style={styles.bubbleImage} resizeMode="cover" />
          ))}
        </View>
      ) : null;
    const textBlock = item.content ? (
      <Text style={[styles.bubbleText, isUser ? styles.bubbleTextUser : styles.bubbleTextBot]}>{item.content}</Text>
    ) : null;
    const timeBlock = (
      <Text style={[styles.timeText, isUser && styles.timeTextUser]}>
        {new Date(item.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
      </Text>
    );

    if (isSelecting) {
      return (
        <View style={[styles.row, isUser ? styles.rowUser : styles.rowBot]}>
          <TouchableOpacity style={styles.checkBox} onPress={() => onToggleSelect(item.id)}>
            <Ionicons name={selected ? 'checkbox' : 'square-outline'} size={20} color={selected ? COLORS.primary : COLORS.textLight} />
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => onToggleSelect(item.id)}
            onLongPress={() => onToggleSelect(item.id)}
            style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleBot, selected && styles.bubbleSelected]}
          >
            {imagesBlock}
            {textBlock}
            {timeBlock}
          </TouchableOpacity>
        </View>
      );
    }

    const copyBtn = (
      <TouchableOpacity style={styles.copyBtn} onPress={() => onCopy(item.content)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Ionicons name="copy-outline" size={16} color={COLORS.textLight} />
      </TouchableOpacity>
    );
    const memoBtn = (
      <TouchableOpacity style={styles.memoBtn} onPress={() => onSaveToMemo(item)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Ionicons name="bookmark-outline" size={16} color={COLORS.textLight} />
      </TouchableOpacity>
    );

    return (
      <View style={[styles.row, isUser ? styles.rowUser : styles.rowBot]}>
        {isUser ? <View style={styles.rowActions}><View>{copyBtn}</View><View style={{ marginTop: 4 }}>{memoBtn}</View></View> : null}
        <TouchableWithoutFeedback onLongPress={() => onCopy(item.content)}>
          <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleBot]}>
            {imagesBlock}
            {textBlock}
            {timeBlock}
          </View>
        </TouchableWithoutFeedback>
        {!isUser ? <View style={styles.rowActions}><View>{copyBtn}</View><View style={{ marginTop: 4 }}>{memoBtn}</View></View> : null}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: TOP_INSET + 14, paddingBottom: 10, paddingHorizontal: 8,
    backgroundColor: COLORS.card, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backBtn: { padding: 4, width: 32 },
  headerTitleWrap: { flex: 1, marginLeft: 2 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: { padding: 6, marginLeft: 6 },
  summaryBadge: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.secondary,
    borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3, marginRight: 4,
  },
  summaryBadgeText: { fontSize: 11, color: COLORS.primary, marginLeft: 3, fontWeight: '600' },
  headerSelect: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: TOP_INSET + 14, paddingBottom: 10, paddingHorizontal: 16,
    backgroundColor: COLORS.primary, borderBottomWidth: 1, borderBottomColor: COLORS.primary,
  },
  selActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cancelBtn: { paddingVertical: 4, paddingRight: 6 },
  cancelText: { fontSize: 15, color: '#fff', fontWeight: '500' },
  selTitle: { fontSize: 15, color: '#fff', fontWeight: '600' },
  selExportBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 6 },
  selExportText: { fontSize: 14, color: '#fff', fontWeight: '600' },
  delSelBtn: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#E5484D',
    borderRadius: 14, paddingHorizontal: 12, paddingVertical: 5, gap: 4,
  },
  delSelDisabled: { backgroundColor: 'rgba(255,255,255,0.35)' },
  selectTipBar: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.secondary,
    paddingHorizontal: 14, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  selectTipText: { flex: 1, fontSize: 12, color: COLORS.primary, marginLeft: 6 },
  hintBar: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF6E7',
    paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#FBE7BF',
  },
  hintText: { flex: 1, fontSize: 12.5, color: '#92670C', marginLeft: 6 },
  hintBtn: { backgroundColor: COLORS.warning, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4, marginLeft: 8 },
  hintBtnText: { color: '#fff', fontSize: 12.5, fontWeight: '600' },
  listContent: { padding: 14, paddingBottom: 20, flexGrow: 1 },
  row: { flexDirection: 'row', marginBottom: 10, alignItems: 'flex-start' },
  rowUser: { justifyContent: 'flex-end' },
  rowBot: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '78%', padding: 11, paddingBottom: 6, borderRadius: 14 },
  bubbleUser: { backgroundColor: COLORS.primary, borderBottomRightRadius: 4 },
  bubbleBot: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderBottomLeftRadius: 4 },
  bubbleSelected: { borderWidth: 2, borderColor: COLORS.primary },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  bubbleImages: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  bubbleImage: { width: 120, height: 120, borderRadius: 10, backgroundColor: COLORS.background },
  pendingImages: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingBottom: 8 },
  pendingImgWrap: { position: 'relative', width: 64, height: 64 },
  pendingImg: { width: 64, height: 64, borderRadius: 10, backgroundColor: COLORS.background },
  pendingImgRemove: {
    position: 'absolute', top: -4, right: -4, width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
  },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end' },
  imgPickBtn: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: 6,
  },
  visionHint: { fontSize: 11.5, color: COLORS.primary, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 2 },
  bubbleTextUser: { color: '#fff' },
  bubbleTextBot: { color: COLORS.text },
  timeText: { fontSize: 10, color: COLORS.textLighter, marginTop: 4, textAlign: 'right' },
  timeTextUser: { color: 'rgba(255,255,255,0.75)' },
  rowActions: { flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
  copyBtn: { paddingHorizontal: 8, paddingVertical: 10 },
  memoBtn: { paddingHorizontal: 8, paddingVertical: 10 },
  checkBox: { paddingHorizontal: 6, paddingVertical: 10 },
  empty: { alignItems: 'center', marginTop: 80 },
  emptyText: { fontSize: 15, color: COLORS.textLight, marginTop: 12 },
  emptySub: { fontSize: 12, color: COLORS.textLighter, marginTop: 6 },
  inputBar: {
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: COLORS.card, borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  input: {
    flex: 1, backgroundColor: COLORS.background, borderRadius: 18,
    paddingHorizontal: 14, paddingVertical: 9, fontSize: 14, color: COLORS.text, maxHeight: 96,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center', marginLeft: 8,
  },
  sendBtnDisabled: { backgroundColor: COLORS.textLighter },
  copyOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 20, zIndex: 1000,
  },
  copyCard: {
    width: '100%', maxHeight: '80%', backgroundColor: COLORS.card, borderRadius: 16, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 6,
  },
  copyCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  copyCardTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  copyTextInput: {
    maxHeight: 320, fontSize: 15, lineHeight: 22, color: COLORS.text, padding: 12,
    backgroundColor: COLORS.background, borderRadius: 8, marginVertical: 12, textAlignVertical: 'top',
  },
  copyAllBtn: {
    marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: COLORS.textLight, borderRadius: 12, paddingVertical: 9,
  },
  copyAllText: { fontSize: 14, color: '#fff', fontWeight: '600' },
  copyHint: { fontSize: 12, color: COLORS.textLighter, marginTop: 10, textAlign: 'center' },
  copyDoneBtn: {
    marginTop: 12, backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 10, alignItems: 'center',
  },
  copyDoneText: { fontSize: 15, color: '#fff', fontWeight: '600' },
  dataBar: {
    backgroundColor: COLORS.card, borderTopWidth: 1, borderTopColor: COLORS.border,
    paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8,
  },
  modelPickRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 6, paddingVertical: 6,
    borderRadius: 10, backgroundColor: '#EEF2FF', borderWidth: 0.5, borderColor: '#C7D2FE', marginBottom: 8,
  },
  modelPickMain: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, paddingHorizontal: 6 },
  modelPickText: { flex: 1, fontSize: 13, color: COLORS.primary, fontWeight: '600' },
  toolExpandBtn: { padding: 6, marginLeft: 2 },
  modelPickBox: {
    marginBottom: 8, padding: 10, borderRadius: 12, backgroundColor: COLORS.background,
    borderWidth: 0.5, borderColor: COLORS.border,
  },
  modelPickItem: {
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, marginBottom: 6,
    backgroundColor: COLORS.card, borderWidth: 0.5, borderColor: COLORS.border,
  },
  modelPickItemActive: { backgroundColor: '#EDE9FE', borderColor: COLORS.primary },
  modelPickItemText: { fontSize: 13.5, color: COLORS.text },
  dataBarHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  dataBarTitle: { flex: 1, fontSize: 12.5, color: COLORS.textLight, marginLeft: 6, fontWeight: '600' },
  dataClear: { fontSize: 12, color: COLORS.primary, fontWeight: '600' },
  dataChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  searchRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 6 },
  searchLabel: { flex: 1, fontSize: 12.5, color: COLORS.textLight },
  searchSwitch: { transform: [{ scale: 0.8 }] },
  dataChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14,
    backgroundColor: COLORS.background, borderWidth: 0.5, borderColor: COLORS.border,
  },
  dataChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  dataChipText: { fontSize: 13, color: COLORS.text },
  dataChipTextActive: { color: '#fff', fontWeight: '600' },
  dataSubRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, gap: 8 },
  segGroup: { flexDirection: 'row', backgroundColor: COLORS.background, borderRadius: 10, padding: 2, gap: 2 },
  segBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  segBtnActive: { backgroundColor: COLORS.primary },
  segText: { fontSize: 12, color: COLORS.textLight },
  segTextActive: { color: '#fff', fontWeight: '600' },
  // ⋯ 菜单 & 导出面板
  menuCard: {
    width: '100%', backgroundColor: COLORS.card, borderRadius: 16, padding: 8, paddingTop: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 6,
  },
  menuGroupLabel: { fontSize: 11.5, color: COLORS.textLighter, fontWeight: '600', paddingHorizontal: 12, paddingVertical: 6 },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10,
  },
  menuItemDanger: { backgroundColor: 'rgba(229,72,77,0.06)' },
  menuItemBody: { flex: 1 },
  menuItemText: { fontSize: 14.5, color: COLORS.text, fontWeight: '500' },
  menuItemTextDanger: { color: '#E5484D' },
  menuItemSub: { fontSize: 11.5, color: COLORS.textLighter, marginTop: 2 },
  menuDivider: { height: 1, backgroundColor: COLORS.border, marginVertical: 4 },
});

export default ChatPage;
