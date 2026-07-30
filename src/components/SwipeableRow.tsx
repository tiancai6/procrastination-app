import React, { useRef } from 'react';
import { View, Animated, PanResponder, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/reasons';

const DELETE_WIDTH = 76;

interface SwipeableRowProps {
  onDelete: () => void;
  children: React.ReactNode;
}

const SwipeableRow: React.FC<SwipeableRowProps> = ({ onDelete, children }) => {
  const panX = useRef(new Animated.Value(0)).current;
  const startX = useRef(0);
  const closingTap = useRef(false);

  const close = () =>
    Animated.spring(panX, { toValue: 0, useNativeDriver: true, friction: 30 }).start();
  const open = () =>
    Animated.spring(panX, { toValue: -DELETE_WIDTH, useNativeDriver: true, friction: 30 }).start();

  const panResponder = useRef(
    PanResponder.create({
      // 只在明显水平滑动时才接管手势，垂直滑动/点按交给列表与子元素
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: () => {
        const cur = (panX as any)._value ?? 0;
        startX.current = cur;
        // 已经展开时，轻点一下先收起
        if (cur <= -DELETE_WIDTH + 1) {
          close();
          closingTap.current = true;
        } else {
          closingTap.current = false;
        }
      },
      onPanResponderMove: (_e, g) => {
        if (closingTap.current) return;
        let x = startX.current + g.dx;
        if (x > 0) x = 0;
        if (x < -DELETE_WIDTH) x = -DELETE_WIDTH;
        panX.setValue(x);
      },
      onPanResponderRelease: (_e, g) => {
        if (closingTap.current) {
          closingTap.current = false;
          return;
        }
        const x = startX.current + g.dx;
        if (x < -DELETE_WIDTH / 2) open();
        else close();
      },
    }),
  ).current;

  return (
    <View style={styles.container}>
      <View style={styles.deleteBg}>
        <TouchableOpacity style={styles.deleteBtn} onPress={onDelete} activeOpacity={0.8}>
          <Ionicons name="trash-outline" size={20} color="#fff" />
          <Text style={styles.deleteText}>删除</Text>
        </TouchableOpacity>
      </View>
      <Animated.View
        {...panResponder.panHandlers}
        style={[styles.front, { transform: [{ translateX: panX }] }]}
      >
        {children}
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#E5484D',
    borderRadius: 14,
    marginBottom: 8,
    overflow: 'hidden',
  },
  deleteBg: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: 22,
  },
  deleteBtn: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: {
    color: '#fff',
    fontSize: 12,
    marginTop: 2,
  },
  front: {
    backgroundColor: 'transparent',
  },
});

export default SwipeableRow;
