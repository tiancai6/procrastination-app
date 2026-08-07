import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  TextInput,
  ScrollView,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { COLORS } from '../constants/reasons';
import { HealthDaily, getHealthDaily, setHealthDaily, mergeHealthDaily } from '../utils/storage';
import { parseHealthFile, summarizeImport } from '../utils/health';

interface Props {
  visible: boolean;
  date: string; // YYYY-MM-DD，手动录入的目标日期
  onClose: () => void;
  onSaved?: () => void;
}

const HealthImportSheet: React.FC<Props> = ({ visible, date, onClose, onSaved }) => {
  const [tab, setTab] = useState<'file' | 'manual'>('file');
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<HealthDaily[]>([]);
  const [fileName, setFileName] = useState('');

  // 手动录入
  const [steps, setSteps] = useState('');
  const [sleepH, setSleepH] = useState('');
  const [hr, setHr] = useState('');
  const [kcal, setKcal] = useState('');

  useEffect(() => {
    if (!visible) return;
    setPreview([]);
    setFileName('');
    (async () => {
      const cur = await getHealthDaily(date);
      setSteps(cur?.steps ? String(cur.steps) : '');
      setSleepH(cur?.sleepMin ? String(Math.round((cur.sleepMin / 60) * 10) / 10) : '');
      setHr(cur?.restingHr ? String(cur.restingHr) : '');
      setKcal(cur?.activeKcal ? String(cur.activeKcal) : '');
    })();
  }, [visible, date]);

  const pickFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'application/json', 'text/plain', '*/*'],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      setImporting(true);
      const text = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      const rows = parseHealthFile(text, asset.name || '');
      setFileName(asset.name || '已选文件');
      setPreview(rows);
      if (rows.length === 0) {
        Alert.alert(
          '没识别到数据',
          '这个文件里没找到「日期 + 步数/睡眠/心率」这样的表格。\n\n建议：华为运动健康 →「我的 → 隐私中心 → 申请导出个人数据」，解压后选里面的 csv 或 json 文件；也可以改用「手动录入」。',
        );
      }
    } catch (e) {
      console.error('[health] pick file failed', e);
      Alert.alert('读取失败', '这个文件打不开，换一个 csv / json 文件试试');
    } finally {
      setImporting(false);
    }
  };

  const confirmImport = async () => {
    if (preview.length === 0) return;
    setImporting(true);
    const n = await mergeHealthDaily(preview);
    setImporting(false);
    Alert.alert('导入完成', `已写入 ${n} 天数据`);
    onSaved?.();
    onClose();
  };

  const saveManual = async () => {
    const data: HealthDaily = { date, source: 'manual' };
    // 手动录入必须过滤非数字，否则 parseInt('abc')→NaN 会写进库，首页显示成「null 步」
    const toInt = (s: string): number | undefined => {
      const n = parseInt(s, 10);
      return Number.isFinite(n) ? n : undefined;
    };
    const toFloat = (s: string): number | undefined => {
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : undefined;
    };
    const stepsN = toInt(steps);
    if (stepsN !== undefined) data.steps = stepsN;
    const sleepN = toFloat(sleepH);
    if (sleepN !== undefined) data.sleepMin = Math.round(sleepN * 60);
    const hrN = toInt(hr);
    if (hrN !== undefined) data.restingHr = hrN;
    const kcalN = toInt(kcal);
    if (kcalN !== undefined) data.activeKcal = kcalN;
    await setHealthDaily(date, data);
    onSaved?.();
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>手环数据</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={22} color={COLORS.textLight} />
            </TouchableOpacity>
          </View>

          <View style={styles.tabs}>
            <TouchableOpacity
              style={[styles.tab, tab === 'file' && styles.tabActive]}
              onPress={() => setTab('file')}
            >
              <Text style={[styles.tabText, tab === 'file' && styles.tabTextActive]}>导入文件</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, tab === 'manual' && styles.tabActive]}
              onPress={() => setTab('manual')}
            >
              <Text style={[styles.tabText, tab === 'manual' && styles.tabTextActive]}>手动录入</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            {tab === 'file' ? (
              <>
                <View style={styles.tipBox}>
                  <Text style={styles.tipTitle}>怎么拿到华为的数据文件</Text>
                  <Text style={styles.tipText}>
                    1. 手机打开「华为运动健康」App{'\n'}
                    2. 我的 → 隐私中心 → 申请导出个人数据{'\n'}
                    3. 等邮件/通知拿到压缩包，解压{'\n'}
                    4. 回到这里点下面按钮，选里面的 csv 或 json 文件
                  </Text>
                </View>

                <TouchableOpacity style={styles.pickBtn} onPress={pickFile} disabled={importing}>
                  {importing ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="document-attach-outline" size={16} color="#fff" />
                  )}
                  <Text style={styles.pickBtnText}>选择文件</Text>
                </TouchableOpacity>

                {!!fileName && (
                  <Text style={styles.fileName} numberOfLines={1}>
                    {fileName}
                  </Text>
                )}

                {preview.length > 0 && (
                  <>
                    <Text style={styles.previewSummary}>{summarizeImport(preview)}</Text>
                    <View style={styles.previewList}>
                      {preview.slice(0, 8).map((r) => (
                        <View key={r.date} style={styles.previewRow}>
                          <Text style={styles.previewDate}>{r.date}</Text>
                          <Text style={styles.previewVal}>
                            {[
                              r.steps !== undefined ? `${r.steps}步` : '',
                              r.sleepMin !== undefined ? `睡${Math.round((r.sleepMin / 60) * 10) / 10}h` : '',
                              r.restingHr !== undefined ? `${r.restingHr}bpm` : '',
                              r.activeKcal !== undefined ? `${r.activeKcal}kcal` : '',
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </Text>
                        </View>
                      ))}
                      {preview.length > 8 && (
                        <Text style={styles.previewMore}>…还有 {preview.length - 8} 天</Text>
                      )}
                    </View>
                  </>
                )}
              </>
            ) : (
              <>
                <Text style={styles.manualDate}>记录日期：{date}</Text>
                <Text style={styles.label}>步数</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="numeric"
                  value={steps}
                  onChangeText={setSteps}
                  placeholder="如 8600"
                  placeholderTextColor={COLORS.textLight}
                />
                <Text style={styles.label}>睡眠时长（小时）</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="numeric"
                  value={sleepH}
                  onChangeText={setSleepH}
                  placeholder="如 7.5"
                  placeholderTextColor={COLORS.textLight}
                />
                <Text style={styles.label}>静息心率（bpm）</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="numeric"
                  value={hr}
                  onChangeText={setHr}
                  placeholder="如 62"
                  placeholderTextColor={COLORS.textLight}
                />
                <Text style={styles.label}>手环记录的活动消耗（kcal）</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="numeric"
                  value={kcal}
                  onChangeText={setKcal}
                  placeholder="如 320"
                  placeholderTextColor={COLORS.textLight}
                />
              </>
            )}
          </ScrollView>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancel} onPress={onClose}>
              <Text style={styles.cancelText}>取消</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.save, tab === 'file' && preview.length === 0 && styles.saveDisabled]}
              onPress={tab === 'file' ? confirmImport : saveManual}
              disabled={importing || (tab === 'file' && preview.length === 0)}
            >
              <Text style={styles.saveText}>{tab === 'file' ? '确认导入' : '保存'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 16,
    paddingBottom: 24,
    maxHeight: '86%',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    marginBottom: 12,
  },
  title: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  tabs: {
    flexDirection: 'row',
    marginHorizontal: 18,
    backgroundColor: COLORS.background,
    borderRadius: 10,
    padding: 3,
    gap: 3,
  },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  tabActive: { backgroundColor: COLORS.primary },
  tabText: { fontSize: 13.5, color: COLORS.textLight },
  tabTextActive: { color: '#fff', fontWeight: '600' },
  body: { paddingHorizontal: 18, marginTop: 14 },
  tipBox: {
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FED7AA',
    borderRadius: 12,
    padding: 12,
  },
  tipTitle: { fontSize: 13.5, fontWeight: '700', color: '#C2410C', marginBottom: 6 },
  tipText: { fontSize: 12.5, color: '#9A3412', lineHeight: 20 },
  pickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 14,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
  },
  pickBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  fileName: { fontSize: 12, color: COLORS.textLight, marginTop: 8, textAlign: 'center' },
  previewSummary: { fontSize: 13, fontWeight: '600', color: COLORS.text, marginTop: 14 },
  previewList: { marginTop: 8, gap: 6 },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: COLORS.background,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  previewDate: { fontSize: 12.5, color: COLORS.text },
  previewVal: { fontSize: 12.5, color: COLORS.textLight, flexShrink: 1, textAlign: 'right' },
  previewMore: { fontSize: 12, color: COLORS.textLight, textAlign: 'center', marginTop: 2 },
  manualDate: { fontSize: 13, color: COLORS.textLight, marginBottom: 4 },
  label: { fontSize: 13, color: COLORS.textLight, marginTop: 12, marginBottom: 6 },
  input: {
    backgroundColor: COLORS.background,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: COLORS.text,
  },
  actions: { flexDirection: 'row', gap: 12, marginTop: 16, paddingHorizontal: 18 },
  cancel: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: COLORS.background,
    alignItems: 'center',
  },
  cancelText: { fontSize: 14, color: COLORS.textLight, fontWeight: '600' },
  save: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
  },
  saveDisabled: { opacity: 0.5 },
  saveText: { fontSize: 14, color: '#fff', fontWeight: '600' },
});

export default HealthImportSheet;
