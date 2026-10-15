import { router, Stack } from 'expo-router';

import { EmptyState, Screen } from '../src/components/ui';

export default function NotFound() {
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Not found' }} />
      <EmptyState icon="compass-outline" title="This page does not exist" action={{ label: 'Go home', onPress: () => router.replace('/') }} />
    </Screen>
  );
}
