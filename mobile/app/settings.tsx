import { useState } from 'react';
import { Alert, Share } from 'react-native';

import { api, API_URL } from '../src/api/client';
import type { TokenResponse, User } from '../src/api/types';
import { useAuth } from '../src/auth/AuthContext';
import { Body, Button, Card, ChipGroup, Heading, Muted, Screen, Sheet, TextField } from '../src/components/ui';
import { useT } from '../src/i18n';
import { confirm, showError } from '../src/lib/alerts';

/** 10.0 Account Administration. */
export default function Settings() {
  const t = useT();
  const { user, setUser, signOut, acceptToken } = useAuth();
  const [sheet, setSheet] = useState<null | 'password' | '2fa' | 'delete'>(null);

  const setLanguage = async (display_language: string) => {
    try {
      setUser(await api<User>('/account/me', { method: 'PATCH', body: { display_language } }));
    } catch (e) {
      showError(e);
    }
  };

  const exportData = async () => {
    try {
      const data = await api<object>('/account/export');
      await Share.share({ title: 'SettleWise data export', message: JSON.stringify(data, null, 2) });
    } catch (e) {
      showError(e);
    }
  };

  if (!user) return null;
  return (
    <Screen>
      <Card>
        <Heading>{user.full_name || user.email}</Heading>
        <Muted>{user.email}</Muted>
      </Card>
      <Card>
        <Heading>Language</Heading>
        <ChipGroup value={user.display_language} onChange={setLanguage} options={[{ value: 'en', label: 'English' }, { value: 'fr', label: 'Français' }]} />
      </Card>
      <Card>
        <Heading>Security</Heading>
        <Button variant="secondary" icon="key-outline" title="Change password" onPress={() => setSheet('password')} />
        <Button variant="secondary" icon="shield-checkmark-outline" title={user.totp_enabled ? 'Turn off two-step verification' : 'Turn on two-step verification'} onPress={() => setSheet('2fa')} />
        <Button
          variant="secondary"
          icon="log-out-outline"
          title="Sign out on all devices"
          onPress={async () => {
            if (await confirm('Sign out everywhere?', 'You will need to sign in again on every device.')) {
              await api('/auth/logout-all', { method: 'POST' }).catch(() => undefined);
              await signOut();
            }
          }}
        />
      </Card>
      <Card>
        <Heading>Your data</Heading>
        <Button variant="secondary" icon="download-outline" title="Export my data" onPress={exportData} />
        <Button variant="danger" icon="trash-outline" title="Delete my account" onPress={() => setSheet('delete')} />
      </Card>
      <Button title={t.auth.signOut} variant="ghost" onPress={signOut} />
      <Muted style={{ textAlign: 'center', fontSize: 12 }}>Server: {API_URL}</Muted>

      <PasswordSheet visible={sheet === 'password'} onClose={() => setSheet(null)} onDone={async (res) => { await acceptToken(res); setSheet(null); Alert.alert('Password changed'); }} />
      <TotpSheet visible={sheet === '2fa'} enabled={user.totp_enabled} onClose={() => setSheet(null)} onDone={(u) => { setUser(u); setSheet(null); }} />
      <DeleteSheet visible={sheet === 'delete'} onClose={() => setSheet(null)} onDone={signOut} />
    </Screen>
  );
}

function PasswordSheet({ visible, onClose, onDone }: { visible: boolean; onClose: () => void; onDone: (r: TokenResponse) => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  return (
    <Sheet visible={visible} onClose={onClose} title="Change password">
      <TextField label="Current password" value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" />
      <TextField label="New password" value={next} onChangeText={setNext} secureTextEntry autoComplete="new-password" hint="At least 8 characters" />
      <Button
        title="Change password"
        disabled={!current || next.length < 8}
        onPress={() =>
          api<TokenResponse>('/auth/password/change', { method: 'POST', body: { current_password: current, new_password: next } })
            .then(onDone)
            .catch((e) => showError(e))
        }
      />
    </Sheet>
  );
}

function TotpSheet({ visible, enabled, onClose, onDone }: { visible: boolean; enabled: boolean; onClose: () => void; onDone: (u: User) => void }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const start = () => api<{ secret: string; otpauth_url: string }>('/auth/2fa/setup', { method: 'POST' }).then((r) => setSecret(r.secret)).catch((e) => showError(e));
  const finish = () =>
    api<User>(`/auth/2fa/${enabled ? 'disable' : 'enable'}`, { method: 'POST', body: { code } })
      .then((u) => { setSecret(null); setCode(''); onDone(u); })
      .catch((e) => showError(e));
  return (
    <Sheet visible={visible} onClose={onClose} title="Two-step verification">
      {!enabled && !secret && (
        <>
          <Body>Use an authenticator app (such as Google Authenticator, Microsoft Authenticator or 1Password) for a 6-digit code at sign-in.</Body>
          <Button title="Set up" onPress={start} />
        </>
      )}
      {!enabled && secret && (
        <>
          <Body>Add this key to your authenticator app, then enter the code it shows:</Body>
          <Card>
            <Body selectable style={{ fontFamily: 'Courier', letterSpacing: 2 }}>{secret}</Body>
          </Card>
        </>
      )}
      {(enabled || secret) && (
        <>
          <TextField label="6-digit code" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" />
          <Button title={enabled ? 'Turn off' : 'Turn on'} disabled={code.length !== 6} onPress={finish} />
        </>
      )}
    </Sheet>
  );
}

function DeleteSheet({ visible, onClose, onDone }: { visible: boolean; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState('');
  return (
    <Sheet visible={visible} onClose={onClose} title="Delete account">
      <Body>This permanently removes your profile, plans, documents, referrals, sharing permissions and history. Consider exporting your data first.</Body>
      <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry />
      <Button
        variant="danger"
        title="Delete permanently"
        disabled={!password}
        onPress={async () => {
          if (!(await confirm('Delete your account?', 'This cannot be undone.', 'Delete', true))) return;
          api('/account/delete', { method: 'POST', body: { password } }).then(onDone).catch((e) => showError(e));
        }}
      />
    </Sheet>
  );
}
