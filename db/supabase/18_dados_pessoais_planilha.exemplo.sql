-- =============================================================================
-- BSconta+ RH — EXEMPLO de preenchimento de dados pessoais (dados fictícios)
-- =============================================================================
-- Esta é a versão pública (Git) do 18_dados_pessoais_planilha.sql. A versão
-- real, com CPF/nascimento/endereço reais dos colaboradores, fica só na
-- máquina local — nunca é commitada (ver .gitignore). Use este arquivo
-- apenas para ver o formato esperado, casando pelos nomes de exemplo do
-- 03_seed_colaboradores.exemplo.sql.
--
-- Roda DEPOIS do 11_perfil_dados_pessoais.sql e do 03 (exemplo ou real).
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
  cpf = dados.cpf,
  data_nascimento = dados.data_nascimento,
  endereco = dados.endereco,
  cep = dados.cep,
  updated_at = now()
from dados
where c.nome = dados.nome;

-- Confirmação rápida:
select codigo, nome, cpf, data_nascimento, endereco, cep
from rh.colaboradores
order by codigo;
