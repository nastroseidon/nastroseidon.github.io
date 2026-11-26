/* D4 Build Viewer - export a resolved build as JSON or Markdown. */
(function (root) {
  'use strict';
  const D4 = (root.D4 = root.D4 || {});
  const txt = (html) => D4.htmlToText(html || '').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();

  function itemToJson(g) {
    const it = g.item;
    return {
      slot: g.slotName,
      name: it.name,
      rarity: it.rarity,
      type: it.type,
      itemPower: it.power,
      uniquePower: it.uniquePower ? txt(it.uniquePower.html) : undefined,
      aspects: it.aspects.map((a) => ({ name: a.aspectName, text: txt(a.html) })),
      masterworkRank: it.upgrade || undefined,
      affixes: it.explicits.map((a) => ({ text: txt(a.html), greater: !!a.greater, masterworkPriority: a.masterwork || undefined, alternative: a.hidden || undefined })),
      implicits: it.implicits.length ? it.implicits.map((a) => txt(a.html)) : undefined,
      tempered: it.tempered.map((a) => txt(a.html)),
      sockets: it.sockets.map((s) => ({ name: s.name, kind: s.kind, text: txt(s.html) })),
    };
  }

  function variantToJson(v) {
    return {
      name: v.name,
      class: v.className,
      level: v.level,
      worldTier: v.worldTier,
      skillBar: v.skillBar.map((s) => s.name),
      gear: v.gear.map(itemToJson),
      skillTree: v.skillTree.steps.map((st) => ({
        step: st.name,
        points: st.points,
        skills: st.skills.map((s) => ({ name: s.info.name, rank: s.rank, maxRank: s.info.maxRank, modifiers: s.mods.map((m) => m.info.name) })),
        passives: st.passives.map((p) => ({ name: p.info.name, rank: p.rank, maxRank: p.info.maxRank })),
      })),
      paragon: v.paragon.steps.map((st) => ({
        step: st.name,
        points: st.points,
        boards: st.boards.map((b) => ({
          order: b.index + 1,
          board: b.name,
          rotation: b.rotation * 90,
          glyph: b.glyphInfo ? { name: b.glyphInfo.name, level: b.glyphLevel, text: txt(b.glyphInfo.html) } : null,
          notableNodes: b.notable.map((n) => n.name),
          allocatedNodes: b.allocated.length,
        })),
      })),
      classMechanics: v.classMechanics.map((c) => ({ type: c.label, choice: c.name })),
      mercenary: v.mercenary
        ? {
            hired: v.mercenary.name,
            reinforcement: v.mercenary.support,
            reinforcementSkill: v.mercenary.reinforcementSkill?.name,
            trigger: v.mercenary.trigger?.name,
            skills: v.mercenary.tree ? [...v.mercenary.tree.skills, ...v.mercenary.tree.passives].map((s) => s.info.name) : [],
          }
        : undefined,
      warPlans: v.warPlans.map((w) => ({ plan: w.name, nodes: [...w.step.skills, ...w.step.passives].map((n) => ({ name: n.info.name, rank: n.rank })) })),
      seasonalPowers: v.seasonal.map((g) => ({ system: g.title, season: g.season, powers: g.powers.map((p) => ({ name: p.name, kind: p.kind, level: p.level, text: txt(p.html) })) })),
      rotations: v.rotations.map((r) => ({ name: r.name, skills: r.skills.map((x) => x.name) })),
      elixirs: v.elixirs.map((e) => e.name),
      notes: Object.fromEntries(Object.entries(v.notes || {}).map(([k, n]) => [k, D4.lexicalToText(n)]).filter(([, t]) => t.trim())),
    };
  }

  function buildToJson(source, planner, variants, gd) {
    const pd = planner.data;
    return {
      exportedAt: new Date().toISOString(),
      gameDataVersion: gd.version,
      guide: source.guide ? { title: source.guide.title, url: source.guide.url, author: source.guide.author, updated: source.guide.updated } : undefined,
      planner: { id: planner.id, name: planner.name, class: planner.className, updated: planner.date, url: `https://maxroll.gg/d4/planner/${planner.id}` },
      strengths: pd.strAndWeak?.strengths || [],
      weaknesses: pd.strAndWeak?.weaknesses || [],
      notes: Object.fromEntries(Object.entries(pd.globalNotes || {}).map(([k, n]) => [k, D4.lexicalToText(n)]).filter(([, t]) => t.trim())),
      variants: variants.map(variantToJson),
      raw: pd,
    };
  }

  function buildToMarkdown(source, planner, variants) {
    const pd = planner.data;
    const L = [];
    L.push(`# ${source.guide?.title || planner.name}`);
    L.push('');
    if (source.guide) L.push(`Guide: ${source.guide.url}${source.guide.author ? ` (by ${source.guide.author})` : ''}${source.guide.updated ? ` - updated ${source.guide.updated}` : ''}`);
    L.push(`Planner: https://maxroll.gg/d4/planner/${planner.id} - ${planner.name} (${planner.className})`);
    L.push('');
    const sw = pd.strAndWeak || {};
    if ((sw.strengths || []).length) L.push(`**Strengths:** ${sw.strengths.join('; ')}`);
    if ((sw.weaknesses || []).length) L.push(`**Weaknesses:** ${sw.weaknesses.join('; ')}`);
    for (const v of variants) {
      L.push('', `## ${v.name}`, '');
      L.push(`**Skill bar:** ${v.skillBar.map((s) => s.name).join(' / ')}`, '');
      L.push('### Gear', '');
      for (const g of v.gear) {
        const it = g.item;
        L.push(`- **${g.slotName}: ${it.name}** _(${it.rarity} ${it.type})_`);
        if (it.uniquePower) L.push(`  - Unique: ${txt(it.uniquePower.html)}`);
        for (const a of it.aspects) L.push(`  - ${a.aspectName || 'Aspect'}: ${txt(a.html)}`);
        for (const a of it.explicits) L.push(`  - ${a.greater ? '★ ' : ''}${txt(a.html)}${a.masterwork ? ' ↑ (masterwork priority)' : ''}${a.hidden ? ' (alternative)' : ''}`);
        for (const a of it.tempered) L.push(`  - Tempered: ${txt(a.html)}`);
        for (const s of it.sockets) L.push(`  - Socket: ${s.name} (${s.kind})${s.html ? ` - ${txt(s.html)}` : ''}`);
      }
      for (const st of v.skillTree.steps) {
        L.push('', `### Skill Tree${v.skillTree.steps.length > 1 ? ` - ${st.name}` : ''} (${st.points} points)`, '');
        for (const s of st.skills) L.push(`- ${s.info.name} ${s.rank}/${s.info.maxRank}${s.mods.length ? ` - ${s.mods.map((m) => m.info.name).join(', ')}` : ''}`);
        if (st.passives.length) L.push(`- Passives: ${st.passives.map((p) => `${p.info.name} ${p.rank}/${p.info.maxRank}`).join(', ')}`);
      }
      if (v.classMechanics.length) L.push('', `**Class mechanic:** ${v.classMechanics.map((c) => `${c.label}: ${c.name}`).join('; ')}`);
      if (v.mercenary) {
        const m = v.mercenary;
        L.push('', `**Mercenary:** ${m.name}${m.tree ? ` (${[...m.tree.skills, ...m.tree.passives].map((s) => s.info.name).join(', ')})` : ''}`);
        if (m.support) L.push(`**Reinforcement:** ${m.support}${m.reinforcementSkill ? ` - ${m.reinforcementSkill.name}` : ''}${m.trigger ? `, trigger: ${m.trigger.name}` : ''}`);
      }
      if (v.warPlans.length) {
        L.push('', '### War Plans', '');
        for (const w of v.warPlans) L.push(`- **${w.name}:** ${[...w.step.skills, ...w.step.passives].map((n) => n.info.name).join(', ')}`);
      }
      for (const g of v.seasonal) L.push('', `**${g.title}:** ${g.powers.map((p) => p.name + (p.level > 1 ? ` (lv ${p.level})` : '')).join(', ')}`);
      for (const r of v.rotations) L.push('', `**Rotation - ${r.name}:** ${r.skills.map((x) => x.name).join(' → ')}`);
      if (v.elixirs.length) L.push('', `**Elixirs:** ${v.elixirs.map((e) => e.name).join(', ')}`);
      for (const st of v.paragon.steps) {
        L.push('', `### Paragon - ${st.name} (${st.points} points)`, '');
        for (const b of st.boards) {
          L.push(`${b.index + 1}. **${b.name}** (rotation ${b.rotation * 90}°)${b.glyphInfo ? ` - Glyph: ${b.glyphInfo.name} lv ${b.glyphLevel}` : ''}`);
          if (b.notable.length) L.push(`   - Nodes: ${b.notable.map((n) => n.name).join(', ')}`);
        }
      }
      for (const [k, n] of Object.entries(v.notes || {})) {
        const t = D4.lexicalToText(n).trim();
        if (t) L.push('', `### ${D4.humanize(k)} notes`, '', t);
      }
    }
    for (const [k, n] of Object.entries(pd.globalNotes || {})) {
      const t = D4.lexicalToText(n).trim();
      if (t) L.push('', `## ${D4.humanize(k).replace(/^\w/, (c) => c.toUpperCase())}`, '', t);
    }
    return L.join('\n') + '\n';
  }

  function download(filename, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }

  D4.exporter = { buildToJson, buildToMarkdown, download, variantToJson };
})(typeof globalThis !== 'undefined' ? globalThis : window);
