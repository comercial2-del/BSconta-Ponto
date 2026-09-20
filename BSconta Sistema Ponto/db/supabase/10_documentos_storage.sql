-- BSconta+ RH — Documentos: colunas extras + bucket de Storage + regras reais
-- =============================================================================
-- O protótipo anterior guardava os PDFs no navegador (IndexedDB/localStorage
-- — real "banco", só que preso naquele computador, sem RH e colaborador
-- verem o mesmo arquivo). Este script prepara o banco pra armazenar o
-- arquivo de verdade no Supabase Storage e liga isso a rh.documentos.

-- 1) Colunas que o fluxo (título do documento, nomes de arquivo) precisa e
--    o schema original não tinha — aditivo, idempotente.
alter table rh.documentos
  add column if not exists titulo text,
  add column if not exists arquivo_original_nome text,
  add column if not exists arquivo_assinado_nome text;

-- 2) O status usado de fato pela tela é mais simples que o do schema
--    original (PENDENTE / AGUARDANDO_IMPORTACAO / ASSINADO / PUBLICADO,
--    esse último pros holerites já publicados). Reescreve a constraint.
alter table rh.documentos drop constraint if exists documentos_status_check;
alter table rh.documentos add constraint documentos_status_check
  check (status in ('PENDENTE', 'AGUARDANDO_IMPORTACAO', 'ASSINADO', 'PUBLICADO'));

-- 3) Bucket privado de Storage pros PDFs (original + assinado). Privado =
--    "public" false: só é lido por quem a política de storage.objects
--    permitir — nunca por link direto sem autenticação.
insert into storage.buckets (id, name, public)
values ('documentos-rh', 'documentos-rh', false)
on conflict (id) do nothing;

-- 4) Políticas de acesso ao bucket. Convenção de caminho:
--    <colaborador_id>/<documento_id>/original-<nome>.pdf
--    <colaborador_id>/<documento_id>/assinado-<timestamp>-<nome>.pdf
--    RH/RH_ADMIN têm acesso total ao bucket; colaborador só lê/grava dentro
--    da própria pasta (primeiro segmento do caminho = o próprio
--    colaborador_id, verificado por rh.colaborador_atual()).
drop policy if exists "rh_staff select - documentos-rh" on storage.objects;
create policy "rh_staff select - documentos-rh" on storage.objects for select using (bucket_id = 'documentos-rh' and rh.is_rh_staff());
drop policy if exists "rh_staff insert - documentos-rh" on storage.objects;
create policy "rh_staff insert - documentos-rh" on storage.objects for insert with check (bucket_id = 'documentos-rh' and rh.is_rh_staff());
drop policy if exists "rh_staff update - documentos-rh" on storage.objects;
create policy "rh_staff update - documentos-rh" on storage.objects for update using (bucket_id = 'documentos-rh' and rh.is_rh_staff()) with check (bucket_id = 'documentos-rh' and rh.is_rh_staff());
drop policy if exists "rh_staff delete - documentos-rh" on storage.objects;
create policy "rh_staff delete - documentos-rh" on storage.objects for delete using (bucket_id = 'documentos-rh' and rh.is_rh_staff());

drop policy if exists "colaborador select propria pasta - documentos-rh" on storage.objects;
create policy "colaborador select propria pasta - documentos-rh" on storage.objects for select using (
  bucket_id = 'documentos-rh' and (storage.foldername(name))[1] = rh.colaborador_atual()::text
);
drop policy if exists "colaborador insert propria pasta - documentos-rh" on storage.objects;
create policy "colaborador insert propria pasta - documentos-rh" on storage.objects for insert with check (
  bucket_id = 'documentos-rh' and (storage.foldername(name))[1] = rh.colaborador_atual()::text
);

-- 5) O colaborador só pode SELECT em rh.documentos (política "self select"
--    já existente) — ele nunca tem UPDATE direto na tabela, porque RLS não
--    restringe coluna a coluna e ele não deveria poder editar tipo/título/
--    prazo do próprio documento. As duas funções abaixo (security definer)
--    dão a ele só as duas ações reais que precisa fazer sozinho —
--    registrar a assinatura e marcar "fui pro GOV.BR" — validando por
--    dentro que o documento é mesmo dele, sem abrir a tabela toda.

create or replace function rh.colaborador_marcar_aguardando_importacao(p_documento_id uuid)
returns void
language plpgsql
security definer
set search_path = rh, pg_temp
as $$
declare
  v_colaborador_id uuid;
begin
  select colaborador_id into v_colaborador_id from rh.documentos where id = p_documento_id;
  if v_colaborador_id is null then
    raise exception 'Documento não encontrado.';
  end if;
  if v_colaborador_id <> rh.colaborador_atual() then
    raise exception 'Você não tem permissão sobre este documento.';
  end if;
  update rh.documentos set status = 'AGUARDANDO_IMPORTACAO', updated_at = now() where id = p_documento_id;
end;
$$;
comment on function rh.colaborador_marcar_aguardando_importacao(uuid) is 'Colaborador marca o próprio documento como "foi pro GOV.BR, aguardando importar o assinado" — valida a posse do documento por dentro da função (security definer) antes de gravar.';

create or replace function rh.colaborador_registrar_assinatura(p_documento_id uuid, p_arquivo_path text, p_arquivo_nome text, p_metodo text)
returns void
language plpgsql
security definer
set search_path = rh, pg_temp
as $$
declare
  v_colaborador_id uuid;
begin
  select colaborador_id into v_colaborador_id from rh.documentos where id = p_documento_id;
  if v_colaborador_id is null then
    raise exception 'Documento não encontrado.';
  end if;
  if v_colaborador_id <> rh.colaborador_atual() then
    raise exception 'Você não tem permissão sobre este documento.';
  end if;
  update rh.documentos
  set arquivo_assinado_path = p_arquivo_path,
      arquivo_assinado_nome = p_arquivo_nome,
      status = 'ASSINADO',
      assinado_em = now(),
      metodo_assinatura = p_metodo,
      updated_at = now()
  where id = p_documento_id;
end;
$$;
comment on function rh.colaborador_registrar_assinatura(uuid, text, text, text) is 'Colaborador registra a assinatura do próprio documento (após subir o PDF assinado no Storage) — valida a posse por dentro antes de gravar; só toca nas colunas de assinatura, nunca em título/tipo/prazo.';

grant execute on function rh.colaborador_marcar_aguardando_importacao(uuid) to authenticated;
grant execute on function rh.colaborador_registrar_assinatura(uuid, text, text, text) to authenticated;
