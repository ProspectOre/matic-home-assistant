var S=100,Y=1e3,I=.2,j=2.5,ne=64,xt=r=>!r||typeof r!="object"?!1:typeof r.type=="string";var E=()=>({status:"idle",value:null,problem:null}),_=(r,e,t)=>Math.max(e,Math.min(t,r)),Qe=r=>({yaw:_(Number.isFinite(r.yaw)?r.yaw:0,-Math.PI,Math.PI),pitch:_(Number.isFinite(r.pitch)?r.pitch:Math.PI/2-.018,.18,Math.PI/2-.018),zoom:_(Number.isFinite(r.zoom)?r.zoom:1,.01,100),targetX:_(Number.isFinite(r.targetX)?r.targetX:0,-1e4,1e4),targetZ:_(Number.isFinite(r.targetZ)?r.targetZ:0,-1e4,1e4)}),ke=r=>Math.round(_(Number.isFinite(r)?r:100,100,1e3)),Je=r=>Math.round(_(Number.isFinite(r)?r:.2,.2,2.5)*100)/100,W=()=>({generation:0,coherence:"verifying",dataMode:"live",activity:"unknown",workflow:"none",command:"idle",fullMap:!1,precisionOpen:!1,dialog:null,narrowHint:!1,view:"top",appearance:"photo",labelsVisible:!0,quality:"auto",cameras:{},managedLock:!1,batteryPercent:null,floor:{classifiedCount:1,displayName:"Current floor",readOnly:!1},map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1},host:{connected:!0,administrator:!0,robotConnected:!1,robotCount:0},draw:{zoomPercent:100,zoomOriginX:50,zoomOriginY:50,brushMeters:.6,tool:"paint",dirty:!1,strokeCount:0,circles:[],undo:[],redo:[]},resources:{catalog:E(),entry:null,scene:E(),pose:E(),history:E(),plans:E(),areas:E()},selection:{entryId:null,floorId:"current",historyId:null,roomIds:[],cleaningMode:"vacuum",coverageSetting:"standard",planId:null,areaId:null},planDraft:{id:null,name:"",enabled:!0,runBehavior:"intelligent",rooms:[],returnToBase:!0,finishCurrentRoom:!1,finishCurrentRoomThreshold:50,dirty:!1},areaDraft:{id:null,name:"",cleaningMode:"vacuum",coverageSetting:"standard",status:"new",canRebind:!1,dirty:!1},notice:null,robotLabel:"Matic robot",robots:[],locale:"en"}),b=(r,e)=>({...r,draw:{...r.draw,...e}}),et=(r,e)=>{switch(e.type){case"set-host":return{...r,host:e.host,fullMap:e.host.administrator&&e.host.robotCount>0?r.fullMap:!1};case"set-operational-state":return{...r,coherence:e.coherence,activity:e.activity,command:e.command??r.command};case"set-narrow-hint":return{...r,narrowHint:e.value};case"set-view":return{...r,view:e.view};case"set-appearance":return{...r,appearance:e.appearance};case"set-quality":return{...r,quality:e.quality};case"set-camera":return{...r,cameras:{...r.cameras,[e.view]:Qe(e.camera)}};case"toggle-labels":return{...r,labelsVisible:!r.labelsVisible};case"open-workflow":return{...r,workflow:e.workflow,precisionOpen:!1};case"enter-full-map":return r.host.administrator&&r.host.robotCount>0&&r.map.available?{...r,fullMap:!0}:r;case"exit-full-map":return{...r,fullMap:!1,precisionOpen:!1};case"set-precision-open":return{...r,precisionOpen:e.value};case"set-zoom":return b(r,{zoomPercent:ke(e.value),...e.originX===void 0?{}:{zoomOriginX:_(e.originX,0,100)},...e.originY===void 0?{}:{zoomOriginY:_(e.originY,0,100)}});case"step-zoom":return b(r,{zoomPercent:ke(r.draw.zoomPercent*e.factor)});case"fit-map":return b(r,{zoomPercent:100,zoomOriginX:50,zoomOriginY:50});case"set-brush":return b(r,{brushMeters:Je(e.value)});case"set-draw-tool":return b(r,{tool:e.tool});case"mark-draft":{let t=Math.max(0,r.draw.strokeCount+e.strokeDelta);return b(r,{dirty:t>0,strokeCount:t})}case"undo-draft":{let t=r.draw.undo.at(-1);return t?b(r,{circles:t,undo:r.draw.undo.slice(0,-1),redo:[...r.draw.redo,r.draw.circles],dirty:!0,strokeCount:Math.max(0,r.draw.strokeCount-1)}):r}case"clear-draft":return r.draw.circles.length?b(r,{circles:[],undo:[...r.draw.undo.slice(-99),r.draw.circles],redo:[],dirty:!0,strokeCount:r.draw.strokeCount+1}):r;case"redo-draft":{let t=r.draw.redo.at(-1);return t?b(r,{circles:t,undo:[...r.draw.undo,r.draw.circles],redo:r.draw.redo.slice(0,-1),dirty:!0,strokeCount:r.draw.strokeCount+1}):r}case"set-draft-circles":{let t=e.circles.slice(0,512).map(i=>({...i})),o=e.record!==!1;return b(r,{circles:t,undo:o?[...r.draw.undo.slice(-99),e.previous??r.draw.circles]:r.draw.undo,redo:o?[]:r.draw.redo,dirty:!0,strokeCount:o?r.draw.strokeCount+1:r.draw.strokeCount})}case"discard-draft":return{...b(r,{dirty:!1,strokeCount:0,circles:[],undo:[],redo:[]}),dialog:null,workflow:"none",precisionOpen:!1};case"toggle-room":{let t=r.selection.roomIds.includes(e.roomId);return{...r,selection:{...r.selection,roomIds:t?r.selection.roomIds.filter(o=>o!==e.roomId):[...r.selection.roomIds,e.roomId]}}}case"patch-room-settings":return{...r,selection:{...r.selection,...e.cleaningMode?{cleaningMode:e.cleaningMode}:{},...e.coverageSetting?{coverageSetting:e.coverageSetting}:{}}};case"set-floor":return{...r,dataMode:e.floorId==="current"?"live":"history",selection:{...r.selection,floorId:e.floorId,historyId:null}};case"select-entry":return r;case"set-history":return{...r,dataMode:e.historyId?"history":"live",selection:{...r.selection,historyId:e.historyId}};case"select-plan":return{...r,selection:{...r.selection,planId:e.planId}};case"select-area":return{...r,selection:{...r.selection,areaId:e.areaId}};case"patch-plan-draft":return{...r,planDraft:{...r.planDraft,...e.patch,dirty:e.patch.dirty??!0}};case"patch-area-draft":return{...r,areaDraft:{...r.areaDraft,...e.patch,dirty:e.patch.dirty??!0}};case"set-notice":return{...r,notice:e.notice};case"open-dialog":return{...r,dialog:e.dialog};case"dismiss-top-layer":return r.dialog?{...r,dialog:null}:r.precisionOpen?{...r,precisionOpen:!1}:r.fullMap?{...r,fullMap:!1}:r.workflow!=="none"?{...r,workflow:"none",precisionOpen:!1}:r;case"return-live":return{...r,dataMode:"live",workflow:"none",floor:{...r.floor,readOnly:!1}}}},Me=class{#t=new Set;#e;constructor(e=W()){this.#e=e}get value(){return this.#e}dispatch(e){let t=et(this.#e,e);if(t===this.#e)return t;this.#e=t;for(let o of this.#t)o(t);return t}replace(e){if(e!==this.#e){this.#e=e;for(let t of this.#t)t(e)}}patch(e){let t={...this.#e,...e};return this.replace(t),t}subscribe(e){return this.#t.add(e),e(this.#e),()=>this.#t.delete(e)}},Se=class{#t=null;#e=0;get generation(){return this.#e}begin(e,t,o,i){return this.#e+=1,this.#t={entryKey:e,generation:this.#e,floorKey:t,missionKey:o,revision:i},this.#t}current(){return this.#t}accepts(e){let t=this.#t;return!!(t&&e.entryKey===t.entryKey&&e.generation===t.generation&&e.floorKey===t.floorKey&&e.missionKey===t.missionKey&&e.revision===t.revision)}advance(e,t){return!this.accepts(e)||!Number.isSafeInteger(t)||t<=e.revision?null:(this.#t={...e,revision:t},this.#t)}invalidate(){return this.#e+=1,this.#t=null,this.#e}},O=r=>r.dataMode==="live"&&r.map.available&&(r.coherence==="current"||r.coherence==="degraded")&&r.host.administrator,$e=r=>O(r)&&(r.coherence==="current"||r.coherence==="degraded")&&r.map.floorCoherent&&r.map.sessionVerified&&r.map.exactPose&&r.host.connected&&r.host.robotConnected,G=r=>O(r)&&r.coherence==="current"&&r.map.complete&&r.map.floorCoherent&&r.map.sessionVerified&&r.host.connected&&r.host.robotConnected&&!r.floor.readOnly,R=r=>G(r)&&!r.managedLock&&r.command==="idle"&&(r.activity==="idle"||r.activity==="docked"),D=(r,e,t)=>({id:r,label:e,kind:"neutral",enabled:!1,reason:t}),St=r=>{if(r.dataMode==="history")return{id:"return-live",label:"Return to Live",kind:"primary",enabled:!0};if(r.activity==="cleaning"||r.activity==="returning")return{id:"stop",label:"Stop",kind:"danger",enabled:r.command==="idle"};if(r.activity==="stopping"||r.command==="settling")return D("stopping","Stopping\u2026","Waiting for the robot to settle");if(r.activity==="paused")return{id:"resume",label:"Resume",kind:"primary",enabled:r.command==="idle"};if(!r.host.connected)return D("reconnecting","Reconnecting\u2026","Home Assistant is offline");if(!r.host.administrator)return D("administrator","Administrator required","This map is private");if(!r.host.robotConnected)return D("robot-offline","Robot offline","Reconnect the robot first");if(r.coherence!=="current")return D("locating","Locating\u2026","Waiting for the current map");if(r.workflow==="draw")return r.fullMap||r.narrowHint?{id:"review-area",label:"Review details",kind:"primary",enabled:r.draw.dirty,...r.draw.dirty?{}:{reason:"Draw an area first"}}:{id:"save-area",label:"Save area",kind:"primary",enabled:r.draw.dirty&&G(r),...r.draw.dirty?{}:{reason:"Draw an area first"}};if(r.workflow==="rooms"){let e=R(r)&&r.selection.roomIds.length>0;return{id:"clean-rooms",label:r.selection.roomIds.length?`Clean ${r.selection.roomIds.length} room${r.selection.roomIds.length===1?"":"s"}`:"Choose rooms",kind:"primary",enabled:e,...e?{}:{reason:r.selection.roomIds.length?"Map verification is required":"Select at least one room"}}}if(r.workflow==="plan"){if(r.planDraft.dirty||!r.planDraft.id){let e=G(r)&&r.planDraft.name.trim().length>0&&r.planDraft.rooms.length>0;return{id:"save-plan",label:"Save plan",kind:"primary",enabled:e,...e?{}:{reason:"Add a name and at least one room"}}}return{id:"run-plan",label:"Run plan",kind:"primary",enabled:R(r)&&r.planDraft.enabled,...R(r)?{}:{reason:"Map verification is required"}}}if(r.workflow==="areaReview"){if(r.areaDraft.dirty||r.draw.dirty||!r.areaDraft.id||r.areaDraft.canRebind){let t=G(r)&&r.areaDraft.name.trim().length>0&&r.draw.circles.length>0;return{id:"save-area",label:r.areaDraft.canRebind?"Confirm on this map":"Save area",kind:"primary",enabled:t,...t?{}:{reason:"Add a name and at least one mark"}}}let e=r.areaDraft.status==="current";return{id:"run-area",label:"Clean area",kind:"primary",enabled:e&&R(r),...e?{}:{reason:"Review or redraw this area first"}}}return{id:"run-plan",label:"Run plan",kind:"primary",enabled:R(r),...R(r)?{}:{reason:"Map verification is required"}}},$t=r=>r.activity==="paused"?{id:"stop",label:"Stop",kind:"danger",enabled:r.command==="idle"}:null,Ct=r=>r.draw.brushMeters*64*(r.draw.zoomPercent/100),tt=[2,1,.5,.25,.1,.05],Ce=r=>{let e=64*(r.draw.zoomPercent/100),t=tt.reduce((o,i)=>{let n=Math.abs(i*e-64),a=Math.abs(o*e-64);return n<a?i:o});return{meters:t,pixels:t*e,label:t<1?`${Math.round(t*100)} cm`:`${t} m`}},At=(r,e)=>({...r,command:e});var Q=globalThis,J=Q.ShadowRoot&&(Q.ShadyCSS===void 0||Q.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,ae=Symbol(),Ae=new WeakMap,N=class{constructor(e,t,o){if(this._$cssResult$=!0,o!==ae)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=e,this.t=t}get styleSheet(){let e=this.o,t=this.t;if(J&&e===void 0){let o=t!==void 0&&t.length===1;o&&(e=Ae.get(t)),e===void 0&&((this.o=e=new CSSStyleSheet).replaceSync(this.cssText),o&&Ae.set(t,e))}return e}toString(){return this.cssText}},Pe=r=>new N(typeof r=="string"?r:r+"",void 0,ae),H=(r,...e)=>{let t=r.length===1?r[0]:e.reduce((o,i,n)=>o+(a=>{if(a._$cssResult$===!0)return a.cssText;if(typeof a=="number")return a;throw Error("Value passed to 'css' function must be a 'css' function result: "+a+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(i)+r[n+1],r[0]);return new N(t,r,ae)},Ee=(r,e)=>{if(J)r.adoptedStyleSheets=e.map(t=>t instanceof CSSStyleSheet?t:t.styleSheet);else for(let t of e){let o=document.createElement("style"),i=Q.litNonce;i!==void 0&&o.setAttribute("nonce",i),o.textContent=t.cssText,r.appendChild(o)}},se=J?r=>r:r=>r instanceof CSSStyleSheet?(e=>{let t="";for(let o of e.cssRules)t+=o.cssText;return Pe(t)})(r):r;var{is:rt,defineProperty:ot,getOwnPropertyDescriptor:it,getOwnPropertyNames:nt,getOwnPropertySymbols:at,getPrototypeOf:st}=Object,ee=globalThis,Re=ee.trustedTypes,lt=Re?Re.emptyScript:"",ct=ee.reactiveElementPolyfillSupport,U=(r,e)=>r,le={toAttribute(r,e){switch(e){case Boolean:r=r?lt:null;break;case Object:case Array:r=r==null?r:JSON.stringify(r)}return r},fromAttribute(r,e){let t=r;switch(e){case Boolean:t=r!==null;break;case Number:t=r===null?null:Number(r);break;case Object:case Array:try{t=JSON.parse(r)}catch{t=null}}return t}},Te=(r,e)=>!rt(r,e),ze={attribute:!0,type:String,converter:le,reflect:!1,useDefault:!1,hasChanged:Te};Symbol.metadata??=Symbol("metadata"),ee.litPropertyMetadata??=new WeakMap;var x=class extends HTMLElement{static addInitializer(e){this._$Ei(),(this.l??=[]).push(e)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(e,t=ze){if(t.state&&(t.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(e)&&((t=Object.create(t)).wrapped=!0),this.elementProperties.set(e,t),!t.noAccessor){let o=Symbol(),i=this.getPropertyDescriptor(e,o,t);i!==void 0&&ot(this.prototype,e,i)}}static getPropertyDescriptor(e,t,o){let{get:i,set:n}=it(this.prototype,e)??{get(){return this[t]},set(a){this[t]=a}};return{get:i,set(a){let l=i?.call(this);n?.call(this,a),this.requestUpdate(e,l,o)},configurable:!0,enumerable:!0}}static getPropertyOptions(e){return this.elementProperties.get(e)??ze}static _$Ei(){if(this.hasOwnProperty(U("elementProperties")))return;let e=st(this);e.finalize(),e.l!==void 0&&(this.l=[...e.l]),this.elementProperties=new Map(e.elementProperties)}static finalize(){if(this.hasOwnProperty(U("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(U("properties"))){let t=this.properties,o=[...nt(t),...at(t)];for(let i of o)this.createProperty(i,t[i])}let e=this[Symbol.metadata];if(e!==null){let t=litPropertyMetadata.get(e);if(t!==void 0)for(let[o,i]of t)this.elementProperties.set(o,i)}this._$Eh=new Map;for(let[t,o]of this.elementProperties){let i=this._$Eu(t,o);i!==void 0&&this._$Eh.set(i,t)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(e){let t=[];if(Array.isArray(e)){let o=new Set(e.flat(1/0).reverse());for(let i of o)t.unshift(se(i))}else e!==void 0&&t.push(se(e));return t}static _$Eu(e,t){let o=t.attribute;return o===!1?void 0:typeof o=="string"?o:typeof e=="string"?e.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){this._$ES=new Promise(e=>this.enableUpdating=e),this._$AL=new Map,this._$E_(),this.requestUpdate(),this.constructor.l?.forEach(e=>e(this))}addController(e){(this._$EO??=new Set).add(e),this.renderRoot!==void 0&&this.isConnected&&e.hostConnected?.()}removeController(e){this._$EO?.delete(e)}_$E_(){let e=new Map,t=this.constructor.elementProperties;for(let o of t.keys())this.hasOwnProperty(o)&&(e.set(o,this[o]),delete this[o]);e.size>0&&(this._$Ep=e)}createRenderRoot(){let e=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return Ee(e,this.constructor.elementStyles),e}connectedCallback(){this.renderRoot??=this.createRenderRoot(),this.enableUpdating(!0),this._$EO?.forEach(e=>e.hostConnected?.())}enableUpdating(e){}disconnectedCallback(){this._$EO?.forEach(e=>e.hostDisconnected?.())}attributeChangedCallback(e,t,o){this._$AK(e,o)}_$ET(e,t){let o=this.constructor.elementProperties.get(e),i=this.constructor._$Eu(e,o);if(i!==void 0&&o.reflect===!0){let n=(o.converter?.toAttribute!==void 0?o.converter:le).toAttribute(t,o.type);this._$Em=e,n==null?this.removeAttribute(i):this.setAttribute(i,n),this._$Em=null}}_$AK(e,t){let o=this.constructor,i=o._$Eh.get(e);if(i!==void 0&&this._$Em!==i){let n=o.getPropertyOptions(i),a=typeof n.converter=="function"?{fromAttribute:n.converter}:n.converter?.fromAttribute!==void 0?n.converter:le;this._$Em=i;let l=a.fromAttribute(t,n.type);this[i]=l??this._$Ej?.get(i)??l,this._$Em=null}}requestUpdate(e,t,o,i=!1,n){if(e!==void 0){let a=this.constructor;if(i===!1&&(n=this[e]),o??=a.getPropertyOptions(e),!((o.hasChanged??Te)(n,t)||o.useDefault&&o.reflect&&n===this._$Ej?.get(e)&&!this.hasAttribute(a._$Eu(e,o))))return;this.C(e,t,o)}this.isUpdatePending===!1&&(this._$ES=this._$EP())}C(e,t,{useDefault:o,reflect:i,wrapped:n},a){o&&!(this._$Ej??=new Map).has(e)&&(this._$Ej.set(e,a??t??this[e]),n!==!0||a!==void 0)||(this._$AL.has(e)||(this.hasUpdated||o||(t=void 0),this._$AL.set(e,t)),i===!0&&this._$Em!==e&&(this._$Eq??=new Set).add(e))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(t){Promise.reject(t)}let e=this.scheduleUpdate();return e!=null&&await e,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??=this.createRenderRoot(),this._$Ep){for(let[i,n]of this._$Ep)this[i]=n;this._$Ep=void 0}let o=this.constructor.elementProperties;if(o.size>0)for(let[i,n]of o){let{wrapped:a}=n,l=this[i];a!==!0||this._$AL.has(i)||l===void 0||this.C(i,void 0,n,l)}}let e=!1,t=this._$AL;try{e=this.shouldUpdate(t),e?(this.willUpdate(t),this._$EO?.forEach(o=>o.hostUpdate?.()),this.update(t)):this._$EM()}catch(o){throw e=!1,this._$EM(),o}e&&this._$AE(t)}willUpdate(e){}_$AE(e){this._$EO?.forEach(t=>t.hostUpdated?.()),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(e)),this.updated(e)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(e){return!0}update(e){this._$Eq&&=this._$Eq.forEach(t=>this._$ET(t,this[t])),this._$EM()}updated(e){}firstUpdated(e){}};x.elementStyles=[],x.shadowRootOptions={mode:"open"},x[U("elementProperties")]=new Map,x[U("finalized")]=new Map,ct?.({ReactiveElement:x}),(ee.reactiveElementVersions??=[]).push("2.1.2");var ye=globalThis,Le=r=>r,te=ye.trustedTypes,Ie=te?te.createPolicy("lit-html",{createHTML:r=>r}):void 0,Ue="$lit$",M=`lit$${Math.random().toFixed(9).slice(2)}$`,Be="?"+M,dt=`<${Be}>`,A=document,X=()=>A.createComment(""),F=r=>r===null||typeof r!="object"&&typeof r!="function",fe=Array.isArray,ht=r=>fe(r)||typeof r?.[Symbol.iterator]=="function",ce=`[ 	
\f\r]`,B=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,De=/-->/g,We=/>/g,$=RegExp(`>|${ce}(?:([^\\s"'>=/]+)(${ce}*=${ce}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`,"g"),Oe=/'/g,Ne=/"/g,Xe=/^(?:script|style|textarea|title)$/i,be=r=>(e,...t)=>({_$litType$:r,strings:e,values:t}),f=be(1),Lt=be(2),It=be(3),P=Symbol.for("lit-noChange"),p=Symbol.for("lit-nothing"),He=new WeakMap,C=A.createTreeWalker(A,129);function Fe(r,e){if(!fe(r)||!r.hasOwnProperty("raw"))throw Error("invalid template strings array");return Ie!==void 0?Ie.createHTML(e):e}var pt=(r,e)=>{let t=r.length-1,o=[],i,n=e===2?"<svg>":e===3?"<math>":"",a=B;for(let l=0;l<t;l++){let s=r[l],c,d,h=-1,u=0;for(;u<s.length&&(a.lastIndex=u,d=a.exec(s),d!==null);)u=a.lastIndex,a===B?d[1]==="!--"?a=De:d[1]!==void 0?a=We:d[2]!==void 0?(Xe.test(d[2])&&(i=RegExp("</"+d[2],"g")),a=$):d[3]!==void 0&&(a=$):a===$?d[0]===">"?(a=i??B,h=-1):d[1]===void 0?h=-2:(h=a.lastIndex-d[2].length,c=d[1],a=d[3]===void 0?$:d[3]==='"'?Ne:Oe):a===Ne||a===Oe?a=$:a===De||a===We?a=B:(a=$,i=void 0);let m=a===$&&r[l+1].startsWith("/>")?" ":"";n+=a===B?s+dt:h>=0?(o.push(c),s.slice(0,h)+Ue+s.slice(h)+M+m):s+M+(h===-2?l:m)}return[Fe(r,n+(r[t]||"<?>")+(e===2?"</svg>":e===3?"</math>":"")),o]},V=class r{constructor({strings:e,_$litType$:t},o){let i;this.parts=[];let n=0,a=0,l=e.length-1,s=this.parts,[c,d]=pt(e,t);if(this.el=r.createElement(c,o),C.currentNode=this.el.content,t===2||t===3){let h=this.el.content.firstChild;h.replaceWith(...h.childNodes)}for(;(i=C.nextNode())!==null&&s.length<l;){if(i.nodeType===1){if(i.hasAttributes())for(let h of i.getAttributeNames())if(h.endsWith(Ue)){let u=d[a++],m=i.getAttribute(h).split(M),y=/([.?@])?(.*)/.exec(u);s.push({type:1,index:n,name:y[2],strings:m,ctor:y[1]==="."?he:y[1]==="?"?pe:y[1]==="@"?ue:T}),i.removeAttribute(h)}else h.startsWith(M)&&(s.push({type:6,index:n}),i.removeAttribute(h));if(Xe.test(i.tagName)){let h=i.textContent.split(M),u=h.length-1;if(u>0){i.textContent=te?te.emptyScript:"";for(let m=0;m<u;m++)i.append(h[m],X()),C.nextNode(),s.push({type:2,index:++n});i.append(h[u],X())}}}else if(i.nodeType===8)if(i.data===Be)s.push({type:2,index:n});else{let h=-1;for(;(h=i.data.indexOf(M,h+1))!==-1;)s.push({type:7,index:n}),h+=M.length-1}n++}}static createElement(e,t){let o=A.createElement("template");return o.innerHTML=e,o}};function z(r,e,t=r,o){if(e===P)return e;let i=o!==void 0?t._$Co?.[o]:t._$Cl,n=F(e)?void 0:e._$litDirective$;return i?.constructor!==n&&(i?._$AO?.(!1),n===void 0?i=void 0:(i=new n(r),i._$AT(r,t,o)),o!==void 0?(t._$Co??=[])[o]=i:t._$Cl=i),i!==void 0&&(e=z(r,i._$AS(r,e.values),i,o)),e}var de=class{constructor(e,t){this._$AV=[],this._$AN=void 0,this._$AD=e,this._$AM=t}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(e){let{el:{content:t},parts:o}=this._$AD,i=(e?.creationScope??A).importNode(t,!0);C.currentNode=i;let n=C.nextNode(),a=0,l=0,s=o[0];for(;s!==void 0;){if(a===s.index){let c;s.type===2?c=new q(n,n.nextSibling,this,e):s.type===1?c=new s.ctor(n,s.name,s.strings,this,e):s.type===6&&(c=new me(n,this,e)),this._$AV.push(c),s=o[++l]}a!==s?.index&&(n=C.nextNode(),a++)}return C.currentNode=A,i}p(e){let t=0;for(let o of this._$AV)o!==void 0&&(o.strings!==void 0?(o._$AI(e,o,t),t+=o.strings.length-2):o._$AI(e[t])),t++}},q=class r{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(e,t,o,i){this.type=2,this._$AH=p,this._$AN=void 0,this._$AA=e,this._$AB=t,this._$AM=o,this.options=i,this._$Cv=i?.isConnected??!0}get parentNode(){let e=this._$AA.parentNode,t=this._$AM;return t!==void 0&&e?.nodeType===11&&(e=t.parentNode),e}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(e,t=this){e=z(this,e,t),F(e)?e===p||e==null||e===""?(this._$AH!==p&&this._$AR(),this._$AH=p):e!==this._$AH&&e!==P&&this._(e):e._$litType$!==void 0?this.$(e):e.nodeType!==void 0?this.T(e):ht(e)?this.k(e):this._(e)}O(e){return this._$AA.parentNode.insertBefore(e,this._$AB)}T(e){this._$AH!==e&&(this._$AR(),this._$AH=this.O(e))}_(e){this._$AH!==p&&F(this._$AH)?this._$AA.nextSibling.data=e:this.T(A.createTextNode(e)),this._$AH=e}$(e){let{values:t,_$litType$:o}=e,i=typeof o=="number"?this._$AC(e):(o.el===void 0&&(o.el=V.createElement(Fe(o.h,o.h[0]),this.options)),o);if(this._$AH?._$AD===i)this._$AH.p(t);else{let n=new de(i,this),a=n.u(this.options);n.p(t),this.T(a),this._$AH=n}}_$AC(e){let t=He.get(e.strings);return t===void 0&&He.set(e.strings,t=new V(e)),t}k(e){fe(this._$AH)||(this._$AH=[],this._$AR());let t=this._$AH,o,i=0;for(let n of e)i===t.length?t.push(o=new r(this.O(X()),this.O(X()),this,this.options)):o=t[i],o._$AI(n),i++;i<t.length&&(this._$AR(o&&o._$AB.nextSibling,i),t.length=i)}_$AR(e=this._$AA.nextSibling,t){for(this._$AP?.(!1,!0,t);e!==this._$AB;){let o=Le(e).nextSibling;Le(e).remove(),e=o}}setConnected(e){this._$AM===void 0&&(this._$Cv=e,this._$AP?.(e))}},T=class{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(e,t,o,i,n){this.type=1,this._$AH=p,this._$AN=void 0,this.element=e,this.name=t,this._$AM=i,this.options=n,o.length>2||o[0]!==""||o[1]!==""?(this._$AH=Array(o.length-1).fill(new String),this.strings=o):this._$AH=p}_$AI(e,t=this,o,i){let n=this.strings,a=!1;if(n===void 0)e=z(this,e,t,0),a=!F(e)||e!==this._$AH&&e!==P,a&&(this._$AH=e);else{let l=e,s,c;for(e=n[0],s=0;s<n.length-1;s++)c=z(this,l[o+s],t,s),c===P&&(c=this._$AH[s]),a||=!F(c)||c!==this._$AH[s],c===p?e=p:e!==p&&(e+=(c??"")+n[s+1]),this._$AH[s]=c}a&&!i&&this.j(e)}j(e){e===p?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,e??"")}},he=class extends T{constructor(){super(...arguments),this.type=3}j(e){this.element[this.name]=e===p?void 0:e}},pe=class extends T{constructor(){super(...arguments),this.type=4}j(e){this.element.toggleAttribute(this.name,!!e&&e!==p)}},ue=class extends T{constructor(e,t,o,i,n){super(e,t,o,i,n),this.type=5}_$AI(e,t=this){if((e=z(this,e,t,0)??p)===P)return;let o=this._$AH,i=e===p&&o!==p||e.capture!==o.capture||e.once!==o.once||e.passive!==o.passive,n=e!==p&&(o===p||i);i&&this.element.removeEventListener(this.name,this,o),n&&this.element.addEventListener(this.name,this,e),this._$AH=e}handleEvent(e){typeof this._$AH=="function"?this._$AH.call(this.options?.host??this.element,e):this._$AH.handleEvent(e)}},me=class{constructor(e,t,o){this.element=e,this.type=6,this._$AN=void 0,this._$AM=t,this.options=o}get _$AU(){return this._$AM._$AU}_$AI(e){z(this,e)}};var ut=ye.litHtmlPolyfillSupport;ut?.(V,q),(ye.litHtmlVersions??=[]).push("3.3.3");var Ve=(r,e,t)=>{let o=t?.renderBefore??e,i=o._$litPart$;if(i===void 0){let n=t?.renderBefore??null;o._$litPart$=i=new q(e.insertBefore(X(),n),n,void 0,t??{})}return i._$AI(r),i};var ge=globalThis,g=class extends x{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){let e=super.createRenderRoot();return this.renderOptions.renderBefore??=e.firstChild,e}update(e){let t=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(e),this._$Do=Ve(t,this.renderRoot,this.renderOptions)}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(!0)}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(!1)}render(){return P}};g._$litElement$=!0,g.finalized=!0,ge.litElementHydrateSupport?.({LitElement:g});var mt=ge.litElementPolyfillSupport;mt?.({LitElement:g});(ge.litElementVersions??=[]).push("4.2.2");var qe="component.matic_robot.common.",K=(r,e,t,o)=>{let i=o?{...o}:void 0,n=r?.(`${qe}${e}`,i);return n&&n!==`${qe}${e}`?n:o?Object.entries(o).reduce((a,[l,s])=>a.replaceAll(`{${l}}`,String(s)),t):t};var Ke=(r,e)=>Math.hypot(r.x-e.x,r.y-e.y),Ze=(r,e)=>({x:(r.x+e.x)/2,y:(r.y+e.y)/2}),ve=r=>r.map(e=>({...e})),Ye=r=>r instanceof Element&&!!r.closest("button, input, select, textarea, a, [role='button'], [role='menuitem']"),re=class{#t;#e;#s;#r=new Map;#n=!1;#i="idle";#c=[];#a=[];#h=null;#p=0;#f=null;#b=!1;#g=null;#w=!1;constructor(e,t,o){this.#t=e,this.#e=t,this.#s=o,e.addEventListener("pointerdown",this.#k),e.addEventListener("pointermove",this.#u),e.addEventListener("pointerup",this.#l),e.addEventListener("pointercancel",this.#l),e.addEventListener("wheel",this.#v,{passive:!1}),e.addEventListener("keydown",this.#M),e.addEventListener("keyup",this.#o),e.addEventListener("blur",this.#_)}#k=e=>{if(this.#w||!e.isPrimary&&e.pointerType==="mouse"||Ye(e.target))return;this.#t.focus({preventScroll:!0});let t={id:e.pointerId,type:e.pointerType,startX:e.clientX,startY:e.clientY,x:e.clientX,y:e.clientY};if(this.#r.set(e.pointerId,t),this.#t.setPointerCapture?.(e.pointerId),this.#r.size>=2){this.#m(),(this.#i==="paint"||this.#i==="erase")&&(this.#a=ve(this.#c),this.#s.onCircles(this.#a,!1)),this.#i="pinch",this.#b=!0;let[a,l]=[...this.#r.values()];a&&l&&(this.#p=Math.max(1,Ke(a,l)),this.#f=Ze(a,l)),e.preventDefault();return}let o=this.#s.state(),i=o.workflow==="draw"&&o.map.available&&!o.floor.readOnly;this.#b||this.#n||e.button===1||o.draw.tool==="pan"?this.#i="pan":i&&(o.draw.tool==="paint"||o.draw.tool==="erase")?(this.#c=ve(o.draw.circles),this.#a=ve(o.draw.circles),e.pointerType==="touch"?(this.#i="idle",this.#g=window.setTimeout(()=>{if(this.#g=null,this.#r.size!==1||this.#b)return;this.#i=o.draw.tool;let a=this.#r.get(e.pointerId);a&&this.#y(a.x,a.y)},110)):(this.#i=o.draw.tool,this.#y(e.clientX,e.clientY))):this.#i=o.view==="three"&&!e.shiftKey?"orbit":"pan",e.preventDefault()};#u=e=>{let t=this.#r.get(e.pointerId);if(!t){let a=this.#e.screenToMap(e.clientX,e.clientY);this.#e.setCursor(a);return}let o=t.x,i=t.y;if(t.x=e.clientX,t.y=e.clientY,this.#i==="pinch"&&this.#r.size>=2){let[a,l]=[...this.#r.values()];if(!a||!l)return;let s=Math.max(1,Ke(a,l)),c=Ze(a,l);this.#e.zoomAt(s/this.#p,c.x,c.y),this.#f&&this.#e.panBy(c.x-this.#f.x,c.y-this.#f.y),this.#p=s,this.#f=c,e.preventDefault();return}this.#i==="paint"||this.#i==="erase"?this.#y(e.clientX,e.clientY):this.#i==="pan"?this.#e.panBy(e.clientX-o,e.clientY-i):this.#i==="orbit"&&this.#e.orbitBy(e.clientX-o,e.clientY-i);let n=this.#e.screenToMap(e.clientX,e.clientY);this.#e.setCursor(n),e.preventDefault()};#l=e=>{let t=this.#r.get(e.pointerId);if(t){if(this.#r.delete(e.pointerId),this.#t.releasePointerCapture?.(e.pointerId),this.#m(),(this.#i==="paint"||this.#i==="erase")&&JSON.stringify(this.#a)!==JSON.stringify(this.#c))this.#s.onCircles(this.#a,!0,this.#c);else if(this.#i!=="pinch"&&!this.#b&&Math.hypot(t.x-t.startX,t.y-t.startY)<7&&this.#s.state().workflow==="rooms"){let o=this.#e.roomAt(t.x,t.y);o&&this.#s.onRoom(o)}this.#r.size===0?(this.#i="idle",this.#b=!1,this.#f=null,this.#h=null):this.#i==="pinch"&&(this.#i="pan",this.#b=!0),e.preventDefault()}};#y(e,t){let o=this.#e.screenToMap(e,t);if(!o)return;let n=this.#s.state().draw.brushMeters/2;if(this.#i==="erase")this.#a=this.#a.filter(a=>Math.hypot(a.x-o.x,a.y-o.y)>a.radius+n);else{if(!this.#e.containsMapPoint(o))return;let a=Math.max(.04,n*.55),l=this.#h||o,s=Math.hypot(o.x-l.x,o.y-l.y),c=Math.max(1,Math.ceil(s/a));for(let d=0;d<=c&&this.#a.length<512;d+=1){let h=d/c,u={x:l.x+(o.x-l.x)*h,y:l.y+(o.y-l.y)*h};this.#a.some(m=>Math.hypot(m.x-u.x,m.y-u.y)<Math.max(.025,n*.28))||this.#a.push({x:Math.round(u.x*1e4)/1e4,y:Math.round(u.y*1e4)/1e4,radius:Math.round(n*100)/100})}}this.#h=o,this.#s.onCircles(this.#a,!1)}#v=e=>{if(!(e.ctrlKey||e.metaKey||e.altKey)&&!Ye(e.target)){if(e.preventDefault(),Math.abs(e.deltaX)>Math.abs(e.deltaY)*.7&&Math.abs(e.deltaX)<50){this.#e.panBy(-e.deltaX,-e.deltaY);return}this.#e.zoomAt(Math.exp(-e.deltaY*.0015),e.clientX,e.clientY)}};#M=e=>{if(!(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey)){if(e.code==="Space"){this.#n=!0,e.preventDefault();return}if(e.key==="+"||e.key==="=")this.#e.zoomAt(1.25);else if(e.key==="-")this.#e.zoomAt(.8);else if(e.key==="0")this.#e.fit();else if(e.key==="[")this.#e.orbitBy(-52,0);else if(e.key==="]")this.#e.orbitBy(52,0);else if(e.key==="PageUp")this.#e.orbitBy(0,-30);else if(e.key==="PageDown")this.#e.orbitBy(0,30);else if(e.key.toLocaleLowerCase()==="d"&&this.#s.state().workflow==="draw")this.#t.dispatchEvent(new CustomEvent("matic-workspace-intent",{detail:{type:"set-draw-tool",tool:"paint"},bubbles:!0,composed:!0}));else if(e.key.toLocaleLowerCase()==="e"&&this.#s.state().workflow==="draw")this.#t.dispatchEvent(new CustomEvent("matic-workspace-intent",{detail:{type:"set-draw-tool",tool:"erase"},bubbles:!0,composed:!0}));else if(e.key==="ArrowLeft")this.#e.panBy(30,0);else if(e.key==="ArrowRight")this.#e.panBy(-30,0);else if(e.key==="ArrowUp")this.#e.panBy(0,30);else if(e.key==="ArrowDown")this.#e.panBy(0,-30);else return;e.preventDefault()}};#o=e=>{e.code==="Space"&&(this.#n=!1)};#_=()=>{this.#n=!1,this.#m(),this.#e.setCursor(null)};#m(){this.#g!==null&&window.clearTimeout(this.#g),this.#g=null}dispose(){this.#w||(this.#w=!0,this.#m(),this.#t.removeEventListener("pointerdown",this.#k),this.#t.removeEventListener("pointermove",this.#u),this.#t.removeEventListener("pointerup",this.#l),this.#t.removeEventListener("pointercancel",this.#l),this.#t.removeEventListener("wheel",this.#v),this.#t.removeEventListener("keydown",this.#M),this.#t.removeEventListener("keyup",this.#o),this.#t.removeEventListener("blur",this.#_),this.#r.clear())}};var v=(r,e,t)=>Math.max(e,Math.min(t,r)),yt=r=>{let e=r;for(;e>Math.PI;)e-=Math.PI*2;for(;e<-Math.PI;)e+=Math.PI*2;return e},ft=r=>{switch(r){case"efficient":return .35;case"balanced":return .65;case"maximum":case"auto":return 1}},bt=(r,e)=>{let t=new Float32Array(16);for(let o=0;o<4;o+=1)for(let i=0;i<4;i+=1){let n=0;for(let a=0;a<4;a+=1)n+=(r[a*4+i]??0)*(e[o*4+a]??0);t[o*4+i]=n}return t},gt=(r,e,t,o)=>{let i=1/Math.tan(r/2),n=new Float32Array(16);return n[0]=i/e,n[5]=i,n[10]=(o+t)/(t-o),n[11]=-1,n[14]=2*o*t/(t-o),n},vt=(r,e,t,o,i,n)=>{let a=new Float32Array(16);return a[0]=2/(e-r),a[5]=2/(o-t),a[10]=-2/(n-i),a[12]=-(e+r)/(e-r),a[13]=-(o+t)/(o-t),a[14]=-(n+i)/(n-i),a[15]=1,a},wt=(r,e)=>{let t=Math.hypot((r[0]??0)-(e[0]??0),(r[1]??0)-(e[1]??0),(r[2]??0)-(e[2]??0))||1,o=[((r[0]??0)-(e[0]??0))/t,((r[1]??0)-(e[1]??0))/t,((r[2]??0)-(e[2]??0))/t],i=Math.hypot(o[2]??0,o[0]??0)||1,n=[(o[2]??0)/i,0,-(o[0]??0)/i],a=[(o[1]??0)*(n[2]??0),(o[2]??0)*(n[0]??0)-(o[0]??0)*(n[2]??0),-(o[1]??0)*(n[0]??0)];return new Float32Array([n[0]??0,a[0]??0,o[0]??0,0,n[1]??0,a[1]??0,o[1]??0,0,n[2]??0,a[2]??0,o[2]??0,0,-((n[0]??0)*(r[0]??0)+(n[1]??0)*(r[1]??0)+(n[2]??0)*(r[2]??0)),-((a[0]??0)*(r[0]??0)+(a[1]??0)*(r[1]??0)+(a[2]??0)*(r[2]??0)),-((o[0]??0)*(r[0]??0)+(o[1]??0)*(r[1]??0)+(o[2]??0)*(r[2]??0)),1])},je=(r,e,t)=>{let o=!1,i=t.at(-1);if(!i)return!1;for(let n of t){let[a,l]=n,[s,c]=i;l>e!=c>e&&r<(s-a)*(e-l)/(c-l)+a&&(o=!o),i=n}return o},oe=class{#t;#e;#s;#r=null;#n=null;#i=null;#c=null;#a=null;#h=null;#p=null;#f=null;#b=null;#g=null;#w=null;#k=null;#u=null;#l=null;#y=null;#v=null;#M;#o={yaw:-Math.PI/4,pitch:.82,distance:12,targetX:0,targetZ:0,orthographic:!1};#_=12;#m=8;#d=4;#L=new Float32Array(16);#S=null;#x="unavailable";#D=0;#$=0;#I=0;#C=0;#P=1;#A=!1;constructor(e,t,o={}){this.#t=e,this.#e=t,this.#s=o,this.#n=t.getContext("2d",{alpha:!0}),this.#t.addEventListener("webglcontextlost",this.#F),this.#t.addEventListener("webglcontextrestored",this.#V),this.#O(),this.#M=new ResizeObserver(()=>{this.#X(),this.requestRender()}),this.#M.observe(e)}get camera(){return{...this.#o}}setState(e){if(this.#A)return;let t=this.#u;this.#u=e;let o=e.resources.scene.value;o!==this.#l&&(this.#l=o,this.#K(o)),(!t||t.quality!==e.quality)&&(this.#P=ft(e.quality),this.#C=0);let i=t?.workflow!=="draw"&&e.workflow==="draw",n=t?.workflow==="draw"&&e.workflow!=="draw";(!t||t.view!==e.view||i||n)&&(this.#o=this.#q(e.workflow==="draw"?"top":e.view,e)),e.workflow==="draw"&&t?.draw.zoomPercent!==e.draw.zoomPercent&&(this.#o={...this.#o,orthographic:!0,pitch:Math.PI/2-.018,distance:this.#m*100/e.draw.zoomPercent}),this.requestRender()}#q(e,t){let o=e==="top",i=o?this.#m:this.#_,n=t.cameras[e];return n?{yaw:o?0:n.yaw,pitch:o?Math.PI/2-.018:n.pitch,distance:v(i/v(n.zoom,.01,100),Math.max(.2,this.#d*.04),this.#d*8),targetX:v(n.targetX,-this.#d,this.#d),targetZ:v(n.targetZ,-this.#d,this.#d),orthographic:o}:o?{yaw:0,pitch:Math.PI/2-.018,distance:i,targetX:0,targetZ:0,orthographic:!0}:{yaw:-Math.PI/4,pitch:.82,distance:i,targetX:0,targetZ:0,orthographic:!1}}#W(e,t){let o=this.#r;if(!o)throw new Error("webgl-unavailable");let i=o.createShader(e);if(!i)throw new Error("shader-unavailable");if(o.shaderSource(i,t),o.compileShader(i),!o.getShaderParameter(i,o.COMPILE_STATUS))throw o.deleteShader(i),new Error("shader-failed");return i}#O(){try{this.#r=this.#t.getContext("webgl2",{alpha:!0,antialias:!0,depth:!0,powerPreference:"high-performance"});let e=this.#r;if(!e)throw new Error("webgl2-unavailable");let t=this.#W(e.VERTEX_SHADER,`#version 300 es
        precision highp float;
        precision highp int;
        layout(location = 0) in uvec2 aXY;
        layout(location = 1) in uint aHeight;
        layout(location = 2) in vec3 aColor;
        uniform mat4 uViewProjection;
        uniform vec2 uCenter;
        uniform float uMetersPerCell;
        uniform float uPointPixels;
        uniform float uMaxPointPixels;
        out vec3 vColor;
        void main() {
          vec3 world = vec3(
            -(float(aXY.x) - uCenter.x) * uMetersPerCell,
            float(aHeight) * uMetersPerCell,
            (float(aXY.y) - uCenter.y) * uMetersPerCell
          );
          vec4 clip = uViewProjection * vec4(world, 1.0);
          gl_Position = clip;
          gl_PointSize = clamp(uPointPixels / max(0.18, clip.w), 1.1, uMaxPointPixels);
          vColor = aColor;
        }
      `),o=this.#W(e.FRAGMENT_SHADER,`#version 300 es
        precision highp float;
        in vec3 vColor;
        out vec4 outColor;
        void main() {
          vec2 point = gl_PointCoord * 2.0 - 1.0;
          if (dot(point, point) > 1.0) discard;
          float edge = smoothstep(1.0, 0.72, dot(point, point));
          outColor = vec4(pow(vColor, vec3(0.94)), edge);
        }
      `),i=e.createProgram();if(!i)throw new Error("program-unavailable");if(e.attachShader(i,t),e.attachShader(i,o),e.linkProgram(i),e.deleteShader(t),e.deleteShader(o),!e.getProgramParameter(i,e.LINK_STATUS))throw new Error("program-failed");this.#a=i,this.#f=e.getUniformLocation(i,"uViewProjection"),this.#b=e.getUniformLocation(i,"uCenter"),this.#g=e.getUniformLocation(i,"uMetersPerCell"),this.#w=e.getUniformLocation(i,"uPointPixels"),this.#k=e.getUniformLocation(i,"uMaxPointPixels"),this.#h=e.createBuffer(),this.#p=e.createVertexArray(),e.bindVertexArray(this.#p),e.bindBuffer(e.ARRAY_BUFFER,this.#h),e.enableVertexAttribArray(0),e.vertexAttribIPointer(0,2,e.UNSIGNED_SHORT,8,0),e.enableVertexAttribArray(1),e.vertexAttribIPointer(1,1,e.UNSIGNED_BYTE,8,4),e.enableVertexAttribArray(2),e.vertexAttribPointer(2,3,e.UNSIGNED_BYTE,!0,8,5),e.bindVertexArray(null),e.enable(e.DEPTH_TEST),e.depthFunc(e.LEQUAL),e.enable(e.BLEND),e.blendFunc(e.SRC_ALPHA,e.ONE_MINUS_SRC_ALPHA),this.#x="webgl2",this.#D+=1,this.#l&&this.#N(this.#l)}catch{this.#T(),this.#H()}}#K(e){if(this.#B(),!e){this.#$=0,this.requestRender();return}let[t,o]=e.metadata.span,i=e.metadata.metersPerCell,n=t*i,a=o*i;this.#d=Math.max(1,Math.hypot(n,a)/2),this.#_=this.#d*1.72;let l=this.#t.getBoundingClientRect(),s=Math.max(.2,l.width/Math.max(1,l.height));this.#m=Math.max(a/2,n/(2*s))*1.12,this.fit(!1),this.#x==="webgl2"?this.#N(e):this.#U(e)}#N(e){let t=this.#r;if(!t||!this.#h)return;let o=new Uint8Array(e.buffer,e.pointOffset,e.total*8);t.bindBuffer(t.ARRAY_BUFFER,this.#h),t.bufferData(t.ARRAY_BUFFER,o,t.STATIC_DRAW),this.#$=e.total}#H(){this.#x="canvas2d",this.#c=document.createElement("canvas"),this.#c.width=1024,this.#c.height=1024,this.#i=this.#c.getContext("2d",{alpha:!0}),this.#i?this.#l&&this.#U(this.#l):(this.#x="unavailable",this.#s.onProblem?.("renderer-unavailable"))}#U(e){let t=this.#i;if(!t||!this.#c)return;t.clearRect(0,0,this.#c.width,this.#c.height);let o=new DataView(e.buffer,e.pointOffset,e.total*8),i=Math.min(e.total,5e4),n=Math.max(1,Math.ceil(e.total/i)),a=0,l=0,s=()=>{if(this.#A||e!==this.#l||!this.#c)return;let c=Math.min(e.total,a+n*4e3);for(;a<c;a+=n){let d=a*8,h=o.getUint16(d,!0)/Math.max(1,e.metadata.span[0])*this.#c.width,u=o.getUint16(d+2,!0)/Math.max(1,e.metadata.span[1])*this.#c.height,m=o.getUint8(d+5),y=o.getUint8(d+6),Z=o.getUint8(d+7);t.fillStyle=`rgb(${m} ${y} ${Z})`,t.fillRect(h,u,1.5,1.5),l+=1}this.#$=l,this.requestRender(),a<e.total?this.#v=window.setTimeout(s,0):this.#v=null};s()}#B(){this.#v!==null&&window.clearTimeout(this.#v),this.#v=null}#X(){let e=this.#t.getBoundingClientRect(),t=Math.min(window.devicePixelRatio||1,3),o=Math.max(1,Math.round(e.width*t)),i=Math.max(1,Math.round(e.height*t));for(let n of[this.#t,this.#e])(n.width!==o||n.height!==i)&&(n.width=o,n.height=i)}#Z(){let e=this.#t.getBoundingClientRect(),t=Math.max(.2,e.width/Math.max(1,e.height)),o=Math.cos(this.#o.pitch)*this.#o.distance,i=[this.#o.targetX+Math.sin(this.#o.yaw)*o,Math.sin(this.#o.pitch)*this.#o.distance,this.#o.targetZ+Math.cos(this.#o.yaw)*o],n=[this.#o.targetX,0,this.#o.targetZ],a=wt(i,n),l=this.#o.orthographic?vt(-this.#o.distance*t,this.#o.distance*t,-this.#o.distance,this.#o.distance,-this.#d*4,this.#d*4):gt(Math.PI/3.15,t,.02,Math.max(60,this.#d*12));return bt(l,a)}requestRender(){this.#y!==null||this.#A||(this.#y=window.requestAnimationFrame(()=>{this.#y=null,this.#Y()}))}#Y(){let e=performance.now();this.#X(),this.#L=this.#Z(),this.#x==="webgl2"?this.#j():this.#G(),this.#J(),this.#I=performance.now()-e,this.#I>18?(this.#C+=1,this.#C>=3&&this.#u?.quality==="auto"&&(this.#P=Math.max(.25,this.#P*.75))):this.#C=Math.max(0,this.#C-1)}#j(){let e=this.#r,t=this.#l;if(!e||(e.viewport(0,0,this.#t.width,this.#t.height),e.clearColor(0,0,0,0),e.clear(e.COLOR_BUFFER_BIT|e.DEPTH_BUFFER_BIT),!t||!this.#a||!this.#p))return;if(this.#u?.view==="top"&&this.#u.appearance==="rooms"){this.#$=0;return}e.useProgram(this.#a),e.bindVertexArray(this.#p),e.uniformMatrix4fv(this.#f,!1,this.#L),e.uniform2f(this.#b,(t.metadata.span[0]-1)/2,(t.metadata.span[1]-1)/2),e.uniform1f(this.#g,t.metadata.metersPerCell);let o=Math.min(window.devicePixelRatio||1,3),i=Math.max(1,Math.floor(t.total*this.#P)),n=Math.min(t.floorCount,i),a=Math.min(t.surfaceCount,Math.max(0,i-n));e.uniform1f(this.#w,this.#t.height*.038),e.uniform1f(this.#k,4.5*o),e.drawArrays(e.POINTS,0,n),e.uniform1f(this.#w,this.#t.height*.05),e.uniform1f(this.#k,7*o),e.drawArrays(e.POINTS,t.floorCount,a),e.bindVertexArray(null),this.#$=n+a}#G(){}#Q(e,t,o=0){let i=this.#l;return i?[-(e-(i.metadata.span[0]-1)/2)*i.metadata.metersPerCell,o*i.metadata.metersPerCell,(t-(i.metadata.span[1]-1)/2)*i.metadata.metersPerCell]:null}#E(e,t,o=0){let i=this.#Q(e,t,o);if(!i)return null;let[n,a,l]=i,s=this.#L,c=(s[0]??0)*n+(s[4]??0)*a+(s[8]??0)*l+(s[12]??0),d=(s[1]??0)*n+(s[5]??0)*a+(s[9]??0)*l+(s[13]??0),h=(s[3]??0)*n+(s[7]??0)*a+(s[11]??0)*l+(s[15]??0);if(h<=.001)return null;let u=c/h,m=d/h;if(Math.abs(u)>1.15||Math.abs(m)>1.15)return null;let y=this.#e.getBoundingClientRect();return{x:(u*.5+.5)*y.width,y:(-m*.5+.5)*y.height}}#R(e,t,o=0){let i=this.#l;if(!i)return null;let n=e/i.metadata.metersPerCell-i.metadata.origin[0],a=t/i.metadata.metersPerCell-i.metadata.origin[1];return this.#E(n,a,o)}#J(){let e=this.#n,t=this.#l,o=this.#u;if(!e)return;let i=Math.min(window.devicePixelRatio||1,3),n=this.#e.getBoundingClientRect();if(e.setTransform(i,0,0,i,0,0),e.clearRect(0,0,n.width,n.height),!t||!o)return;if(this.#x==="canvas2d"&&this.#c&&!(o.view==="top"&&o.appearance==="rooms")){let c=this.#m/this.#o.distance,d=n.width*c,h=n.height*c,u=(n.width-d)/2-this.#o.targetX*32*c,m=(n.height-h)/2-this.#o.targetZ*32*c;e.drawImage(this.#c,u,m,d,h)}let a=this.#ee(o);if(o.labelsVisible||o.view==="top"&&o.appearance==="rooms"){e.lineWidth=1.5,e.font="600 12px system-ui, sans-serif",e.textAlign="center",e.textBaseline="middle";let c=[];for(let d of t.metadata.rooms){let h=a.has(d.name.toLocaleLowerCase());e.strokeStyle=h?"#0678ce":"rgba(75, 92, 105, .7)",e.fillStyle=h?"rgba(6, 120, 206, .26)":o.view==="top"&&o.appearance==="rooms"?"rgba(231, 238, 242, .94)":"rgba(255, 255, 255, .04)",e.beginPath();let u=Math.max(1,Math.ceil(d.boundary.length/512)),m=!1;for(let k=0;k<d.boundary.length;k+=u){let ie=d.boundary[k];if(!ie)continue;let L=this.#E(ie[0],ie[1],.2);L&&(m?e.lineTo(L.x,L.y):e.moveTo(L.x,L.y),m=!0)}if(m&&(e.closePath(),e.fill(),e.stroke()),!o.labelsVisible)continue;let y=this.#E(d.center[0],d.center[1],1);if(!y)continue;let Z=e.measureText(d.name).width,w=new DOMRect(y.x-Z/2-6,y.y-10,Z+12,20);c.some(k=>w.left<k.right+8&&w.right+8>k.left&&w.top<k.bottom+4&&w.bottom+4>k.top)||(c.push(w),e.fillStyle="rgba(250, 252, 253, .88)",e.fillRect(w.x,w.y,w.width,w.height),e.fillStyle="#263238",e.fillText(d.name,y.x,y.y))}}let l=o.draw.circles;if((o.workflow==="draw"||o.workflow==="areaReview")&&l.length){e.fillStyle="rgba(6, 120, 206, .22)",e.strokeStyle="rgba(6, 120, 206, .92)",e.lineWidth=1.5;for(let c of l)this.#te(e,c)}if(this.#S&&o.workflow==="draw"&&o.draw.tool!=="pan"){let c=this.#R(this.#S.x,this.#S.y),d=this.#R(this.#S.x+o.draw.brushMeters/2,this.#S.y);c&&d&&(e.beginPath(),e.arc(c.x,c.y,Math.max(2,Math.hypot(d.x-c.x,d.y-c.y)),0,Math.PI*2),e.strokeStyle="#0678ce",e.lineWidth=2,e.stroke())}let s=o.resources.pose.value;if(o.map.exactPose&&s?.position&&o.dataMode==="live"){let c=this.#E(s.position[0],s.position[1],3);c&&(e.beginPath(),e.arc(c.x,c.y,7,0,Math.PI*2),e.fillStyle="#0678ce",e.fill(),e.strokeStyle="#fff",e.lineWidth=3,e.stroke())}}#ee(e){let t=e.resources.plans.value?.rooms||e.resources.areas.value?.rooms||[];return new Set(t.filter(o=>e.selection.roomIds.includes(o.roomId)).map(o=>o.name.toLocaleLowerCase()))}#te(e,t){let o=this.#R(t.x,t.y),i=this.#R(t.x+t.radius,t.y);!o||!i||(e.beginPath(),e.arc(o.x,o.y,Math.max(1,Math.hypot(i.x-o.x,i.y-o.y)),0,Math.PI*2),e.fill(),e.stroke())}setCursor(e){this.#S=e,this.requestRender()}screenToMap(e,t){let o=this.#l;if(!o||!this.#o.orthographic)return null;let i=this.#t.getBoundingClientRect();if(!i.width||!i.height)return null;let n=this.#o.distance*2/i.height,a=this.#o.targetX+(e-i.left-i.width/2)*n,l=this.#o.targetZ+(t-i.top-i.height/2)*n,s=-a/o.metadata.metersPerCell+(o.metadata.span[0]-1)/2,c=l/o.metadata.metersPerCell+(o.metadata.span[1]-1)/2;return{x:(s+o.metadata.origin[0])*o.metadata.metersPerCell,y:(c+o.metadata.origin[1])*o.metadata.metersPerCell}}roomAt(e,t){let o=this.screenToMap(e,t),i=this.#l,n=this.#u;if(!o||!i||!n)return null;let a=o.x/i.metadata.metersPerCell-i.metadata.origin[0],l=o.y/i.metadata.metersPerCell-i.metadata.origin[1],s=i.metadata.rooms.find(c=>je(a,l,c.boundary));return s?this.#re(s,n):null}containsMapPoint(e){let t=this.#l;if(!t)return!1;let o=e.x/t.metadata.metersPerCell-t.metadata.origin[0],i=e.y/t.metadata.metersPerCell-t.metadata.origin[1];return t.metadata.rooms.some(n=>je(o,i,n.boundary))}#re(e,t){return(t.resources.plans.value?.rooms||t.resources.areas.value?.rooms||[]).find(i=>i.name.localeCompare(e.name,void 0,{sensitivity:"base"})===0)?.roomId||e.id}selectRoomAt(e,t){let o=this.roomAt(e,t);o&&this.#s.onRoom?.(o)}fit(e=!0){let t=this.#u?.view==="top"||this.#u?.workflow==="draw";this.#o=t?{yaw:0,pitch:Math.PI/2-.018,distance:this.#m,targetX:0,targetZ:0,orthographic:!0}:{yaw:-Math.PI/4,pitch:.82,distance:this.#_,targetX:0,targetZ:0,orthographic:!1},this.requestRender(),e&&this.#z()}zoomAt(e,t,o){let i=t===void 0||o===void 0?null:this.screenToMap(t,o);if(this.#o={...this.#o,distance:v(this.#o.distance/e,Math.max(.2,this.#d*.04),this.#d*8)},i&&t!==void 0&&o!==void 0){let n=this.screenToMap(t,o);n&&(this.#o={...this.#o,targetX:this.#o.targetX-(i.x-n.x),targetZ:this.#o.targetZ+(i.y-n.y)})}this.requestRender(),this.#z(t,o)}panBy(e,t){let o=this.#t.getBoundingClientRect(),i=this.#o.distance*2/Math.max(1,o.height),n=Math.cos(this.#o.yaw),a=-Math.sin(this.#o.yaw),l=-Math.sin(this.#o.yaw),s=-Math.cos(this.#o.yaw);this.#o={...this.#o,targetX:v(this.#o.targetX-e*i*n+t*i*l,-this.#d,this.#d),targetZ:v(this.#o.targetZ-e*i*a+t*i*s,-this.#d,this.#d)},this.requestRender(),this.#z()}orbitBy(e,t){if(this.#o.orthographic){this.panBy(e,t);return}this.#o={...this.#o,yaw:yt(this.#o.yaw+e*.006),pitch:v(this.#o.pitch-t*.004,.18,1.38)},this.requestRender(),this.#z()}#z(e,t){let o=this.#o.orthographic?this.#m:this.#_,i=this.#t.getBoundingClientRect(),n=e===void 0||t===void 0||!i.width||!i.height?void 0:{xPercent:v((e-i.left)/i.width*100,0,100),yPercent:v((t-i.top)/i.height*100,0,100)};this.#s.onCamera?.(this.camera,Math.round(o/this.#o.distance*100),n)}diagnostics(){return{mode:this.#x,contextGeneration:this.#D,sceneRevision:this.#l?.revision??null,sourcePoints:this.#l?.total??0,renderedPoints:this.#$,lastFrameMs:Math.round(this.#I*100)/100,slowFrames:this.#C}}#F=e=>{e.preventDefault(),this.#T(),this.#H(),this.requestRender()};#V=()=>{this.#T(),this.#O(),this.requestRender()};#T(){let e=this.#r;e&&(this.#h&&e.deleteBuffer(this.#h),this.#p&&e.deleteVertexArray(this.#p),this.#a&&e.deleteProgram(this.#a)),this.#h=null,this.#p=null,this.#a=null,this.#r=null}dispose(){this.#A||(this.#A=!0,this.#M.disconnect(),this.#t.removeEventListener("webglcontextlost",this.#F),this.#t.removeEventListener("webglcontextrestored",this.#V),this.#y!==null&&window.cancelAnimationFrame(this.#y),this.#y=null,this.#B(),this.#T(),this.#c=null,this.#i=null,this.#n=null,this.#l=null,this.#u=null)}};var _e="matic-workspace-intent",_t="matic-workspace-action",Ge=(r,e)=>{let t=(i,n,a)=>K(e,i,n,a);if(!O(r))return t("v4_private_map_unavailable","The current private map is not available.");if(r.dataMode==="history")return t("v4_saved_map_description","Saved read-only map for {floor}. Live robot position is hidden.",{floor:r.floor.displayName});let o=$e(r)?t("v4_robot_position_verified","The robot position is verified."):t("v4_robot_position_hidden","The robot position is not shown.");return t("v4_live_map_description","Live map for {floor}. {pose}",{floor:r.floor.displayName,pose:o})},we=class extends g{constructor(){super(...arguments);this.state=W();this.#t=null;this.#e=null;this.#s=null}static{this.properties={state:{attribute:!1},localize:{attribute:!1}}}static{this.styles=H`
    :host {
      display: block;
      min-width: 0;
      min-height: 0;
      block-size: 100%;
      color: var(--primary-text-color, #1f2933);
    }

    * { box-sizing: border-box; }

    button, input { font: inherit; }

    .map-root {
      position: relative;
      overflow: hidden;
      min-block-size: 22rem;
      block-size: 100%;
      outline: none;
      isolation: isolate;
      background:
        radial-gradient(circle at 52% 45%, rgb(255 255 255 / 92%), transparent 42%),
        var(--secondary-background-color, #edf2f4);
      touch-action: none;
      container-type: inline-size;
    }

    .map-root:focus-visible {
      outline: 3px solid var(--primary-color, #03a9f4);
      outline-offset: -3px;
    }

    .floor-chip,
    .map-tools,
    .view-switch,
    .appearance-switch,
    .camera-steps,
    .draw-tools,
    .map-scale,
    .map-message {
      position: absolute;
      z-index: 4;
      border: 1px solid var(--divider-color, rgb(60 75 85 / 16%));
      background: var(--card-background-color, rgb(255 255 255 / 96%));
      box-shadow: 0 5px 18px rgb(31 41 51 / 12%);
    }

    .floor-chip {
      inset-block-start: 0.75rem;
      inset-inline-start: 0.75rem;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      max-inline-size: min(15rem, calc(100% - 11rem));
      min-block-size: 2.75rem;
      padding-inline: 0.8rem;
      border-radius: 1.5rem;
      font-size: 0.82rem;
      font-weight: 650;
    }

    .floor-chip span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .floor-chip small {
      color: var(--secondary-text-color, #687984);
      font-weight: 500;
      white-space: nowrap;
    }

    .map-tools {
      inset-block-start: 0.75rem;
      inset-inline-end: 0.75rem;
      display: flex;
      gap: 0.2rem;
      padding: 0.2rem;
      border-radius: 0.85rem;
    }

    .map-tools button,
    .view-switch button,
    .appearance-switch button,
    .camera-steps button,
    .draw-tools button {
      border: 0;
      color: inherit;
      background: transparent;
      cursor: pointer;
    }

    .map-tools button {
      min-inline-size: 2.75rem;
      min-block-size: 2.75rem;
      padding-inline: 0.55rem;
      border-radius: 0.65rem;
      font-size: 0.78rem;
      font-weight: 650;
    }

    .map-tools button[aria-pressed="true"],
    .view-switch button[aria-pressed="true"],
    .appearance-switch button[aria-pressed="true"],
    .draw-tools button[aria-checked="true"] {
      color: var(--primary-color, #0678ce);
      background: color-mix(in srgb, var(--primary-color, #0678ce) 11%, transparent);
    }

    .view-switch {
      inset-block-start: 4.25rem;
      inset-inline-end: 0.75rem;
      display: grid;
      grid-template-columns: 1fr 1fr;
      padding: 0.18rem;
      border-radius: 0.75rem;
    }

    .appearance-switch,
    .camera-steps {
      position: absolute;
      z-index: 4;
      inset-block-start: 7.2rem;
      inset-inline-end: 0.75rem;
      display: grid;
      padding: 0.18rem;
      border: 1px solid var(--divider-color, rgb(60 75 85 / 16%));
      border-radius: 0.75rem;
      background: var(--card-background-color, rgb(255 255 255 / 96%));
      box-shadow: 0 5px 18px rgb(31 41 51 / 12%);
    }

    .appearance-switch { grid-template-columns: 1fr 1fr; }
    .camera-steps { grid-template-columns: repeat(2, 2.75rem); }

    .appearance-switch button,
    .camera-steps button {
      min-inline-size: 2.75rem;
      min-block-size: 2.75rem;
      border: 0;
      border-radius: 0.58rem;
      color: inherit;
      background: transparent;
      cursor: pointer;
      font-size: 0.76rem;
      font-weight: 700;
    }

    .view-switch button {
      min-inline-size: 2.75rem;
      min-block-size: 2.25rem;
      border-radius: 0.58rem;
      font-size: 0.76rem;
      font-weight: 700;
    }

    .scene-window {
      position: absolute;
      inset: 0;
      overflow: hidden;
    }

    .scene-window[hidden] { display: none; }

    .scene-canvas,
    .overlay-canvas {
      position: absolute;
      inset: 0;
      inline-size: 100%;
      block-size: 100%;
    }

    .scene-canvas { z-index: 0; }
    .overlay-canvas { z-index: 1; pointer-events: none; }

    .scene-geometry {
      position: absolute;
      inset: 12% 8% 17%;
      transform: scale(var(--map-zoom));
      transform-origin: var(--map-origin-x) var(--map-origin-y);
      transition: transform 120ms ease-out;
    }

    .scene-geometry svg { inline-size: 100%; block-size: 100%; overflow: visible; }
    .room { stroke: var(--divider-color, #b5c1c8); stroke-width: 1.5; }
    .room:nth-child(1) { fill: #dceef2; }
    .room:nth-child(2) { fill: #e4eaf5; }
    .room:nth-child(3) { fill: #e9f0df; }
    .room:nth-child(4) { fill: #f3e5e5; }

    .area-stroke {
      fill: none;
      stroke: var(--primary-color, #0678ce);
      stroke-width: 2.4;
      stroke-linecap: round;
      stroke-linejoin: round;
      opacity: 0.82;
    }

    .room-labels {
      position: absolute;
      inset: 0;
      z-index: 2;
      pointer-events: none;
    }

    .room-label {
      position: absolute;
      translate: -50% -50%;
      padding: 0.25rem 0.45rem;
      border-radius: 0.4rem;
      color: var(--primary-text-color, #263238);
      background: color-mix(in srgb, var(--card-background-color, white) 90%, transparent);
      box-shadow: 0 2px 8px rgb(31 41 51 / 11%);
      font-size: 0.72rem;
      font-weight: 650;
      white-space: nowrap;
    }

    .room-label:nth-child(1) { inset-inline-start: 31%; inset-block-start: 36%; }
    .room-label:nth-child(2) { inset-inline-start: 69%; inset-block-start: 39%; }
    .room-label:nth-child(3) { inset-inline-start: 36%; inset-block-start: 68%; }
    .room-label:nth-child(4) { inset-inline-start: 68%; inset-block-start: 68%; }

    .robot {
      position: absolute;
      z-index: 3;
      inset-inline-start: 53%;
      inset-block-start: 52%;
      inline-size: 1.15rem;
      block-size: 1.15rem;
      translate: -50% -50%;
      border: 3px solid white;
      border-radius: 50%;
      background: var(--primary-color, #0678ce);
      box-shadow: 0 2px 9px rgb(6 120 206 / 35%);
    }

    .brush-cursor {
      position: absolute;
      z-index: 3;
      inset-inline-start: 52%;
      inset-block-start: 49%;
      inline-size: var(--brush-size);
      block-size: var(--brush-size);
      translate: -50% -50%;
      border: 2px solid var(--primary-color, #0678ce);
      border-radius: 50%;
      background: color-mix(in srgb, var(--primary-color, #0678ce) 15%, transparent);
      pointer-events: none;
    }

    .map-scale {
      inset-inline-start: 0.9rem;
      inset-block-end: calc(5.2rem + var(--map-sheet-offset, 0px));
      display: grid;
      justify-items: start;
      gap: 0.25rem;
      border: 0;
      background: transparent;
      box-shadow: none;
      color: var(--secondary-text-color, #53636d);
      font-size: 0.7rem;
      font-weight: 650;
    }

    .scale-line {
      inline-size: var(--scale-width);
      block-size: 0.42rem;
      border-inline: 2px solid currentColor;
      border-block-end: 2px solid currentColor;
    }

    .draw-tools {
      inset-inline-start: 50%;
      inset-block-end: calc(0.75rem + var(--map-sheet-offset, 0px));
      translate: -50% 0;
      display: grid;
      grid-template-columns: repeat(6, minmax(2.75rem, auto));
      gap: 0.15rem;
      max-inline-size: calc(100% - 1rem);
      padding: 0.2rem;
      border-radius: 0.9rem;
    }

    .draw-tools button {
      min-inline-size: 2.75rem;
      min-block-size: 2.75rem;
      padding-inline: 0.5rem;
      border-radius: 0.65rem;
      font-size: 0.73rem;
      font-weight: 650;
      white-space: nowrap;
    }

    .draw-tools button:disabled { opacity: 0.42; cursor: default; }

    .map-root[data-full-map="true"] .draw-tools { inset-block-end: 5.75rem; }
    .map-root[data-full-map="true"] .map-scale { inset-block-end: 10rem; }

    .map-message {
      inset: 50% auto auto 50%;
      translate: -50% -50%;
      inline-size: min(22rem, calc(100% - 2rem));
      padding: 1rem 1.1rem;
      border-radius: 0.9rem;
      text-align: center;
    }

    .map-message strong { display: block; margin-block-end: 0.35rem; }
    .map-message span { color: var(--secondary-text-color, #687984); font-size: 0.82rem; }

    .sr-only {
      position: absolute;
      overflow: hidden;
      inline-size: 1px;
      block-size: 1px;
      margin: -1px;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }

    @container (max-width: 29rem) {
      .map-tools .labels { display: none; }
      .map-tools button { padding-inline: 0.35rem; }
      .draw-tools { grid-template-columns: repeat(6, 2.75rem); }
      .draw-tools button { padding: 0; font-size: 0; }
      .draw-tools button::first-letter { font-size: 1rem; }
      .floor-chip { max-inline-size: calc(100% - 9.5rem); }
    }

    @media (prefers-reduced-motion: reduce) {
      .scene-geometry { transition: none; }
    }

    @media (forced-colors: active) {
      .room, .area-stroke, .brush-cursor, .robot { forced-color-adjust: none; }
      .room { fill: Canvas; stroke: CanvasText; }
      .area-stroke, .brush-cursor { stroke: Highlight; }
      .robot { background: Highlight; border-color: Canvas; }
    }
  `}#t;#e;#s;#r(t,o,i){return K(this.localize,t,o,i)}firstUpdated(){let t=this.renderRoot.querySelector(".map-root"),o=this.renderRoot.querySelector(".scene-canvas"),i=this.renderRoot.querySelector(".overlay-canvas");!t||!o||!i||(this.#e=new oe(o,i,{onCamera:(n,a,l)=>{this.#n({type:"set-camera",view:this.state.workflow==="draw"?"top":this.state.view,camera:{yaw:n.yaw,pitch:n.pitch,zoom:a/100,targetX:n.targetX,targetZ:n.targetZ}}),this.state.workflow==="draw"&&a!==this.state.draw.zoomPercent&&this.#n({type:"set-zoom",value:a,...l?{originX:l.xPercent,originY:l.yPercent}:{}})},onRoom:n=>this.#n({type:"toggle-room",roomId:n}),onProblem:()=>this.#i("renderer-problem")}),this.#s=new re(t,this.#e,{state:()=>this.state,onCircles:(n,a,l)=>this.#n({type:"set-draft-circles",circles:n,record:a,...l?{previous:l}:{}}),onRoom:n=>this.#n({type:"toggle-room",roomId:n})}),this.#e.setState(this.state))}disconnectedCallback(){this.#s?.dispose(),this.#s=null,this.#e?.dispose(),this.#e=null,super.disconnectedCallback()}updated(t){if(!t.has("state"))return;t.get("state")?.fullMap&&!this.state.fullMap&&this.#t&&this.#t.focus(),this.#e?.setState(this.state)}#n(t){this.dispatchEvent(new CustomEvent(_e,{detail:t,bubbles:!0,composed:!0}))}#i(t){this.dispatchEvent(new CustomEvent(_t,{detail:{id:t},bubbles:!0,composed:!0}))}#c(t){this.#t=t.currentTarget,this.#n({type:this.state.fullMap?"exit-full-map":"enter-full-map"})}#a(t,o){this.#e?.orbitBy(t,o)}#h(t){if(!(t.ctrlKey||t.metaKey||t.altKey)&&t.key==="Escape"){t.preventDefault(),this.#n({type:"dismiss-top-layer"});return}}rendererDiagnostics(){return this.#e?.diagnostics()??null}canvasIdentity(){return{scene:this.renderRoot.querySelector(".scene-canvas"),overlay:this.renderRoot.querySelector(".overlay-canvas")}}#p(){return this.state.host.connected?this.state.host.administrator?this.state.host.robotCount===0?{title:this.#r("v4_no_robot","No Matic robot set up"),detail:this.#r("v4_no_robot_detail","Set up a robot before opening its map.")}:this.state.host.robotConnected?this.state.coherence==="verifying"||this.state.coherence==="booting"?{title:this.#r("v4_locating_map","Locating the current map"),detail:this.#r("v4_locating_map_detail","Map controls will return after the floor is verified.")}:!this.state.map.available&&this.state.resources.scene.status==="loading"?{title:this.#r("v4_loading_verified_map","Loading the verified map"),detail:this.#r("v4_loading_verified_map_detail","The current floor is verified. The private scene is still preparing.")}:this.state.map.available?this.state.activity==="problem"?{title:this.#r("v4_robot_attention","Robot needs attention"),detail:this.#r("v4_robot_attention_detail","Check the robot before starting another task.")}:null:{title:this.#r("v4_map_unavailable","Map unavailable"),detail:this.#r("v4_map_unavailable_detail","The private scene is not ready. No map data is shown until it is verified.")}:{title:this.#r("v4_robot_offline","Robot offline"),detail:this.#r("v4_robot_offline_detail","The last verified map stays read only and has no live position.")}:{title:this.#r("v4_admin_required","Administrator access required"),detail:this.#r("v4_private_map_hidden","Private map data is hidden.")}:{title:this.#r("v4_reconnecting","Reconnecting"),detail:this.#r("v4_reconnecting_detail","The verified map is read only until Home Assistant reconnects.")}}render(){let t=this.state,o=Ce(t),i=this.#p(),n=t.map.available&&(O(t)||t.dataMode==="history"),a=t.workflow==="draw"&&n,l=t.coherence==="verifying"||t.coherence==="booting";return f`
      <section
        class="map-root"
        tabindex="0"
        role="application"
        aria-label=${Ge(t,this.localize)}
        data-full-map=${String(t.fullMap)}
        data-workflow=${t.workflow}
        @keydown=${this.#h}
      >
        ${t.floor.classifiedCount>1?f`
          <button
            class="floor-chip"
            type="button"
            aria-label=${this.#r("v4_choose_floor","Choose floor")}
            @click=${()=>this.#n({type:"open-workflow",workflow:"history"})}
          >
            <span>${t.floor.displayName}</span>
            ${t.floor.readOnly?f`<small>${this.#r("v4_saved_read_only","Saved \xB7 read only")}</small>`:p}
          </button>
        `:p}

        ${!l||t.fullMap?f`<nav class="map-tools" aria-label="Map tools">
          ${l?p:f`
            <button type="button" @click=${()=>{this.#e?.fit(),this.#n({type:"fit-map"})}}>${this.#r("map_home_view","Fit")}</button>
            <button
              class="labels"
              type="button"
              aria-pressed=${String(t.labelsVisible)}
              @click=${()=>this.#n({type:"toggle-labels"})}
            >${this.#r("map_labels","Labels")}</button>
          `}
          <button
            class="full-map"
            type="button"
            aria-label=${this.#r("v4_full_map","Full map")}
            aria-pressed=${String(t.fullMap)}
            @click=${this.#c}
          >${t.fullMap?this.#r("v4_close","Close"):this.#r("v4_full_map","Full map")}</button>
        </nav>`:p}

        ${t.workflow!=="draw"&&n?f`
          <div class="view-switch" aria-label="Map view">
            <button
              type="button"
              aria-pressed=${String(t.view==="three")}
              @click=${()=>this.#n({type:"set-view",view:"three"})}
            >${this.#r("map_view_3d","3D")}</button>
            <button
              type="button"
              aria-pressed=${String(t.view==="top")}
              @click=${()=>this.#n({type:"set-view",view:"top"})}
            >${this.#r("map_view_top","2D")}</button>
          </div>
        `:p}

        ${t.view==="top"&&n?f`
          <div class="appearance-switch" aria-label=${this.#r("map_style_label","2D map style")}>
            <button
              type="button"
              aria-pressed=${String(t.appearance==="photo")}
              @click=${()=>this.#n({type:"set-appearance",appearance:"photo"})}
            >${this.#r("map_style_photo","Photo")}</button>
            <button
              type="button"
              aria-pressed=${String(t.appearance==="rooms")}
              @click=${()=>this.#n({type:"set-appearance",appearance:"rooms"})}
            >${this.#r("map_view_rooms","Rooms")}</button>
          </div>
        `:p}

        ${t.view==="three"&&n?f`
          <div class="camera-steps" role="toolbar" aria-label=${this.#r("map_camera_controls","Map camera controls")}>
            <button type="button" aria-label=${this.#r("map_rotate_left","Rotate left")} aria-keyshortcuts="[" @click=${()=>this.#a(-52,0)}>↶</button>
            <button type="button" aria-label=${this.#r("map_tilt_down","Lower viewing angle")} aria-keyshortcuts="PageDown" @click=${()=>this.#a(0,30)}>⌄</button>
            <button type="button" aria-label=${this.#r("map_tilt_up","Raise viewing angle")} aria-keyshortcuts="PageUp" @click=${()=>this.#a(0,-30)}>⌃</button>
            <button type="button" aria-label=${this.#r("map_rotate_right","Rotate right")} aria-keyshortcuts="]" @click=${()=>this.#a(52,0)}>↷</button>
          </div>
        `:p}

        <div
          class="scene-window"
          data-renderer-key="persistent-canvas-v4"
          ?hidden=${!n}
          aria-hidden="true"
        >
          <canvas class="scene-canvas"></canvas>
          <canvas class="overlay-canvas"></canvas>
        </div>

        ${a?f`
          <div class="map-scale" aria-label=${`Scale ${o.label}`}>
            <span class="scale-line" style=${`--scale-width:${o.pixels}px`}></span>
            <span>${o.label}</span>
          </div>
          <div class="draw-tools" role="toolbar" aria-label="Draw area tools">
            ${["paint","erase","pan"].map(s=>f`
              <button
                type="button"
                role="radio"
                aria-checked=${String(t.draw.tool===s)}
                data-tool=${s}
                @click=${()=>this.#n({type:"set-draw-tool",tool:s})}
              >${s==="paint"?`\u270E ${this.#r("area_paint","Paint")}`:s==="erase"?`\u232B ${this.#r("area_erase","Erase")}`:`\u2725 ${this.#r("move_map","Move map")}`}</button>
            `)}
            <button
              type="button"
              ?disabled=${t.draw.strokeCount===0}
              @click=${()=>this.#n({type:"undo-draft"})}
            >↶ ${this.#r("undo","Undo")}</button>
            <button
              type="button"
              ?disabled=${t.draw.redo.length===0}
              @click=${()=>this.#n({type:"redo-draft"})}
            >↷ ${this.#r("redo","Redo")}</button>
            <button type="button" @click=${()=>this.#i("review-area")}>✓ ${this.#r("done_editing","Done editing")}</button>
          </div>
        `:p}

        ${i&&!(t.fullMap&&(l||!t.host.administrator))?f`
          <div class="map-message" role="status">
            <strong>${i.title}</strong>
            <span>${i.detail}</span>
          </div>
        `:p}
        <div class="sr-only" aria-live="polite" aria-atomic="true">
          ${Ge(t,this.localize)}
        </div>
      </section>
    `}};customElements.get("matic-map-canvas-v4")||customElements.define("matic-map-canvas-v4",we);var xe=class extends g{constructor(){super(...arguments);this.state=W();this.compact=!1}static{this.properties={state:{attribute:!1},localize:{attribute:!1},compact:{type:Boolean,reflect:!0}}}static{this.styles=H`
    :host { display: block; color: var(--primary-text-color, #1f2933); }
    * { box-sizing: border-box; }
    button, input { font: inherit; }

    .controls {
      display: grid;
      gap: 0.8rem;
      padding: 0.9rem;
      border: 1px solid var(--divider-color, rgb(60 75 85 / 16%));
      border-radius: 0.85rem;
      background: var(--card-background-color, #fff);
    }

    .row { display: grid; gap: 0.42rem; }
    label { color: var(--secondary-text-color, #687984); font-size: 0.75rem; font-weight: 650; }

    .stepper {
      display: grid;
      grid-template-columns: 2.75rem minmax(0, 1fr) 2.75rem;
      gap: 0.35rem;
      align-items: stretch;
    }

    button, .number {
      min-block-size: 2.75rem;
      border: 1px solid var(--divider-color, rgb(60 75 85 / 20%));
      border-radius: 0.65rem;
      color: inherit;
      background: var(--secondary-background-color, #f3f6f7);
    }

    button { cursor: pointer; font-weight: 700; }
    button:hover { background: color-mix(in srgb, var(--primary-color, #0678ce) 9%, transparent); }

    .number {
      display: flex;
      align-items: center;
      min-inline-size: 0;
      padding-inline: 0.6rem;
      background: var(--card-background-color, #fff);
    }

    input {
      min-inline-size: 0;
      inline-size: 100%;
      border: 0;
      outline: 0;
      color: inherit;
      background: transparent;
      text-align: end;
      font-variant-numeric: tabular-nums;
    }

    .unit { margin-inline-start: 0.25rem; color: var(--secondary-text-color, #687984); font-size: 0.75rem; }
    .hint { margin: 0; color: var(--secondary-text-color, #687984); font-size: 0.72rem; line-height: 1.45; }

    :host([compact]) .controls {
      position: absolute;
      z-index: 8;
      inset-block-start: calc(100% + 0.4rem);
      inset-inline-end: 0;
      inline-size: min(18rem, calc(100vw - 1.5rem));
      box-shadow: 0 12px 32px rgb(31 41 51 / 20%);
    }

    @media (forced-colors: active) {
      button, .number, .controls { border-color: CanvasText; }
    }
  `}#t(t,o){return K(this.localize,t,o)}#e(t){this.dispatchEvent(new CustomEvent(_e,{detail:t,bubbles:!0,composed:!0}))}#s(t,o){let i=t.currentTarget.valueAsNumber;Number.isFinite(i)&&this.#e(o==="zoom"?{type:"set-zoom",value:i}:{type:"set-brush",value:i})}render(){let{draw:t}=this.state;return f`
      <div class="controls" aria-label=${this.#t("v4_drawing_precision","Drawing precision")}>
        <div class="row">
          <label for="zoom">${this.#t("v4_map_zoom","Map zoom")}</label>
          <div class="stepper">
            <button
              type="button"
              aria-label=${this.#t("zoom_out","Zoom out")}
              @click=${()=>this.#e({type:"step-zoom",factor:.8})}
            >−</button>
            <span class="number">
              <input
                id="zoom"
                inputmode="numeric"
                type="number"
                min=${100}
                max=${1e3}
                step="1"
                .value=${String(t.zoomPercent)}
                @change=${o=>this.#s(o,"zoom")}
                aria-label=${this.#t("v4_map_zoom_percent","Map zoom percent")}
              />
              <span class="unit">%</span>
            </span>
            <button
              type="button"
              aria-label=${this.#t("zoom_in","Zoom in")}
              @click=${()=>this.#e({type:"step-zoom",factor:1.25})}
            >+</button>
          </div>
        </div>

        <div class="row">
          <label for="brush">${this.#t("brush_size","Brush width")}</label>
          <div class="stepper">
            <button
              type="button"
              aria-label=${this.#t("v4_narrower_brush","Narrower brush")}
              @click=${()=>this.#e({type:"set-brush",value:t.brushMeters/1.25})}
            >−</button>
            <span class="number">
              <input
                id="brush"
                inputmode="decimal"
                type="number"
                min=${.2}
                max=${2.5}
                step="0.01"
                .value=${t.brushMeters.toFixed(2)}
                @change=${o=>this.#s(o,"brush")}
                aria-label=${this.#t("v4_brush_width_meters","Brush width in meters")}
              />
              <span class="unit">m</span>
            </span>
            <button
              type="button"
              aria-label=${this.#t("v4_wider_brush","Wider brush")}
              @click=${()=>this.#e({type:"set-brush",value:t.brushMeters*1.25})}
            >+</button>
          </div>
        </div>
        <p class="hint">${this.#t("v4_precision_hint","Strokes follow the verified map resolution. Zoom changes the view, not the saved outline.")}</p>
      </div>
    `}};customElements.get("matic-precision-controls-v4")||customElements.define("matic-precision-controls-v4",xe);export{S as a,Y as b,I as c,j as d,ne as e,xt as f,ke as g,Je as h,W as i,et as j,Me as k,Se as l,O as m,$e as n,G as o,R as p,St as q,$t as r,Ct as s,Ce as t,At as u,H as v,f as w,p as x,g as y,K as z,_e as A,_t as B};
/*! Bundled license information:

@lit/reactive-element/css-tag.js:
  (**
   * @license
   * Copyright 2019 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

@lit/reactive-element/reactive-element.js:
lit-html/lit-html.js:
lit-element/lit-element.js:
  (**
   * @license
   * Copyright 2017 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

lit-html/is-server.js:
  (**
   * @license
   * Copyright 2022 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/
