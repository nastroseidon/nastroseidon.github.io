// Item reading with Claude: the photo goes to Claude's vision model, which returns the item as JSON in a
// fixed shape (structured outputs), so there is no text to re-parse. Shared by the browser (web edition,
// the viewer's own API key) and the local server (key from ANTHROPIC_API_KEY).
//
// Plain fetch instead of the Anthropic SDK: the web edition is a static, no-build site served from
// GitHub Pages, and the server has no npm dependencies. The request is a single Messages API call.

import {slotFromType} from './item-ocr.mjs';

export const CLAUDE_MODELS=[
  {id:'claude-haiku-5-5',label:'Haiku 5.5 (cheapest, well under 0.1¢ per item)'},
  {id:'claude-sonnet-5-5',label:'Sonnet 5.5 (more careful, about 1¢ per item)'},
];
export const DEFAULT_MODEL='claude-haiku-5-5';
const API_URL='https://api.anthropic.com/v1/messages';
const API_VERSION='2026-10-21';

const num={anyOf:[{type:'number'},{type:'null'}]};
const str={anyOf:[{type:'string'},{type:'null'}]};
const obj=(properties)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});

/** JSON schema of Claude's answer. */
export const ITEM_SCHEMA=obj({
  tooltip_box:obj({left:{type:'number'},top:{type:'number'},right:{type:'number'},bottom:{type:'number'}}),
  name:{type:'string'},
  rarity:{type:'string',enum:['Common','Magic','Rare','Legendary','Unique','Mythic','Set','Unknown']},
  ancestral:{type:'boolean'},
  item_type:{type:'string'},
  item_power:num,
  quality_level:num,
  label:str,
  stats:obj({armor:num,damage_per_second:num,damage_per_hit_min:num,damage_per_hit_max:num,attacks_per_second:num,block_chance:num}),
  affixes:{type:'array',items:obj({
    text:{type:'string'},name:{type:'string'},value:num,
    unit:{type:'string',enum:['flat','%','%[x]']},min:num,max:num,
    kind:{type:'string',enum:['implicit','base','temper']},greater_affix:{type:'boolean'},
  })},
  aspect:{anyOf:[obj({description:{type:'string'},imprinted:{type:'boolean'},value:num,unit:{type:'string',enum:['flat','%','%[x]']},min:num,max:num}),{type:'null'}]},
  sockets:{type:'array',items:obj({text:{type:'string'},kind:{type:'string',enum:['empty','gem','rune','other']}})},
  unclear:{type:'array',items:{type:'string'}},
});

const INSTRUCTIONS=`You read Diablo IV item tooltips from screenshots and phone photos of a screen.

Read ONLY the primary item: the single tooltip whose decorated border is fully (or most fully) inside the photo, usually the largest one. Ignore everything outside that border: a second tooltip beside it (compare view), the character sheet, button prompts (Equip, Unequip, Scroll Down, Mark as Favorite, Show/Hide Transmog, Slot Transmog), the "EQUIPPED" header above the border, help pop-ups such as "Fortify is ...", and the game world. Report the primary tooltip's border as tooltip_box, as fractions (0 to 1) of the image width and height, measured from the top-left.

Inside the tooltip, from top to bottom:
- name: the title in capitals, joined into one line when it wraps ("NECROTIC CARAPACE SKOVOSIAN BUSKIN"), written in title case.
- rarity and item_type from the type line ("Unique Two-Handed Scythe": rarity Unique, item_type "Two-Handed Scythe"). ancestral is true when the type line says Ancestral.
- item_power from "850 Item Power"; quality_level from a line like "3 (+3/25) Quality" (3), else null.
- label: a short line of joined rune names under the separator, such as "RalTirTalSol" or "TalEth", else null.
- stats: armor, damage per second, damage per hit range and attacks per second from the base stat lines. These are not affixes.
- affixes: every bulleted stat line, in order. text is the line exactly as shown, joined when it wraps. name is the stat without numbers ("Maximum Life", "Critical Strike Damage Multiplier"); when one of the KNOWN AFFIX NAMES below matches, use it exactly. value is the rolled number; unit is "%[x]" for multiplicative lines that start with "x", "%" for other percentages, else "flat". min and max come from the bracket after it ("[168 - 281]": 168 and 281; a single fixed value "[30]": min and max both 30); null when there is no bracket. A value may sit slightly above its bracket because of Quality upgrades: copy what is shown, do not correct it. kind is "temper" for tempered affixes: they come after the normal ◆ affixes and have a different, larger bullet icon (crossed tools, a shield or a flask shape) instead of the small ◆. "implicit" is for lines above the separator line, else "base". Any non-◆ bullet after the ◆ rows is a temper, not a greater affix. greater_affix is true only for a ◆-position line whose bullet is clearly the greater affix star; when unsure, false.
- aspect: a legendary or unique power sentence (may start with "Imprinted:"), joined into one description, with its first number and bracket; null when there is none.
- sockets: "Empty Socket" lines (kind empty), socketed gems (gem), runes such as "x20% Physical Damage Multiplier" with a rune icon or "Que (Missing Rune of Ritual)" (rune).
Stop before flavour text, "Requires Level", "Account Bound" and sell value.
Numbers: drop thousands separators (1,204 -> 1204). Never guess a number you cannot see: use null and say what was hidden in unclear (for example a row covered by the Scroll Down prompt).`;

