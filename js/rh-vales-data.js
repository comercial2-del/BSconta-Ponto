/*
 * BSconta+ Vale-refeição, Vale-transporte e Gratificações — camada de dados
 * =============================================================================
 * Tabelas da migração db/supabase/35_vales_gratificacoes_ferias_seguras.sql:
 *   rh.parametros     (vr_valor_dia)
 *   rh.vr_mensal      planilha do VR, 1 linha por colaborador/mês
 *   rh.vt_mensal      planilha do VT (conta corrente), 1 linha por colaborador/mês
 *   rh.gratificacoes  valores brutos por colaborador/mês
 *   rh.colaboradores  vt_modalidade / vt_valor_dia / vt_dias_padrao
 * Só RH/RH_ADMIN acessa (RLS). Linhas que ainda não foram salvas aparecem
 * com valores sugeridos (dias úteis do calendário, férias aprovadas, saldo
 * previsto do mês anterior) — gravam na primeira edição ou ao fechar o mês.
 */

const VL_DIAS_COD = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SAB"];
const VL_DIAS_PADRAO = ["SEG", "TER", "QUA", "QUI", "SEX"];
const VL_MODALIDADES = { PRESENCIAL: "Presencial", HIBRIDO: "Híbrido", HOME_OFFICE: "Home office" };
const VL_MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function vlIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function vlCompetenciaAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function vlSomarMes(comp, n) {
  const [y, m] = comp.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function vlRotuloMes(comp) {
  const [y, m] = comp.split("-").map(Number);
  return `${VL_MESES[m - 1]}/${y}`;
}
function vlRotuloMesCurto(comp) {
  const [y, m] = comp.split("-").map(Number);
  return `${VL_MESES[m - 1].slice(0, 3)}/${y}`;
}
/** Mês de referência (VR): 1º ao último dia da competência. */
function vlPeriodoMes(comp) {
  const [y, m] = comp.split("-").map(Number);
  return { inicio: vlIso(new Date(y, m - 1, 1)), fim: vlIso(new Date(y, m, 0)) };
}
/** Período de uso do VT: dia 22 do mês anterior ao dia 21 da competência. */
function vlPeriodoVT(comp) {
  const [y, m] = comp.split("-").map(Number);
  return { inicio: vlIso(new Date(y, m - 2, 22)), fim: vlIso(new Date(y, m - 1, 21)) };
}
/** Período padrão do fechamento: VR = mês inteiro; VT = 22 do mês anterior a 21. */
function vlPeriodoPadrao(tipo, comp) {
  return tipo === "vt" ? vlPeriodoVT(comp) : vlPeriodoMes(comp);
}
/** Período gravado nas linhas do mês (o RH escolhe no fechamento), se houver. */
function vlPeriodoSalvo(rows) {
  const r = (rows || []).find((x) => x.periodo_inicio && x.periodo_fim);
  return r ? { inicio: r.periodo_inicio, fim: r.periodo_fim } : null;
}
function vlPeriodoValido(p) {
  return p && /^\d{4}-\d{2}-\d{2}$/.test(p.inicio || "") && /^\d{4}-\d{2}-\d{2}$/.test(p.fim || "") && p.inicio <= p.fim;
}

// ---------------------------------------------------------------------------
// Ligação com a aba Benefícios (db/supabase/36_beneficios_vales_link.sql)
// Benefício ATIVO da categoria ALIMENTACAO -> Vale-refeição;
// TRANSPORTE -> Vale-transporte. O valor de cada colaborador no benefício
// (rh.beneficio_valores_fixos) é o VALOR POR DIA. Quem recebe = público do
// benefício (todos ou específicos). Sem benefício da categoria, as abas
// continuam como antes (todos os colaboradores, valor geral/cadastro).
// ---------------------------------------------------------------------------
const VL_CATEGORIA = { vr: "ALIMENTACAO", vt: "TRANSPORTE" };
async function vlBeneficiosDoTipo(tipo) {
  const cat = VL_CATEGORIA[tipo];
  const bRes = await sb.from("beneficios").select("id, nome, atribuicao_tipo, status, beneficios_colaboradores(colaborador_id)").eq("categoria", cat).eq("status", "ATIVO").order("created_at");
  if (bRes.error || !(bRes.data || []).length) return null;
  const ids = bRes.data.map((b) => b.id);
  const fRes = await sb.from("beneficio_valores_fixos").select("beneficio_id, colaborador_id, valor").in("beneficio_id", ids);
  if (fRes.error) throw fRes.error;
  const publico = new Set();
  let todos = false;
  bRes.data.forEach((b) => {
    if (b.atribuicao_tipo !== "ESPECIFICO") todos = true;
    else (b.beneficios_colaboradores || []).forEach((bc) => publico.add(bc.colaborador_id));
  });
  const valorDia = new Map();
  (fRes.data || []).forEach((f) => valorDia.set(f.colaborador_id, vlRound((valorDia.get(f.colaborador_id) || 0) + Number(f.valor || 0))));
  return {
    beneficios: bRes.data.map((b) => ({ id: b.id, nome: b.nome })),
    todos,
    recebe: (id) => todos || publico.has(id),
    valorDia,
  };
}

function vlNum(v) {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
function vlNumInput(v) {
  // Inputs aceitam "18,40" e "18.40".
  if (v === null || v === undefined || v === "") return 0;
  const s = String(v).trim();
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
function vlRound(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function rhErroMigracao35(err) {
  const msg = String(err?.message || err || "");
  if (/vr_mensal|vt_mensal|gratificacoes|parametros|vt_modalidade|vt_valor_dia/i.test(msg) && /does not exist|schema cache|Could not find/i.test(msg)) {
    return "Estas abas precisam da migração db/supabase/35_vales_gratificacoes_ferias_seguras.sql aplicada no Supabase.";
  }
  return typeof rhMensagemErroSupabase === "function" ? rhMensagemErroSupabase(err) : msg;
}

/** Dias de trabalho do colaborador entre `inicio` e `fim` (inclusive),
 * respeitando os dias da semana do cadastro (padrão seg–sex), feriados,
 * admissão e desligamento. Devolve a lista de datas ISO. */
function vlDiasTrabalho(colab, inicio, fim, feriadosSet) {
  const dias = colab.dias_trabalho && colab.dias_trabalho.length ? colab.dias_trabalho : VL_DIAS_PADRAO;
  const ini = colab.admissao && colab.admissao > inicio ? colab.admissao : inicio;
  const fimEf = colab.data_desligamento && colab.data_desligamento < fim ? colab.data_desligamento : fim;
  const out = [];
  if (ini > fimEf) return out;
  const d = new Date(ini + "T00:00:00");
  const end = new Date(fimEf + "T00:00:00");
  while (d <= end) {
    const iso = vlIso(d);
    if (dias.includes(VL_DIAS_COD[d.getDay()]) && !feriadosSet.has(iso)) out.push(iso);
    d.setDate(d.getDate() + 1);
  }
  return out;
}
function vlContarFerias(diasLista, feriasDoColab) {
  if (!feriasDoColab || !feriasDoColab.length) return 0;
  return diasLista.filter((iso) => feriasDoColab.some((f) => iso >= f.inicio && iso <= f.fim)).length;
}

/** Colaboradores que entram na planilha do período: não inativos, ou
 * desligados dentro/depois do período; admitidos até o fim do período. */
function vlColaboradoresDoPeriodo(colabs, inicio, fim) {
  return colabs.filter((c) => {
    if (c.admissao && c.admissao > fim) return false;
    if (c.status === "INATIVO" && (!c.data_desligamento || c.data_desligamento < inicio)) return false;
    return true;
  });
}

async function vlCarregarBase(inicio, fim) {
  const [colabRes, ferRes, feriasRes] = await Promise.all([
    sb.from("colaboradores").select("id, nome, status, admissao, data_desligamento, dias_trabalho, vt_modalidade, vt_valor_dia, vt_dias_padrao").order("nome"),
    sb.from("feriados").select("data").gte("data", inicio).lte("data", fim),
    sb.from("ferias_solicitacoes").select("colaborador_id, inicio, fim, status").eq("status", "APROVADA").lte("inicio", fim).gte("fim", inicio),
  ]);
  if (colabRes.error) throw colabRes.error;
  if (feriasRes.error) throw feriasRes.error;
  const feriadosSet = new Set(ferRes.error ? [] : (ferRes.data || []).map((f) => f.data));
  const feriasPor = new Map();
  (feriasRes.data || []).forEach((f) => {
    if (!feriasPor.has(f.colaborador_id)) feriasPor.set(f.colaborador_id, []);
    feriasPor.get(f.colaborador_id).push(f);
  });
  return { colabs: colabRes.data || [], feriadosSet, feriasPor };
}

// ---------------------------------------------------------------------------
// Parâmetros
// ---------------------------------------------------------------------------
async function rhParametro(chave, padrao) {
  const { data, error } = await sb.from("parametros").select("valor").eq("chave", chave).maybeSingle();
  if (error) throw error;
  return data ? Number(data.valor) : padrao;
}

/** Altera o VR por dia. Atualiza também as linhas AINDA NÃO FECHADAS do
 * mês informado em diante — meses fechados guardam o valor da época. */
async function rhVrAlterarValorDia(valor, autor, aPartirDe) {
  const v = vlRound(valor);
  if (!(v > 0)) throw new Error("Informe um valor maior que zero.");
  const { error } = await sb.from("parametros").upsert({ chave: "vr_valor_dia", valor: v, descricao: "Valor do vale-refeição por dia útil (vale para todos)", updated_at: new Date().toISOString(), updated_by_nome: autor || null }, { onConflict: "chave" });
  if (error) throw error;
  const { error: updErr } = await sb.from("vr_mensal").update({ valor_dia: v, updated_at: new Date().toISOString() }).eq("fechado", false).gte("competencia", aPartirDe);
  if (updErr) throw updErr;
  return v;
}

// ---------------------------------------------------------------------------
// Vale-refeição
// ---------------------------------------------------------------------------
function vrTotal(l) {
  return vlRound(Math.max(0, l.dias_uteis - l.faltas - l.ferias_dias) * l.valor_dia);
}

/** `periodoNovo` (opcional) = período escolhido pelo RH agora: recalcula os
 * dias das linhas ainda abertas. Sem ele, usa o período gravado no mês ou o padrão. */
async function rhVrCarregar(comp, periodoNovo) {
  const [valorDia, salvosRes, vinculo] = await Promise.all([
    rhParametro("vr_valor_dia", 23),
    sb.from("vr_mensal").select("*").eq("competencia", comp),
    vlBeneficiosDoTipo("vr"),
  ]);
  if (salvosRes.error) throw salvosRes.error;
  const padrao = vlPeriodoPadrao("vr", comp);
  const periodo = vlPeriodoValido(periodoNovo) ? periodoNovo : vlPeriodoSalvo(salvosRes.data) || padrao;
  const { inicio, fim } = periodo;
  const base = await vlCarregarBase(inicio, fim);
  const salvos = new Map((salvosRes.data || []).map((r) => [r.colaborador_id, r]));
  const nomes = new Map(base.colabs.map((c) => [c.id, c.nome]));
  const doPeriodo = vlColaboradoresDoPeriodo(base.colabs, inicio, fim).map((c) => c.id).filter((id) => !vinculo || vinculo.recebe(id));
  const ids = new Set([...doPeriodo, ...[...salvos.values()].filter((s) => !vinculo || s.fechado || vinculo.recebe(s.colaborador_id)).map((s) => s.colaborador_id)]);
  const recalc = vlPeriodoValido(periodoNovo);
  const linhas = [...ids].map((id) => {
    const c = base.colabs.find((x) => x.id === id) || { id, dias_trabalho: null };
    const s = salvos.get(id);
    const fechado = s ? s.fechado : false;
    const diasLista = vlDiasTrabalho(c, inicio, fim, base.feriadosSet);
    const sugerido = { dias_uteis: diasLista.length, ferias_dias: vlContarFerias(diasLista, base.feriasPor.get(id)) };
    const doBenef = vinculo && vinculo.valorDia.has(id) ? vinculo.valorDia.get(id) : null;
    const valorAtual = vinculo ? (doBenef ?? valorDia) : valorDia;
    const valor_dia = s && (fechado || !vinculo) ? Number(s.valor_dia) : valorAtual;
    const usarSugestao = !s || (recalc && !fechado);
    return {
      colaborador_id: id,
      nome: nomes.get(id) || "—",
      salvo: !!s,
      dias_uteis: usarSugestao ? sugerido.dias_uteis : s.dias_uteis,
      faltas: s ? s.faltas : 0,
      ferias_dias: usarSugestao ? sugerido.ferias_dias : s.ferias_dias,
      valor_dia,
      semValorBeneficio: !!vinculo && doBenef === null,
      observacao: s ? s.observacao || "" : "",
      fechado,
      fechado_em: s?.fechado_em || null,
      fechado_por: s?.fechado_por || null,
      // Linha aberta que mudou (novo período ou novo valor no benefício): grava sozinha.
      alterado: !!s && !fechado && ((recalc && (s.dias_uteis !== sugerido.dias_uteis || s.ferias_dias !== sugerido.ferias_dias || s.periodo_inicio !== inicio || s.periodo_fim !== fim)) || (vinculo && Number(s.valor_dia) !== valorAtual)),
      sugerido,
    };
  }).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const diasUteisMes = vlDiasTrabalho({ dias_trabalho: VL_DIAS_PADRAO }, inicio, fim, base.feriadosSet).length;
  return { comp, valorDia, diasUteisMes, linhas, periodo, padrao, vinculo, fechado: linhas.length > 0 && linhas.every((l) => l.fechado) };
}

function vlPayloadPeriodo(periodo) {
  return vlPeriodoValido(periodo) ? { periodo_inicio: periodo.inicio, periodo_fim: periodo.fim } : {};
}
function vrPayload(comp, l, extra) {
  return {
    colaborador_id: l.colaborador_id,
    competencia: comp,
    dias_uteis: Math.max(0, Math.round(l.dias_uteis)),
    faltas: Math.max(0, Math.round(l.faltas)),
    ferias_dias: Math.max(0, Math.round(l.ferias_dias)),
    valor_dia: vlRound(l.valor_dia),
    observacao: l.observacao || null,
    updated_at: new Date().toISOString(),
    ...(extra || {}),
  };
}
async function rhVrSalvarLinha(comp, l, periodo) {
  const { error } = await sb.from("vr_mensal").upsert(vrPayload(comp, l, vlPayloadPeriodo(periodo)), { onConflict: "colaborador_id,competencia" });
  if (error) throw error;
}
async function rhVrSalvarLinhas(comp, linhas, periodo) {
  if (!linhas.length) return;
  const { error } = await sb.from("vr_mensal").upsert(linhas.map((l) => vrPayload(comp, l, vlPayloadPeriodo(periodo))), { onConflict: "colaborador_id,competencia" });
  if (error) throw error;
}
async function rhVrFecharMes(comp, linhas, autor, periodo) {
  const agora = new Date().toISOString();
  const { error } = await sb.from("vr_mensal").upsert(linhas.map((l) => vrPayload(comp, l, { ...vlPayloadPeriodo(periodo), fechado: true, fechado_em: agora, fechado_por: autor || null })), { onConflict: "colaborador_id,competencia" });
  if (error) throw error;
}
async function rhVrReabrirMes(comp) {
  const { error } = await sb.from("vr_mensal").update({ fechado: false, fechado_em: null, fechado_por: null }).eq("competencia", comp);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Vale-transporte (conta corrente)
// ---------------------------------------------------------------------------
function vtNecessidade(l) {
  return vlRound(l.dias_presenciais * l.valor_dia);
}
function vtCarregar(l) {
  return vlRound(Math.max(0, vtNecessidade(l) - l.saldo_cartao));
}

async function rhVtCarregar(comp, periodoNovo) {
  const anterior = vlSomarMes(comp, -1);
  const [salvosRes, antRes, vinculo] = await Promise.all([
    sb.from("vt_mensal").select("*").eq("competencia", comp),
    sb.from("vt_mensal").select("*").eq("competencia", anterior),
    vlBeneficiosDoTipo("vt"),
  ]);
  if (salvosRes.error) throw salvosRes.error;
  if (antRes.error) throw antRes.error;
  const padrao = vlPeriodoPadrao("vt", comp);
  const periodo = vlPeriodoValido(periodoNovo) ? periodoNovo : vlPeriodoSalvo(salvosRes.data) || padrao;
  const { inicio, fim } = periodo;
  const recalc = vlPeriodoValido(periodoNovo);
  const base = await vlCarregarBase(inicio, fim);
  const salvos = new Map((salvosRes.data || []).map((r) => [r.colaborador_id, r]));
  const ant = new Map((antRes.data || []).map((r) => [r.colaborador_id, r]));
  const doPeriodo = vlColaboradoresDoPeriodo(base.colabs, inicio, fim).map((c) => c.id).filter((id) => !vinculo || vinculo.recebe(id));
  const ids = new Set([...doPeriodo, ...[...salvos.values()].filter((s) => !vinculo || s.fechado || vinculo.recebe(s.colaborador_id)).map((s) => s.colaborador_id)]);
  const linhas = [...ids].map((id) => {
    const c = base.colabs.find((x) => x.id === id) || { id, nome: "—", vt_modalidade: "PRESENCIAL", vt_valor_dia: 0 };
    const s = salvos.get(id);
    const a = ant.get(id);
    const fechado = s ? s.fechado : false;
    const diasLista = vlDiasTrabalho(c, inicio, fim, base.feriadosSet);
    const uteis = diasLista.length - vlContarFerias(diasLista, base.feriasPor.get(id));
    const modalidade = s ? s.modalidade : c.vt_modalidade || "PRESENCIAL";
    const diasSug = modalidade === "HOME_OFFICE" ? 0 : modalidade === "HIBRIDO" && c.vt_dias_padrao != null ? Math.min(c.vt_dias_padrao, uteis) : uteis;
    // Saldo previsto: o que sobrou do mês anterior (saldo + carregado − necessidade).
    const saldoPrevisto = a ? vlRound(Math.max(0, Number(a.saldo_cartao) + Number(a.valor_carregar) - Number(a.dias_presenciais) * Number(a.valor_dia))) : 0;
    const doBenef = vinculo && vinculo.valorDia.has(id) ? vinculo.valorDia.get(id) : null;
    const valorAtual = doBenef ?? Number(c.vt_valor_dia || 0);
    const valor_dia = s && (fechado || !vinculo) ? Number(s.valor_dia) : valorAtual;
    const usarSugestao = !s || (recalc && !fechado);
    const l = {
      colaborador_id: id,
      nome: c.nome || "—",
      salvo: !!s,
      modalidade,
      valor_dia,
      doBeneficio: !!vinculo,
      semValorBeneficio: !!vinculo && doBenef === null,
      alterado: !!s && !fechado && ((recalc && (s.dias_presenciais !== diasSug || s.periodo_inicio !== inicio || s.periodo_fim !== fim)) || (vinculo && Number(s.valor_dia) !== valorAtual)),
      dias_presenciais: usarSugestao ? diasSug : s.dias_presenciais,
      saldo_cartao: s ? Number(s.saldo_cartao) : saldoPrevisto,
      observacao: s ? s.observacao || "" : "",
      fechado,
      fechado_em: s?.fechado_em || null,
      fechado_por: s?.fechado_por || null,
      sugerido: { dias: diasSug, uteis, saldo: saldoPrevisto },
      cadMod: c.vt_modalidade || "PRESENCIAL",
      cadValor: Number(c.vt_valor_dia || 0),
    };
    return l;
  }).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  return { comp, periodo, padrao, vinculo, linhas, fechado: linhas.length > 0 && linhas.every((l) => l.fechado) };
}

function vtPayload(comp, l, extra) {
  return {
    colaborador_id: l.colaborador_id,
    competencia: comp,
    modalidade: l.modalidade,
    valor_dia: vlRound(l.valor_dia),
    dias_presenciais: Math.max(0, Math.round(l.dias_presenciais)),
    saldo_cartao: vlRound(l.saldo_cartao),
    valor_carregar: vtCarregar(l),
    observacao: l.observacao || null,
    updated_at: new Date().toISOString(),
    ...(extra || {}),
  };
}
async function rhVtSalvarLinha(comp, l, periodo) {
  const { error } = await sb.from("vt_mensal").upsert(vtPayload(comp, l, vlPayloadPeriodo(periodo)), { onConflict: "colaborador_id,competencia" });
  if (error) throw error;
}
async function rhVtSalvarLinhas(comp, linhas, periodo) {
  if (!linhas.length) return;
  const { error } = await sb.from("vt_mensal").upsert(linhas.map((l) => vtPayload(comp, l, vlPayloadPeriodo(periodo))), { onConflict: "colaborador_id,competencia" });
  if (error) throw error;
}
async function rhVtFecharMes(comp, linhas, autor, periodo) {
  const agora = new Date().toISOString();
  const { error } = await sb.from("vt_mensal").upsert(linhas.map((l) => vtPayload(comp, l, { ...vlPayloadPeriodo(periodo), fechado: true, fechado_em: agora, fechado_por: autor || null })), { onConflict: "colaborador_id,competencia" });
  if (error) throw error;
}
async function rhVtReabrirMes(comp) {
  const { error } = await sb.from("vt_mensal").update({ fechado: false, fechado_em: null, fechado_por: null }).eq("competencia", comp);
  if (error) throw error;
}

/** Configuração de VT do cadastro do colaborador. */
async function rhVtSalvarConfig(colaboradorId, { modalidade, valorDia, diasPadrao }) {
  const payload = {};
  if (modalidade !== undefined) payload.vt_modalidade = modalidade;
  if (valorDia !== undefined) payload.vt_valor_dia = vlRound(valorDia);
  if (diasPadrao !== undefined) payload.vt_dias_padrao = diasPadrao === "" || diasPadrao === null ? null : Math.max(0, Math.round(Number(diasPadrao)));
  const { error } = await sb.from("colaboradores").update(payload).eq("id", colaboradorId);
  if (error) throw error;
}
async function rhVtConfigColaborador(colaboradorId) {
  const { data, error } = await sb.from("colaboradores").select("id, nome, vt_modalidade, vt_valor_dia, vt_dias_padrao").eq("id", colaboradorId).single();
  if (error) throw error;
  return data;
}

/** Extrato (conta corrente) do VT de um colaborador: um item por mês salvo.
 * Utilizado no mês = saldo + carregado − saldo informado no mês seguinte
 * (enquanto o mês seguinte não existe, usa a necessidade como previsão). */
async function rhVtExtrato(colaboradorId) {
  const { data, error } = await sb.from("vt_mensal").select("*").eq("colaborador_id", colaboradorId).order("competencia", { ascending: true });
  if (error) throw error;
  const rows = data || [];
  return rows.map((r, i) => {
    const prox = rows[i + 1] && rows[i + 1].competencia === vlSomarMes(r.competencia, 1) ? rows[i + 1] : null;
    const necessidade = vlRound(r.dias_presenciais * r.valor_dia);
    const disponivel = vlRound(Number(r.saldo_cartao) + Number(r.valor_carregar));
    const saldoFinal = prox ? Number(prox.saldo_cartao) : vlRound(Math.max(0, disponivel - necessidade));
    return {
      competencia: r.competencia,
      modalidade: r.modalidade,
      saldoInicial: Number(r.saldo_cartao),
      necessidade,
      carregado: Number(r.valor_carregar),
      utilizado: vlRound(Math.max(0, disponivel - saldoFinal)),
      saldoFinal,
      previsto: !prox,
      fechado: r.fechado,
    };
  }).reverse();
}

// ---------------------------------------------------------------------------
// Gratificações
// ---------------------------------------------------------------------------
async function rhGratCarregar(comp) {
  const [listaRes, colabRes, antRes] = await Promise.all([
    sb.from("gratificacoes").select("*").eq("competencia", comp).order("created_at"),
    sb.from("colaboradores").select("id, nome, status").order("nome"),
    sb.from("gratificacoes").select("valor_bruto").eq("competencia", vlSomarMes(comp, -1)),
  ]);
  if (listaRes.error) throw listaRes.error;
  if (colabRes.error) throw colabRes.error;
  const nomes = new Map((colabRes.data || []).map((c) => [c.id, c.nome]));
  return {
    comp,
    linhas: (listaRes.data || []).map((g) => ({ ...g, valor_bruto: Number(g.valor_bruto), nome: nomes.get(g.colaborador_id) || "—" })),
    colaboradores: (colabRes.data || []).filter((c) => c.status !== "INATIVO"),
    totalAnterior: (antRes.data || []).reduce((a, g) => a + Number(g.valor_bruto || 0), 0),
  };
}
async function rhGratCriar(comp, { colaboradorId, descricao, valor }, autor) {
  if (!colaboradorId) throw new Error("Selecione o colaborador.");
  const v = vlRound(valor);
  if (!(v > 0)) throw new Error("Informe o valor bruto.");
  const { error } = await sb.from("gratificacoes").insert({ colaborador_id: colaboradorId, competencia: comp, descricao: (descricao || "").trim() || null, valor_bruto: v, lancado_por: autor || null });
  if (error) throw error;
}
async function rhGratAtualizar(id, { descricao, valor }) {
  const payload = { updated_at: new Date().toISOString() };
  if (descricao !== undefined) payload.descricao = (descricao || "").trim() || null;
  if (valor !== undefined) payload.valor_bruto = vlRound(valor);
  const { error } = await sb.from("gratificacoes").update(payload).eq("id", id);
  if (error) throw error;
}
async function rhGratExcluir(id) {
  const { error } = await sb.from("gratificacoes").delete().eq("id", id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Exportar planilha (CSV com ; e BOM — abre direto no Excel em português)
// ---------------------------------------------------------------------------
function vlExportarCsv(nomeArquivo, cabecalho, linhas) {
  const cel = (v) => {
    if (typeof v === "number") return String(vlRound(v)).replace(".", ",");
    const s = String(v ?? "");
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "﻿" + [cabecalho, ...linhas].map((l) => l.map(cel).join(";")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
