// AI features (IDEA-12), on the Claude API with the owner's key (the ANTHROPIC_API_KEY secret):
//  • Reading a receipt photo: Claude Haiku 5.5 first; a reading that doesn't add up (receiptAddsUp) is read again
//    by Claude Sonnet 5.5.
//  • Asking about your money: a chat that answers from your own data through read-only lookups (tools). The lookups
//    run with the person's own sign-in, so row-level security applies; nothing here can change data.
import Anthropic from 'npm:@anthropic-ai/sdk@0.131';
import type { Admin } from './supabase.ts';
import {
  addDays, addMonths, balanceAt, buildBudgetMonth, buildWeek, expandPlan, monthEnd, monthOf, receiptAddsUp, round2,
  type PostedTxn, type ReadReceipt,
} from './core/index.ts';

export const MODELS = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5' } as const;
export type ModelChoice = keyof typeof MODELS;
/** Only what the code here uses of the SDK client, so the tests can stand in for it. */
export type Claude = { messages: { create: (p: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message> } };

/** The client, or null when no key is set (the app then hides these features). */
export function claude(): Claude | null {
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  return key ? new Anthropic({ apiKey: key }) : null;
}

const textOf = (m: Anthropic.Message) => m.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');

// ── Receipts ──

const money = { anyOf: [{ type: 'number' }, { type: 'null' }] };
const RECEIPT_SCHEMA = {
  type: 'object',
  properties: {
    merchant: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'The store or business name, as a person would say it (e.g. "No Frills", not the legal name).' },
    date: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Purchase date as YYYY-MM-DD.' },
    total: { ...money, description: 'The total paid, positive.' },
    tax: { ...money, description: 'Total tax (HST/GST/PST), positive, or null if none shown.' },
    items: {
      type: 'array',
      description: 'Each purchased line with its price, positive; discounts and coupons as negative lines. Leave out subtotal, tax, total, payment and change lines.',
      items: { type: 'object', properties: { name: { type: 'string' }, amount: { type: 'number' } }, required: ['name', 'amount'], additionalProperties: false },
    },
    legible: { type: 'boolean', description: 'False if the photo is too blurry, cut off or dark to read the total with confidence.' },
  },
  required: ['merchant', 'date', 'total', 'tax', 'items', 'legible'],
  additionalProperties: false,
};

async function readOnce(client: Claude, model: ModelChoice, jpegBase64: string, today: string): Promise<ReadReceipt | null> {
  const res = await client.messages.create({
    model: MODELS[model],
    max_tokens: 8000,
    output_config: { effort: model === 'haiku' ? 'low' : 'medium', format: { type: 'json_schema', schema: RECEIPT_SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpegBase64 } },
        { type: 'text', text: `Read this receipt. Today is ${today}; if the receipt's date has no year, it is the most recent such date on or before today.` },
      ],
    }],
  });
  if (res.stop_reason !== 'end_turn') return null; // refused, or ran out of room
  try {
    const r = JSON.parse(textOf(res));
    return { merchant: r.merchant ?? null, date: /^\d{4}-\d{2}-\d{2}$/.test(r.date ?? '') ? r.date : null, total: r.total ?? null, tax: r.tax ?? null,
      items: Array.isArray(r.items) ? r.items.map((i: any) => ({ name: String(i.name), amount: round2(Number(i.amount)) })) : [], legible: !!r.legible };
  } catch {
    return null;
  }
}

/** Reads a receipt photo: Haiku first, then Sonnet when Haiku's reading can't be trusted. */
export async function readReceipt(client: Claude, jpegBase64: string, today: string): Promise<{ receipt: ReadReceipt | null; model: ModelChoice }> {
  const quick = await readOnce(client, 'haiku', jpegBase64, today);
  if (quick && receiptAddsUp(quick)) return { receipt: quick, model: 'haiku' };
  const careful = await readOnce(client, 'sonnet', jpegBase64, today);
  // Sonnet's reading even when it doesn't add up either (a faded total); the app shows it to check.
  return { receipt: careful ?? quick, model: careful ? 'sonnet' : 'haiku' };
}

// ── Asking about your money ──

