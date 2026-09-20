// ---------------------------------------------------------------------------
// BSconta+ RH — o que sobrou deste arquivo depois da migração para dados
// reais (Supabase)
// =============================================================================
// Este arquivo já foi o "banco de dados fake" do protótipo inteiro (sessão em
// sessionStorage, colaboradores/férias/documentos/comunicados como listas
// fixas em memória). Depois da migração para Supabase (ver
// js/rh-supabase-auth.js e os demais js/rh-*-data.js), NENHUMA tela lê mais
// nada fictício daqui — cada uma foi confirmada, uma por uma, a chamar as
// funções reais (rhCarregarPonto, rhListarDocumentosRH, etc.), então o que
// restava deste arquivo (a sessão fake getSession/loginDemo/requireRole/
// logout, e a lista gigante DEMO.* de nomes/férias/documentos inventados) foi
// removido de propósito, em vez de deixado morto no repositório.
//
// O que continua aqui é só o que ainda é usado de verdade por outras telas:
//   - assetPath(): monta o caminho de assets/ (logo, ícone) relativo à
//     página atual — não é dado fictício, é utilitário de caminho.
//   - EMPRESA_INFO: endereço/coordenadas REAIS da sede, usados só para
//     SUGERIR automaticamente "Home Office" ou "Presencial" quando o
//     navegador consegue localização no momento de bater o ponto (ver
//     capturarLocalizacao() em js/ui.js) — o colaborador sempre confirma ou
//     corrige antes de salvar; isto nunca é a única fonte de verdade.
//   - DEMO: mantido como um objeto vazio, de propósito — colaborador/
//     ponto.html usa `DEMO.ponto` como uma "gaveta" em memória para guardar
//     os dados REAIS do dia carregados de rh.ponto_registros
//     (`DEMO.ponto = await rhCarregarPonto(...)`, em js/rh-ponto-data.js).
//     Não é mock: é só o nome da variável que sobrou da época do protótipo.
// ---------------------------------------------------------------------------

const BASE = typeof window.BASE_PATH === "string" ? window.BASE_PATH : "";
function assetPath(name) {
  return `${BASE}assets/${name}`;
}

// Endereço/coordenadas da sede — ver explicação acima.
const EMPRESA_INFO = {
  nome: "BSconta+ — Sede",
  endereco: "Av. Presidente Antônio Carlos, 1200 — Bairro Sion, Belo Horizonte/MG",
  lat: -19.9227,
  lng: -43.9451,
  raioPresencialMetros: 150,
};

// Gaveta em memória para dados reais carregados em runtime — ver explicação
// acima. Consumida hoje só por colaborador/ponto.html (DEMO.ponto).
const DEMO = {};
