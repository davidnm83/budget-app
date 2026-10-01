// Gig work data: shifts with their per-app parts, settings, and payout rules (shared by the Gig
// work page and the planner).
import type { PayoutRule, Shift, ShiftPart } from '@budget-app/core';
import { supabase } from './supabase';

export interface ShiftRow extends Shift {
  id: string; notes: string | null; source: string;
  fuelPrice: number | null; fuelEfficiency: number | null;
}

export interface GigSettings {
  cost_per_km: number | null; weekly_target: number | null;
  fuel_price: number | null; fuel_efficiency: number | null; plan_ahead: boolean;
}

const n = (v: any) => (v == null ? null : Number(v));

export async function loadShifts(from?: string): Promise<ShiftRow[]> {
  let q = supabase.from('gig_shifts')
    .select('*, parts:gig_shift_parts(platform, earnings, tips, active_minutes, deliveries)')
    .order('date', { ascending: false }).order('start_time', { ascending: false }).limit(5000);
  if (from) q = q.gte('date', from);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id, date: r.date, platform: r.platform, start: r.start_time, end: r.end_time, activeMinutes: r.active_minutes,
    deliveries: r.deliveries, earnings: Number(r.earnings), tips: n(r.tips), km: n(r.km), notes: r.notes, source: r.source ?? 'app',
    fuelCost: n(r.fuel_cost), fuelPrice: n(r.fuel_price), fuelEfficiency: n(r.fuel_efficiency),
    parts: ((r.parts ?? []) as any[]).map((p): ShiftPart => ({
      platform: p.platform, earnings: Number(p.earnings), tips: n(p.tips), activeMinutes: p.active_minutes, deliveries: p.deliveries,
    })),
  }));
}

export async function loadGigSettings(): Promise<GigSettings> {
  const { data } = await supabase.from('gig_settings').select('*').maybeSingle();
  return {
    cost_per_km: n(data?.cost_per_km), weekly_target: n(data?.weekly_target),
    fuel_price: n(data?.fuel_price), fuel_efficiency: n(data?.fuel_efficiency), plan_ahead: !!data?.plan_ahead,
  };
}

/** Gas cost per km: from L/100 km × $/L when both are set, otherwise the flat cost per km. */
export function costPerKm(s: GigSettings): number | null {
  if (s.fuel_efficiency && s.fuel_price) return Math.round((s.fuel_efficiency / 100) * s.fuel_price * 1000) / 1000;
  return s.cost_per_km;
}

export async function loadPayoutRules(): Promise<PayoutRule[]> {
  const { data } = await supabase.from('gig_platforms').select('*');
  return ((data ?? []) as any[]).map((r) => ({
    platform: r.platform, mode: r.payout_mode, weekday: r.payout_weekday, instantFee: Number(r.instant_fee ?? 0),
    accountId: r.account_id, matchText: r.match_text,
  }));
}

/** Saves a shift and replaces its per-app parts. Totals on the shift row are kept for older readers. */
export async function saveShift(id: string | undefined, row: Record<string, unknown>, parts: ShiftPart[]) {
  const sum = (f: (p: ShiftPart) => number | null | undefined) => parts.reduce((x, p) => x + (f(p) ?? 0), 0);
  const totals = {
    platform: parts.length === 1 ? parts[0].platform : 'multi',
    earnings: Math.round(sum((p) => p.earnings) * 100) / 100,
    tips: parts.some((p) => p.tips != null) ? Math.round(sum((p) => p.tips) * 100) / 100 : null,
    active_minutes: parts.some((p) => p.activeMinutes) ? sum((p) => p.activeMinutes) : null,
    deliveries: parts.some((p) => p.deliveries) ? sum((p) => p.deliveries) : null,
  };
  const res = id
    ? await supabase.from('gig_shifts').update({ ...row, ...totals }).eq('id', id).select('id').single()
    : await supabase.from('gig_shifts').insert({ ...row, ...totals }).select('id').single();
  if (res.error) throw new Error(res.error.message);
  const shiftId = res.data!.id;
  if (id) {
    const del = await supabase.from('gig_shift_parts').delete().eq('shift_id', shiftId);
    if (del.error) throw new Error(del.error.message);
  }
  const ins = await supabase.from('gig_shift_parts').insert(parts.map((p) => ({
    shift_id: shiftId, platform: p.platform, earnings: p.earnings, tips: p.tips ?? null, active_minutes: p.activeMinutes ?? null, deliveries: p.deliveries ?? null,
  })));
  if (ins.error) throw new Error(ins.error.message);
}
