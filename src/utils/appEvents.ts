import { DeviceEventEmitter } from 'react-native';

// 全局「数据已重置」事件：在清除全部数据 / 导入备份后广播，
// 各数据展示页（首页/统计/对话/随手记）订阅后重新拉取，保证多 Tab 同步。
export const DATA_RESET = 'app:dataReset';

export const emitDataReset = (): void => {
  try {
    DeviceEventEmitter.emit(DATA_RESET);
  } catch (e) {
    console.error('emitDataReset failed', e);
  }
};

export const onDataReset = (cb: () => void): (() => void) => {
  const sub = DeviceEventEmitter.addListener(DATA_RESET, cb);
  return () => sub.remove();
};
