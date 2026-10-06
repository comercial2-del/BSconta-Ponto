/*
 * BSconta+ RH — Tema (claro / escuro)
 * Carregado no <head> de todas as páginas, antes do corpo, para aplicar o
 * tema sem "piscar" branco. A escolha fica salva neste navegador.
 *   window.bscontaTema.get()          -> "dark" | "light"
 *   window.bscontaTema.set("dark")    -> aplica e salva
 */
(function () {
  var CHAVE = "bsconta_tema";
  function ler() {
    try { return localStorage.getItem(CHAVE) === "dark" ? "dark" : "light"; } catch (e) { return "light"; }
  }
  function aplicar(t) {
    var html = document.documentElement;
    if (t === "dark") html.setAttribute("data-theme", "dark");
    else html.removeAttribute("data-theme");
  }
  aplicar(ler());
  window.bscontaTema = {
    get: ler,
    set: function (t) {
      t = t === "dark" ? "dark" : "light";
      try { localStorage.setItem(CHAVE, t); } catch (e) { /* segue só nesta página */ }
      aplicar(t);
    },
  };
  // Mantém as outras abas abertas em sincronia.
  window.addEventListener("storage", function (e) { if (e.key === CHAVE) aplicar(ler()); });
})();
