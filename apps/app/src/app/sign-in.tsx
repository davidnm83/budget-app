import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

export default function SignIn() {
  const t = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const submit = async () => {
    setBusy(true);
    setMsg('');
    const { data, error } = mode === 'in'
      ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
      : await supabase.auth.signUp({ email: email.trim(), password });
    setBusy(false);
    if (error) setMsg(error.message);
    else if (mode === 'up' && !data.session) setMsg('Check your email to confirm your account, then sign in.');
  };

  const input = [styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.card }];
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: t.bg }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.inner}>
        <Text style={[styles.title, { color: t.text }]}>Budget</Text>
        <Text style={{ color: t.muted, marginBottom: 24 }}>{mode === 'in' ? 'Sign in to your budget.' : 'Create your account.'}</Text>
        <TextInput style={input} placeholder="Email" placeholderTextColor={t.muted} autoCapitalize="none" keyboardType="email-address"
          autoComplete="email" value={email} onChangeText={setEmail} />
        <TextInput style={input} placeholder="Password" placeholderTextColor={t.muted} secureTextEntry
          autoComplete={mode === 'in' ? 'current-password' : 'new-password'} value={password} onChangeText={setPassword} onSubmitEditing={submit} />
        <Button title={mode === 'in' ? 'Sign in' : 'Create account'} onPress={submit} busy={busy} disabled={!email || password.length < 6} />
        <Button title={mode === 'in' ? 'New here? Create an account' : 'Have an account? Sign in'} kind="plain"
          onPress={() => { setMode(mode === 'in' ? 'up' : 'in'); setMsg(''); }} style={{ marginTop: 8, borderWidth: 0 }} />
        {!!msg && <Text style={{ color: t.danger, marginTop: 12 }}>{msg}</Text>}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  inner: { flex: 1, justifyContent: 'center', padding: 24, maxWidth: 420, width: '100%', alignSelf: 'center' },
  title: { fontSize: 32, fontWeight: '700', marginBottom: 4 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16, marginBottom: 12 },
});
