-- =============================================================================
-- 30 — Jornadas (17:30 / estagiário), aviso de férias da Iara e
--      COMPENSAÇÃO AUTOMÁTICA do banco de horas.
--
-- O que faz (nesta ordem):
--   1. rh.ponto_registros ganha meta_horas / intervalo_min: a jornada que
--      valia NO DIA. Registros antigos recebem a jornada de antes desta
--      mudança — assim trocar a jornada não recalcula o passado.
--   2. Jornadas: todos os colaboradores → 08:00–17:30 (42,5 h/sem, 8h30/dia);
--      estagiário Paulo → 09:00–15:30, intervalo de 30 min (6 h/dia).
--      O intervalo mínimo passa a respeitar o intervalo cadastrado da pessoa
--      quando ele for MENOR que o da empresa (caso do estagiário).
--   3. Férias: colaboradores.ferias_aviso_ignorar_ate — o aviso de férias
--      ignora períodos aquisitivos que começam até essa data. Iara: já tirou
--      as férias do período que termina em 24/11/2026; o próximo aviso é o do
--      período seguinte.
--   4. Banco de horas: compensação automática (horas extras acumuladas
--      abatem horas devidas), com histórico (movimentos) e registro de cada
--      compensação para o RH conferir ("Comunicados do Sistema").
--
-- SEGURANÇA: não apaga nenhum registro de ponto. Pode rodar de novo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Jornada do dia gravada no próprio registro
-- -----------------------------------------------------------------------------
alter table rh.ponto_registros
  add column if not exists meta_horas numeric,
  add column if not exists intervalo_min integer;
comment on column rh.ponto_registros.meta_horas is 'Jornada prevista (horas) que valia neste dia — preenchida automaticamente (trigger).';
comment on column rh.ponto_registros.intervalo_min is 'Intervalo mínimo (min) que valia neste dia — preenchido automaticamente (trigger).';

-- Meta diária de um colaborador (mesma regra de rhConfigJornada em js/rh-ponto-data.js).
create or replace function rh.meta_diaria_colaborador(p_colaborador uuid)
returns numeric
language sql
stable
security definer
set search_path = rh, pg_temp
as $$
  select coalesce(
    case when c.horas_semanais is not null and coalesce(array_length(c.dias_trabalho, 1), 0) > 0
         then c.horas_semanais::numeric / array_length(c.dias_trabalho, 1) end,
    c.meta_diaria_horas::numeric,
    8)
  from rh.colaboradores c where c.id = p_colaborador;
$$;

-- Intervalo cadastrado do colaborador (intervalo_fim − intervalo_inicio), em minutos; null se não cadastrado.
create or replace function rh.intervalo_cadastrado_min(p_colaborador uuid)
returns integer
language sql
stable
security definer
set search_path = rh, pg_temp
as $$
  select case when c.intervalo_inicio is not null and c.intervalo_fim is not null and c.intervalo_fim > c.intervalo_inicio
              then (extract(epoch from (c.intervalo_fim - c.intervalo_inicio)) / 60)::int end
  from rh.colaboradores c where c.id = p_colaborador;
$$;

-- Intervalo mínimo para VALIDAR a batida (0 = empresa desligou a exigência).
create or replace function rh.intervalo_minimo_validacao(p_colaborador uuid)
returns integer
language sql
stable
security definer
set search_path = rh, pg_temp
as $$
  select case
    when coalesce(cfg.intervalo_minimo_min, 60) <= 0 then 0
    when rh.intervalo_cadastrado_min(p_colaborador) is not null then least(coalesce(cfg.intervalo_minimo_min, 60), rh.intervalo_cadastrado_min(p_colaborador))
    else coalesce(cfg.intervalo_minimo_min, 60)
  end
  from (select 1) x left join rh.configuracoes_ponto cfg on cfg.id = 1;
$$;

