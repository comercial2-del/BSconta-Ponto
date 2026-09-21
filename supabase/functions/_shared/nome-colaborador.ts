// =============================================================================
// BSconta+ RH — helper compartilhado entre Edge Functions de acesso
// =============================================================================
// Extraído de supabase/functions/criar-login-colaborador/index.ts para poder
// ser reaproveitado por outras funções (ex.: criar-estagiario-colaborador)
// sem duplicar a lógica de "primeiro nome capitalizado, sem acento" usada em
// todos os padrões de e-mail/senha internos do sistema (BSconta+PrimeiroNome,
// com ou sem sufixo). Não altera nenhum comportamento existente — é a mesma
// função que já rodava em criar-login-colaborador.
// =============================================================================

/** Primeiro nome do colaborador, sem acento e capitalizado — "Ângela Dos
 * Santos" -> "Angela", "MARLON GOMES DA SILVA" -> "Marlon". Usado como base
 * dos padrões "BSconta" + PrimeiroNome já usados no sistema (login
 * automático, regenerar acesso, e agora cadastro de estagiário). */
export function primeiroNomeCapitalizado(nome: string): string {
  const primeiro = nome.trim().split(/\s+/)[0] || "";
  const semAcento = primeiro.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const soLetras = semAcento.replace(/[^a-zA-Z]/g, "");
  if (!soLetras) return "Colaborador";
  return soLetras.charAt(0).toUpperCase() + soLetras.slice(1).toLowerCase();
}

/** Código aleatório de 4 dígitos (com zeros à esquerda quando necessário),
 * no mesmo formato usado pela funcionalidade "Regenerar acesso"
 * (supabase/functions/regenerar-acesso-colaborador) para compor a senha
 * "BSconta" + PrimeiroNome + 4 dígitos. Mantido aqui como único lugar que
 * gera esse sufixo, para as duas funções não divergirem no formato. */
export function sufixoAleatorio4Digitos(): string {
  return String(Math.floor(Math.random() * 10000)).padStart(4, "0");
}