/** The Messages API request body for one photo. knownAffixes: affix labels the class can roll. */
export function buildRequest({imageBase64,mediaType,knownAffixes=[],model=DEFAULT_MODEL}){
  return {
    model,
    max_tokens:16000,
    system:[{type:'text',text:INSTRUCTIONS+'\n\nKNOWN AFFIX NAMES:\n'+knownAffixes.join('\n'),cache_control:{type:'ephemeral'}}],
    output_config:{format:{type:'json_schema',schema:ITEM_SCHEMA}},
    messages:[{role:'user',content:[
      {type:'image',source:{type:'base64',media_type:mediaType,data:imageBase64}},
      {type:'text',text:'Read the primary item tooltip in this image.'},
    ]}],
  };
}

async function post(body,{apiKey,fetchImpl=globalThis.fetch,browser=false,signal}={}){
  if(!apiKey)throw new Error('No Anthropic API key set');
  const headers={'content-type':'application/json','x-api-key':apiKey,'anthropic-version':API_VERSION};
  if(browser)headers['anthropic-dangerous-direct-browser-access']='true';
  let response;
  try{response=await fetchImpl(API_URL,{method:'POST',headers,body:JSON.stringify(body),signal})}
  catch(error){if(error?.name==='AbortError')throw error;throw new Error('Could not reach Claude ('+(error?.message||'network error')+')')}
  const data=await response.json().catch(()=>null);
  if(!response.ok){
    const message=data?.error?.message||('HTTP '+response.status);
    const err=new Error(response.status===401?'The Anthropic API key was not accepted ('+message+')'
      :response.status===429?'Claude is busy or the key is over its limit, try again shortly'
      :/credit balance/i.test(message)?'The Anthropic account has no credit left: add some at console.anthropic.com'
      :'Claude answered with an error: '+message);
    err.status=response.status;throw err;
  }
  return data;
}

