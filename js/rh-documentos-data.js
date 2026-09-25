/*
 * BSconta+ Documentos — camada de dados REAL (Supabase: rh.documentos +
 * Storage bucket "documentos-rh")
 * =============================================================================
 * Substitui js/documents-store.js (BSDocuments — metadata em localStorage e
 * arquivo em IndexedDB, os dois PRESOS ao navegador de quem abriu a tela;
 * RH e colaborador nunca viam o mesmo documento de verdade) por
 * rh.documentos (metadata) + Storage (o PDF em si), compartilhados de
 * verdade entre quem estiver logado.
 *
 * RLS/Storage relevante (ver db/supabase/10_documentos_storage.sql):
 *   - RH lê/cria/atualiza/apaga qualquer documento e qualquer arquivo do
 *     bucket "documentos-rh".
 *   - Colaborador só LÊ os próprios documentos (rh.documentos) e só
 *     lê/grava arquivos dentro da própria pasta no bucket
 *     (<colaborador_id>/...). Ele NUNCA faz UPDATE direto na tabela — as
 *     duas ações que precisa fazer sozinho (marcar "fui pro GOV.BR" e
 *     registrar a assinatura) passam pelas funções rh.colaborador_* no
 *     banco, que validam a posse do documento por dentro.
 */

const RH_DOCS_BUCKET = "documentos-rh";

function rhSlugArquivo(nome) {
  return String(nome || "documento.pdf").replace(/[^a-zA-Z0-9.\-]+/g, "-");
}

function rhCaminhoOriginalDocumento(colaboradorId, documentoId, nomeArquivo) {
  return `${colaboradorId}/${documentoId}/original-${rhSlugArquivo(nomeArquivo)}`;
}

function rhCaminhoAssinadoDocumento(colaboradorId, documentoId, nomeArquivo) {
  return `${colaboradorId}/${documentoId}/assinado-${Date.now()}-${rhSlugArquivo(nomeArquivo)}`;
}

function rhMapDocumentoRow(row) {
  return {
    id: row.id,
    colaboradorId: row.colaborador_id,
    colaborador: row.colaborador?.nome || row.colaborador_nome || "—",
    colaboradorEmail: row.colaborador?.email || "",
    titulo: row.titulo || row.tipo,
    tipo: row.tipo,
    competencia: row.competencia || "—",
    status: row.status,
    workflow: row.workflow,
    origem: row.origem,
    arquivoPath: row.arquivo_original_path,
    arquivoNome: row.arquivo_original_nome,
    arquivoAssinadoPath: row.arquivo_assinado_path,
    arquivoAssinadoNome: row.arquivo_assinado_nome,
    enviadoEm: row.enviado_em,
    assinadoEm: row.assinado_em,
    prazo: row.prazo,
    metodoAssinatura: row.metodo_assinatura,
    arquivadoEm: row.arquivado_colab_em || null,
    removidoEm: row.removido_colab_em || null,
    data: row.enviado_em ? String(row.enviado_em).slice(0, 10) : row.created_at?.slice(0, 10),
  };
}

