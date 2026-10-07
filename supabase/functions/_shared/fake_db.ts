// A tiny stand-in for the supabase-js query builder, for the function tests (only what they use).
export type Row = Record<string, any>;
export function fakeDb(tables: Record<string, Row[]>) {
  let idSeq = 0;
  const from = (name: string) => {
    tables[name] ??= [];
    const filters: ((r: Row) => boolean)[] = [];
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: any = null;
    let order: { col: string; asc: boolean } | null = null;
    let limit = Infinity;
    let tooMany = false;
    let single = false;
    let returning = false;
    let conflict: string | null = null;
    let ignore = false;
    let skip = 0, count = false, head = false;
    const run = () => {
      const t = tables[name];
      // Like the real server: a lookup with too many ids in it is refused.
      if (op === 'select' && tooMany) return { data: null, error: { message: 'URI too long' } };
      if (op === 'insert') {
        // On a clash: left alone (ignoreDuplicates) or brought up to date, like the real upsert.
        const keys = conflict?.split(',') ?? [];
        const clash = (r: Row) => (keys.length ? t.find((x) => keys.every((k) => x[k] === r[k])) : undefined);
        const fresh = (Array.isArray(payload) ? payload : [payload]).filter((r: Row) => { const x = clash(r); if (x && !ignore) Object.assign(x, r); return !x; });
        const rows = fresh.map((r: Row) => ({ id: `${name}-${++idSeq}`, ...r }));
        t.push(...rows);
        return { data: returning ? (single ? rows[0] : rows) : null, error: null };
      }
      let rows = t.filter((r) => filters.every((f) => f(r)));
      if (op === 'update') { rows.forEach((r) => Object.assign(r, payload)); return { data: null, error: null }; }
      if (op === 'delete') { tables[name] = t.filter((r) => !rows.includes(r)); return { data: null, error: null }; }
      if (order) rows = [...rows].sort((a, b) => (a[order!.col] < b[order!.col] ? 1 : -1) * (order!.asc ? -1 : 1));
      if (count) return { data: head ? null : rows, count: rows.length, error: null };
      rows = rows.slice(skip, Math.min(rows.length, skip + limit));
      return { data: single ? rows[0] ?? null : rows, error: null };
    };
    const q: any = {
      select: (_c?: string, o?: { count?: string; head?: boolean }) => { if (op !== 'select') returning = true; if (o?.count) { count = true; head = !!o.head; } return q; },
      insert: (p: any) => { op = 'insert'; payload = p; return q; },
      upsert: (p: any, o: { onConflict: string; ignoreDuplicates?: boolean }) => { op = 'insert'; payload = p; conflict = o.onConflict; ignore = !!o.ignoreDuplicates; return q; },
      update: (p: any) => { op = 'update'; payload = p; return q; },
      delete: () => { op = 'delete'; return q; },
      eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return q; },
      is: (c: string, v: any) => { filters.push((r) => (r[c] ?? null) === v); return q; },
      gte: (c: string, v: any) => { filters.push((r) => r[c] >= v); return q; },
      gt: (c: string, v: any) => { filters.push((r) => r[c] > v); return q; },
      lt: (c: string, v: any) => { filters.push((r) => r[c] < v); return q; },
      lte: (c: string, v: any) => { filters.push((r) => r[c] <= v); return q; },
      in: (c: string, v: any[]) => { if (v.length > 100) tooMany = true; filters.push((r) => v.includes(r[c])); return q; },
      not: (c: string, _o: string, _v: any) => { filters.push((r) => r[c] != null); return q; },
      order: (col: string, o?: { ascending: boolean }) => { order = { col, asc: o?.ascending ?? true }; return q; },
      limit: (n: number) => { limit = n; return q; },
      range: (a: number, b: number) => { skip = a; limit = b - a + 1; return q; },
      ilike: (c: string, p: string) => { const re = new RegExp('^' + p.split('%').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i'); filters.push((r) => re.test(String(r[c] ?? ''))); return q; },
      neq: (c: string, v: any) => { filters.push((r) => r[c] !== v); return q; },
      or: (_f: string) => q, // date windows: the stand-in keeps every row
      maybeSingle: () => { single = true; return q; },
      single: () => { single = true; return q; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    return q;
  };
  return { from, rpc: async (_fn: string, _args: any) => ({ data: 'access-token', error: null }) } as any;
}

