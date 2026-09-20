/* BSconta+ RH — microinteractions visuais.
   Não contém regra de negócio. Pode ser removido sem alterar funcionalidades. */
(() => {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  document.body?.classList.add('fx-ready');
  if (reduce) return;

  const addRipple = (el, ev) => {
    if (!el || el.disabled) return;
    const rect = el.getBoundingClientRect();
    const dot = document.createElement('span');
    dot.className = 'ripple-dot';
    dot.style.left = `${ev.clientX - rect.left}px`;
    dot.style.top = `${ev.clientY - rect.top}px`;
    el.appendChild(dot);
    dot.addEventListener('animationend', () => dot.remove(), { once: true });
  };

  document.addEventListener('pointerdown', (ev) => {
    const target = ev.target.closest('button, .btn-primary, .btn-small, .btn-ghost, .icon-btn, .header-user-btn');
    if (target && target.getAttribute('type') !== 'submit') addRipple(target, ev);
  }, { passive: true });

  const animateVisible = (root = document) => {
    const items = root.querySelectorAll?.('#content > .space-y > *, #content > .row-between, #content > .card, #content > .grid-2, #content > .grid-3, #content > .grid-3-even') || [];
    items.forEach((el, i) => {
      if (el.dataset.motionBound) return;
      el.dataset.motionBound = '1';
      el.style.animation = `bs-pop-in .38s cubic-bezier(.16,1,.3,1) ${Math.min(i * 45, 250)}ms both`;
    });
  };

  const ready = () => {
    animateVisible();
    const content = document.getElementById('content');
    if (!content || !window.MutationObserver) return;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType === 1) animateVisible(node);
        }
      }
    });
    observer.observe(content, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), 12000);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
})();
