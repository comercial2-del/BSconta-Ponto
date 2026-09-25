// Componentes de interface compartilhados entre todas as páginas do sistema
// de RH: barra lateral, cabeçalho, cartões de KPI, badges, tabs, modal,
// toast, empty state. Sem framework — DOM puro, no mesmo espírito do SGCMP.

const ICONS = {
  overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  fileText: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6M9 9h1"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.6z"/></svg>',
  messageSquare: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
  megaphone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l18-5v12L3 13v-2z"/><path d="M11.6 16.9 12 20a2 2 0 0 1-4 0v-4.2"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  reports: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21V10M16 21V3M12 21v-6"/></svg>',
  briefcase: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>',
  chevronDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  chevronRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  chevronLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  checkCircle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 5-5"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  xCircle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
  alertCircle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16v.01"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c6.5 0 10 7 10 7a17.5 17.5 0 0 1-2.94 3.9M6.1 6.1A17.5 17.5 0 0 0 2 11s3.5 7 10 7a10.9 10.9 0 0 0 4.24-.85M9.9 9.9a3 3 0 1 0 4.2 4.2"/><path d="M2 2l20 20"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 3.5V11c0 5-3.4 8.5-8 9.5-4.6-1-8-4.5-8-9.5V5.5z"/><path d="M8.5 12l2.5 2.5L15.5 9.5"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>',
  palmTree: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22V12"/><path d="M12 12c-2-4-7-5-9-3 2 3 6 4 9 3z"/><path d="M12 12c2-4 7-5 9-3-2 3-6 4-9 3z"/><path d="M12 12c1-3 0-6-2-8 3 0 5 2 5 5"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>',
  building: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="1"/><path d="M9 22v-4h6v4M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1"/></svg>',
  cake: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7"/><path d="M4 21h16M12 8V5M9 3.5c0 1 .8 1.5 1.5 1.5S12 4.5 12 3.5 11.2 2 10.5 2 9 2.5 9 3.5zM8 12h8"/></svg>',
  gift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v9H5v-9"/><path d="M12 8c-2 0-3.5-1.5-3.5-3S9.5 2 11 2c2 0 3 2 3 4M12 8c2 0 3.5-1.5 3.5-3S14.5 2 13 2c-2 0-3 2-3 4"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>',
  dollarSign: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5.5c-.8-1-2.5-1.8-5-1.8-3 0-5 1.5-5 3.8s2 3.2 5 3.8c3 .6 5 1.7 5 3.9 0 2.3-2 3.8-5 3.8-2.5 0-4.2-.8-5-1.8"/></svg>',
  car: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17h14M5 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM19 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/><path d="M5 17l1.5-5.5A2 2 0 0 1 8.4 10h7.2a2 2 0 0 1 1.9 1.5L19 17"/><path d="M3 13h18"/></svg>',
  utensils: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2s2-.9 2-2V2M5 11v11M17 2v20M17 2c-2.2 0-4 2-4 5s1.8 5 4 5"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10"/></svg>',
  mapPin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  signature: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17s2-1 3-3 1-4 3-4 1 5 3 5 2-6 4-6 1 4 3 4 2-1 2-1"/><path d="M3 21h18"/></svg>',
  filter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16l-6.5 8v6l-3 2v-8z"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>',
  loader: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"/></svg>',
  hourglass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h12"/><path d="M6 22h12"/><path d="M6 2v3.34a4 4 0 0 0 1.17 2.83L12 12l4.83-3.83A4 4 0 0 0 18 5.34V2"/><path d="M6 22v-3.34a4 4 0 0 1 1.17-2.83L12 12l4.83 3.83A4 4 0 0 1 18 18.66V22"/></svg>',
  timeline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="12" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v3M6 14v3M11 5h9M11 12h9M11 19h6"/></svg>',
  clipboardCheck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 13l2 2 4-4"/></svg>',
  archive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M10 12h4"/></svg>',
  trendingUp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>',
  award: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="6"/><path d="M8.2 13.8 7 22l5-3 5 3-1.2-8.2"/></svg>',
  zap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
};

// ---------------------------------------------------------------------------
// Navegação por perfil
// ---------------------------------------------------------------------------
const NAV_COLABORADOR = [
  { group: "Meu espaço" },
  { href: "dashboard.html", label: "Dashboard", curto: "Início", icon: ICONS.overview },
  { href: "perfil.html", label: "Meu Perfil", curto: "Perfil", icon: ICONS.user },
  { href: "historia.html", label: "Minha História", curto: "História", icon: ICONS.timeline },
  { href: "ponto.html", label: "Ponto / Jornada", curto: "Ponto", icon: ICONS.clock },
  { href: "ferias.html", label: "Férias", curto: "Férias", icon: ICONS.palmTree },
  { href: "documentos.html", label: "Holerites e Documentos", curto: "Docs", icon: ICONS.fileText },
  { href: "beneficios.html", label: "Benefícios", curto: "Benef.", icon: ICONS.heart },
  { href: "solicitacoes.html", label: "Solicitações", curto: "Solicit.", icon: ICONS.messageSquare },
  { href: "comunicados.html", label: "Comunicados", curto: "Avisos", icon: ICONS.megaphone },
];

