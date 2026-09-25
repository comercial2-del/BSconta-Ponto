-- =============================================================================
-- 24 — Documentos: colaborador pode ARQUIVAR e depois EXCLUIR (da própria
-- visão) documentos já concluídos.
-- =============================================================================
-- Regras:
--   * Só dá para arquivar documento concluído: assinado (workflow ASSINATURA
--     + status ASSINADO) ou publicado (workflow PUBLICADO). Pendente de
--     assinatura nunca pode ser arquivado.
--   * "Excluir" só é possível depois de arquivar, e só REMOVE DA VISÃO DO
--     COLABORADOR (removido_colab_em). O registro e os PDFs continuam com o
--     RH — documento assinado tem valor legal e não pode sumir por um clique
--     do colaborador.
--   * O colaborador continua sem UPDATE direto em rh.documentos: tudo passa
--     pelas funções abaixo (security definer), que validam a posse.
-- Idempotente: pode rodar mais de uma vez.
-- =============================================================================

alter table rh.documentos add column if not exists arquivado_colab_em timestamptz;
alter table rh.documentos add column if not exists removido_colab_em timestamptz;

comment on column rh.documentos.arquivado_colab_em is 'Quando o colaborador arquivou o documento na tela dele (null = não arquivado).';
comment on column rh.documentos.removido_colab_em is 'Quando o colaborador excluiu o documento da tela dele (null = visível). O RH continua vendo o documento normalmente.';

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
  if p_arquivar and not (v_doc.workflow = 'PUBLICADO' or v_doc.status = 'ASSINADO') then
    raise exception 'Só é possível arquivar documentos já assinados ou publicados.';
  end if;
  update rh.documentos
     set arquivado_colab_em = case when p_arquivar then now() else null end,
         removido_colab_em = null,
         updated_at = now()
   where id = p_documento_id;
end;
$$;
comment on function rh.colaborador_arquivar_documento(uuid, boolean) is 'Colaborador arquiva/desarquiva o próprio documento concluído (assinado ou publicado). Valida a posse por dentro.';

create or replace function rh.colaborador_remover_documento(p_documento_id uuid)
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
  if v_doc.arquivado_colab_em is null then
    raise exception 'Arquive o documento antes de excluí-lo.';
  end if;
  update rh.documentos set removido_colab_em = now(), updated_at = now() where id = p_documento_id;
end;
$$;
comment on function rh.colaborador_remover_documento(uuid) is 'Colaborador exclui da PRÓPRIA tela um documento já arquivado. Não apaga o registro nem os PDFs — o RH continua com tudo.';

grant execute on function rh.colaborador_arquivar_documento(uuid, boolean) to authenticated;
grant execute on function rh.colaborador_remover_documento(uuid) to authenticated;

notify pgrst, 'reload schema';
