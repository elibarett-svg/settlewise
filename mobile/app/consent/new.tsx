import { router } from 'expo-router';
import { useState } from 'react';

import { api } from '../../src/api/client';
import { useApiMutation, useConsentFields } from '../../src/api/hooks';
import { Button, ChipGroup, Heading, Muted, QueryView, Screen, SwitchRow, TextField } from '../../src/components/ui';
import { showError } from '../../src/lib/alerts';

const DURATIONS = [
  { value: '7', label: '1 week' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
];

/** 7.1 Set Sharing Permissions + 7.2 Set Purpose and Duration. */
export default function NewGrant() {
  const fields = useConsentFields();
  const [type, setType] = useState<'advisor' | 'provider' | 'household' | 'other'>('advisor');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [purpose, setPurpose] = useState('');
  const [duration, setDuration] = useState('30');
  const [chosen, setChosen] = useState<string[]>([]);
  const create = useApiMutation((body: object) => api('/consent/grants', { method: 'POST', body }), [['consent']]);

  const toggle = (f: string, on: boolean) => setChosen((prev) => (on ? [...prev, f] : prev.filter((x) => x !== f)));

  return (
    <Screen>
      <Heading>Who is it for?</Heading>
      <ChipGroup
        value={type}
        onChange={setType}
        options={[
          { value: 'advisor', label: 'Advisor' },
          { value: 'provider', label: 'Provider' },
          { value: 'household', label: 'Household' },
          { value: 'other', label: 'Other' },
        ]}
      />
      <TextField label="Name" value={name} onChangeText={setName} placeholder="e.g. Harbourfront Settlement Centre" />
      <TextField label="Their email (optional)" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" hint="If they use SettleWise, they can view exactly what you share." />
      <Heading>What can they see?</Heading>
      <QueryView query={fields}>
        {(catalogue) => (
          <>
            {Object.entries(catalogue).map(([key, text]) => (
              <SwitchRow key={key} label={text} value={chosen.includes(key)} onChange={(on) => toggle(key, on)} />
            ))}
          </>
        )}
      </QueryView>
      <Muted>Document numbers are never shared.</Muted>
      <TextField label="Why are you sharing?" value={purpose} onChangeText={setPurpose} placeholder="e.g. Help with my move" />
      <Heading>For how long?</Heading>
      <ChipGroup value={duration} onChange={setDuration} options={DURATIONS} />
      <Button
        title="Share"
        disabled={!name.trim() || purpose.trim().length < 3 || chosen.length === 0}
        loading={create.isPending}
        onPress={() =>
          create.mutate(
            { recipient_type: type, recipient_name: name.trim(), recipient_email: email.trim() || undefined, fields: chosen, purpose: purpose.trim(), duration_days: Number(duration) },
            { onSuccess: () => router.back(), onError: (e) => showError(e) },
          )
        }
      />
    </Screen>
  );
}
