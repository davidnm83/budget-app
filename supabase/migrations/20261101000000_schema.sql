-- Budget App 2.0: the whole database in one file.
--
-- Tables, views, functions, row-level security and grants, as one script for a new project.
-- Every table is limited to the signed-in user's own rows. Bank tokens live in Supabase Vault
-- and are only reachable by the three *_plaid_token functions, which only the server may call.
--
-- Generated from the 1.x migrations with pg_dump, then tidied. Later changes go in new
-- migration files after this one.

create extension if not exists pgcrypto;

SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;

CREATE FUNCTION public.clear_sample_data() RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare u uuid := (select auth.uid()); n integer;
begin
  delete from public.recurring where user_id = u and account_id in
    (select id from public.accounts where user_id = u and kind = 'manual' and name like 'Sample %');
  delete from public.accounts where user_id = u and kind = 'manual' and name like 'Sample %';
  get diagnostics n = row_count;
  if not exists (select 1 from public.transactions where user_id = u) then
    delete from public.budgets where user_id = u;
  end if;
  return n;
end $$;

CREATE FUNCTION public.delete_plaid_token(p_secret_id uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  delete from vault.secrets where id = p_secret_id;
$$;

CREATE FUNCTION public.load_sample_data() RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  u uuid := (select auth.uid());
  chq uuid; sav uuid; card uuid; loan uuid;
  m date; d date; i int; amt numeric; t1 uuid; t2 uuid; s text[];
  today date := current_date;
  first_month date := (date_trunc('month', current_date) - interval '5 months')::date;
  payday date;
  spends text[][] := array[
    ['Fresh Mart',         'Groceries',         '35', '140', '4',  '1'],
    ['Corner Grocer',      'Groceries',         '8',  '40',  '6',  '3'],
    ['Noodle House',       'Restaurants',       '14', '48',  '5',  '2'],
    ['Daily Grind Coffee', 'Restaurants',       '4',  '9',   '3',  '0'],
    ['Petro Stop',         'Gas',               '40', '75',  '9',  '4'],
    ['City Parking',       'Parking & Transit', '4',  '18',  '8',  '5'],
    ['Online Marketplace', 'Shopping',          '12', '120', '7',  '6'],
    ['Pharmacy Plus',      'Personal Care',     '9',  '45',  '13', '7'],
    ['Cinema Six',         'Entertainment',     '15', '38',  '17', '9'],
    ['Hardware Depot',     'Home',              '10', '90',  '23', '11']
  ];
begin
  if u is null then raise exception 'Sign in first.'; end if;
  if exists (select 1 from public.transactions where user_id = u) then
    raise exception 'Sample data is only for an empty account. This one already has transactions.';
  end if;
  payday := first_month + ((5 - extract(dow from first_month)::int + 7) % 7);

  insert into public.accounts (user_id, kind, name, mask, type, subtype, start_balance, plan_include, plan_buffer)
    values (u, 'manual', 'Sample Checking', '1001', 'depository', 'checking', 2400, true, 200) returning id into chq;
  insert into public.accounts (user_id, kind, name, mask, type, subtype, start_balance)
    values (u, 'manual', 'Sample Savings', '1002', 'depository', 'savings', 5000) returning id into sav;
  insert into public.accounts (user_id, kind, name, mask, type, subtype, start_balance, credit_limit, statement_day, due_day, apr)
    values (u, 'manual', 'Sample Credit Card', '4242', 'credit', 'credit card', -350, 5000, 20, 12, 20.99) returning id into card;
  insert into public.accounts (user_id, kind, name, mask, type, subtype, start_balance, apr)
    values (u, 'manual', 'Sample Car Loan', '7001', 'loan', 'loan', -14500, 6.5) returning id into loan;

  for i in 0..5 loop
    m := (first_month + make_interval(months => i))::date;

    insert into public.transactions (user_id, account_id, date, amount, name, merchant, category_id, category_source, reviewed)
    select u, chq, m + x.day - 1, -x.amt, x.name, x.name, c.id, 'manual', true
    from (values (1, 1450.00, 'Maple Property Rent', 'Rent'), (5, 16.49, 'Streamflix', 'Subscriptions'),
                 (9, 11.99, 'Tunebox', 'Subscriptions'), (12, 85.00, 'Northern Mobile', 'Phone & Internet'),
                 (16, 96.40, 'City Power & Water', 'Utilities'), (20, 162.00, 'Shield Auto Insurance', 'Car Insurance')) as x(day, amt, name, cat)
    join public.categories c on c.user_id = u and c.name = x.cat
    where m + x.day - 1 <= today;

    d := m + 14;
    if d <= today then
      insert into public.transactions (user_id, account_id, date, amount, name, merchant, category_id, category_source, reviewed)
        select u, chq, d, -320, 'Car Loan Payment', 'Car Loan Payment', c.id, 'manual', true
        from public.categories c where c.user_id = u and c.name = 'Car Payment';
      insert into public.transactions (user_id, account_id, date, amount, name, merchant, category_source, reviewed, is_transfer, source)
        values (u, loan, d, 320, 'Payment received', 'Payment received', 'manual', true, true, 'loan');
    end if;

    d := m + 2;
    if d <= today then
      insert into public.transactions (user_id, account_id, date, amount, name, category_id, category_source, reviewed, is_transfer)
        select u, chq, d, -200, 'Transfer to Savings', c.id, 'manual', true, true from public.categories c where c.user_id = u and c.name = 'Transfer' returning id into t1;
      insert into public.transactions (user_id, account_id, date, amount, name, category_id, category_source, reviewed, is_transfer, transfer_pair_id)
        select u, sav, d, 200, 'Transfer from Checking', c.id, 'manual', true, true, t1 from public.categories c where c.user_id = u and c.name = 'Transfer' returning id into t2;
      update public.transactions set transfer_pair_id = t2 where id = t1;
    end if;
    d := m + 11;
    if d <= today and i > 0 then
      amt := 1500 + round((random() * 300)::numeric, 2);
      insert into public.transactions (user_id, account_id, date, amount, name, category_id, category_source, reviewed, is_transfer)
        select u, chq, d, -amt, 'Card Payment', c.id, 'manual', true, true from public.categories c where c.user_id = u and c.name = 'Credit Card Payment' returning id into t1;
      insert into public.transactions (user_id, account_id, date, amount, name, category_id, category_source, reviewed, is_transfer, transfer_pair_id)
        select u, card, d, amt, 'Payment - Thank You', c.id, 'manual', true, true, t1 from public.categories c where c.user_id = u and c.name = 'Credit Card Payment' returning id into t2;
      update public.transactions set transfer_pair_id = t2 where id = t1;
    end if;

    insert into public.budgets (user_id, month, category_id, amount)
    select u, m, c.id, x.amt
    from (values ('Groceries', 600), ('Restaurants', 220), ('Gas', 200), ('Parking & Transit', 50), ('Shopping', 200),
                 ('Personal Care', 60), ('Entertainment', 80), ('Home', 100), ('Rent', 1450), ('Utilities', 100), ('Subscriptions', 30),
                 ('Phone & Internet', 85), ('Car Insurance', 162), ('Car Payment', 320)) as x(cat, amt)
    join public.categories c on c.user_id = u and c.name = x.cat
    where not exists (select 1 from public.budgets b where b.user_id = u and b.month = m and b.category_id = c.id);
  end loop;

  insert into public.transactions (user_id, account_id, date, amount, name, merchant, category_id, category_source, reviewed)
  select u, chq, g::date, 1950.00, 'Payroll Deposit - Acme Co', 'Acme Co', c.id, 'manual', true
  from generate_series(payday, today, interval '14 days') g
  join public.categories c on c.user_id = u and c.name = 'Paycheck';

  -- everyday card spending; the last week is left unreviewed so there is something to review
  foreach s slice 1 in array spends loop
    insert into public.transactions (user_id, account_id, date, amount, name, merchant, category_id, category_source, reviewed)
    select u, card, g::date, -round((s[3]::numeric + random() * (s[4]::numeric - s[3]::numeric))::numeric, 2),
           upper(s[1]) || ' #' || (100 + floor(random() * 900))::int, s[1], c.id, 'manual', g::date < today - 6
    from generate_series(first_month + s[6]::int, today, make_interval(days => s[5]::int)) g
    join public.categories c on c.user_id = u and c.name = s[2];
  end loop;

  insert into public.recurring (user_id, name, kind, amount, frequency, start_date, account_id, category_id, match_text)
  select u, x.name, x.kind, x.amt, x.freq, x.start, chq, c.id, x.match
  from (values ('Rent', 'bill', 1450.00, 'monthly', first_month, 'Rent', 'Maple Property'),
               ('Streamflix', 'bill', 16.49, 'monthly', first_month + 4, 'Subscriptions', 'Streamflix'),
               ('Tunebox', 'bill', 11.99, 'monthly', first_month + 8, 'Subscriptions', 'Tunebox'),
               ('Phone', 'bill', 85.00, 'monthly', first_month + 11, 'Phone & Internet', 'Northern Mobile'),
               ('Power & water', 'bill', 96.40, 'monthly', first_month + 15, 'Utilities', 'City Power'),
               ('Car insurance', 'bill', 162.00, 'monthly', first_month + 19, 'Car Insurance', 'Shield Auto'),
               ('Car loan', 'bill', 320.00, 'monthly', first_month + 14, 'Car Payment', 'Car Loan Payment'),
               ('Pay', 'income', 1950.00, 'biweekly', payday, 'Paycheck', 'Payroll Deposit')
       ) as x(name, kind, amt, freq, start, cat, match)
  join public.categories c on c.user_id = u and c.name = x.cat;

  return (select count(*)::int from public.transactions where user_id = u);
end $$;

CREATE FUNCTION public.merchant_list(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_accounts uuid[] DEFAULT NULL::uuid[]) RETURNS TABLE(merchant text, txns bigint, total numeric, last_date date)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select coalesce(nullif(t.merchant, ''), t.name), count(*), sum(t.amount), max(t.date)
  from public.transactions t
  where coalesce(nullif(t.merchant, ''), t.name) is not null
    and (p_from is null or t.date >= p_from)
    and (p_to is null or t.date <= p_to)
    and (p_accounts is null or t.account_id = any(p_accounts))
  group by 1
  order by 2 desc;
$$;

CREATE FUNCTION public.merchant_logos() RETURNS TABLE(merchant text, logo_url text, website text)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select coalesce(nullif(t.merchant, ''), t.name), max(t.logo_url), max(t.website)
  from public.transactions t
  where t.logo_url is not null or t.website is not null
  group by 1;
$$;

CREATE FUNCTION public.merchant_names() RETURNS TABLE(merchant text, txns bigint)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select display_name, count(*) from public.transaction_list group by 1 order by 2 desc, 1 limit 2000;
$$;

CREATE FUNCTION public.read_plaid_token(p_secret_id uuid) RETURNS text
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select decrypted_secret from vault.decrypted_secrets where id = p_secret_id;
$$;

CREATE FUNCTION public.report_category_months(p_from date, p_to date) RETURNS TABLE(month date, category_id uuid, kind text, total numeric, txns bigint)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select l.month, l.category_id, l.kind, sum(l.amount), count(*)
  from public.transaction_lines l
  where l.date between p_from and p_to
  group by 1, 2, 3
  order by 1, 2;
$$;

CREATE FUNCTION public.report_merchants(p_from date, p_to date, p_category uuid DEFAULT NULL::uuid, p_kind text DEFAULT 'expense'::text) RETURNS TABLE(merchant text, total numeric, txns bigint)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select l.merchant, sum(l.amount), count(*)
  from public.transaction_lines l
  where l.date between p_from and p_to
    and l.kind = p_kind
    and (p_category is null or l.category_id = p_category)
  group by 1
  order by case when p_kind = 'income' then -sum(l.amount) else sum(l.amount) end
  limit 200;
$$;

CREATE FUNCTION public.report_months(p_from date DEFAULT '1900-01-01'::date, p_to date DEFAULT '2999-12-31'::date) RETURNS TABLE(month date, income numeric, spending numeric, txns bigint)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select l.month,
         coalesce(sum(l.amount) filter (where l.kind = 'income'), 0),
         coalesce(sum(l.amount) filter (where l.kind = 'expense'), 0),
         count(*)
  from public.transaction_lines l
  where l.date between p_from and p_to
  group by 1
  order by 1 desc;
$$;

CREATE FUNCTION public.seed_default_categories() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  insert into public.categories (user_id, name, group_name, kind, sort) values
    (new.id, 'Paycheck', 'Income', 'income', 10),
    (new.id, 'Refunds', 'Income', 'income', 12),
    (new.id, 'Other Income', 'Income', 'income', 13),
    (new.id, 'Groceries', 'Food', 'expense', 20),
    (new.id, 'Restaurants', 'Food', 'expense', 21),
    (new.id, 'Rent', 'Home', 'expense', 30),
    (new.id, 'Utilities', 'Home', 'expense', 31),
    (new.id, 'Home', 'Home', 'expense', 32),
    (new.id, 'Gas', 'Transport', 'expense', 40),
    (new.id, 'Car Insurance', 'Transport', 'expense', 41),
    (new.id, 'Car Payment', 'Transport', 'expense', 42),
    (new.id, 'Parking & Transit', 'Transport', 'expense', 43),
    (new.id, 'Phone & Internet', 'Bills', 'expense', 50),
    (new.id, 'Subscriptions', 'Bills', 'expense', 51),
    (new.id, 'Interest & Fees', 'Bills', 'expense', 52),
    (new.id, 'Shopping', 'Shopping', 'expense', 60),
    (new.id, 'Personal Care', 'Shopping', 'expense', 61),
    (new.id, 'Health', 'Health', 'expense', 70),
    (new.id, 'Education', 'Education', 'expense', 75),
    (new.id, 'Entertainment', 'Fun', 'expense', 80),
    (new.id, 'Travel', 'Fun', 'expense', 81),
    (new.id, 'Gifts', 'Fun', 'expense', 82),
    (new.id, 'Other', 'Other', 'expense', 99),
    (new.id, 'Transfer', 'Transfers', 'transfer', 100),
    (new.id, 'Credit Card Payment', 'Transfers', 'transfer', 101);
  return new;
end $$;

CREATE FUNCTION public.set_balance_today(p_account uuid, p_balance numeric) RETURNS void
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  update public.accounts
  set start_balance = p_balance - coalesce((select sum(t.amount) from public.transactions t where t.account_id = p_account), 0)
  where id = p_account and kind = 'manual';
$$;

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end $$;

CREATE FUNCTION public.store_plaid_token(p_token text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare sid uuid;
begin
  select vault.create_secret(p_token, null, 'Plaid access token') into sid;
  return sid;
end $$;

CREATE TABLE public.accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    plaid_item_id uuid,
    plaid_account_id text,
    kind text DEFAULT 'manual'::text NOT NULL,
    name text NOT NULL,
    official_name text,
    mask text,
    type text,
    subtype text,
    currency text DEFAULT 'USD'::text NOT NULL,
    current_balance numeric(14,2),
    available_balance numeric(14,2),
    balance_updated_at timestamp with time zone,
    is_hidden boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    start_balance numeric(14,2),
    plan_include boolean DEFAULT false NOT NULL,
    plan_buffer numeric(14,2) DEFAULT 0 NOT NULL,
    credit_limit numeric(14,2),
    statement_day smallint,
    due_day smallint,
    apr numeric(6,3),
    icon text,
    loan_payment_match text,
    loan_paying_account_id uuid,
    loan_last_balance numeric(14,2),
    loan_last_balance_date date,
    CONSTRAINT accounts_due_day_check CHECK (((due_day >= 1) AND (due_day <= 31))),
    CONSTRAINT accounts_kind_check CHECK ((kind = ANY (ARRAY['plaid'::text, 'manual'::text]))),
    CONSTRAINT accounts_statement_day_check CHECK (((statement_day >= 1) AND (statement_day <= 31)))
);

CREATE TABLE public.transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    account_id uuid NOT NULL,
    plaid_transaction_id text,
    source text DEFAULT 'manual'::text NOT NULL,
    date date NOT NULL,
    authorized_date date,
    amount numeric(14,2) NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    name text NOT NULL,
    merchant text,
    category_id uuid,
    category_source text,
    plaid_category text,
    reviewed boolean DEFAULT false NOT NULL,
    reviewed_at timestamp with time zone,
    is_transfer boolean DEFAULT false NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    original_date date,
    original_amount numeric(14,2),
    import_id text,
    transfer_pair_id uuid,
    logo_url text,
    website text,
    CONSTRAINT transactions_category_source_check CHECK ((category_source = ANY (ARRAY['rule'::text, 'learned'::text, 'plaid'::text, 'manual'::text]))),
    CONSTRAINT transactions_source_check CHECK ((source = ANY (ARRAY['plaid'::text, 'csv'::text, 'manual'::text, 'loan'::text, 'import'::text])))
);

