// Sync with a private GitHub repository the user owns: armory/state.json plus armory/images/*.
// Each sync is one commit made with GitHub's Git Data API and a fast-forward ref update, so two
// devices syncing at once can't overwrite each other: the loser re-reads, merges and tries again.
// Merging is three-way per record (characters, builds, items, history, codex, crafting rules) against
// the last state this device synced, so edits on the phone and the Mac combine instead of replacing.

export const DATA_PATH='armory/state.json';
export const IMAGE_DIR='armory/images/';
const KEYS={characters:r=>r?.id,builds:r=>r?.id,items:r=>r?.id,history:r=>r?.id,craftingRules:r=>r?.id,codex:r=>r?.name?(r.characterId||'')+'|'+r.name:null};

const json=v=>v===undefined?undefined:JSON.stringify(v);
const stamp=r=>Date.parse(r?.updatedAt||r?.at||r?.createdAt||'')||0;

function pick(b,l,r,prefer,onConflict){
  const B=json(b),L=json(l),R=json(r);
  if(L===R)return l;
  if(L===B)return r;            // only the other device changed it (or deleted it)
  if(R===B)return l;            // only this device changed it (or deleted it)
  if(l===undefined)return r;    // deleted here, changed there: keep the change
  if(r===undefined)return l;
  onConflict();
  const ls=stamp(l),rs=stamp(r);
  return ls!==rs?(ls>rs?l:r):(prefer==='remote'?r:l);
}

function mergeList(name,base,local,remote,prefer,conflicts){
  const key=KEYS[name];
  const all=[...(base||[]),...(local||[]),...(remote||[])];
  if(!all.every(x=>key(x)))return pick(base,local,remote,prefer,()=>conflicts.push({collection:name}));
  const map=list=>new Map((list||[]).map(x=>[key(x),x]));
  const B=map(base),L=map(local),R=map(remote);
  const order=[...new Set([...(local||[]).map(key),...(remote||[]).map(key)])];
  const out=[];
  for(const k of order){const v=pick(B.get(k),L.get(k),R.get(k),prefer,()=>conflicts.push({collection:name,id:k}));if(v!==undefined)out.push(v)}
  if(name==='history')out.sort((a,b)=>stamp(a)-stamp(b));
  return out;
}

/** Three-way merge of whole app states (in synced form). base may be null (first sync). */
export function mergeStates(base,local,remote,{prefer='local'}={}){
  const conflicts=[],out={};
  const keys=new Set([...Object.keys(local||{}),...Object.keys(remote||{})]);
  for(const k of keys){
    const b=base?.[k],l=local?.[k],r=remote?.[k];
    const v=KEYS[k]&&(Array.isArray(l)||Array.isArray(r))?mergeList(k,b,l,r,prefer,conflicts):pick(b,l,r,prefer,()=>conflicts.push({key:k}));
    if(v!==undefined)out[k]=v;
  }
  return {state:out,conflicts};
}

