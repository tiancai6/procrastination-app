import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { COLORS } from '../constants/reasons';

// ============ 极简全局 Toast ============
// model.ts 在每次 AI 调用后调用 showToast 提示「用了哪个模型 + 花了多少 token」。
// 在 App.tsx 挂载 <ToastHost /> 即可生效；模块级 listener 保证任意位置都能触发。

let listener: ((msg: string) => void) | null = null;

export const showToast = (msg: string): void => {
  listener?.(msg);
};

export const ToastHost: React.FC = () => {
  const [msg, setMsg] = useState<string | null>(null);
  const [opacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    listener = (m: string) => {
      setMsg(m);
      opacity.setValue(0);
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.delay(2200),
        Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start(() => setMsg(null));
    };
    return () => {
      listener = null;
    };
  }, [opacity]);

  if (!msg) return null;
  return (
    <Animated.View style={[toastStyles.container, { opacity }]}>
      <Text style={toastStyles.text}>{msg}</Text>
    </Animated.View>
  );
};

const toastStyles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 96,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    zIndex: 9999,
  },
  text: {
    color: '#fff',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
});
