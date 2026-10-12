import{a as y,b as g}from"./chunk-L62ENE4N.js";import{A as d,L as c,P as p,S as v,z as u}from"./chunk-QNZOEGVQ.js";var $=class{#t;#o;#a;#n=null;#r="";#i=null;attach(t,e,n){this.#t=t,this.#o=e,this.#a=n}#e(t,e,n){return v(this.#t.localize,t,e,n)}#l(t){this.#t.updateComplete.then(()=>{let e=this.#t.renderRoot;(e.querySelector(`[data-zone-index="${t}"]`)??e.querySelector(".map-root"))?.focus({preventScroll:!0})})}#p(t=this.#t.state){return u(t,"outline")!==null}#s(t,e){let n=e??u(this.#t.state,"outline");if(!d(this.#t.state,n))return;if(!y(t)){this.#r=this.#e("v4_zone_invalid","Keep the outline from crossing itself."),this.#t.requestUpdate();return}let o=g(t,s=>this.#o()?.containsMapPoint(s)??!1);this.#r=t.closed&&!o.length?this.#e("v4_zone_empty","Make the outline wider and keep it on the mapped floor."):"",this.#a({type:"set-draft-circles",circles:o,outline:t,coordinateEdit:n})}addPoint(t,e){let n=e??u(this.#t.state,"outline");if(!d(this.#t.state,n)||n.tool!=="outline"||!this.#o()?.containsMapPoint(t))return;let o=this.#t.state.draw.outline??{points:[],closed:!1};if(o.points.length>=64)return;let s=[...o.points,t];this.#s({points:s,closed:s.length>=3},n)}#c(t){let e=this.#t.state.draw.outline;if(!e)return;this.#i=null;let n=e.points.filter((o,s)=>s!==t);this.#s({points:n,closed:e.closed&&n.length>=3}),this.#l(Math.min(t,n.length-1))}#u(t){let e=this.#t.state.draw.outline;if(!e||e.points.length>=64)return;let n=e.points[t],o=e.points[(t+1)%e.points.length];if(!n||!o||!e.closed&&t===e.points.length-1)return;let s={x:(n.x+o.x)/2,y:(n.y+o.y)/2};this.#s({...e,points:[...e.points.slice(0,t+1),s,...e.points.slice(t+1)]}),this.#l(t+1)}#d(t,e){if(t.button!==0||this.#n||t.pointerType==="touch"&&!t.isPrimary)return;let n=u(this.#t.state,"outline");if(!n)return;this.#i=e,this.#t.requestUpdate();let o=this.#t.state.draw.outline;if(!o)return;t.stopPropagation(),t.preventDefault();let s=t.currentTarget;s.focus({preventScroll:!0}),s.setPointerCapture(t.pointerId),this.#n={index:e,pointer:t.pointerId,baseline:o,preview:o,target:s,capture:n}}observeState(t){this.#n&&!d(t,this.#n.capture)&&this.cancel()}#h(t){let e=this.#n;if(!e||e.pointer!==t.pointerId)return;if(t.stopPropagation(),t.preventDefault(),!d(this.#t.state,e.capture)){this.cancel();return}let n=this.#o()?.screenToMap(t.clientX,t.clientY);!n||!this.#o()?.containsMapPoint(n)||(e.preview={...e.baseline,points:e.baseline.points.map((o,s)=>s===e.index?n:o)},this.#t.requestUpdate())}#m(t){let e=this.#n;!e||e.pointer!==t.pointerId||(t.stopPropagation(),t.preventDefault(),this.#n=null,e.target.releasePointerCapture(t.pointerId),e.preview!==e.baseline&&this.#s(e.preview,e.capture),this.#t.requestUpdate())}cancel(){let t=this.#n;t&&(this.#n=null,t.target.hasPointerCapture(t.pointer)&&t.target.releasePointerCapture(t.pointer),this.#t.requestUpdate())}#f(t,e){if(t.ctrlKey||t.altKey||t.metaKey)return;if(t.key==="Escape"){t.stopPropagation(),this.cancel();return}let n=this.#t.state.draw.outline;if(!n||!this.#p())return;if(t.key==="Delete"||t.key==="Backspace"){t.preventDefault(),t.stopPropagation(),this.#c(e);return}let o=t.shiftKey?.1:.02,s=t.key==="ArrowLeft"?-o:t.key==="ArrowRight"?o:0,l=t.key==="ArrowUp"?-o:t.key==="ArrowDown"?o:0;if(!s&&!l)return;t.preventDefault(),t.stopPropagation();let r=n.points[e],i=this.#o()?.offsetMapPoint(r,s,l);i&&this.#o()?.containsMapPoint(i)&&this.#s({...n,points:n.points.map((a,h)=>h===e?i:a)})}render(){if(!this.#p())return p;let t=this.#n?.preview??this.#t.state.draw.outline,e=t?.points??[],n=e.map(r=>this.#o()?.mapToScreen(r)),o=n.map((r,i)=>r?`${i?"L":"M"}${r.x},${r.y}`:"").join(" "),s=!t||y(t),l=this.#i!==null&&this.#i<e.length?this.#i:null;return c`
      <div class="zone-overlay">
        <svg aria-hidden="true"><path d=${o+(t?.closed?" Z":"")} class=${s?"":"invalid"} fill=${t?.closed?"var(--ms-accent)":"none"}></path></svg>
        ${n.map((r,i)=>r?c`
          <button class="zone-point" type="button" data-zone-index=${i} data-selected=${String(this.#i===i)} data-map-control style=${`left:${r.x}px;top:${r.y}px`}
            aria-label=${this.#e("v4_zone_point_number","Point {number}",{number:i+1})} aria-describedby="zone-handle-help"
            title=${this.#e("v4_zone_point_help","Drag to move. Arrow keys adjust; Delete removes.")}
            @pointerdown=${a=>this.#d(a,i)} @pointermove=${a=>this.#h(a)}
            @pointerup=${a=>this.#m(a)} @pointercancel=${()=>this.cancel()}
            @lostpointercapture=${()=>{this.#n&&this.cancel()}}
            @focus=${()=>{this.#i=i,this.#t.requestUpdate()}}
            @keydown=${a=>this.#f(a,i)}
          >${i+1}</button>
        `:p)}
        ${e.map((r,i)=>{let a=e[(i+1)%e.length];if(!a||!t?.closed&&i===e.length-1||e.length>=64)return p;let h={x:(r.x+a.x)/2,y:(r.y+a.y)/2},m=this.#o()?.mapToScreen(h),f=n[i],b=n[(i+1)%n.length];return m&&f&&b&&Math.hypot(f.x-b.x,f.y-b.y)>=100?c`<button class="zone-point zone-midpoint" type="button" data-map-control
            style=${`left:${m.x}px;top:${m.y}px`} aria-label=${this.#e("v4_zone_add_point_after","Add point after {number}",{number:i+1})}
            @click=${()=>this.#u(i)}>+</button>`:p})}
        <div class="zone-help" data-map-control>
          <span id="zone-handle-help" class="sr-only">${this.#e("v4_zone_point_help","Drag to move. Arrow keys adjust; Delete removes.")}</span>
          ${l!==null?c`
            <div class="zone-point-actions ms-surface" role="group" aria-label=${this.#e("v4_zone_point_number","Point {number}",{number:l+1})}>
              <span class="zone-selection">${this.#e("v4_zone_point_number","Point {number}",{number:l+1})}</span>
              <button class="ms-btn" type="button" ?disabled=${e.length>=64||!t?.closed&&l===e.length-1} @click=${()=>this.#u(l)}>${this.#e("v4_zone_insert_point","Insert point")}</button>
              <button class="ms-btn" type="button" aria-label=${this.#e("v4_zone_delete_point_number","Delete point {number}",{number:l+1})} @click=${()=>this.#c(l)}>${this.#e("v4_zone_delete_point","Delete point")}</button>
            </div>`:p}
          ${l===null||!t?.closed?c`
            <div class="zone-guidance ms-surface">
              <span>${t?.closed?this.#e("v4_zone_edit_help","Tap to add points. Drag points to reshape."):this.#e("v4_zone_create_help","Place points around the area. The edges join automatically.")}</span>
            </div>`:p}
          <span class="zone-feedback ms-surface" role="status" ?hidden=${!this.#r}>${this.#r}</span>
        </div>
      </div>
    `}};export{$ as OutlineEditor};
