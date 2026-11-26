/*
 * D4 Build Viewer - resolves one planner variant ("Starter", "Endgame", ...)
 * into a plain, display-ready model used by both the UI and the exporters.
 */
(function (root) {
  'use strict';
  const D4 = (root.D4 = root.D4 || {});
  const S = 21;

  const slotKind = (slot) => (slot >= 16 && slot <= 18 ? 2 : (slot >= 7 && slot <= 12) || slot === 6 ? 0 : 1);
  // Off-hand (6) is a weapon slot for some classes; gems use the armor effect there in game.
  const gemSlotKind = (slot) => (slot === 6 ? 1 : slotKind(slot));

  function buildVariant(gd, planner, vi) {
    const pd = planner.data;
    const p = pd.profiles[vi];
    const cls = p.class;

    const equipped = new Set();
    for (const ref of Object.values(p.items || {})) {
      const it = pd.items?.[ref];
      if (!it) continue;
      for (const ex of [...(it.explicits || []), ...(it.aspects || []), ...(it.implicits || []), ...(it.tempered || [])]) equipped.add(ex.nid);
    }
    const affixEquipped = (id) => equipped.has(id);

    // ---------------------------------------------------------------- gear
    const gear = [];
    const slots = Object.keys(p.items || {}).map(Number).sort((a, b) => {
      const order = [...D4.GEAR_SLOTS, ...D4.TALISMAN_SLOTS];
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia < 0 ? 99 + a : ia) - (ib < 0 ? 99 + b : ib);
    });
    for (const slot of slots) {
      const it = pd.items?.[p.items[slot]];
      if (!it) continue;
      gear.push({
        slot,
        slotName: D4.SLOT_NAMES[slot] || `Slot ${slot}`,
        talisman: slot >= 20,
        item: gd.describeItem(it, cls, { affixEquipped, slotKind: gemSlotKind(slot) }),
      });
    }

    // ---------------------------------------------------------------- skills
    const treeKey = gd.classTreeKey(cls);
    const tree = gd.d.skillTrees?.[treeKey];
    const skillSteps = (p.skillTree?.steps || []).map((st) => buildSkillStep(gd, tree, st.data || {}, st.name, affixEquipped));
    const pick = (pos, n) => (Number.isInteger(pos) && pos >= 0 && pos < n ? pos : Math.max(0, n - 1));
    const skillActive = pick(p.skillTree?.position, skillSteps.length);
    const activeSkillStep = skillSteps[skillActive];
    const mods = activeSkillStep ? activeSkillStep.mods : new Set();
    const skillBar = (p.skillBar || []).filter(Boolean).map((key) => ({
      key,
      name: gd.skillName(key),
      icon: gd.skillIcon(key),
      html: D4.renderText(gd.t.skills?.[key]?.desc || '', { mods, affixEquipped }),
    }));

    // ---------------------------------------------------------------- paragon
    const paragonSteps = (p.paragon?.steps || []).map((st) => buildParagonStep(gd, st, cls));
    const paragonActive = pick(p.paragon?.position, paragonSteps.length);

    // ---------------------------------------------------------------- extras
    const minionLabel = (key) => {
      const m = String(key).match(/^Necromancer_(SkeletonWarrior|SkeletonMage|Golem)_([A-Za-z]+)_Passive_(.+)$/);
      if (!m) return gd.skillName(key);
      const unit = { SkeletonWarrior: 'Skeletal Warriors', SkeletonMage: 'Skeletal Mages', Golem: 'Golem' }[m[1]];
      const choice = /^Sacrifice/.test(m[3]) ? 'Sacrifice' : m[3].replace(/^Upgrade/, 'Upgrade ');
      return `${unit}: ${m[2]} \u2014 ${choice}`;
    };
    const minions = (p.minionUpgrades || []).map((key, i) => ({
      key,
      name: minionLabel(key),
      icon: gd.skillIcon(key),
      spec: p.minionSpec?.[i],
      html: D4.renderText(gd.t.skills?.[key]?.desc || '', {}),
    }));

    // Mercenaries: hired companion + skill tree, reinforcement + its skill and trigger
    let mercenary = null;
    if (p.mercenary && p.mercenary.id) {
      const m = p.mercenary;
      const mercName = (id) => (id ? gd.t.mercenaries?.[id]?.name || D4.humanize(String(id).replace('MercenaryClass_', '')) : null);
      const mtreeKey = gd.d.mercenaries?.[m.id]?.tree || String(m.id).replace('MercenaryClass_', 'Mercenary_');
      const mtree = gd.d.skillTrees?.[mtreeKey];
      const sk = (k) => (k ? { key: k, name: gd.skillName(k), icon: gd.skillIcon(k), html: D4.renderText(gd.t.skills?.[k]?.desc || '', {}) } : null);
      const [reinforcementSkill, triggerKey] = m.supportSkills || [];
      const trig = triggerKey && D4.MERCENARY_TRIGGERS[triggerKey];
      const trigger = trig
        ? { key: triggerKey, name: trig.name, icon: trig.icon, html: D4.renderText(trig.text, {}) }
        : triggerKey
          ? { key: triggerKey, name: `Casting ${gd.skillName(triggerKey)}`, icon: gd.skillIcon(triggerKey), html: D4.esc(`Cast when the player casts ${gd.skillName(triggerKey)}.`) }
          : null;
      mercenary = {
        id: m.id,
        name: mercName(m.id),
        support: mercName(m.support),
        supportId: m.support || null,
        reinforcementSkill: sk(reinforcementSkill),
        trigger,
        treeKey: mtreeKey,
        treeDef: mtree || null,
        tree: mtree ? buildSkillStep(gd, mtree, normaliseAlloc(m.tree), 'Mercenary', affixEquipped) : null,
      };
    }

    // War Plans: 7 activity trees (Whispers, Nightmare Dungeons, Helltide, ...)
    const warPlans = [];
    (p.warPlans || []).forEach((alloc, i) => {
      const def = gd.d.warPlans?.[i];
      const tree = def && gd.d.skillTrees?.[def.tree];
      const data = normaliseAlloc(alloc);
      if (!tree || !Object.values(data).some((r) => r > 0)) return;
      const step = buildSkillStep(gd, tree, data, gd.t.warPlans?.[i]?.name || D4.humanize(def.tree), affixEquipped);
      warPlans.push({ index: i, key: def.tree, name: step.name, icon: def.icon, tree, step });
    });

    // Seasonal powers: Prime Evil (S15) and older seasonal systems
    const seasonal = [];
    const stoneGroups = [
      ['primeevil', 'Prime Evil Powers'],
      ['witch', 'Witch Powers'],
      ['boss', 'Boss Powers'],
      ['chaos', 'Chaos Perks'],
      ['horadric', 'Horadric Spells'],
      ['divinegifts', 'Divine Gifts'],
    ];
    for (const [key, title] of stoneGroups) {
      const list = (p[key] || []).filter(Boolean).map((e) => gd.describeStone(e)).filter(Boolean);
      if (list.length) seasonal.push({ key, title, powers: list, season: list.find((x) => x.season)?.season || null });
    }
    if (Array.isArray(p.stones) && p.stones.some((g) => Array.isArray(g) && g.some(Boolean))) {
      const list = p.stones.flat().filter(Boolean).map((e) => gd.describeStone(e)).filter(Boolean);
      if (list.length) seasonal.push({ key: 'stones', title: 'Construct Stones', powers: list, season: '3' });
    }
    if ((p.vampiricPowers || []).some(Boolean)) {
      const list = p.vampiricPowers.filter(Boolean).map((v) => gd.describeVampiricPower(typeof v === 'string' ? v : v?.id)).filter(Boolean);
      if (list.length) seasonal.push({ key: 'vampiricPowers', title: 'Vampiric Powers', powers: list, season: '2' });
    }

    // Class mechanics
    const mech = [];
    const mk = (label, key, extra = '') =>
      key && mech.push({ label, key, name: gd.mechanicName(key) + extra, icon: gd.skillIcon(key), html: gd.mechanicHtml(key, { mods, affixEquipped }) });
    if (p.technique) mk('Weapon Technique', p.technique);
    for (const [skill, weapon] of Object.entries(p.arsenal || {})) mk('Arsenal', skill, ` \u2192 ${weapon}`);
    for (const [k, lvl] of Object.entries(p.expertise || {})) mk('Weapon Expertise', k, lvl ? ` (level ${lvl})` : '');
    if (p.specialization) mk('Specialization', p.specialization);
    if (p.oath) mk('Oath', p.oath);
    for (const e of p.enchants || []) mk('Enchantment', e);
    for (const b of p.spiritBoons || []) mk('Spirit Boon', b);
    for (const b of p.animalSpirits || []) mk('Spirit Hall', b);
    if (p.warlockShard) mk('Shard', p.warlockShard);
    if (p.warlockFragment) mk('Fragment', p.warlockFragment);
    minions.forEach((m) => mech.push({ label: 'Book of the Dead', key: m.key, name: m.name, icon: m.icon, html: m.html }));

    const rotations = (p.rotations || []).map((r) => ({
      name: r.name || 'Rotation',
      skills: (r.skills || []).map((x) => (x && x.skill ? { key: x.skill, name: gd.skillName(x.skill), icon: gd.skillIcon(x.skill) } : null)).filter(Boolean),
    }));
    const elixirs = (p.elixirs || []).filter(Boolean).map((k) => {
      const key = gd.itemKey(k);
      return { key, name: gd.itemName(key), image: gd.d.items?.[key]?.image || null };
    });

    return {
      index: vi,
      name: p.name || `Variant ${vi + 1}`,
      cls,
      className: gd.className(cls),
      level: p.level,
      worldTier: p.worldTier,
      gear,
      skillBar,
      skillTree: { key: treeKey, tree, steps: skillSteps, active: skillActive },
      paragon: { steps: paragonSteps, active: paragonActive },
      minions,
      mercenary,
      warPlans,
      seasonal,
      classMechanics: mech,
      notes: p.widgetNotes || {},
      rotations,
      elixirs,
      world: p.world || null,
      equipped,
      affixEquipped,
    };
  }

  function normaliseAlloc(a) {
    if (Array.isArray(a)) return Object.fromEntries(a.map((id) => [id, 1]));
    return a && typeof a === 'object' ? a : {};
  }
  D4.normaliseAlloc = normaliseAlloc;

  function buildSkillStep(gd, tree, data, name, affixEquipped) {
    data = normaliseAlloc(data);
    const byId = {};
    for (const n of tree?.nodes || []) byId[n.id] = n;
    const alloc = {};
    const mods = new Set();
    const entries = [];
    for (const [id, rank] of Object.entries(data)) {
      if (!(rank > 0)) continue;
      const node = byId[id];
      if (!node) continue;
      alloc[id] = rank;
      const info = gd.rewardInfo(node.rewardId);
      if (info.kind === 'mod') mods.add(info.mod);
      entries.push({ id: Number(id), rank, info, node });
    }
    // Group: active skills with their chosen modifiers, then passives
    const skills = [];
    const byPower = {};
    for (const e of entries.filter((x) => x.info.kind === 'skill')) {
      const s = { ...e, mods: [] };
      byPower[e.info.power] = s;
      skills.push(s);
    }
    const passives = [];
    for (const e of entries) {
      if (e.info.kind === 'mod') {
        const parent = byPower[e.info.power];
        if (parent) parent.mods.push(e);
        else skills.push({ ...e, mods: [] });
      } else if (e.info.kind !== 'skill') passives.push(e);
    }
    const sortY = (a, b) => a.node.pos.y - b.node.pos.y || a.node.pos.x - b.node.pos.x;
    skills.sort(sortY);
    passives.sort(sortY);
    const points = entries.reduce((s, e) => s + e.rank, 0);
    return { name: name || 'Skills', alloc, mods, skills, passives, points, ctx: { mods, affixEquipped } };
  }

  function neighbourOf(board, idx) {
    const r = D4.rotateIndex(idx, board.rotation || 0);
    const x = r % S;
    const y = Math.floor(r / S);
    const p = board.position || { x: 0, y: 0 };
    if (y === 0) return { x: p.x, y: p.y - 1 };
    if (y === S - 1) return { x: p.x, y: p.y + 1 };
    if (x === 0) return { x: p.x - 1, y: p.y };
    if (x === S - 1) return { x: p.x + 1, y: p.y };
    return null;
  }

  function buildParagonStep(gd, step, cls) {
    const list = Array.isArray(step.data) ? step.data : Array.isArray(step.data?.boards) ? step.data.boards : [];
    const boards = list.map((b, bi) => {
      const def = gd.d.paragonBoards?.[b.id] || { nodes: [] };
      const allocated = Object.keys(b.nodes || {}).filter((k) => b.nodes[k]).map(Number);
      const counts = { normal: 0, magic: 0, rare: 0, legendary: 0, gate: 0, socket: 0, start: 0 };
      const notable = [];
      for (const idx of allocated) {
        const key = def.nodes[idx];
        const n = gd.d.paragonNodes?.[key];
        if (!n) continue;
        const kind = n.socket ? 'socket' : n.gate ? 'gate' : n.start ? 'start' : ['normal', 'normal', 'magic', 'rare', 'legendary'][n.rarity] || 'normal';
        counts[kind]++;
        if (kind === 'rare' || kind === 'legendary') notable.push({ idx, key, kind, ...gd.describeParagonNode(key, { boardIndex: bi, cls }) });
      }
      return {
        index: bi,
        id: b.id,
        def,
        name: gd.paragonBoardName(b.id),
        rotation: b.rotation || 0,
        position: b.position || { x: 0, y: 0 },
        nodes: b.nodes || {},
        allocated,
        counts,
        notable,
        glyph: b.glyph || null,
        glyphLevel: b.glyphLevel || 0,
        glyphInfo: b.glyph ? gd.describeGlyph(b.glyph, b.glyphLevel || 1) : null,
      };
    });
    // Points: every allocated node, but a connected gate pair costs one point.
    let points = 0;
    boards.forEach((b, bi) => {
      for (const idx of b.allocated) {
        const n = gd.d.paragonNodes?.[b.def.nodes[idx]];
        if (n?.start) continue;
        if (n?.gate) {
          const nb = neighbourOf(b, idx);
          const j = nb ? boards.findIndex((o) => o.position.x === nb.x && o.position.y === nb.y) : -1;
          if (j >= 0 && j < bi) continue;
        }
        points++;
      }
    });
    return { name: (step.name || '').trim() || 'Paragon', boards, points };
  }

  D4.buildVariant = buildVariant;
  D4.paragonNeighbourOf = neighbourOf;
})(typeof globalThis !== 'undefined' ? globalThis : window);
