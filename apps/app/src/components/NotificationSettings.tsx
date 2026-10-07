// Settings → Notifications: this device on or off, the other devices, and what is sent and when.
// Settings save as you change them (user_prefs.notify) and apply to every device.
import Ionicons from '@expo/vector-icons/Ionicons';
import { NOTIFY_DEFAULTS, NOTIFY_KINDS, RADAR_CHECKS, RADAR_NOTIFY_DEFAULT, notifyOn, notifySetting, type Note, type NotifyKind, type NotifySettings, type RadarCheck } from '@budget-app/core';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Sheet } from '@/components/Forms';
import { Button, Card, Chip } from '@/components/ui';
import { deviceEndpoint, loadDevices, loadNotifySettings, preview, pushSupported, removeDevice, saveNotifySettings, sendTest, turnOff, turnOn, type Device } from '@/lib/notifications';
import { useTheme, type Theme } from '@/lib/theme';
import { toast } from '@/lib/toast';

const RADAR_PICK: RadarCheck[] = ['bill', 'pace', 'unusual', 'cards', 'runway', 'transfers'];
const hourText = (h: number) => (h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`);

export function NotificationSettings() {
  const t = useTheme();
  const [s, setS] = useState<NotifySettings | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [mine, setMine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const reload = () => Promise.all([loadNotifySettings().then(setS), loadDevices().then(setDevices), deviceEndpoint().then(setMine).catch(() => setMine(null))]);
  useEffect(() => { reload(); }, []);
  const here = !!mine && devices.some((d) => d.endpoint === mine);
  const run = async (f: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try { await f(); if (done) toast(done); await reload(); }
    catch (e) { toast(e instanceof Error ? e.message : String(e), { error: true }); }
    finally { setBusy(false); }
  };
  const count = s ? NOTIFY_KINDS.filter((k) => notifyOn(s, k.key)).length : 0;

  return (
    <>
      <Text style={{ color: t.text, fontSize: 18, fontWeight: '700', marginTop: 16, marginBottom: 8 }}>Notifications</Text>
      <Card style={{ gap: 12 }}>
        {!pushSupported() ? (
          <Text style={{ color: t.muted }}>This browser can’t show notifications from the app. On Android, use Chrome; on an iPhone, add the app to the home screen first (iOS 16.4 or later).</Text>
        ) : (
          <>
            <Text style={{ color: t.text, fontWeight: '600' }}>{here ? 'On for this device' : 'Off on this device'}</Text>
            <Text style={{ color: t.muted, fontSize: 13 }}>
              {here ? `${count} kind${count === 1 ? '' : 's'} switched on. They arrive even with the app closed; on a computer, while the browser is running.` : 'Bills due, low balances, bank problems and more, as notifications. Each device is turned on by itself.'}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Button title={here ? 'Turn off' : 'Turn on'} kind={here ? 'plain' : 'primary'} busy={busy} onPress={() => run(() => (here ? turnOff() : turnOn(s ?? {})), here ? 'Notifications off on this device' : 'Notifications on')} />
              {here && <Button title="Send a test" kind="plain" disabled={busy} onPress={() => run(async () => { const r = await sendTest(); toast(r.devices ? `Sent to ${r.devices} device${r.devices === 1 ? '' : 's'}` : 'No device took it; turn it off and on again'); })} />}
            </View>
          </>
        )}
        {devices.filter((d) => d.endpoint !== mine).map((d) => (
          <View key={d.id} style={styles.row}>
            <Ionicons name="phone-portrait-outline" size={16} color={t.muted} />
            <Text style={{ color: t.text, flex: 1 }} numberOfLines={1}>{d.device ?? 'Another device'}</Text>
            <Text style={{ color: t.muted, fontSize: 12 }}>{d.last_ok_at ? `last ${new Date(d.last_ok_at).toLocaleDateString()}` : 'nothing sent yet'}</Text>
            <Pressable onPress={() => run(() => removeDevice(d.id), 'Device removed')} hitSlop={8} accessibilityLabel={`Remove ${d.device ?? 'device'}`}><Ionicons name="close" size={18} color={t.muted} /></Pressable>
          </View>
        ))}
        {s && <Button title="Choose what’s sent" kind="plain" onPress={() => setOpen(true)} />}
      </Card>
      {open && s && <KindsSheet t={t} initial={s} onClose={() => { setOpen(false); reload(); }} />}
    </>
  );
}

function KindsSheet({ t, initial, onClose }: { t: Theme; initial: NotifySettings; onClose: () => void }) {
  const [s, setS] = useState<NotifySettings>(initial);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [looking, setLooking] = useState(false);
  // Saved a moment after the last change.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(s);
  const change = (patch: Partial<NotifySettings>) => setS((old) => {
    const next = { ...old, ...patch };
    latest.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; saveNotifySettings(next).catch((e) => toast(e instanceof Error ? e.message : String(e), { error: true })); }, 500);
    return next;
  });
  // Closed before the last change was saved: save it now.
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); saveNotifySettings(latest.current).catch(() => {}); } }, []);
  const setOn = (k: NotifyKind, v: boolean) => change({ on: { ...(s.on ?? {}), [k]: v } });
  const step = (k: keyof typeof NOTIFY_DEFAULTS, d: number, min: number, max: number) => change({ [k]: Math.max(min, Math.min(max, notifySetting(s, k) + d)) } as Partial<NotifySettings>);
  const radar = s.radarChecks ?? RADAR_NOTIFY_DEFAULT;
  const groups = [...new Set(NOTIFY_KINDS.map((k) => k.group))];

  const Stepper = ({ k, d = 1, min = 0, max = 99, text }: { k: keyof typeof NOTIFY_DEFAULTS; d?: number; min?: number; max?: number; text: (v: number) => string }) => (
    <View style={styles.stepper}>
      <Pressable onPress={() => step(k, -d, min, max)} hitSlop={6} accessibilityLabel="Less" style={[styles.stepBtn, { borderColor: t.line }]}><Ionicons name="remove" size={16} color={t.text} /></Pressable>
      <Text style={{ color: t.text, minWidth: 92, textAlign: 'center', fontVariant: ['tabular-nums'] }}>{text(notifySetting(s, k))}</Text>
      <Pressable onPress={() => step(k, d, min, max)} hitSlop={6} accessibilityLabel="More" style={[styles.stepBtn, { borderColor: t.line }]}><Ionicons name="add" size={16} color={t.text} /></Pressable>
    </View>
  );

  return (
    <Sheet title="What’s sent" onClose={onClose} footer={<Button title="Done" onPress={onClose} />}>
      {groups.map((g) => (
        <View key={g} style={{ gap: 10 }}>
          <Text style={[styles.h, { color: t.muted }]}>{g.toUpperCase()}</Text>
          {NOTIFY_KINDS.filter((k) => k.group === g).map((k) => (
            <View key={k.key} style={{ gap: 6 }}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text }}>{k.label}</Text>
                  <Text style={{ color: t.muted, fontSize: 12 }}>{k.about}</Text>
                </View>
                <Switch value={notifyOn(s, k.key)} onValueChange={(v) => setOn(k.key, v)} accessibilityLabel={k.label} />
              </View>
              {notifyOn(s, k.key) && k.key === 'bill' && <Stepper k="billDays" min={0} max={14} text={(v) => (v === 0 ? 'on the day' : `${v} day${v === 1 ? '' : 's'} before`)} />}
              {notifyOn(s, k.key) && k.key === 'low' && <Stepper k="lowDays" min={1} max={28} text={(v) => `${v} days ahead`} />}
              {notifyOn(s, k.key) && k.key === 'large' && <Stepper k="largeAmount" d={50} min={50} max={5000} text={(v) => `$${v} or more`} />}
              {notifyOn(s, k.key) && k.key === 'score' && <Stepper k="scoreDay" min={1} max={31} text={(v) => `on the ${v}${v === 1 || v === 21 || v === 31 ? 'st' : v === 2 || v === 22 ? 'nd' : v === 3 || v === 23 ? 'rd' : 'th'}`} />}
              {notifyOn(s, k.key) && k.key === 'radar' && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {RADAR_CHECKS.filter((c) => RADAR_PICK.includes(c.key)).map((c) => (
                    <Chip key={c.key} label={c.label} on={radar.includes(c.key)} onPress={() => change({ radarChecks: radar.includes(c.key) ? radar.filter((x) => x !== c.key) : [...radar, c.key] })} />
                  ))}
                </View>
              )}
            </View>
          ))}
        </View>
      ))}

      <Text style={[styles.h, { color: t.muted }]}>WHEN</Text>
      <View style={styles.row}><Text style={{ color: t.text, flex: 1 }}>Quiet from</Text><Stepper k="quietFrom" min={0} max={23} text={hourText} /></View>
      <View style={styles.row}><Text style={{ color: t.text, flex: 1 }}>Quiet until</Text><Stepper k="quietTo" min={0} max={23} text={hourText} /></View>
      <View style={styles.row}><Text style={{ color: t.text, flex: 1 }}>Morning ones from</Text><Stepper k="morning" min={0} max={23} text={hourText} /></View>
      <Text style={{ color: t.muted, fontSize: 12 }}>Nothing is sent in quiet hours; it waits until they end. Bills, low balances, the check-in and the like go out from the morning hour. The run is hourly, in the server’s time zone.</Text>
      <View style={styles.row}>
        <View style={{ flex: 1 }}><Text style={{ color: t.text }}>Everything in one notification</Text><Text style={{ color: t.muted, fontSize: 12 }}>Off: several of the same kind (banks to fix, bills due…) still come as one, with a line each</Text></View>
        <Switch value={!!s.digest} onValueChange={(v) => change({ digest: v })} accessibilityLabel="Everything in one notification" />
      </View>
      <View style={styles.row}>
        <View style={{ flex: 1 }}><Text style={{ color: t.text }}>Hide amounts</Text><Text style={{ color: t.muted, fontSize: 12 }}>Shows $••• instead, so they aren’t on the lock screen</Text></View>
        <Switch value={!!s.hideAmounts} onValueChange={(v) => change({ hideAmounts: v })} accessibilityLabel="Hide amounts" />
      </View>

      <Button title="What would be sent today" kind="plain" busy={looking} onPress={async () => {
        setLooking(true);
        try { await saveNotifySettings(s); setNotes(await preview()); } catch (e) { toast(e instanceof Error ? e.message : String(e), { error: true }); } finally { setLooking(false); }
      }} />
      {notes && (notes.length ? notes.map((n) => (
        <View key={n.key} style={{ gap: 1 }}>
          <Text style={{ color: t.text, fontSize: 13, fontWeight: '600' }}>{n.title}</Text>
          <Text style={{ color: t.muted, fontSize: 12 }}>{n.body}</Text>
        </View>
      )) : <Text style={{ color: t.muted, fontSize: 13 }}>Nothing today with these settings.</Text>)}
      {notes && notes.length > 0 && <Text style={{ color: t.muted, fontSize: 12 }}>Each is sent once, at its time; some may already have gone.</Text>}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  h: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, marginTop: 8 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  stepBtn: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
