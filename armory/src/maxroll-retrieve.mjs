// Maxroll guide/planner retrieval shared by the local server (src/import-service.mjs) and the web
// edition (runs in the browser). Only fixed Maxroll endpoints are read; readPublic(url) returns
// {text, contentType, retrievedAt}. Browsers can read the planner API and game data (CORS) but
// not guide pages, so the web edition asks for the planner link when a guide page can't be read.
import {maxrollReference,discoverMaxrollPlanners,normalizeMaxroll} from './importers/maxroll.mjs';
import {enrichMaxrollDraft} from './importers/maxroll-enrich.mjs';

export const MAXROLL_GAME_DATA='https://assets-ng.maxroll.gg/d4-tools/game/data.min.json';
export const MAXROLL_GAME_TEXT='https://assets-ng.maxroll.gg/d4-tools/game/data.enus.json';
export const MAXROLL_PLANNER_API='https://planners.maxroll.gg/profiles/load/d4/';

export function readJson(result){
  if(!/json/i.test(result.contentType||'')&&!/^[\s]*[\[{]/.test(result.text||''))throw new Error('Source did not return JSON.');
  return JSON.parse(result.text);
}

/** Returns null when the URL is not a Maxroll guide/planner (the caller handles other sites). */
export async function retrieveMaxroll(href,{readPublic,readDefinition=readPublic,plannerUrl=null,guideUnavailable=null}={}){
  const ref=maxrollReference(href);
  if(!ref)return null;
  let id=ref.id,profileIndex=ref.profileIndex,guide=null;const guideNotes=[];
  if(plannerUrl){const chosen=maxrollReference(plannerUrl);if(chosen?.type!=='planner')throw new Error('Use a Maxroll planner URL for the planner selection.');id=chosen.id;profileIndex=chosen.profileIndex}
  if(ref.type==='guide'&&!id){
    if(guideUnavailable)return {provider:'maxroll',needsPlannerUrl:true,warnings:[guideUnavailable]};
    try{guide=await readPublic(href)}catch(error){return {provider:'maxroll',needsPlannerUrl:true,warnings:['The guide page could not be read: '+error.message+'. Paste its planner link to retrieve structured variants.']}}
    const page=guide.text.replace(/\\\//g,'/'),candidates=discoverMaxrollPlanners(page);
    // The guide page embeds its own planner profile; when exactly one is embedded it is the guide's main build.
    const embedded=[...new Set([...page.matchAll(/"plannerProfile":\{"id":"([a-zA-Z0-9_-]{4,64})"/g)].map(m=>m[1]))];
    if(embedded.length===1){
      id=embedded[0];
      const others=candidates.filter(c=>c!==id);
      if(others.length)guideNotes.push('This guide also links '+(others.length===1?'another planner':'other planners')+' ('+others.map(o=>'https://maxroll.gg/d4/planner/'+o).join(', ')+'). The guide’s embedded main planner was imported; paste another planner link to import it separately.');
    }
    else if(candidates.length!==1)return {provider:'maxroll',needsPlannerUrl:candidates.length===0,plannerCandidates:candidates,warnings:[candidates.length?'This guide links multiple planners. Choose which planner to import.':'No planner link was discoverable in the guide response. Paste its planner link.']};
    else id=candidates[0];
  }
  const [profile,game,labels]=await Promise.all([readPublic(MAXROLL_PLANNER_API+id),readDefinition(MAXROLL_GAME_DATA),readDefinition(MAXROLL_GAME_TEXT)]);
  const gameJson=readJson(game),labelsJson=readJson(labels);
  const draft=normalizeMaxroll(readJson(profile),gameJson,labelsJson,{url:href,profileIndex});
  try{enrichMaxrollDraft(draft,gameJson,labelsJson)}catch(error){draft.importWarnings=[...(draft.importWarnings||[]),'Extra decoding was skipped: '+error.message]}
  draft.sources=draft.sources.map((source,index)=>({...source,retrievedAt:[profile,game,labels][index]?.retrievedAt||draft.importedAt}));
  if(guide)draft.sources.push({url:href,kind:'guide-discovery',retrievedAt:guide.retrievedAt||draft.importedAt});
  if(guideNotes.length)draft.importWarnings=[...guideNotes,...(draft.importWarnings||[])];
  return {provider:'maxroll',draft,warnings:draft.importWarnings};
}
