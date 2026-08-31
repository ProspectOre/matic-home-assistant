import{A as $e,B as me,a as Ht,b as Ft,c as Bt,d as Wt,e as Kt,f as Y,g as qt,h as Vt,i as N,j as jt,k as Z,l as Re,m as Xt,n as Gt,o as D,p as Ie,q as Le,r as Te,s as Yt,t as Zt,u as Jt,v as J,w as y,x,y as B,z as H}from"./chunks/chunk.js";var ze="a".repeat(64),W=[{roomId:"room-a",name:"Kitchen",boundary:[[.5,.5],[4,.5],[4,3],[.5,3]]},{roomId:"room-b",name:"Living room",boundary:[[4.2,.5],[8.5,.5],[8.5,3.4],[4.2,3.4]]},{roomId:"room-c",name:"Office",boundary:[[.5,3.2],[3.8,3.2],[3.8,6.5],[.5,6.5]]},{roomId:"room-d",name:"Bedroom",boundary:[[4,3.6],[8.5,3.6],[8.5,6.5],[4,6.5]]}],Oe=()=>{let n=[180,140],t={meters_per_cell:.05,origin_cells:[0,0],span_cells:n,sample_step:1,rooms:W.map(l=>{let c=l.boundary.map(([h,f])=>[h/.05,f/.05]),u=[c.reduce((h,[f])=>h+f,0)/c.length,c.reduce((h,[,f])=>h+f,0)/c.length];return{name:l.name,boundary:c,boundary_closed:!0,center:u}})},e=new TextEncoder().encode(JSON.stringify(t)),r=[];for(let l=10;l<130;l+=2)for(let c=10;c<170;c+=2){let u=c<80?l<65?0:2:l<72?1:3,h=[[185,219,224],[201,211,233],[210,226,194],[232,207,207]][u]||[190,205,215];r.push([c,l,0,...h])}let o=500;for(let l=0;l<o;l+=1){let c=l%4,u=l*7%120,h=c<2?c===0?10:168:10+u,f=c>=2?c===2?10:128:10+u;r.push([h,f,10+l%18,104,122,137])}let a=r.length-o,i=new ArrayBuffer(24+e.byteLength+r.length*8),s=new DataView(i);new Uint8Array(i,0,8).set(new TextEncoder().encode("MATIC3D\0")),s.setUint16(8,1,!0),s.setUint16(10,8,!0),s.setUint32(12,e.byteLength,!0),s.setUint32(16,a,!0),s.setUint32(20,o,!0),new Uint8Array(i,24,e.byteLength).set(e);let d=new DataView(i,24+e.byteLength);return r.forEach(([l=0,c=0,u=0,h=0,f=0,k=0],P)=>{let b=P*8;d.setUint16(b,l,!0),d.setUint16(b+2,c,!0),d.setUint8(b+4,u),d.setUint8(b+5,h),d.setUint8(b+6,f),d.setUint8(b+7,k)}),{buffer:i,pointOffset:24+e.byteLength,floorCount:a,surfaceCount:o,total:r.length,revision:7,etag:'"synthetic-scene"',source:"live",metadata:{metersPerCell:.05,origin:[0,0],span:n,sampleStep:1,rooms:t.rooms.map((l,c)=>({id:W[c]?.roomId||`room-${c}`,name:l.name,boundary:l.boundary,center:l.center}))}}},Q=()=>({entryId:"synthetic-entry",sceneUrl:"/api/matic_robot/slam_scene/synthetic",deltaUrl:"/api/matic_robot/slam_delta/synthetic",poseUrl:"/api/matic_robot/slam_pose/synthetic",historyUrl:"/api/matic_robot/slam_history/synthetic",areasUrl:"/api/matic_robot/areas/synthetic",plansUrl:"/api/matic_robot/plans/synthetic",mapRevision:7,mapFloorCoherent:!0,mapSessionVerified:!0,mapSessionKey:ze,mapBlockReason:null,runnerLocked:!1,stopSettlePending:!1,activePlan:!1,nativeReconciliationPending:!1,nativeSessionActive:!1,mapComplete:!0,mapTruncated:!1,selectedFloorOrdinal:1,mapFloorOrdinal:1,historyCount:2,historyFloorCount:2,health:"ready",streamFailures:0,bootstrapState:"complete",bootstrapPhotoSeen:!0,bootstrapStructureSeen:!0,bootstrapFailures:0}),fe=()=>({rooms:W.map(({roomId:n,name:t})=>({roomId:n,name:t})),selectedPlan:"daily",plans:[{id:"daily",name:"Daily clean",enabled:!0,runBehavior:"intelligent",rooms:W.slice(0,3).map(({roomId:n})=>({roomId:n,cleaningMode:"vacuum",coverageSetting:"standard"})),roomOrder:W.slice(0,3).map(({roomId:n})=>n),returnToBase:!0,finishCurrentRoom:!1,finishCurrentRoomThreshold:50}]}),ye=()=>({sceneUrl:Q().sceneUrl,rooms:W.map(n=>({...n,boundary:n.boundary.map(t=>[...t])})),areas:[{id:"entryway",name:"Entryway",circles:[{x:1.5,y:1.4,radius:.3},{x:1.9,y:1.6,radius:.3}],cleaningMode:"vacuum",coverageSetting:"standard",status:"current",canRebind:!1}]}),Ne=()=>({entryId:"synthetic-entry",liveAvailable:!0,floors:[{id:"current",active:!0,readOnly:!1,liveAvailable:!0,label:"House",ordinal:null,snapshots:[{id:"current-old",createdAt:"2026-08-29T14:00:00Z",revision:6,pointCount:5300,sceneUrl:"/synthetic-history-current-old"},{id:"current-new",createdAt:"2026-08-29T16:12:00Z",revision:7,pointCount:5300,sceneUrl:"/synthetic-history-current-new"}]},{id:"saved-1",active:!1,readOnly:!0,liveAvailable:!1,label:"Shed",ordinal:2,snapshots:[{id:"saved-one",createdAt:"2026-08-28T11:30:00Z",revision:3,pointCount:3100,sceneUrl:"/synthetic-history-saved"}]}]}),Ue=()=>({position:[92,74],source:"latest_pose",revision:7,poseRevision:4,floorCoherent:!0,mapSessionKey:ze,freshness:"live"});var ht=()=>({...N(),coherence:"current",activity:"docked",batteryPercent:92,robots:[{entryId:"synthetic-entry",label:"Matic robot"}],host:{connected:!0,administrator:!0,robotConnected:!0,robotCount:1},floor:{classifiedCount:2,displayName:"House",readOnly:!1},map:{available:!0,complete:!0,floorCoherent:!0,sessionVerified:!0,exactPose:!0},resources:{catalog:{status:"ready",value:[Q()],problem:null},entry:Q(),scene:{status:"ready",value:Oe(),problem:null},pose:{status:"ready",value:Ue(),problem:null},history:{status:"ready",value:Ne(),problem:null},plans:{status:"ready",value:fe(),problem:null},areas:{status:"ready",value:ye(),problem:null}},selection:{...N().selection,entryId:"synthetic-entry",planId:"daily"},planDraft:{...N().planDraft,id:"daily",name:"Daily clean",rooms:fe().plans[0]?.rooms||[]}}),ve=n=>{let t=ht();switch(n){case"ready":return t;case"cleaning":return{...t,activity:"cleaning"};case"paused":return{...t,activity:"paused"};case"returning":return{...t,activity:"returning"};case"rooms":return{...t,workflow:"rooms"};case"draw":return{...t,workflow:"draw",areaDraft:{...t.areaDraft,id:"entryway",name:"Entryway",status:"current"},selection:{...t.selection,areaId:"entryway"},draw:{...t.draw,dirty:!0,strokeCount:3,circles:ye().areas[0]?.circles||[]}};case"history":return{...t,dataMode:"history",workflow:"history",floor:{...t.floor,readOnly:!0},map:{...t.map,exactPose:!1},selection:{...t.selection,floorId:"saved-1",historyId:"saved-one"}};case"transition":return{...t,coherence:"verifying",activity:"unknown",map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1}};case"problem":return{...t,activity:"problem",coherence:"blocked"};case"ha-offline":return{...t,coherence:"degraded",host:{...t.host,connected:!1},map:{...t.map,exactPose:!1}};case"robot-offline":return{...t,coherence:"degraded",host:{...t.host,robotConnected:!1},map:{...t.map,exactPose:!1}};case"access":return{...t,coherence:"blocked",host:{...t.host,administrator:!1},map:{...t.map,available:!1,exactPose:!1}};case"empty":return{...t,coherence:"unavailable",host:{...t.host,robotConnected:!1,robotCount:0},map:{...t.map,available:!1,exactPose:!1}};case"unsupported":return{...t,coherence:"blocked",map:{...t.map,available:!1,exactPose:!1}};case"multi-robot":return{...t,host:{...t.host,robotCount:2},robots:[{entryId:"synthetic-entry",label:"Matic robot"},{entryId:"synthetic-entry-two",label:"Second robot"}]}}},be=["ready","cleaning","paused","returning","rooms","draw","history","transition","problem","ha-offline","robot-offline","access","empty","unsupported","multi-robot"];var mt=n=>{switch(n){case"cleaning":return"cleaning";case"paused":return"paused";case"returning":return"returning";case"docked":return"docked";case"idle":return"idle";case"error":return"problem";default:return"unknown"}},ft=n=>typeof n!="number"||!Number.isFinite(n)?null:Math.round(Math.max(0,Math.min(100,n))),yt=n=>{let t=n.attributes?.matic_entry_id;return typeof t=="string"&&t.length>0?t:null},vt=n=>String(n||"local-user").replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",De=n=>{if(typeof n!="string")return"Matic robot";let t=n.trim();return t&&Array.from(t).length<=128&&!/[\u0000-\u001f\u007f]/u.test(t)?t:"Matic robot"},ee=class{#e="";#t=null;project(t,e,r=null){let o=t?.states??{},a=e?.config?.entry_id,i=typeof a=="string"?a:null,s=new Set,d=null,l=null,c=null,u=new Map;for(let[w,_]of Object.entries(o)){let O=yt(_);if(!O||(s.add(O),!w.startsWith("vacuum.")))continue;u.set(O,{entryId:O,label:De(_.attributes?.friendly_name)});let X=r||i;(!d||X&&O===X)&&(d=_,l=w,c=O)}let h={connected:t?.connected!==!1,administrator:t?.user?.is_admin===!0,robotConnected:d!==null&&d.state!=="unavailable"&&d.state!=="unknown",robotCount:s.size},f=d?mt(d.state):"unknown",k=ft(d?.attributes?.battery_level),P=t?.selectedLanguage||t?.language||"en",b=vt(t?.user?.id),S=De(d?.attributes?.friendly_name),T=[...u.values()].sort((w,_)=>w.label.localeCompare(_.label,P,{sensitivity:"base"})),A=[h.connected,h.administrator,h.robotConnected,h.robotCount,f,k??"none",P,b,l??"none",c??"none",S,T.map(w=>`${w.entryId}:${w.label}`).join(",")].join("|");return A===this.#e&&this.#t?this.#t:(this.#e=A,this.#t={host:h,activity:f,batteryPercent:k,language:P,userKey:b,vacuumEntityId:l,entryKey:c,robotLabel:S,robots:T},this.#t)}};var bt=(n,t)=>{let e=(o,a,i)=>H(t,o,a,i);if(!n.host.connected)return{title:e("v4_reconnecting","Reconnecting"),detail:e("v4_ha_offline","Home Assistant is offline")};if(!n.host.administrator)return{title:e("v4_access_required","Access required"),detail:e("v4_admin_only","Administrator only")};if(n.host.robotCount===0)return{title:e("v4_no_robot_short","No robot"),detail:e("v4_set_up_robot","Set up a Matic robot")};if(!n.host.robotConnected)return{title:e("v4_robot_offline","Robot offline"),detail:e("v4_last_map_read_only","Last verified map \xB7 read only")};if(n.activity==="problem")return{title:e("v4_needs_attention","Needs attention"),detail:e("v4_check_robot","Check the robot")};if(n.dataMode==="history"){let o=n.resources.history.value?.floors.find(s=>s.id===n.selection.floorId),a=o?.snapshots.findIndex(s=>s.id===n.selection.historyId)??-1,i=o?.snapshots.length??0;return{title:e("v4_saved_map","Saved map"),detail:a>=0?e("v4_read_only_position","Read only \xB7 {position} of {count}",{position:a+1,count:i}):e("v4_read_only","Read only")}}if(n.coherence==="verifying"||n.coherence==="booting")return{title:e("v4_locating","Locating"),detail:e("v4_finding_map","Finding the current map")};if(n.activity==="cleaning")return{title:e("v4_cleaning","Cleaning"),detail:e("v4_cleaning_progress","Cleaning in progress")};if(n.activity==="paused")return{title:e("v4_paused","Paused"),detail:e("v4_can_resume","Cleaning can resume")};if(n.activity==="returning")return{title:e("v4_returning","Returning"),detail:e("v4_going_dock","Going to the dock")};if(n.activity==="stopping")return{title:e("v4_stopping","Stopping"),detail:e("v4_waiting_robot","Waiting for the robot")};let r=n.batteryPercent===null?e("v4_ready","Ready"):e("v4_battery","{percent}% battery",{percent:n.batteryPercent});return{title:n.activity==="docked"?e("v4_docked","Docked"):e("v4_ready","Ready"),detail:r}},gt=(n,t)=>{let e=(r,o)=>H(t,r,o);switch(n.workflow){case"rooms":return{title:e("v4_choose_rooms","Choose rooms"),description:e("v4_choose_rooms_detail","Select on the map or from the list.")};case"draw":return{title:e("v4_draw_area","Draw an area"),description:e("v4_draw_area_detail","Paint on the verified map, then review the details.")};case"plan":return{title:e("v4_plan","Plan"),description:e("v4_plan_detail","Review rooms and cleaning settings.")};case"areaReview":return{title:e("area_details","Area details"),description:e("area_details_hint","Name the area and choose cleaning settings.")};case"history":return{title:e("v4_map_history","Map history"),description:e("v4_map_history_detail","Saved maps are floor-scoped and read only.")};case"support":return{title:e("v4_map_support","Map support"),description:e("v4_map_support_detail","Private geometry is never included.")};case"none":return{title:e("v4_clean","Clean"),description:e("v4_clean_detail","Start with a saved plan, rooms, or an area.")}}},wt=(n,t)=>{let e=(r,o)=>H(t,r,o);switch(n){case"discardDraft":return{title:e("v4_discard_area","Discard this area?"),detail:e("v4_discard_area_detail","The outline has not been saved. You can keep drawing or discard it."),cancelLabel:e("v4_keep_drawing","Keep drawing"),confirmLabel:e("v4_discard","Discard"),action:"discard"};case"confirmDeletePlan":return{title:e("v4_delete_plan","Delete this plan?"),detail:e("v4_delete_plan_detail","This removes the saved plan from Home Assistant. The robot will not move."),cancelLabel:e("v4_cancel","Cancel"),confirmLabel:e("plan_delete","Delete plan"),action:"delete-plan"};case"confirmDeleteArea":return{title:e("v4_delete_area","Delete this area?"),detail:e("v4_delete_area_detail","This removes the saved outline from Home Assistant. The robot will not move."),cancelLabel:e("v4_cancel","Cancel"),confirmLabel:e("area_delete","Delete area"),action:"delete-area"};case"confirmStop":return{title:e("v4_stop_cleaning","Stop cleaning?"),detail:e("v4_stop_cleaning_detail","The robot may take a moment to settle before another action is available."),cancelLabel:e("v4_keep_cleaning","Keep cleaning"),confirmLabel:e("v4_stop","Stop"),action:"stop"};case"error":return{title:e("v4_error","Something went wrong"),detail:e("v4_error_detail","No action was started. Close this message and try again when the map is ready."),cancelLabel:e("v4_close","Close"),confirmLabel:e("v4_close","Close"),action:null};case null:return null}},_t=(n=document)=>{let t=n.activeElement;for(;t?.shadowRoot?.activeElement;)t=t.shadowRoot.activeElement;return t},ge=class extends B{constructor(){super(...arguments);this.state=N();this._measuredNarrow=!1;this._sheetOffset=0;this._workflowReady=!1;this._overflowOpen=!1;this._browserFullscreen=!1;this._sheetDetent="peek";this.#t=null;this.#r=null;this.#n=null;this.#s=null;this.#o=null;this.#i=null;this.#h=()=>{this._browserFullscreen=document.fullscreenElement===this.renderRoot.querySelector(".app")};this.#m=e=>{if(!this._overflowOpen)return;let r=this.renderRoot.querySelector(".overflow-wrap");(!r||!e.composedPath().includes(r))&&(this._overflowOpen=!1)}}static{this.properties={state:{attribute:!1},localize:{attribute:!1},_measuredNarrow:{state:!0},_sheetOffset:{state:!0},_workflowReady:{state:!0},_overflowOpen:{state:!0},_browserFullscreen:{state:!0},_sheetDetent:{state:!0}}}static{this.styles=J`
    :host {
      display: block;
      min-inline-size: 0;
      min-block-size: 0;
      block-size: 100%;
      color: var(--primary-text-color, #1f2933);
      background: var(--primary-background-color, #f5f7f8);
      container-type: size;
    }

    * { box-sizing: border-box; }
    button { font: inherit; }

    .root { min-block-size: 0; block-size: 100%; }

    .app {
      display: grid;
      grid-template-rows: 3.5rem minmax(0, 1fr);
      min-block-size: 36rem;
      block-size: 100%;
      background: var(--primary-background-color, #f5f7f8);
    }

    .app-bar {
      position: relative;
      z-index: 12;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      min-inline-size: 0;
      padding-inline: max(0.75rem, env(safe-area-inset-left)) max(0.75rem, env(safe-area-inset-right));
      border-block-end: 1px solid var(--divider-color, rgb(60 75 85 / 14%));
      background: var(--app-header-background-color, var(--card-background-color, #fff));
      box-shadow: 0 1px 5px rgb(31 41 51 / 8%);
    }

    .nav, .overflow, .robot-switcher {
      min-inline-size: 2.75rem;
      min-block-size: 2.75rem;
      border: 0;
      border-radius: 0.7rem;
      color: inherit;
      background: transparent;
      cursor: pointer;
    }

    select.robot-switcher {
      max-inline-size: 11rem;
      padding-inline: 0.55rem;
      border: 1px solid var(--divider-color, rgb(60 75 85 / 16%));
      background: var(--card-background-color, #fff);
      text-overflow: ellipsis;
    }

    .title {
      overflow: hidden;
      min-inline-size: 0;
      margin: 0;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 1rem;
      font-weight: 730;
      letter-spacing: -0.015em;
    }

    .spacer { flex: 1; }

    .overflow-wrap { position: relative; }
    .overflow-menu {
      position: absolute;
      z-index: 18;
      inset-block-start: calc(100% + 0.35rem);
      inset-inline-end: 0;
      display: grid;
      gap: 0.2rem;
      min-inline-size: 13rem;
      padding: 0.35rem;
      border: 1px solid var(--divider-color, rgb(60 75 85 / 16%));
      border-radius: 0.75rem;
      background: var(--card-background-color, #fff);
      box-shadow: 0 12px 32px rgb(31 41 51 / 20%);
    }
    .overflow-menu button {
      min-block-size: 2.75rem;
      padding-inline: 0.75rem;
      border: 0;
      border-radius: 0.55rem;
      color: inherit;
      background: transparent;
      text-align: start;
      cursor: pointer;
    }
    .overflow-menu button:hover { background: var(--secondary-background-color, #f3f6f7); }
    .overflow-field {
      display: grid;
      gap: 0.25rem;
      padding: 0.45rem 0.75rem;
      color: var(--secondary-text-color, #60717c);
      font-size: 0.72rem;
      font-weight: 650;
    }
    .overflow-field select {
      min-block-size: 2.5rem;
      padding-inline: 0.55rem;
      border: 1px solid var(--divider-color, rgb(60 75 85 / 18%));
      border-radius: 0.55rem;
      color: var(--primary-text-color, #1f2933);
      background: var(--card-background-color, #fff);
      font: inherit;
    }

    .header-state {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      min-inline-size: 0;
      color: var(--secondary-text-color, #60717c);
      font-size: 0.78rem;
      font-weight: 650;
      white-space: nowrap;
    }

    .header-state::before {
      content: "";
      inline-size: 0.48rem;
      block-size: 0.48rem;
      border-radius: 50%;
      background: var(--success-color, #2f9e61);
    }

    .workspace {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(19rem, 22.5rem);
      min-inline-size: 0;
      min-block-size: 0;
    }

    .workspace.full-map { grid-template-columns: minmax(0, 1fr); }
    .workspace.full-map .inspector,
    .workspace.full-map .mobile-sheet { display: none; }

    .canvas { min-inline-size: 0; min-block-size: 0; }
    matic-map-canvas-v4 { block-size: 100%; }

    .inspector {
      display: flex;
      flex-direction: column;
      min-inline-size: 0;
      min-block-size: 0;
      border-inline-start: 1px solid var(--divider-color, rgb(60 75 85 / 14%));
      background: var(--card-background-color, #fff);
    }

    .status-strip {
      display: grid;
      grid-template-columns: 2.35rem minmax(0, 1fr);
      gap: 0.7rem;
      align-items: center;
      padding: 0.85rem 1rem;
      border-block-end: 1px solid var(--divider-color, rgb(60 75 85 / 12%));
    }

    .status-icon {
      display: grid;
      place-items: center;
      inline-size: 2.35rem;
      block-size: 2.35rem;
      border-radius: 50%;
      color: var(--primary-color, #0678ce);
      background: color-mix(in srgb, var(--primary-color, #0678ce) 11%, transparent);
    }

    .status-strip strong, .status-strip small { display: block; }
    .status-strip strong { font-size: 0.82rem; }
    .status-strip small { margin-block-start: 0.12rem; color: var(--secondary-text-color, #687984); font-size: 0.72rem; }

    .workflow {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-block-size: 0;
      padding: 1.15rem;
      overflow: auto;
    }

    .workflow h2 { margin: 0; font-size: 1.15rem; letter-spacing: -0.02em; }
    .workflow > p { margin: 0.35rem 0 1rem; color: var(--secondary-text-color, #687984); font-size: 0.8rem; line-height: 1.48; }

    .quick-actions { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.55rem; }
    .quick-actions button, .room-row {
      min-block-size: 3.25rem;
      border: 1px solid var(--divider-color, rgb(60 75 85 / 17%));
      border-radius: 0.75rem;
      color: inherit;
      background: var(--secondary-background-color, #f4f7f8);
    }

    .quick-actions button { cursor: pointer; font-size: 0.8rem; font-weight: 650; }
    .room-list { display: grid; gap: 0.5rem; }
    .room-row { display: flex; align-items: center; gap: 0.65rem; padding-inline: 0.8rem; font-size: 0.8rem; }
    .check { color: var(--primary-color, #0678ce); font-weight: 800; }

    .primary-stack { display: grid; gap: 0.5rem; margin-block-start: auto; padding-block-start: 1rem; }
    .primary-action, .secondary-action {
      min-block-size: 2.75rem;
      border: 0;
      border-radius: 0.72rem;
      cursor: pointer;
      font-weight: 720;
    }

    .primary-action {
      color: white;
      background: var(--primary-color, #0678ce);
      box-shadow: 0 6px 16px rgb(6 120 206 / 20%);
    }

    .primary-action.danger { background: var(--error-color, #c43b3b); }
    .primary-action:disabled { cursor: default; opacity: 0.48; box-shadow: none; }
    .secondary-action { color: var(--error-color, #b73535); background: transparent; border: 1px solid currentColor; }

    .precision-docked { margin-block-end: 1rem; }

    .precision-popover {
      position: absolute;
      z-index: 9;
      inset-block-start: 4.2rem;
      inset-inline-end: 0.75rem;
      display: flex;
      gap: 0.4rem;
    }

    .precision-chip {
      min-block-size: 2.75rem;
      padding-inline: 0.8rem;
      border: 1px solid var(--divider-color, rgb(60 75 85 / 17%));
      border-radius: 1.4rem;
      color: inherit;
      background: var(--card-background-color, #fff);
      box-shadow: 0 5px 18px rgb(31 41 51 / 12%);
      cursor: pointer;
      font-size: 0.76rem;
      font-weight: 700;
    }

    .full-map-hud {
      position: absolute;
      z-index: 9;
      inset-inline-end: 0.75rem;
      inset-block-end: max(0.75rem, env(safe-area-inset-bottom));
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 0.75rem;
      align-items: center;
      inline-size: min(24rem, calc(100% - 1.5rem));
      padding: 0.7rem;
      border: 1px solid var(--divider-color, rgb(60 75 85 / 16%));
      border-radius: 0.9rem;
      background: var(--card-background-color, rgb(255 255 255 / 96%));
      box-shadow: 0 10px 28px rgb(31 41 51 / 18%);
    }

    .full-map-hud.has-secondary {
      grid-template-columns: minmax(0, 1fr) auto auto;
    }

    .hud-copy { min-inline-size: 0; }
    .hud-copy strong, .hud-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hud-copy strong { font-size: 0.8rem; }
    .hud-copy small { color: var(--secondary-text-color, #687984); font-size: 0.7rem; }
    .full-map-hud .primary-action { min-inline-size: 6rem; padding-inline: 0.8rem; }
    .full-map-hud .secondary-action { min-inline-size: 4.5rem; padding-inline: 0.65rem; }

    .mobile-sheet { display: none; }

    .dialog-backdrop {
      position: fixed;
      z-index: 30;
      inset: 0;
      display: grid;
      place-items: center;
      padding: 1rem;
      background: rgb(0 0 0 / 38%);
    }

    .dialog {
      inline-size: min(24rem, 100%);
      padding: 1.2rem;
      border-radius: 0.9rem;
      color: var(--primary-text-color, #1f2933);
      background: var(--card-background-color, #fff);
      box-shadow: 0 20px 50px rgb(0 0 0 / 25%);
    }

    .dialog h2 { margin: 0; font-size: 1.08rem; }
    .dialog p { color: var(--secondary-text-color, #687984); font-size: 0.82rem; line-height: 1.5; }
    .dialog-actions { display: flex; justify-content: flex-end; gap: 0.5rem; }
    .dialog-actions button { min-block-size: 2.75rem; padding-inline: 1rem; border: 0; border-radius: 0.65rem; cursor: pointer; }
    .dialog-actions .discard { color: white; background: var(--error-color, #c43b3b); }

    .narrow .app { grid-template-rows: 3.35rem minmax(0, 1fr); min-block-size: 28rem; }
    .narrow .workspace { grid-template-columns: minmax(0, 1fr); }
    .narrow .inspector { display: none; }
    .narrow .mobile-sheet {
      position: absolute;
      z-index: 7;
      inset-inline: 0;
      inset-block-end: 0;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      block-size: min(52%, 30rem);
      padding: 0.6rem max(0.75rem, env(safe-area-inset-right)) max(0.75rem, env(safe-area-inset-bottom)) max(0.75rem, env(safe-area-inset-left));
      border-start-start-radius: 1rem;
      border-start-end-radius: 1rem;
      background: var(--card-background-color, #fff);
      box-shadow: 0 -8px 26px rgb(31 41 51 / 14%);
      overflow: hidden;
      transition: block-size 180ms ease-out;
    }

    .narrow .mobile-sheet[data-detent="peek"] { block-size: 10.5rem; }
    .narrow .mobile-sheet[data-detent="full"] { block-size: calc(100% - 0.5rem); }
    .narrow .sheet-toggle {
      display: grid;
      min-block-size: 2.75rem;
      padding: 0 0 0.45rem;
      border: 0;
      color: inherit;
      background: transparent;
      text-align: start;
      cursor: pointer;
    }
    .narrow .sheet-handle { inline-size: 2.5rem; block-size: 0.25rem; margin: 0 auto 0.55rem; border-radius: 1rem; background: var(--divider-color, #bcc6cc); }
    .narrow .sheet-title { font-size: 1rem; font-weight: 730; }
    .narrow .sheet-description { margin-block-start: 0.2rem; color: var(--secondary-text-color, #687984); font-size: 0.75rem; }
    .narrow .sheet-body { min-block-size: 0; padding-block: 0.25rem; overflow: auto; }
    .narrow .mobile-sheet[data-detent="peek"] .sheet-body { display: none; }
    .narrow .mobile-sheet .primary-stack { margin-block-start: 0; padding-block-start: 0.55rem; }
    .narrow .header-state { display: none; }
    .narrow .title { font-size: 0.95rem; }
    .narrow .robot-switcher { max-inline-size: 6rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .narrow .full-map-hud { inset-block-end: max(0.75rem, env(safe-area-inset-bottom)); }
    .narrow .workspace.full-map .mobile-sheet { display: none; }

    @media (forced-colors: active) {
      .primary-action, .secondary-action, .dialog, .full-map-hud { border: 1px solid CanvasText; }
    }

    @media (prefers-reduced-motion: reduce) {
      .narrow .mobile-sheet { transition: none; }
    }
  `}#e(e,r,o){return H(this.localize,e,r,o)}#t;#r;#n;#s;#o;#i;#h;#m;connectedCallback(){super.connectedCallback(),this.#t=new ResizeObserver(([e])=>{if(!e)return;let r=e.contentRect.width<768||e.contentRect.height<480;r!==this._measuredNarrow&&(this._measuredNarrow=r)}),this.#t.observe(this),window.addEventListener("pointerdown",this.#m,!0),document.addEventListener("fullscreenchange",this.#h),this.#r=new ResizeObserver(([e])=>{if(!e)return;let r=Math.ceil(e.target.getBoundingClientRect().height);r!==this._sheetOffset&&(this._sheetOffset=r)})}disconnectedCallback(){this.#t?.disconnect(),this.#t=null,this.#r?.disconnect(),this.#r=null,this.#n=null,window.removeEventListener("pointerdown",this.#m,!0),document.removeEventListener("fullscreenchange",this.#h),super.disconnectedCallback()}updated(e){let r=this.renderRoot.querySelector(".mobile-sheet");if(r!==this.#n&&(this.#r?.disconnect(),this.#n=r,r&&this.#r?.observe(r)),e.has("state")){let o=e.get("state");o?.precisionOpen&&!this.state.precisionOpen&&this.#s?.focus(),!o?.dialog&&this.state.dialog?(this.#o=_t(this.shadowRoot||document),this.updateComplete.then(()=>{this.renderRoot.querySelector(".dialog button")?.focus()})):o?.dialog&&!this.state.dialog&&(this.#o?.focus(),this.#o=null),this.state.workflow!=="none"&&!this._workflowReady&&import("./chunks/workflow-panel.js").then(()=>{this._workflowReady=!0}),(!o||o.workflow!==this.state.workflow)&&(this._sheetDetent=this.state.workflow==="none"?"peek":"half")}}#a(e){this.dispatchEvent(new CustomEvent($e,{detail:e,bubbles:!0,composed:!0}))}#v(e){if(e.enabled){if(e.id==="return-live"){this.#a({type:"set-history",historyId:null});return}this.#f(e.id)}}#c(e){if(this.state.workflow==="draw"&&this.state.draw.dirty&&e!=="draw"&&e!=="areaReview"){this.#i=e,this.#a({type:"open-dialog",dialog:"discardDraft"});return}this.#a({type:"open-workflow",workflow:e})}#b(){let e=this.#i;this.#i=null,this.#a({type:"discard-draft"}),e&&queueMicrotask(()=>this.#a({type:"open-workflow",workflow:e}))}#d(){this.#i=null,this.#a({type:"dismiss-top-layer"})}#f(e){this.dispatchEvent(new CustomEvent(me,{detail:{id:e},bubbles:!0,composed:!0}))}#x(e){this.#a({type:"dismiss-top-layer"}),this.#f(e)}#u(e){if(e.action==="discard"){this.#b();return}if(e.action==="delete-plan"||e.action==="delete-area"){this.#x(e.action);return}this.#a({type:"dismiss-top-layer"}),e.action==="stop"&&this.#f("stop")}#C(){this._sheetDetent=this._sheetDetent==="peek"?"half":this._sheetDetent==="half"?"full":"peek"}#A(){if(this.state.precisionOpen||this.state.fullMap){this.#a({type:"dismiss-top-layer"});return}if(this.state.workflow!=="none"){this.#c("none");return}this.#w()}#w(){this.dispatchEvent(new CustomEvent("hass-toggle-menu",{bubbles:!0,composed:!0}))}#l(e){if(this._overflowOpen=!1,e==="support"){this.#c("support");return}if(e==="fullscreen"){let r=this.renderRoot.querySelector(".app");document.fullscreenElement?document.exitFullscreen():r?.requestFullscreen();return}this.dispatchEvent(new CustomEvent(me,{detail:{id:"use-classic"},bubbles:!0,composed:!0}))}#p(e){this.#s=e.currentTarget,this.#a({type:"set-precision-open",value:!this.state.precisionOpen})}#g(e){if(!(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey)&&e.key==="Escape"){if(e.preventDefault(),this._overflowOpen){this._overflowOpen=!1;return}this.#a({type:"dismiss-top-layer"})}}#k(e){if(e.key!=="Tab")return;let r=[...this.renderRoot.querySelectorAll(".dialog button:not(:disabled)")],o=r[0],a=r.at(-1);!o||!a||(e.shiftKey&&this.shadowRoot?.activeElement===o?(e.preventDefault(),a.focus()):!e.shiftKey&&this.shadowRoot?.activeElement===a&&(e.preventDefault(),o.focus()))}#y(e,r="primary-action"){let a={stop:["v4_stop","Stop"],resume:["v4_resume","Resume"],"review-area":["v4_review_details","Review details"],"save-area":["area_save","Save area"],"run-area":["area_run","Clean area"],"save-plan":["plan_save","Save plan"],"run-plan":["plan_run","Run plan"]}[e.id],i=e.id==="clean-rooms"?e.label:a?this.#e(a[0],a[1]):e.label;return y`
      <button
        class=${`${r} ${e.kind==="danger"?"danger":""}`}
        type="button"
        ?disabled=${!e.enabled}
        title=${e.reason??""}
        @click=${()=>this.#v(e)}
      >${i}</button>
    `}#S(e){return e.workflow==="none"?y`
      <div class="quick-actions">
        <button type="button" @click=${()=>this.#c("rooms")}>${this.#e("map_rooms","Rooms")}</button>
        <button type="button" @click=${()=>this.#c("draw")}>${this.#e("v4_draw_area","Draw area")}</button>
        <button type="button" @click=${()=>this.#c("plan")}>${this.#e("cleaning_workspace_plans","Plans")}</button>
        <button type="button" @click=${()=>this.#c("history")}>${this.#e("map_timeline_history","History")}</button>
      </div>
    `:this._workflowReady?y`<matic-map-workflow-v4 .state=${e} .localize=${this.localize}></matic-map-workflow-v4>`:y`<div role="status">${this.#e("v4_loading_workspace","Loading workspace\u2026")}</div>`}render(){let e=this.state,r=e.narrowHint||this._measuredNarrow,o=bt(e,this.localize),a=gt(e,this.localize),i=Le({...e,narrowHint:r}),s=Te(e),d=e.workflow==="draw"&&(r||e.fullMap),l=e.fullMap&&(e.coherence==="verifying"||e.coherence==="booting"),c=e.workflow!=="none"||e.fullMap||e.precisionOpen,u=wt(e.dialog,this.localize);return y`
      <div class=${`root ${r?"narrow":"wide"}`} @keydown=${this.#g}>
        <div class="app">
          <header class="app-bar">
            <button
              class="nav"
              type="button"
              aria-label=${c?this.#e("v4_back","Back"):this.#e("v4_open_navigation","Open navigation")}
              @click=${this.#A}
            >${c?"\u2190":"\u2630"}</button>
            <h1 class="title">${this.#e("map_studio_title","Matic Map")}</h1>
            ${e.host.robotCount>1?y`
              <select
                class="robot-switcher"
                aria-label=${this.#e("v4_choose_robot","Choose robot")}
                .value=${e.selection.entryId||""}
                @change=${h=>this.#a({type:"select-entry",entryId:h.currentTarget.value})}
              >${e.robots.map(h=>y`
                <option value=${h.entryId}>${h.label}</option>
              `)}</select>
            `:x}
            <span class="spacer"></span>
            <span class="header-state">${o.title}</span>
            <div class="overflow-wrap">
              <button
                class="overflow"
                type="button"
                aria-label=${this.#e("map_more","More map options")}
                aria-expanded=${String(this._overflowOpen)}
                @click=${()=>{this._overflowOpen=!this._overflowOpen}}
              >⋮</button>
              ${this._overflowOpen?y`
                <div class="overflow-menu" role="menu">
                  <label class="overflow-field">${this.#e("map_quality_label","Scene detail")}
                    <select
                      .value=${e.quality}
                      @change=${h=>this.#a({type:"set-quality",quality:h.currentTarget.value})}
                    >
                      <option value="auto">${this.#e("map_quality_auto","Auto detail")}</option>
                      <option value="efficient">${this.#e("map_quality_efficient","Efficient")}</option>
                      <option value="balanced">${this.#e("map_quality_balanced","Balanced")}</option>
                      <option value="maximum">${this.#e("map_quality_maximum","Maximum")}</option>
                    </select>
                  </label>
                  <button role="menuitem" type="button" @click=${()=>this.#l("fullscreen")}>${this._browserFullscreen?this.#e("exit_fullscreen","Exit full screen"):this.#e("expand_map","Browser full screen")}</button>
                  <button role="menuitem" type="button" @click=${()=>this.#l("support")}>${this.#e("v4_map_support","Map support")}</button>
                  <button role="menuitem" type="button" @click=${()=>this.#l("classic")}>${this.#e("v4_use_classic","Use classic Map Studio")}</button>
                </div>
              `:x}
            </div>
          </header>

          <main class=${`workspace ${e.fullMap?"full-map":""}`}>
            <div class="canvas">
              <matic-map-canvas-v4
                style=${r&&!e.fullMap?`--map-sheet-offset:${this._sheetOffset}px`:"--map-sheet-offset:0px"}
                .state=${e}
                .localize=${this.localize}
              ></matic-map-canvas-v4>
            </div>

            ${d?y`
              <div class="precision-popover">
                <button
                  class="precision-chip"
                  type="button"
                  aria-expanded=${String(e.precisionOpen)}
                  @click=${this.#p}
                >${e.draw.zoomPercent}% · ${e.draw.brushMeters.toFixed(2)} m</button>
                <button
                  class="precision-chip"
                  type="button"
                  ?disabled=${e.draw.circles.length===0}
                  @click=${()=>this.#a({type:"clear-draft"})}
                >${this.#e("clear","Clear")}</button>
                ${e.precisionOpen?y`
                  <matic-precision-controls-v4 compact .state=${e} .localize=${this.localize}></matic-precision-controls-v4>
                `:x}
              </div>
            `:x}

            <aside class="inspector" aria-label="Map workspace">
              <div class="status-strip">
                <span class="status-icon" aria-hidden="true">◆</span>
                <span><strong>${o.title}</strong><small>${o.detail}</small></span>
              </div>
              <section class="workflow">
                <h2 tabindex="-1">${a.title}</h2>
                <p>${a.description}</p>
                ${this.#S(e)}
                <div class="primary-stack">
                  ${this.#y(i)}
                  ${s?this.#y(s,"secondary-action"):x}
                </div>
              </section>
            </aside>

            <section
              class="mobile-sheet"
              data-detent=${this._sheetDetent}
              aria-label="Map workspace"
            >
              <button
                class="sheet-toggle"
                type="button"
                aria-label=${this.#e("v4_workspace_height","Map workspace, {height} height",{height:this._sheetDetent})}
                aria-expanded=${String(this._sheetDetent!=="peek")}
                @click=${this.#C}
              >
                <span class="sheet-handle" aria-hidden="true"></span>
                <span class="sheet-title">${a.title}</span>
                <span class="sheet-description">${a.description}</span>
              </button>
              <div class="sheet-body">
                ${e.workflow==="draw"?x:this.#S(e)}
              </div>
              <div class="primary-stack">
                ${this.#y(i)}
                ${s?this.#y(s,"secondary-action"):x}
              </div>
            </section>

            ${e.fullMap?y`
              <section
                class=${`full-map-hud ${s?"has-secondary":""}`}
                aria-label="Robot status and action"
              >
                <span class="hud-copy"><strong>${o.title}</strong><small>${o.detail}</small></span>
                ${l?x:this.#y(i)}
                ${!l&&s?this.#y(s,"secondary-action"):x}
              </section>
            `:x}
          </main>
        </div>

        ${u?y`
          <div class="dialog-backdrop">
            <section
              class="dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="dialog-title"
              @keydown=${this.#k}
            >
              <h2 id="dialog-title">${u.title}</h2>
              <p>${u.detail}</p>
              <div class="dialog-actions">
                <button
                  type="button"
                  @click=${e.dialog==="discardDraft"?this.#d:()=>this.#a({type:"dismiss-top-layer"})}
                >${u.cancelLabel}</button>
                ${u.action===null?x:y`
                  <button
                    class="discard"
                    type="button"
                    @click=${()=>this.#u(u)}
                  >${u.confirmLabel}</button>
                `}
              </div>
            </section>
          </div>
        `:x}
      </div>
    `}};customElements.get("matic-map-shell-v4")||customElements.define("matic-map-shell-v4",ge);var we=class extends B{constructor(){super(...arguments);this.scenario="ready";this.narrow=!1;this.controls=!0;this._workspace=ve("ready");this.#e=new Z(this._workspace);this.#t=null}static{this.properties={scenario:{type:String,reflect:!0},narrow:{type:Boolean,reflect:!0},controls:{type:Boolean,reflect:!0},_workspace:{state:!0}}}static{this.styles=J`
    :host {
      display: block;
      color: #1f2933;
      background: #e8edef;
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    }

    * { box-sizing: border-box; }
    button { font: inherit; }

    .gallery-controls {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      padding: 0.65rem;
      border-block-end: 1px solid #ccd5da;
      background: #fff;
    }

    .gallery-controls button {
      min-block-size: 2.25rem;
      padding-inline: 0.65rem;
      border: 1px solid #c5cfd5;
      border-radius: 0.55rem;
      color: #26343c;
      background: #f7f9fa;
      cursor: pointer;
      font-size: 0.75rem;
    }

    .gallery-controls button[aria-pressed="true"] {
      color: white;
      border-color: #0678ce;
      background: #0678ce;
    }

    .stage {
      inline-size: 100%;
      block-size: min(46rem, calc(100dvh - 3.6rem));
      min-block-size: 36rem;
      margin: 0 auto;
      background: #f5f7f8;
    }

    :host([narrow]) .stage { max-inline-size: 24.375rem; block-size: 52.75rem; }
    matic-map-shell-v4 { block-size: 100%; }
  `}#e;#t;connectedCallback(){super.connectedCallback(),this.#t=this.#e.subscribe(e=>{this._workspace=e})}disconnectedCallback(){this.#t?.(),this.#t=null,super.disconnectedCallback()}willUpdate(e){e.has("scenario")?this.#e.replace({...ve(this.scenario),narrowHint:this.narrow}):e.has("narrow")&&this.#e.dispatch({type:"set-narrow-hint",value:this.narrow})}setScenario(e){be.includes(e)&&(this.scenario=e)}getWorkspaceSnapshot(){return structuredClone(this.#e.value)}replaceWorkspaceState(e){this.#e.replace(structuredClone(e))}#r(e){Y(e.detail)&&(e.stopPropagation(),this.#e.dispatch(e.detail))}render(){return y`
      ${this.controls?y`
        <nav class="gallery-controls" aria-label="Map Studio states">
          ${be.map(e=>y`
            <button
              type="button"
              aria-pressed=${String(this.scenario===e)}
              @click=${()=>{this.scenario=e}}
            >${e}</button>
          `)}
        </nav>
      `:null}
      <div class="stage">
        <matic-map-shell-v4
          .state=${this._workspace}
          @matic-workspace-intent=${this.#r}
        ></matic-map-shell-v4>
      </div>
    `}};customElements.get("matic-map-studio-gallery-v0-4-0")||customElements.define("matic-map-studio-gallery-v0-4-0",we);var He="/api/matic_robot/slam_entries";var p=class extends Error{constructor(t){super(t),this.name="ContractError",this.code=t}},C=(n,t)=>{if(!n||typeof n!="object"||Array.isArray(n))throw new p(t);return n},g=(n,t,e)=>{if(typeof n!="string")throw new p(e);let r=n.trim();if(!r||Array.from(r).length>t||/[\u0000-\u001f\u007f]/u.test(r))throw new p(e);return r},kt=n=>{if(n==null||n==="")return null;try{return g(n,128,"invalid-floor-label")}catch{return null}},K=(n,t,e,r)=>{if(typeof n!="number"||!Number.isFinite(n)||n<t||n>e)throw new p(r);return n},R=(n,t,e,r)=>{let o=K(n,t,e,r);if(!Number.isInteger(o))throw new p(r);return o},_e=(n,t)=>n==null?null:R(n,1,t,"invalid-floor-ordinal"),v=(n,t)=>{if(typeof n!="boolean")throw new p(t);return n},St=(n,t)=>n===null?null:v(n,t),Fe=n=>{if(n==null)return null;let t=g(n,64,"invalid-map-session-key");if(!/^[0-9a-f]{64}$/u.test(t))throw new p("invalid-map-session-key");return t},xt=n=>{if(n==null)return null;if(n==="bootstrap_empty"||n==="map_session_unverified"||n==="floor_plan_unavailable"||n==="floor_plan_mismatch")return n;throw new p("invalid-map-block-reason")},Ct=n=>{if(n===void 0)return"not_started";if(n==="not_started"||n==="running"||n==="complete"||n==="partial"||n==="failed")return n;throw new p("invalid-bootstrap-state")},$=(n,t)=>{let e=g(n,512,t);if(!e.startsWith("/")||e.startsWith("//")||e.includes("\\"))throw new p(t);return e},Pt=n=>{let t=typeof n.map_health=="string"?n.map_health.toLowerCase():"",e=typeof n.stream_state=="string"?n.stream_state.toLowerCase():"",r=typeof n.invalid_tiles=="number"?n.invalid_tiles:0;return t.includes("error")||t.includes("fail")||t.includes("degrad")||r>0?"problem":n.map_truncated===!0||t.includes("truncat")||t.includes("limit")?"limited":n.map_complete===!0?"ready":e.includes("connect")||e.includes("collect")||e.includes("run")?"building":"unknown"},Be=n=>{let t=C(n,"invalid-catalog");if(!Array.isArray(t.entries)||t.entries.length>64)throw new p("invalid-catalog-entries");return t.entries.map(e=>{let r=C(e,"invalid-catalog-entry"),o=R(r.map_revision,0,Number.MAX_SAFE_INTEGER,"invalid-map-revision");return{entryId:g(r.entry_id,128,"invalid-entry-id"),sceneUrl:$(r.scene_url,"invalid-scene-url"),deltaUrl:r.delta_url===void 0||r.delta_url===null?null:$(r.delta_url,"invalid-delta-url"),poseUrl:$(r.pose_url,"invalid-pose-url"),historyUrl:$(r.history_url,"invalid-history-url"),areasUrl:$(r.areas_url,"invalid-areas-url"),plansUrl:$(r.plans_url,"invalid-plans-url"),mapRevision:o,mapFloorCoherent:v(r.map_floor_coherent,"invalid-floor-coherence"),mapSessionVerified:v(r.map_session_verified,"invalid-session-state"),mapSessionKey:Fe(r.map_session_key),mapBlockReason:xt(r.map_block_reason),runnerLocked:v(r.runner_locked,"invalid-runner-lock"),stopSettlePending:v(r.stop_settle_pending,"invalid-stop-settle"),activePlan:v(r.active_plan,"invalid-active-plan"),nativeReconciliationPending:v(r.native_reconciliation_pending,"invalid-native-reconciliation"),nativeSessionActive:St(r.native_session_active,"invalid-native-session"),mapComplete:v(r.map_complete,"invalid-map-complete"),mapTruncated:v(r.map_truncated,"invalid-map-truncated"),selectedFloorOrdinal:_e(r.selected_floor_ordinal,128),mapFloorOrdinal:_e(r.map_floor_ordinal,128),historyCount:R(r.history_count,0,12,"invalid-history-count"),historyFloorCount:R(r.history_floor_count,0,128,"invalid-floor-count"),health:Pt(r),streamFailures:R(r.stream_failures,0,Number.MAX_SAFE_INTEGER,"invalid-stream-failures"),bootstrapState:Ct(r.bootstrap_state),bootstrapPhotoSeen:r.bootstrap_photo_seen===void 0?!1:v(r.bootstrap_photo_seen,"invalid-bootstrap-photo"),bootstrapStructureSeen:r.bootstrap_structure_seen===void 0?!1:v(r.bootstrap_structure_seen,"invalid-bootstrap-structure"),bootstrapFailures:r.bootstrap_failures===void 0?0:R(r.bootstrap_failures,0,2,"invalid-bootstrap-failures")}})},We=(n,t)=>{if(!Array.isArray(n)||n.length!==2)throw new p(t);return[K(n[0],-1e6,1e6,t),K(n[1],-1e6,1e6,t)]},At=(n,t)=>{if(!Array.isArray(n)||n.length<3||n.length>8192)throw new p(t);return n.map(e=>We(e,t))},Ke=(n,t)=>{if(!Array.isArray(n)||n.length>256)throw new p("invalid-rooms");return n.map(e=>{let r=C(e,"invalid-room");return{roomId:g(r.room_id,128,"invalid-room-id"),name:g(r.name,128,"invalid-room-name"),boundary:t?At(r.boundary,"invalid-room-boundary"):[]}})},Et=n=>{let t=C(n,"invalid-history-snapshot"),e=g(t.created_at,64,"invalid-history-time");if(!Number.isFinite(Date.parse(e)))throw new p("invalid-history-time");return{id:g(t.id,128,"invalid-history-id"),createdAt:e,revision:R(t.revision,0,Number.MAX_SAFE_INTEGER,"invalid-history-revision"),pointCount:R(t.point_count,1,15e5,"invalid-history-points"),sceneUrl:$(t.scene_url,"invalid-history-scene-url")}},qe=n=>{let t=C(n,"invalid-history");if(!Array.isArray(t.floors)||t.floors.length<1||t.floors.length>128)throw new p("invalid-history-floors");return{entryId:g(t.entry_id,128,"invalid-history-entry"),liveAvailable:v(t.live_available,"invalid-history-live"),floors:t.floors.map(e=>{let r=C(e,"invalid-history-floor");if(!Array.isArray(r.snapshots)||r.snapshots.length>12)throw new p("invalid-history-snapshots");return{id:g(r.id,128,"invalid-history-floor-id"),active:v(r.active,"invalid-history-floor-active"),readOnly:v(r.read_only,"invalid-history-floor-read-only"),liveAvailable:r.live_available===void 0?!1:v(r.live_available,"invalid-history-floor-live"),label:kt(r.label),ordinal:r.ordinal===void 0?null:_e(r.ordinal,128),snapshots:r.snapshots.map(Et)}})}},Ve=n=>{if(n==="vacuum"||n==="mop"||n==="vacuum_and_mop")return n;throw new p("invalid-cleaning-mode")},je=n=>{if(n==="quick"||n==="standard"||n==="heavy_duty")return n;throw new p("invalid-coverage-setting")},Mt=n=>{let t=C(n,"invalid-area-circle");return{x:K(t.x,-1e6,1e6,"invalid-area-circle"),y:K(t.y,-1e6,1e6,"invalid-area-circle"),radius:K(t.radius,.05,2.5,"invalid-area-circle")}},Rt=n=>n==="current"||n==="review"||n==="stale"?n:"unknown",Xe=n=>{let t=C(n,"invalid-areas");if(!Array.isArray(t.areas)||t.areas.length>256)throw new p("invalid-area-list");return{sceneUrl:$(t.scene_url,"invalid-area-scene-url"),rooms:Ke(t.rooms,!0),areas:t.areas.map(e=>{let r=C(e,"invalid-area");if(!Array.isArray(r.circles)||r.circles.length>512)throw new p("invalid-area-circles");return{id:g(r.id,128,"invalid-area-id"),name:g(r.name,128,"invalid-area-name"),circles:r.circles.map(Mt),cleaningMode:Ve(r.cleaning_mode),coverageSetting:je(r.coverage_setting),status:Rt(r.status),canRebind:v(r.can_rebind,"invalid-area-rebind")}})}},Ge=n=>{let t=C(n,"invalid-plans");if(!Array.isArray(t.plans)||t.plans.length>256)throw new p("invalid-plan-list");return{rooms:Ke(t.rooms,!1).map(({roomId:r,name:o})=>({roomId:r,name:o})),selectedPlan:t.selected_plan===null||t.selected_plan===void 0?null:g(t.selected_plan,128,"invalid-selected-plan"),plans:t.plans.map(r=>{let o=C(r,"invalid-plan");if(!Array.isArray(o.rooms)||o.rooms.length>256||!Array.isArray(o.room_order))throw new p("invalid-plan-rooms");let a=o.run_behavior;if(a!=="intelligent"&&a!=="ordered")throw new p("invalid-run-behavior");return{id:g(o.id,128,"invalid-plan-id"),name:g(o.name,128,"invalid-plan-name"),enabled:v(o.enabled,"invalid-plan-enabled"),runBehavior:a,rooms:o.rooms.map(i=>{let s=C(i,"invalid-plan-room");return{roomId:g(s.room_id,128,"invalid-plan-room-id"),cleaningMode:Ve(s.cleaning_mode),coverageSetting:je(s.coverage_setting)}}),roomOrder:o.room_order.slice(0,256).map(i=>g(i,128,"invalid-room-order")),returnToBase:v(o.return_to_base,"invalid-return-to-base"),finishCurrentRoom:v(o.finish_current_room,"invalid-finish-room"),finishCurrentRoomThreshold:R(o.finish_current_room_threshold,0,100,"invalid-finish-threshold")}})}},Ye=n=>{let t=C(n,"invalid-pose"),e=t.position,r=e===null?null:We(e,"invalid-pose-position"),o=t.pose_freshness;if(o!=="live"&&o!=="coordinator_fallback")throw new p("invalid-pose-freshness");return{position:r,source:g(t.source,64,"invalid-pose-source"),revision:R(t.revision,0,Number.MAX_SAFE_INTEGER,"invalid-pose-revision"),poseRevision:R(t.pose_revision,0,Number.MAX_SAFE_INTEGER,"invalid-pose-sequence"),floorCoherent:v(t.map_floor_coherent,"invalid-pose-floor"),mapSessionKey:Fe(t.map_session_key),freshness:o}},Ze=n=>{try{return $(n,"invalid-private-path"),!0}catch{return!1}};var Je=n=>{let a=()=>{throw new Error("invalid-scene")};(!(n instanceof ArrayBuffer)||n.byteLength<24||n.byteLength>16777216)&&a();let i=new DataView(n),s=new Uint8Array(n,0,8),d=String.fromCharCode(...s),l=i.getUint16(8,!0),c=i.getUint16(10,!0),u=i.getUint32(12,!0),h=i.getUint32(16,!0),f=i.getUint32(20,!0),k=h+f,P=24+u;(d!=="MATIC3D\0"||l!==1||c!==8||u>1024*1024||k<1||k>15e5||P+k*c!==n.byteLength)&&a();let b;try{b=JSON.parse(new TextDecoder("utf-8",{fatal:!0}).decode(new Uint8Array(n,24,u)))}catch{a()}(!b||typeof b!="object"||Array.isArray(b))&&a();let S=b,T=S.meters_per_cell,A=S.origin_cells,w=S.span_cells;(typeof T!="number"||!Number.isFinite(T)||T<.001||T>.1||!Array.isArray(A)||A.length!==2||!A.every(E=>typeof E=="number"&&Number.isFinite(E))||!Array.isArray(w)||w.length!==2||!w.every(E=>typeof E=="number"&&Number.isFinite(E)&&E>=1&&E<=65536))&&a();let O=(Array.isArray(S.rooms)?S.rooms.slice(0,128):[]).flatMap((E,pt)=>{if(!E||typeof E!="object"||Array.isArray(E))return[];let U=E,G=typeof U.name=="string"?U.name.trim():"";if(!G||Array.from(G).length>128||/[\u0000-\u001f\u007f]/u.test(G))return[];if(!Array.isArray(U.boundary)||U.boundary.length<3||U.boundary.length>8192)return[];let Me=U.boundary.flatMap(ue=>{if(!Array.isArray(ue)||ue.length!==2)return[];let[pe,he]=ue;return typeof pe=="number"&&Number.isFinite(pe)&&typeof he=="number"&&Number.isFinite(he)?[[pe,he]]:[]}),le=U.center;if(Me.length<3||!Array.isArray(le)||le.length!==2)return[];let[ce,de]=le;return typeof ce!="number"||!Number.isFinite(ce)||typeof de!="number"||!Number.isFinite(de)?[]:[{id:`scene-room-${pt+1}`,name:G,boundary:Me,center:[ce,de]}]}),X=typeof S.sample_step=="number"&&Number.isInteger(S.sample_step)?Math.max(1,Math.min(15e5,S.sample_step)):1,Ae=A,Ee=w;return{buffer:n,pointOffset:P,floorCount:h,surfaceCount:f,total:k,metadata:{metersPerCell:T,origin:[Ae[0],Ae[1]],span:[Ee[0],Ee[1]],sampleStep:X,rooms:O}}},$t=n=>{if(n.byteLength>16777216||n.byteLength<24||!1||!1)throw new p("invalid-scene");try{return Je(n)}catch{throw new p("invalid-scene")}},zt=()=>`
  const parseTransfer = ${Je.toString()};
  self.onmessage = (event) => {
    const { id, buffer } = event.data;
    try {
      const parsed = parseTransfer(buffer);
      self.postMessage({ id, ok: true, parsed }, [parsed.buffer]);
    } catch (_) {
      self.postMessage({ id, ok: false, problem: "invalid-scene" });
    }
  };
`,te=class{#e=null;#t=null;#r=0;#n=new Map;constructor(){if(!(typeof Worker!="function"||typeof URL?.createObjectURL!="function"))try{this.#t=URL.createObjectURL(new Blob([zt()],{type:"text/javascript"})),this.#e=new Worker(this.#t),this.#e.onmessage=t=>{let e=this.#n.get(t.data.id);e&&(this.#n.delete(t.data.id),t.data.ok&&t.data.parsed?e.resolve(t.data.parsed):e.reject(new p(t.data.problem||"invalid-scene")))},this.#e.onerror=()=>this.#s("scene-worker-failed")}catch{this.#e=null,this.#t&&URL.revokeObjectURL(this.#t),this.#t=null}}async parse(t,e){if(e?.aborted)throw new DOMException("Aborted","AbortError");if(!this.#e){if(await new Promise(o=>window.setTimeout(o,0)),e?.aborted)throw new DOMException("Aborted","AbortError");return $t(t)}let r=++this.#r;return new Promise((o,a)=>{let i=()=>{this.#n.delete(r),a(new DOMException("Aborted","AbortError"))};e?.addEventListener("abort",i,{once:!0}),this.#n.set(r,{resolve:s=>{e?.removeEventListener("abort",i),o(s)},reject:s=>{e?.removeEventListener("abort",i),a(s)}}),this.#e?.postMessage({id:r,buffer:t},[t])})}#s(t){for(let e of this.#n.values())e.reject(new p(t));this.#n.clear(),this.#e?.terminate(),this.#e=null}dispose(){this.#s("scene-parser-disposed"),this.#t&&URL.revokeObjectURL(this.#t),this.#t=null}};var z={catalog:1e4,scene:6e4,delta:35e3,pose:1e4,history:15e3,workflow:15e3,mutation:2e4},M=class extends Error{constructor(t,e=null){super(t),this.name="BackendError",this.code=t,this.status=e}},V=36,q=16*1024*1024,Qe=(n,t)=>{let e=Number(n);if(!Number.isSafeInteger(e)||e<0)throw new p(t);return e},et=(n,t)=>{let e=n.headers.get("X-Matic-Revision");if(e===null)return t;let r=Number(e);if(!Number.isSafeInteger(r)||r<0)throw new p("invalid-scene-revision");return r},tt=(n,t)=>{let e=n.headers.get("X-Matic-Floor-Coherent");if(e===null)return t;if(e==="1")return!0;if(e==="0")return!1;throw new p("invalid-scene-floor-header")},re=class{#e;#t=new te;constructor(t){this.#e=t}async#r(t,e,r,o){if(!Ze(t))throw new M("invalid-private-path");if(o?.aborted)throw new DOMException("Aborted","AbortError");let a=new AbortController,i=()=>a.abort();o?.addEventListener("abort",i,{once:!0});let s=!1,d=window.setTimeout(()=>{s=!0,a.abort()},r);try{let l=this.#e(),c=new Headers(e.headers),u={...e,cache:"no-store",credentials:"same-origin",headers:Object.fromEntries(c.entries()),signal:a.signal};if(typeof l?.fetchWithAuth=="function")return await l.fetchWithAuth(t,u);let h=l?.auth?.accessToken||l?.auth?.data?.access_token;h&&c.set("Authorization",`Bearer ${h}`);let f=typeof l?.hassUrl=="function"?l.hassUrl(t):t;return await fetch(f,{...u,headers:c})}catch(l){throw s&&!o?.aborted?new M("request-timeout"):a.signal.aborted?new DOMException("Aborted","AbortError"):l}finally{window.clearTimeout(d),o?.removeEventListener("abort",i)}}async#n(t,e,r,o={}){let a=await this.#r(t,{...o,headers:{Accept:"application/json",...o.headers||{}}},e,r);if(!a.ok)throw new M("request-failed",a.status);try{return await a.json()}catch{throw new p("invalid-json-response")}}async catalog(t){return Be(await this.#n(He,z.catalog,t))}async scene(t,e,r,o,a,i){let s=new Headers({Accept:"application/vnd.matic.slam-scene"});o==="live"&&s.set("X-Matic-Prefer-Cached","1"),i&&s.set("If-None-Match",i);let d=await this.#r(t,{headers:s},z.scene,a),l=et(d,e),c=tt(d,r);if(d.status===304)return{scene:null,floorCoherent:c,revision:l,notModified:!0};if(!d.ok)throw new M("scene-request-failed",d.status);if(d.headers.get("Content-Type")?.split(";",1)[0]!=="application/vnd.matic.slam-scene")throw new p("invalid-scene-content-type");return{scene:{...await this.#t.parse(await d.arrayBuffer(),a),revision:l,etag:d.headers.get("ETag"),source:o},floorCoherent:c,revision:l,notModified:!1}}async#s(t,e,r){if(!Number.isSafeInteger(e)||e<1||e>q||typeof DecompressionStream!="function")throw new p("invalid-scene-delta");let a=new Blob([t]).stream().pipeThrough(new DecompressionStream("deflate")).getReader(),i=new Uint8Array(e),s=0,d=()=>{a.cancel()};r?.addEventListener("abort",d,{once:!0});try{for(;;){if(r?.aborted)throw new DOMException("Aborted","AbortError");let{done:l,value:c}=await a.read();if(l)break;if(!(c instanceof Uint8Array)||s+c.byteLength>e)throw new p("invalid-scene-delta");i.set(c,s),s+=c.byteLength}}finally{r?.removeEventListener("abort",d),a.releaseLock()}if(s!==e)throw new p("invalid-scene-delta");return i}async#o(t,e,r){if(t.byteLength<V||t.byteLength>V+q||e.buffer.byteLength>q)throw new p("invalid-scene-delta");let o=new DataView(t),a=new TextDecoder().decode(new Uint8Array(t,0,8)),i=o.getUint16(8,!0),s=o.getUint16(10,!0),d=Qe(o.getBigUint64(12,!0),"invalid-scene-delta"),l=Qe(o.getBigUint64(20,!0),"invalid-scene-delta"),c=o.getUint32(28,!0),u=o.getUint32(32,!0);if(a!=="MATICDLT"||i!==1||s!==1||d!==e.revision||l<=e.revision||c<24||c>q||u>q||u+V!==t.byteLength)throw new p("invalid-scene-delta");let h=new Uint8Array(t,V,u),f=new Uint8Array(e.buffer),P=(await this.#s(h,Math.max(f.byteLength,c),r)).slice(),b=1024*1024;for(let A=0;A<f.byteLength;A+=b){if(r?.aborted)throw new DOMException("Aborted","AbortError");let w=Math.min(f.byteLength,A+b);for(let _=A;_<w;_+=1)P[_]=(P[_]??0)^(f[_]??0);w<f.byteLength&&await new Promise(_=>window.setTimeout(_,0))}let S=P.slice(0,c).buffer;return{parsed:{...await this.#t.parse(S,r),revision:l,etag:null,source:"live"},revision:l}}async sceneDelta(t,e,r,o){let a=t.includes("?")?"&":"?",i=await this.#r(`${t}${a}since=${encodeURIComponent(e.revision)}`,{headers:{Accept:"application/vnd.matic.slam-delta, application/vnd.matic.slam-scene"}},z.delta,o),s=et(i,e.revision),d=tt(i,r);if(i.status===204){if(s!==e.revision)throw new p("invalid-scene-delta-revision");return{scene:null,floorCoherent:d,revision:s,notModified:!0}}if(!i.ok)throw new M("delta-request-failed",i.status);if(s<=e.revision)throw new p("invalid-scene-delta-revision");let l=Number(i.headers.get("Content-Length"));if(Number.isFinite(l)&&l>V+q)throw new p("invalid-scene-delta-size");let c=i.headers.get("Content-Type")?.split(";",1)[0],u=await i.arrayBuffer();if(c==="application/vnd.matic.slam-delta"){let f=Number(i.headers.get("X-Matic-Base-Revision"));if(!Number.isSafeInteger(f)||f!==e.revision)throw new p("invalid-scene-delta-base");let k=await this.#o(u,e,o);if(k.revision!==s)throw new p("invalid-scene-delta-revision");return{scene:{...k.parsed,etag:i.headers.get("ETag")},floorCoherent:d,revision:s,notModified:!1}}if(c!=="application/vnd.matic.slam-scene")throw new p("invalid-scene-delta-content-type");return{scene:{...await this.#t.parse(u,o),revision:s,etag:i.headers.get("ETag"),source:"live"},floorCoherent:d,revision:s,notModified:!1}}async pose(t,e){return Ye(await this.#n(t,z.pose,e))}async history(t,e){return qe(await this.#n(t,z.history,e))}async plans(t,e){return Ge(await this.#n(t,z.workflow,e))}async areas(t,e){return Xe(await this.#n(t,z.workflow,e))}async saveArea(t,e,r){let o=await this.#n(t,z.mutation,r,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...e.areaId?{area_id:e.areaId}:{},name:e.name,circles:e.circles,cleaning_mode:e.cleaningMode,coverage_setting:e.coverageSetting})});if(!o||typeof o!="object"||typeof o.id!="string")throw new p("invalid-area-save-response");return o.id}async deleteArea(t,e,r){let o=await this.#r(`${t}?area_id=${encodeURIComponent(e)}`,{method:"DELETE",headers:{Accept:"application/json"}},z.mutation,r);if(!o.ok)throw new M("area-delete-failed",o.status)}async service(t,e,r,o){let a=this.#e();if(typeof a?.callService!="function")throw new M("service-unavailable");await a.callService(t,e,r,{entity_id:o})}dispose(){this.#t.dispose()}};var nt=()=>({version:4,view:"top",appearance:"photo",labels:!0,quality:"auto",cameras:{}}),j=(n,t,e)=>Math.max(t,Math.min(e,n)),ot=n=>n.replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",Se=(n,t=4)=>`matic-map-studio:v${t}:${ot(n)}`,Ot=n=>{if(!n||typeof n!="object")return null;let t=n;return["yaw","pitch","zoom","targetX","targetZ"].every(r=>typeof t[r]=="number"&&Number.isFinite(t[r]))?{yaw:j(t.yaw,-Math.PI,Math.PI),pitch:j(t.pitch,.18,Math.PI/2-.018),zoom:j(t.zoom,.01,100),targetX:j(t.targetX,-1e4,1e4),targetZ:j(t.targetZ,-1e4,1e4)}:null},rt=n=>{let t=nt();if(!n||typeof n!="object")return t;let e=n,r=e.view==="three"||e.view==="top"||e.view==="rooms"?e.view:t.view,o=r==="rooms"?"top":r,a=e.quality==="auto"||e.quality==="efficient"||e.quality==="balanced"||e.quality==="maximum"?e.quality:t.quality,i=e.cameras&&typeof e.cameras=="object"?e.cameras:{},s={};for(let d of["three","top"]){let l=Ot(i[d]);l&&(s[d]=l)}return{version:4,view:o,appearance:e.appearance==="rooms"||e.appearance==="photo"?e.appearance:t.appearance,labels:typeof e.labels=="boolean"?e.labels:t.labels,quality:a,cameras:s}},ne=class{#e="local-user";#t=null;load(t){this.#e=ot(t);try{let e=window.localStorage.getItem(Se(this.#e));if(e)return rt(JSON.parse(e));for(let r of[3,2]){let o=window.localStorage.getItem(Se(this.#e,r));if(o)return rt(JSON.parse(o))}}catch{}return nt()}schedule(t){this.#t!==null&&window.clearTimeout(this.#t),this.#t=window.setTimeout(()=>{this.#t=null;try{window.localStorage.setItem(Se(this.#e),JSON.stringify(t))}catch{}},250)}dispose(){this.#t!==null&&window.clearTimeout(this.#t),this.#t=null}},at="matic-map-studio:preferred-frontend",st=()=>{try{return window.localStorage.getItem(at)==="v3"?"v3":"v4"}catch{return"v4"}},xe=n=>{try{return window.localStorage.setItem(at,n),!0}catch{return!1}};var m=(n,t,e=null)=>({status:n,value:t,problem:e}),I=n=>n instanceof DOMException&&n.name==="AbortError",F=(n,t)=>n instanceof M||n&&typeof n=="object"&&"code"in n&&typeof n.code=="string"?n.code:t,oe=n=>[n.selectedFloorOrdinal??"none",n.mapFloorOrdinal??"none",n.mapFloorCoherent?"coherent":"transition"].join(":"),ae=n=>[n.mapFloorOrdinal??"none",n.mapSessionVerified?"verified":"unverified",n.mapSessionKey??"no-session"].join(":"),L=n=>[n.entryId,n.selectedFloorOrdinal??"none",n.mapFloorOrdinal??"none"].join("|"),it=n=>[n.entryId,oe(n),ae(n),n.mapRevision].join("|"),lt=n=>n.runnerLocked||n.stopSettlePending||n.activePlan||n.nativeReconciliationPending||n.nativeSessionActive===!0,Nt=(n,t)=>n.entryKey===t.entryKey&&n.generation===t.generation&&n.floorKey===t.floorKey&&n.missionKey===t.missionKey,ct="Live map updates paused while the current map is rechecked.",dt="Reconnecting. The last verified map remains read only.",Ut=1e3,Ce=(n,t)=>n.label?n.label:n.active?"Current floor":`Saved floor ${n.ordinal??t}`,se=class{#e;#t=new Re;#r;#n=new ne;#s=new Map;#o=null;#i;#h=null;#m=null;#a=null;#v=!1;#c=!1;#b=!1;#d="";#f=0;#x="";#u=!1;#C=!0;constructor(t,e){this.#e=t,this.#r=e}sync(t,e){if(this.#u)return;let r=this.#C;if(this.#C=t.host.connected,this.#o=t,this.#i=e,this.#e.patch({host:t.host,activity:t.activity,batteryPercent:t.batteryPercent,robotLabel:t.robotLabel,robots:t.robots,locale:t.language}),t.userKey!==this.#x){this.#x=t.userKey;let o=this.#n.load(t.userKey);this.#e.patch({view:o.view,appearance:o.appearance,labelsVisible:o.labels,quality:o.quality,cameras:o.cameras})}if(!t.host.administrator){this.#w(),this.#k("access-required");return}if(!t.host.connected){this.#w();let o=this.#e.value,a=o.resources.scene.value;this.#e.patch({coherence:a?"degraded":"unavailable",resources:{...o.resources,pose:m("idle",null)},map:{...o.map,available:a!==null,exactPose:!1},notice:a?{tone:"warning",text:dt}:o.notice});return}if(t.host.robotCount===0){this.#w(),this.#k("map-unavailable");return}if(this.#A(),!r){this.#e.value.notice?.text===dt&&this.#e.patch({notice:null}),this.refreshCatalog(!0);return}(this.#e.value.resources.catalog.status==="idle"||t.entryKey&&t.entryKey!==this.#e.value.selection.entryId)&&this.refreshCatalog(!0)}schedulePreferences(t){this.#n.schedule(t)}#A(){this.#h===null&&(this.#h=window.setInterval(()=>{document.visibilityState==="visible"&&this.refreshCatalog()},5e3)),this.#m===null&&(this.#m=window.setInterval(()=>{document.visibilityState==="visible"&&this.refreshPose()},Ut))}#w(){this.#h!==null&&window.clearInterval(this.#h),this.#m!==null&&window.clearInterval(this.#m),this.#h=null,this.#m=null}#l(t){this.#s.get(t)?.abort();let e=new AbortController;return this.#s.set(t,e),e}#p(t,e){this.#s.get(t)===e&&this.#s.delete(t)}#g(t=[]){for(let[e,r]of this.#s)t.includes(e)||(r.abort(),this.#s.delete(e))}#k(t){this.#g(),this.#t.invalidate(),this.#d="";let e=this.#e.value;this.#e.patch({generation:this.#t.generation,coherence:e.host.administrator?"unavailable":"blocked",fullMap:!1,precisionOpen:!1,resources:{catalog:m("error",null,t),entry:null,scene:m("idle",null),pose:m("idle",null),history:m("idle",null),plans:m("idle",null),areas:m("idle",null)},map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1},selection:{...e.selection,entryId:null,floorId:"current",historyId:null}})}async refreshCatalog(t=!1){if(this.#u||this.#v||!this.#o?.host.administrator)return;this.#v=!0;let e=this.#l("catalog"),r=this.#e.value.resources.catalog.value;this.#e.patch({resources:{...this.#e.value.resources,catalog:m("loading",r)}});try{let o=await this.#r.catalog(e.signal);if(e.signal.aborted||this.#u)return;let a=this.#i?.config?.entry_id,i=typeof a=="string"?a:null,s=o.find(c=>c.entryId===this.#o?.entryKey)||o.find(c=>c.entryId===i)||o[0]||null,d=this.#e.value.resources.entry;if(s&&d&&L(s)===L(d)&&oe(s)===oe(d)&&ae(s)===ae(d)&&s.mapRevision<d.mapRevision&&(s={...s,mapRevision:d.mapRevision}),this.#e.patch({managedLock:s?lt(s):!1,resources:{...this.#e.value.resources,catalog:m(o.length?"ready":"empty",o),entry:s}}),!s){this.#k("no-loaded-robot");return}if(this.#e.value.selection.floorId!=="current"&&!t)return;let l=it(s);if(!t&&l===this.#d){let c=this.#e.value,u=s.mapFloorCoherent&&s.mapSessionVerified,h=s.health==="problem"||s.health==="limited";this.#e.patch({coherence:u?h?"degraded":"current":"verifying",map:{...c.map,available:u&&c.resources.scene.value!==null,complete:s.mapComplete&&!s.mapTruncated,floorCoherent:s.mapFloorCoherent,sessionVerified:s.mapSessionVerified,exactPose:u?c.map.exactPose:!1},floor:{...c.floor,classifiedCount:Math.max(1,s.historyFloorCount)}});return}this.#d=l,this.#y(s)}catch(o){if(I(o))return;this.#e.patch({coherence:this.#e.value.resources.scene.value?"degraded":"unavailable",resources:{...this.#e.value.resources,catalog:m("error",r,F(o,"catalog-unavailable"))}})}finally{this.#p("catalog",e),this.#v=!1}}#y(t){let e=this.#e.value,r=e.resources.entry,o=!!(r&&L(r)===L(t)),a=t.mapFloorCoherent&&t.mapSessionVerified;this.#g(o?["catalog","plans","areas","plan-mutation","area-mutation"]:["catalog"]);let i=o?e.resources.scene.value:null,s=e.resources.pose.value,d=o&&a&&t.mapSessionKey!==null&&s?.position&&s.mapSessionKey===t.mapSessionKey?s:null,l=this.#t.begin(t.entryId,oe(t),ae(t),t.mapRevision),c=t.health==="problem"||t.health==="limited",u=this.#e.value;this.#e.patch({managedLock:lt(t),generation:l.generation,coherence:a?c?"degraded":"current":"verifying",dataMode:"live",resources:{...u.resources,entry:t,scene:m(a?"loading":"idle",i),pose:m(a?"loading":"idle",d),history:m("loading",u.resources.history.value),plans:o?u.resources.plans:m("idle",null),areas:o?u.resources.areas:m("idle",null)},map:{available:a&&i!==null,complete:t.mapComplete&&!t.mapTruncated,floorCoherent:t.mapFloorCoherent,sessionVerified:t.mapSessionVerified,exactPose:a&&d!==null},floor:{classifiedCount:Math.max(1,t.historyFloorCount),displayName:t.selectedFloorOrdinal?`Floor ${t.selectedFloorOrdinal}`:"Current floor",readOnly:!1},selection:{...u.selection,entryId:t.entryId,floorId:"current",historyId:null,roomIds:o?u.selection.roomIds:[],planId:o?u.selection.planId:null,areaId:o?u.selection.areaId:null}}),this.#I(t,l),a&&(this.#S(t,l),this.#P(t,l))}async#S(t,e){let r=this.#l("scene");try{let o=await this.#r.scene(t.sceneUrl,t.mapRevision,t.mapFloorCoherent,"live",r.signal);if(!this.#t.accepts(e)||o.revision!==e.revision||!o.floorCoherent||!o.scene)return;let a=this.#e.value;if(this.#e.patch({resources:{...a.resources,scene:m("ready",o.scene)},map:{...a.map,available:!0},notice:a.notice?.text===ct?null:a.notice}),t.deltaUrl){let i=++this.#f;this.#R(t,e,o.scene,i)}}catch(o){if(I(o)||!this.#t.accepts(e))return;if(o instanceof M&&o.code==="request-timeout"){let d=this.#e.value;this.#e.patch({resources:{...d.resources,scene:m("loading",d.resources.scene.value,"scene-building")}}),window.setTimeout(()=>{this.#u||!this.#t.accepts(e)||this.#e.value.selection.floorId!=="current"||this.#S(t,e)},250);return}let a=this.#e.value,i=a.resources.pose.value,s=a.resources.scene.value!==null&&t.mapSessionKey!==null&&i?.position!==null&&i?.mapSessionKey===t.mapSessionKey;this.#e.patch({coherence:"degraded",resources:{...a.resources,scene:m("error",a.resources.scene.value,F(o,"scene-unavailable"))},map:{...a.map,available:a.resources.scene.value!==null,exactPose:s}})}finally{this.#p("scene",r)}}async#R(t,e,r,o){if(!t.deltaUrl||typeof DecompressionStream!="function")return;let a=t.deltaUrl,i=t,s=e,d=r;try{for(;!this.#u&&o===this.#f&&this.#t.accepts(s)&&this.#e.value.selection.floorId==="current";){let l=this.#l("delta");try{let c=await this.#r.sceneDelta(a,d,i.mapFloorCoherent,l.signal);if(l.signal.aborted||this.#u||o!==this.#f||!this.#t.accepts(s))return;if(!c.floorCoherent){this.#e.patch({coherence:"verifying",map:{...this.#e.value.map,available:!1,floorCoherent:!1,exactPose:!1},resources:{...this.#e.value.resources,pose:m("idle",null)}}),this.#d="",this.refreshCatalog(!0);return}if(c.notModified||!c.scene){await new Promise(f=>window.setTimeout(f,100));continue}let u=this.#t.advance(s,c.revision);if(!u)return;s=u,d=c.scene,i={...i,mapRevision:c.revision},this.#d=it(i);let h=this.#e.value;this.#e.patch({resources:{...h.resources,entry:i,scene:m("ready",d)},map:{...h.map,available:!0,floorCoherent:!0}}),this.#P(i,s)}finally{this.#p("delta",l)}}}catch(l){if(I(l)||this.#u||o!==this.#f||!this.#t.accepts(s))return;this.#e.patch({coherence:"degraded",notice:{tone:"warning",text:ct}}),this.#d="",this.refreshCatalog(!0)}}async#I(t,e){let r=this.#l("history");try{let o=await this.#r.history(t.historyUrl,r.signal);if(!this.#t.accepts(e)||o.entryId!==t.entryId)return;let a=o.floors.find(i=>i.active)||o.floors[0];if(!a)return;this.#e.patch({resources:{...this.#e.value.resources,history:m("ready",o)},floor:{...this.#e.value.floor,classifiedCount:o.floors.length,displayName:Ce(a,1)}})}catch(o){if(I(o)||!this.#t.accepts(e))return;this.#e.patch({resources:{...this.#e.value.resources,history:m("error",null,F(o,"history-unavailable"))}})}finally{this.#p("history",r)}}async refreshPose(){let t=this.#e.value.resources.entry,e=this.#t.current();!t||!e||this.#e.value.selection.floorId!=="current"||!t.mapFloorCoherent||!t.mapSessionVerified||await this.#P(t,e)}async#P(t,e){if(this.#c){this.#b=!0;return}this.#c=!0;let r=this.#l("pose");try{let o=await this.#r.pose(t.poseUrl,r.signal),a=this.#t.current(),i=this.#e.value.resources.entry;if(!a||!Nt(e,a)||!i||!o.floorCoherent)return;if(o.mapSessionKey===null||o.mapSessionKey!==i.mapSessionKey){this.#e.patch({map:{...this.#e.value.map,exactPose:!1}}),this.#d="",this.refreshCatalog(!0);return}let s=this.#e.value,d=s.resources.pose.value,l=!!(s.map.exactPose&&d?.position&&d.mapSessionKey===i.mapSessionKey);if(o.position===null&&l){this.#e.patch({resources:{...s.resources,pose:m("ready",d)}});return}this.#e.patch({resources:{...s.resources,pose:m("ready",o)},map:{...s.map,exactPose:o.position!==null}})}catch(o){if(I(o)||!this.#t.accepts(e))return;let a=this.#e.value,i=a.resources.pose.value,s=!!(a.map.exactPose&&i?.position&&i.mapSessionKey===a.resources.entry?.mapSessionKey);this.#e.patch({resources:{...a.resources,pose:m("error",s?i:null,F(o,"pose-unavailable"))},map:{...a.map,exactPose:s}})}finally{if(this.#p("pose",r),this.#c=!1,this.#b&&!this.#u){this.#b=!1;let o=this.#e.value.resources.entry,a=this.#t.current();o&&a&&this.#P(o,a)}}}async selectFloor(t){let e=this.#e.value.resources.history.value,r=this.#e.value.resources.entry;if(!e||!r)return;let o=e.floors.find(s=>s.id===t);if(!o)return;if(o.active){this.#d="",this.#e.dispatch({type:"set-floor",floorId:"current"}),await this.refreshCatalog(!0);return}let a=o.snapshots.at(-1);this.#g(["catalog"]);let i=this.#t.begin(r.entryId,o.id,a?.id||o.id,a?.revision||0);this.#e.patch({generation:i.generation,coherence:"current",dataMode:"history",floor:{classifiedCount:e.floors.length,displayName:Ce(o,e.floors.indexOf(o)+1),readOnly:!0},selection:{...this.#e.value.selection,floorId:o.id,historyId:a?.id||null},resources:{...this.#e.value.resources,scene:m(a?"loading":"empty",null),pose:m("idle",null)},map:{available:!1,complete:!0,floorCoherent:!0,sessionVerified:!0,exactPose:!1}}),a&&await this.#E(a,i)}async selectHistory(t){let e=this.#e.value.resources.history.value,r=this.#e.value.resources.entry;if(!e||!r)return;if(!t){await this.selectFloor("current");return}let o=e.floors.find(s=>s.snapshots.some(d=>d.id===t)),a=o?.snapshots.find(s=>s.id===t);if(!o||!a)return;let i=this.#t.begin(r.entryId,o.id,a.id,a.revision);this.#g(["catalog"]),this.#e.patch({generation:i.generation,dataMode:"history",floor:{classifiedCount:e.floors.length,displayName:Ce(o,e.floors.indexOf(o)+1),readOnly:!0},selection:{...this.#e.value.selection,floorId:o.id,historyId:a.id},resources:{...this.#e.value.resources,scene:m("loading",null),pose:m("idle",null)},map:{...this.#e.value.map,available:!1,exactPose:!1}}),await this.#E(a,i)}async#E(t,e){let r=this.#l("history-scene");try{let o=await this.#r.scene(t.sceneUrl,t.revision,!0,"history",r.signal);if(!this.#t.accepts(e)||!o.scene)return;this.#e.patch({resources:{...this.#e.value.resources,scene:m("ready",o.scene)},map:{...this.#e.value.map,available:!0,exactPose:!1}})}catch(o){if(I(o)||!this.#t.accepts(e))return;this.#e.patch({resources:{...this.#e.value.resources,scene:m("error",null,F(o,"history-scene-unavailable"))}})}finally{this.#p("history-scene",r)}}async openWorkflow(t){this.#e.dispatch({type:"open-workflow",workflow:t}),(t==="plan"||t==="rooms")&&await this.loadPlans(),(t==="draw"||t==="areaReview")&&await this.loadAreas()}async loadPlans(){let t=this.#e.value.resources.entry;if(!t||!this.#t.current()||!D(this.#e.value))return;let e=L(t),r=this.#l("plans");this.#e.patch({resources:{...this.#e.value.resources,plans:m("loading",null)}});try{let o=await this.#r.plans(t.plansUrl,r.signal),a=this.#e.value.resources.entry;if(!a||L(a)!==e)return;this.#e.patch({resources:{...this.#e.value.resources,plans:m("ready",o)},selection:{...this.#e.value.selection,planId:o.selectedPlan||o.plans[0]?.id||null}}),this.selectPlan(o.selectedPlan||o.plans[0]?.id||null)}catch(o){let a=this.#e.value.resources.entry;if(I(o)||!a||L(a)!==e)return;this.#e.patch({resources:{...this.#e.value.resources,plans:m("error",null,F(o,"plans-unavailable"))}})}finally{this.#p("plans",r)}}selectPlan(t){let e=this.#e.value.resources.plans.value?.plans.find(r=>r.id===t);this.#e.patch({selection:{...this.#e.value.selection,planId:t},planDraft:e?this.#L(e):{...this.#e.value.planDraft,id:null,name:"",rooms:[],dirty:!1}})}#L(t){return{id:t.id,name:t.name,enabled:t.enabled,runBehavior:t.runBehavior,rooms:(t.roomOrder.length?t.roomOrder.flatMap(e=>{let r=t.rooms.find(o=>o.roomId===e);return r?[r]:[]}):t.rooms).map(e=>({...e})),returnToBase:t.returnToBase,finishCurrentRoom:t.finishCurrentRoom,finishCurrentRoomThreshold:t.finishCurrentRoomThreshold,dirty:!1}}async loadAreas(){let t=this.#e.value.resources.entry;if(!t||!this.#t.current()||!D(this.#e.value))return;let e=L(t),r=this.#l("areas");this.#e.patch({resources:{...this.#e.value.resources,areas:m("loading",null)}});try{let o=await this.#r.areas(t.areasUrl,r.signal),a=this.#e.value.resources.entry;if(!a||L(a)!==e||o.sceneUrl!==a.sceneUrl)return;this.#e.patch({resources:{...this.#e.value.resources,areas:m("ready",o)}}),this.selectArea(o.areas[0]?.id||null)}catch(o){let a=this.#e.value.resources.entry;if(I(o)||!a||L(a)!==e)return;this.#e.patch({resources:{...this.#e.value.resources,areas:m("error",null,F(o,"areas-unavailable"))}})}finally{this.#p("areas",r)}}selectArea(t){let e=this.#e.value.resources.areas.value?.areas.find(o=>o.id===t),r=this.#e.value;this.#e.patch({selection:{...r.selection,areaId:t},areaDraft:e?this.#T(e):{id:null,name:"",cleaningMode:"vacuum",coverageSetting:"standard",status:"new",canRebind:!1,dirty:!1},draw:{...r.draw,circles:e?.circles||[],undo:[],redo:[],dirty:!1,strokeCount:0}})}#T(t){return{id:t.id,name:t.name,cleaningMode:t.cleaningMode,coverageSetting:t.coverageSetting,status:t.status,canRebind:t.canRebind,dirty:!1}}async saveArea(){let t=this.#e.value,e=t.resources.entry,r=t.areaDraft;if(!e||!D(t)||!r.name.trim()||!t.draw.circles.length)return;let o=this.#l("area-mutation");this.#e.patch({command:"pending",notice:{tone:"info",text:"Saving area\u2026"}});try{let a=await this.#r.saveArea(e.areasUrl,{areaId:r.id,name:r.name.trim(),circles:t.draw.circles,cleaningMode:r.cleaningMode,coverageSetting:r.coverageSetting},o.signal);this.#e.patch({command:"idle",notice:{tone:"success",text:"Area saved"}}),await this.loadAreas(),this.selectArea(a)}catch(a){if(I(a))return;this.#e.patch({command:"failed",notice:{tone:"error",text:"Area could not be saved"}})}finally{this.#p("area-mutation",o)}}async deleteArea(){let t=this.#e.value.resources.entry,e=this.#e.value.selection.areaId;if(!t||!e||!D(this.#e.value))return;let r=this.#l("area-mutation");try{await this.#r.deleteArea(t.areasUrl,e,r.signal),this.#e.patch({notice:{tone:"success",text:"Area deleted"}}),await this.loadAreas()}catch(o){I(o)||this.#e.patch({notice:{tone:"error",text:"Area could not be deleted"}})}finally{this.#p("area-mutation",r)}}async savePlan(){let t=this.#e.value,e=t.planDraft,r=t.resources.plans.value;if(!r||!e.name.trim()||!e.rooms.length||!D(t))return;let o=e.rooms;await this.#M("save_plan",{...e.id?{plan_id:e.id}:{},name:e.name.trim(),enabled:e.enabled,run_behavior:e.runBehavior,rooms:o.map(a=>({room:r.rooms.find(i=>i.roomId===a.roomId)?.name,cleaning_mode:a.cleaningMode,coverage_setting:a.coverageSetting})).filter(a=>a.room),return_to_base:e.returnToBase,finish_current_room:e.finishCurrentRoom,finish_current_room_threshold:e.finishCurrentRoomThreshold,select:!e.id||r.selectedPlan===e.id},"Plan saved","Plan could not be saved"),await this.loadPlans()}async deletePlan(){let t=this.#e.value.selection.planId;t&&(await this.#M("delete_plan",{plan:t},"Plan deleted","Plan could not be deleted"),await this.loadPlans())}async executeAction(t){switch(t){case"stop":this.#e.value.resources.entry?.activePlan||this.#e.value.resources.entry?.runnerLocked?await this.#_("matic_robot","stop_intelligent_cleaning",{}):await this.#_("vacuum","return_to_base",{});return;case"resume":await this.#_("vacuum","start",{});return;case"run-plan":{let e=this.#e.value.selection.planId||this.#e.value.resources.plans.value?.selectedPlan;e&&await this.#_("matic_robot","run_selected_plan",{plan:e});return}case"clean-rooms":{let e=this.#e.value.resources.plans.value,r=this.#e.value.selection.roomIds,o=e?.rooms.filter(a=>r.includes(a.roomId)).map(a=>a.name)||[];o.length&&await this.#_("matic_robot","clean",{rooms:o,ordered:!1,cleaning_mode:this.#e.value.selection.cleaningMode,coverage_setting:this.#e.value.selection.coverageSetting});return}case"run-area":{let e=this.#e.value.selection.areaId;e&&await this.#_("matic_robot","clean_area",{area:e});return}case"review-area":this.#e.dispatch({type:"open-workflow",workflow:"areaReview"});return;case"save-area":await this.saveArea();return;case"save-plan":await this.savePlan();return;case"delete-plan":await this.deletePlan();return;case"delete-area":await this.deleteArea();return}}async#M(t,e,r,o){let a=this.#o?.vacuumEntityId;if(!(!a||!D(this.#e.value)||this.#e.value.command==="pending")){this.#e.patch({command:"pending",notice:{tone:"info",text:"Saving\u2026"}});try{await this.#r.service("matic_robot",t,e,a),this.#e.patch({command:"idle",notice:{tone:"success",text:r}})}catch{this.#e.patch({command:"failed",notice:{tone:"error",text:o}})}}}async#_(t,e,r){let o=this.#e.value,a=this.#o?.vacuumEntityId,s=(e==="stop_intelligent_cleaning"||t==="vacuum"&&e==="return_to_base")&&o.command==="idle"&&(o.activity==="cleaning"||o.activity==="paused"||o.activity==="returning");if(!(!a||!s&&!Ie(o))){this.#e.patch({command:"pending",notice:null});try{await this.#r.service(t,e,r,a),this.#e.patch({command:"settling"}),this.#a!==null&&window.clearTimeout(this.#a),this.#a=window.setTimeout(()=>{this.#a=null,this.#e.value.command==="settling"&&this.#e.patch({command:"idle"})},15e3)}catch{this.#e.patch({command:"failed",notice:{tone:"error",text:"The robot did not accept that action"}})}}}updateDraftCircles(t,e=!0,r){this.#e.dispatch({type:"set-draft-circles",circles:t,record:e,...r?{previous:r}:{}}),this.#e.dispatch({type:"patch-area-draft",patch:{dirty:!0}})}dispose(){this.#u||(this.#u=!0,this.#w(),this.#g(),this.#a!==null&&window.clearTimeout(this.#a),this.#a=null,this.#n.dispose(),this.#r.dispose(),this.#t.invalidate())}};var ut=n=>(n.workflow==="none"?0:1)+(n.fullMap?1:0)+(n.precisionOpen?1:0)+(n.dialog?1:0),Dt=n=>{if(!n||typeof n!="object")return null;let t=n.maticMapLayer;if(!t||typeof t!="object")return null;let e=t.owner,r=t.depth;return typeof e=="string"&&Number.isInteger(r)&&Number(r)>=0?{owner:e,depth:Number(r)}:null},ie=class{#e;#t=`matic-map-${crypto.randomUUID?.()||Math.random().toString(36).slice(2)}`;#r=0;#n=null;#s=!1;constructor(t){this.#e=t}start(){this.#n||(this.#r=ut(this.#e.value),this.#n=this.#e.subscribe(t=>this.#o(t)),window.addEventListener("popstate",this.#i))}#o(t){let e=ut(t);if(this.#s){this.#s=!1,this.#r=e;return}if(e>this.#r)for(let r=this.#r+1;r<=e;r+=1){let o=history.state&&typeof history.state=="object"?history.state:{};history.pushState({...o,maticMapLayer:{owner:this.#t,depth:r}},"",window.location.href)}this.#r=e}#i=()=>{this.#r<1||(this.#s=!0,this.#e.dispatch({type:"dismiss-top-layer"}))};dismissTop(){if(this.#r<1)return!1;let t=Dt(history.state);return t?.owner===this.#t&&t.depth===this.#r?history.back():this.#e.dispatch({type:"dismiss-top-layer"}),!0}dispose(){this.#n?.(),this.#n=null,window.removeEventListener("popstate",this.#i),this.#r=0}};var Pe=class extends B{constructor(){super(...arguments);this.narrow=!1;this._workspace=N();this._classic=!1;this.entryOverride=null;this.#e=new ee;this.#t=new Z(this._workspace);this.#r=null;this.#n=null;this.#s=null;this.#o=null;this.#i=null;this.#h=""}static{this.properties={hass:{attribute:!1},narrow:{type:Boolean},route:{attribute:!1},panel:{attribute:!1},_workspace:{state:!0},_classic:{state:!0},entryOverride:{state:!0}}}#e;#t;#r;#n;#s;#o;#i;#h;connectedCallback(){super.connectedCallback(),this._classic=st()==="v3",this.#n=this.#t.subscribe(e=>{this._workspace=e,this.#v(e)}),this._classic||this.#m()}disconnectedCallback(){this.#n?.(),this.#n=null,this.#a(),super.disconnectedCallback()}#m(){this.#o||(this.#s=new re(()=>this.hass),this.#o=new se(this.#t,this.#s),this.#i=new ie(this.#t),this.#i.start(),this.#r&&this.#o.sync(this.#r,this.panel))}#a(){this.#i?.dispose(),this.#i=null,this.#o?.dispose(),this.#o=null,this.#s=null}#v(e){if(!this.#o)return;let r={version:4,view:e.view,appearance:e.appearance,labels:e.labelsVisible,quality:e.quality,cameras:e.cameras},o=JSON.stringify(r);o!==this.#h&&(this.#h=o,this.#o.schedulePreferences(r))}willUpdate(e){if(e.has("hass")||e.has("panel")||e.has("entryOverride")){let r=this.#e.project(this.hass,this.panel,this.entryOverride);if(r!==this.#r){this.#r=r;let o=r.host.connected?r.host.robotCount===0?"unavailable":r.host.administrator?"verifying":"blocked":"degraded";this.#t.replace({...this.#t.value,coherence:o,activity:r.activity,batteryPercent:r.batteryPercent,host:r.host,fullMap:r.host.administrator&&r.host.robotCount>0&&this.#t.value.fullMap,robotLabel:r.robotLabel,robots:r.robots,locale:r.language})}this._classic||this.#o?.sync(r,this.panel)}e.has("narrow")&&this.#t.value.narrowHint!==this.narrow&&this.#t.dispatch({type:"set-narrow-hint",value:this.narrow})}#c(e){if(!Y(e.detail))return;e.stopPropagation();let r=e.detail;if(r.type==="dismiss-top-layer"||r.type==="exit-full-map"){this.#i?.dismissTop()||this.#t.dispatch(r);return}if(r.type==="open-workflow"&&r.workflow!=="none"){this.#o?.openWorkflow(r.workflow);return}if(r.type==="set-floor"){this.#o?.selectFloor(r.floorId);return}if(r.type==="select-entry"){if(!this._workspace.robots.some(o=>o.entryId===r.entryId))return;this.entryOverride=r.entryId;return}if(r.type==="set-history"){this.#o?.selectHistory(r.historyId);return}if(r.type==="select-plan"){this.#o?.selectPlan(r.planId);return}if(r.type==="select-area"){this.#o?.selectArea(r.areaId);return}this.#t.dispatch(r)}#b(e){if(e.stopPropagation(),typeof e.detail?.id=="string"){if(e.detail.id==="use-classic"){xe("v3")&&(this.#a(),this._classic=!0);return}this.#o?.executeAction(e.detail.id),this.dispatchEvent(new CustomEvent("matic-map-v4-action-requested",{detail:{id:e.detail.id},bubbles:!0,composed:!0}))}}#d(){xe("v4")&&(this._classic=!1,this.#m(),this.requestUpdate())}updated(){if(!this._classic)return;let e=this.renderRoot.querySelector("matic-map-panel-v0-3-1");e&&(e.hass=this.hass,e.narrow=this.narrow,e.route=this.route,e.panel=this.panel)}getWorkspaceSnapshot(){return this.#t.value}render(){return this._classic?y`
        <style>
          :host { display: block; block-size: 100%; }
          .classic { position: relative; block-size: 100%; }
          .return-v4 {
            position: absolute;
            z-index: 100;
            inset-block-start: max(0.65rem, env(safe-area-inset-top));
            inset-inline-end: max(0.65rem, env(safe-area-inset-right));
            min-block-size: 2.75rem;
            padding-inline: 0.85rem;
            border: 1px solid var(--divider-color, #c2c8cc);
            border-radius: 1.4rem;
            color: var(--primary-text-color, #263238);
            background: var(--card-background-color, #fff);
            box-shadow: 0 5px 18px rgb(31 41 51 / 18%);
            cursor: pointer;
          }
          matic-map-panel-v0-3-1 { display: block; block-size: 100%; }
        </style>
        <div class="classic">
          <button class="return-v4" type="button" @click=${this.#d}>${H(this.hass?.localize,"v4_use_new","Use Map Studio 0.4")}</button>
          <matic-map-panel-v0-3-1></matic-map-panel-v0-3-1>
        </div>
      `:y`
      <matic-map-shell-v4
        .state=${this._workspace}
        .localize=${this.hass?.localize}
        @matic-workspace-intent=${this.#c}
        @matic-workspace-action=${this.#b}
      ></matic-map-shell-v4>
    `}};customElements.get("matic-map-panel-v0-4-0")||customElements.define("matic-map-panel-v0-4-0",Pe);export{Re as CoherenceMachine,Wt as DRAW_BRUSH_MAX_METERS,Bt as DRAW_BRUSH_MIN_METERS,be as GALLERY_SCENARIOS,ee as HassAdapter,Kt as MAP_PIXELS_PER_METER_AT_100,Ft as MAP_ZOOM_MAX,Ht as MAP_ZOOM_MIN,Pe as MaticMapPanelV4,we as MaticMapStudioGalleryV4,Z as WorkspaceStore,Yt as brushCursorPixels,D as canEditCoordinates,Gt as canShowExactPose,Xt as canShowLiveMap,Ie as canStartMotion,Jt as commandState,ve as createGalleryState,N as initialWorkspaceState,Y as isWorkspaceIntent,Zt as mapScale,Vt as normalizeBrush,qt as normalizeZoom,jt as reduceWorkspace,Te as selectPausedSecondaryAction,Le as selectPrimaryAction};
