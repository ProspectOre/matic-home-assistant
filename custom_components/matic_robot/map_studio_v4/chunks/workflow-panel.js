import{i as v,v as b,w as o,x as c,y as g,z as f}from"./chunk.js";var p=[{value:"vacuum",label:"Vacuum"},{value:"mop",label:"Mop"},{value:"vacuum_and_mop",label:"Vacuum and mop"}],m=[{value:"quick",label:"Quick"},{value:"standard",label:"Optimal"},{value:"heavy_duty",label:"Heavy duty"}],n=d=>d.currentTarget.value,u=d=>d.currentTarget.checked,h=class extends g{constructor(){super(...arguments);this.state=v()}static{this.properties={state:{attribute:!1}}}static{this.styles=b`
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
  `}#e(t){this.dispatchEvent(new CustomEvent(f,{detail:t,bubbles:!0,composed:!0}))}#a(){return this.state.notice?o`
      <div class="notice" data-tone=${this.state.notice.tone} role=${this.state.notice.tone==="error"?"alert":"status"}>
        ${this.state.notice.text}
      </div>
    `:c}#t(t,a,r){return t==="loading"||t==="idle"?o`<div class="loading" role="status">Loading…</div>`:t==="error"?o`<div class="problem" role="alert">This workspace is unavailable right now. ${a==="request-failed"?"Try again shortly.":"Return to the live map and retry."}</div>`:t==="empty"?o`<div class="empty">Nothing saved yet.</div>`:r}#s(){let t=this.state.resources.plans;return this.#t(t.status,t.problem,o`
      <div class="stack">
        <div class="list" role="group" aria-label="Rooms to clean">
          ${(t.value?.rooms||[]).map(a=>{let r=this.state.selection.roomIds.includes(a.roomId);return o`
              <label class="room">
                <input
                  type="checkbox"
                  .checked=${r}
                  @change=${()=>this.#e({type:"toggle-room",roomId:a.roomId})}
                >
                <span>${a.name}</span>
              </label>
            `})}
        </div>
        <div class="split">
          <label class="field">Cleaning
            <select
              .value=${this.state.selection.cleaningMode}
              @change=${a=>this.#e({type:"patch-room-settings",cleaningMode:n(a)})}
            >${p.map(a=>o`<option value=${a.value}>${a.label}</option>`)}</select>
          </label>
          <label class="field">Coverage
            <select
              .value=${this.state.selection.coverageSetting}
              @change=${a=>this.#e({type:"patch-room-settings",coverageSetting:n(a)})}
            >${m.map(a=>o`<option value=${a.value}>${a.label}</option>`)}</select>
          </label>
        </div>
        <p class="subtle">Select rooms here or directly on the map. The map and list stay in sync.</p>
        ${this.#a()}
      </div>
    `)}#l(t){let a=this.state.planDraft.rooms,e=a.find(l=>l.roomId===t)?a.filter(l=>l.roomId!==t):[...a,{roomId:t,cleaningMode:"vacuum",coverageSetting:"standard"}];this.#e({type:"patch-plan-draft",patch:{rooms:e}})}#o(t,a){let r=this.state.planDraft.rooms.map((e,l)=>l===t?{...e,...a}:e);this.#e({type:"patch-plan-draft",patch:{rooms:r}})}#r(t,a){let r=t+a,e=[...this.state.planDraft.rooms];if(r<0||r>=e.length)return;let[l]=e.splice(t,1);l&&(e.splice(r,0,l),this.#e({type:"patch-plan-draft",patch:{rooms:e}}))}#i(){let t=this.state.resources.plans,a=t.value,r=this.state.planDraft;return this.#t(t.status,t.problem,o`
      <div class="stack">
        <div class="split">
          <label class="field">Saved plan
            <select
              .value=${this.state.selection.planId||""}
              @change=${e=>this.#e({type:"select-plan",planId:n(e)||null})}
            >
              <option value="">New plan</option>
              ${(a?.plans||[]).map(e=>o`<option value=${e.id}>${e.name}</option>`)}
            </select>
          </label>
          <button class="list-button" type="button" @click=${()=>this.#e({type:"select-plan",planId:null})}>＋ New plan</button>
        </div>
        <label class="field">Plan name
          <input
            maxlength="128"
            autocomplete="off"
            .value=${r.name}
            @input=${e=>this.#e({type:"patch-plan-draft",patch:{name:n(e)}})}
          >
        </label>
        <div class="split">
          <label class="field">Run order
            <select
              .value=${r.runBehavior}
              @change=${e=>this.#e({type:"patch-plan-draft",patch:{runBehavior:n(e)==="ordered"?"ordered":"intelligent"}})}
            >
              <option value="intelligent">Smart rotation</option>
              <option value="ordered">Listed order</option>
            </select>
          </label>
          <label class="checkbox"><input type="checkbox" .checked=${r.enabled} @change=${e=>this.#e({type:"patch-plan-draft",patch:{enabled:u(e)}})}>Enabled</label>
        </div>
        <div class="list" aria-label="Plan rooms">
          ${(a?.rooms||[]).map(e=>{let l=r.rooms.some(s=>s.roomId===e.roomId);return o`<label class="room"><input type="checkbox" .checked=${l} @change=${()=>this.#l(e.roomId)}><span>${e.name}</span></label>`})}
        </div>
        ${r.rooms.length?o`
          <div class="list" aria-label="Room order and settings">
            ${r.rooms.map((e,l)=>{let s=a?.rooms.find(i=>i.roomId===e.roomId)?.name||"Room";return o`
                <div class="plan-room">
                  <div class="plan-room-head">
                    <strong>${l+1}. ${s}</strong>
                    <button class="icon-button" type="button" aria-label=${`Move ${s} earlier`} ?disabled=${l===0} @click=${()=>this.#r(l,-1)}>↑</button>
                    <button class="icon-button" type="button" aria-label=${`Move ${s} later`} ?disabled=${l===r.rooms.length-1} @click=${()=>this.#r(l,1)}>↓</button>
                  </div>
                  <div class="split">
                    <label class="field">Cleaning
                      <select .value=${e.cleaningMode} @change=${i=>this.#o(l,{cleaningMode:n(i)})}>${p.map(i=>o`<option value=${i.value}>${i.label}</option>`)}</select>
                    </label>
                    <label class="field">Coverage
                      <select .value=${e.coverageSetting} @change=${i=>this.#o(l,{coverageSetting:n(i)})}>${m.map(i=>o`<option value=${i.value}>${i.label}</option>`)}</select>
                    </label>
                  </div>
                </div>
              `})}
          </div>
        `:c}
        <details>
          <summary>Completion options</summary>
          <div class="stack">
            <label class="checkbox"><input type="checkbox" .checked=${r.returnToBase} @change=${e=>this.#e({type:"patch-plan-draft",patch:{returnToBase:u(e)}})}>Return to the dock when finished</label>
            <label class="checkbox"><input type="checkbox" .checked=${r.finishCurrentRoom} @change=${e=>this.#e({type:"patch-plan-draft",patch:{finishCurrentRoom:u(e)}})}>Finish the active room after Stop</label>
            ${r.finishCurrentRoom?o`<label class="field">Finish threshold · ${r.finishCurrentRoomThreshold}%<input type="range" min="0" max="100" step="5" .value=${String(r.finishCurrentRoomThreshold)} @input=${e=>this.#e({type:"patch-plan-draft",patch:{finishCurrentRoomThreshold:Number(n(e))}})}></label>`:c}
          </div>
        </details>
        <div class="toolbar">
          ${r.id?o`
            <button
              class="danger"
              type="button"
              aria-label="Delete plan"
              @click=${()=>this.#e({type:"open-dialog",dialog:"confirmDeletePlan"})}
            >Delete</button>
          `:c}
        </div>
        ${this.#a()}
      </div>
    `)}#n(){let t=this.state.resources.areas;return o`
      <div class="stack">
        <matic-precision-controls-v4 .state=${this.state}></matic-precision-controls-v4>
        <p class="subtle">Paint only on mapped floor. Zoom and pan never change the saved outline.</p>
        ${this.#t(t.status,t.problem,o`
          <div class="list" aria-label="Saved custom areas">
            <button class="list-button" type="button" @click=${()=>this.#e({type:"select-area",areaId:null})}>＋ New outline</button>
            ${(t.value?.areas||[]).map(a=>o`
              <button class="list-button" type="button" @click=${()=>{this.#e({type:"select-area",areaId:a.id}),this.#e({type:"open-workflow",workflow:"areaReview"})}}>
                <span>${a.name}</span>
                <small>${a.status==="current"?"Ready":"Review"}</small>
              </button>
            `)}
          </div>
        `)}
      </div>
    `}#c(){let t=this.state.areaDraft,a=t.canRebind||t.status==="review",r=t.status==="stale"||t.status==="unknown";return o`
      <div class="stack">
        ${a?o`<div class="notice" data-tone="warning" role="status">Review the saved outline on this current map, then confirm it.</div>`:c}
        ${r?o`<div class="problem" role="alert">This outline no longer matches the current room map. Redraw it before saving.</div>`:c}
        <label class="field">Area name
          <input maxlength="128" autocomplete="off" .value=${t.name} @input=${e=>this.#e({type:"patch-area-draft",patch:{name:n(e)}})}>
        </label>
        <div class="split">
          <label class="field">Cleaning
            <select .value=${t.cleaningMode} @change=${e=>this.#e({type:"patch-area-draft",patch:{cleaningMode:n(e)}})}>${p.map(e=>o`<option value=${e.value}>${e.label}</option>`)}</select>
          </label>
          <label class="field">Coverage
            <select .value=${t.coverageSetting} @change=${e=>this.#e({type:"patch-area-draft",patch:{coverageSetting:n(e)}})}>${m.map(e=>o`<option value=${e.value}>${e.label}</option>`)}</select>
          </label>
        </div>
        <p class="subtle">${this.state.draw.circles.length} map-space marks. The outline stays private and floor-bound.</p>
        <div class="toolbar">
          <button type="button" @click=${()=>this.#e({type:"open-workflow",workflow:"draw"})}>Edit outline</button>
          ${t.id?o`
            <button
              class="danger"
              type="button"
              aria-label="Delete area"
              @click=${()=>this.#e({type:"open-dialog",dialog:"confirmDeleteArea"})}
            >Delete</button>
          `:c}
        </div>
        ${this.#a()}
      </div>
    `}#d(){let t=this.state.resources.history,a=t.value,r=a?.floors.find(s=>s.id===this.state.selection.floorId)||a?.floors.find(s=>s.active)||a?.floors[0],e=r?.snapshots||[],l=this.state.selection.historyId?Math.max(0,e.findIndex(s=>s.id===this.state.selection.historyId)):e.length;return this.#t(t.status,t.problem,o`
      <div class="stack">
        ${(a?.floors.length||0)>1?o`
          <div class="list" role="listbox" aria-label="Mapped floors">
            ${(a?.floors||[]).map((s,i)=>o`
              <button
                class="floor"
                type="button"
                role="option"
                aria-selected=${String(s.id===r?.id)}
                aria-pressed=${String(s.id===r?.id)}
                @click=${()=>this.#e({type:"set-floor",floorId:s.id})}
              >
                <span>${s.label||(s.active?"Current floor":`Saved floor ${s.ordinal??i}`)}</span>
                <small>${s.active?"Live":"Read only"}</small>
              </button>
            `)}
          </div>
        `:c}
        <div class="timeline">
          <label class="field">Map timeline
            <input
              type="range"
              min="0"
              max=${String(e.length)}
              step="1"
              .value=${String(l)}
              ?disabled=${!e.length}
              @input=${s=>{let i=Number(n(s));this.#e({type:"set-history",historyId:i===e.length?null:e[i]?.id||null})}}
            >
          </label>
          <div class="list">
            <button class="snapshot" type="button" aria-current=${String(!this.state.selection.historyId)} @click=${()=>this.#e({type:"set-history",historyId:null})}><span>Live</span><small>Current</small></button>
            ${e.map((s,i)=>o`
              <button class="snapshot" type="button" aria-current=${String(s.id===this.state.selection.historyId)} @click=${()=>this.#e({type:"set-history",historyId:s.id})}>
                <span>${this.#p(s.createdAt)}</span><small>${i+1} of ${e.length}</small>
              </button>
            `)}
          </div>
        </div>
        <p class="subtle">Saved maps are floor-scoped and never show a live robot position.</p>
      </div>
    `)}#p(t){try{return new Intl.DateTimeFormat(this.state.locale,{dateStyle:"medium",timeStyle:"short"}).format(new Date(t))}catch{return"Saved map"}}#m(){let t=this.state.resources.entry;return o`
      <div class="stack">
        <p class="subtle">This summary contains no map, coordinates, room or floor names, device identifiers, addresses, or credentials.</p>
        <dl class="diagnostics">
          <dt>Connection</dt><dd>${this.state.host.connected?"Connected":"Offline"}</dd>
          <dt>Map state</dt><dd>${this.state.coherence}</dd>
          <dt>Floor verified</dt><dd>${this.state.map.floorCoherent?"Yes":"No"}</dd>
          <dt>Session verified</dt><dd>${this.state.map.sessionVerified?"Yes":"No"}</dd>
          <dt>Map complete</dt><dd>${this.state.map.complete?"Yes":"No"}</dd>
          <dt>Map health</dt><dd>${t?.health||"Unknown"}</dd>
          <dt>Blocked by</dt><dd>${t?.mapBlockReason?.replaceAll("_"," ")||"Nothing"}</dd>
          <dt>Startup map check</dt><dd>${t?.bootstrapState?.replaceAll("_"," ")||"Unknown"}</dd>
          <dt>Startup photo layer</dt><dd>${t?.bootstrapPhotoSeen?"Seen":"Not seen"}</dd>
          <dt>Startup structure layer</dt><dd>${t?.bootstrapStructureSeen?"Seen":"Not seen"}</dd>
          <dt>Startup failures</dt><dd>${t?.bootstrapFailures||0}</dd>
          <dt>Stream failures</dt><dd>${t?.streamFailures||0}</dd>
          <dt>Saved floor count</dt><dd>${this.state.floor.classifiedCount}</dd>
        </dl>
      </div>
    `}render(){switch(this.state.workflow){case"rooms":return this.#s();case"plan":return this.#i();case"draw":return this.#n();case"areaReview":return this.#c();case"history":return this.#d();case"support":return this.#m();case"none":return c}}};customElements.get("matic-map-workflow-v4")||customElements.define("matic-map-workflow-v4",h);export{h as MaticMapWorkflowV4};
