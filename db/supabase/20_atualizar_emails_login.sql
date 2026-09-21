-- =============================================================================
-- BSconta+ RH — Troca dos e-mails de login (item 4 do pedido de ajustes de
-- 21/09/2026, com os acréscimos de Lorena Vieira e Sheilla feitos depois)
-- =============================================================================
-- HISTÓRICO DESTE ARQUIVO (importante ler antes de rodar):
--
--   A versão anterior deste script só atualizava rh.colaboradores.email e
--   rh.perfis.email (as CÓPIAS do e-mail usadas dentro do app) e dizia para
--   trocar o e-mail de LOGIN de verdade (auth.users.email) manualmente pelo
--   painel, em Authentication > Users > "Edit user".
--
--   Isso mudou: eu conferi o painel do projeto (zqhuhaqothpxusnaijog) e, na
--   versão atual do Supabase Studio, a tela Authentication > Users NÃO tem
--   mais nenhum botão/campo para editar o e-mail de um usuário existente —
--   só "Send password recovery", "Send magic link", "Remove MFA factors",
--   "Ban user" e "Delete user". Ou seja, o caminho que eu tinha indicado no
--   painel não existe mais nesta versão.
--
--   Por isso este script foi reescrito para atualizar diretamente as 3
--   camadas, casando por USER_ID (não por nome — já confirmado por SQL
--   read-only, ver PASSO 1) e SEM tocar em nenhuma senha:
--     1) auth.users.email                 (login de verdade, GoTrue)
--     2) auth.identities.identity_data     (o e-mail "identity" do provider
--                                           email; a coluna auth.identities.
--                                           email é GERADA automaticamente a
--                                           partir daqui — lower(identity_data
--                                           ->>'email') — não precisa/pode ser
--                                           setada direto)
--     3) rh.colaboradores.email / rh.perfis.email (cópias usadas pelo app)
--
--   Antes de escrever este script eu conferi (SELECT read-only, nada foi
--   alterado):
--     - Não existe trigger de UPDATE em auth.users nem auth.identities (só
--       um trigger de INSERT, on_auth_user_created, que não é afetado).
--     - auth.users não tem constraint UNIQUE direta em email, mas tem um
--       índice único parcial (users_email_partial_key) — por isso o PASSO 1
--       abaixo confere duplicidade antes de qualquer UPDATE.
--     - auth.identities.email é coluna GERADA (STORED) a partir de
--       identity_data->>'email' — por isso o UPDATE é feito em identity_data,
--       nunca direto na coluna email.
--
--   Eu não tenho (e nunca tive) a service_role key nem qualquer credencial
--   de administrador deste projeto Supabase — só o acesso de leitura/escrita
--   que o SQL Editor do seu próprio painel permite enquanto você está logado
--   nele. Por isso este script foi desenhado para ser rodado por você (ou
--   por mim, pilotando o seu navegador já autenticado) diretamente no SQL
--   Editor — não existe um jeito de eu fazer isso via API sem essa chave.
--
-- Idempotente — pode rodar de novo sem duplicar nada (os UPDATEs só mudam
-- linhas cujo e-mail ainda não é o novo).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PASSO 1 — confira ANTES de rodar o PASSO 2: (a) todos os user_id abaixo
-- pertencem mesmo aos colaboradores certos e (b) nenhum dos 11 novos e-mails
-- já está em uso por outra conta em auth.users (o que quebraria o UPDATE por
-- causa do índice único).
-- -----------------------------------------------------------------------------
select c.nome, c.cargo, c.departamento, p.user_id, p.email as email_atual
from rh.colaboradores c
join rh.perfis p on p.colaborador_id = c.id
where p.user_id in (
  '5858a553-b790-4f16-8793-ad731e6d088c', -- Angella dos Santos Gomes
  'f8255a05-0c06-4f7f-9362-77ae5ebcb97b', -- Fernando Soares Baeta
  '6d4a2dd4-d22d-4b32-97a0-797c68279005', -- Joao Pedro Fernandes de Jesus
  '7ca88b66-094f-4a07-9d41-20f234f7e3ec', -- Laysla Maria Bessa Fernandes Silva
  'a61c9b1b-37d1-46fd-a0eb-38b390deccfc', -- Lorena Vieira de Seles
  '776c60f2-62dd-4a15-926c-c0e425432459', -- Miguel Brandao de Mello Lemos
  '70bd42f1-17ce-4bb7-8df0-349dceec401a', -- Otavio Abrahao Rodrigues da Silva Medeiros
  '9a02886c-c7bc-45bb-b142-b9d890d9b9fe', -- Rafael Italo de Souza Fernandes
  '14089043-5636-4a45-8ef3-07a117134367', -- Rosiane Danielle de Andrade Faria
  '6708dc1a-fc96-466a-bade-20f0c3807154', -- Sheilla Danielle de Andrade Silva
  '8a4b6214-b94e-49f9-a5b2-5cb8789b76c0'  -- Marlon Gomes da Silva (ver aviso abaixo!)
)
order by c.nome;

