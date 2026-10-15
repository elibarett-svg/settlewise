import { router } from 'expo-router';

import { useFeatures, useUnreadCount } from '../../src/api/hooks';
import { useAuth } from '../../src/auth/AuthContext';
import { Badge, Card, ListRow, Muted, Screen } from '../../src/components/ui';
import { useT } from '../../src/i18n';
import { spacing } from '../../src/theme';

export default function More() {
  const t = useT();
  const { user } = useAuth();
  const { has } = useFeatures();
  const unread = useUnreadCount().data?.unread ?? 0;
  return (
    <Screen>
      <Card style={{ paddingVertical: spacing.xs }}>
        <ListRow icon="person-outline" tone="primary" title={t.more.profile} onPress={() => router.push('/profile')} />
        <ListRow icon="document-text-outline" tone="primary" title={t.more.documents} onPress={() => router.push('/documents')} />
        {has('finance') && <ListRow icon="wallet-outline" tone="primary" title={t.more.finance} onPress={() => router.push('/finance')} />}
        {has('referrals') && <ListRow icon="swap-horizontal-outline" tone="primary" title={t.more.referrals} onPress={() => router.push('/referrals')} />}
        {has('consent') && <ListRow icon="lock-closed-outline" tone="primary" title={t.more.consent} onPress={() => router.push('/consent')} />}
        <ListRow
          icon="notifications-outline"
          tone="primary"
          title={t.more.notifications}
          right={unread ? <Badge label={String(unread)} tone="danger" /> : undefined}
          onPress={() => router.push('/notifications')}
        />
        <ListRow icon="settings-outline" tone="primary" title={t.more.settings} onPress={() => router.push('/settings')} />
      </Card>
      {has('worker_portal') && user?.role !== 'newcomer' && (
        <Card style={{ paddingVertical: spacing.xs }}>
          <ListRow icon="briefcase-outline" tone="info" title={t.more.worker} onPress={() => router.push('/worker')} />
        </Card>
      )}
      <Muted style={{ textAlign: 'center' }}>{t.auth.privacy}</Muted>
    </Screen>
  );
}
