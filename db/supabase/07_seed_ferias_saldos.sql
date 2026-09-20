-- BSconta+ RH — saldo inicial de férias para os colaboradores existentes
-- =============================================================================
-- Sem este seed, um colaborador que já tenha login mas nunca teve
-- rh.ferias_saldos cadastrado veria "saldo 0" na tela de Férias (comportamento
-- correto e sem crash, mas não é o saldo real dele). Este script cria a
-- primeira linha de saldo para cada colaborador ATIVO que ainda não tiver
-- uma, usando a regra padrão CLT (30 dias por período aquisitivo de 12 meses
-- a partir da data de admissão, renovando a cada aniversário de admissão) —
-- é só o ponto de partida; o RH pode ajustar saldo/período depois, na mão,
-- se algum colaborador já tiver tirado férias antes deste sistema existir.
--
-- Idempotente: só insere quem ainda não aparece em rh.ferias_saldos
-- (on conflict do nothing na chave primária colaborador_id).

insert into rh.ferias_saldos (colaborador_id, periodo_aquisitivo_inicio, periodo_aquisitivo_fim, saldo_dias, dias_usados)
select
  c.id,
  -- aniversário de admissão mais recente que já passou (ou hoje)
  (c.admissao + make_interval(years => extract(year from age(current_date, c.admissao))::int))::date as periodo_inicio,
  (c.admissao + make_interval(years => extract(year from age(current_date, c.admissao))::int + 1) - interval '1 day')::date as periodo_fim,
  30,
  0
from rh.colaboradores c
where c.admissao is not null
  and c.status = 'ATIVO'
on conflict (colaborador_id) do nothing;
