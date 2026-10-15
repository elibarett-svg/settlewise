import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Linking, Pressable, View } from 'react-native';

import type { LifeEvent, Source, Task } from '../api/types';
import { useT } from '../i18n';
import { formatDate, humanize, relativeDay } from '../lib/format';
import { spacing, useColors } from '../theme';
import { Badge, Body, Card, Muted, ProgressBar, Row, type IconName, type Tone } from './ui';

export const CATEGORY_ICONS: Record<string, IconName> = {
  housing: 'home-outline',
  utilities: 'flash-outline',
  insurance: 'shield-checkmark-outline',
  travel: 'airplane-outline',
  government: 'business-outline',
  finance: 'wallet-outline',
  budget: 'calculator-outline',
  documents: 'document-text-outline',
  family: 'people-outline',
  health: 'medkit-outline',
  employment: 'briefcase-outline',
  tax: 'receipt-outline',
  legal: 'scale-outline',
  referral: 'swap-horizontal-outline',
};

export const EVENT_ICONS: Record<string, IconName> = {
  moving: 'home-outline',
  travel: 'airplane-outline',
  new_job: 'briefcase-outline',
  family_change: 'people-outline',
  pr_preparation: 'document-text-outline',
};

export function categoryIcon(category: string): IconName {
  return CATEGORY_ICONS[category] ?? 'ellipse-outline';
}

export function taskTone(task: Task): { label: string; tone: Tone } {
  if (task.status === 'done') return { label: 'Done', tone: 'success' };
  if (task.status === 'skipped') return { label: 'Skipped', tone: 'neutral' };
  if (task.blocked_by.length) return { label: 'Waiting', tone: 'neutral' };
  if (task.status === 'needs_review') return { label: 'Review', tone: 'warning' };
  if (task.overdue) return { label: 'Overdue', tone: 'danger' };
  if (task.status === 'in_progress') return { label: 'In progress', tone: 'info' };
  return { label: relativeDay(task.due_date), tone: 'primary' };
}

export function TaskRow({ task, onToggle }: { task: Task; onToggle?: (task: Task) => void }) {
  const c = useColors();
  const done = task.status === 'done';
  const { label, tone } = taskTone(task);
  return (
    <Pressable
      onPress={() => router.push(`/task/${task.id}`)}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingVertical: spacing.md,
        borderBottomWidth: 0.5,
        borderColor: c.border,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Pressable
        onPress={() => onToggle?.(task)}
        disabled={!onToggle || task.blocked_by.length > 0}
        hitSlop={10}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done, disabled: task.blocked_by.length > 0 }}
        accessibilityLabel={`Mark ${task.title} ${done ? 'not done' : 'done'}`}
      >
        <Ionicons
          name={done ? 'checkmark-circle' : task.blocked_by.length ? 'lock-closed-outline' : 'ellipse-outline'}
          size={26}
          color={done ? c.success : c.textMuted}
        />
      </Pressable>
      <View style={{ flex: 1, gap: 4 }}>
        <Body style={done ? { textDecorationLine: 'line-through', color: c.textMuted } : undefined} numberOfLines={2}>
          {task.title}
        </Body>
        <Row gap={6} style={{ flexWrap: 'wrap' }}>
          <Badge label={label} tone={tone} />
          <Muted>{humanize(task.category)}</Muted>
          {task.date_sensitive && task.external_party ? <Muted>· {task.external_party}</Muted> : null}
        </Row>
      </View>
      <Ionicons name={categoryIcon(task.category)} size={18} color={c.textMuted} />
    </Pressable>
  );
}

export function EventCard({ event }: { event: LifeEvent }) {
  const c = useColors();
  const p = event.progress;
  return (
    <Card onPress={() => router.push(`/event/${event.id}`)} accessibilityLabel={event.title}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row style={{ flex: 1 }}>
          <Ionicons name={EVENT_ICONS[event.event_type] ?? 'flag-outline'} size={22} color={c.primary} />
          <Body style={{ fontWeight: '700', flex: 1 }} numberOfLines={1}>
            {event.title}
          </Body>
        </Row>
        {event.status === 'closed' ? <Badge label="Complete" tone="success" /> : null}
      </Row>
      <Muted>
        {event.key_date_label}: {formatDate(event.key_date)} · {relativeDay(event.key_date)}
      </Muted>
      <ProgressBar value={p.completion_percent} />
      <Row gap={6} style={{ flexWrap: 'wrap' }}>
        <Muted>
          {p.completed} of {p.total} steps done
        </Muted>
        {p.overdue > 0 && <Badge label={`${p.overdue} overdue`} tone="danger" />}
        {p.needs_review > 0 && <Badge label={`${p.needs_review} to review`} tone="warning" />}
        {p.blocked > 0 && <Badge label={`${p.blocked} waiting`} />}
      </Row>
      {p.next_task_title && event.status === 'active' ? <Muted numberOfLines={1}>Next: {p.next_task_title}</Muted> : null}
    </Card>
  );
}

export function SourceLinks({ sources }: { sources: Source[] }) {
  const c = useColors();
  const t = useT();
  if (!sources.length) return null;
  return (
    <View style={{ gap: spacing.sm }}>
      {sources.map((s) => (
        <Pressable
          key={s.id}
          onPress={() => Linking.openURL(s.url)}
          accessibilityRole="link"
          style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' }}
        >
          <Ionicons name="open-outline" size={16} color={c.primary} style={{ marginTop: 2 }} />
          <View style={{ flex: 1 }}>
            <Body style={{ color: c.primary, fontSize: 15 }}>{s.title}</Body>
            <Muted>
              {s.publisher} · {s.reviewed_on ? `Reviewed ${formatDate(s.reviewed_on)}` : t.assistant.pendingReview}
            </Muted>
          </View>
        </Pressable>
      ))}
    </View>
  );
}
