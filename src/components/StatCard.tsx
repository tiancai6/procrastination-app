import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/reasons';
import { formatDuration } from '../utils/analytics';

interface StatCardProps {
  icon: string;
  label: string;
  value: number;
  unit?: string;
}

const StatCard: React.FC<StatCardProps> = ({ icon, label, value, unit = '' }) => {
  return (
    <View style={styles.card}>
      <View style={styles.iconWrapper}>
        <View style={styles.iconBg} />
        <Ionicons name={icon as any} size={20} color={COLORS.primary} style={styles.icon} />
      </View>
      <Text style={styles.value}>
        {unit === 'm' ? formatDuration(value) : value}
        {unit && unit !== 'm' && (
          <Text style={styles.unit}> {unit}</Text>
        )}
      </Text>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.accentBar} />
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 10,
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 3,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  iconWrapper: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  iconBg: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.secondary,
    opacity: 0.8,
  },
  icon: {
    zIndex: 1,
  },
  value: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.text,
    textAlign: 'center',
  },
  unit: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textLight,
  },
  label: {
    fontSize: 11,
    color: COLORS.textLight,
    marginTop: 4,
    letterSpacing: 0.3,
  },
  accentBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: COLORS.primary,
    opacity: 0.7,
  },
});

export default StatCard;
