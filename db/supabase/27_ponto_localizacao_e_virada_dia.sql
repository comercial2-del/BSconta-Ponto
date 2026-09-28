-- =============================================================================
-- 27 — Ponto: virada do dia no fuso de Brasília + localização obrigatória
--      (raio de 500 m da sede) em TODA batida.
--
-- SEGURANÇA DOS DADOS (o banco é compartilhado com o sistema de Marketing):
--   * Mexe SOMENTE no schema "rh" e SOMENTE na tabela rh.ponto_registros.
--   * NÃO apaga, NÃO altera e NÃO reprocessa nenhuma linha existente.
--     Não há DELETE, UPDATE, TRUNCATE, DROP TABLE nem ALTER TABLE aqui.
--   * Só cria/substitui: 2 funções novas (rh.hoje_ponto, rh.ponto_validar_localizacao),
--     1 trigger novo e as 2 policies do colaborador em rh.ponto_registros
--     (mesmo nome, mesma regra — só troca current_date pelo dia de Brasília).
--   * O trigger ignora o RH (rh.is_rh_staff()) e qualquer acesso sem usuário
--     logado (service_role / outros sistemas / jobs) — ou seja, não afeta
--     integrações nem ajustes feitos pelo RH.
--   * Idempotente: pode rodar de novo sem efeito colateral.
--
-- 1) VIRADA DO DIA
--    Antes as policies usavam current_date, que no Supabase é UTC. Das 21:00
--    às 23:59 (Brasília) o "hoje" do banco já era o dia seguinte e o
--    colaborador recebia erro de permissão ao bater o ponto. Agora o dia de
--    ponto é o dia civil de Brasília (00:00 → 23:59): a cada 24 h começa um
--    novo dia (uma nova linha em rh.ponto_registros), e os dias anteriores
--    continuam salvos como estão — completos ou com batida esquecida.
--
-- 2) LOCALIZAÇÃO OBRIGATÓRIA (mesma regra de js/ui.js / js/demo-data.js)
--    Em toda batida feita pelo colaborador (entrada, saída/retorno do
--    intervalo, saída):
--      * geo precisa ter lat/lng válidos — sem localização, o registro é
--        recusado;
--      * precisão pior que 2000 m é recusada (não dá para validar);
--      * na ENTRADA o local do dia é definido pela distância até a sede
--        (Global Tower / Minas Shopping): até 500 m = PRESENCIAL, acima =
--        HOME_OFFICE. Nas batidas seguintes o local do dia não muda.
-- =============================================================================

-- Dia de ponto (Brasília).
create or replace function rh.hoje_ponto()
returns date
language sql
stable
set search_path = rh, pg_temp
as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;
comment on function rh.hoje_ponto() is 'Dia de ponto = dia civil em America/Sao_Paulo. Usado nas policies do colaborador em rh.ponto_registros (antes: current_date em UTC).';

-- Policies do colaborador: mesma regra de antes, com o dia de Brasília.
drop policy if exists "self upsert hoje - ponto" on rh.ponto_registros;
create policy "self upsert hoje - ponto" on rh.ponto_registros
  for insert with check (colaborador_id = rh.colaborador_atual() and data = rh.hoje_ponto());

drop policy if exists "self update hoje - ponto" on rh.ponto_registros;
create policy "self update hoje - ponto" on rh.ponto_registros
  for update using (colaborador_id = rh.colaborador_atual() and data = rh.hoje_ponto())
  with check (colaborador_id = rh.colaborador_atual() and data = rh.hoje_ponto());

-- Validação da localização.
create or replace function rh.ponto_validar_localizacao()
returns trigger
language plpgsql
security definer
set search_path = rh, pg_temp
as $$
declare
  -- Sede: Global Tower (região do Minas Shopping) — R. Queluzita, 34, BH/MG.
  -- Manter igual a EMPRESA_INFO em js/demo-data.js.
  c_empresa_lat constant double precision := -19.8730016;
  c_empresa_lng constant double precision := -43.9256631;
  c_raio_m      constant double precision := 500;
  c_precisao_max_m constant double precision := 2000;

  v_old rh.ponto_registros;
  v_tem_old boolean := false;
  v_batida_nova boolean;
  v_entrada_nova boolean;
  v_lat double precision;
  v_lng double precision;
  v_prec double precision;
  v_dist double precision;
  v_num text := '^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$';
begin
  -- RH e acessos sem usuário (service_role, outros sistemas) seguem livres.
  if auth.uid() is null or rh.is_rh_staff() then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_old := old;
    v_tem_old := true;
  else
    select * into v_old from rh.ponto_registros
     where colaborador_id = new.colaborador_id and data = new.data;
    v_tem_old := found;
  end if;

  v_entrada_nova := new.entrada is not null and (not v_tem_old or v_old.entrada is null);
  v_batida_nova := v_entrada_nova
    or (new.intervalo_saida is not null and (not v_tem_old or new.intervalo_saida is distinct from v_old.intervalo_saida))
    or (new.intervalo_volta is not null and (not v_tem_old or new.intervalo_volta is distinct from v_old.intervalo_volta))
    or (new.saida is not null and (not v_tem_old or new.saida is distinct from v_old.saida));

  if not v_batida_nova then
    -- Nenhuma batida nova: o colaborador não pode trocar o local já gravado.
    if v_tem_old then new.local := v_old.local; end if;
    return new;
  end if;

  if new.geo is null
     or coalesce(new.geo->>'lat', '') !~ v_num
     or coalesce(new.geo->>'lng', '') !~ v_num then
    raise exception 'Localização obrigatória: permita o acesso à localização do dispositivo para registrar o ponto.'
      using errcode = 'P0001', hint = 'regra_localizacao_obrigatoria';
  end if;

  v_lat := (new.geo->>'lat')::double precision;
  v_lng := (new.geo->>'lng')::double precision;
  if v_lat not between -90 and 90 or v_lng not between -180 and 180 then
    raise exception 'Localização inválida. Tente registrar o ponto novamente.'
      using errcode = 'P0001', hint = 'regra_localizacao_invalida';
  end if;

  if coalesce(new.geo->>'precisao', '') ~ v_num then
    v_prec := (new.geo->>'precisao')::double precision;
    if v_prec > c_precisao_max_m then
      raise exception 'A localização está imprecisa demais (~% m) para validar onde você está. Ative o GPS/Wi-Fi e tente de novo.', round(v_prec)
        using errcode = 'P0001', hint = 'regra_localizacao_imprecisa';
    end if;
  end if;

  -- Distância (Haversine) até a sede.
  v_dist := 2 * 6371000 * asin(sqrt(
      power(sin(radians(v_lat - c_empresa_lat) / 2), 2)
    + cos(radians(c_empresa_lat)) * cos(radians(v_lat)) * power(sin(radians(v_lng - c_empresa_lng) / 2), 2)
  ));

  if v_entrada_nova then
    new.local := case when v_dist <= c_raio_m then 'PRESENCIAL' else 'HOME_OFFICE' end;
  elsif v_tem_old then
    new.local := v_old.local;
  end if;

  new.geo := jsonb_set(new.geo, '{distancia_m}', to_jsonb(round(v_dist)::int), true);
  return new;
end;
$$;

drop trigger if exists trg_ponto_validar_localizacao on rh.ponto_registros;
create trigger trg_ponto_validar_localizacao
  before insert or update on rh.ponto_registros
  for each row execute function rh.ponto_validar_localizacao();

-- Conferência (só leitura).
select rh.hoje_ponto() as dia_de_ponto_brasilia, current_date as current_date_utc;
