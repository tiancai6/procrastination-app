import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Switch, Alert, Modal, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/reasons';
import { TOP_INSET } from '../constants/safeArea';
import {
  ModelBrand,
  ModelConfig,
  BRAND_PRESETS,
  getModelConfigs,
  addModelConfig,
  updateModelConfig,
  deleteModelConfig,
  setDefaultModel,
  setDefaultVisionModel,
} from '../utils/modelConfig';
import { postChat } from '../utils/model';

const BRANDS: ModelBrand[] = ['glm', 'doubao', 'deepseek', 'gemini'];

interface Draft {
  id?: string;
  brand: ModelBrand;
  name: string;
  apiKey: string;
  modelId: string;
  isVision: boolean;
  webSearch: boolean;
  asDefault: boolean;
  asVisionDefault: boolean;
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

const ModelConfigPage: React.FC<Props> = ({ visible, onClose }) => {
  const [list, setList] = useState<ModelConfig[]>([]);
  const [editing, setEditing] = useState<Draft | null>(null);
  // 测试连通性：记录正在测试的模型 id（非空时对应按钮显示加载中）
  const [testingId, setTestingId] = useState<string | null>(null);

  const load = async () => setList(await getModelConfigs());
  useEffect(() => {
    if (visible) load();
  }, [visible]);

  const openAdd = () => {
    const b = 'glm';
    setEditing({
      brand: b,
      name: '',
      apiKey: '',
      modelId: BRAND_PRESETS[b].models[0],
      isVision: false,
      webSearch: false,
      asDefault: list.length === 0,
      asVisionDefault: false,
    });
  };

  const openEdit = (cfg: ModelConfig) => {
    setEditing({
      id: cfg.id,
      brand: cfg.brand,
      name: cfg.name,
      apiKey: cfg.apiKey,
      modelId: cfg.modelId,
      isVision: cfg.isVision,
      webSearch: cfg.webSearch,
      asDefault: cfg.isDefault,
      asVisionDefault: cfg.isDefaultVision,
    });
  };

  const changeBrand = (b: ModelBrand) => {
    if (!editing) return;
    setEditing({ ...editing, brand: b, modelId: BRAND_PRESETS[b].models[0] });
  };

  // 测试单个模型的连通性：发一条极简请求，报告成功/失败/耗时
  const testConnection = async (cfg: ModelConfig) => {
    if (testingId) return; // 防止重复点
    setTestingId(cfg.id);
    const t0 = Date.now();
    try {
      // 豆包走 Responses API 测试（因为 Chat Completions 端点可能因模型名格式 404）；
      // 其余品牌统一走 Chat Completions。
      let resp: string;
      if (cfg.brand === 'doubao') {
        // 用一个轻量的 Responses API 调用来测试豆包连通性
        const url = cfg.baseUrl.replace(/\/chat\/completions\/?$/, '/responses');
        const body = JSON.stringify({
          model: cfg.modelId,
          stream: false,
          input: [{ role: 'user', content: [{ type: 'input_text', text: '请只回复 OK 两个字，不要其他内容' }] }],
          max_output_tokens: 8,
        });
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
          body,
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`${BRAND_PRESETS[cfg.brand].label} 返回 ${res.status}${errText ? `：${errText.slice(0, 200)}` : ''}`);
        }
        const data = await res.json();
        resp = data?.output_text || data?.output?.find((o: any) => o?.type === 'message')?.content?.find((c: any) => c?.type === 'output_text')?.text || '(无文本)';
      } else {
        resp = await postChat(cfg, [
          { role: 'user', content: '请只回复 OK 两个字，不要其他内容' },
        ], { maxTokens: 8 });
      }
      const ms = Date.now() - t0;
      Alert.alert('✅ 连通成功', `「${cfg.name}」响应正常，耗时 ${ms}ms\n模型回复：${resp.trim()}`);
    } catch (e: any) {
      const ms = Date.now() - t0;
      Alert.alert('❌ 连通失败', `「${cfg.name}」在 ${ms}ms 后失败\n\n${e?.message || '未知错误'}`);
    } finally {
      setTestingId(null);
    }
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.apiKey.trim() || !editing.modelId.trim()) {
      Alert.alert('请填写完整', 'API Key 与模型标识都不能为空');
      return;
    }
    // 火山方舟的模型标识必须是「推理接入点 ID」（ep-xxxx），不能直接填模型名，否则会 404 失败
    if (editing.brand === 'doubao' && !editing.modelId.trim().startsWith('ep-')) {
      Alert.alert(
        '模型标识有误',
        '火山方舟的「模型标识」必须填你创建的推理接入点 ID（以 ep- 开头，形如 ep-xxxx），不能直接填模型名（如 doubao-seed-2.0-lite）。\n\n请到火山方舟控制台创建接入点后，复制其 ID 再填到这里。',
      );
      return;
    }
    const payload = {
      brand: editing.brand,
      name: editing.name.trim() || editing.modelId.trim(),
      apiKey: editing.apiKey.trim(),
      modelId: editing.modelId.trim(),
      isVision: editing.isVision,
      webSearch: editing.webSearch,
    };
    try {
      if (editing.id) {
        await updateModelConfig(editing.id, { ...payload, baseUrl: BRAND_PRESETS[payload.brand].baseUrl });
        if (editing.asDefault) await setDefaultModel(editing.id);
        if (editing.asVisionDefault) await setDefaultVisionModel(editing.id);
      } else {
        const cfg = await addModelConfig({ ...payload, baseUrl: BRAND_PRESETS[payload.brand].baseUrl, isDefault: false, isDefaultVision: false });
        if (editing.asDefault) await setDefaultModel(cfg.id);
        if (editing.asVisionDefault) await setDefaultVisionModel(cfg.id);
      }
      setEditing(null);
      await load();
    } catch (e: any) {
      Alert.alert('保存失败', e?.message ? String(e.message) : '请重试');
    }
  };

  const remove = (cfg: ModelConfig) => {
    Alert.alert('删除模型', `确定删除「${cfg.name}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await deleteModelConfig(cfg.id);
          await load();
        },
      },
    ]);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="chevron-down" size={26} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.title}>管理 AI 模型</Text>
          <TouchableOpacity onPress={openAdd} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="add-circle" size={26} color={COLORS.primary} />
          </TouchableOpacity>
        </View>

        {!editing && (
          <ScrollView style={styles.body} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
            {list.length === 0 && (
              <View style={styles.empty}>
                <Ionicons name="cube-outline" size={40} color={COLORS.textLighter} />
                <Text style={styles.emptyText}>还没有配置任何模型</Text>
                <Text style={styles.emptySub}>点右上角「+」添加 GLM / 豆包 / DeepSeek / Gemini</Text>
              </View>
            )}
            {list.map((cfg) => {
              const preset = BRAND_PRESETS[cfg.brand];
              return (
                <TouchableOpacity key={cfg.id} style={styles.card} onPress={() => openEdit(cfg)}>
                  <View style={styles.cardTop}>
                    <View style={[styles.brandTag, { backgroundColor: brandColor(cfg.brand) }]}>
                      <Text style={styles.brandTagText}>{preset.label}</Text>
                    </View>
                    <Text style={styles.cardName}>{cfg.name}</Text>
                  </View>
                  <Text style={styles.cardModel}>{cfg.modelId}</Text>
                  <View style={styles.badges}>
                    {cfg.isDefault && <Text style={styles.badge}>默认</Text>}
                    {cfg.isDefaultVision && <Text style={styles.badge}>视觉默认</Text>}
                    {cfg.isVision && <Text style={styles.badgeGray}>支持图片</Text>}
                    {cfg.webSearch && <Text style={styles.badgeSearch}>联网搜索</Text>}
                    {cfg.brand === 'doubao' && !cfg.modelId.startsWith('ep-') && (
                      <Text style={styles.badgeWarning}>⚠️ 模型标识有误</Text>
                    )}
                  </View>
                  <TouchableOpacity style={styles.delBtn} onPress={() => remove(cfg)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="trash-outline" size={18} color={COLORS.danger || '#ef4444'} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.testBtn, testingId === cfg.id && styles.testBtnLoading]}
                    onPress={() => testConnection(cfg)}
                    disabled={testingId !== null}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    {testingId === cfg.id ? (
                      <ActivityIndicator size="small" color={COLORS.primary} />
                    ) : (
                      <Ionicons name="cellular" size={16} color={COLORS.primary} />
                    )}
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            })}
            <Text style={styles.tip}>
              提示：同一品牌可添加多个模型（如 GLM 同时配 4.7-flash 与 5.2），对话/三餐估算/专注分析会统一用「默认」模型。
            </Text>
          </ScrollView>
        )}

        {editing && (
          <ScrollView style={styles.body} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>品牌</Text>
            <View style={styles.brandRow}>
              {BRANDS.map((b) => (
                <TouchableOpacity
                  key={b}
                  style={[styles.brandChip, editing.brand === b && styles.brandChipActive]}
                  onPress={() => changeBrand(b)}
                >
                  <Text style={[styles.brandChipText, editing.brand === b && styles.brandChipTextActive]}>
                    {BRAND_PRESETS[b].label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.note}>{BRAND_PRESETS[editing.brand].notes}</Text>

            <Text style={styles.label}>API Key</Text>
            <TextInput
              style={styles.input}
              placeholder="粘贴该平台的 API Key"
              value={editing.apiKey}
              onChangeText={(t) => setEditing({ ...editing, apiKey: t })}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              blurOnSubmit={true}
            />

            <Text style={styles.label}>模型标识</Text>
            <View style={styles.modelChips}>
              {BRAND_PRESETS[editing.brand].models.map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[styles.modelChip, editing.modelId === m && styles.modelChipActive]}
                  onPress={() => setEditing({ ...editing, modelId: m })}
                >
                  <Text style={[styles.modelChipText, editing.modelId === m && styles.modelChipTextActive]}>{m}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={styles.input}
              placeholder="或手动输入模型标识"
              value={editing.modelId}
              onChangeText={(t) => setEditing({ ...editing, modelId: t })}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              blurOnSubmit={true}
            />

            <Text style={styles.label}>显示名（可选）</Text>
            <TextInput
              style={styles.input}
              placeholder={editing.modelId || '模型名'}
              value={editing.name}
              onChangeText={(t) => setEditing({ ...editing, name: t })}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              blurOnSubmit={true}
            />

            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>设为默认文本模型（对话/分析使用）</Text>
              <Switch value={editing.asDefault} onValueChange={(v) => setEditing({ ...editing, asDefault: v })} />
            </View>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>设为视觉模型（发送图片时使用）</Text>
              <Switch value={editing.asVisionDefault} onValueChange={(v) => setEditing({ ...editing, asVisionDefault: v })} />
            </View>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>开启联网搜索（按品牌走 web_search / Google grounding）</Text>
              <Switch value={editing.webSearch} onValueChange={(v) => setEditing({ ...editing, webSearch: v })} />
            </View>

            <View style={styles.editorBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditing(null)}>
                <Text style={styles.cancelBtnText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={save}>
                <Text style={styles.saveBtnText}>保存</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
};

const brandColor = (b: ModelBrand): string => {
  switch (b) {
    case 'glm': return '#4F46E5';
    case 'doubao': return '#FF7A00';
    case 'deepseek': return '#3B82F6';
    case 'gemini': return '#10B981';
  }
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background || '#F5F7FA', paddingTop: TOP_INSET },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: COLORS.card,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  title: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  body: { flex: 1 },
  empty: { alignItems: 'center', marginTop: 80 },
  emptyText: { fontSize: 15, color: COLORS.textLight, marginTop: 12 },
  emptySub: { fontSize: 13, color: COLORS.textLighter, marginTop: 6, textAlign: 'center' },
  card: {
    backgroundColor: COLORS.card, borderRadius: 14, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: COLORS.border, position: 'relative',
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  brandTagText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  cardName: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  cardModel: { fontSize: 13, color: COLORS.textLight, marginTop: 6 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  badge: { fontSize: 11, color: '#fff', backgroundColor: COLORS.primary, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  badgeGray: { fontSize: 11, color: COLORS.textLight, backgroundColor: COLORS.background || '#eee', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  badgeSearch: { fontSize: 11, color: '#fff', backgroundColor: '#10B981', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  badgeWarning: { fontSize: 11, color: '#fff', backgroundColor: '#F59E0B', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  delBtn: { position: 'absolute', top: 12, right: 12 },
  testBtn: { position: 'absolute', top: 12, right: 38, padding: 4 },
  testBtnLoading: { opacity: 0.5 },
  tip: { fontSize: 12, color: COLORS.textLighter, marginTop: 8, lineHeight: 18 },
  label: { fontSize: 13, fontWeight: '600', color: COLORS.textLight, marginTop: 14, marginBottom: 8 },
  note: { fontSize: 12, color: COLORS.textLighter, marginTop: 6, marginBottom: 4 },
  input: {
    backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: COLORS.text,
  },
  brandRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  brandChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  brandChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  brandChipText: { fontSize: 13, color: COLORS.textLight },
  brandChipTextActive: { color: '#fff', fontWeight: '600' },
  modelChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  modelChip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 9, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  modelChipActive: { backgroundColor: COLORS.secondary || '#E0E7FF', borderColor: COLORS.primary },
  modelChipText: { fontSize: 12, color: COLORS.textLight },
  modelChipTextActive: { color: COLORS.primary, fontWeight: '600' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  switchLabel: { fontSize: 13, color: COLORS.text, flex: 1, marginRight: 12 },
  editorBtns: { flexDirection: 'row', gap: 12, marginTop: 24, marginBottom: 40 },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center' },
  cancelBtnText: { color: COLORS.textLight, fontSize: 15, fontWeight: '500' },
  saveBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: COLORS.primary, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});

export default ModelConfigPage;
