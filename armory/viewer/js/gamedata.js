/*
 * D4 Build Viewer - game data layer.
 *
 * Loads Maxroll's public Diablo IV game data (data.min.json + data.<locale>.json)
 * and turns the IDs stored in a planner profile into readable text:
 *   - affix nids  -> "+1,225 Maximum Life"
 *   - aspects / unique powers -> full description with the rolled values
 *   - skill tree reward ids -> skill / modifier / passive names and descriptions
 *   - paragon board cells -> node names, stats, glyph text
 *
 * Works in the browser (attaches to window.D4) and in Node (module.exports) so the
 * same code can be tested from the command line.
 */
(function (root) {
  'use strict';
  const D4 = (root.D4 = root.D4 || {});

  const ASSET_BASE = 'https://assets-ng.maxroll.gg/d4-tools';
  D4.ASSET_BASE = ASSET_BASE;
  D4.iconUrl = (id) => (id ? `${ASSET_BASE}/images/webp/${id >>> 0}.webp` : null);

  // ---------------------------------------------------------------- helpers
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  D4.esc = esc;

  /** Maxroll string hash (used for skill tags etc). Returns signed int32 like the site does. */
  function hashName(s) {
    s = String(s).toLowerCase();
    let t = 0;
    for (let i = 0; i < s.length; i++) t = (t * 33 + s.charCodeAt(i)) >>> 0;
    return t | 0;
  }
  D4.hashName = hashName;

  /** Localised names sometimes carry variants like "[ah]Foo[x]Bar" - take the first. */
  function cleanName(s) {
    if (!s) return '';
    s = String(s);
    if (s.startsWith('[')) {
      const m = s.match(/\[([a-z0-9]+)\]([^[]+)/);
      if (m) return m[2].trim();
    }
    return s.trim();
  }
  D4.cleanName = cleanName;

  const humanize = (s) =>
    String(s)
      .replace(/^(S\d+_|X\d+_)/, '')
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  D4.humanize = humanize;

  function htmlToText(html) {
    return String(html)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&bull;/g, '\u2022')
      .replace(/&rarr;/g, '\u2192')
      .replace(/&mdash;/g, '\u2014')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
  }
  D4.htmlToText = htmlToText;

  // ------------------------------------------------------- number formatting
  function formatNumber(v, fmt) {
    fmt = fmt || '';
    if (typeof v !== 'number' || !isFinite(v)) return '#';
    const m = fmt.match(/\d+/);
    const decimals = m ? parseInt(m[0], 10) : 0;
    const trim = fmt.includes('?');
    const abs = Math.abs(v);
    let s = abs.toLocaleString('en-US', {
      minimumFractionDigits: trim ? 0 : decimals,
      maximumFractionDigits: decimals,
    });
    if (v < 0 && s !== '0') s = '-' + s;
    if (fmt.includes('%')) s += '%';
    if (fmt.includes('~') && v > 0) s = '+' + s;
    if (fmt.includes('x')) s += '[x]';
    else if (fmt.includes('+')) s += '[+]';
    return s;
  }
  D4.formatNumber = formatNumber;

  // ---------------------------------------------------- expression evaluator
  // Tiny, safe evaluator for the arithmetic/ternary expressions used in tooltips.
  // Unknown identifiers/functions evaluate to 0 and flag the result as unknown.
  const TOKEN_RE = /\s*(\d+\.\d+|\d+\.?|\.\d+|[A-Za-z_][A-Za-z0-9_.]*|==|!=|<=|>=|&&|\|\||[-+*/%<>!?:(),])/y;
  const PREC = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };

  function evaluate(expr, env) {
    const toks = [];
    TOKEN_RE.lastIndex = 0;
    let m;
    const src = String(expr);
    while (TOKEN_RE.lastIndex < src.length && (m = TOKEN_RE.exec(src))) toks.push(m[1]);
    if (TOKEN_RE.lastIndex < src.trimEnd().length) {
      env.unknown = true;
      return 0;
    }
    let i = 0;
    const peek = () => toks[i];
    const next = () => toks[i++];

    function primary() {
      const t = next();
      if (t === undefined) {
        env.unknown = true;
        return 0;
      }
      if (t === '(') {
        const v = ternary();
        if (peek() === ')') next();
        return v;
      }
      if (t === '-') return -primary();
      if (t === '+') return +primary();
      if (t === '!') return primary() ? 0 : 1;
      if (/^[\d.]/.test(t)) return parseFloat(t);
      if (peek() === '(') {
        next();
        const args = [];
        if (peek() !== ')') {
          args.push(ternary());
          while (peek() === ',') {
            next();
            args.push(ternary());
          }
        }
        if (peek() === ')') next();
        return env.call(t, args);
      }
      return env.ident(t);
    }
    function binary(minPrec) {
      let left = primary();
      for (;;) {
        const op = peek();
        const p = PREC[op];
        if (!p || p < minPrec) return left;
        next();
        const right = binary(p + 1);
        switch (op) {
          case '+': left = left + right; break;
          case '-': left = left - right; break;
          case '*': left = left * right; break;
          case '/': left = right ? left / right : 0; break;
          case '%': left = right ? left % right : 0; break;
          case '<': left = +(left < right); break;
          case '>': left = +(left > right); break;
          case '<=': left = +(left <= right); break;
          case '>=': left = +(left >= right); break;
          case '==': left = +(left === right); break;
          case '!=': left = +(left !== right); break;
          case '&&': left = left && right ? 1 : 0; break;
          case '||': left = left || right ? 1 : 0; break;
        }
      }
    }
    function ternary() {
      const c = binary(1);
      if (peek() === '?') {
        next();
        const a = ternary();
        if (peek() === ':') next();
        const b = ternary();
        return c ? a : b;
      }
      return c;
    }
    const v = ternary();
    return typeof v === 'number' && isFinite(v) ? v : 0;
  }
  D4.evaluate = evaluate;

  const BUILTINS = {
    min: (a) => Math.min(...a),
    max: (a) => Math.max(...a),
    floor: (a) => Math.floor(a[0]),
    ceil: (a) => Math.ceil(a[0]),
    round: (a) => Math.round(a[0]),
    abs: (a) => Math.abs(a[0]),
    pow: (a) => Math.pow(a[0], a[1]),
    sqrt: (a) => Math.sqrt(a[0]),
  };

  /** Build an evaluation env from a context: { vars, mods:Set, affixEquipped:fn, ident:fn, call:fn } */
  function makeEnv(ctx, placeholders) {
    const vars = ctx.vars || {};
    const lower = {};
    for (const k of Object.keys(vars)) lower[k.toLowerCase()] = vars[k];
    const env = {
      unknown: false,
      ident(name) {
        if (placeholders && name in placeholders) {
          const v = lookupVar(placeholders[name]);
          if (v === undefined) {
            env.unknown = true;
            return 0;
          }
          return typeof v === 'number' ? v : parseFloat(v) || 0;
        }
        if (name === 'ADVANCED_TOOLTIP') return 1;
        const v = lookupVar(name);
        if (v !== undefined) return typeof v === 'number' ? v : parseFloat(v) || 0;
        if (ctx.ident) {
          const r = ctx.ident(name);
          if (r !== undefined) return r;
        }
        env.unknown = true;
        return 0;
      },
      call(name, args) {
        const b = BUILTINS[name.toLowerCase()];
        if (b) return b(args);
        if (name === 'Mod') return ctx.mods && ctx.mods.has(args[0]) ? 1 : 0;
        const asVar = lookupVar(name);
        if (asVar !== undefined) return typeof asVar === 'number' ? asVar : parseFloat(asVar) || 0;
        if (name === 'AffixIsEquipped') return ctx.affixEquipped && ctx.affixEquipped(args[0]) ? 1 : 0;
        if (ctx.call) {
          const r = ctx.call(name, args);
          if (r !== undefined) return r;
        }
        env.unknown = true;
        return 0;
      },
    };
    function lookupVar(name) {
      if (name in vars) return vars[name];
      const l = name.toLowerCase();
      if (l in lower) return lower[l];
      return undefined;
    }
    env.lookupVar = lookupVar;
    return env;
  }

  // --------------------------------------------------------- text templates
  const COLOR_CLASS = {
    c_number: 'v-num',
    c_random: 'v-num',
    c_resource: 'v-res',
    c_important: 'v-imp',
    c_label: 'v-label',
    c_lightgray: 'v-dim',
    c_gray: 'v-dim',
    c_inactive: 'v-dim',
    c_white: 'v-white',
    c_legendary: 'v-leg',
    c_unique: 'v-uniq',
    c_gold: 'v-leg',
    c_yellow: 'v-leg',
    c_red: 'v-red',
    c_green: 'v-green',
    c_blue: 'v-blue',
  };
  const SPLIT_RE = /(\\.|\{[^{}]*\}|\[[^[\]]*\]|\r?\n)/;

  /**
   * Render a Blizzard/Maxroll tooltip template to HTML.
   *   {c_xxx}..{/c}    colour spans      {if:expr}..{else}..{/if}  conditionals
   *   [expr|fmt|]      computed numbers  {value1}                 string placeholders
   */
  function renderText(str, ctx = {}) {
    if (!str) return '';
    const parts = String(str).replace(/\{\/c\]/g, '{/c}').split(SPLIT_RE);
    const colors = [];
    const style = { u: 0, b: 0, i: 0 };
    const ifs = []; // {parent, taken, active}
    let active = true;
    let out = '';
    let lastClass = null;
    let buf = '';

    const curClass = () => {
      const c = [];
      if (colors.length) c.push(colors[colors.length - 1]);
      if (style.u) c.push('u');
      if (style.b) c.push('b');
      if (style.i) c.push('i');
      return c.join(' ');
    };
    const flush = () => {
      if (!buf) return;
      out += lastClass ? `<span class="${lastClass}">${buf}</span>` : buf;
      buf = '';
    };
    const emit = (html) => {
      if (!active || html === '') return;
      const c = curClass();
      if (c !== lastClass) {
        flush();
        lastClass = c;
      }
      buf += html;
    };
    const emitBreak = () => {
      if (!active) return;
      flush();
      out += '<br>';
    };

    for (const part of parts) {
      if (!part) continue;
      if (part === '\n' || part === '\r\n') {
        emitBreak();
        continue;
      }
      if (part[0] === '\\') {
        emit(esc(part.substring(1)));
        continue;
      }
      if (part[0] === '{' && part[part.length - 1] === '}') {
        const inner = part.slice(1, -1).trim();
        if (inner.startsWith('if:')) {
          const env = makeEnv(ctx);
          const v = evaluate(inner.substring(3), env);
          const cond = !!v && !env.unknown;
          ifs.push({ parent: active, taken: cond });
          active = active && cond;
        } else if (inner === 'else' || inner.startsWith('else')) {
          const top = ifs[ifs.length - 1];
          if (top) {
            let cond = !top.taken;
            const m = inner.match(/^else\s*if:(.*)$/);
            if (m && cond) {
              const env = makeEnv(ctx);
              cond = !!evaluate(m[1], env) && !env.unknown;
            }
            active = top.parent && cond;
            if (cond) top.taken = true;
          }
        } else if (inner === '/if') {
          const top = ifs.pop();
          active = top ? top.parent : true;
        } else if (/^c_/i.test(inner)) {
          colors.push(COLOR_CLASS[inner.toLowerCase()] || (/rune/i.test(inner) ? 'v-rune' : 'v-other'));
        } else if (/^\/c/i.test(inner)) {
          colors.pop();
        } else if (inner === 'u' || inner === 'b' || inner === 'i') {
          style[inner]++;
        } else if (inner === '/u' || inner === '/b' || inner === '/i') {
          style[inner[1]] = Math.max(0, style[inner[1]] - 1);
        } else if (inner.startsWith('icon:')) {
          const name = inner.substring(5).split(',')[0].trim();
          emit(name === 'arrow' ? '&rarr;' : '&bull;');
        } else {
          const env = makeEnv(ctx);
          const v = env.lookupVar(inner);
          if (v !== undefined) emit(esc(typeof v === 'number' ? formatNumber(v, '2?') : v));
        }
        continue;
      }
      if (part[0] === '[' && part[part.length - 1] === ']') {
        const body = part.slice(1, -1);
        if (/^ph$/i.test(body)) continue;
        const pipe = body.indexOf('|');
        let expr = pipe >= 0 ? body.substring(0, pipe) : body;
        const fmt = pipe >= 0 ? body.substring(pipe + 1).replace(/\|$/, '') : '';
        const placeholders = {};
        let n = 0;
        expr = expr.replace(/\{([^{}]+)\}/g, (_, name) => {
          const id = `__v${n++}`;
          placeholders[id] = name.trim();
          return id;
        });
        const env = makeEnv(ctx, placeholders);
        const v = evaluate(expr, env);
        if (env.unknown) {
          if (pipe < 0 && !/[{(]/.test(body)) emit(esc(part));
          else emit('<span class="v-unk" title="Value depends on character stats">#</span>');
        } else {
          emit(esc(formatNumber(v, fmt)).replace(/\[(x|\+)\]$/, '<span class="v-tag">[$1]</span>'));
        }
        continue;
      }
      emit(esc(part));
    }
    flush();
    // Plural forms: "3 |4second:seconds;" -> "3 seconds"
    out = out.replace(/(\d[\d,.]*)((?:<[^>]*>|\s)*)\|4([^:;<]*):([^;<]*);/g, (_, n, gap, one, many) =>
      n + gap + (parseFloat(n.replace(/,/g, '')) === 1 ? one : many)
    );
    out = out.replace(/\|4([^:;<]*):([^;<]*);/g, '$2');
    return out.replace(/^(<br>)+|(<br>)+$/g, '');
  }
  D4.renderText = renderText;

  // ----------------------------------------------------------- enums / maps
  const SLOT_NAMES = {
    4: 'Helm',
    5: 'Chest',
    6: 'Off-Hand',
    7: 'Weapon',
    8: 'Bludgeoning Weapon',
    9: 'Slashing Weapon',
    10: 'Ranged Weapon',
    11: 'Dual-Wield Main',
    12: 'Dual-Wield Off',
    13: 'Gloves',
    14: 'Pants',
    15: 'Boots',
    16: 'Ring 1',
    17: 'Ring 2',
    18: 'Amulet',
    20: 'Horadric Seal',
    21: 'Charm 1',
    22: 'Charm 2',
    23: 'Charm 3',
    24: 'Charm 4',
    25: 'Charm 5',
    26: 'Charm 6',
  };
  D4.SLOT_NAMES = SLOT_NAMES;
  D4.GEAR_SLOTS = [4, 5, 13, 14, 15, 18, 16, 17, 7, 6, 8, 9, 10, 11, 12];
  D4.TALISMAN_SLOTS = [20, 21, 22, 23, 24, 25, 26];
  const RARITY = ['Rare', 'Legendary', 'Unique', 'Set', 'Mythic'];
  D4.RARITY = RARITY;

  const PT = {
    DamageType: 0, DOTType: 1, Power: 5, Resource: 7, Affix: 16, CCType: 19, CCTargetType: 20, Item: 22,
    ItemRequirement: 24, ParagonNode: 28, NecroArmyType: 29, ShapeshiftForm: 30, ParagonGlyphAffix: 32,
    SkillTag: 33, Currency: 35, CollectiblePower: 36, PetType: 38,
  };

  // Reinforcement triggers (hard-coded in Maxroll's planner, not part of the game data files)
  const MERCENARY_TRIGGERS = {
    trigger_skill: { name: 'Skill Cast', text: 'Cast when the player casts any skill in combat.', icon: 3062347201 },
    trigger_injured: { name: 'Injured', text: 'Cast when the player becomes {c_important}{u}Injured{/u}{/c}.', icon: 3015758820 },
    trigger_cc: { name: 'Control Impaired', text: 'Cast when the player is hit with a Control Impairing Effect.', icon: 3760871682 },
  };
  D4.MERCENARY_TRIGGERS = MERCENARY_TRIGGERS;

  const PARAGON_SIZE = 21;
  D4.PARAGON_SIZE = PARAGON_SIZE;
  /** Rotate a board cell index clockwise by `rot` quarter turns (same as the planner). */
  function rotateIndex(idx, rot) {
    const S = PARAGON_SIZE;
    const x = idx % S;
    const y = Math.floor(idx / S);
    switch (rot & 3) {
      case 1: return x * S + (S - 1 - y);
      case 2: return S * S - 1 - idx;
      case 3: return (S - 1 - x) * S + y;
      default: return idx;
    }
  }
  D4.rotateIndex = rotateIndex;

  // -------------------------------------------------------------- GameData
  class GameData {
    constructor(min, text) {
      this.d = min;
      this.t = text;
      this.version = min.version;
      const idx = (obj) => {
        const r = {};
        for (const [k, v] of Object.entries(obj || {})) if (v && v.id != null) r[v.id] = k;
        return r;
      };
      this.affixFromId = idx(min.affixes);
      this.itemFromId = idx(min.items);
      this.skillFromId = idx(min.skills);
      this.paragonNodeFromId = idx(min.paragonNodes);
      this.paragonGlyphAffixFromId = idx(min.paragonGlyphAffixes);
      this.stoneFromId = idx(min.stones);
      for (const v of Object.values(min.remap?.item || {})) this.itemFromId[v.id] = v.newId;
      for (const v of Object.values(min.remap?.skill || {})) this.skillFromId[v.id] = v.newId;
      this.skillTagFromId = {};
      for (const k of Object.keys(min.skillTags || {})) this.skillTagFromId[hashName(k)] = k;
    }

    // ----- generic lookups
    className(cls) {
      return this.t.classes?.[cls]?.nameMale || this.d.classes?.[cls]?.name || `Class ${cls}`;
    }
    classTreeKey(cls) {
      const c = this.d.classes?.[cls];
      return c?.tree || c?.name;
    }
    itemKey(id) {
      if (id == null) return null;
      if (this.d.items[id]) return id;
      const r = this.d.remap?.item?.[id];
      if (r && this.d.items[r.newId]) return r.newId;
      if (this.itemFromId[id]) return this.itemFromId[id];
      return id;
    }
    itemName(key) {
      return cleanName(this.t.items?.[key]?.name) || humanize(key);
    }
    itemTypeName(type) {
      return this.t.itemTypes?.[type]?.name || humanize(type || '');
    }
    itemImage(key, cls) {
      const it = this.d.items[key];
      if (!it) return null;
      const im = it.images?.[cls];
      return (im && (im.male || im.female)) || it.image || it.images?.find((x) => x && (x.male || x.female))?.male || null;
    }
    skillName(key) {
      return cleanName(this.t.skills?.[key]?.name) || humanize(key || '');
    }
    skillIcon(key) {
      const s = this.d.skills?.[key];
      return s?.icons?.find((x) => x) || null;
    }
    attrName(id) {
      return this.d.attributes?.[id]?.name || `Attribute_${id}`;
    }
    skillTagName(key) {
      return this.t.skillTags?.[key]?.name || humanize(String(key).replace(/^(Skill_|Keyword_|Search_)/, ''));
    }

    paramKey(type, param) {
      const u = this.t.uiStrings || {};
      switch (type) {
        case PT.Power: return this.skillFromId[param];
        case PT.SkillTag: return this.skillTagFromId[param];
        case PT.Affix: return this.affixFromId[param];
        case PT.Item: return this.itemFromId[param];
        case PT.ParagonNode: return this.paragonNodeFromId[param];
        case PT.ParagonGlyphAffix: return this.paragonGlyphAffixFromId[param];
        case PT.CollectiblePower: return this.stoneFromId[param];
        case PT.ItemRequirement: return this.d.itemRequirements?.[param]?.id;
        case PT.Resource: return u.resourceType?.[param];
        case PT.DamageType: return u.damageType?.[param];
        case PT.DOTType: return u.dotDamage?.[param];
        case PT.CCType:
        case PT.CCTargetType: return u.ccType?.[param];
        case PT.PetType: return this.d.petTypes?.[param];
        default: return undefined;
      }
    }

    paramLabel(type, param) {
      const u = this.t.uiStrings || {};
      switch (type) {
        case PT.Power: return this.skillName(this.skillFromId[param]);
        case PT.Resource: return u.resourceType?.[param];
        case PT.CCType: return u.ccType?.[param];
        case PT.CCTargetType: return u.ccTarget?.[param];
        case PT.ItemRequirement: return this.t.itemRequirements?.[param]?.name;
        case PT.NecroArmyType: return u.necroarmyUnittype?.[param];
        case PT.ShapeshiftForm: return u.shapeshiftForm?.[param];
        case PT.SkillTag: {
          const k = this.skillTagFromId[param];
          return k ? this.skillTagName(k) : undefined;
        }
        case PT.Currency: return 'Obols';
        case PT.Item: return this.itemName(this.itemFromId[param]);
        case PT.PetType: return u.petType?.[param];
        case PT.DamageType: return u.damageType?.[param];
        case PT.DOTType: return u.dotDamage?.[param] ?? u.damageType?.[param];
        default: return undefined;
      }
    }

    attrDescription(name, pk) {
      const ad = this.t.attributeDescriptions || {};
      if (!this._adLower) {
        this._adLower = {};
        for (const k of Object.keys(ad)) this._adLower[k.toLowerCase()] = ad[k];
      }
      const L = this._adLower;
      return (pk != null && (ad[`${name}#${pk}`] || L[`${name}#${pk}`.toLowerCase()])) || ad[name] || L[String(name).toLowerCase()];
    }

    /** One attribute line, e.g. "+1,225 Maximum Life". Returns HTML. */
    renderAttribute(id, param, value, extraCtx) {
      const attr = this.d.attributes?.[id] || { name: `Attribute_${id}` };
      let desc;
      let vars;
      if (param != null && attr.paramType != null) {
        desc = this.attrDescription(attr.name, this.paramKey(attr.paramType, param));
        const label = this.paramLabel(attr.paramType, param);
        vars = { value1: label ?? 'unknown', value2: value, value };
      } else {
        desc = this.attrDescription(attr.name);
        vars = { value, value1: value, value2: value };
      }
      if (!desc) return `${esc(humanize(attr.name))}: <span class="v-num">${esc(formatNumber(value, '2?'))}</span>`;
      return renderText(desc, { ...extraCtx, vars });
    }

    // ----- affixes
    affixKey(nid) {
      return this.affixFromId[nid] || (this.d.affixes[nid] ? nid : null);
    }

    /** Render a profile affix entry {nid, values, greater, upgrade}. */
    renderAffix(ex, extraCtx = {}) {
      const key = this.affixKey(ex.nid);
      const a = key && this.d.affixes[key];
      if (!a) return { key, html: `Unknown affix ${esc(ex.nid)}`, text: `Unknown affix ${ex.nid}` };
      const ta = this.t.affixes?.[key] || {};
      const vals = ex.values || [];
      let html;
      if (ta.desc) {
        const vars = {};
        (a.attributes || []).forEach((at, i) => {
          if (vals[i] != null) vars[this.attrName(at.id)] = vals[i];
        });
        if (vals.length) vars.value = vals[0];
        html = renderText(ta.desc, { ...extraCtx, vars });
      } else {
        html = (a.attributes || [])
          .map((at, i) => this.renderAttribute(at.id, at.param, vals[i] ?? 0, extraCtx))
          .join('<br>');
      }
      return {
        key,
        html,
        text: htmlToText(html),
        isPower: !!ta.desc,
        name: cleanName(ta.name) || null,
        magicType: a.magicType,
        icon: a.icon || null,
        aspectName: ta.prefix || ta.suffix ? `Aspect ${ta.suffix || ta.prefix}`.replace(/^Aspect of /, 'Aspect of ') : null,
      };
    }

    /** Resolve an item in a profile's item store into display-ready data. */
    describeItem(pi, cls, extraCtx = {}) {
      const key = this.itemKey(pi.id);
      const base = this.d.items[key] || {};
      const rarity = RARITY[base.magicType] ?? 'Rare';
      const name = pi.name || this.itemName(key);
      const out = {
        key,
        name,
        rarity,
        type: this.itemTypeName(base.type),
        power: pi.power,
        upgrade: pi.upgrade || 0,
        image: this.itemImage(key, cls),
        implicits: [],
        explicits: [],
        tempered: [],
        aspects: [],
        sockets: [],
        uniquePower: null,
        setName: null,
      };
      for (const ex of pi.implicits || []) out.implicits.push({ ...this.renderAffix(ex, extraCtx), greater: !!ex.greater });
      const explicits = [...(pi.explicits || [])];
      if (explicits.every((e) => e.uniquePriority != null)) explicits.sort((a, b) => a.uniquePriority - b.uniquePriority);
      for (const ex of explicits) {
        const r = {
          ...this.renderAffix(ex, extraCtx),
          greater: !!ex.greater,
          masterwork: ex.upgrade > 0,
          masterworkPriority: ex.upgradePriority ?? null,
          hidden: !!ex.hidden,
        };
        if (r.isPower && (r.magicType === 2 || r.magicType === 4 || r.key === key)) out.uniquePower = r;
        else out.explicits.push(r);
      }
      for (const ex of pi.tempered || []) {
        const r = { ...this.renderAffix(ex, extraCtx), masterwork: ex.upgrade > 0, masterworkPriority: ex.upgradePriority ?? null };
        out.tempered.push(r);
      }
      for (const ex of pi.aspects || []) {
        const r = this.renderAffix(ex, extraCtx);
        const ta = this.t.affixes?.[r.key] || {};
        r.aspectName = ta.suffix ? `Aspect ${ta.suffix}` : ta.prefix ? `${ta.prefix} Aspect` : r.aspectName;
        out.aspects.push(r);
      }
      const slotKind = extraCtx.slotKind ?? (['Ring', 'Amulet'].includes(base.type) ? 2 : /Weapon|Sword|Axe|Mace|Scythe|Bow|Crossbow|Dagger|Staff|Wand|Polearm|Glaive|Quarterstaff|Flail/i.test(base.type || '') ? 0 : 1);
      for (const s of pi.sockets || []) if (s) out.sockets.push(this.describeSocketable(s, slotKind));
      if (base.set || pi.set) out.setName = this.t.itemSets?.[base.set || pi.set]?.name || null;
      return out;
    }

    /**
     * Gems, runes and soul splinters. slotKind: 0 weapon, 1 armor, 2 jewelry
     * (gems have a different effect in each).
     */
    describeSocketable(key, slotKind) {
      const k = this.itemKey(key);
      const it = this.d.items[k] || {};
      const ti = this.t.items?.[k] || {};
      const lines = [];
      if (it.rune) {
        if (ti.rune?.desc) lines.push(renderText(ti.rune.desc, { vars: { s1: it.rune.dynamicValue } }));
      } else {
        if (ti.desc) lines.push(renderText(ti.desc, {}));
        const effs = it.socketedEffects || [];
        let ei = effs.findIndex((e) => e.type === slotKind);
        if (ei < 0 && effs.length === 1) ei = 0;
        const eff = effs[ei];
        const label = ti.socketedEffects?.[ei]?.label;
        if (eff && label) {
          const a = eff.attributes || [];
          const vars = { value: a[0]?.value, value1: a[0]?.value, value2: a[1]?.value ?? a[0]?.value };
          lines.push(renderText(label, { vars }));
        }
      }
      const html = lines.join('<br>');
      return {
        key: k,
        name: this.itemName(k),
        kind: it.rune ? (it.type === 'ConditionRune' ? 'Condition Rune' : 'Effect Rune') : this.itemTypeName(it.type),
        image: it.image || null,
        html,
        text: htmlToText(html),
      };
    }

    /** Short tooltip for an item referenced only by id (used for guide text embeds). */
    describeItemRef(id, cls) {
      const key = this.itemKey(id);
      const base = this.d.items[key];
      if (!base) return null;
      const out = {
        key,
        name: this.itemName(key),
        rarity: RARITY[base.magicType] ?? 'Rare',
        type: this.itemTypeName(base.type),
        image: this.itemImage(key, cls),
        powerHtml: '',
      };
      for (const ak of base.explicits || []) {
        const ta = this.t.affixes?.[ak];
        if (ta?.desc) {
          out.powerHtml = renderText(ta.desc, {});
          break;
        }
      }
      if (base.rune) {
        const ti = this.t.items?.[key];
        if (ti?.rune?.desc) out.powerHtml = renderText(ti.rune.desc, {});
      }
      return out;
    }

    // ----- skills
    rewardInfo(rewardId) {
      const r = this.d.skillTreeRewards?.[rewardId];
      if (!r) return { kind: 'unknown', name: humanize(rewardId || '?'), maxRank: 1 };
      const power = r.power;
      const s = this.d.skills?.[power] || {};
      const ts = this.t.skills?.[power] || {};
      if (r.type === 1) {
        const mi = (s.mods || []).findIndex((m) => m.id === r.mod);
        const mod = s.mods?.[mi];
        const tm = ts.mods?.[mi] || {};
        return {
          kind: 'mod',
          power,
          mod: r.mod,
          name: cleanName(tm.name) || humanize(rewardId),
          parentName: this.skillName(power),
          desc: tm.desc || '',
          icon: mod?.icons?.find((x) => x) || this.skillIcon(power),
          maxRank: r.ranks || 1,
        };
      }
      return {
        kind: r.type === 0 ? 'skill' : 'passive',
        power,
        name: this.skillName(power),
        desc: ts.desc || '',
        icon: this.skillIcon(power),
        category: s.category,
        maxRank: r.ranks || 1,
        tags: s.tags || [],
      };
    }

    skillCategoryName(cat) {
      const arr = this.t.skillCategories?.[0] || this.t.skillCategories?.['0'];
      return Array.isArray(arr) ? arr[cat] : undefined;
    }

    // ----- seasonal powers (Prime Evil, witch, boss, chaos, horadric, divine gifts)
    describeStone(entry) {
      const id = typeof entry === 'string' ? entry : entry?.id;
      if (!id) return null;
      const level = typeof entry === 'object' ? entry.level || 1 : 1;
      const st = this.d.stones?.[id];
      const ts = this.t.stones?.[id] || {};
      const levelFn = () => level;
      const ctx = {
        call: (name) => (/^GetCollectiblePower(Level|Rank)$/.test(name) ? level : name === 'GetCollectiblePowerEquippedSlotIndex' ? 0 : undefined),
        ident: (name) => (/level/i.test(name) ? levelFn() : undefined),
      };
      const category = st?.category || '';
      const seasonal = this.t.uiStrings?.seasonal || {};
      const kind = category.startsWith('S15_Triad')
        ? category === 'S15_Triad_Power' ? 'Prime Evil Power' : 'Prime Evil Upgrade'
        : category.startsWith('S7_Witch') ? 'Witch Power'
        : category.startsWith('S8_Boss') ? 'Boss Power'
        : category.startsWith('S9_Horadric') ? 'Horadric ' + category.replace('S9_Horadric_', '')
        : category.startsWith('S10_Chaotic') ? 'Chaos Perk'
        : category.startsWith('S11_') ? (seasonal.DivineGift ? D4.htmlToText(renderText(seasonal.DivineGift, {})) : 'Divine Gift')
        : category === 'DummyS3' ? 'Construct Stone' : humanize(category);
      const season = (category.match(/^S(\d+)/) || [])[1] || null;
      return {
        id,
        level,
        name: cleanName(ts.name) || humanize(id),
        kind,
        category,
        season,
        icon: st?.icon || null,
        html: ts.desc ? renderText(ts.desc, ctx) : '',
        source: ts.source || null,
      };
    }

    describeVampiricPower(id) {
      const key = this.d.vampiricPowerMap?.[id] || id;
      const v = this.d.vampiricPowers?.[key];
      if (!v) return null;
      return { id: key, name: cleanName(v.name), kind: 'Vampiric Power', icon: v.icons?.[0], html: renderText(v.desc || '', {}) };
    }

    /** Names for class mechanic choices (oaths, enchantments, boons...). */
    mechanicName(key) {
      if (!key) return '';
      const t = this.t.skills?.[key]?.name;
      if (t) return cleanName(t);
      const s = this.d.skills?.[key];
      if (/_Enchantment_/.test(key)) {
        const base = Object.keys(this.d.skills || {}).find((k) => this.d.skills[k]?.enchantment === key);
        if (base) return `${this.skillName(base)} Enchantment`;
      }
      let m = key.match(/_Oath_(.+)$/);
      if (m) return `Oath: ${humanize(m[1])}`;
      m = key.match(/^spiritborn_([a-z]+)_([a-z]+)_passive$/i);
      if (m) return `${humanize(m[1]).replace(/^\w/, (c) => c.toUpperCase())} (${m[2]})`;
      return s ? humanize(key.replace(/^[A-Za-z]+_/, '')) : humanize(key);
    }
    mechanicHtml(key, ctx = {}) {
      const d = this.t.skills?.[key]?.desc;
      return d ? renderText(d, ctx) : '';
    }

    // ----- paragon
    paragonBoardName(id) {
      return cleanName(this.t.paragonBoards?.[id]?.name) || humanize(id);
    }
    glyphName(id) {
      return cleanName(this.t.paragonGlyphs?.[id]?.name) || humanize(id || '');
    }

    attributeFormulaValue(formula, env) {
      const f = this.d.attributeFormulas?.[formula];
      if (!f || !f.length) return undefined;
      const e = makeEnv(env || {});
      const v = evaluate(f[0].formula, e);
      return e.unknown ? undefined : v;
    }

    /** Returns {name, rarity, kind, html} for a paragon board cell. */
    describeParagonNode(nodeKey, opts = {}) {
      const n = this.d.paragonNodes?.[nodeKey];
      if (!n) return { name: humanize(nodeKey || ''), rarity: 0, kind: 'normal', html: '' };
      const tn = this.t.paragonNodes?.[nodeKey] || {};
      const kind = n.socket ? 'socket' : n.gate ? 'gate' : n.start ? 'start' : ['normal', 'normal', 'magic', 'rare', 'legendary'][n.rarity] || 'normal';
      const lines = [];
      if (n.power) {
        const d = this.t.skills?.[n.power]?.desc;
        if (d) lines.push(renderText(d, {}));
      }
      const attrs = (n.attributes || []).map((a) => {
        const v = a.value != null ? evaluate(a.value, makeEnv({})) : this.attributeFormulaValue(a.formula);
        return { a, v: v ?? 0 };
      });
      for (const { a, v } of attrs) lines.push(this.renderAttribute(a.id, a.param, v));
      const ths = (n.thresholds || []).filter((th) => {
        const cf = this.d.paragonThresholds?.[th]?.classFilter;
        return opts.cls == null || !cf || cf[opts.cls];
      });
      if (ths.length && (n.thresholdAttributes || []).length) {
        const bonus = n.thresholdAttributes.map((i) => attrs[i]).filter(Boolean)
          .map(({ a, v }) => this.renderAttribute(a.id, a.param, v)).join(', ');
        const reqs = ths.map((th) => {
          const req = this.d.paragonThresholds[th]?.attributes?.[0];
          const label = th
            .replace(/^(Sorc|Rogue|Barb|Necro|Druid|Spiritborn|Paladin|Warlock)_/, '')
            .replace(/(Side|Main)\d*$/, '')
            .replace(/willpower/i, 'Willpower')
            .replace('+', ' + ');
          const r = req ? evaluate(req.value, makeEnv({ vars: { ParagonBoardEquipIndex: opts.boardIndex || 0 } })) : null;
          return `${r != null ? formatNumber(r) + ' ' : ''}${label}`;
        });
        lines.push(`<span class="v-label">Bonus:</span> ${bonus} <span class="v-dim">(requires ${esc(reqs.join(' or '))})</span>`);
      }
      let name = cleanName(tn.name);
      if (!name) {
        const first = lines[0] ? htmlToText(lines[0]) : '';
        name = kind === 'socket' ? 'Glyph Socket' : kind === 'gate' ? 'Board Attachment Gate' : first || humanize(nodeKey);
      }
      return { name, rarity: n.rarity, kind, html: lines.join('<br>') };
    }

    /** Glyph tooltip at a given level. */
    describeGlyph(glyphId, level) {
      const g = this.d.paragonGlyphs?.[glyphId];
      if (!g) return { name: humanize(glyphId || ''), html: '' };
      const lines = [];
      for (const ak of g.affixes || []) {
        const a = this.d.paragonGlyphAffixes?.[ak];
        const ta = this.t.paragonGlyphAffixes?.[ak] || {};
        if (!a) continue;
        if (a.power) {
          const d = this.t.skills?.[a.power]?.desc;
          if (d) lines.push(`${renderText(this.t.uiStrings?.global?.ThresholdGlyphBonus || 'Additional Bonus:', {})} ${renderText(d, {})}`);
          continue;
        }
        if (!ta.desc) continue;
        const fv = a.formula ? this.attributeFormulaValue(a.formula) ?? 1 : 1;
        const scalar = fv * ((a.base || 0) + (a.perLevel || 0) * ((level || 1) - 1)) * (a.displayFactor || 1);
        const legendary = (a.requiredRank || 0) >= 2;
        const text = renderText(ta.desc, { vars: { GlyphAffixScalar: scalar } });
        lines.push(
          legendary
            ? `${renderText(this.t.uiStrings?.global?.LegendaryGlyphBonus || 'Legendary Bonus:', {})} <span class="${level >= 46 ? '' : 'v-dim'}">${text}</span>`
            : text
        );
      }
      return { name: this.glyphName(glyphId), html: lines.join('<br>'), icon: g.icon?.find((x) => x) };
    }
  }
  D4.GameData = GameData;

  if (typeof module !== 'undefined' && module.exports) module.exports = D4;
})(typeof globalThis !== 'undefined' ? globalThis : window);
