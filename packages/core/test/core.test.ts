import { describe, expect, it } from 'vitest';
import {
  addDays, loanWhatIf, matchChanged, matchDues, payoffAt, payoffSchedule, computeLoanInterest, dedupeAgainstExisting, fromPlaidAmount, hourIn, learnMerchantRules,
  guessMerchant, merchantFor, normalizeDescription, parseBankCsv, parseMoney, suggestCategory, todayIn, toIsoDate, weekStart,
} from '../src/index.ts';

describe('money', () => {
  it('flips Plaid sign', () => {
    expect(fromPlaidAmount(12.5)).toBe(-12.5);
    expect(fromPlaidAmount(-202)).toBe(202);
  });
  it('parses formatted amounts', () => {
    expect(parseMoney('-$1,234.56')).toBe(-1234.56);
    expect(parseMoney('(12.00)')).toBe(-12);
    expect(parseMoney('')).toBeNaN();
  });
});

describe('dates', () => {
  it('does day math without time-zone drift', () => {
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('finds the Monday of a week', () => {
    expect(weekStart('2026-09-30')).toBe('2026-09-28'); // Wednesday
    expect(weekStart('2026-10-04')).toBe('2026-09-28'); // Sunday
  });
  it('reads common bank date formats', () => {
    expect(toIsoDate('09/27/2026')).toBe('2026-09-27');
    expect(toIsoDate('2026/9/2')).toBe('2026-09-02');
    expect(toIsoDate('hello')).toBe('');
    expect(toIsoDate('20 Sep 2026')).toBe('2026-09-20');
    expect(toIsoDate('03 Sep 2026')).toBe('2026-09-03');
    expect(toIsoDate('Sep 3, 2026')).toBe('2026-09-03');
    expect(toIsoDate('20 Foo 2026')).toBe('');
  });
  it('knows the local hour and day for the 5 AM sync', () => {
    const t = new Date('2026-09-30T09:15:00Z'); // 5:15 AM in Toronto (EDT)
    expect(hourIn('America/Toronto', t)).toBe(5);
    expect(todayIn('America/Toronto', new Date('2026-10-01T02:00:00Z'))).toBe('2026-09-30');
    const winter = new Date('2026-12-01T10:05:00Z'); // 5:05 AM EST
    expect(hourIn('America/Toronto', winter)).toBe(5);
  });
});

describe('merchants', () => {
  const rules = [{ match: 'RCSS', merchant: 'Superstore' }, { match: 'E-TRANSFER JANE DOE', merchant: 'Jane Doe' }];
  it('normalises bank descriptions', () => {
    expect(normalizeDescription('RCSS 1077 TORONTO, ON')).toBe('RCSS');
    expect(normalizeDescription('Point of Sale - Interac RETAIL PURCHASE 000001001802 WALMART STORE #')).toBe('WALMART STORE');
  });
  it('maps descriptions to merchants', () => {
    expect(merchantFor(rules, 'RETAIL PURCHASE 001001001514 RCSS 1077')).toBe('Superstore');
    expect(merchantFor(rules, 'Internet Banking E-TRANSFER 0112 JANE DOE')).toBe('Jane Doe');
    expect(merchantFor(rules, 'NETFLIX.COM')).toBe('');
  });
  it('learns the most-used merchant per description', () => {
    const learned = learnMerchantRules([
      { name: 'DOLLARAMA # 231', merchant: 'Dollarama' },
      { name: 'DOLLARAMA #1429', merchant: 'Dollarama' },
      { name: 'DOLLARAMA # 99', merchant: 'Dolarama typo' },
    ]);
    expect(learned).toEqual([{ match: 'DOLLARAMA', merchant: 'Dollarama' }]);
  });
});

describe('categorize', () => {
  const t = { name: 'RETAIL PURCHASE RCSS 1077', merchant: 'Superstore', amount: -45, accountId: 'chq' };
  it('prefers rules, then learned, then Plaid', () => {
    const rules = [{ matchText: 'superstore', categoryId: 'groceries' }];
    expect(suggestCategory(t, rules, {})).toEqual({ categoryId: 'groceries', source: 'rule' });
    expect(suggestCategory(t, [], { superstore: 'food' })).toEqual({ categoryId: 'food', source: 'learned' });
    expect(suggestCategory({ ...t, merchant: '', plaidCategory: 'FOOD_AND_DRINK_GROCERIES' }, [], {}, { FOOD_AND_DRINK_GROCERIES: 'g' }))
      .toEqual({ categoryId: 'g', source: 'plaid' });
    expect(suggestCategory({ ...t, merchant: 'X' }, [], {})).toEqual({ categoryId: null, source: null });
  });
  it('respects account and amount limits, longest match wins', () => {
    const rules = [
      { matchText: 'RCSS', categoryId: 'groceries' },
      { matchText: 'RCSS', categoryId: 'big-shop', minAmount: 100 },
      { matchText: 'Superstore', categoryId: 'other-account', accountId: 'visa' },
    ];
    expect(suggestCategory(t, rules, {}).categoryId).toBe('groceries');
    expect(suggestCategory({ ...t, amount: -150 }, rules, {}).categoryId).toBe('groceries'); // same length: first stays
    expect(suggestCategory({ ...t, accountId: 'visa' }, rules, {}).categoryId).toBe('other-account');
  });
});

describe('guessMerchant', () => {
  it('turns card descriptions into readable names', () => {
    expect(guessMerchant('DOLLARAMA # 370         TORONTO')).toBe('Dollarama');
    expect(guessMerchant('AMZN MKTP CA*5R5OD9R21  866-216-1072')).toBe('Amzn Mktp CA');
    expect(guessMerchant('70018 CHAMPS CANADA     TORONTO')).toBe('Champs Canada');
    expect(guessMerchant('PRESTO MOBI/SKQJTJHVZC  TORONTO')).toBe('Presto Mobi');
    expect(guessMerchant('PAYMENT RECEIVED - THANK YOU')).toBe('Payment Received - Thank You');
  });
});

describe('csv import', () => {
  const rogers = [
    'Date,Posted Date,Reference Number,Activity Type,Activity Status,Card Number,Merchant Category Description,Merchant Name,Merchant City,Merchant State or Province,Merchant Country Code,Merchant Postal Code,Amount,Rewards,Name on Card',
    '2026-09-01,2026-09-02,"1",TRANS,APPROVED,****0000,Movies,CINEMA CLUB,TORONTO,ON,CAN,X,$12.42,,A PERSON',
    '2026-09-02,2026-09-03,"2",TRANS,APPROVED,****0000,,PAYMENT THANK YOU,,,,,-$400.00,,A PERSON',
    '2026-09-03,2026-09-03,"3",TRANS,PENDING,****0000,,COFFEE,,,,,$4.00,,A PERSON',
  ].join('\n');
  const pcf = '"Description","Type","Card Holder Name","Date","Time","Amount"\n"GROCER 12","PURCHASE","A","09/27/2026","08:13 PM","-55.69"\n"Payment","PAYMENT","A","09/23/2026","04:00 AM","205.00"\n';
  it('reads Rogers (purchases flipped, pending skipped)', () => {
    const p = parseBankCsv(rogers);
    expect(p.format).toBe('rogers');
    expect(p.rows.map((r) => r.amount)).toEqual([-12.42, 400]);
    expect(p.skipped).toBe(1);
  });
  it('reads PC Financial (already signed, month-first dates)', () => {
    const p = parseBankCsv(pcf);
    expect(p.format).toBe('pcf');
    expect(p.rows[0]).toEqual({ date: '2026-09-27', name: 'GROCER 12', amount: -55.69 });
  });
  it('reads headerless debit/credit files and generic headers', () => {
    expect(parseBankCsv('2026-09-02,SHOP,25.95,\n2026-09-03,PAY,,150.00\n').rows.map((r) => r.amount)).toEqual([-25.95, 150]);
    expect(parseBankCsv('Transaction Date,Description,Amount\n2026-01-05,Thing,-3.50\n').rows[0].amount).toBe(-3.5);
    expect(() => parseBankCsv('a,b\n1,2')).toThrow(/Could not find/);
  });
  it('reads American Express exports (charges positive in the file)', () => {
    const amex = 'Date,Date Processed,Description,Amount\n' +
      '20 Sep 2026,20 Sep 2026,INTEREST,6.63\n' +
      '19 Sep 2026,19 Sep 2026,SAMPLE STORE            555-000-0000,-21.46\n' +
      '10 Sep 2026,12 Sep 2026,PAYMENT RECEIVED - THANK YOU,-100.00\n';
    const p = parseBankCsv(amex);
    expect(p.format).toBe('amex');
    expect(p.rows.map((r) => [r.date, r.amount])).toEqual([['2026-09-20', -6.63], ['2026-09-19', 21.46], ['2026-09-10', 100]]);
  });
  it('skips rows already present, allowing a few days of date drift', () => {
    const rows = [
      { date: '2026-08-31', name: 'Payment', amount: 202 },     // sheet has it on 09-01
      { date: '2026-09-01', name: 'Gas', amount: -86.57 },      // sheet has it on 08-31
      { date: '2026-09-05', name: 'Shop', amount: -6.28 },
      { date: '2026-09-05', name: 'Shop', amount: -6.28 },      // two identical purchases, one already there
    ];
    const existing = [{ date: '2026-09-01', amount: 202 }, { date: '2026-08-31', amount: -86.57 }, { date: '2026-09-05', amount: -6.28 }];
    const { add, duplicates } = dedupeAgainstExisting(rows, existing);
    expect(duplicates).toHaveLength(3);
    expect(add).toEqual([{ date: '2026-09-05', name: 'Shop', amount: -6.28 }]);
  });
});

describe('loans', () => {
  it('logs interest only when the numbers make sense', () => {
    expect(computeLoanInterest(10360, 10000, 400)).toEqual({ status: 'interest', interest: 40 });
    expect(computeLoanInterest(10000, 10000, 200).status).toBe('waiting-balance');
    expect(computeLoanInterest(10000, 9820, 400).status).toBe('not-caught-up');
    expect(computeLoanInterest(10000, 9500, 200).status).toBe('mismatch');
    expect(computeLoanInterest(10000, 10000, 0).status).toBe('waiting-payment');
  });
});

import { isTransferCategory, plaidCategoryNames, plaidCategoryToName } from '../src/index.ts';
describe('plaid category mapping', () => {
  it('maps detailed codes, then shorter prefixes', () => {
    expect(plaidCategoryToName('FOOD_AND_DRINK_GROCERIES', 'FOOD_AND_DRINK')).toBe('Groceries');
    expect(plaidCategoryNames('FOOD_AND_DRINK_FAST_FOOD', 'FOOD_AND_DRINK')).toEqual(['Fast food', 'Restaurants']);
    expect(plaidCategoryNames('GENERAL_MERCHANDISE_ELECTRONICS', 'GENERAL_MERCHANDISE')).toEqual(['Accessories', 'Shopping', 'General goods']);
    expect(plaidCategoryToName('INCOME_WAGES', 'INCOME')).toBe('Paycheck');
    expect(plaidCategoryToName(null, 'TRAVEL')).toBeNull();
    expect(isTransferCategory('LOAN_PAYMENTS', 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT')).toBe(true);
  });
});

describe('loan what-if and projection (LOAN-4, LOAN-5)', () => {
  it('pays off sooner and saves interest with an extra payment', () => {
    const base = payoffAt(10000, 300, 0.005, '2026-10-01')!;
    expect(base.monthsLeft).toBe(37);
    const sched = payoffSchedule(10000, 300, 0.005);
    expect([sched[0], sched[sched.length - 1], sched.length - 1]).toEqual([10000, 0, 37]);
    const s = { owed: 10000, perMonth: { payment: 300, interest: 50, principal: 250 }, monthsLeft: base.monthsLeft, interestLeft: base.interestLeft, status: 'ok' } as any;
    const w = loanWhatIf(s, 100, '2026-10-01')!;
    expect(w.monthsLeft).toBe(27);
    expect(w.monthsSaved).toBe(10);
    expect(w.interestSaved).toBeGreaterThan(200);
    expect(loanWhatIf(s, 0, '2026-10-01')).toBeNull();
    expect(payoffAt(10000, 40, 0.005, '2026-10-01')).toBeNull(); // doesn't cover the interest
  });
});

describe('bills whose amount changed (BIL-7)', () => {
  it('finds the payment for an unmatched bill by its match text', () => {
    const dues = [
      { key: 'ins', date: '2026-10-20', amount: -162, accountId: 'a', matchText: 'Shield Auto', estimated: false },
      { key: 'gym', date: '2026-10-16', amount: -48, accountId: 'a', matchText: null, estimated: false },
    ];
    const txns = [
      { id: 't1', date: '2026-10-21', amount: -189.5, accountId: 'a', name: 'SHIELD AUTO INSURANCE', merchant: null },
      { id: 't2', date: '2026-10-16', amount: -70, accountId: 'a', name: 'SOMETHING ELSE', merchant: null },
      { id: 't3', date: '2026-10-20', amount: 189.5, accountId: 'a', name: 'SHIELD AUTO REFUND', merchant: null },
    ];
    const matched = matchDues(dues, txns);
    expect(matched.size).toBe(0);
    expect([...matchChanged(dues, txns, matched)]).toEqual([['ins', 't1']]);
  });
});

import { csvReminderOn, lastSyncTime, syncDue } from '../src/index.ts';
describe('scheduled sync', () => {
  it('runs at 5 AM by default and on the chosen rhythm otherwise', () => {
    expect([4, 5, 6].map((h) => syncDue(h, null))).toEqual([false, true, false]);
    expect([5, 11, 17, 23, 12].map((h) => syncDue(h, 6))).toEqual([true, true, true, true, false]);
    expect([5, 17, 16].map((h) => syncDue(h, 12))).toEqual([true, true, false]);
    expect([2, 5, 8, 9].map((h) => syncDue(h, 3))).toEqual([true, true, true, false]);
    expect([0, 13].map((h) => syncDue(h, 1))).toEqual([true, true]);
    expect([5, 13].map((h) => syncDue(h, 0))).toEqual([false, false]);
    expect(syncDue(5, 7)).toBe(true);   // a value the app doesn't offer falls back to once a day
    expect(syncDue(12, 7)).toBe(false);
  });
});

describe('import reminders', () => {
  const at = (d: string) => new Date(d); // local time
  const hhmm = (x: Date | null) => x && `${x.getDate()} ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
  it('finds the latest scheduled sync time', () => {
    expect(hhmm(lastSyncTime(at('2026-10-03T09:30:00'), null))).toBe('3 05:00');
    expect(hhmm(lastSyncTime(at('2026-10-03T04:59:00'), 24))).toBe('2 05:00');   // before 5 AM: yesterday's
    expect(hhmm(lastSyncTime(at('2026-10-03T16:59:00'), 12))).toBe('3 05:00');
    expect(hhmm(lastSyncTime(at('2026-10-03T17:00:00'), 12))).toBe('3 17:00');
    expect(hhmm(lastSyncTime(at('2026-10-03T02:10:00'), 6))).toBe('2 23:00');
    expect(hhmm(lastSyncTime(at('2026-10-03T13:45:00'), 1))).toBe('3 13:00');
    expect(lastSyncTime(at('2026-10-03T13:45:00'), 0)).toBeNull();               // only by hand: no reminders
    expect(hhmm(lastSyncTime(at('2026-10-03T13:45:00'), 7))).toBe('3 05:00');    // unknown value: once a day
  });
  it('reminds for cash and cards unless told otherwise', () => {
    expect([csvReminderOn('depository', null), csvReminderOn('credit', undefined), csvReminderOn('loan', null), csvReminderOn('investment', null)]).toEqual([true, true, false, false]);
    expect([csvReminderOn('credit', false), csvReminderOn('loan', true)]).toEqual([false, true]);
  });
});
