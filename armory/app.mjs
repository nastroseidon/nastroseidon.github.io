import {applyPlannerAffixWeights,upgradeImportedTarget,commitBuildImport,effectiveBuild,assessProgression,saveVariant,activateVariant,itemUses,rolloverSeason,reviewWithdrawal,transferWithdrawal,createStore,createCharacter,editCharacter,stashKey,sharedStashItems,duplicateCharacter,archiveCharacter,deleteCharacter,addBuild,addItem,equipItem,switchBuild,scoreItem,priorityQueue,compatibleCharacters,stageGuideImport,applyGuideReview,diffBuild,rollPercent,affixPlan,importArmory} from './src/core.mjs';
import {parseGuideText,parseItemText} from './src/extract.mjs';
import {parseTooltip,extractTooltip} from './src/item-ocr.mjs';
import {APP_VERSION} from './src/version.mjs';
import {gradeItem,improvementPlan,recommendation,aspectMatch} from './src/item-grade.mjs';
import {howToGet,nextStep,nextTargetFor,equippedMatches,catalogEntry} from './src/acquisition.mjs';
import {githubClient,runSync} from './src/sync.mjs';
import {importSavedGuide} from './src/importers/guide-pages.mjs';
import {searchItems,matchItemName,identifyItem,applyCatalogItem,affixChoices,allAffixChoices,filterChoices,canonicalChoice,resolveTypeName,typesForSlot,typeByName,snapToTypePool} from './src/catalog-match.mjs';

