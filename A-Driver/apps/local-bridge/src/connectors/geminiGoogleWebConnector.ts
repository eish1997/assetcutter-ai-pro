import type { SendMessagePayload } from "@a-driver/protocol";
import type {
  ConnectorContext,
  ConnectorReplyEvent,
  SiteConnector,
} from "../core/plugin-runtime/siteConnector.js";
import { runBbBrowserCli, stripNpmWarn } from "./runBbBrowserCli.js";

type ReplyCallback = (event: ConnectorReplyEvent) => void;

/** ??bb-browser ??????Gemini ????????Quill */
const DEFAULT_GEMINI_URL =
  process.env.BRIDGE_GEMINI_URL?.trim() || "https://gemini.google.com/app";

const OPEN_SETTLE_MS = Number(process.env.BRIDGE_GEMINI_OPEN_MS || 5000);
const POLL_MS = Number(process.env.BRIDGE_GEMINI_POLL_MS || 600);
const REPLY_TIMEOUT_MS = Number(process.env.BRIDGE_GEMINI_REPLY_TIMEOUT_MS || 180000);
const STABLE_POLLS = Math.max(1, Number(process.env.BRIDGE_GEMINI_STABLE_POLLS || 2));
/** ????????????????????????????????????*/
const COPY_READY_POLLS = Math.max(
  1,
  Number(process.env.BRIDGE_GEMINI_COPY_READY_POLLS || 1)
);
/** 至少观察一小段时间，避免刚出首字就误判完成 */
const MIN_REPLY_OBSERVE_MS = Math.max(
  400,
  Number(process.env.BRIDGE_GEMINI_MIN_REPLY_OBSERVE_MS || 1200)
);
/** copy-ready 后要求文本静默一段时间再 completed，防止被截断 */
const COPY_READY_QUIET_MS = Math.max(
  300,
  Number(process.env.BRIDGE_GEMINI_COPY_READY_QUIET_MS || 1200)
);
const FORCE_NEW_CHAT = String(process.env.BRIDGE_GEMINI_FORCE_NEW_CHAT || "true").toLowerCase() !== "false";
const IMAGE_ATTACH_READY_TIMEOUT_MS = Math.max(
  8000,
  Number(process.env.BRIDGE_GEMINI_IMAGE_ATTACH_READY_TIMEOUT_MS || 30000)
);
const IMAGE_ATTACH_READY_STABLE_POLLS = Math.max(
  2,
  Number(process.env.BRIDGE_GEMINI_IMAGE_ATTACH_READY_STABLE_POLLS || 3)
);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function escapeJsSingleQuoted(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\r\n/g, "\\n")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\n");
}

/** ?? bb-browser eval --json ?? */
function parseEvalEnvelope(stdout: string): {
  ok: boolean;
  result?: string;
  error?: string;
} {
  const t = stdout.trim();
  if (!t) return { ok: false, error: "(empty stdout)" };
  try {
    const o = JSON.parse(t) as Record<string, unknown>;
    if (o.success === false) {
      return { ok: false, error: String(o.error || "eval failed") };
    }
    const data = o.data as Record<string, unknown> | undefined;
    const r = data?.result;
    if (typeof r === "string") return { ok: true, result: r };
    if (r != null && typeof r !== "undefined") {
      return { ok: true, result: JSON.stringify(r) };
    }
    return { ok: true, result: "" };
  } catch {
    return { ok: false, error: "invalid eval JSON" };
  }
}

async function runEval(
  script: string,
  tabId?: string
): Promise<{
  ok: boolean;
  result?: string;
  error?: string;
}> {
  const r = await runBbBrowserCli(["-y", "bb-browser", "eval", script, "--json"], {
    tabId,
  });
  if (r.code !== 0) {
    return {
      ok: false,
      error:
        stripNpmWarn(r.stderr) ||
        r.stdout.trim() ||
        `bb-browser eval ??? ${r.code}`,
    };
  }
  return parseEvalEnvelope(r.stdout);
}

function parseModelSnapshot(jsonStr: string): {
  n: number;
  last: string;
  copyReady: boolean;
  images: string[];
} {
  try {
    const o = JSON.parse(jsonStr) as Record<string, unknown>;
    const n = typeof o.n === "number" ? o.n : 0;
    const last = typeof o.last === "string" ? o.last : "";
    const copyReady = o.copyReady === true;
    const images = Array.isArray(o.images)
      ? o.images.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : [];
    return { n, last, copyReady, images };
  } catch {
    return { n: 0, last: "", copyReady: false, images: [] };
  }
}

/** bb-browser `open --json` ???? eval ???? data.tabId??*/
function parseOpenEnvelope(stdout: string): {
  ok: boolean;
  tabId?: string;
  error?: string;
} {
  const t = stdout.trim();
  if (!t) return { ok: false, error: "(empty stdout)" };
  try {
    const o = JSON.parse(t) as Record<string, unknown>;
    if (o.success === false) {
      return { ok: false, error: String(o.error || "open failed") };
    }
    const data = o.data as Record<string, unknown> | undefined;
    const tid = data?.tabId;
    if (tid != null && String(tid).trim() !== "") {
      return { ok: true, tabId: String(tid).trim() };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "invalid open JSON" };
  }
}

function normReplyWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function uniqStrings(rows: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const it of rows || []) {
    const v = String(it || "").trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function isTrivialAssistantScaffold(s: string): boolean {
  const t = normReplyWhitespace(String(s || "")).toLowerCase();
  if (!t) return true;
  return (
    t === "gemini said" ||
    t === "show thinking gemini said" ||
    t === "show thinking" ||
    t === "creating your image... gemini said"
  );
}

function isGeneratingStatusText(s: string): boolean {
  const t = normReplyWhitespace(String(s || "")).toLowerCase();
  return /creating your image|generating image|正在生成|图片生成中/.test(t);
}

function isLikelyPreviewImageUrl(url: string): boolean {
  const u = String(url || "");
  return /(?:^|[-_])h\d{2,4}-n-v1-rj/i.test(u) || /w\d{2,4}-h\d{2,4}-n-v1-rj/i.test(u);
}

function pickRenderableImages(images: string[]): string[] {
  const uniq = uniqStrings(images);
  const nonPreview = uniq.filter((u) => !isLikelyPreviewImageUrl(u));
  return nonPreview.length > 0 ? nonPreview : uniq;
}

/**
 * Traverse light DOM + shadow roots + same-origin iframes.
 * Extract model text and mark copy-ready when a copy-like button is visible.
 */
const READ_MODEL_SCRIPT = `(function(){var texts=[];var lastModelEl=null;function txt(el){var a=String(el&&el.innerText||'').trim();if(a)return a;return String(el&&el.textContent||'').replace(/\\s+/g,' ').trim();}function isCopyBtn(b){if(!b||b.disabled||b.getAttribute('aria-disabled')==='true')return false;var al=(b.getAttribute('aria-label')||'')+(b.getAttribute('title')||'')+(b.getAttribute('data-tooltip')||'')+(b.getAttribute('jsname')||'');return /copy|content_copy/i.test(al);}function hasCopyDeep(root){if(!root)return false;var q=root.querySelectorAll('button');for(var i=0;i<q.length;i++){if(isCopyBtn(q[i]))return true;}var inner=root.querySelectorAll('*');for(var j=0;j<inner.length;j++){try{var sr=inner[j].shadowRoot;if(sr&&hasCopyDeep(sr))return true;}catch(e){}}return false;}function copyNearModel(el){var cur=el;for(var i=0;i<12&&cur;i++){if(hasCopyDeep(cur))return true;cur=cur.parentElement;}return false;}function collectBestImages(root){if(!root)return[];function allIn(r,sel){var out=[];try{out=[].slice.call(r.querySelectorAll(sel));}catch(e){}var all=[];try{all=r.querySelectorAll('*');}catch(e2){}for(var i=0;i<all.length;i++){try{var sr=all[i].shadowRoot;if(sr)out=out.concat(allIn(sr,sel));}catch(ex){}}return out;}var nodes=allIn(root,'img,source');var rows=[];for(var i=0;i<nodes.length;i++){var el=nodes[i];var u=String(el.currentSrc||el.src||el.getAttribute('src')||'').trim();if(!u||!/^https?:|^data:|^blob:/.test(u))continue;var w=Number(el.naturalWidth||el.videoWidth||el.width||0);var h=Number(el.naturalHeight||el.videoHeight||el.height||0);var area=(w>0&&h>0)?(w*h):0;rows.push({u:u,area:area});}rows.sort(function(a,b){return (b.area||0)-(a.area||0);});var out=[];var seen={};for(var j=0;j<rows.length;j++){var k=rows[j].u;if(!k||seen[k])continue;seen[k]=1;out.push(k);if(out.length>=4)break;}return out;}function pushModels(root){var sel='[data-message-author-role="model"],[message-author-role="model"],model-response,rich-model-response';var nodes=root.querySelectorAll(sel);for(var i=0;i<nodes.length;i++){var t=txt(nodes[i]);if(t){texts.push(t);lastModelEl=nodes[i];}}}function collect(root){pushModels(root);var inner=root.querySelectorAll('*');for(var j=0;j<inner.length;j++){try{var sr=inner[j].shadowRoot;if(sr)collect(sr);}catch(e){}}}function collectFrames(doc){collect(doc);var frames=doc.querySelectorAll('iframe');for(var k=0;k<frames.length;k++){try{var d=frames[k].contentDocument;if(d)collectFrames(d);}catch(e){}}}function fbCopy(root){var q=root.querySelectorAll('button');for(var i=0;i<q.length;i++){var b=q[i];if(!isCopyBtn(b))continue;var a=b;for(var j=0;j<18&&a;j++){var t=txt(a);if(t.length>15){texts.push(t);lastModelEl=a;return;}a=a.parentElement;}}var inner=root.querySelectorAll('*');for(var m=0;m<inner.length;m++){try{var sr=inner[m].shadowRoot;if(sr)fbCopy(sr);}catch(e){}}}collectFrames(document);if(!texts.length){var mc=document.querySelectorAll('message-content');for(var x=0;x<mc.length;x++){var el=mc[x];var r=el.getAttribute('data-message-author-role')||el.getAttribute('message-author-role')||el.getAttribute('message-author')||'';if(r==='model'){var y=txt(el);if(y){texts.push(y);lastModelEl=el;}}}}if(!texts.length){fbCopy(document);}if(!texts.length&&lastModelEl){var z=txt(lastModelEl);if(z)texts.push(z);}var images=collectBestImages(lastModelEl);var n=texts.length;var last=n?texts[n-1]:'';var copyReady=!!(last&&((lastModelEl&&copyNearModel(lastModelEl))||hasCopyDeep(document)));return JSON.stringify({n:n,last:last,copyReady:copyReady,images:images});})()`;

function buildInjectScript(prompt: string): string {
  const e = escapeJsSingleQuoted(prompt);
  /** Gemini 输入框经常改版：支持 ql-editor / rich-textarea / role=textbox + Shadow 递归 */
  return `(function(){var prompt='${e}';function looksEditor(el){if(!el||el.nodeType!==1)return false;var role=el.getAttribute('role')||'';var ce=el.getAttribute('contenteditable')||'';var cls=String(el.className||'');var hint=(el.getAttribute('aria-label')||'')+' '+(el.getAttribute('placeholder')||'');if(el.matches&&el.matches('div.ql-editor, rich-textarea div, div[contenteditable=\"true\"], [role=\"textbox\"]'))return true;if(/ql-editor/i.test(cls))return true;if((role==='textbox'||ce==='true')&&/prompt|message|gemini|ask|输入|提问/i.test(hint))return true;return false;}function findEditor(root){var sel='div.ql-editor, rich-textarea div, div[contenteditable=\"true\"], [role=\"textbox\"]';var cands=[];try{cands=root.querySelectorAll(sel);}catch(e){}var i,el;for(i=0;i<cands.length;i++){el=cands[i];if(looksEditor(el))return el;}var all=[];try{all=root.querySelectorAll('*');}catch(e2){}var j,sr,f;for(j=0;j<all.length;j++){try{sr=all[j].shadowRoot;if(sr){f=findEditor(sr);if(f)return f;}}catch(ex){}}return null;}function emitInput(el,data){try{el.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,inputType:'insertText',data:data}));}catch(e){}try{el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:data}));}catch(e2){try{el.dispatchEvent(new Event('input',{bubbles:true}));}catch(e3){}}}var ed=findEditor(document);if(!ed)return JSON.stringify({ok:0,err:'no-editor'});try{ed.focus();}catch(e4){}try{if(ed.isContentEditable){while(ed.firstChild){ed.removeChild(ed.firstChild);}}}catch(e5){}var ok=false;try{if(document.execCommand){document.execCommand('selectAll',false);ok=!!document.execCommand('insertText',false,prompt);}}catch(ex1){}if(!ok){try{if(ed.isContentEditable){ed.textContent=prompt;ok=true;}}catch(ex2){}}if(!ok){try{ed.appendChild(document.createTextNode(prompt));ok=true;}catch(ex3){}}emitInput(ed,prompt);return JSON.stringify({ok:ok?1:0,err:ok?'':'insert-failed'});})()`;
}

const IMAGE_CHUNK_SIZE = Number(process.env.BRIDGE_GEMINI_IMAGE_CHUNK_SIZE || 28000);

function buildInitImageStageScript(): string {
  return `(function(){window.__bridgeUploadImages={images:[]};return JSON.stringify({ok:1});})()`;
}

function buildInitImageSlotScript(idx: number, mimeType: string): string {
  return `(function(){var st=window.__bridgeUploadImages||(window.__bridgeUploadImages={images:[]});st.images[${idx}]={mimeType:'${escapeJsSingleQuoted(
    mimeType
  )}',dataBase64:'',name:'bridge-image-${idx + 1}'};return JSON.stringify({ok:1});})()`;
}

function buildAppendImageChunkScript(idx: number, chunk: string): string {
  return `(function(){var st=window.__bridgeUploadImages;if(!st||!st.images||!st.images[${idx}])return JSON.stringify({ok:0,err:'no-stage-slot'});st.images[${idx}].dataBase64 += '${escapeJsSingleQuoted(
    chunk
  )}';return JSON.stringify({ok:1});})()`;
}

function buildPasteStagedImagesScript(): string {
  return `(function(){var st=window.__bridgeUploadImages||{};var imgs=Array.isArray(st.images)?st.images:[];function b64ToBytes(b64){var bin=atob(b64);var len=bin.length;var out=new Uint8Array(len);for(var i=0;i<len;i++){out[i]=bin.charCodeAt(i);}return out;}function findEditor(root){var q=root.querySelector('div[contenteditable=\"true\"], [role=\"textbox\"], div.ql-editor, rich-textarea div');if(q)return q;var all=root.querySelectorAll('*');var i,sr,f;for(i=0;i<all.length;i++){try{sr=all[i].shadowRoot;if(sr){f=findEditor(sr);if(f)return f;}}catch(e){}}return null;}var target=findEditor(document)||document.activeElement;if(!target)return JSON.stringify({ok:0,err:'no-editor'});try{target.focus();}catch(e){}var dt;try{dt=new DataTransfer();}catch(e2){return JSON.stringify({ok:0,err:'no-datatransfer'});}var added=0;for(var j=0;j<imgs.length;j++){var it=imgs[j]||{};var b64=String(it.dataBase64||'').trim();if(!b64)continue;try{var mime=String(it.mimeType||'image/jpeg')||'image/jpeg';var bytes=b64ToBytes(b64);var blob=new Blob([bytes],{type:mime});var ext=mime.indexOf('png')>=0?'png':(mime.indexOf('webp')>=0?'webp':'jpg');var file=new File([blob],String(it.name||('bridge-image-'+(j+1)))+'.'+ext,{type:mime});dt.items.add(file);added++;}catch(ex){}}if(!added)return JSON.stringify({ok:0,err:'no-valid-image'});try{var pe=new ClipboardEvent('paste',{bubbles:true,cancelable:true});Object.defineProperty(pe,'clipboardData',{value:dt});target.dispatchEvent(pe);}catch(e3){}try{var de=new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt});target.dispatchEvent(de);}catch(e4){}try{target.dispatchEvent(new Event('input',{bubbles:true}));}catch(e5){}return JSON.stringify({ok:1,added:added});})()`;
}

function buildUploadStagedImagesScript(): string {
  return `(async function(){var st=window.__bridgeUploadImages||{};var imgs=Array.isArray(st.images)?st.images:[];function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}function b64ToBytes(b64){var bin=atob(b64);var len=bin.length;var out=new Uint8Array(len);for(var i=0;i<len;i++){out[i]=bin.charCodeAt(i);}return out;}function findAll(root,sel){var out=[];try{out=[...root.querySelectorAll(sel)];}catch(e){}var all=[];try{all=root.querySelectorAll('*');}catch(e2){}var i,sr;for(i=0;i<all.length;i++){try{sr=all[i].shadowRoot;if(sr)out=out.concat(findAll(sr,sel));}catch(ex){}}return out;}function clickUpload(){var btns=findAll(document,'button,[role="button"]');var best=null;for(var i=0;i<btns.length;i++){var b=btns[i];var al=((b.getAttribute('aria-label')||'')+' '+(b.textContent||'')+' '+(b.getAttribute('title')||'')).toLowerCase();if(/upload|file|image|photo|图片|上传|add photo|add image/.test(al)){best=b;break;}}if(best){try{best.click();return true;}catch(e){}}return false;}function mkFiles(){var dt=new DataTransfer();var added=0;for(var j=0;j<imgs.length;j++){var it=imgs[j]||{};var b64=String(it.dataBase64||'').trim();if(!b64)continue;try{var mime=String(it.mimeType||'image/jpeg')||'image/jpeg';var bytes=b64ToBytes(b64);var blob=new Blob([bytes],{type:mime});var ext=mime.indexOf('png')>=0?'png':(mime.indexOf('webp')>=0?'webp':'jpg');var file=new File([blob],String(it.name||('bridge-image-'+(j+1)))+'.'+ext,{type:mime});dt.items.add(file);added++;}catch(ex){}}return {dt:dt,added:added};}var clicked=clickUpload();var res=mkFiles();if(!res.added)return JSON.stringify({ok:0,err:'no-valid-image'});var inputs=[];for(var t=0;t<10;t++){inputs=findAll(document,'input[type="file"]');if(inputs.length)break;await sleep(150);}if(!inputs.length)return JSON.stringify({ok:0,err:'no-file-input',clicked:clicked?1:0});var k,input,setOk=false;for(k=0;k<inputs.length;k++){input=inputs[k];try{input.files=res.dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));input.dispatchEvent(new Event('input',{bubbles:true}));setOk=true;break;}catch(e){}}return JSON.stringify({ok:setOk?1:0,err:setOk?'':'set-files-failed',inputs:inputs.length,added:res.added,clicked:clicked?1:0});})()`;
}

const CHECK_DRAFT_IMAGES_SCRIPT = `(function(){function allIn(root,sel){var out=[];try{out=[].slice.call(root.querySelectorAll(sel));}catch(e){}var all=[];try{all=root.querySelectorAll('*');}catch(e2){}for(var i=0;i<all.length;i++){try{var sr=all[i].shadowRoot;if(sr)out=out.concat(allIn(sr,sel));}catch(ex){}}return out;}function findEditor(){var q=allIn(document,'div.ql-editor, rich-textarea div, div[contenteditable="true"], [role="textbox"]');for(var i=0;i<q.length;i++){var el=q[i];if(!el)continue;if(el.isContentEditable===true||el.getAttribute('contenteditable')==='true'||el.getAttribute('role')==='textbox')return el;}return null;}function areaOf(ed){var cur=ed;for(var i=0;i<10&&cur;i++){var cls=String(cur.className||'');var tag=String(cur.tagName||'').toLowerCase();if(/input-container|uploader|upload|composer|prompt|footer|chat-input|chatinput|bottom|textbox/i.test(cls)||tag.indexOf('rich-textarea')>=0)return cur;cur=cur.parentElement;}return document;}function visible(el){if(!el)return false;try{var st=getComputedStyle(el);if(st.display==='none'||st.visibility==='hidden'||Number(st.opacity||1)===0)return false;}catch(e){}return true;}function scoreBtn(b){if(!b||!visible(b))return -999;var txt=((b.textContent||'')+' '+(b.getAttribute('aria-label')||'')+' '+(b.getAttribute('title')||'')+' '+(b.getAttribute('data-tooltip')||'')+' '+(b.className||'')).toLowerCase();var s=0;if(/send|submit|arrow_upward|north|发送|提交/.test(txt))s+=14;if(/generate|run|go/.test(txt))s+=2;if(/stop|cancel|停止|取消/.test(txt))s-=20;if(b.disabled||b.getAttribute('aria-disabled')==='true')s-=10;return s;}function pickSend(scope){var btns=allIn(scope,'button,[role="button"]');var best=null;var bestScore=-999;for(var i=0;i<btns.length;i++){var sc=scoreBtn(btns[i]);if(sc>bestScore){bestScore=sc;best=btns[i];}}return {btn:best,score:bestScore};}function hasUploading(scope){var rows=allIn(scope,'[role="progressbar"],progress,[aria-busy="true"],[data-uploading],button,[role="button"],span,div');for(var i=0;i<rows.length&&i<1500;i++){var el=rows[i];if(!el)continue;var t=((el.textContent||'')+' '+(el.getAttribute('aria-label')||'')+' '+(el.getAttribute('title')||'')).toLowerCase();if(/uploading|processing|attaching|上传中|处理中|附件处理中|loading/.test(t))return true;}return false;}function collectImages(scope){var imgs=allIn(scope,'img,source');var out=[];var seen={};for(var i=0;i<imgs.length;i++){var u=String(imgs[i].currentSrc||imgs[i].src||imgs[i].getAttribute('src')||'').trim();if(!u||seen[u])continue;if(!/^https?:|^data:|^blob:/i.test(u))continue;seen[u]=1;out.push(u);}return out;}var ed=findEditor();var scope=areaOf(ed);var images=collectImages(scope);var sendNear=pickSend(scope);var sendGlobal=pickSend(document);var chosen=(sendNear.score>=sendGlobal.score)?sendNear:sendGlobal;var sendBtn=chosen.btn;var sendEnabled=!!(sendBtn&&!(sendBtn.disabled||sendBtn.getAttribute('aria-disabled')==='true')&&chosen.score>-12);var uploading=hasUploading(scope);return JSON.stringify({count:images.length,images:images.slice(0,4),sendEnabled:sendEnabled?1:0,uploading:uploading?1:0,sendScore:chosen.score});})()`;
const READ_PAGE_RESULT_IMAGES_SCRIPT = `(function(){function allIn(root,sel){var out=[];try{out=[].slice.call(root.querySelectorAll(sel));}catch(e){}var all=[];try{all=root.querySelectorAll('*');}catch(e2){}for(var i=0;i<all.length;i++){try{var sr=all[i].shadowRoot;if(sr)out=out.concat(allIn(sr,sel));}catch(ex){}}return out;}function inInputArea(el){var cur=el;for(var i=0;i<10&&cur;i++){var cls=String(cur.className||'');var tag=String(cur.tagName||'').toLowerCase();if(/input-container|uploader|upload|composer|prompt|textbox|chat-input|chatinput|footer/i.test(cls)||tag.indexOf('rich-textarea')>=0)return true;cur=cur.parentElement;}return false;}function tooSmall(el){try{var w=Number(el.naturalWidth||el.videoWidth||el.width||0);var h=Number(el.naturalHeight||el.videoHeight||el.height||0);if(w>0&&h>0&&(w<180||h<180))return true;}catch(e){}return false;}var seen={};var out=[];var imgs=allIn(document,'img,source');for(var i=0;i<imgs.length;i++){var el=imgs[i];if(inInputArea(el))continue;if(tooSmall(el))continue;var u=String(el.currentSrc||el.src||el.getAttribute('src')||'').trim();if(!u||seen[u])continue;if(!/^https?:|^data:|^blob:/i.test(u))continue;seen[u]=1;out.push(u);}var links=allIn(document,'a[href]');for(var j=0;j<links.length;j++){var a=links[j];if(inInputArea(a))continue;var href=String(a.getAttribute('href')||'').trim();if(!href||seen[href])continue;if(/^https?:/i.test(href)&&/googleusercontent|=s\\d+-rj|\\.png|\\.jpg|\\.jpeg|\\.webp/i.test(href)){seen[href]=1;out.push(href);}}return JSON.stringify({images:out.slice(0,8)});})()`;
const READ_MODEL_AREA_RESULT_IMAGES_SCRIPT = `(function(){function allIn(root,sel){var out=[];try{out=[].slice.call(root.querySelectorAll(sel));}catch(e){}var all=[];try{all=root.querySelectorAll('*');}catch(e2){}for(var i=0;i<all.length;i++){try{var sr=all[i].shadowRoot;if(sr)out=out.concat(allIn(sr,sel));}catch(ex){}}return out;}function hasRole(el,role){var cur=el;for(var i=0;i<14&&cur;i++){var r=String(cur.getAttribute&&((cur.getAttribute('data-message-author-role'))||(cur.getAttribute('message-author-role'))||(cur.getAttribute('message-author')))||'').toLowerCase();if(r===role)return true;cur=cur.parentElement;}return false;}function inInputArea(el){var cur=el;for(var i=0;i<10&&cur;i++){var cls=String(cur.className||'');if(/input-container|uploader|upload|composer|prompt|textbox|chat-input|chatinput|footer/i.test(cls))return true;cur=cur.parentElement;}return false;}var seen={};var out=[];var imgs=allIn(document,'img,source');for(var i=0;i<imgs.length;i++){var el=imgs[i];if(inInputArea(el))continue;if(hasRole(el,'user'))continue;if(!hasRole(el,'model'))continue;var u=String(el.currentSrc||el.src||el.getAttribute('src')||'').trim();if(!u||seen[u])continue;if(!/^https?:|^data:|^blob:/i.test(u))continue;seen[u]=1;out.push(u);}return JSON.stringify({images:out.slice(0,8)});})()`;
const READ_LATEST_DOWNLOAD_BLOBS_SCRIPT = `(function(){function allIn(root,sel){var out=[];try{out=[].slice.call(root.querySelectorAll(sel));}catch(e){}var all=[];try{all=root.querySelectorAll('*');}catch(e2){}for(var i=0;i<all.length;i++){try{var sr=all[i].shadowRoot;if(sr)out=out.concat(allIn(sr,sel));}catch(ex){}}return out;}function text(el){return String((el&&el.textContent)||'').replace(/\\s+/g,' ').trim().toLowerCase();}function inInputArea(el){var cur=el;for(var i=0;i<10&&cur;i++){var cls=String(cur.className||'');if(/input-container|uploader|upload|composer|prompt|textbox|chat-input|chatinput|footer/i.test(cls))return true;cur=cur.parentElement;}return false;}var ctrls=allIn(document,'button,[role="button"],a');var rows=[];for(var i=0;i<ctrls.length;i++){var c=ctrls[i];if(inInputArea(c))continue;var lab=((c.getAttribute&&c.getAttribute('aria-label')||'')+' '+(c.getAttribute&&c.getAttribute('title')||'')+' '+text(c)).toLowerCase();if(!/download full-sized image|download full size|下载.*原图|下载.*大图|full-sized/.test(lab))continue;var cur=c;var found='';for(var d=0;d<8&&cur&&!found;d++){var imgs=cur.querySelectorAll?cur.querySelectorAll('img,source'):[];for(var j=0;j<imgs.length;j++){var u=String(imgs[j].currentSrc||imgs[j].src||imgs[j].getAttribute('src')||'').trim();if(/^blob:https?:\\/\\//i.test(u)){found=u;break;}}cur=cur.parentElement;}if(found)rows.push(found);}var out=[];var seen={};for(var k=rows.length-1;k>=0;k--){var u2=rows[k];if(!u2||seen[u2])continue;seen[u2]=1;out.push(u2);if(out.length>=4)break;}return JSON.stringify({images:out});})()`;
const CHECK_IMAGE_GENERATING_STATE_SCRIPT = `(function(){function allIn(root,sel){var out=[];try{out=[].slice.call(root.querySelectorAll(sel));}catch(e){}var all=[];try{all=root.querySelectorAll('*');}catch(e2){}for(var i=0;i<all.length;i++){try{var sr=all[i].shadowRoot;if(sr)out=out.concat(allIn(sr,sel));}catch(ex){}}return out;}function hasStop(){var rows=allIn(document,'button,[role="button"],span,div');for(var i=0;i<rows.length&&i<1500;i++){var t=((rows[i].textContent||'')+' '+(rows[i].getAttribute&&rows[i].getAttribute('aria-label')||'')).toLowerCase();if(/stop generating|停止生成/.test(t))return true;}return false;}var txt=String((document.body&&document.body.innerText)||'').toLowerCase();var creating=/creating your image|generating image|正在生成|图片生成中/.test(txt);return JSON.stringify({busy:(creating||hasStop())?1:0});})()`;
const EXTRACT_IMAGE_DATA_FROM_IMAGE_PAGE_SCRIPT = `(async function(){function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}for(var i=0;i<20;i++){var img=document.images&&document.images[0];if(img&&img.complete&&(img.naturalWidth||0)>0&&(img.naturalHeight||0)>0){break;}await sleep(200);}var im=document.images&&document.images[0];if(!im||!im.complete||(im.naturalWidth||0)<=0||(im.naturalHeight||0)<=0){return JSON.stringify({ok:0,err:'no-loaded-image'});}try{var c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;var ctx=c.getContext('2d');if(!ctx)throw new Error('no-ctx');ctx.drawImage(im,0,0);var data=c.toDataURL('image/png');return JSON.stringify({ok:1,data:data,w:c.width,h:c.height});}catch(e){return JSON.stringify({ok:0,err:String((e&&e.message)||e)});}})()`;
const CHECK_EDITOR_READY_SCRIPT = `(function(){function allIn(root,sel){var out=[];try{out=[].slice.call(root.querySelectorAll(sel));}catch(e){}var all=[];try{all=root.querySelectorAll('*');}catch(e2){}for(var i=0;i<all.length;i++){try{var sr=all[i].shadowRoot;if(sr)out=out.concat(allIn(sr,sel));}catch(ex){}}return out;}var q=allIn(document,'div.ql-editor, rich-textarea div, div[contenteditable="true"], [role="textbox"]');for(var i=0;i<q.length;i++){var el=q[i];if(!el)continue;var role=String(el.getAttribute('role')||'');var ce=String(el.getAttribute('contenteditable')||'');if(el.isContentEditable===true||ce==='true'||role==='textbox')return JSON.stringify({ok:1,count:q.length});}return JSON.stringify({ok:0,count:q.length});})()`;

function buildConvertImagesToDataUrlScript(images: string[]): string {
  const payload = JSON.stringify((images || []).slice(0, 4));
  return `(async function(){var urls=${payload};var out=[];function toDataUrl(blob){return new Promise(function(resolve,reject){try{var fr=new FileReader();fr.onload=function(){resolve(String(fr.result||''));};fr.onerror=function(){reject(new Error('filereader-failed'));};fr.readAsDataURL(blob);}catch(e){reject(e);}});}function findImgByUrl(u){var all=document.querySelectorAll('img');for(var i=0;i<all.length;i++){var s=String(all[i].currentSrc||all[i].src||'');if(s===u||s.indexOf(u)>=0||u.indexOf(s)>=0)return all[i];}return null;}function fromCanvas(img){try{var c=document.createElement('canvas');c.width=img.naturalWidth||img.width||1;c.height=img.naturalHeight||img.height||1;var ctx=c.getContext('2d');if(!ctx)throw new Error('no-ctx');ctx.drawImage(img,0,0);return c.toDataURL('image/png');}catch(e){return '';}}for(var i=0;i<urls.length;i++){var u=String(urls[i]||'').trim();if(!u)continue;if(/^data:/i.test(u)){out.push(u);continue;}var done='';try{var im=findImgByUrl(u);if(im){done=fromCanvas(im)||'';if(done){out.push(done);continue;}}}catch(e0){}try{var r=await fetch(u,{credentials:'include'});if(!r.ok)throw new Error('http-'+r.status);var b=await r.blob();var d=await toDataUrl(b);done=String(d||'');}catch(e){}out.push(done||u);}return JSON.stringify({ok:1,images:out});})()`;
}

async function stageImagesForUpload(
  images: Array<{ mimeType?: string; dataBase64?: string }>,
  tabId: string | undefined
): Promise<void> {
  const startedAt = Date.now();
  const init = await runEval(buildInitImageStageScript(), tabId);
  if (!init.ok) throw new Error(init.error || "初始化图片上传缓冲失败");

  const rows = (images || []).slice(0, 4);
  for (let i = 0; i < rows.length; i++) {
    const mimeType = String(rows[i]?.mimeType || "image/jpeg").trim() || "image/jpeg";
    const b64 = String(rows[i]?.dataBase64 || "").trim();
    if (!b64) continue;

    const slot = await runEval(buildInitImageSlotScript(i, mimeType), tabId);
    if (!slot.ok) throw new Error(slot.error || "初始化图片槽位失败");

    for (let p = 0; p < b64.length; p += IMAGE_CHUNK_SIZE) {
      if (Date.now() - startedAt > 45000) {
        throw new Error("图片注入超时（stageImagesForUpload > 45s）");
      }
      const chunk = b64.slice(p, p + IMAGE_CHUNK_SIZE);
      const append = await runEval(buildAppendImageChunkScript(i, chunk), tabId);
      if (!append.ok) throw new Error(append.error || "分块写入图片失败");
    }
  }
}

async function waitUntilDraftImageReady(
  tabId: string | undefined,
  options?: { timeoutMs?: number; requireSendEnabled?: boolean }
): Promise<string[]> {
  const timeoutMs = Math.max(3000, Number(options?.timeoutMs || IMAGE_ATTACH_READY_TIMEOUT_MS));
  const requireSendEnabled = Boolean(options?.requireSendEnabled);
  const end = Date.now() + timeoutMs;
  let stable = 0;
  let candidateImages: string[] = [];
  let lastSig = "";
  let firstReadyAt = 0;
  while (Date.now() < end) {
    const ck = await runEval(CHECK_DRAFT_IMAGES_SCRIPT, tabId);
    if (ck.ok) {
      try {
        const o = JSON.parse(ck.result || "{}") as {
          count?: number;
          images?: unknown[];
          sendEnabled?: number;
          uploading?: number;
        };
        const imgs = Array.isArray(o.images)
          ? o.images.filter((x): x is string => typeof x === "string")
          : [];
        const hasImages = (o.count || 0) > 0 && imgs.length > 0;
        const sendEnabled = Number(o.sendEnabled || 0) === 1;
        const uploading = Number(o.uploading || 0) === 1;
        if (hasImages && !uploading && (!requireSendEnabled || sendEnabled)) {
          const sig = `${imgs.join("\n")}#send=${sendEnabled ? 1 : 0}`;
          if (sig === lastSig) {
            stable += 1;
          } else {
            lastSig = sig;
            candidateImages = imgs;
            stable = 1;
          }
          if (!firstReadyAt) firstReadyAt = Date.now();
          if (
            stable >= IMAGE_ATTACH_READY_STABLE_POLLS &&
            Date.now() - firstReadyAt >= 1200
          ) {
            return candidateImages;
          }
        } else {
          stable = 0;
          firstReadyAt = 0;
          lastSig = "";
          candidateImages = [];
        }
      } catch {
        /* ignore */
      }
    }
    await sleep(500);
  }
  return [];
}

async function waitUntilSendReady(
  tabId: string | undefined,
  timeoutMs = 15000
): Promise<boolean> {
  const end = Date.now() + Math.max(3000, timeoutMs);
  let stable = 0;
  while (Date.now() < end) {
    const ck = await runEval(CHECK_DRAFT_IMAGES_SCRIPT, tabId);
    if (ck.ok) {
      try {
        const o = JSON.parse(ck.result || "{}") as { sendEnabled?: number; uploading?: number };
        const sendEnabled = Number(o.sendEnabled || 0) === 1;
        const uploading = Number(o.uploading || 0) === 1;
        if (sendEnabled && !uploading) {
          stable += 1;
          if (stable >= IMAGE_ATTACH_READY_STABLE_POLLS) return true;
        } else {
          stable = 0;
        }
      } catch {
        /* ignore */
      }
    }
    await sleep(500);
  }
  return false;
}

async function waitUntilEditorReady(
  tabId: string | undefined,
  timeoutMs = OPEN_SETTLE_MS
): Promise<boolean> {
  const end = Date.now() + Math.max(1200, timeoutMs);
  while (Date.now() < end) {
    const ck = await runEval(CHECK_EDITOR_READY_SCRIPT, tabId);
    if (ck.ok) {
      try {
        const o = JSON.parse(ck.result || "{}") as { ok?: number };
        if (Number(o.ok || 0) === 1) return true;
      } catch {
        /* ignore */
      }
    }
    await sleep(300);
  }
  return false;
}

async function readPageResultImages(tabId: string | undefined): Promise<string[]> {
  const byModel = await runEval(READ_MODEL_AREA_RESULT_IMAGES_SCRIPT, tabId);
  if (byModel.ok) {
    try {
      const m = JSON.parse(byModel.result || "{}") as { images?: unknown[] };
      if (Array.isArray(m.images)) {
        const rows = m.images.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
        if (rows.length > 0) return rows;
      }
    } catch {
      /* ignore */
    }
  }
  const ev = await runEval(READ_PAGE_RESULT_IMAGES_SCRIPT, tabId);
  if (!ev.ok) return [];
  try {
    const o = JSON.parse(ev.result || "{}") as { images?: unknown[] };
    if (!Array.isArray(o.images)) return [];
    return o.images.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  } catch {
    return [];
  }
}

async function readLatestDownloadBlobImages(tabId: string | undefined): Promise<string[]> {
  const byDownload = await runEval(READ_LATEST_DOWNLOAD_BLOBS_SCRIPT, tabId);
  if (!byDownload.ok) return [];
  try {
    const d = JSON.parse(byDownload.result || "{}") as { images?: unknown[] };
    if (!Array.isArray(d.images)) return [];
    return d.images.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  } catch {
    return [];
  }
}

async function isImageGenerationBusy(tabId: string | undefined): Promise<boolean> {
  const ev = await runEval(CHECK_IMAGE_GENERATING_STATE_SCRIPT, tabId);
  if (!ev.ok) return false;
  try {
    const o = JSON.parse(ev.result || "{}") as { busy?: number };
    return Number(o.busy || 0) === 1;
  } catch {
    return false;
  }
}

async function convertUrlsViaImageTabs(urls: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const u of urls.slice(0, 4)) {
    const url = String(u || "").trim();
    if (!url) continue;
    if (/^data:/i.test(url)) {
      out.push(url);
      continue;
    }
    let captured = "";
    let openedTabId: string | undefined;
    try {
      const openRes = await runBbBrowserCli(["-y", "bb-browser", "open", url, "--json"]);
      if (openRes.code === 0) {
        const opened = parseOpenEnvelope(openRes.stdout);
        if (opened.ok && opened.tabId) {
          openedTabId = opened.tabId;
          await sleep(700);
          for (let i = 0; i < 8 && !captured; i++) {
            const ex = await runEval(EXTRACT_IMAGE_DATA_FROM_IMAGE_PAGE_SCRIPT, openedTabId);
            if (ex.ok) {
              try {
                const obj = JSON.parse(ex.result || "{}") as { ok?: number; data?: string };
                if (
                  Number(obj.ok || 0) === 1 &&
                  typeof obj.data === "string" &&
                  obj.data.startsWith("data:image/")
                ) {
                  captured = obj.data;
                  break;
                }
              } catch {
                /* ignore */
              }
            }
            await sleep(400);
          }
        }
      }
    } catch {
      /* ignore */
    } finally {
      if (openedTabId) {
        await runBbBrowserCli(["-y", "bb-browser", "tab", "close"], { tabId: openedTabId });
      }
    }
    out.push(captured || url);
  }
  return out;
}

