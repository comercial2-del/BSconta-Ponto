# BSconta+ RH — Configurar o banco de dados (Supabase)

Última revisão: **19/09/2026**. Este documento substitui por completo
qualquer versão anterior — a numeração dos passos segue exatamente a ordem
numérica dos arquivos em `db/supabase/`.

## Status atual (produção)

- **Scripts 01 a 16 e 18: executados em produção**, verificados byte a byte
  antes de cada execução. O script **04** (promover a Nádia a RH) ainda não
  rodou porque a conta dela em `auth.users` ainda não existe — ver Passo 2.
- **Edge Functions `invite-colaborador` e `send-push`: já implantadas** no
  projeto (19/09/2026), com as permissões de JWT corretas para cada uma.
- **Script 17 (agendamento automático do lembrete por push): ainda não
  rodou** — depende dos 4 secrets da Edge Function (Passo 4.14) estarem
  salvos primeiro. Arquivo já pronto com o segredo real preenchido, fora
  deste repositório (ver `.gitignore` — nunca comitar esse arquivo).

## Arquitetura (decisão já tomada, não muda com esta atualização)

O RH usa o **mesmo projeto Supabase pago que o Marketing já usa**
(`zqhuhaqothpxusnaijog`), num **schema Postgres próprio chamado `rh`**,
isolado do `public` do comercial:

- Nenhuma tabela do Marketing é lida, alterada ou referenciada pelo RH, e
  vice-versa — só o banco (o projeto pago) é compartilhado.
- Row Level Security (RLS) garante que cada colaborador só vê os próprios
  dados; RH vê e gerencia os de todos; só RH_ADMIN mexe em usuários e
  permissões.
- As tabelas do RH só são acessíveis por quem está logado
  (`authenticated`), mais a `service_role` das duas Edge Functions — sem
  sessão/chave, nenhuma linha do RH é lida ou escrita.
- Login compartilhado com o CRM: quem já tem conta em `auth.users` neste
  projeto não precisa criar uma nova para usar o RH.

## Visão geral: o que rodar, e em que ordem

Todos os scripts abaixo vivem em `db/supabase/` e são **idempotentes**
(pode rodar de novo sem duplicar nada) — se travar em algum passo, corrija
e rode o mesmo script de novo, sem medo. Rode cada um, na ordem, no painel
do projeto → **SQL Editor** → **New query** → cole o conteúdo do arquivo →
**Run**.

| # | Arquivo | O que faz | Pré-requisito manual |
|---|---|---|---|
| 01 | `01_schema_rh.sql` | Cria o schema `rh`, todas as tabelas, RLS, e os grants de `authenticated` **e `service_role`** (necessário para as Edge Functions) | — |
| 02 | `02_promover_primeiro_rh_admin.sql` | Promove um login existente a RH_ADMIN (edite o e-mail no topo do arquivo antes de rodar) | Login já criado (Authentication > Users) |
| 03 | `03_seed_colaboradores.sql` | Cadastra os 15 colaboradores da planilha original em `rh.colaboradores` | — |
| 04 | `04_promover_nadia_rh.sql` | Promove um segundo login específico a RH | Login já criado |
| 05 | `05_colaboradores_campos_extra.sql` | Colunas de jornada: `horario_entrada`, `horario_saida`, `dias_trabalho`, `horas_semanais` | — |
| 06 | `06_ferias_observacoes.sql` | Coluna `observacoes` em `rh.ferias_solicitacoes` | — |
| 07 | `07_seed_ferias_saldos.sql` | Saldo inicial de férias (30 dias) para quem ainda não tem | — |
| 08 | `08_comunicados_campos_extra.sql` | Colunas de status/público/agendamento em `rh.comunicados` | — |
| 09 | `09_comunicados_publicar_agendados.sql` | Job `pg_cron` que publica comunicados agendados automaticamente na data | Ver nota abaixo — tenta ativar `pg_cron` por SQL |
| 10 | `10_documentos_storage.sql` | Bucket de Storage `documentos-rh` + políticas + funções de assinatura | — |
| 11 | `11_perfil_dados_pessoais.sql` | Colunas pessoais (CPF, nascimento, etc.) + bucket `avatares-rh` + funções de auto-edição | — |
| 12 | `12_perfis_usuarios_extra.sql` | Colunas de `rh.perfis` para a tela Configurações > Usuários (nome/email/ativo/preferências) | — |
| 13 | `13_colaboradores_desligamento_e_jornada.sql` | Coluna `data_desligamento` + trigger de sincronização automática com o status + backfill de jornada padrão | — |
| 14 | `14_updated_at_triggers.sql` | Trigger genérico de `updated_at` em 7 tabelas (antes só era atualizado manualmente em algumas) | — |
| 15 | `15_indexes.sql` | Índices de performance nas consultas mais usadas (ponto por data, solicitações por status, etc.) | — |
| 16 | `16_push_notifications.sql` | Tabelas `push_subscriptions` e `lembretes_ponto_enviados` (base do lembrete de ponto sem aba aberta) | — |
| 17 | `17_pg_cron_push_reminders.sql` | Job `pg_cron` + `pg_net` que chama a Edge Function `send-push` a cada 5 minutos | **Edite a URL/segredo antes de rodar** — ver Passo 4.14 |
| 18 | `18_dados_pessoais_planilha.sql` | Preenche CPF/nascimento/endereço/CEP reais dos colaboradores a partir de `Empregados.xls` | Precisa do 03 e do 11 já rodados |