const NAV_RH = [
  { group: "Gestão de RH" },
  { href: "dashboard.html", label: "Dashboard", curto: "Início", icon: ICONS.overview },
  { href: "colaboradores.html", label: "Colaboradores", curto: "Pessoas", icon: ICONS.users },
  { href: "ferias.html", label: "Férias", curto: "Férias", icon: ICONS.palmTree },
  { href: "ponto.html", label: "Jornada / Ponto", curto: "Ponto", icon: ICONS.clock },
  { href: "documentos.html", label: "Documentos", curto: "Docs", icon: ICONS.fileText },
  { href: "beneficios.html", label: "Benefícios", curto: "Benef.", icon: ICONS.heart },
  { href: "solicitacoes.html", label: "Solicitações", curto: "Solicit.", icon: ICONS.messageSquare },
  { href: "comunicados.html", label: "Comunicados", curto: "Avisos", icon: ICONS.megaphone },
  { href: "relatorios.html", label: "Relatórios", curto: "Relat.", icon: ICONS.reports },
  { href: "configuracoes.html", label: "Configurações", curto: "Config.", icon: ICONS.settings },
];

function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase();
}

function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtDate(iso) {
  if (!iso || iso === "—") return iso || "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const STATUS_LABELS = {
  APROVADA: "Aprovada",
  EM_ANALISE: "Em análise",
  PENDENTE: "Pendente",
  RECUSADA: "Recusada",
  CANCELADA: "Cancelada",
  RESOLVIDA: "Resolvida",
  ATIVO: "Ativo",
  AFASTADO: "Afastado",
  INATIVO: "Inativo",
  ENVIADO: "Enviado",
  PUBLICADO: "Publicado",
  AGENDADO: "Agendado",
  ARQUIVADO: "Arquivado",
  PRE_APROVADA: "Pré-aprovada",
  PRE_APROVADO: "Pré-aprovado",
  APROVADO: "Aprovado",
  RECUSADO: "Recusado",
  SUSPENSO: "Suspenso",
  ENCERRADO: "Encerrado",
};

/**
 * Rótulo/selo do papel do usuário (COLABORADOR | RH | RH_ADMIN), no mesmo
 * padrão usado em Configurações > Usuários e permissões — usado em toda a
 * navegação (barra lateral, cabeçalho, menu do usuário) para que um
 * RH_ADMIN seja sempre identificado como RH, nunca como colaborador comum.
 */
const RH_ROLE_INFO = {
  RH_ADMIN: { badgeClass: "badge-admin", label: "RH · Administrador" },
  RH: { badgeClass: "badge-viewer", label: "RH · Analista" },
  COLABORADOR: { badgeClass: "badge-neutral", label: "Colaborador" },
};

/** true para qualquer papel do portal de RH (RH ou RH_ADMIN). */
function isRhStaffRole(role) {
  return role === "RH" || role === "RH_ADMIN";
}

function rhRoleInfo(role) {
  return RH_ROLE_INFO[role] || RH_ROLE_INFO.COLABORADOR;
}

/**
 * Clona `navItems` aplicando contadores (badge) por href — ex.:
 * withBadges(NAV_RH, { "solicitacoes.html": 7 }).
 */
function withBadges(navItems, badgeMap) {
  return navItems.map((item) => (item.href && badgeMap[item.href] ? { ...item, badge: badgeMap[item.href] } : item));
}

