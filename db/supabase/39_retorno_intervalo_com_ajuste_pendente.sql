-- =============================================================================
-- 39 — Retorno do intervalo liberado quando a saída está "Pendente de ajuste"
-- =============================================================================
-- Problema: o colaborador bateu a saída do intervalo no horário errado (ex.:
-- 13:35 em vez de 12:00) e pediu ajuste. Enquanto o RH não valida, a regra do
-- intervalo mínimo continuava contando a partir do horário REGISTRADO (13:35)
-- e travava o retorno até 14:35, mesmo ele já tendo voltado.
--
-- Regra nova: se existe solicitação PENDENTE de "Ajuste de ponto" para o dia
-- com novo horário para a saída do intervalo, o intervalo mínimo conta a
-- partir do horário SOLICITADO. O resto da função é igual ao script 30.
--
-- Seguro para rodar mais de uma vez. Rodar no Supabase: SQL Editor → Run.
-- =============================================================================

-- Horário solicitado (pendente) para a saída do intervalo de um dia, ou null.
create or replace function rh.ponto_intervalo_saida_solicitada(p_colaborador uuid, p_data date)
returns time
language sql
stable
security definer
set search_path = rh, pg_temp
as $$
  select min(h)
  from (
    select (it->>'horario')::time as h
      from rh.solicitacoes s,
           jsonb_array_elements(coalesce(s.ajuste_ponto->'itens', '[]'::jsonb)) it
     where s.colaborador_id = p_colaborador
       and s.categoria = 'Ajuste de ponto' and s.status = 'PENDENTE'
       and (s.ajuste_ponto->>'data')::date = p_data
       and it->>'campo' = 'intervaloSaida'
       and coalesce(it->>'horario', '') ~ '^\d{1,2}:\d{2}'
    union all
    select (s.ajuste_ponto->>'horario')::time
      from rh.solicitacoes s
     where s.colaborador_id = p_colaborador
       and s.categoria = 'Ajuste de ponto' and s.status = 'PENDENTE'
       and (s.ajuste_ponto->>'data')::date = p_data
       and s.ajuste_ponto->>'campo' = 'intervaloSaida'
       and coalesce(s.ajuste_ponto->>'horario', '') ~ '^\d{1,2}:\d{2}'
  ) x;
$$;

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
  v_base_saida time;
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

  -- Saída do intervalo com ajuste pendente: conta a partir do horário solicitado.
  v_base_saida := coalesce(rh.ponto_intervalo_saida_solicitada(new.colaborador_id, new.data), new.intervalo_saida);

  if v_volta_mudou and v_min > 0
     and (new.intervalo_volta - v_base_saida) < make_interval(mins => v_min) then
    raise exception 'O intervalo mínimo é de % minutos. Retorno permitido a partir das %.',
      v_min, to_char(date '2000-01-01' + v_base_saida + make_interval(mins => v_min), 'HH24:MI')
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

-- (trigger trg_ponto_validar_intervalo continua o mesmo — só a função mudou)
