import{a as e}from"./chunk-CEDW6BZF.js";import{a as t,b as a,c as o,d as s,g as i}from"./chunk-MOXJVYLN.js";import{a as n}from"./chunk-JAHDUSSE.js";import{I as r,q as l}from"./chunk-XV4TIR54.js";import{c as m,f as p,g as c}from"./chunk-6UI3L3W5.js";import{A as u,D as d,g as h}from"./chunk-UIIXMJ63.js";import"./chunk-PURQ5JQB.js";import{a as b,b as v}from"./chunk-VZCPKYCA.js";import"./chunk-NQ4IDWJU.js";var f=a(class extends o{constructor(e){if(super(e),e.type!==t.PROPERTY&&e.type!==t.ATTRIBUTE&&e.type!==t.BOOLEAN_ATTRIBUTE)throw Error("The `live` directive is not allowed on child or event bindings");if(!s(e))throw Error("`live` bindings can only contain a single expression")}render(e){return e}update(e,[a]){if(a===p||a===c)return a;let o=e.element,s=e.name;if(e.type===t.PROPERTY){if(a===o[s])return p}else if(e.type===t.BOOLEAN_ATTRIBUTE){if(!!a===o.hasAttribute(s))return p}else if(e.type===t.ATTRIBUTE&&o.getAttribute(s)===a+"")return p;return i(e),a}}),g=class{constructor(e,t){this.host=e,this.menu=t,this.open=!1,this.#e="100",this.#t=!1,this.#a=null,this.#o=0,this.#s=new ResizeObserver(()=>{cancelAnimationFrame(this.#o),this.#o=requestAnimationFrame(()=>{this.#o=0,this.host.requestUpdate()})}),e.addController(this)}#e;#t;#a;#o;#s;hostConnected(){this.#i()}hostUpdated(){this.#i()}hostDisconnected(){this.#n()}#n(){this.#s.disconnect(),cancelAnimationFrame(this.#o),this.#o=0,this.#a=null}#i(){let e=this.open&&this.menu.open?this.#r()?.renderRoot.querySelector(".scene-canvas")??null:null;e!==this.#a&&(this.#n(),this.#a=e,e&&this.#s.observe(e))}#r(){return this.host.renderRoot.querySelector(".map-canvas")}available(){let e=this.#r();return!!e&&e.state.map.available&&(u(e.state)||"history"===e.state.dataMode)&&null!=e.rendererDiagnostics()?.sceneRevision}#l(){let e=this.#r()?.rendererDiagnostics();return e?Math.round(e.fitDistance/e.cameraDistance*100):100}show(){this.available()&&(this.open=!0,this.#t=!1,this.host.requestUpdate(),this.host.updateComplete.then(()=>this.host.renderRoot.querySelector("#map-zoom-value")?.focus()))}#m(e){if(!this.available()||!Number.isInteger(e)||e<100||e>1e3)return;let t=this.#r(),a=t?.rendererDiagnostics();!a||!t||(t.zoomBy(e*a.cameraDistance/(100*a.fitDistance)),this.#t=!1,this.host.requestUpdate())}render(e){let t=this.#l();return this.#t||(this.#e=t>=100&&t<=1e3?String(t):""),m`
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
${[100,400,1e3].map(e=>m`<button class="ms-btn" type="button" ?disabled=${!this.available()} @click=${()=>this.#m(e)}>${e}%</button>`)}
</div>
<div class="zoom-actions">
<button class="ms-btn ms-btn--primary" type="submit" ?disabled=${!this.available()}>${e("v4_map_zoom_apply","Set zoom")}</button>
<button class="ms-btn" type="button" @click=${()=>this.menu.close(!0)}>${e("v4_close","Close")}</button>
</div>
</form>
`}},w=class{#e;constructor(t){this.menu=new e(t,".overflow-wrap",".overflow"),this.#e=new g(t,this.menu)}get popupRole(){return this.#e.open&&this.menu.open?"dialog":"menu"}toggle(){this.#e.open=!1,this.menu.toggle()}render({state:e,narrow:t,t:a,intent:o,diagnostics:s}){let i=d(e,"follow"),p=d(e,"ride"),u=(e,t,a)=>m` <button class="ms-row ms-row--menu" type="button" role="menuitemradio" aria-checked=${String(e)} data-selected=${e?"true":c} tabindex="-1" @click=${a}><span>${t}</span>${e?r(l):c}</button> `,b=(t,a)=>u(e.quality===t,a,()=>o({type:"set-quality",quality:t}));return m`
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
.overflow-menu :is([data-wifi-signal], [data-floor-types], [data-robot-trail]) > span:first-child { display: grid; text-align: start; }
.menu-note { color: var(--ms-text-quiet); font-size: var(--ms-t-sm); }
.menu-heading { margin: 0; padding: var(--ms-space-2) var(--ms-space-3) var(--ms-space-1); color: var(--ms-text-quiet); font-size: var(--ms-t-sm); font-weight: var(--ms-w-bold); }

</style>
${this.#e.open?this.#e.render(a):m`<div id="map-options" class="overflow-menu ms-surface ms-surface--overlay" role="menu" aria-label=${a("v4_map_options","Map options")}>
${t?m`
<div role="group" aria-labelledby="menu-display">
<p class="menu-heading" id="menu-display" role="presentation">${a("v4_map_display","Map display")}</p>
${"top"===h(e)?m`
${u("photo"===e.appearance,a("map_style_photo","Photo"),()=>o({type:"set-appearance",appearance:"photo"}))}
${u("rooms"===e.appearance,a("v4_room_colours","Room colors"),()=>o({type:"set-appearance",appearance:"rooms"}))}
`:c}
<button
class="ms-row ms-row--menu"
type="button"
role="menuitemcheckbox"
aria-checked=${String(e.labelsVisible)}
tabindex="-1"
@click=${()=>o({type:"toggle-labels"})}
><span>${a("v4_room_names","Room names")}</span><span class="ms-switch" aria-checked=${String(e.labelsVisible)} aria-hidden="true"></span></button>
</div>
`:c}
${e.resources.entry?.wifiHeatmapUrl?m`
<button
class="ms-row ms-row--menu"
type="button"
role="menuitemcheckbox"
aria-checked=${String(!!e.wifiSignal)}
tabindex="-1"
data-wifi-signal
@click=${()=>o({type:"toggle-wifi-signal"})}
><span>${a("v4_wifi_signal","Wi-Fi signal")}${((e,t)=>{if(!e||"loading"===e.status)return c;let a="failed"===e.status?t("v4_wifi_signal_failed","Couldn't load the survey"):e.cells.length?t("v4_wifi_signal_legend","Approximate samples: green strong, red weak. Rings are older; blank areas are unmeasured."):e.surveying?t("v4_wifi_signal_waiting","No samples yet \xb7 they arrive during cleaning"):t("v4_wifi_signal_off","Turn on Wi-Fi survey in the robot's settings");return m`<small class="menu-note">${a}</small>`})(e.wifiSignal,a)}</span><span class="ms-switch" aria-checked=${String(!!e.wifiSignal)} aria-hidden="true"></span></button>
`:c}
${e.resources.entry?.floorTypesUrl?m`
<button
class="ms-row ms-row--menu"
type="button"
role="menuitemcheckbox"
aria-checked=${String(!!e.floorTypes)}
tabindex="-1"
data-floor-types
@click=${()=>o({type:"toggle-floor-types"})}
><span>${a("v4_floor_types","Carpet and vents")}${((e,t)=>{if(!e||"loading"===e.status)return c;let a="failed"===e.status?t("v4_floor_types_failed","Couldn't load carpet and vents"):e.carpet.length||e.vent.length?t("v4_floor_types_legend","Brown is carpet, blue is a vent"):t("v4_floor_types_empty","None mapped yet \xb7 the robot finds them while cleaning");return m`<small class="menu-note">${a}</small>`})(e.floorTypes,a)}</span><span class="ms-switch" aria-checked=${String(!!e.floorTypes)} aria-hidden="true"></span></button>
`:c}
${"live"===e.dataMode?m`
<button
class="ms-row ms-row--menu"
type="button"
role="menuitemcheckbox"
aria-checked=${String("follow"===e.followMode)}
tabindex="-1"
data-follow-robot
aria-disabled=${String(!i&&"follow"!==e.followMode)}
@click=${()=>o({type:"set-follow-mode",mode:"follow"===e.followMode?"off":"follow"})}
><span>${a("v4_follow_robot","Follow the robot")}</span><span class="ms-switch" aria-checked=${String("follow"===e.followMode)} aria-hidden="true"></span></button>
<button class="ms-row ms-row--menu" type="button" role="menuitemcheckbox"
aria-checked=${String("ride"===e.followMode)} tabindex="-1" data-ride-along
aria-disabled=${String(!p&&"ride"!==e.followMode)}
@click=${()=>o({type:"set-follow-mode",mode:"ride"===e.followMode?"off":"ride"})}
><span>${a("v4_ride_along","Ride along in 3D")}</span><span class="ms-switch" aria-checked=${String("ride"===e.followMode)} aria-hidden="true"></span></button>
${i&&p?c:m`<small class="menu-note">${a("v4_follow_needs_live_pose","Following needs a live position; Ride along also needs the robot's heading.")}</small>`}
`:c}
<div role="group" aria-labelledby="menu-detail">
<p class="menu-heading" id="menu-detail" role="presentation">${a("map_quality_label","Map detail")}</p>
${b("auto",a("map_quality_auto","Auto detail"))}
${b("efficient",a("map_quality_efficient","Efficient"))}
${b("balanced",a("map_quality_balanced","Balanced"))}
${b("maximum",a("map_quality_maximum","Maximum"))}
</div>
${"live"===e.dataMode?m`<button
class="ms-row ms-row--menu"
type="button"
role="menuitemcheckbox"
aria-checked=${String("live"===e.trail?.id)}
data-robot-trail
tabindex="-1"
@click=${()=>o({type:"show-trail",trail:"live"===e.trail?.id?null:"live"})}
><span>${a("v4_robot_trail","Robot trail")}${"live"===e.trail?.id?m`<small class="menu-note">${a("v4_robot_trail_hint","The sampled path can have gaps.")}</small>`:c}</span><span class="ms-switch" aria-checked=${String("live"===e.trail?.id)} aria-hidden="true"></span></button>`:c}
${this.#e.available()?m`<button class="ms-row ms-row--menu" type="button" role="menuitem" tabindex="-1" aria-haspopup="dialog" @click=${()=>this.#e.show()}>${a("v4_map_zoom","Map zoom")}</button>`:c}
<button class="ms-row ms-row--menu" type="button" role="menuitem" tabindex="-1" @click=${()=>{this.menu.close(!1),s()}}>${a("v4_map_diagnostics","Map diagnostics")}</button>
</div>`}
`}};export{w as MapOptions};
/*! Licenses: map-options-GISB4XKF.js.LEGAL.txt */