/**
 * Monthly review (IDEA-13), subscription audit (IDEA-8) and nightly backup retention (PLT-8):
 * small pure pieces the app and the Edge Functions share.
 */
import { addDays, daysBetween, shortDate, type IsoDate } from './dates.ts';
import { formatMoney } from './money.ts';
import { normalizeDescription } from './merchants.ts';
import type { RadarCard } from './radar.ts';

const money = (n: number) => formatMoney(Math.round(Math.abs(n) * 100) / 100);

/** The categories whose spending changed most between two months (by dollars), largest first. */
export function biggestChanges(
  cats: { id: string; name: string }[], now: Map<string, number>, before: Map<string, number>, n = 5, min = 20,
): { id: string; name: string; now: number; before: number; change: number }[] {
  return cats
    .map((c) => ({ id: c.id, name: c.name, now: now.get(c.id) ?? 0, before: before.get(c.id) ?? 0 }))
    .map((r) => ({ ...r, change: r.now - r.before }))
    .filter((r) => Math.abs(r.change) >= min)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, n);
}

// ───────────── subscription audit ─────────────

export interface Charge { id: string; date: IsoDate; amount: number; name: string; merchant: string | null; account_id: string }
const who = (t: Charge) => (t.merchant || normalizeDescription(t.name).split(' ').slice(0, 3).join(' ')).trim();

/**
 * Subscriptions from card and bank charges: the same merchant charging about monthly (or yearly)
 * at a fixed price. Three checks, each a Radar card:
 * - the price went up (the last charge is above the steady earlier ones);
 * - a double charge (twice within a week at the usual price);
 * - a new subscription (it started in the last ~2 months).
 * Whether a subscription is still used can't be told from bank data, so that isn't checked.
 */
export function radarSubscriptions(charges: Charge[], today: IsoDate): RadarCard[] {
  const groups = new Map<string, Charge[]>();
  for (const c of charges) {
    if (c.amount >= 0) continue;
    const w = who(c).toLowerCase();
    if (!w) continue;
    (groups.get(w) ?? groups.set(w, []).get(w)!).push(c);
  }
  const out: RadarCard[] = [];
  for (const [key, list] of groups) {
    const rows = [...list].sort((a, b) => a.date.localeCompare(b.date));
    if (rows.length < 2) continue;
    const name = who(rows[rows.length - 1]);
    const amt = (c: Charge) => Math.round(-c.amount * 100) / 100;
    // Monthly or yearly rhythm, judged on the gaps between charges at least 20 days apart.
    const spaced = rows.filter((r, i) => i === 0 || daysBetween(rows[i - 1].date, r.date) >= 20);
    const gaps = spaced.slice(1).map((r, i) => daysBetween(spaced[i].date, r.date));
    if (!gaps.length) continue;
    const monthly = gaps.filter((g) => g >= 26 && g <= 35).length >= Math.max(1, gaps.length * 0.6);
    const yearly = !monthly && gaps.filter((g) => g >= 350 && g <= 380).length >= 1;
    if (!monthly && !yearly) continue;
    const last = spaced[spaced.length - 1];
    if (daysBetween(last.date, today) > (monthly ? 45 : 400)) continue; // it stopped
    const earlier = spaced.slice(0, -1).map(amt);
    const steady = earlier.length >= 2 && Math.max(...earlier) - Math.min(...earlier) <= Math.max(0.02, Math.min(...earlier) * 0.01);

    // Price went up.
    if (steady && daysBetween(last.date, today) <= 45) {
      const was = earlier[earlier.length - 1], now = amt(last);
      if (now - was >= Math.max(0.5, was * 0.02)) {
        out.push({ id: `sub-up:${key}:${now}`, check: 'subs', severity: 'heads', stake: (now - was) * (monthly ? 12 : 1), href: '/transactions',
          title: `${name} went up to ${money(now)}`,
          text: `It was ${money(was)} ${monthly ? 'a month' : 'a year'}; ${money(now - was)} more on ${shortDate(last.date)}, about ${money((now - was) * (monthly ? 12 : 1))} a year.` });
      }
    }
    // Double charge: two at the usual price within 7 days, recently.
    if (monthly) {
      const usual = earlier.length ? earlier[earlier.length - 1] : amt(last);
      for (let i = 1; i < rows.length; i++) {
        const a = rows[i - 1], b = rows[i];
        if (daysBetween(b.date, today) > 40 || daysBetween(a.date, b.date) > 7) continue;
        if (Math.abs(amt(a) - usual) <= 0.02 && Math.abs(amt(b) - usual) <= 0.02) {
          out.push({ id: `sub-dup:${key}:${b.date}`, check: 'subs', severity: 'act', stake: usual, href: '/transactions',
            title: `${name} charged twice`,
            text: `${money(usual)} on ${shortDate(a.date)} and again on ${shortDate(b.date)}. If that’s a mistake, ask them for a refund.` });
        }
      }
    }
    // New: first seen in the last ~70 days, with no earlier charge from it in the past year.
    if (monthly && daysBetween(rows[0].date, today) <= 70 && spaced.length >= 2) {
      out.push({ id: `sub-new:${key}`, check: 'subs', severity: 'info', stake: amt(last) * 12, href: '/transactions',
        title: `New subscription: ${name}`,
        text: `${money(amt(last))} a month since ${shortDate(rows[0].date)}, about ${money(amt(last) * 12)} a year.` });
    }
  }
  return out;
}

// ───────────── nightly backup ─────────────

/**
 * Which nightly backups to keep: the last `daily` days, and the first one of each of the last
 * `monthly` months. Takes the dates of the backups there are; returns those to delete.
 */
export function backupsToDelete(dates: IsoDate[], today: IsoDate, daily = 7, monthly = 12): IsoDate[] {
  const keep = new Set<IsoDate>();
  const sorted = [...new Set(dates)].sort();
  for (const d of sorted) if (d > addDays(today, -daily)) keep.add(d);
  const firstOfMonth = new Map<string, IsoDate>();
  for (const d of sorted) if (!firstOfMonth.has(d.slice(0, 7))) firstOfMonth.set(d.slice(0, 7), d);
  const months = [...firstOfMonth.keys()].sort().slice(-monthly);
  for (const m of months) keep.add(firstOfMonth.get(m)!);
  return sorted.filter((d) => !keep.has(d));
}
