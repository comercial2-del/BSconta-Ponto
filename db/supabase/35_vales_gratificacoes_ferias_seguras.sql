-- =============================================================================
-- 35 — Vale-refeição, Vale-transporte (conta corrente), Gratificações
--      + aprovação/reabertura/exclusão de férias feitas DENTRO do banco
-- =============================================================================
-- Novas abas em rh/beneficios.html (js/rh-vales-data.js + js/rh-vales-ui.js):
--
--   rh.parametros        valores gerais editáveis pelo RH (ex.: VR por dia).
--   rh.vr_mensal         planilha do VR: 1 linha por colaborador por mês.
--   rh.vt_mensal         planilha do VT: 1 linha por colaborador por mês,
--                        com o saldo que sobrou no cartão (conta corrente).
--   rh.gratificacoes     valores brutos por colaborador e mês (várias por mês).
--   rh.colaboradores     ganha a configuração de VT de cada pessoa
--                        (modalidade, valor por dia, dias presenciais padrão).
--
-- Férias: rh.rh_resolver_ferias / rh_reabrir_ferias / rh_excluir_ferias
-- fazem status + saldo numa transação só, travando a linha (for update):
-- dois cliques simultâneos em "Aprovar" não descontam o saldo duas vezes, e
-- excluir férias APROVADAS devolve os dias ao saldo.
--
-- Só RH/RH_ADMIN (rh.is_rh_staff()) lê e grava tudo aqui. O colaborador
-- ainda não vê nada disso (fica para a próxima etapa).
-- Idempotente: pode rodar mais de uma vez. Não altera nenhum dado existente.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Parâmetros gerais
-- ---------------------------------------------------------------------------
create table if not exists rh.parametros (
  chave text primary key,
  valor numeric not null,
  descricao text,
  updated_at timestamptz not null default now(),
  updated_by_nome text
);
comment on table rh.parametros is 'Valores gerais editáveis pelo RH (ex.: vr_valor_dia).';

