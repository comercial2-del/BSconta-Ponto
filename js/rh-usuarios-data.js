/*
 * BSconta+ Configurações > Usuários e permissões — camada de dados REAL
 * (Supabase: rh.perfis)
 * =============================================================================
 * Substitui DEMO.rhUsuarios (js/demo-data.js, em memória) pela tabela de
 * verdade que já controla o acesso ao sistema.
 *
 * RLS relevante (ver db/supabase/01_schema_rh.sql +
 * db/supabase/12_perfis_usuarios_extra.sql):
 *   - Só RH_ADMIN (rh.is_rh_admin()) tem SELECT/INSERT/UPDATE/DELETE em
 *     TODAS as linhas de rh.perfis (política "rh_admin all"). Um RH comum
 *     (não-admin) só vê a PRÓPRIA linha — por isso a tela só mostra a
 *     lista completa e as ações de gerenciar pra quem é RH_ADMIN de
 *     verdade; não é uma trava de interface, é o próprio banco devolvendo
 *     menos linhas pra quem não é admin.
 *   - "Desativar" um usuário aqui bloqueia o login de verdade (checado em
 *     requireRoleReal, js/rh-supabase-auth.js) — não é só um badge visual.
 *   - "Excluir" remove o ACESSO ao sistema (a linha de rh.perfis), mas não
 *     apaga o login em auth.users — isso exige a chave de administrador do
 *     Supabase e precisa ser feito manualmente em Authentication > Users
 *     se a intenção for também impedir a pessoa de fazer login em outros
 *     sistemas que compartilhem este mesmo projeto.
 */

function rhMapUsuarioPerfil(row) {
  return {
    userId: row.user_id,
    nome: row.colaborador?.nome || row.nome || "(sem nome)",
    email: row.colaborador?.email || row.email || "—",
    papel: row.role,
    ativo: row.ativo !== false,
    colaboradorId: row.colaborador_id,
    preferenciasNotificacao: row.preferencias_notificacao || {},
  };
}

/** RH_ADMIN: lista todos os usuários com acesso. Para quem não é
 * RH_ADMIN, o RLS já devolve só a própria linha — a tela decide o que
 * mostrar com isso (ver rh/configuracoes.html). */
async function rhListarUsuarios() {
  const { data, error } = await sb.from("perfis").select("*, colaborador:colaboradores(nome,email)").order("nome");
  if (error) throw error;
  return (data || []).map(rhMapUsuarioPerfil);
}

async function rhAtualizarUsuario(userId, { nome, email, papel }) {
  const { error } = await sb.from("perfis").update({ nome, email, role: papel }).eq("user_id", userId);
  if (error) throw error;
  return true;
}

async function rhToggleAtivoUsuario(userId, ativo) {
  const { error } = await sb.from("perfis").update({ ativo }).eq("user_id", userId);
  if (error) throw error;
  return true;
}

async function rhExcluirUsuario(userId) {
  const { error } = await sb.from("perfis").delete().eq("user_id", userId);
  if (error) throw error;
  return true;
}

/** Convida uma conta de ACESSO ao sistema (não um colaborador do RH — usa
 * a mesma Edge Function do convite de colaborador, mas com
 * criarColaborador:false, então não cria linha em rh.colaboradores). */
async function rhConvidarUsuarioSistema({ nome, email, papel }) {
  return rhConvidarColaborador({ nome, email, role: papel, criarColaborador: false });
}

/** Qualquer usuário logado salva as PRÓPRIAS preferências de notificação
 * (RPC — ver db/supabase/12_perfis_usuarios_extra.sql). */
async function rhSalvarPreferenciasNotificacao(prefs) {
  const { error } = await sb.rpc("usuario_atualizar_preferencias_notificacao", { p_prefs: prefs });
  if (error) throw error;
  return true;
}

/** Troca a própria senha — funciona com a sessão atual, sem precisar de
 * privilégio de administrador (padrão do Supabase Auth). */
async function rhAlterarSenhaPropria(novaSenha) {
  if (!novaSenha || novaSenha.length < 6) throw new Error("A nova senha precisa ter pelo menos 6 caracteres.");
  const { error } = await sb.auth.updateUser({ password: novaSenha });
  if (error) throw error;
  return true;
}