// ---------------------------------------------------------------------------
// Fotos dos colaboradores nas telas do RH. O mapa é preenchido uma vez por
// página (rhCarregarFotosColaboradores, em js/rh-supabase-auth.js) logo
// depois do login do RH; avatarInner() mostra a foto quando existir e as
// iniciais quando não houver (ou se a imagem falhar ao carregar).
// ---------------------------------------------------------------------------
window.RH_FOTOS_POR_NOME = window.RH_FOTOS_POR_NOME || {};
function rhNomeChaveFoto(nome) {
  return String(nome || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase().replace(/\s+/g, " ");
}
function fotoColaborador(nome) {
  return window.RH_FOTOS_POR_NOME[rhNomeChaveFoto(nome)] || null;
}
function avatarInner(nome, fotoUrl) {
  const url = fotoUrl || fotoColaborador(nome);
  const ini = initials(nome);
  if (!url) return ini;
  return `<img src="${esc(url)}" alt="" loading="lazy" data-ini="${esc(ini)}" onerror="this.parentNode&&(this.parentNode.textContent=this.dataset.ini)" />`;
}

function avatarColorClass(name) {
  const n = (name || "").split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return `c-${(n % 6) + 1}`;
}

/**
 * Monta a barra lateral (desktop) + topo (mobile) + navegação inferior
 * (mobile), a partir do perfil logado. `navItems` é NAV_COLABORADOR ou
 * NAV_RH; `homeHref` é o link do logo (ex.: "dashboard.html").
 */
function renderShell(profile, navItems) {
  const currentReal = window.location.pathname.split("/").pop() || "dashboard.html";
  document.body.dataset.screen = currentReal.replace(/\.html$/, "");
  const ehRhStaff = isRhStaffRole(profile.role);
  document.body.classList.toggle("is-rh", ehRhStaff);
  document.body.classList.toggle("is-colaborador", !ehRhStaff);
  const linkItems = navItems.filter((i) => i.href);
  // Abonos e História do Colaborador (RH) ficam dentro de Jornada / Ponto:
  // não têm item próprio no menu, então o item ativo é "Jornada / Ponto".
  const SUBPAGINAS_DO_MENU = { "abonos.html": "ponto.html", "historia.html": "ponto.html" };
  const current = !linkItems.some((i) => i.href === currentReal) && SUBPAGINAS_DO_MENU[currentReal] ? SUBPAGINAS_DO_MENU[currentReal] : currentReal;

  const navHtml = navItems
    .map((item) =>
      item.group
        ? `<span class="sidebar-nav-label">${esc(item.group)}</span>`
        : `<a href="${item.href}" class="${item.href === current ? "active" : ""}">${item.icon}<span>${item.label}</span>${item.badge ? `<span class="nav-badge">${item.badge}</span>` : ""}</a>`
    )
    .join("");

  const mobilePriority = ehRhStaff
    ? ["dashboard.html", "colaboradores.html", "ponto.html", "ferias.html"]
    : ["dashboard.html", "ponto.html", "ferias.html", "solicitacoes.html"];
  const mobileItems = mobilePriority.map((href) => linkItems.find((item) => item.href === href)).filter(Boolean);
  const mobileRest = linkItems.filter((item) => !mobileItems.some((activeItem) => activeItem.href === item.href));
  const mobileHasMore = mobileRest.length > 0;
  const navCelularHtml = mobileItems
    .map(
      (item) =>
        `<a href="${item.href}" class="${item.href === current ? "active" : ""}"${item.href === current ? ' aria-current="page"' : ""}>${item.icon}<span>${item.curto}</span></a>`
    )
    .join("")
    + (mobileHasMore
      ? `<button type="button" class="mobile-more-trigger ${mobileRest.some((item) => item.href === current) ? "active" : ""}" id="mobile-more-btn" aria-expanded="false">${ICONS.menu}<span>Mais</span></button>`
      : "");
  const mobileMoreHtml = mobileHasMore
    ? `<div class="mobile-more-panel" id="mobile-more-panel" aria-hidden="true">${mobileRest.map((item) => `<a href="${item.href}" class="${item.href === current ? "active" : ""}">${item.icon}<span>${item.label}</span>${item.badge ? `<span class="nav-badge">${item.badge}</span>` : ""}</a>`).join("")}</div>`
    : "";

  const roleInfo = rhRoleInfo(profile.role);
  const roleLabel = roleInfo.label;
  const roleBadge = `<span class="badge ${roleInfo.badgeClass}">${roleInfo.label}</span>`;

  document.getElementById("app-header").innerHTML = `
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="brand-row">
          <img class="logo-mark" src="${assetPath("bsconta-logo.jpg")}" alt="BSconta+" />
          <div>
            <h1>BSconta<sup>+</sup></h1>
            <p>Gestão de Pessoas</p>
          </div>
        </div>
        <button type="button" class="sidebar-collapse-btn" id="sidebar-collapse" aria-label="Recolher menu" title="Recolher menu">${ICONS.chevronLeft}</button>
      </div>
      <div class="sidebar-current-module" aria-hidden="true">
        <span class="sidebar-current-dot"></span>
        <span>${ehRhStaff ? "Painel administrativo" : "Área do colaborador"}</span>
      </div>
      <nav class="sidebar-nav">${navHtml}</nav>
      <div class="sidebar-foot">
        <div class="sidebar-user" id="sidebar-user-btn">
          <div class="avatar ${avatarColorClass(profile.name)}">${profile.photo ? `<img src="${profile.photo}" alt="" />` : initials(profile.name)}</div>
          <div>
            <p class="sidebar-user-name">${esc(profile.name || "")}</p>
            <p class="sidebar-user-role">${roleLabel}</p>
          </div>
          <span class="chevron">${ICONS.chevronDown}</span>
          ${sidebarUserDropdownHtml(profile)}
        </div>
        <button class="btn-logout" id="btn-logout">${ICONS.logout} Sair</button>
      </div>
    </aside>
    <div class="mobile-topbar">
      <div class="brand-row">
        <img class="logo-mark" style="width:28px;height:28px" src="${assetPath("bsconta-logo.jpg")}" alt="BSconta+" />
        <div>
          <strong style="font-size:.84rem">BSconta+</strong>
          <div class="mobile-module-label">${screenTitleForShell(document.body.dataset.screen, profile)}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:0.4rem">
        ${roleBadge}
        <button class="btn-logout" id="btn-logout-mobile" style="width:auto">${ICONS.logout} Sair</button>
      </div>
    </div>
    ${mobileMoreHtml}
    <nav class="mobile-nav" style="grid-template-columns:repeat(${Math.min(mobileItems.length + (mobileHasMore ? 1 : 0), 5)},1fr)" aria-label="Navegação principal">${navCelularHtml}</nav>
  `;

  document.getElementById("btn-logout").addEventListener("click", logout);
  document.getElementById("btn-logout-mobile")?.addEventListener("click", logout);

  const mobileMoreBtn = document.getElementById("mobile-more-btn");
  const mobileMorePanel = document.getElementById("mobile-more-panel");
  mobileMoreBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = mobileMorePanel?.classList.toggle("open");
    mobileMoreBtn.setAttribute("aria-expanded", open ? "true" : "false");
    mobileMorePanel?.setAttribute("aria-hidden", open ? "false" : "true");
  });
  document.addEventListener("click", () => {
    mobileMorePanel?.classList.remove("open");
    mobileMoreBtn?.setAttribute("aria-expanded", "false");
    mobileMorePanel?.setAttribute("aria-hidden", "true");
  });

  const collapseBtn = document.getElementById("sidebar-collapse");
  const savedCollapsed = localStorage.getItem("bsconta.sidebar.collapsed") === "1";
  document.body.classList.toggle("sidebar-collapsed", savedCollapsed);
  collapseBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const collapsed = document.body.classList.toggle("sidebar-collapsed");
    localStorage.setItem("bsconta.sidebar.collapsed", collapsed ? "1" : "0");
    collapseBtn.setAttribute("aria-label", collapsed ? "Expandir menu" : "Recolher menu");
    collapseBtn.setAttribute("title", collapsed ? "Expandir menu" : "Recolher menu");
  });

  const userBtn = document.getElementById("sidebar-user-btn");
  userBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    userBtn.querySelector(".dropdown-panel").classList.toggle("open");
  });
  document.addEventListener("click", () => userBtn.querySelector(".dropdown-panel")?.classList.remove("open"));
}

