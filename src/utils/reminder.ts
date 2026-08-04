import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { QuickMemo, Reminder } from '../types';

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

// ============ 待办（Reminder）通知 ============
const TODO_CHANNEL = 'todo-reminder';

const ensureTodoChannel = async (): Promise<void> => {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(TODO_CHANNEL, {
      name: '待办提醒',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
    });
  }
};

// 为某条待办调度一次性通知；返回 notificationId（存储到 Reminder 上以便取消）；无权限返回 null
export const scheduleTodoReminder = async (reminder: Reminder): Promise<string | null> => {
  if (!reminder.time || reminder.done) return null;
  try {
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') return null;
    await ensureTodoChannel();

    const [h, m] = reminder.time.split(':').map(Number);
    const dt = new Date(`${reminder.date}T00:00:00`);
    dt.setHours(h, m, 0, 0);
    if (dt.getTime() <= Date.now()) return null; // 时间已过则不调度

    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: '待办提醒',
        body: reminder.title,
        sound: 'default',
      },
      trigger: { type: 'date', date: dt } as any,
    });
    return notificationId;
  } catch (e) {
    console.error('[Reminder] schedule todo failed', e);
    return null;
  }
};

export const cancelTodoReminder = async (notificationId?: string | null): Promise<void> => {
  if (!notificationId) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch (e) {
    console.error('[Reminder] cancel todo failed', e);
  }
};
