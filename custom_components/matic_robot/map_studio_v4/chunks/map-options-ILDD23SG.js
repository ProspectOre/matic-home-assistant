import{a as e}from"./chunk-CEDW6BZF.js";import{a,b as t,c as s,d as i,g as o}from"./chunk-MOXJVYLN.js";import{a as l,b as n}from"./chunk-EF2SFLEJ.js";import{a as r}from"./chunk-JAHDUSSE.js";import{I as m,q as c}from"./chunk-XV4TIR54.js";import{c as p,f as u,g as d}from"./chunk-6UI3L3W5.js";import{A as h,D as v,g as b}from"./chunk-HGP4KAZY.js";import"./chunk-KELXOEJL.js";import{a as g,b as f}from"./chunk-KZFC5TVY.js";import"./chunk-BTA4P3NI.js";var w=t(class extends s{constructor(e){if(super(e),e.type!==a.PROPERTY&&e.type!==a.ATTRIBUTE&&e.type!==a.BOOLEAN_ATTRIBUTE)throw Error("The `live` directive is not allowed on child or event bindings");if(!i(e))throw Error("`live` bindings can only contain a single expression")}render(e){return e}update(e,[t]){if(t===u||t===d)return t;let s=e.element,i=e.name;if(e.type===a.PROPERTY){if(t===s[i])return u}else if(e.type===a.BOOLEAN_ATTRIBUTE){if(!!t===s.hasAttribute(i))return u}else if(e.type===a.ATTRIBUTE&&s.getAttribute(i)===t+"")return u;return o(e),t}}),_=class{constructor(e,a){this.host=e,this.menu=a,this.open=!1,this.#e="100",this.#a=!1,this.#t=null,this.#s=0,this.#i=new ResizeObserver(()=>{cancelAnimationFrame(this.#s),this.#s=requestAnimationFrame(()=>{this.#s=0,this.host.requestUpdate()})}),e.addController(this)}#e;#a;#t;#s;#i;hostConnected(){this.#o()}hostUpdated(){this.#o()}hostDisconnected(){this.#l()}#l(){this.#i.disconnect(),cancelAnimationFrame(this.#s),this.#s=0,this.#t=null}#o(){let e=this.open&&this.menu.open?this.#n()?.renderRoot.querySelector(".scene-canvas")??null:null;e!==this.#t&&(this.#l(),this.#t=e,e&&this.#i.observe(e))}#n(){return this.host.renderRoot.querySelector(".map-canvas")}available(){let e=this.#n();return!!e&&e.state.map.available&&(h(e.state)||"history"===e.state.dataMode)&&null!=e.rendererDiagnostics()?.sceneRevision}#r(){let e=this.#n()?.rendererDiagnostics();return e?Math.round(e.fitDistance/e.cameraDistance*100):100}show(){this.available()&&(this.open=!0,this.#a=!1,this.host.requestUpdate(),this.host.updateComplete.then(()=>this.host.renderRoot.querySelector("#map-zoom-value")?.focus()))}#m(e){if(!this.available()||!Number.isInteger(e)||e<100||e>1e3)return;let a=this.#n(),t=a?.rendererDiagnostics();!t||!a||(a.zoomBy(e*t.cameraDistance/(100*t.fitDistance)),this.#a=!1,this.host.requestUpdate())}render(e){let a=this.#r();return this.#a||(this.#e=a>=100&&a<=1e3?String(a):""),p`
<style>
.map-zoom { display: grid; gap: var(--ms-space-3); padding: var(--ms-space-3); inline-size: min(20rem, calc(100vw - 2rem)); min-inline-size: 0; box-sizing: border-box; }
.map-zoom p { margin: 0; white-space: normal; }
.map-zoom .zoom-values, .map-zoom .zoom-actions { display: flex; flex-wrap: wrap; gap: var(--ms-space-2); }
.map-zoom input { box-sizing: border-box; min-block-size: 44px; }
.map-zoom button { min-block-size: 44px; }
</style>
<form id="map-options" class="map-zoom ms-field overflow-menu ms-surface ms-surface--overlay" role="dialog" aria-label=${e("v4_map_zoom","Map zoom")}
@submit=${e=>{e.preventDefault(),this.#m(Number(this.#e))}}>
<p>${e("v4_map_zoom_current","Current zoom")}: <output aria-label=${e("v4_map_zoom_current","Current zoom")}>${a}%</output></p>
<label for="map-zoom-value">${e("v4_map_zoom_percent","Map zoom percent")}</label>
<input id="map-zoom-value" type="number" inputmode="numeric" min=${100} max=${1e3} step="1" required
aria-describedby="map-zoom-help" .value=${w(this.#e)} ?disabled=${!this.available()}
@input=${e=>{this.#a=!0,this.#e=e.target.value}}>
<p id="map-zoom-help">${e("v4_map_zoom_help","Zoom is relative to Fit. Enter 100\u20131000%; larger values zoom closer without moving the map's center.")}</p>
<div class="zoom-values" role="group" aria-label=${e("v4_map_zoom_presets","Zoom presets")}>
${[100,400,1e3].map(e=>p`<button class="ms-btn" type="button" ?disabled=${!this.available()} @click=${()=>this.#m(e)}>${e}%</button>`)}
</div>
<div class="zoom-actions">
<button class="ms-btn ms-btn--primary" type="submit" ?disabled=${!this.available()}>${e("v4_map_zoom_apply","Set zoom")}</button>
<button class="ms-btn" type="button" @click=${()=>this.menu.close(!0)}>${e("v4_close","Close")}</button>
</div>
</form>
`}},$=class{#e;constructor(a){this.menu=new e(a,".overflow-wrap",".overflow"),this.#e=new _(a,this.menu)}get popupRole(){return this.#e.open&&this.menu.open?"dialog":"menu"}toggle(){this.#e.open=!1,this.menu.toggle()}render({state:e,narrow:a,t,intent:s,diagnostics:i}){let o=v(e,"follow"),u=v(e,"ride"),h=(e,a,t)=>p` <button class="ms-row ms-row--menu" type="button" role="menuitemradio" aria-checked=${String(e)} data-selected=${e?"true":d} tabindex="-1" @click=${t}><span>${a}</span>${e?m(c):d}</button> `,g=(a,t)=>h(e.quality===a,t,()=>s({type:"set-quality",quality:a})),f=e.wifiSignal,w="ready"===f?.status&&f.cells.length?n(f.cells,e.wifiScale):null,_=w&&f?l(f.cells):null,$=e=>Math.round(10*e)/10+" dBm";return p`
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
.overflow-menu[data-wifi-scale] { inline-size: min(19rem, calc(100vw - 2rem)); }
.overflow-menu [role="menuitemcheckbox"] { justify-content: space-between; gap: var(--ms-space-3); }
.overflow-menu [role="group"] { display: grid; gap: var(--ms-space-1); }
.overflow-menu [role="group"] + * { border-block-start: 1px solid var(--ms-line); padding-block-start: var(--ms-space-1); }
.overflow-menu :is([data-wifi-signal], [data-floor-types], [data-robot-trail]) > span:first-child { display: grid; text-align: start; }
.menu-note { color: var(--ms-text-quiet); font-size: var(--ms-t-sm); }
.menu-heading { margin: 0; padding: var(--ms-space-2) var(--ms-space-3) var(--ms-space-1); color: var(--ms-text-quiet); font-size: var(--ms-t-sm); font-weight: var(--ms-w-bold); }
.wifi-scale-legend { display: grid; gap: var(--ms-space-1); padding: var(--ms-space-1) var(--ms-space-3); }
.wifi-scale-ramp { block-size: .5rem; border-radius: 1rem; background: linear-gradient(to right, hsl(0 75% 45%), hsl(60 75% 45%), hsl(120 75% 45%)); }
.wifi-scale-labels { display: flex; justify-content: space-between; gap: var(--ms-space-2); }

</style>
${this.#e.open?this.#e.render(t):p`<div id="map-options" class="overflow-menu ms-surface ms-surface--overlay" data-wifi-scale=${w?"":d} role="menu" tabindex="0" aria-label=${t("v4_map_options","Map options")}>
${a?p`
<div role="group" aria-labelledby="menu-display">
<p class="menu-heading" id="menu-display" role="presentation">${t("v4_map_display","Map display")}</p>
${"top"===b(e)?p`
${h("photo"===e.appearance,t("map_style_photo","Photo"),()=>s({type:"set-appearance",appearance:"photo"}))}
${h("rooms"===e.appearance,t("v4_room_colours","Room colors"),()=>s({type:"set-appearance",appearance:"rooms"}))}
`:d}
<button
class="ms-row ms-row--menu"
type="button"
role="menuitemcheckbox"
aria-checked=${String(e.labelsVisible)}
tabindex="-1"
@click=${()=>s({type:"toggle-labels"})}
><span>${t("v4_room_names","Room names")}</span><span class="ms-switch" aria-checked=${String(e.labelsVisible)} aria-hidden="true"></span></button>
</div>
`:d}
<p class="menu-heading" role="presentation">${t("v4_map_layers_button","Layers")}</p>
${"live"===e.dataMode?p`<button
class="ms-row ms-row--menu"
type="button"
role="menuitemcheckbox"
aria-checked=${String("live"===e.trail?.id)}
data-robot-trail
tabindex="-1"
@click=${()=>s({type:"show-trail",trail:"live"===e.trail?.id?null:"live"})}
><span>${t("v4_robot_trail","Robot trail")}${"live"===e.trail?.id?p`<small class="menu-note">${t("v4_robot_trail_hint","The sampled path can have gaps.")}</small>`:d}</span><span class="ms-switch" aria-checked=${String("live"===e.trail?.id)} aria-hidden="true"></span></button>`:d}
${e.resources.entry?.wifiHeatmapUrl?p`
<button
class="ms-row ms-row--menu"
type="button"
role="menuitemcheckbox"
aria-checked=${String(!!e.wifiSignal)}
tabindex="-1"
data-wifi-signal
@click=${()=>s({type:"toggle-wifi-signal"})}
><span>${t("v4_wifi_signal","Wi-Fi signal")}${((e,a)=>{if(!e||"loading"===e.status)return d;let t="failed"===e.status?a("v4_wifi_signal_failed","Couldn't load the survey"):e.cells.length?a("v4_wifi_samples_note","Smoothed estimates within 2 feet of samples. Older readings are coarser; blank areas are unmeasured."):e.surveying?a("v4_wifi_signal_waiting","No samples yet \xb7 they arrive during cleaning"):a("v4_wifi_signal_off","Turn on Wi-Fi survey in the robot's settings");return p`<small class="menu-note">${t}</small>`})(e.wifiSignal,t)}</span><span class="ms-switch" aria-checked=${String(!!e.wifiSignal)} aria-hidden="true"></span></button>
`:d}
${w?p`
<div role="group" aria-labelledby="menu-wifi-scale">
<p class="menu-heading" id="menu-wifi-scale" role="presentation">${t("v4_wifi_scale_heading","Wi-Fi colors")}</p>
${h("absolute"===e.wifiScale,t("v4_wifi_scale_absolute","Signal strength"),()=>s({type:"set-wifi-scale",scale:"absolute"}))}
${h("relative"===e.wifiScale,t("v4_wifi_scale_relative","Compare sampled spots"),()=>s({type:"set-wifi-scale",scale:"relative"}))}
<div class="wifi-scale-legend">
<small class="menu-note">${"relative"===e.wifiScale?t("v4_wifi_relative_note","Colors compare sampled spots, not absolute quality."):t("v4_wifi_absolute_note","Colors show signal strength.")}</small>
${_?p`<small class="menu-note">${t("v4_wifi_sampled_range","Sampled range")}: ${$(_.min)} \u2013 ${$(_.max)}</small>`:d}
<span class="wifi-scale-ramp" role="img" aria-label=${`${t("v4_wifi_scale_legend","Color scale")}: ${$(w.min)} \u2013 ${$(w.max)}`}></span>
<small class="menu-note wifi-scale-labels"><span>${$(w.min)}</span><span>${$(w.max)}</span></small>
</div>
</div>
`:d}
${e.resources.entry?.floorTypesUrl?p`
<button
class="ms-row ms-row--menu"
type="button"
role="menuitemcheckbox"
aria-checked=${String(!!e.floorTypes)}
tabindex="-1"
data-floor-types
@click=${()=>s({type:"toggle-floor-types"})}
><span>${t("v4_floor_types","Carpet and vents")}${((e,a)=>{if(!e||"loading"===e.status)return d;let t="failed"===e.status?a("v4_floor_types_failed","Couldn't load carpet and vents"):e.carpet.length||e.vent.length?a("v4_floor_types_legend","Brown is carpet, blue is a vent"):a("v4_floor_types_empty","None mapped yet \xb7 the robot finds them while cleaning");return p`<small class="menu-note">${t}</small>`})(e.floorTypes,t)}</span><span class="ms-switch" aria-checked=${String(!!e.floorTypes)} aria-hidden="true"></span></button>
`:d}
${e.resources.entry?.coverageUrl?p`
<button class="ms-row ms-row--menu" type="button" role="menuitemcheckbox"
aria-checked=${String(!!(1&e.coverageModes))} tabindex="-1"
data-vacuum-coverage @click=${()=>s({type:"toggle-cleaning-coverage",mode:"vacuum"})}
><span>${t("v4_vacuum_coverage","Vacuum coverage")}</span><span class="ms-switch" aria-checked=${String(!!(1&e.coverageModes))} aria-hidden="true"></span></button>
<button class="ms-row ms-row--menu" type="button" role="menuitemcheckbox"
aria-checked=${String(!!(2&e.coverageModes))} tabindex="-1"
data-mop-coverage @click=${()=>s({type:"toggle-cleaning-coverage",mode:"mop"})}
><span>${t("v4_mop_coverage","Mop coverage")}${e.liveCoverage?.truncated?p`<small class="menu-note">${t("v4_coverage_partial","Coverage is partial.")}</small>`:d}</span><span class="ms-switch" aria-checked=${String(!!(2&e.coverageModes))} aria-hidden="true"></span></button>
`:d}
${"live"===e.dataMode?p`
<button
class="ms-row ms-row--menu"
type="button"
role="menuitemcheckbox"
aria-checked=${String("follow"===e.followMode)}
tabindex="-1"
data-follow-robot
aria-disabled=${String(!o&&"follow"!==e.followMode)}
@click=${()=>s({type:"set-follow-mode",mode:"follow"===e.followMode?"off":"follow"})}
><span>${t("v4_follow_robot","Follow the robot")}</span><span class="ms-switch" aria-checked=${String("follow"===e.followMode)} aria-hidden="true"></span></button>
<button class="ms-row ms-row--menu" type="button" role="menuitemcheckbox"
aria-checked=${String("ride"===e.followMode)} tabindex="-1" data-ride-along
aria-disabled=${String(!u&&"ride"!==e.followMode)}
@click=${()=>s({type:"set-follow-mode",mode:"ride"===e.followMode?"off":"ride"})}
><span>${t("v4_ride_along","Ride along in 3D")}</span><span class="ms-switch" aria-checked=${String("ride"===e.followMode)} aria-hidden="true"></span></button>
${o&&u?d:p`<small class="menu-note">${t("v4_follow_needs_live_pose","Following needs a live position; Ride along also needs the robot's heading.")}</small>`}
`:d}
<div role="group" aria-labelledby="menu-detail">
<p class="menu-heading" id="menu-detail" role="presentation">${t("map_quality_label","Map detail")}</p>
${g("auto",t("map_quality_auto","Auto detail"))}
${g("efficient",t("map_quality_efficient","Efficient"))}
${g("balanced",t("map_quality_balanced","Balanced"))}
${g("maximum",t("map_quality_maximum","Maximum"))}
</div>
${this.#e.available()?p`<button class="ms-row ms-row--menu" type="button" role="menuitem" tabindex="-1" aria-haspopup="dialog" @click=${()=>this.#e.show()}>${t("v4_map_zoom","Map zoom")}</button>`:d}
<button class="ms-row ms-row--menu" type="button" role="menuitem" tabindex="-1" @click=${()=>{this.menu.close(!1),i()}}>${t("v4_map_diagnostics","Map diagnostics")}</button>
</div>`}
`}};export{$ as MapOptions};
/*! Licenses: map-options-ILDD23SG.js.LEGAL.txt */