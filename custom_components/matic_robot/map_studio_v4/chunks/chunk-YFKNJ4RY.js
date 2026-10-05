import{A as Jt,a as Ae,b as ve,c as ye,d as ge,e as tt,f as It,g as st,h as Tt,i as At,j as oe,k as be,l as ie,m as $t,n as S,o as $e,p as Lt,q as Dt,r as Ot,s as zt,t as Wt,u as Ht,v as qt,w as Xt,x as Gt,y as Qt,z as _e}from"./chunk-WXVTD4SF.js";import{A as Rt,B as Et,C as Ct,D as xt,H as te,I as Te,J as Mt,K as Pt,M as w,O as se,P as ne,Q as re,R as Le,S as we,T as De,U as Bt,V as Nt,W as Kt,X as Oe,Y as Ft,Z as Ut,c as wt,e as Ge,f as Qe,h as Me,i as ee,l as L,m as _t,n as Je,o as Ze,pa as Vt,q as kt,qa as nt,r as St,ra as rt,sa as Yt,t as Pe,ta as ot,ua as it,v as fe,va as jt,wa as K,xa as I,y as et,ya as X,z as Ie}from"./chunk-AOYY4JG2.js";var As=(a,t)=>{if(t?.recharge_and_resume===!0&&t?.charging===!0)return"recharging";switch(a){case"cleaning":return"cleaning";case"paused":return"paused";case"returning":return"returning";case"docked":return"docked";case"idle":return"idle";case"error":return"problem";default:return"unknown"}},$s=a=>typeof a!="number"||!Number.isFinite(a)?null:Math.round(Math.max(0,Math.min(100,a))),Ls=a=>{let t=a.attributes?.matic_entry_id;return typeof t=="string"&&t.length>0?t:null},Ds=a=>String(a||"local-user").replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",Zt=a=>{if(typeof a!="string")return"Matic robot";let t=a.trim();return t&&Array.from(t).length<=128&&!/[\u0000-\u001f\u007f]/u.test(t)?t:"Matic robot"},ze=class{#e="";#t=null;project(t,e,s=null){let n=t?.states??{},r=e?.config?.entry_id,i=s||(typeof r=="string"?r:null),l=null,d=null,c=i,u=new Map;for(let[m,C]of Object.entries(n)){let x=Ls(C);x&&m.startsWith("vacuum.")&&(u.set(x,{entryId:x,label:Zt(C.attributes?.friendly_name)}),(i?x===i:!l)&&(l=C,d=m,c=x))}let h={connected:t?.connected!==!1,administrator:t?.user?.is_admin===!0,robotConnected:l!==null&&l.state!=="unavailable"&&l.state!=="unknown",robotCount:u.size},f=l?As(l.state,l.attributes):"unknown",v=$s(l?.attributes?.battery_level),_=t?.selectedLanguage||t?.language||"en",y=Ds(t?.user?.id),g=Zt(l?.attributes?.friendly_name),R=[...u.values()].sort((m,C)=>m.label.localeCompare(C.label,_,{sensitivity:"base"})),k=[h.connected,h.administrator,h.robotConnected,h.robotCount,f,v??"none",_,y,d??"none",c??"none",g,R.map(m=>`${m.entryId}:${m.label}`).join(",")].join("|");return k===this.#e&&this.#t?this.#t:(this.#e=k,this.#t={host:h,activity:f,batteryPercent:v,language:_,userKey:y,vacuumEntityId:d,entryKey:c,robotLabel:g,robots:R},this.#t)}};var ts=Symbol.for(""),Os=a=>{if(a?.r===ts)return a?._$litStatic$},ae=a=>({_$litStatic$:a,r:ts});var es=new Map,at=a=>(t,...e)=>{let s=e.length,n,r,o=[],i=[],l,d=0,c=!1;for(;d<s;){for(l=t[d];d<s&&(r=e[d],(n=Os(r))!==void 0);)l+=n+t[++d],c=!0;d!==s&&i.push(r),o.push(l),d++}if(d===s&&o.push(t[s]),c){let u=o.join("$$lit$$");(t=es.get(u))===void 0&&(o.raw=o,es.set(u,t=o)),e=i}return a(t,...e)},b=at(Te),hn=at(Mt),pn=at(Pt);var zs=1024*1024,ss=a=>{let t=s=>{let n=a.sceneHeaderBytes,r=a.scenePointStride,o=a.sceneMaxPoints,i=a.sceneMaxBytes,l=()=>{throw new Error("invalid-scene")};(!(s instanceof ArrayBuffer)||s.byteLength<n||s.byteLength>i)&&l();let d=new DataView(s),c=new Uint8Array(s,0,8),u=String.fromCharCode(...c),h=d.getUint16(8,!0),f=d.getUint16(10,!0),v=d.getUint32(12,!0),_=d.getUint32(16,!0),y=d.getUint32(20,!0),g=_+y,R=n+v;(u!=="MATIC3D\0"||h!==1||f!==r||v>1048576||g<1||g>o||R+g*f!==s.byteLength)&&l();let k;try{k=JSON.parse(new TextDecoder("utf-8",{fatal:!0}).decode(new Uint8Array(s,n,v)))}catch{l()}(!k||typeof k!="object"||Array.isArray(k))&&l();let m=k,C=m.meters_per_cell,x=m.origin_cells,H=m.span_cells;(typeof C!="number"||!Number.isFinite(C)||C<.001||C>.1||!Array.isArray(x)||x.length!==2||!x.every(T=>typeof T=="number"&&Number.isFinite(T))||!Array.isArray(H)||H.length!==2||!H.every(T=>typeof T=="number"&&Number.isFinite(T)&&T>=1&&T<=65536))&&l();let B=(Array.isArray(m.rooms)?m.rooms.slice(0,128):[]).flatMap((T,Ce)=>{if(!T||typeof T!="object"||Array.isArray(T))return[];let O=T,V=typeof O.name=="string"?O.name.trim():"";if(!V||Array.from(V).length>128||/[\u0000-\u001f\u007f]/u.test(V))return[];if(!Array.isArray(O.boundary)||O.boundary.length<3||O.boundary.length>8192)return[];let xe=O.boundary.flatMap(N=>{if(!Array.isArray(N)||N.length!==2)return[];let[Y,Z]=N;return typeof Y=="number"&&Number.isFinite(Y)&&typeof Z=="number"&&Number.isFinite(Z)?[[Y,Z]]:[]}),G=O.center;if(xe.length<3||!Array.isArray(G)||G.length!==2)return[];let[Q,J]=G;return typeof Q!="number"||!Number.isFinite(Q)||typeof J!="number"||!Number.isFinite(J)?[]:[{id:`scene-room-${Ce+1}`,name:V,boundary:xe,center:[Q,J]}]}),pe=typeof m.sample_step=="number"&&Number.isInteger(m.sample_step)?Math.max(1,Math.min(o,m.sample_step)):1,me=x,Ee=H;return{buffer:s,pointOffset:R,floorCount:_,surfaceCount:y,total:g,metadata:{metersPerCell:C,origin:[me[0],me[1]],span:[Ee[0],Ee[1]],sampleStep:pe,rooms:B}}};return{parseTransfer:t,decodeDeltaTransfer:async(s,n,r)=>{let o=(P="invalid-scene-delta")=>{throw new Error(P)},i=()=>{if(r?.aborted)throw new DOMException("Aborted","AbortError")};(!(s instanceof ArrayBuffer)||s.byteLength<a.deltaHeaderBytes||s.byteLength>a.deltaHeaderBytes+a.deltaMaxBytes||!(n.buffer instanceof ArrayBuffer)||n.buffer.byteLength<a.sceneHeaderBytes||n.buffer.byteLength>a.deltaMaxBytes||!Number.isSafeInteger(n.revision)||n.revision<0)&&o("invalid-scene-delta-size");let l=new DataView(s),d=String.fromCharCode(...new Uint8Array(s,0,8)),c=l.getUint16(8,!0),u=l.getUint16(10,!0),h=l.getBigUint64(12,!0),f=l.getBigUint64(20,!0),v=l.getUint32(28,!0),_=l.getUint32(32,!0),y=Number(h),g=Number(f);(d!=="MATICDLT"||c!==1||u!==1||!Number.isSafeInteger(y)||!Number.isSafeInteger(g)||y!==n.revision||g<=n.revision||v<a.sceneHeaderBytes||v>a.deltaMaxBytes||_<1||_>a.deltaMaxBytes||_+a.deltaHeaderBytes!==s.byteLength)&&o(),typeof DecompressionStream!="function"&&o("scene-delta-decompression-unavailable"),i();let R=new Uint8Array(s,a.deltaHeaderBytes,_),k=Math.max(n.buffer.byteLength,v);k>a.deltaMaxBytes&&o("invalid-scene-delta-size");let m=new Uint8Array(k),x=new Blob([R]).stream().pipeThrough(new DecompressionStream("deflate")).getReader(),H=0,he=null;try{for(he=()=>{x.cancel().catch(()=>{})},r?.addEventListener("abort",he,{once:!0});;){i();let{done:P,value:j}=await x.read();if(P)break;(!(j instanceof Uint8Array)||H+j.byteLength>k)&&o(),m.set(j,H),H+=j.byteLength}}catch(P){if(await x.cancel().catch(()=>{}),r?.aborted||P instanceof DOMException&&P.name==="AbortError")throw new DOMException("Aborted","AbortError");if(P instanceof Error&&P.message==="invalid-scene-delta")throw P;o()}finally{he&&r?.removeEventListener("abort",he),x.releaseLock()}i(),H!==k&&o();let B=new Uint8Array(n.buffer),pe=new DataView(m.buffer,m.byteOffset,m.byteLength),me=Math.min(a.sceneHeaderBytes,B.byteLength);for(let P=0;P<me;P+=1)m[P]=(m[P]??0)^(B[P]??0);let Ee=pe.getUint32(12,!0),T=pe.getUint32(16,!0),Ce=pe.getUint32(20,!0),O=a.sceneHeaderBytes+Ee,V=T+Ce,xe=O===n.pointOffset&&T===n.floorCount&&Ce===n.surfaceCount,G=O+V*a.scenePointStride,Q=xe&&G===v&&V<=a.sceneMaxPoints,J=[],N=-1,Y=!1,Z=()=>{Y&&N>=0&&J.push(N),Y=!1};for(let P=me;P<B.byteLength;P+=a.xorChunkBytes){i();let j=Math.min(B.byteLength,P+a.xorChunkBytes);for(let z=P;z<j;z+=1){let yt=B[z]??0,gt=(m[z]??0)^yt;if(m[z]=gt,!Q||z<n.pointOffset||z>=G)continue;let bt=Math.floor((z-n.pointOffset)/a.dirtyBlockBytes);bt!==N&&(Z(),N=bt),gt!==yt&&(Y=!0)}j<B.byteLength&&await new Promise(z=>globalThis.setTimeout(z,0))}Z(),i();let Ts=v===m.byteLength?m.buffer:m.slice(0,v).buffer;return{parsed:t(Ts),revision:g,...Q?{deltaHint:{baseRevision:y,blockBytes:a.dirtyBlockBytes,dirtyBlocks:J}}:{}}}}},ns=Object.freeze({deltaHeaderBytes:be,deltaMaxBytes:ie,sceneHeaderBytes:st,sceneMaxBytes:oe,sceneMaxPoints:At,scenePointStride:Tt,dirtyBlockBytes:$t,xorChunkBytes:zs}),rs=ss(ns),Ws=a=>{try{return rs.parseTransfer(a)}catch{throw new S("invalid-scene")}},Hs=()=>`
  const { parseTransfer, decodeDeltaTransfer } = (${ss.toString()})(Object.freeze(${JSON.stringify(ns)}));
  self.onmessage = async (event) => {
    const { id, kind, buffer, payload, base } = event.data;
    try {
      if (kind === "parse") {
        const parsed = parseTransfer(buffer);
        self.postMessage({ id, ok: true, parsed }, [parsed.buffer]);
        return;
      }
      const decoded = await decodeDeltaTransfer(payload, base);
      self.postMessage({ id, ok: true, ...decoded }, [decoded.parsed.buffer]);
    } catch (error) {
      const problem = error instanceof Error && error.message.startsWith("invalid-scene")
        ? error.message
        : error instanceof Error && error.message === "scene-delta-decompression-unavailable"
          ? error.message
          : "invalid-scene-delta";
      self.postMessage({ id, ok: false, problem });
    }
  };