const $=id=>document.getElementById(id);
// Editions: 'server' (local Node server on the Mac), 'portable' (single file, no server), 'web' (GitHub Pages / home screen app)
const EDITION=location.protocol==='file:'?'portable':document.querySelector('meta[name="armory-edition"]')?.content||'server';
const ON_SERVER=EDITION==='server',ON_WEB=EDITION==='web';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=value=>value===null||value===undefined||value===''?'Not captured':typeof value==='number'?value.toLocaleString():String(value);
const glyphs={necromancer:'☠',barbarian:'⚒',druid:'❋',rogue:'✣',sorcerer:'✦',spiritborn:'♜',paladin:'✝',warlock:'◆'};
const slotNames={helm:'Helm',chest:'Chest Armor',gloves:'Gloves',pants:'Pants',boots:'Boots',weapon:'Weapon',offhand:'Offhand',amulet:'Amulet',ring1:'Ring 1',ring2:'Ring 2',seal:'Seal',charm1:'Charm 1',charm2:'Charm 2',charm3:'Charm 3',charm4:'Charm 4',charm5:'Charm 5',charm6:'Charm 6',slot_8:'Bludgeoning Weapon',slot_9:'Slashing Weapon',slot_10:'Ranged Weapon',slot_11:'Dual-Wield Main Hand',slot_12:'Dual-Wield Off Hand'};
const statNames={level:'Level',paragon:'Paragon',gold:'Gold',weaponDamage:'Weapon Damage',toughness:'Toughness',intelligence:'Intelligence',strength:'Strength',willpower:'Willpower',dexterity:'Dexterity',maxLife:'Maximum Life',armor:'Armor',resistances:'Resistances',criticalStrikeChance:'Critical Strike Chance',criticalStrikeDamage:'Critical Strike Damage',attackSpeed:'Attack Speed',maxEssence:'Maximum Essence',essencePerSecond:'Essence / Second',resourceCostReduction:'Resource Cost Reduction',bloodWaveRank:'Blood Wave Rank'};
const dbName='sanctuary-armory-v2';
let initialSeed,state,view='home',selectedId=null,homeSearch='',homeFilter='all',homeSort='updated',showArchived=false,stashPool=null;
function db(){return new Promise((resolve,reject)=>{const request=indexedDB.open(dbName,1);request.onupgradeneeded=()=>request.result.createObjectStore('app');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
async function dbGet(key='state'){const d=await db();return new Promise((resolve,reject)=>{const tx=d.transaction('app','readonly');const r=tx.objectStore('app').get(key);r.onsuccess=()=>{d.close();resolve(r.result)};r.onerror=()=>{d.close();reject(r.error)}})}
async function dbPut(value,key='state'){const d=await db();return new Promise((resolve,reject)=>{const tx=d.transaction('app','readwrite');tx.objectStore('app').put(value,key);tx.oncomplete=()=>{d.close();resolve()};tx.onerror=()=>{d.close();reject(tx.error)}})}
let stateVersion=0;
async function save(){stateVersion++;try{await dbPut(state)}catch(e){toast('Storage failed: '+e.message)}scheduleSync()}

// ----- Optional sync with the user's private GitHub repository (src/sync.mjs). The token stays on this device.
const SYNC_KEY='sanctuaryArmory.sync';
function syncConfig(){try{return JSON.parse(localStorage.getItem(SYNC_KEY)||'null')}catch{return null}}
function setSyncConfig(c){try{if(c)localStorage.setItem(SYNC_KEY,JSON.stringify(c));else localStorage.removeItem(SYNC_KEY)}catch{toast('This browser won’t store settings (private browsing?). Sync can’t stay connected.')}}
function deviceName(){const ua=navigator.userAgent;return /iPhone/.test(ua)?'iPhone':/iPad/.test(ua)?'iPad':/Macintosh/.test(ua)?'Mac':/Windows/.test(ua)?'Windows PC':/Android/.test(ua)?'Android':'Browser'}
const ago=t=>{if(!t)return 'never';const m=Math.round((Date.now()-t)/60000);return m<1?'just now':m<60?m+' min ago':m<1440?Math.round(m/60)+' h ago':new Date(t).toLocaleDateString()};
function showSyncStatus(text,cls=''){const el=$('syncStatus');if(!el)return;const c=syncConfig();el.className='syncstatus '+cls;el.textContent=text||(c?.token?(c.lastError?'Sync problem · tap Sync':'Synced '+ago(c.lastSyncAt)):'Not synced · this device only');const badge=document.querySelector('.localbadge');if(badge)badge.textContent=c?.token?'● SYNCED':'● LOCAL'}
let syncRun=null,syncTimer=null,syncAgain=false,lastAutoSync=0,renderAfterModal=false;
function scheduleSync(ms=4000){if(!syncConfig()?.token)return;clearTimeout(syncTimer);syncTimer=setTimeout(()=>syncNow({quiet:true}),ms)}
async function syncNow({quiet=false}={}){
  const cfg=syncConfig();if(!cfg?.token)return null;
  if(syncRun){syncAgain=true;return syncRun}
  syncRun=(async()=>{
    const startedVersion=stateVersion,startedState=state;
    try{
      const base=await dbGet('syncBase').catch(()=>null)||null;
      const pristine=!state.characters?.length&&!state.items?.length&&!state.builds?.length;
      showSyncStatus('Syncing…','busy');
      const r=await runSync({client:githubClient(cfg),local:state,base,device:cfg.device||deviceName(),prefer:base?'local':pristine?'remote':'local',onStep:t=>showSyncStatus(t,'busy')});
      if(stateVersion===startedVersion&&state===startedState){
        if(r.pulled){state=r.state;await dbPut(state);if($('modal').open)renderAfterModal=true;else render()}
        await dbPut(r.base,'syncBase');
      }else syncAgain=true;   // edited while syncing: merge again with the old base so nothing is lost
      setSyncConfig({...syncConfig(),lastSyncAt:Date.now(),lastError:null});showSyncStatus();
      if(r.conflicts.length)toast('Synced. '+r.conflicts.length+' record'+(r.conflicts.length>1?'s were':' was')+' changed on both devices; the newer edit was kept.');
      else if(!quiet)toast(r.pulled?'Synced: changes from your other devices are in.':'Synced. Everything is up to date.');
      return r;
    }catch(error){
      setSyncConfig({...syncConfig(),lastError:error.message});showSyncStatus('Sync problem · tap Sync','error');
      if(!quiet)toast('Sync failed: '+error.message);return null;
    }finally{syncRun=null;if(syncAgain){syncAgain=false;scheduleSync(1500)}}
  })();
  return syncRun;
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&Date.now()-lastAutoSync>60000){lastAutoSync=Date.now();syncNow({quiet:true})}});
function syncDialog(){
  const c=syncConfig()||{};
  openModal('Sync across devices','PRIVATE GITHUB REPOSITORY','<p>Keep characters, builds and items the same on your iPhone and computer. Everything is stored in a <strong>private repository you own</strong>; the app talks to GitHub directly and nothing goes anywhere else. Each device keeps its own copy and works offline; changes merge record by record when it syncs.</p>'
    +(c.token?'<div class="notice">Connected to <strong>'+esc(c.owner+'/'+c.repo)+'</strong> as “'+esc(c.device||deviceName())+'”. Last sync: '+esc(ago(c.lastSyncAt))+(c.lastError?'<br>Last problem: '+esc(c.lastError):'')+'</div>':'')
    +'<details class="sectionbox"'+(c.token?'':' open')+'><summary>One-time setup (about 3 minutes)</summary><ol class="steps">'
    +'<li>On GitHub, <a href="https://github.com/new" target="_blank" rel="noopener">create a repository</a> named e.g. <code>armory-data</code>. Choose <strong>Private</strong>. Leave it empty.</li>'
    +'<li>Create a <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">fine-grained token</a>: name it “Sanctuary Armory sync”, pick an expiration, <em>Repository access → Only select repositories →</em> your data repository, <em>Permissions → Repository permissions → Contents → Read and write</em>. Generate and copy it.</li>'
    +'<li>Enter the repository and token below on each device (computer and iPhone). Start with the device that has your data.</li></ol>'
    +'<p class="muted small">The token is stored only in this browser, can only touch that one repository, and you can revoke it on GitHub at any time. Don’t paste it anywhere else.</p></details>'
    +'<form id="syncForm" class="sectionbox" autocomplete="off">'+field('Data repository (owner/name)','repo',c.owner?c.owner+'/'+c.repo:'')+'<label class="field"><span class="fieldlabel">Token'+(c.token?' (saved · leave blank to keep)':'')+'</span><input name="token" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…"></label>'+field('This device’s name','device',c.device||deviceName())
    +'<div class="toolbar"><button type="submit" class="primary">'+(c.token?'Save &amp; sync now':'Connect &amp; sync')+'</button>'+(c.token?'<button type="button" class="secondary" id="syncNowBtn">Sync now</button><button type="button" class="danger" id="syncDisconnect">Disconnect this device</button>':'')+'</div></form>');
  const f=$('syncForm');
  f.onsubmit=async e=>{
    e.preventDefault();
    const [owner,repo]=f.elements.repo.value.trim().replace(/^https:\/\/github\.com\//,'').replace(/\.git$/,'').split('/');
    const token=f.elements.token.value.trim()||c.token;
    if(!owner||!repo||!token){toast('Enter owner/name and the token.');return}
    if(/^gh[pousr]_|^github_pat_/.test(token)===false&&!c.token){if(!confirm('That doesn’t look like a GitHub token. Use it anyway?'))return}
    const changedRepo=c.owner!==owner||c.repo!==repo;
    setSyncConfig({...c,owner,repo,token,device:f.elements.device.value.trim()||deviceName(),lastError:null,...(changedRepo?{lastSyncAt:null}:{})});
    if(changedRepo)await dbPut(null,'syncBase');
    closeModal();const r=await syncNow();if(r)toast(r.pulled?'Connected. Your data from GitHub is on this device now.':'Connected. This device’s data is saved to GitHub.');
  };
  $('syncNowBtn')?.addEventListener('click',()=>{closeModal();syncNow()});
  $('syncDisconnect')?.addEventListener('click',async()=>{if(!confirm('Remove the token from this device? Your data stays here and on GitHub.'))return;setSyncConfig(null);await dbPut(null,'syncBase');closeModal();showSyncStatus();toast('This device is no longer syncing.')});
}
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),4500)}
function char(){return state.characters.find(c=>c.id===selectedId)||state.characters[0]||null}
function statEntries(c,b){
  const custom=state.settings?.statLabels?.[c.classId];
  if(custom)return Object.entries({...statNames,...custom}).filter(([key])=>key==='bloodWaveRank'?Boolean(b?.trackedStats?.includes(key)):!['maxEssence','essencePerSecond'].includes(key)||key in custom);
  return Object.entries(statNames).filter(([key])=>key==='bloodWaveRank'?Boolean(b?.trackedStats?.includes(key)):['maxEssence','essencePerSecond'].includes(key)?c.classId==='necromancer':true);
}
function build(c=char()){return effectiveBuild(savedBuild(c))}
function poolLabel(record){return record?.realm==='eternal'?'Eternal':record?.realm==='seasonal'?'Seasonal · Season '+(record.season||'unassigned'):'Character type unassigned'}
function selectedStash(){
  const key=stashPool||stashKey(char())||'eternal';
  return key==='eternal'?{realm:'eternal',season:null}:{realm:'seasonal',season:key.slice(9)};
}
function targetSlot(b,slot){return b?.slots?.[slot]?slot:slot?.startsWith('charm')?'charms':slot}
function itemFor(c,slot){return state.items.find(i=>i.id===c?.equipment?.[slot])||null}
function activeTargets(b){return Object.entries(b?.slots||{}).filter(([slot])=>slot!=='charms')}
function completion(c){const b=build(c),q=priorityQueue(b,c.equipment,state.items);return q.length?Math.round(100*q.filter(x=>x.status==='ready').length/q.length):0}
function button(label,action,id='',cls='secondary'){return '<button class="'+cls+'" data-action="'+action+'" data-id="'+esc(id)+'">'+esc(label)+'</button>'}
function field(label,name,value='',type='text'){return '<label class="field"><span class="fieldlabel">'+esc(label)+'</span><input name="'+esc(name)+'" type="'+type+'" value="'+esc(value??'')+'"></label>'}
function select(label,name,options,value){return '<label class="field"><span class="fieldlabel">'+esc(label)+'</span><select name="'+esc(name)+'">'+options.map(o=>{const v=typeof o==='object'?o.value:o,l=typeof o==='object'?o.label:o;return '<option value="'+esc(v)+'" '+(String(v)===String(value)?'selected':'')+'>'+esc(l)+'</option>'}).join('')+'</select></label>'}
function panel(title,subtitle,body){return '<section class="panel"><div class="panelhead"><div class="eyebrow">SANCTUARY RECORD</div><h2>'+esc(title)+'</h2><p>'+esc(subtitle)+'</p></div><div class="panelbody">'+body+'</div></section>'}
function openModal(title,eyebrow,content){if($('modal').open)$('modal').close();delete $('modal').dataset.detail;$('modal').classList.remove('wide');$('modalTitle').textContent=title;$('modalEyebrow').textContent=eyebrow;$('modalContent').innerHTML=content;$('modal').showModal()}
function closeModal(){$('modal').close()}
function render(){document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active',n.dataset.view===view));$('crumb').textContent=({home:'CHARACTER ARCHIVE',dashboard:'CHARACTER DASHBOARD',inventory:'SHARED INVENTORY',builds:'BUILD LIBRARY',history:'CHANGE HISTORY',seasons:'SEASON ROLLOVER',progression:'BUILD PROGRESSION'})[view];$('main').innerHTML=({home:renderHome,dashboard:renderDashboard,inventory:renderInventory,builds:renderBuilds,history:renderHistory,seasons:renderSeasons,progression:renderProgression})[view]()}
function charCard(c){
  const b=build(c),q=priorityQueue(b,c.equipment,state.items),high=q.find(x=>x.status!=='ready');
  const pct=completion(c),glyph=glyphs[c.classId]||'✦';
  return '<article class="character class-'+esc(c.classId)+'" data-glyph="'+esc(glyph)+'"><div class="characterbody"><span class="class">'+esc(c.classId)+' · '+esc(poolLabel(c))+'</span><h2>'+esc(c.name)+'</h2><div class="charstats"><span>Level '+fmt(c.level)+'</span><span>Paragon '+fmt(c.paragon)+'</span><span>Current build: '+esc(b?.name||'None')+'</span></div><div class="progress"><span style="width:'+pct+'%"></span></div><small>'+pct+'% target slots ready · Next: '+esc(high?.name||'Choose a build')+'</small><div class="cardfoot"><small>Updated '+esc(String(c.updatedAt||'').slice(0,10))+'</small>'+button('Open','open-character',c.id,'primary')+'</div><div class="toolbar" style="margin-top:10px">'+button('Edit','edit-character',c.id,'quiet')+button('Duplicate','duplicate-character',c.id,'quiet')+button(c.archived?'Restore':'Archive','archive-character',c.id,'quiet')+button('Delete','delete-character',c.id,'danger')+'</div></div></article>';
}
function renderHome(){
  let chars=state.characters.filter(c=>showArchived||!c.archived).filter(c=>homeFilter==='all'||c.classId===homeFilter).filter(c=>c.name.toLowerCase().includes(homeSearch.toLowerCase()));
  if(homeSort==='name')chars.sort((a,b)=>a.name.localeCompare(b.name));
  if(homeSort==='updated')chars.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  if(homeSort==='completion')chars.sort((a,b)=>completion(b)-completion(a));
  return '<div class="page"><div class="heading"><div><div class="eyebrow">YOUR HEROES</div><h1>Character Archive</h1><p class="lead">Every build, item and decision in one local armory. Open a character to see the next useful upgrade.</p></div>'+button('+ Create Character','create-character','','primary')+'</div><div class="headingcontrols" style="margin-bottom:20px"><input id="homeSearch" class="search" placeholder="Search characters" value="'+esc(homeSearch)+'" aria-label="Search characters"><select id="homeFilter" class="select" aria-label="Filter class"><option value="all">All classes</option>'+Object.keys(glyphs).map(k=>'<option '+(homeFilter===k?'selected':'')+'>'+k+'</option>').join('')+'</select><select id="homeSort" class="select" aria-label="Sort characters"><option value="updated">Recently updated</option><option value="name" '+(homeSort==='name'?'selected':'')+'>Name</option><option value="completion" '+(homeSort==='completion'?'selected':'')+'>Completion</option></select><label class="muted"><input type="checkbox" id="showArchived" '+(showArchived?'checked':'')+'> Show archived</label></div><div class="gridcards">'+(chars.length?chars.map(charCard).join(''):'<div class="empty">No characters match this view.</div>')+'</div></div>';
}
function getQueue(c,b){
  const computed=priorityQueue(b,c.equipment,state.items).filter(x=>x.status!=='ready');
  const extras=(b?.priorityQueue||[]).filter(x=>x.status!=='completed').map(x=>({...x,slot:null,priority:Number(x.priority)||99}));
  return [...computed,...extras.map(x=>({...x,urgency:100/x.priority+15}))].sort((a,b)=>b.urgency-a.urgency||String(a.name).localeCompare(String(b.name)));
}
function entryHtml(item,slot,b,rank,kind){
  const target=b?.slots?.[targetSlot(b,slot)];
  const score=item?scoreItem({...item,slot:targetSlot(b,slot)},b):null;
  const pos=item?.power?rollPercent(item.power):null;
  const correctUnique=item&&['Unique','Mythic'].includes(item.rarity)&&target?.name===item.name;
  const badge=!item?'Missing':!target?'Targets not imported':correctUnique?'Correct Unique / review rolls':item.power?.name===target?.aspect?'Correct aspect / review base':score?.complete?'On target':score?.missing?.length>=2?'Upgrade item':'Review';
  const plan=affixPlan(target),summary=kind!=='queue'?'<div class="targetsummary"><span>Target base affixes</span>'+plan.primary.map((a,i)=>'<div class="a'+a.weight+'">'+(i+1)+'. '+esc(a.name)+'</div>').join('')+(plan.greaterAffixPriority.length?'<p>Seek GA: '+esc(plan.greaterAffixPriority.join(' → '))+'</p>':'')+(plan.masterworkPriority.length?'<p>Blacksmith: '+esc(plan.masterworkPriority.join(' → '))+'</p>':'')+'</div>':'';
  return '<button class="entry '+(!item?'missing':'')+'" data-action="item-detail" data-id="'+esc(kind==='queue'?slot:item?.id||slot)+'" data-slot="'+esc(slot||'')+'"><div class="entrytop"><span>'+esc(slotNames[slot]||slot||'Objective')+'</span><span>#'+rank+'</span></div><strong>'+esc(item?.name||target?.name||'Unrecorded item')+'</strong><p class="'+(item&&target?.aspect&&item.power?.name?(item.power.name.toLowerCase()===target.aspect.toLowerCase()?'a3':'a0'):'')+'">'+esc(item?.power?.name||target?.aspect||target?.item||'Open for acquisition details')+(item?.power?.value!=null?' · '+item.power.value+(item.power.unit||''):'')+'</p>'+(pos!==null?'<div class="rollbar"><span style="width:'+pos+'%"></span></div>':'')+'<span class="pill '+(!item?'bad':score?.complete?'good':'prov')+'">'+esc(badge)+'</span>'+(pos!==null&&pos>=75?'<span class="pill" style="margin-left:5px;color:var(--pink)">Top 25% roll</span>':'')+summary+'</button>';
}
function renderDashboard(){
  const c=char();if(!c)return '<div class="page"><div class="empty">Create a character to begin.</div></div>';
  const b=build(c),q=getQueue(c,b);
  const ranked=priorityQueue(b,c.equipment,state.items).map(x=>x.slot);
  const slots=[...ranked.filter(s=>c.equipment[s]),...Object.keys(c.equipment||{}).filter(s=>!ranked.includes(s))];
  const gear=slots.filter(x=>x!=='seal'&&!x.startsWith('charm'));
  const talisman=slots.filter(x=>x==='seal'||x.startsWith('charm'));
  const stats=statEntries(c,b).map(([key,label])=>'<div class="statrow"><span>'+esc(label)+'</span><span>'+esc(fmt(c.stats?.[key]??c[key]))+'</span></div>').join('');
  const queueBody=q.map((x,i)=>x.slot?entryHtml(x.item,x.slot,b,i+1,'queue'):'<button class="entry missing" data-action="queue-detail" data-id="'+esc(x.id)+'"><div class="entrytop"><span>'+esc(x.group||'Objective')+'</span><span>#'+(i+1)+'</span></div><strong>'+esc(x.name)+'</strong><p>'+esc(x.status||'review')+'</p><span class="pill prov">Provisional source</span></button>').join('');
  return '<div class="page"><div class="eyebrow">'+esc(c.classId)+' · '+esc(poolLabel(c))+' · '+esc(b?.stage||'No stage')+'</div><div class="heading"><div><h1>'+esc(c.name)+'</h1><p class="lead">Current build: <strong>'+esc(b?.name||'None')+'</strong> · Shared stash: '+esc(poolLabel(c))+'</p><p class="lead">Level '+fmt(c.level)+' · Paragon '+fmt(c.paragon)+' · '+esc(c.patch||'Patch unverified')+' · '+completion(c)+'% target slots ready</p></div><div class="headingcontrols">'+button('Edit Stats','edit-stats',c.id,'quiet')+button('Switch Build','switch-build',c.id,'secondary')+button('Scan New Drop','scan-item',c.id,'primary')+'</div></div><div class="notice">'+(c.buildReviewRequired?'Season rollover recorded: review seasonal powers, skills and saved build requirements for Eternal. ':'')+'Build targets and farming routes follow this saved profile. Check its source status and game version before investing materials.</div><div class="four">'+panel('Missing & Upgrades','Highest impact first',queueBody||'<div class="empty">'+(Object.keys(b?.slots||{}).length?'No open targets.':'Equipment targets have not been imported for this variant.')+'</div>')+panel('Character Stats','Snapshot and progression',stats+'<p class="muted" style="font-size:.73rem">Stats snapshot: '+esc(c.statsSnapshot||'not recorded')+'</p>')+panel('Equipped Gear','Equipment and jewelry in priority order',gear.map((slot,i)=>entryHtml(itemFor(c,slot),slot,b,i+1,'gear')).join('')||'<div class="empty">No equipped gear.</div>')+panel('Talisman','Seal and Charms in priority order',talisman.map((slot,i)=>entryHtml(itemFor(c,slot),slot,b,i+1,'talisman')).join('')||'<div class="empty">No Talisman recorded.</div>')+'</div><section class="sectionbox"><h2>Build source & state</h2><p>'+esc(b?.sourceStatus||'No build source recorded')+'</p><div class="toolbar">'+button('Edit Build Targets','edit-build',b?.id||'','secondary')+button('Refresh Build','refresh-build',b?.id||'','quiet')+'</div></section>'+progressionSummary(c)+dashboardExtras(c,b)+'</div>';
}
function renderInventory(){
  const scope=selectedStash(),key=stashKey(scope),items=sharedStashItems(state.items,scope);
  const pools=new Map([['eternal',{realm:'eternal'}]]);
  for(const record of [...state.characters,...state.items]){const k=stashKey(record);if(k)pools.set(k,record)}
  if(key)pools.set(key,scope);
  const people=state.characters.filter(c=>stashKey(c)===key);
  const unassigned=state.items.filter(i=>i.location==='stash'&&!stashKey(i));
  const options=[...pools].sort(([a],[b])=>a.localeCompare(b)).map(([k,r])=>'<option value="'+esc(k)+'" '+(k===key?'selected':'')+'>'+esc(poolLabel(r))+'</option>').join('');
  return '<div class="page"><div class="heading"><div><div class="eyebrow">SHARED STORAGE</div><h1>'+esc(poolLabel(scope))+' Stash</h1><p class="lead">Characters share storage by Seasonal or Eternal status. Seasonal storage is kept separate for each season.</p></div>'+button('Scan or Add Item','scan-item','','primary')+'</div><div class="headingcontrols"><label class="field"><span class="fieldlabel">Shared stash</span><select id="stashPool">'+options+'</select></label></div><div class="uselabel">Character:</div><div class="personlist">'+(people.map(c=>'<div>'+esc(c.name)+'</div>').join('')||'<div>No saved characters in this stash</div>')+'</div><p class="muted">'+items.length+' stored items. All classes can share this stash; equipping still checks class restrictions.</p>'+(unassigned.length?'<div class="notice">'+unassigned.length+' stored items have unassigned character type or season. Set these fields in their item records before they can enter a shared stash.</div>':'')+'<div class="toolbar">'+button('Season Rollover & Withdrawals','open-seasons','','secondary')+'</div><div class="list">'+(items.length?items.map(i=>'<div class="row"><div><strong>'+esc(i.name)+'</strong><small>'+esc(slotNames[i.slot]||i.slot)+' · '+esc(poolLabel(i))+'</small></div><div class="rowactions">'+button('Inspect','item-detail',i.id,'quiet')+button('Compare','compare-item',i.id,'secondary')+'</div></div>').join(''):'<div class="empty">No items in this stash. Scan an item and choose Store to add it here.</div>')+'</div>'+(unassigned.length?'<section class="sectionbox"><h2>Unassigned storage</h2>'+unassigned.map(i=>'<div class="row"><strong>'+esc(i.name)+'</strong>'+button('Inspect / Assign','item-detail',i.id,'quiet')+'</div>').join('')+'</section>':'')+'</div>';
}
const setupLabels={gear:'Equipment & Talisman',skills:'Skills',paragon:'Paragon',mercenaries:'Mercenaries',warplans:'War Plans',primeEvilPowers:'Prime Evil Powers'};
let progressionBuildId=null,progressionVariantId=null;
function savedBuild(c=char()){return state.builds.find(b=>b.id===c?.activeBuildId)||null}
function progressionSummary(c){
  const b=savedBuild(c);if(!b?.variants?.length)return '';
  const result=assessProgression(b,c,state.items);
  return '<section class="sectionbox"><div class="eyebrow">BUILD PROGRESSION</div><h2>'+esc(b.name)+' · '+esc(result.selected?.variant.name||'Choose variant')+'</h2><p>Assessed phase: <strong>'+esc(result.current?.variant.name||'Not yet determined')+'</strong>. '+(result.current?'All recorded requirements for this phase are met.':'Requirements or current setup are still unverified; the saved phase is not a readiness verdict.')+'</p><p>Next comparison: '+esc(result.next?.variant.name||'No later saved variant')+(result.next?' · '+result.next.missing+' unmet checks · '+result.next.unknown+' need verification':'')+'</p>'+button('View Variants & Paragon','open-progression',b.id,'primary')+'</section>';
}
function requirementRows(assessment,section){
  const rows=assessment.requirements.filter(r=>r.section===section);
  return rows.length?rows.map(r=>'<div class="row requirement"><div><strong>'+esc(r.label)+'</strong>'+(r.details?'<small>'+esc(r.details)+'</small>':'')+'</div><span class="pill '+(r.status==='met'?'good':r.status==='missing'?'bad':'prov')+'">'+esc(r.status==='unknown'?'Needs verification':r.status==='missing'?'Needed':'Met')+'</span></div>').join(''):'<p class="muted">'+(assessment.variant.coverage?.[section]==='not-provided'?'The guide does not specify this optional section. It is excluded from this guide’s readiness checklist.':'Explicitly marked not applicable for this variant.')+'</p>';
}
function boardNodesCell(b){
  const plain=n=>/^\[\d+\]\s*(Node \d+|Board Attachment Gate|Glyph Socket|Start(ing)? Node)$/i.test(String(n).trim());
  const named=b.nodes.filter(n=>!plain(n)).map(n=>String(n).replace(/^\[\d+\]\s*/,''));
  return (named.length?'<div class="nodechips">'+named.map(n=>'<span class="chip">'+esc(n)+'</span>').join('')+'</div>':'')+'<small>'+b.nodes.length+' nodes on this board'+(named.length&&named.length<b.nodes.length?' · '+named.length+' named, the rest are stat nodes on the path':'')+'</small>';
}
function boardTable(paragon){
  const boards=paragon?.boards||[];
  return (paragon?.points!=null?'<p>Paragon points: '+esc(paragon.points)+'</p>':'')+(boards.length?'<div class="tablewrap"><table class="boardtable"><thead><tr><th>Order</th><th>Board / Rotation</th><th>Glyph / Level</th><th>Nodes & path</th></tr></thead><tbody>'+[...boards].sort((a,b)=>(a.order||0)-(b.order||0)).map(b=>'<tr><td>'+esc(b.order||'?')+'</td><td>'+esc(b.name)+'<small>'+esc(b.rotation??'?')+'°</small></td><td>'+esc(b.glyph||'Not recorded')+'<small>Level '+esc(b.glyphLevel??'?')+'</small></td><td>'+((b.nodes||[]).length?boardNodesCell(b):'Not recorded')+(b.pathNotes?'<small>'+esc(b.pathNotes)+'</small>':'')+'</td></tr>').join('')+'</tbody></table></div>':'<p class="muted">Board order and glyph setup have not been captured.</p>');
}
function sourceAnchor(url,label='Open saved guide'){
  return /^https:\/\//i.test(url||'')?'<a target="_blank" rel="noopener" href="'+esc(url)+'">'+esc(label)+'</a>':'<span class="muted">No source URL</span>';
}
function renderProgression(){
  const b=state.builds.find(b=>b.id===progressionBuildId)||savedBuild(),c=state.characters.find(c=>c.id===b?.characterId);
  if(!b||!c)return '<div class="page"><div class="empty">Choose a saved build first.</div></div>';
  const result=assessProgression(b,c,state.items),selected=result.assessments.find(a=>a.variant.id===(progressionVariantId||b.activeVariantId))||result.assessments[0];
  const cards=result.assessments.map(a=>'<article class="phasecard '+(a.variant.id===selected?.variant.id?'selected':'')+'"><div class="eyebrow">'+(a.variant.id===b.activeVariantId?'CURRENT TARGET':'SAVED VARIANT')+'</div><h2>'+esc(a.variant.name)+'</h2><p>'+a.met+' met · '+a.missing+' needed · '+a.unknown+' unverified</p><span class="pill '+(a.ready?'good':'prov')+'">'+(a.ready?'Recorded requirements met':'Not yet confirmed ready')+'</span><div class="toolbar">'+button('Inspect Variant','inspect-variant',b.id+'::'+a.variant.id,'quiet')+button('Use Variant','use-variant',b.id+'::'+a.variant.id,'secondary')+'</div></article>').join('');
  const details=selected?'<section class="sectionbox"><div class="heading"><div><h2>'+esc(selected.variant.name)+' requirements</h2><p>'+esc(selected.variant.sourceStatus||'Requirements need source review')+'</p>'+sourceAnchor(selected.variant.sourceUrl||b.sourceUrl||b.sources?.[0]?.url)+'</div><div class="toolbar">'+button('Edit Setup Targets','edit-variant',b.id+'::'+selected.variant.id,'primary')+button('Edit Gear Targets','edit-variant-gear',b.id+'::'+selected.variant.id,'secondary')+'</div></div>'+Object.entries(setupLabels).map(([key,label])=>setupSectionHtml(b,c,selected,key,label)).join('')+plannerViewerHtml(b,selected.variant)+buildExtrasHtml(selected.variant)+(selected.variant.images?.length?'<details><summary>Saved planner screenshots</summary>'+selected.variant.images.map(src=>'<img class="preview" src="'+esc(src)+'" alt="Saved variant reference">').join('')+'</details>':'')+'</section>':'';
  const next=result.next;
  return '<div class="page"><div class="eyebrow">BUILD REPOSITORY / PROGRESSION</div><div class="heading"><div><h1>'+esc(b.name)+'</h1><p class="lead">Character: '+esc(c.name)+' · '+esc(classLabel(c.classId))+' · '+esc(poolLabel(c))+'</p><p>Saved variant: '+esc(result.selected?.variant.name||'None')+' · Assessed phase: <strong>'+esc(result.current?.variant.name||'Not yet determined')+'</strong></p></div><div class="toolbar">'+button('Record Current Setup','edit-current-setup',c.id,'primary')+button('+ Add Variant','new-variant',b.id,'secondary')+'</div></div><div class="notice">A phase is confirmed only when its requirements are reviewed and its recorded checks are met. Missing guide data and unknown current allocations never count as completed. Switching targets does not equip gear or respec the character.</div><div class="phasegrid">'+(cards||'<div class="empty">Add a variant to begin progression tracking.</div>')+'</div><section class="sectionbox"><h2>Next variant: '+esc(next?.variant.name||'No later saved variant')+'</h2><p>'+(result.current?'Based on the highest confirmed phase.':'Based on your saved target variant; current phase is still unconfirmed.')+'</p>'+(next?'<p>'+next.missing+' unmet requirements · '+next.unknown+' need verification.</p>'+'<details><summary>View next variant checklist</summary>'+next.requirements.filter(r=>r.status!=='met').map(r=>'<div class="row"><div><small>'+esc(setupLabels[r.section])+'</small><strong>'+esc(r.label)+'</strong></div><span class="pill '+(r.status==='missing'?'bad':'prov')+'">'+esc(r.status==='missing'?'Needed':'Verify')+'</span></div>').join('')+'</details>':'<p>No next phase has been defined. Add one if this guide has more variants.</p>')+'</section>'+details+'<section class="sectionbox"><h2>Availability & game version</h2><p>Prime Evil Powers are documented through the Season 15 questline. Starting a character in Seasonal does not by itself confirm Eternal availability. The announced carryover content does not explicitly confirm this entire power tree; verify before using it on Eternal.</p><p>War Plans availability and allocations are recorded per variant. Do not import a new season’s system into an older saved profile automatically.</p>'+sourceAnchor('https://news.blizzard.com/en-us/article/24295394/celebrate-30-years-of-diablo-in-season-of-hell-s-legacy','Blizzard Season 15 systems')+' · '+sourceAnchor('https://news.blizzard.com/en-us/article/24316979/advance-the-war-against-death-in-season-of-tyraels-gambit','Blizzard announced carryover')+'</section></div>';
}
function setupTextarea(label,name,value,hint=''){
  return '<label class="field"><span class="fieldlabel">'+esc(label)+'</span>'+(hint?'<small class="muted">'+esc(hint)+'</small>':'')+'<textarea name="'+esc(name)+'" rows="4">'+esc(value||'')+'</textarea></label>';
}
function entryText(section){return (section?.entries||[]).map(e=>e.name+' | '+(e.rank??'')).join('\n')}
function setupFields(data,variantMode){
  const coverage=key=>variantMode?select('Requirement source status','coverage_'+key,[{value:'unknown',label:'Unknown — source needed'},{value:'provisional',label:'Provisional — not yet checked'},{value:'reviewed',label:'Reviewed against guide'},{value:'not-applicable',label:'Not applicable to this variant'},{value:'not-provided',label:'Guide does not specify this section'}],data.coverage?.[key]||'unknown'):'';
  let html=variantMode?'<fieldset class="targeteditor"><legend>Equipment & Talisman</legend>'+coverage('gear')+'<p>Use Edit Gear Targets to manage this variant’s items, affixes and aspects independently.</p></fieldset>':'';
  html+='<fieldset class="targeteditor"><legend>Skills</legend>'+coverage('skills')+setupTextarea('Skill allocations','skills',entryText(data.skills),'One skill per line: Skill name | Rank. Include passive ranks you need to check.')+'</fieldset>';
  const boards=(data.paragon?.boards||[]).map(b=>[b.order,b.name,b.rotation??'',b.glyph||'',b.glyphLevel??'',(b.nodes||[]).join(', '),b.pathNotes||''].join(' | ')).join('\n');
  html+='<fieldset class="targeteditor"><legend>Paragon</legend>'+coverage('paragon')+field(variantMode?'Required allocated points':'Currently allocated points','paragonPoints',data.paragon?.points??'','number')+setupTextarea('Ordered boards, glyphs and nodes','boards',boards,'One board per line: Order | Board name | Rotation (0/90/180/270) | Glyph | Glyph level | Node names, separated by commas | Path notes')+(!variantMode?'<label><input type="checkbox" name="pathsConfirmed" '+(data.paragon?.boards?.length&&data.paragon.boards.every(b=>b.pathConfirmed)?'checked':'')+'> I checked these recorded board paths against the guide.</label>':'')+'</fieldset>';
  html+='<fieldset class="targeteditor"><legend>Mercenaries</legend>'+coverage('mercenaries')+field('Hired mercenary','hired',data.mercenaries?.hired||'')+field('Reinforcement','reinforcement',data.mercenaries?.reinforcement||'')+setupTextarea('Mercenary skill allocations','mercSkills',entryText(data.mercenaries),'One per line: Mercenary skill / node name | Rank')+'</fieldset>';
  for(const key of ['warplans','primeEvilPowers'])html+='<fieldset class="targeteditor"><legend>'+esc(setupLabels[key])+'</legend>'+coverage(key)+(variantMode?select('Applies to realm',key+'_realm',[{value:'',label:'Unspecified — verify source'},{value:'seasonal',label:'Seasonal'},{value:'eternal',label:'Eternal'},{value:'both',label:'Both'}],data[key]?.scope?.realms?.length===2?'both':data[key]?.scope?.realms?.[0]||'')+field('Applicable season (blank = unspecified)',key+'_season',data[key]?.scope?.seasons?.join(', ')||''):'')+select(variantMode?'Variant availability':'Character availability',key+'_availability',variantMode?[{value:'unknown',label:'Unknown'},{value:'required',label:'Required'},{value:'optional',label:'Optional'},{value:'not-applicable',label:'Not applicable'}]:[{value:'unknown',label:'Unknown'},{value:'available',label:'Available / unlocked'},{value:'unavailable',label:'Unavailable / locked'}],data[key]?.availability||'unknown')+field(key==='primeEvilPowers'?'Selected Prime Evil / Splinter':'Plan / tree name',key+'_choice',data[key]?.choice||'')+setupTextarea('Allocations',key+'_entries',entryText(data[key]),'One per line: Power / tree node name | Rank')+'</fieldset>';
  return html+setupTextarea('Class mechanics / rotation / notes','setupNotes',data.notes||'')+'<label class="field"><span class="fieldlabel">Attach planner or setup screenshots</span><input id="setupImages" type="file" multiple accept="image/*"></label>';
}
function readSetupForm(form,previous={}){
  const f=new FormData(form),read=name=>String(f.get(name)||'').trim();
  const number=(value,label)=>{if(value==='')return null;const n=Number(value);if(!Number.isFinite(n)||n<0||!Number.isInteger(n))throw new Error(label+' must be a nonnegative whole number');return n};
  const entries=name=>read(name).split('\n').filter(l=>l.trim()).map(line=>{const [name,rank='']=line.split('|').map(s=>s.trim());if(!name)throw new Error('Allocation name required');return {name,rank:number(rank,name+' rank')}});
  const boards=read('boards').split('\n').filter(l=>l.trim()).map(line=>{const [order='',name='',rotation='',glyph='',level='',nodes='',pathNotes='']=line.split('|').map(s=>s.trim());if(!name)throw new Error('Paragon board name required');const rot=number(rotation,'Board rotation');if(rot!=null&&![0,90,180,270].includes(rot))throw new Error('Use 0, 90, 180 or 270 for board rotation');return {order:number(order,'Board order'),name,rotation:rot,glyph,glyphLevel:number(level,'Glyph level'),nodes:nodes.split(',').map(s=>s.trim()).filter(Boolean),pathNotes,pathConfirmed:f.has('pathsConfirmed')}});
  const result={...structuredClone(previous),skills:{...previous.skills,entries:entries('skills')},paragon:{...previous.paragon,points:number(read('paragonPoints'),'Paragon points'),boards},mercenaries:{...previous.mercenaries,hired:read('hired'),reinforcement:read('reinforcement'),entries:entries('mercSkills')},notes:read('setupNotes')};
  for(const key of ['warplans','primeEvilPowers']){result[key]={...previous[key],availability:read(key+'_availability'),choice:read(key+'_choice'),entries:entries(key+'_entries')};if(f.has(key+'_realm')){const realm=read(key+'_realm'),seasons=read(key+'_season').split(',').map(s=>s.trim()).filter(Boolean);result[key].scope={...(realm?{realms:realm==='both'?['seasonal','eternal']:[realm]}:{}),...(seasons.length?{seasons}:{})}}}
  return result;
}
function variantEditor(buildId,variantId=null){
  const b=state.builds.find(b=>b.id===buildId);if(!b)return;
  const existing=b.variants?.find(v=>v.id===variantId)||{id:crypto.randomUUID(),name:'',order:b.variants?.length||0,slots:{},coverage:{}};
  openModal(existing.name||'Add Variant','VARIANT SETUP TARGETS','<form id="setupForm">'+field('Variant name','variantName',existing.name)+field('Progression order (0 = first)','variantOrder',existing.order??0,'number')+field('Variant source URL','variantUrl',existing.sourceUrl||b.sourceUrl||b.sources?.[0]?.url||'','url')+setupFields(existing,true)+'<div class="toolbar"><button class="primary" type="submit">Save Variant Targets</button></div></form>');
  $('setupForm').onsubmit=async e=>{e.preventDefault();try{const f=new FormData(e.target),v=readSetupForm(e.target,existing);v.name=String(f.get('variantName')).trim();v.order=Number(f.get('variantOrder'));v.sourceUrl=String(f.get('variantUrl')).trim();v.coverage=Object.fromEntries(Object.keys(setupLabels).map(k=>[k,String(f.get('coverage_'+k)||'unknown')]));v.sourceStatus='Manual requirements — review coverage for each section';v.images=[...(existing.images||[])];for(const image of $('setupImages').files)v.images.push(await readAsDataURL(image));state=saveVariant(state,buildId,v);progressionBuildId=buildId;progressionVariantId=v.id;await save();closeModal();view='progression';render()}catch(error){toast(error.message)}};
}
function currentSetupEditor(characterId){
  const c=state.characters.find(c=>c.id===characterId);if(!c)return;
  openModal(c.name+' — Current Setup','ACTUAL CHARACTER RECORD','<p>Record what is currently allocated in game. Switching a build or variant never changes this record. Blank fields stay unknown.</p><form id="setupForm">'+setupFields(c.setup||{},false)+'<div class="toolbar"><button class="primary" type="submit">Save Current Setup</button></div></form>');
  $('setupForm').onsubmit=async e=>{e.preventDefault();try{const before=structuredClone(c.setup||{}),setup=readSetupForm(e.target,c.setup||{});setup.recordedAt=new Date().toISOString();setup.scope={realm:c.realm,season:c.season,patch:c.patch};setup.images=[...(before.images||[])];for(const image of $('setupImages').files)setup.images.push(await readAsDataURL(image));c.setup=setup;c.updatedAt=setup.recordedAt;state.history.push({id:crypto.randomUUID(),at:setup.recordedAt,type:'character_setup_recorded',characterId:c.id,before,after:structuredClone(setup)});await save();closeModal();render()}catch(error){toast(error.message)}};
}

function dashboardExtras(c,b){
  const counts={};for(const slot of Object.keys(c.equipment||{})){const i=itemFor(c,slot);if(slot.startsWith('charm')&&i?.setName)counts[i.setName]=(counts[i.setName]||0)+1}
  const sets=Object.entries(counts).map(([name,count])=>'<div class="row"><div><strong>'+esc(name)+' · '+count+' pieces</strong><small>'+esc(Object.entries(b?.talisman?.setBonuses?.[name]||{}).filter(([k])=>/^\d+$/.test(k)&&Number(k)<=count).map(([,v])=>v).join('; ')||'Set effect unverified')+'</small></div></div>').join('');
  const codex=(state.codex||[]).filter(a=>!a.characterId||a.characterId===c.id);
  return (sets?'<section class="sectionbox"><h2>Active Talisman Sets</h2>'+sets+'</section>':'')+(codex.length?'<section class="sectionbox"><h2>Codex of Power</h2><p class="muted">'+codex.filter(a=>a.unlocked).length+' of '+codex.length+' recorded aspects unlocked</p><div class="codexgrid">'+codex.map((a,i)=>'<label><input type="checkbox" data-codex="'+esc(a.name)+'" '+(a.unlocked?'checked':'')+'> '+esc(a.name)+(a.actualRoll!=null?' · '+a.actualRoll+'%':'')+'</label>').join('')+'</div></section>':'');
}
function renderBuilds(){
  const c=char();
  return '<div class="page"><div class="heading"><div><div class="eyebrow">BUILD PROFILES</div><h1>Build Library</h1><p class="lead">Guide imports remain review drafts until you approve them. Saved builds keep their source and game version.</p></div><div class="headingcontrols">'+button('Create Manually','create-build',c?.id||'','secondary')+button('Import Guide','import-guide','','primary')+'</div></div><div class="list">'+state.builds.map(b=>{const owner=state.characters.find(c=>c.id===b.characterId);return '<div class="row"><div><span class="pill '+(b.status==='provisional'?'prov':'')+'">'+esc(b.archived?'archived':b.status)+'</span><strong>'+esc(b.name)+'</strong><small>'+esc(owner?.name||'Unassigned')+' · '+esc(b.classId||'class unknown')+' · '+esc(b.variants?.map(v=>v.name).join(' → ')||b.stage||'stage unknown')+' · Season '+esc(b.season||'?')+' · '+esc(b.patch||'patch unverified')+'</small></div><div class="rowactions">'+button('Variants & Paragon','open-progression',b.id,'primary')+button('Inspect / Edit','edit-build',b.id,'quiet')+button(b.archived?'Restore Build':'Archive Build','archive-build',b.id,'quiet')+button('Activate','activate-build',b.id,'secondary')+button('Refresh','refresh-build',b.id,'quiet')+'</div></div>'}).join('')+'</div></div>';
}
function renderHistory(){
  const entries=[...state.history].reverse();
  return '<div class="page"><div class="heading"><div><div class="eyebrow">AUDIT TRAIL</div><h1>Equipment History</h1><p class="lead">Equipment and build changes remain available after a switch or replacement.</p></div></div><div class="list">'+(entries.length?entries.map(h=>'<div class="row"><div><strong>'+esc(h.type.replaceAll('_',' '))+'</strong><small>'+esc(h.at)+' · '+esc(state.characters.find(c=>c.id===h.characterId)?.name||'Character')+'</small><div class="muted">'+esc(h.note||[h.before?.name,h.after?.name].filter(Boolean).join(' → '))+'</div></div></div>').join(''):'<div class="empty">No changes recorded yet.</div>')+'</div></div>';
}
function affixTier(affix,target){
  const a=(target?.affixes||[]).find(t=>t.name?.toLowerCase()===affix.name?.toLowerCase()||Boolean(t.id&&affix.id&&t.id===affix.id));
  return a?.weight??((target?.rejectedAffixes||[]).includes(affix.name)?0:'unknown');
}
function affixHtml(affix,target){
  const tier=affixTier(affix,target),pct=rollPercent(affix);
  return '<div class="affix a'+tier+'"><span>'+esc(affix.name)+' <small class="muted">'+esc(affix.kind||'')+'</small></span><span>'+esc(affix.value??'?')+esc(affix.unit==='flat'?'':affix.unit||'')+(affix.greaterAffix?' <span class="pink">Greater Affix</span>':'')+(pct!==null&&pct>=75?' <span class="pink">Top 25% · '+pct+'%</span>':pct!==null?' <small>'+pct+'% roll</small>':'')+'</span></div>';
}
function targetHtml(target,currentItem=null){
  if(!target)return '<p class="muted">No build target recorded.</p>';
  const plan=affixPlan(target);
  const rows=list=>list.map((a,i)=>'<div class="affix a'+a.weight+'"><span>'+(i+1)+'. '+esc(a.name)+'</span><span>'+esc(a.tier||'recommended')+(a.priorityRank?' · Maxroll priority #'+a.priorityRank:'')+(a.idealValue!=null?' · '+esc(a.idealValue):'')+'</span></div>').join('');
  const available=currentItem?plan.masterworkPriority.filter(name=>(currentItem.affixes||[]).some(a=>a.name.toLowerCase()===name.toLowerCase())):[];
  return '<p><strong>'+esc(target.name||'Item identity not specified')+'</strong></p><p class="muted">'+(plan.affixSlots?plan.affixSlots+' base-affix targets':'Affix count depends on item')+'</p><div class="list">'+rows(plan.primary)+'</div>'+(plan.alternatives.length?'<details><summary>Alternative affixes</summary>'+rows(plan.alternatives)+'</details>':'')+'<h3>Greater Affixes to seek on drops</h3><p>'+esc(plan.greaterAffixPriority.join(' → ')||'Not specified — review build')+'</p><h3>Blacksmith capstone priority</h3><p>'+esc(plan.masterworkPriority.join(' → ')||'No verified Blacksmith target')+'</p>'+(currentItem?'<p>Present on this item: '+esc(available.join(' → ')||'None of the listed priorities; improve the base before investing.')+'</p>':'')+'<p class="muted">'+esc(target.masterworkNote||'Check item eligibility and active patch before upgrading.')+'</p><p class="muted">'+esc(target.upgradeNote||'Confirm item affix pool before crafting.')+'</p><p>Aspect: '+esc(target.aspect||target.temporaryAspect||'not specified')+'</p><p>Temper: '+esc(target.temper||'not specified')+'</p>'+targetPowerHtml(target);
}
// Item catalog (game data): embedded in the portable file, served by the local server otherwise
let itemCatalog=null,catalogPromise=null;
function loadCatalog(){
  if(itemCatalog||catalogPromise)return catalogPromise||Promise.resolve(itemCatalog);
  const embedded=document.getElementById('itemCatalog');
  if(embedded){try{itemCatalog=JSON.parse(embedded.textContent)}catch{}return Promise.resolve(itemCatalog)}
  catalogPromise=fetch(ON_SERVER?'api/catalog':'data/item-catalog.json').then(r=>r.ok?r.json():null).then(c=>(itemCatalog=c)).catch(()=>null);
  return catalogPromise;
}
function classIndexOf(c,b){const i=itemCatalog?.classes?.indexOf(c?.classId||b?.classId);return i>=0?i:null}
function nextVariantOf(c){
  const saved=savedBuild(c),list=[...(saved?.variants||[])].sort((a,b)=>(a.order??99)-(b.order??99));
  const i=list.findIndex(v=>v.id===saved?.activeVariantId);
  return i>=0?list[i+1]||null:null;
}
const acqLines=lines=>lines.length?'<dl class="acqlist">'+lines.map(l=>'<dt>'+esc(l.label)+'</dt><dd>'+esc(l.text)+'</dd>').join('')+'</dl>':'';
/** Per-slot "how to get it" + "next variant" for the guide's item in this slot. */
function acquisitionHtml(c,b,slot,item){
  const key=targetSlot(b,slot),target=b?.slots?.[key];
  if(!target)return '<p class="muted">No guide item recorded for this slot.</p>';
  const ctx={catalog:itemCatalog,classIndex:classIndexOf(c,b),codex:(state.codex||[]).filter(a=>!a.characterId||a.characterId===c?.id)};
  const have=equippedMatches(item,target),lines=howToGet(target,ctx);
  const keep=new Set(['Greater Affixes','Blacksmith','Jeweler']);
  let html=have?'<p class="havebadge">✓ You have the guide’s item for this slot'+(item?.name?' ('+esc(item.name)+')':'')+'.</p>'+acqLines(lines.filter(l=>keep.has(l.label)))
    :'<p><strong>'+esc(target.name||slotNames[slot])+'</strong>'+(target.aspect&&!target.identityRequired?' with '+esc(target.aspect):'')+'</p>'+acqLines(lines);
  if(!itemCatalog)html+='<p class="muted small">Item data is still loading; boss loot tables appear once it is ready.</p>';
  const next=nextVariantOf(c);
  if(next){
    const saved=savedBuild(c),current=saved?.variants?.find(v=>v.id===saved.activeVariantId);
    const nt=nextTargetFor(key,current?.slots||b.slots,next.slots);
    const step=nt?nextStep(target,{name:next.name,target:nt},ctx):null;
    html+='<h3>Next variant: '+esc(next.name)+'</h3>'+(!Object.keys(next.slots||{}).length?'<p class="muted">'+esc(next.name)+' has no gear recorded yet. Re-import the guide link to fill in every variant.</p>':step?'<p class="nextkind '+step.kind+'">'+esc(step.title)+'</p>'+acqLines(step.lines):'<p class="muted">'+esc(next.name)+' has no item for this slot.</p>');
  }
  const notes=target.acquisition?.text||b?.acquisition?.text;
  if(notes)html+='<details class="guidenotes"><summary>Guide notes for this variant</summary><p>'+esc(notes)+'</p></details>';
  return html;
}
function classLabel(classId){return state.settings?.classes?.find(c=>c.id===classId)?.label||classId?.replace(/\b\w/g,c=>c.toUpperCase())||'Unknown class'}
function usesHtml(item){
  const uses=itemUses(item,state.characters,state.builds);
  return '<div class="itemuses"><div class="uselabel">Character:</div><div class="personlist">'+(uses.characters.map(c=>'<div>'+esc(c.name)+'</div>').join('')||'<div class="muted">No compatible saved characters</div>')+'</div><div class="uselabel">Build:</div>'+ (uses.groups.map(g=>'<div class="usebuildgroup"><div class="useclass">'+esc(classLabel(g.classId))+' -</div><div class="usebuildnames">'+g.builds.map(b=>'<div>'+esc(b.name)+'</div>').join('')+'</div></div>').join('')||'<div class="muted">No matching saved builds</div>')+'</div>';
}
function renderSeasons(){
  const seasons=[...new Set([...state.characters.filter(c=>c.realm==='seasonal').map(c=>String(c.season||'')),...state.items.filter(i=>i.realm==='seasonal').map(i=>String(i.season||'')),...(state.settings?.seasonTransitions||[]).map(s=>String(s.fromSeason))])].filter(Boolean).sort((a,b)=>Number(b)-Number(a));
  const pending=state.items.filter(i=>i.location==='withdrawal');
  const calendar=(state.settings?.seasonTransitions||[]).map(entry=>{
    const starts=new Date(entry.nextSeasonStartsAt),due=Date.now()>=starts.getTime();
    return '<div class="notice"><strong>Season '+esc(entry.nextSeason)+' starts '+esc(starts.toLocaleString('en-US',{timeZone:'America/Indiana/Indianapolis',dateStyle:'long',timeStyle:'short'}))+' Eastern</strong><p>'+ (due?'Scheduled start has passed. Confirm the rollover in game, then update your tracker.':'Upcoming season reminder. The calendar will not move characters or items.')+'</p><a target="_blank" rel="noopener" href="'+esc(entry.sourceUrl)+'">Blizzard announcement</a> · Checked '+esc(entry.verifiedAt)+'</div>';
  }).join('');
  return '<div class="page"><div class="eyebrow">MANUAL SEASON CONTROL</div><h1>Season Rollover</h1><p class="lead">The game moves Seasonal characters to Eternal. Use the switch below after confirming this in game. The tracker does not connect to your game account.</p>'+calendar+'<section class="sectionbox"><h2>Move a season to Eternal</h2><p>Characters and their equipped gear move together. Stored items enter withdrawal-only storage for individual review and manual transfer. Saved builds keep their original source season and patch.</p>'+seasons.map(season=>{const chars=state.characters.filter(c=>c.realm==='seasonal'&&String(c.season)===season),items=sharedStashItems(state.items,{realm:'seasonal',season});return '<div class="row"><div><strong>Season '+esc(season)+'</strong><div class="personlist">'+(chars.map(c=>'<div>'+esc(c.name)+'</div>').join('')||'<div class="muted">No Seasonal characters</div>')+'</div><small>'+items.length+' stored items</small></div>'+button('Review Rollover','rollover-season',season,'secondary')+'</div>'}).join('')+'</section><section class="sectionbox"><h2>Withdrawal-only storage</h2><p>Confirm each item is permitted and move it in game before recording a transfer to Eternal shared storage. Season-only and blocked items cannot transfer. Unknown items wait for review.</p><p class="muted">Blizzard’s published rollover guidance gives the following season to collect withdrawals. Confirm the current in-game deadline. This tracker never deletes records when a deadline passes.</p><a target="_blank" rel="noopener" href="https://news.blizzard.com/en-us/article/24009152/bite-down-on-darkness-in-season-of-blood">Blizzard rollover guidance (historical policy)</a><div class="list">'+(pending.map(i=>'<div class="row"><div><strong>'+esc(i.name)+'</strong><small>From Season '+esc(i.originSeason||'?')+' · '+esc(i.transferEligibility||'unknown')+'</small></div>'+button('Review / Transfer','review-withdrawal',i.id,'secondary')+'</div>').join('')||'<div class="empty">No items awaiting withdrawal.</div>')+'</div></section></div>';
}
function rolloverDialog(season){
  const chars=state.characters.filter(c=>c.realm==='seasonal'&&String(c.season)===String(season));
  const stored=sharedStashItems(state.items,{realm:'seasonal',season});
  openModal('Season '+season+' → Eternal','ROLLOVER REVIEW','<p>This updates all saved characters in this season and its shared stash.</p><div class="personlist">'+(chars.map(c=>'<div><strong>'+esc(c.name)+'</strong><div class="muted">'+esc(classLabel(c.classId))+' - '+esc(build(c)?.name||'No active build')+'</div></div>').join('')||'<div>No characters to move</div>')+'</div><p>'+stored.length+' stored items will enter withdrawal-only storage. Permitted equipped items move with each character; items flagged season-only or blocked are held for review. No saved build rules will change.</p><label class="field"><span><input id="confirmRollover" type="checkbox"> I have confirmed that this season has ended and the characters are Eternal in game.</span></label><div class="toolbar"><button id="applyRollover" class="primary" disabled>Move Season to Eternal</button></div>');
  $('confirmRollover').onchange=()=>{$('applyRollover').disabled=!$('confirmRollover').checked};
  $('applyRollover').onclick=async()=>{if(!$('confirmRollover').checked)return;state=rolloverSeason(state,season);stashPool='eternal';await save();closeModal();view='seasons';render();toast('Character rollover recorded. Stash withdrawals remain manual.')};
}
function withdrawalDialog(id){
  const item=state.items.find(i=>i.id===id);if(item?.location!=='withdrawal')return;
  openModal(item.name,'WITHDRAWAL REVIEW','<p>From Season '+esc(item.originSeason||'?')+'. Check the current item and its transfer eligibility in game. Item-specific seasonal rules are not inferred.</p>'+(item.seasonalOnly?'<div class="notice">This record is marked season-only and cannot transfer. Correct that flag in Edit Item only if the record is wrong.</div>':'')+'<form id="withdrawalForm">'+select('Transfer eligibility','eligibility',[{value:'unknown',label:'Unknown — needs review'},{value:'permitted',label:'Permitted — confirmed in game'},{value:'blocked',label:'Blocked / season-only'}],item.transferEligibility||'unknown')+field('Review notes','note',item.transferReview?.note||'')+'<label class="field"><span><input type="checkbox" name="moved"> I have manually moved this item into Eternal storage in game.</span></label><div class="toolbar"><button type="button" id="saveWithdrawalReview" class="secondary">Save Review</button><button type="submit" id="transferWithdrawal" class="primary" disabled>Record Transfer to Eternal</button>'+button('Inspect Item','item-detail',item.id,'quiet')+'</div></form>');
  const form=$('withdrawalForm'),ready=()=>{$('transferWithdrawal').disabled=form.elements.eligibility.value!=='permitted'||!form.elements.moved.checked||item.seasonalOnly===true};
  form.onchange=ready;
  const reviewed=()=>reviewWithdrawal(state,id,form.elements.eligibility.value,form.elements.note.value);
  $('saveWithdrawalReview').onclick=async()=>{try{state=reviewed();await save();closeModal();render()}catch(e){toast(e.message)}};
  form.onsubmit=async e=>{e.preventDefault();if($('transferWithdrawal').disabled)return;try{state=transferWithdrawal(reviewed(),id);await save();closeModal();render();toast('Item recorded in Eternal shared stash.')}catch(e){toast(e.message)}};
}
function itemDetail(id,slot){
  // Boss loot tables come from the item catalog: redraw once it arrives if it was not ready yet
  if(!itemCatalog)loadCatalog().then(()=>{if(itemCatalog&&$('modal').open&&$('modal').dataset.detail===(id||'')+'|'+(slot||''))itemDetail(id,slot)});
  const c=char(),b=build(c),item=state.items.find(i=>i.id===id)||itemFor(c,slot);
  slot=slot||item?.slot;
  const target=b?.slots?.[targetSlot(b,slot)];
  const score=item?scoreItem({...item,slot:targetSlot(b,slot)},b):null;
  const img=item?.images?.find(x=>x.startsWith?.('data:'));
  const sourceImg=item?.source||item?.images?.find(x=>typeof x==='string'&&!x.startsWith('img:'));
  const craft='Occultist: '+(target?.aspect?'check '+target.aspect+' imprint/affix eligibility; ':'check enchant/imprint eligibility; ')+'Blacksmith: '+(target?.temper?'target '+target.temper+' temper and masterwork after base review; ':'temper/masterwork only if eligible; ')+'Jeweler: review sockets, gems and runes. Horadric Cube: verify exact recipe, item restrictions and material cost in the active patch before use.';
  const fit=item&&target?gradeItem(item,target):null;
  const plan=fit?improvementPlan(item,target,fit,{codex:(state.codex||[]).filter(a=>!a.characterId||a.characterId===c?.id),craftingRules:state.craftingRules||[]}):null;
  const planHtml=plan?.steps?.length?(plan.potential>fit.score?'<p class="muted">Up to '+plan.potential+'/100 with the highlighted steps (new rolls assumed average).</p>':'')+plan.steps.map(st=>'<div class="step'+(st.scored?' scored':'')+'"><strong>'+esc(st.station)+': '+esc(st.action)+'</strong><p>'+esc(st.detail)+'</p></div>').join(''):'<p>'+esc(craft)+'</p>';
  const body='<div class="modalgrid"><div class="modalblock"><h3>Current item</h3>'+(fit?.score!=null?'<p class="fitline">Build fit: <strong class="'+scoreBand(fit.score)+'">'+fit.score+'/100</strong> <small class="muted">for '+esc(target.name||slotNames[slot])+'</small></p>':'')+(item?'<p><strong>'+esc(item.name)+'</strong> · '+esc(item.rarity||'')+' · '+esc(item.itemPower||'?')+' IP</p><p>'+esc(item.power?.name||'No power captured')+(item.power?.value!=null?' · '+item.power.value+esc(item.power.unit||''):'')+'</p>'+(item.affixes||[]).map(a=>affixHtml(a,target)).join(''):'<p class="muted">No equipped item recorded.</p>')+'<h3>Target affixes</h3>'+targetHtml(target,item)+'</div><div class="modalblock"><h3>How to get it</h3>'+acquisitionHtml(c,b,slot,item)+'<p class="muted small">Source: game data item tables and the imported guide. Horadric Cube recipes and Codex unlock locations are not in the game data.</p><h3>Improve this item</h3>'+planHtml+'<h3>Other uses before salvage</h3>'+usesHtml(item||{})+'</div></div>'+(item?.previousPower?'<div class="sectionbox">Previous power: '+esc(item.previousPower.name)+'</div>':'')+(img?'<img class="preview" src="'+esc(img)+'" alt="Saved item photo">':sourceImg?'<p class="muted">Original image reference: '+esc(sourceImg)+' (image file not supplied)</p>':'')+'<div class="toolbar" style="margin-top:15px">'+(item?.location==='withdrawal'?button('Review / Transfer','review-withdrawal',item.id,'primary'):'')+(item?button('Compare','compare-item',item.id,'secondary')+button('Edit Item','edit-item',item.id,'quiet'):'')+'</div><p class="muted" style="font-size:.74rem">Fit color reflects this build only. Pink marks a top-quartile numerical roll and does not change fit. Scoring is heuristic, not a damage simulation.</p>';
  openModal(item?.name||target?.name||slotNames[slot]||'Item',slotNames[slot]||'EQUIPMENT DETAIL',body);
  $('modal').dataset.detail=(id||'')+'|'+(slot||'');
}
function queueDetail(id){
  const b=build(),q=b?.priorityQueue?.find(x=>x.id===id);
  if(!q)return;
  openModal(q.name,q.group+' · PRIORITY '+q.priority,'<div class="notice">'+esc(q.status)+' · '+esc(q.sourceStatus||'provisional')+'</div><h3>Acquisition and action</h3><p>'+esc(q.how)+'</p><p class="muted">Check current patch, boss table, material costs and in-game crafting preview before spending.</p><div class="toolbar">'+button('Mark completed','complete-queue',q.id,'primary')+'</div>');
}
function characterForm(id=null){
  const c=state.characters.find(x=>x.id===id);
  const body='<form id="characterForm" class="modalgrid">'+field('Character name','name',c?.name||'')+select('Class','classId',Object.keys(glyphs),c?.classId||'necromancer')+field('Level','level',c?.level??'','number')+field('Paragon','paragon',c?.paragon??'','number')+select('Character type','realm',[{value:'seasonal',label:'Seasonal'},{value:'eternal',label:'Eternal'}],c?.realm||'seasonal')+field('Season (Seasonal characters only)','season',c?.season||'')+field('Patch','patch',c?.patch||'')+field('Last updated','updatedAt',c?.updatedAt?.slice(0,10)||new Date().toISOString().slice(0,10),'date')+'<div class="toolbar" style="grid-column:1/-1"><button class="primary" type="submit">'+(c?'Save Character':'Create Character')+'</button></div></form>';
  openModal(c?'Edit '+c.name:'Create Character','HERO RECORD',body+'<p class="muted">Character name and current build are separate. Character type determines shared stash access. Choosing Eternal for a Seasonal character opens the season rollover review. Stash withdrawals remain manual.</p>');
  const form=$('characterForm'),toggleSeason=()=>{form.elements.season.disabled=form.elements.realm.value==='eternal'};form.elements.realm.onchange=toggleSeason;toggleSeason();
  $('characterForm').onsubmit=async e=>{
    e.preventDefault();const f=new FormData(e.target),fields=Object.fromEntries(f);fields.level=fields.level===''?null:Number(fields.level);fields.paragon=fields.paragon===''?null:Number(fields.paragon);
    try{if(c?.realm==='seasonal'&&fields.realm==='eternal'){rolloverDialog(c.season);return}if(c){state=editCharacter(state,c.id,fields)}else{state=createCharacter(state,fields);selectedId=state.characters.at(-1).id}await save();closeModal();render()}catch(error){toast(error.message)}
  };
}
function statsForm(){
  const c=char();if(!c)return;
  const body='<form id="statsForm" class="modalgrid">'+statEntries(c,build(c)).map(([key,label])=>field(label,key,c.stats?.[key]??c[key]??'')).join('')+'<div class="toolbar" style="grid-column:1/-1"><button class="primary" type="submit">Save Stats</button></div></form>';
  openModal('Character Statistics',c.name+' · EDIT',body);
  $('statsForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);c.stats||={};for(const [k,v] of f)c.stats[k]=v===''?null:Number.isFinite(Number(v))?Number(v):v;c.level=c.stats.level;c.paragon=c.stats.paragon;c.statsSnapshot=new Date().toISOString();c.updatedAt=c.statsSnapshot;await save();closeModal();render()};
}
function switchBuildForm(){
  const c=char();if(!c)return;
  const builds=state.builds.filter(b=>b.characterId===c.id);
  openModal('Switch Build',c.name+' · LOADOUT','<p class="muted">Switching builds preserves currently equipped items and history. The dashboard recalculates what is missing.</p><form id="switchForm">'+select('Saved build','buildId',builds.map(x=>({value:x.id,label:x.name+' · '+(x.variants?.find(v=>v.id===x.activeVariantId)?.name||x.stage||'')})),c.activeBuildId)+'<div class="toolbar" style="margin-top:15px"><button class="primary" type="submit">Switch Build</button></div></form><div class="list" style="margin-top:15px">'+builds.map(b=>'<div class="row"><strong>'+esc(b.name)+'</strong><small>'+esc(b.stage)+' · '+esc(b.status)+'</small></div>').join('')+'</div>');
  $('switchForm').onsubmit=async e=>{e.preventDefault();try{state=switchBuild(state,c.id,new FormData(e.target).get('buildId'));await save();closeModal();render()}catch(error){toast(error.message)}};
}
function buildEditor(id=null,variantId=null){
  const parent=state.builds.find(x=>x.id===id),phase=parent?.variants?.find(v=>v.id===(variantId||parent.activeVariantId)),b=phase?{...parent,...phase,name:parent.name,stage:phase.name}:parent,c=char();
  const slots=b?.slots||{};
  const targetRow=(slot,t={})=>{
    const input=(label,key,value,type='text')=>'<label class="field"><span>'+label+'</span><input data-field="'+key+'" type="'+type+'" value="'+esc(value??'')+'"></label>';
    const plan=affixPlan(t);
    return '<fieldset class="targeteditor" data-target-slot="'+esc(slot)+'"><legend>'+esc(slotNames[slot]||slot)+'</legend><div class="modalgrid">'+input('Target item','name',t.name)+input('Priority (1 = highest)','priority',t.priority||50,'number')+input('Aspect','aspect',t.aspect)+input('Temper','temper',t.temper)+input('Base affix slots','affixSlots',t.affixSlots||4,'number')+(slot==='charms'?input('Required Charm count','count',t.count??'','number'):'')+input('Primary target affixes, in order','affixes',plan.primary.map(a=>a.name).join(', '))+input('Alternative affixes','alternatives',plan.alternatives.map(a=>a.name).join(', '))+input('Greater Affix priority','greaterAffixPriority',plan.greaterAffixPriority.join(', '))+input('Blacksmith capstone priority','masterworkPriority',plan.masterworkPriority.join(', '))+'</div></fieldset>';
  };
  const rows=Object.entries(slots).map(([slot,t])=>targetRow(slot,t)).join('');
  openModal(b?'Edit Build Targets':'Create Build','BUILD PROFILE','<form id="buildForm" class="modalgrid">'+field(phase?'Build name (phase name edited in Setup Targets)':'Build name','name',b?.name||'')+select('Class','classId',Object.keys(glyphs),b?.classId||c?.classId||'necromancer')+field('Stage','stage',b?.stage||'endgame')+field('Season','season',b?.season||c?.season||'')+field('Patch','patch',b?.patch||'')+field('Source URL','sourceUrl',b?.sources?.[0]?.url||'')+'<div style="grid-column:1/-1"><p class="muted">List every desired base affix. Keep drop Greater Affix priorities and Blacksmith capstone priorities separate.</p><div class="list" id="targetRows">'+rows+'</div><div class="toolbar">'+select('Add equipment slot','addSlot',[...Object.keys(slotNames).filter(s=>!s.startsWith('charm')),'charms'],'weapon')+'<button type="button" class="secondary" id="addTarget">Add Slot</button></div></div><div class="toolbar" style="grid-column:1/-1"><button class="primary" type="submit">Save Build</button></div></form>');
  $('addTarget').onclick=()=>{const slot=$('buildForm').elements.addSlot.value;if($('targetRows').querySelector('[data-target-slot="'+slot+'"]')){toast('That slot is already listed');return}$('targetRows').insertAdjacentHTML('beforeend',targetRow(slot))};
  $('buildForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const fields=Object.fromEntries(f);if(!fields.name.trim()){toast('Build name required');return}const targets=structuredClone(slots);
    $('targetRows').querySelectorAll('[data-target-slot]').forEach(row=>{
      const slot=row.dataset.targetSlot,read=k=>row.querySelector('[data-field="'+k+'"]').value,list=k=>read(k).split(',').map(x=>x.trim()).filter(Boolean);
      const old=targets[slot]||{},primary=list('affixes'),alternatives=list('alternatives');
      targets[slot]={...old,name:read('name'),priority:Number(read('priority'))||50,aspect:read('aspect')||null,temper:read('temper')||null,affixSlots:Number(read('affixSlots'))||null,...(slot==='charms'?{count:Number(read('count'))||null}:{}),greaterAffixPriority:list('greaterAffixPriority'),masterworkPriority:list('masterworkPriority'),affixes:[...primary,...alternatives].map((name,index)=>({...old.affixes?.find(a=>a.name===name),id:name.toLowerCase().replaceAll(' ','-'),name,weight:old.affixes?.find(a=>a.name===name)?.weight??(index<primary.length?3:1),primary:index<primary.length,tier:index<primary.length?'primary':'alternative'}))};
    });
    if(phase){state=saveVariant(state,parent.id,{...phase,slots:targets,sourceUrl:fields.sourceUrl||phase.sourceUrl})}else if(b){Object.assign(b,fields,{slots:targets,updatedAt:new Date().toISOString()})}else{state=addBuild(state,c.id,{...fields,slots:targets,status:'provisional'});selectedId=c.id}
    await save();closeModal();render();
  };
}
function itemEditor(id){
  const item=state.items.find(x=>x.id===id);if(!item)return;
  openModal('Edit Item',item.slot.toUpperCase(),'<form id="itemForm">'+field('Item name','name',item.name)+(item.location!=='equipped'?select('Shared stash type','realm',[{value:'',label:'Unassigned'},{value:'seasonal',label:'Seasonal'},{value:'eternal',label:'Eternal'}],item.realm||'')+field('Season (Seasonal stash only)','season',item.season||''):'')+field('Item power','itemPower',item.itemPower??'','number')+field('Aspect / unique power','powerName',item.power?.name||'')+field('Power value','powerValue',item.power?.value??'','number')+'<label class="field"><span><input type="checkbox" name="seasonalOnly" '+(item.seasonalOnly?'checked':'')+'> Season-only item (cannot transfer to Eternal)</span></label><label class="field"><span class="fieldlabel">Affixes (one per line: name | value | min | max)</span><textarea name="affixes">'+esc((item.affixes||[]).map(a=>[a.name,a.value??'',a.min??'',a.max??''].join(' | ')).join('\n'))+'</textarea></label><div class="toolbar" style="margin-top:15px"><button type="submit" class="primary">Save Item</button></div></form>');
  $('itemForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),before=structuredClone(item);item.name=String(f.get('name')).trim();item.seasonalOnly=f.has('seasonalOnly');if(item.seasonalOnly)item.transferEligibility='blocked';if(item.location!=='equipped'){item.realm=String(f.get('realm'))||null;item.season=item.realm==='eternal'?null:String(f.get('season')).trim()||null}item.itemPower=Number(f.get('itemPower'))||null;item.power={...(item.power||{}),name:String(f.get('powerName')),value:Number(f.get('powerValue'))||null};item.affixes=parseAffixLines(String(f.get('affixes')));state.history.push({id:crypto.randomUUID(),at:new Date().toISOString(),type:'item_edited',itemId:id,characterId:item.ownerCharacterId,before,after:structuredClone(item)});await save();closeModal();render()};
}
function parseAffixLines(text){return text.split(/\n/).map(line=>line.split('|').map(x=>x.trim())).filter(a=>a[0]).map(([name,value,min,max])=>({name,value:value===''?null:Number(value),min:min===''?null:Number(min),max:max===''?null:Number(max),kind:'unknown',sourceStatus:'manual correction'}))}
async function readAsDataURL(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(file)})}
async function sha256(file){const bytes=await file.arrayBuffer();const hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')}
function comparisonHtml(candidate){
  const c=char(),b=build(c),slot=candidate.slot,current=itemFor(c,slot),target=b?.slots?.[targetSlot(b,slot)];
  const proposed=scoreItem({...candidate,slot:targetSlot(b,slot)},b);
  const existing=current?scoreItem({...current,slot:targetSlot(b,slot)},b):null;
  const verdict=c&&!compatibleCharacters(candidate,[c]).length?'Cannot equip on '+c.name+': character type, season or class restriction does not match.':!target?'Cannot determine: active build has no target for this slot.':!current?'Potential upgrade: this slot is unrecorded.':proposed.score>existing.score?'Promising candidate: more weighted target affixes.':proposed.score<existing.score?'Current item has stronger recorded affix fit.':'Similar recorded affix fit; compare power, defenses and crafting.';
  return '<div class="notice">'+esc(verdict)+' This is a heuristic, not a damage calculation.</div><div class="modalgrid"><div class="modalblock"><h3>Equipped</h3><p>'+esc(current?.name||'None recorded')+'</p>'+(current?.affixes||[]).map(a=>affixHtml(a,target)).join('')+'</div><div class="modalblock"><h3>Candidate</h3><p>'+esc(candidate.name||'Unidentified')+'</p>'+(candidate.affixes||[]).map(a=>affixHtml(a,target)).join('')+'</div></div><h3>Other uses before salvage</h3>'+usesHtml(candidate)+'';
}
function compareSavedItem(id){
  const item=state.items.find(i=>i.id===id);if(!item)return;
  openModal('Compare '+item.name,'SAVED ITEM',comparisonHtml(item)+'<div class="toolbar">'+button('Equip on selected character','equip-saved',id,'primary')+button('Keep in shared stash','stash-saved',id,'secondary')+button('Mark ignored','ignore-saved',id,'quiet')+'</div>');
}
// ----- Scan Item: 1 upload → 2 verify (item image left, editable fields right) → 3 grade against the build
let scan=null;
const scanKinds=[{value:'base',label:'Affix'},{value:'temper',label:'Tempered'},{value:'implicit',label:'Implicit'}];
const scanUnits=[{value:'flat',label:'—'},{value:'%',label:'%'},{value:'%[x]',label:'%[x]'}];
function scanStep(step,title,html){
  openModal(title,'SCAN ITEM · STEP '+step+' OF 3'+(scan?.batch?.total>1?' · PHOTO '+scan.batch.index+' OF '+scan.batch.total:''),html);
  const m=$('modal');m.classList.add('wide');m.scrollTop=0;
  if(step>1)stopPhonePoll();
}
async function cropToItem(file,bbox){
  if(!file||!bbox)return null;
  try{
    const bmp=await createImageBitmap(file);   // applies the photo's rotation, like Vision now does
    const sx=Math.round(bbox.left*bmp.width),sy=Math.round(bbox.top*bmp.height);
    const sw=Math.max(1,Math.round((bbox.right-bbox.left)*bmp.width)),sh=Math.max(1,Math.round((bbox.bottom-bbox.top)*bmp.height));
    const scale=Math.min(1,1600/sh),canvas=document.createElement('canvas');
    canvas.width=Math.round(sw*scale);canvas.height=Math.round(sh*scale);
    canvas.getContext('2d').drawImage(bmp,sx,sy,sw,sh,0,0,canvas.width,canvas.height);
    return canvas.toDataURL('image/jpeg',0.9);
  }catch{return null}
}
function scanDialog(){
  scan={};
  scanStep(1,'Scan Item','<p>Upload a screenshot or photo of the item tooltip. Only the item’s own text is read, top to bottom. Flavour text, requirements and game buttons such as Equip, Compare and Mark as Junk are ignored.</p><label class="dropzone"><input id="scanFile" type="file" accept="image/*" multiple><strong>'+(ON_WEB?'Take a photo or choose screenshots':'Choose item images')+'</strong><small>'+(ON_WEB?'Several at once is fine: each is reviewed in turn · read on this device':'PNG, JPEG, HEIC or WebP · several at once is fine · processed on this computer')+'</small></label><div id="scanStatus" role="status"></div>'+claudeBoxHtml()+(ON_SERVER?'<section class="sectionbox phonebox"><h3>Send from your phone</h3><div id="phonePanel"></div></section>':'')+'<section class="sectionbox manualbox"><h3>No photo?</h3><p class="muted">Type the item’s name, pick it from the list, and fill in the numbers. Fixed affixes fill in automatically and only affixes the item can roll are offered.</p><button type="button" class="secondary" id="scanManual">Enter item manually</button></section><details id="scanPaste" class="sectionbox"><summary>Paste the tooltip text instead</summary><textarea id="scanText" rows="8" placeholder="Paste the item tooltip, top to bottom"></textarea><div class="toolbar"><button class="secondary" id="scanTextBtn" type="button">Review pasted text</button></div></details>');
  $('scanFile').onchange=()=>{const files=[...$('scanFile').files];if(files.length)scanFromFile(files[0],null,{queue:files.slice(1),total:files.length,index:1})};
  if(ON_SERVER)phonePanel(false);
  wireClaudeBox();
  $('scanManual').onclick=async()=>{await loadCatalog();scan={item:{name:'',slot:scanDefaultSlot(),rarity:'Unknown',affixes:[]},manual:true};scanVerify();setTimeout(()=>$('verifyForm')?.elements.name.focus(),0)};
  $('scanTextBtn').onclick=async()=>{const text=$('scanText').value;if(!text.trim()){toast('Paste the tooltip text first');return}await loadCatalog();scan={...scan,item:withCatalog(parseTooltip(text)),pasted:true};scanVerify()};
}
async function scanFromFile(file,phoneId=null,batch=null){
    scan={file,phoneId,batch,imageData:await readAsDataURL(file),hash:await sha256(file)};
    if(!$('scanStatus'))scanStep(1,'Scan Item','<div id="scanStatus" role="status"></div>');
    const duplicate=state.items.find(x=>x.imageHash===scan.hash);
    if(!ON_SERVER&&!ON_WEB){$('scanStatus').innerHTML='<div class="notice">Text recognition runs in the local server and web editions. Paste the tooltip text below, or enter the item manually.</div>';$('scanPaste').open=true;return}
    const status=text=>{if($('scanStatus'))$('scanStatus').innerHTML='<div class="notice">'+text+batchLabel()+(duplicate?' (this image was already saved with '+esc(duplicate.name)+')':'')+'</div>'};
    status('Reading the item…');
    try{
      const result=await recognizeFile(file,p=>{if(p?.status==='recognizing text')status('Reading the item… '+Math.round((p.progress||0)*100)+'%');else if(p?.status&&/load/i.test(p.status))status('Loading the text recognizer (first time only)…')});
      scan.ocr=result;await loadCatalog();scan.item=withCatalog(result.item||parseTooltip(result.text));
      scan.cropData=await cropToItem(file,result.tooltip?.bbox);
      scanVerify();
    }catch(error){if($('scanStatus')){$('scanStatus').innerHTML='<div class="notice">Could not read the image: '+esc(error.message)+'. Paste the tooltip text below or enter the item manually.</div>';if($('scanPaste'))$('scanPaste').open=true}}
}
function batchLabel(){return scan?.batch?.total>1?' · photo '+scan.batch.index+' of '+scan.batch.total:''}
// ----- Reading with Claude (src/claude-reader.mjs). Web edition: the viewer's own API key, stored only on
// this device. Server edition: the key comes from ANTHROPIC_API_KEY on the Mac and never reaches the browser.
const CLAUDE_KEY='sanctuaryArmory.claude';
function claudeConfig(){try{return JSON.parse(localStorage.getItem(CLAUDE_KEY)||'null')||{}}catch{return {}}}
function setClaudeConfig(c){try{localStorage.setItem(CLAUDE_KEY,JSON.stringify(c))}catch{toast('This browser won’t store settings (private browsing?)')}}
let claudeServerStatus=null;
async function claudeServerReady(){
  if(!ON_SERVER)return false;
  if(claudeServerStatus==null){try{claudeServerStatus=!!(await (await fetch('api/claude/status')).json()).configured}catch{claudeServerStatus=false}}
  return claudeServerStatus;
}
async function claudeReady(){const c=claudeConfig();if(c.enabled===false)return false;return ON_SERVER?claudeServerReady():ON_WEB&&!!c.apiKey}
async function readWithClaude(file){
  const reader=await import('./src/claude-reader.mjs');
  await loadCatalog();
  const c=claudeConfig(),model=c.model||reader.DEFAULT_MODEL;
  const knownAffixes=itemCatalog?allAffixChoices(itemCatalog,classIndexOf(char(),build())):[];
  const image=await reader.prepareImage(file);
  let reading;
  if(ON_SERVER){
    const response=await fetch('api/claude/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...image,knownAffixes,model})});
    const result=await response.json();if(!response.ok)throw new Error(result.error);reading=result.reading;
  }else reading=(await reader.callClaude(reader.buildRequest({...image,knownAffixes,model}),{apiKey:c.apiKey,browser:true})).reading;
  const item=reader.readingToItem(reading);
  return {engine:'Claude ('+model+')',text:item.rawText,fullText:item.rawText,item,reading,tooltip:{bbox:reader.readingBox(reading),skipped:[],lines:[]}};
}
function claudeBoxHtml(){
  if(!ON_WEB&&!ON_SERVER)return '';
  const c=claudeConfig();
  return '<details class="sectionbox" id="claudeBox"><summary>Read items with Claude '+(c.enabled!==false&&(c.apiKey||ON_SERVER)?'<small id="claudeState" class="muted"></small>':'<small class="muted">(off)</small>')+'</summary>'
    +'<p class="muted">Claude reads the photo directly, which is far more accurate than on-device text recognition on game fonts. Only the item’s own tooltip is read. Each photo is sent to Anthropic. On-device reading is used when Claude is off or unreachable.</p>'
    +(ON_WEB?'<label class="field"><span class="fieldlabel">Anthropic API key</span><input id="claudeKey" type="password" autocomplete="off" placeholder="sk-ant-…" value="'+esc(c.apiKey||'')+'"><small class="muted">Stored only on this device. Create one at console.anthropic.com.</small></label>'
      :'<p class="muted small" id="claudeServerNote">On this Mac, Claude uses the key in the ANTHROPIC_API_KEY environment variable when the server starts.</p>')
    +'<label class="field"><span class="fieldlabel">Model</span><select id="claudeModel"></select></label>'
    +'<label class="field inline"><input type="checkbox" id="claudeOn"'+(c.enabled===false?'':' checked')+'> Use Claude when available</label>'
    +'<div class="toolbar"><button type="button" class="secondary small" id="claudeSave">Save</button></div></details>';
}
async function wireClaudeBox(){
  if(!$('claudeBox'))return;
  const {CLAUDE_MODELS,DEFAULT_MODEL}=await import('./src/claude-reader.mjs'),c=claudeConfig();
  $('claudeModel').innerHTML=CLAUDE_MODELS.map(m=>'<option value="'+m.id+'"'+((c.model||DEFAULT_MODEL)===m.id?' selected':'')+'>'+esc(m.label)+'</option>').join('');
  if(ON_SERVER&&!(await claudeServerReady())&&$('claudeServerNote'))$('claudeServerNote').textContent='No ANTHROPIC_API_KEY is set on this Mac, so items are read on the device. Start the server with ANTHROPIC_API_KEY=sk-ant-… to use Claude.';
  if($('claudeState'))$('claudeState').textContent=(await claudeReady())?'(on)':'(off)';
  $('claudeSave').onclick=async()=>{
    const next={...claudeConfig(),model:$('claudeModel').value,enabled:$('claudeOn').checked};
    if($('claudeKey'))next.apiKey=$('claudeKey').value.trim();
    setClaudeConfig(next);if($('claudeState'))$('claudeState').textContent=(await claudeReady())?'(on)':'(off)';
    toast((await claudeReady())?'Claude will read your item photos':'Claude reading is off');
  };
}
/** Text recognition: Apple Vision through the local server, or Tesseract on this device in the web edition. */
async function recognizeFile(file,onProgress){
  if(await claudeReady()){
    try{onProgress?.({status:'reading with Claude'});return await readWithClaude(file)}
    catch(error){toast(error.message+'. Using on-device text recognition instead.')}
  }
  if(ON_SERVER){
    const response=await fetch('api/ocr',{method:'POST',headers:{'Content-Type':file.type},body:file}),result=await response.json();
    if(!response.ok)throw new Error(result.error);
    return result;
  }
  const {recognizeImage}=await import('./src/browser-ocr.mjs');
  const r=await recognizeImage(file,{onProgress,extractTooltip});
  const tooltip=extractTooltip(r.lines);
  return {...r,fullText:r.text,text:tooltip.text,tooltip,item:parseTooltip(tooltip.text)};
}
function nextInBatch(){
  const b=scan?.batch;if(!b?.queue?.length)return false;
  const [next,...rest]=b.queue;scanFromFile(next,null,{queue:rest,total:b.total,index:b.index+1});return true;
}
// ----- Phone uploads: QR link + inbox (the phone page is served by the server's separate upload listener)
let phonePollTimer=null,phoneSignature='',phoneBadgeTimer=null;
function stopPhonePoll(){clearInterval(phonePollTimer);phonePollTimer=null}
function updateScanBadge(count){$('scanBtn').textContent='Scan Item'+(count?' ('+count+' from phone)':'')}
function watchPhoneBadge(){
  if(phoneBadgeTimer)return;
  phoneBadgeTimer=setInterval(async()=>{try{const st=await (await fetch('api/phone/status')).json();updateScanBadge(st.inbox?.length||0);if(!st.running&&!st.inbox?.length){clearInterval(phoneBadgeTimer);phoneBadgeTimer=null}}catch{}},8000);
}
async function phonePanel(start){
  const box=$('phonePanel');if(!box){stopPhonePoll();return}
  if(!ON_SERVER){box.innerHTML='<p class="muted">Phone uploads need the local server edition.</p>';return}
  let st;
  try{const r=await fetch(start?'api/phone/start':'api/phone/status',{method:start?'POST':'GET'});st=await r.json();if(!r.ok)throw new Error(st.error)}
  catch(error){box.innerHTML='<div class="notice">Phone uploads are unavailable: '+esc(error.message)+'</div>';return}
  if(!$('phonePanel'))return;
  updateScanBadge(st.inbox.length);
  const signature=JSON.stringify([st.running,st.urls,st.inbox.map(i=>i.id)]);
  if(signature!==phoneSignature||start){
    phoneSignature=signature;
    const until=st.expiresAt?new Date(st.expiresAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'';
    const link=st.urls?.[0];
    box.innerHTML=(st.running
      ?'<div class="phonelink"><div class="qr">'+st.qr+'</div><div><p><strong>Scan this with your phone’s camera</strong>, then take a photo of the item or choose screenshots. Your phone must be on the same Wi-Fi as this Mac.</p>'+(link?'<p class="mono">'+esc(link)+'</p>':'<p class="notice">This Mac has no Wi-Fi/Ethernet address right now.</p>')+(st.urls.length>1?'<details><summary>Other addresses</summary>'+st.urls.slice(1).map(u=>'<p class="mono">'+esc(u)+'</p>').join('')+'</details>':'')+'<p class="muted small">The link only accepts images and works until '+esc(until)+'. If macOS asks whether “node” may accept incoming connections, choose Allow.</p><button type="button" class="quiet small" id="phoneStop">Stop phone uploads</button></div></div>'
      :'<p class="muted">Take photos with your phone and send them straight here. Your phone needs to be on the same Wi-Fi as this Mac.</p><button type="button" class="secondary" id="phoneStart">Show phone QR code</button>')
      +(st.inbox.length?'<h4>Waiting from your phone</h4><div class="phoneinbox">'+st.inbox.map(i=>'<div class="phoneitem"><img src="api/phone/inbox/'+encodeURIComponent(i.id)+'" alt="'+esc(i.name)+'" loading="lazy"><div><strong>'+esc(i.name)+'</strong><small>'+esc(new Date(i.receivedAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}))+'</small></div><button type="button" class="primary small" data-phone-scan="'+esc(i.id)+'">Scan</button><button type="button" class="quiet small" data-phone-remove="'+esc(i.id)+'" aria-label="Remove">✕</button></div>').join('')+'</div>':st.running?'<p class="muted small">Waiting for photos…</p>':'');
    $('phoneStart')?.addEventListener('click',()=>phonePanel(true));
    $('phoneStop')?.addEventListener('click',async()=>{await fetch('api/phone/stop',{method:'POST'});phoneSignature='';phonePanel(false)});
    box.querySelectorAll('[data-phone-remove]').forEach(b=>b.onclick=async()=>{await fetch('api/phone/inbox/'+encodeURIComponent(b.dataset.phoneRemove),{method:'DELETE'});phonePanel(false)});
    box.querySelectorAll('[data-phone-scan]').forEach(b=>b.onclick=async()=>{
      const item=st.inbox.find(i=>i.id===b.dataset.phoneScan);
      try{const r=await fetch('api/phone/inbox/'+encodeURIComponent(item.id));if(!r.ok)throw new Error('image no longer waiting');const blob=await r.blob();stopPhonePoll();scanFromFile(new File([blob],item.name,{type:item.type}),item.id)}
      catch(error){toast('Could not open the phone image: '+error.message);phonePanel(false)}
    });
  }
  if(st.running||st.inbox.length){watchPhoneBadge();if(!phonePollTimer)phonePollTimer=setInterval(()=>phonePanel(false),3000)}else stopPhonePoll();
}
function scanDefaultSlot(){const b=build();return Object.keys(b?.slots||{}).find(s=>slotNames[s])||'helm'}
/** Match a scanned item to the game's item list: fixed affixes, slot, rarity and power come from the game data. */
function withCatalog(item){
  if(!itemCatalog||!item?.name)return item;
  const ci=classIndexOf(char(),build());
  const entry=matchItemName(itemCatalog,item.name,{classIndex:ci,slot:item.slot,itemType:item.itemType})||identifyItem(itemCatalog,{name:item.name,rarity:item.rarity,itemType:item.itemType,slot:item.slot,classIndex:ci,affixes:item.affixes});
  if(entry)return applyCatalogItem(item,entry,itemCatalog,{classIndex:ci});
  // No catalog item (legendaries, rares): snap the type line and the affix names to that type's pool
  return snapToTypePool(item,itemCatalog,{classIndex:ci});
}
function scanTypeKey(it){return it.catalogMatch?itemCatalog?.items.find(i=>i.key===it.catalogMatch.key)?.type:typeByName(itemCatalog,it.itemType,it.slot)?.type}
function catalogBadge(it){
  if(!itemCatalog)return '';
  const m=it.catalogMatch;
  if(!m)return '<p class="catalogbadge none">'+(it.name?'Not matched to a game item. Pick the name from the list to fill in its fixed affixes.':'Start typing the item name and pick it from the list.')+'</p>';
  const random=Math.max(0,m.affixCount-m.fixed.length);
  return '<p class="catalogbadge">✓ Game item: <strong>'+esc(m.name)+'</strong> · '+esc(it.rarity)+' '+esc(it.itemType||'')+' · '+(m.fixed.length?m.fixed.length+' fixed affix'+(m.fixed.length>1?'es':'')+' + ':'')+random+' random'+(m.lootSource?' · '+(m.lootSource==='world'?'world drop':esc(m.lootSource)+' loot table'):'')+(m.score!=null&&m.score<1?' <small>(name matched '+Math.round(m.score*100)+'%)</small>':'')+'</p>';
}
function scanTarget(slot){const c=char(),b=build(c);return {c,b,target:b?.slots?.[targetSlot(b,slot)]||null}}
function affixRowHtml(a,i){
  return '<tr data-affix-row="'+i+'"'+(a.fixed?' data-fixed="1" class="fixedaffix"':'')+'><td><input data-f="name" value="'+esc(a.name||'')+'" aria-label="Affix name"'+(a.fixed?' readonly title="Fixed affix of this item"':'')+'>'+(a.fixed?'<small class="fixedtag">fixed</small>':a.snappedFrom?'<small class="muted">read as “'+esc(a.snappedFrom)+'”</small>':'')+(a.check?'<small class="checkflag">⚠ check: '+esc(a.check)+'</small>':'')+'</td><td><input data-f="value" inputmode="decimal" value="'+esc(a.value??'')+'" aria-label="Value" placeholder="value"></td><td><select data-f="unit" aria-label="Unit">'+scanUnits.map(u=>'<option value="'+u.value+'"'+(u.value===(a.unit||'flat')?' selected':'')+'>'+u.label+'</option>').join('')+'</select></td><td class="range"><input data-f="min" inputmode="decimal" value="'+esc(a.min??'')+'" aria-label="Range minimum" placeholder="min"><span>–</span><input data-f="max" inputmode="decimal" value="'+esc(a.max??'')+'" aria-label="Range maximum" placeholder="max"></td><td><select data-f="kind" aria-label="Affix type">'+scanKinds.map(k=>'<option value="'+k.value+'"'+(k.value===(a.kind||'base')?' selected':'')+'>'+k.label+'</option>').join('')+'</select>'+(a.kindGuess?'<small class="muted">guess</small>':'')+'</td><td class="center"><input type="checkbox" data-f="ga"'+(a.greaterAffix?' checked':'')+' aria-label="Greater Affix"></td><td>'+(a.fixed?'':'<button type="button" class="quiet small" data-remove-affix="'+i+'" aria-label="Remove affix">✕</button>')+'</td></tr>';
}
function affixCountHtml(it){
  const rolled=(it.affixes||[]).filter(a=>a.kind!=='temper'&&a.kind!=='implicit').length,fixed=(it.affixes||[]).filter(a=>a.fixed&&a.kind!=='implicit').length;
  const m=it.catalogMatch,max=Math.max(6,rolled);
  if(m&&/unique|mythic|set/i.test(it.rarity||''))return '<p class="muted small">'+esc(it.name)+' has '+m.affixCount+' affixes'+(fixed?' ('+fixed+' fixed)':'')+'. Tempers go in extra rows marked Tempered.</p>';
  return '<label class="field inline"><span class="fieldlabel">Number of affixes</span><select id="affixCount">'+Array.from({length:max-Math.max(fixed,0)+1},(_,i)=>i+fixed).map(n=>'<option'+(n===rolled?' selected':'')+'>'+n+'</option>').join('')+'</select></label>';
}
/** Affix names the verify form offers for a row: the item type's pool, or every class affix for tempers. */
function scanAffixPool(it){return itemCatalog?affixChoices(itemCatalog,scanTypeKey(it),classIndexOf(char(),build())):[]}
function rowChoices(row){
  if(!itemCatalog)return {choices:[],strict:false};
  const kind=row?.querySelector('[data-f="kind"]')?.value||'base',ci=classIndexOf(char(),build());
  if(kind==='temper'||kind==='implicit')return {choices:allAffixChoices(itemCatalog,ci),strict:false};
  const pool=scanAffixPool(scan.item);
  // A unique's own (fixed) affixes are always legal on it even when outside the type's random pool
  const own=(scan.item.affixes||[]).filter(a=>a.fixed).map(a=>a.name);
  return pool.length?{choices:[...new Set([...pool,...own])].sort((a,b)=>a.localeCompare(b)),strict:true}:{choices:allAffixChoices(itemCatalog,ci),strict:false};
}
function affixPoolNote(it){
  if(!itemCatalog)return '';
  const n=scanAffixPool(it).length;
  return n?'<p class="muted small">Tap an affix name to search the '+n+' affixes a '+esc(it.itemType||'item of this type')+' can roll.</p>':'<p class="muted small">Choose the item type above to limit the affix list to what it can roll.</p>';
}
/**
 * Searchable dropdown on a text input. search(query) returns [{value, note?}]. With strict, a value not
 * in the list is marked invalid when the field is left. Works with touch (iPhone) and the keyboard.
 */
function attachPicker(input,{search,strict=false}){
  const host=input.closest('dialog')||document.body;
  const list=document.createElement('ul');list.className='pickerlist';list.setAttribute('role','listbox');list.hidden=true;host.appendChild(list);
  input.setAttribute('autocomplete','off');input.setAttribute('autocapitalize','off');input.setAttribute('spellcheck','false');input.setAttribute('role','combobox');input.setAttribute('aria-expanded','false');
  let items=[],active=-1;
  const isStrict=()=>typeof strict==='function'?strict():strict;
  const place=()=>{const r=input.getBoundingClientRect(),below=window.innerHeight-r.bottom,up=below<180&&r.top>below;list.style.left=Math.max(4,r.left)+'px';list.style.width=Math.max(r.width,220)+'px';list.style.maxHeight=Math.max(140,Math.min(320,(up?r.top:below)-12))+'px';list.style.top=up?'auto':r.bottom+2+'px';list.style.bottom=up?(window.innerHeight-r.top+2)+'px':'auto'};
  const render=()=>{
    items=search(input.value)||[];active=items.length?0:-1;
    list.innerHTML=items.length?items.map((o,i)=>'<li role="option" data-i="'+i+'"'+(i===active?' class="active"':'')+'>'+esc(o.value)+(o.note?'<small>'+esc(o.note)+'</small>':'')+'</li>').join(''):'<li class="none">'+(input.value?'No match':'Start typing')+'</li>';
    place();list.hidden=false;input.setAttribute('aria-expanded','true');
  };
  const close=()=>{list.hidden=true;input.setAttribute('aria-expanded','false')};
  const pick=i=>{const o=items[i];if(!o)return;input.value=o.value;input.classList.remove('invalid');close();input.dispatchEvent(new Event('change',{bubbles:true}))};
  const highlight=i=>{active=i;list.querySelectorAll('li[data-i]').forEach(li=>li.classList.toggle('active',Number(li.dataset.i)===i));list.querySelector('li.active')?.scrollIntoView({block:'nearest'})};
  input.addEventListener('focus',()=>{input.select?.();render()});
  input.addEventListener('input',()=>{input.classList.remove('invalid');render()});
  input.addEventListener('keydown',e=>{
    if(list.hidden&&e.key==='ArrowDown'){render();e.preventDefault();return}
    if(e.key==='ArrowDown'&&items.length){highlight((active+1)%items.length);e.preventDefault()}
    else if(e.key==='ArrowUp'&&items.length){highlight((active-1+items.length)%items.length);e.preventDefault()}
    else if(e.key==='Enter'&&!list.hidden&&active>=0){pick(active);e.preventDefault()}
    else if(e.key==='Escape'&&!list.hidden){close();e.preventDefault();e.stopPropagation()}
  });
  // pointerdown (not click) so the choice lands before the input loses focus
  list.addEventListener('pointerdown',e=>{const li=e.target.closest('li[data-i]');if(li){e.preventDefault();pick(Number(li.dataset.i))}});
  input.addEventListener('blur',()=>{
    close();
    const v=input.value.trim();if(!v||!isStrict())return;
    const all=search('').map(o=>o.value),canon=canonicalChoice(v,all);
    if(canon){if(canon!==input.value){input.value=canon;input.dispatchEvent(new Event('change',{bubbles:true}))}input.classList.remove('invalid')}
    else input.classList.add('invalid');
  });
  const reflow=()=>{if(!list.hidden)place()};
  window.addEventListener('resize',reflow);host.addEventListener('scroll',reflow,true);
  // Remove the list with its input (the verify form re-renders often)
  new MutationObserver((_,obs)=>{if(!input.isConnected){list.remove();window.removeEventListener('resize',reflow);host.removeEventListener('scroll',reflow,true);obs.disconnect()}}).observe(host,{childList:true,subtree:true});
}
function readVerifyForm(){
  const f=$('verifyForm');if(!f)return;
  const val=n=>f.elements[n]?.value?.trim()??'',numOrNull=v=>{const n=Number(String(v).replace(/,/g,''));return v===''||!Number.isFinite(n)?null:n};
  const it=scan.item;
  it.name=val('name');it.slot=val('slot');it.rarity=val('rarity');it.itemType=val('itemType')||null;it.itemPower=numOrNull(val('itemPower'));
  it.affixes=[...f.querySelectorAll('[data-affix-row]')].map(row=>{const g=k=>row.querySelector('[data-f="'+k+'"]');return {name:g('name').value.trim(),value:numOrNull(g('value').value.trim()),unit:g('unit').value,min:numOrNull(g('min').value.trim()),max:numOrNull(g('max').value.trim()),kind:g('kind').value,greaterAffix:g('ga').checked,...(row.dataset.fixed?{fixed:true}:{})}}).filter(a=>a.name||a.fixed);
  if(it.catalogMatch&&it.name!==it.catalogMatch.name){delete it.catalogMatch;delete it.catalogKey;it.affixes=it.affixes.filter(a=>!a.fixed||a.value!=null);for(const a of it.affixes)delete a.fixed}
  const description=val('powerDescription'),choice=val('powerChoice');
  it.power=description||choice?{name:choice==='other'||!choice?(/unique|mythic/i.test(it.rarity)?it.name:null):choice,description,value:numOrNull(val('powerValue')),min:numOrNull(val('powerMin')),max:numOrNull(val('powerMax')),unit:it.power?.unit||null}:null;
  it.sockets=val('sockets').split(',').map(s=>s.trim()).filter(Boolean).map(name=>({name,empty:/^empty/i.test(name)}));
}
function scanVerify(){
  const it=scan.item;it.slot=it.slot&&slotNames[it.slot]?it.slot:'helm';
  const {target}=scanTarget(it.slot);
  const sim=target?aspectMatch(it,target):null,legendaryTarget=target&&target.aspect&&!/unique|mythic/i.test(target.rarity||'');
  const powerOptions=[{value:'',label:'Not specified'},...(legendaryTarget?[{value:target.aspect,label:'The guide’s '+target.aspect+(sim?.similarity?' · '+Math.round(sim.similarity*100)+'% text match':'')}]:[]),{value:'other',label:/unique|mythic/i.test(it.rarity||'')?'Unique power of '+(it.name||'this item'):'Another aspect / power'}];
  const powerChoice=it.power?.name&&legendaryTarget&&it.power.name===target.aspect?target.aspect:sim?.matched&&legendaryTarget?target.aspect:it.power?'other':'';
  const image=scan.cropData||scan.imageData;
  const skipped=scan.ocr?.tooltip?.skipped||[];
  scanStep(2,'Verify the item','<div class="scanlayout"><div class="scanimage">'+(image?'<img id="scanImg" src="'+esc(image)+'" alt="Scanned item">'+(scan.cropData?'<button type="button" class="quiet small" id="toggleCrop">Show full image</button>':''):'<div class="empty">'+(scan.manual?'Manual entry':'No image (pasted text)')+'</div>')+(skipped.length?'<details class="ignored"><summary>Ignored text ('+skipped.length+')</summary><ul>'+skipped.map(s=>'<li><span>'+esc(s.text)+'</span><small>'+esc(s.reason)+'</small></li>').join('')+'</ul></details>':'')+'</div>'
    +'<form id="verifyForm" class="scanfields" autocomplete="off"><p class="muted">'+(scan.manual?'Pick the item from the list, then enter the numbers from the game.':'Check each value against the image. Mark tempered and Greater Affixes; the tooltip text alone can’t show them.')+'</p>'+catalogBadge(it)+'<div class="fieldrow">'+field('Item name','name',it.name)+select('Slot','slot',Object.keys(slotNames).map(s=>({value:s,label:slotNames[s]})),it.slot)+'</div><div class="fieldrow">'+select('Rarity','rarity',['Unknown','Legendary','Unique','Mythic','Set','Rare','Magic'],it.rarity||'Unknown')+(itemCatalog&&typesForSlot(itemCatalog,it.slot).length?select('Item type','itemType',[{value:'',label:'Choose…'},...[...new Set([...typesForSlot(itemCatalog,it.slot).map(t=>t.typeName),...(it.itemType?[it.itemType]:[])])].map(t=>({value:t,label:t}))],it.itemType||''):field('Item type','itemType',it.itemType||''))+field('Item power','itemPower',it.itemPower??'','number')+'</div>'
    +'<h3>Affixes</h3>'+affixCountHtml(it)+affixPoolNote(it)+'<div class="tablewrap"><table class="affixedit"><thead><tr><th>Affix</th><th>Value</th><th>Unit</th><th>Range</th><th>Type</th><th title="Greater Affix">GA</th><th></th></tr></thead><tbody>'+(it.affixes||[]).map(affixRowHtml).join('')+'</tbody></table></div><button type="button" class="secondary small" id="addAffix">+ Add affix</button>'
    +'<h3>Aspect / unique power</h3>'+select('This power is','powerChoice',powerOptions,powerChoice)+'<label class="field"><span class="fieldlabel">Power text</span><textarea name="powerDescription" rows="3">'+esc(it.power?.description||'')+'</textarea></label><div class="fieldrow">'+field('Value','powerValue',it.power?.value??'')+field('Range min','powerMin',it.power?.min??'')+field('Range max','powerMax',it.power?.max??'')+'</div>'
    +field('Sockets (comma separated)','sockets',(it.sockets||[]).map(s=>s.name).join(', '))
    +'<div class="toolbar sticky"><button type="button" class="quiet" id="scanBack">Back</button><button type="submit" class="primary">Confirm &amp; grade</button></div></form></div>');
  const f=$('verifyForm');
  $('scanBack').onclick=scanDialog;
  if($('toggleCrop'))$('toggleCrop').onclick=()=>{const full=$('scanImg').src===scan.imageData;$('scanImg').src=full?scan.cropData:scan.imageData;$('toggleCrop').textContent=full?'Show full image':'Show item only'};
  $('addAffix').onclick=()=>{readVerifyForm();scan.item.affixes.push({name:'',value:null,unit:'flat',kind:'base'});scanVerify();setTimeout(()=>{const rows=document.querySelectorAll('[data-affix-row] [data-f="name"]');rows[rows.length-1]?.focus()},0)};
  f.querySelectorAll('[data-remove-affix]').forEach(b=>b.onclick=()=>{readVerifyForm();scan.item.affixes.splice(Number(b.dataset.removeAffix),1);scanVerify()});
  f.elements.slot.onchange=()=>{readVerifyForm();scanVerify()};
  if(f.elements.itemType?.tagName==='SELECT')f.elements.itemType.onchange=()=>{readVerifyForm();scanVerify()};
  const nameInput=f.elements.name,ci=classIndexOf(char(),build());
  if(itemCatalog)attachPicker(nameInput,{search:q=>searchItems(itemCatalog,q,{classIndex:ci,slot:scan.item.slot,limit:25}).map(i=>({value:i.name,note:i.rarity+' '+i.typeName})),strict:false});
  // Affix names: a searchable list of the affixes this item type can roll (tempers: any affix for the class)
  f.querySelectorAll('[data-affix-row]:not([data-fixed]) [data-f="name"]').forEach(input=>{
    const row=input.closest('[data-affix-row]');
    attachPicker(input,{search:q=>filterChoices(rowChoices(row).choices,q).map(value=>({value})),strict:()=>rowChoices(row).strict});
  });
  nameInput.addEventListener('change',()=>{
    if(!itemCatalog)return;
    const entry=matchItemName(itemCatalog,nameInput.value,{classIndex:ci,slot:scan.item.slot,itemType:scan.item.itemType,threshold:0.9});
    readVerifyForm();
    if(entry&&entry.key!==scan.item.catalogMatch?.key){scan.item=applyCatalogItem(scan.item,entry,itemCatalog,{classIndex:ci});scanVerify();setTimeout(()=>document.querySelector('[data-affix-row] [data-f="value"]')?.focus(),0)}
    else if(!entry&&scan.item.catalogMatch===undefined)scanVerify();
  });
  if($('affixCount'))$('affixCount').onchange=()=>{
    readVerifyForm();
    const want=Number($('affixCount').value),rows=scan.item.affixes,isRolled=a=>a.kind!=='temper'&&a.kind!=='implicit';
    let have=rows.filter(isRolled).length;
    while(have<want){const at=rows.reduce((last,a,i)=>isRolled(a)?i:last,-1)+1;rows.splice(at,0,{name:'',value:null,unit:'flat',kind:'base'});have++}
    for(let i=rows.length-1;i>=0&&have>want;i--)if(isRolled(rows[i])&&!rows[i].fixed&&!rows[i].name){rows.splice(i,1);have--}
    for(let i=rows.length-1;i>=0&&have>want;i--)if(isRolled(rows[i])&&!rows[i].fixed){rows.splice(i,1);have--}
    scanVerify();
  };
  f.onsubmit=e=>{
    e.preventDefault();
    // Every affix must be one this item can roll: snap near misses, stop on anything else
    let bad=null;
    f.querySelectorAll('[data-affix-row]:not([data-fixed]) [data-f="name"]').forEach(input=>{
      const {choices,strict}=rowChoices(input.closest('[data-affix-row]'));
      if(!input.value.trim()||!choices.length)return;
      const canon=canonicalChoice(input.value,choices);
      if(canon){input.value=canon;input.classList.remove('invalid')}
      else if(strict){input.classList.add('invalid');bad??=input}
    });
    if(bad){bad.focus();toast('“'+bad.value+'” isn’t an affix this '+(scan.item.itemType||'item')+' can roll. Pick one from the list.');return}
    readVerifyForm();if(!scan.item.name){toast('Enter the item name');return}scanGrade();
  };
}
const scoreBand=s=>s==null?'unknown':s>=80?'a3':s>=60?'a2':s>=40?'a1':'a0';
function scoreCard(label,name,grade,potential){
  return '<div class="scorecard"><small>'+esc(label)+'</small><strong class="'+scoreBand(grade?.score)+'">'+(grade?.score??'—')+'<span>/100</span></strong><div>'+esc(name||'Nothing recorded')+'</div>'+(potential!=null&&grade?.score!=null&&potential>grade.score?'<small class="muted">'+potential+' with crafting</small>':'')+'</div>';
}
function scanGrade(){
  const it=scan.item,c=char();
  // Rings: compare with the ring slot where this item helps most
  let slot=it.slot;
  if(/^ring[12]$/.test(slot)&&!scan.ringLocked){
    const options=['ring1','ring2'].map(s=>{const {target}=scanTarget(s),cur=itemFor(c,s);const g=gradeItem(it,target),gc=cur?gradeItem(cur,target):null;return {s,delta:(g?.score??0)-(gc?.score??0)}});
    slot=options.sort((a,b)=>b.delta-a.delta)[0].s;it.slot=slot;
  }
  const {b,target}=scanTarget(slot),current=itemFor(c,slot);
  const ctx={codex:(state.codex||[]).filter(a=>!a.characterId||a.characterId===c?.id),craftingRules:state.craftingRules||[]};
  const g=gradeItem(it,target),gc=current?gradeItem(current,target):null;
  const plan=improvementPlan(it,target,g,ctx),planCurrent=current&&gc?improvementPlan(current,target,gc,ctx):null;
  const rec=recommendation(g,gc);
  const scope=view==='inventory'?selectedStash():c;
  it.season=scope?.realm==='eternal'?null:scope?.season||null;it.realm=scope?.realm||null;it.classIds=it.classIds||[];
  const compRows=(g?.components||[]).map(k=>{const o=gc?.components?.find(x=>x.key===k.key);return '<tr><td>'+esc(k.label)+'</td><td>'+k.points+' / '+k.max+'<small>'+esc(k.detail)+'</small></td><td>'+(o?o.points+' / '+o.max+'<small>'+esc(o.detail)+'</small>':'—')+'</td></tr>'}).join('');
  const affixRows=(target?.affixes||[]).map(t=>{
    const n=g?.affixRows?.find(r=>r.target===t),o=gc?.affixRows?.find(r=>r.target===t);
    const cell=r=>r?.item?esc(r.item.name)+' '+esc(r.item.value??'?')+esc(r.item.unit&&r.item.unit!=='flat'?r.item.unit:'')+(r.quality?'<small>'+esc(r.quality.basis)+'</small>':''):r?.substitute?'<small>alternative '+esc(r.substitute.name)+'</small>':'<span class="a0">missing</span>';
    return '<tr><td class="a'+t.weight+'">'+esc(t.name)+'<small>'+esc(t.tier||'')+(t.priorityRank?' · #'+t.priorityRank:'')+'</small></td><td>'+esc(t.idealValue??'—')+'</td><td>'+cell(n)+'</td><td>'+(current?cell(o):'—')+'</td></tr>';
  }).join('');
  const extras=(g?.extras||[]).map(a=>'<li>'+esc(a.name)+' '+esc(a.value??'')+'</li>').join('');
  const stations=['Drops','Occultist','Blacksmith','Jeweler','Horadric Cube'];
  const planHtml=stations.map(st=>{const steps=plan.steps.filter(s=>s.station===st);return steps.length?'<div class="station"><h4>'+esc(st)+'</h4>'+steps.map(s=>'<div class="step'+(s.scored?' scored':'')+'"><strong>'+esc(s.action)+'</strong><p>'+esc(s.detail)+'</p></div>').join('')+'</div>':''}).join('');
  const equipLabel=current?'Equip (replace '+current.name+')':'Equip';
  const decisionBar='<div class="toolbar decision"><button type="button" class="'+(rec.verdict==='replace'?'primary':'secondary')+'" data-scan-save="equip">'+esc(equipLabel)+'</button><button type="button" class="'+(rec.verdict==='replace'?'secondary':'primary')+'" data-scan-save="stash">Keep in stash</button><button type="button" class="quiet" data-scan-save="ignore">Ignore</button><button type="button" class="danger" data-scan-save="salvaged">Mark salvaged</button><button type="button" class="quiet" data-scan-edit>Back to edit</button></div>';
  scanStep(3,'Item grade','<div class="scanlayout"><div class="scanimage">'+((scan.cropData||scan.imageData)?'<img src="'+esc(scan.cropData||scan.imageData)+'" alt="Scanned item">':'')+'</div><div>'
    +'<p class="muted">Graded for <strong>'+esc(b?.name||'no build')+(b?.variantName?' · '+esc(b.variantName):'')+'</strong> · '+esc(slotNames[slot]||slot)+(target?' · guide item: <strong>'+esc(target.name||'any')+'</strong>'+(target.aspect?' with '+esc(target.aspect):''):'')+'</p>'
    +'<div class="scorecards">'+scoreCard('This item',it.name,g,plan.potential)+scoreCard('Equipped',current?.name,gc,planCurrent?.potential)+'</div>'
    +'<div class="recommend '+rec.verdict+'">'+esc(rec.text)+(plan.potential!=null&&gc?.score!=null&&rec.verdict!=='replace'&&plan.potential>gc.score+2?' With crafting it could reach '+plan.potential+', above the equipped '+gc.score+'.':'')+'</div>'+decisionBar
    +(target?'<details class="sectionbox" open><summary>How the score is built</summary><table class="gradetable"><thead><tr><th></th><th>This item</th><th>Equipped</th></tr></thead><tbody>'+compRows+'</tbody></table></details><details class="sectionbox" open><summary>Affixes vs the guide</summary><table class="gradetable"><thead><tr><th>Guide affix</th><th>Guide value</th><th>This item<small>'+esc(it.name||'')+'</small></th><th>Equipped<small>'+esc(current?.name||'nothing equipped')+'</small></th></tr></thead><tbody>'+affixRows+'</tbody></table>'+(extras?'<p class="muted">Not used by the guide:</p><ul class="compactlist">'+extras+'</ul>':'')+'</details>':'')
    +(planHtml?'<section class="sectionbox"><h3>Improve this item'+(plan.potential!=null&&plan.potential>(g?.score??0)?' · up to '+plan.potential+'/100':'')+'</h3><p class="muted">Highlighted steps are included in the estimate (new rolls assumed average). Check costs and eligibility in game.</p><div class="stations">'+planHtml+'</div></section>':'')
    +(target?'<details class="sectionbox"'+(equippedMatches(it,target)?'':' open')+'><summary>'+(equippedMatches(it,target)?'This is the guide’s item · next steps':'How to get the guide’s item')+'</summary>'+acquisitionHtml(c,b,slot,equippedMatches(it,target)?it:current)+'</details>':'')
    +'<details class="sectionbox"><summary>Other uses before salvage</summary>'+usesHtml(it)+'</details>'
    +'<p class="muted small">The score measures fit to the guide’s item, affixes, aspect, tempers and Greater Affixes. It is not a damage calculation.</p>'
    +''+decisionBar+'</div></div>');
  document.querySelectorAll('[data-scan-edit]').forEach(b=>b.onclick=scanVerify);
  document.querySelectorAll('[data-scan-save]').forEach(btn=>btn.onclick=async()=>{
    const action=btn.dataset.scanSave;
    if(action==='equip'&&!c){toast('Create a character first');return}
    const record={...structuredClone(it),images:[scan.cropData,scan.imageData].filter(Boolean),imageHash:scan.hash||null,ocrLines:scan.ocr?.tooltip?.lines||[],rawText:scan.ocr?.text||it.rawText||null,sourceStatus:'Scanned and reviewed by the user',grade:{score:g?.score??null,potential:plan.potential??null,equippedScore:gc?.score??null,build:b?.name||null,variant:b?.variantName||null,target:target?.name||null,at:new Date().toISOString()}};
    record.location=action==='equip'?'stash':action;record.ownerCharacterId=action==='equip'?c.id:null;
    state=addItem(state,record);const saved=state.items.at(-1);
    if(action==='equip'){try{state=equipItem(state,c.id,saved.id,saved.slot)}catch(error){toast(error.message);return}}
    else state.history.push({id:crypto.randomUUID(),at:new Date().toISOString(),type:'item_'+action,itemId:saved.id,characterId:c?.id||null,note:record.name+(g?.score!=null?' · scored '+g.score:'')});
    await save();
    if(scan.phoneId)fetch('api/phone/inbox/'+encodeURIComponent(scan.phoneId),{method:'DELETE'}).catch(()=>{});
    if(nextInBatch()){render();toast(record.name+' saved. Next photo…');return}
    closeModal();view=action==='equip'?'dashboard':'inventory';render();
    toast(action==='equip'?record.name+' equipped'+(current?', replacing '+current.name:'')+'.':'Item '+(action==='stash'?'kept in stash':action)+'.');
  });
}

// ----- Maxroll extras decoded by the planner engine (src/importers/maxroll-enrich.mjs)
function plannerViewerPath(b,variant){
  if(variant?.planner?.viewerPath)return variant.planner.viewerPath.replace(/^\/viewer\//,'viewer/');
  const id=b?.profileId||variant?.planner?.id;if(!id||!/^[a-zA-Z0-9_-]{4,64}$/.test(id))return null;
  const index=Number(String(variant?.id||'').match(/-(\d+)$/)?.[1]??variant?.order??0);
  return 'viewer/viewer.html?embed=1&src='+encodeURIComponent('https://maxroll.gg/d4/planner/'+id)+'&v='+index;
}
function plannerViewerHtml(b,variant,open=false){
  const path=plannerViewerPath(b,variant);if(!path)return '';
  if(EDITION==='portable')return '<details class="setupsection"><summary>Interactive planner</summary><p class="muted">The graphical Paragon boards and skill tree run in the local server edition.</p></details>';
  return '<details class="setupsection plannerview"'+(open?' open':'')+'><summary>Full planner view · all tabs for this variant</summary><p class="muted">Exact planner layout for <strong>'+esc(variant.name)+'</strong>, read from Maxroll'+(ON_SERVER?' by this computer’s local server':'')+'. <a href="'+esc(path.replace('embed=1&',''))+'" target="_blank" rel="noopener">Open in a new tab</a></p><iframe class="plannerframe" title="Interactive planner for '+esc(variant.name)+'" data-src="'+esc(path)+'" loading="lazy"></iframe></details>';
}
function chipList(list){return '<div class="chiplist">'+list.map(x=>'<span class="chip" title="'+esc(x.text||'')+'">'+esc(x.label)+'</span>').join('')+'</div>'}
function buildExtrasHtml(variant){
  const parts=[],m=variant.mercenaries||{};
  if(variant.skills?.bar?.length)parts.push('<h3>Skill bar</h3>'+chipList(variant.skills.bar.map(s=>({label:s.name}))));
  if(variant.classMechanics?.entries?.length){
    const groups={};for(const e of variant.classMechanics.entries)(groups[e.type]||=[]).push(e);
    parts.push('<h3>Class mechanic</h3>'+Object.entries(groups).map(([type,list])=>'<p><small class="muted">'+esc(type)+'</small></p>'+chipList(list.map(e=>({label:e.name,text:e.text})))).join(''));
  }
  if(m.hired||m.reinforcement)parts.push('<h3>Mercenaries</h3><div class="statrow"><span>Hired</span><span>'+esc(m.hired||'—')+'</span></div><div class="statrow"><span>Reinforcement</span><span>'+esc(m.reinforcement||'—')+'</span></div>'+(m.reinforcementSkill?'<div class="statrow"><span>Reinforcement skill</span><span title="'+esc(m.reinforcementSkill.text||'')+'">'+esc(m.reinforcementSkill.name)+'</span></div>':'')+(m.trigger?'<div class="statrow"><span>Trigger</span><span title="'+esc(m.trigger.text||'')+'">'+esc(m.trigger.name)+'</span></div>':'')+((m.entries||[]).length?chipList(m.entries.map(e=>({label:e.name,text:e.text}))):''));
  if(variant.primeEvilPowers?.entries?.some(e=>e.text))parts.push('<h3>Prime Evil Powers</h3>'+variant.primeEvilPowers.entries.map(e=>'<div class="powerline"><strong>'+esc(e.name)+'</strong> <small class="muted">'+esc(e.kind||'')+(e.rank>1?' · level '+esc(e.rank):'')+'</small><div>'+esc(e.text||'')+'</div></div>').join('')+'<p class="muted">Season '+esc((variant.primeEvilPowers.scope?.seasons||[]).join(', ')||'?')+' system. Availability on your realm still needs review.</p>');
  if(variant.warplans?.trees?.some(t=>t.entries?.length))parts.push('<h3>War Plans</h3>'+variant.warplans.trees.filter(t=>t.entries?.length).map(t=>'<p><small class="muted">'+esc(t.name)+'</small></p>'+chipList(t.entries.map(e=>({label:e.name})))).join(''));
  for(const g of variant.seasonalPowers||[])parts.push('<h3>'+esc(g.system)+(g.season?' <small class="muted">· Season '+esc(g.season)+' system</small>':'')+'</h3>'+chipList(g.powers.map(p=>({label:p.name+(p.level>1?' ('+p.level+')':''),text:p.text}))));
  if(variant.seasonalPowers?.length)parts.push('<p class="muted">'+esc(variant.seasonalPowersNote||'')+'</p>');
  if(variant.rotationPlan?.length)parts.push('<h3>Rotation</h3>'+variant.rotationPlan.map(r=>'<div class="statrow"><span>'+esc(r.name)+'</span><span>'+esc(r.skills.join(' → '))+'</span></div>').join(''));
  if(variant.elixirNames?.length)parts.push('<h3>Elixirs & incense</h3>'+chipList(variant.elixirNames.map(n=>({label:n}))));
  const sets=Object.entries(variant.talisman?.setBonuses||{});
  if(sets.length&&variant.planner)parts.push('<h3>Talisman sets</h3>'+sets.map(([name,s])=>'<div class="powerline"><strong>'+esc(name)+'</strong> <small class="muted">'+esc(s.equipped)+' of '+esc(s.total)+' pieces in the planner</small>'+Object.entries(s).filter(([k])=>/^\d+$/.test(k)).map(([k,v])=>'<div class="'+(Number(k)>s.equipped?'muted':'')+'">('+esc(k)+') '+esc(v)+'</div>').join('')+'</div>').join(''));
  const order=variant.paragon?.allocationOrder?.length?variant.paragon.allocationOrder:variant.paragon?.steps?.[variant.paragon?.activeStep]?.allocationOrder;
  if(order?.length)parts.push('<h3>Paragon allocation order</h3><ol class="ordered">'+order.map(o=>'<li>'+esc(o.boardName)+': '+esc(o.name)+'</li>').join('')+'</ol>');
  return parts.length?'<details class="setupsection"><summary>Build extras · class mechanic, mercenary setup, seasonal powers, rotation, sets</summary><div class="extras">'+parts.join('')+'</div></details>':'';
}
function targetPowerHtml(target){
  return (target.uniquePower?'<p><strong>Unique power:</strong> '+esc(target.uniquePower)+'</p>':'')+(target.aspectText?'<p><strong>'+esc(target.aspect||'Aspect')+':</strong> '+esc(target.aspectText)+'</p>':'')+((target.sockets||[]).some(s=>s.text)?'<p><strong>Sockets:</strong></p><ul class="compactlist">'+target.sockets.map(s=>'<li>'+esc(s.name)+(s.kind?' <small class="muted">'+esc(s.kind)+'</small>':'')+(s.text?' — '+esc(s.text):'')+'</li>').join('')+'</ul>':'');
}

// ----- Visual planner sections on Build Progression
const sectionViews={paragon:'paragon',skills:'skills',mercenaries:'systems'};
function sectionFrame(b,variant,view,eager){
  const base=plannerViewerPath(b,variant);
  if(!base||EDITION==='portable')return '';
  const src=base.replace('embed=1&','embed=1&section='+view+'&');
  return '<iframe class="sectionframe" title="'+esc(variant.name+' '+view)+'" '+(eager?'src':'data-src')+'="'+esc(src)+'"></iframe>';
}
function checklistHtml(assessment,key,extra=''){
  const rows=assessment.requirements.filter(r=>r.section===key),count=s=>rows.filter(r=>r.status===s).length;
  return '<details class="checklist"><summary>Checklist · '+count('met')+' met · '+count('missing')+' needed · '+count('unknown')+' to verify</summary>'+extra+requirementRows(assessment,key)+'</details>';
}
function setupSectionHtml(b,c,selected,key,label){
  const v=selected.variant,open=key==='paragon',frame=sectionViews[key]?sectionFrame(b,v,sectionViews[key],open):'';
  const notes=v[key]?.text?'<details><summary>Guide notes</summary><pre class="pre">'+esc(v[key].text)+'</pre></details>':'';
  let body;
  if(key==='paragon'){
    const recorded='<h3>'+esc(c.name)+' — recorded Paragon</h3>'+boardTable(c.setup?.paragon);
    body=frame?frame+notes+checklistHtml(selected,key,'<h3>Board order &amp; glyphs (guide)</h3>'+boardTable(v.paragon)+recorded)
      :'<div class="modalgrid"><div><h3>Variant Paragon target</h3>'+boardTable(v.paragon)+'</div><div>'+recorded+'</div></div>'+notes+requirementRows(selected,key);
  }else body=frame?frame+notes+checklistHtml(selected,key):notes+requirementRows(selected,key);
  return '<details class="setupsection'+(frame?' withmap':'')+'" '+(open?'open':'')+'><summary>'+esc(label)+' · '+esc(v.coverage?.[key]||'unknown')+'</summary>'+body+'</details>';
}
function sectionStateLabel(status){return ({present:'Included',empty:'Empty in guide',partial:'Needs review','not-provided':'Not supplied','notes-only':'Notes only'})[status]||'Not verified'}
function importVariantPreview(variant){
  const counts={gear:Object.keys(variant.slots||{}).length,skills:variant.skills?.entries?.length||0,paragon:variant.paragon?.boards?.length||0,mercenaries:variant.mercenaries?.hired?1:0,warplans:variant.warplans?.entries?.length||0,primeEvilPowers:variant.primeEvilPowers?.entries?.length||0};
  return '<details class="setupsection"><summary>'+esc(variant.name)+' · '+counts.gear+' items · '+counts.skills+' skill allocations · '+counts.paragon+' boards</summary><div class="importsections">'+Object.entries(setupLabels).map(([key,label])=>'<div class="statrow"><span>'+esc(label)+'</span><span>'+esc(sectionStateLabel(variant.sourceSections?.[key]))+'</span></div>').join('')+'</div><h3>Equipment targets</h3>'+Object.entries(variant.slots||{}).map(([slot,target])=>'<details class="importitem"><summary>'+esc(slotNames[slot]||slot)+' — '+esc(target.name)+'</summary><p class="muted">'+esc(target.rarity||'')+' · Item power '+esc(target.itemPower??'?')+' · Quality '+esc(target.quality??'?')+'</p>'+(target.affixes||[]).map(a=>'<div class="affix aunknown'+(a.alternative?' alt':'')+'"><span>'+esc(a.name)+(a.labelStatus==='internal-identifier'?' <small>(label needs review)</small>':'')+(a.alternative?' <small>(alternative)</small>':'')+'</span><span>'+esc(a.idealValue??'not specified')+(a.greaterAffix?' · GA':'')+(a.masterworkTarget?' · ↑ masterwork':'')+'</span></div>').join('')+'<p>Aspect / power: '+esc(target.aspect||target.powers?.map(p=>p.name).join(' / ')||'Not supplied')+'</p><p>Temper: '+esc(target.temper||'Not supplied')+'</p><p>Sockets: '+esc((target.sockets||[]).map(s=>s.name).join(' / ')||'Not supplied')+'</p>'+targetPowerHtml(target)+'</details>').join('')+'<h3>Skill allocations</h3><div class="sourceallocations">'+(variant.skills?.entries||[]).map(s=>'<div>'+esc(s.name)+' · '+esc(s.rank)+'</div>').join('')+'</div><h3>Paragon</h3>'+boardTable(variant.paragon)+'<p>Hired: '+esc(variant.mercenaries?.hired||'Not supplied')+' · Reinforcement: '+esc(variant.mercenaries?.reinforcement||'Not supplied')+'</p>'+buildExtrasHtml(variant)+(variant.notes?'<details><summary>Guide notes and instructions</summary><pre class="pre">'+esc(variant.notes)+'</pre></details>':'')+'</details>';
}
function guideDialog(existingId=null){
  const existing=state.builds.find(b=>b.id===existingId);let pendingDraft=null,referenceImages=[];
  openModal(existing?'Refresh Saved Build':'Import Build Link','GUIDE → REVIEW → REPOSITORY','<p>Paste a Maxroll guide or planner link: every variant, skill and Paragon allocation imports. For <strong>Icy Veins</strong> or <strong>Mobalytics</strong>, use a saved page (below): those sites block automatic reading.</p><form id="guideForm">'+field('Build guide or planner URL','url',existing?.sourceUrl||existing?.sources?.[0]?.url||'','url')+'<div class="toolbar"><button class="primary" id="fetchGuide" type="submit">Load Build</button></div></form><div id="guideLoading" role="status"></div><details class="sectionbox" id="savedPageBox"><summary>Icy Veins or Mobalytics: import a saved page</summary><ol class="steps"><li>On a computer, open the guide in your browser. On Icy Veins, pick the tab you want first (Starter, Endgame…).</li><li>Save it: <strong>File → Save Page As…</strong> (Windows: Ctrl+S, Mac: ⌘S), format “Web Page, Complete” or “HTML Only”.</li><li>Choose the saved <code>.html</code> file here. It is read on this device only.</li></ol><label class="field"><span class="fieldlabel">Saved guide page</span><input id="guideFile" type="file" accept=".html,.htm,text/html"></label></details><div id="guideReview"></div><details class="sectionbox"><summary>Use pasted text or a screenshot instead</summary><label class="field"><span class="fieldlabel">Guide text</span><textarea id="guideText" placeholder="Paste available guide sections"></textarea></label><label class="field"><span class="fieldlabel">Guide screenshot</span><input id="guideImage" type="file" accept="image/*"></label><div class="toolbar"><button class="secondary" id="ocrGuide" type="button">Read Screenshot</button><button class="secondary" id="reviewGuide" type="button">Review Pasted Text</button></div></details>');
  const showReview=draft=>{
    pendingDraft=structuredClone(draft);pendingDraft.referenceImages=[...(draft.referenceImages||[]),...referenceImages];
    const variants=draft.variants||[],owner=char(),compatible=state.characters.filter(c=>!draft.classId||c.classId===draft.classId),selectedOwner=existing?.characterId||compatible.find(c=>c.id===owner?.id)?.id||compatible[0]?.id||'';
    const oldName=existing?.variants?.find(v=>v.id===existing.activeVariantId)?.name,selectedPhase=variants.find(v=>v.name===oldName)?.id||draft.activeVariantId||variants[0]?.id||'';
    const changes=existing?diffBuild(existing,draft):[];
    $('guideReview').innerHTML='<section class="sectionbox"><div class="eyebrow">IMPORT REVIEW</div><h2>'+esc(draft.name||draft.title||'Imported build')+'</h2><p>'+esc(classLabel(draft.classId))+' · Season '+esc(draft.season||'unspecified')+' · '+esc(draft.provider||'text import')+'</p><p class="muted">Author: '+esc(draft.author||'Not supplied')+' · Profile updated: '+esc(draft.sourceUpdatedAt||'Not supplied')+' · Game data version: '+esc(draft.gameDataVersion||'Not supplied')+'</p><div class="notice">Review the supplied targets before saving. A missing section means the guide did not supply it; it does not prove the system is unavailable. Gear, skills and Paragon gaps remain unresolved. Planner numbers can include upgrades and bonuses.</div>'+(draft.importWarnings?.length?'<details><summary>'+draft.importWarnings.length+' source notes / unresolved fields</summary><ul>'+draft.importWarnings.map(w=>'<li>'+esc(w)+'</li>').join('')+'</ul></details>':'')+(existing?'<p>'+changes.length+' changed sections detected. Saving preserves the previous build in history.</p>':'')+'<form id="importReviewForm">'+field('Saved build name','name',draft.name||draft.title||'')+select('Character','characterId',[...compatible.map(c=>({value:c.id,label:c.name+' · '+poolLabel(c)})),{value:'__new',label:'+ New '+classLabel(draft.classId||'unknown')+' character'}],selectedOwner||'__new')+'<div id="newCharacterBox"'+(compatible.length?' hidden':'')+'>'+field('New character name','newCharacterName','')+'</div>'+field('Source season','season',draft.season||'')+field('Guide patch (if specified)','patch',draft.patch||'')+(variants.length?select('Variant to use','variantId',variants.map(v=>({value:v.id,label:v.name})),selectedPhase):'')+'<div class="toolbar"><label><input type="checkbox" id="activateImported" name="activate"> Use this build on the selected character after saving</label></div><label class="field"><span><input id="reviewedImported" type="checkbox" name="reviewed"> I reviewed the imported information and its missing or unresolved sections.</span></label><div class="toolbar"><button class="primary" id="approveGuide" type="submit" disabled>'+(existing?'Save Reviewed Update':'Save Reviewed Build')+'</button></div></form><div class="importvariants">'+(variants.length?variants.map(importVariantPreview).join(''):'<p>Detected '+Object.keys(draft.slots||{}).length+' equipment targets. This source has no structured variant profiles.</p><details><summary>Extracted fields</summary><pre class="pre">'+esc(JSON.stringify({slots:draft.slots,skills:draft.skills,paragon:draft.paragon,mercenaries:draft.mercenaries,warplans:draft.warplans,primeEvilPowers:draft.primeEvilPowers},null,2))+'</pre></details>')+'</div><details id="advancedImport"><summary>Advanced: correct structured import data</summary><button type="button" class="quiet" id="editImportJson">Open Data Editor</button><div id="importJsonEditor"></div></details></section>';
    $('reviewedImported').onchange=()=>{$('approveGuide').disabled=!$('reviewedImported').checked||!$('importReviewForm').elements.characterId.value};
    $('importReviewForm').elements.characterId.onchange=e=>{$('newCharacterBox').hidden=e.target.value!=='__new'};
    $('editImportJson').onclick=()=>{$('importJsonEditor').innerHTML='<label class="field"><span class="fieldlabel">Structured build data</span><textarea id="guideJson" rows="15"></textarea></label>';$('guideJson').value=JSON.stringify(pendingDraft,null,2);$('editImportJson').disabled=true};
    $('importReviewForm').onsubmit=async e=>{e.preventDefault();try{
      if(!$('reviewedImported').checked)throw new Error('Review the import before saving.');
      const fields=new FormData(e.target),reviewed=$('guideJson')?JSON.parse($('guideJson').value):structuredClone(pendingDraft);
      reviewed.name=String(fields.get('name')).trim();reviewed.season=String(fields.get('season')).trim()||null;reviewed.patch=String(fields.get('patch')).trim()||null;
      let characterId=String(fields.get('characterId'));const variantId=fields.get('variantId')||null;
      if(characterId==='__new'){const name=String(fields.get('newCharacterName')||'').trim();if(!name)throw new Error('Name the new character (it can be changed later).');state=createCharacter(state,{name,classId:reviewed.classId||draft.classId||'unknown',realm:reviewed.season?'seasonal':'eternal',season:reviewed.season||null});characterId=state.characters.at(-1).id}
      state=commitBuildImport(state,characterId,reviewed,{existingId,variantId,reviewed:true,activate:fields.has('activate')});
      selectedId=characterId;const saved=existingId?state.builds.find(b=>b.id===existingId):state.builds.at(-1);progressionBuildId=saved.id;progressionVariantId=saved.activeVariantId;
      for(const v of saved.variants||[])for(const slot of Object.keys(v.slots||{}))slotNames[slot]??=slot.replaceAll('_',' ');
      await save();closeModal();view=saved.variants?.length?'progression':'builds';render();toast('Build saved. Current equipment and allocations were preserved.');
    }catch(error){toast('Import review: '+error.message)}};
  };
  const load=async plannerUrl=>{
    const url=$('guideForm').elements.url.value.trim();if(!url){toast('Paste a build URL first.');return}
    if(/(^|\/\/|\.)(icy-veins\.com|mobalytics\.gg)\//i.test(url)){$('guideLoading').innerHTML='<div class="notice">Icy Veins and Mobalytics block automatic reading. Save the guide page from your browser and choose the file under “import a saved page”.</div>';$('savedPageBox').open=true;return}
    if(EDITION==='portable'){$('guideLoading').innerHTML='<div class="notice">Automatic link importing runs in the local server and web editions.</div>';return}
    $('fetchGuide').disabled=true;$('guideLoading').textContent='Reading the guide, variants and game definitions…';
    try{
      const result=await importBuildLink(url,plannerUrl);
      if(result.draft){$('guideLoading').textContent='Source loaded. Review the details below.';if(result.text)$('guideText').value=result.text;result.draft.importWarnings=[...(result.draft.importWarnings||[]),...(result.warnings||[]).filter(w=>!result.draft.importWarnings?.includes(w))];showReview(result.draft)}
      else{
        $('guideLoading').innerHTML='<div class="notice">'+esc(result.warnings?.join(' ')||'Choose a planner link.')+'</div>'+(result.plannerCandidates?.length?select('Planner linked by this guide','plannerChoice',result.plannerCandidates.map(id=>({value:'https://maxroll.gg/d4/planner/'+id,label:'Planner '+id})),null):field('Planner link from this guide','plannerChoice','','url'))+'<button class="secondary" id="loadPlannerChoice">Load Selected Planner</button>';
        $('loadPlannerChoice').onclick=()=>load($('guideLoading').querySelector('[name="plannerChoice"]').value.trim());
      }
    }catch(error){$('guideLoading').innerHTML='<div class="notice">Could not retrieve this build: '+esc(error.message)+'. Try the direct planner URL or the text/screenshot option below.</div>'}
    finally{$('fetchGuide').disabled=false}
  };
  $('guideForm').onsubmit=e=>{e.preventDefault();load()};
  $('guideFile').onchange=async()=>{
    const file=$('guideFile').files[0];if(!file)return;
    try{
      if(file.size>40_000_000)throw new Error('That file is too large to be a saved guide page.');
      const draft=importSavedGuide(await file.text());
      $('guideLoading').innerHTML='<div class="notice">Read '+esc(draft.provider==='icy-veins'?'Icy Veins':'Mobalytics')+' page “'+esc(draft.title)+'”. Review the details below.</div>';
      if(!$('guideForm').elements.url.value)$('guideForm').elements.url.value=draft.url||'';
      showReview(draft);
    }catch(error){$('guideLoading').innerHTML='<div class="notice">'+esc(error.message)+'</div>'}
  };
  $('reviewGuide').onclick=()=>{const text=$('guideText').value;if(!text.trim()){toast('Paste or recognize guide text first.');return}const url=$('guideForm').elements.url.value.trim()||null,extracted=parseGuideText(text,url);showReview(stageGuideImport({...extracted,url,title:extracted.title}))};
  $('ocrGuide').onclick=async()=>{const image=$('guideImage').files[0];if(!image){toast('Choose a screenshot first.');return}if(EDITION==='portable'){toast('Screenshot reading runs in the local server and web editions.');return}try{const result=await recognizeFile(image);result.text=result.fullText||result.text;referenceImages.push(await readAsDataURL(image));$('guideText').value+=($('guideText').value?'\n':'')+result.text;toast('Screenshot text added for review.')}catch(error){toast('Screenshot reading failed: '+error.message)}};
}

/** Build links: the local server reads them; the web edition reads Maxroll's planner API directly. */
async function importBuildLink(url,plannerUrl){
  if(ON_SERVER){
    const response=await fetch('api/import-guide',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,plannerUrl})}),result=await response.json();
    if(!response.ok)throw new Error(result.error||'Import request failed');
    return result;
  }
  const {retrieveMaxroll}=await import('./src/maxroll-retrieve.mjs');
  const readPublic=async u=>{const r=await fetch(u);if(!r.ok)throw new Error('HTTP '+r.status+' from '+new URL(u).hostname);return {text:await r.text(),contentType:r.headers.get('content-type')||'',retrievedAt:new Date().toISOString()}};
  let href;try{href=new URL(url).href}catch{throw new Error('Paste a full https:// link.')}
  const result=await retrieveMaxroll(href,{readPublic,plannerUrl,guideUnavailable:'Maxroll doesn’t let other websites read its guide pages, so the web edition needs the build’s planner link: in the guide, tap the planner link (“Open in Planner”) and paste that address here or below. Planner links import every variant.'});
  if(!result)throw new Error('The web edition reads Maxroll links directly. For Icy Veins or Mobalytics, import a saved page; for other sites, paste the guide text below.');
  return result;
}
window.addEventListener('message',event=>{
  if(event.origin!==location.origin||event.data?.type!=='d4bv-height')return;
  for(const frame of document.querySelectorAll('iframe.sectionframe,iframe.plannerframe'))if(frame.contentWindow===event.source)frame.style.height=Math.min(Math.max(Number(event.data.height)||0,240),6000)+'px';
});
document.addEventListener('toggle',event=>{const frame=event.target.open&&event.target.querySelector?.('iframe[data-src]');if(frame&&!frame.getAttribute('src'))frame.setAttribute('src',frame.dataset.src)},true);
document.addEventListener('click',async event=>{
  const nav=event.target.closest('[data-view]');
  if(nav){view=nav.dataset.view;document.querySelector('.rail').classList.remove('open');render();return}
  const button=event.target.closest('[data-action]');if(!button)return;
  const action=button.dataset.action,id=button.dataset.id,slot=button.dataset.slot;
  try{
    if(action==='open-progression'){progressionBuildId=id;progressionVariantId=null;view='progression';render()}
    else if(action==='inspect-variant'){[progressionBuildId,progressionVariantId]=id.split('::');view='progression';render()}
    else if(action==='use-variant'){const [bid,vid]=id.split('::'),b=state.builds.find(b=>b.id===bid);state=activateVariant(state,b.characterId,bid,vid);selectedId=b.characterId;progressionBuildId=bid;progressionVariantId=vid;await save();render();toast('Variant target changed. Actual equipment and allocations are unchanged.')}
    else if(action==='edit-variant'){const [bid,vid]=id.split('::');variantEditor(bid,vid)}
    else if(action==='edit-variant-gear'){const [bid,vid]=id.split('::');buildEditor(bid,vid)}
    else if(action==='new-variant')variantEditor(id);
    else if(action==='edit-current-setup')currentSetupEditor(id);
    else if(action==='archive-build'){const b=state.builds.find(b=>b.id===id);b.archived=!b.archived;state.history.push({id:crypto.randomUUID(),at:new Date().toISOString(),type:b.archived?'build_archived':'build_restored',buildId:id,characterId:b.characterId});await save();render()}
    else if(action==='open-character'){selectedId=id;stashPool=null;view='dashboard';render()}
    else if(action==='open-seasons'){view='seasons';render()}
    else if(action==='rollover-season')rolloverDialog(id);
    else if(action==='review-withdrawal')withdrawalDialog(id);
    else if(action==='create-character'||action==='edit-character')characterForm(action==='create-character'?null:id);
    else if(action==='duplicate-character'){state=duplicateCharacter(state,id);await save();render();toast('Character duplicated with saved builds.')}
    else if(action==='archive-character'){const c=state.characters.find(x=>x.id===id);state=archiveCharacter(state,id,!c.archived);await save();render()}
    else if(action==='delete-character'){const c=state.characters.find(x=>x.id===id);if(confirm('Delete '+c.name+'? A backup is recommended first.')){state=deleteCharacter(state,id);if(selectedId===id)selectedId=state.characters[0]?.id||null;await save();render()}}
    else if(action==='edit-stats')statsForm();
    else if(action==='switch-build')switchBuildForm();
    else if(action==='scan-item')scanDialog();
    else if(action==='compare-item')compareSavedItem(id);
    else if(action==='equip-saved'){const item=state.items.find(i=>i.id===id);if(!char())throw new Error('Select a character first');state=equipItem(state,char().id,id,item.slot);await save();closeModal();view='dashboard';render()}
    else if(action==='stash-saved'||action==='ignore-saved'){
      const item=state.items.find(i=>i.id===id);
      if(item.location==='withdrawal')throw new Error('Use Season Rollover & Withdrawals to review and transfer this item');
      for(const c of state.characters)for(const [slot,itemId] of Object.entries(c.equipment))if(itemId===id)delete c.equipment[slot];
      item.location=action==='stash-saved'?'stash':'ignored';item.ownerCharacterId=null;
      state.history.push({id:crypto.randomUUID(),at:new Date().toISOString(),type:'item_'+item.location,itemId:id,note:item.name});
      await save();closeModal();render();
    }
    else if(action==='item-detail')itemDetail(id,slot);
    else if(action==='queue-detail')queueDetail(id);
    else if(action==='complete-queue'){const q=build()?.priorityQueue?.find(x=>x.id===id);if(q){q.status='completed';await save();closeModal();render()}}
    else if(action==='edit-item')itemEditor(id);
    else if(action==='create-build')buildEditor();
    else if(action==='edit-build')buildEditor(id);
    else if(action==='refresh-build')guideDialog(id);
    else if(action==='import-guide')guideDialog();
    else if(action==='activate-build'){const b=state.builds.find(x=>x.id===id);selectedId=b.characterId;state=switchBuild(state,selectedId,id);view='dashboard';await save();render()}
  }catch(error){toast(error.message)}
});
$('modalClose').onclick=closeModal;
$('syncBtn').onclick=()=>{document.querySelector('.rail').classList.remove('open');syncDialog()};
$('modal').addEventListener('close',()=>{if(renderAfterModal){renderAfterModal=false;render()}});
$('menuBtn').onclick=()=>document.querySelector('.rail').classList.toggle('open');
$('scanBtn').onclick=scanDialog;$('importGuideBtn').onclick=()=>guideDialog();
$('backupBtn').onclick=()=>{const blob=new Blob([JSON.stringify({...state,exportedWithVersion:APP_VERSION},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='sanctuary-armory-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000)};
$('restoreBtn').onclick=()=>$('restoreFile').click();
$('restoreFile').onchange=async()=>{const file=$('restoreFile').files[0];if(!file)return;try{const imported=importArmory(JSON.parse(await file.text()),initialSeed);if(!confirm('Replace local armory data with this backup?'))return;state=imported;selectedId=state.characters[0]?.id||null;await save();view='home';render();toast('Backup restored.')}catch(error){toast('Restore failed: '+error.message)}finally{$('restoreFile').value=''}};
document.addEventListener('input',event=>{if(event.target.id==='homeSearch'){homeSearch=event.target.value;const pos=event.target.selectionStart;render();$('homeSearch').focus();$('homeSearch').setSelectionRange(pos,pos)}});
document.addEventListener('change',event=>{if(event.target.dataset.codex){const entry=state.codex.find(a=>a.name===event.target.dataset.codex);if(entry){entry.unlocked=event.target.checked;save()}}if(event.target.id==='stashPool'){stashPool=event.target.value;render()}if(event.target.id==='homeFilter'){homeFilter=event.target.value;render()}if(event.target.id==='homeSort'){homeSort=event.target.value;render()}if(event.target.id==='showArchived'){showArchived=event.target.checked;render()}});
// Version shown bottom-left. The server reports its own version; a mismatch means an old server is still
// running or the browser kept an old page.
async function showVersion(){
  const el=$('appVersion');if(!el)return;
  el.textContent='Version '+APP_VERSION+(EDITION==='portable'?' · portable':ON_WEB?' · web':'');
  if(!ON_SERVER)return;
  try{
    const server=(await (await fetch('api/version',{cache:'no-store'})).json()).version;
    if(server&&server!==APP_VERSION){el.classList.add('mismatch');el.textContent='Page '+APP_VERSION+' · server '+server;toast('Version mismatch: this page is '+APP_VERSION+' but the running server is '+server+'. Stop the old server, start the new folder, then reload.')}
  }catch{el.classList.add('mismatch');el.textContent='Version '+APP_VERSION+' · server version unknown (restart the server from this folder)'}
}
async function init(){
  showVersion();loadCatalog();
  try{state=await dbGet()}catch(error){toast('Local database unavailable; changes may not persist. '+error.message)}
  const seed=await (await fetch(ON_WEB?'data/seed-web.json':'src/data/seed.json')).json();initialSeed=seed;
  if(!state){state=seed;await save()}
  else if(!state.affixPlanRevision){
    for(const b of state.builds||[]){
      const initial=seed.builds.find(x=>x.id===b.id);if(!initial)continue;
      for(const [slot,target] of Object.entries(b.slots||{})){
        const source=initial.slots[slot];if(!source)continue;
        for(const key of ['affixSlots','greaterAffixPriority','masterworkPriority','masterworkNote','upgradeNote'])target[key]??=source[key];
        if(!target.affixes?.some(a=>a.primary!==undefined))target.affixes=source.affixes;
      }
    }
    state.craftingRules??=seed.craftingRules;state.affixPlanRevision=1;await save();
  }
  state.history||=[];state.items||=[];state.builds||=[];state.characters||=[];
  // Builds imported before 0.5.0 have blank affix weights; fill them from the saved Maxroll stat priority.
  let weightsFilled=false;
  for(const b of state.builds)for(const v of [b,...(b.variants||[])])for(const t of Object.values(v.slots||{})){if(applyPlannerAffixWeights(t))weightsFilled=true;if(upgradeImportedTarget(t))weightsFilled=true}
  if(weightsFilled)await save();
  if((state.affixPlanRevision||0)<2){
    for(const b of state.builds){
      const source=seed.builds.find(x=>x.id===b.id);
      if(source&&!b.updatedAt){b.slots=structuredClone(source.slots);b.trackedStats=source.trackedStats}
    }
    const boots=state.items.find(i=>i.id==='nastro-boots');
    if(boots?.power?.name==='Necrotic Carapace Aspect')boots.power.rangeVerified=false;
    state.affixPlanRevision=2;await save();
  }
  if(!state.characterIdentityRevision){const nastro=state.characters.find(c=>c.id==='character-nastro');if(nastro?.name==='NASTRO')nastro.name='Nastro';state.characterIdentityRevision=1;await save()}
  if(!state.progressionRevision){
    for(const initial of seed.builds){
      const b=state.builds.find(b=>b.id===initial.id);if(!b||b.variants?.length)continue;
      b.variants=structuredClone(initial.variants||[]);b.activeVariantId=initial.activeVariantId;b.sourceUrl??=initial.sourceUrl;
      const mid=b.variants.find(v=>v.name==='Midgame');if(mid){for(const key of ['slots','talisman','priorityQueue','trackedStats','skills','paragon','mercenaries','warplans','primeEvilPowers'])if(b[key])mid[key]=structuredClone(b[key])}
    }
    state.progressionRevision=1;await save();
  }
  state.settings||=seed.settings||{};
  state.settings.statLabels??=seed.settings.statLabels;
  if(!state.settings.seasonTransitions){state.settings.seasonTransitions=seed.settings.seasonTransitions;await save()}
  if(!state.settings.classes?.length)state.settings.classes=seed.settings.classes;
  if(state.settings.classes?.length){for(const key of Object.keys(glyphs))delete glyphs[key];for(const c of state.settings.classes)glyphs[c.id]=c.glyph||'✦'}
  for(const slot of state.settings.slots||[])slotNames[slot.id]=slot.label||slot.id;
  for(const b of state.builds)for(const v of b.variants||[])for(const slot of Object.keys(v.slots||{}))slotNames[slot]??=slot.replaceAll('_',' ');
  selectedId=state.characters[0]?.id||null;render();
  showSyncStatus();if(syncConfig()?.token){lastAutoSync=Date.now();syncNow({quiet:true})}
}
init().catch(error=>{$('main').innerHTML='<div class="page"><div class="notice">Could not load the armory: '+esc(error.message)+'</div></div>'});
