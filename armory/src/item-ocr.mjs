// Item tooltip reading from OCR lines (Apple Vision output: normalised boxes, origin bottom-left).
// Keeps only the item tooltip, top to bottom: name, type, item power, stats, affixes, power text and
// sockets. Stops before flavour text, requirements and sell value, and never returns game controls such
// as Equip, Compare, Mark as Junk or Scroll Down. Pure functions shared by the server and the browser.
//
// Real tooltip details handled (from in-game photos):
//  - ranges wrap onto the next line:  "+2,204 Cold Resistance [1,800 -" / "2,274]"
//  - range formats: "+90 Intelligence +[83 - 99]", "x23% ... [13 - 25]%", "59%[x] [50 - 60]%"
//  - sentence affixes: "Your Summons have a 9.7% [7.0 - 10.0]% chance to ..."
//  - flavour text is italic, not quoted, and separated from the power text by a gap

const BUTTONS='equip|unequip|compare|mark as junk|unmark as junk|mark as favou?rite|unmark as favou?rite|favou?rite|junk|salvage|sell|buy|inspect|link item|show details|hide details|close|back|drop|transmog|try on|imprint|enchant|socket|unsocket|repair|split stack|more info|less info|advanced tooltip|show comparison|hide comparison|scroll down|scroll up|scroll';
// Key / controller hints: bracketed keys ("[E]", "[Shift]"), named keys, or button glyphs ("⊗", "△", "□")
const KEY='(?:\\[[a-z0-9 ]{1,8}\\]|\\b(?:lmb|rmb|shift|ctrl|alt|space|esc|tab|enter)\\b|[^\\p{L}\\p{N}\\s\\[\\]+%]{1,2})';
const UI_LINE=new RegExp('^(?:'+KEY+'\\s*)?(?:'+BUTTONS+')(?:\\s*'+KEY+')?$','iu');
const KEY_ONLY=new RegExp('^(?:'+KEY+'\\s*)+$|^[A-Z]$','iu');
const EQUIPPED_HEADER=/^(currently\s+)?equipped$/i;
const STOP_LINE=/^(requires\s+level|level\s+requirement|required\s+level|sell\s+value|durability|account\s+bound|unidentified|cannot\s+be\s+(?:traded|salvaged)|requires\s+(?:class|season)|bound\s+to)/i;
const RARITY_WORDS='common|magic|rare|legendary|unique|mythic|set|ancestral|sacred';
const TYPE_WORDS='helm|chest(?:\\s+armor)?|gloves|pants|boots|amulet|ring|sword|axe|mace|scythe|polearm|staff|wand|dagger|bow|crossbow|focus|totem|shield|glaive|quarterstaff|flail|charm|seal|horadric seal|weapon';
const TYPE_LINE=new RegExp('\\b('+RARITY_WORDS+')\\b.*\\b('+TYPE_WORDS+')\\b','i');
const ITEM_POWER=/\bitem\s+power\b/i;
// "Unique Two-Handed" / "Scythe": the type line can wrap, so a line that opens with a rarity starts it
const RARITY_START=new RegExp('^(?:ancestral\\s+)?(?:'+RARITY_WORDS+')\\b(?!\\s+(?:aspect|power)\\b)','i');
const BULLET=/^[◆◇♦•·▪●○✦✧★☆*]\s*/;
const STAR_BULLET=/^[✦✧★☆*]/;