-- Intervalo mínimo para o CÁLCULO do banco de horas (igual ao JS: empresa 0/sem config → 60).
create or replace function rh.intervalo_minimo_calculo(p_colaborador uuid)
returns integer
language sql
stable
security definer
set search_path = rh, pg_temp
as $$
  select case
    when rh.intervalo_cadastrado_min(p_colaborador) is not null then least(g.v, rh.intervalo_cadastrado_min(p_colaborador))
    else g.v
  end
  from (select case when coalesce(cfg.intervalo_minimo_min, 0) > 0 then cfg.intervalo_minimo_min else 60 end as v
        from (select 1) x left join rh.configuracoes_ponto cfg on cfg.id = 1) g;
$$;

-- Backfill: registros já existentes ficam com a jornada de ANTES desta
-- mudança (intervalo de 60 min, como sempre foi aplicado até hoje).
update rh.ponto_registros p
   set meta_horas = rh.meta_diaria_colaborador(p.colaborador_id)
 where p.meta_horas is null;
update rh.ponto_registros p
   set intervalo_min = (select case when coalesce(cfg.intervalo_minimo_min, 0) > 0 then cfg.intervalo_minimo_min else 60 end
                          from (select 1) x left join rh.configuracoes_ponto cfg on cfg.id = 1)
 where p.intervalo_min is null;

-- Trigger: grava a jornada do dia no primeiro registro e nunca troca depois.
create or replace function rh.ponto_fixar_jornada_do_dia()
returns trigger
language plpgsql
security definer
set search_path = rh, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    new.meta_horas := coalesce(old.meta_horas, new.meta_horas, rh.meta_diaria_colaborador(new.colaborador_id));
    new.intervalo_min := coalesce(old.intervalo_min, new.intervalo_min, rh.intervalo_minimo_calculo(new.colaborador_id));
  else
    new.meta_horas := coalesce(new.meta_horas, rh.meta_diaria_colaborador(new.colaborador_id));
    new.intervalo_min := coalesce(new.intervalo_min, rh.intervalo_minimo_calculo(new.colaborador_id));
  end if;
  return new;
end;
$$;
drop trigger if exists trg_ponto_fixar_jornada on rh.ponto_registros;
create trigger trg_ponto_fixar_jornada
  before insert or update on rh.ponto_registros
  for each row execute function rh.ponto_fixar_jornada_do_dia();

-- -----------------------------------------------------------------------------
-- 2. Jornadas novas
-- -----------------------------------------------------------------------------
-- Estagiário Paulo: 09:00–15:30, intervalo de 30 min → 6 h/dia (30 h/sem).
update rh.colaboradores
   set horario_entrada = '09:00', horario_saida = '15:30',
       intervalo_inicio = '12:00', intervalo_fim = '12:30',
       horas_semanais = 30, meta_diaria_horas = 6
 where tipo = 'ESTAGIARIO' and nome ilike 'Paulo Rocha%';

-- Demais colaboradores: saída às 17:30 → 8h30/dia (42,5 h/sem).
update rh.colaboradores
   set horario_saida = '17:30', horas_semanais = 42.5, meta_diaria_horas = 8.5
 where tipo is distinct from 'ESTAGIARIO';

-- O dia de HOJE (ainda em andamento) já segue a jornada nova — o cálculo da
-- saída no navegador usa a jornada atual, então o registro do dia também.
alter table rh.ponto_registros disable trigger trg_ponto_fixar_jornada;
update rh.ponto_registros
   set meta_horas = rh.meta_diaria_colaborador(colaborador_id),
       intervalo_min = rh.intervalo_minimo_calculo(colaborador_id)
 where data >= (now() at time zone 'America/Sao_Paulo')::date;
alter table rh.ponto_registros enable trigger trg_ponto_fixar_jornada;

-- Validação do intervalo passa a usar o intervalo efetivo do colaborador.
create or replace function rh.ponto_validar_intervalo()
returns trigger
language plpgsql
security definer
set search_path = rh, pg_temp
as $$
declare
  cfg rh.configuracoes_ponto;
  v_old rh.ponto_registros;
  v_tem_old boolean := false;
  v_saida_mudou boolean;
  v_volta_mudou boolean;
  v_fim_mudou boolean;
  v_min integer;
