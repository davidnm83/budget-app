import { describe, expect, it } from 'vitest';
import {
  accountMask, addMonths, cleanAccountName, categoryName, buildBudgetMonth, carryInto, compareTotals, guessAccountType, matchHistory,
  monthEnd, parseHistory, suggestBudget, detectMapping, readDate, readTable,
} from '../src/index.ts';

// Synthetic rows in Fina's raw export format, one of the recognised presets (no real data).
const FINA = [
  'date,name,merchant,type,amount,currency,account,area,tag,description,city,region',
  '2026-09-01,BILL PAY VISA,,vehicle repairs & maintenance,-150.00,CAD,Bank Chequing - 1111,expenses,,oil change,,',
  '2026-09-01,BILL PAY VISA,,credit card payment,-50.00,CAD,Bank Chequing - 1111,transfers,,,,',
  '2026-09-02,SHOP 123,Shop,snacks,-4.00,CAD,Bank Chequing - 1111,expenses,,,,',
  '2026-09-02,SHOP 123,Shop,snacks,-4.00,CAD,Bank Chequing - 1111,expenses,,,,',
  '2026-09-03,DEPOSIT PAY,Employer,paycheck,500.00,CAD,Bank Chequing - 1111,income,"work, gig",,,',
  '2026-08-20,STORE,Store,Bank Charges & Fees,-2.50,CAD,Store Mastercard,expenses,,,,',
].join('\n');

describe('history import', () => {
  it('reads the raw export, with categories, groups and accounts', () => {
    const f = parseHistory(FINA);
    expect(f.rows).toHaveLength(6);
    expect(f.rows[0]).toMatchObject({ category: 'Vehicle repairs & maintenance', kind: 'expense', amount: -150, notes: 'oil change' });
    expect(f.rows[4].tags).toEqual(['work', 'gig']);
    expect(f.rows[2].importId).not.toBe(f.rows[3].importId); // two identical purchases stay two
    expect(parseHistory(FINA).rows.map((r) => r.importId)).toEqual(f.rows.map((r) => r.importId)); // stable
    expect(f.categories.find((c) => c.name === 'Snacks')).toMatchObject({ group: 'Food & dining', rows: 2 });
    expect(f.categories.find((c) => c.name === 'Bank Charges & Fees')?.group).toBe('Fees & charges');
    expect(f.categories.map((c) => c.name)).toEqual(['Paycheck', 'Bank Charges & Fees', 'Snacks', 'Vehicle repairs & maintenance', 'Credit card payment']);
    expect(f.categories.find((c) => c.name === 'Paycheck')?.group).toBe('Income');
    expect(f.accounts[0]).toMatchObject({ name: 'Bank Chequing - 1111', rows: 5, mask: '1111', type: 'depository', first: '2026-09-01', last: '2026-09-03' });
  });
  it('refuses the rollup export', () => {
    expect(() => parseHistory('date,name,merchant,type,city,region,account,area,amount,currency\n-,-,-,-,-,-,-,transfers,1.00,-\n"Tue, Sep 29",X,,transfer,,,A,transfers,-1.00,CAD')).toThrow(/rollup/);
  });
  it('guesses account details', () => {
    expect(accountMask('Car Loan- 32481975')).toBe('1975');
    expect(cleanAccountName('Car Loan- 32481975')).toBe('Car Loan');
    expect(cleanAccountName('Store Mastercard')).toBe('Store Mastercard');
    expect([categoryName('tv'), categoryName('gym')]).toEqual(['TV', 'Gym']);
    expect(accountMask('Store Mastercard')).toBeNull();
    expect(guessAccountType('Rewards Mastercard - 7949').type).toBe('credit');
    expect(guessAccountType('Student Loan')).toEqual({ type: 'loan', subtype: 'student' });
    expect(guessAccountType('Everyday Deposit - 7739').type).toBe('depository');
  });
  it('matches history to existing transactions: one to one, then splits by total', () => {
    const f = parseHistory(FINA);
    const rows = f.rows.map((r) => ({ ...r, accountId: r.account.startsWith('Bank') ? 'acc1' : null }));
    const m = matchHistory(rows, [
      { id: 'billpay', accountId: 'acc1', date: '2026-09-02', amount: -200 }, // = 150 + 50 split
      { id: 'snack', accountId: 'acc1', date: '2026-09-02', amount: -4 },      // only one of the two
      { id: 'pay', accountId: 'acc1', date: '2026-09-04', amount: 500 },
      { id: 'other', accountId: 'acc2', date: '2026-08-20', amount: -2.5 },   // different account
    ]);
    expect([...m.single.entries()]).toEqual([[2, 'snack'], [4, 'pay']]);
    expect(m.splits).toEqual([{ existingId: 'billpay', rows: [0, 1] }]);
    expect(m.unmatched).toEqual([3, 5]);
  });
});

