import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { api } from '../../src/api/client';
import { useApiMutation, useReferral } from '../../src/api/hooks';
import type { Referral, ReferralStatus } from '../../src/api/types';
import { Badge, Body, Button, Card, ChipGroup, DateField, ListRow, Muted, QueryView, Row, Screen, Section, TextField, Title } from '../../src/components/ui';
import { showError } from '../../src/lib/alerts';
import { formatDate, formatDateTime, humanize } from '../../src/lib/format';
import { spacing } from '../../src/theme';

const STEPS: ReferralStatus[] = ['requested', 'accepted', 'scheduled', 'completed'];

/** 6.3 Assign Next Owner, 6.4 Update Referral Status, 6.5 Schedule Follow-ups. */
export default function ReferralDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const referral = useReferral(id);
  const [note, setNote] = useState('');
  const [scheduled, setScheduled] = useState<string | null>(null);
  const status = useApiMutation((body: object) => api<Referral>(`/referrals/${id}/status`, { method: 'POST', body }));
  const patch = useApiMutation((body: object) => api<Referral>(`/referrals/${id}`, { method: 'PATCH', body }));

  return (
    <QueryView query={referral}>
      {(r) => (
        <Screen>
          <Title>{r.recipient_name}</Title>
          <Body>{r.reason}</Body>
          <Card>
            <Row gap={4} style={{ flexWrap: 'wrap' }}>
              {STEPS.map((s, i) => {
                const reached = STEPS.indexOf(r.status) >= i;
                return <Badge key={s} label={`${i + 1}. ${humanize(s)}`} tone={reached ? 'success' : 'neutral'} />;
              })}
              {(r.status === 'declined' || r.status === 'cancelled') && <Badge label={humanize(r.status)} tone="danger" />}
            </Row>
            <Muted>Who acts next?</Muted>
            <ChipGroup
              value={r.next_owner}
              onChange={(next_owner) => patch.mutate({ next_owner }, { onError: (e) => showError(e) })}
              options={[
                { value: 'me', label: 'Me' },
                { value: 'provider', label: 'Provider' },
                { value: 'household', label: 'Household' },
                { value: 'none', label: 'No one' },
              ]}
            />
            <DateField label="Follow up on" value={r.follow_up_date} optional onChange={(follow_up_date) => patch.mutate({ follow_up_date })} />
            {r.info_needed.length > 0 && <Muted>They need: {r.info_needed.join(', ')}</Muted>}
          </Card>

          {r.allowed_transitions.length > 0 && (
            <Section title="Update status">
              <Card>
                {r.allowed_transitions.includes('scheduled') && <DateField label="Appointment date" value={scheduled} onChange={setScheduled} optional />}
                <TextField label="Note (optional)" value={note} onChangeText={setNote} />
                <Row style={{ flexWrap: 'wrap' }}>
                  {r.allowed_transitions.map((s) => (
                    <Button
                      key={s}
                      small
                      variant={s === 'cancelled' || s === 'declined' ? 'danger' : 'secondary'}
                      title={humanize(s)}
                      disabled={s === 'scheduled' && !scheduled}
                      onPress={() =>
                        status.mutate(
                          { status: s, note, scheduled_for: s === 'scheduled' ? scheduled : undefined },
                          { onSuccess: () => setNote(''), onError: (e) => showError(e) },
                        )
                      }
                    />
                  ))}
                </Row>
              </Card>
            </Section>
          )}

          <Section title="History">
            <Card style={{ paddingVertical: spacing.xs }}>
              {r.history.map((h, i) => (
                <ListRow key={i} icon="time-outline" title={`${humanize(h.status)}${h.note ? ` — ${h.note}` : ''}`} subtitle={`${formatDateTime(h.created_at)} · ${h.by}`} />
              ))}
            </Card>
          </Section>
          {r.scheduled_for && <Muted>Appointment: {formatDate(r.scheduled_for)}</Muted>}
        </Screen>
      )}
    </QueryView>
  );
}