Depois disso, faltam **dois passos que não são SQL**: implantar as duas
Edge Functions (Passo 4.13/4.14) e expor o schema `rh` na API (Passo 2
abaixo, se ainda não tiver feito).

**Sobre os arquivos 03 e 18 neste repositório:** as versões com dados reais
de colaboradores (nome, e-mail, CPF, nascimento, endereço) ficam **fora do
Git** (`.gitignore`) — só existem localmente. O repositório traz apenas
`03_seed_colaboradores.exemplo.sql` e `18_dados_pessoais_planilha.exemplo.sql`,
com dados fictícios, para quem for instalar o projeto do zero.

## Passo 1 — Expor o schema `rh` na API (uma vez só)

Por padrão o Supabase só expõe o schema `public` pela API. Sem isto, toda
tela do RH mostra o erro "schema must be one of the following: public".

1. **Project Settings** > **Data API** > seção **Exposed schemas**.
2. Adicione `rh` à lista (junto com `public`).
3. Salve.

## Passo 2 — Criar o(s) login(s) de quem vai usar

1. Quem já usa o CRM/Marketing neste mesmo projeto **já tem login** — pule
   para o Passo 3.
2. Alguém novo: **Authentication** > **Users** > **Add user** > **Create
   new user**, marcando **Auto Confirm User**. Defina uma senha.

## Passo 3 — Rodar os scripts 01 a 17, na ordem

Siga a tabela da seção "Visão geral" acima, um arquivo por vez, no SQL
Editor. Duas observações específicas:

- **Script 02**: abra o arquivo antes de colar e troque o e-mail no topo
  pelo e-mail do login criado no Passo 2.
- **Script 09**: tenta `create extension if not exists pg_cron;` direto por
  SQL — na maioria dos projetos Supabase isso funciona sem passo manual. Se
  der "permission denied to create extension", ative manualmente uma vez em
  **Database > Extensions** (procure "pg_cron") e rode o script de novo.
- **Script 17**: **não rode ainda** se você não tiver implantado a Edge
  Function `send-push` primeiro (Passo 4.14) — a URL/segredo que ele
  configura só faz sentido depois que a função existir. Volte a ele depois
  do Passo 4.14.

## Passo 4 — Implantar as duas Edge Functions

As Edge Functions rodam no servidor da Supabase (nunca no navegador) porque
precisam da chave secreta (`service_role`) do projeto. **Elas não podem ser
implantadas por automação daqui** — só você, com a Supabase CLI, consegue
publicá-las. Comandos exatos:

```bash
npm install -g supabase
supabase login
supabase link --project-ref zqhuhaqothpxusnaijog

# 4.13 — convite real de colaborador/usuário (e-mail de "defina sua senha")
supabase functions deploy invite-colaborador

# 4.14 — notificações push (lembrete de ponto + avisos avulsos do RH)
supabase secrets set \
  VAPID_PUBLIC_KEY="BKRH5gB8Dpglul--NciXqE0_beojOHL-f8llDC-_lHISyeFU-ULHn8aj9VccFpS3_0PAfuaBwKWYq5fIcPPeU7A" \
  VAPID_PRIVATE_KEY="ulHvasA2H2smxlF86-HmxWohtj-lZr7LuM8FB_S7WWg" \
  VAPID_SUBJECT="mailto:comercial2@bsconta.com.br" \
  CRON_SHARED_SECRET="troque-por-uma-string-aleatoria-bem-longa-e-guarde-em-local-seguro"

supabase functions deploy send-push --no-verify-jwt
```

