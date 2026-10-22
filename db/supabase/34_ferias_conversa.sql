-- =============================================================================
-- 34 — Férias: CONVERSA entre RH e colaborador na solicitação de férias
-- =============================================================================
-- As solicitações de férias (rh.ferias_solicitacoes) já aparecem na fila
-- consolidada de rh/solicitacoes.html, mas só com Aprovar/Recusar — não
-- havia como o RH conversar com o colaborador sobre o pedido (ex.: "sua
-- coordenadora pergunta se pode ser de 21/12 a 04/01").
--
-- Este script:
--   1. adiciona `respostas jsonb` em rh.ferias_solicitacoes (mesmo formato
--      de rh.solicitacoes.respostas: [{autor, texto, data, origem}]);
--   2. cria rh.colaborador_responder_ferias(), security definer, que deixa
--      o colaborador ACRESCENTAR uma mensagem — e só isso:
--        * só na solicitação dele (colaborador_id = rh.colaborador_atual());
--        * só enquanto não estiver arquivada;
--        * não altera status, datas, dias nem mensagens anteriores;
--        * o autor é sempre o nome do cadastro (não dá para se passar pelo RH).
--   O colaborador continua SEM update direto na tabela (RLS do 01).
--   O RH grava as próprias mensagens pela política "rh_staff all" que já existe.
-- Idempotente: pode rodar mais de uma vez. Não mexe em nenhum dado existente.
-- =============================================================================

alter table rh.ferias_solicitacoes
  add column if not exists respostas jsonb not null default '[]'::jsonb;

comment on column rh.ferias_solicitacoes.respostas is
  'Conversa RH x colaborador sobre o pedido de férias: [{autor, texto, data, origem: RH|COLABORADOR}].';

create or replace function rh.colaborador_responder_ferias(
  p_ferias_id uuid,
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
  v_dono uuid;
  v_arquivado boolean;
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

  select f.colaborador_id, coalesce(f.arquivado, false) into v_dono, v_arquivado
    from rh.ferias_solicitacoes f
   where f.id = p_ferias_id
   for update;

  if v_dono is null or v_dono <> v_colaborador_id then
    raise exception 'Solicitação de férias não encontrada.';
  end if;
  if v_arquivado then
    raise exception 'Esta conversa já foi encerrada pelo RH. Abra uma nova solicitação, se precisar.';
  end if;

  select c.nome into v_nome from rh.colaboradores c where c.id = v_colaborador_id;

  v_msg := jsonb_build_object(
    'autor', coalesce(v_nome, 'Colaborador') || ' (Colaborador)',
    'texto', v_texto,
    'data', to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD'),
    'origem', 'COLABORADOR'
  );

  update rh.ferias_solicitacoes
     set respostas = coalesce(respostas, '[]'::jsonb) || jsonb_build_array(v_msg)
   where id = p_ferias_id;

  return v_msg;
end;
$$;

revoke all on function rh.colaborador_responder_ferias(uuid, text) from public, anon;
grant execute on function rh.colaborador_responder_ferias(uuid, text) to authenticated;

comment on function rh.colaborador_responder_ferias(uuid, text) is
  'Colaborador acrescenta uma mensagem (origem COLABORADOR) na conversa da própria solicitação de férias. Não altera status.';

-- Faz o PostgREST enxergar a coluna/função nova sem esperar o cache expirar.
notify pgrst, 'reload schema';
