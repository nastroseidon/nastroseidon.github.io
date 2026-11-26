// Build-fit grading for a scanned item: 0-100 against the active variant's target for that slot,
// a comparison with the equipped item, and an improvement plan per crafting station.
// Pure functions (browser + Node). This is a build-fit checklist score, not a damage calculation.
import {textSimilarity} from './item-ocr.mjs';

// ---------------------------------------------------------------- affix name matching
const SYNONYMS=[
  [/^resistance to all elements$/,'all resistance'],[/^all resist(ance)?s?$/,'all resistance'],
  [/^maximum evade charges?$/,'evade charges'],[/^evade charges?$/,'evade charges'],
  [/^maximum life %?$/,'maximum life'],[/^life$/,'maximum life'],
  [/^crit(ical)? strike chance$/,'critical strike chance'],
  [/^crit(ical)? strike damage( multiplier)?$/,'critical strike damage multiplier'],
  [/^vulnerable damage( multiplier)?$/,'vulnerable damage multiplier'],
  [/^(essence|resource) regeneration( \/ second| per second)?$/,'resource regeneration'],
  [/^resource regeneration \/ second$/,'resource regeneration'],
];
export function affixKey(name){
  let k=String(name||'').toLowerCase().replace(/\[[x+×]\]/g,' ').replace(/[#%+:]/g,' ').replace(/^to\s+/,'').replace(/\s+/g,' ').trim();
  for(const [re,to] of SYNONYMS)if(re.test(k)){k=to;break}
  return k;
}
export function affixNameMatch(a,b){
  const x=affixKey(a),y=affixKey(b);
  if(!x||!y)return false;
  if(x===y)return true;
  const short=x.length<y.length?x:y,long=x.length<y.length?y:x;
  return short.split(' ').length>=2&&long.includes(short);
}
const ASSUMED_NEW_ROLL=0.75; // quality assumed for an affix added by crafting (average roll)
const parseNumber=v=>{if(v==null||v==='')return null;const m=String(v).replace(/,/g,'').match(/-?\d+(?:\.\d+)?/);return m?Number(m[0]):null};

/** Quality (0-1) of an affix roll: own [min-max] range when known, else vs the guide's value. */
export function affixQuality(affix,targetAffix){
  if(affix?.assumed)return {q:ASSUMED_NEW_ROLL,basis:'estimate: average roll after crafting'};
  const v=parseNumber(affix?.value);
  if(v==null)return {q:0.8,basis:'value not read'};
  const min=parseNumber(affix.min),max=parseNumber(affix.max);
  if(min!=null&&max!=null&&max>min){const r=Math.max(0,Math.min(1,(v-min)/(max-min)));return {q:0.6+0.4*r,basis:Math.round(r*100)+'% of its roll range',roll:r}}
  const ideal=parseNumber(targetAffix?.idealValue);
  if(ideal){const r=Math.max(0,Math.min(1,v/ideal));return {q:Math.max(0.3,r),basis:Math.round(r*100)+'% of the guide value ('+targetAffix.idealValue+')'}}
  return {q:0.8,basis:'no range or guide value to compare'};
}

// ---------------------------------------------------------------- target helpers
const primaryTargets=t=>(t?.affixes||[]).filter(a=>a.primary!==false&&a.alternative!==true);
const alternativeTargets=t=>(t?.affixes||[]).filter(a=>a.primary===false||a.alternative===true);
const temperTargets=t=>t?.tempers?.length?t.tempers.map(x=>({name:x.name,recipe:x.recipe||null})):t?.temper?String(t.temper).split('/').map(s=>({name:s.trim(),recipe:null})).filter(x=>x.name):[];
const gaTargets=t=>t?.greaterAffixPriority?.length?t.greaterAffixPriority:t?.greaterAffixTargets||[];
const uniqueTarget=t=>Boolean(t&&(t.identityRequired===true||/^(unique|mythic)$/i.test(t.rarity||'')));
const sameItemName=(a,b)=>String(a||'').trim().toLowerCase()===String(b||'').trim().toLowerCase();

/** Does the item's power match the target aspect / unique power? */
export function aspectMatch(item,target){
  if(!target)return {matched:false,similarity:0};
  if(target.aspect&&sameItemName(item?.power?.name,target.aspect))return {matched:true,similarity:1,by:'name'};
  const desc=item?.power?.description||'';
  const ref=target.aspectText||target.uniquePower||'';
  const sim=desc&&ref?textSimilarity(desc,ref):0;
  return {matched:sim>=0.55,similarity:sim,by:sim?'text':null};
}

// ---------------------------------------------------------------- scoring
/**
 * @param item   {name, rarity, itemPower, affixes:[{name,value,min,max,kind,greaterAffix}], power:{name,description,value,min,max}}
 * @param target build target for the slot (Maxroll import or manual)
 * @returns {score, components[], affixRows[], aspect, identity}
 */
export function gradeItem(item,target){
  if(!item)return null;
  if(!target)return {score:null,components:[],affixRows:[],note:'The active build has no target for this slot.'};
  const comps=[];
  const isUniqueTarget=uniqueTarget(target);
  let identity=null;
  if(isUniqueTarget){
    identity={matched:sameItemName(item.name,target.name),wanted:target.name};
    comps.push({key:'identity',label:'Correct unique',max:30,points:identity.matched?30:0,detail:identity.matched?'This is the guide’s '+target.name+'.':'The guide uses '+target.name+' here. '+(item.name||'This item')+' is a different item and can’t be crafted into it.'});
  }
  let aspect=null;
  if(!isUniqueTarget&&target.aspect){
    aspect=aspectMatch(item,target);
    const pv=item.power,range=pv&&parseNumber(pv.min)!=null&&parseNumber(pv.max)!=null&&parseNumber(pv.max)>parseNumber(pv.min);
    const roll=range?Math.max(0,Math.min(1,(parseNumber(pv.value)-parseNumber(pv.min))/(parseNumber(pv.max)-parseNumber(pv.min)))):null;
    const q=aspect.matched?(pv?.assumed?0.85:roll!=null?0.7+0.3*roll:1):0;
    comps.push({key:'aspect',label:'Aspect',max:25,points:25*q,detail:aspect.matched?target.aspect+(roll!=null?' · '+Math.round(roll*100)+'% of its range':''):'Needs '+target.aspect+(item.power?.description?' (this item has a different power)':' (no power text read)')});
  }
  // Affixes (base + implicit), weighted by the target's colour bands
  const itemAffixes=(item.affixes||[]).filter(a=>a.kind!=='temper');
  const used=new Set(),rows=[];
  let earned=0,total=0;
  for(const t of primaryTargets(target)){
    const w=Number(t.weight)||1;total+=w;
    const found=itemAffixes.find((a,i)=>!used.has(i)&&affixNameMatch(a.name,t.name)&&(used.add(i),true));
    if(found){const q=affixQuality(found,t);earned+=w*q.q;rows.push({target:t,item:found,status:'present',quality:q})}
    else rows.push({target:t,item:null,status:'missing'});
  }
  // An alternative the guide lists can stand in for a missing primary at half credit
  for(const t of alternativeTargets(target)){
    const i=itemAffixes.findIndex((a,ix)=>!used.has(ix)&&affixNameMatch(a.name,t.name));
    if(i>=0){used.add(i);const missing=rows.find(r=>r.status==='missing'&&!r.substitute);if(missing){earned+=0.5*(Number(missing.target.weight)||1)*affixQuality(itemAffixes[i],t).q;missing.substitute=itemAffixes[i]}rows.push({target:t,item:itemAffixes[i],status:'alternative',quality:affixQuality(itemAffixes[i],t)})}
  }
  const extras=itemAffixes.filter((a,i)=>!used.has(i));
  for(const a of extras)rows.push({target:null,item:a,status:'not in guide'});
  if(total)comps.push({key:'affixes',label:'Target affixes & rolls',max:40,points:40*earned/total,detail:rows.filter(r=>r.status==='present').length+' of '+primaryTargets(target).length+' target affixes'});
  // Greater Affixes the guide wants
  const gas=gaTargets(target);
  if(gas.length){
    const hit=gas.filter(n=>(item.affixes||[]).some(a=>a.greaterAffix&&affixNameMatch(a.name,n))).length;
    comps.push({key:'greater',label:'Greater Affixes',max:10,points:10*hit/gas.length,detail:hit+' of '+gas.length+' wanted ('+gas.join(', ')+')'});
  }
  // Tempers
  const tempers=temperTargets(target);
  if(tempers.length){
    const have=(item.affixes||[]).filter(a=>a.kind==='temper');
    const hit=tempers.filter(t=>have.some(a=>affixNameMatch(a.name,t.name))).length;
    comps.push({key:'tempers',label:'Tempers',max:10,points:10*hit/tempers.length,detail:hit+' of '+tempers.length+' ('+tempers.map(t=>t.name).join(', ')+')'});
  }
  const tip=parseNumber(target.itemPower),ip=parseNumber(item.itemPower);
  if(tip&&ip)comps.push({key:'power',label:'Item power',max:5,points:5*Math.min(1,ip/tip),detail:ip+' of '+tip});
  const max=comps.reduce((s,c)=>s+c.max,0),pts=comps.reduce((s,c)=>s+c.points,0);
  return {score:max?Math.round(100*pts/max):null,components:comps.map(c=>({...c,points:Math.round(c.points*10)/10})),affixRows:rows,aspect,identity,extras};
}

// ---------------------------------------------------------------- improvement plan

/**
 * Station-by-station steps that move the item toward the target, with the score they would add.
 * ctx: {codex:[{name,unlocked}], craftingRules:[{station,description,status,url}]}
 */
export function improvementPlan(item,target,grade,ctx={}){
  const steps=[];
  if(!target||!grade||grade.score==null)return {steps,potential:null};
  const sim=structuredClone(item);
  const wrongUnique=grade.identity&&!grade.identity.matched;
  if(wrongUnique){
    steps.push({station:'Drops',action:'Find '+target.name,detail:'The guide uses '+target.name+' in this slot. Crafting can’t turn '+(item.name||'this item')+' into it, so upgrading this item isn’t worth materials for this build. It may suit another build or character (see below).',scored:false});
    return {steps,potential:grade.score};
  }
  // Occultist: enchant one affix (an item keeps one enchanted affix; only that one can be re-enchanted)
  const missing=grade.affixRows.filter(r=>r.status==='missing'&&!r.substitute).sort((a,b)=>(Number(b.target.weight)||1)-(Number(a.target.weight)||1));
  if(missing.length&&!/mythic/i.test(item.rarity||'')){
    const enchanted=(item.affixes||[]).find(a=>a.enchanted);
    const replace=enchanted||grade.extras.filter(a=>a.kind!=='temper')[0]||null;
    if(replace){
      const want=missing[0].target;
      const idx=sim.affixes.findIndex(a=>a.name===replace.name&&a.value===replace.value);
      if(idx>=0)sim.affixes[idx]={name:want.name,value:null,kind:'base',enchanted:true,assumed:true};
      steps.push({station:'Occultist',action:'Enchant '+replace.name+' → '+want.name,detail:(enchanted?'This item’s enchanted affix is '+enchanted.name+'; only it can be changed. ':'Replace the affix the guide doesn’t use. ')+'The new roll is random; the estimate assumes an average roll.',scored:true});
    }else steps.push({station:'Occultist',action:'Enchant toward '+missing[0].target.name,detail:'Every affix on this item is already one the guide uses, so enchanting would trade one target affix for another.',scored:false});
  }
  // Occultist: imprint the guide's aspect on a legendary
  if(grade.aspect&&!grade.aspect.matched&&!/unique|mythic/i.test(item.rarity||'')){
    const entry=(ctx.codex||[]).find(c=>sameItemName(c.name,target.aspect));
    sim.power={name:target.aspect,description:target.aspectText||'',assumed:true};
    steps.push({station:'Occultist',action:'Imprint '+target.aspect,detail:entry?(entry.unlocked?'Unlocked in your Codex of Power'+(entry.actualRoll!=null?' (your best roll: '+entry.actualRoll+'%)':'')+'.':'Recorded in your Codex but not marked unlocked.'):'Not recorded in your Codex of Power yet.',scored:true});
  }
  // Blacksmith: tempers the guide uses
  const tempers=temperTargets(target),haveTemper=(item.affixes||[]).filter(a=>a.kind==='temper');
  for(const t of tempers.filter(t=>!haveTemper.some(a=>affixNameMatch(a.name,t.name)))){
    sim.affixes=[...(sim.affixes||[]),{name:t.name,value:null,kind:'temper',assumed:true}];
    steps.push({station:'Blacksmith',action:'Temper '+t.name,detail:(t.recipe?'Recipe: '+t.recipe+'. ':'')+(haveTemper.length>=2?'This item already shows two tempers; check it still has temper charges.':'Tempering rolls are random within the recipe.'),scored:true});
  }
  // Blacksmith: masterwork capstone
  const mw=(target.masterworkPriority||[]).filter(n=>(item.affixes||[]).some(a=>affixNameMatch(a.name,n)));
  if(mw.length||target.masterworkPriority?.length){
    const rule=(ctx.craftingRules||[]).find(r=>/blacksmith/i.test(r.station||'')&&/capstone|quality/i.test(r.description||''));
    steps.push({station:'Blacksmith',action:'Masterwork'+(mw.length?' and aim the capstone at '+mw.join(' / '):''),detail:(mw.length?'':'The guide’s masterwork affix ('+target.masterworkPriority.join(', ')+') isn’t on this item. ')+(rule?rule.description:'Masterworking raises affix values.')+' Not included in the score (it raises values, not affix choice).',scored:false});
  }
  // Jeweler: sockets, gems and runes from the guide
  const want=(target.sockets||[]).map(s=>s.name).filter(Boolean),have=(item.sockets||[]);
  if(want.length){
    const empty=have.filter(s=>s.empty).length;
    steps.push({station:'Jeweler',action:'Sockets: '+want.join(' + '),detail:(have.length?have.length+' socket'+(have.length>1?'s':'')+' read on this item'+(empty?' ('+empty+' empty)':'')+'. ':'No sockets read on this item. ')+(have.length<want.length?'Add sockets if this item type allows it, then ':'')+'socket what the guide uses.',scored:false});
  }
  // Greater Affixes cannot be crafted
  const gas=gaTargets(target).filter(n=>!(item.affixes||[]).some(a=>a.greaterAffix&&affixNameMatch(a.name,n)));
  if(gas.length)steps.push({station:'Drops',action:'Greater '+gas.join(' / '),detail:'Greater Affixes only roll naturally on drops. The Blacksmith capstone is a separate boost, not a Greater Affix.',scored:false});
  // Horadric Cube: only recipes the user has recorded
  const cube=(ctx.craftingRules||[]).filter(r=>/cube/i.test(r.station||''));
  steps.push({station:'Horadric Cube',action:cube.length?cube.map(r=>r.name||r.description).join('; '):'No Cube recipe recorded',detail:cube.length?'From your recorded crafting rules; confirm in the current client.':'Cube recipes aren’t in the game data the app reads, so it won’t guess one. Check the Cube in game for a recipe that rerolls or upgrades this item type.',scored:false});
  // Potential: regrade with the crafted changes (new affixes/aspects at an average roll)
  const regrade=gradeItem(sim,target);
  const potential=regrade?.score==null?null:Math.max(grade.score,regrade.score);
  return {steps,potential};
}

/** Compare a candidate with the equipped item for the same slot. */
export function recommendation(candidate,equipped){
  if(candidate?.score==null)return {verdict:'unknown',text:'No target recorded for this slot, so the app can’t grade it. Add the slot to the build’s gear targets.'};
  if(!equipped)return {verdict:'replace',text:'Nothing is recorded in this slot. Equip this item.'};
  if(equipped.score==null)return {verdict:'replace',text:'The equipped item has no recorded details to grade. Compare the two in game.'};
  const d=candidate.score-equipped.score;
  if(d>=3)return {verdict:'replace',text:'Replace: this item scores '+d+' points higher for the build.'};
  if(d<=-3)return {verdict:'keep',text:'Keep the equipped item: it scores '+(-d)+' points higher.'};
  return {verdict:'similar',text:'About the same build fit ('+(d>0?'+':'')+d+'). Compare item power, defenses and crafting potential.'};
}
