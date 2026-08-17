import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/reasons';
import { TOP_INSET } from '../constants/safeArea';
import { getAiUsageLog, clearAiUsageLog, exportAiUsage, getAiRawLog, clearAiRawLog, exportAiRaw, AiUsageRecord, AiRawRecord } from '../utils/usage';

const BRAND_COLORS: Record<string, string> = {
  glm: '#4F46E5',
  doubao: '#FF7A00',
  deepseek: '#3B82F6',
  gemini: '#10B981',
};
const BRAND_LABELS: Record<string, string> = {
  glm: 'GLM',
  doubao: '豆包',
  deepseek: 'DeepSeek',
  gemini: 'Gemini',
};
const brColor = (b: string) => BRAND_COLORS[b] || '#64748B';
const brLabel = (b: string) => BRAND_LABELS[b] || b;

const fmt = (n: number): string => n.toLocaleString('en-US');

const fmtTime = (ts: number): string => {
  const d = new Date(ts);
  const p = (x: number) => (x < 10 ? `0${x}` : `${x}`);
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

interface Props {
  visible: boolean;
  onClose: () => void;
}

interface Agg {
  key: string;
  brand?: string;
  tokens: number;
  count: number;
}

const AiUsagePage: React.FC<Props> = ({ visible, onClose }) => {
  const [list, setList] = useState<AiUsageRecord[]>([]);
  const [rawList, setRawList] = useState<AiRawRecord[]>([]);
  const [showRaw, setShowRaw] = useState(false);

  const load = async () => {
    setList(await getAiUsageLog());
    setRawList(await getAiRawLog());
  };
  useEffect(() => {
    if (visible) load();
  }, [visible]);

  // 汇总：总数 + 按模型 + 按功能
  let totalTokens = 0, totalIn = 0, totalOut = 0;
  const modelMap = new Map<string, Agg>();
  const featMap = new Map<string, Agg>();
  for (const r of list) {
    totalTokens += r.totalTokens;
    totalIn += r.promptTokens;
    totalOut += r.completionTokens;
    const m = modelMap.get(r.modelId) || { key: r.modelId, brand: r.brand, tokens: 0, count: 0 };
    m.tokens += r.totalTokens; m.count += 1; modelMap.set(r.modelId, m);
    const f = featMap.get(r.feature) || { key: r.feature, tokens: 0, count: 0 };
    f.tokens += r.totalTokens; f.count += 1; featMap.set(r.feature, f);
  }
  const byModel = [...modelMap.values()].sort((a, b) => b.tokens - a.tokens);
  const byFeature = [...featMap.values()].sort((a, b) => b.tokens - a.tokens);
  const recent = [...list].slice(-80).reverse();

  const handleClear = () => {
    Alert.alert('清除用量记录', '确定要清空所有 AI 用量记录吗？（不影响模型配置与其他数据）', [
      { text: '取消', style: 'cancel' },
      {
        text: '清空',
        style: 'destructive',
        onPress: async () => {
          await clearAiUsageLog();
          await load();
        },
      },
    ]);
  };

  const handleExport = async () => {
    try {
      const fileName = await exportAiUsage();
      if (!fileName) {
        Alert.alert('没有数据', '当前还没有任何 AI 调用记录，无法导出');
      }
    } catch (e: any) {
      Alert.alert('导出失败', e?.message ? String(e.message) : '未知错误');
    }
  };

  const handleClearRaw = () => {
    Alert.alert('清除原始返回', '确定要清空「AI 原始返回」调试记录吗？（不影响用量统计与其他数据）', [
      { text: '取消', style: 'cancel' },
      { text: '清空', style: 'destructive', onPress: async () => { await clearAiRawLog(); await load(); } },
    ]);
  };
  const handleExportRaw = async () => {
    try {
      const fileName = await exportAiRaw();
      if (!fileName) Alert.alert('没有数据', '当前还没有任何 AI 原始返回记录');
    } catch (e: any) {
      Alert.alert('导出失败', e?.message ? String(e.message) : '未知错误');
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="chevron-down" size={26} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.title}>AI 用量记录</Text>
          <View style={styles.headerRight}>
            <TouchableOpacity onPress={handleExport} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="download-outline" size={22} color={COLORS.primary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={load} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="refresh-outline" size={22} color={COLORS.primary} />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView style={styles.body} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {list.length === 0 && (
            <View style={styles.empty}>
              <Ionicons name="analytics-outline" size={42} color={COLORS.textLighter} />
              <Text style={styles.emptyText}>还没有任何 AI 调用记录</Text>
              <Text style={styles.emptySub}>使用三餐估算 / AI 对话 / 运动消耗等功能后，这里会统计每次调用的模型与 token 消耗</Text>
            </View>
          )}

          {list.length > 0 && (
            <>
              {/* 总览 */}
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>累计消耗</Text>
                <Text style={styles.summaryTotal}>{fmt(totalTokens)} <Text style={styles.summaryUnit}>token</Text></Text>
                <View style={styles.summaryRow}>
                  <View style={styles.summaryItem}>
                    <Text style={styles.summaryItemNum}>{fmt(totalIn)}</Text>
                    <Text style={styles.summaryItemLabel}>输入</Text>
                  </View>
                  <View style={styles.summaryItem}>
                    <Text style={styles.summaryItemNum}>{fmt(totalOut)}</Text>
                    <Text style={styles.summaryItemLabel}>输出</Text>
                  </View>
                  <View style={styles.summaryItem}>
                    <Text style={styles.summaryItemNum}>{fmt(list.length)}</Text>
                    <Text style={styles.summaryItemLabel}>调用次数</Text>
                  </View>
                </View>
              </View>

              {/* 按模型 */}
              <Text style={styles.sectionTitle}>按模型</Text>
              <View style={styles.listCard}>
                {byModel.map((m) => (
                  <View key={m.key} style={styles.row}>
                    <View style={[styles.brandTag, { backgroundColor: brColor(m.brand || '') }]}>
                      <Text style={styles.brandTagText}>{brLabel(m.brand || '')}</Text>
                    </View>
                    <View style={styles.rowMid}>
                      <Text style={styles.rowKey} numberOfLines={1}>{m.key}</Text>
                      <Text style={styles.rowSub}>{m.count} 次调用</Text>
                    </View>
                    <Text style={styles.rowVal}>{fmt(m.tokens)}</Text>
                  </View>
                ))}
              </View>

              {/* 按功能 */}
              <Text style={styles.sectionTitle}>按功能</Text>
              <View style={styles.listCard}>
                {byFeature.map((f) => (
                  <View key={f.key} style={styles.row}>
                    <View style={styles.rowMid}>
                      <Text style={styles.rowKey}>{f.key}</Text>
                      <Text style={styles.rowSub}>{f.count} 次调用</Text>
                    </View>
                    <Text style={styles.rowVal}>{fmt(f.tokens)}</Text>
                  </View>
                ))}
              </View>

              {/* 最近记录 */}
              <Text style={styles.sectionTitle}>最近记录</Text>
              <View style={styles.listCard}>
                {recent.map((r, i) => (
                  <View key={`${r.ts}-${i}`} style={styles.recRow}>
                    <Text style={styles.recTime}>{fmtTime(r.ts)}</Text>
                    <View style={styles.recMid}>
                      <View style={[styles.miniTag, { backgroundColor: brColor(r.brand) }]}>
                        <Text style={styles.miniTagText}>{brLabel(r.brand)}</Text>
                      </View>
                      <Text style={styles.recFeature}>{r.feature}</Text>
                    </View>
                    <Text style={styles.recModel} numberOfLines={1}>{r.modelId}</Text>
                    <Text style={styles.recTokens}>{fmt(r.totalTokens)}</Text>
                  </View>
                ))}
              </View>

              {/* 调试 · AI 原始返回 */}
              <TouchableOpacity style={styles.rawHead} onPress={() => setShowRaw((v) => !v)} activeOpacity={0.7}>
                <Text style={styles.sectionTitle}>调试 · AI 原始返回（最近 {rawList.length} 条）</Text>
                <Ionicons name={showRaw ? 'chevron-up-outline' : 'chevron-down-outline'} size={18} color={COLORS.textLight} />
              </TouchableOpacity>
              {showRaw && (
                <View style={styles.rawCard}>
                  {rawList.length === 0 && (
                    <Text style={styles.emptySub}>还没有记录。每次调用 AI（三餐估算 / 对话等）后这里会保存模型原始返回，用于排查「有返回却解析失败」。</Text>
                  )}
                  {rawList.slice().reverse().map((r, i) => (
                    <View key={`${r.ts}-${i}`} style={styles.rawRow}>
                      <View style={styles.rawMeta}>
                        <Text style={styles.recFeature}>{r.feature}</Text>
                        <Text style={styles.recModel}>{r.modelId}</Text>
                        <Text style={styles.recTime}>{fmtTime(r.ts)}</Text>
                      </View>
                      <Text style={styles.rawText} selectable>{r.text}</Text>
                    </View>
                  ))}
                  {rawList.length > 0 && (
                    <View style={styles.rawBtns}>
                      <TouchableOpacity style={styles.rawBtn} onPress={handleExportRaw}>
                        <Ionicons name="download-outline" size={14} color={COLORS.primary} />
                        <Text style={styles.rawBtnText}>导出原始返回</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.rawBtn} onPress={handleClearRaw}>
                        <Ionicons name="trash-outline" size={14} color={COLORS.danger} />
                        <Text style={[styles.rawBtnText, { color: COLORS.danger }]}>清空</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )}

              <TouchableOpacity style={styles.clearBtn} onPress={handleClear}>
                <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
                <Text style={styles.clearBtnText}>清空用量记录</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background, paddingTop: TOP_INSET },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: COLORS.card,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  title: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  body: { flex: 1 },
  empty: { alignItems: 'center', marginTop: 70, paddingHorizontal: 30 },
  emptyText: { fontSize: 15, color: COLORS.textLight, marginTop: 12 },
  emptySub: { fontSize: 13, color: COLORS.textLighter, marginTop: 6, textAlign: 'center', lineHeight: 19 },
  summaryCard: {
    backgroundColor: COLORS.card, borderRadius: 16, padding: 18, marginBottom: 18,
    borderWidth: 1, borderColor: COLORS.border,
    shadowColor: COLORS.shadow, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  summaryLabel: { fontSize: 13, color: COLORS.textLight },
  summaryTotal: { fontSize: 32, fontWeight: '800', color: COLORS.text, marginTop: 4 },
  summaryUnit: { fontSize: 15, fontWeight: '600', color: COLORS.textLight },
  summaryRow: { flexDirection: 'row', marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: COLORS.border },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryItemNum: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  summaryItemLabel: { fontSize: 12, color: COLORS.textLight, marginTop: 2 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: COLORS.text, marginTop: 4, marginBottom: 10 },
  listCard: {
    backgroundColor: COLORS.card, borderRadius: 14, paddingHorizontal: 14, marginBottom: 18,
    borderWidth: 1, borderColor: COLORS.border,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  brandTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginRight: 10 },
  brandTagText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  rowMid: { flex: 1, marginRight: 10 },
  rowKey: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  rowSub: { fontSize: 12, color: COLORS.textLight, marginTop: 2 },
  rowVal: { fontSize: 14, fontWeight: '700', color: COLORS.primary },
  recRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  recTime: { fontSize: 12, color: COLORS.textLight, width: 58 },
  recMid: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 },
  miniTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, marginRight: 6 },
  miniTagText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  recFeature: { fontSize: 13, color: COLORS.text, flexShrink: 1 },
  recModel: { fontSize: 11, color: COLORS.textLighter, width: 70, marginRight: 8 },
  recTokens: { fontSize: 13, fontWeight: '700', color: COLORS.text, width: 56, textAlign: 'right' },
  clearBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 8, paddingVertical: 13, backgroundColor: '#FEF2F2', borderRadius: 12,
    borderWidth: 1, borderColor: '#FECACA',
  },
  clearBtnText: { fontSize: 14, color: COLORS.danger, fontWeight: '600' },
  rawHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, marginBottom: 10 },
  rawCard: { backgroundColor: COLORS.card, borderRadius: 14, padding: 14, marginBottom: 18, borderWidth: 1, borderColor: COLORS.border },
  rawRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  rawMeta: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  rawText: { fontSize: 11, color: COLORS.textLight, fontFamily: 'Courier New', lineHeight: 16 },
  rawBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16, marginTop: 10 },
  rawBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rawBtnText: { fontSize: 13, color: COLORS.primary, fontWeight: '600' },
});

export default AiUsagePage;
