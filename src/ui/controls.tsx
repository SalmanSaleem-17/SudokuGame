import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { ReactNode } from 'react';
import { Pressable, StyleProp, StyleSheet, Switch, Text, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TOUCH, colors, radius, spacing, type } from './theme';

export type IconName = keyof typeof Ionicons.glyphMap;

interface ScreenProps {
  title?: string;
  /** Show a back button. Defaults to true. */
  back?: boolean;
  onBack?: () => void;
  right?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Page frame that keeps content inside the system safe areas. */
export function Screen({ title, back = true, onBack, right, children, style }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const goBack = onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')));
  return (
    <View
      style={[
        styles.screen,
        {
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}>
      {(title !== undefined || back) && (
        <View style={styles.header}>
          {back ? <IconButton icon="chevron-back" label="Back" onPress={goBack} /> : <View style={styles.headerSide} />}
          <Text style={styles.headerTitle} numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
          <View style={styles.headerSide}>{right}</View>
        </View>
      )}
      <View style={[styles.body, style]}>{children}</View>
    </View>
  );
}

interface IconButtonProps {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  color?: string;
}

export function IconButton({ icon, label, onPress, disabled, color = colors.text }: IconButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed, disabled && styles.disabled]}>
      <Ionicons name={icon} size={24} color={color} />
    </Pressable>
  );
}

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  icon?: IconName;
  disabled?: boolean;
  detail?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

export function Button({ label, onPress, variant = 'secondary', icon, disabled, detail, style, accessibilityHint }: ButtonProps) {
  const primary = variant === 'primary';
  const textColor = primary ? colors.onAccent : variant === 'ghost' ? colors.textDim : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.button,
        primary && styles.buttonPrimary,
        variant === 'secondary' && styles.buttonSecondary,
        pressed && (primary ? styles.buttonPrimaryPressed : styles.pressed),
        disabled && styles.disabled,
        style,
      ]}>
      {icon && <Ionicons name={icon} size={20} color={textColor} style={styles.buttonIcon} />}
      <View style={styles.buttonText}>
        <Text style={[styles.buttonLabel, { color: textColor }]} numberOfLines={1}>
          {label}
        </Text>
        {detail ? (
          <Text style={[styles.buttonDetail, primary && { color: colors.onAccent }]} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

interface ToggleRowProps {
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}

export function ToggleRow({ label, description, value, onChange }: ToggleRowProps) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked: value }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.rowText}>
        <Text style={type.body}>{label}</Text>
        {description ? <Text style={type.dim}>{description}</Text> : null}
      </View>
      <View pointerEvents="none" importantForAccessibility="no-hide-descendants">
        <Switch
          value={value}
          trackColor={{ false: colors.line, true: colors.accent }}
          thumbColor={colors.text}
          ios_backgroundColor={colors.line}
        />
      </View>
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children.toUpperCase()}</Text>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xs },
  headerSide: { minWidth: TOUCH, height: TOUCH, alignItems: 'flex-end', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '600', color: colors.text },
  body: { flex: 1 },
  iconButton: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center', borderRadius: TOUCH / 2 },
  pressed: { backgroundColor: colors.surfaceHigh },
  disabled: { opacity: 0.4 },
  button: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  buttonPrimary: { backgroundColor: colors.accent },
  buttonPrimaryPressed: { backgroundColor: colors.accentPressed },
  buttonSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  buttonIcon: { marginRight: spacing.sm },
  buttonText: { alignItems: 'center', flexShrink: 1 },
  buttonLabel: { fontSize: 17, fontWeight: '600' },
  buttonDetail: { fontSize: 13, color: colors.textDim, marginTop: 1 },
  row: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  rowText: { flex: 1, gap: 2 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
  },
  sectionLabel: { ...type.label, marginTop: spacing.xl, marginBottom: spacing.sm, marginHorizontal: spacing.xs },
});