function screenTitleForShell(screen, profile) {
  const labels = {
    dashboard: "Dashboard", colaboradores: "Colaboradores", ponto: "Jornada", ferias: "Férias",
    solicitacoes: "Solicitações", documentos: "Documentos", comunicados: "Comunicados",
    relatorios: "Relatórios", configuracoes: "Configurações", perfil: "Meu perfil", beneficios: "Benefícios",
    historia: isRhStaffRole(profile.role) ? "História do Colaborador" : "Minha História", abonos: "Abonos"
  };
  return isRhStaffRole(profile.role) ? (labels[screen] || "Gestão de RH") : (labels[screen] || "Meu espaço");
}

function sidebarUserDropdownHtml(profile) {
  const ehRhStaff = isRhStaffRole(profile.role);
  const profileHref = ehRhStaff ? "configuracoes.html" : "perfil.html";
  return `
    <div class="dropdown-panel" style="left:0;right:auto;bottom:100%;top:auto;margin-bottom:8px;">
      <div class="dd-head"><p class="name">${esc(profile.name)}</p><p class="email">${esc(profile.email || "")}</p></div>
      <hr />
      <a class="dd-item" href="${profileHref}">${ICONS.user} ${ehRhStaff ? "Minha conta" : "Meu perfil"}</a>
      <button type="button" class="dd-item danger" id="dd-logout">${ICONS.logout} Sair</button>
    </div>
  `;
}

/**
 * Cabeçalho superior de cada página: breadcrumb/título, busca opcional,
 * sino de notificações e menu do usuário. Chame após montar o resto da
 * página, passando `{ search: true, notifications: [...] }`.
 */
function renderTopHeader(container, profile, opts = {}) {
  const notifications = opts.notifications || [];
  const unread = notifications.filter((n) => n.unread).length;

  const screenLabels = {
    dashboard: "Visão geral", colaboradores: "Pessoas", ponto: "Jornada", ferias: "Férias",
    solicitacoes: "Solicitações", documentos: "Documentos", comunicados: "Comunicação",
    relatorios: "Relatórios", configuracoes: "Configurações", perfil: "Meu perfil", beneficios: "Benefícios",
    historia: "História", abonos: "Abonos"
  };
  const screenLabel = screenLabels[document.body.dataset.screen] || "BSconta+ RH";
  const screenContext = isRhStaffRole(profile.role) ? `Gestão de RH · ${screenLabel}` : `Meu espaço · ${screenLabel}`;

  container.innerHTML = `
    <div class="top-context"><span class="top-context-dot"></span><span>${screenContext}</span></div>
    <div class="top-header-spacer" aria-hidden="true"></div>
    ${opts.search ? `<div class="top-search">${ICONS.search}<input type="text" placeholder="Buscar..." /></div>` : ""}
    <div class="notif-wrap">
      <button type="button" class="icon-btn" id="th-notif-btn" aria-label="Notificações">${ICONS.bell}${unread ? '<span class="dot"></span>' : ""}</button>
      <div class="dropdown-panel notif-panel" id="th-notif-panel">
        <p class="notif-title">Notificações</p>
        ${
          notifications.length
            ? notifications
                .map(
                  (n) => `
          <div class="notif-item ${n.unread ? "unread" : ""}">
            <div class="notif-icon">${n.icon || ICONS.bell}</div>
            <div class="notif-text">
              <p>${n.text}</p>
              <p class="notif-time">${esc(n.time)}</p>
            </div>
          </div>`
                )
                .join("")
            : `<div class="notif-empty">Nenhuma notificação por aqui.</div>`
        }
      </div>
    </div>
    <button type="button" class="header-user-btn" id="th-user-btn">
      <div class="avatar ${avatarColorClass(profile.name)}" style="width:30px;height:30px;font-size:0.7rem">${profile.photo ? `<img src="${profile.photo}" alt="" />` : initials(profile.name)}</div>
      <span>${esc((profile.name || "").split(" ")[0])}</span>
      ${ICONS.chevronDown.replace("<svg ", '<svg class="chev" ')}
    </button>
  `;

  const notifBtn = container.querySelector("#th-notif-btn");
  const notifPanel = container.querySelector("#th-notif-panel");
  notifBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    notifPanel.classList.toggle("open");
  });

  const userBtn = container.querySelector("#th-user-btn");
  const ehRhStaffTopo = isRhStaffRole(profile.role);
  const profileHref = ehRhStaffTopo ? "configuracoes.html" : "perfil.html";
  const userDrop = document.createElement("div");
  userDrop.className = "dropdown-panel";
  userDrop.innerHTML = `
    <div class="dd-head"><p class="name">${esc(profile.name)}</p><p class="email">${esc(profile.email || "")}</p></div>
    <hr />
    <a class="dd-item" href="${profileHref}">${ICONS.user} ${ehRhStaffTopo ? "Minha conta" : "Meu perfil"}</a>
    <button type="button" class="dd-item danger" id="th-logout">${ICONS.logout} Sair</button>
  `;
  userBtn.parentElement.style.position = "relative";
  userBtn.insertAdjacentElement("afterend", userDrop);
  userBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    userDrop.classList.toggle("open");
  });
  userDrop.querySelector("#th-logout").addEventListener("click", logout);

  document.addEventListener("click", () => {
    notifPanel.classList.remove("open");
    userDrop.classList.remove("open");
  });

  if (!isRhStaffRole(profile.role) && profile.employeeId) {
    anexarNotificacoesPersistentes(container, profile, notifBtn, notifPanel);
  }
}

