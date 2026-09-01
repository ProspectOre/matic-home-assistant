var Y=100,Se=1e3,ue=.2,$e=2.5,Ze=64,Ce=o=>!o||typeof o!="object"?!1:typeof o.type=="string";var re=()=>({status:"idle",value:null,problem:null}),H=(o,e,t)=>Math.max(e,Math.min(t,o)),Wr=o=>({yaw:H(Number.isFinite(o.yaw)?o.yaw:0,-Math.PI,Math.PI),pitch:H(Number.isFinite(o.pitch)?o.pitch:Math.PI/2-.018,.18,Math.PI/2-.018),zoom:H(Number.isFinite(o.zoom)?o.zoom:1,.01,100),targetX:H(Number.isFinite(o.targetX)?o.targetX:0,-1e4,1e4),targetZ:H(Number.isFinite(o.targetZ)?o.targetZ:0,-1e4,1e4)}),zt=o=>Math.round(H(Number.isFinite(o)?o:100,100,1e3)),Hr=o=>Math.round(H(Number.isFinite(o)?o:.2,.2,2.5)*100)/100,M=()=>({generation:0,coherence:"verifying",dataMode:"live",activity:"unknown",workflow:"none",command:"idle",fullMap:!1,precisionOpen:!1,dialog:null,narrowHint:!1,view:"top",appearance:"photo",labelsVisible:!0,quality:"auto",cameras:{},managedLock:!1,batteryPercent:null,floor:{classifiedCount:1,displayName:"Current floor",readOnly:!1},map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1},host:{connected:!0,administrator:!0,robotConnected:!1,robotCount:0},draw:{zoomPercent:100,zoomOriginX:50,zoomOriginY:50,brushMeters:.6,tool:"paint",dirty:!1,strokeCount:0,circles:[],undo:[],redo:[]},resources:{catalog:re(),entry:null,scene:re(),pose:re(),history:re(),plans:re(),areas:re()},selection:{entryId:null,floorId:"current",historyId:null,roomIds:[],cleaningMode:"vacuum",coverageSetting:"standard",planId:null,areaId:null},planDraft:{id:null,name:"",enabled:!0,runBehavior:"intelligent",rooms:[],returnToBase:!0,finishCurrentRoom:!1,finishCurrentRoomThreshold:50,dirty:!1},areaDraft:{id:null,name:"",cleaningMode:"vacuum",coverageSetting:"standard",status:"new",canRebind:!1,dirty:!1},notice:null,robotLabel:"Matic robot",robots:[],locale:"en"}),L=(o,e)=>({...o,draw:{...o.draw,...e}}),Br=(o,e)=>{switch(e.type){case"set-host":return{...o,host:e.host,fullMap:e.host.administrator&&e.host.robotCount>0?o.fullMap:!1};case"set-operational-state":return{...o,coherence:e.coherence,activity:e.activity,command:e.command??o.command};case"set-narrow-hint":return{...o,narrowHint:e.value};case"set-view":return{...o,view:e.view};case"set-appearance":return{...o,appearance:e.appearance};case"set-quality":return{...o,quality:e.quality};case"set-camera":return{...o,cameras:{...o.cameras,[e.view]:Wr(e.camera)}};case"toggle-labels":return{...o,labelsVisible:!o.labelsVisible};case"open-workflow":return{...o,workflow:e.workflow,precisionOpen:!1};case"enter-full-map":return o.host.administrator&&o.host.robotCount>0&&o.map.available?{...o,fullMap:!0}:o;case"exit-full-map":return{...o,fullMap:!1,precisionOpen:!1};case"set-precision-open":return{...o,precisionOpen:e.value};case"set-zoom":return L(o,{zoomPercent:zt(e.value),...e.originX===void 0?{}:{zoomOriginX:H(e.originX,0,100)},...e.originY===void 0?{}:{zoomOriginY:H(e.originY,0,100)}});case"step-zoom":return L(o,{zoomPercent:zt(o.draw.zoomPercent*e.factor)});case"fit-map":return L(o,{zoomPercent:100,zoomOriginX:50,zoomOriginY:50});case"set-brush":return L(o,{brushMeters:Hr(e.value)});case"set-draw-tool":return L(o,{tool:e.tool});case"mark-draft":{let t=Math.max(0,o.draw.strokeCount+e.strokeDelta);return L(o,{dirty:t>0,strokeCount:t})}case"undo-draft":{let t=o.draw.undo.at(-1);return t?L(o,{circles:t,undo:o.draw.undo.slice(0,-1),redo:[...o.draw.redo,o.draw.circles],dirty:!0,strokeCount:Math.max(0,o.draw.strokeCount-1)}):o}case"clear-draft":return o.draw.circles.length?L(o,{circles:[],undo:[...o.draw.undo.slice(-99),o.draw.circles],redo:[],dirty:!0,strokeCount:o.draw.strokeCount+1}):o;case"redo-draft":{let t=o.draw.redo.at(-1);return t?L(o,{circles:t,undo:[...o.draw.undo,o.draw.circles],redo:o.draw.redo.slice(0,-1),dirty:!0,strokeCount:o.draw.strokeCount+1}):o}case"set-draft-circles":{let t=e.circles.slice(0,512).map(n=>({...n})),r=e.record!==!1;return L(o,{circles:t,undo:r?[...o.draw.undo.slice(-99),e.previous??o.draw.circles]:o.draw.undo,redo:r?[]:o.draw.redo,dirty:!0,strokeCount:r?o.draw.strokeCount+1:o.draw.strokeCount})}case"discard-draft":return{...L(o,{dirty:!1,strokeCount:0,circles:[],undo:[],redo:[]}),dialog:null,workflow:"none",precisionOpen:!1};case"toggle-room":{let t=o.selection.roomIds.includes(e.roomId);return{...o,selection:{...o.selection,roomIds:t?o.selection.roomIds.filter(r=>r!==e.roomId):[...o.selection.roomIds,e.roomId]}}}case"patch-room-settings":return{...o,selection:{...o.selection,...e.cleaningMode?{cleaningMode:e.cleaningMode}:{},...e.coverageSetting?{coverageSetting:e.coverageSetting}:{}}};case"set-floor":return{...o,dataMode:e.floorId==="current"?"live":"history",selection:{...o.selection,floorId:e.floorId,historyId:null}};case"select-entry":return o;case"set-history":return{...o,dataMode:e.historyId?"history":"live",selection:{...o.selection,historyId:e.historyId}};case"select-plan":return{...o,selection:{...o.selection,planId:e.planId}};case"select-area":return{...o,selection:{...o.selection,areaId:e.areaId}};case"patch-plan-draft":return{...o,planDraft:{...o.planDraft,...e.patch,dirty:e.patch.dirty??!0}};case"patch-area-draft":return{...o,areaDraft:{...o.areaDraft,...e.patch,dirty:e.patch.dirty??!0}};case"set-notice":return{...o,notice:e.notice};case"open-dialog":return{...o,dialog:e.dialog};case"dismiss-top-layer":return o.dialog?{...o,dialog:null}:o.precisionOpen?{...o,precisionOpen:!1}:o.fullMap?{...o,fullMap:!1}:o.workflow!=="none"?{...o,workflow:"none",precisionOpen:!1}:o;case"return-live":return{...o,dataMode:"live",workflow:"none",floor:{...o.floor,readOnly:!1}}}},ne=class{#e=new Set;#t;constructor(e=M()){this.#t=e}get value(){return this.#t}dispatch(e){let t=Br(this.#t,e);if(t===this.#t)return t;this.#t=t;for(let r of this.#e)r(t);return t}replace(e){if(e!==this.#t){this.#t=e;for(let t of this.#e)t(e)}}patch(e){let t={...this.#t,...e};return this.replace(t),t}subscribe(e){return this.#e.add(e),e(this.#t),()=>this.#e.delete(e)}},Me=class{#e=null;#t=0;get generation(){return this.#t}begin(e,t,r,n){return this.#t+=1,this.#e={entryKey:e,generation:this.#t,floorKey:t,missionKey:r,revision:n},this.#e}current(){return this.#e}accepts(e){let t=this.#e;return!!(t&&e.entryKey===t.entryKey&&e.generation===t.generation&&e.floorKey===t.floorKey&&e.missionKey===t.missionKey&&e.revision===t.revision)}advance(e,t){return!this.accepts(e)||!Number.isSafeInteger(t)||t<=e.revision?null:(this.#e={...e,revision:t},this.#e)}invalidate(){return this.#t+=1,this.#e=null,this.#t}},ie=o=>o.dataMode==="live"&&o.map.available&&(o.coherence==="current"||o.coherence==="degraded")&&o.host.administrator,Tt=o=>ie(o)&&(o.coherence==="current"||o.coherence==="degraded")&&o.map.floorCoherent&&o.map.sessionVerified&&o.map.exactPose&&o.host.connected&&o.host.robotConnected,B=o=>ie(o)&&o.coherence==="current"&&o.map.complete&&o.map.floorCoherent&&o.map.sessionVerified&&o.host.connected&&o.host.robotConnected&&!o.floor.readOnly,Ge=o=>ie(o)&&o.coherence==="current"&&o.map.floorCoherent&&o.map.sessionVerified&&o.host.connected&&o.host.robotConnected&&!o.floor.readOnly,oe=o=>B(o)&&!o.managedLock&&o.command==="idle"&&(o.activity==="idle"||o.activity==="docked"),pe=(o,e,t)=>({id:o,label:e,kind:"neutral",enabled:!1,reason:t}),Lt=o=>{if(o.dataMode==="history")return{id:"return-live",label:"Return to Live",kind:"primary",enabled:!0};if(o.activity==="cleaning"||o.activity==="returning")return{id:"stop",label:"Stop",kind:"danger",enabled:o.command==="idle"};if(o.activity==="stopping"||o.command==="settling")return pe("stopping","Stopping\u2026","Waiting for the robot to settle");if(o.activity==="paused")return{id:"resume",label:"Resume",kind:"primary",enabled:o.command==="idle"};if(!o.host.connected)return pe("reconnecting","Reconnecting\u2026","Home Assistant is offline");if(!o.host.administrator)return pe("administrator","Administrator required","This map is private");if(!o.host.robotConnected)return pe("robot-offline","Robot offline","Reconnect the robot first");if(o.coherence!=="current")return pe("locating","Locating\u2026","Waiting for the current map");if(o.workflow==="draw")return o.fullMap||o.narrowHint?{id:"review-area",label:"Review details",kind:"primary",enabled:o.draw.dirty,...o.draw.dirty?{}:{reason:"Draw an area first"}}:{id:"save-area",label:"Save area",kind:"primary",enabled:o.draw.dirty&&B(o),...o.draw.dirty?{}:{reason:"Draw an area first"}};if(o.workflow==="rooms"){let e=oe(o)&&o.selection.roomIds.length>0;return{id:"clean-rooms",label:o.selection.roomIds.length?`Clean ${o.selection.roomIds.length} room${o.selection.roomIds.length===1?"":"s"}`:"Choose rooms",kind:"primary",enabled:e,...e?{}:{reason:o.selection.roomIds.length?"Map verification is required":"Select at least one room"}}}if(o.workflow==="plan"){if(o.planDraft.dirty||!o.planDraft.id){let e=B(o)&&o.planDraft.name.trim().length>0&&o.planDraft.rooms.length>0;return{id:"save-plan",label:"Save plan",kind:"primary",enabled:e,...e?{}:{reason:"Add a name and at least one room"}}}return{id:"run-plan",label:"Run plan",kind:"primary",enabled:oe(o)&&o.planDraft.enabled,...oe(o)?{}:{reason:"Map verification is required"}}}if(o.workflow==="areaReview"){if(o.areaDraft.dirty||o.draw.dirty||!o.areaDraft.id||o.areaDraft.canRebind){let t=B(o)&&o.areaDraft.name.trim().length>0&&o.draw.circles.length>0;return{id:"save-area",label:o.areaDraft.canRebind?"Confirm on this map":"Save area",kind:"primary",enabled:t,...t?{}:{reason:"Add a name and at least one mark"}}}let e=o.areaDraft.status==="current";return{id:"run-area",label:"Clean area",kind:"primary",enabled:e&&oe(o),...e?{}:{reason:"Review or redraw this area first"}}}return{id:"choose-cleaning",label:"Choose what to clean",kind:"neutral",enabled:!1,reason:"Choose rooms, a plan, or a custom area"}},Dt=o=>o.activity==="paused"?{id:"stop",label:"Stop",kind:"danger",enabled:o.command==="idle"}:null,Uo=o=>o.draw.brushMeters*64*(o.draw.zoomPercent/100),Fr=[2,1,.5,.25,.1,.05],Ot=o=>{let e=64*(o.draw.zoomPercent/100),t=Fr.reduce((r,n)=>{let i=Math.abs(n*e-64),a=Math.abs(r*e-64);return i<a?n:r});return{meters:t,pixels:t*e,label:t<1?`${Math.round(t*100)} cm`:`${t} m`}},Wo=(o,e)=>({...o,command:e});var Nt="a".repeat(64),ae=[{roomId:"room-a",name:"Kitchen",boundary:[[.5,.5],[4,.5],[4,3],[.5,3]]},{roomId:"room-b",name:"Living room",boundary:[[4.2,.5],[8.5,.5],[8.5,3.4],[4.2,3.4]]},{roomId:"room-c",name:"Office",boundary:[[.5,3.2],[3.8,3.2],[3.8,6.5],[.5,6.5]]},{roomId:"room-d",name:"Bedroom",boundary:[[4,3.6],[8.5,3.6],[8.5,6.5],[4,6.5]]}],Ut=()=>{let o=[180,140],e={meters_per_cell:.05,origin_cells:[0,0],span_cells:o,sample_step:1,rooms:ae.map(c=>{let d=c.boundary.map(([h,f])=>[h/.05,f/.05]),u=[d.reduce((h,[f])=>h+f,0)/d.length,d.reduce((h,[,f])=>h+f,0)/d.length];return{name:c.name,boundary:d,boundary_closed:!0,center:u}})},t=new TextEncoder().encode(JSON.stringify(e)),r=[];for(let c=10;c<130;c+=2)for(let d=10;d<170;d+=2){let u=d<80?c<65?0:2:c<72?1:3,h=[[185,219,224],[201,211,233],[210,226,194],[232,207,207]][u]||[190,205,215];r.push([d,c,0,...h])}let n=500;for(let c=0;c<n;c+=1){let d=c%4,u=c*7%120,h=d<2?d===0?10:168:10+u,f=d>=2?d===2?10:128:10+u;r.push([h,f,10+c%18,104,122,137])}let i=r.length-n,a=new ArrayBuffer(24+t.byteLength+r.length*8),s=new DataView(a);new Uint8Array(a,0,8).set(new TextEncoder().encode("MATIC3D\0")),s.setUint16(8,1,!0),s.setUint16(10,8,!0),s.setUint32(12,t.byteLength,!0),s.setUint32(16,i,!0),s.setUint32(20,n,!0),new Uint8Array(a,24,t.byteLength).set(t);let l=new DataView(a,24+t.byteLength);return r.forEach(([c=0,d=0,u=0,h=0,f=0,v=0],$)=>{let g=$*8;l.setUint16(g,c,!0),l.setUint16(g+2,d,!0),l.setUint8(g+4,u),l.setUint8(g+5,h),l.setUint8(g+6,f),l.setUint8(g+7,v)}),{buffer:a,pointOffset:24+t.byteLength,floorCount:i,surfaceCount:n,total:r.length,revision:7,etag:'"synthetic-scene"',source:"live",metadata:{metersPerCell:.05,origin:[0,0],span:o,sampleStep:1,rooms:e.rooms.map((c,d)=>({id:ae[d]?.roomId||`room-${d}`,name:c.name,boundary:c.boundary,center:c.center}))}}},Ae=()=>({entryId:"synthetic-entry",sceneUrl:"/api/matic_robot/slam_scene/synthetic",deltaUrl:"/api/matic_robot/slam_delta/synthetic",poseUrl:"/api/matic_robot/slam_pose/synthetic",historyUrl:"/api/matic_robot/slam_history/synthetic",areasUrl:"/api/matic_robot/areas/synthetic",plansUrl:"/api/matic_robot/plans/synthetic",mapRevision:7,mapFloorCoherent:!0,mapSessionVerified:!0,mapSessionKey:Nt,mapBlockReason:null,runnerLocked:!1,stopSettlePending:!1,activePlan:!1,nativeReconciliationPending:!1,nativeSessionActive:!1,mapComplete:!0,mapTruncated:!1,selectedFloorOrdinal:1,mapFloorOrdinal:1,historyCount:2,historyFloorCount:2,health:"ready",streamFailures:0,bootstrapState:"complete",bootstrapPhotoSeen:!0,bootstrapStructureSeen:!0,bootstrapFailures:0}),Qe=()=>({rooms:ae.map(({roomId:o,name:e})=>({roomId:o,name:e})),selectedPlan:"daily",plans:[{id:"daily",name:"Daily clean",enabled:!0,runBehavior:"intelligent",rooms:ae.slice(0,3).map(({roomId:o})=>({roomId:o,cleaningMode:"vacuum",coverageSetting:"standard"})),roomOrder:ae.slice(0,3).map(({roomId:o})=>o),returnToBase:!0,finishCurrentRoom:!1,finishCurrentRoomThreshold:50}]}),Je=()=>({sceneUrl:Ae().sceneUrl,rooms:ae.map(o=>({...o,boundary:o.boundary.map(e=>[...e])})),areas:[{id:"entryway",name:"Entryway",circles:[{x:1.5,y:1.4,radius:.3},{x:1.9,y:1.6,radius:.3}],cleaningMode:"vacuum",coverageSetting:"standard",status:"current",canRebind:!1}]}),Wt=()=>({entryId:"synthetic-entry",liveAvailable:!0,floors:[{id:"current",active:!0,readOnly:!1,liveAvailable:!0,label:"House",ordinal:null,snapshots:[{id:"current-old",createdAt:"2026-08-29T14:00:00Z",revision:6,pointCount:5300,sceneUrl:"/synthetic-history-current-old"},{id:"current-new",createdAt:"2026-08-29T16:12:00Z",revision:7,pointCount:5300,sceneUrl:"/synthetic-history-current-new"}]},{id:"saved-1",active:!1,readOnly:!0,liveAvailable:!1,label:"Shed",ordinal:2,snapshots:[{id:"saved-one",createdAt:"2026-08-28T11:30:00Z",revision:3,pointCount:3100,sceneUrl:"/synthetic-history-saved"}]}]}),Ht=()=>({position:[92,74],source:"latest_pose",revision:7,poseRevision:4,floorCoherent:!0,mapSessionKey:Nt,freshness:"live"});var qr=()=>({...M(),coherence:"current",activity:"docked",batteryPercent:92,robots:[{entryId:"synthetic-entry",label:"Matic robot"}],host:{connected:!0,administrator:!0,robotConnected:!0,robotCount:1},floor:{classifiedCount:2,displayName:"House",readOnly:!1},map:{available:!0,complete:!0,floorCoherent:!0,sessionVerified:!0,exactPose:!0},resources:{catalog:{status:"ready",value:[Ae()],problem:null},entry:Ae(),scene:{status:"ready",value:Ut(),problem:null},pose:{status:"ready",value:Ht(),problem:null},history:{status:"ready",value:Wt(),problem:null},plans:{status:"ready",value:Qe(),problem:null},areas:{status:"ready",value:Je(),problem:null}},selection:{...M().selection,entryId:"synthetic-entry",planId:"daily"},planDraft:{...M().planDraft,id:"daily",name:"Daily clean",rooms:Qe().plans[0]?.rooms||[]}}),et=o=>{let e=qr();switch(o){case"ready":return e;case"cleaning":return{...e,activity:"cleaning"};case"paused":return{...e,activity:"paused"};case"returning":return{...e,activity:"returning"};case"rooms":return{...e,workflow:"rooms"};case"draw":return{...e,workflow:"draw",areaDraft:{...e.areaDraft,id:"entryway",name:"Entryway",status:"current"},selection:{...e.selection,areaId:"entryway"},draw:{...e.draw,dirty:!0,strokeCount:3,circles:Je().areas[0]?.circles||[]}};case"history":return{...e,dataMode:"history",workflow:"history",floor:{...e.floor,readOnly:!0},map:{...e.map,exactPose:!1},selection:{...e.selection,floorId:"saved-1",historyId:"saved-one"}};case"transition":return{...e,coherence:"verifying",activity:"unknown",map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1}};case"problem":return{...e,activity:"problem",coherence:"blocked"};case"ha-offline":return{...e,coherence:"degraded",host:{...e.host,connected:!1},map:{...e.map,exactPose:!1}};case"robot-offline":return{...e,coherence:"degraded",host:{...e.host,robotConnected:!1},map:{...e.map,exactPose:!1}};case"access":return{...e,coherence:"blocked",host:{...e.host,administrator:!1},map:{...e.map,available:!1,exactPose:!1}};case"empty":return{...e,coherence:"unavailable",host:{...e.host,robotConnected:!1,robotCount:0},map:{...e.map,available:!1,exactPose:!1}};case"unsupported":return{...e,coherence:"blocked",map:{...e.map,available:!1,exactPose:!1}};case"multi-robot":return{...e,host:{...e.host,robotCount:2},robots:[{entryId:"synthetic-entry",label:"Matic robot"},{entryId:"synthetic-entry-two",label:"Second robot"}]}}},tt=["ready","cleaning","paused","returning","rooms","draw","history","transition","problem","ha-offline","robot-offline","access","empty","unsupported","multi-robot"];var Vr=o=>{switch(o){case"cleaning":return"cleaning";case"paused":return"paused";case"returning":return"returning";case"docked":return"docked";case"idle":return"idle";case"error":return"problem";default:return"unknown"}},Kr=o=>typeof o!="number"||!Number.isFinite(o)?null:Math.round(Math.max(0,Math.min(100,o))),Xr=o=>{let e=o.attributes?.matic_entry_id;return typeof e=="string"&&e.length>0?e:null},jr=o=>String(o||"local-user").replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",Bt=o=>{if(typeof o!="string")return"Matic robot";let e=o.trim();return e&&Array.from(e).length<=128&&!/[\u0000-\u001f\u007f]/u.test(e)?e:"Matic robot"},Pe=class{#e="";#t=null;project(e,t,r=null){let n=e?.states??{},i=t?.config?.entry_id,a=typeof i=="string"?i:null,s=new Set,l=null,c=null,d=null,u=new Map;for(let[C,A]of Object.entries(n)){let K=Xr(A);if(!K||(s.add(K),!C.startsWith("vacuum.")))continue;u.set(K,{entryId:K,label:Bt(A.attributes?.friendly_name)});let ke=r||a;(!l||ke&&K===ke)&&(l=A,c=C,d=K)}let h={connected:e?.connected!==!1,administrator:e?.user?.is_admin===!0,robotConnected:l!==null&&l.state!=="unavailable"&&l.state!=="unknown",robotCount:s.size},f=l?Vr(l.state):"unknown",v=Kr(l?.attributes?.battery_level),$=e?.selectedLanguage||e?.language||"en",g=jr(e?.user?.id),w=Bt(l?.attributes?.friendly_name),E=[...u.values()].sort((C,A)=>C.label.localeCompare(A.label,$,{sensitivity:"base"})),k=[h.connected,h.administrator,h.robotConnected,h.robotCount,f,v??"none",$,g,c??"none",d??"none",w,E.map(C=>`${C.entryId}:${C.label}`).join(",")].join("|");return k===this.#e&&this.#t?this.#t:(this.#e=k,this.#t={host:h,activity:f,batteryPercent:v,language:$,userKey:g,vacuumEntityId:c,entryKey:d,robotLabel:w,robots:E},this.#t)}};var Ee=globalThis,Re=Ee.ShadowRoot&&(Ee.ShadyCSS===void 0||Ee.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,rt=Symbol(),Ft=new WeakMap,he=class{constructor(e,t,r){if(this._$cssResult$=!0,r!==rt)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=e,this.t=t}get styleSheet(){let e=this.o,t=this.t;if(Re&&e===void 0){let r=t!==void 0&&t.length===1;r&&(e=Ft.get(t)),e===void 0&&((this.o=e=new CSSStyleSheet).replaceSync(this.cssText),r&&Ft.set(t,e))}return e}toString(){return this.cssText}},qt=o=>new he(typeof o=="string"?o:o+"",void 0,rt),D=(o,...e)=>{let t=o.length===1?o[0]:e.reduce((r,n,i)=>r+(a=>{if(a._$cssResult$===!0)return a.cssText;if(typeof a=="number")return a;throw Error("Value passed to 'css' function must be a 'css' function result: "+a+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(n)+o[i+1],o[0]);return new he(t,o,rt)},Vt=(o,e)=>{if(Re)o.adoptedStyleSheets=e.map(t=>t instanceof CSSStyleSheet?t:t.styleSheet);else for(let t of e){let r=document.createElement("style"),n=Ee.litNonce;n!==void 0&&r.setAttribute("nonce",n),r.textContent=t.cssText,o.appendChild(r)}},ot=Re?o=>o:o=>o instanceof CSSStyleSheet?(e=>{let t="";for(let r of e.cssRules)t+=r.cssText;return qt(t)})(o):o;var{is:Yr,defineProperty:Zr,getOwnPropertyDescriptor:Gr,getOwnPropertyNames:Qr,getOwnPropertySymbols:Jr,getPrototypeOf:eo}=Object,Ie=globalThis,Kt=Ie.trustedTypes,to=Kt?Kt.emptyScript:"",ro=Ie.reactiveElementPolyfillSupport,me=(o,e)=>o,nt={toAttribute(o,e){switch(e){case Boolean:o=o?to:null;break;case Object:case Array:o=o==null?o:JSON.stringify(o)}return o},fromAttribute(o,e){let t=o;switch(e){case Boolean:t=o!==null;break;case Number:t=o===null?null:Number(o);break;case Object:case Array:try{t=JSON.parse(o)}catch{t=null}}return t}},jt=(o,e)=>!Yr(o,e),Xt={attribute:!0,type:String,converter:nt,reflect:!1,useDefault:!1,hasChanged:jt};Symbol.metadata??=Symbol("metadata"),Ie.litPropertyMetadata??=new WeakMap;var F=class extends HTMLElement{static addInitializer(e){this._$Ei(),(this.l??=[]).push(e)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(e,t=Xt){if(t.state&&(t.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(e)&&((t=Object.create(t)).wrapped=!0),this.elementProperties.set(e,t),!t.noAccessor){let r=Symbol(),n=this.getPropertyDescriptor(e,r,t);n!==void 0&&Zr(this.prototype,e,n)}}static getPropertyDescriptor(e,t,r){let{get:n,set:i}=Gr(this.prototype,e)??{get(){return this[t]},set(a){this[t]=a}};return{get:n,set(a){let s=n?.call(this);i?.call(this,a),this.requestUpdate(e,s,r)},configurable:!0,enumerable:!0}}static getPropertyOptions(e){return this.elementProperties.get(e)??Xt}static _$Ei(){if(this.hasOwnProperty(me("elementProperties")))return;let e=eo(this);e.finalize(),e.l!==void 0&&(this.l=[...e.l]),this.elementProperties=new Map(e.elementProperties)}static finalize(){if(this.hasOwnProperty(me("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(me("properties"))){let t=this.properties,r=[...Qr(t),...Jr(t)];for(let n of r)this.createProperty(n,t[n])}let e=this[Symbol.metadata];if(e!==null){let t=litPropertyMetadata.get(e);if(t!==void 0)for(let[r,n]of t)this.elementProperties.set(r,n)}this._$Eh=new Map;for(let[t,r]of this.elementProperties){let n=this._$Eu(t,r);n!==void 0&&this._$Eh.set(n,t)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(e){let t=[];if(Array.isArray(e)){let r=new Set(e.flat(1/0).reverse());for(let n of r)t.unshift(ot(n))}else e!==void 0&&t.push(ot(e));return t}static _$Eu(e,t){let r=t.attribute;return r===!1?void 0:typeof r=="string"?r:typeof e=="string"?e.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){this._$ES=new Promise(e=>this.enableUpdating=e),this._$AL=new Map,this._$E_(),this.requestUpdate(),this.constructor.l?.forEach(e=>e(this))}addController(e){(this._$EO??=new Set).add(e),this.renderRoot!==void 0&&this.isConnected&&e.hostConnected?.()}removeController(e){this._$EO?.delete(e)}_$E_(){let e=new Map,t=this.constructor.elementProperties;for(let r of t.keys())this.hasOwnProperty(r)&&(e.set(r,this[r]),delete this[r]);e.size>0&&(this._$Ep=e)}createRenderRoot(){let e=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return Vt(e,this.constructor.elementStyles),e}connectedCallback(){this.renderRoot??=this.createRenderRoot(),this.enableUpdating(!0),this._$EO?.forEach(e=>e.hostConnected?.())}enableUpdating(e){}disconnectedCallback(){this._$EO?.forEach(e=>e.hostDisconnected?.())}attributeChangedCallback(e,t,r){this._$AK(e,r)}_$ET(e,t){let r=this.constructor.elementProperties.get(e),n=this.constructor._$Eu(e,r);if(n!==void 0&&r.reflect===!0){let i=(r.converter?.toAttribute!==void 0?r.converter:nt).toAttribute(t,r.type);this._$Em=e,i==null?this.removeAttribute(n):this.setAttribute(n,i),this._$Em=null}}_$AK(e,t){let r=this.constructor,n=r._$Eh.get(e);if(n!==void 0&&this._$Em!==n){let i=r.getPropertyOptions(n),a=typeof i.converter=="function"?{fromAttribute:i.converter}:i.converter?.fromAttribute!==void 0?i.converter:nt;this._$Em=n;let s=a.fromAttribute(t,i.type);this[n]=s??this._$Ej?.get(n)??s,this._$Em=null}}requestUpdate(e,t,r,n=!1,i){if(e!==void 0){let a=this.constructor;if(n===!1&&(i=this[e]),r??=a.getPropertyOptions(e),!((r.hasChanged??jt)(i,t)||r.useDefault&&r.reflect&&i===this._$Ej?.get(e)&&!this.hasAttribute(a._$Eu(e,r))))return;this.C(e,t,r)}this.isUpdatePending===!1&&(this._$ES=this._$EP())}C(e,t,{useDefault:r,reflect:n,wrapped:i},a){r&&!(this._$Ej??=new Map).has(e)&&(this._$Ej.set(e,a??t??this[e]),i!==!0||a!==void 0)||(this._$AL.has(e)||(this.hasUpdated||r||(t=void 0),this._$AL.set(e,t)),n===!0&&this._$Em!==e&&(this._$Eq??=new Set).add(e))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(t){Promise.reject(t)}let e=this.scheduleUpdate();return e!=null&&await e,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??=this.createRenderRoot(),this._$Ep){for(let[n,i]of this._$Ep)this[n]=i;this._$Ep=void 0}let r=this.constructor.elementProperties;if(r.size>0)for(let[n,i]of r){let{wrapped:a}=i,s=this[n];a!==!0||this._$AL.has(n)||s===void 0||this.C(n,void 0,i,s)}}let e=!1,t=this._$AL;try{e=this.shouldUpdate(t),e?(this.willUpdate(t),this._$EO?.forEach(r=>r.hostUpdate?.()),this.update(t)):this._$EM()}catch(r){throw e=!1,this._$EM(),r}e&&this._$AE(t)}willUpdate(e){}_$AE(e){this._$EO?.forEach(t=>t.hostUpdated?.()),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(e)),this.updated(e)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(e){return!0}update(e){this._$Eq&&=this._$Eq.forEach(t=>this._$ET(t,this[t])),this._$EM()}updated(e){}firstUpdated(e){}};F.elementStyles=[],F.shadowRootOptions={mode:"open"},F[me("elementProperties")]=new Map,F[me("finalized")]=new Map,ro?.({ReactiveElement:F}),(Ie.reactiveElementVersions??=[]).push("2.1.2");var ut=globalThis,Yt=o=>o,ze=ut.trustedTypes,Zt=ze?ze.createPolicy("lit-html",{createHTML:o=>o}):void 0,rr="$lit$",X=`lit$${Math.random().toFixed(9).slice(2)}$`,or="?"+X,oo=`<${or}>`,Q=document,ye=()=>Q.createComment(""),be=o=>o===null||typeof o!="object"&&typeof o!="function",pt=Array.isArray,no=o=>pt(o)||typeof o?.[Symbol.iterator]=="function",it=`[
\f\r]`,fe=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,Gt=/-->/g,Qt=/>/g,Z=RegExp(`>|${it}(?:([^\\s"'>=/]+)(${it}*=${it}*(?:[^
\f\r"'\`<>=]|("|')|))|$)`,"g"),Jt=/'/g,er=/"/g,nr=/^(?:script|style|textarea|title)$/i,ht=o=>(e,...t)=>({_$litType$:o,strings:e,values:t}),p=ht(1),Go=ht(2),Qo=ht(3),J=Symbol.for("lit-noChange"),m=Symbol.for("lit-nothing"),tr=new WeakMap,G=Q.createTreeWalker(Q,129);function ir(o,e){if(!pt(o)||!o.hasOwnProperty("raw"))throw Error("invalid template strings array");return Zt!==void 0?Zt.createHTML(e):e}var io=(o,e)=>{let t=o.length-1,r=[],n,i=e===2?"<svg>":e===3?"<math>":"",a=fe;for(let s=0;s<t;s++){let l=o[s],c,d,u=-1,h=0;for(;h<l.length&&(a.lastIndex=h,d=a.exec(l),d!==null);)h=a.lastIndex,a===fe?d[1]==="!--"?a=Gt:d[1]!==void 0?a=Qt:d[2]!==void 0?(nr.test(d[2])&&(n=RegExp("</"+d[2],"g")),a=Z):d[3]!==void 0&&(a=Z):a===Z?d[0]===">"?(a=n??fe,u=-1):d[1]===void 0?u=-2:(u=a.lastIndex-d[2].length,c=d[1],a=d[3]===void 0?Z:d[3]==='"'?er:Jt):a===er||a===Jt?a=Z:a===Gt||a===Qt?a=fe:(a=Z,n=void 0);let f=a===Z&&o[s+1].startsWith("/>")?" ":"";i+=a===fe?l+oo:u>=0?(r.push(c),l.slice(0,u)+rr+l.slice(u)+X+f):l+X+(u===-2?s:f)}return[ir(o,i+(o[t]||"<?>")+(e===2?"</svg>":e===3?"</math>":"")),r]},ve=class o{constructor({strings:e,_$litType$:t},r){let n;this.parts=[];let i=0,a=0,s=e.length-1,l=this.parts,[c,d]=io(e,t);if(this.el=o.createElement(c,r),G.currentNode=this.el.content,t===2||t===3){let u=this.el.content.firstChild;u.replaceWith(...u.childNodes)}for(;(n=G.nextNode())!==null&&l.length<s;){if(n.nodeType===1){if(n.hasAttributes())for(let u of n.getAttributeNames())if(u.endsWith(rr)){let h=d[a++],f=n.getAttribute(u).split(X),v=/([.?@])?(.*)/.exec(h);l.push({type:1,index:i,name:v[2],strings:f,ctor:v[1]==="."?st:v[1]==="?"?lt:v[1]==="@"?ct:le}),n.removeAttribute(u)}else u.startsWith(X)&&(l.push({type:6,index:i}),n.removeAttribute(u));if(nr.test(n.tagName)){let u=n.textContent.split(X),h=u.length-1;if(h>0){n.textContent=ze?ze.emptyScript:"";for(let f=0;f<h;f++)n.append(u[f],ye()),G.nextNode(),l.push({type:2,index:++i});n.append(u[h],ye())}}}else if(n.nodeType===8)if(n.data===or)l.push({type:2,index:i});else{let u=-1;for(;(u=n.data.indexOf(X,u+1))!==-1;)l.push({type:7,index:i}),u+=X.length-1}i++}}static createElement(e,t){let r=Q.createElement("template");return r.innerHTML=e,r}};function se(o,e,t=o,r){if(e===J)return e;let n=r!==void 0?t._$Co?.[r]:t._$Cl,i=be(e)?void 0:e._$litDirective$;return n?.constructor!==i&&(n?._$AO?.(!1),i===void 0?n=void 0:(n=new i(o),n._$AT(o,t,r)),r!==void 0?(t._$Co??=[])[r]=n:t._$Cl=n),n!==void 0&&(e=se(o,n._$AS(o,e.values),n,r)),e}var at=class{constructor(e,t){this._$AV=[],this._$AN=void 0,this._$AD=e,this._$AM=t}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(e){let{el:{content:t},parts:r}=this._$AD,n=(e?.creationScope??Q).importNode(t,!0);G.currentNode=n;let i=G.nextNode(),a=0,s=0,l=r[0];for(;l!==void 0;){if(a===l.index){let c;l.type===2?c=new ge(i,i.nextSibling,this,e):l.type===1?c=new l.ctor(i,l.name,l.strings,this,e):l.type===6&&(c=new dt(i,this,e)),this._$AV.push(c),l=r[++s]}a!==l?.index&&(i=G.nextNode(),a++)}return G.currentNode=Q,n}p(e){let t=0;for(let r of this._$AV)r!==void 0&&(r.strings!==void 0?(r._$AI(e,r,t),t+=r.strings.length-2):r._$AI(e[t])),t++}},ge=class o{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(e,t,r,n){this.type=2,this._$AH=m,this._$AN=void 0,this._$AA=e,this._$AB=t,this._$AM=r,this.options=n,this._$Cv=n?.isConnected??!0}get parentNode(){let e=this._$AA.parentNode,t=this._$AM;return t!==void 0&&e?.nodeType===11&&(e=t.parentNode),e}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(e,t=this){e=se(this,e,t),be(e)?e===m||e==null||e===""?(this._$AH!==m&&this._$AR(),this._$AH=m):e!==this._$AH&&e!==J&&this._(e):e._$litType$!==void 0?this.$(e):e.nodeType!==void 0?this.T(e):no(e)?this.k(e):this._(e)}O(e){return this._$AA.parentNode.insertBefore(e,this._$AB)}T(e){this._$AH!==e&&(this._$AR(),this._$AH=this.O(e))}_(e){this._$AH!==m&&be(this._$AH)?this._$AA.nextSibling.data=e:this.T(Q.createTextNode(e)),this._$AH=e}$(e){let{values:t,_$litType$:r}=e,n=typeof r=="number"?this._$AC(e):(r.el===void 0&&(r.el=ve.createElement(ir(r.h,r.h[0]),this.options)),r);if(this._$AH?._$AD===n)this._$AH.p(t);else{let i=new at(n,this),a=i.u(this.options);i.p(t),this.T(a),this._$AH=i}}_$AC(e){let t=tr.get(e.strings);return t===void 0&&tr.set(e.strings,t=new ve(e)),t}k(e){pt(this._$AH)||(this._$AH=[],this._$AR());let t=this._$AH,r,n=0;for(let i of e)n===t.length?t.push(r=new o(this.O(ye()),this.O(ye()),this,this.options)):r=t[n],r._$AI(i),n++;n<t.length&&(this._$AR(r&&r._$AB.nextSibling,n),t.length=n)}_$AR(e=this._$AA.nextSibling,t){for(this._$AP?.(!1,!0,t);e!==this._$AB;){let r=Yt(e).nextSibling;Yt(e).remove(),e=r}}setConnected(e){this._$AM===void 0&&(this._$Cv=e,this._$AP?.(e))}},le=class{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(e,t,r,n,i){this.type=1,this._$AH=m,this._$AN=void 0,this.element=e,this.name=t,this._$AM=n,this.options=i,r.length>2||r[0]!==""||r[1]!==""?(this._$AH=Array(r.length-1).fill(new String),this.strings=r):this._$AH=m}_$AI(e,t=this,r,n){let i=this.strings,a=!1;if(i===void 0)e=se(this,e,t,0),a=!be(e)||e!==this._$AH&&e!==J,a&&(this._$AH=e);else{let s=e,l,c;for(e=i[0],l=0;l<i.length-1;l++)c=se(this,s[r+l],t,l),c===J&&(c=this._$AH[l]),a||=!be(c)||c!==this._$AH[l],c===m?e=m:e!==m&&(e+=(c??"")+i[l+1]),this._$AH[l]=c}a&&!n&&this.j(e)}j(e){e===m?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,e??"")}},st=class extends le{constructor(){super(...arguments),this.type=3}j(e){this.element[this.name]=e===m?void 0:e}},lt=class extends le{constructor(){super(...arguments),this.type=4}j(e){this.element.toggleAttribute(this.name,!!e&&e!==m)}},ct=class extends le{constructor(e,t,r,n,i){super(e,t,r,n,i),this.type=5}_$AI(e,t=this){if((e=se(this,e,t,0)??m)===J)return;let r=this._$AH,n=e===m&&r!==m||e.capture!==r.capture||e.once!==r.once||e.passive!==r.passive,i=e!==m&&(r===m||n);n&&this.element.removeEventListener(this.name,this,r),i&&this.element.addEventListener(this.name,this,e),this._$AH=e}handleEvent(e){typeof this._$AH=="function"?this._$AH.call(this.options?.host??this.element,e):this._$AH.handleEvent(e)}},dt=class{constructor(e,t,r){this.element=e,this.type=6,this._$AN=void 0,this._$AM=t,this.options=r}get _$AU(){return this._$AM._$AU}_$AI(e){se(this,e)}};var ao=ut.litHtmlPolyfillSupport;ao?.(ve,ge),(ut.litHtmlVersions??=[]).push("3.3.3");var ar=(o,e,t)=>{let r=t?.renderBefore??e,n=r._$litPart$;if(n===void 0){let i=t?.renderBefore??null;r._$litPart$=n=new ge(e.insertBefore(ye(),i),i,void 0,t??{})}return n._$AI(o),n};var mt=globalThis,x=class extends F{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){let e=super.createRenderRoot();return this.renderOptions.renderBefore??=e.firstChild,e}update(e){let t=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(e),this._$Do=ar(t,this.renderRoot,this.renderOptions)}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(!0)}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(!1)}render(){return J}};x._$litElement$=!0,x.finalized=!0,mt.litElementHydrateSupport?.({LitElement:x});var so=mt.litElementPolyfillSupport;so?.({LitElement:x});(mt.litElementVersions??=[]).push("4.2.2");var sr=(o,e)=>Math.hypot(o.x-e.x,o.y-e.y),lr=(o,e)=>({x:(o.x+e.x)/2,y:(o.y+e.y)/2}),ft=o=>o.map(e=>({...e})),cr=o=>o instanceof Element&&!!o.closest("button, input, select, textarea, a, [role='button'], [role='menuitem']"),Te=class{#e;#t;#o;#r=new Map;#a=!1;#i="idle";#l=[];#c=[];#u=null;#s=0;#b=null;#p=!1;#g=null;#m=!1;constructor(e,t,r){this.#e=e,this.#t=t,this.#o=r,e.addEventListener("pointerdown",this.#w),e.addEventListener("pointermove",this.#f),e.addEventListener("pointerup",this.#d),e.addEventListener("pointercancel",this.#d),e.addEventListener("wheel",this.#x,{passive:!1}),e.addEventListener("keydown",this.#k),e.addEventListener("keyup",this.#n),e.addEventListener("blur",this.#y)}#w=e=>{if(this.#m||!e.isPrimary&&e.pointerType==="mouse"||cr(e.target))return;this.#e.focus({preventScroll:!0});let t={id:e.pointerId,type:e.pointerType,startX:e.clientX,startY:e.clientY,x:e.clientX,y:e.clientY};if(this.#r.set(e.pointerId,t),this.#e.setPointerCapture?.(e.pointerId),this.#r.size>=2){this.#v(),(this.#i==="paint"||this.#i==="erase")&&(this.#c=ft(this.#l),this.#o.onCircles(this.#c,!1)),this.#i="pinch",this.#p=!0;let[a,s]=[...this.#r.values()];a&&s&&(this.#s=Math.max(1,sr(a,s)),this.#b=lr(a,s)),e.preventDefault();return}let r=this.#o.state(),n=r.workflow==="draw"&&r.map.available&&!r.floor.readOnly;this.#p||this.#a||e.button===1||r.draw.tool==="pan"?this.#i="pan":n&&(r.draw.tool==="paint"||r.draw.tool==="erase")?(this.#l=ft(r.draw.circles),this.#c=ft(r.draw.circles),e.pointerType==="touch"?(this.#i="idle",this.#g=window.setTimeout(()=>{if(this.#g=null,this.#r.size!==1||this.#p)return;this.#i=r.draw.tool;let a=this.#r.get(e.pointerId);a&&this.#_(a.x,a.y)},110)):(this.#i=r.draw.tool,this.#_(e.clientX,e.clientY))):this.#i=r.view==="three"&&!e.shiftKey?"orbit":"pan",e.preventDefault()};#f=e=>{let t=this.#r.get(e.pointerId);if(!t){let a=this.#t.screenToMap(e.clientX,e.clientY);this.#t.setCursor(a);return}let r=t.x,n=t.y;if(t.x=e.clientX,t.y=e.clientY,this.#i==="pinch"&&this.#r.size>=2){let[a,s]=[...this.#r.values()];if(!a||!s)return;let l=Math.max(1,sr(a,s)),c=lr(a,s);this.#t.zoomAt(l/this.#s,c.x,c.y),this.#b&&this.#t.panBy(c.x-this.#b.x,c.y-this.#b.y),this.#s=l,this.#b=c,e.preventDefault();return}this.#i==="paint"||this.#i==="erase"?this.#_(e.clientX,e.clientY):this.#i==="pan"?this.#t.panBy(e.clientX-r,e.clientY-n):this.#i==="orbit"&&this.#t.orbitBy(e.clientX-r,e.clientY-n);let i=this.#t.screenToMap(e.clientX,e.clientY);this.#t.setCursor(i),e.preventDefault()};#d=e=>{let t=this.#r.get(e.pointerId);if(t){if(this.#r.delete(e.pointerId),this.#e.releasePointerCapture?.(e.pointerId),this.#v(),(this.#i==="paint"||this.#i==="erase")&&JSON.stringify(this.#c)!==JSON.stringify(this.#l))this.#o.onCircles(this.#c,!0,this.#l);else if(this.#i!=="pinch"&&!this.#p&&Math.hypot(t.x-t.startX,t.y-t.startY)<7&&this.#o.state().workflow==="rooms"){let r=this.#t.roomAt(t.x,t.y);r&&this.#o.onRoom(r)}this.#r.size===0?(this.#i="idle",this.#p=!1,this.#b=null,this.#u=null):this.#i==="pinch"&&(this.#i="pan",this.#p=!0),e.preventDefault()}};#_(e,t){let r=this.#t.screenToMap(e,t);if(!r)return;let i=this.#o.state().draw.brushMeters/2;if(this.#i==="erase")this.#c=this.#c.filter(a=>Math.hypot(a.x-r.x,a.y-r.y)>a.radius+i);else{if(!this.#t.containsMapPoint(r))return;let a=Math.max(.04,i*.55),s=this.#u||r,l=Math.hypot(r.x-s.x,r.y-s.y),c=Math.max(1,Math.ceil(l/a));for(let d=0;d<=c&&this.#c.length<512;d+=1){let u=d/c,h={x:s.x+(r.x-s.x)*u,y:s.y+(r.y-s.y)*u};this.#c.some(f=>Math.hypot(f.x-h.x,f.y-h.y)<Math.max(.025,i*.28))||this.#c.push({x:Math.round(h.x*1e4)/1e4,y:Math.round(h.y*1e4)/1e4,radius:Math.round(i*100)/100})}}this.#u=r,this.#o.onCircles(this.#c,!1)}#x=e=>{if(!(e.ctrlKey||e.metaKey||e.altKey)&&!cr(e.target)){if(e.preventDefault(),Math.abs(e.deltaX)>Math.abs(e.deltaY)*.7&&Math.abs(e.deltaX)<50){this.#t.panBy(-e.deltaX,-e.deltaY);return}this.#t.zoomAt(Math.exp(-e.deltaY*.0015),e.clientX,e.clientY)}};#k=e=>{if(!(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey)){if(e.code==="Space"){this.#a=!0,e.preventDefault();return}if(e.key==="+"||e.key==="=")this.#t.zoomAt(1.25);else if(e.key==="-")this.#t.zoomAt(.8);else if(e.key==="0")this.#t.fit();else if(e.key==="[")this.#t.orbitBy(-52,0);else if(e.key==="]")this.#t.orbitBy(52,0);else if(e.key==="PageUp")this.#t.orbitBy(0,-30);else if(e.key==="PageDown")this.#t.orbitBy(0,30);else if(e.key.toLocaleLowerCase()==="d"&&this.#o.state().workflow==="draw")this.#e.dispatchEvent(new CustomEvent("matic-workspace-intent",{detail:{type:"set-draw-tool",tool:"paint"},bubbles:!0,composed:!0}));else if(e.key.toLocaleLowerCase()==="e"&&this.#o.state().workflow==="draw")this.#e.dispatchEvent(new CustomEvent("matic-workspace-intent",{detail:{type:"set-draw-tool",tool:"erase"},bubbles:!0,composed:!0}));else if(e.key==="ArrowLeft")this.#t.panBy(30,0);else if(e.key==="ArrowRight")this.#t.panBy(-30,0);else if(e.key==="ArrowUp")this.#t.panBy(0,30);else if(e.key==="ArrowDown")this.#t.panBy(0,-30);else return;e.preventDefault()}};#n=e=>{e.code==="Space"&&(this.#a=!1)};#y=()=>{this.#a=!1,this.#v(),this.#t.setCursor(null)};#v(){this.#g!==null&&window.clearTimeout(this.#g),this.#g=null}dispose(){this.#m||(this.#m=!0,this.#v(),this.#e.removeEventListener("pointerdown",this.#w),this.#e.removeEventListener("pointermove",this.#f),this.#e.removeEventListener("pointerup",this.#d),this.#e.removeEventListener("pointercancel",this.#d),this.#e.removeEventListener("wheel",this.#x),this.#e.removeEventListener("keydown",this.#k),this.#e.removeEventListener("keyup",this.#n),this.#e.removeEventListener("blur",this.#y),this.#r.clear())}};var N=(o,e,t)=>Math.max(e,Math.min(t,o)),lo=o=>{let e=o;for(;e>Math.PI;)e-=Math.PI*2;for(;e<-Math.PI;)e+=Math.PI*2;return e},co=o=>{switch(o){case"efficient":return .35;case"balanced":return .65;case"maximum":case"auto":return 1}},uo=(o,e)=>{let t=new Float32Array(16);for(let r=0;r<4;r+=1)for(let n=0;n<4;n+=1){let i=0;for(let a=0;a<4;a+=1)i+=(o[a*4+n]??0)*(e[r*4+a]??0);t[r*4+n]=i}return t},po=(o,e,t,r)=>{let n=1/Math.tan(o/2),i=new Float32Array(16);return i[0]=n/e,i[5]=n,i[10]=(r+t)/(t-r),i[11]=-1,i[14]=2*r*t/(t-r),i},ho=(o,e,t,r,n,i)=>{let a=new Float32Array(16);return a[0]=2/(e-o),a[5]=2/(r-t),a[10]=-2/(i-n),a[12]=-(e+o)/(e-o),a[13]=-(r+t)/(r-t),a[14]=-(i+n)/(i-n),a[15]=1,a},mo=(o,e)=>{let t=Math.hypot((o[0]??0)-(e[0]??0),(o[1]??0)-(e[1]??0),(o[2]??0)-(e[2]??0))||1,r=[((o[0]??0)-(e[0]??0))/t,((o[1]??0)-(e[1]??0))/t,((o[2]??0)-(e[2]??0))/t],n=Math.hypot(r[2]??0,r[0]??0)||1,i=[(r[2]??0)/n,0,-(r[0]??0)/n],a=[(r[1]??0)*(i[2]??0),(r[2]??0)*(i[0]??0)-(r[0]??0)*(i[2]??0),-(r[1]??0)*(i[0]??0)];return new Float32Array([i[0]??0,a[0]??0,r[0]??0,0,i[1]??0,a[1]??0,r[1]??0,0,i[2]??0,a[2]??0,r[2]??0,0,-((i[0]??0)*(o[0]??0)+(i[1]??0)*(o[1]??0)+(i[2]??0)*(o[2]??0)),-((a[0]??0)*(o[0]??0)+(a[1]??0)*(o[1]??0)+(a[2]??0)*(o[2]??0)),-((r[0]??0)*(o[0]??0)+(r[1]??0)*(o[1]??0)+(r[2]??0)*(o[2]??0)),1])},dr=(o,e,t)=>{let r=!1,n=t.at(-1);if(!n)return!1;for(let i of t){let[a,s]=i,[l,c]=n;s>e!=c>e&&o<(l-a)*(e-s)/(c-s)+a&&(r=!r),n=i}return r},Le=class{#e;#t;#o;#r=null;#a=null;#i=null;#l=null;#c=null;#u=null;#s=null;#b=null;#p=null;#g=null;#m=null;#w=null;#f=null;#d=null;#_=null;#x=null;#k;#n={yaw:-Math.PI/4,pitch:.82,distance:12,targetX:0,targetZ:0,orthographic:!1};#y=12;#v=8;#h=4;#S=new Float32Array(16);#$=null;#P="unavailable";#z=0;#M=0;#R=0;#E=0;#I=1;#A={width:1,height:1,left:0,top:0};#C=!1;constructor(e,t,r={}){this.#e=e,this.#t=t,this.#o=r,this.#a=t.getContext("2d",{alpha:!0}),this.#e.addEventListener("webglcontextlost",this.#V),this.#e.addEventListener("webglcontextrestored",this.#K),this.#W(),this.#k=new ResizeObserver(()=>{this.requestRender()}),this.#k.observe(e)}get camera(){return{...this.#n}}setState(e){if(this.#C)return;let t=this.#f;this.#f=e;let r=e.resources.scene.value;r!==this.#d&&(this.#d=r,this.#j(r)),(!t||t.quality!==e.quality)&&(this.#I=co(e.quality),this.#E=0);let n=t?.workflow!=="draw"&&e.workflow==="draw",i=t?.workflow==="draw"&&e.workflow!=="draw";(!t||t.view!==e.view||n||i)&&(this.#n=this.#X(e.workflow==="draw"?"top":e.view,e)),e.workflow==="draw"&&t?.draw.zoomPercent!==e.draw.zoomPercent&&(this.#n={...this.#n,orthographic:!0,pitch:Math.PI/2-.018,distance:this.#v*100/e.draw.zoomPercent}),this.requestRender()}#X(e,t){let r=e==="top",n=r?this.#v:this.#y,i=t.cameras[e];return i?{yaw:r?0:i.yaw,pitch:r?Math.PI/2-.018:i.pitch,distance:N(n/N(i.zoom,.01,100),Math.max(.2,this.#h*.04),this.#h*8),targetX:N(i.targetX,-this.#h,this.#h),targetZ:N(i.targetZ,-this.#h,this.#h),orthographic:r}:r?{yaw:0,pitch:Math.PI/2-.018,distance:n,targetX:0,targetZ:0,orthographic:!0}:{yaw:-Math.PI/4,pitch:.82,distance:n,targetX:0,targetZ:0,orthographic:!1}}#U(e,t){let r=this.#r;if(!r)throw new Error("webgl-unavailable");let n=r.createShader(e);if(!n)throw new Error("shader-unavailable");if(r.shaderSource(n,t),r.compileShader(n),!r.getShaderParameter(n,r.COMPILE_STATUS))throw r.deleteShader(n),new Error("shader-failed");return n}#W(){try{this.#r=this.#e.getContext("webgl2",{alpha:!0,antialias:!0,depth:!0,powerPreference:"high-performance"});let e=this.#r;if(!e)throw new Error("webgl2-unavailable");let t=this.#U(e.VERTEX_SHADER,`#version 300 es
        precision highp float;
        precision highp int;
        layout(location = 0) in uvec2 aXY;
        layout(location = 1) in uint aHeight;
        layout(location = 2) in vec3 aColor;
        uniform mat4 uViewProjection;
        uniform vec2 uCenter;
        uniform float uMetersPerCell;
        uniform float uPointPixels;
        uniform float uMaxPointPixels;
        out vec3 vColor;
        void main() {
          vec3 world = vec3(
            -(float(aXY.x) - uCenter.x) * uMetersPerCell,
            float(aHeight) * uMetersPerCell,
            (float(aXY.y) - uCenter.y) * uMetersPerCell
          );
          vec4 clip = uViewProjection * vec4(world, 1.0);
          gl_Position = clip;
          gl_PointSize = clamp(uPointPixels / max(0.18, clip.w), 1.1, uMaxPointPixels);
          vColor = aColor;
        }
      `),r=this.#U(e.FRAGMENT_SHADER,`#version 300 es
        precision highp float;
        in vec3 vColor;
        out vec4 outColor;
        void main() {
          vec2 point = gl_PointCoord * 2.0 - 1.0;
          if (dot(point, point) > 1.0) discard;
          float edge = smoothstep(1.0, 0.72, dot(point, point));
          outColor = vec4(pow(vColor, vec3(0.94)), edge);
        }
      `),n=e.createProgram();if(!n)throw new Error("program-unavailable");if(e.attachShader(n,t),e.attachShader(n,r),e.linkProgram(n),e.deleteShader(t),e.deleteShader(r),!e.getProgramParameter(n,e.LINK_STATUS))throw new Error("program-failed");this.#c=n,this.#b=e.getUniformLocation(n,"uViewProjection"),this.#p=e.getUniformLocation(n,"uCenter"),this.#g=e.getUniformLocation(n,"uMetersPerCell"),this.#m=e.getUniformLocation(n,"uPointPixels"),this.#w=e.getUniformLocation(n,"uMaxPointPixels"),this.#u=e.createBuffer(),this.#s=e.createVertexArray(),e.bindVertexArray(this.#s),e.bindBuffer(e.ARRAY_BUFFER,this.#u),e.enableVertexAttribArray(0),e.vertexAttribIPointer(0,2,e.UNSIGNED_SHORT,8,0),e.enableVertexAttribArray(1),e.vertexAttribIPointer(1,1,e.UNSIGNED_BYTE,8,4),e.enableVertexAttribArray(2),e.vertexAttribPointer(2,3,e.UNSIGNED_BYTE,!0,8,5),e.bindVertexArray(null),e.enable(e.DEPTH_TEST),e.depthFunc(e.LEQUAL),e.enable(e.BLEND),e.blendFunc(e.SRC_ALPHA,e.ONE_MINUS_SRC_ALPHA),this.#P="webgl2",this.#z+=1,this.#d&&this.#H(this.#d)}catch{this.#N(),this.#B()}}#j(e){if(this.#q(),!e){this.#M=0,this.requestRender();return}let[t,r]=e.metadata.span,n=e.metadata.metersPerCell,i=t*n,a=r*n;this.#h=Math.max(1,Math.hypot(i,a)/2),this.#y=this.#h*1.72;let s=this.#T(),l=Math.max(.2,s.width/Math.max(1,s.height));this.#v=Math.max(a/2,i/(2*l))*1.12,this.fit(!1),this.#P==="webgl2"?this.#H(e):this.#F(e)}#H(e){let t=this.#r;if(!t||!this.#u)return;let r=new Uint8Array(e.buffer,e.pointOffset,e.total*8);t.bindBuffer(t.ARRAY_BUFFER,this.#u),t.bufferData(t.ARRAY_BUFFER,r,t.STATIC_DRAW),this.#M=e.total}#B(){this.#P="canvas2d",this.#l=document.createElement("canvas"),this.#l.width=1024,this.#l.height=1024,this.#i=this.#l.getContext("2d",{alpha:!0}),this.#i?this.#d&&this.#F(this.#d):(this.#P="unavailable",this.#o.onProblem?.("renderer-unavailable"))}#F(e){let t=this.#i;if(!t||!this.#l)return;t.clearRect(0,0,this.#l.width,this.#l.height);let r=new DataView(e.buffer,e.pointOffset,e.total*8),n=Math.min(e.total,5e4),i=Math.max(1,Math.ceil(e.total/n)),a=0,s=0,l=()=>{if(this.#C||e!==this.#d||!this.#l)return;let c=Math.min(e.total,a+i*4e3);for(;a<c;a+=i){let d=a*8,u=r.getUint16(d,!0)/Math.max(1,e.metadata.span[0])*this.#l.width,h=r.getUint16(d+2,!0)/Math.max(1,e.metadata.span[1])*this.#l.height,f=r.getUint8(d+5),v=r.getUint8(d+6),$=r.getUint8(d+7);t.fillStyle=`rgb(${f} ${v} ${$})`,t.fillRect(u,h,1.5,1.5),s+=1}this.#M=s,this.requestRender(),a<e.total?this.#x=window.setTimeout(l,0):this.#x=null};l()}#q(){this.#x!==null&&window.clearTimeout(this.#x),this.#x=null}#T(){let e=this.#e.getBoundingClientRect();return this.#A={width:e.width,height:e.height,left:e.left,top:e.top},this.#A}#Y(){let e=this.#T(),t=Math.min(window.devicePixelRatio||1,3),r=Math.max(1,Math.round(e.width*t)),n=Math.max(1,Math.round(e.height*t));for(let i of[this.#e,this.#t])(i.width!==r||i.height!==n)&&(i.width=r,i.height=n)}#Z(){let e=this.#A,t=Math.max(.2,e.width/Math.max(1,e.height)),r=Math.cos(this.#n.pitch)*this.#n.distance,n=[this.#n.targetX+Math.sin(this.#n.yaw)*r,Math.sin(this.#n.pitch)*this.#n.distance,this.#n.targetZ+Math.cos(this.#n.yaw)*r],i=[this.#n.targetX,0,this.#n.targetZ],a=mo(n,i),s=this.#n.orthographic?ho(-this.#n.distance*t,this.#n.distance*t,-this.#n.distance,this.#n.distance,-this.#h*4,this.#h*4):po(Math.PI/3.15,t,.02,Math.max(60,this.#h*12));return uo(s,a)}requestRender(){this.#_!==null||this.#C||(this.#_=window.requestAnimationFrame(()=>{this.#_=null,this.#G()}))}#G(){let e=performance.now();this.#Y(),this.#S=this.#Z(),this.#P==="webgl2"?this.#Q():this.#J(),this.#te(),this.#R=performance.now()-e,this.#R>18?(this.#E+=1,this.#E>=3&&this.#f?.quality==="auto"&&(this.#I=Math.max(.25,this.#I*.75))):this.#E=Math.max(0,this.#E-1)}#Q(){let e=this.#r,t=this.#d;if(!e||(e.viewport(0,0,this.#e.width,this.#e.height),e.clearColor(0,0,0,0),e.clear(e.COLOR_BUFFER_BIT|e.DEPTH_BUFFER_BIT),!t||!this.#c||!this.#s))return;if(this.#f?.view==="top"&&this.#f.appearance==="rooms"){this.#M=0;return}e.useProgram(this.#c),e.bindVertexArray(this.#s),e.uniformMatrix4fv(this.#b,!1,this.#S),e.uniform2f(this.#p,(t.metadata.span[0]-1)/2,(t.metadata.span[1]-1)/2),e.uniform1f(this.#g,t.metadata.metersPerCell);let r=Math.min(window.devicePixelRatio||1,3),n=Math.max(1,Math.floor(t.total*this.#I)),i=Math.min(t.floorCount,n),a=Math.min(t.surfaceCount,Math.max(0,n-i));e.uniform1f(this.#m,this.#e.height*.038),e.uniform1f(this.#w,4.5*r),e.drawArrays(e.POINTS,0,i),e.uniform1f(this.#m,this.#e.height*.05),e.uniform1f(this.#w,7*r),e.drawArrays(e.POINTS,t.floorCount,a),e.bindVertexArray(null),this.#M=i+a}#J(){}#ee(e,t,r=0){let n=this.#d;return n?[-(e-(n.metadata.span[0]-1)/2)*n.metadata.metersPerCell,r*n.metadata.metersPerCell,(t-(n.metadata.span[1]-1)/2)*n.metadata.metersPerCell]:null}#L(e,t,r=0){let n=this.#ee(e,t,r);if(!n)return null;let[i,a,s]=n,l=this.#S,c=(l[0]??0)*i+(l[4]??0)*a+(l[8]??0)*s+(l[12]??0),d=(l[1]??0)*i+(l[5]??0)*a+(l[9]??0)*s+(l[13]??0),u=(l[3]??0)*i+(l[7]??0)*a+(l[11]??0)*s+(l[15]??0);if(u<=.001)return null;let h=c/u,f=d/u;if(Math.abs(h)>1.15||Math.abs(f)>1.15)return null;let v=this.#A;return{x:(h*.5+.5)*v.width,y:(-f*.5+.5)*v.height}}#D(e,t,r=0){let n=this.#d;if(!n)return null;let i=e/n.metadata.metersPerCell-n.metadata.origin[0],a=t/n.metadata.metersPerCell-n.metadata.origin[1];return this.#L(i,a,r)}#te(){let e=this.#a,t=this.#d,r=this.#f;if(!e)return;let n=Math.min(window.devicePixelRatio||1,3),i=this.#A;if(e.setTransform(n,0,0,n,0,0),e.clearRect(0,0,i.width,i.height),!t||!r)return;if(this.#P==="canvas2d"&&this.#l&&!(r.view==="top"&&r.appearance==="rooms")){let c=this.#v/this.#n.distance,d=i.width*c,u=i.height*c,h=(i.width-d)/2-this.#n.targetX*32*c,f=(i.height-u)/2-this.#n.targetZ*32*c;e.drawImage(this.#l,h,f,d,u)}let a=this.#re(r);if(r.labelsVisible||r.view==="top"&&r.appearance==="rooms"){e.lineWidth=1.5,e.font="600 12px system-ui, sans-serif",e.textAlign="center",e.textBaseline="middle";let c=[];for(let d of t.metadata.rooms){let u=a.has(d.name.toLocaleLowerCase());e.strokeStyle=u?"#0678ce":"rgba(75, 92, 105, .7)",e.fillStyle=u?"rgba(6, 120, 206, .26)":r.view==="top"&&r.appearance==="rooms"?"rgba(231, 238, 242, .94)":"rgba(255, 255, 255, .04)",e.beginPath();let h=Math.max(1,Math.ceil(d.boundary.length/512)),f=!1;for(let w=0;w<d.boundary.length;w+=h){let E=d.boundary[w];if(!E)continue;let k=this.#L(E[0],E[1],.2);k&&(f?e.lineTo(k.x,k.y):e.moveTo(k.x,k.y),f=!0)}if(f&&(e.closePath(),e.fill(),e.stroke()),!r.labelsVisible)continue;let v=this.#L(d.center[0],d.center[1],1);if(!v)continue;let $=e.measureText(d.name).width,g=new DOMRect(v.x-$/2-6,v.y-10,$+12,20);c.some(w=>g.left<w.right+8&&g.right+8>w.left&&g.top<w.bottom+4&&g.bottom+4>w.top)||(c.push(g),e.fillStyle="rgba(250, 252, 253, .88)",e.fillRect(g.x,g.y,g.width,g.height),e.fillStyle="#263238",e.fillText(d.name,v.x,v.y))}}let s=r.draw.circles;if((r.workflow==="draw"||r.workflow==="areaReview")&&s.length){e.fillStyle="rgba(6, 120, 206, .22)",e.strokeStyle="rgba(6, 120, 206, .92)",e.lineWidth=1.5;for(let c of s)this.#oe(e,c)}if(this.#$&&r.workflow==="draw"&&r.draw.tool!=="pan"){let c=this.#D(this.#$.x,this.#$.y),d=this.#D(this.#$.x+r.draw.brushMeters/2,this.#$.y);c&&d&&(e.beginPath(),e.arc(c.x,c.y,Math.max(2,Math.hypot(d.x-c.x,d.y-c.y)),0,Math.PI*2),e.strokeStyle="#0678ce",e.lineWidth=2,e.stroke())}let l=r.resources.pose.value;if(r.map.exactPose&&l?.position&&r.dataMode==="live"){let c=this.#L(l.position[0],l.position[1],3);c&&(e.beginPath(),e.arc(c.x,c.y,7,0,Math.PI*2),e.fillStyle="#0678ce",e.fill(),e.strokeStyle="#fff",e.lineWidth=3,e.stroke())}}#re(e){let t=e.resources.plans.value?.rooms||e.resources.areas.value?.rooms||[];return new Set(t.filter(r=>e.selection.roomIds.includes(r.roomId)).map(r=>r.name.toLocaleLowerCase()))}#oe(e,t){let r=this.#D(t.x,t.y),n=this.#D(t.x+t.radius,t.y);!r||!n||(e.beginPath(),e.arc(r.x,r.y,Math.max(1,Math.hypot(n.x-r.x,n.y-r.y)),0,Math.PI*2),e.fill(),e.stroke())}setCursor(e){this.#$=e,this.requestRender()}screenToMap(e,t){let r=this.#d;if(!r||!this.#n.orthographic)return null;let n=this.#T();if(!n.width||!n.height)return null;let i=this.#n.distance*2/n.height,a=this.#n.targetX+(e-n.left-n.width/2)*i,s=this.#n.targetZ+(t-n.top-n.height/2)*i,l=-a/r.metadata.metersPerCell+(r.metadata.span[0]-1)/2,c=s/r.metadata.metersPerCell+(r.metadata.span[1]-1)/2;return{x:(l+r.metadata.origin[0])*r.metadata.metersPerCell,y:(c+r.metadata.origin[1])*r.metadata.metersPerCell}}roomAt(e,t){let r=this.screenToMap(e,t),n=this.#d,i=this.#f;if(!r||!n||!i)return null;let a=r.x/n.metadata.metersPerCell-n.metadata.origin[0],s=r.y/n.metadata.metersPerCell-n.metadata.origin[1],l=n.metadata.rooms.find(c=>dr(a,s,c.boundary));return l?this.#ne(l,i):null}containsMapPoint(e){let t=this.#d;if(!t)return!1;let r=e.x/t.metadata.metersPerCell-t.metadata.origin[0],n=e.y/t.metadata.metersPerCell-t.metadata.origin[1];return t.metadata.rooms.some(i=>dr(r,n,i.boundary))}#ne(e,t){return(t.resources.plans.value?.rooms||t.resources.areas.value?.rooms||[]).find(n=>n.name.localeCompare(e.name,void 0,{sensitivity:"base"})===0)?.roomId||e.id}selectRoomAt(e,t){let r=this.roomAt(e,t);r&&this.#o.onRoom?.(r)}fit(e=!0){let t=this.#f?.view==="top"||this.#f?.workflow==="draw";this.#n=t?{yaw:0,pitch:Math.PI/2-.018,distance:this.#v,targetX:0,targetZ:0,orthographic:!0}:{yaw:-Math.PI/4,pitch:.82,distance:this.#y,targetX:0,targetZ:0,orthographic:!1},this.requestRender(),e&&this.#O()}zoomAt(e,t,r){let n=t===void 0||r===void 0?null:this.screenToMap(t,r);if(this.#n={...this.#n,distance:N(this.#n.distance/e,Math.max(.2,this.#h*.04),this.#h*8)},n&&t!==void 0&&r!==void 0){let i=this.screenToMap(t,r);i&&(this.#n={...this.#n,targetX:this.#n.targetX-(n.x-i.x),targetZ:this.#n.targetZ+(n.y-i.y)})}this.requestRender(),this.#O(t,r)}panBy(e,t){let r=this.#A,n=this.#n.distance*2/Math.max(1,r.height),i=Math.cos(this.#n.yaw),a=-Math.sin(this.#n.yaw),s=-Math.sin(this.#n.yaw),l=-Math.cos(this.#n.yaw);this.#n={...this.#n,targetX:N(this.#n.targetX-e*n*i+t*n*s,-this.#h,this.#h),targetZ:N(this.#n.targetZ-e*n*a+t*n*l,-this.#h,this.#h)},this.requestRender(),this.#O()}orbitBy(e,t){if(this.#n.orthographic){this.panBy(e,t);return}this.#n={...this.#n,yaw:lo(this.#n.yaw+e*.006),pitch:N(this.#n.pitch-t*.004,.18,1.38)},this.requestRender(),this.#O()}#O(e,t){let r=this.#n.orthographic?this.#v:this.#y,n=e===void 0||t===void 0?this.#A:this.#T(),i=e===void 0||t===void 0||!n.width||!n.height?void 0:{xPercent:N((e-n.left)/n.width*100,0,100),yPercent:N((t-n.top)/n.height*100,0,100)};this.#o.onCamera?.(this.camera,Math.round(r/this.#n.distance*100),i)}diagnostics(){return{mode:this.#P,contextGeneration:this.#z,sceneRevision:this.#d?.revision??null,sourcePoints:this.#d?.total??0,renderedPoints:this.#M,lastFrameMs:Math.round(this.#R*100)/100,slowFrames:this.#E}}#V=e=>{e.preventDefault(),this.#N(),this.#B(),this.requestRender()};#K=()=>{this.#N(),this.#W(),this.requestRender()};#N(){let e=this.#r;e&&(this.#u&&e.deleteBuffer(this.#u),this.#s&&e.deleteVertexArray(this.#s),this.#c&&e.deleteProgram(this.#c)),this.#u=null,this.#s=null,this.#c=null,this.#r=null}dispose(){this.#C||(this.#C=!0,this.#k.disconnect(),this.#e.removeEventListener("webglcontextlost",this.#V),this.#e.removeEventListener("webglcontextrestored",this.#K),this.#_!==null&&window.cancelAnimationFrame(this.#_),this.#_=null,this.#q(),this.#N(),this.#l=null,this.#i=null,this.#a=null,this.#d=null,this.#f=null)}};var ur="component.matic_robot.common.",P=(o,e,t,r)=>{let n=r?{...r}:void 0,i=o?.(`${ur}${e}`,n);return i&&i!==`${ur}${e}`?i:r?Object.entries(r).reduce((a,[s,l])=>a.replaceAll(`{${s}}`,String(l)),t):t};var ee="matic-workspace-intent",De="matic-workspace-action",pr=(o,e)=>{let t=(n,i,a)=>P(e,n,i,a);if(!ie(o))return t("v4_private_map_unavailable","The current private map is not available.");if(o.dataMode==="history")return t("v4_saved_map_description","Saved read-only map for {floor}. Live robot position is hidden.",{floor:o.floor.displayName});let r=Tt(o)?t("v4_robot_position_verified","The robot position is verified."):t("v4_robot_position_hidden","The robot position is not shown.");return t("v4_live_map_description","Live map for {floor}. {pose}",{floor:o.floor.displayName,pose:r})},yt=class extends x{constructor(){super(...arguments);this.state=M();this.#e=null;this.#t=null;this.#o=null}static{this.properties={state:{attribute:!1},localize:{attribute:!1}}}static{this.styles=D`
    :host {
      display: block;
      min-width: 0;
      min-height: 0;
      block-size: 100%;
      color: var(--primary-text-color, #1f2933);
    }

    * { box-sizing: border-box; }

    button, input { font: inherit; }

    .map-root {
      position: relative;
      overflow: hidden;
      min-block-size: 22rem;
      block-size: 100%;
      outline: none;
      isolation: isolate;
      background:
        radial-gradient(circle at 52% 45%, rgb(255 255 255 / 92%), transparent 42%),
        var(--secondary-background-color, #edf2f4);
      touch-action: none;
      container-type: inline-size;
    }

    .map-root:focus-visible {
      outline: 3px solid var(--primary-color, #03a9f4);
      outline-offset: -3px;
    }

    .floor-chip,
    .map-tools,
    .view-switch,
    .appearance-switch,
    .camera-steps,
    .draw-tools,
    .map-scale,
    .map-message {
      position: absolute;
      z-index: 4;
      border: 1px solid var(--divider-color, rgb(60 75 85 / 16%));
      background: var(--card-background-color, rgb(255 255 255 / 96%));
      box-shadow: 0 5px 18px rgb(31 41 51 / 12%);
    }

    .floor-chip {
      inset-block-start: 0.75rem;
      inset-inline-start: 0.75rem;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      max-inline-size: min(15rem, calc(100% - 11rem));
      min-block-size: 2.75rem;
      padding-inline: 0.8rem;
      border-radius: 1.5rem;
      color: var(--primary-text-color, #1f2933);
      font-size: 0.82rem;
      font-weight: 650;
    }

    .floor-chip span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .floor-chip small {
      color: var(--secondary-text-color, #687984);
      font-weight: 500;
      white-space: nowrap;
    }

    .map-tools {
      inset-block-start: 0.75rem;
      inset-inline-end: 0.75rem;
      display: flex;
      gap: 0.2rem;
      padding: 0.2rem;
      border-radius: 0.85rem;
    }

    .map-tools button,
    .view-switch button,
    .appearance-switch button,
    .camera-steps button,
    .draw-tools button {
      border: 0;
      color: inherit;
      background: transparent;
      cursor: pointer;
    }

    .map-tools button {
      min-inline-size: 2.75rem;
      min-block-size: 2.75rem;
      padding-inline: 0.55rem;
      border-radius: 0.65rem;
      font-size: 0.78rem;
      font-weight: 650;
    }

    .map-tools button[aria-pressed="true"],
    .view-switch button[aria-pressed="true"],
    .appearance-switch button[aria-pressed="true"],
    .draw-tools button[aria-checked="true"] {
      color: var(--primary-color, #0678ce);
      background: color-mix(in srgb, var(--primary-color, #0678ce) 11%, transparent);
    }

    .view-switch {
      inset-block-start: 4.25rem;
      inset-inline-end: 0.75rem;
      display: grid;
      grid-template-columns: 1fr 1fr;
      padding: 0.18rem;
      border-radius: 0.75rem;
    }

    .appearance-switch,
    .camera-steps {
      position: absolute;
      z-index: 4;
      inset-block-start: 7.2rem;
      inset-inline-end: 0.75rem;
      display: grid;
      padding: 0.18rem;
      border: 1px solid var(--divider-color, rgb(60 75 85 / 16%));
      border-radius: 0.75rem;
      background: var(--card-background-color, rgb(255 255 255 / 96%));
      box-shadow: 0 5px 18px rgb(31 41 51 / 12%);
    }

    .appearance-switch { grid-template-columns: 1fr 1fr; }
    .camera-steps { grid-template-columns: repeat(2, 2.75rem); }

    .appearance-switch button,
    .camera-steps button {
      min-inline-size: 2.75rem;
      min-block-size: 2.75rem;
      border: 0;
      border-radius: 0.58rem;
      color: inherit;
      background: transparent;
      cursor: pointer;
      font-size: 0.76rem;
      font-weight: 700;
    }

    .view-switch button {
      min-inline-size: 2.75rem;
      min-block-size: 2.25rem;
      border-radius: 0.58rem;
      font-size: 0.76rem;
      font-weight: 700;
    }

    .scene-window {
      position: absolute;
      inset: 0;
      inset-block-end: var(--map-sheet-offset, 0px);
      overflow: hidden;
    }

    .scene-window[hidden] { display: none; }

    .scene-canvas,
    .overlay-canvas {
      position: absolute;
      inset: 0;
      inline-size: 100%;
      block-size: 100%;
    }

    .scene-canvas { z-index: 0; }
    .overlay-canvas { z-index: 1; pointer-events: none; }

    .scene-geometry {
      position: absolute;
      inset: 12% 8% 17%;
      transform: scale(var(--map-zoom));
      transform-origin: var(--map-origin-x) var(--map-origin-y);
      transition: transform 120ms ease-out;
    }

    .scene-geometry svg { inline-size: 100%; block-size: 100%; overflow: visible; }
    .room { stroke: var(--divider-color, #b5c1c8); stroke-width: 1.5; }
    .room:nth-child(1) { fill: #dceef2; }
    .room:nth-child(2) { fill: #e4eaf5; }
    .room:nth-child(3) { fill: #e9f0df; }
    .room:nth-child(4) { fill: #f3e5e5; }

    .area-stroke {
      fill: none;
      stroke: var(--primary-color, #0678ce);
      stroke-width: 2.4;
      stroke-linecap: round;
      stroke-linejoin: round;
      opacity: 0.82;
    }

    .room-labels {
      position: absolute;
      inset: 0;
      z-index: 2;
      pointer-events: none;
    }

    .room-label {
      position: absolute;
      translate: -50% -50%;
      padding: 0.25rem 0.45rem;
      border-radius: 0.4rem;
      color: var(--primary-text-color, #263238);
      background: color-mix(in srgb, var(--card-background-color, white) 90%, transparent);
      box-shadow: 0 2px 8px rgb(31 41 51 / 11%);
      font-size: 0.72rem;
      font-weight: 650;
      white-space: nowrap;
    }

    .room-label:nth-child(1) { inset-inline-start: 31%; inset-block-start: 36%; }
    .room-label:nth-child(2) { inset-inline-start: 69%; inset-block-start: 39%; }
    .room-label:nth-child(3) { inset-inline-start: 36%; inset-block-start: 68%; }
    .room-label:nth-child(4) { inset-inline-start: 68%; inset-block-start: 68%; }

    .robot {
      position: absolute;
      z-index: 3;
      inset-inline-start: 53%;
      inset-block-start: 52%;
      inline-size: 1.15rem;
      block-size: 1.15rem;
      translate: -50% -50%;
      border: 3px solid white;
      border-radius: 50%;
      background: var(--primary-color, #0678ce);
      box-shadow: 0 2px 9px rgb(6 120 206 / 35%);
    }

    .brush-cursor {
      position: absolute;
      z-index: 3;
      inset-inline-start: 52%;
      inset-block-start: 49%;
      inline-size: var(--brush-size);
      block-size: var(--brush-size);
      translate: -50% -50%;
      border: 2px solid var(--primary-color, #0678ce);
      border-radius: 50%;
      background: color-mix(in srgb, var(--primary-color, #0678ce) 15%, transparent);
      pointer-events: none;
    }

    .map-scale {
      inset-inline-start: 0.9rem;
      inset-block-end: calc(5.2rem + var(--map-sheet-offset, 0px));
      display: grid;
      justify-items: start;
      gap: 0.25rem;
      border: 0;
      background: transparent;
      box-shadow: none;
      color: var(--secondary-text-color, #53636d);
      font-size: 0.7rem;
      font-weight: 650;
    }

    .scale-line {
      inline-size: var(--scale-width);
      block-size: 0.42rem;
      border-inline: 2px solid currentColor;
      border-block-end: 2px solid currentColor;
    }

    .draw-tools {
      inset-inline-start: 50%;
      inset-block-end: calc(0.75rem + var(--map-sheet-offset, 0px));
      translate: -50% 0;
      display: grid;
      grid-template-columns: repeat(6, minmax(2.75rem, auto));
      gap: 0.15rem;
      max-inline-size: calc(100% - 1rem);
      padding: 0.2rem;
      border-radius: 0.9rem;
    }

    .draw-tools button {
      min-inline-size: 2.75rem;
      min-block-size: 2.75rem;
      padding-inline: 0.5rem;
      border-radius: 0.65rem;
      font-size: 0.73rem;
      font-weight: 650;
      white-space: nowrap;
    }

    .draw-tools button:disabled { opacity: 0.42; cursor: default; }

    .map-root[data-full-map="true"] .draw-tools { inset-block-end: 5.75rem; }
    .map-root[data-full-map="true"] .map-scale { inset-block-end: 10rem; }

    .map-message {
      inset: 50% auto auto 50%;
      translate: -50% -50%;
      inline-size: min(22rem, calc(100% - 2rem));
      padding: 1rem 1.1rem;
      border-radius: 0.9rem;
      text-align: center;
    }

    .map-message strong { display: block; margin-block-end: 0.35rem; }
    .map-message span { color: var(--secondary-text-color, #687984); font-size: 0.82rem; }

    .sr-only {
      position: absolute;
      overflow: hidden;
      inline-size: 1px;
      block-size: 1px;
      margin: -1px;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }

    @container (max-width: 29rem) {
      .map-tools .labels { display: none; }
      .map-tools button { padding-inline: 0.35rem; }
      .draw-tools { grid-template-columns: repeat(6, 2.75rem); }
      .draw-tools button { padding: 0; font-size: 0; }
      .draw-tools button::first-letter { font-size: 1rem; }
      .floor-chip { max-inline-size: calc(100% - 9.5rem); }
    }

    @media (prefers-reduced-motion: reduce) {
      .scene-geometry { transition: none; }
    }

    @media (forced-colors: active) {
      .room, .area-stroke, .brush-cursor, .robot { forced-color-adjust: none; }
      .room { fill: Canvas; stroke: CanvasText; }
      .area-stroke, .brush-cursor { stroke: Highlight; }
      .robot { background: Highlight; border-color: Canvas; }
    }
  `}#e;#t;#o;#r(t,r,n){return P(this.localize,t,r,n)}firstUpdated(){let t=this.renderRoot.querySelector(".map-root"),r=this.renderRoot.querySelector(".scene-canvas"),n=this.renderRoot.querySelector(".overlay-canvas");!t||!r||!n||(this.#t=new Le(r,n,{onCamera:(i,a,s)=>{this.#a({type:"set-camera",view:this.state.workflow==="draw"?"top":this.state.view,camera:{yaw:i.yaw,pitch:i.pitch,zoom:a/100,targetX:i.targetX,targetZ:i.targetZ}}),this.state.workflow==="draw"&&a!==this.state.draw.zoomPercent&&this.#a({type:"set-zoom",value:a,...s?{originX:s.xPercent,originY:s.yPercent}:{}})},onRoom:i=>this.#a({type:"toggle-room",roomId:i}),onProblem:()=>this.#i("renderer-problem")}),this.#o=new Te(t,this.#t,{state:()=>this.state,onCircles:(i,a,s)=>this.#a({type:"set-draft-circles",circles:i,record:a,...s?{previous:s}:{}}),onRoom:i=>this.#a({type:"toggle-room",roomId:i})}),this.#t.setState(this.state))}disconnectedCallback(){this.#o?.dispose(),this.#o=null,this.#t?.dispose(),this.#t=null,super.disconnectedCallback()}updated(t){if(!t.has("state"))return;t.get("state")?.fullMap&&!this.state.fullMap&&this.#e&&this.#e.focus(),this.#t?.setState(this.state)}#a(t){this.dispatchEvent(new CustomEvent(ee,{detail:t,bubbles:!0,composed:!0}))}#i(t){this.dispatchEvent(new CustomEvent(De,{detail:{id:t},bubbles:!0,composed:!0}))}#l(t){this.#e=t.currentTarget,this.#a({type:this.state.fullMap?"exit-full-map":"enter-full-map"})}#c(t,r){this.#t?.orbitBy(t,r)}#u(t){if(!(t.ctrlKey||t.metaKey||t.altKey)&&t.key==="Escape"){t.preventDefault(),this.#a({type:"dismiss-top-layer"});return}}rendererDiagnostics(){return this.#t?.diagnostics()??null}canvasIdentity(){return{scene:this.renderRoot.querySelector(".scene-canvas"),overlay:this.renderRoot.querySelector(".overlay-canvas")}}#s(){return this.state.host.connected?this.state.host.administrator?this.state.host.robotCount===0?{title:this.#r("v4_no_robot","No Matic robot set up"),detail:this.#r("v4_no_robot_detail","Set up a robot before opening its map.")}:this.state.host.robotConnected?this.state.coherence==="verifying"||this.state.coherence==="booting"?{title:this.#r("v4_locating_map","Locating the current map"),detail:this.#r("v4_locating_map_detail","Map controls will return after the floor is verified.")}:!this.state.map.available&&this.state.resources.scene.status==="loading"?{title:this.#r("v4_loading_verified_map","Loading the verified map"),detail:this.#r("v4_loading_verified_map_detail","The current floor is verified. The private scene is still preparing.")}:this.state.map.available?this.state.activity==="problem"?{title:this.#r("v4_robot_attention","Robot needs attention"),detail:this.#r("v4_robot_attention_detail","Check the robot before starting another task.")}:null:{title:this.#r("v4_map_unavailable","Map unavailable"),detail:this.#r("v4_map_unavailable_detail","The private scene is not ready. No map data is shown until it is verified.")}:{title:this.#r("v4_robot_offline","Robot offline"),detail:this.#r("v4_robot_offline_detail","The last verified map stays read only and has no live position.")}:{title:this.#r("v4_admin_required","Administrator access required"),detail:this.#r("v4_private_map_hidden","Private map data is hidden.")}:{title:this.#r("v4_reconnecting","Reconnecting"),detail:this.#r("v4_reconnecting_detail","The verified map is read only until Home Assistant reconnects.")}}render(){let t=this.state,r=Ot(t),n=this.#s(),i=t.map.available&&(ie(t)||t.dataMode==="history"),a=t.workflow==="draw"&&i,s=t.coherence==="verifying"||t.coherence==="booting";return p`
      <section
        class="map-root"
        tabindex="0"
        role="application"
        aria-label=${pr(t,this.localize)}
        data-full-map=${String(t.fullMap)}
        data-workflow=${t.workflow}
        @keydown=${this.#u}
      >
        ${t.floor.classifiedCount>1?p`
          <button
            class="floor-chip"
            type="button"
            aria-label=${`${this.#r("v4_choose_floor","Choose floor")}: ${t.floor.displayName}`}
            @click=${()=>this.#a({type:"open-workflow",workflow:"history"})}
          >
            <span>${t.floor.displayName}</span>
            ${t.floor.readOnly?p`<small>${this.#r("v4_saved_read_only","Saved \xB7 read only")}</small>`:m}
          </button>
        `:m}

        ${!s||t.fullMap?p`<nav class="map-tools" aria-label="Map tools">
          ${s?m:p`
            <button type="button" @click=${()=>{this.#t?.fit(),this.#a({type:"fit-map"})}}>${this.#r("map_home_view","Fit")}</button>
            <button
              class="labels"
              type="button"
              aria-pressed=${String(t.labelsVisible)}
              @click=${()=>this.#a({type:"toggle-labels"})}
            >${this.#r("map_labels","Labels")}</button>
          `}
          <button
            class="full-map"
            type="button"
            aria-label=${this.#r("v4_full_map","Full map")}
            aria-pressed=${String(t.fullMap)}
            @click=${this.#l}
          >${t.fullMap?this.#r("v4_close","Close"):this.#r("v4_full_map","Full map")}</button>
        </nav>`:m}

        ${t.workflow!=="draw"&&i?p`
          <div class="view-switch" aria-label="Map view">
            <button
              type="button"
              aria-pressed=${String(t.view==="three")}
              @click=${()=>this.#a({type:"set-view",view:"three"})}
            >${this.#r("map_view_3d","3D")}</button>
            <button
              type="button"
              aria-pressed=${String(t.view==="top")}
              @click=${()=>this.#a({type:"set-view",view:"top"})}
            >${this.#r("map_view_top","2D")}</button>
          </div>
        `:m}

        ${t.view==="top"&&i?p`
          <div class="appearance-switch" aria-label=${this.#r("map_style_label","2D map style")}>
            <button
              type="button"
              aria-pressed=${String(t.appearance==="photo")}
              @click=${()=>this.#a({type:"set-appearance",appearance:"photo"})}
            >${this.#r("map_style_photo","Photo")}</button>
            <button
              type="button"
              aria-pressed=${String(t.appearance==="rooms")}
              @click=${()=>this.#a({type:"set-appearance",appearance:"rooms"})}
            >${this.#r("map_view_rooms","Rooms")}</button>
          </div>
        `:m}

        ${t.view==="three"&&i?p`
          <div class="camera-steps" role="toolbar" aria-label=${this.#r("map_camera_controls","Map camera controls")}>
            <button type="button" aria-label=${this.#r("map_rotate_left","Rotate left")} aria-keyshortcuts="[" @click=${()=>this.#c(-52,0)}>↶</button>
            <button type="button" aria-label=${this.#r("map_tilt_down","Lower viewing angle")} aria-keyshortcuts="PageDown" @click=${()=>this.#c(0,30)}>⌄</button>
            <button type="button" aria-label=${this.#r("map_tilt_up","Raise viewing angle")} aria-keyshortcuts="PageUp" @click=${()=>this.#c(0,-30)}>⌃</button>
            <button type="button" aria-label=${this.#r("map_rotate_right","Rotate right")} aria-keyshortcuts="]" @click=${()=>this.#c(52,0)}>↷</button>
          </div>
        `:m}

        <div
          class="scene-window"
          data-renderer-key="persistent-canvas-v4"
          ?hidden=${!i}
          aria-hidden="true"
        >
          <canvas class="scene-canvas"></canvas>
          <canvas class="overlay-canvas"></canvas>
        </div>

        ${a?p`
          <div class="map-scale" aria-label=${`Scale ${r.label}`}>
            <span class="scale-line" style=${`--scale-width:${r.pixels}px`}></span>
            <span>${r.label}</span>
          </div>
          <div class="draw-tools" role="toolbar" aria-label="Draw area tools">
            ${["paint","erase","pan"].map(l=>p`
              <button
                type="button"
                role="radio"
                aria-checked=${String(t.draw.tool===l)}
                data-tool=${l}
                @click=${()=>this.#a({type:"set-draw-tool",tool:l})}
              >${l==="paint"?`\u270E ${this.#r("area_paint","Paint")}`:l==="erase"?`\u232B ${this.#r("area_erase","Erase")}`:`\u2725 ${this.#r("move_map","Move map")}`}</button>
            `)}
            <button
              type="button"
              ?disabled=${t.draw.strokeCount===0}
              @click=${()=>this.#a({type:"undo-draft"})}
            >↶ ${this.#r("undo","Undo")}</button>
            <button
              type="button"
              ?disabled=${t.draw.redo.length===0}
              @click=${()=>this.#a({type:"redo-draft"})}
            >↷ ${this.#r("redo","Redo")}</button>
            <button type="button" @click=${()=>this.#i("review-area")}>✓ ${this.#r("done_editing","Done editing")}</button>
          </div>
        `:m}

        ${n&&!(t.fullMap&&(s||!t.host.administrator))?p`
          <div class="map-message" role="status">
            <strong>${n.title}</strong>
            <span>${n.detail}</span>
          </div>
        `:m}
        <div class="sr-only" aria-live="polite" aria-atomic="true">
          ${pr(t,this.localize)}
        </div>
      </section>
    `}};customElements.get("matic-map-canvas-v4")||customElements.define("matic-map-canvas-v4",yt);var bt=class extends x{constructor(){super(...arguments);this.state=M();this.compact=!1}static{this.properties={state:{attribute:!1},localize:{attribute:!1},compact:{type:Boolean,reflect:!0}}}static{this.styles=D`
    :host { display: block; color: var(--primary-text-color, #1f2933); }
    * { box-sizing: border-box; }
    button, input { font: inherit; }

    .controls {
      display: grid;
      gap: 0.8rem;
      padding: 0.9rem;
      border: 1px solid var(--divider-color, rgb(60 75 85 / 16%));
      border-radius: 0.85rem;
      background: var(--card-background-color, #fff);
    }

    .row { display: grid; gap: 0.42rem; }
    label { color: var(--secondary-text-color, #687984); font-size: 0.75rem; font-weight: 650; }

    .stepper {
      display: grid;
      grid-template-columns: 2.75rem minmax(0, 1fr) 2.75rem;
      gap: 0.35rem;
      align-items: stretch;
    }

    button, .number {
      min-block-size: 2.75rem;
      border: 1px solid var(--divider-color, rgb(60 75 85 / 20%));
      border-radius: 0.65rem;
      color: inherit;
      background: var(--secondary-background-color, #f3f6f7);
    }

    button { cursor: pointer; font-weight: 700; }
    button:hover { background: color-mix(in srgb, var(--primary-color, #0678ce) 9%, transparent); }

    .number {
      display: flex;
      align-items: center;
      min-inline-size: 0;
      padding-inline: 0.6rem;
      background: var(--card-background-color, #fff);
    }

    input {
      min-inline-size: 0;
      inline-size: 100%;
      border: 0;
      outline: 0;
      color: inherit;
      background: transparent;
      text-align: end;
      font-variant-numeric: tabular-nums;
    }

    .unit { margin-inline-start: 0.25rem; color: var(--secondary-text-color, #687984); font-size: 0.75rem; }
    .hint { margin: 0; color: var(--secondary-text-color, #687984); font-size: 0.72rem; line-height: 1.45; }

    :host([compact]) .controls {
      position: absolute;
      z-index: 8;
      inset-block-start: calc(100% + 0.4rem);
      inset-inline-end: 0;
      inline-size: min(18rem, calc(100vw - 1.5rem));
      box-shadow: 0 12px 32px rgb(31 41 51 / 20%);
    }

    @media (forced-colors: active) {
      button, .number, .controls { border-color: CanvasText; }
    }
  `}#e(t,r){return P(this.localize,t,r)}#t(t){this.dispatchEvent(new CustomEvent(ee,{detail:t,bubbles:!0,composed:!0}))}#o(t,r){let n=t.currentTarget.valueAsNumber;Number.isFinite(n)&&this.#t(r==="zoom"?{type:"set-zoom",value:n}:{type:"set-brush",value:n})}render(){let{draw:t}=this.state;return p`
      <div class="controls" aria-label=${this.#e("v4_drawing_precision","Drawing precision")}>
        <div class="row">
          <label for="zoom">${this.#e("v4_map_zoom","Map zoom")}</label>
          <div class="stepper">
            <button
              type="button"
              aria-label=${this.#e("zoom_out","Zoom out")}
              @click=${()=>this.#t({type:"step-zoom",factor:.8})}
            >−</button>
            <span class="number">
              <input
                id="zoom"
                inputmode="numeric"
                type="number"
                min=${100}
                max=${1e3}
                step="1"
                .value=${String(t.zoomPercent)}
                @change=${r=>this.#o(r,"zoom")}
                aria-label=${this.#e("v4_map_zoom_percent","Map zoom percent")}
              />
              <span class="unit">%</span>
            </span>
            <button
              type="button"
              aria-label=${this.#e("zoom_in","Zoom in")}
              @click=${()=>this.#t({type:"step-zoom",factor:1.25})}
            >+</button>
          </div>
        </div>

        <div class="row">
          <label for="brush">${this.#e("brush_size","Brush width")}</label>
          <div class="stepper">
            <button
              type="button"
              aria-label=${this.#e("v4_narrower_brush","Narrower brush")}
              @click=${()=>this.#t({type:"set-brush",value:t.brushMeters/1.25})}
            >−</button>
            <span class="number">
              <input
                id="brush"
                inputmode="decimal"
                type="number"
                min=${.2}
                max=${2.5}
                step="0.01"
                .value=${t.brushMeters.toFixed(2)}
                @change=${r=>this.#o(r,"brush")}
                aria-label=${this.#e("v4_brush_width_meters","Brush width in meters")}
              />
              <span class="unit">m</span>
            </span>
            <button
              type="button"
              aria-label=${this.#e("v4_wider_brush","Wider brush")}
              @click=${()=>this.#t({type:"set-brush",value:t.brushMeters*1.25})}
            >+</button>
          </div>
        </div>
        <p class="hint">${this.#e("v4_precision_hint","Strokes follow the verified map resolution. Zoom changes the view, not the saved outline.")}</p>
      </div>
    `}};customElements.get("matic-precision-controls-v4")||customElements.define("matic-precision-controls-v4",bt);var vt=["vacuum","mop","vacuum_and_mop"],gt=["quick","standard","heavy_duty"],z=o=>o.currentTarget.value,wt=o=>o.currentTarget.checked,_t=class extends x{constructor(){super(...arguments);this.state=M()}static{this.properties={state:{attribute:!1},localize:{attribute:!1}}}static{this.styles=D`
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
    .floor small, .snapshot small, .list-button small { margin-inline-start: auto; color: var(--primary-text-color, #263238); font-weight: 500; }
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
  `}#e(t,r,n){return P(this.localize,t,r,n)}#t(t){return t==="vacuum"?this.#e("vacuum","Vacuum"):t==="mop"?this.#e("mop","Mop"):this.#e("vacuum_and_mop","Vacuum + mop")}#o(t){return t==="quick"?this.#e("quick","Quick"):t==="standard"?this.#e("standard","Optimal"):this.#e("heavy_duty","Heavy Duty")}#r(t){this.dispatchEvent(new CustomEvent(ee,{detail:t,bubbles:!0,composed:!0}))}#a(){return this.state.notice?p`
      <div class="notice" data-tone=${this.state.notice.tone} role=${this.state.notice.tone==="error"?"alert":"status"}>
        ${this.state.notice.text}
      </div>
    `:m}#i(t,r,n){return t==="loading"||t==="idle"?p`<div class="loading" role="status">${this.#e("map_loading","Loading\u2026")}</div>`:t==="error"?p`<div class="problem" role="alert">${this.#e("v4_workspace_unavailable","This workspace is unavailable right now.")} ${r==="request-failed"?this.#e("v4_try_again","Try again shortly."):this.#e("v4_return_live_retry","Return to the live map and retry.")}</div>`:t==="empty"?p`<div class="empty">${this.#e("v4_nothing_saved","Nothing saved yet.")}</div>`:n}#l(){let t=this.state.resources.plans;return this.#i(t.status,t.problem,p`
      <div class="stack">
        <div class="list" role="group" aria-label=${this.#e("v4_rooms_to_clean","Rooms to clean")}>
          ${(t.value?.rooms||[]).map(r=>{let n=this.state.selection.roomIds.includes(r.roomId);return p`
              <label class="room">
                <input
                  type="checkbox"
                  .checked=${n}
                  @change=${()=>this.#r({type:"toggle-room",roomId:r.roomId})}
                >
                <span>${r.name}</span>
              </label>
            `})}
        </div>
        <div class="split">
          <label class="field">${this.#e("v4_cleaning_system","Cleaning system")}
            <select
              .value=${this.state.selection.cleaningMode}
              @change=${r=>this.#r({type:"patch-room-settings",cleaningMode:z(r)})}
            >${vt.map(r=>p`<option value=${r}>${this.#t(r)}</option>`)}</select>
          </label>
          <label class="field">${this.#e("cleaning_mode","Cleaning mode")}
            <select
              .value=${this.state.selection.coverageSetting}
              @change=${r=>this.#r({type:"patch-room-settings",coverageSetting:z(r)})}
            >${gt.map(r=>p`<option value=${r}>${this.#o(r)}</option>`)}</select>
          </label>
        </div>
        <p class="subtle">${this.#e("v4_room_selection_hint","Select rooms here or directly on the map. The map and list stay in sync.")}</p>
        ${this.#a()}
      </div>
    `)}#c(t){let r=this.state.planDraft.rooms,i=r.find(a=>a.roomId===t)?r.filter(a=>a.roomId!==t):[...r,{roomId:t,cleaningMode:"vacuum",coverageSetting:"standard"}];this.#r({type:"patch-plan-draft",patch:{rooms:i}})}#u(t,r){let n=this.state.planDraft.rooms.map((i,a)=>a===t?{...i,...r}:i);this.#r({type:"patch-plan-draft",patch:{rooms:n}})}#s(t,r){let n=t+r,i=[...this.state.planDraft.rooms];if(n<0||n>=i.length)return;let[a]=i.splice(t,1);a&&(i.splice(n,0,a),this.#r({type:"patch-plan-draft",patch:{rooms:i}}))}#b(){let t=this.state.resources.plans,r=t.value,n=this.state.planDraft;return this.#i(t.status,t.problem,p`
      <div class="stack">
        <div class="split">
          <label class="field">${this.#e("v4_saved_plan","Saved plan")}
            <select
              .value=${this.state.selection.planId||""}
              @change=${i=>this.#r({type:"select-plan",planId:z(i)||null})}
            >
              <option value="">${this.#e("plan_new","New plan")}</option>
              ${(r?.plans||[]).map(i=>p`<option value=${i.id}>${i.name}</option>`)}
            </select>
          </label>
          <button class="list-button" type="button" @click=${()=>this.#r({type:"select-plan",planId:null})}>＋ ${this.#e("plan_new","New plan")}</button>
        </div>
        <label class="field">${this.#e("plan_name","Plan name")}
          <input
            maxlength="128"
            autocomplete="off"
            .value=${n.name}
            @input=${i=>this.#r({type:"patch-plan-draft",patch:{name:z(i)}})}
          >
        </label>
        <div class="split">
          <label class="field">${this.#e("plan_run_behavior","Run order")}
            <select
              .value=${n.runBehavior}
              @change=${i=>this.#r({type:"patch-plan-draft",patch:{runBehavior:z(i)==="ordered"?"ordered":"intelligent"}})}
            >
              <option value="intelligent">${this.#e("plan_intelligent","Smart rotation")}</option>
              <option value="ordered">${this.#e("plan_ordered","Listed order")}</option>
            </select>
          </label>
          <label class="checkbox"><input type="checkbox" .checked=${n.enabled} @change=${i=>this.#r({type:"patch-plan-draft",patch:{enabled:wt(i)}})}>${this.#e("plan_enabled","Enabled")}</label>
        </div>
        <div class="list" aria-label=${this.#e("plan_rooms","Plan rooms")}>
          ${(r?.rooms||[]).map(i=>{let a=n.rooms.some(s=>s.roomId===i.roomId);return p`<label class="room"><input type="checkbox" .checked=${a} @change=${()=>this.#c(i.roomId)}><span>${i.name}</span></label>`})}
        </div>
        ${n.rooms.length?p`
          <div class="list" aria-label=${this.#e("v4_room_order_settings","Room order and settings")}>
            ${n.rooms.map((i,a)=>{let s=r?.rooms.find(l=>l.roomId===i.roomId)?.name||"Room";return p`
                <div class="plan-room">
                  <div class="plan-room-head">
                    <strong>${a+1}. ${s}</strong>
                    <button class="icon-button" type="button" aria-label=${this.#e("move_room_up","Move {room} earlier",{room:s})} ?disabled=${a===0} @click=${()=>this.#s(a,-1)}>↑</button>
                    <button class="icon-button" type="button" aria-label=${this.#e("move_room_down","Move {room} later",{room:s})} ?disabled=${a===n.rooms.length-1} @click=${()=>this.#s(a,1)}>↓</button>
                  </div>
                  <div class="split">
                    <label class="field">${this.#e("v4_cleaning_system","Cleaning system")}
                      <select .value=${i.cleaningMode} @change=${l=>this.#u(a,{cleaningMode:z(l)})}>${vt.map(l=>p`<option value=${l}>${this.#t(l)}</option>`)}</select>
                    </label>
                    <label class="field">${this.#e("cleaning_mode","Cleaning mode")}
                      <select .value=${i.coverageSetting} @change=${l=>this.#u(a,{coverageSetting:z(l)})}>${gt.map(l=>p`<option value=${l}>${this.#o(l)}</option>`)}</select>
                    </label>
                  </div>
                </div>
              `})}
          </div>
        `:m}
        <details>
          <summary>${this.#e("v4_completion_options","Completion options")}</summary>
          <div class="stack">
            <label class="checkbox"><input type="checkbox" .checked=${n.returnToBase} @change=${i=>this.#r({type:"patch-plan-draft",patch:{returnToBase:wt(i)}})}>${this.#e("plan_return_to_base","Return to the dock when finished")}</label>
            <label class="checkbox"><input type="checkbox" .checked=${n.finishCurrentRoom} @change=${i=>this.#r({type:"patch-plan-draft",patch:{finishCurrentRoom:wt(i)}})}>${this.#e("plan_finish_room","Finish the active room after Stop")}</label>
            ${n.finishCurrentRoom?p`<label class="field">${this.#e("plan_threshold","Finish threshold")} · ${n.finishCurrentRoomThreshold}%<input type="range" min="0" max="100" step="5" .value=${String(n.finishCurrentRoomThreshold)} @input=${i=>this.#r({type:"patch-plan-draft",patch:{finishCurrentRoomThreshold:Number(z(i))}})}></label>`:m}
          </div>
        </details>
        <div class="toolbar">
          ${n.id?p`
            <button
              class="danger"
              type="button"
              aria-label=${this.#e("plan_delete","Delete plan")}
              @click=${()=>this.#r({type:"open-dialog",dialog:"confirmDeletePlan"})}
            >${this.#e("plan_delete","Delete")}</button>
          `:m}
        </div>
        ${this.#a()}
      </div>
    `)}#p(){let t=this.state.resources.areas;return p`
      <div class="stack">
        <matic-precision-controls-v4 .state=${this.state} .localize=${this.localize}></matic-precision-controls-v4>
        <p class="subtle">${this.#e("v4_draw_floor_hint","Paint only on the mapped floor. Zoom and pan never change the saved outline.")}</p>
        <div class="toolbar">
          <button
            type="button"
            ?disabled=${this.state.draw.circles.length===0}
            @click=${()=>this.#r({type:"clear-draft"})}
          >${this.#e("clear","Clear")}</button>
        </div>
        ${this.#i(t.status,t.problem,p`
          <div class="list" aria-label=${this.#e("area_workspace_title","Saved custom areas")}>
            <button class="list-button" type="button" @click=${()=>this.#r({type:"select-area",areaId:null})}>＋ ${this.#e("area_new","New outline")}</button>
            ${(t.value?.areas||[]).map(r=>p`
              <button class="list-button" type="button" @click=${()=>{this.#r({type:"select-area",areaId:r.id}),this.#r({type:"open-workflow",workflow:"areaReview"})}}>
                <span>${r.name}</span>
                <small>${r.status==="current"?this.#e("area_workspace_ready","Ready"):this.#e("v4_review","Review")}</small>
              </button>
            `)}
          </div>
        `)}
      </div>
    `}#g(){let t=this.state.areaDraft,r=t.canRebind||t.status==="review",n=t.status==="stale"||t.status==="unknown";return p`
      <div class="stack">
        ${r?p`<div class="notice" data-tone="warning" role="status">${this.#e("area_review_required","Review the saved outline on this current map, then confirm it.")}</div>`:m}
        ${n?p`<div class="problem" role="alert">${this.#e("area_redraw_required","This outline no longer matches the current room map. Redraw it before saving.")}</div>`:m}
        <label class="field">${this.#e("area_name","Area name")}
          <input maxlength="128" autocomplete="off" .value=${t.name} @input=${i=>this.#r({type:"patch-area-draft",patch:{name:z(i)}})}>
        </label>
        <div class="split">
          <label class="field">${this.#e("v4_cleaning_system","Cleaning system")}
            <select .value=${t.cleaningMode} @change=${i=>this.#r({type:"patch-area-draft",patch:{cleaningMode:z(i)}})}>${vt.map(i=>p`<option value=${i}>${this.#t(i)}</option>`)}</select>
          </label>
          <label class="field">${this.#e("cleaning_mode","Cleaning mode")}
            <select .value=${t.coverageSetting} @change=${i=>this.#r({type:"patch-area-draft",patch:{coverageSetting:z(i)}})}>${gt.map(i=>p`<option value=${i}>${this.#o(i)}</option>`)}</select>
          </label>
        </div>
        <p class="subtle">${this.#e("v4_private_marks","{count} map-space marks. The outline stays private and floor-bound.",{count:this.state.draw.circles.length})}</p>
        <div class="toolbar">
          <button type="button" @click=${()=>this.#r({type:"open-workflow",workflow:"draw"})}>${this.#e("v4_edit_outline","Edit outline")}</button>
          ${t.id?p`
            <button
              class="danger"
              type="button"
              aria-label=${this.#e("area_delete","Delete area")}
              @click=${()=>this.#r({type:"open-dialog",dialog:"confirmDeleteArea"})}
            >${this.#e("area_delete","Delete")}</button>
          `:m}
        </div>
        ${this.#a()}
      </div>
    `}#m(){let t=this.state.resources.history,r=t.value,n=r?.floors.find(s=>s.id===this.state.selection.floorId)||r?.floors.find(s=>s.active)||r?.floors[0],i=n?.snapshots||[],a=this.state.selection.historyId?Math.max(0,i.findIndex(s=>s.id===this.state.selection.historyId)):i.length;return this.#i(t.status,t.problem,p`
      <div class="stack">
        ${(r?.floors.length||0)>1?p`
          <div class="list" role="listbox" aria-label=${this.#e("v4_mapped_floors","Mapped floors")}>
            ${(r?.floors||[]).map((s,l)=>p`
              <button
                class="floor"
                type="button"
                role="option"
                aria-selected=${String(s.id===n?.id)}
                aria-pressed=${String(s.id===n?.id)}
                @click=${()=>this.#r({type:"set-floor",floorId:s.id})}
              >
                <span>${s.label||(s.active?this.#e("v4_current_floor","Current floor"):this.#e("v4_saved_floor","Saved floor {number}",{number:s.ordinal??l}))}</span>
                <small>${s.active?this.#e("map_timeline_live_action","Live"):this.#e("v4_read_only","Read only")}</small>
              </button>
            `)}
          </div>
        `:m}
        <div class="timeline">
          <label class="field">${this.#e("map_timeline_label","Map timeline")}
            <input
              type="range"
              min="0"
              max=${String(i.length)}
              step="1"
              .value=${String(a)}
              ?disabled=${!i.length}
              @input=${s=>{let l=Number(z(s));this.#r({type:"set-history",historyId:l===i.length?null:i[l]?.id||null})}}
            >
          </label>
          <div class="list">
            <button class="snapshot" type="button" aria-current=${String(!this.state.selection.historyId)} @click=${()=>this.#r({type:"set-history",historyId:null})}><span>${this.#e("map_timeline_live_action","Live")}</span><small>${this.#e("v4_current","Current")}</small></button>
            ${i.map((s,l)=>p`
              <button class="snapshot" type="button" aria-current=${String(s.id===this.state.selection.historyId)} @click=${()=>this.#r({type:"set-history",historyId:s.id})}>
                <span>${this.#w(s.createdAt)}</span><small>${l+1} of ${i.length}</small>
              </button>
            `)}
          </div>
        </div>
        <p class="subtle">${this.#e("v4_history_privacy","Saved maps are floor-scoped and never show a live robot position.")}</p>
      </div>
    `)}#w(t){try{return new Intl.DateTimeFormat(this.state.locale,{dateStyle:"medium",timeStyle:"short"}).format(new Date(t))}catch{return this.#e("v4_saved_map","Saved map")}}#f(){let t=this.state.resources.entry;return p`
      <div class="stack">
        <p class="subtle">${this.#e("v4_support_privacy","This summary contains no map, coordinates, room or floor names, device identifiers, addresses, or credentials.")}</p>
        <dl class="diagnostics">
          <dt>${this.#e("v4_connection","Connection")}</dt><dd>${this.state.host.connected?this.#e("v4_connected","Connected"):this.#e("v4_offline","Offline")}</dd>
          <dt>${this.#e("v4_map_state","Map state")}</dt><dd>${this.state.coherence}</dd>
          <dt>${this.#e("v4_floor_verified","Floor verified")}</dt><dd>${this.state.map.floorCoherent?this.#e("v4_yes","Yes"):this.#e("v4_no","No")}</dd>
          <dt>${this.#e("v4_session_verified","Session verified")}</dt><dd>${this.state.map.sessionVerified?this.#e("v4_yes","Yes"):this.#e("v4_no","No")}</dd>
          <dt>${this.#e("v4_map_complete","Map complete")}</dt><dd>${this.state.map.complete?this.#e("v4_yes","Yes"):this.#e("v4_no","No")}</dd>
          <dt>${this.#e("v4_map_health","Map health")}</dt><dd>${t?.health||this.#e("v4_unknown","Unknown")}</dd>
          <dt>${this.#e("v4_blocked_by","Blocked by")}</dt><dd>${t?.mapBlockReason?.replaceAll("_"," ")||this.#e("v4_nothing","Nothing")}</dd>
          <dt>${this.#e("v4_startup_map","Startup map check")}</dt><dd>${t?.bootstrapState?.replaceAll("_"," ")||this.#e("v4_unknown","Unknown")}</dd>
          <dt>${this.#e("v4_startup_photo","Startup photo layer")}</dt><dd>${t?.bootstrapPhotoSeen?this.#e("v4_seen","Seen"):this.#e("v4_not_seen","Not seen")}</dd>
          <dt>${this.#e("v4_startup_structure","Startup structure layer")}</dt><dd>${t?.bootstrapStructureSeen?this.#e("v4_seen","Seen"):this.#e("v4_not_seen","Not seen")}</dd>
          <dt>${this.#e("v4_startup_failures","Startup failures")}</dt><dd>${t?.bootstrapFailures||0}</dd>
          <dt>${this.#e("v4_stream_failures","Stream failures")}</dt><dd>${t?.streamFailures||0}</dd>
          <dt>${this.#e("v4_saved_floor_count","Saved floor count")}</dt><dd>${this.state.floor.classifiedCount}</dd>
        </dl>
      </div>
    `}render(){switch(this.state.workflow){case"rooms":return this.#l();case"plan":return this.#b();case"draw":return this.#p();case"areaReview":return this.#g();case"history":return this.#m();case"support":return this.#f();case"none":return m}}};customElements.get("matic-map-workflow-v4")||customElements.define("matic-map-workflow-v4",_t);var fo=(o,e)=>{let t=(n,i,a)=>P(e,n,i,a);if(!o.host.connected)return{title:t("v4_reconnecting","Reconnecting"),detail:t("v4_ha_offline","Home Assistant is offline")};if(!o.host.administrator)return{title:t("v4_access_required","Access required"),detail:t("v4_admin_only","Administrator only")};if(o.host.robotCount===0)return{title:t("v4_no_robot_short","No robot"),detail:t("v4_set_up_robot","Set up a Matic robot")};if(!o.host.robotConnected)return{title:t("v4_robot_offline","Robot offline"),detail:t("v4_last_map_read_only","Last verified map \xB7 read only")};if(o.activity==="problem")return{title:t("v4_needs_attention","Needs attention"),detail:t("v4_check_robot","Check the robot")};if(o.dataMode==="history"){let n=o.resources.history.value?.floors.find(s=>s.id===o.selection.floorId),i=n?.snapshots.findIndex(s=>s.id===o.selection.historyId)??-1,a=n?.snapshots.length??0;return{title:t("v4_saved_map","Saved map"),detail:i>=0?t("v4_read_only_position","Read only \xB7 {position} of {count}",{position:i+1,count:a}):t("v4_read_only","Read only")}}if(o.coherence==="verifying"||o.coherence==="booting")return{title:t("v4_locating","Locating"),detail:t("v4_finding_map","Finding the current map")};if(o.activity==="cleaning")return{title:t("v4_cleaning","Cleaning"),detail:t("v4_cleaning_progress","Cleaning in progress")};if(o.activity==="paused")return{title:t("v4_paused","Paused"),detail:t("v4_can_resume","Cleaning can resume")};if(o.activity==="returning")return{title:t("v4_returning","Returning"),detail:t("v4_going_dock","Going to the dock")};if(o.activity==="stopping")return{title:t("v4_stopping","Stopping"),detail:t("v4_waiting_robot","Waiting for the robot")};let r=o.batteryPercent===null?t("v4_ready","Ready"):t("v4_battery","{percent}% battery",{percent:o.batteryPercent});return{title:o.activity==="docked"?t("v4_docked","Docked"):t("v4_ready","Ready"),detail:r}},yo=(o,e)=>{let t=(r,n)=>P(e,r,n);switch(o.workflow){case"rooms":return{title:t("v4_choose_rooms","Choose rooms"),description:t("v4_choose_rooms_detail","Select on the map or from the list.")};case"draw":return{title:t("v4_draw_area","Draw an area"),description:t("v4_draw_area_detail","Paint on the verified map, then review the details.")};case"plan":return{title:t("v4_plan","Plan"),description:t("v4_plan_detail","Review rooms and cleaning settings.")};case"areaReview":return{title:t("area_details","Area details"),description:t("area_details_hint","Name the area and choose cleaning settings.")};case"history":return{title:t("v4_map_history","Map history"),description:t("v4_map_history_detail","Saved maps are floor-scoped and read only.")};case"support":return{title:t("v4_map_support","Map support"),description:t("v4_map_support_detail","Private geometry is never included.")};case"none":return{title:t("v4_clean","Start cleaning"),description:t("v4_clean_detail","Choose rooms, a saved plan, or a custom area.")}}},bo=(o,e)=>{let t=(r,n)=>P(e,r,n);switch(o){case"discardDraft":return{title:t("v4_discard_area","Discard this area?"),detail:t("v4_discard_area_detail","The outline has not been saved. You can keep drawing or discard it."),cancelLabel:t("v4_keep_drawing","Keep drawing"),confirmLabel:t("v4_discard","Discard"),action:"discard"};case"confirmDeletePlan":return{title:t("v4_delete_plan","Delete this plan?"),detail:t("v4_delete_plan_detail","This removes the saved plan from Home Assistant. The robot will not move."),cancelLabel:t("v4_cancel","Cancel"),confirmLabel:t("plan_delete","Delete plan"),action:"delete-plan"};case"confirmDeleteArea":return{title:t("v4_delete_area","Delete this area?"),detail:t("v4_delete_area_detail","This removes the saved outline from Home Assistant. The robot will not move."),cancelLabel:t("v4_cancel","Cancel"),confirmLabel:t("area_delete","Delete area"),action:"delete-area"};case"confirmStop":return{title:t("v4_stop_cleaning","Stop cleaning?"),detail:t("v4_stop_cleaning_detail","The robot may take a moment to settle before another action is available."),cancelLabel:t("v4_keep_cleaning","Keep cleaning"),confirmLabel:t("v4_stop","Stop"),action:"stop"};case"error":return{title:t("v4_error","Something went wrong"),detail:t("v4_error_detail","No action was started. Close this message and try again when the map is ready."),cancelLabel:t("v4_close","Close"),confirmLabel:t("v4_close","Close"),action:null};case null:return null}},vo=(o=document)=>{let e=o.activeElement;for(;e?.shadowRoot?.activeElement;)e=e.shadowRoot.activeElement;return e},kt=class extends x{constructor(){super(...arguments);this.state=M();this._measuredNarrow=!1;this._sheetOffset=0;this._overflowOpen=!1;this._browserFullscreen=!1;this._sheetDetent="half";this.#t=null;this.#o=null;this.#r=null;this.#a=null;this.#i=null;this.#l=null;this.#c=()=>{this._browserFullscreen=document.fullscreenElement===this.renderRoot.querySelector(".app")};this.#u=t=>{if(!this._overflowOpen)return;let r=this.renderRoot.querySelector(".overflow-wrap");(!r||!t.composedPath().includes(r))&&(this._overflowOpen=!1)}}static{this.properties={state:{attribute:!1},localize:{attribute:!1},_measuredNarrow:{state:!0},_sheetOffset:{state:!0},_overflowOpen:{state:!0},_browserFullscreen:{state:!0},_sheetDetent:{state:!0}}}static{this.styles=D`
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

    .quick-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.6rem; }
    .quick-actions button, .room-row {
      min-block-size: 3.25rem;
      border: 1px solid var(--divider-color, rgb(60 75 85 / 17%));
      border-radius: 0.75rem;
      color: inherit;
      background: var(--secondary-background-color, #f4f7f8);
    }

    .quick-actions button {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 0.55rem;
      align-items: center;
      min-block-size: 4.4rem;
      padding: 0.72rem 0.8rem;
      cursor: pointer;
      text-align: start;
    }
    .quick-actions button:hover { border-color: color-mix(in srgb, var(--primary-color, #0678ce) 42%, transparent); }
    .quick-actions button:focus-visible { outline: 2px solid var(--primary-color, #0678ce); outline-offset: 2px; }
    .quick-actions button.featured {
      border-color: color-mix(in srgb, var(--primary-color, #0678ce) 30%, transparent);
      background: color-mix(in srgb, var(--primary-color, #0678ce) 9%, var(--card-background-color, #fff));
    }
    .quick-copy { min-inline-size: 0; }
    .quick-copy strong, .quick-copy small { display: block; }
    .quick-copy strong { font-size: 0.82rem; font-weight: 720; }
    .quick-copy small { margin-block-start: 0.18rem; color: var(--primary-text-color, #263238); font-size: 0.7rem; font-weight: 500; line-height: 1.35; }
    .quick-arrow { color: var(--secondary-text-color, #687984); font-size: 1rem; }
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
    .primary-action:disabled {
      cursor: default;
      opacity: 1;
      color: var(--disabled-text-color, #89969e);
      background: var(--disabled-color, var(--secondary-background-color, #e8edef));
      box-shadow: none;
    }
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
    .narrow .quick-actions { grid-template-columns: minmax(0, 1fr); }
    .narrow .quick-actions button { min-block-size: 3.8rem; }
    .narrow .header-state {
      display: inline-flex;
      overflow: hidden;
      max-inline-size: 5.5rem;
      font-size: 0.7rem;
      text-overflow: ellipsis;
    }
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
  `}#e(t,r,n){return P(this.localize,t,r,n)}#t;#o;#r;#a;#i;#l;#c;#u;connectedCallback(){super.connectedCallback(),this.#t=new ResizeObserver(([t])=>{if(!t)return;let r=t.contentRect.width<768||t.contentRect.height<480;r!==this._measuredNarrow&&(this._measuredNarrow=r)}),this.#t.observe(this),window.addEventListener("pointerdown",this.#u,!0),document.addEventListener("fullscreenchange",this.#c),this.#o=new ResizeObserver(([t])=>{if(!t)return;let r=Math.ceil(t.target.getBoundingClientRect().height);r!==this._sheetOffset&&(this._sheetOffset=r)})}disconnectedCallback(){this.#t?.disconnect(),this.#t=null,this.#o?.disconnect(),this.#o=null,this.#r=null,window.removeEventListener("pointerdown",this.#u,!0),document.removeEventListener("fullscreenchange",this.#c),super.disconnectedCallback()}updated(t){let r=this.renderRoot.querySelector(".mobile-sheet");if(r!==this.#r&&(this.#o?.disconnect(),this.#r=r,r&&this.#o?.observe(r)),t.has("state")){let n=t.get("state");n?.precisionOpen&&!this.state.precisionOpen&&this.#a?.focus(),!n?.dialog&&this.state.dialog?(this.#i=vo(this.shadowRoot||document),this.updateComplete.then(()=>{this.renderRoot.querySelector(".dialog button")?.focus()})):n?.dialog&&!this.state.dialog&&(this.#i?.focus(),this.#i=null),(!n||n.workflow!==this.state.workflow)&&(this._sheetDetent="half")}}#s(t){this.dispatchEvent(new CustomEvent(ee,{detail:t,bubbles:!0,composed:!0}))}#b(t){if(t.enabled){if(t.id==="return-live"){this.#s({type:"set-history",historyId:null});return}this.#w(t.id)}}#p(t){if(this.state.workflow==="draw"&&this.state.draw.dirty&&t!=="draw"&&t!=="areaReview"){this.#l=t,this.#s({type:"open-dialog",dialog:"discardDraft"});return}this.#s({type:"open-workflow",workflow:t})}#g(){let t=this.#l;this.#l=null,this.#s({type:"discard-draft"}),t&&queueMicrotask(()=>this.#s({type:"open-workflow",workflow:t}))}#m(){this.#l=null,this.#s({type:"dismiss-top-layer"})}#w(t){this.dispatchEvent(new CustomEvent(De,{detail:{id:t},bubbles:!0,composed:!0}))}#f(t){this.#s({type:"dismiss-top-layer"}),this.#w(t)}#d(t){if(t.action==="discard"){this.#g();return}if(t.action==="delete-plan"||t.action==="delete-area"){this.#f(t.action);return}this.#s({type:"dismiss-top-layer"}),t.action==="stop"&&this.#w("stop")}#_(){this._sheetDetent=this._sheetDetent==="peek"?"half":this._sheetDetent==="half"?"full":"peek"}#x(){if(this.state.precisionOpen||this.state.fullMap){this.#s({type:"dismiss-top-layer"});return}if(this.state.workflow!=="none"){this.#p("none");return}this.#k()}#k(){this.dispatchEvent(new CustomEvent("hass-toggle-menu",{bubbles:!0,composed:!0}))}#n(t){if(this._overflowOpen=!1,t==="support"){this.#p("support");return}if(t==="fullscreen"){let r=this.renderRoot.querySelector(".app");document.fullscreenElement?document.exitFullscreen():r?.requestFullscreen();return}this.dispatchEvent(new CustomEvent(De,{detail:{id:"use-classic"},bubbles:!0,composed:!0}))}#y(t){this.#a=t.currentTarget,this.#s({type:"set-precision-open",value:!this.state.precisionOpen})}#v(t){if(!(t.defaultPrevented||t.ctrlKey||t.metaKey||t.altKey)&&t.key==="Escape"){if(t.preventDefault(),this._overflowOpen){this._overflowOpen=!1;return}this.#s({type:"dismiss-top-layer"})}}#h(t){if(t.key!=="Tab")return;let r=[...this.renderRoot.querySelectorAll(".dialog button:not(:disabled)")],n=r[0],i=r.at(-1);!n||!i||(t.shiftKey&&this.shadowRoot?.activeElement===n?(t.preventDefault(),i.focus()):!t.shiftKey&&this.shadowRoot?.activeElement===i&&(t.preventDefault(),n.focus()))}#S(t,r="primary-action"){if(t.id==="choose-cleaning")return m;let i={stop:["v4_stop","Stop"],resume:["v4_resume","Resume"],"review-area":["v4_review_details","Review details"],"save-area":["area_save","Save area"],"run-area":["area_run","Clean area"],"save-plan":["plan_save","Save plan"],"run-plan":["plan_run","Run plan"]}[t.id],a=t.id==="clean-rooms"?t.label:i?this.#e(i[0],i[1]):t.label;return p`
      <button
        class=${`${r} ${t.kind==="danger"?"danger":""}`}
        type="button"
        ?disabled=${!t.enabled}
        title=${t.reason??""}
        @click=${()=>this.#b(t)}
      >${a}</button>
    `}#$(t){return t.workflow==="none"?p`
      <div class="quick-actions" aria-label=${this.#e("v4_cleaning_choices","Cleaning choices")}>
        <button class="featured" type="button" @click=${()=>this.#p("rooms")}>
          <span class="quick-copy"><strong>${this.#e("map_rooms","Rooms")}</strong><small>${this.#e("v4_rooms_quick_detail","Pick rooms and clean them now.")}</small></span><span class="quick-arrow" aria-hidden="true">›</span>
        </button>
        <button type="button" @click=${()=>this.#p("plan")}>
          <span class="quick-copy"><strong>${this.#e("cleaning_workspace_plans","Plans")}</strong><small>${this.#e("v4_plans_quick_detail","Run or edit a saved routine.")}</small></span><span class="quick-arrow" aria-hidden="true">›</span>
        </button>
        <button type="button" @click=${()=>this.#p("draw")}>
          <span class="quick-copy"><strong>${this.#e("area_workspace_title","Custom areas")}</strong><small>${this.#e("v4_areas_quick_detail","Use or draw a precise outline.")}</small></span><span class="quick-arrow" aria-hidden="true">›</span>
        </button>
        <button type="button" @click=${()=>this.#p("history")}>
          <span class="quick-copy"><strong>${this.#e("map_timeline_history","History")}</strong><small>${this.#e("v4_history_quick_detail","Browse earlier floor maps.")}</small></span><span class="quick-arrow" aria-hidden="true">›</span>
        </button>
      </div>
    `:p`<matic-map-workflow-v4 .state=${t} .localize=${this.localize}></matic-map-workflow-v4>`}render(){let t=this.state,r=t.narrowHint||this._measuredNarrow,n=fo(t,this.localize),i=yo(t,this.localize),a=Lt({...t,narrowHint:r}),s=Dt(t),l=t.workflow==="draw"&&(r||t.fullMap),c=t.fullMap&&(t.coherence==="verifying"||t.coherence==="booting"),d=t.workflow!=="none"||t.fullMap||t.precisionOpen,u=bo(t.dialog,this.localize);return p`
      <div class=${`root ${r?"narrow":"wide"}`} @keydown=${this.#v}>
        <div class="app">
          <header class="app-bar">
            <button
              class="nav"
              type="button"
              aria-label=${d?this.#e("v4_back","Back"):this.#e("v4_open_navigation","Open navigation")}
              @click=${this.#x}
            >${d?"\u2190":"\u2630"}</button>
            <h1 class="title">${this.#e("map_studio_title","Matic Map")}</h1>
            ${t.host.robotCount>1?p`
              <select
                class="robot-switcher"
                aria-label=${this.#e("v4_choose_robot","Choose robot")}
                .value=${t.selection.entryId||""}
                @change=${h=>this.#s({type:"select-entry",entryId:h.currentTarget.value})}
              >${t.robots.map(h=>p`
                <option value=${h.entryId}>${h.label}</option>
              `)}</select>
            `:m}
            <span class="spacer"></span>
            <span class="header-state">${n.title}</span>
            <div class="overflow-wrap">
              <button
                class="overflow"
                type="button"
                aria-label=${this.#e("map_more","More map options")}
                aria-expanded=${String(this._overflowOpen)}
                @click=${()=>{this._overflowOpen=!this._overflowOpen}}
              >⋮</button>
              ${this._overflowOpen?p`
                <div class="overflow-menu" role="menu">
                  <label class="overflow-field">${this.#e("map_quality_label","Scene detail")}
                    <select
                      .value=${t.quality}
                      @change=${h=>this.#s({type:"set-quality",quality:h.currentTarget.value})}
                    >
                      <option value="auto">${this.#e("map_quality_auto","Auto detail")}</option>
                      <option value="efficient">${this.#e("map_quality_efficient","Efficient")}</option>
                      <option value="balanced">${this.#e("map_quality_balanced","Balanced")}</option>
                      <option value="maximum">${this.#e("map_quality_maximum","Maximum")}</option>
                    </select>
                  </label>
                  <button role="menuitem" type="button" @click=${()=>this.#n("fullscreen")}>${this._browserFullscreen?this.#e("exit_fullscreen","Exit full screen"):this.#e("expand_map","Browser full screen")}</button>
                  <button role="menuitem" type="button" @click=${()=>this.#n("support")}>${this.#e("v4_map_support","Map support")}</button>
                  <button role="menuitem" type="button" @click=${()=>this.#n("classic")}>${this.#e("v4_use_classic","Use classic Map Studio")}</button>
                </div>
              `:m}
            </div>
          </header>

          <main class=${`workspace ${t.fullMap?"full-map":""}`}>
            <div class="canvas">
              <matic-map-canvas-v4
                style=${r&&!t.fullMap?`--map-sheet-offset:${this._sheetOffset}px`:"--map-sheet-offset:0px"}
                .state=${t}
                .localize=${this.localize}
              ></matic-map-canvas-v4>
            </div>

            ${l?p`
              <div class="precision-popover">
                <button
                  class="precision-chip"
                  type="button"
                  aria-expanded=${String(t.precisionOpen)}
                  @click=${this.#y}
                >${t.draw.zoomPercent}% · ${t.draw.brushMeters.toFixed(2)} m</button>
                <button
                  class="precision-chip"
                  type="button"
                  ?disabled=${t.draw.circles.length===0}
                  @click=${()=>this.#s({type:"clear-draft"})}
                >${this.#e("clear","Clear")}</button>
                ${t.precisionOpen?p`
                  <matic-precision-controls-v4 compact .state=${t} .localize=${this.localize}></matic-precision-controls-v4>
                `:m}
              </div>
            `:m}

            <aside class="inspector" aria-label="Map workspace">
              <div class="status-strip">
                <span class="status-icon" aria-hidden="true">◆</span>
                <span><strong>${n.title}</strong><small>${n.detail}</small></span>
              </div>
              <section class="workflow">
                <h2 tabindex="-1">${i.title}</h2>
                <p>${i.description}</p>
                ${this.#$(t)}
                <div class="primary-stack">
                  ${this.#S(a)}
                  ${s?this.#S(s,"secondary-action"):m}
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
                @click=${this.#_}
              >
                <span class="sheet-handle" aria-hidden="true"></span>
                <span class="sheet-title">${i.title}</span>
                <span class="sheet-description">${i.description}</span>
              </button>
              <div class="sheet-body">
                ${t.workflow==="draw"?m:this.#$(t)}
              </div>
              <div class="primary-stack">
                ${this.#S(a)}
                ${s?this.#S(s,"secondary-action"):m}
              </div>
            </section>

            ${t.fullMap?p`
              <section
                class=${`full-map-hud ${s?"has-secondary":""}`}
                aria-label="Robot status and action"
              >
                <span class="hud-copy"><strong>${n.title}</strong><small>${n.detail}</small></span>
                ${c?m:this.#S(a)}
                ${!c&&s?this.#S(s,"secondary-action"):m}
              </section>
            `:m}
          </main>
        </div>

        ${u?p`
          <div class="dialog-backdrop">
            <section
              class="dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="dialog-title"
              @keydown=${this.#h}
            >
              <h2 id="dialog-title">${u.title}</h2>
              <p>${u.detail}</p>
              <div class="dialog-actions">
                <button
                  type="button"
                  @click=${t.dialog==="discardDraft"?this.#m:()=>this.#s({type:"dismiss-top-layer"})}
                >${u.cancelLabel}</button>
                ${u.action===null?m:p`
                  <button
                    class="discard"
                    type="button"
                    @click=${()=>this.#d(u)}
                  >${u.confirmLabel}</button>
                `}
              </div>
            </section>
          </div>
        `:m}
      </div>
    `}};customElements.get("matic-map-shell-v4")||customElements.define("matic-map-shell-v4",kt);var xt=class extends x{constructor(){super(...arguments);this.scenario="ready";this.narrow=!1;this.controls=!0;this._workspace=et("ready");this.#e=new ne(this._workspace);this.#t=null}static{this.properties={scenario:{type:String,reflect:!0},narrow:{type:Boolean,reflect:!0},controls:{type:Boolean,reflect:!0},_workspace:{state:!0}}}static{this.styles=D`
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
  `}#e;#t;connectedCallback(){super.connectedCallback(),this.#t=this.#e.subscribe(t=>{this._workspace=t})}disconnectedCallback(){this.#t?.(),this.#t=null,super.disconnectedCallback()}willUpdate(t){t.has("scenario")?this.#e.replace({...et(this.scenario),narrowHint:this.narrow}):t.has("narrow")&&this.#e.dispatch({type:"set-narrow-hint",value:this.narrow})}setScenario(t){tt.includes(t)&&(this.scenario=t)}getWorkspaceSnapshot(){return structuredClone(this.#e.value)}replaceWorkspaceState(t){this.#e.replace(structuredClone(t))}#o(t){Ce(t.detail)&&(t.stopPropagation(),this.#e.dispatch(t.detail))}render(){return p`
      ${this.controls?p`
        <nav class="gallery-controls" aria-label="Map Studio states">
          ${tt.map(t=>p`
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
          @matic-workspace-intent=${this.#o}
        ></matic-map-shell-v4>
      </div>
    `}};customElements.get("matic-map-studio-gallery-v0-4-0")||customElements.define("matic-map-studio-gallery-v0-4-0",xt);var hr="/api/matic_robot/slam_entries";var y=class extends Error{constructor(e){super(e),this.name="ContractError",this.code=e}},R=(o,e)=>{if(!o||typeof o!="object"||Array.isArray(o))throw new y(e);return o},S=(o,e,t)=>{if(typeof o!="string")throw new y(t);let r=o.trim();if(!r||Array.from(r).length>e||/[\u0000-\u001f\u007f]/u.test(r))throw new y(t);return r},go=o=>{if(o==null||o==="")return null;try{return S(o,128,"invalid-floor-label")}catch{return null}},ce=(o,e,t,r)=>{if(typeof o!="number"||!Number.isFinite(o)||o<e||o>t)throw new y(r);return o},O=(o,e,t,r)=>{let n=ce(o,e,t,r);if(!Number.isInteger(n))throw new y(r);return n},St=(o,e)=>o==null?null:O(o,1,e,"invalid-floor-ordinal"),_=(o,e)=>{if(typeof o!="boolean")throw new y(e);return o},wo=(o,e)=>o===null?null:_(o,e),mr=o=>{if(o==null)return null;let e=S(o,64,"invalid-map-session-key");if(!/^[0-9a-f]{64}$/u.test(e))throw new y("invalid-map-session-key");return e},_o=o=>{if(o==null)return null;if(o==="bootstrap_empty"||o==="map_session_unverified"||o==="floor_plan_unavailable"||o==="floor_plan_mismatch")return o;throw new y("invalid-map-block-reason")},ko=o=>{if(o===void 0)return"not_started";if(o==="not_started"||o==="running"||o==="complete"||o==="partial"||o==="failed")return o;throw new y("invalid-bootstrap-state")},q=(o,e)=>{let t=S(o,512,e);if(!t.startsWith("/")||t.startsWith("//")||t.includes("\\"))throw new y(e);return t},xo=o=>{let e=typeof o.map_health=="string"?o.map_health.toLowerCase():"",t=typeof o.stream_state=="string"?o.stream_state.toLowerCase():"",r=typeof o.invalid_tiles=="number"?o.invalid_tiles:0;return e.includes("error")||e.includes("fail")||e.includes("degrad")||r>0?"problem":o.map_truncated===!0||e.includes("truncat")||e.includes("limit")?"limited":o.map_complete===!0?"ready":t.includes("connect")||t.includes("collect")||t.includes("run")?"building":"unknown"},fr=o=>{let e=R(o,"invalid-catalog");if(!Array.isArray(e.entries)||e.entries.length>64)throw new y("invalid-catalog-entries");return e.entries.map(t=>{let r=R(t,"invalid-catalog-entry"),n=O(r.map_revision,0,Number.MAX_SAFE_INTEGER,"invalid-map-revision");return{entryId:S(r.entry_id,128,"invalid-entry-id"),sceneUrl:q(r.scene_url,"invalid-scene-url"),deltaUrl:r.delta_url===void 0||r.delta_url===null?null:q(r.delta_url,"invalid-delta-url"),poseUrl:q(r.pose_url,"invalid-pose-url"),historyUrl:q(r.history_url,"invalid-history-url"),areasUrl:q(r.areas_url,"invalid-areas-url"),plansUrl:q(r.plans_url,"invalid-plans-url"),mapRevision:n,mapFloorCoherent:_(r.map_floor_coherent,"invalid-floor-coherence"),mapSessionVerified:_(r.map_session_verified,"invalid-session-state"),mapSessionKey:mr(r.map_session_key),mapBlockReason:_o(r.map_block_reason),runnerLocked:_(r.runner_locked,"invalid-runner-lock"),stopSettlePending:_(r.stop_settle_pending,"invalid-stop-settle"),activePlan:_(r.active_plan,"invalid-active-plan"),nativeReconciliationPending:_(r.native_reconciliation_pending,"invalid-native-reconciliation"),nativeSessionActive:wo(r.native_session_active,"invalid-native-session"),mapComplete:_(r.map_complete,"invalid-map-complete"),mapTruncated:_(r.map_truncated,"invalid-map-truncated"),selectedFloorOrdinal:St(r.selected_floor_ordinal,128),mapFloorOrdinal:St(r.map_floor_ordinal,128),historyCount:O(r.history_count,0,12,"invalid-history-count"),historyFloorCount:O(r.history_floor_count,0,128,"invalid-floor-count"),health:xo(r),streamFailures:O(r.stream_failures,0,Number.MAX_SAFE_INTEGER,"invalid-stream-failures"),bootstrapState:ko(r.bootstrap_state),bootstrapPhotoSeen:r.bootstrap_photo_seen===void 0?!1:_(r.bootstrap_photo_seen,"invalid-bootstrap-photo"),bootstrapStructureSeen:r.bootstrap_structure_seen===void 0?!1:_(r.bootstrap_structure_seen,"invalid-bootstrap-structure"),bootstrapFailures:r.bootstrap_failures===void 0?0:O(r.bootstrap_failures,0,2,"invalid-bootstrap-failures")}})},yr=(o,e)=>{if(!Array.isArray(o)||o.length!==2)throw new y(e);return[ce(o[0],-1e6,1e6,e),ce(o[1],-1e6,1e6,e)]},So=(o,e)=>{if(!Array.isArray(o)||o.length<3||o.length>8192)throw new y(e);return o.map(t=>yr(t,e))},br=(o,e)=>{if(!Array.isArray(o)||o.length>256)throw new y("invalid-rooms");return o.map(t=>{let r=R(t,"invalid-room");return{roomId:S(r.room_id,128,"invalid-room-id"),name:S(r.name,128,"invalid-room-name"),boundary:e?So(r.boundary,"invalid-room-boundary"):[]}})},$o=o=>{let e=R(o,"invalid-history-snapshot"),t=S(e.created_at,64,"invalid-history-time");if(!Number.isFinite(Date.parse(t)))throw new y("invalid-history-time");return{id:S(e.id,128,"invalid-history-id"),createdAt:t,revision:O(e.revision,0,Number.MAX_SAFE_INTEGER,"invalid-history-revision"),pointCount:O(e.point_count,1,15e5,"invalid-history-points"),sceneUrl:q(e.scene_url,"invalid-history-scene-url")}},vr=o=>{let e=R(o,"invalid-history");if(!Array.isArray(e.floors)||e.floors.length<1||e.floors.length>128)throw new y("invalid-history-floors");return{entryId:S(e.entry_id,128,"invalid-history-entry"),liveAvailable:_(e.live_available,"invalid-history-live"),floors:e.floors.map(t=>{let r=R(t,"invalid-history-floor");if(!Array.isArray(r.snapshots)||r.snapshots.length>12)throw new y("invalid-history-snapshots");return{id:S(r.id,128,"invalid-history-floor-id"),active:_(r.active,"invalid-history-floor-active"),readOnly:_(r.read_only,"invalid-history-floor-read-only"),liveAvailable:r.live_available===void 0?!1:_(r.live_available,"invalid-history-floor-live"),label:go(r.label),ordinal:r.ordinal===void 0?null:St(r.ordinal,128),snapshots:r.snapshots.map($o)}})}},gr=o=>{if(o==="vacuum"||o==="mop"||o==="vacuum_and_mop")return o;throw new y("invalid-cleaning-mode")},wr=o=>{if(o==="quick"||o==="standard"||o==="heavy_duty")return o;throw new y("invalid-coverage-setting")},Co=o=>{let e=R(o,"invalid-area-circle");return{x:ce(e.x,-1e6,1e6,"invalid-area-circle"),y:ce(e.y,-1e6,1e6,"invalid-area-circle"),radius:ce(e.radius,.05,2.5,"invalid-area-circle")}},Mo=o=>o==="current"||o==="review"||o==="stale"?o:"unknown",_r=o=>{let e=R(o,"invalid-areas");if(!Array.isArray(e.areas)||e.areas.length>256)throw new y("invalid-area-list");return{sceneUrl:q(e.scene_url,"invalid-area-scene-url"),rooms:br(e.rooms,!0),areas:e.areas.map(t=>{let r=R(t,"invalid-area");if(!Array.isArray(r.circles)||r.circles.length>512)throw new y("invalid-area-circles");return{id:S(r.id,128,"invalid-area-id"),name:S(r.name,128,"invalid-area-name"),circles:r.circles.map(Co),cleaningMode:gr(r.cleaning_mode),coverageSetting:wr(r.coverage_setting),status:Mo(r.status),canRebind:_(r.can_rebind,"invalid-area-rebind")}})}},kr=o=>{let e=R(o,"invalid-plans");if(!Array.isArray(e.plans)||e.plans.length>256)throw new y("invalid-plan-list");return{rooms:br(e.rooms,!1).map(({roomId:r,name:n})=>({roomId:r,name:n})),selectedPlan:e.selected_plan===null||e.selected_plan===void 0?null:S(e.selected_plan,128,"invalid-selected-plan"),plans:e.plans.map(r=>{let n=R(r,"invalid-plan");if(!Array.isArray(n.rooms)||n.rooms.length>256||!Array.isArray(n.room_order))throw new y("invalid-plan-rooms");let i=n.run_behavior;if(i!=="intelligent"&&i!=="ordered")throw new y("invalid-run-behavior");return{id:S(n.id,128,"invalid-plan-id"),name:S(n.name,128,"invalid-plan-name"),enabled:_(n.enabled,"invalid-plan-enabled"),runBehavior:i,rooms:n.rooms.map(a=>{let s=R(a,"invalid-plan-room");return{roomId:S(s.room_id,128,"invalid-plan-room-id"),cleaningMode:gr(s.cleaning_mode),coverageSetting:wr(s.coverage_setting)}}),roomOrder:n.room_order.slice(0,256).map(a=>S(a,128,"invalid-room-order")),returnToBase:_(n.return_to_base,"invalid-return-to-base"),finishCurrentRoom:_(n.finish_current_room,"invalid-finish-room"),finishCurrentRoomThreshold:O(n.finish_current_room_threshold,0,100,"invalid-finish-threshold")}})}},xr=o=>{let e=R(o,"invalid-pose"),t=e.position,r=t===null?null:yr(t,"invalid-pose-position"),n=e.pose_freshness;if(n!=="live"&&n!=="coordinator_fallback")throw new y("invalid-pose-freshness");return{position:r,source:S(e.source,64,"invalid-pose-source"),revision:O(e.revision,0,Number.MAX_SAFE_INTEGER,"invalid-pose-revision"),poseRevision:O(e.pose_revision,0,Number.MAX_SAFE_INTEGER,"invalid-pose-sequence"),floorCoherent:_(e.map_floor_coherent,"invalid-pose-floor"),mapSessionKey:mr(e.map_session_key),freshness:n}},Sr=o=>{try{return q(o,"invalid-private-path"),!0}catch{return!1}};var $r=o=>{let i=()=>{throw new Error("invalid-scene")};(!(o instanceof ArrayBuffer)||o.byteLength<24||o.byteLength>16777216)&&i();let a=new DataView(o),s=new Uint8Array(o,0,8),l=String.fromCharCode(...s),c=a.getUint16(8,!0),d=a.getUint16(10,!0),u=a.getUint32(12,!0),h=a.getUint32(16,!0),f=a.getUint32(20,!0),v=h+f,$=24+u;(l!=="MATIC3D\0"||c!==1||d!==8||u>1024*1024||v<1||v>15e5||$+v*d!==o.byteLength)&&i();let g;try{g=JSON.parse(new TextDecoder("utf-8",{fatal:!0}).decode(new Uint8Array(o,24,u)))}catch{i()}(!g||typeof g!="object"||Array.isArray(g))&&i();let w=g,E=w.meters_per_cell,k=w.origin_cells,C=w.span_cells;(typeof E!="number"||!Number.isFinite(E)||E<.001||E>.1||!Array.isArray(k)||k.length!==2||!k.every(I=>typeof I=="number"&&Number.isFinite(I))||!Array.isArray(C)||C.length!==2||!C.every(I=>typeof I=="number"&&Number.isFinite(I)&&I>=1&&I<=65536))&&i();let K=(Array.isArray(w.rooms)?w.rooms.slice(0,128):[]).flatMap((I,Ur)=>{if(!I||typeof I!="object"||Array.isArray(I))return[];let j=I,xe=typeof j.name=="string"?j.name.trim():"";if(!xe||Array.from(xe).length>128||/[\u0000-\u001f\u007f]/u.test(xe))return[];if(!Array.isArray(j.boundary)||j.boundary.length<3||j.boundary.length>8192)return[];let It=j.boundary.flatMap(Xe=>{if(!Array.isArray(Xe)||Xe.length!==2)return[];let[je,Ye]=Xe;return typeof je=="number"&&Number.isFinite(je)&&typeof Ye=="number"&&Number.isFinite(Ye)?[[je,Ye]]:[]}),qe=j.center;if(It.length<3||!Array.isArray(qe)||qe.length!==2)return[];let[Ve,Ke]=qe;return typeof Ve!="number"||!Number.isFinite(Ve)||typeof Ke!="number"||!Number.isFinite(Ke)?[]:[{id:`scene-room-${Ur+1}`,name:xe,boundary:It,center:[Ve,Ke]}]}),ke=typeof w.sample_step=="number"&&Number.isInteger(w.sample_step)?Math.max(1,Math.min(15e5,w.sample_step)):1,Et=k,Rt=C;return{buffer:o,pointOffset:$,floorCount:h,surfaceCount:f,total:v,metadata:{metersPerCell:E,origin:[Et[0],Et[1]],span:[Rt[0],Rt[1]],sampleStep:ke,rooms:K}}},Ro=o=>{if(o.byteLength>16777216||o.byteLength<24||!1||!1)throw new y("invalid-scene");try{return $r(o)}catch{throw new y("invalid-scene")}},Io=()=>`
  const parseTransfer = ${$r.toString()};
  self.onmessage = (event) => {
    const { id, buffer } = event.data;
    try {
      const parsed = parseTransfer(buffer);
      self.postMessage({ id, ok: true, parsed }, [parsed.buffer]);
    } catch (_) {
      self.postMessage({ id, ok: false, problem: "invalid-scene" });
    }
  };
`,Oe=class{#e=null;#t=null;#o=0;#r=new Map;constructor(){if(!(typeof Worker!="function"||typeof URL?.createObjectURL!="function"))try{this.#t=URL.createObjectURL(new Blob([Io()],{type:"text/javascript"})),this.#e=new Worker(this.#t),this.#e.onmessage=e=>{let t=this.#r.get(e.data.id);t&&(this.#r.delete(e.data.id),e.data.ok&&e.data.parsed?t.resolve(e.data.parsed):t.reject(new y(e.data.problem||"invalid-scene")))},this.#e.onerror=()=>this.#a("scene-worker-failed")}catch{this.#e=null,this.#t&&URL.revokeObjectURL(this.#t),this.#t=null}}async parse(e,t){if(t?.aborted)throw new DOMException("Aborted","AbortError");if(!this.#e){if(await new Promise(n=>window.setTimeout(n,0)),t?.aborted)throw new DOMException("Aborted","AbortError");return Ro(e)}let r=++this.#o;return new Promise((n,i)=>{let a=()=>{this.#r.delete(r),i(new DOMException("Aborted","AbortError"))};t?.addEventListener("abort",a,{once:!0}),this.#r.set(r,{resolve:s=>{t?.removeEventListener("abort",a),n(s)},reject:s=>{t?.removeEventListener("abort",a),i(s)}}),this.#e?.postMessage({id:r,buffer:e},[e])})}#a(e){for(let t of this.#r.values())t.reject(new y(e));this.#r.clear(),this.#e?.terminate(),this.#e=null}dispose(){this.#a("scene-parser-disposed"),this.#t&&URL.revokeObjectURL(this.#t),this.#t=null}};var V={catalog:1e4,scene:6e4,delta:35e3,pose:1e4,history:15e3,workflow:15e3,mutation:2e4},T=class extends Error{constructor(e,t=null){super(e),this.name="BackendError",this.code=e,this.status=t}},we=36,de=16*1024*1024,Cr=(o,e)=>{let t=Number(o);if(!Number.isSafeInteger(t)||t<0)throw new y(e);return t},Mr=(o,e)=>{let t=o.headers.get("X-Matic-Revision");if(t===null)return e;let r=Number(t);if(!Number.isSafeInteger(r)||r<0)throw new y("invalid-scene-revision");return r},Ar=(o,e)=>{let t=o.headers.get("X-Matic-Floor-Coherent");if(t===null)return e;if(t==="1")return!0;if(t==="0")return!1;throw new y("invalid-scene-floor-header")},Ne=class{#e;#t=new Oe;constructor(e){this.#e=e}async#o(e,t,r,n){if(!Sr(e))throw new T("invalid-private-path");if(n?.aborted)throw new DOMException("Aborted","AbortError");let i=new AbortController,a=()=>i.abort();n?.addEventListener("abort",a,{once:!0});let s=!1,l=window.setTimeout(()=>{s=!0,i.abort()},r);try{let c=this.#e(),d=new Headers(t.headers),u={...t,cache:"no-store",credentials:"same-origin",headers:Object.fromEntries(d.entries()),signal:i.signal};if(typeof c?.fetchWithAuth=="function")return await c.fetchWithAuth(e,u);let h=c?.auth?.accessToken||c?.auth?.data?.access_token;h&&d.set("Authorization",`Bearer ${h}`);let f=typeof c?.hassUrl=="function"?c.hassUrl(e):e;return await fetch(f,{...u,headers:d})}catch(c){throw s&&!n?.aborted?new T("request-timeout"):i.signal.aborted?new DOMException("Aborted","AbortError"):c}finally{window.clearTimeout(l),n?.removeEventListener("abort",a)}}async#r(e,t,r,n={}){let i=await this.#o(e,{...n,headers:{Accept:"application/json",...n.headers||{}}},t,r);if(!i.ok)throw new T("request-failed",i.status);try{return await i.json()}catch{throw new y("invalid-json-response")}}async catalog(e){return fr(await this.#r(hr,V.catalog,e))}async scene(e,t,r,n,i,a){let s=new Headers({Accept:"application/vnd.matic.slam-scene"});n==="live"&&s.set("X-Matic-Prefer-Cached","1"),a&&s.set("If-None-Match",a);let l=await this.#o(e,{headers:s},V.scene,i),c=Mr(l,t),d=Ar(l,r);if(l.status===304)return{scene:null,floorCoherent:d,revision:c,notModified:!0};if(!l.ok)throw new T("scene-request-failed",l.status);if(l.headers.get("Content-Type")?.split(";",1)[0]!=="application/vnd.matic.slam-scene")throw new y("invalid-scene-content-type");return{scene:{...await this.#t.parse(await l.arrayBuffer(),i),revision:c,etag:l.headers.get("ETag"),source:n},floorCoherent:d,revision:c,notModified:!1}}async#a(e,t,r){if(!Number.isSafeInteger(t)||t<1||t>de||typeof DecompressionStream!="function")throw new y("invalid-scene-delta");let i=new Blob([e]).stream().pipeThrough(new DecompressionStream("deflate")).getReader(),a=new Uint8Array(t),s=0,l=()=>{i.cancel()};r?.addEventListener("abort",l,{once:!0});try{for(;;){if(r?.aborted)throw new DOMException("Aborted","AbortError");let{done:c,value:d}=await i.read();if(c)break;if(!(d instanceof Uint8Array)||s+d.byteLength>t)throw new y("invalid-scene-delta");a.set(d,s),s+=d.byteLength}}finally{r?.removeEventListener("abort",l),i.releaseLock()}if(s!==t)throw new y("invalid-scene-delta");return a}async#i(e,t,r){if(e.byteLength<we||e.byteLength>we+de||t.buffer.byteLength>de)throw new y("invalid-scene-delta");let n=new DataView(e),i=new TextDecoder().decode(new Uint8Array(e,0,8)),a=n.getUint16(8,!0),s=n.getUint16(10,!0),l=Cr(n.getBigUint64(12,!0),"invalid-scene-delta"),c=Cr(n.getBigUint64(20,!0),"invalid-scene-delta"),d=n.getUint32(28,!0),u=n.getUint32(32,!0);if(i!=="MATICDLT"||a!==1||s!==1||l!==t.revision||c<=t.revision||d<24||d>de||u>de||u+we!==e.byteLength)throw new y("invalid-scene-delta");let h=new Uint8Array(e,we,u),f=new Uint8Array(t.buffer),$=(await this.#a(h,Math.max(f.byteLength,d),r)).slice(),g=1024*1024;for(let k=0;k<f.byteLength;k+=g){if(r?.aborted)throw new DOMException("Aborted","AbortError");let C=Math.min(f.byteLength,k+g);for(let A=k;A<C;A+=1)$[A]=($[A]??0)^(f[A]??0);C<f.byteLength&&await new Promise(A=>window.setTimeout(A,0))}let w=$.slice(0,d).buffer;return{parsed:{...await this.#t.parse(w,r),revision:c,etag:null,source:"live"},revision:c}}async sceneDelta(e,t,r,n){let i=e.includes("?")?"&":"?",a=await this.#o(`${e}${i}since=${encodeURIComponent(t.revision)}`,{headers:{Accept:"application/vnd.matic.slam-delta, application/vnd.matic.slam-scene"}},V.delta,n),s=Mr(a,t.revision),l=Ar(a,r);if(a.status===204){if(s!==t.revision)throw new y("invalid-scene-delta-revision");return{scene:null,floorCoherent:l,revision:s,notModified:!0}}if(!a.ok)throw new T("delta-request-failed",a.status);if(s<=t.revision)throw new y("invalid-scene-delta-revision");let c=Number(a.headers.get("Content-Length"));if(Number.isFinite(c)&&c>we+de)throw new y("invalid-scene-delta-size");let d=a.headers.get("Content-Type")?.split(";",1)[0],u=await a.arrayBuffer();if(d==="application/vnd.matic.slam-delta"){let f=Number(a.headers.get("X-Matic-Base-Revision"));if(!Number.isSafeInteger(f)||f!==t.revision)throw new y("invalid-scene-delta-base");let v=await this.#i(u,t,n);if(v.revision!==s)throw new y("invalid-scene-delta-revision");return{scene:{...v.parsed,etag:a.headers.get("ETag")},floorCoherent:l,revision:s,notModified:!1}}if(d!=="application/vnd.matic.slam-scene")throw new y("invalid-scene-delta-content-type");return{scene:{...await this.#t.parse(u,n),revision:s,etag:a.headers.get("ETag"),source:"live"},floorCoherent:l,revision:s,notModified:!1}}async pose(e,t){return xr(await this.#r(e,V.pose,t))}async history(e,t){return vr(await this.#r(e,V.history,t))}async plans(e,t){return kr(await this.#r(e,V.workflow,t))}async areas(e,t){return _r(await this.#r(e,V.workflow,t))}async saveArea(e,t,r){let n=await this.#r(e,V.mutation,r,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...t.areaId?{area_id:t.areaId}:{},name:t.name,circles:t.circles,cleaning_mode:t.cleaningMode,coverage_setting:t.coverageSetting})});if(!n||typeof n!="object"||typeof n.id!="string")throw new y("invalid-area-save-response");return n.id}async deleteArea(e,t,r){let n=await this.#o(`${e}?area_id=${encodeURIComponent(t)}`,{method:"DELETE",headers:{Accept:"application/json"}},V.mutation,r);if(!n.ok)throw new T("area-delete-failed",n.status)}async service(e,t,r,n){let i=this.#e();if(typeof i?.callService!="function")throw new T("service-unavailable");await i.callService(e,t,r,{entity_id:n})}dispose(){this.#t.dispose()}};var Er=()=>({version:4,view:"top",appearance:"photo",labels:!0,quality:"auto",cameras:{}}),_e=(o,e,t)=>Math.max(e,Math.min(t,o)),Rr=o=>o.replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",Ct=(o,e=4)=>`matic-map-studio:v${e}:${Rr(o)}`,zo=o=>{if(!o||typeof o!="object")return null;let e=o;return["yaw","pitch","zoom","targetX","targetZ"].every(r=>typeof e[r]=="number"&&Number.isFinite(e[r]))?{yaw:_e(e.yaw,-Math.PI,Math.PI),pitch:_e(e.pitch,.18,Math.PI/2-.018),zoom:_e(e.zoom,.01,100),targetX:_e(e.targetX,-1e4,1e4),targetZ:_e(e.targetZ,-1e4,1e4)}:null},Pr=o=>{let e=Er();if(!o||typeof o!="object")return e;let t=o,r=t.view==="three"||t.view==="top"||t.view==="rooms"?t.view:e.view,n=r==="rooms"?"top":r,i=t.quality==="auto"||t.quality==="efficient"||t.quality==="balanced"||t.quality==="maximum"?t.quality:e.quality,a=t.cameras&&typeof t.cameras=="object"?t.cameras:{},s={};for(let l of["three","top"]){let c=zo(a[l]);c&&(s[l]=c)}return{version:4,view:n,appearance:t.appearance==="rooms"||t.appearance==="photo"?t.appearance:e.appearance,labels:typeof t.labels=="boolean"?t.labels:e.labels,quality:i,cameras:s}},Ue=class{#e="local-user";#t=null;load(e){this.#e=Rr(e);try{let t=window.localStorage.getItem(Ct(this.#e));if(t)return Pr(JSON.parse(t));for(let r of[3,2]){let n=window.localStorage.getItem(Ct(this.#e,r));if(n)return Pr(JSON.parse(n))}}catch{}return Er()}schedule(e){this.#t!==null&&window.clearTimeout(this.#t),this.#t=window.setTimeout(()=>{this.#t=null;try{window.localStorage.setItem(Ct(this.#e),JSON.stringify(e))}catch{}},250)}dispose(){this.#t!==null&&window.clearTimeout(this.#t),this.#t=null}},Ir="matic-map-studio:preferred-frontend",zr=()=>{try{return window.localStorage.getItem(Ir)==="v3"?"v3":"v4"}catch{return"v4"}},Mt=o=>{try{return window.localStorage.setItem(Ir,o),!0}catch{return!1}};var b=(o,e,t=null)=>({status:o,value:e,problem:t}),U=o=>o instanceof DOMException&&o.name==="AbortError",te=(o,e)=>o instanceof T||o&&typeof o=="object"&&"code"in o&&typeof o.code=="string"?o.code:e,We=o=>[o.selectedFloorOrdinal??"none",o.mapFloorOrdinal??"none",o.mapFloorCoherent?"coherent":"transition"].join(":"),He=o=>[o.mapFloorOrdinal??"none",o.mapSessionVerified?"verified":"unverified",o.mapSessionKey??"no-session"].join(":"),W=o=>[o.entryId,o.selectedFloorOrdinal??"none",o.mapFloorOrdinal??"none"].join("|"),Tr=o=>[o.entryId,We(o),He(o),o.mapRevision].join("|"),Lr=o=>o.runnerLocked||o.stopSettlePending||o.activePlan||o.nativeReconciliationPending||o.nativeSessionActive===!0,To=(o,e)=>o.entryKey===e.entryKey&&o.generation===e.generation&&o.floorKey===e.floorKey&&o.missionKey===e.missionKey,Dr="Live map updates paused while the current map is rechecked.",Or="Reconnecting. The last verified map remains read only.",Lo=1e3,At=(o,e)=>o.label?o.label:o.active?"Current floor":`Saved floor ${o.ordinal??e}`,Be=class{#e;#t=new Me;#o;#r=new Ue;#a=new Map;#i=null;#l;#c=null;#u=null;#s=null;#b=!1;#p=!1;#g=!1;#m="";#w=0;#f="";#d=!1;#_=!0;constructor(e,t){this.#e=e,this.#o=t}sync(e,t){if(this.#d)return;let r=this.#_;if(this.#_=e.host.connected,this.#i=e,this.#l=t,this.#e.patch({host:e.host,activity:e.activity,batteryPercent:e.batteryPercent,robotLabel:e.robotLabel,robots:e.robots,locale:e.language}),e.userKey!==this.#f){this.#f=e.userKey;let n=this.#r.load(e.userKey);this.#e.patch({view:n.view,appearance:n.appearance,labelsVisible:n.labels,quality:n.quality,cameras:n.cameras})}if(!e.host.administrator){this.#k(),this.#h("access-required");return}if(!e.host.connected){this.#k();let n=this.#e.value,i=n.resources.scene.value;this.#e.patch({coherence:i?"degraded":"unavailable",resources:{...n.resources,pose:b("idle",null)},map:{...n.map,available:i!==null,exactPose:!1},notice:i?{tone:"warning",text:Or}:n.notice});return}if(e.host.robotCount===0){this.#k(),this.#h("map-unavailable");return}if(this.#x(),!r){this.#e.value.notice?.text===Or&&this.#e.patch({notice:null}),this.refreshCatalog(!0);return}(this.#e.value.resources.catalog.status==="idle"||e.entryKey&&e.entryKey!==this.#e.value.selection.entryId)&&this.refreshCatalog(!0)}schedulePreferences(e){this.#r.schedule(e)}#x(){this.#c===null&&(this.#c=window.setInterval(()=>{document.visibilityState==="visible"&&this.refreshCatalog()},5e3)),this.#u===null&&(this.#u=window.setInterval(()=>{document.visibilityState==="visible"&&this.refreshPose()},Lo))}#k(){this.#c!==null&&window.clearInterval(this.#c),this.#u!==null&&window.clearInterval(this.#u),this.#c=null,this.#u=null}#n(e){this.#a.get(e)?.abort();let t=new AbortController;return this.#a.set(e,t),t}#y(e,t){this.#a.get(e)===t&&this.#a.delete(e)}#v(e=[]){for(let[t,r]of this.#a)e.includes(t)||(r.abort(),this.#a.delete(t))}#h(e){this.#v(),this.#t.invalidate(),this.#m="";let t=this.#e.value;this.#e.patch({generation:this.#t.generation,coherence:t.host.administrator?"unavailable":"blocked",fullMap:!1,precisionOpen:!1,resources:{catalog:b("error",null,e),entry:null,scene:b("idle",null),pose:b("idle",null),history:b("idle",null),plans:b("idle",null),areas:b("idle",null)},map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1},selection:{...t.selection,entryId:null,floorId:"current",historyId:null}})}async refreshCatalog(e=!1){if(this.#d||this.#b||!this.#i?.host.administrator)return;this.#b=!0;let t=this.#n("catalog"),r=this.#e.value.resources.catalog.value;this.#e.patch({resources:{...this.#e.value.resources,catalog:b("loading",r)}});try{let n=await this.#o.catalog(t.signal);if(t.signal.aborted||this.#d)return;let i=this.#l?.config?.entry_id,a=typeof i=="string"?i:null,s=n.find(d=>d.entryId===this.#i?.entryKey)||n.find(d=>d.entryId===a)||n[0]||null,l=this.#e.value.resources.entry;if(s&&l&&W(s)===W(l)&&We(s)===We(l)&&He(s)===He(l)&&s.mapRevision<l.mapRevision&&(s={...s,mapRevision:l.mapRevision}),this.#e.patch({managedLock:s?Lr(s):!1,resources:{...this.#e.value.resources,catalog:b(n.length?"ready":"empty",n),entry:s}}),!s){this.#h("no-loaded-robot");return}if(this.#e.value.selection.floorId!=="current"&&!e)return;let c=Tr(s);if(!e&&c===this.#m){let d=this.#e.value,u=s.mapFloorCoherent&&s.mapSessionVerified,h=s.health==="problem"||s.health==="limited";this.#e.patch({coherence:u?h?"degraded":"current":"verifying",map:{...d.map,available:u&&d.resources.scene.value!==null,complete:s.mapComplete&&!s.mapTruncated,floorCoherent:s.mapFloorCoherent,sessionVerified:s.mapSessionVerified,exactPose:u?d.map.exactPose:!1},floor:{...d.floor,classifiedCount:Math.max(1,s.historyFloorCount)}});return}this.#m=c,this.#S(s)}catch(n){if(U(n))return;this.#e.patch({coherence:this.#e.value.resources.scene.value?"degraded":"unavailable",resources:{...this.#e.value.resources,catalog:b("error",r,te(n,"catalog-unavailable"))}})}finally{this.#y("catalog",t),this.#b=!1}}#S(e){let t=this.#e.value,r=t.resources.entry,n=!!(r&&W(r)===W(e)),i=e.mapFloorCoherent&&e.mapSessionVerified;this.#v(n?["catalog","plans","areas","plan-mutation","area-mutation"]:["catalog"]);let a=n?t.resources.scene.value:null,s=t.resources.pose.value,l=n&&i&&e.mapSessionKey!==null&&s?.position&&s.mapSessionKey===e.mapSessionKey?s:null,c=this.#t.begin(e.entryId,We(e),He(e),e.mapRevision),d=e.health==="problem"||e.health==="limited",u=this.#e.value;this.#e.patch({managedLock:Lr(e),generation:c.generation,coherence:i?d?"degraded":"current":"verifying",dataMode:"live",resources:{...u.resources,entry:e,scene:b(i?"loading":"idle",a),pose:b(i?"loading":"idle",l),history:b("loading",u.resources.history.value),plans:n?u.resources.plans:b("idle",null),areas:n?u.resources.areas:b("idle",null)},map:{available:i&&a!==null,complete:e.mapComplete&&!e.mapTruncated,floorCoherent:e.mapFloorCoherent,sessionVerified:e.mapSessionVerified,exactPose:i&&l!==null},floor:{classifiedCount:Math.max(1,e.historyFloorCount),displayName:e.selectedFloorOrdinal?`Floor ${e.selectedFloorOrdinal}`:"Current floor",readOnly:!1},selection:{...u.selection,entryId:e.entryId,floorId:"current",historyId:null,roomIds:n?u.selection.roomIds:[],planId:n?u.selection.planId:null,areaId:n?u.selection.areaId:null}}),this.#z(e,c),i&&(this.#$(e,c),this.#M(e,c))}async#$(e,t){let r=this.#n("scene");try{let n=await this.#o.scene(e.sceneUrl,e.mapRevision,e.mapFloorCoherent,"live",r.signal);if(!this.#t.accepts(t)||n.revision!==t.revision||!n.floorCoherent||!n.scene)return;let i=this.#e.value;if(this.#e.patch({resources:{...i.resources,scene:b("ready",n.scene)},map:{...i.map,available:!0},notice:i.notice?.text===Dr?null:i.notice}),e.deltaUrl){let a=++this.#w;this.#P(e,t,n.scene,a)}}catch(n){if(U(n)||!this.#t.accepts(t))return;if(n instanceof T&&n.code==="request-timeout"){let l=this.#e.value;this.#e.patch({resources:{...l.resources,scene:b("loading",l.resources.scene.value,"scene-building")}}),window.setTimeout(()=>{this.#d||!this.#t.accepts(t)||this.#e.value.selection.floorId!=="current"||this.#$(e,t)},250);return}let i=this.#e.value,a=i.resources.pose.value,s=i.resources.scene.value!==null&&e.mapSessionKey!==null&&a?.position!==null&&a?.mapSessionKey===e.mapSessionKey;this.#e.patch({coherence:"degraded",resources:{...i.resources,scene:b("error",i.resources.scene.value,te(n,"scene-unavailable"))},map:{...i.map,available:i.resources.scene.value!==null,exactPose:s}})}finally{this.#y("scene",r)}}async#P(e,t,r,n){if(!e.deltaUrl||typeof DecompressionStream!="function")return;let i=e.deltaUrl,a=e,s=t,l=r;try{for(;!this.#d&&n===this.#w&&this.#t.accepts(s)&&this.#e.value.selection.floorId==="current";){let c=this.#n("delta");try{let d=await this.#o.sceneDelta(i,l,a.mapFloorCoherent,c.signal);if(c.signal.aborted||this.#d||n!==this.#w||!this.#t.accepts(s))return;if(!d.floorCoherent){this.#e.patch({coherence:"verifying",map:{...this.#e.value.map,available:!1,floorCoherent:!1,exactPose:!1},resources:{...this.#e.value.resources,pose:b("idle",null)}}),this.#m="",this.refreshCatalog(!0);return}if(d.notModified||!d.scene){await new Promise(f=>window.setTimeout(f,100));continue}let u=this.#t.advance(s,d.revision);if(!u)return;s=u,l=d.scene,a={...a,mapRevision:d.revision},this.#m=Tr(a);let h=this.#e.value;this.#e.patch({resources:{...h.resources,entry:a,scene:b("ready",l)},map:{...h.map,available:!0,floorCoherent:!0}}),this.#M(a,s)}finally{this.#y("delta",c)}}}catch(c){if(U(c)||this.#d||n!==this.#w||!this.#t.accepts(s))return;this.#e.patch({coherence:"degraded",notice:{tone:"warning",text:Dr}}),this.#m="",this.refreshCatalog(!0)}}async#z(e,t){let r=this.#n("history");try{let n=await this.#o.history(e.historyUrl,r.signal);if(!this.#t.accepts(t)||n.entryId!==e.entryId)return;let i=n.floors.find(a=>a.active)||n.floors[0];if(!i)return;this.#e.patch({resources:{...this.#e.value.resources,history:b("ready",n)},floor:{...this.#e.value.floor,classifiedCount:n.floors.length,displayName:At(i,1)}})}catch(n){if(U(n)||!this.#t.accepts(t))return;this.#e.patch({resources:{...this.#e.value.resources,history:b("error",null,te(n,"history-unavailable"))}})}finally{this.#y("history",r)}}async refreshPose(){let e=this.#e.value.resources.entry,t=this.#t.current();!e||!t||this.#e.value.selection.floorId!=="current"||!e.mapFloorCoherent||!e.mapSessionVerified||await this.#M(e,t)}async#M(e,t){if(this.#p){this.#g=!0;return}this.#p=!0;let r=this.#n("pose");try{let n=await this.#o.pose(e.poseUrl,r.signal),i=this.#t.current(),a=this.#e.value.resources.entry;if(!i||!To(t,i)||!a||!n.floorCoherent)return;if(n.mapSessionKey===null||n.mapSessionKey!==a.mapSessionKey){this.#e.patch({map:{...this.#e.value.map,exactPose:!1}}),this.#m="",this.refreshCatalog(!0);return}let s=this.#e.value,l=s.resources.pose.value,c=!!(s.map.exactPose&&l?.position&&l.mapSessionKey===a.mapSessionKey);if(n.position===null&&c){this.#e.patch({resources:{...s.resources,pose:b("ready",l)}});return}this.#e.patch({resources:{...s.resources,pose:b("ready",n)},map:{...s.map,exactPose:n.position!==null}})}catch(n){if(U(n)||!this.#t.accepts(t))return;let i=this.#e.value,a=i.resources.pose.value,s=!!(i.map.exactPose&&a?.position&&a.mapSessionKey===i.resources.entry?.mapSessionKey);this.#e.patch({resources:{...i.resources,pose:b("error",s?a:null,te(n,"pose-unavailable"))},map:{...i.map,exactPose:s}})}finally{if(this.#y("pose",r),this.#p=!1,this.#g&&!this.#d){this.#g=!1;let n=this.#e.value.resources.entry,i=this.#t.current();n&&i&&this.#M(n,i)}}}async selectFloor(e){let t=this.#e.value.resources.history.value,r=this.#e.value.resources.entry;if(!t||!r)return;let n=t.floors.find(s=>s.id===e);if(!n)return;if(n.active){this.#m="",this.#e.dispatch({type:"set-floor",floorId:"current"}),await this.refreshCatalog(!0);return}let i=n.snapshots.at(-1);this.#v(["catalog"]);let a=this.#t.begin(r.entryId,n.id,i?.id||n.id,i?.revision||0);this.#e.patch({generation:a.generation,coherence:"current",dataMode:"history",floor:{classifiedCount:t.floors.length,displayName:At(n,t.floors.indexOf(n)+1),readOnly:!0},selection:{...this.#e.value.selection,floorId:n.id,historyId:i?.id||null},resources:{...this.#e.value.resources,scene:b(i?"loading":"empty",null),pose:b("idle",null)},map:{available:!1,complete:!0,floorCoherent:!0,sessionVerified:!0,exactPose:!1}}),i&&await this.#R(i,a)}async selectHistory(e){let t=this.#e.value.resources.history.value,r=this.#e.value.resources.entry;if(!t||!r)return;if(!e){await this.selectFloor("current");return}let n=t.floors.find(s=>s.snapshots.some(l=>l.id===e)),i=n?.snapshots.find(s=>s.id===e);if(!n||!i)return;let a=this.#t.begin(r.entryId,n.id,i.id,i.revision);this.#v(["catalog"]),this.#e.patch({generation:a.generation,dataMode:"history",floor:{classifiedCount:t.floors.length,displayName:At(n,t.floors.indexOf(n)+1),readOnly:!0},selection:{...this.#e.value.selection,floorId:n.id,historyId:i.id},resources:{...this.#e.value.resources,scene:b("loading",null),pose:b("idle",null)},map:{...this.#e.value.map,available:!1,exactPose:!1}}),await this.#R(i,a)}async#R(e,t){let r=this.#n("history-scene");try{let n=await this.#o.scene(e.sceneUrl,e.revision,!0,"history",r.signal);if(!this.#t.accepts(t)||!n.scene)return;this.#e.patch({resources:{...this.#e.value.resources,scene:b("ready",n.scene)},map:{...this.#e.value.map,available:!0,exactPose:!1}})}catch(n){if(U(n)||!this.#t.accepts(t))return;this.#e.patch({resources:{...this.#e.value.resources,scene:b("error",null,te(n,"history-scene-unavailable"))}})}finally{this.#y("history-scene",r)}}async openWorkflow(e){this.#e.dispatch({type:"open-workflow",workflow:e}),(e==="plan"||e==="rooms")&&await this.loadPlans(),(e==="draw"||e==="areaReview")&&await this.loadAreas()}async loadPlans(){let e=this.#e.value.resources.entry;if(!e||!this.#t.current()||!Ge(this.#e.value))return;let t=W(e),r=this.#n("plans");this.#e.patch({resources:{...this.#e.value.resources,plans:b("loading",null)}});try{let n=await this.#o.plans(e.plansUrl,r.signal),i=this.#e.value.resources.entry;if(!i||W(i)!==t)return;this.#e.patch({resources:{...this.#e.value.resources,plans:b("ready",n)},selection:{...this.#e.value.selection,planId:n.selectedPlan||n.plans[0]?.id||null}}),this.selectPlan(n.selectedPlan||n.plans[0]?.id||null)}catch(n){let i=this.#e.value.resources.entry;if(U(n)||!i||W(i)!==t)return;this.#e.patch({resources:{...this.#e.value.resources,plans:b("error",null,te(n,"plans-unavailable"))}})}finally{this.#y("plans",r)}}selectPlan(e){let t=this.#e.value.resources.plans.value?.plans.find(r=>r.id===e);this.#e.patch({selection:{...this.#e.value.selection,planId:e},planDraft:t?this.#E(t):{...this.#e.value.planDraft,id:null,name:"",rooms:[],dirty:!1}})}#E(e){return{id:e.id,name:e.name,enabled:e.enabled,runBehavior:e.runBehavior,rooms:(e.roomOrder.length?e.roomOrder.flatMap(t=>{let r=e.rooms.find(n=>n.roomId===t);return r?[r]:[]}):e.rooms).map(t=>({...t})),returnToBase:e.returnToBase,finishCurrentRoom:e.finishCurrentRoom,finishCurrentRoomThreshold:e.finishCurrentRoomThreshold,dirty:!1}}async loadAreas(){let e=this.#e.value.resources.entry;if(!e||!this.#t.current()||!Ge(this.#e.value))return;let t=W(e),r=this.#n("areas");this.#e.patch({resources:{...this.#e.value.resources,areas:b("loading",null)}});try{let n=await this.#o.areas(e.areasUrl,r.signal),i=this.#e.value.resources.entry;if(!i||W(i)!==t||n.sceneUrl!==i.sceneUrl)return;this.#e.patch({resources:{...this.#e.value.resources,areas:b("ready",n)}}),this.selectArea(n.areas[0]?.id||null)}catch(n){let i=this.#e.value.resources.entry;if(U(n)||!i||W(i)!==t)return;this.#e.patch({resources:{...this.#e.value.resources,areas:b("error",null,te(n,"areas-unavailable"))}})}finally{this.#y("areas",r)}}selectArea(e){let t=this.#e.value.resources.areas.value?.areas.find(n=>n.id===e),r=this.#e.value;this.#e.patch({selection:{...r.selection,areaId:e},areaDraft:t?this.#I(t):{id:null,name:"",cleaningMode:"vacuum",coverageSetting:"standard",status:"new",canRebind:!1,dirty:!1},draw:{...r.draw,circles:t?.circles||[],undo:[],redo:[],dirty:!1,strokeCount:0}})}#I(e){return{id:e.id,name:e.name,cleaningMode:e.cleaningMode,coverageSetting:e.coverageSetting,status:e.status,canRebind:e.canRebind,dirty:!1}}async saveArea(){let e=this.#e.value,t=e.resources.entry,r=e.areaDraft;if(!t||!B(e)||!r.name.trim()||!e.draw.circles.length)return;let n=this.#n("area-mutation");this.#e.patch({command:"pending",notice:{tone:"info",text:"Saving area\u2026"}});try{let i=await this.#o.saveArea(t.areasUrl,{areaId:r.id,name:r.name.trim(),circles:e.draw.circles,cleaningMode:r.cleaningMode,coverageSetting:r.coverageSetting},n.signal);this.#e.patch({command:"idle",notice:{tone:"success",text:"Area saved"}}),await this.loadAreas(),this.selectArea(i)}catch(i){if(U(i))return;this.#e.patch({command:"failed",notice:{tone:"error",text:"Area could not be saved"}})}finally{this.#y("area-mutation",n)}}async deleteArea(){let e=this.#e.value.resources.entry,t=this.#e.value.selection.areaId;if(!e||!t||!B(this.#e.value))return;let r=this.#n("area-mutation");try{await this.#o.deleteArea(e.areasUrl,t,r.signal),this.#e.patch({notice:{tone:"success",text:"Area deleted"}}),await this.loadAreas()}catch(n){U(n)||this.#e.patch({notice:{tone:"error",text:"Area could not be deleted"}})}finally{this.#y("area-mutation",r)}}async savePlan(){let e=this.#e.value,t=e.planDraft,r=e.resources.plans.value;if(!r||!t.name.trim()||!t.rooms.length||!B(e))return;let n=t.rooms;await this.#A("save_plan",{...t.id?{plan_id:t.id}:{},name:t.name.trim(),enabled:t.enabled,run_behavior:t.runBehavior,rooms:n.map(i=>({room:r.rooms.find(a=>a.roomId===i.roomId)?.name,cleaning_mode:i.cleaningMode,coverage_setting:i.coverageSetting})).filter(i=>i.room),return_to_base:t.returnToBase,finish_current_room:t.finishCurrentRoom,finish_current_room_threshold:t.finishCurrentRoomThreshold,select:!t.id||r.selectedPlan===t.id},"Plan saved","Plan could not be saved"),await this.loadPlans()}async deletePlan(){let e=this.#e.value.selection.planId;e&&(await this.#A("delete_plan",{plan:e},"Plan deleted","Plan could not be deleted"),await this.loadPlans())}async executeAction(e){switch(e){case"stop":this.#e.value.resources.entry?.activePlan||this.#e.value.resources.entry?.runnerLocked?await this.#C("matic_robot","stop_intelligent_cleaning",{}):await this.#C("vacuum","return_to_base",{});return;case"resume":await this.#C("vacuum","start",{});return;case"run-plan":{let t=this.#e.value.selection.planId||this.#e.value.resources.plans.value?.selectedPlan;t&&await this.#C("matic_robot","run_selected_plan",{plan:t});return}case"clean-rooms":{let t=this.#e.value.resources.plans.value,r=this.#e.value.selection.roomIds,n=t?.rooms.filter(i=>r.includes(i.roomId)).map(i=>i.name)||[];n.length&&await this.#C("matic_robot","clean",{rooms:n,ordered:!1,cleaning_mode:this.#e.value.selection.cleaningMode,coverage_setting:this.#e.value.selection.coverageSetting});return}case"run-area":{let t=this.#e.value.selection.areaId;t&&await this.#C("matic_robot","clean_area",{area:t});return}case"review-area":this.#e.dispatch({type:"open-workflow",workflow:"areaReview"});return;case"save-area":await this.saveArea();return;case"save-plan":await this.savePlan();return;case"delete-plan":await this.deletePlan();return;case"delete-area":await this.deleteArea();return}}async#A(e,t,r,n){let i=this.#i?.vacuumEntityId;if(!(!i||!B(this.#e.value)||this.#e.value.command==="pending")){this.#e.patch({command:"pending",notice:{tone:"info",text:"Saving\u2026"}});try{await this.#o.service("matic_robot",e,t,i),this.#e.patch({command:"idle",notice:{tone:"success",text:r}})}catch{this.#e.patch({command:"failed",notice:{tone:"error",text:n}})}}}async#C(e,t,r){let n=this.#e.value,i=this.#i?.vacuumEntityId,s=(t==="stop_intelligent_cleaning"||e==="vacuum"&&t==="return_to_base")&&n.command==="idle"&&(n.activity==="cleaning"||n.activity==="paused"||n.activity==="returning");if(!(!i||!s&&!oe(n))){this.#e.patch({command:"pending",notice:null});try{await this.#o.service(e,t,r,i),this.#e.patch({command:"settling"}),this.#s!==null&&window.clearTimeout(this.#s),this.#s=window.setTimeout(()=>{this.#s=null,this.#e.value.command==="settling"&&this.#e.patch({command:"idle"})},15e3)}catch{this.#e.patch({command:"failed",notice:{tone:"error",text:"The robot did not accept that action"}})}}}updateDraftCircles(e,t=!0,r){this.#e.dispatch({type:"set-draft-circles",circles:e,record:t,...r?{previous:r}:{}}),this.#e.dispatch({type:"patch-area-draft",patch:{dirty:!0}})}dispose(){this.#d||(this.#d=!0,this.#k(),this.#v(),this.#s!==null&&window.clearTimeout(this.#s),this.#s=null,this.#r.dispose(),this.#o.dispose(),this.#t.invalidate())}};var Nr=o=>(o.workflow==="none"?0:1)+(o.fullMap?1:0)+(o.precisionOpen?1:0)+(o.dialog?1:0),Do=o=>{if(!o||typeof o!="object")return null;let e=o.maticMapLayer;if(!e||typeof e!="object")return null;let t=e.owner,r=e.depth;return typeof t=="string"&&Number.isInteger(r)&&Number(r)>=0?{owner:t,depth:Number(r)}:null},Fe=class{#e;#t=`matic-map-${crypto.randomUUID?.()||Math.random().toString(36).slice(2)}`;#o=0;#r=null;#a=!1;constructor(e){this.#e=e}start(){this.#r||(this.#o=Nr(this.#e.value),this.#r=this.#e.subscribe(e=>this.#i(e)),window.addEventListener("popstate",this.#l))}#i(e){let t=Nr(e);if(this.#a){this.#a=!1,this.#o=t;return}if(t>this.#o)for(let r=this.#o+1;r<=t;r+=1){let n=history.state&&typeof history.state=="object"?history.state:{};history.pushState({...n,maticMapLayer:{owner:this.#t,depth:r}},"",window.location.href)}this.#o=t}#l=()=>{this.#o<1||(this.#a=!0,this.#e.dispatch({type:"dismiss-top-layer"}))};dismissTop(){if(this.#o<1)return!1;let e=Do(history.state);return e?.owner===this.#t&&e.depth===this.#o?history.back():this.#e.dispatch({type:"dismiss-top-layer"}),!0}dispose(){this.#r?.(),this.#r=null,window.removeEventListener("popstate",this.#l),this.#o=0}};var Pt=class extends x{constructor(){super(...arguments);this.narrow=!1;this._workspace=M();this._classic=!1;this.entryOverride=null;this.#e=new Pe;this.#t=new ne(this._workspace);this.#o=null;this.#r=null;this.#a=null;this.#i=null;this.#l=null;this.#c=""}static{this.properties={hass:{attribute:!1},narrow:{type:Boolean},route:{attribute:!1},panel:{attribute:!1},_workspace:{state:!0},_classic:{state:!0},entryOverride:{state:!0}}}#e;#t;#o;#r;#a;#i;#l;#c;connectedCallback(){super.connectedCallback(),this._classic=zr()==="v3",this.#r=this.#t.subscribe(t=>{this._workspace=t,this.#b(t)}),this._classic||this.#u()}disconnectedCallback(){this.#r?.(),this.#r=null,this.#s(),super.disconnectedCallback()}#u(){this.#i||(this.#a=new Ne(()=>this.hass),this.#i=new Be(this.#t,this.#a),this.#l=new Fe(this.#t),this.#l.start(),this.#o&&this.#i.sync(this.#o,this.panel))}#s(){this.#l?.dispose(),this.#l=null,this.#i?.dispose(),this.#i=null,this.#a=null}#b(t){if(!this.#i)return;let r={version:4,view:t.view,appearance:t.appearance,labels:t.labelsVisible,quality:t.quality,cameras:t.cameras},n=JSON.stringify(r);n!==this.#c&&(this.#c=n,this.#i.schedulePreferences(r))}willUpdate(t){if(t.has("hass")||t.has("panel")||t.has("entryOverride")){let r=this.#e.project(this.hass,this.panel,this.entryOverride);if(r!==this.#o){this.#o=r;let n=r.host.connected?r.host.robotCount===0?"unavailable":r.host.administrator?"verifying":"blocked":"degraded";this.#t.replace({...this.#t.value,coherence:n,activity:r.activity,batteryPercent:r.batteryPercent,host:r.host,fullMap:r.host.administrator&&r.host.robotCount>0&&this.#t.value.fullMap,robotLabel:r.robotLabel,robots:r.robots,locale:r.language})}this._classic||this.#i?.sync(r,this.panel)}t.has("narrow")&&this.#t.value.narrowHint!==this.narrow&&this.#t.dispatch({type:"set-narrow-hint",value:this.narrow})}#p(t){if(!Ce(t.detail))return;t.stopPropagation();let r=t.detail;if(r.type==="dismiss-top-layer"||r.type==="exit-full-map"){this.#l?.dismissTop()||this.#t.dispatch(r);return}if(r.type==="open-workflow"&&r.workflow!=="none"){this.#i?.openWorkflow(r.workflow);return}if(r.type==="set-floor"){this.#i?.selectFloor(r.floorId);return}if(r.type==="select-entry"){if(!this._workspace.robots.some(n=>n.entryId===r.entryId))return;this.entryOverride=r.entryId;return}if(r.type==="set-history"){this.#i?.selectHistory(r.historyId);return}if(r.type==="select-plan"){this.#i?.selectPlan(r.planId);return}if(r.type==="select-area"){this.#i?.selectArea(r.areaId);return}this.#t.dispatch(r)}#g(t){if(t.stopPropagation(),typeof t.detail?.id=="string"){if(t.detail.id==="use-classic"){Mt("v3")&&(this.#s(),this._classic=!0);return}this.#i?.executeAction(t.detail.id),this.dispatchEvent(new CustomEvent("matic-map-v4-action-requested",{detail:{id:t.detail.id},bubbles:!0,composed:!0}))}}#m(){Mt("v4")&&(this._classic=!1,this.#u(),this.requestUpdate())}updated(){if(!this._classic)return;let t=this.renderRoot.querySelector("matic-map-panel-v0-3-1");t&&(t.hass=this.hass,t.narrow=this.narrow,t.route=this.route,t.panel=this.panel)}getWorkspaceSnapshot(){return this.#t.value}render(){return this._classic?p`
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
          <button class="return-v4" type="button" @click=${this.#m}>${P(this.hass?.localize,"v4_use_new","Use Map Studio 0.4")}</button>
          <matic-map-panel-v0-3-1></matic-map-panel-v0-3-1>
        </div>
      `:p`
      <matic-map-shell-v4
        .state=${this._workspace}
        .localize=${this.hass?.localize}
        @matic-workspace-intent=${this.#p}
        @matic-workspace-action=${this.#g}
      ></matic-map-shell-v4>
    `}};customElements.get("matic-map-panel-v0-4-0")||customElements.define("matic-map-panel-v0-4-0",Pt);export{Me as CoherenceMachine,$e as DRAW_BRUSH_MAX_METERS,ue as DRAW_BRUSH_MIN_METERS,tt as GALLERY_SCENARIOS,Pe as HassAdapter,Ze as MAP_PIXELS_PER_METER_AT_100,Se as MAP_ZOOM_MAX,Y as MAP_ZOOM_MIN,Pt as MaticMapPanelV4,xt as MaticMapStudioGalleryV4,ne as WorkspaceStore,Uo as brushCursorPixels,B as canEditCoordinates,Ge as canReadFloorResources,Tt as canShowExactPose,ie as canShowLiveMap,oe as canStartMotion,Wo as commandState,et as createGalleryState,M as initialWorkspaceState,Ce as isWorkspaceIntent,Ot as mapScale,Hr as normalizeBrush,zt as normalizeZoom,Br as reduceWorkspace,Dt as selectPausedSecondaryAction,Lt as selectPrimaryAction};
/*! Bundled license information:

@lit/reactive-element/css-tag.js:
  (**
   * @license
   * Copyright 2019 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

@lit/reactive-element/reactive-element.js:
lit-html/lit-html.js:
lit-element/lit-element.js:
  (**
   * @license
   * Copyright 2017 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

lit-html/is-server.js:
  (**
   * @license
   * Copyright 2022 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/
