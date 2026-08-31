import{A as le,a as Lt,b as Tt,c as Ot,d as Ut,e as $t,f as j,g as zt,h as Dt,i as D,j as Nt,k as K,l as xe,m as Ht,n as Bt,o as $,p as Ae,q as Pe,r as Ce,s as Ft,t as Wt,u as qt,v as X,w as y,x as S,y as N,z as Me}from"./chunks/chunk.js";var H=[{roomId:"room-a",name:"Kitchen",boundary:[[.5,.5],[4,.5],[4,3],[.5,3]]},{roomId:"room-b",name:"Living room",boundary:[[4.2,.5],[8.5,.5],[8.5,3.4],[4.2,3.4]]},{roomId:"room-c",name:"Office",boundary:[[.5,3.2],[3.8,3.2],[3.8,6.5],[.5,6.5]]},{roomId:"room-d",name:"Bedroom",boundary:[[4,3.6],[8.5,3.6],[8.5,6.5],[4,6.5]]}],Ee=()=>{let o=[180,140],t={meters_per_cell:.05,origin_cells:[0,0],span_cells:o,sample_step:1,rooms:H.map(l=>{let c=l.boundary.map(([m,f])=>[m/.05,f/.05]),p=[c.reduce((m,[f])=>m+f,0)/c.length,c.reduce((m,[,f])=>m+f,0)/c.length];return{name:l.name,boundary:c,boundary_closed:!0,center:p}})},e=new TextEncoder().encode(JSON.stringify(t)),r=[];for(let l=10;l<130;l+=2)for(let c=10;c<170;c+=2){let p=c<80?l<65?0:2:l<72?1:3,m=[[185,219,224],[201,211,233],[210,226,194],[232,207,207]][p]||[190,205,215];r.push([c,l,0,...m])}let n=500;for(let l=0;l<n;l+=1){let c=l%4,p=l*7%120,m=c<2?c===0?10:168:10+p,f=c>=2?c===2?10:128:10+p;r.push([m,f,10+l%18,104,122,137])}let a=r.length-n,s=new ArrayBuffer(24+e.byteLength+r.length*8),i=new DataView(s);new Uint8Array(s,0,8).set(new TextEncoder().encode("MATIC3D\0")),i.setUint16(8,1,!0),i.setUint16(10,8,!0),i.setUint32(12,e.byteLength,!0),i.setUint32(16,a,!0),i.setUint32(20,n,!0),new Uint8Array(s,24,e.byteLength).set(e);let u=new DataView(s,24+e.byteLength);return r.forEach(([l=0,c=0,p=0,m=0,f=0,k=0],C)=>{let v=C*8;u.setUint16(v,l,!0),u.setUint16(v+2,c,!0),u.setUint8(v+4,p),u.setUint8(v+5,m),u.setUint8(v+6,f),u.setUint8(v+7,k)}),{buffer:s,pointOffset:24+e.byteLength,floorCount:a,surfaceCount:n,total:r.length,revision:7,etag:'"synthetic-scene"',source:"live",metadata:{metersPerCell:.05,origin:[0,0],span:o,sampleStep:1,rooms:t.rooms.map((l,c)=>({id:H[c]?.roomId||`room-${c}`,name:l.name,boundary:l.boundary,center:l.center}))}}},G=()=>({entryId:"synthetic-entry",sceneUrl:"/api/matic_robot/slam_scene/synthetic",deltaUrl:"/api/matic_robot/slam_delta/synthetic",poseUrl:"/api/matic_robot/slam_pose/synthetic",historyUrl:"/api/matic_robot/slam_history/synthetic",areasUrl:"/api/matic_robot/areas/synthetic",plansUrl:"/api/matic_robot/plans/synthetic",mapRevision:7,mapFloorCoherent:!0,mapSessionVerified:!0,mapBlockReason:null,runnerLocked:!1,stopSettlePending:!1,activePlan:!1,nativeReconciliationPending:!1,nativeSessionActive:!1,mapComplete:!0,mapTruncated:!1,selectedFloorOrdinal:1,mapFloorOrdinal:1,historyCount:2,historyFloorCount:2,health:"ready",streamFailures:0,bootstrapState:"complete",bootstrapPhotoSeen:!0,bootstrapStructureSeen:!0,bootstrapFailures:0}),ce=()=>({rooms:H.map(({roomId:o,name:t})=>({roomId:o,name:t})),selectedPlan:"daily",plans:[{id:"daily",name:"Daily clean",enabled:!0,runBehavior:"intelligent",rooms:H.slice(0,3).map(({roomId:o})=>({roomId:o,cleaningMode:"vacuum",coverageSetting:"standard"})),roomOrder:H.slice(0,3).map(({roomId:o})=>o),returnToBase:!0,finishCurrentRoom:!1,finishCurrentRoomThreshold:50}]}),de=()=>({sceneUrl:G().sceneUrl,rooms:H.map(o=>({...o,boundary:o.boundary.map(t=>[...t])})),areas:[{id:"entryway",name:"Entryway",circles:[{x:1.5,y:1.4,radius:.3},{x:1.9,y:1.6,radius:.3}],cleaningMode:"vacuum",coverageSetting:"standard",status:"current",canRebind:!1}]}),Re=()=>({entryId:"synthetic-entry",liveAvailable:!0,floors:[{id:"current",active:!0,readOnly:!1,liveAvailable:!0,label:"House",ordinal:null,snapshots:[{id:"current-old",createdAt:"2026-08-29T14:00:00Z",revision:6,pointCount:5300,sceneUrl:"/synthetic-history-current-old"},{id:"current-new",createdAt:"2026-08-29T16:12:00Z",revision:7,pointCount:5300,sceneUrl:"/synthetic-history-current-new"}]},{id:"saved-1",active:!1,readOnly:!0,liveAvailable:!1,label:"Shed",ordinal:2,snapshots:[{id:"saved-one",createdAt:"2026-08-28T11:30:00Z",revision:3,pointCount:3100,sceneUrl:"/synthetic-history-saved"}]}]}),Ie=()=>({position:[92,74],source:"latest_pose",revision:7,poseRevision:4,floorCoherent:!0,freshness:"live"});var it=()=>({...D(),coherence:"current",activity:"docked",batteryPercent:92,host:{connected:!0,administrator:!0,robotConnected:!0,robotCount:1},floor:{classifiedCount:2,displayName:"House",readOnly:!1},map:{available:!0,complete:!0,floorCoherent:!0,sessionVerified:!0,exactPose:!0},resources:{catalog:{status:"ready",value:[G()],problem:null},entry:G(),scene:{status:"ready",value:Ee(),problem:null},pose:{status:"ready",value:Ie(),problem:null},history:{status:"ready",value:Re(),problem:null},plans:{status:"ready",value:ce(),problem:null},areas:{status:"ready",value:de(),problem:null}},selection:{...D().selection,entryId:"synthetic-entry",planId:"daily"},planDraft:{...D().planDraft,id:"daily",name:"Daily clean",rooms:ce().plans[0]?.rooms||[]}}),ue=o=>{let t=it();switch(o){case"ready":return t;case"cleaning":return{...t,activity:"cleaning"};case"paused":return{...t,activity:"paused"};case"returning":return{...t,activity:"returning"};case"rooms":return{...t,workflow:"rooms"};case"draw":return{...t,workflow:"draw",areaDraft:{...t.areaDraft,id:"entryway",name:"Entryway",status:"current"},selection:{...t.selection,areaId:"entryway"},draw:{...t.draw,dirty:!0,strokeCount:3,circles:de().areas[0]?.circles||[]}};case"history":return{...t,dataMode:"history",workflow:"history",floor:{...t.floor,readOnly:!0},map:{...t.map,exactPose:!1},selection:{...t.selection,floorId:"saved-1",historyId:"saved-one"}};case"transition":return{...t,coherence:"verifying",activity:"unknown",map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1}};case"problem":return{...t,activity:"problem",coherence:"blocked"};case"ha-offline":return{...t,coherence:"degraded",host:{...t.host,connected:!1},map:{...t.map,exactPose:!1}};case"robot-offline":return{...t,coherence:"degraded",host:{...t.host,robotConnected:!1},map:{...t.map,exactPose:!1}};case"access":return{...t,coherence:"blocked",host:{...t.host,administrator:!1},map:{...t.map,available:!1,exactPose:!1}};case"empty":return{...t,coherence:"unavailable",host:{...t.host,robotConnected:!1,robotCount:0},map:{...t.map,available:!1,exactPose:!1}};case"unsupported":return{...t,coherence:"blocked",map:{...t.map,available:!1,exactPose:!1}};case"multi-robot":return{...t,host:{...t.host,robotCount:2}}}},pe=["ready","cleaning","paused","returning","rooms","draw","history","transition","problem","ha-offline","robot-offline","access","empty","unsupported","multi-robot"];var st=o=>{switch(o){case"cleaning":return"cleaning";case"paused":return"paused";case"returning":return"returning";case"docked":return"docked";case"idle":return"idle";case"error":return"problem";default:return"unknown"}},lt=o=>typeof o!="number"||!Number.isFinite(o)?null:Math.round(Math.max(0,Math.min(100,o))),ct=o=>{let t=o.attributes?.matic_entry_id;return typeof t=="string"&&t.length>0?t:null},dt=o=>String(o||"local-user").replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",ut=o=>{if(typeof o!="string")return"Matic robot";let t=o.trim();return t&&Array.from(t).length<=128&&!/[\u0000-\u001f\u007f]/u.test(t)?t:"Matic robot"},Y=class{#e="";#t=null;project(t,e){let r=t?.states??{},n=e?.config?.entry_id,a=typeof n=="string"?n:null,s=new Set,i=null,u=null,l=null;for(let[_,R]of Object.entries(r)){let w=ct(R);w&&(s.add(w),_.startsWith("vacuum.")&&(!i||a&&w===a)&&(i=R,u=_,l=w))}let c={connected:t?.connected!==!1,administrator:t?.user?.is_admin===!0,robotConnected:i!==null&&i.state!=="unavailable"&&i.state!=="unknown",robotCount:s.size},p=i?st(i.state):"unknown",m=lt(i?.attributes?.battery_level),f=t?.selectedLanguage||t?.language||"en",k=dt(t?.user?.id),C=ut(i?.attributes?.friendly_name),v=[c.connected,c.administrator,c.robotConnected,c.robotCount,p,m??"none",f,k,u??"none",l??"none",C].join("|");return v===this.#e&&this.#t?this.#t:(this.#e=v,this.#t={host:c,activity:p,batteryPercent:m,language:f,userKey:k,vacuumEntityId:u,entryKey:l,robotLabel:C},this.#t)}};var pt=o=>{if(!o.host.connected)return{title:"Reconnecting",detail:"Home Assistant is offline"};if(!o.host.administrator)return{title:"Access required",detail:"Administrator only"};if(o.host.robotCount===0)return{title:"No robot",detail:"Set up a Matic robot"};if(!o.host.robotConnected)return{title:"Robot offline",detail:"Last verified map \xB7 read only"};if(o.activity==="problem")return{title:"Needs attention",detail:"Check the robot"};if(o.dataMode==="history"){let e=o.resources.history.value?.floors.find(a=>a.id===o.selection.floorId),r=e?.snapshots.findIndex(a=>a.id===o.selection.historyId)??-1,n=e?.snapshots.length??0;return{title:"Saved map",detail:r>=0?`Read only \xB7 ${r+1} of ${n}`:"Read only"}}if(o.coherence==="verifying"||o.coherence==="booting")return{title:"Locating",detail:"Finding the current map"};if(o.activity==="cleaning")return{title:"Cleaning",detail:"Cleaning in progress"};if(o.activity==="paused")return{title:"Paused",detail:"Cleaning can resume"};if(o.activity==="returning")return{title:"Returning",detail:"Going to the dock"};if(o.activity==="stopping")return{title:"Stopping",detail:"Waiting for the robot"};let t=o.batteryPercent===null?"Ready":`${o.batteryPercent}% battery`;return{title:o.activity==="docked"?"Docked":"Ready",detail:t}},ht=o=>{switch(o.workflow){case"rooms":return{title:"Choose rooms",description:"Select on the map or from the list."};case"draw":return{title:"Draw an area",description:"Paint on the verified map, then review the details."};case"plan":return{title:"Plan",description:"Review rooms and cleaning settings."};case"areaReview":return{title:"Area details",description:"Name the area and choose cleaning settings."};case"history":return{title:"Map history",description:"Saved maps are floor-scoped and read only."};case"support":return{title:"Map support",description:"Private geometry is never included."};case"none":return{title:"Clean",description:"Start with a saved plan, rooms, or an area."}}},mt=o=>{switch(o){case"discardDraft":return{title:"Discard this area?",detail:"The outline has not been saved. You can keep drawing or discard it.",cancelLabel:"Keep drawing",confirmLabel:"Discard",action:"discard"};case"confirmDeletePlan":return{title:"Delete this plan?",detail:"This removes the saved plan from Home Assistant. The robot will not move.",cancelLabel:"Cancel",confirmLabel:"Delete plan",action:"delete-plan"};case"confirmDeleteArea":return{title:"Delete this area?",detail:"This removes the saved outline from Home Assistant. The robot will not move.",cancelLabel:"Cancel",confirmLabel:"Delete area",action:"delete-area"};case"confirmStop":return{title:"Stop cleaning?",detail:"The robot may take a moment to settle before another action is available.",cancelLabel:"Keep cleaning",confirmLabel:"Stop",action:"stop"};case"error":return{title:"Something went wrong",detail:"No action was started. Close this message and try again when the map is ready.",cancelLabel:"Close",confirmLabel:"Close",action:null};case null:return null}},ft=(o=document)=>{let t=o.activeElement;for(;t?.shadowRoot?.activeElement;)t=t.shadowRoot.activeElement;return t},he=class extends N{constructor(){super(...arguments);this._measuredNarrow=!1;this._sheetOffset=0;this._workflowReady=!1;this._overflowOpen=!1;this._sheetDetent="peek";this.#e=null;this.#t=null;this.#r=null;this.#o=null;this.#a=null;this.#n=null;this.#l=e=>{if(!this._overflowOpen)return;let r=this.renderRoot.querySelector(".overflow-wrap");(!r||!e.composedPath().includes(r))&&(this._overflowOpen=!1)}}static{this.properties={state:{attribute:!1},_measuredNarrow:{state:!0},_sheetOffset:{state:!0},_workflowReady:{state:!0},_overflowOpen:{state:!0},_sheetDetent:{state:!0}}}static{this.styles=X`
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
  `}#e;#t;#r;#o;#a;#n;#l;connectedCallback(){super.connectedCallback(),this.#e=new ResizeObserver(([e])=>{if(!e)return;let r=e.contentRect.width<768||e.contentRect.height<480;r!==this._measuredNarrow&&(this._measuredNarrow=r)}),this.#e.observe(this),window.addEventListener("pointerdown",this.#l,!0),this.#t=new ResizeObserver(([e])=>{if(!e)return;let r=Math.ceil(e.target.getBoundingClientRect().height);r!==this._sheetOffset&&(this._sheetOffset=r)})}disconnectedCallback(){this.#e?.disconnect(),this.#e=null,this.#t?.disconnect(),this.#t=null,this.#r=null,window.removeEventListener("pointerdown",this.#l,!0),super.disconnectedCallback()}updated(e){let r=this.renderRoot.querySelector(".mobile-sheet");if(r!==this.#r&&(this.#t?.disconnect(),this.#r=r,r&&this.#t?.observe(r)),e.has("state")){let n=e.get("state");n?.precisionOpen&&!this.state.precisionOpen&&this.#o?.focus(),!n?.dialog&&this.state.dialog?(this.#a=ft(this.shadowRoot||document),this.updateComplete.then(()=>{this.renderRoot.querySelector(".dialog button")?.focus()})):n?.dialog&&!this.state.dialog&&(this.#a?.focus(),this.#a=null),this.state.workflow!=="none"&&!this._workflowReady&&import("./chunks/workflow-panel.js").then(()=>{this._workflowReady=!0}),(!n||n.workflow!==this.state.workflow)&&(this._sheetDetent=this.state.workflow==="none"?"peek":"half")}}#i(e){this.dispatchEvent(new CustomEvent(Me,{detail:e,bubbles:!0,composed:!0}))}#h(e){if(e.enabled){if(e.id==="return-live"){this.#i({type:"set-history",historyId:null});return}this.#m(e.id)}}#s(e){if(this.state.workflow==="draw"&&this.state.draw.dirty&&e!=="draw"&&e!=="areaReview"){this.#n=e,this.#i({type:"open-dialog",dialog:"discardDraft"});return}this.#i({type:"open-workflow",workflow:e})}#y(){let e=this.#n;this.#n=null,this.#i({type:"discard-draft"}),e&&queueMicrotask(()=>this.#i({type:"open-workflow",workflow:e}))}#u(){this.#n=null,this.#i({type:"dismiss-top-layer"})}#m(e){this.dispatchEvent(new CustomEvent(le,{detail:{id:e},bubbles:!0,composed:!0}))}#v(e){this.#i({type:"dismiss-top-layer"}),this.#m(e)}#p(e){if(e.action==="discard"){this.#y();return}if(e.action==="delete-plan"||e.action==="delete-area"){this.#v(e.action);return}this.#i({type:"dismiss-top-layer"}),e.action==="stop"&&this.#m("stop")}#S(){this._sheetDetent=this._sheetDetent==="peek"?"half":this._sheetDetent==="half"?"full":"peek"}#w(){if(this.state.precisionOpen||this.state.fullMap){this.#i({type:"dismiss-top-layer"});return}if(this.state.workflow!=="none"){this.#s("none");return}this.#d()}#d(){this.dispatchEvent(new CustomEvent("hass-toggle-menu",{bubbles:!0,composed:!0}))}#c(e){if(this._overflowOpen=!1,e==="support"){this.#s("support");return}this.dispatchEvent(new CustomEvent(le,{detail:{id:"use-classic"},bubbles:!0,composed:!0}))}#b(e){this.#o=e.currentTarget,this.#i({type:"set-precision-open",value:!this.state.precisionOpen})}#k(e){if(!(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey)&&e.key==="Escape"){if(e.preventDefault(),this._overflowOpen){this._overflowOpen=!1;return}this.#i({type:"dismiss-top-layer"})}}#x(e){if(e.key!=="Tab")return;let r=[...this.renderRoot.querySelectorAll(".dialog button:not(:disabled)")],n=r[0],a=r.at(-1);!n||!a||(e.shiftKey&&this.shadowRoot?.activeElement===n?(e.preventDefault(),a.focus()):!e.shiftKey&&this.shadowRoot?.activeElement===a&&(e.preventDefault(),n.focus()))}#f(e,r="primary-action"){return y`
      <button
        class=${`${r} ${e.kind==="danger"?"danger":""}`}
        type="button"
        ?disabled=${!e.enabled}
        title=${e.reason??""}
        @click=${()=>this.#h(e)}
      >${e.label}</button>
    `}#_(e){return e.workflow==="none"?y`
      <div class="quick-actions">
        <button type="button" @click=${()=>this.#s("rooms")}>Rooms</button>
        <button type="button" @click=${()=>this.#s("draw")}>Draw area</button>
        <button type="button" @click=${()=>this.#s("plan")}>Plans</button>
        <button type="button" @click=${()=>this.#s("history")}>History</button>
      </div>
    `:this._workflowReady?y`<matic-map-workflow-v4 .state=${e}></matic-map-workflow-v4>`:y`<div role="status">Loading workspace…</div>`}render(){let e=this.state,r=e.narrowHint||this._measuredNarrow,n=pt(e),a=ht(e),s=Pe({...e,narrowHint:r}),i=Ce(e),u=e.workflow==="draw"&&(r||e.fullMap),l=e.fullMap&&(e.coherence==="verifying"||e.coherence==="booting"),c=e.workflow!=="none"||e.fullMap||e.precisionOpen,p=mt(e.dialog);return y`
      <div class=${`root ${r?"narrow":"wide"}`} @keydown=${this.#k}>
        <div class="app">
          <header class="app-bar">
            <button
              class="nav"
              type="button"
              aria-label=${c?"Back":"Open navigation"}
              @click=${this.#w}
            >${c?"\u2190":"\u2630"}</button>
            <h1 class="title">Matic Map</h1>
            ${e.host.robotCount>1?y`
              <button class="robot-switcher" type="button">${e.robotLabel} ▾</button>
            `:S}
            <span class="spacer"></span>
            <span class="header-state">${n.title}</span>
            <div class="overflow-wrap">
              <button
                class="overflow"
                type="button"
                aria-label="More map options"
                aria-expanded=${String(this._overflowOpen)}
                @click=${()=>{this._overflowOpen=!this._overflowOpen}}
              >⋮</button>
              ${this._overflowOpen?y`
                <div class="overflow-menu" role="menu">
                  <button role="menuitem" type="button" @click=${()=>this.#c("support")}>Map support</button>
                  <button role="menuitem" type="button" @click=${()=>this.#c("classic")}>Use classic Map Studio</button>
                </div>
              `:S}
            </div>
          </header>

          <main class=${`workspace ${e.fullMap?"full-map":""}`}>
            <div class="canvas">
              <matic-map-canvas-v4
                style=${r&&!e.fullMap?`--map-sheet-offset:${this._sheetOffset}px`:"--map-sheet-offset:0px"}
                .state=${e}
              ></matic-map-canvas-v4>
            </div>

            ${u?y`
              <div class="precision-popover">
                <button
                  class="precision-chip"
                  type="button"
                  aria-expanded=${String(e.precisionOpen)}
                  @click=${this.#b}
                >${e.draw.zoomPercent}% · ${e.draw.brushMeters.toFixed(2)} m</button>
                ${e.precisionOpen?y`
                  <matic-precision-controls-v4 compact .state=${e}></matic-precision-controls-v4>
                `:S}
              </div>
            `:S}

            <aside class="inspector" aria-label="Map workspace">
              <div class="status-strip">
                <span class="status-icon" aria-hidden="true">◆</span>
                <span><strong>${n.title}</strong><small>${n.detail}</small></span>
              </div>
              <section class="workflow">
                <h2 tabindex="-1">${a.title}</h2>
                <p>${a.description}</p>
                ${this.#_(e)}
                <div class="primary-stack">
                  ${this.#f(s)}
                  ${i?this.#f(i,"secondary-action"):S}
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
                aria-label=${`Map workspace, ${this._sheetDetent} height`}
                aria-expanded=${String(this._sheetDetent!=="peek")}
                @click=${this.#S}
              >
                <span class="sheet-handle" aria-hidden="true"></span>
                <span class="sheet-title">${a.title}</span>
                <span class="sheet-description">${a.description}</span>
              </button>
              <div class="sheet-body">
                ${e.workflow==="draw"?S:this.#_(e)}
              </div>
              <div class="primary-stack">
                ${this.#f(s)}
                ${i?this.#f(i,"secondary-action"):S}
              </div>
            </section>

            ${e.fullMap?y`
              <section
                class=${`full-map-hud ${i?"has-secondary":""}`}
                aria-label="Robot status and action"
              >
                <span class="hud-copy"><strong>${n.title}</strong><small>${n.detail}</small></span>
                ${l?S:this.#f(s)}
                ${!l&&i?this.#f(i,"secondary-action"):S}
              </section>
            `:S}
          </main>
        </div>

        ${p?y`
          <div class="dialog-backdrop">
            <section
              class="dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="dialog-title"
              @keydown=${this.#x}
            >
              <h2 id="dialog-title">${p.title}</h2>
              <p>${p.detail}</p>
              <div class="dialog-actions">
                <button
                  type="button"
                  @click=${e.dialog==="discardDraft"?this.#u:()=>this.#i({type:"dismiss-top-layer"})}
                >${p.cancelLabel}</button>
                ${p.action===null?S:y`
                  <button
                    class="discard"
                    type="button"
                    @click=${()=>this.#p(p)}
                  >${p.confirmLabel}</button>
                `}
              </div>
            </section>
          </div>
        `:S}
      </div>
    `}};customElements.get("matic-map-shell-v4")||customElements.define("matic-map-shell-v4",he);var me=class extends N{constructor(){super(...arguments);this.scenario="ready";this.narrow=!1;this.controls=!0;this._workspace=ue("ready");this.#e=new K(this._workspace);this.#t=null}static{this.properties={scenario:{type:String,reflect:!0},narrow:{type:Boolean,reflect:!0},controls:{type:Boolean,reflect:!0},_workspace:{state:!0}}}static{this.styles=X`
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
  `}#e;#t;connectedCallback(){super.connectedCallback(),this.#t=this.#e.subscribe(e=>{this._workspace=e})}disconnectedCallback(){this.#t?.(),this.#t=null,super.disconnectedCallback()}willUpdate(e){e.has("scenario")?this.#e.replace({...ue(this.scenario),narrowHint:this.narrow}):e.has("narrow")&&this.#e.dispatch({type:"set-narrow-hint",value:this.narrow})}setScenario(e){pe.includes(e)&&(this.scenario=e)}getWorkspaceSnapshot(){return structuredClone(this.#e.value)}replaceWorkspaceState(e){this.#e.replace(structuredClone(e))}#r(e){j(e.detail)&&(e.stopPropagation(),this.#e.dispatch(e.detail))}render(){return y`
      ${this.controls?y`
        <nav class="gallery-controls" aria-label="Map Studio states">
          ${pe.map(e=>y`
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
    `}};customElements.get("matic-map-studio-gallery-v0-4-0")||customElements.define("matic-map-studio-gallery-v0-4-0",me);var Le="/api/matic_robot/slam_entries";var d=class extends Error{constructor(t){super(t),this.name="ContractError",this.code=t}},x=(o,t)=>{if(!o||typeof o!="object"||Array.isArray(o))throw new d(t);return o},g=(o,t,e)=>{if(typeof o!="string")throw new d(e);let r=o.trim();if(!r||Array.from(r).length>t||/[\u0000-\u001f\u007f]/u.test(r))throw new d(e);return r},yt=o=>{if(o==null||o==="")return null;try{return g(o,128,"invalid-floor-label")}catch{return null}},B=(o,t,e,r)=>{if(typeof o!="number"||!Number.isFinite(o)||o<t||o>e)throw new d(r);return o},M=(o,t,e,r)=>{let n=B(o,t,e,r);if(!Number.isInteger(n))throw new d(r);return n},fe=(o,t)=>o==null?null:M(o,1,t,"invalid-floor-ordinal"),b=(o,t)=>{if(typeof o!="boolean")throw new d(t);return o},bt=(o,t)=>o===null?null:b(o,t),vt=o=>{if(o==null)return null;if(o==="bootstrap_empty"||o==="map_session_unverified"||o==="floor_plan_unavailable"||o==="floor_plan_mismatch")return o;throw new d("invalid-map-block-reason")},gt=o=>{if(o===void 0)return"not_started";if(o==="not_started"||o==="running"||o==="complete"||o==="partial"||o==="failed")return o;throw new d("invalid-bootstrap-state")},I=(o,t)=>{let e=g(o,512,t);if(!e.startsWith("/")||e.startsWith("//")||e.includes("\\"))throw new d(t);return e},wt=o=>{let t=typeof o.map_health=="string"?o.map_health.toLowerCase():"",e=typeof o.stream_state=="string"?o.stream_state.toLowerCase():"",r=typeof o.invalid_tiles=="number"?o.invalid_tiles:0;return t.includes("error")||t.includes("fail")||t.includes("degrad")||r>0?"problem":o.map_truncated===!0||t.includes("truncat")||t.includes("limit")?"limited":o.map_complete===!0?"ready":e.includes("connect")||e.includes("collect")||e.includes("run")?"building":"unknown"},Te=o=>{let t=x(o,"invalid-catalog");if(!Array.isArray(t.entries)||t.entries.length>64)throw new d("invalid-catalog-entries");return t.entries.map(e=>{let r=x(e,"invalid-catalog-entry"),n=M(r.map_revision,0,Number.MAX_SAFE_INTEGER,"invalid-map-revision");return{entryId:g(r.entry_id,128,"invalid-entry-id"),sceneUrl:I(r.scene_url,"invalid-scene-url"),deltaUrl:r.delta_url===void 0||r.delta_url===null?null:I(r.delta_url,"invalid-delta-url"),poseUrl:I(r.pose_url,"invalid-pose-url"),historyUrl:I(r.history_url,"invalid-history-url"),areasUrl:I(r.areas_url,"invalid-areas-url"),plansUrl:I(r.plans_url,"invalid-plans-url"),mapRevision:n,mapFloorCoherent:b(r.map_floor_coherent,"invalid-floor-coherence"),mapSessionVerified:b(r.map_session_verified,"invalid-session-state"),mapBlockReason:vt(r.map_block_reason),runnerLocked:b(r.runner_locked,"invalid-runner-lock"),stopSettlePending:b(r.stop_settle_pending,"invalid-stop-settle"),activePlan:b(r.active_plan,"invalid-active-plan"),nativeReconciliationPending:b(r.native_reconciliation_pending,"invalid-native-reconciliation"),nativeSessionActive:bt(r.native_session_active,"invalid-native-session"),mapComplete:b(r.map_complete,"invalid-map-complete"),mapTruncated:b(r.map_truncated,"invalid-map-truncated"),selectedFloorOrdinal:fe(r.selected_floor_ordinal,128),mapFloorOrdinal:fe(r.map_floor_ordinal,128),historyCount:M(r.history_count,0,12,"invalid-history-count"),historyFloorCount:M(r.history_floor_count,0,128,"invalid-floor-count"),health:wt(r),streamFailures:M(r.stream_failures,0,Number.MAX_SAFE_INTEGER,"invalid-stream-failures"),bootstrapState:gt(r.bootstrap_state),bootstrapPhotoSeen:r.bootstrap_photo_seen===void 0?!1:b(r.bootstrap_photo_seen,"invalid-bootstrap-photo"),bootstrapStructureSeen:r.bootstrap_structure_seen===void 0?!1:b(r.bootstrap_structure_seen,"invalid-bootstrap-structure"),bootstrapFailures:r.bootstrap_failures===void 0?0:M(r.bootstrap_failures,0,2,"invalid-bootstrap-failures")}})},Oe=(o,t)=>{if(!Array.isArray(o)||o.length!==2)throw new d(t);return[B(o[0],-1e6,1e6,t),B(o[1],-1e6,1e6,t)]},kt=(o,t)=>{if(!Array.isArray(o)||o.length<3||o.length>8192)throw new d(t);return o.map(e=>Oe(e,t))},Ue=(o,t)=>{if(!Array.isArray(o)||o.length>256)throw new d("invalid-rooms");return o.map(e=>{let r=x(e,"invalid-room");return{roomId:g(r.room_id,128,"invalid-room-id"),name:g(r.name,128,"invalid-room-name"),boundary:t?kt(r.boundary,"invalid-room-boundary"):[]}})},_t=o=>{let t=x(o,"invalid-history-snapshot"),e=g(t.created_at,64,"invalid-history-time");if(!Number.isFinite(Date.parse(e)))throw new d("invalid-history-time");return{id:g(t.id,128,"invalid-history-id"),createdAt:e,revision:M(t.revision,0,Number.MAX_SAFE_INTEGER,"invalid-history-revision"),pointCount:M(t.point_count,1,15e5,"invalid-history-points"),sceneUrl:I(t.scene_url,"invalid-history-scene-url")}},$e=o=>{let t=x(o,"invalid-history");if(!Array.isArray(t.floors)||t.floors.length<1||t.floors.length>128)throw new d("invalid-history-floors");return{entryId:g(t.entry_id,128,"invalid-history-entry"),liveAvailable:b(t.live_available,"invalid-history-live"),floors:t.floors.map(e=>{let r=x(e,"invalid-history-floor");if(!Array.isArray(r.snapshots)||r.snapshots.length>12)throw new d("invalid-history-snapshots");return{id:g(r.id,128,"invalid-history-floor-id"),active:b(r.active,"invalid-history-floor-active"),readOnly:b(r.read_only,"invalid-history-floor-read-only"),liveAvailable:r.live_available===void 0?!1:b(r.live_available,"invalid-history-floor-live"),label:yt(r.label),ordinal:r.ordinal===void 0?null:fe(r.ordinal,128),snapshots:r.snapshots.map(_t)}})}},ze=o=>{if(o==="vacuum"||o==="mop"||o==="vacuum_and_mop")return o;throw new d("invalid-cleaning-mode")},De=o=>{if(o==="quick"||o==="standard"||o==="heavy_duty")return o;throw new d("invalid-coverage-setting")},St=o=>{let t=x(o,"invalid-area-circle");return{x:B(t.x,-1e6,1e6,"invalid-area-circle"),y:B(t.y,-1e6,1e6,"invalid-area-circle"),radius:B(t.radius,.05,2.5,"invalid-area-circle")}},xt=o=>o==="current"||o==="review"||o==="stale"?o:"unknown",Ne=o=>{let t=x(o,"invalid-areas");if(!Array.isArray(t.areas)||t.areas.length>256)throw new d("invalid-area-list");return{sceneUrl:I(t.scene_url,"invalid-area-scene-url"),rooms:Ue(t.rooms,!0),areas:t.areas.map(e=>{let r=x(e,"invalid-area");if(!Array.isArray(r.circles)||r.circles.length>512)throw new d("invalid-area-circles");return{id:g(r.id,128,"invalid-area-id"),name:g(r.name,128,"invalid-area-name"),circles:r.circles.map(St),cleaningMode:ze(r.cleaning_mode),coverageSetting:De(r.coverage_setting),status:xt(r.status),canRebind:b(r.can_rebind,"invalid-area-rebind")}})}},He=o=>{let t=x(o,"invalid-plans");if(!Array.isArray(t.plans)||t.plans.length>256)throw new d("invalid-plan-list");return{rooms:Ue(t.rooms,!1).map(({roomId:r,name:n})=>({roomId:r,name:n})),selectedPlan:t.selected_plan===null||t.selected_plan===void 0?null:g(t.selected_plan,128,"invalid-selected-plan"),plans:t.plans.map(r=>{let n=x(r,"invalid-plan");if(!Array.isArray(n.rooms)||n.rooms.length>256||!Array.isArray(n.room_order))throw new d("invalid-plan-rooms");let a=n.run_behavior;if(a!=="intelligent"&&a!=="ordered")throw new d("invalid-run-behavior");return{id:g(n.id,128,"invalid-plan-id"),name:g(n.name,128,"invalid-plan-name"),enabled:b(n.enabled,"invalid-plan-enabled"),runBehavior:a,rooms:n.rooms.map(s=>{let i=x(s,"invalid-plan-room");return{roomId:g(i.room_id,128,"invalid-plan-room-id"),cleaningMode:ze(i.cleaning_mode),coverageSetting:De(i.coverage_setting)}}),roomOrder:n.room_order.slice(0,256).map(s=>g(s,128,"invalid-room-order")),returnToBase:b(n.return_to_base,"invalid-return-to-base"),finishCurrentRoom:b(n.finish_current_room,"invalid-finish-room"),finishCurrentRoomThreshold:M(n.finish_current_room_threshold,0,100,"invalid-finish-threshold")}})}},Be=o=>{let t=x(o,"invalid-pose"),e=t.position,r=e===null?null:Oe(e,"invalid-pose-position"),n=t.pose_freshness;if(n!=="live"&&n!=="coordinator_fallback")throw new d("invalid-pose-freshness");return{position:r,source:g(t.source,64,"invalid-pose-source"),revision:M(t.revision,0,Number.MAX_SAFE_INTEGER,"invalid-pose-revision"),poseRevision:M(t.pose_revision,0,Number.MAX_SAFE_INTEGER,"invalid-pose-sequence"),floorCoherent:b(t.map_floor_coherent,"invalid-pose-floor"),freshness:n}},Fe=o=>{try{return I(o,"invalid-private-path"),!0}catch{return!1}};var We=o=>{let a=()=>{throw new Error("invalid-scene")};(!(o instanceof ArrayBuffer)||o.byteLength<24||o.byteLength>16777216)&&a();let s=new DataView(o),i=new Uint8Array(o,0,8),u=String.fromCharCode(...i),l=s.getUint16(8,!0),c=s.getUint16(10,!0),p=s.getUint32(12,!0),m=s.getUint32(16,!0),f=s.getUint32(20,!0),k=m+f,C=24+p;(u!=="MATIC3D\0"||l!==1||c!==8||p>1024*1024||k<1||k>15e5||C+k*c!==o.byteLength)&&a();let v;try{v=JSON.parse(new TextDecoder("utf-8",{fatal:!0}).decode(new Uint8Array(o,24,p)))}catch{a()}(!v||typeof v!="object"||Array.isArray(v))&&a();let _=v,R=_.meters_per_cell,w=_.origin_cells,O=_.span_cells;(typeof R!="number"||!Number.isFinite(R)||R<.001||R>.1||!Array.isArray(w)||w.length!==2||!w.every(A=>typeof A=="number"&&Number.isFinite(A))||!Array.isArray(O)||O.length!==2||!O.every(A=>typeof A=="number"&&Number.isFinite(A)&&A>=1&&A<=65536))&&a();let ot=(Array.isArray(_.rooms)?_.rooms.slice(0,128):[]).flatMap((A,at)=>{if(!A||typeof A!="object"||Array.isArray(A))return[];let U=A,V=typeof U.name=="string"?U.name.trim():"";if(!V||Array.from(V).length>128||/[\u0000-\u001f\u007f]/u.test(V))return[];if(!Array.isArray(U.boundary)||U.boundary.length<3||U.boundary.length>8192)return[];let Se=U.boundary.flatMap(ae=>{if(!Array.isArray(ae)||ae.length!==2)return[];let[ie,se]=ae;return typeof ie=="number"&&Number.isFinite(ie)&&typeof se=="number"&&Number.isFinite(se)?[[ie,se]]:[]}),re=U.center;if(Se.length<3||!Array.isArray(re)||re.length!==2)return[];let[oe,ne]=re;return typeof oe!="number"||!Number.isFinite(oe)||typeof ne!="number"||!Number.isFinite(ne)?[]:[{id:`scene-room-${at+1}`,name:V,boundary:Se,center:[oe,ne]}]}),nt=typeof _.sample_step=="number"&&Number.isInteger(_.sample_step)?Math.max(1,Math.min(15e5,_.sample_step)):1,ke=w,_e=O;return{buffer:o,pointOffset:C,floorCount:m,surfaceCount:f,total:k,metadata:{metersPerCell:R,origin:[ke[0],ke[1]],span:[_e[0],_e[1]],sampleStep:nt,rooms:ot}}},Mt=o=>{if(o.byteLength>16777216||o.byteLength<24||!1||!1)throw new d("invalid-scene");try{return We(o)}catch{throw new d("invalid-scene")}},Et=()=>`
  const parseTransfer = ${We.toString()};
  self.onmessage = (event) => {
    const { id, buffer } = event.data;
    try {
      const parsed = parseTransfer(buffer);
      self.postMessage({ id, ok: true, parsed }, [parsed.buffer]);
    } catch (_) {
      self.postMessage({ id, ok: false, problem: "invalid-scene" });
    }
  };
`,Z=class{#e=null;#t=null;#r=0;#o=new Map;constructor(){if(!(typeof Worker!="function"||typeof URL?.createObjectURL!="function"))try{this.#t=URL.createObjectURL(new Blob([Et()],{type:"text/javascript"})),this.#e=new Worker(this.#t),this.#e.onmessage=t=>{let e=this.#o.get(t.data.id);e&&(this.#o.delete(t.data.id),t.data.ok&&t.data.parsed?e.resolve(t.data.parsed):e.reject(new d(t.data.problem||"invalid-scene")))},this.#e.onerror=()=>this.#a("scene-worker-failed")}catch{this.#e=null,this.#t&&URL.revokeObjectURL(this.#t),this.#t=null}}async parse(t,e){if(e?.aborted)throw new DOMException("Aborted","AbortError");if(!this.#e){if(await new Promise(n=>window.setTimeout(n,0)),e?.aborted)throw new DOMException("Aborted","AbortError");return Mt(t)}let r=++this.#r;return new Promise((n,a)=>{let s=()=>{this.#o.delete(r),a(new DOMException("Aborted","AbortError"))};e?.addEventListener("abort",s,{once:!0}),this.#o.set(r,{resolve:i=>{e?.removeEventListener("abort",s),n(i)},reject:i=>{e?.removeEventListener("abort",s),a(i)}}),this.#e?.postMessage({id:r,buffer:t},[t])})}#a(t){for(let e of this.#o.values())e.reject(new d(t));this.#o.clear(),this.#e?.terminate(),this.#e=null}dispose(){this.#a("scene-parser-disposed"),this.#t&&URL.revokeObjectURL(this.#t),this.#t=null}};var L={catalog:1e4,scene:6e4,delta:35e3,pose:1e4,history:15e3,workflow:15e3,mutation:2e4},P=class extends Error{constructor(t,e=null){super(t),this.name="BackendError",this.code=t,this.status=e}},W=36,F=16*1024*1024,qe=(o,t)=>{let e=Number(o);if(!Number.isSafeInteger(e)||e<0)throw new d(t);return e},Ve=(o,t)=>{let e=o.headers.get("X-Matic-Revision");if(e===null)return t;let r=Number(e);if(!Number.isSafeInteger(r)||r<0)throw new d("invalid-scene-revision");return r},je=(o,t)=>{let e=o.headers.get("X-Matic-Floor-Coherent");if(e===null)return t;if(e==="1")return!0;if(e==="0")return!1;throw new d("invalid-scene-floor-header")},J=class{#e;#t=new Z;constructor(t){this.#e=t}async#r(t,e,r,n){if(!Fe(t))throw new P("invalid-private-path");if(n?.aborted)throw new DOMException("Aborted","AbortError");let a=new AbortController,s=()=>a.abort();n?.addEventListener("abort",s,{once:!0});let i=!1,u=window.setTimeout(()=>{i=!0,a.abort()},r);try{let l=this.#e(),c={...e,cache:"no-store",credentials:"same-origin",signal:a.signal};if(typeof l?.fetchWithAuth=="function")return await l.fetchWithAuth(t,c);let p=l?.auth?.accessToken||l?.auth?.data?.access_token,m=new Headers(e.headers);p&&m.set("Authorization",`Bearer ${p}`);let f=typeof l?.hassUrl=="function"?l.hassUrl(t):t;return await fetch(f,{...c,headers:m})}catch(l){throw i&&!n?.aborted?new P("request-timeout"):a.signal.aborted?new DOMException("Aborted","AbortError"):l}finally{window.clearTimeout(u),n?.removeEventListener("abort",s)}}async#o(t,e,r,n={}){let a=await this.#r(t,{...n,headers:{Accept:"application/json",...n.headers||{}}},e,r);if(!a.ok)throw new P("request-failed",a.status);try{return await a.json()}catch{throw new d("invalid-json-response")}}async catalog(t){return Te(await this.#o(Le,L.catalog,t))}async scene(t,e,r,n,a,s){let i=new Headers({Accept:"application/vnd.matic.slam-scene"});s&&i.set("If-None-Match",s);let u=await this.#r(t,{headers:i},L.scene,a),l=Ve(u,e),c=je(u,r);if(u.status===304)return{scene:null,floorCoherent:c,revision:l,notModified:!0};if(!u.ok)throw new P("scene-request-failed",u.status);if(u.headers.get("Content-Type")?.split(";",1)[0]!=="application/vnd.matic.slam-scene")throw new d("invalid-scene-content-type");return{scene:{...await this.#t.parse(await u.arrayBuffer(),a),revision:l,etag:u.headers.get("ETag"),source:n},floorCoherent:c,revision:l,notModified:!1}}async#a(t,e,r){if(!Number.isSafeInteger(e)||e<1||e>F||typeof DecompressionStream!="function")throw new d("invalid-scene-delta");let a=new Blob([t]).stream().pipeThrough(new DecompressionStream("deflate")).getReader(),s=new Uint8Array(e),i=0,u=()=>{a.cancel()};r?.addEventListener("abort",u,{once:!0});try{for(;;){if(r?.aborted)throw new DOMException("Aborted","AbortError");let{done:l,value:c}=await a.read();if(l)break;if(!(c instanceof Uint8Array)||i+c.byteLength>e)throw new d("invalid-scene-delta");s.set(c,i),i+=c.byteLength}}finally{r?.removeEventListener("abort",u),a.releaseLock()}if(i!==e)throw new d("invalid-scene-delta");return s}async#n(t,e,r){if(t.byteLength<W||t.byteLength>W+F||e.buffer.byteLength>F)throw new d("invalid-scene-delta");let n=new DataView(t),a=new TextDecoder().decode(new Uint8Array(t,0,8)),s=n.getUint16(8,!0),i=n.getUint16(10,!0),u=qe(n.getBigUint64(12,!0),"invalid-scene-delta"),l=qe(n.getBigUint64(20,!0),"invalid-scene-delta"),c=n.getUint32(28,!0),p=n.getUint32(32,!0);if(a!=="MATICDLT"||s!==1||i!==1||u!==e.revision||l<=e.revision||c<24||c>F||p>F||p+W!==t.byteLength)throw new d("invalid-scene-delta");let m=new Uint8Array(t,W,p),f=new Uint8Array(e.buffer),C=(await this.#a(m,Math.max(f.byteLength,c),r)).slice(),v=1024*1024;for(let w=0;w<f.byteLength;w+=v){if(r?.aborted)throw new DOMException("Aborted","AbortError");let O=Math.min(f.byteLength,w+v);for(let T=w;T<O;T+=1)C[T]=(C[T]??0)^(f[T]??0);O<f.byteLength&&await new Promise(T=>window.setTimeout(T,0))}let _=C.slice(0,c).buffer;return{parsed:{...await this.#t.parse(_,r),revision:l,etag:null,source:"live"},revision:l}}async sceneDelta(t,e,r,n){let a=t.includes("?")?"&":"?",s=await this.#r(`${t}${a}since=${encodeURIComponent(e.revision)}`,{headers:{Accept:"application/vnd.matic.slam-delta, application/vnd.matic.slam-scene"}},L.delta,n),i=Ve(s,e.revision),u=je(s,r);if(s.status===204){if(i!==e.revision)throw new d("invalid-scene-delta-revision");return{scene:null,floorCoherent:u,revision:i,notModified:!0}}if(!s.ok)throw new P("delta-request-failed",s.status);if(i<=e.revision)throw new d("invalid-scene-delta-revision");let l=Number(s.headers.get("Content-Length"));if(Number.isFinite(l)&&l>W+F)throw new d("invalid-scene-delta-size");let c=s.headers.get("Content-Type")?.split(";",1)[0],p=await s.arrayBuffer();if(c==="application/vnd.matic.slam-delta"){let f=Number(s.headers.get("X-Matic-Base-Revision"));if(!Number.isSafeInteger(f)||f!==e.revision)throw new d("invalid-scene-delta-base");let k=await this.#n(p,e,n);if(k.revision!==i)throw new d("invalid-scene-delta-revision");return{scene:{...k.parsed,etag:s.headers.get("ETag")},floorCoherent:u,revision:i,notModified:!1}}if(c!=="application/vnd.matic.slam-scene")throw new d("invalid-scene-delta-content-type");return{scene:{...await this.#t.parse(p,n),revision:i,etag:s.headers.get("ETag"),source:"live"},floorCoherent:u,revision:i,notModified:!1}}async pose(t,e){return Be(await this.#o(t,L.pose,e))}async history(t,e){return $e(await this.#o(t,L.history,e))}async plans(t,e){return He(await this.#o(t,L.workflow,e))}async areas(t,e){return Ne(await this.#o(t,L.workflow,e))}async saveArea(t,e,r){let n=await this.#o(t,L.mutation,r,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...e.areaId?{area_id:e.areaId}:{},name:e.name,circles:e.circles,cleaning_mode:e.cleaningMode,coverage_setting:e.coverageSetting})});if(!n||typeof n!="object"||typeof n.id!="string")throw new d("invalid-area-save-response");return n.id}async deleteArea(t,e,r){let n=await this.#r(`${t}?area_id=${encodeURIComponent(e)}`,{method:"DELETE",headers:{Accept:"application/json"}},L.mutation,r);if(!n.ok)throw new P("area-delete-failed",n.status)}async service(t,e,r,n){let a=this.#e();if(typeof a?.callService!="function")throw new P("service-unavailable");await a.callService(t,e,r,{entity_id:n})}dispose(){this.#t.dispose()}};var Xe=()=>({version:4,view:"top",labels:!0,quality:"auto",cameras:{}}),q=(o,t,e)=>Math.max(t,Math.min(e,o)),Ge=o=>o.replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",be=(o,t=4)=>`matic-map-studio:v${t}:${Ge(o)}`,Rt=o=>{if(!o||typeof o!="object")return null;let t=o;return["yaw","pitch","zoom","targetX","targetZ"].every(r=>typeof t[r]=="number"&&Number.isFinite(t[r]))?{yaw:q(t.yaw,-Math.PI,Math.PI),pitch:q(t.pitch,.18,Math.PI/2-.018),zoom:q(t.zoom,.01,100),targetX:q(t.targetX,-1e4,1e4),targetZ:q(t.targetZ,-1e4,1e4)}:null},Ke=o=>{let t=Xe();if(!o||typeof o!="object")return t;let e=o,r=e.view==="three"||e.view==="top"||e.view==="rooms"?e.view:t.view,n=r==="rooms"?"top":r,a=e.quality==="auto"||e.quality==="efficient"||e.quality==="balanced"||e.quality==="maximum"?e.quality:t.quality,s=e.cameras&&typeof e.cameras=="object"?e.cameras:{},i={};for(let u of["three","top"]){let l=Rt(s[u]);l&&(i[u]=l)}return{version:4,view:n,labels:typeof e.labels=="boolean"?e.labels:t.labels,quality:a,cameras:i}},Q=class{#e="local-user";#t=null;load(t){this.#e=Ge(t);try{let e=window.localStorage.getItem(be(this.#e));if(e)return Ke(JSON.parse(e));for(let r of[3,2]){let n=window.localStorage.getItem(be(this.#e,r));if(n)return Ke(JSON.parse(n))}}catch{}return Xe()}schedule(t){this.#t!==null&&window.clearTimeout(this.#t),this.#t=window.setTimeout(()=>{this.#t=null;try{window.localStorage.setItem(be(this.#e),JSON.stringify(t))}catch{}},250)}dispose(){this.#t!==null&&window.clearTimeout(this.#t),this.#t=null}},Ye="matic-map-studio:preferred-frontend",Ze=()=>{try{return window.localStorage.getItem(Ye)==="v3"?"v3":"v4"}catch{return"v4"}},ve=o=>{try{return window.localStorage.setItem(Ye,o),!0}catch{return!1}};var h=(o,t,e=null)=>({status:o,value:t,problem:e}),E=o=>o instanceof DOMException&&o.name==="AbortError",z=(o,t)=>o instanceof P||o&&typeof o=="object"&&"code"in o&&typeof o.code=="string"?o.code:t,et=o=>[o.selectedFloorOrdinal??"none",o.mapFloorOrdinal??"none",o.mapFloorCoherent?"coherent":"transition"].join(":"),tt=o=>[o.mapFloorOrdinal??"none",o.mapSessionVerified?"verified":"unverified"].join(":"),Je=o=>[o.entryId,et(o),tt(o),o.mapRevision].join("|"),Qe=o=>o.runnerLocked||o.stopSettlePending||o.activePlan||o.nativeReconciliationPending||o.nativeSessionActive===!0,ge=(o,t)=>o.label?o.label:o.active?"Current floor":`Saved floor ${o.ordinal??t}`,ee=class{#e;#t=new xe;#r;#o=new Q;#a=new Map;#n=null;#l;#i=null;#h=null;#s=null;#y=!1;#u="";#m=0;#v="";#p=!1;constructor(t,e){this.#e=t,this.#r=e}sync(t,e){if(!this.#p){if(this.#n=t,this.#l=e,this.#e.patch({host:t.host,activity:t.activity,batteryPercent:t.batteryPercent,robotLabel:t.robotLabel,locale:t.language}),t.userKey!==this.#v){this.#v=t.userKey;let r=this.#o.load(t.userKey);this.#e.patch({view:r.view,labelsVisible:r.labels,quality:r.quality,cameras:r.cameras})}if(!t.host.connected||!t.host.administrator||t.host.robotCount===0){this.#w(),this.#k(t.host.administrator?"map-unavailable":"access-required");return}this.#S(),(this.#e.value.resources.catalog.status==="idle"||t.entryKey&&t.entryKey!==this.#e.value.selection.entryId)&&this.refreshCatalog(!0)}}schedulePreferences(t){this.#o.schedule(t)}#S(){this.#i===null&&(this.#i=window.setInterval(()=>{document.visibilityState==="visible"&&this.refreshCatalog()},5e3)),this.#h===null&&(this.#h=window.setInterval(()=>{document.visibilityState==="visible"&&this.refreshPose()},2e3))}#w(){this.#i!==null&&window.clearInterval(this.#i),this.#h!==null&&window.clearInterval(this.#h),this.#i=null,this.#h=null}#d(t){this.#a.get(t)?.abort();let e=new AbortController;return this.#a.set(t,e),e}#c(t,e){this.#a.get(t)===e&&this.#a.delete(t)}#b(t=[]){for(let[e,r]of this.#a)t.includes(e)||(r.abort(),this.#a.delete(e))}#k(t){this.#b(),this.#t.invalidate(),this.#u="";let e=this.#e.value;this.#e.patch({generation:this.#t.generation,coherence:e.host.administrator?"unavailable":"blocked",fullMap:!1,precisionOpen:!1,resources:{catalog:h("error",null,t),entry:null,scene:h("idle",null),pose:h("idle",null),history:h("idle",null),plans:h("idle",null),areas:h("idle",null)},map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1},selection:{...e.selection,entryId:null,floorId:"current",historyId:null}})}async refreshCatalog(t=!1){if(this.#p||this.#y||!this.#n?.host.administrator)return;this.#y=!0;let e=this.#d("catalog"),r=this.#e.value.resources.catalog.value;this.#e.patch({resources:{...this.#e.value.resources,catalog:h("loading",r)}});try{let n=await this.#r.catalog(e.signal);if(e.signal.aborted||this.#p)return;let a=this.#l?.config?.entry_id,s=typeof a=="string"?a:null,i=n.find(l=>l.entryId===s)||n.find(l=>l.entryId===this.#n?.entryKey)||n[0]||null;if(this.#e.patch({managedLock:i?Qe(i):!1,resources:{...this.#e.value.resources,catalog:h(n.length?"ready":"empty",n),entry:i}}),!i){this.#k("no-loaded-robot");return}if(this.#e.value.selection.floorId!=="current"&&!t)return;let u=Je(i);if(!t&&u===this.#u)return;this.#u=u,this.#x(i)}catch(n){if(E(n))return;this.#e.patch({coherence:this.#e.value.resources.scene.value?"degraded":"unavailable",resources:{...this.#e.value.resources,catalog:h("error",r,z(n,"catalog-unavailable"))}})}finally{this.#c("catalog",e),this.#y=!1}}#x(t){this.#b(["catalog"]);let e=this.#t.begin(t.entryId,et(t),tt(t),t.mapRevision),r=t.mapFloorCoherent&&t.mapSessionVerified,n=t.health==="problem"||t.health==="limited",a=this.#e.value;this.#e.patch({managedLock:Qe(t),generation:e.generation,coherence:r?n?"degraded":"current":"verifying",dataMode:"live",resources:{...a.resources,entry:t,scene:h(r?"loading":"idle",null),pose:h(r?"loading":"idle",null),history:h("loading",a.resources.history.value),plans:h("idle",null),areas:h("idle",null)},map:{available:!1,complete:t.mapComplete&&!t.mapTruncated,floorCoherent:t.mapFloorCoherent,sessionVerified:t.mapSessionVerified,exactPose:!1},floor:{classifiedCount:Math.max(1,t.historyFloorCount),displayName:t.selectedFloorOrdinal?`Floor ${t.selectedFloorOrdinal}`:"Current floor",readOnly:!1},selection:{...a.selection,entryId:t.entryId,floorId:"current",historyId:null,roomIds:[],planId:null,areaId:null}}),this.#M(t,e),r&&(this.#f(t,e),this.#A(t,e))}async#f(t,e){let r=this.#d("scene");try{let n=await this.#r.scene(t.sceneUrl,t.mapRevision,t.mapFloorCoherent,"live",r.signal);if(!this.#t.accepts(e)||n.revision!==e.revision||!n.floorCoherent||!n.scene)return;if(this.#e.patch({resources:{...this.#e.value.resources,scene:h("ready",n.scene)},map:{...this.#e.value.map,available:!0}}),t.deltaUrl){let a=++this.#m;this.#_(t,e,n.scene,a)}}catch(n){if(E(n)||!this.#t.accepts(e))return;if(n instanceof P&&n.code==="request-timeout"){let a=this.#e.value;this.#e.patch({resources:{...a.resources,scene:h("loading",a.resources.scene.value,"scene-building")}}),window.setTimeout(()=>{this.#p||!this.#t.accepts(e)||this.#e.value.selection.floorId!=="current"||this.#f(t,e)},250);return}this.#e.patch({coherence:"degraded",resources:{...this.#e.value.resources,scene:h("error",null,z(n,"scene-unavailable"))},map:{...this.#e.value.map,available:!1,exactPose:!1}})}finally{this.#c("scene",r)}}async#_(t,e,r,n){if(!t.deltaUrl||typeof DecompressionStream!="function")return;let a=t.deltaUrl,s=t,i=e,u=r;try{for(;!this.#p&&n===this.#m&&this.#t.accepts(i)&&this.#e.value.selection.floorId==="current";){let l=this.#d("delta");try{let c=await this.#r.sceneDelta(a,u,s.mapFloorCoherent,l.signal);if(l.signal.aborted||this.#p||n!==this.#m||!this.#t.accepts(i))return;if(!c.floorCoherent){this.#e.patch({coherence:"verifying",map:{...this.#e.value.map,available:!1,floorCoherent:!1,exactPose:!1},resources:{...this.#e.value.resources,pose:h("idle",null)}}),this.#u="",this.refreshCatalog(!0);return}if(c.notModified||!c.scene){await new Promise(f=>window.setTimeout(f,100));continue}let p=this.#t.advance(i,c.revision);if(!p)return;i=p,u=c.scene,s={...s,mapRevision:c.revision},this.#u=Je(s);let m=this.#e.value;this.#e.patch({resources:{...m.resources,entry:s,scene:h("ready",u),pose:h("loading",m.resources.pose.value)},map:{...m.map,available:!0,floorCoherent:!0,exactPose:!1}}),this.#A(s,i)}finally{this.#c("delta",l)}}}catch(l){if(E(l)||this.#p||n!==this.#m||!this.#t.accepts(i))return;this.#e.patch({coherence:"degraded",notice:{tone:"warning",text:"Live map updates paused while the current map is rechecked."},map:{...this.#e.value.map,exactPose:!1}}),this.#u="",this.refreshCatalog(!0)}}async#M(t,e){let r=this.#d("history");try{let n=await this.#r.history(t.historyUrl,r.signal);if(!this.#t.accepts(e)||n.entryId!==t.entryId)return;let a=n.floors.find(s=>s.active)||n.floors[0];if(!a)return;this.#e.patch({resources:{...this.#e.value.resources,history:h("ready",n)},floor:{...this.#e.value.floor,classifiedCount:n.floors.length,displayName:ge(a,1)}})}catch(n){if(E(n)||!this.#t.accepts(e))return;this.#e.patch({resources:{...this.#e.value.resources,history:h("error",null,z(n,"history-unavailable"))}})}finally{this.#c("history",r)}}async refreshPose(){let t=this.#e.value.resources.entry,e=this.#t.current();!t||!e||this.#e.value.selection.floorId!=="current"||!t.mapFloorCoherent||!t.mapSessionVerified||await this.#A(t,e)}async#A(t,e){let r=this.#d("pose");try{let n=await this.#r.pose(t.poseUrl,r.signal);if(!this.#t.accepts(e)||n.revision!==e.revision||!n.floorCoherent)return;this.#e.patch({resources:{...this.#e.value.resources,pose:h("ready",n)},map:{...this.#e.value.map,exactPose:n.position!==null&&n.freshness==="live"}})}catch(n){if(E(n)||!this.#t.accepts(e))return;this.#e.patch({resources:{...this.#e.value.resources,pose:h("error",null,z(n,"pose-unavailable"))},map:{...this.#e.value.map,exactPose:!1}})}finally{this.#c("pose",r)}}async selectFloor(t){let e=this.#e.value.resources.history.value,r=this.#e.value.resources.entry;if(!e||!r)return;let n=e.floors.find(i=>i.id===t);if(!n)return;if(n.active){this.#u="",this.#e.dispatch({type:"set-floor",floorId:"current"}),await this.refreshCatalog(!0);return}let a=n.snapshots.at(-1);this.#b(["catalog"]);let s=this.#t.begin(r.entryId,n.id,a?.id||n.id,a?.revision||0);this.#e.patch({generation:s.generation,coherence:"current",dataMode:"history",floor:{classifiedCount:e.floors.length,displayName:ge(n,e.floors.indexOf(n)+1),readOnly:!0},selection:{...this.#e.value.selection,floorId:n.id,historyId:a?.id||null},resources:{...this.#e.value.resources,scene:h(a?"loading":"empty",null),pose:h("idle",null)},map:{available:!1,complete:!0,floorCoherent:!0,sessionVerified:!0,exactPose:!1}}),a&&await this.#P(a,s)}async selectHistory(t){let e=this.#e.value.resources.history.value,r=this.#e.value.resources.entry;if(!e||!r)return;if(!t){await this.selectFloor("current");return}let n=e.floors.find(i=>i.snapshots.some(u=>u.id===t)),a=n?.snapshots.find(i=>i.id===t);if(!n||!a)return;let s=this.#t.begin(r.entryId,n.id,a.id,a.revision);this.#b(["catalog"]),this.#e.patch({generation:s.generation,dataMode:"history",floor:{classifiedCount:e.floors.length,displayName:ge(n,e.floors.indexOf(n)+1),readOnly:!0},selection:{...this.#e.value.selection,floorId:n.id,historyId:a.id},resources:{...this.#e.value.resources,scene:h("loading",null),pose:h("idle",null)},map:{...this.#e.value.map,available:!1,exactPose:!1}}),await this.#P(a,s)}async#P(t,e){let r=this.#d("history-scene");try{let n=await this.#r.scene(t.sceneUrl,t.revision,!0,"history",r.signal);if(!this.#t.accepts(e)||!n.scene)return;this.#e.patch({resources:{...this.#e.value.resources,scene:h("ready",n.scene)},map:{...this.#e.value.map,available:!0,exactPose:!1}})}catch(n){if(E(n)||!this.#t.accepts(e))return;this.#e.patch({resources:{...this.#e.value.resources,scene:h("error",null,z(n,"history-scene-unavailable"))}})}finally{this.#c("history-scene",r)}}async openWorkflow(t){this.#e.dispatch({type:"open-workflow",workflow:t}),(t==="plan"||t==="rooms")&&await this.loadPlans(),(t==="draw"||t==="areaReview")&&await this.loadAreas()}async loadPlans(){let t=this.#e.value.resources.entry,e=this.#t.current();if(!t||!e||!$(this.#e.value))return;let r=this.#d("plans");this.#e.patch({resources:{...this.#e.value.resources,plans:h("loading",null)}});try{let n=await this.#r.plans(t.plansUrl,r.signal);if(!this.#t.accepts(e))return;this.#e.patch({resources:{...this.#e.value.resources,plans:h("ready",n)},selection:{...this.#e.value.selection,planId:n.selectedPlan||n.plans[0]?.id||null}}),this.selectPlan(n.selectedPlan||n.plans[0]?.id||null)}catch(n){if(E(n)||!this.#t.accepts(e))return;this.#e.patch({resources:{...this.#e.value.resources,plans:h("error",null,z(n,"plans-unavailable"))}})}finally{this.#c("plans",r)}}selectPlan(t){let e=this.#e.value.resources.plans.value?.plans.find(r=>r.id===t);this.#e.patch({selection:{...this.#e.value.selection,planId:t},planDraft:e?this.#E(e):{...this.#e.value.planDraft,id:null,name:"",rooms:[],dirty:!1}})}#E(t){return{id:t.id,name:t.name,enabled:t.enabled,runBehavior:t.runBehavior,rooms:(t.roomOrder.length?t.roomOrder.flatMap(e=>{let r=t.rooms.find(n=>n.roomId===e);return r?[r]:[]}):t.rooms).map(e=>({...e})),returnToBase:t.returnToBase,finishCurrentRoom:t.finishCurrentRoom,finishCurrentRoomThreshold:t.finishCurrentRoomThreshold,dirty:!1}}async loadAreas(){let t=this.#e.value.resources.entry,e=this.#t.current();if(!t||!e||!$(this.#e.value))return;let r=this.#d("areas");this.#e.patch({resources:{...this.#e.value.resources,areas:h("loading",null)}});try{let n=await this.#r.areas(t.areasUrl,r.signal);if(!this.#t.accepts(e)||n.sceneUrl!==t.sceneUrl)return;this.#e.patch({resources:{...this.#e.value.resources,areas:h("ready",n)}}),this.selectArea(n.areas[0]?.id||null)}catch(n){if(E(n)||!this.#t.accepts(e))return;this.#e.patch({resources:{...this.#e.value.resources,areas:h("error",null,z(n,"areas-unavailable"))}})}finally{this.#c("areas",r)}}selectArea(t){let e=this.#e.value.resources.areas.value?.areas.find(n=>n.id===t),r=this.#e.value;this.#e.patch({selection:{...r.selection,areaId:t},areaDraft:e?this.#R(e):{id:null,name:"",cleaningMode:"vacuum",coverageSetting:"standard",status:"new",canRebind:!1,dirty:!1},draw:{...r.draw,circles:e?.circles||[],undo:[],redo:[],dirty:!1,strokeCount:0}})}#R(t){return{id:t.id,name:t.name,cleaningMode:t.cleaningMode,coverageSetting:t.coverageSetting,status:t.status,canRebind:t.canRebind,dirty:!1}}async saveArea(){let t=this.#e.value,e=t.resources.entry,r=t.areaDraft;if(!e||!$(t)||!r.name.trim()||!t.draw.circles.length)return;let n=this.#d("area-mutation");this.#e.patch({command:"pending",notice:{tone:"info",text:"Saving area\u2026"}});try{let a=await this.#r.saveArea(e.areasUrl,{areaId:r.id,name:r.name.trim(),circles:t.draw.circles,cleaningMode:r.cleaningMode,coverageSetting:r.coverageSetting},n.signal);this.#e.patch({command:"idle",notice:{tone:"success",text:"Area saved"}}),await this.loadAreas(),this.selectArea(a)}catch(a){if(E(a))return;this.#e.patch({command:"failed",notice:{tone:"error",text:"Area could not be saved"}})}finally{this.#c("area-mutation",n)}}async deleteArea(){let t=this.#e.value.resources.entry,e=this.#e.value.selection.areaId;if(!t||!e||!$(this.#e.value))return;let r=this.#d("area-mutation");try{await this.#r.deleteArea(t.areasUrl,e,r.signal),this.#e.patch({notice:{tone:"success",text:"Area deleted"}}),await this.loadAreas()}catch(n){E(n)||this.#e.patch({notice:{tone:"error",text:"Area could not be deleted"}})}finally{this.#c("area-mutation",r)}}async savePlan(){let t=this.#e.value,e=t.planDraft,r=t.resources.plans.value;if(!r||!e.name.trim()||!e.rooms.length||!$(t))return;let n=e.rooms;await this.#C("save_plan",{...e.id?{plan_id:e.id}:{},name:e.name.trim(),enabled:e.enabled,run_behavior:e.runBehavior,rooms:n.map(a=>({room:r.rooms.find(s=>s.roomId===a.roomId)?.name,cleaning_mode:a.cleaningMode,coverage_setting:a.coverageSetting})).filter(a=>a.room),return_to_base:e.returnToBase,finish_current_room:e.finishCurrentRoom,finish_current_room_threshold:e.finishCurrentRoomThreshold,select:!e.id||r.selectedPlan===e.id},"Plan saved","Plan could not be saved"),await this.loadPlans()}async deletePlan(){let t=this.#e.value.selection.planId;t&&(await this.#C("delete_plan",{plan:t},"Plan deleted","Plan could not be deleted"),await this.loadPlans())}async executeAction(t){switch(t){case"stop":await this.#g("matic_robot","stop_intelligent_cleaning",{});return;case"resume":await this.#g("vacuum","start",{});return;case"run-plan":{let e=this.#e.value.selection.planId||this.#e.value.resources.plans.value?.selectedPlan;e&&await this.#g("matic_robot","run_selected_plan",{plan:e});return}case"clean-rooms":{let e=this.#e.value.resources.plans.value,r=this.#e.value.selection.roomIds,n=e?.rooms.filter(a=>r.includes(a.roomId)).map(a=>a.name)||[];n.length&&await this.#g("matic_robot","clean",{rooms:n,ordered:!1,cleaning_mode:this.#e.value.selection.cleaningMode,coverage_setting:this.#e.value.selection.coverageSetting});return}case"run-area":{let e=this.#e.value.selection.areaId;e&&await this.#g("matic_robot","clean_area",{area:e});return}case"review-area":this.#e.dispatch({type:"open-workflow",workflow:"areaReview"});return;case"save-area":await this.saveArea();return;case"save-plan":await this.savePlan();return;case"delete-plan":await this.deletePlan();return;case"delete-area":await this.deleteArea();return}}async#C(t,e,r,n){let a=this.#n?.vacuumEntityId;if(!(!a||!$(this.#e.value)||this.#e.value.command==="pending")){this.#e.patch({command:"pending",notice:{tone:"info",text:"Saving\u2026"}});try{await this.#r.service("matic_robot",t,e,a),this.#e.patch({command:"idle",notice:{tone:"success",text:r}})}catch{this.#e.patch({command:"failed",notice:{tone:"error",text:n}})}}}async#g(t,e,r){let n=this.#e.value,a=this.#n?.vacuumEntityId,i=e==="stop_intelligent_cleaning"&&n.command==="idle"&&(n.activity==="cleaning"||n.activity==="paused"||n.activity==="returning");if(!(!a||!i&&!Ae(n))){this.#e.patch({command:"pending",notice:null});try{await this.#r.service(t,e,r,a),this.#e.patch({command:"settling"}),this.#s!==null&&window.clearTimeout(this.#s),this.#s=window.setTimeout(()=>{this.#s=null,this.#e.value.command==="settling"&&this.#e.patch({command:"idle"})},15e3)}catch{this.#e.patch({command:"failed",notice:{tone:"error",text:"The robot did not accept that action"}})}}}updateDraftCircles(t,e=!0,r){this.#e.dispatch({type:"set-draft-circles",circles:t,record:e,...r?{previous:r}:{}}),this.#e.dispatch({type:"patch-area-draft",patch:{dirty:!0}})}dispose(){this.#p||(this.#p=!0,this.#w(),this.#b(),this.#s!==null&&window.clearTimeout(this.#s),this.#s=null,this.#o.dispose(),this.#r.dispose(),this.#t.invalidate())}};var rt=o=>(o.workflow==="none"?0:1)+(o.fullMap?1:0)+(o.precisionOpen?1:0)+(o.dialog?1:0),It=o=>{if(!o||typeof o!="object")return null;let t=o.maticMapLayer;if(!t||typeof t!="object")return null;let e=t.owner,r=t.depth;return typeof e=="string"&&Number.isInteger(r)&&Number(r)>=0?{owner:e,depth:Number(r)}:null},te=class{#e;#t=`matic-map-${crypto.randomUUID?.()||Math.random().toString(36).slice(2)}`;#r=0;#o=null;#a=!1;constructor(t){this.#e=t}start(){this.#o||(this.#r=rt(this.#e.value),this.#o=this.#e.subscribe(t=>this.#n(t)),window.addEventListener("popstate",this.#l))}#n(t){let e=rt(t);if(this.#a){this.#a=!1,this.#r=e;return}if(e>this.#r)for(let r=this.#r+1;r<=e;r+=1){let n=history.state&&typeof history.state=="object"?history.state:{};history.pushState({...n,maticMapLayer:{owner:this.#t,depth:r}},"",window.location.href)}this.#r=e}#l=()=>{this.#r<1||(this.#a=!0,this.#e.dispatch({type:"dismiss-top-layer"}))};dismissTop(){if(this.#r<1)return!1;let t=It(history.state);return t?.owner===this.#t&&t.depth===this.#r?history.back():this.#e.dispatch({type:"dismiss-top-layer"}),!0}dispose(){this.#o?.(),this.#o=null,window.removeEventListener("popstate",this.#l),this.#r=0}};var we=class extends N{constructor(){super(...arguments);this.narrow=!1;this._workspace=D();this._classic=!1;this.#e=new Y;this.#t=new K(this._workspace);this.#r=null;this.#o=null;this.#a=null;this.#n=null;this.#l=null;this.#i=""}static{this.properties={hass:{attribute:!1},narrow:{type:Boolean},route:{attribute:!1},panel:{attribute:!1},_workspace:{state:!0},_classic:{state:!0}}}#e;#t;#r;#o;#a;#n;#l;#i;connectedCallback(){super.connectedCallback(),this._classic=Ze()==="v3",this.#o=this.#t.subscribe(e=>{this._workspace=e,this.#y(e)}),this._classic||this.#h()}disconnectedCallback(){this.#o?.(),this.#o=null,this.#s(),super.disconnectedCallback()}#h(){this.#n||(this.#a=new J(()=>this.hass),this.#n=new ee(this.#t,this.#a),this.#l=new te(this.#t),this.#l.start(),this.#r&&this.#n.sync(this.#r,this.panel))}#s(){this.#l?.dispose(),this.#l=null,this.#n?.dispose(),this.#n=null,this.#a=null}#y(e){if(!this.#n)return;let r={version:4,view:e.view,labels:e.labelsVisible,quality:e.quality,cameras:e.cameras},n=JSON.stringify(r);n!==this.#i&&(this.#i=n,this.#n.schedulePreferences(r))}willUpdate(e){if(e.has("hass")||e.has("panel")){let r=this.#e.project(this.hass,this.panel);if(r!==this.#r){this.#r=r;let n=r.host.connected?r.host.robotCount===0?"unavailable":r.host.administrator?"verifying":"blocked":"degraded";this.#t.replace({...this.#t.value,coherence:n,activity:r.activity,batteryPercent:r.batteryPercent,host:r.host,fullMap:r.host.administrator&&r.host.robotCount>0&&this.#t.value.fullMap,robotLabel:r.robotLabel,locale:r.language})}this._classic||this.#n?.sync(r,this.panel)}e.has("narrow")&&this.#t.value.narrowHint!==this.narrow&&this.#t.dispatch({type:"set-narrow-hint",value:this.narrow})}#u(e){if(!j(e.detail))return;e.stopPropagation();let r=e.detail;if(r.type==="dismiss-top-layer"||r.type==="exit-full-map"){this.#l?.dismissTop()||this.#t.dispatch(r);return}if(r.type==="open-workflow"&&r.workflow!=="none"){this.#n?.openWorkflow(r.workflow);return}if(r.type==="set-floor"){this.#n?.selectFloor(r.floorId);return}if(r.type==="set-history"){this.#n?.selectHistory(r.historyId);return}if(r.type==="select-plan"){this.#n?.selectPlan(r.planId);return}if(r.type==="select-area"){this.#n?.selectArea(r.areaId);return}this.#t.dispatch(r)}#m(e){if(e.stopPropagation(),typeof e.detail?.id=="string"){if(e.detail.id==="use-classic"){ve("v3")&&(this.#s(),this._classic=!0);return}this.#n?.executeAction(e.detail.id),this.dispatchEvent(new CustomEvent("matic-map-v4-action-requested",{detail:{id:e.detail.id},bubbles:!0,composed:!0}))}}#v(){ve("v4")&&(this._classic=!1,this.#h(),this.requestUpdate())}updated(){if(!this._classic)return;let e=this.renderRoot.querySelector("matic-map-panel-v0-3-1");e&&(e.hass=this.hass,e.narrow=this.narrow,e.route=this.route,e.panel=this.panel)}getWorkspaceSnapshot(){return this.#t.value}render(){return this._classic?y`
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
          <button class="return-v4" type="button" @click=${this.#v}>Use Map Studio 0.4</button>
          <matic-map-panel-v0-3-1></matic-map-panel-v0-3-1>
        </div>
      `:y`
      <matic-map-shell-v4
        .state=${this._workspace}
        @matic-workspace-intent=${this.#u}
        @matic-workspace-action=${this.#m}
      ></matic-map-shell-v4>
    `}};customElements.get("matic-map-panel-v0-4-0")||customElements.define("matic-map-panel-v0-4-0",we);export{xe as CoherenceMachine,Ut as DRAW_BRUSH_MAX_METERS,Ot as DRAW_BRUSH_MIN_METERS,pe as GALLERY_SCENARIOS,Y as HassAdapter,$t as MAP_PIXELS_PER_METER_AT_100,Tt as MAP_ZOOM_MAX,Lt as MAP_ZOOM_MIN,we as MaticMapPanelV4,me as MaticMapStudioGalleryV4,K as WorkspaceStore,Ft as brushCursorPixels,$ as canEditCoordinates,Bt as canShowExactPose,Ht as canShowLiveMap,Ae as canStartMotion,qt as commandState,ue as createGalleryState,D as initialWorkspaceState,j as isWorkspaceIntent,Wt as mapScale,Dt as normalizeBrush,zt as normalizeZoom,Nt as reduceWorkspace,Ce as selectPausedSecondaryAction,Pe as selectPrimaryAction};