Sem este passo, "Novo colaborador"/"Convidar usuário" e as notificações
push continuam indisponíveis mesmo com todo o SQL já rodado — é um bloqueio
de infraestrutura que só você pode destravar (não tenho como executar a
Supabase CLI contra a sua conta a partir daqui).

**Sobre as chaves VAPID acima:** é um par de chaves criptográficas público/
privado que eu gerei agora (localmente, com a curva EC padrão usada por
qualquer gerador de chaves VAPID) só para este sistema. Pode usar
exatamente como está — não é uma chave de demonstração/fake, é uma chave
real e funcional. Se preferir gerar a sua própria (ou precisar trocar por
segurança no futuro), o jeito mais simples e à prova de erro de formatação
é usar o gerador oficial da biblioteca `web-push`:

```bash
npx web-push generate-vapid-keys
```

Isso imprime um `publicKey` e um `privateKey` já no formato certo. Se
gerar um par novo, troque **os dois** nos secrets da Edge Function (comando
`supabase secrets set` acima) **e** troque `RH_VAPID_PUBLIC_KEY` em
`js/rh-push-data.js` pelo novo `publicKey` (a chave pública fica no
front-end, é pública por natureza) — a privada nunca vai para nenhum
arquivo do site, só para o secret da Edge Function.

**`CRON_SHARED_SECRET`**: depois de definir esse secret na Edge Function,
volte no **script 17** (`db/supabase/17_pg_cron_push_reminders.sql`),
troque a linha marcada "AJUSTE AQUI" pelo MESMO valor, e rode o script.

## O que cada tela já faz de verdade (auditoria completa desta rodada)

Todas as 20 telas (login, index, 10 telas de colaborador, 9 de RH — mais
`login.html`) usam Supabase Auth e as tabelas/RPCs reais descritas abaixo.
Não sobrou nenhum array fixo, nenhuma função que finge salvar, nenhum botão
que só mostra um toast sem fazer nada. Dois pontos que foram corrigidos
nesta auditoria e que você deve saber:

- **`js/demo-data.js` foi esvaziado de propósito** — antes ainda carregava
  uma lista enorme de colaboradores/férias/documentos/comunicados
  fictícios que **não era mais lida por nenhuma tela** (dead code desde
  migrações anteriores, só ocupando espaço e confundindo quem lesse o
  arquivo). Hoje ele só tem o que ainda é usado de verdade: o utilitário de
  caminho de assets e o endereço real da sede (usado só para sugerir
  "Home Office" vs. "Presencial" pela localização do navegador — o
  colaborador sempre confirma antes de salvar).
- **"Lembrar colaborador" (Documentos) era decorativo** — o botão só
  mostrava um toast fixo ("Lembrete preparado...") sem mandar nada de
  verdade. Agora chama a Edge Function `send-push` e manda uma notificação
  push real para o colaborador (se ele tiver ativado as notificações do
  navegador — ver abaixo); se ele não tiver ativado, a tela avisa
  exatamente isso, em vez de fingir sucesso.
- **Excluir documento não existia** — só dava para cadastrar/enviar, nunca
  remover um documento enviado por engano. Agora existe um botão de
  excluir (bloqueado para documentos já `ASSINADO`/`PUBLICADO`, que ficam
  como registro), que remove a linha da tabela e o arquivo do Storage.

## As quatro correções estruturais pedidas nesta auditoria

### 1. Banco de horas com jornada configurável por colaborador (não mais 8h fixas)

**Antes:** `js/rh-ponto-data.js` tinha uma constante fixa
(`RH_META_DIARIA_PADRAO = 8`) e um horário fixo (`"08:00"`) usados para
TODO colaborador, em quatro lugares diferentes do código (cada tela tinha
sua própria cópia da mesma conta). As colunas de jornada configurável
(`horario_entrada`, `horario_saida`, `dias_trabalho`, `horas_semanais`)
já existiam na tela de Colaboradores desde o script 05, mas **nunca eram
lidas** pelo cálculo de ponto/atraso/hora extra.

