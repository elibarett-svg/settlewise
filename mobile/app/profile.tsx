import { useEffect, useState } from 'react';

import { api } from '../src/api/client';
import { keys, useApiMutation, useHousehold, useProfile, useProfileOptions } from '../src/api/hooks';
import type { Profile } from '../src/api/types';
import { Button, Card, ChipGroup, DateField, Heading, ListRow, Muted, QueryView, Screen, Section, Sheet, SwitchRow, TextField } from '../src/components/ui';
import { confirm, showError } from '../src/lib/alerts';
import { humanize } from '../src/lib/format';
import { spacing } from '../src/theme';

const PROVINCES = ['ON', 'QC', 'BC', 'AB', 'MB', 'SK', 'NS', 'NB', 'NL', 'PE', 'YT', 'NT', 'NU'];
const RELATIONSHIPS = ['spouse', 'partner', 'child', 'parent', 'sibling', 'other'] as const;

/** 1.1 Create Profile, 1.2 Manage Profile, 1.3 Add Household Members. */
export default function ProfileScreen() {
  const profile = useProfile();
  const options = useProfileOptions();
  const household = useHousehold();
  const [draft, setDraft] = useState<Profile | null>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (profile.data) setDraft(profile.data);
  }, [profile.data]);
  const save = useApiMutation((body: Profile) => api<Profile>('/profile', { method: 'PUT', body }), [keys.profile]);
  const removeMember = useApiMutation((id: string) => api(`/profile/household/${id}`, { method: 'DELETE' }), [keys.household]);
  const set = <K extends keyof Profile>(key: K, value: Profile[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));

  return (
    <QueryView query={profile}>
      {() =>
        draft && (
          <Screen>
            <Muted>Enter these details once. Every plan uses them to decide which steps apply to you.</Muted>
            <Card>
              <Heading>Status</Heading>
              <ChipGroup
                value={draft.immigration_status}
                onChange={(v) => set('immigration_status', v)}
                options={(options.data?.immigration_statuses ?? []).map((s) => ({ value: s, label: humanize(s) }))}
              />
              <DateField label="Arrival in Canada" value={draft.arrival_date} optional onChange={(v) => set('arrival_date', v)} />
              <TextField label="Country of origin" value={draft.country_of_origin} onChangeText={(v) => set('country_of_origin', v)} />
              <TextField label="Preferred language" value={draft.preferred_language} onChangeText={(v) => set('preferred_language', v)} />
            </Card>
            <Card>
              <Heading>Contact & address</Heading>
              <TextField label="Phone" value={draft.phone} onChangeText={(v) => set('phone', v)} keyboardType="phone-pad" autoComplete="tel" />
              <TextField label="Contact email" value={draft.contact_email} onChangeText={(v) => set('contact_email', v)} keyboardType="email-address" autoCapitalize="none" />
              <TextField label="Street address" value={draft.address_line} onChangeText={(v) => set('address_line', v)} autoComplete="street-address" />
              <TextField label="City" value={draft.city} onChangeText={(v) => set('city', v)} />
              <ChipGroup value={draft.province} onChange={(v) => set('province', v)} options={PROVINCES.map((p) => ({ value: p, label: p }))} />
              <TextField label="Postal code" value={draft.postal_code} onChangeText={(v) => set('postal_code', v.toUpperCase())} autoCapitalize="characters" />
            </Card>
            <Card>
              <Heading>Work & travel</Heading>
              <TextField label="Employment status" value={draft.employment_status} onChangeText={(v) => set('employment_status', v)} placeholder="e.g. employed, looking for work, student" />
              <SwitchRow label="I have a vehicle" value={draft.has_vehicle} onChange={(v) => set('has_vehicle', v)} />
            </Card>
            <Button title="Save profile" loading={save.isPending} onPress={() => save.mutate(draft, { onError: (e) => showError(e) })} />

            <Section title="Household" action={<Button small variant="ghost" icon="add" title="Add" onPress={() => setAdding(true)} />}>
              <QueryView query={household}>
                {(members) => (
                  <Card style={{ paddingVertical: spacing.xs }}>
                    {members.length === 0 && <Muted>Add a spouse, children or other family members you plan for.</Muted>}
                    {members.map((m) => (
                      <ListRow
                        key={m.id}
                        icon="person-outline"
                        title={m.full_name}
                        subtitle={humanize(m.relationship)}
                        onPress={async () => (await confirm('Remove household member?', m.full_name, 'Remove', true)) && removeMember.mutate(m.id)}
                      />
                    ))}
                  </Card>
                )}
              </QueryView>
            </Section>
            <MemberSheet visible={adding} onClose={() => setAdding(false)} />
          </Screen>
        )
      }
    </QueryView>
  );
}

function MemberSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState<(typeof RELATIONSHIPS)[number]>('spouse');
  const [dob, setDob] = useState<string | null>(null);
  const add = useApiMutation((body: object) => api('/profile/household', { method: 'POST', body }), [keys.household]);
  return (
    <Sheet visible={visible} onClose={onClose} title="Household member">
      <TextField label="Full name" value={name} onChangeText={setName} />
      <ChipGroup value={relationship} onChange={setRelationship} options={RELATIONSHIPS.map((r) => ({ value: r, label: humanize(r) }))} />
      <DateField label="Date of birth" value={dob} optional onChange={setDob} />
      <Button
        title="Add"
        disabled={!name.trim()}
        onPress={() => add.mutate({ full_name: name.trim(), relationship, date_of_birth: dob }, { onSuccess: () => { setName(''); onClose(); }, onError: (e) => showError(e) })}
      />
    </Sheet>
  );
}
