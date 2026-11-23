import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { ReactNode } from 'react';
import { Pressable, StyleProp, StyleSheet, Switch, Text, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TOUCH, colors, gradients, radius, spacing, type } from './theme';

export type IconName = keyof typeof Ionicons.glyphMap;

interface ScreenProps {
  title?: string;
  titleContent?: ReactNode;
  /** Show a back button. Defaults to true. */
  back?: boolean;
  onBack?: () => void;
  right?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Page frame that keeps content inside the system safe areas. */
export function Screen({ title, titleContent, back = true, onBack, right, children, style }: ScreenProps) {
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
      <View pointerEvents="none" importantForAccessibility="no-hide-descendants" style={styles.backdrop}>
        <View style={styles.topRibbon} />
        <View style={styles.bottomRibbon} />
      </View>
      {(title !== undefined || titleContent !== undefined || back || right !== undefined) && (
        <View style={styles.header}>
          {back ? <IconButton icon="chevron-back" label="Back" onPress={goBack} /> : <View style={styles.headerSide} />}
          <View style={styles.headerCenter}>
            {titleContent ?? (title ? <Text style={styles.headerTitle} accessibilityRole="header">{title}</Text> : null)}
          </View>
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
  trailingIcon?: IconName;
  large?: boolean;
  disabled?: boolean;
  detail?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

export function Button({ label, onPress, variant = 'secondary', icon, trailingIcon, large, disabled, detail, style, accessibilityHint }: ButtonProps) {
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
        large && styles.buttonLarge,
        variant === 'secondary' && styles.buttonSecondary,
        pressed && (primary ? styles.buttonPrimaryPressed : styles.pressed),
        disabled && styles.disabled,
        style,
      ]}>
      {icon && <Ionicons name={icon} size={large ? 24 : 20} color={textColor} style={styles.buttonIcon} />}
      <View style={styles.buttonText}>
        <Text style={[styles.buttonLabel, large && styles.buttonLabelLarge, { color: textColor }]}>
          {label}
        </Text>
        {detail ? (
          <Text style={[styles.buttonDetail, primary && { color: colors.onAccent }]}>
            {detail}
          </Text>
        ) : null}
      </View>
      {trailingIcon && <Ionicons name={trailingIcon} size={20} color={textColor} style={styles.trailingIcon} />}
    </Pressable>
  );
}

interface ToggleRowProps {
  label: string;
  icon: IconName;
  tint: string;
  description?: string;
  accessibilityHint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}

export function ToggleRow({ label, icon, tint, description, accessibilityHint, value, onChange }: ToggleRowProps) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint ?? description}
      accessibilityState={{ checked: value }}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={20} color={tint} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        {description ? <Text style={styles.rowDescription}>{description}</Text> : null}
      </View>
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Switch
          value={value}
          trackColor={{ false: colors.lineStrong, true: tint }}
          thumbColor={value ? colors.bg : colors.text}
          ios_backgroundColor={colors.lineStrong}
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
  backdrop: { ...StyleSheet.absoluteFill, backgroundImage: gradients.screen, overflow: 'hidden' },
  topRibbon: {
    position: 'absolute',
    top: -190,
    left: '-48%',
    width: '120%',
    height: 295,
    borderRadius: '50%',
    transform: [{ rotate: '-29deg' }],
    borderBottomWidth: 2,
    borderBottomColor: '#BC8A35',
    backgroundColor: '#212226',
    backgroundImage: 'linear-gradient(115deg, #414249 0%, #26272C 54%, #16171A 100%)',
    opacity: 0.82,
  },
  bottomRibbon: {
    position: 'absolute',
    bottom: -216,
    right: '-40%',
    width: '144%',
    height: 304,
    borderRadius: '50%',
    transform: [{ rotate: '-23deg' }],
    borderTopWidth: 2,
    borderTopColor: '#AD772D',
    backgroundColor: '#25262A',
    backgroundImage: 'linear-gradient(100deg, #17181B 0%, #2C2D32 52%, #424248 100%)',
    opacity: 0.76,
  },
  header: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    columnGap: spacing.xs,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  headerSide: { minWidth: TOUCH, flexShrink: 0, minHeight: TOUCH, alignItems: 'flex-end', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { textAlign: 'center', fontSize: 22, fontWeight: '800', color: colors.text },
  body: { flex: 1 },
  iconButton: {
    width: TOUCH,
    height: TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: TOUCH / 2,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    backgroundImage: gradients.panel,
  },
  pressed: { backgroundColor: colors.surfaceHigh, opacity: 0.85 },
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
  buttonPrimary: {
    backgroundColor: colors.accent,
    backgroundImage: gradients.gold,
    borderWidth: 1,
    borderTopColor: '#FFF4AC',
    borderLeftColor: colors.accent,
    borderRightColor: colors.accent,
    borderBottomColor: colors.accentEdge,
    borderBottomWidth: 3,
  },
  buttonPrimaryPressed: { backgroundColor: colors.accentPressed, opacity: 0.88 },
  buttonLarge: { minHeight: 62, borderRadius: 32, borderBottomWidth: 5 },
  buttonSecondary: {
    backgroundColor: colors.surface,
    backgroundImage: gradients.panel,
    borderWidth: 1,
    borderColor: colors.line,
  },
  buttonIcon: { marginRight: spacing.sm },
  trailingIcon: { marginLeft: spacing.md },
  buttonText: { alignItems: 'center', flexShrink: 1 },
  buttonLabel: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  buttonLabelLarge: { fontSize: 23, fontWeight: '900' },
  buttonDetail: { fontSize: 13, color: colors.textDim, marginTop: 1, textAlign: 'center' },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.24)',
  },
  rowText: { flex: 1, gap: 1 },
  rowPressed: { backgroundColor: 'rgba(226, 234, 255, 0.10)' },
  rowLabel: { ...type.body, fontWeight: '700' },
  rowDescription: { ...type.dim, fontSize: 12, lineHeight: 16 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
  },
  sectionLabel: { ...type.label, marginTop: spacing.xl, marginBottom: spacing.sm, marginHorizontal: spacing.xs },
});
