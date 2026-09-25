-- =============================================================================
-- 26 — Benefícios unificados: valor por BENEFÍCIO + COLABORADOR + COMPETÊNCIA
-- =============================================================================
-- O que muda:
--   * rh.beneficios ganha "categoria" (tipo do benefício). Continua sendo o
--     catálogo (nome, ícone, cor, status, TODOS/ESPECIFICO). Sem data de
--     término: fica ativo até o RH desativar.
--   * rh.beneficio_valores_fixos: valor fixo mensal de cada colaborador em
--     cada benefício. Preenche automaticamente o mês atual e os próximos.
--   * rh.beneficio_competencias: o valor de um colaborador em UM mês
--     (competência aaaa-mm), com desconto e se já foi lançado/pago.
--     Recebido = valor − desconto quando lancado = true. Cada mês é uma linha
--     própria: o histórico dos meses anteriores nunca é apagado/sobrescrito.
--   * Colaborador só LÊ as próprias linhas. RH/RH_ADMIN faz tudo.
--   * Migra os registros antigos de rh.colaborador_beneficios (tela "Registrar
--     para colaborador") para a estrutura nova, sem apagar a tabela antiga
--     (ela continua sendo usada pela História do colaborador).
-- Idempotente: pode rodar mais de uma vez.
-- =============================================================================

alter table rh.beneficios add column if not exists categoria text not null default 'OUTROS';
comment on column rh.beneficios.categoria is 'Tipo do benefício: ALIMENTACAO | TRANSPORTE | SAUDE | EDUCACAO | HOME_OFFICE | OUTROS.';

create table if not exists rh.beneficio_valores_fixos (
  beneficio_id uuid not null references rh.beneficios(id) on delete cascade,
  colaborador_id uuid not null references rh.colaboradores(id) on delete cascade,
  valor numeric not null check (valor >= 0),
  updated_at timestamptz not null default now(),
  primary key (beneficio_id, colaborador_id)
);
comment on table rh.beneficio_valores_fixos is 'Valor fixo mensal de um colaborador em um benefício — sugere/preenche o valor do mês atual e dos próximos.';

create table if not exists rh.beneficio_competencias (
  id uuid primary key default gen_random_uuid(),
  beneficio_id uuid not null references rh.beneficios(id) on delete cascade,
  colaborador_id uuid not null references rh.colaboradores(id) on delete cascade,
  competencia text not null check (competencia ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  valor numeric not null default 0 check (valor >= 0),
  desconto numeric not null default 0 check (desconto >= 0),
  lancado boolean not null default false,
  lancado_em timestamptz,
  observacao text,
  responsavel_id uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (beneficio_id, colaborador_id, competencia),
  check (desconto <= valor)
);
comment on table rh.beneficio_competencias is 'Valor de um benefício para um colaborador em uma competência (aaaa-mm). Recebido = valor − desconto quando lancado. Uma linha por mês = histórico preservado.';
create index if not exists idx_benef_comp_colab on rh.beneficio_competencias (colaborador_id, competencia);
create index if not exists idx_benef_comp_benef on rh.beneficio_competencias (beneficio_id, competencia);

alter table rh.beneficio_valores_fixos enable row level security;
alter table rh.beneficio_competencias enable row level security;

drop policy if exists "rh_staff all - beneficio_valores_fixos" on rh.beneficio_valores_fixos;
create policy "rh_staff all - beneficio_valores_fixos" on rh.beneficio_valores_fixos for all using (rh.is_rh_staff()) with check (rh.is_rh_staff());
drop policy if exists "self select - beneficio_valores_fixos" on rh.beneficio_valores_fixos;
create policy "self select - beneficio_valores_fixos" on rh.beneficio_valores_fixos for select using (colaborador_id = rh.colaborador_atual());

drop policy if exists "rh_staff all - beneficio_competencias" on rh.beneficio_competencias;
create policy "rh_staff all - beneficio_competencias" on rh.beneficio_competencias for all using (rh.is_rh_staff()) with check (rh.is_rh_staff());
drop policy if exists "self select - beneficio_competencias" on rh.beneficio_competencias;
create policy "self select - beneficio_competencias" on rh.beneficio_competencias for select using (colaborador_id = rh.colaborador_atual());

grant select, insert, update, delete on rh.beneficio_valores_fixos, rh.beneficio_competencias to authenticated;
grant all on rh.beneficio_valores_fixos, rh.beneficio_competencias to service_role;

-- -----------------------------------------------------------------------------
-- Migração dos registros antigos (rh.colaborador_beneficios)
-- -----------------------------------------------------------------------------
do $$
declare
  r record;
  v_beneficio uuid;
  v_comp text;
  v_hoje text := to_char(current_date, 'YYYY-MM');
begin
  for r in
    select * from rh.colaborador_beneficios where status <> 'ENCERRADO'
  loop
    -- 1) acha ou cria o benefício no catálogo (pelo vínculo ou pelo nome)
    v_beneficio := r.beneficio_id;
    if v_beneficio is null then
      select id into v_beneficio from rh.beneficios where lower(trim(nome)) = lower(trim(r.beneficio)) limit 1;
    end if;
    if v_beneficio is null then
      insert into rh.beneficios (nome, descricao, icon, tone, status, atribuicao_tipo, categoria)
      values (r.beneficio, r.descricao, 'heart', 'indigo', 'ATIVO', 'ESPECIFICO',
              case when r.beneficio ilike '%aliment%' or r.beneficio ilike '%refei%' then 'ALIMENTACAO'
                   when r.beneficio ilike '%transp%' then 'TRANSPORTE'
                   when r.beneficio ilike '%saúde%' or r.beneficio ilike '%saude%' or r.beneficio ilike '%odonto%' then 'SAUDE'
                   else 'OUTROS' end)
      returning id into v_beneficio;
    end if;

    -- 2) garante que o colaborador está no público do benefício
    if exists (select 1 from rh.beneficios where id = v_beneficio and atribuicao_tipo = 'ESPECIFICO') then
      insert into rh.beneficios_colaboradores (beneficio_id, colaborador_id)
      values (v_beneficio, r.colaborador_id) on conflict do nothing;
    end if;

    -- 3) valor fixo mensal (só para periodicidade mensal e ativo)
    if r.valor is not null and r.periodicidade = 'MENSAL' and r.status = 'ATIVO' then
      insert into rh.beneficio_valores_fixos (beneficio_id, colaborador_id, valor)
      values (v_beneficio, r.colaborador_id, r.valor) on conflict (beneficio_id, colaborador_id) do nothing;
    end if;

    -- 4) competência do mês de início (com o desconto informado)
    if r.valor is not null then
      v_comp := to_char(r.data_inicio, 'YYYY-MM');
      insert into rh.beneficio_competencias (beneficio_id, colaborador_id, competencia, valor, desconto, lancado, lancado_em, observacao)
      values (v_beneficio, r.colaborador_id, v_comp, r.valor,
              least(coalesce(case when r.possui_desconto then r.valor_desconto end, 0), r.valor),
              v_comp <= v_hoje, case when v_comp <= v_hoje then now() end,
              'Migrado de "Benefícios por colaborador"')
      on conflict (beneficio_id, colaborador_id, competencia) do nothing;
    end if;

    -- mantém o vínculo na tabela antiga (a História continua funcionando)
    update rh.colaborador_beneficios set beneficio_id = v_beneficio where id = r.id and beneficio_id is null;
  end loop;
end $$;

notify pgrst, 'reload schema';
