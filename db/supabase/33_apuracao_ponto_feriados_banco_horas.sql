-- =============================================================================
-- 33 — Apuração ÚNICA do ponto (regra da Folha de Ponto), feriados, tolerância,
--      saldo inicial e banco de horas recalculado.
--
-- Por que: cada tela calculava o banco de horas do seu jeito (colaborador,
-- RH/ponto, relatórios e o processamento do banco), e a regra antiga só
-- contava "hora extra" (positivo) e "atraso na entrada + almoço excedente"
-- (negativo). Saída antecipada, dia curto e falta NÃO descontavam, feriado
-- não existia e não havia saldo anterior. Resultado: saldos diferentes da
-- Folha de Ponto oficial.
--
-- Regra nova (a mesma da Folha de Ponto), calculada SÓ no banco, por
-- rh.ponto_apuracao(), e usada por todas as telas:
--
--   saldo do dia = trabalhadas + abono − previstas
--
--   * trabalhadas = (saída intervalo − entrada) + (saída − retorno). Sem
--     intervalo: saída − entrada. Dia incompleto conta só os pares fechados.
--   * previstas  = jornada do dia (rh.ponto_registros.meta_horas; sem
--     registro → jornada atual) em dia de trabalho; 0 em fim de semana,
--     feriado (rh.feriados), antes da admissão e depois do desligamento.
--   * abono      = abono APROVADO (atestado, férias, ausência autorizada,
--     compromisso externo, folga/day off, outro) completa o dia até a
--     jornada: abono = previstas − trabalhadas (ex.: atestado de meio
--     período). Férias APROVADAS (rh.ferias_solicitacoes) também abonam.
--     Falta justificada / não justificada NÃO abonam.
--   * falta      = dia de trabalho já encerrado, sem entrada e sem abono →
--     saldo = −previstas.
--   * tolerância = |saldo| <= tolerância diária → 0 (por colaborador em
--     rh.colaboradores.tolerancia_diaria_min; vazio → padrão da empresa em
--     rh.configuracoes_ponto.tolerancia_diaria_min, padrão 0). Só em dia
--     trabalhado, nunca em falta.
--   * Fim de semana e feriado não contam horas (saldo 0, mesmo com batida).
--   * A partir de configuracoes_ponto.regra_atraso_almoco_inicio: atraso até
--     15 min tolerado; acima disso o atraso inteiro conta como hora devida;
--     almoço acima do intervalo (mesmo 1 min) conta como hora devida; nenhum
--     dos dois é compensado ficando mais tarde no mesmo dia.
--   * HOJE não entra no saldo (jornada em andamento).
--
-- Banco de horas = saldo inicial (rh.banco_horas_saldos_iniciais, ex.: saldo
-- anterior da Folha de Ponto) + soma dos saldos diários desde o início da
-- apuração da pessoa (rh.banco_horas_inicio_colab: dia seguinte ao saldo
-- anterior, ou o 1º ponto registrado — nunca antes de
-- rh.configuracoes_ponto.compensacao_inicio).
--
-- SEGURANÇA: não apaga nenhum registro de ponto. Idempotente (pode rodar de
-- novo). Recria rh.banco_horas_processar() com a regra nova — a compensação
-- automática e os "Comunicados do Sistema" continuam funcionando.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Feriados
-- -----------------------------------------------------------------------------
create table if not exists rh.feriados (
  data date primary key,
  nome text not null,
  abrangencia text not null default 'NACIONAL' check (abrangencia in ('NACIONAL', 'ESTADUAL', 'MUNICIPAL', 'EMPRESA')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_nome text
);
comment on table rh.feriados is 'Feriados (e pontes concedidas pela empresa). No dia de feriado a jornada prevista é 0: não conta falta e o trabalho no dia vira crédito no banco de horas.';

alter table rh.feriados enable row level security;
drop policy if exists "logados leem - feriados" on rh.feriados;
create policy "logados leem - feriados" on rh.feriados for select using (auth.uid() is not null);
drop policy if exists "rh_staff all - feriados" on rh.feriados;
create policy "rh_staff all - feriados" on rh.feriados for all using (rh.is_rh_staff()) with check (rh.is_rh_staff());
grant select on rh.feriados to authenticated;
grant insert, update, delete on rh.feriados to authenticated;

-- Nacionais + Belo Horizonte (municipais: Sexta-feira Santa, Corpus Christi,
-- Assunção de Nossa Senhora e Imaculada Conceição). O RH ajusta em
-- Configurações → Feriados.
insert into rh.feriados (data, nome, abrangencia) values
  ('2025-01-01', 'Confraternização Universal', 'NACIONAL'),
  ('2025-04-18', 'Sexta-feira Santa', 'MUNICIPAL'),
  ('2025-04-21', 'Tiradentes', 'NACIONAL'),
  ('2025-05-01', 'Dia do Trabalho', 'NACIONAL'),
  ('2025-06-19', 'Corpus Christi', 'MUNICIPAL'),
  ('2025-08-15', 'Assunção de Nossa Senhora', 'MUNICIPAL'),
  ('2025-09-07', 'Dia da Independência', 'NACIONAL'),
  ('2025-10-12', 'Nossa Senhora Aparecida', 'NACIONAL'),
  ('2025-11-02', 'Finados', 'NACIONAL'),
  ('2025-11-15', 'Proclamação da República', 'NACIONAL'),
  ('2025-11-20', 'Dia Nacional de Zumbi e da Consciência Negra', 'NACIONAL'),
  ('2025-12-08', 'Imaculada Conceição', 'MUNICIPAL'),
  ('2025-12-25', 'Natal', 'NACIONAL'),
  ('2026-01-01', 'Confraternização Universal', 'NACIONAL'),
  ('2026-04-03', 'Sexta-feira Santa', 'MUNICIPAL'),
  ('2026-04-21', 'Tiradentes', 'NACIONAL'),
  ('2026-05-01', 'Dia do Trabalho', 'NACIONAL'),
  ('2026-06-04', 'Corpus Christi', 'MUNICIPAL'),
  ('2026-08-15', 'Assunção de Nossa Senhora', 'MUNICIPAL'),
  ('2026-09-07', 'Dia da Independência', 'NACIONAL'),
  ('2026-10-12', 'Nossa Senhora Aparecida', 'NACIONAL'),
  ('2026-11-02', 'Finados', 'NACIONAL'),
  ('2026-11-15', 'Proclamação da República', 'NACIONAL'),
  ('2026-11-20', 'Dia Nacional de Zumbi e da Consciência Negra', 'NACIONAL'),
  ('2026-12-08', 'Imaculada Conceição', 'MUNICIPAL'),
  ('2026-12-25', 'Natal', 'NACIONAL'),
  ('2027-01-01', 'Confraternização Universal', 'NACIONAL'),
  ('2027-03-26', 'Sexta-feira Santa', 'MUNICIPAL'),
  ('2027-04-21', 'Tiradentes', 'NACIONAL'),
  ('2027-05-01', 'Dia do Trabalho', 'NACIONAL'),
  ('2027-05-27', 'Corpus Christi', 'MUNICIPAL'),
  ('2027-08-15', 'Assunção de Nossa Senhora', 'MUNICIPAL'),
  ('2027-09-07', 'Dia da Independência', 'NACIONAL'),
  ('2027-10-12', 'Nossa Senhora Aparecida', 'NACIONAL'),
  ('2027-11-02', 'Finados', 'NACIONAL'),
  ('2027-11-15', 'Proclamação da República', 'NACIONAL'),
  ('2027-11-20', 'Dia Nacional de Zumbi e da Consciência Negra', 'NACIONAL'),
  ('2027-12-08', 'Imaculada Conceição', 'MUNICIPAL'),
  ('2027-12-25', 'Natal', 'NACIONAL')
on conflict (data) do nothing;

-- -----------------------------------------------------------------------------
-- 2. Tolerância diária e saldo inicial
-- -----------------------------------------------------------------------------
alter table rh.configuracoes_ponto add column if not exists tolerancia_diaria_min integer not null default 0;
-- Regra de atraso/almoço (a partir desta data): atraso até 15 min é tolerado;
-- passou de 15 min, o atraso inteiro vira hora devida; almoço acima do
-- intervalo (mesmo 1 min) vira hora devida. Nenhum dos dois é compensado
-- ficando mais tarde no mesmo dia. Antes desta data vale a regra da Folha de
-- Ponto importada (com a tolerância diária de cada um).
alter table rh.configuracoes_ponto add column if not exists regra_atraso_almoco_inicio date;
alter table rh.configuracoes_ponto add column if not exists tolerancia_atraso_min integer not null default 15;
update rh.configuracoes_ponto set regra_atraso_almoco_inicio = coalesce(regra_atraso_almoco_inicio, '2026-10-10') where id = 1;
alter table rh.colaboradores add column if not exists tolerancia_diaria_min integer;
comment on column rh.configuracoes_ponto.tolerancia_diaria_min is 'Tolerância diária padrão (min): diferença do dia até este valor não entra no banco de horas. 0 = sem tolerância.';
comment on column rh.colaboradores.tolerancia_diaria_min is 'Tolerância diária deste colaborador (min). Null = usa a da empresa (configuracoes_ponto.tolerancia_diaria_min).';

create table if not exists rh.banco_horas_saldos_iniciais (
  colaborador_id uuid primary key references rh.colaboradores(id) on delete cascade,
  data_referencia date not null,               -- saldo válido ATÉ esta data (inclusive)
  minutos integer not null,                    -- positivo = crédito, negativo = débito
  origem text,
  updated_at timestamptz not null default now(),
  updated_by_nome text
);
comment on table rh.banco_horas_saldos_iniciais is 'Saldo do banco de horas trazido de antes do início da apuração (ex.: "Saldo Anterior de Banco de Horas" da Folha de Ponto do sistema anterior).';
alter table rh.banco_horas_saldos_iniciais enable row level security;
drop policy if exists "rh_staff all - bh_saldos_iniciais" on rh.banco_horas_saldos_iniciais;
create policy "rh_staff all - bh_saldos_iniciais" on rh.banco_horas_saldos_iniciais for all using (rh.is_rh_staff()) with check (rh.is_rh_staff());
drop policy if exists "self select - bh_saldos_iniciais" on rh.banco_horas_saldos_iniciais;
create policy "self select - bh_saldos_iniciais" on rh.banco_horas_saldos_iniciais for select using (colaborador_id = rh.colaborador_atual());
grant select, insert, update, delete on rh.banco_horas_saldos_iniciais to authenticated;

-- Novo tipo de ocorrência: Afastamento (INSS / licença) — abona o dia.
do $$
declare v_nome text;
begin
  for v_nome in
    select con.conname from pg_constraint con
     where con.conrelid = 'rh.colaborador_abonos'::regclass and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%tipo%ATESTADO%'
  loop
    execute format('alter table rh.colaborador_abonos drop constraint %I', v_nome);
  end loop;
  alter table rh.colaborador_abonos add constraint colaborador_abonos_tipo_check check (tipo in (
    'ATESTADO', 'FERIAS', 'FALTA_JUSTIFICADA', 'FALTA_NAO_JUSTIFICADA', 'AUSENCIA_AUTORIZADA',
    'COMPROMISSO_EXTERNO', 'FOLGA', 'AFASTAMENTO', 'OUTRO'));
end $$;

-- Extrato ganha o saldo do dia e o tipo do dia (para as telas explicarem o porquê).
alter table rh.banco_horas_movimentos add column if not exists saldo_dia_min integer not null default 0;
alter table rh.banco_horas_movimentos add column if not exists tipo_dia text;
alter table rh.banco_horas_movimentos add column if not exists descricao text;
alter table rh.banco_horas_movimentos add column if not exists trabalhadas_min integer;
alter table rh.banco_horas_movimentos add column if not exists previstas_min integer;
alter table rh.banco_horas_movimentos add column if not exists abono_min integer;

-- -----------------------------------------------------------------------------
-- 3. Apuração diária — FONTE ÚNICA da regra
-- -----------------------------------------------------------------------------
create or replace function rh.ponto_minutos_trabalhados(p_entrada time, p_int_saida time, p_int_volta time, p_saida time)
returns integer
language sql
immutable
as $$
  select case
    when p_entrada is null then 0
    when p_int_saida is null and p_saida is not null then greatest(0, (extract(epoch from (p_saida - p_entrada)) / 60)::int)
    else
        case when p_int_saida is not null then greatest(0, (extract(epoch from (p_int_saida - p_entrada)) / 60)::int) else 0 end
      + case when p_int_volta is not null and p_saida is not null then greatest(0, (extract(epoch from (p_saida - p_int_volta)) / 60)::int) else 0 end
  end;
$$;

drop function if exists rh.ponto_apuracao(uuid, date, date);
create or replace function rh.ponto_apuracao(p_colaborador uuid, p_inicio date, p_fim date)
returns table (
  data date,
  dia_semana text,
  tipo_dia text,           -- TRABALHO | FIM_DE_SEMANA | FERIADO | FALTA | FALTA_JUSTIFICADA | ABONO | HOJE | FUTURO | FORA_CONTRATO
  descricao text,          -- nome do feriado / tipo do abono / "Falta" / "Registro incompleto"
  entrada time,
  intervalo_saida time,
  intervalo_volta time,
  saida time,
  trabalhadas_min integer,
  previstas_min integer,
  abono_min integer,
  saldo_bruto_min integer, -- trabalhadas + abono − previstas (sem tolerância)
  saldo_min integer,       -- o que entra no banco de horas
  incompleto boolean,
  alterado_rh boolean,
  local text,
  abono_tipo text,
  marcacoes_manuais text[] -- batidas lançadas manualmente (ex.: "(m)" da folha importada)
)
language plpgsql
stable
security definer
set search_path = rh, pg_temp
as $$
declare
  c rh.colaboradores;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_tol integer;
  v_meta_atual numeric;
  v_dias text[];
  d date;
  r rh.ponto_registros;
  v_tem_r boolean;
  v_fer rh.feriados;
  v_tem_fer boolean;
  v_ab record;
  v_tem_ab boolean;
  v_cod text;
  v_trab integer;
  v_prev integer;
  v_abono integer;
  v_bruto integer;
  v_saldo integer;
  v_tipo text;
  v_desc text;
  v_incompleto boolean;
  v_regra_ini date;
  v_tol_atraso integer;
  v_atraso integer;
  v_excesso integer;
  v_debito integer;
  v_perdao integer;
  c_labels constant jsonb := '{"ATESTADO":"Atestado","FERIAS":"Férias","FALTA_JUSTIFICADA":"Falta justificada","FALTA_NAO_JUSTIFICADA":"Falta não justificada","AUSENCIA_AUTORIZADA":"Ausência autorizada","COMPROMISSO_EXTERNO":"Compromisso externo","FOLGA":"Folga / day off","AFASTAMENTO":"Afastamento","OUTRO":"Abono"}';
begin
  if auth.uid() is not null and not rh.is_rh_staff() and p_colaborador is distinct from rh.colaborador_atual() then
    raise exception 'Sem permissão para ver a apuração deste colaborador.' using errcode = '42501';
  end if;
  select * into c from rh.colaboradores where id = p_colaborador;
  if not found then return; end if;
  if p_fim < p_inicio or (p_fim - p_inicio) > 4000 then
    raise exception 'Período inválido (máximo de 4000 dias).' using errcode = '22023';
  end if;

  select coalesce(c.tolerancia_diaria_min, cfg.tolerancia_diaria_min, 0) into v_tol
    from (select 1) x left join rh.configuracoes_ponto cfg on cfg.id = 1;
  v_tol := coalesce(v_tol, 0);
  select cfg.regra_atraso_almoco_inicio, coalesce(cfg.tolerancia_atraso_min, 15) into v_regra_ini, v_tol_atraso
    from rh.configuracoes_ponto cfg where cfg.id = 1;
  v_tol_atraso := coalesce(v_tol_atraso, 15);
  v_meta_atual := rh.meta_diaria_colaborador(p_colaborador);
  v_dias := case when coalesce(array_length(c.dias_trabalho, 1), 0) > 0 then c.dias_trabalho else array['SEG','TER','QUA','QUI','SEX'] end;

  d := p_inicio;
  while d <= p_fim loop
    v_cod := (array['DOM','SEG','TER','QUA','QUI','SEX','SAB'])[extract(dow from d)::int + 1];
    select * into r from rh.ponto_registros pr where pr.colaborador_id = p_colaborador and pr.data = d;
    v_tem_r := found;
    select * into v_fer from rh.feriados f where f.data = d;
    v_tem_fer := found;
    select a.tipo, a.motivo into v_ab
      from rh.colaborador_abonos a
     where a.colaborador_id = p_colaborador and a.status = 'APROVADO' and d between a.data_inicio and a.data_fim
     order by case when a.tipo in ('FALTA_JUSTIFICADA', 'FALTA_NAO_JUSTIFICADA') then 1 else 0 end, a.created_at desc
     limit 1;
    v_tem_ab := found;
    -- Férias aprovadas (rh.ferias_solicitacoes) abonam o dia como um abono de férias.
    if not v_tem_ab or v_ab.tipo in ('FALTA_JUSTIFICADA', 'FALTA_NAO_JUSTIFICADA') then
      perform 1 from rh.ferias_solicitacoes fs
       where fs.colaborador_id = p_colaborador and fs.status = 'APROVADA' and d between fs.inicio and fs.fim;
      if found then
        select 'FERIAS'::text as tipo, 'Férias'::text as motivo into v_ab;
        v_tem_ab := true;
      end if;
    end if;

    data := d;
    dia_semana := v_cod;
    entrada := case when v_tem_r then r.entrada end;
    intervalo_saida := case when v_tem_r then r.intervalo_saida end;
    intervalo_volta := case when v_tem_r then r.intervalo_volta end;
    saida := case when v_tem_r then r.saida end;
    -- "Alterado pelo RH" = correção feita pelo RH (a carga da folha antiga
    -- não conta como correção; as marcações manuais dela vêm à parte).
    alterado_rh := v_tem_r and r.alterado_pelo_rh is not null and coalesce(r.alterado_pelo_rh->>'origem', '') <> 'IMPORTACAO';
    marcacoes_manuais := case when v_tem_r and jsonb_typeof(r.alterado_pelo_rh->'manuais') = 'array'
                              then array(select jsonb_array_elements_text(r.alterado_pelo_rh->'manuais')) end;
    local := case when v_tem_r then r.local end;
    abono_tipo := case when v_tem_ab then v_ab.tipo end;

    v_trab := case when v_tem_r then rh.ponto_minutos_trabalhados(r.entrada, r.intervalo_saida, r.intervalo_volta, r.saida) else 0 end;
    v_incompleto := v_tem_r and r.entrada is not null and d < v_hoje
                    and (r.saida is null or (r.intervalo_saida is not null and r.intervalo_volta is null) or (r.intervalo_saida is null and r.intervalo_volta is not null));
    v_desc := null;

    if (c.admissao is not null and d < c.admissao) or (c.data_desligamento is not null and d > c.data_desligamento) then
      v_tipo := 'FORA_CONTRATO'; v_prev := 0; v_abono := 0; v_trab := 0; v_bruto := 0; v_saldo := 0;
    elsif d > v_hoje then
      v_tipo := 'FUTURO'; v_prev := 0; v_abono := 0; v_bruto := 0; v_saldo := 0;
      if v_tem_fer then v_desc := v_fer.nome; elsif v_tem_ab then v_desc := c_labels->>v_ab.tipo; end if;
    else
      -- Jornada prevista do dia
      -- Fim de semana e feriado NÃO contam horas (nem crédito, nem débito).
      if v_tem_fer then
        v_prev := 0; v_trab := 0; v_tipo := 'FERIADO'; v_desc := v_fer.nome;
      elsif not (v_cod = any(v_dias)) then
        v_prev := 0; v_trab := 0; v_tipo := 'FIM_DE_SEMANA';
      else
        v_prev := round(coalesce(case when v_tem_r then r.meta_horas end, v_meta_atual, 8) * 60)::int;
        v_tipo := 'TRABALHO';
      end if;

      -- Abono (completa o dia até a jornada)
      v_abono := 0;
      if v_tem_ab and v_ab.tipo not in ('FALTA_JUSTIFICADA', 'FALTA_NAO_JUSTIFICADA') then
        v_abono := greatest(0, v_prev - v_trab);
        if v_prev > 0 then v_tipo := 'ABONO'; v_desc := c_labels->>v_ab.tipo; end if;
      end if;

      if d = v_hoje then
        -- Jornada em andamento: mostra, mas não entra no banco.
        v_bruto := v_trab + v_abono - v_prev;
        v_saldo := 0;
        if v_tipo = 'TRABALHO' then v_tipo := 'HOJE'; end if;
      else
        if v_prev > 0 and v_abono = 0 and (not v_tem_r or r.entrada is null) then
          v_tipo := case when v_tem_ab and v_ab.tipo = 'FALTA_JUSTIFICADA' then 'FALTA_JUSTIFICADA' else 'FALTA' end;
          v_desc := case when v_tipo = 'FALTA_JUSTIFICADA' then 'Falta justificada (não abonada)' else 'Falta' end;
        end if;
        v_bruto := v_trab + v_abono - v_prev;
        v_saldo := v_bruto;
        if v_regra_ini is not null and d >= v_regra_ini then
          -- Regra de atraso/almoço (dia de trabalho com batida, sem abono).
          if v_tem_r and r.entrada is not null and v_prev > 0 and v_abono = 0 then
            v_atraso := case when c.horario_entrada is not null
                             then greatest(0, (extract(epoch from (r.entrada - c.horario_entrada)) / 60)::int) else 0 end;
            v_excesso := case when r.intervalo_saida is not null and r.intervalo_volta is not null
                              then greatest(0, (extract(epoch from (r.intervalo_volta - r.intervalo_saida)) / 60)::int
                                              - coalesce(r.intervalo_min, rh.intervalo_minimo_calculo(p_colaborador), 60))
                              else 0 end;
            v_perdao := case when v_atraso <= v_tol_atraso then v_atraso else 0 end;
            v_debito := case when v_atraso > v_tol_atraso then v_atraso else 0 end + v_excesso;
            -- atraso tolerado não gera hora devida (mas não vira crédito)
            if v_saldo < 0 then v_saldo := v_saldo + least(v_perdao, -v_saldo); end if;
            -- atraso acima da tolerância e almoço excedente sempre contam
            if v_debito > 0 then v_saldo := least(v_saldo, -v_debito); end if;
            if v_debito > 0 then
              v_desc := concat_ws(' · ',
                case when v_atraso > v_tol_atraso then 'Atraso ' || rh.banco_horas_fmt(v_atraso) end,
                case when v_excesso > 0 then 'Almoço excedido ' || rh.banco_horas_fmt(v_excesso) end);
            end if;
          end if;
        elsif v_tem_r and r.entrada is not null and v_prev > 0 and v_abono = 0 and abs(v_bruto) <= v_tol then
          v_saldo := 0;
        end if;
        if v_incompleto and v_desc is null then v_desc := 'Registro incompleto'; end if;
      end if;
    end if;

    tipo_dia := v_tipo;
    descricao := v_desc;
    trabalhadas_min := v_trab;
    previstas_min := v_prev;
    abono_min := v_abono;
    saldo_bruto_min := v_bruto;
    saldo_min := v_saldo;
    incompleto := coalesce(v_incompleto, false);
    return next;
    d := d + 1;
  end loop;
end;
$$;
revoke all on function rh.ponto_apuracao(uuid, date, date) from public;
grant execute on function rh.ponto_apuracao(uuid, date, date) to authenticated;

-- Início da apuração do banco de horas (dia seguinte ao saldo inicial).
create or replace function rh.banco_horas_inicio()
returns date
language sql
stable
security definer
set search_path = rh, pg_temp
as $$
  select coalesce((select compensacao_inicio from rh.configuracoes_ponto where id = 1),
                  (now() at time zone 'America/Sao_Paulo')::date);
$$;
grant execute on function rh.banco_horas_inicio() to authenticated;

-- Início da apuração de UM colaborador, nunca antes do início geral:
--   * com saldo anterior informado → dia seguinte ao "válido até";
--   * sem saldo anterior → primeiro dia com ponto registrado no sistema
--     (quem ainda não usa o sistema não acumula falta por isso).
create or replace function rh.banco_horas_inicio_colab(p_colaborador uuid)
returns date
language sql
stable
security definer
set search_path = rh, pg_temp
as $$
  select greatest(rh.banco_horas_inicio(),
                  coalesce((select s.data_referencia + 1 from rh.banco_horas_saldos_iniciais s where s.colaborador_id = p_colaborador),
                           (select min(r.data) from rh.ponto_registros r where r.colaborador_id = p_colaborador and r.entrada is not null),
                           (now() at time zone 'America/Sao_Paulo')::date));
$$;
grant execute on function rh.banco_horas_inicio_colab(uuid) to authenticated;

-- Extrato com saldo acumulado — o que as telas do colaborador e do RH leem.
-- Linhas antes do início da apuração aparecem com saldo 0 no acumulado
-- (já estão dentro do saldo inicial).
drop function if exists rh.banco_horas_extrato(uuid, date, date);
create or replace function rh.banco_horas_extrato(p_colaborador uuid, p_inicio date, p_fim date)
returns table (
  data date, dia_semana text, tipo_dia text, descricao text,
  entrada time, intervalo_saida time, intervalo_volta time, saida time,
  trabalhadas_min integer, previstas_min integer, abono_min integer,
  saldo_bruto_min integer, saldo_min integer, incompleto boolean, alterado_rh boolean, local text, abono_tipo text,
  marcacoes_manuais text[],
  conta_no_banco boolean,
  saldo_acumulado_min integer
)
language plpgsql
stable
security definer
set search_path = rh, pg_temp
as $$
declare
  v_inicio_bh date := rh.banco_horas_inicio_colab(p_colaborador);
  v_ini_saldo integer;
  v_antes integer := 0;
begin
  if auth.uid() is not null and not rh.is_rh_staff() and p_colaborador is distinct from rh.colaborador_atual() then
    raise exception 'Sem permissão para ver o extrato deste colaborador.' using errcode = '42501';
  end if;
  select coalesce((select s.minutos from rh.banco_horas_saldos_iniciais s where s.colaborador_id = p_colaborador), 0) into v_ini_saldo;
  if p_inicio > v_inicio_bh then
    select coalesce(sum(a.saldo_min), 0) into v_antes from rh.ponto_apuracao(p_colaborador, v_inicio_bh, p_inicio - 1) a;
  end if;
  return query
    select a.data, a.dia_semana, a.tipo_dia, a.descricao, a.entrada, a.intervalo_saida, a.intervalo_volta, a.saida,
           a.trabalhadas_min, a.previstas_min, a.abono_min, a.saldo_bruto_min, a.saldo_min, a.incompleto, a.alterado_rh, a.local, a.abono_tipo,
           a.marcacoes_manuais,
           (a.data >= v_inicio_bh) as conta_no_banco,
           (v_ini_saldo + v_antes + sum(case when a.data >= v_inicio_bh then a.saldo_min else 0 end) over (order by a.data))::int
      from rh.ponto_apuracao(p_colaborador, p_inicio, p_fim) a
     order by a.data;
end;
$$;
revoke all on function rh.banco_horas_extrato(uuid, date, date) from public;
grant execute on function rh.banco_horas_extrato(uuid, date, date) to authenticated;

-- Resumo do banco de horas de um colaborador (até ontem).
drop function if exists rh.banco_horas_resumo(uuid);
create or replace function rh.banco_horas_resumo(p_colaborador uuid)
returns table (inicio_apuracao date, saldo_inicial_min integer, saldo_inicial_ate date, creditos_min integer, debitos_min integer, saldo_min integer, ate date)
language plpgsql
stable
security definer
set search_path = rh, pg_temp
as $$
declare
  v_ini date := rh.banco_horas_inicio_colab(p_colaborador);
  v_ontem date := (now() at time zone 'America/Sao_Paulo')::date - 1;
  v_cred integer := 0;
  v_deb integer := 0;
  s rh.banco_horas_saldos_iniciais;
begin
  if auth.uid() is not null and not rh.is_rh_staff() and p_colaborador is distinct from rh.colaborador_atual() then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  select * into s from rh.banco_horas_saldos_iniciais x where x.colaborador_id = p_colaborador;
  if v_ontem >= v_ini then
    select coalesce(sum(greatest(a.saldo_min, 0)), 0), coalesce(sum(greatest(-a.saldo_min, 0)), 0)
      into v_cred, v_deb
      from rh.ponto_apuracao(p_colaborador, v_ini, v_ontem) a;
  end if;
  inicio_apuracao := v_ini;
  saldo_inicial_min := coalesce(s.minutos, 0);
  saldo_inicial_ate := coalesce(s.data_referencia, v_ini - 1);
  creditos_min := v_cred;
  debitos_min := v_deb;
  saldo_min := coalesce(s.minutos, 0) + v_cred - v_deb;
  ate := v_ontem;
  return next;
end;
$$;
revoke all on function rh.banco_horas_resumo(uuid) from public;
grant execute on function rh.banco_horas_resumo(uuid) to authenticated;

-- Saldo atual de todos (último movimento processado de cada um) — RH.
drop function if exists rh.banco_horas_saldos();
create or replace function rh.banco_horas_saldos()
returns table (colaborador_id uuid, saldo_min integer, ate date)
language sql
stable
security definer
set search_path = rh, pg_temp
as $$
  select distinct on (m.colaborador_id) m.colaborador_id, m.saldo_apos_min, m.data
    from rh.banco_horas_movimentos m
   where rh.is_rh_staff() or auth.uid() is null
   order by m.colaborador_id, m.data desc, m.tipo desc;
$$;
revoke all on function rh.banco_horas_saldos() from public;
grant execute on function rh.banco_horas_saldos() to authenticated;

-- -----------------------------------------------------------------------------
-- 4. banco_horas_processar com a regra nova
-- -----------------------------------------------------------------------------
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
  a record;
  v_ini integer;
  v_extras integer;
  v_dev integer;
  v_e integer;
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

  for c in
    select id, nome from rh.colaboradores
     where (p_colaborador is null or id = p_colaborador)
       and (status is distinct from 'INATIVO' or id = p_colaborador)
  loop
    delete from rh.banco_horas_movimentos where colaborador_id = c.id;
    v_datas := array[]::date[];
    v_inicio := rh.banco_horas_inicio_colab(c.id);

    select coalesce((select minutos from rh.banco_horas_saldos_iniciais where colaborador_id = c.id), 0) into v_ini;
    v_extras := greatest(v_ini, 0);
    v_dev := greatest(-v_ini, 0);
    insert into rh.banco_horas_movimentos (colaborador_id, data, tipo, extras_min, devidas_min, compensado_min,
      extras_antes_min, devidas_antes_min, extras_apos_min, devidas_apos_min, saldo_apos_min, saldo_dia_min, tipo_dia, descricao)
    values (c.id, v_inicio - 1, 'SALDO_INICIAL', v_extras, v_dev, 0, v_extras, v_dev, v_extras, v_dev, v_ini, v_ini, 'SALDO_INICIAL',
            'Saldo anterior do banco de horas');

    if v_hoje - 1 >= v_inicio then
      for a in select * from rh.ponto_apuracao(c.id, v_inicio, v_hoje - 1) x order by x.data loop
        if a.saldo_min = 0 then continue; end if;
        v_e := greatest(a.saldo_min, 0);
        v_d := greatest(-a.saldo_min, 0);
        v_saldo_ant := v_extras - v_dev;
        v_extras := v_extras + v_e;
        v_dev := v_dev + v_d;
        v_abat := least(v_extras, v_dev);

        insert into rh.banco_horas_movimentos (colaborador_id, data, tipo, extras_min, devidas_min, atraso_min, intervalo_excedente_min,
          compensado_min, extras_antes_min, devidas_antes_min, extras_apos_min, devidas_apos_min, saldo_apos_min,
          saldo_dia_min, tipo_dia, descricao, trabalhadas_min, previstas_min, abono_min)
        values (c.id, a.data, 'DIA', v_e, v_d, 0, 0, v_abat, v_extras, v_dev, v_extras - v_abat, v_dev - v_abat, v_extras - v_dev,
                a.saldo_min, a.tipo_dia, a.descricao, a.trabalhadas_min, a.previstas_min, a.abono_min);

        if v_abat > 0 then
          if v_d > 0 then
            v_motivo := 'Horas devidas em ' || to_char(a.data, 'DD/MM/YYYY') || ' ('
                     || case when a.tipo_dia in ('FALTA', 'FALTA_JUSTIFICADA') then 'falta de ' || rh.banco_horas_fmt(v_d)
                             else 'trabalhou ' || rh.banco_horas_fmt(a.trabalhadas_min) || ' de ' || rh.banco_horas_fmt(a.previstas_min) end
                     || ') compensadas automaticamente com as horas extras acumuladas.';
          else
            v_motivo := 'Horas extras de ' || to_char(a.data, 'DD/MM/YYYY') || ' usadas automaticamente para quitar horas devidas pendentes.';
          end if;
          if rh.banco_horas_registrar_comp(c.id, a.data, v_extras, v_dev, v_abat, v_saldo_ant, v_extras - v_dev, v_motivo) then v_total := v_total + 1; end if;
          v_datas := v_datas || a.data;
        end if;
        v_extras := v_extras - v_abat;
        v_dev := v_dev - v_abat;
      end loop;
    end if;

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

-- -----------------------------------------------------------------------------
-- 5. Correção de jornada pelo RH: o RH pode corrigir a jornada de um dia
--    (meta_horas) — antes o trigger nunca deixava trocar depois de gravado.
-- -----------------------------------------------------------------------------
create or replace function rh.ponto_fixar_jornada_do_dia()
returns trigger
language plpgsql
security definer
set search_path = rh, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    if (auth.uid() is null or rh.is_rh_staff()) and new.meta_horas is distinct from old.meta_horas and new.meta_horas is not null then
      -- correção explícita do RH / script: mantém o valor informado
      null;
    else
      new.meta_horas := coalesce(old.meta_horas, new.meta_horas, rh.meta_diaria_colaborador(new.colaborador_id));
    end if;
    new.intervalo_min := coalesce(old.intervalo_min, new.intervalo_min, rh.intervalo_minimo_calculo(new.colaborador_id));
  else
    new.meta_horas := coalesce(new.meta_horas, rh.meta_diaria_colaborador(new.colaborador_id));
    new.intervalo_min := coalesce(new.intervalo_min, rh.intervalo_minimo_calculo(new.colaborador_id));
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Primeiro processamento
-- -----------------------------------------------------------------------------
select rh.banco_horas_processar() as compensacoes_registradas;
