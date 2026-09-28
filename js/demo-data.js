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
//   - EMPRESA_INFO: endereço/coordenadas REAIS da sede. Em TODA batida de
//     ponto a localização é obrigatória: dentro do raio da sede = "Na
//     empresa"; fora do raio = "Home Office"; sem localização = o ponto não
//     é registrado (ver abrirModalLocalPonto() em js/ui.js).
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
// Global Tower (região do Minas Shopping) — R. Queluzita, 34, Sala
// 1701-1712, Fernão Dias, BH/MG. Coordenadas tiradas do Google Maps
// (plus code 435F+QP Fernão Dias).
//
// REGRA DE LOCALIZAÇÃO (vale para TODA batida de ponto — entrada, intervalo,
// retorno e saída — ver abrirModalLocalPonto() em js/ui.js):
//   * A localização é OBRIGATÓRIA. Sem localização (GPS desligado, permissão
//     negada, indisponível) o ponto NÃO é registrado.
//   * Até raioPresencialMetros (500 m) da sede → "Na empresa" (PRESENCIAL).
//   * Acima disso → "Home Office".
//   * Leitura com precisão pior que precisaoMaximaMetros é recusada (não dá
//     para validar onde a pessoa está) — o colaborador precisa tentar de novo.
// A MESMA regra (coordenadas, raio e precisão) é garantida no banco pelo
// trigger rh.ponto_validar_localizacao (db/supabase/27_ponto_localizacao_e_virada_dia.sql).
// Se mudar algum valor aqui, mude lá também.
const EMPRESA_INFO = {
  nome: "BSconta — Global Tower (Minas Shopping)",
  endereco: "R. Queluzita, 34 — Sala 1701-1712, Fernão Dias, Belo Horizonte/MG, 31910-252",
  lat: -19.8730016,
  lng: -43.9256631,
  raioPresencialMetros: 500,
  precisaoMaximaMetros: 2000,
};

// Gaveta em memória para dados reais carregados em runtime — ver explicação
// acima. Consumida hoje só por colaborador/ponto.html (DEMO.ponto).
const DEMO = {};
