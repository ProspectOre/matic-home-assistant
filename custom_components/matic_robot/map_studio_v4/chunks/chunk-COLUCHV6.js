import{$ as _e,F as me,H as fe,I as b,M as v,O as ye,P as be,Q as ve,R as ge,_ as we,aa as xe,ba as Ce,c as ne,ca as ke,d as ie,da as Me,ea as Pe,fa as Se,ga as Ee,ha as Ae,ia as Re,ja as Te,ka as $e,l as pe,pa as Le,s as oe,u as G,v as re,w as T,x as k,xa as E,ya as ae}from"./chunk-OTYJ26W5.js";var ze=import.meta.url.match(/\/matic_robot\/[^/]+-([a-f0-9]{12})\/map-studio-v4(?:\/|$)/u)?.[1]??"dev",U=ze==="dev"?"":`-${ze}`,se=`matic-map-canvas-v4${U}`,Dt=`matic-precision-controls-v4${U}`,Nt=`matic-map-workflow-v4${U}`,Ot=`matic-map-shell-v4${U}`,Ut=`matic-map-panel-v0-4-0${U}`;var H=(r,e,t)=>{let n=t.x-e.x,o=t.y-e.y,i=Math.max(0,Math.min(1,((r.x-e.x)*n+(r.y-e.y)*o)/(n*n+o*o||1)));return Math.hypot(r.x-e.x-i*n,r.y-e.y-i*o)},st=(r,e)=>{let t=!1;for(let n=0,o=e.length-1;n<e.length;o=n++){let i=e[n],a=e[o];i.y>r.y!=a.y>r.y&&r.x<(a.x-i.x)*(r.y-i.y)/(a.y-i.y)+i.x&&(t=!t)}return t},Y=(r,e,t)=>(e.x-r.x)*(t.y-r.y)-(e.y-r.y)*(t.x-r.x),F=({points:r,closed:e})=>{if(r.length>64||e&&r.length<3||r.some(n=>!Number.isFinite(n.x)||!Number.isFinite(n.y)||Math.abs(n.x)>1e4||Math.abs(n.y)>1e4))return!1;let t=e?r.length:r.length-1;for(let n=0;n<t;n++){let o=r[n],i=r[(n+1)%r.length];if(Math.hypot(o.x-i.x,o.y-i.y)<.01)return!1;for(let a=n+2;a<t;a++){if(e&&n===0&&a===t-1)continue;let s=r[a],l=r[(a+1)%r.length];if(Math.min(H(o,s,l),H(i,s,l),H(s,o,i),H(l,o,i))<1e-5||Y(o,i,s)*Y(o,i,l)<0&&Y(s,l,o)*Y(s,l,i)<0)return!1}}return!e||Math.abs(r.reduce((n,o,i)=>{let a=r[(i+1)%r.length];return n+o.x*a.y-a.x*o.y},0))>.01},Be=(r,e)=>{if(!r.closed||!F(r))return[];let{points:t}=r,n=Math.min(...t.map(c=>c.x)),o=Math.max(...t.map(c=>c.x)),i=Math.min(...t.map(c=>c.y)),a=Math.max(...t.map(c=>c.y)),s=[];for(let c=0;c<32;c++)for(let d=0;d<32;d++){let p={x:Math.round((n+(d+.5)*(o-n)/32)*1e4)/1e4,y:Math.round((i+(c+.5)*(a-i)/32)*1e4)/1e4};if(!st(p,t)||!e(p))continue;let h=Math.min(...t.map((u,y)=>H(p,u,t[(y+1)%t.length]))),m=Math.floor(Math.min(2.5,h-1e-4)*1e4)/1e4;m>=.05&&s.push({...p,radius:m})}s.sort((c,d)=>d.radius-c.radius);let l=[];for(let c of s){if(l.length>=512)break;l.some(d=>Math.hypot(d.x-c.x,d.y-c.y)+c.radius*.5<=d.radius)||l.push(c)}return l};var V=class{constructor(e,t,n,o,i,a){this.state=e;this.renderer=t;this.intent=n;this.update=o;this.t=i;this.focusPoint=a}#n=null;#e="";#i=null;#a(e=this.state()){return T(e,"outline")!==null}#m(e,t){let n=t??T(this.state(),"outline");if(!k(this.state(),n))return;if(!F(e)){this.#e=this.t("v4_zone_invalid","Keep the outline from crossing itself."),this.update();return}let o=Be(e,i=>this.renderer()?.containsMapPoint(i)??!1);this.#e=e.closed&&!o.length?this.t("v4_zone_empty","Make the zone wider and keep it on mapped floor."):"",this.intent({type:"set-draft-circles",circles:o,outline:e,coordinateEdit:n})}addPoint(e,t){let n=t??T(this.state(),"outline");if(!k(this.state(),n)||n.tool!=="outline"||!this.renderer()?.containsMapPoint(e))return;let o=this.state().draw.outline??{points:[],closed:!1};if(o.points.length>=64)return;let i=[...o.points,e];this.#m({points:i,closed:i.length>=3},n)}#s(e){let t=this.state().draw.outline;if(!t)return;this.#i=null;let n=t.points.filter((o,i)=>i!==e);this.#m({points:n,closed:t.closed&&n.length>=3}),this.focusPoint(Math.min(e,n.length-1))}#l(e){let t=this.state().draw.outline;if(!t||t.points.length>=64)return;let n=t.points[e],o=t.points[(e+1)%t.points.length];if(!n||!o||!t.closed&&e===t.points.length-1)return;let i={x:(n.x+o.x)/2,y:(n.y+o.y)/2};this.#m({...t,points:[...t.points.slice(0,e+1),i,...t.points.slice(e+1)]}),this.focusPoint(e+1)}#h(e,t){if(e.button!==0||this.#n||e.pointerType==="touch"&&!e.isPrimary)return;let n=T(this.state(),"outline");if(!n)return;this.#i=t,this.update();let o=this.state().draw.outline;if(!o)return;e.stopPropagation(),e.preventDefault();let i=e.currentTarget;i.focus({preventScroll:!0}),i.setPointerCapture(e.pointerId),this.#n={index:t,pointer:e.pointerId,baseline:o,preview:o,target:i,capture:n}}observeState(e){this.#n&&!k(e,this.#n.capture)&&this.cancel()}#c(e){let t=this.#n;if(!t||t.pointer!==e.pointerId)return;if(e.stopPropagation(),e.preventDefault(),!k(this.state(),t.capture)){this.cancel();return}let n=this.renderer()?.screenToMap(e.clientX,e.clientY);!n||!this.renderer()?.containsMapPoint(n)||(t.preview={...t.baseline,points:t.baseline.points.map((o,i)=>i===t.index?n:o)},this.update())}#p(e){let t=this.#n;!t||t.pointer!==e.pointerId||(e.stopPropagation(),e.preventDefault(),this.#n=null,t.target.releasePointerCapture(e.pointerId),t.preview!==t.baseline&&this.#m(t.preview,t.capture),this.update())}cancel(){let e=this.#n;e&&(this.#n=null,e.target.hasPointerCapture(e.pointer)&&e.target.releasePointerCapture(e.pointer),this.update())}#M(e,t){if(e.ctrlKey||e.altKey||e.metaKey)return;if(e.key==="Escape"){e.stopPropagation(),this.cancel();return}let n=this.state().draw.outline;if(!n||!this.#a())return;if(e.key==="Delete"||e.key==="Backspace"){e.preventDefault(),e.stopPropagation(),this.#s(t);return}let o=e.shiftKey?.1:.02,i=e.key==="ArrowLeft"?-o:e.key==="ArrowRight"?o:0,a=e.key==="ArrowUp"?-o:e.key==="ArrowDown"?o:0;if(!i&&!a)return;e.preventDefault(),e.stopPropagation();let s=n.points[t],l=this.renderer()?.offsetMapPoint(s,i,a);l&&this.renderer()?.containsMapPoint(l)&&this.#m({...n,points:n.points.map((c,d)=>d===t?l:c)})}render(){if(!this.#a())return v;let e=this.#n?.preview??this.state().draw.outline,t=e?.points??[],n=t.map(s=>this.renderer()?.mapToScreen(s)),o=n.map((s,l)=>s?`${l?"L":"M"}${s.x},${s.y}`:"").join(" "),i=!e||F(e),a=this.#i!==null&&this.#i<t.length?this.#i:null;return b`
      <div class="zone-overlay">
        <svg aria-hidden="true"><path d=${o+(e?.closed?" Z":"")} class=${i?"":"invalid"} fill=${e?.closed?"var(--ms-accent)":"none"}></path></svg>
        ${n.map((s,l)=>s?b`
          <button class="zone-point" type="button" data-zone-index=${l} data-selected=${String(this.#i===l)} data-map-control style=${`left:${s.x}px;top:${s.y}px`}
            aria-label=${`${this.t("v4_zone_point","Zone point")} ${l+1}`} aria-describedby="zone-handle-help"
            title=${this.t("v4_zone_point_help","Drag to move. Arrow keys adjust; Delete removes.")}
            @pointerdown=${c=>this.#h(c,l)} @pointermove=${c=>this.#c(c)}
            @pointerup=${c=>this.#p(c)} @pointercancel=${()=>this.cancel()}
            @lostpointercapture=${()=>{this.#n&&this.cancel()}}
            @focus=${()=>{this.#i=l,this.update()}}
            @keydown=${c=>this.#M(c,l)}
          >${l+1}</button>
        `:v)}
        ${t.map((s,l)=>{let c=t[(l+1)%t.length];if(!c||!e?.closed&&l===t.length-1||t.length>=64)return v;let d={x:(s.x+c.x)/2,y:(s.y+c.y)/2},p=this.renderer()?.mapToScreen(d),h=n[l],m=n[(l+1)%n.length];return p&&h&&m&&Math.hypot(h.x-m.x,h.y-m.y)>=100?b`<button class="zone-point zone-midpoint" type="button" data-map-control
            style=${`left:${p.x}px;top:${p.y}px`} aria-label=${`${this.t("v4_zone_add_point","Add point after")} ${l+1}`}
            @click=${()=>this.#l(l)}>+</button>`:v})}
        <div class="zone-help" data-map-control>
          <span id="zone-handle-help" class="sr-only">${this.t("v4_zone_point_help","Drag to move. Arrow keys adjust; Delete removes.")}</span>
          ${a!==null?b`
            <div class="zone-point-actions ms-surface" role="group" aria-label=${`${this.t("v4_zone_point","Zone point")} ${a+1}`}>
              <span class="zone-selection">${this.t("v4_zone_point_short","Point")} ${a+1}</span>
              <button class="ms-btn" type="button" ?disabled=${t.length>=64||!e?.closed&&a===t.length-1} @click=${()=>this.#l(a)}>${this.t("v4_zone_insert_point","Insert point")}</button>
              <button class="ms-btn" type="button" aria-label=${`${this.t("v4_zone_delete_point","Delete point")} ${a+1}`} @click=${()=>this.#s(a)}>${this.t("v4_zone_delete_point","Delete point")}</button>
            </div>`:v}
          ${a===null||!e?.closed?b`
            <div class="zone-guidance ms-surface">
              <span>${e?.closed?this.t("v4_zone_edit_help","Tap to add points. Drag points to reshape."):this.t("v4_zone_create_help","Place points around the area. The edges join automatically.")}</span>
            </div>`:v}
          <span class="zone-feedback ms-surface" role="status" ?hidden=${!this.#e}>${this.#e}</span>
        </div>
      </div>
    `}};var lt=["outline","paint","erase","pan"],Ie=(r,e,t)=>{let{draw:n}=r,o=`${n.brushMeters.toFixed(2)} m`;return b`
    <div
      class=${`draw-tools draw-tools--${t} ms-segment`}
      data-zone=${String(n.tool==="outline")}
      role="toolbar"
      aria-label=${e.t("v4_draw_tools","Draw area tools")}
      data-map-control
    >
      ${lt.map(i=>b`
        <button
          class="ms-btn"
          type="button"
          aria-pressed=${String(n.tool===i)}
          data-tool=${i}
          @click=${()=>e.intent({type:"set-draw-tool",tool:i})}
        >${E(i==="outline"?Le:i==="paint"?Ae:i==="erase"?Te:$e)}<span class="ms-btn__label">${i==="outline"?e.t("v4_zone_tool","Zone"):i==="paint"?e.t("area_paint","Paint"):i==="erase"?e.t("area_erase","Erase"):e.t("move_map","Move map")}</span></button>
      `)}
      <button
        class="ms-btn"
        type="button"
        ?disabled=${n.strokeCount===0}
        @click=${()=>e.intent({type:"undo-draft"})}
      >${E(Se)}<span class="ms-btn__label">${e.t("undo","Undo")}</span></button>
      <button
        class="ms-btn"
        type="button"
        ?disabled=${n.redo.length===0}
        @click=${()=>e.intent({type:"redo-draft"})}
      >${E(Ee)}<span class="ms-btn__label">${e.t("redo","Redo")}</span></button>
      ${n.tool!=="outline"?b`<button
        class="ms-btn draw-brush"
        type="button"
        aria-label=${e.t("v4_brush_button","Brush width, {brush}. Opens brush settings.").replace("{brush}",o)}
        aria-expanded=${String(r.precisionOpen)}
        aria-haspopup="dialog"
        @click=${e.openBrush}
      >${E(Re)}<span class="ms-btn__label">${e.t("v4_brush","Brush {brush}").replace("{brush}",o)}</span></button>`:v}
    </div>
  `};var ct=r=>r.matches(":disabled, [aria-disabled='true']"),X=class{#n;#e;#i=null;#a=null;constructor(e,t){this.#n=e,this.#e=t,e.addController(this)}hostConnected(){this.#n.addEventListener("focusin",this.#l)}hostDisconnected(){this.#n.removeEventListener("focusin",this.#l),this.#i?.removeEventListener("keydown",this.#h),this.#i=null,this.#a=null}hostUpdated(){let e=this.#e.container();e!==this.#i&&(this.#i?.removeEventListener("keydown",this.#h),e?.addEventListener("keydown",this.#h),this.#i=e),this.#s()}#m(){let e=this.#i;return e?[...e.querySelectorAll(this.#e.items)].filter(t=>!ct(t)):[]}#s(){let e=this.#m(),t=(this.#a&&e.includes(this.#a)?this.#a:null)??e.find(o=>o.matches("[aria-pressed='true'], [aria-checked='true']"))??e[0]??null;this.#a=t;let n=this.#i?.querySelectorAll(this.#e.items)??[];for(let o of n)o.tabIndex=o===t?0:-1}#l=e=>{let t=e.composedPath()[0];!(t instanceof HTMLElement)||!this.#i?.contains(t)||t.matches(this.#e.items)&&(this.#a=t,this.#s())};#h=e=>{if(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey)return;let t=this.#e.orientation??"horizontal",n=t!=="vertical",o=t!=="horizontal",i=this.#m();if(!i.length)return;let a=e.composedPath()[0],s=Math.max(0,i.findIndex(d=>d===this.#a||a instanceof Node&&d.contains(a))),l;switch(e.key){case"ArrowLeft":if(!n)return;l=s-1;break;case"ArrowRight":if(!n)return;l=s+1;break;case"ArrowUp":if(!o)return;l=s-1;break;case"ArrowDown":if(!o)return;l=s+1;break;case"Home":l=0;break;case"End":l=i.length-1;break;default:return}e.preventDefault();let c=i[(l+i.length)%i.length];c&&(this.#a=c,this.#s(),c.focus())}};var Fe={accent:["--ms-accent","Highlight",[6,120,206]],onAccent:["--ms-on-accent","HighlightText",[255,255,255]],text:["--ms-text","CanvasText",[38,50,56]],quiet:["--ms-text-quiet","GrayText",[75,92,105]],plate:["--ms-surface-card","Canvas",[250,252,253]],roomFill:["--ms-surface-sunken","Canvas",[231,238,242]]},dt=r=>Math.max(0,Math.min(255,Math.round(r))),De=r=>{let e=r.trim(),t=e.match(/^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i)?.[1];if(t){let d=t.length<=4?[t[0],t[1],t[2]].map(u=>Number.parseInt(`${u}${u}`,16)):[t.slice(0,2),t.slice(2,4),t.slice(4,6)].map(u=>Number.parseInt(u,16)),[p,h,m]=d;return p===void 0||h===void 0||m===void 0?null:[p,h,m]}let n=e.startsWith("color(srgb"),o=e.slice(e.indexOf("(")+1).match(/-?\d*\.?\d+/g);if(!o||o.length<3)return null;let i=n?255:1,a=o.slice(0,3).map(d=>dt(Number(d)*i)),[s,l,c]=a;return s===void 0||l===void 0||c===void 0||[s,l,c].some(d=>Number.isNaN(d))?null:[s,l,c]},P=(r,e)=>`rgba(${r[0]},${r[1]},${r[2]},${e})`,Ne=r=>{let e=window.matchMedia?.("(forced-colors: active)").matches??!1;if(!e){let o=document.createElement("span"),i=document.createElement("canvas");i.width=1,i.height=1;let a=i.getContext("2d",{colorSpace:"srgb",willReadFrequently:!0});o.setAttribute("aria-hidden","true"),o.style.cssText="position:absolute;inline-size:0;block-size:0;overflow:hidden;visibility:hidden;pointer-events:none",r.append(o);let s=l=>{let[c,,d]=Fe[l];o.style.color=`var(${c}, transparent)`;let p=getComputedStyle(o).color;if(a){a.clearRect(0,0,1,1),a.fillStyle="transparent",a.fillStyle=p,a.fillRect(0,0,1,1);let[h,m,u,y]=a.getImageData(0,0,1,1).data;if(h!==void 0&&m!==void 0&&u!==void 0&&y!==void 0&&y!==0)return[h,m,u]}return De(p)??d};try{return{accent:s("accent"),onAccent:s("onAccent"),text:s("text"),quiet:s("quiet"),plate:s("plate"),roomFill:s("roomFill"),forced:e}}finally{o.remove()}}let t=document.createElement("span");t.setAttribute("aria-hidden","true"),t.style.cssText="position:absolute;inline-size:0;block-size:0;overflow:hidden;visibility:hidden;pointer-events:none",r.append(t);let n=o=>{let[,i,a]=Fe[o];return t.style.color=i,De(getComputedStyle(t).color)??a};try{return{accent:n("accent"),onAccent:n("onAccent"),text:n("text"),quiet:n("quiet"),plate:n("plate"),roomFill:n("roomFill"),forced:e}}finally{t.remove()}};var Oe=(r,e)=>Math.hypot(r.x-e.x,r.y-e.y),Ue=(r,e)=>({x:(r.x+e.x)/2,y:(r.y+e.y)/2}),He=(r,e)=>Math.atan2(e.y-r.y,e.x-r.x),ht=r=>{let e=r;for(;e>Math.PI;)e-=Math.PI*2;for(;e<-Math.PI;)e+=Math.PI*2;return e},B=(r,e,t)=>Math.max(e,Math.min(t,r)),Xe=r=>r.map(e=>({...e})),ut="button, input, select, textarea, a, [contenteditable='true'], [role='button'], [role='menuitem'], [data-map-control]",z=r=>r.composedPath().some(e=>e instanceof Element&&e.matches(ut)),qe=r=>r.composedPath().some(e=>e instanceof Element&&e.matches("select")),K=class{#n;#e;#i;#a=new Map;#m=!1;#s="idle";#l=[];#h=null;#c=0;#p=null;#M=0;#t=null;#v=null;#z=null;#B=0;#P=null;#g=!1;#u=null;#d=null;#o=!1;constructor(e,t,n){this.#n=e,this.#e=t,this.#i=n,e.addEventListener("pointerdown",this.#w),e.addEventListener("pointermove",this.#A),e.addEventListener("pointerup",this.#f),e.addEventListener("pointercancel",this.#f),e.addEventListener("wheel",this.#I,{passive:!1}),e.addEventListener("gesturestart",this.#O,{passive:!1}),e.addEventListener("gesturechange",this.#r,{passive:!1}),e.addEventListener("gestureend",this.#C,{passive:!1}),e.addEventListener("dblclick",this.#S),e.addEventListener("contextmenu",this.#$),e.addEventListener("keydown",this.#b),e.addEventListener("keyup",this.#H),e.addEventListener("blur",this.#F)}#w=e=>{if(this.#o)return;let t=this.#i.state();if(!t.pageActive){this.observeState(t);return}if(!e.isPrimary&&e.pointerType==="mouse"||z(e))return;this.observeState(t),this.#n.focus({preventScroll:!0}),this.#T(),e.pointerType==="touch"&&!e.isPrimary&&this.#a.size===0&&this.#i.state().draw.tool==="outline"&&(this.#g=!0);let n=performance.now(),o={id:e.pointerId,type:e.pointerType,startX:e.clientX,startY:e.clientY,x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,lastTime:n,velocityX:0,velocityY:0};if(this.#a.set(e.pointerId,o),this.#n.setPointerCapture?.(e.pointerId),this.#a.size>=2){this.#L(),this.#i.onCirclePreview(null),this.#d=null,this.#s="pinch",this.#n.classList.add("navigating"),this.#g=!0;let[l,c]=[...this.#a.values()];l&&c&&(this.#c=Math.max(1,Oe(l,c)),this.#p=Ue(l,c),this.#M=He(l,c),this.#t=this.#e.camera),e.preventDefault();return}let i=this.#i.state(),a=i.workflow==="draw"&&i.map.available&&!i.floor.readOnly;this.#g||this.#m||e.button===1||e.button===2||i.draw.tool==="pan"?(this.#s="pan",this.#v=this.#e.camera):a&&i.draw.tool==="outline"&&(this.#d=T(i,"outline"))?this.#s="outline":a&&(i.draw.tool==="paint"||i.draw.tool==="erase")&&(this.#d=T(i,i.draw.tool))?(this.#l=Xe(this.#d.baselineCircles),e.pointerType==="touch"?(this.#s="idle",this.#u=window.setTimeout(()=>{if(this.#u=null,this.#a.size!==1||this.#g||!k(this.#i.state(),this.#d)){this.#_();return}this.#s=i.draw.tool;let l=this.#a.get(e.pointerId);l&&this.#y(l.x,l.y)},110)):(this.#s=i.draw.tool,this.#y(e.clientX,e.clientY))):(this.#s=i.view==="three"&&!e.shiftKey?"orbit":"pan",this.#v=this.#e.camera),(this.#s==="pan"||this.#s==="orbit")&&this.#n.classList.add("navigating"),e.preventDefault()};observeState(e){if(!e.pageActive){this.#T(),this.#L(),this.#i.onCirclePreview(null),this.#e.setCursor(null),this.#d=null,this.#l=[],this.#h=null,this.#p=null,this.#t=null,this.#v=null,this.#z=null,this.#B=0,this.#m=!1,this.#g=!1,this.#s="idle",this.#n.classList.remove("navigating");for(let t of this.#a.keys())this.#n.hasPointerCapture?.(t)&&this.#n.releasePointerCapture?.(t);this.#a.clear();return}this.#d&&!k(e,this.#d)&&this.#_()}#_(){if(this.#L(),this.#i.onCirclePreview(null),this.#d=null,this.#l=[],this.#h=null,this.#s==="paint"||this.#s==="erase"||this.#s==="outline"||this.#s==="idle"){this.#s="idle",this.#g=!1,this.#n.classList.remove("navigating");for(let e of this.#a.keys())this.#n.releasePointerCapture?.(e);this.#a.clear()}}#A=e=>{let t=this.#i.state();if(!t.pageActive){this.observeState(t);return}if(this.#d&&!k(this.#i.state(),this.#d)){this.#_();return}let n=this.#a.get(e.pointerId);if(!n){let p=this.#e.screenToMap(e.clientX,e.clientY);this.#e.setCursor(p);return}let i=(e.getCoalescedEvents?.()||[]).at(-1)||e,a=performance.now(),s=Math.max(1,a-n.lastTime),l=(i.clientX-n.lastX)/s,c=(i.clientY-n.lastY)/s;if(n.velocityX=n.velocityX*.62+l*.38,n.velocityY=n.velocityY*.62+c*.38,n.lastX=i.clientX,n.lastY=i.clientY,n.lastTime=a,n.x=i.clientX,n.y=i.clientY,this.#s==="pinch"&&this.#a.size>=2){let[p,h]=[...this.#a.values()];if(!p||!h)return;let m=Math.max(1,Oe(p,h)),u=Ue(p,h),y=He(p,h),x=this.#t;if(x&&this.#p){let R={...x,distance:x.distance*this.#c/m,yaw:x.yaw+ht(y-this.#M),pitch:x.orthographic?x.pitch:x.pitch-(u.y-this.#p.y)*.0035};this.#e.setCamera(this.#e.cameraAfterPan(R,u.x-this.#p.x,u.y-this.#p.y))}e.preventDefault();return}this.#s==="paint"||this.#s==="erase"?this.#y(e.clientX,e.clientY):this.#s==="pan"?this.#v&&this.#e.setCamera(this.#e.cameraAfterPan(this.#v,i.clientX-n.startX,i.clientY-n.startY)):this.#s==="orbit"&&this.#v&&this.#e.setCamera({...this.#v,yaw:this.#v.yaw+(i.clientX-n.startX)*.0045,pitch:this.#v.pitch-(i.clientY-n.startY)*.004});let d=this.#e.screenToMap(i.clientX,i.clientY);this.#e.setCursor(d),e.preventDefault()};#f=e=>{let t=this.#i.state();if(!t.pageActive){this.observeState(t);return}if(this.#d&&!k(this.#i.state(),this.#d)){this.#_();return}let n=this.#a.get(e.pointerId);if(!n)return;let o=this.#s;if(this.#a.delete(e.pointerId),this.#n.releasePointerCapture?.(e.pointerId),this.#L(),this.#s==="outline"&&e.type!=="pointercancel"&&k(this.#i.state(),this.#d)&&Math.hypot(n.x-n.startX,n.y-n.startY)<7){let i=this.#e.screenToMap(n.x,n.y);i&&this.#i.onOutlinePoint?.(i,this.#d)}if(e.type!=="pointercancel"&&(this.#s==="paint"||this.#s==="erase")&&k(this.#i.state(),this.#d)&&JSON.stringify(this.#l)!==JSON.stringify(this.#d.baselineCircles))this.#i.onCircles(this.#l,this.#d);else if(e.type!=="pointercancel"&&this.#s!=="pinch"&&!this.#g&&Math.hypot(n.x-n.startX,n.y-n.startY)<7&&["rooms","plan"].includes(this.#i.state().workflow)&&re(this.#i.state())){let i=this.#e.roomAt(n.x,n.y);i&&this.#i.onRoom(i)}if((this.#s==="paint"||this.#s==="erase")&&this.#i.onCirclePreview(null),this.#a.size===0)this.#s="idle",this.#d=null,this.#n.classList.remove("navigating"),this.#g=!1,this.#p=null,this.#t=null,this.#v=null,this.#h=null,(o==="pan"||o==="orbit")&&n.type!=="mouse"&&this.#R(n.velocityX,n.velocityY,o);else if(this.#s==="pinch"){this.#s="pan",this.#g=!0;let i=this.#a.values().next().value;i&&(i.startX=i.x,i.startY=i.y,i.velocityX=0,i.velocityY=0),this.#v=this.#e.camera,this.#t=null}e.preventDefault()};#y(e,t){if(!k(this.#i.state(),this.#d)){this.#_();return}let n=this.#e.screenToMap(e,t);if(!n)return;let i=this.#i.state().draw.brushMeters/2;if(this.#s==="erase")this.#l=this.#l.filter(a=>Math.hypot(a.x-n.x,a.y-n.y)>a.radius+i);else{if(!this.#e.containsMapPoint(n))return;let a=Math.max(.04,i*.55),s=this.#h||n,l=Math.hypot(n.x-s.x,n.y-s.y),c=Math.max(1,Math.ceil(l/a));for(let d=0;d<=c&&this.#l.length<512;d+=1){let p=d/c,h={x:s.x+(n.x-s.x)*p,y:s.y+(n.y-s.y)*p};this.#l.some(m=>Math.hypot(m.x-h.x,m.y-h.y)<Math.max(.025,i*.28))||this.#l.push({x:Math.round(h.x*1e4)/1e4,y:Math.round(h.y*1e4)/1e4,radius:Math.round(i*100)/100})}}this.#h=n,this.#i.onCirclePreview(this.#l,this.#d)}#I=e=>{if(this.#o||!this.#i.state().pageActive||z(e))return;e.preventDefault(),this.#n.focus({preventScroll:!0}),this.#T();let t=e.deltaMode===WheelEvent.DOM_DELTA_LINE?16:e.deltaMode===WheelEvent.DOM_DELTA_PAGE?Math.max(1,this.#n.clientHeight):1,n=e.deltaX*t,o=e.deltaY*t;if(e.ctrlKey||e.metaKey){this.#e.zoomAt(Math.exp(B(-o*.008,-.28,.28)),e.clientX,e.clientY);return}if(e.altKey&&this.#i.state().view==="three"){this.#e.orbitBy(0,B(o,-80,80)*.75);return}if(e.deltaMode!==WheelEvent.DOM_DELTA_PIXEL||Math.abs(n)<.5&&Math.abs(o)>=50){this.#e.zoomAt(Math.exp(B(-o*.0025,-.28,.28)),e.clientX,e.clientY);return}this.#e.panBy(-B(n,-80,80),-B(o,-80,80))};#O=e=>{this.#o||!this.#i.state().pageActive||z(e)||(this.#n.focus({preventScroll:!0}),this.#T(),this.#n.classList.add("navigating"),this.#z=this.#e.camera,this.#B=Number.isFinite(e.rotation)?e.rotation:0,e.preventDefault())};#r=e=>{if(this.#o||!this.#i.state().pageActive||z(e))return;let t=this.#z;if(!t||this.#a.size>=2)return;let n=Number.isFinite(e.scale)&&e.scale>0?Math.max(.1,e.scale):1,o=Number.isFinite(e.rotation)?e.rotation:0;this.#e.setCamera({...t,distance:t.distance/n,yaw:t.yaw+(o-this.#B)*Math.PI/180}),e.preventDefault()};#C=e=>{if(!this.#i.state().pageActive){this.observeState(this.#i.state());return}let t=this.#z!==null;this.#z=null,this.#B=0,this.#n.classList.remove("navigating"),t&&!z(e)&&e.preventDefault()};#k(e){let t=this.#i.state();if(e.repeat||this.#o||this.#a.size||e.composedPath()[0]!==this.#n||!this.#n.matches(":focus")||t.workflow!=="draw"||!re(t)||t.command!=="idle"&&t.command!=="failed"||t.draw.tool!=="paint"&&t.draw.tool!=="erase"&&t.draw.tool!=="outline")return;let o=this.#n.querySelector(".scene-canvas")?.getBoundingClientRect();if(!o?.width||!o.height)return;let i=T(t,t.draw.tool);if(i){if(e.preventDefault(),this.#T(),t.draw.tool==="outline"){let a=this.#e.screenToMap(o.left+o.width/2,o.top+o.height/2);a&&this.#i.onOutlinePoint?.(a,i);return}this.#l=Xe(i.baselineCircles),this.#h=null,this.#d=i,this.#s=t.draw.tool,this.#y(o.left+o.width/2,o.top+o.height/2),this.#s="idle",this.#h=null,this.#d=null,this.#i.onCirclePreview(null),JSON.stringify(this.#l)!==JSON.stringify(i.baselineCircles)&&this.#i.onCircles(this.#l,i)}}#b=e=>{if(this.#o||!this.#i.state().pageActive||z(e)||e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey)return;if(e.key==="Enter"){this.#k(e);return}if(e.code==="Space"){this.#m=!0,e.preventDefault();return}this.#T();let t=this.#i.state(),n=e.key.toLocaleLowerCase();if(e.key==="+"||e.key==="=")this.#e.zoomAt(1.25);else if(e.key==="-")this.#e.zoomAt(.8);else if(e.key==="0")this.#e.fit();else if(n==="3")this.#E({type:"set-view",view:"three"});else if(n==="t")this.#E({type:"set-view",view:"top"});else if(e.key==="[")this.#e.orbitBy(-40,0);else if(e.key==="]")this.#e.orbitBy(40,0);else if(e.key==="PageUp")this.#e.orbitBy(0,-30);else if(e.key==="PageDown")this.#e.orbitBy(0,30);else if(n==="d"&&t.workflow==="draw")this.#E({type:"set-draw-tool",tool:"paint"});else if(n==="e"&&t.workflow==="draw")this.#E({type:"set-draw-tool",tool:"erase"});else if(["arrowleft","arrowright","arrowup","arrowdown"].includes(n))if(t.view==="three"&&!e.shiftKey){let o=n==="arrowleft"?-24:n==="arrowright"?24:0,i=n==="arrowup"?-20:n==="arrowdown"?20:0;this.#e.orbitBy(o,i)}else{let o=n==="arrowleft"?30:n==="arrowright"?-30:0,i=n==="arrowup"?30:n==="arrowdown"?-30:0;this.#e.panBy(o,i)}else if(t.workflow!=="draw"&&["w","a","s","d"].includes(n))this.#e.panBy(n==="a"?34:n==="d"?-34:0,n==="w"?34:n==="s"?-34:0);else if(t.workflow!=="draw"&&(n==="q"||n==="e"))this.#e.orbitBy(n==="q"?-30:30,0);else return;e.preventDefault()};#H=e=>{e.code==="Space"&&(this.#m=!1)};#F=()=>{this.#m=!1,this.#_(),this.#e.setCursor(null),this.#n.classList.remove("navigating")};#S=e=>{this.#o||!this.#i.state().pageActive||z(e)||(this.#T(),this.#e.zoomAt(e.shiftKey?1/1.6:1.6,e.clientX,e.clientY),e.preventDefault())};#$=e=>{z(e)||e.preventDefault()};#E(e){this.#n.dispatchEvent(new CustomEvent("matic-workspace-intent",{detail:e,bubbles:!0,composed:!0}))}#R(e,t,n){if(window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;let o=B(e,-.55,.55),i=B(t,-.55,.55);if(Math.hypot(o,i)<.02)return;let a=performance.now(),s=l=>{let c=Math.min(32,l-a);a=l,n==="orbit"?this.#e.orbitBy(o*c,i*c):this.#e.panBy(o*c,i*c);let d=.9**(c/16);o*=d,i*=d,Math.hypot(o,i)>=.01?this.#P=window.requestAnimationFrame(s):this.#P=null};this.#P=window.requestAnimationFrame(s)}#T(){this.#P!==null&&window.cancelAnimationFrame(this.#P),this.#P=null}#L(){this.#u!==null&&window.clearTimeout(this.#u),this.#u=null}dispose(){this.#o||(this.#_(),this.#o=!0,this.#T(),this.#n.removeEventListener("pointerdown",this.#w),this.#n.removeEventListener("pointermove",this.#A),this.#n.removeEventListener("pointerup",this.#f),this.#n.removeEventListener("pointercancel",this.#f),this.#n.removeEventListener("wheel",this.#I),this.#n.removeEventListener("gesturestart",this.#O),this.#n.removeEventListener("gesturechange",this.#r),this.#n.removeEventListener("gestureend",this.#C),this.#n.removeEventListener("dblclick",this.#S),this.#n.removeEventListener("contextmenu",this.#$),this.#n.removeEventListener("keydown",this.#b),this.#n.removeEventListener("keyup",this.#H),this.#n.removeEventListener("blur",this.#F),this.#a.clear())}};var on="/api/matic_robot/slam_entries",rn=24,an=8,pt=15e5,sn=16*1024*1024,ln=36,cn=16*1024*1024,We=65536,f=class extends Error{constructor(e){super(e),this.name="ContractError",this.code=e}},w=(r,e)=>{if(!r||typeof r!="object"||Array.isArray(r))throw new f(e);return r},g=(r,e,t)=>{if(typeof r!="string")throw new f(t);let n=r.trim();if(!n||Array.from(n).length>e||/[\u0000-\u001f\u007f]/u.test(n))throw new f(t);return n},mt=r=>{if(r==null||r==="")return null;try{return g(r,128,"invalid-floor-label")}catch{return null}},D=(r,e,t,n)=>{if(typeof r!="number"||!Number.isFinite(r)||r<e||r>t)throw new f(n);return r},M=(r,e,t,n)=>{let o=D(r,e,t,n);if(!Number.isInteger(o))throw new f(n);return o},le=(r,e)=>r==null?null:M(r,1,e,"invalid-floor-ordinal"),_=(r,e)=>{if(typeof r!="boolean")throw new f(e);return r},Z=(r,e)=>r===void 0?!1:_(r,e),ft=(r,e)=>r===null?null:_(r,e),Ge=r=>{if(r==null)return null;let e=g(r,64,"invalid-map-session-key");if(!/^[0-9a-f]{64}$/u.test(e))throw new f("invalid-map-session-key");return e},yt=r=>{if(r==null)return null;if(r==="bootstrap_empty"||r==="map_session_unverified"||r==="floor_plan_unavailable"||r==="floor_plan_mismatch")return r;throw new f("invalid-map-block-reason")},bt=r=>{if(r===void 0)return"not_started";if(r==="not_started"||r==="running"||r==="complete"||r==="partial"||r==="failed")return r;throw new f("invalid-bootstrap-state")},$=(r,e)=>{let t=g(r,512,e);if(!t.startsWith("/")||t.startsWith("//")||t.includes("\\"))throw new f(e);return t},vt=r=>{let e=typeof r.map_health=="string"?r.map_health.toLowerCase():"",t=typeof r.stream_state=="string"?r.stream_state.toLowerCase():"",n=typeof r.invalid_tiles=="number"?r.invalid_tiles:0;return e.includes("error")||e.includes("fail")||e.includes("degrad")||n>0?"problem":r.map_truncated===!0||e.includes("truncat")||e.includes("limit")?"limited":r.map_complete===!0?"ready":t.includes("connect")||t.includes("collect")||t.includes("run")?"building":"unknown"},dn=r=>{let e=w(r,"invalid-catalog");if(!Array.isArray(e.entries)||e.entries.length>64)throw new f("invalid-catalog-entries");return e.entries.map(t=>{let n=w(t,"invalid-catalog-entry"),o=M(n.map_revision,0,Number.MAX_SAFE_INTEGER,"invalid-map-revision");return{entryId:g(n.entry_id,128,"invalid-entry-id"),sceneUrl:$(n.scene_url,"invalid-scene-url"),deltaUrl:n.delta_url===void 0||n.delta_url===null?null:$(n.delta_url,"invalid-delta-url"),poseUrl:$(n.pose_url,"invalid-pose-url"),historyUrl:$(n.history_url,"invalid-history-url"),areasUrl:$(n.areas_url,"invalid-areas-url"),plansUrl:$(n.plans_url,"invalid-plans-url"),mapRevision:o,mapFloorCoherent:_(n.map_floor_coherent,"invalid-floor-coherence"),mapSessionVerified:_(n.map_session_verified,"invalid-session-state"),mapSessionKey:Ge(n.map_session_key),mapBlockReason:yt(n.map_block_reason),runnerLocked:_(n.runner_locked,"invalid-runner-lock"),stopSettlePending:_(n.stop_settle_pending,"invalid-stop-settle"),activePlan:_(n.active_plan,"invalid-active-plan"),nativeReconciliationPending:_(n.native_reconciliation_pending,"invalid-native-reconciliation"),nativeSessionActive:ft(n.native_session_active,"invalid-native-session"),mapComplete:_(n.map_complete,"invalid-map-complete"),mapTruncated:_(n.map_truncated,"invalid-map-truncated"),selectedFloorOrdinal:le(n.selected_floor_ordinal,128),mapFloorOrdinal:le(n.map_floor_ordinal,128),historyCount:M(n.history_count,0,12,"invalid-history-count"),historyFloorCount:M(n.history_floor_count,0,128,"invalid-floor-count"),health:vt(n),streamFailures:M(n.stream_failures,0,Number.MAX_SAFE_INTEGER,"invalid-stream-failures"),bootstrapState:bt(n.bootstrap_state),bootstrapPhotoSeen:n.bootstrap_photo_seen===void 0?!1:_(n.bootstrap_photo_seen,"invalid-bootstrap-photo"),bootstrapStructureSeen:n.bootstrap_structure_seen===void 0?!1:_(n.bootstrap_structure_seen,"invalid-bootstrap-structure"),bootstrapFailures:n.bootstrap_failures===void 0?0:M(n.bootstrap_failures,0,2,"invalid-bootstrap-failures")}})},Ye=(r,e)=>{if(!Array.isArray(r)||r.length!==2)throw new f(e);return[D(r[0],-1e6,1e6,e),D(r[1],-1e6,1e6,e)]},gt=(r,e)=>{if(!Array.isArray(r)||r.length<3||r.length>8192)throw new f(e);return r.map(t=>Ye(t,e))},Ve=(r,e)=>{if(!Array.isArray(r)||r.length>256)throw new f("invalid-rooms");return r.map(t=>{let n=w(t,"invalid-room");return{roomId:g(n.room_id,128,"invalid-room-id"),name:g(n.name,128,"invalid-room-name"),boundary:e?gt(n.boundary,"invalid-room-boundary"):[]}})},wt=r=>{let e=w(r,"invalid-history-snapshot"),t=g(e.created_at,64,"invalid-history-time");if(!Number.isFinite(Date.parse(t)))throw new f("invalid-history-time");return{id:g(e.id,128,"invalid-history-id"),createdAt:t,revision:M(e.revision,0,Number.MAX_SAFE_INTEGER,"invalid-history-revision"),pointCount:M(e.point_count,1,pt,"invalid-history-points"),sceneUrl:$(e.scene_url,"invalid-history-scene-url")}},hn=r=>{let e=w(r,"invalid-history");if(!Array.isArray(e.floors)||e.floors.length<1||e.floors.length>128)throw new f("invalid-history-floors");return{entryId:g(e.entry_id,128,"invalid-history-entry"),liveAvailable:_(e.live_available,"invalid-history-live"),floors:e.floors.map(t=>{let n=w(t,"invalid-history-floor");if(!Array.isArray(n.snapshots)||n.snapshots.length>12)throw new f("invalid-history-snapshots");return{id:g(n.id,128,"invalid-history-floor-id"),active:_(n.active,"invalid-history-floor-active"),readOnly:_(n.read_only,"invalid-history-floor-read-only"),liveAvailable:n.live_available===void 0?!1:_(n.live_available,"invalid-history-floor-live"),label:mt(n.label),ordinal:n.ordinal===void 0?null:le(n.ordinal,128),snapshots:n.snapshots.map(wt)}})}},Q=r=>{if(r==="vacuum"||r==="mop"||r==="vacuum_and_mop")return r;throw new f("invalid-cleaning-mode")},q=r=>{if(r==="quick"||r==="standard"||r==="heavy_duty")return r;throw new f("invalid-coverage-setting")},j=(r,e)=>r==null?null:M(r,1,100,e),J=r=>{if(r==null)return[];let e=["mop_due","coverage_due","room_not_on_current_map","identity_changed","shared_schedule_unavailable","mop_progress_unverified","coverage_progress_unverified","invalid_cadence_policy"];if(!Array.isArray(r)||r.length>e.length||r.some(t=>!e.includes(t)))throw new f("invalid-cadence-reasons");return[...new Set(r)]},Ke=r=>{if(r==null)return;let e=w(r,"invalid-room-cadence"),t=e.scope===void 0?"plan":e.scope;if(t!=="plan"&&t!=="shared")throw new f("invalid-room-cadence-scope");let n=e.periodic_coverage_setting;return{scope:t,mopEveryN:j(e.mop_every_n,"invalid-mop-interval"),coverageEveryN:j(e.coverage_every_n,"invalid-coverage-interval"),periodicCoverageSetting:n==null?null:q(n),doMopNext:Z(e.do_mop_next,"invalid-do-mop-next"),doCoverageNext:Z(e.do_coverage_next,"invalid-do-coverage-next")}},ce=(r,e)=>{if(r==null)return;let t=w(r,"invalid-room-cadence-progress"),n=t.effective_cleaning_mode,o=t.effective_coverage_setting,i=J(e??t.cadence_reasons);return{mopProgress:M(t.mop_progress??0,0,100,"invalid-mop-progress"),coverageProgress:M(t.coverage_progress??0,0,100,"invalid-coverage-progress"),mopDue:Z(t.mop_due,"invalid-mop-due"),coverageDue:Z(t.coverage_due,"invalid-coverage-due"),nextMopIn:j(t.next_mop_in,"invalid-next-mop"),nextCoverageIn:j(t.next_coverage_in,"invalid-next-coverage"),reasons:i,...n===void 0?{}:{effectiveCleaningMode:Q(n)},...o===void 0?{}:{effectiveCoverageSetting:q(o)}}},_t=r=>{let e=w(r,"invalid-plan-room"),t=Ke(e.cadence),n=ce(e.cadence_progress,e.cadence_reasons),o=J(e.cadence_reasons);return{roomId:g(e.room_id,128,"invalid-plan-room-id"),cleaningMode:Q(e.cleaning_mode),coverageSetting:q(e.coverage_setting),...t===void 0?{}:{cadence:t},...n===void 0?{}:{cadenceProgress:n},...o.length?{cadenceReasons:o}:{}}},Ze=r=>{if(r==null)return;let e=w(r,"invalid-plan-preview");if(!Array.isArray(e.rooms)||e.rooms.length>100||!Array.isArray(e.mission_boundaries)||e.mission_boundaries.length>99)throw new f("invalid-plan-preview");let t=e.rooms.map(s=>{let l=w(s,"invalid-plan-preview-room");return{roomId:g(l.room_id,128,"invalid-plan-preview-room-id"),name:g(l.name,128,"invalid-plan-preview-room-name"),cleaningMode:Q(l.cleaning_mode),coverageSetting:q(l.coverage_setting),cadenceReasons:J(l.cadence_reasons)}}),n=e.mission_boundaries.map(s=>M(s,1,Math.max(1,t.length-1),"invalid-plan-preview-boundary"));if(n.some((s,l)=>s>=t.length||s<=(n[l-1]??0)))throw new f("invalid-plan-preview-boundary-order");let o=["cadence_identity_unavailable","preview_unavailable","plan_disabled","plan_has_no_rooms","plan_room_limit","cadence_identity_changed","shared_schedule_unavailable","cadence_progress_unverified","invalid_cadence_policy","invalid_plan"],i=e.blocker;if(i!==null&&!o.includes(i))throw new f("invalid-plan-preview-blocker");if(i===null&&t.length===0)throw new f("empty-plan-preview");let a=e.preview_token;if(a!==void 0&&(typeof a!="string"||!/^[0-9a-f]{64}$/u.test(a)))throw new f("invalid-plan-preview-token");return{rooms:t,missionBoundaries:n,blocker:i,...typeof a=="string"?{previewToken:a}:{}}},un=r=>{let e=w(r,"invalid-room-sequence-preview"),t=g(e.entry_id,128,"invalid-room-sequence-preview-entry"),n=g(e.floor_token,128,"invalid-room-sequence-preview-floor"),o=g(e.preview_token,64,"invalid-room-sequence-preview-token");if(!/^[0-9a-f]{64}$/u.test(n)||!/^[0-9a-f]{64}$/u.test(o))throw new f("invalid-room-sequence-preview-token");let i=Ze({rooms:e.rooms,mission_boundaries:e.mission_boundaries,blocker:e.blocker});if(!i)throw new f("invalid-room-sequence-preview");let a=e.rooms;if(!Array.isArray(a))throw new f("invalid-room-sequence-preview-rooms");let s=i.rooms.map((l,c)=>{let d=w(a[c],"invalid-room-sequence-preview-room"),p=ce(d.cadence_progress,d.cadence_reasons);return{...l,...p===void 0?{}:{cadenceProgress:p}}});return{entryId:t,floorToken:n,previewToken:o,rooms:s,missionBoundaries:i.missionBoundaries,blocker:i.blocker}},xt=r=>{if(r==null)return null;if(!Array.isArray(r)||r.length<3||r.length>64)throw new f("invalid-area-outline");let e={closed:!0,points:r.map(t=>{let n=w(t,"invalid-area-outline");if(typeof n.x!="number"||typeof n.y!="number")throw new f("invalid-area-outline");return{x:n.x,y:n.y}})};if(!F(e))throw new f("invalid-area-outline");return e},Ct=r=>{let e=w(r,"invalid-area-circle");return{x:D(e.x,-1e6,1e6,"invalid-area-circle"),y:D(e.y,-1e6,1e6,"invalid-area-circle"),radius:D(e.radius,.05,2.5,"invalid-area-circle")}},kt=r=>r==="current"||r==="review"||r==="stale"?r:"unknown",pn=r=>{let e=w(r,"invalid-areas");if(!Array.isArray(e.areas)||e.areas.length>256)throw new f("invalid-area-list");return{sceneUrl:$(e.scene_url,"invalid-area-scene-url"),rooms:Ve(e.rooms,!0),areas:e.areas.map(t=>{let n=w(t,"invalid-area");if(!Array.isArray(n.circles)||n.circles.length>512)throw new f("invalid-area-circles");return{id:g(n.id,128,"invalid-area-id"),name:g(n.name,128,"invalid-area-name"),circles:n.circles.map(Ct),outline:xt(n.outline),cleaningMode:Q(n.cleaning_mode),coverageSetting:q(n.coverage_setting),status:kt(n.status),canRebind:_(n.can_rebind,"invalid-area-rebind")}})}},mn=r=>{let e=w(r,"invalid-plan-save-response"),t=w(e.response,"invalid-plan-save-response"),n=w(t.plan,"invalid-plan-save-response");return g(n.id,128,"invalid-plan-save-response")},fn=r=>{let e=w(r,"invalid-plans");if(!Array.isArray(e.plans)||e.plans.length>256)throw new f("invalid-plan-list");let t=e.rooms;return{rooms:Ve(t,!1).map((o,i)=>{let a=Array.isArray(t)?t[i]:void 0,s=w(a,"invalid-room"),l=Ke(s.shared_cadence),c=ce(s.shared_cadence_progress,s.shared_cadence_reasons),d=J(s.shared_cadence_reasons);return{roomId:o.roomId,name:o.name,...l===void 0?{}:{sharedCadence:l},...c===void 0?{}:{sharedCadenceProgress:c},...d.length?{sharedCadenceReasons:d}:{}}}),selectedPlan:e.selected_plan===null||e.selected_plan===void 0?null:g(e.selected_plan,128,"invalid-selected-plan"),plans:e.plans.map(o=>{let i=w(o,"invalid-plan");if(!Array.isArray(i.rooms)||i.rooms.length>256||!Array.isArray(i.room_order))throw new f("invalid-plan-rooms");let a=i.run_behavior;if(a!=="intelligent"&&a!=="ordered")throw new f("invalid-run-behavior");let s=Ze(i.next_run_preview);return{id:g(i.id,128,"invalid-plan-id"),name:g(i.name,128,"invalid-plan-name"),enabled:_(i.enabled,"invalid-plan-enabled"),runBehavior:a,rooms:i.rooms.map(l=>_t(l)),roomOrder:i.room_order.slice(0,256).map(l=>g(l,128,"invalid-room-order")),returnToBase:_(i.return_to_base,"invalid-return-to-base"),finishCurrentRoom:_(i.finish_current_room,"invalid-finish-room"),finishCurrentRoomThreshold:M(i.finish_current_room_threshold,0,100,"invalid-finish-threshold"),...s===void 0?{}:{nextRunPreview:s}}})}},yn=r=>{let e=w(r,"invalid-pose"),t=e.position,n=t===null?null:Ye(t,"invalid-pose-position"),o=e.pose_freshness;if(o!=="live"&&o!=="coordinator_fallback")throw new f("invalid-pose-freshness");return{position:n,source:g(e.source,64,"invalid-pose-source"),revision:M(e.revision,0,Number.MAX_SAFE_INTEGER,"invalid-pose-revision"),poseRevision:M(e.pose_revision,0,Number.MAX_SAFE_INTEGER,"invalid-pose-sequence"),floorCoherent:_(e.map_floor_coherent,"invalid-pose-floor"),mapSessionKey:Ge(e.map_session_key),freshness:o}},bn=r=>{try{return $(r,"invalid-private-path"),!0}catch{return!1}};var S=(r,e,t)=>Math.max(e,Math.min(t,r)),W=r=>{let e=r;for(;e>Math.PI;)e-=Math.PI*2;for(;e<-Math.PI;)e+=Math.PI*2;return e},Mt=r=>{switch(r){case"efficient":return .35;case"balanced":return .65;case"maximum":case"auto":return 1}},je=r=>{let e=r.metadata.metersPerCell;return[(r.metadata.origin[0]+(r.metadata.span[0]-1)/2)*e,(r.metadata.origin[1]+(r.metadata.span[1]-1)/2)*e]},tt=(r,e,t,n)=>{let o=je(t),i=je(n);return[r+(i[0]-o[0]),e+(o[1]-i[1])]},Pt=(r,e,t)=>{let[n,o]=tt(r.targetX,r.targetZ,e,t);return{...r,targetX:n,targetZ:o}},nt=(r,e)=>{if(!e)return!0;let t=r==="top";return Math.abs(e.zoom-1)<.001&&Math.abs(e.targetX)<.001&&Math.abs(e.targetZ)<.001&&Math.abs(W(e.yaw-(t?0:-Math.PI/4)))<.001&&(t||Math.abs(e.pitch-.82)<.001)},St=(r,e,t,n,o)=>Object.fromEntries(Object.entries(r).map(([i,a])=>{if(!a||nt(i,a))return[i,a];let[s,l]=tt(a.targetX,a.targetZ,e,t),c=n[i],d=o[i],p=c>0&&d>0?a.zoom*d/c:a.zoom;return[i,{...a,targetX:s,targetZ:l,zoom:p}]})),ee=r=>{let e=r.resources.entry;return[r.dataMode,r.selection.entryId??"none",r.selection.floorId,e?.entryId??"none",e?.selectedFloorOrdinal??"none",e?.mapFloorOrdinal??"none",e?.mapSessionKey??"none"].join("|")},he=512*1024,Qe=he/2,I=We,it=256,Et=(r,e)=>r.metadata.metersPerCell===e.metadata.metersPerCell&&r.metadata.origin[0]===e.metadata.origin[0]&&r.metadata.origin[1]===e.metadata.origin[1]&&r.metadata.span[0]===e.metadata.span[0]&&r.metadata.span[1]===e.metadata.span[1],de=(r,e)=>r.pointOffset===e.pointOffset&&r.floorCount===e.floorCount&&r.surfaceCount===e.surfaceCount&&r.total===e.total&&r.source===e.source&&Et(r,e),Je=(r,e)=>{let t=r.deltaHint;if(!t||t.baseRevision!==e||r.revision<=e||t.blockBytes!==I||t.dirtyBlocks.length>it)return null;let n=Math.ceil(r.total*8/I),o=-1;for(let i of t.dirtyBlocks){if(!Number.isSafeInteger(i)||i<=o||i>=n)return null;o=i}return t.dirtyBlocks},At={accent:[6,120,206],onAccent:[255,255,255],text:[38,50,56],quiet:[75,92,105],plate:[250,252,253],roomFill:[231,238,242],forced:!1},ot=Math.PI/3.15,Rt=1.08,Tt=(r,e)=>{let t=ot/2,n=Math.atan(Math.tan(t)*Math.max(.2,e));return r/Math.sin(Math.min(t,n))*Rt},$t=(r,e)=>{let t=new Float32Array(16);for(let n=0;n<4;n+=1)for(let o=0;o<4;o+=1){let i=0;for(let a=0;a<4;a+=1)i+=(r[a*4+o]??0)*(e[n*4+a]??0);t[n*4+o]=i}return t},Lt=(r,e,t,n)=>{let o=1/Math.tan(r/2),i=new Float32Array(16);return i[0]=o/e,i[5]=o,i[10]=(n+t)/(t-n),i[11]=-1,i[14]=2*n*t/(t-n),i},zt=(r,e,t,n,o,i)=>{let a=new Float32Array(16);return a[0]=2/(e-r),a[5]=2/(n-t),a[10]=-2/(i-o),a[12]=-(e+r)/(e-r),a[13]=-(n+t)/(n-t),a[14]=-(i+o)/(i-o),a[15]=1,a},Bt=(r,e)=>{let t=Math.hypot((r[0]??0)-(e[0]??0),(r[1]??0)-(e[1]??0),(r[2]??0)-(e[2]??0))||1,n=[((r[0]??0)-(e[0]??0))/t,((r[1]??0)-(e[1]??0))/t,((r[2]??0)-(e[2]??0))/t],o=Math.hypot(n[2]??0,n[0]??0)||1,i=[(n[2]??0)/o,0,-(n[0]??0)/o],a=[(n[1]??0)*(i[2]??0),(n[2]??0)*(i[0]??0)-(n[0]??0)*(i[2]??0),-(n[1]??0)*(i[0]??0)];return new Float32Array([i[0]??0,a[0]??0,n[0]??0,0,i[1]??0,a[1]??0,n[1]??0,0,i[2]??0,a[2]??0,n[2]??0,0,-((i[0]??0)*(r[0]??0)+(i[1]??0)*(r[1]??0)+(i[2]??0)*(r[2]??0)),-((a[0]??0)*(r[0]??0)+(a[1]??0)*(r[1]??0)+(a[2]??0)*(r[2]??0)),-((n[0]??0)*(r[0]??0)+(n[1]??0)*(r[1]??0)+(n[2]??0)*(r[2]??0)),1])},et=(r,e,t)=>{let n=!1,o=t.at(-1);if(!o)return!1;for(let i of t){let[a,s]=i,[l,c]=o;s>e!=c>e&&r<(l-a)*(e-s)/(c-s)+a&&(n=!n),o=i}return n},te=class{#n;#e;#i;#a=null;#m=null;#s=null;#l=null;#h=null;#c=null;#p=null;#M=new WeakMap;#t=null;#v=null;#z=null;#B=null;#P=null;#g=null;#u=null;#d=null;#o=null;#w=null;#_=null;#A=null;#f=null;#y=null;#I=null;#O;#r={yaw:-Math.PI/4,pitch:.82,distance:12,targetX:0,targetZ:0,orthographic:!1};#C=12;#k=8;#b=4;#H=new Float32Array(16);#F=null;#S="unavailable";#$=0;#E=0;#R=0;#T=0;#L=0;#V=1;#X={width:1,height:1,left:0,top:0};#x=!0;#D=!1;#se=At;constructor(e,t,n={}){this.#n=e,this.#e=t,this.#i=n,this.#m=t.getContext("2d",{alpha:!0}),this.#n.addEventListener("webglcontextlost",this.#ye),this.#n.addEventListener("webglcontextrestored",this.#be),this.#he(),this.#O=new ResizeObserver(()=>{let o=this.#C,i=this.#k;this.#ue(),this.#x&&(o!==this.#C||i!==this.#k)?this.fit(!1):this.requestRender()}),this.#O.observe(e)}get camera(){return{...this.#r}}#le(){return{minimum:Math.max(.2,this.#b*.04),maximum:this.#b*8}}#ce(){let e=this.#o?.metadata.span,t=this.#o?.metadata.metersPerCell;return!e||t===void 0?{x:this.#b,z:this.#b}:{x:Math.max(.5,e[0]*t*.55),z:Math.max(.5,e[1]*t*.55)}}setCamera(e,t=!0){let n=this.#le(),o=this.#ce();this.#r={yaw:W(e.yaw),pitch:e.orthographic?Math.PI/2-.018:S(e.pitch,.18,1.38),distance:S(e.distance,n.minimum,n.maximum),targetX:S(e.targetX,-o.x,o.x),targetZ:S(e.targetZ,-o.z,o.z),orthographic:e.orthographic},this.#x=!1,this.requestRender(),t&&this.#U()}cameraAfterPan(e,t,n){let o=this.#W(),i=e.distance*1.75/Math.max(200,o.height),a=Math.cos(e.yaw),s=-Math.sin(e.yaw),l=-Math.sin(e.yaw),c=-Math.cos(e.yaw),d=this.#ce();return{...e,targetX:S(e.targetX-t*i*a+n*i*l,-d.x,d.x),targetZ:S(e.targetZ-t*i*s+n*i*c,-d.z,d.z)}}setState(e){if(this.#D)return;let t=this.#u,n=this.#o,o=this.#_,i=this.#A;this.#u=e,!e.pageActive&&this.#y!==null&&(window.cancelAnimationFrame(this.#y),this.#y=null);let a=e.resources.scene.value,s=a?ee(e):null;this.#_=a,this.#A=s;let l=null,c=!!(this.#f&&this.#f.scene===a&&this.#f.context===s&&this.#f.generation===e.generation&&this.#f.contextGeneration===this.#$);if(!e.pageActive)this.#N(!0);else if(a!==null){let h=ee(e),m=a!==o||h!==i,u=this.#f,y=u&&u.context===h&&u.contextGeneration===this.#$&&de(u.scene,a)?Je(a,u.revision):null,x=!!(u&&!u.staging&&u.seed==="scene"&&u.frontierBytes<u.scene.total*8&&a!==u.scene&&y!==null);if(!!!(u&&!x&&a!==u.scene&&y!==null&&this.#ve(a,h,e,y))&&(!!(u&&!c)||m||a!==this.#o||h!==this.#w)){let C=this.#o!==null&&this.#w===h,A=C&&this.#o&&de(this.#o,a),O=!!(this.#o&&this.#E>=this.#o.total),L=!u&&A&&O?Je(a,this.#o?.revision??-1):null;this.#N(!1),this.#S==="webgl2"?A?L!==null?this.#K(a,h,e,!0,this.#o,!0,"copy",L):this.#K(a,h,e,!0,this.#o,!0):(this.#N(!0),this.#o=a,this.#w=h,l=this.#G(a,C&&!this.#x,n,C,t?t.workflow==="draw"?"top":t.view:null),this.#K(a,h,e,!1,n,!1)):(this.#o=a,this.#w=h,l=this.#G(a,C&&!this.#x,n,C,t?t.workflow==="draw"?"top":t.view:null))}}else(this.#o!==null||this.#f!==null)&&(this.#N(!0),this.#ee(),this.#o=null,this.#w=null,this.#R=0,this.#E=0);(!t||t.quality!==e.quality)&&(this.#V=Mt(e.quality),this.#L=0);let d=t?.workflow!=="draw"&&e.workflow==="draw",p=t?.workflow==="draw"&&e.workflow!=="draw";if(!t||t.view!==e.view||d||p){let h=e.workflow==="draw"?"top":e.view;this.#r=this.#j(h,e,l),this.#x=this.#Q(h,e,l)}e.workflow==="draw"&&t?.draw.zoomPercent!==e.draw.zoomPercent&&Math.round(this.#k/this.#r.distance*100)!==e.draw.zoomPercent&&(this.#r={...this.#r,orthographic:!0,pitch:Math.PI/2-.018,distance:this.#k*100/e.draw.zoomPercent},this.#x=e.draw.zoomPercent===100&&Math.abs(this.#r.targetX)<.001&&Math.abs(this.#r.targetZ)<.001&&Math.abs(W(this.#r.yaw))<.001),(l||d)&&this.#U(),this.requestRender()}setCirclePreview(e,t){this.#d=e&&t?{circles:e,capture:t}:null,this.requestRender()}#j(e,t,n=null){let o=e==="top",i=o?this.#k:this.#C,a=n?.[e]??t.cameras[e];return a?{yaw:a.yaw,pitch:o?Math.PI/2-.018:a.pitch,distance:S(i/S(a.zoom,.01,100),Math.max(.2,this.#b*.04),this.#b*8),targetX:S(a.targetX,-this.#b,this.#b),targetZ:S(a.targetZ,-this.#b,this.#b),orthographic:o}:o?{yaw:0,pitch:Math.PI/2-.018,distance:i,targetX:0,targetZ:0,orthographic:!0}:{yaw:-Math.PI/4,pitch:.82,distance:i,targetX:0,targetZ:0,orthographic:!1}}#Q(e,t,n=null){let o=n?.[e]??t.cameras[e];return nt(e,o)}#de(e,t){let n=this.#a;if(!n)throw new Error("webgl-unavailable");let o=n.createShader(e);if(!o)throw new Error("shader-unavailable");if(n.shaderSource(o,t),n.compileShader(o),!n.getShaderParameter(o,n.COMPILE_STATUS))throw n.deleteShader(o),new Error("shader-failed");return o}#he(){try{this.#a=this.#n.getContext("webgl2",{alpha:!0,antialias:!0,depth:!0,powerPreference:"high-performance"});let e=this.#a;if(!e)throw new Error("webgl2-unavailable");let t=this.#de(e.VERTEX_SHADER,`#version 300 es
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
      `),n=this.#de(e.FRAGMENT_SHADER,`#version 300 es
        precision highp float;
        in vec3 vColor;
        out vec4 outColor;
        void main() {
          vec2 point = gl_PointCoord * 2.0 - 1.0;
          if (dot(point, point) > 1.0) discard;
          float edge = smoothstep(1.0, 0.72, dot(point, point));
          outColor = vec4(pow(vColor, vec3(0.94)), edge);
        }
      `),o=e.createProgram();if(!o)throw new Error("program-unavailable");if(e.attachShader(o,t),e.attachShader(o,n),e.linkProgram(o),e.deleteShader(t),e.deleteShader(n),!e.getProgramParameter(o,e.LINK_STATUS))throw new Error("program-failed");if(this.#h=o,this.#v=e.getUniformLocation(o,"uViewProjection"),this.#z=e.getUniformLocation(o,"uCenter"),this.#B=e.getUniformLocation(o,"uMetersPerCell"),this.#P=e.getUniformLocation(o,"uPointPixels"),this.#g=e.getUniformLocation(o,"uMaxPointPixels"),this.#c=e.createBuffer(),this.#t=e.createVertexArray(),e.bindVertexArray(this.#t),!this.#c)throw new Error("buffer-unavailable");this.#J(this.#c),e.bindVertexArray(null),e.enable(e.DEPTH_TEST),e.depthFunc(e.LEQUAL),e.enable(e.BLEND),e.blendFunc(e.SRC_ALPHA,e.ONE_MINUS_SRC_ALPHA),this.#S="webgl2",this.#$+=1}catch{this.#Y(),this.#ne()}}#G(e,t=!1,n=null,o=!1,i=null){if(this.#oe(),!e)return this.#R=0,this.#E=0,this.requestRender(),null;let[a,s]=e.metadata.span,l=e.metadata.metersPerCell,c=a*l,d=s*l;this.#b=Math.max(1,Math.hypot(c,d)/2);let p={three:this.#C,top:this.#k};this.#ue(),t&&n?this.setCamera(Pt(this.#r,n,e),!1):this.fit(!1,i??void 0);let h=this.#u;if(o&&n&&h){let m={three:this.#C,top:this.#k},u=St(h.cameras,n,e,p,m),y=i??(h.workflow==="draw"?"top":h.view),x=y==="top"?this.#k:this.#C;return u[y]={yaw:this.#r.yaw,pitch:this.#r.pitch,zoom:x/Math.max(.2,this.#r.distance),targetX:this.#r.targetX,targetZ:this.#r.targetZ},this.#i.onCameraPreferences?.(u),this.#S!=="webgl2"&&this.#ie(e),u}return this.#S!=="webgl2"&&this.#ie(e),null}#ue(){let e=this.#o;if(!e)return;let[t,n]=e.metadata.span,o=e.metadata.metersPerCell,i=t*o,a=n*o,s=this.#W(),l=Math.max(.2,s.width/Math.max(1,s.height));this.#C=Tt(this.#b,l),this.#k=Math.max(a/2,i/(2*l))*1.12}#J(e){let t=this.#a;!t||!this.#t||(t.bindVertexArray(this.#t),t.bindBuffer(t.ARRAY_BUFFER,e),t.enableVertexAttribArray(0),t.vertexAttribIPointer(0,2,t.UNSIGNED_SHORT,8,0),t.enableVertexAttribArray(1),t.vertexAttribIPointer(1,1,t.UNSIGNED_BYTE,8,4),t.enableVertexAttribArray(2),t.vertexAttribPointer(2,3,t.UNSIGNED_BYTE,!0,8,5),t.bindVertexArray(null))}#ee(){this.#c&&this.#a&&this.#a.deleteBuffer(this.#c),this.#c=null}#N(e){let t=this.#f;t&&(this.#f=null,!t.staging&&e&&this.#c===t.buffer&&(this.#ee(),this.#o=null,this.#w=null,this.#R=0,this.#E=0))}#K(e,t,n,o,i,a,s="scene",l=[]){let c=this.#a;if(!c||this.#S!=="webgl2"||!n.pageActive||this.#D)return;let d=o?this.#p:this.#c;if(!d&&!o&&this.#p&&(d=this.#p,this.#p=null),!d)try{d=c.createBuffer()}catch{this.#Z();return}if(!d){this.#Z();return}if(o?this.#p=d:this.#c=d,!this.#ge(d,e.total*8,s==="scene")){this.#Z();return}o||this.#J(d),this.#f={scene:e,revision:e.revision,context:t,generation:n.generation,contextGeneration:this.#$,buffer:d,staging:o,seed:s,previousScene:i,preserveCamera:a,preferenceView:n.workflow==="draw"?"top":n.view,frontierBytes:0,dirtyBlocks:new Set(l),transitionBlocks:new Set(l)},o||(this.#E=0,this.#R=0),this.requestRender()}#ve(e,t,n,o){let i=this.#f;if(!i||i.context!==t||i.contextGeneration!==this.#$||!de(i.scene,e))return!1;let a=new Set(i.transitionBlocks);for(let s of o)a.add(s);if(a.size>it)return!1;i.scene=e,i.revision=e.revision,i.generation=n.generation,i.transitionBlocks.clear();for(let s of a)i.transitionBlocks.add(s);if(i.seed==="copy")for(let s of o)i.dirtyBlocks.add(s);else{let s=Math.ceil(i.frontierBytes/I);for(let l of o)l<s&&i.dirtyBlocks.add(l)}return this.requestRender(),!0}#ge(e,t,n){let o=this.#a;if(!o)return!1;let i=this.#M.get(e)??0;if(!n&&i>=t)return!0;try{return o.bindBuffer(o.ARRAY_BUFFER,e),o.bufferData(o.ARRAY_BUFFER,t,o.DYNAMIC_DRAW),this.#te()?!1:(this.#M.set(e,t),!0)}catch{return!1}}#te(){let e=this.#a;if(!e)return!0;try{let t=e.getError();return typeof t=="number"&&t!==e.NO_ERROR}catch{return!0}}#Z(){let e=this.#_,t=this.#A,n=this.#u,o=this.#o,i=this.#w;if(this.#N(!1),this.#Y(),this.#ne(),e&&t&&n?.pageActive){let a=o!==null&&i===t;this.#o=e,this.#w=t,this.#G(e,a&&!this.#x,o,a,n.workflow==="draw"?"top":n.view)}this.requestRender()}#pe(e,t){let n=this.#a,o=e.scene.total*8-e.frontierBytes,i=Math.min(o,t);if(!n||i<=0)return 0;if(e.seed==="copy"){if(!this.#c||this.#c===e.buffer)return-1;n.bindBuffer(n.COPY_READ_BUFFER,this.#c),n.bindBuffer(n.COPY_WRITE_BUFFER,e.buffer),n.copyBufferSubData(n.COPY_READ_BUFFER,n.COPY_WRITE_BUFFER,e.frontierBytes,e.frontierBytes,i)}else{let a=new Uint8Array(e.scene.buffer,e.scene.pointOffset+e.frontierBytes,i);n.bindBuffer(n.ARRAY_BUFFER,e.buffer),n.bufferSubData(n.ARRAY_BUFFER,e.frontierBytes,a)}return this.#te()?-1:(e.frontierBytes+=i,e.staging||(this.#E=e.frontierBytes/8),i)}#we(e,t){let n=this.#a;if(!n||t<=0)return 0;let o=e.scene.total*8,i=[...e.dirtyBlocks].sort((s,l)=>s-l),a=0;for(let s of i){let l=s*I,c=Math.min(o,l+I),d=c-l;if(c>e.frontierBytes||a+d>t)continue;let p=new Uint8Array(e.scene.buffer,e.scene.pointOffset+l,d);if(n.bindBuffer(n.ARRAY_BUFFER,e.buffer),n.bufferSubData(n.ARRAY_BUFFER,l,p),this.#te())return-1;e.dirtyBlocks.delete(s),a+=d}return a}#_e(){let e=this.#f,t=this.#a,n=this.#u;if(!e||!t||!n)return;if(this.#D||!n.pageActive||e.scene!==this.#_||e.revision!==e.scene.revision||e.context!==this.#A||e.generation!==n.generation||ee(n)!==e.context||n.resources.scene.value!==e.scene||e.contextGeneration!==this.#$||e.staging&&this.#p!==e.buffer||!e.staging&&this.#c!==e.buffer){this.#N(!0);return}let o=e.scene.total*8,i=e.frontierBytes<o,a=he,s=0;try{let l=i&&e.dirtyBlocks.size>0?Qe:he,c=this.#pe(e,Math.min(l,a));if(c<0)throw new Error("gpu-frontier-upload-failed");a-=c,s+=c;let d=[...e.dirtyBlocks].some(u=>Math.min(o,(u+1)*I)<=e.frontierBytes),p=i&&d?Math.min(Qe,a):d?a:0,h=this.#we(e,p);if(h<0)throw new Error("gpu-dirty-upload-failed");a-=h,s+=h;let m=[...e.dirtyBlocks].some(u=>Math.min(o,(u+1)*I)<=e.frontierBytes);if(i&&a>0&&!m){let u=this.#pe(e,a);if(u<0)throw new Error("gpu-frontier-upload-failed");a-=u,s+=u}}catch{this.#Z();return}if(s>0&&!this.#me(e)){this.#N(!0);return}if(e.frontierBytes<o||e.dirtyBlocks.size>0){this.requestRender();return}if(!this.#me(e)){this.#N(!0);return}if(e.staging){let l=this.#u,c=l?l.workflow==="draw"?"top":l.view:e.preferenceView,d=this.#c;this.#c=e.buffer,this.#p=d,this.#J(e.buffer),this.#o=e.scene,this.#w=e.context,this.#f=null,this.#E=e.scene.total,this.#R=e.scene.total;let p=this.#G(e.scene,e.preserveCamera,e.previousScene,!0,c);if(l&&p){let h=l.workflow==="draw"?"top":l.view;this.#r=this.#j(h,l,p),this.#x=this.#Q(h,l,p),this.#U()}}else this.#f=null,this.#o=e.scene,this.#w=e.context,this.#E=e.scene.total,this.#R=e.scene.total}#me(e){let t=this.#u;return t?!this.#D&&t.pageActive&&e.scene===this.#_&&e.revision===e.scene.revision&&e.context===this.#A&&e.generation===t.generation&&ee(t)===e.context&&t.resources.scene.value===e.scene&&e.contextGeneration===this.#$&&(e.staging?this.#p===e.buffer:this.#c===e.buffer):!1}#ne(){this.#S="canvas2d",this.#l=document.createElement("canvas"),this.#l.width=1024,this.#l.height=1024,this.#s=this.#l.getContext("2d",{alpha:!0}),this.#s?this.#o&&this.#ie(this.#o):(this.#S="unavailable",this.#i.onProblem?.("renderer-unavailable"))}#ie(e){let t=this.#s;if(!t||!this.#l)return;t.clearRect(0,0,this.#l.width,this.#l.height);let n=new DataView(e.buffer,e.pointOffset,e.total*8),o=Math.min(e.total,5e4),i=Math.max(1,Math.ceil(e.total/o)),a=0,s=0,l=()=>{if(this.#D||e!==this.#o||!this.#l)return;let c=Math.min(e.total,a+i*4e3);for(;a<c;a+=i){let d=a*8,p=n.getUint16(d,!0)/Math.max(1,e.metadata.span[0])*this.#l.width,h=n.getUint16(d+2,!0)/Math.max(1,e.metadata.span[1])*this.#l.height,m=n.getUint8(d+5),u=n.getUint8(d+6),y=n.getUint8(d+7);t.fillStyle=`rgb(${m} ${u} ${y})`,t.fillRect(p,h,1.5,1.5),s+=1}this.#R=s,this.requestRender(),a<e.total?this.#I=window.setTimeout(l,0):this.#I=null};l()}#oe(){this.#I!==null&&window.clearTimeout(this.#I),this.#I=null}#W(){let e=this.#n.getBoundingClientRect();return this.#X={width:e.width,height:e.height,left:e.left,top:e.top},this.#X}#xe(){let e=!1,t=this.#W(),n=Math.min(window.devicePixelRatio||1,3),o=Math.max(1,Math.round(t.width*n)),i=Math.max(1,Math.round(t.height*n));for(let a of[this.#n,this.#e])(a.width!==o||a.height!==i)&&(a.width=o,a.height=i,e=!0);e&&this.#i.onViewport?.()}#re(){let e=this.#X,t=Math.max(.2,e.width/Math.max(1,e.height)),n=Math.cos(this.#r.pitch)*this.#r.distance,o=[this.#r.targetX+Math.sin(this.#r.yaw)*n,Math.sin(this.#r.pitch)*this.#r.distance,this.#r.targetZ+Math.cos(this.#r.yaw)*n],i=[this.#r.targetX,0,this.#r.targetZ],a=Bt(o,i),s=this.#r.orthographic?zt(-this.#r.distance*t,this.#r.distance*t,-this.#r.distance,this.#r.distance,-this.#b*4,this.#b*4):Lt(ot,t,.02,Math.max(60,this.#b*12));return $t(s,a)}requestRender(){this.#y!==null||this.#D||this.#u?.pageActive===!1||(this.#y=window.requestAnimationFrame(()=>{this.#y=null,this.#Ce()}))}#Ce(){if(this.#D||this.#u?.pageActive===!1)return;let e=performance.now();this.#_e(),this.#xe(),this.#H=this.#re(),this.#S==="webgl2"?this.#ke():this.#Me(),this.#Se(),this.#T=performance.now()-e,this.#T>18?(this.#L+=1,this.#L>=3&&this.#u?.quality==="auto"&&(this.#V=Math.max(.25,this.#V*.75))):this.#L=Math.max(0,this.#L-1)}#ke(){let e=this.#a,t=this.#o;if(!e||(e.viewport(0,0,this.#n.width,this.#n.height),e.clearColor(0,0,0,0),e.clear(e.COLOR_BUFFER_BIT|e.DEPTH_BUFFER_BIT),!t||!this.#h||!this.#t))return;if(this.#u?.view==="top"&&this.#u.appearance==="rooms"){this.#R=0;return}e.useProgram(this.#h),e.bindVertexArray(this.#t),e.uniformMatrix4fv(this.#v,!1,this.#H),e.uniform2f(this.#z,(t.metadata.span[0]-1)/2,(t.metadata.span[1]-1)/2),e.uniform1f(this.#B,t.metadata.metersPerCell);let n=Math.min(window.devicePixelRatio||1,3),o=Math.max(1,Math.floor(t.total*this.#V)),i=Math.min(t.total,this.#E),a=Math.min(t.floorCount,o,i),s=Math.min(t.surfaceCount,Math.max(0,o-a),Math.max(0,i-t.floorCount));e.uniform1f(this.#P,this.#n.height*.038),e.uniform1f(this.#g,4.5*n),e.drawArrays(e.POINTS,0,a),e.uniform1f(this.#P,this.#n.height*.05),e.uniform1f(this.#g,7*n),e.drawArrays(e.POINTS,t.floorCount,s),e.bindVertexArray(null),this.#R=a+s}#Me(){}#Pe(e,t,n=0){let o=this.#o;return o?[-(e-(o.metadata.span[0]-1)/2)*o.metadata.metersPerCell,n*o.metadata.metersPerCell,(t-(o.metadata.span[1]-1)/2)*o.metadata.metersPerCell]:null}#ae(e,t,n=0,o=!0,i=this.#H){let a=this.#Pe(e,t,n);if(!a)return null;let[s,l,c]=a,d=(i[0]??0)*s+(i[4]??0)*l+(i[8]??0)*c+(i[12]??0),p=(i[1]??0)*s+(i[5]??0)*l+(i[9]??0)*c+(i[13]??0),h=(i[3]??0)*s+(i[7]??0)*l+(i[11]??0)*c+(i[15]??0);if(h<=.001)return null;let m=d/h,u=p/h;if(!Number.isFinite(m)||!Number.isFinite(u)||o&&(Math.abs(m)>1.15||Math.abs(u)>1.15))return null;let y=this.#X;return{x:(m*.5+.5)*y.width,y:(-u*.5+.5)*y.height}}#q(e,t,n=0,o=!0,i=this.#H){let a=this.#o;if(!a)return null;let s=e/a.metadata.metersPerCell-a.metadata.origin[0],l=t/a.metadata.metersPerCell-a.metadata.origin[1];return this.#ae(s,l,n,o,i)}#Se(){let e=this.#m,t=this.#o,n=this.#u;if(!e)return;let o=Math.min(window.devicePixelRatio||1,3),i=this.#X;if(e.setTransform(o,0,0,o,0,0),e.clearRect(0,0,i.width,i.height),!t||!n)return;let a=this.#se;if(this.#S==="canvas2d"&&this.#l&&!(n.view==="top"&&n.appearance==="rooms")){let h=this.#k/this.#r.distance,m=i.width*h,u=i.height*h,y=(i.width-m)/2-this.#r.targetX*32*h,x=(i.height-u)/2-this.#r.targetZ*32*h;e.drawImage(this.#l,y,x,m,u)}let s=this.#Ee(n);if(n.labelsVisible||n.view==="top"&&n.appearance==="rooms"){e.lineWidth=1.5,e.font="600 12px system-ui, sans-serif",e.textAlign="center",e.textBaseline="middle";let h=[];for(let m of t.metadata.rooms){let u=s.has(m.name.toLocaleLowerCase());e.strokeStyle=u?P(a.accent,1):P(a.quiet,.7),e.fillStyle=u?P(a.accent,.26):n.view==="top"&&n.appearance==="rooms"?P(a.roomFill,.94):P(a.plate,.04),e.beginPath();let y=Math.max(1,Math.ceil(m.boundary.length/512)),x=!1;for(let A=0;A<m.boundary.length;A+=y){let O=m.boundary[A];if(!O)continue;let L=this.#ae(O[0],O[1],.2,!1);L&&(x?e.lineTo(L.x,L.y):e.moveTo(L.x,L.y),x=!0)}if(x&&(e.closePath(),e.fill(),e.stroke()),!n.labelsVisible)continue;let R=this.#ae(m.center[0],m.center[1],1);if(!R)continue;let N=e.measureText(m.name).width,C=new DOMRect(R.x-N/2-6,R.y-10,N+12,20);h.some(A=>C.left<A.right+8&&C.right+8>A.left&&C.top<A.bottom+4&&C.bottom+4>A.top)||(h.push(C),e.fillStyle=P(a.plate,.88),e.fillRect(C.x,C.y,C.width,C.height),e.fillStyle=P(a.text,1),e.fillText(m.name,R.x,R.y))}}let l=this.#d,c=l&&k(n,l.capture)?l.circles:n.draw.circles;if((n.workflow==="draw"||n.workflow==="areaReview")&&c.length)if(e.fillStyle=P(a.accent,.22),e.strokeStyle=P(a.accent,.92),e.lineWidth=1.5,n.draw.outline?.closed){e.beginPath();for(let h of c)this.#fe(e,h,!1);e.fill()}else for(let h of c)this.#fe(e,h);let d=n.draw.outline;if(d&&(n.workflow==="draw"||n.workflow==="areaReview")&&!(n.workflow==="draw"&&n.draw.tool==="outline")&&(e.beginPath(),d.points.forEach((h,m)=>{let u=this.#q(h.x,h.y,0,!1);u&&(m===0?e.moveTo(u.x,u.y):e.lineTo(u.x,u.y))}),d.closed&&e.closePath(),e.strokeStyle=P(a.accent,1),e.lineWidth=2,e.stroke()),this.#F&&n.workflow==="draw"&&(n.draw.tool==="paint"||n.draw.tool==="erase")){let h=this.#q(this.#F.x,this.#F.y),m=this.#q(this.#F.x+n.draw.brushMeters/2,this.#F.y);h&&m&&(e.beginPath(),e.arc(h.x,h.y,Math.max(2,Math.hypot(m.x-h.x,m.y-h.y)),0,Math.PI*2),e.strokeStyle=P(a.accent,1),e.lineWidth=2,e.stroke())}let p=n.resources.pose.value;if(G(n)&&p?.position){let h=this.#q(p.position[0],p.position[1],3);h&&(e.beginPath(),e.arc(h.x,h.y,7,0,Math.PI*2),e.fillStyle=P(a.accent,1),e.fill(),e.strokeStyle=P(a.onAccent,1),e.lineWidth=3,e.stroke())}}#Ee(e){let t=e.resources.plans.value?.rooms||e.resources.areas.value?.rooms||[],n=new Set(e.workflow==="plan"?e.planDraft.rooms.map(i=>i.roomId):e.selection.roomIds),o=new Set;for(let i of t)n.has(i.roomId)&&o.add(i.name.toLocaleLowerCase());return o}#fe(e,t,n=!0){let o=this.#q(t.x,t.y),i=this.#q(t.x+t.radius,t.y);if(!o||!i)return;let a=Math.max(1,Math.hypot(i.x-o.x,i.y-o.y));n&&e.beginPath(),e.moveTo(o.x+a,o.y),e.arc(o.x,o.y,a,0,Math.PI*2),n&&(e.fill(),e.stroke())}setPalette(e){this.#se=e,this.requestRender()}setCursor(e){this.#F=e,this.requestRender()}mapToScreen(e){if(!this.#o)return null;let t=this.#W();return!t.width||!t.height?null:this.#q(e.x,e.y,0,!1,this.#re())}offsetMapPoint(e,t,n){let o=this.mapToScreen(e);if(!o)return null;let i=this.#X,a=this.#r.distance*2/i.height;return this.screenToMap(i.left+o.x+t/a,i.top+o.y+n/a)}screenToMap(e,t){let n=this.#o;if(!n)return null;let o=this.#W();if(!o.width||!o.height)return null;let i=this.#re(),a=(e-o.left)/o.width*2-1,s=1-(t-o.top)/o.height*2,l=i[0]-a*i[3],c=i[8]-a*i[11],d=i[1]-s*i[3],p=i[9]-s*i[11],h=l*p-c*d;if(!Number.isFinite(h)||Math.abs(h)<1e-12)return null;let m=a*i[15]-i[12],u=s*i[15]-i[13],y=(m*p-c*u)/h,x=(l*u-m*d)/h;if(i[3]*y+i[11]*x+i[15]<=0)return null;let R=-y/n.metadata.metersPerCell+(n.metadata.span[0]-1)/2,N=x/n.metadata.metersPerCell+(n.metadata.span[1]-1)/2;return{x:(R+n.metadata.origin[0])*n.metadata.metersPerCell,y:(N+n.metadata.origin[1])*n.metadata.metersPerCell}}roomAt(e,t){let n=this.screenToMap(e,t),o=this.#o,i=this.#u;if(!n||!o||!i)return null;let a=n.x/o.metadata.metersPerCell-o.metadata.origin[0],s=n.y/o.metadata.metersPerCell-o.metadata.origin[1],l=o.metadata.rooms.find(c=>et(a,s,c.boundary));return l?this.#Ae(l,i):null}containsMapPoint(e){let t=this.#o;if(!t)return!1;let n=e.x/t.metadata.metersPerCell-t.metadata.origin[0],o=e.y/t.metadata.metersPerCell-t.metadata.origin[1];return t.metadata.rooms.some(i=>et(n,o,i.boundary))}#Ae(e,t){return(t.resources.plans.value?.rooms||t.resources.areas.value?.rooms||[]).find(o=>o.name.localeCompare(e.name,void 0,{sensitivity:"base"})===0)?.roomId||e.id}selectRoomAt(e,t){let n=this.roomAt(e,t);n&&this.#i.onRoom?.(n)}fit(e=!0,t=this.#u?.workflow==="draw"?"top":this.#u?.view??"three"){let n=t==="top";this.#r=n?{yaw:0,pitch:Math.PI/2-.018,distance:this.#k,targetX:0,targetZ:0,orthographic:!0}:{yaw:-Math.PI/4,pitch:.82,distance:this.#C,targetX:0,targetZ:0,orthographic:!1},this.#x=!0,this.requestRender(),e&&this.#U()}zoomAt(e,t,n){let o=t===void 0||n===void 0?null:this.screenToMap(t,n),i=this.#le();if(this.#r={...this.#r,distance:S(this.#r.distance/e,i.minimum,i.maximum)},this.#x=!1,o&&t!==void 0&&n!==void 0){let a=this.screenToMap(t,n);a&&(this.#r={...this.#r,targetX:this.#r.targetX-(o.x-a.x),targetZ:this.#r.targetZ+(o.y-a.y)})}this.requestRender(),this.#U(t,n)}panBy(e,t){this.setCamera(this.cameraAfterPan(this.#r,e,t))}orbitBy(e,t){if(this.#r.orthographic){this.panBy(e,t);return}this.#r={...this.#r,yaw:W(this.#r.yaw+e*.006),pitch:S(this.#r.pitch-t*.004,.18,1.38)},this.#x=!1,this.requestRender(),this.#U()}rotateBy(e){this.#r={...this.#r,yaw:W(this.#r.yaw+e)},this.#x=!1,this.requestRender(),this.#U()}#U(e,t){let n=this.#r.orthographic?this.#k:this.#C,o=e===void 0||t===void 0?this.#X:this.#W(),i=e===void 0||t===void 0||!o.width||!o.height?void 0:{xPercent:S((e-o.left)/o.width*100,0,100),yPercent:S((t-o.top)/o.height*100,0,100)};this.#i.onCamera?.(this.camera,Math.round(n/this.#r.distance*100),i)}diagnostics(){return{mode:this.#S,contextGeneration:this.#$,sceneRevision:this.#o?.revision??null,sourcePoints:this.#o?.total??0,renderedPoints:this.#R,lastFrameMs:Math.round(this.#T*100)/100,slowFrames:this.#L,cameraDistance:this.#r.distance,fitDistance:this.#r.orthographic?this.#k:this.#C,fitActive:this.#x}}#ye=e=>{e.preventDefault(),this.#Y(),this.#ne(),this.requestRender()};#be=()=>{let e=this.#o,t=this.#w;this.#oe(),this.#Y(),this.#he();let n=this.#_,o=this.#A,i=this.#u;if(this.#S==="webgl2"&&n&&o&&i?.pageActive){let a=e!==null&&t===o;this.#ee(),this.#o=n,this.#w=o;let s=null;if(n!==e&&(s=this.#G(n,a&&!this.#x,e,a,i.workflow==="draw"?"top":i.view)),this.#K(n,o,i,!1,e,a&&!this.#x),s){let l=i.workflow==="draw"?"top":i.view;this.#r=this.#j(l,i,s),this.#x=this.#Q(l,i,s),this.#U()}}this.requestRender()};#Y(){this.#N(!1);let e=this.#a;e&&(this.#c&&e.deleteBuffer(this.#c),this.#p&&e.deleteBuffer(this.#p),this.#t&&e.deleteVertexArray(this.#t),this.#h&&e.deleteProgram(this.#h)),this.#c=null,this.#p=null,this.#t=null,this.#h=null,this.#a=null}dispose(){this.#D||(this.#D=!0,this.#O.disconnect(),this.#n.removeEventListener("webglcontextlost",this.#ye),this.#n.removeEventListener("webglcontextrestored",this.#be),this.#y!==null&&window.cancelAnimationFrame(this.#y),this.#y=null,this.#oe(),this.#Y(),this.#l=null,this.#s=null,this.#m=null,this.#d=null,this.#o=null,this.#u=null,this.#_=null,this.#A=null)}};var It="matic-workspace-intent",Ft="matic-workspace-action",rt="navigation-help",at=(r,e)=>{let t=(o,i,a)=>ae(e,o,i,a);if(r.dataMode==="history"||r.floor.readOnly)return r.map.available?t("v4_saved_map_description","Saved read-only map for {floor}. Live robot position is hidden.",{floor:r.floor.displayName}):r.resources.scene.status==="loading"?t("v4_saved_map_loading_description","The saved map is loading."):t("v4_saved_map_unavailable_description","This saved map is unavailable.");if(!oe(r))return t("v4_private_map_unavailable","The current private map is not available.");let n=G(r)?t("v4_robot_position_verified","The robot position is verified."):t("v4_robot_position_hidden","The robot position is not shown.");return t("v4_live_map_description","Live map for {floor}. {pose}",{floor:r.floor.displayName,pose:n})},ue=class extends ye{constructor(){super();this.state=pe();this.narrow=!1;this.#n=null;this.#e=null;this.#i=null;this.#a=!1;this.#m=!1;this.#s=null;this.#l=[];this.#h=null;this.#c=null;this.#p={capture:!0,handleEvent:t=>{t.pointerType==="touch"&&!t.isPrimary&&this.#M.cancel()}};this.#M=new V(()=>this.state,()=>this.#e,t=>this.#o(t),()=>this.requestUpdate(),(t,n)=>this.#t(t,n),t=>{this.updateComplete.then(()=>{(this.renderRoot.querySelector(`[data-zone-index="${t}"]`)??this.renderRoot.querySelector(".map-root"))?.focus({preventScroll:!0})})});this.#g=()=>{this.#B()};new X(this,{container:()=>this.renderRoot?.querySelector(".camera-steps")??null,items:"button"}),new X(this,{container:()=>this.renderRoot?.querySelector(".draw-tools")??null,items:"button"})}static{this.properties={state:{attribute:!1},localize:{attribute:!1},narrow:{type:Boolean,reflect:!0}}}static{this.styles=[be,ve,ge,fe`
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
  `]}#n;#e;#i;#a;#m;#s;#l;#h;#c;#p;#M;#t(t,n,o){return ae(this.localize,t,n,o)}connectedCallback(){super.connectedCallback(),this.#u(),this.updateComplete.then(()=>this.#v())}firstUpdated(){this.#v()}#v(){if(!this.isConnected||this.#e||this.#i)return;let t=this.renderRoot.querySelector(".map-root"),n=this.renderRoot.querySelector(".scene-canvas"),o=this.renderRoot.querySelector(".overlay-canvas");!t||!n||!o||(this.#e=new te(n,o,{onViewport:()=>{this.#M.cancel(),this.requestUpdate()},onCamera:(i,a,s)=>{this.#o({type:"set-camera",view:this.state.workflow==="draw"?"top":this.state.view,camera:{yaw:i.yaw,pitch:i.pitch,zoom:a/100,targetX:i.targetX,targetZ:i.targetZ}}),this.state.workflow==="draw"&&a!==this.state.draw.zoomPercent&&this.#o({type:"set-zoom",value:a,...s?{originX:s.xPercent,originY:s.yPercent}:{}})},onCameraPreferences:i=>{for(let a of["top","three"]){let s=i[a];s&&this.#o({type:"set-camera",view:a,camera:s})}},onRoom:i=>this.#o({type:"toggle-room",roomId:i}),onProblem:()=>this.#w("renderer-problem")}),this.#i=new K(t,this.#e,{state:()=>this.state,onOutlinePoint:(i,a)=>this.#M.addPoint(i,a),onCircles:(i,a)=>this.#o({type:"set-draft-circles",circles:i,coordinateEdit:a}),onCirclePreview:(i,a)=>this.#e?.setCirclePreview(i,a),onRoom:i=>this.#o({type:"toggle-room",roomId:i})}),this.#e.setState(this.state),this.#B())}disconnectedCallback(){this.#d(),this.#P(),this.#M.cancel(),this.#i?.dispose(),this.#i=null,this.#e?.dispose(),this.#e=null,super.disconnectedCallback()}updated(t){this.#m&&(this.#m=!1,this.renderRoot.querySelector(".navigation-help button")?.focus()),t.has("state")&&(this.#i?.observeState(this.state),this.#M.observeState(this.state),this.#e?.setState(this.state))}#z(){let t=this.renderRoot?.querySelector(".map-root");!t||!this.#e||this.#e.setPalette(Ne(t))}#B(){this.#P(),this.#h=window.requestAnimationFrame(()=>{this.#h=null,this.#c=window.setTimeout(()=>{this.#c=null,this.#z()},0)})}#P(){this.#h!==null&&window.cancelAnimationFrame(this.#h),this.#c!==null&&window.clearTimeout(this.#c),this.#h=null,this.#c=null}#g;#u(){if(!(typeof document>"u"||this.#s)&&(this.#s=new MutationObserver(this.#g),this.#s.observe(document.documentElement,{attributes:!0,attributeFilter:["style","class"]}),typeof window.matchMedia=="function")){this.#l=[window.matchMedia("(prefers-color-scheme: dark)"),window.matchMedia("(forced-colors: active)")];for(let t of this.#l)t.addEventListener("change",this.#g)}}#d(){this.#P(),this.#s?.disconnect(),this.#s=null;for(let t of this.#l)t.removeEventListener("change",this.#g);this.#l=[]}#o(t){this.dispatchEvent(new CustomEvent(It,{detail:t,bubbles:!0,composed:!0}))}#w(t){this.dispatchEvent(new CustomEvent(Ft,{detail:{id:t},bubbles:!0,composed:!0}))}#_(t){this.#n=t.currentTarget,this.#a=!this.#a,this.#m=this.#a,this.requestUpdate()}#A(){if(!this.#a)return;this.#a=!1,this.requestUpdate();let t=this.#n;t?.isConnected&&t.focus()}#f(){this.#o({type:"clear-selection"})}#y(t,n){this.#e?.orbitBy(t,n)}#I(t){if(!qe(t)&&!(t.ctrlKey||t.metaKey||t.altKey)&&t.key==="Escape"){if(t.preventDefault(),this.#a){this.#A();return}this.#o({type:"dismiss-top-layer"});return}}rendererDiagnostics(){return this.#e?.diagnostics()??null}canvasIdentity(){return{scene:this.renderRoot.querySelector(".scene-canvas"),overlay:this.renderRoot.querySelector(".overlay-canvas")}}#O(){return this.state.host.connected?this.state.host.administrator?this.state.host.robotCount===0?{title:this.#t("v4_no_robot","No Matic robot set up"),detail:this.#t("v4_no_robot_detail","Set up a robot before opening its map.")}:this.state.dataMode==="live"&&this.state.floor.readOnly&&this.state.map.available&&this.state.notice?{title:this.#t("v4_saved_map_read_only_title","Saved map is read only"),detail:this.state.notice.text}:this.state.dataMode==="history"?!this.state.map.available&&this.state.resources.scene.status==="loading"?{title:this.#t("v4_loading_saved_map","Loading saved map"),detail:this.#t("v4_loading_saved_map_detail","This read-only snapshot is still preparing.")}:this.state.map.available?null:{title:this.#t("v4_saved_map_unavailable","Saved map unavailable"),detail:this.#t("v4_saved_map_unavailable_detail","Choose another snapshot or return to the live map.")}:this.state.host.robotConnected?this.state.coherence==="verifying"||this.state.coherence==="booting"?{title:this.#t("v4_locating_map","Locating the current map"),detail:this.#t("v4_locating_map_detail","Map controls will return after the floor is verified.")}:!this.state.map.available&&this.state.resources.scene.status==="loading"?{title:this.#t("v4_loading_verified_map","Loading the verified map"),detail:this.#t("v4_loading_verified_map_detail","The current floor is verified. The private scene is still preparing.")}:this.state.map.available?this.state.activity==="problem"?{title:this.#t("v4_robot_attention","Robot needs attention"),detail:this.#t("v4_robot_attention_detail","Check the robot before starting another task.")}:null:{title:this.#t("v4_map_unavailable","Map unavailable"),detail:this.#t("v4_map_unavailable_detail","The private scene is not ready. No map data is shown until it is verified.")}:{title:this.#t("v4_robot_offline","Robot offline"),detail:this.#t("v4_robot_offline_detail","The last verified map stays read only and has no live position.")}:{title:this.#t("v4_admin_required","Administrator access required"),detail:this.#t("v4_private_map_hidden","Private map data is hidden.")}:{title:this.#t("v4_reconnecting","Reconnecting"),detail:this.#t("v4_reconnecting_detail","The verified map is read only until Home Assistant reconnects.")}}#r(t,n){let o=this.state,i=this.narrow,a=o.workflow==="draw",s=this.#t("v4_how_to_move","How to move the map"),l=t&&!a,c=l&&!i&&o.view==="top",d=l&&o.view==="three",p=!n,h=!i&&!a;return b`
      <div class="map-rail" data-map-control>
        <div class="map-context"><slot name="floor"></slot>
        ${l?b`
          <div class="view-switch ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#t("map_view_label","Map view")}>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(o.view==="three")}
              @click=${()=>this.#o({type:"set-view",view:"three"})}
            >${this.#t("map_view_3d","3D")}</button>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(o.view==="top")}
              @click=${()=>this.#o({type:"set-view",view:"top"})}
            >${this.#t("map_view_top","2D")}</button>
          </div>
        `:v}

        </div>
        ${c?b`
          <div class="appearance-switch ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#t("map_style_label","Map style")}>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(o.appearance==="photo")}
              @click=${()=>this.#o({type:"set-appearance",appearance:"photo"})}
            >${this.#t("map_style_photo","Photo")}</button>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(o.appearance==="rooms")}
              @click=${()=>this.#o({type:"set-appearance",appearance:"rooms"})}
            >${this.#t("map_style_room_colours","Floor plan")}</button>
          </div>
        `:v}

        ${d?b`
          <div class="camera-steps ms-surface ms-surface--floating ms-segment" role="toolbar" aria-orientation="horizontal" aria-label=${this.#t("map_camera_controls","Map camera controls")}>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#t("map_rotate_left","Rotate left")} aria-keyshortcuts="[" @click=${()=>this.#y(-52,0)}>${E(Me)}</button>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#t("map_tilt_down","Lower viewing angle")} aria-keyshortcuts="PageDown" @click=${()=>this.#y(0,30)}>${E(_e)}</button>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#t("map_tilt_up","Raise viewing angle")} aria-keyshortcuts="PageUp" @click=${()=>this.#y(0,-30)}>${E(we)}</button>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#t("map_rotate_right","Rotate right")} aria-keyshortcuts="]" @click=${()=>this.#y(52,0)}>${E(Pe)}</button>
          </div>
        `:v}

        ${p?b`
          <div class="map-tools ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#t("v4_map_tools","Map tools")}>
            ${n?v:b`
              <button
                class="fit ms-btn"
                type="button"
                aria-label=${this.#t("v4_fit_map_hint","Fit the whole map on screen")}
                @click=${()=>{this.#e?.fit(),this.#o({type:"fit-map"})}}
                title=${this.#t("v4_fit_map","Fit map")}
              >${E(xe)}<span class="ms-btn__label">${this.#t("v4_fit_map","Fit map")}</span></button>
            `}
          </div>
        `:v}
        ${!n&&h?b`
          <div class="map-extras ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#t("v4_map_display","Map display")}>
              <button
                class="labels ms-btn"
                type="button"
                aria-pressed=${String(o.labelsVisible)}
                @click=${()=>this.#o({type:"toggle-labels"})}
                title=${this.#t("v4_room_names","Room names")}
              >${E(Ce)}<span class="ms-btn__label">${this.#t("v4_room_names","Room names")}</span></button>
              <button
                class="help ms-btn ms-btn--icon"
                type="button"
                aria-label=${s}
                aria-expanded=${String(this.#a)}
                aria-controls=${rt}
                @click=${this.#_}
                title=${s}
              >${E(ke)}</button>
          </div>
        `:v}

        ${this.#a&&t&&h?b`
          <div
            id=${rt}
            class="navigation-help ms-surface ms-surface--floating"
            role="dialog"
            aria-modal="false"
            aria-label=${s}
          >
            <header>
              <h3>${s}</h3>
              <button class="ms-btn ms-btn--sm" type="button" @click=${()=>this.#A()}>${this.#t("v4_close","Close")}</button>
            </header>
            <dl>
              <dt>${this.#t("v4_trackpad","Trackpad")}</dt>
              <dd>${this.#t("v4_trackpad_help","Scroll to pan \xB7 pinch to zoom \xB7 twist to rotate")}</dd>
              <dt>${this.#t("v4_mouse","Mouse")}</dt>
              <dd>${this.#t("v4_mouse_help","Drag to orbit \xB7 Shift, middle, or right drag to pan \xB7 wheel to zoom")}</dd>
              <dt>${this.#t("v4_keyboard","Keyboard")}</dt>
              <dd>${this.#t("v4_keyboard_help","WASD to move \xB7 Q/E or arrows to orbit \xB7 +/\u2212 to zoom \xB7 0 to fit")}</dd>
            </dl>
          </div>
        `:v}
      </div>
    `}#C(t){let n=this.state;if(!t)return v;if(n.workflow==="draw"&&!this.narrow)return b`
        <div class="map-dock ms-surface ms-surface--floating" data-map-control>
          ${Ie(n,{intent:i=>this.#o(i),openBrush:()=>this.#o({type:"set-precision-open",value:!n.precisionOpen}),t:(i,a)=>this.#t(i,a)},"row")}
        </div>
      `;let o=n.selection.roomIds.length;return n.workflow==="rooms"&&o>0&&!this.narrow?b`
        <div class="map-dock ms-surface ms-surface--floating" data-map-control>
          <div class="selection-chip ms-surface ms-surface--floating" data-map-control>
            <span>${this.#t("v4_rooms_selected","Rooms selected: {count}").replace("{count}",String(o))}</span>
            <button class="ms-btn ms-btn--sm" type="button" @click=${()=>this.#f()}>${this.#t("v4_clear","Clear")}</button>
          </div>
        </div>
      `:v}render(){let t=this.state,n=me(t),o=this.#O(),i=t.map.available&&(oe(t)||t.dataMode==="history"),a=t.workflow==="draw"&&i,s=t.coherence==="verifying"||t.coherence==="booting";return b`
      <section
        class="map-root"
        tabindex="0"
        aria-label=${this.#t("map_viewport_aria","Interactive Matic 3D map")}
        aria-describedby=${a?t.draw.tool==="outline"?"zone-keyboard-help":"keyboard-draw-help":v}
        data-full-map=${String(t.fullMap)}
        data-workflow=${t.workflow}
        data-draw-tool=${t.draw.tool}
        data-narrow=${this.narrow?"true":v}
        @keydown=${this.#I}
        @pointerdown=${this.#p}
      >
        ${this.#r(i,s)}
        <slot name="scrim"></slot>

        <div
          class="scene-window"
          data-renderer-key="persistent-canvas-v4"
          ?hidden=${!i}
          role=${a?"group":"img"}
          aria-label=${at(t,this.localize)}
        >
          ${a?b`<span class="keyboard-aim" aria-hidden="true"></span>`:v}
          <canvas class="scene-canvas"></canvas>
          <canvas class="overlay-canvas"></canvas>
          ${a?this.#M.render():v}
        </div>

        ${a?b`
          <p id="zone-keyboard-help" class="sr-only">${this.#t("v4_zone_keyboard_help","Focus the map, aim with arrow keys, and press Enter to place points. The edges join automatically after three points. Keep adding points or Tab to a point; arrows move it, Delete removes it, and Escape cancels a drag.")}</p>
          <p id="keyboard-draw-help" class="sr-only">${this.#t("v4_keyboard_draw_help","Keyboard: focus the map, use arrow keys to aim, then Enter to paint or erase at the crosshair. D selects Paint; E selects Erase.")}</p>
          <div class="map-scale" aria-label=${`Scale ${n.label}`}>
            <span class="scale-line" style=${`--scale-width:${n.pixels}px`}></span>
            <span>${n.label}</span>
          </div>
        `:v}

        ${this.#C(i)}

        ${o&&!(t.fullMap&&(s||!t.host.administrator))?b`
          <div class="map-message ms-surface ms-surface--floating" role="status">
            <strong>${o.title}</strong>
            <span>${o.detail}</span>
          </div>
        `:v}
        <div class="sr-only" aria-live="polite" aria-atomic="true">
          ${at(t,this.localize)}
        </div>
      </section>
    `}};customElements.get(se)||customElements.define(se,ue);export{se as a,Dt as b,Nt as c,Ot as d,Ut as e,on as f,rn as g,an as h,pt as i,sn as j,ln as k,cn as l,We as m,f as n,dn as o,hn as p,un as q,pn as r,mn as s,fn as t,yn as u,bn as v,Ie as w,qe as x,X as y,It as z,Ft as A};
