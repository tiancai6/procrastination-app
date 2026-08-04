import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Clipboard,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { COLORS } from '../constants/reasons';
import { TOP_INSET } from '../constants/safeArea';
import { getChatSummary, saveChatSummary } from '../utils/storage';
import { rebuildSummary, estimateChars, CHAT_BUDGET_CHARS } from '../utils/chat';

interface ProfileModalProps {
  visible: boolean;
  // 当前已保存的摘要（用于打开时初始化）
  summary: string;
  onClose: () => void;
  // 保存后通知父组件刷新
  onSaved: () => void;
  // 调用 ChatPage 的压缩（基于对话原文 + 已保存摘要）
  onRequestCompress: () => Promise<void>;
}

const ProfileModal: React.FC<ProfileModalProps> = ({
  visible,
  summary,
  onClose,
  onSaved,
  onRequestCompress,
}) => {
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [showExport, setShowExport] = useState(false);

  // 每次打开都从存储里重新读取最新摘要（避免和已保存状态不一致）
  useEffect(() => {
    if (visible) {
      (async () => {
        const s = await getChatSummary();
        setDraft(s);
        setDirty(false);
        setShowExport(false);
      })();
    }
  }, [visible]);

  const estimated = estimateChars([], draft);
  const overBudget = estimated > CHAT_BUDGET_CHARS;

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await saveChatSummary(draft);
      setDirty(false);
      onSaved();
      Alert.alert('已保存', '下次对话会自动参考这份档案。');
    } catch (e: any) {
      Alert.alert('保存失败', e?.message ? String(e.message) : '请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const handleRebuild = () => {
    if (rebuilding) return;
    Alert.alert(
      '重新生成档案',
      '将用 AI 把当前内容重新整理为标准格式，覆盖你的手动修改。确定吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '重新生成',
          onPress: async () => {
            setRebuilding(true);
            try {
              const newMd = await rebuildSummary(draft);
              setDraft(newMd);
              setDirty(true);
              Alert.alert('已重新生成', '已整理为标准格式，点「保存」生效。');
            } catch (e: any) {
              Alert.alert('重新生成失败', e?.message ? String(e.message) : '请稍后重试');
            } finally {
              setRebuilding(false);
            }
          },
        },
      ],
    );
  };

  const handleCompress = async () => {
    try {
      await onRequestCompress();
      const s = await getChatSummary();
      setDraft(s);
      setDirty(false);
    } catch (e: any) {
      Alert.alert('压缩失败', e?.message ? String(e.message) : '请稍后重试');
    }
  };

  const handleCopyText = () => {
    if (!draft) {
      Alert.alert('暂无可复制内容', '档案还是空的，先记录一些对话再来看。');
      return;
    }
    Clipboard.setString(draft);
    Alert.alert('已复制', '个人 Skill 文本已复制到剪贴板。');
  };

  const handleExportFile = async () => {
    if (!draft) {
      Alert.alert('暂无可导出内容', '档案还是空的，先记录一些对话再来看。');
      return;
    }
    try {
      const fileName = 'personal_skill.md';
      const fileUri = `${FileSystem.cacheDirectory}${fileName}`;
      await FileSystem.writeAsStringAsync(fileUri, draft, { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'text/markdown',
          dialogTitle: '导出个人 Skill',
          UTI: 'public.text',
        });
      } else {
        Clipboard.setString(draft);
        Alert.alert('已复制到剪贴板', '当前环境不支持系统分享，已改为复制全文，你可手动粘贴保存。');
      }
    } catch (e: any) {
      Alert.alert('导出失败', e?.message ? String(e.message) : '请稍后重试');
    }
  };

  const handleExportExplain = () => {
    Alert.alert(
      '关于「写入个人 Skill 文件」',
      '手机 App 内只能生成并分享这个 personal_skill.md 文件。要真正让它变成 AI 助手的长期个性化记忆，需要把这份文本交给桌面端：\n\n1. 复制上面的文本（或导出文件）；\n2. 在桌面环境把它贴进 agent 的 skills 目录（如 ~/.workbuddy/skills/personal-profile/SKILL.md）；\n3. 之后 AI 助手即可长期参考。\n\n（这一步由桌面端完成，App 侧只能产出文件。）',
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        {/* 顶部栏 */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={22} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>我的档案</Text>
          <View style={{ width: 30 }} />
        </View>

        {/* 字数横幅 */}
        <View style={[styles.banner, overBudget && styles.bannerWarn]}>
          <Ionicons
            name={overBudget ? 'alert-circle-outline' : 'document-text-outline'}
            size={16}
            color={overBudget ? COLORS.warning : COLORS.textLight}
          />
          <Text style={[styles.bannerText, overBudget && styles.bannerTextWarn]}>
            {estimated} 字{overBudget ? `（已超 ${CHAT_BUDGET_CHARS}，建议压缩）` : ''}
          </Text>
          {overBudget && (
            <TouchableOpacity style={styles.bannerBtn} onPress={handleCompress}>
              <Text style={styles.bannerBtnText}>压缩</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* 编辑区 */}
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.tip}>
            这是 AI 对话压缩而来的长期档案，下次对话会自动参考它。你可以直接编辑，或点底部「重新生成」让 AI 整理格式。
          </Text>
          <TextInput
            style={styles.editor}
            value={draft}
            onChangeText={(t) => {
              setDraft(t);
              setDirty(true);
            }}
            multiline
            textAlignVertical="top"
            placeholder="还没有档案。多和 AI 聊几次后，点对话页右上角「压缩」即可生成这里的内容。"
            placeholderTextColor={COLORS.textLighter}
          />
        </ScrollView>

        {/* 底部操作栏 */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.footerBtn, styles.saveBtn, (saving || !dirty) && styles.footerBtnDisabled]}
            onPress={handleSave}
            disabled={saving || !dirty}
          >
            {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveBtnText}>保存</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={[styles.footerBtn, styles.rebuildBtn, rebuilding && styles.footerBtnDisabled]} onPress={handleRebuild} disabled={rebuilding}>
            {rebuilding ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.rebuildBtnText}>重新生成</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={[styles.footerBtn, styles.exportBtn]} onPress={() => setShowExport(true)}>
            <Ionicons name="share-outline" size={16} color="#fff" />
            <Text style={styles.exportBtnText}>导出 Skill</Text>
          </TouchableOpacity>
        </View>

        {/* 导出底部弹层 */}
        {showExport && (
          <View style={styles.sheetBackdrop}>
            <TouchableOpacity style={styles.sheetMask} activeOpacity={1} onPress={() => setShowExport(false)} />
            <View style={styles.sheet}>
              <Text style={styles.sheetTitle}>导出个人 Skill</Text>
              <TouchableOpacity style={styles.sheetItem} onPress={handleCopyText}>
                <Ionicons name="copy-outline" size={20} color={COLORS.primary} />
                <Text style={styles.sheetItemText}>复制文本</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.sheetItem} onPress={handleExportFile}>
                <Ionicons name="download-outline" size={20} color={COLORS.primary} />
                <Text style={styles.sheetItemText}>分享 / 导出文件（.md）</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.sheetItem} onPress={handleExportExplain}>
                <Ionicons name="information-circle-outline" size={20} color={COLORS.textLight} />
                <Text style={[styles.sheetItemText, { color: COLORS.textLight }]}>如何写入 AI 长期记忆？</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.sheetCancel} onPress={() => setShowExport(false)}>
                <Text style={styles.sheetCancelText}>取消</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
};

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
  closeBtn: { padding: 4, width: 30 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  bannerWarn: { backgroundColor: '#FEF6E7' },
  bannerText: { flex: 1, fontSize: 12.5, color: COLORS.textLight, marginLeft: 6 },
  bannerTextWarn: { color: '#92670C' },
  bannerBtn: {
    backgroundColor: COLORS.warning,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginLeft: 8,
  },
  bannerBtnText: { color: '#fff', fontSize: 12.5, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { padding: 14 },
  tip: { fontSize: 12.5, color: COLORS.textLight, marginBottom: 10, lineHeight: 18 },
  editor: {
    minHeight: 260,
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    fontSize: 14,
    lineHeight: 22,
    color: COLORS.text,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: COLORS.card,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  footerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: 12,
    paddingVertical: 11,
    marginHorizontal: 4,
  },
  footerBtnDisabled: { opacity: 0.5 },
  saveBtn: { backgroundColor: COLORS.primary },
  saveBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  rebuildBtn: { backgroundColor: COLORS.textLight },
  rebuildBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  exportBtn: { backgroundColor: COLORS.primaryDark ?? '#2563eb' },
  exportBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  // 导出弹层
  sheetBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end' },
  sheetMask: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
  },
  sheetTitle: { fontSize: 13, color: COLORS.textLighter, textAlign: 'center', paddingVertical: 10 },
  sheetItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  sheetItemText: { fontSize: 15, color: COLORS.text, fontWeight: '500' },
  sheetCancel: { marginTop: 12, backgroundColor: COLORS.background, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  sheetCancelText: { fontSize: 15, color: COLORS.textLight, fontWeight: '600' },
});

export default ProfileModal;