/** Gemini send trigger with submission verification. */
const CLICK_SEND_SCRIPT = `(async function(){function allIn(root,sel){var out=[];try{out=[].slice.call(root.querySelectorAll(sel));}catch(e){}var all=[];try{all=root.querySelectorAll('*');}catch(e2){}for(var i=0;i<all.length;i++){try{var sr=all[i].shadowRoot;if(sr)out=out.concat(allIn(sr,sel));}catch(ex){}}return out;}function findEditor(){var q=allIn(document,'div.ql-editor, rich-textarea div, div[contenteditable="true"], [role="textbox"]');for(var i=0;i<q.length;i++){var el=q[i];if(!el)continue;if(el.isContentEditable===true||el.getAttribute('contenteditable')==='true'||el.getAttribute('role')==='textbox')return el;}return null;}function editorText(ed){if(!ed)return '';return String(ed.innerText||ed.textContent||'').replace(/\\s+/g,' ').trim();}function areaOf(ed){var cur=ed;for(var i=0;i<10&&cur;i++){var cls=String(cur.className||'');var tag=String(cur.tagName||'').toLowerCase();if(/input-container|uploader|upload|composer|prompt|footer|chat-input|chatinput|bottom|textbox/i.test(cls)||tag.indexOf('rich-textarea')>=0)return cur;cur=cur.parentElement;}return document;}function visible(el){if(!el)return false;try{var st=getComputedStyle(el);if(st.display==='none'||st.visibility==='hidden'||Number(st.opacity||1)===0)return false;}catch(e){}return true;}function scoreBtn(b){if(!b||!visible(b))return -999;var txt=((b.textContent||'')+' '+(b.getAttribute('aria-label')||'')+' '+(b.getAttribute('title')||'')+' '+(b.getAttribute('data-tooltip')||'')+' '+(b.className||'')).toLowerCase();var s=0;if(/send|submit|arrow_upward|north|发送|提交/.test(txt))s+=14;if(/generate|run|go/.test(txt))s+=2;if(/stop|cancel|停止|取消/.test(txt))s-=20;if(b.disabled||b.getAttribute('aria-disabled')==='true')s-=10;return s;}function pick(root){var btns=allIn(root,'button,[role="button"]');var best=null;var bestScore=-999;for(var i=0;i<btns.length;i++){var sc=scoreBtn(btns[i]);if(sc>bestScore){bestScore=sc;best=btns[i];}}return {btn:best,score:bestScore,count:btns.length};}function hasGeneratingUi(){var nodes=allIn(document,'button,[role="button"],div,span');for(var i=0;i<nodes.length&&i<1400;i++){var n=nodes[i];var t=((n.textContent||'')+' '+(n.getAttribute&&n.getAttribute('aria-label')||'')).toLowerCase();if(/stop generating|停止生成/.test(t))return true;}return false;}var ed=findEditor();var before=editorText(ed);if(ed){try{ed.focus();}catch(e3){}}var near=ed?pick(areaOf(ed)):pick(document);var global=pick(document);var chosen=(near.score>=global.score)?near:global;var clicked=0;if(chosen.btn&&chosen.score>-12){try{chosen.btn.click();clicked=1;}catch(e4){}}await new Promise(function(r){setTimeout(r,320);});var after=editorText(findEditor());var submitted=(before.length>0&&after.length===0)||hasGeneratingUi();return JSON.stringify({clicked:clicked,score:chosen.score,count:chosen.count,beforeLen:before.length,afterLen:after.length,submitted:submitted?1:0});})()`;
const CLICK_NEW_CHAT_SCRIPT = `(function(){function walk(root){var out=[];var q=[];try{q=[...root.querySelectorAll('a,button,[role="button"]')];}catch(e){}for(var i=0;i<q.length;i++)out.push(q[i]);var all=[];try{all=root.querySelectorAll('*');}catch(e2){}for(var j=0;j<all.length;j++){try{var sr=all[j].shadowRoot;if(sr)out=out.concat(walk(sr));}catch(ex){}}return out;}var items=walk(document);for(var i=0;i<items.length;i++){var el=items[i];var t=((el.textContent||'')+' '+(el.getAttribute('aria-label')||'')+' '+(el.getAttribute('title')||'')).toLowerCase();if(/new\\s*chat|new\\s*conversation|新建对话|新对话|新的对话/.test(t)){try{el.click();return 'clicked';}catch(e){}}}try{if(location.pathname!=='/app'){location.href='https://gemini.google.com/app';return 'navigating';}}catch(e2){}return 'not-found';})()`;

