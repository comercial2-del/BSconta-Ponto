-- =============================================================================
-- 32 — Solicitações: COLABORADOR RESPONDE na mesma conversa
-- =============================================================================
-- Até aqui só o RH escrevia em rh.solicitacoes.respostas. Quando o RH fazia
-- uma pergunta (ex.: "sua coordenadora pergunta se pode ser de 21/12 a
-- 04/01"), o colaborador não tinha como responder na mesma solicitação.
--
-- Este script cria uma função security definer que deixa o colaborador
-- ACRESCENTAR uma mensagem em `respostas` — e só isso:
--   * só na solicitação dele (colaborador_id = rh.colaborador_atual());
--   * só enquanto não estiver RESOLVIDA/RECUSADA;
--   * não altera status, categoria, descrição nem respostas anteriores;
--   * o autor é sempre o nome do cadastro (não dá para se passar pelo RH).
-- O colaborador continua SEM update direto em rh.solicitacoes (RLS do 01).
-- Idempotente: pode rodar mais de uma vez.
-- =============================================================================

create or replace function rh.colaborador_responder_solicitacao(
  p_solicitacao_id uuid,
  p_texto text
)
returns jsonb
language plpgsql
security definer
set search_path = rh, pg_temp
as $$
declare
  v_colaborador_id uuid := rh.colaborador_atual();
  v_nome text;
  v_status text;
  v_dono uuid;
  v_texto text := trim(coalesce(p_texto, ''));
  v_msg jsonb;
begin
  if v_colaborador_id is null then
    raise exception 'Seu login não está vinculado a um cadastro de colaborador.';
  end if;
  if v_texto = '' then
    raise exception 'Escreva sua resposta.';
  end if;
  if length(v_texto) > 2000 then
    raise exception 'A resposta pode ter no máximo 2000 caracteres.';
  end if;

  select s.colaborador_id, s.status into v_dono, v_status
    from rh.solicitacoes s
   where s.id = p_solicitacao_id
   for update;

  if v_dono is null or v_dono <> v_colaborador_id then
    raise exception 'Solicitação não encontrada.';
  end if;
  if v_status in ('RESOLVIDA', 'RECUSADA') then
    raise exception 'Esta solicitação já foi encerrada. Abra uma nova solicitação, se precisar.';
  end if;

  select c.nome into v_nome from rh.colaboradores c where c.id = v_colaborador_id;

  v_msg := jsonb_build_object(
    'autor', coalesce(v_nome, 'Colaborador') || ' (Colaborador)',
    'texto', v_texto,
    'data', to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD'),
    'origem', 'COLABORADOR'
  );

  update rh.solicitacoes
     set respostas = coalesce(respostas, '[]'::jsonb) || jsonb_build_array(v_msg)
   where id = p_solicitacao_id;

  return v_msg;
end;
$$;

revoke all on function rh.colaborador_responder_solicitacao(uuid, text) from public, anon;
grant execute on function rh.colaborador_responder_solicitacao(uuid, text) to authenticated;

comment on function rh.colaborador_responder_solicitacao(uuid, text) is
  'Colaborador acrescenta uma resposta (origem COLABORADOR) na própria solicitação aberta. Não altera status.';
