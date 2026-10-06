// GENERATED from packages/core/src by `npm run sync-core`. Do not edit here.
/**
 * Notifications: what to send, and when. The server's hourly run loads each person's data, turns it into
 * notes with the composers below, then `pickNotes` keeps the ones that are switched on, not sent before
 * (by key) and due at this hour, and `toMessages` turns them into what the phone shows.
 *
 * Every note has a `key` built from what it is about (a bill and its date, an account and a day, a goal and
 * a milestone). A key is sent once; the next bill date, day or milestone is a new key.
 */
import { addDays, shortDate, type IsoDate } from './dates.ts';
import { formatMoney } from './money.ts';
import type { RadarCard, RadarCheck } from './radar.ts';
import type { WeekRow, WeekWarning } from './planner.ts';

export type NotifyKind = 'bank' | 'csv' | 'checkin' | 'bill' | 'low' | 'radar' | 'budget' | 'large' | 'subs' | 'goal' | 'goalpace' | 'review' | 'score' | 'shift';
export type NotifyGroup = 'Accounts and sync' | 'Bills and planner' | 'Spending' | 'Goals and reviews' | 'Gig work';

/** The kinds, in the order Settings lists them. `morning`: waits for the morning hour (or is sent as soon as it's found). */
export const NOTIFY_KINDS: { key: NotifyKind; group: NotifyGroup; label: string; about: string; on: boolean; morning: boolean }[] = [
  { key: 'bank', group: 'Accounts and sync', label: 'Bank connection needs fixing', about: 'Right after a sync fails', on: true, morning: false },
  { key: 'csv', group: 'Accounts and sync', label: 'CSV import due', about: 'At each sync time, for accounts the sync can’t reach', on: true, morning: false },
  { key: 'checkin', group: 'Accounts and sync', label: 'Daily check-in', about: 'Once a day after the morning sync: yesterday’s spending, bills coming, cash and its lowest point this week', on: false, morning: true },
  { key: 'bill', group: 'Bills and planner', label: 'Bill due soon', about: 'A few days before a bill is due, if it hasn’t been paid', on: true, morning: true },
  { key: 'low', group: 'Bills and planner', label: 'Low balance ahead', about: 'When the planner sees an account dropping below its buffer soon', on: true, morning: true },
  { key: 'radar', group: 'Spending', label: 'Radar alerts', about: 'When a Radar check you pick speaks up', on: true, morning: true },
  { key: 'budget', group: 'Spending', label: 'Budget nearly spent', about: 'A budget line passes 90% and 100%', on: false, morning: false },
  { key: 'large', group: 'Spending', label: 'Large transaction', about: 'Money out over an amount you set', on: false, morning: false },
  { key: 'subs', group: 'Spending', label: 'Subscription change', about: 'A price went up, a charge came twice, or a new one started', on: true, morning: true },
  { key: 'goal', group: 'Goals and reviews', label: 'Goal progress', about: 'When a goal reaches 25%, 50%, 75% and 100%', on: true, morning: false },
  { key: 'goalpace', group: 'Goals and reviews', label: 'Goal behind pace', about: 'Sundays, for goals with a date that are falling behind', on: false, morning: true },
  { key: 'review', group: 'Goals and reviews', label: 'Monthly review ready', about: 'The morning of the 1st', on: true, morning: true },
  { key: 'score', group: 'Goals and reviews', label: 'Log your credit score', about: 'Once a month, on a day you choose', on: false, morning: true },
];

/** What a person has set (user_prefs.notify). Anything missing takes its default. */
export interface NotifySettings {
  on?: Partial<Record<NotifyKind, boolean>>;
  /** Bill due soon: this many days ahead. */
  billDays?: number;
  /** Low balance ahead: looking this many days ahead. */
  lowDays?: number;
  /** Large transaction: money out of at least this much. */
  largeAmount?: number;
  /** Radar alerts: the checks that notify. */
  radarChecks?: RadarCheck[];
  /** Credit score reminder: this day of the month. */
  scoreDay?: number;
  /** Nothing is sent from `quietFrom` to `quietTo` (hours, 0–23); it waits until after. */
  quietFrom?: number; quietTo?: number;
  /** Morning notes go out from this hour. */
  morning?: number;
  /** Everything due in one run as one notification. */
  digest?: boolean;
  /** Amounts left out of what shows on the lock screen. */
  hideAmounts?: boolean;
}
/** Radar checks that already have a kind of their own aren't in Radar alerts. */
export const RADAR_NOTIFY_DEFAULT: RadarCheck[] = ['bill', 'pace', 'cards', 'runway', 'transfers'];
export const NOTIFY_DEFAULTS = { billDays: 2, lowDays: 7, largeAmount: 250, scoreDay: 1, quietFrom: 22, quietTo: 8, morning: 8 };