CREATE VIEW public.account_balances WITH (security_invoker='true') AS
 SELECT a.id,
    a.user_id,
    a.plaid_item_id,
    a.plaid_account_id,
    a.kind,
    a.name,
    a.official_name,
    a.mask,
    a.type,
    a.subtype,
    a.currency,
    a.current_balance,
    a.available_balance,
    a.balance_updated_at,
    a.is_hidden,
    a.created_at,
    a.updated_at,
    a.start_balance,
    a.plan_include,
    a.plan_buffer,
    a.credit_limit,
    a.statement_day,
    a.due_day,
    a.apr,
    a.icon,
    a.loan_payment_match,
    a.loan_paying_account_id,
    a.loan_last_balance,
    a.loan_last_balance_date,
        CASE
            WHEN ((a.kind = 'manual'::text) AND (a.start_balance IS NOT NULL)) THEN ((
            CASE
                WHEN (a.type = ANY (ARRAY['credit'::text, 'loan'::text])) THEN '-1'::integer
                ELSE 1
            END)::numeric * (a.start_balance + COALESCE(s.total, (0)::numeric)))
            ELSE a.current_balance
        END AS balance,
        CASE
            WHEN ((a.kind = 'manual'::text) AND (a.start_balance IS NOT NULL)) THEN s.last_change
            ELSE a.balance_updated_at
        END AS balance_as_of
   FROM (public.accounts a
     LEFT JOIN LATERAL ( SELECT sum(t.amount) AS total,
            max(t.updated_at) AS last_change
           FROM public.transactions t
          WHERE (t.account_id = a.id)) s ON (true));

