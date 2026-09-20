/*
 * BSconta+ Solicitações — camada de dados REAL (Supabase: rh.solicitacoes)
 * =============================================================================
 * Substitui DEMO.solicitacoesColaborador / DEMO.rhSolicitacoesTodas
 * (js/demo-data.js, em memória) pela fila de verdade no banco.
 *
 * A fila geral do RH (rh/solicitacoes.html) precisa CONSOLIDAR, numa
 * consulta só, tipos que vivem em tabelas diferentes: as solicitações
 * "genéricas" (Dúvidas, Documentos, Benefícios, Ajuste de ponto, Outros —
 * tudo em rh.solicitacoes) e as de Férias (rh.ferias_solicitacoes, que tem
 * seu próprio fluxo real de aprovação em js/rh-ferias-data.js, com débito
 * de saldo). rhCarregarSolicitacoesRH() abaixo faz essa junção no cliente
 * (duas queries + merge), já que são tabelas diferentes — e devolve os dois
 * tipos com um formato comum pra lista, mas cada um mantém a ação real que
 * faz sentido pra ele (Responder/Resolver para geral e Ajuste de ponto;
 * Aprovar/Recusar para Férias, chamando rhResolverFerias de verdade).
 *
 * RLS relevante (ver db/supabase/01_schema_rh.sql):
 *   - Colaborador só LÊ as próprias solicitações e só INSERE com
 *     status = 'PENDENTE' (não pode responder a si mesmo nem mudar status).
 *   - Só RH/RH_STAFF lê/responde as de todo mundo.
 */

function rhGerarProtocoloSolicitacao() {
  return `SOL-${Date.now().toString(36).toUpperCase()}`;
}

function rhHojeIsoSolic() {
  return new Date().toISOString().slice(0, 10);
}

function rhMapSolicitacaoGeral(row) {
  return {
    id: row.id,
    origem: "geral",
    protocolo: row.protocolo,
    categoria: row.categoria,
    descricao: row.descricao,
    status: row.status,
    prioridade: row.prioridade,
    data: row.created_at?.slice(0, 10),
    respostas: row.respostas || [],
    ajustePonto: row.ajuste_ponto || null,
    colaboradorId: row.colaborador_id,
    colaborador: row.colaborador?.nome || "—",
  };
}

function rhMapFeriasComoSolicitacao(row) {
  const statusExibicao = { PENDENTE: "PENDENTE", EM_ANALISE: "EM_ANALISE", APROVADA: "RESOLVIDA", RECUSADA: "RECUSADA" }[row.status] || row.status;
  return {
    id: row.id,
    origem: "ferias",
    protocolo: row.protocolo,
    categoria: "Solicitação de férias",
    descricao: `Férias de ${row.inicio} a ${row.fim} (${row.dias} dia${row.dias === 1 ? "" : "s"})${row.observacoes ? " — " + row.observacoes : ""}`,
    status: row.status, // status real da tabela de férias (PENDENTE/APROVADA/RECUSADA)
    statusExibicao, // mapeado pra combinar com os filtros da fila geral
    prioridade: "normal",
    data: row.solicitado_em,
    respostas: [],
    ajustePonto: null,
    colaboradorId: row.colaborador_id,
    colaborador: row.colaborador?.nome || "—",
  };
}

/** Colaborador: só as próprias solicitações "genéricas" (não inclui
 * férias — essas ficam em colaborador/ferias.html, que já tem o fluxo
 * completo com datas e saldo). */
async function rhCarregarSolicitacoesColaborador(colaboradorId) {
  const { data, error } = await sb.from("solicitacoes").select("*").eq("colaborador_id", colaboradorId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(rhMapSolicitacaoGeral);
}

async function rhCriarSolicitacaoGeral({ colaboradorId, categoria, descricao }) {
  if (!categoria) throw new Error("Selecione uma categoria.");
  if (!descricao || !descricao.trim()) throw new Error("Descreva sua solicitação.");
  const payload = {
    protocolo: rhGerarProtocoloSolicitacao(),
    colaborador_id: colaboradorId,
    categoria,
    descricao: descricao.trim(),
    status: "PENDENTE",
    prioridade: "normal",
  };
  const { data, error } = await sb.from("solicitacoes").insert(payload).select().single();
  if (error) throw error;
  return rhMapSolicitacaoGeral(data);
}

/** RH: fila consolidada — junta rh.solicitacoes (geral + ajuste de ponto)
 * com rh.ferias_solicitacoes (férias), cada um já com o nome do
 * colaborador via join. */
async function rhCarregarSolicitacoesRH() {
  const [{ data: geraisRows, error: geraisErr }, { data: feriasRows, error: feriasErr }] = await Promise.all([
    sb.from("solicitacoes").select("*, colaborador:colaboradores(nome)").order("created_at", { ascending: false }),
    sb.from("ferias_solicitacoes").select("*, colaborador:colaboradores(nome)").order("created_at", { ascending: false }),
  ]);
  if (geraisErr) throw geraisErr;
  if (feriasErr) throw feriasErr;

  const gerais = (geraisRows || []).map(rhMapSolicitacaoGeral);
  const ferias = (feriasRows || []).map(rhMapFeriasComoSolicitacao);
  return [...gerais, ...ferias].sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
}

/** RH responde uma solicitação "geral" (inclui Ajuste de ponto) — grava a
 * resposta de verdade em respostas (jsonb) e atualiza o status. Quando é
 * "Ajuste de ponto" e o RH marcou como resolvida, quem aplica a correção
 * real no ponto é rhResolverAjustePonto (js/rh-ponto-data.js) — chamado
 * pela própria tela, não por aqui, pra manter uma só fonte de verdade
 * pra essa regra (a mesma usada em rh/ponto.html). */
async function rhResponderSolicitacaoGeral(id, { texto, autor, novoStatus }) {
  const { data: atual, error: getErr } = await sb.from("solicitacoes").select("respostas").eq("id", id).single();
  if (getErr) throw getErr;
  const respostas = [...(atual.respostas || []), { autor, texto, data: rhHojeIsoSolic() }];
  const { error } = await sb.from("solicitacoes").update({ respostas, status: novoStatus }).eq("id", id);
  if (error) throw error;
  return true;
}

/** Exclui definitivamente uma solicitação da fila (RH/RH_ADMIN). `origem`
 * diz de qual tabela apagar: "ferias" -> rh.ferias_solicitacoes, qualquer
 * outra coisa (inclusive "geral") -> rh.solicitacoes. Não há como desfazer. */
async function rhExcluirSolicitacao(id, origem) {
  const tabela = origem === "ferias" ? "ferias_solicitacoes" : "solicitacoes";
  const { error } = await sb.from(tabela).delete().eq("id", id);
  if (error) throw error;
  return true;
}
