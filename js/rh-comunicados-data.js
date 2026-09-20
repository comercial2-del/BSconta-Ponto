/*
 * BSconta+ Comunicados — camada de dados REAL (Supabase: rh.comunicados +
 * rh.comunicados_leituras)
 * =============================================================================
 * Substitui DEMO.comunicados / DEMO.rhComunicadosAdmin (js/demo-data.js, em
 * memória) pelas tabelas de verdade no banco.
 *
 * RLS relevante (ver db/supabase/01_schema_rh.sql +
 * db/supabase/08_comunicados_campos_extra.sql):
 *   - Colaborador só LÊ comunicados com status = 'PUBLICADO' e cujo público
 *     seja "Todos", o departamento dele, ou ele especificamente — o filtro é
 *     a política de RLS em si, não algo calculado em JS (não dá pra burlar
 *     pedindo a lista toda pela API).
 *   - "Marcar como lido" grava de verdade em rh.comunicados_leituras (uma
 *     linha por colaborador+comunicado) — política "self all" permite ao
 *     colaborador inserir/gerenciar só a própria leitura.
 *   - Só RH/RH_ADMIN cria, edita, arquiva ou vê comunicados AGENDADOS /
 *     ARQUIVADOS.
 *   - Publicação automática na data agendada depende de um job (pg_cron)
 *     configurado manualmente — ver db/supabase/09_comunicados_publicar_agendados.sql.
 *     Enquanto isso não for configurado, o RH pode editar o comunicado e
 *     mudar o status manualmente para publicá-lo antes/na data.
 */

function rhHojeIso() {
  return new Date().toISOString().slice(0, 10);
}

function rhMapComunicado(row, lidoSet) {
  return {
    id: row.id,
    titulo: row.titulo,
    conteudo: row.conteudo || "",
    urgente: !!row.urgente,
    status: row.status,
    publicoTipo: row.publico_tipo,
    publicoDepartamento: row.publico_departamento,
    publicoColaboradorId: row.publico_colaborador_id,
    dataAgendada: row.data_agendada,
    data: row.data_agendada || row.publicado_em?.slice(0, 10),
    lido: lidoSet ? lidoSet.has(row.id) : false,
  };
}

/** Visão do colaborador — RLS já entrega só o que ele pode ver; aqui só
 * juntamos com as leituras dele pra saber o que já foi marcado como lido. */
async function rhCarregarComunicadosColaborador(colaboradorId) {
  const [{ data: comRows, error: comErr }, { data: leituraRows, error: leituraErr }] = await Promise.all([
    sb.from("comunicados").select("*").order("publicado_em", { ascending: false }),
    sb.from("comunicados_leituras").select("comunicado_id").eq("colaborador_id", colaboradorId),
  ]);
  if (comErr) throw comErr;
  if (leituraErr) throw leituraErr;
  const lidoSet = new Set((leituraRows || []).map((r) => r.comunicado_id));
  return (comRows || []).map((row) => rhMapComunicado(row, lidoSet));
}

/** Marca um comunicado como lido pelo colaborador logado — grava de
 * verdade (upsert: não duplica se ele já tiver marcado antes). */
async function rhMarcarComunicadoLido(comunicadoId, colaboradorId) {
  const { error } = await sb.from("comunicados_leituras").upsert({ comunicado_id: comunicadoId, colaborador_id: colaboradorId }, { onConflict: "comunicado_id,colaborador_id" });
  if (error) throw error;
  return true;
}

/** Visão do RH — todos os comunicados, qualquer status. */
async function rhCarregarComunicadosRH() {
  const { data, error } = await sb.from("comunicados").select("*").order("publicado_em", { ascending: false });
  if (error) throw error;
  return (data || []).map((row) => rhMapComunicado(row));
}

/** Departamentos existentes, pra montar o seletor de público "Departamento
 * específico". */
async function rhListarDepartamentosComunicado() {
  const { data, error } = await sb.from("colaboradores").select("departamento").not("departamento", "is", null);
  if (error) throw error;
  return [...new Set((data || []).map((r) => r.departamento))].filter(Boolean).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/** Colaboradores (id + nome), pra montar o seletor de público "Colaborador
 * específico". */
async function rhListarColaboradoresComunicado() {
  const { data, error } = await sb.from("colaboradores").select("id, nome").order("nome");
  if (error) throw error;
  return data || [];
}

/** Cria ou atualiza um comunicado. `id` ausente = criar. O status é
 * derivado da data agendada (agendado no futuro = AGENDADO; sem data ou
 * data já chegada = PUBLICADO de imediato) — a não ser que `statusManual`
 * seja passado (usado pela edição, pra permitir ao RH republicar ou
 * arquivar direto). */
async function rhSalvarComunicado({ id, titulo, conteudo, urgente, publicoTipo, publicoDepartamento, publicoColaboradorId, dataAgendada, statusManual }) {
  const status = statusManual || (dataAgendada && dataAgendada > rhHojeIso() ? "AGENDADO" : "PUBLICADO");
  const payload = {
    titulo,
    conteudo,
    urgente: !!urgente,
    publico_tipo: publicoTipo,
    publico_departamento: publicoTipo === "DEPARTAMENTO" ? publicoDepartamento : null,
    publico_colaborador_id: publicoTipo === "COLABORADOR" ? publicoColaboradorId : null,
    data_agendada: dataAgendada || null,
    status,
  };

  if (id) {
    const { data, error } = await sb.from("comunicados").update(payload).eq("id", id).select().single();
    if (error) throw error;
    return rhMapComunicado(data);
  }
  const { data, error } = await sb.from("comunicados").insert(payload).select().single();
  if (error) throw error;
  return rhMapComunicado(data);
}

async function rhArquivarComunicado(id) {
  const { error } = await sb.from("comunicados").update({ status: "ARQUIVADO" }).eq("id", id);
  if (error) throw error;
  return true;
}

/** Exclui definitivamente um comunicado do banco (RH/RH_ADMIN). Ao
 * contrário de arquivar, não há como desfazer — o registro é removido de
 * verdade da tabela rh.comunicados. */
async function rhExcluirComunicado(id) {
  const { error } = await sb.from("comunicados").delete().eq("id", id);
  if (error) throw error;
  return true;
}
