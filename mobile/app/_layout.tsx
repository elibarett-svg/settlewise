import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '../src/auth/AuthContext';
import { Loading } from '../src/components/ui';
import { registerForPush, useNotificationRouting } from '../src/lib/notifications';
import { useColors, useIsDark } from '../src/theme';

export default function RootLayout() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } }),
  );
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Navigation />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function Navigation() {
  const { ready, user } = useAuth();
  const c = useColors();
  const dark = useIsDark();
  useNotificationRouting(!!user);

  useEffect(() => {
    if (user) void registerForPush();
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: c.background }}>
        <Loading />
      </View>
    );
  }

  const base = dark ? DarkTheme : DefaultTheme;
  const theme = {
    ...base,
    colors: { ...base.colors, primary: c.primary, background: c.background, card: c.surface, text: c.text, border: c.border },
  };

  return (
    <ThemeProvider value={theme}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerTintColor: c.primary,
          headerTitleStyle: { color: c.text },
          headerStyle: { backgroundColor: c.background },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: c.background },
        }}
      >
        <Stack.Protected guard={!user}>
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={!!user}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="event/new" options={{ title: 'New plan', presentation: 'modal' }} />
          <Stack.Screen name="event/[id]" options={{ title: 'Plan' }} />
          <Stack.Screen name="event/change-date" options={{ title: 'Change date', presentation: 'modal' }} />
          <Stack.Screen name="impact/[id]" options={{ title: 'Review changes' }} />
          <Stack.Screen name="task/[id]" options={{ title: 'Task' }} />
          <Stack.Screen name="task/new" options={{ title: 'New task', presentation: 'modal' }} />
          <Stack.Screen name="finance/index" options={{ title: 'Money' }} />
          <Stack.Screen name="referrals/index" options={{ title: 'Referrals' }} />
          <Stack.Screen name="referrals/new" options={{ title: 'New referral', presentation: 'modal' }} />
          <Stack.Screen name="referral/[id]" options={{ title: 'Referral' }} />
          <Stack.Screen name="consent/index" options={{ title: 'Privacy & sharing' }} />
          <Stack.Screen name="consent/new" options={{ title: 'Share information', presentation: 'modal' }} />
          <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
          <Stack.Screen name="notification-settings" options={{ title: 'Notification settings' }} />
          <Stack.Screen name="profile" options={{ title: 'Profile & household' }} />
          <Stack.Screen name="documents" options={{ title: 'Documents' }} />
          <Stack.Screen name="settings" options={{ title: 'Account settings' }} />
          <Stack.Screen name="worker/index" options={{ title: 'My clients' }} />
          <Stack.Screen name="worker/[clientId]" options={{ title: 'Client' }} />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
