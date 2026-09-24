-- =============================================================================
-- 22 — História do colaborador, benefícios individuais, abonos, notificações,
--      auditoria, pré-aprovação de férias, arquivamento de solicitações e
--      regras de intervalo (almoço) do ponto.
-- =============================================================================
-- 100% ADITIVO E IDEMPOTENTE:
--   - Só CRIA tabelas/colunas/funções/policies novas (IF NOT EXISTS / OR REPLACE).
--   - NÃO apaga nenhuma tabela, coluna ou linha. NÃO altera nenhum valor já
--     gravado. Nenhum UPDATE em massa em dados existentes.
--   - As duas únicas mudanças em estruturas existentes são AMPLIAÇÕES:
--       * rh.ferias_solicitacoes.status passa a aceitar também 'PRE_APROVADA'
--         (todos os valores antigos continuam válidos).
--       * colunas novas, com default, em rh.solicitacoes e
--         rh.ferias_solicitacoes (arquivado / arquivado_em / arquivado_por /
--         pre_aprovada_em / pre_aprovada_por). Linhas antigas ficam com
--         arquivado = false, ou seja, continuam aparecendo exatamente como hoje.
--   - Pode ser rodado mais de uma vez sem duplicar nada.
--
-- Como rodar: Supabase → SQL Editor → New query → colar → Run.
-- Pré-requisitos: scripts 01 a 21 (e o script do salário cifrado) já
-- aplicados — é o estado atual de produção.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 0. Helpers
-- -----------------------------------------------------------------------------

-- Nome de quem está logado (para "responsável" / auditoria), sem depender do
-- front-end mandar esse dado.
create or replace function rh.usuario_nome_atual()
returns text
language sql
security definer
set search_path = rh, pg_temp
stable
as $$
  select coalesce(
    (select coalesce(c.nome, p.nome, p.email) from rh.perfis p left join rh.colaboradores c on c.id = p.colaborador_id where p.user_id = auth.uid()),
    case when auth.uid() is null then 'Sistema' else 'Usuário' end
  );
$$;

-- Decifra um valor numérico cifrado com a mesma chave usada pelos dados
-- pessoais/salário (Vault: bsconta_rh_pii_key). Nunca lança erro: se a chave não
-- estiver disponível ou o conteúdo não for decifrável, devolve null — assim
-- nenhum fluxo existente (ex.: salvar salário) quebra por causa desta função.
create or replace function rh.decifrar_numero(p_valor bytea)
returns numeric
language plpgsql
security definer
set search_path = rh, public, extensions, pg_temp
stable
as $$
declare
  -- mesma chave usada por rh.rh_definir_salario_colaborador / colaboradores_dados_pessoais
  -- (Supabase Vault); app.settings.pii_key fica só como alternativa.
  v_key text := coalesce(
    (select decrypted_secret from vault.decrypted_secrets where name = 'bsconta_rh_pii_key'),
    current_setting('app.settings.pii_key', true)
  );
begin
  if p_valor is null or v_key is null or v_key = '' then
    return null;
  end if;
  return nullif(pgp_sym_decrypt(p_valor, v_key), '')::numeric;
exception when others then
  return null;
end;
$$;
revoke all on function rh.decifrar_numero(bytea) from public, anon, authenticated;

create or replace function rh.cifrar_numero(p_valor numeric)
returns bytea
language plpgsql
security definer
set search_path = rh, public, extensions, pg_temp
stable
as $$
declare
  -- mesma chave usada por rh.rh_definir_salario_colaborador / colaboradores_dados_pessoais
  -- (Supabase Vault); app.settings.pii_key fica só como alternativa.
  v_key text := coalesce(
    (select decrypted_secret from vault.decrypted_secrets where name = 'bsconta_rh_pii_key'),
    current_setting('app.settings.pii_key', true)
  );
begin
  if p_valor is null or v_key is null or v_key = '' then
    return null;
  end if;
  return pgp_sym_encrypt(p_valor::text, v_key);