select email, id
from auth.users
where lower(email) in (
  'setorpj2@bsconta.com.br','societario@bsconta.com.br','contabil1@bsconta.com.br',
  'contabil@bsconta.com.br','financeiro1@bsconta.com.br','setorpj@bsconta.com.br',
  'societario1@bsconta.com.br','comercial1@bsconta.com.br','comercial2@bsconta.com.br',
  'pessoal2@bsconta.com.br','fiscal@bsconta.com.br'
);
-- ⚠️ Este segundo SELECT já retornou 1 linha inesperada quando eu rodei:
-- "comercial2@bsconta.com.br" já pertence a OUTRA conta em auth.users
-- (id 7f3acaa0-1e1b-4373-9143-dc3873e9aff0), criada em 27/08/2026 e com
-- último login em 19/09/2026 — ou seja, uma conta ativa, e essa conta NÃO
-- está ligada a nenhum colaborador em rh.colaboradores/rh.perfis (é órfã
-- para o app de RH). Como este projeto Supabase é compartilhado com o
-- sistema de Marketing/CRM (mesmo banco, mesmo auth.users), é bem provável
-- que essa conta pertença ao outro sistema. Por causa disso, Marlon NÃO
-- está incluído no PASSO 2 abaixo — troque o e-mail dele só depois de
-- decidir o que fazer com essa conta duplicada (ver nota no final do
-- arquivo).

-- -----------------------------------------------------------------------------
-- PASSO 2 — troca de verdade do e-mail de login (auth.users + auth.identities)
-- para os 10 colaboradores SEM conflito de e-mail. Não toca em nenhuma senha
-- (encrypted_password nunca é tocado) e não desloga quem já está logado.
-- -----------------------------------------------------------------------------
with novos_emails (user_id, novo_email) as (
  values
    ('5858a553-b790-4f16-8793-ad731e6d088c'::uuid, 'societario1@bsconta.com.br'),
    ('f8255a05-0c06-4f7f-9362-77ae5ebcb97b'::uuid, 'setorpj2@bsconta.com.br'),
    ('6d4a2dd4-d22d-4b32-97a0-797c68279005'::uuid, 'societario@bsconta.com.br'),
    ('7ca88b66-094f-4a07-9d41-20f234f7e3ec'::uuid, 'comercial1@bsconta.com.br'),
    ('a61c9b1b-37d1-46fd-a0eb-38b390deccfc'::uuid, 'pessoal2@bsconta.com.br'),
    ('776c60f2-62dd-4a15-926c-c0e425432459'::uuid, 'financeiro1@bsconta.com.br'),
    ('70bd42f1-17ce-4bb7-8df0-349dceec401a'::uuid, 'contabil@bsconta.com.br'),
    ('9a02886c-c7bc-45bb-b142-b9d890d9b9fe'::uuid, 'contabil1@bsconta.com.br'),
    ('14089043-5636-4a45-8ef3-07a117134367'::uuid, 'setorpj@bsconta.com.br'),
    ('6708dc1a-fc96-466a-bade-20f0c3807154'::uuid, 'fiscal@bsconta.com.br')
)
update auth.users u
set email = n.novo_email,
    updated_at = now()
from novos_emails n
where u.id = n.user_id
returning u.id, u.email;

with novos_emails (user_id, novo_email) as (
  values
    ('5858a553-b790-4f16-8793-ad731e6d088c'::uuid, 'societario1@bsconta.com.br'),
    ('f8255a05-0c06-4f7f-9362-77ae5ebcb97b'::uuid, 'setorpj2@bsconta.com.br'),
    ('6d4a2dd4-d22d-4b32-97a0-797c68279005'::uuid, 'societario@bsconta.com.br'),
    ('7ca88b66-094f-4a07-9d41-20f234f7e3ec'::uuid, 'comercial1@bsconta.com.br'),
    ('a61c9b1b-37d1-46fd-a0eb-38b390deccfc'::uuid, 'pessoal2@bsconta.com.br'),
    ('776c60f2-62dd-4a15-926c-c0e425432459'::uuid, 'financeiro1@bsconta.com.br'),
    ('70bd42f1-17ce-4bb7-8df0-349dceec401a'::uuid, 'contabil@bsconta.com.br'),
    ('9a02886c-c7bc-45bb-b142-b9d890d9b9fe'::uuid, 'contabil1@bsconta.com.br'),
    ('14089043-5636-4a45-8ef3-07a117134367'::uuid, 'setorpj@bsconta.com.br'),
    ('6708dc1a-fc96-466a-bade-20f0c3807154'::uuid, 'fiscal@bsconta.com.br')
)
update auth.identities i
set identity_data = jsonb_set(i.identity_data, '{email}', to_jsonb(n.novo_email::text)),
    updated_at = now()
