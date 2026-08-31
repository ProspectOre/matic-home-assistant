import{A as f,i as v,v as g,w as o,x as c,y as b,z as $}from"./chunk.js";var p=["vacuum","mop","vacuum_and_mop"],h=["quick","standard","heavy_duty"],l=d=>d.currentTarget.value,m=d=>d.currentTarget.checked,u=class extends b{constructor(){super(...arguments);this.state=v()}static{this.properties={state:{attribute:!1},localize:{attribute:!1}}}static{this.styles=g`
    :host { display: block; min-inline-size: 0; }
    * { box-sizing: border-box; }
    button, input, select { font: inherit; }
    button, select, input[type="checkbox"] { cursor: pointer; }
    .stack { display: grid; gap: 0.7rem; }
    .subtle { margin: 0; color: var(--secondary-text-color, #687984); font-size: 0.76rem; line-height: 1.45; }
    .loading, .empty, .problem, .notice {
      padding: 0.75rem;
      border-radius: 0.7rem;
      background: var(--secondary-background-color, #f3f6f7);
      font-size: 0.78rem;
      line-height: 1.45;
    }
    .problem, .notice[data-tone="error"] {
      color: var(--error-color, #b3261e);
      background: color-mix(in srgb, var(--error-color, #b3261e) 9%, transparent);
    }
    .notice[data-tone="success"] {
      color: var(--success-color, #218653);
      background: color-mix(in srgb, var(--success-color, #218653) 10%, transparent);
    }
    .notice[data-tone="warning"] {
      color: var(--warning-color, #8a5b00);
      background: color-mix(in srgb, var(--warning-color, #8a5b00) 11%, transparent);
    }
    .field { display: grid; gap: 0.3rem; font-size: 0.76rem; font-weight: 650; }
    .field input, .field select {
      inline-size: 100%;
      min-block-size: 2.75rem;
      padding-inline: 0.7rem;
      border: 1px solid var(--divider-color, #c3ccd1);
      border-radius: 0.65rem;
      color: var(--primary-text-color, #263238);
      background: var(--card-background-color, #fff);
    }
    .split { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.6rem; }
    .list { display: grid; gap: 0.45rem; }
    .list-button, .room, .plan-room, .floor, .snapshot {
      min-block-size: 2.75rem;
      border: 1px solid var(--divider-color, #d1d8dc);
      border-radius: 0.7rem;
      color: inherit;
      background: var(--secondary-background-color, #f5f7f8);
    }
    .list-button, .floor, .snapshot {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      inline-size: 100%;
      padding: 0.55rem 0.7rem;
      text-align: start;
    }
    .list-button[aria-pressed="true"], .floor[aria-pressed="true"], .snapshot[aria-current="true"] {
      border-color: var(--primary-color, #0678ce);
      background: color-mix(in srgb, var(--primary-color, #0678ce) 9%, transparent);
    }
    .room { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 0.6rem; padding: 0.5rem 0.65rem; }
    .room input { inline-size: 1.2rem; block-size: 1.2rem; }
    .plan-room { display: grid; gap: 0.5rem; padding: 0.65rem; }
    .plan-room-head { display: flex; align-items: center; gap: 0.4rem; min-inline-size: 0; }
    .plan-room-head strong { overflow: hidden; flex: 1; text-overflow: ellipsis; white-space: nowrap; font-size: 0.78rem; }
    .icon-button {
      min-inline-size: 2.75rem;
      min-block-size: 2.75rem;
      border: 0;
      border-radius: 0.6rem;
      color: inherit;
      background: transparent;
    }
    .toolbar { display: flex; flex-wrap: wrap; gap: 0.45rem; }
    .toolbar button {
      min-block-size: 2.75rem;
      padding-inline: 0.75rem;
      border: 1px solid var(--divider-color, #c3ccd1);
      border-radius: 0.65rem;
      color: inherit;
      background: var(--card-background-color, #fff);
    }
    .toolbar .danger { color: var(--error-color, #b3261e); border-color: currentColor; }
    .toolbar .primary { color: white; border-color: var(--primary-color, #0678ce); background: var(--primary-color, #0678ce); }
    .checkbox { display: flex; align-items: center; gap: 0.5rem; min-block-size: 2.75rem; font-size: 0.76rem; font-weight: 650; }
    .checkbox input { inline-size: 1.2rem; block-size: 1.2rem; }
    .floor small, .snapshot small, .list-button small { margin-inline-start: auto; color: var(--secondary-text-color, #687984); }
    .timeline { display: grid; gap: 0.55rem; }
    .timeline input[type="range"] { inline-size: 100%; min-block-size: 2.75rem; }
    .diagnostics { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.45rem 0.7rem; margin: 0; font-size: 0.75rem; }
    .diagnostics dt { color: var(--secondary-text-color, #687984); }
    .diagnostics dd { margin: 0; font-weight: 650; }
    details { border-block-start: 1px solid var(--divider-color, #d1d8dc); padding-block-start: 0.65rem; }
    summary { min-block-size: 2.75rem; cursor: pointer; font-size: 0.78rem; font-weight: 650; }
    @media (max-width: 25rem) { .split { grid-template-columns: 1fr; } }
    @media (forced-colors: active) {
      .list-button[aria-pressed="true"], .floor[aria-pressed="true"], .snapshot[aria-current="true"] { outline: 2px solid Highlight; }
    }
  `}#e(e,a,s){return $(this.localize,e,a,s)}#s(e){return e==="vacuum"?this.#e("vacuum","Vacuum"):e==="mop"?this.#e("mop","Mop"):this.#e("vacuum_and_mop","Vacuum + mop")}#o(e){return e==="quick"?this.#e("quick","Quick"):e==="standard"?this.#e("standard","Optimal"):this.#e("heavy_duty","Heavy Duty")}#t(e){this.dispatchEvent(new CustomEvent(f,{detail:e,bubbles:!0,composed:!0}))}#i(){return this.state.notice?o`
      <div class="notice" data-tone=${this.state.notice.tone} role=${this.state.notice.tone==="error"?"alert":"status"}>
        ${this.state.notice.text}
      </div>
    `:c}#a(e,a,s){return e==="loading"||e==="idle"?o`<div class="loading" role="status">${this.#e("map_loading","Loading\u2026")}</div>`:e==="error"?o`<div class="problem" role="alert">${this.#e("v4_workspace_unavailable","This workspace is unavailable right now.")} ${a==="request-failed"?this.#e("v4_try_again","Try again shortly."):this.#e("v4_return_live_retry","Return to the live map and retry.")}</div>`:e==="empty"?o`<div class="empty">${this.#e("v4_nothing_saved","Nothing saved yet.")}</div>`:s}#l(){let e=this.state.resources.plans;return this.#a(e.status,e.problem,o`
      <div class="stack">
        <div class="list" role="group" aria-label=${this.#e("v4_rooms_to_clean","Rooms to clean")}>
          ${(e.value?.rooms||[]).map(a=>{let s=this.state.selection.roomIds.includes(a.roomId);return o`
              <label class="room">
                <input
                  type="checkbox"
                  .checked=${s}
                  @change=${()=>this.#t({type:"toggle-room",roomId:a.roomId})}
                >
                <span>${a.name}</span>
              </label>
            `})}
        </div>
        <div class="split">
          <label class="field">${this.#e("v4_cleaning_system","Cleaning system")}
            <select
              .value=${this.state.selection.cleaningMode}
              @change=${a=>this.#t({type:"patch-room-settings",cleaningMode:l(a)})}
            >${p.map(a=>o`<option value=${a}>${this.#s(a)}</option>`)}</select>
          </label>
          <label class="field">${this.#e("cleaning_mode","Cleaning mode")}
            <select
              .value=${this.state.selection.coverageSetting}
              @change=${a=>this.#t({type:"patch-room-settings",coverageSetting:l(a)})}
            >${h.map(a=>o`<option value=${a}>${this.#o(a)}</option>`)}</select>
          </label>
        </div>
        <p class="subtle">${this.#e("v4_room_selection_hint","Select rooms here or directly on the map. The map and list stay in sync.")}</p>
        ${this.#i()}
      </div>
    `)}#c(e){let a=this.state.planDraft.rooms,t=a.find(r=>r.roomId===e)?a.filter(r=>r.roomId!==e):[...a,{roomId:e,cleaningMode:"vacuum",coverageSetting:"standard"}];this.#t({type:"patch-plan-draft",patch:{rooms:t}})}#r(e,a){let s=this.state.planDraft.rooms.map((t,r)=>r===e?{...t,...a}:t);this.#t({type:"patch-plan-draft",patch:{rooms:s}})}#n(e,a){let s=e+a,t=[...this.state.planDraft.rooms];if(s<0||s>=t.length)return;let[r]=t.splice(e,1);r&&(t.splice(s,0,r),this.#t({type:"patch-plan-draft",patch:{rooms:t}}))}#d(){let e=this.state.resources.plans,a=e.value,s=this.state.planDraft;return this.#a(e.status,e.problem,o`
      <div class="stack">
        <div class="split">
          <label class="field">${this.#e("v4_saved_plan","Saved plan")}
            <select
              .value=${this.state.selection.planId||""}
              @change=${t=>this.#t({type:"select-plan",planId:l(t)||null})}
            >
              <option value="">${this.#e("plan_new","New plan")}</option>
              ${(a?.plans||[]).map(t=>o`<option value=${t.id}>${t.name}</option>`)}
            </select>
          </label>
          <button class="list-button" type="button" @click=${()=>this.#t({type:"select-plan",planId:null})}>＋ ${this.#e("plan_new","New plan")}</button>
        </div>
        <label class="field">${this.#e("plan_name","Plan name")}
          <input
            maxlength="128"
            autocomplete="off"
            .value=${s.name}
            @input=${t=>this.#t({type:"patch-plan-draft",patch:{name:l(t)}})}
          >
        </label>
        <div class="split">
          <label class="field">${this.#e("plan_run_behavior","Run order")}
            <select
              .value=${s.runBehavior}
              @change=${t=>this.#t({type:"patch-plan-draft",patch:{runBehavior:l(t)==="ordered"?"ordered":"intelligent"}})}
            >
              <option value="intelligent">${this.#e("plan_intelligent","Smart rotation")}</option>
              <option value="ordered">${this.#e("plan_ordered","Listed order")}</option>
            </select>
          </label>
          <label class="checkbox"><input type="checkbox" .checked=${s.enabled} @change=${t=>this.#t({type:"patch-plan-draft",patch:{enabled:m(t)}})}>${this.#e("plan_enabled","Enabled")}</label>
        </div>
        <div class="list" aria-label=${this.#e("plan_rooms","Plan rooms")}>
          ${(a?.rooms||[]).map(t=>{let r=s.rooms.some(i=>i.roomId===t.roomId);return o`<label class="room"><input type="checkbox" .checked=${r} @change=${()=>this.#c(t.roomId)}><span>${t.name}</span></label>`})}
        </div>
        ${s.rooms.length?o`
          <div class="list" aria-label=${this.#e("v4_room_order_settings","Room order and settings")}>
            ${s.rooms.map((t,r)=>{let i=a?.rooms.find(n=>n.roomId===t.roomId)?.name||"Room";return o`
                <div class="plan-room">
                  <div class="plan-room-head">
                    <strong>${r+1}. ${i}</strong>
                    <button class="icon-button" type="button" aria-label=${this.#e("move_room_up","Move {room} earlier",{room:i})} ?disabled=${r===0} @click=${()=>this.#n(r,-1)}>↑</button>
                    <button class="icon-button" type="button" aria-label=${this.#e("move_room_down","Move {room} later",{room:i})} ?disabled=${r===s.rooms.length-1} @click=${()=>this.#n(r,1)}>↓</button>
                  </div>
                  <div class="split">
                    <label class="field">${this.#e("v4_cleaning_system","Cleaning system")}
                      <select .value=${t.cleaningMode} @change=${n=>this.#r(r,{cleaningMode:l(n)})}>${p.map(n=>o`<option value=${n}>${this.#s(n)}</option>`)}</select>
                    </label>
                    <label class="field">${this.#e("cleaning_mode","Cleaning mode")}
                      <select .value=${t.coverageSetting} @change=${n=>this.#r(r,{coverageSetting:l(n)})}>${h.map(n=>o`<option value=${n}>${this.#o(n)}</option>`)}</select>
                    </label>
                  </div>
                </div>
              `})}
          </div>
        `:c}
        <details>
          <summary>${this.#e("v4_completion_options","Completion options")}</summary>
          <div class="stack">
            <label class="checkbox"><input type="checkbox" .checked=${s.returnToBase} @change=${t=>this.#t({type:"patch-plan-draft",patch:{returnToBase:m(t)}})}>${this.#e("plan_return_to_base","Return to the dock when finished")}</label>
            <label class="checkbox"><input type="checkbox" .checked=${s.finishCurrentRoom} @change=${t=>this.#t({type:"patch-plan-draft",patch:{finishCurrentRoom:m(t)}})}>${this.#e("plan_finish_room","Finish the active room after Stop")}</label>
            ${s.finishCurrentRoom?o`<label class="field">${this.#e("plan_threshold","Finish threshold")} · ${s.finishCurrentRoomThreshold}%<input type="range" min="0" max="100" step="5" .value=${String(s.finishCurrentRoomThreshold)} @input=${t=>this.#t({type:"patch-plan-draft",patch:{finishCurrentRoomThreshold:Number(l(t))}})}></label>`:c}
          </div>
        </details>
        <div class="toolbar">
          ${s.id?o`
            <button
              class="danger"
              type="button"
              aria-label=${this.#e("plan_delete","Delete plan")}
              @click=${()=>this.#t({type:"open-dialog",dialog:"confirmDeletePlan"})}
            >${this.#e("plan_delete","Delete")}</button>
          `:c}
        </div>
        ${this.#i()}
      </div>
    `)}#p(){let e=this.state.resources.areas;return o`
      <div class="stack">
        <matic-precision-controls-v4 .state=${this.state} .localize=${this.localize}></matic-precision-controls-v4>
        <p class="subtle">${this.#e("v4_draw_floor_hint","Paint only on the mapped floor. Zoom and pan never change the saved outline.")}</p>
        <div class="toolbar">
          <button
            type="button"
            ?disabled=${this.state.draw.circles.length===0}
            @click=${()=>this.#t({type:"clear-draft"})}
          >${this.#e("clear","Clear")}</button>
        </div>
        ${this.#a(e.status,e.problem,o`
          <div class="list" aria-label=${this.#e("area_workspace_title","Saved custom areas")}>
            <button class="list-button" type="button" @click=${()=>this.#t({type:"select-area",areaId:null})}>＋ ${this.#e("area_new","New outline")}</button>
            ${(e.value?.areas||[]).map(a=>o`
              <button class="list-button" type="button" @click=${()=>{this.#t({type:"select-area",areaId:a.id}),this.#t({type:"open-workflow",workflow:"areaReview"})}}>
                <span>${a.name}</span>
                <small>${a.status==="current"?this.#e("area_workspace_ready","Ready"):this.#e("v4_review","Review")}</small>
              </button>
            `)}
          </div>
        `)}
      </div>
    `}#h(){let e=this.state.areaDraft,a=e.canRebind||e.status==="review",s=e.status==="stale"||e.status==="unknown";return o`
      <div class="stack">
        ${a?o`<div class="notice" data-tone="warning" role="status">${this.#e("area_review_required","Review the saved outline on this current map, then confirm it.")}</div>`:c}
        ${s?o`<div class="problem" role="alert">${this.#e("area_redraw_required","This outline no longer matches the current room map. Redraw it before saving.")}</div>`:c}
        <label class="field">${this.#e("area_name","Area name")}
          <input maxlength="128" autocomplete="off" .value=${e.name} @input=${t=>this.#t({type:"patch-area-draft",patch:{name:l(t)}})}>
        </label>
        <div class="split">
          <label class="field">${this.#e("v4_cleaning_system","Cleaning system")}
            <select .value=${e.cleaningMode} @change=${t=>this.#t({type:"patch-area-draft",patch:{cleaningMode:l(t)}})}>${p.map(t=>o`<option value=${t}>${this.#s(t)}</option>`)}</select>
          </label>
          <label class="field">${this.#e("cleaning_mode","Cleaning mode")}
            <select .value=${e.coverageSetting} @change=${t=>this.#t({type:"patch-area-draft",patch:{coverageSetting:l(t)}})}>${h.map(t=>o`<option value=${t}>${this.#o(t)}</option>`)}</select>
          </label>
        </div>
        <p class="subtle">${this.#e("v4_private_marks","{count} map-space marks. The outline stays private and floor-bound.",{count:this.state.draw.circles.length})}</p>
        <div class="toolbar">
          <button type="button" @click=${()=>this.#t({type:"open-workflow",workflow:"draw"})}>${this.#e("v4_edit_outline","Edit outline")}</button>
          ${e.id?o`
            <button
              class="danger"
              type="button"
              aria-label=${this.#e("area_delete","Delete area")}
              @click=${()=>this.#t({type:"open-dialog",dialog:"confirmDeleteArea"})}
            >${this.#e("area_delete","Delete")}</button>
          `:c}
        </div>
        ${this.#i()}
      </div>
    `}#m(){let e=this.state.resources.history,a=e.value,s=a?.floors.find(i=>i.id===this.state.selection.floorId)||a?.floors.find(i=>i.active)||a?.floors[0],t=s?.snapshots||[],r=this.state.selection.historyId?Math.max(0,t.findIndex(i=>i.id===this.state.selection.historyId)):t.length;return this.#a(e.status,e.problem,o`
      <div class="stack">
        ${(a?.floors.length||0)>1?o`
          <div class="list" role="listbox" aria-label=${this.#e("v4_mapped_floors","Mapped floors")}>
            ${(a?.floors||[]).map((i,n)=>o`
              <button
                class="floor"
                type="button"
                role="option"
                aria-selected=${String(i.id===s?.id)}
                aria-pressed=${String(i.id===s?.id)}
                @click=${()=>this.#t({type:"set-floor",floorId:i.id})}
              >
                <span>${i.label||(i.active?this.#e("v4_current_floor","Current floor"):this.#e("v4_saved_floor","Saved floor {number}",{number:i.ordinal??n}))}</span>
                <small>${i.active?this.#e("map_timeline_live_action","Live"):this.#e("v4_read_only","Read only")}</small>
              </button>
            `)}
          </div>
        `:c}
        <div class="timeline">
          <label class="field">${this.#e("map_timeline_label","Map timeline")}
            <input
              type="range"
              min="0"
              max=${String(t.length)}
              step="1"
              .value=${String(r)}
              ?disabled=${!t.length}
              @input=${i=>{let n=Number(l(i));this.#t({type:"set-history",historyId:n===t.length?null:t[n]?.id||null})}}
            >
          </label>
          <div class="list">
            <button class="snapshot" type="button" aria-current=${String(!this.state.selection.historyId)} @click=${()=>this.#t({type:"set-history",historyId:null})}><span>${this.#e("map_timeline_live_action","Live")}</span><small>${this.#e("v4_current","Current")}</small></button>
            ${t.map((i,n)=>o`
              <button class="snapshot" type="button" aria-current=${String(i.id===this.state.selection.historyId)} @click=${()=>this.#t({type:"set-history",historyId:i.id})}>
                <span>${this.#u(i.createdAt)}</span><small>${n+1} of ${t.length}</small>
              </button>
            `)}
          </div>
        </div>
        <p class="subtle">${this.#e("v4_history_privacy","Saved maps are floor-scoped and never show a live robot position.")}</p>
      </div>
    `)}#u(e){try{return new Intl.DateTimeFormat(this.state.locale,{dateStyle:"medium",timeStyle:"short"}).format(new Date(e))}catch{return this.#e("v4_saved_map","Saved map")}}#v(){let e=this.state.resources.entry;return o`
      <div class="stack">
        <p class="subtle">${this.#e("v4_support_privacy","This summary contains no map, coordinates, room or floor names, device identifiers, addresses, or credentials.")}</p>
        <dl class="diagnostics">
          <dt>${this.#e("v4_connection","Connection")}</dt><dd>${this.state.host.connected?this.#e("v4_connected","Connected"):this.#e("v4_offline","Offline")}</dd>
          <dt>${this.#e("v4_map_state","Map state")}</dt><dd>${this.state.coherence}</dd>
          <dt>${this.#e("v4_floor_verified","Floor verified")}</dt><dd>${this.state.map.floorCoherent?this.#e("v4_yes","Yes"):this.#e("v4_no","No")}</dd>
          <dt>${this.#e("v4_session_verified","Session verified")}</dt><dd>${this.state.map.sessionVerified?this.#e("v4_yes","Yes"):this.#e("v4_no","No")}</dd>
          <dt>${this.#e("v4_map_complete","Map complete")}</dt><dd>${this.state.map.complete?this.#e("v4_yes","Yes"):this.#e("v4_no","No")}</dd>
          <dt>${this.#e("v4_map_health","Map health")}</dt><dd>${e?.health||this.#e("v4_unknown","Unknown")}</dd>
          <dt>${this.#e("v4_blocked_by","Blocked by")}</dt><dd>${e?.mapBlockReason?.replaceAll("_"," ")||this.#e("v4_nothing","Nothing")}</dd>
          <dt>${this.#e("v4_startup_map","Startup map check")}</dt><dd>${e?.bootstrapState?.replaceAll("_"," ")||this.#e("v4_unknown","Unknown")}</dd>
          <dt>${this.#e("v4_startup_photo","Startup photo layer")}</dt><dd>${e?.bootstrapPhotoSeen?this.#e("v4_seen","Seen"):this.#e("v4_not_seen","Not seen")}</dd>
          <dt>${this.#e("v4_startup_structure","Startup structure layer")}</dt><dd>${e?.bootstrapStructureSeen?this.#e("v4_seen","Seen"):this.#e("v4_not_seen","Not seen")}</dd>
          <dt>${this.#e("v4_startup_failures","Startup failures")}</dt><dd>${e?.bootstrapFailures||0}</dd>
          <dt>${this.#e("v4_stream_failures","Stream failures")}</dt><dd>${e?.streamFailures||0}</dd>
          <dt>${this.#e("v4_saved_floor_count","Saved floor count")}</dt><dd>${this.state.floor.classifiedCount}</dd>
        </dl>
      </div>
    `}render(){switch(this.state.workflow){case"rooms":return this.#l();case"plan":return this.#d();case"draw":return this.#p();case"areaReview":return this.#h();case"history":return this.#m();case"support":return this.#v();case"none":return c}}};customElements.get("matic-map-workflow-v4")||customElements.define("matic-map-workflow-v4",u);export{u as MaticMapWorkflowV4};