CREATE TABLE public.budgets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    month date NOT NULL,
    category_id uuid,
    group_name text,
    amount numeric(14,2) DEFAULT 0 NOT NULL,
    rollover boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT budgets_check CHECK (((category_id IS NULL) <> (group_name IS NULL))),
    CONSTRAINT budgets_month_check CHECK ((EXTRACT(day FROM month) = (1)::numeric))
);

CREATE TABLE public.categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    name text NOT NULL,
    group_name text DEFAULT 'Other'::text NOT NULL,
    kind text DEFAULT 'expense'::text NOT NULL,
    is_hidden boolean DEFAULT false NOT NULL,
    sort integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    icon text,
    CONSTRAINT categories_kind_check CHECK ((kind = ANY (ARRAY['expense'::text, 'income'::text, 'transfer'::text])))
);

CREATE TABLE public.category_groups (
    user_id uuid DEFAULT auth.uid() NOT NULL,
    name text NOT NULL,
    icon text
);

CREATE TABLE public.category_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    match_text text NOT NULL,
    category_id uuid NOT NULL,
    account_id uuid,
    min_amount numeric(14,2),
    max_amount numeric(14,2),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.merchant_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    match text NOT NULL,
    merchant text NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT merchant_rules_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'learned'::text])))
);

