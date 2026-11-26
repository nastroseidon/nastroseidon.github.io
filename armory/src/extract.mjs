const classNames=['barbarian','druid','necromancer','rogue','sorcerer','spiritborn','paladin','warlock'];
const slotAliases={
  helm:'helm',helmet:'helm',head:'helm',chest:'chest',gloves:'gloves',pants:'pants',
  boots:'boots',weapon:'weapon',mainhand:'weapon',offhand:'offhand',
  amulet:'amulet',necklace:'amulet',ring:'ring1','ring 1':'ring1','ring 2':'ring2',
  seal:'seal',charm:'charms',charms:'charms'
};
export function parseGuideText(text,sourceUrl=null){
  const lines=String(text||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const head=lines.slice(0,12).join(' ');
  const classId=classNames.find(c=>new RegExp('\\b'+c+'\\b','i').test(head))||null;
  const season=head.match(/\bseason\s*(\d+)\b/i)?.[1]||null;
  const patch=head.match(/\bpatch\s*(\d+\.\d+(?:\.\d+)?)\b/i)?.[1]||null;
  const phaseHeaders=lines.map((line,index)=>({index,name:line.replace(/^#+\s*/,'').replace(/^variant\s*:?\s*/i,'').trim()})).filter(x=>/^(starter|midgame|endgame|push)$/i.test(x.name));
  if(phaseHeaders.length){
    const variants=phaseHeaders.map((header,index)=>{
      const chunk=lines.slice(header.index+1,phaseHeaders[index+1]?.index??lines.length).join('\n');
      const parsed=parseGuideText(chunk,sourceUrl),name=header.name[0].toUpperCase()+header.name.slice(1).toLowerCase();
      return {...parsed,id:name.toLowerCase(),name,order:index,sourceUrl,sourceStatus:'extracted — review',coverage:Object.fromEntries(['gear','skills','paragon','mercenaries','warplans','primeEvilPowers'].map(section=>[section,section==='gear'&&Object.keys(parsed.slots).length?'provisional':parsed[section]?.text?'provisional':'unknown']))};
    });
    return {title:lines[0],classId,season,patch,author:lines.find(l=>/^author\s*:/i.test(l))?.replace(/^author\s*:\s*/i,'')||null,slots:{},variants,activeVariantId:variants[0].id,stages:variants.map(v=>v.name.toLowerCase()),sourceUrl,rawText:String(text||''),confidence:'needs_review'};
  }
  const slots={};
  for(const line of lines){
    const match=line.match(/^([A-Za-z ]{3,18})\s*:\s*(.+)$/);
    if(!match)continue;
    const slot=slotAliases[match[1].trim().toLowerCase()];
    if(slot)slots[slot]={name:match[2].trim(),sourceStatus:'extracted — review',rawLine:line};
  }
  const headings={'war plans':'warplans',warplans:'warplans','prime evil powers':'primeEvilPowers',skills:'skills','skill tree':'skills','skill rotation':'rotation',rotation:'rotation',paragon:'paragon','paragon boards':'paragon',glyphs:'glyphs',mercenaries:'mercenaries',runewords:'runewords',runes:'runes',gems:'gems','class mechanic':'classMechanics','class mechanics':'classMechanics','seasonal mechanics':'seasonalMechanics','stat targets':'stats',farming:'farming',acquisition:'farming',tempering:'tempering',masterworking:'masterworking','greater affixes':'greaterAffixes','build variants':'variantsText'};
  const sections={};let current=null;
  for(const line of lines){
    const key=headings[line.replace(/^#+\s*/,'').replace(/:$/,'').toLowerCase()];
    if(key){current=key;sections[key]??={text:'',sourceStatus:'extracted — review'};continue}
    if(current)sections[current].text+=(sections[current].text?'\n':'')+line;
  }
  const author=lines.find(l=>/^author\s*:/i.test(l))?.replace(/^author\s*:\s*/i,'')||null;
  const stages=[...new Set((head.match(/\b(leveling|starter|midgame|endgame|push)\b/gi)||[]).map(x=>x.toLowerCase()))];
  return {title:lines[0]||'Untitled build',classId,author,season,patch,slots,stages,...sections,sourceUrl,rawText:String(text||''),confidence:'needs_review'};
}
export function parseItemText(text,slot=null){
  const rawText=String(text||'');
  const lines=rawText.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const first=lines[0]||'';
  const name=/^item power\b/i.test(first)||/^\+?[\d,]+(?:\.\d+)?%?\s/.test(first)?'Unidentified item':first||'Unidentified item';
  const itemPower=Number(rawText.match(/\bItem Power\s*([\d,]+)/i)?.[1]?.replaceAll(',',''))||null;
  const affixes=[];
  for(const line of lines){
    const match=line.match(/^\+?([\d,]+(?:\.\d+)?)(%)?\s+(.+?)(?:\s+\[([\d,]+(?:\.\d+)?)\s*[-–]\s*([\d,]+(?:\.\d+)?)\])?$/);
    if(!match)continue;
    const value=Number(match[1].replaceAll(',',''));
    const min=match[4] ? Number(match[4].replaceAll(',', '')) : null;
    const max=match[5] ? Number(match[5].replaceAll(',', '')) : null;
    affixes.push({name:match[3],value,min,max,unit:match[2]||null,kind:'unknown',confidence:'review',sourceText:line});
  }
  return {name,slot,itemPower,affixes,rawText,confidence:'needs_review',sourceStatus:'OCR candidate — user review required'};
}
