-- Pending transactions (shown greyed until the bank posts them) and the balance gap: how far an
-- account's balance has moved beyond the transactions the bank has listed so far.
alter table public.transactions add column if not exists pending boolean not null default false;

-- What the balance was when it last agreed with the transactions, and how far it has drifted since
-- (in the app's sign: money in positive). Written by the sync.
alter table public.accounts
  add column if not exists balance_anchor numeric(14,2),
  add column if not exists balance_anchor_at timestamptz,
  add column if not exists balance_gap numeric(14,2);

-- Lists show pending rows (with the flag); totals, budgets and reports leave them out until posted.
create or replace view public.transaction_list with (security_invoker = true) as
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
    COALESCE(sp.n, 0::bigint) AS split_count,
        CASE
            WHEN COALESCE(sp.n, 0::bigint) > 0 THEN COALESCE(sp.category_ids, '{}'::uuid[])
            ELSE array_remove(ARRAY[t.category_id], NULL::uuid)
        END AS category_ids,
    t.pending
   FROM public.transactions t
     JOIN public.accounts a ON a.id = t.account_id
     LEFT JOIN public.categories c ON c.id = t.category_id
     LEFT JOIN LATERAL ( SELECT count(*) AS n,
            array_agg(DISTINCT s.category_id) FILTER (WHERE s.category_id IS NOT NULL) AS category_ids
           FROM public.transaction_splits s
          WHERE s.transaction_id = t.id) sp ON true;

create or replace view public.transaction_lines with (security_invoker = true) as
 SELECT t.id AS transaction_id,
    t.user_id,
    t.account_id,
    t.date,
    date_trunc('month'::text, t.date::timestamp with time zone)::date AS month,
        CASE
            WHEN s.id IS NULL THEN t.category_id
            ELSE s.category_id
        END AS category_id,
    COALESCE(s.amount, t.amount) AS amount,
    COALESCE(NULLIF(t.merchant, ''::text), t.name) AS merchant,
    COALESCE(c.kind,
        CASE
            WHEN t.is_transfer THEN 'transfer'::text
            WHEN COALESCE(s.amount, t.amount) < 0::numeric THEN 'expense'::text
            ELSE 'income'::text
        END) AS kind
   FROM public.transactions t
     LEFT JOIN public.transaction_splits s ON s.transaction_id = t.id
     LEFT JOIN public.categories c ON c.id =
        CASE
            WHEN s.id IS NULL THEN t.category_id
            ELSE s.category_id
        END
  WHERE NOT t.pending;

CREATE OR REPLACE FUNCTION public.merchant_list(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_accounts uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(merchant text, txns bigint, total numeric, last_date date)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(nullif(t.merchant, ''), t.name), count(*), sum(t.amount), max(t.date)
  from public.transactions t
  where coalesce(nullif(t.merchant, ''), t.name) is not null
    and not t.pending
    and (p_from is null or t.date >= p_from)
    and (p_to is null or t.date <= p_to)
    and (p_accounts is null or t.account_id = any(p_accounts))
  group by 1
  order by 2 desc;
$function$;