// ----- Images: synced state refers to images by content hash; the bytes live in armory/images/.
const EXT={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic','image/gif':'gif'};
const MIME=Object.fromEntries(Object.entries(EXT).map(([m,e])=>[e,m]));
const hashMemo=new Map();
export async function sha256Hex(text){
  if(hashMemo.has(text))return hashMemo.get(text);
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  const hex=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
  hashMemo.set(text,hex);return hex;
}
export const imagePath=ref=>IMAGE_DIR+ref.slice(4);
export const isImageRef=v=>typeof v==='string'&&/^img:[0-9a-f]{16,64}\.[a-z]+$/.test(v);
export function dataUrlFromBase64(ref,b64){return 'data:'+(MIME[ref.split('.').pop()]||'application/octet-stream')+';base64,'+b64.replace(/\s/g,'')}

/** Synced form of one item: only the first photo (the crop) travels; it becomes an img: reference. */
async function itemToSynced(item,images){
  if(!Array.isArray(item?.images))return item;
  let first=true;const refs=[];
  for(const v of item.images){
    if(typeof v==='string'&&v.startsWith('data:image/')){
      if(!first)continue;first=false;
      const mime=v.slice(5,v.indexOf(';')),ref='img:'+(await sha256Hex(v)).slice(0,32)+'.'+(EXT[mime]||'img');
      images.set(ref,v);refs.push(ref);
    }else refs.push(v);
  }
  return {...item,images:refs};
}
export async function toSynced(state){
  const images=new Map(),synced={...state};
  if(Array.isArray(state?.items))synced.items=await Promise.all(state.items.map(i=>itemToSynced(i,images)));
  return {synced,images};
}
export const imageRefs=state=>[...new Set((state?.items||[]).flatMap(i=>(i.images||[]).filter(isImageRef)))];

/** Back to a local state: untouched local items keep their full-size photos; images resolve to data URLs. */
export function hydrate(merged,local,localSynced,images){
  const out={...merged};
  if(Array.isArray(merged.items)){
    const localById=new Map((local?.items||[]).map(i=>[i.id,i])),syncedById=new Map((localSynced?.items||[]).map(i=>[i.id,i]));
    out.items=merged.items.map(i=>{
      if(json(syncedById.get(i.id))===json(i))return localById.get(i.id);
      return Array.isArray(i.images)?{...i,images:i.images.map(v=>isImageRef(v)&&images.has(v)?images.get(v):v)}:i;
    });
  }
  return out;
}

// ----- GitHub client (fine-grained token with Contents read/write on the one data repository)
export function githubClient({owner,repo,token,fetch:f=globalThis.fetch.bind(globalThis)}){
  if(!/^[\w.-]+$/.test(owner||'')||!/^[\w.-]+$/.test(repo||''))throw new Error('Enter the data repository as owner/name.');
  const base='https://api.github.com/repos/'+owner+'/'+repo;
  async function api(path,{method='GET',body}={}){
    const r=await f(base+path,{method,cache:'no-store',headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    const data=r.status===204?null:await r.json().catch(()=>null);
    if(!r.ok){const e=new Error(githubError(r.status,data?.message));e.status=r.status;throw e}
    return data;
  }
  return {
    async info(){return api('')},
    async head(branch){try{return (await api('/git/ref/heads/'+encodeURIComponent(branch))).object.sha}catch(e){if(e.status===404||e.status===409)return null;throw e}},
    async init(branch){await api('/contents/armory/README.md',{method:'PUT',body:{message:'Start Sanctuary Armory data',branch,content:btoa('Sanctuary Armory data. Written by the app; edit only if you know what you are doing.\n')}})},
    async tree(commit){
      const c=await api('/git/commits/'+commit),t=await api('/git/trees/'+c.tree.sha+'?recursive=1');
      return {treeSha:c.tree.sha,files:new Map((t.tree||[]).filter(e=>e.type==='blob').map(e=>[e.path,e.sha]))};
    },
    async blobBase64(sha){return (await api('/git/blobs/'+sha)).content.replace(/\s/g,'')},
    async commit({branch,parent,baseTree,files,message}){
      const tree=[];
      for(const file of files){const blob=await api('/git/blobs',{method:'POST',body:{content:file.content,encoding:file.encoding}});tree.push({path:file.path,mode:'100644',type:'blob',sha:blob.sha})}
      const t=await api('/git/trees',{method:'POST',body:{base_tree:baseTree,tree}});
      const c=await api('/git/commits',{method:'POST',body:{message,tree:t.sha,parents:[parent]}});
      await api('/git/refs/heads/'+encodeURIComponent(branch),{method:'PATCH',body:{sha:c.sha,force:false}});
      return c.sha;
    }
  };
}
function githubError(status,message){
  if(status===401)return 'GitHub rejected the token (expired or mistyped). Create a new one and enter it again.';
  if(status===403)return 'The token can’t write to this repository. Give it Contents: Read and write on the data repository. ('+(message||'forbidden')+')';
  if(status===404)return 'Repository not found, or the token can’t see it. Check owner/name and that the token includes this repository.';
  return 'GitHub: '+(message||'HTTP '+status);
}
export const base64ToText=b64=>new TextDecoder().decode(Uint8Array.from(atob(b64),c=>c.charCodeAt(0)));

/**
 * One sync round: read remote, merge with this device's state, push if anything differs.
 * Returns {state (local form), base (synced form to keep for the next merge), pulled, pushed, conflicts}.
 */
export async function runSync({client,local,base=null,device='a device',prefer='local',onStep}){
  const info=await client.info();
  if(info&&info.private===false)throw new Error('The data repository is public. Make it private first (Settings → General → Danger Zone → Change visibility).');
  const branch=info?.default_branch||'main';
  let head=await client.head(branch);
  if(!head){onStep?.('Preparing the repository…');await client.init(branch);head=await client.head(branch)}
  const {synced:localSynced,images}=await toSynced(local);
  for(let attempt=0;attempt<4;attempt++){
    onStep?.('Reading GitHub…');
    const tree=await client.tree(head),stateSha=tree.files.get(DATA_PATH);
    const remote=stateSha?JSON.parse(base64ToText(await client.blobBase64(stateSha))):null;
    const {state:merged,conflicts}=remote?mergeStates(base,localSynced,remote,{prefer}):{state:localSynced,conflicts:[]};
    const missing=imageRefs(merged).filter(ref=>!images.has(ref)&&tree.files.has(imagePath(ref)));
    if(missing.length)onStep?.('Downloading '+missing.length+' item image'+(missing.length>1?'s':'')+'…');
    for(const ref of missing)images.set(ref,dataUrlFromBase64(ref,await client.blobBase64(tree.files.get(imagePath(ref)))));
    const pushed=!remote||json(merged)!==json(remote);
    if(pushed){
      const files=imageRefs(merged).filter(ref=>!tree.files.has(imagePath(ref))&&images.has(ref)).map(ref=>({path:imagePath(ref),content:images.get(ref).split(',')[1],encoding:'base64'}));
      files.push({path:DATA_PATH,content:JSON.stringify(merged),encoding:'utf-8'});
      onStep?.('Saving to GitHub'+(files.length>1?' ('+(files.length-1)+' image'+(files.length>2?'s':'')+')':'')+'…');
      try{head=await client.commit({branch,parent:head,baseTree:tree.treeSha,files,message:'Sync from '+device})}
      catch(e){if(e.status===422||e.status===409){head=await client.head(branch);continue}throw e}
    }
    return {state:hydrate(merged,local,localSynced,images),base:merged,pulled:json(merged)!==json(localSynced),pushed,conflicts,commit:head};
  }
  throw new Error('Another device kept syncing at the same moment. Try again.');
}
