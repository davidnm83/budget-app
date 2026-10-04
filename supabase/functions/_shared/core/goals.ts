// GENERATED from packages/core/src by `npm run sync-core`. Do not edit here.
/**
 * Goals (GOAL-1): saving up to an amount, or paying a loan or card down to nothing, with an
 * optional date. Progress, what's needed per month, and whether you're on pace.
 *
 * A savings goal counts either an account's balance or money you mark for it (contributions, and
 * spending from it for a fund that refills each year, IDEA-7). A payoff goal counts what's still
 * owed on its loan or card against what was owed when the goal started.
 */
import { addDays, daysBetween, type IsoDate } from './dates.ts';
import { round2 } from './money.ts';

export type GoalKind = 'save' | 'payoff';
export interface GoalInput {
  kind: GoalKind;
  /** Savings: the amount to reach. Payoff: ignored (the target is $0 owed). */
  target: number;
  targetDate: IsoDate | null;
  startDate: IsoDate;
  /** Savings: what was there when the goal started. Payoff: what was owed then. */
  startValue: number;
  /** Savings: what's there now. Payoff: what's owed now (positive). */
  current: number;
}
export interface GoalProgress {
  /** 0–1. */
  share: number;
  /** Still to save, or still owed. */
  left: number;
  done: boolean;
  /** Per month to finish by the date; null without a date, or once it's done or past. */
  perMonth: number | null;
  /** Where an even pace from the start to the date would have you today; null without a date. */
  expected: number | null;
  /** True on or ahead of an even pace; null without a date. */
  onPace: boolean | null;
  /** How far behind the even pace (in money), 0 when on pace. */
  behind: number;
  monthsLeft: number | null;
}

const DAYS_PER_MONTH = 30.44;

export function goalProgress(g: GoalInput, today: IsoDate): GoalProgress {
  const save = g.kind === 'save';
  // Savings run from startValue up to target; payoff runs from startValue (owed) down to 0.
  const from = save ? g.startValue : g.startValue, to = save ? g.target : 0;
  const span = to - from;
  const now = g.current;
  const left = save ? Math.max(0, g.target - now) : Math.max(0, now);
  const done = save ? now >= g.target - 0.005 : now <= 0.005;
  const share = done ? 1 : span === 0 ? 0 : Math.max(0, Math.min(1, (now - from) / span));
  let perMonth: number | null = null, expected: number | null = null, onPace: boolean | null = null, behind = 0, monthsLeft: number | null = null;
  if (g.targetDate) {
    const total = Math.max(1, daysBetween(g.startDate, g.targetDate));
    const gone = Math.max(0, Math.min(total, daysBetween(g.startDate, today)));
    expected = round2(from + span * (gone / total));
    const daysLeft = daysBetween(today, g.targetDate);
    monthsLeft = Math.max(0, Math.round((daysLeft / DAYS_PER_MONTH) * 10) / 10);
    if (!done && daysLeft > 0) perMonth = round2(left / Math.max(1, daysLeft / DAYS_PER_MONTH));
    const gap = save ? expected - now : now - expected; // positive = behind
    onPace = done || gap <= Math.max(1, Math.abs(span) * 0.01);
    behind = onPace ? 0 : round2(gap);
  }
  return { share, left: round2(left), done, perMonth, expected, onPace, behind, monthsLeft };
}

/**
 * A fund that refills each year (insurance, car repairs, gifts): once its date has passed, the
 * next one is a year later, and so on until it's in the future.
 */
export function nextRefillDate(targetDate: IsoDate, today: IsoDate): IsoDate {
  let d = targetDate;
  for (let i = 0; i < 100 && d < today; i++) d = `${Number(d.slice(0, 4)) + 1}${d.slice(4)}`;
  return d;
}

/** When a payoff goal with no date would finish at the current pace (months of history: owed then vs now). */
export function payoffDateAtPace(owedThen: number, owedNow: number, monthsBetween: number, today: IsoDate): IsoDate | null {
  const perMonth = (owedThen - owedNow) / Math.max(1, monthsBetween);
  if (perMonth <= 0 || owedNow <= 0) return null;
  return addDays(today, Math.ceil((owedNow / perMonth) * DAYS_PER_MONTH));
}
