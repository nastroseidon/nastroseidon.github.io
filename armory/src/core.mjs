const now = () => new Date().toISOString();
const id = () => globalThis.crypto?.randomUUID?.() || 'id-'+Date.now()+'-'+Math.random().toString(36).slice(2);
const copy = state => structuredClone(state);
const updateCharacter = (state, characterId, update) => {
  const next=copy(state), c=next.characters.find(x=>x.id===characterId);
  if(!c) throw new Error('Character not found');
  Object.assign(c,update);c.updatedAt=now();
  return next;
};

export function createStore() { return {schemaVersion:2,characters:[],builds:[],items:[],history:[],sourceFiles:[],settings:{classes:[],slots:[],rules:[]}}; }
export function createCharacter(state, fields) {
  if(!fields?.name?.trim()) throw new Error('Character name required');
  if(fields.realm&&!['seasonal','eternal'].includes(fields.realm))throw new Error('Choose Seasonal or Eternal as the character type');
  const next=copy(state);
  next.characters.push({id:id(),name:fields.name.trim(),classId:fields.classId||'unknown',level:fields.level??null,paragon:fields.paragon??null,season:fields.season??null,realm:fields.realm||'seasonal',patch:fields.patch||null,activeBuildId:null,buildIds:[],equipment:{},stats:fields.stats||{},archived:false,createdAt:now(),updatedAt:now(),...fields});
  return next;
}
export function editCharacter(state,characterId,fields){
  if(fields.name!==undefined&&!fields.name.trim())throw new Error('Character name required');
  if(fields.realm&&!['seasonal','eternal'].includes(fields.realm))throw new Error('Choose Seasonal or Eternal as the character type');
  const next=copy(state),c=next.characters.find(x=>x.id===characterId);
  if(!c)throw new Error('Character not found');
  const before=copy(c),oldPool=stashKey(c);
  Object.assign(c,fields);c.updatedAt=now();
  if(oldPool!==stashKey(c)){
    for(const itemId of Object.values(c.equipment||{})){
      const item=next.items.find(i=>i.id===itemId);
      if(item){item.realm=c.realm;item.season=c.realm==='eternal'?null:c.season}
    }
  }
  next.history.push({id:id(),at:now(),type:'character_updated',characterId,before,after:copy(c)});
  return next;
}
export function duplicateCharacter(state, characterId) {
  const next=copy(state), source=next.characters.find(x=>x.id===characterId);
  if(!source) throw new Error('Character not found');
  const cloned=copy(source), oldBuildIds=[...cloned.buildIds];
  cloned.id=id();cloned.name=source.name+' Copy';cloned.archived=false;cloned.buildIds=[];cloned.activeBuildId=null;cloned.createdAt=now();cloned.updatedAt=now();
  cloned.equipmentSnapshot=copy(source.equipment);cloned.equipment={};
  for(const oldId of oldBuildIds){const old=next.builds.find(x=>x.id===oldId);if(!old)continue;const b={...copy(old),id:id(),characterId:cloned.id,name:old.name};next.builds.push(b);cloned.buildIds.push(b.id);if(oldId===source.activeBuildId)cloned.activeBuildId=b.id}
  next.characters.push(cloned);
  next.history.push({id:id(),at:now(),type:'character_duplicated',characterId:cloned.id,sourceId:characterId});
  return next;
}
export function archiveCharacter(state, characterId, archived=true){return updateCharacter(state,characterId,{archived})}
export function deleteCharacter(state,characterId) {
  const next=copy(state),c=next.characters.find(x=>x.id===characterId);
  if(!c)throw new Error('Character not found');
  next.characters=next.characters.filter(x=>x.id!==characterId);
  next.builds=next.builds.filter(x=>x.characterId!==characterId);
  next.history.push({id:id(),at:now(),type:'character_deleted',characterId,snapshot:c});
  return next;
}
export function addBuild(state,characterId,fields){
  const next=copy(state),c=next.characters.find(x=>x.id===characterId);
  if(!c)throw new Error('Character not found');
  const b={id:id(),characterId,name:fields.name||'New build',classId:fields.classId||c.classId,stage:fields.stage||'endgame',variant:fields.variant||null,season:fields.season||c.season,patch:fields.patch||c.patch,slots:fields.slots||{},talisman:fields.talisman||{},skills:fields.skills||{},paragon:fields.paragon||{},stats:fields.stats||{},sources:fields.sources||[],status:fields.status||'active',createdAt:now(),verifiedAt:fields.verifiedAt||null,...fields};
  next.builds.push(b);c.buildIds.push(b.id);c.activeBuildId??=b.id;c.updatedAt=now();
  return next;
}
export function addItem(state,fields){
  if(!fields?.slot)throw new Error('Item slot required');
  const next=copy(state);next.items.push({id:id(),name:fields.name||'Unidentified item',slot:fields.slot,ownerCharacterId:null,location:'stash',affixes:[],images:[],history:[],...fields});return next;
}
export function equipItem(state,characterId,itemId,slot) {
  const next=copy(state),c=next.characters.find(x=>x.id===characterId),item=next.items.find(x=>x.id===itemId);
  if(!c||!item)throw new Error('Character or item not found');
  if(!compatibleCharacters(item,[c]).length)throw new Error('Item not compatible with character');
  const previousItemId=c.equipment[slot]||null;
  for(const other of next.characters){
    for(const [oldSlot,oldId] of Object.entries(other.equipment||{})){
      if(oldId===itemId){delete other.equipment[oldSlot];other.statsSnapshot='Stale after equipment transfer'}
    }
  }
  if(previousItemId){const prev=next.items.find(x=>x.id===previousItemId);if(prev)prev.location='stash'}
  c.equipment[slot]=itemId;c.updatedAt=now();c.statsSnapshot='Stale after equipment change';item.location='equipped';item.ownerCharacterId=characterId;
  next.history.push({id:id(),at:now(),type:'item_equipped',characterId,itemId,slot,previousItemId});
  return next;
}
export function switchBuild(state,characterId,buildId){
  const next=copy(state),c=next.characters.find(x=>x.id===characterId),b=next.builds.find(x=>x.id===buildId&&x.characterId===characterId);
  if(!c||!b)throw new Error('Build not found for character');
  if(b.classId&&c.classId&&b.classId!==c.classId)throw new Error('Build class does not match this character.');
  if(b.season&&c.season&&String(b.season)!==String(c.season))throw new Error('Build season does not match this character. Review it as a separate seasonal profile.');
  const oldBuildId=c.activeBuildId;c.activeBuildId=buildId;c.updatedAt=now();
  next.history.push({id:id(),at:now(),type:'build_switched',characterId,oldBuildId,buildId,equipmentSnapshot:copy(c.equipment)});
  return next;
}
export function rollPercent(affix){
  if(affix?.rangeVerified===false)return null;
  const {value,min,max,direction}=affix||{};
  if(![value,min,max].every(Number.isFinite)||max<=min||value<min||value>max)return null;
  const ratio=direction==='lower'?(max-value)/(max-min):(value-min)/(max-min);
  return Math.round(ratio*100);
}
export function affixPlan(target={}){
  const affixes=target.affixes||[];
  return {primary:affixes.filter(a=>a.primary!==false),alternatives:affixes.filter(a=>a.primary===false),greaterAffixPriority:target.greaterAffixPriority||[],masterworkPriority:target.masterworkPriority||[],affixSlots:target.affixSlots??null};
}
const affixMatches=(a,b)=>(a.id&&b.id&&a.id===b.id)||Boolean(a.name&&b.name&&a.name.toLowerCase().trim()===b.name.toLowerCase().trim());
export function scoreItem(item,build){
  const requirement=build?.slots?.[item.slot]||{};
  const unrated=!build?.slots?.[item.slot];
  const targets=requirement.affixes||[];
  const affixes=(item.affixes||[]).map(a=>{
    const t=targets.find(x=>affixMatches(x,a));
    const desirability=t?.weight??null, roll=rollPercent(a);
    return {...a,desirability,rollPercent:roll,topQuartile:roll!==null&&roll>=75};
  });
  const match=affixes.reduce((sum,a)=>sum+(a.desirability||0),0);
  const missing=affixPlan(requirement).primary.filter(t=>!affixes.some(a=>affixMatches(a,t)));
  const identityMatch=requirement.identityRequired===false||!requirement.name||requirement.name.toLowerCase()===item.name?.toLowerCase();
  return {score:match,affixes,missing,identityMatch,unrated,complete:!unrated&&identityMatch&&missing.length===0};
}
export function priorityQueue(build,equipment,items=[]){
  const slots=Object.entries(build?.slots||{}).flatMap(([slot,target])=>slot==='charms'?Object.keys(equipment||{}).filter(s=>s.startsWith('charm')).map(s=>[s,target]):[[slot,target]]);
  return slots.map(([slot,target])=>{
    const item=items.find(x=>x.id===equipment?.[slot]);
    const assessment=item?scoreItem({...item,slot:build?.slots?.[slot]?slot:slot.startsWith('charm')?'charms':slot},build):null;
    const status=!item?'missing':assessment.complete?'ready':'upgrade';
    const priority=Number(target.priority)||99;
    const missingWeight=(assessment?.missing||[]).reduce((sum,a)=>sum+(a.weight||1),0);
    const urgency=status==='ready'?0:(100/priority)+(status==='missing'?25:missingWeight+(assessment.identityMatch?0:10));
    return {slot,name:target.name||slot,priority,status,urgency,assessment,item};
  }).sort((a,b)=>b.urgency-a.urgency||a.slot.localeCompare(b.slot));
}
export function stashKey(record){
  if(record?.realm==='eternal')return 'eternal';
  if(record?.realm==='seasonal'&&record.season!=null&&String(record.season).trim())return 'seasonal:'+String(record.season).trim();
  return null;
}
export function sharedStashItems(items,character){
  const key=stashKey(character);
  return key?items.filter(i=>i.location==='stash'&&stashKey(i)===key):[];
}
export function compatibleCharacters(item,characters){
  if(item.location==='withdrawal'||item.transferEligibility==='blocked')return [];
  return characters.filter(c=>(!item.realm||item.realm===c.realm)&&
    (item.realm==='eternal'||!item.season||String(item.season)===String(c.season))&&
    (!item.classIds?.length||item.classIds.includes(c.classId)));
}
export function itemUses(item,characters,builds){
  const key=stashKey(item);
  const people=key?compatibleCharacters(item,characters).filter(c=>stashKey(c)===key):[];
  const groups=new Map();
  for(const b of builds){
    const owner=people.find(c=>c.id===b.characterId);
    if(!owner||b.classId&&b.classId!==owner.classId)continue;
    if(owner.realm==='seasonal'&&b.season&&String(b.season)!==String(owner.season))continue;
    const hasTarget=profile=>Boolean(profile.slots?.[item.slot]||(item.slot?.startsWith('charm')&&profile.slots?.charms));
    if(!hasTarget(b)&&!b.variants?.some(hasTarget))continue;
    const classId=b.classId||owner.classId;
    if(!groups.has(classId))groups.set(classId,[]);
    groups.get(classId).push(b);
  }
  return {characters:people,groups:[...groups].map(([classId,builds])=>({classId,builds}))};
}
export function rolloverSeason(state,season){
  season=String(season??'').trim();
  if(!season)throw new Error('Select a season');
  const next=copy(state),chars=next.characters.filter(c=>c.realm==='seasonal'&&String(c.season)===season);
  const stored=next.items.filter(i=>i.realm==='seasonal'&&String(i.season)===season&&i.location==='stash');
  if(!chars.length&&!stored.length)return next;
  const before={characters:copy(chars),items:copy(next.items.filter(i=>stored.includes(i)||chars.some(c=>Object.values(c.equipment||{}).includes(i.id))))};
  const stage=item=>{item.originSeason??=season;item.realm='eternal';item.season=null;item.location='withdrawal';item.ownerCharacterId=null;item.transferEligibility=item.seasonalOnly===true?'blocked':item.transferEligibility||'unknown'};
  for(const c of chars){
    c.previousSeason=season;c.realm='eternal';c.season=null;c.updatedAt=now();c.buildReviewRequired=true;
    for(const [slot,itemId] of Object.entries(c.equipment||{})){
      const item=next.items.find(i=>i.id===itemId);if(!item)continue;
      if(item.seasonalOnly===true||item.transferEligibility==='blocked'){stage(item);delete c.equipment[slot];c.statsSnapshot='Review after seasonal equipment removal'}
      else{item.originSeason??=season;item.realm='eternal';item.season=null}
    }
  }
  stored.forEach(stage);
  next.history.push({id:id(),at:now(),type:'season_rolled_over',season,characterIds:chars.map(c=>c.id),before,note:'Manual tracker rollover; game state and saved build mechanics require review.'});
  return next;
}
export function reviewWithdrawal(state,itemId,eligibility,note=''){
  const next=copy(state),item=next.items.find(i=>i.id===itemId);
  if(item?.location!=='withdrawal')throw new Error('Select an item in withdrawal storage');
  if(!['permitted','blocked','unknown'].includes(eligibility))throw new Error('Choose a transfer eligibility');
  if(item.seasonalOnly===true&&eligibility==='permitted')throw new Error('Season-only item cannot transfer; correct its season-only flag if the record is wrong');
  item.transferEligibility=eligibility;item.transferReview={at:now(),note,eligibility};
  next.history.push({id:id(),at:now(),type:'withdrawal_reviewed',itemId,eligibility,note});return next;
}
export function transferWithdrawal(state,itemId){
  const next=copy(state),item=next.items.find(i=>i.id===itemId);
  if(item?.location!=='withdrawal')throw new Error('Select an item in withdrawal storage');
  if(item.transferEligibility!=='permitted'||item.seasonalOnly===true)throw new Error('Confirm this is a permitted item before transferring');
  const before=copy(item);item.location='stash';item.realm='eternal';item.season=null;item.ownerCharacterId=null;
  next.history.push({id:id(),at:now(),type:'withdrawal_transferred',itemId,before,note:item.name||'Item transferred to Eternal shared stash'});return next;
}
export function stageGuideImport(extracted){
  const source=extracted.url||null;
  return {...copy(extracted),id:id(),name:extracted.title||extracted.name||'Untitled build',classId:extracted.classId||null,author:extracted.author||null,sourceUrl:source,season:extracted.season||null,patch:extracted.patch||null,variants:extracted.variants||[],stages:extracted.stages||[],slots:copy(extracted.slots||{}),talisman:copy(extracted.talisman||{}),skills:copy(extracted.skills||{}),paragon:copy(extracted.paragon||{}),stats:copy(extracted.stats||{}),sources:source?[{url:source,importedAt:now(),verifiedAt:null}]:[],status:'review',importedAt:now(),verifiedAt:null,rawText:extracted.rawText||null,confidence:extracted.confidence||null};
}
export function applyGuideReview(draft,changes={}){
  return {...copy(draft),...copy(changes),status:'active',verifiedAt:now()};
}
export function diffBuild(oldBuild,newBuild){
  const paths=new Set([...Object.keys(oldBuild?.slots||{}),...Object.keys(newBuild?.slots||{})]);
  const slots=[...paths].filter(slot=>JSON.stringify(oldBuild?.slots?.[slot]??null)!==JSON.stringify(newBuild?.slots?.[slot]??null)).map(slot=>({slot,before:oldBuild?.slots?.[slot]??null,after:newBuild?.slots?.[slot]??null}));
  const sections=['name','classId','season','patch','stage','variant','variants','warplans','primeEvilPowers','skills','rotation','paragon','glyphs','mercenaries','talisman','stats','classMechanics','seasonalMechanics','runewords','runes','gems'];
  return [...slots,...sections.filter(k=>JSON.stringify(oldBuild?.[k]??null)!==JSON.stringify(newBuild?.[k]??null)).map(k=>({slot:k,before:oldBuild?.[k]??null,after:newBuild?.[k]??null}))];
}
export function importArmory(data,template){
  if(!data||typeof data!=='object')throw new Error('Invalid backup');
  if(Array.isArray(data.characters)&&Array.isArray(data.items)&&Array.isArray(data.builds)){
    if(data.characters.some(c=>!c.id||!c.name)||data.items.some(i=>!i.slot||!Array.isArray(i.affixes)))throw new Error('Backup contains invalid character or item records');
    return copy(data);
  }
  if(!data.character||!Array.isArray(data.gear)||!Array.isArray(data.charms)||!data.seal)throw new Error('Not a Sanctuary Armory or legacy Blood Wave backup');
  const next=copy(template),c=next.characters[0];
  if(!c)throw new Error('Migration template unavailable');
  Object.assign(c,copy(data.character));c.stats={...c.stats,...copy(data.character)};c.equipment={};
  next.items=[...data.gear,...data.charms,data.seal].map(raw=>{
    if(!raw.slot||!Array.isArray(raw.affixes))throw new Error('Invalid legacy item');
    const item={...copy(raw),id:'legacy-'+raw.slot,ownerCharacterId:c.id,location:'equipped',season:String(data.character.season||c.season||''),realm:c.realm,classIds:[c.classId],images:raw.images||[]};
    c.equipment[raw.slot]=item.id;return item;
  });
  next.codex=copy(data.codex||next.codex||[]);next.screenshots=copy(data.screenshots||[]);
  next.history=[...(next.history||[]),...(data.history||[])];
  next.legacyBackup=copy(data);next.schemaVersion=2;
  return next;
}

