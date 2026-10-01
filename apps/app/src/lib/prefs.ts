// Layout choices kept per user: Home and Budget widgets (in order) and the spending watch list.
import { supabase } from './supabase';

export interface Prefs { home_widgets: string[] | null; budget_widgets: string[] | null; watch_categories: string[] | null }

export async function loadPrefs(): Promise<Prefs> {
  const { data } = await supabase.from('user_prefs').select('home_widgets, budget_widgets, watch_categories').maybeSingle();
  return { home_widgets: data?.home_widgets ?? null, budget_widgets: data?.budget_widgets ?? null, watch_categories: data?.watch_categories ?? null };
}

export async function savePrefs(patch: Partial<Prefs>) {
  const { error } = await supabase.from('user_prefs').upsert({ ...patch, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}
