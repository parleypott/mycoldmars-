import { createMacWindow } from './mac-window.js';

/**
 * Creates 20 floating Mac windows with drift physics.
 * @param {Array} mediaList - array of media objects
 * @param {HTMLElement} container
 * @returns {object} scene handle { destroy }
 */
export function createFloatingScene(mediaList, container) {
  const windows = [];
  let rafId = null;

  // Tile or trim to 20
  let items = [...mediaList];
  while (items.length < 20) items.push(...mediaList);
  items = items.slice(0, 20);

  const cw = container.clientWidth;
  const ch = container.clientHeight;

  items.forEach((media, i) => {
    const width = 180 + Math.random() * 200; // 180–380px
    const win = createMacWindow(media, { width });

    // Random initial position
    const x = Math.random() * (cw - width);
    const y = Math.random() * (ch - width * 0.75);

    // Velocity (0.3–1.2 px/frame)
    const speed = 0.3 + Math.random() * 0.9;
    const angle = Math.random() * Math.PI * 2;
    const dx = Math.cos(angle) * speed;
    const dy = Math.sin(angle) * speed;

    // Micro-wobble
    const wobbleSpeed = 0.005 + Math.random() * 0.01;
    const wobbleMax = 3 + Math.random() * 5; // max ±8deg total

    win._floatX = x;
    win._floatY = y;
    win._dx = dx;
    win._dy = dy;
    win._wobblePhase = Math.random() * Math.PI * 2;
    win._wobbleSpeed = wobbleSpeed;
    win._wobbleMax = wobbleMax;
    win._width = width;

    win.style.zIndex = Math.floor(Math.random() * 20);
    win.style.transform = `translate(${x}px, ${y}px)`;

    container.appendChild(win);
    windows.push(win);
  });

  // Physics loop
  function tick() {
    const cw = container.clientWidth;
    const ch = container.clientHeight;

    for (const win of windows) {
      if (win.style.display === 'none') continue;

      const w = win._width;
      const h = win.offsetHeight || w * 0.75;

      // Move
      win._floatX += win._dx;
      win._floatY += win._dy;

      // Bounce
      if (win._floatX < 0) { win._floatX = 0; win._dx = Math.abs(win._dx); }
      if (win._floatX > cw - w) { win._floatX = cw - w; win._dx = -Math.abs(win._dx); }
      if (win._floatY < 0) { win._floatY = 0; win._dy = Math.abs(win._dy); }
      if (win._floatY > ch - h) { win._floatY = ch - h; win._dy = -Math.abs(win._dy); }

      // Wobble
      win._wobblePhase += win._wobbleSpeed;
      const rot = Math.sin(win._wobblePhase) * win._wobbleMax;

      win.style.transform = `translate(${win._floatX}px, ${win._floatY}px) rotate(${rot}deg)`;
    }

    rafId = requestAnimationFrame(tick);
  }

  rafId = requestAnimationFrame(tick);

  return {
    destroy() {
      if (rafId) cancelAnimationFrame(rafId);
      windows.forEach(w => w.remove());
      windows.length = 0;
    }
  };
}

export function destroyFloatingScene(scene) {
  if (scene) scene.destroy();
}