const setupSections=['gear','skills','paragon','mercenaries','warplans','primeEvilPowers'];
// "[93] Knowledge" -> "Knowledge"; unnamed imported cells are "[31] Node 31", gates and glyph sockets.
const nodeName=n=>String(n??'').replace(/^\[\d+\]\s*/,'').trim();
const isPathNode=n=>/^\[\d+\]\s*(Node \d+|Board Attachment Gate|Glyph Socket|Start(ing)? Node)$/i.test(String(n??'').trim());
const sameName=(a,b)=>Boolean(a&&b&&String(a).trim().toLowerCase()===String(b).trim().toLowerCase());
export function effectiveBuild(build){
  if(!build)return null;
  const variant=build.variants?.find(v=>v.id===build.activeVariantId);
  if(!variant)return build;
  const effective={...build,...variant,id:build.id,name:build.name,variantId:variant.id,variantName:variant.name,stage:variant.name,variant:variant.name,variants:build.variants};
  for(const section of ['slots','skills','paragon','mercenaries','warplans','primeEvilPowers','talisman','stats','classMechanics'])effective[section]=variant[section]||{};
  effective.priorityQueue=variant.priorityQueue||[];
  return effective;
}
export function saveVariant(state,buildId,variant){
  if(!variant?.name?.trim())throw new Error('Variant name required');
  const next=copy(state),build=next.builds.find(b=>b.id===buildId);
  if(!build)throw new Error('Build not found');
  build.variants||=[];
  const previous=build.variants.find(v=>v.id===variant.id),saved={...copy(variant),id:variant.id||id(),updatedAt:now()};
  if(previous)build.variants[build.variants.indexOf(previous)]=saved;else build.variants.push(saved);
  build.activeVariantId??=saved.id;build.updatedAt=now();
  next.history.push({id:id(),at:now(),type:'variant_saved',characterId:build.characterId,buildId,variantId:saved.id,before:previous?copy(previous):null,after:copy(saved)});
  return next;
}
export function activateVariant(state,characterId,buildId,variantId){
  let next=switchBuild(state,characterId,buildId);
  const build=next.builds.find(b=>b.id===buildId),variant=build.variants?.find(v=>v.id===variantId);
  if(!variant)throw new Error('Variant not found');
  const oldVariantId=build.activeVariantId;build.activeVariantId=variantId;
  next.history.push({id:id(),at:now(),type:'variant_switched',characterId,buildId,oldVariantId,variantId});return next;
}
export function assessProgression(build,character,items=[]){
  const variants=[...(build?.variants||[])].sort((a,b)=>(a.order??99)-(b.order??99));
  const assessments=variants.map(variant=>{
    const requirements=[],actual=character?.setup||{};
    const add=(section,label,status,extra={})=>requirements.push({section,label,status,priority:10,...extra});
    const outcome=(known,met)=>!known?'unknown':met?'met':'missing';
    if(build.classId&&build.classId!==character.classId)add('gear','Review class mismatch','unknown');
    if(character.realm==='seasonal'&&build.season&&String(build.season)!==String(character.season))add('gear','Review source season mismatch','unknown');
    for(const section of setupSections){
      const coverage=variant.coverage?.[section]||'unknown';
      if(coverage==='not-applicable'||coverage==='not-provided'&&['mercenaries','warplans','primeEvilPowers'].includes(section))continue;
      if(!['reviewed','verified'].includes(coverage))add(section,'Review '+({gear:'equipment',skills:'skill',paragon:'Paragon',mercenaries:'mercenary',warplans:'War Plans',primeEvilPowers:'Prime Evil Power'}[section])+' requirements against the variant source','unknown',{priority:1});
      const expected=variant[section]||{},recorded=actual[section]||{};
      if(section==='gear'){
        const slots=variant.slots||{};
        if(!Object.keys(slots).length){add(section,'Import or enter equipment targets','unknown');continue}
        for(const [slot,target] of Object.entries(slots)){
          if(slot==='charms'){
            const charms=Object.entries(character.equipment||{}).filter(([slot])=>slot.startsWith('charm')).map(([,id])=>items.find(i=>i.id===id)).filter(Boolean);
            if(!Number.isInteger(target.count)||target.count<1){add(section,'Enter the number of required Charms for this variant','unknown');continue}
            add(section,'Equip '+target.count+' matching Charms',charms.filter(i=>scoreItem({...i,slot:'charms'},{slots}).complete).length>=target.count?'met':'missing');
            continue;
          }
          const item=items.find(i=>i.id===character.equipment?.[slot]);
          if(!item){add(section,'Equip '+(target.name||slot),'missing',{slot,priority:target.priority||10});continue}
          const assessment=scoreItem({...item,slot},{slots});
          add(section,slot+': '+(target.name||'target affixes'),assessment.complete?'met':'missing',{slot,priority:target.priority||10,details:assessment.missing.map(a=>a.name).join(', ')});
          if(target.aspect)add(section,slot+': imprint '+target.aspect,item.power?.name?(sameName(item.power.name,target.aspect)?'met':'missing'):'unknown',{slot});
          if(target.temper){const tempers=(item.affixes||[]).filter(a=>a.kind==='temper');add(section,slot+': temper '+target.temper,tempers.length?(tempers.some(a=>sameName(a.name,target.temper))?'met':'missing'):'unknown',{slot})}
        }
      }else if(section==='skills'){
        if(!expected.entries?.length)add(section,'Import or enter the skill tree and ranks','unknown');
        for(const skill of expected.entries||[]){const current=recorded.entries?.find(s=>sameName(s.name,skill.name));add(section,skill.name+' rank '+(skill.rank??'?'),skill.rank==null?'unknown':outcome(Boolean(recorded.entries?.length),Number(current?.rank||0)===skill.rank))}
        if(['reviewed','verified'].includes(coverage)&&expected.entries?.length)for(const skill of recorded.entries||[])if(skill.rank>0&&!expected.entries.some(target=>sameName(target.name,skill.name)))add(section,'Reassign points from '+skill.name,'missing');
      }else if(section==='paragon'){
        if(expected.points!=null)add(section,'Allocate at least '+expected.points+' Paragon points',outcome(Number.isFinite(recorded.points),recorded.points>=expected.points));
        if(!expected.boards?.length)add(section,'Import board order, glyphs and paths','unknown');
        for(const board of expected.boards||[]){
          const current=recorded.boards?.find(b=>sameName(b.name,board.name));
          add(section,'Attach '+board.name+' as board '+board.order,board.order==null?'unknown':outcome(Boolean(recorded.boards?.length),Boolean(current&&Number(current.order)===Number(board.order))));
          if(board.rotation!=null)add(section,board.name+': rotation '+board.rotation+'°',outcome(Boolean(current&&current.rotation!=null),Number(current?.rotation)===Number(board.rotation)));
          if(board.glyph)add(section,board.name+': '+board.glyph+' glyph level '+(board.glyphLevel??'?'),board.glyphLevel==null?'unknown':outcome(Boolean(current?.glyph),sameName(current?.glyph,board.glyph)&&Number(current?.glyphLevel||0)>=board.glyphLevel));
          // Imported planners list every allocated cell ("[31] Node 31"). Check named nodes individually and
          // the unnamed stat path as one item, so the checklist stays readable.
          const named=(board.nodes||[]).filter(n=>!isPathNode(n)),pathCount=(board.nodes||[]).length-named.length;
          for(const node of named)add(section,board.name+': allocate '+nodeName(node),outcome(Boolean(current?.nodes?.length),Boolean(current?.nodes?.some(n=>sameName(nodeName(n),nodeName(node))))));
          if(board.pathNotes)add(section,board.name+': confirm path — '+board.pathNotes,current?.pathConfirmed===true&&sameName(current.pathNotes,board.pathNotes)?'met':'unknown');
          else if(pathCount)add(section,board.name+': follow the planner path ('+(board.nodes||[]).length+' nodes, see the board map)',current?.pathConfirmed===true?'met':'unknown');
        }
      }else if(section==='mercenaries'){
        if(!expected.hired&&!expected.reinforcement&&!expected.entries?.length)add(section,'Import mercenary choices and allocations','unknown');
        for(const role of ['hired','reinforcement'])if(expected[role])add(section,role+': '+expected[role],outcome(Boolean(recorded[role]),sameName(recorded[role],expected[role])));
        for(const skill of expected.entries||[]){const current=recorded.entries?.find(s=>sameName(s.name,skill.name));add(section,'Mercenary skill '+skill.name+' rank '+(skill.rank??'?'),skill.rank==null?'unknown':outcome(Boolean(recorded.entries?.length),Number(current?.rank||0)>=skill.rank))}
      }else{
        const scope=expected.scope;
        if(scope&&(scope.realms&&!scope.realms.includes(character.realm)||scope.seasons&&character.realm==='seasonal'&&!scope.seasons.map(String).includes(String(character.season)))){add(section,'Verify '+({warplans:'War Plans',primeEvilPowers:'Prime Evil Powers'}[section]||section)+' availability for this realm / season','unknown');continue}
        if(expected.availability==='not-applicable')continue;
        if(!expected.availability||expected.availability==='unknown'){add(section,'Verify '+({warplans:'War Plans',primeEvilPowers:'Prime Evil Powers'}[section]||section)+' availability for this variant','unknown');continue}
        if(expected.availability==='optional'&&recorded.availability==='unavailable')continue;
        add(section,'Unlock '+({warplans:'War Plans',primeEvilPowers:'Prime Evil Powers'}[section]||section),outcome(recorded.availability&&recorded.availability!=='unknown',recorded.availability==='available'));
        if(expected.choice)add(section,'Select '+expected.choice,outcome(Boolean(recorded.choice),sameName(recorded.choice,expected.choice)));
        if(!expected.entries?.length&&!expected.choice)add(section,'Enter '+({warplans:'War Plans',primeEvilPowers:'Prime Evil Powers'}[section]||section)+' allocations','unknown');
        for(const node of expected.entries||[]){const current=recorded.entries?.find(s=>sameName(s.name,node.name));add(section,node.name+' rank '+(node.rank??'?'),node.rank==null?'unknown':outcome(Boolean(recorded.entries?.length),Number(current?.rank||0)>=node.rank))}
      }
    }
    const met=requirements.filter(r=>r.status==='met').length,missing=requirements.filter(r=>r.status==='missing').length,unknown=requirements.filter(r=>r.status==='unknown').length;
    return {variant,requirements:requirements.sort((a,b)=>a.priority-b.priority),met,missing,unknown,ready:requirements.length>0&&!missing&&!unknown,percent:requirements.length?Math.round(100*met/requirements.length):null};
  });
  const current=[...assessments].reverse().find(a=>a.ready)||null;
  const selectedIndex=assessments.findIndex(a=>a.variant.id===build?.activeVariantId);
  const currentIndex=current?assessments.indexOf(current):selectedIndex;
  return {assessments,current,next:assessments[currentIndex+1]||null,selected:assessments[selectedIndex]||null};
}

