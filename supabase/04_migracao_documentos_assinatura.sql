-- BSconta+ RH — evolução do módulo de Documentos para assinatura
-- Execute este arquivo DEPOIS de 01_schema_rh.sql quando o banco já existir.

alter table public.documentos drop constraint if exists documentos_status_check;
alter table public.documentos
  add constraint documentos_status_check
  check (status in ('PUBLICADO','PENDENTE','AGUARDANDO_IMPORTACAO','ASSINADO'));

alter table public.documentos add column if not exists titulo text;
alter table public.documentos add column if not exists workflow text not null default 'PUBLICADO';
alter table public.documentos add column if not exists origem text;
alter table public.documentos add column if not exists arquivo_nome text;
alter table public.documentos add column if not exists arquivo_path text;
alter table public.documentos add column if not exists arquivo_assinado_nome text;
alter table public.documentos add column if not exists arquivo_assinado_path text;
alter table public.documentos add column if not exists enviado_em timestamptz;
alter table public.documentos add column if not exists prazo_assinatura date;
alter table public.documentos add column if not exists assinado_em timestamptz;
alter table public.documentos add column if not exists metodo_assinatura text;
alter table public.documentos add column if not exists assinatura_observacao text;

update public.documentos set titulo = coalesce(titulo, tipo) where titulo is null;
update public.documentos set enviado_em = coalesce(enviado_em, created_at) where enviado_em is null;

create index if not exists documentos_workflow_idx on public.documentos(workflow);
create index if not exists documentos_enviado_em_idx on public.documentos(enviado_em);

-- O arquivo binário deve ficar no Supabase Storage, não diretamente na tabela.
insert into storage.buckets (id, name, public)
values ('documentos-rh', 'documentos-rh', false)
on conflict (id) do nothing;

-- Colaborador pode ler os próprios documentos; RH pode ler tudo.
drop policy if exists "documentos_select_colaborador_rh" on public.documentos;
create policy "documentos_select_colaborador_rh" on public.documentos for select
using (colaborador_id = auth.uid() or public.is_rh());

-- Somente RH cria e altera metadados de documentos. O upload do PDF assinado
-- deve passar por uma Edge Function que valide o arquivo e então atualize o
-- registro; isso evita que o cliente simplesmente marque um documento como assinado.
drop policy if exists "documentos_insert_rh" on public.documentos;
create policy "documentos_insert_rh" on public.documentos for insert
with check (public.is_rh());

drop policy if exists "documentos_update_rh" on public.documentos;
create policy "documentos_update_rh" on public.documentos for update
using (public.is_rh())
with check (public.is_rh());
