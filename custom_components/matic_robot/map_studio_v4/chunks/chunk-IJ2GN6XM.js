import{A as as,a as De,b as ge,c as be,d as we,e as rt,f as Lt,g as it,h as Wt,i as qt,j as ae,k as _e,l as le,m as zt,n as S,o as Oe,p as Bt,q as Nt,r as Ht,s as Ft,t as Kt,u as Ut,v as Vt,w as os,x as rs,y as is,z as Re}from"./chunk-ZDPV3WHP.js";import{$ as Qt,A as ot,Aa as ts,B as Ie,Ba as ss,C as Tt,Ca as ns,D as At,Da as I,E as It,Ea as Q,F as $t,J as ne,K as $e,L as Dt,M as Ot,O as R,Q as oe,R as re,S as ie,T as Le,U as ke,V as We,W as jt,X as Yt,Y as Xt,Z as qe,_ as Gt,c as Mt,e as et,f as tt,h as E,j as Te,k as se,n as L,o as Ct,p as st,q as nt,ra as Jt,s as xt,sa as at,t as Pt,ta as lt,ua as ct,v as Ae,va as dt,wa as ut,x as ye,xa as Zt,ya as U,za as es}from"./chunk-MJRS4VPP.js";var Fs=(a,t)=>{if(t?.recharge_and_resume===!0&&t?.charging===!0)return"recharging";switch(a){case"cleaning":return"cleaning";case"paused":return"paused";case"returning":return"returning";case"docked":return"docked";case"idle":return"idle";case"error":return"problem";default:return"unknown"}},Ks=a=>typeof a!="number"||!Number.isFinite(a)?null:Math.round(Math.max(0,Math.min(100,a))),Us=a=>{let t=a.attributes?.matic_entry_id;return typeof t=="string"&&t.length>0?t:null},Vs=a=>String(a||"local-user").replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",ls=a=>{if(typeof a!="string")return"Matic robot";let t=a.trim();return t&&Array.from(t).length<=128&&!/[\u0000-\u001f\u007f]/u.test(t)?t:"Matic robot"},ze=class{#e="";#t=null;project(t,e,s=null){let n=t?.states??{},o=e?.config?.entry_id,i=s||(typeof o=="string"?o:null),l=null,c=null,d=i,u=new Map;for(let[v,g]of Object.entries(n)){let C=Us(g);C&&v.startsWith("vacuum.")&&(u.set(C,{entryId:C,label:ls(g.attributes?.friendly_name)}),(i?C===i:!l)&&(l=g,c=v,d=C))}let m={connected:t?.connected!==!1,administrator:t?.user?.is_admin===!0,robotConnected:l!==null&&l.state!=="unavailable"&&l.state!=="unknown",robotCount:u.size},h=l?Fs(l.state,l.attributes):"unknown",f=Ks(l?.attributes?.battery_level),w=t?.selectedLanguage||t?.language||"en",y=Vs(t?.user?.id),_=ls(l?.attributes?.friendly_name),M=[...u.values()].sort((v,g)=>v.label.localeCompare(g.label,w,{sensitivity:"base"})),k=[m.connected,m.administrator,m.robotConnected,m.robotCount,h,f??"none",w,y,c??"none",d??"none",_,M.map(v=>`${v.entryId}:${v.label}`).join(",")].join("|");return k===this.#e&&this.#t?this.#t:(this.#e=k,this.#t={host:m,activity:h,batteryPercent:f,language:w,userKey:y,vacuumEntityId:c,entryKey:d,robotLabel:_,robots:M},this.#t)}};var ds=Symbol.for(""),js=a=>{if(a?.r===ds)return a?._$litStatic$},ce=a=>({_$litStatic$:a,r:ds});var cs=new Map,ht=a=>(t,...e)=>{let s=e.length,n,o,r=[],i=[],l,c=0,d=!1;for(;c<s;){for(l=t[c];c<s&&(o=e[c],(n=js(o))!==void 0);)l+=n+t[++c],d=!0;c!==s&&i.push(o),r.push(l),c++}if(c===s&&r.push(t[s]),d){let u=r.join("$$lit$$");(t=cs.get(u))===void 0&&(r.raw=r,cs.set(u,t=r)),e=i}return a(t,...e)},b=ht($e),Cn=ht(Dt),xn=ht(Ot);var Ys=1024*1024,us=a=>{let t=s=>{let n=a.sceneHeaderBytes,o=a.scenePointStride,r=a.sceneMaxPoints,i=a.sceneMaxBytes,l=()=>{throw new Error("invalid-scene")};(!(s instanceof ArrayBuffer)||s.byteLength<n||s.byteLength>i)&&l();let c=new DataView(s),d=new Uint8Array(s,0,8),u=String.fromCharCode(...d),m=c.getUint16(8,!0),h=c.getUint16(10,!0),f=c.getUint32(12,!0),w=c.getUint32(16,!0),y=c.getUint32(20,!0),_=w+y,M=n+f;(u!=="MATIC3D\0"||m!==1||h!==o||f>1048576||_<1||_>r||M+_*h!==s.byteLength)&&l();let k;try{k=JSON.parse(new TextDecoder("utf-8",{fatal:!0}).decode(new Uint8Array(s,n,f)))}catch{l()}(!k||typeof k!="object"||Array.isArray(k))&&l();let v=k,g=v.meters_per_cell,C=v.origin_cells,N=v.span_cells;(typeof g!="number"||!Number.isFinite(g)||g<.001||g>.1||!Array.isArray(C)||C.length!==2||!C.every($=>typeof $=="number"&&Number.isFinite($))||!Array.isArray(N)||N.length!==2||!N.every($=>typeof $=="number"&&Number.isFinite($)&&$>=1&&$<=65536))&&l();let F=(Array.isArray(v.rooms)?v.rooms.slice(0,128):[]).flatMap(($,xe)=>{if(!$||typeof $!="object"||Array.isArray($))return[];let q=$,Y=typeof q.name=="string"?q.name.trim():"";if(!Y||Array.from(Y).length>128||/[\u0000-\u001f\u007f]/u.test(Y))return[];if(!Array.isArray(q.boundary)||q.boundary.length<3||q.boundary.length>8192)return[];let Pe=q.boundary.flatMap(K=>{if(!Array.isArray(K)||K.length!==2)return[];let[X,te]=K;return typeof X=="number"&&Number.isFinite(X)&&typeof te=="number"&&Number.isFinite(te)?[[X,te]]:[]}),J=q.center;if(Pe.length<3||!Array.isArray(J)||J.length!==2)return[];let[Z,ee]=J;return typeof Z!="number"||!Number.isFinite(Z)||typeof ee!="number"||!Number.isFinite(ee)?[]:[{id:`scene-room-${xe+1}`,name:Y,boundary:Pe,center:[Z,ee]}]}),fe=typeof v.sample_step=="number"&&Number.isInteger(v.sample_step)?Math.max(1,Math.min(r,v.sample_step)):1,ve=C,Ce=N;return{buffer:s,pointOffset:M,floorCount:w,surfaceCount:y,total:_,metadata:{metersPerCell:g,origin:[ve[0],ve[1]],span:[Ce[0],Ce[1]],sampleStep:fe,rooms:F}}};return{parseTransfer:t,decodeDeltaTransfer:async(s,n,o)=>{let r=(A="invalid-scene-delta")=>{throw new Error(A)},i=()=>{if(o?.aborted)throw new DOMException("Aborted","AbortError")};(!(s instanceof ArrayBuffer)||s.byteLength<a.deltaHeaderBytes||s.byteLength>a.deltaHeaderBytes+a.deltaMaxBytes||!(n.buffer instanceof ArrayBuffer)||n.buffer.byteLength<a.sceneHeaderBytes||n.buffer.byteLength>a.deltaMaxBytes||!Number.isSafeInteger(n.revision)||n.revision<0)&&r("invalid-scene-delta-size");let l=new DataView(s),c=String.fromCharCode(...new Uint8Array(s,0,8)),d=l.getUint16(8,!0),u=l.getUint16(10,!0),m=l.getBigUint64(12,!0),h=l.getBigUint64(20,!0),f=l.getUint32(28,!0),w=l.getUint32(32,!0),y=Number(m),_=Number(h);(c!=="MATICDLT"||d!==1||u!==1||!Number.isSafeInteger(y)||!Number.isSafeInteger(_)||y!==n.revision||_<=n.revision||f<a.sceneHeaderBytes||f>a.deltaMaxBytes||w<1||w>a.deltaMaxBytes||w+a.deltaHeaderBytes!==s.byteLength)&&r(),typeof DecompressionStream!="function"&&r("scene-delta-decompression-unavailable"),i();let M=new Uint8Array(s,a.deltaHeaderBytes,w),k=Math.max(n.buffer.byteLength,f);k>a.deltaMaxBytes&&r("invalid-scene-delta-size");let v=new Uint8Array(k),C=new Blob([M]).stream().pipeThrough(new DecompressionStream("deflate")).getReader(),N=0,me=null;try{for(me=()=>{C.cancel().catch(()=>{})},o?.addEventListener("abort",me,{once:!0});;){i();let{done:A,value:G}=await C.read();if(A)break;(!(G instanceof Uint8Array)||N+G.byteLength>k)&&r(),v.set(G,N),N+=G.byteLength}}catch(A){if(await C.cancel().catch(()=>{}),o?.aborted||A instanceof DOMException&&A.name==="AbortError")throw new DOMException("Aborted","AbortError");if(A instanceof Error&&A.message==="invalid-scene-delta")throw A;r()}finally{me&&o?.removeEventListener("abort",me),C.releaseLock()}i(),N!==k&&r();let F=new Uint8Array(n.buffer),fe=new DataView(v.buffer,v.byteOffset,v.byteLength),ve=Math.min(a.sceneHeaderBytes,F.byteLength);for(let A=0;A<ve;A+=1)v[A]=(v[A]??0)^(F[A]??0);let Ce=fe.getUint32(12,!0),$=fe.getUint32(16,!0),xe=fe.getUint32(20,!0),q=a.sceneHeaderBytes+Ce,Y=$+xe,Pe=q===n.pointOffset&&$===n.floorCount&&xe===n.surfaceCount,J=q+Y*a.scenePointStride,Z=Pe&&J===f&&Y<=a.sceneMaxPoints,ee=[],K=-1,X=!1,te=()=>{X&&K>=0&&ee.push(K),X=!1};for(let A=ve;A<F.byteLength;A+=a.xorChunkBytes){i();let G=Math.min(F.byteLength,A+a.xorChunkBytes);for(let z=A;z<G;z+=1){let Rt=F[z]??0,St=(v[z]??0)^Rt;if(v[z]=St,!Z||z<n.pointOffset||z>=J)continue;let Et=Math.floor((z-n.pointOffset)/a.dirtyBlockBytes);Et!==K&&(te(),K=Et),St!==Rt&&(X=!0)}G<F.byteLength&&await new Promise(z=>globalThis.setTimeout(z,0))}te(),i();let Hs=f===v.byteLength?v.buffer:v.slice(0,f).buffer;return{parsed:t(Hs),revision:_,...Z?{deltaHint:{baseRevision:y,blockBytes:a.dirtyBlockBytes,dirtyBlocks:ee}}:{}}}}},hs=Object.freeze({deltaHeaderBytes:_e,deltaMaxBytes:le,sceneHeaderBytes:it,sceneMaxBytes:ae,sceneMaxPoints:qt,scenePointStride:Wt,dirtyBlockBytes:zt,xorChunkBytes:Ys}),ps=us(hs),Xs=a=>{try{return ps.parseTransfer(a)}catch{throw new S("invalid-scene")}},Gs=()=>`
  const { parseTransfer, decodeDeltaTransfer } = (${us.toString()})(Object.freeze(${JSON.stringify(hs)}));
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
`,Be=class{#e=null;#t=null;#n=!1;#o=!1;#a=0;#i=null;#r=null;#s=null;constructor(){if(!(typeof Worker!="function"||typeof URL?.createObjectURL!="function"))try{this.#t=URL.createObjectURL(new Blob([Gs()],{type:"text/javascript"})),this.#y()}catch{this.#e=null,this.#t&&URL.revokeObjectURL(this.#t),this.#t=null}}async parse(t,e){if(this.#u(e),t.byteLength>ae||t.byteLength<it)throw new S("invalid-scene");let s=await this.#c({kind:"parse",buffer:t},e,async n=>(await new Promise(o=>globalThis.setTimeout(o,0)),this.#u(n),{id:0,ok:!0,parsed:Xs(t)}));if(!s.parsed)throw new S("invalid-scene");return s.parsed}async decodeDelta(t,e,s){if(this.#u(s),t.byteLength>_e+le||e.buffer.byteLength>le)throw new S("invalid-scene-delta-size");let n={buffer:e.buffer,revision:e.revision,pointOffset:e.pointOffset,floorCount:e.floorCount,surfaceCount:e.surfaceCount},o;try{o=await this.#c({kind:"delta",payload:t},s,async r=>(await new Promise(i=>globalThis.setTimeout(i,0)),this.#u(r),ps.decodeDeltaTransfer(t,n,r).then(i=>({id:0,ok:!0,...i}))),n)}catch(r){throw r instanceof S?r:s?.aborted||r instanceof DOMException&&r.name==="AbortError"?new DOMException("Aborted","AbortError"):r instanceof Error&&(r.message.startsWith("invalid-scene")||r.message==="scene-delta-decompression-unavailable")?new S(r.message):new S("invalid-scene-delta")}if(!o.parsed||o.revision===void 0)throw new S("invalid-scene-delta");return{parsed:o.parsed,revision:o.revision,...o.deltaHint?{deltaHint:o.deltaHint}:{}}}#u(t){if(this.#o)throw new S("scene-parser-disposed");if(t?.aborted)throw new DOMException("Aborted","AbortError")}#y(){if(!(!this.#t||this.#n||this.#o))try{let t=new Worker(this.#t);t.onmessage=e=>{let s=this.#i;this.#e!==t||!s||s.worker!==t||e.data.id!==s.id||(e.data.ok?this.#g(s,e.data):this.#g(s,void 0,new S(e.data.problem||"invalid-scene")))},t.onerror=()=>this.#d(t),t.onmessageerror=()=>this.#d(t),this.#e=t}catch{this.#e=null,this.#n=!0}}async#c(t,e,s,n){return this.#u(e),new Promise((o,r)=>{let i,l=()=>e?.removeEventListener("abort",i.abort),c=(d,u)=>{i.settled||(i.settled=!0,l(),u!==void 0?r(u):d?o(d):r(new S("invalid-scene")))};i={id:++this.#a,message:t,...e?{signal:e}:{},fallback:s,...n?{base:n}:{},settle:c,abort:()=>this.#k(i),settled:!1,worker:null},e?.addEventListener("abort",i.abort,{once:!0}),e?.aborted||this.#o?c(void 0,e?.aborted?new DOMException("Aborted","AbortError"):new S("scene-parser-disposed")):this.#i?this.#r?c(void 0,new S("scene-parser-busy")):this.#r=i:(this.#i=i,this.#b(i))})}#b(t){if(this.#i!==t)return;if(this.#o){this.#g(t,void 0,new S("scene-parser-disposed"));return}if(t.signal?.aborted){this.#g(t,void 0,new DOMException("Aborted","AbortError"));return}!this.#e&&!this.#n&&this.#y();let e=this.#e;if(e){t.worker=e;try{let n,o;if(t.message.kind==="parse")n={id:t.id,kind:t.message.kind,buffer:t.message.buffer},o=[t.message.buffer];else{if(!t.base)throw new S("invalid-scene-delta");let r={...t.base,buffer:t.base.buffer.slice(0)};n={id:t.id,kind:t.message.kind,payload:t.message.payload,base:r},o=[t.message.payload,r.buffer]}e.postMessage(n,o)}catch{this.#d(e)}return}let s=new AbortController;this.#s=s,Promise.resolve().then(()=>t.fallback(s.signal)).then(n=>this.#g(t,n),n=>this.#g(t,void 0,n))}#k(t){let e=new DOMException("Aborted","AbortError");if(this.#r===t){this.#r=null,t.settle(void 0,e);return}this.#i===t&&(t.worker?(this.#f(),this.#g(t,void 0,e)):this.#s?.abort())}#g(t,e,s){if(this.#i!==t){t.settle(void 0,new S("scene-parser-disposed"));return}let n=t.signal?.aborted?new DOMException("Aborted","AbortError"):s;t.settle(e,n),this.#i=null,this.#s=null,t.worker=null,this.#o||this.#m()}#m(){if(this.#o||this.#i||!this.#r)return;let t=this.#r;if(this.#r=null,t.signal?.aborted){t.settle(void 0,new DOMException("Aborted","AbortError")),this.#m();return}this.#i=t,this.#b(t)}#d(t){if(this.#e!==t)return;this.#n=!0,this.#f();let e=this.#i;e?.worker===t?this.#g(e,void 0,new S("scene-worker-failed")):this.#m()}#f(){this.#e?.terminate(),this.#e=null}dispose(){if(this.#o)return;this.#o=!0;let t=this.#r;this.#r=null,t?.settle(void 0,new S("scene-parser-disposed"));let e=this.#i;this.#f(),this.#s?.abort(),this.#s=null,e&&(e.worker=null,e.settle(void 0,new S("scene-parser-disposed"))),this.#i=null,this.#t&&URL.revokeObjectURL(this.#t),this.#t=null}};var pt=["catalog","scene","sceneDelta","pose","history","plans","areas","areaSave","areaDelete"];var mt=()=>({requests:0,completed:0,failed:0,aborted:0,timedOut:0,totalDurationMs:0,maxDurationMs:0}),ms=a=>Math.min(1e9,a+1),fs=a=>Number.isFinite(a)?Math.min(1e12,Math.max(0,a)):0,de=class{#e=mt();#t=!1;record(t,e){if(this.#t)return;let s=Math.round(fs(e)*100)/100;this.#e.requests=ms(this.#e.requests),this.#e[t]=ms(this.#e[t]),this.#e.totalDurationMs=fs(this.#e.totalDurationMs+s),this.#e.maxDurationMs=Math.max(this.#e.maxDurationMs,s)}snapshot(){return Object.freeze({...this.#e})}reset(){this.#t||Object.assign(this.#e,mt())}dispose(){this.#t=!0,Object.assign(this.#e,mt())}},Ne=class{#e=Object.fromEntries(pt.map(t=>[t,new de]));#t=!1;record(t,e,s){this.#t||this.#e[t].record(e,s)}snapshot(){let t=Object.fromEntries(pt.map(e=>[e,this.#e[e].snapshot()]));return Object.freeze(t)}dispose(){if(!this.#t){this.#t=!0;for(let t of pt)this.#e[t].dispose()}}};var W={catalog:1e4,scene:6e4,delta:35e3,pose:1e4,history:15e3,workflow:15e3,mutation:2e4,roomPreview:15e3},Qs=2,Se=new WeakMap,vs={coverage_identity_unavailable:"Could not verify the current cleaning task. Check the robot status, then try again.",coverage_activity_unavailable:"Could not verify whether the robot is cleaning. Check the robot status, then try again.",coverage_native_session_active:"The robot already has a cleaning task. Wait for it to finish before starting another cleaning task.",coverage_identity_changed:"The cleaning task changed during setup. Check the robot status, then try again."},Js=(a,t)=>{if(!a||typeof a!="object")return null;let e=a;if(e.translation_domain!=="matic_robot"||typeof e.translation_key!="string"||!Object.hasOwn(vs,e.translation_key))return null;let s=e.translation_key,n=vs[s];try{let o=t?.(`component.matic_robot.exceptions.${s}.message`);o&&o!==`component.matic_robot.exceptions.${s}.message`&&(n=o)}catch{}return new P(s,null,n)},P=class extends Error{constructor(t,e=null,s=null){super(s??t),this.name="BackendError",this.code=t,this.status=e,this.recoveryMessage=s}},ys=(a,t)=>{let e=a.headers.get("X-Matic-Revision");if(e===null)return t;let s=Number(e);if(!Number.isSafeInteger(s)||s<0)throw new S("invalid-scene-revision");return s},gs=(a,t)=>{let e=a.headers.get("X-Matic-Floor-Coherent");if(e===null)return t;if(e==="1")return!0;if(e==="0")return!1;throw new S("invalid-scene-floor-header")},He=class{#e;#t=new Be;#n=new WeakMap;#o=new Set;#a=new Ne;#i=!1;constructor(t){this.#e=t}requestDiagnostics(){return this.#a.snapshot()}async#r(t,e,s=Number.POSITIVE_INFINITY,n="invalid-response-size"){let o=t.body?.getReader();if(!o)return new ArrayBuffer(0);let r=()=>{o.cancel().catch(()=>{})};e.addEventListener("abort",r,{once:!0});try{if(e.aborted)throw r(),new DOMException("Aborted","AbortError");let i=[],l=0;for(;;){let u=await o.read();if(e.aborted)throw new DOMException("Aborted","AbortError");if(u.done)break;if(l+u.value.byteLength>s)throw o.cancel().catch(()=>{}),new S(n);i.push(u.value),l+=u.value.byteLength}let c=new Uint8Array(l),d=0;for(let u of i)c.set(u,d),d+=u.byteLength;return c.buffer}finally{e.removeEventListener("abort",r),o.releaseLock()}}async#s(t,e,s,n,o,r){if(!Vt(e))throw new P("invalid-private-path");if(o?.aborted)throw new DOMException("Aborted","AbortError");let i=performance.now(),l="failed",c=new AbortController,d=()=>{},u=new Promise((w,y)=>{d=y}),m=()=>{c.abort(),d(new DOMException("Aborted","AbortError"))};o?.addEventListener("abort",m,{once:!0});let h=!1,f=window.setTimeout(()=>{h=!0,m()},n);try{let w=this.#e(),y=new Headers(s.headers),_={...s,cache:"no-store",credentials:"same-origin",headers:Object.fromEntries(y.entries()),signal:c.signal},M=async()=>{let v;if(typeof w?.fetchWithAuth=="function")v=await w.fetchWithAuth(e,_);else{let g=w?.auth?.accessToken||w?.auth?.data?.access_token;g&&y.set("Authorization",`Bearer ${g}`);let C=typeof w?.hassUrl=="function"?w.hassUrl(e):e;v=await fetch(C,{..._,headers:y})}try{if(c.signal.aborted)throw new DOMException("Aborted","AbortError");return await r(v,c.signal)}finally{v.body&&!v.body.locked&&v.body.cancel().catch(()=>{})}},k=await Promise.race([M(),u]);return l="completed",k}catch(w){throw h&&!o?.aborted?(l="timedOut",new P("request-timeout")):c.signal.aborted?(l="aborted",new DOMException("Aborted","AbortError")):w}finally{window.clearTimeout(f),o?.removeEventListener("abort",m),this.#a.record(t,l,performance.now()-i)}}async#u(t,e,s,n,o={}){return this.#s(t,e,{...o,headers:{Accept:"application/json",...o.headers||{}}},s,n,async(r,i)=>{if(!r.ok){let l=r.headers.get("X-Matic-Plans-Conflict");throw new P(l==="map-rechecking"?"map-rechecking":"request-failed",r.status)}try{return JSON.parse(new TextDecoder().decode(await this.#r(r,i)))}catch{throw new S("invalid-json-response")}})}async catalog(t){return Oe(await this.#u("catalog",Lt,W.catalog,t))}async scene(t,e,s,n,o,r){let i=new Headers({Accept:"application/vnd.matic.slam-scene"});return n==="live"&&i.set("X-Matic-Prefer-Cached","1"),r&&i.set("If-None-Match",r),this.#s("scene",t,{headers:i},W.scene,o,async(l,c)=>{let d=ys(l,e),u=gs(l,s);if(l.status===304)return{scene:null,floorCoherent:u,revision:d,notModified:!0};if(!l.ok)throw new P("scene-request-failed",l.status);if(l.headers.get("Content-Type")?.split(";",1)[0]!=="application/vnd.matic.slam-scene")throw new S("invalid-scene-content-type");return{scene:{...await this.#t.parse(await this.#r(l,c,ae,"invalid-scene-size"),c),revision:d,etag:l.headers.get("ETag"),source:n},floorCoherent:u,revision:d,notModified:!1}})}async sceneDelta(t,e,s,n){let o=t.includes("?")?"&":"?";return this.#s("sceneDelta",`${t}${o}since=${encodeURIComponent(e.revision)}`,{headers:{Accept:"application/vnd.matic.slam-delta, application/vnd.matic.slam-scene"}},W.delta,n,async(r,i)=>{let l=ys(r,e.revision),c=gs(r,s);if(r.status===204){if(l!==e.revision)throw new S("invalid-scene-delta-revision");return{scene:null,floorCoherent:c,revision:l,notModified:!0}}if(!r.ok)throw new P("delta-request-failed",r.status);if(l<=e.revision)throw new S("invalid-scene-delta-revision");let d=r.headers.get("Content-Type")?.split(";",1)[0];if(d!=="application/vnd.matic.slam-delta"&&d!=="application/vnd.matic.slam-scene")throw new S("invalid-scene-delta-content-type");let u=d==="application/vnd.matic.slam-delta",m=u?_e+le:ae,h=Number(r.headers.get("Content-Length"));if(Number.isFinite(h)&&h>m)throw new S(u?"invalid-scene-delta-size":"invalid-scene-size");let f=await this.#r(r,i,m,u?"invalid-scene-delta-size":"invalid-scene-size");if(u){let y=Number(r.headers.get("X-Matic-Base-Revision"));if(!Number.isSafeInteger(y)||y!==e.revision)throw new S("invalid-scene-delta-base");let _=await this.#t.decodeDelta(f,e,i);if(_.revision!==l)throw new S("invalid-scene-delta-revision");return{scene:{..._.parsed,revision:l,etag:r.headers.get("ETag"),source:"live",..._.deltaHint?{deltaHint:_.deltaHint}:{}},floorCoherent:c,revision:l,notModified:!1}}return{scene:{...await this.#t.parse(f,i),revision:l,etag:r.headers.get("ETag"),source:"live"},floorCoherent:c,revision:l,notModified:!1}})}async pose(t,e){return Ut(await this.#u("pose",t,W.pose,e))}async history(t,e){return Bt(await this.#u("history",t,W.history,e))}async plans(t,e){return Kt(await this.#u("plans",t,W.workflow,e))}async areas(t,e){return Ht(await this.#u("areas",t,W.workflow,e))}async previewRoomSequence(t,e,s,n){if(!t||t.length>255||e.length<1||e.length>100)throw new S("invalid-room-sequence-preview-request");if(n?.aborted)throw new DOMException("Aborted","AbortError");let o=this.#e()?.connection;if(!o?.sendMessagePromise)throw new P("preview-unavailable");let r=null,i=()=>{},l=new Promise((_,M)=>{i=M}),c=this.#n.get(o),d,u=new Promise(_=>{d=_});this.#n.set(o,u);let m=!1,h=()=>{m||(m=!0,d(),this.#n.get(o)===u&&this.#n.delete(o))},f=!1,w=()=>{i(new DOMException("Aborted","AbortError")),f&&(h(),r!==null&&window.clearTimeout(r),r=null)};n?.addEventListener("abort",w,{once:!0});let y=new Promise((_,M)=>{r=window.setTimeout(()=>{r=null,M(new P("preview-timeout"))},W.roomPreview)});y.catch(()=>{f&&h()});try{if(c&&(await Promise.race([c,l,y]),n?.aborted))throw new DOMException("Aborted","AbortError");let _=Se.get(o)??0;if(_>=Qs)throw new P("preview-unavailable");let M=o.sendMessagePromise({type:"call_service",domain:"matic_robot",service:"preview_room_sequence",target:{entity_id:t},service_data:{rooms:e.map(C=>({room:C.room,cleaning_mode:C.cleaning_mode,coverage_setting:C.coverage_setting})),use_room_schedule:!0,override_room_schedule:s},return_response:!0});Se.set(o,_+1),f=!0;let k=!1,v=()=>{if(!k){k=!0;let C=(Se.get(o)??1)-1;C===0?Se.delete(o):Se.set(o,C)}h(),r!==null&&window.clearTimeout(r),r=null};M.then(v,v);let g=await Promise.race([M,l,y]);if(n?.aborted)throw new DOMException("Aborted","AbortError");if(!g||typeof g!="object"||Array.isArray(g)||!("response"in g))throw new S("invalid-room-sequence-preview-envelope");return Nt(g.response)}finally{f||(c?c.then(h,h):h(),r!==null&&window.clearTimeout(r),r=null),n?.removeEventListener("abort",w)}}async saveArea(t,e,s){let n=await this.#u("areaSave",t,W.mutation,s,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...e.areaId?{area_id:e.areaId}:{},name:e.name,circles:e.circles,...e.outline?.closed?{outline:e.outline.points}:{},cleaning_mode:e.cleaningMode,coverage_setting:e.coverageSetting})});if(!n||typeof n!="object"||typeof n.id!="string")throw new S("invalid-area-save-response");return n.id}async deleteArea(t,e,s){await this.#s("areaDelete",`${t}?area_id=${encodeURIComponent(e)}`,{method:"DELETE",headers:{Accept:"application/json"}},W.mutation,s,async n=>{if(!n.ok)throw new P("area-delete-failed",n.status)})}async service(t,e,s,n,o={}){let r=this.#e();if(this.#i||typeof r?.callService!="function")throw new P("service-unavailable");let i=null,l=null;try{let c=o.returnResponse?r.callService(t,e,s,{entity_id:n},!0,!0):r.callService(t,e,s,{entity_id:n});return!o.returnResponse&&!o.acknowledgementTimeout?await c:await Promise.race([c,new Promise((d,u)=>{l=()=>{i!==null&&window.clearTimeout(i),i=null,u(new DOMException("Aborted","AbortError"))},this.#o.add(l),i=window.setTimeout(()=>u(new P("mutation-timeout")),W.mutation)})])}catch(c){throw Js(c,r.localize)??c}finally{i!==null&&window.clearTimeout(i),l&&this.#o.delete(l)}}dispose(){if(!this.#i){this.#i=!0,this.#a.dispose();for(let t of this.#o)t();this.#o.clear(),this.#t.dispose()}}};var ws=()=>({version:4,view:"top",appearance:"photo",labels:!0,quality:"auto",cameras:{}}),Ee=(a,t,e)=>Math.max(t,Math.min(e,a)),_s=a=>a.replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",ft=(a,t=4)=>`matic-map-studio:v${t}:${_s(a)}`,Zs=a=>{if(!a||typeof a!="object")return null;let t=a;return["yaw","pitch","zoom","targetX","targetZ"].every(s=>typeof t[s]=="number"&&Number.isFinite(t[s]))?{yaw:Ee(t.yaw,-Math.PI,Math.PI),pitch:Ee(t.pitch,.18,Math.PI/2-.018),zoom:Ee(t.zoom,.01,100),targetX:Ee(t.targetX,-1e4,1e4),targetZ:Ee(t.targetZ,-1e4,1e4)}:null},bs=a=>{let t=ws();if(!a||typeof a!="object")return t;let e=a,s=e.view==="three"||e.view==="top"||e.view==="rooms"?e.view:t.view,n=s==="rooms"?"top":s,o=e.quality==="auto"||e.quality==="efficient"||e.quality==="balanced"||e.quality==="maximum"?e.quality:t.quality,r=e.cameras&&typeof e.cameras=="object"?e.cameras:{},i={};for(let l of["three","top"]){let c=Zs(r[l]);c&&(i[l]=c)}return{version:4,view:n,appearance:e.appearance==="rooms"||e.appearance==="photo"?e.appearance:t.appearance,labels:typeof e.labels=="boolean"?e.labels:t.labels,quality:o,cameras:i}},Fe=class{#e="local-user";#t=null;#n=null;load(t){this.#o(),this.#e=_s(t);try{let e=window.localStorage.getItem(ft(this.#e));if(e)return bs(JSON.parse(e));for(let s of[3,2]){let n=window.localStorage.getItem(ft(this.#e,s));if(n)return bs(JSON.parse(n))}}catch{}return ws()}schedule(t){this.#t!==null&&window.clearTimeout(this.#t),this.#n={key:ft(this.#e),value:t},this.#t=window.setTimeout(()=>this.#o(),250)}#o(){this.#t!==null&&window.clearTimeout(this.#t),this.#t=null;let t=this.#n;if(this.#n=null,!!t)try{window.localStorage.setItem(t.key,JSON.stringify(t.value))}catch{}}dispose(){this.#o()}};var yt=1,ue=Number.MAX_SAFE_INTEGER,Ms=Number.MAX_SAFE_INTEGER,ks=64,en=1e12,vt=4,Rs=16*1024,tn=250,sn=4e3,Ke=3e4;function D(a){return a!==null&&typeof a=="object"&&!Array.isArray(a)?a:null}function V(a,t){return typeof a=="number"&&Number.isSafeInteger(a)&&a>=0&&a<=t}function Cs(a){let t=D(a);if(!t)return null;let e={};for(let[s,n]of Object.entries(t)){if(s.length===0||s.length>128||!V(n,Ms))return null;e[s]=n}return e}function nn(a){let t=D(a);if(!t||Object.keys(t).length>128)return null;let e={};for(let[s,n]of Object.entries(t)){if(s.length===0||s.length>128||!V(n,Ms))return null;e[s]=n}return e}function xs(a){return typeof a=="string"&&a.length>0&&a.length<=256?a:V(a,ue)?String(a):null}function on(a){let t=D(a),e=xs(t?.epoch);if(!t||t.schema!==yt||e===null)return null;let s=nn(t.capabilities),n=Cs(t.revisions);return!s||!n||!V(t.sequence,ue)||!V(t.coherence_generation,ue)||t.coherence_generation===0?null:{schema:t.schema,capabilities:s,epoch:e,sequence:t.sequence,coherence_generation:t.coherence_generation,revisions:n}}function Ss(a,t){let e=D(a),s=on(e?.snapshot??a);if(!s)return null;let n=D(e?.snapshot??a);if(!n||!("payload"in n))return null;let o=n.entry_id,r=D(n.identity),i=D(n.status),l=D(n.payload),c=i?i.reason===null?null:Ps(i.reason):null,d=l?.available,u=null;if(l?.entry!==void 0&&l.entry!==null){if((()=>{try{return JSON.stringify(l.entry).length}catch{return Rs+1}})()>Rs)return null;try{u=Oe({entries:[l.entry]})[0]??null}catch{return null}}let m=i?.state;return typeof o!="string"||o.length===0||o.length>128||t!==void 0&&o!==t||!r||r.entry_id!==o||r.floor_mission_id!==null&&!V(r.floor_mission_id,ue)||typeof r.floor_verified!="boolean"||r.floor_verified!==(r.floor_mission_id!==null)||!i||m!=="ready"&&m!=="stale"&&m!=="unavailable"||i.reason!==null&&c===null||typeof i.retryable!="boolean"||typeof d!="boolean"||u!==null&&u.entryId!==o||m==="ready"&&(c!==null||i.retryable||!d)||(m==="stale"||m==="unavailable")&&(c===null||d)||c==="authorization"&&i.retryable?null:{...s,entry_id:o,identity:{entry_id:o,floor_mission_id:r.floor_mission_id,floor_verified:r.floor_verified},status:{state:m,reason:c,retryable:i.retryable},payload:{available:d,entry:u}}}function Es(a){let t=D(a),e=xs(t?.epoch),s=Cs(t?.revisions),n=t?.resources;return e===null||!s||!V(t?.sequence,ue)||!V(t?.coherence_generation,ue)||t.coherence_generation===0||!Array.isArray(n)||n.length>128||!n.every(o=>typeof o=="string"&&o.length<=128)?null:{epoch:e,sequence:t.sequence,coherence_generation:t.coherence_generation,revisions:s,resources:n}}var Ue=["gap","overflow","reconnect","invalid_message","server_request","restart","entry_removed","authorization","snapshot_required"];function Ps(a){return typeof a=="string"&&Ue.includes(a)?a:null}function rn(a){let t=D(a);return t?.name==="AbortError"?"aborted":t?.name==="TimeoutError"?"timedOut":"failed"}function an(){return Object.fromEntries(Ue.map(a=>[a,new de]))}var Ve=class{#e;#t;#n;#o=null;#a=!1;#i=!1;#r=!1;#s=!1;#u=!1;#y=!1;#c=0;#b=!1;#k=!1;#g=!1;#m=!1;#d=null;#f=null;#I=0;#$=!1;#S=null;#w=-1;#h=new Map;#T=!1;#D=!1;#q=null;#l=[];#z=new de;#R=an();#C=null;#v=null;#W=null;constructor(t,e){this.#e=t,this.#t=e,this.#n=Math.max(1,Math.min(ks,e.maxPendingInvalidations??ks))}async start(){if(!(this.#a||this.#D)){this.#D=!0;try{await this.#B(!1)}catch(t){this.#oe(t),this.#_("reconnect")}}}notifyReconnect(){(this.#s||this.#y)&&(this.#U(),this.#J("aborted"),this.#c+=1),this.#I=0,this.#b=!1,this.#s=!1,this.#u=!1,this.#d!==null&&window.clearTimeout(this.#d),this.#d=null,this.requestResync("reconnect"),this.#r&&this.#x(0,!0)}requestResync(t="server_request"){this.#_(t,!0)}diagnostics(){let t=Object.fromEntries(Ue.map(s=>[s,this.#R[s].snapshot()])),e=this.#v!==null&&this.#W!==null?Object.freeze({reason:this.#v,durationMs:Math.round(Math.min(en,Math.max(0,performance.now()-this.#W))*100)/100}):null;return Object.freeze({snapshotAttempts:this.#z.snapshot(),recoveryEpisodes:Object.freeze(t),activeRecovery:e})}dispose(){if(!this.#a){this.#a=!0,this.#d!==null&&window.clearTimeout(this.#d),this.#d=null,this.#r=!1,this.#o?.(),this.#o=null,this.#h.clear(),this.#l=[],this.#C=null,this.#v=null,this.#W=null,this.#z.dispose();for(let t of Ue)this.#R[t].dispose()}}#p(t){if(this.#a)return;let e=D(t),s=D(e?.event)??e,n=s?.type;if(n==="resync"){let r=Ps(s?.reason);if(!r){this.#_("invalid_message");return}if(r==="entry_removed"){this.#t.onEvent({type:"resync",reason:r}),this.dispose();return}this.#_(r);return}if(this.#s){if(n==="invalidate"){let r=Es(s?.invalidation??s);r?this.#F(r):(this.#l=[],this.#$=!0)}return}let o=n==="snapshot"?Ss(s?.snapshot??s,this.#t.entryId):n==="invalidate"?Es(s?.invalidation??s):null;if(!o){this.#_("invalid_message");return}if(n==="snapshot"){let r=o;if(this.#r)return;if(this.#S!==null&&r.epoch!==this.#S){this.#_("restart");return}this.#V(r);return}this.#X(o)}#V(t){this.#S===t.epoch&&t.sequence<this.#w||(this.#S=t.epoch,this.#w=t.sequence,this.#h.clear(),this.#t.onEvent({type:"snapshot",snapshot:t}))}#A(t){let e=this.#l;if(this.#l=[],this.#V(t),this.#a)return;let s=t.sequence+1;for(let n of e)if(n.epoch===t.epoch&&!(n.sequence<=t.sequence)&&!(n.sequence<s)){if(n.sequence!==s){this.#l=e.filter(o=>o.epoch===t.epoch&&o.sequence>=s),this.#_("gap");return}this.#X(n),s+=1}}#X(t){if(this.#r){this.#F(t);return}if(this.#S===null){this.#F(t);return}if(this.#S!==t.epoch){this.#F(t),this.#_("reconnect");return}if(!(t.sequence<=this.#w)){if(t.sequence!==this.#w+1){this.#F(t),this.#_("gap");return}this.#w=t.sequence;for(let e of t.resources)this.#h.set(e,t);if(this.#h.size>this.#n){this.#h.clear(),this.#_("overflow");return}this.#T||(this.#T=!0,queueMicrotask(()=>this.#ae()))}}#F(t){this.#l.length>=this.#n?(this.#l=[],this.#$=!0,this.#_("overflow")):this.#l.push(t)}#ae(){if(this.#T=!1,this.#a||this.#s||this.#h.size===0){this.#s&&this.#h.clear();return}let t=[...this.#h.values()];this.#h.clear();let e=t.reduce((n,o)=>!n||o.sequence>n.sequence?o:n,null);if(!e)return;let s=[...new Set(t.flatMap(n=>n.resources))];this.#t.onEvent({type:"invalidation",invalidation:{...e,resources:s}})}#_(t,e=!1){if(!this.#a){if(t==="authorization"){this.#O(),this.#t.onEvent({type:"resync",reason:t});return}if(!this.#s&&(this.#H(t),this.#i||(this.#i=!0,this.#t.onEvent({type:"resync",reason:t}),queueMicrotask(()=>{this.#i=!1})),t!=="entry_removed")){let s=e&&!this.#b;if(s&&(this.#b=!0),s&&this.#d!==null&&(window.clearTimeout(this.#d),this.#d=null),this.#g){if(this.#m){s&&this.#x(0,!0);return}this.#m=!0,this.#j(s);return}if(e&&this.#r){s&&(this.#k=!0);return}let n=this.#I>=vt?Ke:0;this.#x(s?0:n,s)}}}#x(t,e=!1){if(!this.#a){if(this.#d!==null){if(!e)return;window.clearTimeout(this.#d),this.#d=null}if(this.#r){this.#f=e?t:Math.max(this.#f??0,t);return}this.#d=window.setTimeout(()=>{this.#d=null,this.#B(!0)},t)}}#j(t=!1){let e=this.#I>=vt?Ke:Math.min(tn*2**this.#I,sn);this.#I<vt&&(this.#I+=1),this.#x(t?0:e,t)}async#B(t,e=!1){if(this.#a||this.#r)return;t&&this.#H(e?"authorization":"snapshot_required");let s=this.#c;this.#r=!0,this.#y=e;try{if(t&&await this.#N(),this.#a||this.#s&&!e||s!==this.#c)return;let n={startedAt:performance.now(),generation:s};this.#C=n;let o="completed",r;try{r=await this.#e.sendMessagePromise({type:"matic_robot/workspace_snapshot",version:yt,entry_id:this.#t.entryId})}catch(c){throw o=rn(c),c}finally{this.#K(n,o)}if(this.#a||this.#s&&!e||s!==this.#c)return;let i=Ss(r,this.#t.entryId);if(!i)throw new Error("invalid-workspace-snapshot");if(i.status.reason==="authorization"){this.#O(),this.#t.onEvent({type:"snapshot",snapshot:i});return}if(i.status.state!=="ready"&&i.status.retryable)throw new Error("workspace-snapshot-retryable");e&&(this.#s=!1,this.#u=!1,this.#d!==null&&window.clearTimeout(this.#d),this.#d=null),this.#r=!1,this.#g=!0,this.#m=!1;try{t?this.#G(i):this.#A(i)}finally{this.#g=!1}let l=this.#m||this.#$;this.#m?this.#k&&(this.#k=!1,this.#x(0,!0)):(this.#I=0,this.#b=!1,this.#k=!1),!t&&!this.#a&&await this.#N(),this.#$&&(this.#$=!1,this.#_("overflow")),t&&i.status.state==="ready"&&!l&&!this.#a&&s===this.#c&&this.#J("completed")}catch(n){if(this.#a||this.#s&&!e||s!==this.#c)return;if(this.#oe(n),this.#Q(n))this.#O(),this.#t.onEvent({type:"resync",reason:"authorization"});else if(!e){t||this.#H("reconnect");let o=this.#k;this.#k=!1,this.#j(o)}}finally{this.#r=!1,this.#y=!1,this.#u?(this.#u=!1,this.#ne(0)):e&&this.#s&&this.#ne(Ke);let n=this.#f;this.#f=null,n!==null&&this.#x(n)}}async#N(){if(this.#a||this.#o)return;if(this.#q)return this.#q;let t=(async()=>{let e=await this.#e.subscribeMessage(s=>this.#p(s),{type:"matic_robot/workspace_subscribe",version:yt,entry_id:this.#t.entryId});this.#a?e():this.#o=e})();this.#q=t;try{await t}finally{this.#q===t&&(this.#q=null)}}#G(t){let e=this.#l;if(this.#l=[],this.#S===t.epoch&&t.sequence<this.#w){this.#l=e,this.#_("snapshot_required");return}if(this.#V(t),this.#a)return;let s=t.sequence+1;for(let n of e)if(n.epoch===t.epoch&&!(n.sequence<=t.sequence)&&!(n.sequence<s)){if(n.sequence!==s){this.#l=e.filter(o=>o.sequence>=s),this.#_("gap");return}this.#X(n),s+=1}}#Q(t){let e=D(t),s=e?.code,n=e?.status??e?.statusCode;return s==="unauthorized"||s==="not_authorized"||s==="auth_invalid"||n===401||n===403}#H(t){this.#v!==null||this.#a||(this.#v=t,this.#W=performance.now())}#J(t){let e=this.#v,s=this.#W;this.#v=null,this.#W=null,!(e===null||s===null||this.#a)&&this.#R[e].record(t,performance.now()-s)}#K(t,e){this.#C!==t||this.#a||t.generation!==this.#c||(this.#C=null,this.#z.record(e,performance.now()-t.startedAt))}#U(){let t=this.#C;t!==null&&(this.#C=null,!this.#a&&t.generation===this.#c&&this.#z.record("aborted",performance.now()-t.startedAt))}#O(){this.#U(),this.#J("failed"),this.#c+=1,this.#s||(this.#s=!0,this.#d!==null&&window.clearTimeout(this.#d),this.#d=null,this.#u=!1),this.#h.clear(),this.#l=[],this.#$=!1,this.#f=null,this.#I=0,this.#b=!1,this.#k=!1,this.#y||this.#ne(Ke)}#ne(t){this.#a||this.#d!==null||this.#u||(this.#d=window.setTimeout(()=>{if(this.#d=null,!this.#a){if(this.#r){this.#u=!0;return}this.#B(!0,!0)}},t))}#oe(t){this.#t.onError?.(t instanceof Error?t:new Error("Workspace transport failed"))}};var je=class{#e;#t;#n=document.visibilityState!=="hidden";#o=!1;#a=!1;#i=!1;constructor({onSuspend:t,onResume:e}){this.#e=t,this.#t=e}get active(){return this.#n}start(){this.#o||this.#a||(this.#o=!0,window.addEventListener("pagehide",this.#r),window.addEventListener("pageshow",this.#s),document.addEventListener("visibilitychange",this.#u),document.visibilityState==="hidden"&&(this.#n?this.#c(!1):this.#e()))}dispose(){this.#a||(this.#a=!0,this.#o&&(window.removeEventListener("pagehide",this.#r),window.removeEventListener("pageshow",this.#s),document.removeEventListener("visibilitychange",this.#u)))}#r=()=>{this.#i=!0,this.#c(!1)};#s=t=>{if(this.#i=!1,t.persisted){document.visibilityState==="hidden"?this.#c(!1):(this.#c(!1),this.#c(!0));return}this.#y()};#u=()=>{this.#y()};#y(){if(this.#i||document.visibilityState==="hidden"){this.#c(!1);return}this.#c(!0)}#c(t){this.#n===t||this.#a||(this.#n=t,t?this.#t():this.#e())}};var p=(a,t,e=null)=>({status:a,value:t,problem:e}),Me=a=>a.status==="loading"?p("idle",a.value):a,O=a=>a instanceof DOMException&&a.name==="AbortError",H=(a,t)=>a instanceof P||a&&typeof a=="object"&&"code"in a&&typeof a.code=="string"?a.code:t,x={stopUnconfirmed:E("error","v4_notice_stop_unconfirmed","Home Assistant can't confirm the robot stopped, so press Stop again if it's still moving."),actionUnconfirmed:E("error","v4_notice_action_unconfirmed","Home Assistant can't confirm that command, so check the robot before trying again."),mapChanged:E("info","v4_notice_map_changed","The map changed, so choose what to clean again."),statusRefreshed:E("info","v4_notice_status_refreshed","Status refreshed, so check the robot before trying again."),saving:E("info","v4_notice_saving","Saving\u2026"),planSaved:E("success","v4_notice_plan_saved","Plan saved"),planSaveFailed:E("error","v4_notice_plan_save_failed","Home Assistant can't confirm the plan was saved, so check your plans, then try again."),planDeleted:E("success","v4_notice_plan_deleted","Plan deleted"),planDeleteFailed:E("error","v4_notice_plan_delete_failed","The plan wasn't deleted; try again."),planPreviewMissing:E("warning","v4_notice_plan_preview_missing","The next-run preview isn't ready; reload your plans, then try again."),planPreviewRefreshFailed:E("warning","v4_notice_plan_preview_refresh_failed","The next-run preview didn't refresh; check the plan, then try again."),planPreviewNone:E("warning","v4_notice_plan_preview_none","This plan has no next-run preview; review its rooms and schedules."),planPreviewChanged:E("info","v4_notice_plan_preview_changed","The next run changed; check it before you run the plan."),roomPreviewBlocked:E("warning","v4_notice_room_preview_blocked","A room can't use these settings, so check the note above the rooms."),roomPreviewChanged:E("info","v4_notice_room_preview_changed","The room settings changed, so check them and start again."),roomPreviewFailed:E("warning","v4_notice_room_preview_failed","Home Assistant couldn't check the room settings, so try starting again."),areaRemoved:E("warning","v4_notice_area_removed","This saved Area was removed elsewhere. Your edits are preserved as a new Area draft; saving will create a new Area."),areaSaving:E("info","v4_notice_area_saving","Saving area\u2026"),areaSaved:E("success","v4_notice_area_saved","Area saved"),areaSaveFailed:E("error","v4_notice_area_save_failed","Home Assistant can't confirm the area was saved, so try again."),areaDeleted:E("success","v4_notice_area_deleted","Area deleted"),areaDeleteFailed:E("error","v4_notice_area_delete_failed","Home Assistant can't confirm the area was deleted, so try again."),resetMop:E("success","v4_notice_reset_mop","Mopping progress reset"),resetVacuum:E("success","v4_notice_reset_vacuum","Vacuum rotation progress reset"),resetMopFailed:E("error","v4_notice_reset_mop_failed","Mopping progress wasn't reset; try again."),resetVacuumFailed:E("error","v4_notice_reset_vacuum_failed","Vacuum rotation progress wasn't reset; try again.")},ln=a=>E("warning","v4_notice_saved_map","Showing the saved map from {date} without the robot's position.",{date:a}),Ts={coverage_identity_unavailable:E("error","v4_notice_coverage_task_unknown","Home Assistant can't confirm the current clean, so check the robot first."),coverage_activity_unavailable:E("error","v4_notice_coverage_activity_unknown","Home Assistant can't confirm whether the robot is cleaning, so check it first."),coverage_native_session_active:E("error","v4_notice_coverage_robot_busy","The robot is already cleaning, so wait for it to finish."),coverage_identity_changed:E("error","v4_notice_coverage_task_changed","The clean changed while starting, so check the robot first.")},cn=a=>a instanceof P&&Object.hasOwn(Ts,a.code)?Ts[a.code]??null:null,he=a=>[a.selectedFloorOrdinal??"none",a.mapFloorOrdinal??"none",a.mapFloorCoherent?"coherent":"transition"].join(":"),pe=a=>[a.mapFloorOrdinal??"none",a.mapSessionVerified?"verified":"unverified",a.mapSessionKey??"no-session"].join(":"),B=a=>[a.entryId,a.selectedFloorOrdinal??"none",a.mapFloorOrdinal??"none"].join("|"),T=a=>[a.entryId,he(a),pe(a)].join("|"),gt=a=>[T(a),a.mapRevision].join("|"),Ye=a=>a.runnerLocked||a.stopSettlePending||a.activePlan||a.nativeReconciliationPending||a.nativeSessionActive===!0,Xe=(a,t)=>a.entryKey===t.entryKey&&a.generation===t.generation&&a.floorKey===t.floorKey&&a.missionKey===t.missionKey,dn=1e3,un=5e3,hn=["rooms","plans","plan","draw","areaReview"],As=["plan-mutation","area-mutation"],Is=a=>JSON.stringify({...a,previewToken:void 0}),Ge=(a,t)=>a.label?a.label:a.active?"Current floor":`Saved floor ${a.ordinal??t}`,Qe=class{#e;#t;#n;#o;#a=new Fe;#i=null;#r=new Map;#s=null;#u=null;#y=null;#c=null;#b=0;#k=!1;#g=!1;#m=!1;#d=!1;#f=null;#I=Promise.resolve();#$=!1;#S=!1;#w="";#h=null;#T=0;#D=null;#q="";#l=!1;#z=!0;#R=null;#C=null;#v=null;#W=null;#p="";#V=!1;#A;#X;workspaceDiagnostics(){return this.#R?.diagnostics()??null}constructor(t,e,s=null,n){this.#e=t,this.#t=new Pt(t.value.generation),this.#n=e,this.#A=s,this.#X=n,this.#o=new je({onSuspend:()=>this.#F(),onResume:()=>{this.#ae()}}),this.#e.patch({pageActive:this.#o.active}),this.#W=t.subscribe(o=>{this.#_(o),this.#N()}),this.#o.start()}#F(){this.#K(!1,As),this.#Y(),this.#P(As),this.#m=!1,this.#d=!1,this.#f=null,this.#S=!1,this.#Se();let t=this.#e.value;this.#e.patch({resources:{...t.resources,catalog:Me(t.resources.catalog),scene:Me(t.resources.scene),history:Me(t.resources.history),plans:Me(t.resources.plans),areas:Me(t.resources.areas),pose:p("idle",null)}})}async#ae(){if(this.#l||!this.#o.active)return;this.#e.patch({pageActive:!0});let t=this.#s;if(this.#l||!this.#o.active||!t?.host.connected||!t.host.administrator||!t.host.robotConnected||t.host.robotCount===0)return;let e=this.#e.value;this.#he(),this.#Q(t),await this.refreshCatalog(!0,!0);let s=this.#e.value,n=s.resources.entry;if(this.#l||!this.#o.active||e.dataMode!=="history"||s.generation!==e.generation||s.dataMode!=="history"||s.selection.entryId!==e.selection.entryId||s.selection.floorId!==e.selection.floorId||s.selection.historyId!==e.selection.historyId||s.resources.catalog.status!=="ready"||!n||n.entryId!==s.selection.entryId)return;let o=s.resources.history.value?.floors.find(u=>u.id===s.selection.floorId),r=o?.snapshots.find(u=>u.id===s.selection.historyId);if(!o)return;let i=this.#t.begin(n.entryId,o.id,r?.id??o.id,r?.revision??0);if(this.#e.patch({generation:i.generation}),await this.#ie(n,i),!this.#t.accepts(i)||!this.#o.active||this.#e.value.resources.history.status!=="ready")return;let l=this.#e.value,c=l.resources.history.value?.floors.find(u=>u.id===o.id),d=c?.snapshots.find(u=>u.id===r?.id);!c||r&&!d||(d&&d.revision!==i.revision&&(i=this.#t.begin(n.entryId,o.id,d.id,d.revision)),this.#e.patch({generation:i.generation,coherence:"current"}),d&&(!l.resources.scene.value||d.revision!==r?.revision)&&await this.#ue(d,i))}#_(t){if(!t.owner)return;let e={version:4,view:t.view,appearance:t.appearance,labels:t.labelsVisible,quality:t.quality,cameras:t.cameras},s=this.#i;this.#i=e,!(!s||s.view===e.view&&s.appearance===e.appearance&&s.labels===e.labels&&s.quality===e.quality&&s.cameras===e.cameras)&&this.#a.schedule(e)}#x(t){let e=Ct(t),s=t.resources.entry,n=this.#s?.vacuumEntityId;if(!e||!s||!n||!t.selection.entryId||t.workflow!=="rooms"||t.dataMode!=="live"||t.floor.readOnly||t.coherence!=="current"||!t.host.connected||!t.host.administrator||!t.host.robotConnected||t.command!=="idle"||t.resources.plans.status!=="ready")return null;let o=t.selection.roomIds.map(r=>{let i=t.selection.roomSettings.find(l=>l.roomId===r);return i?{room:r,cleaning_mode:i.cleaningMode,coverage_setting:i.coverageSetting}:null});return o.some(r=>r===null)?null:{key:e,generation:t.generation,retryRevision:t.manualRoomPreviewRetry,floorKey:he(s),missionKey:pe(s),entryId:t.selection.entryId,entityId:n,rooms:o,overrideRoomSchedule:!t.selection.useRoomSchedule}}#j(t){return JSON.stringify([t.key,t.generation,t.retryRevision,t.floorKey,t.missionKey,t.entryId,t.entityId])}#B(t){let e=this.#x(this.#e.value);return!this.#l&&e!==null&&this.#j(e)===this.#j(t)}#N(){if(this.#l||!this.#s)return;let t=this.#e.value,e=this.#x(t);if(!e){this.#r.get("room-preview")?.abort(),this.#r.delete("room-preview"),this.#p="",(t.manualRoomPreview.status!=="idle"||t.manualRoomPreview.value!==null)&&this.#e.patch({manualRoomPreview:p("idle",null)});return}let s=this.#j(e),n=st(t);if(n&&n.key===e.key&&n.generation===e.generation&&n.floorKey===e.floorKey&&n.missionKey===e.missionKey&&n.preview.entryId===e.entryId){this.#p=s;return}if(this.#p===s)return;this.#r.get("room-preview")?.abort(),this.#p=s;let o=this.#E("room-preview");this.#e.patch({manualRoomPreview:p("loading",null)}),this.#G(e,o)}async#G(t,e){try{let s=await this.#n.previewRoomSequence(t.entityId,t.rooms,t.overrideRoomSchedule,e.signal);return!this.#B(t)||e.signal.aborted||s.entryId!==t.entryId?null:(this.#e.patch({manualRoomPreview:p("ready",{key:t.key,generation:t.generation,floorKey:t.floorKey,missionKey:t.missionKey,preview:s})}),s)}catch(s){return O(s)||e.signal.aborted||!this.#B(t)||this.#e.patch({manualRoomPreview:p("error",null,H(s,"preview-unavailable"))}),null}finally{this.#M("room-preview",e)}}sync(t){if(this.#l)return;let e=this.#R,s=this.#s?.host.robotConnected??null,n=this.#s?.host.administrator===!1&&t.host.administrator,o=this.#s!==null&&!this.#s.host.robotConnected&&t.host.robotConnected,r=this.#e.value.owner,i=r!==null&&(r.entryKey!==t.entryKey||r.userKey!==t.userKey);i&&(this.#ee("context-changed",t.entryKey),this.#k&&(this.#m=!0,this.#d=!1,this.#f=null));let l=this.#z;this.#z=t.host.connected,this.#s=t,this.#Q(t),o&&e&&e===this.#R&&e.notifyReconnect();let c=t.userKey!==this.#q?this.#a.load(t.userKey):null;if(c&&(this.#q=t.userKey,this.#i=c),this.#e.patch({owner:{userKey:t.userKey,entryKey:t.entryKey},host:t.host,activity:t.activity,batteryPercent:t.batteryPercent,robotLabel:t.robotLabel,robots:t.robots,locale:t.language,selection:{...this.#e.value.selection,entryId:t.entryKey},...c?{view:c.view,appearance:c.appearance,labelsVisible:c.labels,quality:c.quality,cameras:c.cameras}:{}}),!t.host.administrator){this.#Y(),this.#ee("access-required",t.entryKey);return}if(!t.host.connected){l&&(this.#e.patch({generation:this.#t.invalidate()}),this.#O(),this.#w=""),this.#Y(),this.#m=!1,this.#d=!1,this.#f=null,this.#S=!1,this.#P();let d=this.#e.value,u=d.resources.scene.value;this.#e.patch({coherence:u?"degraded":"unavailable",resources:{...d.resources,catalog:d.resources.catalog.status==="loading"?p("idle",d.resources.catalog.value):d.resources.catalog,plans:d.resources.plans.status==="loading"?p("idle",d.resources.plans.value):d.resources.plans,areas:d.resources.areas.status==="loading"?p("idle",d.resources.areas.value):d.resources.areas,pose:p("idle",null)},map:{...d.map,available:u!==null,exactPose:!1}});return}if(t.host.robotCount===0){this.#Y(),this.#ee("map-unavailable",t.entryKey);return}if(t.entryKey&&!t.vacuumEntityId){this.#Y(),this.#ee("no-loaded-robot",t.entryKey);return}if(!t.host.robotConnected){s!==!1&&(this.#K(),this.#P(),this.#m=!1,this.#d=!1,this.#f=null,this.#S=!1),this.#Y();let d=this.#e.value,u=d.resources.scene.value;this.#e.patch({coherence:u?"degraded":"unavailable",resources:{...d.resources,catalog:d.resources.catalog.status==="loading"?p("idle",d.resources.catalog.value):d.resources.catalog,scene:d.resources.scene.status==="loading"?p("idle",u):d.resources.scene,pose:p("idle",null)},map:{...d.map,available:u!==null,exactPose:!1}});return}if(this.#o.active){if(this.#he(),!l||o||n){this.refreshCatalog(!0,!0);return}(i||this.#e.value.resources.catalog.status==="idle"||t.entryKey&&t.entryKey!==this.#e.value.selection.entryId)&&this.refreshCatalog(!0)}}#Q(t){let e=t.entryKey,s=this.#e.value,n=s.resources.catalog.value?.find(l=>l.entryId===e),o=s.resources.entry;if(!(this.#X??!!(n?.liveWorkspaceTransportEnabled&&o?.entryId===e&&o.liveWorkspaceTransportEnabled))||!this.#A||!t.host.administrator||!t.host.connected||!t.vacuumEntityId||!e||!this.#o.active){this.#Se();return}if(this.#R&&this.#C===e)return;this.#R?.dispose(),this.#v=null;let i=new Ve(this.#A,{entryId:e,onEvent:l=>{if(!(this.#l||!this.#o.active||this.#R!==i||this.#C!==e||this.#s?.entryKey!==e)){if(l.type==="resync"&&l.reason==="entry_removed"){i.dispose(),this.#R===i&&(this.#R=null,this.#C=null,this.#v=null);return}if(l.type==="snapshot"){let{snapshot:c}=l,d=this.#e.value.resources.entry,u=c.payload.entry;if(c.entry_id!==e||c.identity.entry_id!==e)return;if(u&&(u.entryId!==e||c.identity.floor_verified!==(u.mapFloorCoherent&&u.mapSessionVerified))){i.requestResync("invalid_message");return}let m=!u&&d?.entryId===e&&c.identity.floor_verified!==(d.mapFloorCoherent&&d.mapSessionVerified);if(c.status.reason==="authorization"){this.#v=null,this.#U(e,["plans","areas","history"]);return}let h=this.#v,f=[],w=h!==null&&h.epoch!==c.epoch;if(h&&h.epoch===c.epoch){let k=new Set([...Object.keys(h.revisions),...Object.keys(c.revisions)]),v=[...k].some(g=>(c.revisions[g]??-1)<(h.revisions[g]??-1));if(c.coherence_generation<h.coherenceGeneration||c.coherence_generation===h.coherenceGeneration&&v){i.requestResync("restart");return}f=[...k].filter(g=>(c.revisions[g]??-1)>(h.revisions[g]??-1))}w&&(f=["plans","areas","history"]);let y=h!==null&&(h.epoch!==c.epoch||h.coherenceGeneration!==c.coherence_generation),_=!!(d&&u&&d.entryId===e&&T(d)!==T(u));if(this.#v={entryId:c.entry_id,epoch:c.epoch,sequence:c.sequence,coherenceGeneration:c.coherence_generation,revisions:c.revisions},m){this.#U(e,["plans","areas","history"]);return}if(y||_){this.#U(e,f);return}let M=u!==null&&d?.entryId===e&&this.#J(u);if(h&&f.length){if(c.sequence<=h.sequence){i.requestResync("invalid_message");return}this.#v=h,this.#H({epoch:c.epoch,sequence:c.sequence,coherence_generation:c.coherence_generation,revisions:c.revisions,resources:f},e,i,M)}return}if(l.type==="resync"){this.#v=null,l.reason!=="authorization"&&this.#U(e,["plans","areas","history"]);return}this.#H(l.invalidation,e,i)}}});this.#R=i,this.#C=e,i.start()}#H(t,e,s,n=!1){let o=this.#v;if(!o||o.entryId!==e||this.#R!==s||t.epoch!==o.epoch||t.sequence<=o.sequence)return;let r=t.coherence_generation!==o.coherenceGeneration,l=[...new Set([...Object.keys(o.revisions),...Object.keys(t.revisions)])].some(h=>(t.revisions[h]??-1)<(o.revisions[h]??-1));if(t.coherence_generation<o.coherenceGeneration||!r&&l){s.requestResync("restart");return}let c=new Set(t.resources),d=[...c].some(h=>(t.revisions[h]??-1)>(o.revisions[h]??-1));if(this.#v={...o,sequence:t.sequence,coherenceGeneration:t.coherence_generation,revisions:t.revisions},!d&&!r)return;if(r){this.#U(e,t.resources);return}c.has("scene")&&c.delete("scene");let u=this.#e.value.resources.entry,m=this.#t.current();!u||u.entryId!==e||!m||c.size&&this.#oe(u,m,c,!n)}#J(t){let e=this.#e.value,s=e.resources.entry;if(!s||T(s)!==T(t))return!1;let n=t.mapRevision===s.mapRevision?t:{...t,mapRevision:s.mapRevision},o=e.resources.catalog,r=o.value?.map(u=>u.entryId===n.entryId?n:u),i=n.mapFloorCoherent&&n.mapSessionVerified,l=n.health==="problem"||n.health==="limited",c=this.#h,d=c?.key===T(n)&&this.#fe(c)&&(c.attempt!==null||c.retryTimer!==null);return this.#e.patch({managedLock:Ye(n),coherence:d?"verifying":i?l?"degraded":"current":"verifying",map:{...e.map,available:e.resources.scene.value!==null,complete:n.mapComplete&&!n.mapTruncated,floorCoherent:n.mapFloorCoherent,sessionVerified:n.mapSessionVerified,exactPose:i&&!d?e.map.exactPose:!1},floor:{...e.floor,classifiedCount:Math.max(1,n.historyFloorCount),...d&&e.resources.scene.value?{readOnly:!0}:{}},resources:{...e.resources,entry:n,...r?{catalog:{...o,value:r}}:{}}}),this.#s&&this.#Q(this.#s),!0}#K(t=this.#e.value.pageActive,e=[]){let s=this.#t.invalidate();this.#O();let n=this.#e.value;this.#e.patch({generation:s,pageActive:t,coherence:n.resources.scene.value?"verifying":"unavailable",floor:{...n.floor,readOnly:n.floor.readOnly||n.resources.scene.value!==null},map:{...n.map,exactPose:!1}}),this.#h&&this.#pe(this.#h.key),this.#P(["catalog",...e]),this.#w=""}#U(t,e=[]){this.#L(),this.#K(),this.refreshCatalog(!0,!0).then(()=>{if(this.#l||this.#s?.entryKey!==t||!this.#s.host.administrator||!this.#s.host.connected)return;let s=this.#e.value.resources.entry,n=this.#t.current();if(!s||s.entryId!==t||!n)return;let o=new Set(e);o.delete("history"),this.#oe(s,n,o,!1)})}#O(){this.#T+=1,this.#D=null}#ne(t){let e=this.#D,s=this.#t.current();return!!(e&&s&&e.generation===this.#T&&e.stamp.generation===s.generation&&e.entryId===t.entryId&&e.coherenceIdentity===T(t)&&e.deltaUrl===t.deltaUrl&&s.entryKey===t.entryId&&s.floorKey===he(t)&&s.missionKey===pe(t)&&t.mapFloorCoherent&&t.mapSessionVerified&&this.#e.value.dataMode==="live"&&this.#e.value.selection.floorId==="current"&&this.#s?.host.connected&&this.#s.host.robotConnected&&this.#s.host.administrator)}#oe(t,e,s,n=!0){(s.has("plans")||s.has("plan_state"))&&this.loadPlans(),s.has("areas")&&this.loadAreas(),s.has("history")&&this.#ie(t,e),n&&["status","robot_state","activity","plan_state"].some(o=>s.has(o))&&this.refreshCatalog(!0,!0,!0)}#he(){this.#o.active&&(this.#u===null&&(this.#u=window.setInterval(()=>{this.refreshCatalog()},5e3)),this.#y===null&&(this.#y=window.setInterval(()=>{this.refreshPose()},dn)))}#Y(){this.#u!==null&&window.clearInterval(this.#u),this.#y!==null&&window.clearInterval(this.#y),this.#u=null,this.#y=null,this.#L()}#L(){let t=this.#h;if(this.#h=null,!t)return;t.attempt?.finishReplacementRead?.(),t.attempt&&(t.attempt.finishReplacementRead=null),t.retryTimer!==null&&window.clearTimeout(t.retryTimer);let e=t.attempt?.controller,s=!!(e&&e===this.#r.get("catalog")&&this.#e.value.resources.catalog.status==="loading");if(e?.abort(),s){let n=this.#e.value.resources;this.#e.patch({resources:{...n,catalog:p("idle",n.catalog.value)}})}this.#f?.state===t&&(this.#m=!1,this.#d=!1,this.#f=null)}#re(t,e){let s=this.#h;s?.key===T(e)&&(s.failedKinds.delete(t),t==="delta"&&this.#Z(e),s.failedKinds.size===0&&this.#L())}#Z(t){this.#pe(T(t))}#pe(t){let e=this.#h;e?.key===t&&(e.attempt?.finishReplacementRead?.(),e.attempt&&(e.attempt.finishReplacementRead=null))}#me(t,e){let s=T(e),n=this.#h;n?.key!==s&&(this.#L(),n={key:s,failedKinds:new Set,retryTimer:null,attempt:null},this.#h=n),n.failedKinds.add(t),t==="delta"&&this.#Z(e),this.#fe(n)&&this.#t.current()&&this.#K(),!n.attempt&&n.retryTimer===null&&(n.failedKinds.size===1&&n.failedKinds.has(t)?this.#we(n):this.#le(n))}#fe(t){let e=this.#e.value;return t.failedKinds.has("pose")||e.floor.readOnly||!e.map.floorCoherent||!e.map.sessionVerified}#le(t){t.retryTimer!==null||t.failedKinds.size===0||(t.retryTimer=window.setTimeout(()=>{t.retryTimer=null;let e=this.#e.value.resources.entry,s=this.#s?.host;if(this.#h!==t||this.#l||!e||T(e)!==t.key||this.#e.value.dataMode!=="live"||this.#e.value.selection.floorId!=="current"||!s?.connected||!s.administrator||!s.robotConnected||s.robotCount===0){this.#h===t&&this.#L();return}this.#we(t)},un))}async#we(t){if(this.#l||this.#h!==t||t.attempt)return;let e=this.#e.value.resources.entry,s=this.#s?.host;if(!e||T(e)!==t.key||this.#e.value.dataMode!=="live"||this.#e.value.selection.floorId!=="current"||!s?.connected||!s.administrator||!s.robotConnected||s.robotCount===0){this.#h===t&&this.#L();return}if(this.#r.has("scene")){this.#le(t);return}let n=this.#fe(t);n?this.#t.current()&&this.#K():(this.#O(),this.#r.get("delta")?.abort());let o,r=new Promise(c=>{o=c}),i={generation:this.#t.generation,controller:null,replacementRead:r,finishReplacementRead:o};t.attempt=i;let l={state:t,attempt:i};try{await this.refreshCatalog(!0,!1,!n,l),t.failedKinds.has("delta")&&this.#h===t&&t.attempt===i&&await i.replacementRead}finally{if(this.#h!==t||t.attempt!==i)return;i.finishReplacementRead=null,t.attempt=null,t.failedKinds.size>0&&this.#le(t)}}#ce(t){let e=this.#e.value,s=this.#s?.host;return!this.#l&&this.#o.active&&this.#h===t.state&&t.state.attempt===t.attempt&&t.attempt.generation===this.#t.generation&&e.generation===this.#t.generation&&e.dataMode==="live"&&e.selection.floorId==="current"&&e.resources.entry!==null&&T(e.resources.entry)===t.state.key&&!!(s?.connected&&s.administrator&&s.robotConnected&&s.robotCount>0)}#E(t){this.#r.get(t)?.abort();let e=new AbortController;return this.#r.set(t,e),e}#M(t,e){this.#r.get(t)===e&&this.#r.delete(t)}#P(t=[]){let e=!1;for(let[s,n]of this.#r)t.includes(s)||(e||=s==="plan-mutation"||s==="area-mutation"||s==="plan-preflight",n.abort(),this.#r.delete(s));e&&this.#e.value.command==="pending"&&this.#e.patch({command:"idle",notice:null})}#ve(){this.#b+=1,this.#c!==null&&window.clearTimeout(this.#c),this.#c=null}#ee(t,e=null){this.#L(),this.#ve(),this.#t.invalidate(),this.#O(),this.#w="";let s=this.#t.generation;this.#P();let n=this.#e.value,o=L();this.#e.patch({command:"idle",dataMode:o.dataMode,floor:o.floor,managedLock:!1,workflow:"none",dialog:null,notice:null,draftFloorOrdinal:null,draw:o.draw,planDraft:o.planDraft,areaDraft:o.areaDraft,generation:s,coherence:n.host.administrator?"unavailable":"blocked",fullMap:!1,precisionOpen:!1,resources:{catalog:p("error",null,t),entry:null,scene:p("idle",null),pose:p("idle",null),history:p("idle",null),plans:p("idle",null),areas:p("idle",null)},manualRoomPreview:p("idle",null),map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1},selection:{...o.selection,entryId:e,entrySource:n.selection.entrySource,floorId:"current",historyId:null}})}async refreshCatalog(t=!1,e=!1,s=!1,n=null){if(this.#l||!this.#o.active||!this.#s?.host.administrator||!this.#s.host.connected||this.#s.host.robotCount===0||n&&(!this.#s.host.robotConnected||!this.#ce(n)))return;if(this.#k)return t&&(this.#g?e&&(this.#m?this.#d&&=s:this.#d=s,this.#m=!0):(this.#m?this.#d&&=s:this.#d=s,this.#m=!0,this.#r.get("catalog")?.abort()),n&&(this.#m?this.#d&&=s:this.#d=s,this.#f=n,this.#m=!0)),this.#I;this.#k=!0,this.#g=t;let o;this.#I=new Promise(l=>{o=l});let r=this.#E("catalog");n&&(n.attempt.controller=r);let i=this.#e.value.resources.catalog.value;this.#e.patch({resources:{...this.#e.value.resources,catalog:p("loading",i)}});try{let l=await this.#n.catalog(r.signal);if(r.signal.aborted||this.#l||n&&!this.#ce(n))return;let c=this.#s?.entryKey,d=c?l.find(y=>y.entryId===c)??null:l[0]??null,u=this.#e.value.resources.entry;if(d&&this.#h?.key===T(d)&&(this.#h.attempt!==null||this.#h.retryTimer!==null)&&(!n||!this.#ce(n))){this.#e.patch({managedLock:Ye(d),resources:{...this.#e.value.resources,catalog:p(l.length?"ready":"empty",l),entry:u}});return}let m=!!(d&&u&&T(d)===T(u)&&this.#ne(u));if(d&&u&&B(d)===B(u)&&he(d)===he(u)&&pe(d)===pe(u)&&(m||d.mapRevision<u.mapRevision||!t&&this.#r.has("scene"))&&(d={...d,mapRevision:u.mapRevision}),this.#e.patch({managedLock:d?Ye(d):!1,resources:{...this.#e.value.resources,catalog:p(l.length?"ready":"empty",l),entry:d}}),this.#s&&this.#Q(this.#s),!d){this.#ee("no-loaded-robot",this.#s?.entryKey??null);return}if(this.#e.value.selection.floorId!=="current"||this.#e.value.dataMode!=="live"){n&&this.#Z(d);return}let h=gt(d),f=this.#t.current(),w=!!(f&&u&&T(d)===T(u)&&d.mapFloorCoherent&&d.mapSessionVerified);if((!t||s)&&(h===this.#w||w)){let y=this.#e.value,_=d.mapFloorCoherent&&d.mapSessionVerified,M=d.health==="problem"||d.health==="limited";this.#e.patch({coherence:_?M?"degraded":"current":"verifying",map:{...y.map,available:y.resources.scene.value!==null,complete:d.mapComplete&&!d.mapTruncated,floorCoherent:d.mapFloorCoherent,sessionVerified:d.mapSessionVerified,exactPose:_?y.map.exactPose:!1},floor:{...y.floor,classifiedCount:Math.max(1,d.historyFloorCount)}}),_&&this.#e.value.resources.plans.problem==="map-rechecking"&&this.loadPlans(),this.#ye();let k=f;if(k&&w&&(d.mapRevision>k.revision||n!==null)&&(d.mapRevision>k.revision&&(k=this.#t.advance(k,d.mapRevision)),k)){this.#w=h,this.#O();let v=this.#e.value.resources;this.#e.patch({resources:{...v,scene:p("loading",v.scene.value)}}),this.#se(d,k)}k&&!y.resources.scene.value&&!this.#r.has("history")&&this.#ie(d,k),_&&k&&(y.resources.scene.status==="error"||y.floor.readOnly)&&!this.#r.has("scene")&&this.#se(d,k);return}this.#w=h,this.#te(d,u)}catch(l){if(O(l)||r.signal.aborted||this.#l)return;n&&this.#pe(n.state.key),this.#e.patch({coherence:this.#e.value.resources.scene.value?"degraded":"unavailable",resources:{...this.#e.value.resources,catalog:p("error",i,H(l,"catalog-unavailable"))}})}finally{this.#M("catalog",r),n?.attempt.controller===r&&(n.attempt.controller=null),this.#k=!1;let l=this.#m,c=this.#d,d=this.#f;this.#g=!1;try{l&&!this.#l&&(this.#m=!1,this.#d=!1,this.#f=null,await this.refreshCatalog(!0,!1,c,d))}finally{o()}}}#te(t,e){this.#h!==null&&this.#h.key!==T(t)&&this.#L();let s=this.#e.value,n=!!(e&&B(e)===B(t)),o=t.mapFloorCoherent&&t.mapSessionVerified,r=s.draftMapSessionKey??(e?.mapFloorCoherent&&e.mapSessionVerified?e.mapSessionKey:null),i=s.draftFloorOrdinal??(e?.mapFloorCoherent&&e.mapSessionVerified?e.mapFloorOrdinal:null),l=o?t.mapFloorOrdinal:null,c=o?t.mapSessionKey:null,d=e!==null&&e.entryId!==t.entryId||i!==null&&l!==null&&i!==l||r!==null&&c!==null&&r!==c,u=n&&o&&i===t.mapFloorOrdinal&&r===t.mapSessionKey,m=["catalog"];n&&!d&&m.push("plans","areas"),u&&m.push("plan-mutation","area-mutation");let h=this.#t.begin(t.entryId,he(t),pe(t),t.mapRevision);this.#h?.key===T(t)&&this.#h.attempt&&(this.#h.attempt.generation=h.generation),this.#O(),this.#P(m);let f=e?.entryId===t.entryId?s.resources.scene.value:null,w=f!==null&&(s.floor.readOnly||!n||!o||e?.mapSessionKey!==t.mapSessionKey),y=s.resources.pose.value,_=n&&o&&t.mapSessionKey!==null&&y?.position&&y.mapSessionKey===t.mapSessionKey?y:null;d&&this.#ve();let M=L(),k=t.health==="problem"||t.health==="limited",v=this.#e.value;this.#e.patch({...d?{command:"idle",workflow:"none",dialog:null,precisionOpen:!1,fullMap:!1,draw:M.draw,planDraft:M.planDraft,areaDraft:M.areaDraft,notice:x.mapChanged}:{},draftFloorOrdinal:l??i,draftMapSessionKey:c??r,managedLock:Ye(t),generation:h.generation,coherence:o?k?"degraded":w?"verifying":"current":"verifying",dataMode:"live",resources:{...v.resources,entry:t,scene:p(o?"loading":"idle",f),pose:p(o?"loading":"idle",_),history:p("loading",v.resources.history.value),plans:n&&!d?v.resources.plans:p("idle",null),areas:n&&!d?v.resources.areas:p("idle",null)},map:{available:f!==null,complete:t.mapComplete&&!t.mapTruncated,floorCoherent:t.mapFloorCoherent,sessionVerified:t.mapSessionVerified,exactPose:o&&_!==null&&!w},floor:{classifiedCount:Math.max(1,t.historyFloorCount),displayName:w?s.floor.displayName:t.selectedFloorOrdinal?`Floor ${t.selectedFloorOrdinal}`:"Current floor",readOnly:w},selection:{...v.selection,entryId:t.entryId,floorId:"current",historyId:null,roomIds:d?[]:v.selection.roomIds,roomSettings:d?[]:v.selection.roomSettings,planId:d?null:v.selection.planId,areaId:d?null:v.selection.areaId}}),this.#ie(t,h),o&&this.#e.value.resources.plans.status==="idle"&&this.loadPlans(),this.#ye(),o&&(this.#se(t,h),this.#de(t,h))}async#se(t,e){if(!this.#o.active)return;let s=this.#E("scene");try{let n=await this.#n.scene(t.sceneUrl,t.mapRevision,t.mapFloorCoherent,"live",s.signal);if(!this.#t.accepts(e))return;if(!n.floorCoherent){let c=this.#e.value;this.#e.patch({coherence:"verifying",resources:{...c.resources,scene:p("error",c.resources.scene.value,"map-rechecking"),pose:p("idle",null)},map:{...c.map,available:c.resources.scene.value!==null,floorCoherent:!1,exactPose:!1},floor:{...c.floor,readOnly:c.resources.scene.value!==null}}),this.#Z(t);return}if(n.revision<e.revision||!n.scene)throw new P("scene-unavailable");let o=n.revision===e.revision?e:this.#t.advance(e,n.revision);if(!o)throw new P("scene-unavailable");let r=this.#e.value,i={...r.resources.entry??t,mapRevision:n.revision};this.#w=gt(i),this.#e.patch({coherence:i.health==="problem"||i.health==="limited"?"degraded":"current",resources:{...r.resources,entry:i,scene:p("ready",n.scene)},map:{...r.map,available:!0},floor:{...r.floor,readOnly:!1,displayName:r.resources.history.value?.floors.find(c=>c.active)?.label||(i.selectedFloorOrdinal?`Floor ${i.selectedFloorOrdinal}`:"Current floor")},notice:r.notice?.key==="v4_notice_saved_map"?null:r.notice});let l=this.#e.value.resources.plans;if((l.status==="idle"||l.problem==="map-rechecking")&&this.loadPlans(),this.#ye(),t.deltaUrl&&typeof DecompressionStream=="function"){let c=++this.#T;this.#ke(i,o,n.scene,c)}else this.#re("delta",i)}catch(n){if(O(n)||!this.#t.accepts(e))return;if(n instanceof P&&n.code==="request-timeout"){let l=this.#e.value;this.#e.patch({resources:{...l.resources,scene:p("loading",l.resources.scene.value,"scene-building")}}),window.setTimeout(()=>{this.#l||!this.#t.accepts(e)||this.#e.value.selection.floorId!=="current"||this.#se(t,e)},250);return}this.#Z(t);let o=this.#e.value,r=o.resources.pose.value,i=o.resources.scene.value!==null&&t.mapSessionKey!==null&&r?.position!==null&&r?.mapSessionKey===t.mapSessionKey;this.#e.patch({coherence:"degraded",resources:{...o.resources,scene:p("error",o.resources.scene.value,H(n,"scene-unavailable"))},map:{...o.map,available:o.resources.scene.value!==null,exactPose:i}})}finally{this.#M("scene",s)}}async#ke(t,e,s,n){if(!t.deltaUrl||typeof DecompressionStream!="function")return;let o=t.deltaUrl,r={generation:n,stamp:e,entryId:t.entryId,coherenceIdentity:T(t),deltaUrl:o};if(n!==this.#T||!this.#t.accepts(e))return;this.#D=r;let i=t,l=e,c=s;try{for(;!this.#l&&this.#o.active&&n===this.#T&&this.#t.accepts(l)&&this.#e.value.selection.floorId==="current";){let d=this.#E("delta");try{let u=await this.#n.sceneDelta(o,c,i.mapFloorCoherent,d.signal);if(d.signal.aborted||this.#l||n!==this.#T||!this.#t.accepts(l))return;if(!u.floorCoherent){let f=this.#e.value;this.#e.patch({coherence:"verifying",map:{...f.map,available:f.resources.scene.value!==null,floorCoherent:!1,exactPose:!1},floor:{...f.floor,readOnly:f.resources.scene.value!==null},resources:{...f.resources,scene:p("error",f.resources.scene.value,"map-rechecking"),pose:p("idle",null)}}),this.#me("delta",i);return}if(u.notModified||!u.scene){this.#re("delta",i),await new Promise(f=>window.setTimeout(f,100));continue}let m=this.#t.advance(l,u.revision);if(!m)return;l=m,r.stamp=m,c=u.scene,i={...i,mapRevision:u.revision},this.#re("delta",i),this.#w=gt(i);let h=this.#e.value;this.#e.patch({resources:{...h.resources,entry:i,scene:p("ready",c)},map:{...h.map,available:!0,floorCoherent:!0}}),this.#de(i,l)}finally{this.#M("delta",d)}}}catch(d){if(O(d)||this.#l||n!==this.#T||!this.#t.accepts(l))return;this.#me("delta",i)}finally{this.#D===r&&(this.#D=null)}}async#ie(t,e){if(!this.#o.active)return;let s=this.#E("history");try{let n=await this.#n.history(t.historyUrl,s.signal),o=this.#t.current();if(s.signal.aborted||!o||!Xe(e,o)||n.entryId!==t.entryId)return;let r=this.#e.value,i=n.floors.find(d=>d.id===r.selection.floorId),l=!r.selection.historyId||i?.snapshots.some(d=>d.id===r.selection.historyId),c=r.dataMode==="live"?n.floors.find(d=>d.active):i;if(this.#e.patch({resources:{...this.#e.value.resources,history:p("ready",n)},floor:{...this.#e.value.floor,classifiedCount:n.floors.length,...c&&!(r.dataMode==="live"&&r.floor.readOnly)?{displayName:Ge(c,1)}:{}}}),r.dataMode==="live"&&!r.resources.scene.value){let d=n.floors.flatMap(u=>u.snapshots.map(m=>({floor:u,snapshot:m}))).sort((u,m)=>Date.parse(m.snapshot.createdAt)-Date.parse(u.snapshot.createdAt));for(let u of d){let m;try{m=await this.#n.scene(u.snapshot.sceneUrl,u.snapshot.revision,!0,"history",s.signal)}catch(w){if(O(w)||s.signal.aborted)return;continue}let h=this.#t.current();if(s.signal.aborted||!h||!Xe(e,h)||this.#e.value.resources.scene.value)return;if(!m.scene)continue;let f=this.#e.value;this.#e.patch({floor:{...f.floor,readOnly:!0,displayName:Ge(u.floor,1)},resources:{...f.resources,scene:p("ready",m.scene),pose:p("idle",null)},map:{...f.map,available:!0,exactPose:!1},notice:ln(new Date(u.snapshot.createdAt).toLocaleString())});break}}if(r.dataMode==="history"&&(!i||!l)){let d=i||n.floors.find(m=>m.active)||n.floors[0],u=this.selectFloor(d?.id||"current");!this.#l&&r.workflow==="history"&&this.#e.dispatch({type:"open-workflow",workflow:"history"}),await u}}catch(n){let o=this.#t.current();if(O(n)||s.signal.aborted||!o||!Xe(e,o))return;this.#e.patch({resources:{...this.#e.value.resources,history:p("error",null,H(n,"history-unavailable"))}})}finally{this.#M("history",s)}}async refreshPose(){let t=this.#e.value.resources.entry,e=this.#t.current();!t||!e||this.#e.value.selection.floorId!=="current"||!t.mapFloorCoherent||!t.mapSessionVerified||await this.#de(t,e)}async#de(t,e){if(this.#l||!this.#o.active||!this.#z||!this.#s?.host.connected)return;if(this.#$){this.#S=!0;return}this.#$=!0;let s=this.#E("pose");try{let n=await this.#n.pose(t.poseUrl,s.signal),o=this.#t.current(),r=this.#e.value.resources.entry;if(!o||!Xe(e,o)||!r||!this.#e.value.map.floorCoherent)return;if(!n.floorCoherent||n.mapSessionKey===null||n.mapSessionKey!==r.mapSessionKey){this.#e.patch({resources:{...this.#e.value.resources,pose:p("idle",null)},map:{...this.#e.value.map,exactPose:!1}}),this.#me("pose",r);return}this.#re("pose",r);let i=this.#e.value,l=i.resources.pose.value,c=!!(i.map.exactPose&&l?.position&&l.mapSessionKey===r.mapSessionKey);if(n.position===null&&c){this.#e.patch({resources:{...i.resources,pose:p("ready",l)}});return}this.#e.patch({resources:{...i.resources,pose:p("ready",n)},map:{...i.map,exactPose:n.position!==null}})}catch(n){if(O(n)||!this.#t.accepts(e))return;let o=this.#e.value,r=o.resources.pose.value,i=!!(o.map.exactPose&&r?.position&&r.mapSessionKey===o.resources.entry?.mapSessionKey);this.#e.patch({resources:{...o.resources,pose:p("error",i?r:null,H(n,"pose-unavailable"))},map:{...o.map,exactPose:i}})}finally{if(this.#M("pose",s),this.#$=!1,this.#S&&!this.#l&&this.#z&&this.#s?.host.connected&&this.#s.host.administrator&&this.#s.host.robotCount>0){this.#S=!1;let n=this.#e.value.resources.entry,o=this.#t.current();n&&o&&this.#de(n,o)}else this.#S=!1}}async selectFloor(t){let e=this.#e.value.resources.history.value,s=this.#e.value.resources.entry;if(!e||!s)return;let n=e.floors.find(l=>l.id===t);if(!n&&t!=="current")return;let o=this.#e.value;if(o.workflow==="draw"&&(o.draw.dirty||o.areaDraft.dirty)||o.workflow==="areaReview"&&(o.draw.dirty||o.areaDraft.dirty))return;if(!n||n.active){this.#L(),this.#w="";let l=this.#e.value;this.#e.patch({resources:{...l.resources,plans:p("idle",null),areas:p("idle",null),scene:p("idle",l.resources.scene.value),pose:p("idle",null)},map:{...l.map,available:l.resources.scene.value!==null,exactPose:!1},coherence:"verifying",floor:{...l.floor,readOnly:l.resources.scene.value!==null},workflow:"none",precisionOpen:!1}),this.#e.dispatch({type:"set-floor",floorId:"current"}),await this.refreshCatalog(!0);return}this.#L();let r=n.snapshots.at(-1),i=this.#t.begin(s.entryId,n.id,r?.id||n.id,r?.revision||0);this.#P(["catalog"]),this.#e.patch({generation:i.generation,coherence:"current",dataMode:"history",floor:{classifiedCount:e.floors.length,displayName:Ge(n,e.floors.indexOf(n)+1),readOnly:!0},selection:{...this.#e.value.selection,floorId:n.id,historyId:r?.id||null},resources:{...this.#e.value.resources,scene:p(r?"loading":"empty",null),pose:p("idle",null),plans:p("idle",null),areas:p("idle",null)},workflow:"none",precisionOpen:!1,map:{available:!1,complete:!0,floorCoherent:!0,sessionVerified:!0,exactPose:!1}}),r&&await this.#ue(r,i)}async selectHistory(t){let e=this.#e.value.resources.history.value,s=this.#e.value.resources.entry;if(!e||!s)return;if(!t){await this.selectFloor("current");return}let n=e.floors.find(i=>i.snapshots.some(l=>l.id===t)),o=n?.snapshots.find(i=>i.id===t);if(!n||!o)return;this.#L();let r=this.#t.begin(s.entryId,n.id,o.id,o.revision);this.#P(["catalog"]),this.#e.patch({generation:r.generation,dataMode:"history",floor:{classifiedCount:e.floors.length,displayName:Ge(n,e.floors.indexOf(n)+1),readOnly:!0},selection:{...this.#e.value.selection,floorId:n.id,historyId:o.id},resources:{...this.#e.value.resources,scene:p("loading",null),pose:p("idle",null)},map:{...this.#e.value.map,available:!1,exactPose:!1}}),await this.#ue(o,r)}async#ue(t,e){if(!this.#o.active)return;let s=this.#E("history-scene");try{let n=await this.#n.scene(t.sceneUrl,t.revision,!0,"history",s.signal);if(!this.#t.accepts(e)||!n.scene)return;this.#e.patch({resources:{...this.#e.value.resources,scene:p("ready",n.scene)},map:{...this.#e.value.map,available:!0,exactPose:!1}})}catch(n){if(O(n)||!this.#t.accepts(e))return;this.#e.patch({resources:{...this.#e.value.resources,scene:p("error",null,H(n,"history-scene-unavailable"))}})}finally{this.#M("history-scene",s)}}async openWorkflow(t){let e=this.#e.value;if((e.dataMode==="history"||e.floor.readOnly)&&hn.includes(t))return;let s=this.#e.value.workflow;if(t==="draw"&&s!=="draw"&&s!=="areaReview"&&this.selectArea(null),this.#e.dispatch({type:"open-workflow",workflow:t}),t==="history"){let n=this.#e.value.resources.entry,o=this.#t.current();n&&o&&(this.#e.patch({resources:{...this.#e.value.resources,history:p("loading",this.#e.value.resources.history.value)}}),await this.#ie(n,o))}(t==="plans"||t==="plan"||t==="rooms")&&await this.loadPlans(),(t==="draw"||t==="areaReview")&&await this.loadAreas()}async loadPlans({force:t=!1}={}){if(!this.#o.active){this.#r.get("plans")?.abort();let o=this.#e.value.resources;return this.#e.patch({resources:{...o,plans:p("idle",o.plans.value)}}),null}let e=this.#e.value.resources.entry;if(!e||!this.#t.current()||!ot(this.#e.value)||!t&&this.#e.value.resources.plans.status==="loading")return null;let s=B(e),n=this.#E("plans");this.#e.patch({resources:{...this.#e.value.resources,plans:p("loading",null)}});try{let o=await this.#n.plans(e.plansUrl,n.signal),r=this.#e.value.resources.entry;if(n.signal.aborted||this.#l||!r||B(r)!==s)return null;let i=this.#e.value;if(i.planDraft.dirty||i.workflow==="plan"&&(!i.planDraft.id||i.command==="pending"))return this.#e.patch({resources:{...this.#e.value.resources,plans:p("ready",o)}}),o;let l=i.workflow==="plan"?i.selection.planId:o.selectedPlan||o.plans[0]?.id||null,c=o.plans.find(d=>d.id===l);return this.#e.patch({resources:{...this.#e.value.resources,plans:p("ready",o)},selection:{...this.#e.value.selection,planId:l},planDraft:c?nt(c):{...this.#e.value.planDraft,id:null,name:"",rooms:[],dirty:!1}}),o}catch(o){let r=this.#e.value.resources.entry;if(O(o)||n.signal.aborted||this.#l||!r||B(r)!==s)return null;let i=o instanceof P&&o.code==="map-rechecking"?"map-rechecking":H(o,"plans-unavailable");return this.#e.patch({resources:{...this.#e.value.resources,plans:p("error",null,i)}}),null}finally{this.#M("plans",n)}}selectPlan(t,e=!1){let s=this.#e.value.resources.plans.value?.plans.find(n=>n.id===t);this.#e.patch({workflow:"plan",notice:!e&&this.#e.value.notice?.tone==="success"?null:this.#e.value.notice,selection:{...this.#e.value.selection,planId:t},planDraft:s?nt(s):{...L().planDraft}})}#ye(){let t=this.#e.value;(t.workflow==="draw"||t.workflow==="areaReview")&&t.resources.areas.status==="idle"&&this.loadAreas()}async loadAreas({reconcileDraft:t=!0}={}){if(!this.#o.active){this.#r.get("areas")?.abort();let o=this.#e.value.resources;return this.#e.patch({resources:{...o,areas:p("idle",o.areas.value)}}),null}let e=this.#e.value.resources.entry;if(!e||!this.#t.current()||!ot(this.#e.value))return null;let s=B(e),n=this.#E("areas");this.#e.patch({resources:{...this.#e.value.resources,areas:p("loading",null)}});try{let o=await this.#n.areas(e.areasUrl,n.signal),r=this.#e.value.resources.entry;if(n.signal.aborted||this.#l||!r||B(r)!==s)return null;if(o.sceneUrl!==r.sceneUrl)throw new P("areas-unavailable");this.#e.patch({resources:{...this.#e.value.resources,areas:p("ready",o)}});let i=this.#e.value.selection.areaId,l=this.#e.value,c=o.areas.some(d=>d.id===i);return t&&i!==null&&!c&&(l.draw.dirty||l.areaDraft.dirty)?this.#e.patch({selection:{...l.selection,areaId:null},areaDraft:{...l.areaDraft,id:null,status:"new",canRebind:!1,dirty:!0},notice:x.areaRemoved}):t&&!l.draw.dirty&&!l.areaDraft.dirty&&this.selectArea(c?i:null),o}catch(o){let r=this.#e.value.resources.entry;return O(o)||n.signal.aborted||this.#l||!r||B(r)!==s||this.#e.patch({resources:{...this.#e.value.resources,areas:p("error",null,H(o,"areas-unavailable"))}}),null}finally{this.#M("areas",n)}}selectArea(t){let e=this.#e.value.resources.areas.value?.areas.find(n=>n.id===t),s=this.#e.value;this.#e.patch({selection:{...s.selection,areaId:t},areaDraft:e?this.#_e(e):{id:null,name:"",cleaningMode:"vacuum",coverageSetting:"standard",status:"new",canRebind:!1,dirty:!1},draw:{...s.draw,circles:e?.circles||[],outline:e?.outline??null,outlineUndo:[],outlineRedo:[],tool:!e||e.outline?"outline":"paint",undo:[],redo:[],dirty:!1,strokeCount:0}})}#_e(t){return{id:t.id,name:t.name,cleaningMode:t.cleaningMode,coverageSetting:t.coverageSetting,status:t.status,canRebind:t.canRebind,dirty:!1}}async saveArea(){let t=this.#e.value,e=t.resources.entry,s=t.areaDraft;if(!e||t.command==="pending"||!ye(t)||!s.name.trim()||!t.draw.circles.length)return;let n=this.#E("area-mutation"),o=()=>!this.#l&&!n.signal.aborted;this.#e.patch({command:"pending",notice:x.areaSaving});try{let r=await this.#n.saveArea(e.areasUrl,{areaId:s.id,name:s.name.trim(),circles:t.draw.circles,outline:t.draw.outline??null,cleaningMode:s.cleaningMode,coverageSetting:s.coverageSetting},n.signal);if(!o())return;let i=this.#e.value,c=i.areaDraft===s&&i.draw.circles===t.draw.circles&&i.draw.outline===t.draw.outline&&i.selection.entryId===t.selection.entryId&&(i.workflow==="draw"||i.workflow==="areaReview")?{...s,id:r,name:s.name.trim(),status:"current",canRebind:!1,dirty:!1}:null;this.#e.patch({command:"idle",notice:x.areaSaved,...c?{dialog:i.dialog==="discardDraft"?null:i.dialog,selection:{...i.selection,areaId:r},areaDraft:c,draw:{...i.draw,dirty:!1,strokeCount:0,undo:[],redo:[],outlineUndo:[],outlineRedo:[]}}:{}});let d=await this.loadAreas({reconcileDraft:!1}),u=this.#e.value;o()&&c&&u.areaDraft===c&&!u.draw.dirty&&(u.workflow==="draw"||u.workflow==="areaReview")&&u.selection.entryId===t.selection.entryId&&d&&u.resources.areas.value===d&&d.areas.some(m=>m.id===r)&&this.selectArea(r)}catch(r){if(O(r)||!o())return;this.#e.patch({command:"failed",notice:x.areaSaveFailed})}finally{this.#M("area-mutation",n)}}async deleteArea(){let t=this.#e.value.resources.entry,e=this.#e.value.selection.areaId;if(!t||!e||this.#e.value.command==="pending"||!ye(this.#e.value))return;let s=this.#E("area-mutation"),n=()=>!this.#l&&!s.signal.aborted;this.#e.patch({command:"pending",notice:null});try{if(await this.#n.deleteArea(t.areasUrl,e,s.signal),!n())return;this.#e.patch({command:"idle",notice:x.areaDeleted}),await this.loadAreas()}catch(o){!O(o)&&n()&&this.#e.patch({command:"failed",notice:x.areaDeleteFailed})}finally{this.#M("area-mutation",s)}}async savePlan(){let t=this.#e.value,e=t.planDraft,s=t.resources.plans.value;if(!s||!e.name.trim()||!e.rooms.length||!ye(t))return;let n=e.rooms,o=e.id;if(await this.#ge("save_plan",{...e.id?{plan_id:e.id}:{},name:e.name.trim(),enabled:e.enabled,run_behavior:e.runBehavior,rooms:n.map(i=>({room:i.roomId,cleaning_mode:i.cleaningMode,coverage_setting:i.coverageSetting,...i.cadence?{cadence:{scope:i.cadence.scope,mop_every_n:i.cadence.mopEveryN,coverage_every_n:i.cadence.coverageEveryN,periodic_coverage_setting:i.cadence.periodicCoverageSetting,do_mop_next:i.cadence.doMopNext,do_coverage_next:i.cadence.doCoverageNext}}:{}})),return_to_base:e.returnToBase,finish_current_room:e.finishCurrentRoom,finish_current_room_threshold:e.finishCurrentRoomThreshold,select:!e.id||s.selectedPlan===e.id},x.planSaved,x.planSaveFailed,i=>{let l=i===void 0&&e.id?e.id:Ft(i);if(e.id&&l!==e.id)throw new P("invalid-plan-save-response");o=l})){let i=this.#e.value.workflow==="plan"&&this.#e.value.planDraft===e?{...e,id:o,dirty:!1}:null;i&&this.#e.patch({planDraft:i,selection:{...this.#e.value.selection,planId:o}});let l=await this.loadPlans({force:!0});i&&this.#e.value.workflow==="plan"&&this.#e.value.planDraft===i&&this.#e.value.selection.entryId===t.selection.entryId&&l&&this.#e.value.resources.plans.value===l&&o&&l.plans.some(c=>c.id===o)&&this.selectPlan(o,!0)}}async deletePlan(){let t=this.#e.value.selection.planId,e=this.#e.value.selection.entryId;if(!t)return;if(await this.#ge("delete_plan",{plan:t},x.planDeleted,x.planDeleteFailed)){let n=this.#e.value;n.selection.entryId===e&&n.planDraft.id===t&&(this.#e.patch({selection:{...n.selection,planId:null},planDraft:L().planDraft}),n.workflow==="plan"&&this.#e.patch({workflow:"plans",precisionOpen:!1})),await this.loadPlans({force:!0})}}async executeAction(t){switch(typeof t=="string"?t:t.id){case"recheck-status":{let s=this.#e.value.selection.entryId;await this.refreshCatalog(!0);let n=this.#e.value;!this.#l&&n.selection.entryId===s&&n.resources.catalog.status==="ready"&&n.host.connected&&n.host.robotConnected&&n.coherence==="current"&&n.command==="failed"&&this.#e.patch({command:"idle",notice:x.statusRefreshed});return}case"stop":await this.#be("matic_robot","stop_intelligent_cleaning",{include_unmanaged:!0});return;case"resume":await this.#be("vacuum","send_command",{command:"resume"});return;case"run-plan":{let s=this.#e.value,n=s.selection.planId||s.resources.plans.value?.selectedPlan;if(!n||s.workflow!=="plan"||!s.planDraft.enabled||s.resources.plans.status!=="ready"||s.command!=="idle"||!Ie(s))return;let o=s.selection.entryId,r=s.generation,i=s.selection.planId,l=s.planDraft,c=s.resources.plans.value?.plans.find(f=>f.id===n)?.nextRunPreview;if(!c||!/^[0-9a-f]{64}$/u.test(c.previewToken??"")){this.#e.patch({notice:x.planPreviewMissing});return}this.#e.patch({command:"pending",notice:null});let d=this.#E("plan-preflight");try{await this.loadPlans()}finally{this.#M("plan-preflight",d)}let u=this.#e.value,m=()=>{let f=this.#e.value;!this.#l&&f.selection.entryId===o&&f.generation===r&&f.command==="pending"&&this.#e.patch({command:"idle"})};if(d.signal.aborted||this.#l||u.selection.entryId!==o||u.generation!==r||u.workflow!=="plan"||u.selection.planId!==i||(u.selection.planId||u.resources.plans.value?.selectedPlan)!==n||u.planDraft!==l){m();return}if(u.resources.plans.status!=="ready"){m(),this.#e.patch({notice:x.planPreviewRefreshFailed});return}let h=u.resources.plans.value?.plans.find(f=>f.id===n)?.nextRunPreview;if(!h||h.blocker||!/^[0-9a-f]{64}$/u.test(h.previewToken??"")){m(),this.#e.patch({notice:x.planPreviewNone});return}if(!c||JSON.stringify(c)!==JSON.stringify(h)){m(),this.#e.patch({notice:x.planPreviewChanged});return}m(),await this.#be("matic_robot","run_selected_plan",{plan:n,preview_token:h.previewToken});return}case"clean-rooms":{await this.#Re();return}case"run-area":{let s=this.#e.value.selection.areaId;s&&await this.#be("matic_robot","clean_area",{area:s});return}case"review-area":this.#e.dispatch({type:"open-workflow",workflow:"areaReview"});return;case"save-area":await this.saveArea();return;case"save-plan":await this.savePlan();return;case"delete-plan":await this.deletePlan();return;case"delete-area":await this.deleteArea();return;case"reset-room-cadence":{if(typeof t=="string")return;let s=this.#e.value;if(s.selection.planId!==t.planId||s.planDraft.dirty||s.dataMode!=="live"||s.command!=="idle"||s.activity!=="idle"&&s.activity!=="docked"||!await this.#ge("reset_room_cadence",{plan:t.planId,room_id:t.roomId,modes:[t.mode]},t.mode==="mop"?x.resetMop:x.resetVacuum,t.mode==="mop"?x.resetMopFailed:x.resetVacuumFailed))return;let o=await this.loadPlans({force:!0}),r=this.#e.value;!this.#l&&r.selection.entryId===s.selection.entryId&&r.selection.planId===t.planId&&!r.planDraft.dirty&&o&&r.resources.plans.value===o&&this.selectPlan(t.planId,!0);return}}}async#Re(){if(this.#V)return;let t=this.#e.value,e=this.#x(t),s=st(t);if(!e||!s||s.key!==e.key||s.generation!==e.generation||s.floorKey!==e.floorKey||s.missionKey!==e.missionKey||s.preview.entryId!==e.entryId||s.preview.blocker||s.preview.rooms.length===0)return;this.#V=!0;let n=this.#E("room-preview");this.#p=this.#j(e),this.#e.patch({manualRoomPreview:p("loading",null),notice:null});try{let o=await this.#n.previewRoomSequence(e.entityId,e.rooms,e.overrideRoomSchedule,n.signal);if(n.signal.aborted||!this.#B(e)||o.entryId!==e.entryId)return;let r={key:e.key,generation:e.generation,floorKey:e.floorKey,missionKey:e.missionKey,preview:o};if(o.blocker||o.rooms.length===0){this.#e.patch({manualRoomPreview:p("ready",r),notice:x.roomPreviewBlocked});return}if(Is(s.preview)!==Is(o)){this.#e.patch({manualRoomPreview:p("ready",r),notice:x.roomPreviewChanged});return}if(this.#e.patch({manualRoomPreview:p("ready",r),notice:null}),!this.#B(e)||!Ie(this.#e.value))return;await this.#be("matic_robot","clean_room_sequence",{rooms:e.rooms,use_room_schedule:!0,override_room_schedule:e.overrideRoomSchedule,return_to_base:!0,preview_token:o.previewToken})}catch(o){!O(o)&&!n.signal.aborted&&this.#B(e)&&this.#e.patch({manualRoomPreview:p("error",null,H(o,"preview-unavailable")),notice:x.roomPreviewFailed})}finally{this.#M("room-preview",n),this.#V=!1,this.#N()}}async#ge(t,e,s,n,o){let r=this.#s?.vacuumEntityId;if(!r||!ye(this.#e.value)||this.#e.value.command==="pending")return!1;let i=this.#E("plan-mutation"),l=this.#s?.entryKey,c=this.#s?.userKey,d=()=>!this.#l&&!i.signal.aborted&&l===this.#s?.entryKey&&c===this.#s?.userKey;this.#e.patch({command:"pending",notice:x.saving});try{let u=await this.#n.service("matic_robot",t,e,r,{acknowledgementTimeout:"mutation",...o?{returnResponse:!0}:{}});return d()?(o?.(u),this.#e.patch({command:"idle",notice:s}),!0):!1}catch{return d()&&this.#e.patch({command:"failed",notice:n}),!1}finally{this.#M("plan-mutation",i)}}async#be(t,e,s){let n=this.#e.value,o=this.#s?.vacuumEntityId,r=e==="stop_intelligent_cleaning"||t==="vacuum"&&e==="return_to_base",i=t==="vacuum"&&e==="send_command"&&s.command==="resume";if(!o||n.selection.entryId!==this.#s?.entryKey||(r?!At(n):i?!Tt(n):!Ie(n)))return;let l=++this.#b,c=this.#s?.entryKey,d=()=>!this.#l&&l===this.#b&&c===this.#s?.entryKey,u=r?"settling":"starting";this.#c!==null&&window.clearTimeout(this.#c),this.#c=null,this.#e.patch({command:u,notice:null});try{if(await this.#n.service(t,e,s,o),!d())return;if(t==="matic_robot"&&(e==="clean_room_sequence"||e==="run_selected_plan")){this.#e.patch({command:"idle"}),this.refreshCatalog(!0);return}this.#e.patch({command:u}),this.#c!==null&&window.clearTimeout(this.#c),this.#c=window.setTimeout(()=>{this.#c=null,d()&&this.#e.value.command===u&&this.#e.patch({command:"idle"})},15e3)}catch(m){if(!d())return;this.#e.patch({command:"failed",notice:r?x.stopUnconfirmed:cn(m)??x.actionUnconfirmed})}}dispose(){this.#l||(this.#l=!0,this.#o.dispose(),this.#K(!1),this.#W?.(),this.#W=null,this.#e.patch({manualRoomPreview:p("idle",null)}),this.#Y(),this.#P(),this.#c!==null&&window.clearTimeout(this.#c),this.#c=null,this.#a.dispose(),this.#Se(),this.#n.dispose())}#Se(){this.#R?.dispose(),this.#R=null,this.#C=null,this.#v=null}};var $s=a=>(a.workflow==="none"?0:a.workflow==="plan"?2:1)+(a.fullMap?1:0)+(a.precisionOpen?1:0)+(a.dialog?1:0),Ds=a=>{if(!a||typeof a!="object")return null;let t=a.maticMapLayer;if(!t||typeof t!="object")return null;let e=t.owner,s=t.depth;return typeof e=="string"&&Number.isInteger(s)&&Number(s)>=0?{owner:e,depth:Number(s)}:null},Je=class{#e;#t=`matic-map-${crypto.randomUUID?.()||Math.random().toString(36).slice(2)}`;#n=0;#o=null;#a=!1;#i=!1;constructor(t){this.#e=t}start(){this.#o||(this.#n=$s(this.#e.value),this.#o=this.#e.subscribe(t=>this.#r(t)),window.addEventListener("popstate",this.#s))}#r(t){let e=$s(t);if(this.#a){this.#a=!1,this.#n=e;return}if(e<this.#n){let s=Ds(history.state);if(s?.owner===this.#t&&s.depth===this.#n){let n=e-this.#n;this.#n=e,this.#i=!0,history.go(n);return}}if(e>this.#n)for(let s=this.#n+1;s<=e;s+=1){let n=history.state&&typeof history.state=="object"?history.state:{};history.pushState({...n,maticMapLayer:{owner:this.#t,depth:s}},"",window.location.href)}this.#n=e}#s=()=>{if(this.#i){this.#i=!1;return}if(!(this.#n<1)){if(se(this.#e.value,{type:"dismiss-top-layer"})){let t=history.state&&typeof history.state=="object"?history.state:{};history.pushState({...t,maticMapLayer:{owner:this.#t,depth:this.#n}},"",window.location.href),this.#e.dispatch({type:"open-dialog",dialog:"discardDraft"});return}this.#a=!0,this.#e.dispatch({type:"dismiss-top-layer"})}};dismissTop(){if(this.#n<1)return!1;let t=Ds(history.state);return t?.owner===this.#t&&t.depth===this.#n?history.back():this.#e.dispatch({type:"dismiss-top-layer"}),!0}dispose(){this.#o?.(),this.#o=null,window.removeEventListener("popstate",this.#s),this.#n=0,this.#i=!1}};var Os=[re,ie,Le,ne`
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

    /* Notice slot and toast (shell.md \u00a74). Tone rules moved unchanged from workflow-panel. */
    .notice {
    --ms-local: var(--ms-surface-sunken);
    padding: var(--ms-space-3);
    border-radius: var(--ms-radius-md);
    background: var(--ms-local);
    font-size: var(--ms-t-sm);
    line-height: var(--ms-lh-snug);
    }
    .notice[data-tone="error"] { --ms-local: color-mix(in srgb, var(--ms-danger) 9%, var(--ms-surface-card)); color: color-mix(in srgb, var(--ms-danger) 82%, var(--ms-text)); background: var(--ms-local); }
    .notice[data-tone="success"] { --ms-local: color-mix(in srgb, var(--ms-success) 10%, var(--ms-surface-card)); color: color-mix(in srgb, var(--ms-success) 82%, var(--ms-text)); background: var(--ms-local); }
    .notice[data-tone="warning"] { --ms-local: color-mix(in srgb, var(--ms-warning) 11%, var(--ms-surface-card)); color: color-mix(in srgb, var(--ms-warning) 82%, var(--ms-text)); background: var(--ms-local); }
    .notice { display: flex; gap: var(--ms-space-2); align-items: center; padding-block: 0; padding-inline-end: 0; }
    .notice > .ms-icon, .notice > .ms-btn { flex: none; }
    .notice-text { flex: 1; min-inline-size: 0; padding-block: var(--ms-space-2); }
    [data-notice-slot] { margin-block-start: var(--ms-space-3); }
    /* Wide: bottom centre of the canvas, above the dock. */
    .notice-toast {
      position: absolute;
      z-index: 10;
      inset-inline: 0 22.5rem;
      inset-block-end: calc(var(--ms-space-3) + 3.5rem + var(--ms-space-2));
      inline-size: fit-content;
      max-inline-size: min(28rem, calc(100% - 22.5rem - 2 * var(--ms-space-3)));
      margin-inline: auto;
      box-shadow: var(--ms-shadow-2);
    }
    .notice-toast[hidden] { display: none; }
    /* Narrow: the sheet's top edge. */
    .narrow > .notice-toast { inset-inline: 0; inset-block-end: calc(var(--map-sheet-offset, 0px) + var(--ms-space-2)); max-inline-size: calc(100% - 2 * var(--ms-space-3)); }
    /* Full map: above the HUD, in its column. */
    .root:has(.full-map-hud) > .notice-toast {
      inset-inline: auto var(--ms-space-3);
      inset-block-end: calc(max(var(--ms-space-3), var(--ms-safe-bottom)) + var(--ms-control-lg) + 3 * var(--ms-space-3));
      inline-size: min(24rem, calc(100% - 1.5rem));
      max-inline-size: none;
    }
    .wide:has(.full-map-hud.above-dock) > .notice-toast { inset-block-end: calc(max(var(--ms-space-3), var(--ms-safe-bottom)) + var(--ms-control-lg) + 4 * var(--ms-space-3) + 3.5rem + var(--ms-space-2)); }

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
      .dialog, .full-map-hud, .mobile-sheet, .host-state, .notice { border: 1px solid CanvasText; }
      .sheet-handle { background: CanvasText; }
    }

    @media (prefers-reduced-motion: reduce) {
      .narrow .mobile-sheet { transition: none; }
    }
  `];var bt=class extends oe{constructor(){super(...arguments);this.state=L();this.compact=!1;this.inline=!1}static{this.properties={state:{attribute:!1},localize:{attribute:!1},compact:{type:Boolean,reflect:!0},inline:{type:Boolean,reflect:!0}}}static{this.styles=[re,ie,Le,ne`
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
`]}#e(e,s){return Q(this.localize,e,s)}#t(e){this.dispatchEvent(new CustomEvent(Re,{detail:e,bubbles:!0,composed:!0}))}#n(e){let s=e.currentTarget.valueAsNumber;Number.isFinite(s)&&this.#t({type:"set-brush",value:s})}render(){let{draw:e}=this.state;return $e`
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
    `}};customElements.get(ge)||customElements.define(ge,bt);var Ls=ce(De),Ze=ce(ge),Ws=ce(be),Bs=a=>a.dataMode==="history"||a.floor.readOnly,pn=(a,t)=>{let e=(i,l,c)=>Q(t,i,l,c);if(!a.host.connected)return{title:e("v4_reconnecting","Reconnecting"),detail:e("v4_ha_offline","Home Assistant is offline"),icon:U,notable:!0};if(!a.host.administrator)return{title:e("v4_access_required","Access required"),detail:e("v4_admin_only","Administrator only"),icon:U,notable:!0};if(a.host.robotCount===0)return{title:e("v4_no_robot_short","No robot"),detail:e("v4_set_up_robot","Set up a Matic robot"),icon:U,notable:!0};if(Ae(a))return{title:e("v4_selected_robot_unavailable","Selected robot unavailable"),detail:e("v4_choose_another_robot","Choose another robot to open its map."),icon:U,notable:!0};if(!a.host.robotConnected)return{title:e("v4_robot_offline","Robot offline"),detail:e("v4_last_map_read_only","Last verified map \xB7 read only"),icon:U,notable:!0};if(a.activity==="problem")return{title:e("v4_needs_attention","Needs attention"),detail:e("v4_check_robot","Check the robot"),icon:U,notable:!0};if(a.dataMode==="history"){let i=a.resources.history.value?.floors.find(d=>d.id===a.selection.floorId),l=i?.snapshots.findIndex(d=>d.id===a.selection.historyId)??-1,c=i?.snapshots.length??0;return{title:e("v4_saved_map","Saved map"),detail:l>=0?e("v4_read_only_position","Read only \xB7 {position} of {count}",{position:l+1,count:c}):e("v4_read_only","Read only"),icon:at,notable:!1}}if(a.coherence==="verifying"||a.coherence==="booting")return{title:e("v4_locating","Locating"),detail:e("v4_finding_map","Finding the current map"),icon:ke,notable:!0};if((a.resources.entry?.activePlan||a.resources.entry?.runnerLocked)&&(a.activity==="idle"||a.activity==="docked"))return{title:e("v4_task_in_progress","Task in progress"),detail:a.coherence==="unavailable"||a.coherence==="blocked"?e("v4_task_map_unavailable","The live map is unavailable; the current task remains in progress."):a.activity==="docked"?e("v4_task_docked","Robot docked; the cleaning task has not finished."):e("v4_task_waiting","Waiting for the cleaning task to continue or finish."),icon:lt,notable:!0};if(a.command==="starting"&&(a.activity==="idle"||a.activity==="docked"))return{title:e("v4_action_starting","Starting"),detail:e("v4_action_starting_detail","Waiting for the robot to begin"),icon:ke,notable:!0};let s=a.coherence==="unavailable"||a.coherence==="blocked",n=e("v4_active_map_unavailable","The live map is unavailable; new cleaning is disabled."),o=i=>s?`${i} \xB7 ${n}`:i;if(a.activity==="cleaning")return{title:e("v4_cleaning","Cleaning"),detail:o(e("v4_cleaning_progress","Cleaning in progress")),icon:dt,notable:!0};if(a.activity==="recharging"){let i=a.batteryPercent===null?e("v4_recharging_detail","Will resume automatically when ready"):e("v4_recharging_battery","Charging to resume \xB7 {percent}% battery",{percent:a.batteryPercent});return{title:e("v4_recharging","Charging to resume"),detail:o(i),icon:Zt,notable:!0}}if(a.activity==="paused")return{title:e("v4_paused","Paused"),detail:o(e("v4_can_resume","Cleaning can resume")),icon:ut,notable:!0};if(a.activity==="returning")return{title:e("v4_returning","Returning"),detail:o(e("v4_going_dock","Going to the dock")),icon:dt,notable:!0};if(a.activity==="stopping")return{title:e("v4_stopping","Stopping"),detail:o(e("v4_waiting_robot","Waiting for the robot")),icon:ut,notable:!0};if(s)return{title:e("v4_map_unavailable","Map unavailable"),detail:e("v4_map_unavailable_status","New cleaning is disabled until the live map is verified."),icon:U,notable:!0};let r=a.batteryPercent===null?e("v4_ready","Ready"):e("v4_battery","{percent}% battery",{percent:a.batteryPercent});return{title:a.activity==="docked"?e("v4_docked","Docked"):e("v4_ready","Ready"),detail:r,icon:ke,notable:!1}},qs=(a,t)=>{let e=(s,n)=>Q(t,s,n);switch(a.workflow){case"rooms":return{title:e("v4_choose_rooms","Choose rooms"),description:e("v4_choose_rooms_detail","Select on the map or from the list.")};case"draw":return{title:e("v4_draw_area","Draw an area"),description:e("v4_draw_area_detail","Outline or paint the area, then review it before saving.")};case"plans":return{title:e("v4_your_plans","Your plans"),description:e("v4_choose_plan_detail","Choose a plan to edit or run, or create a new one.")};case"plan":return{title:a.planDraft.id?e("v4_edit_plan","Edit plan"):e("v4_create_plan","Create a plan"),description:e("v4_plan_detail","Review rooms and cleaning settings.")};case"areaReview":return{title:e("v4_name_this_area","Name this area"),description:e("area_details_hint","Name the area and choose cleaning settings.")};case"history":return{title:e("v4_map_history","Map history"),description:e("v4_map_history_detail","Saved maps are floor-scoped and read only.")};case"support":return{title:e("v4_map_diagnostics","Map diagnostics"),description:e("v4_map_support_detail","Private geometry is never included.")};case"none":return Bs(a)?{title:e("v4_saved_map_read_only_title","Saved map is read only"),description:a.dataMode==="live"?e("v4_map_recovery_automatic","Cleaning controls return automatically when the live map is verified."):e("v4_saved_map_read_only_detail","Return to the live map to choose rooms, run a plan, or draw a custom area.")}:{title:e("v4_what_to_clean","What should the robot clean?"),description:e("v4_clean_detail","Choose rooms, a saved plan, or a custom area.")}}},j=["peek","half","full"],mn={info:ct,success:ts,warning:ss,error:ns},fn={info:6e3,success:4e3,warning:6e3,error:1e4},zs={none:"half",rooms:"half",draw:"peek",plan:"full",plans:"full",areaReview:"half",history:"half",support:"full"},vn=.5,yn=100,gn=6,bn=48,wn=["a[href]","button","input","label","select","textarea","summary",'[contenteditable]:not([contenteditable="false"])','[role="button"]','[role="link"]','[role="slider"]','[role="checkbox"]','[role="radio"]','[role="switch"]','[role="tab"]','[role="menuitem"]','[tabindex]:not([tabindex="-1"])'].join(","),_n=["button:not(:disabled)","a[href]","input:not(:disabled)","select:not(:disabled)","textarea:not(:disabled)","[tabindex]:not([tabindex='-1'])"].join(", "),kn=(a,t,e=!1,s="room",n=!1,o="mop")=>{let r=(i,l,c)=>Q(t,i,l,c);switch(a){case"discardDraft":return{title:e?r("v4_discard_plan","Discard plan changes?"):r("v4_discard_area","Discard area changes?"),detail:e?r("v4_discard_plan_detail","Your plan changes have not been saved. Keep editing or discard them."):r("v4_discard_area_detail","Your area changes have not been saved. Keep editing or discard them."),cancelLabel:r("v4_keep_area_editing","Keep editing"),confirmLabel:r("v4_discard","Discard"),action:"discard"};case"confirmDeletePlan":return{title:r("v4_delete_plan","Delete this plan?"),detail:r("v4_delete_plan_detail","This removes the saved plan from Home Assistant. The robot will not move."),cancelLabel:r("v4_cancel","Cancel"),confirmLabel:r("plan_delete","Delete plan"),action:"delete-plan"};case"confirmDeleteArea":return{title:r("v4_delete_area","Delete this area?"),detail:r("v4_delete_area_detail","This removes the saved outline from Home Assistant. The robot will not move."),cancelLabel:r("v4_cancel","Cancel"),confirmLabel:r("area_delete","Delete area"),action:"delete-area"};case"confirmResetCadence":return{title:o==="mop"?r("v4_reset_mop_cadence_title","Reset mopping progress for {room}?",{room:s}):r("v4_reset_coverage_cadence_title","Reset coverage progress for {room}?",{room:s}),detail:n?o==="mop"?r("v4_reset_shared_mop_cadence_detail","This clears shared mopping progress for {room} across plans that use its shared schedule. Coverage progress and saved cleaning history stay unchanged.",{room:s}):r("v4_reset_shared_coverage_cadence_detail","This clears shared coverage progress for {room} across plans that use its shared schedule. Mopping progress and saved cleaning history stay unchanged.",{room:s}):o==="mop"?r("v4_reset_private_mop_cadence_detail","This clears mopping progress for {room} in this plan. Coverage progress and saved cleaning history stay unchanged.",{room:s}):r("v4_reset_private_coverage_cadence_detail","This clears coverage progress for {room} in this plan. Mopping progress and saved cleaning history stay unchanged.",{room:s}),cancelLabel:r("v4_cancel","Cancel"),confirmLabel:o==="mop"?r("v4_reset_mop_cadence_confirm","Reset mopping progress"):r("v4_reset_coverage_cadence_confirm","Reset coverage progress"),action:"reset-room-cadence"};case"confirmStop":return{title:r("v4_stop_cleaning","Stop cleaning?"),detail:r("v4_stop_cleaning_detail","The robot may take a moment to settle before another action is available."),cancelLabel:r("v4_keep_cleaning","Keep cleaning"),confirmLabel:r("v4_stop","Stop"),action:"stop"};case"error":return{title:r("v4_error","Something went wrong"),detail:r("v4_error_detail","No action was started. Close this message and try again when the map is ready."),cancelLabel:r("v4_close","Close"),confirmLabel:r("v4_close","Close"),action:null};case null:return null}},Rn=(a=document)=>{let t=a.activeElement;for(;t?.shadowRoot?.activeElement;)t=t.shadowRoot.activeElement;return t},wt=a=>!!(a&&a.isConnected&&a.offsetParent!==null),_t=class extends oe{constructor(){super();this.state=L();this._measuredNarrow=!1;this._sheetOffset=0;this._overflowOpen=!1;this._helpOpen=!1;this._browserFullscreen=!1;this._sheetDetent="half";this._announcement="";this._politeNotice="";this._alertNotice="";this._toast=null;this._workflowLoadFailed=!1;this.#n=0;this.#o=0;this.#a=!1;this.#i=!1;this.#r=null;this.#s=null;this.#u=null;this.#y=null;this.#c=null;this.#b=null;this.#k=null;this.#g=null;this.#m=null;this.#d=null;this.#f=null;this.#$=()=>{this._browserFullscreen=this.#S()};this.#w=e=>{if(!this._overflowOpen)return;let s=this.renderRoot.querySelector(".overflow-wrap");(!s||!e.composedPath().includes(s))&&(this._overflowOpen=!1)};this.#D=()=>{this.#T(),this.#a=!1,this.#i=!1,this._toast=null};this.#q=e=>{e.type==="pointerenter"?this.#a=!0:this.#i=!0,this.#t!==void 0&&(this.#T(),this.#o=Math.max(0,this.#n-Date.now()))};this.#l=e=>{e.type==="pointerleave"?this.#a=!1:e.currentTarget.contains(e.relatedTarget)||(this.#i=!1),this.#h()};this.#z=()=>{this.#D(),this.updateComplete.then(()=>this.#v())};this.#R=()=>{this.#p({type:"set-notice",notice:null}),this.updateComplete.then(()=>this.#v())};this.#ye=()=>{this._workflowLoadFailed=!1,this.#ue()};new is(this,{container:()=>this.renderRoot?.querySelector(".draw-tools")??null,items:"button"})}static{this.properties={state:{attribute:!1},localize:{attribute:!1},_measuredNarrow:{state:!0},_sheetOffset:{state:!0},_overflowOpen:{state:!0},_helpOpen:{state:!0},_browserFullscreen:{state:!0},_sheetDetent:{state:!0},_announcement:{state:!0},_politeNotice:{state:!0},_alertNotice:{state:!0},_toast:{state:!0},_workflowLoadFailed:{state:!0}}}static{this.styles=Os}#e(e,s,n){return Q(this.localize,e,s,n)}#t;#n;#o;#a;#i;#r;#s;#u;#y;#c;#b;#k;#g;#m;#d;#f;#I(){let e=this.renderRoot;return e instanceof ShadowRoot?e.fullscreenElement??document.fullscreenElement:document.fullscreenElement}#$;#S(){let e=this.renderRoot,s=e.querySelector(".app"),n=e instanceof ShadowRoot?e.fullscreenElement:null;if(n)return n===s;let o=document.fullscreenElement;for(let r=this;r;){if(r===o)return!0;let i=r.getRootNode();r=i instanceof ShadowRoot?i.host:null}return!1}#w;connectedCallback(){super.connectedCallback(),this.#s=new ResizeObserver(([e])=>{if(!e)return;let s=e.contentRect.width<1024||e.contentRect.height<480;s!==this._measuredNarrow&&(this._measuredNarrow=s)}),this.#s.observe(this),window.addEventListener("pointerdown",this.#w,!0),document.addEventListener("fullscreenchange",this.#$),this.#u=new ResizeObserver(([e])=>{if(!e)return;let s=Math.ceil(e.target.getBoundingClientRect().height);s!==this._sheetOffset&&(this._sheetOffset=s)})}disconnectedCallback(){this.#D(),this.#s?.disconnect(),this.#s=null,this.#u?.disconnect(),this.#u=null,this.#y=null,window.removeEventListener("pointerdown",this.#w,!0),document.removeEventListener("fullscreenchange",this.#$),super.disconnectedCallback()}willUpdate(e){let s=this.shadowRoot?.activeElement??null;if(this.#r=["[data-notice-slot]","[data-notice-toast]"].find(r=>s?.closest(r))??null,!e.has("state"))return;let n=this.state.notice;if(n===e.get("state")?.notice||(this.#D(),this._politeNotice="",this._alertNotice="",!n))return;this._toast=n,this.#o=fn[n.tone];let o=this.#e(n.key,n.fallback,n.placeholders);this.updateComplete.then(()=>{if(this.state.notice!==n)return;let r=this.renderRoot.querySelector("[data-notice-toast]");this.#a=!!r?.matches(":hover"),this.#i=!!r?.contains(this.shadowRoot?.activeElement??null),this.#h(),n.tone==="error"?this._alertNotice=o:this._politeNotice=o})}#h(){!this._toast||this.#t!==void 0||this.#a||this.#i||(this.#n=Date.now()+this.#o,this.#t=setTimeout(this.#D,this.#o))}#T(){clearTimeout(this.#t),this.#t=void 0}#D;#q;#l;#z;#R;#C(e,s){return b`${I(mn[e.tone])}<span class="notice-text">${this.#e(e.key,e.fallback,e.placeholders)}</span><button
      class="ms-btn ms-btn--icon"
      type="button"
      aria-label=${this.#e("v4_close","Close")}
      @click=${s}
    >${I(es)}</button>`}updated(e){let s=e;if(this.#r){let o=this.renderRoot.querySelector(this.#r);this.#r=null,(!o||o.hidden)&&this.#v()}let n=this.renderRoot.querySelector(".mobile-sheet");if(n!==this.#y&&(this.#u?.disconnect(),this.#y=n,n?this.#u?.observe(n):this._sheetOffset!==0&&(this._sheetOffset=0)),s.has("_overflowOpen")&&this._overflowOpen&&this.updateComplete.then(()=>{this.renderRoot.querySelector("#map-options select, #map-options button")?.focus()}),s.has("_helpOpen")){if(this._helpOpen)this.updateComplete.then(()=>{this.renderRoot.querySelector(".help-dialog [data-dialog-initial-focus]")?.focus()});else if(s.get("_helpOpen")){let o=this.#k;this.#k=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>o?.focus({preventScroll:!0}))})}}if(e.has("state")){let o=e.get("state");if(o?.precisionOpen&&!this.state.precisionOpen&&this.#W()?.focus(),o?.fullMap&&!this.state.fullMap){let r=this.#b;this.#b=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>{(this.renderRoot.querySelector(".workspace-toggle")??this.renderRoot.querySelector(".nav--menu")??(r?.isConnected?r:null))?.focus({preventScroll:!0})})})}if(o&&!o.fullMap&&this.state.fullMap&&this.updateComplete.then(()=>{let r=this.#b;requestAnimationFrame(()=>{(this.renderRoot.querySelector(".workspace-toggle")??(r?.isConnected?r:null))?.focus({preventScroll:!0})})}),!o?.dialog&&this.state.dialog){let r=Rn(this.shadowRoot||document);r?.hasAttribute("data-dialog-launcher")&&(this.#c=r),this.updateComplete.then(()=>{(this.renderRoot.querySelector(".dialog [data-dialog-initial-focus]")??this.renderRoot.querySelector(".dialog button"))?.focus()})}else if(o?.dialog&&!this.state.dialog){o.dialog==="discardDraft"&&(this.#g=null,this.#ae());let r=this.#c?.isConnected&&this.#c.hasAttribute("data-dialog-launcher")?this.#c:this.#le(o.dialog);this.#c=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>r?.focus({preventScroll:!0}))})}o?o.workflow!==this.state.workflow&&(this._sheetDetent=zs[this.state.workflow],this.updateComplete.then(()=>this.#v())):this._sheetDetent=zs[this.state.workflow]}}#v(){let e=this.renderRoot.querySelector(".panel-heading h2");if(wt(e)){e.focus({preventScroll:!0});return}let s=this.renderRoot.querySelector(".action-bar .ms-btn--primary");wt(s)&&s.focus({preventScroll:!0})}#W(){let e=this.renderRoot.querySelector(".draw-brush");return wt(e)?e:this.renderRoot.querySelector(De)?.shadowRoot?.querySelector(".draw-brush")??null}#p(e){if(se(this.state,e)){this.#g=e,this.#p({type:"open-dialog",dialog:"discardDraft"});return}this.dispatchEvent(new CustomEvent(Re,{detail:e,bubbles:!0,composed:!0}))}#V(e){if(e.enabled){if(e.id==="return-live"){this.#p({type:"set-history",historyId:null});return}if(e.id==="clear-draft"){this.#p({type:"clear-draft"});return}this.#x(e.id)}}#A(e,s){let n={type:"open-workflow",workflow:e};s instanceof HTMLElement&&se(this.state,n)&&(this.#c=s),this.#p(n)}#X(){let e=this.#g;this.#g=null,e?.type==="select-plan"||e?.type==="select-area"?(this.#p({type:"patch-plan-draft",patch:{dirty:!1}}),this.#p({type:"patch-area-draft",patch:{dirty:!1}}),this.#p({type:"dismiss-top-layer"})):this.#p({type:"discard-draft"}),e&&e.type!=="dismiss-top-layer"&&queueMicrotask(()=>this.dispatchEvent(new CustomEvent(Re,{detail:e,bubbles:!0,composed:!0})))}#F(){this.#g=null,this.#_(),this.#ae()}#ae(){this.updateComplete.then(()=>{let e=this.renderRoot.querySelector(".floor-switcher");e&&(e.value=this.state.selection.floorId);let s=this.renderRoot.querySelector(".robot-switcher");s&&(s.value=this.state.selection.entryId??"")})}#_(){let e=this.state.dialog,s=e&&this.#c?.isConnected&&this.#c.hasAttribute("data-dialog-launcher")?this.#c:e?this.#le(e):null;this.#p({type:"dismiss-top-layer"}),s&&requestAnimationFrame(()=>s.focus({preventScroll:!0}))}#x(e){this.dispatchEvent(new CustomEvent(as,{detail:typeof e=="string"?{id:e}:e,bubbles:!0,composed:!0}))}#j(e){this.#p({type:"dismiss-top-layer"}),this.#x(e)}#B(e){if(e.action==="discard"){this.#X();return}if(e.action==="delete-plan"||e.action==="delete-area"){this.#j(e.action);return}if(e.action==="reset-room-cadence"){let s=this.state.cadenceResetRequest;this.#p({type:"dismiss-top-layer"}),s&&this.#x({id:"reset-room-cadence",planId:s.planId,roomId:s.roomId,mode:s.mode});return}this.#p({type:"dismiss-top-layer"}),e.action==="stop"&&this.#x("stop")}#N(e){e!==this._sheetDetent&&(this._sheetDetent=e,this._announcement=this.#e("v4_workspace_height","Map workspace, {height} height",{height:e}))}#G(e,s=!1){let o=j.indexOf(this._sheetDetent)+e;s&&o>=j.length&&(o=0),o=Math.max(0,Math.min(j.length-1,o)),this.#N(j[o]??this._sheetDetent)}#Q(e){let s=this.renderRoot.querySelector(".workspace")?.clientHeight??e.parentElement?.clientHeight??e.offsetHeight,n=parseFloat(getComputedStyle(this).fontSize)||16,o=[".sheet-grip",".sheet-tools",".action-bar"].map(l=>e.querySelector(l)?.offsetHeight??0).reduce((l,c)=>l+c,0)+n*.75,r=Math.min(s*.92,s-n*9),i=Math.min(s*.48,n*26,r);return{peek:Math.min(o,i),half:i,full:r}}#H(){return this.renderRoot.querySelector(".mobile-sheet")}#J(e){let s=e.currentTarget;for(let n of e.composedPath()){if(n===s)return!1;if(n instanceof Element&&n.matches(wn))return!0}return!1}#K(e){if(e.pointerType==="mouse"&&e.button!==0||this.#J(e))return;let s=this.#H();!s||this.#d||(this.#d={pointerId:e.pointerId,startY:e.clientY,startHeight:s.offsetHeight,heights:this.#Q(s),samples:[{y:e.clientY,t:e.timeStamp}],moved:!1},e.currentTarget.setPointerCapture(e.pointerId),s.classList.add("dragging"))}#U(e){let s=this.#d;if(!s||e.pointerId!==s.pointerId)return;let n=this.#H();if(!n)return;let o=e.clientY-s.startY;for(!s.moved&&Math.abs(o)>gn&&(s.moved=!0),s.samples.push({y:e.clientY,t:e.timeStamp});s.samples.length>2&&e.timeStamp-(s.samples[1]?.t??0)>yn;)s.samples.shift();if(!s.moved)return;let r=s.startHeight-s.heights.full,i=s.startHeight-s.heights.peek,l=Math.max(r,Math.min(i,o));n.style.transform=`translateY(${l}px)`}#O(e){let s=this.#d;if(!s||e.pointerId!==s.pointerId)return;this.#d=null;let n=this.#H();if(n&&(n.style.transform="",n.classList.remove("dragging")),e.type==="pointercancel")return;if(!s.moved){this.#G(1,!0);return}let o=e.clientY-s.startY,r=j.indexOf(this._sheetDetent),i=s.samples[0],l=s.samples[s.samples.length-1],c=i&&l&&l!==i?(l.y-i.y)/Math.max(1,l.t-i.t):0;if(Math.abs(c)>vn){let h=Math.max(0,Math.min(j.length-1,r+(c<0?1:-1)));this.#N(j[h]??this._sheetDetent);return}let d=s.startHeight-o,u=this._sheetDetent,m=Number.POSITIVE_INFINITY;for(let h of j){let f=Math.abs(s.heights[h]-d);f<m&&(m=f,u=h)}this.#N(u)}#ne(e){if(e.pointerType==="mouse"||this.#J(e))return;let s=e.currentTarget;this.#f={pointerId:e.pointerId,startY:e.clientY,atTop:s.scrollTop===0,consumed:!1}}#oe(e){let s=this.#f;if(!s||s.consumed||!s.atTop||e.pointerId!==s.pointerId)return;if(e.currentTarget.scrollTop>0){this.#f=null;return}e.clientY-s.startY<bn||(s.consumed=!0,this.#G(-1))}#he(){this.#f=null}#Y(){this.dispatchEvent(new CustomEvent("hass-toggle-menu",{bubbles:!0,composed:!0}))}#L(e){this.#b=e.currentTarget,this.#p({type:this.state.fullMap?"exit-full-map":"enter-full-map"})}#re(e){this._overflowOpen=!1,e&&this.updateComplete.then(()=>{this.renderRoot.querySelector(".overflow")?.focus()})}#Z(e){if(this.#re(e==="fullscreen"),e==="support"){this.#A("support");return}let s=this.renderRoot.querySelector(".app");this.#I()?document.exitFullscreen():s?.requestFullscreen()}#pe(){this.#p({type:"set-precision-open",value:!this.state.precisionOpen})}#me(e){this.#k=e.currentTarget,this._helpOpen=!0}#fe(e){let s=e;if(!Te(s.detail))return;if(se(this.state,s.detail)){e.stopPropagation(),this.#p(s.detail);return}if(s.detail?.type!=="open-dialog")return;let n=s.composedPath().find(o=>o instanceof HTMLElement&&o.hasAttribute("data-dialog-launcher"));n instanceof HTMLElement&&(this.#c=n)}#le(e){return this.renderRoot.querySelector(be)?.shadowRoot?.querySelector(`[data-dialog-launcher="${e}"]`)??null}#we(e){if(!rs(e)&&!(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey)&&e.key==="Escape"){if(e.preventDefault(),this._overflowOpen){this.#re(!0);return}if(this._helpOpen){this._helpOpen=!1;return}if(this.state.dialog==="discardDraft"){this.#F();return}this.#p({type:"dismiss-top-layer"})}}#ce(e){if(e.key!=="Tab")return;let n=[...e.currentTarget.querySelectorAll(_n)],o=n[0],r=n.at(-1);if(!o||!r)return;let i=this.shadowRoot?.activeElement;e.shiftKey&&i===o?(e.preventDefault(),r.focus()):!e.shiftKey&&i===r&&(e.preventDefault(),o.focus())}#E(){let e=this.renderRoot.querySelector(De);(e?.shadowRoot?.querySelector(".map-root")??e)?.focus()}#M(){this._sheetDetent==="peek"&&this.#H()&&this.#N("half"),this.updateComplete.then(()=>this.#v())}#P(e,s,n){if(e.id==="choose-cleaning")return R;let o=e.labelKey?this.#e(e.labelKey,e.label):e.label,r=!e.enabled&&e.reason?e.reasonKey?this.#e(e.reasonKey,e.reason):e.reason:null,i=e.id==="stop";return b`
      <button
        class=${`${s} ${e.kind==="danger"?"ms-btn--danger":""}`}
        type="button"
        aria-disabled=${e.enabled?R:"true"}
        aria-describedby=${r?n:R}
        aria-label=${i?this.#e("v4_stop_cleaning_label","Stop cleaning"):R}
        @click=${()=>this.#V(e)}
      >${o}</button>
      ${r?b`<p class="action-reason" id=${n}>${r}</p>`:R}
    `}#ve(e){let s=e.resources.plans.value?.rooms??e.resources.areas.value?.rooms??[];return e.selection.roomIds.map(n=>s.find(o=>o.roomId===n)?.name??n)}#ee(e,s,n){let o=s?.enabled&&e.workflow==="rooms"&&s.id==="clean-rooms"?[this.#ve(e).join(", "),e.planDraft.returnToBase?this.#e("v4_returns_to_dock","returns to the dock"):""].filter(Boolean).join(" \xB7 "):"";return b`
      <div class="action-bar">
        ${o?b`<p class="action-summary">${o}</p>`:R}
        ${s?this.#P(s,"ms-btn ms-btn--block ms-btn--lg ms-btn--primary","primary-reason"):R}
        ${n?this.#P(n,"ms-btn ms-btn--block ms-btn--lg ms-btn--secondary","secondary-reason"):R}
      </div>
    `}#te(e,s,n=R){return b`
      <div class="host-state">
        <h3>${e}</h3>
        <p>${s}</p>
        ${n}
      </div>
    `}#se(e,s,n,o,r=!1){return b`
      <button
        class="ms-row"
        type="button"
        aria-disabled=${r?"true":R}
        @click=${()=>{r||n()}}
      >
        <span class="ms-row__lead">${I(s)}</span>
        <span class="ms-row__body"><strong>${e}</strong>${o?b`<small>${o}</small>`:R}</span>
        <span class="ms-row__trail">${I(qe)}</span>
      </button>
    `}#ke(e){let s=e.resources.history.value?.floors||[],n=s.length?s.map((o,r)=>({id:o.active?"current":o.id,label:`${o.label||(o.active?this.#e("v4_current_floor","Current floor"):this.#e("v4_saved_floor","Saved floor {number}",{number:o.ordinal??r+1}))}${!o.active&&o.snapshots.length===0?` \xB7 ${this.#e("v4_floor_not_captured","Visit floor to capture")}`:""}`,disabled:!o.active&&o.snapshots.length===0})):[{id:e.selection.floorId,label:e.floor.displayName,disabled:!1}];return b`
      <select
        class="ms-select context-switcher floor-switcher"
        slot="floor"
        data-map-control
        name="map-floor"
        aria-label=${this.#e("v4_choose_floor","Choose floor")}
        ?disabled=${n.length<=1}
        .value=${e.selection.floorId}
        @change=${o=>this.#p({type:"set-floor",floorId:o.currentTarget.value})}
      >${n.map(o=>b`
        <option value=${o.id} ?selected=${o.id===e.selection.floorId} ?disabled=${o.disabled}>${o.label}</option>
      `)}</select>
    `}#ie(e,s){let n=(k,v,g)=>this.#e(k,v,g),o=this.#se(n("v4_map_history","Map history"),at,()=>this.#A("history"),n("v4_map_history_detail","Saved maps are floor-scoped and read only.")),r=this.#se(n("v4_map_diagnostics","Map diagnostics"),ct,()=>this.#A("support"),n("v4_map_support_detail","Private geometry is never included.")),{host:i}=e;if(!i.connected)return this.#te(n("v4_reconnecting_title","Reconnecting to Home Assistant"),n("v4_reconnecting_body","The last verified map stays read-only until the connection returns."));if(!i.administrator)return this.#te(n("v4_admin_title","Administrator access required"),n("v4_admin_body","Ask a Home Assistant administrator to open this map."));if(i.robotCount===0)return this.#te(n("v4_no_robot_title","No Matic robot set up"),n("v4_no_robot_body","Add the Matic integration to see a map here."),b`<a class="ms-btn ms-btn--secondary" href="/config/integrations/integration/matic_robot">${n("v4_open_integration","Open the Matic integration")}</a>`);if(Ae(e))return this.#te(n("v4_selected_robot_unavailable","Selected robot unavailable"),n("v4_choose_another_robot","Choose another robot to open its map."));if(!i.robotConnected)return b`
        ${this.#te(n("v4_robot_offline_title","Robot offline"),n("v4_robot_offline_body","Showing the last verified map. Cleaning is unavailable until the robot reconnects."))}
        <h3 class="shelf-heading">${n("v4_more","Map tools")}</h3>
        <div class="shelf">${o}${r}</div>
      `;if(Bs(e))return b`
        <h3 class="shelf-heading">${n("v4_more","Map tools")}</h3>
        <div class="shelf">
          ${o}
          ${r}
        </div>
      `;let l=e.coherence==="verifying"||e.coherence==="booting",c=e.resources.plans,d=c.value,u=d!==null&&d.rooms.length===0,m=d?.plans.length??0,h=c.status==="loading",f=c.status==="error",w=l||u,y=l?n("v4_reason_locating","Waiting for the robot to confirm which floor it is on."):u?n("v4_no_rooms_reason","This floor has no named rooms yet."):null,_=l?n("v4_reason_locating","Waiting for the robot to confirm which floor it is on."):null,M=l?n("v4_reason_locating","Waiting for the robot to confirm which floor it is on."):n("v4_areas_quick_detail","Create or choose a saved area");return b`
      ${e.activity==="problem"?this.#te(n("v4_attention_title","The robot needs attention"),n("v4_attention_body","Check the robot, then start a new task.")):b`
          <div class="quick-actions" aria-label=${n("v4_cleaning_choices","Cleaning choices")}>
            <button
              class="ms-row ms-row--card ms-row--featured"
              type="button"
              aria-disabled=${w?"true":R}
              @click=${()=>{w||this.#A("rooms")}}
            >
              <span class="ms-row__lead">${I(ke)}</span>
              <span class="ms-row__body">
                <strong>${n("v4_clean_rooms","One-time clean")}</strong>
                <small>${y??n("v4_clean_rooms_hint","Choose rooms for this run")}</small>
              </span>
              <span class="ms-row__trail">${I(qe)}</span>
            </button>
            <button
              class="ms-row ms-row--card"
              type="button"
              aria-disabled=${l?"true":R}
              @click=${()=>{l||this.#A("plans")}}
            >
              <span class="ms-row__lead">${I(lt)}</span>
              <span class="ms-row__body">
                <strong>${h?n("v4_plans_loading","Checking saved plans"):f?n("v4_plans_unavailable","Plans unavailable"):m?n("v4_run_a_plan","Run a plan"):n("v4_create_plan","Create a plan")}</strong>
                <small>${_??(h?n("v4_plans_loading_hint","Reading routines for this floor"):f?n("v4_plans_unavailable_hint","Try again to load saved routines"):m?m===1?n("v4_saved_routine","1 saved routine"):n("v4_saved_routines","{count} saved routines",{count:m}):n("v4_no_plans_hint","Save a room routine you can repeat"))}</small>
              </span>
              <span class="ms-row__trail">${I(qe)}</span>
            </button>
          </div>
        `}
      <h3 class="shelf-heading">${n("v4_more","Map tools")}</h3>
      <div class="shelf">
        ${this.#se(n("v4_custom_areas","Clean a custom area"),Jt,()=>this.#A("draw"),M,l)}
        ${o}

      </div>
      ${s?b`
        <h3 class="shelf-heading" id="map-display-heading">${n("v4_map_display","Map display")}</h3>
        <div class="map-display">
          <div class="ms-segment" role="group" aria-labelledby="map-display-heading">
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(e.appearance==="photo")}
              @click=${()=>this.#p({type:"set-appearance",appearance:"photo"})}
            >${n("map_style_photo","Photo")}</button>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(e.appearance==="rooms")}
              @click=${()=>this.#p({type:"set-appearance",appearance:"rooms"})}
            >${n("v4_room_colours","Floor plan")}</button>
          </div>
          <label class="ms-checkbox">
            <input type="checkbox" .checked=${e.labelsVisible} @change=${()=>this.#p({type:"toggle-labels"})}>
            ${n("v4_room_names","Room names")}
          </label>
          <button
            class="ms-btn ms-btn--secondary help-launcher"
            type="button"
            aria-haspopup="dialog"
            aria-expanded=${String(this._helpOpen)}
            @click=${this.#me}
          >${n("v4_how_to_move","How to move the map")}</button>
        </div>
      `:R}
    `}#de(e,s){return e.workflow==="none"?this.#ie(e,s):customElements.get(be)?b`<${Ws}
      .state=${e}
      .localize=${this.localize}
      @matic-workspace-intent=${this.#fe}
    ></${Ws}>`:(this.#ue(),this._workflowLoadFailed?b`<div class="workflow-loading" role="alert">
          <p>${this.#e("v4_workflow_load_failed","Workspace tools could not be loaded.")}</p>
          <button class="ms-btn ms-btn--secondary" @click=${this.#ye}>
            ${this.#e("v4_retry","Try again")}
          </button>
        </div>`:b`<div class="workflow-loading" role="status" aria-live="polite">
        ${this.#e("v4_workflow_loading","Loading workspace tools\u2026")}
      </div>`)}#ue(){this.#m||customElements.get(be)||(this._workflowLoadFailed=!1,this.#m=import("./workflow-panel-ZCRKCA63.js").then(()=>{this.#m=null,this.requestUpdate()}).catch(()=>{this.#m=null,this._workflowLoadFailed=!0}))}#ye;#_e(e,s){let n=qs(e,this.localize);return b`
      <div class="panel-heading">
        ${e.workflow!=="none"?b`
          <button
            class="panel-back ms-btn ms-btn--secondary"
            type="button"
            aria-label=${e.workflow==="plan"?this.#e("v4_back_to_plans","Back to plans"):this.#e("v4_back_to_all_tasks","Back to all tasks")}
            data-dialog-launcher="discardDraft"
            @click=${o=>this.#A(e.workflow==="plan"?"plans":"none",o.currentTarget)}
          >${I(We)}<span class="ms-btn__label">${e.workflow==="plan"?this.#e("v4_your_plans","Your plans"):this.#e("v4_all_tasks","All tasks")}</span></button>
        `:R}
        <h2 tabindex="-1">${n.title}</h2>
      </div>
      ${e.notice?b`<div class="notice" data-notice-slot data-tone=${e.notice.tone}>${this.#C(e.notice,this.#R)}</div>`:R}
      <p class="panel-description">${n.description}</p>
      ${this.#de(e,s)}
    `}#Re(e,s){let o=qs(e,this.localize).title;return e.workflow==="rooms"&&e.selection.roomIds.length&&(o=`${this.#e("v4_rooms_selected","Rooms selected: {count}",{count:e.selection.roomIds.length})} \xB7 ${this.#ve(e).join(", ")}`),this._sheetDetent!=="peek"?s.detail?`${s.title} \xB7 ${s.detail}`:s.title:s.notable?`${s.title} \xB7 ${o}`:o}#ge(){let e=(s,n)=>this.#e(s,n);return b`
      <div class="dialog-backdrop" @click=${s=>{s.target===s.currentTarget&&(this._helpOpen=!1)}}>
        <section
          class="dialog help-dialog ms-surface ms-surface--overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-title"
          @keydown=${this.#ce}
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
    `}render(){let e=this.state,s=e.narrowHint||this._measuredNarrow,n=pn(e,this.localize),o=Ae(e),r=It({...e,narrowHint:s}),i=$t(e),l=!s&&r.id==="stop"?r:!s&&i?.id==="stop"?i:null,c=l&&l===r?null:r,d=e.workflow==="draw"&&e.dataMode==="live"?{id:"clear-draft",label:"Clear drawing",labelKey:"v4_clear_drawing",kind:"neutral",enabled:e.draw.circles.length>0||!!e.draw.outline?.points.length}:null,u=l&&l===i?null:i??d,m=e.fullMap&&(e.coherence==="verifying"||e.coherence==="booting"),h=e.fullMap||e.host.administrator&&e.host.robotCount>0&&e.map.available,f=e.cadenceResetRequest?e.resources.plans.value?.rooms.find(g=>g.roomId===e.cadenceResetRequest?.roomId):void 0,w=e.cadenceResetRequest?e.resources.plans.value?.plans.find(g=>g.id===e.cadenceResetRequest?.planId)?.rooms.find(g=>g.roomId===e.cadenceResetRequest?.roomId):void 0,y=kn(e.dialog,this.localize,e.workflow==="plan",f?.name||e.cadenceResetRequest?.roomId||"room",w?.cadence?.scope==="shared",e.cadenceResetRequest?.mode),_=s&&!e.fullMap?`--map-sheet-offset:${this._sheetOffset}px`:"--map-sheet-offset:0px",M=s&&e.workflow==="draw",k=e.precisionOpen&&e.workflow==="draw",v=this._toast&&(this._toast.tone==="success"||this._toast.tone==="error"||e.fullMap||s&&this._sheetDetent==="peek")?this._toast:null;return b`
      <div class=${`root ${s?"narrow":"wide"}`} @keydown=${this.#we}>
        <button class="skip-link ms-btn ms-btn--primary" type="button" @click=${this.#E}>${this.#e("v4_skip_to_map","Skip to the map")}</button>
        <button class="skip-link ms-btn ms-btn--primary" type="button" @click=${this.#M}>${this.#e("v4_skip_to_workspace","Skip to the map workspace")}</button>
        <div class="app" ?inert=${!!y||this._helpOpen}>
          <header class="app-bar">
            ${e.precisionOpen?R:b`
              <button
                class="nav nav--menu ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#e("v4_open_navigation","Open Home Assistant sidebar")}
                title=${this.#e("v4_open_navigation","Open Home Assistant sidebar")}
                @click=${this.#Y}
              >${I(Yt)}</button>
            `}

            ${e.precisionOpen?b`
              <button
                class="nav ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#e("v4_back","Back")}
                @click=${()=>this.#p({type:"dismiss-top-layer"})}
              >${I(We)}</button>
            `:R}
            <h1 class="title">${this.#e("map_studio_title","Matic Map")}</h1>
            ${e.robots.length>1||o?b`
              <select
                class="ms-select context-switcher robot-switcher"
                name="matic-robot"
                aria-label=${this.#e("v4_choose_robot","Choose robot")}
                .value=${e.selection.entryId||""}
                @change=${g=>this.#p({type:"select-entry",entryId:g.currentTarget.value})}
              >${o?b`
                <option value=${e.selection.entryId||""} selected disabled>${this.#e("v4_selected_robot_unavailable","Selected robot unavailable")}</option>
              `:R}${e.robots.map(g=>b`
                <option value=${g.entryId} ?selected=${g.entryId===e.selection.entryId}>${g.label}</option>
              `)}</select>
            `:R}

            <span class="spacer"></span>
            ${h?b`
              <button
                class="workspace-toggle ms-btn ms-btn--icon"
                type="button"
                aria-label=${e.fullMap?this.#e("v4_show_workspace","Show cleaning panel"):this.#e("v4_hide_workspace","Hide cleaning panel")}
                aria-controls="map-workspace"
                aria-expanded=${String(!e.fullMap)}
                title=${e.fullMap?this.#e("v4_show_workspace","Show cleaning panel"):this.#e("v4_hide_workspace","Hide cleaning panel")}
                @click=${this.#L}
              >${I(Xt)}</button>
            `:R}
            <div class="overflow-wrap">
              <button
                class="overflow ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#e("v4_map_options","Map options")}
                aria-expanded=${String(this._overflowOpen)}
                aria-controls="map-options"
                @click=${()=>{this._overflowOpen=!this._overflowOpen}}
              >${I(jt)}</button>
              ${this._overflowOpen?b`
                <div id="map-options" class="overflow-menu ms-surface ms-surface--overlay">
                  <label class="overflow-field ms-field">${this.#e("map_quality_label","Scene detail")}
                    <select
                      aria-label=${this.#e("map_quality_label","Scene detail")}
                      .value=${e.quality}
                      @change=${g=>this.#p({type:"set-quality",quality:g.currentTarget.value})}
                    >
                      <option value="auto">${this.#e("map_quality_auto","Auto detail")}</option>
                      <option value="efficient">${this.#e("map_quality_efficient","Efficient")}</option>
                      <option value="balanced">${this.#e("map_quality_balanced","Balanced")}</option>
                      <option value="maximum">${this.#e("map_quality_maximum","Maximum")}</option>
                    </select>
                  </label>
                  <button class="ms-row ms-row--menu" type="button" @click=${()=>this.#Z("support")}>${this.#e("v4_map_diagnostics","Map diagnostics")}</button>
                  <button class="ms-row ms-row--menu" type="button" @click=${()=>this.#Z("fullscreen")}>${this._browserFullscreen?this.#e("v4_leave_full_screen","Leave full screen"):this.#e("v4_full_screen","Full screen")}</button>
                </div>
              `:R}
            </div>
          </header>

          <main class=${`workspace ${e.fullMap?"full-map":""}`} style=${_}>
            <div class="canvas">
              <${Ls}
                class="map-canvas"
                style=${_}
                .state=${e}
                .localize=${this.localize}
                .narrow=${s}
              >${this.#ke(e)}
                ${s&&!e.fullMap&&this._sheetDetent==="full"?b`
                  <button
                    class="sheet-scrim"
                    slot="scrim"
                    data-map-control
                    type="button"
                    aria-label=${this.#e("v4_collapse_sheet","Collapse the map workspace")}
                    @click=${()=>this.#N("peek")}
                  ></button>
                `:R}
              </${Ls}>
              ${!s&&k?b`
                <div class="precision-popover">
                  <${Ze} compact .state=${e} .localize=${this.localize}></${Ze}>
                </div>
              `:R}
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
              data-detent=${s?this._sheetDetent:R}
              data-workflow=${e.workflow}
              aria-label=${this.#e("v4_map_workspace","Map workspace")}
            >
              ${s?b`
                <div
                  class="sheet-grip"
                  @pointerdown=${this.#K}
                  @pointermove=${this.#U}
                  @pointerup=${this.#O}
                  @pointercancel=${this.#O}
                >
                  <span class="sheet-handle" role="presentation"></span>
                  ${e.workflow!=="none"&&this._sheetDetent==="peek"?b`
                    <button
                      class="sheet-back ms-btn ms-btn--icon ms-btn--sm"
                      type="button"
                      aria-label=${e.workflow==="plan"?this.#e("v4_back_to_plans","Back to plans"):this.#e("v4_back_to_all_tasks","Back to all tasks")}
                      title=${e.workflow==="plan"?this.#e("v4_back_to_plans","Back to plans"):this.#e("v4_back_to_all_tasks","Back to all tasks")}
                      data-dialog-launcher="discardDraft"
                      @click=${g=>this.#A(e.workflow==="plan"?"plans":"none",g.currentTarget)}
                    >${I(We)}</button>
                  `:R}
                  <span class="sheet-status">${this.#Re(e,n)}</span>
                  <button
                    class="ms-btn ms-btn--icon ms-btn--sm"
                    type="button"
                    aria-label=${this.#e("v4_show_more","Show more of the map workspace")}
                    aria-controls="sheet-body"
                    aria-disabled=${this._sheetDetent==="full"?"true":R}
                    @click=${()=>this.#G(1)}
                  >${I(Gt)}</button>
                  <button
                    class="ms-btn ms-btn--icon ms-btn--sm"
                    type="button"
                    aria-label=${this.#e("v4_show_less","Show less of the map workspace")}
                    aria-controls="sheet-body"
                    aria-disabled=${this._sheetDetent==="peek"?"true":R}
                    @click=${()=>this.#G(-1)}
                  >${I(Qt)}</button>
                </div>
                ${M?b`
                  <div class="sheet-tools">
                    ${os(e,{intent:g=>this.#p(g),openBrush:()=>this.#pe(),t:(g,C)=>this.#e(g,C)},"grid")}
                    ${k?b`
                      <div class="precision-popover">
                        <${Ze} compact inline .state=${e} .localize=${this.localize}></${Ze}>
                      </div>
                    `:R}
                  </div>
                `:R}
                <div
                  class="sheet-body"
                  id="sheet-body"
                  @pointerdown=${this.#ne}
                  @pointermove=${this.#oe}
                  @pointerup=${this.#he}
                  @pointercancel=${this.#he}
                >
                  ${this.#_e(e,s)}
                </div>
                ${this.#ee(e,c,u)}
              `:b`
                <div class="status-strip">
                  <span class="status-icon" aria-hidden="true">${I(n.icon)}</span>
                  <span class="status-copy"><strong>${n.title}</strong><small>${n.detail}</small></span>
                  ${l?this.#P(l,"status-action ms-btn ms-btn--secondary","status-reason"):R}
                </div>
                <section class="workflow">
                  <div class="workflow-body">${this.#_e(e,s)}</div>
                  ${this.#ee(e,c,u)}
                </section>
              `}
            </aside>

            ${e.fullMap?b`
              <section
                class=${`full-map-hud ms-surface ms-surface--floating ${i?"has-secondary":""} ${!s&&(e.workflow==="draw"||e.workflow==="rooms"&&e.selection.roomIds.length>0)?"above-dock":""}`}
                aria-label=${this.#e("v4_robot_status_and_action","Robot status and action")}
              >
                <span class="hud-copy"><strong>${n.title}</strong><small>${n.detail}</small></span>
                ${m&&r.id!=="stop"?R:this.#P(r,"ms-btn ms-btn--lg ms-btn--primary","hud-reason")}
                ${i&&(!m||i.id==="stop")?this.#P(i,"ms-btn ms-btn--lg ms-btn--secondary","hud-secondary-reason"):R}
              </section>
            `:R}
          </main>
        </div>

        <div
          class="notice notice-toast"
          data-notice-toast
          data-tone=${v?.tone??R}
          style=${_}
          ?hidden=${!v}
          ?inert=${!!y||this._helpOpen}
          @pointerenter=${this.#q}
          @focusin=${this.#q}
          @pointerleave=${this.#l}
          @focusout=${this.#l}
        >${v?this.#C(v,this.#z):R}</div>

        <div class="sr-only" aria-live="polite" aria-atomic="true">${[this._announcement,this._politeNotice].filter(Boolean).join(" ")}</div>
        <div class="sr-only" role="alert" aria-atomic="true">${this._alertNotice}</div>

        ${this._helpOpen?this.#ge():R}

        ${y?b`
          <div class="dialog-backdrop">
            <section
              class="dialog ms-surface ms-surface--overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="dialog-title"
              aria-describedby="dialog-detail"
              @keydown=${this.#ce}
            >
              <h2 id="dialog-title">${y.title}</h2>
              <p id="dialog-detail">${y.detail}</p>
              <div class="dialog-actions">
                <button
                  class="ms-btn ms-btn--secondary"
                  type="button"
                  data-dialog-initial-focus
                  @click=${e.dialog==="discardDraft"?this.#F:this.#_}
                >${y.cancelLabel}</button>
                ${y.action===null?R:b`
                  <button
                    class="discard ms-btn ms-btn--primary ms-btn--danger"
                    type="button"
                    @click=${()=>this.#B(y)}
                  >${y.confirmLabel}</button>
                `}
              </div>
            </section>
          </div>
        `:R}
      </div>
    `}};customElements.get(we)||customElements.define(we,_t);var Ns=ce(we),kt=class extends oe{constructor(){super(...arguments);this.narrow=!1;this._workspace=L();this.#e=new ze;this.#t=new xt(this._workspace);this.#n=null;this.#o=null;this.#a=null;this.#i=null;this.#r=null}static{this.styles=[re,ie,ne`
:host { display: block; block-size: 100%; }
`]}static{this.properties={hass:{attribute:!1},narrow:{type:Boolean},route:{attribute:!1},panel:{attribute:!1},_workspace:{state:!0}}}#e;#t;#n;#o;#a;#i;#r;#s(e=this.hass,s=this.panel){let n=this.#t.value.selection;return n.entrySource==="user"?this.#e.project(e,s,n.entryId):this.#e.project(e,s)}shouldUpdate(e){if(!e.has("hass")||[...e.keys()].some(n=>n!=="hass"))return!0;let s=e.get("hass");return s?.connection!==this.hass?.connection||s?.localize!==this.hass?.localize?!0:this.#s()!==this.#n}connectedCallback(){super.connectedCallback(),this.#o=this.#t.subscribe(e=>{if(this._workspace=e,e.selection.entryId!==this.#n?.entryKey){let s=this.#s();s!==this.#n&&(this.#n=s,this.#i?.sync(s))}}),this.#u()}disconnectedCallback(){this.#o?.(),this.#o=null,this.#y(),super.disconnectedCallback()}#u(){if(!(!this.isConnected||this.#i)&&(this.#n=this.#s(),this.#a=new He(()=>this.hass),this.#i=new Qe(this.#t,this.#a,this.hass?.connection??null),this.#r=new Je(this.#t),this.#r.start(),this.#n)){this.#i.sync(this.#n);let{host:e}=this.#n;e.connected&&e.administrator&&e.robotCount>0&&this.#i.refreshCatalog(this.#t.value.selection.floorId==="current")}}#y(){this.#r?.dispose(),this.#r=null,this.#i?.dispose(),this.#i=null,this.#a=null}willUpdate(e){if(e.has("hass")||e.has("panel")){let s=e.get("hass"),n=e.has("hass")&&s?.connection!==this.hass?.connection,o=this.#s(),r=o!==this.#n;r&&(this.#n=o),n?(this.#y(),this.#u()):(r||e.has("panel"))&&this.#i?.sync(o)}e.has("narrow")&&this.#t.value.narrowHint!==this.narrow&&this.#t.dispatch({type:"set-narrow-hint",value:this.narrow})}#c(e){if(!Te(e.detail))return;e.stopPropagation();let s=e.detail;if(s.type==="dismiss-top-layer"||s.type==="exit-full-map"){this.#r?.dismissTop()||this.#t.dispatch(s);return}if(s.type==="open-workflow"&&s.workflow!=="none"){this.#i?.openWorkflow(s.workflow);return}if(s.type==="set-floor"){this.#i?.selectFloor(s.floorId);return}if(s.type==="select-entry"){if(!this._workspace.robots.some(n=>n.entryId===s.entryId)||this.#e.project(this.hass,this.panel,s.entryId).entryKey!==s.entryId)return;this.#t.dispatch(s);return}if(s.type==="set-history"){this.#i?.selectHistory(s.historyId);return}if(s.type==="select-plan"){this.#i?.selectPlan(s.planId);return}if(s.type==="select-area"){this.#i?.selectArea(s.areaId),s.workflow==="areaReview"&&this.#i?.openWorkflow("areaReview");return}this.#t.dispatch(s)}#b(e){e.stopPropagation(),typeof e.detail?.id=="string"&&(e.detail.id==="reset-room-cadence"&&"planId"in e.detail&&"roomId"in e.detail&&"mode"in e.detail?this.#i?.executeAction(e.detail):this.#i?.executeAction(e.detail.id),this.dispatchEvent(new CustomEvent("matic-map-v4-action-requested",{detail:{id:e.detail.id},bubbles:!0,composed:!0})))}getWorkspaceSnapshot(){return this.#t.value}getRequestDiagnostics(){return Object.freeze({http:this.#a?.requestDiagnostics()??null,workspace:this.#i?.workspaceDiagnostics()??null})}render(){return b`
      <${Ns}
        .state=${this._workspace}
        .localize=${this.hass?.localize}
        @matic-workspace-intent=${this.#c}
        @matic-workspace-action=${this.#b}
      ></${Ns}>
    `}};customElements.get(rt)||customElements.define(rt,kt);export{ze as a,ce as b,b as c,kt as d};
/*! Bundled license information:

lit-html/static.js:
  (**
   * @license
   * Copyright 2020 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/
