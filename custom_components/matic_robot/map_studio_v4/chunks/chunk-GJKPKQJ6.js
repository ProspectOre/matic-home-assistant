import{$ as ot,A as Y,C as U,D as b,H as v,J as K,K as G,L as Z,M as j,V as J,W as Q,X as tt,Y as et,Z as it,_ as nt,aa as at,ba as st,ca as rt,da as lt,ea as ct,fa as ht,j as B,ka as dt,q,r as L,s as C,sa as g,ta as N}from"./chunk-A6PCQKJI.js";var ut=import.meta.url.match(/\/matic_robot\/[^/]+-([a-f0-9]{12})\/map-studio-v4(?:\/|$)/u)?.[1]??"dev",$=ut==="dev"?"":`-${ut}`,W=`matic-map-canvas-v4${$}`,Kt=`matic-precision-controls-v4${$}`,Gt=`matic-map-workflow-v4${$}`,Zt=`matic-map-shell-v4${$}`,jt=`matic-map-panel-v0-4-0${$}`;var S=(s,t,e)=>{let i=e.x-t.x,n=e.y-t.y,o=Math.max(0,Math.min(1,((s.x-t.x)*i+(s.y-t.y)*n)/(i*i+n*n||1)));return Math.hypot(s.x-t.x-o*i,s.y-t.y-o*n)},At=(s,t)=>{let e=!1;for(let i=0,n=t.length-1;i<t.length;n=i++){let o=t[i],a=t[n];o.y>s.y!=a.y>s.y&&s.x<(a.x-o.x)*(s.y-o.y)/(a.y-o.y)+o.x&&(e=!e)}return e},D=(s,t,e)=>(t.x-s.x)*(e.y-s.y)-(t.y-s.y)*(e.x-s.x),I=({points:s,closed:t})=>{if(s.length>64||t&&s.length<3||s.some(i=>!Number.isFinite(i.x)||!Number.isFinite(i.y)||Math.abs(i.x)>1e4||Math.abs(i.y)>1e4))return!1;let e=t?s.length:s.length-1;for(let i=0;i<e;i++){let n=s[i],o=s[(i+1)%s.length];if(Math.hypot(n.x-o.x,n.y-o.y)<.01)return!1;for(let a=i+2;a<e;a++){if(t&&i===0&&a===e-1)continue;let r=s[a],l=s[(a+1)%s.length];if(Math.min(S(n,r,l),S(o,r,l),S(r,n,o),S(l,n,o))<1e-5||D(n,o,r)*D(n,o,l)<0&&D(r,l,n)*D(r,l,o)<0)return!1}}return!t||Math.abs(s.reduce((i,n,o)=>{let a=s[(o+1)%s.length];return i+n.x*a.y-a.x*n.y},0))>.01},pt=(s,t)=>{if(!s.closed||!I(s))return[];let{points:e}=s,i=Math.min(...e.map(c=>c.x)),n=Math.max(...e.map(c=>c.x)),o=Math.min(...e.map(c=>c.y)),a=Math.max(...e.map(c=>c.y)),r=[];for(let c=0;c<32;c++)for(let h=0;h<32;h++){let d={x:Math.round((i+(h+.5)*(n-i)/32)*1e4)/1e4,y:Math.round((o+(c+.5)*(a-o)/32)*1e4)/1e4};if(!At(d,e)||!t(d))continue;let u=Math.min(...e.map((m,f)=>S(d,m,e[(f+1)%e.length]))),p=Math.floor(Math.min(2.5,u-1e-4)*1e4)/1e4;p>=.05&&r.push({...d,radius:p})}r.sort((c,h)=>h.radius-c.radius);let l=[];for(let c of r){if(l.length>=512)break;l.some(h=>Math.hypot(h.x-c.x,h.y-c.y)+c.radius*.5<=h.radius)||l.push(c)}return l};var F=class{constructor(t,e,i,n,o,a){this.state=t;this.renderer=e;this.intent=i;this.update=n;this.t=o;this.focusPoint=a}#n=null;#t="";#s=null;#o(){let t=this.state();return!t.dialog&&t.workflow==="draw"&&t.draw.tool==="outline"&&C(t)&&(t.command==="idle"||t.command==="failed")}#m(t){if(!this.#o())return;if(!I(t)){this.#t=this.t("v4_zone_invalid","Keep the outline from crossing itself."),this.update();return}let e=pt(t,i=>this.renderer()?.containsMapPoint(i)??!1);this.#t=t.closed&&!e.length?this.t("v4_zone_empty","Make the zone wider and keep it on mapped floor."):"",this.intent({type:"set-draft-circles",circles:e,outline:t})}addPoint(t){if(!this.#o()||!this.renderer()?.containsMapPoint(t))return;let e=this.state().draw.outline??{points:[],closed:!1};if(e.points.length>=64)return;let i=[...e.points,t];this.#m({points:i,closed:i.length>=3})}#a(t){let e=this.state().draw.outline;if(!e)return;this.#s=null;let i=e.points.filter((n,o)=>o!==t);this.#m({points:i,closed:e.closed&&i.length>=3}),this.focusPoint(Math.min(t,i.length-1))}#r(t){let e=this.state().draw.outline;if(!e||e.points.length>=64)return;let i=e.points[t],n=e.points[(t+1)%e.points.length];if(!i||!n||!e.closed&&t===e.points.length-1)return;let o={x:(i.x+n.x)/2,y:(i.y+n.y)/2};this.#m({...e,points:[...e.points.slice(0,t+1),o,...e.points.slice(t+1)]}),this.focusPoint(t+1)}#d(t,e){if(!this.#o()||t.button!==0||this.#n||t.pointerType==="touch"&&!t.isPrimary)return;this.#s=e,this.update();let i=this.state().draw.outline;if(!i)return;t.stopPropagation(),t.preventDefault();let n=t.currentTarget;n.focus({preventScroll:!0}),n.setPointerCapture(t.pointerId),this.#n={index:e,pointer:t.pointerId,baseline:i,preview:i,target:n}}#c(t){let e=this.#n;if(!e||e.pointer!==t.pointerId)return;if(t.stopPropagation(),t.preventDefault(),!this.#o()||this.state().draw.outline!==e.baseline){this.cancel();return}let i=this.renderer()?.screenToMap(t.clientX,t.clientY);!i||!this.renderer()?.containsMapPoint(i)||(e.preview={...e.baseline,points:e.baseline.points.map((n,o)=>o===e.index?i:n)},this.update())}#b(t){let e=this.#n;!e||e.pointer!==t.pointerId||(t.stopPropagation(),t.preventDefault(),this.#n=null,e.target.releasePointerCapture(t.pointerId),this.state().draw.outline===e.baseline&&this.#o()&&e.preview!==e.baseline&&this.#m(e.preview),this.update())}cancel(){let t=this.#n;t&&(this.#n=null,t.target.hasPointerCapture(t.pointer)&&t.target.releasePointerCapture(t.pointer),this.update())}#w(t,e){if(t.ctrlKey||t.altKey||t.metaKey)return;if(t.key==="Escape"){t.stopPropagation(),this.cancel();return}let i=this.state().draw.outline;if(!i||!this.#o())return;if(t.key==="Delete"||t.key==="Backspace"){t.preventDefault(),t.stopPropagation(),this.#a(e);return}let n=t.shiftKey?.1:.02,o=t.key==="ArrowLeft"?-n:t.key==="ArrowRight"?n:0,a=t.key==="ArrowUp"?-n:t.key==="ArrowDown"?n:0;if(!o&&!a)return;t.preventDefault(),t.stopPropagation();let r=i.points[e],l=this.renderer()?.offsetMapPoint(r,o,a);l&&this.renderer()?.containsMapPoint(l)&&this.#m({...i,points:i.points.map((c,h)=>h===e?l:c)})}render(){if(!this.#o())return v;let t=this.#n?.preview??this.state().draw.outline,e=t?.points??[],i=e.map(r=>this.renderer()?.mapToScreen(r)),n=i.map((r,l)=>r?`${l?"L":"M"}${r.x},${r.y}`:"").join(" "),o=!t||I(t),a=this.#s!==null&&this.#s<e.length?this.#s:null;return b`
      <div class="zone-overlay">
        <svg aria-hidden="true"><path d=${n+(t?.closed?" Z":"")} class=${o?"":"invalid"} fill=${t?.closed?"var(--ms-accent)":"none"}></path></svg>
        ${i.map((r,l)=>r?b`
          <button class="zone-point" type="button" data-zone-index=${l} data-selected=${String(this.#s===l)} data-map-control style=${`left:${r.x}px;top:${r.y}px`}
            aria-label=${`${this.t("v4_zone_point","Zone point")} ${l+1}`} aria-describedby="zone-handle-help"
            title=${this.t("v4_zone_point_help","Drag to move. Arrow keys adjust; Delete removes.")}
            @pointerdown=${c=>this.#d(c,l)} @pointermove=${c=>this.#c(c)}
            @pointerup=${c=>this.#b(c)} @pointercancel=${()=>this.cancel()}
            @lostpointercapture=${()=>{this.#n&&this.cancel()}}
            @focus=${()=>{this.#s=l,this.update()}}
            @keydown=${c=>this.#w(c,l)}
          >${l+1}</button>
        `:v)}
        ${e.map((r,l)=>{let c=e[(l+1)%e.length];if(!c||!t?.closed&&l===e.length-1||e.length>=64)return v;let h={x:(r.x+c.x)/2,y:(r.y+c.y)/2},d=this.renderer()?.mapToScreen(h),u=i[l],p=i[(l+1)%i.length];return d&&u&&p&&Math.hypot(u.x-p.x,u.y-p.y)>=100?b`<button class="zone-point zone-midpoint" type="button" data-map-control
            style=${`left:${d.x}px;top:${d.y}px`} aria-label=${`${this.t("v4_zone_add_point","Add point after")} ${l+1}`}
            @click=${()=>this.#r(l)}>+</button>`:v})}
        <div class="zone-help" data-map-control>
          <span id="zone-handle-help" class="sr-only">${this.t("v4_zone_point_help","Drag to move. Arrow keys adjust; Delete removes.")}</span>
          ${a!==null?b`
            <div class="zone-point-actions ms-surface" role="group" aria-label=${`${this.t("v4_zone_point","Zone point")} ${a+1}`}>
              <span class="zone-selection">${this.t("v4_zone_point_short","Point")} ${a+1}</span>
              <button class="ms-btn" type="button" ?disabled=${e.length>=64||!t?.closed&&a===e.length-1} @click=${()=>this.#r(a)}>${this.t("v4_zone_insert_point","Insert point")}</button>
              <button class="ms-btn" type="button" aria-label=${`${this.t("v4_zone_delete_point","Delete point")} ${a+1}`} @click=${()=>this.#a(a)}>${this.t("v4_zone_delete_point","Delete point")}</button>
            </div>`:v}
          ${a===null||!t?.closed?b`
            <div class="zone-guidance ms-surface">
              <span>${t?.closed?this.t("v4_zone_edit_help","Tap to add points. Drag points to reshape."):this.t("v4_zone_create_help","Place points around the area. The edges join automatically.")}</span>
            </div>`:v}
          <span class="zone-feedback ms-surface" role="status" ?hidden=${!this.#t}>${this.#t}</span>
        </div>
      </div>
    `}};var zt=["outline","paint","erase","pan"],mt=(s,t,e)=>{let{draw:i}=s,n=`${i.brushMeters.toFixed(2)} m`;return b`
    <div
      class=${`draw-tools draw-tools--${e} ms-segment`}
      data-zone=${String(i.tool==="outline")}
      role="toolbar"
      aria-label=${t.t("v4_draw_tools","Draw area tools")}
      data-map-control
    >
      ${zt.map(o=>b`
        <button
          class="ms-btn"
          type="button"
          aria-pressed=${String(i.tool===o)}
          data-tool=${o}
          @click=${()=>t.intent({type:"set-draw-tool",tool:o})}
        >${g(o==="outline"?dt:o==="paint"?rt:o==="erase"?ct:ht)}<span class="ms-btn__label">${o==="outline"?t.t("v4_zone_tool","Zone"):o==="paint"?t.t("area_paint","Paint"):o==="erase"?t.t("area_erase","Erase"):t.t("move_map","Move map")}</span></button>
      `)}
      <button
        class="ms-btn"
        type="button"
        ?disabled=${i.strokeCount===0}
        @click=${()=>t.intent({type:"undo-draft"})}
      >${g(at)}<span class="ms-btn__label">${t.t("undo","Undo")}</span></button>
      <button
        class="ms-btn"
        type="button"
        ?disabled=${i.redo.length===0}
        @click=${()=>t.intent({type:"redo-draft"})}
      >${g(st)}<span class="ms-btn__label">${t.t("redo","Redo")}</span></button>
      ${i.tool!=="outline"?b`<button
        class="ms-btn draw-brush"
        type="button"
        aria-label=${t.t("v4_brush_button","Brush width, {brush}. Opens brush settings.").replace("{brush}",n)}
        aria-expanded=${String(s.precisionOpen)}
        aria-haspopup="dialog"
        @click=${t.openBrush}
      >${g(lt)}<span class="ms-btn__label">${t.t("v4_brush","Brush {brush}").replace("{brush}",n)}</span></button>`:v}
    </div>
  `};var Tt=s=>s.matches(":disabled, [aria-disabled='true']"),A=class{#n;#t;#s=null;#o=null;constructor(t,e){this.#n=t,this.#t=e,t.addController(this)}hostConnected(){this.#n.addEventListener("focusin",this.#r)}hostDisconnected(){this.#n.removeEventListener("focusin",this.#r),this.#s?.removeEventListener("keydown",this.#d),this.#s=null,this.#o=null}hostUpdated(){let t=this.#t.container();t!==this.#s&&(this.#s?.removeEventListener("keydown",this.#d),t?.addEventListener("keydown",this.#d),this.#s=t),this.#a()}#m(){let t=this.#s;return t?[...t.querySelectorAll(this.#t.items)].filter(e=>!Tt(e)):[]}#a(){let t=this.#m(),e=(this.#o&&t.includes(this.#o)?this.#o:null)??t.find(n=>n.matches("[aria-pressed='true'], [aria-checked='true']"))??t[0]??null;this.#o=e;let i=this.#s?.querySelectorAll(this.#t.items)??[];for(let n of i)n.tabIndex=n===e?0:-1}#r=t=>{let e=t.composedPath()[0];!(e instanceof HTMLElement)||!this.#s?.contains(e)||e.matches(this.#t.items)&&(this.#o=e,this.#a())};#d=t=>{if(t.defaultPrevented||t.ctrlKey||t.metaKey||t.altKey)return;let e=this.#t.orientation??"horizontal",i=e!=="vertical",n=e!=="horizontal",o=this.#m();if(!o.length)return;let a=t.composedPath()[0],r=Math.max(0,o.findIndex(h=>h===this.#o||a instanceof Node&&h.contains(a))),l;switch(t.key){case"ArrowLeft":if(!i)return;l=r-1;break;case"ArrowRight":if(!i)return;l=r+1;break;case"ArrowUp":if(!n)return;l=r-1;break;case"ArrowDown":if(!n)return;l=r+1;break;case"Home":l=0;break;case"End":l=o.length-1;break;default:return}t.preventDefault();let c=o[(l+o.length)%o.length];c&&(this.#o=c,this.#a(),c.focus())}};var ft={accent:["--ms-accent","Highlight",[6,120,206]],onAccent:["--ms-on-accent","HighlightText",[255,255,255]],text:["--ms-text","CanvasText",[38,50,56]],quiet:["--ms-text-quiet","GrayText",[75,92,105]],plate:["--ms-surface-card","Canvas",[250,252,253]],roomFill:["--ms-surface-sunken","Canvas",[231,238,242]]},Rt=s=>Math.max(0,Math.min(255,Math.round(s))),bt=s=>{let t=s.trim(),e=t.match(/^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i)?.[1];if(e){let h=e.length<=4?[e[0],e[1],e[2]].map(m=>Number.parseInt(`${m}${m}`,16)):[e.slice(0,2),e.slice(2,4),e.slice(4,6)].map(m=>Number.parseInt(m,16)),[d,u,p]=h;return d===void 0||u===void 0||p===void 0?null:[d,u,p]}let i=t.startsWith("color(srgb"),n=t.slice(t.indexOf("(")+1).match(/-?\d*\.?\d+/g);if(!n||n.length<3)return null;let o=i?255:1,a=n.slice(0,3).map(h=>Rt(Number(h)*o)),[r,l,c]=a;return r===void 0||l===void 0||c===void 0||[r,l,c].some(h=>Number.isNaN(h))?null:[r,l,c]},y=(s,t)=>`rgba(${s[0]},${s[1]},${s[2]},${t})`,vt=s=>{let t=window.matchMedia?.("(forced-colors: active)").matches??!1;if(!t){let n=document.createElement("span"),o=document.createElement("canvas");o.width=1,o.height=1;let a=o.getContext("2d",{colorSpace:"srgb",willReadFrequently:!0});n.setAttribute("aria-hidden","true"),n.style.cssText="position:absolute;inline-size:0;block-size:0;overflow:hidden;visibility:hidden;pointer-events:none",s.append(n);let r=l=>{let[c,,h]=ft[l];n.style.color=`var(${c}, transparent)`;let d=getComputedStyle(n).color;if(a){a.clearRect(0,0,1,1),a.fillStyle="transparent",a.fillStyle=d,a.fillRect(0,0,1,1);let[u,p,m,f]=a.getImageData(0,0,1,1).data;if(u!==void 0&&p!==void 0&&m!==void 0&&f!==void 0&&f!==0)return[u,p,m]}return bt(d)??h};try{return{accent:r("accent"),onAccent:r("onAccent"),text:r("text"),quiet:r("quiet"),plate:r("plate"),roomFill:r("roomFill"),forced:t}}finally{n.remove()}}let e=document.createElement("span");e.setAttribute("aria-hidden","true"),e.style.cssText="position:absolute;inline-size:0;block-size:0;overflow:hidden;visibility:hidden;pointer-events:none",s.append(e);let i=n=>{let[,o,a]=ft[n];return e.style.color=o,bt(getComputedStyle(e).color)??a};try{return{accent:i("accent"),onAccent:i("onAccent"),text:i("text"),quiet:i("quiet"),plate:i("plate"),roomFill:i("roomFill"),forced:t}}finally{e.remove()}};var yt=(s,t)=>Math.hypot(s.x-t.x,s.y-t.y),wt=(s,t)=>({x:(s.x+t.x)/2,y:(s.y+t.y)/2}),gt=(s,t)=>Math.atan2(t.y-s.y,t.x-s.x),Lt=s=>{let t=s;for(;t>Math.PI;)t-=Math.PI*2;for(;t<-Math.PI;)t+=Math.PI*2;return t},_=(s,t,e)=>Math.max(t,Math.min(e,s)),z=s=>s.map(t=>({...t})),Dt="button, input, select, textarea, a, [contenteditable='true'], [role='button'], [role='menuitem'], [data-map-control]",k=s=>s.composedPath().some(t=>t instanceof Element&&t.matches(Dt)),xt=s=>s.composedPath().some(t=>t instanceof Element&&t.matches("select")),O=class{#n;#t;#s;#o=new Map;#m=!1;#a="idle";#r=[];#d=null;#c=[];#b=null;#w=0;#e=null;#R=0;#k=null;#v=null;#f=null;#h=0;#_=null;#l=!1;#g=null;#P=!1;constructor(t,e,i){this.#n=t,this.#t=e,this.#s=i,t.addEventListener("pointerdown",this.#i),t.addEventListener("pointermove",this.#y),t.addEventListener("pointerup",this.#u),t.addEventListener("pointercancel",this.#u),t.addEventListener("wheel",this.#A,{passive:!1}),t.addEventListener("gesturestart",this.#C,{passive:!1}),t.addEventListener("gesturechange",this.#x,{passive:!1}),t.addEventListener("gestureend",this.#H,{passive:!1}),t.addEventListener("dblclick",this.#E),t.addEventListener("contextmenu",this.#M),t.addEventListener("keydown",this.#F),t.addEventListener("keyup",this.#z),t.addEventListener("blur",this.#L)}#i=t=>{if(this.#P||!t.isPrimary&&t.pointerType==="mouse"||k(t))return;this.#n.focus({preventScroll:!0}),this.#S(),t.pointerType==="touch"&&!t.isPrimary&&this.#o.size===0&&this.#s.state().draw.tool==="outline"&&(this.#l=!0);let e=performance.now(),i={id:t.pointerId,type:t.pointerType,startX:t.clientX,startY:t.clientY,x:t.clientX,y:t.clientY,lastX:t.clientX,lastY:t.clientY,lastTime:e,velocityX:0,velocityY:0};if(this.#o.set(t.pointerId,i),this.#n.setPointerCapture?.(t.pointerId),this.#o.size>=2){this.#D(),(this.#a==="paint"||this.#a==="erase")&&(this.#c=z(this.#r),this.#s.onCircles(this.#c,!1,this.#r,this.#d)),this.#a="pinch",this.#n.classList.add("navigating"),this.#l=!0;let[r,l]=[...this.#o.values()];r&&l&&(this.#w=Math.max(1,yt(r,l)),this.#e=wt(r,l),this.#R=gt(r,l),this.#k=this.#t.camera),t.preventDefault();return}let n=this.#s.state(),o=n.workflow==="draw"&&n.map.available&&!n.floor.readOnly;this.#l||this.#m||t.button===1||t.button===2||n.draw.tool==="pan"?(this.#a="pan",this.#v=this.#t.camera):o&&n.draw.tool==="outline"&&C(n)?this.#a="outline":o&&(n.draw.tool==="paint"||n.draw.tool==="erase")?(this.#r=z(n.draw.circles),this.#d=n.draw.outline??null,this.#c=z(n.draw.circles),t.pointerType==="touch"?(this.#a="idle",this.#g=window.setTimeout(()=>{if(this.#g=null,this.#o.size!==1||this.#l)return;this.#a=n.draw.tool;let r=this.#o.get(t.pointerId);r&&this.#p(r.x,r.y)},110)):(this.#a=n.draw.tool,this.#p(t.clientX,t.clientY))):(this.#a=n.view==="three"&&!t.shiftKey?"orbit":"pan",this.#v=this.#t.camera),(this.#a==="pan"||this.#a==="orbit")&&this.#n.classList.add("navigating"),t.preventDefault()};#y=t=>{let e=this.#o.get(t.pointerId);if(!e){let h=this.#t.screenToMap(t.clientX,t.clientY);this.#t.setCursor(h);return}let n=(t.getCoalescedEvents?.()||[]).at(-1)||t,o=performance.now(),a=Math.max(1,o-e.lastTime),r=(n.clientX-e.lastX)/a,l=(n.clientY-e.lastY)/a;if(e.velocityX=e.velocityX*.62+r*.38,e.velocityY=e.velocityY*.62+l*.38,e.lastX=n.clientX,e.lastY=n.clientY,e.lastTime=o,e.x=n.clientX,e.y=n.clientY,this.#a==="pinch"&&this.#o.size>=2){let[h,d]=[...this.#o.values()];if(!h||!d)return;let u=Math.max(1,yt(h,d)),p=wt(h,d),m=gt(h,d),f=this.#k;if(f&&this.#e){let x={...f,distance:f.distance*this.#w/u,yaw:f.yaw+Lt(m-this.#R),pitch:f.orthographic?f.pitch:f.pitch-(p.y-this.#e.y)*.0035};this.#t.setCamera(this.#t.cameraAfterPan(x,p.x-this.#e.x,p.y-this.#e.y))}t.preventDefault();return}this.#a==="paint"||this.#a==="erase"?this.#p(t.clientX,t.clientY):this.#a==="pan"?this.#v&&this.#t.setCamera(this.#t.cameraAfterPan(this.#v,n.clientX-e.startX,n.clientY-e.startY)):this.#a==="orbit"&&this.#v&&this.#t.setCamera({...this.#v,yaw:this.#v.yaw+(n.clientX-e.startX)*.0045,pitch:this.#v.pitch-(n.clientY-e.startY)*.004});let c=this.#t.screenToMap(n.clientX,n.clientY);this.#t.setCursor(c),t.preventDefault()};#u=t=>{let e=this.#o.get(t.pointerId);if(!e)return;let i=this.#a;if(this.#o.delete(t.pointerId),this.#n.releasePointerCapture?.(t.pointerId),this.#D(),this.#a==="outline"&&t.type!=="pointercancel"&&Math.hypot(e.x-e.startX,e.y-e.startY)<7){let n=this.#t.screenToMap(e.x,e.y);n&&this.#s.onOutlinePoint?.(n)}if((this.#a==="paint"||this.#a==="erase")&&JSON.stringify(this.#c)!==JSON.stringify(this.#r))this.#s.onCircles(this.#c,!0,this.#r,this.#d);else if(t.type!=="pointercancel"&&this.#a!=="pinch"&&!this.#l&&Math.hypot(e.x-e.startX,e.y-e.startY)<7&&["rooms","plan"].includes(this.#s.state().workflow)&&C(this.#s.state())){let n=this.#t.roomAt(e.x,e.y);n&&this.#s.onRoom(n)}if(this.#o.size===0)this.#a="idle",this.#n.classList.remove("navigating"),this.#l=!1,this.#e=null,this.#k=null,this.#v=null,this.#b=null,(i==="pan"||i==="orbit")&&e.type!=="mouse"&&this.#q(e.velocityX,e.velocityY,i);else if(this.#a==="pinch"){this.#a="pan",this.#l=!0;let n=this.#o.values().next().value;n&&(n.startX=n.x,n.startY=n.y,n.velocityX=0,n.velocityY=0),this.#v=this.#t.camera,this.#k=null}t.preventDefault()};#p(t,e,i=!0){let n=this.#t.screenToMap(t,e);if(!n)return;let o=this.#s.state(),a=o.draw.brushMeters/2;if(this.#a==="erase")this.#c=this.#c.filter(r=>Math.hypot(r.x-n.x,r.y-n.y)>r.radius+a);else{if(!this.#t.containsMapPoint(n))return;let r=Math.max(.04,a*.55),l=this.#b||n,c=Math.hypot(n.x-l.x,n.y-l.y),h=Math.max(1,Math.ceil(c/r));for(let d=0;d<=h&&this.#c.length<512;d+=1){let u=d/h,p={x:l.x+(n.x-l.x)*u,y:l.y+(n.y-l.y)*u};this.#c.some(m=>Math.hypot(m.x-p.x,m.y-p.y)<Math.max(.025,a*.28))||this.#c.push({x:Math.round(p.x*1e4)/1e4,y:Math.round(p.y*1e4)/1e4,radius:Math.round(a*100)/100})}}this.#b=n,i&&JSON.stringify(this.#c)!==JSON.stringify(o.draw.circles)&&this.#s.onCircles(this.#c,!1)}#A=t=>{if(k(t))return;t.preventDefault(),this.#n.focus({preventScroll:!0}),this.#S();let e=t.deltaMode===WheelEvent.DOM_DELTA_LINE?16:t.deltaMode===WheelEvent.DOM_DELTA_PAGE?Math.max(1,this.#n.clientHeight):1,i=t.deltaX*e,n=t.deltaY*e;if(t.ctrlKey||t.metaKey){this.#t.zoomAt(Math.exp(_(-n*.008,-.28,.28)),t.clientX,t.clientY);return}if(t.altKey&&this.#s.state().view==="three"){this.#t.orbitBy(0,_(n,-80,80)*.75);return}if(t.deltaMode!==WheelEvent.DOM_DELTA_PIXEL||Math.abs(i)<.5&&Math.abs(n)>=50){this.#t.zoomAt(Math.exp(_(-n*.0025,-.28,.28)),t.clientX,t.clientY);return}this.#t.panBy(-_(i,-80,80),-_(n,-80,80))};#C=t=>{this.#P||k(t)||(this.#n.focus({preventScroll:!0}),this.#S(),this.#n.classList.add("navigating"),this.#f=this.#t.camera,this.#h=Number.isFinite(t.rotation)?t.rotation:0,t.preventDefault())};#x=t=>{if(this.#P||k(t))return;let e=this.#f;if(!e||this.#o.size>=2)return;let i=Number.isFinite(t.scale)&&t.scale>0?Math.max(.1,t.scale):1,n=Number.isFinite(t.rotation)?t.rotation:0;this.#t.setCamera({...e,distance:e.distance/i,yaw:e.yaw+(n-this.#h)*Math.PI/180}),t.preventDefault()};#H=t=>{let e=this.#f!==null;this.#f=null,this.#h=0,this.#n.classList.remove("navigating"),e&&!k(t)&&t.preventDefault()};#T(t){let e=this.#s.state();if(t.repeat||this.#P||this.#o.size||t.composedPath()[0]!==this.#n||!this.#n.matches(":focus")||e.workflow!=="draw"||!C(e)||e.command!=="idle"&&e.command!=="failed"||e.draw.tool!=="paint"&&e.draw.tool!=="erase"&&e.draw.tool!=="outline")return;let n=this.#n.querySelector(".scene-canvas")?.getBoundingClientRect();if(!(!n?.width||!n.height)){if(t.preventDefault(),this.#S(),e.draw.tool==="outline"){let o=this.#t.screenToMap(n.left+n.width/2,n.top+n.height/2);o&&this.#s.onOutlinePoint?.(o);return}this.#r=z(e.draw.circles),this.#d=e.draw.outline??null,this.#c=z(e.draw.circles),this.#b=null,this.#a=e.draw.tool,this.#p(n.left+n.width/2,n.top+n.height/2,!1),this.#a="idle",this.#b=null,JSON.stringify(this.#c)!==JSON.stringify(this.#r)&&this.#s.onCircles(this.#c,!0,this.#r,this.#d)}}#F=t=>{if(k(t)||t.defaultPrevented||t.ctrlKey||t.metaKey||t.altKey)return;if(t.key==="Enter"){this.#T(t);return}if(t.code==="Space"){this.#m=!0,t.preventDefault();return}this.#S();let e=this.#s.state(),i=t.key.toLocaleLowerCase();if(t.key==="+"||t.key==="=")this.#t.zoomAt(1.25);else if(t.key==="-")this.#t.zoomAt(.8);else if(t.key==="0")this.#t.fit();else if(i==="3")this.#$({type:"set-view",view:"three"});else if(i==="t")this.#$({type:"set-view",view:"top"});else if(t.key==="[")this.#t.orbitBy(-40,0);else if(t.key==="]")this.#t.orbitBy(40,0);else if(t.key==="PageUp")this.#t.orbitBy(0,-30);else if(t.key==="PageDown")this.#t.orbitBy(0,30);else if(i==="d"&&e.workflow==="draw")this.#$({type:"set-draw-tool",tool:"paint"});else if(i==="e"&&e.workflow==="draw")this.#$({type:"set-draw-tool",tool:"erase"});else if(["arrowleft","arrowright","arrowup","arrowdown"].includes(i))if(e.view==="three"&&!t.shiftKey){let n=i==="arrowleft"?-24:i==="arrowright"?24:0,o=i==="arrowup"?-20:i==="arrowdown"?20:0;this.#t.orbitBy(n,o)}else{let n=i==="arrowleft"?30:i==="arrowright"?-30:0,o=i==="arrowup"?30:i==="arrowdown"?-30:0;this.#t.panBy(n,o)}else if(e.workflow!=="draw"&&["w","a","s","d"].includes(i))this.#t.panBy(i==="a"?34:i==="d"?-34:0,i==="w"?34:i==="s"?-34:0);else if(e.workflow!=="draw"&&(i==="q"||i==="e"))this.#t.orbitBy(i==="q"?-30:30,0);else return;t.preventDefault()};#z=t=>{t.code==="Space"&&(this.#m=!1)};#L=()=>{this.#m=!1,this.#D(),this.#t.setCursor(null),this.#n.classList.remove("navigating")};#E=t=>{k(t)||(this.#S(),this.#t.zoomAt(t.shiftKey?1/1.6:1.6,t.clientX,t.clientY),t.preventDefault())};#M=t=>{k(t)||t.preventDefault()};#$(t){this.#n.dispatchEvent(new CustomEvent("matic-workspace-intent",{detail:t,bubbles:!0,composed:!0}))}#q(t,e,i){if(window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;let n=_(t,-.55,.55),o=_(e,-.55,.55);if(Math.hypot(n,o)<.02)return;let a=performance.now(),r=l=>{let c=Math.min(32,l-a);a=l,i==="orbit"?this.#t.orbitBy(n*c,o*c):this.#t.panBy(n*c,o*c);let h=.9**(c/16);n*=h,o*=h,Math.hypot(n,o)>=.01?this.#_=window.requestAnimationFrame(r):this.#_=null};this.#_=window.requestAnimationFrame(r)}#S(){this.#_!==null&&window.cancelAnimationFrame(this.#_),this.#_=null}#D(){this.#g!==null&&window.clearTimeout(this.#g),this.#g=null}dispose(){this.#P||(this.#P=!0,this.#D(),this.#S(),this.#n.removeEventListener("pointerdown",this.#i),this.#n.removeEventListener("pointermove",this.#y),this.#n.removeEventListener("pointerup",this.#u),this.#n.removeEventListener("pointercancel",this.#u),this.#n.removeEventListener("wheel",this.#A),this.#n.removeEventListener("gesturestart",this.#C),this.#n.removeEventListener("gesturechange",this.#x),this.#n.removeEventListener("gestureend",this.#H),this.#n.removeEventListener("dblclick",this.#E),this.#n.removeEventListener("contextmenu",this.#M),this.#n.removeEventListener("keydown",this.#F),this.#n.removeEventListener("keyup",this.#z),this.#n.removeEventListener("blur",this.#L),this.#o.clear())}};var w=(s,t,e)=>Math.max(t,Math.min(e,s)),T=s=>{let t=s;for(;t>Math.PI;)t-=Math.PI*2;for(;t<-Math.PI;)t+=Math.PI*2;return t},It=s=>{switch(s){case"efficient":return .35;case"balanced":return .65;case"maximum":case"auto":return 1}},Mt=s=>{let t=s.metadata.metersPerCell;return[(s.metadata.origin[0]+(s.metadata.span[0]-1)/2)*t,(s.metadata.origin[1]+(s.metadata.span[1]-1)/2)*t]},_t=(s,t,e,i)=>{let n=Mt(e),o=Mt(i);return[s+(o[0]-n[0]),t+(n[1]-o[1])]},Ft=(s,t,e)=>{let[i,n]=_t(s.targetX,s.targetZ,t,e);return{...s,targetX:i,targetZ:n}},Ct=(s,t)=>{if(!t)return!0;let e=s==="top";return Math.abs(t.zoom-1)<.001&&Math.abs(t.targetX)<.001&&Math.abs(t.targetZ)<.001&&Math.abs(T(t.yaw-(e?0:-Math.PI/4)))<.001&&(e||Math.abs(t.pitch-.82)<.001)},Ot=(s,t,e,i,n)=>Object.fromEntries(Object.entries(s).map(([o,a])=>{if(!a||Ct(o,a))return[o,a];let[r,l]=_t(a.targetX,a.targetZ,t,e),c=i[o],h=n[o],d=c>0&&h>0?a.zoom*h/c:a.zoom;return[o,{...a,targetX:r,targetZ:l,zoom:d}]})),Pt=s=>{let t=s.resources.entry;return[s.dataMode,s.selection.floorId,t?.entryId??"none",t?.selectedFloorOrdinal??"none",t?.mapFloorOrdinal??"none",t?.mapSessionKey??"none"].join("|")},Xt={accent:[6,120,206],onAccent:[255,255,255],text:[38,50,56],quiet:[75,92,105],plate:[250,252,253],roomFill:[231,238,242],forced:!1},Et=Math.PI/3.15,Ht=1.08,qt=(s,t)=>{let e=Et/2,i=Math.atan(Math.tan(e)*Math.max(.2,t));return s/Math.sin(Math.min(e,i))*Ht},Nt=(s,t)=>{let e=new Float32Array(16);for(let i=0;i<4;i+=1)for(let n=0;n<4;n+=1){let o=0;for(let a=0;a<4;a+=1)o+=(s[a*4+n]??0)*(t[i*4+a]??0);e[i*4+n]=o}return e},Wt=(s,t,e,i)=>{let n=1/Math.tan(s/2),o=new Float32Array(16);return o[0]=n/t,o[5]=n,o[10]=(i+e)/(e-i),o[11]=-1,o[14]=2*i*e/(e-i),o},Vt=(s,t,e,i,n,o)=>{let a=new Float32Array(16);return a[0]=2/(t-s),a[5]=2/(i-e),a[10]=-2/(o-n),a[12]=-(t+s)/(t-s),a[13]=-(i+e)/(i-e),a[14]=-(o+n)/(o-n),a[15]=1,a},Bt=(s,t)=>{let e=Math.hypot((s[0]??0)-(t[0]??0),(s[1]??0)-(t[1]??0),(s[2]??0)-(t[2]??0))||1,i=[((s[0]??0)-(t[0]??0))/e,((s[1]??0)-(t[1]??0))/e,((s[2]??0)-(t[2]??0))/e],n=Math.hypot(i[2]??0,i[0]??0)||1,o=[(i[2]??0)/n,0,-(i[0]??0)/n],a=[(i[1]??0)*(o[2]??0),(i[2]??0)*(o[0]??0)-(i[0]??0)*(o[2]??0),-(i[1]??0)*(o[0]??0)];return new Float32Array([o[0]??0,a[0]??0,i[0]??0,0,o[1]??0,a[1]??0,i[1]??0,0,o[2]??0,a[2]??0,i[2]??0,0,-((o[0]??0)*(s[0]??0)+(o[1]??0)*(s[1]??0)+(o[2]??0)*(s[2]??0)),-((a[0]??0)*(s[0]??0)+(a[1]??0)*(s[1]??0)+(a[2]??0)*(s[2]??0)),-((i[0]??0)*(s[0]??0)+(i[1]??0)*(s[1]??0)+(i[2]??0)*(s[2]??0)),1])},kt=(s,t,e)=>{let i=!1,n=e.at(-1);if(!n)return!1;for(let o of e){let[a,r]=o,[l,c]=n;r>t!=c>t&&s<(l-a)*(t-r)/(c-r)+a&&(i=!i),n=o}return i},X=class{#n;#t;#s;#o=null;#m=null;#a=null;#r=null;#d=null;#c=null;#b=null;#w=null;#e=null;#R=null;#k=null;#v=null;#f=null;#h=null;#_=null;#l=null;#g=null;#P;#i={yaw:-Math.PI/4,pitch:.82,distance:12,targetX:0,targetZ:0,orthographic:!1};#y=12;#u=8;#p=4;#A=new Float32Array(16);#C=null;#x="unavailable";#H=0;#T=0;#F=0;#z=0;#L=1;#E={width:1,height:1,left:0,top:0};#M=!0;#$=!1;#q=Xt;constructor(t,e,i={}){this.#n=t,this.#t=e,this.#s=i,this.#m=e.getContext("2d",{alpha:!0}),this.#n.addEventListener("webglcontextlost",this.#Q),this.#n.addEventListener("webglcontextrestored",this.#tt),this.#K(),this.#P=new ResizeObserver(()=>{let n=this.#y,o=this.#u;this.#G(),this.#M&&(n!==this.#y||o!==this.#u)?this.fit(!1):this.requestRender()}),this.#P.observe(t)}get camera(){return{...this.#i}}#S(){return{minimum:Math.max(.2,this.#p*.04),maximum:this.#p*8}}#D(){let t=this.#h?.metadata.span,e=this.#h?.metadata.metersPerCell;return!t||e===void 0?{x:this.#p,z:this.#p}:{x:Math.max(.5,t[0]*e*.55),z:Math.max(.5,t[1]*e*.55)}}setCamera(t,e=!0){let i=this.#S(),n=this.#D();this.#i={yaw:T(t.yaw),pitch:t.orthographic?Math.PI/2-.018:w(t.pitch,.18,1.38),distance:w(t.distance,i.minimum,i.maximum),targetX:w(t.targetX,-n.x,n.x),targetZ:w(t.targetZ,-n.z,n.z),orthographic:t.orthographic},this.#M=!1,this.requestRender(),e&&this.#X()}cameraAfterPan(t,e,i){let n=this.#O(),o=t.distance*1.75/Math.max(200,n.height),a=Math.cos(t.yaw),r=-Math.sin(t.yaw),l=-Math.sin(t.yaw),c=-Math.cos(t.yaw),h=this.#D();return{...t,targetX:w(t.targetX-e*o*a+i*o*l,-h.x,h.x),targetZ:w(t.targetZ-e*o*r+i*o*c,-h.z,h.z)}}setState(t){if(this.#$)return;let e=this.#f,i=this.#h;this.#f=t;let n=t.resources.scene.value,o=null;if(n!==this.#h){let l=this.#h!==null&&e!==null&&this.#_===Pt(t),c=l&&!this.#M;this.#h=n,this.#_=n?Pt(t):null,o=this.#nt(n,c,i,l,e?e.workflow==="draw"?"top":e.view:null)}(!e||e.quality!==t.quality)&&(this.#L=It(t.quality),this.#z=0);let a=e?.workflow!=="draw"&&t.workflow==="draw",r=e?.workflow==="draw"&&t.workflow!=="draw";if(!e||e.view!==t.view||a||r){let l=t.workflow==="draw"?"top":t.view;this.#i=this.#et(l,t,o),this.#M=this.#it(l,t,o)}t.workflow==="draw"&&e?.draw.zoomPercent!==t.draw.zoomPercent&&Math.round(this.#u/this.#i.distance*100)!==t.draw.zoomPercent&&(this.#i={...this.#i,orthographic:!0,pitch:Math.PI/2-.018,distance:this.#u*100/t.draw.zoomPercent},this.#M=t.draw.zoomPercent===100&&Math.abs(this.#i.targetX)<.001&&Math.abs(this.#i.targetZ)<.001&&Math.abs(T(this.#i.yaw))<.001),(o||a)&&this.#X(),this.requestRender()}#et(t,e,i=null){let n=t==="top",o=n?this.#u:this.#y,a=i?.[t]??e.cameras[t];return a?{yaw:a.yaw,pitch:n?Math.PI/2-.018:a.pitch,distance:w(o/w(a.zoom,.01,100),Math.max(.2,this.#p*.04),this.#p*8),targetX:w(a.targetX,-this.#p,this.#p),targetZ:w(a.targetZ,-this.#p,this.#p),orthographic:n}:n?{yaw:0,pitch:Math.PI/2-.018,distance:o,targetX:0,targetZ:0,orthographic:!0}:{yaw:-Math.PI/4,pitch:.82,distance:o,targetX:0,targetZ:0,orthographic:!1}}#it(t,e,i=null){let n=i?.[t]??e.cameras[t];return Ct(t,n)}#U(t,e){let i=this.#o;if(!i)throw new Error("webgl-unavailable");let n=i.createShader(t);if(!n)throw new Error("shader-unavailable");if(i.shaderSource(n,e),i.compileShader(n),!i.getShaderParameter(n,i.COMPILE_STATUS))throw i.deleteShader(n),new Error("shader-failed");return n}#K(){try{this.#o=this.#n.getContext("webgl2",{alpha:!0,antialias:!0,depth:!0,powerPreference:"high-performance"});let t=this.#o;if(!t)throw new Error("webgl2-unavailable");let e=this.#U(t.VERTEX_SHADER,`#version 300 es
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
      `),i=this.#U(t.FRAGMENT_SHADER,`#version 300 es
        precision highp float;
        in vec3 vColor;
        out vec4 outColor;
        void main() {
          vec2 point = gl_PointCoord * 2.0 - 1.0;
          if (dot(point, point) > 1.0) discard;
          float edge = smoothstep(1.0, 0.72, dot(point, point));
          outColor = vec4(pow(vColor, vec3(0.94)), edge);
        }
      `),n=t.createProgram();if(!n)throw new Error("program-unavailable");if(t.attachShader(n,e),t.attachShader(n,i),t.linkProgram(n),t.deleteShader(e),t.deleteShader(i),!t.getProgramParameter(n,t.LINK_STATUS))throw new Error("program-failed");this.#d=n,this.#w=t.getUniformLocation(n,"uViewProjection"),this.#e=t.getUniformLocation(n,"uCenter"),this.#R=t.getUniformLocation(n,"uMetersPerCell"),this.#k=t.getUniformLocation(n,"uPointPixels"),this.#v=t.getUniformLocation(n,"uMaxPointPixels"),this.#c=t.createBuffer(),this.#b=t.createVertexArray(),t.bindVertexArray(this.#b),t.bindBuffer(t.ARRAY_BUFFER,this.#c),t.enableVertexAttribArray(0),t.vertexAttribIPointer(0,2,t.UNSIGNED_SHORT,8,0),t.enableVertexAttribArray(1),t.vertexAttribIPointer(1,1,t.UNSIGNED_BYTE,8,4),t.enableVertexAttribArray(2),t.vertexAttribPointer(2,3,t.UNSIGNED_BYTE,!0,8,5),t.bindVertexArray(null),t.enable(t.DEPTH_TEST),t.depthFunc(t.LEQUAL),t.enable(t.BLEND),t.blendFunc(t.SRC_ALPHA,t.ONE_MINUS_SRC_ALPHA),this.#x="webgl2",this.#H+=1,this.#h&&this.#W(this.#h)}catch{this.#N(),this.#Z()}}#nt(t,e=!1,i=null,n=!1,o=null){if(this.#j(),!t)return this.#T=0,this.requestRender(),null;let[a,r]=t.metadata.span,l=t.metadata.metersPerCell,c=a*l,h=r*l;this.#p=Math.max(1,Math.hypot(c,h)/2);let d={three:this.#y,top:this.#u};this.#G(),e&&i?this.setCamera(Ft(this.#i,i,t),!1):this.fit(!1,o??void 0);let u=this.#f;if(n&&i&&u){let p={three:this.#y,top:this.#u},m=Ot(u.cameras,i,t,d,p),f=o??(u.workflow==="draw"?"top":u.view),x=f==="top"?this.#u:this.#y;return m[f]={yaw:this.#i.yaw,pitch:this.#i.pitch,zoom:x/Math.max(.2,this.#i.distance),targetX:this.#i.targetX,targetZ:this.#i.targetZ},this.#s.onCameraPreferences?.(m),this.#x==="webgl2"?this.#W(t):this.#V(t),m}return this.#x==="webgl2"?this.#W(t):this.#V(t),null}#G(){let t=this.#h;if(!t)return;let[e,i]=t.metadata.span,n=t.metadata.metersPerCell,o=e*n,a=i*n,r=this.#O(),l=Math.max(.2,r.width/Math.max(1,r.height));this.#y=qt(this.#p,l),this.#u=Math.max(a/2,o/(2*l))*1.12}#W(t){let e=this.#o;if(!e||!this.#c)return;let i=new Uint8Array(t.buffer,t.pointOffset,t.total*8);e.bindBuffer(e.ARRAY_BUFFER,this.#c),e.bufferData(e.ARRAY_BUFFER,i,e.STATIC_DRAW),this.#T=t.total}#Z(){this.#x="canvas2d",this.#r=document.createElement("canvas"),this.#r.width=1024,this.#r.height=1024,this.#a=this.#r.getContext("2d",{alpha:!0}),this.#a?this.#h&&this.#V(this.#h):(this.#x="unavailable",this.#s.onProblem?.("renderer-unavailable"))}#V(t){let e=this.#a;if(!e||!this.#r)return;e.clearRect(0,0,this.#r.width,this.#r.height);let i=new DataView(t.buffer,t.pointOffset,t.total*8),n=Math.min(t.total,5e4),o=Math.max(1,Math.ceil(t.total/n)),a=0,r=0,l=()=>{if(this.#$||t!==this.#h||!this.#r)return;let c=Math.min(t.total,a+o*4e3);for(;a<c;a+=o){let h=a*8,d=i.getUint16(h,!0)/Math.max(1,t.metadata.span[0])*this.#r.width,u=i.getUint16(h+2,!0)/Math.max(1,t.metadata.span[1])*this.#r.height,p=i.getUint8(h+5),m=i.getUint8(h+6),f=i.getUint8(h+7);e.fillStyle=`rgb(${p} ${m} ${f})`,e.fillRect(d,u,1.5,1.5),r+=1}this.#T=r,this.requestRender(),a<t.total?this.#g=window.setTimeout(l,0):this.#g=null};l()}#j(){this.#g!==null&&window.clearTimeout(this.#g),this.#g=null}#O(){let t=this.#n.getBoundingClientRect();return this.#E={width:t.width,height:t.height,left:t.left,top:t.top},this.#E}#ot(){let t=!1,e=this.#O(),i=Math.min(window.devicePixelRatio||1,3),n=Math.max(1,Math.round(e.width*i)),o=Math.max(1,Math.round(e.height*i));for(let a of[this.#n,this.#t])(a.width!==n||a.height!==o)&&(a.width=n,a.height=o,t=!0);t&&this.#s.onViewport?.()}#B(){let t=this.#E,e=Math.max(.2,t.width/Math.max(1,t.height)),i=Math.cos(this.#i.pitch)*this.#i.distance,n=[this.#i.targetX+Math.sin(this.#i.yaw)*i,Math.sin(this.#i.pitch)*this.#i.distance,this.#i.targetZ+Math.cos(this.#i.yaw)*i],o=[this.#i.targetX,0,this.#i.targetZ],a=Bt(n,o),r=this.#i.orthographic?Vt(-this.#i.distance*e,this.#i.distance*e,-this.#i.distance,this.#i.distance,-this.#p*4,this.#p*4):Wt(Et,e,.02,Math.max(60,this.#p*12));return Nt(r,a)}requestRender(){this.#l!==null||this.#$||(this.#l=window.requestAnimationFrame(()=>{this.#l=null,this.#at()}))}#at(){let t=performance.now();this.#ot(),this.#A=this.#B(),this.#x==="webgl2"?this.#st():this.#rt(),this.#ct(),this.#F=performance.now()-t,this.#F>18?(this.#z+=1,this.#z>=3&&this.#f?.quality==="auto"&&(this.#L=Math.max(.25,this.#L*.75))):this.#z=Math.max(0,this.#z-1)}#st(){let t=this.#o,e=this.#h;if(!t||(t.viewport(0,0,this.#n.width,this.#n.height),t.clearColor(0,0,0,0),t.clear(t.COLOR_BUFFER_BIT|t.DEPTH_BUFFER_BIT),!e||!this.#d||!this.#b))return;if(this.#f?.view==="top"&&this.#f.appearance==="rooms"){this.#T=0;return}t.useProgram(this.#d),t.bindVertexArray(this.#b),t.uniformMatrix4fv(this.#w,!1,this.#A),t.uniform2f(this.#e,(e.metadata.span[0]-1)/2,(e.metadata.span[1]-1)/2),t.uniform1f(this.#R,e.metadata.metersPerCell);let i=Math.min(window.devicePixelRatio||1,3),n=Math.max(1,Math.floor(e.total*this.#L)),o=Math.min(e.floorCount,n),a=Math.min(e.surfaceCount,Math.max(0,n-o));t.uniform1f(this.#k,this.#n.height*.038),t.uniform1f(this.#v,4.5*i),t.drawArrays(t.POINTS,0,o),t.uniform1f(this.#k,this.#n.height*.05),t.uniform1f(this.#v,7*i),t.drawArrays(t.POINTS,e.floorCount,a),t.bindVertexArray(null),this.#T=o+a}#rt(){}#lt(t,e,i=0){let n=this.#h;return n?[-(t-(n.metadata.span[0]-1)/2)*n.metadata.metersPerCell,i*n.metadata.metersPerCell,(e-(n.metadata.span[1]-1)/2)*n.metadata.metersPerCell]:null}#Y(t,e,i=0,n=!0,o=this.#A){let a=this.#lt(t,e,i);if(!a)return null;let[r,l,c]=a,h=(o[0]??0)*r+(o[4]??0)*l+(o[8]??0)*c+(o[12]??0),d=(o[1]??0)*r+(o[5]??0)*l+(o[9]??0)*c+(o[13]??0),u=(o[3]??0)*r+(o[7]??0)*l+(o[11]??0)*c+(o[15]??0);if(u<=.001)return null;let p=h/u,m=d/u;if(!Number.isFinite(p)||!Number.isFinite(m)||n&&(Math.abs(p)>1.15||Math.abs(m)>1.15))return null;let f=this.#E;return{x:(p*.5+.5)*f.width,y:(-m*.5+.5)*f.height}}#I(t,e,i=0,n=!0,o=this.#A){let a=this.#h;if(!a)return null;let r=t/a.metadata.metersPerCell-a.metadata.origin[0],l=e/a.metadata.metersPerCell-a.metadata.origin[1];return this.#Y(r,l,i,n,o)}#ct(){let t=this.#m,e=this.#h,i=this.#f;if(!t)return;let n=Math.min(window.devicePixelRatio||1,3),o=this.#E;if(t.setTransform(n,0,0,n,0,0),t.clearRect(0,0,o.width,o.height),!e||!i)return;let a=this.#q;if(this.#x==="canvas2d"&&this.#r&&!(i.view==="top"&&i.appearance==="rooms")){let d=this.#u/this.#i.distance,u=o.width*d,p=o.height*d,m=(o.width-u)/2-this.#i.targetX*32*d,f=(o.height-p)/2-this.#i.targetZ*32*d;t.drawImage(this.#r,m,f,u,p)}let r=this.#ht(i);if(i.labelsVisible||i.view==="top"&&i.appearance==="rooms"){t.lineWidth=1.5,t.font="600 12px system-ui, sans-serif",t.textAlign="center",t.textBaseline="middle";let d=[];for(let u of e.metadata.rooms){let p=r.has(u.name.toLocaleLowerCase());t.strokeStyle=p?y(a.accent,1):y(a.quiet,.7),t.fillStyle=p?y(a.accent,.26):i.view==="top"&&i.appearance==="rooms"?y(a.roomFill,.94):y(a.plate,.04),t.beginPath();let m=Math.max(1,Math.ceil(u.boundary.length/512)),f=!1;for(let P=0;P<u.boundary.length;P+=m){let H=u.boundary[P];if(!H)continue;let E=this.#Y(H[0],H[1],.2,!1);E&&(f?t.lineTo(E.x,E.y):t.moveTo(E.x,E.y),f=!0)}if(f&&(t.closePath(),t.fill(),t.stroke()),!i.labelsVisible)continue;let x=this.#Y(u.center[0],u.center[1],1);if(!x)continue;let R=t.measureText(u.name).width,M=new DOMRect(x.x-R/2-6,x.y-10,R+12,20);d.some(P=>M.left<P.right+8&&M.right+8>P.left&&M.top<P.bottom+4&&M.bottom+4>P.top)||(d.push(M),t.fillStyle=y(a.plate,.88),t.fillRect(M.x,M.y,M.width,M.height),t.fillStyle=y(a.text,1),t.fillText(u.name,x.x,x.y))}}let l=i.draw.circles;if((i.workflow==="draw"||i.workflow==="areaReview")&&l.length)if(t.fillStyle=y(a.accent,.22),t.strokeStyle=y(a.accent,.92),t.lineWidth=1.5,i.draw.outline?.closed){t.beginPath();for(let d of l)this.#J(t,d,!1);t.fill()}else for(let d of l)this.#J(t,d);let c=i.draw.outline;if(c&&(i.workflow==="draw"||i.workflow==="areaReview")&&!(i.workflow==="draw"&&i.draw.tool==="outline")&&(t.beginPath(),c.points.forEach((d,u)=>{let p=this.#I(d.x,d.y,0,!1);p&&(u===0?t.moveTo(p.x,p.y):t.lineTo(p.x,p.y))}),c.closed&&t.closePath(),t.strokeStyle=y(a.accent,1),t.lineWidth=2,t.stroke()),this.#C&&i.workflow==="draw"&&(i.draw.tool==="paint"||i.draw.tool==="erase")){let d=this.#I(this.#C.x,this.#C.y),u=this.#I(this.#C.x+i.draw.brushMeters/2,this.#C.y);d&&u&&(t.beginPath(),t.arc(d.x,d.y,Math.max(2,Math.hypot(u.x-d.x,u.y-d.y)),0,Math.PI*2),t.strokeStyle=y(a.accent,1),t.lineWidth=2,t.stroke())}let h=i.resources.pose.value;if(L(i)&&h?.position){let d=this.#I(h.position[0],h.position[1],3);d&&(t.beginPath(),t.arc(d.x,d.y,7,0,Math.PI*2),t.fillStyle=y(a.accent,1),t.fill(),t.strokeStyle=y(a.onAccent,1),t.lineWidth=3,t.stroke())}}#ht(t){let e=t.resources.plans.value?.rooms||t.resources.areas.value?.rooms||[];return new Set(e.filter(i=>(t.workflow==="plan"?t.planDraft.rooms.map(n=>n.roomId):t.selection.roomIds).includes(i.roomId)).map(i=>i.name.toLocaleLowerCase()))}#J(t,e,i=!0){let n=this.#I(e.x,e.y),o=this.#I(e.x+e.radius,e.y);if(!n||!o)return;let a=Math.max(1,Math.hypot(o.x-n.x,o.y-n.y));i&&t.beginPath(),t.moveTo(n.x+a,n.y),t.arc(n.x,n.y,a,0,Math.PI*2),i&&(t.fill(),t.stroke())}setPalette(t){this.#q=t,this.requestRender()}setCursor(t){this.#C=t,this.requestRender()}mapToScreen(t){if(!this.#h)return null;let e=this.#O();return!e.width||!e.height?null:this.#I(t.x,t.y,0,!1,this.#B())}offsetMapPoint(t,e,i){let n=this.mapToScreen(t);if(!n)return null;let o=this.#E,a=this.#i.distance*2/o.height;return this.screenToMap(o.left+n.x+e/a,o.top+n.y+i/a)}screenToMap(t,e){let i=this.#h;if(!i)return null;let n=this.#O();if(!n.width||!n.height)return null;let o=this.#B(),a=(t-n.left)/n.width*2-1,r=1-(e-n.top)/n.height*2,l=o[0]-a*o[3],c=o[8]-a*o[11],h=o[1]-r*o[3],d=o[9]-r*o[11],u=l*d-c*h;if(!Number.isFinite(u)||Math.abs(u)<1e-12)return null;let p=a*o[15]-o[12],m=r*o[15]-o[13],f=(p*d-c*m)/u,x=(l*m-p*h)/u;if(o[3]*f+o[11]*x+o[15]<=0)return null;let R=-f/i.metadata.metersPerCell+(i.metadata.span[0]-1)/2,M=x/i.metadata.metersPerCell+(i.metadata.span[1]-1)/2;return{x:(R+i.metadata.origin[0])*i.metadata.metersPerCell,y:(M+i.metadata.origin[1])*i.metadata.metersPerCell}}roomAt(t,e){let i=this.screenToMap(t,e),n=this.#h,o=this.#f;if(!i||!n||!o)return null;let a=i.x/n.metadata.metersPerCell-n.metadata.origin[0],r=i.y/n.metadata.metersPerCell-n.metadata.origin[1],l=n.metadata.rooms.find(c=>kt(a,r,c.boundary));return l?this.#dt(l,o):null}containsMapPoint(t){let e=this.#h;if(!e)return!1;let i=t.x/e.metadata.metersPerCell-e.metadata.origin[0],n=t.y/e.metadata.metersPerCell-e.metadata.origin[1];return e.metadata.rooms.some(o=>kt(i,n,o.boundary))}#dt(t,e){return(e.resources.plans.value?.rooms||e.resources.areas.value?.rooms||[]).find(n=>n.name.localeCompare(t.name,void 0,{sensitivity:"base"})===0)?.roomId||t.id}selectRoomAt(t,e){let i=this.roomAt(t,e);i&&this.#s.onRoom?.(i)}fit(t=!0,e=this.#f?.workflow==="draw"?"top":this.#f?.view??"three"){let i=e==="top";this.#i=i?{yaw:0,pitch:Math.PI/2-.018,distance:this.#u,targetX:0,targetZ:0,orthographic:!0}:{yaw:-Math.PI/4,pitch:.82,distance:this.#y,targetX:0,targetZ:0,orthographic:!1},this.#M=!0,this.requestRender(),t&&this.#X()}zoomAt(t,e,i){let n=e===void 0||i===void 0?null:this.screenToMap(e,i),o=this.#S();if(this.#i={...this.#i,distance:w(this.#i.distance/t,o.minimum,o.maximum)},this.#M=!1,n&&e!==void 0&&i!==void 0){let a=this.screenToMap(e,i);a&&(this.#i={...this.#i,targetX:this.#i.targetX-(n.x-a.x),targetZ:this.#i.targetZ+(n.y-a.y)})}this.requestRender(),this.#X(e,i)}panBy(t,e){this.setCamera(this.cameraAfterPan(this.#i,t,e))}orbitBy(t,e){if(this.#i.orthographic){this.panBy(t,e);return}this.#i={...this.#i,yaw:T(this.#i.yaw+t*.006),pitch:w(this.#i.pitch-e*.004,.18,1.38)},this.#M=!1,this.requestRender(),this.#X()}rotateBy(t){this.#i={...this.#i,yaw:T(this.#i.yaw+t)},this.#M=!1,this.requestRender(),this.#X()}#X(t,e){let i=this.#i.orthographic?this.#u:this.#y,n=t===void 0||e===void 0?this.#E:this.#O(),o=t===void 0||e===void 0||!n.width||!n.height?void 0:{xPercent:w((t-n.left)/n.width*100,0,100),yPercent:w((e-n.top)/n.height*100,0,100)};this.#s.onCamera?.(this.camera,Math.round(i/this.#i.distance*100),o)}diagnostics(){return{mode:this.#x,contextGeneration:this.#H,sceneRevision:this.#h?.revision??null,sourcePoints:this.#h?.total??0,renderedPoints:this.#T,lastFrameMs:Math.round(this.#F*100)/100,slowFrames:this.#z,cameraDistance:this.#i.distance,fitDistance:this.#i.orthographic?this.#u:this.#y,fitActive:this.#M}}#Q=t=>{t.preventDefault(),this.#N(),this.#Z(),this.requestRender()};#tt=()=>{this.#N(),this.#K(),this.requestRender()};#N(){let t=this.#o;t&&(this.#c&&t.deleteBuffer(this.#c),this.#b&&t.deleteVertexArray(this.#b),this.#d&&t.deleteProgram(this.#d)),this.#c=null,this.#b=null,this.#d=null,this.#o=null}dispose(){this.#$||(this.#$=!0,this.#P.disconnect(),this.#n.removeEventListener("webglcontextlost",this.#Q),this.#n.removeEventListener("webglcontextrestored",this.#tt),this.#l!==null&&window.cancelAnimationFrame(this.#l),this.#l=null,this.#j(),this.#N(),this.#r=null,this.#a=null,this.#m=null,this.#h=null,this.#f=null)}};var Yt="matic-workspace-intent",Ut="matic-workspace-action",$t="navigation-help",St=(s,t)=>{let e=(n,o,a)=>N(t,n,o,a);if(s.dataMode==="history"||s.floor.readOnly)return s.map.available?e("v4_saved_map_description","Saved read-only map for {floor}. Live robot position is hidden.",{floor:s.floor.displayName}):s.resources.scene.status==="loading"?e("v4_saved_map_loading_description","The saved map is loading."):e("v4_saved_map_unavailable_description","This saved map is unavailable.");if(!q(s))return e("v4_private_map_unavailable","The current private map is not available.");let i=L(s)?e("v4_robot_position_verified","The robot position is verified."):e("v4_robot_position_hidden","The robot position is not shown.");return e("v4_live_map_description","Live map for {floor}. {pose}",{floor:s.floor.displayName,pose:i})},V=class extends K{constructor(){super();this.state=B();this.narrow=!1;this.#n=null;this.#t=null;this.#s=null;this.#o=!1;this.#m=!1;this.#a=null;this.#r=[];this.#d=null;this.#c=null;this.#b={capture:!0,handleEvent:e=>{e.pointerType==="touch"&&!e.isPrimary&&this.#w.cancel()}};this.#w=new F(()=>this.state,()=>this.#t,e=>this.#l(e),()=>this.requestUpdate(),(e,i)=>this.#e(e,i),e=>{this.updateComplete.then(()=>{(this.renderRoot.querySelector(`[data-zone-index="${e}"]`)??this.renderRoot.querySelector(".map-root"))?.focus({preventScroll:!0})})});this.#f=()=>{this.#k()};new A(this,{container:()=>this.renderRoot?.querySelector(".camera-steps")??null,items:"button"}),new A(this,{container:()=>this.renderRoot?.querySelector(".draw-tools")??null,items:"button"})}static{this.properties={state:{attribute:!1},localize:{attribute:!1},narrow:{type:Boolean,reflect:!0}}}static{this.styles=[G,Z,j,U`
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
  `]}#n;#t;#s;#o;#m;#a;#r;#d;#c;#b;#w;#e(e,i,n){return N(this.localize,e,i,n)}connectedCallback(){super.connectedCallback(),this.#h()}firstUpdated(){let e=this.renderRoot.querySelector(".map-root"),i=this.renderRoot.querySelector(".scene-canvas"),n=this.renderRoot.querySelector(".overlay-canvas");!e||!i||!n||(this.#t=new X(i,n,{onViewport:()=>{this.#w.cancel(),this.requestUpdate()},onCamera:(o,a,r)=>{this.#l({type:"set-camera",view:this.state.workflow==="draw"?"top":this.state.view,camera:{yaw:o.yaw,pitch:o.pitch,zoom:a/100,targetX:o.targetX,targetZ:o.targetZ}}),this.state.workflow==="draw"&&a!==this.state.draw.zoomPercent&&this.#l({type:"set-zoom",value:a,...r?{originX:r.xPercent,originY:r.yPercent}:{}})},onCameraPreferences:o=>{for(let a of["top","three"]){let r=o[a];r&&this.#l({type:"set-camera",view:a,camera:r})}},onRoom:o=>this.#l({type:"toggle-room",roomId:o}),onProblem:()=>this.#g("renderer-problem")}),this.#s=new O(e,this.#t,{state:()=>this.state,onOutlinePoint:o=>this.#w.addPoint(o),onCircles:(o,a,r,l)=>this.#l({type:"set-draft-circles",circles:o,record:a,...r?{previous:r,previousOutline:l??null}:{},...!a&&r?{outline:l??null}:{}}),onRoom:o=>this.#l({type:"toggle-room",roomId:o})}),this.#t.setState(this.state),this.#k())}disconnectedCallback(){this.#_(),this.#w.cancel(),this.#s?.dispose(),this.#s=null,this.#t?.dispose(),this.#t=null,super.disconnectedCallback()}updated(e){this.#m&&(this.#m=!1,this.renderRoot.querySelector(".navigation-help button")?.focus()),e.has("state")&&(this.#t?.setState(this.state),this.state.draw.tool==="outline"&&this.requestUpdate())}#R(){let e=this.renderRoot?.querySelector(".map-root");!e||!this.#t||this.#t.setPalette(vt(e))}#k(){this.#v(),this.#d=window.requestAnimationFrame(()=>{this.#d=null,this.#c=window.setTimeout(()=>{this.#c=null,this.#R()},0)})}#v(){this.#d!==null&&window.cancelAnimationFrame(this.#d),this.#c!==null&&window.clearTimeout(this.#c),this.#d=null,this.#c=null}#f;#h(){if(!(typeof document>"u"||this.#a)&&(this.#a=new MutationObserver(this.#f),this.#a.observe(document.documentElement,{attributes:!0,attributeFilter:["style","class"]}),typeof window.matchMedia=="function")){this.#r=[window.matchMedia("(prefers-color-scheme: dark)"),window.matchMedia("(forced-colors: active)")];for(let e of this.#r)e.addEventListener("change",this.#f)}}#_(){this.#v(),this.#a?.disconnect(),this.#a=null;for(let e of this.#r)e.removeEventListener("change",this.#f);this.#r=[]}#l(e){this.dispatchEvent(new CustomEvent(Yt,{detail:e,bubbles:!0,composed:!0}))}#g(e){this.dispatchEvent(new CustomEvent(Ut,{detail:{id:e},bubbles:!0,composed:!0}))}#P(e){this.#n=e.currentTarget,this.#o=!this.#o,this.#m=this.#o,this.requestUpdate()}#i(){if(!this.#o)return;this.#o=!1,this.requestUpdate();let e=this.#n;e?.isConnected&&e.focus()}#y(){for(let e of this.state.selection.roomIds)this.#l({type:"toggle-room",roomId:e})}#u(e,i){this.#t?.orbitBy(e,i)}#p(e){if(!xt(e)&&!(e.ctrlKey||e.metaKey||e.altKey)&&e.key==="Escape"){if(e.preventDefault(),this.#o){this.#i();return}this.#l({type:"dismiss-top-layer"});return}}rendererDiagnostics(){return this.#t?.diagnostics()??null}canvasIdentity(){return{scene:this.renderRoot.querySelector(".scene-canvas"),overlay:this.renderRoot.querySelector(".overlay-canvas")}}#A(){return this.state.host.connected?this.state.host.administrator?this.state.host.robotCount===0?{title:this.#e("v4_no_robot","No Matic robot set up"),detail:this.#e("v4_no_robot_detail","Set up a robot before opening its map.")}:this.state.dataMode==="live"&&this.state.floor.readOnly&&this.state.map.available&&this.state.notice?{title:this.#e("v4_saved_map_read_only_title","Saved map is read only"),detail:this.state.notice.text}:this.state.dataMode==="history"?!this.state.map.available&&this.state.resources.scene.status==="loading"?{title:this.#e("v4_loading_saved_map","Loading saved map"),detail:this.#e("v4_loading_saved_map_detail","This read-only snapshot is still preparing.")}:this.state.map.available?null:{title:this.#e("v4_saved_map_unavailable","Saved map unavailable"),detail:this.#e("v4_saved_map_unavailable_detail","Choose another snapshot or return to the live map.")}:this.state.host.robotConnected?this.state.coherence==="verifying"||this.state.coherence==="booting"?{title:this.#e("v4_locating_map","Locating the current map"),detail:this.#e("v4_locating_map_detail","Map controls will return after the floor is verified.")}:!this.state.map.available&&this.state.resources.scene.status==="loading"?{title:this.#e("v4_loading_verified_map","Loading the verified map"),detail:this.#e("v4_loading_verified_map_detail","The current floor is verified. The private scene is still preparing.")}:this.state.map.available?this.state.activity==="problem"?{title:this.#e("v4_robot_attention","Robot needs attention"),detail:this.#e("v4_robot_attention_detail","Check the robot before starting another task.")}:null:{title:this.#e("v4_map_unavailable","Map unavailable"),detail:this.#e("v4_map_unavailable_detail","The private scene is not ready. No map data is shown until it is verified.")}:{title:this.#e("v4_robot_offline","Robot offline"),detail:this.#e("v4_robot_offline_detail","The last verified map stays read only and has no live position.")}:{title:this.#e("v4_admin_required","Administrator access required"),detail:this.#e("v4_private_map_hidden","Private map data is hidden.")}:{title:this.#e("v4_reconnecting","Reconnecting"),detail:this.#e("v4_reconnecting_detail","The verified map is read only until Home Assistant reconnects.")}}#C(e,i){let n=this.state,o=this.narrow,a=n.workflow==="draw",r=this.#e("v4_how_to_move","How to move the map"),l=e&&!a,c=l&&!o&&n.view==="top",h=l&&n.view==="three",d=!i,u=!o&&!a;return b`
      <div class="map-rail" data-map-control>
        <div class="map-context"><slot name="floor"></slot>
        ${l?b`
          <div class="view-switch ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#e("map_view_label","Map view")}>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(n.view==="three")}
              @click=${()=>this.#l({type:"set-view",view:"three"})}
            >${this.#e("map_view_3d","3D")}</button>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(n.view==="top")}
              @click=${()=>this.#l({type:"set-view",view:"top"})}
            >${this.#e("map_view_top","2D")}</button>
          </div>
        `:v}

        </div>
        ${c?b`
          <div class="appearance-switch ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#e("map_style_label","Map style")}>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(n.appearance==="photo")}
              @click=${()=>this.#l({type:"set-appearance",appearance:"photo"})}
            >${this.#e("map_style_photo","Photo")}</button>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(n.appearance==="rooms")}
              @click=${()=>this.#l({type:"set-appearance",appearance:"rooms"})}
            >${this.#e("map_style_room_colours","Floor plan")}</button>
          </div>
        `:v}

        ${h?b`
          <div class="camera-steps ms-surface ms-surface--floating ms-segment" role="toolbar" aria-orientation="horizontal" aria-label=${this.#e("map_camera_controls","Map camera controls")}>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#e("map_rotate_left","Rotate left")} aria-keyshortcuts="[" @click=${()=>this.#u(-52,0)}>${g(nt)}</button>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#e("map_tilt_down","Lower viewing angle")} aria-keyshortcuts="PageDown" @click=${()=>this.#u(0,30)}>${g(Q)}</button>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#e("map_tilt_up","Raise viewing angle")} aria-keyshortcuts="PageUp" @click=${()=>this.#u(0,-30)}>${g(J)}</button>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#e("map_rotate_right","Rotate right")} aria-keyshortcuts="]" @click=${()=>this.#u(52,0)}>${g(ot)}</button>
          </div>
        `:v}

        ${d?b`
          <div class="map-tools ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#e("v4_map_tools","Map tools")}>
            ${i?v:b`
              <button
                class="fit ms-btn"
                type="button"
                aria-label=${this.#e("v4_fit_map_hint","Fit the whole map on screen")}
                @click=${()=>{this.#t?.fit(),this.#l({type:"fit-map"})}}
                title=${this.#e("v4_fit_map","Fit map")}
              >${g(tt)}<span class="ms-btn__label">${this.#e("v4_fit_map","Fit map")}</span></button>
            `}
          </div>
        `:v}
        ${!i&&u?b`
          <div class="map-extras ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#e("v4_map_display","Map display")}>
              <button
                class="labels ms-btn"
                type="button"
                aria-pressed=${String(n.labelsVisible)}
                @click=${()=>this.#l({type:"toggle-labels"})}
                title=${this.#e("v4_room_names","Room names")}
              >${g(et)}<span class="ms-btn__label">${this.#e("v4_room_names","Room names")}</span></button>
              <button
                class="help ms-btn ms-btn--icon"
                type="button"
                aria-label=${r}
                aria-expanded=${String(this.#o)}
                aria-controls=${$t}
                @click=${this.#P}
                title=${r}
              >${g(it)}</button>
          </div>
        `:v}

        ${this.#o&&e&&u?b`
          <div
            id=${$t}
            class="navigation-help ms-surface ms-surface--floating"
            role="dialog"
            aria-modal="false"
            aria-label=${r}
          >
            <header>
              <h3>${r}</h3>
              <button class="ms-btn ms-btn--sm" type="button" @click=${()=>this.#i()}>${this.#e("v4_close","Close")}</button>
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
        `:v}
      </div>
    `}#x(e){let i=this.state;if(!e)return v;if(i.workflow==="draw"&&!this.narrow)return b`
        <div class="map-dock ms-surface ms-surface--floating" data-map-control>
          ${mt(i,{intent:o=>this.#l(o),openBrush:()=>this.#l({type:"set-precision-open",value:!i.precisionOpen}),t:(o,a)=>this.#e(o,a)},"row")}
        </div>
      `;let n=i.selection.roomIds.length;return i.workflow==="rooms"&&n>0&&!this.narrow?b`
        <div class="map-dock ms-surface ms-surface--floating" data-map-control>
          <div class="selection-chip ms-surface ms-surface--floating" data-map-control>
            <span>${this.#e("v4_rooms_selected","Rooms selected: {count}").replace("{count}",String(n))}</span>
            <button class="ms-btn ms-btn--sm" type="button" @click=${()=>this.#y()}>${this.#e("v4_clear","Clear")}</button>
          </div>
        </div>
      `:v}render(){let e=this.state,i=Y(e),n=this.#A(),o=e.map.available&&(q(e)||e.dataMode==="history"),a=e.workflow==="draw"&&o,r=e.coherence==="verifying"||e.coherence==="booting";return b`
      <section
        class="map-root"
        tabindex="0"
        aria-label=${this.#e("map_viewport_aria","Interactive Matic 3D map")}
        aria-describedby=${a?e.draw.tool==="outline"?"zone-keyboard-help":"keyboard-draw-help":v}
        data-full-map=${String(e.fullMap)}
        data-workflow=${e.workflow}
        data-draw-tool=${e.draw.tool}
        data-narrow=${this.narrow?"true":v}
        @keydown=${this.#p}
        @pointerdown=${this.#b}
      >
        ${this.#C(o,r)}
        <slot name="scrim"></slot>

        <div
          class="scene-window"
          data-renderer-key="persistent-canvas-v4"
          ?hidden=${!o}
          role=${a?"group":"img"}
          aria-label=${St(e,this.localize)}
        >
          ${a?b`<span class="keyboard-aim" aria-hidden="true"></span>`:v}
          <canvas class="scene-canvas"></canvas>
          <canvas class="overlay-canvas"></canvas>
          ${a?this.#w.render():v}
        </div>

        ${a?b`
          <p id="zone-keyboard-help" class="sr-only">${this.#e("v4_zone_keyboard_help","Focus the map, aim with arrow keys, and press Enter to place points. The edges join automatically after three points. Keep adding points or Tab to a point; arrows move it, Delete removes it, and Escape cancels a drag.")}</p>
          <p id="keyboard-draw-help" class="sr-only">${this.#e("v4_keyboard_draw_help","Keyboard: focus the map, use arrow keys to aim, then Enter to paint or erase at the crosshair. D selects Paint; E selects Erase.")}</p>
          <div class="map-scale" aria-label=${`Scale ${i.label}`}>
            <span class="scale-line" style=${`--scale-width:${i.pixels}px`}></span>
            <span>${i.label}</span>
          </div>
        `:v}

        ${this.#x(o)}

        ${n&&!(e.fullMap&&(r||!e.host.administrator))?b`
          <div class="map-message ms-surface ms-surface--floating" role="status">
            <strong>${n.title}</strong>
            <span>${n.detail}</span>
          </div>
        `:v}
        <div class="sr-only" aria-live="polite" aria-atomic="true">
          ${St(e,this.localize)}
        </div>
      </section>
    `}};customElements.get(W)||customElements.define(W,V);export{W as a,Kt as b,Gt as c,Zt as d,jt as e,I as f,mt as g,xt as h,A as i,Yt as j,Ut as k};
