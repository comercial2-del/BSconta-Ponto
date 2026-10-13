# Banco de dados — BSconta+ RH

O backend real do sistema é **Postgres, no Supabase** (schema `rh`, no
mesmo projeto pago que o CRM/Marketing já usa) — não há SQLite nem
localStorage envolvidos na versão em produção.

Todos os scripts de migração vivem em `db/supabase/`, numerados na ordem em
que devem ser executados (01 a 18). Cada um é idempotente — pode ser
rodado de novo sem duplicar dados. O passo a passo completo, incluindo pré-
requisitos manuais de cada script, está em `docs/SETUP-SUPABASE.md`.

## Sobre os arquivos com dados reais

Dois scripts trazem dados reais de colaboradores (nome, e-mail, CPF,
nascimento, endereço): `03_seed_colaboradores.sql` e
`18_dados_pessoais_planilha.sql`. Esses dois **não são commitados** (ver
`.gitignore` na raiz do projeto) — existem só localmente, em quem já rodou
a migração. O repositório traz apenas as versões `.exemplo.sql`
correspondentes, com dados fictícios, para quem for instalar o projeto do
zero.

## Banco de horas — script 33 (apuração única)

`33_apuracao_ponto_feriados_banco_horas.sql` passa a calcular o banco de horas
num lugar só (`rh.ponto_apuracao`), com a mesma regra da Folha de Ponto:
saldo do dia = trabalhadas + abono − previstas, feriados (`rh.feriados`),
faltas, tolerância diária e saldo anterior (`rh.banco_horas_saldos_iniciais`).
Todas as telas (colaborador, RH, relatórios e o processamento do banco) leem
desse cálculo.

O script `34_importar_folha_ponto_*.sql` (importação da folha do sistema
anterior) tem dados reais e **não é commitado** (ver `.gitignore`): roda só no
SQL Editor do Supabase, depois do 33.
