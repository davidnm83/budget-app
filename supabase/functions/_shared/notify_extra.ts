// Notes some installs add of their own (the personal version's gig work). None here.
import type { Admin } from './supabase.ts';
import type { Note, NotifySettings } from './core/index.ts';

export async function extraNotes(_admin: Admin, _userId: string, _s: NotifySettings, _today: string, _hour: number): Promise<Note[]> {
  return [];
}
