import { router } from 'expo-router';
import { useState } from 'react';

import { useReferrals } from '../../src/api/hooks';
import { Badge, Button, Card, ChipGroup, EmptyState, ListRow, QueryView, Screen } from '../../src/components/ui';
import { humanize, relativeDay } from '../../src/lib/format';
import { spacing } from '../../src/theme';

/** 6.6 View Referral History. */
export default function Referrals() {
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const referrals = useReferrals(filter === 'open' ? { open_only: true } : undefined);
  return (
    <Screen onRefresh={() => referrals.refetch()} refreshing={referrals.isRefetching}>
      <Button title="New referral" icon="add" onPress={() => router.push('/referrals/new')} />
      <ChipGroup value={filter} onChange={setFilter} options={[{ value: 'open', label: 'Open' }, { value: 'all', label: 'All' }]} />
      <QueryView query={referrals}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState icon="swap-horizontal-outline" title="No referrals" body="Find a provider in the directory and track who acts next." />
          ) : (
            <Card style={{ paddingVertical: spacing.xs }}>
              {list.map((r) => (
                <ListRow
                  key={r.id}
                  icon="swap-horizontal-outline"
                  tone={r.next_owner === 'me' ? 'warning' : 'primary'}
                  title={r.recipient_name}
                  subtitle={`${humanize(r.status)} · ${r.next_owner === 'me' ? 'Your turn' : r.next_owner === 'provider' ? 'Waiting on provider' : 'No action'}${r.follow_up_date ? ` · follow up ${relativeDay(r.follow_up_date).toLowerCase()}` : ''}`}
                  right={r.follow_up_overdue ? <Badge label="Follow up" tone="danger" /> : undefined}
                  onPress={() => router.push(`/referral/${r.id}`)}
                />
              ))}
            </Card>
          )
        }
      </QueryView>
    </Screen>
  );
}
