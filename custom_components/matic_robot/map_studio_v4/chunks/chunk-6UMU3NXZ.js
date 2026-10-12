import{A as ct,B as ps,C as ms,D as dt,E as fs,a as Ae,b as zt,c as Ze,d as me,e as et,f as Bt,g as tt,h as Nt,i as Ht,j as oe,k as fe,l as re,m as Ft,n as S,o as Ie,p as Kt,q as Ut,r as Vt,s as jt,t as Yt,u as Xt,v as Gt,w as us,x as at,y as lt,z as hs}from"./chunk-AHVS3RLF.js";import{C as rs,D as st,E as nt,F as ot,G as rt,H as it,I as is,J as j,K as as,L as ls,M as cs,N as ds,O as I,a as xe,b as Te,c as Zt,d as ie,e as $e,f as es,g as ts,h as ss,i as Oe,j as ns,k as os}from"./chunk-2G3GZLP2.js";import{B as Je,C as Me,D as It,E as $t,F as Ot,G as Dt,K as Ce,L as Lt,M as qt,N as Wt,P as k,R as Pe,S as ve,T as Qt,U as Jt,c as Ct,h as E,j as Se,k as Z,n as K,o as Pt,p as Ge,q as Qe,s as xt,t as Tt,u as At,w as Ee,y as pe}from"./chunk-3RDDMNP7.js";var Zs=(a,t)=>{if(t?.recharge_and_resume===!0&&t?.charging===!0)return"recharging";switch(a){case"cleaning":return"cleaning";case"paused":return"paused";case"returning":return"returning";case"docked":return"docked";case"idle":return"idle";case"error":return"problem";default:return"unknown"}},en=a=>typeof a!="number"||!Number.isFinite(a)?null:Math.round(Math.max(0,Math.min(100,a))),tn=a=>{let t=a.attributes?.matic_entry_id;return typeof t=="string"&&t.length>0?t:null},sn=a=>String(a||"local-user").replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",vs=a=>{if(typeof a!="string")return"Matic robot";let t=a.trim();return t&&Array.from(t).length<=128&&!/[\u0000-\u001f\u007f]/u.test(t)?t:"Matic robot"},De=class{#e="";#t=null;project(t,e,s=null){let n=t?.states??{},o=e?.config?.entry_id,i=s||(typeof o=="string"?o:null),l=null,c=null,d=i,u=new Map;for(let[L,D]of Object.entries(n)){let z=tn(D);z&&L.startsWith("vacuum.")&&(u.set(z,{entryId:z,label:vs(D.attributes?.friendly_name)}),(i?z===i:!l)&&(l=D,c=L,d=z))}let m={connected:t?.connected!==!1,administrator:t?.user?.is_admin===!0,robotConnected:l!==null&&l.state!=="unavailable"&&l.state!=="unknown",robotCount:u.size},h=l?Zs(l.state,l.attributes):"unknown",f=en(l?.attributes?.battery_level),w=t?.selectedLanguage||t?.language||"en",y=t?.locale?.language||w,_=t?.locale?.time_zone==="server"?t.config?.time_zone:void 0,M=this.#t?.dates,R=M?.language===y&&M.timeZone===_?M:{language:y,timeZone:_},v=sn(t?.user?.id),g=vs(l?.attributes?.friendly_name),P=[...u.values()].sort((L,D)=>L.label.localeCompare(D.label,w,{sensitivity:"base"})),O=[m.connected,m.administrator,m.robotConnected,m.robotCount,h,f??"none",w,y,_??"browser",v,c??"none",d??"none",g,P.map(L=>`${L.entryId}:${L.label}`).join(",")].join("|");return O===this.#e&&this.#t?this.#t:(this.#e=O,this.#t={host:m,activity:h,batteryPercent:f,language:w,dates:R,userKey:v,vacuumEntityId:c,entryKey:d,robotLabel:g,robots:P},this.#t)}};var gs=Symbol.for(""),nn=a=>{if(a?.r===gs)return a?._$litStatic$},ae=a=>({_$litStatic$:a,r:gs});var ys=new Map,ut=a=>(t,...e)=>{let s=e.length,n,o,r=[],i=[],l,c=0,d=!1;for(;c<s;){for(l=t[c];c<s&&(o=e[c],(n=nn(o))!==void 0);)l+=n+t[++c],d=!0;c!==s&&i.push(o),r.push(l),c++}if(c===s&&r.push(t[s]),d){let u=r.join("$$lit$$");(t=ys.get(u))===void 0&&(r.raw=r,ys.set(u,t=r)),e=i}return a(t,...e)},b=ut(Lt),Wn=ut(qt),zn=ut(Wt);var on=1024*1024,bs=a=>{let t=s=>{let n=a.sceneHeaderBytes,o=a.scenePointStride,r=a.sceneMaxPoints,i=a.sceneMaxBytes,l=()=>{throw new Error("invalid-scene")};(!(s instanceof ArrayBuffer)||s.byteLength<n||s.byteLength>i)&&l();let c=new DataView(s),d=new Uint8Array(s,0,8),u=String.fromCharCode(...d),m=c.getUint16(8,!0),h=c.getUint16(10,!0),f=c.getUint32(12,!0),w=c.getUint32(16,!0),y=c.getUint32(20,!0),_=w+y,M=n+f;(u!=="MATIC3D\0"||m!==1||h!==o||f>1048576||_<1||_>r||M+_*h!==s.byteLength)&&l();let R;try{R=JSON.parse(new TextDecoder("utf-8",{fatal:!0}).decode(new Uint8Array(s,n,f)))}catch{l()}(!R||typeof R!="object"||Array.isArray(R))&&l();let v=R,g=v.meters_per_cell,P=v.origin_cells,O=v.span_cells;(typeof g!="number"||!Number.isFinite(g)||g<.001||g>.1||!Array.isArray(P)||P.length!==2||!P.every($=>typeof $=="number"&&Number.isFinite($))||!Array.isArray(O)||O.length!==2||!O.every($=>typeof $=="number"&&Number.isFinite($)&&$>=1&&$<=65536))&&l();let D=(Array.isArray(v.rooms)?v.rooms.slice(0,128):[]).flatMap(($,ke)=>{if(!$||typeof $!="object"||Array.isArray($))return[];let N=$,G=typeof N.name=="string"?N.name.trim():"";if(!G||Array.from(G).length>128||/[\u0000-\u001f\u007f]/u.test(G))return[];if(!Array.isArray(N.boundary)||N.boundary.length<3||N.boundary.length>8192)return[];let Re=N.boundary.flatMap(V=>{if(!Array.isArray(V)||V.length!==2)return[];let[Q,ne]=V;return typeof Q=="number"&&Number.isFinite(Q)&&typeof ne=="number"&&Number.isFinite(ne)?[[Q,ne]]:[]}),ee=N.center;if(Re.length<3||!Array.isArray(ee)||ee.length!==2)return[];let[te,se]=ee;return typeof te!="number"||!Number.isFinite(te)||typeof se!="number"||!Number.isFinite(se)?[]:[{id:`scene-room-${ke+1}`,name:G,boundary:Re,center:[te,se]}]}),z=typeof v.sample_step=="number"&&Number.isInteger(v.sample_step)?Math.max(1,Math.min(r,v.sample_step)):1,he=P,_e=O;return{buffer:s,pointOffset:M,floorCount:w,surfaceCount:y,total:_,metadata:{metersPerCell:g,origin:[he[0],he[1]],span:[_e[0],_e[1]],sampleStep:z,rooms:D}}};return{parseTransfer:t,decodeDeltaTransfer:async(s,n,o)=>{let r=(A="invalid-scene-delta")=>{throw new Error(A)},i=()=>{if(o?.aborted)throw new DOMException("Aborted","AbortError")};(!(s instanceof ArrayBuffer)||s.byteLength<a.deltaHeaderBytes||s.byteLength>a.deltaHeaderBytes+a.deltaMaxBytes||!(n.buffer instanceof ArrayBuffer)||n.buffer.byteLength<a.sceneHeaderBytes||n.buffer.byteLength>a.deltaMaxBytes||!Number.isSafeInteger(n.revision)||n.revision<0)&&r("invalid-scene-delta-size");let l=new DataView(s),c=String.fromCharCode(...new Uint8Array(s,0,8)),d=l.getUint16(8,!0),u=l.getUint16(10,!0),m=l.getBigUint64(12,!0),h=l.getBigUint64(20,!0),f=l.getUint32(28,!0),w=l.getUint32(32,!0),y=Number(m),_=Number(h);(c!=="MATICDLT"||d!==1||u!==1||!Number.isSafeInteger(y)||!Number.isSafeInteger(_)||y!==n.revision||_<=n.revision||f<a.sceneHeaderBytes||f>a.deltaMaxBytes||w<1||w>a.deltaMaxBytes||w+a.deltaHeaderBytes!==s.byteLength)&&r(),typeof DecompressionStream!="function"&&r("scene-delta-decompression-unavailable"),i();let M=new Uint8Array(s,a.deltaHeaderBytes,w),R=Math.max(n.buffer.byteLength,f);R>a.deltaMaxBytes&&r("invalid-scene-delta-size");let v=new Uint8Array(R),P=new Blob([M]).stream().pipeThrough(new DecompressionStream("deflate")).getReader(),O=0,L=null;try{for(L=()=>{P.cancel().catch(()=>{})},o?.addEventListener("abort",L,{once:!0});;){i();let{done:A,value:J}=await P.read();if(A)break;(!(J instanceof Uint8Array)||O+J.byteLength>R)&&r(),v.set(J,O),O+=J.byteLength}}catch(A){if(await P.cancel().catch(()=>{}),o?.aborted||A instanceof DOMException&&A.name==="AbortError")throw new DOMException("Aborted","AbortError");if(A instanceof Error&&A.message==="invalid-scene-delta")throw A;r()}finally{L&&o?.removeEventListener("abort",L),P.releaseLock()}i(),O!==R&&r();let D=new Uint8Array(n.buffer),z=new DataView(v.buffer,v.byteOffset,v.byteLength),he=Math.min(a.sceneHeaderBytes,D.byteLength);for(let A=0;A<he;A+=1)v[A]=(v[A]??0)^(D[A]??0);let _e=z.getUint32(12,!0),$=z.getUint32(16,!0),ke=z.getUint32(20,!0),N=a.sceneHeaderBytes+_e,G=$+ke,Re=N===n.pointOffset&&$===n.floorCount&&ke===n.surfaceCount,ee=N+G*a.scenePointStride,te=Re&&ee===f&&G<=a.sceneMaxPoints,se=[],V=-1,Q=!1,ne=()=>{Q&&V>=0&&se.push(V),Q=!1};for(let A=he;A<D.byteLength;A+=a.xorChunkBytes){i();let J=Math.min(D.byteLength,A+a.xorChunkBytes);for(let H=A;H<J;H+=1){let St=D[H]??0,Et=(v[H]??0)^St;if(v[H]=Et,!te||H<n.pointOffset||H>=ee)continue;let Mt=Math.floor((H-n.pointOffset)/a.dirtyBlockBytes);Mt!==V&&(ne(),V=Mt),Et!==St&&(Q=!0)}J<D.byteLength&&await new Promise(H=>globalThis.setTimeout(H,0))}ne(),i();let Js=f===v.byteLength?v.buffer:v.slice(0,f).buffer;return{parsed:t(Js),revision:_,...te?{deltaHint:{baseRevision:y,blockBytes:a.dirtyBlockBytes,dirtyBlocks:se}}:{}}}}},ws=Object.freeze({deltaHeaderBytes:fe,deltaMaxBytes:re,sceneHeaderBytes:tt,sceneMaxBytes:oe,sceneMaxPoints:Ht,scenePointStride:Nt,dirtyBlockBytes:Ft,xorChunkBytes:on}),_s=bs(ws),rn=a=>{try{return _s.parseTransfer(a)}catch{throw new S("invalid-scene")}},an=()=>`
  const { parseTransfer, decodeDeltaTransfer } = (${bs.toString()})(Object.freeze(${JSON.stringify(ws)}));
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
`,Le=class{#e=null;#t=null;#n=!1;#o=!1;#l=0;#i=null;#r=null;#s=null;constructor(){if(!(typeof Worker!="function"||typeof URL?.createObjectURL!="function"))try{this.#t=URL.createObjectURL(new Blob([an()],{type:"text/javascript"})),this.#v()}catch{this.#e=null,this.#t&&URL.revokeObjectURL(this.#t),this.#t=null}}async parse(t,e){if(this.#h(e),t.byteLength>oe||t.byteLength<tt)throw new S("invalid-scene");let s=await this.#d({kind:"parse",buffer:t},e,async n=>(await new Promise(o=>globalThis.setTimeout(o,0)),this.#h(n),{id:0,ok:!0,parsed:rn(t)}));if(!s.parsed)throw new S("invalid-scene");return s.parsed}async decodeDelta(t,e,s){if(this.#h(s),t.byteLength>fe+re||e.buffer.byteLength>re)throw new S("invalid-scene-delta-size");let n={buffer:e.buffer,revision:e.revision,pointOffset:e.pointOffset,floorCount:e.floorCount,surfaceCount:e.surfaceCount},o;try{o=await this.#d({kind:"delta",payload:t},s,async r=>(await new Promise(i=>globalThis.setTimeout(i,0)),this.#h(r),_s.decodeDeltaTransfer(t,n,r).then(i=>({id:0,ok:!0,...i}))),n)}catch(r){throw r instanceof S?r:s?.aborted||r instanceof DOMException&&r.name==="AbortError"?new DOMException("Aborted","AbortError"):r instanceof Error&&(r.message.startsWith("invalid-scene")||r.message==="scene-delta-decompression-unavailable")?new S(r.message):new S("invalid-scene-delta")}if(!o.parsed||o.revision===void 0)throw new S("invalid-scene-delta");return{parsed:o.parsed,revision:o.revision,...o.deltaHint?{deltaHint:o.deltaHint}:{}}}#h(t){if(this.#o)throw new S("scene-parser-disposed");if(t?.aborted)throw new DOMException("Aborted","AbortError")}#v(){if(!(!this.#t||this.#n||this.#o))try{let t=new Worker(this.#t);t.onmessage=e=>{let s=this.#i;this.#e!==t||!s||s.worker!==t||e.data.id!==s.id||(e.data.ok?this.#y(s,e.data):this.#y(s,void 0,new S(e.data.problem||"invalid-scene")))},t.onerror=()=>this.#c(t),t.onmessageerror=()=>this.#c(t),this.#e=t}catch{this.#e=null,this.#n=!0}}async#d(t,e,s,n){return this.#h(e),new Promise((o,r)=>{let i,l=()=>e?.removeEventListener("abort",i.abort),c=(d,u)=>{i.settled||(i.settled=!0,l(),u!==void 0?r(u):d?o(d):r(new S("invalid-scene")))};i={id:++this.#l,message:t,...e?{signal:e}:{},fallback:s,...n?{base:n}:{},settle:c,abort:()=>this.#_(i),settled:!1,worker:null},e?.addEventListener("abort",i.abort,{once:!0}),e?.aborted||this.#o?c(void 0,e?.aborted?new DOMException("Aborted","AbortError"):new S("scene-parser-disposed")):this.#i?this.#r?c(void 0,new S("scene-parser-busy")):this.#r=i:(this.#i=i,this.#S(i))})}#S(t){if(this.#i!==t)return;if(this.#o){this.#y(t,void 0,new S("scene-parser-disposed"));return}if(t.signal?.aborted){this.#y(t,void 0,new DOMException("Aborted","AbortError"));return}!this.#e&&!this.#n&&this.#v();let e=this.#e;if(e){t.worker=e;try{let n,o;if(t.message.kind==="parse")n={id:t.id,kind:t.message.kind,buffer:t.message.buffer},o=[t.message.buffer];else{if(!t.base)throw new S("invalid-scene-delta");let r={...t.base,buffer:t.base.buffer.slice(0)};n={id:t.id,kind:t.message.kind,payload:t.message.payload,base:r},o=[t.message.payload,r.buffer]}e.postMessage(n,o)}catch{this.#c(e)}return}let s=new AbortController;this.#s=s,Promise.resolve().then(()=>t.fallback(s.signal)).then(n=>this.#y(t,n),n=>this.#y(t,void 0,n))}#_(t){let e=new DOMException("Aborted","AbortError");if(this.#r===t){this.#r=null,t.settle(void 0,e);return}this.#i===t&&(t.worker?(this.#m(),this.#y(t,void 0,e)):this.#s?.abort())}#y(t,e,s){if(this.#i!==t){t.settle(void 0,new S("scene-parser-disposed"));return}let n=t.signal?.aborted?new DOMException("Aborted","AbortError"):s;t.settle(e,n),this.#i=null,this.#s=null,t.worker=null,this.#o||this.#f()}#f(){if(this.#o||this.#i||!this.#r)return;let t=this.#r;if(this.#r=null,t.signal?.aborted){t.settle(void 0,new DOMException("Aborted","AbortError")),this.#f();return}this.#i=t,this.#S(t)}#c(t){if(this.#e!==t)return;this.#n=!0,this.#m();let e=this.#i;e?.worker===t?this.#y(e,void 0,new S("scene-worker-failed")):this.#f()}#m(){this.#e?.terminate(),this.#e=null}dispose(){if(this.#o)return;this.#o=!0;let t=this.#r;this.#r=null,t?.settle(void 0,new S("scene-parser-disposed"));let e=this.#i;this.#m(),this.#s?.abort(),this.#s=null,e&&(e.worker=null,e.settle(void 0,new S("scene-parser-disposed"))),this.#i=null,this.#t&&URL.revokeObjectURL(this.#t),this.#t=null}};var ht=["catalog","scene","sceneDelta","pose","history","plans","areas","areaSave","areaDelete"];var pt=()=>({requests:0,completed:0,failed:0,aborted:0,timedOut:0,totalDurationMs:0,maxDurationMs:0}),ks=a=>Math.min(1e9,a+1),Rs=a=>Number.isFinite(a)?Math.min(1e12,Math.max(0,a)):0,le=class{#e=pt();#t=!1;record(t,e){if(this.#t)return;let s=Math.round(Rs(e)*100)/100;this.#e.requests=ks(this.#e.requests),this.#e[t]=ks(this.#e[t]),this.#e.totalDurationMs=Rs(this.#e.totalDurationMs+s),this.#e.maxDurationMs=Math.max(this.#e.maxDurationMs,s)}snapshot(){return Object.freeze({...this.#e})}reset(){this.#t||Object.assign(this.#e,pt())}dispose(){this.#t=!0,Object.assign(this.#e,pt())}},qe=class{#e=Object.fromEntries(ht.map(t=>[t,new le]));#t=!1;record(t,e,s){this.#t||this.#e[t].record(e,s)}snapshot(){let t=Object.fromEntries(ht.map(e=>[e,this.#e[e].snapshot()]));return Object.freeze(t)}dispose(){if(!this.#t){this.#t=!0;for(let t of ht)this.#e[t].dispose()}}};var B={catalog:1e4,scene:6e4,delta:35e3,pose:1e4,history:15e3,workflow:15e3,mutation:2e4,roomPreview:15e3},ln=2,ye=new WeakMap,Ss={coverage_identity_unavailable:"Could not verify the current cleaning task. Check the robot status, then try again.",coverage_activity_unavailable:"Could not verify whether the robot is cleaning. Check the robot status, then try again.",coverage_native_session_active:"The robot already has a cleaning task. Wait for it to finish before starting another cleaning task.",coverage_identity_changed:"The cleaning task changed during setup. Check the robot status, then try again."},cn=(a,t)=>{if(!a||typeof a!="object")return null;let e=a;if(e.translation_domain!=="matic_robot"||typeof e.translation_key!="string"||!Object.hasOwn(Ss,e.translation_key))return null;let s=e.translation_key,n=Ss[s];try{let o=t?.(`component.matic_robot.exceptions.${s}.message`);o&&o!==`component.matic_robot.exceptions.${s}.message`&&(n=o)}catch{}return new x(s,null,n)},x=class extends Error{constructor(t,e=null,s=null){super(s??t),this.name="BackendError",this.code=t,this.status=e,this.recoveryMessage=s}},Es=(a,t)=>{let e=a.headers.get("X-Matic-Revision");if(e===null)return t;let s=Number(e);if(!Number.isSafeInteger(s)||s<0)throw new S("invalid-scene-revision");return s},Ms=(a,t)=>{let e=a.headers.get("X-Matic-Floor-Coherent");if(e===null)return t;if(e==="1")return!0;if(e==="0")return!1;throw new S("invalid-scene-floor-header")},We=class{#e;#t=new Le;#n=new WeakMap;#o=new Set;#l=new qe;#i=!1;constructor(t){this.#e=t}requestDiagnostics(){return this.#l.snapshot()}async#r(t,e,s=Number.POSITIVE_INFINITY,n="invalid-response-size"){let o=t.body?.getReader();if(!o)return new ArrayBuffer(0);let r=()=>{o.cancel().catch(()=>{})};e.addEventListener("abort",r,{once:!0});try{if(e.aborted)throw r(),new DOMException("Aborted","AbortError");let i=[],l=0;for(;;){let u=await o.read();if(e.aborted)throw new DOMException("Aborted","AbortError");if(u.done)break;if(l+u.value.byteLength>s)throw o.cancel().catch(()=>{}),new S(n);i.push(u.value),l+=u.value.byteLength}let c=new Uint8Array(l),d=0;for(let u of i)c.set(u,d),d+=u.byteLength;return c.buffer}finally{e.removeEventListener("abort",r),o.releaseLock()}}async#s(t,e,s,n,o,r){if(!Gt(e))throw new x("invalid-private-path");if(o?.aborted)throw new DOMException("Aborted","AbortError");let i=performance.now(),l="failed",c=new AbortController,d=()=>{},u=new Promise((w,y)=>{d=y}),m=()=>{c.abort(),d(new DOMException("Aborted","AbortError"))};o?.addEventListener("abort",m,{once:!0});let h=!1,f=window.setTimeout(()=>{h=!0,m()},n);try{let w=this.#e(),y=new Headers(s.headers),_={...s,cache:"no-store",credentials:"same-origin",headers:Object.fromEntries(y.entries()),signal:c.signal},M=async()=>{let v;if(typeof w?.fetchWithAuth=="function")v=await w.fetchWithAuth(e,_);else{let g=w?.auth?.accessToken||w?.auth?.data?.access_token;g&&y.set("Authorization",`Bearer ${g}`);let P=typeof w?.hassUrl=="function"?w.hassUrl(e):e;v=await fetch(P,{..._,headers:y})}try{if(c.signal.aborted)throw new DOMException("Aborted","AbortError");return await r(v,c.signal)}finally{v.body&&!v.body.locked&&v.body.cancel().catch(()=>{})}},R=await Promise.race([M(),u]);return l="completed",R}catch(w){throw h&&!o?.aborted?(l="timedOut",new x("request-timeout")):c.signal.aborted?(l="aborted",new DOMException("Aborted","AbortError")):w}finally{window.clearTimeout(f),o?.removeEventListener("abort",m),this.#l.record(t,l,performance.now()-i)}}async#h(t,e,s,n,o={}){return this.#s(t,e,{...o,headers:{Accept:"application/json",...o.headers||{}}},s,n,async(r,i)=>{if(!r.ok){let l=r.headers.get("X-Matic-Plans-Conflict");throw new x(l==="map-rechecking"?"map-rechecking":"request-failed",r.status)}try{return JSON.parse(new TextDecoder().decode(await this.#r(r,i)))}catch{throw new S("invalid-json-response")}})}async catalog(t){return Ie(await this.#h("catalog",Bt,B.catalog,t))}async scene(t,e,s,n,o,r){let i=new Headers({Accept:"application/vnd.matic.slam-scene"});return n==="live"&&i.set("X-Matic-Prefer-Cached","1"),r&&i.set("If-None-Match",r),this.#s("scene",t,{headers:i},B.scene,o,async(l,c)=>{let d=Es(l,e),u=Ms(l,s);if(l.status===304)return{scene:null,floorCoherent:u,revision:d,notModified:!0};if(!l.ok)throw new x("scene-request-failed",l.status);if(l.headers.get("Content-Type")?.split(";",1)[0]!=="application/vnd.matic.slam-scene")throw new S("invalid-scene-content-type");return{scene:{...await this.#t.parse(await this.#r(l,c,oe,"invalid-scene-size"),c),revision:d,etag:l.headers.get("ETag"),source:n},floorCoherent:u,revision:d,notModified:!1}})}async sceneDelta(t,e,s,n){let o=t.includes("?")?"&":"?";return this.#s("sceneDelta",`${t}${o}since=${encodeURIComponent(e.revision)}`,{headers:{Accept:"application/vnd.matic.slam-delta, application/vnd.matic.slam-scene"}},B.delta,n,async(r,i)=>{let l=Es(r,e.revision),c=Ms(r,s);if(r.status===204){if(l!==e.revision)throw new S("invalid-scene-delta-revision");return{scene:null,floorCoherent:c,revision:l,notModified:!0}}if(!r.ok)throw new x("delta-request-failed",r.status);if(l<=e.revision)throw new S("invalid-scene-delta-revision");let d=r.headers.get("Content-Type")?.split(";",1)[0];if(d!=="application/vnd.matic.slam-delta"&&d!=="application/vnd.matic.slam-scene")throw new S("invalid-scene-delta-content-type");let u=d==="application/vnd.matic.slam-delta",m=u?fe+re:oe,h=Number(r.headers.get("Content-Length"));if(Number.isFinite(h)&&h>m)throw new S(u?"invalid-scene-delta-size":"invalid-scene-size");let f=await this.#r(r,i,m,u?"invalid-scene-delta-size":"invalid-scene-size");if(u){let y=Number(r.headers.get("X-Matic-Base-Revision"));if(!Number.isSafeInteger(y)||y!==e.revision)throw new S("invalid-scene-delta-base");let _=await this.#t.decodeDelta(f,e,i);if(_.revision!==l)throw new S("invalid-scene-delta-revision");return{scene:{..._.parsed,revision:l,etag:r.headers.get("ETag"),source:"live",..._.deltaHint?{deltaHint:_.deltaHint}:{}},floorCoherent:c,revision:l,notModified:!1}}return{scene:{...await this.#t.parse(f,i),revision:l,etag:r.headers.get("ETag"),source:"live"},floorCoherent:c,revision:l,notModified:!1}})}async pose(t,e){return Xt(await this.#h("pose",t,B.pose,e))}async history(t,e){return Kt(await this.#h("history",t,B.history,e))}async plans(t,e){return Yt(await this.#h("plans",t,B.workflow,e))}async areas(t,e){return Vt(await this.#h("areas",t,B.workflow,e))}async previewRoomSequence(t,e,s,n){if(!t||t.length>255||e.length<1||e.length>100)throw new S("invalid-room-sequence-preview-request");if(n?.aborted)throw new DOMException("Aborted","AbortError");let o=this.#e()?.connection;if(!o?.sendMessagePromise)throw new x("preview-unavailable");let r=null,i=()=>{},l=new Promise((_,M)=>{i=M}),c=this.#n.get(o),d,u=new Promise(_=>{d=_});this.#n.set(o,u);let m=!1,h=()=>{m||(m=!0,d(),this.#n.get(o)===u&&this.#n.delete(o))},f=!1,w=()=>{i(new DOMException("Aborted","AbortError")),f&&(h(),r!==null&&window.clearTimeout(r),r=null)};n?.addEventListener("abort",w,{once:!0});let y=new Promise((_,M)=>{r=window.setTimeout(()=>{r=null,M(new x("preview-timeout"))},B.roomPreview)});y.catch(()=>{f&&h()});try{if(c&&(await Promise.race([c,l,y]),n?.aborted))throw new DOMException("Aborted","AbortError");let _=ye.get(o)??0;if(_>=ln)throw new x("preview-unavailable");let M=o.sendMessagePromise({type:"call_service",domain:"matic_robot",service:"preview_room_sequence",target:{entity_id:t},service_data:{rooms:e.map(P=>({room:P.room,cleaning_mode:P.cleaning_mode,coverage_setting:P.coverage_setting})),use_room_schedule:!0,override_room_schedule:s},return_response:!0});ye.set(o,_+1),f=!0;let R=!1,v=()=>{if(!R){R=!0;let P=(ye.get(o)??1)-1;P===0?ye.delete(o):ye.set(o,P)}h(),r!==null&&window.clearTimeout(r),r=null};M.then(v,v);let g=await Promise.race([M,l,y]);if(n?.aborted)throw new DOMException("Aborted","AbortError");if(!g||typeof g!="object"||Array.isArray(g)||!("response"in g))throw new S("invalid-room-sequence-preview-envelope");return Ut(g.response)}finally{f||(c?c.then(h,h):h(),r!==null&&window.clearTimeout(r),r=null),n?.removeEventListener("abort",w)}}async saveArea(t,e,s){let n=await this.#h("areaSave",t,B.mutation,s,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...e.areaId?{area_id:e.areaId}:{},name:e.name,circles:e.circles,...e.outline?.closed?{outline:e.outline.points}:{},cleaning_mode:e.cleaningMode,coverage_setting:e.coverageSetting})});if(!n||typeof n!="object"||typeof n.id!="string")throw new S("invalid-area-save-response");return n.id}async deleteArea(t,e,s){await this.#s("areaDelete",`${t}?area_id=${encodeURIComponent(e)}`,{method:"DELETE",headers:{Accept:"application/json"}},B.mutation,s,async n=>{if(!n.ok)throw new x("area-delete-failed",n.status)})}async service(t,e,s,n,o={}){let r=this.#e();if(this.#i||typeof r?.callService!="function")throw new x("service-unavailable");let i=null,l=null;try{let c=o.returnResponse?r.callService(t,e,s,{entity_id:n},!0,!0):r.callService(t,e,s,{entity_id:n});return!o.returnResponse&&!o.acknowledgementTimeout?await c:await Promise.race([c,new Promise((d,u)=>{l=()=>{i!==null&&window.clearTimeout(i),i=null,u(new DOMException("Aborted","AbortError"))},this.#o.add(l),i=window.setTimeout(()=>u(new x("mutation-timeout")),B.mutation)})])}catch(c){throw cn(c,r.localize)??c}finally{i!==null&&window.clearTimeout(i),l&&this.#o.delete(l)}}dispose(){if(!this.#i){this.#i=!0,this.#l.dispose();for(let t of this.#o)t();this.#o.clear(),this.#t.dispose()}}};var Ps=()=>({version:4,view:"top",appearance:"photo",labels:!0,quality:"auto",cameras:{}}),ge=(a,t,e)=>Math.max(t,Math.min(e,a)),xs=a=>a.replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",mt=(a,t=4)=>`matic-map-studio:v${t}:${xs(a)}`,dn=a=>{if(!a||typeof a!="object")return null;let t=a;return["yaw","pitch","zoom","targetX","targetZ"].every(s=>typeof t[s]=="number"&&Number.isFinite(t[s]))?{yaw:ge(t.yaw,-Math.PI,Math.PI),pitch:ge(t.pitch,.18,Math.PI/2-.018),zoom:ge(t.zoom,.01,100),targetX:ge(t.targetX,-1e4,1e4),targetZ:ge(t.targetZ,-1e4,1e4)}:null},Cs=a=>{let t=Ps();if(!a||typeof a!="object")return t;let e=a,s=e.view==="three"||e.view==="top"||e.view==="rooms"?e.view:t.view,n=s==="rooms"?"top":s,o=e.quality==="auto"||e.quality==="efficient"||e.quality==="balanced"||e.quality==="maximum"?e.quality:t.quality,r=e.cameras&&typeof e.cameras=="object"?e.cameras:{},i={};for(let l of["three","top"]){let c=dn(r[l]);c&&(i[l]=c)}return{version:4,view:n,appearance:e.appearance==="rooms"||e.appearance==="photo"?e.appearance:t.appearance,labels:typeof e.labels=="boolean"?e.labels:t.labels,quality:o,cameras:i}},ze=class{#e="local-user";#t=null;#n=null;load(t){this.#o(),this.#e=xs(t);try{let e=window.localStorage.getItem(mt(this.#e));if(e)return Cs(JSON.parse(e));for(let s of[3,2]){let n=window.localStorage.getItem(mt(this.#e,s));if(n)return Cs(JSON.parse(n))}}catch{}return Ps()}schedule(t){this.#t!==null&&window.clearTimeout(this.#t),this.#n={key:mt(this.#e),value:t},this.#t=window.setTimeout(()=>this.#o(),250)}#o(){this.#t!==null&&window.clearTimeout(this.#t),this.#t=null;let t=this.#n;if(this.#n=null,!!t)try{window.localStorage.setItem(t.key,JSON.stringify(t.value))}catch{}}dispose(){this.#o()}};var vt=1,ce=Number.MAX_SAFE_INTEGER,Os=Number.MAX_SAFE_INTEGER,Ts=64,un=1e12,ft=4,As=16*1024,hn=250,pn=4e3,Be=3e4;function q(a){return a!==null&&typeof a=="object"&&!Array.isArray(a)?a:null}function Y(a,t){return typeof a=="number"&&Number.isSafeInteger(a)&&a>=0&&a<=t}function Ds(a){let t=q(a);if(!t)return null;let e={};for(let[s,n]of Object.entries(t)){if(s.length===0||s.length>128||!Y(n,Os))return null;e[s]=n}return e}function mn(a){let t=q(a);if(!t||Object.keys(t).length>128)return null;let e={};for(let[s,n]of Object.entries(t)){if(s.length===0||s.length>128||!Y(n,Os))return null;e[s]=n}return e}function Ls(a){return typeof a=="string"&&a.length>0&&a.length<=256?a:Y(a,ce)?String(a):null}function fn(a){let t=q(a),e=Ls(t?.epoch);if(!t||t.schema!==vt||e===null)return null;let s=mn(t.capabilities),n=Ds(t.revisions);return!s||!n||!Y(t.sequence,ce)||!Y(t.coherence_generation,ce)||t.coherence_generation===0?null:{schema:t.schema,capabilities:s,epoch:e,sequence:t.sequence,coherence_generation:t.coherence_generation,revisions:n}}function Is(a,t){let e=q(a),s=fn(e?.snapshot??a);if(!s)return null;let n=q(e?.snapshot??a);if(!n||!("payload"in n))return null;let o=n.entry_id,r=q(n.identity),i=q(n.status),l=q(n.payload),c=i?i.reason===null?null:qs(i.reason):null,d=l?.available,u=null;if(l?.entry!==void 0&&l.entry!==null){if((()=>{try{return JSON.stringify(l.entry).length}catch{return As+1}})()>As)return null;try{u=Ie({entries:[l.entry]})[0]??null}catch{return null}}let m=i?.state;return typeof o!="string"||o.length===0||o.length>128||t!==void 0&&o!==t||!r||r.entry_id!==o||r.floor_mission_id!==null&&!Y(r.floor_mission_id,ce)||typeof r.floor_verified!="boolean"||r.floor_verified!==(r.floor_mission_id!==null)||!i||m!=="ready"&&m!=="stale"&&m!=="unavailable"||i.reason!==null&&c===null||typeof i.retryable!="boolean"||typeof d!="boolean"||u!==null&&u.entryId!==o||m==="ready"&&(c!==null||i.retryable||!d)||(m==="stale"||m==="unavailable")&&(c===null||d)||c==="authorization"&&i.retryable?null:{...s,entry_id:o,identity:{entry_id:o,floor_mission_id:r.floor_mission_id,floor_verified:r.floor_verified},status:{state:m,reason:c,retryable:i.retryable},payload:{available:d,entry:u}}}function $s(a){let t=q(a),e=Ls(t?.epoch),s=Ds(t?.revisions),n=t?.resources;return e===null||!s||!Y(t?.sequence,ce)||!Y(t?.coherence_generation,ce)||t.coherence_generation===0||!Array.isArray(n)||n.length>128||!n.every(o=>typeof o=="string"&&o.length<=128)?null:{epoch:e,sequence:t.sequence,coherence_generation:t.coherence_generation,revisions:s,resources:n}}var Ne=["gap","overflow","reconnect","invalid_message","server_request","restart","entry_removed","authorization","snapshot_required"];function qs(a){return typeof a=="string"&&Ne.includes(a)?a:null}function vn(a){let t=q(a);return t?.name==="AbortError"?"aborted":t?.name==="TimeoutError"?"timedOut":"failed"}function yn(){return Object.fromEntries(Ne.map(a=>[a,new le]))}var He=class{#e;#t;#n;#o=null;#l=!1;#i=!1;#r=!1;#s=!1;#h=!1;#v=!1;#d=0;#S=!1;#_=!1;#y=!1;#f=!1;#c=null;#m=null;#E=0;#I=!1;#g=null;#R=-1;#u=new Map;#M=!1;#K=!1;#W=null;#a=[];#D=new le;#b=yn();#T=null;#k=null;#A=null;constructor(t,e){this.#e=t,this.#t=e,this.#n=Math.max(1,Math.min(Ts,e.maxPendingInvalidations??Ts))}async start(){if(!(this.#l||this.#K)){this.#K=!0;try{await this.#z(!1)}catch(t){this.#te(t),this.#w("reconnect")}}}notifyReconnect(){(this.#s||this.#v)&&(this.#H(),this.#ee("aborted"),this.#d+=1),this.#E=0,this.#S=!1,this.#s=!1,this.#h=!1,this.#c!==null&&window.clearTimeout(this.#c),this.#c=null,this.requestResync("reconnect"),this.#r&&this.#L(0,!0)}requestResync(t="server_request"){this.#w(t,!0)}diagnostics(){let t=Object.fromEntries(Ne.map(s=>[s,this.#b[s].snapshot()])),e=this.#k!==null&&this.#A!==null?Object.freeze({reason:this.#k,durationMs:Math.round(Math.min(un,Math.max(0,performance.now()-this.#A))*100)/100}):null;return Object.freeze({snapshotAttempts:this.#D.snapshot(),recoveryEpisodes:Object.freeze(t),activeRecovery:e})}dispose(){if(!this.#l){this.#l=!0,this.#c!==null&&window.clearTimeout(this.#c),this.#c=null,this.#r=!1,this.#o?.(),this.#o=null,this.#u.clear(),this.#a=[],this.#T=null,this.#k=null,this.#A=null,this.#D.dispose();for(let t of Ne)this.#b[t].dispose()}}#U(t){if(this.#l)return;let e=q(t),s=q(e?.event)??e,n=s?.type;if(n==="resync"){let r=qs(s?.reason);if(!r){this.#w("invalid_message");return}if(r==="entry_removed"){this.#t.onEvent({type:"resync",reason:r}),this.dispose();return}this.#w(r);return}if(this.#s){if(n==="invalidate"){let r=$s(s?.invalidation??s);r?this.#j(r):(this.#a=[],this.#I=!0)}return}let o=n==="snapshot"?Is(s?.snapshot??s,this.#t.entryId):n==="invalidate"?$s(s?.invalidation??s):null;if(!o){this.#w("invalid_message");return}if(n==="snapshot"){let r=o;if(this.#r)return;if(this.#g!==null&&r.epoch!==this.#g){this.#w("restart");return}this.#V(r);return}this.#J(o)}#V(t){this.#g===t.epoch&&t.sequence<this.#R||(this.#g=t.epoch,this.#R=t.sequence,this.#u.clear(),this.#t.onEvent({type:"snapshot",snapshot:t}))}#Z(t){let e=this.#a;if(this.#a=[],this.#V(t),this.#l)return;let s=t.sequence+1;for(let n of e)if(n.epoch===t.epoch&&!(n.sequence<=t.sequence)&&!(n.sequence<s)){if(n.sequence!==s){this.#a=e.filter(o=>o.epoch===t.epoch&&o.sequence>=s),this.#w("gap");return}this.#J(n),s+=1}}#J(t){if(this.#r){this.#j(t);return}if(this.#g===null){this.#j(t);return}if(this.#g!==t.epoch){this.#j(t),this.#w("reconnect");return}if(!(t.sequence<=this.#R)){if(t.sequence!==this.#R+1){this.#j(t),this.#w("gap");return}this.#R=t.sequence;for(let e of t.resources)this.#u.set(e,t);if(this.#u.size>this.#n){this.#u.clear(),this.#w("overflow");return}this.#M||(this.#M=!0,queueMicrotask(()=>this.#he()))}}#j(t){this.#a.length>=this.#n?(this.#a=[],this.#I=!0,this.#w("overflow")):this.#a.push(t)}#he(){if(this.#M=!1,this.#l||this.#s||this.#u.size===0){this.#s&&this.#u.clear();return}let t=[...this.#u.values()];this.#u.clear();let e=t.reduce((n,o)=>!n||o.sequence>n.sequence?o:n,null);if(!e)return;let s=[...new Set(t.flatMap(n=>n.resources))];this.#t.onEvent({type:"invalidation",invalidation:{...e,resources:s}})}#w(t,e=!1){if(!this.#l){if(t==="authorization"){this.#$(),this.#t.onEvent({type:"resync",reason:t});return}if(!this.#s&&(this.#Q(t),this.#i||(this.#i=!0,this.#t.onEvent({type:"resync",reason:t}),queueMicrotask(()=>{this.#i=!1})),t!=="entry_removed")){let s=e&&!this.#S;if(s&&(this.#S=!0),s&&this.#c!==null&&(window.clearTimeout(this.#c),this.#c=null),this.#y){if(this.#f){s&&this.#L(0,!0);return}this.#f=!0,this.#p(s);return}if(e&&this.#r){s&&(this.#_=!0);return}let n=this.#E>=ft?Be:0;this.#L(s?0:n,s)}}}#L(t,e=!1){if(!this.#l){if(this.#c!==null){if(!e)return;window.clearTimeout(this.#c),this.#c=null}if(this.#r){this.#m=e?t:Math.max(this.#m??0,t);return}this.#c=window.setTimeout(()=>{this.#c=null,this.#z(!0)},t)}}#p(t=!1){let e=this.#E>=ft?Be:Math.min(hn*2**this.#E,pn);this.#E<ft&&(this.#E+=1),this.#L(t?0:e,t)}async#z(t,e=!1){if(this.#l||this.#r)return;t&&this.#Q(e?"authorization":"snapshot_required");let s=this.#d;this.#r=!0,this.#v=e;try{if(t&&await this.#B(),this.#l||this.#s&&!e||s!==this.#d)return;let n={startedAt:performance.now(),generation:s};this.#T=n;let o="completed",r;try{r=await this.#e.sendMessagePromise({type:"matic_robot/workspace_snapshot",version:vt,entry_id:this.#t.entryId})}catch(c){throw o=vn(c),c}finally{this.#N(n,o)}if(this.#l||this.#s&&!e||s!==this.#d)return;let i=Is(r,this.#t.entryId);if(!i)throw new Error("invalid-workspace-snapshot");if(i.status.reason==="authorization"){this.#$(),this.#t.onEvent({type:"snapshot",snapshot:i});return}if(i.status.state!=="ready"&&i.status.retryable)throw new Error("workspace-snapshot-retryable");e&&(this.#s=!1,this.#h=!1,this.#c!==null&&window.clearTimeout(this.#c),this.#c=null),this.#r=!1,this.#y=!0,this.#f=!1;try{t?this.#pe(i):this.#Z(i)}finally{this.#y=!1}let l=this.#f||this.#I;this.#f?this.#_&&(this.#_=!1,this.#L(0,!0)):(this.#E=0,this.#S=!1,this.#_=!1),!t&&!this.#l&&await this.#B(),this.#I&&(this.#I=!1,this.#w("overflow")),t&&i.status.state==="ready"&&!l&&!this.#l&&s===this.#d&&this.#ee("completed")}catch(n){if(this.#l||this.#s&&!e||s!==this.#d)return;if(this.#te(n),this.#Y(n))this.#$(),this.#t.onEvent({type:"resync",reason:"authorization"});else if(!e){t||this.#Q("reconnect");let o=this.#_;this.#_=!1,this.#p(o)}}finally{this.#r=!1,this.#v=!1,this.#h?(this.#h=!1,this.#X(0)):e&&this.#s&&this.#X(Be);let n=this.#m;this.#m=null,n!==null&&this.#L(n)}}async#B(){if(this.#l||this.#o)return;if(this.#W)return this.#W;let t=(async()=>{let e=await this.#e.subscribeMessage(s=>this.#U(s),{type:"matic_robot/workspace_subscribe",version:vt,entry_id:this.#t.entryId});this.#l?e():this.#o=e})();this.#W=t;try{await t}finally{this.#W===t&&(this.#W=null)}}#pe(t){let e=this.#a;if(this.#a=[],this.#g===t.epoch&&t.sequence<this.#R){this.#a=e,this.#w("snapshot_required");return}if(this.#V(t),this.#l)return;let s=t.sequence+1;for(let n of e)if(n.epoch===t.epoch&&!(n.sequence<=t.sequence)&&!(n.sequence<s)){if(n.sequence!==s){this.#a=e.filter(o=>o.sequence>=s),this.#w("gap");return}this.#J(n),s+=1}}#Y(t){let e=q(t),s=e?.code,n=e?.status??e?.statusCode;return s==="unauthorized"||s==="not_authorized"||s==="auth_invalid"||n===401||n===403}#Q(t){this.#k!==null||this.#l||(this.#k=t,this.#A=performance.now())}#ee(t){let e=this.#k,s=this.#A;this.#k=null,this.#A=null,!(e===null||s===null||this.#l)&&this.#b[e].record(t,performance.now()-s)}#N(t,e){this.#T!==t||this.#l||t.generation!==this.#d||(this.#T=null,this.#D.record(e,performance.now()-t.startedAt))}#H(){let t=this.#T;t!==null&&(this.#T=null,!this.#l&&t.generation===this.#d&&this.#D.record("aborted",performance.now()-t.startedAt))}#$(){this.#H(),this.#ee("failed"),this.#d+=1,this.#s||(this.#s=!0,this.#c!==null&&window.clearTimeout(this.#c),this.#c=null,this.#h=!1),this.#u.clear(),this.#a=[],this.#I=!1,this.#m=null,this.#E=0,this.#S=!1,this.#_=!1,this.#v||this.#X(Be)}#X(t){this.#l||this.#c!==null||this.#h||(this.#c=window.setTimeout(()=>{if(this.#c=null,!this.#l){if(this.#r){this.#h=!0;return}this.#z(!0,!0)}},t))}#te(t){this.#t.onError?.(t instanceof Error?t:new Error("Workspace transport failed"))}};var Fe=class{#e;#t;#n=document.visibilityState!=="hidden";#o=!1;#l=!1;#i=!1;constructor({onSuspend:t,onResume:e}){this.#e=t,this.#t=e}get active(){return this.#n}start(){this.#o||this.#l||(this.#o=!0,window.addEventListener("pagehide",this.#r),window.addEventListener("pageshow",this.#s),document.addEventListener("visibilitychange",this.#h),document.visibilityState==="hidden"&&(this.#n?this.#d(!1):this.#e()))}dispose(){this.#l||(this.#l=!0,this.#o&&(window.removeEventListener("pagehide",this.#r),window.removeEventListener("pageshow",this.#s),document.removeEventListener("visibilitychange",this.#h)))}#r=()=>{this.#i=!0,this.#d(!1)};#s=t=>{if(this.#i=!1,t.persisted){document.visibilityState==="hidden"?this.#d(!1):(this.#d(!1),this.#d(!0));return}this.#v()};#h=()=>{this.#v()};#v(){if(this.#i||document.visibilityState==="hidden"){this.#d(!1);return}this.#d(!0)}#d(t){this.#n===t||this.#l||(this.#n=t,t?this.#t():this.#e())}};var p=(a,t,e=null)=>({status:a,value:t,problem:e}),be=a=>a.status==="loading"?p("idle",a.value):a,W=a=>a instanceof DOMException&&a.name==="AbortError",U=(a,t)=>a instanceof x||a&&typeof a=="object"&&"code"in a&&typeof a.code=="string"?a.code:t,C={stopUnconfirmed:E("error","v4_notice_stop_unconfirmed","Home Assistant can't confirm the robot stopped, so press Stop again if it's still moving."),actionUnconfirmed:E("error","v4_notice_action_unconfirmed","Home Assistant can't confirm that command, so check the robot before trying again."),mapChanged:E("info","v4_notice_map_changed","The map changed, so choose what to clean again."),statusRefreshed:E("info","v4_notice_status_refreshed","Status refreshed, so check the robot before trying again."),saving:E("info","v4_notice_saving","Saving\u2026"),planSaved:E("success","v4_notice_plan_saved","Plan saved"),planSaveFailed:E("error","v4_notice_plan_save_failed","Home Assistant can't confirm the plan was saved, so check your plans, then try again."),planDeleted:E("success","v4_notice_plan_deleted","Plan deleted"),planDeleteFailed:E("error","v4_notice_plan_delete_failed","The plan wasn't deleted; try again."),planPreviewMissing:E("warning","v4_notice_plan_preview_missing","The next-run preview isn't ready; reload your plans, then try again."),planPreviewRefreshFailed:E("warning","v4_notice_plan_preview_refresh_failed","The next-run preview didn't refresh; check the plan, then try again."),planPreviewNone:E("warning","v4_notice_plan_preview_none","This plan has no next-run preview; review its rooms and schedules."),planPreviewChanged:E("info","v4_notice_plan_preview_changed","The next run changed; check it before you run the plan."),roomPreviewBlocked:E("warning","v4_notice_room_preview_blocked","A room can't use these settings, so check the note above the rooms."),roomPreviewChanged:E("info","v4_notice_room_preview_changed","The room settings changed, so check them and start again."),roomPreviewFailed:E("warning","v4_notice_room_preview_failed","Home Assistant couldn't check the room settings, so try starting again."),areaRemoved:E("warning","v4_notice_area_removed","This saved Area was removed elsewhere. Your edits are preserved as a new Area draft; saving will create a new Area."),areaSaving:E("info","v4_notice_area_saving","Saving area\u2026"),areaSaved:E("success","v4_notice_area_saved","Area saved"),areaSaveFailed:E("error","v4_notice_area_save_failed","Home Assistant can't confirm the area was saved, so try again."),areaDeleted:E("success","v4_notice_area_deleted","Area deleted"),areaDeleteFailed:E("error","v4_notice_area_delete_failed","Home Assistant can't confirm the area was deleted, so try again."),resetMop:E("success","v4_notice_reset_mop","Mopping progress reset"),resetVacuum:E("success","v4_notice_reset_vacuum","Vacuum rotation progress reset"),resetMopFailed:E("error","v4_notice_reset_mop_failed","Mopping progress wasn't reset; try again."),resetVacuumFailed:E("error","v4_notice_reset_vacuum_failed","Vacuum rotation progress wasn't reset; try again.")},gn=a=>E("warning","v4_notice_saved_map","Showing the saved map from {date} without the robot's position.",{date:a}),Ws={coverage_identity_unavailable:E("error","v4_notice_coverage_task_unknown","Home Assistant can't confirm the current clean, so check the robot first."),coverage_activity_unavailable:E("error","v4_notice_coverage_activity_unknown","Home Assistant can't confirm whether the robot is cleaning, so check it first."),coverage_native_session_active:E("error","v4_notice_coverage_robot_busy","The robot is already cleaning, so wait for it to finish."),coverage_identity_changed:E("error","v4_notice_coverage_task_changed","The clean changed while starting, so check the robot first.")},bn=a=>a instanceof x&&Object.hasOwn(Ws,a.code)?Ws[a.code]??null:null,de=a=>[a.selectedFloorOrdinal??"none",a.mapFloorOrdinal??"none",a.mapFloorCoherent?"coherent":"transition"].join(":"),ue=a=>[a.mapFloorOrdinal??"none",a.mapSessionVerified?"verified":"unverified",a.mapSessionKey??"no-session"].join(":"),F=a=>[a.entryId,a.selectedFloorOrdinal??"none",a.mapFloorOrdinal??"none"].join("|"),T=a=>[a.entryId,de(a),ue(a)].join("|"),yt=a=>[T(a),a.mapRevision].join("|"),Ke=a=>a.runnerLocked||a.stopSettlePending||a.activePlan||a.nativeReconciliationPending||a.nativeSessionActive===!0,Ue=(a,t)=>a.entryKey===t.entryKey&&a.generation===t.generation&&a.floorKey===t.floorKey&&a.missionKey===t.missionKey,wn=1e3,_n=5e3,kn=["rooms","plans","plan","draw","areaReview"],zs=["plan-mutation","area-mutation"],Bs=a=>JSON.stringify({...a,previewToken:void 0}),Ve=(a,t)=>a.label?a.label:a.active?"Current floor":`Saved floor ${a.ordinal??t}`,je=class{#e;#t;#n;#o;#l=new ze;#i=null;#r=new Map;#s=null;#h=null;#v=null;#d=null;#S=0;#_=!1;#y=!1;#f=!1;#c=!1;#m=null;#E=Promise.resolve();#I=!1;#g=!1;#R="";#u=null;#M=0;#K=null;#W="";#a=!1;#D=!0;#b=null;#T=null;#k=null;#A=null;#U="";#V=!1;#Z;#J;workspaceDiagnostics(){return this.#b?.diagnostics()??null}constructor(t,e,s=null,n){this.#e=t,this.#t=new At(t.value.generation),this.#n=e,this.#Z=s,this.#J=n,this.#o=new Fe({onSuspend:()=>this.#j(),onResume:()=>{this.#he()}}),this.#e.patch({pageActive:this.#o.active}),this.#A=t.subscribe(o=>{this.#w(o),this.#B()}),this.#o.start()}#j(){this.#N(!1,zs),this.#O(),this.#q(zs),this.#f=!1,this.#c=!1,this.#m=null,this.#g=!1,this.#de();let t=this.#e.value;this.#e.patch({resources:{...t.resources,catalog:be(t.resources.catalog),scene:be(t.resources.scene),history:be(t.resources.history),plans:be(t.resources.plans),areas:be(t.resources.areas),pose:p("idle",null)}})}async#he(){if(this.#a||!this.#o.active)return;this.#e.patch({pageActive:!0});let t=this.#s;if(this.#a||!this.#o.active||!t?.host.connected||!t.host.administrator||!t.host.robotConnected||t.host.robotCount===0)return;let e=this.#e.value;this.#we(),this.#Y(t),await this.refreshCatalog(!0,!0);let s=this.#e.value,n=s.resources.entry;if(this.#a||!this.#o.active||e.dataMode!=="history"||s.generation!==e.generation||s.dataMode!=="history"||s.selection.entryId!==e.selection.entryId||s.selection.floorId!==e.selection.floorId||s.selection.historyId!==e.selection.historyId||s.resources.catalog.status!=="ready"||!n||n.entryId!==s.selection.entryId)return;let o=s.resources.history.value?.floors.find(u=>u.id===s.selection.floorId),r=o?.snapshots.find(u=>u.id===s.selection.historyId);if(!o)return;let i=this.#t.begin(n.entryId,o.id,r?.id??o.id,r?.revision??0);if(this.#e.patch({generation:i.generation}),await this.#oe(n,i),!this.#t.accepts(i)||!this.#o.active||this.#e.value.resources.history.status!=="ready")return;let l=this.#e.value,c=l.resources.history.value?.floors.find(u=>u.id===o.id),d=c?.snapshots.find(u=>u.id===r?.id);!c||r&&!d||(d&&d.revision!==i.revision&&(i=this.#t.begin(n.entryId,o.id,d.id,d.revision)),this.#e.patch({generation:i.generation,coherence:"current"}),d&&(!l.resources.scene.value||d.revision!==r?.revision)&&await this.#ce(d,i))}#w(t){if(!t.owner)return;let e={version:4,view:t.view,appearance:t.appearance,labels:t.labelsVisible,quality:t.quality,cameras:t.cameras},s=this.#i;this.#i=e,!(!s||s.view===e.view&&s.appearance===e.appearance&&s.labels===e.labels&&s.quality===e.quality&&s.cameras===e.cameras)&&this.#l.schedule(e)}#L(t){let e=Pt(t),s=t.resources.entry,n=this.#s?.vacuumEntityId;if(!e||!s||!n||!t.selection.entryId||t.workflow!=="rooms"||t.dataMode!=="live"||t.floor.readOnly||t.coherence!=="current"||!t.host.connected||!t.host.administrator||!t.host.robotConnected||t.command!=="idle"||t.resources.plans.status!=="ready")return null;let o=t.selection.roomIds.map(r=>{let i=t.selection.roomSettings.find(l=>l.roomId===r);return i?{room:r,cleaning_mode:i.cleaningMode,coverage_setting:i.coverageSetting}:null});return o.some(r=>r===null)?null:{key:e,generation:t.generation,retryRevision:t.manualRoomPreviewRetry,floorKey:de(s),missionKey:ue(s),entryId:t.selection.entryId,entityId:n,rooms:o,overrideRoomSchedule:!t.selection.useRoomSchedule}}#p(t){return JSON.stringify([t.key,t.generation,t.retryRevision,t.floorKey,t.missionKey,t.entryId,t.entityId])}#z(t){let e=this.#L(this.#e.value);return!this.#a&&e!==null&&this.#p(e)===this.#p(t)}#B(){if(this.#a||!this.#s)return;let t=this.#e.value,e=this.#L(t);if(!e){this.#r.get("room-preview")?.abort(),this.#r.delete("room-preview"),this.#U="",(t.manualRoomPreview.status!=="idle"||t.manualRoomPreview.value!==null)&&this.#e.patch({manualRoomPreview:p("idle",null)});return}let s=this.#p(e),n=Ge(t);if(n&&n.key===e.key&&n.generation===e.generation&&n.floorKey===e.floorKey&&n.missionKey===e.missionKey&&n.preview.entryId===e.entryId){this.#U=s;return}if(this.#U===s)return;this.#r.get("room-preview")?.abort(),this.#U=s;let o=this.#P("room-preview");this.#e.patch({manualRoomPreview:p("loading",null)}),this.#pe(e,o)}async#pe(t,e){try{let s=await this.#n.previewRoomSequence(t.entityId,t.rooms,t.overrideRoomSchedule,e.signal);return!this.#z(t)||e.signal.aborted||s.entryId!==t.entryId?null:(this.#e.patch({manualRoomPreview:p("ready",{key:t.key,generation:t.generation,floorKey:t.floorKey,missionKey:t.missionKey,preview:s})}),s)}catch(s){return W(s)||e.signal.aborted||!this.#z(t)||this.#e.patch({manualRoomPreview:p("error",null,U(s,"preview-unavailable"))}),null}finally{this.#x("room-preview",e)}}sync(t){if(this.#a)return;let e=this.#b,s=this.#s?.host.robotConnected??null,n=this.#s?.host.administrator===!1&&t.host.administrator,o=this.#s!==null&&!this.#s.host.robotConnected&&t.host.robotConnected,r=this.#e.value.owner,i=r!==null&&(r.entryKey!==t.entryKey||r.userKey!==t.userKey);i&&(this.#se("context-changed",t.entryKey),this.#_&&(this.#f=!0,this.#c=!1,this.#m=null));let l=this.#D;this.#D=t.host.connected,this.#s=t,this.#Y(t),o&&e&&e===this.#b&&e.notifyReconnect();let c=t.userKey!==this.#W?this.#l.load(t.userKey):null;if(c&&(this.#W=t.userKey,this.#i=c),this.#e.patch({owner:{userKey:t.userKey,entryKey:t.entryKey},host:t.host,activity:t.activity,batteryPercent:t.batteryPercent,robotLabel:t.robotLabel,robots:t.robots,locale:t.language,selection:{...this.#e.value.selection,entryId:t.entryKey},...c?{view:c.view,appearance:c.appearance,labelsVisible:c.labels,quality:c.quality,cameras:c.cameras}:{}}),!t.host.administrator){this.#O(),this.#se("access-required",t.entryKey);return}if(!t.host.connected){l&&(this.#e.patch({generation:this.#t.invalidate()}),this.#$(),this.#R=""),this.#O(),this.#f=!1,this.#c=!1,this.#m=null,this.#g=!1,this.#q();let d=this.#e.value,u=d.resources.scene.value;this.#e.patch({coherence:u?"degraded":"unavailable",resources:{...d.resources,catalog:d.resources.catalog.status==="loading"?p("idle",d.resources.catalog.value):d.resources.catalog,plans:d.resources.plans.status==="loading"?p("idle",d.resources.plans.value):d.resources.plans,areas:d.resources.areas.status==="loading"?p("idle",d.resources.areas.value):d.resources.areas,pose:p("idle",null)},map:{...d.map,available:u!==null,exactPose:!1}});return}if(t.host.robotCount===0){this.#O(),this.#se("map-unavailable",t.entryKey);return}if(t.entryKey&&!t.vacuumEntityId){this.#O(),this.#se("no-loaded-robot",t.entryKey);return}if(!t.host.robotConnected){s!==!1&&(this.#N(),this.#q(),this.#f=!1,this.#c=!1,this.#m=null,this.#g=!1),this.#O();let d=this.#e.value,u=d.resources.scene.value;this.#e.patch({coherence:u?"degraded":"unavailable",resources:{...d.resources,catalog:d.resources.catalog.status==="loading"?p("idle",d.resources.catalog.value):d.resources.catalog,scene:d.resources.scene.status==="loading"?p("idle",u):d.resources.scene,pose:p("idle",null)},map:{...d.map,available:u!==null,exactPose:!1}});return}if(this.#o.active){if(this.#we(),!l||o||n){this.refreshCatalog(!0,!0);return}(i||this.#e.value.resources.catalog.status==="idle"||t.entryKey&&t.entryKey!==this.#e.value.selection.entryId)&&this.refreshCatalog(!0)}}#Y(t){let e=t.entryKey,s=this.#e.value,n=s.resources.catalog.value?.find(l=>l.entryId===e),o=s.resources.entry;if(!(this.#J??!!(n?.liveWorkspaceTransportEnabled&&o?.entryId===e&&o.liveWorkspaceTransportEnabled))||!this.#Z||!t.host.administrator||!t.host.connected||!t.vacuumEntityId||!e||!this.#o.active){this.#de();return}if(this.#b&&this.#T===e)return;this.#b?.dispose(),this.#k=null;let i=new He(this.#Z,{entryId:e,onEvent:l=>{if(!(this.#a||!this.#o.active||this.#b!==i||this.#T!==e||this.#s?.entryKey!==e)){if(l.type==="resync"&&l.reason==="entry_removed"){i.dispose(),this.#b===i&&(this.#b=null,this.#T=null,this.#k=null);return}if(l.type==="snapshot"){let{snapshot:c}=l,d=this.#e.value.resources.entry,u=c.payload.entry;if(c.entry_id!==e||c.identity.entry_id!==e)return;if(u&&(u.entryId!==e||c.identity.floor_verified!==(u.mapFloorCoherent&&u.mapSessionVerified))){i.requestResync("invalid_message");return}let m=!u&&d?.entryId===e&&c.identity.floor_verified!==(d.mapFloorCoherent&&d.mapSessionVerified);if(c.status.reason==="authorization"){this.#k=null,this.#H(e,["plans","areas","history"]);return}let h=this.#k,f=[],w=h!==null&&h.epoch!==c.epoch;if(h&&h.epoch===c.epoch){let R=new Set([...Object.keys(h.revisions),...Object.keys(c.revisions)]),v=[...R].some(g=>(c.revisions[g]??-1)<(h.revisions[g]??-1));if(c.coherence_generation<h.coherenceGeneration||c.coherence_generation===h.coherenceGeneration&&v){i.requestResync("restart");return}f=[...R].filter(g=>(c.revisions[g]??-1)>(h.revisions[g]??-1))}w&&(f=["plans","areas","history"]);let y=h!==null&&(h.epoch!==c.epoch||h.coherenceGeneration!==c.coherence_generation),_=!!(d&&u&&d.entryId===e&&T(d)!==T(u));if(this.#k={entryId:c.entry_id,epoch:c.epoch,sequence:c.sequence,coherenceGeneration:c.coherence_generation,revisions:c.revisions},m){this.#H(e,["plans","areas","history"]);return}if(y||_){this.#H(e,f);return}let M=u!==null&&d?.entryId===e&&this.#ee(u);if(h&&f.length){if(c.sequence<=h.sequence){i.requestResync("invalid_message");return}this.#k=h,this.#Q({epoch:c.epoch,sequence:c.sequence,coherence_generation:c.coherence_generation,revisions:c.revisions,resources:f},e,i,M)}return}if(l.type==="resync"){this.#k=null,l.reason!=="authorization"&&this.#H(e,["plans","areas","history"]);return}this.#Q(l.invalidation,e,i)}}});this.#b=i,this.#T=e,i.start()}#Q(t,e,s,n=!1){let o=this.#k;if(!o||o.entryId!==e||this.#b!==s||t.epoch!==o.epoch||t.sequence<=o.sequence)return;let r=t.coherence_generation!==o.coherenceGeneration,l=[...new Set([...Object.keys(o.revisions),...Object.keys(t.revisions)])].some(h=>(t.revisions[h]??-1)<(o.revisions[h]??-1));if(t.coherence_generation<o.coherenceGeneration||!r&&l){s.requestResync("restart");return}let c=new Set(t.resources),d=[...c].some(h=>(t.revisions[h]??-1)>(o.revisions[h]??-1));if(this.#k={...o,sequence:t.sequence,coherenceGeneration:t.coherence_generation,revisions:t.revisions},!d&&!r)return;if(r){this.#H(e,t.resources);return}c.has("scene")&&c.delete("scene");let u=this.#e.value.resources.entry,m=this.#t.current();!u||u.entryId!==e||!m||c.size&&this.#te(u,m,c,!n)}#ee(t){let e=this.#e.value,s=e.resources.entry;if(!s||T(s)!==T(t))return!1;let n=t.mapRevision===s.mapRevision?t:{...t,mapRevision:s.mapRevision},o=e.resources.catalog,r=o.value?.map(u=>u.entryId===n.entryId?n:u),i=n.mapFloorCoherent&&n.mapSessionVerified,l=n.health==="problem"||n.health==="limited",c=this.#u,d=c?.key===T(n)&&this.#me(c)&&(c.attempt!==null||c.retryTimer!==null);return this.#e.patch({managedLock:Ke(n),coherence:d?"verifying":i?l?"degraded":"current":"verifying",map:{...e.map,available:e.resources.scene.value!==null,complete:n.mapComplete&&!n.mapTruncated,floorCoherent:n.mapFloorCoherent,sessionVerified:n.mapSessionVerified,exactPose:i&&!d?e.map.exactPose:!1},floor:{...e.floor,classifiedCount:Math.max(1,n.historyFloorCount),...d&&e.resources.scene.value?{readOnly:!0}:{}},resources:{...e.resources,entry:n,...r?{catalog:{...o,value:r}}:{}}}),this.#s&&this.#Y(this.#s),!0}#N(t=this.#e.value.pageActive,e=[]){let s=this.#t.invalidate();this.#$();let n=this.#e.value;this.#e.patch({generation:s,pageActive:t,coherence:n.resources.scene.value?"verifying":"unavailable",floor:{...n.floor,readOnly:n.floor.readOnly||n.resources.scene.value!==null},map:{...n.map,exactPose:!1}}),this.#u&&this.#ie(this.#u.key),this.#q(["catalog",...e]),this.#R=""}#H(t,e=[]){this.#C(),this.#N(),this.refreshCatalog(!0,!0).then(()=>{if(this.#a||this.#s?.entryKey!==t||!this.#s.host.administrator||!this.#s.host.connected)return;let s=this.#e.value.resources.entry,n=this.#t.current();if(!s||s.entryId!==t||!n)return;let o=new Set(e);o.delete("history"),this.#te(s,n,o,!1)})}#$(){this.#M+=1,this.#K=null}#X(t){let e=this.#K,s=this.#t.current();return!!(e&&s&&e.generation===this.#M&&e.stamp.generation===s.generation&&e.entryId===t.entryId&&e.coherenceIdentity===T(t)&&e.deltaUrl===t.deltaUrl&&s.entryKey===t.entryId&&s.floorKey===de(t)&&s.missionKey===ue(t)&&t.mapFloorCoherent&&t.mapSessionVerified&&this.#e.value.dataMode==="live"&&this.#e.value.selection.floorId==="current"&&this.#s?.host.connected&&this.#s.host.robotConnected&&this.#s.host.administrator)}#te(t,e,s,n=!0){(s.has("plans")||s.has("plan_state"))&&this.loadPlans(),s.has("areas")&&this.loadAreas(),s.has("history")&&this.#oe(t,e),n&&["status","robot_state","activity","plan_state"].some(o=>s.has(o))&&this.refreshCatalog(!0,!0,!0)}#we(){this.#o.active&&(this.#h===null&&(this.#h=window.setInterval(()=>{this.refreshCatalog()},5e3)),this.#v===null&&(this.#v=window.setInterval(()=>{this.refreshPose()},wn)))}#O(){this.#h!==null&&window.clearInterval(this.#h),this.#v!==null&&window.clearInterval(this.#v),this.#h=null,this.#v=null,this.#C()}#C(){let t=this.#u;if(this.#u=null,!t)return;t.attempt?.finishReplacementRead?.(),t.attempt&&(t.attempt.finishReplacementRead=null),t.retryTimer!==null&&window.clearTimeout(t.retryTimer);let e=t.attempt?.controller,s=!!(e&&e===this.#r.get("catalog")&&this.#e.value.resources.catalog.status==="loading");if(e?.abort(),s){let n=this.#e.value.resources;this.#e.patch({resources:{...n,catalog:p("idle",n.catalog.value)}})}this.#m?.state===t&&(this.#f=!1,this.#c=!1,this.#m=null)}#re(t,e){let s=this.#u;s?.key===T(e)&&(s.failedKinds.delete(t),t==="delta"&&this.#G(e),s.failedKinds.size===0&&this.#C())}#G(t){this.#ie(T(t))}#ie(t){let e=this.#u;e?.key===t&&(e.attempt?.finishReplacementRead?.(),e.attempt&&(e.attempt.finishReplacementRead=null))}#ae(t,e){let s=T(e),n=this.#u;n?.key!==s&&(this.#C(),n={key:s,failedKinds:new Set,retryTimer:null,attempt:null},this.#u=n),n.failedKinds.add(t),t==="delta"&&this.#G(e),this.#me(n)&&this.#t.current()&&this.#N(),!n.attempt&&n.retryTimer===null&&(n.failedKinds.size===1&&n.failedKinds.has(t)?this.#ve(n):this.#fe(n))}#me(t){let e=this.#e.value;return t.failedKinds.has("pose")||e.floor.readOnly||!e.map.floorCoherent||!e.map.sessionVerified}#fe(t){t.retryTimer!==null||t.failedKinds.size===0||(t.retryTimer=window.setTimeout(()=>{t.retryTimer=null;let e=this.#e.value.resources.entry,s=this.#s?.host;if(this.#u!==t||this.#a||!e||T(e)!==t.key||this.#e.value.dataMode!=="live"||this.#e.value.selection.floorId!=="current"||!s?.connected||!s.administrator||!s.robotConnected||s.robotCount===0){this.#u===t&&this.#C();return}this.#ve(t)},_n))}async#ve(t){if(this.#a||this.#u!==t||t.attempt)return;let e=this.#e.value.resources.entry,s=this.#s?.host;if(!e||T(e)!==t.key||this.#e.value.dataMode!=="live"||this.#e.value.selection.floorId!=="current"||!s?.connected||!s.administrator||!s.robotConnected||s.robotCount===0){this.#u===t&&this.#C();return}if(this.#r.has("scene")){this.#fe(t);return}let n=this.#me(t);n?this.#t.current()&&this.#N():(this.#$(),this.#r.get("delta")?.abort());let o,r=new Promise(c=>{o=c}),i={generation:this.#t.generation,controller:null,replacementRead:r,finishReplacementRead:o};t.attempt=i;let l={state:t,attempt:i};try{await this.refreshCatalog(!0,!1,!n,l),t.failedKinds.has("delta")&&this.#u===t&&t.attempt===i&&await i.replacementRead}finally{if(this.#u!==t||t.attempt!==i)return;i.finishReplacementRead=null,t.attempt=null,t.failedKinds.size>0&&this.#fe(t)}}#ye(t){let e=this.#e.value,s=this.#s?.host;return!this.#a&&this.#o.active&&this.#u===t.state&&t.state.attempt===t.attempt&&t.attempt.generation===this.#t.generation&&e.generation===this.#t.generation&&e.dataMode==="live"&&e.selection.floorId==="current"&&e.resources.entry!==null&&T(e.resources.entry)===t.state.key&&!!(s?.connected&&s.administrator&&s.robotConnected&&s.robotCount>0)}#P(t){this.#r.get(t)?.abort();let e=new AbortController;return this.#r.set(t,e),e}#x(t,e){this.#r.get(t)===e&&this.#r.delete(t)}#q(t=[]){let e=!1;for(let[s,n]of this.#r)t.includes(s)||(e||=s==="plan-mutation"||s==="area-mutation"||s==="plan-preflight",n.abort(),this.#r.delete(s));e&&this.#e.value.command==="pending"&&this.#e.patch({command:"idle",notice:null})}#_e(){this.#S+=1,this.#d!==null&&window.clearTimeout(this.#d),this.#d=null}#se(t,e=null){this.#C(),this.#_e(),this.#t.invalidate(),this.#$(),this.#R="";let s=this.#t.generation;this.#q();let n=this.#e.value,o=K();this.#e.patch({command:"idle",dataMode:o.dataMode,floor:o.floor,managedLock:!1,workflow:"none",dialog:null,notice:null,draftFloorOrdinal:null,draw:o.draw,planDraft:o.planDraft,areaDraft:o.areaDraft,generation:s,coherence:n.host.administrator?"unavailable":"blocked",fullMap:!1,precisionOpen:!1,resources:{catalog:p("error",null,t),entry:null,scene:p("idle",null),pose:p("idle",null),history:p("idle",null),plans:p("idle",null),areas:p("idle",null)},manualRoomPreview:p("idle",null),map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1},selection:{...o.selection,entryId:e,entrySource:n.selection.entrySource,floorId:"current",historyId:null}})}async refreshCatalog(t=!1,e=!1,s=!1,n=null){if(this.#a||!this.#o.active||!this.#s?.host.administrator||!this.#s.host.connected||this.#s.host.robotCount===0||n&&(!this.#s.host.robotConnected||!this.#ye(n)))return;if(this.#_)return t&&(this.#y?e&&(this.#f?this.#c&&=s:this.#c=s,this.#f=!0):(this.#f?this.#c&&=s:this.#c=s,this.#f=!0,this.#r.get("catalog")?.abort()),n&&(this.#f?this.#c&&=s:this.#c=s,this.#m=n,this.#f=!0)),this.#E;this.#_=!0,this.#y=t;let o;this.#E=new Promise(l=>{o=l});let r=this.#P("catalog");n&&(n.attempt.controller=r);let i=this.#e.value.resources.catalog.value;this.#e.patch({resources:{...this.#e.value.resources,catalog:p("loading",i)}});try{let l=await this.#n.catalog(r.signal);if(r.signal.aborted||this.#a||n&&!this.#ye(n))return;let c=this.#s?.entryKey,d=c?l.find(y=>y.entryId===c)??null:l[0]??null,u=this.#e.value.resources.entry;if(d&&this.#u?.key===T(d)&&(this.#u.attempt!==null||this.#u.retryTimer!==null)&&(!n||!this.#ye(n))){this.#e.patch({managedLock:Ke(d),resources:{...this.#e.value.resources,catalog:p(l.length?"ready":"empty",l),entry:u}});return}let m=!!(d&&u&&T(d)===T(u)&&this.#X(u));if(d&&u&&F(d)===F(u)&&de(d)===de(u)&&ue(d)===ue(u)&&(m||d.mapRevision<u.mapRevision||!t&&this.#r.has("scene"))&&(d={...d,mapRevision:u.mapRevision}),this.#e.patch({managedLock:d?Ke(d):!1,resources:{...this.#e.value.resources,catalog:p(l.length?"ready":"empty",l),entry:d}}),this.#s&&this.#Y(this.#s),!d){this.#se("no-loaded-robot",this.#s?.entryKey??null);return}if(this.#e.value.selection.floorId!=="current"||this.#e.value.dataMode!=="live"){n&&this.#G(d);return}let h=yt(d),f=this.#t.current(),w=!!(f&&u&&T(d)===T(u)&&d.mapFloorCoherent&&d.mapSessionVerified);if((!t||s)&&(h===this.#R||w)){let y=this.#e.value,_=d.mapFloorCoherent&&d.mapSessionVerified,M=d.health==="problem"||d.health==="limited";this.#e.patch({coherence:_?M?"degraded":"current":"verifying",map:{...y.map,available:y.resources.scene.value!==null,complete:d.mapComplete&&!d.mapTruncated,floorCoherent:d.mapFloorCoherent,sessionVerified:d.mapSessionVerified,exactPose:_?y.map.exactPose:!1},floor:{...y.floor,classifiedCount:Math.max(1,d.historyFloorCount)}}),_&&this.#e.value.resources.plans.problem==="map-rechecking"&&this.loadPlans(),this.#ge();let R=f;if(R&&w&&(d.mapRevision>R.revision||n!==null)&&(d.mapRevision>R.revision&&(R=this.#t.advance(R,d.mapRevision)),R)){this.#R=h,this.#$();let v=this.#e.value.resources;this.#e.patch({resources:{...v,scene:p("loading",v.scene.value)}}),this.#ne(d,R)}R&&!y.resources.scene.value&&!this.#r.has("history")&&this.#oe(d,R),_&&R&&(y.resources.scene.status==="error"||y.floor.readOnly)&&!this.#r.has("scene")&&this.#ne(d,R);return}this.#R=h,this.#ke(d,u)}catch(l){if(W(l)||r.signal.aborted||this.#a)return;n&&this.#ie(n.state.key),this.#e.patch({coherence:this.#e.value.resources.scene.value?"degraded":"unavailable",resources:{...this.#e.value.resources,catalog:p("error",i,U(l,"catalog-unavailable"))}})}finally{this.#x("catalog",r),n?.attempt.controller===r&&(n.attempt.controller=null),this.#_=!1;let l=this.#f,c=this.#c,d=this.#m;this.#y=!1;try{l&&!this.#a&&(this.#f=!1,this.#c=!1,this.#m=null,await this.refreshCatalog(!0,!1,c,d))}finally{o()}}}#ke(t,e){this.#u!==null&&this.#u.key!==T(t)&&this.#C();let s=this.#e.value,n=!!(e&&F(e)===F(t)),o=t.mapFloorCoherent&&t.mapSessionVerified,r=s.draftMapSessionKey??(e?.mapFloorCoherent&&e.mapSessionVerified?e.mapSessionKey:null),i=s.draftFloorOrdinal??(e?.mapFloorCoherent&&e.mapSessionVerified?e.mapFloorOrdinal:null),l=o?t.mapFloorOrdinal:null,c=o?t.mapSessionKey:null,d=e!==null&&e.entryId!==t.entryId||i!==null&&l!==null&&i!==l||r!==null&&c!==null&&r!==c,u=n&&o&&i===t.mapFloorOrdinal&&r===t.mapSessionKey,m=["catalog"];n&&!d&&m.push("plans","areas"),u&&m.push("plan-mutation","area-mutation");let h=this.#t.begin(t.entryId,de(t),ue(t),t.mapRevision);this.#u?.key===T(t)&&this.#u.attempt&&(this.#u.attempt.generation=h.generation),this.#$(),this.#q(m);let f=e?.entryId===t.entryId?s.resources.scene.value:null,w=f!==null&&(s.floor.readOnly||!n||!o||e?.mapSessionKey!==t.mapSessionKey),y=s.resources.pose.value,_=n&&o&&t.mapSessionKey!==null&&y?.position&&y.mapSessionKey===t.mapSessionKey?y:null;d&&this.#_e();let M=K(),R=t.health==="problem"||t.health==="limited",v=this.#e.value;this.#e.patch({...d?{command:"idle",workflow:"none",dialog:null,precisionOpen:!1,fullMap:!1,draw:M.draw,planDraft:M.planDraft,areaDraft:M.areaDraft,notice:C.mapChanged}:{},draftFloorOrdinal:l??i,draftMapSessionKey:c??r,managedLock:Ke(t),generation:h.generation,coherence:o?R?"degraded":w?"verifying":"current":"verifying",dataMode:"live",resources:{...v.resources,entry:t,scene:p(o?"loading":"idle",f),pose:p(o?"loading":"idle",_),history:p("loading",v.resources.history.value),plans:n&&!d?v.resources.plans:p("idle",null),areas:n&&!d?v.resources.areas:p("idle",null)},map:{available:f!==null,complete:t.mapComplete&&!t.mapTruncated,floorCoherent:t.mapFloorCoherent,sessionVerified:t.mapSessionVerified,exactPose:o&&_!==null&&!w},floor:{classifiedCount:Math.max(1,t.historyFloorCount),displayName:w?s.floor.displayName:t.selectedFloorOrdinal?`Floor ${t.selectedFloorOrdinal}`:"Current floor",readOnly:w},selection:{...v.selection,entryId:t.entryId,floorId:"current",historyId:null,roomIds:d?[]:v.selection.roomIds,roomSettings:d?[]:v.selection.roomSettings,planId:d?null:v.selection.planId,areaId:d?null:v.selection.areaId}}),this.#oe(t,h),o&&this.#e.value.resources.plans.status==="idle"&&this.loadPlans(),this.#ge(),o&&(this.#ne(t,h),this.#le(t,h))}async#ne(t,e){if(!this.#o.active)return;let s=this.#P("scene");try{let n=await this.#n.scene(t.sceneUrl,t.mapRevision,t.mapFloorCoherent,"live",s.signal);if(!this.#t.accepts(e))return;if(!n.floorCoherent){let c=this.#e.value;this.#e.patch({coherence:"verifying",resources:{...c.resources,scene:p("error",c.resources.scene.value,"map-rechecking"),pose:p("idle",null)},map:{...c.map,available:c.resources.scene.value!==null,floorCoherent:!1,exactPose:!1},floor:{...c.floor,readOnly:c.resources.scene.value!==null}}),this.#G(t);return}if(n.revision<e.revision||!n.scene)throw new x("scene-unavailable");let o=n.revision===e.revision?e:this.#t.advance(e,n.revision);if(!o)throw new x("scene-unavailable");let r=this.#e.value,i={...r.resources.entry??t,mapRevision:n.revision};this.#R=yt(i),this.#e.patch({coherence:i.health==="problem"||i.health==="limited"?"degraded":"current",resources:{...r.resources,entry:i,scene:p("ready",n.scene)},map:{...r.map,available:!0},floor:{...r.floor,readOnly:!1,displayName:r.resources.history.value?.floors.find(c=>c.active)?.label||(i.selectedFloorOrdinal?`Floor ${i.selectedFloorOrdinal}`:"Current floor")},notice:r.notice?.key==="v4_notice_saved_map"?null:r.notice});let l=this.#e.value.resources.plans;if((l.status==="idle"||l.problem==="map-rechecking")&&this.loadPlans(),this.#ge(),t.deltaUrl&&typeof DecompressionStream=="function"){let c=++this.#M;this.#Se(i,o,n.scene,c)}else this.#re("delta",i)}catch(n){if(W(n)||!this.#t.accepts(e))return;if(n instanceof x&&n.code==="request-timeout"){let l=this.#e.value;this.#e.patch({resources:{...l.resources,scene:p("loading",l.resources.scene.value,"scene-building")}}),window.setTimeout(()=>{this.#a||!this.#t.accepts(e)||this.#e.value.selection.floorId!=="current"||this.#ne(t,e)},250);return}this.#G(t);let o=this.#e.value,r=o.resources.pose.value,i=o.resources.scene.value!==null&&t.mapSessionKey!==null&&r?.position!==null&&r?.mapSessionKey===t.mapSessionKey;this.#e.patch({coherence:"degraded",resources:{...o.resources,scene:p("error",o.resources.scene.value,U(n,"scene-unavailable"))},map:{...o.map,available:o.resources.scene.value!==null,exactPose:i}})}finally{this.#x("scene",s)}}async#Se(t,e,s,n){if(!t.deltaUrl||typeof DecompressionStream!="function")return;let o=t.deltaUrl,r={generation:n,stamp:e,entryId:t.entryId,coherenceIdentity:T(t),deltaUrl:o};if(n!==this.#M||!this.#t.accepts(e))return;this.#K=r;let i=t,l=e,c=s;try{for(;!this.#a&&this.#o.active&&n===this.#M&&this.#t.accepts(l)&&this.#e.value.selection.floorId==="current";){let d=this.#P("delta");try{let u=await this.#n.sceneDelta(o,c,i.mapFloorCoherent,d.signal);if(d.signal.aborted||this.#a||n!==this.#M||!this.#t.accepts(l))return;if(!u.floorCoherent){let f=this.#e.value;this.#e.patch({coherence:"verifying",map:{...f.map,available:f.resources.scene.value!==null,floorCoherent:!1,exactPose:!1},floor:{...f.floor,readOnly:f.resources.scene.value!==null},resources:{...f.resources,scene:p("error",f.resources.scene.value,"map-rechecking"),pose:p("idle",null)}}),this.#ae("delta",i);return}if(u.notModified||!u.scene){this.#re("delta",i),await new Promise(f=>window.setTimeout(f,100));continue}let m=this.#t.advance(l,u.revision);if(!m)return;l=m,r.stamp=m,c=u.scene,i={...i,mapRevision:u.revision},this.#re("delta",i),this.#R=yt(i);let h=this.#e.value;this.#e.patch({resources:{...h.resources,entry:i,scene:p("ready",c)},map:{...h.map,available:!0,floorCoherent:!0}}),this.#le(i,l)}finally{this.#x("delta",d)}}}catch(d){if(W(d)||this.#a||n!==this.#M||!this.#t.accepts(l))return;this.#ae("delta",i)}finally{this.#K===r&&(this.#K=null)}}async#oe(t,e){if(!this.#o.active)return;let s=this.#P("history");try{let n=await this.#n.history(t.historyUrl,s.signal),o=this.#t.current();if(s.signal.aborted||!o||!Ue(e,o)||n.entryId!==t.entryId)return;let r=this.#e.value,i=n.floors.find(d=>d.id===r.selection.floorId),l=!r.selection.historyId||i?.snapshots.some(d=>d.id===r.selection.historyId),c=r.dataMode==="live"?n.floors.find(d=>d.active):i;if(this.#e.patch({resources:{...this.#e.value.resources,history:p("ready",n)},floor:{...this.#e.value.floor,classifiedCount:n.floors.length,...c&&!(r.dataMode==="live"&&r.floor.readOnly)?{displayName:Ve(c,1)}:{}}}),r.dataMode==="live"&&!r.resources.scene.value){let d=n.floors.flatMap(u=>u.snapshots.map(m=>({floor:u,snapshot:m}))).sort((u,m)=>Date.parse(m.snapshot.createdAt)-Date.parse(u.snapshot.createdAt));for(let u of d){let m;try{m=await this.#n.scene(u.snapshot.sceneUrl,u.snapshot.revision,!0,"history",s.signal)}catch(w){if(W(w)||s.signal.aborted)return;continue}let h=this.#t.current();if(s.signal.aborted||!h||!Ue(e,h)||this.#e.value.resources.scene.value)return;if(!m.scene)continue;let f=this.#e.value;this.#e.patch({floor:{...f.floor,readOnly:!0,displayName:Ve(u.floor,1)},resources:{...f.resources,scene:p("ready",m.scene),pose:p("idle",null)},map:{...f.map,available:!0,exactPose:!1},notice:gn(Jt(u.snapshot.createdAt,this.#s?.dates))});break}}if(r.dataMode==="history"&&(!i||!l)){let d=i||n.floors.find(m=>m.active)||n.floors[0],u=this.selectFloor(d?.id||"current");!this.#a&&r.workflow==="history"&&this.#e.dispatch({type:"open-workflow",workflow:"history"}),await u}}catch(n){let o=this.#t.current();if(W(n)||s.signal.aborted||!o||!Ue(e,o))return;this.#e.patch({resources:{...this.#e.value.resources,history:p("error",null,U(n,"history-unavailable"))}})}finally{this.#x("history",s)}}async refreshPose(){let t=this.#e.value.resources.entry,e=this.#t.current();!t||!e||this.#e.value.selection.floorId!=="current"||!t.mapFloorCoherent||!t.mapSessionVerified||await this.#le(t,e)}async#le(t,e){if(this.#a||!this.#o.active||!this.#D||!this.#s?.host.connected)return;if(this.#I){this.#g=!0;return}this.#I=!0;let s=this.#P("pose");try{let n=await this.#n.pose(t.poseUrl,s.signal),o=this.#t.current(),r=this.#e.value.resources.entry;if(!o||!Ue(e,o)||!r||!this.#e.value.map.floorCoherent)return;if(!n.floorCoherent||n.mapSessionKey===null||n.mapSessionKey!==r.mapSessionKey){this.#e.patch({resources:{...this.#e.value.resources,pose:p("idle",null)},map:{...this.#e.value.map,exactPose:!1}}),this.#ae("pose",r);return}this.#re("pose",r);let i=this.#e.value,l=i.resources.pose.value,c=!!(i.map.exactPose&&l?.position&&l.mapSessionKey===r.mapSessionKey);if(n.position===null&&c){this.#e.patch({resources:{...i.resources,pose:p("ready",l)}});return}this.#e.patch({resources:{...i.resources,pose:p("ready",n)},map:{...i.map,exactPose:n.position!==null}})}catch(n){if(W(n)||!this.#t.accepts(e))return;let o=this.#e.value,r=o.resources.pose.value,i=!!(o.map.exactPose&&r?.position&&r.mapSessionKey===o.resources.entry?.mapSessionKey);this.#e.patch({resources:{...o.resources,pose:p("error",i?r:null,U(n,"pose-unavailable"))},map:{...o.map,exactPose:i}})}finally{if(this.#x("pose",s),this.#I=!1,this.#g&&!this.#a&&this.#D&&this.#s?.host.connected&&this.#s.host.administrator&&this.#s.host.robotCount>0){this.#g=!1;let n=this.#e.value.resources.entry,o=this.#t.current();n&&o&&this.#le(n,o)}else this.#g=!1}}async selectFloor(t){let e=this.#e.value.resources.history.value,s=this.#e.value.resources.entry;if(!e||!s)return;let n=e.floors.find(l=>l.id===t);if(!n&&t!=="current")return;let o=this.#e.value;if(o.workflow==="draw"&&(o.draw.dirty||o.areaDraft.dirty)||o.workflow==="areaReview"&&(o.draw.dirty||o.areaDraft.dirty))return;if(!n||n.active){this.#C(),this.#R="";let l=this.#e.value;this.#e.patch({resources:{...l.resources,plans:p("idle",null),areas:p("idle",null),scene:p("idle",l.resources.scene.value),pose:p("idle",null)},map:{...l.map,available:l.resources.scene.value!==null,exactPose:!1},coherence:"verifying",floor:{...l.floor,readOnly:l.resources.scene.value!==null},workflow:"none",precisionOpen:!1}),this.#e.dispatch({type:"set-floor",floorId:"current"}),await this.refreshCatalog(!0);return}this.#C();let r=n.snapshots.at(-1),i=this.#t.begin(s.entryId,n.id,r?.id||n.id,r?.revision||0);this.#q(["catalog"]),this.#e.patch({generation:i.generation,coherence:"current",dataMode:"history",floor:{classifiedCount:e.floors.length,displayName:Ve(n,e.floors.indexOf(n)+1),readOnly:!0},selection:{...this.#e.value.selection,floorId:n.id,historyId:r?.id||null},resources:{...this.#e.value.resources,scene:p(r?"loading":"empty",null),pose:p("idle",null),plans:p("idle",null),areas:p("idle",null)},workflow:"none",precisionOpen:!1,map:{available:!1,complete:!0,floorCoherent:!0,sessionVerified:!0,exactPose:!1}}),r&&await this.#ce(r,i)}async selectHistory(t){let e=this.#e.value.resources.history.value,s=this.#e.value.resources.entry;if(!e||!s)return;if(!t){await this.selectFloor("current");return}let n=e.floors.find(i=>i.snapshots.some(l=>l.id===t)),o=n?.snapshots.find(i=>i.id===t);if(!n||!o)return;this.#C();let r=this.#t.begin(s.entryId,n.id,o.id,o.revision);this.#q(["catalog"]),this.#e.patch({generation:r.generation,dataMode:"history",floor:{classifiedCount:e.floors.length,displayName:Ve(n,e.floors.indexOf(n)+1),readOnly:!0},selection:{...this.#e.value.selection,floorId:n.id,historyId:o.id},resources:{...this.#e.value.resources,scene:p("loading",null),pose:p("idle",null)},map:{...this.#e.value.map,available:!1,exactPose:!1}}),await this.#ce(o,r)}async#ce(t,e){if(!this.#o.active)return;let s=this.#P("history-scene");try{let n=await this.#n.scene(t.sceneUrl,t.revision,!0,"history",s.signal);if(!this.#t.accepts(e)||!n.scene)return;this.#e.patch({resources:{...this.#e.value.resources,scene:p("ready",n.scene)},map:{...this.#e.value.map,available:!0,exactPose:!1}})}catch(n){if(W(n)||!this.#t.accepts(e))return;this.#e.patch({resources:{...this.#e.value.resources,scene:p("error",null,U(n,"history-scene-unavailable"))}})}finally{this.#x("history-scene",s)}}async openWorkflow(t){let e=this.#e.value;if((e.dataMode==="history"||e.floor.readOnly)&&kn.includes(t))return;let s=this.#e.value.workflow;if(t==="draw"&&s!=="draw"&&s!=="areaReview"&&this.selectArea(null),this.#e.dispatch({type:"open-workflow",workflow:t}),t==="history"){let n=this.#e.value.resources.entry,o=this.#t.current();n&&o&&(this.#e.patch({resources:{...this.#e.value.resources,history:p("loading",this.#e.value.resources.history.value)}}),await this.#oe(n,o))}(t==="plans"||t==="plan"||t==="rooms")&&await this.loadPlans(),(t==="draw"||t==="areaReview")&&await this.loadAreas()}async loadPlans({force:t=!1}={}){if(!this.#o.active){this.#r.get("plans")?.abort();let o=this.#e.value.resources;return this.#e.patch({resources:{...o,plans:p("idle",o.plans.value)}}),null}let e=this.#e.value.resources.entry;if(!e||!this.#t.current()||!Je(this.#e.value)||!t&&this.#e.value.resources.plans.status==="loading")return null;let s=F(e),n=this.#P("plans");this.#e.patch({resources:{...this.#e.value.resources,plans:p("loading",this.#e.value.resources.plans.value)}});try{let o=await this.#n.plans(e.plansUrl,n.signal),r=this.#e.value.resources.entry;if(n.signal.aborted||this.#a||!r||F(r)!==s)return null;let i=this.#e.value;if(i.planDraft.dirty||i.workflow==="plan"&&(!i.planDraft.id||i.command==="pending"))return this.#e.patch({resources:{...this.#e.value.resources,plans:p("ready",o)}}),o;let l=i.workflow==="plan"?i.selection.planId:o.selectedPlan||o.plans[0]?.id||null,c=o.plans.find(d=>d.id===l);return this.#e.patch({resources:{...this.#e.value.resources,plans:p("ready",o)},selection:{...this.#e.value.selection,planId:l},planDraft:c?Qe(c):{...this.#e.value.planDraft,id:null,name:"",rooms:[],dirty:!1}}),o}catch(o){let r=this.#e.value.resources.entry;if(W(o)||n.signal.aborted||this.#a||!r||F(r)!==s)return null;let i=o instanceof x&&o.code==="map-rechecking"?"map-rechecking":U(o,"plans-unavailable");return this.#e.patch({resources:{...this.#e.value.resources,plans:p("error",null,i)}}),null}finally{this.#x("plans",n)}}selectPlan(t,e=!1){let s=this.#e.value.resources.plans.value?.plans.find(n=>n.id===t);this.#e.patch({workflow:"plan",notice:!e&&this.#e.value.notice?.tone==="success"?null:this.#e.value.notice,selection:{...this.#e.value.selection,planId:t},planDraft:s?Qe(s):{...K().planDraft}})}#ge(){let t=this.#e.value;(t.workflow==="draw"||t.workflow==="areaReview")&&t.resources.areas.status==="idle"&&this.loadAreas()}async loadAreas({reconcileDraft:t=!0}={}){if(!this.#o.active){this.#r.get("areas")?.abort();let o=this.#e.value.resources;return this.#e.patch({resources:{...o,areas:p("idle",o.areas.value)}}),null}let e=this.#e.value.resources.entry;if(!e||!this.#t.current()||!Je(this.#e.value))return null;let s=F(e),n=this.#P("areas");this.#e.patch({resources:{...this.#e.value.resources,areas:p("loading",this.#e.value.resources.areas.value)}});try{let o=await this.#n.areas(e.areasUrl,n.signal),r=this.#e.value.resources.entry;if(n.signal.aborted||this.#a||!r||F(r)!==s)return null;if(o.sceneUrl!==r.sceneUrl)throw new x("areas-unavailable");this.#e.patch({resources:{...this.#e.value.resources,areas:p("ready",o)}});let i=this.#e.value.selection.areaId,l=this.#e.value,c=o.areas.some(d=>d.id===i);return t&&i!==null&&!c&&(l.draw.dirty||l.areaDraft.dirty)?this.#e.patch({selection:{...l.selection,areaId:null},areaDraft:{...l.areaDraft,id:null,status:"new",canRebind:!1,dirty:!0},notice:C.areaRemoved}):t&&!l.draw.dirty&&!l.areaDraft.dirty&&this.selectArea(c?i:null),o}catch(o){let r=this.#e.value.resources.entry;return W(o)||n.signal.aborted||this.#a||!r||F(r)!==s||this.#e.patch({resources:{...this.#e.value.resources,areas:p("error",null,U(o,"areas-unavailable"))}}),null}finally{this.#x("areas",n)}}selectArea(t){let e=this.#e.value.resources.areas.value?.areas.find(n=>n.id===t),s=this.#e.value;this.#e.patch({selection:{...s.selection,areaId:t},areaDraft:e?this.#Re(e):{id:null,name:"",cleaningMode:"vacuum",coverageSetting:"standard",status:"new",canRebind:!1,dirty:!1},draw:{...s.draw,circles:e?.circles||[],outline:e?.outline??null,outlineUndo:[],outlineRedo:[],tool:!e||e.outline?"outline":"paint",undo:[],redo:[],dirty:!1,strokeCount:0}})}#Re(t){return{id:t.id,name:t.name,cleaningMode:t.cleaningMode,coverageSetting:t.coverageSetting,status:t.status,canRebind:t.canRebind,dirty:!1}}async saveArea(){let t=this.#e.value,e=t.resources.entry,s=t.areaDraft;if(!e||t.command==="pending"||!pe(t)||!s.name.trim()||!t.draw.circles.length)return;let n=this.#P("area-mutation"),o=()=>!this.#a&&!n.signal.aborted;this.#e.patch({command:"pending",notice:C.areaSaving});try{let r=await this.#n.saveArea(e.areasUrl,{areaId:s.id,name:s.name.trim(),circles:t.draw.circles,outline:t.draw.outline??null,cleaningMode:s.cleaningMode,coverageSetting:s.coverageSetting},n.signal);if(!o())return;let i=this.#e.value,c=i.areaDraft===s&&i.draw.circles===t.draw.circles&&i.draw.outline===t.draw.outline&&i.selection.entryId===t.selection.entryId&&(i.workflow==="draw"||i.workflow==="areaReview")?{...s,id:r,name:s.name.trim(),status:"current",canRebind:!1,dirty:!1}:null;this.#e.patch({command:"idle",notice:C.areaSaved,...c?{dialog:i.dialog==="discardDraft"?null:i.dialog,selection:{...i.selection,areaId:r},areaDraft:c,draw:{...i.draw,dirty:!1,strokeCount:0,undo:[],redo:[],outlineUndo:[],outlineRedo:[]}}:{}});let d=await this.loadAreas({reconcileDraft:!1}),u=this.#e.value;o()&&c&&u.areaDraft===c&&!u.draw.dirty&&(u.workflow==="draw"||u.workflow==="areaReview")&&u.selection.entryId===t.selection.entryId&&d&&u.resources.areas.value===d&&d.areas.some(m=>m.id===r)&&this.selectArea(r)}catch(r){if(W(r)||!o())return;this.#e.patch({command:"failed",notice:C.areaSaveFailed})}finally{this.#x("area-mutation",n)}}async deleteArea(){let t=this.#e.value.resources.entry,e=this.#e.value.selection.areaId;if(!t||!e||this.#e.value.command==="pending"||!pe(this.#e.value))return;let s=this.#P("area-mutation"),n=()=>!this.#a&&!s.signal.aborted;this.#e.patch({command:"pending",notice:null});try{if(await this.#n.deleteArea(t.areasUrl,e,s.signal),!n())return;this.#e.patch({command:"idle",notice:C.areaDeleted}),await this.loadAreas()}catch(o){!W(o)&&n()&&this.#e.patch({command:"failed",notice:C.areaDeleteFailed})}finally{this.#x("area-mutation",s)}}async savePlan(){let t=this.#e.value,e=t.planDraft,s=t.resources.plans.value;if(!s||!e.name.trim()||!e.rooms.length||!pe(t))return;let n=e.rooms,o=e.id;if(await this.#be("save_plan",{...e.id?{plan_id:e.id}:{},name:e.name.trim(),enabled:e.enabled,run_behavior:e.runBehavior,rooms:n.map(i=>({room:i.roomId,cleaning_mode:i.cleaningMode,coverage_setting:i.coverageSetting,...i.cadence?{cadence:{scope:i.cadence.scope,mop_every_n:i.cadence.mopEveryN,coverage_every_n:i.cadence.coverageEveryN,periodic_coverage_setting:i.cadence.periodicCoverageSetting,do_mop_next:i.cadence.doMopNext,do_coverage_next:i.cadence.doCoverageNext}}:{}})),return_to_base:e.returnToBase,finish_current_room:e.finishCurrentRoom,finish_current_room_threshold:e.finishCurrentRoomThreshold,select:!e.id||s.selectedPlan===e.id},C.planSaved,C.planSaveFailed,i=>{let l=i===void 0&&e.id?e.id:jt(i);if(e.id&&l!==e.id)throw new x("invalid-plan-save-response");o=l})){let i=this.#e.value.workflow==="plan"&&this.#e.value.planDraft===e?{...e,id:o,dirty:!1}:null;i&&this.#e.patch({planDraft:i,selection:{...this.#e.value.selection,planId:o}});let l=await this.loadPlans({force:!0});i&&this.#e.value.workflow==="plan"&&this.#e.value.planDraft===i&&this.#e.value.selection.entryId===t.selection.entryId&&l&&this.#e.value.resources.plans.value===l&&o&&l.plans.some(c=>c.id===o)&&this.selectPlan(o,!0)}}async deletePlan(){let t=this.#e.value.selection.planId,e=this.#e.value.selection.entryId;if(!t)return;if(await this.#be("delete_plan",{plan:t},C.planDeleted,C.planDeleteFailed)){let n=this.#e.value;n.selection.entryId===e&&n.planDraft.id===t&&(this.#e.patch({selection:{...n.selection,planId:null},planDraft:K().planDraft}),n.workflow==="plan"&&this.#e.patch({workflow:"plans",precisionOpen:!1})),await this.loadPlans({force:!0})}}async executeAction(t){switch(typeof t=="string"?t:t.id){case"recheck-status":{if(this.#e.value.rechecking)return;let s=this.#e.value.selection.entryId;this.#e.patch({rechecking:!0});try{await this.refreshCatalog(!0)}finally{this.#a||this.#e.patch({rechecking:!1})}let n=this.#e.value;!this.#a&&n.selection.entryId===s&&n.resources.catalog.status==="ready"&&n.host.connected&&n.host.robotConnected&&n.coherence==="current"&&n.command==="failed"&&this.#e.patch({command:"idle",notice:C.statusRefreshed});return}case"stop":await this.#F("matic_robot","stop_intelligent_cleaning",{include_unmanaged:!0});return;case"resume":await this.#F("vacuum","send_command",{command:"resume"});return;case"run-plan":{let s=this.#e.value,n=s.selection.planId||s.resources.plans.value?.selectedPlan;if(!n||s.workflow!=="plan"||!s.planDraft.enabled||s.resources.plans.status!=="ready"||s.command!=="idle"||!Me(s))return;let o=s.selection.entryId,r=s.generation,i=s.selection.planId,l=s.planDraft,c=s.resources.plans.value?.plans.find(f=>f.id===n)?.nextRunPreview;if(!c||!/^[0-9a-f]{64}$/u.test(c.previewToken??"")){this.#e.patch({notice:C.planPreviewMissing});return}this.#e.patch({command:"pending",notice:null});let d=this.#P("plan-preflight");try{await this.loadPlans()}finally{this.#x("plan-preflight",d)}let u=this.#e.value,m=()=>{let f=this.#e.value;!this.#a&&f.selection.entryId===o&&f.generation===r&&f.command==="pending"&&this.#e.patch({command:"idle"})};if(d.signal.aborted||this.#a||u.selection.entryId!==o||u.generation!==r||u.workflow!=="plan"||u.selection.planId!==i||(u.selection.planId||u.resources.plans.value?.selectedPlan)!==n||u.planDraft!==l){m();return}if(u.resources.plans.status!=="ready"){m(),this.#e.patch({notice:C.planPreviewRefreshFailed});return}let h=u.resources.plans.value?.plans.find(f=>f.id===n)?.nextRunPreview;if(!h||h.blocker||!/^[0-9a-f]{64}$/u.test(h.previewToken??"")){m(),this.#e.patch({notice:C.planPreviewNone});return}if(!c||JSON.stringify(c)!==JSON.stringify(h)){m(),this.#e.patch({notice:C.planPreviewChanged});return}m(),await this.#F("matic_robot","run_selected_plan",{plan:n,preview_token:h.previewToken});return}case"clean-rooms":{await this.#Ee();return}case"run-area":{let s=this.#e.value.selection.areaId;s&&await this.#F("matic_robot","clean_area",{area:s});return}case"review-area":this.#e.dispatch({type:"open-workflow",workflow:"areaReview"});return;case"save-area":await this.saveArea();return;case"save-plan":await this.savePlan();return;case"delete-plan":await this.deletePlan();return;case"delete-area":await this.deleteArea();return;case"reset-room-cadence":{if(typeof t=="string")return;let s=this.#e.value;if(s.selection.planId!==t.planId||s.planDraft.dirty||s.dataMode!=="live"||s.command!=="idle"||s.activity!=="idle"&&s.activity!=="docked"||!await this.#be("reset_room_cadence",{plan:t.planId,room_id:t.roomId,modes:[t.mode]},t.mode==="mop"?C.resetMop:C.resetVacuum,t.mode==="mop"?C.resetMopFailed:C.resetVacuumFailed))return;let o=await this.loadPlans({force:!0}),r=this.#e.value;!this.#a&&r.selection.entryId===s.selection.entryId&&r.selection.planId===t.planId&&!r.planDraft.dirty&&o&&r.resources.plans.value===o&&this.selectPlan(t.planId,!0);return}}}async#Ee(){if(this.#V)return;let t=this.#e.value,e=this.#L(t),s=Ge(t);if(!e||!s||s.key!==e.key||s.generation!==e.generation||s.floorKey!==e.floorKey||s.missionKey!==e.missionKey||s.preview.entryId!==e.entryId||s.preview.blocker||s.preview.rooms.length===0)return;this.#V=!0;let n=this.#P("room-preview");this.#U=this.#p(e),this.#e.patch({manualRoomPreview:p("loading",null),notice:null});try{let o=await this.#n.previewRoomSequence(e.entityId,e.rooms,e.overrideRoomSchedule,n.signal);if(n.signal.aborted||!this.#z(e)||o.entryId!==e.entryId)return;let r={key:e.key,generation:e.generation,floorKey:e.floorKey,missionKey:e.missionKey,preview:o};if(o.blocker||o.rooms.length===0){this.#e.patch({manualRoomPreview:p("ready",r),notice:C.roomPreviewBlocked});return}if(Bs(s.preview)!==Bs(o)){this.#e.patch({manualRoomPreview:p("ready",r),notice:C.roomPreviewChanged});return}if(this.#e.patch({manualRoomPreview:p("ready",r),notice:null}),!this.#z(e)||!Me(this.#e.value))return;await this.#F("matic_robot","clean_room_sequence",{rooms:e.rooms,use_room_schedule:!0,override_room_schedule:e.overrideRoomSchedule,return_to_base:!0,preview_token:o.previewToken})}catch(o){!W(o)&&!n.signal.aborted&&this.#z(e)&&this.#e.patch({manualRoomPreview:p("error",null,U(o,"preview-unavailable")),notice:C.roomPreviewFailed})}finally{this.#x("room-preview",n),this.#V=!1,this.#B()}}async#be(t,e,s,n,o){let r=this.#s?.vacuumEntityId;if(!r||!pe(this.#e.value)||this.#e.value.command==="pending")return!1;let i=this.#P("plan-mutation"),l=this.#s?.entryKey,c=this.#s?.userKey,d=()=>!this.#a&&!i.signal.aborted&&l===this.#s?.entryKey&&c===this.#s?.userKey;this.#e.patch({command:"pending",notice:C.saving});try{let u=await this.#n.service("matic_robot",t,e,r,{acknowledgementTimeout:"mutation",...o?{returnResponse:!0}:{}});return d()?(o?.(u),this.#e.patch({command:"idle",notice:s}),!0):!1}catch{return d()&&this.#e.patch({command:"failed",notice:n}),!1}finally{this.#x("plan-mutation",i)}}async#F(t,e,s){let n=this.#e.value,o=this.#s?.vacuumEntityId,r=e==="stop_intelligent_cleaning"||t==="vacuum"&&e==="return_to_base",i=t==="vacuum"&&e==="send_command"&&s.command==="resume";if(!o||n.selection.entryId!==this.#s?.entryKey||(r?!$t(n):i?!It(n):!Me(n)))return;let l=++this.#S,c=this.#s?.entryKey,d=()=>!this.#a&&l===this.#S&&c===this.#s?.entryKey,u=r?"settling":"starting";this.#d!==null&&window.clearTimeout(this.#d),this.#d=null,this.#e.patch({command:u,notice:null});try{if(await this.#n.service(t,e,s,o),!d())return;if(t==="matic_robot"&&(e==="clean_room_sequence"||e==="run_selected_plan")){this.#e.patch({command:"idle"}),this.refreshCatalog(!0);return}this.#e.patch({command:u}),this.#d!==null&&window.clearTimeout(this.#d),this.#d=window.setTimeout(()=>{this.#d=null,d()&&this.#e.value.command===u&&this.#e.patch({command:"idle"})},15e3)}catch(m){if(!d())return;this.#e.patch({command:"failed",notice:r?C.stopUnconfirmed:bn(m)??C.actionUnconfirmed})}}dispose(){this.#a||(this.#a=!0,this.#o.dispose(),this.#N(!1),this.#A?.(),this.#A=null,this.#e.patch({manualRoomPreview:p("idle",null)}),this.#O(),this.#q(),this.#d!==null&&window.clearTimeout(this.#d),this.#d=null,this.#l.dispose(),this.#de(),this.#n.dispose())}#de(){this.#b?.dispose(),this.#b=null,this.#T=null,this.#k=null}};var Ns=a=>(a.workflow==="none"?0:a.workflow==="plan"?2:1)+(a.fullMap?1:0)+(a.precisionOpen?1:0)+(a.dialog?1:0),Hs=a=>{if(!a||typeof a!="object")return null;let t=a.maticMapLayer;if(!t||typeof t!="object")return null;let e=t.owner,s=t.depth;return typeof e=="string"&&Number.isInteger(s)&&Number(s)>=0?{owner:e,depth:Number(s)}:null},Ye=class{#e;#t=`matic-map-${crypto.randomUUID?.()||Math.random().toString(36).slice(2)}`;#n=0;#o=null;#l=!1;#i=!1;constructor(t){this.#e=t}start(){this.#o||(this.#n=Ns(this.#e.value),this.#o=this.#e.subscribe(t=>this.#r(t)),window.addEventListener("popstate",this.#s))}#r(t){let e=Ns(t);if(this.#l){this.#l=!1,this.#n=e;return}if(e<this.#n){let s=Hs(history.state);if(s?.owner===this.#t&&s.depth===this.#n){let n=e-this.#n;this.#n=e,this.#i=!0,history.go(n);return}}if(e>this.#n)for(let s=this.#n+1;s<=e;s+=1){let n=history.state&&typeof history.state=="object"?history.state:{};history.pushState({...n,maticMapLayer:{owner:this.#t,depth:s}},"",window.location.href)}this.#n=e}#s=()=>{if(this.#i){this.#i=!1;return}if(!(this.#n<1)){if(Z(this.#e.value,{type:"dismiss-top-layer"})){let t=history.state&&typeof history.state=="object"?history.state:{};history.pushState({...t,maticMapLayer:{owner:this.#t,depth:this.#n}},"",window.location.href),this.#e.dispatch({type:"open-dialog",dialog:"discardDraft"});return}this.#l=!0,this.#e.dispatch({type:"dismiss-top-layer"})}};dismissTop(){if(this.#n<1)return!1;let t=Hs(history.state);return t?.owner===this.#t&&t.depth===this.#n?history.back():this.#e.dispatch({type:"dismiss-top-layer"}),!0}dispose(){this.#o?.(),this.#o=null,window.removeEventListener("popstate",this.#s),this.#n=0,this.#i=!1}};var Fs=[xe,Te,Zt,Ce`
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

    /* The wide inspector's width, shared by its grid column and the toast's offset. */
    .root { --ms-inspector: 22.5rem; position: relative; min-block-size: 0; block-size: 100%; }

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
      grid-template-columns: minmax(0, 1fr) minmax(19rem, var(--ms-inspector));
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

    /* Notice slot and toast (shell.md \u00a74, design-system.md .ms-notice): the
       text stays --ms-text on the tone's tint; the glyph and the inline-start
       rule carry the tone, never the text colour. */
    .notice {
      --notice-tone: var(--ms-accent);
      --ms-local: color-mix(in srgb, var(--notice-tone) 12%, var(--ms-surface-card));
      display: flex;
      gap: var(--ms-space-2);
      align-items: center;
      padding-inline-start: var(--ms-space-3);
      border-inline-start: 3px solid var(--notice-tone);
      border-radius: var(--ms-radius-md);
      background: var(--ms-local);
      color: var(--ms-text);
      font-size: var(--ms-t-sm);
      line-height: var(--ms-lh-snug);
    }
    .notice[data-tone="success"] { --notice-tone: var(--ms-success); }
    .notice[data-tone="warning"] { --notice-tone: var(--ms-warning); }
    .notice[data-tone="error"] { --notice-tone: var(--ms-danger); }
    .notice > .ms-icon { color: var(--notice-tone); }
    .notice > .ms-btn { flex: none; }
    .notice-text { flex: 1; min-inline-size: 0; padding-block: var(--ms-space-2); }
    [data-notice-slot] { margin-block-start: var(--ms-space-3); }
    /* Wide: bottom centre of the canvas, above the dock. */
    .notice-toast {
      position: absolute;
      z-index: 10;
      inset-inline: 0 var(--ms-inspector);
      inset-block-end: calc(var(--ms-space-3) + 3.5rem + var(--ms-space-2));
      inline-size: fit-content;
      max-inline-size: min(28rem, calc(100% - var(--ms-inspector) - 2 * var(--ms-space-3)));
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
    .host-state, .problem { display: grid; gap: var(--ms-space-2); padding: var(--ms-space-4); border: 1px solid var(--ms-line); border-radius: var(--ms-radius-md); }
    .host-state h3 { margin: 0; font-size: var(--ms-t-md); }
    .host-state p, .problem p, .loading { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-sm); line-height: var(--ms-lh-normal); }
    .host-state .ms-btn, .problem .ms-btn { justify-self: start; text-decoration: none; }
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
    .narrow .mobile-sheet[data-detent="peek"] .sheet-panel { display: none; }

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
    .sheet-tools > :is(.loading, .problem) { margin-block-end: var(--ms-space-2); }
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
    .narrow .sheet-panel { display: flex; flex: 1; flex-direction: column; min-block-size: 0; }
    /* On a short sheet the pinned heading and notice give the body at least half. */
    .narrow .panel-top { max-block-size: 50%; padding-block-start: var(--ms-space-1); overflow: auto; overscroll-behavior: contain; }
    .narrow .sheet-body { flex: 1; min-block-size: 0; padding-block-end: var(--ms-space-1); overflow: auto; overscroll-behavior: contain; }
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
      .dialog, .full-map-hud, .mobile-sheet, .host-state, .problem, .notice { border: 1px solid CanvasText; }
      .sheet-handle { background: CanvasText; }
    }

    @media (prefers-reduced-motion: reduce) {
      .narrow .mobile-sheet { transition: none; }
    }
  `];var Ks=ae(Ae),Xe=ae(zt),Us=ae(Ze),Ys=a=>a.dataMode==="history"||a.floor.readOnly,gt=(a,t)=>{let e=(i,l,c)=>ve(t,i,l,c);if(!a.host.connected)return{title:e("v4_reconnecting","Reconnecting"),detail:e("v4_ha_offline","Home Assistant is offline"),icon:j,notable:!0};if(!a.host.administrator)return{title:e("v4_access_required","Access required"),detail:e("v4_admin_only","Administrator only"),icon:j,notable:!0};if(a.host.robotCount===0)return{title:e("v4_no_robot_short","No robot"),detail:e("v4_set_up_robot","Set up a Matic robot"),icon:j,notable:!0};if(Ee(a))return{title:e("v4_selected_robot_unavailable","Selected robot unavailable"),detail:e("v4_choose_another_robot","Choose another robot to open its map."),icon:j,notable:!0};if(!a.host.robotConnected)return{title:e("v4_robot_offline","Robot offline"),detail:e("v4_last_map_read_only","Last verified map \xB7 read only"),icon:j,notable:!0};if(a.activity==="problem")return{title:e("v4_needs_attention","Needs attention"),detail:e("v4_check_robot","Check the robot"),icon:j,notable:!0};if(a.dataMode==="history"){let i=a.resources.history.value?.floors.find(d=>d.id===a.selection.floorId),l=i?.snapshots.findIndex(d=>d.id===a.selection.historyId)??-1,c=i?.snapshots.length??0;return{title:e("v4_saved_map","Saved map"),detail:l>=0?e("v4_read_only_position","Read only \xB7 {position} of {count}",{position:l+1,count:c}):e("v4_read_only","Read only"),icon:st,notable:!1}}if(a.coherence==="verifying"||a.coherence==="booting")return{title:e("v4_locating","Locating"),detail:e("v4_finding_map","Finding the current map"),icon:ie,notable:!0};if((a.resources.entry?.activePlan||a.resources.entry?.runnerLocked)&&(a.activity==="idle"||a.activity==="docked"))return{title:e("v4_task_in_progress","Task in progress"),detail:a.coherence==="unavailable"||a.coherence==="blocked"?e("v4_task_map_unavailable","The live map is unavailable; the current task remains in progress."):a.activity==="docked"?e("v4_task_docked","Robot docked; the cleaning task has not finished."):e("v4_task_waiting","Waiting for the cleaning task to continue or finish."),icon:nt,notable:!0};if(a.command==="starting"&&(a.activity==="idle"||a.activity==="docked"))return{title:e("v4_action_starting","Starting"),detail:e("v4_action_starting_detail","Waiting for the robot to begin"),icon:ie,notable:!0};let s=a.coherence==="unavailable"||a.coherence==="blocked",n=e("v4_active_map_unavailable","The live map is unavailable; new cleaning is disabled."),o=i=>s?`${i} \xB7 ${n}`:i;if(a.activity==="cleaning")return{title:e("v4_cleaning","Cleaning"),detail:o(e("v4_cleaning_progress","Cleaning in progress")),icon:rt,notable:!0};if(a.activity==="recharging"){let i=a.batteryPercent===null?e("v4_recharging_detail","Will resume automatically when ready"):e("v4_recharging_battery","Charging to resume \xB7 {percent}% battery",{percent:a.batteryPercent});return{title:e("v4_recharging","Charging to resume"),detail:o(i),icon:is,notable:!0}}if(a.activity==="paused")return{title:e("v4_paused","Paused"),detail:o(e("v4_can_resume","Cleaning can resume")),icon:it,notable:!0};if(a.activity==="returning")return{title:e("v4_returning","Returning"),detail:o(e("v4_going_dock","Going to the dock")),icon:rt,notable:!0};if(a.activity==="stopping")return{title:e("v4_stopping","Stopping"),detail:o(e("v4_waiting_robot","Waiting for the robot")),icon:it,notable:!0};if(s)return{title:e("v4_map_unavailable","Map unavailable"),detail:e("v4_map_unavailable_status","New cleaning is disabled until the live map is verified."),icon:j,notable:!0};if(a.coherence==="degraded")return{title:e("v4_map_limited","Map limited"),detail:a.rechecking?e("v4_locating_rechecking","Checking again"):e("v4_cleaning_blocked","Cleaning can't start"),icon:ie,notable:!0,recheck:!0};let r=a.batteryPercent===null?e("v4_ready","Ready"):e("v4_battery","{percent}% battery",{percent:a.batteryPercent});return{title:a.activity==="docked"?e("v4_docked","Docked"):e("v4_ready","Ready"),detail:r,icon:ie,notable:!1}},bt=(a,t)=>{let e=(s,n)=>ve(t,s,n);switch(a.workflow){case"rooms":return{title:e("v4_choose_rooms","Choose rooms"),description:e("v4_choose_rooms_detail","Select on the map or from the list.")};case"draw":return{title:e("v4_draw_area","Draw an area"),description:e("v4_draw_area_detail","Outline or paint the area, then review it before saving.")};case"plans":return{title:e("v4_your_plans","Your plans"),description:e("v4_choose_plan_detail","Choose a plan to edit or run, or create a new one.")};case"plan":return{title:a.planDraft.id?e("v4_edit_plan","Edit plan"):e("v4_create_plan","Create a plan"),description:e("v4_plan_detail","Review rooms and cleaning settings.")};case"areaReview":return{title:e("v4_name_this_area","Name this area"),description:e("area_details_hint","Name the area and choose cleaning settings.")};case"history":return{title:e("v4_map_history","Map history"),description:e("v4_map_history_detail","Saved maps are floor-scoped and read only.")};case"support":return{title:e("v4_map_diagnostics","Map diagnostics"),description:e("v4_map_support_detail","Private geometry is never included.")};case"none":return Ys(a)?{title:e("v4_saved_map_read_only_title","Saved map is read only"),description:a.dataMode==="live"?e("v4_map_recovery_automatic","Cleaning controls return automatically when the live map is verified."):e("v4_saved_map_read_only_detail","Return to the live map to choose rooms, run a plan, or draw a custom area.")}:{title:e("v4_what_to_clean","What should the robot clean?"),description:e("v4_clean_detail","Choose rooms, a saved plan, or a custom area.")}}},Rn=new Set(["choose-cleaning","reconnecting","administrator","setup","choose-robot","problem","robot-offline","map-unavailable","locating","stopping"]),X=["peek","half","full"],Sn={info:ot,success:ls,warning:cs,error:ds},En={info:6e3,success:4e3,warning:6e3,error:1e4},Vs={none:"half",rooms:"half",draw:"peek",plan:"full",plans:"full",areaReview:"half",history:"half",support:"full"},Mn=.5,Cn=100,Pn=6,xn=48,wt=".panel-top, .sheet-body, .workflow-body",Tn=["a[href]","button","input","label","select","textarea","summary",'[contenteditable]:not([contenteditable="false"])','[role="button"]','[role="link"]','[role="slider"]','[role="checkbox"]','[role="radio"]','[role="switch"]','[role="tab"]','[role="menuitem"]',`[tabindex]:not([tabindex="-1"]):not(${wt})`].join(","),Xs=["button:not(:disabled)","a[href]","input:not(:disabled)","select:not(:disabled)","textarea:not(:disabled)","[tabindex]:not([tabindex='-1'])"].join(", "),Gs=a=>!!a.querySelector(Xs)||[...a.querySelectorAll("*")].some(t=>t.shadowRoot!==null&&Gs(t.shadowRoot)),An=(a,t,e=!1,s="room",n=!1,o="mop",r)=>{let i=(l,c,d)=>ve(t,l,c,d);switch(a){case"discardDraft":return{title:e?i("v4_discard_plan","Discard plan changes?"):i("v4_discard_area","Discard area changes?"),detail:e?i("v4_discard_plan_detail","Your plan changes have not been saved. Keep editing or discard them."):i("v4_discard_area_detail","Your area changes have not been saved. Keep editing or discard them."),cancelLabel:i("v4_keep_area_editing","Keep editing"),confirmLabel:i("v4_discard","Discard"),action:"discard"};case"confirmDeletePlan":return r&&{title:i("v4_delete_plan","Delete plan?"),detail:i("v4_delete_plan_detail",`Automations that run "{name}" will stop working, and the robot won't move.`,{name:r.name}),...r.successor===void 0?{}:{consequence:r.successor===null?i("v4_delete_plan_none","You'll have no default plan."):i("v4_delete_plan_default","{new_default} becomes your default plan.",{new_default:r.successor})},cancelLabel:i("v4_cancel","Cancel"),confirmLabel:i("plan_delete","Delete"),action:"delete-plan"};case"confirmDeleteArea":return r&&{title:i("v4_delete_area","Delete area?"),detail:i("v4_delete_area_detail",`Automations that clean "{name}" will stop working, and the robot won't move.`,{name:r.name}),...r.successor===void 0?{}:{consequence:r.successor===null?i("v4_delete_area_none","No custom area will be selected."):i("v4_delete_area_selected","{area} becomes the selected custom area.",{area:r.successor})},cancelLabel:i("v4_cancel","Cancel"),confirmLabel:i("area_delete","Delete"),action:"delete-area"};case"confirmResetCadence":return{title:o==="mop"?i("v4_reset_mop_cadence_title","Reset mopping progress?"):i("v4_reset_coverage_cadence_title","Reset vacuum rotation progress?"),detail:n?i("v4_reset_shared_cadence_detail","The count for {room} starts again in every plan that shares its schedule, and work brought forward to the next clean goes back to its schedule. Other work and cleaning history don't change.",{room:s}):i("v4_reset_private_cadence_detail","The count for {room} starts again in this plan only, and work brought forward to the next clean goes back to its schedule. Other work and cleaning history don't change.",{room:s}),cancelLabel:i("v4_cancel","Cancel"),confirmLabel:i("v4_reset","Reset"),action:"reset-room-cadence"};case null:return}},In=(a=document)=>{let t=a.activeElement;for(;t?.shadowRoot?.activeElement;)t=t.shadowRoot.activeElement;return t},js=a=>!!(a&&a.isConnected&&a.offsetParent!==null),_t=class extends Pe{constructor(){super();this.state=K();this._measuredNarrow=!1;this._sheetOffset=0;this._overflowOpen=!1;this._helpOpen=!1;this._browserFullscreen=!1;this._sheetDetent="half";this._polite="";this._alert="";this.#t=null;this.#n=new Set;this._toast=null;this.#o=new at(this,()=>import("./workflow-panel-YSYQ4366.js"));this.#l=new at(this,async()=>new(await import("./outline-editor-YPANT5BP.js")).OutlineEditor);this.#i=hs();this.#s=0;this.#h=0;this.#v=!1;this.#d=!1;this.#S=null;this.#_=null;this.#y=null;this.#f=null;this.#c=null;this.#m=null;this.#E=null;this.#I=null;this.#g=null;this.#R=new Set;this.#u=null;this.#M=null;this.#W=()=>{this._browserFullscreen=this.#a()};this.#D=e=>{if(!this._overflowOpen)return;let s=this.renderRoot.querySelector(".overflow-wrap");(!s||!e.composedPath().includes(s))&&(this._overflowOpen=!1)};this.#A=()=>{this.#k(),this.#v=!1,this.#d=!1,this._toast=null};this.#U=e=>{e.type==="pointerenter"?this.#v=!0:this.#d=!0,this.#r!==void 0&&(this.#k(),this.#h=Math.max(0,this.#s-Date.now()))};this.#V=e=>{e.type==="pointerleave"?this.#v=!1:e.currentTarget.contains(e.relatedTarget)||(this.#d=!1),this.#T()};this.#Z=()=>{this.#A(),this.updateComplete.then(()=>this.#w())};this.#J=()=>{this.#p({type:"set-notice",notice:null}),this.updateComplete.then(()=>this.#w())};this.#Y=e=>{if(!Z(this.state,{type:"open-workflow",workflow:"none"})){lt(this.state.workflow);return}this.#m=e.currentTarget,this.#g="reload",this.#p({type:"open-dialog",dialog:"discardDraft"})};new ms(this,{container:()=>this.renderRoot?.querySelector(".draw-tools")??null,items:"button"})}static{this.properties={state:{attribute:!1},localize:{attribute:!1},dates:{attribute:!1},_measuredNarrow:{state:!0},_sheetOffset:{state:!0},_overflowOpen:{state:!0},_helpOpen:{state:!0},_browserFullscreen:{state:!0},_sheetDetent:{state:!0},_polite:{state:!0},_alert:{state:!0},_toast:{state:!0}}}static{this.styles=Fs}#e(e,s,n){return ve(this.localize,e,s,n)}#t;#n;#o;#l;#i;#r;#s;#h;#v;#d;#S;#_;#y;#f;#c;#m;#E;#I;#g;#R;#u;#M;#K(){let e=this.renderRoot;return e instanceof ShadowRoot?e.fullscreenElement??document.fullscreenElement:document.fullscreenElement}#W;#a(){let e=this.renderRoot,s=e.querySelector(".app"),n=e instanceof ShadowRoot?e.fullscreenElement:null;if(n)return n===s;let o=document.fullscreenElement;for(let r=this;r;){if(r===o)return!0;let i=r.getRootNode();r=i instanceof ShadowRoot?i.host:null}return!1}#D;connectedCallback(){super.connectedCallback(),this.#_=new ResizeObserver(([e])=>{if(!e)return;let s=e.contentRect.width<1024||e.contentRect.height<480;s!==this._measuredNarrow&&(this._measuredNarrow=s)}),this.#_.observe(this),window.addEventListener("pointerdown",this.#D,!0),document.addEventListener("fullscreenchange",this.#W),this.#y=new ResizeObserver(([e])=>{if(!e)return;let s=Math.ceil(e.target.getBoundingClientRect().height);s!==this._sheetOffset&&(this._sheetOffset=s)}),this.#f=new ResizeObserver(()=>this.#he())}disconnectedCallback(){this.#A(),this.#_?.disconnect(),this.#_=null,this.#y?.disconnect(),this.#y=null,this.#f?.disconnect(),this.#f=null,this.#c=null,window.removeEventListener("pointerdown",this.#D,!0),document.removeEventListener("fullscreenchange",this.#W),super.disconnectedCallback()}#b(e,s){if(this.#n.has(e)){this.updateComplete.then(()=>this.#b(e,s));return}this.#n.add(e);let n=this[e]===s;this[e]=n?"":s,this.updateComplete.then(()=>{this.#n.delete(e),n&&!this[e]&&this.#b(e,s)})}willUpdate(e){if(this.#S=this.shadowRoot?.activeElement??null,!e.has("state"))return;let s=gt(this.state).title;this.#t!==null&&s!==this.#t&&this.#b("_polite",gt(this.state,this.localize).title),this.#t=s;let n=this.state.notice,o=e.get("state");n!==o?.notice&&(!n&&o?.notice?.tone==="success"&&o.workflow!==this.state.workflow||(this.#A(),n&&(this._toast=n,this.#h=En[n.tone],this.#b(n.tone==="error"?"_alert":"_polite",this.#e(n.key,n.fallback,n.placeholders)),this.updateComplete.then(()=>{if(this.state.notice!==n)return;let r=this.renderRoot.querySelector("[data-notice-toast]");this.#v=!!r?.matches(":hover"),this.#d=!!r?.contains(this.shadowRoot?.activeElement??null),this.#T()}))))}#T(){!this._toast||this.#r!==void 0||this.#v||this.#d||(this.#s=Date.now()+this.#h,this.#r=setTimeout(this.#A,this.#h))}#k(){clearTimeout(this.#r),this.#r=void 0}#A;#U;#V;#Z;#J;#j(e,s,n){return b`${I(Sn[e.tone])}<span class="notice-text">${this.#e(e.key,e.fallback,e.placeholders)}</span><button
      class="ms-btn ms-btn--icon"
      type="button"
      aria-label=${n}
      @click=${s}
    >${I(as)}</button>`}updated(e){let s=e,n=this.#S;this.#S=null,n&&(!n.isConnected||n.closest("[hidden]"))&&this.#w();let o=this.renderRoot.querySelector(".mobile-sheet");o!==this.#c&&(this.#y?.disconnect(),this.#c=o,o?this.#y?.observe(o):this._sheetOffset!==0&&(this._sheetOffset=0)),this.#f?.disconnect();for(let r of this.renderRoot.querySelectorAll(wt))for(let i of[r,...r.children])this.#f?.observe(i);if(s.has("_overflowOpen")&&this._overflowOpen&&this.updateComplete.then(()=>{this.renderRoot.querySelector("#map-options select, #map-options button")?.focus()}),s.has("_helpOpen")){if(this._helpOpen)this.updateComplete.then(()=>{this.renderRoot.querySelector(".help-dialog [data-dialog-initial-focus]")?.focus()});else if(s.get("_helpOpen")){let r=this.#I;this.#I=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>r?.focus({preventScroll:!0}))})}}if(e.has("state")){this.#pe();let r=e.get("state");if(r?.precisionOpen&&!this.state.precisionOpen&&this.#L()?.focus(),r?.fullMap&&!this.state.fullMap){let i=this.#E;this.#E=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>{(this.renderRoot.querySelector(".workspace-toggle")??this.renderRoot.querySelector(".nav--menu")??(i?.isConnected?i:null))?.focus({preventScroll:!0})})})}if(r&&!r.fullMap&&this.state.fullMap&&this.updateComplete.then(()=>{let i=this.#E;requestAnimationFrame(()=>{(this.renderRoot.querySelector(".workspace-toggle")??(i?.isConnected?i:null))?.focus({preventScroll:!0})})}),!r?.dialog&&this.state.dialog){let i=In(this.shadowRoot||document);i?.hasAttribute("data-dialog-launcher")&&(this.#m=i),this.updateComplete.then(()=>{(this.renderRoot.querySelector(".dialog [data-dialog-initial-focus]")??this.renderRoot.querySelector(".dialog button"))?.focus()})}else if(r?.dialog&&!this.state.dialog){r.dialog==="discardDraft"&&(this.#g=null,this.#H());let i=this.#m?.isConnected&&this.#m.hasAttribute("data-dialog-launcher")?this.#m:this.#ce(r.dialog);this.#m=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>i?.focus({preventScroll:!0}))})}r?r.workflow!==this.state.workflow&&(this._sheetDetent=Vs[this.state.workflow],this.updateComplete.then(()=>this.#w())):this._sheetDetent=Vs[this.state.workflow]}}#he(){for(let e of this.renderRoot.querySelectorAll(wt))e.scrollHeight>e.clientHeight&&!Gs(e)?e.tabIndex=0:e.removeAttribute("tabindex")}#w(){[".panel-heading h2",".action-bar .ms-btn--primary",".workspace-toggle"].map(e=>this.renderRoot.querySelector(e)).find(js)?.focus({preventScroll:!0})}#L(){let e=this.renderRoot.querySelector(".draw-brush");return js(e)?e:this.renderRoot.querySelector(Ae)?.shadowRoot?.querySelector(".draw-brush")??null}#p(e){if(Z(this.state,e)){this.#g=e,this.#p({type:"open-dialog",dialog:"discardDraft"});return}this.dispatchEvent(new CustomEvent(dt,{detail:e,bubbles:!0,composed:!0}))}#z(e){if(e.enabled){if(e.id==="return-live"){this.#p({type:"set-history",historyId:null});return}if(e.id==="clear-draft"){this.#p({type:"clear-draft"});return}this.#X(e.id)}}#B(e,s){let n={type:"open-workflow",workflow:e};s instanceof HTMLElement&&Z(this.state,n)&&(this.#m=s),this.#p(n)}#pe(){let e=this.#i,{coherence:s,workflow:n}=this.state;!e||n==="none"&&(s==="booting"||s==="verifying")||(this.#i=null,n==="none"&&this.#R.has(e)&&this.#B(e))}#Y;#Q(e){if(this.#o.request(),e!=="draw")return this.#o.status;this.#l.request();let s=this.#o.status,n=this.#l.status;return s==="failed"||n==="failed"?"failed":s===n?s:"loading"}#ee(){let e=this.#g;if(this.#g=null,e==="reload"){lt(this.state.workflow);return}e?.type==="select-plan"||e?.type==="select-area"?(this.#p({type:"patch-plan-draft",patch:{dirty:!1}}),this.#p({type:"patch-area-draft",patch:{dirty:!1}}),this.#p({type:"dismiss-top-layer"})):this.#p({type:"discard-draft"}),e&&e.type!=="dismiss-top-layer"&&queueMicrotask(()=>this.dispatchEvent(new CustomEvent(dt,{detail:e,bubbles:!0,composed:!0})))}#N(){this.#g=null,this.#$(),this.#H()}#H(){this.updateComplete.then(()=>{let e=this.renderRoot.querySelector(".floor-switcher");e&&(e.value=this.state.selection.floorId);let s=this.renderRoot.querySelector(".robot-switcher");s&&(s.value=this.state.selection.entryId??"")})}#$(){let e=this.state.dialog,s=e&&this.#m?.isConnected&&this.#m.hasAttribute("data-dialog-launcher")?this.#m:e?this.#ce(e):null;this.#p({type:"dismiss-top-layer"}),s&&requestAnimationFrame(()=>s.focus({preventScroll:!0}))}#X(e){this.dispatchEvent(new CustomEvent(fs,{detail:typeof e=="string"?{id:e}:e,bubbles:!0,composed:!0}))}#te(e){this.#p({type:"dismiss-top-layer"}),this.#X(e)}#we(e){if(e.action==="discard"){this.#ee();return}if(e.action==="delete-plan"||e.action==="delete-area"){this.#te(e.action);return}let s=this.state.cadenceResetRequest;this.#p({type:"dismiss-top-layer"}),s&&this.#X({id:"reset-room-cadence",planId:s.planId,roomId:s.roomId,mode:s.mode})}#O(e){e!==this._sheetDetent&&(this._sheetDetent=e,this.#b("_polite",e==="peek"?this.#e("v4_workspace_height_peek","Map workspace, peek height"):e==="half"?this.#e("v4_workspace_height_half","Map workspace, half height"):this.#e("v4_workspace_height_full","Map workspace, full height")))}#C(e,s=!1){let o=X.indexOf(this._sheetDetent)+e;s&&o>=X.length&&(o=0),o=Math.max(0,Math.min(X.length-1,o)),this.#O(X[o]??this._sheetDetent)}#re(e){let s=this.renderRoot.querySelector(".workspace")?.clientHeight??e.parentElement?.clientHeight??e.offsetHeight,n=parseFloat(getComputedStyle(this).fontSize)||16,o=[".sheet-grip",".sheet-tools",".action-bar"].map(l=>e.querySelector(l)?.offsetHeight??0).reduce((l,c)=>l+c,0)+n*.75,r=Math.min(s*.92,s-n*9),i=Math.min(s*.48,n*26,r);return{peek:Math.min(o,i),half:i,full:r}}#G(){return this.renderRoot.querySelector(".mobile-sheet")}#ie(e,s){e.style.transform=s;let n=this.renderRoot.querySelector("[data-notice-toast]");n&&(n.style.transform=s)}#ae(e){let s=e.currentTarget;for(let n of e.composedPath()){if(n===s)return!1;if(n instanceof Element&&n.matches(Tn))return!0}return!1}#me(e){if(e.pointerType==="mouse"&&e.button!==0||this.#ae(e))return;let s=this.#G();!s||this.#u||(this.#u={pointerId:e.pointerId,startY:e.clientY,startHeight:s.offsetHeight,heights:this.#re(s),samples:[{y:e.clientY,t:e.timeStamp}],moved:!1},e.currentTarget.setPointerCapture(e.pointerId),s.classList.add("dragging"))}#fe(e){let s=this.#u;if(!s||e.pointerId!==s.pointerId)return;let n=this.#G();if(!n)return;let o=e.clientY-s.startY;for(!s.moved&&Math.abs(o)>Pn&&(s.moved=!0),s.samples.push({y:e.clientY,t:e.timeStamp});s.samples.length>2&&e.timeStamp-(s.samples[1]?.t??0)>Cn;)s.samples.shift();if(!s.moved)return;let r=s.startHeight-s.heights.full,i=s.startHeight-s.heights.peek,l=Math.max(r,Math.min(i,o));this.#ie(n,`translateY(${l}px)`)}#ve(e){let s=this.#u;if(!s||e.pointerId!==s.pointerId)return;this.#u=null;let n=this.#G();if(n&&(this.#ie(n,""),n.classList.remove("dragging")),e.type==="pointercancel")return;if(!s.moved){this.#C(1,!0);return}let o=e.clientY-s.startY,r=X.indexOf(this._sheetDetent),i=s.samples[0],l=s.samples[s.samples.length-1],c=i&&l&&l!==i?(l.y-i.y)/Math.max(1,l.t-i.t):0;if(Math.abs(c)>Mn){let h=Math.max(0,Math.min(X.length-1,r+(c<0?1:-1)));this.#O(X[h]??this._sheetDetent);return}let d=s.startHeight-o,u=this._sheetDetent,m=Number.POSITIVE_INFINITY;for(let h of X){let f=Math.abs(s.heights[h]-d);f<m&&(m=f,u=h)}this.#O(u)}#ye(e){for(let s of e.composedPath()){if(s===e.currentTarget)break;if(s instanceof HTMLElement&&s.scrollHeight>s.clientHeight&&/auto|scroll/u.test(getComputedStyle(s).overflowY))return s}return null}#P(e){if(e.pointerType==="mouse"||this.#ae(e))return;let s=this.#ye(e);this.#M=s?.scrollTop?null:{pointerId:e.pointerId,startY:e.clientY,scroller:s,consumed:!1}}#x(e){let s=this.#M;if(!(!s||s.consumed||e.pointerId!==s.pointerId)){if(s.scroller?.scrollTop){this.#M=null;return}e.clientY-s.startY<xn||(s.consumed=!0,this.#C(-1))}}#q(){this.#M=null}#_e(){this.dispatchEvent(new CustomEvent("hass-toggle-menu",{bubbles:!0,composed:!0}))}#se(e){this.#E=e.currentTarget,this.#p({type:this.state.fullMap?"exit-full-map":"enter-full-map"})}#ke(e){this._overflowOpen=!1,e&&this.updateComplete.then(()=>{this.renderRoot.querySelector(".overflow")?.focus()})}#ne(e){if(this.#ke(e==="fullscreen"),e==="support"){this.#B("support");return}let s=this.renderRoot.querySelector(".app");this.#K()?document.exitFullscreen():s?.requestFullscreen()}#Se(){this.#p({type:"set-precision-open",value:!this.state.precisionOpen})}#oe(e){this.#I=e.currentTarget,this._helpOpen=!0}#le(e){let s=e;if(!Se(s.detail))return;if(Z(this.state,s.detail)){e.stopPropagation(),this.#p(s.detail);return}if(s.detail?.type!=="open-dialog")return;let n=s.composedPath().find(o=>o instanceof HTMLElement&&o.hasAttribute("data-dialog-launcher"));n instanceof HTMLElement&&(this.#m=n)}#ce(e){return this.renderRoot.querySelector(Ze)?.shadowRoot?.querySelector(`[data-dialog-launcher="${e}"]`)??null}#ge(e){if(!ps(e)&&!(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey)&&e.key==="Escape"){if(e.preventDefault(),this._overflowOpen){this.#ke(!0);return}if(this._helpOpen){this._helpOpen=!1;return}if(this.state.dialog==="discardDraft"){this.#N();return}this.#p({type:"dismiss-top-layer"})}}#Re(e){if(e.key!=="Tab")return;let n=[...e.currentTarget.querySelectorAll(Xs)],o=n[0],r=n.at(-1);if(!o||!r)return;let i=this.shadowRoot?.activeElement;e.shiftKey&&i===o?(e.preventDefault(),r.focus()):!e.shiftKey&&i===r&&(e.preventDefault(),o.focus())}#Ee(){let e=this.renderRoot.querySelector(Ae);(e?.shadowRoot?.querySelector(".map-root")??e)?.focus()}#be(){this._sheetDetent==="peek"&&this.#G()&&this.#O("half"),this.updateComplete.then(()=>this.#w())}#F(e,s,n){if(Rn.has(e.id))return k;let o=e.labelKey?this.#e(e.labelKey,e.label,e.labelPlaceholders):e.label,r=!e.enabled&&e.reason?e.reasonKey?this.#e(e.reasonKey,e.reason):e.reason:null,i=e.id==="stop";return b`
      <button
        class=${`${s} ${e.kind==="danger"?"ms-btn--danger":""}`}
        type="button"
        aria-disabled=${e.enabled?k:"true"}
        aria-describedby=${r?n:k}
        aria-label=${i?this.#e("v4_stop_cleaning_label","Stop cleaning"):k}
        @click=${()=>this.#z(e)}
      >${o}</button>
      ${r?b`<p class="action-reason" id=${n}>${r}</p>`:k}
    `}#de(e){let s=e.resources.plans.value?.rooms??e.resources.areas.value?.rooms??[];return Qt(e.locale,e.selection.roomIds.map(n=>s.find(o=>o.roomId===n)?.name??n))}#Pe(e,s,n){let o=this.#de(e),r=s?.enabled&&e.workflow==="rooms"&&s.id==="clean-rooms"?e.planDraft.returnToBase&&o?this.#e("v4_rooms_summary_dock","{rooms} \xB7 returns to the dock",{rooms:o}):o:"";return b`
      <div class="action-bar">
        ${r?b`<p class="action-summary">${r}</p>`:k}
        ${s?this.#F(s,"ms-btn ms-btn--block ms-btn--lg ms-btn--primary","primary-reason"):k}
        ${n?this.#F(n,"ms-btn ms-btn--block ms-btn--lg ms-btn--secondary","secondary-reason"):k}
      </div>
    `}#ue(e,s,n=k){return b`
      <div class="host-state">
        <h3>${e}</h3>
        <p>${s}</p>
        ${n}
      </div>
    `}#Me(e,s=!1){return s||this.#R.add(e),()=>{s||this.#B(e)}}#Ce(e,s,n,o,r=!1){return b`
      <button
        class="ms-row"
        type="button"
        aria-disabled=${r?"true":k}
        @click=${this.#Me(n,r)}
      >
        <span class="ms-row__lead">${I(s)}</span>
        <span class="ms-row__body"><strong>${e}</strong>${o?b`<small>${o}</small>`:k}</span>
        <span class="ms-row__trail">${I(Oe)}</span>
      </button>
    `}#Ae(e){let s=e.resources.history.value?.floors||[],n=s.length?s.map((o,r)=>({id:o.active?"current":o.id,label:`${o.label||(o.active?this.#e("v4_current_floor","Current floor"):this.#e("v4_saved_floor","Saved floor {number}",{number:o.ordinal??r+1}))}${!o.active&&o.snapshots.length===0?` \xB7 ${this.#e("v4_floor_not_captured","Visit floor to capture")}`:""}`,disabled:!o.active&&o.snapshots.length===0})):[{id:e.selection.floorId,label:e.floor.displayName,disabled:!1}];return b`
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
    `}#Ie(e,s,n){let o=(v,g,P)=>this.#e(v,g,P);this.#R=new Set(["support"]);let r=()=>this.#Ce(o("v4_map_history","Map history"),st,"history",o("v4_map_history_detail","Saved maps are floor-scoped and read only.")),i=()=>this.#Ce(o("v4_map_diagnostics","Map diagnostics"),ot,"support",o("v4_map_support_detail","Private geometry is never included.")),{host:l}=e;if(!l.connected)return this.#ue(o("v4_reconnecting_title","Reconnecting to Home Assistant"),o("v4_reconnecting_body","The last verified map stays read-only until the connection returns."));if(!l.administrator)return this.#ue(o("v4_admin_title","Administrator access required"),o("v4_admin_body","Ask a Home Assistant administrator to open this map."));if(l.robotCount===0)return this.#ue(o("v4_no_robot_title","No Matic robot set up"),o("v4_no_robot_body","Add the Matic integration to see a map here."),b`<a class="ms-btn ms-btn--secondary" href="/config/integrations/integration/matic_robot">${o("v4_open_integration","Open the Matic integration")}</a>`);if(Ee(e))return this.#ue(o("v4_selected_robot_unavailable","Selected robot unavailable"),o("v4_choose_another_robot","Choose another robot to open its map."));if(!l.robotConnected)return b`
        ${this.#ue(o("v4_robot_offline_title","Robot offline"),o("v4_robot_offline_body","Showing the last verified map. Cleaning is unavailable until the robot reconnects."))}
        <h3 class="shelf-heading">${o("v4_more","Map tools")}</h3>
        <div class="shelf">${r()}${i()}</div>
      `;if(Ys(e))return b`
        <h3 class="shelf-heading">${o("v4_more","Map tools")}</h3>
        <div class="shelf">
          ${r()}
          ${i()}
        </div>
      `;let c=e.coherence==="verifying"||e.coherence==="booting",d=e.resources.plans,u=d.value,m=u!==null&&u.rooms.length===0,h=u?.plans.length??0,f=d.status==="loading",w=d.status==="error",y=c||m,_=c?o("v4_reason_locating","Waiting for the robot to confirm which floor it is on."):m?o("v4_no_rooms_reason","This floor has no named rooms yet."):null,M=c?o("v4_reason_locating","Waiting for the robot to confirm which floor it is on."):null,R=c?o("v4_reason_locating","Waiting for the robot to confirm which floor it is on."):o("v4_areas_quick_detail","Create or choose a saved area");return b`
      ${e.activity==="problem"?this.#ue(o("v4_attention_title","The robot needs attention"),o("v4_attention_body","Check the robot, then start a new task.")):n.recheck?b`
          <div class="host-state">
            <p>${o("v4_map_limited_body","Home Assistant can show this map but can't confirm it well enough to start cleaning.")}</p>
            <button
              class="ms-btn ms-btn--secondary"
              type="button"
              aria-disabled=${e.rechecking?"true":k}
              @click=${()=>{this.state.rechecking||this.#X("recheck-status")}}
            >${o("v4_retry","Try again")}</button>
          </div>
        `:b`
          <div class="quick-actions" role="group" aria-label=${o("v4_cleaning_choices","Cleaning choices")}>
            <button
              class="ms-row ms-row--card ms-row--featured"
              type="button"
              aria-disabled=${y?"true":k}
              @click=${this.#Me("rooms",y)}
            >
              <span class="ms-row__lead">${I(ie)}</span>
              <span class="ms-row__body">
                <strong>${o("v4_clean_rooms","One-time clean")}</strong>
                <small>${_??o("v4_clean_rooms_hint","Choose rooms for this run")}</small>
              </span>
              <span class="ms-row__trail">${I(Oe)}</span>
            </button>
            <button
              class="ms-row ms-row--card"
              type="button"
              aria-disabled=${c?"true":k}
              @click=${this.#Me("plans",c)}
            >
              <span class="ms-row__lead">${I(nt)}</span>
              <span class="ms-row__body">
                <strong>${f?o("v4_plans_loading","Checking saved plans"):w?o("v4_plans_unavailable","Plans unavailable"):h?o("v4_run_a_plan","Run a plan"):o("v4_create_plan","Create a plan")}</strong>
                <small>${M??(f?o("v4_plans_loading_hint","Reading routines for this floor"):w?o("v4_plans_unavailable_hint","Try again to load saved routines"):h?h===1?o("v4_saved_routine","1 saved routine"):o("v4_saved_routines","{count} saved routines",{count:h}):o("v4_no_plans_hint","Save a room routine you can repeat"))}</small>
              </span>
              <span class="ms-row__trail">${I(Oe)}</span>
            </button>
          </div>
        `}
      <h3 class="shelf-heading">${o("v4_more","Map tools")}</h3>
      <div class="shelf">
        ${this.#Ce(o("v4_custom_areas","Clean a custom area"),rs,"draw",R,c)}
        ${r()}

      </div>
      ${s?b`
        <h3 class="shelf-heading" id="map-display-heading">${o("v4_map_display","Map display")}</h3>
        <div class="map-display">
          <div class="ms-segment" role="group" aria-labelledby="map-display-heading">
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(e.appearance==="photo")}
              @click=${()=>this.#p({type:"set-appearance",appearance:"photo"})}
            >${o("map_style_photo","Photo")}</button>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(e.appearance==="rooms")}
              @click=${()=>this.#p({type:"set-appearance",appearance:"rooms"})}
            >${o("v4_room_colours","Floor plan")}</button>
          </div>
          <label class="ms-checkbox">
            <input type="checkbox" .checked=${e.labelsVisible} @change=${()=>this.#p({type:"toggle-labels"})}>
            ${o("v4_room_names","Room names")}
          </label>
          <button
            class="ms-btn ms-btn--secondary help-launcher"
            type="button"
            aria-haspopup="dialog"
            aria-expanded=${String(this._helpOpen)}
            @click=${this.#oe}
          >${o("v4_how_to_move","How to move the map")}</button>
        </div>
      `:k}
    `}#$e(e,s,n){if(e.workflow==="none")return this.#Ie(e,s,n);let o=this.#Q(e.workflow);return o!=="ready"?s&&e.workflow==="draw"?k:ct(o,this.localize,this.#Y):b`<${Us}
      .state=${e}
      .localize=${this.localize}
      .dates=${this.dates}
      .retry=${this.#Y}
      @matic-workspace-intent=${this.#le}
    ></${Us}>`}#xe(e){return b`
      <div class="panel-top">
        <div class="panel-heading">
          ${e.workflow!=="none"?b`
            <button
              class="panel-back ms-btn ms-btn--secondary"
              type="button"
              aria-label=${e.workflow==="plan"?this.#e("v4_back_to_plans","Back to plans"):this.#e("v4_back_to_all_tasks","Back to all tasks")}
              data-dialog-launcher="discardDraft"
              @click=${s=>this.#B(e.workflow==="plan"?"plans":"none",s.currentTarget)}
            >${I($e)}<span class="ms-btn__label">${e.workflow==="plan"?this.#e("v4_your_plans","Your plans"):this.#e("v4_all_tasks","All tasks")}</span></button>
          `:k}
          <h2 id="workspace-title" tabindex="-1">${bt(e,this.localize).title}</h2>
        </div>
        ${e.notice?b`<div class="notice" data-notice-slot data-tone=${e.notice.tone}>${this.#j(e.notice,this.#J,this.#e("v4_close","Close"))}</div>`:k}
      </div>
    `}#Te(e,s,n){return b`
      <p class="panel-description">${bt(e,this.localize).description}</p>
      ${this.#$e(e,s,n)}
    `}#Oe(e,s){let o=bt(e,this.localize).title;return e.workflow==="rooms"&&e.selection.roomIds.length&&(o=this.#e("v4_rooms_selected_names","Rooms selected: {count} \xB7 {rooms}",{count:e.selection.roomIds.length,rooms:this.#de(e)})),this._sheetDetent!=="peek"?s.detail?`${s.title} \xB7 ${s.detail}`:s.title:s.notable?`${s.title} \xB7 ${o}`:o}#De(){let e=(s,n)=>this.#e(s,n);return b`
      <div class="dialog-backdrop" @click=${s=>{s.target===s.currentTarget&&(this._helpOpen=!1)}}>
        <section
          class="dialog help-dialog ms-surface ms-surface--overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-title"
          @keydown=${this.#Re}
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
    `}render(){let e=this.state,s=e.narrowHint||this._measuredNarrow,n=gt(e,this.localize),o=Ee(e),r=Ot({...e,narrowHint:s}),i=Dt(e),l=!s&&r.id==="stop"?r:!s&&i?.id==="stop"?i:null,c=l&&l===r?null:r,d=e.workflow==="draw"&&e.dataMode==="live"?{id:"clear-draft",label:"Clear drawing",labelKey:"v4_clear_drawing",kind:"neutral",enabled:e.draw.circles.length>0||!!e.draw.outline?.points.length}:null,u=l&&l===i?null:i??d,m=e.fullMap&&(e.coherence==="verifying"||e.coherence==="booting"),h=e.fullMap||e.host.administrator&&e.host.robotCount>0&&e.map.available,f=e.cadenceResetRequest?e.resources.plans.value?.rooms.find(g=>g.roomId===e.cadenceResetRequest?.roomId):void 0,w=e.cadenceResetRequest?e.resources.plans.value?.plans.find(g=>g.id===e.cadenceResetRequest?.planId)?.rooms.find(g=>g.roomId===e.cadenceResetRequest?.roomId):void 0,y=An(e.dialog,this.localize,e.workflow==="plan",f?.name||e.cadenceResetRequest?.roomId||"room",w?.cadence?.scope==="shared",e.cadenceResetRequest?.mode,xt(e)),_=s&&!e.fullMap?`--map-sheet-offset:${this._sheetOffset}px`:"--map-sheet-offset:0px",M=s&&e.workflow==="draw",R=e.precisionOpen&&e.workflow==="draw",v=this._toast&&(this._toast.tone==="success"||this._toast.tone==="error"||e.fullMap||s&&this._sheetDetent==="peek")?this._toast:null;return b`
      <div class=${`root ${s?"narrow":"wide"}`} @keydown=${this.#ge}>
        <button class="skip-link ms-btn ms-btn--primary" type="button" @click=${this.#Ee}>${this.#e("v4_skip_to_map","Skip to the map")}</button>
        <button class="skip-link ms-btn ms-btn--primary" type="button" @click=${this.#be}>${this.#e("v4_skip_to_workspace","Skip to the map workspace")}</button>
        <div class="app" ?inert=${!!y||this._helpOpen}>
          <header class="app-bar">
            ${e.precisionOpen?k:b`
              <button
                class="nav nav--menu ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#e("v4_open_navigation","Open Home Assistant sidebar")}
                title=${this.#e("v4_open_navigation","Open Home Assistant sidebar")}
                @click=${this.#_e}
              >${I(ts)}</button>
            `}

            ${e.precisionOpen?b`
              <button
                class="nav ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#e("v4_back","Back")}
                @click=${()=>this.#p({type:"dismiss-top-layer"})}
              >${I($e)}</button>
            `:k}
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
              `:k}${e.robots.map(g=>b`
                <option value=${g.entryId} ?selected=${g.entryId===e.selection.entryId}>${g.label}</option>
              `)}</select>
            `:k}

            <span class="spacer"></span>
            ${h?b`
              <button
                class="workspace-toggle ms-btn ms-btn--icon"
                type="button"
                aria-label=${e.fullMap?this.#e("v4_show_workspace","Show cleaning panel"):this.#e("v4_hide_workspace","Hide cleaning panel")}
                aria-controls="map-workspace"
                aria-expanded=${String(!e.fullMap)}
                title=${e.fullMap?this.#e("v4_show_workspace","Show cleaning panel"):this.#e("v4_hide_workspace","Hide cleaning panel")}
                @click=${this.#se}
              >${I(ss)}</button>
            `:k}
            <div class="overflow-wrap">
              <button
                class="overflow ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#e("v4_map_options","Map options")}
                aria-expanded=${String(this._overflowOpen)}
                aria-controls="map-options"
                @click=${()=>{this._overflowOpen=!this._overflowOpen}}
              >${I(es)}</button>
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
                  <button class="ms-row ms-row--menu" type="button" @click=${()=>this.#ne("support")}>${this.#e("v4_map_diagnostics","Map diagnostics")}</button>
                  <button class="ms-row ms-row--menu" type="button" @click=${()=>this.#ne("fullscreen")}>${this._browserFullscreen?this.#e("v4_leave_full_screen","Leave full screen"):this.#e("v4_full_screen","Full screen")}</button>
                </div>
              `:k}
            </div>
          </header>

          <main class=${`workspace ${e.fullMap?"full-map":""}`} style=${_}>
            <div class="canvas">
              <${Ks}
                class="map-canvas"
                style=${_}
                .state=${e}
                .localize=${this.localize}
                .outlineEditor=${this.#l.value}
                .narrow=${s}
              >${this.#Ae(e)}
                ${s&&!e.fullMap&&this._sheetDetent==="full"?b`
                  <button
                    class="sheet-scrim"
                    slot="scrim"
                    data-map-control
                    type="button"
                    aria-label=${this.#e("v4_collapse_sheet","Collapse the map workspace")}
                    @click=${()=>this.#O("peek")}
                  ></button>
                `:k}
              </${Ks}>
              ${!s&&R?b`
                <div class="precision-popover">
                  <${Xe} compact .state=${e} .localize=${this.localize}></${Xe}>
                </div>
              `:k}
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
              data-detent=${s?this._sheetDetent:k}
              data-workflow=${e.workflow}
              aria-label=${this.#e("v4_map_workspace","Map workspace")}
            >
              ${s?b`
                <div
                  class="sheet-grip"
                  @pointerdown=${this.#me}
                  @pointermove=${this.#fe}
                  @pointerup=${this.#ve}
                  @pointercancel=${this.#ve}
                >
                  <span class="sheet-handle" role="presentation"></span>
                  ${e.workflow!=="none"&&this._sheetDetent==="peek"?b`
                    <button
                      class="sheet-back ms-btn ms-btn--icon ms-btn--sm"
                      type="button"
                      aria-label=${e.workflow==="plan"?this.#e("v4_back_to_plans","Back to plans"):this.#e("v4_back_to_all_tasks","Back to all tasks")}
                      title=${e.workflow==="plan"?this.#e("v4_back_to_plans","Back to plans"):this.#e("v4_back_to_all_tasks","Back to all tasks")}
                      data-dialog-launcher="discardDraft"
                      @click=${g=>this.#B(e.workflow==="plan"?"plans":"none",g.currentTarget)}
                    >${I($e)}</button>
                  `:k}
                  <span class="sheet-status">${this.#Oe(e,n)}</span>
                  <button
                    class="ms-btn ms-btn--icon ms-btn--sm"
                    type="button"
                    aria-label=${this.#e("v4_show_more","Show more of the map workspace")}
                    aria-controls="sheet-panel"
                    aria-disabled=${this._sheetDetent==="full"?"true":k}
                    @click=${()=>this.#C(1)}
                  >${I(ns)}</button>
                  <button
                    class="ms-btn ms-btn--icon ms-btn--sm"
                    type="button"
                    aria-label=${this.#e("v4_show_less","Show less of the map workspace")}
                    aria-controls="sheet-panel"
                    aria-disabled=${this._sheetDetent==="peek"?"true":k}
                    @click=${()=>this.#C(-1)}
                  >${I(os)}</button>
                </div>
                ${M?b`
                  <div class="sheet-tools">
                    ${ct(this.#Q("draw"),this.localize,this.#Y)}
                    ${us(e,{intent:g=>this.#p(g),openBrush:()=>this.#Se(),t:(g,P,O)=>this.#e(g,P,O)},"grid")}
                    ${R?b`
                      <div class="precision-popover">
                        <${Xe} compact inline .state=${e} .localize=${this.localize}></${Xe}>
                      </div>
                    `:k}
                  </div>
                `:k}
                <div
                  class="sheet-panel"
                  id="sheet-panel"
                  @pointerdown=${this.#P}
                  @pointermove=${this.#x}
                  @pointerup=${this.#q}
                  @pointercancel=${this.#q}
                >
                  ${this.#xe(e)}
                  <div class="sheet-body" role="region" aria-labelledby="workspace-title">${this.#Te(e,s,n)}</div>
                </div>
                ${this.#Pe(e,c,u)}
              `:b`
                <div class="status-strip">
                  <span class="status-icon" aria-hidden="true">${I(n.icon)}</span>
                  <span class="status-copy"><strong>${n.title}</strong><small>${n.detail}</small></span>
                  ${l?this.#F(l,"status-action ms-btn ms-btn--secondary","status-reason"):k}
                </div>
                <section class="workflow">
                  ${this.#xe(e)}
                  <div class="workflow-body" role="region" aria-labelledby="workspace-title">${this.#Te(e,s,n)}</div>
                  ${this.#Pe(e,c,u)}
                </section>
              `}
            </aside>

            ${e.fullMap?b`
              <section
                class=${`full-map-hud ms-surface ms-surface--floating ${i?"has-secondary":""} ${!s&&(e.workflow==="draw"||e.workflow==="rooms"&&e.selection.roomIds.length>0)?"above-dock":""}`}
                aria-label=${this.#e("v4_robot_status_and_action","Robot status and action")}
              >
                <span class="hud-copy"><strong>${n.title}</strong><small>${n.detail}</small></span>
                ${m&&r.id!=="stop"?k:this.#F(r,"ms-btn ms-btn--lg ms-btn--primary","hud-reason")}
                ${i&&(!m||i.id==="stop")?this.#F(i,"ms-btn ms-btn--lg ms-btn--secondary","hud-secondary-reason"):k}
              </section>
            `:k}
          </main>
        </div>

        <div
          class="notice notice-toast"
          data-notice-toast
          role="region"
          aria-label=${this.#e("v4_notifications","Notifications")}
          data-tone=${v?.tone??k}
          style=${_}
          ?hidden=${!v}
          ?inert=${!!y||this._helpOpen}
          @pointerenter=${this.#U}
          @focusin=${this.#U}
          @pointerleave=${this.#V}
          @focusout=${this.#V}
        >${v?this.#j(v,this.#Z,this.#e("v4_hide_notification","Hide notification")):k}</div>

        <div class="sr-only" aria-live="polite" aria-atomic="true">${this._polite}</div>
        <div class="sr-only" role="alert" aria-atomic="true">${this._alert}</div>

        ${this._helpOpen?this.#De():k}

        ${y?b`
          <div class="dialog-backdrop">
            <section
              class="dialog ms-surface ms-surface--overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="dialog-title"
              aria-describedby="dialog-detail"
              @keydown=${this.#Re}
            >
              <h2 id="dialog-title">${y.title}</h2>
              <div id="dialog-detail">
                <p>${y.detail}</p>
                ${y.consequence?b`<p>${y.consequence}</p>`:k}
              </div>
              <div class="dialog-actions">
                <button
                  class="ms-btn ms-btn--secondary"
                  type="button"
                  data-dialog-initial-focus
                  @click=${e.dialog==="discardDraft"?this.#N:this.#$}
                >${y.cancelLabel}</button>
                <button
                  class="discard ms-btn ms-btn--primary ms-btn--danger"
                  type="button"
                  @click=${()=>this.#we(y)}
                >${y.confirmLabel}</button>
              </div>
            </section>
          </div>
        `:k}
      </div>
    `}};customElements.get(me)||customElements.define(me,_t);var Qs=ae(me),we=new WeakMap,$n={},On=3e4,kt=(a,t)=>{we.get(a)===t&&we.delete(a)},Rt=class extends Pe{constructor(){super(...arguments);this.narrow=!1;this._workspace=K();this.#e=new De;this.#t=new Tt(this._workspace);this.#n=null;this.#o=null;this.#l=null;this.#i=null;this.#r=null;this.#s=null}static{this.styles=[xe,Te,Ce`
:host { display: block; block-size: 100%; }
`]}static{this.properties={hass:{attribute:!1},narrow:{type:Boolean},route:{attribute:!1},panel:{attribute:!1},_workspace:{state:!0}}}#e;#t;#n;#o;#l;#i;#r;#s;#h(e=this.hass,s=this.panel){let n=this.#t.value.selection;return n.entrySource==="user"?this.#e.project(e,s,n.entryId):this.#e.project(e,s)}#v(){let e=this.hass,s=e?.loadBackendTranslation;if(!e||typeof s!="function")return;let n=e.connection??$n,o=e.language??"";we.get(n)!==o&&(we.set(n,o),Promise.resolve().then(()=>s.call(e,"common","matic_robot")).catch(()=>{if(we.get(n)===o){if(!this.isConnected){kt(n,o);return}this.#s&&clearTimeout(this.#s.timer),this.#s={owner:n,language:o,timer:setTimeout(()=>{this.#s=null,kt(n,o),this.#v()},On)}}}))}shouldUpdate(e){if(this.#v(),!e.has("hass")||[...e.keys()].some(n=>n!=="hass"))return!0;let s=e.get("hass");return s?.connection!==this.hass?.connection||s?.localize!==this.hass?.localize?!0:this.#h()!==this.#n}connectedCallback(){super.connectedCallback(),this.#v(),this.#o=this.#t.subscribe(e=>{if(this._workspace=e,e.selection.entryId!==this.#n?.entryKey){let s=this.#h();s!==this.#n&&(this.#n=s,this.#i?.sync(s))}}),this.#d()}disconnectedCallback(){this.#s&&(clearTimeout(this.#s.timer),kt(this.#s.owner,this.#s.language),this.#s=null),this.#o?.(),this.#o=null,this.#S(),super.disconnectedCallback()}#d(){if(!(!this.isConnected||this.#i)&&(this.#n=this.#h(),this.#l=new We(()=>this.hass),this.#i=new je(this.#t,this.#l,this.hass?.connection??null),this.#r=new Ye(this.#t),this.#r.start(),this.#n)){this.#i.sync(this.#n);let{host:e}=this.#n;e.connected&&e.administrator&&e.robotCount>0&&this.#i.refreshCatalog(this.#t.value.selection.floorId==="current")}}#S(){this.#r?.dispose(),this.#r=null,this.#i?.dispose(),this.#i=null,this.#l=null}willUpdate(e){if(e.has("hass")||e.has("panel")){let s=e.get("hass"),n=e.has("hass")&&s?.connection!==this.hass?.connection,o=this.#h(),r=o!==this.#n;r&&(this.#n=o),n?(this.#S(),this.#d()):(r||e.has("panel"))&&this.#i?.sync(o)}e.has("narrow")&&this.#t.value.narrowHint!==this.narrow&&this.#t.dispatch({type:"set-narrow-hint",value:this.narrow})}#_(e){if(!Se(e.detail))return;e.stopPropagation();let s=e.detail;if(s.type==="dismiss-top-layer"||s.type==="exit-full-map"){this.#r?.dismissTop()||this.#t.dispatch(s);return}if(s.type==="open-workflow"&&s.workflow!=="none"){this.#i?.openWorkflow(s.workflow);return}if(s.type==="set-floor"){this.#i?.selectFloor(s.floorId);return}if(s.type==="select-entry"){if(!this._workspace.robots.some(n=>n.entryId===s.entryId)||this.#e.project(this.hass,this.panel,s.entryId).entryKey!==s.entryId)return;this.#t.dispatch(s);return}if(s.type==="set-history"){this.#i?.selectHistory(s.historyId);return}if(s.type==="select-plan"){this.#i?.selectPlan(s.planId);return}if(s.type==="select-area"){this.#i?.selectArea(s.areaId),s.workflow==="areaReview"&&this.#i?.openWorkflow("areaReview");return}this.#t.dispatch(s)}#y(e){e.stopPropagation(),typeof e.detail?.id=="string"&&(e.detail.id==="reset-room-cadence"&&"planId"in e.detail&&"roomId"in e.detail&&"mode"in e.detail?this.#i?.executeAction(e.detail):this.#i?.executeAction(e.detail.id),this.dispatchEvent(new CustomEvent("matic-map-v4-action-requested",{detail:{id:e.detail.id},bubbles:!0,composed:!0})))}getWorkspaceSnapshot(){return this.#t.value}getRequestDiagnostics(){return Object.freeze({http:this.#l?.requestDiagnostics()??null,workspace:this.#i?.workspaceDiagnostics()??null})}render(){return b`
      <${Qs}
        .state=${this._workspace}
        .localize=${this.hass?.localize}
        .dates=${this.#n?.dates}
        @matic-workspace-intent=${this.#_}
        @matic-workspace-action=${this.#y}
      ></${Qs}>
    `}};customElements.get(et)||customElements.define(et,Rt);export{De as a,ae as b,b as c,Rt as d};
/*! Bundled license information:

lit-html/static.js:
  (**
   * @license
   * Copyright 2020 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/
