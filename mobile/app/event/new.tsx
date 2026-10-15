import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { api } from '../../src/api/client';
import { useApiMutation, useTemplates } from '../../src/api/hooks';
import type { LifeEventDetail } from '../../src/api/types';
import { EVENT_ICONS } from '../../src/components/domain';
import { Body, Button, Card, DateField, Heading, Muted, QueryView, Row, Screen, TextField } from '../../src/components/ui';
import { useT } from '../../src/i18n';
import { showError } from '../../src/lib/alerts';
import { addDays, todayISO } from '../../src/lib/format';
import { spacing, useColors } from '../../src/theme';

/** 2.1 Select Life Event -> 2.2 Generate Action Plan. */
export default function NewEvent() {
  const t = useT();
  const c = useColors();
  const templates = useTemplates();
  const [type, setType] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(addDays(todayISO(), 30));
  const [title, setTitle] = useState('');
  const create = useApiMutation((body: object) => api<LifeEventDetail>('/events', { method: 'POST', body }));
  const selected = templates.data?.find((x) => x.id === type);

  const submit = () =>
    create.mutate(
      { event_type: type, key_date: date, title: title.trim() || undefined },
      { onSuccess: (ev) => router.replace(`/event/${ev.id}`), onError: (e) => showError(e) },
    );

  return (
    <Screen>
      <Heading>{t.plans.chooseEvent}</Heading>
      <QueryView query={templates}>
        {(list) => (
          <View style={{ gap: spacing.sm }}>
            {list.map((tpl) => (
              <Card
                key={tpl.id}
                onPress={() => setType(tpl.id)}
                accessibilityLabel={tpl.title}
                style={type === tpl.id ? { borderColor: c.primary, borderWidth: 2 } : undefined}
              >
                <Row>
                  <Ionicons name={EVENT_ICONS[tpl.id] ?? 'flag-outline'} size={22} color={c.primary} />
                  <Body style={{ fontWeight: '700', flex: 1 }}>{tpl.title}</Body>
                  {type === tpl.id && <Ionicons name="checkmark-circle" size={22} color={c.primary} />}
                </Row>
                <Muted>{tpl.description}</Muted>
              </Card>
            ))}
          </View>
        )}
      </QueryView>
      {selected && (
        <>
          <DateField label={selected.key_date_label} value={date} onChange={setDate} />
          <TextField label="Name (optional)" value={title} onChangeText={setTitle} placeholder={selected.title} />
          <Muted>Your plan is personalised from your profile. You can add, remove or reorder steps afterwards.</Muted>
          <Button title={t.plans.create} onPress={submit} loading={create.isPending} disabled={!date} />
        </>
      )}
    </Screen>
  );
}