`,We=class{#e=null;#t=null;#n=!1;#r=!1;#a=0;#i=null;#o=null;#s=null;constructor(){if(!(typeof Worker!="function"||typeof URL?.createObjectURL!="function"))try{this.#t=URL.createObjectURL(new Blob([Hs()],{type:"text/javascript"})),this.#m()}catch{this.#e=null,this.#t&&URL.revokeObjectURL(this.#t),this.#t=null}}async parse(t,e){if(this.#p(e),t.byteLength>oe||t.byteLength<st)throw new S("invalid-scene");let s=await this.#d({kind:"parse",buffer:t},e,async n=>(await new Promise(r=>globalThis.setTimeout(r,0)),this.#p(n),{id:0,ok:!0,parsed:Ws(t)}));if(!s.parsed)throw new S("invalid-scene");return s.parsed}async decodeDelta(t,e,s){if(this.#p(s),t.byteLength>be+ie||e.buffer.byteLength>ie)throw new S("invalid-scene-delta-size");let n={buffer:e.buffer,revision:e.revision,pointOffset:e.pointOffset,floorCount:e.floorCount,surfaceCount:e.surfaceCount},r;try{r=await this.#d({kind:"delta",payload:t},s,async o=>(await new Promise(i=>globalThis.setTimeout(i,0)),this.#p(o),rs.decodeDeltaTransfer(t,n,o).then(i=>({id:0,ok:!0,...i}))),n)}catch(o){throw o instanceof S?o:s?.aborted||o instanceof DOMException&&o.name==="AbortError"?new DOMException("Aborted","AbortError"):o instanceof Error&&(o.message.startsWith("invalid-scene")||o.message==="scene-delta-decompression-unavailable")?new S(o.message):new S("invalid-scene-delta")}if(!r.parsed||r.revision===void 0)throw new S("invalid-scene-delta");return{parsed:r.parsed,revision:r.revision,...r.deltaHint?{deltaHint:r.deltaHint}:{}}}#p(t){if(this.#r)throw new S("scene-parser-disposed");if(t?.aborted)throw new DOMException("Aborted","AbortError")}#m(){if(!(!this.#t||this.#n||this.#r))try{let t=new Worker(this.#t);t.onmessage=e=>{let s=this.#i;this.#e!==t||!s||s.worker!==t||e.data.id!==s.id||(e.data.ok?this.#w(s,e.data):this.#w(s,void 0,new S(e.data.problem||"invalid-scene")))},t.onerror=()=>this.#c(t),t.onmessageerror=()=>this.#c(t),this.#e=t}catch{this.#e=null,this.#n=!0}}async#d(t,e,s,n){return this.#p(e),new Promise((r,o)=>{let i,l=()=>e?.removeEventListener("abort",i.abort),d=(c,u)=>{i.settled||(i.settled=!0,l(),u!==void 0?o(u):c?r(c):o(new S("invalid-scene")))};i={id:++this.#a,message:t,...e?{signal:e}:{},fallback:s,...n?{base:n}:{},settle:d,abort:()=>this.#S(i),settled:!1,worker:null},e?.addEventListener("abort",i.abort,{once:!0}),e?.aborted||this.#r?d(void 0,e?.aborted?new DOMException("Aborted","AbortError"):new S("scene-parser-disposed")):this.#i?this.#o?d(void 0,new S("scene-parser-busy")):this.#o=i:(this.#i=i,this.#R(i))})}#R(t){if(this.#i!==t)return;if(this.#r){this.#w(t,void 0,new S("scene-parser-disposed"));return}if(t.signal?.aborted){this.#w(t,void 0,new DOMException("Aborted","AbortError"));return}!this.#e&&!this.#n&&this.#m();let e=this.#e;if(e){t.worker=e;try{let n,r;if(t.message.kind==="parse")n={id:t.id,kind:t.message.kind,buffer:t.message.buffer},r=[t.message.buffer];else{if(!t.base)throw new S("invalid-scene-delta");let o={...t.base,buffer:t.base.buffer.slice(0)};n={id:t.id,kind:t.message.kind,payload:t.message.payload,base:o},r=[t.message.payload,o.buffer]}e.postMessage(n,r)}catch{this.#c(e)}return}let s=new AbortController;this.#s=s,Promise.resolve().then(()=>t.fallback(s.signal)).then(n=>this.#w(t,n),n=>this.#w(t,void 0,n))}#S(t){let e=new DOMException("Aborted","AbortError");if(this.#o===t){this.#o=null,t.settle(void 0,e);return}this.#i===t&&(t.worker?(this.#y(),this.#w(t,void 0,e)):this.#s?.abort())}#w(t,e,s){if(this.#i!==t){t.settle(void 0,new S("scene-parser-disposed"));return}let n=t.signal?.aborted?new DOMException("Aborted","AbortError"):s;t.settle(e,n),this.#i=null,this.#s=null,t.worker=null,this.#r||this.#f()}#f(){if(this.#r||this.#i||!this.#o)return;let t=this.#o;if(this.#o=null,t.signal?.aborted){t.settle(void 0,new DOMException("Aborted","AbortError")),this.#f();return}this.#i=t,this.#R(t)}#c(t){if(this.#e!==t)return;this.#n=!0,this.#y();let e=this.#i;e?.worker===t?this.#w(e,void 0,new S("scene-worker-failed")):this.#f()}#y(){this.#e?.terminate(),this.#e=null}dispose(){if(this.#r)return;this.#r=!0;let t=this.#o;this.#o=null,t?.settle(void 0,new S("scene-parser-disposed"));let e=this.#i;this.#y(),this.#s?.abort(),this.#s=null,e&&(e.worker=null,e.settle(void 0,new S("scene-parser-disposed"))),this.#i=null,this.#t&&URL.revokeObjectURL(this.#t),this.#t=null}};var D={catalog:1e4,scene:6e4,delta:35e3,pose:1e4,history:15e3,workflow:15e3,mutation:2e4,roomPreview:15e3},qs=2,ke=new WeakMap,os={coverage_identity_unavailable:"Could not verify the current cleaning task. Check the robot status, then try again.",coverage_activity_unavailable:"Could not verify whether the robot is cleaning. Check the robot status, then try again.",coverage_native_session_active:"The robot already has a cleaning task. Wait for it to finish before starting another cleaning task.",coverage_identity_changed:"The cleaning task changed during setup. Check the robot status, then try again."},Bs=(a,t)=>{if(!a||typeof a!="object")return null;let e=a;if(e.translation_domain!=="matic_robot"||typeof e.translation_key!="string"||!Object.hasOwn(os,e.translation_key))return null;let s=e.translation_key,n=os[s];try{let r=t?.(`component.matic_robot.exceptions.${s}.message`);r&&r!==`component.matic_robot.exceptions.${s}.message`&&(n=r)}catch{}return new E(s,null,n)},E=class extends Error{constructor(t,e=null,s=null){super(s??t),this.name="BackendError",this.code=t,this.status=e,this.recoveryMessage=s}},is=(a,t)=>{let e=a.headers.get("X-Matic-Revision");if(e===null)return t;let s=Number(e);if(!Number.isSafeInteger(s)||s<0)throw new S("invalid-scene-revision");return s},as=(a,t)=>{let e=a.headers.get("X-Matic-Floor-Coherent");if(e===null)return t;if(e==="1")return!0;if(e==="0")return!1;throw new S("invalid-scene-floor-header")},He=class{#e;#t=new We;#n=new WeakMap;#r=new Set;#a=!1;constructor(t){this.#e=t}async#i(t,e,s=Number.POSITIVE_INFINITY,n="invalid-response-size"){let r=t.body?.getReader();if(!r)return new ArrayBuffer(0);let o=()=>{r.cancel().catch(()=>{})};e.addEventListener("abort",o,{once:!0});try{if(e.aborted)throw o(),new DOMException("Aborted","AbortError");let i=[],l=0;for(;;){let u=await r.read();if(e.aborted)throw new DOMException("Aborted","AbortError");if(u.done)break;if(l+u.value.byteLength>s)throw r.cancel().catch(()=>{}),new S(n);i.push(u.value),l+=u.value.byteLength}let d=new Uint8Array(l),c=0;for(let u of i)d.set(u,c),c+=u.byteLength;return d.buffer}finally{e.removeEventListener("abort",o),r.releaseLock()}}async#o(t,e,s,n,r){if(!qt(t))throw new E("invalid-private-path");if(n?.aborted)throw new DOMException("Aborted","AbortError");let o=new AbortController,i=()=>{},l=new Promise((h,f)=>{i=f}),d=()=>{o.abort(),i(new DOMException("Aborted","AbortError"))};n?.addEventListener("abort",d,{once:!0});let c=!1,u=window.setTimeout(()=>{c=!0,d()},s);try{let h=this.#e(),f=new Headers(e.headers),v={...e,cache:"no-store",credentials:"same-origin",headers:Object.fromEntries(f.entries()),signal:o.signal},_=async()=>{let y;if(typeof h?.fetchWithAuth=="function")y=await h.fetchWithAuth(t,v);else{let g=h?.auth?.accessToken||h?.auth?.data?.access_token;g&&f.set("Authorization",`Bearer ${g}`);let R=typeof h?.hassUrl=="function"?h.hassUrl(t):t;y=await fetch(R,{...v,headers:f})}try{if(o.signal.aborted)throw new DOMException("Aborted","AbortError");return await r(y,o.signal)}finally{y.body&&!y.body.locked&&y.body.cancel().catch(()=>{})}};return await Promise.race([_(),l])}catch(h){throw c&&!n?.aborted?new E("request-timeout"):o.signal.aborted?new DOMException("Aborted","AbortError"):h}finally{window.clearTimeout(u),n?.removeEventListener("abort",d)}}async#s(t,e,s,n={}){return this.#o(t,{...n,headers:{Accept:"application/json",...n.headers||{}}},e,s,async(r,o)=>{if(!r.ok){let i=r.headers.get("X-Matic-Plans-Conflict");throw new E(i==="map-rechecking"?"map-rechecking":"request-failed",r.status)}try{return JSON.parse(new TextDecoder().decode(await this.#i(r,o)))}catch{throw new S("invalid-json-response")}})}async catalog(t){return $e(await this.#s(It,D.catalog,t))}async scene(t,e,s,n,r,o){let i=new Headers({Accept:"application/vnd.matic.slam-scene"});return n==="live"&&i.set("X-Matic-Prefer-Cached","1"),o&&i.set("If-None-Match",o),this.#o(t,{headers:i},D.scene,r,async(l,d)=>{let c=is(l,e),u=as(l,s);if(l.status===304)return{scene:null,floorCoherent:u,revision:c,notModified:!0};if(!l.ok)throw new E("scene-request-failed",l.status);if(l.headers.get("Content-Type")?.split(";",1)[0]!=="application/vnd.matic.slam-scene")throw new S("invalid-scene-content-type");return{scene:{...await this.#t.parse(await this.#i(l,d,oe,"invalid-scene-size"),d),revision:c,etag:l.headers.get("ETag"),source:n},floorCoherent:u,revision:c,notModified:!1}})}async sceneDelta(t,e,s,n){let r=t.includes("?")?"&":"?";return this.#o(`${t}${r}since=${encodeURIComponent(e.revision)}`,{headers:{Accept:"application/vnd.matic.slam-delta, application/vnd.matic.slam-scene"}},D.delta,n,async(o,i)=>{let l=is(o,e.revision),d=as(o,s);if(o.status===204){if(l!==e.revision)throw new S("invalid-scene-delta-revision");return{scene:null,floorCoherent:d,revision:l,notModified:!0}}if(!o.ok)throw new E("delta-request-failed",o.status);if(l<=e.revision)throw new S("invalid-scene-delta-revision");let c=o.headers.get("Content-Type")?.split(";",1)[0];if(c!=="application/vnd.matic.slam-delta"&&c!=="application/vnd.matic.slam-scene")throw new S("invalid-scene-delta-content-type");let u=c==="application/vnd.matic.slam-delta",h=u?be+ie:oe,f=Number(o.headers.get("Content-Length"));if(Number.isFinite(f)&&f>h)throw new S(u?"invalid-scene-delta-size":"invalid-scene-size");let v=await this.#i(o,i,h,u?"invalid-scene-delta-size":"invalid-scene-size");if(u){let y=Number(o.headers.get("X-Matic-Base-Revision"));if(!Number.isSafeInteger(y)||y!==e.revision)throw new S("invalid-scene-delta-base");let g=await this.#t.decodeDelta(v,e,i);if(g.revision!==l)throw new S("invalid-scene-delta-revision");return{scene:{...g.parsed,revision:l,etag:o.headers.get("ETag"),source:"live",...g.deltaHint?{deltaHint:g.deltaHint}:{}},floorCoherent:d,revision:l,notModified:!1}}return{scene:{...await this.#t.parse(v,i),revision:l,etag:o.headers.get("ETag"),source:"live"},floorCoherent:d,revision:l,notModified:!1}})}async pose(t,e){return Ht(await this.#s(t,D.pose,e))}async history(t,e){return Lt(await this.#s(t,D.history,e))}async plans(t,e){return Wt(await this.#s(t,D.workflow,e))}async areas(t,e){return Ot(await this.#s(t,D.workflow,e))}async previewRoomSequence(t,e,s,n){if(!t||t.length>255||e.length<1||e.length>100)throw new S("invalid-room-sequence-preview-request");if(n?.aborted)throw new DOMException("Aborted","AbortError");let r=this.#e()?.connection;if(!r?.sendMessagePromise)throw new E("preview-unavailable");let o=null,i=()=>{},l=new Promise((g,R)=>{i=R}),d=this.#n.get(r),c,u=new Promise(g=>{c=g});this.#n.set(r,u);let h=!1,f=()=>{h||(h=!0,c(),this.#n.get(r)===u&&this.#n.delete(r))},v=!1,_=()=>{i(new DOMException("Aborted","AbortError")),v&&(f(),o!==null&&window.clearTimeout(o),o=null)};n?.addEventListener("abort",_,{once:!0});let y=new Promise((g,R)=>{o=window.setTimeout(()=>{o=null,R(new E("preview-timeout"))},D.roomPreview)});y.catch(()=>{v&&f()});try{if(d&&(await Promise.race([d,l,y]),n?.aborted))throw new DOMException("Aborted","AbortError");let g=ke.get(r)??0;if(g>=qs)throw new E("preview-unavailable");let R=r.sendMessagePromise({type:"call_service",domain:"matic_robot",service:"preview_room_sequence",target:{entity_id:t},service_data:{rooms:e.map(x=>({room:x.room,cleaning_mode:x.cleaning_mode,coverage_setting:x.coverage_setting})),use_room_schedule:!0,override_room_schedule:s},return_response:!0});ke.set(r,g+1),v=!0;let k=!1,m=()=>{if(!k){k=!0;let x=(ke.get(r)??1)-1;x===0?ke.delete(r):ke.set(r,x)}f(),o!==null&&window.clearTimeout(o),o=null};R.then(m,m);let C=await Promise.race([R,l,y]);if(n?.aborted)throw new DOMException("Aborted","AbortError");if(!C||typeof C!="object"||Array.isArray(C)||!("response"in C))throw new S("invalid-room-sequence-preview-envelope");return Dt(C.response)}finally{v||(d?d.then(f,f):f(),o!==null&&window.clearTimeout(o),o=null),n?.removeEventListener("abort",_)}}async saveArea(t,e,s){let n=await this.#s(t,D.mutation,s,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...e.areaId?{area_id:e.areaId}:{},name:e.name,circles:e.circles,...e.outline?.closed?{outline:e.outline.points}:{},cleaning_mode:e.cleaningMode,coverage_setting:e.coverageSetting})});if(!n||typeof n!="object"||typeof n.id!="string")throw new S("invalid-area-save-response");return n.id}async deleteArea(t,e,s){await this.#o(`${t}?area_id=${encodeURIComponent(e)}`,{method:"DELETE",headers:{Accept:"application/json"}},D.mutation,s,async n=>{if(!n.ok)throw new E("area-delete-failed",n.status)})}async service(t,e,s,n,r={}){let o=this.#e();if(this.#a||typeof o?.callService!="function")throw new E("service-unavailable");let i=null,l=null;try{let d=r.returnResponse?o.callService(t,e,s,{entity_id:n},!0,!0):o.callService(t,e,s,{entity_id:n});return!r.returnResponse&&!r.acknowledgementTimeout?await d:await Promise.race([d,new Promise((c,u)=>{l=()=>{i!==null&&window.clearTimeout(i),i=null,u(new DOMException("Aborted","AbortError"))},this.#r.add(l),i=window.setTimeout(()=>u(new E("mutation-timeout")),D.mutation)})])}catch(d){throw Bs(d,o.localize)??d}finally{i!==null&&window.clearTimeout(i),l&&this.#r.delete(l)}}dispose(){if(!this.#a){this.#a=!0;for(let t of this.#r)t();this.#r.clear(),this.#t.dispose()}}};var cs=()=>({version:4,view:"top",appearance:"photo",labels:!0,quality:"auto",cameras:{}}),Se=(a,t,e)=>Math.max(t,Math.min(e,a)),ds=a=>a.replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",lt=(a,t=4)=>`matic-map-studio:v${t}:${ds(a)}`,Ns=a=>{if(!a||typeof a!="object")return null;let t=a;return["yaw","pitch","zoom","targetX","targetZ"].every(s=>typeof t[s]=="number"&&Number.isFinite(t[s]))?{yaw:Se(t.yaw,-Math.PI,Math.PI),pitch:Se(t.pitch,.18,Math.PI/2-.018),zoom:Se(t.zoom,.01,100),targetX:Se(t.targetX,-1e4,1e4),targetZ:Se(t.targetZ,-1e4,1e4)}:null},ls=a=>{let t=cs();if(!a||typeof a!="object")return t;let e=a,s=e.view==="three"||e.view==="top"||e.view==="rooms"?e.view:t.view,n=s==="rooms"?"top":s,r=e.quality==="auto"||e.quality==="efficient"||e.quality==="balanced"||e.quality==="maximum"?e.quality:t.quality,o=e.cameras&&typeof e.cameras=="object"?e.cameras:{},i={};for(let l of["three","top"]){let d=Ns(o[l]);d&&(i[l]=d)}return{version:4,view:n,appearance:e.appearance==="rooms"||e.appearance==="photo"?e.appearance:t.appearance,labels:typeof e.labels=="boolean"?e.labels:t.labels,quality:r,cameras:i}},qe=class{#e="local-user";#t=null;#n=null;load(t){this.#r(),this.#e=ds(t);try{let e=window.localStorage.getItem(lt(this.#e));if(e)return ls(JSON.parse(e));for(let s of[3,2]){let n=window.localStorage.getItem(lt(this.#e,s));if(n)return ls(JSON.parse(n))}}catch{}return cs()}schedule(t){this.#t!==null&&window.clearTimeout(this.#t),this.#n={key:lt(this.#e),value:t},this.#t=window.setTimeout(()=>this.#r(),250)}#r(){this.#t!==null&&window.clearTimeout(this.#t),this.#t=null;let t=this.#n;if(this.#n=null,!!t)try{window.localStorage.setItem(t.key,JSON.stringify(t.value))}catch{}}dispose(){this.#r()}};var dt=1,le=Number.MAX_SAFE_INTEGER,fs=Number.MAX_SAFE_INTEGER,us=64,ct=4,hs=16*1024,Ks=250,Fs=4e3,Be=3e4;function $(a){return a!==null&&typeof a=="object"&&!Array.isArray(a)?a:null}function F(a,t){return typeof a=="number"&&Number.isSafeInteger(a)&&a>=0&&a<=t}function vs(a){let t=$(a);if(!t)return null;let e={};for(let[s,n]of Object.entries(t)){if(s.length===0||s.length>128||!F(n,fs))return null;e[s]=n}return e}function Us(a){let t=$(a);if(!t||Object.keys(t).length>128)return null;let e={};for(let[s,n]of Object.entries(t)){if(s.length===0||s.length>128||!F(n,fs))return null;e[s]=n}return e}function ys(a){return typeof a=="string"&&a.length>0&&a.length<=256?a:F(a,le)?String(a):null}function Vs(a){let t=$(a),e=ys(t?.epoch);if(!t||t.schema!==dt||e===null)return null;let s=Us(t.capabilities),n=vs(t.revisions);return!s||!n||!F(t.sequence,le)||!F(t.coherence_generation,le)||t.coherence_generation===0?null:{schema:t.schema,capabilities:s,epoch:e,sequence:t.sequence,coherence_generation:t.coherence_generation,revisions:n}}function ps(a,t){let e=$(a),s=Vs(e?.snapshot??a);if(!s)return null;let n=$(e?.snapshot??a);if(!n||!("payload"in n))return null;let r=n.entry_id,o=$(n.identity),i=$(n.status),l=$(n.payload),d=i?i.reason===null?null:gs(i.reason):null,c=l?.available,u=null;if(l?.entry!==void 0&&l.entry!==null){if((()=>{try{return JSON.stringify(l.entry).length}catch{return hs+1}})()>hs)return null;try{u=$e({entries:[l.entry]})[0]??null}catch{return null}}let h=i?.state;return typeof r!="string"||r.length===0||r.length>128||t!==void 0&&r!==t||!o||o.entry_id!==r||o.floor_mission_id!==null&&!F(o.floor_mission_id,le)||typeof o.floor_verified!="boolean"||o.floor_verified!==(o.floor_mission_id!==null)||!i||h!=="ready"&&h!=="stale"&&h!=="unavailable"||i.reason!==null&&d===null||typeof i.retryable!="boolean"||typeof c!="boolean"||u!==null&&u.entryId!==r||h==="ready"&&(d!==null||i.retryable||!c)||(h==="stale"||h==="unavailable")&&(d===null||c)||d==="authorization"&&i.retryable?null:{...s,entry_id:r,identity:{entry_id:r,floor_mission_id:o.floor_mission_id,floor_verified:o.floor_verified},status:{state:h,reason:d,retryable:i.retryable},payload:{available:c,entry:u}}}function ms(a){let t=$(a),e=ys(t?.epoch),s=vs(t?.revisions),n=t?.resources;return e===null||!s||!F(t?.sequence,le)||!F(t?.coherence_generation,le)||t.coherence_generation===0||!Array.isArray(n)||n.length>128||!n.every(r=>typeof r=="string"&&r.length<=128)?null:{epoch:e,sequence:t.sequence,coherence_generation:t.coherence_generation,revisions:s,resources:n}}var Ys=["gap","overflow","reconnect","invalid_message","server_request","restart","entry_removed","authorization","snapshot_required"];function gs(a){return typeof a=="string"&&Ys.includes(a)?a:null}var Ne=class{#e;#t;#n;#r=null;#a=!1;#i=!1;#o=!1;#s=!1;#p=!1;#m=!1;#d=0;#R=!1;#S=!1;#w=!1;#f=!1;#c=null;#y=null;#h=0;#L=!1;#v=null;#_=-1;#u=new Map;#x=!1;#D=!1;#I=null;#l=[];constructor(t,e){this.#e=t,this.#t=e,this.#n=Math.max(1,Math.min(us,e.maxPendingInvalidations??us))}async start(){if(!(this.#a||this.#D)){this.#D=!0;try{await this.#j(!1)}catch(t){this.#N(t),this.#b("reconnect")}}}notifyReconnect(){(this.#s||this.#m)&&(this.#d+=1),this.#h=0,this.#R=!1,this.#s=!1,this.#p=!1,this.#c!==null&&window.clearTimeout(this.#c),this.#c=null,this.requestResync("reconnect"),this.#o&&this.#A(0,!0)}requestResync(t="server_request"){this.#b(t,!0)}dispose(){this.#a||(this.#a=!0,this.#c!==null&&window.clearTimeout(this.#c),this.#c=null,this.#o=!1,this.#r?.(),this.#r=null,this.#u.clear(),this.#l=[])}#q(t){if(this.#a)return;let e=$(t),s=$(e?.event)??e,n=s?.type;if(n==="resync"){let o=gs(s?.reason);if(!o){this.#b("invalid_message");return}if(o==="entry_removed"){this.#t.onEvent({type:"resync",reason:o}),this.dispose();return}this.#b(o);return}if(this.#s){if(n==="invalidate"){let o=ms(s?.invalidation??s);o?this.#M(o):(this.#l=[],this.#L=!0)}return}let r=n==="snapshot"?ps(s?.snapshot??s,this.#t.entryId):n==="invalidate"?ms(s?.invalidation??s):null;if(!r){this.#b("invalid_message");return}if(n==="snapshot"){let o=r;if(this.#o)return;if(this.#v!==null&&o.epoch!==this.#v){this.#b("restart");return}this.#g(o);return}this.#E(r)}#g(t){this.#v===t.epoch&&t.sequence<this.#_||(this.#v=t.epoch,this.#_=t.sequence,this.#u.clear(),this.#t.onEvent({type:"snapshot",snapshot:t}))}#T(t){let e=this.#l;if(this.#l=[],this.#g(t),this.#a)return;let s=t.sequence+1;for(let n of e)if(n.epoch===t.epoch&&!(n.sequence<=t.sequence)&&!(n.sequence<s)){if(n.sequence!==s){this.#l=e.filter(r=>r.epoch===t.epoch&&r.sequence>=s),this.#b("gap");return}this.#E(n),s+=1}}#E(t){if(this.#o){this.#M(t);return}if(this.#v===null){this.#M(t);return}if(this.#v!==t.epoch){this.#M(t),this.#b("reconnect");return}if(!(t.sequence<=this.#_)){if(t.sequence!==this.#_+1){this.#M(t),this.#b("gap");return}this.#_=t.sequence;for(let e of t.resources)this.#u.set(e,t);if(this.#u.size>this.#n){this.#u.clear(),this.#b("overflow");return}this.#x||(this.#x=!0,queueMicrotask(()=>this.#O()))}}#M(t){this.#l.length>=this.#n?(this.#l=[],this.#L=!0,this.#b("overflow")):this.#l.push(t)}#O(){if(this.#x=!1,this.#a||this.#s||this.#u.size===0){this.#s&&this.#u.clear();return}let t=[...this.#u.values()];this.#u.clear();let e=t.reduce((n,r)=>!n||r.sequence>n.sequence?r:n,null);if(!e)return;let s=[...new Set(t.flatMap(n=>n.resources))];this.#t.onEvent({type:"invalidation",invalidation:{...e,resources:s}})}#b(t,e=!1){if(!this.#a){if(t==="authorization"){this.#z(),this.#t.onEvent({type:"resync",reason:t});return}if(!this.#s&&(this.#i||(this.#i=!0,this.#t.onEvent({type:"resync",reason:t}),queueMicrotask(()=>{this.#i=!1})),t!=="entry_removed")){let s=e&&!this.#R;if(s&&(this.#R=!0),s&&this.#c!==null&&(window.clearTimeout(this.#c),this.#c=null),this.#w){if(this.#f){s&&this.#A(0,!0);return}this.#f=!0,this.#B(s);return}if(e&&this.#o){s&&(this.#S=!0);return}let n=this.#h>=ct?Be:0;this.#A(s?0:n,s)}}}#A(t,e=!1){if(!this.#a){if(this.#c!==null){if(!e)return;window.clearTimeout(this.#c),this.#c=null}if(this.#o){this.#y=e?t:Math.max(this.#y??0,t);return}this.#c=window.setTimeout(()=>{this.#c=null,this.#j(!0)},t)}}#B(t=!1){let e=this.#h>=ct?Be:Math.min(Ks*2**this.#h,Fs);this.#h<ct&&(this.#h+=1),this.#A(t?0:e,t)}async#j(t,e=!1){if(this.#a||this.#o)return;let s=this.#d;this.#o=!0,this.#m=e;try{if(t&&await this.#Q(),this.#a||this.#s&&!e||s!==this.#d)return;let n=await this.#e.sendMessagePromise({type:"matic_robot/workspace_snapshot",version:dt,entry_id:this.#t.entryId});if(this.#a||this.#s&&!e||s!==this.#d)return;let r=ps(n,this.#t.entryId);if(!r)throw new Error("invalid-workspace-snapshot");if(r.status.reason==="authorization"){this.#z(),this.#t.onEvent({type:"snapshot",snapshot:r});return}if(r.status.state!=="ready"&&r.status.retryable)throw new Error("workspace-snapshot-retryable");e&&(this.#s=!1,this.#p=!1,this.#c!==null&&window.clearTimeout(this.#c),this.#c=null),this.#o=!1,this.#w=!0,this.#f=!1;try{t?this.#J(r):this.#T(r)}finally{this.#w=!1}this.#f?this.#S&&(this.#S=!1,this.#A(0,!0)):(this.#h=0,this.#R=!1,this.#S=!1),!t&&!this.#a&&await this.#Q(),this.#L&&(this.#L=!1,this.#b("overflow"))}catch(n){if(this.#a||this.#s&&!e||s!==this.#d)return;if(this.#N(n),this.#X(n))this.#z(),this.#t.onEvent({type:"resync",reason:"authorization"});else if(!e){let r=this.#S;this.#S=!1,this.#B(r)}}finally{this.#o=!1,this.#m=!1,this.#p?(this.#p=!1,this.#$(0)):e&&this.#s&&this.#$(Be);let n=this.#y;this.#y=null,n!==null&&this.#A(n)}}async#Q(){if(this.#a||this.#r)return;if(this.#I)return this.#I;let t=(async()=>{let e=await this.#e.subscribeMessage(s=>this.#q(s),{type:"matic_robot/workspace_subscribe",version:dt,entry_id:this.#t.entryId});this.#a?e():this.#r=e})();this.#I=t;try{await t}finally{this.#I===t&&(this.#I=null)}}#J(t){let e=this.#l;if(this.#l=[],this.#v===t.epoch&&t.sequence<this.#_){this.#l=e,this.#b("snapshot_required");return}if(this.#g(t),this.#a)return;let s=t.sequence+1;for(let n of e)if(n.epoch===t.epoch&&!(n.sequence<=t.sequence)&&!(n.sequence<s)){if(n.sequence!==s){this.#l=e.filter(r=>r.sequence>=s),this.#b("gap");return}this.#E(n),s+=1}}#X(t){let e=$(t),s=e?.code,n=e?.status??e?.statusCode;return s==="unauthorized"||s==="not_authorized"||s==="auth_invalid"||n===401||n===403}#z(){this.#d+=1,this.#s||(this.#s=!0,this.#c!==null&&window.clearTimeout(this.#c),this.#c=null,this.#p=!1),this.#u.clear(),this.#l=[],this.#L=!1,this.#y=null,this.#h=0,this.#R=!1,this.#S=!1,this.#m||this.#$(Be)}#$(t){this.#a||this.#c!==null||this.#p||(this.#c=window.setTimeout(()=>{if(this.#c=null,!this.#a){if(this.#o){this.#p=!0;return}this.#j(!0,!0)}},t))}#N(t){this.#t.onError?.(t instanceof Error?t:new Error("Workspace transport failed"))}};var Ke=class{#e;#t;#n=document.visibilityState!=="hidden";#r=!1;#a=!1;#i=!1;constructor({onSuspend:t,onResume:e}){this.#e=t,this.#t=e}get active(){return this.#n}start(){this.#r||this.#a||(this.#r=!0,window.addEventListener("pagehide",this.#o),window.addEventListener("pageshow",this.#s),document.addEventListener("visibilitychange",this.#p),document.visibilityState==="hidden"&&(this.#n?this.#d(!1):this.#e()))}dispose(){this.#a||(this.#a=!0,this.#r&&(window.removeEventListener("pagehide",this.#o),window.removeEventListener("pageshow",this.#s),document.removeEventListener("visibilitychange",this.#p)))}#o=()=>{this.#i=!0,this.#d(!1)};#s=t=>{if(this.#i=!1,t.persisted){document.visibilityState==="hidden"?this.#d(!1):(this.#d(!1),this.#d(!0));return}this.#m()};#p=()=>{this.#m()};#m(){if(this.#i||document.visibilityState==="hidden"){this.#d(!1);return}this.#d(!0)}#d(t){this.#n===t||this.#a||(this.#n=t,t?this.#t():this.#e())}};var js=!1,p=(a,t,e=null)=>({status:a,value:t,problem:e}),Re=a=>a.status==="loading"?p("idle",a.value):a,A=a=>a instanceof DOMException&&a.name==="AbortError",q=(a,t)=>a instanceof E||a&&typeof a=="object"&&"code"in a&&typeof a.code=="string"?a.code:t,Xs=a=>a instanceof E?a.recoveryMessage:null,de=a=>[a.selectedFloorOrdinal??"none",a.mapFloorOrdinal??"none",a.mapFloorCoherent?"coherent":"transition"].join(":"),ue=a=>[a.mapFloorOrdinal??"none",a.mapSessionVerified?"verified":"unverified",a.mapSessionKey??"no-session"].join(":"),W=a=>[a.entryId,a.selectedFloorOrdinal??"none",a.mapFloorOrdinal??"none"].join("|"),M=a=>[a.entryId,de(a),ue(a)].join("|"),ut=a=>[M(a),a.mapRevision].join("|"),Fe=a=>a.runnerLocked||a.stopSettlePending||a.activePlan||a.nativeReconciliationPending||a.nativeSessionActive===!0,Ue=(a,t)=>a.entryKey===t.entryKey&&a.generation===t.generation&&a.floorKey===t.floorKey&&a.missionKey===t.missionKey,ce="Live map updates paused while the current map is rechecked.",bs="Saved map from ",ht="Reconnecting. The last verified map remains read only.",Gs=1e3,Qs=5e3,Js=["rooms","plans","plan","draw","areaReview"],ws=["plan-mutation","area-mutation"],_s=a=>JSON.stringify({...a,previewToken:void 0}),Ve=(a,t)=>a.label?a.label:a.active?"Current floor":`Saved floor ${a.ordinal??t}`,Ye=class{#e;#t;#n;#r;#a=new qe;#i=null;#o=new Map;#s=null;#p=null;#m=null;#d=null;#R=0;#S=!1;#w=!1;#f=!1;#c=!1;#y=null;#h=Promise.resolve();#L=!1;#v=!1;#_="";#u=null;#x=0;#D=null;#I="";#l=!1;#q=!0;#g=null;#T=null;#E=null;#M=null;#O="";#b=!1;#A;#B;constructor(t,e,s=null,n=js){this.#e=t,this.#t=new St(t.value.generation),this.#n=e,this.#A=s,this.#B=n,this.#r=new Ke({onSuspend:()=>this.#j(),onResume:()=>{this.#Q()}}),this.#e.patch({pageActive:this.#r.active}),this.#M=t.subscribe(r=>{this.#J(r),this.#N()}),this.#r.start()}#j(){this.#K(!1,ws),this.#W(),this.#H(ws),this.#f=!1,this.#c=!1,this.#y=null,this.#v=!1,this.#be();let t=this.#e.value;this.#e.patch({resources:{...t.resources,catalog:Re(t.resources.catalog),scene:Re(t.resources.scene),history:Re(t.resources.history),plans:Re(t.resources.plans),areas:Re(t.resources.areas),pose:p("idle",null)}})}async#Q(){if(this.#l||!this.#r.active)return;this.#e.patch({pageActive:!0});let t=this.#s;if(this.#l||!this.#r.active||!t?.host.connected||!t.host.administrator||!t.host.robotConnected||t.host.robotCount===0)return;let e=this.#e.value;this.#ee(),this.#ce(t),await this.refreshCatalog(!0,!0);let s=this.#e.value,n=s.resources.entry;if(this.#l||!this.#r.active||e.dataMode!=="history"||s.generation!==e.generation||s.dataMode!=="history"||s.selection.entryId!==e.selection.entryId||s.selection.floorId!==e.selection.floorId||s.selection.historyId!==e.selection.historyId||s.resources.catalog.status!=="ready"||!n||n.entryId!==s.selection.entryId)return;let r=s.resources.history.value?.floors.find(u=>u.id===s.selection.floorId),o=r?.snapshots.find(u=>u.id===s.selection.historyId);if(!r)return;let i=this.#t.begin(n.entryId,r.id,o?.id??r.id,o?.revision??0);if(this.#e.patch({generation:i.generation}),await this.#ae(n,i),!this.#t.accepts(i)||!this.#r.active||this.#e.value.resources.history.status!=="ready")return;let l=this.#e.value,d=l.resources.history.value?.floors.find(u=>u.id===r.id),c=d?.snapshots.find(u=>u.id===o?.id);!d||o&&!c||(c&&c.revision!==i.revision&&(i=this.#t.begin(n.entryId,r.id,c.id,c.revision)),this.#e.patch({generation:i.generation,coherence:"current"}),c&&(!l.resources.scene.value||c.revision!==o?.revision)&&await this.#ve(c,i))}#J(t){if(!t.owner)return;let e={version:4,view:t.view,appearance:t.appearance,labels:t.labelsVisible,quality:t.quality,cameras:t.cameras},s=this.#i;this.#i=e,!(!s||s.view===e.view&&s.appearance===e.appearance&&s.labels===e.labels&&s.quality===e.quality&&s.cameras===e.cameras)&&this.#a.schedule(e)}#X(t){let e=_t(t),s=t.resources.entry,n=this.#s?.vacuumEntityId;if(!e||!s||!n||!t.selection.entryId||t.workflow!=="rooms"||t.dataMode!=="live"||t.floor.readOnly||t.coherence!=="current"||!t.host.connected||!t.host.administrator||!t.host.robotConnected||t.command!=="idle"||t.resources.plans.status!=="ready")return null;let r=t.selection.roomIds.map(o=>{let i=t.selection.roomSettings.find(l=>l.roomId===o);return i?{room:o,cleaning_mode:i.cleaningMode,coverage_setting:i.coverageSetting}:null});return r.some(o=>o===null)?null:{key:e,generation:t.generation,retryRevision:t.manualRoomPreviewRetry,floorKey:de(s),missionKey:ue(s),entryId:t.selection.entryId,entityId:n,rooms:r,overrideRoomSchedule:!t.selection.useRoomSchedule}}#z(t){return JSON.stringify([t.key,t.generation,t.retryRevision,t.floorKey,t.missionKey,t.entryId,t.entityId])}#$(t){let e=this.#X(this.#e.value);return!this.#l&&e!==null&&this.#z(e)===this.#z(t)}#N(){if(this.#l||!this.#s)return;let t=this.#e.value,e=this.#X(t);if(!e){this.#o.get("room-preview")?.abort(),this.#o.delete("room-preview"),this.#O="",(t.manualRoomPreview.status!=="idle"||t.manualRoomPreview.value!==null)&&this.#e.patch({manualRoomPreview:p("idle",null)});return}let s=this.#z(e),n=Je(t);if(n&&n.key===e.key&&n.generation===e.generation&&n.floorKey===e.floorKey&&n.missionKey===e.missionKey&&n.preview.entryId===e.entryId){this.#O=s;return}if(this.#O===s)return;this.#o.get("room-preview")?.abort(),this.#O=s;let r=this.#C("room-preview");this.#e.patch({manualRoomPreview:p("loading",null)}),this.#me(e,r)}async#me(t,e){try{let s=await this.#n.previewRoomSequence(t.entityId,t.rooms,t.overrideRoomSchedule,e.signal);return!this.#$(t)||e.signal.aborted||s.entryId!==t.entryId?null:(this.#e.patch({manualRoomPreview:p("ready",{key:t.key,generation:t.generation,floorKey:t.floorKey,missionKey:t.missionKey,preview:s})}),s)}catch(s){return A(s)||e.signal.aborted||!this.#$(t)||this.#e.patch({manualRoomPreview:p("error",null,q(s,"preview-unavailable"))}),null}finally{this.#P("room-preview",e)}}sync(t){if(this.#l)return;let e=this.#g,s=this.#s?.host.robotConnected??null,n=this.#s?.host.administrator===!1&&t.host.administrator,r=this.#s!==null&&!this.#s.host.robotConnected&&t.host.robotConnected,o=this.#e.value.owner,i=o!==null&&(o.entryKey!==t.entryKey||o.userKey!==t.userKey);i&&(this.#ie("context-changed",t.entryKey),this.#S&&(this.#f=!0,this.#c=!1,this.#y=null));let l=this.#q;this.#q=t.host.connected,this.#s=t,this.#ce(t),r&&e&&e===this.#g&&e.notifyReconnect();let d=t.userKey!==this.#I?this.#a.load(t.userKey):null;if(d&&(this.#I=t.userKey,this.#i=d),this.#e.patch({owner:{userKey:t.userKey,entryKey:t.entryKey},host:t.host,activity:t.activity,batteryPercent:t.batteryPercent,robotLabel:t.robotLabel,robots:t.robots,locale:t.language,selection:{...this.#e.value.selection,entryId:t.entryKey},...d?{view:d.view,appearance:d.appearance,labelsVisible:d.labels,quality:d.quality,cameras:d.cameras}:{}}),!t.host.administrator){this.#W(),this.#ie("access-required",t.entryKey);return}if(!t.host.connected){l&&(this.#e.patch({generation:this.#t.invalidate()}),this.#U(),this.#_=""),this.#W(),this.#f=!1,this.#c=!1,this.#y=null,this.#v=!1,this.#H();let c=this.#e.value,u=c.resources.scene.value;this.#e.patch({coherence:u?"degraded":"unavailable",resources:{...c.resources,catalog:c.resources.catalog.status==="loading"?p("idle",c.resources.catalog.value):c.resources.catalog,plans:c.resources.plans.status==="loading"?p("idle",c.resources.plans.value):c.resources.plans,areas:c.resources.areas.status==="loading"?p("idle",c.resources.areas.value):c.resources.areas,pose:p("idle",null)},map:{...c.map,available:u!==null,exactPose:!1},notice:u?{tone:"warning",text:ht}:c.notice});return}if(t.host.robotCount===0){this.#W(),this.#ie("map-unavailable",t.entryKey);return}if(t.entryKey&&!t.vacuumEntityId){this.#W(),this.#ie("no-loaded-robot",t.entryKey);return}if(!t.host.robotConnected){s!==!1&&(this.#K(),this.#H(),this.#f=!1,this.#c=!1,this.#y=null,this.#v=!1),this.#W();let c=this.#e.value,u=c.resources.scene.value;this.#e.patch({coherence:u?"degraded":"unavailable",resources:{...c.resources,catalog:c.resources.catalog.status==="loading"?p("idle",c.resources.catalog.value):c.resources.catalog,scene:c.resources.scene.status==="loading"?p("idle",u):c.resources.scene,pose:p("idle",null)},map:{...c.map,available:u!==null,exactPose:!1}});return}if(this.#r.active){if(this.#ee(),!l||r||n){this.#e.value.notice?.text===ht&&this.#e.patch({notice:null}),this.refreshCatalog(!0,!0);return}(i||this.#e.value.resources.catalog.status==="idle"||t.entryKey&&t.entryKey!==this.#e.value.selection.entryId)&&this.refreshCatalog(!0)}}#ce(t){let e=t.entryKey;if(!this.#B||!this.#A||!t.host.administrator||!t.host.connected||!t.vacuumEntityId||!e||!this.#r.active){this.#be();return}if(this.#g&&this.#T===e)return;this.#g?.dispose(),this.#E=null;let s=new Ne(this.#A,{entryId:e,onEvent:n=>{if(!(this.#l||!this.#r.active||this.#g!==s||this.#T!==e||this.#s?.entryKey!==e)){if(n.type==="resync"&&n.reason==="entry_removed"){s.dispose(),this.#g===s&&(this.#g=null,this.#T=null,this.#E=null);return}if(n.type==="snapshot"){let{snapshot:r}=n,o=this.#e.value.resources.entry,i=r.payload.entry;if(r.entry_id!==e||r.identity.entry_id!==e)return;if(i&&(i.entryId!==e||r.identity.floor_verified!==(i.mapFloorCoherent&&i.mapSessionVerified))){s.requestResync("invalid_message");return}let l=!i&&o?.entryId===e&&r.identity.floor_verified!==(o.mapFloorCoherent&&o.mapSessionVerified);if(r.status.reason==="authorization"){this.#E=null,this.#F(e,["plans","areas","history"]);return}let d=this.#E,c=[],u=d!==null&&d.epoch!==r.epoch;if(d&&d.epoch===r.epoch){let _=new Set([...Object.keys(d.revisions),...Object.keys(r.revisions)]),y=[..._].some(g=>(r.revisions[g]??-1)<(d.revisions[g]??-1));if(r.coherence_generation<d.coherenceGeneration||r.coherence_generation===d.coherenceGeneration&&y){s.requestResync("restart");return}c=[..._].filter(g=>(r.revisions[g]??-1)>(d.revisions[g]??-1))}u&&(c=["plans","areas","history"]);let h=d!==null&&(d.epoch!==r.epoch||d.coherenceGeneration!==r.coherence_generation),f=!!(o&&i&&o.entryId===e&&M(o)!==M(i));if(this.#E={entryId:r.entry_id,epoch:r.epoch,sequence:r.sequence,coherenceGeneration:r.coherence_generation,revisions:r.revisions},l){this.#F(e,["plans","areas","history"]);return}if(h||f){this.#F(e,c);return}let v=i!==null&&o?.entryId===e&&this.#ue(i);if(d&&c.length){if(r.sequence<=d.sequence){s.requestResync("invalid_message");return}this.#E=d,this.#de({epoch:r.epoch,sequence:r.sequence,coherence_generation:r.coherence_generation,revisions:r.revisions,resources:c},e,s,v)}return}if(n.type==="resync"){this.#E=null,n.reason!=="authorization"&&this.#F(e,["plans","areas","history"]);return}this.#de(n.invalidation,e,s)}},onError:()=>this.#e.patch({notice:{tone:"warning",text:ht}})});this.#g=s,this.#T=e,s.start()}#de(t,e,s,n=!1){let r=this.#E;if(!r||r.entryId!==e||this.#g!==s||t.epoch!==r.epoch||t.sequence<=r.sequence)return;let o=t.coherence_generation!==r.coherenceGeneration,l=[...new Set([...Object.keys(r.revisions),...Object.keys(t.revisions)])].some(f=>(t.revisions[f]??-1)<(r.revisions[f]??-1));if(t.coherence_generation<r.coherenceGeneration||!o&&l){s.requestResync("restart");return}let d=new Set(t.resources),c=[...d].some(f=>(t.revisions[f]??-1)>(r.revisions[f]??-1));if(this.#E={...r,sequence:t.sequence,coherenceGeneration:t.coherence_generation,revisions:t.revisions},!c&&!o)return;if(o){this.#F(e,t.resources);return}d.has("scene")&&d.delete("scene");let u=this.#e.value.resources.entry,h=this.#t.current();!u||u.entryId!==e||!h||d.size&&this.#V(u,h,d,!n)}#ue(t){let e=this.#e.value,s=e.resources.entry;if(!s||M(s)!==M(t))return!1;let n=t.mapRevision===s.mapRevision?t:{...t,mapRevision:s.mapRevision},r=e.resources.catalog,o=r.value?.map(u=>u.entryId===n.entryId?n:u),i=n.mapFloorCoherent&&n.mapSessionVerified,l=n.health==="problem"||n.health==="limited",d=this.#u,c=d?.key===M(n)&&this.#Z(d)&&(d.attempt!==null||d.retryTimer!==null);return this.#e.patch({managedLock:Fe(n),coherence:c?"verifying":i?l?"degraded":"current":"verifying",map:{...e.map,available:e.resources.scene.value!==null,complete:n.mapComplete&&!n.mapTruncated,floorCoherent:n.mapFloorCoherent,sessionVerified:n.mapSessionVerified,exactPose:i&&!c?e.map.exactPose:!1},floor:{...e.floor,classifiedCount:Math.max(1,n.historyFloorCount),...c&&e.resources.scene.value?{readOnly:!0}:{}},resources:{...e.resources,entry:n,...o?{catalog:{...r,value:o}}:{}}}),!0}#K(t=this.#e.value.pageActive,e=[]){let s=this.#t.invalidate();this.#U();let n=this.#e.value;this.#e.patch({generation:s,pageActive:t,coherence:n.resources.scene.value?"verifying":"unavailable",floor:{...n.floor,readOnly:n.floor.readOnly||n.resources.scene.value!==null},map:{...n.map,exactPose:!1}}),this.#u&&this.#te(this.#u.key),this.#H(["catalog",...e]),this.#_=""}#F(t,e=[]){this.#k(),this.#K(),this.refreshCatalog(!0,!0).then(()=>{if(this.#l||this.#s?.entryKey!==t||!this.#s.host.administrator||!this.#s.host.connected)return;let s=this.#e.value.resources.entry,n=this.#t.current();if(!s||s.entryId!==t||!n)return;let r=new Set(e);r.delete("history"),this.#V(s,n,r,!1)})}#U(){this.#x+=1,this.#D=null}#fe(t){let e=this.#D,s=this.#t.current();return!!(e&&s&&e.generation===this.#x&&e.stamp.generation===s.generation&&e.entryId===t.entryId&&e.coherenceIdentity===M(t)&&e.deltaUrl===t.deltaUrl&&s.entryKey===t.entryId&&s.floorKey===de(t)&&s.missionKey===ue(t)&&t.mapFloorCoherent&&t.mapSessionVerified&&this.#e.value.dataMode==="live"&&this.#e.value.selection.floorId==="current"&&this.#s?.host.connected&&this.#s.host.robotConnected&&this.#s.host.administrator)}#V(t,e,s,n=!0){(s.has("plans")||s.has("plan_state"))&&this.loadPlans(),s.has("areas")&&this.loadAreas(),s.has("history")&&this.#ae(t,e),n&&["status","robot_state","activity","plan_state"].some(r=>s.has(r))&&this.refreshCatalog(!0,!0,!0)}#ee(){this.#r.active&&(this.#p===null&&(this.#p=window.setInterval(()=>{this.refreshCatalog()},5e3)),this.#m===null&&(this.#m=window.setInterval(()=>{this.refreshPose()},Gs)))}#W(){this.#p!==null&&window.clearInterval(this.#p),this.#m!==null&&window.clearInterval(this.#m),this.#p=null,this.#m=null,this.#k()}#k(){let t=this.#u;if(this.#u=null,!t)return;t.attempt?.finishReplacementRead?.(),t.attempt&&(t.attempt.finishReplacementRead=null),t.retryTimer!==null&&window.clearTimeout(t.retryTimer);let e=t.attempt?.controller,s=!!(e&&e===this.#o.get("catalog")&&this.#e.value.resources.catalog.status==="loading");if(e?.abort(),s){let n=this.#e.value.resources;this.#e.patch({resources:{...n,catalog:p("idle",n.catalog.value)}})}this.#y?.state===t&&(this.#f=!1,this.#c=!1,this.#y=null)}#Y(t,e){let s=this.#u;s?.key===M(e)&&(s.failedKinds.delete(t),t==="delta"&&this.#G(e),s.failedKinds.size===0&&this.#k())}#G(t){this.#te(M(t))}#te(t){let e=this.#u;e?.key===t&&(e.attempt?.finishReplacementRead?.(),e.attempt&&(e.attempt.finishReplacementRead=null))}#se(t,e){let s=M(e),n=this.#u;n?.key!==s&&(this.#k(),n={key:s,failedKinds:new Set,retryTimer:null,attempt:null},this.#u=n),n.failedKinds.add(t),t==="delta"&&this.#G(e),this.#Z(n)&&this.#t.current()&&this.#K(),!n.attempt&&n.retryTimer===null&&(n.failedKinds.size===1&&n.failedKinds.has(t)?this.#re(n):this.#ne(n))}#Z(t){let e=this.#e.value;return t.failedKinds.has("pose")||e.floor.readOnly||!e.map.floorCoherent||!e.map.sessionVerified}#ne(t){t.retryTimer!==null||t.failedKinds.size===0||(t.retryTimer=window.setTimeout(()=>{t.retryTimer=null;let e=this.#e.value.resources.entry,s=this.#s?.host;if(this.#u!==t||this.#l||!e||M(e)!==t.key||this.#e.value.dataMode!=="live"||this.#e.value.selection.floorId!=="current"||!s?.connected||!s.administrator||!s.robotConnected||s.robotCount===0){this.#u===t&&this.#k();return}this.#re(t)},Qs))}async#re(t){if(this.#l||this.#u!==t||t.attempt)return;let e=this.#e.value.resources.entry,s=this.#s?.host;if(!e||M(e)!==t.key||this.#e.value.dataMode!=="live"||this.#e.value.selection.floorId!=="current"||!s?.connected||!s.administrator||!s.robotConnected||s.robotCount===0){this.#u===t&&this.#k();return}if(this.#o.has("scene")){this.#ne(t);return}let n=this.#Z(t);n?this.#t.current()&&this.#K():(this.#U(),this.#o.get("delta")?.abort());let r,o=new Promise(d=>{r=d}),i={generation:this.#t.generation,controller:null,replacementRead:o,finishReplacementRead:r};t.attempt=i;let l={state:t,attempt:i};try{await this.refreshCatalog(!0,!1,!n,l),t.failedKinds.has("delta")&&this.#u===t&&t.attempt===i&&await i.replacementRead}finally{if(this.#u!==t||t.attempt!==i)return;i.finishReplacementRead=null,t.attempt=null,t.failedKinds.size>0&&this.#ne(t)}}#oe(t){let e=this.#e.value,s=this.#s?.host;return!this.#l&&this.#r.active&&this.#u===t.state&&t.state.attempt===t.attempt&&t.attempt.generation===this.#t.generation&&e.generation===this.#t.generation&&e.dataMode==="live"&&e.selection.floorId==="current"&&e.resources.entry!==null&&M(e.resources.entry)===t.state.key&&!!(s?.connected&&s.administrator&&s.robotConnected&&s.robotCount>0)}#C(t){this.#o.get(t)?.abort();let e=new AbortController;return this.#o.set(t,e),e}#P(t,e){this.#o.get(t)===e&&this.#o.delete(t)}#H(t=[]){let e=!1;for(let[s,n]of this.#o)t.includes(s)||(e||=s==="plan-mutation"||s==="area-mutation"||s==="plan-preflight",n.abort(),this.#o.delete(s));e&&this.#e.value.command==="pending"&&this.#e.patch({command:"idle",notice:null})}#we(){this.#R+=1,this.#d!==null&&window.clearTimeout(this.#d),this.#d=null}#ie(t,e=null){this.#k(),this.#we(),this.#t.invalidate(),this.#U(),this.#_="";let s=this.#t.generation;this.#H();let n=this.#e.value,r=L();this.#e.patch({command:"idle",dataMode:r.dataMode,floor:r.floor,managedLock:!1,workflow:"none",dialog:null,notice:null,draftFloorOrdinal:null,draw:r.draw,planDraft:r.planDraft,areaDraft:r.areaDraft,generation:s,coherence:n.host.administrator?"unavailable":"blocked",fullMap:!1,precisionOpen:!1,resources:{catalog:p("error",null,t),entry:null,scene:p("idle",null),pose:p("idle",null),history:p("idle",null),plans:p("idle",null),areas:p("idle",null)},manualRoomPreview:p("idle",null),map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1},selection:{...r.selection,entryId:e,entrySource:n.selection.entrySource,floorId:"current",historyId:null}})}async refreshCatalog(t=!1,e=!1,s=!1,n=null){if(this.#l||!this.#r.active||!this.#s?.host.administrator||!this.#s.host.connected||this.#s.host.robotCount===0||n&&(!this.#s.host.robotConnected||!this.#oe(n)))return;if(this.#S)return t&&(this.#w?e&&(this.#f?this.#c&&=s:this.#c=s,this.#f=!0):(this.#f?this.#c&&=s:this.#c=s,this.#f=!0,this.#o.get("catalog")?.abort()),n&&(this.#f?this.#c&&=s:this.#c=s,this.#y=n,this.#f=!0)),this.#h;this.#S=!0,this.#w=t;let r;this.#h=new Promise(l=>{r=l});let o=this.#C("catalog");n&&(n.attempt.controller=o);let i=this.#e.value.resources.catalog.value;this.#e.patch({resources:{...this.#e.value.resources,catalog:p("loading",i)}});try{let l=await this.#n.catalog(o.signal);if(o.signal.aborted||this.#l||n&&!this.#oe(n))return;let d=this.#s?.entryKey,c=d?l.find(y=>y.entryId===d)??null:l[0]??null,u=this.#e.value.resources.entry;if(c&&this.#u?.key===M(c)&&(this.#u.attempt!==null||this.#u.retryTimer!==null)&&(!n||!this.#oe(n))){this.#e.patch({managedLock:Fe(c),resources:{...this.#e.value.resources,catalog:p(l.length?"ready":"empty",l),entry:u}});return}let h=!!(c&&u&&M(c)===M(u)&&this.#fe(u));if(c&&u&&W(c)===W(u)&&de(c)===de(u)&&ue(c)===ue(u)&&(h||c.mapRevision<u.mapRevision||!t&&this.#o.has("scene"))&&(c={...c,mapRevision:u.mapRevision}),this.#e.patch({managedLock:c?Fe(c):!1,resources:{...this.#e.value.resources,catalog:p(l.length?"ready":"empty",l),entry:c}}),!c){this.#ie("no-loaded-robot",this.#s?.entryKey??null);return}if(this.#e.value.selection.floorId!=="current"||this.#e.value.dataMode!=="live"){n&&this.#G(c);return}let f=ut(c),v=this.#t.current(),_=!!(v&&u&&M(c)===M(u)&&c.mapFloorCoherent&&c.mapSessionVerified);if((!t||s)&&(f===this.#_||_)){let y=this.#e.value,g=c.mapFloorCoherent&&c.mapSessionVerified,R=c.health==="problem"||c.health==="limited";this.#e.patch({coherence:g?R?"degraded":"current":"verifying",map:{...y.map,available:y.resources.scene.value!==null,complete:c.mapComplete&&!c.mapTruncated,floorCoherent:c.mapFloorCoherent,sessionVerified:c.mapSessionVerified,exactPose:g?y.map.exactPose:!1},floor:{...y.floor,classifiedCount:Math.max(1,c.historyFloorCount)}}),g&&this.#e.value.resources.plans.problem==="map-rechecking"&&this.loadPlans(),this.#ye();let k=v;if(k&&_&&(c.mapRevision>k.revision||n!==null)&&(c.mapRevision>k.revision&&(k=this.#t.advance(k,c.mapRevision)),k)){this.#_=f,this.#U();let m=this.#e.value.resources;this.#e.patch({resources:{...m,scene:p("loading",m.scene.value)}}),this.#he(c,k)}k&&!y.resources.scene.value&&!this.#o.has("history")&&this.#ae(c,k),g&&k&&(y.resources.scene.status==="error"||y.floor.readOnly)&&!this.#o.has("scene")&&this.#he(c,k);return}this.#_=f,this.#_e(c,u)}catch(l){if(A(l)||o.signal.aborted||this.#l)return;n&&this.#te(n.state.key),this.#e.patch({coherence:this.#e.value.resources.scene.value?"degraded":"unavailable",resources:{...this.#e.value.resources,catalog:p("error",i,q(l,"catalog-unavailable"))}})}finally{this.#P("catalog",o),n?.attempt.controller===o&&(n.attempt.controller=null),this.#S=!1;let l=this.#f,d=this.#c,c=this.#y;this.#w=!1;try{l&&!this.#l&&(this.#f=!1,this.#c=!1,this.#y=null,await this.refreshCatalog(!0,!1,d,c))}finally{r()}}}#_e(t,e){this.#u!==null&&this.#u.key!==M(t)&&this.#k();let s=this.#e.value,n=!!(e&&W(e)===W(t)),r=t.mapFloorCoherent&&t.mapSessionVerified,o=s.draftMapSessionKey??(e?.mapFloorCoherent&&e.mapSessionVerified?e.mapSessionKey:null),i=s.draftFloorOrdinal??(e?.mapFloorCoherent&&e.mapSessionVerified?e.mapFloorOrdinal:null),l=r?t.mapFloorOrdinal:null,d=r?t.mapSessionKey:null,c=e!==null&&e.entryId!==t.entryId||i!==null&&l!==null&&i!==l||o!==null&&d!==null&&o!==d,u=n&&r&&i===t.mapFloorOrdinal&&o===t.mapSessionKey,h=["catalog"];n&&!c&&h.push("plans","areas"),u&&h.push("plan-mutation","area-mutation");let f=this.#t.begin(t.entryId,de(t),ue(t),t.mapRevision);this.#u?.key===M(t)&&this.#u.attempt&&(this.#u.attempt.generation=f.generation),this.#U(),this.#H(h);let v=e?.entryId===t.entryId?s.resources.scene.value:null,_=v!==null&&(s.floor.readOnly||!n||!r||e?.mapSessionKey!==t.mapSessionKey),y=s.resources.pose.value,g=n&&r&&t.mapSessionKey!==null&&y?.position&&y.mapSessionKey===t.mapSessionKey?y:null;c&&this.#we();let R=L(),k=t.health==="problem"||t.health==="limited",m=this.#e.value;this.#e.patch({...c?{command:"idle",workflow:"none",dialog:null,precisionOpen:!1,fullMap:!1,draw:R.draw,planDraft:R.planDraft,areaDraft:R.areaDraft,notice:{tone:"info",text:"The active map changed. Choose a task on this map."}}:{},draftFloorOrdinal:l??i,draftMapSessionKey:d??o,managedLock:Fe(t),generation:f.generation,coherence:r?k?"degraded":_?"verifying":"current":"verifying",dataMode:"live",...!r&&v?{notice:{tone:"warning",text:ce}}:{},resources:{...m.resources,entry:t,scene:p(r?"loading":"idle",v),pose:p(r?"loading":"idle",g),history:p("loading",m.resources.history.value),plans:n&&!c?m.resources.plans:p("idle",null),areas:n&&!c?m.resources.areas:p("idle",null)},map:{available:v!==null,complete:t.mapComplete&&!t.mapTruncated,floorCoherent:t.mapFloorCoherent,sessionVerified:t.mapSessionVerified,exactPose:r&&g!==null&&!_},floor:{classifiedCount:Math.max(1,t.historyFloorCount),displayName:_?s.floor.displayName:t.selectedFloorOrdinal?`Floor ${t.selectedFloorOrdinal}`:"Current floor",readOnly:_},selection:{...m.selection,entryId:t.entryId,floorId:"current",historyId:null,roomIds:c?[]:m.selection.roomIds,roomSettings:c?[]:m.selection.roomSettings,planId:c?null:m.selection.planId,areaId:c?null:m.selection.areaId}}),this.#ae(t,f),r&&this.#e.value.resources.plans.status==="idle"&&this.loadPlans(),this.#ye(),r&&(this.#he(t,f),this.#pe(t,f))}async#he(t,e){if(!this.#r.active)return;let s=this.#C("scene");try{let n=await this.#n.scene(t.sceneUrl,t.mapRevision,t.mapFloorCoherent,"live",s.signal);if(!this.#t.accepts(e))return;if(!n.floorCoherent){let d=this.#e.value;this.#e.patch({coherence:"verifying",resources:{...d.resources,scene:p("error",d.resources.scene.value,"map-rechecking"),pose:p("idle",null)},map:{...d.map,available:d.resources.scene.value!==null,floorCoherent:!1,exactPose:!1},floor:{...d.floor,readOnly:d.resources.scene.value!==null},notice:{tone:"warning",text:ce}}),this.#G(t);return}if(n.revision<e.revision||!n.scene)throw new E("scene-unavailable");let r=n.revision===e.revision?e:this.#t.advance(e,n.revision);if(!r)throw new E("scene-unavailable");let o=this.#e.value,i={...o.resources.entry??t,mapRevision:n.revision};this.#_=ut(i),this.#e.patch({coherence:i.health==="problem"||i.health==="limited"?"degraded":"current",resources:{...o.resources,entry:i,scene:p("ready",n.scene)},map:{...o.map,available:!0},floor:{...o.floor,readOnly:!1,displayName:o.resources.history.value?.floors.find(d=>d.active)?.label||(i.selectedFloorOrdinal?`Floor ${i.selectedFloorOrdinal}`:"Current floor")},notice:o.notice?.text===ce||o.notice?.text.startsWith(bs)?null:o.notice});let l=this.#e.value.resources.plans;if((l.status==="idle"||l.problem==="map-rechecking")&&this.loadPlans(),this.#ye(),t.deltaUrl&&typeof DecompressionStream=="function"){let d=++this.#x;this.#ke(i,r,n.scene,d)}else this.#Y("delta",i)}catch(n){if(A(n)||!this.#t.accepts(e))return;if(n instanceof E&&n.code==="request-timeout"){let l=this.#e.value;this.#e.patch({resources:{...l.resources,scene:p("loading",l.resources.scene.value,"scene-building")}}),window.setTimeout(()=>{this.#l||!this.#t.accepts(e)||this.#e.value.selection.floorId!=="current"||this.#he(t,e)},250);return}this.#G(t);let r=this.#e.value,o=r.resources.pose.value,i=r.resources.scene.value!==null&&t.mapSessionKey!==null&&o?.position!==null&&o?.mapSessionKey===t.mapSessionKey;this.#e.patch({coherence:"degraded",resources:{...r.resources,scene:p("error",r.resources.scene.value,q(n,"scene-unavailable"))},map:{...r.map,available:r.resources.scene.value!==null,exactPose:i}})}finally{this.#P("scene",s)}}async#ke(t,e,s,n){if(!t.deltaUrl||typeof DecompressionStream!="function")return;let r=t.deltaUrl,o={generation:n,stamp:e,entryId:t.entryId,coherenceIdentity:M(t),deltaUrl:r};if(n!==this.#x||!this.#t.accepts(e))return;this.#D=o;let i=t,l=e,d=s;try{for(;!this.#l&&this.#r.active&&n===this.#x&&this.#t.accepts(l)&&this.#e.value.selection.floorId==="current";){let c=this.#C("delta");try{let u=await this.#n.sceneDelta(r,d,i.mapFloorCoherent,c.signal);if(c.signal.aborted||this.#l||n!==this.#x||!this.#t.accepts(l))return;if(!u.floorCoherent){let v=this.#e.value;this.#e.patch({coherence:"verifying",map:{...v.map,available:v.resources.scene.value!==null,floorCoherent:!1,exactPose:!1},floor:{...v.floor,readOnly:v.resources.scene.value!==null},resources:{...v.resources,scene:p("error",v.resources.scene.value,"map-rechecking"),pose:p("idle",null)},notice:{tone:"warning",text:ce}}),this.#se("delta",i);return}if(u.notModified||!u.scene){this.#Y("delta",i),await new Promise(v=>window.setTimeout(v,100));continue}let h=this.#t.advance(l,u.revision);if(!h)return;l=h,o.stamp=h,d=u.scene,i={...i,mapRevision:u.revision},this.#Y("delta",i),this.#_=ut(i);let f=this.#e.value;this.#e.patch({resources:{...f.resources,entry:i,scene:p("ready",d)},map:{...f.map,available:!0,floorCoherent:!0}}),this.#pe(i,l)}finally{this.#P("delta",c)}}}catch(c){if(A(c)||this.#l||n!==this.#x||!this.#t.accepts(l))return;this.#e.patch({notice:{tone:"warning",text:ce}}),this.#se("delta",i)}finally{this.#D===o&&(this.#D=null)}}async#ae(t,e){if(!this.#r.active)return;let s=this.#C("history");try{let n=await this.#n.history(t.historyUrl,s.signal),r=this.#t.current();if(s.signal.aborted||!r||!Ue(e,r)||n.entryId!==t.entryId)return;let o=this.#e.value,i=n.floors.find(c=>c.id===o.selection.floorId),l=!o.selection.historyId||i?.snapshots.some(c=>c.id===o.selection.historyId),d=o.dataMode==="live"?n.floors.find(c=>c.active):i;if(this.#e.patch({resources:{...this.#e.value.resources,history:p("ready",n)},floor:{...this.#e.value.floor,classifiedCount:n.floors.length,...d&&!(o.dataMode==="live"&&o.floor.readOnly)?{displayName:Ve(d,1)}:{}}}),o.dataMode==="live"&&!o.resources.scene.value){let c=n.floors.flatMap(u=>u.snapshots.map(h=>({floor:u,snapshot:h}))).sort((u,h)=>Date.parse(h.snapshot.createdAt)-Date.parse(u.snapshot.createdAt));for(let u of c){let h;try{h=await this.#n.scene(u.snapshot.sceneUrl,u.snapshot.revision,!0,"history",s.signal)}catch(_){if(A(_)||s.signal.aborted)return;continue}let f=this.#t.current();if(s.signal.aborted||!f||!Ue(e,f)||this.#e.value.resources.scene.value)return;if(!h.scene)continue;let v=this.#e.value;this.#e.patch({floor:{...v.floor,readOnly:!0,displayName:Ve(u.floor,1)},resources:{...v.resources,scene:p("ready",h.scene),pose:p("idle",null)},map:{...v.map,available:!0,exactPose:!1},notice:{tone:"warning",text:`${bs}${new Date(u.snapshot.createdAt).toLocaleString()}. Live position is unavailable.`}});break}}if(o.dataMode==="history"&&(!i||!l)){let c=i||n.floors.find(h=>h.active)||n.floors[0],u=this.selectFloor(c?.id||"current");!this.#l&&o.workflow==="history"&&this.#e.dispatch({type:"open-workflow",workflow:"history"}),await u}}catch(n){let r=this.#t.current();if(A(n)||s.signal.aborted||!r||!Ue(e,r))return;this.#e.patch({resources:{...this.#e.value.resources,history:p("error",null,q(n,"history-unavailable"))}})}finally{this.#P("history",s)}}async refreshPose(){let t=this.#e.value.resources.entry,e=this.#t.current();!t||!e||this.#e.value.selection.floorId!=="current"||!t.mapFloorCoherent||!t.mapSessionVerified||await this.#pe(t,e)}async#pe(t,e){if(this.#l||!this.#r.active||!this.#q||!this.#s?.host.connected)return;if(this.#L){this.#v=!0;return}this.#L=!0;let s=this.#C("pose");try{let n=await this.#n.pose(t.poseUrl,s.signal),r=this.#t.current(),o=this.#e.value.resources.entry;if(!r||!Ue(e,r)||!o||!this.#e.value.map.floorCoherent)return;if(!n.floorCoherent||n.mapSessionKey===null||n.mapSessionKey!==o.mapSessionKey){this.#e.patch({resources:{...this.#e.value.resources,pose:p("idle",null)},map:{...this.#e.value.map,exactPose:!1}}),this.#se("pose",o);return}this.#Y("pose",o);let i=this.#e.value,l=i.resources.pose.value,d=!!(i.map.exactPose&&l?.position&&l.mapSessionKey===o.mapSessionKey);if(n.position===null&&d){this.#e.patch({resources:{...i.resources,pose:p("ready",l)}});return}this.#e.patch({resources:{...i.resources,pose:p("ready",n)},map:{...i.map,exactPose:n.position!==null}})}catch(n){if(A(n)||!this.#t.accepts(e))return;let r=this.#e.value,o=r.resources.pose.value,i=!!(r.map.exactPose&&o?.position&&o.mapSessionKey===r.resources.entry?.mapSessionKey);this.#e.patch({resources:{...r.resources,pose:p("error",i?o:null,q(n,"pose-unavailable"))},map:{...r.map,exactPose:i}})}finally{if(this.#P("pose",s),this.#L=!1,this.#v&&!this.#l&&this.#q&&this.#s?.host.connected&&this.#s.host.administrator&&this.#s.host.robotCount>0){this.#v=!1;let n=this.#e.value.resources.entry,r=this.#t.current();n&&r&&this.#pe(n,r)}else this.#v=!1}}async selectFloor(t){let e=this.#e.value.resources.history.value,s=this.#e.value.resources.entry;if(!e||!s)return;let n=e.floors.find(l=>l.id===t);if(!n&&t!=="current")return;let r=this.#e.value;if(r.workflow==="draw"&&(r.draw.dirty||r.areaDraft.dirty)||r.workflow==="areaReview"&&(r.draw.dirty||r.areaDraft.dirty))return;if(!n||n.active){this.#k(),this.#_="";let l=this.#e.value;this.#e.patch({resources:{...l.resources,plans:p("idle",null),areas:p("idle",null),scene:p("idle",l.resources.scene.value),pose:p("idle",null)},map:{...l.map,available:l.resources.scene.value!==null,exactPose:!1},coherence:"verifying",floor:{...l.floor,readOnly:l.resources.scene.value!==null},notice:l.resources.scene.value?{tone:"warning",text:ce}:l.notice,workflow:"none",precisionOpen:!1}),this.#e.dispatch({type:"set-floor",floorId:"current"}),await this.refreshCatalog(!0);return}this.#k();let o=n.snapshots.at(-1),i=this.#t.begin(s.entryId,n.id,o?.id||n.id,o?.revision||0);this.#H(["catalog"]),this.#e.patch({generation:i.generation,coherence:"current",dataMode:"history",floor:{classifiedCount:e.floors.length,displayName:Ve(n,e.floors.indexOf(n)+1),readOnly:!0},selection:{...this.#e.value.selection,floorId:n.id,historyId:o?.id||null},resources:{...this.#e.value.resources,scene:p(o?"loading":"empty",null),pose:p("idle",null),plans:p("idle",null),areas:p("idle",null)},workflow:"none",precisionOpen:!1,map:{available:!1,complete:!0,floorCoherent:!0,sessionVerified:!0,exactPose:!1}}),o&&await this.#ve(o,i)}async selectHistory(t){let e=this.#e.value.resources.history.value,s=this.#e.value.resources.entry;if(!e||!s)return;if(!t){await this.selectFloor("current");return}let n=e.floors.find(i=>i.snapshots.some(l=>l.id===t)),r=n?.snapshots.find(i=>i.id===t);if(!n||!r)return;this.#k();let o=this.#t.begin(s.entryId,n.id,r.id,r.revision);this.#H(["catalog"]),this.#e.patch({generation:o.generation,dataMode:"history",floor:{classifiedCount:e.floors.length,displayName:Ve(n,e.floors.indexOf(n)+1),readOnly:!0},selection:{...this.#e.value.selection,floorId:n.id,historyId:r.id},resources:{...this.#e.value.resources,scene:p("loading",null),pose:p("idle",null)},map:{...this.#e.value.map,available:!1,exactPose:!1}}),await this.#ve(r,o)}async#ve(t,e){if(!this.#r.active)return;let s=this.#C("history-scene");try{let n=await this.#n.scene(t.sceneUrl,t.revision,!0,"history",s.signal);if(!this.#t.accepts(e)||!n.scene)return;this.#e.patch({resources:{...this.#e.value.resources,scene:p("ready",n.scene)},map:{...this.#e.value.map,available:!0,exactPose:!1}})}catch(n){if(A(n)||!this.#t.accepts(e))return;this.#e.patch({resources:{...this.#e.value.resources,scene:p("error",null,q(n,"history-scene-unavailable"))}})}finally{this.#P("history-scene",s)}}async openWorkflow(t){let e=this.#e.value;if((e.dataMode==="history"||e.floor.readOnly)&&Js.includes(t))return;let s=this.#e.value.workflow;if(t==="draw"&&s!=="draw"&&s!=="areaReview"&&this.selectArea(null),this.#e.dispatch({type:"open-workflow",workflow:t}),t==="history"){let n=this.#e.value.resources.entry,r=this.#t.current();n&&r&&(this.#e.patch({resources:{...this.#e.value.resources,history:p("loading",this.#e.value.resources.history.value)}}),await this.#ae(n,r))}(t==="plans"||t==="plan"||t==="rooms")&&await this.loadPlans(),(t==="draw"||t==="areaReview")&&await this.loadAreas()}async loadPlans({force:t=!1}={}){if(!this.#r.active){this.#o.get("plans")?.abort();let r=this.#e.value.resources;return this.#e.patch({resources:{...r,plans:p("idle",r.plans.value)}}),null}let e=this.#e.value.resources.entry;if(!e||!this.#t.current()||!et(this.#e.value)||!t&&this.#e.value.resources.plans.status==="loading")return null;let s=W(e),n=this.#C("plans");this.#e.patch({resources:{...this.#e.value.resources,plans:p("loading",null)}});try{let r=await this.#n.plans(e.plansUrl,n.signal),o=this.#e.value.resources.entry;if(n.signal.aborted||this.#l||!o||W(o)!==s)return null;let i=this.#e.value;if(i.planDraft.dirty||i.workflow==="plan"&&(!i.planDraft.id||i.command==="pending"))return this.#e.patch({resources:{...this.#e.value.resources,plans:p("ready",r)}}),r;let l=i.workflow==="plan"?i.selection.planId:r.selectedPlan||r.plans[0]?.id||null,d=r.plans.find(c=>c.id===l);return this.#e.patch({resources:{...this.#e.value.resources,plans:p("ready",r)},selection:{...this.#e.value.selection,planId:l},planDraft:d?Ze(d):{...this.#e.value.planDraft,id:null,name:"",rooms:[],dirty:!1}}),r}catch(r){let o=this.#e.value.resources.entry;if(A(r)||n.signal.aborted||this.#l||!o||W(o)!==s)return null;let i=r instanceof E&&r.code==="map-rechecking"?"map-rechecking":q(r,"plans-unavailable");return this.#e.patch({resources:{...this.#e.value.resources,plans:p("error",null,i)}}),null}finally{this.#P("plans",n)}}selectPlan(t,e=!1){let s=this.#e.value.resources.plans.value?.plans.find(n=>n.id===t);this.#e.patch({workflow:"plan",notice:!e&&this.#e.value.notice?.tone==="success"?null:this.#e.value.notice,selection:{...this.#e.value.selection,planId:t},planDraft:s?Ze(s):{...L().planDraft}})}#ye(){let t=this.#e.value;(t.workflow==="draw"||t.workflow==="areaReview")&&t.resources.areas.status==="idle"&&this.loadAreas()}async loadAreas({reconcileDraft:t=!0}={}){if(!this.#r.active){this.#o.get("areas")?.abort();let r=this.#e.value.resources;return this.#e.patch({resources:{...r,areas:p("idle",r.areas.value)}}),null}let e=this.#e.value.resources.entry;if(!e||!this.#t.current()||!et(this.#e.value))return null;let s=W(e),n=this.#C("areas");this.#e.patch({resources:{...this.#e.value.resources,areas:p("loading",null)}});try{let r=await this.#n.areas(e.areasUrl,n.signal),o=this.#e.value.resources.entry;if(n.signal.aborted||this.#l||!o||W(o)!==s)return null;if(r.sceneUrl!==o.sceneUrl)throw new E("areas-unavailable");this.#e.patch({resources:{...this.#e.value.resources,areas:p("ready",r)}});let i=this.#e.value.selection.areaId,l=this.#e.value,d=r.areas.some(c=>c.id===i);return t&&(!l.draw.dirty&&!l.areaDraft.dirty||i!==null&&!d)&&this.selectArea(d?i:null),r}catch(r){let o=this.#e.value.resources.entry;return A(r)||n.signal.aborted||this.#l||!o||W(o)!==s||this.#e.patch({resources:{...this.#e.value.resources,areas:p("error",null,q(r,"areas-unavailable"))}}),null}finally{this.#P("areas",n)}}selectArea(t){let e=this.#e.value.resources.areas.value?.areas.find(n=>n.id===t),s=this.#e.value;this.#e.patch({selection:{...s.selection,areaId:t},areaDraft:e?this.#Se(e):{id:null,name:"",cleaningMode:"vacuum",coverageSetting:"standard",status:"new",canRebind:!1,dirty:!1},draw:{...s.draw,circles:e?.circles||[],outline:e?.outline??null,outlineUndo:[],outlineRedo:[],tool:!e||e.outline?"outline":"paint",undo:[],redo:[],dirty:!1,strokeCount:0}})}#Se(t){return{id:t.id,name:t.name,cleaningMode:t.cleaningMode,coverageSetting:t.coverageSetting,status:t.status,canRebind:t.canRebind,dirty:!1}}async saveArea(){let t=this.#e.value,e=t.resources.entry,s=t.areaDraft;if(!e||t.command==="pending"||!fe(t)||!s.name.trim()||!t.draw.circles.length)return;let n=this.#C("area-mutation"),r=()=>!this.#l&&!n.signal.aborted;this.#e.patch({command:"pending",notice:{tone:"info",text:"Saving area\u2026"}});try{let o=await this.#n.saveArea(e.areasUrl,{areaId:s.id,name:s.name.trim(),circles:t.draw.circles,outline:t.draw.outline??null,cleaningMode:s.cleaningMode,coverageSetting:s.coverageSetting},n.signal);if(!r())return;let i=this.#e.value,d=i.areaDraft===s&&i.draw.circles===t.draw.circles&&i.draw.outline===t.draw.outline&&i.selection.entryId===t.selection.entryId&&(i.workflow==="draw"||i.workflow==="areaReview")?{...s,id:o,name:s.name.trim(),status:"current",canRebind:!1,dirty:!1}:null;this.#e.patch({command:"idle",notice:{tone:"success",text:"Area saved"},...d?{dialog:i.dialog==="discardDraft"?null:i.dialog,selection:{...i.selection,areaId:o},areaDraft:d,draw:{...i.draw,dirty:!1,strokeCount:0,undo:[],redo:[],outlineUndo:[],outlineRedo:[]}}:{}});let c=await this.loadAreas({reconcileDraft:!1}),u=this.#e.value;r()&&d&&u.areaDraft===d&&!u.draw.dirty&&(u.workflow==="draw"||u.workflow==="areaReview")&&u.selection.entryId===t.selection.entryId&&c&&u.resources.areas.value===c&&c.areas.some(h=>h.id===o)&&this.selectArea(o)}catch(o){if(A(o)||!r())return;this.#e.patch({command:"failed",notice:{tone:"error",text:"Area could not be saved"}})}finally{this.#P("area-mutation",n)}}async deleteArea(){let t=this.#e.value.resources.entry,e=this.#e.value.selection.areaId;if(!t||!e||this.#e.value.command==="pending"||!fe(this.#e.value))return;let s=this.#C("area-mutation"),n=()=>!this.#l&&!s.signal.aborted;this.#e.patch({command:"pending",notice:null});try{if(await this.#n.deleteArea(t.areasUrl,e,s.signal),!n())return;this.#e.patch({command:"idle",notice:{tone:"success",text:"Area deleted"}}),await this.loadAreas()}catch(r){!A(r)&&n()&&this.#e.patch({command:"failed",notice:{tone:"error",text:"Area could not be deleted"}})}finally{this.#P("area-mutation",s)}}async savePlan(){let t=this.#e.value,e=t.planDraft,s=t.resources.plans.value;if(!s||!e.name.trim()||!e.rooms.length||!fe(t))return;let n=e.rooms,r=e.id;if(await this.#ge("save_plan",{...e.id?{plan_id:e.id}:{},name:e.name.trim(),enabled:e.enabled,run_behavior:e.runBehavior,rooms:n.map(i=>({room:i.roomId,cleaning_mode:i.cleaningMode,coverage_setting:i.coverageSetting,...i.cadence?{cadence:{scope:i.cadence.scope,mop_every_n:i.cadence.mopEveryN,coverage_every_n:i.cadence.coverageEveryN,periodic_coverage_setting:i.cadence.periodicCoverageSetting,do_mop_next:i.cadence.doMopNext,do_coverage_next:i.cadence.doCoverageNext}}:{}})),return_to_base:e.returnToBase,finish_current_room:e.finishCurrentRoom,finish_current_room_threshold:e.finishCurrentRoomThreshold,select:!e.id||s.selectedPlan===e.id},"Plan saved","Plan save could not be confirmed. Check saved plans before trying again.",i=>{let l=i===void 0&&e.id?e.id:zt(i);if(e.id&&l!==e.id)throw new E("invalid-plan-save-response");r=l})){let i=this.#e.value.workflow==="plan"&&this.#e.value.planDraft===e?{...e,id:r,dirty:!1}:null;i&&this.#e.patch({planDraft:i,selection:{...this.#e.value.selection,planId:r}});let l=await this.loadPlans({force:!0});i&&this.#e.value.workflow==="plan"&&this.#e.value.planDraft===i&&this.#e.value.selection.entryId===t.selection.entryId&&l&&this.#e.value.resources.plans.value===l&&r&&l.plans.some(d=>d.id===r)&&this.selectPlan(r,!0)}}async deletePlan(){let t=this.#e.value.selection.planId,e=this.#e.value.selection.entryId;if(!t)return;if(await this.#ge("delete_plan",{plan:t},"Plan deleted","Plan could not be deleted")){let n=this.#e.value;n.selection.entryId===e&&n.planDraft.id===t&&(this.#e.patch({selection:{...n.selection,planId:null},planDraft:L().planDraft}),n.workflow==="plan"&&this.#e.patch({workflow:"plans",precisionOpen:!1})),await this.loadPlans({force:!0})}}async executeAction(t){switch(typeof t=="string"?t:t.id){case"recheck-status":{let s=this.#e.value.selection.entryId;await this.refreshCatalog(!0);let n=this.#e.value;!this.#l&&n.selection.entryId===s&&n.resources.catalog.status==="ready"&&n.host.connected&&n.host.robotConnected&&n.coherence==="current"&&n.command==="failed"&&this.#e.patch({command:"idle",notice:{tone:"info",text:"Status refreshed. Review the robot state before trying again."}});return}case"stop":await this.#le("matic_robot","stop_intelligent_cleaning",{include_unmanaged:!0});return;case"resume":await this.#le("vacuum","send_command",{command:"resume"});return;case"run-plan":{let s=this.#e.value,n=s.selection.planId||s.resources.plans.value?.selectedPlan;if(!n||s.workflow!=="plan"||!s.planDraft.enabled||s.resources.plans.status!=="ready"||s.command!=="idle"||!Ie(s))return;let r=s.selection.entryId,o=s.generation,i=s.selection.planId,l=s.planDraft,d=s.resources.plans.value?.plans.find(v=>v.id===n)?.nextRunPreview;if(!d||!/^[0-9a-f]{64}$/u.test(d.previewToken??"")){this.#e.patch({notice:{tone:"warning",text:"A verified next-run preview is unavailable. Refresh the saved plan before starting it."}});return}this.#e.patch({command:"pending",notice:null});let c=this.#C("plan-preflight");try{await this.loadPlans()}finally{this.#P("plan-preflight",c)}let u=this.#e.value,h=()=>{let v=this.#e.value;!this.#l&&v.selection.entryId===r&&v.generation===o&&v.command==="pending"&&this.#e.patch({command:"idle"})};if(c.signal.aborted||this.#l||u.selection.entryId!==r||u.generation!==o||u.workflow!=="plan"||u.selection.planId!==i||(u.selection.planId||u.resources.plans.value?.selectedPlan)!==n||u.planDraft!==l){h();return}if(u.resources.plans.status!=="ready"){h(),this.#e.patch({notice:{tone:"warning",text:"Plan preview could not be refreshed. Check the plan and try again."}});return}let f=u.resources.plans.value?.plans.find(v=>v.id===n)?.nextRunPreview;if(!f||f.blocker||!/^[0-9a-f]{64}$/u.test(f.previewToken??"")){h(),this.#e.patch({notice:{tone:"warning",text:"This plan has no valid next-run preview. Review its rooms and schedule."}});return}if(!d||JSON.stringify(d)!==JSON.stringify(f)){h(),this.#e.patch({notice:{tone:"info",text:"The next-run preview changed. Review the updated settings before starting."}});return}h(),await this.#le("matic_robot","run_selected_plan",{plan:n,preview_token:f.previewToken});return}case"clean-rooms":{await this.#Re();return}case"run-area":{let s=this.#e.value.selection.areaId;s&&await this.#le("matic_robot","clean_area",{area:s});return}case"review-area":this.#e.dispatch({type:"open-workflow",workflow:"areaReview"});return;case"save-area":await this.saveArea();return;case"save-plan":await this.savePlan();return;case"delete-plan":await this.deletePlan();return;case"delete-area":await this.deleteArea();return;case"reset-room-cadence":{if(typeof t=="string")return;let s=this.#e.value;if(s.selection.planId!==t.planId||s.planDraft.dirty||s.dataMode!=="live"||s.command!=="idle"||s.activity!=="idle"&&s.activity!=="docked"||!await this.#ge("reset_room_cadence",{plan:t.planId,room_id:t.roomId,modes:[t.mode]},t.mode==="mop"?"Mopping progress reset":"Coverage progress reset",t.mode==="mop"?"Mopping progress could not be reset":"Coverage progress could not be reset"))return;let r=await this.loadPlans({force:!0}),o=this.#e.value;!this.#l&&o.selection.entryId===s.selection.entryId&&o.selection.planId===t.planId&&!o.planDraft.dirty&&r&&o.resources.plans.value===r&&this.selectPlan(t.planId,!0);return}}}async#Re(){if(this.#b)return;let t=this.#e.value,e=this.#X(t),s=Je(t);if(!e||!s||s.key!==e.key||s.generation!==e.generation||s.floorKey!==e.floorKey||s.missionKey!==e.missionKey||s.preview.entryId!==e.entryId||s.preview.blocker||s.preview.rooms.length===0)return;this.#b=!0;let n=this.#C("room-preview");this.#O=this.#z(e),this.#e.patch({manualRoomPreview:p("loading",null),notice:null});try{let r=await this.#n.previewRoomSequence(e.entityId,e.rooms,e.overrideRoomSchedule,n.signal);if(n.signal.aborted||!this.#$(e)||r.entryId!==e.entryId)return;let o={key:e.key,generation:e.generation,floorKey:e.floorKey,missionKey:e.missionKey,preview:r};if(r.blocker||r.rooms.length===0){this.#e.patch({manualRoomPreview:p("ready",o),notice:{tone:"warning",text:"The room preview is blocked. Review the current map and schedule before starting."}});return}if(_s(s.preview)!==_s(r)){this.#e.patch({manualRoomPreview:p("ready",o),notice:{tone:"info",text:"The room preview changed. Review the updated settings before starting."}});return}if(this.#e.patch({manualRoomPreview:p("ready",o),notice:null}),!this.#$(e)||!Ie(this.#e.value))return;await this.#le("matic_robot","clean_room_sequence",{rooms:e.rooms,use_room_schedule:!0,override_room_schedule:e.overrideRoomSchedule,return_to_base:!0,preview_token:r.previewToken})}catch(r){!A(r)&&!n.signal.aborted&&this.#$(e)&&this.#e.patch({manualRoomPreview:p("error",null,q(r,"preview-unavailable")),notice:{tone:"warning",text:"The room preview could not be refreshed. No cleaning was started."}})}finally{this.#P("room-preview",n),this.#b=!1,this.#N()}}async#ge(t,e,s,n,r){let o=this.#s?.vacuumEntityId;if(!o||!fe(this.#e.value)||this.#e.value.command==="pending")return!1;let i=this.#C("plan-mutation"),l=this.#s?.entryKey,d=this.#s?.userKey,c=()=>!this.#l&&!i.signal.aborted&&l===this.#s?.entryKey&&d===this.#s?.userKey;this.#e.patch({command:"pending",notice:{tone:"info",text:"Saving\u2026"}});try{let u=await this.#n.service("matic_robot",t,e,o,{acknowledgementTimeout:"mutation",...r?{returnResponse:!0}:{}});return c()?(r?.(u),this.#e.patch({command:"idle",notice:{tone:"success",text:s}}),!0):!1}catch{return c()&&this.#e.patch({command:"failed",notice:{tone:"error",text:n}}),!1}finally{this.#P("plan-mutation",i)}}async#le(t,e,s){let n=this.#e.value,r=this.#s?.vacuumEntityId,o=e==="stop_intelligent_cleaning"||t==="vacuum"&&e==="return_to_base",i=t==="vacuum"&&e==="send_command"&&s.command==="resume";if(!r||n.selection.entryId!==this.#s?.entryKey||(o?!Et(n):i?!Rt(n):!Ie(n)))return;let l=++this.#R,d=this.#s?.entryKey,c=()=>!this.#l&&l===this.#R&&d===this.#s?.entryKey,u=o?"settling":"starting";this.#d!==null&&window.clearTimeout(this.#d),this.#d=null,this.#e.patch({command:u,notice:null});try{if(await this.#n.service(t,e,s,r),!c())return;if(t==="matic_robot"&&(e==="clean_room_sequence"||e==="run_selected_plan")){this.#e.patch({command:"idle"}),this.refreshCatalog(!0);return}this.#e.patch({command:u}),this.#d!==null&&window.clearTimeout(this.#d),this.#d=window.setTimeout(()=>{this.#d=null,c()&&this.#e.value.command===u&&this.#e.patch({command:"idle"})},15e3)}catch(h){if(!c())return;this.#e.patch({command:"failed",notice:{tone:"error",text:Xs(h)??"The action could not be confirmed. Check the robot status before trying again."}})}}dispose(){this.#l||(this.#l=!0,this.#r.dispose(),this.#K(!1),this.#M?.(),this.#M=null,this.#e.patch({manualRoomPreview:p("idle",null)}),this.#W(),this.#H(),this.#d!==null&&window.clearTimeout(this.#d),this.#d=null,this.#a.dispose(),this.#be(),this.#n.dispose())}#be(){this.#g?.dispose(),this.#g=null,this.#T=null,this.#E=null}};var ks=a=>(a.workflow==="none"?0:a.workflow==="plan"?2:1)+(a.fullMap?1:0)+(a.precisionOpen?1:0)+(a.dialog?1:0),Ss=a=>{if(!a||typeof a!="object")return null;let t=a.maticMapLayer;if(!t||typeof t!="object")return null;let e=t.owner,s=t.depth;return typeof e=="string"&&Number.isInteger(s)&&Number(s)>=0?{owner:e,depth:Number(s)}:null},je=class{#e;#t=`matic-map-${crypto.randomUUID?.()||Math.random().toString(36).slice(2)}`;#n=0;#r=null;#a=!1;#i=!1;constructor(t){this.#e=t}start(){this.#r||(this.#n=ks(this.#e.value),this.#r=this.#e.subscribe(t=>this.#o(t)),window.addEventListener("popstate",this.#s))}#o(t){let e=ks(t);if(this.#a){this.#a=!1,this.#n=e;return}if(e<this.#n){let s=Ss(history.state);if(s?.owner===this.#t&&s.depth===this.#n){let n=e-this.#n;this.#n=e,this.#i=!0,history.go(n);return}}if(e>this.#n)for(let s=this.#n+1;s<=e;s+=1){let n=history.state&&typeof history.state=="object"?history.state:{};history.pushState({...n,maticMapLayer:{owner:this.#t,depth:s}},"",window.location.href)}this.#n=e}#s=()=>{if(this.#i){this.#i=!1;return}if(!(this.#n<1)){if(ee(this.#e.value,{type:"dismiss-top-layer"})){let t=history.state&&typeof history.state=="object"?history.state:{};history.pushState({...t,maticMapLayer:{owner:this.#t,depth:this.#n}},"",window.location.href),this.#e.dispatch({type:"open-dialog",dialog:"discardDraft"});return}this.#a=!0,this.#e.dispatch({type:"dismiss-top-layer"})}};dismissTop(){if(this.#n<1)return!1;let t=Ss(history.state);return t?.owner===this.#t&&t.depth===this.#n?history.back():this.#e.dispatch({type:"dismiss-top-layer"}),!0}dispose(){this.#r?.(),this.#r=null,window.removeEventListener("popstate",this.#s),this.#n=0,this.#i=!1}};var Rs=[ne,re,Le,te`
    :host {
      display: block;
      min-inline-size: 0;
      min-block-size: 0;
      block-size: 100%;
      color: var(--ms-text);
      background: var(--ms-surface-app);
      font-family: var(--ms-font);
      container-type: size;
    }

    .root { position: relative; min-block-size: 0; block-size: 100%; }

    .sr-only, .skip-link:not(:focus) {
      position: absolute;
      overflow: hidden;
      inline-size: 1px;
      block-size: 1px;
      margin: -1px;
      padding: 0;
      border: 0;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .skip-link:focus {
      position: absolute;
      z-index: 40;
      inset-block-start: calc(var(--ms-space-2) + var(--ms-safe-top));
      inset-inline-start: var(--ms-space-2);
    }

    .app {
      display: grid;
      grid-template-rows: calc(3.5rem + var(--ms-safe-top)) minmax(0, 1fr);
      min-block-size: 36rem;
      block-size: 100%;
      background: var(--ms-surface-app);
    }
    .app[inert] { filter: none; }

    .app-bar {
      color: var(--ms-bar-text);
      --ms-local: var(--ms-surface-bar);
      position: relative;
      z-index: 12;
      display: flex;
      align-items: center;
      gap: var(--ms-space-2);
      min-inline-size: 0;
      padding-block-start: var(--ms-safe-top);
      padding-inline: max(var(--ms-space-3), var(--ms-safe-left)) max(var(--ms-space-3), var(--ms-safe-right));
      border-block-end: 1px solid var(--ms-line);
      background: var(--ms-local);
      box-shadow: var(--ms-shadow-1);
    }

    .app-bar > .ms-btn, .app-bar > .overflow-wrap > .ms-btn { color: var(--ms-bar-text); }
    .app-bar > .ms-btn:focus-visible, .app-bar > .overflow-wrap > .ms-btn:focus-visible { outline-color: var(--ms-bar-text); }

    .context-switcher { max-inline-size: 9rem; inline-size: auto; text-overflow: ellipsis; }
    .floor-switcher { appearance: none; block-size: 44px; padding-inline-end: 1.8rem; background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%); background-position: calc(100% - 15px) 50%, calc(100% - 10px) 50%; background-size: 5px 5px; background-repeat: no-repeat; }
    .floor-switcher:dir(rtl) { background-position: 10px 50%, 15px 50%; }


    .title {
      overflow: hidden;
      min-inline-size: 0;
      margin: 0;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: var(--ms-t-lg);
      font-weight: var(--ms-w-bold);
      letter-spacing: var(--ms-track-tight);
    }

    .spacer { flex: 1; }

    .overflow-wrap { position: relative; }
    .overflow-menu {
      position: absolute;
      z-index: 18;
      inset-block-start: calc(100% + var(--ms-space-1));
      inset-inline-end: 0;
      display: grid;
      gap: var(--ms-space-1);
      min-inline-size: 14rem;
      padding: var(--ms-space-1);
    }
    .overflow-menu .ms-row { justify-content: flex-start; }
    .overflow-field { padding: var(--ms-space-2) var(--ms-space-3) var(--ms-space-1); }

    .workspace {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(19rem, 22.5rem);
      min-inline-size: 0;
      min-block-size: 0;
    }

    .workspace.full-map { grid-template-columns: minmax(0, 1fr); }
    .workspace.full-map .inspector,
    .workspace.full-map .mobile-sheet,
    .workspace.full-map .sheet-scrim { display: none; }

    .canvas { position: relative; min-inline-size: 0; min-block-size: 0; }
    .map-canvas { block-size: 100%; }

    .precision-popover {
      position: absolute;
      z-index: 9;
      inset-inline-end: var(--ms-space-3);
      inset-block-end: 5.5rem;
      inline-size: 0;
      block-size: 0;
    }

    .inspector {
      --ms-local: var(--ms-surface-card);
      display: flex;
      flex-direction: column;
      min-inline-size: 0;
      min-block-size: 0;
      border-inline-start: 1px solid var(--ms-line);
      background: var(--ms-local);
    }

    .status-strip {
      display: grid;
      grid-template-columns: var(--ms-control-sm) minmax(0, 1fr) auto;
      gap: var(--ms-space-3);
      align-items: center;
      padding: var(--ms-space-3) var(--ms-space-4);
      border-block-end: 1px solid var(--ms-line);
    }

    .status-icon {
      display: grid;
      place-items: center;
      inline-size: var(--ms-control-sm);
      block-size: var(--ms-control-sm);
      border-radius: 50%;
      color: var(--ms-accent);
      background: color-mix(in srgb, var(--ms-accent) 11%, var(--ms-local));
    }

    .status-copy { min-inline-size: 0; }
    .status-strip strong, .status-strip small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .status-strip strong { font-size: var(--ms-t-sm); }
    .status-strip small { margin-block-start: 0.125rem; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); }
    .status-strip .action-reason { display: none; }

    .workflow {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-block-size: 0;
      padding: var(--ms-space-4);
      overflow: hidden;
    }
    .workflow-body { flex: 1; min-block-size: 0; overflow: auto; overscroll-behavior: contain; }
    .workflow > .action-bar { flex: none; }

    .panel-heading { display: flex; gap: var(--ms-space-2); align-items: center; min-inline-size: 0; }
    .panel-heading h2 { margin: 0; min-inline-size: 0; font-size: var(--ms-t-xl); letter-spacing: var(--ms-track-tight); }
    .panel-heading h2:focus { outline: none; }
    .panel-heading h2:focus-visible { outline: 2px solid var(--ms-accent); outline-offset: 4px; border-radius: var(--ms-radius-xs); }
    .panel-back { flex: none; }
    .panel-description { margin: var(--ms-space-1) 0 var(--ms-space-4); color: var(--ms-text-quiet); font-size: var(--ms-t-sm); line-height: var(--ms-lh-normal); }

    .quick-actions, .shelf { display: grid; gap: var(--ms-space-2); }
    .quick-actions .ms-row__body small { color: var(--ms-text-quiet); }
    /* The featured card is tinted with the accent, which drops the quiet
       text below AA (4.3:1 on the default light theme). Pull it towards
       the body text colour so it clears 4.5:1 on both schemes. */
    .quick-actions .ms-row--featured .ms-row__body small { color: color-mix(in srgb, var(--ms-text-quiet) 70%, var(--ms-text)); }
    .quick-actions .ms-row[aria-disabled="true"] .ms-row__lead { color: var(--ms-text-disabled); background: color-mix(in srgb, var(--ms-text) 6%, var(--ms-local)); }
    .quick-actions .ms-row[aria-disabled="true"] .ms-row__body strong { color: var(--ms-text-disabled); }
    .shelf-heading { margin: var(--ms-space-5) 0 var(--ms-space-2); color: var(--ms-text-quiet); font-size: var(--ms-t-sm); font-weight: var(--ms-w-bold); }
    .host-state { display: grid; gap: var(--ms-space-2); padding: var(--ms-space-4); border: 1px solid var(--ms-line); border-radius: var(--ms-radius-md); }
    .host-state h3 { margin: 0; font-size: var(--ms-t-md); }
    .host-state p { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-sm); line-height: var(--ms-lh-normal); }
    .host-state .ms-btn { justify-self: start; text-decoration: none; }
    .map-display { display: grid; gap: var(--ms-space-2); }
    .map-display .ms-segment { --ms-local: var(--ms-surface-sunken); border: 1px solid var(--ms-line); border-radius: var(--ms-radius-md); background: var(--ms-local); }
    .map-display .ms-segment .ms-btn { flex: 1; }
    .ms-checkbox { display: flex; gap: var(--ms-space-2); align-items: center; min-block-size: var(--ms-control); font-size: var(--ms-t-sm); }
    .ms-checkbox input { inline-size: 1.25rem; block-size: 1.25rem; margin: 0; accent-color: var(--ms-accent); }

    .action-bar { display: grid; gap: var(--ms-space-2); margin-block-start: auto; padding-block-start: var(--ms-space-4); }
    .action-summary { margin: 0; overflow: hidden; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); text-overflow: ellipsis; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .action-reason { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); text-align: center; }
    .ms-btn--primary[aria-disabled="true"] { --ms-local: var(--ms-surface-sunken); background: var(--ms-local); border-color: transparent; }

    .full-map-hud {
      --ms-local: var(--ms-surface-card);
      position: absolute;
      z-index: 9;
      inset-inline-end: var(--ms-space-3);
      inset-block-end: max(var(--ms-space-3), var(--ms-safe-bottom));
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--ms-space-3);
      align-items: center;
      inline-size: min(24rem, calc(100% - 1.5rem));
      padding: var(--ms-space-3);
      background: var(--ms-local);
    }
    .full-map-hud.has-secondary { grid-template-columns: minmax(0, 1fr) auto auto; }
    /* The map dock (the Draw tools, or the rooms selection chip -- one 44px
       row) sits bottom-centre; on a wide layout the HUD is bottom-right and
       the two collide below about 1400px. Lift the HUD clear of the dock. */
    .wide .full-map-hud.above-dock { inset-block-end: calc(var(--ms-space-3) + 3.5rem + var(--ms-space-2)); }
    .hud-copy { min-inline-size: 0; }
    .hud-copy strong, .hud-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hud-copy strong { font-size: var(--ms-t-sm); }
    .hud-copy small { color: var(--ms-text-quiet); font-size: var(--ms-t-xs); }
    .full-map-hud .ms-btn { inline-size: auto; min-inline-size: 5rem; }
    .full-map-hud .action-reason { position: absolute; overflow: hidden; inline-size: 1px; block-size: 1px; margin: -1px; clip-path: inset(50%); white-space: nowrap; }

    .sheet-scrim { display: none; }
    .sheet-grip, .sheet-tools, .sheet-status { display: none; }

    .dialog-backdrop {
      position: fixed;
      z-index: 30;
      inset: 0;
      display: grid;
      place-items: center;
      padding: max(var(--ms-space-4), var(--ms-safe-top)) max(var(--ms-space-4), var(--ms-safe-right)) max(var(--ms-space-4), var(--ms-safe-bottom)) max(var(--ms-space-4), var(--ms-safe-left));
      background: var(--ms-scrim);
    }

    .dialog {
      --ms-local: var(--ms-surface-card);
      inline-size: min(24rem, 100%);
      padding: var(--ms-space-5);
      color: var(--ms-text);
      background: var(--ms-local);
    }

    .dialog h2 { margin: 0; font-size: var(--ms-t-lg); }
    .dialog p { color: var(--ms-text-quiet); font-size: var(--ms-t-sm); line-height: var(--ms-lh-normal); }
    .dialog dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--ms-space-2) var(--ms-space-3); margin: var(--ms-space-3) 0 var(--ms-space-4); font-size: var(--ms-t-sm); }
    .dialog dt { font-weight: var(--ms-w-bold); }
    .dialog dd { margin: 0; color: var(--ms-text-quiet); }
    .dialog-actions { display: flex; justify-content: flex-end; gap: var(--ms-space-2); }

    /* Programmatic focus after a workflow change is for assistive tech; a ring on a heading reads as a control. */
    h2[tabindex="-1"]:focus { outline: 0; }
    .narrow .app { grid-template-rows: calc(3.35rem + var(--ms-safe-top)) minmax(0, 1fr); min-block-size: 28rem; }
    .narrow .workspace { grid-template-columns: minmax(0, 1fr); }
    .narrow .inspector { border-inline-start: 0; }
    .narrow .mobile-sheet {
      position: absolute;
      z-index: 7;
      inset-inline: 0;
      inset-block-end: 0;
      display: flex;
      flex-direction: column;
      block-size: auto;
      max-block-size: calc(100% - 2rem);
      padding: 0 max(var(--ms-space-3), var(--ms-safe-right)) max(var(--ms-space-3), var(--ms-safe-bottom)) max(var(--ms-space-3), var(--ms-safe-left));
      border-start-start-radius: var(--ms-radius-lg);
      border-start-end-radius: var(--ms-radius-lg);
      box-shadow: 0 -8px 26px rgb(0 0 0 / 14%);
      overflow: hidden;
      transition: block-size var(--ms-base) var(--ms-ease);
      will-change: transform;
    }
    .narrow .mobile-sheet[data-detent="half"] { block-size: min(48%, 26rem); }
    .narrow .mobile-sheet[data-detent="full"] { block-size: min(92%, calc(100% - 9rem)); }
    .narrow .mobile-sheet.dragging { transition: none; }
    .narrow .mobile-sheet[data-detent="peek"] .sheet-body { display: none; }

    .narrow .sheet-grip {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      gap: var(--ms-space-1);
      align-items: center;
      min-block-size: var(--ms-control);
      padding-block: var(--ms-space-3) var(--ms-space-1);
      touch-action: none;
      cursor: grab;
      user-select: none;
      -webkit-user-select: none;
    }
    .narrow .sheet-grip:has(.sheet-back) { grid-template-columns: auto minmax(0, 1fr) auto auto; }
    .narrow .sheet-grip:active { cursor: grabbing; }
    /* The step buttons are compact on the grip line but still touch targets:
       full control height (44px) on a phone, not the 36px --sm size. */
    .narrow .sheet-grip .ms-btn--sm { min-block-size: var(--ms-control); min-inline-size: var(--ms-control); }
    .narrow .sheet-handle {
      position: absolute;
      inset-block-start: var(--ms-space-1);
      inset-inline-start: 50%;
      inline-size: 2.5rem;
      block-size: 0.25rem;
      border-radius: var(--ms-radius-pill);
      background: var(--ms-line-strong);
      transform: translateX(-50%);
    }
    .narrow .sheet-status {
      display: block;
      overflow: hidden;
      min-inline-size: 0;
      font-size: var(--ms-t-md);
      font-weight: var(--ms-w-bold);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .narrow .sheet-tools { display: block; padding-block: var(--ms-space-1) var(--ms-space-2); }
    .narrow .draw-tools--grid {
      display: grid;
      grid-template-columns: repeat(12, minmax(0, 1fr));
      gap: var(--ms-space-1);
      padding: 0;
    }
    .narrow .draw-tools--grid .ms-btn {
      grid-column: span 4;
      flex-direction: column;
      gap: var(--ms-space-1);
      min-inline-size: 0;
      min-block-size: var(--ms-control);
      padding: var(--ms-space-1) var(--ms-space-2);
      border-color: var(--ms-line);
      font-size: var(--ms-t-xs);
      white-space: normal;
    }
    .narrow .draw-tools--grid .ms-btn[data-tool] { grid-column: span 3; padding-inline: 3px; }
    .narrow .draw-tools--grid[data-zone="true"] .ms-btn:not([data-tool]) { grid-column: span 6; }
    .narrow .draw-tools--grid .ms-btn__label {
      position: static;
      overflow: visible;
      inline-size: auto;
      block-size: auto;
      margin: 0;
      clip-path: none;
      white-space: nowrap;
    }
    .narrow .sheet-body { flex: 1; min-block-size: 0; padding-block: var(--ms-space-1); overflow: auto; overscroll-behavior: contain; }
    .narrow .mobile-sheet .action-bar { flex: none; margin-block-start: 0; padding-block-start: var(--ms-space-2); }
    .narrow .panel-back { inline-size: var(--ms-control); padding-inline: 0; }
    .narrow .panel-back .ms-btn__label {
      position: absolute;
      overflow: hidden;
      inline-size: 1px;
      block-size: 1px;
      margin: -1px;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .narrow .title { font-size: var(--ms-t-md); }
    .narrow .context-switcher { max-inline-size: 7rem; }
    .narrow .full-map-hud { inset-block-end: max(var(--ms-space-3), var(--ms-safe-bottom)); }
    .narrow .workspace.full-map .mobile-sheet { display: none; }
    .narrow .sheet-scrim {
      position: absolute;
      z-index: 3;
      inset: 0;
      inset-block-end: var(--map-sheet-offset, 0px);
      display: block;
      border: 0;
      background: color-mix(in srgb, #000 18%, transparent);
      cursor: pointer;
    }
    .narrow .sheet-scrim:focus-visible { outline: 3px solid var(--ms-accent); outline-offset: -3px; }
    .narrow .precision-popover { position: static; inline-size: auto; block-size: auto; }

    @media (forced-colors: active) {
      .dialog, .full-map-hud, .mobile-sheet, .host-state { border: 1px solid CanvasText; }
      .sheet-handle { background: CanvasText; }
    }

    @media (prefers-reduced-motion: reduce) {
      .narrow .mobile-sheet { transition: none; }
    }
  `];var pt=class extends se{constructor(){super(...arguments);this.state=L();this.compact=!1;this.inline=!1}static{this.properties={state:{attribute:!1},localize:{attribute:!1},compact:{type:Boolean,reflect:!0},inline:{type:Boolean,reflect:!0}}}static{this.styles=[ne,re,Le,te`
:host { display: block; color: var(--ms-text); }
.controls { display: grid; gap: var(--ms-space-3); padding: var(--ms-space-3); }
.stepper { display: grid; grid-template-columns: var(--ms-control) minmax(0, 1fr) var(--ms-control); gap: var(--ms-space-1); align-items: stretch; }
.number { --ms-local: var(--ms-surface-card); display: flex; align-items: center; min-inline-size: 0; min-block-size: var(--ms-control); padding-inline: var(--ms-space-2); border: 1px solid var(--ms-line-strong); border-radius: var(--ms-radius-sm); background: var(--ms-local); }
.number:focus-within { outline: 2px solid var(--ms-accent); outline-offset: 1px; border-color: var(--ms-accent); }
.number input { min-inline-size: 0; inline-size: 100%; border: 0; outline: 0; color: inherit; background: transparent; text-align: end; font-size: var(--ms-t-sm); font-variant-numeric: tabular-nums; }
.unit { margin-inline-start: var(--ms-space-1); color: var(--ms-text-quiet); font-size: var(--ms-t-xs); }
.slider { display: block; inline-size: 100%; min-block-size: var(--ms-control); margin: 0; accent-color: var(--ms-accent); }
.slider:focus-visible { outline: 2px solid var(--ms-accent); outline-offset: 2px; }
.hint { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
:host([compact]:not([inline])) .controls {
position: absolute;
z-index: 8;
inset-block-end: calc(100% + var(--ms-space-1));
inset-inline-end: 0;
inline-size: min(18rem, calc(100vw - 1.5rem));
}
:host([compact][inline]) { margin-block-start: var(--ms-space-2); }
`]}#e(e,s){return X(this.localize,e,s)}#t(e){this.dispatchEvent(new CustomEvent(_e,{detail:e,bubbles:!0,composed:!0}))}#n(e){let s=e.currentTarget.valueAsNumber;Number.isFinite(s)&&this.#t({type:"set-brush",value:s})}render(){let{draw:e}=this.state;return Te`
      <div class="controls ms-surface ms-surface--overlay" aria-label=${this.#e("v4_drawing_precision","Drawing precision")}>
        <div class="row ms-field">
          <label for="brush">${this.#e("brush_size","Brush width")}</label>
          <div class="stepper">
            <button
              class="ms-btn ms-btn--secondary ms-btn--icon"
              type="button"
              aria-label=${this.#e("v4_narrower_brush","Narrower brush")}
              @click=${()=>this.#t({type:"set-brush",value:e.brushMeters/1.25})}
            >&minus;</button>
            <span class="number">
              <input
                id="brush"
                inputmode="decimal"
                type="number"
                min=${.2}
                max=${2.5}
                step="0.01"
                .value=${e.brushMeters.toFixed(2)}
                @change=${this.#n}
                aria-label=${this.#e("v4_brush_width_meters","Brush width in meters")}
              />
              <span class="unit">m</span>
            </span>
            <button
              class="ms-btn ms-btn--secondary ms-btn--icon"
              type="button"
              aria-label=${this.#e("v4_wider_brush","Wider brush")}
              @click=${()=>this.#t({type:"set-brush",value:e.brushMeters*1.25})}
            >+</button>
          </div>
          <input
            class="slider"
            type="range"
            min=${.2}
            max=${2.5}
            step="0.01"
            .value=${e.brushMeters.toFixed(2)}
            @input=${this.#n}
            aria-label=${this.#e("v4_brush_width_slider","Brush width slider")}
            aria-valuetext=${`${e.brushMeters.toFixed(2)} m`}
          />
        </div>
        <p class="hint">${this.#e("v4_precision_hint","Strokes follow the verified map resolution. Zoom changes the view, not the saved outline.")}</p>
      </div>
    `}};customElements.get(ve)||customElements.define(ve,pt);var Es=ae(Ae),Xe=ae(ve),Cs=ae(ye),Ps=a=>a.dataMode==="history"||a.floor.readOnly,Zs=(a,t)=>{let e=(i,l,d)=>X(t,i,l,d);if(!a.host.connected)return{title:e("v4_reconnecting","Reconnecting"),detail:e("v4_ha_offline","Home Assistant is offline"),icon:K,notable:!0};if(!a.host.administrator)return{title:e("v4_access_required","Access required"),detail:e("v4_admin_only","Administrator only"),icon:K,notable:!0};if(a.host.robotCount===0)return{title:e("v4_no_robot_short","No robot"),detail:e("v4_set_up_robot","Set up a Matic robot"),icon:K,notable:!0};if(Pe(a))return{title:e("v4_selected_robot_unavailable","Selected robot unavailable"),detail:e("v4_choose_another_robot","Choose another robot to open its map."),icon:K,notable:!0};if(!a.host.robotConnected)return{title:e("v4_robot_offline","Robot offline"),detail:e("v4_last_map_read_only","Last verified map \xB7 read only"),icon:K,notable:!0};if(a.activity==="problem")return{title:e("v4_needs_attention","Needs attention"),detail:e("v4_check_robot","Check the robot"),icon:K,notable:!0};if(a.dataMode==="history"){let i=a.resources.history.value?.floors.find(c=>c.id===a.selection.floorId),l=i?.snapshots.findIndex(c=>c.id===a.selection.historyId)??-1,d=i?.snapshots.length??0;return{title:e("v4_saved_map","Saved map"),detail:l>=0?e("v4_read_only_position","Read only \xB7 {position} of {count}",{position:l+1,count:d}):e("v4_read_only","Read only"),icon:nt,notable:!1}}if(a.coherence==="verifying"||a.coherence==="booting")return{title:e("v4_locating","Locating"),detail:e("v4_finding_map","Finding the current map"),icon:we,notable:!0};if((a.resources.entry?.activePlan||a.resources.entry?.runnerLocked)&&(a.activity==="idle"||a.activity==="docked"))return{title:e("v4_task_in_progress","Task in progress"),detail:a.coherence==="unavailable"||a.coherence==="blocked"?e("v4_task_map_unavailable","The live map is unavailable; the current task remains in progress."):a.activity==="docked"?e("v4_task_docked","Robot docked; the cleaning task has not finished."):e("v4_task_waiting","Waiting for the cleaning task to continue or finish."),icon:rt,notable:!0};if(a.command==="starting"&&(a.activity==="idle"||a.activity==="docked"))return{title:e("v4_action_starting","Starting"),detail:e("v4_action_starting_detail","Waiting for the robot to begin"),icon:we,notable:!0};let s=a.coherence==="unavailable"||a.coherence==="blocked",n=e("v4_active_map_unavailable","The live map is unavailable; new cleaning is disabled."),r=i=>s?`${i} \xB7 ${n}`:i;if(a.activity==="cleaning")return{title:e("v4_cleaning","Cleaning"),detail:r(e("v4_cleaning_progress","Cleaning in progress")),icon:ot,notable:!0};if(a.activity==="recharging"){let i=a.batteryPercent===null?e("v4_recharging_detail","Will resume automatically when ready"):e("v4_recharging_battery","Charging to resume \xB7 {percent}% battery",{percent:a.batteryPercent});return{title:e("v4_recharging","Charging to resume"),detail:r(i),icon:jt,notable:!0}}if(a.activity==="paused")return{title:e("v4_paused","Paused"),detail:r(e("v4_can_resume","Cleaning can resume")),icon:it,notable:!0};if(a.activity==="returning")return{title:e("v4_returning","Returning"),detail:r(e("v4_going_dock","Going to the dock")),icon:ot,notable:!0};if(a.activity==="stopping")return{title:e("v4_stopping","Stopping"),detail:r(e("v4_waiting_robot","Waiting for the robot")),icon:it,notable:!0};if(s)return{title:e("v4_map_unavailable","Map unavailable"),detail:e("v4_map_unavailable_status","New cleaning is disabled until the live map is verified."),icon:K,notable:!0};let o=a.batteryPercent===null?e("v4_ready","Ready"):e("v4_battery","{percent}% battery",{percent:a.batteryPercent});return{title:a.activity==="docked"?e("v4_docked","Docked"):e("v4_ready","Ready"),detail:o,icon:we,notable:!1}},xs=(a,t)=>{let e=(s,n)=>X(t,s,n);switch(a.workflow){case"rooms":return{title:e("v4_choose_rooms","Choose rooms"),description:e("v4_choose_rooms_detail","Select on the map or from the list.")};case"draw":return{title:e("v4_draw_area","Draw an area"),description:e("v4_draw_area_detail","Outline or paint the area, then review it before saving.")};case"plans":return{title:e("v4_your_plans","Your plans"),description:e("v4_choose_plan_detail","Choose a plan to edit or run, or create a new one.")};case"plan":return{title:a.planDraft.id?e("v4_edit_plan","Edit plan"):e("v4_create_plan","Create a plan"),description:e("v4_plan_detail","Review rooms and cleaning settings.")};case"areaReview":return{title:e("v4_name_this_area","Name this area"),description:e("area_details_hint","Name the area and choose cleaning settings.")};case"history":return{title:e("v4_map_history","Map history"),description:e("v4_map_history_detail","Saved maps are floor-scoped and read only.")};case"support":return{title:e("v4_map_diagnostics","Map diagnostics"),description:e("v4_map_support_detail","Private geometry is never included.")};case"none":return Ps(a)?{title:e("v4_saved_map_read_only_title","Saved map is read only"),description:a.dataMode==="live"?e("v4_map_recovery_automatic","Cleaning controls return automatically when the live map is verified."):e("v4_saved_map_read_only_detail","Return to the live map to choose rooms, run a plan, or draw a custom area.")}:{title:e("v4_what_to_clean","What should the robot clean?"),description:e("v4_clean_detail","Choose rooms, a saved plan, or a custom area.")}}},U=["peek","half","full"],Ms={none:"half",rooms:"half",draw:"peek",plan:"full",plans:"full",areaReview:"half",history:"half",support:"full"},en=.5,tn=100,sn=6,nn=48,rn=["a[href]","button","input","label","select","textarea","summary",'[contenteditable]:not([contenteditable="false"])','[role="button"]','[role="link"]','[role="slider"]','[role="checkbox"]','[role="radio"]','[role="switch"]','[role="tab"]','[role="menuitem"]','[tabindex]:not([tabindex="-1"])'].join(","),on=["button:not(:disabled)","a[href]","input:not(:disabled)","select:not(:disabled)","textarea:not(:disabled)","[tabindex]:not([tabindex='-1'])"].join(", "),an=(a,t,e=!1,s="room",n=!1,r="mop")=>{let o=(i,l,d)=>X(t,i,l,d);switch(a){case"discardDraft":return{title:e?o("v4_discard_plan","Discard plan changes?"):o("v4_discard_area","Discard area changes?"),detail:e?o("v4_discard_plan_detail","Your plan changes have not been saved. Keep editing or discard them."):o("v4_discard_area_detail","Your area changes have not been saved. Keep editing or discard them."),cancelLabel:o("v4_keep_area_editing","Keep editing"),confirmLabel:o("v4_discard","Discard"),action:"discard"};case"confirmDeletePlan":return{title:o("v4_delete_plan","Delete this plan?"),detail:o("v4_delete_plan_detail","This removes the saved plan from Home Assistant. The robot will not move."),cancelLabel:o("v4_cancel","Cancel"),confirmLabel:o("plan_delete","Delete plan"),action:"delete-plan"};case"confirmDeleteArea":return{title:o("v4_delete_area","Delete this area?"),detail:o("v4_delete_area_detail","This removes the saved outline from Home Assistant. The robot will not move."),cancelLabel:o("v4_cancel","Cancel"),confirmLabel:o("area_delete","Delete area"),action:"delete-area"};case"confirmResetCadence":return{title:r==="mop"?o("v4_reset_mop_cadence_title","Reset mopping progress for {room}?",{room:s}):o("v4_reset_coverage_cadence_title","Reset coverage progress for {room}?",{room:s}),detail:n?r==="mop"?o("v4_reset_shared_mop_cadence_detail","This clears shared mopping progress for {room} across plans that use its shared schedule. Coverage progress and saved cleaning history stay unchanged.",{room:s}):o("v4_reset_shared_coverage_cadence_detail","This clears shared coverage progress for {room} across plans that use its shared schedule. Mopping progress and saved cleaning history stay unchanged.",{room:s}):r==="mop"?o("v4_reset_private_mop_cadence_detail","This clears mopping progress for {room} in this plan. Coverage progress and saved cleaning history stay unchanged.",{room:s}):o("v4_reset_private_coverage_cadence_detail","This clears coverage progress for {room} in this plan. Mopping progress and saved cleaning history stay unchanged.",{room:s}),cancelLabel:o("v4_cancel","Cancel"),confirmLabel:r==="mop"?o("v4_reset_mop_cadence_confirm","Reset mopping progress"):o("v4_reset_coverage_cadence_confirm","Reset coverage progress"),action:"reset-room-cadence"};case"confirmStop":return{title:o("v4_stop_cleaning","Stop cleaning?"),detail:o("v4_stop_cleaning_detail","The robot may take a moment to settle before another action is available."),cancelLabel:o("v4_keep_cleaning","Keep cleaning"),confirmLabel:o("v4_stop","Stop"),action:"stop"};case"error":return{title:o("v4_error","Something went wrong"),detail:o("v4_error_detail","No action was started. Close this message and try again when the map is ready."),cancelLabel:o("v4_close","Close"),confirmLabel:o("v4_close","Close"),action:null};case null:return null}},ln=(a=document)=>{let t=a.activeElement;for(;t?.shadowRoot?.activeElement;)t=t.shadowRoot.activeElement;return t},mt=a=>!!(a&&a.isConnected&&a.offsetParent!==null),ft=class extends se{constructor(){super();this.state=L();this._measuredNarrow=!1;this._sheetOffset=0;this._overflowOpen=!1;this._helpOpen=!1;this._browserFullscreen=!1;this._sheetDetent="half";this._announcement="";this._workflowLoadFailed=!1;this.#t=null;this.#n=null;this.#r=null;this.#a=null;this.#i=null;this.#o=null;this.#s=null;this.#p=null;this.#m=null;this.#d=null;this.#S=()=>{this._browserFullscreen=this.#w()};this.#f=e=>{if(!this._overflowOpen)return;let s=this.renderRoot.querySelector(".overflow-wrap");(!s||!e.composedPath().includes(s))&&(this._overflowOpen=!1)};this.#ne=()=>{this._workflowLoadFailed=!1,this.#Z()};new Qt(this,{container:()=>this.renderRoot?.querySelector(".draw-tools")??null,items:"button"})}static{this.properties={state:{attribute:!1},localize:{attribute:!1},_measuredNarrow:{state:!0},_sheetOffset:{state:!0},_overflowOpen:{state:!0},_helpOpen:{state:!0},_browserFullscreen:{state:!0},_sheetDetent:{state:!0},_announcement:{state:!0},_workflowLoadFailed:{state:!0}}}static{this.styles=Rs}#e(e,s,n){return X(this.localize,e,s,n)}#t;#n;#r;#a;#i;#o;#s;#p;#m;#d;#R(){let e=this.renderRoot;return e instanceof ShadowRoot?e.fullscreenElement??document.fullscreenElement:document.fullscreenElement}#S;#w(){let e=this.renderRoot,s=e.querySelector(".app"),n=e instanceof ShadowRoot?e.fullscreenElement:null;if(n)return n===s;let r=document.fullscreenElement;for(let o=this;o;){if(o===r)return!0;let i=o.getRootNode();o=i instanceof ShadowRoot?i.host:null}return!1}#f;connectedCallback(){super.connectedCallback(),this.#t=new ResizeObserver(([e])=>{if(!e)return;let s=e.contentRect.width<1024||e.contentRect.height<480;s!==this._measuredNarrow&&(this._measuredNarrow=s)}),this.#t.observe(this),window.addEventListener("pointerdown",this.#f,!0),document.addEventListener("fullscreenchange",this.#S),this.#n=new ResizeObserver(([e])=>{if(!e)return;let s=Math.ceil(e.target.getBoundingClientRect().height);s!==this._sheetOffset&&(this._sheetOffset=s)})}disconnectedCallback(){this.#t?.disconnect(),this.#t=null,this.#n?.disconnect(),this.#n=null,this.#r=null,window.removeEventListener("pointerdown",this.#f,!0),document.removeEventListener("fullscreenchange",this.#S),super.disconnectedCallback()}updated(e){let s=e,n=this.renderRoot.querySelector(".mobile-sheet");if(n!==this.#r&&(this.#n?.disconnect(),this.#r=n,n?this.#n?.observe(n):this._sheetOffset!==0&&(this._sheetOffset=0)),s.has("_overflowOpen")&&this._overflowOpen&&this.updateComplete.then(()=>{this.renderRoot.querySelector("#map-options select, #map-options button")?.focus()}),s.has("_helpOpen")){if(this._helpOpen)this.updateComplete.then(()=>{this.renderRoot.querySelector(".help-dialog [data-dialog-initial-focus]")?.focus()});else if(s.get("_helpOpen")){let r=this.#o;this.#o=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>r?.focus({preventScroll:!0}))})}}if(e.has("state")){let r=e.get("state");if(r?.precisionOpen&&!this.state.precisionOpen&&this.#y()?.focus(),r?.fullMap&&!this.state.fullMap){let o=this.#i;this.#i=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>{(this.renderRoot.querySelector(".workspace-toggle")??this.renderRoot.querySelector(".nav--menu")??(o?.isConnected?o:null))?.focus({preventScroll:!0})})})}if(r&&!r.fullMap&&this.state.fullMap&&this.updateComplete.then(()=>{let o=this.#i;requestAnimationFrame(()=>{(this.renderRoot.querySelector(".workspace-toggle")??(o?.isConnected?o:null))?.focus({preventScroll:!0})})}),!r?.dialog&&this.state.dialog){let o=ln(this.shadowRoot||document);o?.hasAttribute("data-dialog-launcher")&&(this.#a=o),this.updateComplete.then(()=>{(this.renderRoot.querySelector(".dialog [data-dialog-initial-focus]")??this.renderRoot.querySelector(".dialog button"))?.focus()})}else if(r?.dialog&&!this.state.dialog){r.dialog==="discardDraft"&&(this.#s=null,this.#x());let o=this.#a?.isConnected&&this.#a.hasAttribute("data-dialog-launcher")?this.#a:this.#ue(r.dialog);this.#a=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>o?.focus({preventScroll:!0}))})}r?r.workflow!==this.state.workflow&&(this._sheetDetent=Ms[this.state.workflow],this.updateComplete.then(()=>this.#c())):this._sheetDetent=Ms[this.state.workflow]}}#c(){let e=this.renderRoot.querySelector(".panel-heading h2");if(mt(e)){e.focus({preventScroll:!0});return}let s=this.renderRoot.querySelector(".action-bar .ms-btn--primary");mt(s)&&s.focus({preventScroll:!0})}#y(){let e=this.renderRoot.querySelector(".draw-brush");return mt(e)?e:this.renderRoot.querySelector(Ae)?.shadowRoot?.querySelector(".draw-brush")??null}#h(e){if(ee(this.state,e)){this.#s=e,this.#h({type:"open-dialog",dialog:"discardDraft"});return}this.dispatchEvent(new CustomEvent(_e,{detail:e,bubbles:!0,composed:!0}))}#L(e){if(e.enabled){if(e.id==="return-live"){this.#h({type:"set-history",historyId:null});return}if(e.id==="clear-draft"){this.#h({type:"clear-draft"});return}this.#I(e.id)}}#v(e,s){let n={type:"open-workflow",workflow:e};s instanceof HTMLElement&&ee(this.state,n)&&(this.#a=s),this.#h(n)}#_(){let e=this.#s;this.#s=null,e?.type==="select-plan"||e?.type==="select-area"?(this.#h({type:"patch-plan-draft",patch:{dirty:!1}}),this.#h({type:"patch-area-draft",patch:{dirty:!1}}),this.#h({type:"dismiss-top-layer"})):this.#h({type:"discard-draft"}),e&&e.type!=="dismiss-top-layer"&&queueMicrotask(()=>this.dispatchEvent(new CustomEvent(_e,{detail:e,bubbles:!0,composed:!0})))}#u(){this.#s=null,this.#D(),this.#x()}#x(){this.updateComplete.then(()=>{let e=this.renderRoot.querySelector(".floor-switcher");e&&(e.value=this.state.selection.floorId);let s=this.renderRoot.querySelector(".robot-switcher");s&&(s.value=this.state.selection.entryId??"")})}#D(){let e=this.state.dialog,s=e&&this.#a?.isConnected&&this.#a.hasAttribute("data-dialog-launcher")?this.#a:e?this.#ue(e):null;this.#h({type:"dismiss-top-layer"}),s&&requestAnimationFrame(()=>s.focus({preventScroll:!0}))}#I(e){this.dispatchEvent(new CustomEvent(Jt,{detail:typeof e=="string"?{id:e}:e,bubbles:!0,composed:!0}))}#l(e){this.#h({type:"dismiss-top-layer"}),this.#I(e)}#q(e){if(e.action==="discard"){this.#_();return}if(e.action==="delete-plan"||e.action==="delete-area"){this.#l(e.action);return}if(e.action==="reset-room-cadence"){let s=this.state.cadenceResetRequest;this.#h({type:"dismiss-top-layer"}),s&&this.#I({id:"reset-room-cadence",planId:s.planId,roomId:s.roomId,mode:s.mode});return}this.#h({type:"dismiss-top-layer"}),e.action==="stop"&&this.#I("stop")}#g(e){e!==this._sheetDetent&&(this._sheetDetent=e,this._announcement=this.#e("v4_workspace_height","Map workspace, {height} height",{height:e}))}#T(e,s=!1){let r=U.indexOf(this._sheetDetent)+e;s&&r>=U.length&&(r=0),r=Math.max(0,Math.min(U.length-1,r)),this.#g(U[r]??this._sheetDetent)}#E(e){let s=this.renderRoot.querySelector(".workspace")?.clientHeight??e.parentElement?.clientHeight??e.offsetHeight,n=parseFloat(getComputedStyle(this).fontSize)||16,r=[".sheet-grip",".sheet-tools",".action-bar"].map(l=>e.querySelector(l)?.offsetHeight??0).reduce((l,d)=>l+d,0)+n*.75,o=Math.min(s*.92,s-n*9),i=Math.min(s*.48,n*26,o);return{peek:Math.min(r,i),half:i,full:o}}#M(){return this.renderRoot.querySelector(".mobile-sheet")}#O(e){let s=e.currentTarget;for(let n of e.composedPath()){if(n===s)return!1;if(n instanceof Element&&n.matches(rn))return!0}return!1}#b(e){if(e.pointerType==="mouse"&&e.button!==0||this.#O(e))return;let s=this.#M();!s||this.#m||(this.#m={pointerId:e.pointerId,startY:e.clientY,startHeight:s.offsetHeight,heights:this.#E(s),samples:[{y:e.clientY,t:e.timeStamp}],moved:!1},e.currentTarget.setPointerCapture(e.pointerId),s.classList.add("dragging"))}#A(e){let s=this.#m;if(!s||e.pointerId!==s.pointerId)return;let n=this.#M();if(!n)return;let r=e.clientY-s.startY;for(!s.moved&&Math.abs(r)>sn&&(s.moved=!0),s.samples.push({y:e.clientY,t:e.timeStamp});s.samples.length>2&&e.timeStamp-(s.samples[1]?.t??0)>tn;)s.samples.shift();if(!s.moved)return;let o=s.startHeight-s.heights.full,i=s.startHeight-s.heights.peek,l=Math.max(o,Math.min(i,r));n.style.transform=`translateY(${l}px)`}#B(e){let s=this.#m;if(!s||e.pointerId!==s.pointerId)return;this.#m=null;let n=this.#M();if(n&&(n.style.transform="",n.classList.remove("dragging")),e.type==="pointercancel")return;if(!s.moved){this.#T(1,!0);return}let r=e.clientY-s.startY,o=U.indexOf(this._sheetDetent),i=s.samples[0],l=s.samples[s.samples.length-1],d=i&&l&&l!==i?(l.y-i.y)/Math.max(1,l.t-i.t):0;if(Math.abs(d)>en){let f=Math.max(0,Math.min(U.length-1,o+(d<0?1:-1)));this.#g(U[f]??this._sheetDetent);return}let c=s.startHeight-r,u=this._sheetDetent,h=Number.POSITIVE_INFINITY;for(let f of U){let v=Math.abs(s.heights[f]-c);v<h&&(h=v,u=f)}this.#g(u)}#j(e){if(e.pointerType==="mouse"||this.#O(e))return;let s=e.currentTarget;this.#d={pointerId:e.pointerId,startY:e.clientY,atTop:s.scrollTop===0,consumed:!1}}#Q(e){let s=this.#d;if(!s||s.consumed||!s.atTop||e.pointerId!==s.pointerId)return;if(e.currentTarget.scrollTop>0){this.#d=null;return}e.clientY-s.startY<nn||(s.consumed=!0,this.#T(-1))}#J(){this.#d=null}#X(){this.dispatchEvent(new CustomEvent("hass-toggle-menu",{bubbles:!0,composed:!0}))}#z(e){this.#i=e.currentTarget,this.#h({type:this.state.fullMap?"exit-full-map":"enter-full-map"})}#$(e){this._overflowOpen=!1,e&&this.updateComplete.then(()=>{this.renderRoot.querySelector(".overflow")?.focus()})}#N(e){if(this.#$(e==="fullscreen"),e==="support"){this.#v("support");return}let s=this.renderRoot.querySelector(".app");this.#R()?document.exitFullscreen():s?.requestFullscreen()}#me(){this.#h({type:"set-precision-open",value:!this.state.precisionOpen})}#ce(e){this.#o=e.currentTarget,this._helpOpen=!0}#de(e){let s=e;if(!Me(s.detail))return;if(ee(this.state,s.detail)){e.stopPropagation(),this.#h(s.detail);return}if(s.detail?.type!=="open-dialog")return;let n=s.composedPath().find(r=>r instanceof HTMLElement&&r.hasAttribute("data-dialog-launcher"));n instanceof HTMLElement&&(this.#a=n)}#ue(e){return this.renderRoot.querySelector(ye)?.shadowRoot?.querySelector(`[data-dialog-launcher="${e}"]`)??null}#K(e){if(!Gt(e)&&!(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey)&&e.key==="Escape"){if(e.preventDefault(),this._overflowOpen){this.#$(!0);return}if(this._helpOpen){this._helpOpen=!1;return}if(this.state.dialog==="discardDraft"){this.#u();return}this.#h({type:"dismiss-top-layer"})}}#F(e){if(e.key!=="Tab")return;let n=[...e.currentTarget.querySelectorAll(on)],r=n[0],o=n.at(-1);if(!r||!o)return;let i=this.shadowRoot?.activeElement;e.shiftKey&&i===r?(e.preventDefault(),o.focus()):!e.shiftKey&&i===o&&(e.preventDefault(),r.focus())}#U(){let e=this.renderRoot.querySelector(Ae);(e?.shadowRoot?.querySelector(".map-root")??e)?.focus()}#fe(){this._sheetDetent==="peek"&&this.#M()&&this.#g("half"),this.updateComplete.then(()=>this.#c())}#V(e,s,n){if(e.id==="choose-cleaning")return w;let r=e.labelKey?this.#e(e.labelKey,e.label):e.label,o=!e.enabled&&e.reason?e.reasonKey?this.#e(e.reasonKey,e.reason):e.reason:null,i=e.id==="stop";return b`
      <button
        class=${`${s} ${e.kind==="danger"?"ms-btn--danger":""}`}
        type="button"
        aria-disabled=${e.enabled?w:"true"}
        aria-describedby=${o?n:w}
        aria-label=${i?this.#e("v4_stop_cleaning_label","Stop cleaning"):w}
        @click=${()=>this.#L(e)}
      >${r}</button>
      ${o?b`<p class="action-reason" id=${n}>${o}</p>`:w}
    `}#ee(e){let s=e.resources.plans.value?.rooms??e.resources.areas.value?.rooms??[];return e.selection.roomIds.map(n=>s.find(r=>r.roomId===n)?.name??n)}#W(e,s,n){let r=s?.enabled&&e.workflow==="rooms"&&s.id==="clean-rooms"?[this.#ee(e).join(", "),e.planDraft.returnToBase?this.#e("v4_returns_to_dock","returns to the dock"):""].filter(Boolean).join(" \xB7 "):"";return b`
      <div class="action-bar">
        ${r?b`<p class="action-summary">${r}</p>`:w}
        ${s?this.#V(s,"ms-btn ms-btn--block ms-btn--lg ms-btn--primary","primary-reason"):w}
        ${n?this.#V(n,"ms-btn ms-btn--block ms-btn--lg ms-btn--secondary","secondary-reason"):w}
      </div>
    `}#k(e,s,n=w){return b`
      <div class="host-state">
        <h3>${e}</h3>
        <p>${s}</p>
        ${n}
      </div>
    `}#Y(e,s,n,r,o=!1){return b`
      <button
        class="ms-row"
        type="button"
        aria-disabled=${o?"true":w}
        @click=${()=>{o||n()}}
      >
        <span class="ms-row__lead">${I(s)}</span>
        <span class="ms-row__body"><strong>${e}</strong>${r?b`<small>${r}</small>`:w}</span>
        <span class="ms-row__trail">${I(Oe)}</span>
      </button>
    `}#G(e){let s=e.resources.history.value?.floors||[],n=s.length?s.map((r,o)=>({id:r.active?"current":r.id,label:`${r.label||(r.active?this.#e("v4_current_floor","Current floor"):this.#e("v4_saved_floor","Saved floor {number}",{number:r.ordinal??o+1}))}${!r.active&&r.snapshots.length===0?` \xB7 ${this.#e("v4_floor_not_captured","Visit floor to capture")}`:""}`,disabled:!r.active&&r.snapshots.length===0})):[{id:e.selection.floorId,label:e.floor.displayName,disabled:!1}];return b`
      <select
        class="ms-select context-switcher floor-switcher"
        slot="floor"
        data-map-control
        name="map-floor"
        aria-label=${this.#e("v4_choose_floor","Choose floor")}
        ?disabled=${n.length<=1}
        .value=${e.selection.floorId}
        @change=${r=>this.#h({type:"set-floor",floorId:r.currentTarget.value})}
      >${n.map(r=>b`
        <option value=${r.id} ?selected=${r.id===e.selection.floorId} ?disabled=${r.disabled}>${r.label}</option>
      `)}</select>
    `}#te(e,s){let n=(k,m,C)=>this.#e(k,m,C),r=this.#Y(n("v4_map_history","Map history"),nt,()=>this.#v("history"),n("v4_map_history_detail","Saved maps are floor-scoped and read only.")),o=this.#Y(n("v4_map_diagnostics","Map diagnostics"),Yt,()=>this.#v("support"),n("v4_map_support_detail","Private geometry is never included.")),{host:i}=e;if(!i.connected)return this.#k(n("v4_reconnecting_title","Reconnecting to Home Assistant"),n("v4_reconnecting_body","The last verified map stays read-only until the connection returns."));if(!i.administrator)return this.#k(n("v4_admin_title","Administrator access required"),n("v4_admin_body","Ask a Home Assistant administrator to open this map."));if(i.robotCount===0)return this.#k(n("v4_no_robot_title","No Matic robot set up"),n("v4_no_robot_body","Add the Matic integration to see a map here."),b`<a class="ms-btn ms-btn--secondary" href="/config/integrations/integration/matic_robot">${n("v4_open_integration","Open the Matic integration")}</a>`);if(Pe(e))return this.#k(n("v4_selected_robot_unavailable","Selected robot unavailable"),n("v4_choose_another_robot","Choose another robot to open its map."));if(!i.robotConnected)return b`
        ${this.#k(n("v4_robot_offline_title","Robot offline"),n("v4_robot_offline_body","Showing the last verified map. Cleaning is unavailable until the robot reconnects."))}
        <h3 class="shelf-heading">${n("v4_more","Map tools")}</h3>
        <div class="shelf">${r}${o}</div>
      `;if(Ps(e))return b`
        <h3 class="shelf-heading">${n("v4_more","Map tools")}</h3>
        <div class="shelf">
          ${r}
          ${o}
        </div>
      `;let l=e.coherence==="verifying"||e.coherence==="booting",d=e.resources.plans,c=d.value,u=c!==null&&c.rooms.length===0,h=c?.plans.length??0,f=d.status==="loading",v=d.status==="error",_=l||u,y=l?n("v4_reason_locating","Waiting for the robot to confirm which floor it is on."):u?n("v4_no_rooms_reason","This floor has no named rooms yet."):null,g=l?n("v4_reason_locating","Waiting for the robot to confirm which floor it is on."):null,R=l?n("v4_reason_locating","Waiting for the robot to confirm which floor it is on."):n("v4_areas_quick_detail","Create or choose a saved area");return b`
      ${e.activity==="problem"?this.#k(n("v4_attention_title","The robot needs attention"),n("v4_attention_body","Check the robot, then start a new task.")):b`
          <div class="quick-actions" aria-label=${n("v4_cleaning_choices","Cleaning choices")}>
            <button
              class="ms-row ms-row--card ms-row--featured"
              type="button"
              aria-disabled=${_?"true":w}
              @click=${()=>{_||this.#v("rooms")}}
            >
              <span class="ms-row__lead">${I(we)}</span>
              <span class="ms-row__body">
                <strong>${n("v4_clean_rooms","One-time clean")}</strong>
                <small>${y??n("v4_clean_rooms_hint","Choose rooms for this run")}</small>
              </span>
              <span class="ms-row__trail">${I(Oe)}</span>
            </button>
            <button
              class="ms-row ms-row--card"
              type="button"
              aria-disabled=${l?"true":w}
              @click=${()=>{l||this.#v("plans")}}
            >
              <span class="ms-row__lead">${I(rt)}</span>
              <span class="ms-row__body">
                <strong>${f?n("v4_plans_loading","Checking saved plans"):v?n("v4_plans_unavailable","Plans unavailable"):h?n("v4_run_a_plan","Run a plan"):n("v4_create_plan","Create a plan")}</strong>
                <small>${g??(f?n("v4_plans_loading_hint","Reading routines for this floor"):v?n("v4_plans_unavailable_hint","Try again to load saved routines"):h?h===1?n("v4_saved_routine","1 saved routine"):n("v4_saved_routines","{count} saved routines",{count:h}):n("v4_no_plans_hint","Save a room routine you can repeat"))}</small>
              </span>
              <span class="ms-row__trail">${I(Oe)}</span>
            </button>
          </div>
        `}
      <h3 class="shelf-heading">${n("v4_more","Map tools")}</h3>
      <div class="shelf">
        ${this.#Y(n("v4_custom_areas","Clean a custom area"),Vt,()=>this.#v("draw"),R,l)}
        ${r}

      </div>
      ${s?b`
        <h3 class="shelf-heading" id="map-display-heading">${n("v4_map_display","Map display")}</h3>
        <div class="map-display">
          <div class="ms-segment" role="group" aria-labelledby="map-display-heading">
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(e.appearance==="photo")}
              @click=${()=>this.#h({type:"set-appearance",appearance:"photo"})}
            >${n("map_style_photo","Photo")}</button>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(e.appearance==="rooms")}
              @click=${()=>this.#h({type:"set-appearance",appearance:"rooms"})}
            >${n("v4_room_colours","Floor plan")}</button>
          </div>
          <label class="ms-checkbox">
            <input type="checkbox" .checked=${e.labelsVisible} @change=${()=>this.#h({type:"toggle-labels"})}>
            ${n("v4_room_names","Room names")}
          </label>
          <button
            class="ms-btn ms-btn--secondary help-launcher"
            type="button"
            aria-haspopup="dialog"
            aria-expanded=${String(this._helpOpen)}
            @click=${this.#ce}
          >${n("v4_how_to_move","How to move the map")}</button>
        </div>
      `:w}
    `}#se(e,s){return e.workflow==="none"?this.#te(e,s):customElements.get(ye)?b`<${Cs}
      .state=${e}
      .localize=${this.localize}
      @matic-workspace-intent=${this.#de}
    ></${Cs}>`:(this.#Z(),this._workflowLoadFailed?b`<div class="workflow-loading" role="alert">
          <p>${this.#e("v4_workflow_load_failed","Workspace tools could not be loaded.")}</p>
          <button class="ms-btn ms-btn--secondary" @click=${this.#ne}>
            ${this.#e("v4_retry","Try again")}
          </button>
        </div>`:b`<div class="workflow-loading" role="status" aria-live="polite">
        ${this.#e("v4_workflow_loading","Loading workspace tools\u2026")}
      </div>`)}#Z(){this.#p||customElements.get(ye)||(this._workflowLoadFailed=!1,this.#p=import("./workflow-panel-3HALCBOV.js").then(()=>{this.#p=null,this.requestUpdate()}).catch(()=>{this.#p=null,this._workflowLoadFailed=!0}))}#ne;#re(e,s){let n=xs(e,this.localize);return b`
      <div class="panel-heading">
        ${e.workflow!=="none"?b`
          <button
            class="panel-back ms-btn ms-btn--secondary"
            type="button"
            aria-label=${e.workflow==="plan"?this.#e("v4_back_to_plans","Back to plans"):this.#e("v4_back_to_all_tasks","Back to all tasks")}
            data-dialog-launcher="discardDraft"
            @click=${r=>this.#v(e.workflow==="plan"?"plans":"none",r.currentTarget)}
          >${I(De)}<span class="ms-btn__label">${e.workflow==="plan"?this.#e("v4_your_plans","Your plans"):this.#e("v4_all_tasks","All tasks")}</span></button>
        `:w}
        <h2 tabindex="-1">${n.title}</h2>
      </div>
      <p class="panel-description">${n.description}</p>
      ${this.#se(e,s)}
    `}#oe(e,s){let r=xs(e,this.localize).title;return e.workflow==="rooms"&&e.selection.roomIds.length&&(r=`${this.#e("v4_rooms_selected","Rooms selected: {count}",{count:e.selection.roomIds.length})} \xB7 ${this.#ee(e).join(", ")}`),this._sheetDetent!=="peek"?s.detail?`${s.title} \xB7 ${s.detail}`:s.title:s.notable?`${s.title} \xB7 ${r}`:r}#C(){let e=(s,n)=>this.#e(s,n);return b`
      <div class="dialog-backdrop" @click=${s=>{s.target===s.currentTarget&&(this._helpOpen=!1)}}>
        <section
          class="dialog help-dialog ms-surface ms-surface--overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-title"
          @keydown=${this.#F}
        >
          <h2 id="help-title">${e("v4_how_to_move","How to move the map")}</h2>
          <dl>
            <dt>${e("v4_touch","Touch")}</dt>
            <dd>${e("v4_touch_help","Drag to explore \xB7 pinch to zoom \xB7 twist two fingers to rotate")}</dd>
            <dt>${e("v4_trackpad","Trackpad")}</dt>
            <dd>${e("v4_trackpad_help","Scroll to pan \xB7 pinch to zoom \xB7 twist to rotate")}</dd>
            <dt>${e("v4_mouse","Mouse")}</dt>
            <dd>${e("v4_mouse_help","Drag to orbit \xB7 Shift, middle, or right drag to pan \xB7 wheel to zoom")}</dd>
            <dt>${e("v4_keyboard","Keyboard")}</dt>
            <dd>${e("v4_keyboard_help","WASD to move \xB7 Q/E or arrows to orbit \xB7 +/\u2212 to zoom \xB7 0 to fit")}</dd>
          </dl>
          <div class="dialog-actions">
            <button
              class="ms-btn ms-btn--secondary"
              type="button"
              data-dialog-initial-focus
              @click=${()=>{this._helpOpen=!1}}
            >${e("v4_close","Close")}</button>
          </div>
        </section>
      </div>
    `}render(){let e=this.state,s=e.narrowHint||this._measuredNarrow,n=Zs(e,this.localize),r=Pe(e),o=Ct({...e,narrowHint:s}),i=xt(e),l=!s&&o.id==="stop"?o:!s&&i?.id==="stop"?i:null,d=l&&l===o?null:o,c=e.workflow==="draw"&&e.dataMode==="live"?{id:"clear-draft",label:"Clear drawing",labelKey:"v4_clear_drawing",kind:"neutral",enabled:e.draw.circles.length>0||!!e.draw.outline?.points.length}:null,u=l&&l===i?null:i??c,h=e.fullMap&&(e.coherence==="verifying"||e.coherence==="booting"),f=e.fullMap||e.host.administrator&&e.host.robotCount>0&&e.map.available,v=e.cadenceResetRequest?e.resources.plans.value?.rooms.find(m=>m.roomId===e.cadenceResetRequest?.roomId):void 0,_=e.cadenceResetRequest?e.resources.plans.value?.plans.find(m=>m.id===e.cadenceResetRequest?.planId)?.rooms.find(m=>m.roomId===e.cadenceResetRequest?.roomId):void 0,y=an(e.dialog,this.localize,e.workflow==="plan",v?.name||e.cadenceResetRequest?.roomId||"room",_?.cadence?.scope==="shared",e.cadenceResetRequest?.mode),g=s&&!e.fullMap?`--map-sheet-offset:${this._sheetOffset}px`:"--map-sheet-offset:0px",R=s&&e.workflow==="draw",k=e.precisionOpen&&e.workflow==="draw";return b`
      <div class=${`root ${s?"narrow":"wide"}`} @keydown=${this.#K}>
        <button class="skip-link ms-btn ms-btn--primary" type="button" @click=${this.#U}>${this.#e("v4_skip_to_map","Skip to the map")}</button>
        <button class="skip-link ms-btn ms-btn--primary" type="button" @click=${this.#fe}>${this.#e("v4_skip_to_workspace","Skip to the map workspace")}</button>
        <div class="app" ?inert=${!!y||this._helpOpen}>
          <header class="app-bar">
            ${e.precisionOpen?w:b`
              <button
                class="nav nav--menu ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#e("v4_open_navigation","Open Home Assistant sidebar")}
                title=${this.#e("v4_open_navigation","Open Home Assistant sidebar")}
                @click=${this.#X}
              >${I(Nt)}</button>
            `}

            ${e.precisionOpen?b`
              <button
                class="nav ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#e("v4_back","Back")}
                @click=${()=>this.#h({type:"dismiss-top-layer"})}
              >${I(De)}</button>
            `:w}
            <h1 class="title">${this.#e("map_studio_title","Matic Map")}</h1>
            ${e.robots.length>1||r?b`
              <select
                class="ms-select context-switcher robot-switcher"
                name="matic-robot"
                aria-label=${this.#e("v4_choose_robot","Choose robot")}
                .value=${e.selection.entryId||""}
                @change=${m=>this.#h({type:"select-entry",entryId:m.currentTarget.value})}
              >${r?b`
                <option value=${e.selection.entryId||""} selected disabled>${this.#e("v4_selected_robot_unavailable","Selected robot unavailable")}</option>
              `:w}${e.robots.map(m=>b`
                <option value=${m.entryId} ?selected=${m.entryId===e.selection.entryId}>${m.label}</option>
              `)}</select>
            `:w}

            <span class="spacer"></span>
            ${f?b`
              <button
                class="workspace-toggle ms-btn ms-btn--icon"
                type="button"
                aria-label=${e.fullMap?this.#e("v4_show_workspace","Show cleaning panel"):this.#e("v4_hide_workspace","Hide cleaning panel")}
                aria-controls="map-workspace"
                aria-expanded=${String(!e.fullMap)}
                title=${e.fullMap?this.#e("v4_show_workspace","Show cleaning panel"):this.#e("v4_hide_workspace","Hide cleaning panel")}
                @click=${this.#z}
              >${I(Kt)}</button>
            `:w}
            <div class="overflow-wrap">
              <button
                class="overflow ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#e("v4_map_options","Map options")}
                aria-expanded=${String(this._overflowOpen)}
                aria-controls="map-options"
                @click=${()=>{this._overflowOpen=!this._overflowOpen}}
              >${I(Bt)}</button>
              ${this._overflowOpen?b`
                <div id="map-options" class="overflow-menu ms-surface ms-surface--overlay">
                  <label class="overflow-field ms-field">${this.#e("map_quality_label","Scene detail")}
                    <select
                      aria-label=${this.#e("map_quality_label","Scene detail")}
                      .value=${e.quality}
                      @change=${m=>this.#h({type:"set-quality",quality:m.currentTarget.value})}
                    >
                      <option value="auto">${this.#e("map_quality_auto","Auto detail")}</option>
                      <option value="efficient">${this.#e("map_quality_efficient","Efficient")}</option>
                      <option value="balanced">${this.#e("map_quality_balanced","Balanced")}</option>
                      <option value="maximum">${this.#e("map_quality_maximum","Maximum")}</option>
                    </select>
                  </label>
                  <button class="ms-row ms-row--menu" type="button" @click=${()=>this.#N("support")}>${this.#e("v4_map_diagnostics","Map diagnostics")}</button>
                  <button class="ms-row ms-row--menu" type="button" @click=${()=>this.#N("fullscreen")}>${this._browserFullscreen?this.#e("v4_leave_full_screen","Leave full screen"):this.#e("v4_full_screen","Full screen")}</button>
                </div>
              `:w}
            </div>
          </header>

          <main class=${`workspace ${e.fullMap?"full-map":""}`} style=${g}>
            <div class="canvas">
              <${Es}
                class="map-canvas"
                style=${g}
                .state=${e}
                .localize=${this.localize}
                .narrow=${s}
              >${this.#G(e)}
                ${s&&!e.fullMap&&this._sheetDetent==="full"?b`
                  <button
                    class="sheet-scrim"
                    slot="scrim"
                    data-map-control
                    type="button"
                    aria-label=${this.#e("v4_collapse_sheet","Collapse the map workspace")}
                    @click=${()=>this.#g("peek")}
                  ></button>
                `:w}
              </${Es}>
              ${!s&&k?b`
                <div class="precision-popover">
                  <${Xe} compact .state=${e} .localize=${this.localize}></${Xe}>
                </div>
              `:w}
            </div>

            <!--
              One panel element, not two. It is a grid column when wide and a
              bottom sheet when narrow. Rendering both and hiding one with
              display:none meant two live workflow panels at all times, which
              made #dialogLauncherFor pick the hidden copy on narrow -- so
              cancelling a delete dialog on a phone restored focus to nothing --
              and left every primary action ambiguous under Playwright's strict
              mode.
            -->
            <aside
              id="map-workspace"
              class=${s?"inspector mobile-sheet":"inspector"}
              data-detent=${s?this._sheetDetent:w}
              data-workflow=${e.workflow}
              aria-label="Map workspace"
            >
              ${s?b`
                <div
                  class="sheet-grip"
                  @pointerdown=${this.#b}
                  @pointermove=${this.#A}
                  @pointerup=${this.#B}
                  @pointercancel=${this.#B}
                >
                  <span class="sheet-handle" role="presentation"></span>
                  ${e.workflow!=="none"&&this._sheetDetent==="peek"?b`
                    <button
                      class="sheet-back ms-btn ms-btn--icon ms-btn--sm"
                      type="button"
                      aria-label=${e.workflow==="plan"?this.#e("v4_back_to_plans","Back to plans"):this.#e("v4_back_to_all_tasks","Back to all tasks")}
                      title=${e.workflow==="plan"?this.#e("v4_back_to_plans","Back to plans"):this.#e("v4_back_to_all_tasks","Back to all tasks")}
                      data-dialog-launcher="discardDraft"
                      @click=${m=>this.#v(e.workflow==="plan"?"plans":"none",m.currentTarget)}
                    >${I(De)}</button>
                  `:w}
                  <span class="sheet-status">${this.#oe(e,n)}</span>
                  <button
                    class="ms-btn ms-btn--icon ms-btn--sm"
                    type="button"
                    aria-label=${this.#e("v4_show_more","Show more of the map workspace")}
                    aria-controls="sheet-body"
                    aria-disabled=${this._sheetDetent==="full"?"true":w}
                    @click=${()=>this.#T(1)}
                  >${I(Ft)}</button>
                  <button
                    class="ms-btn ms-btn--icon ms-btn--sm"
                    type="button"
                    aria-label=${this.#e("v4_show_less","Show less of the map workspace")}
                    aria-controls="sheet-body"
                    aria-disabled=${this._sheetDetent==="peek"?"true":w}
                    @click=${()=>this.#T(-1)}
                  >${I(Ut)}</button>
                </div>
                ${R?b`
                  <div class="sheet-tools">
                    ${Xt(e,{intent:m=>this.#h(m),openBrush:()=>this.#me(),t:(m,C)=>this.#e(m,C)},"grid")}
                    ${k?b`
                      <div class="precision-popover">
                        <${Xe} compact inline .state=${e} .localize=${this.localize}></${Xe}>
                      </div>
                    `:w}
                  </div>
                `:w}
                <div
                  class="sheet-body"
                  id="sheet-body"
                  @pointerdown=${this.#j}
                  @pointermove=${this.#Q}
                  @pointerup=${this.#J}
                  @pointercancel=${this.#J}
                >
                  ${this.#re(e,s)}
                </div>
                ${this.#W(e,d,u)}
              `:b`
                <div class="status-strip">
                  <span class="status-icon" aria-hidden="true">${I(n.icon)}</span>
                  <span class="status-copy"><strong>${n.title}</strong><small>${n.detail}</small></span>
                  ${l?this.#V(l,"status-action ms-btn ms-btn--secondary","status-reason"):w}
                </div>
                <section class="workflow">
                  <div class="workflow-body">${this.#re(e,s)}</div>
                  ${this.#W(e,d,u)}
                </section>
              `}
            </aside>

            ${e.fullMap?b`
              <section
                class=${`full-map-hud ms-surface ms-surface--floating ${i?"has-secondary":""} ${!s&&(e.workflow==="draw"||e.workflow==="rooms"&&e.selection.roomIds.length>0)?"above-dock":""}`}
                aria-label="Robot status and action"
              >
                <span class="hud-copy"><strong>${n.title}</strong><small>${n.detail}</small></span>
                ${h&&o.id!=="stop"?w:this.#V(o,"ms-btn ms-btn--lg ms-btn--primary","hud-reason")}
                ${i&&(!h||i.id==="stop")?this.#V(i,"ms-btn ms-btn--lg ms-btn--secondary","hud-secondary-reason"):w}
              </section>
            `:w}
          </main>
        </div>

        <div class="sr-only" aria-live="polite" aria-atomic="true">${[this._announcement,e.notice?.text??""].filter(Boolean).join(" ")}</div>

        ${this._helpOpen?this.#C():w}

        ${y?b`
          <div class="dialog-backdrop">
            <section
              class="dialog ms-surface ms-surface--overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="dialog-title"
              aria-describedby="dialog-detail"
              @keydown=${this.#F}
            >
              <h2 id="dialog-title">${y.title}</h2>
              <p id="dialog-detail">${y.detail}</p>
              <div class="dialog-actions">
                <button
                  class="ms-btn ms-btn--secondary"
                  type="button"
                  data-dialog-initial-focus
                  @click=${e.dialog==="discardDraft"?this.#u:this.#D}
                >${y.cancelLabel}</button>
                ${y.action===null?w:b`
                  <button
                    class="discard ms-btn ms-btn--primary ms-btn--danger"
                    type="button"
                    @click=${()=>this.#q(y)}
                  >${y.confirmLabel}</button>
                `}
              </div>
            </section>
          </div>
        `:w}
      </div>
    `}};customElements.get(ge)||customElements.define(ge,ft);var Is=ae(ge),vt=class extends se{constructor(){super(...arguments);this.narrow=!1;this._workspace=L();this.#e=new ze;this.#t=new kt(this._workspace);this.#n=null;this.#r=null;this.#a=null;this.#i=null;this.#o=null}static{this.styles=[ne,re,te`
:host { display: block; block-size: 100%; }
`]}static{this.properties={hass:{attribute:!1},narrow:{type:Boolean},route:{attribute:!1},panel:{attribute:!1},_workspace:{state:!0}}}#e;#t;#n;#r;#a;#i;#o;#s(e=this.hass,s=this.panel){let n=this.#t.value.selection;return n.entrySource==="user"?this.#e.project(e,s,n.entryId):this.#e.project(e,s)}shouldUpdate(e){if(!e.has("hass")||[...e.keys()].some(n=>n!=="hass"))return!0;let s=e.get("hass");return s?.connection!==this.hass?.connection||s?.localize!==this.hass?.localize?!0:this.#s()!==this.#n}connectedCallback(){super.connectedCallback(),this.#r=this.#t.subscribe(e=>{if(this._workspace=e,e.selection.entryId!==this.#n?.entryKey){let s=this.#s();s!==this.#n&&(this.#n=s,this.#i?.sync(s))}}),this.#p()}disconnectedCallback(){this.#r?.(),this.#r=null,this.#m(),super.disconnectedCallback()}#p(){if(!(!this.isConnected||this.#i)&&(this.#n=this.#s(),this.#a=new He(()=>this.hass),this.#i=new Ye(this.#t,this.#a,this.hass?.connection??null),this.#o=new je(this.#t),this.#o.start(),this.#n)){this.#i.sync(this.#n);let{host:e}=this.#n;e.connected&&e.administrator&&e.robotCount>0&&this.#i.refreshCatalog(this.#t.value.selection.floorId==="current")}}#m(){this.#o?.dispose(),this.#o=null,this.#i?.dispose(),this.#i=null,this.#a=null}willUpdate(e){if(e.has("hass")||e.has("panel")){let s=e.get("hass"),n=e.has("hass")&&s?.connection!==this.hass?.connection,r=this.#s(),o=r!==this.#n;o&&(this.#n=r),n?(this.#m(),this.#p()):(o||e.has("panel"))&&this.#i?.sync(r)}e.has("narrow")&&this.#t.value.narrowHint!==this.narrow&&this.#t.dispatch({type:"set-narrow-hint",value:this.narrow})}#d(e){if(!Me(e.detail))return;e.stopPropagation();let s=e.detail;if(s.type==="dismiss-top-layer"||s.type==="exit-full-map"){this.#o?.dismissTop()||this.#t.dispatch(s);return}if(s.type==="open-workflow"&&s.workflow!=="none"){this.#i?.openWorkflow(s.workflow);return}if(s.type==="set-floor"){this.#i?.selectFloor(s.floorId);return}if(s.type==="select-entry"){if(!this._workspace.robots.some(n=>n.entryId===s.entryId)||this.#e.project(this.hass,this.panel,s.entryId).entryKey!==s.entryId)return;this.#t.dispatch(s);return}if(s.type==="set-history"){this.#i?.selectHistory(s.historyId);return}if(s.type==="select-plan"){this.#i?.selectPlan(s.planId);return}if(s.type==="select-area"){this.#i?.selectArea(s.areaId),s.workflow==="areaReview"&&this.#i?.openWorkflow("areaReview");return}this.#t.dispatch(s)}#R(e){e.stopPropagation(),typeof e.detail?.id=="string"&&(e.detail.id==="reset-room-cadence"&&"planId"in e.detail&&"roomId"in e.detail&&"mode"in e.detail?this.#i?.executeAction(e.detail):this.#i?.executeAction(e.detail.id),this.dispatchEvent(new CustomEvent("matic-map-v4-action-requested",{detail:{id:e.detail.id},bubbles:!0,composed:!0})))}getWorkspaceSnapshot(){return this.#t.value}render(){return b`
      <${Is}
        .state=${this._workspace}
        .localize=${this.hass?.localize}
        @matic-workspace-intent=${this.#d}
        @matic-workspace-action=${this.#R}
      ></${Is}>
    `}};customElements.get(tt)||customElements.define(tt,vt);export{ze as a,ae as b,b as c,vt as d};
/*! Bundled license information:

lit-html/static.js:
  (**
   * @license
   * Copyright 2020 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/
