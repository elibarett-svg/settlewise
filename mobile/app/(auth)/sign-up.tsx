import { router } from 'expo-router';
import { useState } from 'react';

import { useAuth } from '../../src/auth/AuthContext';
import { Button, ChipGroup, Muted, Screen, TextField, Title } from '../../src/components/ui';
import { deviceLanguage, useT } from '../../src/i18n';
import { showError } from '../../src/lib/alerts';

export default function SignUp() {
  const t = useT();
  const { signUp } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [language, setLanguage] = useState<'en' | 'fr'>(deviceLanguage() === 'fr' ? 'fr' : 'en');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await signUp(email.trim(), password, name.trim(), language);
      router.replace('/profile');
    } catch (e) {
      showError(e, 'Could not create account');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <Title>{t.auth.signUp}</Title>
      <TextField label={t.auth.fullName} value={name} onChangeText={setName} autoComplete="name" textContentType="name" />
      <TextField label={t.auth.email} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
      <TextField
        label={t.auth.password}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        hint="At least 8 characters"
      />
      <ChipGroup
        value={language}
        onChange={setLanguage}
        options={[
          { value: 'en', label: 'English' },
          { value: 'fr', label: 'Français' },
        ]}
      />
      <Button title={t.auth.signUp} onPress={submit} loading={busy} disabled={!email || password.length < 8} />
      <Button title={t.auth.haveAccount} variant="ghost" onPress={() => router.replace('/sign-in')} />
      <Muted style={{ textAlign: 'center' }}>{t.auth.privacy}</Muted>
    </Screen>
  );
}
