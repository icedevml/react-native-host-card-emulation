import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

export const colors = {
  background: '#f3f4f6',
  surface: '#ffffff',
  border: '#e5e7eb',
  text: '#111827',
  textMuted: '#6b7280',
  primary: '#2563eb',
  primaryPressed: '#1d4ed8',
  primaryActive: '#1e3a8a',
  primaryActiveBorder: '#93c5fd',
  activeIndicator: '#4ade80',
  disabled: '#9ca3af',
  logBackground: '#0f172a',
  logText: '#e2e8f0',
  logMuted: '#64748b',
  logForeground: '#38bdf8',
  logBackgroundTask: '#fbbf24',
};

export const monospaceFont = Platform.select({ ios: 'Menlo', default: 'monospace' });

interface ActionButtonProps {
  title: string;
  subtitle?: string;
  onPress: () => void;
  disabled?: boolean;
  // keeps the button looking pressed in (e.g. while the action it started is in progress)
  active?: boolean;
}

export function ActionButton({ title, subtitle, onPress, disabled, active }: ActionButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        pressed && styles.buttonPressed,
        active && styles.buttonActive,
        disabled && styles.buttonDisabled,
      ]}
    >
      <View style={styles.buttonRow}>
        {active ? <View style={styles.activeDot} /> : null}
        <Text style={styles.buttonTitle}>{title}</Text>
      </View>
      {subtitle ? <Text style={styles.buttonSubtitle}>{subtitle}</Text> : null}
    </Pressable>
  );
}

export function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={12} style={styles.back}>
      <Text style={styles.backText}>‹ Back to main menu</Text>
    </Pressable>
  );
}

export function Section({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export const textStyles = StyleSheet.create({
  body: {
    fontSize: 15,
    lineHeight: 21,
    color: colors.text,
  },
  hint: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textMuted,
  },
});

const styles = StyleSheet.create({
  button: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  buttonPressed: {
    backgroundColor: colors.primaryPressed,
  },
  buttonActive: {
    backgroundColor: colors.primaryActive,
    borderWidth: 2,
    borderColor: colors.primaryActiveBorder,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  buttonDisabled: {
    backgroundColor: colors.disabled,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  activeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.activeIndicator,
  },
  buttonTitle: {
    color: 'white',
    fontSize: 15,
    fontWeight: '600',
  },
  buttonSubtitle: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 12,
    marginTop: 2,
  },
  back: {
    alignSelf: 'flex-start',
  },
  backText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '500',
  },
  section: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 14,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
});
