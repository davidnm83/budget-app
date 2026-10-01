# budget-app

A personal budgeting app you host yourself: bank sync through your own Plaid account, a review inbox for new transactions, rules that learn your categories and merchant names, and (coming next) recurring bills and a weekly cash planner. It's meant to replace Mint/Fina-style apps without handing your bank data to a third party.

Runs on iPhone, Android and the web from one codebase. Everything fits in free tiers.

> **Each person runs their own copy.** Fork the repo, create your own Supabase project and Plaid account, and follow **[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md)**.

## What works today

- **Bank sync via Plaid.** Link banks, a daily sync at 5 AM (your time zone), **Sync now**, and **Fix** for connections that need a new sign-in.
- **Transactions tab.** Everything grouped by day, with search, filters (dates, accounts, categories incl. split parts, money in/out, amount) and sorting by date, amount or merchant. "To review" shows new arrivals to tick off, one at a time or all at once.
- **Auto-categorisation.** Your rules first, then the category you used last time for that merchant, then Plaid's category. The inbox shows where each category came from.
- **Rules from edits.** When you change a category, "Always use this category for …" makes it a rule.
- **Merchant cleanup.** Rules turn `RETAIL PURCHASE 0010… RCSS 1077` into `Superstore`.
- **Budgets.** Monthly budgets per category or group, with rollover, a collapsed archive of past months by year, comparisons (last month, same month last year, any month, year to date) and a year view.
- **Reports.** Spending by category with drill-down to transactions, cash flow by month with money in by source, and spending by merchant.
- **Import from Fina.** Brings over your history with categories, notes and splits, and fills in transactions the app already synced instead of duplicating them. Safe to run again.
- **Notes, tags and edits.** Change a transaction's date or amount; bank transactions keep the bank's original value beside yours.
- **Accounts.** Cash, credit cards and loans, with balances. Manual accounts keep an auto balance (start + transactions); tap one to set it.
- **Manual → bank.** When you connect a bank for a card you were tracking by CSV or Fina, the account is taken over (same last 4 digits) and imported rows are linked to the bank's instead of duplicated, splits included. Otherwise, merge them yourself from the Accounts tab.
- **CSV import** for banks Plaid can't reach (Rogers, PC Financial, American Express, or any CSV with date, description and amount). Rows the account already has are skipped. Web app only for now.
- **Privacy.** Bank tokens are encrypted in Supabase Vault and never reach the app, and row-level security covers every table.

## Roadmap

1. **Recurring bills and income**, matched to transactions automatically
2. **Weekly planner:** planned debits and income per account, projected balance, low-balance warnings
3. **Split editing and category management** (rename, regroup, merge)
4. **Loans:** payments copied from the paying account, interest from balance changes (logic in `packages/core/src/loans.ts`)
5. **Net worth history, CSV export**

## How it fits together

```
apps/app/                 Expo app (iOS, Android, web) ── talks to ──┐
packages/core/            Shared logic + tests (merchants, rules,    │
                          CSV parsing, loan interest, dates)         │
supabase/                                                            ▼
├── migrations/           Postgres tables + row-level security   Supabase
├── functions/            Edge Functions (Deno):                 (your project)
│   ├── plaid-link-token  start Plaid Link                           │
│   ├── plaid-exchange    save a new bank connection                 │
│   ├── plaid-sync        daily / on-demand sync  ◀── pg_cron 5 AM   │
│   ├── plaid-remove      disconnect a bank                          ▼
│   └── _shared/          Plaid client, sync logic, copy of core    Plaid
└── setup/cron.sql        schedules the daily sync
```

Amounts follow one rule everywhere: **money out is negative, money in is positive.** Dates are plain `YYYY-MM-DD` calendar days, so no time zone can shift them.

## Development

```bash
npm install
npm test                 # core logic tests (Vitest)
npm run test:functions   # Edge Function sync tests (needs Deno)
npm run typecheck        # core + app
npm run web              # run the app in a browser (needs apps/app/.env)
npm run sync-core        # after changing packages/core: copy it into the Edge Functions
```

CI runs all of the above on every push.

## Security notes

- **Never commit `.env` files.** Only the `.env.example` files are in the repo: `apps/app/.env.example` (app, public values) and `supabase/.env.example` (server secrets).
- **Plaid keys and the cron secret** live in Supabase Edge Function secrets.
- **The publishable key in the app is public by design**; row-level security is what protects the data. Turn off new sign-ups once your own account exists (see the self-hosting guide).

## Licence

[MIT](LICENSE)
