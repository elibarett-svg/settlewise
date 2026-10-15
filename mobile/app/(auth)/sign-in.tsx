import { router } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { api, ApiError } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { Button, Muted, Screen, TextField, Title } from '../../src/components/ui';
import { useT } from '../../src/i18n';
import { showError } from '../../src/lib/alerts';

export default function SignIn() {
  const t = useT();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await signIn(email.trim(), password, needsCode ? code : undefined);
    } catch (e) {
      if (e instanceof ApiError && e.message === 'totp_required') setNeedsCode(true);
      else showError(e, 'Could not sign in');
    } finally {
      setBusy(false);
    }
  };

  const forgot = async () => {
    if (!email.trim()) return Alert.alert('Enter your email first');
    try {
      await api('/auth/password/reset-request', { method: 'POST', body: { email: email.trim() } });
      Alert.alert('Check your email', 'If an account exists, we sent instructions to reset your password.');
    } catch (e) {
      showError(e);
    }
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <Title>{t.auth.signIn}</Title>
      <TextField label={t.auth.email} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
      <TextField label={t.auth.password} value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" />
      {needsCode && (
        <TextField label={t.auth.code} hint={t.auth.codeHint} value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} autoFocus />
      )}
      <Button title={t.auth.signIn} onPress={submit} loading={busy} disabled={!email || !password} />
      <Button title={t.auth.forgot} variant="ghost" onPress={forgot} />
      <Button title={t.auth.noAccount} variant="ghost" onPress={() => router.replace('/sign-up')} />
      <Muted style={{ textAlign: 'center' }}>{t.auth.privacy}</Muted>
    </Screen>
  );
}
