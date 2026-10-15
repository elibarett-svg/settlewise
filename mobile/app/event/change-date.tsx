import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { api } from '../../src/api/client';
import { useApiMutation, useEvent } from '../../src/api/hooks';
import type { ImpactReview } from '../../src/api/types';
import { Body, Button, DateField, Muted, QueryView, Screen } from '../../src/components/ui';
import { useT } from '../../src/i18n';
import { showError } from '../../src/lib/alerts';
import { formatDate } from '../../src/lib/format';

/** First half of 4.4 Review Change Impact: pick the new date and preview what it affects. */
export default function ChangeDate() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const event = useEvent(id);
  const [date, setDate] = useState<string | null>(null);
  const preview = useApiMutation(
    (newDate: string) => api<ImpactReview>('/impact/preview', { method: 'POST', body: { life_event_id: id, new_key_date: newDate } }),
    [],
  );
  return (
    <QueryView query={event}>
      {(ev) => (
        <Screen>
          <Body>
            Current {ev.key_date_label.toLowerCase()}: {formatDate(ev.key_date)}
          </Body>
          <DateField label={`New ${ev.key_date_label.toLowerCase()}`} value={date ?? ev.key_date} onChange={setDate} />
          <Muted>Nothing changes yet. You will see every linked task, cost and referral first and choose what to update.</Muted>
          <Button
            title="See what this affects"
            disabled={!date || date === ev.key_date}
            loading={preview.isPending}
            onPress={() =>
              date &&
              preview.mutate(date, {
                onSuccess: (review) => router.replace(`/impact/${review.id}`),
                onError: (e) => showError(e),
              })
            }
          />
          <Button title={t.common.cancel} variant="ghost" onPress={() => router.back()} />
        </Screen>
      )}
    </QueryView>
  );
}