CREATE TABLE public.merchant_sites (
    user_id uuid DEFAULT auth.uid() NOT NULL,
    merchant text NOT NULL,
    domain text,
    image text,
    fill boolean DEFAULT true NOT NULL,
    CONSTRAINT merchant_sites_image_size CHECK (((image IS NULL) OR (length(image) < 200000)))
);

CREATE TABLE public.plaid_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    item_id text NOT NULL,
    institution_name text DEFAULT 'Unknown bank'::text NOT NULL,
    access_token_secret_id uuid NOT NULL,
    cursor text,
    status text DEFAULT 'ok'::text NOT NULL,
    error_code text,
    last_synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT plaid_items_status_check CHECK ((status = ANY (ARRAY['ok'::text, 'login_required'::text, 'error'::text])))
);

CREATE TABLE public.plan_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    date date NOT NULL,
    description text NOT NULL,
    amount numeric(14,2) NOT NULL,
    account_id uuid,
    to_account_id uuid,
    category_id uuid,
    recurring_id uuid,
    occurrence_date date,
    skipped boolean DEFAULT false NOT NULL,
    matched_transaction_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.recurring (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    name text NOT NULL,
    kind text DEFAULT 'bill'::text NOT NULL,
    amount numeric(14,2) NOT NULL,
    estimated boolean DEFAULT false NOT NULL,
    frequency text DEFAULT 'monthly'::text NOT NULL,
    start_date date NOT NULL,
    end_date date,
    account_id uuid,
    category_id uuid,
    match_text text,
    active boolean DEFAULT true NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    card_account_id uuid,
    card_rule text,
    CONSTRAINT recurring_card_rule_check CHECK ((card_rule = ANY (ARRAY['statement'::text, 'minimum'::text, 'custom'::text]))),
    CONSTRAINT recurring_frequency_check CHECK ((frequency = ANY (ARRAY['weekly'::text, 'biweekly'::text, 'monthly'::text, 'yearly'::text]))),
    CONSTRAINT recurring_kind_check CHECK ((kind = ANY (ARRAY['bill'::text, 'income'::text])))
);

