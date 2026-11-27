/* D4 Build Viewer - shared UI helpers: tooltips and SVG pan/zoom. */
(function (root) {
  'use strict';
  const D4 = (root.D4 = root.D4 || {});

  // ------------------------------------------------------------------ tooltips
  // Elements carry data-tip="<id>"; the HTML lives in a registry so large
  // tooltips don't bloat the DOM attributes.
  const tips = new Map();
  let tipSeq = 0;
  D4.tip = (html) => {
    const id = `t${++tipSeq}`;
    tips.set(id, html);
    return id;
  };
  D4.clearTips = () => {
    tips.clear();
  };

  function initTooltips() {
    const el = document.createElement('div');
    el.className = 'tooltip';
    el.hidden = true;
    document.body.appendChild(el);
    let current = null;
    let pinned = false;

    function place(x, y) {
      const pad = 14;
      const r = el.getBoundingClientRect();
      let left = x + pad;
      let top = y + pad;
      if (left + r.width > window.innerWidth - 8) left = Math.max(8, x - r.width - pad);
      if (top + r.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - r.height - 8);
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    }
    function show(target, x, y) {
      const id = target.getAttribute('data-tip');
      let html = tips.get(id);
      if (typeof html === 'function') {
        html = html();
        tips.set(id, html);
      }
      if (!html) return;
      if (current !== target) {
        el.innerHTML = html;
        current = target;
      }
      el.hidden = false;
      place(x, y);
    }
    function hide() {
      el.hidden = true;
      current = null;
      pinned = false;
    }
    document.addEventListener('pointermove', (e) => {
      if (pinned) return;
      if (e.buttons) return hide();
      const t = e.target.closest && e.target.closest('[data-tip]');
      if (t) show(t, e.clientX, e.clientY);
      else if (current) hide();
    });
    // Touch / click: tap to pin a tooltip, tap elsewhere to close
    document.addEventListener('click', (e) => {
      const t = e.target.closest && e.target.closest('[data-tip]');
      if (t && e.pointerType !== 'mouse') {
        show(t, e.clientX, e.clientY);
        pinned = true;
      } else if (pinned && !el.contains(e.target)) hide();
    });
    document.addEventListener('keydown', (e) => e.key === 'Escape' && hide());
    window.addEventListener('scroll', () => !pinned && hide(), { passive: true });
  }
  D4.initTooltips = initTooltips;

  // ------------------------------------------------------------------ pan/zoom
  /**
   * Make an <svg> pannable (drag) and zoomable (wheel / buttons / pinch).
   * bounds = {x, y, w, h} in SVG user units.
   */
  function panZoom(svg, bounds, opts = {}) {
    const vb = { ...bounds };
    const home = { ...bounds };
    const minW = opts.minW || bounds.w / 30;
    const maxW = opts.maxW || bounds.w * 3;
    function apply() {
      svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    }
    function zoomAt(factor, cx, cy) {
      const nw = Math.min(maxW, Math.max(minW, vb.w * factor));
      const f = nw / vb.w;
      vb.x = cx - (cx - vb.x) * f;
      vb.y = cy - (cy - vb.y) * f;
      vb.w = nw;
      vb.h = vb.h * f;
      apply();
    }
    function toSvg(clientX, clientY) {
      const r = svg.getBoundingClientRect();
      // preserveAspectRatio="xMidYMid meet" -> uniform scale, centred
      const s = Math.max(vb.w / r.width, vb.h / r.height);
      const ox = (r.width * s - vb.w) / 2;
      const oy = (r.height * s - vb.h) / 2;
      return { x: vb.x - ox + (clientX - r.left) * s, y: vb.y - oy + (clientY - r.top) * s, s };
    }
    svg.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const p = toSvg(e.clientX, e.clientY);
        zoomAt(Math.pow(1.0015, e.deltaY), p.x, p.y);
      },
      { passive: false }
    );
    const pointers = new Map();
    let last = null;
    let pinchDist = 0;
    svg.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      svg.setPointerCapture(e.pointerId);
      last = { x: e.clientX, y: e.clientY };
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
      svg.classList.add('dragging');
    });
    svg.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist) {
          const mid = toSvg((a.x + b.x) / 2, (a.y + b.y) / 2);
          zoomAt(pinchDist / d, mid.x, mid.y);
        }
        pinchDist = d;
        return;
      }
      const { s } = toSvg(e.clientX, e.clientY);
      vb.x -= (e.clientX - last.x) * s;
      vb.y -= (e.clientY - last.y) * s;
      last = { x: e.clientX, y: e.clientY };
      apply();
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      pinchDist = 0;
      if (!pointers.size) svg.classList.remove('dragging');
      const rest = [...pointers.values()][0];
      if (rest) last = { ...rest };
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    apply();
    return {
      zoomIn: () => zoomAt(0.75, vb.x + vb.w / 2, vb.y + vb.h / 2),
      zoomOut: () => zoomAt(1.33, vb.x + vb.w / 2, vb.y + vb.h / 2),
      reset: () => {
        Object.assign(vb, home);
        apply();
      },
      focus: (x, y, w) => {
        const h = (w * home.h) / home.w;
        Object.assign(vb, { x: x - w / 2, y: y - h / 2, w, h });
        apply();
      },
    };
  }
  D4.panZoom = panZoom;

  /** Wrap an svg in a viewport with zoom controls; returns {wrap, svg}. */
  D4.mapViewport = function (svgMarkup, extraControls = '') {
    const wrap = document.createElement('div');
    wrap.className = 'map';
    wrap.innerHTML = `${svgMarkup}
      <div class="map-ctrls">
        <button type="button" data-z="in" title="Zoom in" aria-label="Zoom in">+</button>
        <button type="button" data-z="out" title="Zoom out" aria-label="Zoom out">&minus;</button>
        <button type="button" data-z="reset" title="Fit" aria-label="Fit to view">&#x2922;</button>
        ${extraControls}
      </div>
      <div class="map-hint">${typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 'Drag to move &middot; pinch to zoom &middot; tap for details' : 'Drag to pan &middot; scroll to zoom &middot; hover for details'}</div>`;
    return wrap;
  };
  D4.bindMapControls = function (wrap, pz) {
    wrap.querySelectorAll('[data-z]').forEach((b) =>
      b.addEventListener('click', () => {
        const z = b.getAttribute('data-z');
        if (z === 'in') pz.zoomIn();
        else if (z === 'out') pz.zoomOut();
        else pz.reset();
      })
    );
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
