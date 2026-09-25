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

// =============================================================================
// Benefícios unificados (db/supabase/26_beneficios_competencias.sql)
// -----------------------------------------------------------------------------
// Formato usado pelas telas (rh/beneficios.html e colaborador/beneficios.html):
//   { id, nome, categoria, icon, tone, status, descricao,
//     publico: "TODOS" | "ESPECIFICO", colaboradores: [ids],
//     fixos:   { colaboradorId: valor },
//     valores: { colaboradorId: { "aaaa-mm": { valor, desconto, lancado } } } }
// =============================================================================

function rhCompetenciaAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function rhErroMigracao26(err) {
  const msg = String(err?.message || err || "");
  if (/beneficio_competencias|beneficio_valores_fixos|categoria|schema cache/i.test(msg)) {
    return "A nova estrutura de benefícios ainda não está no banco. Rode db/supabase/26_beneficios_competencias.sql no Supabase.";
  }
  return typeof rhMensagemErroSupabase === "function" ? rhMensagemErroSupabase(err) : msg;
}

function rhMontarBeneficios(rows, fixosRows, compRows) {
  const porId = {};
  (rows || []).forEach((row) => {
    porId[row.id] = {
      id: row.id,
      nome: row.nome,
      categoria: row.categoria || "OUTROS",
      icon: row.icon || "heart",
      tone: row.tone || "indigo",
      status: row.status === "INATIVO" ? "INATIVO" : "ATIVO",
      descricao: row.descricao || "",
      publico: row.atribuicao_tipo === "ESPECIFICO" ? "ESPECIFICO" : "TODOS",
      colaboradores: (row.beneficios_colaboradores || []).map((bc) => bc.colaborador_id).filter(Boolean),
      fixos: {},
      valores: {},
    };
  });
  (fixosRows || []).forEach((f) => { const b = porId[f.beneficio_id]; if (b) b.fixos[f.colaborador_id] = Number(f.valor) || 0; });
  (compRows || []).forEach((c) => {
    const b = porId[c.beneficio_id]; if (!b) return;
    b.valores[c.colaborador_id] = b.valores[c.colaborador_id] || {};
    b.valores[c.colaborador_id][c.competencia] = { valor: Number(c.valor) || 0, desconto: Number(c.desconto) || 0, lancado: !!c.lancado };
  });
  return Object.values(porId);
}

/** RH: todos os benefícios com público, valores fixos e competências. */
async function rhCarregarBeneficiosUnificados() {
  const [b, f, c] = await Promise.all([
    sb.from("beneficios").select("*, beneficios_colaboradores(colaborador_id)").order("created_at", { ascending: false }),
    sb.from("beneficio_valores_fixos").select("beneficio_id, colaborador_id, valor"),
    sb.from("beneficio_competencias").select("beneficio_id, colaborador_id, competencia, valor, desconto, lancado"),
  ]);
  if (b.error) throw b.error;
  if (f.error) throw f.error;
  if (c.error) throw c.error;
  return rhMontarBeneficios(b.data, f.data, c.data);
}

/** Colaborador: só o que é dele (o RLS já filtra benefícios, fixos e competências). */
async function rhCarregarMeusBeneficios(colaboradorId) {
  const [b, f, c] = await Promise.all([
    sb.from("beneficios").select("*").order("nome"),
    sb.from("beneficio_valores_fixos").select("beneficio_id, colaborador_id, valor").eq("colaborador_id", colaboradorId),
    sb.from("beneficio_competencias").select("beneficio_id, colaborador_id, competencia, valor, desconto, lancado").eq("colaborador_id", colaboradorId),
  ]);
  if (b.error) throw b.error;
  if (f.error) throw f.error;
  if (c.error) throw c.error;
  return rhMontarBeneficios(b.data, f.data, c.data);
}

