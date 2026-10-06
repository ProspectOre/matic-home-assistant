import{A as ns,a as $e,b as ye,c as ge,d as be,e as rt,f as Dt,g as ot,h as Lt,i as qt,j as oe,k as we,l as ie,m as Wt,n as R,o as Oe,p as zt,q as Bt,r as Ht,s as Nt,t as Kt,u as Ft,v as Ut,w as es,x as ts,y as ss,z as ke}from"./chunk-AUNK7UDP.js";import{A as Pt,B as It,C as At,D as Tt,H as te,I as Te,J as $t,K as Ot,M as k,O as se,P as ne,Q as re,R as De,S as _e,T as Le,U as Vt,V as jt,W as Yt,X as qe,Y as Xt,Z as Gt,c as Et,e as Ze,f as et,h as Pe,i as ee,l as O,m as Mt,n as tt,o as st,pa as Qt,q as xt,qa as it,r as Ct,ra as at,sa as Jt,t as Ie,ta as lt,ua as ct,v as ve,va as Zt,wa as K,xa as I,y as nt,ya as X,z as Ae}from"./chunk-OTYJ26W5.js";var zs=(a,t)=>{if(t?.recharge_and_resume===!0&&t?.charging===!0)return"recharging";switch(a){case"cleaning":return"cleaning";case"paused":return"paused";case"returning":return"returning";case"docked":return"docked";case"idle":return"idle";case"error":return"problem";default:return"unknown"}},Bs=a=>typeof a!="number"||!Number.isFinite(a)?null:Math.round(Math.max(0,Math.min(100,a))),Hs=a=>{let t=a.attributes?.matic_entry_id;return typeof t=="string"&&t.length>0?t:null},Ns=a=>String(a||"local-user").replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",rs=a=>{if(typeof a!="string")return"Matic robot";let t=a.trim();return t&&Array.from(t).length<=128&&!/[\u0000-\u001f\u007f]/u.test(t)?t:"Matic robot"},We=class{#e="";#t=null;project(t,e,s=null){let n=t?.states??{},r=e?.config?.entry_id,i=s||(typeof r=="string"?r:null),l=null,c=null,d=i,u=new Map;for(let[p,S]of Object.entries(n)){let M=Hs(S);M&&p.startsWith("vacuum.")&&(u.set(M,{entryId:M,label:rs(S.attributes?.friendly_name)}),(i?M===i:!l)&&(l=S,c=p,d=M))}let f={connected:t?.connected!==!1,administrator:t?.user?.is_admin===!0,robotConnected:l!==null&&l.state!=="unavailable"&&l.state!=="unknown",robotCount:u.size},h=l?zs(l.state,l.attributes):"unknown",v=Bs(l?.attributes?.battery_level),g=t?.selectedLanguage||t?.language||"en",y=Ns(t?.user?.id),w=rs(l?.attributes?.friendly_name),E=[...u.values()].sort((p,S)=>p.label.localeCompare(S.label,g,{sensitivity:"base"})),_=[f.connected,f.administrator,f.robotConnected,f.robotCount,h,v??"none",g,y,c??"none",d??"none",w,E.map(p=>`${p.entryId}:${p.label}`).join(",")].join("|");return _===this.#e&&this.#t?this.#t:(this.#e=_,this.#t={host:f,activity:h,batteryPercent:v,language:g,userKey:y,vacuumEntityId:c,entryKey:d,robotLabel:w,robots:E},this.#t)}};var is=Symbol.for(""),Ks=a=>{if(a?.r===is)return a?._$litStatic$},ae=a=>({_$litStatic$:a,r:is});var os=new Map,dt=a=>(t,...e)=>{let s=e.length,n,r,o=[],i=[],l,c=0,d=!1;for(;c<s;){for(l=t[c];c<s&&(r=e[c],(n=Ks(r))!==void 0);)l+=n+t[++c],d=!0;c!==s&&i.push(r),o.push(l),c++}if(c===s&&o.push(t[s]),d){let u=o.join("$$lit$$");(t=os.get(u))===void 0&&(o.raw=o,os.set(u,t=o)),e=i}return a(t,...e)},b=dt(Te),wn=dt($t),_n=dt(Ot);var Fs=1024*1024,as=a=>{let t=s=>{let n=a.sceneHeaderBytes,r=a.scenePointStride,o=a.sceneMaxPoints,i=a.sceneMaxBytes,l=()=>{throw new Error("invalid-scene")};(!(s instanceof ArrayBuffer)||s.byteLength<n||s.byteLength>i)&&l();let c=new DataView(s),d=new Uint8Array(s,0,8),u=String.fromCharCode(...d),f=c.getUint16(8,!0),h=c.getUint16(10,!0),v=c.getUint32(12,!0),g=c.getUint32(16,!0),y=c.getUint32(20,!0),w=g+y,E=n+v;(u!=="MATIC3D\0"||f!==1||h!==r||v>1048576||w<1||w>o||E+w*h!==s.byteLength)&&l();let _;try{_=JSON.parse(new TextDecoder("utf-8",{fatal:!0}).decode(new Uint8Array(s,n,v)))}catch{l()}(!_||typeof _!="object"||Array.isArray(_))&&l();let p=_,S=p.meters_per_cell,M=p.origin_cells,z=p.span_cells;(typeof S!="number"||!Number.isFinite(S)||S<.001||S>.1||!Array.isArray(M)||M.length!==2||!M.every(A=>typeof A=="number"&&Number.isFinite(A))||!Array.isArray(z)||z.length!==2||!z.every(A=>typeof A=="number"&&Number.isFinite(A)&&A>=1&&A<=65536))&&l();let H=(Array.isArray(p.rooms)?p.rooms.slice(0,128):[]).flatMap((A,xe)=>{if(!A||typeof A!="object"||Array.isArray(A))return[];let L=A,V=typeof L.name=="string"?L.name.trim():"";if(!V||Array.from(V).length>128||/[\u0000-\u001f\u007f]/u.test(V))return[];if(!Array.isArray(L.boundary)||L.boundary.length<3||L.boundary.length>8192)return[];let Ce=L.boundary.flatMap(N=>{if(!Array.isArray(N)||N.length!==2)return[];let[j,Z]=N;return typeof j=="number"&&Number.isFinite(j)&&typeof Z=="number"&&Number.isFinite(Z)?[[j,Z]]:[]}),G=L.center;if(Ce.length<3||!Array.isArray(G)||G.length!==2)return[];let[Q,J]=G;return typeof Q!="number"||!Number.isFinite(Q)||typeof J!="number"||!Number.isFinite(J)?[]:[{id:`scene-room-${xe+1}`,name:V,boundary:Ce,center:[Q,J]}]}),me=typeof p.sample_step=="number"&&Number.isInteger(p.sample_step)?Math.max(1,Math.min(o,p.sample_step)):1,fe=M,Me=z;return{buffer:s,pointOffset:E,floorCount:g,surfaceCount:y,total:w,metadata:{metersPerCell:S,origin:[fe[0],fe[1]],span:[Me[0],Me[1]],sampleStep:me,rooms:H}}};return{parseTransfer:t,decodeDeltaTransfer:async(s,n,r)=>{let o=(P="invalid-scene-delta")=>{throw new Error(P)},i=()=>{if(r?.aborted)throw new DOMException("Aborted","AbortError")};(!(s instanceof ArrayBuffer)||s.byteLength<a.deltaHeaderBytes||s.byteLength>a.deltaHeaderBytes+a.deltaMaxBytes||!(n.buffer instanceof ArrayBuffer)||n.buffer.byteLength<a.sceneHeaderBytes||n.buffer.byteLength>a.deltaMaxBytes||!Number.isSafeInteger(n.revision)||n.revision<0)&&o("invalid-scene-delta-size");let l=new DataView(s),c=String.fromCharCode(...new Uint8Array(s,0,8)),d=l.getUint16(8,!0),u=l.getUint16(10,!0),f=l.getBigUint64(12,!0),h=l.getBigUint64(20,!0),v=l.getUint32(28,!0),g=l.getUint32(32,!0),y=Number(f),w=Number(h);(c!=="MATICDLT"||d!==1||u!==1||!Number.isSafeInteger(y)||!Number.isSafeInteger(w)||y!==n.revision||w<=n.revision||v<a.sceneHeaderBytes||v>a.deltaMaxBytes||g<1||g>a.deltaMaxBytes||g+a.deltaHeaderBytes!==s.byteLength)&&o(),typeof DecompressionStream!="function"&&o("scene-delta-decompression-unavailable"),i();let E=new Uint8Array(s,a.deltaHeaderBytes,g),_=Math.max(n.buffer.byteLength,v);_>a.deltaMaxBytes&&o("invalid-scene-delta-size");let p=new Uint8Array(_),M=new Blob([E]).stream().pipeThrough(new DecompressionStream("deflate")).getReader(),z=0,pe=null;try{for(pe=()=>{M.cancel().catch(()=>{})},r?.addEventListener("abort",pe,{once:!0});;){i();let{done:P,value:Y}=await M.read();if(P)break;(!(Y instanceof Uint8Array)||z+Y.byteLength>_)&&o(),p.set(Y,z),z+=Y.byteLength}}catch(P){if(await M.cancel().catch(()=>{}),r?.aborted||P instanceof DOMException&&P.name==="AbortError")throw new DOMException("Aborted","AbortError");if(P instanceof Error&&P.message==="invalid-scene-delta")throw P;o()}finally{pe&&r?.removeEventListener("abort",pe),M.releaseLock()}i(),z!==_&&o();let H=new Uint8Array(n.buffer),me=new DataView(p.buffer,p.byteOffset,p.byteLength),fe=Math.min(a.sceneHeaderBytes,H.byteLength);for(let P=0;P<fe;P+=1)p[P]=(p[P]??0)^(H[P]??0);let Me=me.getUint32(12,!0),A=me.getUint32(16,!0),xe=me.getUint32(20,!0),L=a.sceneHeaderBytes+Me,V=A+xe,Ce=L===n.pointOffset&&A===n.floorCount&&xe===n.surfaceCount,G=L+V*a.scenePointStride,Q=Ce&&G===v&&V<=a.sceneMaxPoints,J=[],N=-1,j=!1,Z=()=>{j&&N>=0&&J.push(N),j=!1};for(let P=fe;P<H.byteLength;P+=a.xorChunkBytes){i();let Y=Math.min(H.byteLength,P+a.xorChunkBytes);for(let q=P;q<Y;q+=1){let kt=H[q]??0,Rt=(p[q]??0)^kt;if(p[q]=Rt,!Q||q<n.pointOffset||q>=G)continue;let St=Math.floor((q-n.pointOffset)/a.dirtyBlockBytes);St!==N&&(Z(),N=St),Rt!==kt&&(j=!0)}Y<H.byteLength&&await new Promise(q=>globalThis.setTimeout(q,0))}Z(),i();let Ws=v===p.byteLength?p.buffer:p.slice(0,v).buffer;return{parsed:t(Ws),revision:w,...Q?{deltaHint:{baseRevision:y,blockBytes:a.dirtyBlockBytes,dirtyBlocks:J}}:{}}}}},ls=Object.freeze({deltaHeaderBytes:we,deltaMaxBytes:ie,sceneHeaderBytes:ot,sceneMaxBytes:oe,sceneMaxPoints:qt,scenePointStride:Lt,dirtyBlockBytes:Wt,xorChunkBytes:Fs}),cs=as(ls),Us=a=>{try{return cs.parseTransfer(a)}catch{throw new R("invalid-scene")}},Vs=()=>`
  const { parseTransfer, decodeDeltaTransfer } = (${as.toString()})(Object.freeze(${JSON.stringify(ls)}));
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
`,ze=class{#e=null;#t=null;#n=!1;#r=!1;#i=0;#a=null;#o=null;#s=null;constructor(){if(!(typeof Worker!="function"||typeof URL?.createObjectURL!="function"))try{this.#t=URL.createObjectURL(new Blob([Vs()],{type:"text/javascript"})),this.#f()}catch{this.#e=null,this.#t&&URL.revokeObjectURL(this.#t),this.#t=null}}async parse(t,e){if(this.#h(e),t.byteLength>oe||t.byteLength<ot)throw new R("invalid-scene");let s=await this.#d({kind:"parse",buffer:t},e,async n=>(await new Promise(r=>globalThis.setTimeout(r,0)),this.#h(n),{id:0,ok:!0,parsed:Us(t)}));if(!s.parsed)throw new R("invalid-scene");return s.parsed}async decodeDelta(t,e,s){if(this.#h(s),t.byteLength>we+ie||e.buffer.byteLength>ie)throw new R("invalid-scene-delta-size");let n={buffer:e.buffer,revision:e.revision,pointOffset:e.pointOffset,floorCount:e.floorCount,surfaceCount:e.surfaceCount},r;try{r=await this.#d({kind:"delta",payload:t},s,async o=>(await new Promise(i=>globalThis.setTimeout(i,0)),this.#h(o),cs.decodeDeltaTransfer(t,n,o).then(i=>({id:0,ok:!0,...i}))),n)}catch(o){throw o instanceof R?o:s?.aborted||o instanceof DOMException&&o.name==="AbortError"?new DOMException("Aborted","AbortError"):o instanceof Error&&(o.message.startsWith("invalid-scene")||o.message==="scene-delta-decompression-unavailable")?new R(o.message):new R("invalid-scene-delta")}if(!r.parsed||r.revision===void 0)throw new R("invalid-scene-delta");return{parsed:r.parsed,revision:r.revision,...r.deltaHint?{deltaHint:r.deltaHint}:{}}}#h(t){if(this.#r)throw new R("scene-parser-disposed");if(t?.aborted)throw new DOMException("Aborted","AbortError")}#f(){if(!(!this.#t||this.#n||this.#r))try{let t=new Worker(this.#t);t.onmessage=e=>{let s=this.#a;this.#e!==t||!s||s.worker!==t||e.data.id!==s.id||(e.data.ok?this.#_(s,e.data):this.#_(s,void 0,new R(e.data.problem||"invalid-scene")))},t.onerror=()=>this.#c(t),t.onmessageerror=()=>this.#c(t),this.#e=t}catch{this.#e=null,this.#n=!0}}async#d(t,e,s,n){return this.#h(e),new Promise((r,o)=>{let i,l=()=>e?.removeEventListener("abort",i.abort),c=(d,u)=>{i.settled||(i.settled=!0,l(),u!==void 0?o(u):d?r(d):o(new R("invalid-scene")))};i={id:++this.#i,message:t,...e?{signal:e}:{},fallback:s,...n?{base:n}:{},settle:c,abort:()=>this.#S(i),settled:!1,worker:null},e?.addEventListener("abort",i.abort,{once:!0}),e?.aborted||this.#r?c(void 0,e?.aborted?new DOMException("Aborted","AbortError"):new R("scene-parser-disposed")):this.#a?this.#o?c(void 0,new R("scene-parser-busy")):this.#o=i:(this.#a=i,this.#M(i))})}#M(t){if(this.#a!==t)return;if(this.#r){this.#_(t,void 0,new R("scene-parser-disposed"));return}if(t.signal?.aborted){this.#_(t,void 0,new DOMException("Aborted","AbortError"));return}!this.#e&&!this.#n&&this.#f();let e=this.#e;if(e){t.worker=e;try{let n,r;if(t.message.kind==="parse")n={id:t.id,kind:t.message.kind,buffer:t.message.buffer},r=[t.message.buffer];else{if(!t.base)throw new R("invalid-scene-delta");let o={...t.base,buffer:t.base.buffer.slice(0)};n={id:t.id,kind:t.message.kind,payload:t.message.payload,base:o},r=[t.message.payload,o.buffer]}e.postMessage(n,r)}catch{this.#c(e)}return}let s=new AbortController;this.#s=s,Promise.resolve().then(()=>t.fallback(s.signal)).then(n=>this.#_(t,n),n=>this.#_(t,void 0,n))}#S(t){let e=new DOMException("Aborted","AbortError");if(this.#o===t){this.#o=null,t.settle(void 0,e);return}this.#a===t&&(t.worker?(this.#g(),this.#_(t,void 0,e)):this.#s?.abort())}#_(t,e,s){if(this.#a!==t){t.settle(void 0,new R("scene-parser-disposed"));return}let n=t.signal?.aborted?new DOMException("Aborted","AbortError"):s;t.settle(e,n),this.#a=null,this.#s=null,t.worker=null,this.#r||this.#m()}#m(){if(this.#r||this.#a||!this.#o)return;let t=this.#o;if(this.#o=null,t.signal?.aborted){t.settle(void 0,new DOMException("Aborted","AbortError")),this.#m();return}this.#a=t,this.#M(t)}#c(t){if(this.#e!==t)return;this.#n=!0,this.#g();let e=this.#a;e?.worker===t?this.#_(e,void 0,new R("scene-worker-failed")):this.#m()}#g(){this.#e?.terminate(),this.#e=null}dispose(){if(this.#r)return;this.#r=!0;let t=this.#o;this.#o=null,t?.settle(void 0,new R("scene-parser-disposed"));let e=this.#a;this.#g(),this.#s?.abort(),this.#s=null,e&&(e.worker=null,e.settle(void 0,new R("scene-parser-disposed"))),this.#a=null,this.#t&&URL.revokeObjectURL(this.#t),this.#t=null}};var ut=["catalog","scene","sceneDelta","pose","history","plans","areas","areaSave","areaDelete"];var ht=()=>({requests:0,completed:0,failed:0,aborted:0,timedOut:0,totalDurationMs:0,maxDurationMs:0}),ds=a=>Math.min(1e9,a+1),us=a=>Number.isFinite(a)?Math.min(1e12,Math.max(0,a)):0,le=class{#e=ht();#t=!1;record(t,e){if(this.#t)return;let s=Math.round(us(e)*100)/100;this.#e.requests=ds(this.#e.requests),this.#e[t]=ds(this.#e[t]),this.#e.totalDurationMs=us(this.#e.totalDurationMs+s),this.#e.maxDurationMs=Math.max(this.#e.maxDurationMs,s)}snapshot(){return Object.freeze({...this.#e})}reset(){this.#t||Object.assign(this.#e,ht())}dispose(){this.#t=!0,Object.assign(this.#e,ht())}},Be=class{#e=Object.fromEntries(ut.map(t=>[t,new le]));#t=!1;record(t,e,s){this.#t||this.#e[t].record(e,s)}snapshot(){let t=Object.fromEntries(ut.map(e=>[e,this.#e[e].snapshot()]));return Object.freeze(t)}dispose(){if(!this.#t){this.#t=!0;for(let t of ut)this.#e[t].dispose()}}};var D={catalog:1e4,scene:6e4,delta:35e3,pose:1e4,history:15e3,workflow:15e3,mutation:2e4,roomPreview:15e3},js=2,Re=new WeakMap,hs={coverage_identity_unavailable:"Could not verify the current cleaning task. Check the robot status, then try again.",coverage_activity_unavailable:"Could not verify whether the robot is cleaning. Check the robot status, then try again.",coverage_native_session_active:"The robot already has a cleaning task. Wait for it to finish before starting another cleaning task.",coverage_identity_changed:"The cleaning task changed during setup. Check the robot status, then try again."},Ys=(a,t)=>{if(!a||typeof a!="object")return null;let e=a;if(e.translation_domain!=="matic_robot"||typeof e.translation_key!="string"||!Object.hasOwn(hs,e.translation_key))return null;let s=e.translation_key,n=hs[s];try{let r=t?.(`component.matic_robot.exceptions.${s}.message`);r&&r!==`component.matic_robot.exceptions.${s}.message`&&(n=r)}catch{}return new x(s,null,n)},x=class extends Error{constructor(t,e=null,s=null){super(s??t),this.name="BackendError",this.code=t,this.status=e,this.recoveryMessage=s}},ps=(a,t)=>{let e=a.headers.get("X-Matic-Revision");if(e===null)return t;let s=Number(e);if(!Number.isSafeInteger(s)||s<0)throw new R("invalid-scene-revision");return s},ms=(a,t)=>{let e=a.headers.get("X-Matic-Floor-Coherent");if(e===null)return t;if(e==="1")return!0;if(e==="0")return!1;throw new R("invalid-scene-floor-header")},He=class{#e;#t=new ze;#n=new WeakMap;#r=new Set;#i=new Be;#a=!1;constructor(t){this.#e=t}requestDiagnostics(){return this.#i.snapshot()}async#o(t,e,s=Number.POSITIVE_INFINITY,n="invalid-response-size"){let r=t.body?.getReader();if(!r)return new ArrayBuffer(0);let o=()=>{r.cancel().catch(()=>{})};e.addEventListener("abort",o,{once:!0});try{if(e.aborted)throw o(),new DOMException("Aborted","AbortError");let i=[],l=0;for(;;){let u=await r.read();if(e.aborted)throw new DOMException("Aborted","AbortError");if(u.done)break;if(l+u.value.byteLength>s)throw r.cancel().catch(()=>{}),new R(n);i.push(u.value),l+=u.value.byteLength}let c=new Uint8Array(l),d=0;for(let u of i)c.set(u,d),d+=u.byteLength;return c.buffer}finally{e.removeEventListener("abort",o),r.releaseLock()}}async#s(t,e,s,n,r,o){if(!Ut(e))throw new x("invalid-private-path");if(r?.aborted)throw new DOMException("Aborted","AbortError");let i=performance.now(),l="failed",c=new AbortController,d=()=>{},u=new Promise((g,y)=>{d=y}),f=()=>{c.abort(),d(new DOMException("Aborted","AbortError"))};r?.addEventListener("abort",f,{once:!0});let h=!1,v=window.setTimeout(()=>{h=!0,f()},n);try{let g=this.#e(),y=new Headers(s.headers),w={...s,cache:"no-store",credentials:"same-origin",headers:Object.fromEntries(y.entries()),signal:c.signal},E=async()=>{let p;if(typeof g?.fetchWithAuth=="function")p=await g.fetchWithAuth(e,w);else{let S=g?.auth?.accessToken||g?.auth?.data?.access_token;S&&y.set("Authorization",`Bearer ${S}`);let M=typeof g?.hassUrl=="function"?g.hassUrl(e):e;p=await fetch(M,{...w,headers:y})}try{if(c.signal.aborted)throw new DOMException("Aborted","AbortError");return await o(p,c.signal)}finally{p.body&&!p.body.locked&&p.body.cancel().catch(()=>{})}},_=await Promise.race([E(),u]);return l="completed",_}catch(g){throw h&&!r?.aborted?(l="timedOut",new x("request-timeout")):c.signal.aborted?(l="aborted",new DOMException("Aborted","AbortError")):g}finally{window.clearTimeout(v),r?.removeEventListener("abort",f),this.#i.record(t,l,performance.now()-i)}}async#h(t,e,s,n,r={}){return this.#s(t,e,{...r,headers:{Accept:"application/json",...r.headers||{}}},s,n,async(o,i)=>{if(!o.ok){let l=o.headers.get("X-Matic-Plans-Conflict");throw new x(l==="map-rechecking"?"map-rechecking":"request-failed",o.status)}try{return JSON.parse(new TextDecoder().decode(await this.#o(o,i)))}catch{throw new R("invalid-json-response")}})}async catalog(t){return Oe(await this.#h("catalog",Dt,D.catalog,t))}async scene(t,e,s,n,r,o){let i=new Headers({Accept:"application/vnd.matic.slam-scene"});return n==="live"&&i.set("X-Matic-Prefer-Cached","1"),o&&i.set("If-None-Match",o),this.#s("scene",t,{headers:i},D.scene,r,async(l,c)=>{let d=ps(l,e),u=ms(l,s);if(l.status===304)return{scene:null,floorCoherent:u,revision:d,notModified:!0};if(!l.ok)throw new x("scene-request-failed",l.status);if(l.headers.get("Content-Type")?.split(";",1)[0]!=="application/vnd.matic.slam-scene")throw new R("invalid-scene-content-type");return{scene:{...await this.#t.parse(await this.#o(l,c,oe,"invalid-scene-size"),c),revision:d,etag:l.headers.get("ETag"),source:n},floorCoherent:u,revision:d,notModified:!1}})}async sceneDelta(t,e,s,n){let r=t.includes("?")?"&":"?";return this.#s("sceneDelta",`${t}${r}since=${encodeURIComponent(e.revision)}`,{headers:{Accept:"application/vnd.matic.slam-delta, application/vnd.matic.slam-scene"}},D.delta,n,async(o,i)=>{let l=ps(o,e.revision),c=ms(o,s);if(o.status===204){if(l!==e.revision)throw new R("invalid-scene-delta-revision");return{scene:null,floorCoherent:c,revision:l,notModified:!0}}if(!o.ok)throw new x("delta-request-failed",o.status);if(l<=e.revision)throw new R("invalid-scene-delta-revision");let d=o.headers.get("Content-Type")?.split(";",1)[0];if(d!=="application/vnd.matic.slam-delta"&&d!=="application/vnd.matic.slam-scene")throw new R("invalid-scene-delta-content-type");let u=d==="application/vnd.matic.slam-delta",f=u?we+ie:oe,h=Number(o.headers.get("Content-Length"));if(Number.isFinite(h)&&h>f)throw new R(u?"invalid-scene-delta-size":"invalid-scene-size");let v=await this.#o(o,i,f,u?"invalid-scene-delta-size":"invalid-scene-size");if(u){let y=Number(o.headers.get("X-Matic-Base-Revision"));if(!Number.isSafeInteger(y)||y!==e.revision)throw new R("invalid-scene-delta-base");let w=await this.#t.decodeDelta(v,e,i);if(w.revision!==l)throw new R("invalid-scene-delta-revision");return{scene:{...w.parsed,revision:l,etag:o.headers.get("ETag"),source:"live",...w.deltaHint?{deltaHint:w.deltaHint}:{}},floorCoherent:c,revision:l,notModified:!1}}return{scene:{...await this.#t.parse(v,i),revision:l,etag:o.headers.get("ETag"),source:"live"},floorCoherent:c,revision:l,notModified:!1}})}async pose(t,e){return Ft(await this.#h("pose",t,D.pose,e))}async history(t,e){return zt(await this.#h("history",t,D.history,e))}async plans(t,e){return Kt(await this.#h("plans",t,D.workflow,e))}async areas(t,e){return Ht(await this.#h("areas",t,D.workflow,e))}async previewRoomSequence(t,e,s,n){if(!t||t.length>255||e.length<1||e.length>100)throw new R("invalid-room-sequence-preview-request");if(n?.aborted)throw new DOMException("Aborted","AbortError");let r=this.#e()?.connection;if(!r?.sendMessagePromise)throw new x("preview-unavailable");let o=null,i=()=>{},l=new Promise((w,E)=>{i=E}),c=this.#n.get(r),d,u=new Promise(w=>{d=w});this.#n.set(r,u);let f=!1,h=()=>{f||(f=!0,d(),this.#n.get(r)===u&&this.#n.delete(r))},v=!1,g=()=>{i(new DOMException("Aborted","AbortError")),v&&(h(),o!==null&&window.clearTimeout(o),o=null)};n?.addEventListener("abort",g,{once:!0});let y=new Promise((w,E)=>{o=window.setTimeout(()=>{o=null,E(new x("preview-timeout"))},D.roomPreview)});y.catch(()=>{v&&h()});try{if(c&&(await Promise.race([c,l,y]),n?.aborted))throw new DOMException("Aborted","AbortError");let w=Re.get(r)??0;if(w>=js)throw new x("preview-unavailable");let E=r.sendMessagePromise({type:"call_service",domain:"matic_robot",service:"preview_room_sequence",target:{entity_id:t},service_data:{rooms:e.map(M=>({room:M.room,cleaning_mode:M.cleaning_mode,coverage_setting:M.coverage_setting})),use_room_schedule:!0,override_room_schedule:s},return_response:!0});Re.set(r,w+1),v=!0;let _=!1,p=()=>{if(!_){_=!0;let M=(Re.get(r)??1)-1;M===0?Re.delete(r):Re.set(r,M)}h(),o!==null&&window.clearTimeout(o),o=null};E.then(p,p);let S=await Promise.race([E,l,y]);if(n?.aborted)throw new DOMException("Aborted","AbortError");if(!S||typeof S!="object"||Array.isArray(S)||!("response"in S))throw new R("invalid-room-sequence-preview-envelope");return Bt(S.response)}finally{v||(c?c.then(h,h):h(),o!==null&&window.clearTimeout(o),o=null),n?.removeEventListener("abort",g)}}async saveArea(t,e,s){let n=await this.#h("areaSave",t,D.mutation,s,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...e.areaId?{area_id:e.areaId}:{},name:e.name,circles:e.circles,...e.outline?.closed?{outline:e.outline.points}:{},cleaning_mode:e.cleaningMode,coverage_setting:e.coverageSetting})});if(!n||typeof n!="object"||typeof n.id!="string")throw new R("invalid-area-save-response");return n.id}async deleteArea(t,e,s){await this.#s("areaDelete",`${t}?area_id=${encodeURIComponent(e)}`,{method:"DELETE",headers:{Accept:"application/json"}},D.mutation,s,async n=>{if(!n.ok)throw new x("area-delete-failed",n.status)})}async service(t,e,s,n,r={}){let o=this.#e();if(this.#a||typeof o?.callService!="function")throw new x("service-unavailable");let i=null,l=null;try{let c=r.returnResponse?o.callService(t,e,s,{entity_id:n},!0,!0):o.callService(t,e,s,{entity_id:n});return!r.returnResponse&&!r.acknowledgementTimeout?await c:await Promise.race([c,new Promise((d,u)=>{l=()=>{i!==null&&window.clearTimeout(i),i=null,u(new DOMException("Aborted","AbortError"))},this.#r.add(l),i=window.setTimeout(()=>u(new x("mutation-timeout")),D.mutation)})])}catch(c){throw Ys(c,o.localize)??c}finally{i!==null&&window.clearTimeout(i),l&&this.#r.delete(l)}}dispose(){if(!this.#a){this.#a=!0,this.#i.dispose();for(let t of this.#r)t();this.#r.clear(),this.#t.dispose()}}};var vs=()=>({version:4,view:"top",appearance:"photo",labels:!0,quality:"auto",cameras:{}}),Se=(a,t,e)=>Math.max(t,Math.min(e,a)),ys=a=>a.replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",pt=(a,t=4)=>`matic-map-studio:v${t}:${ys(a)}`,Xs=a=>{if(!a||typeof a!="object")return null;let t=a;return["yaw","pitch","zoom","targetX","targetZ"].every(s=>typeof t[s]=="number"&&Number.isFinite(t[s]))?{yaw:Se(t.yaw,-Math.PI,Math.PI),pitch:Se(t.pitch,.18,Math.PI/2-.018),zoom:Se(t.zoom,.01,100),targetX:Se(t.targetX,-1e4,1e4),targetZ:Se(t.targetZ,-1e4,1e4)}:null},fs=a=>{let t=vs();if(!a||typeof a!="object")return t;let e=a,s=e.view==="three"||e.view==="top"||e.view==="rooms"?e.view:t.view,n=s==="rooms"?"top":s,r=e.quality==="auto"||e.quality==="efficient"||e.quality==="balanced"||e.quality==="maximum"?e.quality:t.quality,o=e.cameras&&typeof e.cameras=="object"?e.cameras:{},i={};for(let l of["three","top"]){let c=Xs(o[l]);c&&(i[l]=c)}return{version:4,view:n,appearance:e.appearance==="rooms"||e.appearance==="photo"?e.appearance:t.appearance,labels:typeof e.labels=="boolean"?e.labels:t.labels,quality:r,cameras:i}},Ne=class{#e="local-user";#t=null;#n=null;load(t){this.#r(),this.#e=ys(t);try{let e=window.localStorage.getItem(pt(this.#e));if(e)return fs(JSON.parse(e));for(let s of[3,2]){let n=window.localStorage.getItem(pt(this.#e,s));if(n)return fs(JSON.parse(n))}}catch{}return vs()}schedule(t){this.#t!==null&&window.clearTimeout(this.#t),this.#n={key:pt(this.#e),value:t},this.#t=window.setTimeout(()=>this.#r(),250)}#r(){this.#t!==null&&window.clearTimeout(this.#t),this.#t=null;let t=this.#n;if(this.#n=null,!!t)try{window.localStorage.setItem(t.key,JSON.stringify(t.value))}catch{}}dispose(){this.#r()}};var ft=1,ce=Number.MAX_SAFE_INTEGER,ks=Number.MAX_SAFE_INTEGER,gs=64,Gs=1e12,mt=4,bs=16*1024,Qs=250,Js=4e3,Ke=3e4;function T(a){return a!==null&&typeof a=="object"&&!Array.isArray(a)?a:null}function F(a,t){return typeof a=="number"&&Number.isSafeInteger(a)&&a>=0&&a<=t}function Rs(a){let t=T(a);if(!t)return null;let e={};for(let[s,n]of Object.entries(t)){if(s.length===0||s.length>128||!F(n,ks))return null;e[s]=n}return e}function Zs(a){let t=T(a);if(!t||Object.keys(t).length>128)return null;let e={};for(let[s,n]of Object.entries(t)){if(s.length===0||s.length>128||!F(n,ks))return null;e[s]=n}return e}function Ss(a){return typeof a=="string"&&a.length>0&&a.length<=256?a:F(a,ce)?String(a):null}function en(a){let t=T(a),e=Ss(t?.epoch);if(!t||t.schema!==ft||e===null)return null;let s=Zs(t.capabilities),n=Rs(t.revisions);return!s||!n||!F(t.sequence,ce)||!F(t.coherence_generation,ce)||t.coherence_generation===0?null:{schema:t.schema,capabilities:s,epoch:e,sequence:t.sequence,coherence_generation:t.coherence_generation,revisions:n}}function ws(a,t){let e=T(a),s=en(e?.snapshot??a);if(!s)return null;let n=T(e?.snapshot??a);if(!n||!("payload"in n))return null;let r=n.entry_id,o=T(n.identity),i=T(n.status),l=T(n.payload),c=i?i.reason===null?null:Es(i.reason):null,d=l?.available,u=null;if(l?.entry!==void 0&&l.entry!==null){if((()=>{try{return JSON.stringify(l.entry).length}catch{return bs+1}})()>bs)return null;try{u=Oe({entries:[l.entry]})[0]??null}catch{return null}}let f=i?.state;return typeof r!="string"||r.length===0||r.length>128||t!==void 0&&r!==t||!o||o.entry_id!==r||o.floor_mission_id!==null&&!F(o.floor_mission_id,ce)||typeof o.floor_verified!="boolean"||o.floor_verified!==(o.floor_mission_id!==null)||!i||f!=="ready"&&f!=="stale"&&f!=="unavailable"||i.reason!==null&&c===null||typeof i.retryable!="boolean"||typeof d!="boolean"||u!==null&&u.entryId!==r||f==="ready"&&(c!==null||i.retryable||!d)||(f==="stale"||f==="unavailable")&&(c===null||d)||c==="authorization"&&i.retryable?null:{...s,entry_id:r,identity:{entry_id:r,floor_mission_id:o.floor_mission_id,floor_verified:o.floor_verified},status:{state:f,reason:c,retryable:i.retryable},payload:{available:d,entry:u}}}function _s(a){let t=T(a),e=Ss(t?.epoch),s=Rs(t?.revisions),n=t?.resources;return e===null||!s||!F(t?.sequence,ce)||!F(t?.coherence_generation,ce)||t.coherence_generation===0||!Array.isArray(n)||n.length>128||!n.every(r=>typeof r=="string"&&r.length<=128)?null:{epoch:e,sequence:t.sequence,coherence_generation:t.coherence_generation,revisions:s,resources:n}}var Fe=["gap","overflow","reconnect","invalid_message","server_request","restart","entry_removed","authorization","snapshot_required"];function Es(a){return typeof a=="string"&&Fe.includes(a)?a:null}function tn(a){let t=T(a);return t?.name==="AbortError"?"aborted":t?.name==="TimeoutError"?"timedOut":"failed"}function sn(){return Object.fromEntries(Fe.map(a=>[a,new le]))}var Ue=class{#e;#t;#n;#r=null;#i=!1;#a=!1;#o=!1;#s=!1;#h=!1;#f=!1;#d=0;#M=!1;#S=!1;#_=!1;#m=!1;#c=null;#g=null;#p=0;#T=!1;#v=null;#k=-1;#u=new Map;#P=!1;#L=!1;#A=null;#l=[];#q=new le;#y=sn();#E=null;#b=null;#C=null;constructor(t,e){this.#e=t,this.#t=e,this.#n=Math.max(1,Math.min(gs,e.maxPendingInvalidations??gs))}async start(){if(!(this.#i||this.#L)){this.#L=!0;try{await this.#O(!1)}catch(t){this.#z(t),this.#w("reconnect")}}}notifyReconnect(){(this.#s||this.#f)&&(this.#W(),this.#Q("aborted"),this.#d+=1),this.#p=0,this.#M=!1,this.#s=!1,this.#h=!1,this.#c!==null&&window.clearTimeout(this.#c),this.#c=null,this.requestResync("reconnect"),this.#o&&this.#$(0,!0)}requestResync(t="server_request"){this.#w(t,!0)}diagnostics(){let t=Object.fromEntries(Fe.map(s=>[s,this.#y[s].snapshot()])),e=this.#b!==null&&this.#C!==null?Object.freeze({reason:this.#b,durationMs:Math.round(Math.min(Gs,Math.max(0,performance.now()-this.#C))*100)/100}):null;return Object.freeze({snapshotAttempts:this.#q.snapshot(),recoveryEpisodes:Object.freeze(t),activeRecovery:e})}dispose(){if(!this.#i){this.#i=!0,this.#c!==null&&window.clearTimeout(this.#c),this.#c=null,this.#o=!1,this.#r?.(),this.#r=null,this.#u.clear(),this.#l=[],this.#E=null,this.#b=null,this.#C=null,this.#q.dispose();for(let t of Fe)this.#y[t].dispose()}}#B(t){if(this.#i)return;let e=T(t),s=T(e?.event)??e,n=s?.type;if(n==="resync"){let o=Es(s?.reason);if(!o){this.#w("invalid_message");return}if(o==="entry_removed"){this.#t.onEvent({type:"resync",reason:o}),this.dispose();return}this.#w(o);return}if(this.#s){if(n==="invalidate"){let o=_s(s?.invalidation??s);o?this.#U(o):(this.#l=[],this.#T=!0)}return}let r=n==="snapshot"?ws(s?.snapshot??s,this.#t.entryId):n==="invalidate"?_s(s?.invalidation??s):null;if(!r){this.#w("invalid_message");return}if(n==="snapshot"){let o=r;if(this.#o)return;if(this.#v!==null&&o.epoch!==this.#v){this.#w("restart");return}this.#K(o);return}this.#F(r)}#K(t){this.#v===t.epoch&&t.sequence<this.#k||(this.#v=t.epoch,this.#k=t.sequence,this.#u.clear(),this.#t.onEvent({type:"snapshot",snapshot:t}))}#Z(t){let e=this.#l;if(this.#l=[],this.#K(t),this.#i)return;let s=t.sequence+1;for(let n of e)if(n.epoch===t.epoch&&!(n.sequence<=t.sequence)&&!(n.sequence<s)){if(n.sequence!==s){this.#l=e.filter(r=>r.epoch===t.epoch&&r.sequence>=s),this.#w("gap");return}this.#F(n),s+=1}}#F(t){if(this.#o){this.#U(t);return}if(this.#v===null){this.#U(t);return}if(this.#v!==t.epoch){this.#U(t),this.#w("reconnect");return}if(!(t.sequence<=this.#k)){if(t.sequence!==this.#k+1){this.#U(t),this.#w("gap");return}this.#k=t.sequence;for(let e of t.resources)this.#u.set(e,t);if(this.#u.size>this.#n){this.#u.clear(),this.#w("overflow");return}this.#P||(this.#P=!0,queueMicrotask(()=>this.#ne()))}}#U(t){this.#l.length>=this.#n?(this.#l=[],this.#T=!0,this.#w("overflow")):this.#l.push(t)}#ne(){if(this.#P=!1,this.#i||this.#s||this.#u.size===0){this.#s&&this.#u.clear();return}let t=[...this.#u.values()];this.#u.clear();let e=t.reduce((n,r)=>!n||r.sequence>n.sequence?r:n,null);if(!e)return;let s=[...new Set(t.flatMap(n=>n.resources))];this.#t.onEvent({type:"invalidation",invalidation:{...e,resources:s}})}#w(t,e=!1){if(!this.#i){if(t==="authorization"){this.#D(),this.#t.onEvent({type:"resync",reason:t});return}if(!this.#s&&(this.#G(t),this.#a||(this.#a=!0,this.#t.onEvent({type:"resync",reason:t}),queueMicrotask(()=>{this.#a=!1})),t!=="entry_removed")){let s=e&&!this.#M;if(s&&(this.#M=!0),s&&this.#c!==null&&(window.clearTimeout(this.#c),this.#c=null),this.#_){if(this.#m){s&&this.#$(0,!0);return}this.#m=!0,this.#V(s);return}if(e&&this.#o){s&&(this.#S=!0);return}let n=this.#p>=mt?Ke:0;this.#$(s?0:n,s)}}}#$(t,e=!1){if(!this.#i){if(this.#c!==null){if(!e)return;window.clearTimeout(this.#c),this.#c=null}if(this.#o){this.#g=e?t:Math.max(this.#g??0,t);return}this.#c=window.setTimeout(()=>{this.#c=null,this.#O(!0)},t)}}#V(t=!1){let e=this.#p>=mt?Ke:Math.min(Qs*2**this.#p,Js);this.#p<mt&&(this.#p+=1),this.#$(t?0:e,t)}async#O(t,e=!1){if(this.#i||this.#o)return;t&&this.#G(e?"authorization":"snapshot_required");let s=this.#d;this.#o=!0,this.#f=e;try{if(t&&await this.#Y(),this.#i||this.#s&&!e||s!==this.#d)return;let n={startedAt:performance.now(),generation:s};this.#E=n;let r="completed",o;try{o=await this.#e.sendMessagePromise({type:"matic_robot/workspace_snapshot",version:ft,entry_id:this.#t.entryId})}catch(c){throw r=tn(c),c}finally{this.#H(n,r)}if(this.#i||this.#s&&!e||s!==this.#d)return;let i=ws(o,this.#t.entryId);if(!i)throw new Error("invalid-workspace-snapshot");if(i.status.reason==="authorization"){this.#D(),this.#t.onEvent({type:"snapshot",snapshot:i});return}if(i.status.state!=="ready"&&i.status.retryable)throw new Error("workspace-snapshot-retryable");e&&(this.#s=!1,this.#h=!1,this.#c!==null&&window.clearTimeout(this.#c),this.#c=null),this.#o=!1,this.#_=!0,this.#m=!1;try{t?this.#re(i):this.#Z(i)}finally{this.#_=!1}let l=this.#m||this.#T;this.#m?this.#S&&(this.#S=!1,this.#$(0,!0)):(this.#p=0,this.#M=!1,this.#S=!1),!t&&!this.#i&&await this.#Y(),this.#T&&(this.#T=!1,this.#w("overflow")),t&&i.status.state==="ready"&&!l&&!this.#i&&s===this.#d&&this.#Q("completed")}catch(n){if(this.#i||this.#s&&!e||s!==this.#d)return;if(this.#z(n),this.#X(n))this.#D(),this.#t.onEvent({type:"resync",reason:"authorization"});else if(!e){t||this.#G("reconnect");let r=this.#S;this.#S=!1,this.#V(r)}}finally{this.#o=!1,this.#f=!1,this.#h?(this.#h=!1,this.#ee(0)):e&&this.#s&&this.#ee(Ke);let n=this.#g;this.#g=null,n!==null&&this.#$(n)}}async#Y(){if(this.#i||this.#r)return;if(this.#A)return this.#A;let t=(async()=>{let e=await this.#e.subscribeMessage(s=>this.#B(s),{type:"matic_robot/workspace_subscribe",version:ft,entry_id:this.#t.entryId});this.#i?e():this.#r=e})();this.#A=t;try{await t}finally{this.#A===t&&(this.#A=null)}}#re(t){let e=this.#l;if(this.#l=[],this.#v===t.epoch&&t.sequence<this.#k){this.#l=e,this.#w("snapshot_required");return}if(this.#K(t),this.#i)return;let s=t.sequence+1;for(let n of e)if(n.epoch===t.epoch&&!(n.sequence<=t.sequence)&&!(n.sequence<s)){if(n.sequence!==s){this.#l=e.filter(r=>r.sequence>=s),this.#w("gap");return}this.#F(n),s+=1}}#X(t){let e=T(t),s=e?.code,n=e?.status??e?.statusCode;return s==="unauthorized"||s==="not_authorized"||s==="auth_invalid"||n===401||n===403}#G(t){this.#b!==null||this.#i||(this.#b=t,this.#C=performance.now())}#Q(t){let e=this.#b,s=this.#C;this.#b=null,this.#C=null,!(e===null||s===null||this.#i)&&this.#y[e].record(t,performance.now()-s)}#H(t,e){this.#E!==t||this.#i||t.generation!==this.#d||(this.#E=null,this.#q.record(e,performance.now()-t.startedAt))}#W(){let t=this.#E;t!==null&&(this.#E=null,!this.#i&&t.generation===this.#d&&this.#q.record("aborted",performance.now()-t.startedAt))}#D(){this.#W(),this.#Q("failed"),this.#d+=1,this.#s||(this.#s=!0,this.#c!==null&&window.clearTimeout(this.#c),this.#c=null,this.#h=!1),this.#u.clear(),this.#l=[],this.#T=!1,this.#g=null,this.#p=0,this.#M=!1,this.#S=!1,this.#f||this.#ee(Ke)}#ee(t){this.#i||this.#c!==null||this.#h||(this.#c=window.setTimeout(()=>{if(this.#c=null,!this.#i){if(this.#o){this.#h=!0;return}this.#O(!0,!0)}},t))}#z(t){this.#t.onError?.(t instanceof Error?t:new Error("Workspace transport failed"))}};var Ve=class{#e;#t;#n=document.visibilityState!=="hidden";#r=!1;#i=!1;#a=!1;constructor({onSuspend:t,onResume:e}){this.#e=t,this.#t=e}get active(){return this.#n}start(){this.#r||this.#i||(this.#r=!0,window.addEventListener("pagehide",this.#o),window.addEventListener("pageshow",this.#s),document.addEventListener("visibilitychange",this.#h),document.visibilityState==="hidden"&&(this.#n?this.#d(!1):this.#e()))}dispose(){this.#i||(this.#i=!0,this.#r&&(window.removeEventListener("pagehide",this.#o),window.removeEventListener("pageshow",this.#s),document.removeEventListener("visibilitychange",this.#h)))}#o=()=>{this.#a=!0,this.#d(!1)};#s=t=>{if(this.#a=!1,t.persisted){document.visibilityState==="hidden"?this.#d(!1):(this.#d(!1),this.#d(!0));return}this.#f()};#h=()=>{this.#f()};#f(){if(this.#a||document.visibilityState==="hidden"){this.#d(!1);return}this.#d(!0)}#d(t){this.#n===t||this.#i||(this.#n=t,t?this.#t():this.#e())}};var m=(a,t,e=null)=>({status:a,value:t,problem:e}),Ee=a=>a.status==="loading"?m("idle",a.value):a,$=a=>a instanceof DOMException&&a.name==="AbortError",B=(a,t)=>a instanceof x||a&&typeof a=="object"&&"code"in a&&typeof a.code=="string"?a.code:t,nn=a=>a instanceof x?a.recoveryMessage:null,ue=a=>[a.selectedFloorOrdinal??"none",a.mapFloorOrdinal??"none",a.mapFloorCoherent?"coherent":"transition"].join(":"),he=a=>[a.mapFloorOrdinal??"none",a.mapSessionVerified?"verified":"unverified",a.mapSessionKey??"no-session"].join(":"),W=a=>[a.entryId,a.selectedFloorOrdinal??"none",a.mapFloorOrdinal??"none"].join("|"),C=a=>[a.entryId,ue(a),he(a)].join("|"),vt=a=>[C(a),a.mapRevision].join("|"),je=a=>a.runnerLocked||a.stopSettlePending||a.activePlan||a.nativeReconciliationPending||a.nativeSessionActive===!0,Ye=(a,t)=>a.entryKey===t.entryKey&&a.generation===t.generation&&a.floorKey===t.floorKey&&a.missionKey===t.missionKey,de="Live map updates paused while the current map is rechecked.",Ms="Saved map from ",yt="Reconnecting. The last verified map remains read only.",rn=1e3,on=5e3,an=["rooms","plans","plan","draw","areaReview"],xs=["plan-mutation","area-mutation"],Cs=a=>JSON.stringify({...a,previewToken:void 0}),Xe=(a,t)=>a.label?a.label:a.active?"Current floor":`Saved floor ${a.ordinal??t}`,Ge=class{#e;#t;#n;#r;#i=new Ne;#a=null;#o=new Map;#s=null;#h=null;#f=null;#d=null;#M=0;#S=!1;#_=!1;#m=!1;#c=!1;#g=null;#p=Promise.resolve();#T=!1;#v=!1;#k="";#u=null;#P=0;#L=null;#A="";#l=!1;#q=!0;#y=null;#E=null;#b=null;#C=null;#B="";#K=!1;#Z;#F;workspaceDiagnostics(){return this.#y?.diagnostics()??null}constructor(t,e,s=null,n){this.#e=t,this.#t=new Ct(t.value.generation),this.#n=e,this.#Z=s,this.#F=n,this.#r=new Ve({onSuspend:()=>this.#U(),onResume:()=>{this.#ne()}}),this.#e.patch({pageActive:this.#r.active}),this.#C=t.subscribe(r=>{this.#w(r),this.#Y()}),this.#r.start()}#U(){this.#H(!1,xs),this.#N(),this.#j(xs),this.#m=!1,this.#c=!1,this.#g=null,this.#v=!1,this.#be();let t=this.#e.value;this.#e.patch({resources:{...t.resources,catalog:Ee(t.resources.catalog),scene:Ee(t.resources.scene),history:Ee(t.resources.history),plans:Ee(t.resources.plans),areas:Ee(t.resources.areas),pose:m("idle",null)}})}async#ne(){if(this.#l||!this.#r.active)return;this.#e.patch({pageActive:!0});let t=this.#s;if(this.#l||!this.#r.active||!t?.host.connected||!t.host.administrator||!t.host.robotConnected||t.host.robotCount===0)return;let e=this.#e.value;this.#oe(),this.#X(t),await this.refreshCatalog(!0,!0);let s=this.#e.value,n=s.resources.entry;if(this.#l||!this.#r.active||e.dataMode!=="history"||s.generation!==e.generation||s.dataMode!=="history"||s.selection.entryId!==e.selection.entryId||s.selection.floorId!==e.selection.floorId||s.selection.historyId!==e.selection.historyId||s.resources.catalog.status!=="ready"||!n||n.entryId!==s.selection.entryId)return;let r=s.resources.history.value?.floors.find(u=>u.id===s.selection.floorId),o=r?.snapshots.find(u=>u.id===s.selection.historyId);if(!r)return;let i=this.#t.begin(n.entryId,r.id,o?.id??r.id,o?.revision??0);if(this.#e.patch({generation:i.generation}),await this.#he(n,i),!this.#t.accepts(i)||!this.#r.active||this.#e.value.resources.history.status!=="ready")return;let l=this.#e.value,c=l.resources.history.value?.floors.find(u=>u.id===r.id),d=c?.snapshots.find(u=>u.id===o?.id);!c||o&&!d||(d&&d.revision!==i.revision&&(i=this.#t.begin(n.entryId,r.id,d.id,d.revision)),this.#e.patch({generation:i.generation,coherence:"current"}),d&&(!l.resources.scene.value||d.revision!==o?.revision)&&await this.#ve(d,i))}#w(t){if(!t.owner)return;let e={version:4,view:t.view,appearance:t.appearance,labels:t.labelsVisible,quality:t.quality,cameras:t.cameras},s=this.#a;this.#a=e,!(!s||s.view===e.view&&s.appearance===e.appearance&&s.labels===e.labels&&s.quality===e.quality&&s.cameras===e.cameras)&&this.#i.schedule(e)}#$(t){let e=Mt(t),s=t.resources.entry,n=this.#s?.vacuumEntityId;if(!e||!s||!n||!t.selection.entryId||t.workflow!=="rooms"||t.dataMode!=="live"||t.floor.readOnly||t.coherence!=="current"||!t.host.connected||!t.host.administrator||!t.host.robotConnected||t.command!=="idle"||t.resources.plans.status!=="ready")return null;let r=t.selection.roomIds.map(o=>{let i=t.selection.roomSettings.find(l=>l.roomId===o);return i?{room:o,cleaning_mode:i.cleaningMode,coverage_setting:i.coverageSetting}:null});return r.some(o=>o===null)?null:{key:e,generation:t.generation,retryRevision:t.manualRoomPreviewRetry,floorKey:ue(s),missionKey:he(s),entryId:t.selection.entryId,entityId:n,rooms:r,overrideRoomSchedule:!t.selection.useRoomSchedule}}#V(t){return JSON.stringify([t.key,t.generation,t.retryRevision,t.floorKey,t.missionKey,t.entryId,t.entityId])}#O(t){let e=this.#$(this.#e.value);return!this.#l&&e!==null&&this.#V(e)===this.#V(t)}#Y(){if(this.#l||!this.#s)return;let t=this.#e.value,e=this.#$(t);if(!e){this.#o.get("room-preview")?.abort(),this.#o.delete("room-preview"),this.#B="",(t.manualRoomPreview.status!=="idle"||t.manualRoomPreview.value!==null)&&this.#e.patch({manualRoomPreview:m("idle",null)});return}let s=this.#V(e),n=tt(t);if(n&&n.key===e.key&&n.generation===e.generation&&n.floorKey===e.floorKey&&n.missionKey===e.missionKey&&n.preview.entryId===e.entryId){this.#B=s;return}if(this.#B===s)return;this.#o.get("room-preview")?.abort(),this.#B=s;let r=this.#x("room-preview");this.#e.patch({manualRoomPreview:m("loading",null)}),this.#re(e,r)}async#re(t,e){try{let s=await this.#n.previewRoomSequence(t.entityId,t.rooms,t.overrideRoomSchedule,e.signal);return!this.#O(t)||e.signal.aborted||s.entryId!==t.entryId?null:(this.#e.patch({manualRoomPreview:m("ready",{key:t.key,generation:t.generation,floorKey:t.floorKey,missionKey:t.missionKey,preview:s})}),s)}catch(s){return $(s)||e.signal.aborted||!this.#O(t)||this.#e.patch({manualRoomPreview:m("error",null,B(s,"preview-unavailable"))}),null}finally{this.#I("room-preview",e)}}sync(t){if(this.#l)return;let e=this.#y,s=this.#s?.host.robotConnected??null,n=this.#s?.host.administrator===!1&&t.host.administrator,r=this.#s!==null&&!this.#s.host.robotConnected&&t.host.robotConnected,o=this.#e.value.owner,i=o!==null&&(o.entryKey!==t.entryKey||o.userKey!==t.userKey);i&&(this.#ue("context-changed",t.entryKey),this.#S&&(this.#m=!0,this.#c=!1,this.#g=null));let l=this.#q;this.#q=t.host.connected,this.#s=t,this.#X(t),r&&e&&e===this.#y&&e.notifyReconnect();let c=t.userKey!==this.#A?this.#i.load(t.userKey):null;if(c&&(this.#A=t.userKey,this.#a=c),this.#e.patch({owner:{userKey:t.userKey,entryKey:t.entryKey},host:t.host,activity:t.activity,batteryPercent:t.batteryPercent,robotLabel:t.robotLabel,robots:t.robots,locale:t.language,selection:{...this.#e.value.selection,entryId:t.entryKey},...c?{view:c.view,appearance:c.appearance,labelsVisible:c.labels,quality:c.quality,cameras:c.cameras}:{}}),!t.host.administrator){this.#N(),this.#ue("access-required",t.entryKey);return}if(!t.host.connected){l&&(this.#e.patch({generation:this.#t.invalidate()}),this.#D(),this.#k=""),this.#N(),this.#m=!1,this.#c=!1,this.#g=null,this.#v=!1,this.#j();let d=this.#e.value,u=d.resources.scene.value;this.#e.patch({coherence:u?"degraded":"unavailable",resources:{...d.resources,catalog:d.resources.catalog.status==="loading"?m("idle",d.resources.catalog.value):d.resources.catalog,plans:d.resources.plans.status==="loading"?m("idle",d.resources.plans.value):d.resources.plans,areas:d.resources.areas.status==="loading"?m("idle",d.resources.areas.value):d.resources.areas,pose:m("idle",null)},map:{...d.map,available:u!==null,exactPose:!1},notice:u?{tone:"warning",text:yt}:d.notice});return}if(t.host.robotCount===0){this.#N(),this.#ue("map-unavailable",t.entryKey);return}if(t.entryKey&&!t.vacuumEntityId){this.#N(),this.#ue("no-loaded-robot",t.entryKey);return}if(!t.host.robotConnected){s!==!1&&(this.#H(),this.#j(),this.#m=!1,this.#c=!1,this.#g=null,this.#v=!1),this.#N();let d=this.#e.value,u=d.resources.scene.value;this.#e.patch({coherence:u?"degraded":"unavailable",resources:{...d.resources,catalog:d.resources.catalog.status==="loading"?m("idle",d.resources.catalog.value):d.resources.catalog,scene:d.resources.scene.status==="loading"?m("idle",u):d.resources.scene,pose:m("idle",null)},map:{...d.map,available:u!==null,exactPose:!1}});return}if(this.#r.active){if(this.#oe(),!l||r||n){this.#e.value.notice?.text===yt&&this.#e.patch({notice:null}),this.refreshCatalog(!0,!0);return}(i||this.#e.value.resources.catalog.status==="idle"||t.entryKey&&t.entryKey!==this.#e.value.selection.entryId)&&this.refreshCatalog(!0)}}#X(t){let e=t.entryKey,s=this.#e.value,n=s.resources.catalog.value?.find(l=>l.entryId===e),r=s.resources.entry;if(!(this.#F??!!(n?.liveWorkspaceTransportEnabled&&r?.entryId===e&&r.liveWorkspaceTransportEnabled))||!this.#Z||!t.host.administrator||!t.host.connected||!t.vacuumEntityId||!e||!this.#r.active){this.#be();return}if(this.#y&&this.#E===e)return;this.#y?.dispose(),this.#b=null;let i=new Ue(this.#Z,{entryId:e,onEvent:l=>{if(!(this.#l||!this.#r.active||this.#y!==i||this.#E!==e||this.#s?.entryKey!==e)){if(l.type==="resync"&&l.reason==="entry_removed"){i.dispose(),this.#y===i&&(this.#y=null,this.#E=null,this.#b=null);return}if(l.type==="snapshot"){let{snapshot:c}=l,d=this.#e.value.resources.entry,u=c.payload.entry;if(c.entry_id!==e||c.identity.entry_id!==e)return;if(u&&(u.entryId!==e||c.identity.floor_verified!==(u.mapFloorCoherent&&u.mapSessionVerified))){i.requestResync("invalid_message");return}let f=!u&&d?.entryId===e&&c.identity.floor_verified!==(d.mapFloorCoherent&&d.mapSessionVerified);if(c.status.reason==="authorization"){this.#b=null,this.#W(e,["plans","areas","history"]);return}let h=this.#b,v=[],g=h!==null&&h.epoch!==c.epoch;if(h&&h.epoch===c.epoch){let _=new Set([...Object.keys(h.revisions),...Object.keys(c.revisions)]),p=[..._].some(S=>(c.revisions[S]??-1)<(h.revisions[S]??-1));if(c.coherence_generation<h.coherenceGeneration||c.coherence_generation===h.coherenceGeneration&&p){i.requestResync("restart");return}v=[..._].filter(S=>(c.revisions[S]??-1)>(h.revisions[S]??-1))}g&&(v=["plans","areas","history"]);let y=h!==null&&(h.epoch!==c.epoch||h.coherenceGeneration!==c.coherence_generation),w=!!(d&&u&&d.entryId===e&&C(d)!==C(u));if(this.#b={entryId:c.entry_id,epoch:c.epoch,sequence:c.sequence,coherenceGeneration:c.coherence_generation,revisions:c.revisions},f){this.#W(e,["plans","areas","history"]);return}if(y||w){this.#W(e,v);return}let E=u!==null&&d?.entryId===e&&this.#Q(u);if(h&&v.length){if(c.sequence<=h.sequence){i.requestResync("invalid_message");return}this.#b=h,this.#G({epoch:c.epoch,sequence:c.sequence,coherence_generation:c.coherence_generation,revisions:c.revisions,resources:v},e,i,E)}return}if(l.type==="resync"){this.#b=null,l.reason!=="authorization"&&this.#W(e,["plans","areas","history"]);return}this.#G(l.invalidation,e,i)}},onError:()=>this.#e.patch({notice:{tone:"warning",text:yt}})});this.#y=i,this.#E=e,i.start()}#G(t,e,s,n=!1){let r=this.#b;if(!r||r.entryId!==e||this.#y!==s||t.epoch!==r.epoch||t.sequence<=r.sequence)return;let o=t.coherence_generation!==r.coherenceGeneration,l=[...new Set([...Object.keys(r.revisions),...Object.keys(t.revisions)])].some(h=>(t.revisions[h]??-1)<(r.revisions[h]??-1));if(t.coherence_generation<r.coherenceGeneration||!o&&l){s.requestResync("restart");return}let c=new Set(t.resources),d=[...c].some(h=>(t.revisions[h]??-1)>(r.revisions[h]??-1));if(this.#b={...r,sequence:t.sequence,coherenceGeneration:t.coherence_generation,revisions:t.revisions},!d&&!o)return;if(o){this.#W(e,t.resources);return}c.has("scene")&&c.delete("scene");let u=this.#e.value.resources.entry,f=this.#t.current();!u||u.entryId!==e||!f||c.size&&this.#z(u,f,c,!n)}#Q(t){let e=this.#e.value,s=e.resources.entry;if(!s||C(s)!==C(t))return!1;let n=t.mapRevision===s.mapRevision?t:{...t,mapRevision:s.mapRevision},r=e.resources.catalog,o=r.value?.map(u=>u.entryId===n.entryId?n:u),i=n.mapFloorCoherent&&n.mapSessionVerified,l=n.health==="problem"||n.health==="limited",c=this.#u,d=c?.key===C(n)&&this.#se(c)&&(c.attempt!==null||c.retryTimer!==null);return this.#e.patch({managedLock:je(n),coherence:d?"verifying":i?l?"degraded":"current":"verifying",map:{...e.map,available:e.resources.scene.value!==null,complete:n.mapComplete&&!n.mapTruncated,floorCoherent:n.mapFloorCoherent,sessionVerified:n.mapSessionVerified,exactPose:i&&!d?e.map.exactPose:!1},floor:{...e.floor,classifiedCount:Math.max(1,n.historyFloorCount),...d&&e.resources.scene.value?{readOnly:!0}:{}},resources:{...e.resources,entry:n,...o?{catalog:{...r,value:o}}:{}}}),this.#s&&this.#X(this.#s),!0}#H(t=this.#e.value.pageActive,e=[]){let s=this.#t.invalidate();this.#D();let n=this.#e.value;this.#e.patch({generation:s,pageActive:t,coherence:n.resources.scene.value?"verifying":"unavailable",floor:{...n.floor,readOnly:n.floor.readOnly||n.resources.scene.value!==null},map:{...n.map,exactPose:!1}}),this.#u&&this.#ie(this.#u.key),this.#j(["catalog",...e]),this.#k=""}#W(t,e=[]){this.#R(),this.#H(),this.refreshCatalog(!0,!0).then(()=>{if(this.#l||this.#s?.entryKey!==t||!this.#s.host.administrator||!this.#s.host.connected)return;let s=this.#e.value.resources.entry,n=this.#t.current();if(!s||s.entryId!==t||!n)return;let r=new Set(e);r.delete("history"),this.#z(s,n,r,!1)})}#D(){this.#P+=1,this.#L=null}#ee(t){let e=this.#L,s=this.#t.current();return!!(e&&s&&e.generation===this.#P&&e.stamp.generation===s.generation&&e.entryId===t.entryId&&e.coherenceIdentity===C(t)&&e.deltaUrl===t.deltaUrl&&s.entryKey===t.entryId&&s.floorKey===ue(t)&&s.missionKey===he(t)&&t.mapFloorCoherent&&t.mapSessionVerified&&this.#e.value.dataMode==="live"&&this.#e.value.selection.floorId==="current"&&this.#s?.host.connected&&this.#s.host.robotConnected&&this.#s.host.administrator)}#z(t,e,s,n=!0){(s.has("plans")||s.has("plan_state"))&&this.loadPlans(),s.has("areas")&&this.loadAreas(),s.has("history")&&this.#he(t,e),n&&["status","robot_state","activity","plan_state"].some(r=>s.has(r))&&this.refreshCatalog(!0,!0,!0)}#oe(){this.#r.active&&(this.#h===null&&(this.#h=window.setInterval(()=>{this.refreshCatalog()},5e3)),this.#f===null&&(this.#f=window.setInterval(()=>{this.refreshPose()},rn)))}#N(){this.#h!==null&&window.clearInterval(this.#h),this.#f!==null&&window.clearInterval(this.#f),this.#h=null,this.#f=null,this.#R()}#R(){let t=this.#u;if(this.#u=null,!t)return;t.attempt?.finishReplacementRead?.(),t.attempt&&(t.attempt.finishReplacementRead=null),t.retryTimer!==null&&window.clearTimeout(t.retryTimer);let e=t.attempt?.controller,s=!!(e&&e===this.#o.get("catalog")&&this.#e.value.resources.catalog.status==="loading");if(e?.abort(),s){let n=this.#e.value.resources;this.#e.patch({resources:{...n,catalog:m("idle",n.catalog.value)}})}this.#g?.state===t&&(this.#m=!1,this.#c=!1,this.#g=null)}#J(t,e){let s=this.#u;s?.key===C(e)&&(s.failedKinds.delete(t),t==="delta"&&this.#te(e),s.failedKinds.size===0&&this.#R())}#te(t){this.#ie(C(t))}#ie(t){let e=this.#u;e?.key===t&&(e.attempt?.finishReplacementRead?.(),e.attempt&&(e.attempt.finishReplacementRead=null))}#ae(t,e){let s=C(e),n=this.#u;n?.key!==s&&(this.#R(),n={key:s,failedKinds:new Set,retryTimer:null,attempt:null},this.#u=n),n.failedKinds.add(t),t==="delta"&&this.#te(e),this.#se(n)&&this.#t.current()&&this.#H(),!n.attempt&&n.retryTimer===null&&(n.failedKinds.size===1&&n.failedKinds.has(t)?this.#ce(n):this.#le(n))}#se(t){let e=this.#e.value;return t.failedKinds.has("pose")||e.floor.readOnly||!e.map.floorCoherent||!e.map.sessionVerified}#le(t){t.retryTimer!==null||t.failedKinds.size===0||(t.retryTimer=window.setTimeout(()=>{t.retryTimer=null;let e=this.#e.value.resources.entry,s=this.#s?.host;if(this.#u!==t||this.#l||!e||C(e)!==t.key||this.#e.value.dataMode!=="live"||this.#e.value.selection.floorId!=="current"||!s?.connected||!s.administrator||!s.robotConnected||s.robotCount===0){this.#u===t&&this.#R();return}this.#ce(t)},on))}async#ce(t){if(this.#l||this.#u!==t||t.attempt)return;let e=this.#e.value.resources.entry,s=this.#s?.host;if(!e||C(e)!==t.key||this.#e.value.dataMode!=="live"||this.#e.value.selection.floorId!=="current"||!s?.connected||!s.administrator||!s.robotConnected||s.robotCount===0){this.#u===t&&this.#R();return}if(this.#o.has("scene")){this.#le(t);return}let n=this.#se(t);n?this.#t.current()&&this.#H():(this.#D(),this.#o.get("delta")?.abort());let r,o=new Promise(c=>{r=c}),i={generation:this.#t.generation,controller:null,replacementRead:o,finishReplacementRead:r};t.attempt=i;let l={state:t,attempt:i};try{await this.refreshCatalog(!0,!1,!n,l),t.failedKinds.has("delta")&&this.#u===t&&t.attempt===i&&await i.replacementRead}finally{if(this.#u!==t||t.attempt!==i)return;i.finishReplacementRead=null,t.attempt=null,t.failedKinds.size>0&&this.#le(t)}}#de(t){let e=this.#e.value,s=this.#s?.host;return!this.#l&&this.#r.active&&this.#u===t.state&&t.state.attempt===t.attempt&&t.attempt.generation===this.#t.generation&&e.generation===this.#t.generation&&e.dataMode==="live"&&e.selection.floorId==="current"&&e.resources.entry!==null&&C(e.resources.entry)===t.state.key&&!!(s?.connected&&s.administrator&&s.robotConnected&&s.robotCount>0)}#x(t){this.#o.get(t)?.abort();let e=new AbortController;return this.#o.set(t,e),e}#I(t,e){this.#o.get(t)===e&&this.#o.delete(t)}#j(t=[]){let e=!1;for(let[s,n]of this.#o)t.includes(s)||(e||=s==="plan-mutation"||s==="area-mutation"||s==="plan-preflight",n.abort(),this.#o.delete(s));e&&this.#e.value.command==="pending"&&this.#e.patch({command:"idle",notice:null})}#we(){this.#M+=1,this.#d!==null&&window.clearTimeout(this.#d),this.#d=null}#ue(t,e=null){this.#R(),this.#we(),this.#t.invalidate(),this.#D(),this.#k="";let s=this.#t.generation;this.#j();let n=this.#e.value,r=O();this.#e.patch({command:"idle",dataMode:r.dataMode,floor:r.floor,managedLock:!1,workflow:"none",dialog:null,notice:null,draftFloorOrdinal:null,draw:r.draw,planDraft:r.planDraft,areaDraft:r.areaDraft,generation:s,coherence:n.host.administrator?"unavailable":"blocked",fullMap:!1,precisionOpen:!1,resources:{catalog:m("error",null,t),entry:null,scene:m("idle",null),pose:m("idle",null),history:m("idle",null),plans:m("idle",null),areas:m("idle",null)},manualRoomPreview:m("idle",null),map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1},selection:{...r.selection,entryId:e,entrySource:n.selection.entrySource,floorId:"current",historyId:null}})}async refreshCatalog(t=!1,e=!1,s=!1,n=null){if(this.#l||!this.#r.active||!this.#s?.host.administrator||!this.#s.host.connected||this.#s.host.robotCount===0||n&&(!this.#s.host.robotConnected||!this.#de(n)))return;if(this.#S)return t&&(this.#_?e&&(this.#m?this.#c&&=s:this.#c=s,this.#m=!0):(this.#m?this.#c&&=s:this.#c=s,this.#m=!0,this.#o.get("catalog")?.abort()),n&&(this.#m?this.#c&&=s:this.#c=s,this.#g=n,this.#m=!0)),this.#p;this.#S=!0,this.#_=t;let r;this.#p=new Promise(l=>{r=l});let o=this.#x("catalog");n&&(n.attempt.controller=o);let i=this.#e.value.resources.catalog.value;this.#e.patch({resources:{...this.#e.value.resources,catalog:m("loading",i)}});try{let l=await this.#n.catalog(o.signal);if(o.signal.aborted||this.#l||n&&!this.#de(n))return;let c=this.#s?.entryKey,d=c?l.find(y=>y.entryId===c)??null:l[0]??null,u=this.#e.value.resources.entry;if(d&&this.#u?.key===C(d)&&(this.#u.attempt!==null||this.#u.retryTimer!==null)&&(!n||!this.#de(n))){this.#e.patch({managedLock:je(d),resources:{...this.#e.value.resources,catalog:m(l.length?"ready":"empty",l),entry:u}});return}let f=!!(d&&u&&C(d)===C(u)&&this.#ee(u));if(d&&u&&W(d)===W(u)&&ue(d)===ue(u)&&he(d)===he(u)&&(f||d.mapRevision<u.mapRevision||!t&&this.#o.has("scene"))&&(d={...d,mapRevision:u.mapRevision}),this.#e.patch({managedLock:d?je(d):!1,resources:{...this.#e.value.resources,catalog:m(l.length?"ready":"empty",l),entry:d}}),this.#s&&this.#X(this.#s),!d){this.#ue("no-loaded-robot",this.#s?.entryKey??null);return}if(this.#e.value.selection.floorId!=="current"||this.#e.value.dataMode!=="live"){n&&this.#te(d);return}let h=vt(d),v=this.#t.current(),g=!!(v&&u&&C(d)===C(u)&&d.mapFloorCoherent&&d.mapSessionVerified);if((!t||s)&&(h===this.#k||g)){let y=this.#e.value,w=d.mapFloorCoherent&&d.mapSessionVerified,E=d.health==="problem"||d.health==="limited";this.#e.patch({coherence:w?E?"degraded":"current":"verifying",map:{...y.map,available:y.resources.scene.value!==null,complete:d.mapComplete&&!d.mapTruncated,floorCoherent:d.mapFloorCoherent,sessionVerified:d.mapSessionVerified,exactPose:w?y.map.exactPose:!1},floor:{...y.floor,classifiedCount:Math.max(1,d.historyFloorCount)}}),w&&this.#e.value.resources.plans.problem==="map-rechecking"&&this.loadPlans(),this.#ye();let _=v;if(_&&g&&(d.mapRevision>_.revision||n!==null)&&(d.mapRevision>_.revision&&(_=this.#t.advance(_,d.mapRevision)),_)){this.#k=h,this.#D();let p=this.#e.value.resources;this.#e.patch({resources:{...p,scene:m("loading",p.scene.value)}}),this.#me(d,_)}_&&!y.resources.scene.value&&!this.#o.has("history")&&this.#he(d,_),w&&_&&(y.resources.scene.status==="error"||y.floor.readOnly)&&!this.#o.has("scene")&&this.#me(d,_);return}this.#k=h,this.#_e(d,u)}catch(l){if($(l)||o.signal.aborted||this.#l)return;n&&this.#ie(n.state.key),this.#e.patch({coherence:this.#e.value.resources.scene.value?"degraded":"unavailable",resources:{...this.#e.value.resources,catalog:m("error",i,B(l,"catalog-unavailable"))}})}finally{this.#I("catalog",o),n?.attempt.controller===o&&(n.attempt.controller=null),this.#S=!1;let l=this.#m,c=this.#c,d=this.#g;this.#_=!1;try{l&&!this.#l&&(this.#m=!1,this.#c=!1,this.#g=null,await this.refreshCatalog(!0,!1,c,d))}finally{r()}}}#_e(t,e){this.#u!==null&&this.#u.key!==C(t)&&this.#R();let s=this.#e.value,n=!!(e&&W(e)===W(t)),r=t.mapFloorCoherent&&t.mapSessionVerified,o=s.draftMapSessionKey??(e?.mapFloorCoherent&&e.mapSessionVerified?e.mapSessionKey:null),i=s.draftFloorOrdinal??(e?.mapFloorCoherent&&e.mapSessionVerified?e.mapFloorOrdinal:null),l=r?t.mapFloorOrdinal:null,c=r?t.mapSessionKey:null,d=e!==null&&e.entryId!==t.entryId||i!==null&&l!==null&&i!==l||o!==null&&c!==null&&o!==c,u=n&&r&&i===t.mapFloorOrdinal&&o===t.mapSessionKey,f=["catalog"];n&&!d&&f.push("plans","areas"),u&&f.push("plan-mutation","area-mutation");let h=this.#t.begin(t.entryId,ue(t),he(t),t.mapRevision);this.#u?.key===C(t)&&this.#u.attempt&&(this.#u.attempt.generation=h.generation),this.#D(),this.#j(f);let v=e?.entryId===t.entryId?s.resources.scene.value:null,g=v!==null&&(s.floor.readOnly||!n||!r||e?.mapSessionKey!==t.mapSessionKey),y=s.resources.pose.value,w=n&&r&&t.mapSessionKey!==null&&y?.position&&y.mapSessionKey===t.mapSessionKey?y:null;d&&this.#we();let E=O(),_=t.health==="problem"||t.health==="limited",p=this.#e.value;this.#e.patch({...d?{command:"idle",workflow:"none",dialog:null,precisionOpen:!1,fullMap:!1,draw:E.draw,planDraft:E.planDraft,areaDraft:E.areaDraft,notice:{tone:"info",text:"The active map changed. Choose a task on this map."}}:{},draftFloorOrdinal:l??i,draftMapSessionKey:c??o,managedLock:je(t),generation:h.generation,coherence:r?_?"degraded":g?"verifying":"current":"verifying",dataMode:"live",...!r&&v?{notice:{tone:"warning",text:de}}:{},resources:{...p.resources,entry:t,scene:m(r?"loading":"idle",v),pose:m(r?"loading":"idle",w),history:m("loading",p.resources.history.value),plans:n&&!d?p.resources.plans:m("idle",null),areas:n&&!d?p.resources.areas:m("idle",null)},map:{available:v!==null,complete:t.mapComplete&&!t.mapTruncated,floorCoherent:t.mapFloorCoherent,sessionVerified:t.mapSessionVerified,exactPose:r&&w!==null&&!g},floor:{classifiedCount:Math.max(1,t.historyFloorCount),displayName:g?s.floor.displayName:t.selectedFloorOrdinal?`Floor ${t.selectedFloorOrdinal}`:"Current floor",readOnly:g},selection:{...p.selection,entryId:t.entryId,floorId:"current",historyId:null,roomIds:d?[]:p.selection.roomIds,roomSettings:d?[]:p.selection.roomSettings,planId:d?null:p.selection.planId,areaId:d?null:p.selection.areaId}}),this.#he(t,h),r&&this.#e.value.resources.plans.status==="idle"&&this.loadPlans(),this.#ye(),r&&(this.#me(t,h),this.#fe(t,h))}async#me(t,e){if(!this.#r.active)return;let s=this.#x("scene");try{let n=await this.#n.scene(t.sceneUrl,t.mapRevision,t.mapFloorCoherent,"live",s.signal);if(!this.#t.accepts(e))return;if(!n.floorCoherent){let c=this.#e.value;this.#e.patch({coherence:"verifying",resources:{...c.resources,scene:m("error",c.resources.scene.value,"map-rechecking"),pose:m("idle",null)},map:{...c.map,available:c.resources.scene.value!==null,floorCoherent:!1,exactPose:!1},floor:{...c.floor,readOnly:c.resources.scene.value!==null},notice:{tone:"warning",text:de}}),this.#te(t);return}if(n.revision<e.revision||!n.scene)throw new x("scene-unavailable");let r=n.revision===e.revision?e:this.#t.advance(e,n.revision);if(!r)throw new x("scene-unavailable");let o=this.#e.value,i={...o.resources.entry??t,mapRevision:n.revision};this.#k=vt(i),this.#e.patch({coherence:i.health==="problem"||i.health==="limited"?"degraded":"current",resources:{...o.resources,entry:i,scene:m("ready",n.scene)},map:{...o.map,available:!0},floor:{...o.floor,readOnly:!1,displayName:o.resources.history.value?.floors.find(c=>c.active)?.label||(i.selectedFloorOrdinal?`Floor ${i.selectedFloorOrdinal}`:"Current floor")},notice:o.notice?.text===de||o.notice?.text.startsWith(Ms)?null:o.notice});let l=this.#e.value.resources.plans;if((l.status==="idle"||l.problem==="map-rechecking")&&this.loadPlans(),this.#ye(),t.deltaUrl&&typeof DecompressionStream=="function"){let c=++this.#P;this.#ke(i,r,n.scene,c)}else this.#J("delta",i)}catch(n){if($(n)||!this.#t.accepts(e))return;if(n instanceof x&&n.code==="request-timeout"){let l=this.#e.value;this.#e.patch({resources:{...l.resources,scene:m("loading",l.resources.scene.value,"scene-building")}}),window.setTimeout(()=>{this.#l||!this.#t.accepts(e)||this.#e.value.selection.floorId!=="current"||this.#me(t,e)},250);return}this.#te(t);let r=this.#e.value,o=r.resources.pose.value,i=r.resources.scene.value!==null&&t.mapSessionKey!==null&&o?.position!==null&&o?.mapSessionKey===t.mapSessionKey;this.#e.patch({coherence:"degraded",resources:{...r.resources,scene:m("error",r.resources.scene.value,B(n,"scene-unavailable"))},map:{...r.map,available:r.resources.scene.value!==null,exactPose:i}})}finally{this.#I("scene",s)}}async#ke(t,e,s,n){if(!t.deltaUrl||typeof DecompressionStream!="function")return;let r=t.deltaUrl,o={generation:n,stamp:e,entryId:t.entryId,coherenceIdentity:C(t),deltaUrl:r};if(n!==this.#P||!this.#t.accepts(e))return;this.#L=o;let i=t,l=e,c=s;try{for(;!this.#l&&this.#r.active&&n===this.#P&&this.#t.accepts(l)&&this.#e.value.selection.floorId==="current";){let d=this.#x("delta");try{let u=await this.#n.sceneDelta(r,c,i.mapFloorCoherent,d.signal);if(d.signal.aborted||this.#l||n!==this.#P||!this.#t.accepts(l))return;if(!u.floorCoherent){let v=this.#e.value;this.#e.patch({coherence:"verifying",map:{...v.map,available:v.resources.scene.value!==null,floorCoherent:!1,exactPose:!1},floor:{...v.floor,readOnly:v.resources.scene.value!==null},resources:{...v.resources,scene:m("error",v.resources.scene.value,"map-rechecking"),pose:m("idle",null)},notice:{tone:"warning",text:de}}),this.#ae("delta",i);return}if(u.notModified||!u.scene){this.#J("delta",i),await new Promise(v=>window.setTimeout(v,100));continue}let f=this.#t.advance(l,u.revision);if(!f)return;l=f,o.stamp=f,c=u.scene,i={...i,mapRevision:u.revision},this.#J("delta",i),this.#k=vt(i);let h=this.#e.value;this.#e.patch({resources:{...h.resources,entry:i,scene:m("ready",c)},map:{...h.map,available:!0,floorCoherent:!0}}),this.#fe(i,l)}finally{this.#I("delta",d)}}}catch(d){if($(d)||this.#l||n!==this.#P||!this.#t.accepts(l))return;this.#e.patch({notice:{tone:"warning",text:de}}),this.#ae("delta",i)}finally{this.#L===o&&(this.#L=null)}}async#he(t,e){if(!this.#r.active)return;let s=this.#x("history");try{let n=await this.#n.history(t.historyUrl,s.signal),r=this.#t.current();if(s.signal.aborted||!r||!Ye(e,r)||n.entryId!==t.entryId)return;let o=this.#e.value,i=n.floors.find(d=>d.id===o.selection.floorId),l=!o.selection.historyId||i?.snapshots.some(d=>d.id===o.selection.historyId),c=o.dataMode==="live"?n.floors.find(d=>d.active):i;if(this.#e.patch({resources:{...this.#e.value.resources,history:m("ready",n)},floor:{...this.#e.value.floor,classifiedCount:n.floors.length,...c&&!(o.dataMode==="live"&&o.floor.readOnly)?{displayName:Xe(c,1)}:{}}}),o.dataMode==="live"&&!o.resources.scene.value){let d=n.floors.flatMap(u=>u.snapshots.map(f=>({floor:u,snapshot:f}))).sort((u,f)=>Date.parse(f.snapshot.createdAt)-Date.parse(u.snapshot.createdAt));for(let u of d){let f;try{f=await this.#n.scene(u.snapshot.sceneUrl,u.snapshot.revision,!0,"history",s.signal)}catch(g){if($(g)||s.signal.aborted)return;continue}let h=this.#t.current();if(s.signal.aborted||!h||!Ye(e,h)||this.#e.value.resources.scene.value)return;if(!f.scene)continue;let v=this.#e.value;this.#e.patch({floor:{...v.floor,readOnly:!0,displayName:Xe(u.floor,1)},resources:{...v.resources,scene:m("ready",f.scene),pose:m("idle",null)},map:{...v.map,available:!0,exactPose:!1},notice:{tone:"warning",text:`${Ms}${new Date(u.snapshot.createdAt).toLocaleString()}. Live position is unavailable.`}});break}}if(o.dataMode==="history"&&(!i||!l)){let d=i||n.floors.find(f=>f.active)||n.floors[0],u=this.selectFloor(d?.id||"current");!this.#l&&o.workflow==="history"&&this.#e.dispatch({type:"open-workflow",workflow:"history"}),await u}}catch(n){let r=this.#t.current();if($(n)||s.signal.aborted||!r||!Ye(e,r))return;this.#e.patch({resources:{...this.#e.value.resources,history:m("error",null,B(n,"history-unavailable"))}})}finally{this.#I("history",s)}}async refreshPose(){let t=this.#e.value.resources.entry,e=this.#t.current();!t||!e||this.#e.value.selection.floorId!=="current"||!t.mapFloorCoherent||!t.mapSessionVerified||await this.#fe(t,e)}async#fe(t,e){if(this.#l||!this.#r.active||!this.#q||!this.#s?.host.connected)return;if(this.#T){this.#v=!0;return}this.#T=!0;let s=this.#x("pose");try{let n=await this.#n.pose(t.poseUrl,s.signal),r=this.#t.current(),o=this.#e.value.resources.entry;if(!r||!Ye(e,r)||!o||!this.#e.value.map.floorCoherent)return;if(!n.floorCoherent||n.mapSessionKey===null||n.mapSessionKey!==o.mapSessionKey){this.#e.patch({resources:{...this.#e.value.resources,pose:m("idle",null)},map:{...this.#e.value.map,exactPose:!1}}),this.#ae("pose",o);return}this.#J("pose",o);let i=this.#e.value,l=i.resources.pose.value,c=!!(i.map.exactPose&&l?.position&&l.mapSessionKey===o.mapSessionKey);if(n.position===null&&c){this.#e.patch({resources:{...i.resources,pose:m("ready",l)}});return}this.#e.patch({resources:{...i.resources,pose:m("ready",n)},map:{...i.map,exactPose:n.position!==null}})}catch(n){if($(n)||!this.#t.accepts(e))return;let r=this.#e.value,o=r.resources.pose.value,i=!!(r.map.exactPose&&o?.position&&o.mapSessionKey===r.resources.entry?.mapSessionKey);this.#e.patch({resources:{...r.resources,pose:m("error",i?o:null,B(n,"pose-unavailable"))},map:{...r.map,exactPose:i}})}finally{if(this.#I("pose",s),this.#T=!1,this.#v&&!this.#l&&this.#q&&this.#s?.host.connected&&this.#s.host.administrator&&this.#s.host.robotCount>0){this.#v=!1;let n=this.#e.value.resources.entry,r=this.#t.current();n&&r&&this.#fe(n,r)}else this.#v=!1}}async selectFloor(t){let e=this.#e.value.resources.history.value,s=this.#e.value.resources.entry;if(!e||!s)return;let n=e.floors.find(l=>l.id===t);if(!n&&t!=="current")return;let r=this.#e.value;if(r.workflow==="draw"&&(r.draw.dirty||r.areaDraft.dirty)||r.workflow==="areaReview"&&(r.draw.dirty||r.areaDraft.dirty))return;if(!n||n.active){this.#R(),this.#k="";let l=this.#e.value;this.#e.patch({resources:{...l.resources,plans:m("idle",null),areas:m("idle",null),scene:m("idle",l.resources.scene.value),pose:m("idle",null)},map:{...l.map,available:l.resources.scene.value!==null,exactPose:!1},coherence:"verifying",floor:{...l.floor,readOnly:l.resources.scene.value!==null},notice:l.resources.scene.value?{tone:"warning",text:de}:l.notice,workflow:"none",precisionOpen:!1}),this.#e.dispatch({type:"set-floor",floorId:"current"}),await this.refreshCatalog(!0);return}this.#R();let o=n.snapshots.at(-1),i=this.#t.begin(s.entryId,n.id,o?.id||n.id,o?.revision||0);this.#j(["catalog"]),this.#e.patch({generation:i.generation,coherence:"current",dataMode:"history",floor:{classifiedCount:e.floors.length,displayName:Xe(n,e.floors.indexOf(n)+1),readOnly:!0},selection:{...this.#e.value.selection,floorId:n.id,historyId:o?.id||null},resources:{...this.#e.value.resources,scene:m(o?"loading":"empty",null),pose:m("idle",null),plans:m("idle",null),areas:m("idle",null)},workflow:"none",precisionOpen:!1,map:{available:!1,complete:!0,floorCoherent:!0,sessionVerified:!0,exactPose:!1}}),o&&await this.#ve(o,i)}async selectHistory(t){let e=this.#e.value.resources.history.value,s=this.#e.value.resources.entry;if(!e||!s)return;if(!t){await this.selectFloor("current");return}let n=e.floors.find(i=>i.snapshots.some(l=>l.id===t)),r=n?.snapshots.find(i=>i.id===t);if(!n||!r)return;this.#R();let o=this.#t.begin(s.entryId,n.id,r.id,r.revision);this.#j(["catalog"]),this.#e.patch({generation:o.generation,dataMode:"history",floor:{classifiedCount:e.floors.length,displayName:Xe(n,e.floors.indexOf(n)+1),readOnly:!0},selection:{...this.#e.value.selection,floorId:n.id,historyId:r.id},resources:{...this.#e.value.resources,scene:m("loading",null),pose:m("idle",null)},map:{...this.#e.value.map,available:!1,exactPose:!1}}),await this.#ve(r,o)}async#ve(t,e){if(!this.#r.active)return;let s=this.#x("history-scene");try{let n=await this.#n.scene(t.sceneUrl,t.revision,!0,"history",s.signal);if(!this.#t.accepts(e)||!n.scene)return;this.#e.patch({resources:{...this.#e.value.resources,scene:m("ready",n.scene)},map:{...this.#e.value.map,available:!0,exactPose:!1}})}catch(n){if($(n)||!this.#t.accepts(e))return;this.#e.patch({resources:{...this.#e.value.resources,scene:m("error",null,B(n,"history-scene-unavailable"))}})}finally{this.#I("history-scene",s)}}async openWorkflow(t){let e=this.#e.value;if((e.dataMode==="history"||e.floor.readOnly)&&an.includes(t))return;let s=this.#e.value.workflow;if(t==="draw"&&s!=="draw"&&s!=="areaReview"&&this.selectArea(null),this.#e.dispatch({type:"open-workflow",workflow:t}),t==="history"){let n=this.#e.value.resources.entry,r=this.#t.current();n&&r&&(this.#e.patch({resources:{...this.#e.value.resources,history:m("loading",this.#e.value.resources.history.value)}}),await this.#he(n,r))}(t==="plans"||t==="plan"||t==="rooms")&&await this.loadPlans(),(t==="draw"||t==="areaReview")&&await this.loadAreas()}async loadPlans({force:t=!1}={}){if(!this.#r.active){this.#o.get("plans")?.abort();let r=this.#e.value.resources;return this.#e.patch({resources:{...r,plans:m("idle",r.plans.value)}}),null}let e=this.#e.value.resources.entry;if(!e||!this.#t.current()||!nt(this.#e.value)||!t&&this.#e.value.resources.plans.status==="loading")return null;let s=W(e),n=this.#x("plans");this.#e.patch({resources:{...this.#e.value.resources,plans:m("loading",null)}});try{let r=await this.#n.plans(e.plansUrl,n.signal),o=this.#e.value.resources.entry;if(n.signal.aborted||this.#l||!o||W(o)!==s)return null;let i=this.#e.value;if(i.planDraft.dirty||i.workflow==="plan"&&(!i.planDraft.id||i.command==="pending"))return this.#e.patch({resources:{...this.#e.value.resources,plans:m("ready",r)}}),r;let l=i.workflow==="plan"?i.selection.planId:r.selectedPlan||r.plans[0]?.id||null,c=r.plans.find(d=>d.id===l);return this.#e.patch({resources:{...this.#e.value.resources,plans:m("ready",r)},selection:{...this.#e.value.selection,planId:l},planDraft:c?st(c):{...this.#e.value.planDraft,id:null,name:"",rooms:[],dirty:!1}}),r}catch(r){let o=this.#e.value.resources.entry;if($(r)||n.signal.aborted||this.#l||!o||W(o)!==s)return null;let i=r instanceof x&&r.code==="map-rechecking"?"map-rechecking":B(r,"plans-unavailable");return this.#e.patch({resources:{...this.#e.value.resources,plans:m("error",null,i)}}),null}finally{this.#I("plans",n)}}selectPlan(t,e=!1){let s=this.#e.value.resources.plans.value?.plans.find(n=>n.id===t);this.#e.patch({workflow:"plan",notice:!e&&this.#e.value.notice?.tone==="success"?null:this.#e.value.notice,selection:{...this.#e.value.selection,planId:t},planDraft:s?st(s):{...O().planDraft}})}#ye(){let t=this.#e.value;(t.workflow==="draw"||t.workflow==="areaReview")&&t.resources.areas.status==="idle"&&this.loadAreas()}async loadAreas({reconcileDraft:t=!0}={}){if(!this.#r.active){this.#o.get("areas")?.abort();let r=this.#e.value.resources;return this.#e.patch({resources:{...r,areas:m("idle",r.areas.value)}}),null}let e=this.#e.value.resources.entry;if(!e||!this.#t.current()||!nt(this.#e.value))return null;let s=W(e),n=this.#x("areas");this.#e.patch({resources:{...this.#e.value.resources,areas:m("loading",null)}});try{let r=await this.#n.areas(e.areasUrl,n.signal),o=this.#e.value.resources.entry;if(n.signal.aborted||this.#l||!o||W(o)!==s)return null;if(r.sceneUrl!==o.sceneUrl)throw new x("areas-unavailable");this.#e.patch({resources:{...this.#e.value.resources,areas:m("ready",r)}});let i=this.#e.value.selection.areaId,l=this.#e.value,c=r.areas.some(d=>d.id===i);return t&&(!l.draw.dirty&&!l.areaDraft.dirty||i!==null&&!c)&&this.selectArea(c?i:null),r}catch(r){let o=this.#e.value.resources.entry;return $(r)||n.signal.aborted||this.#l||!o||W(o)!==s||this.#e.patch({resources:{...this.#e.value.resources,areas:m("error",null,B(r,"areas-unavailable"))}}),null}finally{this.#I("areas",n)}}selectArea(t){let e=this.#e.value.resources.areas.value?.areas.find(n=>n.id===t),s=this.#e.value;this.#e.patch({selection:{...s.selection,areaId:t},areaDraft:e?this.#Re(e):{id:null,name:"",cleaningMode:"vacuum",coverageSetting:"standard",status:"new",canRebind:!1,dirty:!1},draw:{...s.draw,circles:e?.circles||[],outline:e?.outline??null,outlineUndo:[],outlineRedo:[],tool:!e||e.outline?"outline":"paint",undo:[],redo:[],dirty:!1,strokeCount:0}})}#Re(t){return{id:t.id,name:t.name,cleaningMode:t.cleaningMode,coverageSetting:t.coverageSetting,status:t.status,canRebind:t.canRebind,dirty:!1}}async saveArea(){let t=this.#e.value,e=t.resources.entry,s=t.areaDraft;if(!e||t.command==="pending"||!ve(t)||!s.name.trim()||!t.draw.circles.length)return;let n=this.#x("area-mutation"),r=()=>!this.#l&&!n.signal.aborted;this.#e.patch({command:"pending",notice:{tone:"info",text:"Saving area\u2026"}});try{let o=await this.#n.saveArea(e.areasUrl,{areaId:s.id,name:s.name.trim(),circles:t.draw.circles,outline:t.draw.outline??null,cleaningMode:s.cleaningMode,coverageSetting:s.coverageSetting},n.signal);if(!r())return;let i=this.#e.value,c=i.areaDraft===s&&i.draw.circles===t.draw.circles&&i.draw.outline===t.draw.outline&&i.selection.entryId===t.selection.entryId&&(i.workflow==="draw"||i.workflow==="areaReview")?{...s,id:o,name:s.name.trim(),status:"current",canRebind:!1,dirty:!1}:null;this.#e.patch({command:"idle",notice:{tone:"success",text:"Area saved"},...c?{dialog:i.dialog==="discardDraft"?null:i.dialog,selection:{...i.selection,areaId:o},areaDraft:c,draw:{...i.draw,dirty:!1,strokeCount:0,undo:[],redo:[],outlineUndo:[],outlineRedo:[]}}:{}});let d=await this.loadAreas({reconcileDraft:!1}),u=this.#e.value;r()&&c&&u.areaDraft===c&&!u.draw.dirty&&(u.workflow==="draw"||u.workflow==="areaReview")&&u.selection.entryId===t.selection.entryId&&d&&u.resources.areas.value===d&&d.areas.some(f=>f.id===o)&&this.selectArea(o)}catch(o){if($(o)||!r())return;this.#e.patch({command:"failed",notice:{tone:"error",text:"Area could not be saved"}})}finally{this.#I("area-mutation",n)}}async deleteArea(){let t=this.#e.value.resources.entry,e=this.#e.value.selection.areaId;if(!t||!e||this.#e.value.command==="pending"||!ve(this.#e.value))return;let s=this.#x("area-mutation"),n=()=>!this.#l&&!s.signal.aborted;this.#e.patch({command:"pending",notice:null});try{if(await this.#n.deleteArea(t.areasUrl,e,s.signal),!n())return;this.#e.patch({command:"idle",notice:{tone:"success",text:"Area deleted"}}),await this.loadAreas()}catch(r){!$(r)&&n()&&this.#e.patch({command:"failed",notice:{tone:"error",text:"Area could not be deleted"}})}finally{this.#I("area-mutation",s)}}async savePlan(){let t=this.#e.value,e=t.planDraft,s=t.resources.plans.value;if(!s||!e.name.trim()||!e.rooms.length||!ve(t))return;let n=e.rooms,r=e.id;if(await this.#ge("save_plan",{...e.id?{plan_id:e.id}:{},name:e.name.trim(),enabled:e.enabled,run_behavior:e.runBehavior,rooms:n.map(i=>({room:i.roomId,cleaning_mode:i.cleaningMode,coverage_setting:i.coverageSetting,...i.cadence?{cadence:{scope:i.cadence.scope,mop_every_n:i.cadence.mopEveryN,coverage_every_n:i.cadence.coverageEveryN,periodic_coverage_setting:i.cadence.periodicCoverageSetting,do_mop_next:i.cadence.doMopNext,do_coverage_next:i.cadence.doCoverageNext}}:{}})),return_to_base:e.returnToBase,finish_current_room:e.finishCurrentRoom,finish_current_room_threshold:e.finishCurrentRoomThreshold,select:!e.id||s.selectedPlan===e.id},"Plan saved","Plan save could not be confirmed. Check saved plans before trying again.",i=>{let l=i===void 0&&e.id?e.id:Nt(i);if(e.id&&l!==e.id)throw new x("invalid-plan-save-response");r=l})){let i=this.#e.value.workflow==="plan"&&this.#e.value.planDraft===e?{...e,id:r,dirty:!1}:null;i&&this.#e.patch({planDraft:i,selection:{...this.#e.value.selection,planId:r}});let l=await this.loadPlans({force:!0});i&&this.#e.value.workflow==="plan"&&this.#e.value.planDraft===i&&this.#e.value.selection.entryId===t.selection.entryId&&l&&this.#e.value.resources.plans.value===l&&r&&l.plans.some(c=>c.id===r)&&this.selectPlan(r,!0)}}async deletePlan(){let t=this.#e.value.selection.planId,e=this.#e.value.selection.entryId;if(!t)return;if(await this.#ge("delete_plan",{plan:t},"Plan deleted","Plan could not be deleted")){let n=this.#e.value;n.selection.entryId===e&&n.planDraft.id===t&&(this.#e.patch({selection:{...n.selection,planId:null},planDraft:O().planDraft}),n.workflow==="plan"&&this.#e.patch({workflow:"plans",precisionOpen:!1})),await this.loadPlans({force:!0})}}async executeAction(t){switch(typeof t=="string"?t:t.id){case"recheck-status":{let s=this.#e.value.selection.entryId;await this.refreshCatalog(!0);let n=this.#e.value;!this.#l&&n.selection.entryId===s&&n.resources.catalog.status==="ready"&&n.host.connected&&n.host.robotConnected&&n.coherence==="current"&&n.command==="failed"&&this.#e.patch({command:"idle",notice:{tone:"info",text:"Status refreshed. Review the robot state before trying again."}});return}case"stop":await this.#pe("matic_robot","stop_intelligent_cleaning",{include_unmanaged:!0});return;case"resume":await this.#pe("vacuum","send_command",{command:"resume"});return;case"run-plan":{let s=this.#e.value,n=s.selection.planId||s.resources.plans.value?.selectedPlan;if(!n||s.workflow!=="plan"||!s.planDraft.enabled||s.resources.plans.status!=="ready"||s.command!=="idle"||!Ae(s))return;let r=s.selection.entryId,o=s.generation,i=s.selection.planId,l=s.planDraft,c=s.resources.plans.value?.plans.find(v=>v.id===n)?.nextRunPreview;if(!c||!/^[0-9a-f]{64}$/u.test(c.previewToken??"")){this.#e.patch({notice:{tone:"warning",text:"A verified next-run preview is unavailable. Refresh the saved plan before starting it."}});return}this.#e.patch({command:"pending",notice:null});let d=this.#x("plan-preflight");try{await this.loadPlans()}finally{this.#I("plan-preflight",d)}let u=this.#e.value,f=()=>{let v=this.#e.value;!this.#l&&v.selection.entryId===r&&v.generation===o&&v.command==="pending"&&this.#e.patch({command:"idle"})};if(d.signal.aborted||this.#l||u.selection.entryId!==r||u.generation!==o||u.workflow!=="plan"||u.selection.planId!==i||(u.selection.planId||u.resources.plans.value?.selectedPlan)!==n||u.planDraft!==l){f();return}if(u.resources.plans.status!=="ready"){f(),this.#e.patch({notice:{tone:"warning",text:"Plan preview could not be refreshed. Check the plan and try again."}});return}let h=u.resources.plans.value?.plans.find(v=>v.id===n)?.nextRunPreview;if(!h||h.blocker||!/^[0-9a-f]{64}$/u.test(h.previewToken??"")){f(),this.#e.patch({notice:{tone:"warning",text:"This plan has no valid next-run preview. Review its rooms and schedule."}});return}if(!c||JSON.stringify(c)!==JSON.stringify(h)){f(),this.#e.patch({notice:{tone:"info",text:"The next-run preview changed. Review the updated settings before starting."}});return}f(),await this.#pe("matic_robot","run_selected_plan",{plan:n,preview_token:h.previewToken});return}case"clean-rooms":{await this.#Se();return}case"run-area":{let s=this.#e.value.selection.areaId;s&&await this.#pe("matic_robot","clean_area",{area:s});return}case"review-area":this.#e.dispatch({type:"open-workflow",workflow:"areaReview"});return;case"save-area":await this.saveArea();return;case"save-plan":await this.savePlan();return;case"delete-plan":await this.deletePlan();return;case"delete-area":await this.deleteArea();return;case"reset-room-cadence":{if(typeof t=="string")return;let s=this.#e.value;if(s.selection.planId!==t.planId||s.planDraft.dirty||s.dataMode!=="live"||s.command!=="idle"||s.activity!=="idle"&&s.activity!=="docked"||!await this.#ge("reset_room_cadence",{plan:t.planId,room_id:t.roomId,modes:[t.mode]},t.mode==="mop"?"Mopping progress reset":"Coverage progress reset",t.mode==="mop"?"Mopping progress could not be reset":"Coverage progress could not be reset"))return;let r=await this.loadPlans({force:!0}),o=this.#e.value;!this.#l&&o.selection.entryId===s.selection.entryId&&o.selection.planId===t.planId&&!o.planDraft.dirty&&r&&o.resources.plans.value===r&&this.selectPlan(t.planId,!0);return}}}async#Se(){if(this.#K)return;let t=this.#e.value,e=this.#$(t),s=tt(t);if(!e||!s||s.key!==e.key||s.generation!==e.generation||s.floorKey!==e.floorKey||s.missionKey!==e.missionKey||s.preview.entryId!==e.entryId||s.preview.blocker||s.preview.rooms.length===0)return;this.#K=!0;let n=this.#x("room-preview");this.#B=this.#V(e),this.#e.patch({manualRoomPreview:m("loading",null),notice:null});try{let r=await this.#n.previewRoomSequence(e.entityId,e.rooms,e.overrideRoomSchedule,n.signal);if(n.signal.aborted||!this.#O(e)||r.entryId!==e.entryId)return;let o={key:e.key,generation:e.generation,floorKey:e.floorKey,missionKey:e.missionKey,preview:r};if(r.blocker||r.rooms.length===0){this.#e.patch({manualRoomPreview:m("ready",o),notice:{tone:"warning",text:"The room preview is blocked. Review the current map and schedule before starting."}});return}if(Cs(s.preview)!==Cs(r)){this.#e.patch({manualRoomPreview:m("ready",o),notice:{tone:"info",text:"The room preview changed. Review the updated settings before starting."}});return}if(this.#e.patch({manualRoomPreview:m("ready",o),notice:null}),!this.#O(e)||!Ae(this.#e.value))return;await this.#pe("matic_robot","clean_room_sequence",{rooms:e.rooms,use_room_schedule:!0,override_room_schedule:e.overrideRoomSchedule,return_to_base:!0,preview_token:r.previewToken})}catch(r){!$(r)&&!n.signal.aborted&&this.#O(e)&&this.#e.patch({manualRoomPreview:m("error",null,B(r,"preview-unavailable")),notice:{tone:"warning",text:"The room preview could not be refreshed. No cleaning was started."}})}finally{this.#I("room-preview",n),this.#K=!1,this.#Y()}}async#ge(t,e,s,n,r){let o=this.#s?.vacuumEntityId;if(!o||!ve(this.#e.value)||this.#e.value.command==="pending")return!1;let i=this.#x("plan-mutation"),l=this.#s?.entryKey,c=this.#s?.userKey,d=()=>!this.#l&&!i.signal.aborted&&l===this.#s?.entryKey&&c===this.#s?.userKey;this.#e.patch({command:"pending",notice:{tone:"info",text:"Saving\u2026"}});try{let u=await this.#n.service("matic_robot",t,e,o,{acknowledgementTimeout:"mutation",...r?{returnResponse:!0}:{}});return d()?(r?.(u),this.#e.patch({command:"idle",notice:{tone:"success",text:s}}),!0):!1}catch{return d()&&this.#e.patch({command:"failed",notice:{tone:"error",text:n}}),!1}finally{this.#I("plan-mutation",i)}}async#pe(t,e,s){let n=this.#e.value,r=this.#s?.vacuumEntityId,o=e==="stop_intelligent_cleaning"||t==="vacuum"&&e==="return_to_base",i=t==="vacuum"&&e==="send_command"&&s.command==="resume";if(!r||n.selection.entryId!==this.#s?.entryKey||(o?!It(n):i?!Pt(n):!Ae(n)))return;let l=++this.#M,c=this.#s?.entryKey,d=()=>!this.#l&&l===this.#M&&c===this.#s?.entryKey,u=o?"settling":"starting";this.#d!==null&&window.clearTimeout(this.#d),this.#d=null,this.#e.patch({command:u,notice:null});try{if(await this.#n.service(t,e,s,r),!d())return;if(t==="matic_robot"&&(e==="clean_room_sequence"||e==="run_selected_plan")){this.#e.patch({command:"idle"}),this.refreshCatalog(!0);return}this.#e.patch({command:u}),this.#d!==null&&window.clearTimeout(this.#d),this.#d=window.setTimeout(()=>{this.#d=null,d()&&this.#e.value.command===u&&this.#e.patch({command:"idle"})},15e3)}catch(f){if(!d())return;this.#e.patch({command:"failed",notice:{tone:"error",text:nn(f)??"The action could not be confirmed. Check the robot status before trying again."}})}}dispose(){this.#l||(this.#l=!0,this.#r.dispose(),this.#H(!1),this.#C?.(),this.#C=null,this.#e.patch({manualRoomPreview:m("idle",null)}),this.#N(),this.#j(),this.#d!==null&&window.clearTimeout(this.#d),this.#d=null,this.#i.dispose(),this.#be(),this.#n.dispose())}#be(){this.#y?.dispose(),this.#y=null,this.#E=null,this.#b=null}};var Ps=a=>(a.workflow==="none"?0:a.workflow==="plan"?2:1)+(a.fullMap?1:0)+(a.precisionOpen?1:0)+(a.dialog?1:0),Is=a=>{if(!a||typeof a!="object")return null;let t=a.maticMapLayer;if(!t||typeof t!="object")return null;let e=t.owner,s=t.depth;return typeof e=="string"&&Number.isInteger(s)&&Number(s)>=0?{owner:e,depth:Number(s)}:null},Qe=class{#e;#t=`matic-map-${crypto.randomUUID?.()||Math.random().toString(36).slice(2)}`;#n=0;#r=null;#i=!1;#a=!1;constructor(t){this.#e=t}start(){this.#r||(this.#n=Ps(this.#e.value),this.#r=this.#e.subscribe(t=>this.#o(t)),window.addEventListener("popstate",this.#s))}#o(t){let e=Ps(t);if(this.#i){this.#i=!1,this.#n=e;return}if(e<this.#n){let s=Is(history.state);if(s?.owner===this.#t&&s.depth===this.#n){let n=e-this.#n;this.#n=e,this.#a=!0,history.go(n);return}}if(e>this.#n)for(let s=this.#n+1;s<=e;s+=1){let n=history.state&&typeof history.state=="object"?history.state:{};history.pushState({...n,maticMapLayer:{owner:this.#t,depth:s}},"",window.location.href)}this.#n=e}#s=()=>{if(this.#a){this.#a=!1;return}if(!(this.#n<1)){if(ee(this.#e.value,{type:"dismiss-top-layer"})){let t=history.state&&typeof history.state=="object"?history.state:{};history.pushState({...t,maticMapLayer:{owner:this.#t,depth:this.#n}},"",window.location.href),this.#e.dispatch({type:"open-dialog",dialog:"discardDraft"});return}this.#i=!0,this.#e.dispatch({type:"dismiss-top-layer"})}};dismissTop(){if(this.#n<1)return!1;let t=Is(history.state);return t?.owner===this.#t&&t.depth===this.#n?history.back():this.#e.dispatch({type:"dismiss-top-layer"}),!0}dispose(){this.#r?.(),this.#r=null,window.removeEventListener("popstate",this.#s),this.#n=0,this.#a=!1}};var As=[ne,re,De,te`
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
  `];var gt=class extends se{constructor(){super(...arguments);this.state=O();this.compact=!1;this.inline=!1}static{this.properties={state:{attribute:!1},localize:{attribute:!1},compact:{type:Boolean,reflect:!0},inline:{type:Boolean,reflect:!0}}}static{this.styles=[ne,re,De,te`
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
`]}#e(e,s){return X(this.localize,e,s)}#t(e){this.dispatchEvent(new CustomEvent(ke,{detail:e,bubbles:!0,composed:!0}))}#n(e){let s=e.currentTarget.valueAsNumber;Number.isFinite(s)&&this.#t({type:"set-brush",value:s})}render(){let{draw:e}=this.state;return Te`
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
    `}};customElements.get(ye)||customElements.define(ye,gt);var Ts=ae($e),Je=ae(ye),$s=ae(ge),Ls=a=>a.dataMode==="history"||a.floor.readOnly,ln=(a,t)=>{let e=(i,l,c)=>X(t,i,l,c);if(!a.host.connected)return{title:e("v4_reconnecting","Reconnecting"),detail:e("v4_ha_offline","Home Assistant is offline"),icon:K,notable:!0};if(!a.host.administrator)return{title:e("v4_access_required","Access required"),detail:e("v4_admin_only","Administrator only"),icon:K,notable:!0};if(a.host.robotCount===0)return{title:e("v4_no_robot_short","No robot"),detail:e("v4_set_up_robot","Set up a Matic robot"),icon:K,notable:!0};if(Ie(a))return{title:e("v4_selected_robot_unavailable","Selected robot unavailable"),detail:e("v4_choose_another_robot","Choose another robot to open its map."),icon:K,notable:!0};if(!a.host.robotConnected)return{title:e("v4_robot_offline","Robot offline"),detail:e("v4_last_map_read_only","Last verified map \xB7 read only"),icon:K,notable:!0};if(a.activity==="problem")return{title:e("v4_needs_attention","Needs attention"),detail:e("v4_check_robot","Check the robot"),icon:K,notable:!0};if(a.dataMode==="history"){let i=a.resources.history.value?.floors.find(d=>d.id===a.selection.floorId),l=i?.snapshots.findIndex(d=>d.id===a.selection.historyId)??-1,c=i?.snapshots.length??0;return{title:e("v4_saved_map","Saved map"),detail:l>=0?e("v4_read_only_position","Read only \xB7 {position} of {count}",{position:l+1,count:c}):e("v4_read_only","Read only"),icon:it,notable:!1}}if(a.coherence==="verifying"||a.coherence==="booting")return{title:e("v4_locating","Locating"),detail:e("v4_finding_map","Finding the current map"),icon:_e,notable:!0};if((a.resources.entry?.activePlan||a.resources.entry?.runnerLocked)&&(a.activity==="idle"||a.activity==="docked"))return{title:e("v4_task_in_progress","Task in progress"),detail:a.coherence==="unavailable"||a.coherence==="blocked"?e("v4_task_map_unavailable","The live map is unavailable; the current task remains in progress."):a.activity==="docked"?e("v4_task_docked","Robot docked; the cleaning task has not finished."):e("v4_task_waiting","Waiting for the cleaning task to continue or finish."),icon:at,notable:!0};if(a.command==="starting"&&(a.activity==="idle"||a.activity==="docked"))return{title:e("v4_action_starting","Starting"),detail:e("v4_action_starting_detail","Waiting for the robot to begin"),icon:_e,notable:!0};let s=a.coherence==="unavailable"||a.coherence==="blocked",n=e("v4_active_map_unavailable","The live map is unavailable; new cleaning is disabled."),r=i=>s?`${i} \xB7 ${n}`:i;if(a.activity==="cleaning")return{title:e("v4_cleaning","Cleaning"),detail:r(e("v4_cleaning_progress","Cleaning in progress")),icon:lt,notable:!0};if(a.activity==="recharging"){let i=a.batteryPercent===null?e("v4_recharging_detail","Will resume automatically when ready"):e("v4_recharging_battery","Charging to resume \xB7 {percent}% battery",{percent:a.batteryPercent});return{title:e("v4_recharging","Charging to resume"),detail:r(i),icon:Zt,notable:!0}}if(a.activity==="paused")return{title:e("v4_paused","Paused"),detail:r(e("v4_can_resume","Cleaning can resume")),icon:ct,notable:!0};if(a.activity==="returning")return{title:e("v4_returning","Returning"),detail:r(e("v4_going_dock","Going to the dock")),icon:lt,notable:!0};if(a.activity==="stopping")return{title:e("v4_stopping","Stopping"),detail:r(e("v4_waiting_robot","Waiting for the robot")),icon:ct,notable:!0};if(s)return{title:e("v4_map_unavailable","Map unavailable"),detail:e("v4_map_unavailable_status","New cleaning is disabled until the live map is verified."),icon:K,notable:!0};let o=a.batteryPercent===null?e("v4_ready","Ready"):e("v4_battery","{percent}% battery",{percent:a.batteryPercent});return{title:a.activity==="docked"?e("v4_docked","Docked"):e("v4_ready","Ready"),detail:o,icon:_e,notable:!1}},Os=(a,t)=>{let e=(s,n)=>X(t,s,n);switch(a.workflow){case"rooms":return{title:e("v4_choose_rooms","Choose rooms"),description:e("v4_choose_rooms_detail","Select on the map or from the list.")};case"draw":return{title:e("v4_draw_area","Draw an area"),description:e("v4_draw_area_detail","Outline or paint the area, then review it before saving.")};case"plans":return{title:e("v4_your_plans","Your plans"),description:e("v4_choose_plan_detail","Choose a plan to edit or run, or create a new one.")};case"plan":return{title:a.planDraft.id?e("v4_edit_plan","Edit plan"):e("v4_create_plan","Create a plan"),description:e("v4_plan_detail","Review rooms and cleaning settings.")};case"areaReview":return{title:e("v4_name_this_area","Name this area"),description:e("area_details_hint","Name the area and choose cleaning settings.")};case"history":return{title:e("v4_map_history","Map history"),description:e("v4_map_history_detail","Saved maps are floor-scoped and read only.")};case"support":return{title:e("v4_map_diagnostics","Map diagnostics"),description:e("v4_map_support_detail","Private geometry is never included.")};case"none":return Ls(a)?{title:e("v4_saved_map_read_only_title","Saved map is read only"),description:a.dataMode==="live"?e("v4_map_recovery_automatic","Cleaning controls return automatically when the live map is verified."):e("v4_saved_map_read_only_detail","Return to the live map to choose rooms, run a plan, or draw a custom area.")}:{title:e("v4_what_to_clean","What should the robot clean?"),description:e("v4_clean_detail","Choose rooms, a saved plan, or a custom area.")}}},U=["peek","half","full"],Ds={none:"half",rooms:"half",draw:"peek",plan:"full",plans:"full",areaReview:"half",history:"half",support:"full"},cn=.5,dn=100,un=6,hn=48,pn=["a[href]","button","input","label","select","textarea","summary",'[contenteditable]:not([contenteditable="false"])','[role="button"]','[role="link"]','[role="slider"]','[role="checkbox"]','[role="radio"]','[role="switch"]','[role="tab"]','[role="menuitem"]','[tabindex]:not([tabindex="-1"])'].join(","),mn=["button:not(:disabled)","a[href]","input:not(:disabled)","select:not(:disabled)","textarea:not(:disabled)","[tabindex]:not([tabindex='-1'])"].join(", "),fn=(a,t,e=!1,s="room",n=!1,r="mop")=>{let o=(i,l,c)=>X(t,i,l,c);switch(a){case"discardDraft":return{title:e?o("v4_discard_plan","Discard plan changes?"):o("v4_discard_area","Discard area changes?"),detail:e?o("v4_discard_plan_detail","Your plan changes have not been saved. Keep editing or discard them."):o("v4_discard_area_detail","Your area changes have not been saved. Keep editing or discard them."),cancelLabel:o("v4_keep_area_editing","Keep editing"),confirmLabel:o("v4_discard","Discard"),action:"discard"};case"confirmDeletePlan":return{title:o("v4_delete_plan","Delete this plan?"),detail:o("v4_delete_plan_detail","This removes the saved plan from Home Assistant. The robot will not move."),cancelLabel:o("v4_cancel","Cancel"),confirmLabel:o("plan_delete","Delete plan"),action:"delete-plan"};case"confirmDeleteArea":return{title:o("v4_delete_area","Delete this area?"),detail:o("v4_delete_area_detail","This removes the saved outline from Home Assistant. The robot will not move."),cancelLabel:o("v4_cancel","Cancel"),confirmLabel:o("area_delete","Delete area"),action:"delete-area"};case"confirmResetCadence":return{title:r==="mop"?o("v4_reset_mop_cadence_title","Reset mopping progress for {room}?",{room:s}):o("v4_reset_coverage_cadence_title","Reset coverage progress for {room}?",{room:s}),detail:n?r==="mop"?o("v4_reset_shared_mop_cadence_detail","This clears shared mopping progress for {room} across plans that use its shared schedule. Coverage progress and saved cleaning history stay unchanged.",{room:s}):o("v4_reset_shared_coverage_cadence_detail","This clears shared coverage progress for {room} across plans that use its shared schedule. Mopping progress and saved cleaning history stay unchanged.",{room:s}):r==="mop"?o("v4_reset_private_mop_cadence_detail","This clears mopping progress for {room} in this plan. Coverage progress and saved cleaning history stay unchanged.",{room:s}):o("v4_reset_private_coverage_cadence_detail","This clears coverage progress for {room} in this plan. Mopping progress and saved cleaning history stay unchanged.",{room:s}),cancelLabel:o("v4_cancel","Cancel"),confirmLabel:r==="mop"?o("v4_reset_mop_cadence_confirm","Reset mopping progress"):o("v4_reset_coverage_cadence_confirm","Reset coverage progress"),action:"reset-room-cadence"};case"confirmStop":return{title:o("v4_stop_cleaning","Stop cleaning?"),detail:o("v4_stop_cleaning_detail","The robot may take a moment to settle before another action is available."),cancelLabel:o("v4_keep_cleaning","Keep cleaning"),confirmLabel:o("v4_stop","Stop"),action:"stop"};case"error":return{title:o("v4_error","Something went wrong"),detail:o("v4_error_detail","No action was started. Close this message and try again when the map is ready."),cancelLabel:o("v4_close","Close"),confirmLabel:o("v4_close","Close"),action:null};case null:return null}},vn=(a=document)=>{let t=a.activeElement;for(;t?.shadowRoot?.activeElement;)t=t.shadowRoot.activeElement;return t},bt=a=>!!(a&&a.isConnected&&a.offsetParent!==null),wt=class extends se{constructor(){super();this.state=O();this._measuredNarrow=!1;this._sheetOffset=0;this._overflowOpen=!1;this._helpOpen=!1;this._browserFullscreen=!1;this._sheetDetent="half";this._announcement="";this._workflowLoadFailed=!1;this.#t=null;this.#n=null;this.#r=null;this.#i=null;this.#a=null;this.#o=null;this.#s=null;this.#h=null;this.#f=null;this.#d=null;this.#S=()=>{this._browserFullscreen=this.#_()};this.#m=e=>{if(!this._overflowOpen)return;let s=this.renderRoot.querySelector(".overflow-wrap");(!s||!e.composedPath().includes(s))&&(this._overflowOpen=!1)};this.#le=()=>{this._workflowLoadFailed=!1,this.#se()};new ss(this,{container:()=>this.renderRoot?.querySelector(".draw-tools")??null,items:"button"})}static{this.properties={state:{attribute:!1},localize:{attribute:!1},_measuredNarrow:{state:!0},_sheetOffset:{state:!0},_overflowOpen:{state:!0},_helpOpen:{state:!0},_browserFullscreen:{state:!0},_sheetDetent:{state:!0},_announcement:{state:!0},_workflowLoadFailed:{state:!0}}}static{this.styles=As}#e(e,s,n){return X(this.localize,e,s,n)}#t;#n;#r;#i;#a;#o;#s;#h;#f;#d;#M(){let e=this.renderRoot;return e instanceof ShadowRoot?e.fullscreenElement??document.fullscreenElement:document.fullscreenElement}#S;#_(){let e=this.renderRoot,s=e.querySelector(".app"),n=e instanceof ShadowRoot?e.fullscreenElement:null;if(n)return n===s;let r=document.fullscreenElement;for(let o=this;o;){if(o===r)return!0;let i=o.getRootNode();o=i instanceof ShadowRoot?i.host:null}return!1}#m;connectedCallback(){super.connectedCallback(),this.#t=new ResizeObserver(([e])=>{if(!e)return;let s=e.contentRect.width<1024||e.contentRect.height<480;s!==this._measuredNarrow&&(this._measuredNarrow=s)}),this.#t.observe(this),window.addEventListener("pointerdown",this.#m,!0),document.addEventListener("fullscreenchange",this.#S),this.#n=new ResizeObserver(([e])=>{if(!e)return;let s=Math.ceil(e.target.getBoundingClientRect().height);s!==this._sheetOffset&&(this._sheetOffset=s)})}disconnectedCallback(){this.#t?.disconnect(),this.#t=null,this.#n?.disconnect(),this.#n=null,this.#r=null,window.removeEventListener("pointerdown",this.#m,!0),document.removeEventListener("fullscreenchange",this.#S),super.disconnectedCallback()}updated(e){let s=e,n=this.renderRoot.querySelector(".mobile-sheet");if(n!==this.#r&&(this.#n?.disconnect(),this.#r=n,n?this.#n?.observe(n):this._sheetOffset!==0&&(this._sheetOffset=0)),s.has("_overflowOpen")&&this._overflowOpen&&this.updateComplete.then(()=>{this.renderRoot.querySelector("#map-options select, #map-options button")?.focus()}),s.has("_helpOpen")){if(this._helpOpen)this.updateComplete.then(()=>{this.renderRoot.querySelector(".help-dialog [data-dialog-initial-focus]")?.focus()});else if(s.get("_helpOpen")){let r=this.#o;this.#o=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>r?.focus({preventScroll:!0}))})}}if(e.has("state")){let r=e.get("state");if(r?.precisionOpen&&!this.state.precisionOpen&&this.#g()?.focus(),r?.fullMap&&!this.state.fullMap){let o=this.#a;this.#a=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>{(this.renderRoot.querySelector(".workspace-toggle")??this.renderRoot.querySelector(".nav--menu")??(o?.isConnected?o:null))?.focus({preventScroll:!0})})})}if(r&&!r.fullMap&&this.state.fullMap&&this.updateComplete.then(()=>{let o=this.#a;requestAnimationFrame(()=>{(this.renderRoot.querySelector(".workspace-toggle")??(o?.isConnected?o:null))?.focus({preventScroll:!0})})}),!r?.dialog&&this.state.dialog){let o=vn(this.shadowRoot||document);o?.hasAttribute("data-dialog-launcher")&&(this.#i=o),this.updateComplete.then(()=>{(this.renderRoot.querySelector(".dialog [data-dialog-initial-focus]")??this.renderRoot.querySelector(".dialog button"))?.focus()})}else if(r?.dialog&&!this.state.dialog){r.dialog==="discardDraft"&&(this.#s=null,this.#P());let o=this.#i?.isConnected&&this.#i.hasAttribute("data-dialog-launcher")?this.#i:this.#Q(r.dialog);this.#i=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>o?.focus({preventScroll:!0}))})}r?r.workflow!==this.state.workflow&&(this._sheetDetent=Ds[this.state.workflow],this.updateComplete.then(()=>this.#c())):this._sheetDetent=Ds[this.state.workflow]}}#c(){let e=this.renderRoot.querySelector(".panel-heading h2");if(bt(e)){e.focus({preventScroll:!0});return}let s=this.renderRoot.querySelector(".action-bar .ms-btn--primary");bt(s)&&s.focus({preventScroll:!0})}#g(){let e=this.renderRoot.querySelector(".draw-brush");return bt(e)?e:this.renderRoot.querySelector($e)?.shadowRoot?.querySelector(".draw-brush")??null}#p(e){if(ee(this.state,e)){this.#s=e,this.#p({type:"open-dialog",dialog:"discardDraft"});return}this.dispatchEvent(new CustomEvent(ke,{detail:e,bubbles:!0,composed:!0}))}#T(e){if(e.enabled){if(e.id==="return-live"){this.#p({type:"set-history",historyId:null});return}if(e.id==="clear-draft"){this.#p({type:"clear-draft"});return}this.#A(e.id)}}#v(e,s){let n={type:"open-workflow",workflow:e};s instanceof HTMLElement&&ee(this.state,n)&&(this.#i=s),this.#p(n)}#k(){let e=this.#s;this.#s=null,e?.type==="select-plan"||e?.type==="select-area"?(this.#p({type:"patch-plan-draft",patch:{dirty:!1}}),this.#p({type:"patch-area-draft",patch:{dirty:!1}}),this.#p({type:"dismiss-top-layer"})):this.#p({type:"discard-draft"}),e&&e.type!=="dismiss-top-layer"&&queueMicrotask(()=>this.dispatchEvent(new CustomEvent(ke,{detail:e,bubbles:!0,composed:!0})))}#u(){this.#s=null,this.#L(),this.#P()}#P(){this.updateComplete.then(()=>{let e=this.renderRoot.querySelector(".floor-switcher");e&&(e.value=this.state.selection.floorId);let s=this.renderRoot.querySelector(".robot-switcher");s&&(s.value=this.state.selection.entryId??"")})}#L(){let e=this.state.dialog,s=e&&this.#i?.isConnected&&this.#i.hasAttribute("data-dialog-launcher")?this.#i:e?this.#Q(e):null;this.#p({type:"dismiss-top-layer"}),s&&requestAnimationFrame(()=>s.focus({preventScroll:!0}))}#A(e){this.dispatchEvent(new CustomEvent(ns,{detail:typeof e=="string"?{id:e}:e,bubbles:!0,composed:!0}))}#l(e){this.#p({type:"dismiss-top-layer"}),this.#A(e)}#q(e){if(e.action==="discard"){this.#k();return}if(e.action==="delete-plan"||e.action==="delete-area"){this.#l(e.action);return}if(e.action==="reset-room-cadence"){let s=this.state.cadenceResetRequest;this.#p({type:"dismiss-top-layer"}),s&&this.#A({id:"reset-room-cadence",planId:s.planId,roomId:s.roomId,mode:s.mode});return}this.#p({type:"dismiss-top-layer"}),e.action==="stop"&&this.#A("stop")}#y(e){e!==this._sheetDetent&&(this._sheetDetent=e,this._announcement=this.#e("v4_workspace_height","Map workspace, {height} height",{height:e}))}#E(e,s=!1){let r=U.indexOf(this._sheetDetent)+e;s&&r>=U.length&&(r=0),r=Math.max(0,Math.min(U.length-1,r)),this.#y(U[r]??this._sheetDetent)}#b(e){let s=this.renderRoot.querySelector(".workspace")?.clientHeight??e.parentElement?.clientHeight??e.offsetHeight,n=parseFloat(getComputedStyle(this).fontSize)||16,r=[".sheet-grip",".sheet-tools",".action-bar"].map(l=>e.querySelector(l)?.offsetHeight??0).reduce((l,c)=>l+c,0)+n*.75,o=Math.min(s*.92,s-n*9),i=Math.min(s*.48,n*26,o);return{peek:Math.min(r,i),half:i,full:o}}#C(){return this.renderRoot.querySelector(".mobile-sheet")}#B(e){let s=e.currentTarget;for(let n of e.composedPath()){if(n===s)return!1;if(n instanceof Element&&n.matches(pn))return!0}return!1}#K(e){if(e.pointerType==="mouse"&&e.button!==0||this.#B(e))return;let s=this.#C();!s||this.#f||(this.#f={pointerId:e.pointerId,startY:e.clientY,startHeight:s.offsetHeight,heights:this.#b(s),samples:[{y:e.clientY,t:e.timeStamp}],moved:!1},e.currentTarget.setPointerCapture(e.pointerId),s.classList.add("dragging"))}#Z(e){let s=this.#f;if(!s||e.pointerId!==s.pointerId)return;let n=this.#C();if(!n)return;let r=e.clientY-s.startY;for(!s.moved&&Math.abs(r)>un&&(s.moved=!0),s.samples.push({y:e.clientY,t:e.timeStamp});s.samples.length>2&&e.timeStamp-(s.samples[1]?.t??0)>dn;)s.samples.shift();if(!s.moved)return;let o=s.startHeight-s.heights.full,i=s.startHeight-s.heights.peek,l=Math.max(o,Math.min(i,r));n.style.transform=`translateY(${l}px)`}#F(e){let s=this.#f;if(!s||e.pointerId!==s.pointerId)return;this.#f=null;let n=this.#C();if(n&&(n.style.transform="",n.classList.remove("dragging")),e.type==="pointercancel")return;if(!s.moved){this.#E(1,!0);return}let r=e.clientY-s.startY,o=U.indexOf(this._sheetDetent),i=s.samples[0],l=s.samples[s.samples.length-1],c=i&&l&&l!==i?(l.y-i.y)/Math.max(1,l.t-i.t):0;if(Math.abs(c)>cn){let h=Math.max(0,Math.min(U.length-1,o+(c<0?1:-1)));this.#y(U[h]??this._sheetDetent);return}let d=s.startHeight-r,u=this._sheetDetent,f=Number.POSITIVE_INFINITY;for(let h of U){let v=Math.abs(s.heights[h]-d);v<f&&(f=v,u=h)}this.#y(u)}#U(e){if(e.pointerType==="mouse"||this.#B(e))return;let s=e.currentTarget;this.#d={pointerId:e.pointerId,startY:e.clientY,atTop:s.scrollTop===0,consumed:!1}}#ne(e){let s=this.#d;if(!s||s.consumed||!s.atTop||e.pointerId!==s.pointerId)return;if(e.currentTarget.scrollTop>0){this.#d=null;return}e.clientY-s.startY<hn||(s.consumed=!0,this.#E(-1))}#w(){this.#d=null}#$(){this.dispatchEvent(new CustomEvent("hass-toggle-menu",{bubbles:!0,composed:!0}))}#V(e){this.#a=e.currentTarget,this.#p({type:this.state.fullMap?"exit-full-map":"enter-full-map"})}#O(e){this._overflowOpen=!1,e&&this.updateComplete.then(()=>{this.renderRoot.querySelector(".overflow")?.focus()})}#Y(e){if(this.#O(e==="fullscreen"),e==="support"){this.#v("support");return}let s=this.renderRoot.querySelector(".app");this.#M()?document.exitFullscreen():s?.requestFullscreen()}#re(){this.#p({type:"set-precision-open",value:!this.state.precisionOpen})}#X(e){this.#o=e.currentTarget,this._helpOpen=!0}#G(e){let s=e;if(!Pe(s.detail))return;if(ee(this.state,s.detail)){e.stopPropagation(),this.#p(s.detail);return}if(s.detail?.type!=="open-dialog")return;let n=s.composedPath().find(r=>r instanceof HTMLElement&&r.hasAttribute("data-dialog-launcher"));n instanceof HTMLElement&&(this.#i=n)}#Q(e){return this.renderRoot.querySelector(ge)?.shadowRoot?.querySelector(`[data-dialog-launcher="${e}"]`)??null}#H(e){if(!ts(e)&&!(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey)&&e.key==="Escape"){if(e.preventDefault(),this._overflowOpen){this.#O(!0);return}if(this._helpOpen){this._helpOpen=!1;return}if(this.state.dialog==="discardDraft"){this.#u();return}this.#p({type:"dismiss-top-layer"})}}#W(e){if(e.key!=="Tab")return;let n=[...e.currentTarget.querySelectorAll(mn)],r=n[0],o=n.at(-1);if(!r||!o)return;let i=this.shadowRoot?.activeElement;e.shiftKey&&i===r?(e.preventDefault(),o.focus()):!e.shiftKey&&i===o&&(e.preventDefault(),r.focus())}#D(){let e=this.renderRoot.querySelector($e);(e?.shadowRoot?.querySelector(".map-root")??e)?.focus()}#ee(){this._sheetDetent==="peek"&&this.#C()&&this.#y("half"),this.updateComplete.then(()=>this.#c())}#z(e,s,n){if(e.id==="choose-cleaning")return k;let r=e.labelKey?this.#e(e.labelKey,e.label):e.label,o=!e.enabled&&e.reason?e.reasonKey?this.#e(e.reasonKey,e.reason):e.reason:null,i=e.id==="stop";return b`
      <button
        class=${`${s} ${e.kind==="danger"?"ms-btn--danger":""}`}
        type="button"
        aria-disabled=${e.enabled?k:"true"}
        aria-describedby=${o?n:k}
        aria-label=${i?this.#e("v4_stop_cleaning_label","Stop cleaning"):k}
        @click=${()=>this.#T(e)}
      >${r}</button>
      ${o?b`<p class="action-reason" id=${n}>${o}</p>`:k}
    `}#oe(e){let s=e.resources.plans.value?.rooms??e.resources.areas.value?.rooms??[];return e.selection.roomIds.map(n=>s.find(r=>r.roomId===n)?.name??n)}#N(e,s,n){let r=s?.enabled&&e.workflow==="rooms"&&s.id==="clean-rooms"?[this.#oe(e).join(", "),e.planDraft.returnToBase?this.#e("v4_returns_to_dock","returns to the dock"):""].filter(Boolean).join(" \xB7 "):"";return b`
      <div class="action-bar">
        ${r?b`<p class="action-summary">${r}</p>`:k}
        ${s?this.#z(s,"ms-btn ms-btn--block ms-btn--lg ms-btn--primary","primary-reason"):k}
        ${n?this.#z(n,"ms-btn ms-btn--block ms-btn--lg ms-btn--secondary","secondary-reason"):k}
      </div>
    `}#R(e,s,n=k){return b`
      <div class="host-state">
        <h3>${e}</h3>
        <p>${s}</p>
        ${n}
      </div>
    `}#J(e,s,n,r,o=!1){return b`
      <button
        class="ms-row"
        type="button"
        aria-disabled=${o?"true":k}
        @click=${()=>{o||n()}}
      >
        <span class="ms-row__lead">${I(s)}</span>
        <span class="ms-row__body"><strong>${e}</strong>${r?b`<small>${r}</small>`:k}</span>
        <span class="ms-row__trail">${I(qe)}</span>
      </button>
    `}#te(e){let s=e.resources.history.value?.floors||[],n=s.length?s.map((r,o)=>({id:r.active?"current":r.id,label:`${r.label||(r.active?this.#e("v4_current_floor","Current floor"):this.#e("v4_saved_floor","Saved floor {number}",{number:r.ordinal??o+1}))}${!r.active&&r.snapshots.length===0?` \xB7 ${this.#e("v4_floor_not_captured","Visit floor to capture")}`:""}`,disabled:!r.active&&r.snapshots.length===0})):[{id:e.selection.floorId,label:e.floor.displayName,disabled:!1}];return b`
      <select
        class="ms-select context-switcher floor-switcher"
        slot="floor"
        data-map-control
        name="map-floor"
        aria-label=${this.#e("v4_choose_floor","Choose floor")}
        ?disabled=${n.length<=1}
        .value=${e.selection.floorId}
        @change=${r=>this.#p({type:"set-floor",floorId:r.currentTarget.value})}
      >${n.map(r=>b`
        <option value=${r.id} ?selected=${r.id===e.selection.floorId} ?disabled=${r.disabled}>${r.label}</option>
      `)}</select>
    `}#ie(e,s){let n=(_,p,S)=>this.#e(_,p,S),r=this.#J(n("v4_map_history","Map history"),it,()=>this.#v("history"),n("v4_map_history_detail","Saved maps are floor-scoped and read only.")),o=this.#J(n("v4_map_diagnostics","Map diagnostics"),Jt,()=>this.#v("support"),n("v4_map_support_detail","Private geometry is never included.")),{host:i}=e;if(!i.connected)return this.#R(n("v4_reconnecting_title","Reconnecting to Home Assistant"),n("v4_reconnecting_body","The last verified map stays read-only until the connection returns."));if(!i.administrator)return this.#R(n("v4_admin_title","Administrator access required"),n("v4_admin_body","Ask a Home Assistant administrator to open this map."));if(i.robotCount===0)return this.#R(n("v4_no_robot_title","No Matic robot set up"),n("v4_no_robot_body","Add the Matic integration to see a map here."),b`<a class="ms-btn ms-btn--secondary" href="/config/integrations/integration/matic_robot">${n("v4_open_integration","Open the Matic integration")}</a>`);if(Ie(e))return this.#R(n("v4_selected_robot_unavailable","Selected robot unavailable"),n("v4_choose_another_robot","Choose another robot to open its map."));if(!i.robotConnected)return b`
        ${this.#R(n("v4_robot_offline_title","Robot offline"),n("v4_robot_offline_body","Showing the last verified map. Cleaning is unavailable until the robot reconnects."))}
        <h3 class="shelf-heading">${n("v4_more","Map tools")}</h3>
        <div class="shelf">${r}${o}</div>
      `;if(Ls(e))return b`
        <h3 class="shelf-heading">${n("v4_more","Map tools")}</h3>
        <div class="shelf">
          ${r}
          ${o}
        </div>
      `;let l=e.coherence==="verifying"||e.coherence==="booting",c=e.resources.plans,d=c.value,u=d!==null&&d.rooms.length===0,f=d?.plans.length??0,h=c.status==="loading",v=c.status==="error",g=l||u,y=l?n("v4_reason_locating","Waiting for the robot to confirm which floor it is on."):u?n("v4_no_rooms_reason","This floor has no named rooms yet."):null,w=l?n("v4_reason_locating","Waiting for the robot to confirm which floor it is on."):null,E=l?n("v4_reason_locating","Waiting for the robot to confirm which floor it is on."):n("v4_areas_quick_detail","Create or choose a saved area");return b`
      ${e.activity==="problem"?this.#R(n("v4_attention_title","The robot needs attention"),n("v4_attention_body","Check the robot, then start a new task.")):b`
          <div class="quick-actions" aria-label=${n("v4_cleaning_choices","Cleaning choices")}>
            <button
              class="ms-row ms-row--card ms-row--featured"
              type="button"
              aria-disabled=${g?"true":k}
              @click=${()=>{g||this.#v("rooms")}}
            >
              <span class="ms-row__lead">${I(_e)}</span>
              <span class="ms-row__body">
                <strong>${n("v4_clean_rooms","One-time clean")}</strong>
                <small>${y??n("v4_clean_rooms_hint","Choose rooms for this run")}</small>
              </span>
              <span class="ms-row__trail">${I(qe)}</span>
            </button>
            <button
              class="ms-row ms-row--card"
              type="button"
              aria-disabled=${l?"true":k}
              @click=${()=>{l||this.#v("plans")}}
            >
              <span class="ms-row__lead">${I(at)}</span>
              <span class="ms-row__body">
                <strong>${h?n("v4_plans_loading","Checking saved plans"):v?n("v4_plans_unavailable","Plans unavailable"):f?n("v4_run_a_plan","Run a plan"):n("v4_create_plan","Create a plan")}</strong>
                <small>${w??(h?n("v4_plans_loading_hint","Reading routines for this floor"):v?n("v4_plans_unavailable_hint","Try again to load saved routines"):f?f===1?n("v4_saved_routine","1 saved routine"):n("v4_saved_routines","{count} saved routines",{count:f}):n("v4_no_plans_hint","Save a room routine you can repeat"))}</small>
              </span>
              <span class="ms-row__trail">${I(qe)}</span>
            </button>
          </div>
        `}
      <h3 class="shelf-heading">${n("v4_more","Map tools")}</h3>
      <div class="shelf">
        ${this.#J(n("v4_custom_areas","Clean a custom area"),Qt,()=>this.#v("draw"),E,l)}
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
            @click=${this.#X}
          >${n("v4_how_to_move","How to move the map")}</button>
        </div>
      `:k}
    `}#ae(e,s){return e.workflow==="none"?this.#ie(e,s):customElements.get(ge)?b`<${$s}
      .state=${e}
      .localize=${this.localize}
      @matic-workspace-intent=${this.#G}
    ></${$s}>`:(this.#se(),this._workflowLoadFailed?b`<div class="workflow-loading" role="alert">
          <p>${this.#e("v4_workflow_load_failed","Workspace tools could not be loaded.")}</p>
          <button class="ms-btn ms-btn--secondary" @click=${this.#le}>
            ${this.#e("v4_retry","Try again")}
          </button>
        </div>`:b`<div class="workflow-loading" role="status" aria-live="polite">
        ${this.#e("v4_workflow_loading","Loading workspace tools\u2026")}
      </div>`)}#se(){this.#h||customElements.get(ge)||(this._workflowLoadFailed=!1,this.#h=import("./workflow-panel-KSUAALUU.js").then(()=>{this.#h=null,this.requestUpdate()}).catch(()=>{this.#h=null,this._workflowLoadFailed=!0}))}#le;#ce(e,s){let n=Os(e,this.localize);return b`
      <div class="panel-heading">
        ${e.workflow!=="none"?b`
          <button
            class="panel-back ms-btn ms-btn--secondary"
            type="button"
            aria-label=${e.workflow==="plan"?this.#e("v4_back_to_plans","Back to plans"):this.#e("v4_back_to_all_tasks","Back to all tasks")}
            data-dialog-launcher="discardDraft"
            @click=${r=>this.#v(e.workflow==="plan"?"plans":"none",r.currentTarget)}
          >${I(Le)}<span class="ms-btn__label">${e.workflow==="plan"?this.#e("v4_your_plans","Your plans"):this.#e("v4_all_tasks","All tasks")}</span></button>
        `:k}
        <h2 tabindex="-1">${n.title}</h2>
      </div>
      <p class="panel-description">${n.description}</p>
      ${this.#ae(e,s)}
    `}#de(e,s){let r=Os(e,this.localize).title;return e.workflow==="rooms"&&e.selection.roomIds.length&&(r=`${this.#e("v4_rooms_selected","Rooms selected: {count}",{count:e.selection.roomIds.length})} \xB7 ${this.#oe(e).join(", ")}`),this._sheetDetent!=="peek"?s.detail?`${s.title} \xB7 ${s.detail}`:s.title:s.notable?`${s.title} \xB7 ${r}`:r}#x(){let e=(s,n)=>this.#e(s,n);return b`
      <div class="dialog-backdrop" @click=${s=>{s.target===s.currentTarget&&(this._helpOpen=!1)}}>
        <section
          class="dialog help-dialog ms-surface ms-surface--overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-title"
          @keydown=${this.#W}
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
    `}render(){let e=this.state,s=e.narrowHint||this._measuredNarrow,n=ln(e,this.localize),r=Ie(e),o=At({...e,narrowHint:s}),i=Tt(e),l=!s&&o.id==="stop"?o:!s&&i?.id==="stop"?i:null,c=l&&l===o?null:o,d=e.workflow==="draw"&&e.dataMode==="live"?{id:"clear-draft",label:"Clear drawing",labelKey:"v4_clear_drawing",kind:"neutral",enabled:e.draw.circles.length>0||!!e.draw.outline?.points.length}:null,u=l&&l===i?null:i??d,f=e.fullMap&&(e.coherence==="verifying"||e.coherence==="booting"),h=e.fullMap||e.host.administrator&&e.host.robotCount>0&&e.map.available,v=e.cadenceResetRequest?e.resources.plans.value?.rooms.find(p=>p.roomId===e.cadenceResetRequest?.roomId):void 0,g=e.cadenceResetRequest?e.resources.plans.value?.plans.find(p=>p.id===e.cadenceResetRequest?.planId)?.rooms.find(p=>p.roomId===e.cadenceResetRequest?.roomId):void 0,y=fn(e.dialog,this.localize,e.workflow==="plan",v?.name||e.cadenceResetRequest?.roomId||"room",g?.cadence?.scope==="shared",e.cadenceResetRequest?.mode),w=s&&!e.fullMap?`--map-sheet-offset:${this._sheetOffset}px`:"--map-sheet-offset:0px",E=s&&e.workflow==="draw",_=e.precisionOpen&&e.workflow==="draw";return b`
      <div class=${`root ${s?"narrow":"wide"}`} @keydown=${this.#H}>
        <button class="skip-link ms-btn ms-btn--primary" type="button" @click=${this.#D}>${this.#e("v4_skip_to_map","Skip to the map")}</button>
        <button class="skip-link ms-btn ms-btn--primary" type="button" @click=${this.#ee}>${this.#e("v4_skip_to_workspace","Skip to the map workspace")}</button>
        <div class="app" ?inert=${!!y||this._helpOpen}>
          <header class="app-bar">
            ${e.precisionOpen?k:b`
              <button
                class="nav nav--menu ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#e("v4_open_navigation","Open Home Assistant sidebar")}
                title=${this.#e("v4_open_navigation","Open Home Assistant sidebar")}
                @click=${this.#$}
              >${I(jt)}</button>
            `}

            ${e.precisionOpen?b`
              <button
                class="nav ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#e("v4_back","Back")}
                @click=${()=>this.#p({type:"dismiss-top-layer"})}
              >${I(Le)}</button>
            `:k}
            <h1 class="title">${this.#e("map_studio_title","Matic Map")}</h1>
            ${e.robots.length>1||r?b`
              <select
                class="ms-select context-switcher robot-switcher"
                name="matic-robot"
                aria-label=${this.#e("v4_choose_robot","Choose robot")}
                .value=${e.selection.entryId||""}
                @change=${p=>this.#p({type:"select-entry",entryId:p.currentTarget.value})}
              >${r?b`
                <option value=${e.selection.entryId||""} selected disabled>${this.#e("v4_selected_robot_unavailable","Selected robot unavailable")}</option>
              `:k}${e.robots.map(p=>b`
                <option value=${p.entryId} ?selected=${p.entryId===e.selection.entryId}>${p.label}</option>
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
                @click=${this.#V}
              >${I(Yt)}</button>
            `:k}
            <div class="overflow-wrap">
              <button
                class="overflow ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#e("v4_map_options","Map options")}
                aria-expanded=${String(this._overflowOpen)}
                aria-controls="map-options"
                @click=${()=>{this._overflowOpen=!this._overflowOpen}}
              >${I(Vt)}</button>
              ${this._overflowOpen?b`
                <div id="map-options" class="overflow-menu ms-surface ms-surface--overlay">
                  <label class="overflow-field ms-field">${this.#e("map_quality_label","Scene detail")}
                    <select
                      aria-label=${this.#e("map_quality_label","Scene detail")}
                      .value=${e.quality}
                      @change=${p=>this.#p({type:"set-quality",quality:p.currentTarget.value})}
                    >
                      <option value="auto">${this.#e("map_quality_auto","Auto detail")}</option>
                      <option value="efficient">${this.#e("map_quality_efficient","Efficient")}</option>
                      <option value="balanced">${this.#e("map_quality_balanced","Balanced")}</option>
                      <option value="maximum">${this.#e("map_quality_maximum","Maximum")}</option>
                    </select>
                  </label>
                  <button class="ms-row ms-row--menu" type="button" @click=${()=>this.#Y("support")}>${this.#e("v4_map_diagnostics","Map diagnostics")}</button>
                  <button class="ms-row ms-row--menu" type="button" @click=${()=>this.#Y("fullscreen")}>${this._browserFullscreen?this.#e("v4_leave_full_screen","Leave full screen"):this.#e("v4_full_screen","Full screen")}</button>
                </div>
              `:k}
            </div>
          </header>

          <main class=${`workspace ${e.fullMap?"full-map":""}`} style=${w}>
            <div class="canvas">
              <${Ts}
                class="map-canvas"
                style=${w}
                .state=${e}
                .localize=${this.localize}
                .narrow=${s}
              >${this.#te(e)}
                ${s&&!e.fullMap&&this._sheetDetent==="full"?b`
                  <button
                    class="sheet-scrim"
                    slot="scrim"
                    data-map-control
                    type="button"
                    aria-label=${this.#e("v4_collapse_sheet","Collapse the map workspace")}
                    @click=${()=>this.#y("peek")}
                  ></button>
                `:k}
              </${Ts}>
              ${!s&&_?b`
                <div class="precision-popover">
                  <${Je} compact .state=${e} .localize=${this.localize}></${Je}>
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
              aria-label="Map workspace"
            >
              ${s?b`
                <div
                  class="sheet-grip"
                  @pointerdown=${this.#K}
                  @pointermove=${this.#Z}
                  @pointerup=${this.#F}
                  @pointercancel=${this.#F}
                >
                  <span class="sheet-handle" role="presentation"></span>
                  ${e.workflow!=="none"&&this._sheetDetent==="peek"?b`
                    <button
                      class="sheet-back ms-btn ms-btn--icon ms-btn--sm"
                      type="button"
                      aria-label=${e.workflow==="plan"?this.#e("v4_back_to_plans","Back to plans"):this.#e("v4_back_to_all_tasks","Back to all tasks")}
                      title=${e.workflow==="plan"?this.#e("v4_back_to_plans","Back to plans"):this.#e("v4_back_to_all_tasks","Back to all tasks")}
                      data-dialog-launcher="discardDraft"
                      @click=${p=>this.#v(e.workflow==="plan"?"plans":"none",p.currentTarget)}
                    >${I(Le)}</button>
                  `:k}
                  <span class="sheet-status">${this.#de(e,n)}</span>
                  <button
                    class="ms-btn ms-btn--icon ms-btn--sm"
                    type="button"
                    aria-label=${this.#e("v4_show_more","Show more of the map workspace")}
                    aria-controls="sheet-body"
                    aria-disabled=${this._sheetDetent==="full"?"true":k}
                    @click=${()=>this.#E(1)}
                  >${I(Xt)}</button>
                  <button
                    class="ms-btn ms-btn--icon ms-btn--sm"
                    type="button"
                    aria-label=${this.#e("v4_show_less","Show less of the map workspace")}
                    aria-controls="sheet-body"
                    aria-disabled=${this._sheetDetent==="peek"?"true":k}
                    @click=${()=>this.#E(-1)}
                  >${I(Gt)}</button>
                </div>
                ${E?b`
                  <div class="sheet-tools">
                    ${es(e,{intent:p=>this.#p(p),openBrush:()=>this.#re(),t:(p,S)=>this.#e(p,S)},"grid")}
                    ${_?b`
                      <div class="precision-popover">
                        <${Je} compact inline .state=${e} .localize=${this.localize}></${Je}>
                      </div>
                    `:k}
                  </div>
                `:k}
                <div
                  class="sheet-body"
                  id="sheet-body"
                  @pointerdown=${this.#U}
                  @pointermove=${this.#ne}
                  @pointerup=${this.#w}
                  @pointercancel=${this.#w}
                >
                  ${this.#ce(e,s)}
                </div>
                ${this.#N(e,c,u)}
              `:b`
                <div class="status-strip">
                  <span class="status-icon" aria-hidden="true">${I(n.icon)}</span>
                  <span class="status-copy"><strong>${n.title}</strong><small>${n.detail}</small></span>
                  ${l?this.#z(l,"status-action ms-btn ms-btn--secondary","status-reason"):k}
                </div>
                <section class="workflow">
                  <div class="workflow-body">${this.#ce(e,s)}</div>
                  ${this.#N(e,c,u)}
                </section>
              `}
            </aside>

            ${e.fullMap?b`
              <section
                class=${`full-map-hud ms-surface ms-surface--floating ${i?"has-secondary":""} ${!s&&(e.workflow==="draw"||e.workflow==="rooms"&&e.selection.roomIds.length>0)?"above-dock":""}`}
                aria-label="Robot status and action"
              >
                <span class="hud-copy"><strong>${n.title}</strong><small>${n.detail}</small></span>
                ${f&&o.id!=="stop"?k:this.#z(o,"ms-btn ms-btn--lg ms-btn--primary","hud-reason")}
                ${i&&(!f||i.id==="stop")?this.#z(i,"ms-btn ms-btn--lg ms-btn--secondary","hud-secondary-reason"):k}
              </section>
            `:k}
          </main>
        </div>

        <div class="sr-only" aria-live="polite" aria-atomic="true">${[this._announcement,e.notice?.text??""].filter(Boolean).join(" ")}</div>

        ${this._helpOpen?this.#x():k}

        ${y?b`
          <div class="dialog-backdrop">
            <section
              class="dialog ms-surface ms-surface--overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="dialog-title"
              aria-describedby="dialog-detail"
              @keydown=${this.#W}
            >
              <h2 id="dialog-title">${y.title}</h2>
              <p id="dialog-detail">${y.detail}</p>
              <div class="dialog-actions">
                <button
                  class="ms-btn ms-btn--secondary"
                  type="button"
                  data-dialog-initial-focus
                  @click=${e.dialog==="discardDraft"?this.#u:this.#L}
                >${y.cancelLabel}</button>
                ${y.action===null?k:b`
                  <button
                    class="discard ms-btn ms-btn--primary ms-btn--danger"
                    type="button"
                    @click=${()=>this.#q(y)}
                  >${y.confirmLabel}</button>
                `}
              </div>
            </section>
          </div>
        `:k}
      </div>
    `}};customElements.get(be)||customElements.define(be,wt);var qs=ae(be),_t=class extends se{constructor(){super(...arguments);this.narrow=!1;this._workspace=O();this.#e=new We;this.#t=new xt(this._workspace);this.#n=null;this.#r=null;this.#i=null;this.#a=null;this.#o=null}static{this.styles=[ne,re,te`
:host { display: block; block-size: 100%; }
`]}static{this.properties={hass:{attribute:!1},narrow:{type:Boolean},route:{attribute:!1},panel:{attribute:!1},_workspace:{state:!0}}}#e;#t;#n;#r;#i;#a;#o;#s(e=this.hass,s=this.panel){let n=this.#t.value.selection;return n.entrySource==="user"?this.#e.project(e,s,n.entryId):this.#e.project(e,s)}shouldUpdate(e){if(!e.has("hass")||[...e.keys()].some(n=>n!=="hass"))return!0;let s=e.get("hass");return s?.connection!==this.hass?.connection||s?.localize!==this.hass?.localize?!0:this.#s()!==this.#n}connectedCallback(){super.connectedCallback(),this.#r=this.#t.subscribe(e=>{if(this._workspace=e,e.selection.entryId!==this.#n?.entryKey){let s=this.#s();s!==this.#n&&(this.#n=s,this.#a?.sync(s))}}),this.#h()}disconnectedCallback(){this.#r?.(),this.#r=null,this.#f(),super.disconnectedCallback()}#h(){if(!(!this.isConnected||this.#a)&&(this.#n=this.#s(),this.#i=new He(()=>this.hass),this.#a=new Ge(this.#t,this.#i,this.hass?.connection??null),this.#o=new Qe(this.#t),this.#o.start(),this.#n)){this.#a.sync(this.#n);let{host:e}=this.#n;e.connected&&e.administrator&&e.robotCount>0&&this.#a.refreshCatalog(this.#t.value.selection.floorId==="current")}}#f(){this.#o?.dispose(),this.#o=null,this.#a?.dispose(),this.#a=null,this.#i=null}willUpdate(e){if(e.has("hass")||e.has("panel")){let s=e.get("hass"),n=e.has("hass")&&s?.connection!==this.hass?.connection,r=this.#s(),o=r!==this.#n;o&&(this.#n=r),n?(this.#f(),this.#h()):(o||e.has("panel"))&&this.#a?.sync(r)}e.has("narrow")&&this.#t.value.narrowHint!==this.narrow&&this.#t.dispatch({type:"set-narrow-hint",value:this.narrow})}#d(e){if(!Pe(e.detail))return;e.stopPropagation();let s=e.detail;if(s.type==="dismiss-top-layer"||s.type==="exit-full-map"){this.#o?.dismissTop()||this.#t.dispatch(s);return}if(s.type==="open-workflow"&&s.workflow!=="none"){this.#a?.openWorkflow(s.workflow);return}if(s.type==="set-floor"){this.#a?.selectFloor(s.floorId);return}if(s.type==="select-entry"){if(!this._workspace.robots.some(n=>n.entryId===s.entryId)||this.#e.project(this.hass,this.panel,s.entryId).entryKey!==s.entryId)return;this.#t.dispatch(s);return}if(s.type==="set-history"){this.#a?.selectHistory(s.historyId);return}if(s.type==="select-plan"){this.#a?.selectPlan(s.planId);return}if(s.type==="select-area"){this.#a?.selectArea(s.areaId),s.workflow==="areaReview"&&this.#a?.openWorkflow("areaReview");return}this.#t.dispatch(s)}#M(e){e.stopPropagation(),typeof e.detail?.id=="string"&&(e.detail.id==="reset-room-cadence"&&"planId"in e.detail&&"roomId"in e.detail&&"mode"in e.detail?this.#a?.executeAction(e.detail):this.#a?.executeAction(e.detail.id),this.dispatchEvent(new CustomEvent("matic-map-v4-action-requested",{detail:{id:e.detail.id},bubbles:!0,composed:!0})))}getWorkspaceSnapshot(){return this.#t.value}getRequestDiagnostics(){return Object.freeze({http:this.#i?.requestDiagnostics()??null,workspace:this.#a?.workspaceDiagnostics()??null})}render(){return b`
      <${qs}
        .state=${this._workspace}
        .localize=${this.hass?.localize}
        @matic-workspace-intent=${this.#d}
        @matic-workspace-action=${this.#M}
      ></${qs}>
    `}};customElements.get(rt)||customElements.define(rt,_t);export{We as a,ae as b,b as c,_t as d};
/*! Bundled license information:

lit-html/static.js:
  (**
   * @license
   * Copyright 2020 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/
