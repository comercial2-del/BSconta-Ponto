-- =============================================================================
-- BSconta+ RH — colunas extras de jornada em rh.colaboradores
-- =============================================================================
-- O protótipo (js/employee-registry.js) já tinha campos de jornada detalhada
-- (intervalo, dias da semana, horas semanais) que o schema original
-- (01_schema_rh.sql) ainda não tinha — só existia "horario_previsto" (texto
-- livre) e "meta_diaria_horas". Este script ACRESCENTA essas colunas (não
-- substitui nada, não apaga dado nenhum) para a tela rh/colaboradores.html
-- poder gravar/ler isso de verdade no banco, em vez de manter esses campos
-- só no localStorage do navegador.
--
-- Idempotente: "add column if not exists" pode rodar de novo sem erro.
-- Rode depois de 01_schema_rh.sql (antes ou depois de 02/03/04, não importa).
-- =============================================================================

alter table rh.colaboradores add column if not exists horario_entrada time;
alter table rh.colaboradores add column if not exists horario_saida time;
alter table rh.colaboradores add column if not exists intervalo_inicio time;
alter table rh.colaboradores add column if not exists intervalo_fim time;
alter table rh.colaboradores add column if not exists dias_trabalho text[];
alter table rh.colaboradores add column if not exists horas_semanais numeric;

comment on column rh.colaboradores.horario_entrada is 'Horário previsto de entrada (jornada contratada) — separado do horário REAL batido em rh.ponto_registros.';
comment on column rh.colaboradores.horario_saida is 'Horário previsto de saída (jornada contratada).';
comment on column rh.colaboradores.dias_trabalho is 'Ex.: {SEG,TER,QUA,QUI,SEX} — dias da semana em que o colaborador trabalha.';
