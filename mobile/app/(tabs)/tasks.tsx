import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';

import { api } from '../../src/api/client';
import { useApiMutation, useEvents, useTasks } from '../../src/api/hooks';
import type { Task } from '../../src/api/types';
import { TaskRow } from '../../src/components/domain';
import { Button, Card, Chip, EmptyState, QueryView, Screen, TextField } from '../../src/components/ui';
import { useT } from '../../src/i18n';
import { showError } from '../../src/lib/alerts';
import { spacing } from '../../src/theme';

const FILTERS = [
  { value: 'open', label: 'Open' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'needs_review', label: 'Review' },
  { value: 'blocked', label: 'Waiting' },
  { value: 'done', label: 'Done' },
] as const;

/** 4.5 View Task List - filter by status, plan or keyword. */
export default function Tasks() {
  const t = useT();
  const [status, setStatus] = useState<string>('open');
  const [eventId, setEventId] = useState<string | undefined>();
  const [q, setQ] = useState('');
  const events = useEvents('active');
  const tasks = useTasks({ status, life_event_id: eventId, q: q.trim() || undefined });
  const toggle = useApiMutation((task: Task) =>
    api(`/tasks/${task.id}`, { method: 'PATCH', body: { status: task.status === 'done' ? 'todo' : 'done' } }),
  );

  return (
    <Screen onRefresh={() => tasks.refetch()} refreshing={tasks.isRefetching}>
      <Button title={t.tasks.new} icon="add" onPress={() => router.push({ pathname: '/task/new', params: eventId ? { eventId } : {} })} />
      <TextField label="Search" value={q} onChangeText={setQ} placeholder="Search tasks" returnKeyType="search" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
        {FILTERS.map((f) => (
          <Chip key={f.value} label={f.label} selected={status === f.value} onPress={() => setStatus(f.value)} />
        ))}
      </ScrollView>
      {!!events.data?.length && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
          <Chip label="All plans" selected={!eventId} onPress={() => setEventId(undefined)} />
          {events.data.map((ev) => (
            <Chip key={ev.id} label={ev.title} selected={eventId === ev.id} onPress={() => setEventId(ev.id)} />
          ))}
        </ScrollView>
      )}
      <QueryView query={tasks}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState icon="checkmark-done-outline" title={t.common.none} />
          ) : (
            <Card style={{ paddingVertical: spacing.xs }}>
              {list.map((task) => (
                <TaskRow key={task.id} task={task} onToggle={(x) => toggle.mutate(x, { onError: (e) => showError(e) })} />
              ))}
            </Card>
          )
        }
      </QueryView>
    </Screen>
  );
}
