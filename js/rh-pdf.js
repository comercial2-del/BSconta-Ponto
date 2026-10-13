/*
 * BSconta+ RH — geração de PDF no navegador (jsPDF + AutoTable)
 * =============================================================================
 * - rhPdfRelatorio(rel): qualquer relatório da tela Relatórios em PDF, com a
 *   logo, cabeçalho, indicadores e tabelas (botão "Baixar PDF").
 * - rhPdfFolhaPonto(folhas): Folha de Ponto individual (mesmo conteúdo da
 *   folha do sistema anterior: batidas, trabalhadas, abono, previstas, saldo,
 *   saldo anterior e acumulado, termo e assinaturas). Uma folha por
 *   colaborador; várias folhas → um PDF com uma seção por pessoa.
 * As bibliotecas são carregadas sob demanda (só quando alguém gera um PDF).
 */

const RH_PDF_LIBS = [
  "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js",
  "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js",
];
const RH_PDF_COR = { azul: [22, 58, 140], azulClaro: [41, 163, 230], cinza: [102, 112, 133], linha: [228, 231, 236], fundo: [244, 247, 251], verde: [6, 118, 71], vermelho: [217, 45, 32] };

function rhPdfCarregarScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-rhpdf="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.dataset.rhpdf = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Não foi possível carregar o gerador de PDF. Verifique a internet e tente de novo."));
    document.head.appendChild(s);
  });
}

async function rhPdfCarregarLibs() {
  if (!window.jspdf?.jsPDF) await rhPdfCarregarScript(RH_PDF_LIBS[0]);
  const proto = window.jspdf?.jsPDF?.API;
  if (!proto?.autoTable) await rhPdfCarregarScript(RH_PDF_LIBS[1]);
  if (!window.jspdf?.jsPDF) throw new Error("Gerador de PDF indisponível.");
  return window.jspdf.jsPDF;
}

let rhPdfLogoCache = null;
async function rhPdfLogo() {
  if (rhPdfLogoCache !== null) return rhPdfLogoCache;
  try {
    const resp = await fetch(assetPath("bsconta-logo.jpg"));
    if (!resp.ok) throw new Error(String(resp.status));
    const blob = await resp.blob();
    rhPdfLogoCache = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  } catch (e) {
    console.warn("Logo indisponível para o PDF:", e);
    rhPdfLogoCache = "";
  }
  return rhPdfLogoCache;
}

function rhPdfHoje() {
  return new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/** Cabeçalho com logo + título; devolve o Y onde o conteúdo começa. */
function rhPdfCabecalho(doc, { logo, titulo, subtitulo }) {
  const W = doc.internal.pageSize.getWidth();
  if (logo) {
    try { doc.addImage(logo, "JPEG", 12, 7, 20, 20); } catch (e) { /* logo inválida: segue sem */ }
  }
  doc.setTextColor(...RH_PDF_COR.azul);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(titulo, logo ? 36 : 12, 15);
  if (subtitulo) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...RH_PDF_COR.cinza);
    doc.text(doc.splitTextToSize(subtitulo, W - (logo ? 48 : 24)), logo ? 36 : 12, 21);
  }
  doc.setDrawColor(...RH_PDF_COR.azulClaro);
  doc.setLineWidth(0.6);
  doc.line(12, 30, W - 12, 30);
  doc.setTextColor(16, 24, 40);
  return 36;
}

/** Rodapé "Gerado em … · Página X de Y" em todas as páginas. */
function rhPdfRodapes(doc, texto) {
  const n = doc.getNumberOfPages();
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...RH_PDF_COR.cinza);
    doc.text(`${texto} · Gerado em ${rhPdfHoje()}`, 12, H - 7);
    doc.text(`Página ${i} de ${n}`, W - 12, H - 7, { align: "right" });
  }
}

function rhPdfNomeArquivo(base) {
  return String(base || "relatorio")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() + ".pdf";
}

