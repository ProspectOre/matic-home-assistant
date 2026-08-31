import{A as ue,a as Dt,b as Ht,c as Bt,d as Ft,e as Wt,f as j,g as Kt,h as Vt,i as N,j as qt,k as X,l as Ae,m as jt,n as Xt,o as z,p as Ee,q as Me,r as Re,s as Gt,t as Yt,u as Zt,v as G,w as y,x as S,y as H,z as Ie}from"./chunks/chunk.js";var Le="a".repeat(64),B=[{roomId:"room-a",name:"Kitchen",boundary:[[.5,.5],[4,.5],[4,3],[.5,3]]},{roomId:"room-b",name:"Living room",boundary:[[4.2,.5],[8.5,.5],[8.5,3.4],[4.2,3.4]]},{roomId:"room-c",name:"Office",boundary:[[.5,3.2],[3.8,3.2],[3.8,6.5],[.5,6.5]]},{roomId:"room-d",name:"Bedroom",boundary:[[4,3.6],[8.5,3.6],[8.5,6.5],[4,6.5]]}],Te=()=>{let n=[180,140],e={meters_per_cell:.05,origin_cells:[0,0],span_cells:n,sample_step:1,rooms:B.map(l=>{let c=l.boundary.map(([m,f])=>[m/.05,f/.05]),p=[c.reduce((m,[f])=>m+f,0)/c.length,c.reduce((m,[,f])=>m+f,0)/c.length];return{name:l.name,boundary:c,boundary_closed:!0,center:p}})},t=new TextEncoder().encode(JSON.stringify(e)),r=[];for(let l=10;l<130;l+=2)for(let c=10;c<170;c+=2){let p=c<80?l<65?0:2:l<72?1:3,m=[[185,219,224],[201,211,233],[210,226,194],[232,207,207]][p]||[190,205,215];r.push([c,l,0,...m])}let o=500;for(let l=0;l<o;l+=1){let c=l%4,p=l*7%120,m=c<2?c===0?10:168:10+p,f=c>=2?c===2?10:128:10+p;r.push([m,f,10+l%18,104,122,137])}let a=r.length-o,i=new ArrayBuffer(24+t.byteLength+r.length*8),s=new DataView(i);new Uint8Array(i,0,8).set(new TextEncoder().encode("MATIC3D\0")),s.setUint16(8,1,!0),s.setUint16(10,8,!0),s.setUint32(12,t.byteLength,!0),s.setUint32(16,a,!0),s.setUint32(20,o,!0),new Uint8Array(i,24,t.byteLength).set(t);let d=new DataView(i,24+t.byteLength);return r.forEach(([l=0,c=0,p=0,m=0,f=0,k=0],A)=>{let v=A*8;d.setUint16(v,l,!0),d.setUint16(v+2,c,!0),d.setUint8(v+4,p),d.setUint8(v+5,m),d.setUint8(v+6,f),d.setUint8(v+7,k)}),{buffer:i,pointOffset:24+t.byteLength,floorCount:a,surfaceCount:o,total:r.length,revision:7,etag:'"synthetic-scene"',source:"live",metadata:{metersPerCell:.05,origin:[0,0],span:n,sampleStep:1,rooms:e.rooms.map((l,c)=>({id:B[c]?.roomId||`room-${c}`,name:l.name,boundary:l.boundary,center:l.center}))}}},Y=()=>({entryId:"synthetic-entry",sceneUrl:"/api/matic_robot/slam_scene/synthetic",deltaUrl:"/api/matic_robot/slam_delta/synthetic",poseUrl:"/api/matic_robot/slam_pose/synthetic",historyUrl:"/api/matic_robot/slam_history/synthetic",areasUrl:"/api/matic_robot/areas/synthetic",plansUrl:"/api/matic_robot/plans/synthetic",mapRevision:7,mapFloorCoherent:!0,mapSessionVerified:!0,mapSessionKey:Le,mapBlockReason:null,runnerLocked:!1,stopSettlePending:!1,activePlan:!1,nativeReconciliationPending:!1,nativeSessionActive:!1,mapComplete:!0,mapTruncated:!1,selectedFloorOrdinal:1,mapFloorOrdinal:1,historyCount:2,historyFloorCount:2,health:"ready",streamFailures:0,bootstrapState:"complete",bootstrapPhotoSeen:!0,bootstrapStructureSeen:!0,bootstrapFailures:0}),pe=()=>({rooms:B.map(({roomId:n,name:e})=>({roomId:n,name:e})),selectedPlan:"daily",plans:[{id:"daily",name:"Daily clean",enabled:!0,runBehavior:"intelligent",rooms:B.slice(0,3).map(({roomId:n})=>({roomId:n,cleaningMode:"vacuum",coverageSetting:"standard"})),roomOrder:B.slice(0,3).map(({roomId:n})=>n),returnToBase:!0,finishCurrentRoom:!1,finishCurrentRoomThreshold:50}]}),he=()=>({sceneUrl:Y().sceneUrl,rooms:B.map(n=>({...n,boundary:n.boundary.map(e=>[...e])})),areas:[{id:"entryway",name:"Entryway",circles:[{x:1.5,y:1.4,radius:.3},{x:1.9,y:1.6,radius:.3}],cleaningMode:"vacuum",coverageSetting:"standard",status:"current",canRebind:!1}]}),Oe=()=>({entryId:"synthetic-entry",liveAvailable:!0,floors:[{id:"current",active:!0,readOnly:!1,liveAvailable:!0,label:"House",ordinal:null,snapshots:[{id:"current-old",createdAt:"2026-08-29T14:00:00Z",revision:6,pointCount:5300,sceneUrl:"/synthetic-history-current-old"},{id:"current-new",createdAt:"2026-08-29T16:12:00Z",revision:7,pointCount:5300,sceneUrl:"/synthetic-history-current-new"}]},{id:"saved-1",active:!1,readOnly:!0,liveAvailable:!1,label:"Shed",ordinal:2,snapshots:[{id:"saved-one",createdAt:"2026-08-28T11:30:00Z",revision:3,pointCount:3100,sceneUrl:"/synthetic-history-saved"}]}]}),Ne=()=>({position:[92,74],source:"latest_pose",revision:7,poseRevision:4,floorCoherent:!0,mapSessionKey:Le,freshness:"live"});var ut=()=>({...N(),coherence:"current",activity:"docked",batteryPercent:92,host:{connected:!0,administrator:!0,robotConnected:!0,robotCount:1},floor:{classifiedCount:2,displayName:"House",readOnly:!1},map:{available:!0,complete:!0,floorCoherent:!0,sessionVerified:!0,exactPose:!0},resources:{catalog:{status:"ready",value:[Y()],problem:null},entry:Y(),scene:{status:"ready",value:Te(),problem:null},pose:{status:"ready",value:Ne(),problem:null},history:{status:"ready",value:Oe(),problem:null},plans:{status:"ready",value:pe(),problem:null},areas:{status:"ready",value:he(),problem:null}},selection:{...N().selection,entryId:"synthetic-entry",planId:"daily"},planDraft:{...N().planDraft,id:"daily",name:"Daily clean",rooms:pe().plans[0]?.rooms||[]}}),me=n=>{let e=ut();switch(n){case"ready":return e;case"cleaning":return{...e,activity:"cleaning"};case"paused":return{...e,activity:"paused"};case"returning":return{...e,activity:"returning"};case"rooms":return{...e,workflow:"rooms"};case"draw":return{...e,workflow:"draw",areaDraft:{...e.areaDraft,id:"entryway",name:"Entryway",status:"current"},selection:{...e.selection,areaId:"entryway"},draw:{...e.draw,dirty:!0,strokeCount:3,circles:he().areas[0]?.circles||[]}};case"history":return{...e,dataMode:"history",workflow:"history",floor:{...e.floor,readOnly:!0},map:{...e.map,exactPose:!1},selection:{...e.selection,floorId:"saved-1",historyId:"saved-one"}};case"transition":return{...e,coherence:"verifying",activity:"unknown",map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1}};case"problem":return{...e,activity:"problem",coherence:"blocked"};case"ha-offline":return{...e,coherence:"degraded",host:{...e.host,connected:!1},map:{...e.map,exactPose:!1}};case"robot-offline":return{...e,coherence:"degraded",host:{...e.host,robotConnected:!1},map:{...e.map,exactPose:!1}};case"access":return{...e,coherence:"blocked",host:{...e.host,administrator:!1},map:{...e.map,available:!1,exactPose:!1}};case"empty":return{...e,coherence:"unavailable",host:{...e.host,robotConnected:!1,robotCount:0},map:{...e.map,available:!1,exactPose:!1}};case"unsupported":return{...e,coherence:"blocked",map:{...e.map,available:!1,exactPose:!1}};case"multi-robot":return{...e,host:{...e.host,robotCount:2}}}},fe=["ready","cleaning","paused","returning","rooms","draw","history","transition","problem","ha-offline","robot-offline","access","empty","unsupported","multi-robot"];var pt=n=>{switch(n){case"cleaning":return"cleaning";case"paused":return"paused";case"returning":return"returning";case"docked":return"docked";case"idle":return"idle";case"error":return"problem";default:return"unknown"}},ht=n=>typeof n!="number"||!Number.isFinite(n)?null:Math.round(Math.max(0,Math.min(100,n))),mt=n=>{let e=n.attributes?.matic_entry_id;return typeof e=="string"&&e.length>0?e:null},ft=n=>String(n||"local-user").replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",yt=n=>{if(typeof n!="string")return"Matic robot";let e=n.trim();return e&&Array.from(e).length<=128&&!/[\u0000-\u001f\u007f]/u.test(e)?e:"Matic robot"},Z=class{#e="";#t=null;project(e,t){let r=e?.states??{},o=t?.config?.entry_id,a=typeof o=="string"?o:null,i=new Set,s=null,d=null,l=null;for(let[_,I]of Object.entries(r)){let w=mt(I);w&&(i.add(w),_.startsWith("vacuum.")&&(!s||a&&w===a)&&(s=I,d=_,l=w))}let c={connected:e?.connected!==!1,administrator:e?.user?.is_admin===!0,robotConnected:s!==null&&s.state!=="unavailable"&&s.state!=="unknown",robotCount:i.size},p=s?pt(s.state):"unknown",m=ht(s?.attributes?.battery_level),f=e?.selectedLanguage||e?.language||"en",k=ft(e?.user?.id),A=yt(s?.attributes?.friendly_name),v=[c.connected,c.administrator,c.robotConnected,c.robotCount,p,m??"none",f,k,d??"none",l??"none",A].join("|");return v===this.#e&&this.#t?this.#t:(this.#e=v,this.#t={host:c,activity:p,batteryPercent:m,language:f,userKey:k,vacuumEntityId:d,entryKey:l,robotLabel:A},this.#t)}};var bt=n=>{if(!n.host.connected)return{title:"Reconnecting",detail:"Home Assistant is offline"};if(!n.host.administrator)return{title:"Access required",detail:"Administrator only"};if(n.host.robotCount===0)return{title:"No robot",detail:"Set up a Matic robot"};if(!n.host.robotConnected)return{title:"Robot offline",detail:"Last verified map \xB7 read only"};if(n.activity==="problem")return{title:"Needs attention",detail:"Check the robot"};if(n.dataMode==="history"){let t=n.resources.history.value?.floors.find(a=>a.id===n.selection.floorId),r=t?.snapshots.findIndex(a=>a.id===n.selection.historyId)??-1,o=t?.snapshots.length??0;return{title:"Saved map",detail:r>=0?`Read only \xB7 ${r+1} of ${o}`:"Read only"}}if(n.coherence==="verifying"||n.coherence==="booting")return{title:"Locating",detail:"Finding the current map"};if(n.activity==="cleaning")return{title:"Cleaning",detail:"Cleaning in progress"};if(n.activity==="paused")return{title:"Paused",detail:"Cleaning can resume"};if(n.activity==="returning")return{title:"Returning",detail:"Going to the dock"};if(n.activity==="stopping")return{title:"Stopping",detail:"Waiting for the robot"};let e=n.batteryPercent===null?"Ready":`${n.batteryPercent}% battery`;return{title:n.activity==="docked"?"Docked":"Ready",detail:e}},vt=n=>{switch(n.workflow){case"rooms":return{title:"Choose rooms",description:"Select on the map or from the list."};case"draw":return{title:"Draw an area",description:"Paint on the verified map, then review the details."};case"plan":return{title:"Plan",description:"Review rooms and cleaning settings."};case"areaReview":return{title:"Area details",description:"Name the area and choose cleaning settings."};case"history":return{title:"Map history",description:"Saved maps are floor-scoped and read only."};case"support":return{title:"Map support",description:"Private geometry is never included."};case"none":return{title:"Clean",description:"Start with a saved plan, rooms, or an area."}}},gt=n=>{switch(n){case"discardDraft":return{title:"Discard this area?",detail:"The outline has not been saved. You can keep drawing or discard it.",cancelLabel:"Keep drawing",confirmLabel:"Discard",action:"discard"};case"confirmDeletePlan":return{title:"Delete this plan?",detail:"This removes the saved plan from Home Assistant. The robot will not move.",cancelLabel:"Cancel",confirmLabel:"Delete plan",action:"delete-plan"};case"confirmDeleteArea":return{title:"Delete this area?",detail:"This removes the saved outline from Home Assistant. The robot will not move.",cancelLabel:"Cancel",confirmLabel:"Delete area",action:"delete-area"};case"confirmStop":return{title:"Stop cleaning?",detail:"The robot may take a moment to settle before another action is available.",cancelLabel:"Keep cleaning",confirmLabel:"Stop",action:"stop"};case"error":return{title:"Something went wrong",detail:"No action was started. Close this message and try again when the map is ready.",cancelLabel:"Close",confirmLabel:"Close",action:null};case null:return null}},wt=(n=document)=>{let e=n.activeElement;for(;e?.shadowRoot?.activeElement;)e=e.shadowRoot.activeElement;return e},ye=class extends H{constructor(){super(...arguments);this.state=N();this._measuredNarrow=!1;this._sheetOffset=0;this._workflowReady=!1;this._overflowOpen=!1;this._sheetDetent="peek";this.#e=null;this.#t=null;this.#r=null;this.#n=null;this.#a=null;this.#o=null;this.#l=t=>{if(!this._overflowOpen)return;let r=this.renderRoot.querySelector(".overflow-wrap");(!r||!t.composedPath().includes(r))&&(this._overflowOpen=!1)}}static{this.properties={state:{attribute:!1},_measuredNarrow:{state:!0},_sheetOffset:{state:!0},_workflowReady:{state:!0},_overflowOpen:{state:!0},_sheetDetent:{state:!0}}}static{this.styles=G`
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
  `}#e;#t;#r;#n;#a;#o;#l;connectedCallback(){super.connectedCallback(),this.#e=new ResizeObserver(([t])=>{if(!t)return;let r=t.contentRect.width<768||t.contentRect.height<480;r!==this._measuredNarrow&&(this._measuredNarrow=r)}),this.#e.observe(this),window.addEventListener("pointerdown",this.#l,!0),this.#t=new ResizeObserver(([t])=>{if(!t)return;let r=Math.ceil(t.target.getBoundingClientRect().height);r!==this._sheetOffset&&(this._sheetOffset=r)})}disconnectedCallback(){this.#e?.disconnect(),this.#e=null,this.#t?.disconnect(),this.#t=null,this.#r=null,window.removeEventListener("pointerdown",this.#l,!0),super.disconnectedCallback()}updated(t){let r=this.renderRoot.querySelector(".mobile-sheet");if(r!==this.#r&&(this.#t?.disconnect(),this.#r=r,r&&this.#t?.observe(r)),t.has("state")){let o=t.get("state");o?.precisionOpen&&!this.state.precisionOpen&&this.#n?.focus(),!o?.dialog&&this.state.dialog?(this.#a=wt(this.shadowRoot||document),this.updateComplete.then(()=>{this.renderRoot.querySelector(".dialog button")?.focus()})):o?.dialog&&!this.state.dialog&&(this.#a?.focus(),this.#a=null),this.state.workflow!=="none"&&!this._workflowReady&&import("./chunks/workflow-panel.js").then(()=>{this._workflowReady=!0}),(!o||o.workflow!==this.state.workflow)&&(this._sheetDetent=this.state.workflow==="none"?"peek":"half")}}#s(t){this.dispatchEvent(new CustomEvent(Ie,{detail:t,bubbles:!0,composed:!0}))}#m(t){if(t.enabled){if(t.id==="return-live"){this.#s({type:"set-history",historyId:null});return}this.#f(t.id)}}#i(t){if(this.state.workflow==="draw"&&this.state.draw.dirty&&t!=="draw"&&t!=="areaReview"){this.#o=t,this.#s({type:"open-dialog",dialog:"discardDraft"});return}this.#s({type:"open-workflow",workflow:t})}#y(){let t=this.#o;this.#o=null,this.#s({type:"discard-draft"}),t&&queueMicrotask(()=>this.#s({type:"open-workflow",workflow:t}))}#b(){this.#o=null,this.#s({type:"dismiss-top-layer"})}#f(t){this.dispatchEvent(new CustomEvent(ue,{detail:{id:t},bubbles:!0,composed:!0}))}#c(t){this.#s({type:"dismiss-top-layer"}),this.#f(t)}#v(t){if(t.action==="discard"){this.#y();return}if(t.action==="delete-plan"||t.action==="delete-area"){this.#c(t.action);return}this.#s({type:"dismiss-top-layer"}),t.action==="stop"&&this.#f("stop")}#_(){this._sheetDetent=this._sheetDetent==="peek"?"half":this._sheetDetent==="half"?"full":"peek"}#d(){if(this.state.precisionOpen||this.state.fullMap){this.#s({type:"dismiss-top-layer"});return}if(this.state.workflow!=="none"){this.#i("none");return}this.#S()}#S(){this.dispatchEvent(new CustomEvent("hass-toggle-menu",{bubbles:!0,composed:!0}))}#C(t){if(this._overflowOpen=!1,t==="support"){this.#i("support");return}this.dispatchEvent(new CustomEvent(ue,{detail:{id:"use-classic"},bubbles:!0,composed:!0}))}#g(t){this.#n=t.currentTarget,this.#s({type:"set-precision-open",value:!this.state.precisionOpen})}#u(t){if(!(t.defaultPrevented||t.ctrlKey||t.metaKey||t.altKey)&&t.key==="Escape"){if(t.preventDefault(),this._overflowOpen){this._overflowOpen=!1;return}this.#s({type:"dismiss-top-layer"})}}#p(t){if(t.key!=="Tab")return;let r=[...this.renderRoot.querySelectorAll(".dialog button:not(:disabled)")],o=r[0],a=r.at(-1);!o||!a||(t.shiftKey&&this.shadowRoot?.activeElement===o?(t.preventDefault(),a.focus()):!t.shiftKey&&this.shadowRoot?.activeElement===a&&(t.preventDefault(),o.focus()))}#h(t,r="primary-action"){return y`
      <button
        class=${`${r} ${t.kind==="danger"?"danger":""}`}
        type="button"
        ?disabled=${!t.enabled}
        title=${t.reason??""}
        @click=${()=>this.#m(t)}
      >${t.label}</button>
    `}#w(t){return t.workflow==="none"?y`
      <div class="quick-actions">
        <button type="button" @click=${()=>this.#i("rooms")}>Rooms</button>
        <button type="button" @click=${()=>this.#i("draw")}>Draw area</button>
        <button type="button" @click=${()=>this.#i("plan")}>Plans</button>
        <button type="button" @click=${()=>this.#i("history")}>History</button>
      </div>
    `:this._workflowReady?y`<matic-map-workflow-v4 .state=${t}></matic-map-workflow-v4>`:y`<div role="status">Loading workspace…</div>`}render(){let t=this.state,r=t.narrowHint||this._measuredNarrow,o=bt(t),a=vt(t),i=Me({...t,narrowHint:r}),s=Re(t),d=t.workflow==="draw"&&(r||t.fullMap),l=t.fullMap&&(t.coherence==="verifying"||t.coherence==="booting"),c=t.workflow!=="none"||t.fullMap||t.precisionOpen,p=gt(t.dialog);return y`
      <div class=${`root ${r?"narrow":"wide"}`} @keydown=${this.#u}>
        <div class="app">
          <header class="app-bar">
            <button
              class="nav"
              type="button"
              aria-label=${c?"Back":"Open navigation"}
              @click=${this.#d}
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
                  <button role="menuitem" type="button" @click=${()=>this.#C("support")}>Map support</button>
                  <button role="menuitem" type="button" @click=${()=>this.#C("classic")}>Use classic Map Studio</button>
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

            ${d?y`
              <div class="precision-popover">
                <button
                  class="precision-chip"
                  type="button"
                  aria-expanded=${String(t.precisionOpen)}
                  @click=${this.#g}
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
                ${this.#w(t)}
                <div class="primary-stack">
                  ${this.#h(i)}
                  ${s?this.#h(s,"secondary-action"):S}
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
                @click=${this.#_}
              >
                <span class="sheet-handle" aria-hidden="true"></span>
                <span class="sheet-title">${a.title}</span>
                <span class="sheet-description">${a.description}</span>
              </button>
              <div class="sheet-body">
                ${t.workflow==="draw"?S:this.#w(t)}
              </div>
              <div class="primary-stack">
                ${this.#h(i)}
                ${s?this.#h(s,"secondary-action"):S}
              </div>
            </section>

            ${t.fullMap?y`
              <section
                class=${`full-map-hud ${s?"has-secondary":""}`}
                aria-label="Robot status and action"
              >
                <span class="hud-copy"><strong>${o.title}</strong><small>${o.detail}</small></span>
                ${l?S:this.#h(i)}
                ${!l&&s?this.#h(s,"secondary-action"):S}
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
              @keydown=${this.#p}
            >
              <h2 id="dialog-title">${p.title}</h2>
              <p>${p.detail}</p>
              <div class="dialog-actions">
                <button
                  type="button"
                  @click=${t.dialog==="discardDraft"?this.#b:()=>this.#s({type:"dismiss-top-layer"})}
                >${p.cancelLabel}</button>
                ${p.action===null?S:y`
                  <button
                    class="discard"
                    type="button"
                    @click=${()=>this.#v(p)}
                  >${p.confirmLabel}</button>
                `}
              </div>
            </section>
          </div>
        `:S}
      </div>
    `}};customElements.get("matic-map-shell-v4")||customElements.define("matic-map-shell-v4",ye);var be=class extends H{constructor(){super(...arguments);this.scenario="ready";this.narrow=!1;this.controls=!0;this._workspace=me("ready");this.#e=new X(this._workspace);this.#t=null}static{this.properties={scenario:{type:String,reflect:!0},narrow:{type:Boolean,reflect:!0},controls:{type:Boolean,reflect:!0},_workspace:{state:!0}}}static{this.styles=G`
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
    `}};customElements.get("matic-map-studio-gallery-v0-4-0")||customElements.define("matic-map-studio-gallery-v0-4-0",be);var Ue="/api/matic_robot/slam_entries";var u=class extends Error{constructor(e){super(e),this.name="ContractError",this.code=e}},C=(n,e)=>{if(!n||typeof n!="object"||Array.isArray(n))throw new u(e);return n},g=(n,e,t)=>{if(typeof n!="string")throw new u(t);let r=n.trim();if(!r||Array.from(r).length>e||/[\u0000-\u001f\u007f]/u.test(r))throw new u(t);return r},kt=n=>{if(n==null||n==="")return null;try{return g(n,128,"invalid-floor-label")}catch{return null}},F=(n,e,t,r)=>{if(typeof n!="number"||!Number.isFinite(n)||n<e||n>t)throw new u(r);return n},E=(n,e,t,r)=>{let o=F(n,e,t,r);if(!Number.isInteger(o))throw new u(r);return o},ve=(n,e)=>n==null?null:E(n,1,e,"invalid-floor-ordinal"),b=(n,e)=>{if(typeof n!="boolean")throw new u(e);return n},_t=(n,e)=>n===null?null:b(n,e),$e=n=>{if(n==null)return null;let e=g(n,64,"invalid-map-session-key");if(!/^[0-9a-f]{64}$/u.test(e))throw new u("invalid-map-session-key");return e},St=n=>{if(n==null)return null;if(n==="bootstrap_empty"||n==="map_session_unverified"||n==="floor_plan_unavailable"||n==="floor_plan_mismatch")return n;throw new u("invalid-map-block-reason")},Ct=n=>{if(n===void 0)return"not_started";if(n==="not_started"||n==="running"||n==="complete"||n==="partial"||n==="failed")return n;throw new u("invalid-bootstrap-state")},L=(n,e)=>{let t=g(n,512,e);if(!t.startsWith("/")||t.startsWith("//")||t.includes("\\"))throw new u(e);return t},Pt=n=>{let e=typeof n.map_health=="string"?n.map_health.toLowerCase():"",t=typeof n.stream_state=="string"?n.stream_state.toLowerCase():"",r=typeof n.invalid_tiles=="number"?n.invalid_tiles:0;return e.includes("error")||e.includes("fail")||e.includes("degrad")||r>0?"problem":n.map_truncated===!0||e.includes("truncat")||e.includes("limit")?"limited":n.map_complete===!0?"ready":t.includes("connect")||t.includes("collect")||t.includes("run")?"building":"unknown"},ze=n=>{let e=C(n,"invalid-catalog");if(!Array.isArray(e.entries)||e.entries.length>64)throw new u("invalid-catalog-entries");return e.entries.map(t=>{let r=C(t,"invalid-catalog-entry"),o=E(r.map_revision,0,Number.MAX_SAFE_INTEGER,"invalid-map-revision");return{entryId:g(r.entry_id,128,"invalid-entry-id"),sceneUrl:L(r.scene_url,"invalid-scene-url"),deltaUrl:r.delta_url===void 0||r.delta_url===null?null:L(r.delta_url,"invalid-delta-url"),poseUrl:L(r.pose_url,"invalid-pose-url"),historyUrl:L(r.history_url,"invalid-history-url"),areasUrl:L(r.areas_url,"invalid-areas-url"),plansUrl:L(r.plans_url,"invalid-plans-url"),mapRevision:o,mapFloorCoherent:b(r.map_floor_coherent,"invalid-floor-coherence"),mapSessionVerified:b(r.map_session_verified,"invalid-session-state"),mapSessionKey:$e(r.map_session_key),mapBlockReason:St(r.map_block_reason),runnerLocked:b(r.runner_locked,"invalid-runner-lock"),stopSettlePending:b(r.stop_settle_pending,"invalid-stop-settle"),activePlan:b(r.active_plan,"invalid-active-plan"),nativeReconciliationPending:b(r.native_reconciliation_pending,"invalid-native-reconciliation"),nativeSessionActive:_t(r.native_session_active,"invalid-native-session"),mapComplete:b(r.map_complete,"invalid-map-complete"),mapTruncated:b(r.map_truncated,"invalid-map-truncated"),selectedFloorOrdinal:ve(r.selected_floor_ordinal,128),mapFloorOrdinal:ve(r.map_floor_ordinal,128),historyCount:E(r.history_count,0,12,"invalid-history-count"),historyFloorCount:E(r.history_floor_count,0,128,"invalid-floor-count"),health:Pt(r),streamFailures:E(r.stream_failures,0,Number.MAX_SAFE_INTEGER,"invalid-stream-failures"),bootstrapState:Ct(r.bootstrap_state),bootstrapPhotoSeen:r.bootstrap_photo_seen===void 0?!1:b(r.bootstrap_photo_seen,"invalid-bootstrap-photo"),bootstrapStructureSeen:r.bootstrap_structure_seen===void 0?!1:b(r.bootstrap_structure_seen,"invalid-bootstrap-structure"),bootstrapFailures:r.bootstrap_failures===void 0?0:E(r.bootstrap_failures,0,2,"invalid-bootstrap-failures")}})},De=(n,e)=>{if(!Array.isArray(n)||n.length!==2)throw new u(e);return[F(n[0],-1e6,1e6,e),F(n[1],-1e6,1e6,e)]},xt=(n,e)=>{if(!Array.isArray(n)||n.length<3||n.length>8192)throw new u(e);return n.map(t=>De(t,e))},He=(n,e)=>{if(!Array.isArray(n)||n.length>256)throw new u("invalid-rooms");return n.map(t=>{let r=C(t,"invalid-room");return{roomId:g(r.room_id,128,"invalid-room-id"),name:g(r.name,128,"invalid-room-name"),boundary:e?xt(r.boundary,"invalid-room-boundary"):[]}})},At=n=>{let e=C(n,"invalid-history-snapshot"),t=g(e.created_at,64,"invalid-history-time");if(!Number.isFinite(Date.parse(t)))throw new u("invalid-history-time");return{id:g(e.id,128,"invalid-history-id"),createdAt:t,revision:E(e.revision,0,Number.MAX_SAFE_INTEGER,"invalid-history-revision"),pointCount:E(e.point_count,1,15e5,"invalid-history-points"),sceneUrl:L(e.scene_url,"invalid-history-scene-url")}},Be=n=>{let e=C(n,"invalid-history");if(!Array.isArray(e.floors)||e.floors.length<1||e.floors.length>128)throw new u("invalid-history-floors");return{entryId:g(e.entry_id,128,"invalid-history-entry"),liveAvailable:b(e.live_available,"invalid-history-live"),floors:e.floors.map(t=>{let r=C(t,"invalid-history-floor");if(!Array.isArray(r.snapshots)||r.snapshots.length>12)throw new u("invalid-history-snapshots");return{id:g(r.id,128,"invalid-history-floor-id"),active:b(r.active,"invalid-history-floor-active"),readOnly:b(r.read_only,"invalid-history-floor-read-only"),liveAvailable:r.live_available===void 0?!1:b(r.live_available,"invalid-history-floor-live"),label:kt(r.label),ordinal:r.ordinal===void 0?null:ve(r.ordinal,128),snapshots:r.snapshots.map(At)}})}},Fe=n=>{if(n==="vacuum"||n==="mop"||n==="vacuum_and_mop")return n;throw new u("invalid-cleaning-mode")},We=n=>{if(n==="quick"||n==="standard"||n==="heavy_duty")return n;throw new u("invalid-coverage-setting")},Et=n=>{let e=C(n,"invalid-area-circle");return{x:F(e.x,-1e6,1e6,"invalid-area-circle"),y:F(e.y,-1e6,1e6,"invalid-area-circle"),radius:F(e.radius,.05,2.5,"invalid-area-circle")}},Mt=n=>n==="current"||n==="review"||n==="stale"?n:"unknown",Ke=n=>{let e=C(n,"invalid-areas");if(!Array.isArray(e.areas)||e.areas.length>256)throw new u("invalid-area-list");return{sceneUrl:L(e.scene_url,"invalid-area-scene-url"),rooms:He(e.rooms,!0),areas:e.areas.map(t=>{let r=C(t,"invalid-area");if(!Array.isArray(r.circles)||r.circles.length>512)throw new u("invalid-area-circles");return{id:g(r.id,128,"invalid-area-id"),name:g(r.name,128,"invalid-area-name"),circles:r.circles.map(Et),cleaningMode:Fe(r.cleaning_mode),coverageSetting:We(r.coverage_setting),status:Mt(r.status),canRebind:b(r.can_rebind,"invalid-area-rebind")}})}},Ve=n=>{let e=C(n,"invalid-plans");if(!Array.isArray(e.plans)||e.plans.length>256)throw new u("invalid-plan-list");return{rooms:He(e.rooms,!1).map(({roomId:r,name:o})=>({roomId:r,name:o})),selectedPlan:e.selected_plan===null||e.selected_plan===void 0?null:g(e.selected_plan,128,"invalid-selected-plan"),plans:e.plans.map(r=>{let o=C(r,"invalid-plan");if(!Array.isArray(o.rooms)||o.rooms.length>256||!Array.isArray(o.room_order))throw new u("invalid-plan-rooms");let a=o.run_behavior;if(a!=="intelligent"&&a!=="ordered")throw new u("invalid-run-behavior");return{id:g(o.id,128,"invalid-plan-id"),name:g(o.name,128,"invalid-plan-name"),enabled:b(o.enabled,"invalid-plan-enabled"),runBehavior:a,rooms:o.rooms.map(i=>{let s=C(i,"invalid-plan-room");return{roomId:g(s.room_id,128,"invalid-plan-room-id"),cleaningMode:Fe(s.cleaning_mode),coverageSetting:We(s.coverage_setting)}}),roomOrder:o.room_order.slice(0,256).map(i=>g(i,128,"invalid-room-order")),returnToBase:b(o.return_to_base,"invalid-return-to-base"),finishCurrentRoom:b(o.finish_current_room,"invalid-finish-room"),finishCurrentRoomThreshold:E(o.finish_current_room_threshold,0,100,"invalid-finish-threshold")}})}},qe=n=>{let e=C(n,"invalid-pose"),t=e.position,r=t===null?null:De(t,"invalid-pose-position"),o=e.pose_freshness;if(o!=="live"&&o!=="coordinator_fallback")throw new u("invalid-pose-freshness");return{position:r,source:g(e.source,64,"invalid-pose-source"),revision:E(e.revision,0,Number.MAX_SAFE_INTEGER,"invalid-pose-revision"),poseRevision:E(e.pose_revision,0,Number.MAX_SAFE_INTEGER,"invalid-pose-sequence"),floorCoherent:b(e.map_floor_coherent,"invalid-pose-floor"),mapSessionKey:$e(e.map_session_key),freshness:o}},je=n=>{try{return L(n,"invalid-private-path"),!0}catch{return!1}};var Xe=n=>{let a=()=>{throw new Error("invalid-scene")};(!(n instanceof ArrayBuffer)||n.byteLength<24||n.byteLength>16777216)&&a();let i=new DataView(n),s=new Uint8Array(n,0,8),d=String.fromCharCode(...s),l=i.getUint16(8,!0),c=i.getUint16(10,!0),p=i.getUint32(12,!0),m=i.getUint32(16,!0),f=i.getUint32(20,!0),k=m+f,A=24+p;(d!=="MATIC3D\0"||l!==1||c!==8||p>1024*1024||k<1||k>15e5||A+k*c!==n.byteLength)&&a();let v;try{v=JSON.parse(new TextDecoder("utf-8",{fatal:!0}).decode(new Uint8Array(n,24,p)))}catch{a()}(!v||typeof v!="object"||Array.isArray(v))&&a();let _=v,I=_.meters_per_cell,w=_.origin_cells,U=_.span_cells;(typeof I!="number"||!Number.isFinite(I)||I<.001||I>.1||!Array.isArray(w)||w.length!==2||!w.every(P=>typeof P=="number"&&Number.isFinite(P))||!Array.isArray(U)||U.length!==2||!U.every(P=>typeof P=="number"&&Number.isFinite(P)&&P>=1&&P<=65536))&&a();let lt=(Array.isArray(_.rooms)?_.rooms.slice(0,128):[]).flatMap((P,dt)=>{if(!P||typeof P!="object"||Array.isArray(P))return[];let $=P,q=typeof $.name=="string"?$.name.trim():"";if(!q||Array.from(q).length>128||/[\u0000-\u001f\u007f]/u.test(q))return[];if(!Array.isArray($.boundary)||$.boundary.length<3||$.boundary.length>8192)return[];let xe=$.boundary.flatMap(le=>{if(!Array.isArray(le)||le.length!==2)return[];let[ce,de]=le;return typeof ce=="number"&&Number.isFinite(ce)&&typeof de=="number"&&Number.isFinite(de)?[[ce,de]]:[]}),ae=$.center;if(xe.length<3||!Array.isArray(ae)||ae.length!==2)return[];let[se,ie]=ae;return typeof se!="number"||!Number.isFinite(se)||typeof ie!="number"||!Number.isFinite(ie)?[]:[{id:`scene-room-${dt+1}`,name:q,boundary:xe,center:[se,ie]}]}),ct=typeof _.sample_step=="number"&&Number.isInteger(_.sample_step)?Math.max(1,Math.min(15e5,_.sample_step)):1,Ce=w,Pe=U;return{buffer:n,pointOffset:A,floorCount:m,surfaceCount:f,total:k,metadata:{metersPerCell:I,origin:[Ce[0],Ce[1]],span:[Pe[0],Pe[1]],sampleStep:ct,rooms:lt}}},Tt=n=>{if(n.byteLength>16777216||n.byteLength<24||!1||!1)throw new u("invalid-scene");try{return Xe(n)}catch{throw new u("invalid-scene")}},Ot=()=>`
  const parseTransfer = ${Xe.toString()};
  self.onmessage = (event) => {
    const { id, buffer } = event.data;
    try {
      const parsed = parseTransfer(buffer);
      self.postMessage({ id, ok: true, parsed }, [parsed.buffer]);
    } catch (_) {
      self.postMessage({ id, ok: false, problem: "invalid-scene" });
    }
  };
`,J=class{#e=null;#t=null;#r=0;#n=new Map;constructor(){if(!(typeof Worker!="function"||typeof URL?.createObjectURL!="function"))try{this.#t=URL.createObjectURL(new Blob([Ot()],{type:"text/javascript"})),this.#e=new Worker(this.#t),this.#e.onmessage=e=>{let t=this.#n.get(e.data.id);t&&(this.#n.delete(e.data.id),e.data.ok&&e.data.parsed?t.resolve(e.data.parsed):t.reject(new u(e.data.problem||"invalid-scene")))},this.#e.onerror=()=>this.#a("scene-worker-failed")}catch{this.#e=null,this.#t&&URL.revokeObjectURL(this.#t),this.#t=null}}async parse(e,t){if(t?.aborted)throw new DOMException("Aborted","AbortError");if(!this.#e){if(await new Promise(o=>window.setTimeout(o,0)),t?.aborted)throw new DOMException("Aborted","AbortError");return Tt(e)}let r=++this.#r;return new Promise((o,a)=>{let i=()=>{this.#n.delete(r),a(new DOMException("Aborted","AbortError"))};t?.addEventListener("abort",i,{once:!0}),this.#n.set(r,{resolve:s=>{t?.removeEventListener("abort",i),o(s)},reject:s=>{t?.removeEventListener("abort",i),a(s)}}),this.#e?.postMessage({id:r,buffer:e},[e])})}#a(e){for(let t of this.#n.values())t.reject(new u(e));this.#n.clear(),this.#e?.terminate(),this.#e=null}dispose(){this.#a("scene-parser-disposed"),this.#t&&URL.revokeObjectURL(this.#t),this.#t=null}};var T={catalog:1e4,scene:6e4,delta:35e3,pose:1e4,history:15e3,workflow:15e3,mutation:2e4},x=class extends Error{constructor(e,t=null){super(e),this.name="BackendError",this.code=e,this.status=t}},K=36,W=16*1024*1024,Ge=(n,e)=>{let t=Number(n);if(!Number.isSafeInteger(t)||t<0)throw new u(e);return t},Ye=(n,e)=>{let t=n.headers.get("X-Matic-Revision");if(t===null)return e;let r=Number(t);if(!Number.isSafeInteger(r)||r<0)throw new u("invalid-scene-revision");return r},Ze=(n,e)=>{let t=n.headers.get("X-Matic-Floor-Coherent");if(t===null)return e;if(t==="1")return!0;if(t==="0")return!1;throw new u("invalid-scene-floor-header")},Q=class{#e;#t=new J;constructor(e){this.#e=e}async#r(e,t,r,o){if(!je(e))throw new x("invalid-private-path");if(o?.aborted)throw new DOMException("Aborted","AbortError");let a=new AbortController,i=()=>a.abort();o?.addEventListener("abort",i,{once:!0});let s=!1,d=window.setTimeout(()=>{s=!0,a.abort()},r);try{let l=this.#e(),c=new Headers(t.headers),p={...t,cache:"no-store",credentials:"same-origin",headers:Object.fromEntries(c.entries()),signal:a.signal};if(typeof l?.fetchWithAuth=="function")return await l.fetchWithAuth(e,p);let m=l?.auth?.accessToken||l?.auth?.data?.access_token;m&&c.set("Authorization",`Bearer ${m}`);let f=typeof l?.hassUrl=="function"?l.hassUrl(e):e;return await fetch(f,{...p,headers:c})}catch(l){throw s&&!o?.aborted?new x("request-timeout"):a.signal.aborted?new DOMException("Aborted","AbortError"):l}finally{window.clearTimeout(d),o?.removeEventListener("abort",i)}}async#n(e,t,r,o={}){let a=await this.#r(e,{...o,headers:{Accept:"application/json",...o.headers||{}}},t,r);if(!a.ok)throw new x("request-failed",a.status);try{return await a.json()}catch{throw new u("invalid-json-response")}}async catalog(e){return ze(await this.#n(Ue,T.catalog,e))}async scene(e,t,r,o,a,i){let s=new Headers({Accept:"application/vnd.matic.slam-scene"});o==="live"&&s.set("X-Matic-Prefer-Cached","1"),i&&s.set("If-None-Match",i);let d=await this.#r(e,{headers:s},T.scene,a),l=Ye(d,t),c=Ze(d,r);if(d.status===304)return{scene:null,floorCoherent:c,revision:l,notModified:!0};if(!d.ok)throw new x("scene-request-failed",d.status);if(d.headers.get("Content-Type")?.split(";",1)[0]!=="application/vnd.matic.slam-scene")throw new u("invalid-scene-content-type");return{scene:{...await this.#t.parse(await d.arrayBuffer(),a),revision:l,etag:d.headers.get("ETag"),source:o},floorCoherent:c,revision:l,notModified:!1}}async#a(e,t,r){if(!Number.isSafeInteger(t)||t<1||t>W||typeof DecompressionStream!="function")throw new u("invalid-scene-delta");let a=new Blob([e]).stream().pipeThrough(new DecompressionStream("deflate")).getReader(),i=new Uint8Array(t),s=0,d=()=>{a.cancel()};r?.addEventListener("abort",d,{once:!0});try{for(;;){if(r?.aborted)throw new DOMException("Aborted","AbortError");let{done:l,value:c}=await a.read();if(l)break;if(!(c instanceof Uint8Array)||s+c.byteLength>t)throw new u("invalid-scene-delta");i.set(c,s),s+=c.byteLength}}finally{r?.removeEventListener("abort",d),a.releaseLock()}if(s!==t)throw new u("invalid-scene-delta");return i}async#o(e,t,r){if(e.byteLength<K||e.byteLength>K+W||t.buffer.byteLength>W)throw new u("invalid-scene-delta");let o=new DataView(e),a=new TextDecoder().decode(new Uint8Array(e,0,8)),i=o.getUint16(8,!0),s=o.getUint16(10,!0),d=Ge(o.getBigUint64(12,!0),"invalid-scene-delta"),l=Ge(o.getBigUint64(20,!0),"invalid-scene-delta"),c=o.getUint32(28,!0),p=o.getUint32(32,!0);if(a!=="MATICDLT"||i!==1||s!==1||d!==t.revision||l<=t.revision||c<24||c>W||p>W||p+K!==e.byteLength)throw new u("invalid-scene-delta");let m=new Uint8Array(e,K,p),f=new Uint8Array(t.buffer),A=(await this.#a(m,Math.max(f.byteLength,c),r)).slice(),v=1024*1024;for(let w=0;w<f.byteLength;w+=v){if(r?.aborted)throw new DOMException("Aborted","AbortError");let U=Math.min(f.byteLength,w+v);for(let O=w;O<U;O+=1)A[O]=(A[O]??0)^(f[O]??0);U<f.byteLength&&await new Promise(O=>window.setTimeout(O,0))}let _=A.slice(0,c).buffer;return{parsed:{...await this.#t.parse(_,r),revision:l,etag:null,source:"live"},revision:l}}async sceneDelta(e,t,r,o){let a=e.includes("?")?"&":"?",i=await this.#r(`${e}${a}since=${encodeURIComponent(t.revision)}`,{headers:{Accept:"application/vnd.matic.slam-delta, application/vnd.matic.slam-scene"}},T.delta,o),s=Ye(i,t.revision),d=Ze(i,r);if(i.status===204){if(s!==t.revision)throw new u("invalid-scene-delta-revision");return{scene:null,floorCoherent:d,revision:s,notModified:!0}}if(!i.ok)throw new x("delta-request-failed",i.status);if(s<=t.revision)throw new u("invalid-scene-delta-revision");let l=Number(i.headers.get("Content-Length"));if(Number.isFinite(l)&&l>K+W)throw new u("invalid-scene-delta-size");let c=i.headers.get("Content-Type")?.split(";",1)[0],p=await i.arrayBuffer();if(c==="application/vnd.matic.slam-delta"){let f=Number(i.headers.get("X-Matic-Base-Revision"));if(!Number.isSafeInteger(f)||f!==t.revision)throw new u("invalid-scene-delta-base");let k=await this.#o(p,t,o);if(k.revision!==s)throw new u("invalid-scene-delta-revision");return{scene:{...k.parsed,etag:i.headers.get("ETag")},floorCoherent:d,revision:s,notModified:!1}}if(c!=="application/vnd.matic.slam-scene")throw new u("invalid-scene-delta-content-type");return{scene:{...await this.#t.parse(p,o),revision:s,etag:i.headers.get("ETag"),source:"live"},floorCoherent:d,revision:s,notModified:!1}}async pose(e,t){return qe(await this.#n(e,T.pose,t))}async history(e,t){return Be(await this.#n(e,T.history,t))}async plans(e,t){return Ve(await this.#n(e,T.workflow,t))}async areas(e,t){return Ke(await this.#n(e,T.workflow,t))}async saveArea(e,t,r){let o=await this.#n(e,T.mutation,r,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...t.areaId?{area_id:t.areaId}:{},name:t.name,circles:t.circles,cleaning_mode:t.cleaningMode,coverage_setting:t.coverageSetting})});if(!o||typeof o!="object"||typeof o.id!="string")throw new u("invalid-area-save-response");return o.id}async deleteArea(e,t,r){let o=await this.#r(`${e}?area_id=${encodeURIComponent(t)}`,{method:"DELETE",headers:{Accept:"application/json"}},T.mutation,r);if(!o.ok)throw new x("area-delete-failed",o.status)}async service(e,t,r,o){let a=this.#e();if(typeof a?.callService!="function")throw new x("service-unavailable");await a.callService(e,t,r,{entity_id:o})}dispose(){this.#t.dispose()}};var Qe=()=>({version:4,view:"top",labels:!0,quality:"auto",cameras:{}}),V=(n,e,t)=>Math.max(e,Math.min(t,n)),et=n=>n.replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",we=(n,e=4)=>`matic-map-studio:v${e}:${et(n)}`,Nt=n=>{if(!n||typeof n!="object")return null;let e=n;return["yaw","pitch","zoom","targetX","targetZ"].every(r=>typeof e[r]=="number"&&Number.isFinite(e[r]))?{yaw:V(e.yaw,-Math.PI,Math.PI),pitch:V(e.pitch,.18,Math.PI/2-.018),zoom:V(e.zoom,.01,100),targetX:V(e.targetX,-1e4,1e4),targetZ:V(e.targetZ,-1e4,1e4)}:null},Je=n=>{let e=Qe();if(!n||typeof n!="object")return e;let t=n,r=t.view==="three"||t.view==="top"||t.view==="rooms"?t.view:e.view,o=r==="rooms"?"top":r,a=t.quality==="auto"||t.quality==="efficient"||t.quality==="balanced"||t.quality==="maximum"?t.quality:e.quality,i=t.cameras&&typeof t.cameras=="object"?t.cameras:{},s={};for(let d of["three","top"]){let l=Nt(i[d]);l&&(s[d]=l)}return{version:4,view:o,labels:typeof t.labels=="boolean"?t.labels:e.labels,quality:a,cameras:s}},ee=class{#e="local-user";#t=null;load(e){this.#e=et(e);try{let t=window.localStorage.getItem(we(this.#e));if(t)return Je(JSON.parse(t));for(let r of[3,2]){let o=window.localStorage.getItem(we(this.#e,r));if(o)return Je(JSON.parse(o))}}catch{}return Qe()}schedule(e){this.#t!==null&&window.clearTimeout(this.#t),this.#t=window.setTimeout(()=>{this.#t=null;try{window.localStorage.setItem(we(this.#e),JSON.stringify(e))}catch{}},250)}dispose(){this.#t!==null&&window.clearTimeout(this.#t),this.#t=null}},tt="matic-map-studio:preferred-frontend",rt=()=>{try{return window.localStorage.getItem(tt)==="v3"?"v3":"v4"}catch{return"v4"}},ke=n=>{try{return window.localStorage.setItem(tt,n),!0}catch{return!1}};var h=(n,e,t=null)=>({status:n,value:e,problem:t}),M=n=>n instanceof DOMException&&n.name==="AbortError",D=(n,e)=>n instanceof x||n&&typeof n=="object"&&"code"in n&&typeof n.code=="string"?n.code:e,te=n=>[n.selectedFloorOrdinal??"none",n.mapFloorOrdinal??"none",n.mapFloorCoherent?"coherent":"transition"].join(":"),re=n=>[n.mapFloorOrdinal??"none",n.mapSessionVerified?"verified":"unverified",n.mapSessionKey??"no-session"].join(":"),R=n=>[n.entryId,n.selectedFloorOrdinal??"none",n.mapFloorOrdinal??"none"].join("|"),nt=n=>[n.entryId,te(n),re(n),n.mapRevision].join("|"),ot=n=>n.runnerLocked||n.stopSettlePending||n.activePlan||n.nativeReconciliationPending||n.nativeSessionActive===!0,Ut=(n,e)=>n.entryKey===e.entryKey&&n.generation===e.generation&&n.floorKey===e.floorKey&&n.missionKey===e.missionKey,at="Live map updates paused while the current map is rechecked.",st="Reconnecting. The last verified map remains read only.",$t=1e3,_e=(n,e)=>n.label?n.label:n.active?"Current floor":`Saved floor ${n.ordinal??e}`,ne=class{#e;#t=new Ae;#r;#n=new ee;#a=new Map;#o=null;#l;#s=null;#m=null;#i=null;#y=!1;#b=!1;#f=!1;#c="";#v=0;#_="";#d=!1;#S=!0;constructor(e,t){this.#e=e,this.#r=t}sync(e,t){if(this.#d)return;let r=this.#S;if(this.#S=e.host.connected,this.#o=e,this.#l=t,this.#e.patch({host:e.host,activity:e.activity,batteryPercent:e.batteryPercent,robotLabel:e.robotLabel,locale:e.language}),e.userKey!==this.#_){this.#_=e.userKey;let o=this.#n.load(e.userKey);this.#e.patch({view:o.view,labelsVisible:o.labels,quality:o.quality,cameras:o.cameras})}if(!e.host.administrator){this.#g(),this.#w("access-required");return}if(!e.host.connected){this.#g();let o=this.#e.value,a=o.resources.scene.value;this.#e.patch({coherence:a?"degraded":"unavailable",resources:{...o.resources,pose:h("idle",null)},map:{...o.map,available:a!==null,exactPose:!1},notice:a?{tone:"warning",text:st}:o.notice});return}if(e.host.robotCount===0){this.#g(),this.#w("map-unavailable");return}if(this.#C(),!r){this.#e.value.notice?.text===st&&this.#e.patch({notice:null}),this.refreshCatalog(!0);return}(this.#e.value.resources.catalog.status==="idle"||e.entryKey&&e.entryKey!==this.#e.value.selection.entryId)&&this.refreshCatalog(!0)}schedulePreferences(e){this.#n.schedule(e)}#C(){this.#s===null&&(this.#s=window.setInterval(()=>{document.visibilityState==="visible"&&this.refreshCatalog()},5e3)),this.#m===null&&(this.#m=window.setInterval(()=>{document.visibilityState==="visible"&&this.refreshPose()},$t))}#g(){this.#s!==null&&window.clearInterval(this.#s),this.#m!==null&&window.clearInterval(this.#m),this.#s=null,this.#m=null}#u(e){this.#a.get(e)?.abort();let t=new AbortController;return this.#a.set(e,t),t}#p(e,t){this.#a.get(e)===t&&this.#a.delete(e)}#h(e=[]){for(let[t,r]of this.#a)e.includes(t)||(r.abort(),this.#a.delete(t))}#w(e){this.#h(),this.#t.invalidate(),this.#c="";let t=this.#e.value;this.#e.patch({generation:this.#t.generation,coherence:t.host.administrator?"unavailable":"blocked",fullMap:!1,precisionOpen:!1,resources:{catalog:h("error",null,e),entry:null,scene:h("idle",null),pose:h("idle",null),history:h("idle",null),plans:h("idle",null),areas:h("idle",null)},map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1},selection:{...t.selection,entryId:null,floorId:"current",historyId:null}})}async refreshCatalog(e=!1){if(this.#d||this.#y||!this.#o?.host.administrator)return;this.#y=!0;let t=this.#u("catalog"),r=this.#e.value.resources.catalog.value;this.#e.patch({resources:{...this.#e.value.resources,catalog:h("loading",r)}});try{let o=await this.#r.catalog(t.signal);if(t.signal.aborted||this.#d)return;let a=this.#l?.config?.entry_id,i=typeof a=="string"?a:null,s=o.find(c=>c.entryId===i)||o.find(c=>c.entryId===this.#o?.entryKey)||o[0]||null,d=this.#e.value.resources.entry;if(s&&d&&R(s)===R(d)&&te(s)===te(d)&&re(s)===re(d)&&s.mapRevision<d.mapRevision&&(s={...s,mapRevision:d.mapRevision}),this.#e.patch({managedLock:s?ot(s):!1,resources:{...this.#e.value.resources,catalog:h(o.length?"ready":"empty",o),entry:s}}),!s){this.#w("no-loaded-robot");return}if(this.#e.value.selection.floorId!=="current"&&!e)return;let l=nt(s);if(!e&&l===this.#c){let c=this.#e.value,p=s.mapFloorCoherent&&s.mapSessionVerified,m=s.health==="problem"||s.health==="limited";this.#e.patch({coherence:p?m?"degraded":"current":"verifying",map:{...c.map,available:p&&c.resources.scene.value!==null,complete:s.mapComplete&&!s.mapTruncated,floorCoherent:s.mapFloorCoherent,sessionVerified:s.mapSessionVerified,exactPose:p?c.map.exactPose:!1},floor:{...c.floor,classifiedCount:Math.max(1,s.historyFloorCount)}});return}this.#c=l,this.#M(s)}catch(o){if(M(o))return;this.#e.patch({coherence:this.#e.value.resources.scene.value?"degraded":"unavailable",resources:{...this.#e.value.resources,catalog:h("error",r,D(o,"catalog-unavailable"))}})}finally{this.#p("catalog",t),this.#y=!1}}#M(e){let t=this.#e.value,r=t.resources.entry,o=!!(r&&R(r)===R(e));this.#h(o?["catalog","plans","areas","plan-mutation","area-mutation"]:["catalog"]);let a=o?t.resources.scene.value:null,i=this.#t.begin(e.entryId,te(e),re(e),e.mapRevision),s=e.mapFloorCoherent&&e.mapSessionVerified,d=e.health==="problem"||e.health==="limited",l=this.#e.value;this.#e.patch({managedLock:ot(e),generation:i.generation,coherence:s?d?"degraded":"current":"verifying",dataMode:"live",resources:{...l.resources,entry:e,scene:h(s?"loading":"idle",a),pose:h(s?"loading":"idle",null),history:h("loading",l.resources.history.value),plans:o?l.resources.plans:h("idle",null),areas:o?l.resources.areas:h("idle",null)},map:{available:s&&a!==null,complete:e.mapComplete&&!e.mapTruncated,floorCoherent:e.mapFloorCoherent,sessionVerified:e.mapSessionVerified,exactPose:!1},floor:{classifiedCount:Math.max(1,e.historyFloorCount),displayName:e.selectedFloorOrdinal?`Floor ${e.selectedFloorOrdinal}`:"Current floor",readOnly:!1},selection:{...l.selection,entryId:e.entryId,floorId:"current",historyId:null,roomIds:o?l.selection.roomIds:[],planId:o?l.selection.planId:null,areaId:o?l.selection.areaId:null}}),this.#I(e,i),s&&(this.#x(e,i),this.#P(e,i))}async#x(e,t){let r=this.#u("scene");try{let o=await this.#r.scene(e.sceneUrl,e.mapRevision,e.mapFloorCoherent,"live",r.signal);if(!this.#t.accepts(t)||o.revision!==t.revision||!o.floorCoherent||!o.scene)return;let a=this.#e.value;if(this.#e.patch({resources:{...a.resources,scene:h("ready",o.scene)},map:{...a.map,available:!0},notice:a.notice?.text===at?null:a.notice}),e.deltaUrl){let i=++this.#v;this.#R(e,t,o.scene,i)}}catch(o){if(M(o)||!this.#t.accepts(t))return;if(o instanceof x&&o.code==="request-timeout"){let a=this.#e.value;this.#e.patch({resources:{...a.resources,scene:h("loading",a.resources.scene.value,"scene-building")}}),window.setTimeout(()=>{this.#d||!this.#t.accepts(t)||this.#e.value.selection.floorId!=="current"||this.#x(e,t)},250);return}this.#e.patch({coherence:"degraded",resources:{...this.#e.value.resources,scene:h("error",this.#e.value.resources.scene.value,D(o,"scene-unavailable"))},map:{...this.#e.value.map,available:this.#e.value.resources.scene.value!==null,exactPose:!1}})}finally{this.#p("scene",r)}}async#R(e,t,r,o){if(!e.deltaUrl||typeof DecompressionStream!="function")return;let a=e.deltaUrl,i=e,s=t,d=r;try{for(;!this.#d&&o===this.#v&&this.#t.accepts(s)&&this.#e.value.selection.floorId==="current";){let l=this.#u("delta");try{let c=await this.#r.sceneDelta(a,d,i.mapFloorCoherent,l.signal);if(l.signal.aborted||this.#d||o!==this.#v||!this.#t.accepts(s))return;if(!c.floorCoherent){this.#e.patch({coherence:"verifying",map:{...this.#e.value.map,available:!1,floorCoherent:!1,exactPose:!1},resources:{...this.#e.value.resources,pose:h("idle",null)}}),this.#c="",this.refreshCatalog(!0);return}if(c.notModified||!c.scene){await new Promise(f=>window.setTimeout(f,100));continue}let p=this.#t.advance(s,c.revision);if(!p)return;s=p,d=c.scene,i={...i,mapRevision:c.revision},this.#c=nt(i);let m=this.#e.value;this.#e.patch({resources:{...m.resources,entry:i,scene:h("ready",d)},map:{...m.map,available:!0,floorCoherent:!0}}),this.#P(i,s)}finally{this.#p("delta",l)}}}catch(l){if(M(l)||this.#d||o!==this.#v||!this.#t.accepts(s))return;this.#e.patch({coherence:"degraded",notice:{tone:"warning",text:at},map:{...this.#e.value.map,exactPose:!1}}),this.#c="",this.refreshCatalog(!0)}}async#I(e,t){let r=this.#u("history");try{let o=await this.#r.history(e.historyUrl,r.signal);if(!this.#t.accepts(t)||o.entryId!==e.entryId)return;let a=o.floors.find(i=>i.active)||o.floors[0];if(!a)return;this.#e.patch({resources:{...this.#e.value.resources,history:h("ready",o)},floor:{...this.#e.value.floor,classifiedCount:o.floors.length,displayName:_e(a,1)}})}catch(o){if(M(o)||!this.#t.accepts(t))return;this.#e.patch({resources:{...this.#e.value.resources,history:h("error",null,D(o,"history-unavailable"))}})}finally{this.#p("history",r)}}async refreshPose(){let e=this.#e.value.resources.entry,t=this.#t.current();!e||!t||this.#e.value.selection.floorId!=="current"||!e.mapFloorCoherent||!e.mapSessionVerified||await this.#P(e,t)}async#P(e,t){if(this.#b){this.#f=!0;return}this.#b=!0;let r=this.#u("pose");try{let o=await this.#r.pose(e.poseUrl,r.signal),a=this.#t.current(),i=this.#e.value.resources.entry;if(!a||!Ut(t,a)||!i||!o.floorCoherent)return;if(o.mapSessionKey===null||o.mapSessionKey!==i.mapSessionKey){this.#e.patch({map:{...this.#e.value.map,exactPose:!1}}),this.#c="",this.refreshCatalog(!0);return}let s=this.#e.value,d=s.resources.pose.value,l=!!(s.map.exactPose&&d?.position&&d.mapSessionKey===i.mapSessionKey);if(o.position===null&&o.freshness==="coordinator_fallback"&&l){this.#e.patch({resources:{...s.resources,pose:h("ready",d)}});return}this.#e.patch({resources:{...s.resources,pose:h("ready",o)},map:{...s.map,exactPose:o.position!==null}})}catch(o){if(M(o)||!this.#t.accepts(t))return;let a=this.#e.value,i=a.resources.pose.value,s=!!(a.map.exactPose&&i?.position&&i.mapSessionKey===a.resources.entry?.mapSessionKey);this.#e.patch({resources:{...a.resources,pose:h("error",s?i:null,D(o,"pose-unavailable"))},map:{...a.map,exactPose:s}})}finally{if(this.#p("pose",r),this.#b=!1,this.#f&&!this.#d){this.#f=!1;let o=this.#e.value.resources.entry,a=this.#t.current();o&&a&&this.#P(o,a)}}}async selectFloor(e){let t=this.#e.value.resources.history.value,r=this.#e.value.resources.entry;if(!t||!r)return;let o=t.floors.find(s=>s.id===e);if(!o)return;if(o.active){this.#c="",this.#e.dispatch({type:"set-floor",floorId:"current"}),await this.refreshCatalog(!0);return}let a=o.snapshots.at(-1);this.#h(["catalog"]);let i=this.#t.begin(r.entryId,o.id,a?.id||o.id,a?.revision||0);this.#e.patch({generation:i.generation,coherence:"current",dataMode:"history",floor:{classifiedCount:t.floors.length,displayName:_e(o,t.floors.indexOf(o)+1),readOnly:!0},selection:{...this.#e.value.selection,floorId:o.id,historyId:a?.id||null},resources:{...this.#e.value.resources,scene:h(a?"loading":"empty",null),pose:h("idle",null)},map:{available:!1,complete:!0,floorCoherent:!0,sessionVerified:!0,exactPose:!1}}),a&&await this.#A(a,i)}async selectHistory(e){let t=this.#e.value.resources.history.value,r=this.#e.value.resources.entry;if(!t||!r)return;if(!e){await this.selectFloor("current");return}let o=t.floors.find(s=>s.snapshots.some(d=>d.id===e)),a=o?.snapshots.find(s=>s.id===e);if(!o||!a)return;let i=this.#t.begin(r.entryId,o.id,a.id,a.revision);this.#h(["catalog"]),this.#e.patch({generation:i.generation,dataMode:"history",floor:{classifiedCount:t.floors.length,displayName:_e(o,t.floors.indexOf(o)+1),readOnly:!0},selection:{...this.#e.value.selection,floorId:o.id,historyId:a.id},resources:{...this.#e.value.resources,scene:h("loading",null),pose:h("idle",null)},map:{...this.#e.value.map,available:!1,exactPose:!1}}),await this.#A(a,i)}async#A(e,t){let r=this.#u("history-scene");try{let o=await this.#r.scene(e.sceneUrl,e.revision,!0,"history",r.signal);if(!this.#t.accepts(t)||!o.scene)return;this.#e.patch({resources:{...this.#e.value.resources,scene:h("ready",o.scene)},map:{...this.#e.value.map,available:!0,exactPose:!1}})}catch(o){if(M(o)||!this.#t.accepts(t))return;this.#e.patch({resources:{...this.#e.value.resources,scene:h("error",null,D(o,"history-scene-unavailable"))}})}finally{this.#p("history-scene",r)}}async openWorkflow(e){this.#e.dispatch({type:"open-workflow",workflow:e}),(e==="plan"||e==="rooms")&&await this.loadPlans(),(e==="draw"||e==="areaReview")&&await this.loadAreas()}async loadPlans(){let e=this.#e.value.resources.entry;if(!e||!this.#t.current()||!z(this.#e.value))return;let t=R(e),r=this.#u("plans");this.#e.patch({resources:{...this.#e.value.resources,plans:h("loading",null)}});try{let o=await this.#r.plans(e.plansUrl,r.signal),a=this.#e.value.resources.entry;if(!a||R(a)!==t)return;this.#e.patch({resources:{...this.#e.value.resources,plans:h("ready",o)},selection:{...this.#e.value.selection,planId:o.selectedPlan||o.plans[0]?.id||null}}),this.selectPlan(o.selectedPlan||o.plans[0]?.id||null)}catch(o){let a=this.#e.value.resources.entry;if(M(o)||!a||R(a)!==t)return;this.#e.patch({resources:{...this.#e.value.resources,plans:h("error",null,D(o,"plans-unavailable"))}})}finally{this.#p("plans",r)}}selectPlan(e){let t=this.#e.value.resources.plans.value?.plans.find(r=>r.id===e);this.#e.patch({selection:{...this.#e.value.selection,planId:e},planDraft:t?this.#L(t):{...this.#e.value.planDraft,id:null,name:"",rooms:[],dirty:!1}})}#L(e){return{id:e.id,name:e.name,enabled:e.enabled,runBehavior:e.runBehavior,rooms:(e.roomOrder.length?e.roomOrder.flatMap(t=>{let r=e.rooms.find(o=>o.roomId===t);return r?[r]:[]}):e.rooms).map(t=>({...t})),returnToBase:e.returnToBase,finishCurrentRoom:e.finishCurrentRoom,finishCurrentRoomThreshold:e.finishCurrentRoomThreshold,dirty:!1}}async loadAreas(){let e=this.#e.value.resources.entry;if(!e||!this.#t.current()||!z(this.#e.value))return;let t=R(e),r=this.#u("areas");this.#e.patch({resources:{...this.#e.value.resources,areas:h("loading",null)}});try{let o=await this.#r.areas(e.areasUrl,r.signal),a=this.#e.value.resources.entry;if(!a||R(a)!==t||o.sceneUrl!==a.sceneUrl)return;this.#e.patch({resources:{...this.#e.value.resources,areas:h("ready",o)}}),this.selectArea(o.areas[0]?.id||null)}catch(o){let a=this.#e.value.resources.entry;if(M(o)||!a||R(a)!==t)return;this.#e.patch({resources:{...this.#e.value.resources,areas:h("error",null,D(o,"areas-unavailable"))}})}finally{this.#p("areas",r)}}selectArea(e){let t=this.#e.value.resources.areas.value?.areas.find(o=>o.id===e),r=this.#e.value;this.#e.patch({selection:{...r.selection,areaId:e},areaDraft:t?this.#T(t):{id:null,name:"",cleaningMode:"vacuum",coverageSetting:"standard",status:"new",canRebind:!1,dirty:!1},draw:{...r.draw,circles:t?.circles||[],undo:[],redo:[],dirty:!1,strokeCount:0}})}#T(e){return{id:e.id,name:e.name,cleaningMode:e.cleaningMode,coverageSetting:e.coverageSetting,status:e.status,canRebind:e.canRebind,dirty:!1}}async saveArea(){let e=this.#e.value,t=e.resources.entry,r=e.areaDraft;if(!t||!z(e)||!r.name.trim()||!e.draw.circles.length)return;let o=this.#u("area-mutation");this.#e.patch({command:"pending",notice:{tone:"info",text:"Saving area\u2026"}});try{let a=await this.#r.saveArea(t.areasUrl,{areaId:r.id,name:r.name.trim(),circles:e.draw.circles,cleaningMode:r.cleaningMode,coverageSetting:r.coverageSetting},o.signal);this.#e.patch({command:"idle",notice:{tone:"success",text:"Area saved"}}),await this.loadAreas(),this.selectArea(a)}catch(a){if(M(a))return;this.#e.patch({command:"failed",notice:{tone:"error",text:"Area could not be saved"}})}finally{this.#p("area-mutation",o)}}async deleteArea(){let e=this.#e.value.resources.entry,t=this.#e.value.selection.areaId;if(!e||!t||!z(this.#e.value))return;let r=this.#u("area-mutation");try{await this.#r.deleteArea(e.areasUrl,t,r.signal),this.#e.patch({notice:{tone:"success",text:"Area deleted"}}),await this.loadAreas()}catch(o){M(o)||this.#e.patch({notice:{tone:"error",text:"Area could not be deleted"}})}finally{this.#p("area-mutation",r)}}async savePlan(){let e=this.#e.value,t=e.planDraft,r=e.resources.plans.value;if(!r||!t.name.trim()||!t.rooms.length||!z(e))return;let o=t.rooms;await this.#E("save_plan",{...t.id?{plan_id:t.id}:{},name:t.name.trim(),enabled:t.enabled,run_behavior:t.runBehavior,rooms:o.map(a=>({room:r.rooms.find(i=>i.roomId===a.roomId)?.name,cleaning_mode:a.cleaningMode,coverage_setting:a.coverageSetting})).filter(a=>a.room),return_to_base:t.returnToBase,finish_current_room:t.finishCurrentRoom,finish_current_room_threshold:t.finishCurrentRoomThreshold,select:!t.id||r.selectedPlan===t.id},"Plan saved","Plan could not be saved"),await this.loadPlans()}async deletePlan(){let e=this.#e.value.selection.planId;e&&(await this.#E("delete_plan",{plan:e},"Plan deleted","Plan could not be deleted"),await this.loadPlans())}async executeAction(e){switch(e){case"stop":this.#e.value.resources.entry?.activePlan||this.#e.value.resources.entry?.runnerLocked?await this.#k("matic_robot","stop_intelligent_cleaning",{}):await this.#k("vacuum","return_to_base",{});return;case"resume":await this.#k("vacuum","start",{});return;case"run-plan":{let t=this.#e.value.selection.planId||this.#e.value.resources.plans.value?.selectedPlan;t&&await this.#k("matic_robot","run_selected_plan",{plan:t});return}case"clean-rooms":{let t=this.#e.value.resources.plans.value,r=this.#e.value.selection.roomIds,o=t?.rooms.filter(a=>r.includes(a.roomId)).map(a=>a.name)||[];o.length&&await this.#k("matic_robot","clean",{rooms:o,ordered:!1,cleaning_mode:this.#e.value.selection.cleaningMode,coverage_setting:this.#e.value.selection.coverageSetting});return}case"run-area":{let t=this.#e.value.selection.areaId;t&&await this.#k("matic_robot","clean_area",{area:t});return}case"review-area":this.#e.dispatch({type:"open-workflow",workflow:"areaReview"});return;case"save-area":await this.saveArea();return;case"save-plan":await this.savePlan();return;case"delete-plan":await this.deletePlan();return;case"delete-area":await this.deleteArea();return}}async#E(e,t,r,o){let a=this.#o?.vacuumEntityId;if(!(!a||!z(this.#e.value)||this.#e.value.command==="pending")){this.#e.patch({command:"pending",notice:{tone:"info",text:"Saving\u2026"}});try{await this.#r.service("matic_robot",e,t,a),this.#e.patch({command:"idle",notice:{tone:"success",text:r}})}catch{this.#e.patch({command:"failed",notice:{tone:"error",text:o}})}}}async#k(e,t,r){let o=this.#e.value,a=this.#o?.vacuumEntityId,s=(t==="stop_intelligent_cleaning"||e==="vacuum"&&t==="return_to_base")&&o.command==="idle"&&(o.activity==="cleaning"||o.activity==="paused"||o.activity==="returning");if(!(!a||!s&&!Ee(o))){this.#e.patch({command:"pending",notice:null});try{await this.#r.service(e,t,r,a),this.#e.patch({command:"settling"}),this.#i!==null&&window.clearTimeout(this.#i),this.#i=window.setTimeout(()=>{this.#i=null,this.#e.value.command==="settling"&&this.#e.patch({command:"idle"})},15e3)}catch{this.#e.patch({command:"failed",notice:{tone:"error",text:"The robot did not accept that action"}})}}}updateDraftCircles(e,t=!0,r){this.#e.dispatch({type:"set-draft-circles",circles:e,record:t,...r?{previous:r}:{}}),this.#e.dispatch({type:"patch-area-draft",patch:{dirty:!0}})}dispose(){this.#d||(this.#d=!0,this.#g(),this.#h(),this.#i!==null&&window.clearTimeout(this.#i),this.#i=null,this.#n.dispose(),this.#r.dispose(),this.#t.invalidate())}};var it=n=>(n.workflow==="none"?0:1)+(n.fullMap?1:0)+(n.precisionOpen?1:0)+(n.dialog?1:0),zt=n=>{if(!n||typeof n!="object")return null;let e=n.maticMapLayer;if(!e||typeof e!="object")return null;let t=e.owner,r=e.depth;return typeof t=="string"&&Number.isInteger(r)&&Number(r)>=0?{owner:t,depth:Number(r)}:null},oe=class{#e;#t=`matic-map-${crypto.randomUUID?.()||Math.random().toString(36).slice(2)}`;#r=0;#n=null;#a=!1;constructor(e){this.#e=e}start(){this.#n||(this.#r=it(this.#e.value),this.#n=this.#e.subscribe(e=>this.#o(e)),window.addEventListener("popstate",this.#l))}#o(e){let t=it(e);if(this.#a){this.#a=!1,this.#r=t;return}if(t>this.#r)for(let r=this.#r+1;r<=t;r+=1){let o=history.state&&typeof history.state=="object"?history.state:{};history.pushState({...o,maticMapLayer:{owner:this.#t,depth:r}},"",window.location.href)}this.#r=t}#l=()=>{this.#r<1||(this.#a=!0,this.#e.dispatch({type:"dismiss-top-layer"}))};dismissTop(){if(this.#r<1)return!1;let e=zt(history.state);return e?.owner===this.#t&&e.depth===this.#r?history.back():this.#e.dispatch({type:"dismiss-top-layer"}),!0}dispose(){this.#n?.(),this.#n=null,window.removeEventListener("popstate",this.#l),this.#r=0}};var Se=class extends H{constructor(){super(...arguments);this.narrow=!1;this._workspace=N();this._classic=!1;this.#e=new Z;this.#t=new X(this._workspace);this.#r=null;this.#n=null;this.#a=null;this.#o=null;this.#l=null;this.#s=""}static{this.properties={hass:{attribute:!1},narrow:{type:Boolean},route:{attribute:!1},panel:{attribute:!1},_workspace:{state:!0},_classic:{state:!0}}}#e;#t;#r;#n;#a;#o;#l;#s;connectedCallback(){super.connectedCallback(),this._classic=rt()==="v3",this.#n=this.#t.subscribe(t=>{this._workspace=t,this.#y(t)}),this._classic||this.#m()}disconnectedCallback(){this.#n?.(),this.#n=null,this.#i(),super.disconnectedCallback()}#m(){this.#o||(this.#a=new Q(()=>this.hass),this.#o=new ne(this.#t,this.#a),this.#l=new oe(this.#t),this.#l.start(),this.#r&&this.#o.sync(this.#r,this.panel))}#i(){this.#l?.dispose(),this.#l=null,this.#o?.dispose(),this.#o=null,this.#a=null}#y(t){if(!this.#o)return;let r={version:4,view:t.view,labels:t.labelsVisible,quality:t.quality,cameras:t.cameras},o=JSON.stringify(r);o!==this.#s&&(this.#s=o,this.#o.schedulePreferences(r))}willUpdate(t){if(t.has("hass")||t.has("panel")){let r=this.#e.project(this.hass,this.panel);if(r!==this.#r){this.#r=r;let o=r.host.connected?r.host.robotCount===0?"unavailable":r.host.administrator?"verifying":"blocked":"degraded";this.#t.replace({...this.#t.value,coherence:o,activity:r.activity,batteryPercent:r.batteryPercent,host:r.host,fullMap:r.host.administrator&&r.host.robotCount>0&&this.#t.value.fullMap,robotLabel:r.robotLabel,locale:r.language})}this._classic||this.#o?.sync(r,this.panel)}t.has("narrow")&&this.#t.value.narrowHint!==this.narrow&&this.#t.dispatch({type:"set-narrow-hint",value:this.narrow})}#b(t){if(!j(t.detail))return;t.stopPropagation();let r=t.detail;if(r.type==="dismiss-top-layer"||r.type==="exit-full-map"){this.#l?.dismissTop()||this.#t.dispatch(r);return}if(r.type==="open-workflow"&&r.workflow!=="none"){this.#o?.openWorkflow(r.workflow);return}if(r.type==="set-floor"){this.#o?.selectFloor(r.floorId);return}if(r.type==="set-history"){this.#o?.selectHistory(r.historyId);return}if(r.type==="select-plan"){this.#o?.selectPlan(r.planId);return}if(r.type==="select-area"){this.#o?.selectArea(r.areaId);return}this.#t.dispatch(r)}#f(t){if(t.stopPropagation(),typeof t.detail?.id=="string"){if(t.detail.id==="use-classic"){ke("v3")&&(this.#i(),this._classic=!0);return}this.#o?.executeAction(t.detail.id),this.dispatchEvent(new CustomEvent("matic-map-v4-action-requested",{detail:{id:t.detail.id},bubbles:!0,composed:!0}))}}#c(){ke("v4")&&(this._classic=!1,this.#m(),this.requestUpdate())}updated(){if(!this._classic)return;let t=this.renderRoot.querySelector("matic-map-panel-v0-3-1");t&&(t.hass=this.hass,t.narrow=this.narrow,t.route=this.route,t.panel=this.panel)}getWorkspaceSnapshot(){return this.#t.value}render(){return this._classic?y`
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
          <button class="return-v4" type="button" @click=${this.#c}>Use Map Studio 0.4</button>
          <matic-map-panel-v0-3-1></matic-map-panel-v0-3-1>
        </div>
      `:y`
      <matic-map-shell-v4
        .state=${this._workspace}
        @matic-workspace-intent=${this.#b}
        @matic-workspace-action=${this.#f}
      ></matic-map-shell-v4>
    `}};customElements.get("matic-map-panel-v0-4-0")||customElements.define("matic-map-panel-v0-4-0",Se);export{Ae as CoherenceMachine,Ft as DRAW_BRUSH_MAX_METERS,Bt as DRAW_BRUSH_MIN_METERS,fe as GALLERY_SCENARIOS,Z as HassAdapter,Wt as MAP_PIXELS_PER_METER_AT_100,Ht as MAP_ZOOM_MAX,Dt as MAP_ZOOM_MIN,Se as MaticMapPanelV4,be as MaticMapStudioGalleryV4,X as WorkspaceStore,Gt as brushCursorPixels,z as canEditCoordinates,Xt as canShowExactPose,jt as canShowLiveMap,Ee as canStartMotion,Zt as commandState,me as createGalleryState,N as initialWorkspaceState,j as isWorkspaceIntent,Yt as mapScale,Vt as normalizeBrush,Kt as normalizeZoom,qt as reduceWorkspace,Re as selectPausedSecondaryAction,Me as selectPrimaryAction};
