-- Run once in the chosen Supabase project's SQL editor (or via migrations).
-- One private workspace per account. The browser uses only a publishable/anon key.
begin;

create table public.elephant_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  constraint elephant_workspace_shape check (
    jsonb_typeof(data) = 'object'
    and data ?& array['version', 'profile', 'settings', 'projects', 'items', 'queue']
    and data @> '{"version":1}'::jsonb
    and jsonb_typeof(data -> 'profile') = 'object'
    and jsonb_typeof(data -> 'settings') = 'object'
    and jsonb_typeof(data -> 'projects') = 'array'
    and jsonb_typeof(data -> 'items') = 'array'
    and jsonb_typeof(data -> 'queue') = 'array'
  )
);

alter table public.elephant_workspaces enable row level security;
revoke all on public.elephant_workspaces from anon, authenticated;
grant select, insert, update on public.elephant_workspaces to authenticated;

create policy "Read own workspace" on public.elephant_workspaces
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Create own workspace" on public.elephant_workspaces
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Update own workspace" on public.elephant_workspaces
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create function public.elephant_workspace_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
  else
    if new.user_id <> old.user_id then
      raise exception 'Workspace ownership cannot change';
    end if;
    new.revision := old.revision + 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger elephant_workspace_version
  before insert or update on public.elephant_workspaces
  for each row execute function public.elephant_workspace_version();

commit;
