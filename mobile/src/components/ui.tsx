import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import type { UseQueryResult } from '@tanstack/react-query';
import { useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatDate, parseDate, toISODate } from '../lib/format';
import { radius, spacing, useColors, type Colors } from '../theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];
export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

function toneColors(c: Colors, tone: Tone) {
  switch (tone) {
    case 'primary':
      return { bg: c.primarySoft, fg: c.primary };
    case 'success':
      return { bg: c.successSoft, fg: c.success };
    case 'warning':
      return { bg: c.warningSoft, fg: c.warning };
    case 'danger':
      return { bg: c.dangerSoft, fg: c.danger };
    case 'info':
      return { bg: c.infoSoft, fg: c.info };
    default:
      return { bg: c.surfaceAlt, fg: c.textMuted };
  }
}

// --- Layout -------------------------------------------------------------------------

export function Screen({
  children,
  scroll = true,
  refreshing = false,
  onRefresh,
  edges = [],
  style,
}: {
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  edges?: ('top' | 'bottom')[];
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const content = scroll ? (
    <ScrollView
      contentContainerStyle={[styles.screenContent, style]}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} /> : undefined}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.screenContent, { flex: 1 }, style]}>{children}</View>
  );
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: c.background }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {content}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Card({
  children,
  onPress,
  style,
  accessibilityLabel,
}: {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const c = useColors();
  const base = [styles.card, { backgroundColor: c.surface, borderColor: c.border }, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [...base, pressed && { opacity: 0.85 }]}
    >
      {children}
    </Pressable>
  );
}

export function Row({ children, style, gap = spacing.sm }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Heading>{title}</Heading>
        {action}
      </Row>
      {children}
    </View>
  );
}

// --- Text -----------------------------------------------------------------------------

export function Title({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const c = useColors();
  return <Text accessibilityRole="header" style={[{ color: c.text, fontSize: 26, fontWeight: '700' }, style]}>{children}</Text>;
}

export function Heading({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const c = useColors();
  return <Text accessibilityRole="header" style={[{ color: c.text, fontSize: 18, fontWeight: '700' }, style]}>{children}</Text>;
}

export function Body({
  children,
  style,
  numberOfLines,
  selectable,
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  selectable?: boolean;
}) {
  const c = useColors();
  return <Text selectable={selectable} numberOfLines={numberOfLines} style={[{ color: c.text, fontSize: 16, lineHeight: 22 }, style]}>{children}</Text>;
}

export function Muted({ children, style, numberOfLines }: { children: ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number }) {
  const c = useColors();
  return <Text numberOfLines={numberOfLines} style={[{ color: c.textMuted, fontSize: 14, lineHeight: 20 }, style]}>{children}</Text>;
}

// --- Controls ---------------------------------------------------------------------------

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  icon,
  small = false,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const colors = {
    primary: { bg: c.primary, fg: c.primaryText, border: c.primary },
    secondary: { bg: c.surface, fg: c.primary, border: c.border },
    danger: { bg: c.dangerSoft, fg: c.danger, border: c.dangerSoft },
    ghost: { bg: 'transparent', fg: c.primary, border: 'transparent' },
  }[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: colors.bg, borderColor: colors.border, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.fg} />
      ) : (
        <Row gap={6}>
          {icon && <Ionicons name={icon} size={small ? 16 : 18} color={colors.fg} />}
          <Text style={{ color: colors.fg, fontWeight: '600', fontSize: small ? 14 : 16 }}>{title}</Text>
        </Row>
      )}
    </Pressable>
  );
}

export function TextField({
  label,
  hint,
  error,
  style,
  ...props
}: TextInputProps & { label: string; hint?: string; error?: string }) {
  const c = useColors();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.text, fontWeight: '600', fontSize: 14 }}>{label}</Text>
      <TextInput
        placeholderTextColor={c.textMuted}
        accessibilityLabel={label}
        {...props}
        style={[
          styles.input,
          { color: c.text, backgroundColor: c.surface, borderColor: error ? c.danger : c.border },
          props.multiline && { minHeight: 90, textAlignVertical: 'top' },
          style,
        ]}
      />
      {error ? <Text style={{ color: c.danger, fontSize: 13 }}>{error}</Text> : hint ? <Muted>{hint}</Muted> : null}
    </View>
  );
}

