import{A as ue,a as Tt,b as Ot,c as Ut,d as $t,e as zt,f as j,g as Dt,h as Nt,i as D,j as Ht,k as X,l as Ce,m as Bt,n as Ft,o as $,p as Me,q as Ee,r as Re,s as Wt,t as qt,u as Vt,v as G,w as y,x as S,y as N,z as Ie}from"./chunks/chunk.js";var H=[{roomId:"room-a",name:"Kitchen",boundary:[[.5,.5],[4,.5],[4,3],[.5,3]]},{roomId:"room-b",name:"Living room",boundary:[[4.2,.5],[8.5,.5],[8.5,3.4],[4.2,3.4]]},{roomId:"room-c",name:"Office",boundary:[[.5,3.2],[3.8,3.2],[3.8,6.5],[.5,6.5]]},{roomId:"room-d",name:"Bedroom",boundary:[[4,3.6],[8.5,3.6],[8.5,6.5],[4,6.5]]}],Le=()=>{let n=[180,140],e={meters_per_cell:.05,origin_cells:[0,0],span_cells:n,sample_step:1,rooms:H.map(l=>{let c=l.boundary.map(([m,f])=>[m/.05,f/.05]),p=[c.reduce((m,[f])=>m+f,0)/c.length,c.reduce((m,[,f])=>m+f,0)/c.length];return{name:l.name,boundary:c,boundary_closed:!0,center:p}})},t=new TextEncoder().encode(JSON.stringify(e)),r=[];for(let l=10;l<130;l+=2)for(let c=10;c<170;c+=2){let p=c<80?l<65?0:2:l<72?1:3,m=[[185,219,224],[201,211,233],[210,226,194],[232,207,207]][p]||[190,205,215];r.push([c,l,0,...m])}let o=500;for(let l=0;l<o;l+=1){let c=l%4,p=l*7%120,m=c<2?c===0?10:168:10+p,f=c>=2?c===2?10:128:10+p;r.push([m,f,10+l%18,104,122,137])}let a=r.length-o,s=new ArrayBuffer(24+t.byteLength+r.length*8),i=new DataView(s);new Uint8Array(s,0,8).set(new TextEncoder().encode("MATIC3D\0")),i.setUint16(8,1,!0),i.setUint16(10,8,!0),i.setUint32(12,t.byteLength,!0),i.setUint32(16,a,!0),i.setUint32(20,o,!0),new Uint8Array(s,24,t.byteLength).set(t);let u=new DataView(s,24+t.byteLength);return r.forEach(([l=0,c=0,p=0,m=0,f=0,k=0],C)=>{let v=C*8;u.setUint16(v,l,!0),u.setUint16(v+2,c,!0),u.setUint8(v+4,p),u.setUint8(v+5,m),u.setUint8(v+6,f),u.setUint8(v+7,k)}),{buffer:s,pointOffset:24+t.byteLength,floorCount:a,surfaceCount:o,total:r.length,revision:7,etag:'"synthetic-scene"',source:"live",metadata:{metersPerCell:.05,origin:[0,0],span:n,sampleStep:1,rooms:e.rooms.map((l,c)=>({id:H[c]?.roomId||`room-${c}`,name:l.name,boundary:l.boundary,center:l.center}))}}},Y=()=>({entryId:"synthetic-entry",sceneUrl:"/api/matic_robot/slam_scene/synthetic",deltaUrl:"/api/matic_robot/slam_delta/synthetic",poseUrl:"/api/matic_robot/slam_pose/synthetic",historyUrl:"/api/matic_robot/slam_history/synthetic",areasUrl:"/api/matic_robot/areas/synthetic",plansUrl:"/api/matic_robot/plans/synthetic",mapRevision:7,mapFloorCoherent:!0,mapSessionVerified:!0,mapBlockReason:null,runnerLocked:!1,stopSettlePending:!1,activePlan:!1,nativeReconciliationPending:!1,nativeSessionActive:!1,mapComplete:!0,mapTruncated:!1,selectedFloorOrdinal:1,mapFloorOrdinal:1,historyCount:2,historyFloorCount:2,health:"ready",streamFailures:0,bootstrapState:"complete",bootstrapPhotoSeen:!0,bootstrapStructureSeen:!0,bootstrapFailures:0}),pe=()=>({rooms:H.map(({roomId:n,name:e})=>({roomId:n,name:e})),selectedPlan:"daily",plans:[{id:"daily",name:"Daily clean",enabled:!0,runBehavior:"intelligent",rooms:H.slice(0,3).map(({roomId:n})=>({roomId:n,cleaningMode:"vacuum",coverageSetting:"standard"})),roomOrder:H.slice(0,3).map(({roomId:n})=>n),returnToBase:!0,finishCurrentRoom:!1,finishCurrentRoomThreshold:50}]}),he=()=>({sceneUrl:Y().sceneUrl,rooms:H.map(n=>({...n,boundary:n.boundary.map(e=>[...e])})),areas:[{id:"entryway",name:"Entryway",circles:[{x:1.5,y:1.4,radius:.3},{x:1.9,y:1.6,radius:.3}],cleaningMode:"vacuum",coverageSetting:"standard",status:"current",canRebind:!1}]}),Te=()=>({entryId:"synthetic-entry",liveAvailable:!0,floors:[{id:"current",active:!0,readOnly:!1,liveAvailable:!0,label:"House",ordinal:null,snapshots:[{id:"current-old",createdAt:"2026-08-29T14:00:00Z",revision:6,pointCount:5300,sceneUrl:"/synthetic-history-current-old"},{id:"current-new",createdAt:"2026-08-29T16:12:00Z",revision:7,pointCount:5300,sceneUrl:"/synthetic-history-current-new"}]},{id:"saved-1",active:!1,readOnly:!0,liveAvailable:!1,label:"Shed",ordinal:2,snapshots:[{id:"saved-one",createdAt:"2026-08-28T11:30:00Z",revision:3,pointCount:3100,sceneUrl:"/synthetic-history-saved"}]}]}),Oe=()=>({position:[92,74],source:"latest_pose",revision:7,poseRevision:4,floorCoherent:!0,freshness:"live"});var st=()=>({...D(),coherence:"current",activity:"docked",batteryPercent:92,host:{connected:!0,administrator:!0,robotConnected:!0,robotCount:1},floor:{classifiedCount:2,displayName:"House",readOnly:!1},map:{available:!0,complete:!0,floorCoherent:!0,sessionVerified:!0,exactPose:!0},resources:{catalog:{status:"ready",value:[Y()],problem:null},entry:Y(),scene:{status:"ready",value:Le(),problem:null},pose:{status:"ready",value:Oe(),problem:null},history:{status:"ready",value:Te(),problem:null},plans:{status:"ready",value:pe(),problem:null},areas:{status:"ready",value:he(),problem:null}},selection:{...D().selection,entryId:"synthetic-entry",planId:"daily"},planDraft:{...D().planDraft,id:"daily",name:"Daily clean",rooms:pe().plans[0]?.rooms||[]}}),me=n=>{let e=st();switch(n){case"ready":return e;case"cleaning":return{...e,activity:"cleaning"};case"paused":return{...e,activity:"paused"};case"returning":return{...e,activity:"returning"};case"rooms":return{...e,workflow:"rooms"};case"draw":return{...e,workflow:"draw",areaDraft:{...e.areaDraft,id:"entryway",name:"Entryway",status:"current"},selection:{...e.selection,areaId:"entryway"},draw:{...e.draw,dirty:!0,strokeCount:3,circles:he().areas[0]?.circles||[]}};case"history":return{...e,dataMode:"history",workflow:"history",floor:{...e.floor,readOnly:!0},map:{...e.map,exactPose:!1},selection:{...e.selection,floorId:"saved-1",historyId:"saved-one"}};case"transition":return{...e,coherence:"verifying",activity:"unknown",map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1}};case"problem":return{...e,activity:"problem",coherence:"blocked"};case"ha-offline":return{...e,coherence:"degraded",host:{...e.host,connected:!1},map:{...e.map,exactPose:!1}};case"robot-offline":return{...e,coherence:"degraded",host:{...e.host,robotConnected:!1},map:{...e.map,exactPose:!1}};case"access":return{...e,coherence:"blocked",host:{...e.host,administrator:!1},map:{...e.map,available:!1,exactPose:!1}};case"empty":return{...e,coherence:"unavailable",host:{...e.host,robotConnected:!1,robotCount:0},map:{...e.map,available:!1,exactPose:!1}};case"unsupported":return{...e,coherence:"blocked",map:{...e.map,available:!1,exactPose:!1}};case"multi-robot":return{...e,host:{...e.host,robotCount:2}}}},fe=["ready","cleaning","paused","returning","rooms","draw","history","transition","problem","ha-offline","robot-offline","access","empty","unsupported","multi-robot"];var lt=n=>{switch(n){case"cleaning":return"cleaning";case"paused":return"paused";case"returning":return"returning";case"docked":return"docked";case"idle":return"idle";case"error":return"problem";default:return"unknown"}},ct=n=>typeof n!="number"||!Number.isFinite(n)?null:Math.round(Math.max(0,Math.min(100,n))),dt=n=>{let e=n.attributes?.matic_entry_id;return typeof e=="string"&&e.length>0?e:null},ut=n=>String(n||"local-user").replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",pt=n=>{if(typeof n!="string")return"Matic robot";let e=n.trim();return e&&Array.from(e).length<=128&&!/[\u0000-\u001f\u007f]/u.test(e)?e:"Matic robot"},Z=class{#e="";#t=null;project(e,t){let r=e?.states??{},o=t?.config?.entry_id,a=typeof o=="string"?o:null,s=new Set,i=null,u=null,l=null;for(let[_,R]of Object.entries(r)){let w=dt(R);w&&(s.add(w),_.startsWith("vacuum.")&&(!i||a&&w===a)&&(i=R,u=_,l=w))}let c={connected:e?.connected!==!1,administrator:e?.user?.is_admin===!0,robotConnected:i!==null&&i.state!=="unavailable"&&i.state!=="unknown",robotCount:s.size},p=i?lt(i.state):"unknown",m=ct(i?.attributes?.battery_level),f=e?.selectedLanguage||e?.language||"en",k=ut(e?.user?.id),C=pt(i?.attributes?.friendly_name),v=[c.connected,c.administrator,c.robotConnected,c.robotCount,p,m??"none",f,k,u??"none",l??"none",C].join("|");return v===this.#e&&this.#t?this.#t:(this.#e=v,this.#t={host:c,activity:p,batteryPercent:m,language:f,userKey:k,vacuumEntityId:u,entryKey:l,robotLabel:C},this.#t)}};var ht=n=>{if(!n.host.connected)return{title:"Reconnecting",detail:"Home Assistant is offline"};if(!n.host.administrator)return{title:"Access required",detail:"Administrator only"};if(n.host.robotCount===0)return{title:"No robot",detail:"Set up a Matic robot"};if(!n.host.robotConnected)return{title:"Robot offline",detail:"Last verified map \xB7 read only"};if(n.activity==="problem")return{title:"Needs attention",detail:"Check the robot"};if(n.dataMode==="history"){let t=n.resources.history.value?.floors.find(a=>a.id===n.selection.floorId),r=t?.snapshots.findIndex(a=>a.id===n.selection.historyId)??-1,o=t?.snapshots.length??0;return{title:"Saved map",detail:r>=0?`Read only \xB7 ${r+1} of ${o}`:"Read only"}}if(n.coherence==="verifying"||n.coherence==="booting")return{title:"Locating",detail:"Finding the current map"};if(n.activity==="cleaning")return{title:"Cleaning",detail:"Cleaning in progress"};if(n.activity==="paused")return{title:"Paused",detail:"Cleaning can resume"};if(n.activity==="returning")return{title:"Returning",detail:"Going to the dock"};if(n.activity==="stopping")return{title:"Stopping",detail:"Waiting for the robot"};let e=n.batteryPercent===null?"Ready":`${n.batteryPercent}% battery`;return{title:n.activity==="docked"?"Docked":"Ready",detail:e}},mt=n=>{switch(n.workflow){case"rooms":return{title:"Choose rooms",description:"Select on the map or from the list."};case"draw":return{title:"Draw an area",description:"Paint on the verified map, then review the details."};case"plan":return{title:"Plan",description:"Review rooms and cleaning settings."};case"areaReview":return{title:"Area details",description:"Name the area and choose cleaning settings."};case"history":return{title:"Map history",description:"Saved maps are floor-scoped and read only."};case"support":return{title:"Map support",description:"Private geometry is never included."};case"none":return{title:"Clean",description:"Start with a saved plan, rooms, or an area."}}},ft=n=>{switch(n){case"discardDraft":return{title:"Discard this area?",detail:"The outline has not been saved. You can keep drawing or discard it.",cancelLabel:"Keep drawing",confirmLabel:"Discard",action:"discard"};case"confirmDeletePlan":return{title:"Delete this plan?",detail:"This removes the saved plan from Home Assistant. The robot will not move.",cancelLabel:"Cancel",confirmLabel:"Delete plan",action:"delete-plan"};case"confirmDeleteArea":return{title:"Delete this area?",detail:"This removes the saved outline from Home Assistant. The robot will not move.",cancelLabel:"Cancel",confirmLabel:"Delete area",action:"delete-area"};case"confirmStop":return{title:"Stop cleaning?",detail:"The robot may take a moment to settle before another action is available.",cancelLabel:"Keep cleaning",confirmLabel:"Stop",action:"stop"};case"error":return{title:"Something went wrong",detail:"No action was started. Close this message and try again when the map is ready.",cancelLabel:"Close",confirmLabel:"Close",action:null};case null:return null}},yt=(n=document)=>{let e=n.activeElement;for(;e?.shadowRoot?.activeElement;)e=e.shadowRoot.activeElement;return e},ye=class extends N{constructor(){super(...arguments);this._measuredNarrow=!1;this._sheetOffset=0;this._workflowReady=!1;this._overflowOpen=!1;this._sheetDetent="peek";this.#e=null;this.#t=null;this.#r=null;this.#n=null;this.#a=null;this.#o=null;this.#l=t=>{if(!this._overflowOpen)return;let r=this.renderRoot.querySelector(".overflow-wrap");(!r||!t.composedPath().includes(r))&&(this._overflowOpen=!1)}}static{this.properties={state:{attribute:!1},_measuredNarrow:{state:!0},_sheetOffset:{state:!0},_workflowReady:{state:!0},_overflowOpen:{state:!0},_sheetDetent:{state:!0}}}static{this.styles=G`
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
  `}#e;#t;#r;#n;#a;#o;#l;connectedCallback(){super.connectedCallback(),this.#e=new ResizeObserver(([t])=>{if(!t)return;let r=t.contentRect.width<768||t.contentRect.height<480;r!==this._measuredNarrow&&(this._measuredNarrow=r)}),this.#e.observe(this),window.addEventListener("pointerdown",this.#l,!0),this.#t=new ResizeObserver(([t])=>{if(!t)return;let r=Math.ceil(t.target.getBoundingClientRect().height);r!==this._sheetOffset&&(this._sheetOffset=r)})}disconnectedCallback(){this.#e?.disconnect(),this.#e=null,this.#t?.disconnect(),this.#t=null,this.#r=null,window.removeEventListener("pointerdown",this.#l,!0),super.disconnectedCallback()}updated(t){let r=this.renderRoot.querySelector(".mobile-sheet");if(r!==this.#r&&(this.#t?.disconnect(),this.#r=r,r&&this.#t?.observe(r)),t.has("state")){let o=t.get("state");o?.precisionOpen&&!this.state.precisionOpen&&this.#n?.focus(),!o?.dialog&&this.state.dialog?(this.#a=yt(this.shadowRoot||document),this.updateComplete.then(()=>{this.renderRoot.querySelector(".dialog button")?.focus()})):o?.dialog&&!this.state.dialog&&(this.#a?.focus(),this.#a=null),this.state.workflow!=="none"&&!this._workflowReady&&import("./chunks/workflow-panel.js").then(()=>{this._workflowReady=!0}),(!o||o.workflow!==this.state.workflow)&&(this._sheetDetent=this.state.workflow==="none"?"peek":"half")}}#i(t){this.dispatchEvent(new CustomEvent(Ie,{detail:t,bubbles:!0,composed:!0}))}#h(t){if(t.enabled){if(t.id==="return-live"){this.#i({type:"set-history",historyId:null});return}this.#m(t.id)}}#s(t){if(this.state.workflow==="draw"&&this.state.draw.dirty&&t!=="draw"&&t!=="areaReview"){this.#o=t,this.#i({type:"open-dialog",dialog:"discardDraft"});return}this.#i({type:"open-workflow",workflow:t})}#y(){let t=this.#o;this.#o=null,this.#i({type:"discard-draft"}),t&&queueMicrotask(()=>this.#i({type:"open-workflow",workflow:t}))}#u(){this.#o=null,this.#i({type:"dismiss-top-layer"})}#m(t){this.dispatchEvent(new CustomEvent(ue,{detail:{id:t},bubbles:!0,composed:!0}))}#v(t){this.#i({type:"dismiss-top-layer"}),this.#m(t)}#p(t){if(t.action==="discard"){this.#y();return}if(t.action==="delete-plan"||t.action==="delete-area"){this.#v(t.action);return}this.#i({type:"dismiss-top-layer"}),t.action==="stop"&&this.#m("stop")}#S(){this._sheetDetent=this._sheetDetent==="peek"?"half":this._sheetDetent==="half"?"full":"peek"}#w(){if(this.state.precisionOpen||this.state.fullMap){this.#i({type:"dismiss-top-layer"});return}if(this.state.workflow!=="none"){this.#s("none");return}this.#d()}#d(){this.dispatchEvent(new CustomEvent("hass-toggle-menu",{bubbles:!0,composed:!0}))}#c(t){if(this._overflowOpen=!1,t==="support"){this.#s("support");return}this.dispatchEvent(new CustomEvent(ue,{detail:{id:"use-classic"},bubbles:!0,composed:!0}))}#b(t){this.#n=t.currentTarget,this.#i({type:"set-precision-open",value:!this.state.precisionOpen})}#k(t){if(!(t.defaultPrevented||t.ctrlKey||t.metaKey||t.altKey)&&t.key==="Escape"){if(t.preventDefault(),this._overflowOpen){this._overflowOpen=!1;return}this.#i({type:"dismiss-top-layer"})}}#x(t){if(t.key!=="Tab")return;let r=[...this.renderRoot.querySelectorAll(".dialog button:not(:disabled)")],o=r[0],a=r.at(-1);!o||!a||(t.shiftKey&&this.shadowRoot?.activeElement===o?(t.preventDefault(),a.focus()):!t.shiftKey&&this.shadowRoot?.activeElement===a&&(t.preventDefault(),o.focus()))}#f(t,r="primary-action"){return y`
      <button
        class=${`${r} ${t.kind==="danger"?"danger":""}`}
        type="button"
        ?disabled=${!t.enabled}
        title=${t.reason??""}
        @click=${()=>this.#h(t)}
      >${t.label}</button>
    `}#_(t){return t.workflow==="none"?y`
      <div class="quick-actions">
        <button type="button" @click=${()=>this.#s("rooms")}>Rooms</button>
        <button type="button" @click=${()=>this.#s("draw")}>Draw area</button>
        <button type="button" @click=${()=>this.#s("plan")}>Plans</button>
        <button type="button" @click=${()=>this.#s("history")}>History</button>
      </div>
    `:this._workflowReady?y`<matic-map-workflow-v4 .state=${t}></matic-map-workflow-v4>`:y`<div role="status">Loading workspace…</div>`}render(){let t=this.state,r=t.narrowHint||this._measuredNarrow,o=ht(t),a=mt(t),s=Ee({...t,narrowHint:r}),i=Re(t),u=t.workflow==="draw"&&(r||t.fullMap),l=t.fullMap&&(t.coherence==="verifying"||t.coherence==="booting"),c=t.workflow!=="none"||t.fullMap||t.precisionOpen,p=ft(t.dialog);return y`
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
            ${t.host.robotCount>1?y`
              <button class="robot-switcher" type="button">${t.robotLabel} ▾</button>
            `:S}
            <span class="spacer"></span>
            <span class="header-state">${o.title}</span>
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

          <main class=${`workspace ${t.fullMap?"full-map":""}`}>
            <div class="canvas">
              <matic-map-canvas-v4
                style=${r&&!t.fullMap?`--map-sheet-offset:${this._sheetOffset}px`:"--map-sheet-offset:0px"}
                .state=${t}
              ></matic-map-canvas-v4>
            </div>

            ${u?y`
              <div class="precision-popover">
                <button
                  class="precision-chip"
                  type="button"
                  aria-expanded=${String(t.precisionOpen)}
                  @click=${this.#b}
                >${t.draw.zoomPercent}% · ${t.draw.brushMeters.toFixed(2)} m</button>
                ${t.precisionOpen?y`
                  <matic-precision-controls-v4 compact .state=${t}></matic-precision-controls-v4>
                `:S}
              </div>
            `:S}

            <aside class="inspector" aria-label="Map workspace">
              <div class="status-strip">
                <span class="status-icon" aria-hidden="true">◆</span>
                <span><strong>${o.title}</strong><small>${o.detail}</small></span>
              </div>
              <section class="workflow">
                <h2 tabindex="-1">${a.title}</h2>
                <p>${a.description}</p>
                ${this.#_(t)}
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
                ${t.workflow==="draw"?S:this.#_(t)}
              </div>
              <div class="primary-stack">
                ${this.#f(s)}
                ${i?this.#f(i,"secondary-action"):S}
              </div>
            </section>

            ${t.fullMap?y`
              <section
                class=${`full-map-hud ${i?"has-secondary":""}`}
                aria-label="Robot status and action"
              >
                <span class="hud-copy"><strong>${o.title}</strong><small>${o.detail}</small></span>
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
                  @click=${t.dialog==="discardDraft"?this.#u:()=>this.#i({type:"dismiss-top-layer"})}
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
    `}};customElements.get("matic-map-shell-v4")||customElements.define("matic-map-shell-v4",ye);var be=class extends N{constructor(){super(...arguments);this.scenario="ready";this.narrow=!1;this.controls=!0;this._workspace=me("ready");this.#e=new X(this._workspace);this.#t=null}static{this.properties={scenario:{type:String,reflect:!0},narrow:{type:Boolean,reflect:!0},controls:{type:Boolean,reflect:!0},_workspace:{state:!0}}}static{this.styles=G`
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
  `}#e;#t;connectedCallback(){super.connectedCallback(),this.#t=this.#e.subscribe(t=>{this._workspace=t})}disconnectedCallback(){this.#t?.(),this.#t=null,super.disconnectedCallback()}willUpdate(t){t.has("scenario")?this.#e.replace({...me(this.scenario),narrowHint:this.narrow}):t.has("narrow")&&this.#e.dispatch({type:"set-narrow-hint",value:this.narrow})}setScenario(t){fe.includes(t)&&(this.scenario=t)}getWorkspaceSnapshot(){return structuredClone(this.#e.value)}replaceWorkspaceState(t){this.#e.replace(structuredClone(t))}#r(t){j(t.detail)&&(t.stopPropagation(),this.#e.dispatch(t.detail))}render(){return y`
      ${this.controls?y`
        <nav class="gallery-controls" aria-label="Map Studio states">
          ${fe.map(t=>y`
            <button
              type="button"
              aria-pressed=${String(this.scenario===t)}
              @click=${()=>{this.scenario=t}}
            >${t}</button>
          `)}
        </nav>
      `:null}
      <div class="stage">
        <matic-map-shell-v4
          .state=${this._workspace}
          @matic-workspace-intent=${this.#r}
        ></matic-map-shell-v4>
      </div>
    `}};customElements.get("matic-map-studio-gallery-v0-4-0")||customElements.define("matic-map-studio-gallery-v0-4-0",be);var Ue="/api/matic_robot/slam_entries";var d=class extends Error{constructor(e){super(e),this.name="ContractError",this.code=e}},x=(n,e)=>{if(!n||typeof n!="object"||Array.isArray(n))throw new d(e);return n},g=(n,e,t)=>{if(typeof n!="string")throw new d(t);let r=n.trim();if(!r||Array.from(r).length>e||/[\u0000-\u001f\u007f]/u.test(r))throw new d(t);return r},bt=n=>{if(n==null||n==="")return null;try{return g(n,128,"invalid-floor-label")}catch{return null}},B=(n,e,t,r)=>{if(typeof n!="number"||!Number.isFinite(n)||n<e||n>t)throw new d(r);return n},M=(n,e,t,r)=>{let o=B(n,e,t,r);if(!Number.isInteger(o))throw new d(r);return o},ve=(n,e)=>n==null?null:M(n,1,e,"invalid-floor-ordinal"),b=(n,e)=>{if(typeof n!="boolean")throw new d(e);return n},vt=(n,e)=>n===null?null:b(n,e),gt=n=>{if(n==null)return null;if(n==="bootstrap_empty"||n==="map_session_unverified"||n==="floor_plan_unavailable"||n==="floor_plan_mismatch")return n;throw new d("invalid-map-block-reason")},wt=n=>{if(n===void 0)return"not_started";if(n==="not_started"||n==="running"||n==="complete"||n==="partial"||n==="failed")return n;throw new d("invalid-bootstrap-state")},I=(n,e)=>{let t=g(n,512,e);if(!t.startsWith("/")||t.startsWith("//")||t.includes("\\"))throw new d(e);return t},kt=n=>{let e=typeof n.map_health=="string"?n.map_health.toLowerCase():"",t=typeof n.stream_state=="string"?n.stream_state.toLowerCase():"",r=typeof n.invalid_tiles=="number"?n.invalid_tiles:0;return e.includes("error")||e.includes("fail")||e.includes("degrad")||r>0?"problem":n.map_truncated===!0||e.includes("truncat")||e.includes("limit")?"limited":n.map_complete===!0?"ready":t.includes("connect")||t.includes("collect")||t.includes("run")?"building":"unknown"},$e=n=>{let e=x(n,"invalid-catalog");if(!Array.isArray(e.entries)||e.entries.length>64)throw new d("invalid-catalog-entries");return e.entries.map(t=>{let r=x(t,"invalid-catalog-entry"),o=M(r.map_revision,0,Number.MAX_SAFE_INTEGER,"invalid-map-revision");return{entryId:g(r.entry_id,128,"invalid-entry-id"),sceneUrl:I(r.scene_url,"invalid-scene-url"),deltaUrl:r.delta_url===void 0||r.delta_url===null?null:I(r.delta_url,"invalid-delta-url"),poseUrl:I(r.pose_url,"invalid-pose-url"),historyUrl:I(r.history_url,"invalid-history-url"),areasUrl:I(r.areas_url,"invalid-areas-url"),plansUrl:I(r.plans_url,"invalid-plans-url"),mapRevision:o,mapFloorCoherent:b(r.map_floor_coherent,"invalid-floor-coherence"),mapSessionVerified:b(r.map_session_verified,"invalid-session-state"),mapBlockReason:gt(r.map_block_reason),runnerLocked:b(r.runner_locked,"invalid-runner-lock"),stopSettlePending:b(r.stop_settle_pending,"invalid-stop-settle"),activePlan:b(r.active_plan,"invalid-active-plan"),nativeReconciliationPending:b(r.native_reconciliation_pending,"invalid-native-reconciliation"),nativeSessionActive:vt(r.native_session_active,"invalid-native-session"),mapComplete:b(r.map_complete,"invalid-map-complete"),mapTruncated:b(r.map_truncated,"invalid-map-truncated"),selectedFloorOrdinal:ve(r.selected_floor_ordinal,128),mapFloorOrdinal:ve(r.map_floor_ordinal,128),historyCount:M(r.history_count,0,12,"invalid-history-count"),historyFloorCount:M(r.history_floor_count,0,128,"invalid-floor-count"),health:kt(r),streamFailures:M(r.stream_failures,0,Number.MAX_SAFE_INTEGER,"invalid-stream-failures"),bootstrapState:wt(r.bootstrap_state),bootstrapPhotoSeen:r.bootstrap_photo_seen===void 0?!1:b(r.bootstrap_photo_seen,"invalid-bootstrap-photo"),bootstrapStructureSeen:r.bootstrap_structure_seen===void 0?!1:b(r.bootstrap_structure_seen,"invalid-bootstrap-structure"),bootstrapFailures:r.bootstrap_failures===void 0?0:M(r.bootstrap_failures,0,2,"invalid-bootstrap-failures")}})},ze=(n,e)=>{if(!Array.isArray(n)||n.length!==2)throw new d(e);return[B(n[0],-1e6,1e6,e),B(n[1],-1e6,1e6,e)]},_t=(n,e)=>{if(!Array.isArray(n)||n.length<3||n.length>8192)throw new d(e);return n.map(t=>ze(t,e))},De=(n,e)=>{if(!Array.isArray(n)||n.length>256)throw new d("invalid-rooms");return n.map(t=>{let r=x(t,"invalid-room");return{roomId:g(r.room_id,128,"invalid-room-id"),name:g(r.name,128,"invalid-room-name"),boundary:e?_t(r.boundary,"invalid-room-boundary"):[]}})},St=n=>{let e=x(n,"invalid-history-snapshot"),t=g(e.created_at,64,"invalid-history-time");if(!Number.isFinite(Date.parse(t)))throw new d("invalid-history-time");return{id:g(e.id,128,"invalid-history-id"),createdAt:t,revision:M(e.revision,0,Number.MAX_SAFE_INTEGER,"invalid-history-revision"),pointCount:M(e.point_count,1,15e5,"invalid-history-points"),sceneUrl:I(e.scene_url,"invalid-history-scene-url")}},Ne=n=>{let e=x(n,"invalid-history");if(!Array.isArray(e.floors)||e.floors.length<1||e.floors.length>128)throw new d("invalid-history-floors");return{entryId:g(e.entry_id,128,"invalid-history-entry"),liveAvailable:b(e.live_available,"invalid-history-live"),floors:e.floors.map(t=>{let r=x(t,"invalid-history-floor");if(!Array.isArray(r.snapshots)||r.snapshots.length>12)throw new d("invalid-history-snapshots");return{id:g(r.id,128,"invalid-history-floor-id"),active:b(r.active,"invalid-history-floor-active"),readOnly:b(r.read_only,"invalid-history-floor-read-only"),liveAvailable:r.live_available===void 0?!1:b(r.live_available,"invalid-history-floor-live"),label:bt(r.label),ordinal:r.ordinal===void 0?null:ve(r.ordinal,128),snapshots:r.snapshots.map(St)}})}},He=n=>{if(n==="vacuum"||n==="mop"||n==="vacuum_and_mop")return n;throw new d("invalid-cleaning-mode")},Be=n=>{if(n==="quick"||n==="standard"||n==="heavy_duty")return n;throw new d("invalid-coverage-setting")},xt=n=>{let e=x(n,"invalid-area-circle");return{x:B(e.x,-1e6,1e6,"invalid-area-circle"),y:B(e.y,-1e6,1e6,"invalid-area-circle"),radius:B(e.radius,.05,2.5,"invalid-area-circle")}},Pt=n=>n==="current"||n==="review"||n==="stale"?n:"unknown",Fe=n=>{let e=x(n,"invalid-areas");if(!Array.isArray(e.areas)||e.areas.length>256)throw new d("invalid-area-list");return{sceneUrl:I(e.scene_url,"invalid-area-scene-url"),rooms:De(e.rooms,!0),areas:e.areas.map(t=>{let r=x(t,"invalid-area");if(!Array.isArray(r.circles)||r.circles.length>512)throw new d("invalid-area-circles");return{id:g(r.id,128,"invalid-area-id"),name:g(r.name,128,"invalid-area-name"),circles:r.circles.map(xt),cleaningMode:He(r.cleaning_mode),coverageSetting:Be(r.coverage_setting),status:Pt(r.status),canRebind:b(r.can_rebind,"invalid-area-rebind")}})}},We=n=>{let e=x(n,"invalid-plans");if(!Array.isArray(e.plans)||e.plans.length>256)throw new d("invalid-plan-list");return{rooms:De(e.rooms,!1).map(({roomId:r,name:o})=>({roomId:r,name:o})),selectedPlan:e.selected_plan===null||e.selected_plan===void 0?null:g(e.selected_plan,128,"invalid-selected-plan"),plans:e.plans.map(r=>{let o=x(r,"invalid-plan");if(!Array.isArray(o.rooms)||o.rooms.length>256||!Array.isArray(o.room_order))throw new d("invalid-plan-rooms");let a=o.run_behavior;if(a!=="intelligent"&&a!=="ordered")throw new d("invalid-run-behavior");return{id:g(o.id,128,"invalid-plan-id"),name:g(o.name,128,"invalid-plan-name"),enabled:b(o.enabled,"invalid-plan-enabled"),runBehavior:a,rooms:o.rooms.map(s=>{let i=x(s,"invalid-plan-room");return{roomId:g(i.room_id,128,"invalid-plan-room-id"),cleaningMode:He(i.cleaning_mode),coverageSetting:Be(i.coverage_setting)}}),roomOrder:o.room_order.slice(0,256).map(s=>g(s,128,"invalid-room-order")),returnToBase:b(o.return_to_base,"invalid-return-to-base"),finishCurrentRoom:b(o.finish_current_room,"invalid-finish-room"),finishCurrentRoomThreshold:M(o.finish_current_room_threshold,0,100,"invalid-finish-threshold")}})}},qe=n=>{let e=x(n,"invalid-pose"),t=e.position,r=t===null?null:ze(t,"invalid-pose-position"),o=e.pose_freshness;if(o!=="live"&&o!=="coordinator_fallback")throw new d("invalid-pose-freshness");return{position:r,source:g(e.source,64,"invalid-pose-source"),revision:M(e.revision,0,Number.MAX_SAFE_INTEGER,"invalid-pose-revision"),poseRevision:M(e.pose_revision,0,Number.MAX_SAFE_INTEGER,"invalid-pose-sequence"),floorCoherent:b(e.map_floor_coherent,"invalid-pose-floor"),freshness:o}},Ve=n=>{try{return I(n,"invalid-private-path"),!0}catch{return!1}};var Ke=n=>{let a=()=>{throw new Error("invalid-scene")};(!(n instanceof ArrayBuffer)||n.byteLength<24||n.byteLength>16777216)&&a();let s=new DataView(n),i=new Uint8Array(n,0,8),u=String.fromCharCode(...i),l=s.getUint16(8,!0),c=s.getUint16(10,!0),p=s.getUint32(12,!0),m=s.getUint32(16,!0),f=s.getUint32(20,!0),k=m+f,C=24+p;(u!=="MATIC3D\0"||l!==1||c!==8||p>1024*1024||k<1||k>15e5||C+k*c!==n.byteLength)&&a();let v;try{v=JSON.parse(new TextDecoder("utf-8",{fatal:!0}).decode(new Uint8Array(n,24,p)))}catch{a()}(!v||typeof v!="object"||Array.isArray(v))&&a();let _=v,R=_.meters_per_cell,w=_.origin_cells,O=_.span_cells;(typeof R!="number"||!Number.isFinite(R)||R<.001||R>.1||!Array.isArray(w)||w.length!==2||!w.every(P=>typeof P=="number"&&Number.isFinite(P))||!Array.isArray(O)||O.length!==2||!O.every(P=>typeof P=="number"&&Number.isFinite(P)&&P>=1&&P<=65536))&&a();let ot=(Array.isArray(_.rooms)?_.rooms.slice(0,128):[]).flatMap((P,it)=>{if(!P||typeof P!="object"||Array.isArray(P))return[];let U=P,K=typeof U.name=="string"?U.name.trim():"";if(!K||Array.from(K).length>128||/[\u0000-\u001f\u007f]/u.test(K))return[];if(!Array.isArray(U.boundary)||U.boundary.length<3||U.boundary.length>8192)return[];let Ae=U.boundary.flatMap(le=>{if(!Array.isArray(le)||le.length!==2)return[];let[ce,de]=le;return typeof ce=="number"&&Number.isFinite(ce)&&typeof de=="number"&&Number.isFinite(de)?[[ce,de]]:[]}),ae=U.center;if(Ae.length<3||!Array.isArray(ae)||ae.length!==2)return[];let[ie,se]=ae;return typeof ie!="number"||!Number.isFinite(ie)||typeof se!="number"||!Number.isFinite(se)?[]:[{id:`scene-room-${it+1}`,name:K,boundary:Ae,center:[ie,se]}]}),at=typeof _.sample_step=="number"&&Number.isInteger(_.sample_step)?Math.max(1,Math.min(15e5,_.sample_step)):1,xe=w,Pe=O;return{buffer:n,pointOffset:C,floorCount:m,surfaceCount:f,total:k,metadata:{metersPerCell:R,origin:[xe[0],xe[1]],span:[Pe[0],Pe[1]],sampleStep:at,rooms:ot}}},Et=n=>{if(n.byteLength>16777216||n.byteLength<24||!1||!1)throw new d("invalid-scene");try{return Ke(n)}catch{throw new d("invalid-scene")}},Rt=()=>`
  const parseTransfer = ${Ke.toString()};
  self.onmessage = (event) => {
    const { id, buffer } = event.data;
    try {
      const parsed = parseTransfer(buffer);
      self.postMessage({ id, ok: true, parsed }, [parsed.buffer]);
    } catch (_) {
      self.postMessage({ id, ok: false, problem: "invalid-scene" });
    }
  };
`,J=class{#e=null;#t=null;#r=0;#n=new Map;constructor(){if(!(typeof Worker!="function"||typeof URL?.createObjectURL!="function"))try{this.#t=URL.createObjectURL(new Blob([Rt()],{type:"text/javascript"})),this.#e=new Worker(this.#t),this.#e.onmessage=e=>{let t=this.#n.get(e.data.id);t&&(this.#n.delete(e.data.id),e.data.ok&&e.data.parsed?t.resolve(e.data.parsed):t.reject(new d(e.data.problem||"invalid-scene")))},this.#e.onerror=()=>this.#a("scene-worker-failed")}catch{this.#e=null,this.#t&&URL.revokeObjectURL(this.#t),this.#t=null}}async parse(e,t){if(t?.aborted)throw new DOMException("Aborted","AbortError");if(!this.#e){if(await new Promise(o=>window.setTimeout(o,0)),t?.aborted)throw new DOMException("Aborted","AbortError");return Et(e)}let r=++this.#r;return new Promise((o,a)=>{let s=()=>{this.#n.delete(r),a(new DOMException("Aborted","AbortError"))};t?.addEventListener("abort",s,{once:!0}),this.#n.set(r,{resolve:i=>{t?.removeEventListener("abort",s),o(i)},reject:i=>{t?.removeEventListener("abort",s),a(i)}}),this.#e?.postMessage({id:r,buffer:e},[e])})}#a(e){for(let t of this.#n.values())t.reject(new d(e));this.#n.clear(),this.#e?.terminate(),this.#e=null}dispose(){this.#a("scene-parser-disposed"),this.#t&&URL.revokeObjectURL(this.#t),this.#t=null}};var L={catalog:1e4,scene:6e4,delta:35e3,pose:1e4,history:15e3,workflow:15e3,mutation:2e4},A=class extends Error{constructor(e,t=null){super(e),this.name="BackendError",this.code=e,this.status=t}},q=36,F=16*1024*1024,je=(n,e)=>{let t=Number(n);if(!Number.isSafeInteger(t)||t<0)throw new d(e);return t},Xe=(n,e)=>{let t=n.headers.get("X-Matic-Revision");if(t===null)return e;let r=Number(t);if(!Number.isSafeInteger(r)||r<0)throw new d("invalid-scene-revision");return r},Ge=(n,e)=>{let t=n.headers.get("X-Matic-Floor-Coherent");if(t===null)return e;if(t==="1")return!0;if(t==="0")return!1;throw new d("invalid-scene-floor-header")},Q=class{#e;#t=new J;constructor(e){this.#e=e}async#r(e,t,r,o){if(!Ve(e))throw new A("invalid-private-path");if(o?.aborted)throw new DOMException("Aborted","AbortError");let a=new AbortController,s=()=>a.abort();o?.addEventListener("abort",s,{once:!0});let i=!1,u=window.setTimeout(()=>{i=!0,a.abort()},r);try{let l=this.#e(),c=new Headers(t.headers),p={...t,cache:"no-store",credentials:"same-origin",headers:Object.fromEntries(c.entries()),signal:a.signal};if(typeof l?.fetchWithAuth=="function")return await l.fetchWithAuth(e,p);let m=l?.auth?.accessToken||l?.auth?.data?.access_token;m&&c.set("Authorization",`Bearer ${m}`);let f=typeof l?.hassUrl=="function"?l.hassUrl(e):e;return await fetch(f,{...p,headers:c})}catch(l){throw i&&!o?.aborted?new A("request-timeout"):a.signal.aborted?new DOMException("Aborted","AbortError"):l}finally{window.clearTimeout(u),o?.removeEventListener("abort",s)}}async#n(e,t,r,o={}){let a=await this.#r(e,{...o,headers:{Accept:"application/json",...o.headers||{}}},t,r);if(!a.ok)throw new A("request-failed",a.status);try{return await a.json()}catch{throw new d("invalid-json-response")}}async catalog(e){return $e(await this.#n(Ue,L.catalog,e))}async scene(e,t,r,o,a,s){let i=new Headers({Accept:"application/vnd.matic.slam-scene"});s&&i.set("If-None-Match",s);let u=await this.#r(e,{headers:i},L.scene,a),l=Xe(u,t),c=Ge(u,r);if(u.status===304)return{scene:null,floorCoherent:c,revision:l,notModified:!0};if(!u.ok)throw new A("scene-request-failed",u.status);if(u.headers.get("Content-Type")?.split(";",1)[0]!=="application/vnd.matic.slam-scene")throw new d("invalid-scene-content-type");return{scene:{...await this.#t.parse(await u.arrayBuffer(),a),revision:l,etag:u.headers.get("ETag"),source:o},floorCoherent:c,revision:l,notModified:!1}}async#a(e,t,r){if(!Number.isSafeInteger(t)||t<1||t>F||typeof DecompressionStream!="function")throw new d("invalid-scene-delta");let a=new Blob([e]).stream().pipeThrough(new DecompressionStream("deflate")).getReader(),s=new Uint8Array(t),i=0,u=()=>{a.cancel()};r?.addEventListener("abort",u,{once:!0});try{for(;;){if(r?.aborted)throw new DOMException("Aborted","AbortError");let{done:l,value:c}=await a.read();if(l)break;if(!(c instanceof Uint8Array)||i+c.byteLength>t)throw new d("invalid-scene-delta");s.set(c,i),i+=c.byteLength}}finally{r?.removeEventListener("abort",u),a.releaseLock()}if(i!==t)throw new d("invalid-scene-delta");return s}async#o(e,t,r){if(e.byteLength<q||e.byteLength>q+F||t.buffer.byteLength>F)throw new d("invalid-scene-delta");let o=new DataView(e),a=new TextDecoder().decode(new Uint8Array(e,0,8)),s=o.getUint16(8,!0),i=o.getUint16(10,!0),u=je(o.getBigUint64(12,!0),"invalid-scene-delta"),l=je(o.getBigUint64(20,!0),"invalid-scene-delta"),c=o.getUint32(28,!0),p=o.getUint32(32,!0);if(a!=="MATICDLT"||s!==1||i!==1||u!==t.revision||l<=t.revision||c<24||c>F||p>F||p+q!==e.byteLength)throw new d("invalid-scene-delta");let m=new Uint8Array(e,q,p),f=new Uint8Array(t.buffer),C=(await this.#a(m,Math.max(f.byteLength,c),r)).slice(),v=1024*1024;for(let w=0;w<f.byteLength;w+=v){if(r?.aborted)throw new DOMException("Aborted","AbortError");let O=Math.min(f.byteLength,w+v);for(let T=w;T<O;T+=1)C[T]=(C[T]??0)^(f[T]??0);O<f.byteLength&&await new Promise(T=>window.setTimeout(T,0))}let _=C.slice(0,c).buffer;return{parsed:{...await this.#t.parse(_,r),revision:l,etag:null,source:"live"},revision:l}}async sceneDelta(e,t,r,o){let a=e.includes("?")?"&":"?",s=await this.#r(`${e}${a}since=${encodeURIComponent(t.revision)}`,{headers:{Accept:"application/vnd.matic.slam-delta, application/vnd.matic.slam-scene"}},L.delta,o),i=Xe(s,t.revision),u=Ge(s,r);if(s.status===204){if(i!==t.revision)throw new d("invalid-scene-delta-revision");return{scene:null,floorCoherent:u,revision:i,notModified:!0}}if(!s.ok)throw new A("delta-request-failed",s.status);if(i<=t.revision)throw new d("invalid-scene-delta-revision");let l=Number(s.headers.get("Content-Length"));if(Number.isFinite(l)&&l>q+F)throw new d("invalid-scene-delta-size");let c=s.headers.get("Content-Type")?.split(";",1)[0],p=await s.arrayBuffer();if(c==="application/vnd.matic.slam-delta"){let f=Number(s.headers.get("X-Matic-Base-Revision"));if(!Number.isSafeInteger(f)||f!==t.revision)throw new d("invalid-scene-delta-base");let k=await this.#o(p,t,o);if(k.revision!==i)throw new d("invalid-scene-delta-revision");return{scene:{...k.parsed,etag:s.headers.get("ETag")},floorCoherent:u,revision:i,notModified:!1}}if(c!=="application/vnd.matic.slam-scene")throw new d("invalid-scene-delta-content-type");return{scene:{...await this.#t.parse(p,o),revision:i,etag:s.headers.get("ETag"),source:"live"},floorCoherent:u,revision:i,notModified:!1}}async pose(e,t){return qe(await this.#n(e,L.pose,t))}async history(e,t){return Ne(await this.#n(e,L.history,t))}async plans(e,t){return We(await this.#n(e,L.workflow,t))}async areas(e,t){return Fe(await this.#n(e,L.workflow,t))}async saveArea(e,t,r){let o=await this.#n(e,L.mutation,r,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...t.areaId?{area_id:t.areaId}:{},name:t.name,circles:t.circles,cleaning_mode:t.cleaningMode,coverage_setting:t.coverageSetting})});if(!o||typeof o!="object"||typeof o.id!="string")throw new d("invalid-area-save-response");return o.id}async deleteArea(e,t,r){let o=await this.#r(`${e}?area_id=${encodeURIComponent(t)}`,{method:"DELETE",headers:{Accept:"application/json"}},L.mutation,r);if(!o.ok)throw new A("area-delete-failed",o.status)}async service(e,t,r,o){let a=this.#e();if(typeof a?.callService!="function")throw new A("service-unavailable");await a.callService(e,t,r,{entity_id:o})}dispose(){this.#t.dispose()}};var Ze=()=>({version:4,view:"top",labels:!0,quality:"auto",cameras:{}}),V=(n,e,t)=>Math.max(e,Math.min(t,n)),Je=n=>n.replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",we=(n,e=4)=>`matic-map-studio:v${e}:${Je(n)}`,It=n=>{if(!n||typeof n!="object")return null;let e=n;return["yaw","pitch","zoom","targetX","targetZ"].every(r=>typeof e[r]=="number"&&Number.isFinite(e[r]))?{yaw:V(e.yaw,-Math.PI,Math.PI),pitch:V(e.pitch,.18,Math.PI/2-.018),zoom:V(e.zoom,.01,100),targetX:V(e.targetX,-1e4,1e4),targetZ:V(e.targetZ,-1e4,1e4)}:null},Ye=n=>{let e=Ze();if(!n||typeof n!="object")return e;let t=n,r=t.view==="three"||t.view==="top"||t.view==="rooms"?t.view:e.view,o=r==="rooms"?"top":r,a=t.quality==="auto"||t.quality==="efficient"||t.quality==="balanced"||t.quality==="maximum"?t.quality:e.quality,s=t.cameras&&typeof t.cameras=="object"?t.cameras:{},i={};for(let u of["three","top"]){let l=It(s[u]);l&&(i[u]=l)}return{version:4,view:o,labels:typeof t.labels=="boolean"?t.labels:e.labels,quality:a,cameras:i}},ee=class{#e="local-user";#t=null;load(e){this.#e=Je(e);try{let t=window.localStorage.getItem(we(this.#e));if(t)return Ye(JSON.parse(t));for(let r of[3,2]){let o=window.localStorage.getItem(we(this.#e,r));if(o)return Ye(JSON.parse(o))}}catch{}return Ze()}schedule(e){this.#t!==null&&window.clearTimeout(this.#t),this.#t=window.setTimeout(()=>{this.#t=null;try{window.localStorage.setItem(we(this.#e),JSON.stringify(e))}catch{}},250)}dispose(){this.#t!==null&&window.clearTimeout(this.#t),this.#t=null}},Qe="matic-map-studio:preferred-frontend",et=()=>{try{return window.localStorage.getItem(Qe)==="v3"?"v3":"v4"}catch{return"v4"}},ke=n=>{try{return window.localStorage.setItem(Qe,n),!0}catch{return!1}};var h=(n,e,t=null)=>({status:n,value:e,problem:t}),E=n=>n instanceof DOMException&&n.name==="AbortError",z=(n,e)=>n instanceof A||n&&typeof n=="object"&&"code"in n&&typeof n.code=="string"?n.code:e,te=n=>[n.selectedFloorOrdinal??"none",n.mapFloorOrdinal??"none",n.mapFloorCoherent?"coherent":"transition"].join(":"),re=n=>[n.mapFloorOrdinal??"none",n.mapSessionVerified?"verified":"unverified"].join(":"),W=n=>[n.entryId,te(n),re(n)].join("|"),tt=n=>[n.entryId,te(n),re(n),n.mapRevision].join("|"),rt=n=>n.runnerLocked||n.stopSettlePending||n.activePlan||n.nativeReconciliationPending||n.nativeSessionActive===!0,_e=(n,e)=>n.label?n.label:n.active?"Current floor":`Saved floor ${n.ordinal??e}`,ne=class{#e;#t=new Ce;#r;#n=new ee;#a=new Map;#o=null;#l;#i=null;#h=null;#s=null;#y=!1;#u="";#m=0;#v="";#p=!1;constructor(e,t){this.#e=e,this.#r=t}sync(e,t){if(!this.#p){if(this.#o=e,this.#l=t,this.#e.patch({host:e.host,activity:e.activity,batteryPercent:e.batteryPercent,robotLabel:e.robotLabel,locale:e.language}),e.userKey!==this.#v){this.#v=e.userKey;let r=this.#n.load(e.userKey);this.#e.patch({view:r.view,labelsVisible:r.labels,quality:r.quality,cameras:r.cameras})}if(!e.host.connected||!e.host.administrator||e.host.robotCount===0){this.#w(),this.#k(e.host.administrator?"map-unavailable":"access-required");return}this.#S(),(this.#e.value.resources.catalog.status==="idle"||e.entryKey&&e.entryKey!==this.#e.value.selection.entryId)&&this.refreshCatalog(!0)}}schedulePreferences(e){this.#n.schedule(e)}#S(){this.#i===null&&(this.#i=window.setInterval(()=>{document.visibilityState==="visible"&&this.refreshCatalog()},5e3)),this.#h===null&&(this.#h=window.setInterval(()=>{document.visibilityState==="visible"&&this.refreshPose()},2e3))}#w(){this.#i!==null&&window.clearInterval(this.#i),this.#h!==null&&window.clearInterval(this.#h),this.#i=null,this.#h=null}#d(e){this.#a.get(e)?.abort();let t=new AbortController;return this.#a.set(e,t),t}#c(e,t){this.#a.get(e)===t&&this.#a.delete(e)}#b(e=[]){for(let[t,r]of this.#a)e.includes(t)||(r.abort(),this.#a.delete(t))}#k(e){this.#b(),this.#t.invalidate(),this.#u="";let t=this.#e.value;this.#e.patch({generation:this.#t.generation,coherence:t.host.administrator?"unavailable":"blocked",fullMap:!1,precisionOpen:!1,resources:{catalog:h("error",null,e),entry:null,scene:h("idle",null),pose:h("idle",null),history:h("idle",null),plans:h("idle",null),areas:h("idle",null)},map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1},selection:{...t.selection,entryId:null,floorId:"current",historyId:null}})}async refreshCatalog(e=!1){if(this.#p||this.#y||!this.#o?.host.administrator)return;this.#y=!0;let t=this.#d("catalog"),r=this.#e.value.resources.catalog.value;this.#e.patch({resources:{...this.#e.value.resources,catalog:h("loading",r)}});try{let o=await this.#r.catalog(t.signal);if(t.signal.aborted||this.#p)return;let a=this.#l?.config?.entry_id,s=typeof a=="string"?a:null,i=o.find(l=>l.entryId===s)||o.find(l=>l.entryId===this.#o?.entryKey)||o[0]||null;if(this.#e.patch({managedLock:i?rt(i):!1,resources:{...this.#e.value.resources,catalog:h(o.length?"ready":"empty",o),entry:i}}),!i){this.#k("no-loaded-robot");return}if(this.#e.value.selection.floorId!=="current"&&!e)return;let u=tt(i);if(!e&&u===this.#u)return;this.#u=u,this.#x(i)}catch(o){if(E(o))return;this.#e.patch({coherence:this.#e.value.resources.scene.value?"degraded":"unavailable",resources:{...this.#e.value.resources,catalog:h("error",r,z(o,"catalog-unavailable"))}})}finally{this.#c("catalog",t),this.#y=!1}}#x(e){let t=this.#t.current(),r=this.#e.value,o=!!(t&&t.entryKey===e.entryId&&t.floorKey===te(e)&&t.missionKey===re(e));this.#b(o?["catalog","plans","areas","plan-mutation","area-mutation"]:["catalog"]);let a=o?r.resources.scene.value:null,s=this.#t.begin(e.entryId,te(e),re(e),e.mapRevision),i=e.mapFloorCoherent&&e.mapSessionVerified,u=e.health==="problem"||e.health==="limited",l=this.#e.value;this.#e.patch({managedLock:rt(e),generation:s.generation,coherence:i?u?"degraded":"current":"verifying",dataMode:"live",resources:{...l.resources,entry:e,scene:h(i?"loading":"idle",a),pose:h(i?"loading":"idle",null),history:h("loading",l.resources.history.value),plans:o?l.resources.plans:h("idle",null),areas:o?l.resources.areas:h("idle",null)},map:{available:i&&a!==null,complete:e.mapComplete&&!e.mapTruncated,floorCoherent:e.mapFloorCoherent,sessionVerified:e.mapSessionVerified,exactPose:!1},floor:{classifiedCount:Math.max(1,e.historyFloorCount),displayName:e.selectedFloorOrdinal?`Floor ${e.selectedFloorOrdinal}`:"Current floor",readOnly:!1},selection:{...l.selection,entryId:e.entryId,floorId:"current",historyId:null,roomIds:o?l.selection.roomIds:[],planId:o?l.selection.planId:null,areaId:o?l.selection.areaId:null}}),this.#M(e,s),i&&(this.#f(e,s),this.#P(e,s))}async#f(e,t){let r=this.#d("scene");try{let o=await this.#r.scene(e.sceneUrl,e.mapRevision,e.mapFloorCoherent,"live",r.signal);if(!this.#t.accepts(t)||o.revision!==t.revision||!o.floorCoherent||!o.scene)return;if(this.#e.patch({resources:{...this.#e.value.resources,scene:h("ready",o.scene)},map:{...this.#e.value.map,available:!0}}),e.deltaUrl){let a=++this.#m;this.#_(e,t,o.scene,a)}}catch(o){if(E(o)||!this.#t.accepts(t))return;if(o instanceof A&&o.code==="request-timeout"){let a=this.#e.value;this.#e.patch({resources:{...a.resources,scene:h("loading",a.resources.scene.value,"scene-building")}}),window.setTimeout(()=>{this.#p||!this.#t.accepts(t)||this.#e.value.selection.floorId!=="current"||this.#f(e,t)},250);return}this.#e.patch({coherence:"degraded",resources:{...this.#e.value.resources,scene:h("error",this.#e.value.resources.scene.value,z(o,"scene-unavailable"))},map:{...this.#e.value.map,available:this.#e.value.resources.scene.value!==null,exactPose:!1}})}finally{this.#c("scene",r)}}async#_(e,t,r,o){if(!e.deltaUrl||typeof DecompressionStream!="function")return;let a=e.deltaUrl,s=e,i=t,u=r;try{for(;!this.#p&&o===this.#m&&this.#t.accepts(i)&&this.#e.value.selection.floorId==="current";){let l=this.#d("delta");try{let c=await this.#r.sceneDelta(a,u,s.mapFloorCoherent,l.signal);if(l.signal.aborted||this.#p||o!==this.#m||!this.#t.accepts(i))return;if(!c.floorCoherent){this.#e.patch({coherence:"verifying",map:{...this.#e.value.map,available:!1,floorCoherent:!1,exactPose:!1},resources:{...this.#e.value.resources,pose:h("idle",null)}}),this.#u="",this.refreshCatalog(!0);return}if(c.notModified||!c.scene){await new Promise(f=>window.setTimeout(f,100));continue}let p=this.#t.advance(i,c.revision);if(!p)return;i=p,u=c.scene,s={...s,mapRevision:c.revision},this.#u=tt(s);let m=this.#e.value;this.#e.patch({resources:{...m.resources,entry:s,scene:h("ready",u),pose:h("loading",m.resources.pose.value)},map:{...m.map,available:!0,floorCoherent:!0,exactPose:!1}}),this.#P(s,i)}finally{this.#c("delta",l)}}}catch(l){if(E(l)||this.#p||o!==this.#m||!this.#t.accepts(i))return;this.#e.patch({coherence:"degraded",notice:{tone:"warning",text:"Live map updates paused while the current map is rechecked."},map:{...this.#e.value.map,exactPose:!1}}),this.#u="",this.refreshCatalog(!0)}}async#M(e,t){let r=this.#d("history");try{let o=await this.#r.history(e.historyUrl,r.signal);if(!this.#t.accepts(t)||o.entryId!==e.entryId)return;let a=o.floors.find(s=>s.active)||o.floors[0];if(!a)return;this.#e.patch({resources:{...this.#e.value.resources,history:h("ready",o)},floor:{...this.#e.value.floor,classifiedCount:o.floors.length,displayName:_e(a,1)}})}catch(o){if(E(o)||!this.#t.accepts(t))return;this.#e.patch({resources:{...this.#e.value.resources,history:h("error",null,z(o,"history-unavailable"))}})}finally{this.#c("history",r)}}async refreshPose(){let e=this.#e.value.resources.entry,t=this.#t.current();!e||!t||this.#e.value.selection.floorId!=="current"||!e.mapFloorCoherent||!e.mapSessionVerified||await this.#P(e,t)}async#P(e,t){let r=this.#d("pose");try{let o=await this.#r.pose(e.poseUrl,r.signal);if(!this.#t.accepts(t)||o.revision!==t.revision||!o.floorCoherent)return;this.#e.patch({resources:{...this.#e.value.resources,pose:h("ready",o)},map:{...this.#e.value.map,exactPose:o.position!==null&&o.freshness==="live"}})}catch(o){if(E(o)||!this.#t.accepts(t))return;this.#e.patch({resources:{...this.#e.value.resources,pose:h("error",null,z(o,"pose-unavailable"))},map:{...this.#e.value.map,exactPose:!1}})}finally{this.#c("pose",r)}}async selectFloor(e){let t=this.#e.value.resources.history.value,r=this.#e.value.resources.entry;if(!t||!r)return;let o=t.floors.find(i=>i.id===e);if(!o)return;if(o.active){this.#u="",this.#e.dispatch({type:"set-floor",floorId:"current"}),await this.refreshCatalog(!0);return}let a=o.snapshots.at(-1);this.#b(["catalog"]);let s=this.#t.begin(r.entryId,o.id,a?.id||o.id,a?.revision||0);this.#e.patch({generation:s.generation,coherence:"current",dataMode:"history",floor:{classifiedCount:t.floors.length,displayName:_e(o,t.floors.indexOf(o)+1),readOnly:!0},selection:{...this.#e.value.selection,floorId:o.id,historyId:a?.id||null},resources:{...this.#e.value.resources,scene:h(a?"loading":"empty",null),pose:h("idle",null)},map:{available:!1,complete:!0,floorCoherent:!0,sessionVerified:!0,exactPose:!1}}),a&&await this.#A(a,s)}async selectHistory(e){let t=this.#e.value.resources.history.value,r=this.#e.value.resources.entry;if(!t||!r)return;if(!e){await this.selectFloor("current");return}let o=t.floors.find(i=>i.snapshots.some(u=>u.id===e)),a=o?.snapshots.find(i=>i.id===e);if(!o||!a)return;let s=this.#t.begin(r.entryId,o.id,a.id,a.revision);this.#b(["catalog"]),this.#e.patch({generation:s.generation,dataMode:"history",floor:{classifiedCount:t.floors.length,displayName:_e(o,t.floors.indexOf(o)+1),readOnly:!0},selection:{...this.#e.value.selection,floorId:o.id,historyId:a.id},resources:{...this.#e.value.resources,scene:h("loading",null),pose:h("idle",null)},map:{...this.#e.value.map,available:!1,exactPose:!1}}),await this.#A(a,s)}async#A(e,t){let r=this.#d("history-scene");try{let o=await this.#r.scene(e.sceneUrl,e.revision,!0,"history",r.signal);if(!this.#t.accepts(t)||!o.scene)return;this.#e.patch({resources:{...this.#e.value.resources,scene:h("ready",o.scene)},map:{...this.#e.value.map,available:!0,exactPose:!1}})}catch(o){if(E(o)||!this.#t.accepts(t))return;this.#e.patch({resources:{...this.#e.value.resources,scene:h("error",null,z(o,"history-scene-unavailable"))}})}finally{this.#c("history-scene",r)}}async openWorkflow(e){this.#e.dispatch({type:"open-workflow",workflow:e}),(e==="plan"||e==="rooms")&&await this.loadPlans(),(e==="draw"||e==="areaReview")&&await this.loadAreas()}async loadPlans(){let e=this.#e.value.resources.entry;if(!e||!this.#t.current()||!$(this.#e.value))return;let t=W(e),r=this.#d("plans");this.#e.patch({resources:{...this.#e.value.resources,plans:h("loading",null)}});try{let o=await this.#r.plans(e.plansUrl,r.signal),a=this.#e.value.resources.entry;if(!a||W(a)!==t)return;this.#e.patch({resources:{...this.#e.value.resources,plans:h("ready",o)},selection:{...this.#e.value.selection,planId:o.selectedPlan||o.plans[0]?.id||null}}),this.selectPlan(o.selectedPlan||o.plans[0]?.id||null)}catch(o){let a=this.#e.value.resources.entry;if(E(o)||!a||W(a)!==t)return;this.#e.patch({resources:{...this.#e.value.resources,plans:h("error",null,z(o,"plans-unavailable"))}})}finally{this.#c("plans",r)}}selectPlan(e){let t=this.#e.value.resources.plans.value?.plans.find(r=>r.id===e);this.#e.patch({selection:{...this.#e.value.selection,planId:e},planDraft:t?this.#E(t):{...this.#e.value.planDraft,id:null,name:"",rooms:[],dirty:!1}})}#E(e){return{id:e.id,name:e.name,enabled:e.enabled,runBehavior:e.runBehavior,rooms:(e.roomOrder.length?e.roomOrder.flatMap(t=>{let r=e.rooms.find(o=>o.roomId===t);return r?[r]:[]}):e.rooms).map(t=>({...t})),returnToBase:e.returnToBase,finishCurrentRoom:e.finishCurrentRoom,finishCurrentRoomThreshold:e.finishCurrentRoomThreshold,dirty:!1}}async loadAreas(){let e=this.#e.value.resources.entry;if(!e||!this.#t.current()||!$(this.#e.value))return;let t=W(e),r=this.#d("areas");this.#e.patch({resources:{...this.#e.value.resources,areas:h("loading",null)}});try{let o=await this.#r.areas(e.areasUrl,r.signal),a=this.#e.value.resources.entry;if(!a||W(a)!==t||o.sceneUrl!==a.sceneUrl)return;this.#e.patch({resources:{...this.#e.value.resources,areas:h("ready",o)}}),this.selectArea(o.areas[0]?.id||null)}catch(o){let a=this.#e.value.resources.entry;if(E(o)||!a||W(a)!==t)return;this.#e.patch({resources:{...this.#e.value.resources,areas:h("error",null,z(o,"areas-unavailable"))}})}finally{this.#c("areas",r)}}selectArea(e){let t=this.#e.value.resources.areas.value?.areas.find(o=>o.id===e),r=this.#e.value;this.#e.patch({selection:{...r.selection,areaId:e},areaDraft:t?this.#R(t):{id:null,name:"",cleaningMode:"vacuum",coverageSetting:"standard",status:"new",canRebind:!1,dirty:!1},draw:{...r.draw,circles:t?.circles||[],undo:[],redo:[],dirty:!1,strokeCount:0}})}#R(e){return{id:e.id,name:e.name,cleaningMode:e.cleaningMode,coverageSetting:e.coverageSetting,status:e.status,canRebind:e.canRebind,dirty:!1}}async saveArea(){let e=this.#e.value,t=e.resources.entry,r=e.areaDraft;if(!t||!$(e)||!r.name.trim()||!e.draw.circles.length)return;let o=this.#d("area-mutation");this.#e.patch({command:"pending",notice:{tone:"info",text:"Saving area\u2026"}});try{let a=await this.#r.saveArea(t.areasUrl,{areaId:r.id,name:r.name.trim(),circles:e.draw.circles,cleaningMode:r.cleaningMode,coverageSetting:r.coverageSetting},o.signal);this.#e.patch({command:"idle",notice:{tone:"success",text:"Area saved"}}),await this.loadAreas(),this.selectArea(a)}catch(a){if(E(a))return;this.#e.patch({command:"failed",notice:{tone:"error",text:"Area could not be saved"}})}finally{this.#c("area-mutation",o)}}async deleteArea(){let e=this.#e.value.resources.entry,t=this.#e.value.selection.areaId;if(!e||!t||!$(this.#e.value))return;let r=this.#d("area-mutation");try{await this.#r.deleteArea(e.areasUrl,t,r.signal),this.#e.patch({notice:{tone:"success",text:"Area deleted"}}),await this.loadAreas()}catch(o){E(o)||this.#e.patch({notice:{tone:"error",text:"Area could not be deleted"}})}finally{this.#c("area-mutation",r)}}async savePlan(){let e=this.#e.value,t=e.planDraft,r=e.resources.plans.value;if(!r||!t.name.trim()||!t.rooms.length||!$(e))return;let o=t.rooms;await this.#C("save_plan",{...t.id?{plan_id:t.id}:{},name:t.name.trim(),enabled:t.enabled,run_behavior:t.runBehavior,rooms:o.map(a=>({room:r.rooms.find(s=>s.roomId===a.roomId)?.name,cleaning_mode:a.cleaningMode,coverage_setting:a.coverageSetting})).filter(a=>a.room),return_to_base:t.returnToBase,finish_current_room:t.finishCurrentRoom,finish_current_room_threshold:t.finishCurrentRoomThreshold,select:!t.id||r.selectedPlan===t.id},"Plan saved","Plan could not be saved"),await this.loadPlans()}async deletePlan(){let e=this.#e.value.selection.planId;e&&(await this.#C("delete_plan",{plan:e},"Plan deleted","Plan could not be deleted"),await this.loadPlans())}async executeAction(e){switch(e){case"stop":this.#e.value.resources.entry?.activePlan||this.#e.value.resources.entry?.runnerLocked?await this.#g("matic_robot","stop_intelligent_cleaning",{}):await this.#g("vacuum","return_to_base",{});return;case"resume":await this.#g("vacuum","start",{});return;case"run-plan":{let t=this.#e.value.selection.planId||this.#e.value.resources.plans.value?.selectedPlan;t&&await this.#g("matic_robot","run_selected_plan",{plan:t});return}case"clean-rooms":{let t=this.#e.value.resources.plans.value,r=this.#e.value.selection.roomIds,o=t?.rooms.filter(a=>r.includes(a.roomId)).map(a=>a.name)||[];o.length&&await this.#g("matic_robot","clean",{rooms:o,ordered:!1,cleaning_mode:this.#e.value.selection.cleaningMode,coverage_setting:this.#e.value.selection.coverageSetting});return}case"run-area":{let t=this.#e.value.selection.areaId;t&&await this.#g("matic_robot","clean_area",{area:t});return}case"review-area":this.#e.dispatch({type:"open-workflow",workflow:"areaReview"});return;case"save-area":await this.saveArea();return;case"save-plan":await this.savePlan();return;case"delete-plan":await this.deletePlan();return;case"delete-area":await this.deleteArea();return}}async#C(e,t,r,o){let a=this.#o?.vacuumEntityId;if(!(!a||!$(this.#e.value)||this.#e.value.command==="pending")){this.#e.patch({command:"pending",notice:{tone:"info",text:"Saving\u2026"}});try{await this.#r.service("matic_robot",e,t,a),this.#e.patch({command:"idle",notice:{tone:"success",text:r}})}catch{this.#e.patch({command:"failed",notice:{tone:"error",text:o}})}}}async#g(e,t,r){let o=this.#e.value,a=this.#o?.vacuumEntityId,i=(t==="stop_intelligent_cleaning"||e==="vacuum"&&t==="return_to_base")&&o.command==="idle"&&(o.activity==="cleaning"||o.activity==="paused"||o.activity==="returning");if(!(!a||!i&&!Me(o))){this.#e.patch({command:"pending",notice:null});try{await this.#r.service(e,t,r,a),this.#e.patch({command:"settling"}),this.#s!==null&&window.clearTimeout(this.#s),this.#s=window.setTimeout(()=>{this.#s=null,this.#e.value.command==="settling"&&this.#e.patch({command:"idle"})},15e3)}catch{this.#e.patch({command:"failed",notice:{tone:"error",text:"The robot did not accept that action"}})}}}updateDraftCircles(e,t=!0,r){this.#e.dispatch({type:"set-draft-circles",circles:e,record:t,...r?{previous:r}:{}}),this.#e.dispatch({type:"patch-area-draft",patch:{dirty:!0}})}dispose(){this.#p||(this.#p=!0,this.#w(),this.#b(),this.#s!==null&&window.clearTimeout(this.#s),this.#s=null,this.#n.dispose(),this.#r.dispose(),this.#t.invalidate())}};var nt=n=>(n.workflow==="none"?0:1)+(n.fullMap?1:0)+(n.precisionOpen?1:0)+(n.dialog?1:0),Lt=n=>{if(!n||typeof n!="object")return null;let e=n.maticMapLayer;if(!e||typeof e!="object")return null;let t=e.owner,r=e.depth;return typeof t=="string"&&Number.isInteger(r)&&Number(r)>=0?{owner:t,depth:Number(r)}:null},oe=class{#e;#t=`matic-map-${crypto.randomUUID?.()||Math.random().toString(36).slice(2)}`;#r=0;#n=null;#a=!1;constructor(e){this.#e=e}start(){this.#n||(this.#r=nt(this.#e.value),this.#n=this.#e.subscribe(e=>this.#o(e)),window.addEventListener("popstate",this.#l))}#o(e){let t=nt(e);if(this.#a){this.#a=!1,this.#r=t;return}if(t>this.#r)for(let r=this.#r+1;r<=t;r+=1){let o=history.state&&typeof history.state=="object"?history.state:{};history.pushState({...o,maticMapLayer:{owner:this.#t,depth:r}},"",window.location.href)}this.#r=t}#l=()=>{this.#r<1||(this.#a=!0,this.#e.dispatch({type:"dismiss-top-layer"}))};dismissTop(){if(this.#r<1)return!1;let e=Lt(history.state);return e?.owner===this.#t&&e.depth===this.#r?history.back():this.#e.dispatch({type:"dismiss-top-layer"}),!0}dispose(){this.#n?.(),this.#n=null,window.removeEventListener("popstate",this.#l),this.#r=0}};var Se=class extends N{constructor(){super(...arguments);this.narrow=!1;this._workspace=D();this._classic=!1;this.#e=new Z;this.#t=new X(this._workspace);this.#r=null;this.#n=null;this.#a=null;this.#o=null;this.#l=null;this.#i=""}static{this.properties={hass:{attribute:!1},narrow:{type:Boolean},route:{attribute:!1},panel:{attribute:!1},_workspace:{state:!0},_classic:{state:!0}}}#e;#t;#r;#n;#a;#o;#l;#i;connectedCallback(){super.connectedCallback(),this._classic=et()==="v3",this.#n=this.#t.subscribe(t=>{this._workspace=t,this.#y(t)}),this._classic||this.#h()}disconnectedCallback(){this.#n?.(),this.#n=null,this.#s(),super.disconnectedCallback()}#h(){this.#o||(this.#a=new Q(()=>this.hass),this.#o=new ne(this.#t,this.#a),this.#l=new oe(this.#t),this.#l.start(),this.#r&&this.#o.sync(this.#r,this.panel))}#s(){this.#l?.dispose(),this.#l=null,this.#o?.dispose(),this.#o=null,this.#a=null}#y(t){if(!this.#o)return;let r={version:4,view:t.view,labels:t.labelsVisible,quality:t.quality,cameras:t.cameras},o=JSON.stringify(r);o!==this.#i&&(this.#i=o,this.#o.schedulePreferences(r))}willUpdate(t){if(t.has("hass")||t.has("panel")){let r=this.#e.project(this.hass,this.panel);if(r!==this.#r){this.#r=r;let o=r.host.connected?r.host.robotCount===0?"unavailable":r.host.administrator?"verifying":"blocked":"degraded";this.#t.replace({...this.#t.value,coherence:o,activity:r.activity,batteryPercent:r.batteryPercent,host:r.host,fullMap:r.host.administrator&&r.host.robotCount>0&&this.#t.value.fullMap,robotLabel:r.robotLabel,locale:r.language})}this._classic||this.#o?.sync(r,this.panel)}t.has("narrow")&&this.#t.value.narrowHint!==this.narrow&&this.#t.dispatch({type:"set-narrow-hint",value:this.narrow})}#u(t){if(!j(t.detail))return;t.stopPropagation();let r=t.detail;if(r.type==="dismiss-top-layer"||r.type==="exit-full-map"){this.#l?.dismissTop()||this.#t.dispatch(r);return}if(r.type==="open-workflow"&&r.workflow!=="none"){this.#o?.openWorkflow(r.workflow);return}if(r.type==="set-floor"){this.#o?.selectFloor(r.floorId);return}if(r.type==="set-history"){this.#o?.selectHistory(r.historyId);return}if(r.type==="select-plan"){this.#o?.selectPlan(r.planId);return}if(r.type==="select-area"){this.#o?.selectArea(r.areaId);return}this.#t.dispatch(r)}#m(t){if(t.stopPropagation(),typeof t.detail?.id=="string"){if(t.detail.id==="use-classic"){ke("v3")&&(this.#s(),this._classic=!0);return}this.#o?.executeAction(t.detail.id),this.dispatchEvent(new CustomEvent("matic-map-v4-action-requested",{detail:{id:t.detail.id},bubbles:!0,composed:!0}))}}#v(){ke("v4")&&(this._classic=!1,this.#h(),this.requestUpdate())}updated(){if(!this._classic)return;let t=this.renderRoot.querySelector("matic-map-panel-v0-3-1");t&&(t.hass=this.hass,t.narrow=this.narrow,t.route=this.route,t.panel=this.panel)}getWorkspaceSnapshot(){return this.#t.value}render(){return this._classic?y`
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
    `}};customElements.get("matic-map-panel-v0-4-0")||customElements.define("matic-map-panel-v0-4-0",Se);export{Ce as CoherenceMachine,$t as DRAW_BRUSH_MAX_METERS,Ut as DRAW_BRUSH_MIN_METERS,fe as GALLERY_SCENARIOS,Z as HassAdapter,zt as MAP_PIXELS_PER_METER_AT_100,Ot as MAP_ZOOM_MAX,Tt as MAP_ZOOM_MIN,Se as MaticMapPanelV4,be as MaticMapStudioGalleryV4,X as WorkspaceStore,Wt as brushCursorPixels,$ as canEditCoordinates,Ft as canShowExactPose,Bt as canShowLiveMap,Me as canStartMotion,Vt as commandState,me as createGalleryState,D as initialWorkspaceState,j as isWorkspaceIntent,qt as mapScale,Nt as normalizeBrush,Dt as normalizeZoom,Ht as reduceWorkspace,Re as selectPausedSecondaryAction,Ee as selectPrimaryAction};