/**
 * Colaborador: acrescenta ao sino as notificações persistentes enviadas
 * pelo RH (rh.notificacoes — benefício, abono, férias, ajuste de ponto...).
 * Só ACRESCENTA itens ao que a página já mostra; se a tabela ainda não
 * existir (migração 22 não aplicada) ou der qualquer erro, não faz nada —
 * nunca quebra o cabeçalho. Abrir o sino marca as não lidas como lidas.
 */
async function anexarNotificacoesPersistentes(container, profile, notifBtn, notifPanel) {
  try {
    if (!window.sb) return;
    const [notifRes, descontosRes] = await Promise.all([
      sb.from("notificacoes").select("id, titulo, mensagem, tipo, lida_em, created_at").eq("colaborador_id", profile.employeeId).order("created_at", { ascending: false }).limit(8),
      // Benefícios com desconto ATIVOS: sempre aparecem no sino, para o
      // colaborador saber o que é descontado dele.
      sb.from("colaborador_beneficios").select("beneficio, valor_desconto, periodicidade, data_inicio").eq("colaborador_id", profile.employeeId).eq("status", "ATIVO").eq("possui_desconto", true),
    ]);
    const data = notifRes.error ? [] : notifRes.data || [];
    const descontos = descontosRes.error ? [] : descontosRes.data || [];
    if (!data.length && !descontos.length) return;
    const naoLidas = data.filter((n) => !n.lida_em);
    const iconePorTipo = { BENEFICIO: ICONS.heart, ABONO: ICONS.clipboardCheck, FERIAS: ICONS.palmTree, AJUSTE_PONTO: ICONS.clock, HISTORICO: ICONS.timeline };
    const periodicidadeTxt = { MENSAL: "por mês", QUINZENAL: "por quinzena", SEMANAL: "por semana", DIARIO: "por dia", ANUAL: "por ano", UNICO: "uma vez" };
    const htmlDescontos = descontos
      .map((d) => `
          <a class="notif-item" href="${window.BASE_PATH || "../"}colaborador/beneficios.html" style="text-decoration:none;color:inherit">
            <div class="notif-icon" style="color:var(--amber-700)">${ICONS.dollarSign}</div>
            <div class="notif-text">
              <p><strong>Desconto: ${esc(d.beneficio)}</strong> — ${Number(d.valor_desconto || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} ${periodicidadeTxt[d.periodicidade] || ""}</p>
              <p class="notif-time">Desde ${esc(new Date(d.data_inicio + "T00:00:00").toLocaleDateString("pt-BR"))}</p>
            </div>
          </a>`)
      .join("");
    const html = htmlDescontos + data
      .map((n) => `
          <div class="notif-item ${n.lida_em ? "" : "unread"}">
            <div class="notif-icon">${iconePorTipo[n.tipo] || ICONS.bell}</div>
            <div class="notif-text">
              <p><strong>${esc(n.titulo)}</strong>${n.mensagem ? ` — ${esc(n.mensagem)}` : ""}</p>
              <p class="notif-time">${esc(new Date(n.created_at).toLocaleDateString("pt-BR"))}</p>
            </div>
          </div>`)
      .join("");
    notifPanel.querySelector(".notif-empty")?.remove();
    notifPanel.querySelector(".notif-title").insertAdjacentHTML("afterend", html);
    if (naoLidas.length && !notifBtn.querySelector(".dot")) notifBtn.insertAdjacentHTML("beforeend", '<span class="dot"></span>');
    notifBtn.addEventListener("click", () => {
      if (!naoLidas.length) return;
      sb.rpc("notificacao_marcar_lida", { p_id: null }).then(() => notifBtn.querySelector(".dot")?.remove());
      naoLidas.length = 0;
    });
  } catch (e) {
    console.warn("Notificações persistentes indisponíveis:", e);
  }
}

// ---------------------------------------------------------------------------
// KPI cards
// ---------------------------------------------------------------------------
function kpiCardHtml({ label, value, change, format = "number", tone = "blue", sub, icon, chevron }) {
  const displayValue =
    format === "currency" ? brl(value) : format === "percent" ? `${Number(value).toFixed(0)}%` : format === "text" ? value : Number(value).toLocaleString("pt-BR");
  const hasChange = change !== undefined;
  const isUp = (change ?? 0) >= 0;
  const changeClass = change == null ? "neutral" : isUp ? "up" : "down";
  const changeText = change == null ? "" : `${isUp ? "↑" : "↓"} ${Math.abs(change).toFixed(0)}% vs. mês anterior`;
  const changeHtml = sub ? `<p class="kpi-change neutral">${esc(sub)}</p>` : hasChange ? `<p class="kpi-change ${changeClass}">${changeText}</p>` : "";

  return `
    <div class="kpi-card kpi-card--icon tone-${tone}">
      ${chevron ? `<span class="kpi-chevron">${ICONS.chevronRight}</span>` : ""}
      <div class="kpi-card-top">
        <div class="kpi-icon tone-${tone}">${icon}</div>
        <p class="kpi-label">${label}</p>
      </div>
      <p class="kpi-value">${displayValue}</p>
      ${changeHtml}
    </div>
  `;
}

function renderKpiGrid(container, cards, cols5) {
  container.className = cols5 ? "kpi-grid cols-5" : "kpi-grid";
  container.innerHTML = cards.map(kpiCardHtml).join("");
}

