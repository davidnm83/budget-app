/**
 * Credit cards: the statement cycle from its closing and due days, how much of the last
 * statement is still to pay, an interest estimate if it isn't paid in full, and utilisation.
 */
import { daysBetween, parseIso, toIso, type IsoDate } from './dates.ts';
import { round2 } from './money.ts';
import { planHeld, planSchedule, type PlanOnCard } from './plans.ts';

function onDay(y: number, m: number, day: number): IsoDate {
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return toIso(new Date(Date.UTC(y, m, Math.min(day, last))));
}

/** A closing date on a Saturday or Sunday moved to the Monday after. */
function weekday(iso: IsoDate): IsoDate {
  const d = parseIso(iso), w = d.getUTCDay();
  return w === 6 ? toIso(new Date(d.getTime() + 2 * 86_400_000)) : w === 0 ? toIso(new Date(d.getTime() + 86_400_000)) : iso;
}

/**
 * Last and next statement closing dates around `today`, the one before the last (`prevClose`), and the payment
 * due date for the last statement. `mondays`: the bank closes on the Monday when the day falls on a weekend.
 */
export function cardCycle(today: IsoDate, statementDay: number, dueDay: number, mondays = false) {
  const t = parseIso(today);
  const close = (y: number, m: number) => (mondays ? weekday(onDay(y, m, statementDay)) : onDay(y, m, statementDay));
  let y = t.getUTCFullYear(), m = t.getUTCMonth();
  let lastClose = close(y, m);
  if (lastClose > today) { m -= 1; if (m < 0) { m = 11; y -= 1; } lastClose = close(y, m); }
  const nextClose = close(y, m + 1);
  const prevClose = close(y, m - 1);
  const lc = parseIso(onDay(y, m, statementDay));
  // The due day comes after the close: same month if the day is later, otherwise next month.
  let due = onDay(lc.getUTCFullYear(), lc.getUTCMonth(), dueDay);
  if (due <= lastClose) due = onDay(lc.getUTCFullYear(), lc.getUTCMonth() + 1, dueDay);
  return { lastClose, nextClose, prevClose, due, cycleDays: daysBetween(lastClose, nextClose), daysToDue: daysBetween(today, due) };
}

/** The closing date before `close`: the same day a month earlier (a cycle's length back is close enough when the day is short). */
export function prevCloseOf(close: IsoDate, _cycleDays = 30): IsoDate {
  const c = parseIso(close);
  return onDay(c.getUTCFullYear(), c.getUTCMonth() - 1, c.getUTCDate());
}

/** Interest on a balance for some days at an annual rate in percent (simple daily interest). */
export function cardInterest(owed: number, aprPercent: number, days: number): number {
  return round2(Math.max(0, owed) * (aprPercent / 100 / 365) * days);
}

export function utilization(owed: number, limit: number | null | undefined): number | null {
  return limit && limit > 0 ? Math.max(0, owed) / limit : null;
}

export interface CardStatus {
  statementOwed: number;   // what you owed when the last statement closed
  paidSince: number;       // payments since then
  leftToPay: number;       // to pay in full by the due date
  spentThisCycle: number;  // charges since the statement closed
  interestIfUnpaid: number | null; // one cycle of interest on what's left, if APR is known
  /** An estimate of the minimum still to pay: on the whole statement, balance transfers included, less payments since. */
  minimumLeft?: number;
  /** The card's balance as the bank had it when the statement closed (what the statement prints as its new balance). */
  balanceAtClose?: number;
}

/** `owedNow` positive; txns in app sign (charges negative, payments positive). */
/** `deferred`: the part of the balance on payment plans that wasn't billed yet when the statement closed (see plansDeferred); a statement doesn't ask for it. */
export function cardStatus(owedNow: number, txns: { date: IsoDate; amount: number }[], lastClose: IsoDate, cycleDays: number, apr: number | null, deferred = 0): CardStatus {
  const after = txns.filter((t) => t.date > lastClose);
  const paidSince = round2(after.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0));
  const spentThisCycle = round2(-after.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0));
  const statementOwed = round2(Math.max(0, owedNow + paidSince - spentThisCycle - Math.max(0, deferred)));
  const leftToPay = round2(Math.max(0, statementOwed - paidSince));
  return { statementOwed, paidSince, leftToPay, spentThisCycle, interestIfUnpaid: apr ? cardInterest(leftToPay + spentThisCycle / 2, apr, cycleDays) : null };
}

