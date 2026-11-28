// Character build fit: 0-100 for how close a character is to a build variant, and advice on whether to
// move up to the next variant, stay, or drop back. Uses the same scale and bands as the item grade
// (src/item-grade.mjs): every equipped slot is graded with gradeItem against the variant's target.
// Pure functions (browser + Node). A build-fit checklist score, not a damage calculation.
import {gradeItem} from './item-grade.mjs';
import {assessProgression,effectiveBuild} from './core.mjs';

const CHARM=/^charm\d*$/;
// Charms are small pieces and a variant lists up to six of them; half weight keeps the Talisman from
// outweighing the ten equipment and jewelry slots.
const slotWeight=slot=>CHARM.test(slot)?0.5:1;
const fitNum=v=>{const n=Number(v);return Number.isFinite(n)?n:null};

function variantBuild(build,variantId){
  if(!build)return null;
  if(!variantId||!build.variants?.some(v=>v.id===variantId))return effectiveBuild(build);
  return effectiveBuild({...build,activeVariantId:variantId});
}
function targetFor(slots,slot){return slots[slot]||(CHARM.test(slot)?slots.charms:null)||null}
function charmSlots(slots,character){
  // Older builds keep one shared "charms" target with a count instead of charm1..charmN
  const t=slots.charms;if(!t)return [];
  const n=Number.isInteger(t.count)&&t.count>0?t.count:Object.keys(character?.equipment||{}).filter(s=>CHARM.test(s)).length;
  return Array.from({length:n},(_,i)=>'charm'+(i+1));
}

/**
 * Score a character against one variant of a build.
 * @returns {score, band, components[], slots[], variant}
 *   components follow gradeItem's shape: {key,label,max,points,detail}; a component with no recorded data is
 *   left out and the score is scaled over the rest, so an empty skill record doesn't count as zero.
 */
export function characterScore(build,character,items=[],variantId=null){
  const b=variantBuild(build,variantId);
  if(!b||!character)return null;
  const slots=b.slots||{},comps=[];
  const slotNames=[...Object.keys(slots).filter(s=>s!=='charms'),...charmSlots(slots,character)];
  const rows=[];
  let earned=0,weight=0;
  for(const slot of slotNames){
    const target=targetFor(slots,slot);if(!target)continue;
    const item=items.find(i=>i.id===character.equipment?.[slot])||null;
    const grade=item?gradeItem(item,target):null;
    if(item&&grade?.score==null)continue; // target with nothing to grade against
    const score=item?grade.score:0,w=slotWeight(slot);
    earned+=w*score;weight+=w;
    rows.push({slot,target,item,score,missing:!item});
  }
  if(weight){
    const equipped=rows.filter(r=>!r.missing).length;
    comps.push({key:'gear',label:'Gear fit',max:70,points:70*earned/weight/100,detail:equipped+' of '+rows.length+' slots equipped · average item fit '+Math.round(earned/weight)+'/100'});
  }
  // Paragon: points the character has against the points this variant spends
  const expected=fitNum(b.paragon?.points);
  const recorded=fitNum(character.setup?.paragon?.points);
  const have=recorded??fitNum(character.paragon??character.stats?.paragon);
  if(expected&&have!=null){
    comps.push({key:'paragon',label:'Paragon',max:15,points:15*Math.min(1,have/expected),detail:have+' of '+expected+' points'+(recorded==null?' (Paragon level used as points)':''),have,expected,estimated:recorded==null});
  }
  // Skills: only when the character's skill ranks have been recorded
  const skillChecks=skillProgress(build,character,items,b.variantId);
  if(skillChecks)comps.push({key:'skills',label:'Skills',max:15,points:15*skillChecks.met/skillChecks.total,detail:skillChecks.met+' of '+skillChecks.total+' skill ranks match'});
  const max=comps.reduce((s,c)=>s+c.max,0),pts=comps.reduce((s,c)=>s+c.points,0);
  const score=max?Math.max(1,Math.round(100*pts/max)):null;
  return {score,band:band(score),components:comps.map(c=>({...c,points:Math.round(c.points*10)/10})),slots:rows,variant:b.variantId?{id:b.variantId,name:b.variantName}:null};
}
function skillProgress(build,character,items,variantId){
  if(!build?.variants?.length||!character?.setup?.skills?.entries?.length)return null;
  const a=assessProgression(build,character,items).assessments.find(x=>x.variant.id===variantId);
  const checks=(a?.requirements||[]).filter(r=>r.section==='skills'&&r.status!=='unknown');
  return checks.length?{met:checks.filter(r=>r.status==='met').length,total:checks.length}:null;
}
/** Same bands as the item grade colours: 80+ strong, 60+ good, 40+ partial, below 40 weak. */
export function band(score){return score==null?'unknown':score>=80?'a3':score>=60?'a2':score>=40?'a1':'a0'}

