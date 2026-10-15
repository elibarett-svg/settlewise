import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { api } from '../../src/api/client';
import { useAccessRequests, useApiMutation, useAudit, useConsentFields, useGrants } from '../../src/api/hooks';
import { Badge, Body, Button, Card, ChipGroup, EmptyState, ListRow, Muted, QueryView, Row, Screen } from '../../src/components/ui';
import { confirm, showError } from '../../src/lib/alerts';
import { formatDate, formatDateTime, humanize } from '../../src/lib/format';
import { spacing } from '../../src/theme';

const CONSENT_KEYS = [['consent']];

/** 7.0 Consent & Privacy Center. */
export default function Consent() {
  const [tab, setTab] = useState<'sharing' | 'requests' | 'audit'>('sharing');
  const grants = useGrants();
  const requests = useAccessRequests();
  const audit = useAudit();
  const fields = useConsentFields();
  const revoke = useApiMutation((grantId: string) => api(`/consent/grants/${grantId}/revoke`, { method: 'POST' }), CONSENT_KEYS);
  const decide = useApiMutation(({ reqId, action }: { reqId: string; action: 'approve' | 'decline' }) =>
    api(`/consent/requests/${reqId}/${action}`, { method: 'POST', body: action === 'approve' ? {} : undefined }), CONSENT_KEYS);
  const pending = requests.data?.filter((r) => r.status === 'pending').length ?? 0;
  const label = (f: string) => fields.data?.[f] ?? humanize(f);

  return (
    <Screen onRefresh={() => Promise.all([grants.refetch(), requests.refetch(), audit.refetch()])} refreshing={grants.isRefetching}>
      <ChipGroup
        value={tab}
        onChange={setTab}
        options={[
          { value: 'sharing', label: 'Shared' },
          { value: 'requests', label: pending ? `Requests (${pending})` : 'Requests' },
          { value: 'audit', label: 'Access history' },
        ]}
      />
      {tab === 'sharing' && (
        <>
          <Button title="Share information" icon="share-outline" onPress={() => router.push('/consent/new')} />
          <QueryView query={grants}>
            {(list) =>
              list.length === 0 ? (
                <EmptyState icon="lock-closed-outline" title="You are not sharing anything" body="Nothing leaves your workspace unless you choose a recipient, fields, purpose and end date." />
              ) : (
                <View style={{ gap: spacing.sm }}>
                  {list.map((g) => (
                    <Card key={g.id}>
                      <Row style={{ justifyContent: 'space-between' }}>
                        <Body style={{ fontWeight: '700', flex: 1 }}>{g.recipient_name}</Body>
                        <Badge label={humanize(g.status)} tone={g.status === 'active' ? 'success' : 'neutral'} />
                      </Row>
                      <Muted>Purpose: {g.purpose}</Muted>
                      <Muted>{g.status === 'active' ? `Until ${formatDate(g.expires_at.slice(0, 10))}` : g.revoked_at ? `Revoked ${formatDate(g.revoked_at.slice(0, 10))}` : 'Expired'}</Muted>
                      <View style={{ gap: 2 }}>
                        {g.fields.map((f) => (
                          <Muted key={f}>• {label(f)}</Muted>
                        ))}
                      </View>
                      {g.status === 'active' && (
                        <Button
                          small
                          variant="danger"
                          title="Revoke access"
                          onPress={async () => (await confirm('Revoke access?', `${g.recipient_name} will no longer see this information.`, 'Revoke', true)) && revoke.mutate(g.id, { onError: (e) => showError(e) })}
                        />
                      )}
                    </Card>
                  ))}
                </View>
              )
            }
          </QueryView>
        </>
      )}
      {tab === 'requests' && (
        <QueryView query={requests}>
          {(list) =>
            list.length === 0 ? (
              <EmptyState icon="mail-outline" title="No access requests" body="Advisors who want to see your case will ask here first." />
            ) : (
              <View style={{ gap: spacing.sm }}>
                {list.map((r) => (
                  <Card key={r.id}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <Body style={{ fontWeight: '700', flex: 1 }}>{r.requester_name}</Body>
                      <Badge label={humanize(r.status)} tone={r.status === 'pending' ? 'warning' : 'neutral'} />
                    </Row>
                    <Muted>
                      Purpose: {r.purpose} · {r.duration_days} days
                    </Muted>
                    {r.fields.map((f) => (
                      <Muted key={f}>• {label(f)}</Muted>
                    ))}
                    {r.status === 'pending' && (
                      <Row>
                        <Button small title="Approve" onPress={() => decide.mutate({ reqId: r.id, action: 'approve' }, { onError: (e) => showError(e) })} />
                        <Button small variant="secondary" title="Decline" onPress={() => decide.mutate({ reqId: r.id, action: 'decline' })} />
                      </Row>
                    )}
                  </Card>
                ))}
              </View>
            )
          }
        </QueryView>
      )}
      {tab === 'audit' && (
        <QueryView query={audit}>
          {(list) => (
            <Card style={{ paddingVertical: spacing.xs }}>
              {list.length === 0 && <Muted>No activity yet.</Muted>}
              {list.map((e) => (
                <ListRow
                  key={e.id}
                  icon={e.action === 'viewed' ? 'eye-outline' : e.action.includes('revoked') ? 'close-circle-outline' : 'shield-checkmark-outline'}
                  title={`${e.actor_label} · ${humanize(e.action)}`}
                  subtitle={`${formatDateTime(e.created_at)}${e.detail ? ` — ${e.detail}` : ''}${e.fields.length ? `\n${e.fields.map(label).join(', ')}` : ''}`}
                />
              ))}
            </Card>
          )}
        </QueryView>
      )}
    </Screen>
  );
}
