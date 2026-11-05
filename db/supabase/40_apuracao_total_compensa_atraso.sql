-- =============================================================================
-- 40 — Apuração total do dia: atraso e almoço excedido são compensados no dia
-- =============================================================================
-- Problema (Arthur, 04/11/2026): entrada 08:55 (55 min de atraso), almoço de
-- 1h09 e saída 18:38 → trabalhou 8:34h de 8:30h previstas, mas o saldo do dia
-- saiu −1:04h. A regra do script 33 (a partir de
-- configuracoes_ponto.regra_atraso_almoco_inicio) cobrava SEMPRE o atraso
-- acima de 15 min e o almoço acima do mínimo, mesmo compensados no dia.
--
-- Regra nova (decisão da empresa em 05/11/2026), para TODO o período:
--   saldo do dia = trabalhadas + abono − previstas
--   * Atraso e almoço excedido entram só pelo que de fato faltou no dia —
--     ficar mais tarde compensa. Ex.: 04/11 do Arthur → +0:04h.
--   * Atraso de até 15 min (tolerancia_atraso_min) continua tolerado: não
--     gera hora devida (mas não vira crédito).
--   * Dia não finalizado ("Pendente de ajuste", script 38) não muda.
--
-- Só recria rh.ponto_apuracao (o resto do script 33/38 continua igual) e
-- reprocessa o banco de horas de todos. Não apaga nenhum registro de ponto.
-- Seguro para rodar mais de uma vez. Rodar no Supabase: SQL Editor → Run.
-- (Já aplicado em produção em 05/11/2026: banco do Arthur foi de −22:53h
-- para −19:59h, alinhado com a Sólides.)
-- =============================================================================

create or replace function rh.ponto_apuracao(p_colaborador uuid, p_inicio date, p_fim date)
returns table (
  data date,
  dia_semana text,
  tipo_dia text,           -- TRABALHO | FIM_DE_SEMANA | FERIADO | FALTA | FALTA_JUSTIFICADA | ABONO | HOJE | FUTURO | FORA_CONTRATO
  descricao text,          -- nome do feriado / tipo do abono / "Falta" / "Pendente de ajuste"
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
            -- atraso tolerado não gera hora devida (mas não vira crédito)
            if v_saldo < 0 then v_saldo := v_saldo + least(v_perdao, -v_saldo); end if;
            -- (40) Apuração TOTAL do dia: atraso acima da tolerância e almoço
            -- excedente NÃO são mais cobrados à parte — se a pessoa compensou
            -- ficando mais tarde no mesmo dia, o saldo é o do dia inteiro
            -- (trabalhadas − previstas). Só fica negativo o que faltou mesmo.
            -- A descrição só explica a causa quando o dia fechou negativo.
            if v_saldo < 0 and (v_atraso > v_tol_atraso or v_excesso > 0) then
              v_desc := concat_ws(' · ',
                case when v_atraso > v_tol_atraso then 'Atraso ' || rh.banco_horas_fmt(v_atraso) end,
                case when v_excesso > 0 then 'Almoço excedido ' || rh.banco_horas_fmt(v_excesso) end);
            end if;
          end if;
        elsif v_tem_r and r.entrada is not null and v_prev > 0 and v_abono = 0 and abs(v_bruto) <= v_tol then
          v_saldo := 0;
        end if;
        -- (38) Ponto NÃO FINALIZADO não é falta nem débito de horas: a
        -- pessoa trabalhou, só esqueceu de bater a saída/retorno. O dia fica
        -- "Pendente de ajuste" com saldo 0 (só o atraso acima da tolerância,
        -- se houver, continua contando) até o RH lançar o horário que
        -- faltou — aí o dia fica completo e volta ao cálculo normal.
        if v_incompleto and v_prev > 0 and v_abono = 0 then
          -- O almoço NÃO é cobrado aqui: em dia não finalizado o "retorno do
          -- intervalo" muitas vezes é, na verdade, a saída do dia (ex.:
          -- 12:12 → 17:35), e cobrar isso como almoço excedido seria
          -- descontar como falta de novo.
          v_saldo := case when v_regra_ini is not null and d >= v_regra_ini and coalesce(v_atraso, 0) > v_tol_atraso
                          then -v_atraso else 0 end;
          v_desc := 'Pendente de ajuste';
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

-- Reprocessa o banco de horas de todos com a regra nova.
select rh.banco_horas_processar();