function brl(v) {
  return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ---------------------------------------------------------------------------
// Badges e status
// ---------------------------------------------------------------------------
function statusBadgeHtml(status, labelsMap) {
  const labels = labelsMap || {};
  return `<span class="status-badge status-${status}">${labels[status] || status}</span>`;
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
function initTabs(root) {
  const buttons = root.querySelectorAll(".tab-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      root.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      root.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      root.querySelector(`#${btn.dataset.tab}`)?.classList.add("active");
    });
  });
}

// ---------------------------------------------------------------------------
// Modal genérico
// ---------------------------------------------------------------------------
function openModal(id) {
  document.getElementById(id)?.classList.add("open");
}
function closeModal(id) {
  document.getElementById(id)?.classList.remove("open");
}
function wireModalClosers() {
  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.classList.remove("open");
    });
    overlay.querySelectorAll("[data-close-modal]").forEach((btn) => btn.addEventListener("click", () => overlay.classList.remove("open")));
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") document.querySelectorAll(".modal-overlay.open").forEach((o) => o.classList.remove("open"));
  });
}

/**
 * Modal de confirmação padronizado (substitui window.confirm em ações
 * destrutivas ou sensíveis, que abrem um alerta feio do navegador).
 * Uso: const ok = await confirmDialog({ title, message, confirmLabel, danger: true });
 */
function confirmDialog({ title = "Confirmar ação", message = "", confirmLabel = "Confirmar", cancelLabel = "Cancelar", danger = false, icon } = {}) {
  return new Promise((resolve) => {
    let overlay = document.getElementById("confirm-dialog-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "confirm-dialog-overlay";
      overlay.className = "modal-overlay";
      overlay.innerHTML = `
        <div class="modal confirm-dialog">
          <div class="confirm-dialog-body">
            <div class="confirm-dialog-icon"></div>
            <div class="confirm-dialog-text">
              <h3 class="confirm-dialog-title"></h3>
              <p class="confirm-dialog-message"></p>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn-ghost" data-confirm-cancel></button>
            <button type="button" class="btn-primary auto" data-confirm-ok></button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    }

    const iconEl = overlay.querySelector(".confirm-dialog-icon");
    const titleEl = overlay.querySelector(".confirm-dialog-title");
    const msgEl = overlay.querySelector(".confirm-dialog-message");
    const cancelBtn = overlay.querySelector("[data-confirm-cancel]");
    const okBtn = overlay.querySelector("[data-confirm-ok]");

    iconEl.className = "confirm-dialog-icon" + (danger ? " danger" : "");
    iconEl.innerHTML = icon || (danger ? ICONS.trash : ICONS.alertCircle);
    titleEl.textContent = title;
    msgEl.textContent = message;
    cancelBtn.textContent = cancelLabel;
    okBtn.textContent = confirmLabel;
    okBtn.className = "auto " + (danger ? "btn-danger" : "btn-primary");

    const finish = (result) => {
      overlay.classList.remove("open");
      document.removeEventListener("keydown", onKey, true);
      overlay.removeEventListener("mousedown", onBackdrop);
      cancelBtn.removeEventListener("click", onCancel);
      okBtn.removeEventListener("click", onOk);
      resolve(result);
    };
    const onCancel = () => finish(false);
    const onOk = () => finish(true);
    const onBackdrop = (e) => { if (e.target === overlay) finish(false); };
    const onKey = (e) => { if (e.key === "Escape") finish(false); };

    cancelBtn.addEventListener("click", onCancel);
    okBtn.addEventListener("click", onOk);
    overlay.addEventListener("mousedown", onBackdrop);
    document.addEventListener("keydown", onKey, true);

    requestAnimationFrame(() => overlay.classList.add("open"));
    okBtn.focus();
  });
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
function toastStackEl() {
  let el = document.getElementById("toast-stack");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast-stack";
    el.className = "toast-stack";
    document.body.appendChild(el);
  }
  return el;
}
function showToast(message, type = "info") {
  const icons = { success: ICONS.check, error: ICONS.x, info: ICONS.bell };
  const stack = toastStackEl();
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span>${esc(message)}</span>`;
  stack.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 250);
  }, 3200);
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------
function emptyStateHtml({ icon, title, desc, actionLabel, actionId }) {
  return `
    <div class="empty-state">
      <div class="empty-state-icon">${icon || ICONS.fileText}</div>
      <h3>${esc(title)}</h3>
      ${desc ? `<p>${esc(desc)}</p>` : ""}
      ${actionLabel ? `<button type="button" class="btn-small" id="${actionId || ""}">${esc(actionLabel)}</button>` : ""}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Anel de progresso circular (SVG) — usado em férias e banco de horas
// ---------------------------------------------------------------------------
function progressRingSvg({ size = 108, stroke = 10, pct = 0, colorVar = "--indigo-500" }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(Math.max(pct, 0), 100) / 100) * c;
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${stroke}" />
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(${colorVar})" stroke-width="${stroke}"
        stroke-dasharray="${c}" stroke-dashoffset="${offset}" stroke-linecap="round" />
    </svg>
  `;
}

function loadingHtml() {
  return `<div class="loading-wrap"><div class="spinner"></div></div>`;
}

// ---------------------------------------------------------------------------
// Local do ponto — geolocalização (real, via navegador) + modal de confirmação
// ---------------------------------------------------------------------------
const LOCAL_PONTO_LABELS = { HOME_OFFICE: "Home Office", PRESENCIAL: "Na empresa" };

/** Distância em metros entre duas coordenadas (fórmula de Haversine). */
function distanciaMetros(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Tenta obter a localização real do navegador (Geolocation API). Resolve
 * sempre (nunca rejeita) com { ok, lat, lng, precisao } ou { ok:false,
 * motivo } — quem chama decide o que mostrar quando falhar (o colaborador
 * sempre pode escolher o local manualmente).
 */
function capturarLocalizacao(timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) {
      resolve({ ok: false, motivo: "Este navegador não suporta localização." });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ ok: true, lat: pos.coords.latitude, lng: pos.coords.longitude, precisao: Math.round(pos.coords.accuracy) }),
      (err) => resolve({ ok: false, motivo: err.code === 1 ? "Permissão de localização negada." : "Não foi possível obter sua localização." }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 }
    );
  });
}