end;
$$;
revoke all on function rh.cifrar_numero(numeric) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 1. Auditoria (histórico de alterações) — só leitura para o RH; só triggers
--    escrevem. Sem FK para nada: o registro de auditoria sobrevive mesmo se a
--    linha auditada for excluída depois (funciona também como "backup" do
--    que foi apagado).
-- -----------------------------------------------------------------------------
create table if not exists rh.auditoria (
  id bigserial primary key,
  tabela text not null,
  registro_id text,
  colaborador_id uuid,
  acao text not null check (acao in ('INSERT', 'UPDATE', 'DELETE')),
  dados_anteriores jsonb,
  dados_novos jsonb,
  usuario_id uuid default auth.uid(),
  usuario_nome text,
  created_at timestamptz not null default now()
);
comment on table rh.auditoria is 'Trilha de auditoria (quem, quando, antes/depois) das alterações relevantes feitas no RH. Preenchida só por trigger (rh.auditar_alteracao). Colunas cifradas (*_enc) nunca são gravadas aqui — aparecem só como "alterado".';
create index if not exists idx_auditoria_colaborador on rh.auditoria (colaborador_id, created_at desc);
create index if not exists idx_auditoria_tabela on rh.auditoria (tabela, created_at desc);

alter table rh.auditoria enable row level security;
drop policy if exists "rh_staff select - auditoria" on rh.auditoria;
create policy "rh_staff select - auditoria" on rh.auditoria for select using (rh.is_rh_staff());
revoke insert, update, delete on rh.auditoria from authenticated;

create or replace function rh.auditar_alteracao()
returns trigger
language plpgsql
security definer
set search_path = rh, pg_temp
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  v_ant jsonb := '{}'::jsonb;
  v_nov jsonb := '{}'::jsonb;
  v_key text;
  v_ignorar text[] := array['updated_at', 'created_at'];
  v_so_staff boolean := coalesce(tg_argv[0], '') = 'so_staff';
  v_colab uuid;
