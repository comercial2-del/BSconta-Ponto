-- =============================================================================
-- 39 — Retorno do intervalo com a saída "Pendente de ajuste" (retorno provisório)
-- =============================================================================
-- Problema: o colaborador bateu a saída do intervalo no horário errado (ex.:
-- 13:35 em vez de 12:00) e pediu ajuste. Enquanto o RH não valida, a trava do
-- intervalo mínimo (contada da saída registrada) bloqueava o retorno.
--
-- Regra nova (a trava continua valendo nos horários gravados):
--   * Saída do intervalo com ajuste PENDENTE e retorno antes do mínimo → o
--     retorno é aceito como PROVISÓRIO: intervalo_volta = saída registrada +
--     mínimo (ex.: 14:35, "considerado 1h") e o horário real da batida fica em
--     intervalo_volta_real (ex.: 13:38).
--   * RH APROVA o ajuste → o retorno vira o maior entre a batida real e a
--     saída aprovada + mínimo (feito em rhResolverAjustePonto, que recalcula
--     as horas) e intervalo_volta_real é limpo.
--   * RH RECUSA (ou a solicitação sai de PENDENTE sem aprovação) → o retorno
--     considerado continua valendo; intervalo_volta_real é limpo (trigger).
--
-- Seguro para rodar mais de uma vez. Rodar no Supabase: SQL Editor → Run.
-- (Já aplicado em produção em 04/11/2026.)
-- =============================================================================

alter table rh.ponto_registros add column if not exists intervalo_volta_real time;
comment on column rh.ponto_registros.intervalo_volta_real is 'Retorno provisório (script 39): horário REAL da batida de retorno enquanto a saída do intervalo aguarda ajuste. intervalo_volta guarda o retorno considerado (saída + mínimo). Null = retorno normal/concluído.';

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

-- Validação do ponto (igual ao script 30 + regra do retorno provisório).
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

  -- Retorno provisório (script 39): o horário real da batida de retorno só
  -- pode ser gravado pelo colaborador uma vez, e só quando a saída do
  -- intervalo tem ajuste PENDENTE. O retorno gravado (intervalo_volta)
  -- continua respeitando o mínimo a partir da saída registrada (abaixo).
  if new.intervalo_volta_real is not null
     and (not v_tem_old or new.intervalo_volta_real is distinct from v_old.intervalo_volta_real) then
    if v_tem_old and v_old.intervalo_volta_real is not null then
      raise exception 'O retorno do intervalo já foi registrado e não pode ser alterado. Atualize a página.'
        using errcode = 'P0001', hint = 'regra_batida_gravada';
    end if;
    if rh.ponto_intervalo_saida_solicitada(new.colaborador_id, new.data) is null then
      raise exception 'Retorno provisório só é permitido quando a saída do intervalo está pendente de ajuste.'
        using errcode = 'P0001', hint = 'regra_retorno_provisorio';
    end if;
  end if;
  if v_tem_old and v_old.intervalo_volta_real is not null and new.intervalo_volta_real is null
     and rh.ponto_intervalo_saida_solicitada(new.colaborador_id, new.data) is not null then
    raise exception 'Só o RH pode concluir o retorno provisório do intervalo.'
      using errcode = 'P0001', hint = 'regra_retorno_provisorio';
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

-- Solicitação de ajuste sai de PENDENTE sem aprovação (recusada/cancelada):
-- o retorno considerado fica valendo e o provisório é encerrado.
create or replace function rh.ponto_encerrar_retorno_provisorio()
returns trigger
language plpgsql
security definer
set search_path = rh, pg_temp
as $$
begin
  if new.categoria = 'Ajuste de ponto' and old.status = 'PENDENTE'
     and new.status is distinct from 'PENDENTE' and new.status is distinct from 'RESOLVIDA'
     and new.ajuste_ponto ? 'data' then
    update rh.ponto_registros
       set intervalo_volta_real = null
     where colaborador_id = new.colaborador_id
       and data = (new.ajuste_ponto->>'data')::date
       and intervalo_volta_real is not null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ponto_encerrar_retorno_provisorio on rh.solicitacoes;
create trigger trg_ponto_encerrar_retorno_provisorio
  after update of status on rh.solicitacoes
  for each row execute function rh.ponto_encerrar_retorno_provisorio();
