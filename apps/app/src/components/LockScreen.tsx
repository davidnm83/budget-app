// The screen in front of the app while it is locked (lib/lock.ts): fingerprint first where it is
// set up, the PIN always, and a way out for a forgotten PIN (sign out and clear this device).
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/ui';
import { forgetLock, pinWait, unlockWithFingerprint, unlockWithPin, useLock } from '@/lib/lock';
import { wipeOffline } from '@/lib/offline';
import { useTheme } from '@/lib/theme';

/** Sign out of this device without the PIN: the saved sign-in, the offline copy and the lock all go. */
export async function clearThisDevice() {
  try { for (const k of Object.keys(localStorage)) if (k.startsWith('sb-') && k.endsWith('-auth-token')) localStorage.removeItem(k); } catch { /* ignore */ }
  await wipeOffline();
  await forgetLock();
  if (typeof location !== 'undefined') location.reload();
}

// Above everything, pop-ups included (they sit in their own layer on the page), so nothing shows around it.
const ON_TOP = { position: 'fixed', zIndex: 2147483000 } as any;

export function LockScreen() {
  const t = useTheme();
  const lock = useLock();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const asked = useRef(false);
  const finger = lock.mode === 'prf' || lock.mode === 'gate';

  const byFinger = async () => {
    setError('');
    try { await unlockWithFingerprint(); }
    catch (e: any) { if (e?.name !== 'NotAllowedError' && e?.name !== 'AbortError') setError(e instanceof Error ? e.message : String(e)); }
  };
  // Offer the fingerprint as soon as the screen appears; the button is there if the browser wants a tap first.
  useEffect(() => { if (lock.locked && finger && !asked.current) { asked.current = true; byFinger(); } if (!lock.locked) { asked.current = false; setPin(''); setError(''); setForgot(false); } }, [lock.locked, finger]);
  // In the background (or just back from it): a plain cover over everything until it's decided whether to lock.
  if (!lock.locked) return lock.covered ? <View style={[StyleSheet.absoluteFill, ON_TOP, { backgroundColor: t.bg }]} /> : null;

  const byPin = async () => {
    if (!pin) return;
    setBusy(true); setError('');
    try { await unlockWithPin(pin); } catch (e) { setError(e instanceof Error ? e.message : String(e)); setPin(''); } finally { setBusy(false); }
  };
  const wait = pinWait();
  return (
    <View style={[StyleSheet.absoluteFill, ON_TOP, styles.wrap, { backgroundColor: t.bg }]} accessibilityViewIsModal aria-modal>
      <View style={styles.box}>
        <Ionicons name="lock-closed" size={34} color={t.accent} />
        <Text style={{ color: t.text, fontSize: 22, fontWeight: '800' }}>Budget is locked</Text>
        {finger && <Button title="Unlock with fingerprint" onPress={byFinger} style={{ alignSelf: 'stretch' }} />}
        <Text style={{ color: t.muted, fontSize: 13 }}>{finger ? 'or enter your PIN' : 'Enter your PIN'}</Text>
        <TextInput value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 12))} onSubmitEditing={byPin} secureTextEntry keyboardType="number-pad" inputMode="numeric"
          autoFocus={!finger} placeholder="PIN" placeholderTextColor={t.muted} accessibilityLabel="PIN" autoComplete="off"
          style={[styles.pin, { color: t.text, borderColor: t.line, backgroundColor: t.card }]} />
        <Button title="Unlock" kind={finger ? 'plain' : 'primary'} onPress={byPin} busy={busy} disabled={pin.length < 6 || wait > 0} style={{ alignSelf: 'stretch' }} />
        {!!error && <Text style={{ color: t.danger, textAlign: 'center' }}>{error}</Text>}
        {!forgot ? (
          <Pressable onPress={() => setForgot(true)} hitSlop={10}><Text style={{ color: t.muted, fontSize: 13 }}>Forgot your PIN?</Text></Pressable>
        ) : (
          <View style={{ gap: 8, alignSelf: 'stretch' }}>
            <Text style={{ color: t.muted, fontSize: 13, textAlign: 'center' }}>The PIN can’t be recovered. You can sign out of this device instead: the saved sign-in and the offline copy here are erased, and you sign in again with your password. Nothing in your account is deleted.</Text>
            <Button title="Sign out and clear this device" kind="danger" onPress={clearThisDevice} />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { zIndex: 1000, alignItems: 'center', justifyContent: 'center', padding: 24 },
  box: { width: '100%', maxWidth: 340, alignItems: 'center', gap: 14 },
  pin: { alignSelf: 'stretch', borderWidth: 1, borderRadius: 12, paddingVertical: 12, fontSize: 22, textAlign: 'center', letterSpacing: 6 },
});
