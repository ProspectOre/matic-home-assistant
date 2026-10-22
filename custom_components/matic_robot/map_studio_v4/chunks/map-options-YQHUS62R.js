import{a as u}from"./chunk-CEDW6BZF.js";import{a as d}from"./chunk-5UGTX6JI.js";import{h as c}from"./chunk-YCCYNT5Q.js";import{Q as m,x as p}from"./chunk-HBWVMAKF.js";import{pa as t,ta as r}from"./chunk-TB4TQLUO.js";var v=class{constructor(a){this.menu=new u(a,".overflow-wrap",".overflow")}render({state:a,narrow:b,t:e,intent:n,diagnostics:y}){let i=(o,l,g)=>t` <button class="ms-row ms-row--menu" type="button" role="menuitemradio" aria-checked=${String(o)} data-selected=${o?"true":r} tabindex="-1" @click=${g}><span>${l}</span>${o?m(p):r}</button> `,s=(o,l)=>i(a.quality===o,l,()=>n({type:"set-quality",quality:o}));return t`
<style>
${d.cssText}
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
<div id="map-options" class="overflow-menu ms-surface ms-surface--overlay" role="menu" aria-label=${e("v4_map_options","Map options")}>
${b?t`
<div role="group" aria-labelledby="menu-display">
<p class="menu-heading" id="menu-display" role="presentation">${e("v4_map_display","Map display")}</p>
${c(a)==="top"?t`
${i(a.appearance==="photo",e("map_style_photo","Photo"),()=>n({type:"set-appearance",appearance:"photo"}))}
${i(a.appearance==="rooms",e("v4_room_colours","Room colors"),()=>n({type:"set-appearance",appearance:"rooms"}))}
`:r}
<button
class="ms-row ms-row--menu"
type="button"
role="menuitemcheckbox"
aria-checked=${String(a.labelsVisible)}
tabindex="-1"
@click=${()=>n({type:"toggle-labels"})}
><span>${e("v4_room_names","Room names")}</span><span class="ms-switch" aria-checked=${String(a.labelsVisible)} aria-hidden="true"></span></button>
</div>
`:r}
<div role="group" aria-labelledby="menu-detail">
<p class="menu-heading" id="menu-detail" role="presentation">${e("map_quality_label","Map detail")}</p>
${s("auto",e("map_quality_auto","Auto detail"))}
${s("efficient",e("map_quality_efficient","Efficient"))}
${s("balanced",e("map_quality_balanced","Balanced"))}
${s("maximum",e("map_quality_maximum","Maximum"))}
</div>
<button class="ms-row ms-row--menu" type="button" role="menuitem" tabindex="-1" @click=${()=>{this.menu.close(!1),y()}}>${e("v4_map_diagnostics","Map diagnostics")}</button>
</div>
`}};export{v as MapOptions};
