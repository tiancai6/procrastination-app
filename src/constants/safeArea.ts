import { Platform, StatusBar } from 'react-native';
import { initialWindowMetrics } from 'react-native-safe-area-context';

// 状态栏 / 刘海 / 灵动岛 的安全区顶部高度。
// 用于把页面内容从状态栏时间行下方开始排布，避免与时间、电池重叠。
// initialWindowMetrics 在原生启动时即捕获真实顶部 inset（含刘海/灵动岛），
// 无需 SafeAreaProvider；取不到时按平台回退到合理默认值。
export const TOP_INSET =
  initialWindowMetrics?.insets.top ??
  (Platform.OS === 'ios' ? 44 : (StatusBar.currentHeight ?? 0));
