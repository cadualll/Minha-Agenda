-- Minha Agenda IA — estrutura do banco no Supabase.
-- Como usar: Supabase → SQL Editor → New query → cole TUDO → Run.
-- Pode rodar de novo sem problema (é idempotente).
-- Depois disso, crie a função "lembretes" (arquivo supabase/funcao-lembretes/index.ts) — veja o README.

-- 1) Tabela única de itens sincronizados (tarefas, listas e configurações).
create table if not exists public.items (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('task', 'list', 'settings')),
  data jsonb not null default '{}'::jsonb,
  deleted boolean not null default false,
  updated_at timestamptz not null,            -- quando o aparelho alterou
  server_updated_at timestamptz not null default now()  -- quando o servidor gravou (cursor de sincronização)
);
create index if not exists items_user_sync_idx on public.items (user_id, server_updated_at);

-- 2) "Última alteração vence": se chegar uma versão mais antiga, o servidor mantém a atual.
create or replace function public.items_before_write() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;               -- ninguém troca o dono do item
    if new.updated_at < old.updated_at then
      return old;                             -- ignora a versão antiga
    end if;
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists items_before_write on public.items;
create trigger items_before_write before insert or update on public.items
for each row execute function public.items_before_write();

-- 3) Segurança: cada usuário só enxerga e altera os próprios itens.
alter table public.items enable row level security;
drop policy if exists "items_select_own" on public.items;
drop policy if exists "items_insert_own" on public.items;
drop policy if exists "items_update_own" on public.items;
drop policy if exists "items_delete_own" on public.items;
create policy "items_select_own" on public.items for select to authenticated using (user_id = auth.uid());
create policy "items_insert_own" on public.items for insert to authenticated with check (user_id = auth.uid());
create policy "items_update_own" on public.items for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "items_delete_own" on public.items for delete to authenticated using (user_id = auth.uid());

-- 4) Anexos: bucket privado "anexos", 25 MB por arquivo; cada usuário usa só a própria pasta.
insert into storage.buckets (id, name, public, file_size_limit)
values ('anexos', 'anexos', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;

drop policy if exists "anexos_select_own" on storage.objects;
drop policy if exists "anexos_insert_own" on storage.objects;
drop policy if exists "anexos_update_own" on storage.objects;
drop policy if exists "anexos_delete_own" on storage.objects;
create policy "anexos_select_own" on storage.objects for select to authenticated
  using (bucket_id = 'anexos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "anexos_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'anexos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "anexos_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'anexos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "anexos_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'anexos' and (storage.foldername(name))[1] = auth.uid()::text);

-- 5) Avisos enviados pelo servidor (Web Push), mesmo com o app fechado.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Aparelhos (celular, PC) que recebem avisos.
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null default 'web',   -- 'web' (navegador/PC) ou 'fcm' (app Android)
  p256dh text,
  auth text,
  device text,
  created_at timestamptz not null default now(),
  last_ok timestamptz
);
alter table public.push_subscriptions add column if not exists kind text not null default 'web';
alter table public.push_subscriptions alter column p256dh drop not null;
alter table public.push_subscriptions alter column auth drop not null;
alter table public.push_subscriptions enable row level security;
drop policy if exists "subs_own" on public.push_subscriptions;
create policy "subs_own" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Controle interno (só a função "lembretes" acessa; o app não enxerga).
create table if not exists public.push_sent (key text primary key, sent_at timestamptz not null default now());
create table if not exists public.push_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fire_at timestamptz not null,
  payload jsonb not null,
  sent_at timestamptz
);
create table if not exists public.agenda_config (chave text primary key, valor text not null);
alter table public.push_sent enable row level security;
alter table public.push_queue enable row level security;
alter table public.agenda_config enable row level security;
insert into public.agenda_config (chave, valor)
values ('cron_secret', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (chave) do nothing;

-- Chamado a cada minuto pelo agendador: aciona a função "lembretes".
create or replace function public.disparar_lembretes() returns void
language plpgsql security definer set search_path = public as $$
declare v_url text; v_secret text;
begin
  select valor into v_url from public.agenda_config where chave = 'function_url';
  select valor into v_secret from public.agenda_config where chave = 'cron_secret';
  if v_url is null then return; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
end $$;
revoke all on function public.disparar_lembretes() from public, anon, authenticated;

-- O app chama esta função ao ativar os avisos: grava o endereço da função e liga o agendador.
create or replace function public.configurar_lembretes(p_url text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Faça login.'; end if;
  if p_url !~ '^https://[a-z0-9-]+\.supabase\.(co|in)$' then raise exception 'Endereço do Supabase inválido.'; end if;
  insert into public.agenda_config (chave, valor) values ('function_url', p_url || '/functions/v1/lembretes')
  on conflict (chave) do update set valor = excluded.valor;
  perform cron.schedule('minha-agenda-lembretes', '* * * * *', 'select public.disparar_lembretes()');
  return 'ok';
end $$;
revoke all on function public.configurar_lembretes(text) from public, anon;
grant execute on function public.configurar_lembretes(text) to authenticated;

-- 6) Permissões explícitas (alguns projetos novos não dão acesso automático às tabelas).
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on public.items to authenticated, service_role;
grant select, insert, update, delete on public.push_subscriptions to authenticated, service_role;
grant select, insert, update, delete on public.push_sent, public.push_queue, public.agenda_config to service_role;
revoke all on public.push_sent, public.push_queue, public.agenda_config from anon, authenticated;