/**
 * The card's statement with payment plans in it (option B). The balance when the statement closed
 * is worked back from today's; the part of it that was a plan not yet billed is left out, since a
 * statement doesn't ask for that. The purchase and the bank's plan credit are plan movements: they
 * count as neither spending nor payments, so a $1,800 plan credit no longer looks like a payment.
 */
export function cardStatement(owedNow: number, txns: { id?: string; date: IsoDate; amount: number; name?: string | null; importId?: string | null }[], lastClose: IsoDate, cycleDays: number, apr: number | null, plans: PlanOnCard[] = [],
  transfers: { held: number; moves: (string | null | undefined)[] } = { held: 0, moves: [] }, rule: MinimumRule = DEFAULT_MINIMUM, prevCloseAt?: IsoDate,
  /** The statement's balance as you entered it from the bank (a statement check), when there is one for this close. */
  stated?: number | null): CardStatus {
  // `transfers`: the promo balance transfers on this card that were already on it when the statement
  // closed (left out like a plan), and their charges (moved money, not spending).
  const moves = new Set([...plans.flatMap((p) => [p.purchaseTxnId, p.creditTxnId]), ...transfers.moves].filter(Boolean) as string[]);
  const after = txns.filter((t) => t.date > lastClose);
  const atClose = owedNow + after.reduce((s, t) => s + t.amount, 0);
  const held = plans.reduce((s, p) => s + planHeld(p, lastClose), 0) + Math.max(0, transfers.held);
  // Worked back from today's balance, which is only right once the bank feed has every transaction since the close.
  const worked = round2(Math.max(0, atClose - held));
  // The bank's own figure wins. It may be the new balance with plans in it, or the amount due without them: whichever
  // is nearer the worked-back one.
  const statementOwed = stated == null ? worked
    : round2(Math.max(0, [stated, stated - held].sort((a, b) => Math.abs(a - worked) - Math.abs(b - worked))[0]));
  const real = after.filter((t) => !(t.id && moves.has(t.id)));
  const paidSince = round2(real.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0));
  const spentThisCycle = round2(real.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0));
  const leftToPay = round2(Math.max(0, statementOwed - paidSince));
  // The interest and fees on this statement count toward the minimum for banks that add them.
  const prevClose = prevCloseAt ?? prevCloseOf(lastClose, cycleDays);
  const charges = rule.plusCharges ? statementCharges(txns, prevClose, lastClose) : 0;
  const billed = rule.plusPlans ? plansBilled(plans, prevClose, lastClose) : 0;
  const minimumLeft = round2(Math.max(0, minimumPayment(statementOwed + Math.max(0, transfers.held), rule, charges, billed) - paidSince));
  return { statementOwed, paidSince, leftToPay, spentThisCycle, minimumLeft, balanceAtClose: round2(Math.max(0, atClose)), interestIfUnpaid: apr ? cardInterest(leftToPay + spentThisCycle / 2, apr, cycleDays) : null };
}

/** Money in and out per month for the last `months` months (oldest first). */
export function monthlyFlow(txns: { date: IsoDate; amount: number }[], today: IsoDate, months: number) {
  const out: { month: IsoDate; in: number; out: number }[] = [];
  const t = parseIso(today);
  for (let k = months - 1; k >= 0; k--) {
    const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - k, 1));
    const month = toIso(d);
    const end = toIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
    const rows = txns.filter((x) => x.date >= month && x.date <= end);
    out.push({ month, in: round2(rows.filter((x) => x.amount > 0).reduce((s, x) => s + x.amount, 0)), out: round2(-rows.filter((x) => x.amount < 0).reduce((s, x) => s + x.amount, 0)) });
  }
  return out;
}


// ───────────── balance transfers ─────────────

/** Money moved from one card to another, usually at a low promo rate until `promoEnd`, for a fee. */
export interface BalanceTransfer {
  id: string;
  fromAccountId: string;   // the card paid off
  toAccountId: string;     // the card now carrying it
  amount: number;          // positive
  fee: number;             // positive, charged on the new card
  date: IsoDate;
  promoApr: number | null; // yearly %, while the promo lasts
  promoEnd: IsoDate | null;
  outTxnId?: string | null; inTxnId?: string | null; feeTxnId?: string | null;
}

