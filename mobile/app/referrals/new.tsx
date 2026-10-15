import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';

import { api } from '../../src/api/client';
import { useApiMutation, useEvents, useProviders, useServiceTypes } from '../../src/api/hooks';
import type { Provider, Referral } from '../../src/api/types';
import { Badge, Body, Button, Card, Chip, DateField, Heading, Muted, QueryView, Row, Screen, TextField } from '../../src/components/ui';
import { showError } from '../../src/lib/alerts';
import { addDays, humanize, todayISO } from '../../src/lib/format';
import { spacing, useColors } from '../../src/theme';

/** 6.1 Search Provider Directory -> 6.2 Create Referral. */
export default function NewReferral() {
  const params = useLocalSearchParams<{ eventId?: string; serviceType?: string; reason?: string }>();
  const c = useColors();
  const [serviceType, setServiceType] = useState<string | undefined>(params.serviceType);
  const [city, setCity] = useState('');
  const [provider, setProvider] = useState<Provider | null>(null);
  const [custom, setCustom] = useState('');
  const [reason, setReason] = useState(params.reason ?? '');
  const [info, setInfo] = useState('');
  const [eventId, setEventId] = useState<string | undefined>(params.eventId);
  const [followUp, setFollowUp] = useState<string | null>(addDays(todayISO(), 7));
  const types = useServiceTypes();
  const providers = useProviders({ service_type: serviceType, city: city.trim() || undefined });
  const events = useEvents('active');
  const create = useApiMutation((body: object) => api<Referral>('/referrals', { method: 'POST', body }));

  const submit = () =>
    create.mutate(
      {
        provider_id: provider?.id,
        recipient_name: provider ? undefined : custom.trim(),
        reason: reason.trim(),
        info_needed: info.split(',').map((s) => s.trim()).filter(Boolean),
        life_event_id: eventId,
        follow_up_date: followUp,
      },
      { onSuccess: (r) => router.replace(`/referral/${r.id}`), onError: (e) => showError(e) },
    );

  return (
    <Screen>
      <Heading>Find a provider</Heading>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
        <Chip label="All" selected={!serviceType} onPress={() => setServiceType(undefined)} />
        {(types.data ?? []).map((s) => (
          <Chip key={s} label={humanize(s)} selected={serviceType === s} onPress={() => setServiceType(s)} />
        ))}
      </ScrollView>
      <TextField label="City" value={city} onChangeText={setCity} placeholder="e.g. Toronto" />
      <QueryView query={providers}>
        {(list) => (
          <View style={{ gap: spacing.sm }}>
            {list.length === 0 && <Muted>No providers match. You can enter any organization below.</Muted>}
            {list.map((p) => (
              <Card key={p.id} onPress={() => setProvider(provider?.id === p.id ? null : p)} style={provider?.id === p.id ? { borderColor: c.primary, borderWidth: 2 } : undefined}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Body style={{ fontWeight: '600', flex: 1 }}>{p.name}</Body>
                  {p.is_sample && <Badge label="Sample" />}
                </Row>
                <Muted>{p.description}</Muted>
                <Muted>
                  {p.city}, {p.province} · {p.languages.join(', ')}
                </Muted>
                <Row>
                  {p.phone ? <Button small variant="ghost" icon="call-outline" title={p.phone} onPress={() => Linking.openURL(`tel:${p.phone}`)} /> : null}
                  {p.website ? <Button small variant="ghost" icon="globe-outline" title="Website" onPress={() => Linking.openURL(p.website)} /> : null}
                </Row>
              </Card>
            ))}
          </View>
        )}
      </QueryView>
      {!provider && <TextField label="Or enter an organization" value={custom} onChangeText={setCustom} />}
      <TextField label="Why are you contacting them?" value={reason} onChangeText={setReason} multiline />
      <TextField label="Information they will need" value={info} onChangeText={setInfo} hint="Separate with commas, e.g. Lease copy, PR card" />
      {!!events.data?.length && (
        <Row style={{ flexWrap: 'wrap' }}>
          <Chip label="No plan" selected={!eventId} onPress={() => setEventId(undefined)} />
          {events.data.map((ev) => (
            <Chip key={ev.id} label={ev.title} selected={eventId === ev.id} onPress={() => setEventId(ev.id)} />
          ))}
        </Row>
      )}
      <DateField label="Follow up on" value={followUp} onChange={setFollowUp} />
      <Button title="Create referral" disabled={!reason.trim() || (!provider && !custom.trim())} loading={create.isPending} onPress={submit} />
    </Screen>
  );
}