begin
  if auth.uid() is null or rh.is_rh_staff() then
    return new;
  end if;
  select * into cfg from rh.configuracoes_ponto where id = 1;
  if not found then
    return new;
  end if;
  -- Intervalo mínimo EFETIVO do colaborador (script 30): o menor entre o da
  -- empresa e o intervalo cadastrado dele (ex.: estagiário com 30 min).
  v_min := rh.intervalo_minimo_validacao(new.colaborador_id);

  -- Linha já gravada do dia: OLD no UPDATE; no INSERT (caminho INSERT do
  -- upsert) busca a linha existente de (colaborador_id, data).
  if tg_op = 'UPDATE' then
    v_old := old;
    v_tem_old := true;
  else
    select * into v_old from rh.ponto_registros
     where colaborador_id = new.colaborador_id and data = new.data;
    v_tem_old := found;
  end if;

  -- Batida de intervalo já gravada não muda pelo colaborador.
  if v_tem_old and v_old.intervalo_saida is not null
     and new.intervalo_saida is distinct from v_old.intervalo_saida then
    raise exception 'A saída para o intervalo já foi registrada às % e não pode ser alterada. Atualize a página; para corrigir, peça um ajuste ao RH.',
      to_char(date '2000-01-01' + v_old.intervalo_saida, 'HH24:MI')
      using errcode = 'P0001', hint = 'regra_batida_gravada';
  end if;
  if v_tem_old and v_old.intervalo_volta is not null
     and new.intervalo_volta is distinct from v_old.intervalo_volta then
    raise exception 'O retorno do intervalo já foi registrado às % e não pode ser alterado. Atualize a página; para corrigir, peça um ajuste ao RH.',
      to_char(date '2000-01-01' + v_old.intervalo_volta, 'HH24:MI')
      using errcode = 'P0001', hint = 'regra_batida_gravada';
  end if;

  v_saida_mudou := new.intervalo_saida is not null
    and (not v_tem_old or new.intervalo_saida is distinct from v_old.intervalo_saida);
  v_volta_mudou := new.intervalo_volta is not null
    and (not v_tem_old or new.intervalo_volta is distinct from v_old.intervalo_volta);
  v_fim_mudou := new.saida is not null
    and (not v_tem_old or new.saida is distinct from v_old.saida);

  if v_saida_mudou and cfg.almoco_inicio_minimo is not null and new.intervalo_saida < cfg.almoco_inicio_minimo then
    raise exception 'O intervalo não pode começar antes das %.', to_char(date '2000-01-01' + cfg.almoco_inicio_minimo, 'HH24:MI')
      using errcode = 'P0001', hint = 'regra_almoco_inicio';
  end if;

  if v_volta_mudou and new.intervalo_saida is null then
    raise exception 'Registre a saída para o intervalo antes do retorno.'
      using errcode = 'P0001', hint = 'regra_intervalo_ordem';
  end if;

  if v_volta_mudou and v_min > 0
     and (new.intervalo_volta - new.intervalo_saida) < make_interval(mins => v_min) then
    raise exception 'O intervalo mínimo é de % minutos. Retorno permitido a partir das %.',
      v_min, to_char(date '2000-01-01' + new.intervalo_saida + make_interval(mins => v_min), 'HH24:MI')
      using errcode = 'P0001', hint = 'regra_intervalo_minimo';
  end if;

  if v_fim_mudou and v_min > 0
     and (new.intervalo_saida is null or new.intervalo_volta is null) then
    raise exception 'Registre a saída e o retorno do intervalo (mínimo de % minutos) antes de registrar a saída.', v_min
      using errcode = 'P0001', hint = 'regra_intervalo_obrigatorio';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ponto_validar_intervalo on rh.ponto_registros;
create trigger trg_ponto_validar_intervalo
  before insert or update of intervalo_saida, intervalo_volta, saida on rh.ponto_registros
  for each row execute function rh.ponto_validar_intervalo();

-- (trigger trg_ponto_validar_intervalo continua o mesmo — só a função mudou)

-- -----------------------------------------------------------------------------
-- 3. Férias: dispensar o aviso de um período aquisitivo já resolvido
-- -----------------------------------------------------------------------------
alter table rh.colaboradores add column if not exists ferias_aviso_ignorar_ate date;
comment on column rh.colaboradores.ferias_aviso_ignorar_ate is 'O lembrete de férias ignora períodos aquisitivos que começam até esta data (férias já tiradas/resolvidas fora do sistema). Null = avisa normalmente.';

