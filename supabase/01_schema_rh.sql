-- =============================================================================
-- BSconta+ RH — schema dedicado dentro do banco único compartilhado
-- =============================================================================
-- Este projeto Supabase (zqhuhaqothpxusnaijog / "BSconta Marketing") já está
-- em produção com o sistema de Marketing/CRM (schema "public": deals,
-- activities, sales, sellers, stages, profiles, sync_logs, calendar_tokens).
--
-- Decisão de arquitetura (confirmada com o usuário em 18/09/2026): em vez de
-- criar um projeto Supabase novo e separado para o RH (plano antigo, ver
-- SETUP-SUPABASE.md — hoje superado), o RH passa a viver no MESMO projeto,
-- num schema Postgres próprio ("rh"), isolado do "public" do Marketing:
--   - Nenhuma tabela do Marketing é lida, alterada ou referenciada aqui.
--   - RLS liga cada linha ao colaborador (ou ao papel RH_ADMIN) dono dela.
--   - O grant de tabela é só para authenticated (login obrigatório) — não
--     para anon — então sem estar logado não se lê nem se escreve nada aqui.
--   - O schema "rh" precisa ser adicionado em Project Settings > Data API >
--     "Exposed schemas" para o supabase-js conseguir chamar
--     `.schema('rh').from(...)` (feito manualmente pelo painel, este script
--     não altera essa configuração).
--
-- Este script é seguro para rodar mais de uma vez (idempotente): tabelas via
-- IF NOT EXISTS, policies via DROP POLICY IF EXISTS + CREATE POLICY.
-- =============================================================================

create schema if not exists rh;

-- -----------------------------------------------------------------------------
-- Tabelas
-- -----------------------------------------------------------------------------