/** Send the request. Browser calls need the direct-access header (the viewer's own key, on their own device). */
export async function callClaude(body,options={}){
  const data=await post(body,options);
  if(data.stop_reason==='refusal')throw new Error('Claude declined to read this image');
  if(data.stop_reason==='max_tokens')throw new Error('Claude’s answer was cut off');
  const text=(data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
  let parsed;try{parsed=JSON.parse(text)}catch{throw new Error('Claude returned an answer that is not item data')}
  return {reading:parsed,usage:data.usage,model:data.model};
}

/** A tiny request (a few tokens, no image) that checks the key and the model. Throws the same errors as callClaude. */
export async function testKey({model=DEFAULT_MODEL,...options}){
  await post({model,max_tokens:5,messages:[{role:'user',content:'Reply with OK.'}]},options);
  return true;
}

/** Remove what pasting on a phone can add to a key: spaces, line breaks, zero-width characters, quotes. */
export function cleanApiKey(key){return String(key||'').replace(/[\s\u200b-\u200d\u2060\ufeff"'“”‘’]/g,'')}
/** Does this look like an Anthropic API key? */
export function looksLikeApiKey(key){return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)}

const title=s=>/[a-z]/.test(s)?s:String(s||'').toLowerCase().replace(/\b([a-z])/g,c=>c.toUpperCase()).replace(/'S\b/g,"'s");
const clamp=v=>Math.max(0,Math.min(1,Number(v)||0));

/** Claude's reading -> the item record parseTooltip produces, so the rest of the scan flow is unchanged. */
export function readingToItem(r,{slot=null}={}){
  const itemType=String(r.item_type||'').trim()||null;
  const stats={};
  if(r.stats?.armor!=null)stats.armor=r.stats.armor;
  if(r.stats?.damage_per_second!=null)stats['damage per second']=r.stats.damage_per_second;
  if(r.stats?.attacks_per_second!=null)stats['attacks per second']=r.stats.attacks_per_second;
  if(r.stats?.block_chance!=null)stats['block chance']=r.stats.block_chance;
  if(r.stats?.damage_per_hit_min!=null)stats['damage per hit']=r.stats.damage_per_hit_min;
  const affixes=(r.affixes||[]).map(a=>({name:a.name,value:a.value,unit:a.unit||'flat',min:a.min,max:a.max,kind:a.kind||'base',greaterAffix:!!a.greater_affix,sourceText:a.text}));
  const rarity=r.rarity&&r.rarity!=='Unknown'?r.rarity:'Unknown';
  const item={name:title(r.name||'')||'Unidentified item',rarity,itemType,ancestral:!!r.ancestral,slot:slot||slotFromType(itemType),itemPower:r.item_power??null,affixes,
    sockets:(r.sockets||[]).map(s=>s.kind==='empty'?{name:'Empty socket',empty:true}:{name:s.text,kind:s.kind}),stats,power:null,rawText:readingText(r)};
  if(r.label)item.label=r.label;
  if(r.quality_level!=null)item.quality=r.quality_level;
  if(r.aspect?.description)item.power={name:rarity==='Unique'||rarity==='Mythic'?item.name:null,description:r.aspect.description.replace(/^imprinted:\s*/i,''),imprinted:!!r.aspect.imprinted,value:r.aspect.value,unit:r.aspect.unit,min:r.aspect.min,max:r.aspect.max};
  if(r.unclear?.length)item.unclear=r.unclear;
  return item;
}

/** A plain-text view of the reading (stored as the scan's text, and shown under "what was read"). */
export function readingText(r){
  return [r.name,[r.ancestral?'Ancestral':'',r.rarity,r.item_type].filter(Boolean).join(' '),r.item_power!=null?r.item_power+' Item Power':'',r.label||'',
    ...(r.affixes||[]).map(a=>(a.kind==='temper'?'✦ ':'◆ ')+a.text),r.aspect?.description||'',...(r.sockets||[]).map(s=>s.text)].filter(Boolean).join('\n');
}

/** Tooltip box (fractions, top-left origin) in the same shape extractTooltip gives, for cropping the preview. */
export function readingBox(r){
  const b=r.tooltip_box;if(!b)return null;
  const box={left:clamp(b.left),top:clamp(b.top),right:clamp(b.right),bottom:clamp(b.bottom)};
  return box.right>box.left&&box.bottom>box.top?box:null;
}

/** Resize a photo for upload (long side 1568 px is the most the model uses) and return base64 JPEG. Browser only. */
export async function prepareImage(file,maxSide=1568){
  const bmp=await createImageBitmap(file);
  const scale=Math.min(1,maxSide/Math.max(bmp.width,bmp.height));
  const canvas=document.createElement('canvas');canvas.width=Math.round(bmp.width*scale);canvas.height=Math.round(bmp.height*scale);
  canvas.getContext('2d').drawImage(bmp,0,0,canvas.width,canvas.height);
  const url=canvas.toDataURL('image/jpeg',0.9);
  return {imageBase64:url.slice(url.indexOf(',')+1),mediaType:'image/jpeg'};
}
