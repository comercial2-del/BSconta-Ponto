-- =============================================================================
-- 36 — Benefícios (coraçãozinho) ligados ao Vale-refeição e ao Vale-transporte
-- =============================================================================
-- Fluxo novo (22/10/2026):
--   * Na aba Benefícios o RH cadastra o benefício, escolhe para quem é
--     (todos / específicos) e informa o VALOR POR DIA de cada colaborador
--     (rh.beneficio_valores_fixos.valor).
--   * Categoria ALIMENTACAO  -> puxa para a aba Vale-refeição.
--     Categoria TRANSPORTE   -> puxa para a aba Vale-transporte.
--   * No fechamento do mês o RH escolhe o PERÍODO (ex.: dia 1 a 30, dia 1 a 21);
--     os dias do período × valor por dia = total. O período fica gravado.
--   * O colaborador passa a ver o próprio VR/VT dos meses FECHADOS.
--
-- O que este SQL faz:
--   1) periodo_inicio / periodo_fim em rh.vr_mensal e rh.vt_mensal.
--   2) Colaborador lê as próprias linhas FECHADAS de VR/VT (somente leitura).
--   3) Cria os benefícios "Vale-refeição" e "Vale-transporte" para TODOS,
--      com o valor por dia atual (VR: parâmetro vr_valor_dia; VT: valor/dia
--      do cadastro, quando houver).
-- Idempotente: pode rodar mais de uma vez. Não apaga nada.
-- =============================================================================

-- 1) Período do fechamento
alter table rh.vr_mensal add column if not exists periodo_inicio date;
alter table rh.vr_mensal add column if not exists periodo_fim date;
alter table rh.vt_mensal add column if not exists periodo_inicio date;
alter table rh.vt_mensal add column if not exists periodo_fim date;
comment on column rh.vr_mensal.periodo_inicio is 'Início do período do benefício no mês (ex.: dia 1). Nulo = mês inteiro.';
comment on column rh.vr_mensal.periodo_fim is 'Fim do período do benefício no mês (ex.: dia 30 ou 21).';
comment on column rh.vt_mensal.periodo_inicio is 'Início do período de uso do VT. Nulo = dia 22 do mês anterior.';
comment on column rh.vt_mensal.periodo_fim is 'Fim do período de uso do VT. Nulo = dia 21 da competência.';

-- 2) Colaborador vê o próprio VR/VT dos meses fechados
drop policy if exists "self select fechado - vr_mensal" on rh.vr_mensal;
create policy "self select fechado - vr_mensal" on rh.vr_mensal for select
  using (colaborador_id = rh.colaborador_atual() and fechado);
drop policy if exists "self select fechado - vt_mensal" on rh.vt_mensal;
create policy "self select fechado - vt_mensal" on rh.vt_mensal for select
  using (colaborador_id = rh.colaborador_atual() and fechado);

-- 3) Benefícios VR e VT para todos (só cria se ainda não existir um da categoria)
do $$
declare
  v_vr uuid;
  v_vt uuid;
  v_vr_dia numeric := coalesce((select valor from rh.parametros where chave = 'vr_valor_dia'), 23);
begin
  select id into v_vr from rh.beneficios where categoria = 'ALIMENTACAO' order by created_at limit 1;
  if v_vr is null then
    insert into rh.beneficios (nome, descricao, icon, tone, status, atribuicao_tipo, categoria)
    values ('Vale-refeição', 'Crédito por dia trabalhado no cartão refeição.', 'utensils', 'orange', 'ATIVO', 'TODOS', 'ALIMENTACAO')
    returning id into v_vr;
    insert into rh.beneficio_valores_fixos (beneficio_id, colaborador_id, valor)
    select v_vr, c.id, v_vr_dia from rh.colaboradores c where c.status <> 'INATIVO'
    on conflict (beneficio_id, colaborador_id) do nothing;
  end if;

  select id into v_vt from rh.beneficios where categoria = 'TRANSPORTE' order by created_at limit 1;
  if v_vt is null then
    insert into rh.beneficios (nome, descricao, icon, tone, status, atribuicao_tipo, categoria)
    values ('Vale-transporte', 'Recarga do cartão de transporte por dia presencial (ida + volta).', 'bus', 'blue', 'ATIVO', 'TODOS', 'TRANSPORTE')
    returning id into v_vt;
    insert into rh.beneficio_valores_fixos (beneficio_id, colaborador_id, valor)
    select v_vt, c.id, c.vt_valor_dia from rh.colaboradores c where c.status <> 'INATIVO' and c.vt_valor_dia > 0
    on conflict (beneficio_id, colaborador_id) do nothing;
  end if;
end $$;

notify pgrst, 'reload schema';

-- Conferência
select b.nome, b.categoria, b.atribuicao_tipo,
       (select count(*) from rh.beneficio_valores_fixos f where f.beneficio_id = b.id) as colaboradores_com_valor,
       (select min(valor) from rh.beneficio_valores_fixos f where f.beneficio_id = b.id) as valor_dia
  from rh.beneficios b order by b.nome;