create table if not exists rh.colaboradores (
  id uuid primary key default gen_random_uuid(),
  codigo text unique,                          -- código interno (ex: cadastro atual em employee-registry.js)
  nome text not null,
  email text unique,
  cargo text,
  departamento text,
  admissao date,
  status text not null default 'ATIVO' check (status in ('ATIVO', 'AFASTADO', 'INATIVO')),
  foto_url text,
  horario_previsto text,                        -- ex: "08:00-17:00", usado no lembrete de ponto
  meta_diaria_horas numeric not null default 8,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table rh.colaboradores is 'Cadastro de colaboradores do RH — separado dos "sellers" do Marketing (public.sellers).';

-- Liga um usuário de login (auth.users, compartilhado entre TODOS os
-- sistemas do projeto) ao seu papel dentro do RH. Uma pessoa pode ter um
-- papel no Marketing (public.profiles) e outro aqui, são independentes.
create table if not exists rh.perfis (
  user_id uuid primary key references auth.users(id) on delete cascade,
  colaborador_id uuid references rh.colaboradores(id) on delete set null,
  role text not null default 'COLABORADOR' check (role in ('COLABORADOR', 'RH', 'RH_ADMIN')),
  created_at timestamptz not null default now()
);
comment on table rh.perfis is 'Papel de cada usuário dentro do RH — COLABORADOR (só os próprios dados), RH (opera o dia a dia de todo mundo) ou RH_ADMIN (o único que pode mexer em cargo/departamento/papel/status de usuários, em rh.perfis). auth.users é compartilhado com os demais sistemas do projeto — mesmo login, papel independente por sistema.';

create table if not exists rh.ponto_registros (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references rh.colaboradores(id) on delete cascade,
  data date not null,
  status text not null default 'futuro' check (status in ('completo', 'atraso', 'falta', 'hoje', 'futuro')),
  entrada time,
  saida time,
  intervalo_saida time,
  intervalo_volta time,
  horas_trabalhadas numeric,
  horas_extras numeric not null default 0,
  atraso_min integer not null default 0,
  local text check (local in ('PRESENCIAL', 'HOME_OFFICE')),
  geo jsonb,
  alterado_pelo_rh jsonb,                       -- {por, em, motivo} — preenchido quando o RH corrige o dia
  pendente_ajuste jsonb,                        -- {protocolo, campoLabel, horario, tipo} — enquanto aguarda RH
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (colaborador_id, data)
);
comment on table rh.ponto_registros is 'Um registro por colaborador por dia. pendente_ajuste/alterado_pelo_rh implementam o fluxo de ajuste de ponto.';

create table if not exists rh.solicitacoes (
  id uuid primary key default gen_random_uuid(),
  protocolo text not null unique,
  colaborador_id uuid not null references rh.colaboradores(id) on delete cascade,
  categoria text not null,                      -- 'Dúvidas' | 'Atualização cadastral' | 'Documentos' | 'Benefícios' | 'Ajuste de ponto' | 'Outros'
  descricao text not null,
  status text not null default 'PENDENTE' check (status in ('PENDENTE', 'EM_ANALISE', 'RESOLVIDA', 'RECUSADA')),
  prioridade text not null default 'normal' check (prioridade in ('baixa', 'normal', 'alta')),
  ajuste_ponto jsonb,                           -- {data, campo, campoLabel, horario, tipo} — só quando categoria = 'Ajuste de ponto'
  respostas jsonb not null default '[]'::jsonb, -- [{autor, texto, data}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table rh.solicitacoes is 'Fila única de solicitações do colaborador ao RH (inclui o fluxo de ajuste de ponto).';

create table if not exists rh.ferias_saldos (
  colaborador_id uuid primary key references rh.colaboradores(id) on delete cascade,
  periodo_aquisitivo_inicio date,
  periodo_aquisitivo_fim date,
  saldo_dias integer not null default 30,
  dias_usados integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists rh.ferias_solicitacoes (
  id uuid primary key default gen_random_uuid(),
  protocolo text not null unique,
  colaborador_id uuid not null references rh.colaboradores(id) on delete cascade,
  inicio date not null,
  fim date not null,
  dias integer not null,
  status text not null default 'PENDENTE' check (status in ('PENDENTE', 'EM_ANALISE', 'APROVADA', 'RECUSADA')),
  solicitado_em date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists rh.beneficios (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text,
  icon text,
  tone text,
  status text not null default 'ATIVO' check (status in ('ATIVO', 'PENDENTE', 'INATIVO')),
  atribuicao_tipo text not null default 'TODOS' check (atribuicao_tipo in ('TODOS', 'ESPECIFICO')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists rh.beneficios_colaboradores (
  beneficio_id uuid not null references rh.beneficios(id) on delete cascade,
  colaborador_id uuid not null references rh.colaboradores(id) on delete cascade,
  primary key (beneficio_id, colaborador_id)
);
comment on table rh.beneficios_colaboradores is 'Só usada quando rh.beneficios.atribuicao_tipo = ESPECIFICO.';

create table if not exists rh.documentos (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references rh.colaboradores(id) on delete cascade,
  tipo text not null,                           -- 'Holerite' | 'Atestado médico' | 'Comprovante de residência' | ...
  competencia text,
  status text not null default 'PENDENTE' check (status in ('PENDENTE', 'ENVIADO', 'AGUARDANDO_ASSINATURA', 'ASSINADO')),
  workflow text,
  origem text,
  arquivo_original_path text,                   -- caminho no Supabase Storage
  arquivo_assinado_path text,
  enviado_em timestamptz,
  assinado_em timestamptz,
  prazo date,
  metodo_assinatura text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists rh.comunicados (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  conteudo text,
  urgente boolean not null default false,
  publicado_em timestamptz not null default now()
);

create table if not exists rh.comunicados_leituras (
  comunicado_id uuid not null references rh.comunicados(id) on delete cascade,
  colaborador_id uuid not null references rh.colaboradores(id) on delete cascade,
  lido_em timestamptz not null default now(),
  primary key (comunicado_id, colaborador_id)
);

-- -----------------------------------------------------------------------------
-- Funções auxiliares para as policies (schema rh, não colidem com o Marketing)
-- -----------------------------------------------------------------------------

create or replace function rh.is_rh_admin()
returns boolean
language sql
security definer
set search_path = rh, pg_temp
stable
as $$
  select exists (
    select 1 from rh.perfis
    where user_id = auth.uid() and role = 'RH_ADMIN'
  );
$$;
comment on function rh.is_rh_admin() is 'true só para RH_ADMIN — usado apenas nas policies de rh.perfis (quem pode promover/rebaixar usuários).';

create or replace function rh.is_rh_staff()
returns boolean
language sql
security definer
set search_path = rh, pg_temp
stable
as $$
  select exists (
    select 1 from rh.perfis
    where user_id = auth.uid() and role in ('RH', 'RH_ADMIN')
  );
$$;
comment on function rh.is_rh_staff() is 'true para RH ou RH_ADMIN — usado nas policies das tabelas de dados do RH (colaboradores, ponto, solicitações, férias, benefícios, documentos, comunicados).';

create or replace function rh.colaborador_atual()
returns uuid
language sql
security definer
set search_path = rh, pg_temp
stable
as $$
  select colaborador_id from rh.perfis where user_id = auth.uid();
$$;
comment on function rh.colaborador_atual() is 'id do colaborador ligado ao usuário logado (null se for só RH_ADMIN sem cadastro de colaborador).';

-- -----------------------------------------------------------------------------
-- RLS — habilita em toda tabela do schema.
--   RH_ADMIN e RH (rh.is_rh_staff())  → acesso completo aos dados de todo
--     mundo (colaboradores, ponto, solicitações, férias, benefícios,
--     documentos, comunicados).
--   Só RH_ADMIN (rh.is_rh_admin())    → pode ler/alterar rh.perfis, ou seja,
--     só ele promove/rebaixa alguém a RH ou RH_ADMIN. RH não escala o
--     próprio acesso, nem o de ninguém.
--   Colaborador                        → só o que é dele.
-- -----------------------------------------------------------------------------

alter table rh.colaboradores enable row level security;
alter table rh.perfis enable row level security;
alter table rh.ponto_registros enable row level security;
alter table rh.solicitacoes enable row level security;
alter table rh.ferias_saldos enable row level security;
alter table rh.ferias_solicitacoes enable row level security;
alter table rh.beneficios enable row level security;
alter table rh.beneficios_colaboradores enable row level security;
alter table rh.documentos enable row level security;
alter table rh.comunicados enable row level security;
alter table rh.comunicados_leituras enable row level security;

-- colaboradores
drop policy if exists "rh_staff all - colaboradores" on rh.colaboradores;
create policy "rh_staff all - colaboradores" on rh.colaboradores for all using (rh.is_rh_staff()) with check (rh.is_rh_staff());
drop policy if exists "self select - colaboradores" on rh.colaboradores;
create policy "self select - colaboradores" on rh.colaboradores for select using (id = rh.colaborador_atual());

-- perfis (só RH_ADMIN gerencia papéis — nunca o próprio colaborador, nem o RH comum)
drop policy if exists "rh_admin all - perfis" on rh.perfis;
create policy "rh_admin all - perfis" on rh.perfis for all using (rh.is_rh_admin()) with check (rh.is_rh_admin());
drop policy if exists "self select - perfis" on rh.perfis;
create policy "self select - perfis" on rh.perfis for select using (user_id = auth.uid());

-- ponto_registros
drop policy if exists "rh_staff all - ponto" on rh.ponto_registros;
create policy "rh_staff all - ponto" on rh.ponto_registros for all using (rh.is_rh_staff()) with check (rh.is_rh_staff());
drop policy if exists "self select - ponto" on rh.ponto_registros;
create policy "self select - ponto" on rh.ponto_registros for select using (colaborador_id = rh.colaborador_atual());
-- colaborador bate o próprio ponto (insert/update do dia), mas nunca decide sozinho um ajuste retroativo
-- (isso é feito pelo RH via "rh_staff all" acima, a partir de rh.solicitacoes).
drop policy if exists "self upsert hoje - ponto" on rh.ponto_registros;
create policy "self upsert hoje - ponto" on rh.ponto_registros for insert with check (colaborador_id = rh.colaborador_atual() and data = current_date);
drop policy if exists "self update hoje - ponto" on rh.ponto_registros;
create policy "self update hoje - ponto" on rh.ponto_registros for update using (colaborador_id = rh.colaborador_atual() and data = current_date) with check (colaborador_id = rh.colaborador_atual() and data = current_date);

-- solicitacoes
drop policy if exists "rh_staff all - solicitacoes" on rh.solicitacoes;
create policy "rh_staff all - solicitacoes" on rh.solicitacoes for all using (rh.is_rh_staff()) with check (rh.is_rh_staff());
drop policy if exists "self select - solicitacoes" on rh.solicitacoes;
create policy "self select - solicitacoes" on rh.solicitacoes for select using (colaborador_id = rh.colaborador_atual());
drop policy if exists "self insert pendente - solicitacoes" on rh.solicitacoes;
create policy "self insert pendente - solicitacoes" on rh.solicitacoes for insert with check (colaborador_id = rh.colaborador_atual() and status = 'PENDENTE');

-- ferias
drop policy if exists "rh_staff all - ferias_saldos" on rh.ferias_saldos;
create policy "rh_staff all - ferias_saldos" on rh.ferias_saldos for all using (rh.is_rh_staff()) with check (rh.is_rh_staff());
drop policy if exists "self select - ferias_saldos" on rh.ferias_saldos;
create policy "self select - ferias_saldos" on rh.ferias_saldos for select using (colaborador_id = rh.colaborador_atual());

drop policy if exists "rh_staff all - ferias_solicitacoes" on rh.ferias_solicitacoes;
create policy "rh_staff all - ferias_solicitacoes" on rh.ferias_solicitacoes for all using (rh.is_rh_staff()) with check (rh.is_rh_staff());
drop policy if exists "self select - ferias_solicitacoes" on rh.ferias_solicitacoes;
create policy "self select - ferias_solicitacoes" on rh.ferias_solicitacoes for select using (colaborador_id = rh.colaborador_atual());
drop policy if exists "self insert pendente - ferias_solicitacoes" on rh.ferias_solicitacoes;
create policy "self insert pendente - ferias_solicitacoes" on rh.ferias_solicitacoes for insert with check (colaborador_id = rh.colaborador_atual() and status = 'PENDENTE');

-- beneficios (todo colaborador logado pode ler os "TODOS"; os "ESPECIFICO" checam a junção)
drop policy if exists "rh_staff all - beneficios" on rh.beneficios;
create policy "rh_staff all - beneficios" on rh.beneficios for all using (rh.is_rh_staff()) with check (rh.is_rh_staff());
drop policy if exists "select proprios beneficios" on rh.beneficios;
create policy "select proprios beneficios" on rh.beneficios for select using (
  atribuicao_tipo = 'TODOS'
  or exists (
    select 1 from rh.beneficios_colaboradores bc
    where bc.beneficio_id = beneficios.id and bc.colaborador_id = rh.colaborador_atual()
  )
);

drop policy if exists "rh_staff all - beneficios_colaboradores" on rh.beneficios_colaboradores;
create policy "rh_staff all - beneficios_colaboradores" on rh.beneficios_colaboradores for all using (rh.is_rh_staff()) with check (rh.is_rh_staff());
drop policy if exists "self select - beneficios_colaboradores" on rh.beneficios_colaboradores;
create policy "self select - beneficios_colaboradores" on rh.beneficios_colaboradores for select using (colaborador_id = rh.colaborador_atual());

-- documentos
drop policy if exists "rh_staff all - documentos" on rh.documentos;
create policy "rh_staff all - documentos" on rh.documentos for all using (rh.is_rh_staff()) with check (rh.is_rh_staff());
drop policy if exists "self select - documentos" on rh.documentos;
create policy "self select - documentos" on rh.documentos for select using (colaborador_id = rh.colaborador_atual());

-- comunicados (qualquer colaborador logado lê; só RH/RH_ADMIN escreve)
drop policy if exists "rh_staff all - comunicados" on rh.comunicados;
create policy "rh_staff all - comunicados" on rh.comunicados for all using (rh.is_rh_staff()) with check (rh.is_rh_staff());
drop policy if exists "logados leem - comunicados" on rh.comunicados;
create policy "logados leem - comunicados" on rh.comunicados for select using (auth.uid() is not null);

drop policy if exists "rh_staff all - comunicados_leituras" on rh.comunicados_leituras;
create policy "rh_staff all - comunicados_leituras" on rh.comunicados_leituras for all using (rh.is_rh_staff()) with check (rh.is_rh_staff());
drop policy if exists "self all - comunicados_leituras" on rh.comunicados_leituras;
create policy "self all - comunicados_leituras" on rh.comunicados_leituras for all using (colaborador_id = rh.colaborador_atual()) with check (colaborador_id = rh.colaborador_atual());

-- -----------------------------------------------------------------------------
-- Grants — só "authenticated" (login obrigatório); "anon" não recebe nada
-- aqui, então sem sessão não se lê nem se escreve nenhuma linha do RH.
-- -----------------------------------------------------------------------------

grant usage on schema rh to authenticated;
grant select, insert, update, delete on all tables in schema rh to authenticated;
grant execute on all functions in schema rh to authenticated;
alter default privileges in schema rh grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema rh grant execute on functions to authenticated;
