import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { api } from '../../src/api/client';
import { useApiMutation, useClients, useConsentFields } from '../../src/api/hooks';
import { Badge, Body, Button, Card, EmptyState, Muted, QueryView, Row, Screen, Sheet, SwitchRow, TextField } from '../../src/components/ui';
import { showError } from '../../src/lib/alerts';
import { formatDate } from '../../src/lib/format';
import { spacing } from '../../src/theme';

/** 8.1 Request Client Access + 8.2 View Client Dashboard. */
export default function WorkerHome() {
  const clients = useClients();
  const [requesting, setRequesting] = useState(false);
  return (
    <Screen onRefresh={() => clients.refetch()} refreshing={clients.isRefetching}>
      <Button title="Request client access" icon="person-add-outline" onPress={() => setRequesting(true)} />
      <Muted>You only see what each client has chosen to share, until the date they set. Every view is recorded in their access history.</Muted>
      <QueryView query={clients}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState icon="briefcase-outline" title="No clients yet" body="When a client approves your request, they appear here." />
          ) : (
            <View style={{ gap: spacing.sm }}>
              {list.map((cl) => (
                <Card key={cl.client_id} onPress={() => router.push(`/worker/${cl.client_id}`)}>
                  <Body style={{ fontWeight: '700' }}>{cl.name}</Body>
                  <Muted>{cl.purpose}</Muted>
                  <Row style={{ flexWrap: 'wrap' }}>
                    {cl.open_tasks !== null && <Badge label={`${cl.open_tasks} open tasks`} tone="primary" />}
                    {!!cl.overdue_tasks && <Badge label={`${cl.overdue_tasks} overdue`} tone="danger" />}
                    {cl.open_referrals !== null && <Badge label={`${cl.open_referrals} open referrals`} tone="info" />}
                  </Row>
                  <Muted style={{ fontSize: 12 }}>Access until {formatDate(cl.expires_at.slice(0, 10))}</Muted>
                </Card>
              ))}
            </View>
          )
        }
      </QueryView>
      <RequestSheet visible={requesting} onClose={() => setRequesting(false)} />
    </Screen>
  );
}

function RequestSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const fields = useConsentFields();
  const [email, setEmail] = useState('');
  const [purpose, setPurpose] = useState('');
  const [chosen, setChosen] = useState<string[]>(['plans', 'tasks', 'referrals']);
  const send = useApiMutation((body: object) => api<{ status: string }>('/worker/access-requests', { method: 'POST', body }), []);
  return (
    <Sheet visible={visible} onClose={onClose} title="Request access">
      <TextField label="Client email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
      <TextField label="Purpose" value={purpose} onChangeText={setPurpose} placeholder="e.g. Settlement support for housing search" />
      {Object.entries(fields.data ?? {}).map(([key, text]) => (
        <SwitchRow key={key} label={text} value={chosen.includes(key)} onChange={(on) => setChosen((p) => (on ? [...p, key] : p.filter((x) => x !== key)))} />
      ))}
      <Button
        title="Send request"
        disabled={!email || purpose.length < 3 || !chosen.length}
        onPress={() =>
          send.mutate(
            { client_email: email.trim(), purpose, fields: chosen, duration_days: 90 },
            { onSuccess: (r) => { onClose(); Alert.alert('Request sent', r.status); }, onError: (e) => showError(e) },
          )
        }
      />
    </Sheet>
  );
}
