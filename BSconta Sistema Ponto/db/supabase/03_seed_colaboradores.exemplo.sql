-- =============================================================================
-- BSconta+ RH — seed de EXEMPLO de colaboradores (dados fictícios)
-- =============================================================================
-- Esta é a versão pública (Git) do 03_seed_colaboradores.sql. A versão real,
-- com nome/e-mail dos colaboradores de verdade, fica só na máquina local —
-- nunca é commitada (ver .gitignore). Use este arquivo apenas para instalar
-- o projeto do zero e ter alguns colaboradores de teste no banco.
--
-- Roda DEPOIS do 01_schema_rh.sql (precisa do schema/tabela rh.colaboradores).
--
-- Idempotente: se o "codigo" já existir, atualiza os dados em vez de duplicar.
-- =============================================================================

insert into rh.colaboradores (codigo, nome, email, cargo, departamento, admissao, status)
values
  ('EXEMPLO+01', 'Colaborador de Exemplo Um', 'exemplo01@sua-empresa.com.br', 'Analista', 'Financeiro', '2024-01-15', 'ATIVO'),
  ('EXEMPLO+02', 'Colaboradora de Exemplo Dois', 'exemplo02@sua-empresa.com.br', 'Assistente', 'Fiscal', '2024-06-01', 'ATIVO'),
  ('EXEMPLO+03', 'Colaborador de Exemplo Três', 'exemplo03@sua-empresa.com.br', 'Auxiliar', 'Departamento Pessoal', '2025-02-10', 'ATIVO')
on conflict (codigo) do update set
  nome = excluded.nome,
  email = excluded.email,
  cargo = excluded.cargo,
  departamento = excluded.departamento,
  admissao = excluded.admissao,
  status = excluded.status,
  updated_at = now();

-- Confirmação rápida:
select codigo, nome, email, cargo, departamento, admissao, status
from rh.colaboradores
order by codigo;
