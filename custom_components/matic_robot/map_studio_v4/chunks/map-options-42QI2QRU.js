import{a as f}from"./chunk-CEDW6BZF.js";import{a as y,b}from"./chunk-7XLDKVPG.js";import{a as m}from"./chunk-GUPUBXCL.js";import{h as d}from"./chunk-UVS75YJ6.js";import{A as c,T as u}from"./chunk-76KZL7L3.js";import{oa as p,pa as t,ta as r}from"./chunk-V5GBK2JT.js";var _=class{constructor(o){p(o.renderRoot,[...m,y,b]),this.menu=new f(o,".overflow-wrap",".overflow")}render({state:o,narrow:$,t:e,intent:n,diagnostics:v}){let l=(a,s,g)=>t`
<button class="ms-row ms-row--menu" type="button" role="menuitemradio" aria-checked=${String(a)} data-selected=${a?"true":r} tabindex="-1" @click=${g}><span>${s}</span>${a?u(c):r}</button>
`,i=(a,s)=>l(o.quality===a,s,()=>n({type:"set-quality",quality:a}));return t`
<div id="map-options" class="overflow-menu ms-surface ms-surface--overlay" role="menu" aria-label=${e("v4_map_options","Map options")}>
${$?t`
<div role="group" aria-labelledby="menu-display">
<p class="menu-heading" id="menu-display" role="presentation">${e("v4_map_display","Map display")}</p>
${d(o)==="top"?t`
${l(o.appearance==="photo",e("map_style_photo","Photo"),()=>n({type:"set-appearance",appearance:"photo"}))}
${l(o.appearance==="rooms",e("v4_room_colours","Room colors"),()=>n({type:"set-appearance",appearance:"rooms"}))}
`:r}
<button
class="ms-row ms-row--menu"
type="button"
role="menuitemcheckbox"
aria-checked=${String(o.labelsVisible)}
tabindex="-1"
@click=${()=>n({type:"toggle-labels"})}
><span>${e("v4_room_names","Room names")}</span><span class="ms-switch" aria-checked=${String(o.labelsVisible)} aria-hidden="true"></span></button>
</div>
`:r}
<div role="group" aria-labelledby="menu-detail">
<p class="menu-heading" id="menu-detail" role="presentation">${e("map_quality_label","Map detail")}</p>
${i("auto",e("map_quality_auto","Auto detail"))}
${i("efficient",e("map_quality_efficient","Efficient"))}
${i("balanced",e("map_quality_balanced","Balanced"))}
${i("maximum",e("map_quality_maximum","Maximum"))}
</div>
<button class="ms-row ms-row--menu" type="button" role="menuitem" tabindex="-1" @click=${()=>{this.menu.close(!1),v()}}>${e("v4_map_diagnostics","Map diagnostics")}</button>
</div>
`}};export{_ as MapOptions};
