// Import a build from a guide page the user saved in their browser (File → Save Page As).
// Icy Veins and Mobalytics block automated reading (Cloudflare), so the app never fetches them; the user's
// own saved copy is read locally instead. Works in the browser and in Node: plain string processing.
//
// What each saved page contains (checked against real saves, Season 15 Blood Wave guides):
//   Icy Veins:  per-slot item/aspect options with sockets and power text; per-slot stat priority with the
//               Greater Affix marker and tempering; where uniques drop; skill leveling path, Paragon boards and
//               glyphs and mercenaries for the tab that was selected when saving; talisman and rune notes.
//   Mobalytics: per-slot item/aspect with equipment priority, talisman charms, skills with ranks, Book of the
//               Dead choices, Paragon boards and glyphs, mercenaries. Affix details live in hover pop-ups that
//               aren't part of the saved page.

const CLASSES=['necromancer','barbarian','druid','rogue','sorcerer','spiritborn','paladin','warlock'];
const decode=s=>String(s||'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#0?39;|&#x27;|&apos;/g,"'").replace(/&rsquo;|&lsquo;/g,'’').replace(/&ndash;/g,'–').replace(/&mdash;/g,'—').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)));
const straight=s=>String(s||'').replace(/[’‘`]/g,"'").replace(/\s+/g,' ').trim();
const gpNorm=s=>straight(s).toLowerCase().replace(/[^a-z0-9' ]+/g,' ').replace(/\s+/g,' ').trim();
/** "[img:Blood Wave] Blood Wave" → "Blood Wave"; a lone "[img:Igni]" → "Igni". */
const stripImgs=line=>straight(String(line||'').replace(/\[img:([^\]]*)\]\s*/g,(m,alt,off,str)=>!alt||/^[a-z0-9_()-]+$/.test(alt)||/^\w+$/.test(alt)&&/^[A-Z][a-z]{1,4}\b(?!\s+[A-Z])/.test(str.slice(off+m.length))?'':straight(str.slice(off+m.length)).toLowerCase().startsWith(straight(alt).toLowerCase())?'':alt+' '));
const human=slug=>String(slug||'').replace(/\(\d+\)$/,'').split('-').filter(Boolean).map(w=>w[0].toUpperCase()+w.slice(1)).join(' ');
const attr=(tag,name)=>tag.match(new RegExp('\\b'+name+'="([^"]*)"','i'))?.[1]??null;
const imgSlug=tag=>{const src=attr(tag,'src')||'';return decodeURIComponent(src.split(/[?#]/)[0].split('/').pop()||'').replace(/\.(webp|png|jpe?g|svg|gif)$/i,'').replace(/\(\d+\)$/,'')};

/** Page → text lines; images become [img:alt] (or [img:file-name] when the alt text is empty). */
export function pageLines(html){
  let h=String(html||'').replace(/<(script|style|svg|noscript|iframe|template)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<!--[\s\S]*?-->/g,'');
  h=h.replace(/<img\b[^>]*>/gi,tag=>' [img:'+(decode(attr(tag,'alt')||'').trim()||imgSlug(tag))+'] ');
  h=h.replace(/<\/?(div|p|li|h[1-6]|section|tr|td|th|br|header|footer|button|ul|ol|table|figure|figcaption|article|aside|nav|summary|details|label)\b[^>]*>/gi,'\n');
  h=decode(h.replace(/<[^>]+>/g,' '));
  return h.split('\n').map(l=>l.replace(/\s+/g,' ').trim()).filter(Boolean);
}

/** Which site a saved page came from, from its canonical address. */
export function detectGuideSite(html){
  const head=String(html||'').slice(0,200000);
  const url=head.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i)?.[1]||head.match(/<meta[^>]+property="og:url"[^>]+content="([^"]+)"/i)?.[1]||head.match(/saved from url=\(\d+\)(\S+)/)?.[1]||'';
  if(/(^|\.)icy-veins\.com\//i.test(url.replace(/^https?:\/\//,'')))return {site:'icy-veins',url};
  if(/(^|\.)mobalytics\.gg\//i.test(url.replace(/^https?:\/\//,'')))return {site:'mobalytics',url};
  if(/icy-veins/i.test(head))return {site:'icy-veins',url};
  if(/mobalytics/i.test(head))return {site:'mobalytics',url};
  return {site:null,url};
}
function pageTitle(html){
  const og=String(html).match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)?.[1];
  return straight(decode(og||String(html).match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]||'')).replace(/\s*[-|–]\s*(Icy Veins|Mobalytics)\s*$/i,'');
}
const classFrom=text=>{const t=gpNorm(text);if(/\bsorceress\b/.test(t))return 'sorcerer';return CLASSES.find(c=>new RegExp('\\b'+c+'\\b').test(t))||null};

// ----- Slots
const SLOT_WORDS=[[/^helm/i,'helm'],[/^chest/i,'chest'],[/^gloves/i,'gloves'],[/^pants|^legs/i,'pants'],[/^boots/i,'boots'],[/^amulet/i,'amulet'],[/^ring\s*1/i,'ring1'],[/^ring\s*2/i,'ring2'],[/^(\d-\d\s*x\s*)?rings?\b/i,'ring'],
  [/^bludgeoning/i,'slot_8'],[/^slashing/i,'slot_9'],[/^dual[- ]wield(ing)? weapon\s*2|^weapon\s*2\b/i,'slot_11'],[/^dual[- ]wield(ing)? weapon\s*1?|^weapon\s*1\b/i,'slot_10'],[/^(two-?handed |main[- ]?hand |one-?handed |1h |2h )?weapon|^main[- ]?hand/i,'weapon'],[/^off[- ]?hand|^focus$|^shield$|^totem$/i,'offhand']];
function slotKey(label){
  const l=straight(label);
  if(l.length>40||/^\[img|^\d+\s*\./.test(l))return null;
  return SLOT_WORDS.find(([re])=>re.test(l))?.[1]||null;
}

// ----- Affix names as the app's grading expects them ("x% Critical Strike Damage Multiplier" → "Critical Strike Damage Multiplier")
function affixNames(raw){
  let t=straight(raw).replace(/\[Guaranteed Modifier\]\s*/i,'');
  const condition=t.match(/\(([^)]*)\)\s*$/)?.[1]||null;t=t.replace(/\s*\([^)]*\)\s*$/,'');
  t=t.replace(/^[+x×]?\s*%?\s*/i,'').replace(/^x%\s*/i,'').replace(/^\+?\s*Ranks? to (All )?/i,(m,all)=>all?'All ':'').replace(/^\+/,'').trim();
  const parts=t.split(/\s+\/\s+/).map(s=>s.trim()).filter(Boolean);
  // "Physical / All Damage Multiplier": the shared ending applies to every part
  if(parts.length>1){const tail=parts.at(-1).split(' ').slice(1).join(' ');for(let i=0;i<parts.length-1;i++)if(!parts[i].includes(' ')&&tail)parts[i]+=' '+tail}
  return {names:parts.length?parts:[t],condition};
}
const weightFor=rank=>rank<=2?3:rank<=4?2:1;
const tierFor=w=>({3:'best',2:'good',1:'useful'})[w];

function makeSlot(slot,{name,options=[],sockets=[],socketKind=null,description=null,notes=[]},source){
  const aspect=/\baspect\b/i.test(name);
  return {name:aspect?'Any Legendary':name,identityRequired:!aspect,slot,rarity:aspect?'Legendary':'Unique',aspect:aspect?name:null,
    affixes:[],tempers:[],sockets:sockets.map(s=>({name:s,kind:socketKind||(/rune/i.test(s)?'Rune':/splinter/i.test(s)?'Soul Splinter':'Gem')})),
    ...(description?(aspect?{aspectText:description}:{uniquePower:description}):{}),
    itemOptions:options.length>1?options:undefined,notes:notes.length?notes:undefined,sourceStatus:'From a saved '+source+' page; review before use'};
}
function applyPriority(target,row,source){
  if(!row)return;
  const affixes=[],ga=[];
  for(const a of row.affixes){
    if(a.rank>=99)continue;   // "99." marks a guaranteed affix the guide doesn't care about
    const {names,condition}=affixNames(a.text);
    names.forEach((n,i)=>{
      const primary=i===0,weight=primary?weightFor(a.rank):1;
      affixes.push({name:n,kind:'base',weight,tier:primary?tierFor(weight):'alternative',priorityRank:primary?a.rank:null,primary,greaterAffix:false,guaranteed:a.guaranteed||undefined,
        condition:condition||undefined,weightSource:source+' stat priority #'+a.rank+(primary?'':' (either)'),sourceStatus:'Guide stat priority'});
      if(a.greater&&primary)ga.push(n);
    });
  }
  target.affixes=affixes;
  if(ga.length){target.greaterAffixTargets=ga;target.greaterAffixPriority=[...ga]}
  if(row.tempers.length){target.tempers=row.tempers.map(t=>({name:t.name,category:t.category}));target.temper=row.tempers.map(t=>t.name).join(' / ')}
}

function draftFrom({provider,url,title,author,updated,classId,season,variants,warnings,globalNotes}){
  const now=new Date().toISOString();
  return {name:title,title,classId,author,sourceUrl:url,url,season,patch:null,provider,sourceUpdatedAt:updated||null,
    slots:variants[0]?.slots||{},variants:variants.map((v,i)=>({id:provider+'-'+i,order:i,sourceUrl:url,classId,sourceStatus:'Saved '+provider+' page',coverage:Object.fromEntries(['gear','skills','paragon','mercenaries'].map(k=>[k,'provisional'])),...v})),
    activeVariantId:provider+'-0',stages:variants.map(v=>v.name),status:'review',verifiedAt:null,importedAt:now,
    sources:[{url,kind:'saved-page',retrievedAt:now,note:'Read from a page the user saved; the site was not contacted.'}],importWarnings:warnings,globalNotes:globalNotes||null,sourceStatus:'Saved '+provider+' page; review before use'};
}

// ===================================================================== Icy Veins
const OPTION=/^(?:(\d+)\s*\.\s*)?\[img:([^\]]+)\]\s*(.+?)\s*$/;
const isOption=line=>{const m=line.match(OPTION);return m&&gpNorm(m[2])===gpNorm(m[3])?{rank:m[1]?+m[1]:1,name:straight(m[3])}:null};
const between=(lines,startRe,endRe,from=0)=>{const s=lines.findIndex((l,i)=>i>=from&&startRe.test(l));if(s<0)return [];const e=lines.findIndex((l,i)=>i>s&&endRe.test(l));return lines.slice(s+1,e<0?undefined:e)};

function icyGearTable(lines){
  const start=lines.findIndex((l,i)=>l==='Aspect / Unique'&&lines[i+1]==='Description');
  if(start<0)return [];
  const end=lines.findIndex((l,i)=>i>start&&/^Stat Priority/i.test(l));
  const body=lines.slice(start+2,end<0?undefined:end).filter(l=>l!=='Advertisement');
  const rows=[];let row=null;
  for(const line of body){
    const key=slotKey(line);
    if(key&&!isOption(line)){row={label:line,key,sockets:[],socketKind:null,options:[],description:[],notes:[]};rows.push(row);continue}
    if(!row)continue;
    const opt=isOption(line);
    if(opt){row.options.push(opt.name);continue}
    if(/^Transfigured:/i.test(line)){row.notes.push(stripImgs(line));continue}
    if(!row.options.length){
      if(/^runeword$/i.test(line)){row.socketKind='Rune';continue}
      if(/^n\/a$/i.test(line))continue;
      row.sockets.push(...[...line.matchAll(/\[img:([^\]]+)\]\s*(Splinter)?/g)].map(m=>straight(m[2]&&!/splinter/i.test(m[1])?m[1]+' Splinter':m[1])));
      if(/\bor\b/.test(line))row.notes.push('Socket: '+stripImgs(line));
      continue;
    }
    row.description.push(stripImgs(line));
  }
  return rows;
}
function icyStatTable(lines){
  const start=lines.findIndex((l,i)=>l==='Tempering Affixes'&&lines[i-1]==='Affixes');
  if(start<0)return [];
  const body=[];
  for(let i=start+1;i<lines.length&&!/^(Desired Transfigured|Ancestral and Mythic Uniques|Gems and Runewords)/i.test(lines[i]);i++)if(lines[i]!=='Advertisement')body.push(lines[i]);
  const rows=[];let row=null;
  for(const line of body){
    const key=slotKey(line),opt=isOption(line);
    if(key&&!opt){row={label:line,key,item:null,affixes:[],tempers:[]};rows.push(row);continue}
    if(!row)continue;
    if(opt&&!row.affixes.length){row.item=opt.name;continue}
    const a=line.match(/^((?:\[img:[^\]]*\]\s*)*)(\d+)\s*\.\s*(.+)$/);
    if(a){row.affixes.push({rank:+a[2],text:a[3],greater:/greater_affix/i.test(a[1]),guaranteed:/\[Guaranteed Modifier\]/i.test(a[3])});continue}
    const t=line.match(/^(?:\[img:[^\]]*\]\s*)?(Offensive|Defensive|Utility|Mobility|Resource|Weapons?)\s*[–-]\s*(.+)$/i);
    if(t)row.tempers.push({category:t[1],name:straight(t[2])});
  }
  return rows;
}
function icyUniques(lines){
  const body=between(lines,/^Source \(highest chance\)$/i,/^(Gems and Runewords|Advertisement)$/i);
  const out=new Map();let cur=null;
  for(const line of body){
    const opt=isOption(line);
    if(opt){cur={name:opt.name,lines:[]};out.set(gpNorm(opt.name),cur);continue}
    if(cur)cur.lines.push(stripImgs(line));
  }
  for(const u of out.values()){
    const [category,...rest]=u.lines;
    const last=rest.at(-1)||'';
    const recipe=/\s\+\s/.test(last)?last:null,source=!recipe&&last&&!/^–/.test(last)?last:null;
    u.text=[category,...rest.filter(l=>l!==recipe&&l!==source)].join(' ').replace(/\s*–\s*/g,'; ').replace(/^;\s*/,'')+(source?' Source (highest chance): '+source+'.':'')+(recipe?' Runes: '+recipe+'.':'');
    u.source=source;u.recipe=recipe;u.category=category;
  }
  return out;
}
function activeTab(html,anchor){
  const i=html.indexOf(anchor);if(i<0)return null;
  const seg=html.slice(Math.max(0,i-4000),i);
  const tabs=[...seg.matchAll(/class="[^"]*\btab\b[^"]*"[^>]*>\s*<span[^>]*tabName[^>]*>([^<]+)<\/span>/g)];
  const all=[...seg.matchAll(/tabName[^>]*>([^<]+)</g)].map(m=>straight(m[1]));
  const active=seg.match(/activeTab[^>]*>\s*<span[^>]*>([^<]+)<\/span>/)?.[1];
  return {active:active?straight(active):null,tabs:[...new Set(all)]};
}
export function parseIcyVeins(html,{url}={}){
  const lines=pageLines(html),title=pageTitle(html),warnings=[];
  const classId=classFrom(title)||classFrom(url);
  const season=title.match(/Season\s+(\d+)/i)?.[1]||null;
  const author=lines[lines.findIndex(l=>/^writer$/i.test(l))-1]||null;
  const updated=lines.find(l=>/^Updated:/i.test(l))?.match(/^Updated:\s*(.+?)(?:\s+S-Tier.*|\s+[A-F]-Tier.*)?$/i)?.[1]||null;
  // Gear: options per slot, then stat priority rows matched to the first option
  const gear=icyGearTable(lines),stats=icyStatTable(lines),uniques=icyUniques(lines);
  const slots={};let rings=0;
  for(const row of gear){
    let key=row.key==='ring'?(++rings===1?'ring1':'ring2'):row.key;
    if(!row.options.length||slots[key])continue;
    const name=row.options[0];
    const target=makeSlot(key,{name,options:row.options,sockets:row.sockets,socketKind:row.socketKind,description:row.description.join(' ')||null,notes:row.notes},'Icy Veins');
    const fam=key.replace(/\d$/,'');
    const statRow=stats.find(s=>s.key.replace(/\d$/,'')===fam&&s.item&&gpNorm(s.item)===gpNorm(name))||stats.find(s=>s.key.replace(/\d$/,'')===fam&&!s.item);
    applyPriority(target,statRow,'Icy Veins');
    const u=uniques.get(gpNorm(name));
    const alt=row.options.slice(1).map(o=>uniques.get(gpNorm(o))?o+' ('+uniques.get(gpNorm(o)).text+')':o);
    if(u||alt.length)target.acquisition={text:[u?'Icy Veins: '+u.text:null,alt.length?'Alternatives in order: '+alt.join('; '):null].filter(Boolean).join('\n')};
    slots[key]=target;
  }
  if(!Object.keys(slots).length)warnings.push('No gear table was found. Save the full guide page (File → Save Page As → Web Page, Complete).');
  // Skills: header bar, then the leveling path of the selected tab
  const barLine=lines.find((l,i)=>(l.match(/\[img:[^\]]+\]/g)||[]).length>=4&&lines.slice(Math.max(0,i-3),i).some(x=>/^Updated:/i.test(x)));
  const bar=barLine?[...barLine.matchAll(/\[img:([^\]]+)\]/g)].map(m=>straight(m[1])):[];
  const ranks=new Map();
  for(const l of lines){const m=l.match(/^(.+?) - Rank (\d+)(?:-(\d+))?$/);if(m)ranks.set(straight(m[1]),Math.max(ranks.get(straight(m[1]))||0,+(m[3]||m[2])))}
  const skillTab=activeTab(html,'Points Used')||activeTab(html,'Leveling Path');
  // Paragon: boards in attachment order with their glyphs
  const pathLines=between(lines,/^Board attachment order/i,/^(Advertisement|Season Mechanics|It is imperative)/i);
  const boards=[];
  for(const l of pathLines){const m=stripImgs(l).match(/^(.+?)\s+[–-]\s+(.+)$/);if(!m)continue;
    let b=boards.find(x=>gpNorm(x.name)===gpNorm(m[1]));if(!b){b={name:m[1],order:boards.length+1};boards.push(b)}
    const g=m[2].match(/^Glyph Slot\s+(.+)$/i);if(g)b.glyph=g[1]}
  const paragonTab=activeTab(html,'Node unlock order')||activeTab(html,'Paragon Points Spent');
  // Mercenaries
  const mi=lines.findIndex((l,i)=>l==='Hired'&&lines.slice(Math.max(0,i-4),i).includes('Mercenaries'));
  const img=l=>l?.match(/^\[img:([^\]]+)\]$/)?.[1]||null;
  const mercenaries=mi<0?{}:{hired:img(lines[mi+1]),reinforcement:lines[mi+2]==='Reinforcement'?img(lines[mi+3]):null,reinforcementSkill:img(lines[mi+4]),reinforcementTrigger:img(lines[mi+5]),
    text:lines.slice(mi+6,mi+12).filter(l=>l.length>60&&!/^\[img/.test(l)).map(straight).join('\n')||null};
  // Notes: Book of the Dead, talisman goals, requirements
  const bookOfDead=lines.filter(l=>/^\[img:(Raise Skeleton|Golem[^\]]*)\]\s*[^:]+:/.test(l)||/^(Starter|Endgame) version:$/.test(l)).map(l=>stripImgs(l.replace(/^\[img:[^\]]*\]\s*/,'')));   // leading icon is just “Raise Skeleton”/“Golem”
  const talisman=between(lines,/^This builds? Talisman goalposts/i,/^(Advertisement|Mercenaries)$/i).map(stripImgs);
  const requirements=between(lines,/^Build Requirements$/i,/^(Advertisement|Skill Tree Points)$/i).map(stripImgs);
  const tab=skillTab?.active||paragonTab?.active||null,tabs=skillTab?.tabs||paragonTab?.tabs||[];
  if(tab&&tabs.length>1)warnings.push('Skills, Paragon and mercenaries come from the “'+tab+'” tab, which was selected when the page was saved. The guide also has '+tabs.filter(t=>t!==tab).map(t=>'“'+t+'”').join(', ')+': select it on Icy Veins, save the page again and import that file to add it. Gear and stat priorities are the same for every tab.');
  warnings.push('Icy Veins doesn’t give target roll values, item power or masterwork ranks; the grade uses the stat order and Greater Affix marks only.');
  const variant={name:tab||'Guide',slots,skills:{bar,entries:[...ranks].map(([name,rank])=>({name,rank,sourceStatus:'Icy Veins leveling path'}))},paragon:{name:tab||'Guide',boards},mercenaries,
    notes:[requirements.length?'Build requirements:\n'+requirements.join('\n'):null,bookOfDead.length?'Book of the Dead:\n'+bookOfDead.join('\n'):null,talisman.length?'Talisman:\n'+talisman.join('\n'):null].filter(Boolean).join('\n\n')||null};
  return draftFrom({provider:'icy-veins',url,title,author,updated,classId,season,variants:[variant],warnings});
}

// ===================================================================== Mobalytics
function mobSection(html,startText,endText){
  const s=html.indexOf('>'+startText+'<');if(s<0)return '';
  const e=endText?html.indexOf('>'+endText+'<',s+1):-1;
  return html.slice(s,e<0?undefined:e);
}
export function parseMobalytics(html,{url}={}){
  const lines=pageLines(html),title=pageTitle(html),warnings=[];
  const classId=classFrom(url)||classFrom(title);
  const season=title.match(/Season\s+(\d+)/i)?.[1]||lines.find(l=>/Season \d+/.test(l))?.match(/Season (\d+)/)?.[1]||null;
  const author=lines.find(l=>/^By\s+\S/.test(l))?.replace(/^By\s+/,'')||null;
  const updated=lines.find(l=>/^Updated on\s/.test(l))?.replace(/^Updated on\s+/,'')||null;
  const at=(re,from=0)=>lines.findIndex((l,i)=>i>=from&&re.test(l));
  // Gear: [priority number] / slot label / item or aspect name
  const g0=at(/^Aspect & Uniques$/),g1=at(/^Equipment Priority$/,g0+1);
  const slots={},priority=[];
  if(g0>=0)for(let i=g0+1;i<(g1<0?lines.length:g1);i++){
    const key=slotKey(lines[i]),name=lines[i+1];
    if(!key||key==='ring'||!name||/^empty$/i.test(name)||/^\[img/.test(name))continue;
    const rank=/^\d+$/.test(lines[i-1])?+lines[i-1]:null;
    slots[key]=makeSlot(key,{name:straight(name)},'Mobalytics');
    if(rank)slots[key].priority=rank,priority.push([rank,straight(name)]);
    i++;
  }
  const eqNotes=g1<0?[]:between(lines,/^Expand Priority$/,/^(Talisman|Skills & Rotation)$/,g1).map(stripImgs);
  // Talisman charms
  const t0=at(/^Talisman$/,g1>0?g1:0),t1=at(/^Talisman Priority$/,t0+1);
  let charm=0;
  if(t0>=0)for(const l of lines.slice(t0+1,t1<0?t0+40:t1)){
    const m=l.match(/^(.+?)\s+(Set Charm|Unique Charm|Mythic Charm|Legendary Charm|Charm)$/);
    if(!m||/^seal$/i.test(m[1]))continue;
    const key='charm'+(++charm);
    slots[key]={...makeSlot(key,{name:straight(m[1])},'Mobalytics'),rarity:/set/i.test(m[2])?'Set':/mythic/i.test(m[2])?'Mythic':'Unique',identityRequired:true,aspect:null,name:straight(m[1])};
  }
  // Skills with ranks, and Book of the Dead choices (radio buttons that were checked)
  const skillHtml=mobSection(html,'Skills &amp; Rotation','Skill Tree')||mobSection(html,'Skills & Rotation','Skill Tree');
  const entries=[];
  for(const m of skillHtml.matchAll(/<img\b[^>]*>(?:\s*<\/div>)?\s*<span[^>]*>(\d+)<\/span>/g)){
    const slug=imgSlug(m[0].match(/<img\b[^>]*>/)[0]);if(slug)entries.push({name:human(slug),rank:+m[1],slug,sourceStatus:'Mobalytics skill ranks'});
  }
  const book=[...skillHtml.matchAll(/<input\b[^>]*\bchecked\b[^>]*>/g)].map(m=>{const name=attr(m[0],'name')||'',value=+attr(m[0],'value');return human(name)+': '+(value===3?'Sacrifice':'Upgrade '+(value||'?'))});
  const notesAfterBook=between(lines,/^Skeletal Golems$|^Golems$/,/^Skill Tree$/).filter(l=>l.length>40).map(stripImgs);
  // Paragon: "N / Board / Glyph"
  const p0=at(/^Paragon Board$/),p1=at(/^Mercenaries$/,p0+1);
  const boards=[];
  if(p0>=0)for(let i=p0+1;i<(p1<0?lines.length:p1);i++){
    if(/^\d+$/.test(lines[i])&&lines[i+1]&&!/^(Str|Int|Dex|Will):/.test(lines[i+1])&&/^Str:/.test(lines[i+2]||'')){
      const [name,glyph]=lines[i+1].split(/\s+\/\s+/);boards.push({name:straight(name),glyph:glyph?straight(glyph):undefined,order:+lines[i]});
    }
  }
  // Mercenaries
  const mercHtml=mobSection(html,'Hired Mercenary','Frequently Asked Questions')||mobSection(html,'Hired Mercenary',null).slice(0,8000);
  const spanAfter=label=>{const i=mercHtml.indexOf('>'+label+'<');if(i<0)return null;return straight(decode(mercHtml.slice(i).match(/<span[^>]*>([^<]{2,40})<\/span>/)?.[1]||''))||null};
  const skillImg=(()=>{const i=mercHtml.indexOf('>Skill<');if(i<0)return null;const t=mercHtml.slice(i).match(/<img\b[^>]*>/)?.[0];return t?human(imgSlug(t)):null})();
  const trigger=lines.find((l,i)=>lines[i-2]==='Skill'||lines[i-1]==='Skill'&&!/^\[img/.test(l))||null;
  const mercenaries={hired:spanAfter('Hired Mercenary'),reinforcement:spanAfter('Reinforcement'),reinforcementSkill:skillImg,reinforcementTrigger:trigger&&!/^\[img/.test(trigger)?trigger:null};
  // Variants: Mobalytics shows one variant per page view
  const variantText=between(lines,/^Build Variants$/,/^Aspect & Uniques$/).filter(l=>!/^\[img/.test(l));
  warnings.push('Mobalytics keeps affix details in pop-ups that aren’t part of a saved page, so slots have the item or aspect but no stat priorities. Add affixes in the Build Library, or import the Maxroll or Icy Veins version for stat targets.');
  if(variantText.some(l=>/variant/i.test(l)&&!/coming soon|only/i.test(l)))warnings.push('This guide lists more than one variant; the saved page holds the one that was open. Save it again with another variant selected to import that one.');
  const variant={name:'Mobalytics build',slots,skills:{entries},paragon:{name:'Paragon',boards},mercenaries,
    notes:[variantText.join(' ')||null,priority.length?'Equipment priority: '+priority.sort((a,b)=>a[0]-b[0]).map(p=>p[0]+'. '+p[1]).join(', '):null,eqNotes.length?eqNotes.join('\n'):null,book.length?'Book of the Dead: '+book.join('; '):null,notesAfterBook.length?notesAfterBook.join('\n'):null].filter(Boolean).join('\n\n')||null};
  return draftFrom({provider:'mobalytics',url,title,author,updated,classId,season,variants:[variant],warnings});
}

/** Entry point: a saved page's HTML → build draft (same shape as the Maxroll importer). */
export function importSavedGuide(html){
  const {site,url}=detectGuideSite(html);
  if(site==='icy-veins')return parseIcyVeins(html,{url});
  if(site==='mobalytics')return parseMobalytics(html,{url});
  throw new Error('This file isn’t a saved Icy Veins or Mobalytics guide page. Open the guide in your browser and use File → Save Page As.');
}
