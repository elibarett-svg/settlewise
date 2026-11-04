import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Font from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DEMO } from '../src/api/client';
import { AuthProvider, useAuth } from '../src/auth/AuthContext';
import { DialogHost } from '../src/components/DialogHost';
import { Loading } from '../src/components/ui';
import { registerForPush, useNotificationRouting } from '../src/lib/notifications';
import { useColors, useIsDark } from '../src/theme';

export default function RootLayout() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } }),
  );
  const fontsReady = useEmbeddedFonts();
  if (!fontsReady) return null;
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <PhoneFrame>
            <Navigation />
          </PhoneFrame>
          <DialogHost />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

/** The single-file web demo embeds the icon font (see scripts/inline-web-demo.js) because
 * the page cannot load font files; register it before any icon renders. */
function useEmbeddedFonts(): boolean {
  const embedded = DEMO && Platform.OS === 'web' ? (globalThis as { __SETTLEWISE_FONTS__?: Record<string, string> }).__SETTLEWISE_FONTS__ : undefined;
  const [ready, setReady] = useState(!embedded);
  useEffect(() => {
    if (embedded) Font.loadAsync(embedded).finally(() => setReady(true));
  }, [embedded]);
  return ready;
}

/** On a laptop browser, show the app at phone width instead of stretched across the screen. */
function PhoneFrame({ children }: { children: React.ReactNode }) {
  const c = useColors();
  if (Platform.OS !== 'web') return <>{children}</>;
  return (
    <View style={{ flex: 1, backgroundColor: c.surfaceAlt }}>
      <View style={{ flex: 1, width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: c.background, overflow: 'hidden' }}>
        {children}
      </View>
    </View>
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
