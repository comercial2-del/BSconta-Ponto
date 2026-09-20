-- BSconta+ RH — coluna extra para observações na solicitação de férias
-- =============================================================================
-- Aditivo, idempotente (ADD COLUMN IF NOT EXISTS) — não apaga nem altera
-- nada que já existe. Necessário para o campo "Observações (opcional)" do
-- formulário "Solicitar férias" (colaborador/ferias.html) ser gravado de
-- verdade em vez de ser só cosmético.

alter table rh.ferias_solicitacoes
  add column if not exists observacoes text;
