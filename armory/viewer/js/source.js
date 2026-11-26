/*
 * D4 Build Viewer - data sources.
 *
 * Accepts any of:
 *   - a Maxroll build guide URL   https://maxroll.gg/d4/build-guides/<slug>
 *   - a Maxroll planner URL       https://maxroll.gg/d4/planner/<id>#<variant>
 *   - a bare planner id           xf9um40q
 * and returns the planner profile(s) plus guide metadata.
 */
(function (root) {
  'use strict';
  const D4 = (root.D4 = root.D4 || {});

  // Inside Sanctuary Armory (served from /viewer/ by its local server) all Maxroll JSON goes through
  // that server; as a browser extension or standalone page it is fetched directly.
  const LOCAL = typeof location !== 'undefined' && /^https?:$/.test(location.protocol) && location.pathname.startsWith('/viewer/');
  D4.LOCAL_SERVER = LOCAL;
  const PLANNER_API = LOCAL ? '/api/maxroll/planner/' : 'https://planners.maxroll.gg/profiles/load/d4/';
  const GAME_DATA = (file) => (LOCAL ? `/api/maxroll/game/${file}` : `${D4.ASSET_BASE || 'https://assets-ng.maxroll.gg/d4-tools'}/game/${file}`);

  const IS_EXTENSION = typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id);
  D4.IS_EXTENSION = IS_EXTENSION;

  /** Work out what the user pasted. */
  function parseInput(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;
    if (/^[a-z0-9]{6,12}$/i.test(s)) return { kind: 'planner', id: s };
    let url;
    try {
      url = new URL(s.includes('://') ? s : `https://${s}`);
    } catch {
      return null;
    }
    if (!/(^|\.)maxroll\.gg$/i.test(url.hostname)) return { kind: 'unsupported', url: url.href };
    let m = url.pathname.match(/\/d4\/planner\/([a-z0-9]+)/i);
    if (m) {
      const v = parseInt(url.hash.replace('#', ''), 10);
      return { kind: 'planner', id: m[1], variant: isFinite(v) && v > 0 ? v - 1 : undefined };
    }
    m = url.pathname.match(/\/d4\/(build-guides|guides|resources)\/[^/]+/i);
    if (m) {
      url.search = '';
      url.hash = '';
      return { kind: 'guide', url: url.href };
    }
    return { kind: 'unsupported', url: url.href };
  }
  D4.parseInput = parseInput;

  async function fetchJson(url, opts) {
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return r.json();
  }

  /** Load a planner profile by id via Maxroll's public planner API. */
  async function loadPlanner(id) {
    const r = await fetchJson(PLANNER_API + encodeURIComponent(id));
    if (!r || !r.data) throw new Error(r?.error || `Planner "${id}" not found`);
    const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
    return { id: r.id || id, name: r.name, className: r.class, date: r.date, data };
  }
  D4.loadPlanner = loadPlanner;

  /** Extract the JSON the Remix app embeds in the page: window.__remixContext = {...}; */
  function extractRemixContext(html) {
    const marker = 'window.__remixContext';
    const i = html.indexOf(marker);
    if (i < 0) return null;
    const start = html.indexOf('{', i);
    const end = html.indexOf('</script>', start);
    if (start < 0 || end < 0) return null;
    let body = html.substring(start, end).trim();
    body = body.replace(/;\s*$/, '');
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }

  // When the viewer is served by Sanctuary Armory's local server, guide pages are read
  // server-side (browsers block reading maxroll.gg pages from another origin).
  const GUIDE_PROXY = LOCAL ? '/api/maxroll/source' : null;

  /** Load a build guide page and find every planner it embeds. */
  async function loadGuide(url) {
    if (GUIDE_PROXY && !IS_EXTENSION) {
      const r = await fetch(GUIDE_PROXY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `Guide request failed (HTTP ${r.status})`);
      return body;
    }
    let html;
    try {
      const r = await fetch(url, { credentials: 'omit' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      html = await r.text();
    } catch (e) {
      const err = new Error(
        IS_EXTENSION
          ? `Could not load the guide page (${e.message}).`
          : 'Browsers block web pages from reading maxroll.gg guide pages directly (CORS). ' +
            'Install the extension, or open the guide, click its planner link ("Open in Planner") and paste that URL here instead.'
      );
      err.corsBlocked = !IS_EXTENSION;
      throw err;
    }
    const ctx = extractRemixContext(html);
    const planners = [];
    const seen = new Set();
    let post = null;
    (function walk(o, depth) {
      if (!o || typeof o !== 'object' || depth > 40) return;
      if (Array.isArray(o)) {
        for (const v of o) walk(v, depth + 1);
        return;
      }
      if (!post && o.post && typeof o.post === 'object' && (o.post.title || o.post.post_title)) post = o.post;
      if (o.plannerProfile && typeof o.plannerProfile === 'object' && o.plannerProfile.id && !seen.has(o.plannerProfile.id)) {
        const p = o.plannerProfile;
        seen.add(p.id);
        planners.push({
          id: p.id,
          name: p.name,
          className: p.class,
          date: p.date,
          data: typeof p.data === 'string' ? JSON.parse(p.data) : p.data,
        });
      }
      for (const v of Object.values(o)) walk(v, depth + 1);
    })(ctx, 0);

    // Fallback: planner ids referenced anywhere in the HTML
    if (!planners.length) {
      const ids = new Set();
      for (const m of html.matchAll(/maxroll\.gg\/d4\/planner\/([a-z0-9]{6,12})/gi)) ids.add(m[1]);
      for (const m of html.matchAll(/"plannerProfile":\{"id":"([a-z0-9]+)"/gi)) ids.add(m[1]);
      for (const id of ids) {
        try {
          planners.push(await loadPlanner(id));
        } catch {
          /* ignore */
        }
      }
    }
    if (!planners.length) throw new Error('No Maxroll planner was found on that page.');

    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"');
    return {
      url,
      title: decode(post?.title || post?.post_title || (titleMatch ? titleMatch[1].replace(/\s*[-|].*maxroll.*$/i, '') : '')),
      author: post?.author?.name || post?.author_name || null,
      updated: post?.modified || post?.date || null,
      planners,
    };
  }
  D4.loadGuide = loadGuide;
  D4.extractRemixContext = extractRemixContext;

  /** Resolve user input into { guide?, planners[], variant? } */
  async function loadSource(raw) {
    const p = parseInput(raw);
    if (!p) throw new Error('Paste a Maxroll D4 build guide URL, planner URL, or planner id.');
    if (p.kind === 'unsupported') throw new Error('Only maxroll.gg Diablo IV build guides and planners are supported.');
    if (p.kind === 'planner') return { planners: [await loadPlanner(p.id)], variant: p.variant };
    const guide = await loadGuide(p.url);
    return { guide, planners: guide.planners };
  }
  D4.loadSource = loadSource;

  /** Fetch a large JSON file with progress callbacks (bytes loaded / total). */
  async function fetchJsonWithProgress(url, onProgress) {
    // no-cache: always revalidate (cheap 304 via ETag) so new patches are picked up.
    // Local server: allow the browser cache (several sections load the same files); Maxroll direct: revalidate.
    const r = await fetch(url, { cache: LOCAL ? 'default' : 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    const total = parseInt(r.headers.get('content-length') || '0', 10);
    if (!r.body || !r.body.getReader) return r.json();
    const reader = r.body.getReader();
    const chunks = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      onProgress && onProgress(loaded, total);
    }
    const buf = new Uint8Array(loaded);
    let off = 0;
    for (const c of chunks) {
      buf.set(c, off);
      off += c.length;
    }
    return JSON.parse(new TextDecoder().decode(buf));
  }

  let gameDataPromise = null;
  /** Load (once) Maxroll's game data + English strings. */
  function loadGameData(onProgress, locale = 'enus') {
    if (gameDataPromise) return gameDataPromise;
    const prog = { min: [0, 0], text: [0, 0] };
    const report = () => {
      if (!onProgress) return;
      const loaded = prog.min[0] + prog.text[0];
      const total = prog.min[1] + prog.text[1];
      onProgress(loaded, total);
    };
    gameDataPromise = Promise.all([
      fetchJsonWithProgress(GAME_DATA('data.min.json'), (l, t) => {
        prog.min = [l, t];
        report();
      }),
      fetchJsonWithProgress(GAME_DATA(`data.${locale}.json`), (l, t) => {
        prog.text = [l, t];
        report();
      }),
    ]).then(([min, text]) => new D4.GameData(min, text));
    gameDataPromise.catch(() => (gameDataPromise = null));
    return gameDataPromise;
  }
  D4.loadGameData = loadGameData;

  if (typeof module !== 'undefined' && module.exports) module.exports = D4;
})(typeof globalThis !== 'undefined' ? globalThis : window);
