# Sistema de Gestão de Colaboradores e RH — BSconta+

Protótipo visual navegável, construído em HTML/CSS/JS puro (sem framework),
na mesma identidade visual do SGCMP (sistema comercial): tokens de cor,
tipografia (Inter), cartões, tabelas e botões compartilhados — ver
`css/styles.css`.

## Status: todas as telas planejadas estão prontas

Esta entrega completa o conjunto de telas combinado no chat. Tudo abaixo já
existe e está navegável a partir do login.

### Login
- `login.html` — identidade BSconta+, mostrar/ocultar senha, "lembrar-me",
  estado de carregamento, e dois atalhos de demonstração ("Ver como
  Colaborador" / "Ver como RH") além do formulário real.

### Portal do Colaborador (pasta `colaborador/`)
- **Dashboard** — saudação, indicadores (banco de horas, dias de férias,
  solicitações abertas, comunicados não lidos), jornada de hoje, próximas
  férias, prévia de solicitações e comunicados, atalhos.
- **Meu Perfil** — abas Pessoal/Profissional, edição inline dos dados
  pessoais (incluindo CEP).
- **Ponto / Jornada** — aba "Hoje" (registro do dia com local do ponto —
  Home Office ou presencial — banco de horas em anel de progresso) e aba
  "Histórico" (filtros por dia/semana/mês/período personalizado, calendário
  visual com indicadores de status, tabela detalhada com local e marcação de
  alterações feitas pelo RH).
- **Férias** — saldo, próximas férias, modal de solicitação, histórico com
  status.
- **Holerites e Documentos** — filtro por ano/tipo, tabela de documentos com
  download (simulado).
- **Benefícios** — cartões dos benefícios ativos com detalhes.
- **Solicitações ao RH** — nova solicitação (modal), filtro por status,
  acompanhamento de protocolo.
- **Comunicados** — lista com destaque de urgentes, marcar como lido.

### Portal do RH (pasta `rh/`)
- **Dashboard** — indicadores gerais, colaboradores por departamento,
  aniversariantes do mês, solicitações pendentes (aprovar/recusar), férias
  próximas, atalhos.
- **Colaboradores** — busca, filtros, paginação, modal de novo cadastro.
- **Férias** — indicadores, filtros por status, alternância lista/calendário,
  aprovar/recusar.
- **Jornada / Ponto** — aba "Hoje" (indicadores do dia — em dia, atrasos,
  faltas, home office, presencial, banco negativo — filtros e tabela da
  equipe com local de cada registro) e aba "Histórico por colaborador"
  (seletor de colaborador, calendário e tabela detalhada iguais aos do
  colaborador).
- **Documentos** — indicadores, filtros, modal de envio de documento,
  cobrança de pendências.
- **Solicitações** — indicadores, filtros (categoria/status/prioridade),
  resposta com modal, histórico de respostas por protocolo.
- **Comunicados** — indicadores, novo comunicado (modal com público-alvo,
  agendamento, marcação de urgente), editar/arquivar.
- **Relatórios** — 5 relatórios (colaboradores, férias, solicitações,
  documentos, jornada), com seleção de período e geração de conteúdo.
- **Configurações** — abas "Minha conta", "Usuários e permissões" (ativar/
  desativar acesso) e "Notificações" (preferências).

### Componentes reutilizáveis
Sidebar responsiva (colapsa em navegação inferior no celular), cabeçalho com
notificações e menu do usuário, badges de contagem no menu (férias/
solicitações/documentos pendentes), tabs, modal, toast, empty state, badges
de status, anel de progresso (SVG), paginação, filtros.

Testado em desktop (1440px) e celular (390px) com um script Playwright — sem
erros de console em nenhuma das 17 páginas internas. Capturas em
`Claude outputs/`.

## Revisão completa de UI/UX (concluída)

A pedido do cliente, todo o sistema passou por uma revisão de design como um
todo — não apenas ajustes pontuais. As mudanças ficam concentradas em
`css/styles.css` (o design system compartilhado por todas as 19 páginas), o
que garante que a experiência seja consistente em qualquer tela:

- **Contraste e legibilidade**: os tons de texto secundário (`--text-soft`,
  `--text-faint`) foram escurecidos para atender melhor aos padrões de
  contraste, sem perder a leveza visual.
- **Hierarquia tipográfica**: títulos de página maiores e com mais respiro
  (`h1.page-title`), subtítulos com mais espaçamento, títulos de cartão mais
  destacados.
- **Espaçamento e proporção**: mais "ar" entre blocos de conteúdo, cartões com
  padding mais generoso, células de tabela com mais respiro vertical, grade
  com gutters um pouco maiores — sem perder densidade de informação.
- **Elevação e profundidade**: sombras recalibradas (mais suaves em repouso,
  mais presentes no hover) para dar uma sensação mais "premium" sem exagerar.
- **Efeitos e microinterações**: cartões e botões reagem ao passar o mouse
  (elevação sutil) e ao clicar (leve compressão); ícones do menu lateral
  deslizam de leve no hover; o sininho de notificações não lidas pulsa
  suavemente; o conteúdo de cada página entra com uma animação sutil de
  fade+slide ao carregar; modais e toasts ganharam uma transição de entrada
  mais suave (leve blur no fundo do modal). Todas as animações respeitam
  `prefers-reduced-motion`.
- **Acessibilidade de foco**: todo elemento interativo (botões, links, abas,
  itens de menu) agora tem um contorno de foco visível e consistente ao
  navegar pelo teclado.
- **Consistência de componentes**: badges, ícones em cartões de indicador
  (KPI) e botões seguem tamanhos e paddings padronizados entre os dois
  portais (colaborador e RH).
- **Correções encontradas durante a revisão**: um card do dashboard do RH
  ("Jornada de hoje") causava rolagem horizontal indevida da página inteira
  em tablet e celular — corrigido, e o layout das 3 colunas dessa seção foi
  reequilibrado para caber melhor o conteúdo de cada cartão. Também foi
  corrigido um ícone de "Lido" nos comunicados do colaborador que renderizava
  enorme e quebrado por falta de uma regra de tamanho — agora aparece do
  tamanho correto, alinhado ao texto. Foi adicionada uma salvaguarda de CSS
  para evitar que esse tipo de problema (ícone sem regra de tamanho) volte a
  acontecer em qualquer tela.
- **Responsividade**: reconferido em desktop (1440px), tablet (~820px) e
  celular (390px) nas 18 páginas internas dos dois portais — sem rolagem
  horizontal indevida e sem textos cortados em nenhuma combinação testada.

## Verificação de navegação e funcionamento (concluída)

A pedido do cliente, todo o sistema foi testado ponta a ponta para garantir
que está completamente navegável e funcional — não apenas visualmente, mas
em cada interação. Foram conferidos automaticamente (script) e manualmente:

- **Login**: o link "Esqueci minha senha" responde corretamente (mostra a
  orientação de contato com o RH/administrador); mostrar/ocultar senha e os
  atalhos de demonstração funcionam.
- **Cabeçalho e menu lateral** (nos dois portais): o menu do usuário na
  barra lateral e no topo abre/fecha corretamente (inclusive ao clicar fora
  dele), o sino de notificações abre seu painel, e "Sair" encerra a sessão e
  volta para o login — testado em Colaborador e RH.
- **Todos os modais do sistema** (cadastrar colaborador, enviar documento,
  convidar usuário, solicitar férias, nova solicitação, novo comunicado,
  responder solicitação): abrem, fecham ao clicar fora, fecham pelo "X"/
  "Cancelar", e o envio do formulário dá a confirmação esperada (toast) e
  fecha o modal.
- **Abas**: Ponto (Hoje/Histórico, colaborador e RH), Meu Perfil (Pessoal/
  Profissional) e Configurações (Minha conta/Usuários/Notificações) trocam
  de conteúdo corretamente ao clicar.
- **Filtros e paginação**: filtros de comunicados (Todos/Não lidos/
  Urgentes), filtros e alternância lista/calendário de férias, busca e
  filtros de colaboradores (nome, departamento, status) e a paginação da
  lista de colaboradores — tudo atualiza a lista corretamente.
- **Ações da equipe de RH**: aprovar/recusar solicitações de férias e do
  dashboard, responder solicitações, arquivar comunicados, ativar/
  desativar usuário — todas dão o retorno visual esperado (toast +
  atualização da lista/linha).
- **Downloads simulados e geração de relatórios**: botões respondem com a
  confirmação esperada.
- **Navegação mobile**: a barra inferior de navegação (celular) leva
  corretamente a cada tela em ambos os portais.
- **Nenhum link, botão ou item de menu "morto"** foi encontrado — todo
  elemento clicável do sistema faz algo (navega, abre um modal, filtra,
  muda de aba, ou mostra uma confirmação).

Alguns poucos botões — "Ver perfil" detalhado do colaborador (RH), "Editar
informações"/"Alterar senha" (Configurações) e "Editar" de um comunicado já
publicado — mostram um aviso claro de "em construção no protótipo" em vez
de abrir uma tela nova. Isso é intencional nesta fase: são telas que
dependeriam de mais definição de regras de negócio (edição de dados
sensíveis, fluxo de troca de senha, edição de conteúdo já publicado) e
ficam propositalmente como um retorno honesto ao usuário, em vez de um
botão que não faz nada — o mesmo padrão já usado em outras partes do
protótipo. Se desejar, essas telas podem ser detalhadas em uma próxima
etapa.

Nenhum erro de console ou de JavaScript foi encontrado durante os testes,
em nenhuma das páginas ou interações.

## Fase 1 — melhorias no controle de ponto (concluída)

A pedido do cliente, o módulo de ponto passou por uma revisão de UX e ganhou
os seguintes recursos (primeira das 3 fases combinadas — histórico/espelho
com assinatura é a Fase 2, correção de ponto com aprovação do RH é a Fase 3):

- **Local do registro**: no primeiro ponto do dia, o colaborador informa se
  está em Home Office ou presencial. O sistema tenta detectar a localização
  automaticamente via geolocalização do navegador (`navigator.geolocation`)
  e sugere a opção mais provável comparando a distância até a sede da
  empresa (fórmula de Haversine, 100% no cliente, sem depender de nenhuma
  API paga de geocodificação) — mas o colaborador sempre confirma ou
  corrige a sugestão antes de registrar. O local escolhido aparece em
  badges no dashboard, na tela de ponto e para o RH.
- **Alerta de ponto**: um aviso visual (toast) e um som curto e discreto
  disparam automaticamente 10 minutos antes dos horários previstos de
  entrada/saída, tanto no dashboard quanto na tela de ponto. É um mecanismo
  de protótipo (funciona apenas com a aba aberta); notificações push reais
  exigiriam um backend com service worker.
- **Histórico completo com calendário**: nova aba "Histórico" com filtros
  por dia, semana, mês e período personalizado, calendário mensal com
  indicadores de status (completo, atraso, falta, hora extra, alterado
  pelo RH) e uma tabela detalhada (entrada, saída, intervalos, horas
  trabalhadas, horas extras, atrasos, local e status), disponível tanto
  para o colaborador (seus próprios registros) quanto para o RH (histórico
  de qualquer colaborador da equipe, com seletor dedicado).
- **CEP no perfil**: o campo CEP foi adicionado à visualização e à edição
  de dados pessoais do colaborador.
- **Redesign visual**: ajustes de hierarquia, espaçamento e tipografia nas
  telas de dashboard (novos indicadores: próximo horário, status do ponto,
  horas trabalhadas hoje, horas na semana, banco de horas) e no painel do
  RH (indicador de jornada do dia com contagem de home office vs.
  presencial).

Os itens de **assinatura digital do espelho de ponto** (colaborador e RH) e
de **solicitação/aprovação de correção de ponto com trilha de auditoria**
ainda não foram implementados — ficam para as Fases 2 e 3, a serem
desenvolvidas e revisadas em conjunto com o cliente após a validação desta
primeira etapa.

## O que é fictício (protótipo, sem backend)

Todos os nomes, CPF, valores e históricos em `js/demo-data.js` são
inventados. O "login" apenas grava o perfil escolhido em `sessionStorage`
(memória da aba) para a navegação entre páginas funcionar — não há
autenticação real, banco de dados ou validação de permissão no servidor.
Ações como aprovar/recusar férias, responder solicitações, publicar
comunicados etc. alteram os dados apenas em memória (na aba aberta) e não
persistem entre sessões.

## Próximos passos

1. **Backend real**: criar um **novo projeto Supabase dedicado** (separado do
   projeto comercial `zqhuhaqothpxusnaijog`, por lidar com dados sensíveis —
   CPF, saúde, holerites), com tabelas de colaboradores, jornada, férias,
   documentos, solicitações e comunicados, autenticação real e políticas de
   permissão (RLS) — colaborador só vê os próprios dados; RH vê tudo conforme
   seu papel.
2. **Reforçar o controle de acesso no backend**, nunca apenas na interface
   (mesmo princípio já registrado na integração RD Station/Agenda): mesmo que
   uma tela esconda um botão, a API/RLS deve recusar a ação para quem não tem
   permissão.
3. Substituir `js/demo-data.js` pelas chamadas reais ao Supabase (leitura e
   escrita), incluindo upload de documentos e envio de e-mails de convite.
4. Implementar as regras de negócio que hoje são apenas simuladas: cálculo
   real de banco de horas, cálculo de saldo de férias por admissão, geração
   de holerite, etc.
