var C=100,K=1e3,L=.2,Y=2.5,oe=64,wt=r=>!r||typeof r!="object"?!1:typeof r.type=="string";var E=()=>({status:"idle",value:null,problem:null}),x=(r,e,t)=>Math.max(e,Math.min(t,r)),Ze=r=>({yaw:x(Number.isFinite(r.yaw)?r.yaw:0,-Math.PI,Math.PI),pitch:x(Number.isFinite(r.pitch)?r.pitch:Math.PI/2-.018,.18,Math.PI/2-.018),zoom:x(Number.isFinite(r.zoom)?r.zoom:1,.01,100),targetX:x(Number.isFinite(r.targetX)?r.targetX:0,-1e4,1e4),targetZ:x(Number.isFinite(r.targetZ)?r.targetZ:0,-1e4,1e4)}),xe=r=>Math.round(x(Number.isFinite(r)?r:100,100,1e3)),je=r=>Math.round(x(Number.isFinite(r)?r:.2,.2,2.5)*100)/100,Ge=()=>({generation:0,coherence:"verifying",dataMode:"live",activity:"unknown",workflow:"none",command:"idle",fullMap:!1,precisionOpen:!1,dialog:null,narrowHint:!1,view:"top",labelsVisible:!0,quality:"auto",cameras:{},managedLock:!1,batteryPercent:null,floor:{classifiedCount:1,displayName:"Current floor",readOnly:!1},map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1},host:{connected:!0,administrator:!0,robotConnected:!1,robotCount:0},draw:{zoomPercent:100,zoomOriginX:50,zoomOriginY:50,brushMeters:.6,tool:"paint",dirty:!1,strokeCount:0,circles:[],undo:[],redo:[]},resources:{catalog:E(),entry:null,scene:E(),pose:E(),history:E(),plans:E(),areas:E()},selection:{entryId:null,floorId:"current",historyId:null,roomIds:[],cleaningMode:"vacuum",coverageSetting:"standard",planId:null,areaId:null},planDraft:{id:null,name:"",enabled:!0,runBehavior:"intelligent",rooms:[],returnToBase:!0,finishCurrentRoom:!1,finishCurrentRoomThreshold:50,dirty:!1},areaDraft:{id:null,name:"",cleaningMode:"vacuum",coverageSetting:"standard",status:"new",canRebind:!1,dirty:!1},notice:null,robotLabel:"Matic robot",locale:"en"}),b=(r,e)=>({...r,draw:{...r.draw,...e}}),Qe=(r,e)=>{switch(e.type){case"set-host":return{...r,host:e.host,fullMap:e.host.administrator&&e.host.robotCount>0?r.fullMap:!1};case"set-operational-state":return{...r,coherence:e.coherence,activity:e.activity,command:e.command??r.command};case"set-narrow-hint":return{...r,narrowHint:e.value};case"set-view":return{...r,view:e.view};case"set-quality":return{...r,quality:e.quality};case"set-camera":return{...r,cameras:{...r.cameras,[e.view]:Ze(e.camera)}};case"toggle-labels":return{...r,labelsVisible:!r.labelsVisible};case"open-workflow":return{...r,workflow:e.workflow,precisionOpen:!1};case"enter-full-map":return r.host.administrator&&r.host.robotCount>0&&r.map.available?{...r,fullMap:!0}:r;case"exit-full-map":return{...r,fullMap:!1,precisionOpen:!1};case"set-precision-open":return{...r,precisionOpen:e.value};case"set-zoom":return b(r,{zoomPercent:xe(e.value),...e.originX===void 0?{}:{zoomOriginX:x(e.originX,0,100)},...e.originY===void 0?{}:{zoomOriginY:x(e.originY,0,100)}});case"step-zoom":return b(r,{zoomPercent:xe(r.draw.zoomPercent*e.factor)});case"fit-map":return b(r,{zoomPercent:100,zoomOriginX:50,zoomOriginY:50});case"set-brush":return b(r,{brushMeters:je(e.value)});case"set-draw-tool":return b(r,{tool:e.tool});case"mark-draft":{let t=Math.max(0,r.draw.strokeCount+e.strokeDelta);return b(r,{dirty:t>0,strokeCount:t})}case"undo-draft":{let t=r.draw.undo.at(-1);return t?b(r,{circles:t,undo:r.draw.undo.slice(0,-1),redo:[...r.draw.redo,r.draw.circles],dirty:!0,strokeCount:Math.max(0,r.draw.strokeCount-1)}):r}case"redo-draft":{let t=r.draw.redo.at(-1);return t?b(r,{circles:t,undo:[...r.draw.undo,r.draw.circles],redo:r.draw.redo.slice(0,-1),dirty:!0,strokeCount:r.draw.strokeCount+1}):r}case"set-draft-circles":{let t=e.circles.slice(0,512).map(n=>({...n})),o=e.record!==!1;return b(r,{circles:t,undo:o?[...r.draw.undo.slice(-99),e.previous??r.draw.circles]:r.draw.undo,redo:o?[]:r.draw.redo,dirty:!0,strokeCount:o?r.draw.strokeCount+1:r.draw.strokeCount})}case"discard-draft":return{...b(r,{dirty:!1,strokeCount:0,circles:[],undo:[],redo:[]}),dialog:null,workflow:"none",precisionOpen:!1};case"toggle-room":{let t=r.selection.roomIds.includes(e.roomId);return{...r,selection:{...r.selection,roomIds:t?r.selection.roomIds.filter(o=>o!==e.roomId):[...r.selection.roomIds,e.roomId]}}}case"patch-room-settings":return{...r,selection:{...r.selection,...e.cleaningMode?{cleaningMode:e.cleaningMode}:{},...e.coverageSetting?{coverageSetting:e.coverageSetting}:{}}};case"set-floor":return{...r,dataMode:e.floorId==="current"?"live":"history",selection:{...r.selection,floorId:e.floorId,historyId:null}};case"set-history":return{...r,dataMode:e.historyId?"history":"live",selection:{...r.selection,historyId:e.historyId}};case"select-plan":return{...r,selection:{...r.selection,planId:e.planId}};case"select-area":return{...r,selection:{...r.selection,areaId:e.areaId}};case"patch-plan-draft":return{...r,planDraft:{...r.planDraft,...e.patch,dirty:e.patch.dirty??!0}};case"patch-area-draft":return{...r,areaDraft:{...r.areaDraft,...e.patch,dirty:e.patch.dirty??!0}};case"set-notice":return{...r,notice:e.notice};case"open-dialog":return{...r,dialog:e.dialog};case"dismiss-top-layer":return r.dialog?{...r,dialog:null}:r.precisionOpen?{...r,precisionOpen:!1}:r.fullMap?{...r,fullMap:!1}:r.workflow!=="none"?{...r,workflow:"none",precisionOpen:!1}:r;case"return-live":return{...r,dataMode:"live",workflow:"none",floor:{...r.floor,readOnly:!1}}}},Me=class{#t=new Set;#e;constructor(e=Ge()){this.#e=e}get value(){return this.#e}dispatch(e){let t=Qe(this.#e,e);if(t===this.#e)return t;this.#e=t;for(let o of this.#t)o(t);return t}replace(e){if(e!==this.#e){this.#e=e;for(let t of this.#t)t(e)}}patch(e){let t={...this.#e,...e};return this.replace(t),t}subscribe(e){return this.#t.add(e),e(this.#e),()=>this.#t.delete(e)}},ke=class{#t=null;#e=0;get generation(){return this.#e}begin(e,t,o,n){return this.#e+=1,this.#t={entryKey:e,generation:this.#e,floorKey:t,missionKey:o,revision:n},this.#t}current(){return this.#t}accepts(e){let t=this.#t;return!!(t&&e.entryKey===t.entryKey&&e.generation===t.generation&&e.floorKey===t.floorKey&&e.missionKey===t.missionKey&&e.revision===t.revision)}advance(e,t){return!this.accepts(e)||!Number.isSafeInteger(t)||t<=e.revision?null:(this.#t={...e,revision:t},this.#t)}invalidate(){return this.#e+=1,this.#t=null,this.#e}},W=r=>r.dataMode==="live"&&r.map.available&&(r.coherence==="current"||r.coherence==="degraded")&&r.host.administrator,Se=r=>W(r)&&r.coherence==="current"&&r.map.floorCoherent&&r.map.sessionVerified&&r.map.exactPose&&r.host.connected&&r.host.robotConnected,Z=r=>W(r)&&r.coherence==="current"&&r.map.complete&&r.map.floorCoherent&&r.map.sessionVerified&&r.host.connected&&r.host.robotConnected&&!r.floor.readOnly,R=r=>Z(r)&&!r.managedLock&&r.command==="idle"&&(r.activity==="idle"||r.activity==="docked"),D=(r,e,t)=>({id:r,label:e,kind:"neutral",enabled:!1,reason:t}),kt=r=>{if(r.dataMode==="history")return{id:"return-live",label:"Return to Live",kind:"primary",enabled:!0};if(r.activity==="cleaning"||r.activity==="returning")return{id:"stop",label:"Stop",kind:"danger",enabled:r.command==="idle"};if(r.activity==="stopping"||r.command==="settling")return D("stopping","Stopping\u2026","Waiting for the robot to settle");if(r.activity==="paused")return{id:"resume",label:"Resume",kind:"primary",enabled:r.command==="idle"};if(!r.host.connected)return D("reconnecting","Reconnecting\u2026","Home Assistant is offline");if(!r.host.administrator)return D("administrator","Administrator required","This map is private");if(!r.host.robotConnected)return D("robot-offline","Robot offline","Reconnect the robot first");if(r.coherence!=="current")return D("locating","Locating\u2026","Waiting for the current map");if(r.workflow==="draw")return r.fullMap||r.narrowHint?{id:"review-area",label:"Review details",kind:"primary",enabled:r.draw.dirty,...r.draw.dirty?{}:{reason:"Draw an area first"}}:{id:"save-area",label:"Save area",kind:"primary",enabled:r.draw.dirty&&Z(r),...r.draw.dirty?{}:{reason:"Draw an area first"}};if(r.workflow==="rooms"){let e=R(r)&&r.selection.roomIds.length>0;return{id:"clean-rooms",label:r.selection.roomIds.length?`Clean ${r.selection.roomIds.length} room${r.selection.roomIds.length===1?"":"s"}`:"Choose rooms",kind:"primary",enabled:e,...e?{}:{reason:r.selection.roomIds.length?"Map verification is required":"Select at least one room"}}}if(r.workflow==="plan"){if(r.planDraft.dirty||!r.planDraft.id){let e=Z(r)&&r.planDraft.name.trim().length>0&&r.planDraft.rooms.length>0;return{id:"save-plan",label:"Save plan",kind:"primary",enabled:e,...e?{}:{reason:"Add a name and at least one room"}}}return{id:"run-plan",label:"Run plan",kind:"primary",enabled:R(r)&&r.planDraft.enabled,...R(r)?{}:{reason:"Map verification is required"}}}if(r.workflow==="areaReview"){if(r.areaDraft.dirty||r.draw.dirty||!r.areaDraft.id||r.areaDraft.canRebind){let t=Z(r)&&r.areaDraft.name.trim().length>0&&r.draw.circles.length>0;return{id:"save-area",label:r.areaDraft.canRebind?"Confirm on this map":"Save area",kind:"primary",enabled:t,...t?{}:{reason:"Add a name and at least one mark"}}}let e=r.areaDraft.status==="current";return{id:"run-area",label:"Clean area",kind:"primary",enabled:e&&R(r),...e?{}:{reason:"Review or redraw this area first"}}}return{id:"run-plan",label:"Run plan",kind:"primary",enabled:R(r),...R(r)?{}:{reason:"Map verification is required"}}},St=r=>r.activity==="paused"?{id:"stop",label:"Stop",kind:"danger",enabled:r.command==="idle"}:null,Ct=r=>r.draw.brushMeters*64*(r.draw.zoomPercent/100),Je=[2,1,.5,.25,.1,.05],Ce=r=>{let e=64*(r.draw.zoomPercent/100),t=Je.reduce((o,n)=>{let i=Math.abs(n*e-64),a=Math.abs(o*e-64);return i<a?n:o});return{meters:t,pixels:t*e,label:t<1?`${Math.round(t*100)} cm`:`${t} m`}},At=(r,e)=>({...r,command:e});var j=globalThis,G=j.ShadowRoot&&(j.ShadyCSS===void 0||j.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,ne=Symbol(),Ae=new WeakMap,O=class{constructor(e,t,o){if(this._$cssResult$=!0,o!==ne)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=e,this.t=t}get styleSheet(){let e=this.o,t=this.t;if(G&&e===void 0){let o=t!==void 0&&t.length===1;o&&(e=Ae.get(t)),e===void 0&&((this.o=e=new CSSStyleSheet).replaceSync(this.cssText),o&&Ae.set(t,e))}return e}toString(){return this.cssText}},$e=r=>new O(typeof r=="string"?r:r+"",void 0,ne),N=(r,...e)=>{let t=r.length===1?r[0]:e.reduce((o,n,i)=>o+(a=>{if(a._$cssResult$===!0)return a.cssText;if(typeof a=="number")return a;throw Error("Value passed to 'css' function must be a 'css' function result: "+a+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(n)+r[i+1],r[0]);return new O(t,r,ne)},Pe=(r,e)=>{if(G)r.adoptedStyleSheets=e.map(t=>t instanceof CSSStyleSheet?t:t.styleSheet);else for(let t of e){let o=document.createElement("style"),n=j.litNonce;n!==void 0&&o.setAttribute("nonce",n),o.textContent=t.cssText,r.appendChild(o)}},ie=G?r=>r:r=>r instanceof CSSStyleSheet?(e=>{let t="";for(let o of e.cssRules)t+=o.cssText;return $e(t)})(r):r;var{is:et,defineProperty:tt,getOwnPropertyDescriptor:rt,getOwnPropertyNames:ot,getOwnPropertySymbols:nt,getPrototypeOf:it}=Object,Q=globalThis,_e=Q.trustedTypes,at=_e?_e.emptyScript:"",st=Q.reactiveElementPolyfillSupport,H=(r,e)=>r,ae={toAttribute(r,e){switch(e){case Boolean:r=r?at:null;break;case Object:case Array:r=r==null?r:JSON.stringify(r)}return r},fromAttribute(r,e){let t=r;switch(e){case Boolean:t=r!==null;break;case Number:t=r===null?null:Number(r);break;case Object:case Array:try{t=JSON.parse(r)}catch{t=null}}return t}},Re=(r,e)=>!et(r,e),Ee={attribute:!0,type:String,converter:ae,reflect:!1,useDefault:!1,hasChanged:Re};Symbol.metadata??=Symbol("metadata"),Q.litPropertyMetadata??=new WeakMap;var M=class extends HTMLElement{static addInitializer(e){this._$Ei(),(this.l??=[]).push(e)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(e,t=Ee){if(t.state&&(t.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(e)&&((t=Object.create(t)).wrapped=!0),this.elementProperties.set(e,t),!t.noAccessor){let o=Symbol(),n=this.getPropertyDescriptor(e,o,t);n!==void 0&&tt(this.prototype,e,n)}}static getPropertyDescriptor(e,t,o){let{get:n,set:i}=rt(this.prototype,e)??{get(){return this[t]},set(a){this[t]=a}};return{get:n,set(a){let l=n?.call(this);i?.call(this,a),this.requestUpdate(e,l,o)},configurable:!0,enumerable:!0}}static getPropertyOptions(e){return this.elementProperties.get(e)??Ee}static _$Ei(){if(this.hasOwnProperty(H("elementProperties")))return;let e=it(this);e.finalize(),e.l!==void 0&&(this.l=[...e.l]),this.elementProperties=new Map(e.elementProperties)}static finalize(){if(this.hasOwnProperty(H("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(H("properties"))){let t=this.properties,o=[...ot(t),...nt(t)];for(let n of o)this.createProperty(n,t[n])}let e=this[Symbol.metadata];if(e!==null){let t=litPropertyMetadata.get(e);if(t!==void 0)for(let[o,n]of t)this.elementProperties.set(o,n)}this._$Eh=new Map;for(let[t,o]of this.elementProperties){let n=this._$Eu(t,o);n!==void 0&&this._$Eh.set(n,t)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(e){let t=[];if(Array.isArray(e)){let o=new Set(e.flat(1/0).reverse());for(let n of o)t.unshift(ie(n))}else e!==void 0&&t.push(ie(e));return t}static _$Eu(e,t){let o=t.attribute;return o===!1?void 0:typeof o=="string"?o:typeof e=="string"?e.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){this._$ES=new Promise(e=>this.enableUpdating=e),this._$AL=new Map,this._$E_(),this.requestUpdate(),this.constructor.l?.forEach(e=>e(this))}addController(e){(this._$EO??=new Set).add(e),this.renderRoot!==void 0&&this.isConnected&&e.hostConnected?.()}removeController(e){this._$EO?.delete(e)}_$E_(){let e=new Map,t=this.constructor.elementProperties;for(let o of t.keys())this.hasOwnProperty(o)&&(e.set(o,this[o]),delete this[o]);e.size>0&&(this._$Ep=e)}createRenderRoot(){let e=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return Pe(e,this.constructor.elementStyles),e}connectedCallback(){this.renderRoot??=this.createRenderRoot(),this.enableUpdating(!0),this._$EO?.forEach(e=>e.hostConnected?.())}enableUpdating(e){}disconnectedCallback(){this._$EO?.forEach(e=>e.hostDisconnected?.())}attributeChangedCallback(e,t,o){this._$AK(e,o)}_$ET(e,t){let o=this.constructor.elementProperties.get(e),n=this.constructor._$Eu(e,o);if(n!==void 0&&o.reflect===!0){let i=(o.converter?.toAttribute!==void 0?o.converter:ae).toAttribute(t,o.type);this._$Em=e,i==null?this.removeAttribute(n):this.setAttribute(n,i),this._$Em=null}}_$AK(e,t){let o=this.constructor,n=o._$Eh.get(e);if(n!==void 0&&this._$Em!==n){let i=o.getPropertyOptions(n),a=typeof i.converter=="function"?{fromAttribute:i.converter}:i.converter?.fromAttribute!==void 0?i.converter:ae;this._$Em=n;let l=a.fromAttribute(t,i.type);this[n]=l??this._$Ej?.get(n)??l,this._$Em=null}}requestUpdate(e,t,o,n=!1,i){if(e!==void 0){let a=this.constructor;if(n===!1&&(i=this[e]),o??=a.getPropertyOptions(e),!((o.hasChanged??Re)(i,t)||o.useDefault&&o.reflect&&i===this._$Ej?.get(e)&&!this.hasAttribute(a._$Eu(e,o))))return;this.C(e,t,o)}this.isUpdatePending===!1&&(this._$ES=this._$EP())}C(e,t,{useDefault:o,reflect:n,wrapped:i},a){o&&!(this._$Ej??=new Map).has(e)&&(this._$Ej.set(e,a??t??this[e]),i!==!0||a!==void 0)||(this._$AL.has(e)||(this.hasUpdated||o||(t=void 0),this._$AL.set(e,t)),n===!0&&this._$Em!==e&&(this._$Eq??=new Set).add(e))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(t){Promise.reject(t)}let e=this.scheduleUpdate();return e!=null&&await e,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??=this.createRenderRoot(),this._$Ep){for(let[n,i]of this._$Ep)this[n]=i;this._$Ep=void 0}let o=this.constructor.elementProperties;if(o.size>0)for(let[n,i]of o){let{wrapped:a}=i,l=this[n];a!==!0||this._$AL.has(n)||l===void 0||this.C(n,void 0,i,l)}}let e=!1,t=this._$AL;try{e=this.shouldUpdate(t),e?(this.willUpdate(t),this._$EO?.forEach(o=>o.hostUpdate?.()),this.update(t)):this._$EM()}catch(o){throw e=!1,this._$EM(),o}e&&this._$AE(t)}willUpdate(e){}_$AE(e){this._$EO?.forEach(t=>t.hostUpdated?.()),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(e)),this.updated(e)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(e){return!0}update(e){this._$Eq&&=this._$Eq.forEach(t=>this._$ET(t,this[t])),this._$EM()}updated(e){}firstUpdated(e){}};M.elementStyles=[],M.shadowRootOptions={mode:"open"},M[H("elementProperties")]=new Map,M[H("finalized")]=new Map,st?.({ReactiveElement:M}),(Q.reactiveElementVersions??=[]).push("2.1.2");var pe=globalThis,Te=r=>r,J=pe.trustedTypes,ze=J?J.createPolicy("lit-html",{createHTML:r=>r}):void 0,Ne="$lit$",S=`lit$${Math.random().toFixed(9).slice(2)}$`,He="?"+S,lt=`<${He}>`,P=document,B=()=>P.createComment(""),X=r=>r===null||typeof r!="object"&&typeof r!="function",me=Array.isArray,ct=r=>me(r)||typeof r?.[Symbol.iterator]=="function",se=`[ 	
\f\r]`,U=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,Ie=/-->/g,Le=/>/g,A=RegExp(`>|${se}(?:([^\\s"'>=/]+)(${se}*=${se}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`,"g"),De=/'/g,We=/"/g,Ue=/^(?:script|style|textarea|title)$/i,ye=r=>(e,...t)=>({_$litType$:r,strings:e,values:t}),f=ye(1),Tt=ye(2),zt=ye(3),_=Symbol.for("lit-noChange"),u=Symbol.for("lit-nothing"),Oe=new WeakMap,$=P.createTreeWalker(P,129);function Be(r,e){if(!me(r)||!r.hasOwnProperty("raw"))throw Error("invalid template strings array");return ze!==void 0?ze.createHTML(e):e}var dt=(r,e)=>{let t=r.length-1,o=[],n,i=e===2?"<svg>":e===3?"<math>":"",a=U;for(let l=0;l<t;l++){let s=r[l],c,d,h=-1,p=0;for(;p<s.length&&(a.lastIndex=p,d=a.exec(s),d!==null);)p=a.lastIndex,a===U?d[1]==="!--"?a=Ie:d[1]!==void 0?a=Le:d[2]!==void 0?(Ue.test(d[2])&&(n=RegExp("</"+d[2],"g")),a=A):d[3]!==void 0&&(a=A):a===A?d[0]===">"?(a=n??U,h=-1):d[1]===void 0?h=-2:(h=a.lastIndex-d[2].length,c=d[1],a=d[3]===void 0?A:d[3]==='"'?We:De):a===We||a===De?a=A:a===Ie||a===Le?a=U:(a=A,n=void 0);let m=a===A&&r[l+1].startsWith("/>")?" ":"";i+=a===U?s+lt:h>=0?(o.push(c),s.slice(0,h)+Ne+s.slice(h)+S+m):s+S+(h===-2?l:m)}return[Be(r,i+(r[t]||"<?>")+(e===2?"</svg>":e===3?"</math>":"")),o]},F=class r{constructor({strings:e,_$litType$:t},o){let n;this.parts=[];let i=0,a=0,l=e.length-1,s=this.parts,[c,d]=dt(e,t);if(this.el=r.createElement(c,o),$.currentNode=this.el.content,t===2||t===3){let h=this.el.content.firstChild;h.replaceWith(...h.childNodes)}for(;(n=$.nextNode())!==null&&s.length<l;){if(n.nodeType===1){if(n.hasAttributes())for(let h of n.getAttributeNames())if(h.endsWith(Ne)){let p=d[a++],m=n.getAttribute(h).split(S),y=/([.?@])?(.*)/.exec(p);s.push({type:1,index:i,name:y[2],strings:m,ctor:y[1]==="."?ce:y[1]==="?"?de:y[1]==="@"?he:z}),n.removeAttribute(h)}else h.startsWith(S)&&(s.push({type:6,index:i}),n.removeAttribute(h));if(Ue.test(n.tagName)){let h=n.textContent.split(S),p=h.length-1;if(p>0){n.textContent=J?J.emptyScript:"";for(let m=0;m<p;m++)n.append(h[m],B()),$.nextNode(),s.push({type:2,index:++i});n.append(h[p],B())}}}else if(n.nodeType===8)if(n.data===He)s.push({type:2,index:i});else{let h=-1;for(;(h=n.data.indexOf(S,h+1))!==-1;)s.push({type:7,index:i}),h+=S.length-1}i++}}static createElement(e,t){let o=P.createElement("template");return o.innerHTML=e,o}};function T(r,e,t=r,o){if(e===_)return e;let n=o!==void 0?t._$Co?.[o]:t._$Cl,i=X(e)?void 0:e._$litDirective$;return n?.constructor!==i&&(n?._$AO?.(!1),i===void 0?n=void 0:(n=new i(r),n._$AT(r,t,o)),o!==void 0?(t._$Co??=[])[o]=n:t._$Cl=n),n!==void 0&&(e=T(r,n._$AS(r,e.values),n,o)),e}var le=class{constructor(e,t){this._$AV=[],this._$AN=void 0,this._$AD=e,this._$AM=t}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(e){let{el:{content:t},parts:o}=this._$AD,n=(e?.creationScope??P).importNode(t,!0);$.currentNode=n;let i=$.nextNode(),a=0,l=0,s=o[0];for(;s!==void 0;){if(a===s.index){let c;s.type===2?c=new V(i,i.nextSibling,this,e):s.type===1?c=new s.ctor(i,s.name,s.strings,this,e):s.type===6&&(c=new ue(i,this,e)),this._$AV.push(c),s=o[++l]}a!==s?.index&&(i=$.nextNode(),a++)}return $.currentNode=P,n}p(e){let t=0;for(let o of this._$AV)o!==void 0&&(o.strings!==void 0?(o._$AI(e,o,t),t+=o.strings.length-2):o._$AI(e[t])),t++}},V=class r{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(e,t,o,n){this.type=2,this._$AH=u,this._$AN=void 0,this._$AA=e,this._$AB=t,this._$AM=o,this.options=n,this._$Cv=n?.isConnected??!0}get parentNode(){let e=this._$AA.parentNode,t=this._$AM;return t!==void 0&&e?.nodeType===11&&(e=t.parentNode),e}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(e,t=this){e=T(this,e,t),X(e)?e===u||e==null||e===""?(this._$AH!==u&&this._$AR(),this._$AH=u):e!==this._$AH&&e!==_&&this._(e):e._$litType$!==void 0?this.$(e):e.nodeType!==void 0?this.T(e):ct(e)?this.k(e):this._(e)}O(e){return this._$AA.parentNode.insertBefore(e,this._$AB)}T(e){this._$AH!==e&&(this._$AR(),this._$AH=this.O(e))}_(e){this._$AH!==u&&X(this._$AH)?this._$AA.nextSibling.data=e:this.T(P.createTextNode(e)),this._$AH=e}$(e){let{values:t,_$litType$:o}=e,n=typeof o=="number"?this._$AC(e):(o.el===void 0&&(o.el=F.createElement(Be(o.h,o.h[0]),this.options)),o);if(this._$AH?._$AD===n)this._$AH.p(t);else{let i=new le(n,this),a=i.u(this.options);i.p(t),this.T(a),this._$AH=i}}_$AC(e){let t=Oe.get(e.strings);return t===void 0&&Oe.set(e.strings,t=new F(e)),t}k(e){me(this._$AH)||(this._$AH=[],this._$AR());let t=this._$AH,o,n=0;for(let i of e)n===t.length?t.push(o=new r(this.O(B()),this.O(B()),this,this.options)):o=t[n],o._$AI(i),n++;n<t.length&&(this._$AR(o&&o._$AB.nextSibling,n),t.length=n)}_$AR(e=this._$AA.nextSibling,t){for(this._$AP?.(!1,!0,t);e!==this._$AB;){let o=Te(e).nextSibling;Te(e).remove(),e=o}}setConnected(e){this._$AM===void 0&&(this._$Cv=e,this._$AP?.(e))}},z=class{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(e,t,o,n,i){this.type=1,this._$AH=u,this._$AN=void 0,this.element=e,this.name=t,this._$AM=n,this.options=i,o.length>2||o[0]!==""||o[1]!==""?(this._$AH=Array(o.length-1).fill(new String),this.strings=o):this._$AH=u}_$AI(e,t=this,o,n){let i=this.strings,a=!1;if(i===void 0)e=T(this,e,t,0),a=!X(e)||e!==this._$AH&&e!==_,a&&(this._$AH=e);else{let l=e,s,c;for(e=i[0],s=0;s<i.length-1;s++)c=T(this,l[o+s],t,s),c===_&&(c=this._$AH[s]),a||=!X(c)||c!==this._$AH[s],c===u?e=u:e!==u&&(e+=(c??"")+i[s+1]),this._$AH[s]=c}a&&!n&&this.j(e)}j(e){e===u?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,e??"")}},ce=class extends z{constructor(){super(...arguments),this.type=3}j(e){this.element[this.name]=e===u?void 0:e}},de=class extends z{constructor(){super(...arguments),this.type=4}j(e){this.element.toggleAttribute(this.name,!!e&&e!==u)}},he=class extends z{constructor(e,t,o,n,i){super(e,t,o,n,i),this.type=5}_$AI(e,t=this){if((e=T(this,e,t,0)??u)===_)return;let o=this._$AH,n=e===u&&o!==u||e.capture!==o.capture||e.once!==o.once||e.passive!==o.passive,i=e!==u&&(o===u||n);n&&this.element.removeEventListener(this.name,this,o),i&&this.element.addEventListener(this.name,this,e),this._$AH=e}handleEvent(e){typeof this._$AH=="function"?this._$AH.call(this.options?.host??this.element,e):this._$AH.handleEvent(e)}},ue=class{constructor(e,t,o){this.element=e,this.type=6,this._$AN=void 0,this._$AM=t,this.options=o}get _$AU(){return this._$AM._$AU}_$AI(e){T(this,e)}};var ht=pe.litHtmlPolyfillSupport;ht?.(F,V),(pe.litHtmlVersions??=[]).push("3.3.3");var Xe=(r,e,t)=>{let o=t?.renderBefore??e,n=o._$litPart$;if(n===void 0){let i=t?.renderBefore??null;o._$litPart$=n=new V(e.insertBefore(B(),i),i,void 0,t??{})}return n._$AI(r),n};var fe=globalThis,g=class extends M{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){let e=super.createRenderRoot();return this.renderOptions.renderBefore??=e.firstChild,e}update(e){let t=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(e),this._$Do=Xe(t,this.renderRoot,this.renderOptions)}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(!0)}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(!1)}render(){return _}};g._$litElement$=!0,g.finalized=!0,fe.litElementHydrateSupport?.({LitElement:g});var ut=fe.litElementPolyfillSupport;ut?.({LitElement:g});(fe.litElementVersions??=[]).push("4.2.2");var Fe=(r,e)=>Math.hypot(r.x-e.x,r.y-e.y),Ve=(r,e)=>({x:(r.x+e.x)/2,y:(r.y+e.y)/2}),be=r=>r.map(e=>({...e})),qe=r=>r instanceof Element&&!!r.closest("button, input, select, textarea, a, [role='button'], [role='menuitem']"),ee=class{#t;#e;#l;#o=new Map;#d=!1;#n="idle";#a=[];#s=[];#h=null;#u=0;#f=null;#b=!1;#g=null;#w=!1;constructor(e,t,o){this.#t=e,this.#e=t,this.#l=o,e.addEventListener("pointerdown",this.#k),e.addEventListener("pointermove",this.#p),e.addEventListener("pointerup",this.#i),e.addEventListener("pointercancel",this.#i),e.addEventListener("wheel",this.#v,{passive:!1}),e.addEventListener("keydown",this.#S),e.addEventListener("keyup",this.#r),e.addEventListener("blur",this.#x)}#k=e=>{if(this.#w||!e.isPrimary&&e.pointerType==="mouse"||qe(e.target))return;this.#t.focus({preventScroll:!0});let t={id:e.pointerId,type:e.pointerType,startX:e.clientX,startY:e.clientY,x:e.clientX,y:e.clientY};if(this.#o.set(e.pointerId,t),this.#t.setPointerCapture?.(e.pointerId),this.#o.size>=2){this.#m(),(this.#n==="paint"||this.#n==="erase")&&(this.#s=be(this.#a),this.#l.onCircles(this.#s,!1)),this.#n="pinch",this.#b=!0;let[a,l]=[...this.#o.values()];a&&l&&(this.#u=Math.max(1,Fe(a,l)),this.#f=Ve(a,l)),e.preventDefault();return}let o=this.#l.state(),n=o.workflow==="draw"&&o.map.available&&!o.floor.readOnly;this.#b||this.#d||e.button===1||o.draw.tool==="pan"?this.#n="pan":n&&(o.draw.tool==="paint"||o.draw.tool==="erase")?(this.#a=be(o.draw.circles),this.#s=be(o.draw.circles),e.pointerType==="touch"?(this.#n="idle",this.#g=window.setTimeout(()=>{if(this.#g=null,this.#o.size!==1||this.#b)return;this.#n=o.draw.tool;let a=this.#o.get(e.pointerId);a&&this.#y(a.x,a.y)},110)):(this.#n=o.draw.tool,this.#y(e.clientX,e.clientY))):this.#n=o.view==="three"&&!e.shiftKey?"orbit":"pan",e.preventDefault()};#p=e=>{let t=this.#o.get(e.pointerId);if(!t){let a=this.#e.screenToMap(e.clientX,e.clientY);this.#e.setCursor(a);return}let o=t.x,n=t.y;if(t.x=e.clientX,t.y=e.clientY,this.#n==="pinch"&&this.#o.size>=2){let[a,l]=[...this.#o.values()];if(!a||!l)return;let s=Math.max(1,Fe(a,l)),c=Ve(a,l);this.#e.zoomAt(s/this.#u,c.x,c.y),this.#f&&this.#e.panBy(c.x-this.#f.x,c.y-this.#f.y),this.#u=s,this.#f=c,e.preventDefault();return}this.#n==="paint"||this.#n==="erase"?this.#y(e.clientX,e.clientY):this.#n==="pan"?this.#e.panBy(e.clientX-o,e.clientY-n):this.#n==="orbit"&&this.#e.orbitBy(e.clientX-o,e.clientY-n);let i=this.#e.screenToMap(e.clientX,e.clientY);this.#e.setCursor(i),e.preventDefault()};#i=e=>{let t=this.#o.get(e.pointerId);if(t){if(this.#o.delete(e.pointerId),this.#t.releasePointerCapture?.(e.pointerId),this.#m(),(this.#n==="paint"||this.#n==="erase")&&JSON.stringify(this.#s)!==JSON.stringify(this.#a))this.#l.onCircles(this.#s,!0,this.#a);else if(this.#n!=="pinch"&&!this.#b&&Math.hypot(t.x-t.startX,t.y-t.startY)<7&&this.#l.state().workflow==="rooms"){let o=this.#e.roomAt(t.x,t.y);o&&this.#l.onRoom(o)}this.#o.size===0?(this.#n="idle",this.#b=!1,this.#f=null,this.#h=null):this.#n==="pinch"&&(this.#n="pan",this.#b=!0),e.preventDefault()}};#y(e,t){let o=this.#e.screenToMap(e,t);if(!o)return;let i=this.#l.state().draw.brushMeters/2;if(this.#n==="erase")this.#s=this.#s.filter(a=>Math.hypot(a.x-o.x,a.y-o.y)>a.radius+i);else{if(!this.#e.containsMapPoint(o))return;let a=Math.max(.04,i*.55),l=this.#h||o,s=Math.hypot(o.x-l.x,o.y-l.y),c=Math.max(1,Math.ceil(s/a));for(let d=0;d<=c&&this.#s.length<512;d+=1){let h=d/c,p={x:l.x+(o.x-l.x)*h,y:l.y+(o.y-l.y)*h};this.#s.some(m=>Math.hypot(m.x-p.x,m.y-p.y)<Math.max(.025,i*.28))||this.#s.push({x:Math.round(p.x*1e4)/1e4,y:Math.round(p.y*1e4)/1e4,radius:Math.round(i*100)/100})}}this.#h=o,this.#l.onCircles(this.#s,!1)}#v=e=>{if(!(e.ctrlKey||e.metaKey||e.altKey)&&!qe(e.target)){if(e.preventDefault(),Math.abs(e.deltaX)>Math.abs(e.deltaY)*.7&&Math.abs(e.deltaX)<50){this.#e.panBy(-e.deltaX,-e.deltaY);return}this.#e.zoomAt(Math.exp(-e.deltaY*.0015),e.clientX,e.clientY)}};#S=e=>{if(!(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey)){if(e.code==="Space"){this.#d=!0,e.preventDefault();return}if(e.key==="+"||e.key==="=")this.#e.zoomAt(1.25);else if(e.key==="-")this.#e.zoomAt(.8);else if(e.key==="0")this.#e.fit();else if(e.key==="ArrowLeft")this.#e.panBy(30,0);else if(e.key==="ArrowRight")this.#e.panBy(-30,0);else if(e.key==="ArrowUp")this.#e.panBy(0,30);else if(e.key==="ArrowDown")this.#e.panBy(0,-30);else return;e.preventDefault()}};#r=e=>{e.code==="Space"&&(this.#d=!1)};#x=()=>{this.#d=!1,this.#m(),this.#e.setCursor(null)};#m(){this.#g!==null&&window.clearTimeout(this.#g),this.#g=null}dispose(){this.#w||(this.#w=!0,this.#m(),this.#t.removeEventListener("pointerdown",this.#k),this.#t.removeEventListener("pointermove",this.#p),this.#t.removeEventListener("pointerup",this.#i),this.#t.removeEventListener("pointercancel",this.#i),this.#t.removeEventListener("wheel",this.#v),this.#t.removeEventListener("keydown",this.#S),this.#t.removeEventListener("keyup",this.#r),this.#t.removeEventListener("blur",this.#x),this.#o.clear())}};var v=(r,e,t)=>Math.max(e,Math.min(t,r)),pt=r=>{let e=r;for(;e>Math.PI;)e-=Math.PI*2;for(;e<-Math.PI;)e+=Math.PI*2;return e},mt=r=>{switch(r){case"efficient":return .35;case"balanced":return .65;case"maximum":case"auto":return 1}},yt=(r,e)=>{let t=new Float32Array(16);for(let o=0;o<4;o+=1)for(let n=0;n<4;n+=1){let i=0;for(let a=0;a<4;a+=1)i+=(r[a*4+n]??0)*(e[o*4+a]??0);t[o*4+n]=i}return t},ft=(r,e,t,o)=>{let n=1/Math.tan(r/2),i=new Float32Array(16);return i[0]=n/e,i[5]=n,i[10]=(o+t)/(t-o),i[11]=-1,i[14]=2*o*t/(t-o),i},bt=(r,e,t,o,n,i)=>{let a=new Float32Array(16);return a[0]=2/(e-r),a[5]=2/(o-t),a[10]=-2/(i-n),a[12]=-(e+r)/(e-r),a[13]=-(o+t)/(o-t),a[14]=-(i+n)/(i-n),a[15]=1,a},gt=(r,e)=>{let t=Math.hypot((r[0]??0)-(e[0]??0),(r[1]??0)-(e[1]??0),(r[2]??0)-(e[2]??0))||1,o=[((r[0]??0)-(e[0]??0))/t,((r[1]??0)-(e[1]??0))/t,((r[2]??0)-(e[2]??0))/t],n=Math.hypot(o[2]??0,o[0]??0)||1,i=[(o[2]??0)/n,0,-(o[0]??0)/n],a=[(o[1]??0)*(i[2]??0),(o[2]??0)*(i[0]??0)-(o[0]??0)*(i[2]??0),-(o[1]??0)*(i[0]??0)];return new Float32Array([i[0]??0,a[0]??0,o[0]??0,0,i[1]??0,a[1]??0,o[1]??0,0,i[2]??0,a[2]??0,o[2]??0,0,-((i[0]??0)*(r[0]??0)+(i[1]??0)*(r[1]??0)+(i[2]??0)*(r[2]??0)),-((a[0]??0)*(r[0]??0)+(a[1]??0)*(r[1]??0)+(a[2]??0)*(r[2]??0)),-((o[0]??0)*(r[0]??0)+(o[1]??0)*(r[1]??0)+(o[2]??0)*(r[2]??0)),1])},Ke=(r,e,t)=>{let o=!1,n=t.at(-1);if(!n)return!1;for(let i of t){let[a,l]=i,[s,c]=n;l>e!=c>e&&r<(s-a)*(e-l)/(c-l)+a&&(o=!o),n=i}return o},te=class{#t;#e;#l;#o=null;#d=null;#n=null;#a=null;#s=null;#h=null;#u=null;#f=null;#b=null;#g=null;#w=null;#k=null;#p=null;#i=null;#y=null;#v=null;#S;#r={yaw:-Math.PI/4,pitch:.82,distance:12,targetX:0,targetZ:0,orthographic:!1};#x=12;#m=8;#c=4;#I=new Float32Array(16);#C=null;#M="unavailable";#D=0;#$=0;#L=0;#A=0;#_=1;#P=!1;constructor(e,t,o={}){this.#t=e,this.#e=t,this.#l=o,this.#d=t.getContext("2d",{alpha:!0}),this.#t.addEventListener("webglcontextlost",this.#F),this.#t.addEventListener("webglcontextrestored",this.#V),this.#O(),this.#S=new ResizeObserver(()=>{this.#X(),this.requestRender()}),this.#S.observe(e)}get camera(){return{...this.#r}}setState(e){if(this.#P)return;let t=this.#p;this.#p=e;let o=e.resources.scene.value;o!==this.#i&&(this.#i=o,this.#K(o)),(!t||t.quality!==e.quality)&&(this.#_=mt(e.quality),this.#A=0);let n=t?.workflow!=="draw"&&e.workflow==="draw",i=t?.workflow==="draw"&&e.workflow!=="draw";(!t||t.view!==e.view||n||i)&&(this.#r=this.#q(e.workflow==="draw"?"top":e.view,e)),e.workflow==="draw"&&t?.draw.zoomPercent!==e.draw.zoomPercent&&(this.#r={...this.#r,orthographic:!0,pitch:Math.PI/2-.018,distance:this.#m*100/e.draw.zoomPercent}),this.requestRender()}#q(e,t){let o=e==="top",n=o?this.#m:this.#x,i=t.cameras[e];return i?{yaw:o?0:i.yaw,pitch:o?Math.PI/2-.018:i.pitch,distance:v(n/v(i.zoom,.01,100),Math.max(.2,this.#c*.04),this.#c*8),targetX:v(i.targetX,-this.#c,this.#c),targetZ:v(i.targetZ,-this.#c,this.#c),orthographic:o}:o?{yaw:0,pitch:Math.PI/2-.018,distance:n,targetX:0,targetZ:0,orthographic:!0}:{yaw:-Math.PI/4,pitch:.82,distance:n,targetX:0,targetZ:0,orthographic:!1}}#W(e,t){let o=this.#o;if(!o)throw new Error("webgl-unavailable");let n=o.createShader(e);if(!n)throw new Error("shader-unavailable");if(o.shaderSource(n,t),o.compileShader(n),!o.getShaderParameter(n,o.COMPILE_STATUS))throw o.deleteShader(n),new Error("shader-failed");return n}#O(){try{this.#o=this.#t.getContext("webgl2",{alpha:!0,antialias:!0,depth:!0,powerPreference:"high-performance"});let e=this.#o;if(!e)throw new Error("webgl2-unavailable");let t=this.#W(e.VERTEX_SHADER,`#version 300 es
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
      `),n=e.createProgram();if(!n)throw new Error("program-unavailable");if(e.attachShader(n,t),e.attachShader(n,o),e.linkProgram(n),e.deleteShader(t),e.deleteShader(o),!e.getProgramParameter(n,e.LINK_STATUS))throw new Error("program-failed");this.#s=n,this.#f=e.getUniformLocation(n,"uViewProjection"),this.#b=e.getUniformLocation(n,"uCenter"),this.#g=e.getUniformLocation(n,"uMetersPerCell"),this.#w=e.getUniformLocation(n,"uPointPixels"),this.#k=e.getUniformLocation(n,"uMaxPointPixels"),this.#h=e.createBuffer(),this.#u=e.createVertexArray(),e.bindVertexArray(this.#u),e.bindBuffer(e.ARRAY_BUFFER,this.#h),e.enableVertexAttribArray(0),e.vertexAttribIPointer(0,2,e.UNSIGNED_SHORT,8,0),e.enableVertexAttribArray(1),e.vertexAttribIPointer(1,1,e.UNSIGNED_BYTE,8,4),e.enableVertexAttribArray(2),e.vertexAttribPointer(2,3,e.UNSIGNED_BYTE,!0,8,5),e.bindVertexArray(null),e.enable(e.DEPTH_TEST),e.depthFunc(e.LEQUAL),e.enable(e.BLEND),e.blendFunc(e.SRC_ALPHA,e.ONE_MINUS_SRC_ALPHA),this.#M="webgl2",this.#D+=1,this.#i&&this.#N(this.#i)}catch{this.#z(),this.#H()}}#K(e){if(this.#B(),!e){this.#$=0,this.requestRender();return}let[t,o]=e.metadata.span,n=e.metadata.metersPerCell,i=t*n,a=o*n;this.#c=Math.max(1,Math.hypot(i,a)/2),this.#x=this.#c*1.72;let l=this.#t.getBoundingClientRect(),s=Math.max(.2,l.width/Math.max(1,l.height));this.#m=Math.max(a/2,i/(2*s))*1.12,this.fit(!1),this.#M==="webgl2"?this.#N(e):this.#U(e)}#N(e){let t=this.#o;if(!t||!this.#h)return;let o=new Uint8Array(e.buffer,e.pointOffset,e.total*8);t.bindBuffer(t.ARRAY_BUFFER,this.#h),t.bufferData(t.ARRAY_BUFFER,o,t.STATIC_DRAW),this.#$=e.total}#H(){this.#M="canvas2d",this.#a=document.createElement("canvas"),this.#a.width=1024,this.#a.height=1024,this.#n=this.#a.getContext("2d",{alpha:!0}),this.#n?this.#i&&this.#U(this.#i):(this.#M="unavailable",this.#l.onProblem?.("renderer-unavailable"))}#U(e){let t=this.#n;if(!t||!this.#a)return;t.clearRect(0,0,this.#a.width,this.#a.height);let o=new DataView(e.buffer,e.pointOffset,e.total*8),n=Math.min(e.total,5e4),i=Math.max(1,Math.ceil(e.total/n)),a=0,l=0,s=()=>{if(this.#P||e!==this.#i||!this.#a)return;let c=Math.min(e.total,a+i*4e3);for(;a<c;a+=i){let d=a*8,h=o.getUint16(d,!0)/Math.max(1,e.metadata.span[0])*this.#a.width,p=o.getUint16(d+2,!0)/Math.max(1,e.metadata.span[1])*this.#a.height,m=o.getUint8(d+5),y=o.getUint8(d+6),q=o.getUint8(d+7);t.fillStyle=`rgb(${m} ${y} ${q})`,t.fillRect(h,p,1.5,1.5),l+=1}this.#$=l,this.requestRender(),a<e.total?this.#v=window.setTimeout(s,0):this.#v=null};s()}#B(){this.#v!==null&&window.clearTimeout(this.#v),this.#v=null}#X(){let e=this.#t.getBoundingClientRect(),t=Math.min(window.devicePixelRatio||1,3),o=Math.max(1,Math.round(e.width*t)),n=Math.max(1,Math.round(e.height*t));for(let i of[this.#t,this.#e])(i.width!==o||i.height!==n)&&(i.width=o,i.height=n)}#Y(){let e=this.#t.getBoundingClientRect(),t=Math.max(.2,e.width/Math.max(1,e.height)),o=Math.cos(this.#r.pitch)*this.#r.distance,n=[this.#r.targetX+Math.sin(this.#r.yaw)*o,Math.sin(this.#r.pitch)*this.#r.distance,this.#r.targetZ+Math.cos(this.#r.yaw)*o],i=[this.#r.targetX,0,this.#r.targetZ],a=gt(n,i),l=this.#r.orthographic?bt(-this.#r.distance*t,this.#r.distance*t,-this.#r.distance,this.#r.distance,-this.#c*4,this.#c*4):ft(Math.PI/3.15,t,.02,Math.max(60,this.#c*12));return yt(l,a)}requestRender(){this.#y!==null||this.#P||(this.#y=window.requestAnimationFrame(()=>{this.#y=null,this.#Z()}))}#Z(){let e=performance.now();this.#X(),this.#I=this.#Y(),this.#M==="webgl2"?this.#j():this.#G(),this.#J(),this.#L=performance.now()-e,this.#L>18?(this.#A+=1,this.#A>=3&&this.#p?.quality==="auto"&&(this.#_=Math.max(.25,this.#_*.75))):this.#A=Math.max(0,this.#A-1)}#j(){let e=this.#o,t=this.#i;if(!e||(e.viewport(0,0,this.#t.width,this.#t.height),e.clearColor(0,0,0,0),e.clear(e.COLOR_BUFFER_BIT|e.DEPTH_BUFFER_BIT),!t||!this.#s||!this.#u))return;e.useProgram(this.#s),e.bindVertexArray(this.#u),e.uniformMatrix4fv(this.#f,!1,this.#I),e.uniform2f(this.#b,(t.metadata.span[0]-1)/2,(t.metadata.span[1]-1)/2),e.uniform1f(this.#g,t.metadata.metersPerCell);let o=Math.min(window.devicePixelRatio||1,3),n=Math.max(1,Math.floor(t.total*this.#_)),i=Math.min(t.floorCount,n),a=Math.min(t.surfaceCount,Math.max(0,n-i));e.uniform1f(this.#w,this.#t.height*.038),e.uniform1f(this.#k,4.5*o),e.drawArrays(e.POINTS,0,i),e.uniform1f(this.#w,this.#t.height*.05),e.uniform1f(this.#k,7*o),e.drawArrays(e.POINTS,t.floorCount,a),e.bindVertexArray(null),this.#$=i+a}#G(){}#Q(e,t,o=0){let n=this.#i;return n?[-(e-(n.metadata.span[0]-1)/2)*n.metadata.metersPerCell,o*n.metadata.metersPerCell,(t-(n.metadata.span[1]-1)/2)*n.metadata.metersPerCell]:null}#E(e,t,o=0){let n=this.#Q(e,t,o);if(!n)return null;let[i,a,l]=n,s=this.#I,c=(s[0]??0)*i+(s[4]??0)*a+(s[8]??0)*l+(s[12]??0),d=(s[1]??0)*i+(s[5]??0)*a+(s[9]??0)*l+(s[13]??0),h=(s[3]??0)*i+(s[7]??0)*a+(s[11]??0)*l+(s[15]??0);if(h<=.001)return null;let p=c/h,m=d/h;if(Math.abs(p)>1.15||Math.abs(m)>1.15)return null;let y=this.#e.getBoundingClientRect();return{x:(p*.5+.5)*y.width,y:(-m*.5+.5)*y.height}}#R(e,t,o=0){let n=this.#i;if(!n)return null;let i=e/n.metadata.metersPerCell-n.metadata.origin[0],a=t/n.metadata.metersPerCell-n.metadata.origin[1];return this.#E(i,a,o)}#J(){let e=this.#d,t=this.#i,o=this.#p;if(!e)return;let n=Math.min(window.devicePixelRatio||1,3),i=this.#e.getBoundingClientRect();if(e.setTransform(n,0,0,n,0,0),e.clearRect(0,0,i.width,i.height),!t||!o)return;if(this.#M==="canvas2d"&&this.#a){let c=this.#m/this.#r.distance,d=i.width*c,h=i.height*c,p=(i.width-d)/2-this.#r.targetX*32*c,m=(i.height-h)/2-this.#r.targetZ*32*c;e.drawImage(this.#a,p,m,d,h)}let a=this.#ee(o);if(o.labelsVisible){e.lineWidth=1.5,e.font="600 12px system-ui, sans-serif",e.textAlign="center",e.textBaseline="middle";let c=[];for(let d of t.metadata.rooms){let h=a.has(d.name.toLocaleLowerCase());e.strokeStyle=h?"#0678ce":"rgba(75, 92, 105, .7)",e.fillStyle=h?"rgba(6, 120, 206, .16)":"rgba(255, 255, 255, .04)",e.beginPath();let p=Math.max(1,Math.ceil(d.boundary.length/512)),m=!1;for(let k=0;k<d.boundary.length;k+=p){let re=d.boundary[k];if(!re)continue;let I=this.#E(re[0],re[1],.2);I&&(m?e.lineTo(I.x,I.y):e.moveTo(I.x,I.y),m=!0)}m&&(e.closePath(),e.fill(),e.stroke());let y=this.#E(d.center[0],d.center[1],1);if(!y)continue;let q=e.measureText(d.name).width,w=new DOMRect(y.x-q/2-6,y.y-10,q+12,20);c.some(k=>w.left<k.right+8&&w.right+8>k.left&&w.top<k.bottom+4&&w.bottom+4>k.top)||(c.push(w),e.fillStyle="rgba(250, 252, 253, .88)",e.fillRect(w.x,w.y,w.width,w.height),e.fillStyle="#263238",e.fillText(d.name,y.x,y.y))}}let l=o.draw.circles;if((o.workflow==="draw"||o.workflow==="areaReview")&&l.length){e.fillStyle="rgba(6, 120, 206, .22)",e.strokeStyle="rgba(6, 120, 206, .92)",e.lineWidth=1.5;for(let c of l)this.#te(e,c)}if(this.#C&&o.workflow==="draw"&&o.draw.tool!=="pan"){let c=this.#R(this.#C.x,this.#C.y),d=this.#R(this.#C.x+o.draw.brushMeters/2,this.#C.y);c&&d&&(e.beginPath(),e.arc(c.x,c.y,Math.max(2,Math.hypot(d.x-c.x,d.y-c.y)),0,Math.PI*2),e.strokeStyle="#0678ce",e.lineWidth=2,e.stroke())}let s=o.resources.pose.value;if(o.map.exactPose&&s?.position&&o.dataMode==="live"){let c=this.#E(s.position[0],s.position[1],3);c&&(e.beginPath(),e.arc(c.x,c.y,7,0,Math.PI*2),e.fillStyle="#0678ce",e.fill(),e.strokeStyle="#fff",e.lineWidth=3,e.stroke())}}#ee(e){let t=e.resources.plans.value?.rooms||e.resources.areas.value?.rooms||[];return new Set(t.filter(o=>e.selection.roomIds.includes(o.roomId)).map(o=>o.name.toLocaleLowerCase()))}#te(e,t){let o=this.#R(t.x,t.y),n=this.#R(t.x+t.radius,t.y);!o||!n||(e.beginPath(),e.arc(o.x,o.y,Math.max(1,Math.hypot(n.x-o.x,n.y-o.y)),0,Math.PI*2),e.fill(),e.stroke())}setCursor(e){this.#C=e,this.requestRender()}screenToMap(e,t){let o=this.#i;if(!o||!this.#r.orthographic)return null;let n=this.#t.getBoundingClientRect();if(!n.width||!n.height)return null;let i=this.#r.distance*2/n.height,a=this.#r.targetX+(e-n.left-n.width/2)*i,l=this.#r.targetZ+(t-n.top-n.height/2)*i,s=-a/o.metadata.metersPerCell+(o.metadata.span[0]-1)/2,c=l/o.metadata.metersPerCell+(o.metadata.span[1]-1)/2;return{x:(s+o.metadata.origin[0])*o.metadata.metersPerCell,y:(c+o.metadata.origin[1])*o.metadata.metersPerCell}}roomAt(e,t){let o=this.screenToMap(e,t),n=this.#i,i=this.#p;if(!o||!n||!i)return null;let a=o.x/n.metadata.metersPerCell-n.metadata.origin[0],l=o.y/n.metadata.metersPerCell-n.metadata.origin[1],s=n.metadata.rooms.find(c=>Ke(a,l,c.boundary));return s?this.#re(s,i):null}containsMapPoint(e){let t=this.#i;if(!t)return!1;let o=e.x/t.metadata.metersPerCell-t.metadata.origin[0],n=e.y/t.metadata.metersPerCell-t.metadata.origin[1];return t.metadata.rooms.some(i=>Ke(o,n,i.boundary))}#re(e,t){return(t.resources.plans.value?.rooms||t.resources.areas.value?.rooms||[]).find(n=>n.name.localeCompare(e.name,void 0,{sensitivity:"base"})===0)?.roomId||e.id}selectRoomAt(e,t){let o=this.roomAt(e,t);o&&this.#l.onRoom?.(o)}fit(e=!0){let t=this.#p?.view==="top"||this.#p?.workflow==="draw";this.#r=t?{yaw:0,pitch:Math.PI/2-.018,distance:this.#m,targetX:0,targetZ:0,orthographic:!0}:{yaw:-Math.PI/4,pitch:.82,distance:this.#x,targetX:0,targetZ:0,orthographic:!1},this.requestRender(),e&&this.#T()}zoomAt(e,t,o){let n=t===void 0||o===void 0?null:this.screenToMap(t,o);if(this.#r={...this.#r,distance:v(this.#r.distance/e,Math.max(.2,this.#c*.04),this.#c*8)},n&&t!==void 0&&o!==void 0){let i=this.screenToMap(t,o);i&&(this.#r={...this.#r,targetX:this.#r.targetX-(n.x-i.x),targetZ:this.#r.targetZ+(n.y-i.y)})}this.requestRender(),this.#T(t,o)}panBy(e,t){let o=this.#t.getBoundingClientRect(),n=this.#r.distance*2/Math.max(1,o.height),i=Math.cos(this.#r.yaw),a=-Math.sin(this.#r.yaw),l=-Math.sin(this.#r.yaw),s=-Math.cos(this.#r.yaw);this.#r={...this.#r,targetX:v(this.#r.targetX-e*n*i+t*n*l,-this.#c,this.#c),targetZ:v(this.#r.targetZ-e*n*a+t*n*s,-this.#c,this.#c)},this.requestRender(),this.#T()}orbitBy(e,t){if(this.#r.orthographic){this.panBy(e,t);return}this.#r={...this.#r,yaw:pt(this.#r.yaw+e*.006),pitch:v(this.#r.pitch-t*.004,.18,1.38)},this.requestRender(),this.#T()}#T(e,t){let o=this.#r.orthographic?this.#m:this.#x,n=this.#t.getBoundingClientRect(),i=e===void 0||t===void 0||!n.width||!n.height?void 0:{xPercent:v((e-n.left)/n.width*100,0,100),yPercent:v((t-n.top)/n.height*100,0,100)};this.#l.onCamera?.(this.camera,Math.round(o/this.#r.distance*100),i)}diagnostics(){return{mode:this.#M,contextGeneration:this.#D,sceneRevision:this.#i?.revision??null,sourcePoints:this.#i?.total??0,renderedPoints:this.#$,lastFrameMs:Math.round(this.#L*100)/100,slowFrames:this.#A}}#F=e=>{e.preventDefault(),this.#z(),this.#H(),this.requestRender()};#V=()=>{this.#z(),this.#O(),this.requestRender()};#z(){let e=this.#o;e&&(this.#h&&e.deleteBuffer(this.#h),this.#u&&e.deleteVertexArray(this.#u),this.#s&&e.deleteProgram(this.#s)),this.#h=null,this.#u=null,this.#s=null,this.#o=null}dispose(){this.#P||(this.#P=!0,this.#S.disconnect(),this.#t.removeEventListener("webglcontextlost",this.#F),this.#t.removeEventListener("webglcontextrestored",this.#V),this.#y!==null&&window.cancelAnimationFrame(this.#y),this.#y=null,this.#B(),this.#z(),this.#a=null,this.#n=null,this.#d=null,this.#i=null,this.#p=null)}};var ve="matic-workspace-intent",vt="matic-workspace-action",Ye=r=>{if(!W(r))return"The current private map is not available.";if(r.dataMode==="history")return`Saved read-only map for ${r.floor.displayName}. Live robot position is hidden.`;let e=Se(r)?"The robot position is verified.":"The robot position is not shown.";return`Live map for ${r.floor.displayName}. ${e}`},ge=class extends g{static{this.properties={state:{attribute:!1}}}static{this.styles=N`
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
  `}#t=null;#e=null;#l=null;firstUpdated(){let e=this.renderRoot.querySelector(".map-root"),t=this.renderRoot.querySelector(".scene-canvas"),o=this.renderRoot.querySelector(".overlay-canvas");!e||!t||!o||(this.#e=new te(t,o,{onCamera:(n,i,a)=>{this.state.workflow==="draw"&&i!==this.state.draw.zoomPercent&&this.#o({type:"set-zoom",value:i,...a?{originX:a.xPercent,originY:a.yPercent}:{}})},onRoom:n=>this.#o({type:"toggle-room",roomId:n}),onProblem:()=>this.#d("renderer-problem")}),this.#l=new ee(e,this.#e,{state:()=>this.state,onCircles:(n,i,a)=>this.#o({type:"set-draft-circles",circles:n,record:i,...a?{previous:a}:{}}),onRoom:n=>this.#o({type:"toggle-room",roomId:n})}),this.#e.setState(this.state))}disconnectedCallback(){this.#l?.dispose(),this.#l=null,this.#e?.dispose(),this.#e=null,super.disconnectedCallback()}updated(e){if(!e.has("state"))return;e.get("state")?.fullMap&&!this.state.fullMap&&this.#t&&this.#t.focus(),this.#e?.setState(this.state)}#o(e){this.dispatchEvent(new CustomEvent(ve,{detail:e,bubbles:!0,composed:!0}))}#d(e){this.dispatchEvent(new CustomEvent(vt,{detail:{id:e},bubbles:!0,composed:!0}))}#n(e){this.#t=e.currentTarget,this.#o({type:this.state.fullMap?"exit-full-map":"enter-full-map"})}#a(e){if(!(e.ctrlKey||e.metaKey||e.altKey)&&e.key==="Escape"){e.preventDefault(),this.#o({type:"dismiss-top-layer"});return}}rendererDiagnostics(){return this.#e?.diagnostics()??null}canvasIdentity(){return{scene:this.renderRoot.querySelector(".scene-canvas"),overlay:this.renderRoot.querySelector(".overlay-canvas")}}#s(){return this.state.host.connected?this.state.host.administrator?this.state.host.robotCount===0?{title:"No Matic robot set up",detail:"Set up a robot before opening its map."}:this.state.host.robotConnected?this.state.coherence==="verifying"||this.state.coherence==="booting"?{title:"Locating the current map",detail:"Map controls will return after the floor is verified."}:this.state.map.available?this.state.activity==="problem"?{title:"Robot needs attention",detail:"Check the robot before starting another task."}:null:{title:"Map unavailable",detail:"This browser cannot show the private map right now."}:{title:"Robot offline",detail:"The last verified map stays read only and has no live position."}:{title:"Administrator access required",detail:"Private map data is hidden."}:{title:"Reconnecting",detail:"The verified map is read only until Home Assistant reconnects."}}render(){let e=this.state,t=Ce(e),o=this.#s(),n=e.map.available&&(W(e)||e.dataMode==="history"),i=e.workflow==="draw"&&n,a=e.coherence==="verifying"||e.coherence==="booting";return f`
      <section
        class="map-root"
        tabindex="0"
        role="application"
        aria-label=${Ye(e)}
        data-full-map=${String(e.fullMap)}
        data-workflow=${e.workflow}
        @keydown=${this.#a}
      >
        ${e.floor.classifiedCount>1?f`
          <button
            class="floor-chip"
            type="button"
            aria-label="Choose floor"
            @click=${()=>this.#o({type:"open-workflow",workflow:"history"})}
          >
            <span>${e.floor.displayName}</span>
            ${e.floor.readOnly?f`<small>Saved · read only</small>`:u}
          </button>
        `:u}

        ${!a||e.fullMap?f`<nav class="map-tools" aria-label="Map tools">
          ${a?u:f`
            <button type="button" @click=${()=>{this.#e?.fit(),this.#o({type:"fit-map"})}}>Fit</button>
            <button
              class="labels"
              type="button"
              aria-pressed=${String(e.labelsVisible)}
              @click=${()=>this.#o({type:"toggle-labels"})}
            >Labels</button>
          `}
          <button
            class="full-map"
            type="button"
            aria-label="Full map"
            aria-pressed=${String(e.fullMap)}
            @click=${this.#n}
          >${e.fullMap?"Close":"Full map"}</button>
        </nav>`:u}

        ${e.workflow!=="draw"&&n?f`
          <div class="view-switch" aria-label="Map view">
            <button
              type="button"
              aria-pressed=${String(e.view==="three")}
              @click=${()=>this.#o({type:"set-view",view:"three"})}
            >3D</button>
            <button
              type="button"
              aria-pressed=${String(e.view==="top")}
              @click=${()=>this.#o({type:"set-view",view:"top"})}
            >2D</button>
          </div>
        `:u}

        <div
          class="scene-window"
          data-renderer-key="persistent-canvas-v4"
          ?hidden=${!n}
          aria-hidden="true"
        >
          <canvas class="scene-canvas"></canvas>
          <canvas class="overlay-canvas"></canvas>
        </div>

        ${i?f`
          <div class="map-scale" aria-label=${`Scale ${t.label}`}>
            <span class="scale-line" style=${`--scale-width:${t.pixels}px`}></span>
            <span>${t.label}</span>
          </div>
          <div class="draw-tools" role="toolbar" aria-label="Draw area tools">
            ${["paint","erase","pan"].map(l=>f`
              <button
                type="button"
                role="radio"
                aria-checked=${String(e.draw.tool===l)}
                data-tool=${l}
                @click=${()=>this.#o({type:"set-draw-tool",tool:l})}
              >${l==="paint"?"\u270E Paint":l==="erase"?"\u232B Erase":"\u2725 Pan"}</button>
            `)}
            <button
              type="button"
              ?disabled=${e.draw.strokeCount===0}
              @click=${()=>this.#o({type:"undo-draft"})}
            >↶ Undo</button>
            <button
              type="button"
              ?disabled=${e.draw.redo.length===0}
              @click=${()=>this.#o({type:"redo-draft"})}
            >↷ Redo</button>
            <button type="button" @click=${()=>this.#d("review-area")}>✓ Done</button>
          </div>
        `:u}

        ${o&&!(e.fullMap&&(a||!e.host.administrator))?f`
          <div class="map-message" role="status">
            <strong>${o.title}</strong>
            <span>${o.detail}</span>
          </div>
        `:u}
        <div class="sr-only" aria-live="polite" aria-atomic="true">
          ${Ye(e)}
        </div>
      </section>
    `}};customElements.get("matic-map-canvas-v4")||customElements.define("matic-map-canvas-v4",ge);var we=class extends g{constructor(){super(...arguments);this.compact=!1}static{this.properties={state:{attribute:!1},compact:{type:Boolean,reflect:!0}}}static{this.styles=N`
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
  `}#t(t){this.dispatchEvent(new CustomEvent(ve,{detail:t,bubbles:!0,composed:!0}))}#e(t,o){let n=t.currentTarget.valueAsNumber;Number.isFinite(n)&&this.#t(o==="zoom"?{type:"set-zoom",value:n}:{type:"set-brush",value:n})}render(){let{draw:t}=this.state;return f`
      <div class="controls" aria-label="Drawing precision">
        <div class="row">
          <label for="zoom">Map zoom</label>
          <div class="stepper">
            <button
              type="button"
              aria-label="Zoom out"
              @click=${()=>this.#t({type:"step-zoom",factor:.8})}
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
                @change=${o=>this.#e(o,"zoom")}
                aria-label="Map zoom percent"
              />
              <span class="unit">%</span>
            </span>
            <button
              type="button"
              aria-label="Zoom in"
              @click=${()=>this.#t({type:"step-zoom",factor:1.25})}
            >+</button>
          </div>
        </div>

        <div class="row">
          <label for="brush">Brush width</label>
          <div class="stepper">
            <button
              type="button"
              aria-label="Narrower brush"
              @click=${()=>this.#t({type:"set-brush",value:t.brushMeters/1.25})}
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
                @change=${o=>this.#e(o,"brush")}
                aria-label="Brush width in meters"
              />
              <span class="unit">m</span>
            </span>
            <button
              type="button"
              aria-label="Wider brush"
              @click=${()=>this.#t({type:"set-brush",value:t.brushMeters*1.25})}
            >+</button>
          </div>
        </div>
        <p class="hint">Strokes follow the verified map resolution. Zoom changes the view, not the saved outline.</p>
      </div>
    `}};customElements.get("matic-precision-controls-v4")||customElements.define("matic-precision-controls-v4",we);export{C as a,K as b,L as c,Y as d,oe as e,wt as f,xe as g,je as h,Ge as i,Qe as j,Me as k,ke as l,W as m,Se as n,Z as o,R as p,kt as q,St as r,Ct as s,Ce as t,At as u,N as v,f as w,u as x,g as y,ve as z,vt as A};
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
