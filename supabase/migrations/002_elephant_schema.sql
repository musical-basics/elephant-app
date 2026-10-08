begin;

create schema if not exists elephant;
revoke all on schema elephant from public, anon, authenticated;
grant usage on schema elephant to service_role;

create table if not exists elephant.workspaces (
  id text primary key,
  data jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  constraint workspace_shape check (
    jsonb_typeof(data) = 'object'
    and data @> '{"version":1}'::jsonb
    and data ?& array['profile', 'settings', 'projects', 'items', 'queue', 'scheduledItems']
    and jsonb_typeof(data->'profile') = 'object'
    and jsonb_typeof(data->'settings') = 'object'
    and jsonb_typeof(data->'projects') = 'array'
    and jsonb_typeof(data->'items') = 'array'
    and jsonb_typeof(data->'queue') = 'array'
    and jsonb_typeof(data->'scheduledItems') = 'array'
  )
);

create table if not exists elephant.workspace_revisions (
  workspace_id text not null references elephant.workspaces(id),
  revision bigint not null,
  data jsonb not null,
  saved_at timestamptz not null,
  primary key (workspace_id, revision)
);

alter table elephant.workspaces enable row level security;
alter table elephant.workspace_revisions enable row level security;
revoke all on elephant.workspaces, elephant.workspace_revisions from public, anon, authenticated;
grant select, insert, update on elephant.workspaces to service_role;
grant select, insert, delete on elephant.workspace_revisions to service_role;

create or replace function elephant.version_workspace()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
  else
    if new.id <> old.id then raise exception 'Workspace identity cannot change'; end if;
    new.revision := old.revision + 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function elephant.snapshot_workspace()
returns trigger language plpgsql set search_path = '' as $$
begin
  insert into elephant.workspace_revisions(workspace_id, revision, data, saved_at)
    values (new.id, new.revision, new.data, new.updated_at);
  -- Preserve the original migration and the 50 most recent saves.
  delete from elephant.workspace_revisions
    where workspace_id = new.id and revision <> 1 and revision < new.revision - 49;
  return new;
end;
$$;

drop trigger if exists workspace_version on elephant.workspaces;
create trigger workspace_version before insert or update on elephant.workspaces
  for each row execute function elephant.version_workspace();
drop trigger if exists workspace_snapshot on elephant.workspaces;
create trigger workspace_snapshot after insert or update on elephant.workspaces
  for each row execute function elephant.snapshot_workspace();

-- Service-only RPCs keep elephant private without changing this shared
-- project's API schema exposure or any other app's policies.
create or replace function public.elephant_read_desktop(p_workspace_id text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('data', data, 'revision', revision, 'updatedAt', updated_at)
    from elephant.workspaces where id = p_workspace_id;
$$;

create or replace function public.elephant_save_desktop(
  p_workspace_id text, p_data jsonb, p_expected_revision bigint
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare saved elephant.workspaces%rowtype;
begin
  if p_expected_revision is null then
    insert into elephant.workspaces(id, data) values (p_workspace_id, p_data)
      on conflict (id) do nothing returning * into saved;
  elsif p_expected_revision > 0 then
    update elephant.workspaces set data = p_data
      where id = p_workspace_id and revision = p_expected_revision
      returning * into saved;
  else
    raise exception 'Invalid expected revision';
  end if;
  if saved.id is null then return null; end if;
  return jsonb_build_object('revision', saved.revision, 'updatedAt', saved.updated_at);
end;
$$;

revoke all on function elephant.version_workspace(), elephant.snapshot_workspace() from public, anon, authenticated;
revoke all on function public.elephant_read_desktop(text), public.elephant_save_desktop(text, jsonb, bigint) from public, anon, authenticated;
grant execute on function public.elephant_read_desktop(text), public.elephant_save_desktop(text, jsonb, bigint) to service_role;

notify pgrst, 'reload schema';
commit;