// ---------------------------------------------------------------------------
// Relatório genérico (tela Relatórios)
// ---------------------------------------------------------------------------
async function rhPdfRelatorio(rel) {
  const jsPDF = await rhPdfCarregarLibs();
  const logo = await rhPdfLogo();
  const muitasColunas = (rel.secoes || []).some((s) => (s.tabela?.headers || []).length > 6);
  const doc = new jsPDF({ orientation: muitasColunas ? "landscape" : "portrait", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  let y = rhPdfCabecalho(doc, { logo, titulo: rel.titulo, subtitulo: rel.meta });

  if (rel.kpis?.length) {
    const porLinha = Math.min(4, rel.kpis.length);
    const gap = 3;
    const w = (W - 24 - gap * (porLinha - 1)) / porLinha;
    rel.kpis.forEach((k, i) => {
      const col = i % porLinha;
      if (i && col === 0) y += 19;
      const x = 12 + col * (w + gap);
      doc.setFillColor(...RH_PDF_COR.fundo);
      doc.setDrawColor(...RH_PDF_COR.linha);
      doc.roundedRect(x, y, w, 16, 2, 2, "FD");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...RH_PDF_COR.cinza);
      doc.text(doc.splitTextToSize(String(k.label), w - 6), x + 3, y + 5);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(...RH_PDF_COR.azul);
      doc.text(String(k.value ?? "—"), x + 3, y + 13);
    });
    y += 23;
  }

  (rel.secoes || []).forEach((s) => {
    if (y > doc.internal.pageSize.getHeight() - 30) { doc.addPage(); y = 16; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(16, 24, 40);
    doc.text(String(s.titulo || ""), 12, y);
    y += 3;
    const rows = s.tabela?.rows || [];
    if (!rows.length) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...RH_PDF_COR.cinza);
      doc.text(String(s.vazio || "Sem dados."), 12, y + 5);
      y += 12;
      return;
    }
    doc.autoTable({
      startY: y,
      head: [s.tabela.headers.map(String)],
      body: rows.map((r) => r.map((c) => (c == null ? "" : String(c)))),
      margin: { left: 12, right: 12, bottom: 14 },
      styles: { font: "helvetica", fontSize: 8, cellPadding: 1.8, lineColor: RH_PDF_COR.linha, lineWidth: 0.1, overflow: "linebreak" },
      headStyles: { fillColor: RH_PDF_COR.azul, textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: RH_PDF_COR.fundo },
    });
    y = doc.lastAutoTable.finalY + 9;
  });

  rhPdfRodapes(doc, `BSconta+ RH · ${rel.titulo}`);
  return doc;
}

async function rhBaixarRelatorioPdf(rel) {
  const doc = await rhPdfRelatorio(rel);
  doc.save(rhPdfNomeArquivo(`${rel.titulo}-${new Date().toISOString().slice(0, 10)}`));
}

// ---------------------------------------------------------------------------
// Folha de Ponto individual
// ---------------------------------------------------------------------------
const RH_PDF_DIA_SEMANA = { DOM: "domingo", SEG: "segunda-feira", TER: "terça-feira", QUA: "quarta-feira", QUI: "quinta-feira", SEX: "sexta-feira", SAB: "sábado" };

