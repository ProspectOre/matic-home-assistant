import{a}from"./chunk-CEDW6BZF.js";import{a as e}from"./chunk-7LZYODC2.js";import{Q as t,x as o}from"./chunk-HA25V4VJ.js";import{Ba as n,K as r,xa as l}from"./chunk-VWZ67VJ5.js";var m=class{constructor(e){this.menu=new a(e,".overflow-wrap",".overflow")}render({state:a,narrow:m,t:p,intent:c,diagnostics:u}){let i=(a,e,r)=>l` <button class="ms-row ms-row--menu" type="button" role="menuitemradio" aria-checked=${String(a)} data-selected=${a?"true":n} tabindex="-1" @click=${r}><span>${e}</span>${a?t(o):n}</button> `,s=(e,t)=>i(a.quality===e,t,()=>c({type:"set-quality",quality:e}));return l`
<style>
${e.cssText}
.overflow-menu {
position: absolute;
z-index: 18;
inset-block-start: calc(100% + var(--ms-space-1));
inset-inline-end: 0;
display: grid;
gap: var(--ms-space-1);
min-inline-size: 14rem;
padding: var(--ms-space-1);
}
.overflow-menu .ms-row { justify-content: flex-start; }
.overflow-menu [role="menuitemcheckbox"] { justify-content: space-between; gap: var(--ms-space-3); }
.overflow-menu [role="group"] { display: grid; gap: var(--ms-space-1); }
.overflow-menu [role="group"] + * { border-block-start: 1px solid var(--ms-line); padding-block-start: var(--ms-space-1); }
.menu-heading { margin: 0; padding: var(--ms-space-2) var(--ms-space-3) var(--ms-space-1); color: var(--ms-text-quiet); font-size: var(--ms-t-sm); font-weight: var(--ms-w-bold); }

</style>
<div id="map-options" class="overflow-menu ms-surface ms-surface--overlay" role="menu" aria-label=${p("v4_map_options","Map options")}>
${m?l`
<div role="group" aria-labelledby="menu-display">
<p class="menu-heading" id="menu-display" role="presentation">${p("v4_map_display","Map display")}</p>
${"top"===r(a)?l`
${i("photo"===a.appearance,p("map_style_photo","Photo"),()=>c({type:"set-appearance",appearance:"photo"}))}
${i("rooms"===a.appearance,p("v4_room_colours","Room colors"),()=>c({type:"set-appearance",appearance:"rooms"}))}
`:n}
<button
class="ms-row ms-row--menu"
type="button"
role="menuitemcheckbox"
aria-checked=${String(a.labelsVisible)}
tabindex="-1"
@click=${()=>c({type:"toggle-labels"})}
><span>${p("v4_room_names","Room names")}</span><span class="ms-switch" aria-checked=${String(a.labelsVisible)} aria-hidden="true"></span></button>
</div>
`:n}
<div role="group" aria-labelledby="menu-detail">
<p class="menu-heading" id="menu-detail" role="presentation">${p("map_quality_label","Map detail")}</p>
${s("auto",p("map_quality_auto","Auto detail"))}
${s("efficient",p("map_quality_efficient","Efficient"))}
${s("balanced",p("map_quality_balanced","Balanced"))}
${s("maximum",p("map_quality_maximum","Maximum"))}
</div>
<button class="ms-row ms-row--menu" type="button" role="menuitem" tabindex="-1" @click=${()=>{this.menu.close(!1),u()}}>${p("v4_map_diagnostics","Map diagnostics")}</button>
</div>
`}};export{m as MapOptions};