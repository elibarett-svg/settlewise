import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { useEvents } from '../../src/api/hooks';
import { EventCard } from '../../src/components/domain';
import { Button, ChipGroup, EmptyState, QueryView, Screen } from '../../src/components/ui';
import { useT } from '../../src/i18n';
import { spacing } from '../../src/theme';

export default function Plans() {
  const t = useT();
  const [status, setStatus] = useState<'active' | 'closed'>('active');
  const events = useEvents(status);
  return (
    <Screen onRefresh={() => events.refetch()} refreshing={events.isRefetching}>
      <Button title={t.plans.new} icon="add" onPress={() => router.push('/event/new')} />
      <ChipGroup
        value={status}
        onChange={setStatus}
        options={[
          { value: 'active', label: 'Active' },
          { value: 'closed', label: 'Completed' },
        ]}
      />
      <QueryView query={events}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState icon="git-network-outline" title={status === 'active' ? t.today.startPlan : t.common.none} />
          ) : (
            <View style={{ gap: spacing.md }}>
              {list.map((ev) => (
                <EventCard key={ev.id} event={ev} />
              ))}
            </View>
          )
        }
      </QueryView>
    </Screen>
  );
}
