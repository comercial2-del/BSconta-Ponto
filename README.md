# BSconta+ RH — Sistema de Gestão de Colaboradores e RH

Sistema de RH em produção da BSconta Contabilidade Digital: ponto/jornada,
férias, documentos com assinatura, solicitações, comunicados, benefícios e
relatórios, para os portais de Colaborador e de RH.

Front-end estático (HTML/CSS/JS puro, sem framework/bundler) com backend
real em **Supabase** (Postgres + Auth + Edge Functions).

## Status

- Autenticação real via Supabase Auth (`auth.users`) — sem contas falsas,
  sem sessão simulada.
- Banco de dados real, schema `rh` (Postgres/Supabase), com Row Level
  Security: colaborador só vê os próprios dados; RH vê e gerencia conforme
  o papel (`COLABORADOR`, `RH`, `RH_ADMIN`).
- Duas Edge Functions em produção: `invite-colaborador` (convite real por
  e-mail para novo login) e `send-push` (notificação push real de lembrete
  de ponto).
- Migrações `01` a `18` já aplicadas em produção. Detalhes de status e o
  que falta em `docs/SETUP-SUPABASE.md`.

## Estrutura

```
├── index.html          Redirecionamento inicial conforme sessão
├── login.html          Tela de login (Supabase Auth)
├── colaborador/        Telas do portal do Colaborador
├── rh/                  Telas do portal do RH
├── css/                 Design system compartilhado pelas duas telas
├── js/                  Lógica de dados (Supabase), autenticação, UI
├── assets/              Identidade visual (logo, ícone)
├── db/supabase/         Migrações SQL numeradas (rodar em ordem — ver docs/)
├── supabase/functions/  Código das Edge Functions (invite-colaborador, send-push)
└── docs/                Documentação de setup, módulos e histórico do projeto
```

## Executar localmente

O projeto é estático — qualquer servidor HTTP local resolve:

```bash
python -m http.server 8000
```

Depois abra `http://localhost:8000/`. Para funcionar de ponta a ponta é
necessário configurar o Supabase — ver `docs/SETUP-SUPABASE.md`.

## Documentação

- `docs/SETUP-SUPABASE.md` — configuração completa do backend (Supabase):
  migrações, Edge Functions, secrets, status atual.
- `docs/README-DOCUMENTOS.md` — fluxo do módulo de Documentos/assinatura.
- `docs/INTEGRACAO-GOVBR.md` — integração com o Assinador GOV.BR.
- `docs/IMPORTACAO-COLABORADORES.md` — convenções usadas na importação de
  colaboradores a partir de planilha.
- `docs/historico/` — registros de fases anteriores do projeto (protótipo
  visual original, revisões de UI), mantidos como histórico.

## Segurança e dados

Nenhum segredo (chaves de API, tokens, senhas) e nenhum dado real de
colaborador (CPF, nascimento, endereço, e-mail real) é commitado neste
repositório — ver `.gitignore`. Scripts de seed com dados reais têm uma
versão `.exemplo.sql` correspondente, com dados fictícios.