CREATE TABLE public.sync_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    added integer DEFAULT 0 NOT NULL,
    message text
);

CREATE TABLE public.transaction_splits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    transaction_id uuid NOT NULL,
    category_id uuid,
    amount numeric(14,2) NOT NULL,
    notes text
);

CREATE VIEW public.transaction_lines WITH (security_invoker='true') AS
 SELECT t.id AS transaction_id,
    t.user_id,
    t.account_id,
    t.date,
    (date_trunc('month'::text, (t.date)::timestamp with time zone))::date AS month,
        CASE
            WHEN (s.id IS NULL) THEN t.category_id
            ELSE s.category_id
        END AS category_id,
    COALESCE(s.amount, t.amount) AS amount,
    COALESCE(NULLIF(t.merchant, ''::text), t.name) AS merchant,
    COALESCE(c.kind,
        CASE
            WHEN t.is_transfer THEN 'transfer'::text
            WHEN (COALESCE(s.amount, t.amount) < (0)::numeric) THEN 'expense'::text
            ELSE 'income'::text
        END) AS kind
   FROM ((public.transactions t
     LEFT JOIN public.transaction_splits s ON ((s.transaction_id = t.id)))
     LEFT JOIN public.categories c ON ((c.id =
        CASE
            WHEN (s.id IS NULL) THEN t.category_id
            ELSE s.category_id
        END)));

