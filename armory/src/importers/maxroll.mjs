// Public Maxroll profile adapter. Treat every source field as data, never executable code.
const clone=value=>structuredClone(value);
const clean=value=>String(value??'').replace(/<[^>]*>/g,'').replace(/\{[^{}]*\}/g,'').replace(/\\r\\n/g,'\n').trim();
const human=value=>String(value??'').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/_/g,' ');
const sections=['gear','skills','paragon','mercenaries','warplans','primeEvilPowers'];
export function maxrollReference(value){
  let u;try{u=new URL(value)}catch{return null}
  if(u.protocol!=='https:'||!['maxroll.gg','www.maxroll.gg'].includes(u.hostname)||u.username||u.password||u.port)return null;
  const planner=u.pathname.match(/^\/d4\/planner\/([a-zA-Z0-9_-]{4,64})\/?$/);
  if(planner&&['builds','create','new'].includes(planner[1].toLowerCase()))return null;
  if(planner)return {type:'planner',id:planner[1],profileIndex:/^#\d+$/.test(u.hash)?Math.max(0,Number(u.hash.slice(1))-1):null};
  return /^\/d4\/build-guides\/[a-zA-Z0-9_-]+\/?$/.test(u.pathname)?{type:'guide'}:null;
}
export function discoverMaxrollPlanners(html){
  const ids=new Set();
  for(const match of String(html).matchAll(/(?:https?:\/\/(?:www\.)?maxroll\.gg)?\/d4\/planner\/([a-zA-Z0-9_-]{4,64})/g))if(!['builds','create','new'].includes(match[1].toLowerCase()))ids.add(match[1]);
  return [...ids];
}
function richText(value){
  if(typeof value==='string')return clean(value);
  if(Array.isArray(value))return value.map(richText).filter(Boolean).join('\n');
  if(!value||typeof value!=='object')return '';
  if(value.text!=null)return clean(value.text);
  if(value.root)return richText(value.root);
  if(value.children){const parts=value.children.map(richText).filter(Boolean);return parts.join(['paragraph','heading','listitem'].includes(value.type)?'':'\n')}
  return Object.values(value).map(richText).filter(Boolean).join('\n');
}
const attributeLabels={
 Armor_Bonus:['Armor',false],Resistance_All_Bonus:['All Resistance',false],Resource_Cost_Reduction_Percent_All:['Resource Cost Reduction',true],Crit_Percent_Bonus:['Critical Strike Chance',true],Movement_Bonus_Run_Speed:['Movement Speed',true],Bucketed_Multiplicative_Crit_Damage:['Critical Strike Damage Multiplier',true],Damage_Reduction:['Damage Reduction',true],Block_Chance:['Block Chance',true],Main_Hand_Damage_Percent_Bonus:['Main Hand Damage',true],Hitpoints_Max_Percent_Bonus:['Maximum Life',true],Plus_All_Stats:['All Stats',false],Skill_Rank_All_Bonus:['All Skills',false],Bucketed_Multiplicative_Vulnerable_Health_Damage:['Vulnerable Damage Multiplier',true],Evade_Max_Charges:['Evade Charges',false],Combat_Effect_Chance_Bonus:['Lucky Hit Chance',true],Weapon_Damage_Min:['Weapon Damage',false],Global_CrushingBlowChance:['Crushing Blow Chance',true],Gem_Attributes_Multiplier:['Socketed Gem Effect',true],All_Stats_Percent_Bonus:['All Stats',true],Resistance_All_Bonus_Percent:['All Resistance',true],Unique_Charm_Count_Bonus:['Unique Charm Limit',false],Multiplicative_Crit_Damage_Percent:['Critical Strike Damage Multiplier',true],Multiplicative_Damage_Percent_All_From_Skills:['Skill Damage Multiplier',true],Power_Cooldown_Reduction_Percent_All:['Cooldown Reduction',true],Barrier_Bonus_Percent:['Barrier Generation',true],Resource_Gain_And_Regen_Bonus_Percent_All_Primary:['Resource Generation',true],Proc_Resource_On_Hit_Flat_All_Primary:['Lucky Hit: Restore Primary Resource',false],
 Flat_Hitpoints_Max_Bonus_Unscaled_By_Player_Health:['Maximum Life',false],Intelligence:['Intelligence',false],Strength:['Strength',false],Dexterity:['Dexterity',false],Willpower:['Willpower',false],
 Resource_All_Primary_Max_Bonus:['Maximum Resource',false],Resource_Regen_Per_Second:['Resource Regeneration / Second',false],Attack_Speed_Percent_Bonus:['Attack Speed',true],Crit_Percent_Bonus_Capped:['Critical Strike Chance',true],Crit_Damage_Percent:['Critical Strike Damage Multiplier',true],Armor:['Armor',false],Resistance_All:['All Resistance',false]
};
export function normalizeMaxroll(response,game,text,options={}){
  if(!response?.data||!game?.classes||!game?.skillTrees||!text?.skills)throw new Error('Maxroll data format is incomplete or has changed.');
  const payload=typeof response.data==='string'?JSON.parse(response.data):clone(response.data);
  if(!Array.isArray(payload.profiles)||!payload.profiles.length||payload.profiles.length>100)throw new Error('No supported Maxroll build variants found.');
  const warnings=new Set(),affixById=new Map(Object.entries(game.affixes||{}).map(([id,a])=>[String(a.id),{...a,key:id}]));
  const profileUrl='https://planners.maxroll.gg/profiles/load/d4/'+response.id;
  const label=(section,id,fallback)=>clean(text[section]?.[id]?.name)||fallback||human(id);
  function skillEntries(treeName,data){
    const tree=game.skillTrees[treeName],nodes=new Map((tree?.nodes||[]).map(n=>[String(n.id),n]));
    return Object.entries(data||{}).filter(([,rank])=>typeof rank==='number'&&rank>0).map(([nodeId,rank])=>{
      const node=nodes.get(nodeId),reward=game.skillTreeRewards?.[node?.rewardId],power=reward?.power;
      let name=power?label('skills',power):'Unresolved skill node '+nodeId;
      if(reward?.type===1){const idx=game.skills?.[power]?.mods?.findIndex(m=>m.id===reward.mod);name+=' — '+(idx>=0?clean(text.skills?.[power]?.mods?.[idx]?.name)||'Modifier '+reward.mod:'Modifier '+reward.mod)}
      if(!reward)warnings.add('Unresolved skill node '+nodeId+' in '+treeName);
      return {id:treeName+':'+nodeId,name,rank,nodeId,rewardId:node?.rewardId||null,powerId:power||null,sourceStatus:reward?'source-resolved':'unresolved',position:node?.pos||null};
    });
  }
  function affix(raw,kind){
    const definition=affixById.get(String(raw.nid)),attributes=definition?.attributes||[],attribute=game.attributes?.[String(attributes[0]?.id)],known=attributeLabels[attribute?.name];
    const english=text.affixes?.[definition?.key];
    let name=clean(english?.name)||known?.[0]||human(definition?.key||'Unresolved affix '+raw.nid);
    if(definition?.key==='S04_Resource_Per_Second_Essence')name='Essence Regeneration';
    if(attribute?.name==='Resistance')name=(text.uiStrings?.damageType?.[String(attributes[0]?.param)]||'Unknown')+' Resistance';
    if(['Bucketed_Multiplicative_Damage_Type','Multiplicative_Damage_Type_Percent_Bonus'].includes(attribute?.name))name=(text.uiStrings?.damageType?.[String(attributes[0]?.param)]||'Unknown')+' Damage Multiplier';
    if(attribute?.name==='Skill_Rank_Skill_Tag_Bonus'){const category=definition?.key?.match(/_Category_([A-Za-z]+)/)?.[1];if(category)name=category+' Skills'}
    if(definition?.magicType>0)name=clean(text.items?.[definition.key]?.name)||clean(english?.name)||(english?.prefix?clean(english.prefix)+' Aspect':english?.suffix?'Aspect '+clean(english.suffix):name);
    if(!definition)warnings.add('Unresolved affix '+raw.nid);
    const values=Array.isArray(raw.values)?raw.values:[],value=typeof values[0]==='number'?values[0]:null,percent=Boolean(known?.[1])||['Bucketed_Multiplicative_Damage_Type','Multiplicative_Damage_Type_Percent_Bonus'].includes(attribute?.name);
    return {id:definition?.key||'maxroll-affix-'+raw.nid,sourceId:raw.nid,name,kind,weight:null,primary:true,idealValue:value==null?null:String(percent?Math.round(value*10000)/100:value)+(percent?'%':''),value:value==null?null:percent?Math.round(value*10000)/100:value,unit:percent?'%':null,min:null,max:null,rawValues:clone(values),greaterAffix:raw.greater===true,plannerUpgrade:raw.upgrade??null,sourceStatus:definition?'Planner target; importance and legal roll range not supplied':'Unresolved source identifier',labelStatus:english?.name||english?.prefix||english?.suffix||known||['Resistance','Skill_Rank_Skill_Tag_Bonus','Bucketed_Multiplicative_Damage_Type','Multiplicative_Damage_Type_Percent_Bonus'].includes(attribute?.name)||definition?.key==='S04_Resource_Per_Second_Essence'?'resolved':'internal-identifier',sourceAffix:clone(raw),powerType:definition?.magicType||0};
  }
  const bodySlots={4:'helm',5:'chest',6:'offhand',7:'weapon',13:'gloves',14:'pants',15:'boots',16:'ring1',17:'ring2',18:'amulet',20:'seal',21:'charm1',22:'charm2',23:'charm3',24:'charm4',25:'charm5',26:'charm6'};
  const variants=payload.profiles.map((source,index)=>{
    const classDef=game.classes[String(source.class)]||{},classId=String(classDef.name||response.class||'unknown').toLowerCase();
    const slots={};
    for(const [bodySlot,reference] of Object.entries(source.items||{})){
      const item=payload.items?.[String(reference)];if(!item){warnings.add('Missing item reference '+reference);continue}
      const def=game.items?.[item.id],slot=bodySlots[bodySlot]||'slot_'+bodySlot;
      if(!def)warnings.add('Unresolved item '+item.id);
      const all=(item.explicits||[]).map(a=>affix(a,'base')),powers=[...all.filter(a=>a.powerType>0),...(item.aspects||[]).map(a=>affix(a,'aspect'))],base=all.filter(a=>a.powerType===0),tempers=(item.tempered||[]).map(a=>affix(a,'temper'));
      const itemName=label('items',item.id,item.name||human(item.id));
      slots[slot]={name:itemName,identityRequired:def?.magicType===2,itemId:item.id,slot,sourceBodySlot:Number(bodySlot),priority:null,rarity:item.mythic?'Mythic':def?.magicType===2?'Unique':(item.aspects?.length?'Legendary':'Unknown'),itemPower:item.power??null,quality:item.upgrade??null,affixes:base,affixSlots:base.length,aspect:(item.aspects||[]).length?powers.at(-1)?.name:null,powers,tempers,temper:tempers.map(a=>a.name).join(' / ')||null,sockets:(item.sockets||[]).map(id=>({id,name:label('items',id)})),greaterAffixTargets:base.filter(a=>a.greaterAffix).map(a=>a.name),greaterAffixPriority:[],masterworkPriority:[],plannerUpgradeSelections:base.filter(a=>a.plannerUpgrade>0).map(a=>({name:a.name,flag:a.plannerUpgrade})),plannerItem:clone(item),sourceStatus:'Exact planner item target; affix order is not a verified importance ranking',masterworkNote:'Planner upgrade flags are preserved separately; verify current Blacksmith mechanics before treating them as priorities.',upgradeNote:'Source values may include quality, Greater Affix and upgrade effects. No legal roll ranges or farming costs were inferred.'};
    }
    const skillSteps=(source.skillTree?.steps||[]).map((step,i)=>({id:String(i),name:step.name||'Step '+(i+1),entries:skillEntries(classDef.tree||classDef.name,step.data),raw:clone(step)}));
    const skillIndex=source.skillTree?.position??0,skills={entries:skillSteps[skillIndex]?.entries||[],steps:skillSteps,activeStep:skillIndex,bar:(source.skillBar||[]).map(id=>({id,name:label('skills',id)})),text:richText(source.widgetNotes?.skills)};
    const paragonSteps=(source.paragon?.steps||[]).map((step,stepIndex)=>{
      const boards=(Array.isArray(step.data)?step.data:Array.isArray(step.data?.boards)?step.data.boards:[]).map((board,order)=>{
        const def=game.paragonBoards?.[board.id],width=def?.width||21;
        const allocations=Object.entries(board.nodes||{}).filter(([,rank])=>Number(rank)>0).map(([index,rank])=>{
          const nodeId=def?.nodes?.[Number(index)];if(!nodeId)warnings.add('Unresolved Paragon node '+board.id+':'+index);
          return {index:Number(index),row:Math.floor(Number(index)/width),column:Number(index)%width,id:nodeId||null,name:label('paragonNodes',nodeId,'Node '+index),rank};
        });
        return {id:board.id,name:label('paragonBoards',board.id),order:order+1,rotation:Number.isInteger(board.rotation)?board.rotation*90:null,sourceRotation:board.rotation??null,position:clone(board.position||{}),width,glyph:board.glyph?label('paragonGlyphs',board.glyph):null,glyphId:board.glyph||null,glyphLevel:board.glyphLevel??null,nodes:allocations.map(n=>'['+n.index+'] '+n.name),nodeAllocations:allocations,grid:(def?.nodes||[]).map((id,index)=>id?{index,id,name:label('paragonNodes',id),allocated:allocations.some(n=>n.index===index)}:null),pathNotes:'',sourceStatus:def?'source-resolved':'unresolved'};
      });
      const allocationOrder=Array.isArray(step.data?.order)?step.data.order.filter(o=>o&&typeof o.board==='string'&&Number.isInteger(o.index)).map((o,i)=>{const def=game.paragonBoards?.[o.board],nodeId=def?.nodes?.[o.index];return {step:i+1,board:o.board,boardName:label('paragonBoards',o.board),index:o.index,id:nodeId||null,name:label('paragonNodes',nodeId,'Node '+o.index)}}):[];
      return {id:String(stepIndex),name:step.name||'Step '+(stepIndex+1),boards,allocationOrder,points:boards.reduce((sum,b)=>sum+b.nodeAllocations.reduce((s,n)=>s+Number(n.rank),0),0)};
    });
    const paragonIndex=source.paragon?.position??0,paragon={...(paragonSteps[paragonIndex]||{boards:[],points:null}),steps:paragonSteps,activeStep:paragonIndex,text:richText(source.widgetNotes?.paragon),pointSource:'Sum of allocated planner nodes; not a required character Paragon rank'};
    let mercenaries={text:richText(source.widgetNotes?.mercenary)};
    if(source.mercenary?.id){const merc=source.mercenary,def=game.mercenaries?.[merc.id];mercenaries={...mercenaries,hired:label('mercenaries',merc.id),reinforcement:merc.support?label('mercenaries',merc.support):null,entries:skillEntries(def?.tree,merc.tree),supportSkills:(merc.supportSkills||[]).map(id=>({id,name:label('skills',id)})),raw:clone(merc)}}
    const warRaw=source.warPlans??source.warplans,warTrees=(Array.isArray(warRaw)?warRaw:[]).map((allocation,i)=>({id:game.warPlans?.[i]?.tree||'war-plan-'+i,name:clean(text.warPlans?.[i]?.name)||human(game.warPlans?.[i]?.tree||'Plan '+(i+1)),entries:skillEntries(game.warPlans?.[i]?.tree,allocation)}));
    const warEntries=warTrees.flatMap(tree=>tree.entries.map(entry=>({...entry,name:tree.name+' — '+entry.name}))),warplans={availability:warEntries.length?'required':'unknown',entries:warEntries,trees:warTrees,text:richText(source.widgetNotes?.warPlans||source.widgetNotes?.warplans),raw:clone(warRaw??null)};
    const primeRaw=source.primeEvilPowers??source.primeEvilPower;
    const primeEntries=Array.isArray(primeRaw?.entries)?primeRaw.entries.filter(e=>e&&typeof e.name==='string').map(e=>({name:e.name,rank:Number.isFinite(e.rank)?e.rank:null})):[];
    const primeEvilPowers={availability:primeRaw?'required':'unknown',choice:typeof primeRaw?.choice==='string'?primeRaw.choice:null,entries:primeEntries,text:richText(source.widgetNotes?.primeEvilPowers),raw:clone(primeRaw??null),scope:clone(primeRaw?.scope||{seasons:[String(response.season||payload.season||'')]})};
    if(primeRaw&&!primeEntries.length&&!primeEvilPowers.choice)warnings.add('Prime Evil Power data is present but its format needs manual review.');
    const status=(present,filled)=>!present?'not-provided':filled?'present':'empty';
    const sourceSections={gear:status(source.items,Object.keys(slots).length),skills:status(source.skillTree,skills.entries.length),paragon:status(source.paragon,paragon.boards.length),mercenaries:status(source.mercenary,mercenaries.hired),warplans:status(warRaw,warEntries.length),primeEvilPowers:status(primeRaw,primeEntries.length||primeEvilPowers.choice)};
    if(!mercenaries.hired&&mercenaries.text)sourceSections.mercenaries='notes-only';
    if(warRaw&&!Array.isArray(warRaw)&&Object.keys(warRaw).length){sourceSections.warplans='partial';warnings.add('War Plans data has an unrecognized structure. Original values are retained for review.')}
    else if(!warEntries.length&&warplans.text)sourceSections.warplans='notes-only';
    if(primeRaw&&!primeEntries.length&&!primeEvilPowers.choice&&Object.keys(primeRaw).length)sourceSections.primeEvilPowers='partial';
    else if(!primeRaw&&primeEvilPowers.text)sourceSections.primeEvilPowers='notes-only';
    const coverage=Object.fromEntries(sections.map(key=>[key,sourceSections[key]==='present'?'provisional':['mercenaries','warplans','primeEvilPowers'].includes(key)&&['not-provided','empty'].includes(sourceSections[key])?'not-provided':'unknown']));
    const notes=richText(source.widgetNotes),equipmentNotes=richText(source.widgetNotes?.equipment);
    return {id:'maxroll-'+response.id+'-'+index,name:source.name||'Variant '+(index+1),order:index,sourceUrl:'https://maxroll.gg/d4/planner/'+response.id+'#'+(index+1),sourceStatus:'Structured Maxroll profile; review before activation',classId,slots,skills,paragon,mercenaries,warplans,primeEvilPowers,sourceSections,coverage,equipmentNotes,acquisition:{text:equipmentNotes,status:equipmentNotes?'source-notes':'not-provided'},classMechanics:{raw:clone({minionUpgrades:source.minionUpgrades,minionSpec:source.minionSpec}),text:(source.minionUpgrades||[]).map(id=>label('skills',id)).join('\n')},rotations:clone(source.rotations||[]),world:clone(source.world||{}),elixirs:clone(source.elixirs||[]),recommendedWorldTier:source.worldTier??null,notes,rawSourceProfile:clone(source)};
  });
  const selected=Number.isInteger(options.profileIndex)?options.profileIndex:payload.activeProfile??0;
  if(!variants[selected])warnings.add('Requested variant index was unavailable; the first variant is selected for review.');
  warnings.add('Affix importance, legal roll ranges and exact crafting costs are not supplied by the profile and were not invented.');
  return {name:response.name||'Maxroll build',title:response.name||'Maxroll build',classId:variants[0].classId,author:response.user?.username||null,sourceUrl:options.url||'https://maxroll.gg/d4/planner/'+response.id,url:options.url||'https://maxroll.gg/d4/planner/'+response.id,season:String(response.season||payload.season||'')||null,patch:null,gameDataVersion:game.version||null,sourceUpdatedAt:response.date||null,provider:'maxroll',profileId:response.id,slots:{},variants,activeVariantId:variants[selected]?.id||variants[0].id,stages:variants.map(v=>v.name),status:'review',verifiedAt:null,importedAt:new Date().toISOString(),sources:[{url:profileUrl,kind:'structured-profile',retrievedAt:new Date().toISOString()},{url:'https://assets-ng.maxroll.gg/d4-tools/game/data.min.json',kind:'game-definitions',version:game.version},{url:'https://assets-ng.maxroll.gg/d4-tools/game/data.enus.json',kind:'English-labels'}],importWarnings:[...warnings],globalNotes:clone(payload.globalNotes||{}),extraSections:clone(Object.fromEntries(Object.entries(payload).filter(([key])=>!['profiles','items'].includes(key)))),rawSourceProfile:clone(response)};
}
