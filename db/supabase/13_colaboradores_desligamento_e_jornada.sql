-- BSconta+ RH — Colaboradores: data de desligamento + jornada configurável
-- de verdade usada no cálculo de ponto/banco de horas
-- =============================================================================
-- Duas correções estruturais pedidas depois da varredura de 18/09/2026:
--
-- 1) "rh.colaboradores" só guardava o STATUS atual (ATIVO/AFASTADO/INATIVO),
--    nunca a data em que alguém foi desligado — o relatório de Colaboradores
--    tinha que admitir "esse dado não existe". Acrescenta a coluna e um
--    trigger que a mantém coerente com o status automaticamente (RH continua
--    podendo sobrescrever a data na mão, se precisar registrar um
--    desligamento retroativo).
--
-- 2) As colunas de jornada por colaborador (horario_entrada, horario_saida,
--    intervalo_inicio, intervalo_fim, dias_trabalho, horas_semanais)
--    JÁ EXISTIAM desde 05_colaboradores_campos_extra.sql e JÁ SÃO editáveis
--    de verdade em rh/colaboradores.html — o problema nunca foi o schema,
--    foi o cálculo em js/rh-ponto-data.js ignorar essas colunas e usar
--    "08:00" e "8 horas" fixos pra todo mundo. Isso foi corrigido no
--    JavaScript (rhConfigJornada / rhCalcularDia, nesta mesma entrega) — a
--    única coisa que faltava no BANCO era garantir que todo colaborador
--    tenha pelo menos um valor de partida sensato nessas colunas (sem isso,
--    o cálculo cairia num "sem jornada configurada" pra quem foi cadastrado
--    antes desta função existir). Este script preenche isso só para quem
--    ainda está null — nunca sobrescreve uma jornada que o RH já configurou.
--
-- Idempotente: pode rodar de novo sem problema.
-- =============================================================================

-- 1) Data de desligamento -----------------------------------------------------

alter table rh.colaboradores
  add column if not exists data_desligamento date;

comment on column rh.colaboradores.data_desligamento is 'Preenchida automaticamente quando o status muda para INATIVO (trigger rh.colaboradores_sync_desligamento) — o RH também pode ajustar/registrar manualmente uma data retroativa.';

create or replace function rh.colaboradores_sync_desligamento()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'INATIVO' and (old.status is distinct from 'INATIVO') and new.data_desligamento is null then
    new.data_desligamento := current_date;
  elsif new.status <> 'INATIVO' then
    new.data_desligamento := null;
  end if;
  return new;
end;
$$;
comment on function rh.colaboradores_sync_desligamento() is 'Ao marcar um colaborador como INATIVO, grava a data de desligamento automaticamente (se o RH não informou uma na hora). Ao reativar (status volta a ATIVO/AFASTADO), limpa a data — reflete que a pessoa não está mais desligada.';

drop trigger if exists trg_colaboradores_desligamento on rh.colaboradores;
create trigger trg_colaboradores_desligamento
  before update on rh.colaboradores
  for each row
  execute function rh.colaboradores_sync_desligamento();

-- 2) Backfill de jornada padrão só para quem ainda não tem nada configurado --
--    (SEG–SEX, 08:00–17:00 com 1h de almoço, 8h/dia = 40h/semana — a jornada
--    "padrão CLT" mais comum; ajuste depois, por pessoa, em
--    rh/colaboradores.html, sempre que for diferente disso).

update rh.colaboradores
set
  horario_entrada = coalesce(horario_entrada, '08:00'),
  horario_saida = coalesce(horario_saida, '17:00'),
  intervalo_inicio = coalesce(intervalo_inicio, '12:00'),
  intervalo_fim = coalesce(intervalo_fim, '13:00'),
  dias_trabalho = coalesce(dias_trabalho, array['SEG','TER','QUA','QUI','SEX']),
  horas_semanais = coalesce(horas_semanais, 40)
where horario_entrada is null
   or horario_saida is null
   or dias_trabalho is null
   or horas_semanais is null;

-- Confirmação rápida:
select codigo, nome, status, data_desligamento, horario_entrada, horario_saida, dias_trabalho, horas_semanais
from rh.colaboradores
order by codigo;