describe('budgets', () => {
  const cats = [
    { id: 'gro', name: 'Groceries', group: 'Food', kind: 'expense' as const },
    { id: 'snk', name: 'Snacks', group: 'Food', kind: 'expense' as const },
    { id: 'gas', name: 'Gas', group: 'Car', kind: 'expense' as const },
    { id: 'pay', name: 'Paycheck', group: 'Income', kind: 'income' as const },
    { id: 'cc', name: 'Credit card payment', group: 'Transfers', kind: 'transfer' as const },
  ];
  it('does month math', () => {
    expect(addMonths('2026-11-01', 2)).toBe('2027-01-01');
    expect(addMonths('2026-01-01', -1)).toBe('2025-12-01');
    expect(monthEnd('2028-02-01')).toBe('2028-02-29');
  });
  it('builds a month: category and group budgets, refunds, unbudgeted, transfers left out', () => {
    const v = buildBudgetMonth(cats, [
      { categoryId: 'gro', groupName: null, amount: 300, rollover: true },
      { categoryId: null, groupName: 'Food', amount: 50, rollover: false },
      { categoryId: 'pay', groupName: null, amount: 2000, rollover: false },
    ], new Map<string | null, number>([['gro', -320], ['snk', -20], ['gas', -60], ['pay', 2100], ['cc', -500], [null, -5]]), new Map([['c:gro', 40]]));
    expect(v.expenses.map((l) => [l.label, l.available, l.actual, l.left])).toEqual([['Food', 50, 20, 30], ['Groceries', 340, 320, 20]]);
    expect(v.expenses[0].children?.map((c) => c.label)).toEqual(['Snacks']); // Groceries has its own budget
    expect(v.income[0]).toMatchObject({ actual: 2100, left: 100 });
    expect(v.unbudgeted.map((l) => [l.label, l.actual])).toEqual([['Gas', 60], ['Uncategorized', 5]]);
    expect(v.totals).toEqual({ budgetedIncome: 2000, actualIncome: 2100, budgetedExpenses: 350, actualExpenses: 405, unbudgetedExpenses: 65 });
  });
  it('rolls over leftover and overspending while rollover stays on', () => {
    const h = [
      { month: '2026-06-01', budgeted: 100, actual: 50, rollover: false },
      { month: '2026-07-01', budgeted: 100, actual: 80, rollover: true },  // +20
      { month: '2026-08-01', budgeted: 100, actual: 130, rollover: true }, // -30
    ];
    expect(carryInto('2026-09-01', h)).toBe(-10);
    expect(carryInto('2026-08-01', h)).toBe(20);
    expect(carryInto('2026-07-01', h)).toBe(0);
  });
  it('compares periods and suggests budgets', () => {
    const rows = compareTotals(new Map([['a', 'Gas']]), new Map([['a', 120], ['b', 10]]), new Map([['a', 100]]));
    expect(rows).toEqual([
      { key: 'a', label: 'Gas', a: 120, b: 100, change: 20, pct: 20 },
      { key: 'b', label: 'b', a: 10, b: 0, change: 10, pct: null },
    ]);
    expect(suggestBudget([100, 120, 0])).toBe(75);
  });
});

describe('history import from other apps', () => {
  it('recognises a Mint export: debit and credit give the sign, dates are month first', () => {
    const f = parseHistory([
      '"Date","Description","Original Description","Amount","Transaction Type","Category","Account Name","Labels","Notes"',
      '"9/13/2026","Corner Market","CORNER MKT 123","25.50","debit","Groceries","Everyday Checking","",""',
      '"9/14/2026","Acme Co","ACME PAYROLL","1500.00","credit","Paycheck","Everyday Checking","","bonus"',
      '"9/15/2026","Card payment","PAYMENT THANK YOU","300.00","credit","Credit Card Payment","Rewards Visa","",""',
    ].join('\n'));
    expect(f.format).toBe('Mint');
    expect(f.rows.map((r) => [r.date, r.amount, r.kind])).toEqual([['2026-09-13', -25.5, 'expense'], ['2026-09-14', 1500, 'income'], ['2026-09-15', 300, 'transfer']]);
    expect(f.rows[0]).toMatchObject({ name: 'CORNER MKT 123', merchant: 'Corner Market', category: 'Groceries' });
    expect(f.accounts.find((a) => a.name === 'Rewards Visa')?.type).toBe('credit');
  });
  it('recognises a YNAB register: outflow and inflow columns, category groups kept', () => {
    const f = parseHistory([
      'Account,Flag,Date,Payee,Category Group/Category,Category Group,Category,Memo,Outflow,Inflow,Cleared',
      'Checking,,2026-09-01,Landlord,Home: Rent,Home,Rent,,$1200.00,$0.00,Cleared',
      'Checking,,2026-09-02,Employer,Inflow: Ready to Assign,Inflow,Ready to Assign,,$0.00,$2000.00,Cleared',
    ].join('\n'));
    expect(f.format).toBe('YNAB');
    expect(f.rows.map((r) => r.amount)).toEqual([-1200, 2000]);
    expect(f.categories.find((c) => c.name === 'Rent')?.group).toBe('Home');
    expect(f.rows[1].kind).toBe('income');
  });
  it('guesses the columns of an unknown file, and a corrected mapping is honoured', () => {
    const text = 'Posted Date,Details,Debit,Credit,Type\n13/09/2026,COFFEE,4.50,,Coffee shops\n14/09/2026,REFUND,,4.50,Refunds';
    const { head, body } = readTable(text);
    const m = detectMapping(head, body);
    expect([m.format, m.dateOrder, head[m.outflow], head[m.inflow]]).toEqual(['Other', 'dmy', 'Debit', 'Credit']);
    const f = parseHistory(text, m);
    expect(f.rows.map((r) => [r.date, r.amount])).toEqual([['2026-09-13', -4.5], ['2026-09-14', 4.5]]);
    expect(f.accounts[0].name).toBe('Imported account');
    expect(parseHistory(text, { ...m, flip: true }).rows[0].amount).toBe(4.5);
  });
  it('reads dates in several styles', () => {
    expect([readDate('2026-03-04', 'mdy'), readDate('03/04/2026', 'mdy'), readDate('03/04/2026', 'dmy'), readDate('Sep 3, 2026', 'mdy'), readDate('3 Sep 2026', 'dmy'), readDate('nope', 'mdy')])
      .toEqual(['2026-03-04', '2026-03-04', '2026-04-03', '2026-09-03', '2026-09-03', '']);
  });
});
