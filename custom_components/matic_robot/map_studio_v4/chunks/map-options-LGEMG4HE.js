import{a as e}from"./chunk-CEDW6BZF.js";import{a as t,d as a,g as s,h as i,i as o}from"./chunk-QNAFLI4U.js";import{a as n}from"./chunk-QAJZHVJO.js";import{Q as r,x as l}from"./chunk-TCOL2YTY.js";import{F as m,c as u,f as c,g as d,q as h}from"./chunk-DFEMJICY.js";import{a as b,b as g}from"./chunk-QUCSFX23.js";var f=i(class extends o{constructor(e){if(super(e),e.type!==s.PROPERTY&&e.type!==s.ATTRIBUTE&&e.type!==s.BOOLEAN_ATTRIBUTE)throw Error("The `live` directive is not allowed on child or event bindings");if(!t(e))throw Error("`live` bindings can only contain a single expression")}render(e){return e}update(e,[t]){if(t===c||t===d)return t;let i=e.element,o=e.name;if(e.type===s.PROPERTY){if(t===i[o])return c}else if(e.type===s.BOOLEAN_ATTRIBUTE){if(!!t===i.hasAttribute(o))return c}else if(e.type===s.ATTRIBUTE&&i.getAttribute(o)===t+"")return c;return a(e),t}}),y=class{constructor(e,t){this.host=e,this.menu=t,this.open=!1,this.#e="100",this.#t=!1,this.#a=null,this.#s=0,this.#i=new ResizeObserver(()=>{cancelAnimationFrame(this.#s),this.#s=requestAnimationFrame(()=>{this.#s=0,this.host.requestUpdate()})}),e.addController(this)}#e;#t;#a;#s;#i;hostConnected(){this.#o()}hostUpdated(){this.#o()}hostDisconnected(){this.#n()}#n(){this.#i.disconnect(),cancelAnimationFrame(this.#s),this.#s=0,this.#a=null}#o(){let e=this.open&&this.menu.open?this.#r()?.renderRoot.querySelector(".scene-canvas")??null:null;e!==this.#a&&(this.#n(),this.#a=e,e&&this.#i.observe(e))}#r(){return this.host.renderRoot.querySelector(".map-canvas")}available(){let e=this.#r();return!!e&&e.state.map.available&&(m(e.state)||"history"===e.state.dataMode)&&null!=e.rendererDiagnostics()?.sceneRevision}#l(){let e=this.#r()?.rendererDiagnostics();return e?Math.round(e.fitDistance/e.cameraDistance*100):100}show(){this.available()&&(this.open=!0,this.#t=!1,this.host.requestUpdate(),this.host.updateComplete.then(()=>this.host.renderRoot.querySelector("#map-zoom-value")?.focus()))}#m(e){if(!this.available()||!Number.isInteger(e)||e<100||e>1e3)return;let t=this.#r(),a=t?.rendererDiagnostics();!a||!t||(t.zoomBy(e*a.cameraDistance/(100*a.fitDistance)),this.#t=!1,this.host.requestUpdate())}render(e){let t=this.#l();return this.#t||(this.#e=t>=100&&t<=1e3?String(t):""),u`
<style>
.map-zoom { display: grid; gap: var(--ms-space-3); padding: var(--ms-space-3); inline-size: min(20rem, calc(100vw - 2rem)); min-inline-size: 0; box-sizing: border-box; }
.map-zoom p { margin: 0; white-space: normal; }
.map-zoom .zoom-values, .map-zoom .zoom-actions { display: flex; flex-wrap: wrap; gap: var(--ms-space-2); }
.map-zoom input { box-sizing: border-box; min-block-size: 44px; }
.map-zoom button { min-block-size: 44px; }
</style>
<form id="map-options" class="map-zoom ms-field overflow-menu ms-surface ms-surface--overlay" role="dialog" aria-label=${e("v4_map_zoom","Map zoom")}
@submit=${e=>{e.preventDefault(),this.#m(Number(this.#e))}}>
<p>${e("v4_map_zoom_current","Current zoom")}: <output aria-label=${e("v4_map_zoom_current","Current zoom")}>${t}%</output></p>
<label for="map-zoom-value">${e("v4_map_zoom_percent","Map zoom percent")}</label>
<input id="map-zoom-value" type="number" inputmode="numeric" min=${100} max=${1e3} step="1" required
aria-describedby="map-zoom-help" .value=${f(this.#e)} ?disabled=${!this.available()}
@input=${e=>{this.#t=!0,this.#e=e.target.value}}>
<p id="map-zoom-help">${e("v4_map_zoom_help","Zoom is relative to Fit. Enter 100\u20131000%; larger values zoom closer without moving the map's center.")}</p>
<div class="zoom-values" role="group" aria-label=${e("v4_map_zoom_presets","Zoom presets")}>
${[100,400,1e3].map(e=>u`<button class="ms-btn" type="button" ?disabled=${!this.available()} @click=${()=>this.#m(e)}>${e}%</button>`)}
</div>
<div class="zoom-actions">
<button class="ms-btn ms-btn--primary" type="submit" ?disabled=${!this.available()}>${e("v4_map_zoom_apply","Set zoom")}</button>
<button class="ms-btn" type="button" @click=${()=>this.menu.close(!0)}>${e("v4_close","Close")}</button>
</div>
</form>
`}},_=class{#e;constructor(t){this.menu=new e(t,".overflow-wrap",".overflow"),this.#e=new y(t,this.menu)}get popupRole(){return this.#e.open&&this.menu.open?"dialog":"menu"}toggle(){this.#e.open=!1,this.menu.toggle()}render({state:e,narrow:t,t:a,intent:s,diagnostics:i}){let v=(e,t,a)=>u` <button class="ms-row ms-row--menu" type="button" role="menuitemradio" aria-checked=${String(e)} data-selected=${e?"true":d} tabindex="-1" @click=${a}><span>${t}</span>${e?r(l):d}</button> `,p=(t,a)=>v(e.quality===t,a,()=>s({type:"set-quality",quality:t}));return u`
<style>
${n.cssText}
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
.overflow-menu [data-wifi-signal] > span:first-child { display: grid; text-align: start; }
.menu-note { color: var(--ms-text-quiet); font-size: var(--ms-t-sm); }
.menu-heading { margin: 0; padding: var(--ms-space-2) var(--ms-space-3) var(--ms-space-1); color: var(--ms-text-quiet); font-size: var(--ms-t-sm); font-weight: var(--ms-w-bold); }

</style>
${this.#e.open?this.#e.render(a):u`<div id="map-options" class="overflow-menu ms-surface ms-surface--overlay" role="menu" aria-label=${a("v4_map_options","Map options")}>
${t?u`
<div role="group" aria-labelledby="menu-display">
<p class="menu-heading" id="menu-display" role="presentation">${a("v4_map_display","Map display")}</p>
${"top"===h(e)?u`
${v("photo"===e.appearance,a("map_style_photo","Photo"),()=>s({type:"set-appearance",appearance:"photo"}))}
${v("rooms"===e.appearance,a("v4_room_colours","Room colors"),()=>s({type:"set-appearance",appearance:"rooms"}))}
`:d}
<button
class="ms-row ms-row--menu"
type="button"
role="menuitemcheckbox"
aria-checked=${String(e.labelsVisible)}
tabindex="-1"
@click=${()=>s({type:"toggle-labels"})}
><span>${a("v4_room_names","Room names")}</span><span class="ms-switch" aria-checked=${String(e.labelsVisible)} aria-hidden="true"></span></button>
</div>
`:d}
${e.resources.entry?.wifiHeatmapUrl?u`
<button
class="ms-row ms-row--menu"
type="button"
role="menuitemcheckbox"
aria-checked=${String(!!e.wifiSignal)}
tabindex="-1"
data-wifi-signal
@click=${()=>s({type:"toggle-wifi-signal"})}
><span>${a("v4_wifi_signal","Wi-Fi signal")}${((e,t)=>{if(!e||"loading"===e.status)return d;let a="failed"===e.status?t("v4_wifi_signal_failed","Couldn't load the survey"):e.cells.length?t("v4_wifi_signal_legend","Green is strong, red is weak"):e.surveying?t("v4_wifi_signal_waiting","No samples yet \xb7 they arrive during cleaning"):t("v4_wifi_signal_off","Turn on Wi-Fi survey in the robot's settings");return u`<small class="menu-note">${a}</small>`})(e.wifiSignal,a)}</span><span class="ms-switch" aria-checked=${String(!!e.wifiSignal)} aria-hidden="true"></span></button>
`:d}
<div role="group" aria-labelledby="menu-detail">
<p class="menu-heading" id="menu-detail" role="presentation">${a("map_quality_label","Map detail")}</p>
${p("auto",a("map_quality_auto","Auto detail"))}
${p("efficient",a("map_quality_efficient","Efficient"))}
${p("balanced",a("map_quality_balanced","Balanced"))}
${p("maximum",a("map_quality_maximum","Maximum"))}
</div>
${this.#e.available()?u`<button class="ms-row ms-row--menu" type="button" role="menuitem" tabindex="-1" aria-haspopup="dialog" @click=${()=>this.#e.show()}>${a("v4_map_zoom","Map zoom")}</button>`:d}
<button class="ms-row ms-row--menu" type="button" role="menuitem" tabindex="-1" @click=${()=>{this.menu.close(!1),i()}}>${a("v4_map_diagnostics","Map diagnostics")}</button>
</div>`}
`}};export{_ as MapOptions};
/*! Licenses: map-options-LGEMG4HE.js.LEGAL.txt */