-- Iara: férias já retiradas — ignora o período aquisitivo atual (25/11/2025 a
-- 24/11/2026); o próximo aviso será o do período seguinte.
update rh.colaboradores
   set ferias_aviso_ignorar_ate = '2026-11-24'
 where id = '1e484188-7b5b-40f7-a630-34271e331abd';

-- -----------------------------------------------------------------------------
-- 4. Banco de horas — compensação automática
-- -----------------------------------------------------------------------------
-- Regras (as mesmas das telas):
--   * Horas extras do dia = horas_extras (trabalhado além da jornada prevista).
--   * Horas devidas do dia = atraso (atraso_min) + intervalo acima do mínimo
--     não compensado no mesmo dia (ver rhDescontoAlmocoHoras no JS).
--   * Só dias JÁ ENCERRADOS (antes de hoje, fuso de Brasília).
--   * Sempre que houver horas extras acumuladas E horas devidas pendentes, o
--     sistema abate automaticamente o menor dos dois e registra a compensação.
--     Ex.: +5h extras, −2h devidas → abate 2h → saldo de extras +3h.
--   * O saldo final (extras − devidas) não muda; muda só a separação.
--   * Tudo o que existia ANTES de configuracoes_ponto.compensacao_inicio entra
--     como saldo inicial (e é compensado uma vez, na data anterior ao início).

alter table rh.configuracoes_ponto add column if not exists compensacao_inicio date;
update rh.configuracoes_ponto set compensacao_inicio = coalesce(compensacao_inicio, '2026-09-29') where id = 1;

create table if not exists rh.banco_horas_movimentos (
  id bigserial primary key,
  colaborador_id uuid not null references rh.colaboradores(id) on delete cascade,
  data date not null,
  tipo text not null check (tipo in ('SALDO_INICIAL', 'DIA')),
  extras_min integer not null default 0,
  devidas_min integer not null default 0,
  atraso_min integer not null default 0,
  intervalo_excedente_min integer not null default 0,
  compensado_min integer not null default 0,
  extras_antes_min integer not null default 0,   -- extras disponíveis antes da compensação do dia (já somando as do dia)
  devidas_antes_min integer not null default 0,  -- devidas pendentes antes da compensação do dia (já somando as do dia)
  extras_apos_min integer not null default 0,
  devidas_apos_min integer not null default 0,
  saldo_apos_min integer not null default 0,     -- extras_apos − devidas_apos
  processado_em timestamptz not null default now(),
  unique (colaborador_id, data, tipo)
);
comment on table rh.banco_horas_movimentos is 'Extrato do banco de horas por colaborador (recalculado por rh.banco_horas_processar a partir dos registros de ponto). Não editar à mão.';
create index if not exists idx_bh_mov_colab on rh.banco_horas_movimentos (colaborador_id, data);

create table if not exists rh.banco_horas_compensacoes (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references rh.colaboradores(id) on delete cascade,
  data_referencia date not null,
  extras_disponiveis_min integer not null,
  devidas_min integer not null,
  abatido_min integer not null,
  extras_restantes_min integer not null,
  devidas_restantes_min integer not null,
  saldo_anterior_min integer not null,           -- saldo (extras − devidas) antes do dia
  saldo_apos_min integer not null,
  motivo text not null,
  status text not null default 'ATIVA' check (status in ('ATIVA', 'CANCELADA')),
  processado_em timestamptz not null default now(),
  recalculado_em timestamptz,
  visualizado_em timestamptz,
  visualizado_por text,
  unique (colaborador_id, data_referencia)
);
comment on table rh.banco_horas_compensacoes is 'Cada abatimento automático de horas devidas com horas extras. Aparece para o RH em Comunicados → Comunicados do Sistema até ser visualizado (depois fica arquivado).';
create index if not exists idx_bh_comp_colab on rh.banco_horas_compensacoes (colaborador_id, data_referencia);
create index if not exists idx_bh_comp_novas on rh.banco_horas_compensacoes (visualizado_em) where visualizado_em is null;

