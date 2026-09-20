-- =============================================================================
-- BSconta+ RH — EXEMPLO de preenchimento de dados pessoais (dados fictícios)
-- =============================================================================
-- Esta é a versão pública (Git) do 18_dados_pessoais_planilha.sql. A versão
-- real, com CPF/nascimento/endereço reais dos colaboradores, fica só na
-- máquina local — nunca é commitada (ver .gitignore). Use este arquivo
-- apenas para ver o formato esperado, casando pelos nomes de exemplo do
-- 03_seed_colaboradores.exemplo.sql.
--
-- Roda DEPOIS do 11_perfil_dados_pessoais.sql, do 03 (exemplo ou real) e do
-- 19_criptografia_dados_pessoais.sql (estes dados são gravados CIFRADOS —
-- ver o cabeçalho do 19 para configurar app.settings.pii_key antes).
--
-- Idempotente: casa por nome exato; se não achar alguém, ignora essa linha.
-- =============================================================================

with dados (nome, cpf, data_nascimento, endereco, cep) as (
  values
    ('Colaborador de Exemplo Um', '000.000.000-00', '1990-01-01'::date, 'Rua de Exemplo, 100, Centro, SUA CIDADE / UF', '00000-000'),
    ('Colaboradora de Exemplo Dois', '111.111.111-11', '1992-05-20'::date, 'Avenida Modelo, 200, Bairro Exemplo, SUA CIDADE / UF', '11111-111'),
    ('Colaborador de Exemplo Três', '222.222.222-22', '1995-09-30'::date, 'Rua Fictícia, 300, Bairro Teste, SUA CIDADE / UF', '22222-222')
)
update rh.colaboradores c
set
  cpf_enc = pgp_sym_encrypt(dados.cpf, current_setting('app.settings.pii_key')),
  data_nascimento_enc = pgp_sym_encrypt(dados.data_nascimento::text, current_setting('app.settings.pii_key')),
  endereco_enc = pgp_sym_encrypt(dados.endereco, current_setting('app.settings.pii_key')),
  cep_enc = pgp_sym_encrypt(dados.cep, current_setting('app.settings.pii_key')),
  updated_at = now()
from dados
where c.nome = dados.nome;

-- Confirmação rápida (decifra na hora, só para exibir aqui no SQL Editor):
select
  codigo, nome,
  pgp_sym_decrypt(cpf_enc, current_setting('app.settings.pii_key')) as cpf,
  pgp_sym_decrypt(data_nascimento_enc, current_setting('app.settings.pii_key'))::date as data_nascimento,
  pgp_sym_decrypt(endereco_enc, current_setting('app.settings.pii_key')) as endereco,
  pgp_sym_decrypt(cep_enc, current_setting('app.settings.pii_key')) as cep
from rh.colaboradores
order by codigo;
