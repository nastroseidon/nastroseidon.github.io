/*
 * Renders the guide author's notes. Maxroll stores them as Lexical editor JSON
 * (root > paragraph/list/heading > text/embed/link). Embeds reference game ids
 * (items, skills, ...) which get hover tooltips.
 */
(function (root) {
  'use strict';
  const D4 = (root.D4 = root.D4 || {});
  const esc = (s) => D4.esc(s);

  function safeStyle(style) {
    if (!style) return '';
    const m = String(style).match(/color:\s*(#[0-9a-f]{3,8}|rgba?\([\d\s,.%]+\))/i);
    return m ? ` style="color:${m[1]}"` : '';
  }

  /**
   * @param {object} node   Lexical node (usually {root:{...}})
   * @param {object} opts   { tip: (html)=>tipId, gd: GameData, cls }
   */
  function renderLexical(node, opts = {}) {
    if (!node) return '';
    if (node.root) return renderLexical(node.root, opts);
    const kids = () => (node.children || []).map((c) => renderLexical(c, opts)).join('');
    switch (node.type) {
      case 'root':
        return kids();
      case 'paragraph': {
        const inner = kids();
        return inner ? `<p>${inner}</p>` : '';
      }
      case 'heading': {
        const tag = /^h[1-6]$/.test(node.tag) ? node.tag : 'h4';
        const lvl = Math.min(6, Math.max(4, parseInt(tag[1], 10) + 1));
        return `<h${lvl}>${kids()}</h${lvl}>`;
      }
      case 'list':
        return node.listType === 'number' || node.tag === 'ol' ? `<ol>${kids()}</ol>` : `<ul>${kids()}</ul>`;
      case 'listitem': {
        const nested = (node.children || []).length === 1 && node.children[0].type === 'list';
        return nested ? kids() : `<li>${kids()}</li>`;
      }
      case 'linebreak':
        return '<br>';
      case 'quote':
        return `<blockquote>${kids()}</blockquote>`;
      case 'link':
      case 'autolink': {
        const href = /^https?:\/\//i.test(node.url || '') ? node.url : null;
        return href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${kids()}</a>` : kids();
      }
      case 'collapsible-container':
        return `<details class="faq"${node.open === false ? '' : ' open'}>${kids()}</details>`;
      case 'collapsible-title':
        return `<summary>${kids()}</summary>`;
      case 'collapsible-content':
        return `<div class="faq-body">${kids()}</div>`;
      case 'text': {
        let t = esc(node.text || '');
        const f = node.format || 0;
        if (f & 16) t = `<code>${t}</code>`;
        if (f & 1) t = `<strong>${t}</strong>`;
        if (f & 2) t = `<em>${t}</em>`;
        if (f & 4) t = `<s>${t}</s>`;
        if (f & 8) t = `<u>${t}</u>`;
        const st = safeStyle(node.style);
        return st ? `<span${st}>${t}</span>` : t;
      }
      case 'embed':
        return renderEmbed(node, opts);
      case 'tab':
        return ' ';
      default:
        if (node.children) return kids();
        if (node.text) return esc(node.text);
        return '';
    }
  }

  function renderEmbed(node, opts) {
    const text = node.text || '';
    const gd = opts.gd;
    let tipHtml = null;
    let cls = 'embed';
    let icon = null;
    try {
      if (gd && node.embedType === 'd4-item') {
        const r = gd.describeItemRef(node.id, opts.cls);
        if (r) {
          cls += ` r-${r.rarity.toLowerCase()}`;
          icon = r.image;
          tipHtml = `<div class="tt-title r-${r.rarity.toLowerCase()}">${esc(r.name)}</div><div class="tt-sub">${esc(r.rarity)} ${esc(r.type)}</div>${r.powerHtml ? `<div class="tt-body">${r.powerHtml}</div>` : ''}`;
        }
      } else if (gd && (node.embedType === 'd4-skill' || node.embedType === 'd4-power')) {
        const key = gd.d.skills[node.id] ? node.id : gd.skillFromId[node.id];
        if (key) {
          cls += ' e-skill';
          icon = gd.skillIcon(key);
          tipHtml = `<div class="tt-title">${esc(gd.skillName(key))}</div><div class="tt-body">${D4.renderText(gd.t.skills?.[key]?.desc || '', {})}</div>`;
        }
      } else if (gd && (node.embedType === 'd4-affix' || node.embedType === 'd4-aspect')) {
        const key = gd.affixKey(node.id) || node.id;
        const ta = gd.t.affixes?.[key];
        if (ta?.desc) {
          cls += ' r-legendary';
          tipHtml = `<div class="tt-title r-legendary">${esc(text)}</div><div class="tt-body">${D4.renderText(ta.desc, {})}</div>`;
        }
      } else if (gd && node.embedType === 'd4-paragon-glyph') {
        const g = gd.describeGlyph(node.id, 1);
        tipHtml = `<div class="tt-title">${esc(g.name)}</div><div class="tt-body">${g.html}</div>`;
      } else if (gd && node.embedType === 'd4-paragon-board') {
        tipHtml = `<div class="tt-title">${esc(gd.paragonBoardName(node.id))}</div>`;
      }
    } catch {
      tipHtml = null;
    }
    const tip = tipHtml && opts.tip ? ` data-tip="${opts.tip(tipHtml)}"` : '';
    const img = icon && !(node.options && node.options.textOnly) ? `<img class="embed-icon" src="${esc(D4.iconUrl(icon))}" alt="" loading="lazy">` : '';
    return `<span class="${cls}"${tip}>${img}${esc(text)}</span>`;
  }

  function lexicalToText(node) {
    if (!node) return '';
    if (node.root) return lexicalToText(node.root);
    const kids = (sep = '') => (node.children || []).map(lexicalToText).join(sep);
    switch (node.type) {
      case 'root': return kids('\n').replace(/\n{3,}/g, '\n\n').trim();
      case 'paragraph': return kids() + '\n';
      case 'heading': return `\n### ${kids()}\n`;
      case 'list': return (node.children || []).map((c) => lexicalToText(c)).join('');
      case 'listitem': {
        const nested = (node.children || []).length === 1 && node.children[0].type === 'list';
        return nested ? kids().replace(/^/gm, '  ') : `- ${kids()}\n`;
      }
      case 'linebreak': return '\n';
      case 'collapsible-title': return `**${kids()}**\n`;
      case 'text':
      case 'embed': return node.text || '';
      default: return node.children ? kids() : node.text || '';
    }
  }

  D4.renderLexical = renderLexical;
  D4.lexicalToText = lexicalToText;
  D4.hasLexicalContent = (n) => !!n && lexicalToText(n).trim().length > 0;
})(typeof globalThis !== 'undefined' ? globalThis : window);
