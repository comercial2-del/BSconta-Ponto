-- =============================================================================
-- 29 — Ponto: folga pela imprecisão do GPS/Wi-Fi na regra "Na empresa".
--
-- Problema: em computador (e alguns celulares) a localização vem por Wi-Fi/
-- rede, com erro de ~100–300 m. Colaboradores DENTRO da Global Tower apareciam
-- a ~515 m da sede (precisão ~207 m) e o ponto caía como HOME_OFFICE.
--
-- Nova regra na ENTRADA: PRESENCIAL se (distância − precisão) <= 500 m,
-- com a folga limitada a 300 m. Igual a avaliarLocalEmpresa() em js/ui.js.
--
-- SEGURANÇA: só recria a função rh.ponto_validar_localizacao() (mesma do
-- script 28 + folga). Não apaga nem altera nenhuma linha. Pode rodar de novo.
-- =============================================================================

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
  c_tolerancia_max_m constant double precision := 300;

  v_old rh.ponto_registros;
  v_tem_old boolean := false;
  v_batida_nova boolean;
  v_entrada_nova boolean;
  v_lat double precision;
  v_lng double precision;
  v_prec double precision;
  v_folga double precision := 0;
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
    if v_tem_old then new.local := v_old.local; new.geo := v_old.geo; end if;
    return new;
  end if;

  -- Localização só é exigida na ENTRADA (primeiro ponto do dia). Nas demais
  -- batidas (intervalo, retorno, saída) o local e a localização do dia
  -- continuam os da entrada — o colaborador não consegue trocá-los.
  if not v_entrada_nova then
    if v_tem_old then new.local := v_old.local; new.geo := v_old.geo; end if;
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
    v_folga := least(greatest(v_prec, 0), c_tolerancia_max_m);
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
    new.local := case when v_dist - v_folga <= c_raio_m then 'PRESENCIAL' else 'HOME_OFFICE' end;
  elsif v_tem_old then
    new.local := v_old.local;
  end if;

  new.geo := jsonb_set(new.geo, '{distancia_m}', to_jsonb(round(v_dist)::int), true);
  return new;
end;
$$;

-- Conferência (só leitura).
select proname from pg_proc where proname = 'ponto_validar_localizacao';
