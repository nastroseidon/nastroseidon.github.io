// Text recognition in the browser (web edition, iPhone): Tesseract.js, self-hosted under vendor/tesseract.
// Tesseract's lines are converted to the same shape Apple Vision returns on the Mac ({text, x, y, w, h},
// normalized, y measured from the bottom), split where a line jumps across a wide gap (tooltip vs. side
// panel), so src/item-ocr.mjs reads both the same way.

/** Convert Tesseract.js page data (lines with words and pixel boxes) to Vision-style lines. */
export function tesseractToLines(data,width,height){
  const out=[];
  for(const line of data?.lines||[]){
    const words=(line.words||[]).filter(w=>String(w.text||'').trim()&&w.confidence>=0);
    let seg=null,lastRight=null;
    const flush=()=>{if(seg){out.push(seg);seg=null}};
    for(const w of words){
      // A lone bar is the tooltip border seen in a photo: the text after it belongs to the next panel
      if(/^[|│¦\[\]]+$/.test(String(w.text).trim())){flush();lastRight=null;continue}
      const {x0,y0,x1,y1}=w.bbox,h=y1-y0;
      if(seg&&lastRight!=null&&x0-lastRight>Math.max(width*0.027,2.5*h))flush();
      if(!seg)seg={words:[],l:x0,t:y0,r:x1,b:y1,conf:[]};
      seg.words.push(String(w.text).trim());seg.l=Math.min(seg.l,x0);seg.t=Math.min(seg.t,y0);seg.r=Math.max(seg.r,x1);seg.b=Math.max(seg.b,y1);seg.conf.push(w.confidence);
      lastRight=x1;
    }
    flush();
  }
  return out.map(s=>({text:s.words.join(' '),x:s.l/width,y:1-s.b/height,w:(s.r-s.l)/width,h:(s.b-s.t)/height,confidence:s.conf.reduce((a,b)=>a+b,0)/s.conf.length/100}))
    // Photos of a screen give low-confidence fragments from borders, icons and the panels beside the tooltip
    .filter(l=>!(l.confidence<0.25||l.confidence<0.5&&l.text.replace(/[^\p{L}\p{N}]/gu,'').length<=5))
    .sort((a,b)=>(b.y+b.h)-(a.y+a.h)||a.x-b.x);
}

/** Grayscale + contrast stretch (light game text on dark backgrounds), applied in place to RGBA pixels. */
export function enhancePixels(px){
  let lo=255,hi=0;const n=px.length/4,gray=new Uint8ClampedArray(n);
  for(let i=0;i<n;i++){const g=0.299*px[i*4]+0.587*px[i*4+1]+0.114*px[i*4+2];gray[i]=g}
  // 2nd and 98th percentile so a few bright highlights don't flatten the stretch
  const hist=new Uint32Array(256);for(const g of gray)hist[g]++;
  let acc=0;for(let v=0;v<256;v++){acc+=hist[v];if(acc>=n*0.02){lo=v;break}}
  acc=0;for(let v=255;v>=0;v--){acc+=hist[v];if(acc>=n*0.02){hi=v;break}}
  const span=Math.max(1,hi-lo);
  for(let i=0;i<n;i++){const v=255-Math.max(0,Math.min(255,(gray[i]-lo)*255/span));px[i*4]=px[i*4+1]=px[i*4+2]=v;px[i*4+3]=255}
  return px;
}

let workerPromise=null;
function loadScript(src){
  return new Promise((resolve,reject)=>{if(globalThis.Tesseract)return resolve();const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>reject(new Error('Could not load the text recognizer'));document.head.appendChild(s)});
}
async function worker(base,onProgress){
  if(!workerPromise)workerPromise=(async()=>{
    await loadScript(base+'tesseract.min.js');
    const abs=new URL(base,location.href).href;
    return globalThis.Tesseract.createWorker('eng',1,{workerPath:abs+'worker.min.js',corePath:abs,langPath:abs,gzip:true,workerBlobURL:false,logger:m=>onProgress?.(m)});
  })();
  workerPromise.catch(()=>{workerPromise=null});
  return workerPromise;
}

const affixLike=t=>/[+x×]?\d[\d.,]*%?\s*(\[x\])?\s+[A-Za-z]/.test(t);
const score=tip=>tip.text.split('\n').filter(affixLike).length+(/\b(unique|legendary|mythic|rare|magic|set|ancestral)\b/i.test(tip.text)?3:0);

/**
 * Recognize an image File/Blob. Pass 1 reads the whole photo and finds the tooltip; pass 2 reads just the
 * tooltip, enlarged, which removes most of the noise from the screen around it. Lines come back in
 * whole-image coordinates either way. Returns {lines, width, height, text, passes}.
 */
export async function recognizeImage(file,{base='vendor/tesseract/',maxSide=2000,enhance=false,onProgress,extractTooltip=null}={}){
  const bmp=await createImageBitmap(file);   // applies the photo's EXIF rotation
  const scale=Math.min(1,maxSide/Math.max(bmp.width,bmp.height));
  const width=Math.round(bmp.width*scale),height=Math.round(bmp.height*scale);
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bmp,0,0,width,height);
  // No contrast/invert step by default: on real photos it made Tesseract's reading worse (tested on a phone photo).
  if(enhance){const img=ctx.getImageData(0,0,width,height);enhancePixels(img.data);ctx.putImageData(img,0,0)}
  const w=await worker(base,onProgress);
  const first=await w.recognize(canvas);
  let lines=tesseractToLines(first.data,width,height),text=first.data.text,passes=1;
  const tip=extractTooltip?.(lines),b=tip?.bbox;
  if(b&&(b.right-b.left)*(b.bottom-b.top)<0.8){
    const box={left:Math.max(0,b.left-0.03),top:Math.max(0,b.top-0.02),right:Math.min(1,b.right+0.03),bottom:Math.min(1,b.bottom+0.02)};
    const sw=(box.right-box.left)*bmp.width,sh=(box.bottom-box.top)*bmp.height,up=Math.min(3,Math.max(1,1300/sw));
    const crop=document.createElement('canvas');crop.width=Math.round(sw*up);crop.height=Math.round(sh*up);
    crop.getContext('2d').drawImage(bmp,box.left*bmp.width,box.top*bmp.height,sw,sh,0,0,crop.width,crop.height);
    onProgress?.({status:'reading the item closely',progress:0});
    const second=await w.recognize(crop);
    const local=tesseractToLines(second.data,crop.width,crop.height);
    const W=box.right-box.left,H=box.bottom-box.top;
    // back to whole-image coordinates (y measured from the bottom)
    const mapped=local.map(l=>({...l,x:box.left+l.x*W,w:l.w*W,h:l.h*H,y:(1-box.bottom)+l.y*H}));
    const tip2=extractTooltip(mapped);
    if(score(tip2)>=score(tip)){lines=mapped;text=second.data.text;passes=2}
  }
  return {engine:'Tesseract.js (on this device)',width,height,lines,text,passes};
}
