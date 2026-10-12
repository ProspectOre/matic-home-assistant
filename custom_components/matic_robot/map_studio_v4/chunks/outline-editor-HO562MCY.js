import{a as y,b as g}from"./chunk-L62ENE4N.js";import{K as c,O as p,y as d,z as u}from"./chunk-SPPO3SA7.js";var v=class{constructor(t,e,n,o,i,l){this.state=t;this.renderer=e;this.intent=n;this.update=o;this.t=i;this.focusPoint=l}#t=null;#o="";#e=null;#i(t=this.state()){return d(t,"outline")!==null}#n(t,e){let n=e??d(this.state(),"outline");if(!u(this.state(),n))return;if(!y(t)){this.#o=this.t("v4_zone_invalid","Keep the outline from crossing itself."),this.update();return}let o=g(t,i=>this.renderer()?.containsMapPoint(i)??!1);this.#o=t.closed&&!o.length?this.t("v4_zone_empty","Make the outline wider and keep it on the mapped floor."):"",this.intent({type:"set-draft-circles",circles:o,outline:t,coordinateEdit:n})}addPoint(t,e){let n=e??d(this.state(),"outline");if(!u(this.state(),n)||n.tool!=="outline"||!this.renderer()?.containsMapPoint(t))return;let o=this.state().draw.outline??{points:[],closed:!1};if(o.points.length>=64)return;let i=[...o.points,t];this.#n({points:i,closed:i.length>=3},n)}#r(t){let e=this.state().draw.outline;if(!e)return;this.#e=null;let n=e.points.filter((o,i)=>i!==t);this.#n({points:n,closed:e.closed&&n.length>=3}),this.focusPoint(Math.min(t,n.length-1))}#s(t){let e=this.state().draw.outline;if(!e||e.points.length>=64)return;let n=e.points[t],o=e.points[(t+1)%e.points.length];if(!n||!o||!e.closed&&t===e.points.length-1)return;let i={x:(n.x+o.x)/2,y:(n.y+o.y)/2};this.#n({...e,points:[...e.points.slice(0,t+1),i,...e.points.slice(t+1)]}),this.focusPoint(t+1)}#a(t,e){if(t.button!==0||this.#t||t.pointerType==="touch"&&!t.isPrimary)return;let n=d(this.state(),"outline");if(!n)return;this.#e=e,this.update();let o=this.state().draw.outline;if(!o)return;t.stopPropagation(),t.preventDefault();let i=t.currentTarget;i.focus({preventScroll:!0}),i.setPointerCapture(t.pointerId),this.#t={index:e,pointer:t.pointerId,baseline:o,preview:o,target:i,capture:n}}observeState(t){this.#t&&!u(t,this.#t.capture)&&this.cancel()}#l(t){let e=this.#t;if(!e||e.pointer!==t.pointerId)return;if(t.stopPropagation(),t.preventDefault(),!u(this.state(),e.capture)){this.cancel();return}let n=this.renderer()?.screenToMap(t.clientX,t.clientY);!n||!this.renderer()?.containsMapPoint(n)||(e.preview={...e.baseline,points:e.baseline.points.map((o,i)=>i===e.index?n:o)},this.update())}#p(t){let e=this.#t;!e||e.pointer!==t.pointerId||(t.stopPropagation(),t.preventDefault(),this.#t=null,e.target.releasePointerCapture(t.pointerId),e.preview!==e.baseline&&this.#n(e.preview,e.capture),this.update())}cancel(){let t=this.#t;t&&(this.#t=null,t.target.hasPointerCapture(t.pointer)&&t.target.releasePointerCapture(t.pointer),this.update())}#c(t,e){if(t.ctrlKey||t.altKey||t.metaKey)return;if(t.key==="Escape"){t.stopPropagation(),this.cancel();return}let n=this.state().draw.outline;if(!n||!this.#i())return;if(t.key==="Delete"||t.key==="Backspace"){t.preventDefault(),t.stopPropagation(),this.#r(e);return}let o=t.shiftKey?.1:.02,i=t.key==="ArrowLeft"?-o:t.key==="ArrowRight"?o:0,l=t.key==="ArrowUp"?-o:t.key==="ArrowDown"?o:0;if(!i&&!l)return;t.preventDefault(),t.stopPropagation();let s=n.points[e],r=this.renderer()?.offsetMapPoint(s,i,l);r&&this.renderer()?.containsMapPoint(r)&&this.#n({...n,points:n.points.map((a,h)=>h===e?r:a)})}render(){if(!this.#i())return p;let t=this.#t?.preview??this.state().draw.outline,e=t?.points??[],n=e.map(s=>this.renderer()?.mapToScreen(s)),o=n.map((s,r)=>s?`${r?"L":"M"}${s.x},${s.y}`:"").join(" "),i=!t||y(t),l=this.#e!==null&&this.#e<e.length?this.#e:null;return c`
      <div class="zone-overlay">
        <svg aria-hidden="true"><path d=${o+(t?.closed?" Z":"")} class=${i?"":"invalid"} fill=${t?.closed?"var(--ms-accent)":"none"}></path></svg>
        ${n.map((s,r)=>s?c`
          <button class="zone-point" type="button" data-zone-index=${r} data-selected=${String(this.#e===r)} data-map-control style=${`left:${s.x}px;top:${s.y}px`}
            aria-label=${this.t("v4_zone_point_number","Point {number}",{number:r+1})} aria-describedby="zone-handle-help"
            title=${this.t("v4_zone_point_help","Drag to move. Arrow keys adjust; Delete removes.")}
            @pointerdown=${a=>this.#a(a,r)} @pointermove=${a=>this.#l(a)}
            @pointerup=${a=>this.#p(a)} @pointercancel=${()=>this.cancel()}
            @lostpointercapture=${()=>{this.#t&&this.cancel()}}
            @focus=${()=>{this.#e=r,this.update()}}
            @keydown=${a=>this.#c(a,r)}
          >${r+1}</button>
        `:p)}
        ${e.map((s,r)=>{let a=e[(r+1)%e.length];if(!a||!t?.closed&&r===e.length-1||e.length>=64)return p;let h={x:(s.x+a.x)/2,y:(s.y+a.y)/2},m=this.renderer()?.mapToScreen(h),f=n[r],b=n[(r+1)%n.length];return m&&f&&b&&Math.hypot(f.x-b.x,f.y-b.y)>=100?c`<button class="zone-point zone-midpoint" type="button" data-map-control
            style=${`left:${m.x}px;top:${m.y}px`} aria-label=${this.t("v4_zone_add_point_after","Add point after {number}",{number:r+1})}
            @click=${()=>this.#s(r)}>+</button>`:p})}
        <div class="zone-help" data-map-control>
          <span id="zone-handle-help" class="sr-only">${this.t("v4_zone_point_help","Drag to move. Arrow keys adjust; Delete removes.")}</span>
          ${l!==null?c`
            <div class="zone-point-actions ms-surface" role="group" aria-label=${this.t("v4_zone_point_number","Point {number}",{number:l+1})}>
              <span class="zone-selection">${this.t("v4_zone_point_number","Point {number}",{number:l+1})}</span>
              <button class="ms-btn" type="button" ?disabled=${e.length>=64||!t?.closed&&l===e.length-1} @click=${()=>this.#s(l)}>${this.t("v4_zone_insert_point","Insert point")}</button>
              <button class="ms-btn" type="button" aria-label=${this.t("v4_zone_delete_point_number","Delete point {number}",{number:l+1})} @click=${()=>this.#r(l)}>${this.t("v4_zone_delete_point","Delete point")}</button>
            </div>`:p}
          ${l===null||!t?.closed?c`
            <div class="zone-guidance ms-surface">
              <span>${t?.closed?this.t("v4_zone_edit_help","Tap to add points. Drag points to reshape."):this.t("v4_zone_create_help","Place points around the area. The edges join automatically.")}</span>
            </div>`:p}
          <span class="zone-feedback ms-surface" role="status" ?hidden=${!this.#o}>${this.#o}</span>
        </div>
      </div>
    `}};export{v as OutlineEditor};