export function DateField({
  label,
  value,
  onChange,
  minimumDate,
  optional = false,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  minimumDate?: Date;
  optional?: boolean;
}) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const date = value ? parseDate(value) : new Date();
  if (Platform.OS === 'web') return <WebDateField label={label} value={value} onChange={onChange} />;
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.text, fontWeight: '600', fontSize: 14 }}>{label}</Text>
      <Row>
        <Pressable
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${value ? formatDate(value) : 'not set'}`}
          style={[styles.input, { flex: 1, justifyContent: 'center', backgroundColor: c.surface, borderColor: c.border }]}
        >
          <Text style={{ color: value ? c.text : c.textMuted, fontSize: 16 }}>{value ? formatDate(value) : 'Choose a date'}</Text>
        </Pressable>
        {optional && value && <Button small variant="ghost" title="Clear" onPress={() => onChange(null)} />}
      </Row>
      {open && (
        <DateTimePicker
          value={date}
          mode="date"
          minimumDate={minimumDate}
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={(event, selected) => {
            if (Platform.OS !== 'ios') setOpen(false);
            if (event.type === 'set' && selected) onChange(toISODate(selected));
            if (event.type === 'dismissed') setOpen(false);
          }}
        />
      )}
      {open && Platform.OS === 'ios' && <Button small variant="secondary" title="Done" onPress={() => setOpen(false)} />}
    </View>
  );
}

/** The native picker has no web build; a plain field keeps development previews usable. */
function WebDateField({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string | null) => void }) {
  const [text, setText] = useState(value ?? '');
  return (
    <TextField
      label={label}
      value={text}
      placeholder="YYYY-MM-DD"
      onChangeText={(next) => {
        setText(next);
        if (/^\d{4}-\d{2}-\d{2}$/.test(next)) onChange(next);
        else if (next === '') onChange(null);
      }}
    />
  );
}

export function Chip({ label, selected = false, onPress, icon }: { label: string; selected?: boolean; onPress?: () => void; icon?: IconName }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, { backgroundColor: selected ? c.primary : c.surface, borderColor: selected ? c.primary : c.border }]}
    >
      <Row gap={4}>
        {icon && <Ionicons name={icon} size={14} color={selected ? c.primaryText : c.textMuted} />}
        <Text style={{ color: selected ? c.primaryText : c.text, fontSize: 14, fontWeight: '500' }}>{label}</Text>
      </Row>
    </Pressable>
  );
}

export function ChipGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
      {options.map((o) => (
        <Chip key={o.value} label={o.label} selected={o.value === value} onPress={() => onChange(o.value)} />
      ))}
    </View>
  );
}

export function Badge({ label, tone = 'neutral', icon }: { label: string; tone?: Tone; icon?: IconName }) {
  const c = useColors();
  const { bg, fg } = toneColors(c, tone);
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      {icon && <Ionicons name={icon} size={12} color={fg} />}
      <Text style={{ color: fg, fontSize: 12, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

export function ProgressBar({ value, tone = 'primary' }: { value: number; tone?: Tone }) {
  const c = useColors();
  const { fg } = toneColors(c, tone);
  const pct = Math.max(0, Math.min(100, value));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      style={{ height: 8, borderRadius: 4, backgroundColor: c.surfaceAlt, overflow: 'hidden' }}
    >
      <View style={{ width: `${pct}%`, height: '100%', backgroundColor: fg, borderRadius: 4 }} />
    </View>
  );
}

export function SwitchRow({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const c = useColors();
  return (
    <Row style={{ justifyContent: 'space-between', paddingVertical: spacing.xs }}>
      <View style={{ flex: 1 }}>
        <Body>{label}</Body>
        {hint && <Muted>{hint}</Muted>}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: c.primary }} accessibilityLabel={label} />
    </Row>
  );
}

export function ListRow({
  title,
  subtitle,
  icon,
  right,
  onPress,
  tone = 'neutral',
}: {
  title: string;
  subtitle?: string;
  icon?: IconName;
  right?: ReactNode;
  onPress?: () => void;
  tone?: Tone;
}) {
  const c = useColors();
  const { bg, fg } = toneColors(c, tone);
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [styles.listRow, { borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}
    >
      {icon && (
        <View style={[styles.listIcon, { backgroundColor: bg }]}>
          <Ionicons name={icon} size={18} color={fg} />
        </View>
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Body numberOfLines={2} style={{ fontWeight: '500' }}>{title}</Body>
        {subtitle ? <Muted numberOfLines={2}>{subtitle}</Muted> : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={c.textMuted} /> : null)}
    </Pressable>
  );
}

// --- States -----------------------------------------------------------------------------

export function Loading() {
  const c = useColors();
  return (
    <View style={{ padding: spacing.xxl, alignItems: 'center' }}>
      <ActivityIndicator color={c.primary} />
    </View>
  );
}

export function ErrorView({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong';
  return (
    <EmptyState icon="cloud-offline-outline" title="Could not load" body={message} action={onRetry ? { label: 'Try again', onPress: onRetry } : undefined} />
  );
}

export function EmptyState({
  icon = 'leaf-outline',
  title,
  body,
  action,
}: {
  icon?: IconName;
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void };
}) {
  const c = useColors();
  return (
    <View style={{ alignItems: 'center', padding: spacing.xl, gap: spacing.sm }}>
      <Ionicons name={icon} size={36} color={c.textMuted} />
      <Heading style={{ textAlign: 'center' }}>{title}</Heading>
      {body && <Muted style={{ textAlign: 'center' }}>{body}</Muted>}
      {action && <Button title={action.label} onPress={action.onPress} style={{ marginTop: spacing.sm }} />}
    </View>
  );
}

/** Renders loading / error states for a query and hands the data to children. */
export function QueryView<T>({ query, children }: { query: UseQueryResult<T>; children: (data: T) => ReactNode }) {
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorView error={query.error} onRetry={() => query.refetch()} />;
  return <>{children(query.data as T)}</>;
}

export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const c = useColors();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Row style={{ justifyContent: 'space-between', padding: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border }}>
          <Heading>{title}</Heading>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={12}>
            <Ionicons name="close" size={24} color={c.text} />
          </Pressable>
        </Row>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screenContent: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl * 2 },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, gap: spacing.sm },
  button: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSmall: { minHeight: 36, paddingHorizontal: spacing.md },
  input: { minHeight: 48, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, fontSize: 16 },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 8 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  listIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
