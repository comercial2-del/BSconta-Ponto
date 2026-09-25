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
//   - EMPRESA_INFO: endereço/coordenadas REAIS da sede. No primeiro ponto
//     do dia, "Na empresa" só fica liberado se a localização do navegador
//     estiver dentro do raio da sede (ver abrirModalLocalPonto() em
//     js/ui.js); fora do raio, ou sem localização, só "Home Office".
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
// Global Tower — R. Queluzita, 34, Sala 1701-1712, Fernão Dias, BH/MG.
// Coordenadas tiradas do Google Maps (plus code 435F+QP Fernão Dias).
// raioPresencialMetros: distância máxima até a sede para o colaborador
// poder marcar "Na empresa" no primeiro ponto do dia (trava em js/ui.js).
const EMPRESA_INFO = {
  nome: "BSconta — Global Tower",
  endereco: "R. Queluzita, 34 — Sala 1701-1712, Fernão Dias, Belo Horizonte/MG, 31910-252",
  lat: -19.8730016,
  lng: -43.9256631,
  raioPresencialMetros: 200,
  // Tolerância extra pela imprecisão do GPS (dentro de prédio a precisão
  // costuma cair). Só usamos até este teto, pra uma leitura muito
  // imprecisa (ex.: ±3 km) não liberar "Na empresa" de longe.
  toleranciaPrecisaoMaxMetros: 100,
};

// Gaveta em memória para dados reais carregados em runtime — ver explicação
// acima. Consumida hoje só por colaborador/ponto.html (DEMO.ponto).
const DEMO = {};
