-- =============================================================================
-- BSconta+ RH — Criptografia dos dados pessoais sensíveis (CPF, nascimento,
-- endereço, CEP) em repouso no banco.
-- =============================================================================
-- Até aqui, cpf/data_nascimento/endereco/cep ficavam gravados em texto puro
-- em rh.colaboradores. Qualquer pessoa com acesso direto ao Postgres (um
-- dump/backup do banco, uma credencial de service_role vazada, uma consulta
-- direta no painel do Supabase) conseguia ler esses campos sem restrição
-- nenhuma além do RLS. Este script:
--
--   1. Cria colunas *_enc (bytea), com o conteúdo cifrado via pgcrypto
--      (pgp_sym_encrypt), usando uma chave simétrica que só existe como uma
--      configuração do próprio banco (app.settings.pii_key) — NUNCA gravada
--      em nenhum arquivo deste repositório.
--   2. Migra o conteúdo já existente das colunas antigas para as novas,
--      cifrado.
--   3. Remove as colunas antigas em texto puro.
--   4. Troca as funções que gravam esses dados (chamadas pela tela) para
--      cifrar antes de gravar.
--   5. Cria uma função de leitura (rh.colaboradores_dados_pessoais) que
--      decifra só na hora de mostrar na tela, e só para quem tem permissão
--      de ver aquela linha (o próprio colaborador, ou RH/RH_ADMIN) — nunca
--      via SELECT direto na tabela.
--
-- IMPORTANTE — passo manual obrigatório ANTES de rodar este script:
-- Configure a chave de criptografia no banco. Rode isto no SQL Editor,
-- com a chave que foi te enviada separadamente (nunca commitada aqui):
--
--   alter database postgres set app.settings.pii_key = 'COLE_A_CHAVE_AQUI';
--
-- Depois disso, é preciso encerrar e reabrir a conexão do SQL Editor (ou
-- simplesmente rodar este script numa aba nova) para o current_setting()
-- já valer nesta sessão.
-- =============================================================================

create extension if not exists pgcrypto;

alter table rh.colaboradores
  add column if not exists cpf_enc bytea,
  add column if not exists data_nascimento_enc bytea,
  add column if not exists endereco_enc bytea,
  add column if not exists cep_enc bytea;

-- Migra o que já existir em texto puro para as colunas cifradas.
update rh.colaboradores
set
  cpf_enc = case when cpf is not null then pgp_sym_encrypt(cpf, current_setting('app.settings.pii_key')) else null end,
  data_nascimento_enc = case when data_nascimento is not null then pgp_sym_encrypt(data_nascimento::text, current_setting('app.settings.pii_key')) else null end,
  endereco_enc = case when endereco is not null then pgp_sym_encrypt(endereco, current_setting('app.settings.pii_key')) else null end,
  cep_enc = case when cep is not null then pgp_sym_encrypt(cep, current_setting('app.settings.pii_key')) else null end
where cpf is not null or data_nascimento is not null or endereco is not null or cep is not null;

-- Confirmação rápida ANTES de apagar as colunas antigas: as contagens
-- devem coincidir (mesma quantidade de linhas com dado preenchido nos dois
-- lados). Se não coincidirem, pare aqui e não rode o restante do script.
do $$
declare
  v_antes int;
  v_depois int;
begin
  select count(*) into v_antes from rh.colaboradores where cpf is not null or data_nascimento is not null or endereco is not null or cep is not null;
  select count(*) into v_depois from rh.colaboradores where cpf_enc is not null or data_nascimento_enc is not null or endereco_enc is not null or cep_enc is not null;
  if v_antes <> v_depois then
    raise exception 'Migracao de dados pessoais divergente: % linhas com dado em texto puro, % linhas com dado cifrado. Nao apagando as colunas antigas.', v_antes, v_depois;
  end if;
end $$;

alter table rh.colaboradores
  drop column if exists cpf,
  drop column if exists data_nascimento,
  drop column if exists endereco,
  drop column if exists cep;

-- -----------------------------------------------------------------------------
-- Escrita: o colaborador edita os PRÓPRIOS dados pessoais (mesma função de
-- sempre, chamada pela tela de Perfil/Minha conta — agora cifra antes de
-- gravar).
-- -----------------------------------------------------------------------------
create or replace function rh.colaborador_atualizar_dados_pessoais(
  p_cpf text, p_data_nascimento date, p_telefone text, p_endereco text, p_cep text
)
returns void
language plpgsql
security definer
set search_path = rh, pg_temp
as $$
declare
  v_id uuid := rh.colaborador_atual();
  v_key text := current_setting('app.settings.pii_key');
begin
  if v_id is null then
    raise exception 'Login não vinculado a um cadastro de colaborador.';
  end if;
  update rh.colaboradores
  set
    cpf_enc = case when p_cpf is not null then pgp_sym_encrypt(p_cpf, v_key) else null end,
    data_nascimento_enc = case when p_data_nascimento is not null then pgp_sym_encrypt(p_data_nascimento::text, v_key) else null end,
    telefone = p_telefone,
    endereco_enc = case when p_endereco is not null then pgp_sym_encrypt(p_endereco, v_key) else null end,
    cep_enc = case when p_cep is not null then pgp_sym_encrypt(p_cep, v_key) else null end,
    updated_at = now()
  where id = v_id;
