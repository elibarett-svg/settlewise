import { router, Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { api } from '../../src/api/client';
import { useApiMutation, useEvent, useEventCosts, useFeatures, useReferrals } from '../../src/api/hooks';
import type { Task } from '../../src/api/types';
import { TaskRow } from '../../src/components/domain';
import {
  Badge,
  Body,
  Button,
  Card,
  ListRow,
  Muted,
  ProgressBar,
  QueryView,
  Row,
  Screen,
  Section,
  Title,
} from '../../src/components/ui';
import { useT } from '../../src/i18n';
import { confirm, showError } from '../../src/lib/alerts';
import { formatDate, humanize, money, relativeDay } from '../../src/lib/format';
import { spacing } from '../../src/theme';

export default function EventDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const { has } = useFeatures();
  const event = useEvent(id);
  const costs = useEventCosts(has('finance') ? id : undefined);
  const referrals = useReferrals(has('referrals') ? { life_event_id: id } : undefined);
  const toggle = useApiMutation((task: Task) =>
    api(`/tasks/${task.id}`, { method: 'PATCH', body: { status: task.status === 'done' ? 'todo' : 'done' } }),
  );
  const close = useApiMutation((action: 'close' | 'reopen') => api(`/events/${id}/${action}`, { method: 'POST' }));
  const remove = useApiMutation(() => api(`/events/${id}`, { method: 'DELETE' }));
  const reorder = useApiMutation((taskIds: string[]) =>
    api('/tasks/reorder', { method: 'POST', body: { life_event_id: id, task_ids: taskIds } }),
  );

  const move = (tasks: Task[], index: number, delta: number) => {
    const ids = tasks.map((x) => x.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorder.mutate(ids, { onError: (e) => showError(e) });
  };

  return (
    <QueryView query={event}>
      {(ev) => {
        const p = ev.progress;
        return (
          <Screen onRefresh={() => event.refetch()} refreshing={event.isRefetching}>
            <Stack.Screen options={{ title: humanize(ev.event_type) }} />
            <Title>{ev.title}</Title>
            <Card>
              <View>
                <Muted>{ev.key_date_label}</Muted>
                <Body style={{ fontWeight: '700' }}>
                  {formatDate(ev.key_date)} · {relativeDay(ev.key_date)}
                </Body>
              </View>
              {ev.status === 'active' && (
                <Button
                  small
                  variant="secondary"
                  icon="calendar-outline"
                  title={t.plans.changeDate}
                  style={{ alignSelf: 'flex-start' }}
                  onPress={() => router.push({ pathname: '/event/change-date', params: { id: ev.id } })}
                />
              )}
              <ProgressBar value={p.completion_percent} />
              <Row style={{ flexWrap: 'wrap' }} gap={6}>
                <Badge label={`${p.completed}/${p.total} done`} tone="success" />
                <Badge label={`${p.upcoming} upcoming`} tone="primary" />
                {p.overdue > 0 && <Badge label={`${p.overdue} overdue`} tone="danger" />}
                {p.blocked > 0 && <Badge label={`${p.blocked} waiting`} />}
                {p.needs_review > 0 && <Badge label={`${p.needs_review} to review`} tone="warning" />}
              </Row>
              <Muted style={{ fontSize: 12 }}>{t.plans.scoreNote}</Muted>
            </Card>

            <Section
              title={t.plans.tasks}
              action={<Button small variant="ghost" icon="add" title={t.common.add} onPress={() => router.push({ pathname: '/task/new', params: { eventId: ev.id } })} />}
            >
              <Card style={{ paddingVertical: spacing.xs }}>
                {ev.tasks.map((task, i) => (
                  <View key={task.id}>
                    <TaskRow task={task} onToggle={(x) => toggle.mutate(x, { onError: (e) => showError(e) })} />
                    {ev.status === 'active' && task.status !== 'done' && (
                      <Row style={{ justifyContent: 'flex-end', marginTop: -spacing.sm }}>
                        <Button small variant="ghost" icon="arrow-up" title="" onPress={() => move(ev.tasks, i, -1)} />
                        <Button small variant="ghost" icon="arrow-down" title="" onPress={() => move(ev.tasks, i, 1)} />
                      </Row>
                    )}
                  </View>
                ))}
              </Card>
            </Section>

            {has('finance') && (
              <Section title={t.plans.costs}>
                <QueryView query={costs}>
                  {(list) => (
                    <Card style={{ paddingVertical: spacing.xs }}>
                      {list.length === 0 && <Muted>{t.common.none}</Muted>}
                      {list.map((cost) => (
                        <ListRow key={cost.id} icon="cash-outline" title={cost.label} subtitle={formatDate(cost.due_date)} right={<Body style={{ fontWeight: '600' }}>{money(cost.amount)}</Body>} />
                      ))}
                    </Card>
                  )}
                </QueryView>
              </Section>
            )}

            {has('referrals') && (
              <Section title={t.plans.referrals} action={<Button small variant="ghost" icon="add" title={t.common.add} onPress={() => router.push({ pathname: '/referrals/new', params: { eventId: ev.id } })} />}>
                <QueryView query={referrals}>
                  {(list) => (
                    <Card style={{ paddingVertical: spacing.xs }}>
                      {list.length === 0 && <Muted>{t.common.none}</Muted>}
                      {list.map((r) => (
                        <ListRow
                          key={r.id}
                          icon="swap-horizontal-outline"
                          title={r.recipient_name}
                          subtitle={`${humanize(r.status)} · next: ${r.next_owner === 'me' ? 'you' : r.next_owner}`}
                          onPress={() => router.push(`/referral/${r.id}`)}
                        />
                      ))}
                    </Card>
                  )}
                </QueryView>
              </Section>
            )}

            {ev.status === 'active' ? (
              <Button title={t.plans.close} icon="checkmark-done" variant="secondary" onPress={() => close.mutate('close', { onError: (e) => showError(e) })} />
            ) : (
              <Button title={t.plans.reopen} variant="secondary" onPress={() => close.mutate('reopen', { onError: (e) => showError(e) })} />
            )}
            <Button
              title="Delete plan"
              variant="danger"
              onPress={async () => {
                if (await confirm('Delete this plan?', 'Its tasks, costs and reminders are removed.', 'Delete', true)) {
                  remove.mutate(undefined, { onSuccess: () => router.back(), onError: (e) => showError(e) });
                }
              }}
            />
          </Screen>
        );
      }}
    </QueryView>
  );
}