/** Colaborador: só os próprios documentos (RLS "self select"). */
async function rhListarDocumentosColaborador(colaboradorId) {
  const { data, error } = await sb.from("documentos").select("*").eq("colaborador_id", colaboradorId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(rhMapDocumentoRow);
}

/** RH: todos os documentos, com o nome/e-mail do colaborador via join. */
async function rhListarDocumentosRH() {
  const { data, error } = await sb.from("documentos").select("*, colaborador:colaboradores(nome,email)").order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(rhMapDocumentoRow);
}

async function rhListarColaboradoresDocumento() {
  const { data, error } = await sb.from("colaboradores").select("id, nome, email, status").order("nome");
  if (error) throw error;
  return data || [];
}

/** RH envia um documento (para assinatura ou já preparado) — cria a linha,
 * sobe o PDF de verdade pro Storage, e liga o caminho na linha. */
async function rhEnviarDocumentoRH({ colaboradorId, titulo, tipo, competencia, prazo, modo, file }) {
  if (!file) throw new Error("Selecione o arquivo do documento.");
  const { data: row, error: insErr } = await sb
    .from("documentos")
    .insert({
      colaborador_id: colaboradorId,
      titulo: titulo || tipo,
      tipo,
      competencia: competencia || null,
      prazo: prazo || null,
      status: "PENDENTE",
      workflow: "ASSINATURA",
      origem: modo === "IMPORT_READY" ? "IMPORTADO_PREPARADO" : "ENVIADO_RH",
    })
    .select()
    .single();
  if (insErr) throw insErr;

  const caminho = rhCaminhoOriginalDocumento(colaboradorId, row.id, file.name);
  const { error: upErr } = await sb.storage.from(RH_DOCS_BUCKET).upload(caminho, file, { contentType: file.type || "application/pdf" });
  if (upErr) {
    // Sem o arquivo, o documento não faz sentido — remove a linha órfã.
    await sb.from("documentos").delete().eq("id", row.id);
    throw upErr;
  }

  const { data: atualizado, error: updErr } = await sb
    .from("documentos")
    .update({ arquivo_original_path: caminho, arquivo_original_nome: file.name, enviado_em: new Date().toISOString() })
    .eq("id", row.id)
    .select("*, colaborador:colaboradores(nome,email)")
    .single();
  if (updErr) throw updErr;
  return rhMapDocumentoRow(atualizado);
}

/** Baixa o arquivo (original ou assinado) do Storage como Blob, pra
 * pré-visualização/download — funciona tanto pro RH quanto pro
 * colaborador dono do documento (as políticas do bucket decidem). */
async function rhBaixarArquivoDocumento(path) {
  if (!path) return null;
  const { data, error } = await sb.storage.from(RH_DOCS_BUCKET).download(path);
  if (error) throw error;
  return data;
}

/** Colaborador marca que foi pro GOV.BR (RPC security definer — valida
 * posse do documento por dentro do banco). */
async function rhColaboradorMarcarAguardandoImportacao(documentoId) {
  const { error } = await sb.rpc("colaborador_marcar_aguardando_importacao", { p_documento_id: documentoId });
  if (error) throw error;
  return true;
}

/** RH exclui um documento — só permitido enquanto ainda não foi assinado
 * (ASSINADO) nem publicado (PUBLICADO): depois disso é um registro
 * oficial/trilha de auditoria, e excluir deixaria de existir prova de que
 * aquele holerite/atestado foi tratado — a correção nesse caso é enviar um
 * documento novo, não apagar o antigo. Remove a linha da tabela e o(s)
 * arquivo(s) do Storage. */
async function rhExcluirDocumentoRH(documento) {
  if (documento.status === "ASSINADO" || documento.status === "PUBLICADO") {
    throw new Error("Documentos já assinados ou publicados não podem ser excluídos (ficam como registro). Envie um documento novo se for o caso.");
  }
  const caminhos = [documento.arquivoPath, documento.arquivoAssinadoPath].filter(Boolean);
  if (caminhos.length) {
    const { error: rmErr } = await sb.storage.from(RH_DOCS_BUCKET).remove(caminhos);
    // Não trava a exclusão do registro por um arquivo que já não existia no
    // bucket (ex.: documento cadastrado antes do upload real existir) — só
    // avisa no console; o dado que importa (a linha da tabela) é removido.
    if (rmErr) console.error("rhExcluirDocumentoRH: falha ao remover arquivo(s) do Storage.", rmErr);
  }
  const { error } = await sb.from("documentos").delete().eq("id", documento.id);
  if (error) throw error;
  return true;
}

/** RH clica em "Lembrar colaborador" (documento pendente de assinatura) —
 * chama a Edge Function send-push, modo sob demanda (ver
 * supabase/functions/send-push/index.ts), que manda uma notificação push de
 * verdade para o(s) navegador(es) em que o colaborador tiver ativado
 * "Notificações do navegador" (Meu Perfil > Segurança e notificações).
 * Se o colaborador nunca ativou (nenhuma inscrição em
 * rh.push_subscriptions), a função responde ok:true com enviados:0 e uma
 * mensagem explicando isso — nunca finge que o lembrete chegou. */
async function rhLembrarColaboradorDocumento(documento) {
  const { data, error } = await sb.functions.invoke("send-push", {
    body: {
      colaboradorId: documento.colaboradorId,
      titulo: "Documento pendente de assinatura",
      mensagem: `Você tem "${documento.titulo || documento.tipo}" pendente de assinatura no BSconta+ RH.`,
      url: "/colaborador/documentos.html",
    },
  });
  if (error) {
    let detalhe = error.message || String(error);
    try {
      const body = await error.context?.json?.();
      if (body?.error) detalhe = body.error;
    } catch {
      /* mantém detalhe genérico */
    }
    throw new Error(detalhe);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

/** Colaborador sobe o PDF assinado pro Storage (na própria pasta) e então
 * registra a assinatura via RPC (que já marca status ASSINADO). */
async function rhColaboradorRegistrarAssinatura({ documentoId, colaboradorId, file, metodo }) {
  if (!file) throw new Error("Selecione o PDF assinado.");
  const caminho = rhCaminhoAssinadoDocumento(colaboradorId, documentoId, file.name);
  const { error: upErr } = await sb.storage.from(RH_DOCS_BUCKET).upload(caminho, file, { contentType: file.type || "application/pdf" });
  if (upErr) throw upErr;
  const { error: rpcErr } = await sb.rpc("colaborador_registrar_assinatura", {
    p_documento_id: documentoId,
    p_arquivo_path: caminho,
    p_arquivo_nome: file.name,
    p_metodo: metodo === "GOVBR" ? "GOV.BR" : "Assinatura externa/importada",
  });
  if (rpcErr) throw rpcErr;
  return true;
}

/** Colaborador: arquiva/desarquiva um documento concluído (assinado ou
 * publicado) — ver db/supabase/24_documentos_arquivar_colaborador.sql. */
async function rhColaboradorArquivarDocumento(documentoId, arquivar) {
  const { error } = await sb.rpc("colaborador_arquivar_documento", { p_documento_id: documentoId, p_arquivar: !!arquivar });
  if (error) throw error;
}

/** Colaborador: exclui da PRÓPRIA tela um documento já arquivado. O RH
 * continua com o registro e os PDFs. */
async function rhColaboradorRemoverDocumento(documentoId) {
  const { error } = await sb.rpc("colaborador_remover_documento", { p_documento_id: documentoId });
  if (error) throw error;
}

/** Mensagem amigável quando a migração 24 ainda não foi aplicada. */
function rhErroMigracao24(err) {
  const msg = String(err?.message || err || "");
  if (/colaborador_arquivar_documento|colaborador_remover_documento|could not find the function|schema cache/i.test(msg)) {
    return "Arquivar/excluir ainda não está ativo no banco. O RH precisa rodar db/supabase/24_documentos_arquivar_colaborador.sql no Supabase.";
  }
  return rhMensagemErroSupabase(err);
}