const SYSTEM = `You are the assistant inside a personal budgeting app. You answer questions about the user's own money: spending, income, budgets, accounts and cards, upcoming bills, and money people owe them.

Answer from the lookup tools, never from memory or guesses: every amount you state must come from a tool result. If the tools can't answer something, say so plainly. You can't change anything in the app; if the user asks you to, tell them where in the app to do it.

How the app's data works:
- Amounts: money out is negative, money in positive. Card and loan balances are what's owed.
- Transfers between the user's own accounts, card payments, "Payment plan" and "Money owed" lines don't count as spending or income.
- Months are calendar months. "This month" is the month of today's date, which each question includes.

Write briefly, in plain language, as you would in a chat: a direct answer first, then only the figures that support it. Use dollar amounts with two decimals. No headings; a short list is fine when comparing several things.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'find_transactions',
    description: 'Search transactions between two dates (inclusive). Optional filters narrow it down. Returns the matching transactions (newest first, at most `limit`), how many matched, and their total.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'YYYY-MM-DD' },
        to: { type: 'string', description: 'YYYY-MM-DD' },
        text: { type: 'string', description: 'Words in the merchant or bank description, e.g. "uber".' },
        category: { type: 'string', description: 'Category name, e.g. "Groceries".' },
        account: { type: 'string', description: 'Account name, or part of it.' },
        direction: { type: 'string', enum: ['out', 'in', 'any'] },
        limit: { type: 'integer', description: 'Most to list (default 25, at most 100).' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'spending_by_category',
    description: 'Totals per category between two dates (inclusive), splits counted by their own category, transfers left out. kind "expense" gives spending (as positive numbers), "income" gives income.',
    input_schema: {
      type: 'object',
      properties: { from: { type: 'string' }, to: { type: 'string' }, kind: { type: 'string', enum: ['expense', 'income'] } },
      required: ['from', 'to', 'kind'],
    },
  },
  {
    name: 'budget',
    description: "A month's budget: for each budget line, what was budgeted, spent so far, and what's left (available).",
    input_schema: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM' } }, required: ['month'] },
  },
  {
    name: 'accounts',
    description: "Every account with its balance today: cash accounts, credit cards (owed and limit), loans and investments.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'upcoming',
    description: "The planner for the coming days: bills and income planned on the accounts in the plan, whether they've been paid, and any day an account dips below its buffer.",
    input_schema: { type: 'object', properties: { days: { type: 'integer', description: 'How far ahead (default 14, at most 60).' } } },
  },
  {
    name: 'money_owed',
    description: 'Money people owe the user (or the user owes them), per person.',
    input_schema: { type: 'object', properties: {} },
  },
];

const num = (v: unknown) => Number(v ?? 0);
const signed = (a: any) => (a.type === 'credit' || a.type === 'loan' ? -1 : 1) * num(a.balance);
const like = (s: string) => `%${s.replace(/[%_,()]/g, ' ').trim()}%`;

/** Runs one lookup with the person's own database client (row-level security applies). */
export async function runTool(db: Admin, name: string, input: any, today: string): Promise<unknown> {
  if (name === 'find_transactions') {
    let q = db.from('transaction_list').select('date, amount, display_name, name, category_name, account_name').gte('date', input.from).lte('date', input.to);
    if (input.text) q = q.ilike('display_name', like(input.text));
    if (input.category) q = q.ilike('category_name', like(input.category));
    if (input.account) q = q.ilike('account_name', like(input.account));
    if (input.direction === 'out') q = q.lt('amount', 0);
    if (input.direction === 'in') q = q.gt('amount', 0);
    const { data, error } = await q.order('date', { ascending: false }).limit(2000);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as any[];
    const limit = Math.min(Math.max(1, input.limit ?? 25), 100);
    return {
      matched: rows.length, total: round2(rows.reduce((s, r) => s + num(r.amount), 0)),
      transactions: rows.slice(0, limit).map((r) => ({ date: r.date, amount: num(r.amount), merchant: r.display_name, category: r.category_name ?? 'Uncategorised', account: r.account_name })),
      ...(rows.length >= 2000 ? { note: 'More than 2000 matched; totals cover the newest 2000. Narrow the dates.' } : {}),
    };
  }
  if (name === 'spending_by_category') {
    const [{ data, error }, { data: cats }] = await Promise.all([
      db.from('transaction_lines').select('category_id, kind, amount').gte('date', input.from).lte('date', input.to).eq('kind', input.kind).limit(20000),
      db.from('categories').select('id, name'),
    ]);
    if (error) throw new Error(error.message);
    const names = new Map(((cats ?? []) as any[]).map((c) => [c.id, c.name]));
    const by = new Map<string, number>();
    for (const r of (data ?? []) as any[]) { const k = names.get(r.category_id) ?? 'Uncategorised'; by.set(k, (by.get(k) ?? 0) + num(r.amount)); }
    const sign = input.kind === 'expense' ? -1 : 1;
    const list = [...by.entries()].map(([category, t]) => ({ category, total: round2(sign * t) })).sort((a, b) => b.total - a.total);
    return { categories: list, total: round2(list.reduce((s, x) => s + x.total, 0)) };
  }
  if (name === 'budget') {
    const month = `${String(input.month).slice(0, 7)}-01`;
    const [{ data: lines, error }, { data: cats }, { data: b }] = await Promise.all([
      db.from('transaction_lines').select('category_id, kind, amount').gte('date', month).lte('date', monthEnd(month)).limit(20000),
      db.from('categories').select('id, name, group_name, kind, is_hidden'),
      db.from('budgets').select('category_id, group_name, amount, rollover').eq('month', month),
    ]);
    if (error) throw new Error(error.message);
    const totals = new Map<string | null, number>();
    for (const r of (lines ?? []) as any[]) if (r.kind !== 'transfer') totals.set(r.category_id, (totals.get(r.category_id) ?? 0) + num(r.amount));
    const view = buildBudgetMonth(((cats ?? []) as any[]).map((c) => ({ id: c.id, name: c.name, group: c.group_name, kind: c.kind, hidden: c.is_hidden })),
      ((b ?? []) as any[]).map((x) => ({ categoryId: x.category_id, groupName: x.group_name, amount: num(x.amount), rollover: x.rollover })), totals);
    const flat = view.expenses.flatMap((l) => [l, ...(l.children ?? [])]);
    const shown = flat.filter((l) => l.budgeted || l.actual).map((l) => ({ line: l.label, budgeted: round2(l.budgeted), spent: round2(-l.actual), available: round2(l.available) }));
    return shown.length ? { month: month.slice(0, 7), lines: shown } : { month: month.slice(0, 7), note: 'No budget or spending for that month.' };
  }
  if (name === 'accounts') {
    const { data, error } = await db.from('account_balances').select('name, type, subtype, balance, credit_limit, is_hidden').eq('is_hidden', false);
    if (error) throw new Error(error.message);
    return ((data ?? []) as any[]).map((a) => ({
      name: a.name, type: a.subtype || a.type,
      ...(a.type === 'credit' || a.type === 'loan' ? { owed: round2(Math.max(0, -signed(a))) } : { balance: round2(signed(a)) }),
      ...(a.type === 'credit' && a.credit_limit != null ? { limit: num(a.credit_limit) } : {}),
    }));
  }
  if (name === 'upcoming') {
    const days = Math.min(Math.max(1, input.days ?? 14), 60);
    const { data: accounts } = await db.from('account_balances').select('*').eq('is_hidden', false).eq('plan_include', true);
    const plan = (accounts ?? []) as any[];
    if (!plan.length) return { note: 'No accounts are in the planner.' };
    const ids = plan.map((a) => a.id);
    const [{ data: rec }, { data: ent }, { data: posted }] = await Promise.all([
      db.from('recurring').select('*'),
      db.from('plan_entries').select('*').or(`and(date.gte.${addDays(today, -45)},date.lte.${addDays(today, days + 31)}),and(occurrence_date.gte.${addDays(today, -45)},occurrence_date.lte.${addDays(today, days + 31)})`),
      db.from('transactions').select('id, date, amount, account_id, name, merchant').in('account_id', ids).gte('date', addDays(today, -21)).eq('pending', false).limit(5000),
    ]);
    const txns: PostedTxn[] = ((posted ?? []) as any[]).map((r) => ({ id: r.id, date: r.date, amount: num(r.amount), accountId: r.account_id, name: r.name, merchant: r.merchant }));
    const week = buildWeek({
      weekStart: today, days: days + 1, today,
      planned: expandPlan(((rec ?? []) as any[]).map((r) => ({ ...r, amount: num(r.amount) })), ((ent ?? []) as any[]).filter((e) => !e.plan_key).map((e) => ({ ...e, amount: num(e.amount) })), addDays(today, -10), addDays(today, days)),
      actuals: txns,
      unlisted: Object.fromEntries(plan.map((a) => [a.id, num(a.balance_gap)] as const).filter(([, g]) => Math.abs(g) >= 0.01)),
      accounts: plan.map((a) => ({ id: a.id, name: a.name, buffer: num(a.plan_buffer), startBalance: balanceAt(signed(a), txns.filter((t) => t.accountId === a.id && t.date <= today), today) })),
    });
    const name = (id: string | null) => plan.find((a) => a.id === id)?.name ?? '';
    return {
      planned: week.days.flatMap((d) => d.rows).filter((r) => r.kind === 'planned').map((r) => ({ date: r.date, what: r.description, account: name(r.accountId), amount: r.planned, paid: r.actual != null || !!r.unlisted, ...(r.unlisted ? { note: 'done by the bank, not listed yet' } : {}) })),
      dips: week.warnings.map((w) => ({ date: w.date, account: name(w.accountId), balance: round2(w.balance), buffer: w.buffer, after: w.cause })),
      endBalance: round2(week.endBalance),
    };
  }
  if (name === 'money_owed') {
    const { data: cat } = await db.from('categories').select('id').eq('name', 'Money owed').maybeSingle();
    if (!cat) return { people: [] };
    const [{ data: whole }, { data: parts }] = await Promise.all([
      db.from('transactions').select('iou_person, amount').eq('category_id', cat.id).not('iou_person', 'is', null).limit(5000),
      db.from('transaction_splits').select('iou_person, amount').eq('category_id', cat.id).not('iou_person', 'is', null).limit(5000),
    ]);
    const by = new Map<string, number>();
    for (const r of [...(whole ?? []), ...(parts ?? [])] as any[]) by.set(r.iou_person, (by.get(r.iou_person) ?? 0) - num(r.amount));
    return { people: [...by.entries()].map(([person, owes]) => ({ person, owesYou: round2(owes) })).filter((p) => Math.abs(p.owesYou) >= 0.01) };
  }
  throw new Error(`No lookup called ${name}.`);
}

export interface ChatTurn { role: 'user' | 'assistant'; text: string }

/**
 * Answers a question, looking things up as needed. Earlier turns come back from the app as plain text (no
 * thinking or tool blocks are replayed), so each question starts a fresh exchange on top of them.
 */
export async function ask(client: Claude, db: Admin, history: ChatTurn[], question: string, model: ModelChoice, today: string): Promise<{ answer: string; looked: string[] }> {
  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-20).filter((t) => t.text.trim()).map((t) => ({ role: t.role, content: t.text })),
    { role: 'user', content: `(Today is ${today}, ${new Date(today + 'T12:00:00Z').toLocaleDateString('en-CA', { weekday: 'long', timeZone: 'UTC' })}.)\n\n${question}` },
  ];
  // The API wants the first turn from the user.
  while (messages.length && messages[0].role !== 'user') messages.shift();
  const looked: string[] = [];
  for (let step = 0; step < 8; step++) {
    const res = await client.messages.create({
      model: MODELS[model], max_tokens: 8000, system: SYSTEM, tools: TOOLS, messages,
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
    });
    if (res.stop_reason === 'refusal') return { answer: 'Sorry, I can’t help with that one.', looked };
    if (res.stop_reason !== 'tool_use') return { answer: textOf(res).trim() || 'Sorry, I didn’t get an answer that time. Try asking again.', looked };
    messages.push({ role: 'assistant', content: res.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const b of res.content) {
      if (b.type !== 'tool_use') continue;
      looked.push(b.name);
      try { results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(await runTool(db, b.name, b.input, today)) }); }
      catch (e) { results.push({ type: 'tool_result', tool_use_id: b.id, content: e instanceof Error ? e.message : String(e), is_error: true }); }
    }
    messages.push({ role: 'user', content: results });
  }
  return { answer: 'That needed more lookups than I can do in one go. Try a narrower question.', looked };
}