function localBadgeHtml(local) {
  if (!local) return `<span class="local-badge none">—</span>`;
  const icon = local === "HOME_OFFICE" ? ICONS.home : ICONS.building;
  return `<span class="local-badge ${local === "HOME_OFFICE" ? "ho" : "pres"}">${icon}${LOCAL_PONTO_LABELS[local]}</span>`;
}

function geoLinkHtml(geo) {
  if (!geo) return "";
  const precisao = Number.isFinite(Number(geo.precisao)) ? ` (precisão ~${Math.round(Number(geo.precisao))}m)` : "";
  return `<a href="https://www.google.com/maps?q=${encodeURIComponent(geo.lat + "," + geo.lng)}" target="_blank" rel="noopener" class="geo-link" title="Abrir localização do ponto no Google Maps${precisao}" aria-label="Abrir localização do ponto no Google Maps">${ICONS.mapPin}</a>`;
}

// geoLinkForPonto(geo, iso) — usada nas tabelas de Histórico (colaborador e
// RH). ATENÇÃO: existia aqui um gerador de coordenadas FALSAS
// (DEMO_GEO_POINTS / demoGeoForDate), que inventava uma latitude/longitude
// a partir dos dígitos da data sempre que o registro não tinha geo real
// salvo — ou seja, o pin do mapa podia abrir uma localização inventada,
// nunca capturada de fato, sem nenhuma indicação visual de que era falsa.
// Isso é exatamente o tipo de "localização mockada/de desenvolvimento
// usada indevidamente" que não pode existir no fluxo real: removido.
// Agora, sem geo real salvo (registro antigo, ou local marcado sem
// permissão de localização concedida na hora), simplesmente não há link —
// nunca mostramos uma localização que não foi realmente coletada.
function geoLinkForPonto(geo, iso) {
  return geoLinkHtml(geo);
}

/**
 * Verifica se uma leitura de localização está dentro da área da empresa.
 * Considera a imprecisão do GPS até o teto EMPRESA_INFO.toleranciaPrecisaoMaxMetros.
 */
function avaliarLocalEmpresa(geo) {
  const dist = Math.round(distanciaMetros(geo.lat, geo.lng, EMPRESA_INFO.lat, EMPRESA_INFO.lng));
  const tolerancia = Math.min(Number(geo.precisao) || 0, EMPRESA_INFO.toleranciaPrecisaoMaxMetros ?? 100);
  return { dist, naEmpresa: dist - tolerancia <= EMPRESA_INFO.raioPresencialMetros };
}

