/**
 * Creates a Mac OS System 7 style window element.
 * @param {object} media - { src, type, color, label }
 * @param {object} opts  - { width }
 * @returns {HTMLElement}
 */
export function createMacWindow(media, opts = {}) {
  const width = opts.width || 240;

  const win = document.createElement('div');
  win.className = 'mac-win';
  win.style.width = width + 'px';

  // ── Title bar ──
  const titlebar = document.createElement('div');
  titlebar.className = 'mac-win-titlebar';

  const closeBtn = document.createElement('div');
  closeBtn.className = 'mac-win-close';
  closeBtn.innerHTML = '&#x2715;';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    poofWindow(win);
  });

  const title = document.createElement('div');
  title.className = 'mac-win-title';
  title.textContent = media.label || 'Untitled';

  titlebar.appendChild(closeBtn);
  titlebar.appendChild(title);
  win.appendChild(titlebar);

  // ── Content ──
  const content = document.createElement('div');
  content.className = 'mac-win-content';

  if (media.type === 'video' && media.src) {
    const video = document.createElement('video');
    video.src = media.src;
    video.autoplay = true;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'none';
    video.setAttribute('loading', 'lazy');
    content.appendChild(video);
  } else if ((media.type === 'image' || media.type === 'gif') && media.src) {
    const img = document.createElement('img');
    img.src = media.src;
    img.alt = media.label || '';
    img.loading = 'lazy';
    content.appendChild(img);
  } else {
    // Placeholder
    const ph = document.createElement('div');
    ph.className = 'placeholder';
    ph.style.background = media.color || '#1a1a2e';
    ph.innerHTML = `<span>${media.label || 'NO DATA'}</span>`;
    content.appendChild(ph);
  }

  win.appendChild(content);

  // ── Resize handle ──
  const resize = document.createElement('div');
  resize.className = 'mac-win-resize';
  win.appendChild(resize);

  // ── Click to bring to front ──
  win.addEventListener('mousedown', () => {
    const maxZ = Math.max(
      ...Array.from(win.parentElement?.children || [])
        .map(el => parseInt(el.style.zIndex) || 0)
    );
    win.style.zIndex = maxZ + 1;
  });

  return win;
}

function poofWindow(win) {
  win.classList.add('poof');
  const onEnd = () => {
    win.removeEventListener('animationend', onEnd);
    win.style.display = 'none';
    win.classList.remove('poof');

    // Respawn after 3 seconds at new position
    setTimeout(() => {
      if (!win.parentElement) return;
      const parent = win.parentElement;
      const maxX = parent.clientWidth - win.clientWidth;
      const maxY = parent.clientHeight - win.clientHeight;
      win._floatX = Math.random() * Math.max(maxX, 100);
      win._floatY = Math.random() * Math.max(maxY, 100);
      win.style.display = '';
      win.style.transform = `translate(${win._floatX}px, ${win._floatY}px) rotate(0deg)`;
    }, 3000);
  };
  win.addEventListener('animationend', onEnd);
}