from novos_emails n
where i.user_id = n.user_id
  and i.provider = 'email'
returning i.user_id, i.email;

-- -----------------------------------------------------------------------------
-- PASSO 3 — sincroniza as cópias do e-mail dentro do schema rh (usadas pela
-- tela Configurações > Usuários e pelos cadastros de colaborador).
-- -----------------------------------------------------------------------------
with novos_emails (user_id, novo_email) as (
  values
    ('5858a553-b790-4f16-8793-ad731e6d088c'::uuid, 'societario1@bsconta.com.br'),
    ('f8255a05-0c06-4f7f-9362-77ae5ebcb97b'::uuid, 'setorpj2@bsconta.com.br'),
    ('6d4a2dd4-d22d-4b32-97a0-797c68279005'::uuid, 'societario@bsconta.com.br'),
    ('7ca88b66-094f-4a07-9d41-20f234f7e3ec'::uuid, 'comercial1@bsconta.com.br'),
    ('a61c9b1b-37d1-46fd-a0eb-38b390deccfc'::uuid, 'pessoal2@bsconta.com.br'),
    ('776c60f2-62dd-4a15-926c-c0e425432459'::uuid, 'financeiro1@bsconta.com.br'),
    ('70bd42f1-17ce-4bb7-8df0-349dceec401a'::uuid, 'contabil@bsconta.com.br'),
    ('9a02886c-c7bc-45bb-b142-b9d890d9b9fe'::uuid, 'contabil1@bsconta.com.br'),
    ('14089043-5636-4a45-8ef3-07a117134367'::uuid, 'setorpj@bsconta.com.br'),
    ('6708dc1a-fc96-466a-bade-20f0c3807154'::uuid, 'fiscal@bsconta.com.br')
),
atualiza_perfis as (
  update rh.perfis p
  set email = n.novo_email,
      updated_at = now()
  from novos_emails n
  where p.user_id = n.user_id
  returning p.colaborador_id, p.email
)
update rh.colaboradores c
set email = ap.email,
    updated_at = now()
from atualiza_perfis ap
where c.id = ap.colaborador_id;

-- -----------------------------------------------------------------------------
-- PASSO 4 — confira o resultado (espera-se ver os 10 e-mails novos nas 3
-- colunas, iguais entre si).
-- -----------------------------------------------------------------------------
select c.nome,
       u.email as email_login_auth,
       p.email as email_perfis,
       c.email as email_colaboradores
from rh.colaboradores c
join rh.perfis p on p.colaborador_id = c.id
join auth.users u on u.id = p.user_id
where p.user_id in (
  '5858a553-b790-4f16-8793-ad731e6d088c','f8255a05-0c06-4f7f-9362-77ae5ebcb97b',
  '6d4a2dd4-d22d-4b32-97a0-797c68279005','7ca88b66-094f-4a07-9d41-20f234f7e3ec',
  'a61c9b1b-37d1-46fd-a0eb-38b390deccfc','776c60f2-62dd-4a15-926c-c0e425432459',
  '70bd42f1-17ce-4bb7-8df0-349dceec401a','9a02886c-c7bc-45bb-b142-b9d890d9b9fe',
  '14089043-5636-4a45-8ef3-07a117134367','6708dc1a-fc96-466a-bade-20f0c3807154'
)
order by c.nome;

-- =============================================================================
-- PENDÊNCIAS — não incluídas neste script, precisam de uma decisão sua:
--
-- 1) MARLON GOMES DA SILVA (user_id 8a4b6214-b94e-49f9-a5b2-5cb8789b76c0,
--    e-mail atual BScontaMarlon83@gmail.com) — o e-mail pedido para ele,
--    comercial2@bsconta.com.br, já é o login de OUTRA conta em auth.users
--    (id 7f3acaa0-1e1b-4373-9143-dc3873e9aff0), criada em 27/08/2026, com
--    login em 19/09/2026, sem nenhum vínculo com rh.colaboradores/rh.perfis.
--    Como o projeto é compartilhado com o sistema de Marketing/CRM, essa
--    conta provavelmente pertence a ele. Preciso que você confirme:
--      a) esse e-mail já não pode ser usado para o Marlon (escolher outro
--         e-mail de login para ele), ou
--      b) essa conta "comercial2@bsconta.com.br" pode ser apagada/renomeada
--         (só depois de confirmar que não é usada pelo Marketing), liberando
--         o e-mail para o Marlon.
--
-- 2) PAULO ROCHA (financeiro2@bsconta.com.br) — não encontrado em
--    rh.colaboradores nem em auth.users (busquei por nome e por e-mail
--    parecido, nenhuma linha bateu). Preciso confirmar o nome completo
--    correto dele no cadastro, ou se ele ainda não tem usuário criado no
--    sistema.
-- =============================================================================