function fmtDistancia(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1).replace(".", ",")} km` : `${m} m`;
}

/**
 * Abre (criando se preciso) o modal de "onde você está registrando o
 * ponto" — chamado no PRIMEIRO ponto do dia.
 *
 * TRAVA DE LOCALIZAÇÃO: "Na empresa" só fica liberado quando o navegador
 * devolve uma localização dentro do raio da sede (EMPRESA_INFO). Fora do
 * raio, com permissão negada ou sem GPS, o botão fica bloqueado e só dá pra
 * registrar como Home Office — evita marcar "Na empresa" por engano.
 * Home Office é sempre permitido. `onConfirm(local, geo)` ao confirmar.
 */
function abrirModalLocalPonto(onConfirm) {
  let overlay = document.getElementById("modal-local-ponto");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "modal-local-ponto";
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal modal-sm">
        <div class="modal-header"><h3>Onde você está registrando o ponto?</h3></div>
        <div class="modal-body">
          <div id="local-ponto-status" class="local-status"></div>
          <div class="local-choice-grid">
            <button type="button" class="local-choice" data-local="HOME_OFFICE">${ICONS.home}<span>Home Office</span></button>
            <button type="button" class="local-choice" data-local="PRESENCIAL">${ICONS.building}<span>Na empresa</span><small class="local-lock-note"></small></button>
          </div>
          <p class="local-empresa-end">${ICONS.mapPin}<span>${esc(EMPRESA_INFO.nome)} · ${esc(EMPRESA_INFO.endereco)}</span></p>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  }
  overlay.classList.add("open");
  const statusEl = overlay.querySelector("#local-ponto-status");
  const choices = overlay.querySelectorAll(".local-choice");
  const btnEmpresa = overlay.querySelector('[data-local="PRESENCIAL"]');
  const noteEmpresa = btnEmpresa.querySelector(".local-lock-note");

  let geoResult = null;
  let empresaLiberada = false;
  let tentativa = 0;

  function bloquearEmpresa(nota) {
    empresaLiberada = false;
    btnEmpresa.disabled = true;
    btnEmpresa.classList.add("locked");
    btnEmpresa.setAttribute("aria-disabled", "true");
    noteEmpresa.textContent = nota;
  }

  function obterLocalizacao() {
    const minha = ++tentativa;
    geoResult = null;
    choices.forEach((b) => b.classList.remove("suggested"));
    bloquearEmpresa("Verificando…");
    statusEl.className = "local-status";
    statusEl.innerHTML = `<span class="spinner spinner-sm"></span> Obtendo sua localização…`;
    capturarLocalizacao(12000).then((res) => {
      if (minha !== tentativa || !overlay.classList.contains("open")) return;
      if (!res.ok) {
        bloquearEmpresa("Precisa da localização");
        statusEl.className = "local-status warn";
        statusEl.innerHTML = `${ICONS.alertCircle}<span>${esc(res.motivo)} Para marcar <strong>Na empresa</strong>, permita a localização no navegador. <button type="button" class="local-retry">${ICONS.refresh}Tentar de novo</button></span>`;
        overlay.querySelector('[data-local="HOME_OFFICE"]').classList.add("suggested");
        return;
      }
      geoResult = { lat: res.lat, lng: res.lng, precisao: res.precisao };
      const { dist, naEmpresa } = avaliarLocalEmpresa(geoResult);
      if (naEmpresa) {
        empresaLiberada = true;
        btnEmpresa.disabled = false;
        btnEmpresa.classList.remove("locked");
        btnEmpresa.removeAttribute("aria-disabled");
        noteEmpresa.textContent = "";
        btnEmpresa.classList.add("suggested");
        statusEl.className = "local-status ok";
        statusEl.innerHTML = `${ICONS.mapPin}<span>Você está <strong>na empresa</strong> (a ~${fmtDistancia(dist)}, precisão ~${res.precisao} m). Confirme abaixo:</span>`;
      } else {
        bloquearEmpresa("Fora da empresa");
        overlay.querySelector('[data-local="HOME_OFFICE"]').classList.add("suggested");
        statusEl.className = "local-status warn";
        statusEl.innerHTML = `${ICONS.alertCircle}<span>Você está a <strong>~${fmtDistancia(dist)}</strong> da empresa (precisão ~${res.precisao} m). "Na empresa" só pode ser marcado dentro de ${EMPRESA_INFO.raioPresencialMetros} m da sede. <button type="button" class="local-retry">${ICONS.refresh}Verificar de novo</button></span>`;
      }
    });
  }

  if (!overlay.dataset.wired) {
    overlay.dataset.wired = "1";
    overlay.addEventListener("click", (e) => {
      if (e.target.closest(".local-retry")) overlay._retry?.();
    });
  }
  overlay._retry = obterLocalizacao;
  obterLocalizacao();

  const handler = (e) => {
    const btn = e.target.closest(".local-choice");
    if (!btn) return;
    if (btn.dataset.local === "PRESENCIAL" && !empresaLiberada) {
      showToast("Para marcar \u201cNa empresa\u201d você precisa estar no local e com a localização permitida.", "error");
      return;
    }
    overlay.classList.remove("open");
    tentativa++;
    choices.forEach((b) => b.removeEventListener("click", handler));
    onConfirm(btn.dataset.local, geoResult);
  };
  choices.forEach((b) => b.addEventListener("click", handler));
}

// ---------------------------------------------------------------------------
// Som e alerta de lembrete de ponto (10 minutos antes do horário previsto)
// ---------------------------------------------------------------------------
/** Toca um "tlim" curto e discreto via Web Audio API (sem arquivo de áudio). */
function playChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.14);
      gain.gain.linearRampToValueAtTime(0.16, now + i * 0.14 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.14 + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.14);
      osc.stop(now + i * 0.14 + 0.4);
    });
  } catch {
    /* navegador sem suporte a áudio — o alerta visual ainda aparece */
  }
}

function showReminderToast(message) {
  const stack = toastStackEl();
  const el = document.createElement("div");
  el.className = "toast reminder";
  el.innerHTML = `<span class="toast-icon">${ICONS.bell}</span><span>${esc(message)}</span>`;
  stack.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 250);
  }, 6000);
}

/**
 * Observa o horário previsto do colaborador (DEMO.colaborador.horarioPrevisto)
 * e dispara um alerta visual + sonoro 10 minutos antes da entrada e da
 * saída, enquanto a aba estiver aberta. É um recurso simulado no
 * navegador (sem backend/push real ainda) — por isso só funciona com a
 * página aberta; a versão com notificação do sistema operacional fica para
 * quando houver backend com push real.
 */
function initLembretePonto(horarioPrevisto, pontoHoje) {
  if (!horarioPrevisto) return;
  const hojeStr = new Date().toISOString().slice(0, 10);
  const avisados = JSON.parse(sessionStorage.getItem("bsconta_rh_lembretes") || "{}");

  function checarUmaVez() {
    const agora = new Date();
    const alvos = [
      { tipo: "entrada", hhmm: horarioPrevisto.entrada, jaBatido: !!pontoHoje?.entrada, label: "entrada" },
      { tipo: "saida", hhmm: horarioPrevisto.saida, jaBatido: !!pontoHoje?.saida, label: "saída" },
    ];
    alvos.forEach((alvo) => {
      if (!alvo.hhmm || alvo.jaBatido) return;
      const key = `${hojeStr}:${alvo.tipo}`;
      if (avisados[key]) return;
      const [h, m] = alvo.hhmm.split(":").map(Number);
      const alvoDate = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), h, m, 0);
      const diffMin = (alvoDate - agora) / 60000;
      if (diffMin <= 10 && diffMin > 8.5) {
        showReminderToast(`🔔 Seu horário de ${alvo.label} está próximo. Faltam ${Math.max(1, Math.round(diffMin))} minutos para o registro.`);
        playChime();
        avisados[key] = true;
        sessionStorage.setItem("bsconta_rh_lembretes", JSON.stringify(avisados));
      }
    });
  }

  checarUmaVez();
  setInterval(checarUmaVez, 20000);
}