export const notifyOn = (s: NotifySettings, k: NotifyKind) => s.on?.[k] ?? NOTIFY_KINDS.find((x) => x.key === k)?.on ?? false;
const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? v : d);
export function notifySetting<K extends keyof typeof NOTIFY_DEFAULTS>(s: NotifySettings, k: K): number { return num(s[k], NOTIFY_DEFAULTS[k]); }

/** Inside quiet hours (which may run past midnight). */
export function isQuiet(hour: number, s: NotifySettings): boolean {
  const from = notifySetting(s, 'quietFrom'), to = notifySetting(s, 'quietTo');
  if (from === to) return false;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

export interface Note { key: string; kind: NotifyKind; title: string; body: string; url: string }

/** The notes to send now: switched on, not sent before, and due at this hour. */
export function pickNotes(notes: Note[], sent: Set<string>, hour: number, s: NotifySettings): Note[] {
  if (isQuiet(hour, s)) return [];
  const seen = new Set<string>();
  return notes.filter((n) => {
    if (!notifyOn(s, n.kind) || sent.has(n.key) || seen.has(n.key)) return false;
    if (NOTIFY_KINDS.find((k) => k.key === n.kind)?.morning && hour < notifySetting(s, 'morning')) return false;
    seen.add(n.key);
    return true;
  });
}

/** Amounts out: "$1,240.50", "−$35" become "$•••". */
export const hideAmounts = (text: string) => text.replace(/[−-]?\$\d[\d,]*(\.\d+)?/g, '$•••');

export interface PushMessage { title: string; body: string; url: string; tag: string }
/** The notes as the phone shows them: one each, or one digest. */
export function toMessages(notes: Note[], s: NotifySettings): PushMessage[] {
  const hide = (t: string) => (s.hideAmounts ? hideAmounts(t) : t);
  if (!notes.length) return [];
  if (s.digest && notes.length > 1) {
    return [{ title: `${notes.length} things today`, body: notes.map((n) => `• ${hide(n.title)}`).join('\n'), url: '/', tag: 'digest' }];
  }
  return notes.map((n) => ({ title: hide(n.title), body: hide(n.body), url: n.url, tag: n.key }));
}

const money = (n: number) => formatMoney(Math.round(Math.abs(n) * 100) / 100).replace(/\.00$/, '');
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayName = (d: IsoDate, today: IsoDate) => (d === today ? 'today' : d === addDays(today, 1) ? 'tomorrow' : WEEKDAY[new Date(d + 'T00:00:00Z').getUTCDay()]);

// ── Composers: each turns data the server loaded into notes. ──

export function noteBanks(items: { id: string; name: string; status: string }[], today: IsoDate): Note[] {
  return items.filter((i) => i.status !== 'ok').map((i) => ({
    key: `bank:${i.id}:${today}`, kind: 'bank' as const, url: '/settings',
    title: `${i.name} needs fixing`, body: i.status === 'login_required' ? 'The bank needs you to sign in again. Open Settings → Banks and tap Fix.' : 'The last sync failed. Open Settings → Banks to try again.',
  }));
}

/** Bills due in the next `days` days (today included) that haven't been paid. Card bills without a set amount say so. */
export function noteBills(rows: WeekRow[], today: IsoDate, days: number): Note[] {
  return rows.filter((r) => r.kind === 'planned' && r.item && !r.item.transfer && (r.planned ?? 0) < 0 && r.actual == null && r.date >= today && r.date <= addDays(today, days))
    .map((r) => ({
      key: `bill:${r.item!.key}`, kind: 'bill' as const, url: '/planner',
      title: `${r.description} ${r.planned ? money(r.planned) + ' ' : ''}due ${dayName(r.date, today)}`,
      body: `Planned for ${shortDate(r.date)}. Not paid yet.`,
    }));
}

/** The planner sees an account dipping below its buffer within `days` days. */
export function noteLow(warnings: WeekWarning[], accountName: (id: string) => string, today: IsoDate, days: number): Note[] {
  const first = new Map<string, WeekWarning>();
  for (const w of [...warnings].sort((a, b) => a.date.localeCompare(b.date))) if (w.date >= today && w.date <= addDays(today, days) && !first.has(w.accountId)) first.set(w.accountId, w);
  return [...first.values()].map((w) => ({
    key: `low:${w.accountId}:${w.date}`, kind: 'low' as const, url: '/planner',
    title: `${accountName(w.accountId)} dips to ${w.balance < 0 ? '−' : ''}${money(w.balance)} ${dayName(w.date, today)}`,
    body: `After “${w.cause}”${w.buffer > 0 ? `, below your ${money(w.buffer)} buffer` : ''}.`,
  }));
}

/** Radar cards from the checks picked for alerts. */
export function noteRadar(cards: RadarCard[], checks: RadarCheck[]): Note[] {
  return cards.filter((c) => checks.includes(c.check) && c.severity !== 'info').map((c) => ({ key: `radar:${c.id}`, kind: 'radar' as const, title: c.title, body: c.text, url: c.href }));
}
/** Subscription changes (the Radar's subscription cards). */
export function noteSubs(cards: RadarCard[]): Note[] {
  return cards.filter((c) => c.check === 'subs').map((c) => ({ key: `subs:${c.id}`, kind: 'subs' as const, title: c.title, body: c.text, url: c.href }));
}

/** Budget lines past 90% and 100% of what's available this month. */
export function noteBudget(lines: { key: string; label: string; actual: number; available: number }[], month: string, daysLeft: number): Note[] {
  const out: Note[] = [];
  for (const l of lines) {
    if (l.available <= 0) continue;
    const pct = l.actual / l.available;
    const step = pct >= 1 ? 100 : pct >= 0.9 ? 90 : 0;
    if (!step) continue;
    out.push({ key: `budget:${l.key}:${month}:${step}`, kind: 'budget', url: '/budget',
      title: step === 100 ? (l.actual > l.available + 0.5 ? `${l.label} is over budget` : `${l.label} is fully spent`) : `${l.label} at ${Math.round(pct * 100)}%`,
      body: `${money(l.actual)} of ${money(l.available)}${daysLeft > 0 ? ` with ${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : ''}.` });
  }
  return out;
}

export function noteLarge(txns: { id: string; date: IsoDate; amount: number; name: string; account: string }[], min: number): Note[] {
  return txns.filter((t) => t.amount <= -Math.abs(min)).map((t) => ({
    key: `large:${t.id}`, kind: 'large' as const, url: `/transaction/${t.id}`,
    title: `${money(t.amount)} at ${t.name}`, body: `${t.account} · ${shortDate(t.date)}`,
  }));
}

/** Goal milestones (25, 50, 75, 100%), and on Sundays the goals behind pace. */
export function noteGoals(goals: { id: string; name: string; pct: number; current: number; target: number; behind: number }[], today: IsoDate): Note[] {
  const out: Note[] = [];
  const sunday = new Date(today + 'T00:00:00Z').getUTCDay() === 0;
  for (const g of goals) {
    const step = [100, 75, 50, 25].find((s) => g.pct * 100 >= s);
    if (step) out.push({ key: `goal:${g.id}:${step}`, kind: 'goal', url: '/goals',
      title: step === 100 ? `${g.name}: reached!` : `${g.name} is ${step === 50 ? 'halfway' : `${step}% there`}`,
      body: `${money(g.current)} of ${money(g.target)}.` });
    if (sunday && g.behind > 1 && step !== 100) out.push({ key: `goalpace:${g.id}:${today}`, kind: 'goalpace', url: '/goals',
      title: `${g.name} is ${money(g.behind)} behind pace`, body: 'An even pace to its date would have it further along by now.' });
  }
  return out;
}

export function noteReview(today: IsoDate, lastMonthName: string): Note[] {
  return today.slice(8, 10) === '01' ? [{ key: `review:${today.slice(0, 7)}`, kind: 'review', url: '/?review=1', title: `${lastMonthName} in review`, body: 'Money in and out, budget lines that went over, and what to look at.' }] : [];
}
export function noteScore(today: IsoDate, day: number): Note[] {
  const last = Number(new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate());
  return Number(today.slice(8, 10)) === Math.min(day, last) ? [{ key: `score:${today.slice(0, 7)}`, kind: 'score', url: '/credit', title: 'Time to log your credit score', body: 'Add this month’s score on the Credit cards page.' }] : [];
}
export function noteCsv(accounts: string[], since: string): Note[] {
  return accounts.length ? [{ key: `csv:${since}`, kind: 'csv', url: '/import', title: `${accounts.length} account${accounts.length === 1 ? ' needs' : 's need'} a CSV`, body: accounts.slice(0, 4).join(', ') + (accounts.length > 4 ? '…' : '') }] : [];
}

/** The daily check-in: yesterday's spending, bills coming, cash now and its lowest point this week, transactions to review. */
export function noteCheckin(today: IsoDate, d: { spentYesterday: number; billsSoon: { name: string; amount: number; date: IsoDate }[]; cash: number; lowest: { balance: number; date: IsoDate } | null; toReview: number }): Note[] {
  const parts = [`Yesterday ${money(d.spentYesterday)} spent`];
  if (d.billsSoon.length) parts.push(`${d.billsSoon.length} bill${d.billsSoon.length === 1 ? '' : 's'} by ${dayName(d.billsSoon[d.billsSoon.length - 1].date, today)} (${money(d.billsSoon.reduce((s, b) => s + b.amount, 0))})`);
  parts.push(`cash ${money(d.cash)}${d.lowest && d.lowest.balance < d.cash - 0.5 ? `, lowest ${d.lowest.balance < 0 ? '−' : ''}${money(d.lowest.balance)} ${dayName(d.lowest.date, today)}` : ''}`);
  if (d.toReview) parts.push(`${d.toReview} to review`);
  return [{ key: `checkin:${today}`, kind: 'checkin', url: '/', title: 'Today', body: parts.join(' · ') }];
}
