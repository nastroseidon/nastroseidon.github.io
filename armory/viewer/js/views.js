/* D4 Build Viewer - tab views. Each view renders into a container element. */
(function (root) {
  'use strict';
  const D4 = (root.D4 = root.D4 || {});
  const esc = (s) => D4.esc(s);
  const icon = (id, cls = '', alt = '') =>
    id ? `<img class="${cls}" src="${esc(D4.iconUrl(id))}" alt="${esc(alt)}" loading="lazy">` : `<span class="${cls} noicon"></span>`;
  const rcls = (rarity) => `r-${String(rarity || 'rare').toLowerCase()}`;

  // ================================================================= items
  function itemTooltip(entry) {
    const it = entry.item;
    let h = `<div class="tt-title ${rcls(it.rarity)}">${esc(it.name)}</div>`;
    h += `<div class="tt-sub">${esc(it.rarity)} ${esc(it.type)}${it.power ? ` &middot; ${esc(it.power)} Item Power` : ''}</div>`;
    h += itemBody(it, true);
    return h;
  }

  function affixList(list, cls) {
    if (!list.length) return '';
    return `<ul class="affixes ${cls || ''}">${list
      .map(
        (a) =>
          `<li class="${a.greater ? 'ga' : ''}${a.hidden ? ' alt' : ''}">${a.greater ? '<span class="ga-star" title="Greater Affix">&#9733;</span>' : ''}${a.html}${
            a.masterwork ? ' <span class="mw" title="Masterworking: prioritize this affix">&#8593;</span>' : ''
          }${a.hidden ? ' <span class="v-dim small">(alternative)</span>' : ''}</li>`
      )
      .join('')}</ul>`;
  }

  function itemBody(it, compact) {
    let h = '';
    if (it.implicits.length) h += affixList(it.implicits, 'implicit');
    if (it.explicits.length) h += affixList(it.explicits);
    if (it.tempered.length) h += `<div class="sect-label">Tempered</div>${affixList(it.tempered, 'tempered')}`;
    if (it.uniquePower) h += `<div class="power ${rcls(it.rarity)}">${it.uniquePower.html}</div>`;
    for (const a of it.aspects) {
      h += `<div class="power r-legendary">${a.aspectName ? `<div class="power-name">${esc(a.aspectName)}</div>` : ''}${a.html}</div>`;
    }
    if (it.sockets.length) {
      h += `<div class="sockets">${it.sockets
        .map(
          (s) =>
            `<div class="socket">${compact ? '' : icon(s.image, 'socket-icon', s.name)}<div><div class="socket-name">${esc(s.name)} <span class="v-dim">${esc(s.kind)}</span></div>${s.html ? `<div class="socket-desc">${s.html}</div>` : ''}</div></div>`
        )
        .join('')}</div>`;
    }
    return h;
  }

  function itemCard(entry) {
    const it = entry.item;
    return `<article class="item-card ${rcls(it.rarity)}">
      <header class="item-head">
        ${icon(it.image, 'item-icon', it.name)}
        <div class="item-titles">
          <div class="item-slot">${esc(entry.slotName)}</div>
          <div class="item-name ${rcls(it.rarity)}">${esc(it.name)}</div>
          <div class="item-type">${esc(it.rarity)} ${esc(it.type)}${it.power ? ` &middot; ${esc(it.power)} IP` : ''}${it.upgrade ? ` &middot; Masterwork ${esc(it.upgrade)}` : ''}</div>
        </div>
      </header>
      <div class="item-body">${itemBody(it, false)}</div>
    </article>`;
  }

  // ================================================================= overview
  function renderOverview(el, ctx) {
    const { model, planner, gd } = ctx;
    const pd = planner.data;
    let h = '<div class="grid-2">';

    // strengths/weaknesses
    const sw = pd.strAndWeak || {};
    if ((sw.strengths || []).length || (sw.weaknesses || []).length) {
      h += `<section class="panel"><h3>Strengths &amp; Weaknesses</h3><div class="sw">
        <ul class="pros">${(sw.strengths || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
        <ul class="cons">${(sw.weaknesses || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div></section>`;
    }

    // skill bar
    h += `<section class="panel"><h3>Skill Bar <span class="muted">(${esc(model.name)})</span></h3><div class="skillbar">${model.skillBar
      .map((s) => `<div class="sb-skill" data-tip="${D4.tip(`<div class="tt-title">${esc(s.name)}</div><div class="tt-body">${s.html}</div>`)}">${icon(s.icon, 'sb-icon', s.name)}<span>${esc(s.name)}</span></div>`)
      .join('')}</div></section>`;
    h += '</div>';

    // gear summary + comparison across variants
    const variants = pd.profiles.map((_, i) => (i === model.index ? model : ctx.variantModel(i)));
    const allSlots = [];
    for (const v of variants) for (const g of v.gear) if (!allSlots.includes(g.slot)) allSlots.push(g.slot);
    const order = [...D4.GEAR_SLOTS, ...D4.TALISMAN_SLOTS];
    allSlots.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    h += `<section class="panel"><h3>Gear by Variant</h3><p class="muted small">Highlighted cells change from the previous variant. Hover an item for full details.</p>
      <div class="table-wrap"><table class="compare"><thead><tr><th>Slot</th>${variants
        .map((v) => `<th class="${v.index === model.index ? 'cur' : ''}">${esc(v.name)}</th>`)
        .join('')}</tr></thead><tbody>`;
    for (const slot of allSlots) {
      h += `<tr><th>${esc(D4.SLOT_NAMES[slot] || slot)}</th>`;
      let prevKey = null;
      variants.forEach((v, vi) => {
        const g = v.gear.find((x) => x.slot === slot);
        const key = g ? `${g.item.name}|${g.item.aspects.map((a) => a.key).join(',')}` : '';
        const changed = vi > 0 && key !== prevKey;
        prevKey = key;
        if (!g) return void (h += `<td class="${changed ? 'chg' : ''} ${v.index === model.index ? 'cur' : ''}"><span class="muted">&mdash;</span></td>`);
        const it = g.item;
        const sub = it.aspects.length ? it.aspects.map((a) => a.aspectName).filter(Boolean).join(', ') : it.uniquePower ? 'Unique power' : '';
        h += `<td class="${changed ? 'chg' : ''} ${v.index === model.index ? 'cur' : ''}"><div class="cmp-item" data-tip="${D4.tip(() => itemTooltip(g))}">${icon(it.image, 'cmp-icon', it.name)}<div><div class="${rcls(it.rarity)}">${esc(it.name)}</div>${sub ? `<div class="muted small">${esc(sub)}</div>` : ''}</div></div></td>`;
      });
      h += '</tr>';
    }
    h += '</tbody></table></div></section>';

    // Intro / summary notes
    const gn = pd.globalNotes || {};
    for (const [k, title] of [['intro', 'Introduction'], ['summary', 'Summary']]) {
      if (D4.hasLexicalContent(gn[k])) h += `<section class="panel notes"><h3>${title}</h3>${D4.renderLexical(gn[k], { gd, tip: D4.tip, cls: model.cls })}</section>`;
    }
    el.innerHTML = h;
  }

  // ================================================================= gear
  function renderGear(el, ctx) {
    const { model, gd } = ctx;
    const main = model.gear.filter((g) => !g.talisman);
    const tal = model.gear.filter((g) => g.talisman);
    let h = '<div class="with-notes"><div class="main-col">';
    h += `<section><h3>Equipment</h3><div class="item-grid">${main.map(itemCard).join('') || '<p class="muted">No gear in this variant.</p>'}</div></section>`;
    if (tal.length) h += `<section><h3>Talisman &amp; Charms</h3><div class="item-grid">${tal.map(itemCard).join('')}</div></section>`;
    h += '</div>';
    h += notesAside(model.notes.equipment, 'Gear Notes', ctx);
    h += '</div>';
    el.innerHTML = h;
  }

  function notesAside(note, title, ctx) {
    if (!D4.hasLexicalContent(note)) return '';
    return `<aside class="notes-col panel notes"><h3>${esc(title)}</h3>${D4.renderLexical(note, { gd: ctx.gd, tip: D4.tip, cls: ctx.model.cls })}</aside>`;
  }

  // ================================================================= skills
  function skillTip(e, ctx) {
    const i = e.info;
    const rank = `${e.rank ?? 0}/${i.maxRank}`;
    const kind = i.kind === 'mod' ? `${i.parentName} modifier` : i.kind === 'skill' ? 'Active skill' : i.kind === 'passive' ? 'Passive' : '';
    return `<div class="tt-title">${esc(i.name)}</div><div class="tt-sub">${esc(kind)} &middot; Rank ${esc(rank)}</div>${i.desc ? `<div class="tt-body">${D4.renderText(i.desc, ctx)}</div>` : ''}`;
  }

  function skillTreeSvg(gd, tree, step, uid) {
    if (!tree) return { svg: '<p class="muted">Skill tree data not available.</p>', bounds: null };
    const nodes = tree.nodes || [];
    const byId = {};
    for (const n of nodes) byId[n.id] = n;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.pos.x); maxX = Math.max(maxX, n.pos.x);
      minY = Math.min(minY, n.pos.y); maxY = Math.max(maxY, n.pos.y);
    }
    const pad = 500;
    const bounds = { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
    const alloc = step.alloc;
    const isOn = (n) => n && (n.root || alloc[n.id] > 0);
    let lines = '';
    for (const c of tree.connections || []) {
      const a = byId[c.node1];
      const b = byId[c.node2];
      if (!a || !b) continue;
      const pts = [a.pos, ...(c.corners || []), b.pos].map((p) => `${p.x.toFixed(0)},${p.y.toFixed(0)}`).join(' ');
      lines += `<polyline points="${pts}" class="st-link${isOn(a) && isOn(b) ? ' on' : ''}"/>`;
    }
    let gs = '';
    for (const n of nodes) {
      const { x, y } = n.pos;
      if (n.root || !n.rewardId) {
        gs += `<g class="st-root" transform="translate(${x.toFixed(0)},${y.toFixed(0)})"><rect x="-170" y="-170" width="340" height="340" transform="rotate(45)"/>${n.requiredLevel ? `<text y="45" class="st-lvl">${esc(n.requiredLevel)}</text>` : ''}</g>`;
        continue;
      }
      const info = gd.rewardInfo(n.rewardId);
      const rank = alloc[n.id] || 0;
      const r = info.kind === 'skill' ? 330 : info.kind === 'mod' ? 240 : 220;
      const tipId = D4.tip(() => skillTip({ rank, info }, step.ctx));
      const shape =
        info.kind === 'passive'
          ? `<rect class="st-bg" x="${-r}" y="${-r}" width="${2 * r}" height="${2 * r}" rx="${r * 0.25}" transform="rotate(45)"/>`
          : `<circle class="st-bg" r="${r}"/>`;
      const img = info.icon
        ? `<image href="${esc(D4.iconUrl(info.icon))}" x="${-r * 0.86}" y="${-r * 0.86}" width="${r * 1.72}" height="${r * 1.72}" clip-path="url(#stclip-${uid})"/>`
        : '';
      const badge = rank > 0 && info.maxRank > 1 ? `<g class="st-badge" transform="translate(0,${r + 50})"><rect x="-150" y="-85" width="300" height="150" rx="50"/><text y="18">${rank}/${info.maxRank}</text></g>` : '';
      gs += `<g class="st-node k-${info.kind}${rank > 0 ? ' on' : ''}" transform="translate(${x.toFixed(0)},${y.toFixed(0)})" data-tip="${tipId}">${shape}${img}<circle class="st-ring" r="${r}"/>${badge}</g>`;
    }
    const svg = `<svg class="skilltree" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
      <defs><clipPath id="stclip-${uid}" clipPathUnits="objectBoundingBox"><circle cx="0.5" cy="0.5" r="0.5"/></clipPath></defs>
      <g class="links">${lines}</g><g class="nodes">${gs}</g></svg>`;
    return { svg, bounds };
  }

  function stepPills(steps, cur, attr, guideStep) {
    if (steps.length < 2) return '';
    return `<div class="pills" role="tablist">${steps
      .map(
        (s, i) =>
          `<button type="button" class="pill${i === cur ? ' active' : ''}" ${attr}="${i}">${esc(s.name)}${s.points != null ? ` <span class="muted">(${s.points})</span>` : ''}${
            i === guideStep ? ' <span class="guide-pick" title="The step this variant uses in the guide">&#9733;</span>' : ''
          }</button>`
      )
      .join('')}</div>`;
  }

  function skillAllocationList(step) {
    let h = '<div class="alloc">';
    for (const s of step.skills) {
      h += `<div class="alloc-skill" data-tip="${D4.tip(() => skillTip(s, step.ctx))}">${icon(s.info.icon, 'alloc-icon', s.info.name)}<div><div class="alloc-name">${esc(s.info.name)} <span class="rank">${s.rank}/${s.info.maxRank}</span></div>${s.mods.length ? `<div class="alloc-mods">${s.mods.map((m) => `<span class="mod" data-tip="${D4.tip(() => skillTip(m, step.ctx))}">${esc(m.info.name)}</span>`).join('')}</div>` : ''}</div></div>`;
    }
    if (step.passives.length) {
      h += `<div class="sect-label">Passives</div><div class="alloc-passives">${step.passives
        .map((p) => `<span class="passive" data-tip="${D4.tip(() => skillTip(p, step.ctx))}">${icon(p.info.icon, 'p-icon', p.info.name)}${esc(p.info.name)} <span class="rank">${p.rank}/${p.info.maxRank}</span></span>`)
        .join('')}</div>`;
    }
    return h + '</div>';
  }

  function renderSkills(el, ctx) {
    const { model, gd, state } = ctx;
    const steps = model.skillTree.steps;
    const si = Math.min(state.skillStep ?? model.skillTree.active ?? steps.length - 1, steps.length - 1);
    const step = steps[si];
    let h = '<div class="with-notes"><div class="main-col">';
    h += `<section class="panel"><h3>Skill Bar</h3><div class="skillbar">${model.skillBar
      .map((s) => `<div class="sb-skill" data-tip="${D4.tip(`<div class="tt-title">${esc(s.name)}</div><div class="tt-body">${s.html}</div>`)}">${icon(s.icon, 'sb-icon', s.name)}<span>${esc(s.name)}</span></div>`)
      .join('')}</div></section>`;
    if (!step) {
      h += '<p class="muted">No skill tree in this variant.</p></div></div>';
      el.innerHTML = h;
      return;
    }
    h += `<section class="panel"><h3>Skill Tree <span class="muted">&middot; ${step.points} points</span></h3>${stepPills(steps, si, 'data-skill-step', model.skillTree.active)}<div class="tree-slot"></div></section>`;
    h += `<section class="panel"><h3>Allocated</h3>${skillAllocationList(step)}</section>`;
    h += '</div>';
    h += notesAside(model.notes.skills, 'Skill & Rotation Notes', ctx);
    h += '</div>';
    el.innerHTML = h;

    const { svg, bounds } = skillTreeSvg(gd, model.skillTree.tree, step, `s${Date.now()}`);
    const slot = el.querySelector('.tree-slot');
    if (bounds) {
      const wrap = D4.mapViewport(svg);
      slot.appendChild(wrap);
      const pz = D4.panZoom(wrap.querySelector('svg'), bounds);
      D4.bindMapControls(wrap, pz);
    } else slot.innerHTML = svg;
    el.querySelectorAll('[data-skill-step]').forEach((b) =>
      b.addEventListener('click', () => {
        state.skillStep = Number(b.getAttribute('data-skill-step'));
        renderSkills(el, ctx);
      })
    );
  }

  // ================================================================= paragon
  const S = 21;
  function paragonSvg(gd, step, uid) {
    if (!step.boards.length) return { svg: '<p class="muted">No paragon boards.</p>', bounds: null };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of step.boards) {
      minX = Math.min(minX, b.position.x); maxX = Math.max(maxX, b.position.x);
      minY = Math.min(minY, b.position.y); maxY = Math.max(maxY, b.position.y);
    }
    const pad = 2;
    const bounds = { x: minX * S - pad, y: minY * S - pad, w: (maxX - minX + 1) * S + pad * 2, h: (maxY - minY + 1) * S + pad * 2 };
    let out = '';
    for (const b of step.boards) {
      const bx = b.position.x * S;
      const by = b.position.y * S;
      let cells = '';
      let socketCell = null;
      const nodes = b.def.nodes || [];
      for (let idx = 0; idx < nodes.length; idx++) {
        const key = nodes[idx];
        if (!key) continue;
        const n = gd.d.paragonNodes?.[key];
        const kind = !n ? 'normal' : n.socket ? 'socket' : n.gate ? 'gate' : n.start ? 'start' : ['normal', 'normal', 'magic', 'rare', 'legendary'][n.rarity] || 'normal';
        const r = D4.rotateIndex(idx, b.rotation);
        const cx = bx + (r % S);
        const cy = by + Math.floor(r / S);
        const on = !!b.nodes[idx];
        if (kind === 'socket') socketCell = { cx, cy, on };
        const tipId = D4.tip(() => {
          if (kind === 'socket' && b.glyphInfo) {
            return `<div class="tt-title">${esc(b.glyphInfo.name)} <span class="muted">Lv ${esc(b.glyphLevel)}</span></div><div class="tt-sub">Glyph</div><div class="tt-body">${b.glyphInfo.html}</div>`;
          }
          const d = gd.describeParagonNode(key, { boardIndex: b.index, cls: step.cls });
          return `<div class="tt-title p-${kind}">${esc(d.name)}</div><div class="tt-sub">${esc(kind === 'normal' ? 'Normal' : kind[0].toUpperCase() + kind.slice(1))} node${on ? ' &middot; <span class="v-green">allocated</span>' : ''}</div>${d.html ? `<div class="tt-body">${d.html}</div>` : ''}`;
        });
        const cls = `pn p-${kind}${on ? ' on' : ''}`;
        if (kind === 'socket' || kind === 'legendary' || kind === 'start') {
          cells += `<circle class="${cls}" cx="${cx + 0.5}" cy="${cy + 0.5}" r="${kind === 'legendary' ? 0.62 : 0.5}" data-tip="${tipId}"/>`;
        } else if (kind === 'gate') {
          cells += `<rect class="${cls}" x="${cx + 0.15}" y="${cy + 0.15}" width="0.7" height="0.7" transform="rotate(45 ${cx + 0.5} ${cy + 0.5})" data-tip="${tipId}"/>`;
        } else {
          const sz = kind === 'rare' ? 0.86 : 0.74;
          const o = (1 - sz) / 2;
          cells += `<rect class="${cls}" x="${cx + o}" y="${cy + o}" width="${sz}" height="${sz}" rx="0.14" data-tip="${tipId}"/>`;
        }
      }
      let glyph = '';
      if (b.glyph && socketCell) {
        const gid = b.glyphInfo?.icon;
        if (gid) glyph += `<image class="glyph-img" href="${esc(D4.iconUrl(gid))}" x="${socketCell.cx - 0.15}" y="${socketCell.cy - 0.15}" width="1.3" height="1.3" pointer-events="none"/>`;
      }
      const label = `${b.index + 1}  ${b.name}${b.glyphInfo ? ` / ${b.glyphInfo.name}` : ''}`;
      out += `<g class="board">
        <rect class="board-bg" x="${bx + 0.1}" y="${by + 0.1}" width="${S - 0.2}" height="${S - 0.2}" rx="0.6"/>
        <text class="board-label" x="${bx + 0.7}" y="${by + 1.3}">${esc(label)}</text>
        ${cells}${glyph}</g>`;
    }
    return {
      svg: `<svg class="paragon" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" data-uid="${uid}">${out}</svg>`,
      bounds,
    };
  }

  function renderParagon(el, ctx) {
    const { model, gd, state } = ctx;
    const steps = model.paragon.steps;
    if (!steps.length) {
      el.innerHTML = '<p class="muted">No paragon data in this variant.</p>';
      return;
    }
    const si = Math.min(state.paragonStep ?? model.paragon.active ?? steps.length - 1, steps.length - 1);
    const step = steps[si];
    step.cls = model.cls;
    let h = '<div class="with-notes"><div class="main-col">';
    h += `<section class="panel"><h3>Paragon Boards <span class="muted">&middot; ${step.points} points</span></h3>${stepPills(steps, si, 'data-par-step', model.paragon.active)}
      <div class="legend"><span><i class="lg p-normal"></i>Normal</span><span><i class="lg p-magic"></i>Magic</span><span><i class="lg p-rare"></i>Rare</span><span><i class="lg p-legendary"></i>Legendary</span><span><i class="lg p-socket"></i>Glyph socket</span><span><i class="lg p-gate"></i>Gate</span><span class="muted">Bright = allocated</span></div>
      <div class="par-slot"></div></section>`;
    h += `<section class="panel"><h3>Boards &amp; Glyphs</h3><div class="boards">`;
    for (const b of step.boards) {
      h += `<div class="board-card" data-focus="${b.index}">
        <div class="bc-head"><span class="bc-num">${b.index + 1}</span><div><div class="bc-name">${esc(b.name)}</div><div class="muted small">Rotation ${b.rotation * 90}&deg; &middot; ${b.allocated.length} nodes</div></div></div>
        ${b.glyphInfo ? `<div class="bc-glyph" data-tip="${D4.tip(`<div class="tt-title">${esc(b.glyphInfo.name)} <span class="muted">Lv ${esc(b.glyphLevel)}</span></div><div class="tt-body">${b.glyphInfo.html}</div>`)}">${icon(b.glyphInfo.icon, 'glyph-icon', b.glyphInfo.name)}<span>${esc(b.glyphInfo.name)}</span> <span class="muted">Lv ${esc(b.glyphLevel)}</span></div>` : '<div class="muted small">No glyph</div>'}
        ${b.notable.length ? `<div class="bc-nodes">${b.notable.map((n) => `<span class="pn-chip p-${n.kind}" data-tip="${D4.tip(`<div class="tt-title p-${n.kind}">${esc(n.name)}</div><div class="tt-body">${n.html}</div>`)}">${esc(n.name)}</span>`).join('')}</div>` : ''}
      </div>`;
    }
    h += '</div></section></div>';
    h += notesAside(model.notes.paragon, 'Paragon Notes', ctx);
    h += '</div>';
    el.innerHTML = h;

    const { svg, bounds } = paragonSvg(gd, step, `p${Date.now()}`);
    const slot = el.querySelector('.par-slot');
    if (bounds) {
      const wrap = D4.mapViewport(svg);
      wrap.classList.add('map-tall');
      slot.appendChild(wrap);
      const pz = D4.panZoom(wrap.querySelector('svg'), bounds, { minW: 8 });
      D4.bindMapControls(wrap, pz);
      el.querySelectorAll('[data-focus]').forEach((c) =>
        c.addEventListener('click', (e) => {
          if (e.target.closest('[data-tip]') && e.pointerType !== 'mouse') return;
          const b = step.boards[Number(c.getAttribute('data-focus'))];
          pz.focus(b.position.x * S + S / 2, b.position.y * S + S / 2, S * 1.6);
          wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        })
      );
    } else slot.innerHTML = svg;
    el.querySelectorAll('[data-par-step]').forEach((b) =>
      b.addEventListener('click', () => {
        state.paragonStep = Number(b.getAttribute('data-par-step'));
        renderParagon(el, ctx);
      })
    );
  }


  // ================================================================= systems
  function chip(name, icon_, html, extraCls = '', sub = '') {
    const tip = html || sub ? ` data-tip="${D4.tip(`<div class="tt-title">${esc(name)}</div>${sub ? `<div class="tt-sub">${esc(sub)}</div>` : ''}${html ? `<div class="tt-body">${html}</div>` : ''}`)}"` : '';
    return `<span class="passive ${extraCls}"${tip}>${icon(icon_, 'p-icon', name)}${esc(name)}</span>`;
  }

  function renderSystems(el, ctx) {
    const { model, gd } = ctx;
    let h = '<div class="with-notes"><div class="main-col">';
    const none = (what) => `<p class="muted">This variant&rsquo;s planner has no ${what}.</p>`;

    // Mercenaries
    const m = model.mercenary;
    h += '<section class="panel"><h3>Mercenaries</h3>';
    if (m) {
      h += `<div class="merc-grid">
        <div><div class="sect-label">Hired</div><div class="merc-name">${esc(m.name)}</div></div>
        <div><div class="sect-label">Reinforcement</div><div class="merc-name">${esc(m.support || '—')}</div></div>
        <div><div class="sect-label">Reinforcement skill</div>${m.reinforcementSkill ? chip(m.reinforcementSkill.name, m.reinforcementSkill.icon, m.reinforcementSkill.html) : '<span class="muted">—</span>'}</div>
        <div><div class="sect-label">Trigger</div>${m.trigger ? chip(m.trigger.name, m.trigger.icon, m.trigger.html) : '<span class="muted">—</span>'}</div>
      </div>`;
      if (m.tree && (m.tree.skills.length || m.tree.passives.length)) h += `<div class="sect-label">${esc(m.name)}&rsquo;s skills</div>${skillAllocationList(m.tree)}`;
    } else h += none('mercenary setup');
    h += '</section>';

    // War Plans
    h += '<section class="panel"><h3>War Plans</h3>';
    if (model.warPlans.length) {
      h += '<div class="wp-grid">';
      for (const w of model.warPlans) {
        const nodes = [...w.step.skills, ...w.step.passives];
        h += `<div class="wp"><div class="wp-head">${icon(w.icon, 'p-icon', w.name)}<strong>${esc(w.name)}</strong> <span class="muted small">${w.step.points} pts</span></div><div class="alloc-passives">${nodes
          .map((n) => chip(n.info.name, n.info.icon, D4.renderText(n.info.desc || '', {}), '', `Rank ${n.rank}/${n.info.maxRank}`))
          .join('')}</div></div>`;
      }
      h += '</div>';
    } else h += none('War Plans');
    h += '</section>';

    // Seasonal powers
    h += '<section class="panel"><h3>Seasonal Powers</h3>';
    if (model.seasonal.length) {
      for (const g of model.seasonal) {
        h += `<div class="sect-label">${esc(g.title)}${g.season ? ` &middot; Season ${esc(g.season)} system` : ''}</div><div class="alloc-passives">${g.powers
          .map((p) => chip(p.name, p.icon, p.html, g.key === 'primeevil' ? 'pep' : '', `${p.kind}${p.level > 1 ? ` · level ${p.level}` : ''}`))
          .join('')}</div>`;
      }
      if (model.seasonal.some((g) => g.season && g.key !== 'primeevil'))
        h += '<p class="muted small">Powers from earlier seasons can remain in a planner after their season ends. Check they still apply to your realm and season.</p>';
    } else h += none('Prime Evil or other seasonal powers');
    h += '</section>';

    // Class mechanics
    h += '<section class="panel"><h3>Class Mechanic</h3>';
    if (model.classMechanics.length) {
      const groups = {};
      for (const c of model.classMechanics) (groups[c.label] ||= []).push(c);
      for (const [label, list] of Object.entries(groups))
        h += `<div class="sect-label">${esc(label)}</div><div class="alloc-passives">${list.map((c) => chip(c.name, c.icon, c.html)).join('')}</div>`;
    } else h += none('class mechanic choices');
    h += '</section>';

    if (model.rotations.length) {
      h += `<section class="panel"><h3>Rotation</h3>${model.rotations
        .map((r) => `<div class="rot"><span class="rot-name">${esc(r.name)}</span>${r.skills.map((x) => chip(x.name, x.icon, '')).join('<span class="rot-arrow">&rarr;</span>')}</div>`)
        .join('')}</section>`;
    }
    if (model.elixirs.length) h += `<section class="panel"><h3>Elixirs &amp; Incense</h3><div class="alloc-passives">${model.elixirs.map((e) => chip(e.name, e.image, '')).join('')}</div></section>`;
    if (model.world) h += `<p class="muted small">Renown assumed by the planner: ${esc(model.world.renownSkills ?? '?')} skill points, ${esc(model.world.renownParagon ?? '?')} Paragon points.</p>`;
    h += '</div>';
    h += notesAside(model.notes.mercenary, 'Mercenary Notes', ctx);
    h += '</div>';
    el.innerHTML = h;
  }

  // ================================================================= notes
  function renderNotes(el, ctx) {
    const { planner, model, gd } = ctx;
    const gn = planner.data.globalNotes || {};
    const opts = { gd, tip: D4.tip, cls: model.cls };
    let h = '';
    const sections = [
      ['intro', 'Introduction', gn.intro],
      ['summary', 'Summary', gn.summary],
      ['faqs', 'FAQ & Mechanics', gn.faqs],
      ['eq', `Gear Notes (${model.name})`, model.notes.equipment],
      ['sk', `Skill Notes (${model.name})`, model.notes.skills],
      ['pa', `Paragon Notes (${model.name})`, model.notes.paragon],
      ['me', `Mercenary Notes (${model.name})`, model.notes.mercenary],
      ['changelog', 'Changelog', gn.changelog],
    ];
    for (const [, title, note] of sections) {
      if (D4.hasLexicalContent(note)) h += `<section class="panel notes"><h3>${esc(title)}</h3>${D4.renderLexical(note, opts)}</section>`;
    }
    for (const [k, note] of Object.entries(model.notes)) {
      if (['equipment', 'skills', 'paragon', 'mercenary'].includes(k)) continue;
      if (D4.hasLexicalContent(note)) h += `<section class="panel notes"><h3>${esc(D4.humanize(k))} Notes</h3>${D4.renderLexical(note, opts)}</section>`;
    }
    el.innerHTML = h || '<p class="muted">This build has no written notes.</p>';
  }

  D4.views = {
    overview: renderOverview,
    gear: renderGear,
    skills: renderSkills,
    paragon: renderParagon,
    systems: renderSystems,
    notes: renderNotes,
  };
  D4.itemTooltip = itemTooltip;
})(typeof globalThis !== 'undefined' ? globalThis : window);
