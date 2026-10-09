begin;

-- Export only Elephant's data from this shared project. The private schema
-- stays outside the Data API; only the server's service role may call this RPC.
-- STABLE makes every read, including dynamic queries, use the caller's one
-- statement snapshot, so workspace rows and their revision history agree.
create or replace function public.elephant_backup_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
declare
  table_ids oid[];
  function_ids oid[];
  table_record record;
  primary_key text[];
  row_order text;
  table_rows jsonb;
  tables_json jsonb := '[]'::jsonb;
  user_map_json jsonb := '[]'::jsonb;
  schema_json jsonb;
begin
  -- Partition roots include all their child rows when selected. Exporting
  -- the children again would duplicate them during a restore.
  select coalesce(array_agg(c.oid order by n.nspname, c.relname), '{}'::oid[])
    into table_ids
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('r', 'p')
     and not c.relispartition
     and (n.nspname = 'elephant'
       or (n.nspname = 'public' and left(c.relname, 9) = 'elephant_'));

  if not coalesce(pg_catalog.to_regclass('elephant.workspaces')::oid = any(table_ids), false)
     or not coalesce(pg_catalog.to_regclass('elephant.workspace_revisions')::oid = any(table_ids), false) then
    raise exception 'Elephant desktop tables are missing; refusing an incomplete backup';
  end if;

  select coalesce(array_agg(p.oid order by n.nspname, p.proname, p.oid), '{}'::oid[])
    into function_ids
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where p.prokind in ('f', 'p')
     and (n.nspname = 'elephant'
       or (n.nspname = 'public' and left(p.proname, 9) = 'elephant_'));

  for table_record in
    select c.oid, n.nspname as schema_name, c.relname as table_name
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where c.oid = any(table_ids)
     order by n.nspname, c.relname
  loop
    select coalesce(array_agg(a.attname::text order by key.ord), '{}'::text[])
      into primary_key
      from pg_catalog.pg_index i
      cross join lateral unnest(i.indkey) with ordinality as key(attnum, ord)
      join pg_catalog.pg_attribute a
        on a.attrelid = i.indrelid and a.attnum = key.attnum
     where i.indrelid = table_record.oid and i.indisprimary
       and key.ord <= i.indnkeyatts;

    select string_agg(format('source.%I', key_name), ', ' order by ord)
      into row_order
      from unnest(primary_key) with ordinality as key(key_name, ord);

    execute format(
      'select coalesce(jsonb_agg(to_jsonb(source)%s), ''[]''::jsonb) from %I.%I as source',
      case when row_order is null then '' else ' order by ' || row_order end,
      table_record.schema_name,
      table_record.table_name
    ) into table_rows;

    tables_json := tables_json || jsonb_build_array(jsonb_build_object(
      'schema', table_record.schema_name,
      'name', table_record.table_name,
      'primary_key', to_jsonb(primary_key),
      'rows', table_rows
    ));
  end loop;

  -- Account workspaces depend on the original auth UUID. Save a scoped
  -- UUID/email map for recovery, not other apps' users, passwords or sessions.
  -- This table is optional on desktop-only installations.
  if pg_catalog.to_regclass('public.elephant_workspaces')::oid = any(table_ids) then
    execute $query$
      select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'email', u.email) order by u.id), '[]'::jsonb)
        from auth.users u
       where exists (select 1 from public.elephant_workspaces w where w.user_id = u.id)
    $query$ into user_map_json;
  end if;

  select jsonb_build_object(
    'tables', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'schema', n.nspname, 'name', c.relname,
        'kind', c.relkind, 'row_security', c.relrowsecurity,
        'force_row_security', c.relforcerowsecurity,
        'partition_key', pg_catalog.pg_get_partkeydef(c.oid)
      ) order by n.nspname, c.relname), '[]'::jsonb)
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where c.oid = any(table_ids)
    ),
    'columns', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'table_schema', n.nspname, 'table_name', c.relname,
        'column_name', a.attname, 'ordinal_position', a.attnum,
        'data_type', pg_catalog.format_type(a.atttypid, a.atttypmod),
        'is_nullable', not a.attnotnull,
        'column_default', pg_catalog.pg_get_expr(d.adbin, d.adrelid),
        'identity', a.attidentity, 'generated', a.attgenerated
      ) order by n.nspname, c.relname, a.attnum), '[]'::jsonb)
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        join pg_catalog.pg_attribute a on a.attrelid = c.oid
        left join pg_catalog.pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
       where c.oid = any(table_ids) and a.attnum > 0 and not a.attisdropped
    ),
    'constraints', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'table_schema', n.nspname, 'table_name', c.relname,
        'constraint_name', con.conname, 'constraint_type', con.contype,
        'definition', pg_catalog.pg_get_constraintdef(con.oid, true),
        'validated', con.convalidated
      ) order by n.nspname, c.relname, con.conname), '[]'::jsonb)
        from pg_catalog.pg_constraint con
        join pg_catalog.pg_class c on c.oid = con.conrelid
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where c.oid = any(table_ids)
    ),
    'indexes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'table_schema', n.nspname, 'table_name', c.relname,
        'indexname', idx.relname, 'indexdef', pg_catalog.pg_get_indexdef(i.indexrelid)
      ) order by n.nspname, c.relname, idx.relname), '[]'::jsonb)
        from pg_catalog.pg_index i
        join pg_catalog.pg_class c on c.oid = i.indrelid
        join pg_catalog.pg_class idx on idx.oid = i.indexrelid
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where c.oid = any(table_ids)
    ),
    'functions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'schema', n.nspname, 'name', p.proname,
        'identity_arguments', pg_catalog.pg_get_function_identity_arguments(p.oid),
        'definition', pg_catalog.pg_get_functiondef(p.oid)
      ) order by n.nspname, p.proname, p.oid), '[]'::jsonb)
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where p.oid = any(function_ids)
    ),
    'triggers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'table_schema', n.nspname, 'table_name', c.relname,
        'name', t.tgname, 'enabled', t.tgenabled,
        'definition', pg_catalog.pg_get_triggerdef(t.oid, true)
      ) order by n.nspname, c.relname, t.tgname), '[]'::jsonb)
        from pg_catalog.pg_trigger t
        join pg_catalog.pg_class c on c.oid = t.tgrelid
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where c.oid = any(table_ids) and not t.tgisinternal
    ),
    'policies', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'table_schema', n.nspname, 'table_name', c.relname,
        'name', pol.polname, 'permissive', pol.polpermissive,
        'roles', (select coalesce(jsonb_agg(case when role_id = 0 then 'PUBLIC'
                   else pg_catalog.pg_get_userbyid(role_id) end order by role_id), '[]'::jsonb)
                    from unnest(pol.polroles) as role(role_id)),
        'command', pol.polcmd,
        'using', pg_catalog.pg_get_expr(pol.polqual, pol.polrelid),
        'with_check', pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid)
      ) order by n.nspname, c.relname, pol.polname), '[]'::jsonb)
        from pg_catalog.pg_policy pol
        join pg_catalog.pg_class c on c.oid = pol.polrelid
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where c.oid = any(table_ids)
    ),
    'grants', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'object_type', g.object_type, 'schema', g.schema_name, 'name', g.object_name,
        'identity_arguments', g.identity_arguments,
        'grantor', pg_catalog.pg_get_userbyid(g.grantor),
        'grantee', case when g.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(g.grantee) end,
        'privilege_type', g.privilege_type, 'is_grantable', g.is_grantable
      ) order by g.object_type, g.schema_name, g.object_name, g.identity_arguments,
                 g.grantee, g.privilege_type), '[]'::jsonb)
        from (
          select 'TABLE'::text as object_type, n.nspname as schema_name,
                 c.relname as object_name, null::text as identity_arguments, acl.*
            from pg_catalog.pg_class c
            join pg_catalog.pg_namespace n on n.oid = c.relnamespace
            cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) acl
           where c.oid = any(table_ids)
          union all
          select 'FUNCTION', n.nspname, p.proname,
                 pg_catalog.pg_get_function_identity_arguments(p.oid), acl.*
            from pg_catalog.pg_proc p
            join pg_catalog.pg_namespace n on n.oid = p.pronamespace
            cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
           where p.oid = any(function_ids)
          union all
          select 'SCHEMA', n.nspname, n.nspname, null::text, acl.*
            from pg_catalog.pg_namespace n
            cross join lateral pg_catalog.aclexplode(coalesce(n.nspacl, pg_catalog.acldefault('n', n.nspowner))) acl
           where n.nspname = 'elephant'
        ) g
    )
  ) into schema_json;

  return jsonb_build_object(
    'version', 1,
    'taken_at', statement_timestamp(),
    'tables', tables_json,
    'user_map', user_map_json,
    'schema', schema_json
  );
end;
$$;

revoke all on function public.elephant_backup_snapshot() from public, anon, authenticated;
grant execute on function public.elephant_backup_snapshot() to service_role;

notify pgrst, 'reload schema';
commit;
