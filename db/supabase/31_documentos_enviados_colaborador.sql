-- =============================================================================
-- 31 — Documentos: COLABORADOR ENVIA documento para o RH
-- =============================================================================
-- Até aqui o módulo só tinha o caminho RH -> colaborador (assinatura ou
-- publicado). Este script abre o caminho inverso: o colaborador envia um
-- arquivo (atestado, comprovante de residência, certificado, etc.) e o RH
-- recebe, visualiza, baixa e marca como conferido.
--
-- Modelo:
--   * Mesma tabela rh.documentos, com workflow = 'ENVIADO_COLABORADOR'.
--   * status 'RECEBIDO'  = enviado pelo colaborador, aguardando o RH conferir.
--     status 'CONFERIDO' = RH conferiu/aceitou o documento.
--   * O arquivo fica no mesmo bucket privado "documentos-rh", na pasta do
--     próprio colaborador: <colaborador_id>/<documento_id>/enviado-<ts>-<nome>
--     (a política de INSERT do colaborador na própria pasta já existe — 10).
--   * O colaborador continua SEM insert/update direto em rh.documentos: a
--     criação passa pela função security definer abaixo, que força
--     colaborador_id = o próprio usuário, workflow, status e origem.
-- Idempotente: pode rodar mais de uma vez. Rode DEPOIS do 24.
-- =============================================================================

-- 1) Status novos
alter table rh.documentos drop constraint if exists documentos_status_check;
alter table rh.documentos add constraint documentos_status_check
  check (status in ('PENDENTE', 'AGUARDANDO_IMPORTACAO', 'ASSINADO', 'PUBLICADO', 'RECEBIDO', 'CONFERIDO'));

-- 2) Colunas de apoio
alter table rh.documentos add column if not exists observacao_colab text;
alter table rh.documentos add column if not exists conferido_em timestamptz;
alter table rh.documentos add column if not exists observacao_rh text;

comment on column rh.documentos.observacao_colab is 'Mensagem do colaborador ao enviar o documento para o RH (workflow ENVIADO_COLABORADOR).';
comment on column rh.documentos.conferido_em is 'Quando o RH marcou como conferido um documento enviado pelo colaborador.';
comment on column rh.documentos.observacao_rh is 'Retorno do RH ao conferir um documento enviado pelo colaborador (visível ao colaborador).';

-- 3) Colaborador envia documento (depois de subir o arquivo no Storage)
create or replace function rh.colaborador_enviar_documento(
  p_documento_id uuid,
  p_titulo text,
  p_tipo text,
  p_competencia text,
  p_observacao text,
  p_arquivo_path text,
  p_arquivo_nome text
)
returns uuid
language plpgsql
security definer
set search_path = rh, pg_temp
as $$
declare
  v_colaborador_id uuid := rh.colaborador_atual();
begin
  if v_colaborador_id is null then
    raise exception 'Seu login não está vinculado a um cadastro de colaborador.';
  end if;
  if coalesce(trim(p_tipo), '') = '' then
    raise exception 'Informe o tipo do documento.';
  end if;
  if coalesce(p_arquivo_path, '') = '' or split_part(p_arquivo_path, '/', 1) <> v_colaborador_id::text then
    raise exception 'Arquivo inválido: ele precisa estar na sua pasta.';
  end if;

  insert into rh.documentos (
    id, colaborador_id, titulo, tipo, competencia, status, workflow, origem,
    arquivo_original_path, arquivo_original_nome, observacao_colab, enviado_em
  ) values (
    coalesce(p_documento_id, gen_random_uuid()), v_colaborador_id,
    coalesce(nullif(trim(p_titulo), ''), p_tipo), trim(p_tipo), nullif(trim(p_competencia), ''),
    'RECEBIDO', 'ENVIADO_COLABORADOR', 'ENVIADO_COLABORADOR',
    p_arquivo_path, p_arquivo_nome, nullif(trim(p_observacao), ''), now()
  )
  returning id into p_documento_id;

  return p_documento_id;
end;
$$;
comment on function rh.colaborador_enviar_documento(uuid, text, text, text, text, text, text) is 'Colaborador envia um documento ao RH (atestado, comprovante...). Força colaborador_id = usuário logado, workflow ENVIADO_COLABORADOR e status RECEBIDO.';

-- 4) Colaborador pode cancelar um envio enquanto o RH ainda não conferiu
create or replace function rh.colaborador_cancelar_envio_documento(p_documento_id uuid)
returns text
language plpgsql
security definer
set search_path = rh, pg_temp
as $$
declare
  v_doc rh.documentos%rowtype;
begin
  select * into v_doc from rh.documentos where id = p_documento_id;
  if v_doc.id is null then
    raise exception 'Documento não encontrado.';
  end if;
  if v_doc.colaborador_id is distinct from rh.colaborador_atual() then
    raise exception 'Você não tem permissão sobre este documento.';
  end if;
  if v_doc.workflow <> 'ENVIADO_COLABORADOR' or v_doc.status <> 'RECEBIDO' then
    raise exception 'Só é possível cancelar um envio que o RH ainda não conferiu.';
  end if;
  delete from rh.documentos where id = p_documento_id;
  return v_doc.arquivo_original_path;
end;
$$;
comment on function rh.colaborador_cancelar_envio_documento(uuid) is 'Colaborador cancela um documento que ELE enviou e o RH ainda não conferiu. Retorna o caminho do arquivo para remoção do Storage.';

-- Colaborador pode apagar arquivos da própria pasta (usado só ao cancelar um
-- envio ainda não conferido, ou para limpar upload que falhou no meio).
drop policy if exists "colaborador delete propria pasta enviados - documentos-rh" on storage.objects;
create policy "colaborador delete propria pasta enviados - documentos-rh" on storage.objects for delete using (
  bucket_id = 'documentos-rh'
  and (storage.foldername(name))[1] = rh.colaborador_atual()::text
  and storage.filename(name) like 'enviado-%'
);

-- 5) Arquivar: agora também vale para documento enviado pelo colaborador
create or replace function rh.colaborador_arquivar_documento(p_documento_id uuid, p_arquivar boolean)
returns void
language plpgsql
security definer
set search_path = rh, pg_temp
as $$
declare
  v_doc rh.documentos%rowtype;
begin
  select * into v_doc from rh.documentos where id = p_documento_id;
  if v_doc.id is null then
    raise exception 'Documento não encontrado.';
  end if;
  if v_doc.colaborador_id is distinct from rh.colaborador_atual() then
    raise exception 'Você não tem permissão sobre este documento.';
  end if;
  if p_arquivar and not (v_doc.workflow in ('PUBLICADO', 'ENVIADO_COLABORADOR') or v_doc.status = 'ASSINADO') then
    raise exception 'Só é possível arquivar documentos já assinados, publicados ou enviados por você.';
  end if;
  update rh.documentos
     set arquivado_colab_em = case when p_arquivar then now() else null end,
         removido_colab_em = null,
         updated_at = now()
   where id = p_documento_id;
end;
$$;

grant execute on function rh.colaborador_enviar_documento(uuid, text, text, text, text, text, text) to authenticated;
grant execute on function rh.colaborador_cancelar_envio_documento(uuid) to authenticated;
grant execute on function rh.colaborador_arquivar_documento(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
