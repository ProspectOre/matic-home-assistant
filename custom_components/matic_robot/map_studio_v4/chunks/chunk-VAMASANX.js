import{$ as ot,C as G,E as K,F as b,J as v,L as Z,M as j,N as Q,O as J,X as tt,Y as et,Z as it,_ as nt,aa as at,ba as st,ca as rt,da as lt,ea as ct,fa as ht,ga as dt,ha as ut,j as U,ma as pt,q as W,r as D,s as N,t as P,u as y,ua as x,va as V}from"./chunk-EGXTIAOX.js";var mt=import.meta.url.match(/\/matic_robot\/[^/]+-([a-f0-9]{12})\/map-studio-v4(?:\/|$)/u)?.[1]??"dev",A=mt==="dev"?"":`-${mt}`,B=`matic-map-canvas-v4${A}`,jt=`matic-precision-controls-v4${A}`,Qt=`matic-map-workflow-v4${A}`,Jt=`matic-map-shell-v4${A}`,te=`matic-map-panel-v0-4-0${A}`;var z=(s,t,e)=>{let i=e.x-t.x,n=e.y-t.y,o=Math.max(0,Math.min(1,((s.x-t.x)*i+(s.y-t.y)*n)/(i*i+n*n||1)));return Math.hypot(s.x-t.x-o*i,s.y-t.y-o*n)},Rt=(s,t)=>{let e=!1;for(let i=0,n=t.length-1;i<t.length;n=i++){let o=t[i],a=t[n];o.y>s.y!=a.y>s.y&&s.x<(a.x-o.x)*(s.y-o.y)/(a.y-o.y)+o.x&&(e=!e)}return e},I=(s,t,e)=>(t.x-s.x)*(e.y-s.y)-(t.y-s.y)*(e.x-s.x),F=({points:s,closed:t})=>{if(s.length>64||t&&s.length<3||s.some(i=>!Number.isFinite(i.x)||!Number.isFinite(i.y)||Math.abs(i.x)>1e4||Math.abs(i.y)>1e4))return!1;let e=t?s.length:s.length-1;for(let i=0;i<e;i++){let n=s[i],o=s[(i+1)%s.length];if(Math.hypot(n.x-o.x,n.y-o.y)<.01)return!1;for(let a=i+2;a<e;a++){if(t&&i===0&&a===e-1)continue;let r=s[a],l=s[(a+1)%s.length];if(Math.min(z(n,r,l),z(o,r,l),z(r,n,o),z(l,n,o))<1e-5||I(n,o,r)*I(n,o,l)<0&&I(r,l,n)*I(r,l,o)<0)return!1}}return!t||Math.abs(s.reduce((i,n,o)=>{let a=s[(o+1)%s.length];return i+n.x*a.y-a.x*n.y},0))>.01},ft=(s,t)=>{if(!s.closed||!F(s))return[];let{points:e}=s,i=Math.min(...e.map(c=>c.x)),n=Math.max(...e.map(c=>c.x)),o=Math.min(...e.map(c=>c.y)),a=Math.max(...e.map(c=>c.y)),r=[];for(let c=0;c<32;c++)for(let h=0;h<32;h++){let p={x:Math.round((i+(h+.5)*(n-i)/32)*1e4)/1e4,y:Math.round((o+(c+.5)*(a-o)/32)*1e4)/1e4};if(!Rt(p,e)||!t(p))continue;let d=Math.min(...e.map((m,f)=>z(p,m,e[(f+1)%e.length]))),u=Math.floor(Math.min(2.5,d-1e-4)*1e4)/1e4;u>=.05&&r.push({...p,radius:u})}r.sort((c,h)=>h.radius-c.radius);let l=[];for(let c of r){if(l.length>=512)break;l.some(h=>Math.hypot(h.x-c.x,h.y-c.y)+c.radius*.5<=h.radius)||l.push(c)}return l};var X=class{constructor(t,e,i,n,o,a){this.state=t;this.renderer=e;this.intent=i;this.update=n;this.t=o;this.focusPoint=a}#e=null;#t="";#o=null;#s(t=this.state()){return P(t,"outline")!==null}#u(t,e){let i=e??P(this.state(),"outline");if(!y(this.state(),i))return;if(!F(t)){this.#t=this.t("v4_zone_invalid","Keep the outline from crossing itself."),this.update();return}let n=ft(t,o=>this.renderer()?.containsMapPoint(o)??!1);this.#t=t.closed&&!n.length?this.t("v4_zone_empty","Make the zone wider and keep it on mapped floor."):"",this.intent({type:"set-draft-circles",circles:n,outline:t,coordinateEdit:i})}addPoint(t,e){let i=e??P(this.state(),"outline");if(!y(this.state(),i)||i.tool!=="outline"||!this.renderer()?.containsMapPoint(t))return;let n=this.state().draw.outline??{points:[],closed:!1};if(n.points.length>=64)return;let o=[...n.points,t];this.#u({points:o,closed:o.length>=3},i)}#a(t){let e=this.state().draw.outline;if(!e)return;this.#o=null;let i=e.points.filter((n,o)=>o!==t);this.#u({points:i,closed:e.closed&&i.length>=3}),this.focusPoint(Math.min(t,i.length-1))}#l(t){let e=this.state().draw.outline;if(!e||e.points.length>=64)return;let i=e.points[t],n=e.points[(t+1)%e.points.length];if(!i||!n||!e.closed&&t===e.points.length-1)return;let o={x:(i.x+n.x)/2,y:(i.y+n.y)/2};this.#u({...e,points:[...e.points.slice(0,t+1),o,...e.points.slice(t+1)]}),this.focusPoint(t+1)}#h(t,e){if(t.button!==0||this.#e||t.pointerType==="touch"&&!t.isPrimary)return;let i=P(this.state(),"outline");if(!i)return;this.#o=e,this.update();let n=this.state().draw.outline;if(!n)return;t.stopPropagation(),t.preventDefault();let o=t.currentTarget;o.focus({preventScroll:!0}),o.setPointerCapture(t.pointerId),this.#e={index:e,pointer:t.pointerId,baseline:n,preview:n,target:o,capture:i}}observeState(t){this.#e&&!y(t,this.#e.capture)&&this.cancel()}#b(t){let e=this.#e;if(!e||e.pointer!==t.pointerId)return;if(t.stopPropagation(),t.preventDefault(),!y(this.state(),e.capture)){this.cancel();return}let i=this.renderer()?.screenToMap(t.clientX,t.clientY);!i||!this.renderer()?.containsMapPoint(i)||(e.preview={...e.baseline,points:e.baseline.points.map((n,o)=>o===e.index?i:n)},this.update())}#v(t){let e=this.#e;!e||e.pointer!==t.pointerId||(t.stopPropagation(),t.preventDefault(),this.#e=null,e.target.releasePointerCapture(t.pointerId),e.preview!==e.baseline&&this.#u(e.preview,e.capture),this.update())}cancel(){let t=this.#e;t&&(this.#e=null,t.target.hasPointerCapture(t.pointer)&&t.target.releasePointerCapture(t.pointer),this.update())}#x(t,e){if(t.ctrlKey||t.altKey||t.metaKey)return;if(t.key==="Escape"){t.stopPropagation(),this.cancel();return}let i=this.state().draw.outline;if(!i||!this.#s())return;if(t.key==="Delete"||t.key==="Backspace"){t.preventDefault(),t.stopPropagation(),this.#a(e);return}let n=t.shiftKey?.1:.02,o=t.key==="ArrowLeft"?-n:t.key==="ArrowRight"?n:0,a=t.key==="ArrowUp"?-n:t.key==="ArrowDown"?n:0;if(!o&&!a)return;t.preventDefault(),t.stopPropagation();let r=i.points[e],l=this.renderer()?.offsetMapPoint(r,o,a);l&&this.renderer()?.containsMapPoint(l)&&this.#u({...i,points:i.points.map((c,h)=>h===e?l:c)})}render(){if(!this.#s())return v;let t=this.#e?.preview??this.state().draw.outline,e=t?.points??[],i=e.map(r=>this.renderer()?.mapToScreen(r)),n=i.map((r,l)=>r?`${l?"L":"M"}${r.x},${r.y}`:"").join(" "),o=!t||F(t),a=this.#o!==null&&this.#o<e.length?this.#o:null;return b`
      <div class="zone-overlay">
        <svg aria-hidden="true"><path d=${n+(t?.closed?" Z":"")} class=${o?"":"invalid"} fill=${t?.closed?"var(--ms-accent)":"none"}></path></svg>
        ${i.map((r,l)=>r?b`
          <button class="zone-point" type="button" data-zone-index=${l} data-selected=${String(this.#o===l)} data-map-control style=${`left:${r.x}px;top:${r.y}px`}
            aria-label=${`${this.t("v4_zone_point","Zone point")} ${l+1}`} aria-describedby="zone-handle-help"
            title=${this.t("v4_zone_point_help","Drag to move. Arrow keys adjust; Delete removes.")}
            @pointerdown=${c=>this.#h(c,l)} @pointermove=${c=>this.#b(c)}
            @pointerup=${c=>this.#v(c)} @pointercancel=${()=>this.cancel()}
            @lostpointercapture=${()=>{this.#e&&this.cancel()}}
            @focus=${()=>{this.#o=l,this.update()}}
            @keydown=${c=>this.#x(c,l)}
          >${l+1}</button>
        `:v)}
        ${e.map((r,l)=>{let c=e[(l+1)%e.length];if(!c||!t?.closed&&l===e.length-1||e.length>=64)return v;let h={x:(r.x+c.x)/2,y:(r.y+c.y)/2},p=this.renderer()?.mapToScreen(h),d=i[l],u=i[(l+1)%i.length];return p&&d&&u&&Math.hypot(d.x-u.x,d.y-u.y)>=100?b`<button class="zone-point zone-midpoint" type="button" data-map-control
            style=${`left:${p.x}px;top:${p.y}px`} aria-label=${`${this.t("v4_zone_add_point","Add point after")} ${l+1}`}
            @click=${()=>this.#l(l)}>+</button>`:v})}
        <div class="zone-help" data-map-control>
          <span id="zone-handle-help" class="sr-only">${this.t("v4_zone_point_help","Drag to move. Arrow keys adjust; Delete removes.")}</span>
          ${a!==null?b`
            <div class="zone-point-actions ms-surface" role="group" aria-label=${`${this.t("v4_zone_point","Zone point")} ${a+1}`}>
              <span class="zone-selection">${this.t("v4_zone_point_short","Point")} ${a+1}</span>
              <button class="ms-btn" type="button" ?disabled=${e.length>=64||!t?.closed&&a===e.length-1} @click=${()=>this.#l(a)}>${this.t("v4_zone_insert_point","Insert point")}</button>
              <button class="ms-btn" type="button" aria-label=${`${this.t("v4_zone_delete_point","Delete point")} ${a+1}`} @click=${()=>this.#a(a)}>${this.t("v4_zone_delete_point","Delete point")}</button>
            </div>`:v}
          ${a===null||!t?.closed?b`
            <div class="zone-guidance ms-surface">
              <span>${t?.closed?this.t("v4_zone_edit_help","Tap to add points. Drag points to reshape."):this.t("v4_zone_create_help","Place points around the area. The edges join automatically.")}</span>
            </div>`:v}
          <span class="zone-feedback ms-surface" role="status" ?hidden=${!this.#t}>${this.#t}</span>
        </div>
      </div>
    `}};var Lt=["outline","paint","erase","pan"],bt=(s,t,e)=>{let{draw:i}=s,n=`${i.brushMeters.toFixed(2)} m`;return b`
    <div
      class=${`draw-tools draw-tools--${e} ms-segment`}
      data-zone=${String(i.tool==="outline")}
      role="toolbar"
      aria-label=${t.t("v4_draw_tools","Draw area tools")}
      data-map-control
    >
      ${Lt.map(o=>b`
        <button
          class="ms-btn"
          type="button"
          aria-pressed=${String(i.tool===o)}
          data-tool=${o}
          @click=${()=>t.intent({type:"set-draw-tool",tool:o})}
        >${x(o==="outline"?pt:o==="paint"?ct:o==="erase"?dt:ut)}<span class="ms-btn__label">${o==="outline"?t.t("v4_zone_tool","Zone"):o==="paint"?t.t("area_paint","Paint"):o==="erase"?t.t("area_erase","Erase"):t.t("move_map","Move map")}</span></button>
      `)}
      <button
        class="ms-btn"
        type="button"
        ?disabled=${i.strokeCount===0}
        @click=${()=>t.intent({type:"undo-draft"})}
      >${x(rt)}<span class="ms-btn__label">${t.t("undo","Undo")}</span></button>
      <button
        class="ms-btn"
        type="button"
        ?disabled=${i.redo.length===0}
        @click=${()=>t.intent({type:"redo-draft"})}
      >${x(lt)}<span class="ms-btn__label">${t.t("redo","Redo")}</span></button>
      ${i.tool!=="outline"?b`<button
        class="ms-btn draw-brush"
        type="button"
        aria-label=${t.t("v4_brush_button","Brush width, {brush}. Opens brush settings.").replace("{brush}",n)}
        aria-expanded=${String(s.precisionOpen)}
        aria-haspopup="dialog"
        @click=${t.openBrush}
      >${x(ht)}<span class="ms-btn__label">${t.t("v4_brush","Brush {brush}").replace("{brush}",n)}</span></button>`:v}
    </div>
  `};var Dt=s=>s.matches(":disabled, [aria-disabled='true']"),T=class{#e;#t;#o=null;#s=null;constructor(t,e){this.#e=t,this.#t=e,t.addController(this)}hostConnected(){this.#e.addEventListener("focusin",this.#l)}hostDisconnected(){this.#e.removeEventListener("focusin",this.#l),this.#o?.removeEventListener("keydown",this.#h),this.#o=null,this.#s=null}hostUpdated(){let t=this.#t.container();t!==this.#o&&(this.#o?.removeEventListener("keydown",this.#h),t?.addEventListener("keydown",this.#h),this.#o=t),this.#a()}#u(){let t=this.#o;return t?[...t.querySelectorAll(this.#t.items)].filter(e=>!Dt(e)):[]}#a(){let t=this.#u(),e=(this.#s&&t.includes(this.#s)?this.#s:null)??t.find(n=>n.matches("[aria-pressed='true'], [aria-checked='true']"))??t[0]??null;this.#s=e;let i=this.#o?.querySelectorAll(this.#t.items)??[];for(let n of i)n.tabIndex=n===e?0:-1}#l=t=>{let e=t.composedPath()[0];!(e instanceof HTMLElement)||!this.#o?.contains(e)||e.matches(this.#t.items)&&(this.#s=e,this.#a())};#h=t=>{if(t.defaultPrevented||t.ctrlKey||t.metaKey||t.altKey)return;let e=this.#t.orientation??"horizontal",i=e!=="vertical",n=e!=="horizontal",o=this.#u();if(!o.length)return;let a=t.composedPath()[0],r=Math.max(0,o.findIndex(h=>h===this.#s||a instanceof Node&&h.contains(a))),l;switch(t.key){case"ArrowLeft":if(!i)return;l=r-1;break;case"ArrowRight":if(!i)return;l=r+1;break;case"ArrowUp":if(!n)return;l=r-1;break;case"ArrowDown":if(!n)return;l=r+1;break;case"Home":l=0;break;case"End":l=o.length-1;break;default:return}t.preventDefault();let c=o[(l+o.length)%o.length];c&&(this.#s=c,this.#a(),c.focus())}};var vt={accent:["--ms-accent","Highlight",[6,120,206]],onAccent:["--ms-on-accent","HighlightText",[255,255,255]],text:["--ms-text","CanvasText",[38,50,56]],quiet:["--ms-text-quiet","GrayText",[75,92,105]],plate:["--ms-surface-card","Canvas",[250,252,253]],roomFill:["--ms-surface-sunken","Canvas",[231,238,242]]},It=s=>Math.max(0,Math.min(255,Math.round(s))),yt=s=>{let t=s.trim(),e=t.match(/^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i)?.[1];if(e){let h=e.length<=4?[e[0],e[1],e[2]].map(m=>Number.parseInt(`${m}${m}`,16)):[e.slice(0,2),e.slice(2,4),e.slice(4,6)].map(m=>Number.parseInt(m,16)),[p,d,u]=h;return p===void 0||d===void 0||u===void 0?null:[p,d,u]}let i=t.startsWith("color(srgb"),n=t.slice(t.indexOf("(")+1).match(/-?\d*\.?\d+/g);if(!n||n.length<3)return null;let o=i?255:1,a=n.slice(0,3).map(h=>It(Number(h)*o)),[r,l,c]=a;return r===void 0||l===void 0||c===void 0||[r,l,c].some(h=>Number.isNaN(h))?null:[r,l,c]},w=(s,t)=>`rgba(${s[0]},${s[1]},${s[2]},${t})`,wt=s=>{let t=window.matchMedia?.("(forced-colors: active)").matches??!1;if(!t){let n=document.createElement("span"),o=document.createElement("canvas");o.width=1,o.height=1;let a=o.getContext("2d",{colorSpace:"srgb",willReadFrequently:!0});n.setAttribute("aria-hidden","true"),n.style.cssText="position:absolute;inline-size:0;block-size:0;overflow:hidden;visibility:hidden;pointer-events:none",s.append(n);let r=l=>{let[c,,h]=vt[l];n.style.color=`var(${c}, transparent)`;let p=getComputedStyle(n).color;if(a){a.clearRect(0,0,1,1),a.fillStyle="transparent",a.fillStyle=p,a.fillRect(0,0,1,1);let[d,u,m,f]=a.getImageData(0,0,1,1).data;if(d!==void 0&&u!==void 0&&m!==void 0&&f!==void 0&&f!==0)return[d,u,m]}return yt(p)??h};try{return{accent:r("accent"),onAccent:r("onAccent"),text:r("text"),quiet:r("quiet"),plate:r("plate"),roomFill:r("roomFill"),forced:t}}finally{n.remove()}}let e=document.createElement("span");e.setAttribute("aria-hidden","true"),e.style.cssText="position:absolute;inline-size:0;block-size:0;overflow:hidden;visibility:hidden;pointer-events:none",s.append(e);let i=n=>{let[,o,a]=vt[n];return e.style.color=o,yt(getComputedStyle(e).color)??a};try{return{accent:i("accent"),onAccent:i("onAccent"),text:i("text"),quiet:i("quiet"),plate:i("plate"),roomFill:i("roomFill"),forced:t}}finally{e.remove()}};var gt=(s,t)=>Math.hypot(s.x-t.x,s.y-t.y),xt=(s,t)=>({x:(s.x+t.x)/2,y:(s.y+t.y)/2}),Mt=(s,t)=>Math.atan2(t.y-s.y,t.x-s.x),Ft=s=>{let t=s;for(;t>Math.PI;)t-=Math.PI*2;for(;t<-Math.PI;)t+=Math.PI*2;return t},$=(s,t,e)=>Math.max(t,Math.min(e,s)),Ct=s=>s.map(t=>({...t})),Xt="button, input, select, textarea, a, [contenteditable='true'], [role='button'], [role='menuitem'], [data-map-control]",_=s=>s.composedPath().some(t=>t instanceof Element&&t.matches(Xt)),Pt=s=>s.composedPath().some(t=>t instanceof Element&&t.matches("select")),O=class{#e;#t;#o;#s=new Map;#u=!1;#a="idle";#l=[];#h=null;#b=0;#v=null;#x=0;#i=null;#y=null;#P=null;#E=0;#d=null;#M=!1;#c=null;#r=null;#w=!1;constructor(t,e,i){this.#e=t,this.#t=e,this.#o=i,t.addEventListener("pointerdown",this.#$),t.addEventListener("pointermove",this.#n),t.addEventListener("pointerup",this.#p),t.addEventListener("pointercancel",this.#p),t.addEventListener("wheel",this.#f,{passive:!1}),t.addEventListener("gesturestart",this.#z,{passive:!1}),t.addEventListener("gesturechange",this.#k,{passive:!1}),t.addEventListener("gestureend",this.#_,{passive:!1}),t.addEventListener("dblclick",this.#L),t.addEventListener("contextmenu",this.#S),t.addEventListener("keydown",this.#T),t.addEventListener("keyup",this.#F),t.addEventListener("blur",this.#R)}#$=t=>{if(this.#w||!t.isPrimary&&t.pointerType==="mouse"||_(t))return;this.observeState(this.#o.state()),this.#e.focus({preventScroll:!0}),this.#A(),t.pointerType==="touch"&&!t.isPrimary&&this.#s.size===0&&this.#o.state().draw.tool==="outline"&&(this.#M=!0);let e=performance.now(),i={id:t.pointerId,type:t.pointerType,startX:t.clientX,startY:t.clientY,x:t.clientX,y:t.clientY,lastX:t.clientX,lastY:t.clientY,lastTime:e,velocityX:0,velocityY:0};if(this.#s.set(t.pointerId,i),this.#e.setPointerCapture?.(t.pointerId),this.#s.size>=2){this.#X(),this.#o.onCirclePreview(null),this.#r=null,this.#a="pinch",this.#e.classList.add("navigating"),this.#M=!0;let[r,l]=[...this.#s.values()];r&&l&&(this.#b=Math.max(1,gt(r,l)),this.#v=xt(r,l),this.#x=Mt(r,l),this.#i=this.#t.camera),t.preventDefault();return}let n=this.#o.state(),o=n.workflow==="draw"&&n.map.available&&!n.floor.readOnly;this.#M||this.#u||t.button===1||t.button===2||n.draw.tool==="pan"?(this.#a="pan",this.#y=this.#t.camera):o&&n.draw.tool==="outline"&&(this.#r=P(n,"outline"))?this.#a="outline":o&&(n.draw.tool==="paint"||n.draw.tool==="erase")&&(this.#r=P(n,n.draw.tool))?(this.#l=Ct(this.#r.baselineCircles),t.pointerType==="touch"?(this.#a="idle",this.#c=window.setTimeout(()=>{if(this.#c=null,this.#s.size!==1||this.#M||!y(this.#o.state(),this.#r)){this.#C();return}this.#a=n.draw.tool;let r=this.#s.get(t.pointerId);r&&this.#m(r.x,r.y)},110)):(this.#a=n.draw.tool,this.#m(t.clientX,t.clientY))):(this.#a=n.view==="three"&&!t.shiftKey?"orbit":"pan",this.#y=this.#t.camera),(this.#a==="pan"||this.#a==="orbit")&&this.#e.classList.add("navigating"),t.preventDefault()};observeState(t){this.#r&&!y(t,this.#r)&&this.#C()}#C(){if(this.#X(),this.#o.onCirclePreview(null),this.#r=null,this.#l=[],this.#h=null,this.#a==="paint"||this.#a==="erase"||this.#a==="outline"||this.#a==="idle"){this.#a="idle",this.#M=!1,this.#e.classList.remove("navigating");for(let t of this.#s.keys())this.#e.releasePointerCapture?.(t);this.#s.clear()}}#n=t=>{if(this.#r&&!y(this.#o.state(),this.#r)){this.#C();return}let e=this.#s.get(t.pointerId);if(!e){let h=this.#t.screenToMap(t.clientX,t.clientY);this.#t.setCursor(h);return}let n=(t.getCoalescedEvents?.()||[]).at(-1)||t,o=performance.now(),a=Math.max(1,o-e.lastTime),r=(n.clientX-e.lastX)/a,l=(n.clientY-e.lastY)/a;if(e.velocityX=e.velocityX*.62+r*.38,e.velocityY=e.velocityY*.62+l*.38,e.lastX=n.clientX,e.lastY=n.clientY,e.lastTime=o,e.x=n.clientX,e.y=n.clientY,this.#a==="pinch"&&this.#s.size>=2){let[h,p]=[...this.#s.values()];if(!h||!p)return;let d=Math.max(1,gt(h,p)),u=xt(h,p),m=Mt(h,p),f=this.#i;if(f&&this.#v){let M={...f,distance:f.distance*this.#b/d,yaw:f.yaw+Ft(m-this.#x),pitch:f.orthographic?f.pitch:f.pitch-(u.y-this.#v.y)*.0035};this.#t.setCamera(this.#t.cameraAfterPan(M,u.x-this.#v.x,u.y-this.#v.y))}t.preventDefault();return}this.#a==="paint"||this.#a==="erase"?this.#m(t.clientX,t.clientY):this.#a==="pan"?this.#y&&this.#t.setCamera(this.#t.cameraAfterPan(this.#y,n.clientX-e.startX,n.clientY-e.startY)):this.#a==="orbit"&&this.#y&&this.#t.setCamera({...this.#y,yaw:this.#y.yaw+(n.clientX-e.startX)*.0045,pitch:this.#y.pitch-(n.clientY-e.startY)*.004});let c=this.#t.screenToMap(n.clientX,n.clientY);this.#t.setCursor(c),t.preventDefault()};#p=t=>{if(this.#r&&!y(this.#o.state(),this.#r)){this.#C();return}let e=this.#s.get(t.pointerId);if(!e)return;let i=this.#a;if(this.#s.delete(t.pointerId),this.#e.releasePointerCapture?.(t.pointerId),this.#X(),this.#a==="outline"&&t.type!=="pointercancel"&&y(this.#o.state(),this.#r)&&Math.hypot(e.x-e.startX,e.y-e.startY)<7){let n=this.#t.screenToMap(e.x,e.y);n&&this.#o.onOutlinePoint?.(n,this.#r)}if(t.type!=="pointercancel"&&(this.#a==="paint"||this.#a==="erase")&&y(this.#o.state(),this.#r)&&JSON.stringify(this.#l)!==JSON.stringify(this.#r.baselineCircles))this.#o.onCircles(this.#l,this.#r);else if(t.type!=="pointercancel"&&this.#a!=="pinch"&&!this.#M&&Math.hypot(e.x-e.startX,e.y-e.startY)<7&&["rooms","plan"].includes(this.#o.state().workflow)&&N(this.#o.state())){let n=this.#t.roomAt(e.x,e.y);n&&this.#o.onRoom(n)}if((this.#a==="paint"||this.#a==="erase")&&this.#o.onCirclePreview(null),this.#s.size===0)this.#a="idle",this.#r=null,this.#e.classList.remove("navigating"),this.#M=!1,this.#v=null,this.#i=null,this.#y=null,this.#h=null,(i==="pan"||i==="orbit")&&e.type!=="mouse"&&this.#D(e.velocityX,e.velocityY,i);else if(this.#a==="pinch"){this.#a="pan",this.#M=!0;let n=this.#s.values().next().value;n&&(n.startX=n.x,n.startY=n.y,n.velocityX=0,n.velocityY=0),this.#y=this.#t.camera,this.#i=null}t.preventDefault()};#m(t,e){if(!y(this.#o.state(),this.#r)){this.#C();return}let i=this.#t.screenToMap(t,e);if(!i)return;let o=this.#o.state().draw.brushMeters/2;if(this.#a==="erase")this.#l=this.#l.filter(a=>Math.hypot(a.x-i.x,a.y-i.y)>a.radius+o);else{if(!this.#t.containsMapPoint(i))return;let a=Math.max(.04,o*.55),r=this.#h||i,l=Math.hypot(i.x-r.x,i.y-r.y),c=Math.max(1,Math.ceil(l/a));for(let h=0;h<=c&&this.#l.length<512;h+=1){let p=h/c,d={x:r.x+(i.x-r.x)*p,y:r.y+(i.y-r.y)*p};this.#l.some(u=>Math.hypot(u.x-d.x,u.y-d.y)<Math.max(.025,o*.28))||this.#l.push({x:Math.round(d.x*1e4)/1e4,y:Math.round(d.y*1e4)/1e4,radius:Math.round(o*100)/100})}}this.#h=i,this.#o.onCirclePreview(this.#l,this.#r)}#f=t=>{if(_(t))return;t.preventDefault(),this.#e.focus({preventScroll:!0}),this.#A();let e=t.deltaMode===WheelEvent.DOM_DELTA_LINE?16:t.deltaMode===WheelEvent.DOM_DELTA_PAGE?Math.max(1,this.#e.clientHeight):1,i=t.deltaX*e,n=t.deltaY*e;if(t.ctrlKey||t.metaKey){this.#t.zoomAt(Math.exp($(-n*.008,-.28,.28)),t.clientX,t.clientY);return}if(t.altKey&&this.#o.state().view==="three"){this.#t.orbitBy(0,$(n,-80,80)*.75);return}if(t.deltaMode!==WheelEvent.DOM_DELTA_PIXEL||Math.abs(i)<.5&&Math.abs(n)>=50){this.#t.zoomAt(Math.exp($(-n*.0025,-.28,.28)),t.clientX,t.clientY);return}this.#t.panBy(-$(i,-80,80),-$(n,-80,80))};#z=t=>{this.#w||_(t)||(this.#e.focus({preventScroll:!0}),this.#A(),this.#e.classList.add("navigating"),this.#P=this.#t.camera,this.#E=Number.isFinite(t.rotation)?t.rotation:0,t.preventDefault())};#k=t=>{if(this.#w||_(t))return;let e=this.#P;if(!e||this.#s.size>=2)return;let i=Number.isFinite(t.scale)&&t.scale>0?Math.max(.1,t.scale):1,n=Number.isFinite(t.rotation)?t.rotation:0;this.#t.setCamera({...e,distance:e.distance/i,yaw:e.yaw+(n-this.#E)*Math.PI/180}),t.preventDefault()};#_=t=>{let e=this.#P!==null;this.#P=null,this.#E=0,this.#e.classList.remove("navigating"),e&&!_(t)&&t.preventDefault()};#q(t){let e=this.#o.state();if(t.repeat||this.#w||this.#s.size||t.composedPath()[0]!==this.#e||!this.#e.matches(":focus")||e.workflow!=="draw"||!N(e)||e.command!=="idle"&&e.command!=="failed"||e.draw.tool!=="paint"&&e.draw.tool!=="erase"&&e.draw.tool!=="outline")return;let n=this.#e.querySelector(".scene-canvas")?.getBoundingClientRect();if(!n?.width||!n.height)return;let o=P(e,e.draw.tool);if(o){if(t.preventDefault(),this.#A(),e.draw.tool==="outline"){let a=this.#t.screenToMap(n.left+n.width/2,n.top+n.height/2);a&&this.#o.onOutlinePoint?.(a,o);return}this.#l=Ct(o.baselineCircles),this.#h=null,this.#r=o,this.#a=e.draw.tool,this.#m(n.left+n.width/2,n.top+n.height/2),this.#a="idle",this.#h=null,this.#r=null,this.#o.onCirclePreview(null),JSON.stringify(this.#l)!==JSON.stringify(o.baselineCircles)&&this.#o.onCircles(this.#l,o)}}#T=t=>{if(_(t)||t.defaultPrevented||t.ctrlKey||t.metaKey||t.altKey)return;if(t.key==="Enter"){this.#q(t);return}if(t.code==="Space"){this.#u=!0,t.preventDefault();return}this.#A();let e=this.#o.state(),i=t.key.toLocaleLowerCase();if(t.key==="+"||t.key==="=")this.#t.zoomAt(1.25);else if(t.key==="-")this.#t.zoomAt(.8);else if(t.key==="0")this.#t.fit();else if(i==="3")this.#g({type:"set-view",view:"three"});else if(i==="t")this.#g({type:"set-view",view:"top"});else if(t.key==="[")this.#t.orbitBy(-40,0);else if(t.key==="]")this.#t.orbitBy(40,0);else if(t.key==="PageUp")this.#t.orbitBy(0,-30);else if(t.key==="PageDown")this.#t.orbitBy(0,30);else if(i==="d"&&e.workflow==="draw")this.#g({type:"set-draw-tool",tool:"paint"});else if(i==="e"&&e.workflow==="draw")this.#g({type:"set-draw-tool",tool:"erase"});else if(["arrowleft","arrowright","arrowup","arrowdown"].includes(i))if(e.view==="three"&&!t.shiftKey){let n=i==="arrowleft"?-24:i==="arrowright"?24:0,o=i==="arrowup"?-20:i==="arrowdown"?20:0;this.#t.orbitBy(n,o)}else{let n=i==="arrowleft"?30:i==="arrowright"?-30:0,o=i==="arrowup"?30:i==="arrowdown"?-30:0;this.#t.panBy(n,o)}else if(e.workflow!=="draw"&&["w","a","s","d"].includes(i))this.#t.panBy(i==="a"?34:i==="d"?-34:0,i==="w"?34:i==="s"?-34:0);else if(e.workflow!=="draw"&&(i==="q"||i==="e"))this.#t.orbitBy(i==="q"?-30:30,0);else return;t.preventDefault()};#F=t=>{t.code==="Space"&&(this.#u=!1)};#R=()=>{this.#u=!1,this.#C(),this.#t.setCursor(null),this.#e.classList.remove("navigating")};#L=t=>{_(t)||(this.#A(),this.#t.zoomAt(t.shiftKey?1/1.6:1.6,t.clientX,t.clientY),t.preventDefault())};#S=t=>{_(t)||t.preventDefault()};#g(t){this.#e.dispatchEvent(new CustomEvent("matic-workspace-intent",{detail:t,bubbles:!0,composed:!0}))}#D(t,e,i){if(window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;let n=$(t,-.55,.55),o=$(e,-.55,.55);if(Math.hypot(n,o)<.02)return;let a=performance.now(),r=l=>{let c=Math.min(32,l-a);a=l,i==="orbit"?this.#t.orbitBy(n*c,o*c):this.#t.panBy(n*c,o*c);let h=.9**(c/16);n*=h,o*=h,Math.hypot(n,o)>=.01?this.#d=window.requestAnimationFrame(r):this.#d=null};this.#d=window.requestAnimationFrame(r)}#A(){this.#d!==null&&window.cancelAnimationFrame(this.#d),this.#d=null}#X(){this.#c!==null&&window.clearTimeout(this.#c),this.#c=null}dispose(){this.#w||(this.#C(),this.#w=!0,this.#A(),this.#e.removeEventListener("pointerdown",this.#$),this.#e.removeEventListener("pointermove",this.#n),this.#e.removeEventListener("pointerup",this.#p),this.#e.removeEventListener("pointercancel",this.#p),this.#e.removeEventListener("wheel",this.#f),this.#e.removeEventListener("gesturestart",this.#z),this.#e.removeEventListener("gesturechange",this.#k),this.#e.removeEventListener("gestureend",this.#_),this.#e.removeEventListener("dblclick",this.#L),this.#e.removeEventListener("contextmenu",this.#S),this.#e.removeEventListener("keydown",this.#T),this.#e.removeEventListener("keyup",this.#F),this.#e.removeEventListener("blur",this.#R),this.#s.clear())}};var g=(s,t,e)=>Math.max(t,Math.min(e,s)),R=s=>{let t=s;for(;t>Math.PI;)t-=Math.PI*2;for(;t<-Math.PI;)t+=Math.PI*2;return t},Ot=s=>{switch(s){case"efficient":return .35;case"balanced":return .65;case"maximum":case"auto":return 1}},kt=s=>{let t=s.metadata.metersPerCell;return[(s.metadata.origin[0]+(s.metadata.span[0]-1)/2)*t,(s.metadata.origin[1]+(s.metadata.span[1]-1)/2)*t]},$t=(s,t,e,i)=>{let n=kt(e),o=kt(i);return[s+(o[0]-n[0]),t+(n[1]-o[1])]},Ht=(s,t,e)=>{let[i,n]=$t(s.targetX,s.targetZ,t,e);return{...s,targetX:i,targetZ:n}},St=(s,t)=>{if(!t)return!0;let e=s==="top";return Math.abs(t.zoom-1)<.001&&Math.abs(t.targetX)<.001&&Math.abs(t.targetZ)<.001&&Math.abs(R(t.yaw-(e?0:-Math.PI/4)))<.001&&(e||Math.abs(t.pitch-.82)<.001)},qt=(s,t,e,i,n)=>Object.fromEntries(Object.entries(s).map(([o,a])=>{if(!a||St(o,a))return[o,a];let[r,l]=$t(a.targetX,a.targetZ,t,e),c=i[o],h=n[o],p=c>0&&h>0?a.zoom*h/c:a.zoom;return[o,{...a,targetX:r,targetZ:l,zoom:p}]})),_t=s=>{let t=s.resources.entry;return[s.dataMode,s.selection.floorId,t?.entryId??"none",t?.selectedFloorOrdinal??"none",t?.mapFloorOrdinal??"none",t?.mapSessionKey??"none"].join("|")},Wt={accent:[6,120,206],onAccent:[255,255,255],text:[38,50,56],quiet:[75,92,105],plate:[250,252,253],roomFill:[231,238,242],forced:!1},At=Math.PI/3.15,Nt=1.08,Vt=(s,t)=>{let e=At/2,i=Math.atan(Math.tan(e)*Math.max(.2,t));return s/Math.sin(Math.min(e,i))*Nt},Bt=(s,t)=>{let e=new Float32Array(16);for(let i=0;i<4;i+=1)for(let n=0;n<4;n+=1){let o=0;for(let a=0;a<4;a+=1)o+=(s[a*4+n]??0)*(t[i*4+a]??0);e[i*4+n]=o}return e},Yt=(s,t,e,i)=>{let n=1/Math.tan(s/2),o=new Float32Array(16);return o[0]=n/t,o[5]=n,o[10]=(i+e)/(e-i),o[11]=-1,o[14]=2*i*e/(e-i),o},Ut=(s,t,e,i,n,o)=>{let a=new Float32Array(16);return a[0]=2/(t-s),a[5]=2/(i-e),a[10]=-2/(o-n),a[12]=-(t+s)/(t-s),a[13]=-(i+e)/(i-e),a[14]=-(o+n)/(o-n),a[15]=1,a},Gt=(s,t)=>{let e=Math.hypot((s[0]??0)-(t[0]??0),(s[1]??0)-(t[1]??0),(s[2]??0)-(t[2]??0))||1,i=[((s[0]??0)-(t[0]??0))/e,((s[1]??0)-(t[1]??0))/e,((s[2]??0)-(t[2]??0))/e],n=Math.hypot(i[2]??0,i[0]??0)||1,o=[(i[2]??0)/n,0,-(i[0]??0)/n],a=[(i[1]??0)*(o[2]??0),(i[2]??0)*(o[0]??0)-(i[0]??0)*(o[2]??0),-(i[1]??0)*(o[0]??0)];return new Float32Array([o[0]??0,a[0]??0,i[0]??0,0,o[1]??0,a[1]??0,i[1]??0,0,o[2]??0,a[2]??0,i[2]??0,0,-((o[0]??0)*(s[0]??0)+(o[1]??0)*(s[1]??0)+(o[2]??0)*(s[2]??0)),-((a[0]??0)*(s[0]??0)+(a[1]??0)*(s[1]??0)+(a[2]??0)*(s[2]??0)),-((i[0]??0)*(s[0]??0)+(i[1]??0)*(s[1]??0)+(i[2]??0)*(s[2]??0)),1])},Et=(s,t,e)=>{let i=!1,n=e.at(-1);if(!n)return!1;for(let o of e){let[a,r]=o,[l,c]=n;r>t!=c>t&&s<(l-a)*(t-r)/(c-r)+a&&(i=!i),n=o}return i},H=class{#e;#t;#o;#s=null;#u=null;#a=null;#l=null;#h=null;#b=null;#v=null;#x=null;#i=null;#y=null;#P=null;#E=null;#d=null;#M=null;#c=null;#r=null;#w=null;#$=null;#C;#n={yaw:-Math.PI/4,pitch:.82,distance:12,targetX:0,targetZ:0,orthographic:!1};#p=12;#m=8;#f=4;#z=new Float32Array(16);#k=null;#_="unavailable";#q=0;#T=0;#F=0;#R=0;#L=1;#S={width:1,height:1,left:0,top:0};#g=!0;#D=!1;#A=Wt;constructor(t,e,i={}){this.#e=t,this.#t=e,this.#o=i,this.#u=e.getContext("2d",{alpha:!0}),this.#e.addEventListener("webglcontextlost",this.#tt),this.#e.addEventListener("webglcontextrestored",this.#et),this.#K(),this.#C=new ResizeObserver(()=>{let n=this.#p,o=this.#m;this.#Z(),this.#g&&(n!==this.#p||o!==this.#m)?this.fit(!1):this.requestRender()}),this.#C.observe(t)}get camera(){return{...this.#n}}#X(){return{minimum:Math.max(.2,this.#f*.04),maximum:this.#f*8}}#U(){let t=this.#c?.metadata.span,e=this.#c?.metadata.metersPerCell;return!t||e===void 0?{x:this.#f,z:this.#f}:{x:Math.max(.5,t[0]*e*.55),z:Math.max(.5,t[1]*e*.55)}}setCamera(t,e=!0){let i=this.#X(),n=this.#U();this.#n={yaw:R(t.yaw),pitch:t.orthographic?Math.PI/2-.018:g(t.pitch,.18,1.38),distance:g(t.distance,i.minimum,i.maximum),targetX:g(t.targetX,-n.x,n.x),targetZ:g(t.targetZ,-n.z,n.z),orthographic:t.orthographic},this.#g=!1,this.requestRender(),e&&this.#H()}cameraAfterPan(t,e,i){let n=this.#O(),o=t.distance*1.75/Math.max(200,n.height),a=Math.cos(t.yaw),r=-Math.sin(t.yaw),l=-Math.sin(t.yaw),c=-Math.cos(t.yaw),h=this.#U();return{...t,targetX:g(t.targetX-e*o*a+i*o*l,-h.x,h.x),targetZ:g(t.targetZ-e*o*r+i*o*c,-h.z,h.z)}}setState(t){if(this.#D)return;let e=this.#d,i=this.#c;this.#d=t;let n=t.resources.scene.value,o=null;if(n!==this.#c){let l=this.#c!==null&&e!==null&&this.#r===_t(t),c=l&&!this.#g;this.#c=n,this.#r=n?_t(t):null,o=this.#ot(n,c,i,l,e?e.workflow==="draw"?"top":e.view:null)}(!e||e.quality!==t.quality)&&(this.#L=Ot(t.quality),this.#R=0);let a=e?.workflow!=="draw"&&t.workflow==="draw",r=e?.workflow==="draw"&&t.workflow!=="draw";if(!e||e.view!==t.view||a||r){let l=t.workflow==="draw"?"top":t.view;this.#n=this.#it(l,t,o),this.#g=this.#nt(l,t,o)}t.workflow==="draw"&&e?.draw.zoomPercent!==t.draw.zoomPercent&&Math.round(this.#m/this.#n.distance*100)!==t.draw.zoomPercent&&(this.#n={...this.#n,orthographic:!0,pitch:Math.PI/2-.018,distance:this.#m*100/t.draw.zoomPercent},this.#g=t.draw.zoomPercent===100&&Math.abs(this.#n.targetX)<.001&&Math.abs(this.#n.targetZ)<.001&&Math.abs(R(this.#n.yaw))<.001),(o||a)&&this.#H(),this.requestRender()}setCirclePreview(t,e){this.#M=t&&e?{circles:t,capture:e}:null,this.requestRender()}#it(t,e,i=null){let n=t==="top",o=n?this.#m:this.#p,a=i?.[t]??e.cameras[t];return a?{yaw:a.yaw,pitch:n?Math.PI/2-.018:a.pitch,distance:g(o/g(a.zoom,.01,100),Math.max(.2,this.#f*.04),this.#f*8),targetX:g(a.targetX,-this.#f,this.#f),targetZ:g(a.targetZ,-this.#f,this.#f),orthographic:n}:n?{yaw:0,pitch:Math.PI/2-.018,distance:o,targetX:0,targetZ:0,orthographic:!0}:{yaw:-Math.PI/4,pitch:.82,distance:o,targetX:0,targetZ:0,orthographic:!1}}#nt(t,e,i=null){let n=i?.[t]??e.cameras[t];return St(t,n)}#G(t,e){let i=this.#s;if(!i)throw new Error("webgl-unavailable");let n=i.createShader(t);if(!n)throw new Error("shader-unavailable");if(i.shaderSource(n,e),i.compileShader(n),!i.getShaderParameter(n,i.COMPILE_STATUS))throw i.deleteShader(n),new Error("shader-failed");return n}#K(){try{this.#s=this.#e.getContext("webgl2",{alpha:!0,antialias:!0,depth:!0,powerPreference:"high-performance"});let t=this.#s;if(!t)throw new Error("webgl2-unavailable");let e=this.#G(t.VERTEX_SHADER,`#version 300 es
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
      `),n=t.createProgram();if(!n)throw new Error("program-unavailable");if(t.attachShader(n,e),t.attachShader(n,i),t.linkProgram(n),t.deleteShader(e),t.deleteShader(i),!t.getProgramParameter(n,t.LINK_STATUS))throw new Error("program-failed");this.#h=n,this.#x=t.getUniformLocation(n,"uViewProjection"),this.#i=t.getUniformLocation(n,"uCenter"),this.#y=t.getUniformLocation(n,"uMetersPerCell"),this.#P=t.getUniformLocation(n,"uPointPixels"),this.#E=t.getUniformLocation(n,"uMaxPointPixels"),this.#b=t.createBuffer(),this.#v=t.createVertexArray(),t.bindVertexArray(this.#v),t.bindBuffer(t.ARRAY_BUFFER,this.#b),t.enableVertexAttribArray(0),t.vertexAttribIPointer(0,2,t.UNSIGNED_SHORT,8,0),t.enableVertexAttribArray(1),t.vertexAttribIPointer(1,1,t.UNSIGNED_BYTE,8,4),t.enableVertexAttribArray(2),t.vertexAttribPointer(2,3,t.UNSIGNED_BYTE,!0,8,5),t.bindVertexArray(null),t.enable(t.DEPTH_TEST),t.depthFunc(t.LEQUAL),t.enable(t.BLEND),t.blendFunc(t.SRC_ALPHA,t.ONE_MINUS_SRC_ALPHA),this.#_="webgl2",this.#q+=1,this.#c&&this.#N(this.#c)}catch{this.#W(),this.#j()}}#ot(t,e=!1,i=null,n=!1,o=null){if(this.#Q(),!t)return this.#T=0,this.requestRender(),null;let[a,r]=t.metadata.span,l=t.metadata.metersPerCell,c=a*l,h=r*l;this.#f=Math.max(1,Math.hypot(c,h)/2);let p={three:this.#p,top:this.#m};this.#Z(),e&&i?this.setCamera(Ht(this.#n,i,t),!1):this.fit(!1,o??void 0);let d=this.#d;if(n&&i&&d){let u={three:this.#p,top:this.#m},m=qt(d.cameras,i,t,p,u),f=o??(d.workflow==="draw"?"top":d.view),M=f==="top"?this.#m:this.#p;return m[f]={yaw:this.#n.yaw,pitch:this.#n.pitch,zoom:M/Math.max(.2,this.#n.distance),targetX:this.#n.targetX,targetZ:this.#n.targetZ},this.#o.onCameraPreferences?.(m),this.#_==="webgl2"?this.#N(t):this.#V(t),m}return this.#_==="webgl2"?this.#N(t):this.#V(t),null}#Z(){let t=this.#c;if(!t)return;let[e,i]=t.metadata.span,n=t.metadata.metersPerCell,o=e*n,a=i*n,r=this.#O(),l=Math.max(.2,r.width/Math.max(1,r.height));this.#p=Vt(this.#f,l),this.#m=Math.max(a/2,o/(2*l))*1.12}#N(t){let e=this.#s;if(!e||!this.#b)return;let i=new Uint8Array(t.buffer,t.pointOffset,t.total*8);e.bindBuffer(e.ARRAY_BUFFER,this.#b),e.bufferData(e.ARRAY_BUFFER,i,e.STATIC_DRAW),this.#T=t.total}#j(){this.#_="canvas2d",this.#l=document.createElement("canvas"),this.#l.width=1024,this.#l.height=1024,this.#a=this.#l.getContext("2d",{alpha:!0}),this.#a?this.#c&&this.#V(this.#c):(this.#_="unavailable",this.#o.onProblem?.("renderer-unavailable"))}#V(t){let e=this.#a;if(!e||!this.#l)return;e.clearRect(0,0,this.#l.width,this.#l.height);let i=new DataView(t.buffer,t.pointOffset,t.total*8),n=Math.min(t.total,5e4),o=Math.max(1,Math.ceil(t.total/n)),a=0,r=0,l=()=>{if(this.#D||t!==this.#c||!this.#l)return;let c=Math.min(t.total,a+o*4e3);for(;a<c;a+=o){let h=a*8,p=i.getUint16(h,!0)/Math.max(1,t.metadata.span[0])*this.#l.width,d=i.getUint16(h+2,!0)/Math.max(1,t.metadata.span[1])*this.#l.height,u=i.getUint8(h+5),m=i.getUint8(h+6),f=i.getUint8(h+7);e.fillStyle=`rgb(${u} ${m} ${f})`,e.fillRect(p,d,1.5,1.5),r+=1}this.#T=r,this.requestRender(),a<t.total?this.#$=window.setTimeout(l,0):this.#$=null};l()}#Q(){this.#$!==null&&window.clearTimeout(this.#$),this.#$=null}#O(){let t=this.#e.getBoundingClientRect();return this.#S={width:t.width,height:t.height,left:t.left,top:t.top},this.#S}#at(){let t=!1,e=this.#O(),i=Math.min(window.devicePixelRatio||1,3),n=Math.max(1,Math.round(e.width*i)),o=Math.max(1,Math.round(e.height*i));for(let a of[this.#e,this.#t])(a.width!==n||a.height!==o)&&(a.width=n,a.height=o,t=!0);t&&this.#o.onViewport?.()}#B(){let t=this.#S,e=Math.max(.2,t.width/Math.max(1,t.height)),i=Math.cos(this.#n.pitch)*this.#n.distance,n=[this.#n.targetX+Math.sin(this.#n.yaw)*i,Math.sin(this.#n.pitch)*this.#n.distance,this.#n.targetZ+Math.cos(this.#n.yaw)*i],o=[this.#n.targetX,0,this.#n.targetZ],a=Gt(n,o),r=this.#n.orthographic?Ut(-this.#n.distance*e,this.#n.distance*e,-this.#n.distance,this.#n.distance,-this.#f*4,this.#f*4):Yt(At,e,.02,Math.max(60,this.#f*12));return Bt(r,a)}requestRender(){this.#w!==null||this.#D||(this.#w=window.requestAnimationFrame(()=>{this.#w=null,this.#st()}))}#st(){let t=performance.now();this.#at(),this.#z=this.#B(),this.#_==="webgl2"?this.#rt():this.#lt(),this.#ht(),this.#F=performance.now()-t,this.#F>18?(this.#R+=1,this.#R>=3&&this.#d?.quality==="auto"&&(this.#L=Math.max(.25,this.#L*.75))):this.#R=Math.max(0,this.#R-1)}#rt(){let t=this.#s,e=this.#c;if(!t||(t.viewport(0,0,this.#e.width,this.#e.height),t.clearColor(0,0,0,0),t.clear(t.COLOR_BUFFER_BIT|t.DEPTH_BUFFER_BIT),!e||!this.#h||!this.#v))return;if(this.#d?.view==="top"&&this.#d.appearance==="rooms"){this.#T=0;return}t.useProgram(this.#h),t.bindVertexArray(this.#v),t.uniformMatrix4fv(this.#x,!1,this.#z),t.uniform2f(this.#i,(e.metadata.span[0]-1)/2,(e.metadata.span[1]-1)/2),t.uniform1f(this.#y,e.metadata.metersPerCell);let i=Math.min(window.devicePixelRatio||1,3),n=Math.max(1,Math.floor(e.total*this.#L)),o=Math.min(e.floorCount,n),a=Math.min(e.surfaceCount,Math.max(0,n-o));t.uniform1f(this.#P,this.#e.height*.038),t.uniform1f(this.#E,4.5*i),t.drawArrays(t.POINTS,0,o),t.uniform1f(this.#P,this.#e.height*.05),t.uniform1f(this.#E,7*i),t.drawArrays(t.POINTS,e.floorCount,a),t.bindVertexArray(null),this.#T=o+a}#lt(){}#ct(t,e,i=0){let n=this.#c;return n?[-(t-(n.metadata.span[0]-1)/2)*n.metadata.metersPerCell,i*n.metadata.metersPerCell,(e-(n.metadata.span[1]-1)/2)*n.metadata.metersPerCell]:null}#Y(t,e,i=0,n=!0,o=this.#z){let a=this.#ct(t,e,i);if(!a)return null;let[r,l,c]=a,h=(o[0]??0)*r+(o[4]??0)*l+(o[8]??0)*c+(o[12]??0),p=(o[1]??0)*r+(o[5]??0)*l+(o[9]??0)*c+(o[13]??0),d=(o[3]??0)*r+(o[7]??0)*l+(o[11]??0)*c+(o[15]??0);if(d<=.001)return null;let u=h/d,m=p/d;if(!Number.isFinite(u)||!Number.isFinite(m)||n&&(Math.abs(u)>1.15||Math.abs(m)>1.15))return null;let f=this.#S;return{x:(u*.5+.5)*f.width,y:(-m*.5+.5)*f.height}}#I(t,e,i=0,n=!0,o=this.#z){let a=this.#c;if(!a)return null;let r=t/a.metadata.metersPerCell-a.metadata.origin[0],l=e/a.metadata.metersPerCell-a.metadata.origin[1];return this.#Y(r,l,i,n,o)}#ht(){let t=this.#u,e=this.#c,i=this.#d;if(!t)return;let n=Math.min(window.devicePixelRatio||1,3),o=this.#S;if(t.setTransform(n,0,0,n,0,0),t.clearRect(0,0,o.width,o.height),!e||!i)return;let a=this.#A;if(this.#_==="canvas2d"&&this.#l&&!(i.view==="top"&&i.appearance==="rooms")){let d=this.#m/this.#n.distance,u=o.width*d,m=o.height*d,f=(o.width-u)/2-this.#n.targetX*32*d,M=(o.height-m)/2-this.#n.targetZ*32*d;t.drawImage(this.#l,f,M,u,m)}let r=this.#dt(i);if(i.labelsVisible||i.view==="top"&&i.appearance==="rooms"){t.lineWidth=1.5,t.font="600 12px system-ui, sans-serif",t.textAlign="center",t.textBaseline="middle";let d=[];for(let u of e.metadata.rooms){let m=r.has(u.name.toLocaleLowerCase());t.strokeStyle=m?w(a.accent,1):w(a.quiet,.7),t.fillStyle=m?w(a.accent,.26):i.view==="top"&&i.appearance==="rooms"?w(a.roomFill,.94):w(a.plate,.04),t.beginPath();let f=Math.max(1,Math.ceil(u.boundary.length/512)),M=!1;for(let k=0;k<u.boundary.length;k+=f){let q=u.boundary[k];if(!q)continue;let S=this.#Y(q[0],q[1],.2,!1);S&&(M?t.lineTo(S.x,S.y):t.moveTo(S.x,S.y),M=!0)}if(M&&(t.closePath(),t.fill(),t.stroke()),!i.labelsVisible)continue;let E=this.#Y(u.center[0],u.center[1],1);if(!E)continue;let L=t.measureText(u.name).width,C=new DOMRect(E.x-L/2-6,E.y-10,L+12,20);d.some(k=>C.left<k.right+8&&C.right+8>k.left&&C.top<k.bottom+4&&C.bottom+4>k.top)||(d.push(C),t.fillStyle=w(a.plate,.88),t.fillRect(C.x,C.y,C.width,C.height),t.fillStyle=w(a.text,1),t.fillText(u.name,E.x,E.y))}}let l=this.#M,c=l&&y(i,l.capture)?l.circles:i.draw.circles;if((i.workflow==="draw"||i.workflow==="areaReview")&&c.length)if(t.fillStyle=w(a.accent,.22),t.strokeStyle=w(a.accent,.92),t.lineWidth=1.5,i.draw.outline?.closed){t.beginPath();for(let d of c)this.#J(t,d,!1);t.fill()}else for(let d of c)this.#J(t,d);let h=i.draw.outline;if(h&&(i.workflow==="draw"||i.workflow==="areaReview")&&!(i.workflow==="draw"&&i.draw.tool==="outline")&&(t.beginPath(),h.points.forEach((d,u)=>{let m=this.#I(d.x,d.y,0,!1);m&&(u===0?t.moveTo(m.x,m.y):t.lineTo(m.x,m.y))}),h.closed&&t.closePath(),t.strokeStyle=w(a.accent,1),t.lineWidth=2,t.stroke()),this.#k&&i.workflow==="draw"&&(i.draw.tool==="paint"||i.draw.tool==="erase")){let d=this.#I(this.#k.x,this.#k.y),u=this.#I(this.#k.x+i.draw.brushMeters/2,this.#k.y);d&&u&&(t.beginPath(),t.arc(d.x,d.y,Math.max(2,Math.hypot(u.x-d.x,u.y-d.y)),0,Math.PI*2),t.strokeStyle=w(a.accent,1),t.lineWidth=2,t.stroke())}let p=i.resources.pose.value;if(D(i)&&p?.position){let d=this.#I(p.position[0],p.position[1],3);d&&(t.beginPath(),t.arc(d.x,d.y,7,0,Math.PI*2),t.fillStyle=w(a.accent,1),t.fill(),t.strokeStyle=w(a.onAccent,1),t.lineWidth=3,t.stroke())}}#dt(t){let e=t.resources.plans.value?.rooms||t.resources.areas.value?.rooms||[];return new Set(e.filter(i=>(t.workflow==="plan"?t.planDraft.rooms.map(n=>n.roomId):t.selection.roomIds).includes(i.roomId)).map(i=>i.name.toLocaleLowerCase()))}#J(t,e,i=!0){let n=this.#I(e.x,e.y),o=this.#I(e.x+e.radius,e.y);if(!n||!o)return;let a=Math.max(1,Math.hypot(o.x-n.x,o.y-n.y));i&&t.beginPath(),t.moveTo(n.x+a,n.y),t.arc(n.x,n.y,a,0,Math.PI*2),i&&(t.fill(),t.stroke())}setPalette(t){this.#A=t,this.requestRender()}setCursor(t){this.#k=t,this.requestRender()}mapToScreen(t){if(!this.#c)return null;let e=this.#O();return!e.width||!e.height?null:this.#I(t.x,t.y,0,!1,this.#B())}offsetMapPoint(t,e,i){let n=this.mapToScreen(t);if(!n)return null;let o=this.#S,a=this.#n.distance*2/o.height;return this.screenToMap(o.left+n.x+e/a,o.top+n.y+i/a)}screenToMap(t,e){let i=this.#c;if(!i)return null;let n=this.#O();if(!n.width||!n.height)return null;let o=this.#B(),a=(t-n.left)/n.width*2-1,r=1-(e-n.top)/n.height*2,l=o[0]-a*o[3],c=o[8]-a*o[11],h=o[1]-r*o[3],p=o[9]-r*o[11],d=l*p-c*h;if(!Number.isFinite(d)||Math.abs(d)<1e-12)return null;let u=a*o[15]-o[12],m=r*o[15]-o[13],f=(u*p-c*m)/d,M=(l*m-u*h)/d;if(o[3]*f+o[11]*M+o[15]<=0)return null;let E=-f/i.metadata.metersPerCell+(i.metadata.span[0]-1)/2,L=M/i.metadata.metersPerCell+(i.metadata.span[1]-1)/2;return{x:(E+i.metadata.origin[0])*i.metadata.metersPerCell,y:(L+i.metadata.origin[1])*i.metadata.metersPerCell}}roomAt(t,e){let i=this.screenToMap(t,e),n=this.#c,o=this.#d;if(!i||!n||!o)return null;let a=i.x/n.metadata.metersPerCell-n.metadata.origin[0],r=i.y/n.metadata.metersPerCell-n.metadata.origin[1],l=n.metadata.rooms.find(c=>Et(a,r,c.boundary));return l?this.#ut(l,o):null}containsMapPoint(t){let e=this.#c;if(!e)return!1;let i=t.x/e.metadata.metersPerCell-e.metadata.origin[0],n=t.y/e.metadata.metersPerCell-e.metadata.origin[1];return e.metadata.rooms.some(o=>Et(i,n,o.boundary))}#ut(t,e){return(e.resources.plans.value?.rooms||e.resources.areas.value?.rooms||[]).find(n=>n.name.localeCompare(t.name,void 0,{sensitivity:"base"})===0)?.roomId||t.id}selectRoomAt(t,e){let i=this.roomAt(t,e);i&&this.#o.onRoom?.(i)}fit(t=!0,e=this.#d?.workflow==="draw"?"top":this.#d?.view??"three"){let i=e==="top";this.#n=i?{yaw:0,pitch:Math.PI/2-.018,distance:this.#m,targetX:0,targetZ:0,orthographic:!0}:{yaw:-Math.PI/4,pitch:.82,distance:this.#p,targetX:0,targetZ:0,orthographic:!1},this.#g=!0,this.requestRender(),t&&this.#H()}zoomAt(t,e,i){let n=e===void 0||i===void 0?null:this.screenToMap(e,i),o=this.#X();if(this.#n={...this.#n,distance:g(this.#n.distance/t,o.minimum,o.maximum)},this.#g=!1,n&&e!==void 0&&i!==void 0){let a=this.screenToMap(e,i);a&&(this.#n={...this.#n,targetX:this.#n.targetX-(n.x-a.x),targetZ:this.#n.targetZ+(n.y-a.y)})}this.requestRender(),this.#H(e,i)}panBy(t,e){this.setCamera(this.cameraAfterPan(this.#n,t,e))}orbitBy(t,e){if(this.#n.orthographic){this.panBy(t,e);return}this.#n={...this.#n,yaw:R(this.#n.yaw+t*.006),pitch:g(this.#n.pitch-e*.004,.18,1.38)},this.#g=!1,this.requestRender(),this.#H()}rotateBy(t){this.#n={...this.#n,yaw:R(this.#n.yaw+t)},this.#g=!1,this.requestRender(),this.#H()}#H(t,e){let i=this.#n.orthographic?this.#m:this.#p,n=t===void 0||e===void 0?this.#S:this.#O(),o=t===void 0||e===void 0||!n.width||!n.height?void 0:{xPercent:g((t-n.left)/n.width*100,0,100),yPercent:g((e-n.top)/n.height*100,0,100)};this.#o.onCamera?.(this.camera,Math.round(i/this.#n.distance*100),o)}diagnostics(){return{mode:this.#_,contextGeneration:this.#q,sceneRevision:this.#c?.revision??null,sourcePoints:this.#c?.total??0,renderedPoints:this.#T,lastFrameMs:Math.round(this.#F*100)/100,slowFrames:this.#R,cameraDistance:this.#n.distance,fitDistance:this.#n.orthographic?this.#m:this.#p,fitActive:this.#g}}#tt=t=>{t.preventDefault(),this.#W(),this.#j(),this.requestRender()};#et=()=>{this.#W(),this.#K(),this.requestRender()};#W(){let t=this.#s;t&&(this.#b&&t.deleteBuffer(this.#b),this.#v&&t.deleteVertexArray(this.#v),this.#h&&t.deleteProgram(this.#h)),this.#b=null,this.#v=null,this.#h=null,this.#s=null}dispose(){this.#D||(this.#D=!0,this.#C.disconnect(),this.#e.removeEventListener("webglcontextlost",this.#tt),this.#e.removeEventListener("webglcontextrestored",this.#et),this.#w!==null&&window.cancelAnimationFrame(this.#w),this.#w=null,this.#Q(),this.#W(),this.#l=null,this.#a=null,this.#u=null,this.#M=null,this.#c=null,this.#d=null)}};var Kt="matic-workspace-intent",Zt="matic-workspace-action",zt="navigation-help",Tt=(s,t)=>{let e=(n,o,a)=>V(t,n,o,a);if(s.dataMode==="history"||s.floor.readOnly)return s.map.available?e("v4_saved_map_description","Saved read-only map for {floor}. Live robot position is hidden.",{floor:s.floor.displayName}):s.resources.scene.status==="loading"?e("v4_saved_map_loading_description","The saved map is loading."):e("v4_saved_map_unavailable_description","This saved map is unavailable.");if(!W(s))return e("v4_private_map_unavailable","The current private map is not available.");let i=D(s)?e("v4_robot_position_verified","The robot position is verified."):e("v4_robot_position_hidden","The robot position is not shown.");return e("v4_live_map_description","Live map for {floor}. {pose}",{floor:s.floor.displayName,pose:i})},Y=class extends Z{constructor(){super();this.state=U();this.narrow=!1;this.#e=null;this.#t=null;this.#o=null;this.#s=!1;this.#u=!1;this.#a=null;this.#l=[];this.#h=null;this.#b=null;this.#v={capture:!0,handleEvent:e=>{e.pointerType==="touch"&&!e.isPrimary&&this.#x.cancel()}};this.#x=new X(()=>this.state,()=>this.#t,e=>this.#r(e),()=>this.requestUpdate(),(e,i)=>this.#i(e,i),e=>{this.updateComplete.then(()=>{(this.renderRoot.querySelector(`[data-zone-index="${e}"]`)??this.renderRoot.querySelector(".map-root"))?.focus({preventScroll:!0})})});this.#d=()=>{this.#P()};new T(this,{container:()=>this.renderRoot?.querySelector(".camera-steps")??null,items:"button"}),new T(this,{container:()=>this.renderRoot?.querySelector(".draw-tools")??null,items:"button"})}static{this.properties={state:{attribute:!1},localize:{attribute:!1},narrow:{type:Boolean,reflect:!0}}}static{this.styles=[j,Q,J,K`
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
  `]}#e;#t;#o;#s;#u;#a;#l;#h;#b;#v;#x;#i(e,i,n){return V(this.localize,e,i,n)}connectedCallback(){super.connectedCallback(),this.#M()}firstUpdated(){let e=this.renderRoot.querySelector(".map-root"),i=this.renderRoot.querySelector(".scene-canvas"),n=this.renderRoot.querySelector(".overlay-canvas");!e||!i||!n||(this.#t=new H(i,n,{onViewport:()=>{this.#x.cancel(),this.requestUpdate()},onCamera:(o,a,r)=>{this.#r({type:"set-camera",view:this.state.workflow==="draw"?"top":this.state.view,camera:{yaw:o.yaw,pitch:o.pitch,zoom:a/100,targetX:o.targetX,targetZ:o.targetZ}}),this.state.workflow==="draw"&&a!==this.state.draw.zoomPercent&&this.#r({type:"set-zoom",value:a,...r?{originX:r.xPercent,originY:r.yPercent}:{}})},onCameraPreferences:o=>{for(let a of["top","three"]){let r=o[a];r&&this.#r({type:"set-camera",view:a,camera:r})}},onRoom:o=>this.#r({type:"toggle-room",roomId:o}),onProblem:()=>this.#w("renderer-problem")}),this.#o=new O(e,this.#t,{state:()=>this.state,onOutlinePoint:(o,a)=>this.#x.addPoint(o,a),onCircles:(o,a)=>this.#r({type:"set-draft-circles",circles:o,coordinateEdit:a}),onCirclePreview:(o,a)=>this.#t?.setCirclePreview(o,a),onRoom:o=>this.#r({type:"toggle-room",roomId:o})}),this.#t.setState(this.state),this.#P())}disconnectedCallback(){this.#c(),this.#x.cancel(),this.#o?.dispose(),this.#o=null,this.#t?.dispose(),this.#t=null,super.disconnectedCallback()}updated(e){this.#u&&(this.#u=!1,this.renderRoot.querySelector(".navigation-help button")?.focus()),e.has("state")&&(this.#o?.observeState(this.state),this.#x.observeState(this.state),this.#t?.setState(this.state),this.state.draw.tool==="outline"&&this.requestUpdate())}#y(){let e=this.renderRoot?.querySelector(".map-root");!e||!this.#t||this.#t.setPalette(wt(e))}#P(){this.#E(),this.#h=window.requestAnimationFrame(()=>{this.#h=null,this.#b=window.setTimeout(()=>{this.#b=null,this.#y()},0)})}#E(){this.#h!==null&&window.cancelAnimationFrame(this.#h),this.#b!==null&&window.clearTimeout(this.#b),this.#h=null,this.#b=null}#d;#M(){if(!(typeof document>"u"||this.#a)&&(this.#a=new MutationObserver(this.#d),this.#a.observe(document.documentElement,{attributes:!0,attributeFilter:["style","class"]}),typeof window.matchMedia=="function")){this.#l=[window.matchMedia("(prefers-color-scheme: dark)"),window.matchMedia("(forced-colors: active)")];for(let e of this.#l)e.addEventListener("change",this.#d)}}#c(){this.#E(),this.#a?.disconnect(),this.#a=null;for(let e of this.#l)e.removeEventListener("change",this.#d);this.#l=[]}#r(e){this.dispatchEvent(new CustomEvent(Kt,{detail:e,bubbles:!0,composed:!0}))}#w(e){this.dispatchEvent(new CustomEvent(Zt,{detail:{id:e},bubbles:!0,composed:!0}))}#$(e){this.#e=e.currentTarget,this.#s=!this.#s,this.#u=this.#s,this.requestUpdate()}#C(){if(!this.#s)return;this.#s=!1,this.requestUpdate();let e=this.#e;e?.isConnected&&e.focus()}#n(){for(let e of this.state.selection.roomIds)this.#r({type:"toggle-room",roomId:e})}#p(e,i){this.#t?.orbitBy(e,i)}#m(e){if(!Pt(e)&&!(e.ctrlKey||e.metaKey||e.altKey)&&e.key==="Escape"){if(e.preventDefault(),this.#s){this.#C();return}this.#r({type:"dismiss-top-layer"});return}}rendererDiagnostics(){return this.#t?.diagnostics()??null}canvasIdentity(){return{scene:this.renderRoot.querySelector(".scene-canvas"),overlay:this.renderRoot.querySelector(".overlay-canvas")}}#f(){return this.state.host.connected?this.state.host.administrator?this.state.host.robotCount===0?{title:this.#i("v4_no_robot","No Matic robot set up"),detail:this.#i("v4_no_robot_detail","Set up a robot before opening its map.")}:this.state.dataMode==="live"&&this.state.floor.readOnly&&this.state.map.available&&this.state.notice?{title:this.#i("v4_saved_map_read_only_title","Saved map is read only"),detail:this.state.notice.text}:this.state.dataMode==="history"?!this.state.map.available&&this.state.resources.scene.status==="loading"?{title:this.#i("v4_loading_saved_map","Loading saved map"),detail:this.#i("v4_loading_saved_map_detail","This read-only snapshot is still preparing.")}:this.state.map.available?null:{title:this.#i("v4_saved_map_unavailable","Saved map unavailable"),detail:this.#i("v4_saved_map_unavailable_detail","Choose another snapshot or return to the live map.")}:this.state.host.robotConnected?this.state.coherence==="verifying"||this.state.coherence==="booting"?{title:this.#i("v4_locating_map","Locating the current map"),detail:this.#i("v4_locating_map_detail","Map controls will return after the floor is verified.")}:!this.state.map.available&&this.state.resources.scene.status==="loading"?{title:this.#i("v4_loading_verified_map","Loading the verified map"),detail:this.#i("v4_loading_verified_map_detail","The current floor is verified. The private scene is still preparing.")}:this.state.map.available?this.state.activity==="problem"?{title:this.#i("v4_robot_attention","Robot needs attention"),detail:this.#i("v4_robot_attention_detail","Check the robot before starting another task.")}:null:{title:this.#i("v4_map_unavailable","Map unavailable"),detail:this.#i("v4_map_unavailable_detail","The private scene is not ready. No map data is shown until it is verified.")}:{title:this.#i("v4_robot_offline","Robot offline"),detail:this.#i("v4_robot_offline_detail","The last verified map stays read only and has no live position.")}:{title:this.#i("v4_admin_required","Administrator access required"),detail:this.#i("v4_private_map_hidden","Private map data is hidden.")}:{title:this.#i("v4_reconnecting","Reconnecting"),detail:this.#i("v4_reconnecting_detail","The verified map is read only until Home Assistant reconnects.")}}#z(e,i){let n=this.state,o=this.narrow,a=n.workflow==="draw",r=this.#i("v4_how_to_move","How to move the map"),l=e&&!a,c=l&&!o&&n.view==="top",h=l&&n.view==="three",p=!i,d=!o&&!a;return b`
      <div class="map-rail" data-map-control>
        <div class="map-context"><slot name="floor"></slot>
        ${l?b`
          <div class="view-switch ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#i("map_view_label","Map view")}>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(n.view==="three")}
              @click=${()=>this.#r({type:"set-view",view:"three"})}
            >${this.#i("map_view_3d","3D")}</button>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(n.view==="top")}
              @click=${()=>this.#r({type:"set-view",view:"top"})}
            >${this.#i("map_view_top","2D")}</button>
          </div>
        `:v}

        </div>
        ${c?b`
          <div class="appearance-switch ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#i("map_style_label","Map style")}>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(n.appearance==="photo")}
              @click=${()=>this.#r({type:"set-appearance",appearance:"photo"})}
            >${this.#i("map_style_photo","Photo")}</button>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(n.appearance==="rooms")}
              @click=${()=>this.#r({type:"set-appearance",appearance:"rooms"})}
            >${this.#i("map_style_room_colours","Floor plan")}</button>
          </div>
        `:v}

        ${h?b`
          <div class="camera-steps ms-surface ms-surface--floating ms-segment" role="toolbar" aria-orientation="horizontal" aria-label=${this.#i("map_camera_controls","Map camera controls")}>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#i("map_rotate_left","Rotate left")} aria-keyshortcuts="[" @click=${()=>this.#p(-52,0)}>${x(at)}</button>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#i("map_tilt_down","Lower viewing angle")} aria-keyshortcuts="PageDown" @click=${()=>this.#p(0,30)}>${x(et)}</button>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#i("map_tilt_up","Raise viewing angle")} aria-keyshortcuts="PageUp" @click=${()=>this.#p(0,-30)}>${x(tt)}</button>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#i("map_rotate_right","Rotate right")} aria-keyshortcuts="]" @click=${()=>this.#p(52,0)}>${x(st)}</button>
          </div>
        `:v}

        ${p?b`
          <div class="map-tools ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#i("v4_map_tools","Map tools")}>
            ${i?v:b`
              <button
                class="fit ms-btn"
                type="button"
                aria-label=${this.#i("v4_fit_map_hint","Fit the whole map on screen")}
                @click=${()=>{this.#t?.fit(),this.#r({type:"fit-map"})}}
                title=${this.#i("v4_fit_map","Fit map")}
              >${x(it)}<span class="ms-btn__label">${this.#i("v4_fit_map","Fit map")}</span></button>
            `}
          </div>
        `:v}
        ${!i&&d?b`
          <div class="map-extras ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#i("v4_map_display","Map display")}>
              <button
                class="labels ms-btn"
                type="button"
                aria-pressed=${String(n.labelsVisible)}
                @click=${()=>this.#r({type:"toggle-labels"})}
                title=${this.#i("v4_room_names","Room names")}
              >${x(nt)}<span class="ms-btn__label">${this.#i("v4_room_names","Room names")}</span></button>
              <button
                class="help ms-btn ms-btn--icon"
                type="button"
                aria-label=${r}
                aria-expanded=${String(this.#s)}
                aria-controls=${zt}
                @click=${this.#$}
                title=${r}
              >${x(ot)}</button>
          </div>
        `:v}

        ${this.#s&&e&&d?b`
          <div
            id=${zt}
            class="navigation-help ms-surface ms-surface--floating"
            role="dialog"
            aria-modal="false"
            aria-label=${r}
          >
            <header>
              <h3>${r}</h3>
              <button class="ms-btn ms-btn--sm" type="button" @click=${()=>this.#C()}>${this.#i("v4_close","Close")}</button>
            </header>
            <dl>
              <dt>${this.#i("v4_trackpad","Trackpad")}</dt>
              <dd>${this.#i("v4_trackpad_help","Scroll to pan \xB7 pinch to zoom \xB7 twist to rotate")}</dd>
              <dt>${this.#i("v4_mouse","Mouse")}</dt>
              <dd>${this.#i("v4_mouse_help","Drag to orbit \xB7 Shift, middle, or right drag to pan \xB7 wheel to zoom")}</dd>
              <dt>${this.#i("v4_keyboard","Keyboard")}</dt>
              <dd>${this.#i("v4_keyboard_help","WASD to move \xB7 Q/E or arrows to orbit \xB7 +/\u2212 to zoom \xB7 0 to fit")}</dd>
            </dl>
          </div>
        `:v}
      </div>
    `}#k(e){let i=this.state;if(!e)return v;if(i.workflow==="draw"&&!this.narrow)return b`
        <div class="map-dock ms-surface ms-surface--floating" data-map-control>
          ${bt(i,{intent:o=>this.#r(o),openBrush:()=>this.#r({type:"set-precision-open",value:!i.precisionOpen}),t:(o,a)=>this.#i(o,a)},"row")}
        </div>
      `;let n=i.selection.roomIds.length;return i.workflow==="rooms"&&n>0&&!this.narrow?b`
        <div class="map-dock ms-surface ms-surface--floating" data-map-control>
          <div class="selection-chip ms-surface ms-surface--floating" data-map-control>
            <span>${this.#i("v4_rooms_selected","Rooms selected: {count}").replace("{count}",String(n))}</span>
            <button class="ms-btn ms-btn--sm" type="button" @click=${()=>this.#n()}>${this.#i("v4_clear","Clear")}</button>
          </div>
        </div>
      `:v}render(){let e=this.state,i=G(e),n=this.#f(),o=e.map.available&&(W(e)||e.dataMode==="history"),a=e.workflow==="draw"&&o,r=e.coherence==="verifying"||e.coherence==="booting";return b`
      <section
        class="map-root"
        tabindex="0"
        aria-label=${this.#i("map_viewport_aria","Interactive Matic 3D map")}
        aria-describedby=${a?e.draw.tool==="outline"?"zone-keyboard-help":"keyboard-draw-help":v}
        data-full-map=${String(e.fullMap)}
        data-workflow=${e.workflow}
        data-draw-tool=${e.draw.tool}
        data-narrow=${this.narrow?"true":v}
        @keydown=${this.#m}
        @pointerdown=${this.#v}
      >
        ${this.#z(o,r)}
        <slot name="scrim"></slot>

        <div
          class="scene-window"
          data-renderer-key="persistent-canvas-v4"
          ?hidden=${!o}
          role=${a?"group":"img"}
          aria-label=${Tt(e,this.localize)}
        >
          ${a?b`<span class="keyboard-aim" aria-hidden="true"></span>`:v}
          <canvas class="scene-canvas"></canvas>
          <canvas class="overlay-canvas"></canvas>
          ${a?this.#x.render():v}
        </div>

        ${a?b`
          <p id="zone-keyboard-help" class="sr-only">${this.#i("v4_zone_keyboard_help","Focus the map, aim with arrow keys, and press Enter to place points. The edges join automatically after three points. Keep adding points or Tab to a point; arrows move it, Delete removes it, and Escape cancels a drag.")}</p>
          <p id="keyboard-draw-help" class="sr-only">${this.#i("v4_keyboard_draw_help","Keyboard: focus the map, use arrow keys to aim, then Enter to paint or erase at the crosshair. D selects Paint; E selects Erase.")}</p>
          <div class="map-scale" aria-label=${`Scale ${i.label}`}>
            <span class="scale-line" style=${`--scale-width:${i.pixels}px`}></span>
            <span>${i.label}</span>
          </div>
        `:v}

        ${this.#k(o)}

        ${n&&!(e.fullMap&&(r||!e.host.administrator))?b`
          <div class="map-message ms-surface ms-surface--floating" role="status">
            <strong>${n.title}</strong>
            <span>${n.detail}</span>
          </div>
        `:v}
        <div class="sr-only" aria-live="polite" aria-atomic="true">
          ${Tt(e,this.localize)}
        </div>
      </section>
    `}};customElements.get(B)||customElements.define(B,Y);export{B as a,jt as b,Qt as c,Jt as d,te as e,F as f,bt as g,Pt as h,T as i,Kt as j,Zt as k};
