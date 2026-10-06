// Each card's own minimum-payment rule (accounts.minimum_rule), worked out from statements checked
// against the bank (accounts.minimum_checks). Cards without one use the app's estimate.
import { DEFAULT_MINIMUM, fitMinimumRule, type MinimumCheck, type MinimumRule } from '@budget-app/core';
import { supabase } from './supabase';

export interface CardMinimum { rule: MinimumRule | null; checks: MinimumCheck[] }

/** Every card's rule and checks, by account id. Empty before the migration has run. */
export async function loadMinimums(): Promise<Map<string, CardMinimum>> {
  const out = new Map<string, CardMinimum>();
  const { data, error } = await supabase.from('accounts').select('id, minimum_rule, minimum_checks').eq('type', 'credit');
  if (error) return out;
  for (const r of (data ?? []) as any[]) out.set(r.id, { rule: r.minimum_rule ?? null, checks: Array.isArray(r.minimum_checks) ? r.minimum_checks : [] });
  return out;
}
export const ruleFor = (m: Map<string, CardMinimum>, id: string): MinimumRule => m.get(id)?.rule ?? DEFAULT_MINIMUM;

/**
 * Adds a statement checked against the bank (replacing an earlier check of the same statement) and works
 * out the rules that fit them all. Saves the first fit, or the one picked; with none, only the check is kept.
 */
export async function addCheck(accountId: string, had: CardMinimum, check: MinimumCheck, pick?: MinimumRule): Promise<{ fits: MinimumRule[]; saved: MinimumRule | null }> {
  const checks = [...had.checks.filter((c) => c.close !== check.close), check].sort((a, b) => a.close.localeCompare(b.close)).slice(-6);
  let fits = fitMinimumRule(checks);
  // An older check that no longer fits (the bank changed its rule) gives way to the newer ones.
  let kept = checks;
  while (!fits.length && kept.length > 1) { kept = kept.slice(1); fits = fitMinimumRule(kept); }
  const saved = pick ?? fits[0] ?? had.rule ?? null;
  const { error } = await supabase.from('accounts').update({ minimum_checks: kept, minimum_rule: saved }).eq('id', accountId);
  if (error) throw new Error(error.message);
  return { fits, saved };
}

export async function resetMinimum(accountId: string): Promise<void> {
  const { error } = await supabase.from('accounts').update({ minimum_rule: null, minimum_checks: null }).eq('id', accountId);
  if (error) throw new Error(error.message);
}
