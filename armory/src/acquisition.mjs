// Per-slot acquisition: how to get the guide's item for this slot, whether the equipped item already is
// it, and what changes in the next variant (a different item, or an advanced version of the same one).
// Facts come from the item catalog (game data) and the imported guide target; nothing is invented.

const lower=s=>String(s||'').trim().toLowerCase();
const plural=(n,w)=>n+' '+w+(n===1?'':/(x|s|ch|sh)$/.test(w)?'es':'s');

/** Find the catalog entry for a build target (by game item id, then by name and slot). */
export function catalogEntry(catalog,target,classIndex=null){
  if(!catalog||!target)return null;
  const items=catalog.items||[];
  if(target.itemId){
    const hit=items.find(i=>i.key===target.itemId||(i.aliases||[]).includes(target.itemId));
    if(hit)return hit;
  }
  const byName=items.filter(i=>lower(i.name)===lower(target.name));
  if(!byName.length)return null;
  const forClass=classIndex==null?byName:byName.filter(i=>i.cls&(1<<classIndex));
  return (forClass.find(i=>i.slot===target.slot)||forClass.find(i=>i.typeName!=='Charm')||forClass[0]||byName[0]);
}

const targetRarity=(t,entry)=>entry?.rarity||(t?.rarity&&t.rarity!=='Unknown'?t.rarity:t?.identityRequired?'Unique':t?.aspect?'Legendary':null);
const gaCount=t=>(t?.greaterAffixTargets?.length||t?.greaterAffixPriority?.length||(t?.affixes||[]).filter(a=>a.greaterAffix).length||0);
const tempersOf=t=>(t?.tempers?.length?t.tempers.map(x=>x.name):t?.temper?String(t.temper).split('/').map(s=>s.trim()):[]).filter(Boolean);
const socketsOf=t=>(t?.sockets||[]).map(s=>s.name).filter(Boolean);

/** How to obtain a target item. Returns [{label, text}] lines. */
export function howToGet(target,{catalog,classIndex=null,codex=[]}={}){
  const lines=[];if(!target)return lines;
  const entry=catalogEntry(catalog,target,classIndex),rarity=targetRarity(target,entry),rules=catalog?.rules||{};
  const typeName=entry?.typeName||target.itemType||null;
  if(entry?.runeword){
    lines.push({label:'Runeword',text:target.name+' is a runeword: '+entry.runeword+(typeName?' on a '+typeName:'')+'. The game data lists this rune combination; make it with the Jeweler’s rune crafting and check the exact steps there.'});
  }else if(rarity==='Mythic'){
    lines.push({label:'Mythic Unique',text:'Drops in Torment difficulties'+(rules.tiers?.[0]?.notes?.find(n=>/mythic/i.test(n))?' ('+rules.tiers[0].notes.find(n=>/mythic/i.test(n))+')':'')+'.'});
    if(rules.mythicCrafting)lines.push({label:'Craft',text:rules.mythicCrafting.material+': '+rules.mythicCrafting.text+'.'});
  }else if(rarity==='Unique'){
    if(entry?.lootSource&&entry.lootSource!=='world')lines.push({label:'Targeted drop',text:'In '+entry.lootSource+'’s loot table (game data). Farm '+entry.lootSource+' to target it; it can also appear as a regular Unique drop.'});
    else if(entry?.lootSource==='world')lines.push({label:'World drop',text:'No boss loot table: it drops anywhere Uniques drop. Higher Torment tiers increase Unique drops.'});
    else lines.push({label:'Drop',text:'The game data lists no boss loot table for '+target.name+'; it drops as a regular Unique. Higher Torment tiers increase Unique drops.'});
  }else if(rarity==='Set'){
    const set=target.setName||entry?.setName;
    lines.push({label:'Set charm',text:target.name+(set?' is part of the '+set.replace(/^the /,'')+' set':' is a set charm')+'. The game data lists no boss loot table for it; it drops as a regular charm.'});
  }else if(target.aspect){
    lines.push({label:'Base item',text:'Any Legendary '+(typeName||'item for this slot')+' works as the base; the item name doesn’t matter.'});
    const entryCodex=codex.find(c=>lower(c.name)===lower(target.aspect));
    lines.push({label:'Aspect',text:'Imprint '+target.aspect+' at the Occultist. '+(entryCodex?(entryCodex.unlocked?'Unlocked in your Codex of Power'+(entryCodex.actualRoll!=null?' (best roll '+entryCodex.actualRoll+'%)':'')+'.':'In your Codex list but not marked unlocked.'):'Not recorded in your Codex of Power yet: salvage a Legendary that has it to unlock it.')});
  }
  else if(rarity==='Legendary'||rarity==='Rare')lines.push({label:'Base item',text:'Any '+rarity+' '+(typeName||target.name)+' works; what matters is the affixes below. Ancestral copies (Torment I+) roll higher and can carry Greater Affixes.'});
  if(entry?.cls!=null&&classIndex!=null&&!(entry.cls&(1<<classIndex)))lines.push({label:'Class',text:'This item is not usable by your class.'});
  const ga=gaCount(target);
  if(ga)lines.push({label:'Greater Affixes',text:'The guide’s version has '+plural(ga,'Greater Affix')+' ('+(target.greaterAffixTargets||target.greaterAffixPriority||[]).join(', ')+'). Greater Affixes roll on Ancestral items'+(rules.ancestralTier?', which drop from '+rules.ancestralTier.name+(rules.ancestralTier.unlock?' ('+rules.ancestralTier.unlock.replace(/ on this character$/,'')+')':''):'')+'.'});
  const tempers=tempersOf(target);
  if(tempers.length)lines.push({label:'Blacksmith',text:'Temper '+tempers.map((t,i)=>t+(target.tempers?.[i]?.recipe?' (recipe: '+target.tempers[i].recipe+')':'')).join(', ')+(target.quality?'; masterwork to rank '+target.quality:'')+(target.masterworkPriority?.length?' and aim the capstone at '+target.masterworkPriority.join(' / '):'')+'.'});
  else if(target.quality)lines.push({label:'Blacksmith',text:'Masterwork to rank '+target.quality+(target.masterworkPriority?.length?' and aim the capstone at '+target.masterworkPriority.join(' / '):'')+'.'});
  const sockets=socketsOf(target);
  if(sockets.length)lines.push({label:'Jeweler',text:'Socket '+sockets.join(' + ')+'.'});
  return lines;
}