CREATE VIEW public.transaction_list WITH (security_invoker='true') AS
 SELECT t.id,
    t.user_id,
    t.account_id,
    t.date,
    t.amount,
    abs(t.amount) AS amount_abs,
    t.currency,
    t.name,
    t.merchant,
    COALESCE(NULLIF(t.merchant, ''::text), t.name) AS display_name,
    lower(COALESCE(NULLIF(t.merchant, ''::text), t.name)) AS sort_name,
    t.category_id,
    t.category_source,
    t.reviewed,
    t.notes,
    t.tags,
    t.is_transfer,
    t.source,
    t.transfer_pair_id,
    a.name AS account_name,
    a.mask AS account_mask,
    c.name AS category_name,
    c.group_name AS category_group,
    c.icon AS category_icon,
    COALESCE(sp.n, (0)::bigint) AS split_count,
        CASE
            WHEN (COALESCE(sp.n, (0)::bigint) > 0) THEN COALESCE(sp.category_ids, '{}'::uuid[])
            ELSE array_remove(ARRAY[t.category_id], NULL::uuid)
        END AS category_ids
   FROM (((public.transactions t
     JOIN public.accounts a ON ((a.id = t.account_id)))
     LEFT JOIN public.categories c ON ((c.id = t.category_id)))
     LEFT JOIN LATERAL ( SELECT count(*) AS n,
            array_agg(DISTINCT s.category_id) FILTER (WHERE (s.category_id IS NOT NULL)) AS category_ids
           FROM public.transaction_splits s
          WHERE (s.transaction_id = t.id)) sp ON (true));

CREATE TABLE public.user_prefs (
    user_id uuid DEFAULT auth.uid() NOT NULL,
    home_widgets text[],
    budget_widgets text[],
    watch_categories uuid[],
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    report_tabs jsonb,
    pages jsonb,
    menu_order text[],
    dismissed_suggestions text[],
    page_layouts jsonb,
    currency text,
    setup_done boolean DEFAULT false NOT NULL,
    CONSTRAINT user_prefs_currency_check CHECK ((currency ~ '^[A-Z]{3}$'::text))
);

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_plaid_account_id_key UNIQUE (plaid_account_id);

ALTER TABLE ONLY public.budgets
    ADD CONSTRAINT budgets_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_user_id_name_key UNIQUE (user_id, name);

ALTER TABLE ONLY public.category_groups
    ADD CONSTRAINT category_groups_pkey PRIMARY KEY (user_id, name);

ALTER TABLE ONLY public.category_rules
    ADD CONSTRAINT category_rules_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.merchant_rules
    ADD CONSTRAINT merchant_rules_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.merchant_rules
    ADD CONSTRAINT merchant_rules_user_id_match_key UNIQUE (user_id, match);

ALTER TABLE ONLY public.merchant_sites
    ADD CONSTRAINT merchant_sites_pkey PRIMARY KEY (user_id, merchant);

ALTER TABLE ONLY public.plaid_items
    ADD CONSTRAINT plaid_items_item_id_key UNIQUE (item_id);

