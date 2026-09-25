-- =============================================================================
-- 25 — Documentos: RH pode ARQUIVAR documentos (e excluir depois de arquivar)
-- =============================================================================
-- * arquivado_rh_em: quando o RH arquivou o documento na tela de Gestão de
--   Documentos (null = ativo). Arquivar não muda nada para o colaborador.
-- * O RH já tem UPDATE/DELETE em rh.documentos pelo RLS (is_rh_staff), então
--   não precisa de função nova: a tela grava direto nessa coluna.
-- * Exclusão de documento assinado/publicado só é liberada na tela depois de
--   arquivado (dupla etapa, para evitar apagar registro por engano).
-- Idempotente: pode rodar mais de uma vez.
-- =============================================================================

alter table rh.documentos add column if not exists arquivado_rh_em timestamptz;
comment on column rh.documentos.arquivado_rh_em is 'Quando o RH arquivou o documento na Gestão de Documentos (null = ativo). Não afeta a visão do colaborador.';

notify pgrst, 'reload schema';
