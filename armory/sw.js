// Sanctuary Armory 0.9.1 service worker: app files cached per version, the text recognizer
// cached once (it is large and changes rarely). Maxroll and GitHub requests are never cached here.
const VERSION="0.9.1",CACHE='armory-'+VERSION,OCR_CACHE='armory-ocr-tesseract-5.1.1';
const SHELL=["./","app.mjs","app.css","assets/necromancer-portrait.png","assets/icons/icon-192.png","assets/icons/icon-512.png","assets/icons/icon-maskable-512.png","assets/icons/apple-touch-icon.png","assets/icons/favicon-32.png","src/version.mjs","src/core.mjs","src/extract.mjs","src/item-ocr.mjs","src/item-grade.mjs","src/acquisition.mjs","src/catalog-match.mjs","src/sync.mjs","src/importers/guide-pages.mjs","src/browser-ocr.mjs","src/maxroll-retrieve.mjs","src/importers/maxroll.mjs","src/importers/maxroll-enrich.mjs","data/item-catalog.json","viewer/js/app.js","viewer/js/exporter.js","viewer/js/gamedata.js","viewer/js/model.js","viewer/js/richtext.js","viewer/js/source.js","viewer/js/ui.js","viewer/js/views.js","viewer/viewer.html","viewer/viewer.css","viewer/icons/icon-128.png","viewer/icons/icon-16.png","viewer/icons/icon-32.png","viewer/icons/icon-48.png","data/seed-web.json","manifest.webmanifest","pwa.js"];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL.map(u=>new Request(u,{cache:'reload'})))).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('armory-')&&k!==CACHE&&k!==OCR_CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const req=e.request,url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==location.origin)return;
  if(url.pathname.includes('/vendor/tesseract/')){
    e.respondWith(caches.open(OCR_CACHE).then(c=>c.match(req).then(hit=>hit||fetch(req).then(r=>{if(r.ok)c.put(req,r.clone());return r}))));
    return;
  }
  e.respondWith(caches.open(CACHE).then(c=>c.match(req,{ignoreSearch:url.pathname.endsWith('viewer.html')}).then(hit=>hit||fetch(req).then(r=>{if(r.ok&&url.pathname.startsWith(new URL('./',self.registration.scope).pathname))c.put(req,r.clone());return r}).catch(()=>req.mode==='navigate'?c.match('./'):Response.error()))));
});
