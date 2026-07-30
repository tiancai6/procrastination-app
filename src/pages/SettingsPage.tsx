import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Modal, TextInput, Switch, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { COLORS } from '../constants/reasons';
import { TOP_INSET } from '../constants/safeArea';
import { clearAllData, saveProfileImage, getProfileImage, getApiKey, setApiKey, getModel, setModel } from '../utils/storage';
import { importBackup } from '../utils/backup';
import { doManualExport } from '../utils/autoBackup';

const SettingsPage: React.FC = () => {
  const [showEditModal, setShowEditModal] = useState(false);
  const [showTimeModal, setShowTimeModal] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [userName, setUserName] = useState('用户');
  const [avatarImage, setAvatarImage] = useState<string | null>(null);
  const [dailyLimit, setDailyLimit] = useState(45);
  const [newDailyLimit, setNewDailyLimit] = useState(45);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showAIModal, setShowAIModal] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [aiModelInput, setAiModelInput] = useState('glm-4-flash');
  const [aiEnabled, setAiEnabled] = useState(false);

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    const image = await getProfileImage();
    if (image) {
      setAvatarImage(image);
    }
  };

  const pickAvatar = async () => {
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
      setAvatarImage(destUri);
      await saveProfileImage(destUri);
    }
  };

  const handleExportData = async () => {
    try {
      const { recordCount, fileName, fileSizeKB } = await doManualExport();
      const sizeText = fileSizeKB < 1024
        ? `${fileSizeKB} KB`
        : `${(fileSizeKB / 1024).toFixed(2)} MB`;

      let warning = '';
      if (fileSizeKB > 25 * 1024) {
        warning = '\n\n⚠️ 文件较大（超过 25MB），微信等社交应用可能发送失败，建议选择「存储到文件」保存到 iCloud。';
      } else if (fileSizeKB > 10 * 1024) {
        warning = '\n\n💡 文件较大，建议选择「存储到文件」保存到 iCloud，更稳定可靠。';
      }

      Alert.alert(
        '导出备份',
        `已生成完整备份（含 ${recordCount} 条拖延记录、规划、打卡、记账、AI 对话、随手记及头像图片）\n\n文件大小：${sizeText}\n\n${fileName}\n\n可通过微信"文件传输助手"发送到电脑，或"存储到文件"保存到 iCloud。${warning}`,
      );
    } catch (error) {
      Alert.alert('导出失败', '无法导出数据，请重试');
    }
  };

  const handleImportData = () => {
    Alert.alert(
      '导入备份',
      '导入将覆盖手机上现有的全部数据，确定继续吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '选择备份文件',
          onPress: async () => {
            try {
              const result = await importBackup();
              if (result) {
                await loadProfile();
                Alert.alert(
                  '导入成功',
                  `已恢复 ${result.recordCount} 条拖延记录及全部规划、打卡数据。\n\n请切换到其他页面查看最新数据。`,
                );
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : '无法读取备份文件';
              Alert.alert('导入失败', message);
            }
          },
        },
      ]
    );
  };

  const openAIModal = async () => {
    const k = await getApiKey();
    const m = await getModel();
    setApiKeyInput(k || '');
    setAiModelInput(m || 'glm-4-flash');
    setAiEnabled(!!k);
    setShowAIModal(true);
  };

  const saveAISettings = async () => {
    const key = apiKeyInput.trim();
    await setApiKey(key);
    await setModel(aiModelInput.trim() || 'glm-4-flash');
    setAiEnabled(!!key);
    setShowAIModal(false);
    Alert.alert('已保存', key ? 'AI 分析已开启' : '已关闭 AI 分析');
  };

  const handleSaveTimeLimit = () => {
    if (newDailyLimit >= 1 && newDailyLimit <= 1440) {
      setDailyLimit(newDailyLimit);
      setShowTimeModal(false);
      Alert.alert('成功', `每日上限已设置为 ${newDailyLimit} 分钟`);
    } else {
      Alert.alert('错误', '请输入1-1440之间的数字');
    }
  };

  const menuItems = [
    { 
      icon: <Ionicons name="notifications-outline" size={20} color={COLORS.primary} />, 
      label: '通知设置', 
      description: '管理提醒和推送',
      action: () => {},
      switch: true,
      switchValue: notificationsEnabled,
      onSwitchChange: setNotificationsEnabled,
    },
    { 
      icon: <Ionicons name="volume-high-outline" size={20} color={COLORS.primary} />, 
      label: '声音设置', 
      description: '计时结束提示音',
      action: () => {},
      switch: true,
      switchValue: soundEnabled,
      onSwitchChange: setSoundEnabled,
    },
    { 
      icon: <Ionicons name="time-outline" size={20} color={COLORS.primary} />, 
      label: '时间设置', 
      description: `每日上限 ${dailyLimit} 分钟`,
      action: () => setShowTimeModal(true),
    },
    { 
      icon: <Ionicons name="sparkles-outline" size={20} color={COLORS.primary} />, 
      label: 'AI 智能分析', 
      description: aiEnabled ? '已开启 · GLM-4-Flash' : '填入 API Key 开启',
      action: openAIModal,
    },
    { 
      icon: <Ionicons name="share-outline" size={20} color={COLORS.primary} />, 
      label: '导出备份', 
      description: '打包全部数据，发送到电脑保存',
      action: handleExportData,
    },
    { 
      icon: <Ionicons name="download-outline" size={20} color={COLORS.primary} />, 
      label: '导入备份', 
      description: '从备份文件恢复全部数据',
      action: handleImportData,
    },
    { 
      icon: <Ionicons name="help-circle-outline" size={20} color={COLORS.primary} />, 
      label: '帮助与反馈', 
      description: '常见问题解答',
      action: () => {
        Alert.alert(
          '帮助与反馈',
          '如有问题或建议，请通过以下方式联系我们：\n\n邮箱：support@example.com\n微信：procrastination_help',
        );
      },
    },
    { 
      icon: <Ionicons name="information-circle-outline" size={20} color={COLORS.primary} />, 
      label: '关于应用', 
      description: '版本信息',
      action: () => setShowAboutModal(true),
    },
  ];

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>个人中心</Text>
      </View>

      <TouchableOpacity 
        style={styles.userCard}
        onPress={() => setShowEditModal(true)}
      >
        <View style={styles.avatar}>
              {avatarImage ? (
                <Image source={{ uri: avatarImage }} style={styles.avatarImage} />
              ) : (
                <Ionicons name="person-outline" size={40} color="#999" />
              )}
            </View>
        <View style={styles.userInfo}>
          <Text style={styles.userName}>{userName}</Text>
          <Text style={styles.userEmail}>点击编辑个人信息</Text>
        </View>
        <Text style={styles.menuArrow}>›</Text>
      </TouchableOpacity>

      <View style={styles.menuList}>
        {menuItems.map((item) => (
          <TouchableOpacity 
            key={item.label} 
            style={styles.menuItem}
            onPress={item.action}
            disabled={item.switch}
          >
            {item.icon}
            <View style={styles.menuContent}>
              <Text style={styles.menuLabel}>{item.label}</Text>
              <Text style={styles.menuDescription}>{item.description}</Text>
            </View>
            {item.switch ? (
              <Switch
                value={item.switchValue}
                onValueChange={item.onSwitchChange}
              />
            ) : (
              <Text style={styles.menuArrow}>›</Text>
            )}
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={styles.clearButton}
        onPress={() => {
          Alert.alert(
            '清除数据',
            '确定要清除所有记录数据吗？此操作不可恢复。',
            [
              { text: '取消', style: 'cancel' },
              { text: '确定', onPress: async () => {
                await clearAllData();
                setAvatarImage(null);
                Alert.alert('成功', '所有数据已清除');
              }},
            ]
          );
        }}
      >
        <Text style={styles.clearButtonText}>清除所有数据</Text>
      </TouchableOpacity>

      <View style={styles.version}>
        <Text style={styles.versionText}>拖延记录 v1.0.0</Text>
      </View>

      <Modal
        visible={showEditModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowEditModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>编辑个人信息</Text>
            
            <View style={styles.avatarEditSection}>
              <TouchableOpacity style={styles.avatarEdit} onPress={pickAvatar}>
                {avatarImage ? (
                  <Image source={{ uri: avatarImage }} style={styles.avatarImageLarge} />
                ) : (
                  <Ionicons name="person-outline" size={48} color={COLORS.textLighter} />
                )}
              </TouchableOpacity>
              <Text style={styles.avatarEditLabel}>点击更换头像</Text>
            </View>

            <TextInput
              style={styles.input}
              placeholder="昵称"
              value={userName}
              onChangeText={setUserName}
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setShowEditModal(false)}
              >
                <Text style={styles.cancelButtonText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmButton}
                onPress={() => setShowEditModal(false)}
              >
                <Text style={styles.confirmButtonText}>保存</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showTimeModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowTimeModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>时间设置</Text>
            <Text style={styles.modalDescription}>设置每日拖延时间上限（分钟）</Text>
            
            <TextInput
              style={styles.input}
              placeholder="输入分钟数"
              keyboardType="numeric"
              value={String(newDailyLimit)}
              onChangeText={(text) => setNewDailyLimit(Number(text))}
            />

            <View style={styles.timePresets}>
              <TouchableOpacity 
                style={styles.timePreset} 
                onPress={() => setNewDailyLimit(30)}
              >
                <Text style={styles.timePresetText}>30分钟</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.timePreset} 
                onPress={() => setNewDailyLimit(45)}
              >
                <Text style={styles.timePresetText}>45分钟</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.timePreset} 
                onPress={() => setNewDailyLimit(60)}
              >
                <Text style={styles.timePresetText}>60分钟</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setShowTimeModal(false)}
              >
                <Text style={styles.cancelButtonText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmButton}
                onPress={handleSaveTimeLimit}
              >
                <Text style={styles.confirmButtonText}>保存</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showAIModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowAIModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>AI 智能分析</Text>
            <Text style={styles.modalDescription}>
              粘贴你的 GLM API Key（在智谱开放平台 open.bigmodel.cn 获取，glm-4-flash 免费）。开启后，仅会把匿名统计摘要发送给 AI 生成洞察，原始记录不会上传。
            </Text>

            <TextInput
              style={styles.input}
              placeholder="粘贴 GLM API Key（形如 glm-...）"
              value={apiKeyInput}
              onChangeText={setApiKeyInput}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={styles.modalDescription}>模型（默认 glm-4-flash，可改为 glm-4-plus 等）</Text>
            <TextInput
              style={styles.input}
              placeholder="glm-4-flash"
              value={aiModelInput}
              onChangeText={setAiModelInput}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setShowAIModal(false)}
              >
                <Text style={styles.cancelButtonText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmButton}
                onPress={saveAISettings}
              >
                <Text style={styles.confirmButtonText}>保存</Text>
              </TouchableOpacity>
            </View>

            {aiEnabled && (
              <TouchableOpacity
                style={styles.aiClearKey}
                onPress={async () => {
                  await setApiKey('');
                  setApiKeyInput('');
                  setAiEnabled(false);
                  setShowAIModal(false);
                  Alert.alert('已关闭', '已清除 API Key 并关闭 AI 分析');
                }}
              >
                <Text style={styles.aiClearKeyText}>清除 Key 并关闭 AI</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={showAboutModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowAboutModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>关于应用</Text>
            
            <View style={styles.aboutContent}>
              <Text style={styles.aboutText}>拖延记录</Text>
              <Text style={styles.aboutText}>版本 v1.0.0</Text>
              <Text style={styles.aboutText}>iOS / Android</Text>
              <View style={styles.divider} />
              <Text style={styles.aboutTitle}>功能特点</Text>
              <Text style={styles.aboutFeature}>• 记录每次拖延的时间和原因</Text>
              <Text style={styles.aboutFeature}>• 统计分析拖延习惯</Text>
              <Text style={styles.aboutFeature}>• 任务规划减少拖延</Text>
              <Text style={styles.aboutFeature}>• 快速启动即时记录</Text>
              <View style={styles.divider} />
              <Text style={styles.aboutTitle}>隐私政策</Text>
              <Text style={styles.aboutText}>所有原始数据均存储在本地设备。开启 AI 分析后，仅会把上述数据的匿名统计摘要（不含任何个人身份信息）发送给 AI 服务用于生成洞察，原始记录不会上传。</Text>
            </View>

            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setShowAboutModal(false)}
            >
              <Text style={styles.closeButtonText}>确定</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingTop: TOP_INSET,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 36,
    paddingBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: 0.5,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    padding: 20,
    backgroundColor: COLORS.card,
    borderRadius: 20,
    marginBottom: 16,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  avatar: {
    width: 64,
    height: 64,
    backgroundColor: COLORS.secondary,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: COLORS.primaryLight,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarText: {
    fontSize: 32,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 4,
  },
  userEmail: {
    fontSize: 13,
    color: COLORS.textLight,
  },
  menuList: {
    marginHorizontal: 16,
    backgroundColor: COLORS.card,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  menuIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  menuContent: {
    flex: 1,
    marginLeft: 12,
  },
  menuLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 2,
  },
  menuDescription: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  menuArrow: {
    fontSize: 22,
    color: COLORS.textLighter,
    fontWeight: '300',
  },
  clearButton: {
    marginHorizontal: 16,
    padding: 16,
    backgroundColor: '#FEF2F2',
    borderRadius: 16,
    alignItems: 'center',
    marginTop: 24,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  clearButtonText: {
    fontSize: 16,
    color: COLORS.danger,
    fontWeight: '700',
  },
  version: {
    padding: 20,
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 8,
  },
  versionText: {
    fontSize: 13,
    color: COLORS.textLighter,
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
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 8,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  modalDescription: {
    fontSize: 14,
    color: COLORS.textLight,
    marginBottom: 16,
  },
  input: {
    height: 50,
    backgroundColor: COLORS.background,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    color: COLORS.text,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    backgroundColor: COLORS.secondary,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.primaryDark,
  },
  confirmButton: {
    flex: 1,
    paddingVertical: 14,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  avatarEditSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  avatarEdit: {
    width: 100,
    height: 100,
    backgroundColor: COLORS.secondary,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: COLORS.primaryLight,
  },
  avatarImageLarge: {
    width: '100%',
    height: '100%',
  },
  avatarTextLarge: {
    fontSize: 48,
  },
  avatarEditLabel: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '500',
  },
  timePresets: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  timePreset: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: COLORS.secondary,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.primaryLight,
  },
  timePresetText: {
    fontSize: 14,
    color: COLORS.primaryDark,
    fontWeight: '600',
  },
  aboutContent: {
    marginBottom: 20,
  },
  aboutText: {
    fontSize: 15,
    color: COLORS.text,
    marginBottom: 8,
  },
  aboutTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.primaryDark,
    marginBottom: 8,
  },
  aboutFeature: {
    fontSize: 14,
    color: COLORS.textLight,
    marginBottom: 6,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 16,
  },
  closeButton: {
    paddingVertical: 14,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  closeButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  aiClearKey: {
    marginTop: 12,
    alignItems: 'center',
    paddingVertical: 10,
  },
  aiClearKeyText: {
    fontSize: 14,
    color: COLORS.danger,
    fontWeight: '600',
  },
});

export default SettingsPage;