export interface TransferProgress {
  /** Still on the new card from it: what that card owes, up to the amount moved and its fee. */
  remaining: number;
  daysLeft: number | null;
  monthsLeft: number | null;
  /** A month, to clear it before the promo rate ends. */
  perMonth: number | null;
  ended: boolean;
}

/**
 * What of these transfers to a card a statement closing on `lastClose` leaves out: the ones made by
 * then whose promo rate hadn't ended, at what's left of them. Plus their charges, which aren't spending.
 */
export function transfersOnStatement(list: BalanceTransfer[], owedOnTo: number, lastClose: IsoDate, today: IsoDate): { held: number; moves: (string | null | undefined)[] } {
  const held = list.filter((t) => t.date <= lastClose && (!t.promoEnd || t.promoEnd > lastClose))
    .reduce((s, t) => s + transferProgress(t, owedOnTo, today).remaining, 0);
  return { held: round2(Math.min(held, owedOnTo)), moves: list.map((t) => t.inTxnId) };
}

export function transferProgress(t: BalanceTransfer, owedOnTo: number, today: IsoDate): TransferProgress {
  const remaining = round2(Math.max(0, Math.min(owedOnTo, t.amount + t.fee)));
  if (!t.promoEnd) return { remaining, daysLeft: null, monthsLeft: null, perMonth: null, ended: false };
  const daysLeft = daysBetween(today, t.promoEnd);
  const monthsLeft = daysLeft <= 0 ? 0 : Math.max(1, Math.ceil(daysLeft / 30.44));
  return { remaining, daysLeft, monthsLeft, perMonth: monthsLeft ? round2(remaining / monthsLeft) : null, ended: daysLeft < 0 };
}

/**
 * The transactions of a balance transfer, among both cards' rows: the credit on the old card and the
 * charge on the new one for the amount (within 5 days of its date), and the fee on the new card
 * (within a month). Each null when not found yet.
 */
export function findTransferTxns<T extends { id: string; account_id: string; date: IsoDate; amount: number }>(t: BalanceTransfer, txns: T[], taken: Set<string> = new Set()) {
  const near = (r: T, days: number) => Math.abs(daysBetween(t.date, r.date)) <= days && !taken.has(r.id);
  const same = (a: number, b: number) => Math.abs(a - b) <= 0.01;
  const out = txns.find((r) => r.account_id === t.fromAccountId && same(r.amount, t.amount) && near(r, 5)) ?? null;
  const into = txns.find((r) => r.account_id === t.toAccountId && same(r.amount, -t.amount) && near(r, 5)) ?? null;
  const fee = t.fee > 0 ? txns.find((r) => r.account_id === t.toAccountId && same(r.amount, -t.fee) && near(r, 35) && r.id !== into?.id) ?? null : null;
  return { out, into, fee };
}

/**
 * How a card's minimum payment is worked out. Banks use a few shapes: a fixed amount plus the statement's
 * interest and fees ($10 + interest), a share of the balance with a floor (3%, at least $10), or a share
 * plus interest and fees. Some round up to the dollar. Cards with payment plans usually add the instalments
 * billed on the statement on top ($10 + interest and fees + the instalment). Never more than the balance.
 */
export interface MinimumRule {
  base: 'fixed' | 'percent';
  /** Dollars for 'fixed', percent of the balance for 'percent'. */
  amount: number;
  /** The interest and fees charged on the statement are added. */
  plusCharges: boolean;
  /** Never less than this (unless the balance is smaller). */
  floor: number;
  round: 'cent' | 'dollar';
  /** The payment plan instalments billed on the statement are added (after the floor). */
  plusPlans?: boolean;
}
/** The estimate used until a card's own rule is known. */
export const DEFAULT_MINIMUM: MinimumRule = { base: 'percent', amount: 3, plusCharges: false, floor: 10, round: 'cent' };

/**
 * A statement's minimum payment. `charges`: the interest and fees billed on that statement; `plans`: the
 * payment plan instalments billed on it (the purchase part; a plan's own interest and fees are charges).
 */