alter table rh.banco_horas_movimentos enable row level security;
alter table rh.banco_horas_compensacoes enable row level security;
drop policy if exists "rh_staff select - bh_movimentos" on rh.banco_horas_movimentos;
create policy "rh_staff select - bh_movimentos" on rh.banco_horas_movimentos for select using (rh.is_rh_staff());
drop policy if exists "self select - bh_movimentos" on rh.banco_horas_movimentos;
create policy "self select - bh_movimentos" on rh.banco_horas_movimentos for select using (colaborador_id = rh.colaborador_atual());
drop policy if exists "rh_staff select - bh_compensacoes" on rh.banco_horas_compensacoes;
create policy "rh_staff select - bh_compensacoes" on rh.banco_horas_compensacoes for select using (rh.is_rh_staff());
drop policy if exists "self select - bh_compensacoes" on rh.banco_horas_compensacoes;
create policy "self select - bh_compensacoes" on rh.banco_horas_compensacoes for select using (colaborador_id = rh.colaborador_atual());
-- (inserção/alteração só pelas funções abaixo, que rodam como dono)

-- Horas devidas de um registro de ponto (minutos).
create or replace function rh.banco_horas_intervalo_excedente_min(p rh.ponto_registros)
returns integer
language plpgsql
stable
security definer
set search_path = rh, pg_temp
as $$
declare
  c rh.colaboradores;
  v_min integer;
  v_excesso integer;
  v_meta integer;
  v_trab integer;
  v_falta integer;
begin
  if p.entrada is null or p.intervalo_saida is null or p.intervalo_volta is null or p.saida is null then
    return 0;
  end if;
  select * into c from rh.colaboradores where id = p.colaborador_id;
  if coalesce(array_length(c.dias_trabalho, 1), 0) > 0
     and not ((array['DOM','SEG','TER','QUA','QUI','SEX','SAB'])[extract(dow from p.data)::int + 1] = any(c.dias_trabalho)) then
    return 0;
  end if;
  v_min := coalesce(p.intervalo_min, rh.intervalo_minimo_calculo(p.colaborador_id));
  v_excesso := (extract(epoch from (p.intervalo_volta - p.intervalo_saida)) / 60)::int - v_min;
  if v_excesso <= 0 then return 0; end if;
  v_meta := round(coalesce(p.meta_horas, rh.meta_diaria_colaborador(p.colaborador_id)) * 60);
  v_trab := greatest(0, (extract(epoch from (p.intervalo_saida - p.entrada)) / 60)::int)
          + greatest(0, (extract(epoch from (p.saida - p.intervalo_volta)) / 60)::int);
  v_falta := v_meta - v_trab;
  if v_falta <= 0 then return 0; end if;
  return least(v_excesso, v_falta);
end;
$$;

create or replace function rh.banco_horas_fmt(p_min integer)
returns text
language sql
immutable
as $$
  select (case when p_min < 0 then '-' else '' end) || (abs(p_min) / 60) || ':' || lpad((abs(p_min) % 60)::text, 2, '0') || 'h';
$$;

-- Grava (ou atualiza) uma compensação; devolve true se for nova ou mudou.
create or replace function rh.banco_horas_registrar_comp(
  p_colab uuid, p_data date, p_disp integer, p_dev integer, p_abat integer,
  p_saldo_ant integer, p_saldo_apos integer, p_motivo text)
returns boolean
language plpgsql
security definer
set search_path = rh, pg_temp
as $$
declare
  r rh.banco_horas_compensacoes;
