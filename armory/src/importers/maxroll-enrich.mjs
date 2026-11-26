// Enriches a normalized Maxroll draft (see maxroll.mjs) with fields decoded by the
// D4 Build Viewer engine in /viewer/js: readable affix and power text, Prime Evil
// Powers, mercenary reinforcement skill/trigger, class mechanics, older seasonal
// powers, rotations, elixirs, Talisman set bonuses and glyph text.
//
// It only adds information or fills fields the base adapter left empty/unresolved;
// it never removes source data. Every value comes from the public Maxroll profile and
// game definitions; nothing is invented.
import {applyPlannerAffixWeights} from '../core.mjs';

// The decoding engine is the D4 Build Viewer's (viewer/js). Browsers load it with <script> tags before
// this module; Node loads the same files through require.
if(!globalThis.D4?.GameData){
  const {createRequire}=await import('node:module');
  const require=createRequire(import.meta.url);
  for(const file of ['gamedata','richtext','model'])require('../../viewer/js/'+file+'.js');
}
const D4=globalThis.D4;

const MASTERWORK_NOTE='Marked ↑ in the Maxroll planner, whose legend reads "affix to prioritize when masterworking". Verify current Blacksmith mechanics and costs in game.';
const text=html=>D4.htmlToText(html||'').replace(/\n{3,}/g,'\n\n').trim();
const oneLine=html=>text(html).replace(/\s*\n\s*/g,' ').trim();

let cached=null;
function gameDataFor(game,labels){
  // Definitions are re-parsed per import; reuse the built indexes while the version is unchanged.
  const key=(game.version||'')+'|'+Object.keys(game.items||{}).length+'|'+Object.keys(labels.items||{}).length;
  if(cached?.key!==key)cached={key,gd:new D4.GameData(game,labels)};
  return cached.gd;
}

/** "+2,175 Maximum Life" -> "Maximum Life"; "+3 to Blood Skills" -> "Blood Skills". */
export function affixLabelFromText(line){
  return String(line||'').split('\n')[0]
    .replace(/^[+x\-−]?\s*[\d,.]+\s*%?\s*(\[x\]|\[\+\])?\s*/i,'')
    .replace(/^to\s+/i,'')
    .replace(/\s*\[(x|\+)\]\s*$/i,'')
    .replace(/:$/,'')
    .trim();
}

// Labels the base adapter built from internal ids (e.g. "S04 Skill Rank Bonus Barb Core Hammerofthe Ancients")
const looksInternal=a=>a.labelStatus==='internal-identifier'||/^Unresolved affix/.test(a.name||'')||/^(S|X)\d+ /.test(a.name||'')||(a.id&&a.name===String(a.id).replace(/_/g,' '));

function slotKind(bodySlot){return bodySlot>=16&&bodySlot<=18?2:bodySlot>=7&&bodySlot<=12?0:1}

function enrichSlot(gd,target,cls){
  const ctx={};
  const render=raw=>raw&&raw.nid!=null?gd.renderAffix({nid:raw.nid,values:raw.values||[]},ctx):null;
  for(const a of target.affixes||[]){
    const r=render(a.sourceAffix);if(!r)continue;
    a.text=oneLine(r.html);
    if(looksInternal(a)){
      const label=affixLabelFromText(text(r.html));
      if(label){a.name=label;a.labelStatus='resolved-from-description'}
    }
    if(a.sourceAffix?.upgrade>0)a.masterworkTarget=true;
    if(a.sourceAffix?.hidden===true){a.primary=false;a.alternative=true;a.sourceStatus='Listed as an alternative (hidden) affix in the Maxroll planner'}
  }
  for(const p of target.powers||[]){const r=render(p.sourceAffix);if(r){p.text=oneLine(r.html);p.description=text(r.html)}}
  for(const t of target.tempers||[]){
    const r=render(t.sourceAffix);if(!r)continue;
    t.text=oneLine(r.html);
    if(looksInternal(t)){const label=affixLabelFromText(text(r.html));if(label){t.name=label;t.labelStatus='resolved-from-description'}}
    if(t.sourceAffix?.upgrade>0)t.masterworkTarget=true;
    // Blacksmith tempering recipe that can roll this temper (from the game's tempering tables)
    const key=gd.affixKey(t.sourceAffix?.nid);
    const ri=key?(gd.d.temperingRecipes||[]).findIndex(r=>(r.tiers||[]).some(tier=>tier.includes(key))):-1;
    if(ri>=0)t.recipe=gd.t.temperingRecipes?.[ri]?.name||null;
  }
  if(target.tempers?.length)target.temper=target.tempers.map(t=>t.name).join(' / ');
  if(applyPlannerAffixWeights(target))target.sourceStatus='Exact planner item target; affix colours follow the guide\u2019s Maxroll stat-priority order';
  if(!target.greaterAffixPriority?.length&&target.greaterAffixTargets?.length)target.greaterAffixPriority=[...target.greaterAffixTargets];
  const unique=(target.powers||[]).find(p=>p.kind==='base'&&p.text);
  if(unique)target.uniquePower=unique.text;
  const aspect=(target.powers||[]).find(p=>p.kind==='aspect'&&p.text);
  if(aspect)target.aspectText=aspect.text;
  target.sockets=(target.sockets||[]).map(s=>{
    const d=gd.describeSocketable(s.id,slotKind(target.sourceBodySlot));
    return {...s,name:d.name||s.name,kind:d.kind,text:oneLine(d.html)||null};
  });
  const mw=[...(target.affixes||[]),...(target.tempers||[])].filter(a=>a.masterworkTarget)
    .sort((a,b)=>(a.sourceAffix?.upgradePriority??99)-(b.sourceAffix?.upgradePriority??99));
  if(mw.length&&!target.masterworkPriority?.length){
    target.masterworkPriority=[...new Set(mw.map(a=>a.name))];
    target.masterworkNote=MASTERWORK_NOTE;
    target.masterworkSource='maxroll-planner-marker';
  }
  const base=gd.d.items?.[target.itemId];
  if(base){
    target.itemType=gd.itemTypeName(base.type);
    target.rarity=target.rarity==='Unknown'?(D4.RARITY[base.magicType]||target.rarity):target.rarity;
    const setKey=base.set;if(setKey){target.setId=setKey;target.setName=gd.t.itemSets?.[setKey]?.name||setKey}
    target.icon=gd.itemImage(target.itemId,cls)||null;
  }
}