insert into rh.parametros (chave, valor, descricao)
values ('vr_valor_dia', 23.00, 'Valor do vale-refeição por dia útil (vale para todos)')
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------------
-- Configuração de VT no cadastro do colaborador
-- ---------------------------------------------------------------------------
alter table rh.colaboradores add column if not exists vt_modalidade text not null default 'PRESENCIAL';
alter table rh.colaboradores add column if not exists vt_valor_dia numeric not null default 0;
alter table rh.colaboradores add column if not exists vt_dias_padrao integer;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'colaboradores_vt_modalidade_check') then
    alter table rh.colaboradores add constraint colaboradores_vt_modalidade_check
      check (vt_modalidade in ('PRESENCIAL', 'HIBRIDO', 'HOME_OFFICE'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'colaboradores_vt_valor_dia_check') then
    alter table rh.colaboradores add constraint colaboradores_vt_valor_dia_check check (vt_valor_dia >= 0);
  end if;
end $$;
comment on column rh.colaboradores.vt_modalidade is 'PRESENCIAL | HIBRIDO | HOME_OFFICE — define a sugestão de dias presenciais do VT.';
comment on column rh.colaboradores.vt_valor_dia is 'Custo de VT por dia presencial (ida + volta).';
comment on column rh.colaboradores.vt_dias_padrao is 'Dias presenciais por mês (híbrido). Nulo = todos os dias úteis.';

-- ---------------------------------------------------------------------------
-- Planilha mensal do Vale-refeição
-- ---------------------------------------------------------------------------
create table if not exists rh.vr_mensal (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references rh.colaboradores(id) on delete cascade,
  competencia text not null check (competencia ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  dias_uteis integer not null default 0 check (dias_uteis >= 0),
  faltas integer not null default 0 check (faltas >= 0),
  ferias_dias integer not null default 0 check (ferias_dias >= 0),
  valor_dia numeric not null default 0 check (valor_dia >= 0),
  observacao text,
  fechado boolean not null default false,
  fechado_em timestamptz,
  fechado_por text,
  updated_at timestamptz not null default now(),
  unique (colaborador_id, competencia)
);
comment on table rh.vr_mensal is 'VR do mês: (dias_uteis − faltas − ferias_dias) × valor_dia. valor_dia é guardado na linha: mudar o parâmetro não altera meses fechados.';
create index if not exists idx_vr_mensal_comp on rh.vr_mensal (competencia);

-- ---------------------------------------------------------------------------
-- Planilha mensal do Vale-transporte (conta corrente)
-- ---------------------------------------------------------------------------
create table if not exists rh.vt_mensal (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references rh.colaboradores(id) on delete cascade,
  competencia text not null check (competencia ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  modalidade text not null default 'PRESENCIAL' check (modalidade in ('PRESENCIAL', 'HIBRIDO', 'HOME_OFFICE')),
  valor_dia numeric not null default 0 check (valor_dia >= 0),
  dias_presenciais integer not null default 0 check (dias_presenciais >= 0),
  saldo_cartao numeric not null default 0 check (saldo_cartao >= 0),
  valor_carregar numeric not null default 0 check (valor_carregar >= 0),
  observacao text,
  fechado boolean not null default false,
  fechado_em timestamptz,
  fechado_por text,
  updated_at timestamptz not null default now(),
  unique (colaborador_id, competencia)
);
comment on table rh.vt_mensal is 'VT do mês: necessidade = dias_presenciais × valor_dia; valor_carregar = max(0, necessidade − saldo_cartao). saldo_cartao = o que sobrou no cartão (conta corrente).';
create index if not exists idx_vt_mensal_comp on rh.vt_mensal (competencia);

-- ---------------------------------------------------------------------------
-- Gratificações (valor bruto)
-- ---------------------------------------------------------------------------
create table if not exists rh.gratificacoes (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references rh.colaboradores(id) on delete cascade,
  competencia text not null check (competencia ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  descricao text,
  valor_bruto numeric not null default 0 check (valor_bruto >= 0),
  lancado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table rh.gratificacoes is 'Gratificações brutas por colaborador e competência (pode haver várias no mesmo mês).';
create index if not exists idx_gratificacoes_comp on rh.gratificacoes (competencia);

-- ---------------------------------------------------------------------------
-- RLS: só RH/RH_ADMIN
-- ---------------------------------------------------------------------------
alter table rh.parametros enable row level security;
alter table rh.vr_mensal enable row level security;
alter table rh.vt_mensal enable row level security;
alter table rh.gratificacoes enable row level security;

drop policy if exists "rh_staff all - parametros" on rh.parametros;
create policy "rh_staff all - parametros" on rh.parametros for all using (rh.is_rh_staff()) with check (rh.is_rh_staff());
drop policy if exists "rh_staff all - vr_mensal" on rh.vr_mensal;
create policy "rh_staff all - vr_mensal" on rh.vr_mensal for all using (rh.is_rh_staff()) with check (rh.is_rh_staff());
drop policy if exists "rh_staff all - vt_mensal" on rh.vt_mensal;
create policy "rh_staff all - vt_mensal" on rh.vt_mensal for all using (rh.is_rh_staff()) with check (rh.is_rh_staff());
drop policy if exists "rh_staff all - gratificacoes" on rh.gratificacoes;
create policy "rh_staff all - gratificacoes" on rh.gratificacoes for all using (rh.is_rh_staff()) with check (rh.is_rh_staff());

grant select, insert, update, delete on rh.parametros, rh.vr_mensal, rh.vt_mensal, rh.gratificacoes to authenticated;
grant all on rh.parametros, rh.vr_mensal, rh.vt_mensal, rh.gratificacoes to service_role;

-- ---------------------------------------------------------------------------
-- Férias: aprovar / recusar / reabrir / excluir numa transação só
-- ---------------------------------------------------------------------------
create or replace function rh.rh_resolver_ferias(p_id uuid, p_aprovado boolean)
returns text
language plpgsql
security definer
set search_path = rh, pg_temp
as $$
declare
  v_sol rh.ferias_solicitacoes%rowtype;
  v_saldo rh.ferias_saldos%rowtype;
begin
  if not rh.is_rh_staff() then raise exception 'Apenas o RH pode aprovar ou recusar férias.'; end if;

  select * into v_sol from rh.ferias_solicitacoes where id = p_id for update;
  if not found then raise exception 'Solicitação de férias não encontrada.'; end if;
  if v_sol.status not in ('PENDENTE', 'EM_ANALISE', 'PRE_APROVADA') then
    raise exception 'Esta solicitação já foi % — atualize a tela.', lower(v_sol.status);
  end if;

  if p_aprovado then
    select * into v_saldo from rh.ferias_saldos where colaborador_id = v_sol.colaborador_id for update;
    if not found then
      insert into rh.ferias_saldos (colaborador_id, saldo_dias, dias_usados)
      values (v_sol.colaborador_id, 30, 0)
      returning * into v_saldo;
    end if;
    if v_sol.dias > v_saldo.saldo_dias then
      raise exception 'Este colaborador só tem % dia(s) de saldo — não é possível aprovar % dia(s). Ajuste o saldo antes de aprovar.', v_saldo.saldo_dias, v_sol.dias;
    end if;
    update rh.ferias_saldos
       set saldo_dias = saldo_dias - v_sol.dias,
           dias_usados = coalesce(dias_usados, 0) + v_sol.dias,
           updated_at = now()
     where colaborador_id = v_sol.colaborador_id;
  end if;

  update rh.ferias_solicitacoes set status = case when p_aprovado then 'APROVADA' else 'RECUSADA' end where id = p_id;
  return case when p_aprovado then 'APROVADA' else 'RECUSADA' end;
end;
$$;

create or replace function rh.rh_reabrir_ferias(p_id uuid)
returns text
language plpgsql
security definer
set search_path = rh, pg_temp
as $$
declare
  v_sol rh.ferias_solicitacoes%rowtype;
begin
  if not rh.is_rh_staff() then raise exception 'Apenas o RH pode reabrir férias.'; end if;
  select * into v_sol from rh.ferias_solicitacoes where id = p_id for update;
  if not found then raise exception 'Solicitação de férias não encontrada.'; end if;
  if v_sol.status not in ('APROVADA', 'RECUSADA') then
    raise exception 'Esta solicitação não está aprovada nem recusada — atualize a tela.';
  end if;
  if v_sol.status = 'APROVADA' then
    update rh.ferias_saldos
       set saldo_dias = saldo_dias + v_sol.dias,
           dias_usados = greatest(0, coalesce(dias_usados, 0) - v_sol.dias),
           updated_at = now()
     where colaborador_id = v_sol.colaborador_id;
  end if;
  update rh.ferias_solicitacoes set status = 'PENDENTE' where id = p_id;
  return 'PENDENTE';
end;
$$;

create or replace function rh.rh_excluir_ferias(p_id uuid)
returns integer
language plpgsql
security definer
set search_path = rh, pg_temp
as $$
declare
  v_sol rh.ferias_solicitacoes%rowtype;
  v_devolvidos integer := 0;
begin
  if not rh.is_rh_staff() then raise exception 'Apenas o RH pode excluir férias.'; end if;
  select * into v_sol from rh.ferias_solicitacoes where id = p_id for update;
  if not found then raise exception 'Solicitação de férias não encontrada.'; end if;
  if v_sol.status = 'APROVADA' then
    update rh.ferias_saldos
       set saldo_dias = saldo_dias + v_sol.dias,
           dias_usados = greatest(0, coalesce(dias_usados, 0) - v_sol.dias),
           updated_at = now()
     where colaborador_id = v_sol.colaborador_id;
    if found then v_devolvidos := v_sol.dias; end if;
  end if;
  delete from rh.ferias_solicitacoes where id = p_id;
  return v_devolvidos;
end;
$$;

revoke all on function rh.rh_resolver_ferias(uuid, boolean) from public, anon;
revoke all on function rh.rh_reabrir_ferias(uuid) from public, anon;
revoke all on function rh.rh_excluir_ferias(uuid) from public, anon;
grant execute on function rh.rh_resolver_ferias(uuid, boolean) to authenticated;
grant execute on function rh.rh_reabrir_ferias(uuid) to authenticated;
grant execute on function rh.rh_excluir_ferias(uuid) to authenticated;

notify pgrst, 'reload schema';