begin
  select * into r from rh.banco_horas_compensacoes where colaborador_id = p_colab and data_referencia = p_data;
  if not found then
    insert into rh.banco_horas_compensacoes (colaborador_id, data_referencia, extras_disponiveis_min, devidas_min, abatido_min,
      extras_restantes_min, devidas_restantes_min, saldo_anterior_min, saldo_apos_min, motivo)
    values (p_colab, p_data, p_disp, p_dev, p_abat, p_disp - p_abat, p_dev - p_abat, p_saldo_ant, p_saldo_apos, p_motivo);
    return true;
  end if;
  if r.status = 'ATIVA' and r.extras_disponiveis_min = p_disp and r.devidas_min = p_dev and r.abatido_min = p_abat then
    return false; -- nada mudou
  end if;
  update rh.banco_horas_compensacoes
     set extras_disponiveis_min = p_disp, devidas_min = p_dev, abatido_min = p_abat,
         extras_restantes_min = p_disp - p_abat, devidas_restantes_min = p_dev - p_abat,
         saldo_anterior_min = p_saldo_ant, saldo_apos_min = p_saldo_apos,
         motivo = p_motivo || ' (recalculado após ajuste no ponto)',
         status = 'ATIVA', recalculado_em = now(), visualizado_em = null, visualizado_por = null
   where id = r.id;
  return true;
end;
$$;

-- Processa o banco de horas (todos, ou um colaborador). Idempotente: pode
-- rodar quantas vezes quiser; recalcula o extrato e só cria/atualiza
-- compensações que mudaram. Devolve quantas compensações novas/alteradas.
create or replace function rh.banco_horas_processar(p_colaborador uuid default null)
returns integer
language plpgsql
security definer
set search_path = rh, pg_temp
as $$
declare
  v_inicio date;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_total integer := 0;
  c record;
  p rh.ponto_registros;
  v_extras integer;
  v_dev integer;
  v_e integer;
  v_atraso integer;
  v_int integer;
  v_d integer;
  v_abat integer;
  v_saldo_ant integer;
  v_datas date[];
  v_motivo text;
