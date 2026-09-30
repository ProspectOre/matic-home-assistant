import{c as I,z as F}from"./chunk-CYDO2I32.js";import{H as z,I as o,L as D,M as p,N as L,O as B,P as V,Q as q,R as H,c as k,l as T,la as U,ma as O,n as A,na as W,xa as E,ya as j}from"./chunk-OTYJ26W5.js";var K={ATTRIBUTE:1,CHILD:2,PROPERTY:3,BOOLEAN_ATTRIBUTE:4,EVENT:5,ELEMENT:6},Q=r=>(...u)=>({_$litDirective$:r,values:u}),C=class{constructor(u){}get _$AU(){return this._$AM._$AU}_$AT(u,e,a){this._$Ct=u,this._$AM=e,this._$Ci=a}_$AS(u,e){return this.update(u,e)}update(u,e){return this.render(...e)}};var{I:te}=L,G=r=>r;var Y=()=>document.createComment(""),w=(r,u,e)=>{let a=r._$AA.parentNode,t=u===void 0?r._$AB:u._$AA;if(e===void 0){let s=a.insertBefore(Y(),t),i=a.insertBefore(Y(),t);e=new te(s,i,r,r.options)}else{let s=e._$AB.nextSibling,i=e._$AM,l=i!==r;if(l){let c;e._$AQ?.(r),e._$AM=r,e._$AP!==void 0&&(c=r._$AU)!==i._$AU&&e._$AP(c)}if(s!==t||l){let c=e._$AA;for(;c!==s;){let f=G(c).nextSibling;G(a).insertBefore(c,t),c=f}}}return e},y=(r,u,e=r)=>(r._$AI(u,e),r),se={},Z=(r,u=se)=>r._$AH=u,X=r=>r._$AH,S=r=>{r._$AR(),r._$AA.remove()};var J=(r,u,e)=>{let a=new Map;for(let t=u;t<=e;t++)a.set(r[t],t);return a},ee=Q(class extends C{constructor(r){if(super(r),r.type!==K.CHILD)throw Error("repeat() can only be used in text expressions")}dt(r,u,e){let a;e===void 0?e=u:u!==void 0&&(a=u);let t=[],s=[],i=0;for(let l of r)t[i]=a?a(l,i):i,s[i]=e(l,i),i++;return{values:s,keys:t}}render(r,u,e){return this.dt(r,u,e).values}update(r,[u,e,a]){let t=X(r),{values:s,keys:i}=this.dt(u,e,a);if(!Array.isArray(t))return this.ut=i,s;let l=this.ut??=[],c=[],f,h,m=0,n=t.length-1,d=0,v=s.length-1;for(;m<=n&&d<=v;)if(t[m]===null)m++;else if(t[n]===null)n--;else if(l[m]===i[d])c[d]=y(t[m],s[d]),m++,d++;else if(l[n]===i[v])c[v]=y(t[n],s[v]),n--,v--;else if(l[m]===i[v])c[v]=y(t[m],s[v]),w(r,c[v+1],t[m]),m++,v--;else if(l[n]===i[d])c[d]=y(t[n],s[d]),w(r,t[m],t[n]),n--,d++;else if(f===void 0&&(f=J(i,d,v),h=J(l,m,n)),f.has(l[m]))if(f.has(l[n])){let g=h.get(i[d]),_=g!==void 0?t[g]:null;if(_===null){let R=w(r,t[m]);y(R,s[d]),c[d]=R}else c[d]=y(_,s[d]),w(r,t[m],_),t[g]=null;d++}else S(t[n]),n--;else S(t[m]),m++;for(;d<=v;){let g=w(r,c[v+1]);y(g,s[d]),c[d++]=g}for(;m<=n;){let g=t[m++];g!==null&&S(g)}return this.ut=i,Z(r,c),D}});var N=["vacuum","mop","vacuum_and_mop"],P=["quick","standard","heavy_duty"],$=r=>r.currentTarget.value,x=r=>r.currentTarget.checked,M=class extends B{constructor(){super(...arguments);this.state=T();this._diagnosticsLoadFailed=!1;this._historyPreviewPosition=null;this.#n=null;this.#c=""}static{this.properties={state:{attribute:!1},localize:{attribute:!1},_diagnosticsLoadFailed:{state:!0},_historyPreviewPosition:{state:!0}}}static{this.styles=[V,q,H,z`
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
`]}#n;#c;willUpdate(e){if(!e.has("state"))return;let{workflow:a,selection:t}=this.state,s=`${a}:${t.floorId}:${t.historyId??"live"}`;s!==this.#c&&(this.#c=s,this._historyPreviewPosition=null)}disconnectedCallback(){super.disconnectedCallback()}#e(e,a,t){return j(this.localize,e,a,t)}#i(e){return e==="vacuum"?this.#e("vacuum","Vacuum"):e==="mop"?this.#e("mop","Mop"):this.#e("vacuum_and_mop","Vacuum + mop")}#a(e){return e==="quick"?this.#e("quick","Quick"):e==="standard"?this.#e("standard","Optimal"):this.#e("heavy_duty","Heavy Duty")}#d(e){return e==="mop_due"?this.#e("v4_cadence_mop_due_reason","Vacuum and mop are due"):e==="coverage_due"?this.#e("v4_cadence_coverage_due_reason","Periodic coverage is due"):e==="mop_progress_unverified"?this.#e("v4_cadence_mop_progress_unverified","Mopping progress must be reset before this schedule can run."):e==="coverage_progress_unverified"?this.#e("v4_cadence_coverage_progress_unverified","Coverage progress must be reset before this schedule can run."):this.#e("v4_cadence_due_unknown_reason","Schedule setting due")}#_(e){return e==="plan_disabled"?this.#e("v4_preview_plan_disabled","This plan is paused. Enable it to preview and run."):e==="shared_schedule_unavailable"?this.#e("v4_preview_shared_unavailable","The shared room schedule cannot be verified on this map."):e==="cadence_progress_unverified"?this.#e("v4_preview_cadence_progress_unverified","A room schedule has progress that cannot be verified. Reset the affected interval in its room schedule before running this plan."):e==="cadence_identity_changed"||e==="cadence_identity_unavailable"?this.#e("v4_preview_identity_unavailable","Room identity could not be verified. Check the current map before running."):e==="plan_has_no_rooms"?this.#e("v4_preview_no_rooms","Add at least one room to this plan."):e==="plan_room_limit"?this.#e("v4_preview_room_limit","This saved plan exceeds the 100-room limit. Remove rooms and save it before running."):this.#e("v4_preview_invalid","The saved plan preview is invalid. Review the plan and try again.")}#t(e){this.dispatchEvent(new CustomEvent(F,{detail:e,bubbles:!0,composed:!0}))}#r(){return this.state.notice?o`
      <div class="notice" data-tone=${this.state.notice.tone} role=${this.state.notice.tone==="error"?"alert":"status"}>
        ${this.state.notice.text}
      </div>
    `:p}#b(){switch(this.state.workflow){case"rooms":case"plans":case"plan":return{loading:this.#e("v4_loading_rooms_plans","Loading rooms and plans\u2026"),unavailable:this.#e("v4_rooms_plans_unavailable","Rooms and plans are unavailable right now."),empty:this.#e("v4_no_rooms_plans","No rooms or plans are available yet.")};case"draw":case"areaReview":return{loading:this.#e("v4_loading_areas","Loading saved areas\u2026"),unavailable:this.#e("v4_areas_unavailable","Saved areas are unavailable right now."),empty:this.#e("v4_no_saved_areas","No saved areas yet. Draw one on the map.")};case"history":return{loading:this.#e("v4_loading_history","Loading map history\u2026"),unavailable:this.#e("v4_history_unavailable","Map history is unavailable right now."),empty:this.#e("v4_no_map_history","No saved map snapshots yet.")};default:return{loading:this.#e("map_loading","Loading\u2026"),unavailable:this.#e("v4_workspace_unavailable","This workspace is unavailable right now."),empty:this.#e("v4_nothing_saved","Nothing saved yet.")}}}#o(e,a,t){let s=this.#b();if(e==="loading"||e==="idle")return o`<div class="loading" role="status">${s.loading}</div>`;if(e==="error"){let i=this.state.workflow;return o`
        <div class="stack">
          <div class="problem" role="alert">${s.unavailable} ${a==="request-failed"?this.#e("v4_try_again","Try again shortly."):this.#e("v4_return_live_retry","Return to the live map and retry.")}</div>
          <div class="toolbar">
            <button class="ms-btn ms-btn--secondary" type="button" @click=${()=>this.#t({type:"open-workflow",workflow:i})}>${this.#e("v4_retry","Try again")}</button>
          </div>
        </div>
      `}return e==="empty"?o`<div class="empty">${s.empty}</div>`:t}#f(){let e=this.state.resources.plans,a=A(this.state),t=a!==null,s=this.state.selection.roomIds.length>=100;return this.#o(e.status,e.problem,o`
      <div class="stack">
        <h3 class="group-heading" id="rooms-heading">${this.#e("v4_rooms_to_clean","Rooms to clean")}</h3>
        <div class="list" role="group" aria-labelledby="rooms-heading">
          ${(e.value?.rooms||[]).map(i=>{let l=this.state.selection.roomIds.includes(i.roomId);return o`
              <div class="room ms-row ms-row--stack" data-selected=${String(l)}>
                <label class="room-choice">
                  <input
                    type="checkbox"
                    .checked=${l}
                    ?disabled=${!l&&s}
                    @change=${()=>this.#t({type:"toggle-room",roomId:i.roomId})}
                  >
                  <strong>${i.name}</strong>
                  ${l?o`<small>${this.#e("v4_room_ready","Ready")}</small>`:p}
                </label>
                ${l?this.#y(i.roomId,this.state.selection.roomSettings.find(c=>c.roomId===i.roomId)||{roomId:i.roomId,cleaningMode:"vacuum",coverageSetting:"standard"}):p}
              </div>
            `})}
        </div>
        ${s?o`<p class="subtle" role="status">${this.#e("v4_room_limit_reached","Up to {limit} rooms can be included. Remove one before adding another.",{limit:100})}</p>`:p}
        <p class="subtle">${this.#e("v4_room_selection_hint","Select rooms here or directly on the map. The map and list stay in sync.")}</p>
        <label class="plan-option">
          <input type="checkbox" .checked=${!this.state.selection.useRoomSchedule} @change=${i=>this.#t({type:"set-use-room-schedule",value:!x(i)})}>
          <span class="plan-option-copy">
            <strong>${this.#e("v4_override_room_schedule","Override shared schedule settings")}</strong>
            <small>${this.#e("v4_override_room_schedule_hint","By default, this clean applies the shared schedule. Turn this on to use the settings selected here. Omitted due work stays due, and compatible verified work still counts toward shared progress.")}</small>
          </span>
        </label>
        <div class="stack" aria-label=${this.#e("v4_shared_schedule_status","Shared room schedule status")}>
          ${this.state.selection.roomIds.map(i=>{let l=e.value?.rooms.find(c=>c.roomId===i);return l?.sharedCadence||l?.sharedCadenceProgress||l?.sharedCadenceReasons?.length?o`<p class="subtle">${l.name}: ${this.#p(l.sharedCadence,l.sharedCadenceProgress,l.sharedCadenceReasons)}</p>`:p})}
        </div>
        ${this.state.manualRoomPreview.status==="loading"?o`<p role="status" class="subtle">${this.#e("v4_room_preview_loading","Verifying the effective room settings\u2026")}</p>`:p}
        ${this.state.manualRoomPreview.status==="error"?o`<div class="stack">
            <div role="alert" class="problem">${this.#e("v4_room_preview_unavailable","Your room selections are saved, but the effective settings could not be verified. Retry the preview to enable cleaning.")}</div>
            <div class="toolbar"><button class="ms-btn ms-btn--secondary" type="button" @click=${()=>this.#t({type:"retry-room-preview"})}>${this.#e("v4_retry_preview","Retry preview")}</button></div>
          </div>`:p}
        ${t?this.#$(a.preview):p}
        ${this.#r()}
      </div>
    `)}#$(e){let a=new Set(e.missionBoundaries);return o`
      <section class="stack" aria-labelledby="effective-rooms-heading" aria-live="polite">
        <h3 class="group-heading" id="effective-rooms-heading">${this.#e("v4_effective_room_preview","Effective cleaning preview")}</h3>
        ${e.blocker?o`<p class="problem" role="alert">${e.blocker==="invalid_cadence_policy"&&this.state.selection.useRoomSchedule&&this.state.selection.roomSettings.some(t=>t.cleaningMode!=="vacuum")?this.#e("v4_room_preview_schedule_override","The shared schedule cannot apply this selected cleaning system. Turn on Override shared schedule settings or choose a compatible system."):this.#e("v4_room_preview_blocked","The effective room sequence is blocked. Review the selected rooms and shared schedule settings, then retry.")}</p>`:p}
        ${e.rooms.length?o`<ol class="list" aria-label=${this.#e("v4_effective_room_order","Effective room order")}>
            ${e.rooms.map((t,s)=>o`
              <li class="ms-row ms-row--stack">
                ${a.has(s)?o`<strong>${this.#e("v4_room_mission_boundary","New mission")}</strong>`:p}
                <strong>${t.name}</strong>
                <span class="subtle">${this.#i(t.cleaningMode)} \u00b7 ${this.#a(t.coverageSetting)}</span>
                ${t.cadenceReasons.length?o`<span class="subtle">${t.cadenceReasons.map(i=>this.#d(i)).join("; ")}</span>`:p}
              </li>
            `)}
          </ol>`:p}
      </section>
    `}#y(e,a){let t=this.state.resources.plans.value?.rooms.find(s=>s.roomId===e)?.name||this.#e("v4_room","Room");return o`
      <div class="split room-settings">
        <label class="field ms-field">${this.#e("v4_cleaning_system","Cleaning system")}
          <select
            aria-label=${this.#e("v4_room_cleaning_system_named","Cleaning system for {room}",{room:t})}
            .value=${a.cleaningMode}
            @change=${s=>this.#t({type:"patch-room-settings",roomId:e,cleaningMode:$(s)})}
          >${N.map(s=>o`<option value=${s} ?selected=${s===a.cleaningMode}>${this.#i(s)}</option>`)}</select>
        </label>
        <label class="field ms-field">${this.#e("cleaning_mode","Cleaning mode")}
          <select
            aria-label=${this.#e("v4_room_cleaning_mode_named","Cleaning mode for {room}",{room:t})}
            .value=${a.coverageSetting}
            @change=${s=>this.#t({type:"patch-room-settings",roomId:e,coverageSetting:$(s)})}
          >${P.map(s=>o`<option value=${s} ?selected=${s===a.coverageSetting}>${this.#a(s)}</option>`)}</select>
        </label>
      </div>
    `}#m(e){return e.cadence||{scope:"plan",mopEveryN:null,coverageEveryN:null,periodicCoverageSetting:null,doMopNext:!1,doCoverageNext:!1}}#p(e,a,t=a?.reasons||[]){if(t.includes("identity_changed")||t.includes("room_not_on_current_map"))return this.#e("v4_cadence_identity_blocked","Schedule identity does not match the current room map. Review this room before cleaning.");if(t.includes("shared_schedule_unavailable"))return this.#e("v4_cadence_shared_unavailable","The shared room schedule is unavailable. Review its settings before cleaning.");if(t.includes("mop_progress_unverified")||t.includes("coverage_progress_unverified")){let c=[];return t.includes("mop_progress_unverified")&&c.push(this.#e("v4_cadence_mop_progress_unverified","Mopping progress must be reset before this schedule can run.")),t.includes("coverage_progress_unverified")&&c.push(this.#e("v4_cadence_coverage_progress_unverified","Coverage progress must be reset before this schedule can run.")),c.join(" ")}if(t.includes("invalid_cadence_policy"))return this.#e("v4_cadence_policy_invalid","The room schedule needs review before it can be applied.");if(!e||!e.mopEveryN&&!e.coverageEveryN)return this.#e("v4_cadence_not_enabled","No recurring room schedule is enabled.");let s=[],i=a?.mopDue||a?.reasons.includes("mop_due"),l=a?.coverageDue||a?.reasons.includes("coverage_due");return e.mopEveryN&&s.push(i?this.#e("v4_cadence_mop_due","Vacuum and mop is due on this clean."):this.#e("v4_cadence_mop_progress","Mop every {interval} cleans; {completed} qualifying cleans since the last mop.",{interval:e.mopEveryN,completed:a?.mopProgress??0})),e.coverageEveryN&&s.push(l?this.#e("v4_cadence_coverage_due","{coverage} periodic coverage is due on this clean.",{coverage:this.#a(e.periodicCoverageSetting||"standard")}):this.#e("v4_cadence_coverage_progress","Periodic coverage every {interval} cleans; {completed} qualifying cleans so far.",{interval:e.coverageEveryN,completed:a?.coverageProgress??0})),s.join(" ")}#s(e,a){let t=this.state.planDraft.rooms[e];t&&this.#l(e,{cadence:{...this.#m(t),...a}})}#h(e,a,t){let s=e.currentTarget,i=s.value;if(i===""){t==="mopEveryN"?this.#s(a,{mopEveryN:null,doMopNext:!1}):this.#s(a,{coverageEveryN:null,doCoverageNext:!1});return}let l=Number(i);if(!Number.isInteger(l)||l<1||l>100){s.reportValidity();return}let c=this.state.planDraft.rooms[a];if(c){if(t==="coverageEveryN"){this.#s(a,{coverageEveryN:l,periodicCoverageSetting:c.cadence?.periodicCoverageSetting||c.coverageSetting});return}this.#s(a,{[t]:l})}}#w(e,a,t){let s=this.state.planDraft,i=this.#m(e),l=e.cadenceProgress,f=(s.id?this.state.resources.plans.value?.plans.find(b=>b.id===s.id)?.rooms.find(b=>b.roomId===e.roomId):void 0)?.cadence?.scope??null,h=this.state.resources.plans.value?.rooms.find(b=>b.roomId===e.roomId),m=!!(h?.sharedCadence||h?.sharedCadenceProgress),n=!!(i.mopEveryN||i.coverageEveryN),d=!!(l?.mopProgress||i.doMopNext||e.cadenceReasons?.includes("mop_progress_unverified")),v=!!(l?.coverageProgress||i.doCoverageNext||e.cadenceReasons?.includes("coverage_progress_unverified")),g=s.dirty||this.state.command!=="idle"||this.state.managedLock||this.state.activity!=="idle"&&this.state.activity!=="docked"||this.state.dataMode!=="live",_=f!==null&&f!==i.scope?i.scope==="shared"?this.#e("v4_cadence_shared_join_effect","Saving makes this schedule shared across participating plans and opted-in room cleans. It adopts existing shared progress when available; a new shared schedule starts at zero."):this.#e("v4_cadence_shared_leave_effect","Saving starts fresh private progress for this plan. The existing shared schedule remains unchanged for other participating plans."):f===null&&n?i.scope==="shared"?m?this.#e("v4_cadence_shared_join_effect","Saving makes this schedule shared across participating plans and opted-in room cleans. It adopts existing shared progress when available; a new shared schedule starts at zero."):this.#e("v4_cadence_new_shared_effect","Saving creates a shared schedule for participating plans and opted-in room cleans. Its progress starts at zero."):this.#e("v4_cadence_new_private_effect","Saving creates private progress for this plan only. It starts at zero when enabled."):this.#e("v4_cadence_existing_effect","Interval edits keep progress, and disabling pauses it. Mopping and coverage have separate progress and resets."),R=this.#e("v4_room_cadence_named","Room schedule for {room}",{room:t});return o`
      <details class="plan-option cadence-config">
        <summary>${R}</summary>
        <p class="subtle">${this.#e("v4_cadence_description","Only verified room cleans count toward these intervals. Due work stays due until it is verified.")}</p>
        <div class="cadence-fields">
          <label class="field ms-field">${this.#e("v4_cadence_scope","Schedule scope")}
            <select aria-label=${this.#e("v4_cadence_scope_named","Schedule scope for {room}",{room:t})} .value=${i.scope} @change=${b=>this.#s(a,{scope:$(b)})}>
              <option value="plan" ?selected=${i.scope==="plan"}>${this.#e("v4_cadence_this_plan","This plan (private)")}</option>
              <option value="shared" ?selected=${i.scope==="shared"}>${this.#e("v4_cadence_shared","Shared for this room")}</option>
            </select>
          </label>
          <label class="field ms-field">${this.#e("v4_cadence_mop_interval","Vacuum and mop every N cleans")}
            <input type="number" min="1" max="100" step="1" inputmode="numeric" aria-label=${this.#e("v4_cadence_mop_interval_named","Vacuum and mop interval for {room}, from 1 to 100",{room:t})} .value=${i.mopEveryN?.toString()||""} ?disabled=${e.cleaningMode!=="vacuum"} @change=${b=>this.#h(b,a,"mopEveryN")}>
          </label>
          <label class="field ms-field">${this.#e("v4_cadence_coverage_interval","Use periodic coverage every N cleans")}
            <input type="number" min="1" max="100" step="1" inputmode="numeric" aria-label=${this.#e("v4_cadence_coverage_interval_named","Periodic coverage interval for {room}, from 1 to 100",{room:t})} .value=${i.coverageEveryN?.toString()||""} @change=${b=>this.#h(b,a,"coverageEveryN")}>
          </label>
          ${i.coverageEveryN?o`
            <label class="field ms-field">${this.#e("v4_cadence_periodic_coverage","Periodic coverage setting")}
              <select aria-label=${this.#e("v4_cadence_periodic_coverage_named","Periodic coverage setting for {room}",{room:t})} .value=${i.periodicCoverageSetting||"standard"} @change=${b=>this.#s(a,{periodicCoverageSetting:$(b)})}>${P.map(b=>o`<option value=${b} ?selected=${b===i.periodicCoverageSetting}>${this.#a(b)}</option>`)}</select>
            </label>
          `:p}
        </div>
        <p class="subtle" role="status">${_}</p>
        ${e.cleaningMode!=="vacuum"?o`<p class="subtle">${this.#e("v4_cadence_mop_requires_vacuum","Set this room's normal cleaning system to vacuum to enable periodic mopping.")}</p>`:p}
        ${i.mopEveryN&&e.cleaningMode==="vacuum"?o`<p class="subtle">${this.#e("v4_cadence_clear_mop_to_change_normal","Clear the mopping interval before changing this room's normal cleaning system.")}</p>`:p}
        <div class="plan-options" role="group" aria-label=${this.#e("v4_cadence_next_actions_named","Next clean options for {room}",{room:t})}>
          <label class="plan-option"><input type="checkbox" aria-label=${this.#e("v4_cadence_do_mop_next_named","Do vacuum and mop on the next clean for {room}",{room:t})} .checked=${i.doMopNext} ?disabled=${!i.mopEveryN} @change=${b=>this.#s(a,{doMopNext:x(b)})}><span class="plan-option-copy"><strong>${this.#e("v4_cadence_do_mop_next","Do vacuum and mop on the next clean")}</strong></span></label>
          <label class="plan-option"><input type="checkbox" aria-label=${this.#e("v4_cadence_do_coverage_next_named","Use periodic coverage on the next clean for {room}",{room:t})} .checked=${i.doCoverageNext} ?disabled=${!i.coverageEveryN} @change=${b=>this.#s(a,{doCoverageNext:x(b)})}><span class="plan-option-copy"><strong>${this.#e("v4_cadence_do_coverage_next","Use periodic coverage on the next clean")}</strong></span></label>
        </div>
        ${i.coverageEveryN?o`<p class="subtle">${this.#e("v4_cadence_coverage_proof_pending","When periodic coverage is due, it remains due until Matic confirms this clean used the selected setting. It may be requested again on later cleans.")}</p>`:p}
        <p class="subtle" aria-live="polite">${this.#p(i,l,e.cadenceReasons)}</p>
        ${s.id&&(i.mopEveryN||i.coverageEveryN||d||v)?o`
          <div class="toolbar">
            ${i.mopEveryN||d?o`<button
              class="danger ms-btn ms-btn--secondary ms-btn--danger"
              type="button"
              aria-label=${this.#e("v4_reset_mop_cadence_button_named","Reset mopping progress for {room}",{room:t})}
              data-dialog-launcher="confirmResetCadence"
              ?disabled=${g}
              @click=${()=>this.#t({type:"request-room-cadence-reset",planId:s.id,roomId:e.roomId,mode:"mop"})}
            >${this.#e("v4_reset_mop_cadence_button","Reset mopping")}</button>`:p}
            ${i.coverageEveryN||v?o`<button
              class="danger ms-btn ms-btn--secondary ms-btn--danger"
              type="button"
              aria-label=${this.#e("v4_reset_coverage_cadence_button_named","Reset coverage progress for {room}",{room:t})}
              data-dialog-launcher="confirmResetCadence"
              ?disabled=${g}
              @click=${()=>this.#t({type:"request-room-cadence-reset",planId:s.id,roomId:e.roomId,mode:"coverage"})}
            >${this.#e("v4_reset_coverage_cadence_button","Reset coverage")}</button>`:p}
          </div>
          <p class="subtle">${this.#e("v4_reset_cadence_hint","Reset is available for a saved plan while the robot is idle. Cleaning history is kept separately.")}</p>
        `:p}
      </details>
    `}#k(e){this.#t({type:"toggle-room",roomId:e})}#l(e,a){let t=this.state.planDraft.rooms.map((s,i)=>i===e?{...s,...a}:s);this.#t({type:"patch-plan-draft",patch:{rooms:t}})}#v(e,a){let t=e+a,s=[...this.state.planDraft.rooms];if(t<0||t>=s.length)return;let[i]=s.splice(e,1);i&&(s.splice(t,0,i),this.#t({type:"patch-plan-draft",patch:{rooms:s}}))}#x(){let e=this.state.resources.plans;return this.#o(e.status,e.problem,o`
      <div class="stack">
        <button class="ms-btn ms-btn--primary" type="button" @click=${()=>this.#t({type:"select-plan",planId:null})}>
          ${E(U)}<span>${this.#e("v4_create_plan","Create a plan")}</span>
        </button>
        ${(e.value?.plans||[]).map(a=>o`
          <button class="ms-row ms-row--card" type="button" @click=${()=>this.#t({type:"select-plan",planId:a.id})}>
            <span class="ms-row__body"><strong>${a.name}</strong>
              <small>${this.#e("v4_plan_room_count","{count} rooms",{count:a.rooms.length})}${a.enabled?"":` \xB7 ${this.#e("v4_paused","paused")}`}</small>
            </span>
            <span class="ms-row__trail">${this.#e("v4_edit_plan","Edit plan")}</span>
          </button>
        `)}
      </div>
    `)}#R(){let e=this.state.resources.plans,a=e.value,t=this.state.planDraft,s=t.rooms.map(n=>({room:n,label:a?.rooms.find(d=>d.roomId===n.roomId)?.name||"Room",selected:!0})),i=(a?.rooms||[]).filter(n=>!t.rooms.some(d=>d.roomId===n.roomId)).map(n=>({room:{roomId:n.roomId,cleaningMode:"vacuum",coverageSetting:"standard"},label:n.name,selected:!1})),l=[...s,...i],c=t.rooms.length>=100,f=new Set(t.rooms.map(n=>`${n.cleaningMode}:${n.coverageSetting}`)).size>1,m=(t.id?a?.plans.find(n=>n.id===t.id):void 0)?.nextRunPreview;return this.#o(e.status,e.problem,o`
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
        ${f?o`
          <p class="subtle plan-transition-hint">${this.#e("v4_plan_mixed_settings","Rooms with different cleaning settings may need separate missions and dock visits.")}
            ${t.runBehavior==="ordered"?this.#e("v4_plan_group_settings","Placing rooms with matching settings together can reduce transitions."):this.#e("v4_plan_rotation_settings","Intelligent rotation determines the room order.")}
          </p>
        `:p}
        <div class="list" role="group" aria-labelledby="plan-rooms-heading">
          ${ee(l,({room:n})=>n.roomId,({room:n,label:d,selected:v})=>{let g=v?t.rooms.findIndex(_=>_.roomId===n.roomId):-1;return o`
              <div class="room plan-room ms-row ms-row--stack" data-selected=${String(v)}>
                <div class="room-choice">
                  <label class="plan-room-label">
                  <input type="checkbox" .checked=${v} ?disabled=${!v&&c} @change=${()=>this.#k(n.roomId)}>
                  <strong>${v?`${g+1}. `:""}${d}</strong>
                  </label>
                  ${v?o`
                    <span>
                      <button class="icon-button ms-btn ms-btn--icon" type="button" aria-label=${this.#e("move_room_up","Move {room} earlier",{room:d})} ?disabled=${g===0} @click=${_=>{_.preventDefault(),this.#v(g,-1)}}>${E(O)}</button>
                      <button class="icon-button ms-btn ms-btn--icon" type="button" aria-label=${this.#e("move_room_down","Move {room} later",{room:d})} ?disabled=${g===t.rooms.length-1} @click=${_=>{_.preventDefault(),this.#v(g,1)}}>${E(W)}</button>
                    </span>
                  `:p}
                </div>
                ${v?o`
                  <div class="split room-settings">
                    <label class="field ms-field">${this.#e("v4_cleaning_system","Cleaning system")}
                      <select aria-label=${this.#e("v4_room_cleaning_system_named","Cleaning system for {room}",{room:d})} .value=${n.cleaningMode} @change=${_=>this.#l(g,{cleaningMode:$(_)})}>${N.map(_=>o`<option value=${_} ?selected=${_===n.cleaningMode} ?disabled=${!!("cadence"in n&&n.cadence?.mopEveryN&&_!=="vacuum")}>${this.#i(_)}</option>`)}</select>
                    </label>
                    <label class="field ms-field">${this.#e("cleaning_mode","Cleaning mode")}
                      <select aria-label=${this.#e("v4_room_cleaning_mode_named","Cleaning mode for {room}",{room:d})} .value=${n.coverageSetting} @change=${_=>this.#l(g,{coverageSetting:$(_)})}>${P.map(_=>o`<option value=${_} ?selected=${_===n.coverageSetting}>${this.#a(_)}</option>`)}</select>
                    </label>
                  </div>
                  ${this.#w(n,g,d)}
                `:p}
              </div>
            `})}
        </div>
        ${c?o`<p class="subtle" role="status">${this.#e("v4_room_limit_reached","Up to {limit} rooms can be included. Remove one before adding another.",{limit:100})}</p>`:p}
        <section class="stack" aria-labelledby="next-run-preview-heading">
          <h3 class="group-heading" id="next-run-preview-heading">${this.#e("v4_next_run_preview","Next-run preview")}</h3>
          <p class="subtle">${this.#e("v4_next_run_preview_hint","Preview for the next run. An active run keeps its original settings; this preview is checked again before cleaning starts.")}</p>
          ${t.id?m?m.blocker?o`<p class="problem" role="alert">${this.#_(m.blocker)}</p>`:/^[0-9a-f]{64}$/u.test(m.previewToken??"")?o`
                  ${t.dirty?o`<p class="notice" role="status">${this.#e("v4_next_run_preview_stale","This preview shows the saved plan. Save your edits to calculate the updated order and settings before starting.")}</p>`:p}
                  <ol class="list" aria-label=${this.#e("v4_next_run_preview_order","Next-run room order and effective settings")}>
                    ${m.rooms.map((n,d)=>{let v=1+m.missionBoundaries.filter(g=>g<=d).length;return o`<li class="ms-row ms-row--stack">
                        <span class="subtle">${this.#e("v4_next_run_mission","Mission {number}",{number:v})}</span>
                        <strong>${d+1}. ${n.name}</strong>
                        <span>${this.#i(n.cleaningMode)} \u00b7 ${this.#a(n.coverageSetting)}</span>
                        ${n.cadenceReasons.length?o`<small>${n.cadenceReasons.map(g=>this.#d(g)).join(" \xB7 ")}</small>`:p}
                      </li>`})}
                  </ol>
                `:o`<p class="problem" role="status">${this.#e("v4_next_run_preview_unavailable","A verified next-run preview is unavailable. Refresh the saved plan before starting it.")}</p>`:o`<p class="problem" role="status">${this.#e("v4_next_run_preview_unavailable","A verified next-run preview is unavailable. Refresh the saved plan before starting it.")}</p>`:o`<p class="subtle">${this.#e("v4_next_run_preview_save_first","Save this plan to calculate its exact room order and effective settings.")}</p>`}
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
          ${t.finishCurrentRoom?o`
            <label class="plan-threshold ms-field">
              <span class="plan-threshold-copy">
                <strong>${this.#e("plan_threshold","Minimum room progress")}</strong>
                <small>${this.#e("plan_threshold_hint","When Stop is requested, the robot checks this progress: below it stops now; at or above it finishes this room before docking.")}</small>
              </span>
              <span class="threshold-value">${t.finishCurrentRoomThreshold}%</span>
              <input type="range" min="0" max="100" step="5" .value=${String(t.finishCurrentRoomThreshold)} aria-label=${this.#e("plan_threshold","Minimum room progress")} @input=${n=>this.#t({type:"patch-plan-draft",patch:{finishCurrentRoomThreshold:Number($(n))}})}>
            </label>
          `:p}
        </div>
        <div class="toolbar">
          ${t.id?o`
            <button
              class="danger ms-btn ms-btn--secondary ms-btn--danger"
              type="button"
              aria-label=${this.#e("plan_delete","Delete plan")}
              data-dialog-launcher="confirmDeletePlan"
              @click=${()=>this.#t({type:"open-dialog",dialog:"confirmDeletePlan"})}
            >${this.#e("plan_delete","Delete")}</button>
          `:p}
        </div>
        ${this.#r()}
      </div>
    `)}#E(){let e=this.state.resources.areas;return o`
      <div class="stack">
        <p class="subtle">${this.state.draw.tool==="outline"?this.#e("v4_zone_coverage","Place points around the zone. Shading shows cleaning coverage inside the perimeter; narrow edges may remain uncovered."):this.#e("v4_draw_floor_hint","Paint only on the mapped floor. Zoom and pan never change the saved outline.")}</p>
        ${this.state.draw.tool!=="outline"?o`<p class="subtle">${this.#e("v4_keyboard_draw_help","Keyboard: focus the map, use arrow keys to aim, then Enter to paint or erase at the crosshair. D selects Paint; E selects Erase.")}</p>`:p}
        ${this.#o(e.status,e.problem,o`
          <div class="group">
            <h3 class="group-heading" id="areas-heading">${this.#e("area_workspace_title","Saved custom areas")}</h3>
            <div class="list" role="group" aria-labelledby="areas-heading">
            <button class="list-button ms-row ms-row" type="button" @click=${()=>this.#t({type:"select-area",areaId:null})}>\uff0b ${this.#e("area_new","New outline")}</button>
            ${(e.value?.areas||[]).map(a=>o`
              <button class="list-button ms-row ms-row" type="button" @click=${()=>{this.#t({type:"select-area",areaId:a.id,workflow:"areaReview"})}}>
                <span>${a.name}</span>
                <small>${a.status==="current"?this.#e("area_workspace_ready","Ready"):this.#e("v4_review","Review")}</small>
              </button>
            `)}
            </div>
          </div>
        `)}
      </div>
    `}#C(){let e=this.state.areaDraft,a=e.canRebind||e.status==="review",t=!a&&(e.status==="stale"||e.status==="unknown");return o`
      <div class="stack">
        ${a?o`<div class="notice" data-tone="warning" role="status">${this.#e("area_review_required","Review the saved outline on this current map, then confirm it.")}</div>`:p}
        ${t?o`<div class="problem" role="alert">${this.#e("area_redraw_required","This outline no longer matches the current room map. Redraw it before saving.")}</div>`:p}
        <label class="field ms-field">${this.#e("area_name","Area name")}
          <input maxlength="128" autocomplete="off" .value=${e.name} @input=${s=>this.#t({type:"patch-area-draft",patch:{name:$(s)}})}>
        </label>
        <div class="split">
          <label class="field ms-field">${this.#e("v4_cleaning_system","Cleaning system")}
            <select .value=${e.cleaningMode} @change=${s=>this.#t({type:"patch-area-draft",patch:{cleaningMode:$(s)}})}>${N.map(s=>o`<option value=${s} ?selected=${s===e.cleaningMode}>${this.#i(s)}</option>`)}</select>
          </label>
          <label class="field ms-field">${this.#e("cleaning_mode","Cleaning mode")}
            <select .value=${e.coverageSetting} @change=${s=>this.#t({type:"patch-area-draft",patch:{coverageSetting:$(s)}})}>${P.map(s=>o`<option value=${s} ?selected=${s===e.coverageSetting}>${this.#a(s)}</option>`)}</select>
          </label>
        </div>
        <div class="toolbar">
          <button class="ms-btn ms-btn--secondary" type="button" @click=${()=>this.#t({type:"open-workflow",workflow:"draw"})}>${this.#e("v4_edit_outline","Edit outline")}</button>
          ${e.id?o`
            <button
              class="danger ms-btn ms-btn--secondary ms-btn--danger"
              type="button"
              aria-label=${this.#e("area_delete","Delete area")}
              data-dialog-launcher="confirmDeleteArea"
              @click=${()=>this.#t({type:"open-dialog",dialog:"confirmDeleteArea"})}
            >${this.#e("area_delete","Delete")}</button>
          `:p}
        </div>
        ${this.#r()}
      </div>
    `}#S(){let e=this.state.resources.history,a=e.value,t=a?.floors.find(h=>h.id===this.state.selection.floorId)||a?.floors.find(h=>h.active)||a?.floors[0],s=t?.snapshots||[],i=this.state.selection.historyId?Math.max(0,s.findIndex(h=>h.id===this.state.selection.historyId)):s.length,l=t?.active?this.#e("map_timeline_live_action","Live"):this.#e("v4_return_current_floor","Return to current floor"),c=this._historyPreviewPosition??i,f=s[c];return this.#o(e.status,e.problem,o`
      <div class="stack">
        ${(a?.floors.length||0)>1?o`
          <div class="group">
            <h3 class="group-heading" id="floors-heading">${this.#e("v4_mapped_floors","Mapped floors")}</h3>
            <div class="list" role="group" aria-labelledby="floors-heading">
            ${(a?.floors||[]).map((h,m)=>o`
              <button
                class="floor ms-row ms-row"
                type="button"
                aria-current=${String(h.id===t?.id)}
                @click=${()=>this.#t({type:"set-floor",floorId:h.id})}
              >
                <span>${h.label||(h.active?this.#e("v4_current_floor","Current floor"):this.#e("v4_saved_floor","Saved floor {number}",{number:h.ordinal??m}))}</span>
                <small>${h.active?this.#e("map_timeline_live_action","Live"):this.#e("v4_read_only","Read only")}</small>
              </button>
            `)}
            </div>
          </div>
        `:p}
        <div class="timeline">
          <label class="field ms-field">${this.#e("map_timeline_label","Map timeline")}
            <input
              type="range"
              min="0"
              max=${String(s.length)}
              step="1"
              .value=${String(c)}
              aria-valuetext=${f?this.#u(f.createdAt):l}
              ?disabled=${!s.length}
              @input=${h=>{this._historyPreviewPosition=Number($(h))}}
              @change=${h=>{let m=Number($(h));this._historyPreviewPosition=null,this.#t({type:"set-history",historyId:m===s.length?null:s[m]?.id||null})}}
            >
          </label>
          <div class="list">
            <button class="snapshot ms-row ms-row" type="button" aria-current=${String(!this.state.selection.historyId&&!!t?.active)} @click=${()=>this.#t({type:"set-history",historyId:null})}><span>${l}</span><small>${this.#e("v4_current","Current")}</small></button>
            ${s.map((h,m)=>o`
              <button class="snapshot ms-row ms-row" type="button" aria-current=${String(h.id===this.state.selection.historyId)} @click=${()=>this.#t({type:"set-history",historyId:h.id})}>
                <span>${this.#u(h.createdAt)}</span><small>${m+1} of ${s.length}</small>
              </button>
            `)}
          </div>
        </div>
        <p class="subtle">${this.#e("v4_history_privacy","Saved maps are floor-scoped and never show a live robot position.")}</p>
      </div>
    `)}#u(e){try{return new Intl.DateTimeFormat(this.state.locale,{dateStyle:"medium",timeStyle:"short"}).format(new Date(e))}catch{return this.#e("v4_saved_map","Saved map")}}#g(){this.#n||customElements.get("matic-map-diagnostics-v4")||(this._diagnosticsLoadFailed=!1,this.#n=import("./diagnostics-panel-M7DVMNYA.js").then(()=>{this.#n=null,this.requestUpdate()}).catch(()=>{this.#n=null,this._diagnosticsLoadFailed=!0}))}#P(){return customElements.get("matic-map-diagnostics-v4")?o`<matic-map-diagnostics-v4
        .state=${this.state}
        .localize=${this.localize}
        .disabled=${this.state.command!=="idle"&&this.state.command!=="failed"}
      ></matic-map-diagnostics-v4>`:this._diagnosticsLoadFailed?o`<div class="problem" role="alert">
        <p>${this.#e("v4_workflow_load_failed","Workspace tools could not be loaded.")}</p>
        <button class="ms-btn ms-btn--secondary" type="button" @click=${this.#g}>
          ${this.#e("v4_retry","Try again")}
        </button>
      </div>`:(this.#g(),o`<p class="loading" role="status" aria-live="polite">${this.#e("v4_workflow_loading","Loading workspace tools\u2026")}</p>`)}render(){return o`<fieldset class="workflow-fields" ?disabled=${this.state.command!=="idle"&&this.state.command!=="failed"}>${this.#I()}</fieldset>`}#I(){switch(this.state.workflow){case"rooms":return this.#f();case"plans":return this.#x();case"plan":return this.#R();case"draw":return this.#E();case"areaReview":return this.#C();case"history":return this.#S();case"support":return this.#P();case"none":return p}}};customElements.get(I)||customElements.define(I,M);export{M as MaticMapWorkflowV4};
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
