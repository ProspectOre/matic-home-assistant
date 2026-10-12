import{a as be}from"./chunk-L62ENE4N.js";import{A as Te,F as Le,R as S,a as fe,b as ve,c as ie,f as ye,o as we,p as ge,q as _e,r as xe,s as Ce,t as ke,u as Me,v as Pe,w as Se,x as Ee,y as Re,z as Ae}from"./chunk-MUP5DRAA.js";import{H as ue,J as pe,K as y,O as _,Q as me,c as J,d as ee,n as he,u as te,w as X,x as ne,y as G,z as A}from"./chunk-SPPO3SA7.js";var Be=import.meta.url.match(/\/matic_robot\/[^/]+-([a-f0-9]{12})\/map-studio-v4(?:\/|$)/u)?.[1]??"dev",N=Be==="dev"?"":`-${Be}`,oe=`matic-map-canvas-v4${N}`,Ft=`matic-precision-controls-v4${N}`,Dt=`matic-map-workflow-v4${N}`,Nt=`matic-map-shell-v4${N}`,Ot=`matic-map-panel-v0-4-0${N}`;var rt=2e4,W=class{constructor(e,n){this.status="idle";this.#r=e,this.#t=n}#r;#t;#i;request(){return this.#i??=this.#a(),this.#i}async#a(){this.status="loading";let e;try{this.value=await Promise.race([this.#t(),new Promise((n,t)=>{e=setTimeout(t,rt)})]),this.status="ready"}catch{this.status="failed"}return clearTimeout(e),this.#r.requestUpdate(),this.value}},at=()=>location.reload(),Ht=(r,e)=>r==="failed"?y`<div class="problem" role="alert">
      <p>${e("v4_workflow_load_failed","Workspace tools could not be loaded.")}</p>
      <button class="ms-btn ms-btn--secondary" type="button" @click=${at}>${e("v4_retry","Try again")}</button>
    </div>`:y`<p class="loading" role="status">${e("v4_workflow_loading","Loading workspace tools\u2026")}</p>`;var st=["outline","paint","erase","pan"],ze=(r,e,n)=>{let{draw:t}=r,o=`${t.brushMeters.toFixed(2)} m`;return y`
    <div
      class=${`draw-tools draw-tools--${n} ms-segment`}
      data-zone=${String(t.tool==="outline")}
      role="toolbar"
      aria-label=${e.t("v4_draw_tools","Draw area tools")}
      data-map-control
    >
      ${st.map(i=>y`
        <button
          class="ms-btn"
          type="button"
          aria-pressed=${String(t.tool===i)}
          data-tool=${i}
          @click=${()=>e.intent({type:"set-draw-tool",tool:i})}
        >${S(i==="outline"?Le:i==="paint"?Ee:i==="erase"?Ae:Te)}<span class="ms-btn__label">${i==="outline"?e.t("v4_zone_tool","Points"):i==="paint"?e.t("area_paint","Paint"):i==="erase"?e.t("area_erase","Erase"):e.t("move_map","Move map")}</span></button>
      `)}
      <button
        class="ms-btn"
        type="button"
        ?disabled=${t.strokeCount===0}
        @click=${()=>e.intent({type:"undo-draft"})}
      >${S(Pe)}<span class="ms-btn__label">${e.t("undo","Undo")}</span></button>
      <button
        class="ms-btn"
        type="button"
        ?disabled=${t.redo.length===0}
        @click=${()=>e.intent({type:"redo-draft"})}
      >${S(Se)}<span class="ms-btn__label">${e.t("redo","Redo")}</span></button>
      ${t.tool!=="outline"?y`<button
        class="ms-btn draw-brush"
        type="button"
        aria-label=${e.t("v4_brush_button","Brush width, {brush}. Opens brush settings.",{brush:o})}
        aria-expanded=${String(r.precisionOpen)}
        aria-haspopup="dialog"
        @click=${e.openBrush}
      >${S(Re)}<span class="ms-btn__label">${e.t("v4_brush","Brush {brush}",{brush:o})}</span></button>`:_}
    </div>
  `};var lt=r=>r.matches(":disabled, [aria-disabled='true']"),O=class{#r;#t;#i=null;#a=null;constructor(e,n){this.#r=e,this.#t=n,e.addController(this)}hostConnected(){this.#r.addEventListener("focusin",this.#d)}hostDisconnected(){this.#r.removeEventListener("focusin",this.#d),this.#i?.removeEventListener("keydown",this.#u),this.#i=null,this.#a=null}hostUpdated(){let e=this.#t.container();e!==this.#i&&(this.#i?.removeEventListener("keydown",this.#u),e?.addEventListener("keydown",this.#u),this.#i=e),this.#s()}#x(){let e=this.#i;return e?[...e.querySelectorAll(this.#t.items)].filter(n=>!lt(n)):[]}#s(){let e=this.#x(),n=(this.#a&&e.includes(this.#a)?this.#a:null)??e.find(o=>o.matches("[aria-pressed='true'], [aria-checked='true']"))??e[0]??null;this.#a=n;let t=this.#i?.querySelectorAll(this.#t.items)??[];for(let o of t)o.tabIndex=o===n?0:-1}#d=e=>{let n=e.composedPath()[0];!(n instanceof HTMLElement)||!this.#i?.contains(n)||n.matches(this.#t.items)&&(this.#a=n,this.#s())};#u=e=>{if(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey)return;let n=this.#t.orientation??"horizontal",t=n!=="vertical",o=n!=="horizontal",i=this.#x();if(!i.length)return;let a=e.composedPath()[0],s=Math.max(0,i.findIndex(p=>p===this.#a||a instanceof Node&&p.contains(a))),l,c=this.#i&&getComputedStyle(this.#i).direction==="rtl"?-1:1;switch(e.key){case"ArrowLeft":if(!t)return;l=s-c;break;case"ArrowRight":if(!t)return;l=s+c;break;case"ArrowUp":if(!o)return;l=s-1;break;case"ArrowDown":if(!o)return;l=s+1;break;case"Home":l=0;break;case"End":l=i.length-1;break;default:return}e.preventDefault();let d=i[(l+i.length)%i.length];d&&(this.#a=d,this.#s(),d.focus())}};var $e={accent:["--ms-accent","Highlight",[6,120,206]],onAccent:["--ms-on-accent","HighlightText",[255,255,255]],text:["--ms-text","CanvasText",[38,50,56]],quiet:["--ms-text-quiet","GrayText",[75,92,105]],plate:["--ms-surface-card","Canvas",[250,252,253]],roomFill:["--ms-surface-sunken","Canvas",[231,238,242]]},ct=r=>Math.max(0,Math.min(255,Math.round(r))),Ie=r=>{let e=r.trim(),n=e.match(/^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i)?.[1];if(n){let d=n.length<=4?[n[0],n[1],n[2]].map(u=>Number.parseInt(`${u}${u}`,16)):[n.slice(0,2),n.slice(2,4),n.slice(4,6)].map(u=>Number.parseInt(u,16)),[p,h,m]=d;return p===void 0||h===void 0||m===void 0?null:[p,h,m]}let t=e.startsWith("color(srgb"),o=e.slice(e.indexOf("(")+1).match(/-?\d*\.?\d+/g);if(!o||o.length<3)return null;let i=t?255:1,a=o.slice(0,3).map(d=>ct(Number(d)*i)),[s,l,c]=a;return s===void 0||l===void 0||c===void 0||[s,l,c].some(d=>Number.isNaN(d))?null:[s,l,c]},M=(r,e)=>`rgba(${r[0]},${r[1]},${r[2]},${e})`,Fe=r=>{let e=window.matchMedia?.("(forced-colors: active)").matches??!1;if(!e){let o=document.createElement("span"),i=document.createElement("canvas");i.width=1,i.height=1;let a=i.getContext("2d",{colorSpace:"srgb",willReadFrequently:!0});o.setAttribute("aria-hidden","true"),o.style.cssText="position:absolute;inline-size:0;block-size:0;overflow:hidden;visibility:hidden;pointer-events:none",r.append(o);let s=l=>{let[c,,d]=$e[l];o.style.color=`var(${c}, transparent)`;let p=getComputedStyle(o).color;if(a){a.clearRect(0,0,1,1),a.fillStyle="transparent",a.fillStyle=p,a.fillRect(0,0,1,1);let[h,m,u,x]=a.getImageData(0,0,1,1).data;if(h!==void 0&&m!==void 0&&u!==void 0&&x!==void 0&&x!==0)return[h,m,u]}return Ie(p)??d};try{return{accent:s("accent"),onAccent:s("onAccent"),text:s("text"),quiet:s("quiet"),plate:s("plate"),roomFill:s("roomFill"),forced:e}}finally{o.remove()}}let n=document.createElement("span");n.setAttribute("aria-hidden","true"),n.style.cssText="position:absolute;inline-size:0;block-size:0;overflow:hidden;visibility:hidden;pointer-events:none",r.append(n);let t=o=>{let[,i,a]=$e[o];return n.style.color=i,Ie(getComputedStyle(n).color)??a};try{return{accent:t("accent"),onAccent:t("onAccent"),text:t("text"),quiet:t("quiet"),plate:t("plate"),roomFill:t("roomFill"),forced:e}}finally{n.remove()}};var De=(r,e)=>Math.hypot(r.x-e.x,r.y-e.y),Ne=(r,e)=>({x:(r.x+e.x)/2,y:(r.y+e.y)/2}),Oe=(r,e)=>Math.atan2(e.y-r.y,e.x-r.x),dt=r=>{let e=r;for(;e>Math.PI;)e-=Math.PI*2;for(;e<-Math.PI;)e+=Math.PI*2;return e},z=(r,e,n)=>Math.max(e,Math.min(n,r)),qe=r=>r.map(e=>({...e})),ht="button, input, select, textarea, a, [contenteditable='true'], [role='button'], [role='menuitem'], [data-map-control]",L=r=>r.composedPath().some(e=>e instanceof Element&&e.matches(ht)),Ue=r=>r.composedPath().some(e=>e instanceof Element&&e.matches("select")),V=class{#r;#t;#i;#a=new Map;#x=!1;#s="idle";#d=[];#u=null;#l=0;#m=null;#P=0;#e=null;#w=null;#z=null;#$=0;#S=null;#g=!1;#c=null;#h=null;#n=!1;constructor(e,n,t){this.#r=e,this.#t=n,this.#i=t,e.addEventListener("pointerdown",this.#b),e.addEventListener("pointermove",this.#E),e.addEventListener("pointerup",this.#f),e.addEventListener("pointercancel",this.#f),e.addEventListener("wheel",this.#L,{passive:!1}),e.addEventListener("gesturestart",this.#I,{passive:!1}),e.addEventListener("gesturechange",this.#q,{passive:!1}),e.addEventListener("gestureend",this.#o,{passive:!1}),e.addEventListener("dblclick",this.#D),e.addEventListener("contextmenu",this.#M),e.addEventListener("keydown",this.#k),e.addEventListener("keyup",this.#y),e.addEventListener("blur",this.#F)}#b=e=>{if(this.#n)return;let n=this.#i.state();if(!n.pageActive){this.observeState(n);return}if(!e.isPrimary&&e.pointerType==="mouse"||L(e))return;this.observeState(n),this.#r.focus({preventScroll:!0}),this.#p(),e.pointerType==="touch"&&!e.isPrimary&&this.#a.size===0&&this.#i.state().draw.tool==="outline"&&(this.#g=!0);let t=performance.now(),o={id:e.pointerId,type:e.pointerType,startX:e.clientX,startY:e.clientY,x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,lastTime:t,velocityX:0,velocityY:0};if(this.#a.set(e.pointerId,o),this.#r.setPointerCapture?.(e.pointerId),this.#a.size>=2){this.#U(),this.#i.onCirclePreview(null),this.#h=null,this.#s="pinch",this.#r.classList.add("navigating"),this.#g=!0;let[l,c]=[...this.#a.values()];l&&c&&(this.#l=Math.max(1,De(l,c)),this.#m=Ne(l,c),this.#P=Oe(l,c),this.#e=this.#t.camera),e.preventDefault();return}let i=this.#i.state(),a=i.workflow==="draw"&&i.map.available&&!i.floor.readOnly;this.#g||this.#x||e.button===1||e.button===2||i.draw.tool==="pan"?(this.#s="pan",this.#w=this.#t.camera):a&&i.draw.tool==="outline"&&(this.#h=G(i,"outline"))?this.#s="outline":a&&(i.draw.tool==="paint"||i.draw.tool==="erase")&&(this.#h=G(i,i.draw.tool))?(this.#d=qe(this.#h.baselineCircles),e.pointerType==="touch"?(this.#s="idle",this.#c=window.setTimeout(()=>{if(this.#c=null,this.#a.size!==1||this.#g||!A(this.#i.state(),this.#h)){this.#_();return}this.#s=i.draw.tool;let l=this.#a.get(e.pointerId);l&&this.#v(l.x,l.y)},110)):(this.#s=i.draw.tool,this.#v(e.clientX,e.clientY))):(this.#s=i.view==="three"&&!e.shiftKey?"orbit":"pan",this.#w=this.#t.camera),(this.#s==="pan"||this.#s==="orbit")&&this.#r.classList.add("navigating"),e.preventDefault()};observeState(e){if(!e.pageActive){this.#p(),this.#U(),this.#i.onCirclePreview(null),this.#t.setCursor(null),this.#h=null,this.#d=[],this.#u=null,this.#m=null,this.#e=null,this.#w=null,this.#z=null,this.#$=0,this.#x=!1,this.#g=!1,this.#s="idle",this.#r.classList.remove("navigating");for(let n of this.#a.keys())this.#r.hasPointerCapture?.(n)&&this.#r.releasePointerCapture?.(n);this.#a.clear();return}this.#h&&!A(e,this.#h)&&this.#_()}#_(){if(this.#U(),this.#i.onCirclePreview(null),this.#h=null,this.#d=[],this.#u=null,this.#s==="paint"||this.#s==="erase"||this.#s==="outline"||this.#s==="idle"){this.#s="idle",this.#g=!1,this.#r.classList.remove("navigating");for(let e of this.#a.keys())this.#r.releasePointerCapture?.(e);this.#a.clear()}}#E=e=>{let n=this.#i.state();if(!n.pageActive){this.observeState(n);return}if(this.#h&&!A(this.#i.state(),this.#h)){this.#_();return}let t=this.#a.get(e.pointerId);if(!t){let p=this.#t.screenToMap(e.clientX,e.clientY);this.#t.setCursor(p);return}let i=(e.getCoalescedEvents?.()||[]).at(-1)||e,a=performance.now(),s=Math.max(1,a-t.lastTime),l=(i.clientX-t.lastX)/s,c=(i.clientY-t.lastY)/s;if(t.velocityX=t.velocityX*.62+l*.38,t.velocityY=t.velocityY*.62+c*.38,t.lastX=i.clientX,t.lastY=i.clientY,t.lastTime=a,t.x=i.clientX,t.y=i.clientY,this.#s==="pinch"&&this.#a.size>=2){let[p,h]=[...this.#a.values()];if(!p||!h)return;let m=Math.max(1,De(p,h)),u=Ne(p,h),x=Oe(p,h),g=this.#e;if(g&&this.#m){let E={...g,distance:g.distance*this.#l/m,yaw:g.yaw+dt(x-this.#P),pitch:g.orthographic?g.pitch:g.pitch-(u.y-this.#m.y)*.0035};this.#t.setCamera(this.#t.cameraAfterPan(E,u.x-this.#m.x,u.y-this.#m.y))}e.preventDefault();return}this.#s==="paint"||this.#s==="erase"?this.#v(e.clientX,e.clientY):this.#s==="pan"?this.#w&&this.#t.setCamera(this.#t.cameraAfterPan(this.#w,i.clientX-t.startX,i.clientY-t.startY)):this.#s==="orbit"&&this.#w&&this.#t.setCamera({...this.#w,yaw:this.#w.yaw+(i.clientX-t.startX)*.0045,pitch:this.#w.pitch-(i.clientY-t.startY)*.004});let d=this.#t.screenToMap(i.clientX,i.clientY);this.#t.setCursor(d),e.preventDefault()};#f=e=>{let n=this.#i.state();if(!n.pageActive){this.observeState(n);return}if(this.#h&&!A(this.#i.state(),this.#h)){this.#_();return}let t=this.#a.get(e.pointerId);if(!t)return;let o=this.#s;if(this.#a.delete(e.pointerId),this.#r.releasePointerCapture?.(e.pointerId),this.#U(),this.#s==="outline"&&e.type!=="pointercancel"&&A(this.#i.state(),this.#h)&&Math.hypot(t.x-t.startX,t.y-t.startY)<7){let i=this.#t.screenToMap(t.x,t.y);i&&this.#i.onOutlinePoint?.(i,this.#h)}if(e.type!=="pointercancel"&&(this.#s==="paint"||this.#s==="erase")&&A(this.#i.state(),this.#h)&&JSON.stringify(this.#d)!==JSON.stringify(this.#h.baselineCircles))this.#i.onCircles(this.#d,this.#h);else if(e.type!=="pointercancel"&&this.#s!=="pinch"&&!this.#g&&Math.hypot(t.x-t.startX,t.y-t.startY)<7&&["rooms","plan"].includes(this.#i.state().workflow)&&ne(this.#i.state())){let i=this.#t.roomAt(t.x,t.y);i&&this.#i.onRoom(i)}if((this.#s==="paint"||this.#s==="erase")&&this.#i.onCirclePreview(null),this.#a.size===0)this.#s="idle",this.#h=null,this.#r.classList.remove("navigating"),this.#g=!1,this.#m=null,this.#e=null,this.#w=null,this.#u=null,(o==="pan"||o==="orbit")&&t.type!=="mouse"&&this.#A(t.velocityX,t.velocityY,o);else if(this.#s==="pinch"){this.#s="pan",this.#g=!0;let i=this.#a.values().next().value;i&&(i.startX=i.x,i.startY=i.y,i.velocityX=0,i.velocityY=0),this.#w=this.#t.camera,this.#e=null}e.preventDefault()};#v(e,n){if(!A(this.#i.state(),this.#h)){this.#_();return}let t=this.#t.screenToMap(e,n);if(!t)return;let i=this.#i.state().draw.brushMeters/2;if(this.#s==="erase")this.#d=this.#d.filter(a=>Math.hypot(a.x-t.x,a.y-t.y)>a.radius+i);else{if(!this.#t.containsMapPoint(t))return;let a=Math.max(.04,i*.55),s=this.#u||t,l=Math.hypot(t.x-s.x,t.y-s.y),c=Math.max(1,Math.ceil(l/a));for(let d=0;d<=c&&this.#d.length<512;d+=1){let p=d/c,h={x:s.x+(t.x-s.x)*p,y:s.y+(t.y-s.y)*p};this.#d.some(m=>Math.hypot(m.x-h.x,m.y-h.y)<Math.max(.025,i*.28))||this.#d.push({x:Math.round(h.x*1e4)/1e4,y:Math.round(h.y*1e4)/1e4,radius:Math.round(i*100)/100})}}this.#u=t,this.#i.onCirclePreview(this.#d,this.#h)}#L=e=>{if(this.#n||!this.#i.state().pageActive||L(e))return;e.preventDefault(),this.#r.focus({preventScroll:!0}),this.#p();let n=e.deltaMode===WheelEvent.DOM_DELTA_LINE?16:e.deltaMode===WheelEvent.DOM_DELTA_PAGE?Math.max(1,this.#r.clientHeight):1,t=e.deltaX*n,o=e.deltaY*n;if(e.ctrlKey||e.metaKey){this.#t.zoomAt(Math.exp(z(-o*.008,-.28,.28)),e.clientX,e.clientY);return}if(e.altKey&&this.#i.state().view==="three"){this.#t.orbitBy(0,z(o,-80,80)*.75);return}if(e.deltaMode!==WheelEvent.DOM_DELTA_PIXEL||Math.abs(t)<.5&&Math.abs(o)>=50){this.#t.zoomAt(Math.exp(z(-o*.0025,-.28,.28)),e.clientX,e.clientY);return}this.#t.panBy(-z(t,-80,80),-z(o,-80,80))};#I=e=>{this.#n||!this.#i.state().pageActive||L(e)||(this.#r.focus({preventScroll:!0}),this.#p(),this.#r.classList.add("navigating"),this.#z=this.#t.camera,this.#$=Number.isFinite(e.rotation)?e.rotation:0,e.preventDefault())};#q=e=>{if(this.#n||!this.#i.state().pageActive||L(e))return;let n=this.#z;if(!n||this.#a.size>=2)return;let t=Number.isFinite(e.scale)&&e.scale>0?Math.max(.1,e.scale):1,o=Number.isFinite(e.rotation)?e.rotation:0;this.#t.setCamera({...n,distance:n.distance/t,yaw:n.yaw+(o-this.#$)*Math.PI/180}),e.preventDefault()};#o=e=>{if(!this.#i.state().pageActive){this.observeState(this.#i.state());return}let n=this.#z!==null;this.#z=null,this.#$=0,this.#r.classList.remove("navigating"),n&&!L(e)&&e.preventDefault()};#T(e){let n=this.#i.state();if(e.repeat||this.#n||this.#a.size||e.composedPath()[0]!==this.#r||!this.#r.matches(":focus")||n.workflow!=="draw"||!ne(n)||n.command!=="idle"&&n.command!=="failed"||n.draw.tool!=="paint"&&n.draw.tool!=="erase"&&n.draw.tool!=="outline")return;let o=this.#r.querySelector(".scene-canvas")?.getBoundingClientRect();if(!o?.width||!o.height)return;let i=G(n,n.draw.tool);if(i){if(e.preventDefault(),this.#p(),n.draw.tool==="outline"){let a=this.#t.screenToMap(o.left+o.width/2,o.top+o.height/2);a&&this.#i.onOutlinePoint?.(a,i);return}this.#d=qe(i.baselineCircles),this.#u=null,this.#h=i,this.#s=n.draw.tool,this.#v(o.left+o.width/2,o.top+o.height/2),this.#s="idle",this.#u=null,this.#h=null,this.#i.onCirclePreview(null),JSON.stringify(this.#d)!==JSON.stringify(i.baselineCircles)&&this.#i.onCircles(this.#d,i)}}#k=e=>{if(this.#n||!this.#i.state().pageActive||L(e)||e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey)return;if(e.key==="Enter"){this.#T(e);return}if(e.code==="Space"){this.#x=!0,e.preventDefault();return}this.#p();let n=this.#i.state(),t=e.key.toLocaleLowerCase();if(e.key==="+"||e.key==="=")this.#t.zoomAt(1.25);else if(e.key==="-")this.#t.zoomAt(.8);else if(e.key==="0")this.#t.fit();else if(t==="3")this.#R({type:"set-view",view:"three"});else if(t==="t")this.#R({type:"set-view",view:"top"});else if(e.key==="[")this.#t.orbitBy(-40,0);else if(e.key==="]")this.#t.orbitBy(40,0);else if(e.key==="PageUp")this.#t.orbitBy(0,-30);else if(e.key==="PageDown")this.#t.orbitBy(0,30);else if(t==="d"&&n.workflow==="draw")this.#R({type:"set-draw-tool",tool:"paint"});else if(t==="e"&&n.workflow==="draw")this.#R({type:"set-draw-tool",tool:"erase"});else if(["arrowleft","arrowright","arrowup","arrowdown"].includes(t))if(n.view==="three"&&!e.shiftKey){let o=t==="arrowleft"?-24:t==="arrowright"?24:0,i=t==="arrowup"?-20:t==="arrowdown"?20:0;this.#t.orbitBy(o,i)}else{let o=t==="arrowleft"?30:t==="arrowright"?-30:0,i=t==="arrowup"?30:t==="arrowdown"?-30:0;this.#t.panBy(o,i)}else if(n.workflow!=="draw"&&["w","a","s","d"].includes(t))this.#t.panBy(t==="a"?34:t==="d"?-34:0,t==="w"?34:t==="s"?-34:0);else if(n.workflow!=="draw"&&(t==="q"||t==="e"))this.#t.orbitBy(t==="q"?-30:30,0);else return;e.preventDefault()};#y=e=>{e.code==="Space"&&(this.#x=!1)};#F=()=>{this.#x=!1,this.#_(),this.#t.setCursor(null),this.#r.classList.remove("navigating")};#D=e=>{this.#n||!this.#i.state().pageActive||L(e)||(this.#p(),this.#t.zoomAt(e.shiftKey?1/1.6:1.6,e.clientX,e.clientY),e.preventDefault())};#M=e=>{L(e)||e.preventDefault()};#R(e){this.#r.dispatchEvent(new CustomEvent("matic-workspace-intent",{detail:e,bubbles:!0,composed:!0}))}#A(e,n,t){if(window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;let o=z(e,-.55,.55),i=z(n,-.55,.55);if(Math.hypot(o,i)<.02)return;let a=performance.now(),s=l=>{let c=Math.min(32,l-a);a=l,t==="orbit"?this.#t.orbitBy(o*c,i*c):this.#t.panBy(o*c,i*c);let d=.9**(c/16);o*=d,i*=d,Math.hypot(o,i)>=.01?this.#S=window.requestAnimationFrame(s):this.#S=null};this.#S=window.requestAnimationFrame(s)}#p(){this.#S!==null&&window.cancelAnimationFrame(this.#S),this.#S=null}#U(){this.#c!==null&&window.clearTimeout(this.#c),this.#c=null}dispose(){this.#n||(this.#_(),this.#n=!0,this.#p(),this.#r.removeEventListener("pointerdown",this.#b),this.#r.removeEventListener("pointermove",this.#E),this.#r.removeEventListener("pointerup",this.#f),this.#r.removeEventListener("pointercancel",this.#f),this.#r.removeEventListener("wheel",this.#L),this.#r.removeEventListener("gesturestart",this.#I),this.#r.removeEventListener("gesturechange",this.#q),this.#r.removeEventListener("gestureend",this.#o),this.#r.removeEventListener("dblclick",this.#D),this.#r.removeEventListener("contextmenu",this.#M),this.#r.removeEventListener("keydown",this.#k),this.#r.removeEventListener("keyup",this.#y),this.#r.removeEventListener("blur",this.#F),this.#a.clear())}};var en="/api/matic_robot/slam_entries",tn=24,nn=8,ut=15e5,on=16*1024*1024,rn=36,an=16*1024*1024,He=65536,f=class extends Error{constructor(e){super(e),this.name="ContractError",this.code=e}},b=(r,e)=>{if(!r||typeof r!="object"||Array.isArray(r))throw new f(e);return r},v=(r,e,n)=>{if(typeof r!="string")throw new f(n);let t=r.trim();if(!t||Array.from(t).length>e||/[\u0000-\u001f\u007f]/u.test(t))throw new f(n);return t},pt=r=>{if(r==null||r==="")return null;try{return v(r,128,"invalid-floor-label")}catch{return null}},F=(r,e,n,t)=>{if(typeof r!="number"||!Number.isFinite(r)||r<e||r>n)throw new f(t);return r},C=(r,e,n,t)=>{let o=F(r,e,n,t);if(!Number.isInteger(o))throw new f(t);return o},re=(r,e)=>r==null?null:C(r,1,e,"invalid-floor-ordinal"),w=(r,e)=>{if(typeof r!="boolean")throw new f(e);return r},q=(r,e)=>r===void 0?!1:w(r,e),mt=(r,e)=>r===null?null:w(r,e),Xe=r=>{if(r==null)return null;let e=v(r,64,"invalid-map-session-key");if(!/^[0-9a-f]{64}$/u.test(e))throw new f("invalid-map-session-key");return e},ft=r=>{if(r==null)return null;if(r==="bootstrap_empty"||r==="map_session_unverified"||r==="floor_plan_unavailable"||r==="floor_plan_mismatch")return r;throw new f("invalid-map-block-reason")},vt=r=>{if(r===void 0)return"not_started";if(r==="not_started"||r==="running"||r==="complete"||r==="partial"||r==="failed")return r;throw new f("invalid-bootstrap-state")},T=(r,e)=>{let n=v(r,512,e);if(!n.startsWith("/")||n.startsWith("//")||n.includes("\\"))throw new f(e);return n},bt=r=>{let e=typeof r.map_health=="string"?r.map_health.toLowerCase():"",n=typeof r.stream_state=="string"?r.stream_state.toLowerCase():"",t=typeof r.invalid_tiles=="number"?r.invalid_tiles:0;return e.includes("error")||e.includes("fail")||e.includes("degrad")||t>0?"problem":r.map_truncated===!0||e.includes("truncat")||e.includes("limit")?"limited":r.map_complete===!0?"ready":n.includes("connect")||n.includes("collect")||n.includes("run")?"building":"unknown"},sn=r=>{let e=b(r,"invalid-catalog");if(!Array.isArray(e.entries)||e.entries.length>64)throw new f("invalid-catalog-entries");return e.entries.map(n=>{let t=b(n,"invalid-catalog-entry"),o=C(t.map_revision,0,Number.MAX_SAFE_INTEGER,"invalid-map-revision");return{entryId:v(t.entry_id,128,"invalid-entry-id"),liveWorkspaceTransportEnabled:q(t.live_workspace_transport_enabled,"invalid-live-workspace-transport"),sceneUrl:T(t.scene_url,"invalid-scene-url"),deltaUrl:t.delta_url===void 0||t.delta_url===null?null:T(t.delta_url,"invalid-delta-url"),poseUrl:T(t.pose_url,"invalid-pose-url"),historyUrl:T(t.history_url,"invalid-history-url"),areasUrl:T(t.areas_url,"invalid-areas-url"),plansUrl:T(t.plans_url,"invalid-plans-url"),mapRevision:o,mapFloorCoherent:w(t.map_floor_coherent,"invalid-floor-coherence"),mapSessionVerified:w(t.map_session_verified,"invalid-session-state"),mapSessionKey:Xe(t.map_session_key),mapBlockReason:ft(t.map_block_reason),runnerLocked:w(t.runner_locked,"invalid-runner-lock"),stopSettlePending:w(t.stop_settle_pending,"invalid-stop-settle"),activePlan:w(t.active_plan,"invalid-active-plan"),nativeReconciliationPending:w(t.native_reconciliation_pending,"invalid-native-reconciliation"),nativeSessionActive:mt(t.native_session_active,"invalid-native-session"),mapComplete:w(t.map_complete,"invalid-map-complete"),mapTruncated:w(t.map_truncated,"invalid-map-truncated"),selectedFloorOrdinal:re(t.selected_floor_ordinal,128),mapFloorOrdinal:re(t.map_floor_ordinal,128),historyCount:C(t.history_count,0,12,"invalid-history-count"),historyFloorCount:C(t.history_floor_count,0,128,"invalid-floor-count"),health:bt(t),streamFailures:C(t.stream_failures,0,Number.MAX_SAFE_INTEGER,"invalid-stream-failures"),bootstrapState:vt(t.bootstrap_state),bootstrapPhotoSeen:t.bootstrap_photo_seen===void 0?!1:w(t.bootstrap_photo_seen,"invalid-bootstrap-photo"),bootstrapStructureSeen:t.bootstrap_structure_seen===void 0?!1:w(t.bootstrap_structure_seen,"invalid-bootstrap-structure"),bootstrapFailures:t.bootstrap_failures===void 0?0:C(t.bootstrap_failures,0,2,"invalid-bootstrap-failures")}})},Ge=(r,e)=>{if(!Array.isArray(r)||r.length!==2)throw new f(e);return[F(r[0],-1e6,1e6,e),F(r[1],-1e6,1e6,e)]},yt=(r,e)=>{if(!Array.isArray(r)||r.length<3||r.length>8192)throw new f(e);return r.map(n=>Ge(n,e))},We=(r,e)=>{if(!Array.isArray(r)||r.length>256)throw new f("invalid-rooms");return r.map(n=>{let t=b(n,"invalid-room");return{roomId:v(t.room_id,128,"invalid-room-id"),name:v(t.name,128,"invalid-room-name"),boundary:e?yt(t.boundary,"invalid-room-boundary"):[]}})},wt=r=>{let e=b(r,"invalid-history-snapshot"),n=v(e.created_at,64,"invalid-history-time");if(!Number.isFinite(Date.parse(n)))throw new f("invalid-history-time");return{id:v(e.id,128,"invalid-history-id"),createdAt:n,revision:C(e.revision,0,Number.MAX_SAFE_INTEGER,"invalid-history-revision"),pointCount:C(e.point_count,1,ut,"invalid-history-points"),sceneUrl:T(e.scene_url,"invalid-history-scene-url")}},ln=r=>{let e=b(r,"invalid-history");if(!Array.isArray(e.floors)||e.floors.length<1||e.floors.length>128)throw new f("invalid-history-floors");return{entryId:v(e.entry_id,128,"invalid-history-entry"),liveAvailable:w(e.live_available,"invalid-history-live"),floors:e.floors.map(n=>{let t=b(n,"invalid-history-floor");if(!Array.isArray(t.snapshots)||t.snapshots.length>12)throw new f("invalid-history-snapshots");return{id:v(t.id,128,"invalid-history-floor-id"),active:w(t.active,"invalid-history-floor-active"),readOnly:w(t.read_only,"invalid-history-floor-read-only"),liveAvailable:t.live_available===void 0?!1:w(t.live_available,"invalid-history-floor-live"),label:pt(t.label),ordinal:t.ordinal===void 0?null:re(t.ordinal,128),snapshots:t.snapshots.map(wt)}})}},K=r=>{if(r==="vacuum"||r==="mop"||r==="vacuum_and_mop")return r;throw new f("invalid-cleaning-mode")},U=r=>{if(r==="quick"||r==="standard"||r==="heavy_duty")return r;throw new f("invalid-coverage-setting")},Y=(r,e)=>r==null?null:C(r,1,100,e),Z=r=>{if(r==null)return[];let e=["coverage_requires_vacuum","mop_due","coverage_due","room_not_on_current_map","identity_changed","shared_schedule_unavailable","mop_progress_unverified","coverage_progress_unverified","invalid_cadence_policy"];if(!Array.isArray(r)||r.length>e.length||r.some(n=>!e.includes(n)))throw new f("invalid-cadence-reasons");return[...new Set(r)]},Ve=r=>{if(r==null)return;let e=b(r,"invalid-room-cadence"),n=e.scope===void 0?"plan":e.scope;if(n!=="plan"&&n!=="shared")throw new f("invalid-room-cadence-scope");let t=e.periodic_coverage_setting;return{scope:n,mopEveryN:Y(e.mop_every_n,"invalid-mop-interval"),coverageEveryN:Y(e.coverage_every_n,"invalid-coverage-interval"),periodicCoverageSetting:t==null?null:U(t),doMopNext:q(e.do_mop_next,"invalid-do-mop-next"),doCoverageNext:q(e.do_coverage_next,"invalid-do-coverage-next")}},ae=(r,e)=>{if(r==null)return;let n=b(r,"invalid-room-cadence-progress"),t=n.effective_cleaning_mode,o=n.effective_coverage_setting,i=Z(e??n.cadence_reasons);return{mopProgress:C(n.mop_progress??0,0,100,"invalid-mop-progress"),coverageProgress:C(n.coverage_progress??0,0,100,"invalid-coverage-progress"),mopDue:q(n.mop_due,"invalid-mop-due"),coverageDue:q(n.coverage_due,"invalid-coverage-due"),nextMopIn:Y(n.next_mop_in,"invalid-next-mop"),nextCoverageIn:Y(n.next_coverage_in,"invalid-next-coverage"),reasons:i,...t===void 0?{}:{effectiveCleaningMode:K(t)},...o===void 0?{}:{effectiveCoverageSetting:U(o)}}},gt=r=>{let e=b(r,"invalid-plan-room"),n=Ve(e.cadence),t=ae(e.cadence_progress,e.cadence_reasons),o=Z(e.cadence_reasons);return{roomId:v(e.room_id,128,"invalid-plan-room-id"),cleaningMode:K(e.cleaning_mode),coverageSetting:U(e.coverage_setting),...n===void 0?{}:{cadence:n},...t===void 0?{}:{cadenceProgress:t},...o.length?{cadenceReasons:o}:{}}},Ye=r=>{if(r==null)return;let e=b(r,"invalid-plan-preview");if(!Array.isArray(e.rooms)||e.rooms.length>100||!Array.isArray(e.mission_boundaries)||e.mission_boundaries.length>99)throw new f("invalid-plan-preview");let n=e.rooms.map(s=>{let l=b(s,"invalid-plan-preview-room");return{roomId:v(l.room_id,128,"invalid-plan-preview-room-id"),name:v(l.name,128,"invalid-plan-preview-room-name"),cleaningMode:K(l.cleaning_mode),coverageSetting:U(l.coverage_setting),cadenceReasons:Z(l.cadence_reasons)}}),t=e.mission_boundaries.map(s=>C(s,1,Math.max(1,n.length-1),"invalid-plan-preview-boundary"));if(t.some((s,l)=>s>=n.length||s<=(t[l-1]??0)))throw new f("invalid-plan-preview-boundary-order");let o=["coverage_requires_vacuum","cadence_identity_unavailable","preview_unavailable","plan_disabled","plan_has_no_rooms","plan_room_limit","cadence_identity_changed","shared_schedule_unavailable","cadence_progress_unverified","invalid_cadence_policy","invalid_plan"],i=e.blocker;if(i!==null&&!o.includes(i))throw new f("invalid-plan-preview-blocker");if(i===null&&n.length===0)throw new f("empty-plan-preview");let a=e.preview_token;if(a!==void 0&&(typeof a!="string"||!/^[0-9a-f]{64}$/u.test(a)))throw new f("invalid-plan-preview-token");return{rooms:n,missionBoundaries:t,blocker:i,...typeof a=="string"?{previewToken:a}:{}}},cn=r=>{let e=b(r,"invalid-room-sequence-preview"),n=v(e.entry_id,128,"invalid-room-sequence-preview-entry"),t=v(e.floor_token,128,"invalid-room-sequence-preview-floor"),o=v(e.preview_token,64,"invalid-room-sequence-preview-token");if(!/^[0-9a-f]{64}$/u.test(t)||!/^[0-9a-f]{64}$/u.test(o))throw new f("invalid-room-sequence-preview-token");let i=Ye({rooms:e.rooms,mission_boundaries:e.mission_boundaries,blocker:e.blocker});if(!i)throw new f("invalid-room-sequence-preview");let a=e.rooms;if(!Array.isArray(a))throw new f("invalid-room-sequence-preview-rooms");let s=i.rooms.map((l,c)=>{let d=b(a[c],"invalid-room-sequence-preview-room"),p=ae(d.cadence_progress,d.cadence_reasons);return{...l,...p===void 0?{}:{cadenceProgress:p}}});return{entryId:n,floorToken:t,previewToken:o,rooms:s,missionBoundaries:i.missionBoundaries,blocker:i.blocker}},_t=r=>{if(r==null)return null;if(!Array.isArray(r)||r.length<3||r.length>64)throw new f("invalid-area-outline");let e={closed:!0,points:r.map(n=>{let t=b(n,"invalid-area-outline");if(typeof t.x!="number"||typeof t.y!="number")throw new f("invalid-area-outline");return{x:t.x,y:t.y}})};if(!be(e))throw new f("invalid-area-outline");return e},xt=r=>{let e=b(r,"invalid-area-circle");return{x:F(e.x,-1e6,1e6,"invalid-area-circle"),y:F(e.y,-1e6,1e6,"invalid-area-circle"),radius:F(e.radius,.05,2.5,"invalid-area-circle")}},Ct=r=>r==="current"||r==="review"||r==="stale"?r:"unknown",dn=r=>{let e=b(r,"invalid-areas");if(!Array.isArray(e.areas)||e.areas.length>256)throw new f("invalid-area-list");return{sceneUrl:T(e.scene_url,"invalid-area-scene-url"),rooms:We(e.rooms,!0),areas:e.areas.map(n=>{let t=b(n,"invalid-area");if(!Array.isArray(t.circles)||t.circles.length>512)throw new f("invalid-area-circles");return{id:v(t.id,128,"invalid-area-id"),name:v(t.name,128,"invalid-area-name"),circles:t.circles.map(xt),outline:_t(t.outline),cleaningMode:K(t.cleaning_mode),coverageSetting:U(t.coverage_setting),status:Ct(t.status),canRebind:w(t.can_rebind,"invalid-area-rebind")}})}},hn=r=>{let e=b(r,"invalid-plan-save-response"),n=b(e.response,"invalid-plan-save-response"),t=b(n.plan,"invalid-plan-save-response");return v(t.id,128,"invalid-plan-save-response")},un=r=>{let e=b(r,"invalid-plans");if(!Array.isArray(e.plans)||e.plans.length>256)throw new f("invalid-plan-list");let n=e.rooms;return{rooms:We(n,!1).map((o,i)=>{let a=Array.isArray(n)?n[i]:void 0,s=b(a,"invalid-room"),l=Ve(s.shared_cadence),c=ae(s.shared_cadence_progress,s.shared_cadence_reasons),d=Z(s.shared_cadence_reasons);return{roomId:o.roomId,name:o.name,...l===void 0?{}:{sharedCadence:l},...c===void 0?{}:{sharedCadenceProgress:c},...d.length?{sharedCadenceReasons:d}:{}}}),selectedPlan:e.selected_plan===null||e.selected_plan===void 0?null:v(e.selected_plan,128,"invalid-selected-plan"),plans:e.plans.map(o=>{let i=b(o,"invalid-plan");if(!Array.isArray(i.rooms)||i.rooms.length>256||!Array.isArray(i.room_order))throw new f("invalid-plan-rooms");let a=i.run_behavior;if(a!=="intelligent"&&a!=="ordered")throw new f("invalid-run-behavior");let s=Ye(i.next_run_preview);return{id:v(i.id,128,"invalid-plan-id"),name:v(i.name,128,"invalid-plan-name"),enabled:w(i.enabled,"invalid-plan-enabled"),runBehavior:a,rooms:i.rooms.map(l=>gt(l)),roomOrder:i.room_order.slice(0,256).map(l=>v(l,128,"invalid-room-order")),returnToBase:w(i.return_to_base,"invalid-return-to-base"),finishCurrentRoom:w(i.finish_current_room,"invalid-finish-room"),finishCurrentRoomThreshold:C(i.finish_current_room_threshold,0,100,"invalid-finish-threshold"),...s===void 0?{}:{nextRunPreview:s}}})}},pn=r=>{let e=b(r,"invalid-pose"),n=e.position,t=n===null?null:Ge(n,"invalid-pose-position"),o=e.pose_freshness;if(o!=="live"&&o!=="coordinator_fallback")throw new f("invalid-pose-freshness");return{position:t,source:v(e.source,64,"invalid-pose-source"),revision:C(e.revision,0,Number.MAX_SAFE_INTEGER,"invalid-pose-revision"),poseRevision:C(e.pose_revision,0,Number.MAX_SAFE_INTEGER,"invalid-pose-sequence"),floorCoherent:w(e.map_floor_coherent,"invalid-pose-floor"),mapSessionKey:Xe(e.map_session_key),freshness:o}},mn=r=>{try{return T(r,"invalid-private-path"),!0}catch{return!1}};var P=(r,e,n)=>Math.max(e,Math.min(n,r)),H=r=>{let e=r;for(;e>Math.PI;)e-=Math.PI*2;for(;e<-Math.PI;)e+=Math.PI*2;return e},kt=r=>{switch(r){case"efficient":return .35;case"balanced":return .65;case"maximum":case"auto":return 1}},Ke=r=>{let e=r.metadata.metersPerCell;return[(r.metadata.origin[0]+(r.metadata.span[0]-1)/2)*e,(r.metadata.origin[1]+(r.metadata.span[1]-1)/2)*e]},Je=(r,e,n,t)=>{let o=Ke(n),i=Ke(t);return[r+(i[0]-o[0]),e+(o[1]-i[1])]},Mt=(r,e,n)=>{let[t,o]=Je(r.targetX,r.targetZ,e,n);return{...r,targetX:t,targetZ:o}},et=(r,e)=>{if(!e)return!0;let n=r==="top";return Math.abs(e.zoom-1)<.001&&Math.abs(e.targetX)<.001&&Math.abs(e.targetZ)<.001&&Math.abs(H(e.yaw-(n?0:-Math.PI/4)))<.001&&(n||Math.abs(e.pitch-.82)<.001)},Pt=(r,e,n,t,o)=>Object.fromEntries(Object.entries(r).map(([i,a])=>{if(!a||et(i,a))return[i,a];let[s,l]=Je(a.targetX,a.targetZ,e,n),c=t[i],d=o[i],p=c>0&&d>0?a.zoom*d/c:a.zoom;return[i,{...a,targetX:s,targetZ:l,zoom:p}]})),j=r=>{let e=r.resources.entry;return[r.dataMode,r.selection.entryId??"none",r.selection.floorId,e?.entryId??"none",e?.selectedFloorOrdinal??"none",e?.mapFloorOrdinal??"none",e?.mapSessionKey??"none"].join("|")},le=512*1024,Ze=le/2,$=He,tt=256,St=(r,e)=>r.metadata.metersPerCell===e.metadata.metersPerCell&&r.metadata.origin[0]===e.metadata.origin[0]&&r.metadata.origin[1]===e.metadata.origin[1]&&r.metadata.span[0]===e.metadata.span[0]&&r.metadata.span[1]===e.metadata.span[1],se=(r,e)=>r.pointOffset===e.pointOffset&&r.floorCount===e.floorCount&&r.surfaceCount===e.surfaceCount&&r.total===e.total&&r.source===e.source&&St(r,e),je=(r,e)=>{let n=r.deltaHint;if(!n||n.baseRevision!==e||r.revision<=e||n.blockBytes!==$||n.dirtyBlocks.length>tt)return null;let t=Math.ceil(r.total*8/$),o=-1;for(let i of n.dirtyBlocks){if(!Number.isSafeInteger(i)||i<=o||i>=t)return null;o=i}return n.dirtyBlocks},Et={accent:[6,120,206],onAccent:[255,255,255],text:[38,50,56],quiet:[75,92,105],plate:[250,252,253],roomFill:[231,238,242],forced:!1},nt=Math.PI/3.15,Rt=1.08,At=(r,e)=>{let n=nt/2,t=Math.atan(Math.tan(n)*Math.max(.2,e));return r/Math.sin(Math.min(n,t))*Rt},Tt=(r,e)=>{let n=new Float32Array(16);for(let t=0;t<4;t+=1)for(let o=0;o<4;o+=1){let i=0;for(let a=0;a<4;a+=1)i+=(r[a*4+o]??0)*(e[t*4+a]??0);n[t*4+o]=i}return n},Lt=(r,e,n,t)=>{let o=1/Math.tan(r/2),i=new Float32Array(16);return i[0]=o/e,i[5]=o,i[10]=(t+n)/(n-t),i[11]=-1,i[14]=2*t*n/(n-t),i},Bt=(r,e,n,t,o,i)=>{let a=new Float32Array(16);return a[0]=2/(e-r),a[5]=2/(t-n),a[10]=-2/(i-o),a[12]=-(e+r)/(e-r),a[13]=-(t+n)/(t-n),a[14]=-(i+o)/(i-o),a[15]=1,a},zt=(r,e)=>{let n=Math.hypot((r[0]??0)-(e[0]??0),(r[1]??0)-(e[1]??0),(r[2]??0)-(e[2]??0))||1,t=[((r[0]??0)-(e[0]??0))/n,((r[1]??0)-(e[1]??0))/n,((r[2]??0)-(e[2]??0))/n],o=Math.hypot(t[2]??0,t[0]??0)||1,i=[(t[2]??0)/o,0,-(t[0]??0)/o],a=[(t[1]??0)*(i[2]??0),(t[2]??0)*(i[0]??0)-(t[0]??0)*(i[2]??0),-(t[1]??0)*(i[0]??0)];return new Float32Array([i[0]??0,a[0]??0,t[0]??0,0,i[1]??0,a[1]??0,t[1]??0,0,i[2]??0,a[2]??0,t[2]??0,0,-((i[0]??0)*(r[0]??0)+(i[1]??0)*(r[1]??0)+(i[2]??0)*(r[2]??0)),-((a[0]??0)*(r[0]??0)+(a[1]??0)*(r[1]??0)+(a[2]??0)*(r[2]??0)),-((t[0]??0)*(r[0]??0)+(t[1]??0)*(r[1]??0)+(t[2]??0)*(r[2]??0)),1])},Qe=(r,e,n)=>{let t=!1,o=n.at(-1);if(!o)return!1;for(let i of n){let[a,s]=i,[l,c]=o;s>e!=c>e&&r<(l-a)*(e-s)/(c-s)+a&&(t=!t),o=i}return t},Q=class{#r;#t;#i;#a=null;#x=null;#s=null;#d=null;#u=null;#l=null;#m=null;#P=new WeakMap;#e=null;#w=null;#z=null;#$=null;#S=null;#g=null;#c=null;#h=null;#n=null;#b=null;#_=null;#E=null;#f=null;#v=null;#L=null;#I=null;#q;#o={yaw:-Math.PI/4,pitch:.82,distance:12,targetX:0,targetZ:0,orthographic:!1};#T=12;#k=8;#y=4;#F=new Float32Array(16);#D=null;#M="unavailable";#R=0;#A=0;#p=0;#U=0;#W=0;#j=1;#ye=window.matchMedia("(any-pointer: coarse)").matches?35e4:Number.POSITIVE_INFINITY;#B={width:1,height:1,left:0,top:0};#C=!0;#N=!1;#ae=Et;constructor(e,n,t={}){this.#r=e,this.#t=n,this.#i=t,this.#x=n.getContext("2d",{alpha:!0}),this.#r.addEventListener("webglcontextlost",this.#ve),this.#r.addEventListener("webglcontextrestored",this.#be),this.#de(),this.#q=new ResizeObserver(()=>{let o=this.#T,i=this.#k;this.#he(),this.#C&&(o!==this.#T||i!==this.#k)?this.fit(!1):this.requestRender()}),this.#q.observe(e)}get camera(){return{...this.#o}}#se(){return{minimum:Math.max(.2,this.#y*.04),maximum:this.#y*8}}#le(){let e=this.#n?.metadata.span,n=this.#n?.metadata.metersPerCell;return!e||n===void 0?{x:this.#y,z:this.#y}:{x:Math.max(.5,e[0]*n*.55),z:Math.max(.5,e[1]*n*.55)}}setCamera(e,n=!0){let t=this.#se(),o=this.#le();this.#o={yaw:H(e.yaw),pitch:e.orthographic?Math.PI/2-.018:P(e.pitch,.18,1.38),distance:P(e.distance,t.minimum,t.maximum),targetX:P(e.targetX,-o.x,o.x),targetZ:P(e.targetZ,-o.z,o.z),orthographic:e.orthographic},this.#C=!1,this.requestRender(),n&&this.#X()}cameraAfterPan(e,n,t){let o=this.#Y(),i=e.distance*1.75/Math.max(200,o.height),a=Math.cos(e.yaw),s=-Math.sin(e.yaw),l=-Math.sin(e.yaw),c=-Math.cos(e.yaw),d=this.#le();return{...e,targetX:P(e.targetX-n*i*a+t*i*l,-d.x,d.x),targetZ:P(e.targetZ-n*i*s+t*i*c,-d.z,d.z)}}setState(e){if(this.#N)return;let n=this.#c,t=this.#n,o=this.#_,i=this.#E;this.#c=e,!e.pageActive&&this.#v!==null&&(window.cancelAnimationFrame(this.#v),this.#v=null);let a=e.resources.scene.value,s=a?j(e):null;this.#_=a,this.#E=s;let l=null,c=!!(this.#f&&this.#f.scene===a&&this.#f.context===s&&this.#f.generation===e.generation&&this.#f.contextGeneration===this.#R);if(!e.pageActive)this.#O(!0),this.#H();else if(a!==null){let h=j(e),m=a!==o||h!==i,u=this.#f,x=this.#M==="webgl2"&&!u&&this.#A<a.total,g=u&&u.context===h&&u.contextGeneration===this.#R&&se(u.scene,a)?je(a,u.revision):null,E=!!(u&&!u.staging&&u.seed==="scene"&&u.frontierBytes<u.scene.total*8&&a!==u.scene&&g!==null);if(!!!(u&&!E&&a!==u.scene&&g!==null&&this.#we(a,h,e,g))&&(x||!!(u&&!c)||m||a!==this.#n||h!==this.#b)){let k=this.#n!==null&&this.#b===h,I=k&&this.#n&&se(this.#n,a),B=!!(this.#n&&this.#A>=this.#n.total),de=!u&&I&&B?je(a,this.#n?.revision??-1):null;this.#O(!1),this.#M==="webgl2"?I?de!==null?this.#Q(a,h,e,!0,this.#n,!0,"copy",de):this.#Q(a,h,e,!0,this.#n,!0):(this.#O(!0),this.#n=a,this.#b=h,l=this.#V(a,k&&!this.#C,t,k,n?n.workflow==="draw"?"top":n.view:null),this.#Q(a,h,e,!1,t,!1)):(this.#n=a,this.#b=h,l=this.#V(a,k&&!this.#C,t,k,n?n.workflow==="draw"?"top":n.view:null))}}else(this.#n!==null||this.#f!==null)&&(this.#O(!0),this.#H(),this.#ie(),this.#n=null,this.#b=null,this.#p=0,this.#A=0);(!n||n.quality!==e.quality)&&(this.#j=kt(e.quality),this.#W=0);let d=n?.workflow!=="draw"&&e.workflow==="draw",p=n?.workflow==="draw"&&e.workflow!=="draw";if(!n||n.view!==e.view||d||p){let h=e.workflow==="draw"?"top":e.view;this.#o=this.#te(h,e,l),this.#C=this.#ne(h,e,l)}e.workflow==="draw"&&n?.draw.zoomPercent!==e.draw.zoomPercent&&Math.round(this.#k/this.#o.distance*100)!==e.draw.zoomPercent&&(this.#o={...this.#o,orthographic:!0,pitch:Math.PI/2-.018,distance:this.#k*100/e.draw.zoomPercent},this.#C=e.draw.zoomPercent===100&&Math.abs(this.#o.targetX)<.001&&Math.abs(this.#o.targetZ)<.001&&Math.abs(H(this.#o.yaw))<.001),(l||d)&&this.#X(),this.requestRender()}setCirclePreview(e,n){this.#h=e&&n?{circles:e,capture:n}:null,this.requestRender()}#te(e,n,t=null){let o=e==="top",i=o?this.#k:this.#T,a=t?.[e]??n.cameras[e];return a?{yaw:a.yaw,pitch:o?Math.PI/2-.018:a.pitch,distance:P(i/P(a.zoom,.01,100),Math.max(.2,this.#y*.04),this.#y*8),targetX:P(a.targetX,-this.#y,this.#y),targetZ:P(a.targetZ,-this.#y,this.#y),orthographic:o}:o?{yaw:0,pitch:Math.PI/2-.018,distance:i,targetX:0,targetZ:0,orthographic:!0}:{yaw:-Math.PI/4,pitch:.82,distance:i,targetX:0,targetZ:0,orthographic:!1}}#ne(e,n,t=null){let o=t?.[e]??n.cameras[e];return et(e,o)}#ce(e,n){let t=this.#a;if(!t)throw new Error("webgl-unavailable");let o=t.createShader(e);if(!o)throw new Error("shader-unavailable");if(t.shaderSource(o,n),t.compileShader(o),!t.getShaderParameter(o,t.COMPILE_STATUS))throw t.deleteShader(o),new Error("shader-failed");return o}#de(){try{this.#a=this.#r.getContext("webgl2",{alpha:!0,antialias:!0,depth:!0,powerPreference:"high-performance"});let e=this.#a;if(!e)throw new Error("webgl2-unavailable");let n=this.#ce(e.VERTEX_SHADER,`#version 300 es
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
      `),t=this.#ce(e.FRAGMENT_SHADER,`#version 300 es
        precision highp float;
        in vec3 vColor;
        out vec4 outColor;
        void main() {
          vec2 point = gl_PointCoord * 2.0 - 1.0;
          if (dot(point, point) > 1.0) discard;
          float edge = smoothstep(1.0, 0.72, dot(point, point));
          outColor = vec4(pow(vColor, vec3(0.94)), edge);
        }
      `),o=e.createProgram();if(!o)throw new Error("program-unavailable");if(e.attachShader(o,n),e.attachShader(o,t),e.linkProgram(o),e.deleteShader(n),e.deleteShader(t),!e.getProgramParameter(o,e.LINK_STATUS))throw new Error("program-failed");if(this.#u=o,this.#w=e.getUniformLocation(o,"uViewProjection"),this.#z=e.getUniformLocation(o,"uCenter"),this.#$=e.getUniformLocation(o,"uMetersPerCell"),this.#S=e.getUniformLocation(o,"uPointPixels"),this.#g=e.getUniformLocation(o,"uMaxPointPixels"),this.#l=e.createBuffer(),this.#e=e.createVertexArray(),e.bindVertexArray(this.#e),!this.#l)throw new Error("buffer-unavailable");this.#K(this.#l),e.bindVertexArray(null),e.enable(e.DEPTH_TEST),e.depthFunc(e.LEQUAL),e.enable(e.BLEND),e.blendFunc(e.SRC_ALPHA,e.ONE_MINUS_SRC_ALPHA),this.#M="webgl2",this.#R+=1}catch{this.#ee(),this.#me()}}#V(e,n=!1,t=null,o=!1,i=null){if(this.#H(),!e)return this.#p=0,this.#A=0,this.requestRender(),null;let[a,s]=e.metadata.span,l=e.metadata.metersPerCell,c=a*l,d=s*l;this.#y=Math.max(1,Math.hypot(c,d)/2);let p={three:this.#T,top:this.#k};this.#he(),n&&t?this.setCamera(Mt(this.#o,t,e),!1):this.fit(!1,i??void 0);let h=this.#c;if(o&&t&&h){let m={three:this.#T,top:this.#k},u=Pt(h.cameras,t,e,p,m),x=i??(h.workflow==="draw"?"top":h.view),g=x==="top"?this.#k:this.#T;return u[x]={yaw:this.#o.yaw,pitch:this.#o.pitch,zoom:g/Math.max(.2,this.#o.distance),targetX:this.#o.targetX,targetZ:this.#o.targetZ},this.#i.onCameraPreferences?.(u),u}return null}#he(){let e=this.#n;if(!e)return;let[n,t]=e.metadata.span,o=e.metadata.metersPerCell,i=n*o,a=t*o,s=this.#Y(),l=Math.max(.2,s.width/Math.max(1,s.height));this.#T=At(this.#y,l),this.#k=Math.max(a/2,i/(2*l))*1.12}#K(e,n=1,t=0){let o=this.#a;!o||!this.#e||(o.bindVertexArray(this.#e),o.bindBuffer(o.ARRAY_BUFFER,e),o.enableVertexAttribArray(0),o.vertexAttribIPointer(0,2,o.UNSIGNED_SHORT,8*n,8*t),o.enableVertexAttribArray(1),o.vertexAttribIPointer(1,1,o.UNSIGNED_BYTE,8*n,8*t+4),o.enableVertexAttribArray(2),o.vertexAttribPointer(2,3,o.UNSIGNED_BYTE,!0,8*n,8*t+5),o.bindVertexArray(null))}#ie(){this.#l&&this.#a&&this.#a.deleteBuffer(this.#l),this.#l=null}#O(e){let n=this.#f;n&&(this.#f=null,!n.staging&&e&&this.#l===n.buffer&&(this.#ie(),this.#n=null,this.#b=null,this.#p=0,this.#A=0))}#Q(e,n,t,o,i,a,s="scene",l=[]){let c=this.#a;if(!c||this.#M!=="webgl2"||!t.pageActive||this.#N)return;let d=o?this.#m:this.#l;if(!d&&!o&&this.#m&&(d=this.#m,this.#m=null),!d)try{d=c.createBuffer()}catch{this.#Z();return}if(!d){this.#Z();return}if(o?this.#m=d:this.#l=d,!this.#ge(d,e.total*8,s==="scene")){this.#Z();return}o||this.#K(d),this.#f={scene:e,revision:e.revision,context:n,generation:t.generation,contextGeneration:this.#R,buffer:d,staging:o,seed:s,previousScene:i,preserveCamera:a,preferenceView:t.workflow==="draw"?"top":t.view,frontierBytes:0,dirtyBlocks:new Set(l),transitionBlocks:new Set(l)},o||(this.#A=0,this.#p=0),this.requestRender()}#we(e,n,t,o){let i=this.#f;if(!i||i.context!==n||i.contextGeneration!==this.#R||!se(i.scene,e))return!1;let a=new Set(i.transitionBlocks);for(let s of o)a.add(s);if(a.size>tt)return!1;i.scene=e,i.revision=e.revision,i.generation=t.generation,i.transitionBlocks.clear();for(let s of a)i.transitionBlocks.add(s);if(i.seed==="copy")for(let s of o)i.dirtyBlocks.add(s);else{let s=Math.ceil(i.frontierBytes/$);for(let l of o)l<s&&i.dirtyBlocks.add(l)}return this.requestRender(),!0}#ge(e,n,t){let o=this.#a;if(!o)return!1;let i=this.#P.get(e)??0;if(!t&&i>=n)return!0;try{return o.bindBuffer(o.ARRAY_BUFFER,e),o.bufferData(o.ARRAY_BUFFER,n,o.DYNAMIC_DRAW),this.#oe()?!1:(this.#P.set(e,n),!0)}catch{return!1}}#oe(){let e=this.#a;if(!e)return!0;try{let n=e.getError();return typeof n=="number"&&n!==e.NO_ERROR}catch{return!0}}#Z(){let e=this.#_,n=this.#E,t=this.#c,o=this.#n,i=this.#b;if(this.#O(!1),this.#ee(),e&&n&&t?.pageActive){let a=o!==null&&i===n;(e!==o||n!==i)&&(this.#n=e,this.#b=n,this.#V(e,a&&!this.#C,o,a,t.workflow==="draw"?"top":t.view))}else!e&&o&&(this.#n=null,this.#b=null,this.#V(null));this.#me(),this.requestRender()}#ue(e,n){let t=this.#a,o=e.scene.total*8-e.frontierBytes,i=Math.min(o,n);if(!t||i<=0)return 0;if(e.seed==="copy"){if(!this.#l||this.#l===e.buffer)return-1;t.bindBuffer(t.COPY_READ_BUFFER,this.#l),t.bindBuffer(t.COPY_WRITE_BUFFER,e.buffer),t.copyBufferSubData(t.COPY_READ_BUFFER,t.COPY_WRITE_BUFFER,e.frontierBytes,e.frontierBytes,i)}else{let a=new Uint8Array(e.scene.buffer,e.scene.pointOffset+e.frontierBytes,i);t.bindBuffer(t.ARRAY_BUFFER,e.buffer),t.bufferSubData(t.ARRAY_BUFFER,e.frontierBytes,a)}return this.#oe()?-1:(e.frontierBytes+=i,e.staging||(this.#A=e.frontierBytes/8),i)}#_e(e,n){let t=this.#a;if(!t||n<=0)return 0;let o=e.scene.total*8,i=[...e.dirtyBlocks].sort((s,l)=>s-l),a=0;for(let s of i){let l=s*$,c=Math.min(o,l+$),d=c-l;if(c>e.frontierBytes||a+d>n)continue;let p=new Uint8Array(e.scene.buffer,e.scene.pointOffset+l,d);if(t.bindBuffer(t.ARRAY_BUFFER,e.buffer),t.bufferSubData(t.ARRAY_BUFFER,l,p),this.#oe())return-1;e.dirtyBlocks.delete(s),a+=d}return a}#xe(){let e=this.#f,n=this.#a,t=this.#c;if(!e||!n||!t)return;if(this.#N||!t.pageActive||e.scene!==this.#_||e.revision!==e.scene.revision||e.context!==this.#E||e.generation!==t.generation||j(t)!==e.context||t.resources.scene.value!==e.scene||e.contextGeneration!==this.#R||e.staging&&this.#m!==e.buffer||!e.staging&&this.#l!==e.buffer){this.#O(!0);return}let o=e.scene.total*8,i=e.frontierBytes<o,a=le,s=0;try{let l=i&&e.dirtyBlocks.size>0?Ze:le,c=this.#ue(e,Math.min(l,a));if(c<0)throw new Error("gpu-frontier-upload-failed");a-=c,s+=c;let d=[...e.dirtyBlocks].some(u=>Math.min(o,(u+1)*$)<=e.frontierBytes),p=i&&d?Math.min(Ze,a):d?a:0,h=this.#_e(e,p);if(h<0)throw new Error("gpu-dirty-upload-failed");a-=h,s+=h;let m=[...e.dirtyBlocks].some(u=>Math.min(o,(u+1)*$)<=e.frontierBytes);if(i&&a>0&&!m){let u=this.#ue(e,a);if(u<0)throw new Error("gpu-frontier-upload-failed");a-=u,s+=u}}catch{this.#Z();return}if(s>0&&!this.#pe(e)){this.#O(!0);return}if(e.frontierBytes<o||e.dirtyBlocks.size>0){this.requestRender();return}if(!this.#pe(e)){this.#O(!0);return}if(e.staging){let l=this.#c,c=l?l.workflow==="draw"?"top":l.view:e.preferenceView,d=this.#l;this.#l=e.buffer,this.#m=d,this.#K(e.buffer),this.#n=e.scene,this.#b=e.context,this.#f=null,this.#A=e.scene.total,this.#p=e.scene.total;let p=this.#V(e.scene,e.preserveCamera,e.previousScene,!0,c);if(l&&p){let h=l.workflow==="draw"?"top":l.view;this.#o=this.#te(h,l,p),this.#C=this.#ne(h,l,p),this.#X()}}else this.#f=null,this.#n=e.scene,this.#b=e.context,this.#A=e.scene.total,this.#p=e.scene.total}#pe(e){let n=this.#c;return n?!this.#N&&n.pageActive&&e.scene===this.#_&&e.revision===e.scene.revision&&e.context===this.#E&&e.generation===n.generation&&j(n)===e.context&&n.resources.scene.value===e.scene&&e.contextGeneration===this.#R&&(e.staging?this.#m===e.buffer:this.#l===e.buffer):!1}#me(){this.#H(),this.#M="canvas2d",this.#d=document.createElement("canvas"),this.#s=this.#d.getContext("2d",{alpha:!0}),this.#s||(this.#M="unavailable",this.#i.onProblem?.("renderer-unavailable"))}#Ce(e){let n=this.#s,t=this.#d;if(!n||!t)return;this.#H();let o={scene:e,matrix:new Float32Array(this.#F),width:this.#B.width,height:this.#B.height};this.#I=o;let i=Math.min(window.devicePixelRatio||1,1024/Math.max(1,o.width),1024/Math.max(1,o.height));t.width=Math.max(1,Math.round(o.width*i)),t.height=Math.max(1,Math.round(o.height*i)),n.setTransform(i,0,0,i,0,0),this.#p=0;let a=new DataView(e.buffer,e.pointOffset,e.total*8),s=Math.max(1,Math.ceil(e.total/5e4)),l=0,c=0,d=()=>{if(this.#N||!this.#c?.pageActive||this.#M!=="canvas2d"||e!==this.#n||o!==this.#I)return;this.#L=null;let p=performance.now(),h=0;for(;l<e.total&&h<2e3;){let m=l*8,u=this.#J(a.getUint16(m,!0),a.getUint16(m+2,!0),a.getUint8(m+4),!0,o.matrix,o);if(u&&(n.fillStyle=`rgb(${a.getUint8(m+5)} ${a.getUint8(m+6)} ${a.getUint8(m+7)})`,n.fillRect(u.x-.75,u.y-.75,1.5,1.5)),l+=s,h+=1,c+=1,h%64===0&&performance.now()-p>=4)break}this.#p=c,this.requestRender(),l<e.total&&(this.#L=window.setTimeout(d,0))};this.#L=window.setTimeout(d,0)}#H(){this.#L!==null&&window.clearTimeout(this.#L),this.#L=null,this.#I=null}#Y(){let e=this.#r.getBoundingClientRect();return this.#B={width:e.width,height:e.height,left:e.left,top:e.top},this.#B}#ke(){let e=!1,n=this.#Y(),t=Math.min(window.devicePixelRatio||1,3),o=Math.max(1,Math.round(n.width*t)),i=Math.max(1,Math.round(n.height*t));for(let a of[this.#r,this.#t])(a.width!==o||a.height!==i)&&(a.width=o,a.height=i,e=!0);e&&this.#i.onViewport?.()}#re(){let e=this.#B,n=Math.max(.2,e.width/Math.max(1,e.height)),t=Math.cos(this.#o.pitch)*this.#o.distance,o=[this.#o.targetX+Math.sin(this.#o.yaw)*t,Math.sin(this.#o.pitch)*this.#o.distance,this.#o.targetZ+Math.cos(this.#o.yaw)*t],i=[this.#o.targetX,0,this.#o.targetZ],a=zt(o,i),s=this.#o.orthographic?Bt(-this.#o.distance*n,this.#o.distance*n,-this.#o.distance,this.#o.distance,-this.#y*4,this.#y*4):Lt(nt,n,.02,Math.max(60,this.#y*12));return Tt(s,a)}requestRender(){this.#v!==null||this.#N||this.#c?.pageActive===!1||(this.#v=window.requestAnimationFrame(()=>{this.#v=null,this.#Me()}))}#Me(){if(this.#N||this.#c?.pageActive===!1)return;let e=performance.now();this.#xe(),this.#ke(),this.#F=this.#re(),this.#M==="webgl2"?this.#Pe():this.#Se(),this.#Re(),this.#U=performance.now()-e,this.#U>18?(this.#W+=1,this.#W>=3&&this.#c?.quality==="auto"&&(this.#j=Math.max(.25,this.#j*.75))):this.#W=Math.max(0,this.#W-1)}#Pe(){let e=this.#a,n=this.#n;if(!e||(e.viewport(0,0,this.#r.width,this.#r.height),e.clearColor(0,0,0,0),e.clear(e.COLOR_BUFFER_BIT|e.DEPTH_BUFFER_BIT),!n||!this.#u||!this.#e||!this.#l))return;if(this.#c?.view==="top"&&this.#c.appearance==="rooms"){this.#p=0;return}e.useProgram(this.#u),e.bindVertexArray(this.#e),e.uniformMatrix4fv(this.#w,!1,this.#F),e.uniform2f(this.#z,(n.metadata.span[0]-1)/2,(n.metadata.span[1]-1)/2),e.uniform1f(this.#$,n.metadata.metersPerCell);let t=Math.min(window.devicePixelRatio||1,3),o=Math.min(n.total,this.#A),i=Math.max(Math.ceil(1/this.#j),this.#c?.quality==="auto"?Math.ceil(o/this.#ye):1),a=Math.min(n.floorCount,o),s=Math.min(n.surfaceCount,Math.max(0,o-n.floorCount)),l=Math.ceil(a/i),c=Math.ceil(s/i);l>0&&(this.#K(this.#l,i),e.bindVertexArray(this.#e),e.uniform1f(this.#S,this.#r.height*.038),e.uniform1f(this.#g,4.5*t),e.drawArrays(e.POINTS,0,l)),c>0&&(this.#K(this.#l,i,n.floorCount),e.bindVertexArray(this.#e),e.uniform1f(this.#S,this.#r.height*.05),e.uniform1f(this.#g,7*t),e.drawArrays(e.POINTS,0,c)),e.bindVertexArray(null),this.#p=l+c}#Se(){let e=this.#n;if(this.#M!=="canvas2d"||!e||this.#c?.view==="top"&&this.#c.appearance==="rooms"){this.#H(),this.#p=0;return}let n=this.#I;(!n||n.scene!==e||n.width!==this.#B.width||n.height!==this.#B.height||!n.matrix.every((t,o)=>t===this.#F[o]))&&this.#Ce(e)}#Ee(e,n,t=0){let o=this.#n;return o?[-(e-(o.metadata.span[0]-1)/2)*o.metadata.metersPerCell,t*o.metadata.metersPerCell,(n-(o.metadata.span[1]-1)/2)*o.metadata.metersPerCell]:null}#J(e,n,t=0,o=!0,i=this.#F,a=this.#B){let s=this.#Ee(e,n,t);if(!s)return null;let[l,c,d]=s,p=(i[0]??0)*l+(i[4]??0)*c+(i[8]??0)*d+(i[12]??0),h=(i[1]??0)*l+(i[5]??0)*c+(i[9]??0)*d+(i[13]??0),m=(i[3]??0)*l+(i[7]??0)*c+(i[11]??0)*d+(i[15]??0);if(m<=.001)return null;let u=p/m,x=h/m;return!Number.isFinite(u)||!Number.isFinite(x)||o&&(Math.abs(u)>1.15||Math.abs(x)>1.15)?null:{x:(u*.5+.5)*a.width,y:(-x*.5+.5)*a.height}}#G(e,n,t=0,o=!0,i=this.#F){let a=this.#n;if(!a)return null;let s=e/a.metadata.metersPerCell-a.metadata.origin[0],l=n/a.metadata.metersPerCell-a.metadata.origin[1];return this.#J(s,l,t,o,i)}#Re(){let e=this.#x,n=this.#n,t=this.#c;if(!e)return;let o=Math.min(window.devicePixelRatio||1,3),i=this.#B;if(e.setTransform(o,0,0,o,0,0),e.clearRect(0,0,i.width,i.height),!n||!t)return;let a=this.#ae;this.#M==="canvas2d"&&this.#d&&!(t.view==="top"&&t.appearance==="rooms")&&e.drawImage(this.#d,0,0,i.width,i.height);let s=this.#Ae(t);if(t.labelsVisible||t.view==="top"&&t.appearance==="rooms"){e.lineWidth=1.5,e.font="600 12px system-ui, sans-serif",e.textAlign="center",e.textBaseline="middle";let h=[];for(let m of n.metadata.rooms){let u=s.has(m.name.toLocaleLowerCase());e.strokeStyle=u?M(a.accent,1):M(a.quiet,.7),e.fillStyle=u?M(a.accent,.26):t.view==="top"&&t.appearance==="rooms"?M(a.roomFill,.94):M(a.plate,.04),e.beginPath();let x=Math.max(1,Math.ceil(m.boundary.length/512)),g=!1;for(let k=0;k<m.boundary.length;k+=x){let I=m.boundary[k];if(!I)continue;let B=this.#J(I[0],I[1],.2,!1);B&&(g?e.lineTo(B.x,B.y):e.moveTo(B.x,B.y),g=!0)}if(g&&(e.closePath(),e.fill(),e.stroke()),!t.labelsVisible)continue;let E=this.#J(m.center[0],m.center[1],1);if(!E)continue;let D=e.measureText(m.name).width,R=new DOMRect(E.x-D/2-6,E.y-10,D+12,20);h.some(k=>R.left<k.right+8&&R.right+8>k.left&&R.top<k.bottom+4&&R.bottom+4>k.top)||(h.push(R),e.fillStyle=M(a.plate,.88),e.fillRect(R.x,R.y,R.width,R.height),e.fillStyle=M(a.text,1),e.fillText(m.name,E.x,E.y))}}let l=this.#h,c=l&&A(t,l.capture)?l.circles:t.draw.circles;if((t.workflow==="draw"||t.workflow==="areaReview")&&c.length)if(e.fillStyle=M(a.accent,.22),e.strokeStyle=M(a.accent,.92),e.lineWidth=1.5,t.draw.outline?.closed){e.beginPath();for(let h of c)this.#fe(e,h,!1);e.fill()}else for(let h of c)this.#fe(e,h);let d=t.draw.outline;if(d&&(t.workflow==="draw"||t.workflow==="areaReview")&&!(t.workflow==="draw"&&t.draw.tool==="outline")&&(e.beginPath(),d.points.forEach((h,m)=>{let u=this.#G(h.x,h.y,0,!1);u&&(m===0?e.moveTo(u.x,u.y):e.lineTo(u.x,u.y))}),d.closed&&e.closePath(),e.strokeStyle=M(a.accent,1),e.lineWidth=2,e.stroke()),this.#D&&t.workflow==="draw"&&(t.draw.tool==="paint"||t.draw.tool==="erase")){let h=this.#G(this.#D.x,this.#D.y),m=this.#G(this.#D.x+t.draw.brushMeters/2,this.#D.y);h&&m&&(e.beginPath(),e.arc(h.x,h.y,Math.max(2,Math.hypot(m.x-h.x,m.y-h.y)),0,Math.PI*2),e.strokeStyle=M(a.accent,1),e.lineWidth=2,e.stroke())}let p=t.resources.pose.value;if(X(t)&&p?.position){let h=this.#G(p.position[0],p.position[1],3);h&&(e.beginPath(),e.arc(h.x,h.y,7,0,Math.PI*2),e.fillStyle=M(a.accent,1),e.fill(),e.strokeStyle=M(a.onAccent,1),e.lineWidth=3,e.stroke())}}#Ae(e){let n=e.resources.plans.value?.rooms||e.resources.areas.value?.rooms||[],t=new Set(e.workflow==="plan"?e.planDraft.rooms.map(i=>i.roomId):e.selection.roomIds),o=new Set;for(let i of n)t.has(i.roomId)&&o.add(i.name.toLocaleLowerCase());return o}#fe(e,n,t=!0){let o=this.#G(n.x,n.y),i=this.#G(n.x+n.radius,n.y);if(!o||!i)return;let a=Math.max(1,Math.hypot(i.x-o.x,i.y-o.y));t&&e.beginPath(),e.moveTo(o.x+a,o.y),e.arc(o.x,o.y,a,0,Math.PI*2),t&&(e.fill(),e.stroke())}setPalette(e){this.#ae=e,this.requestRender()}setCursor(e){this.#D=e,this.requestRender()}mapToScreen(e){if(!this.#n)return null;let n=this.#Y();return!n.width||!n.height?null:this.#G(e.x,e.y,0,!1,this.#re())}offsetMapPoint(e,n,t){let o=this.mapToScreen(e);if(!o)return null;let i=this.#B,a=this.#o.distance*2/i.height;return this.screenToMap(i.left+o.x+n/a,i.top+o.y+t/a)}screenToMap(e,n){let t=this.#n;if(!t)return null;let o=this.#Y();if(!o.width||!o.height)return null;let i=this.#re(),a=(e-o.left)/o.width*2-1,s=1-(n-o.top)/o.height*2,l=i[0]-a*i[3],c=i[8]-a*i[11],d=i[1]-s*i[3],p=i[9]-s*i[11],h=l*p-c*d;if(!Number.isFinite(h)||Math.abs(h)<1e-12)return null;let m=a*i[15]-i[12],u=s*i[15]-i[13],x=(m*p-c*u)/h,g=(l*u-m*d)/h;if(i[3]*x+i[11]*g+i[15]<=0)return null;let E=-x/t.metadata.metersPerCell+(t.metadata.span[0]-1)/2,D=g/t.metadata.metersPerCell+(t.metadata.span[1]-1)/2;return{x:(E+t.metadata.origin[0])*t.metadata.metersPerCell,y:(D+t.metadata.origin[1])*t.metadata.metersPerCell}}roomAt(e,n){let t=this.screenToMap(e,n),o=this.#n,i=this.#c;if(!t||!o||!i)return null;let a=t.x/o.metadata.metersPerCell-o.metadata.origin[0],s=t.y/o.metadata.metersPerCell-o.metadata.origin[1],l=o.metadata.rooms.find(c=>Qe(a,s,c.boundary));return l?this.#Te(l,i):null}containsMapPoint(e){let n=this.#n;if(!n)return!1;let t=e.x/n.metadata.metersPerCell-n.metadata.origin[0],o=e.y/n.metadata.metersPerCell-n.metadata.origin[1];return n.metadata.rooms.some(i=>Qe(t,o,i.boundary))}#Te(e,n){return(n.resources.plans.value?.rooms||n.resources.areas.value?.rooms||[]).find(o=>o.name.localeCompare(e.name,void 0,{sensitivity:"base"})===0)?.roomId||e.id}selectRoomAt(e,n){let t=this.roomAt(e,n);t&&this.#i.onRoom?.(t)}fit(e=!0,n=this.#c?.workflow==="draw"?"top":this.#c?.view??"three"){let t=n==="top";this.#o=t?{yaw:0,pitch:Math.PI/2-.018,distance:this.#k,targetX:0,targetZ:0,orthographic:!0}:{yaw:-Math.PI/4,pitch:.82,distance:this.#T,targetX:0,targetZ:0,orthographic:!1},this.#C=!0,this.requestRender(),e&&this.#X()}zoomAt(e,n,t){let o=n===void 0||t===void 0?null:this.screenToMap(n,t),i=this.#se();if(this.#o={...this.#o,distance:P(this.#o.distance/e,i.minimum,i.maximum)},this.#C=!1,o&&n!==void 0&&t!==void 0){let a=this.screenToMap(n,t);a&&(this.#o={...this.#o,targetX:this.#o.targetX-(o.x-a.x),targetZ:this.#o.targetZ+(o.y-a.y)})}this.requestRender(),this.#X(n,t)}panBy(e,n){this.setCamera(this.cameraAfterPan(this.#o,e,n))}orbitBy(e,n){if(this.#o.orthographic){this.panBy(e,n);return}this.#o={...this.#o,yaw:H(this.#o.yaw+e*.006),pitch:P(this.#o.pitch-n*.004,.18,1.38)},this.#C=!1,this.requestRender(),this.#X()}rotateBy(e){this.#o={...this.#o,yaw:H(this.#o.yaw+e)},this.#C=!1,this.requestRender(),this.#X()}#X(e,n){let t=this.#o.orthographic?this.#k:this.#T,o=e===void 0||n===void 0?this.#B:this.#Y(),i=e===void 0||n===void 0||!o.width||!o.height?void 0:{xPercent:P((e-o.left)/o.width*100,0,100),yPercent:P((n-o.top)/o.height*100,0,100)};this.#i.onCamera?.(this.camera,Math.round(t/this.#o.distance*100),i)}diagnostics(){return{mode:this.#M,contextGeneration:this.#R,sceneRevision:this.#n?.revision??null,sourcePoints:this.#n?.total??0,renderedPoints:this.#p,lastFrameMs:Math.round(this.#U*100)/100,slowFrames:this.#W,cameraDistance:this.#o.distance,fitDistance:this.#o.orthographic?this.#k:this.#T,fitActive:this.#C}}#ve=e=>{e.preventDefault(),this.#Z()};#be=()=>{let e=this.#n,n=this.#b;this.#H(),this.#ee(),this.#de();let t=this.#_,o=this.#E,i=this.#c;if(this.#M==="webgl2"&&t&&o&&i?.pageActive){let a=e!==null&&n===o;this.#ie(),this.#n=t,this.#b=o;let s=null;if(t!==e&&(s=this.#V(t,a&&!this.#C,e,a,i.workflow==="draw"?"top":i.view)),this.#Q(t,o,i,!1,e,a&&!this.#C),s){let l=i.workflow==="draw"?"top":i.view;this.#o=this.#te(l,i,s),this.#C=this.#ne(l,i,s),this.#X()}}this.requestRender()};#ee(){this.#O(!1);let e=this.#a;e&&(this.#l&&e.deleteBuffer(this.#l),this.#m&&e.deleteBuffer(this.#m),this.#e&&e.deleteVertexArray(this.#e),this.#u&&e.deleteProgram(this.#u)),this.#l=null,this.#m=null,this.#e=null,this.#u=null,this.#a=null,this.#A=0,this.#p=0}dispose(){this.#N||(this.#N=!0,this.#q.disconnect(),this.#r.removeEventListener("webglcontextlost",this.#ve),this.#r.removeEventListener("webglcontextrestored",this.#be),this.#v!==null&&window.cancelAnimationFrame(this.#v),this.#v=null,this.#H(),this.#ee(),this.#d=null,this.#s=null,this.#x=null,this.#h=null,this.#n=null,this.#c=null,this.#_=null,this.#E=null)}};var $t="matic-workspace-intent",It="matic-workspace-action",it="navigation-help",ot=(r,e)=>{let n=(o,i,a)=>ie(e,o,i,a);if(r.dataMode==="history"||r.floor.readOnly)return r.map.available?n("v4_saved_map_description","Saved read-only map for {floor}. Live robot position is hidden.",{floor:r.floor.displayName}):r.resources.scene.status==="loading"?n("v4_saved_map_loading_description","The saved map is loading."):n("v4_saved_map_unavailable_description","This saved map is unavailable.");if(!te(r))return n("v4_private_map_unavailable","The current private map is not available.");let t=X(r)?n("v4_robot_position_verified","The robot position is verified."):n("v4_robot_position_hidden","The robot position is not shown.");return n("v4_live_map_description","Live map for {floor}. {pose}",{floor:r.floor.displayName,pose:t})},ce=class extends me{constructor(){super();this.state=he();this.narrow=!1;this.#r=null;this.#t=null;this.#i=null;this.#a=!1;this.#x=!1;this.#s=null;this.#d=[];this.#u=null;this.#l=null;this.#m={capture:!0,handleEvent:n=>{n.pointerType==="touch"&&!n.isPrimary&&this.#P.value?.cancel()}};this.#P=new W(this,async()=>{let{OutlineEditor:n}=await import("./outline-editor-HO562MCY.js");return new n(()=>this.state,()=>this.#t,t=>this.#n(t),()=>this.requestUpdate(),(t,o,i)=>this.#e(t,o,i),t=>{this.updateComplete.then(()=>{(this.renderRoot.querySelector(`[data-zone-index="${t}"]`)??this.renderRoot.querySelector(".map-root"))?.focus({preventScroll:!0})})})});this.#g=()=>{this.#$()};new O(this,{container:()=>this.renderRoot?.querySelector(".camera-steps")??null,items:"button"}),new O(this,{container:()=>this.renderRoot?.querySelector(".draw-tools")??null,items:"button"})}static{this.properties={state:{attribute:!1},localize:{attribute:!1},narrow:{type:Boolean,reflect:!0}}}static{this.styles=[fe,ve,ye,pe`
    :host {
      display: block;
      min-width: 0;
      min-height: 0;
      block-size: 100%;
      color: var(--ms-text);
    }


    button, input { font: inherit; }

    .map-root {
      position: relative;
      overflow: hidden;
      min-block-size: 22rem;
      block-size: 100%;
      outline: none;
      isolation: isolate;
      --ms-local: var(--ms-surface-sunken);
      background: var(--ms-local);
      touch-action: none;
      cursor: grab;
      container-type: inline-size;
    }

    .map-root.navigating { cursor: grabbing; }
    .map-root[data-workflow="draw"][data-draw-tool="paint"],
    .map-root[data-workflow="draw"][data-draw-tool="erase"] { cursor: crosshair; }
    .map-root[data-workflow="draw"][data-draw-tool="pan"] { cursor: grab; }
    .map-root[data-workflow="draw"][data-draw-tool="pan"].navigating { cursor: grabbing; }

    .map-root:focus-visible {
      outline: 3px solid var(--primary-color, #03a9f4);
      outline-offset: -3px;
    }

    /* Navigation has stable corners; only orbit controls follow the sheet. */
    .map-rail { --help-top: calc(44px + 2 * var(--ms-space-2)); --help-bottom: 116px; position: absolute; inset: 0.75rem; inset-inline: max(0.75rem, var(--ms-safe-left)) max(0.75rem, var(--ms-safe-right)); z-index: 4; pointer-events: none; }
    .map-rail > * { pointer-events: auto; }
    slot[name="scrim"] { display: contents; pointer-events: none; }
    ::slotted(.sheet-scrim) { pointer-events: auto; }
    .map-context { position: absolute; inset-block-start: 0; inset-inline-start: 0; display: flex; gap: var(--ms-space-2); align-items: center; max-inline-size: calc(100% - 60px); }
    ::slotted(.floor-switcher) { min-inline-size: 0; inline-size: 9rem; min-block-size: 44px; background-color: var(--ms-surface-card); color: var(--ms-text); }
    .view-switch { flex: none; }
    .map-tools { position: absolute; inset-block-start: 0; inset-inline-end: 0; }
    .map-extras { position: absolute; inset-block-end: calc(var(--map-sheet-offset, 0px) + 52px); inset-inline-end: 0; display: flex; }
    .appearance-switch { position: absolute; inset-block-start: calc(44px + 2 * var(--ms-space-2)); inset-inline-start: 0; }
    .camera-steps { position: absolute; inset-block-end: var(--map-sheet-offset, 0px); inset-inline-end: 0; }
    .map-root:has(.selection-chip) .camera-steps { inset-block-end: calc(var(--map-sheet-offset, 0px) + 4rem); }
    .map-root:has(.selection-chip) .map-extras { inset-block-end: calc(var(--map-sheet-offset, 0px) + 4rem + 52px); }
    .map-rail:has(.appearance-switch) { --help-top: calc(88px + 4 * var(--ms-space-2)); }
    .map-root:has(.selection-chip) .map-rail { --help-bottom: calc(116px + 4rem); }
    .navigation-help { position: absolute; inset-block-start: var(--help-top); inset-inline-end: 0; max-block-size: calc(100% - var(--help-top) - var(--help-bottom)); overflow: auto; box-sizing: border-box; }
    :host([narrow]) .map-context { max-inline-size: calc(100% - 52px); gap: var(--ms-space-1); }
    :host([narrow]) ::slotted(.floor-switcher) { inline-size: 7rem; }
    :host([narrow]) .fit { min-inline-size: 44px; padding-inline: var(--ms-space-2); }
    :host([narrow]) .fit .ms-btn__label { display: none; }

    .map-tools, .view-switch, .appearance-switch, .camera-steps { display: flex; }

    .map-dock, .map-scale, .map-message { position: absolute; z-index: 4; }

    .map-dock {
      inset-inline-start: 50%;
      inset-block-end: calc(0.75rem + var(--map-sheet-offset, 0px));
      translate: -50% 0;
      max-inline-size: calc(100% - 1rem);
    }
    .map-dock .draw-tools--row { flex-direction: row; gap: var(--ms-space-1); }
    .map-dock .draw-tools button { padding-inline: var(--ms-space-2); }
    .selection-chip {
      display: flex;
      align-items: center;
      gap: var(--ms-space-3);
      padding: var(--ms-space-1) var(--ms-space-1) var(--ms-space-1) var(--ms-space-3);
      font-size: var(--ms-t-sm);
      font-weight: var(--ms-w-bold);
      white-space: nowrap;
    }

    .navigation-help {
      inline-size: 22rem;
      max-inline-size: 100%;
      padding: 0.8rem 0.9rem;
      font-size: 0.74rem;
      line-height: 1.45;
    }
    .navigation-help header { display: flex; align-items: center; justify-content: space-between; gap: var(--ms-space-2); margin-block-end: 0.5rem; }
    .navigation-help h3 { margin: 0; font-size: var(--ms-t-sm); font-weight: var(--ms-w-bold); }
    .navigation-help dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.35rem 0.65rem; margin: 0; }
    .navigation-help dt { font-weight: 750; }
    .navigation-help dd { margin: 0; color: var(--ms-text-quiet); }

    .zone-overlay { position: absolute; inset: 0; z-index: 4; pointer-events: none; overflow: hidden; }
    .zone-overlay svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
    .zone-overlay path { stroke: var(--ms-accent); stroke-width: 2; fill-opacity: .08; }
    .zone-overlay path.invalid { stroke: var(--error-color, #b3261e); }
    .zone-point { position: absolute; translate: -50% -50%; width: 44px; height: 44px; border: 0; border-radius: 50%; background: transparent; color: var(--ms-accent); pointer-events: auto; touch-action: none; cursor: grab; font: 700 12px system-ui; isolation: isolate; }
    .zone-point::before { content: ""; position: absolute; inset: 10px; z-index: -1; border-radius: 50%; background: var(--ms-surface-card); border: 2px solid var(--ms-accent); box-shadow: 0 1px 4px #0008; }
    .zone-point[data-selected="true"] { color: var(--ms-on-accent); }
    .zone-point[data-selected="true"]::before { background: var(--ms-accent); border-color: var(--ms-surface-card); }
    .zone-point:focus-visible { outline: 3px solid var(--ms-accent); outline-offset: 0; }
    .zone-midpoint { font-size: 18px; }
    .zone-midpoint::before { inset: 13px; background: var(--ms-surface-card); }
    .zone-midpoint { color: var(--ms-accent); }
    .zone-help { position: absolute; inset: auto auto 88px 50%; translate: -50% 0; width: max-content; max-width: calc(100% - 24px); display: grid; justify-items: center; gap: 6px; font-size: 12px; pointer-events: none; }
    .zone-point-actions, .zone-guidance { display: flex; align-items: center; gap: 4px; max-width: 100%; padding: 4px; border-radius: 14px; pointer-events: auto; }
    .zone-selection { padding-inline: 8px; color: var(--ms-text-quiet); white-space: nowrap; font-weight: 650; }
    .zone-point-actions .ms-btn { white-space: nowrap; padding-inline: 10px; border-radius: 10px; font-size: 12px; }
    .zone-point-actions .ms-btn + .ms-btn { border-inline-start: 1px solid var(--ms-line); }
    .zone-guidance { padding: 6px 12px; gap: 8px; color: var(--ms-text-quiet); line-height: 1.4; }
    .zone-guidance .ms-btn { flex-shrink: 0; }
    .zone-feedback { max-width: 100%; padding: 8px 12px; border-radius: 12px; color: var(--error-color, #b3261e); pointer-events: auto; }
    .zone-feedback[hidden] { display: none; }
    .map-root[data-narrow="true"] .zone-help { bottom: 12px; }
    .keyboard-aim { display: none; position: absolute; z-index: 3; inset: 50% auto auto 50%; inline-size: 20px; block-size: 20px; translate: -50% -50%; border: 2px solid white; outline: 2px solid #111; border-radius: 50%; pointer-events: none; }
    .keyboard-aim::after { content: "+"; position: absolute; inset: 50% auto auto 50%; translate: -50% -50%; color: #111; font: bold 20px/1 sans-serif; text-shadow: 0 0 2px white; }
    .map-root:focus-visible .keyboard-aim { display: block; }
    .scene-window {
      position: absolute;
      inset: 0;
      inset-block-end: var(--map-sheet-offset, 0px);
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

    .map-scale {
      inset-inline-start: max(0.9rem, var(--ms-safe-left));
      inset-block-end: calc(5.2rem + var(--map-sheet-offset, 0px));
      display: grid;
      justify-items: start;
      gap: 0.25rem;
      border: 0;
      background: transparent;
      box-shadow: none;
      color: var(--ms-text-quiet);
      font-size: 0.7rem;
      font-weight: 650;
    }

    .map-root[data-draw-tool="outline"] .map-scale { inset-block-end: auto; inset-block-start: 76px; }

    .scale-line {
      inline-size: var(--scale-width);
      block-size: 0.42rem;
      border-inline: 2px solid currentColor;
      border-block-end: 2px solid currentColor;
    }

    .map-message {
      inset: calc((100% - var(--map-sheet-offset, 0px)) / 2) auto auto 50%;
      translate: -50% -50%;
      inline-size: min(22rem, calc(100% - 2rem));
      padding: 1rem 1.1rem;
      text-align: center;
    }

    .map-message strong { display: block; margin-block-end: 0.35rem; }
    .map-message span { color: var(--ms-text-quiet); font-size: 0.82rem; }

    .sr-only {
      position: absolute;
      overflow: hidden;
      inline-size: 1px;
      block-size: 1px;
      margin: -1px;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }

/* Four labelled buttons span most of the map at desktop width; icons with tooltips keep the rail a narrow column. */
.map-tools .ms-btn__label { position: absolute; overflow: hidden; inline-size: 1px; block-size: 1px; margin: -1px; padding: 0; border: 0; clip-path: inset(50%); white-space: nowrap; }
@container (max-width: 29rem) {
.map-tools button, .map-dock .draw-tools button { padding-inline: 0; inline-size: var(--ms-control); }
/* Collapse the label to assistive text, never display:none. Hiding it would
   delete the accessible name and break every getByRole({ name }) query at
   narrow widths -- which is what the previous font-size:0 plus ::first-letter
   trick did, while also rendering the toolbar as "P E M U R D". */
.map-dock .draw-tools .ms-btn__label { position: absolute; overflow: hidden; inline-size: 1px; block-size: 1px; margin: -1px; padding: 0; border: 0; clip-path: inset(50%); white-space: nowrap; }
}
@media (forced-colors: active) {
/* The map is painted to canvas, so the UA would otherwise invert it. The
   previous block here targeted the mock-map layer that the renderer replaced,
   which meant the map had no forced-colors treatment at all. */
.scene-canvas, .overlay-canvas { forced-color-adjust: none; }
.map-root { border: 1px solid CanvasText; }
}
  `]}#r;#t;#i;#a;#x;#s;#d;#u;#l;#m;#P;#e(n,t,o){return ie(this.localize,n,t,o)}connectedCallback(){super.connectedCallback(),this.#c(),this.updateComplete.then(()=>this.#w())}firstUpdated(){this.#w()}#w(){if(!this.isConnected||this.#t||this.#i)return;let n=this.renderRoot.querySelector(".map-root"),t=this.renderRoot.querySelector(".scene-canvas"),o=this.renderRoot.querySelector(".overlay-canvas");!n||!t||!o||(this.#t=new Q(t,o,{onViewport:()=>{this.#P.value?.cancel(),this.requestUpdate()},onCamera:(i,a,s)=>{this.#n({type:"set-camera",view:this.state.workflow==="draw"?"top":this.state.view,camera:{yaw:i.yaw,pitch:i.pitch,zoom:a/100,targetX:i.targetX,targetZ:i.targetZ}}),this.state.workflow==="draw"&&a!==this.state.draw.zoomPercent&&this.#n({type:"set-zoom",value:a,...s?{originX:s.xPercent,originY:s.yPercent}:{}})},onCameraPreferences:i=>{for(let a of["top","three"]){let s=i[a];s&&this.#n({type:"set-camera",view:a,camera:s})}},onRoom:i=>this.#n({type:"toggle-room",roomId:i}),onProblem:()=>this.#b("renderer-problem")}),this.#i=new V(n,this.#t,{state:()=>this.state,onOutlinePoint:(i,a)=>{let s=this.#P.value;s?s.addPoint(i,a):this.#P.request().then(l=>l?.addPoint(i,a))},onCircles:(i,a)=>this.#n({type:"set-draft-circles",circles:i,coordinateEdit:a}),onCirclePreview:(i,a)=>this.#t?.setCirclePreview(i,a),onRoom:i=>this.#n({type:"toggle-room",roomId:i})}),this.#t.setState(this.state),this.#$())}disconnectedCallback(){this.#h(),this.#S(),this.#P.value?.cancel(),this.#i?.dispose(),this.#i=null,this.#t?.dispose(),this.#t=null,super.disconnectedCallback()}updated(n){this.#x&&(this.#x=!1,this.renderRoot.querySelector(".navigation-help button")?.focus()),n.has("state")&&(this.#i?.observeState(this.state),this.state.workflow==="draw"&&this.#P.request(),this.#P.value?.observeState(this.state),this.#t?.setState(this.state))}#z(){let n=this.renderRoot?.querySelector(".map-root");!n||!this.#t||this.#t.setPalette(Fe(n))}#$(){this.#S(),this.#u=window.requestAnimationFrame(()=>{this.#u=null,this.#l=window.setTimeout(()=>{this.#l=null,this.#z()},0)})}#S(){this.#u!==null&&window.cancelAnimationFrame(this.#u),this.#l!==null&&window.clearTimeout(this.#l),this.#u=null,this.#l=null}#g;#c(){if(!(typeof document>"u"||this.#s)&&(this.#s=new MutationObserver(this.#g),this.#s.observe(document.documentElement,{attributes:!0,attributeFilter:["style","class"]}),typeof window.matchMedia=="function")){this.#d=[window.matchMedia("(prefers-color-scheme: dark)"),window.matchMedia("(forced-colors: active)")];for(let n of this.#d)n.addEventListener("change",this.#g)}}#h(){this.#S(),this.#s?.disconnect(),this.#s=null;for(let n of this.#d)n.removeEventListener("change",this.#g);this.#d=[]}#n(n){this.dispatchEvent(new CustomEvent($t,{detail:n,bubbles:!0,composed:!0}))}#b(n){this.dispatchEvent(new CustomEvent(It,{detail:{id:n},bubbles:!0,composed:!0}))}#_(n){this.#r=n.currentTarget,this.#a=!this.#a,this.#x=this.#a,this.requestUpdate()}#E(){if(!this.#a)return;this.#a=!1,this.requestUpdate();let n=this.#r;n?.isConnected&&n.focus()}#f(){this.#n({type:"clear-selection"})}#v(n,t){this.#t?.orbitBy(n,t)}#L(n){if(!Ue(n)&&!(n.ctrlKey||n.metaKey||n.altKey)&&n.key==="Escape"){if(n.preventDefault(),this.#a){this.#E();return}this.#n({type:"dismiss-top-layer"});return}}rendererDiagnostics(){return this.#t?.diagnostics()??null}canvasIdentity(){return{scene:this.renderRoot.querySelector(".scene-canvas"),overlay:this.renderRoot.querySelector(".overlay-canvas")}}#I(){if(!this.state.host.connected)return{title:this.#e("v4_reconnecting","Reconnecting"),detail:this.#e("v4_reconnecting_detail","The verified map is read only until Home Assistant reconnects.")};if(!this.state.host.administrator)return{title:this.#e("v4_admin_required","Administrator access required"),detail:this.#e("v4_private_map_hidden","Private map data is hidden.")};if(this.state.host.robotCount===0)return{title:this.#e("v4_no_robot","No Matic robot set up"),detail:this.#e("v4_no_robot_detail","Set up a robot before opening its map.")};let n=this.state.notice;return this.state.dataMode==="live"&&this.state.floor.readOnly&&this.state.map.available&&n?.key==="v4_notice_saved_map"?{title:this.#e("v4_saved_map_read_only_title","Saved map is read only"),detail:this.#e(n.key,n.fallback,n.placeholders)}:this.state.dataMode==="history"?!this.state.map.available&&this.state.resources.scene.status==="loading"?{title:this.#e("v4_loading_saved_map","Loading saved map"),detail:this.#e("v4_loading_saved_map_detail","This read-only snapshot is still preparing.")}:this.state.map.available?null:{title:this.#e("v4_saved_map_unavailable","Saved map unavailable"),detail:this.#e("v4_saved_map_unavailable_detail","Choose another snapshot or return to the live map.")}:this.state.host.robotConnected?this.state.coherence==="verifying"||this.state.coherence==="booting"?{title:this.#e("v4_locating_map","Locating the current map"),detail:this.#e("v4_locating_map_detail","Map controls will return after the floor is verified.")}:!this.state.map.available&&this.state.resources.scene.status==="loading"?{title:this.#e("v4_loading_verified_map","Loading the verified map"),detail:this.#e("v4_loading_verified_map_detail","The current floor is verified. The private scene is still preparing.")}:this.state.map.available?this.state.activity==="problem"?{title:this.#e("v4_robot_attention","Robot needs attention"),detail:this.#e("v4_robot_attention_detail","Check the robot before starting another task.")}:null:{title:this.#e("v4_map_unavailable","Map unavailable"),detail:this.#e("v4_map_unavailable_detail","The private scene is not ready. No map data is shown until it is verified.")}:{title:this.#e("v4_robot_offline","Robot offline"),detail:this.#e("v4_robot_offline_detail","The last verified map stays read only and has no live position.")}}#q(n,t){let o=this.state,i=this.narrow,a=o.workflow==="draw",s=this.#e("v4_how_to_move","How to move the map"),l=n&&!a,c=l&&!i&&o.view==="top",d=l&&o.view==="three",p=!t,h=!i&&!a;return y`
      <div class="map-rail" data-map-control>
        <div class="map-context"><slot name="floor"></slot>
        ${l?y`
          <div class="view-switch ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#e("map_view_label","Map view")}>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(o.view==="three")}
              @click=${()=>this.#n({type:"set-view",view:"three"})}
            >${this.#e("map_view_3d","3D")}</button>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(o.view==="top")}
              @click=${()=>this.#n({type:"set-view",view:"top"})}
            >${this.#e("map_view_top","2D")}</button>
          </div>
        `:_}

        </div>
        ${c?y`
          <div class="appearance-switch ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#e("map_style_label","Map style")}>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(o.appearance==="photo")}
              @click=${()=>this.#n({type:"set-appearance",appearance:"photo"})}
            >${this.#e("map_style_photo","Photo")}</button>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(o.appearance==="rooms")}
              @click=${()=>this.#n({type:"set-appearance",appearance:"rooms"})}
            >${this.#e("map_style_room_colours","Floor plan")}</button>
          </div>
        `:_}

        ${d?y`
          <div class="camera-steps ms-surface ms-surface--floating ms-segment" role="toolbar" aria-orientation="horizontal" aria-label=${this.#e("map_camera_controls","Map camera controls")}>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#e("map_rotate_left","Rotate left")} aria-keyshortcuts="[" @click=${()=>this.#v(-52,0)}>${S(ke)}</button>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#e("map_tilt_down","Lower viewing angle")} aria-keyshortcuts="PageDown" @click=${()=>this.#v(0,30)}>${S(ge)}</button>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#e("map_tilt_up","Raise viewing angle")} aria-keyshortcuts="PageUp" @click=${()=>this.#v(0,-30)}>${S(we)}</button>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#e("map_rotate_right","Rotate right")} aria-keyshortcuts="]" @click=${()=>this.#v(52,0)}>${S(Me)}</button>
          </div>
        `:_}

        ${p?y`
          <div class="map-tools ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#e("v4_map_tools","Map tools")}>
            ${t?_:y`
              <button
                class="fit ms-btn"
                type="button"
                aria-label=${this.#e("v4_fit_map_hint","Fit the whole map on screen")}
                @click=${()=>{this.#t?.fit(),this.#n({type:"fit-map"})}}
                title=${this.#e("v4_fit_map","Fit map")}
              >${S(_e)}<span class="ms-btn__label">${this.#e("v4_fit_map","Fit map")}</span></button>
            `}
          </div>
        `:_}
        ${!t&&h?y`
          <div class="map-extras ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#e("v4_map_display","Map display")}>
              <button
                class="labels ms-btn"
                type="button"
                aria-pressed=${String(o.labelsVisible)}
                @click=${()=>this.#n({type:"toggle-labels"})}
                title=${this.#e("v4_room_names","Room names")}
              >${S(xe)}<span class="ms-btn__label">${this.#e("v4_room_names","Room names")}</span></button>
              <button
                class="help ms-btn ms-btn--icon"
                type="button"
                aria-label=${s}
                aria-expanded=${String(this.#a)}
                aria-controls=${it}
                @click=${this.#_}
                title=${s}
              >${S(Ce)}</button>
          </div>
        `:_}

        ${this.#a&&n&&h?y`
          <div
            id=${it}
            class="navigation-help ms-surface ms-surface--floating"
            role="dialog"
            aria-modal="false"
            aria-label=${s}
          >
            <header>
              <h3>${s}</h3>
              <button class="ms-btn ms-btn--sm" type="button" @click=${()=>this.#E()}>${this.#e("v4_close","Close")}</button>
            </header>
            <dl>
              <dt>${this.#e("v4_trackpad","Trackpad")}</dt>
              <dd>${this.#e("v4_trackpad_help","Scroll to pan \xB7 pinch to zoom \xB7 twist to rotate")}</dd>
              <dt>${this.#e("v4_mouse","Mouse")}</dt>
              <dd>${this.#e("v4_mouse_help","Drag to orbit \xB7 Shift, middle, or right drag to pan \xB7 wheel to zoom")}</dd>
              <dt>${this.#e("v4_keyboard","Keyboard")}</dt>
              <dd>${this.#e("v4_keyboard_help","WASD to move \xB7 Q/E or arrows to orbit \xB7 +/\u2212 to zoom \xB7 0 to fit")}</dd>
            </dl>
          </div>
        `:_}
      </div>
    `}#o(n){let t=this.state;if(!n)return _;if(t.workflow==="draw"&&!this.narrow)return y`
        <div class="map-dock ms-surface ms-surface--floating" data-map-control>
          ${ze(t,{intent:i=>this.#n(i),openBrush:()=>this.#n({type:"set-precision-open",value:!t.precisionOpen}),t:(i,a,s)=>this.#e(i,a,s)},"row")}
        </div>
      `;let o=t.selection.roomIds.length;return t.workflow==="rooms"&&o>0&&!this.narrow?y`
        <div class="map-dock ms-surface ms-surface--floating" data-map-control>
          <div class="selection-chip ms-surface ms-surface--floating" data-map-control>
            <span>${this.#e("v4_rooms_selected","Rooms selected: {count}",{count:o})}</span>
            <button class="ms-btn ms-btn--sm" type="button" @click=${()=>this.#f()}>${this.#e("v4_clear","Clear")}</button>
          </div>
        </div>
      `:_}render(){let n=this.state,t=ue(n),o=this.#I(),i=n.map.available&&(te(n)||n.dataMode==="history"),a=n.workflow==="draw"&&i,s=n.coherence==="verifying"||n.coherence==="booting";return y`
      <section
        class="map-root"
        tabindex="0"
        aria-label=${this.#e("map_viewport_aria","Interactive Matic 3D map")}
        aria-describedby=${a?n.draw.tool==="outline"?"zone-keyboard-help":"keyboard-draw-help":_}
        data-full-map=${String(n.fullMap)}
        data-workflow=${n.workflow}
        data-draw-tool=${n.draw.tool}
        data-narrow=${this.narrow?"true":_}
        @keydown=${this.#L}
        @pointerdown=${this.#m}
      >
        ${this.#q(i,s)}
        <slot name="scrim"></slot>

        <div
          class="scene-window"
          data-renderer-key="persistent-canvas-v4"
          ?hidden=${!i}
          role=${a?"group":"img"}
          aria-label=${ot(n,this.localize)}
        >
          ${a?y`<span class="keyboard-aim" aria-hidden="true"></span>`:_}
          <canvas class="scene-canvas"></canvas>
          <canvas class="overlay-canvas"></canvas>
          ${a?this.#P.value?.render()??_:_}
        </div>

        ${a?y`
          <p id="zone-keyboard-help" class="sr-only">${this.#e("v4_zone_keyboard_help","Focus the map, aim with arrow keys, and press Enter to place points. The edges join automatically after three points. Keep adding points or Tab to a point; arrows move it, Delete removes it, and Escape cancels a drag.")}</p>
          <p id="keyboard-draw-help" class="sr-only">${this.#e("v4_keyboard_draw_help","Keyboard: focus the map, use arrow keys to aim, then Enter to paint or erase at the crosshair. D selects Paint; E selects Erase.")}</p>
          <div class="map-scale" aria-label=${`Scale ${t.label}`}>
            <span class="scale-line" style=${`--scale-width:${t.pixels}px`}></span>
            <span>${t.label}</span>
          </div>
        `:_}

        ${this.#o(i)}

        ${o&&!(n.fullMap&&(s||!n.host.administrator))?y`
          <div class="map-message ms-surface ms-surface--floating">
            <strong>${o.title}</strong>
            <span>${o.detail}</span>
          </div>
        `:_}
        <div class="sr-only" aria-live="polite" aria-atomic="true">
          ${ot(n,this.localize)}
        </div>
      </section>
    `}};customElements.get(oe)||customElements.define(oe,ce);export{oe as a,Ft as b,Dt as c,Nt as d,Ot as e,en as f,tn as g,nn as h,ut as i,on as j,rn as k,an as l,He as m,f as n,sn as o,ln as p,cn as q,dn as r,hn as s,un as t,pn as u,mn as v,ze as w,W as x,Ht as y,Ue as z,O as A,$t as B,It as C};
