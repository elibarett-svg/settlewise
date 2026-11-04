import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { View } from 'react-native';

import { useState } from 'react';

import { DEMO } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { Body, Button, Card, Muted, Screen, Title } from '../../src/components/ui';
import { showError } from '../../src/lib/alerts';
import { useT } from '../../src/i18n';
import { spacing, useColors } from '../../src/theme';

const POINTS: { icon: 'git-network-outline' | 'swap-horizontal-outline' | 'lock-closed-outline'; text: string }[] = [
  { icon: 'git-network-outline', text: 'A personal plan for moving, travel, a new job, family changes and PR preparation.' },
  { icon: 'swap-horizontal-outline', text: 'Change a date and see every linked task, cost and referral that needs review.' },
  { icon: 'lock-closed-outline', text: 'Choose exactly who sees which details, why, and for how long.' },
];

export default function Welcome() {
  const t = useT();
  const c = useColors();
  const { signIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const tryDemo = async () => {
    setBusy(true);
    try {
      await signIn('sarah@example.com', 'demo');
    } catch (e) {
      showError(e);
      setBusy(false);
    }
  };
  return (
    <Screen edges={['top', 'bottom']} style={{ justifyContent: 'center', flexGrow: 1 }}>
      <View style={{ alignItems: 'center', gap: spacing.md, marginTop: spacing.xxl }}>
        <View style={{ backgroundColor: c.primarySoft, borderRadius: 40, padding: spacing.lg }}>
          <Ionicons name="compass" size={48} color={c.primary} />
        </View>
        <Title>{t.appName}</Title>
        <Muted style={{ textAlign: 'center' }}>{t.tagline}</Muted>
      </View>
      <View style={{ gap: spacing.lg, marginVertical: spacing.xl }}>
        {POINTS.map((p) => (
          <View key={p.icon} style={{ flexDirection: 'row', gap: spacing.md }}>
            <Ionicons name={p.icon} size={24} color={c.primary} />
            <Body style={{ flex: 1 }}>{p.text}</Body>
          </View>
        ))}
      </View>
      {DEMO && (
        <Card style={{ borderColor: c.primary }}>
          <Body style={{ fontWeight: '700' }}>Interactive demo</Body>
          <Muted>
            Explore SettleWise as Sarah, the fictional newcomer from the Project Vision. All data is synthetic and stays in this browser.
            Try Plans → Move to the new apartment → Change date.
          </Muted>
          <Button title="Try the demo as Sarah" icon="play" loading={busy} onPress={tryDemo} />
        </Card>
      )}
      <Button title={t.auth.signUp} variant={DEMO ? 'secondary' : 'primary'} onPress={() => router.push('/sign-up')} />
      {!DEMO && <Button title={t.auth.signIn} variant="secondary" onPress={() => router.push('/sign-in')} />}
      <Muted style={{ textAlign: 'center' }}>{t.auth.privacy}</Muted>
    </Screen>
  );
}