function rhPdfHHMM(min, { sinal = false, vazioZero = false } = {}) {
  if (min == null) return "";
  const n = Math.round(Number(min) || 0);
  if (n === 0 && vazioZero) return "";
  const a = Math.abs(n);
  const s = `${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
  return n < 0 ? `-${s}` : sinal && n > 0 ? `+${s}` : s;
}

/**
 * folha = {
 *   colaborador: { nome, cargo, admissao, departamento },
 *   inicio, fim (ISO),
 *   jornada: { entrada, intervaloInicio, intervaloFim, saida, metaMin, dias: ["SEG",...] },
 *   linhas: apuração (rhCarregarApuracao) do período,
 *   saldoAnteriorMin, saldoFinalMin
 * }
 */
function rhPdfDesenharFolha(doc, folha, logo) {
  const W = doc.internal.pageSize.getWidth();
  const emp = (typeof EMPRESA_INFO !== "undefined" && EMPRESA_INFO) || {};
  let y = rhPdfCabecalho(doc, { logo, titulo: "Folha de Ponto", subtitulo: `${fmtDate(folha.inicio)} a ${fmtDate(folha.fim)}` });

  const bloco = (titulo, pares) => {
    doc.setFillColor(...RH_PDF_COR.fundo);
    doc.rect(12, y - 4, W - 24, 6, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...RH_PDF_COR.azul);
    doc.text(titulo, 14, y);
    y += 6;
    doc.setFontSize(8.5);
    pares.forEach((linha) => {
      let x = 14;
      const larg = (W - 28) / linha.length;
      linha.forEach(([rot, val]) => {
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...RH_PDF_COR.cinza);
        doc.text(`${rot}:`, x, y);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(16, 24, 40);
        doc.text(doc.splitTextToSize(String(val || "—"), larg - doc.getTextWidth(`${rot}: `) - 2)[0] || "—", x + doc.getTextWidth(`${rot}: `) + 1, y);
        x += larg;
      });
      y += 5;
    });
    y += 2;
  };

  bloco("DADOS DO EMPREGADOR", [
    [["Nome", emp.razaoSocial || emp.nome || "BSconta"], ["CNPJ", emp.cnpj || "—"]],
    [["Endereço", emp.enderecoFolha || emp.endereco || "—"]],
  ]);
  const c = folha.colaborador || {};
  bloco("DADOS DO COLABORADOR", [
    [["Nome", c.nome], ["Admissão", c.admissao ? fmtDate(c.admissao) : "—"]],
    [["Cargo", c.cargo || "—"], ["Departamento", c.departamento || "—"]],
  ]);

  const j = folha.jornada || {};
  if (j.entrada || j.metaMin) {
    const p1 = j.entrada && j.intervaloInicio ? `${j.entrada} às ${j.intervaloInicio}` : "";
    const p2 = j.intervaloFim && j.saida ? `${j.intervaloFim} às ${j.saida}` : j.entrada && j.saida && !j.intervaloInicio ? `${j.entrada} às ${j.saida}` : "";
    const dias = (j.dias && j.dias.length ? j.dias : ["SEG", "TER", "QUA", "QUI", "SEX"]).map((d) => RH_PDF_DIA_SEMANA[d] || d);
    doc.autoTable({
      startY: y,
      head: [["Quadro de horários", "Período 1", "Período 2", "Total"]],
      body: [[dias.map((d) => d.charAt(0).toUpperCase() + d.slice(1)).join(", "), p1, p2, rhPdfHHMM(j.metaMin)]],
      margin: { left: 12, right: 12 },
      styles: { fontSize: 8, cellPadding: 1.5, lineColor: RH_PDF_COR.linha, lineWidth: 0.1 },
      headStyles: { fillColor: [232, 239, 250], textColor: RH_PDF_COR.azul, fontStyle: "bold" },
      columnStyles: { 0: { cellWidth: 95 } },
    });
    y = doc.lastAutoTable.finalY + 4;
  }

  const linhas = folha.linhas || [];
  const corpo = linhas.map((a) => {
    const [, m, d] = a.data.split("-");
    let pontos;
    if (a.tipoDia === "FERIADO" && !a.entrada) pontos = `FERIADO: ${a.descricao || ""}`;
    else if (a.tipoDia === "FORA_CONTRATO") pontos = "-";
    else {
      const pares = [];
      const mk = (h) => (h && (a.manuais || []).includes(h) ? `(m)${h}` : h || "");
      if (a.entrada) pares.push([mk(a.entrada), mk(a.intervaloSaida || (a.intervaloVolta ? "" : a.saida))].join(" "));
      if (a.intervaloVolta) pares.push([mk(a.intervaloVolta), mk(a.saida)].join(" "));
      pontos = pares.map((p) => p.trim()).filter(Boolean).join(" | ");
      if (a.tipoDia === "ABONO" || a.tipoDia === "FALTA_JUSTIFICADA") pontos = [pontos, (a.descricao || "").toUpperCase()].filter(Boolean).join(" | ");
      else if (a.tipoDia === "FALTA") pontos = "FALTA";
      else if (!pontos) pontos = "-";
      if (a.incompleto) pontos += " (incompleto)";
      if (a.alteradoRh && a.entrada && !(a.manuais || []).length) pontos = `(m) ${pontos}`;
    }
    return [
      `${d}/${m}`,
      RH_PDF_DIA_SEMANA[a.diaSemana] || "",
      pontos,
      a.trabalhadasMin ? rhPdfHHMM(a.trabalhadasMin) : "",
      rhPdfHHMM(a.abonoMin, { vazioZero: true }),
      rhPdfHHMM(a.previstasMin, { vazioZero: true }),
      a.tipoDia === "HOJE" || a.tipoDia === "FUTURO" ? "" : rhPdfHHMM(a.saldoMin, { vazioZero: true }),
    ];
  });
  const tot = linhas.reduce((t, a) => {
    t.trab += a.trabalhadasMin || 0; t.abono += a.abonoMin || 0; t.prev += a.previstasMin || 0;
    if (a.tipoDia !== "HOJE" && a.tipoDia !== "FUTURO" && a.contaNoBanco !== false) t.saldo += a.saldoMin || 0;
    if (a.tipoDia === "FALTA") t.faltas += 1;
    return t;
  }, { trab: 0, abono: 0, prev: 0, saldo: 0, faltas: 0 });

  doc.autoTable({
    startY: y,
    head: [["Dia/Mês", "", "Pontos", "Trabalhadas", "Abono", "Previstas", "Saldo"]],
    body: corpo,
    foot: [["Total", "", "", rhPdfHHMM(tot.trab), rhPdfHHMM(tot.abono), rhPdfHHMM(tot.prev), rhPdfHHMM(tot.saldo, { sinal: true })]],
    showFoot: "lastPage",
    margin: { left: 12, right: 12, bottom: 14 },
    styles: { font: "helvetica", fontSize: 7.6, cellPadding: 1.1, lineColor: RH_PDF_COR.linha, lineWidth: 0.1 },
    headStyles: { fillColor: RH_PDF_COR.azul, textColor: 255, fontStyle: "bold" },
    footStyles: { fillColor: [232, 239, 250], textColor: RH_PDF_COR.azul, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 14 }, 1: { cellWidth: 24, textColor: RH_PDF_COR.cinza }, 3: { halign: "right", cellWidth: 20 }, 4: { halign: "right", cellWidth: 15 }, 5: { halign: "right", cellWidth: 17 }, 6: { halign: "right", cellWidth: 16, fontStyle: "bold" } },
    didParseCell: (data) => {
      if (data.section !== "body") return;
      const a = linhas[data.row.index];
      if (!a) return;
      if (a.diaSemana === "SAB" || a.diaSemana === "DOM" || a.tipoDia === "FERIADO") data.cell.styles.fillColor = [248, 250, 252];
      if (data.column.index === 6 && a.saldoMin) data.cell.styles.textColor = a.saldoMin < 0 ? RH_PDF_COR.vermelho : RH_PDF_COR.verde;
    },
  });
  y = doc.lastAutoTable.finalY + 6;
  if (y > doc.internal.pageSize.getHeight() - 62) { doc.addPage(); y = 18; }

  doc.autoTable({
    startY: y,
    body: [
      ["Trabalhadas + abono", rhPdfHHMM(tot.trab + tot.abono), "Saldo anterior de banco de horas", rhPdfHHMM(folha.saldoAnteriorMin, { sinal: true })],
      ["Dias faltosos", String(tot.faltas), "Saldo do período", rhPdfHHMM(tot.saldo, { sinal: true })],
      ["", "", `Saldo acumulado até ${fmtDate(folha.fim)}`, rhPdfHHMM(folha.saldoFinalMin, { sinal: true })],
    ],
    margin: { left: 12, right: 12 },
    theme: "plain",
    styles: { fontSize: 8.5, cellPadding: 1.4 },
    columnStyles: { 0: { textColor: RH_PDF_COR.cinza }, 1: { fontStyle: "bold" }, 2: { textColor: RH_PDF_COR.cinza }, 3: { fontStyle: "bold", halign: "right" } },
  });
  y = doc.lastAutoTable.finalY + 10;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(16, 24, 40);
  doc.text("Reconheço a exatidão e confirmo a frequência constante deste cartão.", 12, y);
  y += 20;
  const meio = W / 2;
  doc.setDrawColor(150);
  doc.line(16, y, meio - 8, y);
  doc.line(meio + 8, y, W - 16, y);
  doc.setFontSize(8);
  doc.text(String(c.nome || ""), (16 + meio - 8) / 2, y + 4, { align: "center" });
  doc.text(String(emp.razaoSocial || emp.nome || ""), (meio + 8 + W - 16) / 2, y + 4, { align: "center" });
}

/** Uma ou várias folhas num PDF (cada folha começa em página nova). */
async function rhPdfFolhaPonto(folhas) {
  const jsPDF = await rhPdfCarregarLibs();
  const logo = await rhPdfLogo();
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  (Array.isArray(folhas) ? folhas : [folhas]).forEach((f, i) => {
    if (i) doc.addPage();
    rhPdfDesenharFolha(doc, f, logo);
  });
  rhPdfRodapes(doc, "BSconta+ RH · Folha de Ponto");
  return doc;
}

/** Monta os dados da folha de UM colaborador a partir do banco (apuração
 * única — rh.banco_horas_extrato). `colaborador` = linha de rh.colaboradores
 * (precisa de id, nome, cargo, departamento, admissao e colunas de jornada). */
async function rhMontarFolhaPonto(colaborador, inicio, fim) {
  const linhas = await rhCarregarApuracao(colaborador.id, inicio, fim);
  const ultimo = linhas[linhas.length - 1];
  const doPeriodo = linhas.reduce((t, a) => t + (a.contaNoBanco !== false && a.tipoDia !== "HOJE" && a.tipoDia !== "FUTURO" ? a.saldoMin : 0), 0);
  const saldoFinalMin = ultimo ? ultimo.saldoAcumuladoMin : 0;
  const cfg = typeof rhConfigJornada === "function" ? rhConfigJornada(colaborador) : {};
  return {
    colaborador: { nome: colaborador.nome, cargo: colaborador.cargo, departamento: colaborador.departamento, admissao: colaborador.admissao },
    inicio,
    fim,
    jornada: {
      entrada: rhHoraCurta(colaborador.horario_entrada),
      intervaloInicio: rhHoraCurta(colaborador.intervalo_inicio),
      intervaloFim: rhHoraCurta(colaborador.intervalo_fim),
      saida: rhHoraCurta(colaborador.horario_saida),
      metaMin: Math.round((cfg.metaDiariaHoras || 0) * 60),
      dias: colaborador.dias_trabalho || null,
    },
    linhas,
    saldoAnteriorMin: saldoFinalMin - doPeriodo,
    saldoFinalMin,
    saldoPeriodoMin: doPeriodo,
  };
}
