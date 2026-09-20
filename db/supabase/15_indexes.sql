-- BSconta+ RH — índices de performance
-- =============================================================================
-- O schema original cobria as chaves primárias e algumas unique constraints,
-- mas não tinha índice nas colunas mais filtradas pelas telas (colaborador_id
-- em tabelas onde ele não é a PK, e status/data usados em quase toda tela do
-- RH — dashboard, relatórios, ponto do dia, badges do menu). Sem eles, cada
-- consulta dessas faz sequential scan; com poucas dezenas de linhas isso não
-- se nota, mas cresce mal conforme a base de colaboradores/histórico aumenta.
--
-- Idempotente: "create index if not exists".
-- =============================================================================

-- Ponto: a tela do RH e o dashboard consultam "todo mundo, na data de hoje"
-- e também "tudo de um colaborador, ordenado por data" — o unique
-- (colaborador_id, data) já cobre o segundo caso; falta o índice só por data.
create index if not exists idx_ponto_registros_data on rh.ponto_registros (data);

-- Solicitações: filtradas por colaborador (fila do colaborador) e por status
-- (fila do RH, badge do menu).
create index if not exists idx_solicitacoes_colaborador on rh.solicitacoes (colaborador_id);
create index if not exists idx_solicitacoes_status on rh.solicitacoes (status);

-- Férias: mesmo padrão.
create index if not exists idx_ferias_solicitacoes_colaborador on rh.ferias_solicitacoes (colaborador_id);
create index if not exists idx_ferias_solicitacoes_status on rh.ferias_solicitacoes (status);

-- Documentos: filtrados por colaborador, status e prazo (relatório/tela).
create index if not exists idx_documentos_colaborador on rh.documentos (colaborador_id);
create index if not exists idx_documentos_status on rh.documentos (status);
create index if not exists idx_documentos_prazo on rh.documentos (prazo);

-- Benefícios: junção específica por colaborador_id além da PK composta.
create index if not exists idx_beneficios_colaboradores_colaborador on rh.beneficios_colaboradores (colaborador_id);

-- Comunicados: leituras filtradas por colaborador; comunicados filtrados por
-- status (feed do colaborador) e por data_agendada (job do pg_cron).
create index if not exists idx_comunicados_leituras_colaborador on rh.comunicados_leituras (colaborador_id);
create index if not exists idx_comunicados_status on rh.comunicados (status);
create index if not exists idx_comunicados_data_agendada on rh.comunicados (data_agendada) where status = 'AGENDADO';

-- Colaboradores: dashboard/relatórios agrupam e filtram por status e
-- departamento constantemente.
create index if not exists idx_colaboradores_status on rh.colaboradores (status);
create index if not exists idx_colaboradores_departamento on rh.colaboradores (departamento);

-- Perfis: join usado pra listar "usuários do sistema" por colaborador.
create index if not exists idx_perfis_colaborador on rh.perfis (colaborador_id);
