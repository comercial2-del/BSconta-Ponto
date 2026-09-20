-- BSconta+ RH — agendamento automático do lembrete de ponto (pg_cron + pg_net)
-- =============================================================================
-- Fecha a última parte do lembrete de ponto sem aba aberta: alguém precisa
-- CHAMAR a Edge Function send-push (modo lote) a cada poucos minutos, sem
-- depender de nenhum navegador aberto. Isso é feito por dois recursos que já
-- vêm com o Postgres do Supabase, mas que ficam DESLIGADOS por padrão:
--
--   - pg_cron: agenda tarefas SQL recorrentes dentro do próprio Postgres.
--   - pg_net:  faz chamadas HTTP de dentro do Postgres (é isso que vai
--              chamar a URL da Edge Function).
--
-- Os dois "create extension" abaixo já tentam ativar as extensões direto por
-- SQL (a Supabase permite isso para pg_cron/pg_net na maioria dos projetos).
-- Se algum dos dois falhar com "permission denied to create extension" (raro,
-- depende do plano/configuração do projeto), ative manualmente uma vez em
-- Database → Extensions no painel do Supabase (procure "pg_cron" e "pg_net")
-- e rode este script de novo.
--
-- Antes de rodar, ajuste as DUAS linhas marcadas "AJUSTE AQUI" abaixo (a URL
-- do seu projeto já está certa, mas o SEGREDO precisa ser EXATAMENTE o mesmo
-- valor configurado como secret CRON_SHARED_SECRET da Edge Function
-- send-push — ver SETUP-SUPABASE.md, Passo 4.14) e então rode este script
-- inteiro no SQL Editor.
--
-- Idempotente (pode rodar de novo à vontade — sempre recria o mesmo job).
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove o agendamento anterior, se existir, antes de recriar (evita job
-- duplicado rodando duas vezes a cada execução).
select cron.unschedule(jobid) from cron.job where jobname = 'bsconta-rh-lembrete-ponto';

select cron.schedule(
  'bsconta-rh-lembrete-ponto',
  '*/5 * * * *', -- a cada 5 minutos, todos os dias — a própria Edge Function decide se é hora de lembrar alguém ou não.
  $$
  select net.http_post(
    url := 'https://zqhuhaqothpxusnaijog.supabase.co/functions/v1/send-push', -- AJUSTE AQUI se o projeto Supabase for outro
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'TROQUE-POR-O-MESMO-VALOR-DO-SECRET-CRON_SHARED_SECRET' -- AJUSTE AQUI
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Confirma que o job foi criado (deve devolver 1 linha).
select jobid, jobname, schedule, active from cron.job where jobname = 'bsconta-rh-lembrete-ponto';

-- Para acompanhar se as execuções estão funcionando (aparece um resultado
-- por execução do cron, com o status HTTP da chamada — 200 é sucesso):
--   select * from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'bsconta-rh-lembrete-ponto')
--   order by start_time desc limit 20;
--
-- Para desativar o lembrete automático sem apagar o histórico:
--   select cron.alter_job((select jobid from cron.job where jobname = 'bsconta-rh-lembrete-ponto'), active := false);
