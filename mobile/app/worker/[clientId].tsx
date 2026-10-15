import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { api } from '../../src/api/client';
import { keys, useApiMutation, useClient, useClientNotes } from '../../src/api/hooks';
import { Badge, Body, Button, Card, DateField, ListRow, Muted, ProgressBar, QueryView, Screen, Section, TextField, Title } from '../../src/components/ui';
import { showError } from '../../src/lib/alerts';
import { formatDate, formatDateTime, humanize } from '../../src/lib/format';
import { spacing } from '../../src/theme';

/** 8.3 Monitor Client Progress + 8.5 Record Follow-up Notes. */
export default function ClientDetail() {
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const client = useClient(clientId);
  const notes = useClientNotes(clientId);
  const [note, setNote] = useState('');
  const [nextStep, setNextStep] = useState('');
  const [nextDate, setNextDate] = useState<string | null>(null);
  const addNote = useApiMutation((body: object) => api(`/worker/clients/${clientId}/notes`, { method: 'POST', body }), [keys.notes(clientId)]);

  return (
    <QueryView query={client}>
      {(view) => (
        <Screen onRefresh={() => client.refetch()} refreshing={client.isRefetching}>
          <Title>{view.contact?.full_name ?? 'Client'}</Title>
          {view.contact && <Muted>{[view.contact.phone, view.contact.email].filter(Boolean).join(' · ')}</Muted>}
          {view.plans && (
            <Section title="Plans">
              {view.plans.map((p) => (
                <Card key={p.id}>
                  <Body style={{ fontWeight: '600' }}>{p.title}</Body>
                  <Muted>{formatDate(p.key_date)} · {humanize(p.status)}</Muted>
                  <ProgressBar value={p.progress.completion_percent} />
                  <Muted>{p.progress.completed}/{p.progress.total} done · {p.progress.overdue} overdue</Muted>
                </Card>
              ))}
            </Section>
          )}
          {view.tasks && (
            <Section title="Open tasks">
              <Card style={{ paddingVertical: spacing.xs }}>
                {view.tasks.map((t) => (
                  <ListRow key={t.id} title={t.title} subtitle={`${humanize(t.category)} · ${formatDate(t.due_date)}`} right={t.overdue ? <Badge label="Overdue" tone="danger" /> : undefined} />
                ))}
              </Card>
            </Section>
          )}
          {view.referrals && (
            <Section title="Referrals">
              <Card style={{ paddingVertical: spacing.xs }}>
                {view.referrals.map((r) => (
                  <ListRow key={r.id} title={r.recipient_name} subtitle={`${humanize(r.status)} · next: ${r.next_owner}`} />
                ))}
              </Card>
            </Section>
          )}
          <Section title="Follow-up notes">
            <Card>
              <TextField label="Note" value={note} onChangeText={setNote} multiline />
              <TextField label="Next step" value={nextStep} onChangeText={setNextStep} />
              <DateField label="Next contact" value={nextDate} optional onChange={setNextDate} />
              <Button
                title="Save note"
                disabled={!note.trim()}
                onPress={() =>
                  addNote.mutate(
                    { note, next_step: nextStep, next_contact_date: nextDate },
                    { onSuccess: () => { setNote(''); setNextStep(''); setNextDate(null); }, onError: (e) => showError(e) },
                  )
                }
              />
            </Card>
            <QueryView query={notes}>
              {(list) => (
                <Card style={{ paddingVertical: spacing.xs }}>
                  {list.length === 0 && <Muted>No notes yet.</Muted>}
                  {list.map((n) => (
                    <ListRow key={n.id} icon="chatbox-ellipses-outline" title={n.note} subtitle={`${formatDateTime(n.created_at)}${n.next_step ? ` · Next: ${n.next_step}` : ''}`} />
                  ))}
                </Card>
              )}
            </QueryView>
          </Section>
        </Screen>
      )}
    </QueryView>
  );
}
