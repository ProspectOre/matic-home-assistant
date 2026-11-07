import{a as e}from"./chunk-CEDW6BZF.js";import{a as t,b as a,c as s,d as i,g as o}from"./chunk-MOXJVYLN.js";import{I as n,q as r}from"./chunk-XORVX5PO.js";import{c as m,f as l,g as p}from"./chunk-6UI3L3W5.js";import{A as u}from"./chunk-AVP6EPWQ.js";import"./chunk-KELXOEJL.js";import{a as c,b as h}from"./chunk-SSVAUPVC.js";import"./chunk-22MRZNF5.js";var d=a(class extends s{constructor(e){if(super(e),e.type!==t.PROPERTY&&e.type!==t.ATTRIBUTE&&e.type!==t.BOOLEAN_ATTRIBUTE)throw Error("The `live` directive is not allowed on child or event bindings");if(!i(e))throw Error("`live` bindings can only contain a single expression")}render(e){return e}update(e,[a]){if(a===l||a===p)return a;let s=e.element,i=e.name;if(e.type===t.PROPERTY){if(a===s[i])return l}else if(e.type===t.BOOLEAN_ATTRIBUTE){if(!!a===s.hasAttribute(i))return l}else if(e.type===t.ATTRIBUTE&&s.getAttribute(i)===a+"")return l;return o(e),a}}),b=class{constructor(e,t){this.host=e,this.menu=t,this.open=!1,this.#e="100",this.#t=!1,this.#a=null,this.#s=0,this.#i=new ResizeObserver(()=>{cancelAnimationFrame(this.#s),this.#s=requestAnimationFrame(()=>{this.#s=0,this.host.requestUpdate()})}),e.addController(this)}#e;#t;#a;#s;#i;hostConnected(){this.#o()}hostUpdated(){this.#o()}hostDisconnected(){this.#n()}#n(){this.#i.disconnect(),cancelAnimationFrame(this.#s),this.#s=0,this.#a=null}#o(){let e=this.open&&this.menu.open?this.#r()?.renderRoot.querySelector(".scene-canvas")??null:null;e!==this.#a&&(this.#n(),this.#a=e,e&&this.#i.observe(e))}#r(){return this.host.renderRoot.querySelector(".map-canvas")}available(){let e=this.#r();return!!e&&e.state.map.available&&(u(e.state)||"history"===e.state.dataMode)&&null!=e.rendererDiagnostics()?.sceneRevision}#m(){let e=this.#r()?.rendererDiagnostics();return e?Math.round(e.fitDistance/e.cameraDistance*100):100}show(){this.available()&&(this.open=!0,this.#t=!1,this.host.requestUpdate(),this.host.updateComplete.then(()=>this.host.renderRoot.querySelector("#map-zoom-value")?.focus()))}#l(e){if(!this.available()||!Number.isInteger(e)||e<100||e>1e3)return;let t=this.#r(),a=t?.rendererDiagnostics();!a||!t||(t.zoomBy(e*a.cameraDistance/(100*a.fitDistance)),this.#t=!1,this.host.requestUpdate())}render(e){let t=this.#m();return this.#t||(this.#e=t>=100&&t<=1e3?String(t):""),m`
<style>
.map-zoom { display: grid; gap: var(--ms-space-3); padding: var(--ms-space-3); inline-size: min(20rem, calc(100vw - 2rem)); min-inline-size: 0; box-sizing: border-box; }
.map-zoom p { margin: 0; white-space: normal; }
.map-zoom .zoom-values, .map-zoom .zoom-actions { display: flex; flex-wrap: wrap; gap: var(--ms-space-2); }
.map-zoom input { box-sizing: border-box; min-block-size: 44px; }
.map-zoom button { min-block-size: 44px; }
</style>
<form id="map-options" class="map-zoom ms-field overflow-menu ms-surface ms-surface--overlay" role="dialog" aria-label=${e("v4_map_zoom","Map zoom")}
@submit=${e=>{e.preventDefault(),this.#l(Number(this.#e))}}>
<p>${e("v4_map_zoom_current","Current zoom")}: <output aria-label=${e("v4_map_zoom_current","Current zoom")}>${t}%</output></p>
<label for="map-zoom-value">${e("v4_map_zoom_percent","Map zoom percent")}</label>
<input id="map-zoom-value" type="number" inputmode="numeric" min=${100} max=${1e3} step="1" required
aria-describedby="map-zoom-help" .value=${d(this.#e)} ?disabled=${!this.available()}
@input=${e=>{this.#t=!0,this.#e=e.target.value}}>
<p id="map-zoom-help">${e("v4_map_zoom_help","Zoom is relative to Fit. Enter 100\u20131000%; larger values zoom closer without moving the map's center.")}</p>
<div class="zoom-values" role="group" aria-label=${e("v4_map_zoom_presets","Zoom presets")}>
${[100,400,1e3].map(e=>m`<button class="ms-btn" type="button" ?disabled=${!this.available()} @click=${()=>this.#l(e)}>${e}%</button>`)}
</div>
<div class="zoom-actions">
<button class="ms-btn ms-btn--primary" type="submit" ?disabled=${!this.available()}>${e("v4_map_zoom_apply","Set zoom")}</button>
<button class="ms-btn" type="button" @click=${()=>this.menu.close(!0)}>${e("v4_close","Close")}</button>
</div>
</form>
`}},v=class{#e;constructor(t){this.menu=new e(t,".overflow-wrap",".overflow"),this.#e=new b(t,this.menu)}get popupRole(){return this.#e.open&&this.menu.open?"dialog":"menu"}toggle(){this.#e.open=!1,this.menu.toggle()}render({state:e,t,intent:a,diagnostics:s,navigation:i}){let o=(t,s)=>((e,t,a)=>m` <button class="ms-row ms-row--menu" type="button" role="menuitemradio" aria-checked=${String(e)} data-selected=${e?"true":p} tabindex="-1" @click=${a}><span>${t}</span>${e?n(r):p}</button> `)(e.quality===t,s,()=>a({type:"set-quality",quality:t}));return m`
<style>
.overflow-menu {
position: absolute;
z-index: 18;
inset-block-start: calc(100% + var(--ms-space-1));
inset-inline-end: 0;
display: grid;
gap: var(--ms-space-1);
min-inline-size: 14rem;
max-inline-size: calc(100vw - 2rem);
max-block-size: calc(100dvh - 5rem - var(--ms-safe-top, 0px) - var(--ms-safe-bottom, 0px));
overflow-y: auto;
padding: var(--ms-space-1);
}
.overflow-menu .ms-row { justify-content: flex-start; }
.menu-heading { margin: 0; padding: var(--ms-space-2) var(--ms-space-3) var(--ms-space-1); color: var(--ms-text-quiet); font-size: var(--ms-t-sm); font-weight: var(--ms-w-bold); }
@container (max-width: 46rem) {
.toolbar-actions .overflow-wrap { position: static; }
.toolbar-actions .overflow-menu {
inset-block-start: calc(var(--ms-safe-top) + 44px);
inset-inline-end: 6px;
max-inline-size: calc(100% - 12px);
}
}
</style>
${this.#e.open?this.#e.render(t):m`<div id="map-options" class="overflow-menu ms-surface ms-surface--overlay" role="menu" tabindex="0" aria-label=${t("v4_map_options","Map options")}>
<div role="group" aria-labelledby="menu-detail">
<p class="menu-heading" id="menu-detail" role="presentation">${t("map_quality_label","Map detail")}</p>
${o("auto",t("map_quality_auto","Auto detail"))}
${o("efficient",t("map_quality_efficient","Efficient"))}
${o("balanced",t("map_quality_balanced","Balanced"))}
${o("maximum",t("map_quality_maximum","Maximum"))}
</div>
${this.#e.available()?m`<button class="ms-row ms-row--menu" type="button" role="menuitem" tabindex="-1" aria-haspopup="dialog" @click=${()=>this.#e.show()}>${t("v4_map_zoom","Map zoom")}</button>`:p}
${i?m`<button class="ms-row ms-row--menu" type="button" role="menuitem" tabindex="-1"
@click=${()=>{this.menu.close(!1),i()}}>${t("v4_open_navigation","Open Home Assistant sidebar")}</button>`:p}
<button class="ms-row ms-row--menu" type="button" role="menuitem" tabindex="-1" @click=${()=>{this.menu.close(!1),s()}}>${t("v4_map_diagnostics","Map diagnostics")}</button>
</div>`}
`}};export{v as MapOptions};
/*! Licenses: map-options-DOWNK2YX.js.LEGAL.txt */