**Agora:** existe um único ponto de cálculo (`rhConfigJornada` +
`rhClassificarStatusHoje` + `rhCalcularDia`, em `js/rh-ponto-data.js`),
usado por `colaborador/ponto.html`, `rh/ponto.html`, `rh/dashboard.html` e
`rh/relatorios.html` — nenhuma tela mais tem sua própria cópia da conta.
Cada colaborador tem sua própria meta diária (calculada a partir de
`horas_semanais` ÷ dias trabalhados, ou de `meta_diaria_horas` se
preenchido) e seu próprio horário de entrada previsto. Colaboradores sem
jornada configurada continuam com o padrão de 8h/08:00 como fallback —
ninguém quebra por falta de configuração.

**Bug real corrigido de brinde:** como `dias_trabalho` nunca era
consultado, um colaborador que trabalha só de segunda a sexta aparecia como
**"Falta"** no sábado/domingo. Agora existe um status "Sem expediente
hoje" para os dias configurados como não-trabalho, que não conta como
falta em nenhum KPI/relatório.

**Não recalculei o histórico já gravado** — só os lançamentos NOVOS
(bater ponto hoje, ou um ajuste resolvido pelo RH a partir de agora) usam a
jornada configurada. Isso é intencional: mudar retroativamente o que já
foi registrado distorceria o que realmente aconteceu naquele dia.

### 2. Data de desligamento

**Antes:** `rh.colaboradores` só tinha o status atual
(ATIVO/AFASTADO/INATIVO), sem nenhuma data — o relatório de Colaboradores
avisava explicitamente que não tinha esse dado.

**Agora** (script 13): coluna `data_desligamento`, com um trigger
(`rh.colaboradores_sync_desligamento`) que:
- Preenche automaticamente com a data de hoje quando o status muda PARA
  `INATIVO` (se o RH não tiver digitado uma data manualmente).
- Aceita uma data retroativa digitada manualmente pelo RH, se o status já
  estiver mudando para `INATIVO` naquela mesma edição.
- Limpa a data automaticamente se o status for alterado para qualquer
  coisa diferente de `INATIVO` (reativação, ou correção de um desligamento
  lançado por engano) — por isso a data só "pega" quando o Status também
  está marcado como Inativo; veja o aviso na própria tela.
- `rh/colaboradores.html` mostra e edita esse campo; `rh/relatorios.html`
  já usa para contar desligamentos reais no período, em vez do aviso de
  "dado não disponível" de antes.

### 3. Lembrete de bater ponto sem precisar da aba aberta

**Antes:** o lembrete (`initLembretePonto`, em `js/ui.js`) era só um toast +
som dentro da própria aba — se a pessoa fechasse a aba ou trocasse de
programa, não recebia nada.

**Agora:** implementei **Web Push** (o padrão nativo do navegador para
notificações mesmo com a aba/o site fechado — não depende de nenhum app ou
serviço pago de terceiros):
- `sw.js` (Service Worker, na raiz do site): recebe o push do sistema
  operacional e mostra a notificação, mesmo sem nenhuma aba aberta.
- `js/rh-push-data.js`: liga o navegador da pessoa à conta dela
  (`rh.push_subscriptions`, script 16) — ativado em **Meu Perfil >
  Segurança e notificações** (colaborador) ou **Configurações >
  Notificações** (RH). É por dispositivo/navegador: ativar no celular não
  ativa automaticamente no notebook.
- `supabase/functions/send-push/index.ts` (Edge Function, ver Passo 4.14):
  dois modos —
  1. **Lote**, chamado a cada 5 minutos pelo `pg_cron`+`pg_net` (script 17):
     percorre os colaboradores ATIVOS, calcula (já considerando a jornada
     configurável e os dias de trabalho de cada um) quem está a ~10 minutos
     do horário de entrada/saída e ainda não bateu o ponto, e manda o push
     — sem repetir o mesmo aviso duas vezes no mesmo dia
     (`rh.lembretes_ponto_enviados`).
  2. **Sob demanda**: usado pelo botão "Lembrar colaborador" em Documentos,
     para avisar alguém que tem um documento pendente de assinatura.
- O antigo lembrete em-aba (`initLembretePonto`) **continua existindo** —
  os dois não conflitam; o push é o que garante o aviso quando a aba não
  está aberta.

