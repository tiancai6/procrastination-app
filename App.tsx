import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { Alert, View, Text, Modal, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import HomePage from './src/pages/HomePage';
import StatsCenterPage from './src/pages/StatsCenterPage';
import SettingsPage from './src/pages/SettingsPage';
import PlanListPage from './src/pages/PlanListPage';
import QuickMemoPage from './src/pages/QuickMemoPage';
import ChatPage from './src/pages/ChatPage';
import ExerciseCalendarPage from './src/pages/ExerciseCalendarPage';
import FoodLibraryPage from './src/pages/FoodLibraryPage';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { COLORS } from './src/constants/reasons';
import { trySelfHeal, checkExportReminder, doManualExport } from './src/utils/autoBackup';
import { migrateIfNeeded } from './src/utils/modelConfig';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

export const App: React.FC = () => {
  const [showReminder, setShowReminder] = useState(false);
  const [reminderDays, setReminderDays] = useState(0);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    (async () => {
      // 1. 启动自愈检查
      const heal = await trySelfHeal();
      if (heal.recovered) {
        Alert.alert('数据已恢复', '检测到数据异常，已自动从备份恢复。如发现数据缺失，可在设置中导入完整备份。');
      }

      // 1.5 老用户 GLM Key 自动迁移为多模型配置
      await migrateIfNeeded();

      // 2. 检查是否需要提醒导出备份
      const reminder = await checkExportReminder();
      if (reminder.shouldRemind) {
        setReminderDays(reminder.daysSinceLastExport);
        setShowReminder(true);
      }
    })();
  }, []);

  const handleExportNow = async () => {
    try {
      setExporting(true);
      await doManualExport();
      setShowReminder(false);
    } catch (e) {
      Alert.alert('导出失败', '请稍后到设置 → 导出备份手动操作');
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <NavigationContainer>
        <Stack.Navigator
          id="root-stack"
          screenOptions={{ headerShown: false }}
        >
          <Stack.Screen name="MainTabs" options={{ headerShown: false }}>
            {() => (
              <Tab.Navigator
                id="main-tab-navigator"
          screenOptions={{
            tabBarActiveTintColor: COLORS.primary,
            tabBarInactiveTintColor: COLORS.textLighter,
            tabBarStyle: {
              backgroundColor: COLORS.card,
              borderTopWidth: 0,
              elevation: 0,
              height: 64,
              paddingBottom: 12,
              paddingTop: 8,
              shadowColor: COLORS.shadow,
              shadowOffset: { width: 0, height: -2 },
              shadowOpacity: 0.05,
              shadowRadius: 8,
            },
            tabBarLabelStyle: {
              fontSize: 11,
              fontWeight: '600',
              marginTop: 2,
            },
            headerShown: false,
          }}
        >
        <Tab.Screen
          name="home"
          component={HomePage}
          options={{
            title: '首页',
            tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} />,
          }}
        />
        <Tab.Screen
          name="statscenter"
          component={StatsCenterPage}
          options={{
            title: '统计中心',
            tabBarIcon: ({ color, size }) => <Ionicons name="stats-chart-outline" color={color} size={size} />,
          }}
        />
        <Tab.Screen
          name="memo"
          component={QuickMemoPage}
          options={{
            title: '随手记',
            tabBarIcon: ({ color, size }) => <Ionicons name="book-outline" color={color} size={size} />,
          }}
        />
        <Tab.Screen
          name="plan"
          component={PlanListPage}
          options={{
            title: '规划',
            tabBarIcon: ({ color, size }) => <Ionicons name="checkbox-outline" color={color} size={size} />,
          }}
        />
        <Tab.Screen
          name="chat"
          component={ChatPage}
          options={{
            title: 'AI对话',
            tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles-outline" color={color} size={size} />,
          }}
        />
        <Tab.Screen
          name="settings"
          component={SettingsPage}
          options={{
            title: '我的',
            tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size} />,
          }}
        />
              </Tab.Navigator>
            )}
          </Stack.Screen>
          <Stack.Screen name="ExerciseCalendar" component={ExerciseCalendarPage} options={{ headerShown: false }} />
          <Stack.Screen name="FoodLibrary" component={FoodLibraryPage} options={{ headerShown: false }} />
        </Stack.Navigator>
      </NavigationContainer>

      {/* 定时备份提醒弹窗 */}
      <Modal visible={showReminder} transparent animationType="fade" onRequestClose={() => setShowReminder(false)}>
        <TouchableOpacity style={reminderStyles.overlay} activeOpacity={1} onPress={() => setShowReminder(false)}>
          <View style={reminderStyles.card}>
            <View style={reminderStyles.iconWrap}>
              <Ionicons name="cloud-upload-outline" size={40} color={COLORS.primary} />
            </View>
            <Text style={reminderStyles.title}>备份提醒</Text>
            <Text style={reminderStyles.desc}>
              {reminderDays < 0
                ? '你还未导出过备份。为防止 App 重装或证书失效导致数据丢失，建议立即导出一份完整备份到 iCloud。'
                : `距上次备份已 ${reminderDays} 天。建议定期导出备份，防止 App 重装导致数据丢失。`}
            </Text>
            <View style={reminderStyles.btnRow}>
              <TouchableOpacity style={reminderStyles.cancelBtn} onPress={() => setShowReminder(false)} disabled={exporting}>
                <Text style={reminderStyles.cancelText}>稍后</Text>
              </TouchableOpacity>
              <TouchableOpacity style={reminderStyles.confirmBtn} onPress={handleExportNow} disabled={exporting}>
                <Text style={reminderStyles.confirmText}>{exporting ? '导出中...' : '立即备份'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
};

const reminderStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    alignItems: 'center',
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  desc: {
    fontSize: 14,
    color: COLORS.textLight,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 20,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  cancelText: {
    color: COLORS.textLight,
    fontSize: 15,
    fontWeight: '500',
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
  },
  confirmText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});

export default App;