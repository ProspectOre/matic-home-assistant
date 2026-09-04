var S1=100,o5=1e3,n1=.2,f1=2.5,m2=64,W1=e=>!e||typeof e!="object"?!1:typeof e.type=="string";var A1=()=>({status:"idle",value:null,problem:null}),G=(e,C,H)=>Math.max(C,Math.min(H,e)),f0=e=>({yaw:G(Number.isFinite(e.yaw)?e.yaw:0,-Math.PI,Math.PI),pitch:G(Number.isFinite(e.pitch)?e.pitch:Math.PI/2-.018,.18,Math.PI/2-.018),zoom:G(Number.isFinite(e.zoom)?e.zoom:1,.01,100),targetX:G(Number.isFinite(e.targetX)?e.targetX:0,-1e4,1e4),targetZ:G(Number.isFinite(e.targetZ)?e.targetZ:0,-1e4,1e4)}),i5=e=>Math.round(G(Number.isFinite(e)?e:100,100,1e3)),g0=e=>Math.round(G(Number.isFinite(e)?e:.2,.2,2.5)*100)/100,k=()=>({generation:0,coherence:"verifying",dataMode:"live",activity:"unknown",workflow:"none",command:"idle",fullMap:!1,precisionOpen:!1,dialog:null,narrowHint:!1,view:"top",appearance:"photo",labelsVisible:!0,quality:"auto",cameras:{},managedLock:!1,batteryPercent:null,floor:{classifiedCount:1,displayName:"Current floor",readOnly:!1},map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1},host:{connected:!0,administrator:!0,robotConnected:!1,robotCount:0},draw:{zoomPercent:100,zoomOriginX:50,zoomOriginY:50,brushMeters:.6,tool:"paint",dirty:!1,strokeCount:0,circles:[],undo:[],redo:[]},resources:{catalog:A1(),entry:null,scene:A1(),pose:A1(),history:A1(),plans:A1(),areas:A1()},selection:{entryId:null,floorId:"current",historyId:null,roomIds:[],roomSettings:[],cleaningMode:"vacuum",coverageSetting:"standard",planId:null,areaId:null},planDraft:{id:null,name:"",enabled:!0,runBehavior:"intelligent",rooms:[],returnToBase:!0,finishCurrentRoom:!1,finishCurrentRoomThreshold:50,dirty:!1},areaDraft:{id:null,name:"",cleaningMode:"vacuum",coverageSetting:"standard",status:"new",canRebind:!1,dirty:!1},notice:null,robotLabel:"Matic robot",robots:[],locale:"en"}),W=(e,C)=>({...e,draw:{...e.draw,...C}}),y0=(e,C)=>{switch(C.type){case"set-host":return{...e,host:C.host,fullMap:C.host.administrator&&C.host.robotCount>0?e.fullMap:!1};case"set-operational-state":return{...e,coherence:C.coherence,activity:C.activity,command:C.command??e.command};case"set-narrow-hint":return{...e,narrowHint:C.value};case"set-view":return{...e,view:C.view};case"set-appearance":return{...e,appearance:C.appearance};case"set-quality":return{...e,quality:C.quality};case"set-camera":return{...e,cameras:{...e.cameras,[C.view]:f0(C.camera)}};case"toggle-labels":return{...e,labelsVisible:!e.labelsVisible};case"open-workflow":return{...e,workflow:C.workflow,precisionOpen:!1};case"enter-full-map":return e.host.administrator&&e.host.robotCount>0&&e.map.available?{...e,fullMap:!0}:e;case"exit-full-map":return{...e,fullMap:!1,precisionOpen:!1};case"set-precision-open":return{...e,precisionOpen:C.value};case"set-zoom":return W(e,{zoomPercent:i5(C.value),...C.originX===void 0?{}:{zoomOriginX:G(C.originX,0,100)},...C.originY===void 0?{}:{zoomOriginY:G(C.originY,0,100)}});case"step-zoom":return W(e,{zoomPercent:i5(e.draw.zoomPercent*C.factor)});case"fit-map":return W(e,{zoomPercent:100,zoomOriginX:50,zoomOriginY:50});case"set-brush":return W(e,{brushMeters:g0(C.value)});case"set-draw-tool":return W(e,{tool:C.tool});case"mark-draft":{let H=Math.max(0,e.draw.strokeCount+C.strokeDelta);return W(e,{dirty:H>0,strokeCount:H})}case"undo-draft":{let H=e.draw.undo.at(-1);return H?W(e,{circles:H,undo:e.draw.undo.slice(0,-1),redo:[...e.draw.redo,e.draw.circles],dirty:!0,strokeCount:Math.max(0,e.draw.strokeCount-1)}):e}case"clear-draft":return e.draw.circles.length?W(e,{circles:[],undo:[...e.draw.undo.slice(-99),e.draw.circles],redo:[],dirty:!0,strokeCount:e.draw.strokeCount+1}):e;case"redo-draft":{let H=e.draw.redo.at(-1);return H?W(e,{circles:H,undo:[...e.draw.undo,e.draw.circles],redo:e.draw.redo.slice(0,-1),dirty:!0,strokeCount:e.draw.strokeCount+1}):e}case"set-draft-circles":{let H=C.circles.slice(0,512).map(L=>({...L})),V=C.record!==!1;return W(e,{circles:H,undo:V?[...e.draw.undo.slice(-99),C.previous??e.draw.circles]:e.draw.undo,redo:V?[]:e.draw.redo,dirty:!0,strokeCount:V?e.draw.strokeCount+1:e.draw.strokeCount})}case"discard-draft":return{...W(e,{dirty:!1,strokeCount:0,circles:[],undo:[],redo:[]}),dialog:null,workflow:"none",precisionOpen:!1};case"toggle-room":{let H=e.selection.roomIds.includes(C.roomId);return{...e,selection:{...e.selection,roomIds:H?e.selection.roomIds.filter(V=>V!==C.roomId):[...e.selection.roomIds,C.roomId],roomSettings:H?e.selection.roomSettings.filter(V=>V.roomId!==C.roomId):[...e.selection.roomSettings,{roomId:C.roomId,cleaningMode:"vacuum",coverageSetting:"standard"}]}}}case"patch-room-settings":return{...e,selection:{...e.selection,roomSettings:e.selection.roomSettings.map(H=>H.roomId===C.roomId?{...H,...C.cleaningMode?{cleaningMode:C.cleaningMode}:{},...C.coverageSetting?{coverageSetting:C.coverageSetting}:{}}:H)}};case"set-floor":return{...e,dataMode:C.floorId==="current"?"live":"history",selection:{...e.selection,floorId:C.floorId,historyId:null}};case"select-entry":return e;case"set-history":return{...e,dataMode:C.historyId?"history":"live",selection:{...e.selection,historyId:C.historyId}};case"select-plan":return{...e,selection:{...e.selection,planId:C.planId}};case"select-area":return{...e,selection:{...e.selection,areaId:C.areaId}};case"patch-plan-draft":return{...e,planDraft:{...e.planDraft,...C.patch,dirty:C.patch.dirty??!0}};case"patch-area-draft":return{...e,areaDraft:{...e.areaDraft,...C.patch,dirty:C.patch.dirty??!0}};case"set-notice":return{...e,notice:C.notice};case"open-dialog":return{...e,dialog:C.dialog};case"dismiss-top-layer":return e.dialog?{...e,dialog:null}:e.precisionOpen?{...e,precisionOpen:!1}:e.fullMap?{...e,fullMap:!1}:e.workflow!=="none"?{...e,workflow:"none",precisionOpen:!1}:e;case"return-live":return{...e,dataMode:"live",workflow:"none",floor:{...e.floor,readOnly:!1}}}},d1=class{#C=new Set;#H;constructor(C=k()){this.#H=C}get value(){return this.#H}dispatch(C){let H=y0(this.#H,C);if(H===this.#H)return H;this.#H=H;for(let V of this.#C)V(H);return H}replace(C){if(C!==this.#H){this.#H=C;for(let H of this.#C)H(C)}}patch(C){let H={...this.#H,...C};return this.replace(H),H}subscribe(C){return this.#C.add(C),C(this.#H),()=>this.#C.delete(C)}},N1=class{#C=null;#H=0;get generation(){return this.#H}begin(C,H,V,L){return this.#H+=1,this.#C={entryKey:C,generation:this.#H,floorKey:H,missionKey:V,revision:L},this.#C}current(){return this.#C}accepts(C){let H=this.#C;return!!(H&&C.entryKey===H.entryKey&&C.generation===H.generation&&C.floorKey===H.floorKey&&C.missionKey===H.missionKey&&C.revision===H.revision)}advance(C,H){return!this.accepts(C)||!Number.isSafeInteger(H)||H<=C.revision?null:(this.#C={...C,revision:H},this.#C)}invalidate(){return this.#H+=1,this.#C=null,this.#H}},s1=e=>e.dataMode==="live"&&e.map.available&&(e.coherence==="current"||e.coherence==="degraded")&&e.host.administrator,a5=e=>s1(e)&&(e.coherence==="current"||e.coherence==="degraded")&&e.map.floorCoherent&&e.map.sessionVerified&&e.map.exactPose&&e.host.connected&&e.host.robotConnected,Q=e=>s1(e)&&e.coherence==="current"&&e.map.complete&&e.map.floorCoherent&&e.map.sessionVerified&&e.host.connected&&e.host.robotConnected&&!e.floor.readOnly,v2=e=>s1(e)&&e.coherence==="current"&&e.map.floorCoherent&&e.map.sessionVerified&&e.host.connected&&e.host.robotConnected&&!e.floor.readOnly,l1=e=>Q(e)&&!e.managedLock&&e.command==="idle"&&(e.activity==="idle"||e.activity==="docked"),g1=(e,C,H,V,L)=>({id:e,label:C,labelKey:V,kind:"neutral",enabled:!1,reason:H,reasonKey:L}),n5=e=>{let C=e.command==="idle";return{id:"stop",label:"Stop",labelKey:"v4_action_stop",kind:"danger",enabled:C,...C?{}:{reason:"The robot is already stopping.",reasonKey:"v4_reason_stop"}}},A5=e=>{if(e.dataMode==="history")return{id:"return-live",label:"Return to the live map",labelKey:"v4_action_return_live",kind:"primary",enabled:!0};if(e.activity==="cleaning"||e.activity==="returning"||e.activity==="recharging")return n5(e);if(e.activity==="stopping"||e.command==="settling")return g1("stopping","Stopping","Waiting for the robot to settle.","v4_action_stopping","v4_reason_stopping");if(e.activity==="paused")return{id:"resume",label:"Resume cleaning",labelKey:"v4_action_resume",kind:"primary",enabled:e.command==="idle"};if(!e.host.connected)return g1("reconnecting","Reconnecting","Home Assistant is offline.","v4_action_reconnecting","v4_reason_reconnecting");if(!e.host.administrator)return g1("administrator","Administrator access required","Ask a Home Assistant administrator to open this map.","v4_action_administrator","v4_reason_administrator");if(!e.host.robotConnected)return g1("robot-offline","Robot offline","Reconnect the robot to start cleaning.","v4_action_robot_offline","v4_reason_robot_offline");if(e.coherence!=="current")return g1("locating","Finding the map","Waiting for the robot to confirm which floor it is on.","v4_action_locating","v4_reason_locating");if(e.workflow==="draw"){let C={reason:"Draw the area first.",reasonKey:"v4_reason_save_area_draw"};return e.fullMap||e.narrowHint?{id:"review-area",label:"Name and save",labelKey:"v4_action_review_area",kind:"primary",enabled:e.draw.dirty,...e.draw.dirty?{}:C}:{id:"save-area",label:"Save area",labelKey:"v4_action_save_area",kind:"primary",enabled:e.draw.dirty&&Q(e),...e.draw.dirty?{}:C}}if(e.workflow==="rooms"){let C=e.selection.roomIds.length,H=l1(e)&&C>0;return{id:"clean-rooms",label:C?`Clean ${C} room${C===1?"":"s"}`:"Clean selected rooms",...C?{}:{labelKey:"v4_action_clean_rooms"},kind:"primary",enabled:H,...H?{}:C?{reason:"Waiting for the current map to be verified.",reasonKey:"v4_reason_clean_rooms_verification"}:{reason:"Select at least one room to clean.",reasonKey:"v4_reason_clean_rooms_empty"}}}if(e.workflow==="plan"){if(e.planDraft.dirty||!e.planDraft.id){let C=Q(e)&&e.planDraft.name.trim().length>0&&e.planDraft.rooms.length>0;return{id:"save-plan",label:"Save plan",labelKey:"v4_action_save_plan",kind:"primary",enabled:C,...C?{}:{reason:"Add a plan name and at least one room.",reasonKey:"v4_reason_save_plan"}}}return{id:"run-plan",label:"Run this plan",labelKey:"v4_action_run_plan",kind:"primary",enabled:l1(e)&&e.planDraft.enabled,...l1(e)?{}:{reason:"Waiting for the current map to be verified.",reasonKey:"v4_reason_run_plan"}}}if(e.workflow==="areaReview"){if(e.areaDraft.dirty||e.draw.dirty||!e.areaDraft.id||e.areaDraft.canRebind){let H=Q(e)&&e.areaDraft.name.trim().length>0&&e.draw.circles.length>0;return{id:"save-area",label:e.areaDraft.canRebind?"Confirm on this map":"Save area",labelKey:e.areaDraft.canRebind?"v4_action_save_area_confirm":"v4_action_save_area",kind:"primary",enabled:H,...H?{}:{reason:"Add an area name and at least one mark.",reasonKey:"v4_reason_save_area_details"}}}let C=e.areaDraft.status==="current";return{id:"run-area",label:"Clean this area",labelKey:"v4_action_run_area",kind:"primary",enabled:C&&l1(e),...C?{}:{reason:"Confirm this outline on the current map first.",reasonKey:"v4_reason_run_area"}}}return{id:"choose-cleaning",label:"Choose what to clean",labelKey:"v4_action_choose_cleaning",kind:"neutral",enabled:!1,reason:"Choose rooms, a plan, or a custom area.",reasonKey:"v4_reason_choose_cleaning"}},l5=e=>e.activity==="paused"?n5(e):null,R7=e=>e.draw.brushMeters*64*(e.draw.zoomPercent/100),b0=[2,1,.5,.25,.1,.05],d5=e=>{let C=64*(e.draw.zoomPercent/100),H=b0.reduce((V,L)=>{let r=Math.abs(L*C-64),t=Math.abs(V*C-64);return r<t?L:V});return{meters:H,pixels:H*C,label:H<1?`${Math.round(H*100)} cm`:`${H} m`}},F7=(e,C)=>({...e,command:C});var s5="a".repeat(64),p1=[{roomId:"room-a",name:"Kitchen",boundary:[[.5,.5],[4,.5],[4,3],[.5,3]]},{roomId:"room-b",name:"Living room",boundary:[[4.2,.5],[8.5,.5],[8.5,3.4],[4.2,3.4]]},{roomId:"room-c",name:"Office",boundary:[[.5,3.2],[3.8,3.2],[3.8,6.5],[.5,6.5]]},{roomId:"room-d",name:"Bedroom",boundary:[[4,3.6],[8.5,3.6],[8.5,6.5],[4,6.5]]}],p5=()=>{let e=[180,140],C={meters_per_cell:.05,origin_cells:[0,0],span_cells:e,sample_step:1,rooms:p1.map(i=>{let a=i.boundary.map(([A,d])=>[A/.05,d/.05]),n=[a.reduce((A,[d])=>A+d,0)/a.length,a.reduce((A,[,d])=>A+d,0)/a.length];return{name:i.name,boundary:a,boundary_closed:!0,center:n}})},H=new TextEncoder().encode(JSON.stringify(C)),V=[];for(let i=10;i<130;i+=2)for(let a=10;a<170;a+=2){let n=a<80?i<65?0:2:i<72?1:3,A=[[185,219,224],[201,211,233],[210,226,194],[232,207,207]][n]||[190,205,215];V.push([a,i,0,...A])}let L=500;for(let i=0;i<L;i+=1){let a=i%4,n=i*7%120,A=a<2?a===0?10:168:10+n,d=a>=2?a===2?10:128:10+n;V.push([A,d,10+i%18,104,122,137])}let r=V.length-L,t=new ArrayBuffer(24+H.byteLength+V.length*8),M=new DataView(t);new Uint8Array(t,0,8).set(new TextEncoder().encode("MATIC3D\0")),M.setUint16(8,1,!0),M.setUint16(10,8,!0),M.setUint32(12,H.byteLength,!0),M.setUint32(16,r,!0),M.setUint32(20,L,!0),new Uint8Array(t,24,H.byteLength).set(H);let o=new DataView(t,24+H.byteLength);return V.forEach(([i=0,a=0,n=0,A=0,d=0,m=0],u)=>{let h=u*8;o.setUint16(h,i,!0),o.setUint16(h+2,a,!0),o.setUint8(h+4,n),o.setUint8(h+5,A),o.setUint8(h+6,d),o.setUint8(h+7,m)}),{buffer:t,pointOffset:24+H.byteLength,floorCount:r,surfaceCount:L,total:V.length,revision:7,etag:'"synthetic-scene"',source:"live",metadata:{metersPerCell:.05,origin:[0,0],span:e,sampleStep:1,rooms:C.rooms.map((i,a)=>({id:p1[a]?.roomId||`room-${a}`,name:i.name,boundary:i.boundary,center:i.center}))}}},z1=()=>({entryId:"synthetic-entry",sceneUrl:"/api/matic_robot/slam_scene/synthetic",deltaUrl:"/api/matic_robot/slam_delta/synthetic",poseUrl:"/api/matic_robot/slam_pose/synthetic",historyUrl:"/api/matic_robot/slam_history/synthetic",areasUrl:"/api/matic_robot/areas/synthetic",plansUrl:"/api/matic_robot/plans/synthetic",mapRevision:7,mapFloorCoherent:!0,mapSessionVerified:!0,mapSessionKey:s5,mapBlockReason:null,runnerLocked:!1,stopSettlePending:!1,activePlan:!1,nativeReconciliationPending:!1,nativeSessionActive:!1,mapComplete:!0,mapTruncated:!1,selectedFloorOrdinal:1,mapFloorOrdinal:1,historyCount:2,historyFloorCount:2,health:"ready",streamFailures:0,bootstrapState:"complete",bootstrapPhotoSeen:!0,bootstrapStructureSeen:!0,bootstrapFailures:0}),c2=()=>({rooms:p1.map(({roomId:e,name:C})=>({roomId:e,name:C})),selectedPlan:"daily",plans:[{id:"daily",name:"Daily clean",enabled:!0,runBehavior:"intelligent",rooms:p1.slice(0,3).map(({roomId:e})=>({roomId:e,cleaningMode:"vacuum",coverageSetting:"standard"})),roomOrder:p1.slice(0,3).map(({roomId:e})=>e),returnToBase:!0,finishCurrentRoom:!1,finishCurrentRoomThreshold:50}]}),x2=()=>({sceneUrl:z1().sceneUrl,rooms:p1.map(e=>({...e,boundary:e.boundary.map(C=>[...C])})),areas:[{id:"entryway",name:"Entryway",circles:[{x:1.5,y:1.4,radius:.3},{x:1.9,y:1.6,radius:.3}],cleaningMode:"vacuum",coverageSetting:"standard",status:"current",canRebind:!1}]}),m5=()=>({entryId:"synthetic-entry",liveAvailable:!0,floors:[{id:"current",active:!0,readOnly:!1,liveAvailable:!0,label:"House",ordinal:null,snapshots:[{id:"current-old",createdAt:"2026-08-29T14:00:00Z",revision:6,pointCount:5300,sceneUrl:"/synthetic-history-current-old"},{id:"current-new",createdAt:"2026-08-29T16:12:00Z",revision:7,pointCount:5300,sceneUrl:"/synthetic-history-current-new"}]},{id:"saved-1",active:!1,readOnly:!0,liveAvailable:!1,label:"Shed",ordinal:2,snapshots:[{id:"saved-one",createdAt:"2026-08-28T11:30:00Z",revision:3,pointCount:3100,sceneUrl:"/synthetic-history-saved"}]},{id:"saved-2",active:!1,readOnly:!0,liveAvailable:!1,label:"Annex",ordinal:3,snapshots:[]}]}),v5=()=>({position:[4.475,3.475],source:"latest_pose",revision:7,poseRevision:4,floorCoherent:!0,mapSessionKey:s5,freshness:"live"});var O0=()=>({...k(),coherence:"current",activity:"docked",batteryPercent:92,robots:[{entryId:"synthetic-entry",label:"Matic robot"}],host:{connected:!0,administrator:!0,robotConnected:!0,robotCount:1},floor:{classifiedCount:2,displayName:"House",readOnly:!1},map:{available:!0,complete:!0,floorCoherent:!0,sessionVerified:!0,exactPose:!0},resources:{catalog:{status:"ready",value:[z1()],problem:null},entry:z1(),scene:{status:"ready",value:p5(),problem:null},pose:{status:"ready",value:v5(),problem:null},history:{status:"ready",value:m5(),problem:null},plans:{status:"ready",value:c2(),problem:null},areas:{status:"ready",value:x2(),problem:null}},selection:{...k().selection,entryId:"synthetic-entry",planId:"daily"},planDraft:{...k().planDraft,id:"daily",name:"Daily clean",rooms:c2().plans[0]?.rooms||[]}}),u2=e=>{let C=O0();switch(e){case"ready":return C;case"cleaning":return{...C,activity:"cleaning"};case"paused":return{...C,activity:"paused"};case"returning":return{...C,activity:"returning"};case"recharging":return{...C,activity:"recharging",batteryPercent:18};case"rooms":return{...C,workflow:"rooms"};case"draw":return{...C,workflow:"draw",areaDraft:{...C.areaDraft,id:"entryway",name:"Entryway",status:"current"},selection:{...C.selection,areaId:"entryway"},draw:{...C.draw,dirty:!0,strokeCount:3,circles:x2().areas[0]?.circles||[]}};case"history":return{...C,dataMode:"history",workflow:"history",floor:{...C.floor,readOnly:!0},map:{...C.map,exactPose:!1},selection:{...C.selection,floorId:"saved-1",historyId:"saved-one"}};case"transition":return{...C,coherence:"verifying",activity:"unknown",map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1}};case"problem":return{...C,activity:"problem",coherence:"blocked"};case"ha-offline":return{...C,coherence:"degraded",host:{...C.host,connected:!1},map:{...C.map,exactPose:!1}};case"robot-offline":return{...C,coherence:"degraded",host:{...C.host,robotConnected:!1},map:{...C.map,exactPose:!1}};case"access":return{...C,coherence:"blocked",host:{...C.host,administrator:!1},map:{...C.map,available:!1,exactPose:!1}};case"empty":return{...C,coherence:"unavailable",host:{...C.host,robotConnected:!1,robotCount:0},map:{...C.map,available:!1,exactPose:!1}};case"unsupported":return{...C,coherence:"blocked",map:{...C.map,available:!1,exactPose:!1}};case"multi-robot":return{...C,host:{...C.host,robotCount:2},robots:[{entryId:"synthetic-entry",label:"Matic robot"},{entryId:"synthetic-entry-two",label:"Second robot"}]}}},Z2=["ready","cleaning","paused","returning","recharging","rooms","draw","history","transition","problem","ha-offline","robot-offline","access","empty","unsupported","multi-robot"];var w0=(e,C)=>{if(C?.recharge_and_resume===!0&&C?.charging===!0)return"recharging";switch(e){case"cleaning":return"cleaning";case"paused":return"paused";case"returning":return"returning";case"docked":return"docked";case"idle":return"idle";case"error":return"problem";default:return"unknown"}},k0=e=>typeof e!="number"||!Number.isFinite(e)?null:Math.round(Math.max(0,Math.min(100,e))),P0=e=>{let C=e.attributes?.matic_entry_id;return typeof C=="string"&&C.length>0?C:null},T0=e=>String(e||"local-user").replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",c5=e=>{if(typeof e!="string")return"Matic robot";let C=e.trim();return C&&Array.from(C).length<=128&&!/[\u0000-\u001f\u007f]/u.test(C)?C:"Matic robot"},U1=class{#C="";#H=null;project(C,H,V=null){let L=C?.states??{},r=H?.config?.entry_id,t=typeof r=="string"?r:null,M=null,o=null,i=null,a=new Map;for(let[S,y]of Object.entries(L)){let P=P0(y);if(!P||!S.startsWith("vacuum."))continue;a.set(P,{entryId:P,label:c5(y.attributes?.friendly_name)});let $1=V||t;(!M||$1&&P===$1)&&(M=y,o=S,i=P)}let n={connected:C?.connected!==!1,administrator:C?.user?.is_admin===!0,robotConnected:M!==null&&M.state!=="unavailable"&&M.state!=="unknown",robotCount:a.size},A=M?w0(M.state,M.attributes):"unknown",d=k0(M?.attributes?.battery_level),m=C?.selectedLanguage||C?.language||"en",u=T0(C?.user?.id),h=c5(M?.attributes?.friendly_name),x=[...a.values()].sort((S,y)=>S.label.localeCompare(y.label,m,{sensitivity:"base"})),f=[n.connected,n.administrator,n.robotConnected,n.robotCount,A,d??"none",m,u,o??"none",i??"none",h,x.map(S=>`${S.entryId}:${S.label}`).join(",")].join("|");return f===this.#C&&this.#H?this.#H:(this.#C=f,this.#H={host:n,activity:A,batteryPercent:d,language:m,userKey:u,vacuumEntityId:o,entryKey:i,robotLabel:h,robots:x},this.#H)}};var G1=globalThis,Q1=G1.ShadowRoot&&(G1.ShadyCSS===void 0||G1.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,h2=Symbol(),x5=new WeakMap,y1=class{constructor(C,H,V){if(this._$cssResult$=!0,V!==h2)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=C,this.t=H}get styleSheet(){let C=this.o,H=this.t;if(Q1&&C===void 0){let V=H!==void 0&&H.length===1;V&&(C=x5.get(H)),C===void 0&&((this.o=C=new CSSStyleSheet).replaceSync(this.cssText),V&&x5.set(H,C))}return C}toString(){return this.cssText}},u5=e=>new y1(typeof e=="string"?e:e+"",void 0,h2),b=(e,...C)=>{let H=e.length===1?e[0]:C.reduce((V,L,r)=>V+(t=>{if(t._$cssResult$===!0)return t.cssText;if(typeof t=="number")return t;throw Error("Value passed to 'css' function must be a 'css' function result: "+t+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(L)+e[r+1],e[0]);return new y1(H,e,h2)},Z5=(e,C)=>{if(Q1)e.adoptedStyleSheets=C.map(H=>H instanceof CSSStyleSheet?H:H.styleSheet);else for(let H of C){let V=document.createElement("style"),L=G1.litNonce;L!==void 0&&V.setAttribute("nonce",L),V.textContent=H.cssText,e.appendChild(V)}},S2=Q1?e=>e:e=>e instanceof CSSStyleSheet?(C=>{let H="";for(let V of C.cssRules)H+=V.cssText;return u5(H)})(e):e;var{is:B0,defineProperty:_0,getOwnPropertyDescriptor:R0,getOwnPropertyNames:F0,getOwnPropertySymbols:E0,getPrototypeOf:D0}=Object,K1=globalThis,h5=K1.trustedTypes,$0=h5?h5.emptyScript:"",I0=K1.reactiveElementPolyfillSupport,b1=(e,C)=>e,f2={toAttribute(e,C){switch(C){case Boolean:e=e?$0:null;break;case Object:case Array:e=e==null?e:JSON.stringify(e)}return e},fromAttribute(e,C){let H=e;switch(C){case Boolean:H=e!==null;break;case Number:H=e===null?null:Number(e);break;case Object:case Array:try{H=JSON.parse(e)}catch{H=null}}return H}},f5=(e,C)=>!B0(e,C),S5={attribute:!0,type:String,converter:f2,reflect:!1,useDefault:!1,hasChanged:f5};Symbol.metadata??=Symbol("metadata"),K1.litPropertyMetadata??=new WeakMap;var K=class extends HTMLElement{static addInitializer(C){this._$Ei(),(this.l??=[]).push(C)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(C,H=S5){if(H.state&&(H.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(C)&&((H=Object.create(H)).wrapped=!0),this.elementProperties.set(C,H),!H.noAccessor){let V=Symbol(),L=this.getPropertyDescriptor(C,V,H);L!==void 0&&_0(this.prototype,C,L)}}static getPropertyDescriptor(C,H,V){let{get:L,set:r}=R0(this.prototype,C)??{get(){return this[H]},set(t){this[H]=t}};return{get:L,set(t){let M=L?.call(this);r?.call(this,t),this.requestUpdate(C,M,V)},configurable:!0,enumerable:!0}}static getPropertyOptions(C){return this.elementProperties.get(C)??S5}static _$Ei(){if(this.hasOwnProperty(b1("elementProperties")))return;let C=D0(this);C.finalize(),C.l!==void 0&&(this.l=[...C.l]),this.elementProperties=new Map(C.elementProperties)}static finalize(){if(this.hasOwnProperty(b1("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(b1("properties"))){let H=this.properties,V=[...F0(H),...E0(H)];for(let L of V)this.createProperty(L,H[L])}let C=this[Symbol.metadata];if(C!==null){let H=litPropertyMetadata.get(C);if(H!==void 0)for(let[V,L]of H)this.elementProperties.set(V,L)}this._$Eh=new Map;for(let[H,V]of this.elementProperties){let L=this._$Eu(H,V);L!==void 0&&this._$Eh.set(L,H)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(C){let H=[];if(Array.isArray(C)){let V=new Set(C.flat(1/0).reverse());for(let L of V)H.unshift(S2(L))}else C!==void 0&&H.push(S2(C));return H}static _$Eu(C,H){let V=H.attribute;return V===!1?void 0:typeof V=="string"?V:typeof C=="string"?C.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){this._$ES=new Promise(C=>this.enableUpdating=C),this._$AL=new Map,this._$E_(),this.requestUpdate(),this.constructor.l?.forEach(C=>C(this))}addController(C){(this._$EO??=new Set).add(C),this.renderRoot!==void 0&&this.isConnected&&C.hostConnected?.()}removeController(C){this._$EO?.delete(C)}_$E_(){let C=new Map,H=this.constructor.elementProperties;for(let V of H.keys())this.hasOwnProperty(V)&&(C.set(V,this[V]),delete this[V]);C.size>0&&(this._$Ep=C)}createRenderRoot(){let C=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return Z5(C,this.constructor.elementStyles),C}connectedCallback(){this.renderRoot??=this.createRenderRoot(),this.enableUpdating(!0),this._$EO?.forEach(C=>C.hostConnected?.())}enableUpdating(C){}disconnectedCallback(){this._$EO?.forEach(C=>C.hostDisconnected?.())}attributeChangedCallback(C,H,V){this._$AK(C,V)}_$ET(C,H){let V=this.constructor.elementProperties.get(C),L=this.constructor._$Eu(C,V);if(L!==void 0&&V.reflect===!0){let r=(V.converter?.toAttribute!==void 0?V.converter:f2).toAttribute(H,V.type);this._$Em=C,r==null?this.removeAttribute(L):this.setAttribute(L,r),this._$Em=null}}_$AK(C,H){let V=this.constructor,L=V._$Eh.get(C);if(L!==void 0&&this._$Em!==L){let r=V.getPropertyOptions(L),t=typeof r.converter=="function"?{fromAttribute:r.converter}:r.converter?.fromAttribute!==void 0?r.converter:f2;this._$Em=L;let M=t.fromAttribute(H,r.type);this[L]=M??this._$Ej?.get(L)??M,this._$Em=null}}requestUpdate(C,H,V,L=!1,r){if(C!==void 0){let t=this.constructor;if(L===!1&&(r=this[C]),V??=t.getPropertyOptions(C),!((V.hasChanged??f5)(r,H)||V.useDefault&&V.reflect&&r===this._$Ej?.get(C)&&!this.hasAttribute(t._$Eu(C,V))))return;this.C(C,H,V)}this.isUpdatePending===!1&&(this._$ES=this._$EP())}C(C,H,{useDefault:V,reflect:L,wrapped:r},t){V&&!(this._$Ej??=new Map).has(C)&&(this._$Ej.set(C,t??H??this[C]),r!==!0||t!==void 0)||(this._$AL.has(C)||(this.hasUpdated||V||(H=void 0),this._$AL.set(C,H)),L===!0&&this._$Em!==C&&(this._$Eq??=new Set).add(C))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(H){Promise.reject(H)}let C=this.scheduleUpdate();return C!=null&&await C,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??=this.createRenderRoot(),this._$Ep){for(let[L,r]of this._$Ep)this[L]=r;this._$Ep=void 0}let V=this.constructor.elementProperties;if(V.size>0)for(let[L,r]of V){let{wrapped:t}=r,M=this[L];t!==!0||this._$AL.has(L)||M===void 0||this.C(L,void 0,r,M)}}let C=!1,H=this._$AL;try{C=this.shouldUpdate(H),C?(this.willUpdate(H),this._$EO?.forEach(V=>V.hostUpdate?.()),this.update(H)):this._$EM()}catch(V){throw C=!1,this._$EM(),V}C&&this._$AE(H)}willUpdate(C){}_$AE(C){this._$EO?.forEach(H=>H.hostUpdated?.()),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(C)),this.updated(C)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(C){return!0}update(C){this._$Eq&&=this._$Eq.forEach(H=>this._$ET(H,this[H])),this._$EM()}updated(C){}firstUpdated(C){}};K.elementStyles=[],K.shadowRootOptions={mode:"open"},K[b1("elementProperties")]=new Map,K[b1("finalized")]=new Map,I0?.({ReactiveElement:K}),(K1.reactiveElementVersions??=[]).push("2.1.2");var P2=globalThis,g5=e=>e,q1=P2.trustedTypes,y5=q1?q1.createPolicy("lit-html",{createHTML:e=>e}):void 0,T5="$lit$",Y=`lit$${Math.random().toFixed(9).slice(2)}$`,B5="?"+Y,W0=`<${B5}>`,e1=document,w1=()=>e1.createComment(""),k1=e=>e===null||typeof e!="object"&&typeof e!="function",T2=Array.isArray,N0=e=>T2(e)||typeof e?.[Symbol.iterator]=="function",g2=`[ \t\n\f\r]`,O1=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,b5=/-->/g,O5=/>/g,V1=RegExp(`>|${g2}(?:([^\\s"'>=/]+)(${g2}*=${g2}*(?:[^ \t\n\f\r"'\`<>=]|("|')|))|$)`,"g"),w5=/'/g,k5=/"/g,_5=/^(?:script|style|textarea|title)$/i,B2=e=>(C,...H)=>({_$litType$:e,strings:C,values:H}),s=B2(1),R5=B2(2),F5=B2(3),r1=Symbol.for("lit-noChange"),l=Symbol.for("lit-nothing"),P5=new WeakMap,L1=e1.createTreeWalker(e1,129);function E5(e,C){if(!T2(e)||!e.hasOwnProperty("raw"))throw Error("invalid template strings array");return y5!==void 0?y5.createHTML(C):C}var z0=(e,C)=>{let H=e.length-1,V=[],L,r=C===2?"<svg>":C===3?"<math>":"",t=O1;for(let M=0;M<H;M++){let o=e[M],i,a,n=-1,A=0;for(;A<o.length&&(t.lastIndex=A,a=t.exec(o),a!==null);)A=t.lastIndex,t===O1?a[1]==="!--"?t=b5:a[1]!==void 0?t=O5:a[2]!==void 0?(_5.test(a[2])&&(L=RegExp("</"+a[2],"g")),t=V1):a[3]!==void 0&&(t=V1):t===V1?a[0]===">"?(t=L??O1,n=-1):a[1]===void 0?n=-2:(n=t.lastIndex-a[2].length,i=a[1],t=a[3]===void 0?V1:a[3]==='"'?k5:w5):t===k5||t===w5?t=V1:t===b5||t===O5?t=O1:(t=V1,L=void 0);let d=t===V1&&e[M+1].startsWith("/>")?" ":"";r+=t===O1?o+W0:n>=0?(V.push(i),o.slice(0,n)+T5+o.slice(n)+Y+d):o+Y+(n===-2?M:d)}return[E5(e,r+(e[H]||"<?>")+(C===2?"</svg>":C===3?"</math>":"")),V]},P1=class e{constructor({strings:C,_$litType$:H},V){let L;this.parts=[];let r=0,t=0,M=C.length-1,o=this.parts,[i,a]=z0(C,H);if(this.el=e.createElement(i,V),L1.currentNode=this.el.content,H===2||H===3){let n=this.el.content.firstChild;n.replaceWith(...n.childNodes)}for(;(L=L1.nextNode())!==null&&o.length<M;){if(L.nodeType===1){if(L.hasAttributes())for(let n of L.getAttributeNames())if(n.endsWith(T5)){let A=a[t++],d=L.getAttribute(n).split(Y),m=/([.?@])?(.*)/.exec(A);o.push({type:1,index:r,name:m[2],strings:d,ctor:m[1]==="."?b2:m[1]==="?"?O2:m[1]==="@"?w2:v1}),L.removeAttribute(n)}else n.startsWith(Y)&&(o.push({type:6,index:r}),L.removeAttribute(n));if(_5.test(L.tagName)){let n=L.textContent.split(Y),A=n.length-1;if(A>0){L.textContent=q1?q1.emptyScript:"";for(let d=0;d<A;d++)L.append(n[d],w1()),L1.nextNode(),o.push({type:2,index:++r});L.append(n[A],w1())}}}else if(L.nodeType===8)if(L.data===B5)o.push({type:2,index:r});else{let n=-1;for(;(n=L.data.indexOf(Y,n+1))!==-1;)o.push({type:7,index:r}),n+=Y.length-1}r++}}static createElement(C,H){let V=e1.createElement("template");return V.innerHTML=C,V}};function m1(e,C,H=e,V){if(C===r1)return C;let L=V!==void 0?H._$Co?.[V]:H._$Cl,r=k1(C)?void 0:C._$litDirective$;return L?.constructor!==r&&(L?._$AO?.(!1),r===void 0?L=void 0:(L=new r(e),L._$AT(e,H,V)),V!==void 0?(H._$Co??=[])[V]=L:H._$Cl=L),L!==void 0&&(C=m1(e,L._$AS(e,C.values),L,V)),C}var y2=class{constructor(C,H){this._$AV=[],this._$AN=void 0,this._$AD=C,this._$AM=H}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(C){let{el:{content:H},parts:V}=this._$AD,L=(C?.creationScope??e1).importNode(H,!0);L1.currentNode=L;let r=L1.nextNode(),t=0,M=0,o=V[0];for(;o!==void 0;){if(t===o.index){let i;o.type===2?i=new T1(r,r.nextSibling,this,C):o.type===1?i=new o.ctor(r,o.name,o.strings,this,C):o.type===6&&(i=new k2(r,this,C)),this._$AV.push(i),o=V[++M]}t!==o?.index&&(r=L1.nextNode(),t++)}return L1.currentNode=e1,L}p(C){let H=0;for(let V of this._$AV)V!==void 0&&(V.strings!==void 0?(V._$AI(C,V,H),H+=V.strings.length-2):V._$AI(C[H])),H++}},T1=class e{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(C,H,V,L){this.type=2,this._$AH=l,this._$AN=void 0,this._$AA=C,this._$AB=H,this._$AM=V,this.options=L,this._$Cv=L?.isConnected??!0}get parentNode(){let C=this._$AA.parentNode,H=this._$AM;return H!==void 0&&C?.nodeType===11&&(C=H.parentNode),C}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(C,H=this){C=m1(this,C,H),k1(C)?C===l||C==null||C===""?(this._$AH!==l&&this._$AR(),this._$AH=l):C!==this._$AH&&C!==r1&&this._(C):C._$litType$!==void 0?this.$(C):C.nodeType!==void 0?this.T(C):N0(C)?this.k(C):this._(C)}O(C){return this._$AA.parentNode.insertBefore(C,this._$AB)}T(C){this._$AH!==C&&(this._$AR(),this._$AH=this.O(C))}_(C){this._$AH!==l&&k1(this._$AH)?this._$AA.nextSibling.data=C:this.T(e1.createTextNode(C)),this._$AH=C}$(C){let{values:H,_$litType$:V}=C,L=typeof V=="number"?this._$AC(C):(V.el===void 0&&(V.el=P1.createElement(E5(V.h,V.h[0]),this.options)),V);if(this._$AH?._$AD===L)this._$AH.p(H);else{let r=new y2(L,this),t=r.u(this.options);r.p(H),this.T(t),this._$AH=r}}_$AC(C){let H=P5.get(C.strings);return H===void 0&&P5.set(C.strings,H=new P1(C)),H}k(C){T2(this._$AH)||(this._$AH=[],this._$AR());let H=this._$AH,V,L=0;for(let r of C)L===H.length?H.push(V=new e(this.O(w1()),this.O(w1()),this,this.options)):V=H[L],V._$AI(r),L++;L<H.length&&(this._$AR(V&&V._$AB.nextSibling,L),H.length=L)}_$AR(C=this._$AA.nextSibling,H){for(this._$AP?.(!1,!0,H);C!==this._$AB;){let V=g5(C).nextSibling;g5(C).remove(),C=V}}setConnected(C){this._$AM===void 0&&(this._$Cv=C,this._$AP?.(C))}},v1=class{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(C,H,V,L,r){this.type=1,this._$AH=l,this._$AN=void 0,this.element=C,this.name=H,this._$AM=L,this.options=r,V.length>2||V[0]!==""||V[1]!==""?(this._$AH=Array(V.length-1).fill(new String),this.strings=V):this._$AH=l}_$AI(C,H=this,V,L){let r=this.strings,t=!1;if(r===void 0)C=m1(this,C,H,0),t=!k1(C)||C!==this._$AH&&C!==r1,t&&(this._$AH=C);else{let M=C,o,i;for(C=r[0],o=0;o<r.length-1;o++)i=m1(this,M[V+o],H,o),i===r1&&(i=this._$AH[o]),t||=!k1(i)||i!==this._$AH[o],i===l?C=l:C!==l&&(C+=(i??"")+r[o+1]),this._$AH[o]=i}t&&!L&&this.j(C)}j(C){C===l?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,C??"")}},b2=class extends v1{constructor(){super(...arguments),this.type=3}j(C){this.element[this.name]=C===l?void 0:C}},O2=class extends v1{constructor(){super(...arguments),this.type=4}j(C){this.element.toggleAttribute(this.name,!!C&&C!==l)}},w2=class extends v1{constructor(C,H,V,L,r){super(C,H,V,L,r),this.type=5}_$AI(C,H=this){if((C=m1(this,C,H,0)??l)===r1)return;let V=this._$AH,L=C===l&&V!==l||C.capture!==V.capture||C.once!==V.once||C.passive!==V.passive,r=C!==l&&(V===l||L);L&&this.element.removeEventListener(this.name,this,V),r&&this.element.addEventListener(this.name,this,C),this._$AH=C}handleEvent(C){typeof this._$AH=="function"?this._$AH.call(this.options?.host??this.element,C):this._$AH.handleEvent(C)}},k2=class{constructor(C,H,V){this.element=C,this.type=6,this._$AN=void 0,this._$AM=H,this.options=V}get _$AU(){return this._$AM._$AU}_$AI(C){m1(this,C)}};var U0=P2.litHtmlPolyfillSupport;U0?.(P1,T1),(P2.litHtmlVersions??=[]).push("3.3.3");var D5=(e,C,H)=>{let V=H?.renderBefore??C,L=V._$litPart$;if(L===void 0){let r=H?.renderBefore??null;V._$litPart$=L=new T1(C.insertBefore(w1(),r),r,void 0,H??{})}return L._$AI(e),L};var _2=globalThis,O=class extends K{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){let C=super.createRenderRoot();return this.renderOptions.renderBefore??=C.firstChild,C}update(C){let H=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(C),this._$Do=D5(H,this.renderRoot,this.renderOptions)}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(!0)}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(!1)}render(){return r1}};O._$litElement$=!0,O.finalized=!0,_2.litElementHydrateSupport?.({LitElement:O});var G0=_2.litElementPolyfillSupport;G0?.({LitElement:O});(_2.litElementVersions??=[]).push("4.2.2");var E=b`
:host {
--ms-accent: var(--primary-color, #0678ce);
--ms-on-accent: var(--text-primary-color, #fff);
--ms-danger: var(--error-color, #b3261e);
--ms-warning: var(--warning-color, #8a5b00);
--ms-success: var(--success-color, #2e7d4f);
--ms-surface-app: var(--primary-background-color, #f3f6f8);
--ms-surface-card: var(--card-background-color, #fff);
--ms-surface-sunken: var(--secondary-background-color, #eef2f4);
--ms-surface-bar: var(--app-header-background-color, var(--card-background-color, #fff));
--ms-local: var(--card-background-color, #fff);
--ms-text: var(--primary-text-color, #1f2933);
--ms-text-quiet: var(--secondary-text-color, #5b6b75);
--ms-text-disabled: var(--disabled-text-color, #8a959c);
--ms-line: var(--divider-color, color-mix(in srgb, var(--ms-text) 14%, transparent));
--ms-line-strong: color-mix(in srgb, var(--ms-text) 26%, transparent);
--ms-scrim: color-mix(in srgb, #000 46%, transparent);
--ms-space-1: 0.25rem;
--ms-space-2: 0.5rem;
--ms-space-3: 0.75rem;
--ms-space-4: 1rem;
--ms-space-5: 1.5rem;
--ms-space-6: 2rem;
--ms-radius-xs: 0.25rem;
--ms-radius-sm: 0.5rem;
--ms-radius-md: 0.75rem;
--ms-radius-lg: 1rem;
--ms-radius-pill: 999rem;
--ms-control: 2.75rem;
--ms-control-sm: 2.25rem;
--ms-control-lg: 3.25rem;
--ms-icon: 1.25rem;
--ms-icon-sm: 1rem;
--ms-font: var(--ha-font-family-body, Roboto, system-ui, sans-serif);
--ms-w-regular: 400;
--ms-w-medium: 500;
--ms-w-bold: 700;
--ms-t-2xs: 0.6875rem;
--ms-t-xs: 0.75rem;
--ms-t-sm: 0.8125rem;
--ms-t-md: 0.875rem;
--ms-t-lg: 1rem;
--ms-t-xl: 1.25rem;
--ms-lh-tight: 1.2;
--ms-lh-snug: 1.35;
--ms-lh-normal: 1.5;
--ms-track-tight: -0.01em;
--ms-shadow-1: 0 1px 2px rgb(0 0 0 / 10%);
--ms-shadow-2: 0 4px 12px rgb(0 0 0 / 14%);
--ms-shadow-3: 0 12px 32px rgb(0 0 0 / 22%);
--ms-fast: 120ms;
--ms-base: 180ms;
--ms-slow: 260ms;
--ms-ease: cubic-bezier(0.2, 0, 0, 1);
}
@media (prefers-color-scheme: dark) {
:host {
--ms-accent: var(--primary-color, #58a6e8);
--ms-surface-app: var(--primary-background-color, #101a20);
--ms-surface-card: var(--card-background-color, #1a262d);
--ms-surface-sunken: var(--secondary-background-color, #141e23);
--ms-local: var(--card-background-color, #1a262d);
--ms-text: var(--primary-text-color, #eef4f7);
--ms-text-quiet: var(--secondary-text-color, #a4b3bc);
--ms-text-disabled: var(--disabled-text-color, #7c8a92);
--ms-danger: var(--error-color, #f2837b);
--ms-warning: var(--warning-color, #e0a63a);
--ms-success: var(--success-color, #74c69d);
--ms-shadow-1: 0 1px 2px rgb(0 0 0 / 40%);
--ms-shadow-2: 0 4px 12px rgb(0 0 0 / 48%);
--ms-shadow-3: 0 12px 32px rgb(0 0 0 / 60%);
}
}
@media (prefers-reduced-motion: reduce) {
:host {
--ms-fast: 0s;
--ms-base: 0s;
--ms-slow: 0s;
--ms-ease: linear;
}
}
@media (forced-colors: active) {
:host {
--ms-accent: Highlight;
--ms-on-accent: HighlightText;
--ms-surface-app: Canvas;
--ms-surface-card: Canvas;
--ms-surface-sunken: Canvas;
--ms-surface-bar: Canvas;
--ms-local: Canvas;
--ms-text: CanvasText;
--ms-text-quiet: CanvasText;
--ms-text-disabled: GrayText;
--ms-line: ButtonBorder;
--ms-line-strong: ButtonBorder;
--ms-danger: CanvasText;
--ms-warning: CanvasText;
--ms-success: CanvasText;
--ms-shadow-1: none;
--ms-shadow-2: none;
--ms-shadow-3: none;
}
}
`,D=b`
*, *::before, *::after { box-sizing: border-box; }
button, input, select, textarea { font: inherit; }
.ms-icon { display: block; flex: none; inline-size: var(--ms-icon); block-size: var(--ms-icon); }
.ms-icon--sm { inline-size: var(--ms-icon-sm); block-size: var(--ms-icon-sm); }
`;var I5=Symbol.for(""),Q0=e=>{if(e?.r===I5)return e?._$litStatic$},j=e=>({_$litStatic$:e,r:I5});var $5=new Map,R2=e=>(C,...H)=>{let V=H.length,L,r,t=[],M=[],o,i=0,a=!1;for(;i<V;){for(o=C[i];i<V&&(r=H[i],(L=Q0(r))!==void 0);)o+=L+C[++i],a=!0;i!==V&&M.push(r),t.push(o),i++}if(i===V&&t.push(C[V]),a){let n=t.join("$$lit$$");(C=$5.get(n))===void 0&&(t.raw=t,$5.set(n,C=t)),H=M}return e(C,...H)},v=R2(s),i4=R2(R5),a4=R2(F5);var W5=import.meta.url.match(/\/matic_robot\/[^/]+-([a-f0-9]{12})\/map-studio-v4(?:\/|$)/u)?.[1]??"dev",B1=W5==="dev"?"":`-${W5}`,t1=`matic-map-canvas-v4${B1}`,_1=`matic-precision-controls-v4${B1}`,c1=`matic-map-workflow-v4${B1}`,M1=`matic-map-shell-v4${B1}`,F2=`matic-map-panel-v0-4-0${B1}`;var J=b`
.ms-btn, .ms-row {
border: 1px solid transparent;
color: var(--ms-text);
background: transparent;
cursor: pointer;
-webkit-tap-highlight-color: transparent;
transition: background-color var(--ms-fast) var(--ms-ease), border-color var(--ms-fast) var(--ms-ease), color var(--ms-fast) var(--ms-ease);
}
.ms-btn:focus-visible, .ms-row:focus-visible { outline: 2px solid var(--ms-accent); outline-offset: 2px; }
.ms-btn:disabled, .ms-row:disabled, .ms-btn[aria-disabled="true"], .ms-row[aria-disabled="true"] {
cursor: default;
color: var(--ms-text-disabled);
border-color: var(--ms-line);
background: transparent;
box-shadow: none;
}
.ms-btn {
display: inline-flex;
align-items: center;
justify-content: center;
gap: var(--ms-space-2);
min-inline-size: var(--ms-control);
min-block-size: var(--ms-control);
padding-inline: var(--ms-space-3);
border-radius: var(--ms-radius-sm);
font-size: var(--ms-t-sm);
font-weight: var(--ms-w-bold);
line-height: var(--ms-lh-tight);
white-space: nowrap;
}
.ms-btn--sm { min-inline-size: var(--ms-control-sm); min-block-size: var(--ms-control-sm); padding-inline: var(--ms-space-2); font-size: var(--ms-t-xs); }
.ms-btn--lg { min-block-size: var(--ms-control-lg); font-size: var(--ms-t-md); }
.ms-btn--block { display: flex; inline-size: 100%; }
.ms-btn--icon { padding-inline: 0; inline-size: var(--ms-control); }
.ms-btn--pill { border-radius: var(--ms-radius-pill); }
.ms-btn--primary { --ms-local: var(--ms-accent); color: var(--ms-on-accent); background: var(--ms-accent); box-shadow: var(--ms-shadow-1); }
.ms-btn--secondary { --ms-local: var(--ms-surface-card); border-color: var(--ms-line-strong); background: var(--ms-local); }
.ms-btn--danger { color: color-mix(in srgb, var(--ms-danger) 82%, var(--ms-text)); border-color: currentColor; }
.ms-btn--primary.ms-btn--danger { --ms-local: var(--ms-danger); color: var(--ms-on-accent); background: var(--ms-danger); border-color: transparent; }
.ms-btn:active:not(:disabled):not([aria-disabled="true"]) { background: color-mix(in srgb, var(--ms-text) 14%, var(--ms-local)); }
.ms-btn--primary:active:not(:disabled):not([aria-disabled="true"]) { background: color-mix(in srgb, var(--ms-accent) 74%, var(--ms-text)); box-shadow: none; }
@media (hover: hover) {
.ms-btn:hover:not(:disabled):not([aria-disabled="true"]) { background: color-mix(in srgb, var(--ms-text) 7%, var(--ms-local)); }
.ms-btn--primary:hover:not(:disabled):not([aria-disabled="true"]) { background: color-mix(in srgb, var(--ms-accent) 86%, var(--ms-text)); }
.ms-btn--danger:hover:not(:disabled):not([aria-disabled="true"]) { background: color-mix(in srgb, var(--ms-danger) 10%, var(--ms-local)); }
}
.ms-btn[aria-pressed="true"], .ms-btn[aria-checked="true"] {
color: var(--ms-accent);
background: color-mix(in srgb, var(--ms-accent) 12%, var(--ms-local));
border-color: color-mix(in srgb, var(--ms-accent) 45%, var(--ms-line));
}
@media (hover: hover) {
.ms-btn[aria-pressed="true"]:hover, .ms-btn[aria-checked="true"]:hover { background: color-mix(in srgb, var(--ms-accent) 20%, var(--ms-local)); }
}
.ms-segment { display: flex; gap: var(--ms-space-1); padding: var(--ms-space-1); }
.ms-row {
--ms-local: var(--ms-surface-sunken);
display: flex;
align-items: center;
gap: var(--ms-space-3);
inline-size: 100%;
min-block-size: var(--ms-control);
padding: var(--ms-space-2) var(--ms-space-3);
border-color: var(--ms-line);
border-radius: var(--ms-radius-md);
background: var(--ms-local);
text-align: start;
font-size: var(--ms-t-sm);
}
.ms-row--card { min-block-size: var(--ms-control-lg); padding: var(--ms-space-3); }
.ms-row--stack { display: grid; gap: var(--ms-space-2); }
.ms-row--menu { --ms-local: var(--ms-surface-card); border-color: transparent; border-radius: var(--ms-radius-sm); }
.ms-row--featured { --ms-local: color-mix(in srgb, var(--ms-accent) 10%, var(--ms-surface-sunken)); border-color: color-mix(in srgb, var(--ms-accent) 30%, var(--ms-line)); }
.ms-row__lead {
flex: none;
display: grid;
place-items: center;
inline-size: var(--ms-control-sm);
block-size: var(--ms-control-sm);
border-radius: var(--ms-radius-sm);
color: var(--ms-accent);
background: color-mix(in srgb, var(--ms-accent) 12%, var(--ms-local));
}
.ms-row__body { flex: 1; min-inline-size: 0; }
.ms-row__body strong { display: block; font-size: var(--ms-t-md); font-weight: var(--ms-w-bold); letter-spacing: var(--ms-track-tight); }
.ms-row__body small { display: block; margin-block-start: 0.125rem; color: color-mix(in srgb, var(--ms-text) 78%, var(--ms-local)); font-size: var(--ms-t-xs); font-weight: var(--ms-w-regular); line-height: var(--ms-lh-snug); }
.ms-row__trail { flex: none; color: var(--ms-text-quiet); }
.ms-row:active:not(:disabled):not([aria-disabled="true"]) { background: color-mix(in srgb, var(--ms-text) 14%, var(--ms-local)); }
@media (hover: hover) {
.ms-row:hover:not(:disabled):not([aria-disabled="true"]) { border-color: color-mix(in srgb, var(--ms-accent) 45%, var(--ms-line)); background: color-mix(in srgb, var(--ms-text) 7%, var(--ms-local)); }
}
.ms-row[aria-pressed="true"], .ms-row[aria-current="true"], .ms-row[data-selected="true"] { border-color: var(--ms-accent); background: color-mix(in srgb, var(--ms-accent) 12%, var(--ms-local)); }
.ms-surface { --ms-local: var(--ms-surface-card); border: 1px solid var(--ms-line); border-radius: var(--ms-radius-lg); background: var(--ms-local); }
.ms-surface--floating { box-shadow: var(--ms-shadow-2); }
.ms-surface--overlay { border-radius: var(--ms-radius-md); box-shadow: var(--ms-shadow-3); }
.ms-field { display: grid; gap: var(--ms-space-1); color: var(--ms-text-quiet); font-size: var(--ms-t-xs); font-weight: var(--ms-w-medium); }
/* Child combinator, not descendant: .ms-field wraps a label and ITS
   control. A descendant selector at (0,1,1) also matched inputs nested
   inside composite controls -- precision-controls' .stepper > .number >
   input -- and beat that component's own input { border: 0; background:
   transparent } at (0,0,1), painting a second border and background
   inside a wrapper that already had them, forcing 44px onto the inner
   input, and drawing a second focus ring over .number:focus-within. */
.ms-field > input, .ms-field > select, .ms-select {
--ms-local: var(--ms-surface-card);
inline-size: 100%;
min-block-size: var(--ms-control);
padding-inline: var(--ms-space-3);
border: 1px solid var(--ms-line-strong);
border-radius: var(--ms-radius-sm);
color: var(--ms-text);
background: var(--ms-local);
font-size: var(--ms-t-sm);
}
.ms-field > input:focus-visible, .ms-field > select:focus-visible, .ms-select:focus-visible { outline: 2px solid var(--ms-accent); outline-offset: 1px; border-color: var(--ms-accent); }
.ms-field > input:disabled, .ms-field > select:disabled, .ms-select:disabled { color: var(--ms-text-disabled); cursor: default; }
@media (forced-colors: active) {
.ms-btn, .ms-row, .ms-surface, .ms-field > input, .ms-field > select, .ms-select { border-color: ButtonBorder; }
.ms-btn[aria-pressed="true"], .ms-btn[aria-checked="true"], .ms-row[aria-pressed="true"], .ms-row[aria-current="true"], .ms-row[data-selected="true"] { forced-color-adjust: none; color: HighlightText; background: Highlight; border-color: Highlight; }
.ms-btn:disabled, .ms-row:disabled, .ms-btn[aria-disabled="true"], .ms-row[aria-disabled="true"] { color: GrayText; border-color: GrayText; }
}
`;var N5="M9.5,13.09L10.91,14.5L6.41,19H10V21H3V14H5V17.59L9.5,13.09M10.91,9.5L9.5,10.91L5,6.41V10H3V3H10V5H6.41L10.91,9.5M14.5,13.09L19,17.59V14H21V21H14V19H17.59L13.09,14.5L14.5,13.09M13.09,9.5L17.59,5H14V3H21V10H19V6.41L14.5,10.91L13.09,9.5Z";var z5="M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z";var U5="M23,11H20V4L15,14H18V22M12,13H4V6H12M12.67,4H11V2H5V4H3.33A1.33,1.33 0 0,0 2,5.33V20.67C2,21.4 2.6,22 3.33,22H12.67C13.4,22 14,21.4 14,20.67V5.33A1.33,1.33 0 0,0 12.67,4Z";var G5="M20.71,4.63L19.37,3.29C19,2.9 18.35,2.9 17.96,3.29L9,12.25L11.75,15L20.71,6.04C21.1,5.65 21.1,5 20.71,4.63M7,14A3,3 0 0,0 4,17C4,18.31 2.84,19 2,19C2.92,20.22 4.5,21 6,21A4,4 0 0,0 10,17A3,3 0 0,0 7,14Z";var E2="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z";var Q5="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z";var D2="M7.41,15.41L12,10.83L16.59,15.41L18,14L12,8L6,14L7.41,15.41Z";var K5="M12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z";var q5="M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z";var X5="M13,6V11H18V7.75L22.25,12L18,16.25V13H13V18H16.25L12,22.25L7.75,18H11V13H6V16.25L1.75,12L6,7.75V11H11V6H7.75L12,1.75L16.25,6H13Z";var Y5="M12,16A2,2 0 0,1 14,18A2,2 0 0,1 12,20A2,2 0 0,1 10,18A2,2 0 0,1 12,16M12,10A2,2 0 0,1 14,12A2,2 0 0,1 12,14A2,2 0 0,1 10,12A2,2 0 0,1 12,10M12,4A2,2 0 0,1 14,6A2,2 0 0,1 12,8A2,2 0 0,1 10,6A2,2 0 0,1 12,4Z";var j5="M16.24,3.56L21.19,8.5C21.97,9.29 21.97,10.55 21.19,11.34L12,20.53C10.44,22.09 7.91,22.09 6.34,20.53L2.81,17C2.03,16.21 2.03,14.95 2.81,14.16L13.41,3.56C14.2,2.78 15.46,2.78 16.24,3.56M4.22,15.58L7.76,19.11C8.54,19.9 9.8,19.9 10.59,19.11L14.12,15.58L9.17,10.63L4.22,15.58Z";var J5="M18.5,4L19.66,8.35L18.7,8.61C18.25,7.74 17.79,6.87 17.26,6.43C16.73,6 16.11,6 15.5,6H13V16.5C13,17 13,17.5 13.33,17.75C13.67,18 14.33,18 15,18V19H9V18C9.67,18 10.33,18 10.67,17.75C11,17.5 11,17 11,16.5V6H8.5C7.89,6 7.27,6 6.74,6.43C6.21,6.87 5.75,7.74 5.3,8.61L4.34,8.35L5.5,4H18.5Z";var C3="M5,5H10V7H7V10H5V5M14,5H19V10H17V7H14V5M17,14H19V19H14V17H17V14M10,17V19H5V14H7V17H10Z",H3="M14,14H19V16H16V19H14V14M5,14H10V19H8V16H5V14M8,5H10V10H5V8H8V5M19,8V10H14V5H16V8H19Z";var V3="M11,18H13V16H11V18M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M12,6A4,4 0 0,0 8,10H10A2,2 0 0,1 12,8A2,2 0 0,1 14,10C14,12 11,11.75 11,15H13C13,12.75 16,12.5 16,10A4,4 0 0,0 12,6Z";var L3="M13.5,8H12V13L16.28,15.54L17,14.33L13.5,12.25V8M13,3A9,9 0 0,0 4,12H1L4.96,16.03L9,12H6A7,7 0 0,1 13,5A7,7 0 0,1 20,12A7,7 0 0,1 13,19C11.07,19 9.32,18.21 8.06,16.94L6.64,18.36C8.27,20 10.5,21 13,21A9,9 0 0,0 22,12A9,9 0 0,0 13,3";var e3="M16.37,16.1L11.75,11.47L11.64,11.36L3.27,3L2,4.27L5.18,7.45C5.06,7.95 5,8.46 5,9C5,14.25 12,22 12,22C12,22 13.67,20.15 15.37,17.65L18.73,21L20,19.72M12,6.5A2.5,2.5 0 0,1 14.5,9C14.5,9.73 14.17,10.39 13.67,10.85L17.3,14.5C18.28,12.62 19,10.68 19,9A7,7 0 0,0 12,2C10,2 8.24,2.82 6.96,4.14L10.15,7.33C10.61,6.82 11.26,6.5 12,6.5Z";var r3="M3,6H21V8H3V6M3,11H21V13H3V11M3,16H21V18H3V16Z";var t3="M14,19H18V5H14M6,19H10V5H6V19Z";var M3="M8,5.14V19.14L19,12.14L8,5.14Z";var o3="M18.4,10.6C16.55,9 14.15,8 11.5,8C6.85,8 2.92,11.03 1.54,15.22L3.9,16C4.95,12.81 7.95,10.5 11.5,10.5C13.45,10.5 15.23,11.22 16.62,12.38L13,16H22V7L18.4,10.6Z";var i3="M12,2C14.65,2 17.19,3.06 19.07,4.93L17.65,6.35C16.15,4.85 14.12,4 12,4C9.88,4 7.84,4.84 6.35,6.35L4.93,4.93C6.81,3.06 9.35,2 12,2M3.66,6.5L5.11,7.94C4.39,9.17 4,10.57 4,12A8,8 0 0,0 12,20A8,8 0 0,0 20,12C20,10.57 19.61,9.17 18.88,7.94L20.34,6.5C21.42,8.12 22,10.04 22,12A10,10 0 0,1 12,22A10,10 0 0,1 2,12C2,10.04 2.58,8.12 3.66,6.5M12,6A6,6 0 0,1 18,12C18,13.59 17.37,15.12 16.24,16.24L14.83,14.83C14.08,15.58 13.06,16 12,16C10.94,16 9.92,15.58 9.17,14.83L7.76,16.24C6.63,15.12 6,13.59 6,12A6,6 0 0,1 12,6M12,8A1,1 0 0,0 11,9A1,1 0 0,0 12,10A1,1 0 0,0 13,9A1,1 0 0,0 12,8Z";var a3="M13,4.07V1L8.45,5.55L13,10V6.09C15.84,6.57 18,9.03 18,12C18,14.97 15.84,17.43 13,17.91V19.93C16.95,19.44 20,16.08 20,12C20,7.92 16.95,4.56 13,4.07M7.1,18.32C8.26,19.22 9.61,19.76 11,19.93V17.9C10.13,17.75 9.29,17.41 8.54,16.87L7.1,18.32M6.09,13H4.07C4.24,14.39 4.79,15.73 5.69,16.89L7.1,15.47C6.58,14.72 6.23,13.88 6.09,13M7.11,8.53L5.7,7.11C4.8,8.27 4.24,9.61 4.07,11H6.09C6.23,10.13 6.58,9.28 7.11,8.53Z";var n3="M16.89,15.5L18.31,16.89C19.21,15.73 19.76,14.39 19.93,13H17.91C17.77,13.87 17.43,14.72 16.89,15.5M13,17.9V19.92C14.39,19.75 15.74,19.21 16.9,18.31L15.46,16.87C14.71,17.41 13.87,17.76 13,17.9M19.93,11C19.76,9.61 19.21,8.27 18.31,7.11L16.89,8.53C17.43,9.28 17.77,10.13 17.91,11M15.55,5.55L11,1V4.07C7.06,4.56 4,7.92 4,12C4,16.08 7.05,19.44 11,19.93V17.91C8.16,17.43 6,14.97 6,12C6,9.03 8.16,6.57 11,6.09V10L15.55,5.55Z";var A3="M17,15.7V13H19V17L10,21L3,14L7,5H11V7H8.3L5.4,13.6L10.4,18.6L17,15.7M22,5V7H19V10H17V7H14V5H17V2H19V5H22Z";var l3="M12.5,8C9.85,8 7.45,9 5.6,10.6L2,7V16H11L7.38,12.38C8.77,11.22 10.54,10.5 12.5,10.5C16.04,10.5 19.05,12.81 20.1,16L22.47,15.22C21.08,11.03 17.15,8 12.5,8Z";var d3=r3,$2=z5,s3=Y5,X1=Q5,p3=D2,m3=E2,v3=D2,c3=E2,x3=N5,u3=J5,Z3=V3,h3=C3,S3=H3,f3=a3,g3=n3,y3=l3,b3=o3,O3=G5,w3=K5,k3=j5,P3=X5;var T3=q5,B3=A3,R1=L3,Y1=i3,I2=M3,W2=t3,_3=U5,x1=e3,Z=e=>s`<svg
  class="ms-icon"
  viewBox="0 0 24 24"
  fill="currentColor"
  aria-hidden="true"
  focusable="false"
><path d=${e}></path></svg>`;var K0=["paint","erase","pan"],j1=(e,C,H)=>{let{draw:V}=e,L=`${V.brushMeters.toFixed(2)} m`;return s`
    <div
      class=${`draw-tools draw-tools--${H} ms-segment`}
      role="toolbar"
      aria-label=${C.t("v4_draw_tools","Draw area tools")}
      data-map-control
    >
      ${K0.map(r=>s`
        <button
          class="ms-btn"
          type="button"
          aria-pressed=${String(V.tool===r)}
          data-tool=${r}
          @click=${()=>C.intent({type:"set-draw-tool",tool:r})}
        >${Z(r==="paint"?O3:r==="erase"?k3:P3)}<span class="ms-btn__label">${r==="paint"?C.t("area_paint","Paint"):r==="erase"?C.t("area_erase","Erase"):C.t("move_map","Move map")}</span></button>
      `)}
      <button
        class="ms-btn"
        type="button"
        ?disabled=${V.strokeCount===0}
        @click=${()=>C.intent({type:"undo-draft"})}
      >${Z(y3)}<span class="ms-btn__label">${C.t("undo","Undo")}</span></button>
      <button
        class="ms-btn"
        type="button"
        ?disabled=${V.redo.length===0}
        @click=${()=>C.intent({type:"redo-draft"})}
      >${Z(b3)}<span class="ms-btn__label">${C.t("redo","Redo")}</span></button>
      <button
        class="ms-btn draw-brush"
        type="button"
        aria-label=${C.t("v4_brush_button","Brush width, {brush}. Opens brush settings.").replace("{brush}",L)}
        aria-expanded=${String(e.precisionOpen)}
        aria-haspopup="dialog"
        @click=${C.openBrush}
      >${Z(w3)}<span class="ms-btn__label">${C.t("v4_brush","Brush {brush}").replace("{brush}",L)}</span></button>
    </div>
  `};var q0=e=>e.matches(":disabled, [aria-disabled='true']"),J1=class{#C;#H;#V=null;#t=null;constructor(C,H){this.#C=C,this.#H=H,C.addController(this)}hostConnected(){this.#C.addEventListener("focusin",this.#i)}hostDisconnected(){this.#C.removeEventListener("focusin",this.#i),this.#V?.removeEventListener("keydown",this.#a),this.#V=null,this.#t=null}hostUpdated(){let C=this.#H.container();C!==this.#V&&(this.#V?.removeEventListener("keydown",this.#a),C?.addEventListener("keydown",this.#a),this.#V=C),this.#M()}#L(){let C=this.#V;return C?[...C.querySelectorAll(this.#H.items)].filter(H=>!q0(H)):[]}#M(){let C=this.#L(),H=(this.#t&&C.includes(this.#t)?this.#t:null)??C.find(L=>L.matches("[aria-pressed='true'], [aria-checked='true']"))??C[0]??null;this.#t=H;let V=this.#V?.querySelectorAll(this.#H.items)??[];for(let L of V)L.tabIndex=L===H?0:-1}#i=C=>{let H=C.composedPath()[0];!(H instanceof HTMLElement)||!this.#V?.contains(H)||H.matches(this.#H.items)&&(this.#t=H,this.#M())};#a=C=>{if(C.defaultPrevented||C.ctrlKey||C.metaKey||C.altKey)return;let H=this.#H.orientation??"horizontal",V=H!=="vertical",L=H!=="horizontal",r=this.#L();if(!r.length)return;let t=C.composedPath()[0],M=Math.max(0,r.findIndex(a=>a===this.#t||t instanceof Node&&a.contains(t))),o;switch(C.key){case"ArrowLeft":if(!V)return;o=M-1;break;case"ArrowRight":if(!V)return;o=M+1;break;case"ArrowUp":if(!L)return;o=M-1;break;case"ArrowDown":if(!L)return;o=M+1;break;case"Home":o=0;break;case"End":o=r.length-1;break;default:return}C.preventDefault();let i=r[(o+r.length)%r.length];i&&(this.#t=i,this.#M(),i.focus())}};var X0={accent:["var(--ms-accent)","Highlight",[6,120,206]],onAccent:["var(--ms-on-accent)","HighlightText",[255,255,255]],text:["var(--ms-text)","CanvasText",[38,50,56]],quiet:["var(--ms-text-quiet)","GrayText",[75,92,105]],plate:["var(--ms-surface-card)","Canvas",[250,252,253]],roomFill:["var(--ms-surface-sunken)","Canvas",[231,238,242]]},Y0=e=>Math.max(0,Math.min(255,Math.round(e))),j0=e=>{let C=e.startsWith("color(srgb"),H=e.slice(e.indexOf("(")+1).match(/-?\d*\.?\d+/g);if(!H||H.length<3)return null;let V=C?255:1,L=H.slice(0,3).map(o=>Y0(Number(o)*V)),[r,t,M]=L;return r===void 0||t===void 0||M===void 0||[r,t,M].some(o=>Number.isNaN(o))?null:[r,t,M]},_=(e,C)=>`rgba(${e[0]},${e[1]},${e[2]},${C})`,R3=e=>{let C=window.matchMedia?.("(forced-colors: active)").matches??!1,H=document.createElement("span");H.setAttribute("aria-hidden","true"),H.style.cssText="position:absolute;inline-size:0;block-size:0;overflow:hidden;visibility:hidden;pointer-events:none",e.append(H);let V=L=>{let[r,t,M]=X0[L];return H.style.color=C?t:r,j0(getComputedStyle(H).color)??M};try{return{accent:V("accent"),onAccent:V("onAccent"),text:V("text"),quiet:V("quiet"),plate:V("plate"),roomFill:V("roomFill"),forced:C}}finally{H.remove()}};var F3=(e,C)=>Math.hypot(e.x-C.x,e.y-C.y),E3=(e,C)=>({x:(e.x+C.x)/2,y:(e.y+C.y)/2}),D3=(e,C)=>Math.atan2(C.y-e.y,C.x-e.x),J0=e=>{let C=e;for(;C>Math.PI;)C-=Math.PI*2;for(;C<-Math.PI;)C+=Math.PI*2;return C},o1=(e,C,H)=>Math.max(C,Math.min(H,e)),N2=e=>e.map(C=>({...C})),C7="button, input, select, textarea, a, [role='button'], [role='menuitem'], [data-map-control]",u1=e=>e.composedPath().some(C=>C instanceof Element&&C.matches(C7)),C2=class{#C;#H;#V;#t=new Map;#L=!1;#M="idle";#i=[];#a=[];#e=null;#d=0;#p=null;#Z=0;#h=null;#o=null;#S=null;#A=0;#n=null;#c=!1;#x=null;#m=!1;constructor(C,H,V){this.#C=C,this.#H=H,this.#V=V,C.addEventListener("pointerdown",this.#r),C.addEventListener("pointermove",this.#v),C.addEventListener("pointerup",this.#s),C.addEventListener("pointercancel",this.#s),C.addEventListener("wheel",this.#T,{passive:!1}),C.addEventListener("gesturestart",this.#f,{passive:!1}),C.addEventListener("gesturechange",this.#y,{passive:!1}),C.addEventListener("gestureend",this.#_,{passive:!1}),C.addEventListener("dblclick",this.#k),C.addEventListener("contextmenu",this.#b),C.addEventListener("keydown",this.#g),C.addEventListener("keyup",this.#P),C.addEventListener("blur",this.#O)}#r=C=>{if(this.#m||!C.isPrimary&&C.pointerType==="mouse"||u1(C))return;this.#C.focus({preventScroll:!0}),this.#w();let H=performance.now(),V={id:C.pointerId,type:C.pointerType,startX:C.clientX,startY:C.clientY,x:C.clientX,y:C.clientY,lastX:C.clientX,lastY:C.clientY,lastTime:H,velocityX:0,velocityY:0};if(this.#t.set(C.pointerId,V),this.#C.setPointerCapture?.(C.pointerId),this.#t.size>=2){this.#R(),(this.#M==="paint"||this.#M==="erase")&&(this.#a=N2(this.#i),this.#V.onCircles(this.#a,!1)),this.#M="pinch",this.#C.classList.add("navigating"),this.#c=!0;let[M,o]=[...this.#t.values()];M&&o&&(this.#d=Math.max(1,F3(M,o)),this.#p=E3(M,o),this.#Z=D3(M,o),this.#h=this.#H.camera),C.preventDefault();return}let L=this.#V.state(),r=L.workflow==="draw"&&L.map.available&&!L.floor.readOnly;this.#c||this.#L||C.button===1||C.button===2||L.draw.tool==="pan"?(this.#M="pan",this.#o=this.#H.camera):r&&(L.draw.tool==="paint"||L.draw.tool==="erase")?(this.#i=N2(L.draw.circles),this.#a=N2(L.draw.circles),C.pointerType==="touch"?(this.#M="idle",this.#x=window.setTimeout(()=>{if(this.#x=null,this.#t.size!==1||this.#c)return;this.#M=L.draw.tool;let M=this.#t.get(C.pointerId);M&&this.#l(M.x,M.y)},110)):(this.#M=L.draw.tool,this.#l(C.clientX,C.clientY))):(this.#M=L.view==="three"&&!C.shiftKey?"orbit":"pan",this.#o=this.#H.camera),(this.#M==="pan"||this.#M==="orbit")&&this.#C.classList.add("navigating"),C.preventDefault()};#v=C=>{let H=this.#t.get(C.pointerId);if(!H){let a=this.#H.screenToMap(C.clientX,C.clientY);this.#H.setCursor(a);return}let L=(C.getCoalescedEvents?.()||[]).at(-1)||C,r=performance.now(),t=Math.max(1,r-H.lastTime),M=(L.clientX-H.lastX)/t,o=(L.clientY-H.lastY)/t;if(H.velocityX=H.velocityX*.62+M*.38,H.velocityY=H.velocityY*.62+o*.38,H.lastX=L.clientX,H.lastY=L.clientY,H.lastTime=r,H.x=L.clientX,H.y=L.clientY,this.#M==="pinch"&&this.#t.size>=2){let[a,n]=[...this.#t.values()];if(!a||!n)return;let A=Math.max(1,F3(a,n)),d=E3(a,n),m=D3(a,n),u=this.#h;if(u&&this.#p){let h={...u,distance:u.distance*this.#d/A,yaw:u.yaw+J0(m-this.#Z),pitch:u.orthographic?u.pitch:u.pitch-(d.y-this.#p.y)*.0035};this.#H.setCamera(this.#H.cameraAfterPan(h,d.x-this.#p.x,d.y-this.#p.y))}C.preventDefault();return}this.#M==="paint"||this.#M==="erase"?this.#l(C.clientX,C.clientY):this.#M==="pan"?this.#o&&this.#H.setCamera(this.#H.cameraAfterPan(this.#o,L.clientX-H.startX,L.clientY-H.startY)):this.#M==="orbit"&&this.#o&&this.#H.setCamera({...this.#o,yaw:this.#o.yaw+(L.clientX-H.startX)*.0045,pitch:this.#o.pitch-(L.clientY-H.startY)*.004});let i=this.#H.screenToMap(L.clientX,L.clientY);this.#H.setCursor(i),C.preventDefault()};#s=C=>{let H=this.#t.get(C.pointerId);if(!H)return;let V=this.#M;if(this.#t.delete(C.pointerId),this.#C.releasePointerCapture?.(C.pointerId),this.#R(),(this.#M==="paint"||this.#M==="erase")&&JSON.stringify(this.#a)!==JSON.stringify(this.#i))this.#V.onCircles(this.#a,!0,this.#i);else if(this.#M!=="pinch"&&!this.#c&&Math.hypot(H.x-H.startX,H.y-H.startY)<7&&this.#V.state().workflow==="rooms"){let L=this.#H.roomAt(H.x,H.y);L&&this.#V.onRoom(L)}if(this.#t.size===0)this.#M="idle",this.#C.classList.remove("navigating"),this.#c=!1,this.#p=null,this.#h=null,this.#o=null,this.#e=null,(V==="pan"||V==="orbit")&&H.type!=="mouse"&&this.#B(H.velocityX,H.velocityY,V);else if(this.#M==="pinch"){this.#M="pan",this.#c=!0;let L=this.#t.values().next().value;L&&(L.startX=L.x,L.startY=L.y,L.velocityX=0,L.velocityY=0),this.#o=this.#H.camera,this.#h=null}C.preventDefault()};#l(C,H){let V=this.#H.screenToMap(C,H);if(!V)return;let r=this.#V.state().draw.brushMeters/2;if(this.#M==="erase")this.#a=this.#a.filter(t=>Math.hypot(t.x-V.x,t.y-V.y)>t.radius+r);else{if(!this.#H.containsMapPoint(V))return;let t=Math.max(.04,r*.55),M=this.#e||V,o=Math.hypot(V.x-M.x,V.y-M.y),i=Math.max(1,Math.ceil(o/t));for(let a=0;a<=i&&this.#a.length<512;a+=1){let n=a/i,A={x:M.x+(V.x-M.x)*n,y:M.y+(V.y-M.y)*n};this.#a.some(d=>Math.hypot(d.x-A.x,d.y-A.y)<Math.max(.025,r*.28))||this.#a.push({x:Math.round(A.x*1e4)/1e4,y:Math.round(A.y*1e4)/1e4,radius:Math.round(r*100)/100})}}this.#e=V,this.#V.onCircles(this.#a,!1)}#T=C=>{if(u1(C))return;C.preventDefault(),this.#C.focus({preventScroll:!0}),this.#w();let H=C.deltaMode===WheelEvent.DOM_DELTA_LINE?16:C.deltaMode===WheelEvent.DOM_DELTA_PAGE?Math.max(1,this.#C.clientHeight):1,V=C.deltaX*H,L=C.deltaY*H;if(C.ctrlKey||C.metaKey){this.#H.zoomAt(Math.exp(o1(-L*.008,-.28,.28)),C.clientX,C.clientY);return}if(C.altKey&&this.#V.state().view==="three"){this.#H.orbitBy(0,o1(L,-80,80)*.75);return}if(C.deltaMode!==WheelEvent.DOM_DELTA_PIXEL||Math.abs(V)<.5&&Math.abs(L)>=50){this.#H.zoomAt(Math.exp(o1(-L*.0025,-.28,.28)),C.clientX,C.clientY);return}this.#H.panBy(-o1(V,-80,80),-o1(L,-80,80))};#f=C=>{this.#m||u1(C)||(this.#C.focus({preventScroll:!0}),this.#w(),this.#C.classList.add("navigating"),this.#S=this.#H.camera,this.#A=Number.isFinite(C.rotation)?C.rotation:0,C.preventDefault())};#y=C=>{if(this.#m||u1(C))return;let H=this.#S;if(!H||this.#t.size>=2)return;let V=Number.isFinite(C.scale)&&C.scale>0?Math.max(.1,C.scale):1,L=Number.isFinite(C.rotation)?C.rotation:0;this.#H.setCamera({...H,distance:H.distance/V,yaw:H.yaw+(L-this.#A)*Math.PI/180}),C.preventDefault()};#_=C=>{this.#S=null,this.#A=0,this.#C.classList.remove("navigating"),C.preventDefault()};#g=C=>{if(C.defaultPrevented||C.ctrlKey||C.metaKey||C.altKey)return;if(C.code==="Space"){this.#L=!0,C.preventDefault();return}this.#w();let H=this.#V.state(),V=C.key.toLocaleLowerCase();if(C.key==="+"||C.key==="=")this.#H.zoomAt(1.25);else if(C.key==="-")this.#H.zoomAt(.8);else if(C.key==="0")this.#H.fit();else if(V==="3")this.#u({type:"set-view",view:"three"});else if(V==="t")this.#u({type:"set-view",view:"top"});else if(C.key==="[")this.#H.orbitBy(-40,0);else if(C.key==="]")this.#H.orbitBy(40,0);else if(C.key==="PageUp")this.#H.orbitBy(0,-30);else if(C.key==="PageDown")this.#H.orbitBy(0,30);else if(V==="d"&&H.workflow==="draw")this.#u({type:"set-draw-tool",tool:"paint"});else if(V==="e"&&H.workflow==="draw")this.#u({type:"set-draw-tool",tool:"erase"});else if(["arrowleft","arrowright","arrowup","arrowdown"].includes(V))if(H.view==="three"&&!C.shiftKey){let L=V==="arrowleft"?-24:V==="arrowright"?24:0,r=V==="arrowup"?-20:V==="arrowdown"?20:0;this.#H.orbitBy(L,r)}else{let L=V==="arrowleft"?30:V==="arrowright"?-30:0,r=V==="arrowup"?30:V==="arrowdown"?-30:0;this.#H.panBy(L,r)}else if(H.workflow!=="draw"&&["w","a","s","d"].includes(V))this.#H.panBy(V==="a"?34:V==="d"?-34:0,V==="w"?34:V==="s"?-34:0);else if(H.workflow!=="draw"&&(V==="q"||V==="e"))this.#H.orbitBy(V==="q"?-30:30,0);else return;C.preventDefault()};#P=C=>{C.code==="Space"&&(this.#L=!1)};#O=()=>{this.#L=!1,this.#R(),this.#H.setCursor(null),this.#C.classList.remove("navigating")};#k=C=>{u1(C)||(this.#w(),this.#H.zoomAt(C.shiftKey?1/1.6:1.6,C.clientX,C.clientY),C.preventDefault())};#b=C=>{u1(C)||C.preventDefault()};#u(C){this.#C.dispatchEvent(new CustomEvent("matic-workspace-intent",{detail:C,bubbles:!0,composed:!0}))}#B(C,H,V){if(window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;let L=o1(C,-.55,.55),r=o1(H,-.55,.55);if(Math.hypot(L,r)<.02)return;let t=performance.now(),M=o=>{let i=Math.min(32,o-t);t=o,V==="orbit"?this.#H.orbitBy(L*i,r*i):this.#H.panBy(L*i,r*i);let a=.9**(i/16);L*=a,r*=a,Math.hypot(L,r)>=.01?this.#n=window.requestAnimationFrame(M):this.#n=null};this.#n=window.requestAnimationFrame(M)}#w(){this.#n!==null&&window.cancelAnimationFrame(this.#n),this.#n=null}#R(){this.#x!==null&&window.clearTimeout(this.#x),this.#x=null}dispose(){this.#m||(this.#m=!0,this.#R(),this.#w(),this.#C.removeEventListener("pointerdown",this.#r),this.#C.removeEventListener("pointermove",this.#v),this.#C.removeEventListener("pointerup",this.#s),this.#C.removeEventListener("pointercancel",this.#s),this.#C.removeEventListener("wheel",this.#T),this.#C.removeEventListener("gesturestart",this.#f),this.#C.removeEventListener("gesturechange",this.#y),this.#C.removeEventListener("gestureend",this.#_),this.#C.removeEventListener("dblclick",this.#k),this.#C.removeEventListener("contextmenu",this.#b),this.#C.removeEventListener("keydown",this.#g),this.#C.removeEventListener("keyup",this.#P),this.#C.removeEventListener("blur",this.#O),this.#t.clear())}};var T=(e,C,H)=>Math.max(C,Math.min(H,e)),F1=e=>{let C=e;for(;C>Math.PI;)C-=Math.PI*2;for(;C<-Math.PI;)C+=Math.PI*2;return C},H7=e=>{switch(e){case"efficient":return .35;case"balanced":return .65;case"maximum":case"auto":return 1}},V7={accent:[6,120,206],onAccent:[255,255,255],text:[38,50,56],quiet:[75,92,105],plate:[250,252,253],roomFill:[231,238,242],forced:!1},I3=Math.PI/3.15,L7=1.08,e7=(e,C)=>{let H=I3/2,V=Math.atan(Math.tan(H)*Math.max(.2,C));return e/Math.sin(Math.min(H,V))*L7},r7=(e,C)=>{let H=new Float32Array(16);for(let V=0;V<4;V+=1)for(let L=0;L<4;L+=1){let r=0;for(let t=0;t<4;t+=1)r+=(e[t*4+L]??0)*(C[V*4+t]??0);H[V*4+L]=r}return H},t7=(e,C,H,V)=>{let L=1/Math.tan(e/2),r=new Float32Array(16);return r[0]=L/C,r[5]=L,r[10]=(V+H)/(H-V),r[11]=-1,r[14]=2*V*H/(H-V),r},M7=(e,C,H,V,L,r)=>{let t=new Float32Array(16);return t[0]=2/(C-e),t[5]=2/(V-H),t[10]=-2/(r-L),t[12]=-(C+e)/(C-e),t[13]=-(V+H)/(V-H),t[14]=-(r+L)/(r-L),t[15]=1,t},o7=(e,C)=>{let H=Math.hypot((e[0]??0)-(C[0]??0),(e[1]??0)-(C[1]??0),(e[2]??0)-(C[2]??0))||1,V=[((e[0]??0)-(C[0]??0))/H,((e[1]??0)-(C[1]??0))/H,((e[2]??0)-(C[2]??0))/H],L=Math.hypot(V[2]??0,V[0]??0)||1,r=[(V[2]??0)/L,0,-(V[0]??0)/L],t=[(V[1]??0)*(r[2]??0),(V[2]??0)*(r[0]??0)-(V[0]??0)*(r[2]??0),-(V[1]??0)*(r[0]??0)];return new Float32Array([r[0]??0,t[0]??0,V[0]??0,0,r[1]??0,t[1]??0,V[1]??0,0,r[2]??0,t[2]??0,V[2]??0,0,-((r[0]??0)*(e[0]??0)+(r[1]??0)*(e[1]??0)+(r[2]??0)*(e[2]??0)),-((t[0]??0)*(e[0]??0)+(t[1]??0)*(e[1]??0)+(t[2]??0)*(e[2]??0)),-((V[0]??0)*(e[0]??0)+(V[1]??0)*(e[1]??0)+(V[2]??0)*(e[2]??0)),1])},$3=(e,C,H)=>{let V=!1,L=H.at(-1);if(!L)return!1;for(let r of H){let[t,M]=r,[o,i]=L;M>C!=i>C&&e<(o-t)*(C-M)/(i-M)+t&&(V=!V),L=r}return V},H2=class{#C;#H;#V;#t=null;#L=null;#M=null;#i=null;#a=null;#e=null;#d=null;#p=null;#Z=null;#h=null;#o=null;#S=null;#A=null;#n=null;#c=null;#x=null;#m;#r={yaw:-Math.PI/4,pitch:.82,distance:12,targetX:0,targetZ:0,orthographic:!1};#v=12;#s=8;#l=4;#T=new Float32Array(16);#f=null;#y="unavailable";#_=0;#g=0;#P=0;#O=0;#k=1;#b={width:1,height:1,left:0,top:0};#u=!0;#B=!1;#w=V7;constructor(C,H,V={}){this.#C=C,this.#H=H,this.#V=V,this.#L=H.getContext("2d",{alpha:!0}),this.#C.addEventListener("webglcontextlost",this.#r1),this.#C.addEventListener("webglcontextrestored",this.#t1),this.#$(),this.#m=new ResizeObserver(()=>{let L=this.#v,r=this.#s;this.#K(),this.#u&&(L!==this.#v||r!==this.#s)?this.fit(!1):this.requestRender()}),this.#m.observe(C)}get camera(){return{...this.#r}}#R(){return{minimum:Math.max(.2,this.#l*.04),maximum:this.#l*8}}#U(){let C=this.#n?.metadata.span,H=this.#n?.metadata.metersPerCell;return!C||H===void 0?{x:this.#l,z:this.#l}:{x:Math.max(.5,C[0]*H*.55),z:Math.max(.5,C[1]*H*.55)}}setCamera(C,H=!0){let V=this.#R(),L=this.#U();this.#r={yaw:F1(C.yaw),pitch:C.orthographic?Math.PI/2-.018:T(C.pitch,.18,1.38),distance:T(C.distance,V.minimum,V.maximum),targetX:T(C.targetX,-L.x,L.x),targetZ:T(C.targetZ,-L.z,L.z),orthographic:C.orthographic},this.#u=!1,this.requestRender(),H&&this.#z()}cameraAfterPan(C,H,V){let L=this.#F(),r=C.distance*1.75/Math.max(200,L.height),t=Math.cos(C.yaw),M=-Math.sin(C.yaw),o=-Math.sin(C.yaw),i=-Math.cos(C.yaw),a=this.#U();return{...C,targetX:T(C.targetX-H*r*t+V*r*o,-a.x,a.x),targetZ:T(C.targetZ-H*r*M+V*r*i,-a.z,a.z)}}setState(C){if(this.#B)return;let H=this.#A;this.#A=C;let V=C.resources.scene.value;V!==this.#n&&(this.#n=V,this.#J(V)),(!H||H.quality!==C.quality)&&(this.#k=H7(C.quality),this.#O=0);let L=H?.workflow!=="draw"&&C.workflow==="draw",r=H?.workflow==="draw"&&C.workflow!=="draw";if(!H||H.view!==C.view||L||r){let t=C.workflow==="draw"?"top":C.view;this.#r=this.#j(t,C),this.#u=this.#G(t,C)}C.workflow==="draw"&&H?.draw.zoomPercent!==C.draw.zoomPercent&&(this.#r={...this.#r,orthographic:!0,pitch:Math.PI/2-.018,distance:this.#s*100/C.draw.zoomPercent},this.#u=C.draw.zoomPercent===100&&Math.abs(this.#r.targetX)<.001&&Math.abs(this.#r.targetZ)<.001&&Math.abs(F1(this.#r.yaw))<.001),this.requestRender()}#j(C,H){let V=C==="top",L=V?this.#s:this.#v,r=H.cameras[C];return r?{yaw:r.yaw,pitch:V?Math.PI/2-.018:r.pitch,distance:T(L/T(r.zoom,.01,100),Math.max(.2,this.#l*.04),this.#l*8),targetX:T(r.targetX,-this.#l,this.#l),targetZ:T(r.targetZ,-this.#l,this.#l),orthographic:V}:V?{yaw:0,pitch:Math.PI/2-.018,distance:L,targetX:0,targetZ:0,orthographic:!0}:{yaw:-Math.PI/4,pitch:.82,distance:L,targetX:0,targetZ:0,orthographic:!1}}#G(C,H){let V=H.cameras[C];if(!V)return!0;let L=C==="top";return Math.abs(V.zoom-1)<.001&&Math.abs(V.targetX)<.001&&Math.abs(V.targetZ)<.001&&Math.abs(F1(V.yaw-(L?0:-Math.PI/4)))<.001&&(L||Math.abs(V.pitch-.82)<.001)}#Q(C,H){let V=this.#t;if(!V)throw new Error("webgl-unavailable");let L=V.createShader(C);if(!L)throw new Error("shader-unavailable");if(V.shaderSource(L,H),V.compileShader(L),!V.getShaderParameter(L,V.COMPILE_STATUS))throw V.deleteShader(L),new Error("shader-failed");return L}#$(){try{this.#t=this.#C.getContext("webgl2",{alpha:!0,antialias:!0,depth:!0,powerPreference:"high-performance"});let C=this.#t;if(!C)throw new Error("webgl2-unavailable");let H=this.#Q(C.VERTEX_SHADER,`#version 300 es
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
      `),V=this.#Q(C.FRAGMENT_SHADER,`#version 300 es
        precision highp float;
        in vec3 vColor;
        out vec4 outColor;
        void main() {
          vec2 point = gl_PointCoord * 2.0 - 1.0;
          if (dot(point, point) > 1.0) discard;
          float edge = smoothstep(1.0, 0.72, dot(point, point));
          outColor = vec4(pow(vColor, vec3(0.94)), edge);
        }
      `),L=C.createProgram();if(!L)throw new Error("program-unavailable");if(C.attachShader(L,H),C.attachShader(L,V),C.linkProgram(L),C.deleteShader(H),C.deleteShader(V),!C.getProgramParameter(L,C.LINK_STATUS))throw new Error("program-failed");this.#a=L,this.#p=C.getUniformLocation(L,"uViewProjection"),this.#Z=C.getUniformLocation(L,"uCenter"),this.#h=C.getUniformLocation(L,"uMetersPerCell"),this.#o=C.getUniformLocation(L,"uPointPixels"),this.#S=C.getUniformLocation(L,"uMaxPointPixels"),this.#e=C.createBuffer(),this.#d=C.createVertexArray(),C.bindVertexArray(this.#d),C.bindBuffer(C.ARRAY_BUFFER,this.#e),C.enableVertexAttribArray(0),C.vertexAttribIPointer(0,2,C.UNSIGNED_SHORT,8,0),C.enableVertexAttribArray(1),C.vertexAttribIPointer(1,1,C.UNSIGNED_BYTE,8,4),C.enableVertexAttribArray(2),C.vertexAttribPointer(2,3,C.UNSIGNED_BYTE,!0,8,5),C.bindVertexArray(null),C.enable(C.DEPTH_TEST),C.depthFunc(C.LEQUAL),C.enable(C.BLEND),C.blendFunc(C.SRC_ALPHA,C.ONE_MINUS_SRC_ALPHA),this.#y="webgl2",this.#_+=1,this.#n&&this.#E(this.#n)}catch{this.#Y(),this.#I()}}#J(C){if(this.#D(),!C){this.#g=0,this.requestRender();return}let[H,V]=C.metadata.span,L=C.metadata.metersPerCell,r=H*L,t=V*L;this.#l=Math.max(1,Math.hypot(r,t)/2),this.#K(),this.fit(!1),this.#y==="webgl2"?this.#E(C):this.#W(C)}#K(){let C=this.#n;if(!C)return;let[H,V]=C.metadata.span,L=C.metadata.metersPerCell,r=H*L,t=V*L,M=this.#F(),o=Math.max(.2,M.width/Math.max(1,M.height));this.#v=e7(this.#l,o),this.#s=Math.max(t/2,r/(2*o))*1.12}#E(C){let H=this.#t;if(!H||!this.#e)return;let V=new Uint8Array(C.buffer,C.pointOffset,C.total*8);H.bindBuffer(H.ARRAY_BUFFER,this.#e),H.bufferData(H.ARRAY_BUFFER,V,H.STATIC_DRAW),this.#g=C.total}#I(){this.#y="canvas2d",this.#i=document.createElement("canvas"),this.#i.width=1024,this.#i.height=1024,this.#M=this.#i.getContext("2d",{alpha:!0}),this.#M?this.#n&&this.#W(this.#n):(this.#y="unavailable",this.#V.onProblem?.("renderer-unavailable"))}#W(C){let H=this.#M;if(!H||!this.#i)return;H.clearRect(0,0,this.#i.width,this.#i.height);let V=new DataView(C.buffer,C.pointOffset,C.total*8),L=Math.min(C.total,5e4),r=Math.max(1,Math.ceil(C.total/L)),t=0,M=0,o=()=>{if(this.#B||C!==this.#n||!this.#i)return;let i=Math.min(C.total,t+r*4e3);for(;t<i;t+=r){let a=t*8,n=V.getUint16(a,!0)/Math.max(1,C.metadata.span[0])*this.#i.width,A=V.getUint16(a+2,!0)/Math.max(1,C.metadata.span[1])*this.#i.height,d=V.getUint8(a+5),m=V.getUint8(a+6),u=V.getUint8(a+7);H.fillStyle=`rgb(${d} ${m} ${u})`,H.fillRect(n,A,1.5,1.5),M+=1}this.#g=M,this.requestRender(),t<C.total?this.#x=window.setTimeout(o,0):this.#x=null};o()}#D(){this.#x!==null&&window.clearTimeout(this.#x),this.#x=null}#F(){let C=this.#C.getBoundingClientRect();return this.#b={width:C.width,height:C.height,left:C.left,top:C.top},this.#b}#q(){let C=this.#F(),H=Math.min(window.devicePixelRatio||1,3),V=Math.max(1,Math.round(C.width*H)),L=Math.max(1,Math.round(C.height*H));for(let r of[this.#C,this.#H])(r.width!==V||r.height!==L)&&(r.width=V,r.height=L)}#C1(){let C=this.#b,H=Math.max(.2,C.width/Math.max(1,C.height)),V=Math.cos(this.#r.pitch)*this.#r.distance,L=[this.#r.targetX+Math.sin(this.#r.yaw)*V,Math.sin(this.#r.pitch)*this.#r.distance,this.#r.targetZ+Math.cos(this.#r.yaw)*V],r=[this.#r.targetX,0,this.#r.targetZ],t=o7(L,r),M=this.#r.orthographic?M7(-this.#r.distance*H,this.#r.distance*H,-this.#r.distance,this.#r.distance,-this.#l*4,this.#l*4):t7(I3,H,.02,Math.max(60,this.#l*12));return r7(M,t)}requestRender(){this.#c!==null||this.#B||(this.#c=window.requestAnimationFrame(()=>{this.#c=null,this.#H1()}))}#H1(){let C=performance.now();this.#q(),this.#T=this.#C1(),this.#y==="webgl2"?this.#X():this.#V1(),this.#M1(),this.#P=performance.now()-C,this.#P>18?(this.#O+=1,this.#O>=3&&this.#A?.quality==="auto"&&(this.#k=Math.max(.25,this.#k*.75))):this.#O=Math.max(0,this.#O-1)}#X(){let C=this.#t,H=this.#n;if(!C||(C.viewport(0,0,this.#C.width,this.#C.height),C.clearColor(0,0,0,0),C.clear(C.COLOR_BUFFER_BIT|C.DEPTH_BUFFER_BIT),!H||!this.#a||!this.#d))return;if(this.#A?.view==="top"&&this.#A.appearance==="rooms"){this.#g=0;return}C.useProgram(this.#a),C.bindVertexArray(this.#d),C.uniformMatrix4fv(this.#p,!1,this.#T),C.uniform2f(this.#Z,(H.metadata.span[0]-1)/2,(H.metadata.span[1]-1)/2),C.uniform1f(this.#h,H.metadata.metersPerCell);let V=Math.min(window.devicePixelRatio||1,3),L=Math.max(1,Math.floor(H.total*this.#k)),r=Math.min(H.floorCount,L),t=Math.min(H.surfaceCount,Math.max(0,L-r));C.uniform1f(this.#o,this.#C.height*.038),C.uniform1f(this.#S,4.5*V),C.drawArrays(C.POINTS,0,r),C.uniform1f(this.#o,this.#C.height*.05),C.uniform1f(this.#S,7*V),C.drawArrays(C.POINTS,H.floorCount,t),C.bindVertexArray(null),this.#g=r+t}#V1(){}#L1(C,H,V=0){let L=this.#n;return L?[-(C-(L.metadata.span[0]-1)/2)*L.metadata.metersPerCell,V*L.metadata.metersPerCell,(H-(L.metadata.span[1]-1)/2)*L.metadata.metersPerCell]:null}#e1(C,H,V=0,L=!0){let r=this.#L1(C,H,V);if(!r)return null;let[t,M,o]=r,i=this.#T,a=(i[0]??0)*t+(i[4]??0)*M+(i[8]??0)*o+(i[12]??0),n=(i[1]??0)*t+(i[5]??0)*M+(i[9]??0)*o+(i[13]??0),A=(i[3]??0)*t+(i[7]??0)*M+(i[11]??0)*o+(i[15]??0);if(A<=.001)return null;let d=a/A,m=n/A;if(!Number.isFinite(d)||!Number.isFinite(m)||L&&(Math.abs(d)>1.15||Math.abs(m)>1.15))return null;let u=this.#b;return{x:(d*.5+.5)*u.width,y:(-m*.5+.5)*u.height}}#N(C,H,V=0){let L=this.#n;if(!L)return null;let r=C/L.metadata.metersPerCell-L.metadata.origin[0],t=H/L.metadata.metersPerCell-L.metadata.origin[1];return this.#e1(r,t,V)}#M1(){let C=this.#L,H=this.#n,V=this.#A;if(!C)return;let L=Math.min(window.devicePixelRatio||1,3),r=this.#b;if(C.setTransform(L,0,0,L,0,0),C.clearRect(0,0,r.width,r.height),!H||!V)return;let t=this.#w;if(this.#y==="canvas2d"&&this.#i&&!(V.view==="top"&&V.appearance==="rooms")){let a=this.#s/this.#r.distance,n=r.width*a,A=r.height*a,d=(r.width-n)/2-this.#r.targetX*32*a,m=(r.height-A)/2-this.#r.targetZ*32*a;C.drawImage(this.#i,d,m,n,A)}let M=this.#o1(V);if(V.labelsVisible||V.view==="top"&&V.appearance==="rooms"){C.lineWidth=1.5,C.font="600 12px system-ui, sans-serif",C.textAlign="center",C.textBaseline="middle";let a=[];for(let n of H.metadata.rooms){let A=M.has(n.name.toLocaleLowerCase());C.strokeStyle=A?_(t.accent,1):_(t.quiet,.7),C.fillStyle=A?_(t.accent,.26):V.view==="top"&&V.appearance==="rooms"?_(t.roomFill,.94):_(t.plate,.04),C.beginPath();let d=Math.max(1,Math.ceil(n.boundary.length/512)),m=!1;for(let f=0;f<n.boundary.length;f+=d){let S=n.boundary[f];if(!S)continue;let y=this.#e1(S[0],S[1],.2,!1);y&&(m?C.lineTo(y.x,y.y):C.moveTo(y.x,y.y),m=!0)}if(m&&(C.closePath(),C.fill(),C.stroke()),!V.labelsVisible)continue;let u=this.#e1(n.center[0],n.center[1],1);if(!u)continue;let h=C.measureText(n.name).width,x=new DOMRect(u.x-h/2-6,u.y-10,h+12,20);a.some(f=>x.left<f.right+8&&x.right+8>f.left&&x.top<f.bottom+4&&x.bottom+4>f.top)||(a.push(x),C.fillStyle=_(t.plate,.88),C.fillRect(x.x,x.y,x.width,x.height),C.fillStyle=_(t.text,1),C.fillText(n.name,u.x,u.y))}}let o=V.draw.circles;if((V.workflow==="draw"||V.workflow==="areaReview")&&o.length){C.fillStyle=_(t.accent,.22),C.strokeStyle=_(t.accent,.92),C.lineWidth=1.5;for(let a of o)this.#i1(C,a)}if(this.#f&&V.workflow==="draw"&&V.draw.tool!=="pan"){let a=this.#N(this.#f.x,this.#f.y),n=this.#N(this.#f.x+V.draw.brushMeters/2,this.#f.y);a&&n&&(C.beginPath(),C.arc(a.x,a.y,Math.max(2,Math.hypot(n.x-a.x,n.y-a.y)),0,Math.PI*2),C.strokeStyle=_(t.accent,1),C.lineWidth=2,C.stroke())}let i=V.resources.pose.value;if(V.map.exactPose&&i?.position&&V.dataMode==="live"){let a=this.#N(i.position[0],i.position[1],3);a&&(C.beginPath(),C.arc(a.x,a.y,7,0,Math.PI*2),C.fillStyle=_(t.accent,1),C.fill(),C.strokeStyle=_(t.onAccent,1),C.lineWidth=3,C.stroke())}}#o1(C){let H=C.resources.plans.value?.rooms||C.resources.areas.value?.rooms||[];return new Set(H.filter(V=>C.selection.roomIds.includes(V.roomId)).map(V=>V.name.toLocaleLowerCase()))}#i1(C,H){let V=this.#N(H.x,H.y),L=this.#N(H.x+H.radius,H.y);!V||!L||(C.beginPath(),C.arc(V.x,V.y,Math.max(1,Math.hypot(L.x-V.x,L.y-V.y)),0,Math.PI*2),C.fill(),C.stroke())}setPalette(C){this.#w=C,this.requestRender()}setCursor(C){this.#f=C,this.requestRender()}screenToMap(C,H){let V=this.#n;if(!V||!this.#r.orthographic)return null;let L=this.#F();if(!L.width||!L.height)return null;let r=this.#r.distance*2/L.height,t=this.#r.targetX+(C-L.left-L.width/2)*r,M=this.#r.targetZ+(H-L.top-L.height/2)*r,o=-t/V.metadata.metersPerCell+(V.metadata.span[0]-1)/2,i=M/V.metadata.metersPerCell+(V.metadata.span[1]-1)/2;return{x:(o+V.metadata.origin[0])*V.metadata.metersPerCell,y:(i+V.metadata.origin[1])*V.metadata.metersPerCell}}roomAt(C,H){let V=this.screenToMap(C,H),L=this.#n,r=this.#A;if(!V||!L||!r)return null;let t=V.x/L.metadata.metersPerCell-L.metadata.origin[0],M=V.y/L.metadata.metersPerCell-L.metadata.origin[1],o=L.metadata.rooms.find(i=>$3(t,M,i.boundary));return o?this.#a1(o,r):null}containsMapPoint(C){let H=this.#n;if(!H)return!1;let V=C.x/H.metadata.metersPerCell-H.metadata.origin[0],L=C.y/H.metadata.metersPerCell-H.metadata.origin[1];return H.metadata.rooms.some(r=>$3(V,L,r.boundary))}#a1(C,H){return(H.resources.plans.value?.rooms||H.resources.areas.value?.rooms||[]).find(L=>L.name.localeCompare(C.name,void 0,{sensitivity:"base"})===0)?.roomId||C.id}selectRoomAt(C,H){let V=this.roomAt(C,H);V&&this.#V.onRoom?.(V)}fit(C=!0){let H=this.#A?.view==="top"||this.#A?.workflow==="draw";this.#r=H?{yaw:0,pitch:Math.PI/2-.018,distance:this.#s,targetX:0,targetZ:0,orthographic:!0}:{yaw:-Math.PI/4,pitch:.82,distance:this.#v,targetX:0,targetZ:0,orthographic:!1},this.#u=!0,this.requestRender(),C&&this.#z()}zoomAt(C,H,V){let L=H===void 0||V===void 0?null:this.screenToMap(H,V),r=this.#R();if(this.#r={...this.#r,distance:T(this.#r.distance/C,r.minimum,r.maximum)},this.#u=!1,L&&H!==void 0&&V!==void 0){let t=this.screenToMap(H,V);t&&(this.#r={...this.#r,targetX:this.#r.targetX-(L.x-t.x),targetZ:this.#r.targetZ+(L.y-t.y)})}this.requestRender(),this.#z(H,V)}panBy(C,H){this.setCamera(this.cameraAfterPan(this.#r,C,H))}orbitBy(C,H){if(this.#r.orthographic){this.panBy(C,H);return}this.#r={...this.#r,yaw:F1(this.#r.yaw+C*.006),pitch:T(this.#r.pitch-H*.004,.18,1.38)},this.#u=!1,this.requestRender(),this.#z()}rotateBy(C){this.#r={...this.#r,yaw:F1(this.#r.yaw+C)},this.#u=!1,this.requestRender(),this.#z()}#z(C,H){let V=this.#r.orthographic?this.#s:this.#v,L=C===void 0||H===void 0?this.#b:this.#F(),r=C===void 0||H===void 0||!L.width||!L.height?void 0:{xPercent:T((C-L.left)/L.width*100,0,100),yPercent:T((H-L.top)/L.height*100,0,100)};this.#V.onCamera?.(this.camera,Math.round(V/this.#r.distance*100),r)}diagnostics(){return{mode:this.#y,contextGeneration:this.#_,sceneRevision:this.#n?.revision??null,sourcePoints:this.#n?.total??0,renderedPoints:this.#g,lastFrameMs:Math.round(this.#P*100)/100,slowFrames:this.#O,cameraDistance:this.#r.distance,fitDistance:this.#r.orthographic?this.#s:this.#v,fitActive:this.#u}}#r1=C=>{C.preventDefault(),this.#Y(),this.#I(),this.requestRender()};#t1=()=>{this.#Y(),this.#$(),this.requestRender()};#Y(){let C=this.#t;C&&(this.#e&&C.deleteBuffer(this.#e),this.#d&&C.deleteVertexArray(this.#d),this.#a&&C.deleteProgram(this.#a)),this.#e=null,this.#d=null,this.#a=null,this.#t=null}dispose(){this.#B||(this.#B=!0,this.#m.disconnect(),this.#C.removeEventListener("webglcontextlost",this.#r1),this.#C.removeEventListener("webglcontextrestored",this.#t1),this.#c!==null&&window.cancelAnimationFrame(this.#c),this.#c=null,this.#D(),this.#Y(),this.#i=null,this.#M=null,this.#L=null,this.#n=null,this.#A=null)}};var W3="component.matic_robot.common.",B=(e,C,H,V)=>{let L=V?{...V}:void 0,r=e?.(`${W3}${C}`,L);return r&&r!==`${W3}${C}`?r:V?Object.entries(V).reduce((t,[M,o])=>t.replaceAll(`{${M}}`,String(o)),H):H};var i1="matic-workspace-intent",V2="matic-workspace-action",N3="navigation-help",z3=(e,C)=>{let H=(L,r,t)=>B(C,L,r,t);if(!s1(e))return H("v4_private_map_unavailable","The current private map is not available.");if(e.dataMode==="history")return H("v4_saved_map_description","Saved read-only map for {floor}. Live robot position is hidden.",{floor:e.floor.displayName});let V=a5(e)?H("v4_robot_position_verified","The robot position is verified."):H("v4_robot_position_hidden","The robot position is not shown.");return H("v4_live_map_description","Live map for {floor}. {pose}",{floor:e.floor.displayName,pose:V})},z2=class extends O{constructor(){super();this.state=k();this.narrow=!1;this.#C=null;this.#H=null;this.#V=null;this.#t=null;this.#L=!1;this.#M=!1;this.#i=null;this.#a=[];this.#p=()=>{this.#d()};new J1(this,{container:()=>this.renderRoot?.querySelector(".camera-steps")??null,items:"button"})}static{this.properties={state:{attribute:!1},localize:{attribute:!1},narrow:{type:Boolean,reflect:!0}}}static{this.styles=[E,D,J,b`
    :host {
      display: block;
      min-width: 0;
      min-height: 0;
      block-size: 100%;
      color: var(--primary-text-color, #1f2933);
    }


    button, input { font: inherit; }

    .map-root {
      position: relative;
      overflow: hidden;
      min-block-size: 22rem;
      block-size: 100%;
      outline: none;
      isolation: isolate;
      background: var(--secondary-background-color, #edf2f4);
      touch-action: none;
      cursor: grab;
      container-type: inline-size;
    }

    .map-root.navigating { cursor: grabbing; }
    .map-root[data-workflow="draw"][data-draw-tool="paint"],
    .map-root[data-workflow="draw"][data-draw-tool="erase"] { cursor: crosshair; }
    .map-root[data-workflow="draw"][data-draw-tool="pan"] { cursor: grab; }
    .map-root[data-workflow="draw"][data-draw-tool="pan"].navigating { cursor: grabbing; }

    .map-root:focus-visible {
      outline: 3px solid var(--primary-color, #03a9f4);
      outline-offset: -3px;
    }

    /* One self-packing rail replaces the old ladder of absolutely positioned
       siblings whose offsets (0.75 / 4.25 / 7.2rem) encoded which of the
       others happened to be visible. Groups simply stack; a hidden group
       leaves no hole. */
    .map-rail {
      position: absolute;
      z-index: 4;
      inset-block-start: 0.75rem;
      inset-inline-end: 0.75rem;
      display: flex;
      flex-direction: column;
      gap: var(--ms-space-2);
      align-items: flex-end;
      max-inline-size: calc(100% - 1.5rem);
    }
    :host([narrow]) .map-rail,
    .map-root[data-narrow] .map-rail {
      inset-block-start: auto;
      inset-block-end: calc(0.75rem + var(--map-sheet-offset, 0px));
      inset-inline-end: 0.75rem;
    }

    .map-tools, .view-switch, .appearance-switch, .camera-steps { display: flex; }

    .map-dock, .map-scale, .map-message { position: absolute; z-index: 4; }

    .map-dock {
      inset-inline-start: 50%;
      inset-block-end: calc(0.75rem + var(--map-sheet-offset, 0px));
      translate: -50% 0;
      max-inline-size: calc(100% - 1rem);
    }
    .map-dock .draw-tools--row { flex-direction: row; gap: var(--ms-space-1); }
    .map-dock .draw-tools button { padding-inline: var(--ms-space-2); }
    .selection-chip {
      display: flex;
      align-items: center;
      gap: var(--ms-space-3);
      padding: var(--ms-space-1) var(--ms-space-1) var(--ms-space-1) var(--ms-space-3);
      font-size: var(--ms-t-sm);
      font-weight: var(--ms-w-bold);
      white-space: nowrap;
    }

    .navigation-help {
      inline-size: 22rem;
      max-inline-size: 100%;
      padding: 0.8rem 0.9rem;
      font-size: 0.74rem;
      line-height: 1.45;
    }
    .navigation-help header { display: flex; align-items: center; justify-content: space-between; gap: var(--ms-space-2); margin-block-end: 0.5rem; }
    .navigation-help h3 { margin: 0; font-size: var(--ms-t-sm); font-weight: var(--ms-w-bold); }
    .navigation-help dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.35rem 0.65rem; margin: 0; }
    .navigation-help dt { font-weight: 750; }
    .navigation-help dd { margin: 0; color: var(--secondary-text-color, #687984); }

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

    .map-message {
      inset: 50% auto auto 50%;
      translate: -50% -50%;
      inline-size: min(22rem, calc(100% - 2rem));
      padding: 1rem 1.1rem;
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
.map-tools button, .map-dock .draw-tools button { padding-inline: 0; inline-size: var(--ms-control); }
/* Collapse the label to assistive text, never display:none. Hiding it would
   delete the accessible name and break every getByRole({ name }) query at
   narrow widths -- which is what the previous font-size:0 plus ::first-letter
   trick did, while also rendering the toolbar as "P E M U R D". */
.map-tools .ms-btn__label, .map-dock .draw-tools .ms-btn__label { position: absolute; overflow: hidden; inline-size: 1px; block-size: 1px; margin: -1px; padding: 0; border: 0; clip-path: inset(50%); white-space: nowrap; }
}
@media (forced-colors: active) {
/* The map is painted to canvas, so the UA would otherwise invert it. The
   previous block here targeted the mock-map layer that the renderer replaced,
   which meant the map had no forced-colors treatment at all. */
.scene-canvas, .overlay-canvas { forced-color-adjust: none; }
.map-root { border: 1px solid CanvasText; }
}
  `]}#C;#H;#V;#t;#L;#M;#i;#a;#e(H,V,L){return B(this.localize,H,V,L)}connectedCallback(){super.connectedCallback(),this.#Z()}firstUpdated(){let H=this.renderRoot.querySelector(".map-root"),V=this.renderRoot.querySelector(".scene-canvas"),L=this.renderRoot.querySelector(".overlay-canvas");!H||!V||!L||(this.#V=new H2(V,L,{onCamera:(r,t,M)=>{this.#o({type:"set-camera",view:this.state.workflow==="draw"?"top":this.state.view,camera:{yaw:r.yaw,pitch:r.pitch,zoom:t/100,targetX:r.targetX,targetZ:r.targetZ}}),this.state.workflow==="draw"&&t!==this.state.draw.zoomPercent&&this.#o({type:"set-zoom",value:t,...M?{originX:M.xPercent,originY:M.yPercent}:{}})},onRoom:r=>this.#o({type:"toggle-room",roomId:r}),onProblem:()=>this.#S("renderer-problem")}),this.#t=new C2(H,this.#V,{state:()=>this.state,onCircles:(r,t,M)=>this.#o({type:"set-draft-circles",circles:r,record:t,...M?{previous:M}:{}}),onRoom:r=>this.#o({type:"toggle-room",roomId:r})}),this.#d(),this.#V.setState(this.state))}disconnectedCallback(){this.#h(),this.#t?.dispose(),this.#t=null,this.#V?.dispose(),this.#V=null,super.disconnectedCallback()}updated(H){if(this.#M&&(this.#M=!1,this.renderRoot.querySelector(".navigation-help button")?.focus()),!H.has("state"))return;H.get("state")?.fullMap&&!this.state.fullMap&&this.#C&&this.#C.focus(),this.#V?.setState(this.state)}#d(){let H=this.renderRoot?.querySelector(".map-root");!H||!this.#V||this.#V.setPalette(R3(H))}#p;#Z(){if(!(typeof document>"u"||this.#i)&&(this.#i=new MutationObserver(this.#p),this.#i.observe(document.documentElement,{attributes:!0,attributeFilter:["style","class"]}),typeof window.matchMedia=="function")){this.#a=[window.matchMedia("(prefers-color-scheme: dark)"),window.matchMedia("(forced-colors: active)")];for(let H of this.#a)H.addEventListener("change",this.#p)}}#h(){this.#i?.disconnect(),this.#i=null;for(let H of this.#a)H.removeEventListener("change",this.#p);this.#a=[]}#o(H){this.dispatchEvent(new CustomEvent(i1,{detail:H,bubbles:!0,composed:!0}))}#S(H){this.dispatchEvent(new CustomEvent(V2,{detail:{id:H},bubbles:!0,composed:!0}))}#A(H){this.#C=H.currentTarget,this.#o({type:this.state.fullMap?"exit-full-map":"enter-full-map"})}#n(H){this.#H=H.currentTarget,this.#L=!this.#L,this.#M=this.#L,this.requestUpdate()}#c(){if(!this.#L)return;this.#L=!1,this.requestUpdate();let H=this.#H;H?.isConnected&&H.focus()}#x(){for(let H of this.state.selection.roomIds)this.#o({type:"toggle-room",roomId:H})}#m(H,V){this.#V?.orbitBy(H,V)}#r(H){if(!(H.ctrlKey||H.metaKey||H.altKey)&&H.key==="Escape"){if(H.preventDefault(),this.#L){this.#c();return}this.#o({type:"dismiss-top-layer"});return}}rendererDiagnostics(){return this.#V?.diagnostics()??null}canvasIdentity(){return{scene:this.renderRoot.querySelector(".scene-canvas"),overlay:this.renderRoot.querySelector(".overlay-canvas")}}#v(){return this.state.host.connected?this.state.host.administrator?this.state.host.robotCount===0?{title:this.#e("v4_no_robot","No Matic robot set up"),detail:this.#e("v4_no_robot_detail","Set up a robot before opening its map.")}:this.state.host.robotConnected?this.state.coherence==="verifying"||this.state.coherence==="booting"?{title:this.#e("v4_locating_map","Locating the current map"),detail:this.#e("v4_locating_map_detail","Map controls will return after the floor is verified.")}:!this.state.map.available&&this.state.resources.scene.status==="loading"?{title:this.#e("v4_loading_verified_map","Loading the verified map"),detail:this.#e("v4_loading_verified_map_detail","The current floor is verified. The private scene is still preparing.")}:this.state.map.available?this.state.activity==="problem"?{title:this.#e("v4_robot_attention","Robot needs attention"),detail:this.#e("v4_robot_attention_detail","Check the robot before starting another task.")}:null:{title:this.#e("v4_map_unavailable","Map unavailable"),detail:this.#e("v4_map_unavailable_detail","The private scene is not ready. No map data is shown until it is verified.")}:{title:this.#e("v4_robot_offline","Robot offline"),detail:this.#e("v4_robot_offline_detail","The last verified map stays read only and has no live position.")}:{title:this.#e("v4_admin_required","Administrator access required"),detail:this.#e("v4_private_map_hidden","Private map data is hidden.")}:{title:this.#e("v4_reconnecting","Reconnecting"),detail:this.#e("v4_reconnecting_detail","The verified map is read only until Home Assistant reconnects.")}}#s(H,V){let L=this.state,r=this.narrow,t=L.workflow==="draw",M=this.#e("v4_how_to_move","How to move the map"),o=H&&!t,i=o&&!r&&L.view==="top",a=o&&L.view==="three",n=!V||L.fullMap,A=!r&&!t;return!o&&!n?l:s`
      <div class="map-rail" data-map-control>
        ${o?s`
          <div class="view-switch ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#e("map_view_label","Map view")}>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(L.view==="three")}
              @click=${()=>this.#o({type:"set-view",view:"three"})}
            >${this.#e("map_view_3d","3D")}</button>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(L.view==="top")}
              @click=${()=>this.#o({type:"set-view",view:"top"})}
            >${this.#e("map_view_top","2D")}</button>
          </div>
        `:l}

        ${i?s`
          <div class="appearance-switch ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#e("map_style_label","2D map style")}>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(L.appearance==="photo")}
              @click=${()=>this.#o({type:"set-appearance",appearance:"photo"})}
            >${this.#e("map_style_photo","Photo")}</button>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(L.appearance==="rooms")}
              @click=${()=>this.#o({type:"set-appearance",appearance:"rooms"})}
            >${this.#e("map_style_room_colours","Room colours")}</button>
          </div>
        `:l}

        ${a?s`
          <div class="camera-steps ms-surface ms-surface--floating ms-segment" role="toolbar" aria-orientation="horizontal" aria-label=${this.#e("map_camera_controls","Map camera controls")}>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#e("map_rotate_left","Rotate left")} aria-keyshortcuts="[" @click=${()=>this.#m(-52,0)}>${Z(f3)}</button>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#e("map_tilt_down","Lower viewing angle")} aria-keyshortcuts="PageDown" @click=${()=>this.#m(0,30)}>${Z(c3)}</button>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#e("map_tilt_up","Raise viewing angle")} aria-keyshortcuts="PageUp" @click=${()=>this.#m(0,-30)}>${Z(v3)}</button>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#e("map_rotate_right","Rotate right")} aria-keyshortcuts="]" @click=${()=>this.#m(52,0)}>${Z(g3)}</button>
          </div>
        `:l}

        ${n?s`
          <div class="map-tools ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#e("v4_map_tools","Map tools")}>
            ${V?l:s`
              <button
                class="fit ms-btn"
                type="button"
                aria-label=${this.#e("v4_fit_map_hint","Fit the whole map on screen")}
                @click=${()=>{this.#V?.fit(),this.#o({type:"fit-map"})}}
              >${Z(x3)}<span class="ms-btn__label">${this.#e("v4_fit_map","Fit map")}</span></button>
            `}
            ${!V&&A?s`
              <button
                class="labels ms-btn"
                type="button"
                aria-pressed=${String(L.labelsVisible)}
                @click=${()=>this.#o({type:"toggle-labels"})}
              >${Z(u3)}<span class="ms-btn__label">${this.#e("v4_room_names","Room names")}</span></button>
              <button
                class="help ms-btn ms-btn--icon"
                type="button"
                aria-label=${M}
                aria-expanded=${String(this.#L)}
                aria-controls=${N3}
                @click=${this.#n}
              >${Z(Z3)}</button>
            `:l}
            <button
              class="full-map ms-btn"
              type="button"
              aria-label=${this.#e("v4_full_map","Full map")}
              aria-pressed=${String(L.fullMap)}
              @click=${this.#A}
            >${Z(L.fullMap?S3:h3)}<span class="ms-btn__label">${L.fullMap?this.#e("v4_exit_full_map","Exit full map"):this.#e("v4_full_map","Full map")}</span></button>
          </div>
        `:l}

        ${this.#L&&H&&A?s`
          <div
            id=${N3}
            class="navigation-help ms-surface ms-surface--floating"
            role="dialog"
            aria-modal="false"
            aria-label=${M}
          >
            <header>
              <h3>${M}</h3>
              <button class="ms-btn ms-btn--sm" type="button" @click=${()=>this.#c()}>${this.#e("v4_close","Close")}</button>
            </header>
            <dl>
              <dt>${this.#e("v4_trackpad","Trackpad")}</dt>
              <dd>${this.#e("v4_trackpad_help","Scroll to pan \xB7 pinch to zoom \xB7 twist to rotate")}</dd>
              <dt>${this.#e("v4_mouse","Mouse")}</dt>
              <dd>${this.#e("v4_mouse_help","Drag to orbit \xB7 Shift, middle, or right drag to pan \xB7 wheel to zoom")}</dd>
              <dt>${this.#e("v4_keyboard","Keyboard")}</dt>
              <dd>${this.#e("v4_keyboard_help","WASD to move \xB7 Q/E or arrows to orbit \xB7 +/\u2212 to zoom \xB7 0 to fit")}</dd>
            </dl>
          </div>
        `:l}
      </div>
    `}#l(H){let V=this.state;if(!H)return l;if(V.workflow==="draw"&&!this.narrow)return s`
        <div class="map-dock ms-surface ms-surface--floating" data-map-control>
          ${j1(V,{intent:r=>this.#o(r),openBrush:()=>this.#o({type:"set-precision-open",value:!V.precisionOpen}),t:(r,t)=>this.#e(r,t)},"row")}
        </div>
      `;let L=V.selection.roomIds.length;return V.workflow==="rooms"&&L>0&&!this.narrow?s`
        <div class="map-dock ms-surface ms-surface--floating" data-map-control>
          <div class="selection-chip ms-surface ms-surface--floating" data-map-control>
            <span>${this.#e("v4_rooms_selected","{count} rooms selected").replace("{count}",String(L))}</span>
            <button class="ms-btn ms-btn--sm" type="button" @click=${()=>this.#x()}>${this.#e("v4_clear","Clear")}</button>
          </div>
        </div>
      `:l}render(){let H=this.state,V=d5(H),L=this.#v(),r=H.map.available&&(s1(H)||H.dataMode==="history"),t=H.workflow==="draw"&&r,M=H.coherence==="verifying"||H.coherence==="booting";return s`
      <section
        class="map-root"
        tabindex="0"
        aria-label=${this.#e("map_viewport_aria","Interactive Matic 3D map")}
        data-full-map=${String(H.fullMap)}
        data-workflow=${H.workflow}
        data-draw-tool=${H.draw.tool}
        data-narrow=${this.narrow?"true":l}
        @keydown=${this.#r}
      >
        ${this.#s(r,M)}

        <div
          class="scene-window"
          data-renderer-key="persistent-canvas-v4"
          ?hidden=${!r}
          role="img"
          aria-label=${z3(H,this.localize)}
        >
          <canvas class="scene-canvas"></canvas>
          <canvas class="overlay-canvas"></canvas>
        </div>

        ${t?s`
          <div class="map-scale" aria-label=${`Scale ${V.label}`}>
            <span class="scale-line" style=${`--scale-width:${V.pixels}px`}></span>
            <span>${V.label}</span>
          </div>
        `:l}

        ${this.#l(r)}

        ${L&&!(H.fullMap&&(M||!H.host.administrator))?s`
          <div class="map-message ms-surface ms-surface--floating" role="status">
            <strong>${L.title}</strong>
            <span>${L.detail}</span>
          </div>
        `:l}
        <div class="sr-only" aria-live="polite" aria-atomic="true">
          ${z3(H,this.localize)}
        </div>
      </section>
    `}};customElements.get(t1)||customElements.define(t1,z2);var U2=class extends O{constructor(){super(...arguments);this.state=k();this.compact=!1;this.inline=!1}static{this.properties={state:{attribute:!1},localize:{attribute:!1},compact:{type:Boolean,reflect:!0},inline:{type:Boolean,reflect:!0}}}static{this.styles=[E,D,J,b`
:host { display: block; color: var(--ms-text); }
.controls { display: grid; gap: var(--ms-space-3); padding: var(--ms-space-3); }
.stepper { display: grid; grid-template-columns: var(--ms-control) minmax(0, 1fr) var(--ms-control); gap: var(--ms-space-1); align-items: stretch; }
.number { --ms-local: var(--ms-surface-card); display: flex; align-items: center; min-inline-size: 0; min-block-size: var(--ms-control); padding-inline: var(--ms-space-2); border: 1px solid var(--ms-line-strong); border-radius: var(--ms-radius-sm); background: var(--ms-local); }
.number:focus-within { outline: 2px solid var(--ms-accent); outline-offset: 1px; border-color: var(--ms-accent); }
.number input { min-inline-size: 0; inline-size: 100%; border: 0; outline: 0; color: inherit; background: transparent; text-align: end; font-size: var(--ms-t-sm); font-variant-numeric: tabular-nums; }
.unit { margin-inline-start: var(--ms-space-1); color: var(--ms-text-quiet); font-size: var(--ms-t-xs); }
.slider { display: block; inline-size: 100%; min-block-size: var(--ms-control); margin: 0; accent-color: var(--ms-accent); }
.slider:focus-visible { outline: 2px solid var(--ms-accent); outline-offset: 2px; }
.hint { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
:host([compact]:not([inline])) .controls {
position: absolute;
z-index: 8;
inset-block-end: calc(100% + var(--ms-space-1));
inset-inline-end: 0;
inline-size: min(18rem, calc(100vw - 1.5rem));
}
:host([compact][inline]) { margin-block-start: var(--ms-space-2); }
`]}#C(H,V){return B(this.localize,H,V)}#H(H){this.dispatchEvent(new CustomEvent(i1,{detail:H,bubbles:!0,composed:!0}))}#V(H){let V=H.currentTarget.valueAsNumber;Number.isFinite(V)&&this.#H({type:"set-brush",value:V})}render(){let{draw:H}=this.state;return s`
      <div class="controls ms-surface ms-surface--overlay" aria-label=${this.#C("v4_drawing_precision","Drawing precision")}>
        <div class="row ms-field">
          <label for="brush">${this.#C("brush_size","Brush width")}</label>
          <div class="stepper">
            <button
              class="ms-btn ms-btn--secondary ms-btn--icon"
              type="button"
              aria-label=${this.#C("v4_narrower_brush","Narrower brush")}
              @click=${()=>this.#H({type:"set-brush",value:H.brushMeters/1.25})}
            >&minus;</button>
            <span class="number">
              <input
                id="brush"
                inputmode="decimal"
                type="number"
                min=${.2}
                max=${2.5}
                step="0.01"
                .value=${H.brushMeters.toFixed(2)}
                @change=${this.#V}
                aria-label=${this.#C("v4_brush_width_meters","Brush width in meters")}
              />
              <span class="unit">m</span>
            </span>
            <button
              class="ms-btn ms-btn--secondary ms-btn--icon"
              type="button"
              aria-label=${this.#C("v4_wider_brush","Wider brush")}
              @click=${()=>this.#H({type:"set-brush",value:H.brushMeters*1.25})}
            >+</button>
          </div>
          <input
            class="slider"
            type="range"
            min=${.2}
            max=${2.5}
            step="0.01"
            .value=${H.brushMeters.toFixed(2)}
            @input=${this.#V}
            aria-label=${this.#C("v4_brush_width_slider","Brush width slider")}
            aria-valuetext=${`${H.brushMeters.toFixed(2)} m`}
          />
        </div>
        <p class="hint">${this.#C("v4_precision_hint","Strokes follow the verified map resolution. Zoom changes the view, not the saved outline.")}</p>
      </div>
    `}};customElements.get(_1)||customElements.define(_1,U2);var G2=["vacuum","mop","vacuum_and_mop"],Q2=["quick","standard","heavy_duty"],$=e=>e.currentTarget.value,K2=e=>e.currentTarget.checked,q2=class extends O{constructor(){super(...arguments);this.state=k();this._copyStatus="idle"}static{this.properties={state:{attribute:!1},localize:{attribute:!1},_copyStatus:{state:!0}}}static{this.styles=[E,D,J,b`
:host { display: block; min-inline-size: 0; }
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
.floor[aria-checked="true"] { border-color: var(--ms-accent); background: color-mix(in srgb, var(--ms-accent) 12%, var(--ms-local)); }
.problem p { margin: 0; }
.copy-status { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
@media (forced-colors: active) { .floor[aria-checked="true"] { forced-color-adjust: none; color: HighlightText; background: Highlight; border-color: Highlight; } }
.room { display: grid; gap: var(--ms-space-2); }
.room-choice { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: var(--ms-space-2); min-block-size: var(--ms-control-sm); }
.room-choice input { inline-size: 1.2rem; block-size: 1.2rem; }
.room-settings { padding-block-start: 0.125rem; padding-inline-start: 1.8rem; }
.plan-options { --ms-local: var(--ms-surface-sunken); display: grid; gap: var(--ms-space-2); padding: var(--ms-space-3); border: 1px solid var(--ms-line); border-radius: var(--ms-radius-md); background: var(--ms-local); }
.plan-room { display: grid; gap: var(--ms-space-2); }
.toolbar { display: flex; flex-wrap: wrap; gap: var(--ms-space-2); }
.checkbox { display: flex; align-items: center; gap: var(--ms-space-2); min-block-size: var(--ms-control); font-size: var(--ms-t-xs); font-weight: var(--ms-w-medium); }
.checkbox input { inline-size: 1.2rem; block-size: 1.2rem; }
.floor small, .snapshot small, .list-button small { margin-inline-start: auto; color: color-mix(in srgb, var(--ms-text) 78%, var(--ms-local)); font-weight: var(--ms-w-regular); }
.timeline { display: grid; gap: var(--ms-space-2); }
.timeline input[type="range"] { inline-size: 100%; min-block-size: var(--ms-control); }
.diagnostics { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--ms-space-2) var(--ms-space-3); margin: 0; font-size: var(--ms-t-xs); }
.diagnostics dt { color: var(--ms-text-quiet); }
.diagnostics dd { margin: 0; font-weight: var(--ms-w-medium); }
@media (max-width: 25rem) { .split { grid-template-columns: 1fr; } }
`]}#C;disconnectedCallback(){this.#C!==void 0&&clearTimeout(this.#C),this.#C=void 0,super.disconnectedCallback()}#H(H,V,L){return B(this.localize,H,V,L)}#V(H){return H==="vacuum"?this.#H("vacuum","Vacuum"):H==="mop"?this.#H("mop","Mop"):this.#H("vacuum_and_mop","Vacuum + mop")}#t(H){return H==="quick"?this.#H("quick","Quick"):H==="standard"?this.#H("standard","Optimal"):this.#H("heavy_duty","Heavy Duty")}#L(H){this.dispatchEvent(new CustomEvent(i1,{detail:H,bubbles:!0,composed:!0}))}#M(){return this.state.notice?s`
      <div class="notice" data-tone=${this.state.notice.tone} role=${this.state.notice.tone==="error"?"alert":"status"}>
        ${this.state.notice.text}
      </div>
    `:l}#i(H,V,L){if(H==="loading"||H==="idle")return s`<div class="loading" role="status">${this.#H("map_loading","Loading\u2026")}</div>`;if(H==="error"){let r=this.state.workflow;return s`
        <div class="stack">
          <div class="problem" role="alert">${this.#H("v4_workspace_unavailable","This workspace is unavailable right now.")} ${V==="request-failed"?this.#H("v4_try_again","Try again shortly."):this.#H("v4_return_live_retry","Return to the live map and retry.")}</div>
          <div class="toolbar">
            <button class="ms-btn ms-btn--secondary" type="button" @click=${()=>this.#L({type:"open-workflow",workflow:r})}>${this.#H("v4_retry","Try again")}</button>
          </div>
        </div>
      `}return H==="empty"?s`<div class="empty">${this.#H("v4_nothing_saved","Nothing saved yet.")}</div>`:L}#a(){let H=this.state.resources.plans;return this.#i(H.status,H.problem,s`
      <div class="stack">
        <h3 class="group-heading" id="rooms-heading">${this.#H("v4_rooms_to_clean","Rooms to clean")}</h3>
        <div class="list" role="group" aria-labelledby="rooms-heading">
          ${(H.value?.rooms||[]).map(V=>{let L=this.state.selection.roomIds.includes(V.roomId);return s`
              <div class="room ms-row ms-row--stack" data-selected=${String(L)}>
                <label class="room-choice">
                  <input
                    type="checkbox"
                    .checked=${L}
                    @change=${()=>this.#L({type:"toggle-room",roomId:V.roomId})}
                  >
                  <strong>${V.name}</strong>
                  ${L?s`<small>${this.#H("v4_room_ready","Ready")}</small>`:l}
                </label>
                ${L?this.#e(V.roomId,this.state.selection.roomSettings.find(r=>r.roomId===V.roomId)||{roomId:V.roomId,cleaningMode:"vacuum",coverageSetting:"standard"}):l}
              </div>
            `})}
        </div>
        <p class="subtle">${this.#H("v4_room_selection_hint","Select rooms here or directly on the map. The map and list stay in sync.")}</p>
        ${this.#M()}
      </div>
    `)}#e(H,V){return s`
      <div class="split room-settings">
        <label class="field ms-field">${this.#H("v4_cleaning_system","Cleaning system")}
          <select
            aria-label=${this.#H("v4_room_cleaning_system","Cleaning system for room")}
            .value=${V.cleaningMode}
            @change=${L=>this.#L({type:"patch-room-settings",roomId:H,cleaningMode:$(L)})}
          >${G2.map(L=>s`<option value=${L} ?selected=${L===V.cleaningMode}>${this.#V(L)}</option>`)}</select>
        </label>
        <label class="field ms-field">${this.#H("cleaning_mode","Cleaning mode")}
          <select
            aria-label=${this.#H("v4_room_cleaning_mode","Cleaning mode for room")}
            .value=${V.coverageSetting}
            @change=${L=>this.#L({type:"patch-room-settings",roomId:H,coverageSetting:$(L)})}
          >${Q2.map(L=>s`<option value=${L} ?selected=${L===V.coverageSetting}>${this.#t(L)}</option>`)}</select>
        </label>
      </div>
    `}#d(H){let V=this.state.planDraft.rooms,r=V.find(t=>t.roomId===H)?V.filter(t=>t.roomId!==H):[...V,{roomId:H,cleaningMode:"vacuum",coverageSetting:"standard"}];this.#L({type:"patch-plan-draft",patch:{rooms:r}})}#p(H,V){let L=this.state.planDraft.rooms.map((r,t)=>t===H?{...r,...V}:r);this.#L({type:"patch-plan-draft",patch:{rooms:L}})}#Z(H,V){let L=H+V,r=[...this.state.planDraft.rooms];if(L<0||L>=r.length)return;let[t]=r.splice(H,1);t&&(r.splice(L,0,t),this.#L({type:"patch-plan-draft",patch:{rooms:r}}))}#h(){let H=this.state.resources.plans,V=H.value,L=this.state.planDraft,r=L.rooms.map(o=>({room:o,label:V?.rooms.find(i=>i.roomId===o.roomId)?.name||"Room",selected:!0})),t=(V?.rooms||[]).filter(o=>!L.rooms.some(i=>i.roomId===o.roomId)).map(o=>({room:{roomId:o.roomId,cleaningMode:"vacuum",coverageSetting:"standard"},label:o.name,selected:!1})),M=[...r,...t];return this.#i(H.status,H.problem,s`
      <div class="stack">
        <div class="split">
          <label class="field ms-field">${this.#H("v4_saved_plan","Saved plan")}
            <select
              .value=${this.state.selection.planId||""}
              @change=${o=>this.#L({type:"select-plan",planId:$(o)||null})}
            >
              <option value="">${this.#H("plan_new","New plan")}</option>
              ${(V?.plans||[]).map(o=>s`<option value=${o.id}>${o.name}</option>`)}
            </select>
          </label>
          <button class="list-button ms-row ms-row" type="button" @click=${()=>this.#L({type:"select-plan",planId:null})}>\uff0b ${this.#H("plan_new","New plan")}</button>
        </div>
        <label class="field ms-field">${this.#H("plan_name","Plan name")}
          <input
            maxlength="128"
            autocomplete="off"
            .value=${L.name}
            @input=${o=>this.#L({type:"patch-plan-draft",patch:{name:$(o)}})}
          >
        </label>
        <div class="split">
          <label class="field ms-field">${this.#H("plan_run_behavior","Run order")}
            <select
              .value=${L.runBehavior}
              @change=${o=>this.#L({type:"patch-plan-draft",patch:{runBehavior:$(o)==="ordered"?"ordered":"intelligent"}})}
            >
              <option value="intelligent">${this.#H("plan_intelligent","Smart rotation")}</option>
              <option value="ordered">${this.#H("plan_ordered","Listed order")}</option>
            </select>
          </label>
          <label class="checkbox"><input type="checkbox" .checked=${L.enabled} @change=${o=>this.#L({type:"patch-plan-draft",patch:{enabled:K2(o)}})}>${this.#H("plan_enabled","Enabled")}</label>
        </div>
        <h3 class="group-heading" id="plan-rooms-heading">${this.#H("plan_rooms","Plan rooms")}</h3>
        <div class="list" role="group" aria-labelledby="plan-rooms-heading">
          ${M.map(({room:o,label:i,selected:a})=>{let n=a?L.rooms.findIndex(A=>A.roomId===o.roomId):-1;return s`
              <div class="room plan-room ms-row ms-row--stack" data-selected=${String(a)}>
                <label class="room-choice">
                  <input type="checkbox" .checked=${a} @change=${()=>this.#d(o.roomId)}>
                  <strong>${a?`${n+1}. `:""}${i}</strong>
                  ${a?s`
                    <span>
                      <button class="icon-button ms-btn ms-btn--icon ms-btn--sm" type="button" aria-label=${this.#H("move_room_up","Move {room} earlier",{room:i})} ?disabled=${n===0} @click=${A=>{A.preventDefault(),this.#Z(n,-1)}}>\u2191</button>
                      <button class="icon-button ms-btn ms-btn--icon ms-btn--sm" type="button" aria-label=${this.#H("move_room_down","Move {room} later",{room:i})} ?disabled=${n===L.rooms.length-1} @click=${A=>{A.preventDefault(),this.#Z(n,1)}}>\u2193</button>
                    </span>
                  `:l}
                </label>
                ${a?s`
                  <div class="split room-settings">
                    <label class="field ms-field">${this.#H("v4_cleaning_system","Cleaning system")}
                      <select .value=${o.cleaningMode} @change=${A=>this.#p(n,{cleaningMode:$(A)})}>${G2.map(A=>s`<option value=${A} ?selected=${A===o.cleaningMode}>${this.#V(A)}</option>`)}</select>
                    </label>
                    <label class="field ms-field">${this.#H("cleaning_mode","Cleaning mode")}
                      <select .value=${o.coverageSetting} @change=${A=>this.#p(n,{coverageSetting:$(A)})}>${Q2.map(A=>s`<option value=${A} ?selected=${A===o.coverageSetting}>${this.#t(A)}</option>`)}</select>
                    </label>
                  </div>
                `:l}
              </div>
            `})}
        </div>
        <h3 class="group-heading" id="completion-heading">${this.#H("v4_completion_options","Completion options")}</h3>
        <div class="plan-options" role="group" aria-labelledby="completion-heading">
          <label class="checkbox"><input type="checkbox" .checked=${L.returnToBase} @change=${o=>this.#L({type:"patch-plan-draft",patch:{returnToBase:K2(o)}})}>${this.#H("plan_return_to_base","Return to the dock when finished")}</label>
          <label class="checkbox"><input type="checkbox" .checked=${L.finishCurrentRoom} @change=${o=>this.#L({type:"patch-plan-draft",patch:{finishCurrentRoom:K2(o)}})}>${this.#H("plan_finish_room","Finish the active room after Stop")}</label>
          ${L.finishCurrentRoom?s`<label class="field ms-field">${this.#H("plan_threshold","Finish threshold")} \u00b7 ${L.finishCurrentRoomThreshold}%<input type="range" min="0" max="100" step="5" .value=${String(L.finishCurrentRoomThreshold)} @input=${o=>this.#L({type:"patch-plan-draft",patch:{finishCurrentRoomThreshold:Number($(o))}})}></label>`:l}
        </div>
        <div class="toolbar">
          ${L.id?s`
            <button
              class="danger ms-btn ms-btn--secondary ms-btn--danger"
              type="button"
              aria-label=${this.#H("plan_delete","Delete plan")}
              data-dialog-launcher="confirmDeletePlan"
              @click=${()=>this.#L({type:"open-dialog",dialog:"confirmDeletePlan"})}
            >${this.#H("plan_delete","Delete")}</button>
          `:l}
        </div>
        ${this.#M()}
      </div>
    `)}#o(){let H=this.state.resources.areas;return s`
      <div class="stack">
        <p class="subtle">${this.#H("v4_draw_floor_hint","Paint only on the mapped floor. Zoom and pan never change the saved outline.")}</p>
        ${this.#i(H.status,H.problem,s`
          <div class="group">
            <h3 class="group-heading" id="areas-heading">${this.#H("area_workspace_title","Saved custom areas")}</h3>
            <div class="list" role="group" aria-labelledby="areas-heading">
            <button class="list-button ms-row ms-row" type="button" @click=${()=>this.#L({type:"select-area",areaId:null})}>\uff0b ${this.#H("area_new","New outline")}</button>
            ${(H.value?.areas||[]).map(V=>s`
              <button class="list-button ms-row ms-row" type="button" @click=${()=>{this.#L({type:"select-area",areaId:V.id}),this.#L({type:"open-workflow",workflow:"areaReview"})}}>
                <span>${V.name}</span>
                <small>${V.status==="current"?this.#H("area_workspace_ready","Ready"):this.#H("v4_review","Review")}</small>
              </button>
            `)}
            </div>
          </div>
        `)}
      </div>
    `}#S(){let H=this.state.areaDraft,V=H.canRebind||H.status==="review",L=H.status==="stale"||H.status==="unknown";return s`
      <div class="stack">
        ${V?s`<div class="notice" data-tone="warning" role="status">${this.#H("area_review_required","Review the saved outline on this current map, then confirm it.")}</div>`:l}
        ${L?s`<div class="problem" role="alert">${this.#H("area_redraw_required","This outline no longer matches the current room map. Redraw it before saving.")}</div>`:l}
        <label class="field ms-field">${this.#H("area_name","Area name")}
          <input maxlength="128" autocomplete="off" .value=${H.name} @input=${r=>this.#L({type:"patch-area-draft",patch:{name:$(r)}})}>
        </label>
        <div class="split">
          <label class="field ms-field">${this.#H("v4_cleaning_system","Cleaning system")}
            <select .value=${H.cleaningMode} @change=${r=>this.#L({type:"patch-area-draft",patch:{cleaningMode:$(r)}})}>${G2.map(r=>s`<option value=${r} ?selected=${r===H.cleaningMode}>${this.#V(r)}</option>`)}</select>
          </label>
          <label class="field ms-field">${this.#H("cleaning_mode","Cleaning mode")}
            <select .value=${H.coverageSetting} @change=${r=>this.#L({type:"patch-area-draft",patch:{coverageSetting:$(r)}})}>${Q2.map(r=>s`<option value=${r} ?selected=${r===H.coverageSetting}>${this.#t(r)}</option>`)}</select>
          </label>
        </div>
        <p class="subtle">${this.#H("v4_private_marks","{count} map-space marks. The outline stays private and floor-bound.",{count:this.state.draw.circles.length})}</p>
        <div class="toolbar">
          <button class="ms-btn ms-btn--secondary" type="button" @click=${()=>this.#L({type:"open-workflow",workflow:"draw"})}>${this.#H("v4_edit_outline","Edit outline")}</button>
          ${H.id?s`
            <button
              class="danger ms-btn ms-btn--secondary ms-btn--danger"
              type="button"
              aria-label=${this.#H("area_delete","Delete area")}
              data-dialog-launcher="confirmDeleteArea"
              @click=${()=>this.#L({type:"open-dialog",dialog:"confirmDeleteArea"})}
            >${this.#H("area_delete","Delete")}</button>
          `:l}
        </div>
        ${this.#M()}
      </div>
    `}#A(){let H=this.state.resources.history,V=H.value,L=V?.floors.find(M=>M.id===this.state.selection.floorId)||V?.floors.find(M=>M.active)||V?.floors[0],r=L?.snapshots||[],t=this.state.selection.historyId?Math.max(0,r.findIndex(M=>M.id===this.state.selection.historyId)):r.length;return this.#i(H.status,H.problem,s`
      <div class="stack">
        ${(V?.floors.length||0)>1?s`
          <div class="group">
            <h3 class="group-heading" id="floors-heading">${this.#H("v4_mapped_floors","Mapped floors")}</h3>
            <div class="list" role="radiogroup" aria-labelledby="floors-heading">
            ${(V?.floors||[]).map((M,o)=>s`
              <button
                class="floor ms-row ms-row"
                type="button"
                role="radio"
                aria-checked=${String(M.id===L?.id)}
                @click=${()=>this.#L({type:"set-floor",floorId:M.id})}
              >
                <span>${M.label||(M.active?this.#H("v4_current_floor","Current floor"):this.#H("v4_saved_floor","Saved floor {number}",{number:M.ordinal??o}))}</span>
                <small>${M.active?this.#H("map_timeline_live_action","Live"):this.#H("v4_read_only","Read only")}</small>
              </button>
            `)}
            </div>
          </div>
        `:l}
        <div class="timeline">
          <label class="field ms-field">${this.#H("map_timeline_label","Map timeline")}
            <input
              type="range"
              min="0"
              max=${String(r.length)}
              step="1"
              .value=${String(t)}
              ?disabled=${!r.length}
              @input=${M=>{let o=Number($(M));this.#L({type:"set-history",historyId:o===r.length?null:r[o]?.id||null})}}
            >
          </label>
          <div class="list">
            <button class="snapshot ms-row ms-row" type="button" aria-current=${String(!this.state.selection.historyId)} @click=${()=>this.#L({type:"set-history",historyId:null})}><span>${this.#H("map_timeline_live_action","Live")}</span><small>${this.#H("v4_current","Current")}</small></button>
            ${r.map((M,o)=>s`
              <button class="snapshot ms-row ms-row" type="button" aria-current=${String(M.id===this.state.selection.historyId)} @click=${()=>this.#L({type:"set-history",historyId:M.id})}>
                <span>${this.#n(M.createdAt)}</span><small>${o+1} of ${r.length}</small>
              </button>
            `)}
          </div>
        </div>
        <p class="subtle">${this.#H("v4_history_privacy","Saved maps are floor-scoped and never show a live robot position.")}</p>
      </div>
    `)}#n(H){try{return new Intl.DateTimeFormat(this.state.locale,{dateStyle:"medium",timeStyle:"short"}).format(new Date(H))}catch{return this.#H("v4_saved_map","Saved map")}}#c(){let H=this.state.resources.entry,V=this.#H("v4_yes","Yes"),L=this.#H("v4_no","No"),r=this.#H("v4_seen","Seen"),t=this.#H("v4_not_seen","Not seen"),M=this.#H("v4_unknown","Unknown");return[[this.#H("v4_connection","Connection"),this.state.host.connected?this.#H("v4_connected","Connected"):this.#H("v4_offline","Offline")],[this.#H("v4_map_state","Map state"),String(this.state.coherence)],[this.#H("v4_floor_verified","Floor verified"),this.state.map.floorCoherent?V:L],[this.#H("v4_session_verified","Session verified"),this.state.map.sessionVerified?V:L],[this.#H("v4_map_complete","Map complete"),this.state.map.complete?V:L],[this.#H("v4_map_health","Map health"),H?.health||M],[this.#H("v4_blocked_by","Blocked by"),H?.mapBlockReason?.replaceAll("_"," ")||this.#H("v4_nothing","Nothing")],[this.#H("v4_startup_map","Startup map check"),H?.bootstrapState?.replaceAll("_"," ")||M],[this.#H("v4_startup_photo","Startup photo layer"),H?.bootstrapPhotoSeen?r:t],[this.#H("v4_startup_structure","Startup structure layer"),H?.bootstrapStructureSeen?r:t],[this.#H("v4_startup_failures","Startup failures"),String(H?.bootstrapFailures||0)],[this.#H("v4_stream_failures","Stream failures"),String(H?.streamFailures||0)],[this.#H("v4_saved_floor_count","Saved floor count"),String(this.state.floor.classifiedCount)]]}#x(H){this.#C!==void 0&&clearTimeout(this.#C),this.#C=void 0,this._copyStatus=H,H==="copied"&&(this.#C=setTimeout(()=>{this.#C=void 0,this._copyStatus="idle"},2e3))}#m(){let H=this.#c().map(([r,t])=>`${r}: ${t}`).join(`
`),V=typeof navigator>"u"?void 0:navigator.clipboard;if(!V||typeof V.writeText!="function"){this.#x("failed");return}let L;try{L=V.writeText(H)}catch{this.#x("failed");return}L.then(()=>this.#x("copied"),()=>this.#x("failed"))}#r(){let H=this.#c(),V=this._copyStatus==="copied"?this.#H("v4_copied","Copied"):this._copyStatus==="failed"?this.#H("v4_copy_failed","The summary could not be copied. Select the text to copy it by hand."):"";return s`
      <div class="stack">
        <p class="subtle">${this.#H("v4_support_privacy","This summary contains no map, coordinates, room or floor names, device identifiers, addresses, or credentials.")}</p>
        <dl class="diagnostics">
          ${H.map(([L,r])=>s`<dt>${L}</dt><dd>${r}</dd>`)}
        </dl>
        <div class="toolbar">
          <button class="ms-btn ms-btn--secondary" type="button" @click=${()=>this.#m()}>${Z(T3)}<span>${this.#H("v4_copy_summary","Copy summary")}</span></button>
        </div>
        <p class="copy-status" role="status" aria-live="polite">${V}</p>
      </div>
    `}render(){switch(this.state.workflow){case"rooms":return this.#a();case"plan":return this.#h();case"draw":return this.#o();case"areaReview":return this.#S();case"history":return this.#A();case"support":return this.#r();case"none":return l}}};customElements.get(c1)||customElements.define(c1,q2);var U3=j(t1),L2=j(_1),G3=j(c1),i7=(e,C)=>{let H=(L,r,t)=>B(C,L,r,t);if(!e.host.connected)return{title:H("v4_reconnecting","Reconnecting"),detail:H("v4_ha_offline","Home Assistant is offline"),icon:x1,notable:!0};if(!e.host.administrator)return{title:H("v4_access_required","Access required"),detail:H("v4_admin_only","Administrator only"),icon:x1,notable:!0};if(e.host.robotCount===0)return{title:H("v4_no_robot_short","No robot"),detail:H("v4_set_up_robot","Set up a Matic robot"),icon:x1,notable:!0};if(!e.host.robotConnected)return{title:H("v4_robot_offline","Robot offline"),detail:H("v4_last_map_read_only","Last verified map \xB7 read only"),icon:x1,notable:!0};if(e.activity==="problem")return{title:H("v4_needs_attention","Needs attention"),detail:H("v4_check_robot","Check the robot"),icon:x1,notable:!0};if(e.dataMode==="history"){let L=e.resources.history.value?.floors.find(M=>M.id===e.selection.floorId),r=L?.snapshots.findIndex(M=>M.id===e.selection.historyId)??-1,t=L?.snapshots.length??0;return{title:H("v4_saved_map","Saved map"),detail:r>=0?H("v4_read_only_position","Read only \xB7 {position} of {count}",{position:r+1,count:t}):H("v4_read_only","Read only"),icon:R1,notable:!1}}if(e.coherence==="verifying"||e.coherence==="booting")return{title:H("v4_locating","Locating"),detail:H("v4_finding_map","Finding the current map"),icon:Y1,notable:!0};if(e.activity==="cleaning")return{title:H("v4_cleaning","Cleaning"),detail:H("v4_cleaning_progress","Cleaning in progress"),icon:I2,notable:!0};if(e.activity==="recharging"){let L=e.batteryPercent===null?H("v4_recharging_detail","Will resume automatically when ready"):H("v4_recharging_battery","Charging to resume \xB7 {percent}% battery",{percent:e.batteryPercent});return{title:H("v4_recharging","Charging to resume"),detail:L,icon:_3,notable:!0}}if(e.activity==="paused")return{title:H("v4_paused","Paused"),detail:H("v4_can_resume","Cleaning can resume"),icon:W2,notable:!0};if(e.activity==="returning")return{title:H("v4_returning","Returning"),detail:H("v4_going_dock","Going to the dock"),icon:I2,notable:!0};if(e.activity==="stopping")return{title:H("v4_stopping","Stopping"),detail:H("v4_waiting_robot","Waiting for the robot"),icon:W2,notable:!0};let V=e.batteryPercent===null?H("v4_ready","Ready"):H("v4_battery","{percent}% battery",{percent:e.batteryPercent});return{title:e.activity==="docked"?H("v4_docked","Docked"):H("v4_ready","Ready"),detail:V,icon:Y1,notable:!1}},Q3=(e,C)=>{let H=(V,L)=>B(C,V,L);switch(e.workflow){case"rooms":return{title:H("v4_choose_rooms","Choose rooms"),description:H("v4_choose_rooms_detail","Select on the map or from the list.")};case"draw":return{title:H("v4_draw_area","Draw an area"),description:H("v4_draw_area_detail","Paint on the verified map, then review the details.")};case"plan":return{title:H("v4_cleaning_plan","Cleaning plan"),description:H("v4_plan_detail","Review rooms and cleaning settings.")};case"areaReview":return{title:H("v4_name_this_area","Name this area"),description:H("area_details_hint","Name the area and choose cleaning settings.")};case"history":return{title:H("v4_map_history","Map history"),description:H("v4_map_history_detail","Saved maps are floor-scoped and read only.")};case"support":return{title:H("v4_map_diagnostics","Map diagnostics"),description:H("v4_map_support_detail","Private geometry is never included.")};case"none":return{title:H("v4_what_to_clean","What should the robot clean?"),description:H("v4_clean_detail","Choose rooms, a saved plan, or a custom area.")}}},C1=["peek","half","full"],K3={none:"half",rooms:"peek",draw:"peek",plan:"full",areaReview:"half",history:"peek",support:"full"},a7=.5,n7=6,A7=48,l7=["button:not(:disabled)","a[href]","input:not(:disabled)","select:not(:disabled)","textarea:not(:disabled)","[tabindex]:not([tabindex='-1'])"].join(", "),d7=(e,C)=>{let H=(V,L)=>B(C,V,L);switch(e){case"discardDraft":return{title:H("v4_discard_area","Discard this area?"),detail:H("v4_discard_area_detail","The outline has not been saved. You can keep drawing or discard it."),cancelLabel:H("v4_keep_drawing","Keep drawing"),confirmLabel:H("v4_discard","Discard"),action:"discard"};case"confirmDeletePlan":return{title:H("v4_delete_plan","Delete this plan?"),detail:H("v4_delete_plan_detail","This removes the saved plan from Home Assistant. The robot will not move."),cancelLabel:H("v4_cancel","Cancel"),confirmLabel:H("plan_delete","Delete plan"),action:"delete-plan"};case"confirmDeleteArea":return{title:H("v4_delete_area","Delete this area?"),detail:H("v4_delete_area_detail","This removes the saved outline from Home Assistant. The robot will not move."),cancelLabel:H("v4_cancel","Cancel"),confirmLabel:H("area_delete","Delete area"),action:"delete-area"};case"confirmStop":return{title:H("v4_stop_cleaning","Stop cleaning?"),detail:H("v4_stop_cleaning_detail","The robot may take a moment to settle before another action is available."),cancelLabel:H("v4_keep_cleaning","Keep cleaning"),confirmLabel:H("v4_stop","Stop"),action:"stop"};case"error":return{title:H("v4_error","Something went wrong"),detail:H("v4_error_detail","No action was started. Close this message and try again when the map is ready."),cancelLabel:H("v4_close","Close"),confirmLabel:H("v4_close","Close"),action:null};case null:return null}},s7=(e=document)=>{let C=e.activeElement;for(;C?.shadowRoot?.activeElement;)C=C.shadowRoot.activeElement;return C},X2=e=>!!(e&&e.isConnected&&e.offsetParent!==null),Y2=class extends O{constructor(){super(...arguments);this.state=k();this._measuredNarrow=!1;this._sheetOffset=0;this._overflowOpen=!1;this._helpOpen=!1;this._browserFullscreen=!1;this._sheetDetent="half";this._announcement="";this.#H=null;this.#V=null;this.#t=null;this.#L=null;this.#M=null;this.#i=null;this.#a=null;this.#e=null;this.#d=()=>{this._browserFullscreen=document.fullscreenElement===this.renderRoot.querySelector(".app")};this.#p=H=>{if(!this._overflowOpen)return;let V=this.renderRoot.querySelector(".overflow-wrap");(!V||!H.composedPath().includes(V))&&(this._overflowOpen=!1)}}static{this.properties={state:{attribute:!1},localize:{attribute:!1},_measuredNarrow:{state:!0},_sheetOffset:{state:!0},_overflowOpen:{state:!0},_helpOpen:{state:!0},_browserFullscreen:{state:!0},_sheetDetent:{state:!0},_announcement:{state:!0}}}static{this.styles=[E,D,J,b`
    :host {
      display: block;
      min-inline-size: 0;
      min-block-size: 0;
      block-size: 100%;
      color: var(--ms-text);
      background: var(--ms-surface-app);
      font-family: var(--ms-font);
      container-type: size;
    }

    .root { position: relative; min-block-size: 0; block-size: 100%; }

    .sr-only, .skip-link:not(:focus) {
      position: absolute;
      overflow: hidden;
      inline-size: 1px;
      block-size: 1px;
      margin: -1px;
      padding: 0;
      border: 0;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .skip-link:focus {
      position: absolute;
      z-index: 40;
      inset-block-start: var(--ms-space-2);
      inset-inline-start: var(--ms-space-2);
    }

    .app {
      display: grid;
      grid-template-rows: 3.5rem minmax(0, 1fr);
      min-block-size: 36rem;
      block-size: 100%;
      background: var(--ms-surface-app);
    }
    .app[inert] { filter: none; }

    .app-bar {
      --ms-local: var(--ms-surface-bar);
      position: relative;
      z-index: 12;
      display: flex;
      align-items: center;
      gap: var(--ms-space-2);
      min-inline-size: 0;
      padding-inline: max(var(--ms-space-3), env(safe-area-inset-left)) max(var(--ms-space-3), env(safe-area-inset-right));
      border-block-end: 1px solid var(--ms-line);
      background: var(--ms-local);
      box-shadow: var(--ms-shadow-1);
    }

    .context-switcher { max-inline-size: 9rem; inline-size: auto; text-overflow: ellipsis; }

    .title {
      overflow: hidden;
      min-inline-size: 0;
      margin: 0;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: var(--ms-t-lg);
      font-weight: var(--ms-w-bold);
      letter-spacing: var(--ms-track-tight);
    }

    .spacer { flex: 1; }

    .overflow-wrap { position: relative; }
    .overflow-menu {
      position: absolute;
      z-index: 18;
      inset-block-start: calc(100% + var(--ms-space-1));
      inset-inline-end: 0;
      display: grid;
      gap: var(--ms-space-1);
      min-inline-size: 14rem;
      padding: var(--ms-space-1);
    }
    .overflow-menu .ms-row { justify-content: flex-start; }
    .overflow-field { padding: var(--ms-space-2) var(--ms-space-3) var(--ms-space-1); }

    .workspace {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(19rem, 22.5rem);
      min-inline-size: 0;
      min-block-size: 0;
    }

    .workspace.full-map { grid-template-columns: minmax(0, 1fr); }
    .workspace.full-map .inspector,
    .workspace.full-map .mobile-sheet,
    .workspace.full-map .sheet-scrim { display: none; }

    .canvas { position: relative; min-inline-size: 0; min-block-size: 0; }
    .map-canvas { block-size: 100%; }

    .precision-popover {
      position: absolute;
      z-index: 9;
      inset-inline-end: var(--ms-space-3);
      inset-block-end: 5.5rem;
      inline-size: 0;
      block-size: 0;
    }

    .inspector {
      --ms-local: var(--ms-surface-card);
      display: flex;
      flex-direction: column;
      min-inline-size: 0;
      min-block-size: 0;
      border-inline-start: 1px solid var(--ms-line);
      background: var(--ms-local);
    }

    .status-strip {
      display: grid;
      grid-template-columns: var(--ms-control-sm) minmax(0, 1fr) auto;
      gap: var(--ms-space-3);
      align-items: center;
      padding: var(--ms-space-3) var(--ms-space-4);
      border-block-end: 1px solid var(--ms-line);
    }

    .status-icon {
      display: grid;
      place-items: center;
      inline-size: var(--ms-control-sm);
      block-size: var(--ms-control-sm);
      border-radius: 50%;
      color: var(--ms-accent);
      background: color-mix(in srgb, var(--ms-accent) 11%, var(--ms-local));
    }

    .status-copy { min-inline-size: 0; }
    .status-strip strong, .status-strip small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .status-strip strong { font-size: var(--ms-t-sm); }
    .status-strip small { margin-block-start: 0.125rem; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); }
    .status-strip .action-reason { display: none; }

    .workflow {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-block-size: 0;
      padding: var(--ms-space-4);
      overflow: auto;
    }

    .panel-heading { display: flex; gap: var(--ms-space-2); align-items: center; min-inline-size: 0; }
    .panel-heading h2 { margin: 0; min-inline-size: 0; font-size: var(--ms-t-xl); letter-spacing: var(--ms-track-tight); }
    .panel-heading h2:focus { outline: none; }
    .panel-heading h2:focus-visible { outline: 2px solid var(--ms-accent); outline-offset: 4px; border-radius: var(--ms-radius-xs); }
    .panel-back { flex: none; }
    .panel-description { margin: var(--ms-space-1) 0 var(--ms-space-4); color: var(--ms-text-quiet); font-size: var(--ms-t-sm); line-height: var(--ms-lh-normal); }

    .quick-actions, .shelf { display: grid; gap: var(--ms-space-2); }
    .quick-actions .ms-row__body small { color: var(--ms-text-quiet); }
    /* The featured card is tinted with the accent, which drops the quiet
       text below AA (4.3:1 on the default light theme). Pull it towards
       the body text colour so it clears 4.5:1 on both schemes. */
    .quick-actions .ms-row--featured .ms-row__body small { color: color-mix(in srgb, var(--ms-text-quiet) 70%, var(--ms-text)); }
    .quick-actions .ms-row[aria-disabled="true"] .ms-row__lead { color: var(--ms-text-disabled); background: color-mix(in srgb, var(--ms-text) 6%, var(--ms-local)); }
    .quick-actions .ms-row[aria-disabled="true"] .ms-row__body strong { color: var(--ms-text-disabled); }
    .shelf-heading { margin: var(--ms-space-5) 0 var(--ms-space-2); color: var(--ms-text-quiet); font-size: var(--ms-t-xs); font-weight: var(--ms-w-bold); letter-spacing: 0.04em; text-transform: uppercase; }
    .host-state { display: grid; gap: var(--ms-space-2); padding: var(--ms-space-4); border: 1px solid var(--ms-line); border-radius: var(--ms-radius-md); }
    .host-state h3 { margin: 0; font-size: var(--ms-t-md); }
    .host-state p { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-sm); line-height: var(--ms-lh-normal); }
    .host-state .ms-btn { justify-self: start; text-decoration: none; }
    .map-display { display: grid; gap: var(--ms-space-2); }
    .map-display .ms-segment { --ms-local: var(--ms-surface-sunken); border: 1px solid var(--ms-line); border-radius: var(--ms-radius-md); background: var(--ms-local); }
    .map-display .ms-segment .ms-btn { flex: 1; }
    .ms-checkbox { display: flex; gap: var(--ms-space-2); align-items: center; min-block-size: var(--ms-control); font-size: var(--ms-t-sm); }
    .ms-checkbox input { inline-size: 1.25rem; block-size: 1.25rem; margin: 0; accent-color: var(--ms-accent); }

    .action-bar { display: grid; gap: var(--ms-space-2); margin-block-start: auto; padding-block-start: var(--ms-space-4); }
    .action-summary { margin: 0; overflow: hidden; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); text-overflow: ellipsis; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .action-reason { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); text-align: center; }
    .ms-btn--primary[aria-disabled="true"] { --ms-local: var(--ms-surface-sunken); background: var(--ms-local); border-color: transparent; }

    .full-map-hud {
      --ms-local: var(--ms-surface-card);
      position: absolute;
      z-index: 9;
      inset-inline-end: var(--ms-space-3);
      inset-block-end: max(var(--ms-space-3), env(safe-area-inset-bottom));
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--ms-space-3);
      align-items: center;
      inline-size: min(24rem, calc(100% - 1.5rem));
      padding: var(--ms-space-3);
      background: var(--ms-local);
    }
    .full-map-hud.has-secondary { grid-template-columns: minmax(0, 1fr) auto auto; }
    /* The map dock (the Draw tools, or the rooms selection chip -- one 44px
       row) sits bottom-centre; on a wide layout the HUD is bottom-right and
       the two collide below about 1400px. Lift the HUD clear of the dock. */
    .wide .full-map-hud.above-dock { inset-block-end: calc(var(--ms-space-3) + 3.5rem + var(--ms-space-2)); }
    .hud-copy { min-inline-size: 0; }
    .hud-copy strong, .hud-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hud-copy strong { font-size: var(--ms-t-sm); }
    .hud-copy small { color: var(--ms-text-quiet); font-size: var(--ms-t-xs); }
    .full-map-hud .ms-btn { inline-size: auto; min-inline-size: 5rem; }
    .full-map-hud .action-reason { position: absolute; overflow: hidden; inline-size: 1px; block-size: 1px; margin: -1px; clip-path: inset(50%); white-space: nowrap; }

    .sheet-scrim { display: none; }
    .sheet-grip, .sheet-tools, .sheet-status { display: none; }

    .dialog-backdrop {
      position: fixed;
      z-index: 30;
      inset: 0;
      display: grid;
      place-items: center;
      padding: var(--ms-space-4);
      background: var(--ms-scrim);
    }

    .dialog {
      --ms-local: var(--ms-surface-card);
      inline-size: min(24rem, 100%);
      padding: var(--ms-space-5);
      color: var(--ms-text);
      background: var(--ms-local);
    }

    .dialog h2 { margin: 0; font-size: var(--ms-t-lg); }
    .dialog p { color: var(--ms-text-quiet); font-size: var(--ms-t-sm); line-height: var(--ms-lh-normal); }
    .dialog dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--ms-space-2) var(--ms-space-3); margin: var(--ms-space-3) 0 var(--ms-space-4); font-size: var(--ms-t-sm); }
    .dialog dt { font-weight: var(--ms-w-bold); }
    .dialog dd { margin: 0; color: var(--ms-text-quiet); }
    .dialog-actions { display: flex; justify-content: flex-end; gap: var(--ms-space-2); }

    .narrow .app { grid-template-rows: 3.35rem minmax(0, 1fr); min-block-size: 28rem; }
    .narrow .workspace { grid-template-columns: minmax(0, 1fr); }
    .narrow .inspector { border-inline-start: 0; }
    .narrow .mobile-sheet {
      position: absolute;
      z-index: 7;
      inset-inline: 0;
      inset-block-end: 0;
      display: flex;
      flex-direction: column;
      block-size: auto;
      max-block-size: calc(100% - 2rem);
      padding: 0 max(var(--ms-space-3), env(safe-area-inset-right)) max(var(--ms-space-3), env(safe-area-inset-bottom)) max(var(--ms-space-3), env(safe-area-inset-left));
      border-start-start-radius: var(--ms-radius-lg);
      border-start-end-radius: var(--ms-radius-lg);
      box-shadow: 0 -8px 26px rgb(0 0 0 / 14%);
      overflow: hidden;
      transition: block-size var(--ms-base) var(--ms-ease);
      will-change: transform;
    }
    .narrow .mobile-sheet[data-detent="half"] { block-size: min(48%, 26rem); }
    .narrow .mobile-sheet[data-detent="full"] { block-size: min(92%, calc(100% - 4rem)); }
    .narrow .mobile-sheet.dragging { transition: none; }
    .narrow .mobile-sheet[data-detent="peek"] .sheet-body { display: none; }

    .narrow .sheet-grip {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      gap: var(--ms-space-1);
      align-items: center;
      min-block-size: var(--ms-control);
      padding-block: var(--ms-space-3) var(--ms-space-1);
      touch-action: none;
      cursor: grab;
      user-select: none;
      -webkit-user-select: none;
    }
    .narrow .sheet-grip:active { cursor: grabbing; }
    /* The step buttons are compact on the grip line but still touch targets:
       full control height (44px) on a phone, not the 36px --sm size. */
    .narrow .sheet-grip .ms-btn--sm { min-block-size: var(--ms-control); min-inline-size: var(--ms-control); }
    .narrow .sheet-handle {
      position: absolute;
      inset-block-start: var(--ms-space-1);
      inset-inline-start: 50%;
      inline-size: 2.5rem;
      block-size: 0.25rem;
      border-radius: var(--ms-radius-pill);
      background: var(--ms-line-strong);
      transform: translateX(-50%);
    }
    .narrow .sheet-status {
      display: block;
      overflow: hidden;
      min-inline-size: 0;
      font-size: var(--ms-t-md);
      font-weight: var(--ms-w-bold);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .narrow .sheet-tools { display: block; padding-block: var(--ms-space-1) var(--ms-space-2); }
    .narrow .draw-tools--grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: var(--ms-space-1);
      padding: 0;
    }
    .narrow .draw-tools--grid .ms-btn {
      flex-direction: column;
      gap: var(--ms-space-1);
      min-inline-size: 0;
      min-block-size: var(--ms-control);
      padding: var(--ms-space-1) var(--ms-space-2);
      border-color: var(--ms-line);
      font-size: var(--ms-t-xs);
      white-space: normal;
    }
    .narrow .draw-tools--grid .ms-btn__label {
      position: static;
      overflow: visible;
      inline-size: auto;
      block-size: auto;
      margin: 0;
      clip-path: none;
      white-space: nowrap;
    }
    .narrow .sheet-body { flex: 1; min-block-size: 0; padding-block: var(--ms-space-1); overflow: auto; overscroll-behavior: contain; }
    .narrow .mobile-sheet .action-bar { flex: none; margin-block-start: 0; padding-block-start: var(--ms-space-2); }
    .narrow .panel-back { inline-size: var(--ms-control); padding-inline: 0; }
    .narrow .panel-back .ms-btn__label {
      position: absolute;
      overflow: hidden;
      inline-size: 1px;
      block-size: 1px;
      margin: -1px;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .narrow .title { font-size: var(--ms-t-md); }
    .narrow .context-switcher { max-inline-size: 7rem; }
    .narrow .full-map-hud { inset-block-end: max(var(--ms-space-3), env(safe-area-inset-bottom)); }
    .narrow .workspace.full-map .mobile-sheet { display: none; }
    .narrow .sheet-scrim {
      position: absolute;
      z-index: 6;
      inset: 0;
      inset-block-end: var(--map-sheet-offset, 0px);
      display: block;
      border: 0;
      background: color-mix(in srgb, #000 18%, transparent);
      cursor: pointer;
    }
    .narrow .sheet-scrim:focus-visible { outline: 3px solid var(--ms-accent); outline-offset: -3px; }
    .narrow .precision-popover { position: static; inline-size: auto; block-size: auto; }

    @media (forced-colors: active) {
      .dialog, .full-map-hud, .mobile-sheet, .host-state { border: 1px solid CanvasText; }
      .sheet-handle { background: CanvasText; }
    }

    @media (prefers-reduced-motion: reduce) {
      .narrow .mobile-sheet { transition: none; }
    }
  `]}#C(H,V,L){return B(this.localize,H,V,L)}#H;#V;#t;#L;#M;#i;#a;#e;#d;#p;connectedCallback(){super.connectedCallback(),this.#H=new ResizeObserver(([H])=>{if(!H)return;let V=H.contentRect.width<768||H.contentRect.height<480;V!==this._measuredNarrow&&(this._measuredNarrow=V)}),this.#H.observe(this),window.addEventListener("pointerdown",this.#p,!0),document.addEventListener("fullscreenchange",this.#d),this.#V=new ResizeObserver(([H])=>{if(!H)return;let V=Math.ceil(H.target.getBoundingClientRect().height);V!==this._sheetOffset&&(this._sheetOffset=V)})}disconnectedCallback(){this.#H?.disconnect(),this.#H=null,this.#V?.disconnect(),this.#V=null,this.#t=null,window.removeEventListener("pointerdown",this.#p,!0),document.removeEventListener("fullscreenchange",this.#d),super.disconnectedCallback()}updated(H){let V=H,L=this.renderRoot.querySelector(".mobile-sheet");if(L!==this.#t&&(this.#V?.disconnect(),this.#t=L,L?this.#V?.observe(L):this._sheetOffset!==0&&(this._sheetOffset=0)),V.has("_overflowOpen")&&this._overflowOpen&&this.updateComplete.then(()=>{this.renderRoot.querySelector("#map-options select, #map-options button")?.focus()}),V.has("_helpOpen")){if(this._helpOpen)this.updateComplete.then(()=>{this.renderRoot.querySelector(".help-dialog [data-dialog-initial-focus]")?.focus()});else if(V.get("_helpOpen")){let r=this.#M;this.#M=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>r?.focus({preventScroll:!0}))})}}if(H.has("state")){let r=H.get("state");if(r?.precisionOpen&&!this.state.precisionOpen&&this.#h()?.focus(),!r?.dialog&&this.state.dialog){let t=s7(this.shadowRoot||document);t?.hasAttribute("data-dialog-launcher")&&(this.#L=t),this.updateComplete.then(()=>{(this.renderRoot.querySelector(".dialog [data-dialog-initial-focus]")??this.renderRoot.querySelector(".dialog button"))?.focus()})}else if(r?.dialog&&!this.state.dialog){let t=this.#L?.isConnected&&this.#L.hasAttribute("data-dialog-launcher")?this.#L:this.#G(r.dialog);this.#L=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>t?.focus({preventScroll:!0}))})}r?r.workflow!==this.state.workflow&&(this._sheetDetent=K3[this.state.workflow],this.updateComplete.then(()=>this.#Z())):this._sheetDetent=K3[this.state.workflow]}}#Z(){let H=this.renderRoot.querySelector(".panel-heading h2");if(X2(H)){H.focus({preventScroll:!0});return}let V=this.renderRoot.querySelector(".action-bar .ms-btn--primary");X2(V)&&V.focus({preventScroll:!0})}#h(){let H=this.renderRoot.querySelector(".draw-brush");return X2(H)?H:this.renderRoot.querySelector(t1)?.shadowRoot?.querySelector(".draw-brush")??null}#o(H){this.dispatchEvent(new CustomEvent(i1,{detail:H,bubbles:!0,composed:!0}))}#S(H){if(H.enabled){if(H.id==="return-live"){this.#o({type:"set-history",historyId:null});return}if(H.id==="clear-draft"){this.#o({type:"clear-draft"});return}this.#m(H.id)}}#A(H){if(this.state.workflow==="draw"&&this.state.draw.dirty&&H!=="draw"&&H!=="areaReview"){this.#i=H,this.#o({type:"open-dialog",dialog:"discardDraft"});return}this.#o({type:"open-workflow",workflow:H})}#n(){let H=this.#i;this.#i=null,this.#o({type:"discard-draft"}),H&&queueMicrotask(()=>this.#o({type:"open-workflow",workflow:H}))}#c(){this.#i=null,this.#x()}#x(){let H=this.state.dialog,V=H&&this.#L?.isConnected&&this.#L.hasAttribute("data-dialog-launcher")?this.#L:H?this.#G(H):null;this.#o({type:"dismiss-top-layer"}),V&&requestAnimationFrame(()=>V.focus({preventScroll:!0}))}#m(H){this.dispatchEvent(new CustomEvent(V2,{detail:{id:H},bubbles:!0,composed:!0}))}#r(H){this.#o({type:"dismiss-top-layer"}),this.#m(H)}#v(H){if(H.action==="discard"){this.#n();return}if(H.action==="delete-plan"||H.action==="delete-area"){this.#r(H.action);return}this.#o({type:"dismiss-top-layer"}),H.action==="stop"&&this.#m("stop")}#s(H){H!==this._sheetDetent&&(this._sheetDetent=H,this._announcement=this.#C("v4_workspace_height","Map workspace, {height} height",{height:H}))}#l(H,V=!1){let r=C1.indexOf(this._sheetDetent)+H;V&&r>=C1.length&&(r=0),r=Math.max(0,Math.min(C1.length-1,r)),this.#s(C1[r]??this._sheetDetent)}#T(H){let V=this.renderRoot.querySelector(".workspace")?.clientHeight??H.parentElement?.clientHeight??H.offsetHeight,L=parseFloat(getComputedStyle(this).fontSize)||16,r=[".sheet-grip",".sheet-tools",".action-bar"].map(o=>H.querySelector(o)?.offsetHeight??0).reduce((o,i)=>o+i,0)+L*.75,t=Math.min(V*.92,V-L*4),M=Math.min(V*.48,L*26,t);return{peek:Math.min(r,M),half:M,full:t}}#f(){return this.renderRoot.querySelector(".mobile-sheet")}#y(H){if(H.pointerType==="mouse"&&H.button!==0||H.target?.closest("button, select, input, a"))return;let V=this.#f();!V||this.#a||(this.#a={pointerId:H.pointerId,startY:H.clientY,startHeight:V.offsetHeight,heights:this.#T(V),lastY:H.clientY,lastTime:H.timeStamp,velocity:0,moved:!1},H.currentTarget.setPointerCapture(H.pointerId),V.classList.add("dragging"))}#_(H){let V=this.#a;if(!V||H.pointerId!==V.pointerId)return;let L=this.#f();if(!L)return;let r=H.clientY-V.startY;!V.moved&&Math.abs(r)>n7&&(V.moved=!0);let t=Math.max(1,H.timeStamp-V.lastTime);if(V.velocity=(H.clientY-V.lastY)/t,V.lastY=H.clientY,V.lastTime=H.timeStamp,!V.moved)return;let M=V.startHeight-V.heights.full,o=V.startHeight-V.heights.peek,i=Math.max(M,Math.min(o,r));L.style.transform=`translateY(${i}px)`}#g(H){let V=this.#a;if(!V||H.pointerId!==V.pointerId)return;this.#a=null;let L=this.#f();if(L&&(L.style.transform="",L.classList.remove("dragging")),H.type==="pointercancel")return;if(!V.moved){this.#l(1,!0);return}let r=H.clientY-V.startY,t=C1.indexOf(this._sheetDetent);if(Math.abs(V.velocity)>a7){let a=Math.max(0,Math.min(C1.length-1,t+(V.velocity<0?1:-1)));this.#s(C1[a]??this._sheetDetent);return}let M=V.startHeight-r,o=this._sheetDetent,i=Number.POSITIVE_INFINITY;for(let a of C1){let n=Math.abs(V.heights[a]-M);n<i&&(i=n,o=a)}this.#s(o)}#P(H){if(H.pointerType==="mouse")return;let V=H.currentTarget;this.#e={pointerId:H.pointerId,startY:H.clientY,atTop:V.scrollTop===0,consumed:!1}}#O(H){let V=this.#e;if(!V||V.consumed||!V.atTop||H.pointerId!==V.pointerId)return;if(H.currentTarget.scrollTop>0){this.#e=null;return}H.clientY-V.startY<A7||(V.consumed=!0,this.#l(-1))}#k(){this.#e=null}#b(){if(this.state.precisionOpen||this.state.fullMap){this.#o({type:"dismiss-top-layer"});return}if(this.state.workflow!=="none"){this.#A("none");return}this.#u()}#u(){this.dispatchEvent(new CustomEvent("hass-toggle-menu",{bubbles:!0,composed:!0}))}#B(H){this._overflowOpen=!1,H&&this.updateComplete.then(()=>{this.renderRoot.querySelector(".overflow")?.focus()})}#w(H){if(this.#B(H==="fullscreen"),H==="support"){this.#A("support");return}if(H==="fullscreen"){let V=this.renderRoot.querySelector(".app");document.fullscreenElement?document.exitFullscreen():V?.requestFullscreen();return}this.dispatchEvent(new CustomEvent(V2,{detail:{id:"use-classic"},bubbles:!0,composed:!0}))}#R(){this.#o({type:"set-precision-open",value:!this.state.precisionOpen})}#U(H){this.#M=H.currentTarget,this._helpOpen=!0}#j(H){let V=H;if(V.detail?.type!=="open-dialog")return;let L=V.composedPath().find(r=>r instanceof HTMLElement&&r.hasAttribute("data-dialog-launcher"));L instanceof HTMLElement&&(this.#L=L)}#G(H){return this.renderRoot.querySelector(c1)?.shadowRoot?.querySelector(`[data-dialog-launcher="${H}"]`)??null}#Q(H){if(!(H.defaultPrevented||H.ctrlKey||H.metaKey||H.altKey)&&H.key==="Escape"){if(H.preventDefault(),this._overflowOpen){this.#B(!0);return}if(this._helpOpen){this._helpOpen=!1;return}this.#o({type:"dismiss-top-layer"})}}#$(H){if(H.key!=="Tab")return;let L=[...H.currentTarget.querySelectorAll(l7)],r=L[0],t=L.at(-1);if(!r||!t)return;let M=this.shadowRoot?.activeElement;H.shiftKey&&M===r?(H.preventDefault(),t.focus()):!H.shiftKey&&M===t&&(H.preventDefault(),r.focus())}#J(){let H=this.renderRoot.querySelector(t1);(H?.shadowRoot?.querySelector(".map-root")??H)?.focus()}#K(){this._sheetDetent==="peek"&&this.#f()&&this.#s("half"),this.updateComplete.then(()=>this.#Z())}#E(H,V,L){if(H.id==="choose-cleaning")return l;let r=H.labelKey?this.#C(H.labelKey,H.label):H.label,t=!H.enabled&&H.reason?H.reasonKey?this.#C(H.reasonKey,H.reason):H.reason:null,M=H.id==="stop";return v`
      <button
        class=${`${V} ${H.kind==="danger"?"ms-btn--danger":""}`}
        type="button"
        aria-disabled=${H.enabled?l:"true"}
        aria-describedby=${t?L:l}
        aria-label=${M?this.#C("v4_stop_cleaning_label","Stop cleaning"):l}
        @click=${()=>this.#S(H)}
      >${r}</button>
      ${t?v`<p class="action-reason" id=${L}>${t}</p>`:l}
    `}#I(H){let V=H.resources.plans.value?.rooms??H.resources.areas.value?.rooms??[];return H.selection.roomIds.map(L=>V.find(r=>r.roomId===L)?.name??L)}#W(H,V,L){let r=V?.enabled&&H.workflow==="rooms"&&V.id==="clean-rooms"?[this.#I(H).join(", "),H.planDraft.returnToBase?this.#C("v4_returns_to_dock","returns to the dock"):""].filter(Boolean).join(" \xB7 "):"";return v`
      <div class="action-bar">
        ${r?v`<p class="action-summary">${r}</p>`:l}
        ${V?this.#E(V,"ms-btn ms-btn--block ms-btn--lg ms-btn--primary","primary-reason"):l}
        ${L?this.#E(L,"ms-btn ms-btn--block ms-btn--lg ms-btn--secondary","secondary-reason"):l}
      </div>
    `}#D(H,V,L=l){return v`
      <div class="host-state">
        <h3>${H}</h3>
        <p>${V}</p>
        ${L}
      </div>
    `}#F(H,V,L){return v`
      <button class="ms-row" type="button" @click=${L}>
        <span class="ms-row__lead">${Z(V)}</span>
        <span class="ms-row__body"><strong>${H}</strong></span>
        <span class="ms-row__trail">${Z(X1)}</span>
      </button>
    `}#q(H){let V=H.resources.history.value?.floors||[],L=V.length?V.map((r,t)=>({id:r.active?"current":r.id,label:`${r.label||(r.active?this.#C("v4_current_floor","Current floor"):this.#C("v4_saved_floor","Saved floor {number}",{number:r.ordinal??t+1}))}${!r.active&&r.snapshots.length===0?` \xB7 ${this.#C("v4_floor_not_captured","Visit floor to capture")}`:""}`,disabled:!r.active&&r.snapshots.length===0})):[{id:H.selection.floorId,label:H.floor.displayName,disabled:!1}];return v`
      <select
        class="ms-select context-switcher floor-switcher"
        aria-label=${this.#C("v4_choose_floor","Choose floor")}
        ?disabled=${L.length<=1}
        .value=${H.selection.floorId}
        @change=${r=>this.#o({type:"set-floor",floorId:r.currentTarget.value})}
      >${L.map(r=>v`
        <option value=${r.id} ?disabled=${r.disabled}>${r.label}</option>
      `)}</select>
    `}#C1(H,V){let L=(u,h,x)=>this.#C(u,h,x),r=this.#F(L("v4_map_history","Map history"),R1,()=>this.#A("history")),t=this.#F(L("v4_map_diagnostics","Map diagnostics"),R1,()=>this.#A("support")),{host:M}=H;if(!M.connected)return this.#D(L("v4_reconnecting_title","Reconnecting to Home Assistant"),L("v4_reconnecting_body","The last verified map stays read-only until the connection returns."));if(!M.administrator)return this.#D(L("v4_admin_title","Administrator access required"),L("v4_admin_body","Ask a Home Assistant administrator to open this map."));if(M.robotCount===0)return this.#D(L("v4_no_robot_title","No Matic robot set up"),L("v4_no_robot_body","Add the Matic integration to see a map here."),v`<a class="ms-btn ms-btn--secondary" href="/config/integrations/integration/matic_robot">${L("v4_open_integration","Open the Matic integration")}</a>`);if(!M.robotConnected)return v`
        ${this.#D(L("v4_robot_offline_title","Robot offline"),L("v4_robot_offline_body","Showing the last verified map. Cleaning is unavailable until the robot reconnects."))}
        <h3 class="shelf-heading">${L("v4_more","More")}</h3>
        <div class="shelf">${r}${t}</div>
      `;let o=H.coherence==="verifying"||H.coherence==="booting",i=H.resources.plans.value,a=i!==null&&i.rooms.length===0,n=i?.plans.length??0,A=o||a,d=o?L("v4_reason_locating","Waiting for the robot to confirm which floor it is on."):a?L("v4_no_rooms_reason","This floor has no named rooms yet."):null,m=o?L("v4_reason_locating","Waiting for the robot to confirm which floor it is on."):null;return v`
      ${H.activity==="problem"?this.#D(L("v4_attention_title","The robot needs attention"),L("v4_attention_body","Check the robot, then start a new task.")):v`
          <div class="quick-actions" aria-label=${L("v4_cleaning_choices","Cleaning choices")}>
            <button
              class="ms-row ms-row--card ms-row--featured"
              type="button"
              aria-disabled=${A?"true":l}
              @click=${()=>{A||this.#A("rooms")}}
            >
              <span class="ms-row__lead">${Z(Y1)}</span>
              <span class="ms-row__body">
                <strong>${L("v4_clean_rooms","Clean rooms")}</strong>
                <small>${d??L("v4_clean_rooms_hint","Choose rooms on the map and start now")}</small>
              </span>
              <span class="ms-row__trail">${Z(X1)}</span>
            </button>
            <button
              class="ms-row ms-row--card"
              type="button"
              aria-disabled=${o?"true":l}
              @click=${()=>{o||this.#A("plan")}}
            >
              <span class="ms-row__lead">${Z(R1)}</span>
              <span class="ms-row__body">
                <strong>${n?L("v4_run_a_plan","Run a plan"):L("v4_create_plan","Create a plan")}</strong>
                <small>${m??(n?L("v4_saved_routines","{count} saved routines",{count:n}):L("v4_no_plans_hint","Save a room routine you can repeat"))}</small>
              </span>
              <span class="ms-row__trail">${Z(X1)}</span>
            </button>
          </div>
        `}
      <h3 class="shelf-heading">${L("v4_more","More")}</h3>
      <div class="shelf">
        ${this.#F(L("v4_custom_areas","Custom areas"),B3,()=>this.#A("draw"))}
        ${r}
        ${V?this.#q(H):l}
      </div>
      ${V?v`
        <h3 class="shelf-heading" id="map-display-heading">${L("v4_map_display","Map display")}</h3>
        <div class="map-display">
          <div class="ms-segment" role="group" aria-labelledby="map-display-heading">
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(H.appearance==="photo")}
              @click=${()=>this.#o({type:"set-appearance",appearance:"photo"})}
            >${L("map_style_photo","Photo")}</button>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(H.appearance==="rooms")}
              @click=${()=>this.#o({type:"set-appearance",appearance:"rooms"})}
            >${L("v4_room_colours","Room colours")}</button>
          </div>
          <label class="ms-checkbox">
            <input type="checkbox" .checked=${H.labelsVisible} @change=${()=>this.#o({type:"toggle-labels"})}>
            ${L("v4_room_names","Room names")}
          </label>
          <button
            class="ms-btn ms-btn--secondary help-launcher"
            type="button"
            aria-haspopup="dialog"
            aria-expanded=${String(this._helpOpen)}
            @click=${this.#U}
          >${L("v4_how_to_move","How to move the map")}</button>
        </div>
      `:l}
    `}#H1(H,V){return H.workflow==="none"?this.#C1(H,V):v`<${G3}
      .state=${H}
      .localize=${this.localize}
      @matic-workspace-intent=${this.#j}
    ></${G3}>`}#X(H,V){let L=Q3(H,this.localize);return v`
      <div class="panel-heading">
        ${H.workflow!=="none"?v`
          <button
            class="panel-back ms-btn ms-btn--secondary"
            type="button"
            aria-label=${this.#C("v4_back_to_all_tasks","Back to all tasks")}
            @click=${()=>this.#A(H.workflow==="areaReview"?"draw":"none")}
          >${Z($2)}<span class="ms-btn__label">${this.#C("v4_all_tasks","All tasks")}</span></button>
        `:l}
        <h2 tabindex="-1">${L.title}</h2>
      </div>
      <p class="panel-description">${L.description}</p>
      ${this.#H1(H,V)}
    `}#V1(H,V){let r=Q3(H,this.localize).title;return H.workflow==="rooms"&&H.selection.roomIds.length&&(r=`${this.#C("v4_rooms_selected","{count} rooms selected",{count:H.selection.roomIds.length})} \xB7 ${this.#I(H).join(", ")}`),V.notable?`${V.title} \xB7 ${r}`:r}#L1(){let H=(V,L)=>this.#C(V,L);return v`
      <div class="dialog-backdrop" @click=${V=>{V.target===V.currentTarget&&(this._helpOpen=!1)}}>
        <section
          class="dialog help-dialog ms-surface ms-surface--overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-title"
          @keydown=${this.#$}
        >
          <h2 id="help-title">${H("v4_how_to_move","How to move the map")}</h2>
          <dl>
            <dt>${H("v4_trackpad","Trackpad")}</dt>
            <dd>${H("v4_trackpad_help","Scroll to pan \xB7 pinch to zoom \xB7 twist to rotate")}</dd>
            <dt>${H("v4_mouse","Mouse")}</dt>
            <dd>${H("v4_mouse_help","Drag to orbit \xB7 Shift, middle, or right drag to pan \xB7 wheel to zoom")}</dd>
            <dt>${H("v4_keyboard","Keyboard")}</dt>
            <dd>${H("v4_keyboard_help","WASD to move \xB7 Q/E or arrows to orbit \xB7 +/\u2212 to zoom \xB7 0 to fit")}</dd>
          </dl>
          <div class="dialog-actions">
            <button
              class="ms-btn ms-btn--secondary"
              type="button"
              data-dialog-initial-focus
              @click=${()=>{this._helpOpen=!1}}
            >${H("v4_close","Close")}</button>
          </div>
        </section>
      </div>
    `}render(){let H=this.state,V=H.narrowHint||this._measuredNarrow,L=i7(H,this.localize),r=A5({...H,narrowHint:V}),t=l5(H),M=!V&&r.id==="stop"?r:!V&&t?.id==="stop"?t:null,o=M&&M===r?null:r,i=H.workflow==="draw"&&H.dataMode==="live"?{id:"clear-draft",label:"Clear drawing",labelKey:"v4_clear_drawing",kind:"neutral",enabled:H.draw.circles.length>0}:null,a=M&&M===t?null:t??i,n=H.fullMap&&(H.coherence==="verifying"||H.coherence==="booting"),A=H.fullMap||H.precisionOpen,d=d7(H.dialog,this.localize),m=V&&!H.fullMap?`--map-sheet-offset:${this._sheetOffset}px`:"--map-sheet-offset:0px",u=V&&H.workflow==="draw",h=H.precisionOpen&&H.workflow==="draw";return v`
      <div class=${`root ${V?"narrow":"wide"}`} @keydown=${this.#Q}>
        <button class="skip-link ms-btn ms-btn--primary" type="button" @click=${this.#J}>${this.#C("v4_skip_to_map","Skip to the map")}</button>
        <button class="skip-link ms-btn ms-btn--primary" type="button" @click=${this.#K}>${this.#C("v4_skip_to_workspace","Skip to the map workspace")}</button>
        <div class="app" ?inert=${!!d||this._helpOpen}>
          <header class="app-bar">
            <button
              class="nav ms-btn ms-btn--icon"
              type="button"
              aria-label=${A?this.#C("v4_back","Back"):this.#C("v4_open_navigation","Open navigation")}
              @click=${this.#b}
            >${Z(A?$2:d3)}</button>
            <h1 class="title">${this.#C("map_studio_title","Matic Map")}</h1>
            ${H.robots.length>1?v`
              <select
                class="ms-select context-switcher robot-switcher"
                aria-label=${this.#C("v4_choose_robot","Choose robot")}
                .value=${H.selection.entryId||""}
                @change=${x=>this.#o({type:"select-entry",entryId:x.currentTarget.value})}
              >${H.robots.map(x=>v`
                <option value=${x.entryId}>${x.label}</option>
              `)}</select>
            `:l}
            ${V?l:this.#q(H)}
            <span class="spacer"></span>
            <div class="overflow-wrap">
              <button
                class="overflow ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#C("v4_map_options","Map options")}
                aria-expanded=${String(this._overflowOpen)}
                aria-controls="map-options"
                @click=${()=>{this._overflowOpen=!this._overflowOpen}}
              >${Z(s3)}</button>
              ${this._overflowOpen?v`
                <div id="map-options" class="overflow-menu ms-surface ms-surface--overlay">
                  <label class="overflow-field ms-field">${this.#C("map_quality_label","Scene detail")}
                    <select
                      aria-label=${this.#C("map_quality_label","Scene detail")}
                      .value=${H.quality}
                      @change=${x=>this.#o({type:"set-quality",quality:x.currentTarget.value})}
                    >
                      <option value="auto">${this.#C("map_quality_auto","Auto detail")}</option>
                      <option value="efficient">${this.#C("map_quality_efficient","Efficient")}</option>
                      <option value="balanced">${this.#C("map_quality_balanced","Balanced")}</option>
                      <option value="maximum">${this.#C("map_quality_maximum","Maximum")}</option>
                    </select>
                  </label>
                  <button class="ms-row ms-row--menu" type="button" @click=${()=>this.#w("support")}>${this.#C("v4_map_diagnostics","Map diagnostics")}</button>
                  <button class="ms-row ms-row--menu" type="button" @click=${()=>this.#w("classic")}>${this.#C("v4_switch_classic","Switch to Map Studio 0.3")}</button>
                  <button class="ms-row ms-row--menu" type="button" @click=${()=>this.#w("fullscreen")}>${this._browserFullscreen?this.#C("v4_leave_full_screen","Leave full screen"):this.#C("v4_full_screen","Full screen")}</button>
                </div>
              `:l}
            </div>
          </header>

          <main class=${`workspace ${H.fullMap?"full-map":""}`} style=${m}>
            <div class="canvas">
              <${U3}
                class="map-canvas"
                style=${m}
                .state=${H}
                .localize=${this.localize}
                .narrow=${V}
              ></${U3}>
              ${!V&&h?v`
                <div class="precision-popover">
                  <${L2} compact .state=${H} .localize=${this.localize}></${L2}>
                </div>
              `:l}
            </div>

            ${V&&!H.fullMap&&this._sheetDetent==="full"?v`
              <button
                class="sheet-scrim"
                type="button"
                aria-label=${this.#C("v4_collapse_sheet","Collapse the map workspace")}
                @click=${()=>this.#s("peek")}
              ></button>
            `:l}

            <!--
              One panel element, not two. It is a grid column when wide and a
              bottom sheet when narrow. Rendering both and hiding one with
              display:none meant two live workflow panels at all times, which
              made #dialogLauncherFor pick the hidden copy on narrow -- so
              cancelling a delete dialog on a phone restored focus to nothing --
              and left every primary action ambiguous under Playwright's strict
              mode.
            -->
            <aside
              class=${V?"inspector mobile-sheet":"inspector"}
              data-detent=${V?this._sheetDetent:l}
              data-workflow=${H.workflow}
              aria-label="Map workspace"
            >
              ${V?v`
                <div
                  class="sheet-grip"
                  @pointerdown=${this.#y}
                  @pointermove=${this.#_}
                  @pointerup=${this.#g}
                  @pointercancel=${this.#g}
                >
                  <span class="sheet-handle" role="presentation"></span>
                  <span class="sheet-status">${this.#V1(H,L)}</span>
                  <button
                    class="ms-btn ms-btn--icon ms-btn--sm"
                    type="button"
                    aria-label=${this.#C("v4_show_more","Show more of the map workspace")}
                    aria-controls="sheet-body"
                    aria-disabled=${this._sheetDetent==="full"?"true":l}
                    @click=${()=>this.#l(1)}
                  >${Z(p3)}</button>
                  <button
                    class="ms-btn ms-btn--icon ms-btn--sm"
                    type="button"
                    aria-label=${this.#C("v4_show_less","Show less of the map workspace")}
                    aria-controls="sheet-body"
                    aria-disabled=${this._sheetDetent==="peek"?"true":l}
                    @click=${()=>this.#l(-1)}
                  >${Z(m3)}</button>
                </div>
                ${u?v`
                  <div class="sheet-tools">
                    ${j1(H,{intent:x=>this.#o(x),openBrush:()=>this.#R(),t:(x,f)=>this.#C(x,f)},"grid")}
                    ${h?v`
                      <div class="precision-popover">
                        <${L2} compact inline .state=${H} .localize=${this.localize}></${L2}>
                      </div>
                    `:l}
                  </div>
                `:l}
                <div
                  class="sheet-body"
                  id="sheet-body"
                  @pointerdown=${this.#P}
                  @pointermove=${this.#O}
                  @pointerup=${this.#k}
                  @pointercancel=${this.#k}
                >
                  ${this.#X(H,V)}
                </div>
                ${this.#W(H,o,a)}
              `:v`
                <div class="status-strip">
                  <span class="status-icon" aria-hidden="true">${Z(L.icon)}</span>
                  <span class="status-copy"><strong>${L.title}</strong><small>${L.detail}</small></span>
                  ${M?this.#E(M,"status-action ms-btn ms-btn--secondary","status-reason"):l}
                </div>
                <section class="workflow">
                  ${this.#X(H,V)}
                  ${this.#W(H,o,a)}
                </section>
              `}
            </aside>

            ${H.fullMap?v`
              <section
                class=${`full-map-hud ms-surface ms-surface--floating ${t?"has-secondary":""} ${!V&&(H.workflow==="draw"||H.workflow==="rooms"&&H.selection.roomIds.length>0)?"above-dock":""}`}
                aria-label="Robot status and action"
              >
                <span class="hud-copy"><strong>${L.title}</strong><small>${L.detail}</small></span>
                ${n?l:this.#E(r,"ms-btn ms-btn--lg ms-btn--primary","hud-reason")}
                ${!n&&t?this.#E(t,"ms-btn ms-btn--lg ms-btn--secondary","hud-secondary-reason"):l}
              </section>
            `:l}
          </main>
        </div>

        <div class="sr-only" aria-live="polite" aria-atomic="true">${[this._announcement,H.notice?.text??""].filter(Boolean).join(" ")}</div>

        ${this._helpOpen?this.#L1():l}

        ${d?v`
          <div class="dialog-backdrop">
            <section
              class="dialog ms-surface ms-surface--overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="dialog-title"
              aria-describedby="dialog-detail"
              @keydown=${this.#$}
            >
              <h2 id="dialog-title">${d.title}</h2>
              <p id="dialog-detail">${d.detail}</p>
              <div class="dialog-actions">
                <button
                  class="ms-btn ms-btn--secondary"
                  type="button"
                  data-dialog-initial-focus
                  @click=${H.dialog==="discardDraft"?this.#c:this.#x}
                >${d.cancelLabel}</button>
                ${d.action===null?l:v`
                  <button
                    class="discard ms-btn ms-btn--primary ms-btn--danger"
                    type="button"
                    @click=${()=>this.#v(d)}
                  >${d.confirmLabel}</button>
                `}
              </div>
            </section>
          </div>
        `:l}
      </div>
    `}};customElements.get(M1)||customElements.define(M1,Y2);var q3=j(M1),j2=class extends O{constructor(){super(...arguments);this.scenario="ready";this.narrow=!1;this.controls=!0;this._workspace=u2("ready");this.#C=new d1(this._workspace);this.#H=null}static{this.properties={scenario:{type:String,reflect:!0},narrow:{type:Boolean,reflect:!0},controls:{type:Boolean,reflect:!0},_workspace:{state:!0}}}static{this.styles=[E,D,b`
    :host {
      display: block;
      color: #1f2933;
      background: #e8edef;
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    }


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
    .shell { block-size: 100%; }
  `]}#C;#H;connectedCallback(){super.connectedCallback(),this.#H=this.#C.subscribe(H=>{this._workspace=H})}disconnectedCallback(){this.#H?.(),this.#H=null,super.disconnectedCallback()}willUpdate(H){H.has("scenario")?this.#C.replace({...u2(this.scenario),narrowHint:this.narrow}):H.has("narrow")&&this.#C.dispatch({type:"set-narrow-hint",value:this.narrow})}setScenario(H){Z2.includes(H)&&(this.scenario=H)}getWorkspaceSnapshot(){return structuredClone(this.#C.value)}replaceWorkspaceState(H){this.#C.replace(structuredClone(H))}#V(H){W1(H.detail)&&(H.stopPropagation(),this.#C.dispatch(H.detail))}render(){return v`
      ${this.controls?v`
        <nav class="gallery-controls" aria-label="Map Studio states">
          ${Z2.map(H=>v`
            <button
              type="button"
              aria-pressed=${String(this.scenario===H)}
              @click=${()=>{this.scenario=H}}
            >${H}</button>
          `)}
        </nav>
      `:null}
      <div class="stage">
        <${q3}
          class="shell"
          .state=${this._workspace}
          @matic-workspace-intent=${this.#V}
        ></${q3}>
      </div>
    `}};customElements.get("matic-map-studio-gallery-v0-4-0")||customElements.define("matic-map-studio-gallery-v0-4-0",j2);var X3="/api/matic_robot/slam_entries";var p=class extends Error{constructor(C){super(C),this.name="ContractError",this.code=C}},R=(e,C)=>{if(!e||typeof e!="object"||Array.isArray(e))throw new p(C);return e},w=(e,C,H)=>{if(typeof e!="string")throw new p(H);let V=e.trim();if(!V||Array.from(V).length>C||/[\u0000-\u001f\u007f]/u.test(V))throw new p(H);return V},p7=e=>{if(e==null||e==="")return null;try{return w(e,128,"invalid-floor-label")}catch{return null}},Z1=(e,C,H,V)=>{if(typeof e!="number"||!Number.isFinite(e)||e<C||e>H)throw new p(V);return e},N=(e,C,H,V)=>{let L=Z1(e,C,H,V);if(!Number.isInteger(L))throw new p(V);return L},J2=(e,C)=>e==null?null:N(e,1,C,"invalid-floor-ordinal"),g=(e,C)=>{if(typeof e!="boolean")throw new p(C);return e},m7=(e,C)=>e===null?null:g(e,C),Y3=e=>{if(e==null)return null;let C=w(e,64,"invalid-map-session-key");if(!/^[0-9a-f]{64}$/u.test(C))throw new p("invalid-map-session-key");return C},v7=e=>{if(e==null)return null;if(e==="bootstrap_empty"||e==="map_session_unverified"||e==="floor_plan_unavailable"||e==="floor_plan_mismatch")return e;throw new p("invalid-map-block-reason")},c7=e=>{if(e===void 0)return"not_started";if(e==="not_started"||e==="running"||e==="complete"||e==="partial"||e==="failed")return e;throw new p("invalid-bootstrap-state")},q=(e,C)=>{let H=w(e,512,C);if(!H.startsWith("/")||H.startsWith("//")||H.includes("\\"))throw new p(C);return H},x7=e=>{let C=typeof e.map_health=="string"?e.map_health.toLowerCase():"",H=typeof e.stream_state=="string"?e.stream_state.toLowerCase():"",V=typeof e.invalid_tiles=="number"?e.invalid_tiles:0;return C.includes("error")||C.includes("fail")||C.includes("degrad")||V>0?"problem":e.map_truncated===!0||C.includes("truncat")||C.includes("limit")?"limited":e.map_complete===!0?"ready":H.includes("connect")||H.includes("collect")||H.includes("run")?"building":"unknown"},j3=e=>{let C=R(e,"invalid-catalog");if(!Array.isArray(C.entries)||C.entries.length>64)throw new p("invalid-catalog-entries");return C.entries.map(H=>{let V=R(H,"invalid-catalog-entry"),L=N(V.map_revision,0,Number.MAX_SAFE_INTEGER,"invalid-map-revision");return{entryId:w(V.entry_id,128,"invalid-entry-id"),sceneUrl:q(V.scene_url,"invalid-scene-url"),deltaUrl:V.delta_url===void 0||V.delta_url===null?null:q(V.delta_url,"invalid-delta-url"),poseUrl:q(V.pose_url,"invalid-pose-url"),historyUrl:q(V.history_url,"invalid-history-url"),areasUrl:q(V.areas_url,"invalid-areas-url"),plansUrl:q(V.plans_url,"invalid-plans-url"),mapRevision:L,mapFloorCoherent:g(V.map_floor_coherent,"invalid-floor-coherence"),mapSessionVerified:g(V.map_session_verified,"invalid-session-state"),mapSessionKey:Y3(V.map_session_key),mapBlockReason:v7(V.map_block_reason),runnerLocked:g(V.runner_locked,"invalid-runner-lock"),stopSettlePending:g(V.stop_settle_pending,"invalid-stop-settle"),activePlan:g(V.active_plan,"invalid-active-plan"),nativeReconciliationPending:g(V.native_reconciliation_pending,"invalid-native-reconciliation"),nativeSessionActive:m7(V.native_session_active,"invalid-native-session"),mapComplete:g(V.map_complete,"invalid-map-complete"),mapTruncated:g(V.map_truncated,"invalid-map-truncated"),selectedFloorOrdinal:J2(V.selected_floor_ordinal,128),mapFloorOrdinal:J2(V.map_floor_ordinal,128),historyCount:N(V.history_count,0,12,"invalid-history-count"),historyFloorCount:N(V.history_floor_count,0,128,"invalid-floor-count"),health:x7(V),streamFailures:N(V.stream_failures,0,Number.MAX_SAFE_INTEGER,"invalid-stream-failures"),bootstrapState:c7(V.bootstrap_state),bootstrapPhotoSeen:V.bootstrap_photo_seen===void 0?!1:g(V.bootstrap_photo_seen,"invalid-bootstrap-photo"),bootstrapStructureSeen:V.bootstrap_structure_seen===void 0?!1:g(V.bootstrap_structure_seen,"invalid-bootstrap-structure"),bootstrapFailures:V.bootstrap_failures===void 0?0:N(V.bootstrap_failures,0,2,"invalid-bootstrap-failures")}})},J3=(e,C)=>{if(!Array.isArray(e)||e.length!==2)throw new p(C);return[Z1(e[0],-1e6,1e6,C),Z1(e[1],-1e6,1e6,C)]},u7=(e,C)=>{if(!Array.isArray(e)||e.length<3||e.length>8192)throw new p(C);return e.map(H=>J3(H,C))},C0=(e,C)=>{if(!Array.isArray(e)||e.length>256)throw new p("invalid-rooms");return e.map(H=>{let V=R(H,"invalid-room");return{roomId:w(V.room_id,128,"invalid-room-id"),name:w(V.name,128,"invalid-room-name"),boundary:C?u7(V.boundary,"invalid-room-boundary"):[]}})},Z7=e=>{let C=R(e,"invalid-history-snapshot"),H=w(C.created_at,64,"invalid-history-time");if(!Number.isFinite(Date.parse(H)))throw new p("invalid-history-time");return{id:w(C.id,128,"invalid-history-id"),createdAt:H,revision:N(C.revision,0,Number.MAX_SAFE_INTEGER,"invalid-history-revision"),pointCount:N(C.point_count,1,15e5,"invalid-history-points"),sceneUrl:q(C.scene_url,"invalid-history-scene-url")}},H0=e=>{let C=R(e,"invalid-history");if(!Array.isArray(C.floors)||C.floors.length<1||C.floors.length>128)throw new p("invalid-history-floors");return{entryId:w(C.entry_id,128,"invalid-history-entry"),liveAvailable:g(C.live_available,"invalid-history-live"),floors:C.floors.map(H=>{let V=R(H,"invalid-history-floor");if(!Array.isArray(V.snapshots)||V.snapshots.length>12)throw new p("invalid-history-snapshots");return{id:w(V.id,128,"invalid-history-floor-id"),active:g(V.active,"invalid-history-floor-active"),readOnly:g(V.read_only,"invalid-history-floor-read-only"),liveAvailable:V.live_available===void 0?!1:g(V.live_available,"invalid-history-floor-live"),label:p7(V.label),ordinal:V.ordinal===void 0?null:J2(V.ordinal,128),snapshots:V.snapshots.map(Z7)}})}},V0=e=>{if(e==="vacuum"||e==="mop"||e==="vacuum_and_mop")return e;throw new p("invalid-cleaning-mode")},L0=e=>{if(e==="quick"||e==="standard"||e==="heavy_duty")return e;throw new p("invalid-coverage-setting")},h7=e=>{let C=R(e,"invalid-area-circle");return{x:Z1(C.x,-1e6,1e6,"invalid-area-circle"),y:Z1(C.y,-1e6,1e6,"invalid-area-circle"),radius:Z1(C.radius,.05,2.5,"invalid-area-circle")}},S7=e=>e==="current"||e==="review"||e==="stale"?e:"unknown",e0=e=>{let C=R(e,"invalid-areas");if(!Array.isArray(C.areas)||C.areas.length>256)throw new p("invalid-area-list");return{sceneUrl:q(C.scene_url,"invalid-area-scene-url"),rooms:C0(C.rooms,!0),areas:C.areas.map(H=>{let V=R(H,"invalid-area");if(!Array.isArray(V.circles)||V.circles.length>512)throw new p("invalid-area-circles");return{id:w(V.id,128,"invalid-area-id"),name:w(V.name,128,"invalid-area-name"),circles:V.circles.map(h7),cleaningMode:V0(V.cleaning_mode),coverageSetting:L0(V.coverage_setting),status:S7(V.status),canRebind:g(V.can_rebind,"invalid-area-rebind")}})}},r0=e=>{let C=R(e,"invalid-plans");if(!Array.isArray(C.plans)||C.plans.length>256)throw new p("invalid-plan-list");return{rooms:C0(C.rooms,!1).map(({roomId:V,name:L})=>({roomId:V,name:L})),selectedPlan:C.selected_plan===null||C.selected_plan===void 0?null:w(C.selected_plan,128,"invalid-selected-plan"),plans:C.plans.map(V=>{let L=R(V,"invalid-plan");if(!Array.isArray(L.rooms)||L.rooms.length>256||!Array.isArray(L.room_order))throw new p("invalid-plan-rooms");let r=L.run_behavior;if(r!=="intelligent"&&r!=="ordered")throw new p("invalid-run-behavior");return{id:w(L.id,128,"invalid-plan-id"),name:w(L.name,128,"invalid-plan-name"),enabled:g(L.enabled,"invalid-plan-enabled"),runBehavior:r,rooms:L.rooms.map(t=>{let M=R(t,"invalid-plan-room");return{roomId:w(M.room_id,128,"invalid-plan-room-id"),cleaningMode:V0(M.cleaning_mode),coverageSetting:L0(M.coverage_setting)}}),roomOrder:L.room_order.slice(0,256).map(t=>w(t,128,"invalid-room-order")),returnToBase:g(L.return_to_base,"invalid-return-to-base"),finishCurrentRoom:g(L.finish_current_room,"invalid-finish-room"),finishCurrentRoomThreshold:N(L.finish_current_room_threshold,0,100,"invalid-finish-threshold")}})}},t0=e=>{let C=R(e,"invalid-pose"),H=C.position,V=H===null?null:J3(H,"invalid-pose-position"),L=C.pose_freshness;if(L!=="live"&&L!=="coordinator_fallback")throw new p("invalid-pose-freshness");return{position:V,source:w(C.source,64,"invalid-pose-source"),revision:N(C.revision,0,Number.MAX_SAFE_INTEGER,"invalid-pose-revision"),poseRevision:N(C.pose_revision,0,Number.MAX_SAFE_INTEGER,"invalid-pose-sequence"),floorCoherent:g(C.map_floor_coherent,"invalid-pose-floor"),mapSessionKey:Y3(C.map_session_key),freshness:L}},M0=e=>{try{return q(e,"invalid-private-path"),!0}catch{return!1}};var o0=e=>{let r=()=>{throw new Error("invalid-scene")};(!(e instanceof ArrayBuffer)||e.byteLength<24||e.byteLength>16777216)&&r();let t=new DataView(e),M=new Uint8Array(e,0,8),o=String.fromCharCode(...M),i=t.getUint16(8,!0),a=t.getUint16(10,!0),n=t.getUint32(12,!0),A=t.getUint32(16,!0),d=t.getUint32(20,!0),m=A+d,u=24+n;(o!=="MATIC3D\0"||i!==1||a!==8||n>1024*1024||m<1||m>15e5||u+m*a!==e.byteLength)&&r();let h;try{h=JSON.parse(new TextDecoder("utf-8",{fatal:!0}).decode(new Uint8Array(e,24,n)))}catch{r()}(!h||typeof h!="object"||Array.isArray(h))&&r();let x=h,f=x.meters_per_cell,S=x.origin_cells,y=x.span_cells;(typeof f!="number"||!Number.isFinite(f)||f<.001||f>.1||!Array.isArray(S)||S.length!==2||!S.every(F=>typeof F=="number"&&Number.isFinite(F))||!Array.isArray(y)||y.length!==2||!y.every(F=>typeof F=="number"&&Number.isFinite(F)&&F>=1&&F<=65536))&&r();let $1=(Array.isArray(x.rooms)?x.rooms.slice(0,128):[]).flatMap((F,S0)=>{if(!F||typeof F!="object"||Array.isArray(F))return[];let H1=F,I1=typeof H1.name=="string"?H1.name.trim():"";if(!I1||Array.from(I1).length>128||/[\u0000-\u001f\u007f]/u.test(I1))return[];if(!Array.isArray(H1.boundary)||H1.boundary.length<3||H1.boundary.length>8192)return[];let M5=H1.boundary.flatMap(d2=>{if(!Array.isArray(d2)||d2.length!==2)return[];let[s2,p2]=d2;return typeof s2=="number"&&Number.isFinite(s2)&&typeof p2=="number"&&Number.isFinite(p2)?[[s2,p2]]:[]}),n2=H1.center;if(M5.length<3||!Array.isArray(n2)||n2.length!==2)return[];let[A2,l2]=n2;return typeof A2!="number"||!Number.isFinite(A2)||typeof l2!="number"||!Number.isFinite(l2)?[]:[{id:`scene-room-${S0+1}`,name:I1,boundary:M5,center:[A2,l2]}]}),h0=typeof x.sample_step=="number"&&Number.isInteger(x.sample_step)?Math.max(1,Math.min(15e5,x.sample_step)):1,r5=S,t5=y;return{buffer:e,pointOffset:u,floorCount:A,surfaceCount:d,total:m,metadata:{metersPerCell:f,origin:[r5[0],r5[1]],span:[t5[0],t5[1]],sampleStep:h0,rooms:$1}}},b7=e=>{if(e.byteLength>16777216||e.byteLength<24||!1||!1)throw new p("invalid-scene");try{return o0(e)}catch{throw new p("invalid-scene")}},O7=()=>`
  const parseTransfer = ${o0.toString()};
  self.onmessage = (event) => {
    const { id, buffer } = event.data;
    try {
      const parsed = parseTransfer(buffer);
      self.postMessage({ id, ok: true, parsed }, [parsed.buffer]);
    } catch (_) {
      self.postMessage({ id, ok: false, problem: "invalid-scene" });
    }
  };
`,e2=class{#C=null;#H=null;#V=0;#t=new Map;constructor(){if(!(typeof Worker!="function"||typeof URL?.createObjectURL!="function"))try{this.#H=URL.createObjectURL(new Blob([O7()],{type:"text/javascript"})),this.#C=new Worker(this.#H),this.#C.onmessage=C=>{let H=this.#t.get(C.data.id);H&&(this.#t.delete(C.data.id),C.data.ok&&C.data.parsed?H.resolve(C.data.parsed):H.reject(new p(C.data.problem||"invalid-scene")))},this.#C.onerror=()=>this.#L("scene-worker-failed")}catch{this.#C=null,this.#H&&URL.revokeObjectURL(this.#H),this.#H=null}}async parse(C,H){if(H?.aborted)throw new DOMException("Aborted","AbortError");if(!this.#C){if(await new Promise(L=>window.setTimeout(L,0)),H?.aborted)throw new DOMException("Aborted","AbortError");return b7(C)}let V=++this.#V;return new Promise((L,r)=>{let t=()=>{this.#t.delete(V),r(new DOMException("Aborted","AbortError"))};H?.addEventListener("abort",t,{once:!0}),this.#t.set(V,{resolve:M=>{H?.removeEventListener("abort",t),L(M)},reject:M=>{H?.removeEventListener("abort",t),r(M)}}),this.#C?.postMessage({id:V,buffer:C},[C])})}#L(C){for(let H of this.#t.values())H.reject(new p(C));this.#t.clear(),this.#C?.terminate(),this.#C=null}dispose(){this.#L("scene-parser-disposed"),this.#H&&URL.revokeObjectURL(this.#H),this.#H=null}};var X={catalog:1e4,scene:6e4,delta:35e3,pose:1e4,history:15e3,workflow:15e3,mutation:2e4},I=class extends Error{constructor(C,H=null){super(C),this.name="BackendError",this.code=C,this.status=H}},E1=36,h1=16*1024*1024,i0=(e,C)=>{let H=Number(e);if(!Number.isSafeInteger(H)||H<0)throw new p(C);return H},a0=(e,C)=>{let H=e.headers.get("X-Matic-Revision");if(H===null)return C;let V=Number(H);if(!Number.isSafeInteger(V)||V<0)throw new p("invalid-scene-revision");return V},n0=(e,C)=>{let H=e.headers.get("X-Matic-Floor-Coherent");if(H===null)return C;if(H==="1")return!0;if(H==="0")return!1;throw new p("invalid-scene-floor-header")},r2=class{#C;#H=new e2;constructor(C){this.#C=C}async#V(C,H,V,L){if(!M0(C))throw new I("invalid-private-path");if(L?.aborted)throw new DOMException("Aborted","AbortError");let r=new AbortController,t=()=>r.abort();L?.addEventListener("abort",t,{once:!0});let M=!1,o=window.setTimeout(()=>{M=!0,r.abort()},V);try{let i=this.#C(),a=new Headers(H.headers),n={...H,cache:"no-store",credentials:"same-origin",headers:Object.fromEntries(a.entries()),signal:r.signal};if(typeof i?.fetchWithAuth=="function")return await i.fetchWithAuth(C,n);let A=i?.auth?.accessToken||i?.auth?.data?.access_token;A&&a.set("Authorization",`Bearer ${A}`);let d=typeof i?.hassUrl=="function"?i.hassUrl(C):C;return await fetch(d,{...n,headers:a})}catch(i){throw M&&!L?.aborted?new I("request-timeout"):r.signal.aborted?new DOMException("Aborted","AbortError"):i}finally{window.clearTimeout(o),L?.removeEventListener("abort",t)}}async#t(C,H,V,L={}){let r=await this.#V(C,{...L,headers:{Accept:"application/json",...L.headers||{}}},H,V);if(!r.ok)throw new I("request-failed",r.status);try{return await r.json()}catch{throw new p("invalid-json-response")}}async catalog(C){return j3(await this.#t(X3,X.catalog,C))}async scene(C,H,V,L,r,t){let M=new Headers({Accept:"application/vnd.matic.slam-scene"});L==="live"&&M.set("X-Matic-Prefer-Cached","1"),t&&M.set("If-None-Match",t);let o=await this.#V(C,{headers:M},X.scene,r),i=a0(o,H),a=n0(o,V);if(o.status===304)return{scene:null,floorCoherent:a,revision:i,notModified:!0};if(!o.ok)throw new I("scene-request-failed",o.status);if(o.headers.get("Content-Type")?.split(";",1)[0]!=="application/vnd.matic.slam-scene")throw new p("invalid-scene-content-type");return{scene:{...await this.#H.parse(await o.arrayBuffer(),r),revision:i,etag:o.headers.get("ETag"),source:L},floorCoherent:a,revision:i,notModified:!1}}async#L(C,H,V){if(!Number.isSafeInteger(H)||H<1||H>h1||typeof DecompressionStream!="function")throw new p("invalid-scene-delta");let r=new Blob([C]).stream().pipeThrough(new DecompressionStream("deflate")).getReader(),t=new Uint8Array(H),M=0,o=()=>{r.cancel()};V?.addEventListener("abort",o,{once:!0});try{for(;;){if(V?.aborted)throw new DOMException("Aborted","AbortError");let{done:i,value:a}=await r.read();if(i)break;if(!(a instanceof Uint8Array)||M+a.byteLength>H)throw new p("invalid-scene-delta");t.set(a,M),M+=a.byteLength}}finally{V?.removeEventListener("abort",o),r.releaseLock()}if(M!==H)throw new p("invalid-scene-delta");return t}async#M(C,H,V){if(C.byteLength<E1||C.byteLength>E1+h1||H.buffer.byteLength>h1)throw new p("invalid-scene-delta");let L=new DataView(C),r=new TextDecoder().decode(new Uint8Array(C,0,8)),t=L.getUint16(8,!0),M=L.getUint16(10,!0),o=i0(L.getBigUint64(12,!0),"invalid-scene-delta"),i=i0(L.getBigUint64(20,!0),"invalid-scene-delta"),a=L.getUint32(28,!0),n=L.getUint32(32,!0);if(r!=="MATICDLT"||t!==1||M!==1||o!==H.revision||i<=H.revision||a<24||a>h1||n>h1||n+E1!==C.byteLength)throw new p("invalid-scene-delta");let A=new Uint8Array(C,E1,n),d=new Uint8Array(H.buffer),u=(await this.#L(A,Math.max(d.byteLength,a),V)).slice(),h=1024*1024;for(let S=0;S<d.byteLength;S+=h){if(V?.aborted)throw new DOMException("Aborted","AbortError");let y=Math.min(d.byteLength,S+h);for(let P=S;P<y;P+=1)u[P]=(u[P]??0)^(d[P]??0);y<d.byteLength&&await new Promise(P=>window.setTimeout(P,0))}let x=u.slice(0,a).buffer;return{parsed:{...await this.#H.parse(x,V),revision:i,etag:null,source:"live"},revision:i}}async sceneDelta(C,H,V,L){let r=C.includes("?")?"&":"?",t=await this.#V(`${C}${r}since=${encodeURIComponent(H.revision)}`,{headers:{Accept:"application/vnd.matic.slam-delta, application/vnd.matic.slam-scene"}},X.delta,L),M=a0(t,H.revision),o=n0(t,V);if(t.status===204){if(M!==H.revision)throw new p("invalid-scene-delta-revision");return{scene:null,floorCoherent:o,revision:M,notModified:!0}}if(!t.ok)throw new I("delta-request-failed",t.status);if(M<=H.revision)throw new p("invalid-scene-delta-revision");let i=Number(t.headers.get("Content-Length"));if(Number.isFinite(i)&&i>E1+h1)throw new p("invalid-scene-delta-size");let a=t.headers.get("Content-Type")?.split(";",1)[0],n=await t.arrayBuffer();if(a==="application/vnd.matic.slam-delta"){let d=Number(t.headers.get("X-Matic-Base-Revision"));if(!Number.isSafeInteger(d)||d!==H.revision)throw new p("invalid-scene-delta-base");let m=await this.#M(n,H,L);if(m.revision!==M)throw new p("invalid-scene-delta-revision");return{scene:{...m.parsed,etag:t.headers.get("ETag")},floorCoherent:o,revision:M,notModified:!1}}if(a!=="application/vnd.matic.slam-scene")throw new p("invalid-scene-delta-content-type");return{scene:{...await this.#H.parse(n,L),revision:M,etag:t.headers.get("ETag"),source:"live"},floorCoherent:o,revision:M,notModified:!1}}async pose(C,H){return t0(await this.#t(C,X.pose,H))}async history(C,H){return H0(await this.#t(C,X.history,H))}async plans(C,H){return r0(await this.#t(C,X.workflow,H))}async areas(C,H){return e0(await this.#t(C,X.workflow,H))}async saveArea(C,H,V){let L=await this.#t(C,X.mutation,V,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...H.areaId?{area_id:H.areaId}:{},name:H.name,circles:H.circles,cleaning_mode:H.cleaningMode,coverage_setting:H.coverageSetting})});if(!L||typeof L!="object"||typeof L.id!="string")throw new p("invalid-area-save-response");return L.id}async deleteArea(C,H,V){let L=await this.#V(`${C}?area_id=${encodeURIComponent(H)}`,{method:"DELETE",headers:{Accept:"application/json"}},X.mutation,V);if(!L.ok)throw new I("area-delete-failed",L.status)}async service(C,H,V,L){let r=this.#C();if(typeof r?.callService!="function")throw new I("service-unavailable");await r.callService(C,H,V,{entity_id:L})}dispose(){this.#H.dispose()}};var l0=()=>({version:4,view:"top",appearance:"photo",labels:!0,quality:"auto",cameras:{}}),D1=(e,C,H)=>Math.max(C,Math.min(H,e)),d0=e=>e.replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",H5=(e,C=4)=>`matic-map-studio:v${C}:${d0(e)}`,w7=e=>{if(!e||typeof e!="object")return null;let C=e;return["yaw","pitch","zoom","targetX","targetZ"].every(V=>typeof C[V]=="number"&&Number.isFinite(C[V]))?{yaw:D1(C.yaw,-Math.PI,Math.PI),pitch:D1(C.pitch,.18,Math.PI/2-.018),zoom:D1(C.zoom,.01,100),targetX:D1(C.targetX,-1e4,1e4),targetZ:D1(C.targetZ,-1e4,1e4)}:null},A0=e=>{let C=l0();if(!e||typeof e!="object")return C;let H=e,V=H.view==="three"||H.view==="top"||H.view==="rooms"?H.view:C.view,L=V==="rooms"?"top":V,r=H.quality==="auto"||H.quality==="efficient"||H.quality==="balanced"||H.quality==="maximum"?H.quality:C.quality,t=H.cameras&&typeof H.cameras=="object"?H.cameras:{},M={};for(let o of["three","top"]){let i=w7(t[o]);i&&(M[o]=i)}return{version:4,view:L,appearance:H.appearance==="rooms"||H.appearance==="photo"?H.appearance:C.appearance,labels:typeof H.labels=="boolean"?H.labels:C.labels,quality:r,cameras:M}},t2=class{#C="local-user";#H=null;load(C){this.#C=d0(C);try{let H=window.localStorage.getItem(H5(this.#C));if(H)return A0(JSON.parse(H));for(let V of[3,2]){let L=window.localStorage.getItem(H5(this.#C,V));if(L)return A0(JSON.parse(L))}}catch{}return l0()}schedule(C){this.#H!==null&&window.clearTimeout(this.#H),this.#H=window.setTimeout(()=>{this.#H=null;try{window.localStorage.setItem(H5(this.#C),JSON.stringify(C))}catch{}},250)}dispose(){this.#H!==null&&window.clearTimeout(this.#H),this.#H=null}},s0="matic-map-studio:preferred-frontend",p0=()=>{try{return window.localStorage.getItem(s0)==="v3"?"v3":"v4"}catch{return"v4"}},V5=e=>{try{return window.localStorage.setItem(s0,e),!0}catch{return!1}};var c=(e,C,H=null)=>({status:e,value:C,problem:H}),z=e=>e instanceof DOMException&&e.name==="AbortError",a1=(e,C)=>e instanceof I||e&&typeof e=="object"&&"code"in e&&typeof e.code=="string"?e.code:C,M2=e=>[e.selectedFloorOrdinal??"none",e.mapFloorOrdinal??"none",e.mapFloorCoherent?"coherent":"transition"].join(":"),o2=e=>[e.mapFloorOrdinal??"none",e.mapSessionVerified?"verified":"unverified",e.mapSessionKey??"no-session"].join(":"),U=e=>[e.entryId,e.selectedFloorOrdinal??"none",e.mapFloorOrdinal??"none"].join("|"),m0=e=>[e.entryId,M2(e),o2(e),e.mapRevision].join("|"),v0=e=>e.runnerLocked||e.stopSettlePending||e.activePlan||e.nativeReconciliationPending||e.nativeSessionActive===!0,k7=(e,C)=>e.entryKey===C.entryKey&&e.generation===C.generation&&e.floorKey===C.floorKey&&e.missionKey===C.missionKey,c0="Live map updates paused while the current map is rechecked.",x0="Reconnecting. The last verified map remains read only.",P7=1e3,L5=(e,C)=>e.label?e.label:e.active?"Current floor":`Saved floor ${e.ordinal??C}`,i2=class{#C;#H=new N1;#V;#t=new t2;#L=new Map;#M=null;#i;#a=null;#e=null;#d=null;#p=!1;#Z=!1;#h=!1;#o="";#S=0;#A="";#n=!1;#c=!0;constructor(C,H){this.#C=C,this.#V=H}sync(C,H){if(this.#n)return;let V=this.#c;if(this.#c=C.host.connected,this.#M=C,this.#i=H,this.#C.patch({host:C.host,activity:C.activity,batteryPercent:C.batteryPercent,robotLabel:C.robotLabel,robots:C.robots,locale:C.language}),C.userKey!==this.#A){this.#A=C.userKey;let L=this.#t.load(C.userKey);this.#C.patch({view:L.view,appearance:L.appearance,labelsVisible:L.labels,quality:L.quality,cameras:L.cameras})}if(!C.host.administrator){this.#m(),this.#l("access-required");return}if(!C.host.connected){this.#m();let L=this.#C.value,r=L.resources.scene.value;this.#C.patch({coherence:r?"degraded":"unavailable",resources:{...L.resources,pose:c("idle",null)},map:{...L.map,available:r!==null,exactPose:!1},notice:r?{tone:"warning",text:x0}:L.notice});return}if(C.host.robotCount===0){this.#m(),this.#l("map-unavailable");return}if(this.#x(),!V){this.#C.value.notice?.text===x0&&this.#C.patch({notice:null}),this.refreshCatalog(!0);return}(this.#C.value.resources.catalog.status==="idle"||C.entryKey&&C.entryKey!==this.#C.value.selection.entryId)&&this.refreshCatalog(!0)}schedulePreferences(C){this.#t.schedule(C)}#x(){this.#a===null&&(this.#a=window.setInterval(()=>{document.visibilityState==="visible"&&this.refreshCatalog()},5e3)),this.#e===null&&(this.#e=window.setInterval(()=>{document.visibilityState==="visible"&&this.refreshPose()},P7))}#m(){this.#a!==null&&window.clearInterval(this.#a),this.#e!==null&&window.clearInterval(this.#e),this.#a=null,this.#e=null}#r(C){this.#L.get(C)?.abort();let H=new AbortController;return this.#L.set(C,H),H}#v(C,H){this.#L.get(C)===H&&this.#L.delete(C)}#s(C=[]){for(let[H,V]of this.#L)C.includes(H)||(V.abort(),this.#L.delete(H))}#l(C){this.#s(),this.#H.invalidate(),this.#o="";let H=this.#C.value;this.#C.patch({generation:this.#H.generation,coherence:H.host.administrator?"unavailable":"blocked",fullMap:!1,precisionOpen:!1,resources:{catalog:c("error",null,C),entry:null,scene:c("idle",null),pose:c("idle",null),history:c("idle",null),plans:c("idle",null),areas:c("idle",null)},map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1},selection:{...H.selection,entryId:null,floorId:"current",historyId:null}})}async refreshCatalog(C=!1){if(this.#n||this.#p||!this.#M?.host.administrator)return;this.#p=!0;let H=this.#r("catalog"),V=this.#C.value.resources.catalog.value;this.#C.patch({resources:{...this.#C.value.resources,catalog:c("loading",V)}});try{let L=await this.#V.catalog(H.signal);if(H.signal.aborted||this.#n)return;let r=this.#i?.config?.entry_id,t=typeof r=="string"?r:null,M=L.find(a=>a.entryId===this.#M?.entryKey)||L.find(a=>a.entryId===t)||L[0]||null,o=this.#C.value.resources.entry;if(M&&o&&U(M)===U(o)&&M2(M)===M2(o)&&o2(M)===o2(o)&&M.mapRevision<o.mapRevision&&(M={...M,mapRevision:o.mapRevision}),this.#C.patch({managedLock:M?v0(M):!1,resources:{...this.#C.value.resources,catalog:c(L.length?"ready":"empty",L),entry:M}}),!M){this.#l("no-loaded-robot");return}if(this.#C.value.selection.floorId!=="current"&&!C)return;let i=m0(M);if(!C&&i===this.#o){let a=this.#C.value,n=M.mapFloorCoherent&&M.mapSessionVerified,A=M.health==="problem"||M.health==="limited";this.#C.patch({coherence:n?A?"degraded":"current":"verifying",map:{...a.map,available:n&&a.resources.scene.value!==null,complete:M.mapComplete&&!M.mapTruncated,floorCoherent:M.mapFloorCoherent,sessionVerified:M.mapSessionVerified,exactPose:n?a.map.exactPose:!1},floor:{...a.floor,classifiedCount:Math.max(1,M.historyFloorCount)}});return}this.#o=i,this.#T(M)}catch(L){if(z(L))return;this.#C.patch({coherence:this.#C.value.resources.scene.value?"degraded":"unavailable",resources:{...this.#C.value.resources,catalog:c("error",V,a1(L,"catalog-unavailable"))}})}finally{this.#v("catalog",H),this.#p=!1}}#T(C){let H=this.#C.value,V=H.resources.entry,L=!!(V&&U(V)===U(C)),r=C.mapFloorCoherent&&C.mapSessionVerified;this.#s(L?["catalog","plans","areas","plan-mutation","area-mutation"]:["catalog"]);let t=L?H.resources.scene.value:null,M=H.resources.pose.value,o=L&&r&&C.mapSessionKey!==null&&M?.position&&M.mapSessionKey===C.mapSessionKey?M:null,i=this.#H.begin(C.entryId,M2(C),o2(C),C.mapRevision),a=C.health==="problem"||C.health==="limited",n=this.#C.value;this.#C.patch({managedLock:v0(C),generation:i.generation,coherence:r?a?"degraded":"current":"verifying",dataMode:"live",resources:{...n.resources,entry:C,scene:c(r?"loading":"idle",t),pose:c(r?"loading":"idle",o),history:c("loading",n.resources.history.value),plans:L?n.resources.plans:c("idle",null),areas:L?n.resources.areas:c("idle",null)},map:{available:r&&t!==null,complete:C.mapComplete&&!C.mapTruncated,floorCoherent:C.mapFloorCoherent,sessionVerified:C.mapSessionVerified,exactPose:r&&o!==null},floor:{classifiedCount:Math.max(1,C.historyFloorCount),displayName:C.selectedFloorOrdinal?`Floor ${C.selectedFloorOrdinal}`:"Current floor",readOnly:!1},selection:{...n.selection,entryId:C.entryId,floorId:"current",historyId:null,roomIds:L?n.selection.roomIds:[],planId:L?n.selection.planId:null,areaId:L?n.selection.areaId:null}}),this.#_(C,i),r&&(this.#f(C,i),this.#g(C,i))}async#f(C,H){let V=this.#r("scene");try{let L=await this.#V.scene(C.sceneUrl,C.mapRevision,C.mapFloorCoherent,"live",V.signal);if(!this.#H.accepts(H)||L.revision!==H.revision||!L.floorCoherent||!L.scene)return;let r=this.#C.value;if(this.#C.patch({resources:{...r.resources,scene:c("ready",L.scene)},map:{...r.map,available:!0},notice:r.notice?.text===c0?null:r.notice}),C.deltaUrl){let t=++this.#S;this.#y(C,H,L.scene,t)}}catch(L){if(z(L)||!this.#H.accepts(H))return;if(L instanceof I&&L.code==="request-timeout"){let o=this.#C.value;this.#C.patch({resources:{...o.resources,scene:c("loading",o.resources.scene.value,"scene-building")}}),window.setTimeout(()=>{this.#n||!this.#H.accepts(H)||this.#C.value.selection.floorId!=="current"||this.#f(C,H)},250);return}let r=this.#C.value,t=r.resources.pose.value,M=r.resources.scene.value!==null&&C.mapSessionKey!==null&&t?.position!==null&&t?.mapSessionKey===C.mapSessionKey;this.#C.patch({coherence:"degraded",resources:{...r.resources,scene:c("error",r.resources.scene.value,a1(L,"scene-unavailable"))},map:{...r.map,available:r.resources.scene.value!==null,exactPose:M}})}finally{this.#v("scene",V)}}async#y(C,H,V,L){if(!C.deltaUrl||typeof DecompressionStream!="function")return;let r=C.deltaUrl,t=C,M=H,o=V;try{for(;!this.#n&&L===this.#S&&this.#H.accepts(M)&&this.#C.value.selection.floorId==="current";){let i=this.#r("delta");try{let a=await this.#V.sceneDelta(r,o,t.mapFloorCoherent,i.signal);if(i.signal.aborted||this.#n||L!==this.#S||!this.#H.accepts(M))return;if(!a.floorCoherent){this.#C.patch({coherence:"verifying",map:{...this.#C.value.map,available:!1,floorCoherent:!1,exactPose:!1},resources:{...this.#C.value.resources,pose:c("idle",null)}}),this.#o="",this.refreshCatalog(!0);return}if(a.notModified||!a.scene){await new Promise(d=>window.setTimeout(d,100));continue}let n=this.#H.advance(M,a.revision);if(!n)return;M=n,o=a.scene,t={...t,mapRevision:a.revision},this.#o=m0(t);let A=this.#C.value;this.#C.patch({resources:{...A.resources,entry:t,scene:c("ready",o)},map:{...A.map,available:!0,floorCoherent:!0}}),this.#g(t,M)}finally{this.#v("delta",i)}}}catch(i){if(z(i)||this.#n||L!==this.#S||!this.#H.accepts(M))return;this.#C.patch({coherence:"degraded",notice:{tone:"warning",text:c0}}),this.#o="",this.refreshCatalog(!0)}}async#_(C,H){let V=this.#r("history");try{let L=await this.#V.history(C.historyUrl,V.signal);if(!this.#H.accepts(H)||L.entryId!==C.entryId)return;let r=L.floors.find(t=>t.active)||L.floors[0];if(!r)return;this.#C.patch({resources:{...this.#C.value.resources,history:c("ready",L)},floor:{...this.#C.value.floor,classifiedCount:L.floors.length,displayName:L5(r,1)}})}catch(L){if(z(L)||!this.#H.accepts(H))return;this.#C.patch({resources:{...this.#C.value.resources,history:c("error",null,a1(L,"history-unavailable"))}})}finally{this.#v("history",V)}}async refreshPose(){let C=this.#C.value.resources.entry,H=this.#H.current();!C||!H||this.#C.value.selection.floorId!=="current"||!C.mapFloorCoherent||!C.mapSessionVerified||await this.#g(C,H)}async#g(C,H){if(this.#Z){this.#h=!0;return}this.#Z=!0;let V=this.#r("pose");try{let L=await this.#V.pose(C.poseUrl,V.signal),r=this.#H.current(),t=this.#C.value.resources.entry;if(!r||!k7(H,r)||!t||!L.floorCoherent)return;if(L.mapSessionKey===null||L.mapSessionKey!==t.mapSessionKey){this.#C.patch({map:{...this.#C.value.map,exactPose:!1}}),this.#o="",this.refreshCatalog(!0);return}let M=this.#C.value,o=M.resources.pose.value,i=!!(M.map.exactPose&&o?.position&&o.mapSessionKey===t.mapSessionKey);if(L.position===null&&i){this.#C.patch({resources:{...M.resources,pose:c("ready",o)}});return}this.#C.patch({resources:{...M.resources,pose:c("ready",L)},map:{...M.map,exactPose:L.position!==null}})}catch(L){if(z(L)||!this.#H.accepts(H))return;let r=this.#C.value,t=r.resources.pose.value,M=!!(r.map.exactPose&&t?.position&&t.mapSessionKey===r.resources.entry?.mapSessionKey);this.#C.patch({resources:{...r.resources,pose:c("error",M?t:null,a1(L,"pose-unavailable"))},map:{...r.map,exactPose:M}})}finally{if(this.#v("pose",V),this.#Z=!1,this.#h&&!this.#n){this.#h=!1;let L=this.#C.value.resources.entry,r=this.#H.current();L&&r&&this.#g(L,r)}}}async selectFloor(C){let H=this.#C.value.resources.history.value,V=this.#C.value.resources.entry;if(!H||!V)return;let L=H.floors.find(M=>M.id===C);if(!L)return;if(L.active){this.#o="",this.#C.dispatch({type:"set-floor",floorId:"current"}),await this.refreshCatalog(!0);return}let r=L.snapshots.at(-1);this.#s(["catalog"]);let t=this.#H.begin(V.entryId,L.id,r?.id||L.id,r?.revision||0);this.#C.patch({generation:t.generation,coherence:"current",dataMode:"history",floor:{classifiedCount:H.floors.length,displayName:L5(L,H.floors.indexOf(L)+1),readOnly:!0},selection:{...this.#C.value.selection,floorId:L.id,historyId:r?.id||null},resources:{...this.#C.value.resources,scene:c(r?"loading":"empty",null),pose:c("idle",null)},map:{available:!1,complete:!0,floorCoherent:!0,sessionVerified:!0,exactPose:!1}}),r&&await this.#P(r,t)}async selectHistory(C){let H=this.#C.value.resources.history.value,V=this.#C.value.resources.entry;if(!H||!V)return;if(!C){await this.selectFloor("current");return}let L=H.floors.find(M=>M.snapshots.some(o=>o.id===C)),r=L?.snapshots.find(M=>M.id===C);if(!L||!r)return;let t=this.#H.begin(V.entryId,L.id,r.id,r.revision);this.#s(["catalog"]),this.#C.patch({generation:t.generation,dataMode:"history",floor:{classifiedCount:H.floors.length,displayName:L5(L,H.floors.indexOf(L)+1),readOnly:!0},selection:{...this.#C.value.selection,floorId:L.id,historyId:r.id},resources:{...this.#C.value.resources,scene:c("loading",null),pose:c("idle",null)},map:{...this.#C.value.map,available:!1,exactPose:!1}}),await this.#P(r,t)}async#P(C,H){let V=this.#r("history-scene");try{let L=await this.#V.scene(C.sceneUrl,C.revision,!0,"history",V.signal);if(!this.#H.accepts(H)||!L.scene)return;this.#C.patch({resources:{...this.#C.value.resources,scene:c("ready",L.scene)},map:{...this.#C.value.map,available:!0,exactPose:!1}})}catch(L){if(z(L)||!this.#H.accepts(H))return;this.#C.patch({resources:{...this.#C.value.resources,scene:c("error",null,a1(L,"history-scene-unavailable"))}})}finally{this.#v("history-scene",V)}}async openWorkflow(C){this.#C.dispatch({type:"open-workflow",workflow:C}),(C==="plan"||C==="rooms")&&await this.loadPlans(),(C==="draw"||C==="areaReview")&&await this.loadAreas()}async loadPlans(){let C=this.#C.value.resources.entry;if(!C||!this.#H.current()||!v2(this.#C.value))return;let H=U(C),V=this.#r("plans");this.#C.patch({resources:{...this.#C.value.resources,plans:c("loading",null)}});try{let L=await this.#V.plans(C.plansUrl,V.signal),r=this.#C.value.resources.entry;if(!r||U(r)!==H)return;this.#C.patch({resources:{...this.#C.value.resources,plans:c("ready",L)},selection:{...this.#C.value.selection,planId:L.selectedPlan||L.plans[0]?.id||null}}),this.selectPlan(L.selectedPlan||L.plans[0]?.id||null)}catch(L){let r=this.#C.value.resources.entry;if(z(L)||!r||U(r)!==H)return;this.#C.patch({resources:{...this.#C.value.resources,plans:c("error",null,a1(L,"plans-unavailable"))}})}finally{this.#v("plans",V)}}selectPlan(C){let H=this.#C.value.resources.plans.value?.plans.find(V=>V.id===C);this.#C.patch({selection:{...this.#C.value.selection,planId:C},planDraft:H?this.#O(H):{...this.#C.value.planDraft,id:null,name:"",rooms:[],dirty:!1}})}#O(C){return{id:C.id,name:C.name,enabled:C.enabled,runBehavior:C.runBehavior,rooms:(C.roomOrder.length?C.roomOrder.flatMap(H=>{let V=C.rooms.find(L=>L.roomId===H);return V?[V]:[]}):C.rooms).map(H=>({...H})),returnToBase:C.returnToBase,finishCurrentRoom:C.finishCurrentRoom,finishCurrentRoomThreshold:C.finishCurrentRoomThreshold,dirty:!1}}async loadAreas(){let C=this.#C.value.resources.entry;if(!C||!this.#H.current()||!v2(this.#C.value))return;let H=U(C),V=this.#r("areas");this.#C.patch({resources:{...this.#C.value.resources,areas:c("loading",null)}});try{let L=await this.#V.areas(C.areasUrl,V.signal),r=this.#C.value.resources.entry;if(!r||U(r)!==H||L.sceneUrl!==r.sceneUrl)return;this.#C.patch({resources:{...this.#C.value.resources,areas:c("ready",L)}}),this.selectArea(L.areas[0]?.id||null)}catch(L){let r=this.#C.value.resources.entry;if(z(L)||!r||U(r)!==H)return;this.#C.patch({resources:{...this.#C.value.resources,areas:c("error",null,a1(L,"areas-unavailable"))}})}finally{this.#v("areas",V)}}selectArea(C){let H=this.#C.value.resources.areas.value?.areas.find(L=>L.id===C),V=this.#C.value;this.#C.patch({selection:{...V.selection,areaId:C},areaDraft:H?this.#k(H):{id:null,name:"",cleaningMode:"vacuum",coverageSetting:"standard",status:"new",canRebind:!1,dirty:!1},draw:{...V.draw,circles:H?.circles||[],undo:[],redo:[],dirty:!1,strokeCount:0}})}#k(C){return{id:C.id,name:C.name,cleaningMode:C.cleaningMode,coverageSetting:C.coverageSetting,status:C.status,canRebind:C.canRebind,dirty:!1}}async saveArea(){let C=this.#C.value,H=C.resources.entry,V=C.areaDraft;if(!H||!Q(C)||!V.name.trim()||!C.draw.circles.length)return;let L=this.#r("area-mutation");this.#C.patch({command:"pending",notice:{tone:"info",text:"Saving area\u2026"}});try{let r=await this.#V.saveArea(H.areasUrl,{areaId:V.id,name:V.name.trim(),circles:C.draw.circles,cleaningMode:V.cleaningMode,coverageSetting:V.coverageSetting},L.signal);this.#C.patch({command:"idle",notice:{tone:"success",text:"Area saved"}}),await this.loadAreas(),this.selectArea(r)}catch(r){if(z(r))return;this.#C.patch({command:"failed",notice:{tone:"error",text:"Area could not be saved"}})}finally{this.#v("area-mutation",L)}}async deleteArea(){let C=this.#C.value.resources.entry,H=this.#C.value.selection.areaId;if(!C||!H||!Q(this.#C.value))return;let V=this.#r("area-mutation");try{await this.#V.deleteArea(C.areasUrl,H,V.signal),this.#C.patch({notice:{tone:"success",text:"Area deleted"}}),await this.loadAreas()}catch(L){z(L)||this.#C.patch({notice:{tone:"error",text:"Area could not be deleted"}})}finally{this.#v("area-mutation",V)}}async savePlan(){let C=this.#C.value,H=C.planDraft,V=C.resources.plans.value;if(!V||!H.name.trim()||!H.rooms.length||!Q(C))return;let L=H.rooms;await this.#b("save_plan",{...H.id?{plan_id:H.id}:{},name:H.name.trim(),enabled:H.enabled,run_behavior:H.runBehavior,rooms:L.map(r=>({room:V.rooms.find(t=>t.roomId===r.roomId)?.name,cleaning_mode:r.cleaningMode,coverage_setting:r.coverageSetting})).filter(r=>r.room),return_to_base:H.returnToBase,finish_current_room:H.finishCurrentRoom,finish_current_room_threshold:H.finishCurrentRoomThreshold,select:!H.id||V.selectedPlan===H.id},"Plan saved","Plan could not be saved"),await this.loadPlans()}async deletePlan(){let C=this.#C.value.selection.planId;C&&(await this.#b("delete_plan",{plan:C},"Plan deleted","Plan could not be deleted"),await this.loadPlans())}async executeAction(C){switch(C){case"stop":this.#C.value.resources.entry?.activePlan||this.#C.value.resources.entry?.runnerLocked?await this.#u("matic_robot","stop_intelligent_cleaning",{}):await this.#u("vacuum","return_to_base",{});return;case"resume":await this.#u("vacuum","start",{});return;case"run-plan":{let H=this.#C.value.selection.planId||this.#C.value.resources.plans.value?.selectedPlan;H&&await this.#u("matic_robot","run_selected_plan",{plan:H});return}case"clean-rooms":{let H=this.#C.value.resources.plans.value,L=this.#C.value.selection.roomSettings.map(r=>({room:H?.rooms.find(t=>t.roomId===r.roomId)?.name,cleaning_mode:r.cleaningMode,coverage_setting:r.coverageSetting})).filter(r=>r.room);L.length&&await this.#u("matic_robot","clean_room_sequence",{rooms:L,return_to_base:!0});return}case"run-area":{let H=this.#C.value.selection.areaId;H&&await this.#u("matic_robot","clean_area",{area:H});return}case"review-area":this.#C.dispatch({type:"open-workflow",workflow:"areaReview"});return;case"save-area":await this.saveArea();return;case"save-plan":await this.savePlan();return;case"delete-plan":await this.deletePlan();return;case"delete-area":await this.deleteArea();return}}async#b(C,H,V,L){let r=this.#M?.vacuumEntityId;if(!(!r||!Q(this.#C.value)||this.#C.value.command==="pending")){this.#C.patch({command:"pending",notice:{tone:"info",text:"Saving\u2026"}});try{await this.#V.service("matic_robot",C,H,r),this.#C.patch({command:"idle",notice:{tone:"success",text:V}})}catch{this.#C.patch({command:"failed",notice:{tone:"error",text:L}})}}}async#u(C,H,V){let L=this.#C.value,r=this.#M?.vacuumEntityId,M=(H==="stop_intelligent_cleaning"||C==="vacuum"&&H==="return_to_base")&&L.command==="idle"&&(L.activity==="cleaning"||L.activity==="paused"||L.activity==="returning"||L.activity==="recharging");if(!(!r||!M&&!l1(L))){this.#C.patch({command:"pending",notice:null});try{await this.#V.service(C,H,V,r),this.#C.patch({command:"settling"}),this.#d!==null&&window.clearTimeout(this.#d),this.#d=window.setTimeout(()=>{this.#d=null,this.#C.value.command==="settling"&&this.#C.patch({command:"idle"})},15e3)}catch{this.#C.patch({command:"failed",notice:{tone:"error",text:"The robot did not accept that action"}})}}}updateDraftCircles(C,H=!0,V){this.#C.dispatch({type:"set-draft-circles",circles:C,record:H,...V?{previous:V}:{}}),this.#C.dispatch({type:"patch-area-draft",patch:{dirty:!0}})}dispose(){this.#n||(this.#n=!0,this.#m(),this.#s(),this.#d!==null&&window.clearTimeout(this.#d),this.#d=null,this.#t.dispose(),this.#V.dispose(),this.#H.invalidate())}};var u0=e=>(e.workflow==="none"?0:1)+(e.fullMap?1:0)+(e.precisionOpen?1:0)+(e.dialog?1:0),T7=e=>{if(!e||typeof e!="object")return null;let C=e.maticMapLayer;if(!C||typeof C!="object")return null;let H=C.owner,V=C.depth;return typeof H=="string"&&Number.isInteger(V)&&Number(V)>=0?{owner:H,depth:Number(V)}:null},a2=class{#C;#H=`matic-map-${crypto.randomUUID?.()||Math.random().toString(36).slice(2)}`;#V=0;#t=null;#L=!1;constructor(C){this.#C=C}start(){this.#t||(this.#V=u0(this.#C.value),this.#t=this.#C.subscribe(C=>this.#M(C)),window.addEventListener("popstate",this.#i))}#M(C){let H=u0(C);if(this.#L){this.#L=!1,this.#V=H;return}if(H>this.#V)for(let V=this.#V+1;V<=H;V+=1){let L=history.state&&typeof history.state=="object"?history.state:{};history.pushState({...L,maticMapLayer:{owner:this.#H,depth:V}},"",window.location.href)}this.#V=H}#i=()=>{this.#V<1||(this.#L=!0,this.#C.dispatch({type:"dismiss-top-layer"}))};dismissTop(){if(this.#V<1)return!1;let C=T7(history.state);return C?.owner===this.#H&&C.depth===this.#V?history.back():this.#C.dispatch({type:"dismiss-top-layer"}),!0}dispose(){this.#t?.(),this.#t=null,window.removeEventListener("popstate",this.#i),this.#V=0}};var Z0=j(M1),e5=class extends O{constructor(){super(...arguments);this.narrow=!1;this._workspace=k();this._classic=!1;this.entryOverride=null;this.#C=new U1;this.#H=new d1(this._workspace);this.#V=null;this.#t=null;this.#L=null;this.#M=null;this.#i=null;this.#a=""}static{this.styles=[E,D,b`
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
`]}static{this.properties={hass:{attribute:!1},narrow:{type:Boolean},route:{attribute:!1},panel:{attribute:!1},_workspace:{state:!0},_classic:{state:!0},entryOverride:{state:!0}}}#C;#H;#V;#t;#L;#M;#i;#a;connectedCallback(){super.connectedCallback(),this._classic=p0()==="v3",this.#t=this.#H.subscribe(H=>{this._workspace=H,this.#p(H)}),this._classic||this.#e()}disconnectedCallback(){this.#t?.(),this.#t=null,this.#d(),super.disconnectedCallback()}#e(){this.#M||(this.#L=new r2(()=>this.hass),this.#M=new i2(this.#H,this.#L),this.#i=new a2(this.#H),this.#i.start(),this.#V&&this.#M.sync(this.#V,this.panel))}#d(){this.#i?.dispose(),this.#i=null,this.#M?.dispose(),this.#M=null,this.#L=null}#p(H){if(!this.#M)return;let V={version:4,view:H.view,appearance:H.appearance,labels:H.labelsVisible,quality:H.quality,cameras:H.cameras},L=JSON.stringify(V);L!==this.#a&&(this.#a=L,this.#M.schedulePreferences(V))}willUpdate(H){if(H.has("hass")||H.has("panel")||H.has("entryOverride")){let V=this.#C.project(this.hass,this.panel,this.entryOverride);if(V!==this.#V){this.#V=V;let L=V.host.connected?V.host.robotCount===0?"unavailable":V.host.administrator?"verifying":"blocked":"degraded";this.#H.replace({...this.#H.value,coherence:L,activity:V.activity,batteryPercent:V.batteryPercent,host:V.host,fullMap:V.host.administrator&&V.host.robotCount>0&&this.#H.value.fullMap,robotLabel:V.robotLabel,robots:V.robots,locale:V.language})}this._classic||this.#M?.sync(V,this.panel)}H.has("narrow")&&this.#H.value.narrowHint!==this.narrow&&this.#H.dispatch({type:"set-narrow-hint",value:this.narrow})}#Z(H){if(!W1(H.detail))return;H.stopPropagation();let V=H.detail;if(V.type==="dismiss-top-layer"||V.type==="exit-full-map"){this.#i?.dismissTop()||this.#H.dispatch(V);return}if(V.type==="open-workflow"&&V.workflow!=="none"){this.#M?.openWorkflow(V.workflow);return}if(V.type==="set-floor"){this.#M?.selectFloor(V.floorId);return}if(V.type==="select-entry"){if(!this._workspace.robots.some(L=>L.entryId===V.entryId))return;this.entryOverride=V.entryId;return}if(V.type==="set-history"){this.#M?.selectHistory(V.historyId);return}if(V.type==="select-plan"){this.#M?.selectPlan(V.planId);return}if(V.type==="select-area"){this.#M?.selectArea(V.areaId);return}this.#H.dispatch(V)}#h(H){if(H.stopPropagation(),typeof H.detail?.id=="string"){if(H.detail.id==="use-classic"){V5("v3")&&(this.#d(),this._classic=!0);return}this.#M?.executeAction(H.detail.id),this.dispatchEvent(new CustomEvent("matic-map-v4-action-requested",{detail:{id:H.detail.id},bubbles:!0,composed:!0}))}}#o(){V5("v4")&&(this._classic=!1,this.#e(),this.requestUpdate())}updated(){if(!this._classic)return;let H=this.renderRoot.querySelector("matic-map-panel-v0-3-1");H&&(H.hass=this.hass,H.narrow=this.narrow,H.route=this.route,H.panel=this.panel)}getWorkspaceSnapshot(){return this.#H.value}render(){return this._classic?v`
        <div class="classic">
          <button class="return-v4" type="button" @click=${this.#o}>${B(this.hass?.localize,"v4_use_new","Use Map Studio 0.4")}</button>
          <matic-map-panel-v0-3-1></matic-map-panel-v0-3-1>
        </div>
      `:v`
      <${Z0}
        .state=${this._workspace}
        .localize=${this.hass?.localize}
        @matic-workspace-intent=${this.#Z}
        @matic-workspace-action=${this.#h}
      ></${Z0}>
    `}};customElements.get(F2)||customElements.define(F2,e5);export{N1 as CoherenceMachine,f1 as DRAW_BRUSH_MAX_METERS,n1 as DRAW_BRUSH_MIN_METERS,Z2 as GALLERY_SCENARIOS,U1 as HassAdapter,m2 as MAP_PIXELS_PER_METER_AT_100,o5 as MAP_ZOOM_MAX,S1 as MAP_ZOOM_MIN,F2 as MATIC_MAP_PANEL_TAG,e5 as MaticMapPanelV4,j2 as MaticMapStudioGalleryV4,d1 as WorkspaceStore,R7 as brushCursorPixels,Q as canEditCoordinates,v2 as canReadFloorResources,a5 as canShowExactPose,s1 as canShowLiveMap,l1 as canStartMotion,F7 as commandState,u2 as createGalleryState,k as initialWorkspaceState,W1 as isWorkspaceIntent,d5 as mapScale,g0 as normalizeBrush,i5 as normalizeZoom,y0 as reduceWorkspace,l5 as selectPausedSecondaryAction,A5 as selectPrimaryAction};
/*! Icon geometry from Material Design Icons. SPDX-License-Identifier: Apache-2.0 */
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

lit-html/static.js:
  (**
   * @license
   * Copyright 2020 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/
