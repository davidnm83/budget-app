// Settings → App lock: turn the fingerprint/PIN lock on or off for this device (lib/lock.ts).
import { useEffect, useState } from 'react';
import { Text, TextInput } from 'react-native';
import { Field, Sheet } from '@/components/Forms';
import { Button, Card } from '@/components/ui';
import { LOCK_AFTER_MIN, fingerprintAvailable, forgetLock, lockAvailable, lockNow, pinProblem, protectStored, setupLock, unprotectStored, useLock, type LockMode } from '@/lib/lock';
import { resetOfflineStore } from '@/lib/offline';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { toast } from '@/lib/toast';

const HOW: Record<LockMode, string> = {
  prf: 'Fingerprint and PIN. The saved sign-in and the offline copy on this device are encrypted, and only your fingerprint or PIN can unlock them.',
  gate: 'Fingerprint and PIN. This device checks your fingerprint before the app opens, but can’t tie the encryption key to it, so the fingerprint protects the screen rather than the stored data. The PIN still unlocks it.',
  pin: 'PIN only. This device has no fingerprint or face check the browser can use. The saved sign-in and the offline copy are encrypted, and only your PIN can unlock them.',
};
const storageKey = () => (supabase.auth as any).storageKey as string;

export function LockSettings() {
  const t = useTheme();
  const lock = useLock();
  const { session } = useSession();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [finger, setFinger] = useState(false);
  useEffect(() => { fingerprintAvailable().then(setFinger); }, []);
  if (!lockAvailable) return null;
  const input = { color: t.text, borderWidth: 1, borderColor: t.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 18, letterSpacing: 4, backgroundColor: t.card } as const;
  const digits = (set: (v: string) => void) => (v: string) => set(v.replace(/\D/g, '').slice(0, 12));

  const turnOn = async () => {
    const bad = pinProblem(pin) || (pin !== again ? 'The two PINs don’t match.' : '');
    if (bad) { setError(bad); return; }
    setBusy(true); setError('');
    try {
      const mode = await setupLock(pin, session?.user.email ?? 'Budget');
      // From here the sign-in and the offline copy are kept under the lock's key.
      await protectStored(storageKey());
      await resetOfflineStore();
      setOpen(false); setPin(''); setAgain('');
      toast(mode === 'pin' ? 'App lock is on (PIN)' : 'App lock is on');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const turnOff = async () => {
    try { await unprotectStored(storageKey()); await forgetLock(); await resetOfflineStore(); toast('App lock is off'); }
    catch (e) { toast(e instanceof Error ? e.message : String(e), { error: true }); }
  };

  return (
    <>
      <Text style={{ color: t.text, fontSize: 18, fontWeight: '700', marginTop: 16, marginBottom: 8 }}>App lock</Text>
      <Card style={{ gap: 12 }}>
        {lock.enabled ? (
          <>
            <Text style={{ color: t.text, fontWeight: '600' }}>On for this device</Text>
            <Text style={{ color: t.muted }}>{HOW[lock.mode ?? 'pin']}</Text>
            <Text style={{ color: t.muted, fontSize: 13 }}>It asks each time the app is opened fresh, and after {LOCK_AFTER_MIN} minutes in the background. Signing out turns it off.</Text>
            <Button title="Lock now" kind="plain" onPress={lockNow} />
            <Button title="Turn off" kind="plain" onPress={turnOff} />
          </>
        ) : (
          <>
            <Text style={{ color: t.muted }}>Ask for your {finger ? 'fingerprint (or face) or a PIN' : 'PIN'} before the app opens on this device. The saved sign-in and the offline copy of your data are encrypted, so they can’t be read without it.</Text>
            <Button title="Turn on" kind="plain" onPress={() => { setError(''); setOpen(true); }} />
          </>
        )}
      </Card>
      {open && (
        <Sheet title="Turn on the app lock" onClose={() => { if (!busy) setOpen(false); }} fit>
          <Text style={{ color: t.muted }}>Choose a PIN of 6 to 12 digits. {finger ? 'Next, your device asks for your fingerprint so it can unlock the app; the PIN is the fallback.' : 'This device has no fingerprint check the browser can use, so the PIN is how you unlock.'}</Text>
          <Field t={t} label="PIN"><TextInput value={pin} onChangeText={digits(setPin)} secureTextEntry keyboardType="number-pad" inputMode="numeric" autoComplete="off" accessibilityLabel="New PIN" style={input} /></Field>
          <Field t={t} label="PIN again"><TextInput value={again} onChangeText={digits(setAgain)} secureTextEntry keyboardType="number-pad" inputMode="numeric" autoComplete="off" accessibilityLabel="New PIN again" onSubmitEditing={turnOn} style={input} /></Field>
          <Text style={{ color: t.muted, fontSize: 12 }}>There is no way to recover a forgotten PIN. If you forget it, you sign out of this device and sign in again with your password; nothing in your account is lost. A longer PIN is harder to guess for someone who copies the device’s storage.</Text>
          {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
          <Button title="Turn on" onPress={turnOn} busy={busy} />
        </Sheet>
      )}
    </>
  );
}
