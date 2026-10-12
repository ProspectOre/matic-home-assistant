import{L as a,p,q as l,r as c,s as u,t as b,u as d,z as m}from"./chunk-YNV3WCTZ.js";import{b as e,f as i}from"./chunk-MMLYFANH.js";var _=["outline","paint","erase","pan"],g=(s,t,$)=>{let{draw:n}=s,r=`${n.brushMeters.toFixed(2)} m`;return e`
    <div
      class=${`draw-tools draw-tools--${$} ms-segment`}
      data-zone=${String(n.tool==="outline")}
      role="toolbar"
      aria-label=${t.t("v4_draw_tools","Draw area tools")}
      data-map-control
    >
      ${_.map(o=>e`
        <button
          class="ms-btn"
          type="button"
          aria-pressed=${String(n.tool===o)}
          data-tool=${o}
          @click=${()=>t.intent({type:"set-draw-tool",tool:o})}
        >${a(o==="outline"?m:o==="paint"?c:o==="erase"?b:d)}<span class="ms-btn__label">${o==="outline"?t.t("v4_zone_tool","Points"):o==="paint"?t.t("area_paint","Paint"):o==="erase"?t.t("area_erase","Erase"):t.t("move_map","Move map")}</span></button>
      `)}
      <button
        class="ms-btn"
        type="button"
        ?disabled=${n.strokeCount===0}
        @click=${()=>t.intent({type:"undo-draft"})}
      >${a(p)}<span class="ms-btn__label">${t.t("undo","Undo")}</span></button>
      <button
        class="ms-btn"
        type="button"
        ?disabled=${n.redo.length===0}
        @click=${()=>t.intent({type:"redo-draft"})}
      >${a(l)}<span class="ms-btn__label">${t.t("redo","Redo")}</span></button>
      ${n.tool!=="outline"?e`<button
        class="ms-btn draw-brush"
        type="button"
        aria-label=${t.t("v4_brush_button","Brush width, {brush}. Opens brush settings.",{brush:r})}
        aria-expanded=${String(s.precisionOpen)}
        aria-haspopup="dialog"
        @click=${t.openBrush}
      >${a(u)}<span class="ms-btn__label">${t.t("v4_brush","Brush {brush}",{brush:r})}</span></button>`:i}
    </div>
  `};export{g as renderDrawTools};