/**
 * ?? bb-browser ??**????**??Chrome??? gemini.google.com?? Quill ??????????????????? * ???????bb-browser ?????????????? Chrome ????Google??? */
export class GeminiGoogleWebConnector implements SiteConnector {
  readonly id = "gemini-web";
  readonly version = "0.1.0";
  private readonly listeners = new Set<ReplyCallback>();
  private initialized = false;

  match(input: { connectorId: string }): boolean {
    return input.connectorId === this.id;
  }

  async init(_ctx: ConnectorContext): Promise<void> {
    this.initialized = true;
  }

  async sendMessage(input: SendMessagePayload): Promise<void> {
    if (!this.initialized) {
      throw new Error("connector not initialized");
    }

    const t0 = Date.now();
    const logPhase = (msg: string): void => {
      console.log(`[gemini-web] +${Date.now() - t0}ms ${msg}`);
    };
    const expectImageOutput = Boolean(input.images?.length);
    const inputImageUrlSet = new Set<string>();
    const finalizeWithImages = async (textOut: string, imagesOut: string[]): Promise<void> => {
      let sourceImages = uniqStrings(imagesOut);
      const downloadBlobImages = await readLatestDownloadBlobImages(geminiTabId);
      if (downloadBlobImages.length > 0) {
        sourceImages = uniqStrings([...downloadBlobImages, ...sourceImages]);
      }
      let finalImages = sourceImages;
      if (finalImages.length > 0) {
        const conv = await runEval(buildConvertImagesToDataUrlScript(finalImages), geminiTabId);
        if (conv.ok) {
          try {
            const o = JSON.parse(conv.result || "{}") as { images?: unknown[] };
            if (Array.isArray(o.images)) {
              finalImages = o.images.filter((x): x is string => typeof x === "string" && x.length > 0);
            }
          } catch {
            /* ignore */
          }
        }
      }
      if (finalImages.some((u) => !/^data:/i.test(String(u || "")))) {
        finalImages = await convertUrlsViaImageTabs(finalImages);
      }
      this.emit({ kind: "completed", text: textOut, images: finalImages });
    };

    const text = input.text?.trim() || "";
    if (!text) {
      throw new Error("payload.text ????");
    }
    if (input.images?.length) {
      this.emit({
        kind: "delta",
        text: `检测到 ${input.images.length} 张图片，尝试注入到 Gemini 输入框...\n`,
      });
    }

    const url =
      input.threadId?.trim().startsWith("http://") ||
      input.threadId?.trim().startsWith("https://")
        ? input.threadId.trim()
        : DEFAULT_GEMINI_URL;

    this.emit({
      kind: "delta",
      text: "???? bb-browser ?? Gemini ???????? Chrome ????Google??\n",
    });

    const openRes = await runBbBrowserCli(["-y", "bb-browser", "open", url, "--json"]);
    if (openRes.code !== 0) {
      throw new Error(
        stripNpmWarn(openRes.stderr) ||
          openRes.stdout.trim() ||
          "bb-browser open ???????? bb-browser??????????????"
      );
    }
    const opened = parseOpenEnvelope(openRes.stdout);
    if (!opened.ok) {
      throw new Error(opened.error || "bb-browser open ???? JSON");
    }
    /** open ??? tabId ????? --tab???? bb-browser ???????? */
    const geminiTabId = opened.tabId;
    logPhase(`open ok tab=${geminiTabId || "(default)"}`);

    const openReady = await waitUntilEditorReady(geminiTabId, OPEN_SETTLE_MS);
    logPhase(`open settle ready=${openReady ? "yes" : "timeout"} timeout=${OPEN_SETTLE_MS}ms`);
    if (FORCE_NEW_CHAT) {
      const nc = await runEval(CLICK_NEW_CHAT_SCRIPT, geminiTabId);
      logPhase(`new-chat ${String((nc.result || "").trim() || (nc.ok ? "ok" : "failed"))}`);
      const chatReady = await waitUntilEditorReady(geminiTabId, 2500);
      logPhase(`new-chat settle ready=${chatReady ? "yes" : "timeout"} timeout=2500ms`);
    }

    const baseEval = await runEval(READ_MODEL_SCRIPT, geminiTabId);
    if (!baseEval.ok) {
      throw new Error(baseEval.error || "??????");
    }
    const baseline = parseModelSnapshot(baseEval.result || "{}");
    logPhase(`baseline n=${baseline.n} lastLen=${baseline.last.length}`);

    if (input.images?.length) {
      await stageImagesForUpload(input.images, geminiTabId);
      const upload = await runEval(buildUploadStagedImagesScript(), geminiTabId);
      if (!upload.ok) {
        throw new Error(upload.error || "图片上传失败");
      }
      let stagedImageAdded = 0;
      let uploadObj: Record<string, unknown> = {};
      try {
        uploadObj = JSON.parse(upload.result || "{}") as Record<string, unknown>;
      } catch {
        /* ignore */
      }
      if (Number(uploadObj.ok) !== 1) {
        const paste = await runEval(buildPasteStagedImagesScript(), geminiTabId);
        if (!paste.ok) {
          throw new Error(paste.error || "图片注入失败");
        }
        let pasteObj: Record<string, unknown> = {};
        try {
          pasteObj = JSON.parse(paste.result || "{}") as Record<string, unknown>;
        } catch {
          /* ignore */
        }
        if (Number(pasteObj.ok) !== 1) {
          throw new Error(String(uploadObj.err || pasteObj.err || "图片上传失败"));
        }
        stagedImageAdded = Number(pasteObj.added || 0);
        logPhase(`images injected by paste count=${Number(pasteObj.added || 0)}`);
      } else {
        stagedImageAdded = Number(uploadObj.added || 0);
        logPhase(`images uploaded by file-input count=${Number(uploadObj.added || 0)} inputs=${Number(uploadObj.inputs || 0)} clicked=${Number(uploadObj.clicked || 0)}`);
      }
      const draftReadyTimeoutMs = stagedImageAdded > 0 ? 4500 : 12000;
      const draftImgs = await waitUntilDraftImageReady(geminiTabId, {
        timeoutMs: draftReadyTimeoutMs,
      });
      for (const u of draftImgs) inputImageUrlSet.add(String(u || "").trim());
      if (draftImgs.length === 0) {
        if (stagedImageAdded > 0) {
          const ck2 = await runEval(CHECK_DRAFT_IMAGES_SCRIPT, geminiTabId);
          if (ck2.ok) {
            try {
              const o = JSON.parse(ck2.result || "{}") as { images?: unknown[] };
              if (Array.isArray(o.images)) {
                for (const u of o.images) {
                  if (typeof u === "string" && u.trim()) inputImageUrlSet.add(u.trim());
                }
              }
            } catch {
              /* ignore */
            }
          }
          logPhase(`draft image detection missed, continue by staged=${stagedImageAdded} timeout=${draftReadyTimeoutMs}ms`);
          await sleep(400);
        } else {
          throw new Error("图片尚未完成附件就绪，已中止发送。");
        }
      } else {
        logPhase(`draft images settled count=${draftImgs.length} timeout=${draftReadyTimeoutMs}ms`);
      }
    }

    const inj = await runEval(buildInjectScript(text), geminiTabId);
    if (!inj.ok) {
      throw new Error(inj.error || "???????");
    }
    let injObj: Record<string, unknown> = {};
    try {
      injObj = JSON.parse(inj.result || "{}") as Record<string, unknown>;
    } catch {
      /* ignore */
    }
    if (Number(injObj.ok) === 0) {
      throw new Error(
        String(
          injObj.err ||
            "??? div.ql-editor?????????? Gemini ????????? gemini.google.com/app?"
        )
      );
    }
    logPhase("input injected");

    if (expectImageOutput) {
      const sendReady = await waitUntilSendReady(geminiTabId, 20000);
      if (!sendReady) {
        throw new Error("图片已挂载，但发送按钮仍不可用（可能仍在处理附件）。");
      }
      logPhase("draft send-ready ok");
    }

    await sleep(180);
    if (!expectImageOutput) {
      await runBbBrowserCli(["-y", "bb-browser", "press", "Enter"], {
        tabId: geminiTabId,
      });
      await sleep(120);
    }

    const sendClickRetries = Math.max(
      3,
      Number(process.env.BRIDGE_GEMINI_SEND_CLICK_RETRIES || 8)
    );
    const sendClickIntervalMs = Number(
      process.env.BRIDGE_GEMINI_SEND_CLICK_INTERVAL_MS || 350
    );
    let clicked = false;
    let submitted = false;
    let sendScore = -999;
    let sendCandidates = 0;
    let beforeLen = -1;
    let afterLen = -1;
    let clickTry = 0;
    for (let a = 0; a < sendClickRetries; a++) {
      clickTry = a + 1;
      const ck = await runEval(CLICK_SEND_SCRIPT, geminiTabId);
      let clickedThisTry = false;
      let submittedThisTry = false;
      if (ck.ok) {
        try {
          const o = JSON.parse(ck.result || "{}") as {
            clicked?: number;
            score?: number;
            count?: number;
            submitted?: number;
            beforeLen?: number;
            afterLen?: number;
          };
          clickedThisTry = Number(o.clicked || 0) === 1;
          submittedThisTry = Number(o.submitted || 0) === 1;
          sendScore = Number(o.score ?? sendScore);
          sendCandidates = Number(o.count ?? sendCandidates);
          beforeLen = Number(o.beforeLen ?? beforeLen);
          afterLen = Number(o.afterLen ?? afterLen);
        } catch {
          clickedThisTry = (ck.result || "").trim() === "clicked";
        }
      }
      if (clickedThisTry) clicked = true;
      if (submittedThisTry) {
        submitted = true;
        break;
      }
      /**
       * ?? Gemini ?????????aria-label ????? click ?????? miss?
       * ????????????? 25*1.5s ?????
       */
      if (!expectImageOutput && a === 1) {
        await runBbBrowserCli(["-y", "bb-browser", "press", "Control+Enter"], {
          tabId: geminiTabId,
        });
        await sleep(120);
      }
      await sleep(sendClickIntervalMs);
    }
    if (!clicked && !expectImageOutput) {
      await runBbBrowserCli(["-y", "bb-browser", "press", "Enter"], {
        tabId: geminiTabId,
      });
      await sleep(180);
      await runBbBrowserCli(["-y", "bb-browser", "press", "Control+Enter"], {
        tabId: geminiTabId,
      });
      await sleep(180);
      await runBbBrowserCli(["-y", "bb-browser", "press", "Meta+Enter"], {
        tabId: geminiTabId,
      });
      await sleep(400);
      await runEval(CLICK_SEND_SCRIPT, geminiTabId);
    }
    if (!submitted) {
      for (let i = 0; i < 8; i++) {
        await sleep(420);
        const re = await runEval(CLICK_SEND_SCRIPT, geminiTabId);
        if (!re.ok) continue;
        try {
          const o = JSON.parse(re.result || "{}") as { submitted?: number; clicked?: number; beforeLen?: number; afterLen?: number };
          if (Number(o.clicked || 0) === 1) clicked = true;
          if (typeof o.beforeLen === "number") beforeLen = o.beforeLen;
          if (typeof o.afterLen === "number") afterLen = o.afterLen;
          if (Number(o.submitted || 0) === 1) {
            submitted = true;
            break;
          }
        } catch {
          /* ignore */
        }
      }
    }
    logPhase(`send triggered clicked=${clicked ? "yes" : "fallback"} submitted=${submitted ? "yes" : "no"} tries=${clickTry} score=${sendScore} candidates=${sendCandidates} before=${beforeLen} after=${afterLen}`);
    if (!submitted) {
      throw new Error("已检测到输入框内容，但未成功触发发送（按钮/快捷键未生效）。");
    }

    await sleep(250);
    const postSendEval = await runEval(READ_MODEL_SCRIPT, geminiTabId);
    const postSendBaseline = postSendEval.ok
      ? parseModelSnapshot(postSendEval.result || "{}")
      : baseline;
    logPhase(`post-send baseline n=${postSendBaseline.n} lastLen=${postSendBaseline.last.length}`);

    const deadline = Date.now() + REPLY_TIMEOUT_MS;
    let lastText = "";
    let latestImages: string[] = [];
    let latestNewImages: string[] = [];
    let stable = 0;
    let copyStreak = 0;
    let firstReplyAt = 0;
    let lastTextChangedAt = 0;
    let seenNewReplySignature = false;
    let loggedFirstReply = false;
    let loggedCopyReady = false;
    const initialLast = postSendBaseline.last;
    const initialN = postSendBaseline.n;
    const initialLastNorm = normReplyWhitespace(initialLast);
    const baselineImageSet = new Set(uniqStrings(postSendBaseline.images));

    while (Date.now() < deadline) {
      await sleep(POLL_MS);
      const ev = await runEval(READ_MODEL_SCRIPT, geminiTabId);
      if (!ev.ok) continue;
      const cur = parseModelSnapshot(ev.result || "{}");
      if (cur.images.length) {
        latestImages = uniqStrings(cur.images);
        latestNewImages = latestImages.filter((u) => !baselineImageSet.has(u) && !inputImageUrlSet.has(u));
      }
      if (expectImageOutput && latestNewImages.length === 0) {
        const pageImgs = await readPageResultImages(geminiTabId);
        if (pageImgs.length) {
          latestImages = uniqStrings([...latestImages, ...pageImgs]);
          latestNewImages = latestImages.filter((u) => !baselineImageSet.has(u) && !inputImageUrlSet.has(u));
        }
      }
      const renderableNewImages = pickRenderableImages(latestNewImages);
      const imageBusy = expectImageOutput ? await isImageGenerationBusy(geminiTabId) : false;

      const curNorm = normReplyWhitespace(cur.last);
      const signatureChanged =
        cur.n > initialN ||
        (curNorm.length > 0 &&
          curNorm !== initialLastNorm &&
          !isTrivialAssistantScaffold(cur.last));
      if (signatureChanged && !seenNewReplySignature) {
        seenNewReplySignature = true;
        if (!loggedFirstReply) {
          loggedFirstReply = true;
          logPhase(`first new reply n=${cur.n} len=${cur.last.length}`);
        }
        if (firstReplyAt === 0) firstReplyAt = Date.now();
      }
      if (!seenNewReplySignature) continue;

      if (cur.copyReady) {
        copyStreak += 1;
        if (!loggedCopyReady) {
          loggedCopyReady = true;
          logPhase(`copy-ready len=${cur.last.length}`);
        }
      } else {
        copyStreak = 0;
      }
      const lastNorm = normReplyWhitespace(lastText);
      const hasExpectedImage = !expectImageOutput || renderableNewImages.length > 0;
      if (curNorm === lastNorm) {
        stable += 1;
        const now = Date.now();
        const observedMs = firstReplyAt ? now - firstReplyAt : 0;
        const quietMs = lastTextChangedAt ? now - lastTextChangedAt : 0;
        if (
          copyStreak >= COPY_READY_POLLS &&
          cur.last.length > 0 &&
          curNorm !== initialLastNorm &&
          observedMs >= MIN_REPLY_OBSERVE_MS &&
          quietMs >= COPY_READY_QUIET_MS &&
          hasExpectedImage &&
          !imageBusy &&
          !isGeneratingStatusText(cur.last)
        ) {
          await finalizeWithImages(cur.last, expectImageOutput ? renderableNewImages : cur.images);
          logPhase(`completed by copy-ready+quiet len=${cur.last.length} quiet=${quietMs}ms`);
          return;
        }
        if (
          stable >= STABLE_POLLS &&
          cur.last.length > 0 &&
          observedMs >= MIN_REPLY_OBSERVE_MS &&
          hasExpectedImage &&
          !imageBusy &&
          !isGeneratingStatusText(cur.last)
        ) {
          await finalizeWithImages(cur.last, expectImageOutput ? renderableNewImages : cur.images);
          logPhase(`completed by stable-polls len=${cur.last.length}`);
          return;
        }
      } else {
        lastText = cur.last;
        lastTextChangedAt = Date.now();
        stable = 0;
        this.emit({ kind: "delta", text: cur.last });
      }
    }

    if (lastText && (!expectImageOutput || pickRenderableImages(latestNewImages).length > 0) && !isGeneratingStatusText(lastText)) {
      await finalizeWithImages(lastText, expectImageOutput ? pickRenderableImages(latestNewImages) : latestImages);
      logPhase(`completed by fallback-lastText len=${lastText.length}`);
      return;
    }

    await runEval(CLICK_SEND_SCRIPT, geminiTabId);
    await sleep(3000);
    const ev2 = await runEval(READ_MODEL_SCRIPT, geminiTabId);
    if (ev2.ok) {
      const cur2 = parseModelSnapshot(ev2.result || "{}");
      let cur2Images = uniqStrings(cur2.images);
      if (expectImageOutput && cur2Images.length === 0) {
        const pageImgs2 = await readPageResultImages(geminiTabId);
        if (pageImgs2.length) cur2Images = uniqStrings(pageImgs2);
      }
      if (
        cur2.last &&
        normReplyWhitespace(cur2.last) !== normReplyWhitespace(initialLast) &&
        (!expectImageOutput || pickRenderableImages(cur2Images.filter((u) => !baselineImageSet.has(String(u || "").trim()) && !inputImageUrlSet.has(String(u || "").trim()))).length > 0) &&
        !isGeneratingStatusText(cur2.last)
      ) {
        const cur2NewImages = pickRenderableImages(cur2Images.filter((u) => !baselineImageSet.has(u) && !inputImageUrlSet.has(u)));
        await finalizeWithImages(cur2.last, expectImageOutput ? cur2NewImages : cur2Images);
        logPhase(`completed by final-retry len=${cur2.last.length}`);
        return;
      }
    }

    if (expectImageOutput) {
      throw new Error("等待 Gemini 生成图片超时：检测到文本回复，但页面中未采集到结果图片。");
    }
    throw new Error(
      "?? Gemini ?????????1) ????????? gemini.google.com?2) bb-browser ???????????3) ????????????"
    );
  }

  private emitCompleted(text: string): void {
    this.emit({ kind: "completed", text });
  }

  subscribeReplies(cb: ReplyCallback): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  async healthCheck(): Promise<{ healthy: boolean; reason?: string }> {
    const result = await runBbBrowserCli(["-y", "bb-browser", "--version"]);
    if (result.code !== 0) {
      return {
        healthy: false,
        reason: result.stderr || "bb-browser is unavailable",
      };
    }
    return { healthy: true };
  }

  async teardown(): Promise<void> {
    this.listeners.clear();
    this.initialized = false;
  }

  private emit(event: ConnectorReplyEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
