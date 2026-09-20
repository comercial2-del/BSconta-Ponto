-- BSconta+ RH — Lembrete de ponto por push (funciona com a aba fechada)
-- =============================================================================
-- O lembrete antigo (js/ui.js, initLembretePonto) só dispara enquanto a aba
-- do navegador está aberta — um alerta visual/sonoro em memória, sem nenhum
-- backend. Para funcionar com a aba FECHADA, o único jeito real, sem
-- depender de nenhum serviço pago de terceiros, é a Web Push API padrão do
-- navegador: o navegador registra um Service Worker (js/sw.js) e uma
-- "inscrição" de push (endpoint + chaves), o servidor guarda essa inscrição
-- e manda notificações através dela quando for a hora — o navegador entrega
-- a notificação mesmo com a aba fechada, contanto que o dispositivo esteja
-- ligado e o navegador tenha permissão concedida.
--
-- Este script cria só a tabela onde o navegador guarda a própria inscrição
-- (rh.push_subscriptions) e a tabela de controle que evita mandar o mesmo
-- lembrete duas vezes no mesmo dia (rh.lembretes_ponto_enviados). O ENVIO em
-- si é feito pela Edge Function `send-push`
-- (supabase/functions/send-push/index.ts) — no modo "lote", chamado
-- periodicamente pelo pg_cron + pg_net — ver 17_pg_cron_push_reminders.sql e
-- o Passo 4.14 do SETUP-SUPABASE.md para os passos manuais (ativar
-- extensões, gerar chaves VAPID, configurar secrets).
--
-- Idempotente.
-- =============================================================================

create table if not exists rh.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_secret text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
comment on table rh.push_subscriptions is 'Uma linha por navegador/dispositivo inscrito para receber push (Web Push API). Um usuário pode ter várias (celular + notebook, por exemplo).';

alter table rh.push_subscriptions enable row level security;

drop policy if exists "self all - push_subscriptions" on rh.push_subscriptions;
create policy "self all - push_subscriptions" on rh.push_subscriptions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
-- De propósito, sem policy para RH_STAFF: a inscrição de push é um detalhe
-- técnico do navegador de cada pessoa — RH não tem necessidade legítima de
-- ler ou apagar a inscrição de outra pessoa, então a política acima
-- (só o próprio dono) é a única regra da tabela.

grant select, insert, update, delete on rh.push_subscriptions to authenticated;

-- Controle de "já mandei o lembrete de entrada/saída de hoje pra essa
-- pessoa" — só a Edge Function (service_role, ignora RLS) grava aqui. RLS
-- habilitado e SEM nenhuma policy para "authenticated" é a forma correta de
-- dizer "ninguém, além do service_role, acessa esta tabela".
create table if not exists rh.lembretes_ponto_enviados (
  colaborador_id uuid not null references rh.colaboradores(id) on delete cascade,
  data date not null,
  tipo text not null check (tipo in ('entrada', 'saida')),
  enviado_em timestamptz not null default now(),
  primary key (colaborador_id, data, tipo)
);
comment on table rh.lembretes_ponto_enviados is 'Evita mandar o mesmo lembrete de ponto duas vezes no mesmo dia — só a Edge Function send-push, modo lote (service_role) toca aqui.';

alter table rh.lembretes_ponto_enviados enable row level security;
-- Sem nenhuma policy: com RLS habilitado, ausência de policy = ninguém do
-- role "authenticated" lê ou grava nenhuma linha, mesmo tendo o grant de
-- tabela (herdado do "alter default privileges" do 01_schema_rh.sql) — e
-- por reforço/clareza, revoga esse grant herdado explicitamente aqui, para
-- este acesso ficar negado nas DUAS camadas (grant E policy), não só numa.
-- Só a Edge Function send-push, modo lote (service_role, que já tem grant
-- amplo no schema "rh" desde 01_schema_rh.sql, e ignora RLS) grava aqui.
revoke all on rh.lembretes_ponto_enviados from authenticated;
