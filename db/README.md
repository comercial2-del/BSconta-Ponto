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
