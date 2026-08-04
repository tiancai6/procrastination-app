import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, TextInput, Alert, ImageBackground, Keyboard, Dimensions, ScrollView } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTimerStore } from '../store/timerStore';
import { useSessionStore } from '../store/sessionStore';
import { COLORS, FOCUS_CATEGORIES } from '../constants/reasons';
import { formatDuration } from '../utils/analytics';
import { generateId, saveFocusBackground, getFocusBackground, clearFocusBackground } from '../utils/storage';
import { TimerCategory } from '../types';

type RootStackParamList = {
  home: undefined;
  statscenter: undefined;
  plan: undefined;
  settings: undefined;
};

const TimerCard: React.FC = () => {
  const navigation = useNavigation<{ navigate: (screen: keyof RootStackParamList) => void }>();
  const { isRunning, startTimer, stopTimer, updateDuration } = useTimerStore();
  const { stats, addSession } = useSessionStore();
  const [displayDuration, setDisplayDuration] = useState(0);
  const [showEndModal, setShowEndModal] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<TimerCategory>('work');
  const [what, setWhat] = useState('');
  const [bgUri, setBgUri] = useState<string | null>(null);
  const durationRef = useRef(0);

  useEffect(() => {
    durationRef.current = displayDuration;
  }, [displayDuration]);

  // 挂载时读取已保存的卡片背景图
  useEffect(() => {
    (async () => {
      const uri = await getFocusBackground();
      if (uri) setBgUri(uri);
    })();
  }, []);

  // 监听键盘高度：弹窗内输入框（备注）被键盘遮挡时，把整张弹窗抬到键盘上方
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const screenHeight = Dimensions.get('window').height;
  useEffect(() => {
    const onShow = (e: { endCoordinates: { height: number } }) => setKeyboardHeight(e.endCoordinates.height);
    const onHide = () => setKeyboardHeight(0);
    const subShow = Keyboard.addListener('keyboardDidShow', onShow);
    const subHide = Keyboard.addListener('keyboardDidHide', onHide);
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, []);

  // 从相册选图：先压缩/缩放（卡片仅约 200pt 高，缩到宽 1000 足够且看不出差别），
  // 既避免原图（尤其 HEIC/大图）把备份撑得过大，也统一转成 JPEG 便于跨设备恢复，
  // 再复制到 App 沙盒持久目录（镜像头像图模式）
  const pickBackground = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images' as any,
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.8,
    });

    if (!result.canceled && result.assets && result.assets[0].uri) {
      const manipulated = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 1000 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
      );
      const sourceUri = manipulated.uri || result.assets[0].uri;
      const fileName = `focus_bg_${Date.now()}.jpg`;
      const destUri = `${FileSystem.documentDirectory}${fileName}`;
      await FileSystem.copyAsync({ from: sourceUri, to: destUri });
      setBgUri(destUri);
      await saveFocusBackground(destUri);
    }
  };

  // 长按清除背景图，恢复默认蓝色
  const clearBackground = () => {
    Alert.alert('清除背景图', '确定恢复为默认蓝色背景吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '清除',
        style: 'destructive',
        onPress: async () => {
          setBgUri(null);
          await clearFocusBackground();
        },
      },
    ]);
  };

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (isRunning) {
      interval = setInterval(() => {
        const newDuration = durationRef.current + 1;
        setDisplayDuration(newDuration);
        updateDuration(newDuration);
      }, 60000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRunning]);

  const handleStart = () => {
    setDisplayDuration(0);
    startTimer();
  };

  const handleStop = () => {
    setShowEndModal(true);
  };

  const confirmEnd = async () => {
    const duration = durationRef.current;
    const session = {
      id: generateId(),
      startTime: Date.now() - duration * 60000,
      endTime: Date.now(),
      duration,
      category: selectedCategory,
      what: what.trim(),
      createdAt: Date.now(),
    };
    await addSession(session);
    stopTimer();
    setDisplayDuration(0);
    setShowEndModal(false);
    setWhat('');
    setSelectedCategory('work');
  };

  const cancelEnd = () => {
    stopTimer();
    setDisplayDuration(0);
    setShowEndModal(false);
    setWhat('');
    setSelectedCategory('work');
  };

  const shownDuration = isRunning ? displayDuration : stats.todayDuration;
  const hint = isRunning
    ? `计时中 · 已 ${formatDuration(displayDuration)}`
    : `今日已专注 ${formatDuration(stats.todayDuration)}`;

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        {bgUri ? (
          <ImageBackground source={{ uri: bgUri }} style={styles.cardImage} imageStyle={styles.cardImageInner}>
            <View style={styles.scrim} />
          </ImageBackground>
        ) : null}
        <View style={styles.overlay}>
          <Text style={styles.todayLabel}>{isRunning ? '专注计时中' : '今日专注'}</Text>
          <Text style={styles.duration}>{formatDuration(shownDuration)}</Text>
          <Text style={styles.hint}>{hint}</Text>
        </View>
        <TouchableOpacity
          style={styles.bgButton}
          onPress={pickBackground}
          onLongPress={clearBackground}
          activeOpacity={0.8}
        >
          <Ionicons name="images-outline" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={styles.buttonsRow}>
        <TouchableOpacity
          style={[styles.button, !isRunning ? styles.startButton : styles.buttonDisabled]}
          onPress={handleStart}
          disabled={isRunning}
          activeOpacity={0.85}
        >
          <Ionicons name="play-circle-outline" size={20} color="#fff" />
          <Text style={styles.buttonText}>{isRunning ? '计时中' : '开始计时'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, isRunning ? styles.stopButton : styles.buttonDisabled]}
          onPress={handleStop}
          disabled={!isRunning}
          activeOpacity={0.85}
        >
          <Ionicons name="stop-circle-outline" size={20} color="#fff" />
          <Text style={styles.buttonText}>结束计时</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.quickButtons}>
        <TouchableOpacity style={styles.quickButton} onPress={() => navigation.navigate('plan')} activeOpacity={0.85}>
          <Ionicons name="checkbox-outline" size={16} color={COLORS.primary} />
          <Text style={styles.quickButtonText}>我的规划</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickButton} onPress={() => navigation.navigate('statscenter')} activeOpacity={0.85}>
          <Ionicons name="stats-chart-outline" size={16} color={COLORS.primary} />
          <Text style={styles.quickButtonText}>专注统计</Text>
        </TouchableOpacity>
      </View>

      <Modal
        visible={showEndModal}
        animationType="slide"
        transparent={true}
        onRequestClose={cancelEnd}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalContent,
              keyboardHeight > 0 && {
                maxHeight: screenHeight - keyboardHeight - 16,
                marginBottom: keyboardHeight,
              },
            ]}
          >
            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.modalTitle}>这次专注做了什么？</Text>
              <Text style={styles.modalSubtitle}>时长 {formatDuration(durationRef.current)}</Text>

              <View style={styles.inputSection}>
                <Text style={styles.sectionLabel}>分类</Text>
                <View style={styles.reasonTags}>
                  {FOCUS_CATEGORIES.map((c) => (
                    <TouchableOpacity
                      key={`cat-${c.value}`}
                      style={[styles.reasonTag, selectedCategory === c.value && styles.reasonTagSelected]}
                      onPress={() => setSelectedCategory(c.value)}
                    >
                      <Text style={[styles.reasonTagText, selectedCategory === c.value && styles.reasonTagTextSelected]}>
                        {c.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.inputSection}>
                <Text style={styles.sectionLabel}>记录这段时间的收获 / 内容（可选）</Text>
                <TextInput
                  style={styles.noteInput}
                  placeholder="例如：写完周报、练了胸+三头、读了 30 页书"
                  placeholderTextColor={COLORS.textLighter}
                  value={what}
                  onChangeText={setWhat}
                  multiline
                  maxLength={100}
                />
              </View>

              <View style={styles.modalButtons}>
                <TouchableOpacity style={styles.skipButton} onPress={cancelEnd}>
                  <Text style={styles.skipButtonText}>不保存</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmButton, durationRef.current <= 0 && styles.confirmButtonDisabled]}
                  onPress={confirmEnd}
                  disabled={durationRef.current <= 0}
                >
                  <Text style={styles.confirmButtonText}>保存记录</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: COLORS.background,
  },
  card: {
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.secondary,
    overflow: 'hidden',
    height: 200,
    position: 'relative',
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  cardImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  cardImageInner: {
    borderRadius: 16,
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  bgButton: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
  },
  overlay: {
    position: 'absolute',
    bottom: 20,
    left: 20,
  },
  todayLabel: {
    color: '#fff',
    fontSize: 14,
    opacity: 0.9,
    marginBottom: 4,
  },
  duration: {
    color: '#fff',
    fontSize: 48,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  hint: {
    color: '#fff',
    fontSize: 13,
    opacity: 0.8,
    marginTop: 6,
  },
  buttonsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  button: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  startButton: {
    backgroundColor: COLORS.primary,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  stopButton: {
    backgroundColor: COLORS.danger,
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonDisabled: {
    backgroundColor: COLORS.border,
    opacity: 0.7,
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  quickButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  quickButton: {
    flex: 1,
    height: 44,
    borderRadius: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.secondary,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  quickButtonText: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '80%',
    overflow: 'hidden',
  },
  modalScroll: {
    flex: 1,
  },
  modalScrollContent: {
    padding: 24,
    paddingBottom: 40,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 6,
  },
  modalSubtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    marginBottom: 20,
  },
  inputSection: {
    marginBottom: 20,
  },
  sectionLabel: {
    fontSize: 14,
    color: COLORS.textLight,
    marginBottom: 12,
    fontWeight: '500',
  },
  reasonTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  reasonTag: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  reasonTagSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  reasonTagText: {
    fontSize: 14,
    color: COLORS.textLight,
  },
  reasonTagTextSelected: {
    color: '#fff',
    fontWeight: '500',
  },
  noteInput: {
    height: 80,
    padding: 12,
    backgroundColor: COLORS.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    fontSize: 14,
    color: COLORS.text,
    textAlignVertical: 'top',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  skipButton: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  skipButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textLight,
  },
  confirmButton: {
    flex: 2,
    height: 52,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  confirmButtonDisabled: {
    opacity: 0.5,
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});

export default TimerCard;
