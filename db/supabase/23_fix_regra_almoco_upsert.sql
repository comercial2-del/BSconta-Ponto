-- =============================================================================
-- 23 — Regra do almoço: valida só a batida nova (inclusive no UPSERT) e
--      fecha as brechas do intervalo mínimo.
--
-- Não altera nenhum dado. Só substitui a função rh.ponto_validar_intervalo e
-- recria o trigger (mesma função) incluindo a coluna "saida".
--
-- Regra (vale para o colaborador; RH e service_role continuam livres para
-- ajustar, como antes):
--   * Intervalo mínimo (configuracoes_ponto.intervalo_minimo_min, hoje 60)
--     contado a partir da saída para o intervalo, a qualquer hora do dia:
--     saiu 09:00 → volta a partir de 10:00; saiu 12:00 → a partir de 13:00.
--     Voltar exatamente 60 min depois é permitido (volta − saída < 60 bloqueia).
--   * Horário mínimo para começar o almoço só se o RH configurar
--     (almoco_inicio_minimo; em branco = sem horário mínimo).
--   * Só valida o que ESTÁ SENDO BATIDO agora. A tela grava com UPSERT: no
--     caminho INSERT do upsert o registro do dia já existe, então comparamos
--     com a linha gravada (antes, tudo era tratado como novo e a saída já
--     gravada era revalidada — caso do Marlon).
--   * Batida de intervalo já gravada não pode ser alterada pelo colaborador
--     (correção só via ajuste aprovado pelo RH).
--   * Não dá para registrar o retorno sem a saída para o intervalo, nem a
--     saída do dia sem ter registrado saída e retorno do intervalo
--     (se intervalo_minimo_min = 0, o RH desliga essa exigência).
--   * Registros antigos nunca são reavaliados.
-- =============================================================================

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
begin
  if auth.uid() is null or rh.is_rh_staff() then
    return new;
  end if;
  select * into cfg from rh.configuracoes_ponto where id = 1;
  if not found then
    return new;
  end if;

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

  if v_volta_mudou and cfg.intervalo_minimo_min > 0
     and (new.intervalo_volta - new.intervalo_saida) < make_interval(mins => cfg.intervalo_minimo_min) then
    raise exception 'O intervalo mínimo é de % minutos. Retorno permitido a partir das %.',
      cfg.intervalo_minimo_min, to_char(date '2000-01-01' + new.intervalo_saida + make_interval(mins => cfg.intervalo_minimo_min), 'HH24:MI')
      using errcode = 'P0001', hint = 'regra_intervalo_minimo';
  end if;

  if v_fim_mudou and cfg.intervalo_minimo_min > 0
     and (new.intervalo_saida is null or new.intervalo_volta is null) then
    raise exception 'Registre a saída e o retorno do intervalo (mínimo de % minutos) antes de registrar a saída.', cfg.intervalo_minimo_min
      using errcode = 'P0001', hint = 'regra_intervalo_obrigatorio';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ponto_validar_intervalo on rh.ponto_registros;
create trigger trg_ponto_validar_intervalo
  before insert or update of intervalo_saida, intervalo_volta, saida on rh.ponto_registros
  for each row execute function rh.ponto_validar_intervalo();

-- Mostra a regra gravada.
select * from rh.configuracoes_ponto;
