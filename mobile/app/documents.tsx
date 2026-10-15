import { useState } from 'react';

import { api } from '../src/api/client';
import { keys, useApiMutation, useDocuments, useProfileOptions } from '../src/api/hooks';
import { Badge, Button, Card, ChipGroup, DateField, EmptyState, ListRow, Muted, QueryView, Screen, Sheet, TextField } from '../src/components/ui';
import { confirm, showError } from '../src/lib/alerts';
import { formatDate, humanize } from '../src/lib/format';
import { spacing } from '../src/theme';

/** 1.4 Manage Documents - numbers withheld, expiry dates tracked. */
export default function Documents() {
  const docs = useDocuments();
  const [adding, setAdding] = useState(false);
  const remove = useApiMutation((id: string) => api(`/profile/documents/${id}`, { method: 'DELETE' }), [keys.documents, ['notifications']]);
  return (
    <Screen onRefresh={() => docs.refetch()} refreshing={docs.isRefetching}>
      <Button title="Add document" icon="add" onPress={() => setAdding(true)} />
      <Muted>SettleWise keeps only the last 4 characters of a document number. You get reminders 90, 30 and 7 days before expiry.</Muted>
      <QueryView query={docs}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState icon="document-text-outline" title="No documents yet" body="Add your passport, PR card, permits and insurance to track expiry dates." />
          ) : (
            <Card style={{ paddingVertical: spacing.xs }}>
              {list.map((d) => {
                const days = d.days_until_expiry;
                const tone = days === null ? 'neutral' : days < 0 ? 'danger' : days <= 90 ? 'warning' : 'success';
                return (
                  <ListRow
                    key={d.id}
                    icon="document-text-outline"
                    title={d.label}
                    subtitle={`${humanize(d.doc_type)}${d.number_masked ? ` · ${d.number_masked}` : ''}${d.expires_on ? ` · expires ${formatDate(d.expires_on)}` : ''}`}
                    right={days !== null ? <Badge label={days < 0 ? 'Expired' : `${days} d`} tone={tone} /> : undefined}
                    onPress={async () => (await confirm('Delete document record?', d.label, 'Delete', true)) && remove.mutate(d.id)}
                  />
                );
              })}
            </Card>
          )
        }
      </QueryView>
      <DocumentSheet visible={adding} onClose={() => setAdding(false)} />
    </Screen>
  );
}

function DocumentSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const options = useProfileOptions();
  const [type, setType] = useState('passport');
  const [label, setLabel] = useState('');
  const [number, setNumber] = useState('');
  const [expires, setExpires] = useState<string | null>(null);
  const add = useApiMutation((body: object) => api('/profile/documents', { method: 'POST', body }), [keys.documents, ['notifications']]);
  return (
    <Sheet visible={visible} onClose={onClose} title="Document">
      <ChipGroup value={type} onChange={setType} options={(options.data?.document_types ?? []).map((t) => ({ value: t, label: humanize(t) }))} />
      <TextField label="Label (optional)" value={label} onChangeText={setLabel} placeholder="e.g. My passport" />
      <TextField label="Document number (optional)" value={number} onChangeText={setNumber} autoCapitalize="characters" hint="Only the last 4 characters are saved." secureTextEntry />
      <DateField label="Expiry date" value={expires} optional onChange={setExpires} />
      <Button
        title="Save"
        onPress={() =>
          add.mutate(
            { doc_type: type, label, number: number || undefined, expires_on: expires },
            { onSuccess: () => { setLabel(''); setNumber(''); setExpires(null); onClose(); }, onError: (e) => showError(e) },
          )
        }
      />
    </Sheet>
  );
}