/** RH: salva o benefício inteiro (catálogo + público + fixos + competências).
 * `original` = como estava antes de editar (null ao criar) — usado para
 * apagar só as competências que o RH removeu no rascunho. */
async function rhSalvarBeneficioUnificado(b, original) {
  const payload = {
    nome: b.nome.trim(),
    descricao: b.descricao || null,
    icon: b.icon || "heart",
    tone: b.tone || "indigo",
    status: b.status,
    categoria: b.categoria || "OUTROS",
    atribuicao_tipo: b.publico,
    updated_at: new Date().toISOString(),
  };
  let id = b.id;
  if (id) {
    const { error } = await sb.from("beneficios").update(payload).eq("id", id);
    if (error) throw error;
  } else {
    const { data, error } = await sb.from("beneficios").insert(payload).select("id").single();
    if (error) throw error;
    id = data.id;
  }

  // Público específico: refaz a lista.
  const { error: delAt } = await sb.from("beneficios_colaboradores").delete().eq("beneficio_id", id);
  if (delAt) throw delAt;
  if (b.publico === "ESPECIFICO" && b.colaboradores.length) {
    const { error } = await sb.from("beneficios_colaboradores").insert(b.colaboradores.map((c) => ({ beneficio_id: id, colaborador_id: c })));
    if (error) throw error;
  }

  // Valores fixos: refaz a lista.
  const { error: delFx } = await sb.from("beneficio_valores_fixos").delete().eq("beneficio_id", id);
  if (delFx) throw delFx;
  const fixos = Object.entries(b.fixos || {}).filter(([, v]) => Number(v) > 0).map(([colaborador_id, valor]) => ({ beneficio_id: id, colaborador_id, valor: Number(valor) }));
  if (fixos.length) {
    const { error } = await sb.from("beneficio_valores_fixos").insert(fixos);
    if (error) throw error;
  }

  // Competências: upsert do que existe no rascunho; apaga só o que foi removido.
  const linhas = [];
  Object.entries(b.valores || {}).forEach(([colaborador_id, meses]) => {
    Object.entries(meses || {}).forEach(([competencia, l]) => {
      linhas.push({
        beneficio_id: id, colaborador_id, competencia,
        valor: Number(l.valor) || 0,
        desconto: Math.min(Number(l.desconto) || 0, Number(l.valor) || 0),
        lancado: !!l.lancado,
        lancado_em: l.lancado ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      });
    });
  });
  if (linhas.length) {
    const { error } = await sb.from("beneficio_competencias").upsert(linhas, { onConflict: "beneficio_id,colaborador_id,competencia" });
    if (error) throw error;
  }
  if (original) {
    const removidas = [];
    Object.entries(original.valores || {}).forEach(([colab, meses]) => Object.keys(meses || {}).forEach((k) => { if (!b.valores?.[colab]?.[k]) removidas.push({ colab, k }); }));
    for (const r of removidas) {
      const { error } = await sb.from("beneficio_competencias").delete().eq("beneficio_id", id).eq("colaborador_id", r.colab).eq("competencia", r.k);
      if (error) throw error;
    }
  }
  return id;
}

/** RH: lança (marca como pago) valores de uma competência. `itens` =
 * [{ colaboradorId, valor, desconto }]. */
async function rhLancarCompetenciaBeneficio(beneficioId, competencia, itens) {
  const agora = new Date().toISOString();
  const linhas = itens.map((i) => ({
    beneficio_id: beneficioId, colaborador_id: i.colaboradorId, competencia,
    valor: Number(i.valor) || 0, desconto: Math.min(Number(i.desconto) || 0, Number(i.valor) || 0),
    lancado: true, lancado_em: agora, updated_at: agora,
  }));
  const { error } = await sb.from("beneficio_competencias").upsert(linhas, { onConflict: "beneficio_id,colaborador_id,competencia" });
  if (error) throw error;
}

async function rhDefinirStatusBeneficio(id, status) {
  const { error } = await sb.from("beneficios").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}
