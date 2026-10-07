// Run: deno test supabase/functions/_shared/ai.test.ts
// Receipt reading (which model, when) and the chat's tool loop, with stand-ins for Claude and the database.
import { ask, readReceipt, runTool, type Claude } from './ai.ts';
import { fakeDb } from './fake_db.ts';

function assertEquals(a: unknown, b: unknown, msg = '') {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}\n  expected ${JSON.stringify(b)}\n  got      ${JSON.stringify(a)}`);
}
/** A stand-in for Claude that gives back the replies queued for each model, and keeps what it was asked. */
function fakeClaude(replies: Record<string, any[]>) {
  const calls: any[] = [];
  const client: Claude = { messages: { create: async (p: any) => {
    calls.push(structuredClone(p));
    const next = replies[p.model].shift();
    if (!next) throw new Error(`no reply queued for ${p.model}`);
    return { stop_reason: 'end_turn', ...next, content: next.content ?? [{ type: 'text', text: next.text }] } as any;
  } } };
  return { client, calls };
}
const reading = (r: object) => ({ text: JSON.stringify({ merchant: 'Corner Grocer', date: '2026-10-01', total: 23.45, tax: 1.2, items: [{ name: 'Bread', amount: 4.25 }, { name: 'Coffee', amount: 18 }], legible: true, ...r }) });

Deno.test('receipts: Haiku reading that adds up is kept', async () => {
  const { client, calls } = fakeClaude({ 'claude-haiku-5-5': [reading({})] });
  const r = await readReceipt(client, 'aGVsbG8=', '2026-10-07');
  assertEquals(r.model, 'haiku');
  assertEquals(r.receipt?.total, 23.45);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].output_config.format.type, 'json_schema');
  assertEquals(calls[0].messages[0].content[0].source.media_type, 'image/jpeg');
});

Deno.test('receipts: a reading that does not add up goes to Sonnet', async () => {
  const { client, calls } = fakeClaude({ 'claude-haiku-5-5': [reading({ total: 30 })], 'claude-sonnet-5-5': [reading({})] });
  const r = await readReceipt(client, 'aGVsbG8=', '2026-10-07');
  assertEquals([r.model, r.receipt?.total, calls.map((c) => c.model)], ['sonnet', 23.45, ['claude-haiku-5-5', 'claude-sonnet-5-5']]);
  // Haiku refused or ran out of room: Sonnet too.
  const two = fakeClaude({ 'claude-haiku-5-5': [{ stop_reason: 'max_tokens', text: '{' }], 'claude-sonnet-5-5': [reading({ date: 'Oct 1' })] });
  const r2 = await readReceipt(two.client, 'aGVsbG8=', '2026-10-07');
  assertEquals([r2.model, r2.receipt?.date], ['sonnet', null]);
});

const u = 'u1';
const tables = () => ({
  transaction_list: [
    { user_id: u, date: '2026-10-02', amount: -12.5, display_name: 'Uber Eats', name: 'UBER EATS', category_name: 'Restaurants', account_name: 'Visa' },
    { user_id: u, date: '2026-10-05', amount: -30, display_name: 'Uber Trip', name: 'UBER TRIP', category_name: 'Taxi', account_name: 'Visa' },
    { user_id: u, date: '2026-09-20', amount: -8, display_name: 'Uber Eats', name: 'UBER EATS', category_name: 'Restaurants', account_name: 'Visa' },
    { user_id: u, date: '2026-10-03', amount: 1500, display_name: 'Acme Co', name: 'PAYROLL', category_name: 'Paycheck', account_name: 'Chequing' },
  ],
  transaction_lines: [
    { date: '2026-10-02', category_id: 'c1', kind: 'expense', amount: -12.5 },
    { date: '2026-10-04', category_id: 'c1', kind: 'expense', amount: -7.5 },
    { date: '2026-10-05', category_id: 'c2', kind: 'expense', amount: -30 },
    { date: '2026-10-06', category_id: 'c3', kind: 'transfer', amount: -200 },
  ],
  categories: [{ id: 'c1', name: 'Restaurants' }, { id: 'c2', name: 'Taxi' }, { id: 'c3', name: 'Transfer' }],
  account_balances: [
    { id: 'a1', name: 'Chequing', type: 'depository', subtype: 'checking', balance: 900, is_hidden: false },
    { id: 'a2', name: 'Visa', type: 'credit', subtype: 'credit card', balance: 450, credit_limit: 2000, is_hidden: false },
  ],
});

Deno.test('chat lookups: transactions, categories, accounts', async () => {
  const db = fakeDb(tables());
  const found: any = await runTool(db, 'find_transactions', { from: '2026-10-01', to: '2026-10-31', text: 'uber', direction: 'out' }, '2026-10-07');
  assertEquals([found.matched, found.total, found.transactions.map((t: any) => t.date)], [2, -42.5, ['2026-10-05', '2026-10-02']]);
  const cats: any = await runTool(db, 'spending_by_category', { from: '2026-10-01', to: '2026-10-31', kind: 'expense' }, '2026-10-07');
  assertEquals(cats, { categories: [{ category: 'Taxi', total: 30 }, { category: 'Restaurants', total: 20 }], total: 50 });
  assertEquals(await runTool(db, 'accounts', {}, '2026-10-07'), [{ name: 'Chequing', type: 'checking', balance: 900 }, { name: 'Visa', type: 'credit card', owed: 450, limit: 2000 }]);
});

Deno.test('chat: looks things up, then answers', async () => {
  const db = fakeDb(tables());
  const { client, calls } = fakeClaude({ 'claude-haiku-5-5': [
    { stop_reason: 'tool_use', content: [{ type: 'text', text: 'Checking.' }, { type: 'tool_use', id: 't1', name: 'spending_by_category', input: { from: '2026-10-01', to: '2026-10-31', kind: 'expense' } }] },
    { text: 'You spent $50.00 this month: $30.00 on taxis and $20.00 at restaurants.' },
  ] });
  const r = await ask(client, db, [{ role: 'assistant', text: 'Hi! Ask me anything.' }, { role: 'user', text: 'hello' }, { role: 'assistant', text: 'Hello.' }], 'How much have I spent this month?', 'haiku', '2026-10-07');
  assertEquals(r, { answer: 'You spent $50.00 this month: $30.00 on taxis and $20.00 at restaurants.', looked: ['spending_by_category'] });
  // The leading assistant greeting is dropped (the first turn must be the user's); today's date rides with the question.
  assertEquals(calls[0].messages.map((m: any) => m.role), ['user', 'assistant', 'user']);
  if (!calls[0].messages[2].content.startsWith('(Today is 2026-10-07, Wednesday.)')) throw new Error(calls[0].messages[2].content);
  // The tool's result went back as a tool_result for the same call.
  const back = calls[1].messages.at(-1).content[0];
  assertEquals([back.type, back.tool_use_id, JSON.parse(back.content).total], ['tool_result', 't1', 50]);
});