end;
$$;
comment on function rh.colaborador_atualizar_dados_pessoais(text, date, text, text, text) is 'Colaborador edita os PRÓPRIOS dados pessoais (CPF, nascimento, telefone, endereço, CEP) — grava CPF/nascimento/endereço/CEP cifrados (pgcrypto); telefone continua em texto puro (baixa sensibilidade). Nunca cargo/departamento/status/e-mail, que continuam só com o RH.';

-- -----------------------------------------------------------------------------
-- Escrita (RH): RH_STAFF define a data de nascimento de QUALQUER colaborador
-- (tela de cadastro/edição em rh/colaboradores.html). Continua sem CPF nem
-- endereço/CEP porque essa tela nunca tocou nesses campos.
-- -----------------------------------------------------------------------------
create or replace function rh.rh_definir_nascimento_colaborador(p_colaborador_id uuid, p_data_nascimento date)
returns void
language plpgsql
security definer
set search_path = rh, pg_temp
as $$
declare
  v_key text := current_setting('app.settings.pii_key');
begin
  if not rh.is_rh_staff() then
    raise exception 'Sem permissão para alterar dados de outro colaborador.';
  end if;
  update rh.colaboradores
  set data_nascimento_enc = case when p_data_nascimento is not null then pgp_sym_encrypt(p_data_nascimento::text, v_key) else null end,
      updated_at = now()
  where id = p_colaborador_id;
end;
$$;
comment on function rh.rh_definir_nascimento_colaborador(uuid, date) is 'RH define/altera a data de nascimento de um colaborador (cadastro/edição em rh/colaboradores.html), cifrada.';

-- -----------------------------------------------------------------------------
-- Leitura: decifra só para quem tem permissão, e só na hora de mostrar na
-- tela. NUNCA via SELECT direto na tabela — sempre por esta função.
--
--   * chamada com p_colaborador_id de uma pessoa específica: devolve a
--     linha dela, SE quem está chamando for a própria pessoa OU for
--     RH/RH_ADMIN;
--   * chamada sem p_colaborador_id (default null): devolve a PRÓPRIA linha
--     de quem chamou, OU, se quem chamou for RH/RH_ADMIN, devolve TODAS as
--     linhas (usado pelo card "Aniversariantes do mês" do dashboard do RH).
-- -----------------------------------------------------------------------------
create or replace function rh.colaboradores_dados_pessoais(p_colaborador_id uuid default null)
returns table (id uuid, cpf text, data_nascimento date, endereco text, cep text)
language plpgsql
security definer
set search_path = rh, pg_temp
as $$
declare
  v_key text := current_setting('app.settings.pii_key');
  v_eu uuid := rh.colaborador_atual();
  v_rh boolean := rh.is_rh_staff();
begin
  if p_colaborador_id is not null then
    if p_colaborador_id <> v_eu and not v_rh then
      raise exception 'Sem permissão para ver os dados pessoais deste colaborador.';
    end if;
    return query
      select c.id,
             pgp_sym_decrypt(c.cpf_enc, v_key),
             pgp_sym_decrypt(c.data_nascimento_enc, v_key)::date,
             pgp_sym_decrypt(c.endereco_enc, v_key),
             pgp_sym_decrypt(c.cep_enc, v_key)
      from rh.colaboradores c
      where c.id = p_colaborador_id;
  elsif v_rh then
    return query
      select c.id,
             pgp_sym_decrypt(c.cpf_enc, v_key),
             pgp_sym_decrypt(c.data_nascimento_enc, v_key)::date,
             pgp_sym_decrypt(c.endereco_enc, v_key),
             pgp_sym_decrypt(c.cep_enc, v_key)
      from rh.colaboradores c;
  else
    return query
      select c.id,
             pgp_sym_decrypt(c.cpf_enc, v_key),
             pgp_sym_decrypt(c.data_nascimento_enc, v_key)::date,
             pgp_sym_decrypt(c.endereco_enc, v_key),
             pgp_sym_decrypt(c.cep_enc, v_key)
      from rh.colaboradores c
      where c.id = v_eu;
  end if;
end;
$$;
comment on function rh.colaboradores_dados_pessoais(uuid) is 'Decifra CPF/nascimento/endereço/CEP só para exibir na tela. Uma pessoa só vê a própria linha; RH/RH_ADMIN pode ver qualquer uma (ou todas, se chamada sem argumento).';

grant execute on function rh.colaborador_atualizar_dados_pessoais(text, date, text, text, text) to authenticated;
grant execute on function rh.rh_definir_nascimento_colaborador(uuid, date) to authenticated;
grant execute on function rh.colaboradores_dados_pessoais(uuid) to authenticated;
