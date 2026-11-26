/* D4 Build Viewer - app controller. */
(function () {
  'use strict';
  const D4 = window.D4;
  const esc = D4.esc;
  const $ = (sel) => document.querySelector(sel);

  const VIEWER_VERSION = '1.1.0';
  D4.VIEWER_VERSION = VIEWER_VERSION;
  const TABS = [
    ['overview', 'Overview'],
    ['gear', 'Gear'],
    ['skills', 'Skills'],
    ['paragon', 'Paragon'],
    ['systems', 'Mercenaries & Systems'],
    ['notes', 'Guide Notes'],
  ];

  const state = {
    input: '',
    source: null,
    gd: null,
    planner: 0,
    variant: 0,
    tab: 'overview',
    skillStep: undefined,
    paragonStep: undefined,
  };
  const modelCache = new Map();

  // ------------------------------------------------------------ persistence
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(k);
        return v ? JSON.parse(v) : d;
      } catch {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch {
        /* storage unavailable */
      }
    },
  };
  function remember(entry) {
    const list = store.get('d4bv.recent', []).filter((r) => r.input !== entry.input);
    list.unshift(entry);
    store.set('d4bv.recent', list.slice(0, 12));
  }

  // ------------------------------------------------------------ url state
  function readUrl() {
    const q = new URLSearchParams(location.search);
    state.input = q.get('src') || '';
    state.planner = parseInt(q.get('p') || '0', 10) || 0;
    const v = q.get('v');
    state.variant = v != null ? parseInt(v, 10) || 0 : undefined;
    const t = q.get('section') || q.get('tab');
    state.tab = TABS.some(([k]) => k === t) ? t : 'overview';
  }
  function writeUrl(push) {
    const q = new URLSearchParams();
    if (document.body.classList.contains('embed')) q.set('embed', '1');
    const sec = new URLSearchParams(location.search).get('section');
    if (sec) q.set('section', sec);
    if (state.input) q.set('src', state.input);
    if (state.planner) q.set('p', String(state.planner));
    if (state.variant != null) q.set('v', String(state.variant));
    if (state.tab !== 'overview') q.set('tab', state.tab);
    const url = `${location.pathname}?${q}`;
    if (push) history.pushState(null, '', url);
    else history.replaceState(null, '', url);
  }

  // ------------------------------------------------------------ loading
  function showStatus(html, kind = 'info') {
    const el = $('#status');
    el.className = `status ${kind}`;
    el.innerHTML = html;
    el.hidden = !html;
  }
  function progressBar(loaded, total) {
    const mb = (n) => (n / 1048576).toFixed(1);
    const pct = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
    return `<div>Loading Diablo IV game data from Maxroll&hellip; ${total ? `${mb(loaded)} / ${mb(total)} MB` : `${mb(loaded)} MB`}</div><div class="bar"><i style="width:${pct}%"></i></div>`;
  }

  async function load(input, { push = false, keepView = false } = {}) {
    input = String(input || '').trim();
    if (!input) return showLanding();
    state.input = input;
    $('#src').value = input;
    if (!keepView) {
      state.planner = 0;
      state.variant = undefined;
      state.tab = 'overview';
    }
    writeUrl(push);
    $('#landing').hidden = true;
    $('#build').hidden = true;
    showStatus('<div>Fetching build&hellip;</div>');
    let gdErr = null;
    const gdP = D4.loadGameData((l, t) => {
      if (state.source) showStatus(progressBar(l, t));
    }).catch((e) => (gdErr = e));
    try {
      const source = await D4.loadSource(input);
      state.source = source;
      modelCache.clear();
      showStatus(progressBar(0, 0));
      const gd = await gdP;
      if (gdErr) throw new Error(`Could not load game data: ${gdErr.message}`);
      state.gd = gd;
      if (state.planner >= source.planners.length) state.planner = 0;
      const pd = source.planners[state.planner].data;
      if (state.variant == null || state.variant >= pd.profiles.length) {
        state.variant = source.variant ?? pd.activeProfile ?? 0;
        if (state.variant >= pd.profiles.length) state.variant = 0;
      }
      showStatus('');
      remember({
        input,
        title: source.guide?.title || source.planners[0].name,
        cls: source.planners[0].className,
        at: Date.now(),
      });
      document.title = `${source.guide?.title || source.planners[0].name} - D4 Build Viewer`;
      writeUrl(false);
      render();
    } catch (e) {
      console.error(e);
      state.source = null;
      showStatus(`<strong>Couldn&rsquo;t load that build.</strong><div>${esc(e.message || e)}</div>`, 'error');
    }
  }

  function variantModel(i) {
    const key = `${state.planner}:${i}`;
    if (!modelCache.has(key)) modelCache.set(key, D4.buildVariant(state.gd, state.source.planners[state.planner], i));
    return modelCache.get(key);
  }

  // ------------------------------------------------------------ rendering
  function render() {
    const { source, gd } = state;
    const planner = source.planners[state.planner];
    const pd = planner.data;
    const model = variantModel(state.variant);
    D4.clearTips();

    const g = source.guide;
    const head = $('#build-head');
    head.innerHTML = `
      <div class="bh-main">
        <div class="bh-class">${esc(model.className)} &middot; Level ${esc(model.level ?? '?')}${model.worldTier ? ` &middot; Torment/World Tier ${esc(model.worldTier)}` : ''}</div>
        <h2>${esc(g?.title || planner.name)}</h2>
        <div class="bh-meta">
          ${g?.author ? `By <strong>${esc(g.author)}</strong> &middot; ` : ''}${g?.updated ? `Updated ${esc(g.updated)} &middot; ` : planner.date ? `Planner saved ${esc(planner.date)} &middot; ` : ''}
          ${g ? `<a href="${esc(g.url)}" target="_blank" rel="noopener">Open guide</a> &middot; ` : ''}
          <a href="https://maxroll.gg/d4/planner/${esc(planner.id)}#${state.variant + 1}" target="_blank" rel="noopener">Open in Maxroll planner</a>
          <span class="muted"> &middot; game data ${esc(gd.version)}</span>
        </div>
      </div>
      <div class="bh-actions">
        <button type="button" id="exp-md" class="btn">Markdown</button>
        <button type="button" id="exp-json" class="btn">JSON</button>
        <button type="button" id="exp-copy" class="btn">Copy text</button>
      </div>`;

    const plannerSel =
      source.planners.length > 1
        ? `<label class="planner-sel">Planner <select id="planner-select">${source.planners
            .map((p, i) => `<option value="${i}"${i === state.planner ? ' selected' : ''}>${esc(p.name)}</option>`)
            .join('')}</select></label>`
        : '';
    $('#variants').innerHTML = `${plannerSel}<div class="variant-tabs" role="tablist" aria-label="Build variants">${pd.profiles
      .map(
        (p, i) =>
          `<button type="button" role="tab" class="vtab${i === state.variant ? ' active' : ''}" aria-selected="${i === state.variant}" data-variant="${i}">${esc(p.name || `Variant ${i + 1}`)}</button>`
      )
      .join('')}</div>`;

    $('#tabs').innerHTML = TABS.map(
      ([k, label]) => `<button type="button" role="tab" class="tab${k === state.tab ? ' active' : ''}" aria-selected="${k === state.tab}" data-tab="${k}">${label}</button>`
    ).join('');

    const ctx = { model, planner, gd, state, source, variantModel };
    const view = $('#view');
    try {
      D4.views[state.tab](view, ctx);
    } catch (e) {
      console.error(e);
      view.innerHTML = `<div class="status error">Something went wrong rendering this tab: ${esc(e.message)}</div>`;
    }
    $('#build').hidden = false;
    bindBuildEvents();
  }

  function bindBuildEvents() {
    document.querySelectorAll('[data-variant]').forEach((b) =>
      b.addEventListener('click', () => {
        state.variant = Number(b.getAttribute('data-variant'));
        state.skillStep = state.paragonStep = undefined;
        writeUrl(false);
        render();
      })
    );
    document.querySelectorAll('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        state.tab = b.getAttribute('data-tab');
        writeUrl(false);
        render();
      })
    );
    const ps = $('#planner-select');
    if (ps)
      ps.addEventListener('change', () => {
        state.planner = Number(ps.value);
        state.variant = state.source.planners[state.planner].data.activeProfile ?? 0;
        writeUrl(false);
        render();
      });
    const all = () => {
      const planner = state.source.planners[state.planner];
      return { planner, variants: planner.data.profiles.map((_, i) => variantModel(i)) };
    };
    const slug = () => (state.source.guide?.title || state.source.planners[state.planner].name || 'build').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
    $('#exp-md').addEventListener('click', () => {
      const { planner, variants } = all();
      D4.exporter.download(`${slug()}.md`, D4.exporter.buildToMarkdown(state.source, planner, variants), 'text/markdown');
    });
    $('#exp-json').addEventListener('click', () => {
      const { planner, variants } = all();
      D4.exporter.download(`${slug()}.json`, JSON.stringify(D4.exporter.buildToJson(state.source, planner, variants, state.gd), null, 2), 'application/json');
    });
    $('#exp-copy').addEventListener('click', async (e) => {
      const { planner, variants } = all();
      const btn = e.currentTarget;
      try {
        await navigator.clipboard.writeText(D4.exporter.buildToMarkdown(state.source, planner, variants));
        btn.textContent = 'Copied!';
      } catch {
        btn.textContent = 'Copy failed';
      }
      setTimeout(() => (btn.textContent = 'Copy text'), 1500);
    });
  }

  function showLanding() {
    state.source = null;
    $('#build').hidden = true;
    showStatus('');
    const recent = store.get('d4bv.recent', []);
    $('#recent').innerHTML = recent.length
      ? `<h3>Recently viewed</h3><ul class="recent">${recent
          .map((r) => `<li><a href="?src=${encodeURIComponent(r.input)}" data-load="${esc(r.input)}">${esc(r.title || r.input)}</a> <span class="muted small">${esc(r.cls || '')}</span></li>`)
          .join('')}</ul>`
      : '';
    $('#landing').hidden = false;
    document.querySelectorAll('[data-load]').forEach((a) =>
      a.addEventListener('click', (e) => {
        e.preventDefault();
        load(a.getAttribute('data-load'), { push: true });
      })
    );
  }

  // ------------------------------------------------------------ boot
  function boot() {
    const qp = new URLSearchParams(location.search);
    if (qp.get('embed') === '1') document.body.classList.add('embed');
    // section mode: only one tab's content, sized to its parent page (used inside Sanctuary Armory)
    if (qp.get('section')) document.body.classList.add('embed', 'section-only');
    if (document.body.classList.contains('embed') && window.parent !== window) {
      const report = () => window.parent.postMessage({ type: 'd4bv-height', height: Math.ceil(document.documentElement.scrollHeight) }, location.origin);
      new ResizeObserver(report).observe(document.body);
      window.addEventListener('load', report);
    }
    D4.initTooltips();
    document.addEventListener(
      'error',
      (e) => {
        if (e.target && e.target.tagName === 'IMG') e.target.classList.add('broken');
      },
      true
    );
    const vEl = document.getElementById('viewer-version');
    if (vEl) vEl.textContent = 'D4 Build Viewer ' + VIEWER_VERSION;
    $('#mode-note').textContent = D4.LOCAL_SERVER
      ? 'Running inside Sanctuary Armory: guide URLs, planner URLs and planner ids all work.'
      : D4.IS_EXTENSION
      ? 'Running as a browser extension: guide URLs, planner URLs and planner ids all work.'
      : 'Running as a web page: paste a planner URL or id. Guide URLs need the browser extension (or the guide’s “Open in Planner” link).';
    $('#load-form').addEventListener('submit', (e) => {
      e.preventDefault();
      load($('#src').value, { push: true });
    });
    document.querySelectorAll('[data-example]').forEach((a) =>
      a.addEventListener('click', (e) => {
        e.preventDefault();
        load(a.getAttribute('data-example'), { push: true });
      })
    );
    $('#home').addEventListener('click', (e) => {
      e.preventDefault();
      state.input = '';
      $('#src').value = '';
      history.pushState(null, '', location.pathname);
      showLanding();
    });
    window.addEventListener('popstate', () => {
      readUrl();
      if (state.input) load(state.input, { keepView: true });
      else showLanding();
    });
    readUrl();
    if (state.input) load(state.input, { keepView: true });
    else showLanding();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
