import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Modal, TextInput } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useTimerStore } from '../store/timerStore';
import { useRecordsStore } from '../store/recordsStore';
import { COLORS, CONFIG, REASONS, TASK_TYPES } from '../constants/reasons';
import { formatDuration } from '../utils/analytics';
import { generateId, saveProfileImage, getProfileImage } from '../utils/storage';
import { ProcrastinationRecord } from '../types';

const COMMON_REASONS = ['焦虑逃避', '太累了', '任务太大', '刷社交媒体', '刷视频', '被通知打断'];
const DEFAULT_IMAGE_URL = 'https://picsum.photos/seed/procrastination/400/400';

type RootStackParamList = {
  home: undefined;
  statistics: undefined;
  portrait: undefined;
  plan: undefined;
  settings: undefined;
};

const TimerCard: React.FC = () => {
  const navigation = useNavigation<{ navigate: (screen: keyof RootStackParamList) => void }>();
  const { isRunning, startTimer, stopTimer, updateDuration, selectedReason, selectedTaskType, selectedNote } = useTimerStore();
  const { stats, addRecord } = useRecordsStore();
  const [displayDuration, setDisplayDuration] = useState(0);
  const [showReasonModal, setShowReasonModal] = useState(false);
  const [showQuickStartModal, setShowQuickStartModal] = useState(false);
  const [selectedReasonItem, setSelectedReasonItem] = useState('');
  const [selectedTaskTypeItem, setSelectedTaskTypeItem] = useState('other');
  const [note, setNote] = useState('');
  const [profileImage, setProfileImage] = useState<string>(DEFAULT_IMAGE_URL);
  const durationRef = useRef(0);

  useEffect(() => {
    durationRef.current = displayDuration;
  }, [displayDuration]);

  useEffect(() => {
    loadProfileImage();
  }, []);

  const loadProfileImage = async () => {
    const image = await getProfileImage();
    if (image) {
      setProfileImage(image);
    }
  };

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images' as any,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets[0].uri) {
        const sourceUri = result.assets[0].uri;
        // 复制到 App 持久目录，避免重装/清理缓存后失效
        const ext = (sourceUri.split('.').pop() || 'jpg').toLowerCase();
        const fileName = `profile_${Date.now()}.${ext}`;
        const destUri = `${FileSystem.documentDirectory}${fileName}`;
        await FileSystem.copyAsync({ from: sourceUri, to: destUri });
        setProfileImage(destUri);
        await saveProfileImage(destUri);
      }
    } catch (error) {
      console.error('Image picker error:', error);
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        alert('需要相册权限才能选择图片');
      }
    }
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
    setShowReasonModal(true);
  };

  const handleQuickStart = () => {
    setShowQuickStartModal(true);
  };

  const quickStartWithReason = (reason: string) => {
    startTimer(reason, 'other', '');
    setDisplayDuration(0);
    setShowQuickStartModal(false);
  };

  const confirmStart = () => {
    const reason = selectedReasonItem || '其他';
    startTimer(reason, selectedTaskTypeItem as 'work' | 'life' | 'entertainment' | 'other', note);
    setDisplayDuration(0);
    setShowReasonModal(false);
    setSelectedReasonItem('');
    setSelectedTaskTypeItem('other');
    setNote('');
  };

  const handleStop = async () => {
    const record: ProcrastinationRecord = {
      id: generateId(),
      startTime: Date.now() - displayDuration * 60000,
      endTime: Date.now(),
      duration: displayDuration,
      reason: selectedReason || '其他',
      taskType: selectedTaskType || 'other',
      note: selectedNote,
      createdAt: Date.now(),
    };
    await addRecord(record);
    stopTimer();
    setDisplayDuration(0);
  };

  const remainingTime = Math.max(0, CONFIG.dailyLimit - stats.todayDuration);
  const progress = Math.min((stats.todayDuration / CONFIG.dailyLimit) * 100, 100);

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <TouchableOpacity onPress={pickImage} activeOpacity={0.9}>
          <Image
            source={typeof profileImage === 'number' ? profileImage : { uri: profileImage }}
            style={styles.image}
            resizeMode="cover"
          />
        </TouchableOpacity>
        <View style={styles.overlay}>
          <Text style={styles.todayLabel}>今日拖延</Text>
          <Text style={styles.duration}>{formatDuration(isRunning ? displayDuration : stats.todayDuration)}</Text>
        </View>
      </View>
      
      <View style={styles.infoRow}>
        <Text style={styles.infoText}>上限 {CONFIG.dailyLimit}m</Text>
        <Text style={styles.infoText}>还剩 {remainingTime} 分钟</Text>
      </View>
      
      <View style={styles.progressBar}>
        <View 
          style={[styles.progressFill, { width: `${progress}%` }]}
        />
      </View>
      
      <View style={styles.buttonsRow}>
        <TouchableOpacity
          style={[styles.button, !isRunning ? styles.startButton : styles.buttonDisabled]}
          onPress={handleStart}
          disabled={isRunning}
          activeOpacity={0.85}
        >
          <Ionicons name="play-circle-outline" size={20} color="#fff" />
          <Text style={styles.buttonText}>{isRunning ? '计时中' : '开始拖延'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, isRunning ? styles.stopButton : styles.buttonDisabled]}
          onPress={handleStop}
          disabled={!isRunning}
          activeOpacity={0.85}
        >
          <Ionicons name="stop-circle-outline" size={20} color="#fff" />
          <Text style={styles.buttonText}>结束拖延</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.quickButtons}>
        <TouchableOpacity style={styles.quickButton} onPress={() => navigation.navigate('plan')} activeOpacity={0.85}>
          <Ionicons name="trophy-outline" size={16} color={COLORS.primary} />
          <Text style={styles.quickButtonText}>我的规划</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickButton} onPress={handleQuickStart} activeOpacity={0.85}>
          <Ionicons name="flash-outline" size={16} color={COLORS.primary} />
          <Text style={styles.quickButtonText}>快速启动</Text>
        </TouchableOpacity>
      </View>

      <Modal
        visible={showReasonModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowReasonModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>这次拖延了什么？</Text>
            
            <View style={styles.inputSection}>
              <Text style={styles.sectionLabel}>分类</Text>
              <View style={styles.reasonTags}>
                {REASONS.map((reason) => (
                  <TouchableOpacity
                    key={`timer-reason-${reason}`}
                    style={[
                      styles.reasonTag,
                      selectedReasonItem === reason && styles.reasonTagSelected,
                    ]}
                    onPress={() => setSelectedReasonItem(reason)}
                  >
                    <Text style={[
                      styles.reasonTagText,
                      selectedReasonItem === reason && styles.reasonTagTextSelected,
                    ]}>
                      {reason}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.inputSection}>
              <Text style={styles.sectionLabel}>类型标签（可选）</Text>
              <View style={styles.typeTags}>
                {TASK_TYPES.map((type) => (
                  <TouchableOpacity
                    key={`timer-type-${type.value}`}
                    style={[
                      styles.typeTag,
                      selectedTaskTypeItem === type.value && styles.typeTagSelected,
                    ]}
                    onPress={() => setSelectedTaskTypeItem(type.value)}
                  >
                    <Text style={[
                      styles.typeTagText,
                      selectedTaskTypeItem === type.value && styles.typeTagTextSelected,
                    ]}>
                      {type.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.inputSection}>
              <Text style={styles.sectionLabel}>一句话备注（可选）</Text>
              <TextInput
                style={styles.noteInput}
                placeholder="记录此刻的感受或上下文"
                placeholderTextColor={COLORS.textLighter}
                value={note}
                onChangeText={setNote}
                multiline
                maxLength={100}
              />
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.skipButton}
                onPress={() => {
                  confirmStart();
                }}
              >
                <Text style={styles.skipButtonText}>跳过</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmButton, !selectedReasonItem && styles.confirmButtonDisabled]}
                onPress={confirmStart}
                disabled={!selectedReasonItem}
              >
                <Text style={styles.confirmButtonText}>确认开始</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showQuickStartModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowQuickStartModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>快速启动</Text>
            <Text style={styles.modalSubtitle}>选择拖延原因，立即开始计时</Text>
            <View style={styles.quickStartGrid}>
              {COMMON_REASONS.map((reason) => (
                <TouchableOpacity
                  key={`quick-${reason}`}
                  style={styles.quickStartButton}
                  onPress={() => quickStartWithReason(reason)}
                >
                  <Text style={styles.quickStartButtonText}>{reason}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setShowQuickStartModal(false)}
            >
              <Text style={styles.closeButtonText}>取消</Text>
            </TouchableOpacity>
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
    backgroundColor: COLORS.card,
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
  image: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
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
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
    paddingHorizontal: 4,
  },
  infoText: {
    fontSize: 14,
    color: COLORS.textLight,
  },
  progressBar: {
    height: 6,
    backgroundColor: COLORS.border,
    borderRadius: 3,
    marginTop: 8,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 3,
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
    padding: 24,
    paddingBottom: 40,
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.text,
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
  typeTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  typeTag: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  typeTagSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  typeTagText: {
    fontSize: 14,
    color: COLORS.textLight,
  },
  typeTagTextSelected: {
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
  modalSubtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    marginBottom: 20,
  },
  quickStartGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },
  quickStartButton: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 14,
    backgroundColor: COLORS.secondary,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  quickStartButtonText: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '500',
  },
  closeButton: {
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
  },
  closeButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textLight,
  },
});

export default TimerCard;
