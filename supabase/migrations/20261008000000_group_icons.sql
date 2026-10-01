-- Emoji per category group (the groups themselves are just names on categories).
create table public.category_groups (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  icon text,
  primary key (user_id, name)
);
alter table public.category_groups enable row level security;
create policy "own category groups" on public.category_groups for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
