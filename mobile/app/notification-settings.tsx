import { useEffect, useState } from 'react';

import { api } from '../src/api/client';
import { useApiMutation, usePrefs } from '../src/api/hooks';
import type { NotificationPrefs } from '../src/api/types';
import { Button, Card, Heading, Muted, QueryView, Screen, SwitchRow, TextField } from '../src/components/ui';
import { showError } from '../src/lib/alerts';
import { registerForPush } from '../src/lib/notifications';

/** 9.2 Set Notification Preferences. */
export default function NotificationSettings() {
  const prefs = usePrefs();
  const [draft, setDraft] = useState<NotificationPrefs | null>(null);
  useEffect(() => {
    if (prefs.data) setDraft(prefs.data);
  }, [prefs.data]);
  const save = useApiMutation((body: NotificationPrefs) => api('/notifications/preferences', { method: 'PUT', body }), [['notifications']]);
  const set = <K extends keyof NotificationPrefs>(key: K, value: NotificationPrefs[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));
  const int = (v: string) => Math.max(0, parseInt(v, 10) || 0);

  return (
    <QueryView query={prefs}>
      {() =>
        draft && (
          <Screen>
            <Card>
              <Heading>Channels</Heading>
              <SwitchRow label="Push notifications" value={draft.push_enabled} onChange={(v) => { set('push_enabled', v); if (v) void registerForPush(); }} />
              <SwitchRow label="Email" hint="Coming soon" value={draft.email_enabled} onChange={(v) => set('email_enabled', v)} />
            </Card>
            <Card>
              <Heading>Quiet hours</Heading>
              <TextField label="Start (HH:MM)" value={draft.quiet_start} onChangeText={(v) => set('quiet_start', v)} />
              <TextField label="End (HH:MM)" value={draft.quiet_end} onChangeText={(v) => set('quiet_end', v)} />
              <TextField label="Time zone" value={draft.timezone} onChangeText={(v) => set('timezone', v)} autoCapitalize="none" />
              <TextField label="Send reminders at (hour, 0-23)" value={String(draft.reminder_hour)} onChangeText={(v) => set('reminder_hour', Math.min(23, int(v)))} keyboardType="number-pad" />
            </Card>
            <Card>
              <Heading>Timing</Heading>
              <TextField label="Tasks: days before due" value={String(draft.task_lead_days)} onChangeText={(v) => set('task_lead_days', int(v))} keyboardType="number-pad" />
              <TextField label="Bills: days before due" value={String(draft.bill_lead_days)} onChangeText={(v) => set('bill_lead_days', int(v))} keyboardType="number-pad" />
              <TextField label="Follow-ups: days before" value={String(draft.follow_up_lead_days)} onChangeText={(v) => set('follow_up_lead_days', int(v))} keyboardType="number-pad" />
              <TextField
                label="Documents: days before expiry"
                value={draft.document_lead_days.join(', ')}
                onChangeText={(v) => set('document_lead_days', v.split(',').map((x) => int(x)).filter((x) => x > 0))}
                hint="Comma separated, e.g. 90, 30, 7"
              />
              <Muted>New timing applies to reminders created or updated from now on.</Muted>
            </Card>
            <Button title="Save" loading={save.isPending} onPress={() => save.mutate(draft, { onError: (e) => showError(e) })} />
          </Screen>
        )
      }
    </QueryView>
  );
}
