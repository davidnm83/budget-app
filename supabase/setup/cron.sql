-- Daily bank sync at 5 AM (in APP_TIMEZONE, default America/Toronto).
-- Run this ONCE in the Supabase SQL Editor after deploying the Edge Functions.
-- Replace the two placeholders first. They are stored encrypted in Vault, not in this file.
-- CRON_SECRET must match the one you set with `supabase secrets set CRON_SECRET=...`.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select vault.create_secret('https://YOUR-PROJECT-REF.supabase.co', 'project_url');
select vault.create_secret('YOUR-CRON-SECRET', 'cron_secret');

-- pg_cron runs in UTC. 09:00 and 10:00 UTC cover 5 AM Toronto in both summer (EDT)
-- and winter (EST); the function only does the work in the run that lands at 5 AM local.
select cron.schedule(
  'plaid-daily-sync',
  '0 9,10 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/plaid-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{"scheduled": true}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

-- To check it:   select * from cron.job;   select * from cron.job_run_details order by start_time desc limit 5;
-- To remove it:  select cron.unschedule('plaid-daily-sync');
