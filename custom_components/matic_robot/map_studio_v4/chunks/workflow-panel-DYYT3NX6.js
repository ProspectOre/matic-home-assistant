import{c as I,j as F}from"./chunk-ASV6JLEH.js";import{F as z,G as i,J as D,K as m,L,M as B,N as q,O as V,P as H,c as k,ja as U,k as M,ka as O,la as W,m as A,va as S,wa as j}from"./chunk-2ZB5QB7P.js";var K={ATTRIBUTE:1,CHILD:2,PROPERTY:3,BOOLEAN_ATTRIBUTE:4,EVENT:5,ELEMENT:6},Q=r=>(...u)=>({_$litDirective$:r,values:u}),C=class{constructor(u){}get _$AU(){return this._$AM._$AU}_$AT(u,e,s){this._$Ct=u,this._$AM=e,this._$Ci=s}_$AS(u,e){return this.update(u,e)}update(u,e){return this.render(...e)}};var{I:te}=L,G=r=>r;var Y=()=>document.createComment(""),w=(r,u,e)=>{let s=r._$AA.parentNode,t=u===void 0?r._$AB:u._$AA;if(e===void 0){let a=s.insertBefore(Y(),t),o=s.insertBefore(Y(),t);e=new te(a,o,r,r.options)}else{let a=e._$AB.nextSibling,o=e._$AM,l=o!==r;if(l){let d;e._$AQ?.(r),e._$AM=r,e._$AP!==void 0&&(d=r._$AU)!==o._$AU&&e._$AP(d)}if(a!==t||l){let d=e._$AA;for(;d!==a;){let p=G(d).nextSibling;G(s).insertBefore(d,t),d=p}}}return e},y=(r,u,e=r)=>(r._$AI(u,e),r),ae={},Z=(r,u=ae)=>r._$AH=u,X=r=>r._$AH,E=r=>{r._$AR(),r._$AA.remove()};var J=(r,u,e)=>{let s=new Map;for(let t=u;t<=e;t++)s.set(r[t],t);return s},ee=Q(class extends C{constructor(r){if(super(r),r.type!==K.CHILD)throw Error("repeat() can only be used in text expressions")}dt(r,u,e){let s;e===void 0?e=u:u!==void 0&&(s=u);let t=[],a=[],o=0;for(let l of r)t[o]=s?s(l,o):o,a[o]=e(l,o),o++;return{values:a,keys:t}}render(r,u,e){return this.dt(r,u,e).values}update(r,[u,e,s]){let t=X(r),{values:a,keys:o}=this.dt(u,e,s);if(!Array.isArray(t))return this.ut=o,a;let l=this.ut??=[],d=[],p,f,h=0,n=t.length-1,c=0,v=a.length-1;for(;h<=n&&c<=v;)if(t[h]===null)h++;else if(t[n]===null)n--;else if(l[h]===o[c])d[c]=y(t[h],a[c]),h++,c++;else if(l[n]===o[v])d[v]=y(t[n],a[v]),n--,v--;else if(l[h]===o[v])d[v]=y(t[h],a[v]),w(r,d[v+1],t[h]),h++,v--;else if(l[n]===o[c])d[c]=y(t[n],a[c]),w(r,t[h],t[n]),n--,c++;else if(p===void 0&&(p=J(o,c,v),f=J(l,h,n)),p.has(l[h]))if(p.has(l[n])){let g=f.get(o[c]),_=g!==void 0?t[g]:null;if(_===null){let R=w(r,t[h]);y(R,a[c]),d[c]=R}else d[c]=y(_,a[c]),w(r,t[h],_),t[g]=null;c++}else E(t[n]),n--;else E(t[h]),h++;for(;c<=v;){let g=w(r,d[v+1]);y(g,a[c]),d[c++]=g}for(;h<=n;){let g=t[h++];g!==null&&E(g)}return this.ut=o,Z(r,d),D}});var N=["vacuum","mop","vacuum_and_mop"],P=["quick","standard","heavy_duty"],$=r=>r.currentTarget.value,x=r=>r.currentTarget.checked,T=class extends B{constructor(){super(...arguments);this.state=M();this._diagnosticsLoadFailed=!1;this.#n=null}static{this.properties={state:{attribute:!1},localize:{attribute:!1},_diagnosticsLoadFailed:{state:!0}}}static{this.styles=[q,V,H,z`
.workflow-fields { border: 0; margin: 0; padding: 0; min-inline-size: 0; }
:host { display: block; min-inline-size: 0; container-type: inline-size; }
button, select, input[type="checkbox"] { cursor: pointer; }
.stack { display: grid; gap: var(--ms-space-3); }
.subtle { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
.loading, .empty, .problem, .notice {
--ms-local: var(--ms-surface-sunken);
padding: var(--ms-space-3);
border-radius: var(--ms-radius-md);
background: var(--ms-local);
font-size: var(--ms-t-sm);
line-height: var(--ms-lh-snug);
}
.problem, .notice[data-tone="error"] { --ms-local: color-mix(in srgb, var(--ms-danger) 9%, var(--ms-surface-card)); color: color-mix(in srgb, var(--ms-danger) 82%, var(--ms-text)); background: var(--ms-local); }
.notice[data-tone="success"] { --ms-local: color-mix(in srgb, var(--ms-success) 10%, var(--ms-surface-card)); color: color-mix(in srgb, var(--ms-success) 82%, var(--ms-text)); background: var(--ms-local); }
.notice[data-tone="warning"] { --ms-local: color-mix(in srgb, var(--ms-warning) 11%, var(--ms-surface-card)); color: color-mix(in srgb, var(--ms-warning) 82%, var(--ms-text)); background: var(--ms-local); }
.split { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--ms-space-2); }
.list { display: grid; gap: var(--ms-space-2); }
.group { display: grid; gap: var(--ms-space-2); }
.group-heading { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); font-weight: var(--ms-w-medium); letter-spacing: 0.04em; line-height: var(--ms-lh-snug); text-transform: uppercase; }
.floor[aria-current="true"] { border-color: var(--ms-accent); background: color-mix(in srgb, var(--ms-accent) 12%, var(--ms-local)); }
.problem p { margin: 0; }
@media (forced-colors: active) { .floor[aria-current="true"] { forced-color-adjust: none; color: HighlightText; background: Highlight; border-color: Highlight; } }
.room { display: grid; gap: var(--ms-space-2); }
.room-choice { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: var(--ms-space-2); min-block-size: var(--ms-control-sm); }
.room-choice input { inline-size: 1.2rem; block-size: 1.2rem; }
.room-settings { padding-block-start: 0.125rem; padding-inline-start: 1.8rem; }
.plan-meta { align-items: stretch; }
.plan-active { min-inline-size: 0; }
.plan-active .ms-row__body strong { font-size: var(--ms-t-sm); white-space: nowrap; }
.plan-active .ms-row__body small { max-inline-size: 32ch; }
.plan-options { --ms-local: var(--ms-surface-sunken); display: grid; gap: var(--ms-space-3); padding: var(--ms-space-4); border: 1px solid var(--ms-line); border-radius: var(--ms-radius-md); background: var(--ms-local); }
.plan-room .room-choice { grid-template-columns: minmax(0, 1fr) auto; }
.plan-room-label { display: flex; align-items: center; gap: var(--ms-space-2); min-block-size: var(--ms-control); }
.plan-room { display: grid; gap: var(--ms-space-2); }
.plan-option { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: start; gap: var(--ms-space-2); }
.plan-option input[type="checkbox"] { inline-size: 1.2rem; block-size: 1.2rem; margin: 0.1rem 0 0; accent-color: var(--ms-accent); }
.plan-option-copy, .plan-threshold-copy { display: grid; gap: var(--ms-space-1); min-inline-size: 0; }
.cadence-config { grid-column: 1 / -1; grid-template-columns: minmax(0, 1fr); display: grid; gap: var(--ms-space-2); }
.cadence-config > summary { cursor: pointer; min-block-size: var(--ms-control-sm); font-weight: var(--ms-w-semibold); }
.cadence-fields { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--ms-space-2); min-inline-size: 0; }
.cadence-fields > .ms-field { min-inline-size: 0; }
.plan-option-copy strong, .plan-threshold-copy strong { font-size: var(--ms-t-sm); line-height: var(--ms-lh-snug); }
.plan-option-copy small, .plan-threshold-copy small { color: var(--ms-text-quiet); font-size: var(--ms-t-xs); font-weight: var(--ms-w-regular); line-height: var(--ms-lh-snug); }
.plan-threshold { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--ms-space-1) var(--ms-space-3); align-items: start; }
.plan-threshold .plan-threshold-copy { grid-column: 1; }
.plan-threshold .threshold-value { color: var(--ms-text); font-size: var(--ms-t-sm); font-weight: var(--ms-w-bold); }
.plan-threshold > input[type="range"] { grid-column: 1 / -1; inline-size: 100%; min-block-size: var(--ms-control-sm); }
.toolbar { display: flex; flex-wrap: wrap; gap: var(--ms-space-2); }
.checkbox { display: flex; align-items: center; gap: var(--ms-space-2); min-block-size: var(--ms-control); font-size: var(--ms-t-xs); font-weight: var(--ms-w-medium); }
.checkbox input { inline-size: 1.2rem; block-size: 1.2rem; }
.floor small, .snapshot small, .list-button small { margin-inline-start: auto; color: color-mix(in srgb, var(--ms-text) 78%, var(--ms-local)); font-weight: var(--ms-w-regular); }
.timeline { display: grid; gap: var(--ms-space-2); }
.timeline input[type="range"] { inline-size: 100%; min-block-size: var(--ms-control); }
@media (max-width: 25rem) { .split { grid-template-columns: 1fr; } }
@container (max-width: 38rem) { .plan-meta { grid-template-columns: 1fr; } }
`]}#n;disconnectedCallback(){super.disconnectedCallback()}#e(e,s,t){return j(this.localize,e,s,t)}#o(e){return e==="vacuum"?this.#e("vacuum","Vacuum"):e==="mop"?this.#e("mop","Mop"):this.#e("vacuum_and_mop","Vacuum + mop")}#a(e){return e==="quick"?this.#e("quick","Quick"):e==="standard"?this.#e("standard","Optimal"):this.#e("heavy_duty","Heavy Duty")}#c(e){return e==="mop_due"?this.#e("v4_cadence_mop_due_reason","Vacuum and mop are due"):e==="coverage_due"?this.#e("v4_cadence_coverage_due_reason","Periodic coverage is due"):this.#e("v4_cadence_due_unknown_reason","Schedule setting due")}#g(e){return e==="plan_disabled"?this.#e("v4_preview_plan_disabled","This plan is paused. Enable it to preview and run."):e==="shared_schedule_unavailable"?this.#e("v4_preview_shared_unavailable","The shared room schedule cannot be verified on this map."):e==="cadence_identity_changed"||e==="cadence_identity_unavailable"?this.#e("v4_preview_identity_unavailable","Room identity could not be verified. Check the current map before running."):e==="plan_has_no_rooms"?this.#e("v4_preview_no_rooms","Add at least one room to this plan."):e==="plan_room_limit"?this.#e("v4_preview_room_limit","This saved plan exceeds the 100-room limit. Remove rooms and save it before running."):this.#e("v4_preview_invalid","The saved plan preview is invalid. Review the plan and try again.")}#t(e){this.dispatchEvent(new CustomEvent(F,{detail:e,bubbles:!0,composed:!0}))}#r(){return this.state.notice?i`
      <div class="notice" data-tone=${this.state.notice.tone} role=${this.state.notice.tone==="error"?"alert":"status"}>
        ${this.state.notice.text}
      </div>
    `:m}#_(){switch(this.state.workflow){case"rooms":case"plans":case"plan":return{loading:this.#e("v4_loading_rooms_plans","Loading rooms and plans\u2026"),unavailable:this.#e("v4_rooms_plans_unavailable","Rooms and plans are unavailable right now."),empty:this.#e("v4_no_rooms_plans","No rooms or plans are available yet.")};case"draw":case"areaReview":return{loading:this.#e("v4_loading_areas","Loading saved areas\u2026"),unavailable:this.#e("v4_areas_unavailable","Saved areas are unavailable right now."),empty:this.#e("v4_no_saved_areas","No saved areas yet. Draw one on the map.")};case"history":return{loading:this.#e("v4_loading_history","Loading map history\u2026"),unavailable:this.#e("v4_history_unavailable","Map history is unavailable right now."),empty:this.#e("v4_no_map_history","No saved map snapshots yet.")};default:return{loading:this.#e("map_loading","Loading\u2026"),unavailable:this.#e("v4_workspace_unavailable","This workspace is unavailable right now."),empty:this.#e("v4_nothing_saved","Nothing saved yet.")}}}#i(e,s,t){let a=this.#_();if(e==="loading"||e==="idle")return i`<div class="loading" role="status">${a.loading}</div>`;if(e==="error"){let o=this.state.workflow;return i`
        <div class="stack">
          <div class="problem" role="alert">${a.unavailable} ${s==="request-failed"?this.#e("v4_try_again","Try again shortly."):this.#e("v4_return_live_retry","Return to the live map and retry.")}</div>
          <div class="toolbar">
            <button class="ms-btn ms-btn--secondary" type="button" @click=${()=>this.#t({type:"open-workflow",workflow:o})}>${this.#e("v4_retry","Try again")}</button>
          </div>
        </div>
      `}return e==="empty"?i`<div class="empty">${a.empty}</div>`:t}#b(){let e=this.state.resources.plans,s=A(this.state),t=s!==null,a=this.state.selection.roomIds.length>=100;return this.#i(e.status,e.problem,i`
      <div class="stack">
        <h3 class="group-heading" id="rooms-heading">${this.#e("v4_rooms_to_clean","Rooms to clean")}</h3>
        <div class="list" role="group" aria-labelledby="rooms-heading">
          ${(e.value?.rooms||[]).map(o=>{let l=this.state.selection.roomIds.includes(o.roomId);return i`
              <div class="room ms-row ms-row--stack" data-selected=${String(l)}>
                <label class="room-choice">
                  <input
                    type="checkbox"
                    .checked=${l}
                    ?disabled=${!l&&a}
                    @change=${()=>this.#t({type:"toggle-room",roomId:o.roomId})}
                  >
                  <strong>${o.name}</strong>
                  ${l?i`<small>${this.#e("v4_room_ready","Ready")}</small>`:m}
                </label>
                ${l?this.#$(o.roomId,this.state.selection.roomSettings.find(d=>d.roomId===o.roomId)||{roomId:o.roomId,cleaningMode:"vacuum",coverageSetting:"standard"}):m}
              </div>
            `})}
        </div>
        ${a?i`<p class="subtle" role="status">${this.#e("v4_room_limit_reached","Up to {limit} rooms can be included. Remove one before adding another.",{limit:100})}</p>`:m}
        <p class="subtle">${this.#e("v4_room_selection_hint","Select rooms here or directly on the map. The map and list stay in sync.")}</p>
        <label class="plan-option">
          <input type="checkbox" .checked=${!this.state.selection.useRoomSchedule} @change=${o=>this.#t({type:"set-use-room-schedule",value:!x(o)})}>
          <span class="plan-option-copy">
            <strong>${this.#e("v4_override_room_schedule","Override shared schedule settings")}</strong>
            <small>${this.#e("v4_override_room_schedule_hint","By default, this clean applies the shared schedule. Turn this on to use the settings selected here. Omitted due work stays due, and compatible verified work still counts toward shared progress.")}</small>
          </span>
        </label>
        <div class="stack" aria-label=${this.#e("v4_shared_schedule_status","Shared room schedule status")}>
          ${this.state.selection.roomIds.map(o=>{let l=e.value?.rooms.find(d=>d.roomId===o);return l?.sharedCadence||l?.sharedCadenceProgress||l?.sharedCadenceReasons?.length?i`<p class="subtle">${l.name}: ${this.#m(l.sharedCadence,l.sharedCadenceProgress,l.sharedCadenceReasons)}</p>`:m})}
        </div>
        ${this.state.manualRoomPreview.status==="loading"?i`<p role="status" class="subtle">${this.#e("v4_room_preview_loading","Verifying the effective room settings\u2026")}</p>`:m}
        ${this.state.manualRoomPreview.status==="error"?i`<div class="stack">
            <div role="alert" class="problem">${this.#e("v4_room_preview_unavailable","Your room selections are saved, but the effective settings could not be verified. Retry the preview to enable cleaning.")}</div>
            <div class="toolbar"><button class="ms-btn ms-btn--secondary" type="button" @click=${()=>this.#t({type:"retry-room-preview"})}>${this.#e("v4_retry_preview","Retry preview")}</button></div>
          </div>`:m}
        ${t?this.#f(s.preview):m}
        ${this.#r()}
      </div>
    `)}#f(e){let s=new Set(e.missionBoundaries);return i`
      <section class="stack" aria-labelledby="effective-rooms-heading" aria-live="polite">
        <h3 class="group-heading" id="effective-rooms-heading">${this.#e("v4_effective_room_preview","Effective cleaning preview")}</h3>
        ${e.blocker?i`<p class="problem" role="alert">${e.blocker==="invalid_cadence_policy"&&this.state.selection.useRoomSchedule&&this.state.selection.roomSettings.some(t=>t.cleaningMode!=="vacuum")?this.#e("v4_room_preview_schedule_override","The shared schedule cannot apply this selected cleaning system. Turn on Override shared schedule settings or choose a compatible system."):this.#e("v4_room_preview_blocked","The effective room sequence is blocked. Review the selected rooms and shared schedule settings, then retry.")}</p>`:m}
        ${e.rooms.length?i`<ol class="list" aria-label=${this.#e("v4_effective_room_order","Effective room order")}>
            ${e.rooms.map((t,a)=>i`
              <li class="ms-row ms-row--stack">
                ${s.has(a)?i`<strong>${this.#e("v4_room_mission_boundary","New mission")}</strong>`:m}
                <strong>${t.name}</strong>
                <span class="subtle">${this.#o(t.cleaningMode)} \u00b7 ${this.#a(t.coverageSetting)}</span>
                ${t.cadenceReasons.length?i`<span class="subtle">${t.cadenceReasons.map(o=>this.#c(o)).join("; ")}</span>`:m}
              </li>
            `)}
          </ol>`:m}
      </section>
    `}#$(e,s){let t=this.state.resources.plans.value?.rooms.find(a=>a.roomId===e)?.name||this.#e("v4_room","Room");return i`
      <div class="split room-settings">
        <label class="field ms-field">${this.#e("v4_cleaning_system","Cleaning system")}
          <select
            aria-label=${this.#e("v4_room_cleaning_system_named","Cleaning system for {room}",{room:t})}
            .value=${s.cleaningMode}
            @change=${a=>this.#t({type:"patch-room-settings",roomId:e,cleaningMode:$(a)})}
          >${N.map(a=>i`<option value=${a} ?selected=${a===s.cleaningMode}>${this.#o(a)}</option>`)}</select>
        </label>
        <label class="field ms-field">${this.#e("cleaning_mode","Cleaning mode")}
          <select
            aria-label=${this.#e("v4_room_cleaning_mode_named","Cleaning mode for {room}",{room:t})}
            .value=${s.coverageSetting}
            @change=${a=>this.#t({type:"patch-room-settings",roomId:e,coverageSetting:$(a)})}
          >${P.map(a=>i`<option value=${a} ?selected=${a===s.coverageSetting}>${this.#a(a)}</option>`)}</select>
        </label>
      </div>
    `}#d(e){return e.cadence||{scope:"plan",mopEveryN:null,coverageEveryN:null,periodicCoverageSetting:null,doMopNext:!1,doCoverageNext:!1}}#m(e,s,t=s?.reasons||[]){if(t.includes("identity_changed")||t.includes("room_not_on_current_map"))return this.#e("v4_cadence_identity_blocked","Schedule identity does not match the current room map. Review this room before cleaning.");if(t.includes("shared_schedule_unavailable"))return this.#e("v4_cadence_shared_unavailable","The shared room schedule is unavailable. Review its settings before cleaning.");if(t.includes("invalid_cadence_policy"))return this.#e("v4_cadence_policy_invalid","The room schedule needs review before it can be applied.");if(!e||!e.mopEveryN&&!e.coverageEveryN)return this.#e("v4_cadence_not_enabled","No recurring room schedule is enabled.");let a=[],o=s?.mopDue||s?.reasons.includes("mop_due"),l=s?.coverageDue||s?.reasons.includes("coverage_due");return e.mopEveryN&&a.push(o?this.#e("v4_cadence_mop_due","Vacuum and mop is due on this clean."):this.#e("v4_cadence_mop_progress","Mop every {interval} cleans; {completed} qualifying cleans since the last mop.",{interval:e.mopEveryN,completed:s?.mopProgress??0})),e.coverageEveryN&&a.push(l?this.#e("v4_cadence_coverage_due","{coverage} periodic coverage is due on this clean.",{coverage:this.#a(e.periodicCoverageSetting||"standard")}):this.#e("v4_cadence_coverage_progress","Periodic coverage every {interval} cleans; {completed} qualifying cleans so far.",{interval:e.coverageEveryN,completed:s?.coverageProgress??0})),a.join(" ")}#s(e,s){let t=this.state.planDraft.rooms[e];t&&this.#l(e,{cadence:{...this.#d(t),...s}})}#p(e,s,t){let a=e.currentTarget,o=a.value;if(o===""){this.#s(s,{[t]:null});return}let l=Number(o);if(!Number.isInteger(l)||l<1||l>100){a.reportValidity();return}let d=this.state.planDraft.rooms[s];if(d){if(t==="coverageEveryN"){this.#s(s,{coverageEveryN:l,periodicCoverageSetting:d.cadence?.periodicCoverageSetting||d.coverageSetting});return}this.#s(s,{[t]:l})}}#y(e,s,t){let a=this.state.planDraft,o=this.#d(e),l=e.cadenceProgress,p=(a.id?this.state.resources.plans.value?.plans.find(b=>b.id===a.id)?.rooms.find(b=>b.roomId===e.roomId):void 0)?.cadence?.scope??null,f=this.state.resources.plans.value?.rooms.find(b=>b.roomId===e.roomId),h=!!(f?.sharedCadence||f?.sharedCadenceProgress),n=!!(o.mopEveryN||o.coverageEveryN),c=!!(l?.mopProgress||o.doMopNext),v=!!(l?.coverageProgress||o.doCoverageNext),g=a.dirty||this.state.command!=="idle"||this.state.managedLock||this.state.activity!=="idle"&&this.state.activity!=="docked"||this.state.dataMode!=="live",_=p!==null&&p!==o.scope?o.scope==="shared"?this.#e("v4_cadence_shared_join_effect","Saving makes this schedule shared across participating plans and opted-in room cleans. It adopts existing shared progress when available; a new shared schedule starts at zero."):this.#e("v4_cadence_shared_leave_effect","Saving starts fresh private progress for this plan. The existing shared schedule remains unchanged for other participating plans."):p===null&&n?o.scope==="shared"?h?this.#e("v4_cadence_shared_join_effect","Saving makes this schedule shared across participating plans and opted-in room cleans. It adopts existing shared progress when available; a new shared schedule starts at zero."):this.#e("v4_cadence_new_shared_effect","Saving creates a shared schedule for participating plans and opted-in room cleans. Its progress starts at zero."):this.#e("v4_cadence_new_private_effect","Saving creates private progress for this plan only. It starts at zero when enabled."):this.#e("v4_cadence_existing_effect","Interval edits keep progress, and disabling pauses it. Mopping and coverage have separate progress and resets."),R=this.#e("v4_room_cadence_named","Room schedule for {room}",{room:t});return i`
      <details class="plan-option cadence-config">
        <summary>${R}</summary>
        <p class="subtle">${this.#e("v4_cadence_description","Only verified room cleans count toward these intervals. Due work stays due until it is verified.")}</p>
        <div class="cadence-fields">
          <label class="field ms-field">${this.#e("v4_cadence_scope","Schedule scope")}
            <select aria-label=${this.#e("v4_cadence_scope_named","Schedule scope for {room}",{room:t})} .value=${o.scope} @change=${b=>this.#s(s,{scope:$(b)})}>
              <option value="plan" ?selected=${o.scope==="plan"}>${this.#e("v4_cadence_this_plan","This plan (private)")}</option>
              <option value="shared" ?selected=${o.scope==="shared"}>${this.#e("v4_cadence_shared","Shared for this room")}</option>
            </select>
          </label>
          <label class="field ms-field">${this.#e("v4_cadence_mop_interval","Vacuum and mop every N cleans")}
            <input type="number" min="1" max="100" step="1" inputmode="numeric" aria-label=${this.#e("v4_cadence_mop_interval_named","Vacuum and mop interval for {room}, from 1 to 100",{room:t})} .value=${o.mopEveryN?.toString()||""} ?disabled=${e.cleaningMode!=="vacuum"} @change=${b=>this.#p(b,s,"mopEveryN")}>
          </label>
          <label class="field ms-field">${this.#e("v4_cadence_coverage_interval","Use periodic coverage every N cleans")}
            <input type="number" min="1" max="100" step="1" inputmode="numeric" aria-label=${this.#e("v4_cadence_coverage_interval_named","Periodic coverage interval for {room}, from 1 to 100",{room:t})} .value=${o.coverageEveryN?.toString()||""} @change=${b=>this.#p(b,s,"coverageEveryN")}>
          </label>
          ${o.coverageEveryN?i`
            <label class="field ms-field">${this.#e("v4_cadence_periodic_coverage","Periodic coverage setting")}
              <select aria-label=${this.#e("v4_cadence_periodic_coverage_named","Periodic coverage setting for {room}",{room:t})} .value=${o.periodicCoverageSetting||"standard"} @change=${b=>this.#s(s,{periodicCoverageSetting:$(b)})}>${P.map(b=>i`<option value=${b} ?selected=${b===o.periodicCoverageSetting}>${this.#a(b)}</option>`)}</select>
            </label>
          `:m}
        </div>
        <p class="subtle" role="status">${_}</p>
        ${e.cleaningMode!=="vacuum"?i`<p class="subtle">${this.#e("v4_cadence_mop_requires_vacuum","Set this room's normal cleaning system to vacuum to enable periodic mopping.")}</p>`:m}
        ${o.mopEveryN&&e.cleaningMode==="vacuum"?i`<p class="subtle">${this.#e("v4_cadence_clear_mop_to_change_normal","Clear the mopping interval before changing this room's normal cleaning system.")}</p>`:m}
        <div class="plan-options" role="group" aria-label=${this.#e("v4_cadence_next_actions_named","Next clean options for {room}",{room:t})}>
          <label class="plan-option"><input type="checkbox" aria-label=${this.#e("v4_cadence_do_mop_next_named","Do vacuum and mop on the next clean for {room}",{room:t})} .checked=${o.doMopNext} ?disabled=${!o.mopEveryN} @change=${b=>this.#s(s,{doMopNext:x(b)})}><span class="plan-option-copy"><strong>${this.#e("v4_cadence_do_mop_next","Do vacuum and mop on the next clean")}</strong></span></label>
          <label class="plan-option"><input type="checkbox" aria-label=${this.#e("v4_cadence_do_coverage_next_named","Use periodic coverage on the next clean for {room}",{room:t})} .checked=${o.doCoverageNext} ?disabled=${!o.coverageEveryN} @change=${b=>this.#s(s,{doCoverageNext:x(b)})}><span class="plan-option-copy"><strong>${this.#e("v4_cadence_do_coverage_next","Use periodic coverage on the next clean")}</strong></span></label>
        </div>
        <p class="subtle" aria-live="polite">${this.#m(o,l,e.cadenceReasons)}</p>
        ${a.id&&(o.mopEveryN||o.coverageEveryN||c||v)?i`
          <div class="toolbar">
            ${o.mopEveryN||c?i`<button
              class="danger ms-btn ms-btn--secondary ms-btn--danger"
              type="button"
              aria-label=${this.#e("v4_reset_mop_cadence_button_named","Reset mopping progress for {room}",{room:t})}
              data-dialog-launcher="confirmResetCadence"
              ?disabled=${g}
              @click=${()=>this.#t({type:"request-room-cadence-reset",planId:a.id,roomId:e.roomId,mode:"mop"})}
            >${this.#e("v4_reset_mop_cadence_button","Reset mopping")}</button>`:m}
            ${o.coverageEveryN||v?i`<button
              class="danger ms-btn ms-btn--secondary ms-btn--danger"
              type="button"
              aria-label=${this.#e("v4_reset_coverage_cadence_button_named","Reset coverage progress for {room}",{room:t})}
              data-dialog-launcher="confirmResetCadence"
              ?disabled=${g}
              @click=${()=>this.#t({type:"request-room-cadence-reset",planId:a.id,roomId:e.roomId,mode:"coverage"})}
            >${this.#e("v4_reset_coverage_cadence_button","Reset coverage")}</button>`:m}
          </div>
          <p class="subtle">${this.#e("v4_reset_cadence_hint","Reset is available for a saved plan while the robot is idle. Cleaning history is kept separately.")}</p>
        `:m}
      </details>
    `}#w(e){let s=this.state.planDraft.rooms,a=s.find(o=>o.roomId===e)?s.filter(o=>o.roomId!==e):[...s,{roomId:e,cleaningMode:"vacuum",coverageSetting:"standard"}];this.#t({type:"patch-plan-draft",patch:{rooms:a}})}#l(e,s){let t=this.state.planDraft.rooms.map((a,o)=>o===e?{...a,...s}:a);this.#t({type:"patch-plan-draft",patch:{rooms:t}})}#h(e,s){let t=e+s,a=[...this.state.planDraft.rooms];if(t<0||t>=a.length)return;let[o]=a.splice(e,1);o&&(a.splice(t,0,o),this.#t({type:"patch-plan-draft",patch:{rooms:a}}))}#k(){let e=this.state.resources.plans;return this.#i(e.status,e.problem,i`
      <div class="stack">
        <button class="ms-btn ms-btn--primary" type="button" @click=${()=>this.#t({type:"select-plan",planId:null})}>
          ${S(U)}<span>${this.#e("v4_create_plan","Create a plan")}</span>
        </button>
        ${(e.value?.plans||[]).map(s=>i`
          <button class="ms-row ms-row--card" type="button" @click=${()=>this.#t({type:"select-plan",planId:s.id})}>
            <span class="ms-row__body"><strong>${s.name}</strong>
              <small>${this.#e("v4_plan_room_count","{count} rooms",{count:s.rooms.length})}${s.enabled?"":` \xB7 ${this.#e("v4_paused","paused")}`}</small>
            </span>
            <span class="ms-row__trail">${this.#e("v4_edit_plan","Edit plan")}</span>
          </button>
        `)}
      </div>
    `)}#x(){let e=this.state.resources.plans,s=e.value,t=this.state.planDraft,a=t.rooms.map(n=>({room:n,label:s?.rooms.find(c=>c.roomId===n.roomId)?.name||"Room",selected:!0})),o=(s?.rooms||[]).filter(n=>!t.rooms.some(c=>c.roomId===n.roomId)).map(n=>({room:{roomId:n.roomId,cleaningMode:"vacuum",coverageSetting:"standard"},label:n.name,selected:!1})),l=[...a,...o],d=t.rooms.length>=100,p=new Set(t.rooms.map(n=>`${n.cleaningMode}:${n.coverageSetting}`)).size>1,h=(t.id?s?.plans.find(n=>n.id===t.id):void 0)?.nextRunPreview;return this.#i(e.status,e.problem,i`
      <div class="stack">
        <label class="field ms-field">${this.#e("plan_name","Plan name")}
          <input
            maxlength="128"
            autocomplete="off"
            .value=${t.name}
            @input=${n=>this.#t({type:"patch-plan-draft",patch:{name:$(n)}})}
          >
        </label>
        <div class="split plan-meta">
          <label class="field ms-field">${this.#e("plan_run_behavior","Cleaning order")}
            <select
              .value=${t.runBehavior}
              @change=${n=>this.#t({type:"patch-plan-draft",patch:{runBehavior:$(n)==="ordered"?"ordered":"intelligent"}})}
            >
              <option value="intelligent">${this.#e("plan_intelligent","Intelligent rotation")}</option>
              <option value="ordered">${this.#e("plan_ordered","Saved order")}</option>
            </select>
          </label>
          <div class="ms-row plan-active" data-active=${String(t.enabled)}>
            <div class="ms-row__body">
              <strong id="plan-active-title">${this.#e("v4_plan_can_run","Plan enabled")}</strong>
              <small id="plan-active-desc">${t.enabled?this.#e("v4_plan_can_run_on","Available from Run a plan, automations, and Home Assistant services."):this.#e("v4_plan_can_run_off","Paused. Turn this on to make the plan available.")}</small>
            </div>
            <button
              class="ms-switch"
              type="button"
              role="switch"
              aria-checked=${String(t.enabled)}
              aria-labelledby="plan-active-title"
              aria-describedby="plan-active-desc"
              @click=${()=>this.#t({type:"patch-plan-draft",patch:{enabled:!t.enabled}})}
            ></button>
          </div>
        </div>
        <h3 class="group-heading" id="plan-rooms-heading">${this.#e("plan_rooms","Plan rooms")}</h3>
        ${p?i`
          <p class="subtle plan-transition-hint">${this.#e("v4_plan_mixed_settings","Rooms with different cleaning settings may need separate missions and dock visits.")}
            ${t.runBehavior==="ordered"?this.#e("v4_plan_group_settings","Placing rooms with matching settings together can reduce transitions."):this.#e("v4_plan_rotation_settings","Intelligent rotation determines the room order.")}
          </p>
        `:m}
        <div class="list" role="group" aria-labelledby="plan-rooms-heading">
          ${ee(l,({room:n})=>n.roomId,({room:n,label:c,selected:v})=>{let g=v?t.rooms.findIndex(_=>_.roomId===n.roomId):-1;return i`
              <div class="room plan-room ms-row ms-row--stack" data-selected=${String(v)}>
                <div class="room-choice">
                  <label class="plan-room-label">
                  <input type="checkbox" .checked=${v} ?disabled=${!v&&d} @change=${()=>this.#w(n.roomId)}>
                  <strong>${v?`${g+1}. `:""}${c}</strong>
                  </label>
                  ${v?i`
                    <span>
                      <button class="icon-button ms-btn ms-btn--icon" type="button" aria-label=${this.#e("move_room_up","Move {room} earlier",{room:c})} ?disabled=${g===0} @click=${_=>{_.preventDefault(),this.#h(g,-1)}}>${S(O)}</button>
                      <button class="icon-button ms-btn ms-btn--icon" type="button" aria-label=${this.#e("move_room_down","Move {room} later",{room:c})} ?disabled=${g===t.rooms.length-1} @click=${_=>{_.preventDefault(),this.#h(g,1)}}>${S(W)}</button>
                    </span>
                  `:m}
                </div>
                ${v?i`
                  <div class="split room-settings">
                    <label class="field ms-field">${this.#e("v4_cleaning_system","Cleaning system")}
                      <select aria-label=${this.#e("v4_room_cleaning_system_named","Cleaning system for {room}",{room:c})} .value=${n.cleaningMode} @change=${_=>this.#l(g,{cleaningMode:$(_)})}>${N.map(_=>i`<option value=${_} ?selected=${_===n.cleaningMode} ?disabled=${!!("cadence"in n&&n.cadence?.mopEveryN&&_!=="vacuum")}>${this.#o(_)}</option>`)}</select>
                    </label>
                    <label class="field ms-field">${this.#e("cleaning_mode","Cleaning mode")}
                      <select aria-label=${this.#e("v4_room_cleaning_mode_named","Cleaning mode for {room}",{room:c})} .value=${n.coverageSetting} @change=${_=>this.#l(g,{coverageSetting:$(_)})}>${P.map(_=>i`<option value=${_} ?selected=${_===n.coverageSetting}>${this.#a(_)}</option>`)}</select>
                    </label>
                  </div>
                  ${this.#y(n,g,c)}
                `:m}
              </div>
            `})}
        </div>
        ${d?i`<p class="subtle" role="status">${this.#e("v4_room_limit_reached","Up to {limit} rooms can be included. Remove one before adding another.",{limit:100})}</p>`:m}
        <section class="stack" aria-labelledby="next-run-preview-heading">
          <h3 class="group-heading" id="next-run-preview-heading">${this.#e("v4_next_run_preview","Next-run preview")}</h3>
          <p class="subtle">${this.#e("v4_next_run_preview_hint","This is the next saved-plan run, separate from any current run. The backend refreshes it before dispatch.")}</p>
          ${t.id?h?h.blocker?i`<p class="problem" role="alert">${this.#g(h.blocker)}</p>`:/^[0-9a-f]{64}$/u.test(h.previewToken??"")?i`
                  ${t.dirty?i`<p class="notice" role="status">${this.#e("v4_next_run_preview_stale","This preview shows the saved plan. Save your edits to calculate the updated order and settings before starting.")}</p>`:m}
                  <ol class="list" aria-label=${this.#e("v4_next_run_preview_order","Next-run room order and effective settings")}>
                    ${h.rooms.map((n,c)=>{let v=1+h.missionBoundaries.filter(g=>g<=c).length;return i`<li class="ms-row ms-row--stack">
                        <span class="subtle">${this.#e("v4_next_run_mission","Mission {number}",{number:v})}</span>
                        <strong>${c+1}. ${n.name}</strong>
                        <span>${this.#o(n.cleaningMode)} \u00b7 ${this.#a(n.coverageSetting)}</span>
                        ${n.cadenceReasons.length?i`<small>${n.cadenceReasons.map(g=>this.#c(g)).join(" \xB7 ")}</small>`:m}
                      </li>`})}
                  </ol>
                `:i`<p class="problem" role="status">${this.#e("v4_next_run_preview_unavailable","A verified next-run preview is unavailable. Refresh the saved plan before starting it.")}</p>`:i`<p class="problem" role="status">${this.#e("v4_next_run_preview_unavailable","A verified next-run preview is unavailable. Refresh the saved plan before starting it.")}</p>`:i`<p class="subtle">${this.#e("v4_next_run_preview_save_first","Save this plan to calculate its exact room order and effective settings.")}</p>`}
        </section>
        <h3 class="group-heading" id="completion-heading">${this.#e("v4_completion_options","When a run ends")}</h3>
        <div class="plan-options" role="group" aria-labelledby="completion-heading">
          <label class="plan-option">
            <input type="checkbox" .checked=${t.returnToBase} @change=${n=>this.#t({type:"patch-plan-draft",patch:{returnToBase:x(n)}})}>
            <span class="plan-option-copy">
              <strong>${this.#e("plan_return_to_base","Return to the dock when finished")}</strong>
              <small>${this.#e("plan_return_to_base_hint","After the last selected room, the robot returns to the dock.")}</small>
            </span>
          </label>
          <label class="plan-option">
            <input type="checkbox" .checked=${t.finishCurrentRoom} @change=${n=>this.#t({type:"patch-plan-draft",patch:{finishCurrentRoom:x(n)}})}>
            <span class="plan-option-copy">
              <strong>${this.#e("plan_finish_room","Finish the current room after Stop")}</strong>
              <small>${this.#e("plan_finish_room_hint","When enough of the room is complete, finish it before docking. Never start another room.")}</small>
            </span>
          </label>
          ${t.finishCurrentRoom?i`
            <label class="plan-threshold ms-field">
              <span class="plan-threshold-copy">
                <strong>${this.#e("plan_threshold","Minimum room progress")}</strong>
                <small>${this.#e("plan_threshold_hint","When Stop is requested, the robot checks this progress: below it stops now; at or above it finishes this room before docking.")}</small>
              </span>
              <span class="threshold-value">${t.finishCurrentRoomThreshold}%</span>
              <input type="range" min="0" max="100" step="5" .value=${String(t.finishCurrentRoomThreshold)} aria-label=${this.#e("plan_threshold","Minimum room progress")} @input=${n=>this.#t({type:"patch-plan-draft",patch:{finishCurrentRoomThreshold:Number($(n))}})}>
            </label>
          `:m}
        </div>
        <div class="toolbar">
          ${t.id?i`
            <button
              class="danger ms-btn ms-btn--secondary ms-btn--danger"
              type="button"
              aria-label=${this.#e("plan_delete","Delete plan")}
              data-dialog-launcher="confirmDeletePlan"
              @click=${()=>this.#t({type:"open-dialog",dialog:"confirmDeletePlan"})}
            >${this.#e("plan_delete","Delete")}</button>
          `:m}
        </div>
        ${this.#r()}
      </div>
    `)}#R(){let e=this.state.resources.areas;return i`
      <div class="stack">
        <p class="subtle">${this.state.draw.tool==="outline"?this.#e("v4_zone_coverage","Place points around the zone. Shading shows cleaning coverage inside the perimeter; narrow edges may remain uncovered."):this.#e("v4_draw_floor_hint","Paint only on the mapped floor. Zoom and pan never change the saved outline.")}</p>
        ${this.state.draw.tool!=="outline"?i`<p class="subtle">${this.#e("v4_keyboard_draw_help","Keyboard: focus the map, use arrow keys to aim, then Enter to paint or erase at the crosshair. D selects Paint; E selects Erase.")}</p>`:m}
        ${this.#i(e.status,e.problem,i`
          <div class="group">
            <h3 class="group-heading" id="areas-heading">${this.#e("area_workspace_title","Saved custom areas")}</h3>
            <div class="list" role="group" aria-labelledby="areas-heading">
            <button class="list-button ms-row ms-row" type="button" @click=${()=>this.#t({type:"select-area",areaId:null})}>\uff0b ${this.#e("area_new","New outline")}</button>
            ${(e.value?.areas||[]).map(s=>i`
              <button class="list-button ms-row ms-row" type="button" @click=${()=>{this.#t({type:"select-area",areaId:s.id,workflow:"areaReview"})}}>
                <span>${s.name}</span>
                <small>${s.status==="current"?this.#e("area_workspace_ready","Ready"):this.#e("v4_review","Review")}</small>
              </button>
            `)}
            </div>
          </div>
        `)}
      </div>
    `}#S(){let e=this.state.areaDraft,s=e.canRebind||e.status==="review",t=!s&&(e.status==="stale"||e.status==="unknown");return i`
      <div class="stack">
        ${s?i`<div class="notice" data-tone="warning" role="status">${this.#e("area_review_required","Review the saved outline on this current map, then confirm it.")}</div>`:m}
        ${t?i`<div class="problem" role="alert">${this.#e("area_redraw_required","This outline no longer matches the current room map. Redraw it before saving.")}</div>`:m}
        <label class="field ms-field">${this.#e("area_name","Area name")}
          <input maxlength="128" autocomplete="off" .value=${e.name} @input=${a=>this.#t({type:"patch-area-draft",patch:{name:$(a)}})}>
        </label>
        <div class="split">
          <label class="field ms-field">${this.#e("v4_cleaning_system","Cleaning system")}
            <select .value=${e.cleaningMode} @change=${a=>this.#t({type:"patch-area-draft",patch:{cleaningMode:$(a)}})}>${N.map(a=>i`<option value=${a} ?selected=${a===e.cleaningMode}>${this.#o(a)}</option>`)}</select>
          </label>
          <label class="field ms-field">${this.#e("cleaning_mode","Cleaning mode")}
            <select .value=${e.coverageSetting} @change=${a=>this.#t({type:"patch-area-draft",patch:{coverageSetting:$(a)}})}>${P.map(a=>i`<option value=${a} ?selected=${a===e.coverageSetting}>${this.#a(a)}</option>`)}</select>
          </label>
        </div>
        <div class="toolbar">
          <button class="ms-btn ms-btn--secondary" type="button" @click=${()=>this.#t({type:"open-workflow",workflow:"draw"})}>${this.#e("v4_edit_outline","Edit outline")}</button>
          ${e.id?i`
            <button
              class="danger ms-btn ms-btn--secondary ms-btn--danger"
              type="button"
              aria-label=${this.#e("area_delete","Delete area")}
              data-dialog-launcher="confirmDeleteArea"
              @click=${()=>this.#t({type:"open-dialog",dialog:"confirmDeleteArea"})}
            >${this.#e("area_delete","Delete")}</button>
          `:m}
        </div>
        ${this.#r()}
      </div>
    `}#C(){let e=this.state.resources.history,s=e.value,t=s?.floors.find(p=>p.id===this.state.selection.floorId)||s?.floors.find(p=>p.active)||s?.floors[0],a=t?.snapshots||[],o=this.state.selection.historyId?Math.max(0,a.findIndex(p=>p.id===this.state.selection.historyId)):a.length,l=t?.active?this.#e("map_timeline_live_action","Live"):this.#e("v4_return_current_floor","Return to current floor"),d=a[o];return this.#i(e.status,e.problem,i`
      <div class="stack">
        ${(s?.floors.length||0)>1?i`
          <div class="group">
            <h3 class="group-heading" id="floors-heading">${this.#e("v4_mapped_floors","Mapped floors")}</h3>
            <div class="list" role="group" aria-labelledby="floors-heading">
            ${(s?.floors||[]).map((p,f)=>i`
              <button
                class="floor ms-row ms-row"
                type="button"
                aria-current=${String(p.id===t?.id)}
                @click=${()=>this.#t({type:"set-floor",floorId:p.id})}
              >
                <span>${p.label||(p.active?this.#e("v4_current_floor","Current floor"):this.#e("v4_saved_floor","Saved floor {number}",{number:p.ordinal??f}))}</span>
                <small>${p.active?this.#e("map_timeline_live_action","Live"):this.#e("v4_read_only","Read only")}</small>
              </button>
            `)}
            </div>
          </div>
        `:m}
        <div class="timeline">
          <label class="field ms-field">${this.#e("map_timeline_label","Map timeline")}
            <input
              type="range"
              min="0"
              max=${String(a.length)}
              step="1"
              .value=${String(o)}
              aria-valuetext=${d?this.#v(d.createdAt):l}
              ?disabled=${!a.length}
              @input=${p=>{let f=Number($(p));this.#t({type:"set-history",historyId:f===a.length?null:a[f]?.id||null})}}
            >
          </label>
          <div class="list">
            <button class="snapshot ms-row ms-row" type="button" aria-current=${String(!this.state.selection.historyId&&!!t?.active)} @click=${()=>this.#t({type:"set-history",historyId:null})}><span>${l}</span><small>${this.#e("v4_current","Current")}</small></button>
            ${a.map((p,f)=>i`
              <button class="snapshot ms-row ms-row" type="button" aria-current=${String(p.id===this.state.selection.historyId)} @click=${()=>this.#t({type:"set-history",historyId:p.id})}>
                <span>${this.#v(p.createdAt)}</span><small>${f+1} of ${a.length}</small>
              </button>
            `)}
          </div>
        </div>
        <p class="subtle">${this.#e("v4_history_privacy","Saved maps are floor-scoped and never show a live robot position.")}</p>
      </div>
    `)}#v(e){try{return new Intl.DateTimeFormat(this.state.locale,{dateStyle:"medium",timeStyle:"short"}).format(new Date(e))}catch{return this.#e("v4_saved_map","Saved map")}}#u(){this.#n||customElements.get("matic-map-diagnostics-v4")||(this._diagnosticsLoadFailed=!1,this.#n=import("./diagnostics-panel-AOWDNRVP.js").then(()=>{this.#n=null,this.requestUpdate()}).catch(()=>{this.#n=null,this._diagnosticsLoadFailed=!0}))}#E(){return customElements.get("matic-map-diagnostics-v4")?i`<matic-map-diagnostics-v4
        .state=${this.state}
        .localize=${this.localize}
        .disabled=${this.state.command!=="idle"&&this.state.command!=="failed"}
      ></matic-map-diagnostics-v4>`:this._diagnosticsLoadFailed?i`<div class="problem" role="alert">
        <p>${this.#e("v4_workflow_load_failed","Workspace tools could not be loaded.")}</p>
        <button class="ms-btn ms-btn--secondary" type="button" @click=${this.#u}>
          ${this.#e("v4_retry","Try again")}
        </button>
      </div>`:(this.#u(),i`<p class="loading" role="status" aria-live="polite">${this.#e("v4_workflow_loading","Loading workspace tools\u2026")}</p>`)}render(){return i`<fieldset class="workflow-fields" ?disabled=${this.state.command!=="idle"&&this.state.command!=="failed"}>${this.#P()}</fieldset>`}#P(){switch(this.state.workflow){case"rooms":return this.#b();case"plans":return this.#k();case"plan":return this.#x();case"draw":return this.#R();case"areaReview":return this.#S();case"history":return this.#C();case"support":return this.#E();case"none":return m}}};customElements.get(I)||customElements.define(I,T);export{T as MaticMapWorkflowV4};
/*! Bundled license information:

lit-html/directive.js:
lit-html/directives/repeat.js:
  (**
   * @license
   * Copyright 2017 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

lit-html/directive-helpers.js:
  (**
   * @license
   * Copyright 2020 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/