function rect(l){
  const x=+l.x||0,w=+l.w||0,h=+l.h||0,y=+l.y||0;
  return {left:x,right:x+(w||Math.min(0.5,String(l.text||'').length*0.012)),top:1-(y+(h||0.02)),bottom:1-y,height:h||0.02};
}
// OCR of photos turns tooltip bullets (◆ ✦) and border art into stray symbols or 1-2 letter fragments:
// "| © +90 Intelligence", "oe x23% Critical", "Wy BLOOD MOON", "+ Your Summons" (✦), trailing "|".
const JUNK_TOKEN=/^[^\p{L}\p{N}+\-x×\[\]%]+$/u;
// OCR slips in the words that identify the item ("Unioue Pants", "Legendarv"): fix words one edit away
const VOCAB=['Unique','Legendary','Mythic','Ancestral','Sacred','Magic','Pants','Gloves','Boots','Amulet','Chest','Armor','Scythe','Sword','Staff','Dagger','Shield','Totem','Focus','Glaive','Quarterstaff','Flail','Polearm','Crossbow','Charm','Seal','Horadric','Power','Item'];
function oneEdit(a,b){
  if(Math.abs(a.length-b.length)>1)return false;
  let i=0,j=0,edits=0;
  while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue}if(++edits>1)return false;if(a.length>b.length)i++;else if(b.length>a.length)j++;else{i++;j++}}
  return edits+(a.length-i)+(b.length-j)<=1;
}
export function fixVocabulary(text){
  return String(text||'').replace(/[A-Za-z]{5,}/g,w=>{
    const lw=w.toLowerCase();if(VOCAB.some(v=>v.toLowerCase()===lw))return w;
    const hit=VOCAB.find(v=>v.length>=5&&oneEdit(lw,v.toLowerCase()));
    return hit?(w===w.toUpperCase()?hit.toUpperCase():w[0]===w[0].toUpperCase()?hit:hit.toLowerCase()):w;
  });
}
export function cleanLine(text){
  // "BLO®D MO®N": an O read as ®/©/@ inside a capitalised word
  let t=fixVocabulary(String(text||'').replace(/\s+/g,' ').trim().replace(/(?<=[A-Z])[®©@](?=[A-Z])/g,'O')),star=false;
  for(let guard=0;guard<6;guard++){
    const [first,...rest]=t.split(' '),next=rest[0]||'';
    if(!rest.length)break;
    if(JUNK_TOKEN.test(first)){if(/[✦✧★☆*]/.test(first))star=true;t=rest.join(' ');continue}
    if(/^[A-Za-z]{1,2}$/.test(first)&&first.toLowerCase()!=='x'&&(/^[+x×-]?\d/.test(next)||!/[a-z]/.test(next)&&(next.match(/[A-Z]/g)||[]).length>=3||JUNK_TOKEN.test(next))){t=rest.join(' ');continue}
    if(first==='+'&&/^[+x×-]?\d/.test(next)){t=rest.join(' ');continue}   // bullet read as a lone "+" before "+90"
    break;
  }
  if(/^\+\s+[A-Za-z]/.test(t)){t=t.replace(/^\+\s+/,'');star=true}       // ✦ read as "+"
  t=t.replace(/(\s+[^\p{L}\p{N}\]%.)\-–\[]{1,3})+$/u,'').trim();          // trailing border / bullet junk (keeps "[1,800 -")
  return star?'✦ '+t:t;
}
export function isInterfaceLine(text){
  const t=String(text||'').trim();
  return !t||UI_LINE.test(t)||KEY_ONLY.test(t);
}

// Side-by-side tooltips and panels: group lines whose horizontal ranges overlap.
function columns(lines){
  const groups=[];
  for(const line of lines){
    const r=line.r,hit=groups.filter(g=>r.left<g.right-0.01&&r.right>g.left+0.01);
    if(!hit.length){groups.push({left:r.left,right:r.right,lines:[line]});continue}
    const merged=hit[0];
    for(const g of hit.slice(1)){merged.lines.push(...g.lines);merged.left=Math.min(merged.left,g.left);merged.right=Math.max(merged.right,g.right);groups.splice(groups.indexOf(g),1)}
    merged.lines.push(line);merged.left=Math.min(merged.left,r.left);merged.right=Math.max(merged.right,r.right);
  }
  return groups.map(g=>({...g,lines:g.lines.sort((a,b)=>a.r.top-b.r.top||a.r.left-b.r.left)}));
}
const hasDigit=t=>/\d/.test(t);
const affixLike=t=>/^[+x×-]?\s*[\d,.]+\s*%?/.test(t.replace(BULLET,''))||ITEM_POWER.test(t)||TYPE_LINE.test(t);

// Split lines into paragraphs using vertical gaps (a gap larger than ~0.9 line heights).
function paragraphs(lines){
  if(!lines.length)return [];
  const median=a=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor(s.length/2)]};
  const lh=median(lines.map(l=>l.r.height))||0.02;
  const gaps=lines.slice(1).map((l,i)=>Math.max(0,l.r.top-lines[i].r.bottom));
  const typical=gaps.length?median(gaps):lh*0.3;
  // Paragraph spacing in tooltips is only slightly larger than line spacing, so compare with the typical gap.
  const threshold=Math.max(typical*2.2,typical+lh*0.4);
  const out=[[lines[0]]];
  for(let i=1;i<lines.length;i++){
    if(gaps[i-1]>threshold)out.push([lines[i]]);else out.at(-1).push(lines[i]);
  }
  return out;
}