function talismanSets(gd,slots){
  const counts={};
  for(const t of Object.values(slots))if(t.setId)counts[t.setId]=(counts[t.setId]||0)+1;
  const setBonuses={};
  for(const [setId,equipped] of Object.entries(counts)){
    const def=gd.d.itemSets?.[setId];if(!def)continue;
    const name=gd.t.itemSets?.[setId]?.name||setId,entry={equipped,total:Math.max(...def.bonuses.map(b=>b.required)),sourceStatus:'Set pieces counted from the planner; effects that add set count are not included'};
    for(const b of def.bonuses){const d=gd.t.affixes?.[b.affix]?.desc;entry[String(b.required)]=d?oneLine(D4.renderText(d,{})):b.affix}
    setBonuses[name]=entry;
  }
  return setBonuses;
}

export function enrichMaxrollDraft(draft,game,labels){
  if(draft?.provider!=='maxroll'||!draft.rawSourceProfile)return draft;
  const gd=gameDataFor(game,labels);
  const response=draft.rawSourceProfile;
  const payload=typeof response.data==='string'?JSON.parse(response.data):response.data;
  const planner={id:response.id,name:response.name,className:response.class,data:payload};
  const warnings=new Set(draft.importWarnings||[]);
  const added=new Set();

  draft.variants.forEach((v,i)=>{
    const source=payload.profiles?.[i];if(!source)return;
    let m;
    try{m=D4.buildVariant(gd,planner,i)}catch(error){warnings.add('Extra decoding skipped for '+v.name+': '+error.message);return}
    const cls=source.class;

    // Guide notes as readable text: the base adapter trims each fragment, which drops the spaces around linked names
    const notes=source.widgetNotes||{},noteText=n=>n?D4.lexicalToText(n).trim():'';
    if(notes.equipment){const t=noteText(notes.equipment);v.equipmentNotes=t;if(v.acquisition)v.acquisition.text=t}
    if(notes.skills&&v.skills)v.skills.text=noteText(notes.skills);
    if(notes.paragon&&v.paragon)v.paragon.text=noteText(notes.paragon);
    if(notes.mercenary&&v.mercenaries)v.mercenaries.text=noteText(notes.mercenary);
    if(Object.keys(notes).length)v.notes=Object.entries(notes).map(([k,n])=>{const t=noteText(n);return t?k[0].toUpperCase()+k.slice(1)+'\n'+t:''}).filter(Boolean).join('\n\n');

    // Gear: full text, resolved labels, masterwork markers, sockets, set membership
    for(const target of Object.values(v.slots||{}))try{enrichSlot(gd,target,cls)}catch(error){warnings.add('Could not decode '+(target.name||'an item')+' in '+v.name+': '+error.message)}
    const sets=talismanSets(gd,v.slots||{});
    if(Object.keys(sets).length){v.talisman={...(v.talisman||{}),setBonuses:sets};added.add('Talisman set bonuses')}
    added.add('item, aspect and socket text');

    // Mercenaries: reinforcement skill and its trigger
    if(m.mercenary&&v.mercenaries){
      const mm=m.mercenary,pick=x=>x?{id:x.key,name:x.name,text:oneLine(x.html)}:null;
      v.mercenaries.reinforcementSkill=pick(mm.reinforcementSkill);
      v.mercenaries.trigger=pick(mm.trigger);
      v.mercenaries.supportSkills=[v.mercenaries.reinforcementSkill,v.mercenaries.trigger].filter(Boolean).map(x=>({id:x.id,name:x.name}));
      for(const e of v.mercenaries.entries||[]){const n=[...(mm.tree?.skills||[]),...(mm.tree?.passives||[])].find(x=>String(x.id)===String(e.nodeId));if(n?.info?.desc)e.text=oneLine(D4.renderText(n.info.desc,{}))}
      added.add('mercenary reinforcement skill and trigger');
    }

    // Prime Evil Powers: Maxroll stores them as `primeevil` (Season 15 stones)
    const pepGroup=m.seasonal.find(g=>g.key==='primeevil');
    if(Array.isArray(source.primeevil)&&!(v.primeEvilPowers?.entries||[]).length){
      if(pepGroup){
        const seasons=[...new Set(pepGroup.powers.map(p=>p.season).filter(Boolean))];
        v.primeEvilPowers={
          ...v.primeEvilPowers,
          availability:'required',
          choice:pepGroup.powers.filter(p=>p.kind==='Prime Evil Power').map(p=>p.name).join(' + ')||null,
          entries:pepGroup.powers.map(p=>({name:p.name,rank:p.level??null,kind:p.kind,stoneId:p.id,text:oneLine(p.html)})),
          raw:structuredClone(source.primeevil),
          scope:{realms:['seasonal'],...(seasons.length?{seasons}:{})},
          sourceStatus:'Decoded from the planner’s primeevil allocation; seasonal availability still needs review'
        };
        v.sourceSections={...v.sourceSections,primeEvilPowers:'present'};
        v.coverage={...v.coverage,primeEvilPowers:'provisional'};
      }else{
        v.primeEvilPowers={...v.primeEvilPowers,raw:structuredClone(source.primeevil)};
        v.sourceSections={...v.sourceSections,primeEvilPowers:'empty'};
      }
      added.add('Prime Evil Powers');
    }

    // Class mechanics (Book of the Dead, arsenal, technique, oath, enchantments, boons, shards...)
    if(m.classMechanics.length){
      const entries=m.classMechanics.map(c=>({type:c.label,id:c.key,name:c.name,text:oneLine(c.html)}));
      v.classMechanics={...(v.classMechanics||{}),entries,text:entries.map(e=>e.type+': '+e.name).join('\n')};
      added.add('class mechanics');
    }

    // Powers from earlier seasons that some planners still carry
    const other=m.seasonal.filter(g=>g.key!=='primeevil');
    if(other.length){
      v.seasonalPowers=other.map(g=>({system:g.title,season:g.season,powers:g.powers.map(p=>({id:p.id,name:p.name,kind:p.kind,level:p.level,text:oneLine(p.html)}))}));
      v.seasonalPowersNote='These systems come from earlier seasons and may not apply to your current realm or season.';
      added.add('other seasonal powers');
    }

    if(m.rotations.length){v.rotationPlan=m.rotations.map(r=>({name:r.name,skills:r.skills.map(s=>s.name)}));added.add('rotations')}
    if(m.elixirs.length){v.elixirNames=m.elixirs.map(e=>e.name);added.add('elixirs')}
    if(m.skillBar.length)v.skills={...v.skills,bar:m.skillBar.map(s=>({id:s.key,name:s.name}))};

    // Paragon: glyph text and notable (rare/legendary) nodes for the variant's selected step
    const step=m.paragon.steps[v.paragon?.activeStep??m.paragon.active];
    for(const board of v.paragon?.boards||[]){
      const mb=step?.boards?.[board.order-1];
      if(mb?.id!==board.id)continue;
      if(mb.glyphInfo)board.glyphText=oneLine(mb.glyphInfo.html);
      board.notableNodes=mb.notable.map(n=>n.name);
    }

    v.planner={id:response.id,variantIndex:i,viewerPath:'/viewer/viewer.html?embed=1&src='+encodeURIComponent('https://maxroll.gg/d4/planner/'+response.id)+'&v='+i};
  });

  draft.importWarnings=[...warnings];
  draft.enrichment={decoder:'D4 Build Viewer engine',gameDataVersion:gd.version,fields:[...added]};
  return draft;
}
