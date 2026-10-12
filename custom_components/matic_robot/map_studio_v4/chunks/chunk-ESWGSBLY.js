import{A as as,a as Ie,b as It,c as pe,d as me,e as et,f as $t,g as tt,h as Ot,i as Dt,j as ne,k as fe,l as oe,m as Lt,n as S,o as $e,p as qt,q as Wt,r as zt,s as Bt,t as Nt,u as Ht,v as Ft,w as os,x as rs,y as is,z as at}from"./chunk-KGPEUTE5.js";import{$ as Xt,A as Ze,Aa as Zt,B as Ce,Ba as V,C as Et,Ca as es,D as Mt,Da as ts,E as Ct,Ea as ss,F as Pt,Fa as ns,Ga as I,J as Pe,K as xt,L as Tt,M as At,O as R,Q as xe,R as Te,S as Ae,T as ve,U as Kt,V as Ut,W as Vt,X as ye,Y as Oe,Z as jt,_ as Yt,aa as De,ba as Gt,c as _t,ca as Qt,h as E,j as Ee,k as se,n as H,o as kt,p as Qe,q as Je,s as Rt,t as St,ua as Jt,v as Me,va as st,wa as nt,x as he,xa as ot,ya as rt,za as it}from"./chunk-IXCAOXMZ.js";var Ks=(a,t)=>{if(t?.recharge_and_resume===!0&&t?.charging===!0)return"recharging";switch(a){case"cleaning":return"cleaning";case"paused":return"paused";case"returning":return"returning";case"docked":return"docked";case"idle":return"idle";case"error":return"problem";default:return"unknown"}},Us=a=>typeof a!="number"||!Number.isFinite(a)?null:Math.round(Math.max(0,Math.min(100,a))),Vs=a=>{let t=a.attributes?.matic_entry_id;return typeof t=="string"&&t.length>0?t:null},js=a=>String(a||"local-user").replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",ls=a=>{if(typeof a!="string")return"Matic robot";let t=a.trim();return t&&Array.from(t).length<=128&&!/[\u0000-\u001f\u007f]/u.test(t)?t:"Matic robot"},Le=class{#e="";#t=null;project(t,e,s=null){let n=t?.states??{},o=e?.config?.entry_id,r=s||(typeof o=="string"?o:null),l=null,c=null,d=r,u=new Map;for(let[C,$]of Object.entries(n)){let q=Vs($);q&&C.startsWith("vacuum.")&&(u.set(q,{entryId:q,label:ls($.attributes?.friendly_name)}),(r?q===r:!l)&&(l=$,c=C,d=q))}let m={connected:t?.connected!==!1,administrator:t?.user?.is_admin===!0,robotConnected:l!==null&&l.state!=="unavailable"&&l.state!=="unknown",robotCount:u.size},h=l?Ks(l.state,l.attributes):"unknown",f=Us(l?.attributes?.battery_level),w=t?.selectedLanguage||t?.language||"en",y=t?.locale?.language||w,_=t?.locale?.time_zone==="server"?t.config?.time_zone:void 0,M=js(t?.user?.id),k=ls(l?.attributes?.friendly_name),v=[...u.values()].sort((C,$)=>C.label.localeCompare($.label,w,{sensitivity:"base"})),g=[m.connected,m.administrator,m.robotConnected,m.robotCount,h,f??"none",w,y,_??"browser",M,c??"none",d??"none",k,v.map(C=>`${C.entryId}:${C.label}`).join(",")].join("|");return g===this.#e&&this.#t?this.#t:(this.#e=g,this.#t={host:m,activity:h,batteryPercent:f,language:w,dateLanguage:y,timeZone:_,userKey:M,vacuumEntityId:c,entryKey:d,robotLabel:k,robots:v},this.#t)}};var ds=Symbol.for(""),Ys=a=>{if(a?.r===ds)return a?._$litStatic$},re=a=>({_$litStatic$:a,r:ds});var cs=new Map,lt=a=>(t,...e)=>{let s=e.length,n,o,i=[],r=[],l,c=0,d=!1;for(;c<s;){for(l=t[c];c<s&&(o=e[c],(n=Ys(o))!==void 0);)l+=n+t[++c],d=!0;c!==s&&r.push(o),i.push(l),c++}if(c===s&&i.push(t[s]),d){let u=i.join("$$lit$$");(t=cs.get(u))===void 0&&(i.raw=i,cs.set(u,t=i)),e=r}return a(t,...e)},b=lt(xt),xn=lt(Tt),Tn=lt(At);var Xs=1024*1024,us=a=>{let t=s=>{let n=a.sceneHeaderBytes,o=a.scenePointStride,i=a.sceneMaxPoints,r=a.sceneMaxBytes,l=()=>{throw new Error("invalid-scene")};(!(s instanceof ArrayBuffer)||s.byteLength<n||s.byteLength>r)&&l();let c=new DataView(s),d=new Uint8Array(s,0,8),u=String.fromCharCode(...d),m=c.getUint16(8,!0),h=c.getUint16(10,!0),f=c.getUint32(12,!0),w=c.getUint32(16,!0),y=c.getUint32(20,!0),_=w+y,M=n+f;(u!=="MATIC3D\0"||m!==1||h!==o||f>1048576||_<1||_>i||M+_*h!==s.byteLength)&&l();let k;try{k=JSON.parse(new TextDecoder("utf-8",{fatal:!0}).decode(new Uint8Array(s,n,f)))}catch{l()}(!k||typeof k!="object"||Array.isArray(k))&&l();let v=k,g=v.meters_per_cell,C=v.origin_cells,$=v.span_cells;(typeof g!="number"||!Number.isFinite(g)||g<.001||g>.1||!Array.isArray(C)||C.length!==2||!C.every(O=>typeof O=="number"&&Number.isFinite(O))||!Array.isArray($)||$.length!==2||!$.every(O=>typeof O=="number"&&Number.isFinite(O)&&O>=1&&O<=65536))&&l();let K=(Array.isArray(v.rooms)?v.rooms.slice(0,128):[]).flatMap((O,Re)=>{if(!O||typeof O!="object"||Array.isArray(O))return[];let z=O,X=typeof z.name=="string"?z.name.trim():"";if(!X||Array.from(X).length>128||/[\u0000-\u001f\u007f]/u.test(X))return[];if(!Array.isArray(z.boundary)||z.boundary.length<3||z.boundary.length>8192)return[];let Se=z.boundary.flatMap(U=>{if(!Array.isArray(U)||U.length!==2)return[];let[G,te]=U;return typeof G=="number"&&Number.isFinite(G)&&typeof te=="number"&&Number.isFinite(te)?[[G,te]]:[]}),J=z.center;if(Se.length<3||!Array.isArray(J)||J.length!==2)return[];let[Z,ee]=J;return typeof Z!="number"||!Number.isFinite(Z)||typeof ee!="number"||!Number.isFinite(ee)?[]:[{id:`scene-room-${Re+1}`,name:X,boundary:Se,center:[Z,ee]}]}),de=typeof v.sample_step=="number"&&Number.isInteger(v.sample_step)?Math.max(1,Math.min(i,v.sample_step)):1,ue=C,ke=$;return{buffer:s,pointOffset:M,floorCount:w,surfaceCount:y,total:_,metadata:{metersPerCell:g,origin:[ue[0],ue[1]],span:[ke[0],ke[1]],sampleStep:de,rooms:K}}};return{parseTransfer:t,decodeDeltaTransfer:async(s,n,o)=>{let i=(A="invalid-scene-delta")=>{throw new Error(A)},r=()=>{if(o?.aborted)throw new DOMException("Aborted","AbortError")};(!(s instanceof ArrayBuffer)||s.byteLength<a.deltaHeaderBytes||s.byteLength>a.deltaHeaderBytes+a.deltaMaxBytes||!(n.buffer instanceof ArrayBuffer)||n.buffer.byteLength<a.sceneHeaderBytes||n.buffer.byteLength>a.deltaMaxBytes||!Number.isSafeInteger(n.revision)||n.revision<0)&&i("invalid-scene-delta-size");let l=new DataView(s),c=String.fromCharCode(...new Uint8Array(s,0,8)),d=l.getUint16(8,!0),u=l.getUint16(10,!0),m=l.getBigUint64(12,!0),h=l.getBigUint64(20,!0),f=l.getUint32(28,!0),w=l.getUint32(32,!0),y=Number(m),_=Number(h);(c!=="MATICDLT"||d!==1||u!==1||!Number.isSafeInteger(y)||!Number.isSafeInteger(_)||y!==n.revision||_<=n.revision||f<a.sceneHeaderBytes||f>a.deltaMaxBytes||w<1||w>a.deltaMaxBytes||w+a.deltaHeaderBytes!==s.byteLength)&&i(),typeof DecompressionStream!="function"&&i("scene-delta-decompression-unavailable"),r();let M=new Uint8Array(s,a.deltaHeaderBytes,w),k=Math.max(n.buffer.byteLength,f);k>a.deltaMaxBytes&&i("invalid-scene-delta-size");let v=new Uint8Array(k),C=new Blob([M]).stream().pipeThrough(new DecompressionStream("deflate")).getReader(),$=0,q=null;try{for(q=()=>{C.cancel().catch(()=>{})},o?.addEventListener("abort",q,{once:!0});;){r();let{done:A,value:Q}=await C.read();if(A)break;(!(Q instanceof Uint8Array)||$+Q.byteLength>k)&&i(),v.set(Q,$),$+=Q.byteLength}}catch(A){if(await C.cancel().catch(()=>{}),o?.aborted||A instanceof DOMException&&A.name==="AbortError")throw new DOMException("Aborted","AbortError");if(A instanceof Error&&A.message==="invalid-scene-delta")throw A;i()}finally{q&&o?.removeEventListener("abort",q),C.releaseLock()}r(),$!==k&&i();let K=new Uint8Array(n.buffer),de=new DataView(v.buffer,v.byteOffset,v.byteLength),ue=Math.min(a.sceneHeaderBytes,K.byteLength);for(let A=0;A<ue;A+=1)v[A]=(v[A]??0)^(K[A]??0);let ke=de.getUint32(12,!0),O=de.getUint32(16,!0),Re=de.getUint32(20,!0),z=a.sceneHeaderBytes+ke,X=O+Re,Se=z===n.pointOffset&&O===n.floorCount&&Re===n.surfaceCount,J=z+X*a.scenePointStride,Z=Se&&J===f&&X<=a.sceneMaxPoints,ee=[],U=-1,G=!1,te=()=>{G&&U>=0&&ee.push(U),G=!1};for(let A=ue;A<K.byteLength;A+=a.xorChunkBytes){r();let Q=Math.min(K.byteLength,A+a.xorChunkBytes);for(let B=A;B<Q;B+=1){let gt=K[B]??0,bt=(v[B]??0)^gt;if(v[B]=bt,!Z||B<n.pointOffset||B>=J)continue;let wt=Math.floor((B-n.pointOffset)/a.dirtyBlockBytes);wt!==U&&(te(),U=wt),bt!==gt&&(G=!0)}Q<K.byteLength&&await new Promise(B=>globalThis.setTimeout(B,0))}te(),r();let Fs=f===v.byteLength?v.buffer:v.slice(0,f).buffer;return{parsed:t(Fs),revision:_,...Z?{deltaHint:{baseRevision:y,blockBytes:a.dirtyBlockBytes,dirtyBlocks:ee}}:{}}}}},hs=Object.freeze({deltaHeaderBytes:fe,deltaMaxBytes:oe,sceneHeaderBytes:tt,sceneMaxBytes:ne,sceneMaxPoints:Dt,scenePointStride:Ot,dirtyBlockBytes:Lt,xorChunkBytes:Xs}),ps=us(hs),Gs=a=>{try{return ps.parseTransfer(a)}catch{throw new S("invalid-scene")}},Qs=()=>`
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
`,qe=class{#e=null;#t=null;#n=!1;#r=!1;#l=0;#i=null;#o=null;#s=null;constructor(){if(!(typeof Worker!="function"||typeof URL?.createObjectURL!="function"))try{this.#t=URL.createObjectURL(new Blob([Qs()],{type:"text/javascript"})),this.#f()}catch{this.#e=null,this.#t&&URL.revokeObjectURL(this.#t),this.#t=null}}async parse(t,e){if(this.#u(e),t.byteLength>ne||t.byteLength<tt)throw new S("invalid-scene");let s=await this.#d({kind:"parse",buffer:t},e,async n=>(await new Promise(o=>globalThis.setTimeout(o,0)),this.#u(n),{id:0,ok:!0,parsed:Gs(t)}));if(!s.parsed)throw new S("invalid-scene");return s.parsed}async decodeDelta(t,e,s){if(this.#u(s),t.byteLength>fe+oe||e.buffer.byteLength>oe)throw new S("invalid-scene-delta-size");let n={buffer:e.buffer,revision:e.revision,pointOffset:e.pointOffset,floorCount:e.floorCount,surfaceCount:e.surfaceCount},o;try{o=await this.#d({kind:"delta",payload:t},s,async i=>(await new Promise(r=>globalThis.setTimeout(r,0)),this.#u(i),ps.decodeDeltaTransfer(t,n,i).then(r=>({id:0,ok:!0,...r}))),n)}catch(i){throw i instanceof S?i:s?.aborted||i instanceof DOMException&&i.name==="AbortError"?new DOMException("Aborted","AbortError"):i instanceof Error&&(i.message.startsWith("invalid-scene")||i.message==="scene-delta-decompression-unavailable")?new S(i.message):new S("invalid-scene-delta")}if(!o.parsed||o.revision===void 0)throw new S("invalid-scene-delta");return{parsed:o.parsed,revision:o.revision,...o.deltaHint?{deltaHint:o.deltaHint}:{}}}#u(t){if(this.#r)throw new S("scene-parser-disposed");if(t?.aborted)throw new DOMException("Aborted","AbortError")}#f(){if(!(!this.#t||this.#n||this.#r))try{let t=new Worker(this.#t);t.onmessage=e=>{let s=this.#i;this.#e!==t||!s||s.worker!==t||e.data.id!==s.id||(e.data.ok?this.#g(s,e.data):this.#g(s,void 0,new S(e.data.problem||"invalid-scene")))},t.onerror=()=>this.#c(t),t.onmessageerror=()=>this.#c(t),this.#e=t}catch{this.#e=null,this.#n=!0}}async#d(t,e,s,n){return this.#u(e),new Promise((o,i)=>{let r,l=()=>e?.removeEventListener("abort",r.abort),c=(d,u)=>{r.settled||(r.settled=!0,l(),u!==void 0?i(u):d?o(d):i(new S("invalid-scene")))};r={id:++this.#l,message:t,...e?{signal:e}:{},fallback:s,...n?{base:n}:{},settle:c,abort:()=>this.#b(r),settled:!1,worker:null},e?.addEventListener("abort",r.abort,{once:!0}),e?.aborted||this.#r?c(void 0,e?.aborted?new DOMException("Aborted","AbortError"):new S("scene-parser-disposed")):this.#i?this.#o?c(void 0,new S("scene-parser-busy")):this.#o=r:(this.#i=r,this.#v(r))})}#v(t){if(this.#i!==t)return;if(this.#r){this.#g(t,void 0,new S("scene-parser-disposed"));return}if(t.signal?.aborted){this.#g(t,void 0,new DOMException("Aborted","AbortError"));return}!this.#e&&!this.#n&&this.#f();let e=this.#e;if(e){t.worker=e;try{let n,o;if(t.message.kind==="parse")n={id:t.id,kind:t.message.kind,buffer:t.message.buffer},o=[t.message.buffer];else{if(!t.base)throw new S("invalid-scene-delta");let i={...t.base,buffer:t.base.buffer.slice(0)};n={id:t.id,kind:t.message.kind,payload:t.message.payload,base:i},o=[t.message.payload,i.buffer]}e.postMessage(n,o)}catch{this.#c(e)}return}let s=new AbortController;this.#s=s,Promise.resolve().then(()=>t.fallback(s.signal)).then(n=>this.#g(t,n),n=>this.#g(t,void 0,n))}#b(t){let e=new DOMException("Aborted","AbortError");if(this.#o===t){this.#o=null,t.settle(void 0,e);return}this.#i===t&&(t.worker?(this.#y(),this.#g(t,void 0,e)):this.#s?.abort())}#g(t,e,s){if(this.#i!==t){t.settle(void 0,new S("scene-parser-disposed"));return}let n=t.signal?.aborted?new DOMException("Aborted","AbortError"):s;t.settle(e,n),this.#i=null,this.#s=null,t.worker=null,this.#r||this.#m()}#m(){if(this.#r||this.#i||!this.#o)return;let t=this.#o;if(this.#o=null,t.signal?.aborted){t.settle(void 0,new DOMException("Aborted","AbortError")),this.#m();return}this.#i=t,this.#v(t)}#c(t){if(this.#e!==t)return;this.#n=!0,this.#y();let e=this.#i;e?.worker===t?this.#g(e,void 0,new S("scene-worker-failed")):this.#m()}#y(){this.#e?.terminate(),this.#e=null}dispose(){if(this.#r)return;this.#r=!0;let t=this.#o;this.#o=null,t?.settle(void 0,new S("scene-parser-disposed"));let e=this.#i;this.#y(),this.#s?.abort(),this.#s=null,e&&(e.worker=null,e.settle(void 0,new S("scene-parser-disposed"))),this.#i=null,this.#t&&URL.revokeObjectURL(this.#t),this.#t=null}};var ct=["catalog","scene","sceneDelta","pose","history","plans","areas","areaSave","areaDelete"];var dt=()=>({requests:0,completed:0,failed:0,aborted:0,timedOut:0,totalDurationMs:0,maxDurationMs:0}),ms=a=>Math.min(1e9,a+1),fs=a=>Number.isFinite(a)?Math.min(1e12,Math.max(0,a)):0,ie=class{#e=dt();#t=!1;record(t,e){if(this.#t)return;let s=Math.round(fs(e)*100)/100;this.#e.requests=ms(this.#e.requests),this.#e[t]=ms(this.#e[t]),this.#e.totalDurationMs=fs(this.#e.totalDurationMs+s),this.#e.maxDurationMs=Math.max(this.#e.maxDurationMs,s)}snapshot(){return Object.freeze({...this.#e})}reset(){this.#t||Object.assign(this.#e,dt())}dispose(){this.#t=!0,Object.assign(this.#e,dt())}},We=class{#e=Object.fromEntries(ct.map(t=>[t,new ie]));#t=!1;record(t,e,s){this.#t||this.#e[t].record(e,s)}snapshot(){let t=Object.fromEntries(ct.map(e=>[e,this.#e[e].snapshot()]));return Object.freeze(t)}dispose(){if(!this.#t){this.#t=!0;for(let t of ct)this.#e[t].dispose()}}};var W={catalog:1e4,scene:6e4,delta:35e3,pose:1e4,history:15e3,workflow:15e3,mutation:2e4,roomPreview:15e3},Js=2,ge=new WeakMap,vs={coverage_identity_unavailable:"Could not verify the current cleaning task. Check the robot status, then try again.",coverage_activity_unavailable:"Could not verify whether the robot is cleaning. Check the robot status, then try again.",coverage_native_session_active:"The robot already has a cleaning task. Wait for it to finish before starting another cleaning task.",coverage_identity_changed:"The cleaning task changed during setup. Check the robot status, then try again."},Zs=(a,t)=>{if(!a||typeof a!="object")return null;let e=a;if(e.translation_domain!=="matic_robot"||typeof e.translation_key!="string"||!Object.hasOwn(vs,e.translation_key))return null;let s=e.translation_key,n=vs[s];try{let o=t?.(`component.matic_robot.exceptions.${s}.message`);o&&o!==`component.matic_robot.exceptions.${s}.message`&&(n=o)}catch{}return new x(s,null,n)},x=class extends Error{constructor(t,e=null,s=null){super(s??t),this.name="BackendError",this.code=t,this.status=e,this.recoveryMessage=s}},ys=(a,t)=>{let e=a.headers.get("X-Matic-Revision");if(e===null)return t;let s=Number(e);if(!Number.isSafeInteger(s)||s<0)throw new S("invalid-scene-revision");return s},gs=(a,t)=>{let e=a.headers.get("X-Matic-Floor-Coherent");if(e===null)return t;if(e==="1")return!0;if(e==="0")return!1;throw new S("invalid-scene-floor-header")},ze=class{#e;#t=new qe;#n=new WeakMap;#r=new Set;#l=new We;#i=!1;constructor(t){this.#e=t}requestDiagnostics(){return this.#l.snapshot()}async#o(t,e,s=Number.POSITIVE_INFINITY,n="invalid-response-size"){let o=t.body?.getReader();if(!o)return new ArrayBuffer(0);let i=()=>{o.cancel().catch(()=>{})};e.addEventListener("abort",i,{once:!0});try{if(e.aborted)throw i(),new DOMException("Aborted","AbortError");let r=[],l=0;for(;;){let u=await o.read();if(e.aborted)throw new DOMException("Aborted","AbortError");if(u.done)break;if(l+u.value.byteLength>s)throw o.cancel().catch(()=>{}),new S(n);r.push(u.value),l+=u.value.byteLength}let c=new Uint8Array(l),d=0;for(let u of r)c.set(u,d),d+=u.byteLength;return c.buffer}finally{e.removeEventListener("abort",i),o.releaseLock()}}async#s(t,e,s,n,o,i){if(!Ft(e))throw new x("invalid-private-path");if(o?.aborted)throw new DOMException("Aborted","AbortError");let r=performance.now(),l="failed",c=new AbortController,d=()=>{},u=new Promise((w,y)=>{d=y}),m=()=>{c.abort(),d(new DOMException("Aborted","AbortError"))};o?.addEventListener("abort",m,{once:!0});let h=!1,f=window.setTimeout(()=>{h=!0,m()},n);try{let w=this.#e(),y=new Headers(s.headers),_={...s,cache:"no-store",credentials:"same-origin",headers:Object.fromEntries(y.entries()),signal:c.signal},M=async()=>{let v;if(typeof w?.fetchWithAuth=="function")v=await w.fetchWithAuth(e,_);else{let g=w?.auth?.accessToken||w?.auth?.data?.access_token;g&&y.set("Authorization",`Bearer ${g}`);let C=typeof w?.hassUrl=="function"?w.hassUrl(e):e;v=await fetch(C,{..._,headers:y})}try{if(c.signal.aborted)throw new DOMException("Aborted","AbortError");return await i(v,c.signal)}finally{v.body&&!v.body.locked&&v.body.cancel().catch(()=>{})}},k=await Promise.race([M(),u]);return l="completed",k}catch(w){throw h&&!o?.aborted?(l="timedOut",new x("request-timeout")):c.signal.aborted?(l="aborted",new DOMException("Aborted","AbortError")):w}finally{window.clearTimeout(f),o?.removeEventListener("abort",m),this.#l.record(t,l,performance.now()-r)}}async#u(t,e,s,n,o={}){return this.#s(t,e,{...o,headers:{Accept:"application/json",...o.headers||{}}},s,n,async(i,r)=>{if(!i.ok){let l=i.headers.get("X-Matic-Plans-Conflict");throw new x(l==="map-rechecking"?"map-rechecking":"request-failed",i.status)}try{return JSON.parse(new TextDecoder().decode(await this.#o(i,r)))}catch{throw new S("invalid-json-response")}})}async catalog(t){return $e(await this.#u("catalog",$t,W.catalog,t))}async scene(t,e,s,n,o,i){let r=new Headers({Accept:"application/vnd.matic.slam-scene"});return n==="live"&&r.set("X-Matic-Prefer-Cached","1"),i&&r.set("If-None-Match",i),this.#s("scene",t,{headers:r},W.scene,o,async(l,c)=>{let d=ys(l,e),u=gs(l,s);if(l.status===304)return{scene:null,floorCoherent:u,revision:d,notModified:!0};if(!l.ok)throw new x("scene-request-failed",l.status);if(l.headers.get("Content-Type")?.split(";",1)[0]!=="application/vnd.matic.slam-scene")throw new S("invalid-scene-content-type");return{scene:{...await this.#t.parse(await this.#o(l,c,ne,"invalid-scene-size"),c),revision:d,etag:l.headers.get("ETag"),source:n},floorCoherent:u,revision:d,notModified:!1}})}async sceneDelta(t,e,s,n){let o=t.includes("?")?"&":"?";return this.#s("sceneDelta",`${t}${o}since=${encodeURIComponent(e.revision)}`,{headers:{Accept:"application/vnd.matic.slam-delta, application/vnd.matic.slam-scene"}},W.delta,n,async(i,r)=>{let l=ys(i,e.revision),c=gs(i,s);if(i.status===204){if(l!==e.revision)throw new S("invalid-scene-delta-revision");return{scene:null,floorCoherent:c,revision:l,notModified:!0}}if(!i.ok)throw new x("delta-request-failed",i.status);if(l<=e.revision)throw new S("invalid-scene-delta-revision");let d=i.headers.get("Content-Type")?.split(";",1)[0];if(d!=="application/vnd.matic.slam-delta"&&d!=="application/vnd.matic.slam-scene")throw new S("invalid-scene-delta-content-type");let u=d==="application/vnd.matic.slam-delta",m=u?fe+oe:ne,h=Number(i.headers.get("Content-Length"));if(Number.isFinite(h)&&h>m)throw new S(u?"invalid-scene-delta-size":"invalid-scene-size");let f=await this.#o(i,r,m,u?"invalid-scene-delta-size":"invalid-scene-size");if(u){let y=Number(i.headers.get("X-Matic-Base-Revision"));if(!Number.isSafeInteger(y)||y!==e.revision)throw new S("invalid-scene-delta-base");let _=await this.#t.decodeDelta(f,e,r);if(_.revision!==l)throw new S("invalid-scene-delta-revision");return{scene:{..._.parsed,revision:l,etag:i.headers.get("ETag"),source:"live",..._.deltaHint?{deltaHint:_.deltaHint}:{}},floorCoherent:c,revision:l,notModified:!1}}return{scene:{...await this.#t.parse(f,r),revision:l,etag:i.headers.get("ETag"),source:"live"},floorCoherent:c,revision:l,notModified:!1}})}async pose(t,e){return Ht(await this.#u("pose",t,W.pose,e))}async history(t,e){return qt(await this.#u("history",t,W.history,e))}async plans(t,e){return Nt(await this.#u("plans",t,W.workflow,e))}async areas(t,e){return zt(await this.#u("areas",t,W.workflow,e))}async previewRoomSequence(t,e,s,n){if(!t||t.length>255||e.length<1||e.length>100)throw new S("invalid-room-sequence-preview-request");if(n?.aborted)throw new DOMException("Aborted","AbortError");let o=this.#e()?.connection;if(!o?.sendMessagePromise)throw new x("preview-unavailable");let i=null,r=()=>{},l=new Promise((_,M)=>{r=M}),c=this.#n.get(o),d,u=new Promise(_=>{d=_});this.#n.set(o,u);let m=!1,h=()=>{m||(m=!0,d(),this.#n.get(o)===u&&this.#n.delete(o))},f=!1,w=()=>{r(new DOMException("Aborted","AbortError")),f&&(h(),i!==null&&window.clearTimeout(i),i=null)};n?.addEventListener("abort",w,{once:!0});let y=new Promise((_,M)=>{i=window.setTimeout(()=>{i=null,M(new x("preview-timeout"))},W.roomPreview)});y.catch(()=>{f&&h()});try{if(c&&(await Promise.race([c,l,y]),n?.aborted))throw new DOMException("Aborted","AbortError");let _=ge.get(o)??0;if(_>=Js)throw new x("preview-unavailable");let M=o.sendMessagePromise({type:"call_service",domain:"matic_robot",service:"preview_room_sequence",target:{entity_id:t},service_data:{rooms:e.map(C=>({room:C.room,cleaning_mode:C.cleaning_mode,coverage_setting:C.coverage_setting})),use_room_schedule:!0,override_room_schedule:s},return_response:!0});ge.set(o,_+1),f=!0;let k=!1,v=()=>{if(!k){k=!0;let C=(ge.get(o)??1)-1;C===0?ge.delete(o):ge.set(o,C)}h(),i!==null&&window.clearTimeout(i),i=null};M.then(v,v);let g=await Promise.race([M,l,y]);if(n?.aborted)throw new DOMException("Aborted","AbortError");if(!g||typeof g!="object"||Array.isArray(g)||!("response"in g))throw new S("invalid-room-sequence-preview-envelope");return Wt(g.response)}finally{f||(c?c.then(h,h):h(),i!==null&&window.clearTimeout(i),i=null),n?.removeEventListener("abort",w)}}async saveArea(t,e,s){let n=await this.#u("areaSave",t,W.mutation,s,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...e.areaId?{area_id:e.areaId}:{},name:e.name,circles:e.circles,...e.outline?.closed?{outline:e.outline.points}:{},cleaning_mode:e.cleaningMode,coverage_setting:e.coverageSetting})});if(!n||typeof n!="object"||typeof n.id!="string")throw new S("invalid-area-save-response");return n.id}async deleteArea(t,e,s){await this.#s("areaDelete",`${t}?area_id=${encodeURIComponent(e)}`,{method:"DELETE",headers:{Accept:"application/json"}},W.mutation,s,async n=>{if(!n.ok)throw new x("area-delete-failed",n.status)})}async service(t,e,s,n,o={}){let i=this.#e();if(this.#i||typeof i?.callService!="function")throw new x("service-unavailable");let r=null,l=null;try{let c=o.returnResponse?i.callService(t,e,s,{entity_id:n},!0,!0):i.callService(t,e,s,{entity_id:n});return!o.returnResponse&&!o.acknowledgementTimeout?await c:await Promise.race([c,new Promise((d,u)=>{l=()=>{r!==null&&window.clearTimeout(r),r=null,u(new DOMException("Aborted","AbortError"))},this.#r.add(l),r=window.setTimeout(()=>u(new x("mutation-timeout")),W.mutation)})])}catch(c){throw Zs(c,i.localize)??c}finally{r!==null&&window.clearTimeout(r),l&&this.#r.delete(l)}}dispose(){if(!this.#i){this.#i=!0,this.#l.dispose();for(let t of this.#r)t();this.#r.clear(),this.#t.dispose()}}};var ws=()=>({version:4,view:"top",appearance:"photo",labels:!0,quality:"auto",cameras:{}}),be=(a,t,e)=>Math.max(t,Math.min(e,a)),_s=a=>a.replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",ut=(a,t=4)=>`matic-map-studio:v${t}:${_s(a)}`,en=a=>{if(!a||typeof a!="object")return null;let t=a;return["yaw","pitch","zoom","targetX","targetZ"].every(s=>typeof t[s]=="number"&&Number.isFinite(t[s]))?{yaw:be(t.yaw,-Math.PI,Math.PI),pitch:be(t.pitch,.18,Math.PI/2-.018),zoom:be(t.zoom,.01,100),targetX:be(t.targetX,-1e4,1e4),targetZ:be(t.targetZ,-1e4,1e4)}:null},bs=a=>{let t=ws();if(!a||typeof a!="object")return t;let e=a,s=e.view==="three"||e.view==="top"||e.view==="rooms"?e.view:t.view,n=s==="rooms"?"top":s,o=e.quality==="auto"||e.quality==="efficient"||e.quality==="balanced"||e.quality==="maximum"?e.quality:t.quality,i=e.cameras&&typeof e.cameras=="object"?e.cameras:{},r={};for(let l of["three","top"]){let c=en(i[l]);c&&(r[l]=c)}return{version:4,view:n,appearance:e.appearance==="rooms"||e.appearance==="photo"?e.appearance:t.appearance,labels:typeof e.labels=="boolean"?e.labels:t.labels,quality:o,cameras:r}},Be=class{#e="local-user";#t=null;#n=null;load(t){this.#r(),this.#e=_s(t);try{let e=window.localStorage.getItem(ut(this.#e));if(e)return bs(JSON.parse(e));for(let s of[3,2]){let n=window.localStorage.getItem(ut(this.#e,s));if(n)return bs(JSON.parse(n))}}catch{}return ws()}schedule(t){this.#t!==null&&window.clearTimeout(this.#t),this.#n={key:ut(this.#e),value:t},this.#t=window.setTimeout(()=>this.#r(),250)}#r(){this.#t!==null&&window.clearTimeout(this.#t),this.#t=null;let t=this.#n;if(this.#n=null,!!t)try{window.localStorage.setItem(t.key,JSON.stringify(t.value))}catch{}}dispose(){this.#r()}};var pt=1,ae=Number.MAX_SAFE_INTEGER,Ms=Number.MAX_SAFE_INTEGER,ks=64,tn=1e12,ht=4,Rs=16*1024,sn=250,nn=4e3,Ne=3e4;function D(a){return a!==null&&typeof a=="object"&&!Array.isArray(a)?a:null}function j(a,t){return typeof a=="number"&&Number.isSafeInteger(a)&&a>=0&&a<=t}function Cs(a){let t=D(a);if(!t)return null;let e={};for(let[s,n]of Object.entries(t)){if(s.length===0||s.length>128||!j(n,Ms))return null;e[s]=n}return e}function on(a){let t=D(a);if(!t||Object.keys(t).length>128)return null;let e={};for(let[s,n]of Object.entries(t)){if(s.length===0||s.length>128||!j(n,Ms))return null;e[s]=n}return e}function Ps(a){return typeof a=="string"&&a.length>0&&a.length<=256?a:j(a,ae)?String(a):null}function rn(a){let t=D(a),e=Ps(t?.epoch);if(!t||t.schema!==pt||e===null)return null;let s=on(t.capabilities),n=Cs(t.revisions);return!s||!n||!j(t.sequence,ae)||!j(t.coherence_generation,ae)||t.coherence_generation===0?null:{schema:t.schema,capabilities:s,epoch:e,sequence:t.sequence,coherence_generation:t.coherence_generation,revisions:n}}function Ss(a,t){let e=D(a),s=rn(e?.snapshot??a);if(!s)return null;let n=D(e?.snapshot??a);if(!n||!("payload"in n))return null;let o=n.entry_id,i=D(n.identity),r=D(n.status),l=D(n.payload),c=r?r.reason===null?null:xs(r.reason):null,d=l?.available,u=null;if(l?.entry!==void 0&&l.entry!==null){if((()=>{try{return JSON.stringify(l.entry).length}catch{return Rs+1}})()>Rs)return null;try{u=$e({entries:[l.entry]})[0]??null}catch{return null}}let m=r?.state;return typeof o!="string"||o.length===0||o.length>128||t!==void 0&&o!==t||!i||i.entry_id!==o||i.floor_mission_id!==null&&!j(i.floor_mission_id,ae)||typeof i.floor_verified!="boolean"||i.floor_verified!==(i.floor_mission_id!==null)||!r||m!=="ready"&&m!=="stale"&&m!=="unavailable"||r.reason!==null&&c===null||typeof r.retryable!="boolean"||typeof d!="boolean"||u!==null&&u.entryId!==o||m==="ready"&&(c!==null||r.retryable||!d)||(m==="stale"||m==="unavailable")&&(c===null||d)||c==="authorization"&&r.retryable?null:{...s,entry_id:o,identity:{entry_id:o,floor_mission_id:i.floor_mission_id,floor_verified:i.floor_verified},status:{state:m,reason:c,retryable:r.retryable},payload:{available:d,entry:u}}}function Es(a){let t=D(a),e=Ps(t?.epoch),s=Cs(t?.revisions),n=t?.resources;return e===null||!s||!j(t?.sequence,ae)||!j(t?.coherence_generation,ae)||t.coherence_generation===0||!Array.isArray(n)||n.length>128||!n.every(o=>typeof o=="string"&&o.length<=128)?null:{epoch:e,sequence:t.sequence,coherence_generation:t.coherence_generation,revisions:s,resources:n}}var He=["gap","overflow","reconnect","invalid_message","server_request","restart","entry_removed","authorization","snapshot_required"];function xs(a){return typeof a=="string"&&He.includes(a)?a:null}function an(a){let t=D(a);return t?.name==="AbortError"?"aborted":t?.name==="TimeoutError"?"timedOut":"failed"}function ln(){return Object.fromEntries(He.map(a=>[a,new ie]))}var Fe=class{#e;#t;#n;#r=null;#l=!1;#i=!1;#o=!1;#s=!1;#u=!1;#f=!1;#d=0;#v=!1;#b=!1;#g=!1;#m=!1;#c=null;#y=null;#M=0;#q=!1;#R=null;#S=-1;#h=new Map;#x=!1;#N=!1;#H=null;#a=[];#W=new ie;#_=ln();#T=null;#w=null;#$=null;constructor(t,e){this.#e=t,this.#t=e,this.#n=Math.max(1,Math.min(ks,e.maxPendingInvalidations??ks))}async start(){if(!(this.#l||this.#N)){this.#N=!0;try{await this.#A(!1)}catch(t){this.#J(t),this.#k("reconnect")}}}notifyReconnect(){(this.#s||this.#f)&&(this.#K(),this.#te("aborted"),this.#d+=1),this.#M=0,this.#v=!1,this.#s=!1,this.#u=!1,this.#c!==null&&window.clearTimeout(this.#c),this.#c=null,this.requestResync("reconnect"),this.#o&&this.#D(0,!0)}requestResync(t="server_request"){this.#k(t,!0)}diagnostics(){let t=Object.fromEntries(He.map(s=>[s,this.#_[s].snapshot()])),e=this.#w!==null&&this.#$!==null?Object.freeze({reason:this.#w,durationMs:Math.round(Math.min(tn,Math.max(0,performance.now()-this.#$))*100)/100}):null;return Object.freeze({snapshotAttempts:this.#W.snapshot(),recoveryEpisodes:Object.freeze(t),activeRecovery:e})}dispose(){if(!this.#l){this.#l=!0,this.#c!==null&&window.clearTimeout(this.#c),this.#c=null,this.#o=!1,this.#r?.(),this.#r=null,this.#h.clear(),this.#a=[],this.#T=null,this.#w=null,this.#$=null,this.#W.dispose();for(let t of He)this.#_[t].dispose()}}#O(t){if(this.#l)return;let e=D(t),s=D(e?.event)??e,n=s?.type;if(n==="resync"){let i=xs(s?.reason);if(!i){this.#k("invalid_message");return}if(i==="entry_removed"){this.#t.onEvent({type:"resync",reason:i}),this.dispose();return}this.#k(i);return}if(this.#s){if(n==="invalidate"){let i=Es(s?.invalidation??s);i?this.#C(i):(this.#a=[],this.#q=!0)}return}let o=n==="snapshot"?Ss(s?.snapshot??s,this.#t.entryId):n==="invalidate"?Es(s?.invalidation??s):null;if(!o){this.#k("invalid_message");return}if(n==="snapshot"){let i=o;if(this.#o)return;if(this.#R!==null&&i.epoch!==this.#R){this.#k("restart");return}this.#Y(i);return}this.#Q(o)}#Y(t){this.#R===t.epoch&&t.sequence<this.#S||(this.#R=t.epoch,this.#S=t.sequence,this.#h.clear(),this.#t.onEvent({type:"snapshot",snapshot:t}))}#p(t){let e=this.#a;if(this.#a=[],this.#Y(t),this.#l)return;let s=t.sequence+1;for(let n of e)if(n.epoch===t.epoch&&!(n.sequence<=t.sequence)&&!(n.sequence<s)){if(n.sequence!==s){this.#a=e.filter(o=>o.epoch===t.epoch&&o.sequence>=s),this.#k("gap");return}this.#Q(n),s+=1}}#Q(t){if(this.#o){this.#C(t);return}if(this.#R===null){this.#C(t);return}if(this.#R!==t.epoch){this.#C(t),this.#k("reconnect");return}if(!(t.sequence<=this.#S)){if(t.sequence!==this.#S+1){this.#C(t),this.#k("gap");return}this.#S=t.sequence;for(let e of t.resources)this.#h.set(e,t);if(this.#h.size>this.#n){this.#h.clear(),this.#k("overflow");return}this.#x||(this.#x=!0,queueMicrotask(()=>this.#he()))}}#C(t){this.#a.length>=this.#n?(this.#a=[],this.#q=!0,this.#k("overflow")):this.#a.push(t)}#he(){if(this.#x=!1,this.#l||this.#s||this.#h.size===0){this.#s&&this.#h.clear();return}let t=[...this.#h.values()];this.#h.clear();let e=t.reduce((n,o)=>!n||o.sequence>n.sequence?o:n,null);if(!e)return;let s=[...new Set(t.flatMap(n=>n.resources))];this.#t.onEvent({type:"invalidation",invalidation:{...e,resources:s}})}#k(t,e=!1){if(!this.#l){if(t==="authorization"){this.#B(),this.#t.onEvent({type:"resync",reason:t});return}if(!this.#s&&(this.#F(t),this.#i||(this.#i=!0,this.#t.onEvent({type:"resync",reason:t}),queueMicrotask(()=>{this.#i=!1})),t!=="entry_removed")){let s=e&&!this.#v;if(s&&(this.#v=!0),s&&this.#c!==null&&(window.clearTimeout(this.#c),this.#c=null),this.#g){if(this.#m){s&&this.#D(0,!0);return}this.#m=!0,this.#j(s);return}if(e&&this.#o){s&&(this.#b=!0);return}let n=this.#M>=ht?Ne:0;this.#D(s?0:n,s)}}}#D(t,e=!1){if(!this.#l){if(this.#c!==null){if(!e)return;window.clearTimeout(this.#c),this.#c=null}if(this.#o){this.#y=e?t:Math.max(this.#y??0,t);return}this.#c=window.setTimeout(()=>{this.#c=null,this.#A(!0)},t)}}#j(t=!1){let e=this.#M>=ht?Ne:Math.min(sn*2**this.#M,nn);this.#M<ht&&(this.#M+=1),this.#D(t?0:e,t)}async#A(t,e=!1){if(this.#l||this.#o)return;t&&this.#F(e?"authorization":"snapshot_required");let s=this.#d;this.#o=!0,this.#f=e;try{if(t&&await this.#ee(),this.#l||this.#s&&!e||s!==this.#d)return;let n={startedAt:performance.now(),generation:s};this.#T=n;let o="completed",i;try{i=await this.#e.sendMessagePromise({type:"matic_robot/workspace_snapshot",version:pt,entry_id:this.#t.entryId})}catch(c){throw o=an(c),c}finally{this.#L(n,o)}if(this.#l||this.#s&&!e||s!==this.#d)return;let r=Ss(i,this.#t.entryId);if(!r)throw new Error("invalid-workspace-snapshot");if(r.status.reason==="authorization"){this.#B(),this.#t.onEvent({type:"snapshot",snapshot:r});return}if(r.status.state!=="ready"&&r.status.retryable)throw new Error("workspace-snapshot-retryable");e&&(this.#s=!1,this.#u=!1,this.#c!==null&&window.clearTimeout(this.#c),this.#c=null),this.#o=!1,this.#g=!0,this.#m=!1;try{t?this.#pe(r):this.#p(r)}finally{this.#g=!1}let l=this.#m||this.#q;this.#m?this.#b&&(this.#b=!1,this.#D(0,!0)):(this.#M=0,this.#v=!1,this.#b=!1),!t&&!this.#l&&await this.#ee(),this.#q&&(this.#q=!1,this.#k("overflow")),t&&r.status.state==="ready"&&!l&&!this.#l&&s===this.#d&&this.#te("completed")}catch(n){if(this.#l||this.#s&&!e||s!==this.#d)return;if(this.#J(n),this.#z(n))this.#B(),this.#t.onEvent({type:"resync",reason:"authorization"});else if(!e){t||this.#F("reconnect");let o=this.#b;this.#b=!1,this.#j(o)}}finally{this.#o=!1,this.#f=!1,this.#u?(this.#u=!1,this.#se(0)):e&&this.#s&&this.#se(Ne);let n=this.#y;this.#y=null,n!==null&&this.#D(n)}}async#ee(){if(this.#l||this.#r)return;if(this.#H)return this.#H;let t=(async()=>{let e=await this.#e.subscribeMessage(s=>this.#O(s),{type:"matic_robot/workspace_subscribe",version:pt,entry_id:this.#t.entryId});this.#l?e():this.#r=e})();this.#H=t;try{await t}finally{this.#H===t&&(this.#H=null)}}#pe(t){let e=this.#a;if(this.#a=[],this.#R===t.epoch&&t.sequence<this.#S){this.#a=e,this.#k("snapshot_required");return}if(this.#Y(t),this.#l)return;let s=t.sequence+1;for(let n of e)if(n.epoch===t.epoch&&!(n.sequence<=t.sequence)&&!(n.sequence<s)){if(n.sequence!==s){this.#a=e.filter(o=>o.sequence>=s),this.#k("gap");return}this.#Q(n),s+=1}}#z(t){let e=D(t),s=e?.code,n=e?.status??e?.statusCode;return s==="unauthorized"||s==="not_authorized"||s==="auth_invalid"||n===401||n===403}#F(t){this.#w!==null||this.#l||(this.#w=t,this.#$=performance.now())}#te(t){let e=this.#w,s=this.#$;this.#w=null,this.#$=null,!(e===null||s===null||this.#l)&&this.#_[e].record(t,performance.now()-s)}#L(t,e){this.#T!==t||this.#l||t.generation!==this.#d||(this.#T=null,this.#W.record(e,performance.now()-t.startedAt))}#K(){let t=this.#T;t!==null&&(this.#T=null,!this.#l&&t.generation===this.#d&&this.#W.record("aborted",performance.now()-t.startedAt))}#B(){this.#K(),this.#te("failed"),this.#d+=1,this.#s||(this.#s=!0,this.#c!==null&&window.clearTimeout(this.#c),this.#c=null,this.#u=!1),this.#h.clear(),this.#a=[],this.#q=!1,this.#y=null,this.#M=0,this.#v=!1,this.#b=!1,this.#f||this.#se(Ne)}#se(t){this.#l||this.#c!==null||this.#u||(this.#c=window.setTimeout(()=>{if(this.#c=null,!this.#l){if(this.#o){this.#u=!0;return}this.#A(!0,!0)}},t))}#J(t){this.#t.onError?.(t instanceof Error?t:new Error("Workspace transport failed"))}};var Ke=class{#e;#t;#n=document.visibilityState!=="hidden";#r=!1;#l=!1;#i=!1;constructor({onSuspend:t,onResume:e}){this.#e=t,this.#t=e}get active(){return this.#n}start(){this.#r||this.#l||(this.#r=!0,window.addEventListener("pagehide",this.#o),window.addEventListener("pageshow",this.#s),document.addEventListener("visibilitychange",this.#u),document.visibilityState==="hidden"&&(this.#n?this.#d(!1):this.#e()))}dispose(){this.#l||(this.#l=!0,this.#r&&(window.removeEventListener("pagehide",this.#o),window.removeEventListener("pageshow",this.#s),document.removeEventListener("visibilitychange",this.#u)))}#o=()=>{this.#i=!0,this.#d(!1)};#s=t=>{if(this.#i=!1,t.persisted){document.visibilityState==="hidden"?this.#d(!1):(this.#d(!1),this.#d(!0));return}this.#f()};#u=()=>{this.#f()};#f(){if(this.#i||document.visibilityState==="hidden"){this.#d(!1);return}this.#d(!0)}#d(t){this.#n===t||this.#l||(this.#n=t,t?this.#t():this.#e())}};var p=(a,t,e=null)=>({status:a,value:t,problem:e}),we=a=>a.status==="loading"?p("idle",a.value):a,L=a=>a instanceof DOMException&&a.name==="AbortError",F=(a,t)=>a instanceof x||a&&typeof a=="object"&&"code"in a&&typeof a.code=="string"?a.code:t,P={stopUnconfirmed:E("error","v4_notice_stop_unconfirmed","Home Assistant can't confirm the robot stopped, so press Stop again if it's still moving."),actionUnconfirmed:E("error","v4_notice_action_unconfirmed","Home Assistant can't confirm that command, so check the robot before trying again."),mapChanged:E("info","v4_notice_map_changed","The map changed, so choose what to clean again."),statusRefreshed:E("info","v4_notice_status_refreshed","Status refreshed, so check the robot before trying again."),saving:E("info","v4_notice_saving","Saving\u2026"),planSaved:E("success","v4_notice_plan_saved","Plan saved"),planSaveFailed:E("error","v4_notice_plan_save_failed","Home Assistant can't confirm the plan was saved, so check your plans, then try again."),planDeleted:E("success","v4_notice_plan_deleted","Plan deleted"),planDeleteFailed:E("error","v4_notice_plan_delete_failed","The plan wasn't deleted; try again."),planPreviewMissing:E("warning","v4_notice_plan_preview_missing","The next-run preview isn't ready; reload your plans, then try again."),planPreviewRefreshFailed:E("warning","v4_notice_plan_preview_refresh_failed","The next-run preview didn't refresh; check the plan, then try again."),planPreviewNone:E("warning","v4_notice_plan_preview_none","This plan has no next-run preview; review its rooms and schedules."),planPreviewChanged:E("info","v4_notice_plan_preview_changed","The next run changed; check it before you run the plan."),roomPreviewBlocked:E("warning","v4_notice_room_preview_blocked","A room can't use these settings, so check the note above the rooms."),roomPreviewChanged:E("info","v4_notice_room_preview_changed","The room settings changed, so check them and start again."),roomPreviewFailed:E("warning","v4_notice_room_preview_failed","Home Assistant couldn't check the room settings, so try starting again."),areaRemoved:E("warning","v4_notice_area_removed","This saved Area was removed elsewhere. Your edits are preserved as a new Area draft; saving will create a new Area."),areaSaving:E("info","v4_notice_area_saving","Saving area\u2026"),areaSaved:E("success","v4_notice_area_saved","Area saved"),areaSaveFailed:E("error","v4_notice_area_save_failed","Home Assistant can't confirm the area was saved, so try again."),areaDeleted:E("success","v4_notice_area_deleted","Area deleted"),areaDeleteFailed:E("error","v4_notice_area_delete_failed","Home Assistant can't confirm the area was deleted, so try again."),resetMop:E("success","v4_notice_reset_mop","Mopping progress reset"),resetVacuum:E("success","v4_notice_reset_vacuum","Vacuum rotation progress reset"),resetMopFailed:E("error","v4_notice_reset_mop_failed","Mopping progress wasn't reset; try again."),resetVacuumFailed:E("error","v4_notice_reset_vacuum_failed","Vacuum rotation progress wasn't reset; try again.")},cn=a=>E("warning","v4_notice_saved_map","Showing the saved map from {date} without the robot's position.",{date:a}),Ts={coverage_identity_unavailable:E("error","v4_notice_coverage_task_unknown","Home Assistant can't confirm the current clean, so check the robot first."),coverage_activity_unavailable:E("error","v4_notice_coverage_activity_unknown","Home Assistant can't confirm whether the robot is cleaning, so check it first."),coverage_native_session_active:E("error","v4_notice_coverage_robot_busy","The robot is already cleaning, so wait for it to finish."),coverage_identity_changed:E("error","v4_notice_coverage_task_changed","The clean changed while starting, so check the robot first.")},dn=a=>a instanceof x&&Object.hasOwn(Ts,a.code)?Ts[a.code]??null:null,le=a=>[a.selectedFloorOrdinal??"none",a.mapFloorOrdinal??"none",a.mapFloorCoherent?"coherent":"transition"].join(":"),ce=a=>[a.mapFloorOrdinal??"none",a.mapSessionVerified?"verified":"unverified",a.mapSessionKey??"no-session"].join(":"),N=a=>[a.entryId,a.selectedFloorOrdinal??"none",a.mapFloorOrdinal??"none"].join("|"),T=a=>[a.entryId,le(a),ce(a)].join("|"),mt=a=>[T(a),a.mapRevision].join("|"),Ue=a=>a.runnerLocked||a.stopSettlePending||a.activePlan||a.nativeReconciliationPending||a.nativeSessionActive===!0,Ve=(a,t)=>a.entryKey===t.entryKey&&a.generation===t.generation&&a.floorKey===t.floorKey&&a.missionKey===t.missionKey,un=1e3,hn=5e3,pn=["rooms","plans","plan","draw","areaReview"],As=["plan-mutation","area-mutation"],Is=a=>JSON.stringify({...a,previewToken:void 0}),je=(a,t)=>a.label?a.label:a.active?"Current floor":`Saved floor ${a.ordinal??t}`,Ye=class{#e;#t;#n;#r;#l=new Be;#i=null;#o=new Map;#s=null;#u=null;#f=null;#d=null;#v=0;#b=!1;#g=!1;#m=!1;#c=!1;#y=null;#M=Promise.resolve();#q=!1;#R=!1;#S="";#h=null;#x=0;#N=null;#H="";#a=!1;#W=!0;#_=null;#T=null;#w=null;#$=null;#O="";#Y=!1;#p;#Q;workspaceDiagnostics(){return this.#_?.diagnostics()??null}constructor(t,e,s=null,n){this.#e=t,this.#t=new St(t.value.generation),this.#n=e,this.#p=s,this.#Q=n,this.#r=new Ke({onSuspend:()=>this.#C(),onResume:()=>{this.#he()}}),this.#e.patch({pageActive:this.#r.active}),this.#$=t.subscribe(o=>{this.#k(o),this.#ee()}),this.#r.start()}#C(){this.#L(!1,As),this.#X(),this.#U(As),this.#m=!1,this.#c=!1,this.#y=null,this.#R=!1,this.#ge();let t=this.#e.value;this.#e.patch({resources:{...t.resources,catalog:we(t.resources.catalog),scene:we(t.resources.scene),history:we(t.resources.history),plans:we(t.resources.plans),areas:we(t.resources.areas),pose:p("idle",null)}})}async#he(){if(this.#a||!this.#r.active)return;this.#e.patch({pageActive:!0});let t=this.#s;if(this.#a||!this.#r.active||!t?.host.connected||!t.host.administrator||!t.host.robotConnected||t.host.robotCount===0)return;let e=this.#e.value;this.#be(),this.#z(t),await this.refreshCatalog(!0,!0);let s=this.#e.value,n=s.resources.entry;if(this.#a||!this.#r.active||e.dataMode!=="history"||s.generation!==e.generation||s.dataMode!=="history"||s.selection.entryId!==e.selection.entryId||s.selection.floorId!==e.selection.floorId||s.selection.historyId!==e.selection.historyId||s.resources.catalog.status!=="ready"||!n||n.entryId!==s.selection.entryId)return;let o=s.resources.history.value?.floors.find(u=>u.id===s.selection.floorId),i=o?.snapshots.find(u=>u.id===s.selection.historyId);if(!o)return;let r=this.#t.begin(n.entryId,o.id,i?.id??o.id,i?.revision??0);if(this.#e.patch({generation:r.generation}),await this.#G(n,r),!this.#t.accepts(r)||!this.#r.active||this.#e.value.resources.history.status!=="ready")return;let l=this.#e.value,c=l.resources.history.value?.floors.find(u=>u.id===o.id),d=c?.snapshots.find(u=>u.id===i?.id);!c||i&&!d||(d&&d.revision!==r.revision&&(r=this.#t.begin(n.entryId,o.id,d.id,d.revision)),this.#e.patch({generation:r.generation,coherence:"current"}),d&&(!l.resources.scene.value||d.revision!==i?.revision)&&await this.#ve(d,r))}#k(t){if(!t.owner)return;let e={version:4,view:t.view,appearance:t.appearance,labels:t.labelsVisible,quality:t.quality,cameras:t.cameras},s=this.#i;this.#i=e,!(!s||s.view===e.view&&s.appearance===e.appearance&&s.labels===e.labels&&s.quality===e.quality&&s.cameras===e.cameras)&&this.#l.schedule(e)}#D(t){let e=kt(t),s=t.resources.entry,n=this.#s?.vacuumEntityId;if(!e||!s||!n||!t.selection.entryId||t.workflow!=="rooms"||t.dataMode!=="live"||t.floor.readOnly||t.coherence!=="current"||!t.host.connected||!t.host.administrator||!t.host.robotConnected||t.command!=="idle"||t.resources.plans.status!=="ready")return null;let o=t.selection.roomIds.map(i=>{let r=t.selection.roomSettings.find(l=>l.roomId===i);return r?{room:i,cleaning_mode:r.cleaningMode,coverage_setting:r.coverageSetting}:null});return o.some(i=>i===null)?null:{key:e,generation:t.generation,retryRevision:t.manualRoomPreviewRetry,floorKey:le(s),missionKey:ce(s),entryId:t.selection.entryId,entityId:n,rooms:o,overrideRoomSchedule:!t.selection.useRoomSchedule}}#j(t){return JSON.stringify([t.key,t.generation,t.retryRevision,t.floorKey,t.missionKey,t.entryId,t.entityId])}#A(t){let e=this.#D(this.#e.value);return!this.#a&&e!==null&&this.#j(e)===this.#j(t)}#ee(){if(this.#a||!this.#s)return;let t=this.#e.value,e=this.#D(t);if(!e){this.#o.get("room-preview")?.abort(),this.#o.delete("room-preview"),this.#O="",(t.manualRoomPreview.status!=="idle"||t.manualRoomPreview.value!==null)&&this.#e.patch({manualRoomPreview:p("idle",null)});return}let s=this.#j(e),n=Qe(t);if(n&&n.key===e.key&&n.generation===e.generation&&n.floorKey===e.floorKey&&n.missionKey===e.missionKey&&n.preview.entryId===e.entryId){this.#O=s;return}if(this.#O===s)return;this.#o.get("room-preview")?.abort(),this.#O=s;let o=this.#P("room-preview");this.#e.patch({manualRoomPreview:p("loading",null)}),this.#pe(e,o)}async#pe(t,e){try{let s=await this.#n.previewRoomSequence(t.entityId,t.rooms,t.overrideRoomSchedule,e.signal);return!this.#A(t)||e.signal.aborted||s.entryId!==t.entryId?null:(this.#e.patch({manualRoomPreview:p("ready",{key:t.key,generation:t.generation,floorKey:t.floorKey,missionKey:t.missionKey,preview:s})}),s)}catch(s){return L(s)||e.signal.aborted||!this.#A(t)||this.#e.patch({manualRoomPreview:p("error",null,F(s,"preview-unavailable"))}),null}finally{this.#E("room-preview",e)}}sync(t){if(this.#a)return;let e=this.#_,s=this.#s?.host.robotConnected??null,n=this.#s?.host.administrator===!1&&t.host.administrator,o=this.#s!==null&&!this.#s.host.robotConnected&&t.host.robotConnected,i=this.#e.value.owner,r=i!==null&&(i.entryKey!==t.entryKey||i.userKey!==t.userKey);r&&(this.#V("context-changed",t.entryKey),this.#b&&(this.#m=!0,this.#c=!1,this.#y=null));let l=this.#W;this.#W=t.host.connected,this.#s=t,this.#z(t),o&&e&&e===this.#_&&e.notifyReconnect();let c=t.userKey!==this.#H?this.#l.load(t.userKey):null;if(c&&(this.#H=t.userKey,this.#i=c),this.#e.patch({owner:{userKey:t.userKey,entryKey:t.entryKey},host:t.host,activity:t.activity,batteryPercent:t.batteryPercent,robotLabel:t.robotLabel,robots:t.robots,locale:t.language,selection:{...this.#e.value.selection,entryId:t.entryKey},...c?{view:c.view,appearance:c.appearance,labelsVisible:c.labels,quality:c.quality,cameras:c.cameras}:{}}),!t.host.administrator){this.#X(),this.#V("access-required",t.entryKey);return}if(!t.host.connected){l&&(this.#e.patch({generation:this.#t.invalidate()}),this.#B(),this.#S=""),this.#X(),this.#m=!1,this.#c=!1,this.#y=null,this.#R=!1,this.#U();let d=this.#e.value,u=d.resources.scene.value;this.#e.patch({coherence:u?"degraded":"unavailable",resources:{...d.resources,catalog:d.resources.catalog.status==="loading"?p("idle",d.resources.catalog.value):d.resources.catalog,plans:d.resources.plans.status==="loading"?p("idle",d.resources.plans.value):d.resources.plans,areas:d.resources.areas.status==="loading"?p("idle",d.resources.areas.value):d.resources.areas,pose:p("idle",null)},map:{...d.map,available:u!==null,exactPose:!1}});return}if(t.host.robotCount===0){this.#X(),this.#V("map-unavailable",t.entryKey);return}if(t.entryKey&&!t.vacuumEntityId){this.#X(),this.#V("no-loaded-robot",t.entryKey);return}if(!t.host.robotConnected){s!==!1&&(this.#L(),this.#U(),this.#m=!1,this.#c=!1,this.#y=null,this.#R=!1),this.#X();let d=this.#e.value,u=d.resources.scene.value;this.#e.patch({coherence:u?"degraded":"unavailable",resources:{...d.resources,catalog:d.resources.catalog.status==="loading"?p("idle",d.resources.catalog.value):d.resources.catalog,scene:d.resources.scene.status==="loading"?p("idle",u):d.resources.scene,pose:p("idle",null)},map:{...d.map,available:u!==null,exactPose:!1}});return}if(this.#r.active){if(this.#be(),!l||o||n){this.refreshCatalog(!0,!0);return}(r||this.#e.value.resources.catalog.status==="idle"||t.entryKey&&t.entryKey!==this.#e.value.selection.entryId)&&this.refreshCatalog(!0)}}#z(t){let e=t.entryKey,s=this.#e.value,n=s.resources.catalog.value?.find(l=>l.entryId===e),o=s.resources.entry;if(!(this.#Q??!!(n?.liveWorkspaceTransportEnabled&&o?.entryId===e&&o.liveWorkspaceTransportEnabled))||!this.#p||!t.host.administrator||!t.host.connected||!t.vacuumEntityId||!e||!this.#r.active){this.#ge();return}if(this.#_&&this.#T===e)return;this.#_?.dispose(),this.#w=null;let r=new Fe(this.#p,{entryId:e,onEvent:l=>{if(!(this.#a||!this.#r.active||this.#_!==r||this.#T!==e||this.#s?.entryKey!==e)){if(l.type==="resync"&&l.reason==="entry_removed"){r.dispose(),this.#_===r&&(this.#_=null,this.#T=null,this.#w=null);return}if(l.type==="snapshot"){let{snapshot:c}=l,d=this.#e.value.resources.entry,u=c.payload.entry;if(c.entry_id!==e||c.identity.entry_id!==e)return;if(u&&(u.entryId!==e||c.identity.floor_verified!==(u.mapFloorCoherent&&u.mapSessionVerified))){r.requestResync("invalid_message");return}let m=!u&&d?.entryId===e&&c.identity.floor_verified!==(d.mapFloorCoherent&&d.mapSessionVerified);if(c.status.reason==="authorization"){this.#w=null,this.#K(e,["plans","areas","history"]);return}let h=this.#w,f=[],w=h!==null&&h.epoch!==c.epoch;if(h&&h.epoch===c.epoch){let k=new Set([...Object.keys(h.revisions),...Object.keys(c.revisions)]),v=[...k].some(g=>(c.revisions[g]??-1)<(h.revisions[g]??-1));if(c.coherence_generation<h.coherenceGeneration||c.coherence_generation===h.coherenceGeneration&&v){r.requestResync("restart");return}f=[...k].filter(g=>(c.revisions[g]??-1)>(h.revisions[g]??-1))}w&&(f=["plans","areas","history"]);let y=h!==null&&(h.epoch!==c.epoch||h.coherenceGeneration!==c.coherence_generation),_=!!(d&&u&&d.entryId===e&&T(d)!==T(u));if(this.#w={entryId:c.entry_id,epoch:c.epoch,sequence:c.sequence,coherenceGeneration:c.coherence_generation,revisions:c.revisions},m){this.#K(e,["plans","areas","history"]);return}if(y||_){this.#K(e,f);return}let M=u!==null&&d?.entryId===e&&this.#te(u);if(h&&f.length){if(c.sequence<=h.sequence){r.requestResync("invalid_message");return}this.#w=h,this.#F({epoch:c.epoch,sequence:c.sequence,coherence_generation:c.coherence_generation,revisions:c.revisions,resources:f},e,r,M)}return}if(l.type==="resync"){this.#w=null,l.reason!=="authorization"&&this.#K(e,["plans","areas","history"]);return}this.#F(l.invalidation,e,r)}}});this.#_=r,this.#T=e,r.start()}#F(t,e,s,n=!1){let o=this.#w;if(!o||o.entryId!==e||this.#_!==s||t.epoch!==o.epoch||t.sequence<=o.sequence)return;let i=t.coherence_generation!==o.coherenceGeneration,l=[...new Set([...Object.keys(o.revisions),...Object.keys(t.revisions)])].some(h=>(t.revisions[h]??-1)<(o.revisions[h]??-1));if(t.coherence_generation<o.coherenceGeneration||!i&&l){s.requestResync("restart");return}let c=new Set(t.resources),d=[...c].some(h=>(t.revisions[h]??-1)>(o.revisions[h]??-1));if(this.#w={...o,sequence:t.sequence,coherenceGeneration:t.coherence_generation,revisions:t.revisions},!d&&!i)return;if(i){this.#K(e,t.resources);return}c.has("scene")&&c.delete("scene");let u=this.#e.value.resources.entry,m=this.#t.current();!u||u.entryId!==e||!m||c.size&&this.#J(u,m,c,!n)}#te(t){let e=this.#e.value,s=e.resources.entry;if(!s||T(s)!==T(t))return!1;let n=t.mapRevision===s.mapRevision?t:{...t,mapRevision:s.mapRevision},o=e.resources.catalog,i=o.value?.map(u=>u.entryId===n.entryId?n:u),r=n.mapFloorCoherent&&n.mapSessionVerified,l=n.health==="problem"||n.health==="limited",c=this.#h,d=c?.key===T(n)&&this.#me(c)&&(c.attempt!==null||c.retryTimer!==null);return this.#e.patch({managedLock:Ue(n),coherence:d?"verifying":r?l?"degraded":"current":"verifying",map:{...e.map,available:e.resources.scene.value!==null,complete:n.mapComplete&&!n.mapTruncated,floorCoherent:n.mapFloorCoherent,sessionVerified:n.mapSessionVerified,exactPose:r&&!d?e.map.exactPose:!1},floor:{...e.floor,classifiedCount:Math.max(1,n.historyFloorCount),...d&&e.resources.scene.value?{readOnly:!0}:{}},resources:{...e.resources,entry:n,...i?{catalog:{...o,value:i}}:{}}}),this.#s&&this.#z(this.#s),!0}#L(t=this.#e.value.pageActive,e=[]){let s=this.#t.invalidate();this.#B();let n=this.#e.value;this.#e.patch({generation:s,pageActive:t,coherence:n.resources.scene.value?"verifying":"unavailable",floor:{...n.floor,readOnly:n.floor.readOnly||n.resources.scene.value!==null},map:{...n.map,exactPose:!1}}),this.#h&&this.#ae(this.#h.key),this.#U(["catalog",...e]),this.#S=""}#K(t,e=[]){this.#I(),this.#L(),this.refreshCatalog(!0,!0).then(()=>{if(this.#a||this.#s?.entryKey!==t||!this.#s.host.administrator||!this.#s.host.connected)return;let s=this.#e.value.resources.entry,n=this.#t.current();if(!s||s.entryId!==t||!n)return;let o=new Set(e);o.delete("history"),this.#J(s,n,o,!1)})}#B(){this.#x+=1,this.#N=null}#se(t){let e=this.#N,s=this.#t.current();return!!(e&&s&&e.generation===this.#x&&e.stamp.generation===s.generation&&e.entryId===t.entryId&&e.coherenceIdentity===T(t)&&e.deltaUrl===t.deltaUrl&&s.entryKey===t.entryId&&s.floorKey===le(t)&&s.missionKey===ce(t)&&t.mapFloorCoherent&&t.mapSessionVerified&&this.#e.value.dataMode==="live"&&this.#e.value.selection.floorId==="current"&&this.#s?.host.connected&&this.#s.host.robotConnected&&this.#s.host.administrator)}#J(t,e,s,n=!0){(s.has("plans")||s.has("plan_state"))&&this.loadPlans(),s.has("areas")&&this.loadAreas(),s.has("history")&&this.#G(t,e),n&&["status","robot_state","activity","plan_state"].some(o=>s.has(o))&&this.refreshCatalog(!0,!0,!0)}#be(){this.#r.active&&(this.#u===null&&(this.#u=window.setInterval(()=>{this.refreshCatalog()},5e3)),this.#f===null&&(this.#f=window.setInterval(()=>{this.refreshPose()},un)))}#X(){this.#u!==null&&window.clearInterval(this.#u),this.#f!==null&&window.clearInterval(this.#f),this.#u=null,this.#f=null,this.#I()}#I(){let t=this.#h;if(this.#h=null,!t)return;t.attempt?.finishReplacementRead?.(),t.attempt&&(t.attempt.finishReplacementRead=null),t.retryTimer!==null&&window.clearTimeout(t.retryTimer);let e=t.attempt?.controller,s=!!(e&&e===this.#o.get("catalog")&&this.#e.value.resources.catalog.status==="loading");if(e?.abort(),s){let n=this.#e.value.resources;this.#e.patch({resources:{...n,catalog:p("idle",n.catalog.value)}})}this.#y?.state===t&&(this.#m=!1,this.#c=!1,this.#y=null)}#ie(t,e){let s=this.#h;s?.key===T(e)&&(s.failedKinds.delete(t),t==="delta"&&this.#ne(e),s.failedKinds.size===0&&this.#I())}#ne(t){this.#ae(T(t))}#ae(t){let e=this.#h;e?.key===t&&(e.attempt?.finishReplacementRead?.(),e.attempt&&(e.attempt.finishReplacementRead=null))}#le(t,e){let s=T(e),n=this.#h;n?.key!==s&&(this.#I(),n={key:s,failedKinds:new Set,retryTimer:null,attempt:null},this.#h=n),n.failedKinds.add(t),t==="delta"&&this.#ne(e),this.#me(n)&&this.#t.current()&&this.#L(),!n.attempt&&n.retryTimer===null&&(n.failedKinds.size===1&&n.failedKinds.has(t)?this.#we(n):this.#fe(n))}#me(t){let e=this.#e.value;return t.failedKinds.has("pose")||e.floor.readOnly||!e.map.floorCoherent||!e.map.sessionVerified}#fe(t){t.retryTimer!==null||t.failedKinds.size===0||(t.retryTimer=window.setTimeout(()=>{t.retryTimer=null;let e=this.#e.value.resources.entry,s=this.#s?.host;if(this.#h!==t||this.#a||!e||T(e)!==t.key||this.#e.value.dataMode!=="live"||this.#e.value.selection.floorId!=="current"||!s?.connected||!s.administrator||!s.robotConnected||s.robotCount===0){this.#h===t&&this.#I();return}this.#we(t)},hn))}async#we(t){if(this.#a||this.#h!==t||t.attempt)return;let e=this.#e.value.resources.entry,s=this.#s?.host;if(!e||T(e)!==t.key||this.#e.value.dataMode!=="live"||this.#e.value.selection.floorId!=="current"||!s?.connected||!s.administrator||!s.robotConnected||s.robotCount===0){this.#h===t&&this.#I();return}if(this.#o.has("scene")){this.#fe(t);return}let n=this.#me(t);n?this.#t.current()&&this.#L():(this.#B(),this.#o.get("delta")?.abort());let o,i=new Promise(c=>{o=c}),r={generation:this.#t.generation,controller:null,replacementRead:i,finishReplacementRead:o};t.attempt=r;let l={state:t,attempt:r};try{await this.refreshCatalog(!0,!1,!n,l),t.failedKinds.has("delta")&&this.#h===t&&t.attempt===r&&await r.replacementRead}finally{if(this.#h!==t||t.attempt!==r)return;r.finishReplacementRead=null,t.attempt=null,t.failedKinds.size>0&&this.#fe(t)}}#ce(t){let e=this.#e.value,s=this.#s?.host;return!this.#a&&this.#r.active&&this.#h===t.state&&t.state.attempt===t.attempt&&t.attempt.generation===this.#t.generation&&e.generation===this.#t.generation&&e.dataMode==="live"&&e.selection.floorId==="current"&&e.resources.entry!==null&&T(e.resources.entry)===t.state.key&&!!(s?.connected&&s.administrator&&s.robotConnected&&s.robotCount>0)}#P(t){this.#o.get(t)?.abort();let e=new AbortController;return this.#o.set(t,e),e}#E(t,e){this.#o.get(t)===e&&this.#o.delete(t)}#U(t=[]){let e=!1;for(let[s,n]of this.#o)t.includes(s)||(e||=s==="plan-mutation"||s==="area-mutation"||s==="plan-preflight",n.abort(),this.#o.delete(s));e&&this.#e.value.command==="pending"&&this.#e.patch({command:"idle",notice:null})}#_e(){this.#v+=1,this.#d!==null&&window.clearTimeout(this.#d),this.#d=null}#V(t,e=null){this.#I(),this.#_e(),this.#t.invalidate(),this.#B(),this.#S="";let s=this.#t.generation;this.#U();let n=this.#e.value,o=H();this.#e.patch({command:"idle",dataMode:o.dataMode,floor:o.floor,managedLock:!1,workflow:"none",dialog:null,notice:null,draftFloorOrdinal:null,draw:o.draw,planDraft:o.planDraft,areaDraft:o.areaDraft,generation:s,coherence:n.host.administrator?"unavailable":"blocked",fullMap:!1,precisionOpen:!1,resources:{catalog:p("error",null,t),entry:null,scene:p("idle",null),pose:p("idle",null),history:p("idle",null),plans:p("idle",null),areas:p("idle",null)},manualRoomPreview:p("idle",null),map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1},selection:{...o.selection,entryId:e,entrySource:n.selection.entrySource,floorId:"current",historyId:null}})}async refreshCatalog(t=!1,e=!1,s=!1,n=null){if(this.#a||!this.#r.active||!this.#s?.host.administrator||!this.#s.host.connected||this.#s.host.robotCount===0||n&&(!this.#s.host.robotConnected||!this.#ce(n)))return;if(this.#b)return t&&(this.#g?e&&(this.#m?this.#c&&=s:this.#c=s,this.#m=!0):(this.#m?this.#c&&=s:this.#c=s,this.#m=!0,this.#o.get("catalog")?.abort()),n&&(this.#m?this.#c&&=s:this.#c=s,this.#y=n,this.#m=!0)),this.#M;this.#b=!0,this.#g=t;let o;this.#M=new Promise(l=>{o=l});let i=this.#P("catalog");n&&(n.attempt.controller=i);let r=this.#e.value.resources.catalog.value;this.#e.patch({resources:{...this.#e.value.resources,catalog:p("loading",r)}});try{let l=await this.#n.catalog(i.signal);if(i.signal.aborted||this.#a||n&&!this.#ce(n))return;let c=this.#s?.entryKey,d=c?l.find(y=>y.entryId===c)??null:l[0]??null,u=this.#e.value.resources.entry;if(d&&this.#h?.key===T(d)&&(this.#h.attempt!==null||this.#h.retryTimer!==null)&&(!n||!this.#ce(n))){this.#e.patch({managedLock:Ue(d),resources:{...this.#e.value.resources,catalog:p(l.length?"ready":"empty",l),entry:u}});return}let m=!!(d&&u&&T(d)===T(u)&&this.#se(u));if(d&&u&&N(d)===N(u)&&le(d)===le(u)&&ce(d)===ce(u)&&(m||d.mapRevision<u.mapRevision||!t&&this.#o.has("scene"))&&(d={...d,mapRevision:u.mapRevision}),this.#e.patch({managedLock:d?Ue(d):!1,resources:{...this.#e.value.resources,catalog:p(l.length?"ready":"empty",l),entry:d}}),this.#s&&this.#z(this.#s),!d){this.#V("no-loaded-robot",this.#s?.entryKey??null);return}if(this.#e.value.selection.floorId!=="current"||this.#e.value.dataMode!=="live"){n&&this.#ne(d);return}let h=mt(d),f=this.#t.current(),w=!!(f&&u&&T(d)===T(u)&&d.mapFloorCoherent&&d.mapSessionVerified);if((!t||s)&&(h===this.#S||w)){let y=this.#e.value,_=d.mapFloorCoherent&&d.mapSessionVerified,M=d.health==="problem"||d.health==="limited";this.#e.patch({coherence:_?M?"degraded":"current":"verifying",map:{...y.map,available:y.resources.scene.value!==null,complete:d.mapComplete&&!d.mapTruncated,floorCoherent:d.mapFloorCoherent,sessionVerified:d.mapSessionVerified,exactPose:_?y.map.exactPose:!1},floor:{...y.floor,classifiedCount:Math.max(1,d.historyFloorCount)}}),_&&this.#e.value.resources.plans.problem==="map-rechecking"&&this.loadPlans(),this.#ye();let k=f;if(k&&w&&(d.mapRevision>k.revision||n!==null)&&(d.mapRevision>k.revision&&(k=this.#t.advance(k,d.mapRevision)),k)){this.#S=h,this.#B();let v=this.#e.value.resources;this.#e.patch({resources:{...v,scene:p("loading",v.scene.value)}}),this.#oe(d,k)}k&&!y.resources.scene.value&&!this.#o.has("history")&&this.#G(d,k),_&&k&&(y.resources.scene.status==="error"||y.floor.readOnly)&&!this.#o.has("scene")&&this.#oe(d,k);return}this.#S=h,this.#ke(d,u)}catch(l){if(L(l)||i.signal.aborted||this.#a)return;n&&this.#ae(n.state.key),this.#e.patch({coherence:this.#e.value.resources.scene.value?"degraded":"unavailable",resources:{...this.#e.value.resources,catalog:p("error",r,F(l,"catalog-unavailable"))}})}finally{this.#E("catalog",i),n?.attempt.controller===i&&(n.attempt.controller=null),this.#b=!1;let l=this.#m,c=this.#c,d=this.#y;this.#g=!1;try{l&&!this.#a&&(this.#m=!1,this.#c=!1,this.#y=null,await this.refreshCatalog(!0,!1,c,d))}finally{o()}}}#ke(t,e){this.#h!==null&&this.#h.key!==T(t)&&this.#I();let s=this.#e.value,n=!!(e&&N(e)===N(t)),o=t.mapFloorCoherent&&t.mapSessionVerified,i=s.draftMapSessionKey??(e?.mapFloorCoherent&&e.mapSessionVerified?e.mapSessionKey:null),r=s.draftFloorOrdinal??(e?.mapFloorCoherent&&e.mapSessionVerified?e.mapFloorOrdinal:null),l=o?t.mapFloorOrdinal:null,c=o?t.mapSessionKey:null,d=e!==null&&e.entryId!==t.entryId||r!==null&&l!==null&&r!==l||i!==null&&c!==null&&i!==c,u=n&&o&&r===t.mapFloorOrdinal&&i===t.mapSessionKey,m=["catalog"];n&&!d&&m.push("plans","areas"),u&&m.push("plan-mutation","area-mutation");let h=this.#t.begin(t.entryId,le(t),ce(t),t.mapRevision);this.#h?.key===T(t)&&this.#h.attempt&&(this.#h.attempt.generation=h.generation),this.#B(),this.#U(m);let f=e?.entryId===t.entryId?s.resources.scene.value:null,w=f!==null&&(s.floor.readOnly||!n||!o||e?.mapSessionKey!==t.mapSessionKey),y=s.resources.pose.value,_=n&&o&&t.mapSessionKey!==null&&y?.position&&y.mapSessionKey===t.mapSessionKey?y:null;d&&this.#_e();let M=H(),k=t.health==="problem"||t.health==="limited",v=this.#e.value;this.#e.patch({...d?{command:"idle",workflow:"none",dialog:null,precisionOpen:!1,fullMap:!1,draw:M.draw,planDraft:M.planDraft,areaDraft:M.areaDraft,notice:P.mapChanged}:{},draftFloorOrdinal:l??r,draftMapSessionKey:c??i,managedLock:Ue(t),generation:h.generation,coherence:o?k?"degraded":w?"verifying":"current":"verifying",dataMode:"live",resources:{...v.resources,entry:t,scene:p(o?"loading":"idle",f),pose:p(o?"loading":"idle",_),history:p("loading",v.resources.history.value),plans:n&&!d?v.resources.plans:p("idle",null),areas:n&&!d?v.resources.areas:p("idle",null)},map:{available:f!==null,complete:t.mapComplete&&!t.mapTruncated,floorCoherent:t.mapFloorCoherent,sessionVerified:t.mapSessionVerified,exactPose:o&&_!==null&&!w},floor:{classifiedCount:Math.max(1,t.historyFloorCount),displayName:w?s.floor.displayName:t.selectedFloorOrdinal?`Floor ${t.selectedFloorOrdinal}`:"Current floor",readOnly:w},selection:{...v.selection,entryId:t.entryId,floorId:"current",historyId:null,roomIds:d?[]:v.selection.roomIds,roomSettings:d?[]:v.selection.roomSettings,planId:d?null:v.selection.planId,areaId:d?null:v.selection.areaId}}),this.#G(t,h),o&&this.#e.value.resources.plans.status==="idle"&&this.loadPlans(),this.#ye(),o&&(this.#oe(t,h),this.#de(t,h))}async#oe(t,e){if(!this.#r.active)return;let s=this.#P("scene");try{let n=await this.#n.scene(t.sceneUrl,t.mapRevision,t.mapFloorCoherent,"live",s.signal);if(!this.#t.accepts(e))return;if(!n.floorCoherent){let c=this.#e.value;this.#e.patch({coherence:"verifying",resources:{...c.resources,scene:p("error",c.resources.scene.value,"map-rechecking"),pose:p("idle",null)},map:{...c.map,available:c.resources.scene.value!==null,floorCoherent:!1,exactPose:!1},floor:{...c.floor,readOnly:c.resources.scene.value!==null}}),this.#ne(t);return}if(n.revision<e.revision||!n.scene)throw new x("scene-unavailable");let o=n.revision===e.revision?e:this.#t.advance(e,n.revision);if(!o)throw new x("scene-unavailable");let i=this.#e.value,r={...i.resources.entry??t,mapRevision:n.revision};this.#S=mt(r),this.#e.patch({coherence:r.health==="problem"||r.health==="limited"?"degraded":"current",resources:{...i.resources,entry:r,scene:p("ready",n.scene)},map:{...i.map,available:!0},floor:{...i.floor,readOnly:!1,displayName:i.resources.history.value?.floors.find(c=>c.active)?.label||(r.selectedFloorOrdinal?`Floor ${r.selectedFloorOrdinal}`:"Current floor")},notice:i.notice?.key==="v4_notice_saved_map"?null:i.notice});let l=this.#e.value.resources.plans;if((l.status==="idle"||l.problem==="map-rechecking")&&this.loadPlans(),this.#ye(),t.deltaUrl&&typeof DecompressionStream=="function"){let c=++this.#x;this.#Z(r,o,n.scene,c)}else this.#ie("delta",r)}catch(n){if(L(n)||!this.#t.accepts(e))return;if(n instanceof x&&n.code==="request-timeout"){let l=this.#e.value;this.#e.patch({resources:{...l.resources,scene:p("loading",l.resources.scene.value,"scene-building")}}),window.setTimeout(()=>{this.#a||!this.#t.accepts(e)||this.#e.value.selection.floorId!=="current"||this.#oe(t,e)},250);return}this.#ne(t);let o=this.#e.value,i=o.resources.pose.value,r=o.resources.scene.value!==null&&t.mapSessionKey!==null&&i?.position!==null&&i?.mapSessionKey===t.mapSessionKey;this.#e.patch({coherence:"degraded",resources:{...o.resources,scene:p("error",o.resources.scene.value,F(n,"scene-unavailable"))},map:{...o.map,available:o.resources.scene.value!==null,exactPose:r}})}finally{this.#E("scene",s)}}async#Z(t,e,s,n){if(!t.deltaUrl||typeof DecompressionStream!="function")return;let o=t.deltaUrl,i={generation:n,stamp:e,entryId:t.entryId,coherenceIdentity:T(t),deltaUrl:o};if(n!==this.#x||!this.#t.accepts(e))return;this.#N=i;let r=t,l=e,c=s;try{for(;!this.#a&&this.#r.active&&n===this.#x&&this.#t.accepts(l)&&this.#e.value.selection.floorId==="current";){let d=this.#P("delta");try{let u=await this.#n.sceneDelta(o,c,r.mapFloorCoherent,d.signal);if(d.signal.aborted||this.#a||n!==this.#x||!this.#t.accepts(l))return;if(!u.floorCoherent){let f=this.#e.value;this.#e.patch({coherence:"verifying",map:{...f.map,available:f.resources.scene.value!==null,floorCoherent:!1,exactPose:!1},floor:{...f.floor,readOnly:f.resources.scene.value!==null},resources:{...f.resources,scene:p("error",f.resources.scene.value,"map-rechecking"),pose:p("idle",null)}}),this.#le("delta",r);return}if(u.notModified||!u.scene){this.#ie("delta",r),await new Promise(f=>window.setTimeout(f,100));continue}let m=this.#t.advance(l,u.revision);if(!m)return;l=m,i.stamp=m,c=u.scene,r={...r,mapRevision:u.revision},this.#ie("delta",r),this.#S=mt(r);let h=this.#e.value;this.#e.patch({resources:{...h.resources,entry:r,scene:p("ready",c)},map:{...h.map,available:!0,floorCoherent:!0}}),this.#de(r,l)}finally{this.#E("delta",d)}}}catch(d){if(L(d)||this.#a||n!==this.#x||!this.#t.accepts(l))return;this.#le("delta",r)}finally{this.#N===i&&(this.#N=null)}}async#G(t,e){if(!this.#r.active)return;let s=this.#P("history");try{let n=await this.#n.history(t.historyUrl,s.signal),o=this.#t.current();if(s.signal.aborted||!o||!Ve(e,o)||n.entryId!==t.entryId)return;let i=this.#e.value,r=n.floors.find(d=>d.id===i.selection.floorId),l=!i.selection.historyId||r?.snapshots.some(d=>d.id===i.selection.historyId),c=i.dataMode==="live"?n.floors.find(d=>d.active):r;if(this.#e.patch({resources:{...this.#e.value.resources,history:p("ready",n)},floor:{...this.#e.value.floor,classifiedCount:n.floors.length,...c&&!(i.dataMode==="live"&&i.floor.readOnly)?{displayName:je(c,1)}:{}}}),i.dataMode==="live"&&!i.resources.scene.value){let d=n.floors.flatMap(u=>u.snapshots.map(m=>({floor:u,snapshot:m}))).sort((u,m)=>Date.parse(m.snapshot.createdAt)-Date.parse(u.snapshot.createdAt));for(let u of d){let m;try{m=await this.#n.scene(u.snapshot.sceneUrl,u.snapshot.revision,!0,"history",s.signal)}catch(w){if(L(w)||s.signal.aborted)return;continue}let h=this.#t.current();if(s.signal.aborted||!h||!Ve(e,h)||this.#e.value.resources.scene.value)return;if(!m.scene)continue;let f=this.#e.value;this.#e.patch({floor:{...f.floor,readOnly:!0,displayName:je(u.floor,1)},resources:{...f.resources,scene:p("ready",m.scene),pose:p("idle",null)},map:{...f.map,available:!0,exactPose:!1},notice:cn(Ut(u.snapshot.createdAt,this.#s?.dateLanguage,this.#s?.timeZone))});break}}if(i.dataMode==="history"&&(!r||!l)){let d=r||n.floors.find(m=>m.active)||n.floors[0],u=this.selectFloor(d?.id||"current");!this.#a&&i.workflow==="history"&&this.#e.dispatch({type:"open-workflow",workflow:"history"}),await u}}catch(n){let o=this.#t.current();if(L(n)||s.signal.aborted||!o||!Ve(e,o))return;this.#e.patch({resources:{...this.#e.value.resources,history:p("error",null,F(n,"history-unavailable"))}})}finally{this.#E("history",s)}}async refreshPose(){let t=this.#e.value.resources.entry,e=this.#t.current();!t||!e||this.#e.value.selection.floorId!=="current"||!t.mapFloorCoherent||!t.mapSessionVerified||await this.#de(t,e)}async#de(t,e){if(this.#a||!this.#r.active||!this.#W||!this.#s?.host.connected)return;if(this.#q){this.#R=!0;return}this.#q=!0;let s=this.#P("pose");try{let n=await this.#n.pose(t.poseUrl,s.signal),o=this.#t.current(),i=this.#e.value.resources.entry;if(!o||!Ve(e,o)||!i||!this.#e.value.map.floorCoherent)return;if(!n.floorCoherent||n.mapSessionKey===null||n.mapSessionKey!==i.mapSessionKey){this.#e.patch({resources:{...this.#e.value.resources,pose:p("idle",null)},map:{...this.#e.value.map,exactPose:!1}}),this.#le("pose",i);return}this.#ie("pose",i);let r=this.#e.value,l=r.resources.pose.value,c=!!(r.map.exactPose&&l?.position&&l.mapSessionKey===i.mapSessionKey);if(n.position===null&&c){this.#e.patch({resources:{...r.resources,pose:p("ready",l)}});return}this.#e.patch({resources:{...r.resources,pose:p("ready",n)},map:{...r.map,exactPose:n.position!==null}})}catch(n){if(L(n)||!this.#t.accepts(e))return;let o=this.#e.value,i=o.resources.pose.value,r=!!(o.map.exactPose&&i?.position&&i.mapSessionKey===o.resources.entry?.mapSessionKey);this.#e.patch({resources:{...o.resources,pose:p("error",r?i:null,F(n,"pose-unavailable"))},map:{...o.map,exactPose:r}})}finally{if(this.#E("pose",s),this.#q=!1,this.#R&&!this.#a&&this.#W&&this.#s?.host.connected&&this.#s.host.administrator&&this.#s.host.robotCount>0){this.#R=!1;let n=this.#e.value.resources.entry,o=this.#t.current();n&&o&&this.#de(n,o)}else this.#R=!1}}async selectFloor(t){let e=this.#e.value.resources.history.value,s=this.#e.value.resources.entry;if(!e||!s)return;let n=e.floors.find(l=>l.id===t);if(!n&&t!=="current")return;let o=this.#e.value;if(o.workflow==="draw"&&(o.draw.dirty||o.areaDraft.dirty)||o.workflow==="areaReview"&&(o.draw.dirty||o.areaDraft.dirty))return;if(!n||n.active){this.#I(),this.#S="";let l=this.#e.value;this.#e.patch({resources:{...l.resources,plans:p("idle",null),areas:p("idle",null),scene:p("idle",l.resources.scene.value),pose:p("idle",null)},map:{...l.map,available:l.resources.scene.value!==null,exactPose:!1},coherence:"verifying",floor:{...l.floor,readOnly:l.resources.scene.value!==null},workflow:"none",precisionOpen:!1}),this.#e.dispatch({type:"set-floor",floorId:"current"}),await this.refreshCatalog(!0);return}this.#I();let i=n.snapshots.at(-1),r=this.#t.begin(s.entryId,n.id,i?.id||n.id,i?.revision||0);this.#U(["catalog"]),this.#e.patch({generation:r.generation,coherence:"current",dataMode:"history",floor:{classifiedCount:e.floors.length,displayName:je(n,e.floors.indexOf(n)+1),readOnly:!0},selection:{...this.#e.value.selection,floorId:n.id,historyId:i?.id||null},resources:{...this.#e.value.resources,scene:p(i?"loading":"empty",null),pose:p("idle",null),plans:p("idle",null),areas:p("idle",null)},workflow:"none",precisionOpen:!1,map:{available:!1,complete:!0,floorCoherent:!0,sessionVerified:!0,exactPose:!1}}),i&&await this.#ve(i,r)}async selectHistory(t){let e=this.#e.value.resources.history.value,s=this.#e.value.resources.entry;if(!e||!s)return;if(!t){await this.selectFloor("current");return}let n=e.floors.find(r=>r.snapshots.some(l=>l.id===t)),o=n?.snapshots.find(r=>r.id===t);if(!n||!o)return;this.#I();let i=this.#t.begin(s.entryId,n.id,o.id,o.revision);this.#U(["catalog"]),this.#e.patch({generation:i.generation,dataMode:"history",floor:{classifiedCount:e.floors.length,displayName:je(n,e.floors.indexOf(n)+1),readOnly:!0},selection:{...this.#e.value.selection,floorId:n.id,historyId:o.id},resources:{...this.#e.value.resources,scene:p("loading",null),pose:p("idle",null)},map:{...this.#e.value.map,available:!1,exactPose:!1}}),await this.#ve(o,i)}async#ve(t,e){if(!this.#r.active)return;let s=this.#P("history-scene");try{let n=await this.#n.scene(t.sceneUrl,t.revision,!0,"history",s.signal);if(!this.#t.accepts(e)||!n.scene)return;this.#e.patch({resources:{...this.#e.value.resources,scene:p("ready",n.scene)},map:{...this.#e.value.map,available:!0,exactPose:!1}})}catch(n){if(L(n)||!this.#t.accepts(e))return;this.#e.patch({resources:{...this.#e.value.resources,scene:p("error",null,F(n,"history-scene-unavailable"))}})}finally{this.#E("history-scene",s)}}async openWorkflow(t){let e=this.#e.value;if((e.dataMode==="history"||e.floor.readOnly)&&pn.includes(t))return;let s=this.#e.value.workflow;if(t==="draw"&&s!=="draw"&&s!=="areaReview"&&this.selectArea(null),this.#e.dispatch({type:"open-workflow",workflow:t}),t==="history"){let n=this.#e.value.resources.entry,o=this.#t.current();n&&o&&(this.#e.patch({resources:{...this.#e.value.resources,history:p("loading",this.#e.value.resources.history.value)}}),await this.#G(n,o))}(t==="plans"||t==="plan"||t==="rooms")&&await this.loadPlans(),(t==="draw"||t==="areaReview")&&await this.loadAreas()}async loadPlans({force:t=!1}={}){if(!this.#r.active){this.#o.get("plans")?.abort();let o=this.#e.value.resources;return this.#e.patch({resources:{...o,plans:p("idle",o.plans.value)}}),null}let e=this.#e.value.resources.entry;if(!e||!this.#t.current()||!Ze(this.#e.value)||!t&&this.#e.value.resources.plans.status==="loading")return null;let s=N(e),n=this.#P("plans");this.#e.patch({resources:{...this.#e.value.resources,plans:p("loading",null)}});try{let o=await this.#n.plans(e.plansUrl,n.signal),i=this.#e.value.resources.entry;if(n.signal.aborted||this.#a||!i||N(i)!==s)return null;let r=this.#e.value;if(r.planDraft.dirty||r.workflow==="plan"&&(!r.planDraft.id||r.command==="pending"))return this.#e.patch({resources:{...this.#e.value.resources,plans:p("ready",o)}}),o;let l=r.workflow==="plan"?r.selection.planId:o.selectedPlan||o.plans[0]?.id||null,c=o.plans.find(d=>d.id===l);return this.#e.patch({resources:{...this.#e.value.resources,plans:p("ready",o)},selection:{...this.#e.value.selection,planId:l},planDraft:c?Je(c):{...this.#e.value.planDraft,id:null,name:"",rooms:[],dirty:!1}}),o}catch(o){let i=this.#e.value.resources.entry;if(L(o)||n.signal.aborted||this.#a||!i||N(i)!==s)return null;let r=o instanceof x&&o.code==="map-rechecking"?"map-rechecking":F(o,"plans-unavailable");return this.#e.patch({resources:{...this.#e.value.resources,plans:p("error",null,r)}}),null}finally{this.#E("plans",n)}}selectPlan(t,e=!1){let s=this.#e.value.resources.plans.value?.plans.find(n=>n.id===t);this.#e.patch({workflow:"plan",notice:!e&&this.#e.value.notice?.tone==="success"?null:this.#e.value.notice,selection:{...this.#e.value.selection,planId:t},planDraft:s?Je(s):{...H().planDraft}})}#ye(){let t=this.#e.value;(t.workflow==="draw"||t.workflow==="areaReview")&&t.resources.areas.status==="idle"&&this.loadAreas()}async loadAreas({reconcileDraft:t=!0}={}){if(!this.#r.active){this.#o.get("areas")?.abort();let o=this.#e.value.resources;return this.#e.patch({resources:{...o,areas:p("idle",o.areas.value)}}),null}let e=this.#e.value.resources.entry;if(!e||!this.#t.current()||!Ze(this.#e.value))return null;let s=N(e),n=this.#P("areas");this.#e.patch({resources:{...this.#e.value.resources,areas:p("loading",null)}});try{let o=await this.#n.areas(e.areasUrl,n.signal),i=this.#e.value.resources.entry;if(n.signal.aborted||this.#a||!i||N(i)!==s)return null;if(o.sceneUrl!==i.sceneUrl)throw new x("areas-unavailable");this.#e.patch({resources:{...this.#e.value.resources,areas:p("ready",o)}});let r=this.#e.value.selection.areaId,l=this.#e.value,c=o.areas.some(d=>d.id===r);return t&&r!==null&&!c&&(l.draw.dirty||l.areaDraft.dirty)?this.#e.patch({selection:{...l.selection,areaId:null},areaDraft:{...l.areaDraft,id:null,status:"new",canRebind:!1,dirty:!0},notice:P.areaRemoved}):t&&!l.draw.dirty&&!l.areaDraft.dirty&&this.selectArea(c?r:null),o}catch(o){let i=this.#e.value.resources.entry;return L(o)||n.signal.aborted||this.#a||!i||N(i)!==s||this.#e.patch({resources:{...this.#e.value.resources,areas:p("error",null,F(o,"areas-unavailable"))}}),null}finally{this.#E("areas",n)}}selectArea(t){let e=this.#e.value.resources.areas.value?.areas.find(n=>n.id===t),s=this.#e.value;this.#e.patch({selection:{...s.selection,areaId:t},areaDraft:e?this.#Re(e):{id:null,name:"",cleaningMode:"vacuum",coverageSetting:"standard",status:"new",canRebind:!1,dirty:!1},draw:{...s.draw,circles:e?.circles||[],outline:e?.outline??null,outlineUndo:[],outlineRedo:[],tool:!e||e.outline?"outline":"paint",undo:[],redo:[],dirty:!1,strokeCount:0}})}#Re(t){return{id:t.id,name:t.name,cleaningMode:t.cleaningMode,coverageSetting:t.coverageSetting,status:t.status,canRebind:t.canRebind,dirty:!1}}async saveArea(){let t=this.#e.value,e=t.resources.entry,s=t.areaDraft;if(!e||t.command==="pending"||!he(t)||!s.name.trim()||!t.draw.circles.length)return;let n=this.#P("area-mutation"),o=()=>!this.#a&&!n.signal.aborted;this.#e.patch({command:"pending",notice:P.areaSaving});try{let i=await this.#n.saveArea(e.areasUrl,{areaId:s.id,name:s.name.trim(),circles:t.draw.circles,outline:t.draw.outline??null,cleaningMode:s.cleaningMode,coverageSetting:s.coverageSetting},n.signal);if(!o())return;let r=this.#e.value,c=r.areaDraft===s&&r.draw.circles===t.draw.circles&&r.draw.outline===t.draw.outline&&r.selection.entryId===t.selection.entryId&&(r.workflow==="draw"||r.workflow==="areaReview")?{...s,id:i,name:s.name.trim(),status:"current",canRebind:!1,dirty:!1}:null;this.#e.patch({command:"idle",notice:P.areaSaved,...c?{dialog:r.dialog==="discardDraft"?null:r.dialog,selection:{...r.selection,areaId:i},areaDraft:c,draw:{...r.draw,dirty:!1,strokeCount:0,undo:[],redo:[],outlineUndo:[],outlineRedo:[]}}:{}});let d=await this.loadAreas({reconcileDraft:!1}),u=this.#e.value;o()&&c&&u.areaDraft===c&&!u.draw.dirty&&(u.workflow==="draw"||u.workflow==="areaReview")&&u.selection.entryId===t.selection.entryId&&d&&u.resources.areas.value===d&&d.areas.some(m=>m.id===i)&&this.selectArea(i)}catch(i){if(L(i)||!o())return;this.#e.patch({command:"failed",notice:P.areaSaveFailed})}finally{this.#E("area-mutation",n)}}async deleteArea(){let t=this.#e.value.resources.entry,e=this.#e.value.selection.areaId;if(!t||!e||this.#e.value.command==="pending"||!he(this.#e.value))return;let s=this.#P("area-mutation"),n=()=>!this.#a&&!s.signal.aborted;this.#e.patch({command:"pending",notice:null});try{if(await this.#n.deleteArea(t.areasUrl,e,s.signal),!n())return;this.#e.patch({command:"idle",notice:P.areaDeleted}),await this.loadAreas()}catch(o){!L(o)&&n()&&this.#e.patch({command:"failed",notice:P.areaDeleteFailed})}finally{this.#E("area-mutation",s)}}async savePlan(){let t=this.#e.value,e=t.planDraft,s=t.resources.plans.value;if(!s||!e.name.trim()||!e.rooms.length||!he(t))return;let n=e.rooms,o=e.id;if(await this.#ue("save_plan",{...e.id?{plan_id:e.id}:{},name:e.name.trim(),enabled:e.enabled,run_behavior:e.runBehavior,rooms:n.map(r=>({room:r.roomId,cleaning_mode:r.cleaningMode,coverage_setting:r.coverageSetting,...r.cadence?{cadence:{scope:r.cadence.scope,mop_every_n:r.cadence.mopEveryN,coverage_every_n:r.cadence.coverageEveryN,periodic_coverage_setting:r.cadence.periodicCoverageSetting,do_mop_next:r.cadence.doMopNext,do_coverage_next:r.cadence.doCoverageNext}}:{}})),return_to_base:e.returnToBase,finish_current_room:e.finishCurrentRoom,finish_current_room_threshold:e.finishCurrentRoomThreshold,select:!e.id||s.selectedPlan===e.id},P.planSaved,P.planSaveFailed,r=>{let l=r===void 0&&e.id?e.id:Bt(r);if(e.id&&l!==e.id)throw new x("invalid-plan-save-response");o=l})){let r=this.#e.value.workflow==="plan"&&this.#e.value.planDraft===e?{...e,id:o,dirty:!1}:null;r&&this.#e.patch({planDraft:r,selection:{...this.#e.value.selection,planId:o}});let l=await this.loadPlans({force:!0});r&&this.#e.value.workflow==="plan"&&this.#e.value.planDraft===r&&this.#e.value.selection.entryId===t.selection.entryId&&l&&this.#e.value.resources.plans.value===l&&o&&l.plans.some(c=>c.id===o)&&this.selectPlan(o,!0)}}async deletePlan(){let t=this.#e.value.selection.planId,e=this.#e.value.selection.entryId;if(!t)return;if(await this.#ue("delete_plan",{plan:t},P.planDeleted,P.planDeleteFailed)){let n=this.#e.value;n.selection.entryId===e&&n.planDraft.id===t&&(this.#e.patch({selection:{...n.selection,planId:null},planDraft:H().planDraft}),n.workflow==="plan"&&this.#e.patch({workflow:"plans",precisionOpen:!1})),await this.loadPlans({force:!0})}}async executeAction(t){switch(typeof t=="string"?t:t.id){case"recheck-status":{let s=this.#e.value.selection.entryId;await this.refreshCatalog(!0);let n=this.#e.value;!this.#a&&n.selection.entryId===s&&n.resources.catalog.status==="ready"&&n.host.connected&&n.host.robotConnected&&n.coherence==="current"&&n.command==="failed"&&this.#e.patch({command:"idle",notice:P.statusRefreshed});return}case"stop":await this.#re("matic_robot","stop_intelligent_cleaning",{include_unmanaged:!0});return;case"resume":await this.#re("vacuum","send_command",{command:"resume"});return;case"run-plan":{let s=this.#e.value,n=s.selection.planId||s.resources.plans.value?.selectedPlan;if(!n||s.workflow!=="plan"||!s.planDraft.enabled||s.resources.plans.status!=="ready"||s.command!=="idle"||!Ce(s))return;let o=s.selection.entryId,i=s.generation,r=s.selection.planId,l=s.planDraft,c=s.resources.plans.value?.plans.find(f=>f.id===n)?.nextRunPreview;if(!c||!/^[0-9a-f]{64}$/u.test(c.previewToken??"")){this.#e.patch({notice:P.planPreviewMissing});return}this.#e.patch({command:"pending",notice:null});let d=this.#P("plan-preflight");try{await this.loadPlans()}finally{this.#E("plan-preflight",d)}let u=this.#e.value,m=()=>{let f=this.#e.value;!this.#a&&f.selection.entryId===o&&f.generation===i&&f.command==="pending"&&this.#e.patch({command:"idle"})};if(d.signal.aborted||this.#a||u.selection.entryId!==o||u.generation!==i||u.workflow!=="plan"||u.selection.planId!==r||(u.selection.planId||u.resources.plans.value?.selectedPlan)!==n||u.planDraft!==l){m();return}if(u.resources.plans.status!=="ready"){m(),this.#e.patch({notice:P.planPreviewRefreshFailed});return}let h=u.resources.plans.value?.plans.find(f=>f.id===n)?.nextRunPreview;if(!h||h.blocker||!/^[0-9a-f]{64}$/u.test(h.previewToken??"")){m(),this.#e.patch({notice:P.planPreviewNone});return}if(!c||JSON.stringify(c)!==JSON.stringify(h)){m(),this.#e.patch({notice:P.planPreviewChanged});return}m(),await this.#re("matic_robot","run_selected_plan",{plan:n,preview_token:h.previewToken});return}case"clean-rooms":{await this.#Se();return}case"run-area":{let s=this.#e.value.selection.areaId;s&&await this.#re("matic_robot","clean_area",{area:s});return}case"review-area":this.#e.dispatch({type:"open-workflow",workflow:"areaReview"});return;case"save-area":await this.saveArea();return;case"save-plan":await this.savePlan();return;case"delete-plan":await this.deletePlan();return;case"delete-area":await this.deleteArea();return;case"reset-room-cadence":{if(typeof t=="string")return;let s=this.#e.value;if(s.selection.planId!==t.planId||s.planDraft.dirty||s.dataMode!=="live"||s.command!=="idle"||s.activity!=="idle"&&s.activity!=="docked"||!await this.#ue("reset_room_cadence",{plan:t.planId,room_id:t.roomId,modes:[t.mode]},t.mode==="mop"?P.resetMop:P.resetVacuum,t.mode==="mop"?P.resetMopFailed:P.resetVacuumFailed))return;let o=await this.loadPlans({force:!0}),i=this.#e.value;!this.#a&&i.selection.entryId===s.selection.entryId&&i.selection.planId===t.planId&&!i.planDraft.dirty&&o&&i.resources.plans.value===o&&this.selectPlan(t.planId,!0);return}}}async#Se(){if(this.#Y)return;let t=this.#e.value,e=this.#D(t),s=Qe(t);if(!e||!s||s.key!==e.key||s.generation!==e.generation||s.floorKey!==e.floorKey||s.missionKey!==e.missionKey||s.preview.entryId!==e.entryId||s.preview.blocker||s.preview.rooms.length===0)return;this.#Y=!0;let n=this.#P("room-preview");this.#O=this.#j(e),this.#e.patch({manualRoomPreview:p("loading",null),notice:null});try{let o=await this.#n.previewRoomSequence(e.entityId,e.rooms,e.overrideRoomSchedule,n.signal);if(n.signal.aborted||!this.#A(e)||o.entryId!==e.entryId)return;let i={key:e.key,generation:e.generation,floorKey:e.floorKey,missionKey:e.missionKey,preview:o};if(o.blocker||o.rooms.length===0){this.#e.patch({manualRoomPreview:p("ready",i),notice:P.roomPreviewBlocked});return}if(Is(s.preview)!==Is(o)){this.#e.patch({manualRoomPreview:p("ready",i),notice:P.roomPreviewChanged});return}if(this.#e.patch({manualRoomPreview:p("ready",i),notice:null}),!this.#A(e)||!Ce(this.#e.value))return;await this.#re("matic_robot","clean_room_sequence",{rooms:e.rooms,use_room_schedule:!0,override_room_schedule:e.overrideRoomSchedule,return_to_base:!0,preview_token:o.previewToken})}catch(o){!L(o)&&!n.signal.aborted&&this.#A(e)&&this.#e.patch({manualRoomPreview:p("error",null,F(o,"preview-unavailable")),notice:P.roomPreviewFailed})}finally{this.#E("room-preview",n),this.#Y=!1,this.#ee()}}async#ue(t,e,s,n,o){let i=this.#s?.vacuumEntityId;if(!i||!he(this.#e.value)||this.#e.value.command==="pending")return!1;let r=this.#P("plan-mutation"),l=this.#s?.entryKey,c=this.#s?.userKey,d=()=>!this.#a&&!r.signal.aborted&&l===this.#s?.entryKey&&c===this.#s?.userKey;this.#e.patch({command:"pending",notice:P.saving});try{let u=await this.#n.service("matic_robot",t,e,i,{acknowledgementTimeout:"mutation",...o?{returnResponse:!0}:{}});return d()?(o?.(u),this.#e.patch({command:"idle",notice:s}),!0):!1}catch{return d()&&this.#e.patch({command:"failed",notice:n}),!1}finally{this.#E("plan-mutation",r)}}async#re(t,e,s){let n=this.#e.value,o=this.#s?.vacuumEntityId,i=e==="stop_intelligent_cleaning"||t==="vacuum"&&e==="return_to_base",r=t==="vacuum"&&e==="send_command"&&s.command==="resume";if(!o||n.selection.entryId!==this.#s?.entryKey||(i?!Mt(n):r?!Et(n):!Ce(n)))return;let l=++this.#v,c=this.#s?.entryKey,d=()=>!this.#a&&l===this.#v&&c===this.#s?.entryKey,u=i?"settling":"starting";this.#d!==null&&window.clearTimeout(this.#d),this.#d=null,this.#e.patch({command:u,notice:null});try{if(await this.#n.service(t,e,s,o),!d())return;if(t==="matic_robot"&&(e==="clean_room_sequence"||e==="run_selected_plan")){this.#e.patch({command:"idle"}),this.refreshCatalog(!0);return}this.#e.patch({command:u}),this.#d!==null&&window.clearTimeout(this.#d),this.#d=window.setTimeout(()=>{this.#d=null,d()&&this.#e.value.command===u&&this.#e.patch({command:"idle"})},15e3)}catch(m){if(!d())return;this.#e.patch({command:"failed",notice:i?P.stopUnconfirmed:dn(m)??P.actionUnconfirmed})}}dispose(){this.#a||(this.#a=!0,this.#r.dispose(),this.#L(!1),this.#$?.(),this.#$=null,this.#e.patch({manualRoomPreview:p("idle",null)}),this.#X(),this.#U(),this.#d!==null&&window.clearTimeout(this.#d),this.#d=null,this.#l.dispose(),this.#ge(),this.#n.dispose())}#ge(){this.#_?.dispose(),this.#_=null,this.#T=null,this.#w=null}};var $s=a=>(a.workflow==="none"?0:a.workflow==="plan"?2:1)+(a.fullMap?1:0)+(a.precisionOpen?1:0)+(a.dialog?1:0),Os=a=>{if(!a||typeof a!="object")return null;let t=a.maticMapLayer;if(!t||typeof t!="object")return null;let e=t.owner,s=t.depth;return typeof e=="string"&&Number.isInteger(s)&&Number(s)>=0?{owner:e,depth:Number(s)}:null},Xe=class{#e;#t=`matic-map-${crypto.randomUUID?.()||Math.random().toString(36).slice(2)}`;#n=0;#r=null;#l=!1;#i=!1;constructor(t){this.#e=t}start(){this.#r||(this.#n=$s(this.#e.value),this.#r=this.#e.subscribe(t=>this.#o(t)),window.addEventListener("popstate",this.#s))}#o(t){let e=$s(t);if(this.#l){this.#l=!1,this.#n=e;return}if(e<this.#n){let s=Os(history.state);if(s?.owner===this.#t&&s.depth===this.#n){let n=e-this.#n;this.#n=e,this.#i=!0,history.go(n);return}}if(e>this.#n)for(let s=this.#n+1;s<=e;s+=1){let n=history.state&&typeof history.state=="object"?history.state:{};history.pushState({...n,maticMapLayer:{owner:this.#t,depth:s}},"",window.location.href)}this.#n=e}#s=()=>{if(this.#i){this.#i=!1;return}if(!(this.#n<1)){if(se(this.#e.value,{type:"dismiss-top-layer"})){let t=history.state&&typeof history.state=="object"?history.state:{};history.pushState({...t,maticMapLayer:{owner:this.#t,depth:this.#n}},"",window.location.href),this.#e.dispatch({type:"open-dialog",dialog:"discardDraft"});return}this.#l=!0,this.#e.dispatch({type:"dismiss-top-layer"})}};dismissTop(){if(this.#n<1)return!1;let t=Os(history.state);return t?.owner===this.#t&&t.depth===this.#n?history.back():this.#e.dispatch({type:"dismiss-top-layer"}),!0}dispose(){this.#r?.(),this.#r=null,window.removeEventListener("popstate",this.#s),this.#n=0,this.#i=!1}};var Ds=[Te,Ae,Vt,Pe`
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
  `];var Ls=re(Ie),Ge=re(It),qs=re(pe),Ns=a=>a.dataMode==="history"||a.floor.readOnly,Ws=(a,t)=>{let e=(r,l,c)=>ve(t,r,l,c);if(!a.host.connected)return{title:e("v4_reconnecting","Reconnecting"),detail:e("v4_ha_offline","Home Assistant is offline"),icon:V,notable:!0};if(!a.host.administrator)return{title:e("v4_access_required","Access required"),detail:e("v4_admin_only","Administrator only"),icon:V,notable:!0};if(a.host.robotCount===0)return{title:e("v4_no_robot_short","No robot"),detail:e("v4_set_up_robot","Set up a Matic robot"),icon:V,notable:!0};if(Me(a))return{title:e("v4_selected_robot_unavailable","Selected robot unavailable"),detail:e("v4_choose_another_robot","Choose another robot to open its map."),icon:V,notable:!0};if(!a.host.robotConnected)return{title:e("v4_robot_offline","Robot offline"),detail:e("v4_last_map_read_only","Last verified map \xB7 read only"),icon:V,notable:!0};if(a.activity==="problem")return{title:e("v4_needs_attention","Needs attention"),detail:e("v4_check_robot","Check the robot"),icon:V,notable:!0};if(a.dataMode==="history"){let r=a.resources.history.value?.floors.find(d=>d.id===a.selection.floorId),l=r?.snapshots.findIndex(d=>d.id===a.selection.historyId)??-1,c=r?.snapshots.length??0;return{title:e("v4_saved_map","Saved map"),detail:l>=0?e("v4_read_only_position","Read only \xB7 {position} of {count}",{position:l+1,count:c}):e("v4_read_only","Read only"),icon:st,notable:!1}}if(a.coherence==="verifying"||a.coherence==="booting")return{title:e("v4_locating","Locating"),detail:e("v4_finding_map","Finding the current map"),icon:ye,notable:!0};if((a.resources.entry?.activePlan||a.resources.entry?.runnerLocked)&&(a.activity==="idle"||a.activity==="docked"))return{title:e("v4_task_in_progress","Task in progress"),detail:a.coherence==="unavailable"||a.coherence==="blocked"?e("v4_task_map_unavailable","The live map is unavailable; the current task remains in progress."):a.activity==="docked"?e("v4_task_docked","Robot docked; the cleaning task has not finished."):e("v4_task_waiting","Waiting for the cleaning task to continue or finish."),icon:nt,notable:!0};if(a.command==="starting"&&(a.activity==="idle"||a.activity==="docked"))return{title:e("v4_action_starting","Starting"),detail:e("v4_action_starting_detail","Waiting for the robot to begin"),icon:ye,notable:!0};let s=a.coherence==="unavailable"||a.coherence==="blocked",n=e("v4_active_map_unavailable","The live map is unavailable; new cleaning is disabled."),o=r=>s?`${r} \xB7 ${n}`:r;if(a.activity==="cleaning")return{title:e("v4_cleaning","Cleaning"),detail:o(e("v4_cleaning_progress","Cleaning in progress")),icon:rt,notable:!0};if(a.activity==="recharging"){let r=a.batteryPercent===null?e("v4_recharging_detail","Will resume automatically when ready"):e("v4_recharging_battery","Charging to resume \xB7 {percent}% battery",{percent:a.batteryPercent});return{title:e("v4_recharging","Charging to resume"),detail:o(r),icon:Zt,notable:!0}}if(a.activity==="paused")return{title:e("v4_paused","Paused"),detail:o(e("v4_can_resume","Cleaning can resume")),icon:it,notable:!0};if(a.activity==="returning")return{title:e("v4_returning","Returning"),detail:o(e("v4_going_dock","Going to the dock")),icon:rt,notable:!0};if(a.activity==="stopping")return{title:e("v4_stopping","Stopping"),detail:o(e("v4_waiting_robot","Waiting for the robot")),icon:it,notable:!0};if(s)return{title:e("v4_map_unavailable","Map unavailable"),detail:e("v4_map_unavailable_status","New cleaning is disabled until the live map is verified."),icon:V,notable:!0};let i=a.batteryPercent===null?e("v4_ready","Ready"):e("v4_battery","{percent}% battery",{percent:a.batteryPercent});return{title:a.activity==="docked"?e("v4_docked","Docked"):e("v4_ready","Ready"),detail:i,icon:ye,notable:!1}},zs=(a,t)=>{let e=(s,n)=>ve(t,s,n);switch(a.workflow){case"rooms":return{title:e("v4_choose_rooms","Choose rooms"),description:e("v4_choose_rooms_detail","Select on the map or from the list.")};case"draw":return{title:e("v4_draw_area","Draw an area"),description:e("v4_draw_area_detail","Outline or paint the area, then review it before saving.")};case"plans":return{title:e("v4_your_plans","Your plans"),description:e("v4_choose_plan_detail","Choose a plan to edit or run, or create a new one.")};case"plan":return{title:a.planDraft.id?e("v4_edit_plan","Edit plan"):e("v4_create_plan","Create a plan"),description:e("v4_plan_detail","Review rooms and cleaning settings.")};case"areaReview":return{title:e("v4_name_this_area","Name this area"),description:e("area_details_hint","Name the area and choose cleaning settings.")};case"history":return{title:e("v4_map_history","Map history"),description:e("v4_map_history_detail","Saved maps are floor-scoped and read only.")};case"support":return{title:e("v4_map_diagnostics","Map diagnostics"),description:e("v4_map_support_detail","Private geometry is never included.")};case"none":return Ns(a)?{title:e("v4_saved_map_read_only_title","Saved map is read only"),description:a.dataMode==="live"?e("v4_map_recovery_automatic","Cleaning controls return automatically when the live map is verified."):e("v4_saved_map_read_only_detail","Return to the live map to choose rooms, run a plan, or draw a custom area.")}:{title:e("v4_what_to_clean","What should the robot clean?"),description:e("v4_clean_detail","Choose rooms, a saved plan, or a custom area.")}}},Y=["peek","half","full"],mn={info:ot,success:ts,warning:ss,error:ns},fn={info:6e3,success:4e3,warning:6e3,error:1e4},Bs={none:"half",rooms:"half",draw:"peek",plan:"full",plans:"full",areaReview:"half",history:"half",support:"full"},vn=.5,yn=100,gn=6,bn=48,wn=["a[href]","button","input","label","select","textarea","summary",'[contenteditable]:not([contenteditable="false"])','[role="button"]','[role="link"]','[role="slider"]','[role="checkbox"]','[role="radio"]','[role="switch"]','[role="tab"]','[role="menuitem"]','[tabindex]:not([tabindex="-1"])'].join(","),_n=["button:not(:disabled)","a[href]","input:not(:disabled)","select:not(:disabled)","textarea:not(:disabled)","[tabindex]:not([tabindex='-1'])"].join(", "),kn=(a,t,e=!1,s="room",n=!1,o="mop",i="")=>{let r=(l,c,d)=>ve(t,l,c,d);switch(a){case"discardDraft":return{title:e?r("v4_discard_plan","Discard plan changes?"):r("v4_discard_area","Discard area changes?"),detail:e?r("v4_discard_plan_detail","Your plan changes have not been saved. Keep editing or discard them."):r("v4_discard_area_detail","Your area changes have not been saved. Keep editing or discard them."),cancelLabel:r("v4_keep_area_editing","Keep editing"),confirmLabel:r("v4_discard","Discard"),action:"discard"};case"confirmDeletePlan":return{title:r("v4_delete_plan","Delete this plan?"),detail:r("v4_delete_plan_detail","This removes the saved plan from Home Assistant. The robot will not move."),cancelLabel:r("v4_cancel","Cancel"),confirmLabel:r("v4_delete_plan_label","Delete plan"),action:"delete-plan"};case"confirmDeleteArea":return{title:r("v4_delete_area","Delete this area?"),detail:r("v4_delete_area_detail",`Automations that clean "{name}" will stop working, and the robot won't move.`,{name:i}),cancelLabel:r("v4_cancel","Cancel"),confirmLabel:r("v4_delete_area_label","Delete area"),action:"delete-area"};case"confirmResetCadence":return{title:o==="mop"?r("v4_reset_mop_cadence_title","Reset mopping progress?"):r("v4_reset_coverage_cadence_title","Reset vacuum rotation progress?"),detail:n?r("v4_reset_shared_cadence_detail","The count for {room} starts again in every plan that shares its schedule, and work brought forward to the next clean goes back to its schedule. Other work and cleaning history don't change.",{room:s}):r("v4_reset_private_cadence_detail","The count for {room} starts again in this plan only, and work brought forward to the next clean goes back to its schedule. Other work and cleaning history don't change.",{room:s}),cancelLabel:r("v4_cancel","Cancel"),confirmLabel:r("v4_reset","Reset"),action:"reset-room-cadence"};case"confirmStop":return{title:r("v4_stop_cleaning","Stop cleaning?"),detail:r("v4_stop_cleaning_detail","The robot may take a moment to settle before another action is available."),cancelLabel:r("v4_keep_cleaning","Keep cleaning"),confirmLabel:r("v4_stop","Stop"),action:"stop"};case"error":return{title:r("v4_error","Something went wrong"),detail:r("v4_error_detail","No action was started. Close this message and try again when the map is ready."),cancelLabel:r("v4_close","Close"),confirmLabel:r("v4_close","Close"),action:null};case null:return null}},Rn=(a=document)=>{let t=a.activeElement;for(;t?.shadowRoot?.activeElement;)t=t.shadowRoot.activeElement;return t},ft=a=>!!(a&&a.isConnected&&a.offsetParent!==null),vt=class extends xe{constructor(){super();this.state=H();this._measuredNarrow=!1;this._sheetOffset=0;this._overflowOpen=!1;this._helpOpen=!1;this._browserFullscreen=!1;this._sheetDetent="half";this._polite="";this._alert="";this.#t=null;this._toast=null;this._workflowLoadFailed=!1;this.#r=0;this.#l=0;this.#i=!1;this.#o=!1;this.#s=null;this.#u=null;this.#f=null;this.#d=null;this.#v=null;this.#b=null;this.#g=null;this.#m=null;this.#c=null;this.#y=null;this.#M=null;this.#R=()=>{this._browserFullscreen=this.#S()};this.#h=e=>{if(!this._overflowOpen)return;let s=this.renderRoot.querySelector(".overflow-wrap");(!s||!e.composedPath().includes(s))&&(this._overflowOpen=!1)};this.#a=()=>{this.#H(),this.#i=!1,this.#o=!1,this._toast=null};this.#W=e=>{e.type==="pointerenter"?this.#i=!0:this.#o=!0,this.#n!==void 0&&(this.#H(),this.#l=Math.max(0,this.#r-Date.now()))};this.#_=e=>{e.type==="pointerleave"?this.#i=!1:e.currentTarget.contains(e.relatedTarget)||(this.#o=!1),this.#N()};this.#T=()=>{this.#a(),this.updateComplete.then(()=>this.#O())};this.#w=()=>{this.#p({type:"set-notice",notice:null}),this.updateComplete.then(()=>this.#O())};this.#Se=()=>{this._workflowLoadFailed=!1,this.#Re()};new is(this,{container:()=>this.renderRoot?.querySelector(".draw-tools")??null,items:"button"})}static{this.properties={state:{attribute:!1},localize:{attribute:!1},_measuredNarrow:{state:!0},_sheetOffset:{state:!0},_overflowOpen:{state:!0},_helpOpen:{state:!0},_browserFullscreen:{state:!0},_sheetDetent:{state:!0},_polite:{state:!0},_alert:{state:!0},_toast:{state:!0},_workflowLoadFailed:{state:!0}}}static{this.styles=Ds}#e(e,s,n){return ve(this.localize,e,s,n)}#t;#n;#r;#l;#i;#o;#s;#u;#f;#d;#v;#b;#g;#m;#c;#y;#M;#q(){let e=this.renderRoot;return e instanceof ShadowRoot?e.fullscreenElement??document.fullscreenElement:document.fullscreenElement}#R;#S(){let e=this.renderRoot,s=e.querySelector(".app"),n=e instanceof ShadowRoot?e.fullscreenElement:null;if(n)return n===s;let o=document.fullscreenElement;for(let i=this;i;){if(i===o)return!0;let r=i.getRootNode();i=r instanceof ShadowRoot?r.host:null}return!1}#h;connectedCallback(){super.connectedCallback(),this.#u=new ResizeObserver(([e])=>{if(!e)return;let s=e.contentRect.width<1024||e.contentRect.height<480;s!==this._measuredNarrow&&(this._measuredNarrow=s)}),this.#u.observe(this),window.addEventListener("pointerdown",this.#h,!0),document.addEventListener("fullscreenchange",this.#R),this.#f=new ResizeObserver(([e])=>{if(!e)return;let s=Math.ceil(e.target.getBoundingClientRect().height);s!==this._sheetOffset&&(this._sheetOffset=s)})}disconnectedCallback(){this.#a(),this.#u?.disconnect(),this.#u=null,this.#f?.disconnect(),this.#f=null,this.#d=null,window.removeEventListener("pointerdown",this.#h,!0),document.removeEventListener("fullscreenchange",this.#R),super.disconnectedCallback()}#x(e,s){if(this[e]!==s){this[e]=s;return}this[e]="",this.updateComplete.then(()=>{this[e]||(this[e]=s)})}willUpdate(e){let s=this.shadowRoot?.activeElement??null;if(this.#s=["[data-notice-slot]","[data-notice-toast]"].find(o=>s?.closest(o))??null,e.has("state")||e.has("localize")){let o=Ws(this.state,this.localize).title;this.#t!==null&&o!==this.#t&&this.#x("_polite",o),this.#t=o}if(!e.has("state"))return;let n=this.state.notice;n!==e.get("state")?.notice&&(this.#a(),n&&(this._toast=n,this.#l=fn[n.tone],this.#x(n.tone==="error"?"_alert":"_polite",this.#e(n.key,n.fallback,n.placeholders)),this.updateComplete.then(()=>{if(this.state.notice!==n)return;let o=this.renderRoot.querySelector("[data-notice-toast]");this.#i=!!o?.matches(":hover"),this.#o=!!o?.contains(this.shadowRoot?.activeElement??null),this.#N()})))}#N(){!this._toast||this.#n!==void 0||this.#i||this.#o||(this.#r=Date.now()+this.#l,this.#n=setTimeout(this.#a,this.#l))}#H(){clearTimeout(this.#n),this.#n=void 0}#a;#W;#_;#T;#w;#$(e,s){return b`${I(mn[e.tone])}<span class="notice-text">${this.#e(e.key,e.fallback,e.placeholders)}</span><button
      class="ms-btn ms-btn--icon"
      type="button"
      aria-label=${this.#e("v4_close","Close")}
      @click=${s}
    >${I(es)}</button>`}updated(e){let s=e;if(this.#s){let o=this.renderRoot.querySelector(this.#s);this.#s=null,(!o||o.hidden)&&this.#O()}let n=this.renderRoot.querySelector(".mobile-sheet");if(n!==this.#d&&(this.#f?.disconnect(),this.#d=n,n?this.#f?.observe(n):this._sheetOffset!==0&&(this._sheetOffset=0)),s.has("_overflowOpen")&&this._overflowOpen&&this.updateComplete.then(()=>{this.renderRoot.querySelector("#map-options select, #map-options button")?.focus()}),s.has("_helpOpen")){if(this._helpOpen)this.updateComplete.then(()=>{this.renderRoot.querySelector(".help-dialog [data-dialog-initial-focus]")?.focus()});else if(s.get("_helpOpen")){let o=this.#g;this.#g=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>o?.focus({preventScroll:!0}))})}}if(e.has("state")){let o=e.get("state");if(o?.precisionOpen&&!this.state.precisionOpen&&this.#Y()?.focus(),o?.fullMap&&!this.state.fullMap){let i=this.#b;this.#b=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>{(this.renderRoot.querySelector(".workspace-toggle")??this.renderRoot.querySelector(".nav--menu")??(i?.isConnected?i:null))?.focus({preventScroll:!0})})})}if(o&&!o.fullMap&&this.state.fullMap&&this.updateComplete.then(()=>{let i=this.#b;requestAnimationFrame(()=>{(this.renderRoot.querySelector(".workspace-toggle")??(i?.isConnected?i:null))?.focus({preventScroll:!0})})}),!o?.dialog&&this.state.dialog){let i=Rn(this.shadowRoot||document);i?.hasAttribute("data-dialog-launcher")&&(this.#v=i),this.updateComplete.then(()=>{(this.renderRoot.querySelector(".dialog [data-dialog-initial-focus]")??this.renderRoot.querySelector(".dialog button"))?.focus()})}else if(o?.dialog&&!this.state.dialog){o.dialog==="discardDraft"&&(this.#m=null,this.#D());let i=this.#v?.isConnected&&this.#v.hasAttribute("data-dialog-launcher")?this.#v:this.#ce(o.dialog);this.#v=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>i?.focus({preventScroll:!0}))})}o?o.workflow!==this.state.workflow&&(this._sheetDetent=Bs[this.state.workflow],this.updateComplete.then(()=>this.#O())):this._sheetDetent=Bs[this.state.workflow]}}#O(){let e=this.renderRoot.querySelector(".panel-heading h2");if(ft(e)){e.focus({preventScroll:!0});return}let s=this.renderRoot.querySelector(".action-bar .ms-btn--primary");ft(s)&&s.focus({preventScroll:!0})}#Y(){let e=this.renderRoot.querySelector(".draw-brush");return ft(e)?e:this.renderRoot.querySelector(Ie)?.shadowRoot?.querySelector(".draw-brush")??null}#p(e){if(se(this.state,e)){this.#m=e,this.#p({type:"open-dialog",dialog:"discardDraft"});return}this.dispatchEvent(new CustomEvent(at,{detail:e,bubbles:!0,composed:!0}))}#Q(e){if(e.enabled){if(e.id==="return-live"){this.#p({type:"set-history",historyId:null});return}if(e.id==="clear-draft"){this.#p({type:"clear-draft"});return}this.#A(e.id)}}#C(e,s){let n={type:"open-workflow",workflow:e};s instanceof HTMLElement&&se(this.state,n)&&(this.#v=s),this.#p(n)}#he(){let e=this.#m;this.#m=null,e?.type==="select-plan"||e?.type==="select-area"?(this.#p({type:"patch-plan-draft",patch:{dirty:!1}}),this.#p({type:"patch-area-draft",patch:{dirty:!1}}),this.#p({type:"dismiss-top-layer"})):this.#p({type:"discard-draft"}),e&&e.type!=="dismiss-top-layer"&&queueMicrotask(()=>this.dispatchEvent(new CustomEvent(at,{detail:e,bubbles:!0,composed:!0})))}#k(){this.#m=null,this.#j(),this.#D()}#D(){this.updateComplete.then(()=>{let e=this.renderRoot.querySelector(".floor-switcher");e&&(e.value=this.state.selection.floorId);let s=this.renderRoot.querySelector(".robot-switcher");s&&(s.value=this.state.selection.entryId??"")})}#j(){let e=this.state.dialog,s=e&&this.#v?.isConnected&&this.#v.hasAttribute("data-dialog-launcher")?this.#v:e?this.#ce(e):null;this.#p({type:"dismiss-top-layer"}),s&&requestAnimationFrame(()=>s.focus({preventScroll:!0}))}#A(e){this.dispatchEvent(new CustomEvent(as,{detail:typeof e=="string"?{id:e}:e,bubbles:!0,composed:!0}))}#ee(e){this.#p({type:"dismiss-top-layer"}),this.#A(e)}#pe(e){if(e.action==="discard"){this.#he();return}if(e.action==="delete-plan"||e.action==="delete-area"){this.#ee(e.action);return}if(e.action==="reset-room-cadence"){let s=this.state.cadenceResetRequest;this.#p({type:"dismiss-top-layer"}),s&&this.#A({id:"reset-room-cadence",planId:s.planId,roomId:s.roomId,mode:s.mode});return}this.#p({type:"dismiss-top-layer"}),e.action==="stop"&&this.#A("stop")}#z(e){e!==this._sheetDetent&&(this._sheetDetent=e,this.#x("_polite",e==="peek"?this.#e("v4_workspace_height_peek","Map workspace, peek height"):e==="half"?this.#e("v4_workspace_height_half","Map workspace, half height"):this.#e("v4_workspace_height_full","Map workspace, full height")))}#F(e,s=!1){let o=Y.indexOf(this._sheetDetent)+e;s&&o>=Y.length&&(o=0),o=Math.max(0,Math.min(Y.length-1,o)),this.#z(Y[o]??this._sheetDetent)}#te(e){let s=this.renderRoot.querySelector(".workspace")?.clientHeight??e.parentElement?.clientHeight??e.offsetHeight,n=parseFloat(getComputedStyle(this).fontSize)||16,o=[".sheet-grip",".sheet-tools",".action-bar"].map(l=>e.querySelector(l)?.offsetHeight??0).reduce((l,c)=>l+c,0)+n*.75,i=Math.min(s*.92,s-n*9),r=Math.min(s*.48,n*26,i);return{peek:Math.min(o,r),half:r,full:i}}#L(){return this.renderRoot.querySelector(".mobile-sheet")}#K(e){let s=e.currentTarget;for(let n of e.composedPath()){if(n===s)return!1;if(n instanceof Element&&n.matches(wn))return!0}return!1}#B(e){if(e.pointerType==="mouse"&&e.button!==0||this.#K(e))return;let s=this.#L();!s||this.#y||(this.#y={pointerId:e.pointerId,startY:e.clientY,startHeight:s.offsetHeight,heights:this.#te(s),samples:[{y:e.clientY,t:e.timeStamp}],moved:!1},e.currentTarget.setPointerCapture(e.pointerId),s.classList.add("dragging"))}#se(e){let s=this.#y;if(!s||e.pointerId!==s.pointerId)return;let n=this.#L();if(!n)return;let o=e.clientY-s.startY;for(!s.moved&&Math.abs(o)>gn&&(s.moved=!0),s.samples.push({y:e.clientY,t:e.timeStamp});s.samples.length>2&&e.timeStamp-(s.samples[1]?.t??0)>yn;)s.samples.shift();if(!s.moved)return;let i=s.startHeight-s.heights.full,r=s.startHeight-s.heights.peek,l=Math.max(i,Math.min(r,o));n.style.transform=`translateY(${l}px)`}#J(e){let s=this.#y;if(!s||e.pointerId!==s.pointerId)return;this.#y=null;let n=this.#L();if(n&&(n.style.transform="",n.classList.remove("dragging")),e.type==="pointercancel")return;if(!s.moved){this.#F(1,!0);return}let o=e.clientY-s.startY,i=Y.indexOf(this._sheetDetent),r=s.samples[0],l=s.samples[s.samples.length-1],c=r&&l&&l!==r?(l.y-r.y)/Math.max(1,l.t-r.t):0;if(Math.abs(c)>vn){let h=Math.max(0,Math.min(Y.length-1,i+(c<0?1:-1)));this.#z(Y[h]??this._sheetDetent);return}let d=s.startHeight-o,u=this._sheetDetent,m=Number.POSITIVE_INFINITY;for(let h of Y){let f=Math.abs(s.heights[h]-d);f<m&&(m=f,u=h)}this.#z(u)}#be(e){if(e.pointerType==="mouse"||this.#K(e))return;let s=e.currentTarget;this.#M={pointerId:e.pointerId,startY:e.clientY,atTop:s.scrollTop===0,consumed:!1}}#X(e){let s=this.#M;if(!s||s.consumed||!s.atTop||e.pointerId!==s.pointerId)return;if(e.currentTarget.scrollTop>0){this.#M=null;return}e.clientY-s.startY<bn||(s.consumed=!0,this.#F(-1))}#I(){this.#M=null}#ie(){this.dispatchEvent(new CustomEvent("hass-toggle-menu",{bubbles:!0,composed:!0}))}#ne(e){this.#b=e.currentTarget,this.#p({type:this.state.fullMap?"exit-full-map":"enter-full-map"})}#ae(e){this._overflowOpen=!1,e&&this.updateComplete.then(()=>{this.renderRoot.querySelector(".overflow")?.focus()})}#le(e){if(this.#ae(e==="fullscreen"),e==="support"){this.#C("support");return}let s=this.renderRoot.querySelector(".app");this.#q()?document.exitFullscreen():s?.requestFullscreen()}#me(){this.#p({type:"set-precision-open",value:!this.state.precisionOpen})}#fe(e){this.#g=e.currentTarget,this._helpOpen=!0}#we(e){let s=e;if(!Ee(s.detail))return;if(se(this.state,s.detail)){e.stopPropagation(),this.#p(s.detail);return}if(s.detail?.type!=="open-dialog")return;let n=s.composedPath().find(o=>o instanceof HTMLElement&&o.hasAttribute("data-dialog-launcher"));n instanceof HTMLElement&&(this.#v=n)}#ce(e){return this.renderRoot.querySelector(pe)?.shadowRoot?.querySelector(`[data-dialog-launcher="${e}"]`)??null}#P(e){if(!rs(e)&&!(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey)&&e.key==="Escape"){if(e.preventDefault(),this._overflowOpen){this.#ae(!0);return}if(this._helpOpen){this._helpOpen=!1;return}if(this.state.dialog==="discardDraft"){this.#k();return}this.#p({type:"dismiss-top-layer"})}}#E(e){if(e.key!=="Tab")return;let n=[...e.currentTarget.querySelectorAll(_n)],o=n[0],i=n.at(-1);if(!o||!i)return;let r=this.shadowRoot?.activeElement;e.shiftKey&&r===o?(e.preventDefault(),i.focus()):!e.shiftKey&&r===i&&(e.preventDefault(),o.focus())}#U(){let e=this.renderRoot.querySelector(Ie);(e?.shadowRoot?.querySelector(".map-root")??e)?.focus()}#_e(){this._sheetDetent==="peek"&&this.#L()&&this.#z("half"),this.updateComplete.then(()=>this.#O())}#V(e,s,n){if(e.id==="choose-cleaning")return R;let o=e.labelKey?this.#e(e.labelKey,e.label,e.labelPlaceholders):e.label,i=!e.enabled&&e.reason?e.reasonKey?this.#e(e.reasonKey,e.reason):e.reason:null,r=e.id==="stop";return b`
      <button
        class=${`${s} ${e.kind==="danger"?"ms-btn--danger":""}`}
        type="button"
        aria-disabled=${e.enabled?R:"true"}
        aria-describedby=${i?n:R}
        aria-label=${r?this.#e("v4_stop_cleaning_label","Stop cleaning"):R}
        @click=${()=>this.#Q(e)}
      >${o}</button>
      ${i?b`<p class="action-reason" id=${n}>${i}</p>`:R}
    `}#ke(e){let s=e.resources.plans.value?.rooms??e.resources.areas.value?.rooms??[];return Kt(e.locale,e.selection.roomIds.map(n=>s.find(o=>o.roomId===n)?.name??n))}#oe(e,s,n){let o=this.#ke(e),i=s?.enabled&&e.workflow==="rooms"&&s.id==="clean-rooms"?e.planDraft.returnToBase&&o?this.#e("v4_rooms_summary_dock","{rooms} \xB7 returns to the dock",{rooms:o}):o:"";return b`
      <div class="action-bar">
        ${i?b`<p class="action-summary">${i}</p>`:R}
        ${s?this.#V(s,"ms-btn ms-btn--block ms-btn--lg ms-btn--primary","primary-reason"):R}
        ${n?this.#V(n,"ms-btn ms-btn--block ms-btn--lg ms-btn--secondary","secondary-reason"):R}
      </div>
    `}#Z(e,s,n=R){return b`
      <div class="host-state">
        <h3>${e}</h3>
        <p>${s}</p>
        ${n}
      </div>
    `}#G(e,s,n,o,i=!1){return b`
      <button
        class="ms-row"
        type="button"
        aria-disabled=${i?"true":R}
        @click=${()=>{i||n()}}
      >
        <span class="ms-row__lead">${I(s)}</span>
        <span class="ms-row__body"><strong>${e}</strong>${o?b`<small>${o}</small>`:R}</span>
        <span class="ms-row__trail">${I(De)}</span>
      </button>
    `}#de(e){let s=e.resources.history.value?.floors||[],n=s.length?s.map((o,i)=>({id:o.active?"current":o.id,label:`${o.label||(o.active?this.#e("v4_current_floor","Current floor"):this.#e("v4_saved_floor","Saved floor {number}",{number:o.ordinal??i+1}))}${!o.active&&o.snapshots.length===0?` \xB7 ${this.#e("v4_floor_not_captured","Visit floor to capture")}`:""}`,disabled:!o.active&&o.snapshots.length===0})):[{id:e.selection.floorId,label:e.floor.displayName,disabled:!1}];return b`
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
    `}#ve(e,s){let n=(k,v,g)=>this.#e(k,v,g),o=this.#G(n("v4_map_history","Map history"),st,()=>this.#C("history"),n("v4_map_history_detail","Saved maps are floor-scoped and read only.")),i=this.#G(n("v4_map_diagnostics","Map diagnostics"),ot,()=>this.#C("support"),n("v4_map_support_detail","Private geometry is never included.")),{host:r}=e;if(!r.connected)return this.#Z(n("v4_reconnecting_title","Reconnecting to Home Assistant"),n("v4_reconnecting_body","The last verified map stays read-only until the connection returns."));if(!r.administrator)return this.#Z(n("v4_admin_title","Administrator access required"),n("v4_admin_body","Ask a Home Assistant administrator to open this map."));if(r.robotCount===0)return this.#Z(n("v4_no_robot_title","No Matic robot set up"),n("v4_no_robot_body","Add the Matic integration to see a map here."),b`<a class="ms-btn ms-btn--secondary" href="/config/integrations/integration/matic_robot">${n("v4_open_integration","Open the Matic integration")}</a>`);if(Me(e))return this.#Z(n("v4_selected_robot_unavailable","Selected robot unavailable"),n("v4_choose_another_robot","Choose another robot to open its map."));if(!r.robotConnected)return b`
        ${this.#Z(n("v4_robot_offline_title","Robot offline"),n("v4_robot_offline_body","Showing the last verified map. Cleaning is unavailable until the robot reconnects."))}
        <h3 class="shelf-heading">${n("v4_more","Map tools")}</h3>
        <div class="shelf">${o}${i}</div>
      `;if(Ns(e))return b`
        <h3 class="shelf-heading">${n("v4_more","Map tools")}</h3>
        <div class="shelf">
          ${o}
          ${i}
        </div>
      `;let l=e.coherence==="verifying"||e.coherence==="booting",c=e.resources.plans,d=c.value,u=d!==null&&d.rooms.length===0,m=d?.plans.length??0,h=c.status==="loading",f=c.status==="error",w=l||u,y=l?n("v4_reason_locating","Waiting for the robot to confirm which floor it is on."):u?n("v4_no_rooms_reason","This floor has no named rooms yet."):null,_=l?n("v4_reason_locating","Waiting for the robot to confirm which floor it is on."):null,M=l?n("v4_reason_locating","Waiting for the robot to confirm which floor it is on."):n("v4_areas_quick_detail","Create or choose a saved area");return b`
      ${e.activity==="problem"?this.#Z(n("v4_attention_title","The robot needs attention"),n("v4_attention_body","Check the robot, then start a new task.")):b`
          <div class="quick-actions" aria-label=${n("v4_cleaning_choices","Cleaning choices")}>
            <button
              class="ms-row ms-row--card ms-row--featured"
              type="button"
              aria-disabled=${w?"true":R}
              @click=${()=>{w||this.#C("rooms")}}
            >
              <span class="ms-row__lead">${I(ye)}</span>
              <span class="ms-row__body">
                <strong>${n("v4_clean_rooms","One-time clean")}</strong>
                <small>${y??n("v4_clean_rooms_hint","Choose rooms for this run")}</small>
              </span>
              <span class="ms-row__trail">${I(De)}</span>
            </button>
            <button
              class="ms-row ms-row--card"
              type="button"
              aria-disabled=${l?"true":R}
              @click=${()=>{l||this.#C("plans")}}
            >
              <span class="ms-row__lead">${I(nt)}</span>
              <span class="ms-row__body">
                <strong>${h?n("v4_plans_loading","Checking saved plans"):f?n("v4_plans_unavailable","Plans unavailable"):m?n("v4_run_a_plan","Run a plan"):n("v4_create_plan","Create a plan")}</strong>
                <small>${_??(h?n("v4_plans_loading_hint","Reading routines for this floor"):f?n("v4_plans_unavailable_hint","Try again to load saved routines"):m?m===1?n("v4_saved_routine","1 saved routine"):n("v4_saved_routines","{count} saved routines",{count:m}):n("v4_no_plans_hint","Save a room routine you can repeat"))}</small>
              </span>
              <span class="ms-row__trail">${I(De)}</span>
            </button>
          </div>
        `}
      <h3 class="shelf-heading">${n("v4_more","Map tools")}</h3>
      <div class="shelf">
        ${this.#G(n("v4_custom_areas","Clean a custom area"),Jt,()=>this.#C("draw"),M,l)}
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
            @click=${this.#fe}
          >${n("v4_how_to_move","How to move the map")}</button>
        </div>
      `:R}
    `}#ye(e,s){return e.workflow==="none"?this.#ve(e,s):customElements.get(pe)?b`<${qs}
      .state=${e}
      .localize=${this.localize}
      @matic-workspace-intent=${this.#we}
    ></${qs}>`:(this.#Re(),this._workflowLoadFailed?b`<div class="workflow-loading" role="alert">
          <p>${this.#e("v4_workflow_load_failed","Workspace tools could not be loaded.")}</p>
          <button class="ms-btn ms-btn--secondary" @click=${this.#Se}>
            ${this.#e("v4_retry","Try again")}
          </button>
        </div>`:b`<div class="workflow-loading" role="status" aria-live="polite">
        ${this.#e("v4_workflow_loading","Loading workspace tools\u2026")}
      </div>`)}#Re(){this.#c||customElements.get(pe)||(this._workflowLoadFailed=!1,this.#c=import("./workflow-panel-NJKE7XP4.js").then(()=>{this.#c=null,this.requestUpdate()}).catch(()=>{this.#c=null,this._workflowLoadFailed=!0}))}#Se;#ue(e,s){let n=zs(e,this.localize);return b`
      <div class="panel-heading">
        ${e.workflow!=="none"?b`
          <button
            class="panel-back ms-btn ms-btn--secondary"
            type="button"
            aria-label=${e.workflow==="plan"?this.#e("v4_back_to_plans","Back to plans"):this.#e("v4_back_to_all_tasks","Back to all tasks")}
            data-dialog-launcher="discardDraft"
            @click=${o=>this.#C(e.workflow==="plan"?"plans":"none",o.currentTarget)}
          >${I(Oe)}<span class="ms-btn__label">${e.workflow==="plan"?this.#e("v4_your_plans","Your plans"):this.#e("v4_all_tasks","All tasks")}</span></button>
        `:R}
        <h2 tabindex="-1">${n.title}</h2>
      </div>
      ${e.notice?b`<div class="notice" data-notice-slot data-tone=${e.notice.tone}>${this.#$(e.notice,this.#w)}</div>`:R}
      <p class="panel-description">${n.description}</p>
      ${this.#ye(e,s)}
    `}#re(e,s){let o=zs(e,this.localize).title;return e.workflow==="rooms"&&e.selection.roomIds.length&&(o=this.#e("v4_rooms_selected_names","Rooms selected: {count} \xB7 {rooms}",{count:e.selection.roomIds.length,rooms:this.#ke(e)})),this._sheetDetent!=="peek"?s.detail?`${s.title} \xB7 ${s.detail}`:s.title:s.notable?`${s.title} \xB7 ${o}`:o}#ge(){let e=(s,n)=>this.#e(s,n);return b`
      <div class="dialog-backdrop" @click=${s=>{s.target===s.currentTarget&&(this._helpOpen=!1)}}>
        <section
          class="dialog help-dialog ms-surface ms-surface--overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-title"
          @keydown=${this.#E}
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
    `}render(){let e=this.state,s=e.narrowHint||this._measuredNarrow,n=Ws(e,this.localize),o=Me(e),i=Ct({...e,narrowHint:s}),r=Pt(e),l=!s&&i.id==="stop"?i:!s&&r?.id==="stop"?r:null,c=l&&l===i?null:i,d=e.workflow==="draw"&&e.dataMode==="live"?{id:"clear-draft",label:"Clear drawing",labelKey:"v4_clear_drawing",kind:"neutral",enabled:e.draw.circles.length>0||!!e.draw.outline?.points.length}:null,u=l&&l===r?null:r??d,m=e.fullMap&&(e.coherence==="verifying"||e.coherence==="booting"),h=e.fullMap||e.host.administrator&&e.host.robotCount>0&&e.map.available,f=e.cadenceResetRequest?e.resources.plans.value?.rooms.find(g=>g.roomId===e.cadenceResetRequest?.roomId):void 0,w=e.cadenceResetRequest?e.resources.plans.value?.plans.find(g=>g.id===e.cadenceResetRequest?.planId)?.rooms.find(g=>g.roomId===e.cadenceResetRequest?.roomId):void 0,y=kn(e.dialog,this.localize,e.workflow==="plan",f?.name||e.cadenceResetRequest?.roomId||"room",w?.cadence?.scope==="shared",e.cadenceResetRequest?.mode,e.areaDraft.name),_=s&&!e.fullMap?`--map-sheet-offset:${this._sheetOffset}px`:"--map-sheet-offset:0px",M=s&&e.workflow==="draw",k=e.precisionOpen&&e.workflow==="draw",v=this._toast&&(this._toast.tone==="success"||this._toast.tone==="error"||e.fullMap||s&&this._sheetDetent==="peek")?this._toast:null;return b`
      <div class=${`root ${s?"narrow":"wide"}`} @keydown=${this.#P}>
        <button class="skip-link ms-btn ms-btn--primary" type="button" @click=${this.#U}>${this.#e("v4_skip_to_map","Skip to the map")}</button>
        <button class="skip-link ms-btn ms-btn--primary" type="button" @click=${this.#_e}>${this.#e("v4_skip_to_workspace","Skip to the map workspace")}</button>
        <div class="app" ?inert=${!!y||this._helpOpen}>
          <header class="app-bar">
            ${e.precisionOpen?R:b`
              <button
                class="nav nav--menu ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#e("v4_open_navigation","Open Home Assistant sidebar")}
                title=${this.#e("v4_open_navigation","Open Home Assistant sidebar")}
                @click=${this.#ie}
              >${I(Yt)}</button>
            `}

            ${e.precisionOpen?b`
              <button
                class="nav ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#e("v4_back","Back")}
                @click=${()=>this.#p({type:"dismiss-top-layer"})}
              >${I(Oe)}</button>
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
                @click=${this.#ne}
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
                  <button class="ms-row ms-row--menu" type="button" @click=${()=>this.#le("support")}>${this.#e("v4_map_diagnostics","Map diagnostics")}</button>
                  <button class="ms-row ms-row--menu" type="button" @click=${()=>this.#le("fullscreen")}>${this._browserFullscreen?this.#e("v4_leave_full_screen","Leave full screen"):this.#e("v4_full_screen","Full screen")}</button>
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
              >${this.#de(e)}
                ${s&&!e.fullMap&&this._sheetDetent==="full"?b`
                  <button
                    class="sheet-scrim"
                    slot="scrim"
                    data-map-control
                    type="button"
                    aria-label=${this.#e("v4_collapse_sheet","Collapse the map workspace")}
                    @click=${()=>this.#z("peek")}
                  ></button>
                `:R}
              </${Ls}>
              ${!s&&k?b`
                <div class="precision-popover">
                  <${Ge} compact .state=${e} .localize=${this.localize}></${Ge}>
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
                  @pointerdown=${this.#B}
                  @pointermove=${this.#se}
                  @pointerup=${this.#J}
                  @pointercancel=${this.#J}
                >
                  <span class="sheet-handle" role="presentation"></span>
                  ${e.workflow!=="none"&&this._sheetDetent==="peek"?b`
                    <button
                      class="sheet-back ms-btn ms-btn--icon ms-btn--sm"
                      type="button"
                      aria-label=${e.workflow==="plan"?this.#e("v4_back_to_plans","Back to plans"):this.#e("v4_back_to_all_tasks","Back to all tasks")}
                      title=${e.workflow==="plan"?this.#e("v4_back_to_plans","Back to plans"):this.#e("v4_back_to_all_tasks","Back to all tasks")}
                      data-dialog-launcher="discardDraft"
                      @click=${g=>this.#C(e.workflow==="plan"?"plans":"none",g.currentTarget)}
                    >${I(Oe)}</button>
                  `:R}
                  <span class="sheet-status">${this.#re(e,n)}</span>
                  <button
                    class="ms-btn ms-btn--icon ms-btn--sm"
                    type="button"
                    aria-label=${this.#e("v4_show_more","Show more of the map workspace")}
                    aria-controls="sheet-body"
                    aria-disabled=${this._sheetDetent==="full"?"true":R}
                    @click=${()=>this.#F(1)}
                  >${I(Gt)}</button>
                  <button
                    class="ms-btn ms-btn--icon ms-btn--sm"
                    type="button"
                    aria-label=${this.#e("v4_show_less","Show less of the map workspace")}
                    aria-controls="sheet-body"
                    aria-disabled=${this._sheetDetent==="peek"?"true":R}
                    @click=${()=>this.#F(-1)}
                  >${I(Qt)}</button>
                </div>
                ${M?b`
                  <div class="sheet-tools">
                    ${os(e,{intent:g=>this.#p(g),openBrush:()=>this.#me(),t:(g,C,$)=>this.#e(g,C,$)},"grid")}
                    ${k?b`
                      <div class="precision-popover">
                        <${Ge} compact inline .state=${e} .localize=${this.localize}></${Ge}>
                      </div>
                    `:R}
                  </div>
                `:R}
                <div
                  class="sheet-body"
                  id="sheet-body"
                  @pointerdown=${this.#be}
                  @pointermove=${this.#X}
                  @pointerup=${this.#I}
                  @pointercancel=${this.#I}
                >
                  ${this.#ue(e,s)}
                </div>
                ${this.#oe(e,c,u)}
              `:b`
                <div class="status-strip">
                  <span class="status-icon" aria-hidden="true">${I(n.icon)}</span>
                  <span class="status-copy"><strong>${n.title}</strong><small>${n.detail}</small></span>
                  ${l?this.#V(l,"status-action ms-btn ms-btn--secondary","status-reason"):R}
                </div>
                <section class="workflow">
                  <div class="workflow-body">${this.#ue(e,s)}</div>
                  ${this.#oe(e,c,u)}
                </section>
              `}
            </aside>

            ${e.fullMap?b`
              <section
                class=${`full-map-hud ms-surface ms-surface--floating ${r?"has-secondary":""} ${!s&&(e.workflow==="draw"||e.workflow==="rooms"&&e.selection.roomIds.length>0)?"above-dock":""}`}
                aria-label=${this.#e("v4_robot_status_and_action","Robot status and action")}
              >
                <span class="hud-copy"><strong>${n.title}</strong><small>${n.detail}</small></span>
                ${m&&i.id!=="stop"?R:this.#V(i,"ms-btn ms-btn--lg ms-btn--primary","hud-reason")}
                ${r&&(!m||r.id==="stop")?this.#V(r,"ms-btn ms-btn--lg ms-btn--secondary","hud-secondary-reason"):R}
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
          @pointerenter=${this.#W}
          @focusin=${this.#W}
          @pointerleave=${this.#_}
          @focusout=${this.#_}
        >${v?this.#$(v,this.#T):R}</div>

        <div class="sr-only" aria-live="polite" aria-atomic="true">${this._polite}</div>
        <div class="sr-only" role="alert" aria-atomic="true">${this._alert}</div>

        ${this._helpOpen?this.#ge():R}

        ${y?b`
          <div class="dialog-backdrop">
            <section
              class="dialog ms-surface ms-surface--overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="dialog-title"
              aria-describedby="dialog-detail"
              @keydown=${this.#E}
            >
              <h2 id="dialog-title">${y.title}</h2>
              <p id="dialog-detail">${y.detail}</p>
              <div class="dialog-actions">
                <button
                  class="ms-btn ms-btn--secondary"
                  type="button"
                  data-dialog-initial-focus
                  @click=${e.dialog==="discardDraft"?this.#k:this.#j}
                >${y.cancelLabel}</button>
                ${y.action===null?R:b`
                  <button
                    class="discard ms-btn ms-btn--primary ms-btn--danger"
                    type="button"
                    @click=${()=>this.#pe(y)}
                  >${y.confirmLabel}</button>
                `}
              </div>
            </section>
          </div>
        `:R}
      </div>
    `}};customElements.get(me)||customElements.define(me,vt);var Hs=re(me),_e=new WeakMap,Sn={},En=3e4,yt=class extends xe{constructor(){super(...arguments);this.narrow=!1;this._workspace=H();this.#e=new Le;this.#t=new Rt(this._workspace);this.#n=null;this.#r=null;this.#l=null;this.#i=null;this.#o=null;this.#s=null}static{this.styles=[Te,Ae,Pe`
:host { display: block; block-size: 100%; }
`]}static{this.properties={hass:{attribute:!1},narrow:{type:Boolean},route:{attribute:!1},panel:{attribute:!1},_workspace:{state:!0}}}#e;#t;#n;#r;#l;#i;#o;#s;#u(e=this.hass,s=this.panel){let n=this.#t.value.selection;return n.entrySource==="user"?this.#e.project(e,s,n.entryId):this.#e.project(e,s)}#f(){let e=this.hass,s=e?.loadBackendTranslation;if(!e||typeof s!="function")return;let n=e.connection??Sn,o=e.language??"";_e.get(n)!==o&&(_e.set(n,o),Promise.resolve().then(()=>s.call(e,"common","matic_robot")).catch(()=>{this.isConnected&&(this.#s&&clearTimeout(this.#s.timer),this.#s={owner:n,timer:setTimeout(()=>{this.#s=null,_e.get(n)===o&&_e.delete(n),this.#f()},En)})}))}shouldUpdate(e){if(this.#f(),!e.has("hass")||[...e.keys()].some(n=>n!=="hass"))return!0;let s=e.get("hass");return s?.connection!==this.hass?.connection||s?.localize!==this.hass?.localize?!0:this.#u()!==this.#n}connectedCallback(){super.connectedCallback(),this.#f(),this.#r=this.#t.subscribe(e=>{if(this._workspace=e,e.selection.entryId!==this.#n?.entryKey){let s=this.#u();s!==this.#n&&(this.#n=s,this.#i?.sync(s))}}),this.#d()}disconnectedCallback(){this.#s&&(clearTimeout(this.#s.timer),_e.delete(this.#s.owner),this.#s=null),this.#r?.(),this.#r=null,this.#v(),super.disconnectedCallback()}#d(){if(!(!this.isConnected||this.#i)&&(this.#n=this.#u(),this.#l=new ze(()=>this.hass),this.#i=new Ye(this.#t,this.#l,this.hass?.connection??null),this.#o=new Xe(this.#t),this.#o.start(),this.#n)){this.#i.sync(this.#n);let{host:e}=this.#n;e.connected&&e.administrator&&e.robotCount>0&&this.#i.refreshCatalog(this.#t.value.selection.floorId==="current")}}#v(){this.#o?.dispose(),this.#o=null,this.#i?.dispose(),this.#i=null,this.#l=null}willUpdate(e){if(e.has("hass")||e.has("panel")){let s=e.get("hass"),n=e.has("hass")&&s?.connection!==this.hass?.connection,o=this.#u(),i=o!==this.#n;i&&(this.#n=o),n?(this.#v(),this.#d()):(i||e.has("panel"))&&this.#i?.sync(o)}e.has("narrow")&&this.#t.value.narrowHint!==this.narrow&&this.#t.dispatch({type:"set-narrow-hint",value:this.narrow})}#b(e){if(!Ee(e.detail))return;e.stopPropagation();let s=e.detail;if(s.type==="dismiss-top-layer"||s.type==="exit-full-map"){this.#o?.dismissTop()||this.#t.dispatch(s);return}if(s.type==="open-workflow"&&s.workflow!=="none"){this.#i?.openWorkflow(s.workflow);return}if(s.type==="set-floor"){this.#i?.selectFloor(s.floorId);return}if(s.type==="select-entry"){if(!this._workspace.robots.some(n=>n.entryId===s.entryId)||this.#e.project(this.hass,this.panel,s.entryId).entryKey!==s.entryId)return;this.#t.dispatch(s);return}if(s.type==="set-history"){this.#i?.selectHistory(s.historyId);return}if(s.type==="select-plan"){this.#i?.selectPlan(s.planId);return}if(s.type==="select-area"){this.#i?.selectArea(s.areaId),s.workflow==="areaReview"&&this.#i?.openWorkflow("areaReview");return}this.#t.dispatch(s)}#g(e){e.stopPropagation(),typeof e.detail?.id=="string"&&(e.detail.id==="reset-room-cadence"&&"planId"in e.detail&&"roomId"in e.detail&&"mode"in e.detail?this.#i?.executeAction(e.detail):this.#i?.executeAction(e.detail.id),this.dispatchEvent(new CustomEvent("matic-map-v4-action-requested",{detail:{id:e.detail.id},bubbles:!0,composed:!0})))}getWorkspaceSnapshot(){return this.#t.value}getRequestDiagnostics(){return Object.freeze({http:this.#l?.requestDiagnostics()??null,workspace:this.#i?.workspaceDiagnostics()??null})}render(){return b`
      <${Hs}
        .state=${this._workspace}
        .localize=${this.hass?.localize}
        @matic-workspace-intent=${this.#b}
        @matic-workspace-action=${this.#g}
      ></${Hs}>
    `}};customElements.get(et)||customElements.define(et,yt);export{Le as a,re as b,b as c,yt as d};
/*! Bundled license information:

lit-html/static.js:
  (**
   * @license
   * Copyright 2020 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/
