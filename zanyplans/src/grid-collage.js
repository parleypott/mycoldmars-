/**
 * Grid collage with animated linear masks that reveal/hide media.
 * Each cell shows an image or video with:
 *  - Slow Ken Burns motion (zoom/pan)
 *  - Animated stripe overlay that slides across, revealing/hiding slices
 */

// Grid cell placements (5-column, 3-row grid)
const GRID_CELLS = [
  { col: '1 / 2', row: '1 / 2' },
  { col: '2 / 4', row: '1 / 2' },
  { col: '4 / 6', row: '1 / 2' },
  { col: '1 / 3', row: '2 / 3' },
  { col: '3 / 4', row: '2 / 3' },
  { col: '4 / 5', row: '2 / 3' },
  { col: '5 / 6', row: '2 / 3' },
  { col: '1 / 2', row: '3 / 4' },
  { col: '2 / 5', row: '3 / 4' },
  { col: '5 / 6', row: '3 / 4' },
];

// Per-cell mask + motion config
const CELL_STYLES = [
  { angle: 0,   size: 44, open: 24, slide: 'stripe-v',    speed: 12, kb: 'kb-zoom-in'   },
  { angle: 90,  size: 56, open: 32, slide: 'stripe-h',    speed: 18, kb: 'kb-pan-left'   },
  { angle: 40,  size: 36, open: 18, slide: 'stripe-diag',  speed: 10, kb: 'kb-zoom-out'  },
  { angle: 0,   size: 50, open: 28, slide: 'stripe-v',    speed: 15, kb: 'kb-pan-right'  },
  { angle: -40, size: 42, open: 22, slide: 'stripe-diag-r',speed: 9,  kb: 'kb-pan-up'    },
  { angle: 90,  size: 38, open: 20, slide: 'stripe-h',    speed: 11, kb: 'kb-zoom-in'    },
  { angle: 0,   size: 60, open: 34, slide: 'stripe-v',    speed: 16, kb: 'kb-pan-left'   },
  { angle: 40,  size: 32, open: 16, slide: 'stripe-diag',  speed: 8,  kb: 'kb-zoom-out'  },
  { angle: 90,  size: 48, open: 26, slide: 'stripe-h',    speed: 14, kb: 'kb-pan-right'  },
  { angle: 0,   size: 40, open: 22, slide: 'stripe-v',    speed: 10, kb: 'kb-pan-up'     },
];

/**
 * @param {Array} mediaList
 * @param {HTMLElement} container
 * @returns {{ destroy: Function }}
 */
export function createGridCollage(mediaList, container) {
  const grid = document.createElement('div');
  grid.className = 'collage-grid';

  // Tile media to fill grid cells
  let items = [...mediaList];
  while (items.length < GRID_CELLS.length) items = items.concat(mediaList);
  items = items.slice(0, GRID_CELLS.length);

  items.forEach((media, i) => {
    const layout = GRID_CELLS[i];
    const style = CELL_STYLES[i];

    const cell = document.createElement('div');
    cell.className = `grid-cell ${style.slide}`;
    cell.style.gridColumn = layout.col;
    cell.style.gridRow = layout.row;

    // Mask stripe CSS custom properties
    cell.style.setProperty('--mask-angle', `${style.angle}deg`);
    cell.style.setProperty('--stripe-size', `${style.size}px`);
    cell.style.setProperty('--stripe-open', `${style.open}px`);
    cell.style.setProperty('--mask-speed', `${style.speed}s`);
    cell.style.setProperty('--anim-delay', `${(-Math.random() * style.speed).toFixed(1)}s`);

    // Media element
    let el;
    if (media.type === 'video' && media.src) {
      el = document.createElement('video');
      el.src = media.src;
      el.autoplay = true;
      el.muted = true;
      el.loop = true;
      el.playsInline = true;
      el.preload = 'auto';
    } else if (media.src) {
      el = document.createElement('img');
      el.src = media.src;
      el.alt = media.label || '';
      el.loading = 'eager';
    } else {
      el = document.createElement('div');
      el.style.background = media.color || '#1a1a2e';
      el.style.width = '100%';
      el.style.height = '100%';
    }

    el.className = `grid-media ${style.kb}`;
    cell.appendChild(el);
    grid.appendChild(cell);
  });

  container.appendChild(grid);

  return {
    destroy() {
      // Pause all videos before removing
      grid.querySelectorAll('video').forEach(v => { v.pause(); v.src = ''; });
      grid.remove();
    }
  };
}

export function destroyGridCollage(scene) {
  if (scene) scene.destroy();
}
