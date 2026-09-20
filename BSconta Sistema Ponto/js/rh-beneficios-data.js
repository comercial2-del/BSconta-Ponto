/*
 * BSconta+ Benefícios — camada de dados REAL (Supabase: rh.beneficios +
 * rh.beneficios_colaboradores)
 * =============================================================================
 * Substitui DEMO.beneficios (js/demo-data.js, em memória) pelas tabelas de
 * verdade no banco.
 *
 * RLS relevante (ver db/supabase/01_schema_rh.sql):
 *   - Colaborador só LÊ (nunca cria/edita/exclui) — a política "select
 *     proprios beneficios" já filtra no banco: aparece o que é
 *     atribuicao_tipo = 'TODOS' OU o que tiver uma linha em
 *     rh.beneficios_colaboradores pra ele. Ou seja, um simples
 *     `select("*")` como colaborador já vem filtrado — não precisa repetir
 *     esse filtro no cliente (diferente do protótipo antigo, que filtrava
 *     em JS por nome).
 *   - Só RH/RH_ADMIN (rh.is_rh_staff()) pode criar/editar/excluir
 *     benefícios e gerenciar quem recebe (rh.beneficios_colaboradores).
 */

function rhMapBeneficioColaborador(row) {
  return {
    id: row.id,
    nome: row.nome,
    desc: row.descricao,
    icon: row.icon,
    tone: row.tone,
    status: row.status,
  };
}

/** Visão do colaborador — RLS já devolve só os benefícios dele (TODOS +
 * os atribuídos especificamente a ele). */
async function rhCarregarBeneficiosColaborador() {
  const { data, error } = await sb.from("beneficios").select("*").order("nome");
  if (error) throw error;
  return (data || []).map(rhMapBeneficioColaborador);
}

/** Visão do RH — todos os benefícios, com a lista de colaboradores
 * atribuídos (quando atribuicao_tipo = ESPECIFICO), via join. */
async function rhCarregarBeneficiosRH() {
  const { data, error } = await sb
    .from("beneficios")
    .select("*, beneficios_colaboradores(colaborador:colaboradores(id,nome))")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((row) => {
    const colaboradores = (row.beneficios_colaboradores || []).map((bc) => bc.colaborador).filter(Boolean);
    return {
      id: row.id,
      nome: row.nome,
      desc: row.descricao,
      icon: row.icon,
      tone: row.tone,
      status: row.status,
      atribuicao:
        row.atribuicao_tipo === "ESPECIFICO"
          ? { tipo: "ESPECIFICO", colaboradorIds: colaboradores.map((c) => c.id), nomes: colaboradores.map((c) => c.nome) }
          : { tipo: "TODOS" },
    };
  });
}

/** Lista de colaboradores (id + nome) pra montar o checklist de atribuição
 * específica — RH_STAFF lê todos via a política "rh_staff all - colaboradores". */
async function rhListarColaboradoresParaAtribuicao() {
  const { data, error } = await sb.from("colaboradores").select("id, nome").eq("status", "ATIVO").order("nome");
  if (error) throw error;
  return data || [];
}

/** Cria ou atualiza um benefício (e a lista de quem o recebe, quando
 * específico). `id` ausente = criar; presente = atualizar. */
async function rhSalvarBeneficio({ id, nome, descricao, icon, tone, status, atribuicaoTipo, colaboradorIds }) {
  const payload = {
    nome,
    descricao,
    icon,
    tone,
    status,
    atribuicao_tipo: atribuicaoTipo,
    updated_at: new Date().toISOString(),
  };

  let beneficioId = id;
  if (id) {
    const { error } = await sb.from("beneficios").update(payload).eq("id", id);
    if (error) throw error;
  } else {
    const { data, error } = await sb.from("beneficios").insert(payload).select().single();
    if (error) throw error;
    beneficioId = data.id;
  }

  // Refaz do zero a lista de atribuição específica (mais simples e seguro
  // que calcular diff, e o volume de linhas por benefício é pequeno).
  const { error: delErr } = await sb.from("beneficios_colaboradores").delete().eq("beneficio_id", beneficioId);
  if (delErr) throw delErr;

  if (atribuicaoTipo === "ESPECIFICO" && colaboradorIds && colaboradorIds.length) {
    const linhas = colaboradorIds.map((colaboradorId) => ({ beneficio_id: beneficioId, colaborador_id: colaboradorId }));
    const { error: insErr } = await sb.from("beneficios_colaboradores").insert(linhas);
    if (insErr) throw insErr;
  }

  return beneficioId;
}

async function rhExcluirBeneficio(id) {
  const { error } = await sb.from("beneficios").delete().eq("id", id);
  if (error) throw error;
  return true;
}
