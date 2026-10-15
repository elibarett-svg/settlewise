import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { api } from '../../src/api/client';
import { useApiMutation, useEvents } from '../../src/api/hooks';
import type { Task } from '../../src/api/types';
import { Button, Chip, ChipGroup, DateField, Muted, Row, Screen, SwitchRow, TextField } from '../../src/components/ui';
import { showError } from '../../src/lib/alerts';

const CATEGORIES = ['general', 'housing', 'utilities', 'insurance', 'travel', 'government', 'finance', 'documents', 'family', 'health'];

/** 4.1 Create Tasks. */
export default function NewTask() {
  const params = useLocalSearchParams<{ eventId?: string }>();
  const events = useEvents('active');
  const [title, setTitle] = useState('');
  const [eventId, setEventId] = useState<string | undefined>(params.eventId);
  const [due, setDue] = useState<string | null>(null);
  const [category, setCategory] = useState('general');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [external, setExternal] = useState('');
  const [sensitive, setSensitive] = useState(false);
  const create = useApiMutation((body: object) => api<Task>('/tasks', { method: 'POST', body }));

  return (
    <Screen>
      <TextField label="What needs doing?" value={title} onChangeText={setTitle} autoFocus />
      {!!events.data?.length && (
        <>
          <Muted>Plan</Muted>
          <Row style={{ flexWrap: 'wrap' }}>
            <Chip label="No plan" selected={!eventId} onPress={() => setEventId(undefined)} />
            {events.data.map((ev) => (
              <Chip key={ev.id} label={ev.title} selected={eventId === ev.id} onPress={() => setEventId(ev.id)} />
            ))}
          </Row>
        </>
      )}
      <DateField label="Due date" value={due} onChange={setDue} optional />
      <Muted>Category</Muted>
      <ChipGroup value={category} onChange={setCategory} options={CATEGORIES.map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1) }))} />
      <Muted>Priority</Muted>
      <ChipGroup
        value={priority}
        onChange={setPriority}
        options={[
          { value: 'low', label: 'Low' },
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' },
        ]}
      />
      <TextField label="Organization involved (optional)" value={external} onChangeText={setExternal} placeholder="e.g. Landlord, Hydro provider" />
      <SwitchRow label="Date-sensitive" hint="Flag this task for review if the plan's date changes" value={sensitive} onChange={setSensitive} />
      <Button
        title="Add task"
        disabled={!title.trim()}
        loading={create.isPending}
        onPress={() =>
          create.mutate(
            { title: title.trim(), life_event_id: eventId, due_date: due, category, priority, external_party: external, date_sensitive: sensitive },
            { onSuccess: () => router.back(), onError: (e) => showError(e) },
          )
        }
      />
    </Screen>
  );
}
