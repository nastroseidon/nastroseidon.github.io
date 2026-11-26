// Item catalog lookups for scanning and manual entry: find a game item by (possibly misread) name,
// fill in what the game fixes for that item, and list the affixes an item type can roll for a class.

const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[’`]/g,"'").replace(/[^a-z0-9' ]+/g,' ').replace(/\s+/g,' ').trim();

/** Similarity 0..1 from edit distance (tolerates OCR slips such as rn/m, l/I, missing apostrophes). */
export function similarity(a,b){
  a=norm(a);b=norm(b);
  if(!a||!b)return 0;if(a===b)return 1;
  const m=a.length,n=b.length;let prev=Array.from({length:n+1},(_,j)=>j);
  for(let i=1;i<=m;i++){const cur=[i];for(let j=1;j<=n;j++)cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=cur}
  return 1-prev[n]/Math.max(m,n);
}

const usable=(mask,classIndex)=>classIndex==null||!mask||mask===255||Boolean(mask&(1<<classIndex));

/** Search catalog items by name for a dropdown: prefix and word matches first. */
export function searchItems(catalog,query,{classIndex=null,slot=null,limit=20}={}){
  const q=norm(query);if(!catalog||!q)return [];
  const scored=[];
  for(const item of catalog.items||[]){
    if(!usable(item.cls,classIndex))continue;
    const name=norm(item.name);
    let score=name.startsWith(q)?3:name.split(' ').some(w=>w.startsWith(q))?2:name.includes(q)?1:0;
    if(!score)continue;
    if(slot&&slotFamily(item.slot)===slotFamily(slot))score+=0.5;
    scored.push({item,score});
  }
  const seen=new Set();
  return scored.sort((a,b)=>b.score-a.score||a.item.name.localeCompare(b.item.name)).map(s=>s.item).filter(i=>!seen.has(i.name)&&seen.add(i.name)).slice(0,limit);
}

const slotFamily=s=>String(s||'').replace(/\d+$/,'');

/** Best catalog item for a scanned name; null when nothing is close enough. */
export function matchItemName(catalog,name,{classIndex=null,slot=null,threshold=0.82}={}){
  if(!catalog||!norm(name))return null;
  let best=null;
  for(const item of catalog.items||[]){
    let s=similarity(name,item.name);
    if(s<threshold-0.1)continue;
    if(!usable(item.cls,classIndex))s-=0.05;
    if(slot&&slotFamily(item.slot)===slotFamily(slot))s+=0.02;
    if(!best||s>best.score)best={item,score:s};
  }
  return best&&best.score>=threshold?{...best.item,matchScore:Math.min(1,Math.round(best.score*100)/100)}:null;
}

/** Catalog types for a slot (for the item type dropdown). */
export function typesForSlot(catalog,slot){
  const fam=slotFamily(slot);
  return (catalog?.types||[]).filter(t=>slotFamily(t.slot)===fam||(fam==='ring'&&t.slot==='ring1')||(fam==='charm'&&t.slot==='charm1'));
}
export function typeByName(catalog,typeName,slot=null){
  const all=(catalog?.types||[]).filter(t=>norm(t.typeName)===norm(typeName));
  return all.find(t=>slotFamily(t.slot)===slotFamily(slot))||all[0]||null;
}

/** Affix labels an item type can roll for a class (unique labels, sorted). */
export function affixChoices(catalog,type,classIndex=null){
  const keys=catalog?.pools?.[type]||[];
  const labels=new Set();
  for(const k of keys){const a=catalog.affixes[k];if(a&&usable(a.cls,classIndex))labels.add(a.label)}
  return [...labels].sort((a,b)=>a.localeCompare(b));
}

/** Snap an OCR'd affix name to the closest legal label. */
export function snapAffixName(name,labels,threshold=0.78){
  let best=null;
  for(const l of labels){const s=similarity(name,l);if(!best||s>best.s)best={l,s}}
  return best&&best.s>=threshold?best.l:null;
}

/** OCR sometimes leaves a wrapped roll range in the affix name ("Cold Resistance [1,800 2.274"). */
export function cleanRangeTail(a){
  const m=String(a.name||'').match(/^(.*?[A-Za-z%)])\s*[\[(]\s*([\d.,\s|-]+?)\s*[\])]?\s*$/);
  if(!m)return a;
  const nums=m[2].replace(/(\d)[.,](\d{3})(?!\d)/g,'$1$2').match(/\d+(?:\.\d+)?/g)?.map(Number)||[];
  const out={...a,name:m[1].trim(),snappedFrom:a.name};
  if(a.min==null&&a.max==null&&nums.length===2&&nums[0]<=nums[1]&&(a.value==null||a.value>=nums[0]&&a.value<=nums[1])){out.min=nums[0];out.max=nums[1]}
  return out;
}

/** The catalog type name in an OCR'd type line ("Two-Handed il Scythe" -> "Two-Handed Scythe"): the longest whose words all appear. */
export function resolveTypeName(catalog,itemType){
  const words=new Set(norm(itemType).split(' ').filter(Boolean));if(!words.size)return null;
  let best=null;
  for(const t of catalog?.types||[]){const tw=norm(t.typeName).split(' ');if(tw.every(w=>words.has(w))&&(!best||tw.length>best.n))best={name:t.typeName,n:tw.length}}
  return best?.name||null;
}

/**
 * When the name is too damaged to match on its own, use what the tooltip's type line says
 * (e.g. "Unique Pants") to narrow the candidates, then compare words.
 */
export function identifyItem(catalog,{name,rarity,itemType,slot,classIndex=null,affixes=[]}={}){
  if(!catalog||!/unique|mythic/i.test(rarity||''))return null;
  if(/^unidentified item$/i.test(name||''))name='';
  const fam=slotFamily(slot),typeName=resolveTypeName(catalog,itemType);
  const pool=(catalog.items||[]).filter(i=>i.rarity.toLowerCase()===String(rarity).toLowerCase()&&usable(i.cls,classIndex)&&(typeName?norm(i.typeName)===norm(typeName):slotFamily(i.slot)===fam));
  if(!pool.length)return null;
  const words=norm(name).split(' ').filter(w=>w.length>=3);
  const score=i=>{if(!words.length)return 0;const target=norm(i.name).split(' ').filter(w=>w.length>=3);if(!target.length)return 0;
    return target.reduce((sum,t)=>sum+Math.max(0,...words.map(w=>similarity(w,t))),0)/target.length};
  // Fixed affixes are a fingerprint: when the title wasn't read, the unique whose own affixes are on the item
  const read=(affixes||[]).map(a=>a?.name).filter(Boolean);
  const prints=i=>{const fixed=(i.fixed||[]).map(k=>catalog.affixes?.[k]?.label).filter(Boolean);if(fixed.length<2||!read.length)return 0;
    return fixed.filter(l=>read.some(r=>similarity(r,l)>=0.8)).length/fixed.length};
  const ranked=pool.map(i=>{const n=Math.max(score(i),name?similarity(name,i.name):0),f=prints(i);return {i,s:Math.max(n,f*0.9),by:f*0.9>n?'fixed affixes':'type line'}}).sort((a,b)=>b.s-a.s);
  const [best,second]=ranked;
  if(best.s>=0.6&&(!second||best.s-second.s>=0.15))return {...best.i,matchScore:Math.round(best.s*100)/100,matchedBy:best.by};
  return null;
}

/**
 * Apply a catalog item to a scanned/manual item: name, rarity, slot, type, fixed affixes (keeping any
 * values already read), snapped affix names, power text. Returns a new item; the input is not changed.
 */
export function applyCatalogItem(item,entry,catalog,{classIndex=null}={}){
  const out=structuredClone(item||{});
  out.name=entry.name;out.rarity=entry.rarity;out.itemType=entry.typeName;out.catalogKey=entry.key;
  if(!out.slot||slotFamily(out.slot)!==slotFamily(entry.slot))out.slot=entry.slot;
  const fixedLabels=(entry.fixed||[]).map(k=>catalog.affixes[k]?.label).filter(Boolean);
  const implicitLabels=(entry.implicits||[]).map(k=>catalog.affixes[k]?.label).filter(Boolean);
  const pool=affixChoices(catalog,entry.type,classIndex);
  let read=[...(out.affixes||[])];
  // A sentence matching the unique power is the power, not an affix
  if(entry.power){
    const powerWords=new Set(norm(entry.power).split(' '));
    const overlap=t=>{const w=norm(t).split(' ').filter(x=>x&&!/^\d/.test(x));return w.length?w.filter(x=>powerWords.has(x)).length/w.length:0};
    const lineText=a=>a.name.includes('#')&&a.value!=null?a.name.replace('#',a.value+(a.unit&&a.unit!=='flat'?a.unit.replace('[x]',''):'')):a.name;
    const powerish=read.filter(a=>a.name&&a.name.split(' ').length>6&&overlap(a.name)>=0.6);
    if(powerish.length){
      read=read.filter(a=>!powerish.includes(a));
      const lead=powerish.map(lineText).join(' '),existing=out.power?.description||'';
      out.power={...(out.power||{}),description:existing&&!existing.includes(lead)?lead+' '+existing:existing||lead};
    }
  }
  const take=(label,kind)=>{
    const i=read.findIndex(a=>similarity(a.name,label)>=0.75);
    const found=i>=0?read.splice(i,1)[0]:null;
    return {...(found||{value:null,unit:'flat'}),name:label,kind,fixed:true};
  };
  const implicits=implicitLabels.map(l=>take(l,'implicit'));
  const fixed=fixedLabels.map(l=>take(l,'base'));
  const rest=read.map(a=>{
    if(a.kind==='temper')return a;
    a=cleanRangeTail(a);
    const snapped=snapAffixName(a.name,pool);
    return snapped&&snapped!==a.name?{...a,name:snapped,snappedFrom:a.snappedFrom||a.name}:a;
  });
  out.affixes=[...implicits,...fixed,...rest];
  const free=Math.max(0,entry.affixCount-fixed.length),rolled=rest.filter(a=>a.kind!=='temper'&&a.kind!=='implicit').length;
  for(let i=rolled;i<free;i++)out.affixes.push({name:'',value:null,unit:'flat',kind:'base'});
  if(entry.power){
    out.power={...(out.power||{}),name:entry.rarity==='Unique'||entry.rarity==='Mythic'?entry.name:out.power?.name||null};
    out.power.description||=entry.power;
    out.power.template=entry.power;
  }
  out.catalogMatch={key:entry.key,name:entry.name,affixCount:entry.affixCount,fixed:fixedLabels,lootSource:entry.lootSource||null,score:entry.matchScore??null};
  return out;
}

/** Every affix label a class can roll on any item type (for tempers and items with no type chosen). */
export function allAffixChoices(catalog,classIndex=null){
  const labels=new Set();
  for(const keys of Object.values(catalog?.pools||{}))for(const k of keys){const a=catalog.affixes[k];if(a&&usable(a.cls,classIndex))labels.add(a.label)}
  return [...labels].sort((a,b)=>a.localeCompare(b));
}

/**
 * Filter a choice list for a search box: every typed word must start a word of the choice
 * ("crit dam" finds "Critical Strike Damage Multiplier"); prefix matches come first.
 */
export function filterChoices(choices,query,limit=200){
  const q=norm(query);if(!q)return choices.slice(0,limit);
  const words=q.split(' ');
  const hits=[];
  for(const c of choices){
    const n=norm(c),cw=n.split(' ');
    if(!words.every(w=>cw.some(x=>x.startsWith(w))||n.includes(w)))continue;
    hits.push({c,s:n===q?0:n.startsWith(q)?1:words.every(w=>cw.some(x=>x.startsWith(w)))?2:3});
  }
  return hits.sort((a,b)=>a.s-b.s||a.c.localeCompare(b.c)).slice(0,limit).map(h=>h.c);
}

/** The canonical label for a typed or scanned affix name, or null when it is not in the list. */
export function canonicalChoice(value,choices,threshold=0.8){
  const v=norm(value);if(!v)return null;
  const exact=choices.find(c=>norm(c)===v);if(exact)return exact;
  return snapAffixName(value,choices,threshold);
}