begin
  if auth.uid() is not null and not rh.is_rh_staff() then
    raise exception 'Somente o RH pode processar o banco de horas.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('rh.banco_horas_processar'));
  select coalesce(compensacao_inicio, v_hoje) into v_inicio from rh.configuracoes_ponto where id = 1;
  v_inicio := coalesce(v_inicio, v_hoje);

  for c in
    select id, nome from rh.colaboradores
     where (p_colaborador is null or id = p_colaborador)
       and (status is distinct from 'INATIVO' or id = p_colaborador)
  loop
    delete from rh.banco_horas_movimentos where colaborador_id = c.id;
    v_datas := array[]::date[];

    -- Saldo inicial: tudo o que é anterior ao início da compensação automática.
    select coalesce(sum(round(coalesce(r.horas_extras, 0) * 60)), 0)::int,
           coalesce(sum(coalesce(r.atraso_min, 0) + rh.banco_horas_intervalo_excedente_min(r)), 0)::int
      into v_extras, v_dev
      from rh.ponto_registros r
     where r.colaborador_id = c.id and r.data < v_inicio and r.data < v_hoje;

    v_abat := least(v_extras, v_dev);
    insert into rh.banco_horas_movimentos (colaborador_id, data, tipo, extras_min, devidas_min, compensado_min,
      extras_antes_min, devidas_antes_min, extras_apos_min, devidas_apos_min, saldo_apos_min)
    values (c.id, v_inicio - 1, 'SALDO_INICIAL', v_extras, v_dev, v_abat, v_extras, v_dev, v_extras - v_abat, v_dev - v_abat, v_extras - v_dev);
    if v_abat > 0 then
      v_motivo := 'Compensação do saldo acumulado até ' || to_char(v_inicio - 1, 'DD/MM/YYYY') || ' (início da compensação automática): '
               || rh.banco_horas_fmt(v_abat) || ' de horas devidas abatidas das horas extras acumuladas.';
      if rh.banco_horas_registrar_comp(c.id, v_inicio - 1, v_extras, v_dev, v_abat, 0, v_extras - v_dev, v_motivo) then v_total := v_total + 1; end if;
      v_datas := v_datas || (v_inicio - 1);
    end if;
    v_extras := v_extras - v_abat;
    v_dev := v_dev - v_abat;

    -- Dias encerrados a partir do início.
    for p in
      select * from rh.ponto_registros r
       where r.colaborador_id = c.id and r.data >= v_inicio and r.data < v_hoje
       order by r.data
    loop
      v_e := round(coalesce(p.horas_extras, 0) * 60)::int;
      v_atraso := coalesce(p.atraso_min, 0);
      v_int := rh.banco_horas_intervalo_excedente_min(p);
      v_d := v_atraso + v_int;
      if v_e = 0 and v_d = 0 then continue; end if;

      v_saldo_ant := v_extras - v_dev;
      v_extras := v_extras + v_e;
      v_dev := v_dev + v_d;
      v_abat := least(v_extras, v_dev);

      insert into rh.banco_horas_movimentos (colaborador_id, data, tipo, extras_min, devidas_min, atraso_min, intervalo_excedente_min,
        compensado_min, extras_antes_min, devidas_antes_min, extras_apos_min, devidas_apos_min, saldo_apos_min)
      values (c.id, p.data, 'DIA', v_e, v_d, v_atraso, v_int, v_abat, v_extras, v_dev, v_extras - v_abat, v_dev - v_abat, v_extras - v_dev);

      if v_abat > 0 then
        if v_d > 0 then
          v_motivo := 'Horas devidas em ' || to_char(p.data, 'DD/MM/YYYY') || ' ('
                   || concat_ws(' + ',
                        case when v_atraso > 0 then 'atraso de ' || rh.banco_horas_fmt(v_atraso) end,
                        case when v_int > 0 then 'intervalo acima do mínimo ' || rh.banco_horas_fmt(v_int) end)
                   || ') compensadas automaticamente com as horas extras acumuladas.';
        else
          v_motivo := 'Horas extras de ' || to_char(p.data, 'DD/MM/YYYY') || ' usadas automaticamente para quitar horas devidas pendentes.';
        end if;
        if rh.banco_horas_registrar_comp(c.id, p.data, v_extras, v_dev, v_abat, v_saldo_ant, v_extras - v_dev, v_motivo) then v_total := v_total + 1; end if;
        v_datas := v_datas || p.data;
      end if;
      v_extras := v_extras - v_abat;
      v_dev := v_dev - v_abat;
    end loop;

    -- Compensação que deixou de existir (ex.: RH corrigiu o ponto): cancela, mantendo o histórico.
    update rh.banco_horas_compensacoes
       set status = 'CANCELADA', recalculado_em = now(), visualizado_em = null, visualizado_por = null,
           motivo = motivo || ' — CANCELADA: o ponto do dia foi corrigido e não há mais horas a compensar.'
     where colaborador_id = c.id and status = 'ATIVA' and not (data_referencia = any(v_datas));
    get diagnostics v_abat = row_count;
    v_total := v_total + v_abat;
  end loop;
  return v_total;
end;
$$;
revoke all on function rh.banco_horas_processar(uuid) from public;
grant execute on function rh.banco_horas_processar(uuid) to authenticated;

-- RH marca como visualizado (vai para "Arquivados" em Comunicados do Sistema).
create or replace function rh.banco_horas_marcar_visualizado(p_ids uuid[], p_nome text default null)
returns integer
language plpgsql
security definer
set search_path = rh, pg_temp
as $$
declare
  v integer;
begin
  if not rh.is_rh_staff() then
    raise exception 'Somente o RH pode marcar comunicados do sistema.' using errcode = '42501';
  end if;
  update rh.banco_horas_compensacoes
     set visualizado_em = now(), visualizado_por = coalesce(p_nome, rh.usuario_nome_atual())
   where id = any(p_ids) and visualizado_em is null;
  get diagnostics v = row_count;
  return v;
end;
$$;
revoke all on function rh.banco_horas_marcar_visualizado(uuid[], text) from public;
grant execute on function rh.banco_horas_marcar_visualizado(uuid[], text) to authenticated;

-- Roda sozinho todo dia às 00:20 (Brasília) = 03:20 UTC, processando o dia que terminou.
select cron.unschedule(jobid) from cron.job where jobname = 'rh-banco-horas-compensacao';
select cron.schedule('rh-banco-horas-compensacao', '20 3 * * *', 'select rh.banco_horas_processar();');

-- Primeiro processamento agora.
select rh.banco_horas_processar() as compensacoes_registradas;