/**
 * @param {Array<{text,x,y,w,h,confidence}>} rawLines OCR lines
 * @returns {{lines, text, bbox, columns, skipped, equippedText}}
 */
export function extractTooltip(rawLines){
  const all=(rawLines||[]).map(l=>({...l,ocrText:String(l?.text||'').trim(),text:cleanLine(l?.text),r:rect(l)})).filter(l=>l.text&&/[\p{L}\p{N}]/u.test(l.text)&&!/^\d{1,2}$/.test(l.text));
  const skipped=[];
  const usable=all.filter(l=>{if(isInterfaceLine(l.text)){skipped.push({text:l.text,reason:'game control'});return false}return true});
  const cols=columns(usable);
  const scored=cols.map(c=>({c,equipped:c.lines.slice(0,4).some(l=>EQUIPPED_HEADER.test(l.text)),hasType:c.lines.some(l=>TYPE_LINE.test(l.text)),score:c.lines.filter(l=>affixLike(l.text)).length}));
  scored.sort((a,b)=>(b.hasType-a.hasType)||(a.equipped-b.equipped)||(b.score-a.score));
  const chosen=scored[0]?.c||{lines:[]};
  for(const s of scored.slice(1))if(s.c!==chosen)for(const l of s.c.lines)skipped.push({text:l.text,reason:s.equipped?'equipped item (compare view)':'outside the item tooltip'});
  const equippedCol=scored.find(s=>s.equipped&&s.c!==chosen)?.c||null;
  let lines=chosen.lines.filter(l=>!EQUIPPED_HEADER.test(l.text));
  const isTypeLine=(l,i,arr)=>TYPE_LINE.test(l.text)||RARITY_START.test(l.text)&&arr[i+1]&&TYPE_LINE.test(l.text+' '+arr[i+1].text);
  const anchor=lines.find(isTypeLine);
  if(anchor){
    const width=Math.max(0.2,...lines.map(l=>l.r.right-l.r.left));
    lines=lines.filter(l=>{const ok=l.r.left<=anchor.r.left+width*0.55&&l.r.right>=anchor.r.left-width*0.1;if(!ok)skipped.push({text:l.text,reason:'outside the item tooltip'});return ok});
  }
  // Start at the item name: the line(s) just above the rarity/type line
  const typeIndex=lines.findIndex(isTypeLine);
  if(typeIndex>0){
    let start=typeIndex-1;
    const above=lines[start-1];
    if(above&&!hasDigit(above.text)&&lines[start].r.top-above.r.bottom<lines[start].r.height*1.2&&!/[a-z]/.test(above.text)&&(above.text.match(/[A-Z]/g)||[]).length>=3)start--;   // two-line names (OCR may turn a letter into a symbol)
    for(const l of lines.slice(0,start))skipped.push({text:l.text,reason:'above the item'});
    lines=lines.slice(start);
  }
  // End at requirements / sell value, or at the first paragraph without numbers after the stats
  // (italic flavour text). Socket lines are kept.
  let end=lines.length;
  const stopAt=lines.findIndex((l,i)=>i>0&&STOP_LINE.test(l.text));
  if(stopAt>0)end=stopAt;
  const paras=paragraphs(lines.slice(0,end));
  let seenStats=false,count=0;
  for(const p of paras){
    const text=p.map(l=>l.text).join(' ');
    if(seenStats&&!hasDigit(text)&&!/socket/i.test(text)&&!/^(?:legendary|unique|mythic)?\s*aspect/i.test(text)){end=count;break}
    if(p.some(l=>affixLike(l.text)))seenStats=true;
    count+=p.length;
  }
  // Uniques: italic flavour text can sit as close as a normal line. After the line that ends the power
  // sentence, a tail with no numbers at all is flavour text.
  if(/\b(unique|mythic)\b/i.test(anchor?.text||'')){
    let lastDigit=-1;
    for(let i=0;i<end;i++)if(hasDigit(lines[i].text))lastDigit=i;
    const sentenceEnd=lines.findIndex((l,i)=>i>=lastDigit&&i<end&&/[.!]["”’']?$/.test(l.text));
    if(lastDigit>=0&&sentenceEnd>=0&&sentenceEnd<end-1&&!lines.slice(sentenceEnd+1,end).some(l=>hasDigit(l.text)&&!/^empty socket/i.test(l.text)))end=sentenceEnd+1;
  }
  for(const l of lines.slice(end))skipped.push({text:l.text,reason:'flavour text / requirements'});
  lines=lines.slice(0,end);
  let bbox=null;
  if(lines.length){
    // Right edge: ignore a single line that ran into a neighbouring panel
    const rights=lines.map(l=>l.r.right).sort((a,b)=>a-b),right=lines.length>4?rights[Math.floor(0.85*(rights.length-1))]:rights.at(-1);
    const r={left:Math.min(...lines.map(l=>l.r.left)),right,top:Math.min(...lines.map(l=>l.r.top)),bottom:Math.max(...lines.map(l=>l.r.bottom))};
    const padX=Math.max(0.015,(r.right-r.left)*0.08),padY=Math.max(0.01,(r.bottom-r.top)*0.02);
    bbox={left:Math.max(0,r.left-padX),top:Math.max(0,r.top-padY),right:Math.min(1,r.right+padX),bottom:Math.min(1,r.bottom+padY)};
  }
  // Mark paragraph starts so the parser can tell stats from the power text
  const paraStarts=new Set(paragraphs(lines).map(p=>p[0]));
  const clean=lines.map(l=>{const {r,...rest}=l;return {...rest,paragraphStart:paraStarts.has(l)}});
  return {lines:clean,text:clean.map(l=>(l.paragraphStart&&l!==clean[0]?'\n':'')+l.text).join('\n'),bbox,columns:cols.length,skipped,equippedText:equippedCol?equippedCol.lines.map(l=>l.text).join('\n'):null};
}

// ---------------------------------------------------------------- tooltip parsing
const RARITIES=['Mythic','Unique','Legendary','Rare','Magic','Common','Set'];
const num=s=>s==null||s===''?null:Number(String(s).replace(/,/g,''));
const STAT_LINE=/^[\d,]+(?:\.\d+)?\s+(armor|damage per second|attacks per second|damage per hit|block chance)\b|^(armor|damage per second|attacks per second)\b|\]\s*damage per hit\b|\b(?:damage per second|attacks per second)\b/i;
const NUMBER_RE=/([+x×-]?)\s*([\d,]+(?:\.\d+)?)\s*(%)?\s*(\[[x×+]\])?/;
const RANGE_RE=/\+?\[\s*([\d,]+(?:\.\d+)?)\s*%?\s*[-–]\s*([\d,]+(?:\.\d+)?)\s*\]\s*%?/;
// Fixed affixes show a single value instead of a range: "+35.0% Attack Speed [35.0]%", "+30 Essence Regeneration +[30]"
const FIXED_RE=/\+?\[\s*([\d,]+(?:\.\d+)?)\s*%?\s*\]\s*%?/;

/**
 * Tesseract misreads tooltip brackets: "]" as ")" or "1" ("[35.01%" for "[35.0]%"), and drops a "[" ("+250 - 298)").
 * Tooltip numbers have at most one decimal, so a second decimal digit before "%" inside a bracket is the "]".
 */
export function repairBrackets(text){
  let t=String(text||'');
  t=t.replace(/\[([^\[\]]*?\d)\s*\)/g,'[$1]');                                   // [168 - 281) -> [168 - 281]
  t=t.replace(/\[([^\[\]]*?\d+\.\d)1\s*%/g,'[$1]%');                            // [35.01% -> [35.0]%
  t=t.replace(/(^|\s)\+?([\d,]+(?:\.\d+)?\s*[-–]\s*[\d,]+(?:\.\d+)?)\s*[\])](\s*%?)/g,(m,a,r,pc)=>a+'['+r+']'+pc);  // +250 - 298) -> [250 - 298]
  return t;
}