const sameItem=(a,b)=>Boolean(a&&b)&&(lower(a.name)===lower(b.name)||(a.itemId&&a.itemId===b.itemId))&&(!a.aspect||!b.aspect||lower(a.aspect)===lower(b.aspect));

/** Differences between this variant's target and the next variant's target for the same slot. */
export function nextStep(current,next,{catalog,classIndex=null,codex=[]}={}){
  if(!next?.target)return null;
  const a=current,b=next.target;
  if(!a)return {variant:next.name,kind:'new-slot',title:next.name+' adds '+b.name,lines:howToGet(b,{catalog,classIndex,codex})};
  if(!sameItem(a,b)){
    const what=b.aspect&&!b.identityRequired&&lower(a.aspect)!==lower(b.aspect)&&lower(a.name)===lower(b.name)?'the '+b.aspect:b.name+(b.aspect&&!b.identityRequired?' with '+b.aspect:'');
    return {variant:next.name,kind:'different-item',title:next.name+' uses '+what+' instead',lines:howToGet(b,{catalog,classIndex,codex})};
  }
  const changes=[];
  const ra=targetRarity(a,catalogEntry(catalog,a,classIndex)),rb=targetRarity(b,catalogEntry(catalog,b,classIndex));
  if(ra!==rb)changes.push({label:'Rarity',text:'Upgrade to the '+rb+' version.'});
  const gaA=gaCount(a),gaB=gaCount(b);
  if(gaB>gaA)changes.push({label:'Greater Affixes',text:'Look for a copy with '+plural(gaB,'Greater Affix')+' ('+(b.greaterAffixTargets||b.greaterAffixPriority||[]).join(', ')+'), up from '+gaA+'. Greater Affixes roll on Ancestral items'+(catalog?.rules?.ancestralTier?' ('+catalog.rules.ancestralTier.name+'+)':'')+'.'});
  if(Number(b.quality)>Number(a.quality||0))changes.push({label:'Masterwork',text:'Masterwork from rank '+(a.quality||0)+' to '+b.quality+'.'});
  if(Number(b.itemPower)>Number(a.itemPower||0))changes.push({label:'Item power',text:'Item power '+(a.itemPower||'?')+' → '+b.itemPower+'.'});
  const ta=tempersOf(a),tb=tempersOf(b);
  if(tb.join('|')!==ta.join('|'))changes.push({label:'Tempers',text:(ta.length?ta.join(', '):'none')+' → '+(tb.length?tb.join(', '):'none')+'.'});
  const sa=socketsOf(a),sb=socketsOf(b);
  if(sb.join('|')!==sa.join('|'))changes.push({label:'Sockets',text:(sa.length?sa.join(' + '):'none')+' → '+(sb.length?sb.join(' + '):'none')+'.'});
  const affA=(a.affixes||[]).filter(x=>x.primary!==false).map(x=>lower(x.name)),affB=(b.affixes||[]).filter(x=>x.primary!==false);
  const newAff=affB.filter(x=>!affA.includes(lower(x.name))).map(x=>x.name);
  if(newAff.length)changes.push({label:'Affixes',text:'Adds '+newAff.join(', ')+' to the target affixes.'});
  return {variant:next.name,kind:changes.length?'advanced':'same',title:changes.length?'Same item in '+next.name+', advanced version':'Same item and setup in '+next.name,lines:changes};
}

/** The next variant's target for this slot. Charms are compared as a set, since guides reorder them between variants. */
export function nextTargetFor(slot,currentSlots,nextSlots){
  if(!nextSlots)return null;
  if(!/^charm/.test(slot))return nextSlots[slot]||null;
  const cur=currentSlots?.[slot];
  const charmKeys=o=>Object.keys(o||{}).filter(k=>/^charm\d/.test(k));
  const same=charmKeys(nextSlots).find(k=>cur&&lower(nextSlots[k]?.name)===lower(cur.name));
  if(same)return nextSlots[same];
  // This charm is dropped: pair it with a charm that is new in the next variant (in slot order)
  const currentNames=new Set(charmKeys(currentSlots).map(k=>lower(currentSlots[k]?.name)));
  const dropped=charmKeys(currentSlots).filter(k=>!charmKeys(nextSlots).some(n=>lower(nextSlots[n]?.name)===lower(currentSlots[k]?.name)));
  const added=charmKeys(nextSlots).filter(k=>!currentNames.has(lower(nextSlots[k]?.name)));
  const i=dropped.indexOf(slot);
  return i>=0&&added[i]?nextSlots[added[i]]:null;
}

/** Is the equipped item already the guide's item for this slot? */
export function equippedMatches(item,target){
  if(!item||!target)return false;
  if(target.identityRequired||/unique|mythic/i.test(target.rarity||''))return lower(item.name)===lower(target.name);
  return Boolean(target.aspect&&lower(item.power?.name)===lower(target.aspect));
}