export function commitBuildImport(state,characterId,draft,options={}){
  if(!options.reviewed)throw new Error('Review the imported information before saving.');
  if(!draft?.name?.trim()||!draft.slots||typeof draft.slots!=='object')throw new Error('Imported build requires a name and equipment targets.');
  const next=copy(state),character=next.characters.find(c=>c.id===characterId);
  if(!character)throw new Error('Select a character.');
  if(draft.classId&&draft.classId!==character.classId)throw new Error('Build class does not match the selected character.');
  if(options.activate&&character.realm==='seasonal'&&draft.season&&character.season&&String(draft.season)!==String(character.season))throw new Error('Build season differs from this character. Save to the repository without activating, or choose a matching character.');
  const previous=options.existingId?next.builds.find(b=>b.id===options.existingId&&b.characterId===characterId):null;
  if(options.existingId&&!previous)throw new Error('Build to refresh not found for this character.');
  const saved={...copy(draft),id:previous?.id||id(),characterId,status:options.activate?'active':'saved',verifiedAt:now(),updatedAt:now(),createdAt:previous?.createdAt||now()};
  saved.variants||=[];
  const oldPhase=previous?.variants?.find(v=>v.id===previous.activeVariantId)?.name;
  saved.activeVariantId=options.variantId||saved.variants.find(v=>v.name===oldPhase)?.id||draft.activeVariantId||saved.variants[0]?.id||null;
  if(saved.activeVariantId&&!saved.variants.some(v=>v.id===saved.activeVariantId))throw new Error('Selected variant is not in the imported build.');
  for(const variant of saved.variants)for(const [section,status] of Object.entries(variant.coverage||{}))if(status==='provisional')variant.coverage[section]='reviewed';
  if(previous)next.builds[next.builds.indexOf(previous)]=saved;else{next.builds.push(saved);character.buildIds||=[];character.buildIds.push(saved.id)}
  if(options.activate)character.activeBuildId=saved.id;
  character.updatedAt=now();
  next.history.push({id:id(),at:now(),type:previous?'build_refreshed':'build_imported',characterId,buildId:saved.id,before:previous?copy(previous):null,after:copy(saved),note:options.activate?'Imported build activated; equipment and allocations preserved':'Imported build saved in repository'});
  return next;
}

