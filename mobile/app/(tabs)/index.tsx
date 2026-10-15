import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { Pressable, View } from 'react-native';

import { api } from '../../src/api/client';
import { useApiMutation, useEvents, useTasks, useUnreadCount } from '../../src/api/hooks';
import type { Task } from '../../src/api/types';
import { useAuth } from '../../src/auth/AuthContext';
import { EventCard, TaskRow } from '../../src/components/domain';
import { Badge, Button, Card, EmptyState, Muted, QueryView, Row, Screen, Section, Title } from '../../src/components/ui';
import { useT } from '../../src/i18n';
import { showError } from '../../src/lib/alerts';
import { addDays, todayISO } from '../../src/lib/format';
import { spacing, useColors } from '../../src/theme';

export default function Today() {
  const t = useT();
  const c = useColors();
  const { user } = useAuth();
  const events = useEvents('active');
  const week = useTasks({ status: 'open', due_to: addDays(todayISO(), 7) });
  const review = useTasks({ status: 'needs_review' });
  const unread = useUnreadCount().data?.unread ?? 0;
  const toggle = useApiMutation((task: Task) =>
    api(`/tasks/${task.id}`, { method: 'PATCH', body: { status: task.status === 'done' ? 'todo' : 'done' } }),
  );
  const onToggle = (task: Task) => toggle.mutate(task, { onError: (e) => showError(e) });

  const refresh = () => Promise.all([events.refetch(), week.refetch(), review.refetch()]);
  const firstName = user?.full_name.split(' ')[0];

  return (
    <Screen onRefresh={refresh} refreshing={events.isRefetching}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={() => router.push('/notifications')} accessibilityLabel={`Notifications, ${unread} unread`} style={{ marginRight: spacing.lg }}>
              <Ionicons name={unread ? 'notifications' : 'notifications-outline'} size={24} color={c.primary} />
              {unread > 0 && (
                <View style={{ position: 'absolute', top: -4, right: -6, backgroundColor: c.danger, borderRadius: 8, minWidth: 16, paddingHorizontal: 3 }}>
                  <Muted style={{ color: '#fff', fontSize: 11, textAlign: 'center' }}>{unread}</Muted>
                </View>
              )}
            </Pressable>
          ),
        }}
      />
      <Title>
        {t.today.greeting}
        {firstName ? `, ${firstName}` : ''}
      </Title>

      <QueryView query={review}>
        {(tasks) =>
          tasks.length > 0 && (
            <Card style={{ borderColor: c.warning }}>
              <Row>
                <Ionicons name="alert-circle-outline" size={20} color={c.warning} />
                <Muted style={{ color: c.text, fontWeight: '600' }}>
                  {t.today.review}: {tasks.length}
                </Muted>
              </Row>
              {tasks.slice(0, 3).map((task) => (
                <TaskRow key={task.id} task={task} onToggle={onToggle} />
              ))}
            </Card>
          )
        }
      </QueryView>

      <Section title={t.today.next} action={<Button small variant="ghost" title={t.common.seeAll} onPress={() => router.push('/tasks')} />}>
        <QueryView query={week}>
          {(tasks) =>
            tasks.length === 0 ? (
              <Card>
                <Muted>{t.today.allClear}</Muted>
              </Card>
            ) : (
              <Card style={{ paddingVertical: spacing.xs }}>
                {tasks.slice(0, 6).map((task) => (
                  <TaskRow key={task.id} task={task} onToggle={onToggle} />
                ))}
                {tasks.some((x) => x.overdue) && (
                  <Row style={{ paddingTop: spacing.sm }}>
                    <Badge label={`${tasks.filter((x) => x.overdue).length} ${t.today.overdue.toLowerCase()}`} tone="danger" />
                  </Row>
                )}
              </Card>
            )
          }
        </QueryView>
      </Section>

      <Section title={t.today.plans} action={<Button small variant="ghost" icon="add" title={t.plans.new} onPress={() => router.push('/event/new')} />}>
        <QueryView query={events}>
          {(list) =>
            list.length === 0 ? (
              <EmptyState icon="git-network-outline" title={t.today.startPlan} body={t.tagline} action={{ label: t.plans.new, onPress: () => router.push('/event/new') }} />
            ) : (
              <View style={{ gap: spacing.md }}>
                {list.map((ev) => (
                  <EventCard key={ev.id} event={ev} />
                ))}
              </View>
            )
          }
        </QueryView>
      </Section>
    </Screen>
  );
}
