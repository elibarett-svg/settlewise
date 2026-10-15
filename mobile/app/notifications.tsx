import { router } from 'expo-router';

import { api } from '../src/api/client';
import { useApiMutation, useNotifications, useReminders } from '../src/api/hooks';
import type { AppNotification } from '../src/api/types';
import { categoryIcon } from '../src/components/domain';
import { Body, Button, Card, EmptyState, ListRow, Muted, QueryView, Row, Screen, Section } from '../src/components/ui';
import { formatDateTime } from '../src/lib/format';
import { spacing, useColors } from '../src/theme';

const KIND_ICON: Record<string, string> = { task: 'checkbox', bill: 'finance', follow_up: 'referral', document: 'documents', custom: 'general' };

/** 9.4 View Notifications + 9.5 Manage Notifications. */
export default function Notifications() {
  const c = useColors();
  const inbox = useNotifications();
  const reminders = useReminders();
  const act = useApiMutation(({ id, action }: { id: string; action: string }) =>
    api(`/notifications/${id}/action`, { method: 'POST', body: { action } }), [['notifications']]);
  const readAll = useApiMutation(() => api('/notifications/read-all', { method: 'POST' }), [['notifications']]);

  const open = (n: AppNotification) => {
    act.mutate({ id: n.id, action: 'read' });
    if (n.link.startsWith('/')) router.push(n.link as never);
  };

  return (
    <Screen onRefresh={() => Promise.all([inbox.refetch(), reminders.refetch()])} refreshing={inbox.isRefetching}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Button small variant="ghost" icon="checkmark-done" title="Mark all read" onPress={() => readAll.mutate(undefined)} />
        <Button small variant="ghost" icon="options-outline" title="Settings" onPress={() => router.push('/notification-settings')} />
      </Row>
      <QueryView query={inbox}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState icon="notifications-off-outline" title="No notifications" body="Reminders for due dates, bills, follow-ups and expiring documents appear here." />
          ) : (
            list.map((n) => (
              <Card key={n.id} onPress={() => open(n)} style={n.status === 'unread' ? { borderColor: c.primary } : undefined}>
                <Body style={{ fontWeight: n.status === 'unread' ? '700' : '400' }}>{n.title}</Body>
                {n.body ? <Muted>{n.body}</Muted> : null}
                <Muted style={{ fontSize: 12 }}>{formatDateTime(n.created_at)}</Muted>
                <Row>
                  <Button small variant="secondary" title="Done" onPress={() => act.mutate({ id: n.id, action: 'done' })} />
                  <Button small variant="secondary" title="Snooze 1 day" onPress={() => act.mutate({ id: n.id, action: 'snooze' })} />
                  <Button small variant="ghost" title="Dismiss" onPress={() => act.mutate({ id: n.id, action: 'dismiss' })} />
                </Row>
              </Card>
            ))
          )
        }
      </QueryView>
      <Section title="Upcoming reminders">
        <QueryView query={reminders}>
          {(list) => (
            <Card style={{ paddingVertical: spacing.xs }}>
              {list.length === 0 && <Muted>Nothing scheduled.</Muted>}
              {list.slice(0, 20).map((r) => (
                <ListRow
                  key={r.id}
                  icon={categoryIcon(KIND_ICON[r.kind] ?? 'general')}
                  title={r.title}
                  subtitle={formatDateTime(r.remind_at)}
                  onPress={r.link.startsWith('/') ? () => router.push(r.link as never) : undefined}
                />
              ))}
            </Card>
          )}
        </QueryView>
      </Section>
    </Screen>
  );
}