export function minimumPayment(balance: number, rule: MinimumRule = DEFAULT_MINIMUM, charges = 0, plans = 0): number {
  if (balance <= 0) return 0;
  const core = rule.base === 'fixed' ? rule.amount : (balance * rule.amount) / 100;
  let m = Math.max(rule.floor, core + (rule.plusCharges ? Math.max(0, charges) : 0)) + (rule.plusPlans ? Math.max(0, plans) : 0);
  m = rule.round === 'dollar' ? Math.ceil(round2(m)) : round2(m);
  return round2(Math.min(balance, m));
}

/** A rule in words: "$10 + interest and fees", "3% of the balance, at least $10". */
export function minimumRuleText(r: MinimumRule): string {
  const core = r.base === 'fixed' ? `$${r.amount}` : `${r.amount}% of the balance`;
  return `${core}${r.plusCharges ? ' + interest and fees' : ''}${r.plusPlans ? ' + payment plan instalments' : ''}${r.floor > 0 && !(r.base === 'fixed' && r.floor <= r.amount) ? `, at least $${r.floor}` : ''}${r.round === 'dollar' ? ', rounded up to the dollar' : ''}`;
}

/** A statement checked against the bank: its balance, the interest and fees on it, and the minimum the bank asked for. */
export interface MinimumCheck { close: IsoDate; balance: number; charges: number; minimum: number; /** Payment plan instalments billed on it. */ plans?: number }

/** The rules that give the bank's minimum on every check (to the cent), simplest first. */
export function fitMinimumRule(checks: MinimumCheck[]): MinimumRule[] {
  if (!checks.length) return [];
  const out: MinimumRule[] = [];
  const add = (r: MinimumRule) => { if (checks.every((c) => Math.abs(minimumPayment(c.balance, r, c.charges, c.plans ?? 0) - c.minimum) < 0.005)) out.push(r); };
  // Instalments are only worth trying when a check has some; then the rules with them come first.
  const withPlans = checks.some((c) => (c.plans ?? 0) > 0) ? [true, false] : [false];
  for (const plusPlans of withPlans) for (const round of ['cent', 'dollar'] as const) {
    for (const amount of [10, 15, 20, 25]) add({ base: 'fixed', amount, plusCharges: true, floor: amount, round, ...(plusPlans ? { plusPlans } : {}) });
    for (const plusCharges of [false, true]) for (const amount of [1, 1.25, 1.5, 2, 2.2, 2.5, 3, 3.5, 4, 5]) for (const floor of [10, 15, 20, 25, 0]) add({ base: 'percent', amount, plusCharges, floor, round, ...(plusPlans ? { plusPlans } : {}) });
  }
  return out;
}

/**
 * The payment plan instalments billed on a statement (dated after `prevClose`, up to `close`), as a statement shows
 * them: the purchase part with the plan's own interest and fees. Those are left out of `statementCharges`.
 */
export function plansBilled(plans: PlanOnCard[], prevClose: IsoDate, close: IsoDate): number {
  return round2(plans.flatMap((p) => planSchedule(p)).filter((x) => x.date > prevClose && x.date <= close).reduce((s, x) => s + x.total, 0));
}

/** Interest and fees billed on a statement: the card's charges between the two closing dates that say so (not a payment plan's own). */
export function statementCharges(txns: { date: IsoDate; amount: number; name?: string | null; importId?: string | null }[], prevClose: IsoDate, close: IsoDate): number {
  // A payment plan's own interest and fees (written by the app, import_id "plan:…") are part of its instalment.
  return round2(txns.filter((t) => t.date > prevClose && t.date <= close && t.amount < 0 && !t.importId?.startsWith('plan:') && /interest|int[ée]r[êe]t|\bfee\b|\bfees\b|frais|charge annuelle|annual/i.test(t.name ?? ''))
    .reduce((s, t) => s - t.amount, 0));
}

/** The balance from a statement check for the statement that closed on `lastClose` (a few days either way), if any. */
export function statedBalance(checks: { close: IsoDate; balance: number }[] | null | undefined, lastClose: IsoDate): number | null {
  const c = (checks ?? []).find((x) => Math.abs(daysBetween(x.close, lastClose)) <= 3);
  return c ? c.balance : null;
}