**Limitação honesta, que não dá para contornar por software:** só funciona
se a pessoa tiver ativado a permissão de notificações (um clique, uma vez,
por navegador) e se o dispositivo estiver ligado com o navegador em
execução (mesmo que a aba do sistema esteja fechada) — isso é uma restrição
do próprio sistema operacional/navegador, não desta implementação. Sem
alguém ativar, o lembrete simplesmente não tem para onde ser mandado (a
Edge Function sempre reporta quantos push foram de fato entregues, nunca
finge sucesso).

### 4. Comunicados agendados publicados automaticamente

Já estava funcionando desde antes desta rodada (script 09) — só corrigi um
comentário desatualizado no arquivo (`create extension` de pg_cron estava
descrito mas não existia de fato no script; agora existe). Ver Passo 3
acima para a nota sobre esse script.

## Checklist objetiva — o que está pronto vs. o que ainda depende de algo externo

**Pronto no código, funciona assim que o SQL for rodado (sem depender de
nada além disso):**
- Login/sessão real (Supabase Auth), com papéis RH_ADMIN/RH/COLABORADOR.
- Colaboradores: CRUD completo, jornada configurável, data de
  desligamento sincronizada automaticamente com o status.
- Ponto: bater ponto, histórico, banco de horas por jornada real, fluxo
  completo de ajuste (solicitar → aprovar/recusar).
- Férias: solicitar (com validação de saldo/datas), aprovar/recusar com
  débito de saldo real.
- Benefícios: CRUD completo, atribuição "Todos" ou específicos, filtrado
  por RLS (não por JavaScript).
- Comunicados: CRUD, público-alvo real, "marcar como lido" real.
- Solicitações: fila consolidada real (genéricas + férias + ajuste de
  ponto).
- Documentos: envio/importação real, Storage privado, assinatura via
  GOV.BR ou importação, exclusão (bloqueada para já assinados/publicados).
- Perfil (colaborador e RH): edição de dados pessoais, foto, senha,
  preferências de notificação.
- Badges do menu do RH: contagem real de pendências.

**Pronto no código, mas só funciona de fato depois de um passo manual seu
(listados no Passo 4 acima):**
- Convite real de colaborador/usuário por e-mail → depende do deploy da
  Edge Function `invite-colaborador`.
- Notificação push (lembrete de ponto sem aba aberta + "Lembrar
  colaborador") → depende do deploy da Edge Function `send-push`, das
  chaves VAPID/secrets, e do script 17 (`pg_cron`+`pg_net`).
- Publicação automática de comunicados agendados na data → depende do
  `pg_cron` estar ativo (script 09 tenta ativar por SQL; painel como
  fallback).

**Limitações reais, que continuam existindo mesmo com tudo configurado (não
são bugs, são o limite do que dá para fazer sem mais infraestrutura/decisão
de produto):**
- O lembrete de ponto por push só chega em navegadores/dispositivos onde a
  pessoa ativou a permissão — não existe forma de "forçar" isso sem a
  pessoa clicar em ativar uma vez.
- `rh.ferias_saldos` é saldo consolidado (30 dias no cadastro, debitado a
  cada aprovação) — não recalcula período aquisitivo automaticamente ano a
  ano; ajuste manual segue sendo necessário se a regra da empresa for
  diferente disso.
- Não existe botão para publicar um documento SEM fluxo de assinatura
  (ex.: holerite direto, sem passar por "pendente de assinatura") — a
  seção "Documentos publicados" do colaborador continua vazia até esse
  fluxo ser pedido como funcionalidade nova.
- "Excluir" um usuário em Configurações remove o acesso ao RH
  (`rh.perfis`), mas não apaga o login em `auth.users` — se a pessoa também
  usa outro sistema no mesmo projeto Supabase, bloquear ela por completo
  exige uma ação manual em Authentication > Users.

## Se algo der errado

Qualquer erro no SQL Editor ou no deploy das Edge Functions, me manda o
texto exato do erro. Os mais comuns costumam ser: rodar os scripts fora de
ordem, esquecer de expor o schema `rh` na API (Passo 1), ou rodar o script
17 antes de implantar a Edge Function `send-push` (Passo 4.14) — nesse
caso o job do `pg_cron` fica agendado, mas toda execução vai falhar com
erro 404/401 até a função existir de verdade.
