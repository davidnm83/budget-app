// Credit scores (VIEW-11): the log, and its lines by month. Each bureau is its own line: Equifax
// (Borrowell) and TransUnion (most bank apps) score differently, so one line through both would
// jump between them. A score stands until the next one from the same bureau.
import { monthEnd } from '@budget-app/core';
import { supabase } from './supabase';

export interface Score { id: string; date: string; score: number; bureau: 'Equifax' | 'TransUnion' | 'Other'; note: string | null }
export const BUREAUS: Score['bureau'][] = ['Equifax', 'TransUnion', 'Other'];

export async function loadScores(): Promise<{ scores: Score[]; error: string }> {
  const { data, error } = await supabase.from('credit_scores').select('id, date, score, bureau, note').order('date');
  if (error) return { scores: [], error: /credit_scores/.test(error.message) ? 'The credit score log needs the newest database update (supabase db push).' : error.message };
  return { scores: (data ?? []) as Score[], error: '' };
}

/**
 * One line per bureau over the given months (first days): the latest score logged by the end of each
 * month, nothing (NaN, a gap) before that bureau's first score. Bureaus with no score in range are left out.
 */
export function scoreLines(scores: Score[], months: string[], only?: Score['bureau'][]): { name: string; values: number[] }[] {
  const out: { name: string; values: number[] }[] = [];
  for (const b of BUREAUS) {
    if (only?.length && !only.includes(b)) continue;
    const mine = scores.filter((s) => s.bureau === b).sort((x, y) => x.date.localeCompare(y.date));
    if (!mine.length) continue;
    const values = months.map((m) => { const end = monthEnd(m as any); const last = [...mine].reverse().find((s) => s.date <= end); return last ? last.score : NaN; });
    if (values.some(Number.isFinite)) out.push({ name: b, values });
  }
  return out;
}