/** Read the first value, its unit and its [min - max] range from an affix or power sentence. */
export function readValue(text){
  const t=repairBrackets(text);
  const m=t.match(NUMBER_RE);if(!m)return {value:null,unit:null,min:null,max:null,name:t.trim()};
  const range=t.match(RANGE_RE)||(()=>{const f=t.match(FIXED_RE);return f?[f[0],f[1],f[1]]:null})();
  const multiplier=m[1]==='x'||m[1]==='×'||/\[[x×]\]/.test(m[4]||'');
  const unit=m[3]||(range&&/%/.test(range[0]))?(multiplier?'%[x]':'%'):'flat';
  let name=t.replace(RANGE_RE,' ').replace(FIXED_RE,' ').replace(NUMBER_RE,' # ');
  name=name.replace(/\s+/g,' ').trim();
  // Plain stat affixes ("# Intelligence", "# to Blood Skills") become the stat name; sentences keep a # marker
  const simple=name.match(/^#\s*(?:to\s+)?(.+)$/i);
  if(simple)name=simple[1];
  name=name.replace(/\s*\[[x×+]\]\s*/g,' ').replace(/\s+/g,' ').replace(/\s+([.,])/g,'$1').trim();
  return {value:num(m[2]),unit,min:range?num(range[1]):null,max:range?num(range[2]):null,name};
}

/** Parse a tooltip (text with optional blank lines between paragraphs) into an item record for review. */
export function parseTooltip(text,{slot=null}={}){
  const rawLines=String(text||'').split(/\r?\n/);
  // Re-join entries: a new entry starts with a bullet, a number, a known header, or after a blank line.
  const entries=[];let paragraph=0,pendingBreak=false;
  for(const raw of rawLines){
    const line=raw.trim()?cleanLine(raw):'';
    if(!line){pendingBreak=true;continue}
    if(isInterfaceLine(line))continue;
    const bullet=BULLET.test(line),star=STAR_BULLET.test(line),body=repairBrackets(line.replace(BULLET,''));
    const prev=entries.at(-1);
    const unbalanced=prev&&(prev.text.split('[').length>prev.text.split(/[\])]/).length||/[-–]\s*$/.test(prev.text));
    if(unbalanced&&pendingBreak&&/^[\d,.\s]+[\])]?\s*%?$|^\[[\d,.\s–-]+[\])1]?\s*%?$/.test(body))pendingBreak=false;   // "281]" or "[16.0 - 46.0]%" after a blank line
    // "+3,000 Maximum Life" followed by "You gain 22% ..." -> the sentence is new; "Multiplier [13 - 25]%" is a tail
    const prevSimpleStat=prev&&!unbalanced&&/^[+x×-]?\s*[\d,.]+/.test(prev.text)&&prev.text.split(/\s+/).length<=8&&!/[.!]$/.test(prev.text);
    const sentenceStart=/^[A-Z][a-z]+\s+\S+\s+\S+/.test(body)&&!RANGE_RE.test(body);
    const startsNew=!prev||pendingBreak||bullet||TYPE_LINE.test(body)||(RARITY_START.test(body)&&!entries.some(e=>TYPE_LINE.test(e.text)||RARITY_START.test(e.text)))||ITEM_POWER.test(body)||STAT_LINE.test(body)||/^empty socket/i.test(body)||(/^[+x×]?\s*\d/.test(body)&&!unbalanced&&!/^\d[\d,.]*\s*\]/.test(body))||(prevSimpleStat&&sentenceStart);
    if(pendingBreak){paragraph++;pendingBreak=false}
    if(startsNew)entries.push({text:body,bullet,star,paragraph});
    else prev.text=repairBrackets((prev.text+' '+body).replace(/\s+/g,' ').replace(/\[\s+/g,'[').replace(/\s+\]/g,']'));
  }
  let typeIndex=entries.findIndex(e=>TYPE_LINE.test(e.text));
  if(typeIndex<0)typeIndex=entries.findIndex((e,i)=>i>0&&i<4&&RARITY_START.test(e.text));
  // typeIndex 0: the name wasn't read (decorative title fonts often defeat OCR); the catalog can still identify the item
  const nameParts=typeIndex>0?entries.slice(0,typeIndex).map(e=>e.text):typeIndex===0?[]:[entries[0]?.text||''];
  const name=nameParts.join(' ').replace(/\s+/g,' ').trim()||'Unidentified item';
  const typeLine=typeIndex>=0?entries[typeIndex].text:'';
  const rarity=RARITIES.find(r=>new RegExp('\\b'+r+'\\b','i').test(typeLine))||'Unknown';
  const itemType=typeLine.replace(new RegExp('\\b('+RARITY_WORDS+')\\b','gi'),'').replace(/\s+/g,' ').trim()||null;
  const item={name:titleCase(name),rarity,itemType,ancestral:/\bancestral\b/i.test(typeLine),slot:slot||slotFromType(itemType),itemPower:null,affixes:[],sockets:[],stats:{},power:null,rawText:String(text||'')};
  const body=entries.slice(typeIndex>=0?typeIndex+1:1);
  // The affix list is the paragraph with the bullets/numbers; the power text is the next paragraph.
  let affixParagraph=null;const powerEntries=[];
  for(const e of body){
    const ip=e.text.match(/([\d,]+)\s*(?:\+\s*([\d,]+)\s*)?item\s+power/i)||e.text.match(/item\s+power\s*:?\s*([\d,]+)/i);
    if(ip){item.itemPower=num(ip[1])+(ip[2]?num(ip[2]):0);continue}
    if(/^empty socket/i.test(e.text)){item.sockets.push({name:'Empty socket',empty:true});continue}
    if(STAT_LINE.test(e.text)){const k=e.text.match(/(armor|damage per second|attacks per second|damage per hit|block chance)/i)[1].toLowerCase();item.stats[k]=num(e.text.match(/[\d,]+(?:\.\d+)?/)?.[0]);continue}
    const isAffix=(e.bullet||/^[+x×-]?\s*\d/.test(e.text))&&(affixParagraph==null||e.paragraph===affixParagraph||!/[.!]$/.test(e.text)&&e.text.split(/\s+/).length<=9);
    if(!item.affixes.length&&!powerEntries.length&&!/\d/.test(e.text)&&e.text.split(/\s+/).length<=2&&!e.bullet){item.label??=e.text;continue}   // runeword recipe and similar labels
    if(isAffix&&!powerEntries.length){
      affixParagraph??=e.paragraph;
      const v=readValue(e.text);
      item.affixes.push({name:v.name,value:v.value,unit:v.unit,min:v.min,max:v.max,kind:'base',greaterAffix:false,starBullet:e.star||undefined,sourceText:e.text});
    }else powerEntries.push(e);
  }
  if(powerEntries.length){
    const description=powerEntries.map(e=>e.text).join(' ').replace(/\s+/g,' ').trim();
    const v=readValue(description);
    item.power={name:rarity==='Unique'||rarity==='Mythic'?item.name:null,description,value:v.value,unit:v.unit,min:v.min,max:v.max};
  }
  // Tempered affixes look like base affixes in the tooltip. A repeated stat name is most likely the temper.
  const seen=new Set();
  for(const a of item.affixes){const k=a.name.toLowerCase();if(seen.has(k)){a.kind='temper';a.kindGuess=true}seen.add(k)}
  return item;
}
function titleCase(s){return /[a-z]/.test(s)?s:s.toLowerCase().replace(/\b([a-z])/g,c=>c.toUpperCase()).replace(/'S\b/g,"'s")}

const TYPE_SLOTS=[[/helm/i,'helm'],[/chest/i,'chest'],[/gloves/i,'gloves'],[/pants/i,'pants'],[/boots/i,'boots'],[/amulet/i,'amulet'],[/ring/i,'ring1'],[/charm/i,'charm1'],[/seal/i,'seal'],[/shield|focus|totem/i,'offhand'],[/sword|axe|mace|scythe|polearm|staff|wand|dagger|bow|crossbow|glaive|quarterstaff|flail/i,'weapon']];
export function slotFromType(type){return (TYPE_SLOTS.find(([re])=>re.test(type||''))||[])[1]||null}

/** Word-overlap similarity (0-1) between two power descriptions, ignoring numbers. */
export function textSimilarity(a,b){
  const words=s=>new Set(String(s||'').toLowerCase().replace(/[\d.,%+x×\[\]#]/g,' ').split(/[^a-z']+/).filter(w=>w.length>2));
  const A=words(a),B=words(b);if(!A.size||!B.size)return 0;
  let common=0;for(const w of A)if(B.has(w))common++;
  return (2*common)/(A.size+B.size);
}
