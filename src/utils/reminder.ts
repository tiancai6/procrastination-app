import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { QuickMemo } from '../types';

// 全局通知处理：默认弹出横幅；是否发声由每条通知的 sound 字段决定
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const CHANNEL_ID = 'memo-reminder';

const ensureChannel = async (): Promise<void> => {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: '随手记提醒',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
    });
  }
};

const buildTrigger = (reminder: NonNullable<QuickMemo['reminder']>): any => {
  const dt = new Date(reminder.datetime);
  if (reminder.repeat === 'none') {
    return { type: 'date', date: dt };
  }
  if (reminder.repeat === 'daily') {
    return { type: 'calendar', hour: dt.getHours(), minute: dt.getMinutes(), repeats: true };
  }
  // weekly：expo calendar weekday 1=周日 ... 7=周六
  const weekday = dt.getDay() + 1;
  return { type: 'calendar', weekday, hour: dt.getHours(), minute: dt.getMinutes(), repeats: true };
};

// 调度提醒，返回 notificationId（用于后续取消）；无权限或失败返回 null
export const scheduleMemoReminder = async (memo: QuickMemo): Promise<string | null> => {
  if (!memo.reminder) return null;
  try {
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') return null;

    await ensureChannel();

    const sound = memo.reminder.channel === 'sound' ? 'default' : undefined;
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: '随手记提醒',
        body: (memo.content || '你有一条提醒').slice(0, 100),
        sound,
      },
      trigger: buildTrigger(memo.reminder),
    });
    return notificationId;
  } catch (e) {
    console.error('[Reminder] schedule failed', e);
    return null;
  }
};

export const cancelMemoReminder = async (notificationId?: string): Promise<void> => {
  if (!notificationId) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch (e) {
    console.error('[Reminder] cancel failed', e);
  }
};
