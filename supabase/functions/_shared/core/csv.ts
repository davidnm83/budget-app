// GENERATED from packages/core/src by `npm run sync-core`. Do not edit here.
/**
 * Bank CSV import for accounts Plaid can't reach.
 * Known formats: Rogers Bank Mastercard, PC Financial Mastercard. Anything else
 * with date + description + amount (or debit/credit) columns also works,
 * including headerless CIBC-style files (date, description, debit, credit).
 */
import { parseMoney, round2 } from './money.ts';
import { daysBetween, toIsoDate, type IsoDate } from './dates.ts';

export interface CsvRow {
  date: IsoDate;
  name: string;
  amount: number; // app sign: spending negative
}

export interface ParsedCsv {
  format: 'rogers' | 'pcf' | 'headerless' | 'generic';
  label: string;
  rows: CsvRow[];
  skipped: number;
}

/** Minimal RFC 4180 CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let f = '';
  let q = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') { f += '"'; i++; }
      else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(f); rows.push(row); row = []; f = '';
    } else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export function parseBankCsv(text: string): ParsedCsv {
  const data = parseCsvText(text);
  if (!data.length) throw new Error('That file is empty.');
  const head = data[0].map((h) => h.trim().toLowerCase());
  const col = (re: RegExp) => head.findIndex((h) => re.test(h));
  const rows: CsvRow[] = [];
  let skipped = 0;
  const push = (date: unknown, name: unknown, amount: number) => {
    const iso = toIsoDate(date);
    const n = String(name ?? '').trim();
    if (!iso || isNaN(amount) || !n) { skipped++; return; }
    rows.push({ date: iso, name: n, amount: round2(amount) });
  };

  if (head.includes('merchant name') && head.includes('activity status')) {
    const d = head.indexOf('date'), n = head.indexOf('merchant name'), a = head.indexOf('amount'), st = head.indexOf('activity status');
    for (const r of data.slice(1)) {
      if (/pend|declin/i.test(r[st] ?? '')) { skipped++; continue; }
      push(r[d], r[n], -parseMoney(r[a])); // Rogers lists purchases as positive
    }
    return { format: 'rogers', label: 'Rogers Bank', rows, skipped };
  }
  if (head.includes('description') && head.includes('card holder name') && head.includes('amount')) {
    const d = head.indexOf('date'), n = head.indexOf('description'), a = head.indexOf('amount');
    for (const r of data.slice(1)) push(r[d], r[n], parseMoney(r[a]));
    return { format: 'pcf', label: 'PC Financial', rows, skipped };
  }
  if (toIsoDate(data[0][0])) {
    for (const r of data) push(r[0], r[1], (parseMoney(r[3]) || 0) - (parseMoney(r[2]) || 0));
    return { format: 'headerless', label: 'Headerless (date, description, debit, credit)', rows, skipped };
  }
  let d = col(/^(transaction )?date$/);
  if (d < 0) d = col(/date/);
  const n = col(/description|merchant|payee|details|name|memo/);
  const a = col(/^amount|amount$/);
  const debit = col(/debit|withdrawal/);
  const credit = col(/credit|deposit/);
  if (d < 0 || n < 0 || (a < 0 && debit < 0 && credit < 0)) {
    throw new Error('Could not find date, description and amount columns in: ' + data[0].join(', '));
  }
  for (const r of data.slice(1)) {
    const amount = a >= 0 ? parseMoney(r[a]) : (parseMoney(r[credit]) || 0) - (parseMoney(r[debit]) || 0);
    push(r[d], r[n], amount);
  }
  return { format: 'generic', label: 'Generic', rows, skipped };
}

/**
 * Splits CSV rows into new ones and ones already in the account. A row counts as
 * already there when an existing transaction has the same amount within
 * `toleranceDays` (banks' exports often shift a date by a day). Each existing
 * transaction can only cancel one CSV row; the closest date wins.
 */
export function dedupeAgainstExisting(
  rows: CsvRow[],
  existing: { date: IsoDate; amount: number }[],
  toleranceDays = 3,
): { add: CsvRow[]; duplicates: CsvRow[] } {
  const pool = new Map<string, { date: IsoDate; used: boolean }[]>();
  for (const e of existing) {
    const k = e.amount.toFixed(2);
    (pool.get(k) ?? pool.set(k, []).get(k)!).push({ date: e.date, used: false });
  }
  const add: CsvRow[] = [];
  const duplicates: CsvRow[] = [];
  for (const r of [...rows].sort((x, y) => x.date.localeCompare(y.date))) {
    const list = pool.get(r.amount.toFixed(2)) ?? [];
    let best: { date: IsoDate; used: boolean } | null = null;
    for (const e of list) {
      const diff = Math.abs(daysBetween(e.date, r.date));
      if (!e.used && diff <= toleranceDays && (!best || diff < Math.abs(daysBetween(best.date, r.date)))) best = e;
    }
    if (best) { best.used = true; duplicates.push(r); } else add.push(r);
  }
  return { add, duplicates };
}