// Colour bands for imported planner affixes. Maxroll's "Stat Priority" view orders each item's affixes
// (uniques by uniquePriority, other items by list order); that author ordering is mapped to the app's
// weights: #1-2 best (3), #3-4 good (2), #5+ useful (1). Greater Affix and masterwork (\u2191) targets
// count as best; affixes the planner lists as alternatives are 1. Only blank weights are filled.
/** Bring targets imported before 0.8.0 up to date: Greater Affix and masterwork lists from the planner markers. */
export function upgradeImportedTarget(target){
  if(!target||typeof target!=='object')return false;
  let changed=false;
  const affixes=Array.isArray(target.affixes)?target.affixes:[];
  if(!target.greaterAffixPriority?.length){
    const ga=target.greaterAffixTargets?.length?target.greaterAffixTargets:affixes.filter(a=>a.greaterAffix===true).map(a=>a.name);
    if(ga.length){target.greaterAffixPriority=[...ga];changed=true}
  }
  if(!target.masterworkPriority?.length){
    const mw=affixes.filter(a=>Number(a.plannerUpgrade)>0||a.masterworkTarget===true).map(a=>a.name);
    if(mw.length){target.masterworkPriority=mw;changed=true}
  }
  if(/not a verified importance ranking/i.test(target.sourceStatus||'')&&affixes.some(a=>a.priorityRank!=null)){
    target.sourceStatus='Maxroll planner target; affix importance from the planner stat priority';changed=true;
  }
  return changed;
}
export function applyPlannerAffixWeights(target){
  const list=target?.affixes;
  if(!Array.isArray(list)||!list.some(a=>a&&a.weight==null&&a.sourceAffix))return false;
  const ordered=[...list];
  if(ordered.every(a=>a.sourceAffix?.uniquePriority!=null))ordered.sort((a,b)=>a.sourceAffix.uniquePriority-b.sourceAffix.uniquePriority);
  let rank=0;
  for(const a of ordered){
    const alternative=a.alternative===true||a.sourceAffix?.hidden===true||a.primary===false;
    if(!alternative)rank++;
    if(a.weight!=null)continue;
    const marked=a.greaterAffix===true||a.masterworkTarget===true||Number(a.plannerUpgrade)>0;
    const weight=alternative?1:marked||rank<=2?3:rank<=4?2:1;
    Object.assign(a,{weight,tier:alternative?'alternative':({3:'best',2:'good',1:'useful'})[weight],priorityRank:alternative?null:rank,weightSource:'Maxroll stat priority'+(alternative?' (alternative)':' #'+rank)+(marked&&rank>2?'; Greater Affix / masterwork target':'')});
  }
  target.affixes=ordered;
  return true;
}
