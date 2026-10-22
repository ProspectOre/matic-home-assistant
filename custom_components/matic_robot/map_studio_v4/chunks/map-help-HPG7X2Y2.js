import{h as l}from"./chunk-YCCYNT5Q.js";import{pa as t}from"./chunk-TB4TQLUO.js";var v=({state:e,coarse:n,t:o,close:p})=>{let a=e.workflow==="draw",r=l(e)==="top",i=o("v4_how_to_move","How to move the map"),s=n?[[o("v4_touch","Touch"),a?o("v4_touch_draw_help","Drag to paint \xB7 two fingers to move or zoom"):o("v4_touch_help","Drag to move the map \xB7 pinch to zoom \xB7 twist two fingers to rotate")]]:[[o("v4_trackpad","Trackpad"),o("v4_trackpad_help","Scroll to move the map \xB7 pinch to zoom \xB7 twist to rotate")],[o("v4_mouse","Mouse"),a?o("v4_mouse_draw_help","Drag to paint \xB7 right-drag or Space-drag to move \xB7 wheel to zoom"):r?o("v4_mouse_top_help","Drag to move the map \xB7 wheel to zoom"):o("v4_mouse_help","Drag to move the map \xB7 right-drag or Shift-drag to rotate \xB7 wheel to zoom")],[o("v4_keyboard","Keyboard"),a?e.draw.tool==="outline"?o("v4_zone_keyboard_help","Focus the map, aim with arrow keys, and press Enter to place points. The edges join automatically after three points. Keep adding points or Tab to a point; arrows move it, Delete removes it, and Escape cancels a drag."):o("v4_keyboard_draw_help","Focus the map, use arrow keys to aim, then Enter to paint or erase at the crosshair. D selects Paint; E selects Erase."):r?o("v4_keyboard_top_help","WASD or arrows to move \xB7 +/\u2212 to zoom \xB7 0 to fit"):o("v4_keyboard_help","WASD to move \xB7 Q/E or arrows to orbit \xB7 +/\u2212 to zoom \xB7 0 to fit")]];return t`
<style>
.map-rail { --help-top: var(--row); --help-bottom: 116px; }
.map-rail:has(.appearance-switch) { --help-top: calc(2 * var(--row)); }
.map-root:has(.selection-chip) .map-rail { --help-bottom: calc(116px + 4rem); }
:host([narrow]) .map-rail { --help-bottom: calc(var(--map-sheet-offset, 0px) + 44px + var(--ms-space-2)); }
.map-rail:has(.map-chip) { --help-top: calc(2 * var(--row)); }
.map-rail:has(.map-chip):has(.appearance-switch) { --help-top: calc(3 * var(--row)); }
.navigation-help { position: absolute; inset-block-start: var(--help-top); inset-inline-end: 0; max-block-size: calc(100% - var(--help-top) - var(--help-bottom)); overflow: auto; box-sizing: border-box; inline-size: 22rem; max-inline-size: 100%; padding: 0.8rem 0.9rem; font-size: 0.74rem; line-height: 1.45; }
.navigation-help header { display: flex; align-items: center; justify-content: space-between; gap: var(--ms-space-2); margin-block-end: 0.5rem; }
.navigation-help h2 { margin: 0; font-size: var(--ms-t-sm); font-weight: var(--ms-w-bold); }
.navigation-help dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.35rem 0.65rem; margin: 0; }
.navigation-help dt { font-weight: 750; }
.navigation-help dd { margin: 0; color: var(--ms-text-quiet); }
@media (any-pointer: coarse) { .navigation-help .ms-btn--sm { min-inline-size: var(--ms-control); min-block-size: var(--ms-control); } }
</style>
<div id="navigation-help" class="navigation-help ms-surface ms-surface--floating" role="dialog" aria-modal="false" aria-label=${i}>
<header>
<h2>${i}</h2>
<button class="ms-btn ms-btn--sm" type="button" @click=${p}>${o("v4_close","Close")}</button>
</header>
<dl>${s.map(([m,h])=>t`<dt>${m}</dt><dd>${h}</dd>`)}</dl>
</div>
`};export{v as renderMapHelp};