begin
  -- Ex.: ponto_registros — as batidas do próprio colaborador não precisam
  -- de auditoria (já são o próprio registro); só as correções do RH.
  if v_so_staff and not rh.is_rh_staff() then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key = any(v_ignorar) then continue; end if;
      if (v_old -> v_key) is distinct from (v_new -> v_key) then
        if v_key like '%\_enc' escape '\' then
          -- a cifra muda a cada gravação mesmo com o mesmo valor: se der
          -- para decifrar e o valor for igual, não é uma alteração de verdade
          if rh.decifrar_numero(nullif(v_old ->> v_key, '')::bytea) is not null
             and rh.decifrar_numero(nullif(v_old ->> v_key, '')::bytea) = rh.decifrar_numero(nullif(v_new ->> v_key, '')::bytea) then
            continue;
          end if;
          v_ant := v_ant || jsonb_build_object(v_key, '(cifrado)');
          v_nov := v_nov || jsonb_build_object(v_key, '(cifrado — alterado)');
        else
          v_ant := v_ant || jsonb_build_object(v_key, v_old -> v_key);
          v_nov := v_nov || jsonb_build_object(v_key, v_new -> v_key);
        end if;
      end if;
    end loop;
    if v_nov = '{}'::jsonb then
      return new; -- nada mudou de fato
    end if;
  elsif tg_op = 'INSERT' then
    -- nunca grava bytes cifrados na auditoria
    v_nov := v_new - array(select k from jsonb_object_keys(v_new) k where k like '%\_enc' escape '\');
  else
    v_ant := v_old - array(select k from jsonb_object_keys(v_old) k where k like '%\_enc' escape '\');
  end if;

  v_colab := coalesce(
    nullif(coalesce(v_new, v_old) ->> 'colaborador_id', '')::uuid,
    case when tg_table_name = 'colaboradores' then nullif(coalesce(v_new, v_old) ->> 'id', '')::uuid end
  );

  insert into rh.auditoria (tabela, registro_id, colaborador_id, acao, dados_anteriores, dados_novos, usuario_id, usuario_nome)
  values (tg_table_name, coalesce(v_new, v_old) ->> 'id', v_colab, tg_op, nullif(v_ant, '{}'::jsonb), nullif(v_nov, '{}'::jsonb), auth.uid(), rh.usuario_nome_atual());

  return coalesce(new, old);
exception when others then
  -- Auditoria NUNCA pode impedir a operação original de acontecer.
  raise warning 'rh.auditar_alteracao falhou em %: %', tg_table_name, sqlerrm;
  return coalesce(new, old);
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Configuração das regras de ponto (intervalo/almoço) — linha única
-- -----------------------------------------------------------------------------
create table if not exists rh.configuracoes_ponto (
  id smallint primary key default 1 check (id = 1),
  intervalo_minimo_min integer not null default 60 check (intervalo_minimo_min between 0 and 600),
  almoco_inicio_minimo time,                    -- null = sem restrição de horário para iniciar o intervalo
  controle_ponto_inicio date,                   -- a partir de quando dias SEM registro contam como falta nos relatórios (null = primeiro registro existente)
  updated_at timestamptz not null default now(),
  updated_by_nome text
);
comment on table rh.configuracoes_ponto is 'Regras globais do ponto controladas pelo RH/Admin: intervalo mínimo (padrão 60 min) e horário mínimo para iniciar o almoço (opcional).';
insert into rh.configuracoes_ponto (id) values (1) on conflict (id) do nothing;

alter table rh.configuracoes_ponto enable row level security;
drop policy if exists "logados leem - configuracoes_ponto" on rh.configuracoes_ponto;
create policy "logados leem - configuracoes_ponto" on rh.configuracoes_ponto for select using (auth.uid() is not null);
drop policy if exists "rh_staff update - configuracoes_ponto" on rh.configuracoes_ponto;
create policy "rh_staff update - configuracoes_ponto" on rh.configuracoes_ponto for update using (rh.is_rh_staff()) with check (rh.is_rh_staff());

-- Regra aplicada NO BANCO (não dá para burlar pelo front-end): vale para o
-- colaborador batendo o próprio ponto. Correções do RH (rh.is_rh_staff()) e
-- rotinas de sistema (sem auth.uid(), ex.: SQL Editor/service_role) não são
-- bloqueadas, para não travar ajustes de jornadas já existentes.
-- Só valida o campo que ESTÁ SENDO ALTERADO nesta batida — registros antigos
-- nunca são reavaliados.
create or replace function rh.ponto_validar_intervalo()
returns trigger
language plpgsql
security definer
set search_path = rh, pg_temp
as $$
declare
  cfg rh.configuracoes_ponto;
  v_saida_mudou boolean;
  v_volta_mudou boolean;
begin
  if auth.uid() is null or rh.is_rh_staff() then
    return new;
  end if;
  select * into cfg from rh.configuracoes_ponto where id = 1;
  if not found then
    return new;
  end if;

  v_saida_mudou := new.intervalo_saida is not null and (tg_op = 'INSERT' or new.intervalo_saida is distinct from old.intervalo_saida);
  v_volta_mudou := new.intervalo_volta is not null and (tg_op = 'INSERT' or new.intervalo_volta is distinct from old.intervalo_volta);

  if v_saida_mudou and cfg.almoco_inicio_minimo is not null and new.intervalo_saida < cfg.almoco_inicio_minimo then
    raise exception 'O intervalo não pode começar antes das %.', to_char(date '2000-01-01' + cfg.almoco_inicio_minimo, 'HH24:MI')
      using errcode = 'P0001', hint = 'regra_almoco_inicio';
  end if;

  if v_volta_mudou and new.intervalo_saida is not null and cfg.intervalo_minimo_min > 0
     and (new.intervalo_volta - new.intervalo_saida) < make_interval(mins => cfg.intervalo_minimo_min) then
    raise exception 'O intervalo mínimo é de % minutos. Retorno permitido a partir das %.',
      cfg.intervalo_minimo_min, to_char(date '2000-01-01' + new.intervalo_saida + make_interval(mins => cfg.intervalo_minimo_min), 'HH24:MI')
      using errcode = 'P0001', hint = 'regra_intervalo_minimo';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ponto_validar_intervalo on rh.ponto_registros;
create trigger trg_ponto_validar_intervalo
  before insert or update of intervalo_saida, intervalo_volta on rh.ponto_registros
  for each row execute function rh.ponto_validar_intervalo();

-- -----------------------------------------------------------------------------
-- 3. História do colaborador (linha do tempo profissional)
-- -----------------------------------------------------------------------------
create table if not exists rh.colaborador_historico (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references rh.colaboradores(id) on delete cascade,
  tipo_evento text not null check (tipo_evento in (
    'ENTRADA', 'ALTERACAO_CARGO', 'PROMOCAO', 'ALTERACAO_DEPARTAMENTO', 'ALTERACAO_SALARIAL',
    'BONIFICACAO', 'BENEFICIO_CONCEDIDO', 'ALTERACAO_BENEFICIO', 'ADVERTENCIA', 'FERIAS',
    'ALTERACAO_VINCULO', 'ABONO', 'OUTRO'
  )),
  data_evento date not null,
  cargo text,
  departamento text,
  salario_enc bytea,                            -- cifrado (mesma chave do salário atual)
  salario_anterior_enc bytea,                   -- cifrado — para "Antes/Depois" em alterações salariais
  beneficio text,
  valor numeric,
  descricao text,
  observacao text,
  dados_anteriores jsonb,                       -- ex.: {"cargo": "Assistente", "departamento": "Contábil"}
  origem text not null default 'MANUAL' check (origem in ('MANUAL', 'AUTOMATICO')),
  visivel_colaborador boolean not null default true,
  arquivado boolean not null default false,     -- "remover" um evento = arquivar; nunca excluir
  responsavel_id uuid default auth.uid(),
  responsavel_nome text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table rh.colaborador_historico is 'Linha do tempo profissional do colaborador (promoções, cargo, departamento, salário, bonificações, benefícios, advertências, etc.). Salário sempre cifrado. Eventos nunca são excluídos — só arquivados.';
create index if not exists idx_colab_historico_colab on rh.colaborador_historico (colaborador_id, data_evento);

alter table rh.colaborador_historico enable row level security;
drop policy if exists "rh_staff all - colaborador_historico" on rh.colaborador_historico;
create policy "rh_staff all - colaborador_historico" on rh.colaborador_historico for all using (rh.is_rh_staff()) with check (rh.is_rh_staff());
drop policy if exists "self select - colaborador_historico" on rh.colaborador_historico;
create policy "self select - colaborador_historico" on rh.colaborador_historico for select
  using (colaborador_id = rh.colaborador_atual() and visivel_colaborador and not arquivado);

-- Lista a história JÁ com o salário decifrado — RH vê de qualquer
-- colaborador; o colaborador só a própria (e só eventos visíveis a ele).
create or replace function rh.historico_listar(p_colaborador_id uuid)
returns table (
  id uuid, colaborador_id uuid, tipo_evento text, data_evento date, cargo text, departamento text,
  salario numeric, salario_anterior numeric, beneficio text, valor numeric, descricao text, observacao text,
  dados_anteriores jsonb, origem text, visivel_colaborador boolean, arquivado boolean,
  responsavel_nome text, created_at timestamptz
)
language plpgsql
security definer
set search_path = rh, pg_temp
stable
as $$
declare
  v_rh boolean := rh.is_rh_staff();
begin
  if not v_rh and p_colaborador_id is distinct from rh.colaborador_atual() then
    raise exception 'Sem permissão para ver a história deste colaborador.';
  end if;
  return query
    select h.id, h.colaborador_id, h.tipo_evento, h.data_evento, h.cargo, h.departamento,
           rh.decifrar_numero(h.salario_enc), rh.decifrar_numero(h.salario_anterior_enc),
           h.beneficio, h.valor, h.descricao, h.observacao, h.dados_anteriores, h.origem,
           h.visivel_colaborador, h.arquivado, h.responsavel_nome, h.created_at
    from rh.colaborador_historico h
    where h.colaborador_id = p_colaborador_id
      and (v_rh or (h.visivel_colaborador and not h.arquivado))
    order by h.data_evento, h.created_at;
end;
$$;

-- RH registra um evento na linha do tempo. Se p_aplicar_cadastro = true,
-- também atualiza o cadastro ATUAL do colaborador (cargo/departamento/
-- salário) — sem gerar um segundo evento automático duplicado.
create or replace function rh.historico_registrar(
  p_colaborador_id uuid,
  p_tipo_evento text,
  p_data_evento date,
  p_cargo text default null,
  p_departamento text default null,
  p_salario numeric default null,
  p_beneficio text default null,
  p_valor numeric default null,
  p_descricao text default null,
  p_observacao text default null,
  p_visivel_colaborador boolean default true,
  p_aplicar_cadastro boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = rh, public, extensions, pg_temp
as $$
declare
  v_id uuid;
  v_atual rh.colaboradores;
  v_sal_ant numeric;
begin
  if not rh.is_rh_staff() then
    raise exception 'Somente o RH pode registrar eventos na história do colaborador.';
  end if;
  select * into v_atual from rh.colaboradores where id = p_colaborador_id;
  if not found then
    raise exception 'Colaborador não encontrado.';
  end if;

  v_sal_ant := rh.decifrar_numero(nullif(to_jsonb(v_atual) ->> 'salario_enc', '')::bytea);

  insert into rh.colaborador_historico (
    colaborador_id, tipo_evento, data_evento, cargo, departamento, salario_enc, salario_anterior_enc,
    beneficio, valor, descricao, observacao, dados_anteriores, origem, visivel_colaborador, responsavel_nome
  ) values (
    p_colaborador_id, p_tipo_evento, coalesce(p_data_evento, current_date), nullif(p_cargo, ''), nullif(p_departamento, ''),
    rh.cifrar_numero(p_salario), case when p_salario is not null then rh.cifrar_numero(v_sal_ant) end,
    nullif(p_beneficio, ''), p_valor, nullif(p_descricao, ''), nullif(p_observacao, ''),
    jsonb_strip_nulls(jsonb_build_object('cargo', v_atual.cargo, 'departamento', v_atual.departamento)),
    'MANUAL', coalesce(p_visivel_colaborador, true), rh.usuario_nome_atual()
  ) returning id into v_id;

  if p_aplicar_cadastro then
    perform set_config('rh.historico_manual', '1', true);
    update rh.colaboradores
       set cargo = coalesce(nullif(p_cargo, ''), cargo),
           departamento = coalesce(nullif(p_departamento, ''), departamento)
     where id = p_colaborador_id;
    if p_salario is not null then
      -- reutiliza a MESMA função de salário usada pela tela de colaboradores
      execute 'select rh.rh_definir_salario_colaborador($1, $2)' using p_colaborador_id, p_salario;
    end if;
    perform set_config('rh.historico_manual', '0', true);
  end if;

  return v_id;
end;
$$;

-- Evento automático quando o RH altera cargo/departamento/status/salário
-- direto no cadastro (rh/colaboradores.html) — garante que a linha do tempo
-- nunca "perca" uma mudança, mesmo feita fora da tela de História.
create or replace function rh.colaboradores_historico_automatico()
returns trigger
language plpgsql
security definer
set search_path = rh, pg_temp
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_sal_old numeric;
  v_sal_new numeric;
  v_cargo_mudou boolean := new.cargo is distinct from old.cargo;
  v_depto_mudou boolean := new.departamento is distinct from old.departamento;
begin
  if coalesce(current_setting('rh.historico_manual', true), '0') = '1' then
    return new;
  end if;

  if v_cargo_mudou or v_depto_mudou then
    insert into rh.colaborador_historico (colaborador_id, tipo_evento, data_evento, cargo, departamento, descricao, dados_anteriores, origem, responsavel_nome)
    values (
      new.id,
      case when v_cargo_mudou then 'ALTERACAO_CARGO' else 'ALTERACAO_DEPARTAMENTO' end,
      current_date, new.cargo, new.departamento,
      concat_ws(' · ',
        case when v_cargo_mudou then format('Cargo: %s → %s', coalesce(old.cargo, '—'), coalesce(new.cargo, '—')) end,
        case when v_depto_mudou then format('Departamento: %s → %s', coalesce(old.departamento, '—'), coalesce(new.departamento, '—')) end),
      jsonb_strip_nulls(jsonb_build_object('cargo', old.cargo, 'departamento', old.departamento)),
      'AUTOMATICO', rh.usuario_nome_atual()
    );
  end if;

  if new.status is distinct from old.status then
    insert into rh.colaborador_historico (colaborador_id, tipo_evento, data_evento, cargo, departamento, descricao, dados_anteriores, origem, responsavel_nome)
    values (new.id, 'ALTERACAO_VINCULO', coalesce(case when new.status = 'INATIVO' then new.data_desligamento end, current_date), new.cargo, new.departamento,
      format('Status: %s → %s', old.status, new.status), jsonb_build_object('status', old.status), 'AUTOMATICO', rh.usuario_nome_atual());
  end if;

  if (v_old ->> 'salario_enc') is distinct from (v_new ->> 'salario_enc') then
    v_sal_old := rh.decifrar_numero(nullif(v_old ->> 'salario_enc', '')::bytea);
    v_sal_new := rh.decifrar_numero(nullif(v_new ->> 'salario_enc', '')::bytea);
    -- a cifra muda a cada gravação mesmo com o mesmo valor — só registra se
    -- o VALOR decifrado mudou de verdade (e se foi possível decifrar).
    if v_sal_new is not null and v_sal_new is distinct from v_sal_old then
      insert into rh.colaborador_historico (colaborador_id, tipo_evento, data_evento, cargo, departamento, salario_enc, salario_anterior_enc, descricao, origem, responsavel_nome)
      values (new.id, 'ALTERACAO_SALARIAL', current_date, new.cargo, new.departamento,
        nullif(v_new ->> 'salario_enc', '')::bytea, nullif(v_old ->> 'salario_enc', '')::bytea,
        'Alteração salarial registrada no cadastro', 'AUTOMATICO', rh.usuario_nome_atual());
    end if;
  end if;

  return new;
exception when others then
  raise warning 'rh.colaboradores_historico_automatico falhou: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_colaboradores_historico_auto on rh.colaboradores;
create trigger trg_colaboradores_historico_auto
  after update on rh.colaboradores
  for each row execute function rh.colaboradores_historico_automatico();

-- -----------------------------------------------------------------------------
-- 4. Benefícios concedidos por colaborador (detalhe individual: valor,
--    periodicidade, desconto). O catálogo rh.beneficios continua igual —
--    esta tabela só se liga a ele (beneficio_id opcional).
-- -----------------------------------------------------------------------------
create table if not exists rh.colaborador_beneficios (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references rh.colaboradores(id) on delete cascade,
  beneficio_id uuid references rh.beneficios(id) on delete set null,
  beneficio text not null,
  descricao text,
  valor numeric check (valor is null or valor >= 0),
  periodicidade text not null default 'MENSAL' check (periodicidade in ('DIARIO', 'SEMANAL', 'QUINZENAL', 'MENSAL', 'ANUAL', 'UNICO', 'OUTRO')),
  possui_desconto boolean not null default false,
  valor_desconto numeric check (valor_desconto is null or valor_desconto >= 0),
  data_inicio date not null,
  data_fim date,
  status text not null default 'ATIVO' check (status in ('ATIVO', 'SUSPENSO', 'ENCERRADO')),
  observacao text,
  informado_em timestamptz,
  responsavel_id uuid default auth.uid(),
  responsavel_nome text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (data_fim is null or data_fim >= data_inicio)
);
comment on table rh.colaborador_beneficios is 'Benefício concedido a UM colaborador, com valor, periodicidade e desconto. Complementa (não substitui) o catálogo rh.beneficios.';
create index if not exists idx_colab_beneficios_colab on rh.colaborador_beneficios (colaborador_id);

alter table rh.colaborador_beneficios enable row level security;
drop policy if exists "rh_staff all - colaborador_beneficios" on rh.colaborador_beneficios;
create policy "rh_staff all - colaborador_beneficios" on rh.colaborador_beneficios for all using (rh.is_rh_staff()) with check (rh.is_rh_staff());
drop policy if exists "self select - colaborador_beneficios" on rh.colaborador_beneficios;
create policy "self select - colaborador_beneficios" on rh.colaborador_beneficios for select using (colaborador_id = rh.colaborador_atual());

-- -----------------------------------------------------------------------------
-- 5. Abonos / ocorrências justificadas
-- -----------------------------------------------------------------------------
create table if not exists rh.colaborador_abonos (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references rh.colaboradores(id) on delete cascade,
  tipo text not null check (tipo in (
    'ATESTADO', 'FERIAS', 'FALTA_JUSTIFICADA', 'FALTA_NAO_JUSTIFICADA', 'AUSENCIA_AUTORIZADA',
    'COMPROMISSO_EXTERNO', 'FOLGA', 'OUTRO'
  )),
  justificada boolean not null default true,
  data_inicio date not null,
  data_fim date not null,
  dias integer generated always as ((data_fim - data_inicio) + 1) stored,
  motivo text,
  descricao text,
  observacao text,
  anexo_path text,                              -- caminho no bucket "abonos-rh"
  anexo_nome text,
  status text not null default 'PENDENTE' check (status in ('PENDENTE', 'PRE_APROVADO', 'APROVADO', 'RECUSADO', 'ARQUIVADO')),
  responsavel_id uuid default auth.uid(),
  responsavel_nome text,
  decidido_por_nome text,
  decidido_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (data_fim >= data_inicio)
);
comment on table rh.colaborador_abonos is 'Abonos/ocorrências (atestado, falta justificada/não justificada, folga, etc.). Só status APROVADO abona o dia na jornada. Nunca excluídos — arquivados.';
comment on column rh.colaborador_abonos.justificada is 'Classificação da ocorrência: true = falta/ausência justificada; false = não justificada (usada nos relatórios).';
create index if not exists idx_colab_abonos_colab on rh.colaborador_abonos (colaborador_id, data_inicio);
create index if not exists idx_colab_abonos_status on rh.colaborador_abonos (status);

alter table rh.colaborador_abonos enable row level security;
drop policy if exists "rh_staff all - colaborador_abonos" on rh.colaborador_abonos;
create policy "rh_staff all - colaborador_abonos" on rh.colaborador_abonos for all using (rh.is_rh_staff()) with check (rh.is_rh_staff());
drop policy if exists "self select - colaborador_abonos" on rh.colaborador_abonos;
create policy "self select - colaborador_abonos" on rh.colaborador_abonos for select using (colaborador_id = rh.colaborador_atual());

-- O colaborador pode JUSTIFICAR as próprias faltas: cria um abono dele
-- mesmo, sempre como PENDENTE (só o RH aprova/recusa/altera depois).
drop policy if exists "self insert pendente - colaborador_abonos" on rh.colaborador_abonos;
create policy "self insert pendente - colaborador_abonos" on rh.colaborador_abonos for insert
  with check (colaborador_id = rh.colaborador_atual() and status = 'PENDENTE');

-- ...e anexar o documento depois, enquanto o pedido estiver PENDENTE.
drop policy if exists "self update pendente - colaborador_abonos" on rh.colaborador_abonos;
create policy "self update pendente - colaborador_abonos" on rh.colaborador_abonos for update
  using (colaborador_id = rh.colaborador_atual() and status = 'PENDENTE')
  with check (colaborador_id = rh.colaborador_atual() and status = 'PENDENTE');

-- Anexos de abono (atestados etc.) — bucket PRIVADO, pasta = colaborador_id.
insert into storage.buckets (id, name, public)
values ('abonos-rh', 'abonos-rh', false)
on conflict (id) do nothing;
drop policy if exists "rh_staff all - abonos-rh" on storage.objects;
create policy "rh_staff all - abonos-rh" on storage.objects for all
  using (bucket_id = 'abonos-rh' and rh.is_rh_staff())
  with check (bucket_id = 'abonos-rh' and rh.is_rh_staff());
drop policy if exists "colaborador envia propria pasta - abonos-rh" on storage.objects;
create policy "colaborador envia propria pasta - abonos-rh" on storage.objects for insert
  with check (bucket_id = 'abonos-rh' and (storage.foldername(name))[1] = rh.colaborador_atual()::text);
drop policy if exists "colaborador le propria pasta - abonos-rh" on storage.objects;
create policy "colaborador le propria pasta - abonos-rh" on storage.objects for select
  using (bucket_id = 'abonos-rh' and (storage.foldername(name))[1] = rh.colaborador_atual()::text);

-- -----------------------------------------------------------------------------
-- 6. Notificações persistentes para o colaborador (histórico do que foi
--    informado: benefício, abono, férias, ajuste, evento na história...)
-- -----------------------------------------------------------------------------
create table if not exists rh.notificacoes (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references rh.colaboradores(id) on delete cascade,
  tipo text not null default 'GERAL',           -- BENEFICIO | ABONO | FERIAS | AJUSTE_PONTO | HISTORICO | GERAL
  titulo text not null,
  mensagem text,
  referencia_tabela text,
  referencia_id uuid,
  lida_em timestamptz,
  criado_por_nome text,
  created_at timestamptz not null default now()
);
create index if not exists idx_notificacoes_colab on rh.notificacoes (colaborador_id, created_at desc);

alter table rh.notificacoes enable row level security;
drop policy if exists "rh_staff all - notificacoes" on rh.notificacoes;
create policy "rh_staff all - notificacoes" on rh.notificacoes for all using (rh.is_rh_staff()) with check (rh.is_rh_staff());
drop policy if exists "self select - notificacoes" on rh.notificacoes;
create policy "self select - notificacoes" on rh.notificacoes for select using (colaborador_id = rh.colaborador_atual());

-- Colaborador só consegue marcar a PRÓPRIA notificação como lida (e mais nada).
create or replace function rh.notificacao_marcar_lida(p_id uuid default null)
returns void
language plpgsql
security definer
set search_path = rh, pg_temp
as $$
begin
  update rh.notificacoes
     set lida_em = now()
   where colaborador_id = rh.colaborador_atual()
     and lida_em is null
     and (p_id is null or id = p_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Férias — pré-aprovação (amplia os status aceitos; nada é convertido)
-- -----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'rh' and rel.relname = 'ferias_solicitacoes' and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
      and pg_get_constraintdef(con.oid) not ilike '%PRE_APROVADA%'
  loop
    execute format('alter table rh.ferias_solicitacoes drop constraint %I', r.conname);
  end loop;
  if not exists (
    select 1 from pg_constraint where conname = 'ferias_solicitacoes_status_check_v2'
  ) then
    alter table rh.ferias_solicitacoes
      add constraint ferias_solicitacoes_status_check_v2
      check (status in ('PENDENTE', 'EM_ANALISE', 'PRE_APROVADA', 'APROVADA', 'RECUSADA'));
  end if;
end $$;

alter table rh.ferias_solicitacoes
  add column if not exists pre_aprovada_em timestamptz,
  add column if not exists pre_aprovada_por text,
  add column if not exists arquivado boolean not null default false,
  add column if not exists arquivado_em timestamptz,
  add column if not exists arquivado_por text;

-- -----------------------------------------------------------------------------
-- 8. Solicitações — arquivamento (nunca exclui; só tira da lista principal)
-- -----------------------------------------------------------------------------
alter table rh.solicitacoes
  add column if not exists arquivado boolean not null default false,
  add column if not exists arquivado_em timestamptz,
  add column if not exists arquivado_por text;
create index if not exists idx_solicitacoes_arquivado on rh.solicitacoes (arquivado);

-- -----------------------------------------------------------------------------
-- 8b. Comunicados — o colaborador pode ARQUIVAR um comunicado só para ele
--     (sai da lista principal dele; nada é excluído). A leitura ("visto")
--     continua sendo a linha já existente em rh.comunicados_leituras.
-- -----------------------------------------------------------------------------
alter table rh.comunicados_leituras
  add column if not exists arquivado boolean not null default false,
  add column if not exists arquivado_em timestamptz;

-- -----------------------------------------------------------------------------
-- 9. updated_at + auditoria nas tabelas novas e nas relevantes existentes
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['colaborador_historico', 'colaborador_beneficios', 'colaborador_abonos'] loop
    execute format('drop trigger if exists trg_%I_updated_at on rh.%I', t, t);
    execute format('create trigger trg_%I_updated_at before update on rh.%I for each row execute function rh.set_updated_at()', t, t);
  end loop;

  foreach t in array array['colaboradores', 'solicitacoes', 'ferias_solicitacoes', 'ferias_saldos', 'beneficios',
                           'colaborador_historico', 'colaborador_beneficios', 'colaborador_abonos', 'configuracoes_ponto'] loop
    execute format('drop trigger if exists trg_%I_auditoria on rh.%I', t, t);
    execute format('create trigger trg_%I_auditoria after insert or update or delete on rh.%I for each row execute function rh.auditar_alteracao()', t, t);
  end loop;

  -- ponto: só as alterações feitas pelo RH (batidas normais não geram auditoria)
  drop trigger if exists trg_ponto_registros_auditoria on rh.ponto_registros;
  create trigger trg_ponto_registros_auditoria after insert or update or delete on rh.ponto_registros
    for each row execute function rh.auditar_alteracao('so_staff');
end $$;

-- -----------------------------------------------------------------------------
-- 10. Grants
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on rh.colaborador_historico, rh.colaborador_beneficios, rh.colaborador_abonos, rh.notificacoes to authenticated;
grant select, update on rh.configuracoes_ponto to authenticated;
grant select on rh.auditoria to authenticated;
grant execute on function rh.historico_listar(uuid) to authenticated;
grant execute on function rh.historico_registrar(uuid, text, date, text, text, numeric, text, numeric, text, text, boolean, boolean) to authenticated;
grant execute on function rh.notificacao_marcar_lida(uuid) to authenticated;
grant execute on function rh.usuario_nome_atual() to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on rh.colaborador_historico, rh.colaborador_beneficios, rh.colaborador_abonos, rh.notificacoes, rh.configuracoes_ponto, rh.auditoria to service_role';
  end if;
end $$;

-- PostgREST: recarrega o cache de schema para as tabelas novas aparecerem na API.
notify pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- Conferência (só leitura): contagens das tabelas existentes — devem ser
-- EXATAMENTE as mesmas de antes de rodar este script.
-- -----------------------------------------------------------------------------
select 'colaboradores' as tabela, count(*) from rh.colaboradores
union all select 'perfis', count(*) from rh.perfis
union all select 'ponto_registros', count(*) from rh.ponto_registros
union all select 'solicitacoes', count(*) from rh.solicitacoes
union all select 'ferias_solicitacoes', count(*) from rh.ferias_solicitacoes
union all select 'ferias_saldos', count(*) from rh.ferias_saldos
union all select 'documentos', count(*) from rh.documentos;
