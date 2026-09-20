-- BSconta+ RH — publicar automaticamente comunicados agendados na data
-- =============================================================================
-- Usa a extensão "pg_cron", que a Supabase permite ativar direto por SQL
-- (o "create extension" abaixo já tenta isso). Se o projeto tiver alguma
-- restrição que bloqueie isso pela chave normal (raro, mas possível em
-- alguns planos/configurações), o erro será algo como "permission denied to
-- create extension" — nesse caso, ative manualmente uma vez em Database >
-- Extensions no painel do projeto zqhuhaqothpxusnaijog (procure "pg_cron" e
-- ative) e rode este script de novo.
--
-- O que ele faz: cria uma função que publica (status -> 'PUBLICADO') todo
-- comunicado que está 'AGENDADO' e cuja data_agendada já chegou, e agenda
-- essa função para rodar a cada 15 minutos. Sem isso, um comunicado
-- agendado fica "preso" em AGENDADO na data prevista até um RH abrir a
-- tela e editá-lo manualmente para PUBLICADO (a tela permite isso — não é
-- um bloqueio para o RH, só não é automático sem este passo).

create extension if not exists pg_cron;

create or replace function rh.publicar_comunicados_agendados()
returns void
language sql
security definer
set search_path = rh, pg_temp
as $$
  update rh.comunicados
  set status = 'PUBLICADO'
  where status = 'AGENDADO'
    and data_agendada is not null
    and data_agendada <= current_date;
$$;

comment on function rh.publicar_comunicados_agendados() is 'Publica automaticamente comunicados AGENDADOS cuja data_agendada já chegou. Chamada periodicamente pelo pg_cron (ver job "rh-publicar-comunicados" abaixo).';

select cron.unschedule(jobid) from cron.job where jobname = 'rh-publicar-comunicados';
select cron.schedule('rh-publicar-comunicados', '*/15 * * * *', 'select rh.publicar_comunicados_agendados();');
