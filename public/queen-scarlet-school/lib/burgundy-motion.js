/* ─────────────────────────────────────────────────────────────────────
 * BURGUNDY MOTION ENGINE
 *
 * Vanilla JS, no deps. Gates on body[data-world="burgundy"].
 * Pairs with burgundy-motion.css.
 *
 * Responsibilities:
 *   1. Cursor halo — set --cursor-x/--cursor-y on body via mousemove
 *   2. IntersectionObserver — add .is-in-view to story-block/ccard/story-card
 *   3. View transitions — wrap same-origin nav clicks
 *   4. Welcome hero word-reveal — wrap wh-title into <span>s with --word-i
 *   5. Scroll parallax — set --scroll-y on body
 *   6. Mic LED — observe .mic-btn.listening, toggle .led-pulse on inner dot
 *   7. Block counter digit flip — observe textContent change, add .flipping
 *   8. Tag mode-btn elements with data-num if their label starts with a digit
 * ──────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  // ─── Gate ───────────────────────────────────────────────────────────
  function isBurgundy() {
    return document.body && document.body.dataset.world === 'burgundy';
  }

  if (!isBurgundy()) {
    // Re-check on world swap (paintTheme may run after DOM ready)
    const obs = new MutationObserver(() => {
      if (isBurgundy()) {
        obs.disconnect();
        boot();
      }
    });
    if (document.body) {
      obs.observe(document.body, { attributes: true, attributeFilter: ['data-world'] });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        if (isBurgundy()) boot();
        else obs.observe(document.body, { attributes: true, attributeFilter: ['data-world'] });
      });
    }
    return;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Re-init flag so we don't double-bind on world toggles
  function boot() {
    if (window.__burgundyMotionBooted) return;
    window.__burgundyMotionBooted = true;

    initCursorHalo();
    initInViewObserver();
    initViewTransitions();
    initWordReveal();
    initParallax();
    initMicLED();
    initBlockCounterFlip();
    initModeBtnNumbers();
  }

  // ─── 1. Cursor halo ─────────────────────────────────────────────────
  function initCursorHalo() {
    document.body.classList.add('has-halo');
    let rafId = null;
    let nextX = 0, nextY = 0;
    function tick() {
      rafId = null;
      document.body.style.setProperty('--cursor-x', nextX + 'px');
      document.body.style.setProperty('--cursor-y', nextY + 'px');
    }
    document.addEventListener('mousemove', (e) => {
      nextX = e.clientX;
      nextY = e.clientY;
      if (rafId == null) rafId = requestAnimationFrame(tick);
    }, { passive: true });

    document.addEventListener('mouseleave', () => {
      document.body.style.setProperty('--cursor-x', '-200px');
      document.body.style.setProperty('--cursor-y', '-200px');
    });
  }

  // ─── 2. IntersectionObserver pop-in ────────────────────────────────
  function initInViewObserver() {
    const targets = document.querySelectorAll('.story-block, .ccard, .story-card');
    if (!targets.length) {
      // Watch for late-rendered elements
      observeFutureTargets();
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in-view');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });

    targets.forEach((t) => io.observe(t));
    observeFutureTargets(io);
  }

  function observeFutureTargets(existingIo) {
    const io = existingIo || new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('is-in-view');
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });

    const mo = new MutationObserver((muts) => {
      muts.forEach((m) => {
        m.addedNodes && m.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          if (n.matches && n.matches('.story-block, .ccard, .story-card')) {
            io.observe(n);
          }
          if (n.querySelectorAll) {
            n.querySelectorAll('.story-block, .ccard, .story-card')
              .forEach((el) => io.observe(el));
          }
        });
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  // ─── 3. View transitions on same-origin nav ────────────────────────
  function initViewTransitions() {
    if (!document.startViewTransition) return;

    document.addEventListener('click', (e) => {
      // Bail on modified clicks
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
      if (a.target && a.target !== '' && a.target !== '_self') return;

      let url;
      try { url = new URL(href, location.href); } catch { return; }
      if (url.origin !== location.origin) return;

      e.preventDefault();
      document.startViewTransition(() => {
        location.assign(url.href);
      });
    }, true);
  }

  // ─── 4. Welcome hero word-reveal ───────────────────────────────────
  function initWordReveal() {
    const title = document.querySelector('body[data-world="burgundy"] .welcome-hero .wh-title');
    if (!title || title.classList.contains('word-reveal')) return;

    // Preserve nested element (.wh-name) — we walk text nodes only
    let wordIdx = 0;
    const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT, null);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    textNodes.forEach((node) => {
      const text = node.nodeValue;
      if (!text || !text.trim()) return;
      const frag = document.createDocumentFragment();
      // Split into word chunks, preserving spaces
      const parts = text.split(/(\s+)/);
      parts.forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) {
          const sp = document.createElement('span');
          sp.className = 'space';
          sp.textContent = part;
          frag.appendChild(sp);
        } else {
          const sp = document.createElement('span');
          sp.style.setProperty('--word-i', wordIdx++);
          sp.textContent = part;
          frag.appendChild(sp);
        }
      });
      node.parentNode.replaceChild(frag, node);
    });

    // Also wrap .wh-name as a single reveal unit so the underline lands with it
    const whName = title.querySelector('.wh-name');
    if (whName && !whName.dataset.wrapped) {
      whName.style.setProperty('--word-i', wordIdx++);
      whName.dataset.wrapped = '1';
    }

    title.classList.add('word-reveal');
  }

  // ─── 5. Scroll parallax ────────────────────────────────────────────
  function initParallax() {
    let rafId = null;
    function tick() {
      rafId = null;
      document.body.style.setProperty('--scroll-y', '-' + window.scrollY + 'px');
    }
    window.addEventListener('scroll', () => {
      if (rafId == null) rafId = requestAnimationFrame(tick);
    }, { passive: true });
    tick();
  }

  // ─── 6. Mic LED ────────────────────────────────────────────────────
  function initMicLED() {
    const micBtns = document.querySelectorAll('.mic-btn, #btn-mic');
    micBtns.forEach(attachLed);

    // Future mic buttons
    const mo = new MutationObserver((muts) => {
      muts.forEach((m) => {
        m.addedNodes && m.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          if (n.matches && n.matches('.mic-btn, #btn-mic')) attachLed(n);
          if (n.querySelectorAll) {
            n.querySelectorAll('.mic-btn, #btn-mic').forEach(attachLed);
          }
        });
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  function attachLed(btn) {
    if (btn.dataset.ledBound) return;
    btn.dataset.ledBound = '1';
    const cls = new MutationObserver(() => {
      const listening = btn.classList.contains('listening');
      const dot = btn.querySelector('svg .mic-capsule');
      if (dot) {
        if (listening) dot.classList.add('led-pulse');
        else dot.classList.remove('led-pulse');
      }
    });
    cls.observe(btn, { attributes: true, attributeFilter: ['class'] });
  }

  // ─── 7. Block counter digit flip ───────────────────────────────────
  function initBlockCounterFlip() {
    const targets = document.querySelectorAll('.block-counter, .count-pill, .b-num');
    targets.forEach(attachFlip);

    const mo = new MutationObserver((muts) => {
      muts.forEach((m) => {
        m.addedNodes && m.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          if (n.matches && n.matches('.block-counter, .count-pill, .b-num')) attachFlip(n);
          if (n.querySelectorAll) {
            n.querySelectorAll('.block-counter, .count-pill, .b-num').forEach(attachFlip);
          }
        });
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  function attachFlip(el) {
    if (el.dataset.flipBound) return;
    el.dataset.flipBound = '1';
    let last = el.textContent;
    const mo = new MutationObserver(() => {
      const cur = el.textContent;
      if (cur !== last) {
        last = cur;
        el.classList.remove('flipping');
        // force reflow
        void el.offsetWidth;
        el.classList.add('flipping');
        setTimeout(() => el.classList.remove('flipping'), 360);
      }
    });
    mo.observe(el, { childList: true, characterData: true, subtree: true });
  }

  // ─── 8. Tag mode-btn elements with data-num ────────────────────────
  function initModeBtnNumbers() {
    function tag(btn) {
      if (btn.dataset.numBound) return;
      btn.dataset.numBound = '1';
      const raw = (btn.textContent || '').trim();
      const m = raw.match(/^(\d+)/);
      if (m) {
        btn.dataset.num = m[1];
        btn.classList.add('has-num');
      }
    }
    document.querySelectorAll('.composer-modes .mode-btn').forEach(tag);

    const mo = new MutationObserver((muts) => {
      muts.forEach((m) => {
        m.addedNodes && m.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          if (n.matches && n.matches('.composer-modes .mode-btn')) tag(n);
          if (n.querySelectorAll) {
            n.querySelectorAll('.composer-modes .mode-btn').forEach(tag);
          }
        });
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }
})();
