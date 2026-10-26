import{a as e}from"./chunk-CEDW6BZF.js";import{a,d as t,g as o,h as s,i}from"./chunk-IJGDHO4A.js";import{a as r}from"./chunk-URUWHLAK.js";import{Q as n,x as m}from"./chunk-4C3Z3ZYQ.js";import{J as l,Y as u,a as c,b as d,va as b,ya as h,za as y}from"./chunk-DXG6AJR4.js";var g=s(class extends i{constructor(e){if(super(e),e.type!==o.PROPERTY&&e.type!==o.ATTRIBUTE&&e.type!==o.BOOLEAN_ATTRIBUTE)throw Error("The `live` directive is not allowed on child or event bindings");if(!a(e))throw Error("`live` bindings can only contain a single expression")}render(e){return e}update(e,[a]){if(a===h||a===y)return a;let s=e.element,i=e.name;if(e.type===o.PROPERTY){if(a===s[i])return h}else if(e.type===o.BOOLEAN_ATTRIBUTE){if(!!a===s.hasAttribute(i))return h}else if(e.type===o.ATTRIBUTE&&s.getAttribute(i)===a+"")return h;return t(e),a}}),f=class{constructor(e,a){this.host=e,this.menu=a,this.open=!1,this.#e="100",this.#a=!1}#e;#a;#t(){return this.host.renderRoot.querySelector(".map-canvas")}available(){let e=this.#t();return!!e&&e.state.map.available&&(u(e.state)||"history"===e.state.dataMode)&&null!=e.rendererDiagnostics()?.sceneRevision}#o(){let e=this.#t()?.rendererDiagnostics();return e?Math.round(e.fitDistance/e.cameraDistance*100):100}show(){this.available()&&(this.open=!0,this.#a=!1,this.host.requestUpdate(),this.host.updateComplete.then(()=>this.host.renderRoot.querySelector("#map-zoom-value")?.focus()))}#s(e){if(!this.available()||!Number.isInteger(e)||e<100||e>1e3)return;let a=this.#t(),t=a?.rendererDiagnostics();!t||!a||(a.zoomBy(e*t.cameraDistance/(100*t.fitDistance)),this.#a=!1,this.host.requestUpdate())}render(e){let a=this.#o();return this.#a||(this.#e=a>=100&&a<=1e3?String(a):""),b`
<style>
.map-zoom { display: grid; gap: var(--ms-space-3); padding: var(--ms-space-3); inline-size: min(20rem, calc(100vw - 2rem)); min-inline-size: 0; box-sizing: border-box; }
.map-zoom p { margin: 0; white-space: normal; }
.map-zoom .zoom-values, .map-zoom .zoom-actions { display: flex; flex-wrap: wrap; gap: var(--ms-space-2); }
.map-zoom input { box-sizing: border-box; min-block-size: 44px; }
.map-zoom button { min-block-size: 44px; }
</style>
<form id="map-options" class="map-zoom ms-field overflow-menu ms-surface ms-surface--overlay" role="dialog" aria-label=${e("v4_map_zoom","Map zoom")}
@submit=${e=>{e.preventDefault(),this.#s(Number(this.#e))}}>
<p>${e("v4_map_zoom_current","Current zoom")}: <output aria-label=${e("v4_map_zoom_current","Current zoom")}>${a}%</output></p>
<label for="map-zoom-value">${e("v4_map_zoom_percent","Map zoom percent")}</label>
<input id="map-zoom-value" type="number" inputmode="numeric" min=${100} max=${1e3} step="1" required
aria-describedby="map-zoom-help" .value=${g(this.#e)} ?disabled=${!this.available()}
@input=${e=>{this.#a=!0,this.#e=e.target.value}}>
<p id="map-zoom-help">${e("v4_map_zoom_help","Zoom is relative to Fit. Enter 100\u20131000%; larger values zoom closer without moving the map's center.")}</p>
<div class="zoom-values" role="group" aria-label=${e("v4_map_zoom_presets","Zoom presets")}>
${[100,400,1e3].map(e=>b`<button class="ms-btn" type="button" ?disabled=${!this.available()} @click=${()=>this.#s(e)}>${e}%</button>`)}
</div>
<div class="zoom-actions">
<button class="ms-btn ms-btn--primary" type="submit" ?disabled=${!this.available()}>${e("v4_map_zoom_apply","Set zoom")}</button>
<button class="ms-btn" type="button" @click=${()=>this.menu.close(!0)}>${e("v4_close","Close")}</button>
</div>
</form>
`}},$=class{#e;constructor(a){this.menu=new e(a,".overflow-wrap",".overflow"),this.#e=new f(a,this.menu)}get popupRole(){return this.#e.open&&this.menu.open?"dialog":"menu"}toggle(){this.#e.open=!1,this.menu.toggle()}render({state:e,narrow:a,t,intent:o,diagnostics:s}){let v=(e,a,t)=>b` <button class="ms-row ms-row--menu" type="button" role="menuitemradio" aria-checked=${String(e)} data-selected=${e?"true":y} tabindex="-1" @click=${t}><span>${a}</span>${e?n(m):y}</button> `,p=(a,t)=>v(e.quality===a,t,()=>o({type:"set-quality",quality:a}));return b`
<style>
${r.cssText}
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
.overflow-menu [role="menuitemcheckbox"] { justify-content: space-between; gap: var(--ms-space-3); }
.overflow-menu [role="group"] { display: grid; gap: var(--ms-space-1); }
.overflow-menu [role="group"] + * { border-block-start: 1px solid var(--ms-line); padding-block-start: var(--ms-space-1); }
.menu-heading { margin: 0; padding: var(--ms-space-2) var(--ms-space-3) var(--ms-space-1); color: var(--ms-text-quiet); font-size: var(--ms-t-sm); font-weight: var(--ms-w-bold); }

</style>
${this.#e.open?this.#e.render(t):b`<div id="map-options" class="overflow-menu ms-surface ms-surface--overlay" role="menu" aria-label=${t("v4_map_options","Map options")}>
${a?b`
<div role="group" aria-labelledby="menu-display">
<p class="menu-heading" id="menu-display" role="presentation">${t("v4_map_display","Map display")}</p>
${"top"===l(e)?b`
${v("photo"===e.appearance,t("map_style_photo","Photo"),()=>o({type:"set-appearance",appearance:"photo"}))}
${v("rooms"===e.appearance,t("v4_room_colours","Room colors"),()=>o({type:"set-appearance",appearance:"rooms"}))}
`:y}
<button
class="ms-row ms-row--menu"
type="button"
role="menuitemcheckbox"
aria-checked=${String(e.labelsVisible)}
tabindex="-1"
@click=${()=>o({type:"toggle-labels"})}
><span>${t("v4_room_names","Room names")}</span><span class="ms-switch" aria-checked=${String(e.labelsVisible)} aria-hidden="true"></span></button>
</div>
`:y}
<div role="group" aria-labelledby="menu-detail">
<p class="menu-heading" id="menu-detail" role="presentation">${t("map_quality_label","Map detail")}</p>
${p("auto",t("map_quality_auto","Auto detail"))}
${p("efficient",t("map_quality_efficient","Efficient"))}
${p("balanced",t("map_quality_balanced","Balanced"))}
${p("maximum",t("map_quality_maximum","Maximum"))}
</div>
${this.#e.available()?b`<button class="ms-row ms-row--menu" type="button" role="menuitem" tabindex="-1" aria-haspopup="dialog" @click=${()=>this.#e.show()}>${t("v4_map_zoom","Map zoom")}</button>`:y}
<button class="ms-row ms-row--menu" type="button" role="menuitem" tabindex="-1" @click=${()=>{this.menu.close(!1),s()}}>${t("v4_map_diagnostics","Map diagnostics")}</button>
</div>`}
`}};export{$ as MapOptions};
/*! Licenses: map-options-2LTACUEJ.js.LEGAL.txt */