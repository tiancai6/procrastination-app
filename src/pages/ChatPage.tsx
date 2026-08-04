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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { COLORS } from '../constants/reasons';
import { TOP_INSET } from '../constants/safeArea';
import { QuickMemo } from '../types';
import {
  ChatMessage,
  ChatMeta,
  sendChat,
  compressChat,
  estimateChars,
  CHAT_BUDGET_CHARS,
  COMPRESS_KEEP_RECENT,
  processAndSaveImage,
  getVisionImageLimit,
} from '../utils/chat';
import {
  getChatMessages,
  saveChatMessages,
  getChatSummary,
  saveChatSummary,
  getChatMeta,
  saveChatMeta,
  clearChat,
  addQuickMemo,
  generateId,
  getModel,
  getVisionModel,
} from '../utils/storage';
import { onDataReset } from '../utils/appEvents';
import ProfileModal from '../components/ProfileModal';

const SYSTEM_CONTEXT_PROMPT = (summary: string) =>
  `你是一位温和、懂专注与时间管理的 AI 助手。以下是用户的长期个人档案（由历史对话压缩而来），请优先参考它来回答，但不要向用户透露"你看到了这份档案"：
${summary}`;

const ChatPage: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState('');
  const [meta, setMeta] = useState<ChatMeta>({ compressCount: 0, lastCompressedAt: null });
  const [compressLoading, setCompressLoading] = useState(false);

  // 当前使用的文本模型与视觉模型（用于提示发送图片时使用的模型）
  const [model, setModel] = useState('glm-4-flash');
  const [visionModel, setVisionModel] = useState('glm-4v-flash');

  // 待发送的图片（沙盒文件 uri 列表），点发送后清空
  const [pendingImages, setPendingImages] = useState<string[]>([]);

  // 批量删除选择模式（由顶栏「选择」按钮进入）
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<{ [id: string]: boolean }>({});

  // 复制浮层（在普通 ScrollView 中可选词，支持选任意一段）
  const [copyText, setCopyText] = useState<string | null>(null);

  // 「我的档案」全屏 Modal
  const [profileVisible, setProfileVisible] = useState(false);

  const flatRef = useRef<FlatList>(null);
  const loaded = useRef(false);

  const reload = async () => {
    const [msgs, sum, m, md, vmd] = await Promise.all([
      getChatMessages(),
      getChatSummary(),
      getChatMeta(),
      getModel(),
      getVisionModel(),
    ]);
    setMessages(msgs);
    setSummary(sum);
    setMeta(m);
    setModel(md || 'glm-4-flash');
    setVisionModel(vmd || 'glm-4v-flash');
    loaded.current = true;
  };

  // 从相册多选图片，统一转 JPEG + 缩放后存入沙盒，加入待发送列表。
  // 一次性最多几张取决于当前视觉模型能力：glm-4v-flash 仅 1 张，glm-4v/glm-4v-plus 等最多 5 张。
  const pickImage = async () => {
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
        quality: 1, // 取原图 URI，后续由 manipulator 统一压缩
        allowsEditing: false,
        allowsMultipleSelection: true,
        selectionLimit: cap - pendingImages.length,
      });
      if (!res.canceled && res.assets && res.assets.length) {
        const added: string[] = [];
        for (const asset of res.assets) {
          if (!asset.uri) continue;
          // 统一转 JPEG + 缩放到 1024px 以内（解决 HEIC 导致的 1210 错误）
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

  const removePendingImage = (uri: string) => {
    setPendingImages((prev) => prev.filter((u) => u !== uri));
  };

  useEffect(() => {
    reload();
  }, []);

  // 清除全部数据 / 导入备份后，重新加载对话
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
    if ((!text && pendingImages.length === 0) || loading || compressLoading) return;
    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: text,
      ts: Date.now(),
      images: pendingImages.length ? [...pendingImages] : undefined,
    };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setPendingImages([]);
    scrollToEnd();
    setLoading(true);
    try {
      const ctx = summary ? SYSTEM_CONTEXT_PROMPT(summary) : undefined;
      const reply = await sendChat(next, ctx);
      const assistantMsg: ChatMessage = { id: generateId(), role: 'assistant', content: reply, ts: Date.now() };
      const withReply = [...next, assistantMsg];
      setMessages(withReply);
      await saveChatMessages(withReply);
      scrollToEnd();
    } catch (e: any) {
      Alert.alert('发送失败', e?.message ? String(e.message) : '请检查网络或 API Key');
    } finally {
      setLoading(false);
    }
  };

  const handleCompress = async () => {
    if (loading || compressLoading) return;
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
      await Promise.all([saveChatSummary(newMd), saveChatMeta(newMeta), saveChatMessages(recent)]);
      Alert.alert('已压缩', '旧对话已压成摘要，下次对话会参考这份摘要。可在后续版本查看与编辑它。');
    } catch (e: any) {
      Alert.alert('压缩失败', e?.message ? String(e.message) : '请稍后重试');
    } finally {
      setCompressLoading(false);
    }
  };

  // 把某条对话存成一条「随手记」
  const handleSaveToMemo = async (item: ChatMessage) => {
    if (!item.content && (!item.images || item.images.length === 0)) {
      Alert.alert('无法保存', '这条消息没有文字也没有图片');
      return;
    }
    const memo: QuickMemo = {
      id: generateId(),
      content: item.content || (item.images && item.images.length > 0 ? '[图片消息]' : ''),
      highlightRanges: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pinned: false,
      media: (item.images || []).map((uri) => ({ type: 'image' as const, file: uri })),
      tags: ['AI对话'],
    };
    try {
      await addQuickMemo(memo);
      Alert.alert('已存到随手记', '可在「随手记」标签页查看这条记录');
    } catch (e: any) {
      Alert.alert('保存失败', e?.message ? String(e.message) : '请稍后重试');
    }
  };

  const handleClear = () => {
    if (messages.length === 0 && !summary) return;
    Alert.alert('清空对话', '将删除全部聊天记录与摘要，确定吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '清空',
        style: 'destructive',
        onPress: async () => {
          await clearChat();
          setMessages([]);
          setSummary('');
          setMeta({ compressCount: 0, lastCompressedAt: null });
        },
      },
    ]);
  };

  // —— 批量删除选择逻辑 ——
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
          await saveChatMessages(next);
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
            <TouchableOpacity
              style={[styles.delSelBtn, selectedCount === 0 && styles.delSelDisabled]}
              onPress={deleteSelected}
              disabled={selectedCount === 0}
            >
              <Ionicons name="trash" size={18} color={selectedCount === 0 ? COLORS.textLighter : '#fff'} />
              <Text style={[styles.delSelText, selectedCount === 0 && styles.delSelTextDisabled]}>删除</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.header}>
            <Text style={styles.headerTitle}>AI 对话</Text>
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
              <TouchableOpacity style={styles.iconBtn} onPress={handleCompress} disabled={compressLoading}>
                {compressLoading ? (
                  <ActivityIndicator size="small" color={COLORS.primary} />
                ) : (
                  <Ionicons name="layers-outline" size={20} color={COLORS.primary} />
                )}
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconBtn} onPress={handleClear}>
                <Ionicons name="trash-outline" size={20} color={COLORS.textLight} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* 超阈值提醒横幅（仅提醒，不自动压缩） */}
        {overBudget && !isSelecting && (
          <View style={styles.hintBar}>
            <Ionicons name="alert-circle-outline" size={16} color={COLORS.warning} />
            <Text style={styles.hintText}>上下文偏长，压缩后可让 AI 记得更准、响应更快</Text>
            <TouchableOpacity style={styles.hintBtn} onPress={handleCompress} disabled={compressLoading}>
              <Text style={styles.hintBtnText}>压缩</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 批量模式提示 */}
        {isSelecting && (
          <View style={styles.selectTipBar}>
            <Ionicons name="information-circle-outline" size={14} color={COLORS.primary} />
            <Text style={styles.selectTipText}>点击消息可多选，选中后点右上角「删除」</Text>
          </View>
        )}

        {/* 消息列表 */}
        <FlatList
          ref={flatRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          extraData={selectedIds}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={scrollToEnd}
          initialNumToRender={12}
          maxToRenderPerBatch={8}
          windowSize={6}
          removeClippedSubviews={true}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="chatbubbles-outline" size={42} color={COLORS.textLighter} />
              <Text style={styles.emptyText}>和 AI 聊聊你的专注、规划与随手记吧</Text>
              <Text style={styles.emptySub}>对话变长时，点右上角「压缩」可生成长期摘要</Text>
            </View>
          }
        />

        {/* 输入栏 */}
        {!isSelecting && (
          <View style={styles.inputBar}>
            {/* 待发送图片预览 */}
            {pendingImages.length > 0 && (
              <View style={styles.pendingImages}>
                {pendingImages.map((uri) => (
                  <View key={uri} style={styles.pendingImgWrap}>
                    <Image source={{ uri }} style={styles.pendingImg} resizeMode="cover" />
                    <TouchableOpacity style={styles.pendingImgRemove} onPress={() => removePendingImage(uri)}>
                      <Ionicons name="close" size={12} color="#fff" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
            <View style={styles.inputRow}>
              <TouchableOpacity style={styles.imgPickBtn} onPress={pickImage} disabled={loading}>
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
            {/* 图片将由视觉模型识别的提示 */}
            {pendingImages.length > 0 && (
              <Text style={styles.visionHint}>
                含图片，将使用视觉模型 {visionModel} 识别（最多 {getVisionImageLimit(visionModel)} 张）
              </Text>
            )}
          </View>
        )}
      </KeyboardAvoidingView>

      {/* 复制浮层：用 Modal 隔离，避免父级手势拦截；用 TextInput editable={false} 支持原生选词菜单 */}
      <Modal
        visible={copyText !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setCopyText(null)}
      >
        <TouchableOpacity
          style={styles.copyOverlay}
          activeOpacity={1}
          onPress={() => setCopyText(null)}
        >
          <View style={styles.copyCard} onStartShouldSetResponder={() => true}>
            <View style={styles.copyCardHeader}>
              <Text style={styles.copyCardTitle}>复制内容</Text>
              <TouchableOpacity onPress={() => setCopyText(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={20} color={COLORS.textLight} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.copyTextInput}
              value={copyText || ''}
              editable={false}
              multiline
              selectTextOnFocus
              textAlignVertical="top"
            />
            <TouchableOpacity
              style={styles.copyAllBtn}
              onPress={() => {
                if (copyText) Clipboard.setString(copyText);
              }}
            >
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

// 单条消息气泡（抽取为 memo 组件，缓解 FlatList 的 VirtualizedList 性能警告）
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
      <Text style={[styles.bubbleText, isUser ? styles.bubbleTextUser : styles.bubbleTextBot]}>
        {item.content}
      </Text>
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
            <Ionicons
              name={selected ? 'checkbox' : 'square-outline'}
              size={20}
              color={selected ? COLORS.primary : COLORS.textLight}
            />
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => onToggleSelect(item.id)}
            onLongPress={() => onToggleSelect(item.id)}
            style={[
              styles.bubble,
              isUser ? styles.bubbleUser : styles.bubbleBot,
              selected && styles.bubbleSelected,
            ]}
          >
            {imagesBlock}
            {textBlock}
            {timeBlock}
          </TouchableOpacity>
        </View>
      );
    }

    const copyBtn = (
      <TouchableOpacity
        style={styles.copyBtn}
        onPress={() => onCopy(item.content)}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Ionicons name="copy-outline" size={16} color={COLORS.textLight} />
      </TouchableOpacity>
    );

    const memoBtn = (
      <TouchableOpacity
        style={styles.memoBtn}
        onPress={() => onSaveToMemo(item)}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Ionicons name="bookmark-outline" size={16} color={COLORS.textLight} />
      </TouchableOpacity>
    );

    return (
      <View style={[styles.row, isUser ? styles.rowUser : styles.rowBot]}>
        {isUser ? (
          <View style={styles.rowActions}>
            {copyBtn}
            {memoBtn}
          </View>
        ) : null}
        <TouchableWithoutFeedback onLongPress={() => onCopy(item.content)}>
          <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleBot]}>
            {imagesBlock}
            {textBlock}
            {timeBlock}
          </View>
        </TouchableWithoutFeedback>
        {!isUser ? (
          <View style={styles.rowActions}>
            {copyBtn}
            {memoBtn}
          </View>
        ) : null}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: TOP_INSET + 14,
    paddingBottom: 10,
    paddingHorizontal: 16,
    backgroundColor: COLORS.card,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: { padding: 6, marginLeft: 6 },
  summaryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.secondary,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginRight: 4,
  },
  summaryBadgeText: { fontSize: 11, color: COLORS.primary, marginLeft: 3, fontWeight: '600' },
  // 选择模式顶栏
  headerSelect: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: TOP_INSET + 14,
    paddingBottom: 10,
    paddingHorizontal: 16,
    backgroundColor: COLORS.primary,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.primary,
  },
  cancelBtn: { paddingVertical: 4, paddingRight: 6 },
  cancelText: { fontSize: 15, color: '#fff', fontWeight: '500' },
  selTitle: { fontSize: 15, color: '#fff', fontWeight: '600' },
  delSelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E5484D',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 5,
    gap: 4,
  },
  delSelDisabled: { backgroundColor: 'rgba(255,255,255,0.35)' },
  delSelText: { fontSize: 14, color: '#fff', fontWeight: '600' },
  delSelTextDisabled: { color: 'rgba(255,255,255,0.8)' },
  // 选择提示条
  selectTipBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.secondary,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  selectTipText: { flex: 1, fontSize: 12, color: COLORS.primary, marginLeft: 6 },
  hintBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF6E7',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#FBE7BF',
  },
  hintText: { flex: 1, fontSize: 12.5, color: '#92670C', marginLeft: 6 },
  hintBtn: {
    backgroundColor: COLORS.warning,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginLeft: 8,
  },
  hintBtnText: { color: '#fff', fontSize: 12.5, fontWeight: '600' },
  listContent: { padding: 14, paddingBottom: 20, flexGrow: 1 },
  row: { flexDirection: 'row', marginBottom: 10, alignItems: 'center' },
  rowUser: { justifyContent: 'flex-end' },
  rowBot: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '78%', padding: 11, paddingBottom: 6, borderRadius: 14 },
  bubbleUser: { backgroundColor: COLORS.primary, borderBottomRightRadius: 4 },
  bubbleBot: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderBottomLeftRadius: 4 },
  bubbleSelected: { borderWidth: 2, borderColor: COLORS.primary },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  // 气泡内图片
  bubbleImages: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  bubbleImage: { width: 120, height: 120, borderRadius: 10, backgroundColor: COLORS.background },
  // 待发送图片
  pendingImages: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingBottom: 8 },
  pendingImgWrap: { position: 'relative', width: 64, height: 64 },
  pendingImg: { width: 64, height: 64, borderRadius: 10, backgroundColor: COLORS.background },
  pendingImgRemove: {
    position: 'absolute', top: -4, right: -4, width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
  },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end' },
  imgPickBtn: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    marginRight: 6,
  },
  visionHint: { fontSize: 11.5, color: COLORS.primary, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 2 },
  bubbleTextUser: { color: '#fff' },
  bubbleTextBot: { color: COLORS.text },
  timeText: {
    fontSize: 10,
    color: COLORS.textLighter,
    marginTop: 4,
    textAlign: 'right',
  },
  timeTextUser: { color: 'rgba(255,255,255,0.75)' },
  // 复制按钮 / 选择框
  rowActions: { flexDirection: 'row', alignItems: 'center' },
  copyBtn: { paddingHorizontal: 8, paddingVertical: 10 },
  memoBtn: { paddingHorizontal: 8, paddingVertical: 10 },
  checkBox: { paddingHorizontal: 6, paddingVertical: 10 },
  empty: { alignItems: 'center', marginTop: 80 },
  emptyText: { fontSize: 15, color: COLORS.textLight, marginTop: 12 },
  emptySub: { fontSize: 12, color: COLORS.textLighter, marginTop: 6 },
  inputBar: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: COLORS.card,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  input: {
    flex: 1,
    backgroundColor: COLORS.background,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 14,
    color: COLORS.text,
    maxHeight: 96,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  sendBtnDisabled: { backgroundColor: COLORS.textLighter },
  // 复制浮层
  copyOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 1000,
  },
  copyCard: {
    width: '100%',
    maxHeight: '80%',
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
  },
  copyCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  copyCardTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  copyTextInput: {
    maxHeight: 320,
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.text,
    padding: 12,
    backgroundColor: COLORS.background,
    borderRadius: 8,
    marginVertical: 12,
    textAlignVertical: 'top',
  },
  copyAllBtn: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.textLight,
    borderRadius: 12,
    paddingVertical: 9,
  },
  copyAllText: { fontSize: 14, color: '#fff', fontWeight: '600' },
  copyHint: { fontSize: 12, color: COLORS.textLighter, marginTop: 10, textAlign: 'center' },
  copyDoneBtn: {
    marginTop: 12,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  copyDoneText: { fontSize: 15, color: '#fff', fontWeight: '600' },
});

export default ChatPage;
