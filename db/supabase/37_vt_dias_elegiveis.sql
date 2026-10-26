-- =============================================================================
-- 37 — Vale-transporte calculado pelos dias elegíveis
-- =============================================================================
-- A planilha do VT (rh.vt_mensal) passa a guardar o detalhe da apuração:
--   dias_periodo       dias de trabalho no período (cadastro, sem feriados,
--                      dentro de admissão/desligamento)
--   ferias_dias        férias aprovadas no período
--   faltas             faltas no ponto + atestados/afastamentos/folgas aprovados
--   desconto_anterior  dias do período anterior que não foram trabalhados e
--                      aconteceram depois do fechamento dele (VT é pago antes)
--   ajuste_manual      true = o RH ajustou os dias à mão; a apuração
--                      automática não sobrescreve mais a linha
-- dias_presenciais continua sendo o resultado (dias elegíveis):
--   (dias_periodo − ferias_dias − faltas, conforme a modalidade) − desconto_anterior
-- Valor do VT = dias elegíveis × valor_dia.
--
-- As colunas são NULÁVEIS de propósito: meses fechados antes desta migração
-- ficam com nulo (não têm o detalhe) e não geram desconto no mês seguinte.
-- Idempotente. Não altera nem apaga dados existentes.
-- =============================================================================

alter table rh.vt_mensal add column if not exists dias_periodo integer;
alter table rh.vt_mensal add column if not exists ferias_dias integer;
alter table rh.vt_mensal add column if not exists faltas integer;
alter table rh.vt_mensal add column if not exists desconto_anterior integer;
alter table rh.vt_mensal add column if not exists ajuste_manual boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vt_mensal_dias_detalhe_check') then
    alter table rh.vt_mensal add constraint vt_mensal_dias_detalhe_check check (
      coalesce(dias_periodo, 0) >= 0 and coalesce(ferias_dias, 0) >= 0
      and coalesce(faltas, 0) >= 0 and coalesce(desconto_anterior, 0) >= 0
    );
  end if;
end $$;

comment on column rh.vt_mensal.dias_periodo is 'Dias de trabalho no período do VT (cadastro, sem feriados, dentro de admissão/desligamento).';
comment on column rh.vt_mensal.ferias_dias is 'Dias de férias aprovadas no período.';
comment on column rh.vt_mensal.faltas is 'Faltas no ponto + atestados/afastamentos/folgas/ausências aprovados no período.';
comment on column rh.vt_mensal.desconto_anterior is 'Dias do período anterior não trabalhados que ocorreram depois do fechamento dele.';
comment on column rh.vt_mensal.ajuste_manual is 'true = dias ajustados à mão pelo RH; a apuração automática não sobrescreve.';
comment on column rh.vt_mensal.dias_presenciais is 'Dias elegíveis ao VT (resultado). Valor do VT = dias_presenciais × valor_dia.';

notify pgrst, 'reload schema';
