import { Ionicons } from '@expo/vector-icons';
import type { ColorValue } from 'react-native';
import { Tabs } from 'expo-router/js-tabs';

import { useUnreadCount } from '../../src/api/hooks';
import { useT } from '../../src/i18n';
import { useColors } from '../../src/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const icon =
  (name: IconName) =>
  ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} color={color as string} size={size} />;

export default function TabsLayout() {
  const t = useT();
  const c = useColors();
  const unread = useUnreadCount().data?.unread ?? 0;
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.textMuted,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border },
        headerStyle: { backgroundColor: c.background },
        headerTitleStyle: { color: c.text },
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen name="index" options={{ title: t.tabs.today, tabBarIcon: icon('sunny-outline') }} />
      <Tabs.Screen name="plans" options={{ title: t.tabs.plans, tabBarIcon: icon('git-network-outline') }} />
      <Tabs.Screen name="tasks" options={{ title: t.tabs.tasks, tabBarIcon: icon('checkbox-outline') }} />
      <Tabs.Screen name="assistant" options={{ title: t.tabs.assistant, tabBarIcon: icon('chatbubbles-outline') }} />
      <Tabs.Screen
        name="more"
        options={{ title: t.tabs.more, tabBarIcon: icon('grid-outline'), tabBarBadge: unread > 0 ? unread : undefined }}
      />
    </Tabs>
  );
}