// Thresholds on the 0-100 scale, matching the item grade bands
export const MOVE_UP_AT=60;   // the next variant already scores "good": its gear is mostly in place
export const NEAR_AT=50;      // close enough to start collecting for the next variant
export const DROP_BELOW=40;   // the current variant scores "weak"…
export const DROP_MARGIN=15;  // …and the previous one fits clearly better

/**
 * Should the character move up a variant, stay, or drop back?
 * Scores the character against every saved variant (in guide order) and compares the active one with its
 * neighbours. Returns null when the build has fewer than two variants.
 * @returns {verdict:'up'|'stay'|'down', headline, reasons[], current, next, previous, scores[]}
 */
export function variantAdvice(build,character,items=[]){
  const variants=[...(build?.variants||[])].sort((a,b)=>(a.order??99)-(b.order??99));
  if(variants.length<2||!character)return null;
  const scores=variants.map(v=>({variant:v,...characterScore(build,character,items,v.id)}));
  let i=scores.findIndex(s=>s.variant.id===build.activeVariantId);if(i<0)i=0;
  const current=scores[i],next=scores[i+1]||null,previous=scores[i-1]||null;
  const reasons=[];
  const paragonOf=s=>s?.components?.find(c=>c.key==='paragon');
  const gaps=s=>(s?.slots||[]).filter(r=>r.score<60).sort((a,b)=>a.score-b.score||slotWeight(b.slot)-slotWeight(a.slot));
  const gapText=s=>gaps(s).slice(0,3).map(r=>(r.target.name||r.slot)+(r.missing?' (empty)':' ('+r.score+')')).join(', ');
  if(current.score==null)return {verdict:'stay',headline:'Add gear targets to '+current.variant.name+' to assess progression.',reasons,current,next,previous,scores};
  if(next&&next.score>=MOVE_UP_AT){
    const p=paragonOf(next);
    reasons.push('Your gear and Paragon already score '+next.score+'/100 against '+next.variant.name+'.');
    if(p&&p.have<p.expected)reasons.push(next.variant.name+' spends '+p.expected+' Paragon points; you have '+p.have+(p.estimated?' (from Paragon level)':'')+'. Fill the remaining boards as you level.');
    if(gaps(next).length)reasons.push('Still to collect for '+next.variant.name+': '+gapText(next)+'.');
    return {verdict:'up',headline:'Ready to move up to '+next.variant.name,reasons,current,next,previous,scores};
  }
  if(previous&&current.score<DROP_BELOW&&previous.score>=current.score+DROP_MARGIN){
    reasons.push('You score '+current.score+'/100 against '+current.variant.name+' but '+previous.score+'/100 against '+previous.variant.name+'.');
    if(gaps(current).length)reasons.push(current.variant.name+' depends on gear you don’t have yet: '+gapText(current)+'.');
    reasons.push('Play '+previous.variant.name+' while you collect those pieces, then move back up.');
    return {verdict:'down',headline:'Drop back to '+previous.variant.name+' for now',reasons,current,next,previous,scores};
  }
  reasons.push('You score '+current.score+'/100 against '+current.variant.name+'.');
  if(next){
    reasons.push(next.variant.name+' scores '+next.score+'/100; move up at '+MOVE_UP_AT+'.');
    if(gaps(next).length)reasons.push('Biggest gaps for '+next.variant.name+': '+gapText(next)+'.');
    const p=paragonOf(next);if(p&&p.have<p.expected)reasons.push(next.variant.name+' spends '+p.expected+' Paragon points; you have '+p.have+(p.estimated?' (from Paragon level)':'')+'.');
  }else if(gaps(current).length)reasons.push('This is the last variant. Biggest gaps: '+gapText(current)+'.');
  const headline=!next?'Stay on '+current.variant.name+' (final variant)':next.score>=NEAR_AT?'Close to '+next.variant.name+' — keep collecting':'Stay on '+current.variant.name;
  return {verdict:'stay',headline,reasons,current,next,previous,scores};
}