ALTER TABLE ONLY public.plaid_items
    ADD CONSTRAINT plaid_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.plan_entries
    ADD CONSTRAINT plan_entries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.plan_entries
    ADD CONSTRAINT plan_entries_recurring_id_occurrence_date_key UNIQUE (recurring_id, occurrence_date);

ALTER TABLE ONLY public.recurring
    ADD CONSTRAINT recurring_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sync_runs
    ADD CONSTRAINT sync_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.transaction_splits
    ADD CONSTRAINT transaction_splits_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_plaid_transaction_id_key UNIQUE (plaid_transaction_id);

ALTER TABLE ONLY public.user_prefs
    ADD CONSTRAINT user_prefs_pkey PRIMARY KEY (user_id);

CREATE UNIQUE INDEX budgets_month_category ON public.budgets USING btree (user_id, month, category_id) WHERE (category_id IS NOT NULL);

CREATE UNIQUE INDEX budgets_month_group ON public.budgets USING btree (user_id, month, group_name) WHERE (group_name IS NOT NULL);

CREATE INDEX plan_entries_user_date ON public.plan_entries USING btree (user_id, date);

CREATE INDEX transaction_splits_txn ON public.transaction_splits USING btree (transaction_id);

CREATE INDEX transactions_account_date ON public.transactions USING btree (account_id, date DESC);

CREATE UNIQUE INDEX transactions_import_id ON public.transactions USING btree (user_id, import_id) WHERE (import_id IS NOT NULL);

CREATE INDEX transactions_tags ON public.transactions USING gin (tags);

CREATE INDEX transactions_transfer_pair ON public.transactions USING btree (transfer_pair_id) WHERE (transfer_pair_id IS NOT NULL);

CREATE INDEX transactions_unreviewed ON public.transactions USING btree (user_id, date DESC) WHERE (NOT reviewed);

CREATE INDEX transactions_user_date ON public.transactions USING btree (user_id, date DESC);

