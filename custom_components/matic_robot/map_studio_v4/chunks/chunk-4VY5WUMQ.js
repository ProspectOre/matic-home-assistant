import{$ as et,F as G,H as K,I as f,M as b,O as Z,P as j,Q,R as J,_ as tt,aa as it,ba as nt,ca as st,da as at,ea as ot,fa as rt,ga as lt,ha as ct,ia as ht,ja as dt,ka as ut,l as U,pa as pt,s as W,u as D,v as N,w as k,x as w,xa as M,ya as V}from"./chunk-OTYJ26W5.js";var mt=import.meta.url.match(/\/matic_robot\/[^/]+-([a-f0-9]{12})\/map-studio-v4(?:\/|$)/u)?.[1]??"dev",A=mt==="dev"?"":`-${mt}`,B=`matic-map-canvas-v4${A}`,jt=`matic-precision-controls-v4${A}`,Qt=`matic-map-workflow-v4${A}`,Jt=`matic-map-shell-v4${A}`,te=`matic-map-panel-v0-4-0${A}`;var z=(o,t,e)=>{let i=e.x-t.x,s=e.y-t.y,n=Math.max(0,Math.min(1,((o.x-t.x)*i+(o.y-t.y)*s)/(i*i+s*s||1)));return Math.hypot(o.x-t.x-n*i,o.y-t.y-n*s)},Rt=(o,t)=>{let e=!1;for(let i=0,s=t.length-1;i<t.length;s=i++){let n=t[i],a=t[s];n.y>o.y!=a.y>o.y&&o.x<(a.x-n.x)*(o.y-n.y)/(a.y-n.y)+n.x&&(e=!e)}return e},I=(o,t,e)=>(t.x-o.x)*(e.y-o.y)-(t.y-o.y)*(e.x-o.x),F=({points:o,closed:t})=>{if(o.length>64||t&&o.length<3||o.some(i=>!Number.isFinite(i.x)||!Number.isFinite(i.y)||Math.abs(i.x)>1e4||Math.abs(i.y)>1e4))return!1;let e=t?o.length:o.length-1;for(let i=0;i<e;i++){let s=o[i],n=o[(i+1)%o.length];if(Math.hypot(s.x-n.x,s.y-n.y)<.01)return!1;for(let a=i+2;a<e;a++){if(t&&i===0&&a===e-1)continue;let r=o[a],l=o[(a+1)%o.length];if(Math.min(z(s,r,l),z(n,r,l),z(r,s,n),z(l,s,n))<1e-5||I(s,n,r)*I(s,n,l)<0&&I(r,l,s)*I(r,l,n)<0)return!1}}return!t||Math.abs(o.reduce((i,s,n)=>{let a=o[(n+1)%o.length];return i+s.x*a.y-a.x*s.y},0))>.01},ft=(o,t)=>{if(!o.closed||!F(o))return[];let{points:e}=o,i=Math.min(...e.map(c=>c.x)),s=Math.max(...e.map(c=>c.x)),n=Math.min(...e.map(c=>c.y)),a=Math.max(...e.map(c=>c.y)),r=[];for(let c=0;c<32;c++)for(let d=0;d<32;d++){let p={x:Math.round((i+(d+.5)*(s-i)/32)*1e4)/1e4,y:Math.round((n+(c+.5)*(a-n)/32)*1e4)/1e4};if(!Rt(p,e)||!t(p))continue;let h=Math.min(...e.map((m,v)=>z(p,m,e[(v+1)%e.length]))),u=Math.floor(Math.min(2.5,h-1e-4)*1e4)/1e4;u>=.05&&r.push({...p,radius:u})}r.sort((c,d)=>d.radius-c.radius);let l=[];for(let c of r){if(l.length>=512)break;l.some(d=>Math.hypot(d.x-c.x,d.y-c.y)+c.radius*.5<=d.radius)||l.push(c)}return l};var X=class{constructor(t,e,i,s,n,a){this.state=t;this.renderer=e;this.intent=i;this.update=s;this.t=n;this.focusPoint=a}#e=null;#t="";#i=null;#o(t=this.state()){return k(t,"outline")!==null}#m(t,e){let i=e??k(this.state(),"outline");if(!w(this.state(),i))return;if(!F(t)){this.#t=this.t("v4_zone_invalid","Keep the outline from crossing itself."),this.update();return}let s=ft(t,n=>this.renderer()?.containsMapPoint(n)??!1);this.#t=t.closed&&!s.length?this.t("v4_zone_empty","Make the zone wider and keep it on mapped floor."):"",this.intent({type:"set-draft-circles",circles:s,outline:t,coordinateEdit:i})}addPoint(t,e){let i=e??k(this.state(),"outline");if(!w(this.state(),i)||i.tool!=="outline"||!this.renderer()?.containsMapPoint(t))return;let s=this.state().draw.outline??{points:[],closed:!1};if(s.points.length>=64)return;let n=[...s.points,t];this.#m({points:n,closed:n.length>=3},i)}#a(t){let e=this.state().draw.outline;if(!e)return;this.#i=null;let i=e.points.filter((s,n)=>n!==t);this.#m({points:i,closed:e.closed&&i.length>=3}),this.focusPoint(Math.min(t,i.length-1))}#r(t){let e=this.state().draw.outline;if(!e||e.points.length>=64)return;let i=e.points[t],s=e.points[(t+1)%e.points.length];if(!i||!s||!e.closed&&t===e.points.length-1)return;let n={x:(i.x+s.x)/2,y:(i.y+s.y)/2};this.#m({...e,points:[...e.points.slice(0,t+1),n,...e.points.slice(t+1)]}),this.focusPoint(t+1)}#d(t,e){if(t.button!==0||this.#e||t.pointerType==="touch"&&!t.isPrimary)return;let i=k(this.state(),"outline");if(!i)return;this.#i=e,this.update();let s=this.state().draw.outline;if(!s)return;t.stopPropagation(),t.preventDefault();let n=t.currentTarget;n.focus({preventScroll:!0}),n.setPointerCapture(t.pointerId),this.#e={index:e,pointer:t.pointerId,baseline:s,preview:s,target:n,capture:i}}observeState(t){this.#e&&!w(t,this.#e.capture)&&this.cancel()}#v(t){let e=this.#e;if(!e||e.pointer!==t.pointerId)return;if(t.stopPropagation(),t.preventDefault(),!w(this.state(),e.capture)){this.cancel();return}let i=this.renderer()?.screenToMap(t.clientX,t.clientY);!i||!this.renderer()?.containsMapPoint(i)||(e.preview={...e.baseline,points:e.baseline.points.map((s,n)=>n===e.index?i:s)},this.update())}#b(t){let e=this.#e;!e||e.pointer!==t.pointerId||(t.stopPropagation(),t.preventDefault(),this.#e=null,e.target.releasePointerCapture(t.pointerId),e.preview!==e.baseline&&this.#m(e.preview,e.capture),this.update())}cancel(){let t=this.#e;t&&(this.#e=null,t.target.hasPointerCapture(t.pointer)&&t.target.releasePointerCapture(t.pointer),this.update())}#M(t,e){if(t.ctrlKey||t.altKey||t.metaKey)return;if(t.key==="Escape"){t.stopPropagation(),this.cancel();return}let i=this.state().draw.outline;if(!i||!this.#o())return;if(t.key==="Delete"||t.key==="Backspace"){t.preventDefault(),t.stopPropagation(),this.#a(e);return}let s=t.shiftKey?.1:.02,n=t.key==="ArrowLeft"?-s:t.key==="ArrowRight"?s:0,a=t.key==="ArrowUp"?-s:t.key==="ArrowDown"?s:0;if(!n&&!a)return;t.preventDefault(),t.stopPropagation();let r=i.points[e],l=this.renderer()?.offsetMapPoint(r,n,a);l&&this.renderer()?.containsMapPoint(l)&&this.#m({...i,points:i.points.map((c,d)=>d===e?l:c)})}render(){if(!this.#o())return b;let t=this.#e?.preview??this.state().draw.outline,e=t?.points??[],i=e.map(r=>this.renderer()?.mapToScreen(r)),s=i.map((r,l)=>r?`${l?"L":"M"}${r.x},${r.y}`:"").join(" "),n=!t||F(t),a=this.#i!==null&&this.#i<e.length?this.#i:null;return f`
      <div class="zone-overlay">
        <svg aria-hidden="true"><path d=${s+(t?.closed?" Z":"")} class=${n?"":"invalid"} fill=${t?.closed?"var(--ms-accent)":"none"}></path></svg>
        ${i.map((r,l)=>r?f`
          <button class="zone-point" type="button" data-zone-index=${l} data-selected=${String(this.#i===l)} data-map-control style=${`left:${r.x}px;top:${r.y}px`}
            aria-label=${`${this.t("v4_zone_point","Zone point")} ${l+1}`} aria-describedby="zone-handle-help"
            title=${this.t("v4_zone_point_help","Drag to move. Arrow keys adjust; Delete removes.")}
            @pointerdown=${c=>this.#d(c,l)} @pointermove=${c=>this.#v(c)}
            @pointerup=${c=>this.#b(c)} @pointercancel=${()=>this.cancel()}
            @lostpointercapture=${()=>{this.#e&&this.cancel()}}
            @focus=${()=>{this.#i=l,this.update()}}
            @keydown=${c=>this.#M(c,l)}
          >${l+1}</button>
        `:b)}
        ${e.map((r,l)=>{let c=e[(l+1)%e.length];if(!c||!t?.closed&&l===e.length-1||e.length>=64)return b;let d={x:(r.x+c.x)/2,y:(r.y+c.y)/2},p=this.renderer()?.mapToScreen(d),h=i[l],u=i[(l+1)%i.length];return p&&h&&u&&Math.hypot(h.x-u.x,h.y-u.y)>=100?f`<button class="zone-point zone-midpoint" type="button" data-map-control
            style=${`left:${p.x}px;top:${p.y}px`} aria-label=${`${this.t("v4_zone_add_point","Add point after")} ${l+1}`}
            @click=${()=>this.#r(l)}>+</button>`:b})}
        <div class="zone-help" data-map-control>
          <span id="zone-handle-help" class="sr-only">${this.t("v4_zone_point_help","Drag to move. Arrow keys adjust; Delete removes.")}</span>
          ${a!==null?f`
            <div class="zone-point-actions ms-surface" role="group" aria-label=${`${this.t("v4_zone_point","Zone point")} ${a+1}`}>
              <span class="zone-selection">${this.t("v4_zone_point_short","Point")} ${a+1}</span>
              <button class="ms-btn" type="button" ?disabled=${e.length>=64||!t?.closed&&a===e.length-1} @click=${()=>this.#r(a)}>${this.t("v4_zone_insert_point","Insert point")}</button>
              <button class="ms-btn" type="button" aria-label=${`${this.t("v4_zone_delete_point","Delete point")} ${a+1}`} @click=${()=>this.#a(a)}>${this.t("v4_zone_delete_point","Delete point")}</button>
            </div>`:b}
          ${a===null||!t?.closed?f`
            <div class="zone-guidance ms-surface">
              <span>${t?.closed?this.t("v4_zone_edit_help","Tap to add points. Drag points to reshape."):this.t("v4_zone_create_help","Place points around the area. The edges join automatically.")}</span>
            </div>`:b}
          <span class="zone-feedback ms-surface" role="status" ?hidden=${!this.#t}>${this.#t}</span>
        </div>
      </div>
    `}};var Lt=["outline","paint","erase","pan"],bt=(o,t,e)=>{let{draw:i}=o,s=`${i.brushMeters.toFixed(2)} m`;return f`
    <div
      class=${`draw-tools draw-tools--${e} ms-segment`}
      data-zone=${String(i.tool==="outline")}
      role="toolbar"
      aria-label=${t.t("v4_draw_tools","Draw area tools")}
      data-map-control
    >
      ${Lt.map(n=>f`
        <button
          class="ms-btn"
          type="button"
          aria-pressed=${String(i.tool===n)}
          data-tool=${n}
          @click=${()=>t.intent({type:"set-draw-tool",tool:n})}
        >${M(n==="outline"?pt:n==="paint"?ct:n==="erase"?dt:ut)}<span class="ms-btn__label">${n==="outline"?t.t("v4_zone_tool","Zone"):n==="paint"?t.t("area_paint","Paint"):n==="erase"?t.t("area_erase","Erase"):t.t("move_map","Move map")}</span></button>
      `)}
      <button
        class="ms-btn"
        type="button"
        ?disabled=${i.strokeCount===0}
        @click=${()=>t.intent({type:"undo-draft"})}
      >${M(rt)}<span class="ms-btn__label">${t.t("undo","Undo")}</span></button>
      <button
        class="ms-btn"
        type="button"
        ?disabled=${i.redo.length===0}
        @click=${()=>t.intent({type:"redo-draft"})}
      >${M(lt)}<span class="ms-btn__label">${t.t("redo","Redo")}</span></button>
      ${i.tool!=="outline"?f`<button
        class="ms-btn draw-brush"
        type="button"
        aria-label=${t.t("v4_brush_button","Brush width, {brush}. Opens brush settings.").replace("{brush}",s)}
        aria-expanded=${String(o.precisionOpen)}
        aria-haspopup="dialog"
        @click=${t.openBrush}
      >${M(ht)}<span class="ms-btn__label">${t.t("v4_brush","Brush {brush}").replace("{brush}",s)}</span></button>`:b}
    </div>
  `};var Dt=o=>o.matches(":disabled, [aria-disabled='true']"),T=class{#e;#t;#i=null;#o=null;constructor(t,e){this.#e=t,this.#t=e,t.addController(this)}hostConnected(){this.#e.addEventListener("focusin",this.#r)}hostDisconnected(){this.#e.removeEventListener("focusin",this.#r),this.#i?.removeEventListener("keydown",this.#d),this.#i=null,this.#o=null}hostUpdated(){let t=this.#t.container();t!==this.#i&&(this.#i?.removeEventListener("keydown",this.#d),t?.addEventListener("keydown",this.#d),this.#i=t),this.#a()}#m(){let t=this.#i;return t?[...t.querySelectorAll(this.#t.items)].filter(e=>!Dt(e)):[]}#a(){let t=this.#m(),e=(this.#o&&t.includes(this.#o)?this.#o:null)??t.find(s=>s.matches("[aria-pressed='true'], [aria-checked='true']"))??t[0]??null;this.#o=e;let i=this.#i?.querySelectorAll(this.#t.items)??[];for(let s of i)s.tabIndex=s===e?0:-1}#r=t=>{let e=t.composedPath()[0];!(e instanceof HTMLElement)||!this.#i?.contains(e)||e.matches(this.#t.items)&&(this.#o=e,this.#a())};#d=t=>{if(t.defaultPrevented||t.ctrlKey||t.metaKey||t.altKey)return;let e=this.#t.orientation??"horizontal",i=e!=="vertical",s=e!=="horizontal",n=this.#m();if(!n.length)return;let a=t.composedPath()[0],r=Math.max(0,n.findIndex(d=>d===this.#o||a instanceof Node&&d.contains(a))),l;switch(t.key){case"ArrowLeft":if(!i)return;l=r-1;break;case"ArrowRight":if(!i)return;l=r+1;break;case"ArrowUp":if(!s)return;l=r-1;break;case"ArrowDown":if(!s)return;l=r+1;break;case"Home":l=0;break;case"End":l=n.length-1;break;default:return}t.preventDefault();let c=n[(l+n.length)%n.length];c&&(this.#o=c,this.#a(),c.focus())}};var vt={accent:["--ms-accent","Highlight",[6,120,206]],onAccent:["--ms-on-accent","HighlightText",[255,255,255]],text:["--ms-text","CanvasText",[38,50,56]],quiet:["--ms-text-quiet","GrayText",[75,92,105]],plate:["--ms-surface-card","Canvas",[250,252,253]],roomFill:["--ms-surface-sunken","Canvas",[231,238,242]]},It=o=>Math.max(0,Math.min(255,Math.round(o))),yt=o=>{let t=o.trim(),e=t.match(/^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i)?.[1];if(e){let d=e.length<=4?[e[0],e[1],e[2]].map(m=>Number.parseInt(`${m}${m}`,16)):[e.slice(0,2),e.slice(2,4),e.slice(4,6)].map(m=>Number.parseInt(m,16)),[p,h,u]=d;return p===void 0||h===void 0||u===void 0?null:[p,h,u]}let i=t.startsWith("color(srgb"),s=t.slice(t.indexOf("(")+1).match(/-?\d*\.?\d+/g);if(!s||s.length<3)return null;let n=i?255:1,a=s.slice(0,3).map(d=>It(Number(d)*n)),[r,l,c]=a;return r===void 0||l===void 0||c===void 0||[r,l,c].some(d=>Number.isNaN(d))?null:[r,l,c]},g=(o,t)=>`rgba(${o[0]},${o[1]},${o[2]},${t})`,wt=o=>{let t=window.matchMedia?.("(forced-colors: active)").matches??!1;if(!t){let s=document.createElement("span"),n=document.createElement("canvas");n.width=1,n.height=1;let a=n.getContext("2d",{colorSpace:"srgb",willReadFrequently:!0});s.setAttribute("aria-hidden","true"),s.style.cssText="position:absolute;inline-size:0;block-size:0;overflow:hidden;visibility:hidden;pointer-events:none",o.append(s);let r=l=>{let[c,,d]=vt[l];s.style.color=`var(${c}, transparent)`;let p=getComputedStyle(s).color;if(a){a.clearRect(0,0,1,1),a.fillStyle="transparent",a.fillStyle=p,a.fillRect(0,0,1,1);let[h,u,m,v]=a.getImageData(0,0,1,1).data;if(h!==void 0&&u!==void 0&&m!==void 0&&v!==void 0&&v!==0)return[h,u,m]}return yt(p)??d};try{return{accent:r("accent"),onAccent:r("onAccent"),text:r("text"),quiet:r("quiet"),plate:r("plate"),roomFill:r("roomFill"),forced:t}}finally{s.remove()}}let e=document.createElement("span");e.setAttribute("aria-hidden","true"),e.style.cssText="position:absolute;inline-size:0;block-size:0;overflow:hidden;visibility:hidden;pointer-events:none",o.append(e);let i=s=>{let[,n,a]=vt[s];return e.style.color=n,yt(getComputedStyle(e).color)??a};try{return{accent:i("accent"),onAccent:i("onAccent"),text:i("text"),quiet:i("quiet"),plate:i("plate"),roomFill:i("roomFill"),forced:t}}finally{e.remove()}};var gt=(o,t)=>Math.hypot(o.x-t.x,o.y-t.y),xt=(o,t)=>({x:(o.x+t.x)/2,y:(o.y+t.y)/2}),Mt=(o,t)=>Math.atan2(t.y-o.y,t.x-o.x),Ft=o=>{let t=o;for(;t>Math.PI;)t-=Math.PI*2;for(;t<-Math.PI;)t+=Math.PI*2;return t},S=(o,t,e)=>Math.max(t,Math.min(e,o)),Ct=o=>o.map(t=>({...t})),Xt="button, input, select, textarea, a, [contenteditable='true'], [role='button'], [role='menuitem'], [data-map-control]",E=o=>o.composedPath().some(t=>t instanceof Element&&t.matches(Xt)),Pt=o=>o.composedPath().some(t=>t instanceof Element&&t.matches("select")),O=class{#e;#t;#i;#o=new Map;#m=!1;#a="idle";#r=[];#d=null;#v=0;#b=null;#M=0;#n=null;#y=null;#k=null;#_=0;#u=null;#w=!1;#c=null;#h=null;#l=!1;constructor(t,e,i){this.#e=t,this.#t=e,this.#i=i,t.addEventListener("pointerdown",this.#$),t.addEventListener("pointermove",this.#s),t.addEventListener("pointerup",this.#g),t.addEventListener("pointercancel",this.#g),t.addEventListener("wheel",this.#f,{passive:!1}),t.addEventListener("gesturestart",this.#z,{passive:!1}),t.addEventListener("gesturechange",this.#E,{passive:!1}),t.addEventListener("gestureend",this.#P,{passive:!1}),t.addEventListener("dblclick",this.#D),t.addEventListener("contextmenu",this.#A),t.addEventListener("keydown",this.#T),t.addEventListener("keyup",this.#X),t.addEventListener("blur",this.#R)}#$=t=>{if(this.#l)return;let e=this.#i.state();if(!e.pageActive){this.observeState(e);return}if(!t.isPrimary&&t.pointerType==="mouse"||E(t))return;this.observeState(e),this.#e.focus({preventScroll:!0}),this.#S(),t.pointerType==="touch"&&!t.isPrimary&&this.#o.size===0&&this.#i.state().draw.tool==="outline"&&(this.#w=!0);let i=performance.now(),s={id:t.pointerId,type:t.pointerType,startX:t.clientX,startY:t.clientY,x:t.clientX,y:t.clientY,lastX:t.clientX,lastY:t.clientY,lastTime:i,velocityX:0,velocityY:0};if(this.#o.set(t.pointerId,s),this.#e.setPointerCapture?.(t.pointerId),this.#o.size>=2){this.#I(),this.#i.onCirclePreview(null),this.#h=null,this.#a="pinch",this.#e.classList.add("navigating"),this.#w=!0;let[l,c]=[...this.#o.values()];l&&c&&(this.#v=Math.max(1,gt(l,c)),this.#b=xt(l,c),this.#M=Mt(l,c),this.#n=this.#t.camera),t.preventDefault();return}let n=this.#i.state(),a=n.workflow==="draw"&&n.map.available&&!n.floor.readOnly;this.#w||this.#m||t.button===1||t.button===2||n.draw.tool==="pan"?(this.#a="pan",this.#y=this.#t.camera):a&&n.draw.tool==="outline"&&(this.#h=k(n,"outline"))?this.#a="outline":a&&(n.draw.tool==="paint"||n.draw.tool==="erase")&&(this.#h=k(n,n.draw.tool))?(this.#r=Ct(this.#h.baselineCircles),t.pointerType==="touch"?(this.#a="idle",this.#c=window.setTimeout(()=>{if(this.#c=null,this.#o.size!==1||this.#w||!w(this.#i.state(),this.#h)){this.#C();return}this.#a=n.draw.tool;let l=this.#o.get(t.pointerId);l&&this.#p(l.x,l.y)},110)):(this.#a=n.draw.tool,this.#p(t.clientX,t.clientY))):(this.#a=n.view==="three"&&!t.shiftKey?"orbit":"pan",this.#y=this.#t.camera),(this.#a==="pan"||this.#a==="orbit")&&this.#e.classList.add("navigating"),t.preventDefault()};observeState(t){if(!t.pageActive){this.#S(),this.#I(),this.#i.onCirclePreview(null),this.#t.setCursor(null),this.#h=null,this.#r=[],this.#d=null,this.#b=null,this.#n=null,this.#y=null,this.#k=null,this.#_=0,this.#m=!1,this.#w=!1,this.#a="idle",this.#e.classList.remove("navigating");for(let e of this.#o.keys())this.#e.hasPointerCapture?.(e)&&this.#e.releasePointerCapture?.(e);this.#o.clear();return}this.#h&&!w(t,this.#h)&&this.#C()}#C(){if(this.#I(),this.#i.onCirclePreview(null),this.#h=null,this.#r=[],this.#d=null,this.#a==="paint"||this.#a==="erase"||this.#a==="outline"||this.#a==="idle"){this.#a="idle",this.#w=!1,this.#e.classList.remove("navigating");for(let t of this.#o.keys())this.#e.releasePointerCapture?.(t);this.#o.clear()}}#s=t=>{let e=this.#i.state();if(!e.pageActive){this.observeState(e);return}if(this.#h&&!w(this.#i.state(),this.#h)){this.#C();return}let i=this.#o.get(t.pointerId);if(!i){let p=this.#t.screenToMap(t.clientX,t.clientY);this.#t.setCursor(p);return}let n=(t.getCoalescedEvents?.()||[]).at(-1)||t,a=performance.now(),r=Math.max(1,a-i.lastTime),l=(n.clientX-i.lastX)/r,c=(n.clientY-i.lastY)/r;if(i.velocityX=i.velocityX*.62+l*.38,i.velocityY=i.velocityY*.62+c*.38,i.lastX=n.clientX,i.lastY=n.clientY,i.lastTime=a,i.x=n.clientX,i.y=n.clientY,this.#a==="pinch"&&this.#o.size>=2){let[p,h]=[...this.#o.values()];if(!p||!h)return;let u=Math.max(1,gt(p,h)),m=xt(p,h),v=Mt(p,h),y=this.#n;if(y&&this.#b){let C={...y,distance:y.distance*this.#v/u,yaw:y.yaw+Ft(v-this.#M),pitch:y.orthographic?y.pitch:y.pitch-(m.y-this.#b.y)*.0035};this.#t.setCamera(this.#t.cameraAfterPan(C,m.x-this.#b.x,m.y-this.#b.y))}t.preventDefault();return}this.#a==="paint"||this.#a==="erase"?this.#p(t.clientX,t.clientY):this.#a==="pan"?this.#y&&this.#t.setCamera(this.#t.cameraAfterPan(this.#y,n.clientX-i.startX,n.clientY-i.startY)):this.#a==="orbit"&&this.#y&&this.#t.setCamera({...this.#y,yaw:this.#y.yaw+(n.clientX-i.startX)*.0045,pitch:this.#y.pitch-(n.clientY-i.startY)*.004});let d=this.#t.screenToMap(n.clientX,n.clientY);this.#t.setCursor(d),t.preventDefault()};#g=t=>{let e=this.#i.state();if(!e.pageActive){this.observeState(e);return}if(this.#h&&!w(this.#i.state(),this.#h)){this.#C();return}let i=this.#o.get(t.pointerId);if(!i)return;let s=this.#a;if(this.#o.delete(t.pointerId),this.#e.releasePointerCapture?.(t.pointerId),this.#I(),this.#a==="outline"&&t.type!=="pointercancel"&&w(this.#i.state(),this.#h)&&Math.hypot(i.x-i.startX,i.y-i.startY)<7){let n=this.#t.screenToMap(i.x,i.y);n&&this.#i.onOutlinePoint?.(n,this.#h)}if(t.type!=="pointercancel"&&(this.#a==="paint"||this.#a==="erase")&&w(this.#i.state(),this.#h)&&JSON.stringify(this.#r)!==JSON.stringify(this.#h.baselineCircles))this.#i.onCircles(this.#r,this.#h);else if(t.type!=="pointercancel"&&this.#a!=="pinch"&&!this.#w&&Math.hypot(i.x-i.startX,i.y-i.startY)<7&&["rooms","plan"].includes(this.#i.state().workflow)&&N(this.#i.state())){let n=this.#t.roomAt(i.x,i.y);n&&this.#i.onRoom(n)}if((this.#a==="paint"||this.#a==="erase")&&this.#i.onCirclePreview(null),this.#o.size===0)this.#a="idle",this.#h=null,this.#e.classList.remove("navigating"),this.#w=!1,this.#b=null,this.#n=null,this.#y=null,this.#d=null,(s==="pan"||s==="orbit")&&i.type!=="mouse"&&this.#L(i.velocityX,i.velocityY,s);else if(this.#a==="pinch"){this.#a="pan",this.#w=!0;let n=this.#o.values().next().value;n&&(n.startX=n.x,n.startY=n.y,n.velocityX=0,n.velocityY=0),this.#y=this.#t.camera,this.#n=null}t.preventDefault()};#p(t,e){if(!w(this.#i.state(),this.#h)){this.#C();return}let i=this.#t.screenToMap(t,e);if(!i)return;let n=this.#i.state().draw.brushMeters/2;if(this.#a==="erase")this.#r=this.#r.filter(a=>Math.hypot(a.x-i.x,a.y-i.y)>a.radius+n);else{if(!this.#t.containsMapPoint(i))return;let a=Math.max(.04,n*.55),r=this.#d||i,l=Math.hypot(i.x-r.x,i.y-r.y),c=Math.max(1,Math.ceil(l/a));for(let d=0;d<=c&&this.#r.length<512;d+=1){let p=d/c,h={x:r.x+(i.x-r.x)*p,y:r.y+(i.y-r.y)*p};this.#r.some(u=>Math.hypot(u.x-h.x,u.y-h.y)<Math.max(.025,n*.28))||this.#r.push({x:Math.round(h.x*1e4)/1e4,y:Math.round(h.y*1e4)/1e4,radius:Math.round(n*100)/100})}}this.#d=i,this.#i.onCirclePreview(this.#r,this.#h)}#f=t=>{if(this.#l||!this.#i.state().pageActive||E(t))return;t.preventDefault(),this.#e.focus({preventScroll:!0}),this.#S();let e=t.deltaMode===WheelEvent.DOM_DELTA_LINE?16:t.deltaMode===WheelEvent.DOM_DELTA_PAGE?Math.max(1,this.#e.clientHeight):1,i=t.deltaX*e,s=t.deltaY*e;if(t.ctrlKey||t.metaKey){this.#t.zoomAt(Math.exp(S(-s*.008,-.28,.28)),t.clientX,t.clientY);return}if(t.altKey&&this.#i.state().view==="three"){this.#t.orbitBy(0,S(s,-80,80)*.75);return}if(t.deltaMode!==WheelEvent.DOM_DELTA_PIXEL||Math.abs(i)<.5&&Math.abs(s)>=50){this.#t.zoomAt(Math.exp(S(-s*.0025,-.28,.28)),t.clientX,t.clientY);return}this.#t.panBy(-S(i,-80,80),-S(s,-80,80))};#z=t=>{this.#l||!this.#i.state().pageActive||E(t)||(this.#e.focus({preventScroll:!0}),this.#S(),this.#e.classList.add("navigating"),this.#k=this.#t.camera,this.#_=Number.isFinite(t.rotation)?t.rotation:0,t.preventDefault())};#E=t=>{if(this.#l||!this.#i.state().pageActive||E(t))return;let e=this.#k;if(!e||this.#o.size>=2)return;let i=Number.isFinite(t.scale)&&t.scale>0?Math.max(.1,t.scale):1,s=Number.isFinite(t.rotation)?t.rotation:0;this.#t.setCamera({...e,distance:e.distance/i,yaw:e.yaw+(s-this.#_)*Math.PI/180}),t.preventDefault()};#P=t=>{if(!this.#i.state().pageActive){this.observeState(this.#i.state());return}let e=this.#k!==null;this.#k=null,this.#_=0,this.#e.classList.remove("navigating"),e&&!E(t)&&t.preventDefault()};#q(t){let e=this.#i.state();if(t.repeat||this.#l||this.#o.size||t.composedPath()[0]!==this.#e||!this.#e.matches(":focus")||e.workflow!=="draw"||!N(e)||e.command!=="idle"&&e.command!=="failed"||e.draw.tool!=="paint"&&e.draw.tool!=="erase"&&e.draw.tool!=="outline")return;let s=this.#e.querySelector(".scene-canvas")?.getBoundingClientRect();if(!s?.width||!s.height)return;let n=k(e,e.draw.tool);if(n){if(t.preventDefault(),this.#S(),e.draw.tool==="outline"){let a=this.#t.screenToMap(s.left+s.width/2,s.top+s.height/2);a&&this.#i.onOutlinePoint?.(a,n);return}this.#r=Ct(n.baselineCircles),this.#d=null,this.#h=n,this.#a=e.draw.tool,this.#p(s.left+s.width/2,s.top+s.height/2),this.#a="idle",this.#d=null,this.#h=null,this.#i.onCirclePreview(null),JSON.stringify(this.#r)!==JSON.stringify(n.baselineCircles)&&this.#i.onCircles(this.#r,n)}}#T=t=>{if(this.#l||!this.#i.state().pageActive||E(t)||t.defaultPrevented||t.ctrlKey||t.metaKey||t.altKey)return;if(t.key==="Enter"){this.#q(t);return}if(t.code==="Space"){this.#m=!0,t.preventDefault();return}this.#S();let e=this.#i.state(),i=t.key.toLocaleLowerCase();if(t.key==="+"||t.key==="=")this.#t.zoomAt(1.25);else if(t.key==="-")this.#t.zoomAt(.8);else if(t.key==="0")this.#t.fit();else if(i==="3")this.#x({type:"set-view",view:"three"});else if(i==="t")this.#x({type:"set-view",view:"top"});else if(t.key==="[")this.#t.orbitBy(-40,0);else if(t.key==="]")this.#t.orbitBy(40,0);else if(t.key==="PageUp")this.#t.orbitBy(0,-30);else if(t.key==="PageDown")this.#t.orbitBy(0,30);else if(i==="d"&&e.workflow==="draw")this.#x({type:"set-draw-tool",tool:"paint"});else if(i==="e"&&e.workflow==="draw")this.#x({type:"set-draw-tool",tool:"erase"});else if(["arrowleft","arrowright","arrowup","arrowdown"].includes(i))if(e.view==="three"&&!t.shiftKey){let s=i==="arrowleft"?-24:i==="arrowright"?24:0,n=i==="arrowup"?-20:i==="arrowdown"?20:0;this.#t.orbitBy(s,n)}else{let s=i==="arrowleft"?30:i==="arrowright"?-30:0,n=i==="arrowup"?30:i==="arrowdown"?-30:0;this.#t.panBy(s,n)}else if(e.workflow!=="draw"&&["w","a","s","d"].includes(i))this.#t.panBy(i==="a"?34:i==="d"?-34:0,i==="w"?34:i==="s"?-34:0);else if(e.workflow!=="draw"&&(i==="q"||i==="e"))this.#t.orbitBy(i==="q"?-30:30,0);else return;t.preventDefault()};#X=t=>{t.code==="Space"&&(this.#m=!1)};#R=()=>{this.#m=!1,this.#C(),this.#t.setCursor(null),this.#e.classList.remove("navigating")};#D=t=>{this.#l||!this.#i.state().pageActive||E(t)||(this.#S(),this.#t.zoomAt(t.shiftKey?1/1.6:1.6,t.clientX,t.clientY),t.preventDefault())};#A=t=>{E(t)||t.preventDefault()};#x(t){this.#e.dispatchEvent(new CustomEvent("matic-workspace-intent",{detail:t,bubbles:!0,composed:!0}))}#L(t,e,i){if(window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;let s=S(t,-.55,.55),n=S(e,-.55,.55);if(Math.hypot(s,n)<.02)return;let a=performance.now(),r=l=>{let c=Math.min(32,l-a);a=l,i==="orbit"?this.#t.orbitBy(s*c,n*c):this.#t.panBy(s*c,n*c);let d=.9**(c/16);s*=d,n*=d,Math.hypot(s,n)>=.01?this.#u=window.requestAnimationFrame(r):this.#u=null};this.#u=window.requestAnimationFrame(r)}#S(){this.#u!==null&&window.cancelAnimationFrame(this.#u),this.#u=null}#I(){this.#c!==null&&window.clearTimeout(this.#c),this.#c=null}dispose(){this.#l||(this.#C(),this.#l=!0,this.#S(),this.#e.removeEventListener("pointerdown",this.#$),this.#e.removeEventListener("pointermove",this.#s),this.#e.removeEventListener("pointerup",this.#g),this.#e.removeEventListener("pointercancel",this.#g),this.#e.removeEventListener("wheel",this.#f),this.#e.removeEventListener("gesturestart",this.#z),this.#e.removeEventListener("gesturechange",this.#E),this.#e.removeEventListener("gestureend",this.#P),this.#e.removeEventListener("dblclick",this.#D),this.#e.removeEventListener("contextmenu",this.#A),this.#e.removeEventListener("keydown",this.#T),this.#e.removeEventListener("keyup",this.#X),this.#e.removeEventListener("blur",this.#R),this.#o.clear())}};var x=(o,t,e)=>Math.max(t,Math.min(e,o)),R=o=>{let t=o;for(;t>Math.PI;)t-=Math.PI*2;for(;t<-Math.PI;)t+=Math.PI*2;return t},Ot=o=>{switch(o){case"efficient":return .35;case"balanced":return .65;case"maximum":case"auto":return 1}},kt=o=>{let t=o.metadata.metersPerCell;return[(o.metadata.origin[0]+(o.metadata.span[0]-1)/2)*t,(o.metadata.origin[1]+(o.metadata.span[1]-1)/2)*t]},St=(o,t,e,i)=>{let s=kt(e),n=kt(i);return[o+(n[0]-s[0]),t+(s[1]-n[1])]},Ht=(o,t,e)=>{let[i,s]=St(o.targetX,o.targetZ,t,e);return{...o,targetX:i,targetZ:s}},$t=(o,t)=>{if(!t)return!0;let e=o==="top";return Math.abs(t.zoom-1)<.001&&Math.abs(t.targetX)<.001&&Math.abs(t.targetZ)<.001&&Math.abs(R(t.yaw-(e?0:-Math.PI/4)))<.001&&(e||Math.abs(t.pitch-.82)<.001)},qt=(o,t,e,i,s)=>Object.fromEntries(Object.entries(o).map(([n,a])=>{if(!a||$t(n,a))return[n,a];let[r,l]=St(a.targetX,a.targetZ,t,e),c=i[n],d=s[n],p=c>0&&d>0?a.zoom*d/c:a.zoom;return[n,{...a,targetX:r,targetZ:l,zoom:p}]})),_t=o=>{let t=o.resources.entry;return[o.dataMode,o.selection.floorId,t?.entryId??"none",t?.selectedFloorOrdinal??"none",t?.mapFloorOrdinal??"none",t?.mapSessionKey??"none"].join("|")},Wt={accent:[6,120,206],onAccent:[255,255,255],text:[38,50,56],quiet:[75,92,105],plate:[250,252,253],roomFill:[231,238,242],forced:!1},At=Math.PI/3.15,Nt=1.08,Vt=(o,t)=>{let e=At/2,i=Math.atan(Math.tan(e)*Math.max(.2,t));return o/Math.sin(Math.min(e,i))*Nt},Bt=(o,t)=>{let e=new Float32Array(16);for(let i=0;i<4;i+=1)for(let s=0;s<4;s+=1){let n=0;for(let a=0;a<4;a+=1)n+=(o[a*4+s]??0)*(t[i*4+a]??0);e[i*4+s]=n}return e},Yt=(o,t,e,i)=>{let s=1/Math.tan(o/2),n=new Float32Array(16);return n[0]=s/t,n[5]=s,n[10]=(i+e)/(e-i),n[11]=-1,n[14]=2*i*e/(e-i),n},Ut=(o,t,e,i,s,n)=>{let a=new Float32Array(16);return a[0]=2/(t-o),a[5]=2/(i-e),a[10]=-2/(n-s),a[12]=-(t+o)/(t-o),a[13]=-(i+e)/(i-e),a[14]=-(n+s)/(n-s),a[15]=1,a},Gt=(o,t)=>{let e=Math.hypot((o[0]??0)-(t[0]??0),(o[1]??0)-(t[1]??0),(o[2]??0)-(t[2]??0))||1,i=[((o[0]??0)-(t[0]??0))/e,((o[1]??0)-(t[1]??0))/e,((o[2]??0)-(t[2]??0))/e],s=Math.hypot(i[2]??0,i[0]??0)||1,n=[(i[2]??0)/s,0,-(i[0]??0)/s],a=[(i[1]??0)*(n[2]??0),(i[2]??0)*(n[0]??0)-(i[0]??0)*(n[2]??0),-(i[1]??0)*(n[0]??0)];return new Float32Array([n[0]??0,a[0]??0,i[0]??0,0,n[1]??0,a[1]??0,i[1]??0,0,n[2]??0,a[2]??0,i[2]??0,0,-((n[0]??0)*(o[0]??0)+(n[1]??0)*(o[1]??0)+(n[2]??0)*(o[2]??0)),-((a[0]??0)*(o[0]??0)+(a[1]??0)*(o[1]??0)+(a[2]??0)*(o[2]??0)),-((i[0]??0)*(o[0]??0)+(i[1]??0)*(o[1]??0)+(i[2]??0)*(o[2]??0)),1])},Et=(o,t,e)=>{let i=!1,s=e.at(-1);if(!s)return!1;for(let n of e){let[a,r]=n,[l,c]=s;r>t!=c>t&&o<(l-a)*(t-r)/(c-r)+a&&(i=!i),s=n}return i},H=class{#e;#t;#i;#o=null;#m=null;#a=null;#r=null;#d=null;#v=null;#b=null;#M=null;#n=null;#y=null;#k=null;#_=null;#u=null;#w=null;#c=null;#h=null;#l=null;#$=null;#C;#s={yaw:-Math.PI/4,pitch:.82,distance:12,targetX:0,targetZ:0,orthographic:!1};#g=12;#p=8;#f=4;#z=new Float32Array(16);#E=null;#P="unavailable";#q=0;#T=0;#X=0;#R=0;#D=1;#A={width:1,height:1,left:0,top:0};#x=!0;#L=!1;#S=Wt;constructor(t,e,i={}){this.#e=t,this.#t=e,this.#i=i,this.#m=e.getContext("2d",{alpha:!0}),this.#e.addEventListener("webglcontextlost",this.#tt),this.#e.addEventListener("webglcontextrestored",this.#et),this.#K(),this.#C=new ResizeObserver(()=>{let s=this.#g,n=this.#p;this.#Z(),this.#x&&(s!==this.#g||n!==this.#p)?this.fit(!1):this.requestRender()}),this.#C.observe(t)}get camera(){return{...this.#s}}#I(){return{minimum:Math.max(.2,this.#f*.04),maximum:this.#f*8}}#U(){let t=this.#c?.metadata.span,e=this.#c?.metadata.metersPerCell;return!t||e===void 0?{x:this.#f,z:this.#f}:{x:Math.max(.5,t[0]*e*.55),z:Math.max(.5,t[1]*e*.55)}}setCamera(t,e=!0){let i=this.#I(),s=this.#U();this.#s={yaw:R(t.yaw),pitch:t.orthographic?Math.PI/2-.018:x(t.pitch,.18,1.38),distance:x(t.distance,i.minimum,i.maximum),targetX:x(t.targetX,-s.x,s.x),targetZ:x(t.targetZ,-s.z,s.z),orthographic:t.orthographic},this.#x=!1,this.requestRender(),e&&this.#H()}cameraAfterPan(t,e,i){let s=this.#O(),n=t.distance*1.75/Math.max(200,s.height),a=Math.cos(t.yaw),r=-Math.sin(t.yaw),l=-Math.sin(t.yaw),c=-Math.cos(t.yaw),d=this.#U();return{...t,targetX:x(t.targetX-e*n*a+i*n*l,-d.x,d.x),targetZ:x(t.targetZ-e*n*r+i*n*c,-d.z,d.z)}}setState(t){if(this.#L)return;let e=this.#u,i=this.#c;this.#u=t,!t.pageActive&&this.#l!==null&&(window.cancelAnimationFrame(this.#l),this.#l=null);let s=t.resources.scene.value,n=null;if(s!==this.#c){let l=this.#c!==null&&e!==null&&this.#h===_t(t),c=l&&!this.#x;this.#c=s,this.#h=s?_t(t):null,n=this.#st(s,c,i,l,e?e.workflow==="draw"?"top":e.view:null)}(!e||e.quality!==t.quality)&&(this.#D=Ot(t.quality),this.#R=0);let a=e?.workflow!=="draw"&&t.workflow==="draw",r=e?.workflow==="draw"&&t.workflow!=="draw";if(!e||e.view!==t.view||a||r){let l=t.workflow==="draw"?"top":t.view;this.#s=this.#it(l,t,n),this.#x=this.#nt(l,t,n)}t.workflow==="draw"&&e?.draw.zoomPercent!==t.draw.zoomPercent&&Math.round(this.#p/this.#s.distance*100)!==t.draw.zoomPercent&&(this.#s={...this.#s,orthographic:!0,pitch:Math.PI/2-.018,distance:this.#p*100/t.draw.zoomPercent},this.#x=t.draw.zoomPercent===100&&Math.abs(this.#s.targetX)<.001&&Math.abs(this.#s.targetZ)<.001&&Math.abs(R(this.#s.yaw))<.001),(n||a)&&this.#H(),this.requestRender()}setCirclePreview(t,e){this.#w=t&&e?{circles:t,capture:e}:null,this.requestRender()}#it(t,e,i=null){let s=t==="top",n=s?this.#p:this.#g,a=i?.[t]??e.cameras[t];return a?{yaw:a.yaw,pitch:s?Math.PI/2-.018:a.pitch,distance:x(n/x(a.zoom,.01,100),Math.max(.2,this.#f*.04),this.#f*8),targetX:x(a.targetX,-this.#f,this.#f),targetZ:x(a.targetZ,-this.#f,this.#f),orthographic:s}:s?{yaw:0,pitch:Math.PI/2-.018,distance:n,targetX:0,targetZ:0,orthographic:!0}:{yaw:-Math.PI/4,pitch:.82,distance:n,targetX:0,targetZ:0,orthographic:!1}}#nt(t,e,i=null){let s=i?.[t]??e.cameras[t];return $t(t,s)}#G(t,e){let i=this.#o;if(!i)throw new Error("webgl-unavailable");let s=i.createShader(t);if(!s)throw new Error("shader-unavailable");if(i.shaderSource(s,e),i.compileShader(s),!i.getShaderParameter(s,i.COMPILE_STATUS))throw i.deleteShader(s),new Error("shader-failed");return s}#K(){try{this.#o=this.#e.getContext("webgl2",{alpha:!0,antialias:!0,depth:!0,powerPreference:"high-performance"});let t=this.#o;if(!t)throw new Error("webgl2-unavailable");let e=this.#G(t.VERTEX_SHADER,`#version 300 es
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
      `),i=this.#G(t.FRAGMENT_SHADER,`#version 300 es
        precision highp float;
        in vec3 vColor;
        out vec4 outColor;
        void main() {
          vec2 point = gl_PointCoord * 2.0 - 1.0;
          if (dot(point, point) > 1.0) discard;
          float edge = smoothstep(1.0, 0.72, dot(point, point));
          outColor = vec4(pow(vColor, vec3(0.94)), edge);
        }
      `),s=t.createProgram();if(!s)throw new Error("program-unavailable");if(t.attachShader(s,e),t.attachShader(s,i),t.linkProgram(s),t.deleteShader(e),t.deleteShader(i),!t.getProgramParameter(s,t.LINK_STATUS))throw new Error("program-failed");this.#d=s,this.#M=t.getUniformLocation(s,"uViewProjection"),this.#n=t.getUniformLocation(s,"uCenter"),this.#y=t.getUniformLocation(s,"uMetersPerCell"),this.#k=t.getUniformLocation(s,"uPointPixels"),this.#_=t.getUniformLocation(s,"uMaxPointPixels"),this.#v=t.createBuffer(),this.#b=t.createVertexArray(),t.bindVertexArray(this.#b),t.bindBuffer(t.ARRAY_BUFFER,this.#v),t.enableVertexAttribArray(0),t.vertexAttribIPointer(0,2,t.UNSIGNED_SHORT,8,0),t.enableVertexAttribArray(1),t.vertexAttribIPointer(1,1,t.UNSIGNED_BYTE,8,4),t.enableVertexAttribArray(2),t.vertexAttribPointer(2,3,t.UNSIGNED_BYTE,!0,8,5),t.bindVertexArray(null),t.enable(t.DEPTH_TEST),t.depthFunc(t.LEQUAL),t.enable(t.BLEND),t.blendFunc(t.SRC_ALPHA,t.ONE_MINUS_SRC_ALPHA),this.#P="webgl2",this.#q+=1,this.#c&&this.#N(this.#c)}catch{this.#W(),this.#j()}}#st(t,e=!1,i=null,s=!1,n=null){if(this.#Q(),!t)return this.#T=0,this.requestRender(),null;let[a,r]=t.metadata.span,l=t.metadata.metersPerCell,c=a*l,d=r*l;this.#f=Math.max(1,Math.hypot(c,d)/2);let p={three:this.#g,top:this.#p};this.#Z(),e&&i?this.setCamera(Ht(this.#s,i,t),!1):this.fit(!1,n??void 0);let h=this.#u;if(s&&i&&h){let u={three:this.#g,top:this.#p},m=qt(h.cameras,i,t,p,u),v=n??(h.workflow==="draw"?"top":h.view),y=v==="top"?this.#p:this.#g;return m[v]={yaw:this.#s.yaw,pitch:this.#s.pitch,zoom:y/Math.max(.2,this.#s.distance),targetX:this.#s.targetX,targetZ:this.#s.targetZ},this.#i.onCameraPreferences?.(m),this.#P==="webgl2"?this.#N(t):this.#V(t),m}return this.#P==="webgl2"?this.#N(t):this.#V(t),null}#Z(){let t=this.#c;if(!t)return;let[e,i]=t.metadata.span,s=t.metadata.metersPerCell,n=e*s,a=i*s,r=this.#O(),l=Math.max(.2,r.width/Math.max(1,r.height));this.#g=Vt(this.#f,l),this.#p=Math.max(a/2,n/(2*l))*1.12}#N(t){let e=this.#o;if(!e||!this.#v)return;let i=new Uint8Array(t.buffer,t.pointOffset,t.total*8);e.bindBuffer(e.ARRAY_BUFFER,this.#v),e.bufferData(e.ARRAY_BUFFER,i,e.STATIC_DRAW),this.#T=t.total}#j(){this.#P="canvas2d",this.#r=document.createElement("canvas"),this.#r.width=1024,this.#r.height=1024,this.#a=this.#r.getContext("2d",{alpha:!0}),this.#a?this.#c&&this.#V(this.#c):(this.#P="unavailable",this.#i.onProblem?.("renderer-unavailable"))}#V(t){let e=this.#a;if(!e||!this.#r)return;e.clearRect(0,0,this.#r.width,this.#r.height);let i=new DataView(t.buffer,t.pointOffset,t.total*8),s=Math.min(t.total,5e4),n=Math.max(1,Math.ceil(t.total/s)),a=0,r=0,l=()=>{if(this.#L||t!==this.#c||!this.#r)return;let c=Math.min(t.total,a+n*4e3);for(;a<c;a+=n){let d=a*8,p=i.getUint16(d,!0)/Math.max(1,t.metadata.span[0])*this.#r.width,h=i.getUint16(d+2,!0)/Math.max(1,t.metadata.span[1])*this.#r.height,u=i.getUint8(d+5),m=i.getUint8(d+6),v=i.getUint8(d+7);e.fillStyle=`rgb(${u} ${m} ${v})`,e.fillRect(p,h,1.5,1.5),r+=1}this.#T=r,this.requestRender(),a<t.total?this.#$=window.setTimeout(l,0):this.#$=null};l()}#Q(){this.#$!==null&&window.clearTimeout(this.#$),this.#$=null}#O(){let t=this.#e.getBoundingClientRect();return this.#A={width:t.width,height:t.height,left:t.left,top:t.top},this.#A}#at(){let t=!1,e=this.#O(),i=Math.min(window.devicePixelRatio||1,3),s=Math.max(1,Math.round(e.width*i)),n=Math.max(1,Math.round(e.height*i));for(let a of[this.#e,this.#t])(a.width!==s||a.height!==n)&&(a.width=s,a.height=n,t=!0);t&&this.#i.onViewport?.()}#B(){let t=this.#A,e=Math.max(.2,t.width/Math.max(1,t.height)),i=Math.cos(this.#s.pitch)*this.#s.distance,s=[this.#s.targetX+Math.sin(this.#s.yaw)*i,Math.sin(this.#s.pitch)*this.#s.distance,this.#s.targetZ+Math.cos(this.#s.yaw)*i],n=[this.#s.targetX,0,this.#s.targetZ],a=Gt(s,n),r=this.#s.orthographic?Ut(-this.#s.distance*e,this.#s.distance*e,-this.#s.distance,this.#s.distance,-this.#f*4,this.#f*4):Yt(At,e,.02,Math.max(60,this.#f*12));return Bt(r,a)}requestRender(){this.#l!==null||this.#L||this.#u?.pageActive===!1||(this.#l=window.requestAnimationFrame(()=>{this.#l=null,this.#ot()}))}#ot(){if(this.#L||this.#u?.pageActive===!1)return;let t=performance.now();this.#at(),this.#z=this.#B(),this.#P==="webgl2"?this.#rt():this.#lt(),this.#ht(),this.#X=performance.now()-t,this.#X>18?(this.#R+=1,this.#R>=3&&this.#u?.quality==="auto"&&(this.#D=Math.max(.25,this.#D*.75))):this.#R=Math.max(0,this.#R-1)}#rt(){let t=this.#o,e=this.#c;if(!t||(t.viewport(0,0,this.#e.width,this.#e.height),t.clearColor(0,0,0,0),t.clear(t.COLOR_BUFFER_BIT|t.DEPTH_BUFFER_BIT),!e||!this.#d||!this.#b))return;if(this.#u?.view==="top"&&this.#u.appearance==="rooms"){this.#T=0;return}t.useProgram(this.#d),t.bindVertexArray(this.#b),t.uniformMatrix4fv(this.#M,!1,this.#z),t.uniform2f(this.#n,(e.metadata.span[0]-1)/2,(e.metadata.span[1]-1)/2),t.uniform1f(this.#y,e.metadata.metersPerCell);let i=Math.min(window.devicePixelRatio||1,3),s=Math.max(1,Math.floor(e.total*this.#D)),n=Math.min(e.floorCount,s),a=Math.min(e.surfaceCount,Math.max(0,s-n));t.uniform1f(this.#k,this.#e.height*.038),t.uniform1f(this.#_,4.5*i),t.drawArrays(t.POINTS,0,n),t.uniform1f(this.#k,this.#e.height*.05),t.uniform1f(this.#_,7*i),t.drawArrays(t.POINTS,e.floorCount,a),t.bindVertexArray(null),this.#T=n+a}#lt(){}#ct(t,e,i=0){let s=this.#c;return s?[-(t-(s.metadata.span[0]-1)/2)*s.metadata.metersPerCell,i*s.metadata.metersPerCell,(e-(s.metadata.span[1]-1)/2)*s.metadata.metersPerCell]:null}#Y(t,e,i=0,s=!0,n=this.#z){let a=this.#ct(t,e,i);if(!a)return null;let[r,l,c]=a,d=(n[0]??0)*r+(n[4]??0)*l+(n[8]??0)*c+(n[12]??0),p=(n[1]??0)*r+(n[5]??0)*l+(n[9]??0)*c+(n[13]??0),h=(n[3]??0)*r+(n[7]??0)*l+(n[11]??0)*c+(n[15]??0);if(h<=.001)return null;let u=d/h,m=p/h;if(!Number.isFinite(u)||!Number.isFinite(m)||s&&(Math.abs(u)>1.15||Math.abs(m)>1.15))return null;let v=this.#A;return{x:(u*.5+.5)*v.width,y:(-m*.5+.5)*v.height}}#F(t,e,i=0,s=!0,n=this.#z){let a=this.#c;if(!a)return null;let r=t/a.metadata.metersPerCell-a.metadata.origin[0],l=e/a.metadata.metersPerCell-a.metadata.origin[1];return this.#Y(r,l,i,s,n)}#ht(){let t=this.#m,e=this.#c,i=this.#u;if(!t)return;let s=Math.min(window.devicePixelRatio||1,3),n=this.#A;if(t.setTransform(s,0,0,s,0,0),t.clearRect(0,0,n.width,n.height),!e||!i)return;let a=this.#S;if(this.#P==="canvas2d"&&this.#r&&!(i.view==="top"&&i.appearance==="rooms")){let h=this.#p/this.#s.distance,u=n.width*h,m=n.height*h,v=(n.width-u)/2-this.#s.targetX*32*h,y=(n.height-m)/2-this.#s.targetZ*32*h;t.drawImage(this.#r,v,y,u,m)}let r=this.#dt(i);if(i.labelsVisible||i.view==="top"&&i.appearance==="rooms"){t.lineWidth=1.5,t.font="600 12px system-ui, sans-serif",t.textAlign="center",t.textBaseline="middle";let h=[];for(let u of e.metadata.rooms){let m=r.has(u.name.toLocaleLowerCase());t.strokeStyle=m?g(a.accent,1):g(a.quiet,.7),t.fillStyle=m?g(a.accent,.26):i.view==="top"&&i.appearance==="rooms"?g(a.roomFill,.94):g(a.plate,.04),t.beginPath();let v=Math.max(1,Math.ceil(u.boundary.length/512)),y=!1;for(let _=0;_<u.boundary.length;_+=v){let q=u.boundary[_];if(!q)continue;let $=this.#Y(q[0],q[1],.2,!1);$&&(y?t.lineTo($.x,$.y):t.moveTo($.x,$.y),y=!0)}if(y&&(t.closePath(),t.fill(),t.stroke()),!i.labelsVisible)continue;let C=this.#Y(u.center[0],u.center[1],1);if(!C)continue;let L=t.measureText(u.name).width,P=new DOMRect(C.x-L/2-6,C.y-10,L+12,20);h.some(_=>P.left<_.right+8&&P.right+8>_.left&&P.top<_.bottom+4&&P.bottom+4>_.top)||(h.push(P),t.fillStyle=g(a.plate,.88),t.fillRect(P.x,P.y,P.width,P.height),t.fillStyle=g(a.text,1),t.fillText(u.name,C.x,C.y))}}let l=this.#w,c=l&&w(i,l.capture)?l.circles:i.draw.circles;if((i.workflow==="draw"||i.workflow==="areaReview")&&c.length)if(t.fillStyle=g(a.accent,.22),t.strokeStyle=g(a.accent,.92),t.lineWidth=1.5,i.draw.outline?.closed){t.beginPath();for(let h of c)this.#J(t,h,!1);t.fill()}else for(let h of c)this.#J(t,h);let d=i.draw.outline;if(d&&(i.workflow==="draw"||i.workflow==="areaReview")&&!(i.workflow==="draw"&&i.draw.tool==="outline")&&(t.beginPath(),d.points.forEach((h,u)=>{let m=this.#F(h.x,h.y,0,!1);m&&(u===0?t.moveTo(m.x,m.y):t.lineTo(m.x,m.y))}),d.closed&&t.closePath(),t.strokeStyle=g(a.accent,1),t.lineWidth=2,t.stroke()),this.#E&&i.workflow==="draw"&&(i.draw.tool==="paint"||i.draw.tool==="erase")){let h=this.#F(this.#E.x,this.#E.y),u=this.#F(this.#E.x+i.draw.brushMeters/2,this.#E.y);h&&u&&(t.beginPath(),t.arc(h.x,h.y,Math.max(2,Math.hypot(u.x-h.x,u.y-h.y)),0,Math.PI*2),t.strokeStyle=g(a.accent,1),t.lineWidth=2,t.stroke())}let p=i.resources.pose.value;if(D(i)&&p?.position){let h=this.#F(p.position[0],p.position[1],3);h&&(t.beginPath(),t.arc(h.x,h.y,7,0,Math.PI*2),t.fillStyle=g(a.accent,1),t.fill(),t.strokeStyle=g(a.onAccent,1),t.lineWidth=3,t.stroke())}}#dt(t){let e=t.resources.plans.value?.rooms||t.resources.areas.value?.rooms||[],i=new Set(t.workflow==="plan"?t.planDraft.rooms.map(n=>n.roomId):t.selection.roomIds),s=new Set;for(let n of e)i.has(n.roomId)&&s.add(n.name.toLocaleLowerCase());return s}#J(t,e,i=!0){let s=this.#F(e.x,e.y),n=this.#F(e.x+e.radius,e.y);if(!s||!n)return;let a=Math.max(1,Math.hypot(n.x-s.x,n.y-s.y));i&&t.beginPath(),t.moveTo(s.x+a,s.y),t.arc(s.x,s.y,a,0,Math.PI*2),i&&(t.fill(),t.stroke())}setPalette(t){this.#S=t,this.requestRender()}setCursor(t){this.#E=t,this.requestRender()}mapToScreen(t){if(!this.#c)return null;let e=this.#O();return!e.width||!e.height?null:this.#F(t.x,t.y,0,!1,this.#B())}offsetMapPoint(t,e,i){let s=this.mapToScreen(t);if(!s)return null;let n=this.#A,a=this.#s.distance*2/n.height;return this.screenToMap(n.left+s.x+e/a,n.top+s.y+i/a)}screenToMap(t,e){let i=this.#c;if(!i)return null;let s=this.#O();if(!s.width||!s.height)return null;let n=this.#B(),a=(t-s.left)/s.width*2-1,r=1-(e-s.top)/s.height*2,l=n[0]-a*n[3],c=n[8]-a*n[11],d=n[1]-r*n[3],p=n[9]-r*n[11],h=l*p-c*d;if(!Number.isFinite(h)||Math.abs(h)<1e-12)return null;let u=a*n[15]-n[12],m=r*n[15]-n[13],v=(u*p-c*m)/h,y=(l*m-u*d)/h;if(n[3]*v+n[11]*y+n[15]<=0)return null;let C=-v/i.metadata.metersPerCell+(i.metadata.span[0]-1)/2,L=y/i.metadata.metersPerCell+(i.metadata.span[1]-1)/2;return{x:(C+i.metadata.origin[0])*i.metadata.metersPerCell,y:(L+i.metadata.origin[1])*i.metadata.metersPerCell}}roomAt(t,e){let i=this.screenToMap(t,e),s=this.#c,n=this.#u;if(!i||!s||!n)return null;let a=i.x/s.metadata.metersPerCell-s.metadata.origin[0],r=i.y/s.metadata.metersPerCell-s.metadata.origin[1],l=s.metadata.rooms.find(c=>Et(a,r,c.boundary));return l?this.#ut(l,n):null}containsMapPoint(t){let e=this.#c;if(!e)return!1;let i=t.x/e.metadata.metersPerCell-e.metadata.origin[0],s=t.y/e.metadata.metersPerCell-e.metadata.origin[1];return e.metadata.rooms.some(n=>Et(i,s,n.boundary))}#ut(t,e){return(e.resources.plans.value?.rooms||e.resources.areas.value?.rooms||[]).find(s=>s.name.localeCompare(t.name,void 0,{sensitivity:"base"})===0)?.roomId||t.id}selectRoomAt(t,e){let i=this.roomAt(t,e);i&&this.#i.onRoom?.(i)}fit(t=!0,e=this.#u?.workflow==="draw"?"top":this.#u?.view??"three"){let i=e==="top";this.#s=i?{yaw:0,pitch:Math.PI/2-.018,distance:this.#p,targetX:0,targetZ:0,orthographic:!0}:{yaw:-Math.PI/4,pitch:.82,distance:this.#g,targetX:0,targetZ:0,orthographic:!1},this.#x=!0,this.requestRender(),t&&this.#H()}zoomAt(t,e,i){let s=e===void 0||i===void 0?null:this.screenToMap(e,i),n=this.#I();if(this.#s={...this.#s,distance:x(this.#s.distance/t,n.minimum,n.maximum)},this.#x=!1,s&&e!==void 0&&i!==void 0){let a=this.screenToMap(e,i);a&&(this.#s={...this.#s,targetX:this.#s.targetX-(s.x-a.x),targetZ:this.#s.targetZ+(s.y-a.y)})}this.requestRender(),this.#H(e,i)}panBy(t,e){this.setCamera(this.cameraAfterPan(this.#s,t,e))}orbitBy(t,e){if(this.#s.orthographic){this.panBy(t,e);return}this.#s={...this.#s,yaw:R(this.#s.yaw+t*.006),pitch:x(this.#s.pitch-e*.004,.18,1.38)},this.#x=!1,this.requestRender(),this.#H()}rotateBy(t){this.#s={...this.#s,yaw:R(this.#s.yaw+t)},this.#x=!1,this.requestRender(),this.#H()}#H(t,e){let i=this.#s.orthographic?this.#p:this.#g,s=t===void 0||e===void 0?this.#A:this.#O(),n=t===void 0||e===void 0||!s.width||!s.height?void 0:{xPercent:x((t-s.left)/s.width*100,0,100),yPercent:x((e-s.top)/s.height*100,0,100)};this.#i.onCamera?.(this.camera,Math.round(i/this.#s.distance*100),n)}diagnostics(){return{mode:this.#P,contextGeneration:this.#q,sceneRevision:this.#c?.revision??null,sourcePoints:this.#c?.total??0,renderedPoints:this.#T,lastFrameMs:Math.round(this.#X*100)/100,slowFrames:this.#R,cameraDistance:this.#s.distance,fitDistance:this.#s.orthographic?this.#p:this.#g,fitActive:this.#x}}#tt=t=>{t.preventDefault(),this.#W(),this.#j(),this.requestRender()};#et=()=>{this.#W(),this.#K(),this.requestRender()};#W(){let t=this.#o;t&&(this.#v&&t.deleteBuffer(this.#v),this.#b&&t.deleteVertexArray(this.#b),this.#d&&t.deleteProgram(this.#d)),this.#v=null,this.#b=null,this.#d=null,this.#o=null}dispose(){this.#L||(this.#L=!0,this.#C.disconnect(),this.#e.removeEventListener("webglcontextlost",this.#tt),this.#e.removeEventListener("webglcontextrestored",this.#et),this.#l!==null&&window.cancelAnimationFrame(this.#l),this.#l=null,this.#Q(),this.#W(),this.#r=null,this.#a=null,this.#m=null,this.#w=null,this.#c=null,this.#u=null)}};var Kt="matic-workspace-intent",Zt="matic-workspace-action",zt="navigation-help",Tt=(o,t)=>{let e=(s,n,a)=>V(t,s,n,a);if(o.dataMode==="history"||o.floor.readOnly)return o.map.available?e("v4_saved_map_description","Saved read-only map for {floor}. Live robot position is hidden.",{floor:o.floor.displayName}):o.resources.scene.status==="loading"?e("v4_saved_map_loading_description","The saved map is loading."):e("v4_saved_map_unavailable_description","This saved map is unavailable.");if(!W(o))return e("v4_private_map_unavailable","The current private map is not available.");let i=D(o)?e("v4_robot_position_verified","The robot position is verified."):e("v4_robot_position_hidden","The robot position is not shown.");return e("v4_live_map_description","Live map for {floor}. {pose}",{floor:o.floor.displayName,pose:i})},Y=class extends Z{constructor(){super();this.state=U();this.narrow=!1;this.#e=null;this.#t=null;this.#i=null;this.#o=!1;this.#m=!1;this.#a=null;this.#r=[];this.#d=null;this.#v=null;this.#b={capture:!0,handleEvent:e=>{e.pointerType==="touch"&&!e.isPrimary&&this.#M.cancel()}};this.#M=new X(()=>this.state,()=>this.#t,e=>this.#l(e),()=>this.requestUpdate(),(e,i)=>this.#n(e,i),e=>{this.updateComplete.then(()=>{(this.renderRoot.querySelector(`[data-zone-index="${e}"]`)??this.renderRoot.querySelector(".map-root"))?.focus({preventScroll:!0})})});this.#w=()=>{this.#_()};new T(this,{container:()=>this.renderRoot?.querySelector(".camera-steps")??null,items:"button"}),new T(this,{container:()=>this.renderRoot?.querySelector(".draw-tools")??null,items:"button"})}static{this.properties={state:{attribute:!1},localize:{attribute:!1},narrow:{type:Boolean,reflect:!0}}}static{this.styles=[j,Q,J,K`
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
  `]}#e;#t;#i;#o;#m;#a;#r;#d;#v;#b;#M;#n(e,i,s){return V(this.localize,e,i,s)}connectedCallback(){super.connectedCallback(),this.#c(),this.updateComplete.then(()=>this.#y())}firstUpdated(){this.#y()}#y(){if(!this.isConnected||this.#t||this.#i)return;let e=this.renderRoot.querySelector(".map-root"),i=this.renderRoot.querySelector(".scene-canvas"),s=this.renderRoot.querySelector(".overlay-canvas");!e||!i||!s||(this.#t=new H(i,s,{onViewport:()=>{this.#M.cancel(),this.requestUpdate()},onCamera:(n,a,r)=>{this.#l({type:"set-camera",view:this.state.workflow==="draw"?"top":this.state.view,camera:{yaw:n.yaw,pitch:n.pitch,zoom:a/100,targetX:n.targetX,targetZ:n.targetZ}}),this.state.workflow==="draw"&&a!==this.state.draw.zoomPercent&&this.#l({type:"set-zoom",value:a,...r?{originX:r.xPercent,originY:r.yPercent}:{}})},onCameraPreferences:n=>{for(let a of["top","three"]){let r=n[a];r&&this.#l({type:"set-camera",view:a,camera:r})}},onRoom:n=>this.#l({type:"toggle-room",roomId:n}),onProblem:()=>this.#$("renderer-problem")}),this.#i=new O(e,this.#t,{state:()=>this.state,onOutlinePoint:(n,a)=>this.#M.addPoint(n,a),onCircles:(n,a)=>this.#l({type:"set-draft-circles",circles:n,coordinateEdit:a}),onCirclePreview:(n,a)=>this.#t?.setCirclePreview(n,a),onRoom:n=>this.#l({type:"toggle-room",roomId:n})}),this.#t.setState(this.state),this.#_())}disconnectedCallback(){this.#h(),this.#u(),this.#M.cancel(),this.#i?.dispose(),this.#i=null,this.#t?.dispose(),this.#t=null,super.disconnectedCallback()}updated(e){this.#m&&(this.#m=!1,this.renderRoot.querySelector(".navigation-help button")?.focus()),e.has("state")&&(this.#i?.observeState(this.state),this.#M.observeState(this.state),this.#t?.setState(this.state))}#k(){let e=this.renderRoot?.querySelector(".map-root");!e||!this.#t||this.#t.setPalette(wt(e))}#_(){this.#u(),this.#d=window.requestAnimationFrame(()=>{this.#d=null,this.#v=window.setTimeout(()=>{this.#v=null,this.#k()},0)})}#u(){this.#d!==null&&window.cancelAnimationFrame(this.#d),this.#v!==null&&window.clearTimeout(this.#v),this.#d=null,this.#v=null}#w;#c(){if(!(typeof document>"u"||this.#a)&&(this.#a=new MutationObserver(this.#w),this.#a.observe(document.documentElement,{attributes:!0,attributeFilter:["style","class"]}),typeof window.matchMedia=="function")){this.#r=[window.matchMedia("(prefers-color-scheme: dark)"),window.matchMedia("(forced-colors: active)")];for(let e of this.#r)e.addEventListener("change",this.#w)}}#h(){this.#u(),this.#a?.disconnect(),this.#a=null;for(let e of this.#r)e.removeEventListener("change",this.#w);this.#r=[]}#l(e){this.dispatchEvent(new CustomEvent(Kt,{detail:e,bubbles:!0,composed:!0}))}#$(e){this.dispatchEvent(new CustomEvent(Zt,{detail:{id:e},bubbles:!0,composed:!0}))}#C(e){this.#e=e.currentTarget,this.#o=!this.#o,this.#m=this.#o,this.requestUpdate()}#s(){if(!this.#o)return;this.#o=!1,this.requestUpdate();let e=this.#e;e?.isConnected&&e.focus()}#g(){this.#l({type:"clear-selection"})}#p(e,i){this.#t?.orbitBy(e,i)}#f(e){if(!Pt(e)&&!(e.ctrlKey||e.metaKey||e.altKey)&&e.key==="Escape"){if(e.preventDefault(),this.#o){this.#s();return}this.#l({type:"dismiss-top-layer"});return}}rendererDiagnostics(){return this.#t?.diagnostics()??null}canvasIdentity(){return{scene:this.renderRoot.querySelector(".scene-canvas"),overlay:this.renderRoot.querySelector(".overlay-canvas")}}#z(){return this.state.host.connected?this.state.host.administrator?this.state.host.robotCount===0?{title:this.#n("v4_no_robot","No Matic robot set up"),detail:this.#n("v4_no_robot_detail","Set up a robot before opening its map.")}:this.state.dataMode==="live"&&this.state.floor.readOnly&&this.state.map.available&&this.state.notice?{title:this.#n("v4_saved_map_read_only_title","Saved map is read only"),detail:this.state.notice.text}:this.state.dataMode==="history"?!this.state.map.available&&this.state.resources.scene.status==="loading"?{title:this.#n("v4_loading_saved_map","Loading saved map"),detail:this.#n("v4_loading_saved_map_detail","This read-only snapshot is still preparing.")}:this.state.map.available?null:{title:this.#n("v4_saved_map_unavailable","Saved map unavailable"),detail:this.#n("v4_saved_map_unavailable_detail","Choose another snapshot or return to the live map.")}:this.state.host.robotConnected?this.state.coherence==="verifying"||this.state.coherence==="booting"?{title:this.#n("v4_locating_map","Locating the current map"),detail:this.#n("v4_locating_map_detail","Map controls will return after the floor is verified.")}:!this.state.map.available&&this.state.resources.scene.status==="loading"?{title:this.#n("v4_loading_verified_map","Loading the verified map"),detail:this.#n("v4_loading_verified_map_detail","The current floor is verified. The private scene is still preparing.")}:this.state.map.available?this.state.activity==="problem"?{title:this.#n("v4_robot_attention","Robot needs attention"),detail:this.#n("v4_robot_attention_detail","Check the robot before starting another task.")}:null:{title:this.#n("v4_map_unavailable","Map unavailable"),detail:this.#n("v4_map_unavailable_detail","The private scene is not ready. No map data is shown until it is verified.")}:{title:this.#n("v4_robot_offline","Robot offline"),detail:this.#n("v4_robot_offline_detail","The last verified map stays read only and has no live position.")}:{title:this.#n("v4_admin_required","Administrator access required"),detail:this.#n("v4_private_map_hidden","Private map data is hidden.")}:{title:this.#n("v4_reconnecting","Reconnecting"),detail:this.#n("v4_reconnecting_detail","The verified map is read only until Home Assistant reconnects.")}}#E(e,i){let s=this.state,n=this.narrow,a=s.workflow==="draw",r=this.#n("v4_how_to_move","How to move the map"),l=e&&!a,c=l&&!n&&s.view==="top",d=l&&s.view==="three",p=!i,h=!n&&!a;return f`
      <div class="map-rail" data-map-control>
        <div class="map-context"><slot name="floor"></slot>
        ${l?f`
          <div class="view-switch ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#n("map_view_label","Map view")}>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(s.view==="three")}
              @click=${()=>this.#l({type:"set-view",view:"three"})}
            >${this.#n("map_view_3d","3D")}</button>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(s.view==="top")}
              @click=${()=>this.#l({type:"set-view",view:"top"})}
            >${this.#n("map_view_top","2D")}</button>
          </div>
        `:b}

        </div>
        ${c?f`
          <div class="appearance-switch ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#n("map_style_label","Map style")}>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(s.appearance==="photo")}
              @click=${()=>this.#l({type:"set-appearance",appearance:"photo"})}
            >${this.#n("map_style_photo","Photo")}</button>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(s.appearance==="rooms")}
              @click=${()=>this.#l({type:"set-appearance",appearance:"rooms"})}
            >${this.#n("map_style_room_colours","Floor plan")}</button>
          </div>
        `:b}

        ${d?f`
          <div class="camera-steps ms-surface ms-surface--floating ms-segment" role="toolbar" aria-orientation="horizontal" aria-label=${this.#n("map_camera_controls","Map camera controls")}>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#n("map_rotate_left","Rotate left")} aria-keyshortcuts="[" @click=${()=>this.#p(-52,0)}>${M(at)}</button>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#n("map_tilt_down","Lower viewing angle")} aria-keyshortcuts="PageDown" @click=${()=>this.#p(0,30)}>${M(et)}</button>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#n("map_tilt_up","Raise viewing angle")} aria-keyshortcuts="PageUp" @click=${()=>this.#p(0,-30)}>${M(tt)}</button>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#n("map_rotate_right","Rotate right")} aria-keyshortcuts="]" @click=${()=>this.#p(52,0)}>${M(ot)}</button>
          </div>
        `:b}

        ${p?f`
          <div class="map-tools ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#n("v4_map_tools","Map tools")}>
            ${i?b:f`
              <button
                class="fit ms-btn"
                type="button"
                aria-label=${this.#n("v4_fit_map_hint","Fit the whole map on screen")}
                @click=${()=>{this.#t?.fit(),this.#l({type:"fit-map"})}}
                title=${this.#n("v4_fit_map","Fit map")}
              >${M(it)}<span class="ms-btn__label">${this.#n("v4_fit_map","Fit map")}</span></button>
            `}
          </div>
        `:b}
        ${!i&&h?f`
          <div class="map-extras ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#n("v4_map_display","Map display")}>
              <button
                class="labels ms-btn"
                type="button"
                aria-pressed=${String(s.labelsVisible)}
                @click=${()=>this.#l({type:"toggle-labels"})}
                title=${this.#n("v4_room_names","Room names")}
              >${M(nt)}<span class="ms-btn__label">${this.#n("v4_room_names","Room names")}</span></button>
              <button
                class="help ms-btn ms-btn--icon"
                type="button"
                aria-label=${r}
                aria-expanded=${String(this.#o)}
                aria-controls=${zt}
                @click=${this.#C}
                title=${r}
              >${M(st)}</button>
          </div>
        `:b}

        ${this.#o&&e&&h?f`
          <div
            id=${zt}
            class="navigation-help ms-surface ms-surface--floating"
            role="dialog"
            aria-modal="false"
            aria-label=${r}
          >
            <header>
              <h3>${r}</h3>
              <button class="ms-btn ms-btn--sm" type="button" @click=${()=>this.#s()}>${this.#n("v4_close","Close")}</button>
            </header>
            <dl>
              <dt>${this.#n("v4_trackpad","Trackpad")}</dt>
              <dd>${this.#n("v4_trackpad_help","Scroll to pan \xB7 pinch to zoom \xB7 twist to rotate")}</dd>
              <dt>${this.#n("v4_mouse","Mouse")}</dt>
              <dd>${this.#n("v4_mouse_help","Drag to orbit \xB7 Shift, middle, or right drag to pan \xB7 wheel to zoom")}</dd>
              <dt>${this.#n("v4_keyboard","Keyboard")}</dt>
              <dd>${this.#n("v4_keyboard_help","WASD to move \xB7 Q/E or arrows to orbit \xB7 +/\u2212 to zoom \xB7 0 to fit")}</dd>
            </dl>
          </div>
        `:b}
      </div>
    `}#P(e){let i=this.state;if(!e)return b;if(i.workflow==="draw"&&!this.narrow)return f`
        <div class="map-dock ms-surface ms-surface--floating" data-map-control>
          ${bt(i,{intent:n=>this.#l(n),openBrush:()=>this.#l({type:"set-precision-open",value:!i.precisionOpen}),t:(n,a)=>this.#n(n,a)},"row")}
        </div>
      `;let s=i.selection.roomIds.length;return i.workflow==="rooms"&&s>0&&!this.narrow?f`
        <div class="map-dock ms-surface ms-surface--floating" data-map-control>
          <div class="selection-chip ms-surface ms-surface--floating" data-map-control>
            <span>${this.#n("v4_rooms_selected","Rooms selected: {count}").replace("{count}",String(s))}</span>
            <button class="ms-btn ms-btn--sm" type="button" @click=${()=>this.#g()}>${this.#n("v4_clear","Clear")}</button>
          </div>
        </div>
      `:b}render(){let e=this.state,i=G(e),s=this.#z(),n=e.map.available&&(W(e)||e.dataMode==="history"),a=e.workflow==="draw"&&n,r=e.coherence==="verifying"||e.coherence==="booting";return f`
      <section
        class="map-root"
        tabindex="0"
        aria-label=${this.#n("map_viewport_aria","Interactive Matic 3D map")}
        aria-describedby=${a?e.draw.tool==="outline"?"zone-keyboard-help":"keyboard-draw-help":b}
        data-full-map=${String(e.fullMap)}
        data-workflow=${e.workflow}
        data-draw-tool=${e.draw.tool}
        data-narrow=${this.narrow?"true":b}
        @keydown=${this.#f}
        @pointerdown=${this.#b}
      >
        ${this.#E(n,r)}
        <slot name="scrim"></slot>

        <div
          class="scene-window"
          data-renderer-key="persistent-canvas-v4"
          ?hidden=${!n}
          role=${a?"group":"img"}
          aria-label=${Tt(e,this.localize)}
        >
          ${a?f`<span class="keyboard-aim" aria-hidden="true"></span>`:b}
          <canvas class="scene-canvas"></canvas>
          <canvas class="overlay-canvas"></canvas>
          ${a?this.#M.render():b}
        </div>

        ${a?f`
          <p id="zone-keyboard-help" class="sr-only">${this.#n("v4_zone_keyboard_help","Focus the map, aim with arrow keys, and press Enter to place points. The edges join automatically after three points. Keep adding points or Tab to a point; arrows move it, Delete removes it, and Escape cancels a drag.")}</p>
          <p id="keyboard-draw-help" class="sr-only">${this.#n("v4_keyboard_draw_help","Keyboard: focus the map, use arrow keys to aim, then Enter to paint or erase at the crosshair. D selects Paint; E selects Erase.")}</p>
          <div class="map-scale" aria-label=${`Scale ${i.label}`}>
            <span class="scale-line" style=${`--scale-width:${i.pixels}px`}></span>
            <span>${i.label}</span>
          </div>
        `:b}

        ${this.#P(n)}

        ${s&&!(e.fullMap&&(r||!e.host.administrator))?f`
          <div class="map-message ms-surface ms-surface--floating" role="status">
            <strong>${s.title}</strong>
            <span>${s.detail}</span>
          </div>
        `:b}
        <div class="sr-only" aria-live="polite" aria-atomic="true">
          ${Tt(e,this.localize)}
        </div>
      </section>
    `}};customElements.get(B)||customElements.define(B,Y);export{B as a,jt as b,Qt as c,Jt as d,te as e,F as f,bt as g,Pt as h,T as i,Kt as j,Zt as k};