CREATE TRIGGER accounts_updated BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER budgets_updated BEFORE UPDATE ON public.budgets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER plaid_items_updated BEFORE UPDATE ON public.plaid_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER plan_entries_updated BEFORE UPDATE ON public.plan_entries FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER recurring_updated BEFORE UPDATE ON public.recurring FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER transactions_updated BEFORE UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_loan_paying_account_id_fkey FOREIGN KEY (loan_paying_account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_plaid_item_id_fkey FOREIGN KEY (plaid_item_id) REFERENCES public.plaid_items(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.budgets
    ADD CONSTRAINT budgets_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.budgets
    ADD CONSTRAINT budgets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.category_groups
    ADD CONSTRAINT category_groups_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.category_rules
    ADD CONSTRAINT category_rules_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.category_rules
    ADD CONSTRAINT category_rules_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.category_rules
    ADD CONSTRAINT category_rules_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.merchant_rules
    ADD CONSTRAINT merchant_rules_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.merchant_sites
    ADD CONSTRAINT merchant_sites_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.plaid_items
    ADD CONSTRAINT plaid_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.plan_entries
    ADD CONSTRAINT plan_entries_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.plan_entries
    ADD CONSTRAINT plan_entries_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.plan_entries
    ADD CONSTRAINT plan_entries_matched_transaction_id_fkey FOREIGN KEY (matched_transaction_id) REFERENCES public.transactions(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.plan_entries
    ADD CONSTRAINT plan_entries_recurring_id_fkey FOREIGN KEY (recurring_id) REFERENCES public.recurring(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.plan_entries
    ADD CONSTRAINT plan_entries_to_account_id_fkey FOREIGN KEY (to_account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.plan_entries
    ADD CONSTRAINT plan_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.recurring
    ADD CONSTRAINT recurring_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.recurring
    ADD CONSTRAINT recurring_card_account_id_fkey FOREIGN KEY (card_account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.recurring
    ADD CONSTRAINT recurring_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.recurring
    ADD CONSTRAINT recurring_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.sync_runs
    ADD CONSTRAINT sync_runs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.transaction_splits
    ADD CONSTRAINT transaction_splits_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.transaction_splits
    ADD CONSTRAINT transaction_splits_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.transaction_splits
    ADD CONSTRAINT transaction_splits_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_transfer_pair_id_fkey FOREIGN KEY (transfer_pair_id) REFERENCES public.transactions(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_prefs
    ADD CONSTRAINT user_prefs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.category_groups ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.category_rules ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.merchant_rules ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.merchant_sites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own accounts" ON public.accounts USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "own budgets" ON public.budgets USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "own categories" ON public.categories USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "own category groups" ON public.category_groups USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "own category rules" ON public.category_rules USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "own merchant rules" ON public.merchant_rules USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "own merchant sites" ON public.merchant_sites USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "own plan entries" ON public.plan_entries USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "own prefs" ON public.user_prefs USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "own recurring" ON public.recurring USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "own splits" ON public.transaction_splits USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "own transactions" ON public.transactions USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

ALTER TABLE public.plaid_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.plan_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read own items" ON public.plaid_items FOR SELECT USING ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "read own sync runs" ON public.sync_runs FOR SELECT USING ((user_id = ( SELECT auth.uid() AS uid)));

ALTER TABLE public.recurring ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sync_runs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.transaction_splits ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_prefs ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;

REVOKE ALL ON FUNCTION public.clear_sample_data() FROM PUBLIC;
GRANT ALL ON FUNCTION public.clear_sample_data() TO authenticated;
GRANT ALL ON FUNCTION public.clear_sample_data() TO service_role;

REVOKE ALL ON FUNCTION public.delete_plaid_token(p_secret_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_plaid_token(p_secret_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public.load_sample_data() FROM PUBLIC;
GRANT ALL ON FUNCTION public.load_sample_data() TO authenticated;
GRANT ALL ON FUNCTION public.load_sample_data() TO service_role;

REVOKE ALL ON FUNCTION public.merchant_list(p_from date, p_to date, p_accounts uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.merchant_list(p_from date, p_to date, p_accounts uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.merchant_list(p_from date, p_to date, p_accounts uuid[]) TO service_role;

REVOKE ALL ON FUNCTION public.merchant_logos() FROM PUBLIC;
GRANT ALL ON FUNCTION public.merchant_logos() TO authenticated;
GRANT ALL ON FUNCTION public.merchant_logos() TO service_role;

REVOKE ALL ON FUNCTION public.merchant_names() FROM PUBLIC;
GRANT ALL ON FUNCTION public.merchant_names() TO authenticated;
GRANT ALL ON FUNCTION public.merchant_names() TO service_role;

REVOKE ALL ON FUNCTION public.read_plaid_token(p_secret_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_plaid_token(p_secret_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public.report_category_months(p_from date, p_to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.report_category_months(p_from date, p_to date) TO authenticated;
GRANT ALL ON FUNCTION public.report_category_months(p_from date, p_to date) TO service_role;

REVOKE ALL ON FUNCTION public.report_merchants(p_from date, p_to date, p_category uuid, p_kind text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.report_merchants(p_from date, p_to date, p_category uuid, p_kind text) TO authenticated;
GRANT ALL ON FUNCTION public.report_merchants(p_from date, p_to date, p_category uuid, p_kind text) TO service_role;

REVOKE ALL ON FUNCTION public.report_months(p_from date, p_to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.report_months(p_from date, p_to date) TO authenticated;
GRANT ALL ON FUNCTION public.report_months(p_from date, p_to date) TO service_role;

REVOKE ALL ON FUNCTION public.seed_default_categories() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.set_balance_today(p_account uuid, p_balance numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_balance_today(p_account uuid, p_balance numeric) TO authenticated;
GRANT ALL ON FUNCTION public.set_balance_today(p_account uuid, p_balance numeric) TO service_role;

REVOKE ALL ON FUNCTION public.store_plaid_token(p_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.store_plaid_token(p_token text) TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.accounts TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.accounts TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.transactions TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.transactions TO service_role;

GRANT SELECT ON TABLE public.account_balances TO authenticated;
GRANT SELECT ON TABLE public.account_balances TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.budgets TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.budgets TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.categories TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.categories TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.category_groups TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.category_groups TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.category_rules TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.category_rules TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.merchant_rules TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.merchant_rules TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.merchant_sites TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.merchant_sites TO service_role;

GRANT SELECT ON TABLE public.plaid_items TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.plaid_items TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.plan_entries TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.plan_entries TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.recurring TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.recurring TO service_role;

GRANT SELECT ON TABLE public.sync_runs TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sync_runs TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.transaction_splits TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.transaction_splits TO service_role;

GRANT SELECT ON TABLE public.transaction_lines TO authenticated;
GRANT SELECT ON TABLE public.transaction_lines TO service_role;

GRANT SELECT ON TABLE public.transaction_list TO authenticated;
GRANT SELECT ON TABLE public.transaction_list TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_prefs TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_prefs TO service_role;

-- New users get the starter categories.
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.seed_default_categories();

