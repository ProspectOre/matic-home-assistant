var y1=100,i5=1e3,s1=.2,b1=2.5,m2=64,d1=L=>!L||typeof L!="object"?!1:typeof L.type=="string";var e1=(L,C)=>{let H=L.workflow==="plan"&&L.planDraft.dirty,V=(L.workflow==="draw"||L.workflow==="areaReview")&&(L.draw.dirty||L.areaDraft.dirty);if(!H&&!V)return!1;switch(C.type){case"open-workflow":return H?C.workflow!=="plan":C.workflow!=="draw"&&C.workflow!=="areaReview";case"select-plan":return H;case"select-area":return V;case"set-floor":return C.floorId!==L.selection.floorId;case"select-entry":return C.entryId!==L.selection.entryId;case"set-history":return!0;case"dismiss-top-layer":return!L.dialog&&!L.precisionOpen&&!L.fullMap;default:return!1}};var p1=()=>({status:"idle",value:null,problem:null}),n5=new Set(["rooms","plan","draw","areaReview"]),I0=L=>L.dataMode==="history"||L.floor.readOnly,Q=(L,C,H)=>Math.max(C,Math.min(H,L)),W0=L=>({yaw:Q(Number.isFinite(L.yaw)?L.yaw:0,-Math.PI,Math.PI),pitch:Q(Number.isFinite(L.pitch)?L.pitch:Math.PI/2-.018,.18,Math.PI/2-.018),zoom:Q(Number.isFinite(L.zoom)?L.zoom:1,.01,100),targetX:Q(Number.isFinite(L.targetX)?L.targetX:0,-1e4,1e4),targetZ:Q(Number.isFinite(L.targetZ)?L.targetZ:0,-1e4,1e4)}),a5=L=>Math.round(Q(Number.isFinite(L)?L:100,100,1e3)),N0=L=>Math.round(Q(Number.isFinite(L)?L:.2,.2,2.5)*100)/100,k=()=>({generation:0,coherence:"verifying",dataMode:"live",activity:"unknown",workflow:"none",command:"idle",fullMap:!1,precisionOpen:!1,dialog:null,narrowHint:!1,view:"top",appearance:"photo",labelsVisible:!0,quality:"auto",cameras:{},managedLock:!1,batteryPercent:null,floor:{classifiedCount:1,displayName:"Current floor",readOnly:!1},map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1},host:{connected:!0,administrator:!0,robotConnected:!1,robotCount:0},draw:{zoomPercent:100,zoomOriginX:50,zoomOriginY:50,brushMeters:.6,tool:"paint",dirty:!1,strokeCount:0,circles:[],undo:[],redo:[]},resources:{catalog:p1(),entry:null,scene:p1(),pose:p1(),history:p1(),plans:p1(),areas:p1()},selection:{entryId:null,floorId:"current",historyId:null,roomIds:[],roomSettings:[],cleaningMode:"vacuum",coverageSetting:"standard",planId:null,areaId:null},planDraft:{id:null,name:"",enabled:!0,runBehavior:"intelligent",rooms:[],returnToBase:!0,finishCurrentRoom:!1,finishCurrentRoomThreshold:50,dirty:!1},areaDraft:{id:null,name:"",cleaningMode:"vacuum",coverageSetting:"standard",status:"new",canRebind:!1,dirty:!1},notice:null,robotLabel:"Matic robot",robots:[],locale:"en"}),W=(L,C)=>({...L,draw:{...L.draw,...C}}),z0=(L,C)=>{switch(C.type){case"set-host":return{...L,host:C.host,fullMap:C.host.administrator&&C.host.robotCount>0?L.fullMap:!1};case"set-operational-state":return{...L,coherence:C.coherence,activity:C.activity,command:C.command??L.command};case"set-narrow-hint":return{...L,narrowHint:C.value};case"set-view":return{...L,view:C.view};case"set-appearance":return{...L,appearance:C.appearance};case"set-quality":return{...L,quality:C.quality};case"set-camera":return{...L,cameras:{...L.cameras,[C.view]:W0(C.camera)}};case"toggle-labels":return{...L,labelsVisible:!L.labelsVisible};case"open-workflow":return I0(L)&&n5.has(C.workflow)?L:{...L,workflow:C.workflow,precisionOpen:!1};case"enter-full-map":return L.host.administrator&&L.host.robotCount>0&&L.map.available?{...L,fullMap:!0}:L;case"exit-full-map":return{...L,fullMap:!1,precisionOpen:!1};case"set-precision-open":return{...L,precisionOpen:C.value};case"set-zoom":return W(L,{zoomPercent:a5(C.value),...C.originX===void 0?{}:{zoomOriginX:Q(C.originX,0,100)},...C.originY===void 0?{}:{zoomOriginY:Q(C.originY,0,100)}});case"step-zoom":return W(L,{zoomPercent:a5(L.draw.zoomPercent*C.factor)});case"fit-map":return W(L,{zoomPercent:100,zoomOriginX:50,zoomOriginY:50});case"set-brush":return W(L,{brushMeters:N0(C.value)});case"set-draw-tool":return W(L,{tool:C.tool});case"mark-draft":{let H=Math.max(0,L.draw.strokeCount+C.strokeDelta);return W(L,{dirty:H>0,strokeCount:H})}case"undo-draft":{let H=L.draw.undo.at(-1);return H?W(L,{circles:H,undo:L.draw.undo.slice(0,-1),redo:[...L.draw.redo,L.draw.circles],dirty:!0,strokeCount:Math.max(0,L.draw.strokeCount-1)}):L}case"clear-draft":return L.draw.circles.length?W(L,{circles:[],undo:[...L.draw.undo.slice(-99),L.draw.circles],redo:[],dirty:!0,strokeCount:L.draw.strokeCount+1}):L;case"redo-draft":{let H=L.draw.redo.at(-1);return H?W(L,{circles:H,undo:[...L.draw.undo,L.draw.circles],redo:L.draw.redo.slice(0,-1),dirty:!0,strokeCount:L.draw.strokeCount+1}):L}case"set-draft-circles":{let H=C.circles.slice(0,512).map(e=>({...e})),V=C.record!==!1;return W(L,{circles:H,undo:V?[...L.draw.undo.slice(-99),C.previous??L.draw.circles]:L.draw.undo,redo:V?[]:L.draw.redo,dirty:!0,strokeCount:V?L.draw.strokeCount+1:L.draw.strokeCount})}case"discard-draft":return L.workflow==="plan"?{...L,planDraft:k().planDraft,selection:{...L.selection,planId:null},dialog:null,workflow:"none",precisionOpen:!1}:{...W(L,{dirty:!1,strokeCount:0,circles:[],undo:[],redo:[]}),areaDraft:k().areaDraft,selection:{...L.selection,areaId:null},dialog:null,workflow:"none",precisionOpen:!1};case"toggle-room":{let H=L.selection.roomIds.includes(C.roomId);return{...L,selection:{...L.selection,roomIds:H?L.selection.roomIds.filter(V=>V!==C.roomId):[...L.selection.roomIds,C.roomId],roomSettings:H?L.selection.roomSettings.filter(V=>V.roomId!==C.roomId):[...L.selection.roomSettings,{roomId:C.roomId,cleaningMode:"vacuum",coverageSetting:"standard"}]}}}case"patch-room-settings":return{...L,selection:{...L.selection,roomSettings:L.selection.roomSettings.map(H=>H.roomId===C.roomId?{...H,...C.cleaningMode?{cleaningMode:C.cleaningMode}:{},...C.coverageSetting?{coverageSetting:C.coverageSetting}:{}}:H)}};case"set-floor":return{...L,dataMode:C.floorId==="current"?"live":"history",selection:{...L.selection,floorId:C.floorId,historyId:null}};case"select-entry":return L;case"set-history":return{...L,dataMode:C.historyId?"history":"live",selection:{...L.selection,historyId:C.historyId}};case"select-plan":return{...L,selection:{...L.selection,planId:C.planId}};case"select-area":return{...L,selection:{...L.selection,areaId:C.areaId}};case"patch-plan-draft":return{...L,planDraft:{...L.planDraft,...C.patch,dirty:C.patch.dirty??!0}};case"patch-area-draft":return{...L,areaDraft:{...L.areaDraft,...C.patch,dirty:C.patch.dirty??!0}};case"set-notice":return{...L,notice:C.notice};case"open-dialog":return{...L,dialog:C.dialog};case"dismiss-top-layer":return e1(L,C)?{...L,dialog:"discardDraft"}:L.dialog?{...L,dialog:null}:L.precisionOpen?{...L,precisionOpen:!1}:L.fullMap?{...L,fullMap:!1}:L.workflow!=="none"?{...L,workflow:"none",precisionOpen:!1}:L;case"return-live":return{...L,dataMode:"live",workflow:"none",floor:{...L.floor,readOnly:!1}}}},v1=class{#C=new Set;#H;constructor(C=k()){this.#H=C}get value(){return this.#H}dispatch(C){let H=z0(this.#H,C);if(H===this.#H)return H;this.#H=H;for(let V of this.#C)V(H);return H}replace(C){if(C!==this.#H){this.#H=C;for(let H of this.#C)H(C)}}patch(C){let H={...this.#H,...C};return this.replace(H),H}subscribe(C){return this.#C.add(C),C(this.#H),()=>this.#C.delete(C)}},N1=class{#C=null;#H=0;get generation(){return this.#H}begin(C,H,V,e){return this.#H+=1,this.#C={entryKey:C,generation:this.#H,floorKey:H,missionKey:V,revision:e},this.#C}current(){return this.#C}accepts(C){let H=this.#C;return!!(H&&C.entryKey===H.entryKey&&C.generation===H.generation&&C.floorKey===H.floorKey&&C.missionKey===H.missionKey&&C.revision===H.revision)}advance(C,H){return!this.accepts(C)||!Number.isSafeInteger(H)||H<=C.revision?null:(this.#C={...C,revision:H},this.#C)}invalidate(){return this.#H+=1,this.#C=null,this.#H}},c1=L=>L.dataMode==="live"&&L.map.available&&(L.coherence==="current"||L.coherence==="degraded")&&L.host.administrator,A5=L=>c1(L)&&(L.coherence==="current"||L.coherence==="degraded")&&L.map.floorCoherent&&L.map.sessionVerified&&L.map.exactPose&&L.host.connected&&L.host.robotConnected,q=L=>c1(L)&&L.coherence==="current"&&L.map.complete&&L.map.floorCoherent&&L.map.sessionVerified&&L.host.connected&&L.host.robotConnected&&!L.floor.readOnly,v2=L=>c1(L)&&L.coherence==="current"&&L.map.floorCoherent&&L.map.sessionVerified&&L.host.connected&&L.host.robotConnected&&!L.floor.readOnly,m1=L=>q(L)&&!L.managedLock&&L.command==="idle"&&(L.activity==="idle"||L.activity==="docked"),N=(L,C,H,V,e)=>({id:L,label:C,labelKey:V,kind:"neutral",enabled:!1,reason:H,reasonKey:e}),c2=L=>L.host.connected&&L.host.administrator&&L.host.robotConnected&&(L.command==="idle"||L.command==="failed"||L.command==="starting")&&(L.activity==="cleaning"||L.activity==="paused"||L.activity==="returning"||L.activity==="recharging"),l5=L=>{let C=c2(L);return{id:"stop",label:"Stop",labelKey:"v4_action_stop",kind:"danger",enabled:C,...C?{}:{reason:"The robot is already stopping.",reasonKey:"v4_reason_stop"}}},s5=L=>{if(L.dataMode==="history")return{id:"return-live",label:"Return to the live map",labelKey:"v4_action_return_live",kind:"primary",enabled:!0};if(L.floor.readOnly&&n5.has(L.workflow))return N("read-only","Live map required","Return to the live map to edit cleaning tasks.","v4_action_live_map_required","v4_reason_live_map_required");if(L.activity==="cleaning"||L.activity==="returning"||L.activity==="recharging")return l5(L);let C=L.workflow==="plan"&&L.planDraft.dirty||(L.workflow==="draw"||L.workflow==="areaReview")&&(L.draw.dirty||L.areaDraft.dirty);if(L.command==="failed"&&!C)return{id:"recheck-status",label:"Check robot status",labelKey:"v4_recheck_robot",kind:"primary",enabled:L.host.connected&&L.host.administrator&&L.host.robotConnected,reason:"Refresh the robot state before trying the action again.",reasonKey:"v4_recheck_robot_reason"};if(L.activity==="stopping"||L.command==="settling")return N("stopping","Stopping","Waiting for the robot to settle.","v4_action_stopping","v4_reason_stopping");if(L.command==="starting")return N("starting","Starting","Waiting for the robot to begin.","v4_action_starting","v4_reason_starting");if(L.activity==="paused")return{id:"resume",label:"Resume cleaning",labelKey:"v4_action_resume",kind:"primary",enabled:L.command==="idle"};if(!L.host.connected)return N("reconnecting","Reconnecting","Home Assistant is offline.","v4_action_reconnecting","v4_reason_reconnecting");if(!L.host.administrator)return N("administrator","Administrator access required","Ask a Home Assistant administrator to open this map.","v4_action_administrator","v4_reason_administrator");if(L.host.robotCount===0)return N("setup","Set up a Matic robot","Add the Matic integration to get started.","v4_set_up_robot","v4_setup_reason");if(L.activity==="problem")return N("problem","Check the robot","Resolve the robot's problem before starting another task.","v4_check_robot","v4_problem_reason");if(!L.host.robotConnected)return N("robot-offline","Robot offline","Reconnect the robot to start cleaning.","v4_action_robot_offline","v4_reason_robot_offline");if(L.coherence==="unavailable"||L.coherence==="blocked")return N("map-unavailable","Map unavailable","Open Map diagnostics to check why the map is unavailable.","v4_map_unavailable","v4_map_unavailable_reason");if(L.coherence!=="current")return N("locating","Finding the map","Waiting for the robot to confirm which floor it is on.","v4_action_locating","v4_reason_locating");if((L.workflow==="plan"||L.workflow==="rooms")&&L.resources.plans.status!=="ready"){let H=L.resources.plans.status==="error"||L.resources.plans.status==="empty";return N("plans-unavailable",H?"Rooms and plans unavailable":"Loading rooms and plans\u2026","Load the room and plan list before choosing a cleaning action.",H?"v4_plans_unavailable_action":"v4_loading_rooms_plans","v4_plans_required_reason")}if(L.workflow==="draw"){let H={reason:"Draw the area first.",reasonKey:"v4_reason_save_area_draw"};return L.fullMap||L.narrowHint?{id:"review-area",label:"Name and save",labelKey:"v4_action_review_area",kind:"primary",enabled:L.draw.dirty,...L.draw.dirty?{}:H}:{id:"save-area",label:"Save area",labelKey:"v4_action_save_area",kind:"primary",enabled:L.draw.dirty&&q(L),...L.draw.dirty?{}:H}}if(L.workflow==="rooms"){let H=L.selection.roomIds.length,V=m1(L)&&H>0;return{id:"clean-rooms",label:H?`Clean ${H} room${H===1?"":"s"}`:"Clean selected rooms",...H?{}:{labelKey:"v4_action_clean_rooms"},kind:"primary",enabled:V,...V?{}:H?{reason:"Waiting for the current map to be verified.",reasonKey:"v4_reason_clean_rooms_verification"}:{reason:"Select at least one room to clean.",reasonKey:"v4_reason_clean_rooms_empty"}}}if(L.workflow==="plan"){if(L.planDraft.dirty||!L.planDraft.id){let H=q(L)&&L.planDraft.name.trim().length>0&&L.planDraft.rooms.length>0;return{id:"save-plan",label:"Save plan",labelKey:"v4_action_save_plan",kind:"primary",enabled:H,...H?{}:{reason:"Add a plan name and at least one room.",reasonKey:"v4_reason_save_plan"}}}return{id:"run-plan",label:"Run this plan",labelKey:"v4_action_run_plan",kind:"primary",enabled:m1(L)&&L.planDraft.enabled,...m1(L)?L.planDraft.enabled?{}:{reason:"This plan is paused. Enable it to run.",reasonKey:"v4_reason_run_plan_paused"}:{reason:"Waiting for the current map to be verified.",reasonKey:"v4_reason_run_plan"}}}if(L.workflow==="areaReview"){if(L.areaDraft.dirty||L.draw.dirty||!L.areaDraft.id||L.areaDraft.canRebind){let V=q(L)&&L.areaDraft.name.trim().length>0&&L.draw.circles.length>0;return{id:"save-area",label:L.areaDraft.canRebind?"Confirm on this map":"Save area",labelKey:L.areaDraft.canRebind?"v4_action_save_area_confirm":"v4_action_save_area",kind:"primary",enabled:V,...V?{}:{reason:"Add an area name and at least one mark.",reasonKey:"v4_reason_save_area_details"}}}let H=L.areaDraft.status==="current";return{id:"run-area",label:"Clean this area",labelKey:"v4_action_run_area",kind:"primary",enabled:H&&m1(L),...H?{}:{reason:"Confirm this outline on the current map first.",reasonKey:"v4_reason_run_area"}}}return{id:"choose-cleaning",label:"Choose what to clean",labelKey:"v4_action_choose_cleaning",kind:"neutral",enabled:!1,reason:"Choose rooms, a plan, or a custom area.",reasonKey:"v4_reason_choose_cleaning"}},d5=L=>L.activity==="paused"?l5(L):null,C4=L=>L.draw.brushMeters*64*(L.draw.zoomPercent/100),U0=[2,1,.5,.25,.1,.05],p5=L=>{let C=64*(L.draw.zoomPercent/100),H=U0.reduce((V,e)=>{let r=Math.abs(e*C-64),t=Math.abs(V*C-64);return r<t?e:V});return{meters:H,pixels:H*C,label:H<1?`${Math.round(H*100)} cm`:`${H} m`}},H4=(L,C)=>({...L,command:C});var m5="a".repeat(64),u1=[{roomId:"room-a",name:"Kitchen",boundary:[[.5,.5],[4,.5],[4,3],[.5,3]]},{roomId:"room-b",name:"Living room",boundary:[[4.2,.5],[8.5,.5],[8.5,3.4],[4.2,3.4]]},{roomId:"room-c",name:"Office",boundary:[[.5,3.2],[3.8,3.2],[3.8,6.5],[.5,6.5]]},{roomId:"room-d",name:"Bedroom",boundary:[[4,3.6],[8.5,3.6],[8.5,6.5],[4,6.5]]}],v5=()=>{let L=[180,140],C={meters_per_cell:.05,origin_cells:[0,0],span_cells:L,sample_step:1,rooms:u1.map(i=>{let a=i.boundary.map(([A,s])=>[A/.05,s/.05]),n=[a.reduce((A,[s])=>A+s,0)/a.length,a.reduce((A,[,s])=>A+s,0)/a.length];return{name:i.name,boundary:a,boundary_closed:!0,center:n}})},H=new TextEncoder().encode(JSON.stringify(C)),V=[];for(let i=10;i<130;i+=2)for(let a=10;a<170;a+=2){let n=a<80?i<65?0:2:i<72?1:3,A=[[185,219,224],[201,211,233],[210,226,194],[232,207,207]][n]||[190,205,215];V.push([a,i,0,...A])}let e=500;for(let i=0;i<e;i+=1){let a=i%4,n=i*7%120,A=a<2?a===0?10:168:10+n,s=a>=2?a===2?10:128:10+n;V.push([A,s,10+i%18,104,122,137])}let r=V.length-e,t=new ArrayBuffer(24+H.byteLength+V.length*8),o=new DataView(t);new Uint8Array(t,0,8).set(new TextEncoder().encode("MATIC3D\0")),o.setUint16(8,1,!0),o.setUint16(10,8,!0),o.setUint32(12,H.byteLength,!0),o.setUint32(16,r,!0),o.setUint32(20,e,!0),new Uint8Array(t,24,H.byteLength).set(H);let M=new DataView(t,24+H.byteLength);return V.forEach(([i=0,a=0,n=0,A=0,s=0,p=0],u)=>{let h=u*8;M.setUint16(h,i,!0),M.setUint16(h+2,a,!0),M.setUint8(h+4,n),M.setUint8(h+5,A),M.setUint8(h+6,s),M.setUint8(h+7,p)}),{buffer:t,pointOffset:24+H.byteLength,floorCount:r,surfaceCount:e,total:V.length,revision:7,etag:'"synthetic-scene"',source:"live",metadata:{metersPerCell:.05,origin:[0,0],span:L,sampleStep:1,rooms:C.rooms.map((i,a)=>({id:u1[a]?.roomId||`room-${a}`,name:i.name,boundary:i.boundary,center:i.center}))}}},z1=()=>({entryId:"synthetic-entry",sceneUrl:"/api/matic_robot/slam_scene/synthetic",deltaUrl:"/api/matic_robot/slam_delta/synthetic",poseUrl:"/api/matic_robot/slam_pose/synthetic",historyUrl:"/api/matic_robot/slam_history/synthetic",areasUrl:"/api/matic_robot/areas/synthetic",plansUrl:"/api/matic_robot/plans/synthetic",mapRevision:7,mapFloorCoherent:!0,mapSessionVerified:!0,mapSessionKey:m5,mapBlockReason:null,runnerLocked:!1,stopSettlePending:!1,activePlan:!1,nativeReconciliationPending:!1,nativeSessionActive:!1,mapComplete:!0,mapTruncated:!1,selectedFloorOrdinal:1,mapFloorOrdinal:1,historyCount:2,historyFloorCount:2,health:"ready",streamFailures:0,bootstrapState:"complete",bootstrapPhotoSeen:!0,bootstrapStructureSeen:!0,bootstrapFailures:0}),u2=()=>({rooms:u1.map(({roomId:L,name:C})=>({roomId:L,name:C})),selectedPlan:"daily",plans:[{id:"daily",name:"Daily clean",enabled:!0,runBehavior:"intelligent",rooms:u1.slice(0,3).map(({roomId:L})=>({roomId:L,cleaningMode:"vacuum",coverageSetting:"standard"})),roomOrder:u1.slice(0,3).map(({roomId:L})=>L),returnToBase:!0,finishCurrentRoom:!1,finishCurrentRoomThreshold:50}]}),x2=()=>({sceneUrl:z1().sceneUrl,rooms:u1.map(L=>({...L,boundary:L.boundary.map(C=>[...C])})),areas:[{id:"entryway",name:"Entryway",circles:[{x:1.5,y:1.4,radius:.3},{x:1.9,y:1.6,radius:.3}],cleaningMode:"vacuum",coverageSetting:"standard",status:"current",canRebind:!1}]}),c5=()=>({entryId:"synthetic-entry",liveAvailable:!0,floors:[{id:"current",active:!0,readOnly:!1,liveAvailable:!0,label:"House",ordinal:null,snapshots:[{id:"current-old",createdAt:"2026-08-29T14:00:00Z",revision:6,pointCount:5300,sceneUrl:"/synthetic-history-current-old"},{id:"current-new",createdAt:"2026-08-29T16:12:00Z",revision:7,pointCount:5300,sceneUrl:"/synthetic-history-current-new"}]},{id:"saved-1",active:!1,readOnly:!0,liveAvailable:!1,label:"Shed",ordinal:2,snapshots:[{id:"saved-one",createdAt:"2026-08-28T11:30:00Z",revision:3,pointCount:3100,sceneUrl:"/synthetic-history-saved"}]},{id:"saved-2",active:!1,readOnly:!0,liveAvailable:!1,label:"Annex",ordinal:3,snapshots:[]}]}),u5=()=>({position:[4.475,3.475],source:"latest_pose",revision:7,poseRevision:4,floorCoherent:!0,mapSessionKey:m5,freshness:"live"});var G0=()=>({...k(),coherence:"current",activity:"docked",batteryPercent:92,robots:[{entryId:"synthetic-entry",label:"Matic robot"}],host:{connected:!0,administrator:!0,robotConnected:!0,robotCount:1},floor:{classifiedCount:2,displayName:"House",readOnly:!1},map:{available:!0,complete:!0,floorCoherent:!0,sessionVerified:!0,exactPose:!0},resources:{catalog:{status:"ready",value:[z1()],problem:null},entry:z1(),scene:{status:"ready",value:v5(),problem:null},pose:{status:"ready",value:u5(),problem:null},history:{status:"ready",value:c5(),problem:null},plans:{status:"ready",value:u2(),problem:null},areas:{status:"ready",value:x2(),problem:null}},selection:{...k().selection,entryId:"synthetic-entry",planId:"daily"},planDraft:{...k().planDraft,id:"daily",name:"Daily clean",rooms:u2().plans[0]?.rooms||[]}}),Z2=L=>{let C=G0();switch(L){case"ready":return C;case"cleaning":return{...C,activity:"cleaning"};case"paused":return{...C,activity:"paused"};case"returning":return{...C,activity:"returning"};case"recharging":return{...C,activity:"recharging",batteryPercent:18};case"rooms":return{...C,workflow:"rooms"};case"draw":return{...C,workflow:"draw",areaDraft:{...C.areaDraft,id:"entryway",name:"Entryway",status:"current"},selection:{...C.selection,areaId:"entryway"},draw:{...C.draw,dirty:!0,strokeCount:3,circles:x2().areas[0]?.circles||[]}};case"history":return{...C,dataMode:"history",workflow:"history",floor:{...C.floor,readOnly:!0},map:{...C.map,exactPose:!1},selection:{...C.selection,floorId:"saved-1",historyId:"saved-one"}};case"transition":return{...C,coherence:"verifying",activity:"unknown",map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1}};case"problem":return{...C,activity:"problem",coherence:"blocked"};case"ha-offline":return{...C,coherence:"degraded",host:{...C.host,connected:!1},map:{...C.map,exactPose:!1}};case"robot-offline":return{...C,coherence:"degraded",host:{...C.host,robotConnected:!1},map:{...C.map,exactPose:!1}};case"access":return{...C,coherence:"blocked",host:{...C.host,administrator:!1},map:{...C.map,available:!1,exactPose:!1}};case"empty":return{...C,coherence:"unavailable",host:{...C.host,robotConnected:!1,robotCount:0},map:{...C.map,available:!1,exactPose:!1}};case"unsupported":return{...C,coherence:"blocked",map:{...C.map,available:!1,exactPose:!1}};case"multi-robot":return{...C,host:{...C.host,robotCount:2},robots:[{entryId:"synthetic-entry",label:"Matic robot"},{entryId:"synthetic-entry-two",label:"Second robot"}]}}},h2=["ready","cleaning","paused","returning","recharging","rooms","draw","history","transition","problem","ha-offline","robot-offline","access","empty","unsupported","multi-robot"];var Q0=(L,C)=>{if(C?.recharge_and_resume===!0&&C?.charging===!0)return"recharging";switch(L){case"cleaning":return"cleaning";case"paused":return"paused";case"returning":return"returning";case"docked":return"docked";case"idle":return"idle";case"error":return"problem";default:return"unknown"}},q0=L=>typeof L!="number"||!Number.isFinite(L)?null:Math.round(Math.max(0,Math.min(100,L))),K0=L=>{let C=L.attributes?.matic_entry_id;return typeof C=="string"&&C.length>0?C:null},X0=L=>String(L||"local-user").replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",x5=L=>{if(typeof L!="string")return"Matic robot";let C=L.trim();return C&&Array.from(C).length<=128&&!/[\u0000-\u001f\u007f]/u.test(C)?C:"Matic robot"},U1=class{#C="";#H=null;project(C,H,V=null){let e=C?.states??{},r=H?.config?.entry_id,t=typeof r=="string"?r:null,o=null,M=null,i=null,a=new Map;for(let[S,g]of Object.entries(e)){let P=K0(g);if(!P||!S.startsWith("vacuum."))continue;a.set(P,{entryId:P,label:x5(g.attributes?.friendly_name)});let I1=V||t;(!o||I1&&P===I1)&&(o=g,M=S,i=P)}let n={connected:C?.connected!==!1,administrator:C?.user?.is_admin===!0,robotConnected:o!==null&&o.state!=="unavailable"&&o.state!=="unknown",robotCount:a.size},A=o?Q0(o.state,o.attributes):"unknown",s=q0(o?.attributes?.battery_level),p=C?.selectedLanguage||C?.language||"en",u=X0(C?.user?.id),h=x5(o?.attributes?.friendly_name),x=[...a.values()].sort((S,g)=>S.label.localeCompare(g.label,p,{sensitivity:"base"})),f=[n.connected,n.administrator,n.robotConnected,n.robotCount,A,s??"none",p,u,M??"none",i??"none",h,x.map(S=>`${S.entryId}:${S.label}`).join(",")].join("|");return f===this.#C&&this.#H?this.#H:(this.#C=f,this.#H={host:n,activity:A,batteryPercent:s,language:p,userKey:u,vacuumEntityId:M,entryKey:i,robotLabel:h,robots:x},this.#H)}};var G1=globalThis,Q1=G1.ShadowRoot&&(G1.ShadyCSS===void 0||G1.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,S2=Symbol(),Z5=new WeakMap,O1=class{constructor(C,H,V){if(this._$cssResult$=!0,V!==S2)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=C,this.t=H}get styleSheet(){let C=this.o,H=this.t;if(Q1&&C===void 0){let V=H!==void 0&&H.length===1;V&&(C=Z5.get(H)),C===void 0&&((this.o=C=new CSSStyleSheet).replaceSync(this.cssText),V&&Z5.set(H,C))}return C}toString(){return this.cssText}},h5=L=>new O1(typeof L=="string"?L:L+"",void 0,S2),b=(L,...C)=>{let H=L.length===1?L[0]:C.reduce((V,e,r)=>V+(t=>{if(t._$cssResult$===!0)return t.cssText;if(typeof t=="number")return t;throw Error("Value passed to 'css' function must be a 'css' function result: "+t+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(e)+L[r+1],L[0]);return new O1(H,L,S2)},S5=(L,C)=>{if(Q1)L.adoptedStyleSheets=C.map(H=>H instanceof CSSStyleSheet?H:H.styleSheet);else for(let H of C){let V=document.createElement("style"),e=G1.litNonce;e!==void 0&&V.setAttribute("nonce",e),V.textContent=H.cssText,L.appendChild(V)}},f2=Q1?L=>L:L=>L instanceof CSSStyleSheet?(C=>{let H="";for(let V of C.cssRules)H+=V.cssText;return h5(H)})(L):L;var{is:Y0,defineProperty:j0,getOwnPropertyDescriptor:J0,getOwnPropertyNames:C7,getOwnPropertySymbols:H7,getPrototypeOf:V7}=Object,q1=globalThis,f5=q1.trustedTypes,L7=f5?f5.emptyScript:"",e7=q1.reactiveElementPolyfillSupport,w1=(L,C)=>L,g2={toAttribute(L,C){switch(C){case Boolean:L=L?L7:null;break;case Object:case Array:L=L==null?L:JSON.stringify(L)}return L},fromAttribute(L,C){let H=L;switch(C){case Boolean:H=L!==null;break;case Number:H=L===null?null:Number(L);break;case Object:case Array:try{H=JSON.parse(L)}catch{H=null}}return H}},y5=(L,C)=>!Y0(L,C),g5={attribute:!0,type:String,converter:g2,reflect:!1,useDefault:!1,hasChanged:y5};Symbol.metadata??=Symbol("metadata"),q1.litPropertyMetadata??=new WeakMap;var K=class extends HTMLElement{static addInitializer(C){this._$Ei(),(this.l??=[]).push(C)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(C,H=g5){if(H.state&&(H.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(C)&&((H=Object.create(H)).wrapped=!0),this.elementProperties.set(C,H),!H.noAccessor){let V=Symbol(),e=this.getPropertyDescriptor(C,V,H);e!==void 0&&j0(this.prototype,C,e)}}static getPropertyDescriptor(C,H,V){let{get:e,set:r}=J0(this.prototype,C)??{get(){return this[H]},set(t){this[H]=t}};return{get:e,set(t){let o=e?.call(this);r?.call(this,t),this.requestUpdate(C,o,V)},configurable:!0,enumerable:!0}}static getPropertyOptions(C){return this.elementProperties.get(C)??g5}static _$Ei(){if(this.hasOwnProperty(w1("elementProperties")))return;let C=V7(this);C.finalize(),C.l!==void 0&&(this.l=[...C.l]),this.elementProperties=new Map(C.elementProperties)}static finalize(){if(this.hasOwnProperty(w1("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(w1("properties"))){let H=this.properties,V=[...C7(H),...H7(H)];for(let e of V)this.createProperty(e,H[e])}let C=this[Symbol.metadata];if(C!==null){let H=litPropertyMetadata.get(C);if(H!==void 0)for(let[V,e]of H)this.elementProperties.set(V,e)}this._$Eh=new Map;for(let[H,V]of this.elementProperties){let e=this._$Eu(H,V);e!==void 0&&this._$Eh.set(e,H)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(C){let H=[];if(Array.isArray(C)){let V=new Set(C.flat(1/0).reverse());for(let e of V)H.unshift(f2(e))}else C!==void 0&&H.push(f2(C));return H}static _$Eu(C,H){let V=H.attribute;return V===!1?void 0:typeof V=="string"?V:typeof C=="string"?C.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){this._$ES=new Promise(C=>this.enableUpdating=C),this._$AL=new Map,this._$E_(),this.requestUpdate(),this.constructor.l?.forEach(C=>C(this))}addController(C){(this._$EO??=new Set).add(C),this.renderRoot!==void 0&&this.isConnected&&C.hostConnected?.()}removeController(C){this._$EO?.delete(C)}_$E_(){let C=new Map,H=this.constructor.elementProperties;for(let V of H.keys())this.hasOwnProperty(V)&&(C.set(V,this[V]),delete this[V]);C.size>0&&(this._$Ep=C)}createRenderRoot(){let C=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return S5(C,this.constructor.elementStyles),C}connectedCallback(){this.renderRoot??=this.createRenderRoot(),this.enableUpdating(!0),this._$EO?.forEach(C=>C.hostConnected?.())}enableUpdating(C){}disconnectedCallback(){this._$EO?.forEach(C=>C.hostDisconnected?.())}attributeChangedCallback(C,H,V){this._$AK(C,V)}_$ET(C,H){let V=this.constructor.elementProperties.get(C),e=this.constructor._$Eu(C,V);if(e!==void 0&&V.reflect===!0){let r=(V.converter?.toAttribute!==void 0?V.converter:g2).toAttribute(H,V.type);this._$Em=C,r==null?this.removeAttribute(e):this.setAttribute(e,r),this._$Em=null}}_$AK(C,H){let V=this.constructor,e=V._$Eh.get(C);if(e!==void 0&&this._$Em!==e){let r=V.getPropertyOptions(e),t=typeof r.converter=="function"?{fromAttribute:r.converter}:r.converter?.fromAttribute!==void 0?r.converter:g2;this._$Em=e;let o=t.fromAttribute(H,r.type);this[e]=o??this._$Ej?.get(e)??o,this._$Em=null}}requestUpdate(C,H,V,e=!1,r){if(C!==void 0){let t=this.constructor;if(e===!1&&(r=this[C]),V??=t.getPropertyOptions(C),!((V.hasChanged??y5)(r,H)||V.useDefault&&V.reflect&&r===this._$Ej?.get(C)&&!this.hasAttribute(t._$Eu(C,V))))return;this.C(C,H,V)}this.isUpdatePending===!1&&(this._$ES=this._$EP())}C(C,H,{useDefault:V,reflect:e,wrapped:r},t){V&&!(this._$Ej??=new Map).has(C)&&(this._$Ej.set(C,t??H??this[C]),r!==!0||t!==void 0)||(this._$AL.has(C)||(this.hasUpdated||V||(H=void 0),this._$AL.set(C,H)),e===!0&&this._$Em!==C&&(this._$Eq??=new Set).add(C))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(H){Promise.reject(H)}let C=this.scheduleUpdate();return C!=null&&await C,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??=this.createRenderRoot(),this._$Ep){for(let[e,r]of this._$Ep)this[e]=r;this._$Ep=void 0}let V=this.constructor.elementProperties;if(V.size>0)for(let[e,r]of V){let{wrapped:t}=r,o=this[e];t!==!0||this._$AL.has(e)||o===void 0||this.C(e,void 0,r,o)}}let C=!1,H=this._$AL;try{C=this.shouldUpdate(H),C?(this.willUpdate(H),this._$EO?.forEach(V=>V.hostUpdate?.()),this.update(H)):this._$EM()}catch(V){throw C=!1,this._$EM(),V}C&&this._$AE(H)}willUpdate(C){}_$AE(C){this._$EO?.forEach(H=>H.hostUpdated?.()),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(C)),this.updated(C)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(C){return!0}update(C){this._$Eq&&=this._$Eq.forEach(H=>this._$ET(H,this[H])),this._$EM()}updated(C){}firstUpdated(C){}};K.elementStyles=[],K.shadowRootOptions={mode:"open"},K[w1("elementProperties")]=new Map,K[w1("finalized")]=new Map,e7?.({ReactiveElement:K}),(q1.reactiveElementVersions??=[]).push("2.1.2");var _2=globalThis,b5=L=>L,K1=_2.trustedTypes,O5=K1?K1.createPolicy("lit-html",{createHTML:L=>L}):void 0,B5="$lit$",j=`lit$${Math.random().toFixed(9).slice(2)}$`,R5="?"+j,r7=`<${R5}>`,M1=document,P1=()=>M1.createComment(""),_1=L=>L===null||typeof L!="object"&&typeof L!="function",T2=Array.isArray,t7=L=>T2(L)||typeof L?.[Symbol.iterator]=="function",y2=`[ \t\n\f\r]`,k1=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,w5=/-->/g,k5=/>/g,r1=RegExp(`>|${y2}(?:([^\\s"'>=/]+)(${y2}*=${y2}*(?:[^ \t\n\f\r"'\`<>=]|("|')|))|$)`,"g"),P5=/'/g,_5=/"/g,F5=/^(?:script|style|textarea|title)$/i,B2=L=>(C,...H)=>({_$litType$:L,strings:C,values:H}),d=B2(1),E5=B2(2),D5=B2(3),o1=Symbol.for("lit-noChange"),l=Symbol.for("lit-nothing"),T5=new WeakMap,t1=M1.createTreeWalker(M1,129);function $5(L,C){if(!T2(L)||!L.hasOwnProperty("raw"))throw Error("invalid template strings array");return O5!==void 0?O5.createHTML(C):C}var M7=(L,C)=>{let H=L.length-1,V=[],e,r=C===2?"<svg>":C===3?"<math>":"",t=k1;for(let o=0;o<H;o++){let M=L[o],i,a,n=-1,A=0;for(;A<M.length&&(t.lastIndex=A,a=t.exec(M),a!==null);)A=t.lastIndex,t===k1?a[1]==="!--"?t=w5:a[1]!==void 0?t=k5:a[2]!==void 0?(F5.test(a[2])&&(e=RegExp("</"+a[2],"g")),t=r1):a[3]!==void 0&&(t=r1):t===r1?a[0]===">"?(t=e??k1,n=-1):a[1]===void 0?n=-2:(n=t.lastIndex-a[2].length,i=a[1],t=a[3]===void 0?r1:a[3]==='"'?_5:P5):t===_5||t===P5?t=r1:t===w5||t===k5?t=k1:(t=r1,e=void 0);let s=t===r1&&L[o+1].startsWith("/>")?" ":"";r+=t===k1?M+r7:n>=0?(V.push(i),M.slice(0,n)+B5+M.slice(n)+j+s):M+j+(n===-2?o:s)}return[$5(L,r+(L[H]||"<?>")+(C===2?"</svg>":C===3?"</math>":"")),V]},T1=class L{constructor({strings:C,_$litType$:H},V){let e;this.parts=[];let r=0,t=0,o=C.length-1,M=this.parts,[i,a]=M7(C,H);if(this.el=L.createElement(i,V),t1.currentNode=this.el.content,H===2||H===3){let n=this.el.content.firstChild;n.replaceWith(...n.childNodes)}for(;(e=t1.nextNode())!==null&&M.length<o;){if(e.nodeType===1){if(e.hasAttributes())for(let n of e.getAttributeNames())if(n.endsWith(B5)){let A=a[t++],s=e.getAttribute(n).split(j),p=/([.?@])?(.*)/.exec(A);M.push({type:1,index:r,name:p[2],strings:s,ctor:p[1]==="."?O2:p[1]==="?"?w2:p[1]==="@"?k2:Z1}),e.removeAttribute(n)}else n.startsWith(j)&&(M.push({type:6,index:r}),e.removeAttribute(n));if(F5.test(e.tagName)){let n=e.textContent.split(j),A=n.length-1;if(A>0){e.textContent=K1?K1.emptyScript:"";for(let s=0;s<A;s++)e.append(n[s],P1()),t1.nextNode(),M.push({type:2,index:++r});e.append(n[A],P1())}}}else if(e.nodeType===8)if(e.data===R5)M.push({type:2,index:r});else{let n=-1;for(;(n=e.data.indexOf(j,n+1))!==-1;)M.push({type:7,index:r}),n+=j.length-1}r++}}static createElement(C,H){let V=M1.createElement("template");return V.innerHTML=C,V}};function x1(L,C,H=L,V){if(C===o1)return C;let e=V!==void 0?H._$Co?.[V]:H._$Cl,r=_1(C)?void 0:C._$litDirective$;return e?.constructor!==r&&(e?._$AO?.(!1),r===void 0?e=void 0:(e=new r(L),e._$AT(L,H,V)),V!==void 0?(H._$Co??=[])[V]=e:H._$Cl=e),e!==void 0&&(C=x1(L,e._$AS(L,C.values),e,V)),C}var b2=class{constructor(C,H){this._$AV=[],this._$AN=void 0,this._$AD=C,this._$AM=H}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(C){let{el:{content:H},parts:V}=this._$AD,e=(C?.creationScope??M1).importNode(H,!0);t1.currentNode=e;let r=t1.nextNode(),t=0,o=0,M=V[0];for(;M!==void 0;){if(t===M.index){let i;M.type===2?i=new B1(r,r.nextSibling,this,C):M.type===1?i=new M.ctor(r,M.name,M.strings,this,C):M.type===6&&(i=new P2(r,this,C)),this._$AV.push(i),M=V[++o]}t!==M?.index&&(r=t1.nextNode(),t++)}return t1.currentNode=M1,e}p(C){let H=0;for(let V of this._$AV)V!==void 0&&(V.strings!==void 0?(V._$AI(C,V,H),H+=V.strings.length-2):V._$AI(C[H])),H++}},B1=class L{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(C,H,V,e){this.type=2,this._$AH=l,this._$AN=void 0,this._$AA=C,this._$AB=H,this._$AM=V,this.options=e,this._$Cv=e?.isConnected??!0}get parentNode(){let C=this._$AA.parentNode,H=this._$AM;return H!==void 0&&C?.nodeType===11&&(C=H.parentNode),C}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(C,H=this){C=x1(this,C,H),_1(C)?C===l||C==null||C===""?(this._$AH!==l&&this._$AR(),this._$AH=l):C!==this._$AH&&C!==o1&&this._(C):C._$litType$!==void 0?this.$(C):C.nodeType!==void 0?this.T(C):t7(C)?this.k(C):this._(C)}O(C){return this._$AA.parentNode.insertBefore(C,this._$AB)}T(C){this._$AH!==C&&(this._$AR(),this._$AH=this.O(C))}_(C){this._$AH!==l&&_1(this._$AH)?this._$AA.nextSibling.data=C:this.T(M1.createTextNode(C)),this._$AH=C}$(C){let{values:H,_$litType$:V}=C,e=typeof V=="number"?this._$AC(C):(V.el===void 0&&(V.el=T1.createElement($5(V.h,V.h[0]),this.options)),V);if(this._$AH?._$AD===e)this._$AH.p(H);else{let r=new b2(e,this),t=r.u(this.options);r.p(H),this.T(t),this._$AH=r}}_$AC(C){let H=T5.get(C.strings);return H===void 0&&T5.set(C.strings,H=new T1(C)),H}k(C){T2(this._$AH)||(this._$AH=[],this._$AR());let H=this._$AH,V,e=0;for(let r of C)e===H.length?H.push(V=new L(this.O(P1()),this.O(P1()),this,this.options)):V=H[e],V._$AI(r),e++;e<H.length&&(this._$AR(V&&V._$AB.nextSibling,e),H.length=e)}_$AR(C=this._$AA.nextSibling,H){for(this._$AP?.(!1,!0,H);C!==this._$AB;){let V=b5(C).nextSibling;b5(C).remove(),C=V}}setConnected(C){this._$AM===void 0&&(this._$Cv=C,this._$AP?.(C))}},Z1=class{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(C,H,V,e,r){this.type=1,this._$AH=l,this._$AN=void 0,this.element=C,this.name=H,this._$AM=e,this.options=r,V.length>2||V[0]!==""||V[1]!==""?(this._$AH=Array(V.length-1).fill(new String),this.strings=V):this._$AH=l}_$AI(C,H=this,V,e){let r=this.strings,t=!1;if(r===void 0)C=x1(this,C,H,0),t=!_1(C)||C!==this._$AH&&C!==o1,t&&(this._$AH=C);else{let o=C,M,i;for(C=r[0],M=0;M<r.length-1;M++)i=x1(this,o[V+M],H,M),i===o1&&(i=this._$AH[M]),t||=!_1(i)||i!==this._$AH[M],i===l?C=l:C!==l&&(C+=(i??"")+r[M+1]),this._$AH[M]=i}t&&!e&&this.j(C)}j(C){C===l?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,C??"")}},O2=class extends Z1{constructor(){super(...arguments),this.type=3}j(C){this.element[this.name]=C===l?void 0:C}},w2=class extends Z1{constructor(){super(...arguments),this.type=4}j(C){this.element.toggleAttribute(this.name,!!C&&C!==l)}},k2=class extends Z1{constructor(C,H,V,e,r){super(C,H,V,e,r),this.type=5}_$AI(C,H=this){if((C=x1(this,C,H,0)??l)===o1)return;let V=this._$AH,e=C===l&&V!==l||C.capture!==V.capture||C.once!==V.once||C.passive!==V.passive,r=C!==l&&(V===l||e);e&&this.element.removeEventListener(this.name,this,V),r&&this.element.addEventListener(this.name,this,C),this._$AH=C}handleEvent(C){typeof this._$AH=="function"?this._$AH.call(this.options?.host??this.element,C):this._$AH.handleEvent(C)}},P2=class{constructor(C,H,V){this.element=C,this.type=6,this._$AN=void 0,this._$AM=H,this.options=V}get _$AU(){return this._$AM._$AU}_$AI(C){x1(this,C)}};var o7=_2.litHtmlPolyfillSupport;o7?.(T1,B1),(_2.litHtmlVersions??=[]).push("3.3.3");var I5=(L,C,H)=>{let V=H?.renderBefore??C,e=V._$litPart$;if(e===void 0){let r=H?.renderBefore??null;V._$litPart$=e=new B1(C.insertBefore(P1(),r),r,void 0,H??{})}return e._$AI(L),e};var R2=globalThis,O=class extends K{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){let C=super.createRenderRoot();return this.renderOptions.renderBefore??=C.firstChild,C}update(C){let H=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(C),this._$Do=I5(H,this.renderRoot,this.renderOptions)}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(!0)}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(!1)}render(){return o1}};O._$litElement$=!0,O.finalized=!0,R2.litElementHydrateSupport?.({LitElement:O});var i7=R2.litElementPolyfillSupport;i7?.({LitElement:O});(R2.litElementVersions??=[]).push("4.2.2");var D=b`
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
`,$=b`
*, *::before, *::after { box-sizing: border-box; }
button, input, select, textarea { font: inherit; }
.ms-icon { display: block; flex: none; inline-size: var(--ms-icon); block-size: var(--ms-icon); }
.ms-icon--sm { inline-size: var(--ms-icon-sm); block-size: var(--ms-icon-sm); }
`;var N5=Symbol.for(""),a7=L=>{if(L?.r===N5)return L?._$litStatic$},J=L=>({_$litStatic$:L,r:N5});var W5=new Map,F2=L=>(C,...H)=>{let V=H.length,e,r,t=[],o=[],M,i=0,a=!1;for(;i<V;){for(M=C[i];i<V&&(r=H[i],(e=a7(r))!==void 0);)M+=e+C[++i],a=!0;i!==V&&o.push(r),t.push(M),i++}if(i===V&&t.push(C[V]),a){let n=t.join("$$lit$$");(C=W5.get(n))===void 0&&(t.raw=t,W5.set(n,C=t)),H=o}return L(C,...H)},c=F2(d),y4=F2(E5),b4=F2(D5);var z5=import.meta.url.match(/\/matic_robot\/[^/]+-([a-f0-9]{12})\/map-studio-v4(?:\/|$)/u)?.[1]??"dev",R1=z5==="dev"?"":`-${z5}`,i1=`matic-map-canvas-v4${R1}`,F1=`matic-precision-controls-v4${R1}`,a1=`matic-map-workflow-v4${R1}`,n1=`matic-map-shell-v4${R1}`,E2=`matic-map-panel-v0-4-0${R1}`;var C1=b`
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
.ms-switch {
position: relative;
flex: none;
inline-size: 3.25rem;
block-size: var(--ms-control);
padding: 0;
border: 0;
background: transparent;
cursor: pointer;
-webkit-tap-highlight-color: transparent;
}
.ms-switch::before {
content: "";
position: absolute;
inset-inline: 0.25rem;
inset-block-start: 50%;
block-size: 1.5rem;
translate: 0 -50%;
border: 1px solid var(--ms-line-strong);
border-radius: var(--ms-radius-pill);
background: color-mix(in srgb, var(--ms-text) 14%, var(--ms-local));
transition: background-color var(--ms-fast) var(--ms-ease), border-color var(--ms-fast) var(--ms-ease);
}
.ms-switch::after {
content: "";
position: absolute;
inset-inline-start: 0.4375rem;
inset-block-start: 50%;
inline-size: 1.125rem;
block-size: 1.125rem;
translate: 0 -50%;
border-radius: 50%;
background: var(--ms-surface-card);
box-shadow: var(--ms-shadow-1);
transition: translate var(--ms-fast) var(--ms-ease);
}
.ms-switch[aria-checked="true"]::before { border-color: var(--ms-accent); background: var(--ms-accent); }
.ms-switch[aria-checked="true"]::after { translate: 1.25rem -50%; background: var(--ms-on-accent); }
.ms-switch:focus-visible { outline: 0; }
.ms-switch:focus-visible::before { outline: 2px solid var(--ms-accent); outline-offset: 2px; }
.ms-switch:disabled, .ms-switch[aria-disabled="true"] { cursor: default; opacity: 0.55; }
@media (forced-colors: active) {
.ms-switch::before { border-color: ButtonBorder; }
.ms-switch[aria-checked="true"]::before { forced-color-adjust: none; background: Highlight; border-color: Highlight; }
.ms-switch[aria-checked="true"]::after { background: HighlightText; }
}
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
`;var U5=[D,$,C1,b`
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
      overflow: hidden;
    }
    .workflow-body { flex: 1; min-block-size: 0; overflow: auto; overscroll-behavior: contain; }
    .workflow > .action-bar { flex: none; }

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
    .shelf-heading { margin: var(--ms-space-5) 0 var(--ms-space-2); color: var(--ms-text-quiet); font-size: var(--ms-t-sm); font-weight: var(--ms-w-bold); }
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

    /* Programmatic focus after a workflow change is for assistive tech; a ring on a heading reads as a control. */
    h2[tabindex="-1"]:focus { outline: 0; }
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
  `];var G5="M11,4H13V16L18.5,10.5L19.92,11.92L12,19.84L4.08,11.92L5.5,10.5L11,16V4Z";var Q5="M9.5,13.09L10.91,14.5L6.41,19H10V21H3V14H5V17.59L9.5,13.09M10.91,9.5L9.5,10.91L5,6.41V10H3V3H10V5H6.41L10.91,9.5M14.5,13.09L19,17.59V14H21V21H14V19H17.59L13.09,14.5L14.5,13.09M13.09,9.5L17.59,5H14V3H21V10H19V6.41L14.5,10.91L13.09,9.5Z";var q5="M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z";var K5="M13,20H11V8L5.5,13.5L4.08,12.08L12,4.16L19.92,12.08L18.5,13.5L13,8V20Z";var X5="M23,11H20V4L15,14H18V22M12,13H4V6H12M12.67,4H11V2H5V4H3.33A1.33,1.33 0 0,0 2,5.33V20.67C2,21.4 2.6,22 3.33,22H12.67C13.4,22 14,21.4 14,20.67V5.33A1.33,1.33 0 0,0 12.67,4Z";var Y5="M20.71,4.63L19.37,3.29C19,2.9 18.35,2.9 17.96,3.29L9,12.25L11.75,15L20.71,6.04C21.1,5.65 21.1,5 20.71,4.63M7,14A3,3 0 0,0 4,17C4,18.31 2.84,19 2,19C2.92,20.22 4.5,21 6,21A4,4 0 0,0 10,17A3,3 0 0,0 7,14Z";var D2="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z";var j5="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z";var $2="M7.41,15.41L12,10.83L16.59,15.41L18,14L12,8L6,14L7.41,15.41Z";var J5="M12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z";var C3="M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z";var H3="M13,6V11H18V7.75L22.25,12L18,16.25V13H13V18H16.25L12,22.25L7.75,18H11V13H6V16.25L1.75,12L6,7.75V11H11V6H7.75L12,1.75L16.25,6H13Z";var V3="M20 4H4A2 2 0 0 0 2 6V18A2 2 0 0 0 4 20H20A2 2 0 0 0 22 18V6A2 2 0 0 0 20 4M15 18H4V6H15Z";var L3="M12,16A2,2 0 0,1 14,18A2,2 0 0,1 12,20A2,2 0 0,1 10,18A2,2 0 0,1 12,16M12,10A2,2 0 0,1 14,12A2,2 0 0,1 12,14A2,2 0 0,1 10,12A2,2 0 0,1 12,10M12,4A2,2 0 0,1 14,6A2,2 0 0,1 12,8A2,2 0 0,1 10,6A2,2 0 0,1 12,4Z";var e3="M16.24,3.56L21.19,8.5C21.97,9.29 21.97,10.55 21.19,11.34L12,20.53C10.44,22.09 7.91,22.09 6.34,20.53L2.81,17C2.03,16.21 2.03,14.95 2.81,14.16L13.41,3.56C14.2,2.78 15.46,2.78 16.24,3.56M4.22,15.58L7.76,19.11C8.54,19.9 9.8,19.9 10.59,19.11L14.12,15.58L9.17,10.63L4.22,15.58Z";var r3="M18.5,4L19.66,8.35L18.7,8.61C18.25,7.74 17.79,6.87 17.26,6.43C16.73,6 16.11,6 15.5,6H13V16.5C13,17 13,17.5 13.33,17.75C13.67,18 14.33,18 15,18V19H9V18C9.67,18 10.33,18 10.67,17.75C11,17.5 11,17 11,16.5V6H8.5C7.89,6 7.27,6 6.74,6.43C6.21,6.87 5.75,7.74 5.3,8.61L4.34,8.35L5.5,4H18.5Z";var t3="M11,18H13V16H11V18M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M12,6A4,4 0 0,0 8,10H10A2,2 0 0,1 12,8A2,2 0 0,1 14,10C14,12 11,11.75 11,15H13C13,12.75 16,12.5 16,10A4,4 0 0,0 12,6Z";var M3="M13.5,8H12V13L16.28,15.54L17,14.33L13.5,12.25V8M13,3A9,9 0 0,0 4,12H1L4.96,16.03L9,12H6A7,7 0 0,1 13,5A7,7 0 0,1 20,12A7,7 0 0,1 13,19C11.07,19 9.32,18.21 8.06,16.94L6.64,18.36C8.27,20 10.5,21 13,21A9,9 0 0,0 22,12A9,9 0 0,0 13,3";var o3="M11,9H13V7H11M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M11,17H13V11H11V17Z";var i3="M16.37,16.1L11.75,11.47L11.64,11.36L3.27,3L2,4.27L5.18,7.45C5.06,7.95 5,8.46 5,9C5,14.25 12,22 12,22C12,22 13.67,20.15 15.37,17.65L18.73,21L20,19.72M12,6.5A2.5,2.5 0 0,1 14.5,9C14.5,9.73 14.17,10.39 13.67,10.85L17.3,14.5C18.28,12.62 19,10.68 19,9A7,7 0 0,0 12,2C10,2 8.24,2.82 6.96,4.14L10.15,7.33C10.61,6.82 11.26,6.5 12,6.5Z";var a3="M3,6H21V8H3V6M3,11H21V13H3V11M3,16H21V18H3V16Z";var n3="M14,19H18V5H14M6,19H10V5H6V19Z";var A3="M8,5.14V19.14L19,12.14L8,5.14Z";var l3="M14 10H3V12H14V10M14 6H3V8H14V6M3 16H10V14H3V16M21.5 11.5L23 13L16 20L11.5 15.5L13 14L16 17L21.5 11.5Z";var s3="M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z";var d3="M18.4,10.6C16.55,9 14.15,8 11.5,8C6.85,8 2.92,11.03 1.54,15.22L3.9,16C4.95,12.81 7.95,10.5 11.5,10.5C13.45,10.5 15.23,11.22 16.62,12.38L13,16H22V7L18.4,10.6Z";var p3="M12,2C14.65,2 17.19,3.06 19.07,4.93L17.65,6.35C16.15,4.85 14.12,4 12,4C9.88,4 7.84,4.84 6.35,6.35L4.93,4.93C6.81,3.06 9.35,2 12,2M3.66,6.5L5.11,7.94C4.39,9.17 4,10.57 4,12A8,8 0 0,0 12,20A8,8 0 0,0 20,12C20,10.57 19.61,9.17 18.88,7.94L20.34,6.5C21.42,8.12 22,10.04 22,12A10,10 0 0,1 12,22A10,10 0 0,1 2,12C2,10.04 2.58,8.12 3.66,6.5M12,6A6,6 0 0,1 18,12C18,13.59 17.37,15.12 16.24,16.24L14.83,14.83C14.08,15.58 13.06,16 12,16C10.94,16 9.92,15.58 9.17,14.83L7.76,16.24C6.63,15.12 6,13.59 6,12A6,6 0 0,1 12,6M12,8A1,1 0 0,0 11,9A1,1 0 0,0 12,10A1,1 0 0,0 13,9A1,1 0 0,0 12,8Z";var m3="M13,4.07V1L8.45,5.55L13,10V6.09C15.84,6.57 18,9.03 18,12C18,14.97 15.84,17.43 13,17.91V19.93C16.95,19.44 20,16.08 20,12C20,7.92 16.95,4.56 13,4.07M7.1,18.32C8.26,19.22 9.61,19.76 11,19.93V17.9C10.13,17.75 9.29,17.41 8.54,16.87L7.1,18.32M6.09,13H4.07C4.24,14.39 4.79,15.73 5.69,16.89L7.1,15.47C6.58,14.72 6.23,13.88 6.09,13M7.11,8.53L5.7,7.11C4.8,8.27 4.24,9.61 4.07,11H6.09C6.23,10.13 6.58,9.28 7.11,8.53Z";var v3="M16.89,15.5L18.31,16.89C19.21,15.73 19.76,14.39 19.93,13H17.91C17.77,13.87 17.43,14.72 16.89,15.5M13,17.9V19.92C14.39,19.75 15.74,19.21 16.9,18.31L15.46,16.87C14.71,17.41 13.87,17.76 13,17.9M19.93,11C19.76,9.61 19.21,8.27 18.31,7.11L16.89,8.53C17.43,9.28 17.77,10.13 17.91,11M15.55,5.55L11,1V4.07C7.06,4.56 4,7.92 4,12C4,16.08 7.05,19.44 11,19.93V17.91C8.16,17.43 6,14.97 6,12C6,9.03 8.16,6.57 11,6.09V10L15.55,5.55Z";var c3="M17,15.7V13H19V17L10,21L3,14L7,5H11V7H8.3L5.4,13.6L10.4,18.6L17,15.7M22,5V7H19V10H17V7H14V5H17V2H19V5H22Z";var u3="M12.5,8C9.85,8 7.45,9 5.6,10.6L2,7V16H11L7.38,12.38C8.77,11.22 10.54,10.5 12.5,10.5C16.04,10.5 19.05,12.81 20.1,16L22.47,15.22C21.08,11.03 17.15,8 12.5,8Z";var I2=q5,x3=L3,Z3=a3,h3=V3,X1=j5,S3=$2,f3=D2,g3=$2,y3=D2,b3=Q5,O3=r3,w3=t3,k3=m3,P3=v3,_3=u3,T3=d3,B3=Y5,R3=J5,F3=e3,E3=H3;var D3=s3;var $3=K5,I3=G5,W3=C3,N3=c3,W2=M3,z3=l3,U3=o3,Y1=p3,N2=A3,z2=n3,G3=X5,h1=i3,Z=L=>d`<svg
  class="ms-icon"
  viewBox="0 0 24 24"
  fill="currentColor"
  aria-hidden="true"
  focusable="false"
><path d=${L}></path></svg>`;var n7=["paint","erase","pan"],j1=(L,C,H)=>{let{draw:V}=L,e=`${V.brushMeters.toFixed(2)} m`;return d`
    <div
      class=${`draw-tools draw-tools--${H} ms-segment`}
      role="toolbar"
      aria-label=${C.t("v4_draw_tools","Draw area tools")}
      data-map-control
    >
      ${n7.map(r=>d`
        <button
          class="ms-btn"
          type="button"
          aria-pressed=${String(V.tool===r)}
          data-tool=${r}
          @click=${()=>C.intent({type:"set-draw-tool",tool:r})}
        >${Z(r==="paint"?B3:r==="erase"?F3:E3)}<span class="ms-btn__label">${r==="paint"?C.t("area_paint","Paint"):r==="erase"?C.t("area_erase","Erase"):C.t("move_map","Move map")}</span></button>
      `)}
      <button
        class="ms-btn"
        type="button"
        ?disabled=${V.strokeCount===0}
        @click=${()=>C.intent({type:"undo-draft"})}
      >${Z(_3)}<span class="ms-btn__label">${C.t("undo","Undo")}</span></button>
      <button
        class="ms-btn"
        type="button"
        ?disabled=${V.redo.length===0}
        @click=${()=>C.intent({type:"redo-draft"})}
      >${Z(T3)}<span class="ms-btn__label">${C.t("redo","Redo")}</span></button>
      <button
        class="ms-btn draw-brush"
        type="button"
        aria-label=${C.t("v4_brush_button","Brush width, {brush}. Opens brush settings.").replace("{brush}",e)}
        aria-expanded=${String(L.precisionOpen)}
        aria-haspopup="dialog"
        @click=${C.openBrush}
      >${Z(R3)}<span class="ms-btn__label">${C.t("v4_brush","Brush {brush}").replace("{brush}",e)}</span></button>
    </div>
  `};var A7=L=>L.matches(":disabled, [aria-disabled='true']"),J1=class{#C;#H;#V=null;#t=null;constructor(C,H){this.#C=C,this.#H=H,C.addController(this)}hostConnected(){this.#C.addEventListener("focusin",this.#a)}hostDisconnected(){this.#C.removeEventListener("focusin",this.#a),this.#V?.removeEventListener("keydown",this.#i),this.#V=null,this.#t=null}hostUpdated(){let C=this.#H.container();C!==this.#V&&(this.#V?.removeEventListener("keydown",this.#i),C?.addEventListener("keydown",this.#i),this.#V=C),this.#L()}#r(){let C=this.#V;return C?[...C.querySelectorAll(this.#H.items)].filter(H=>!A7(H)):[]}#L(){let C=this.#r(),H=(this.#t&&C.includes(this.#t)?this.#t:null)??C.find(e=>e.matches("[aria-pressed='true'], [aria-checked='true']"))??C[0]??null;this.#t=H;let V=this.#V?.querySelectorAll(this.#H.items)??[];for(let e of V)e.tabIndex=e===H?0:-1}#a=C=>{let H=C.composedPath()[0];!(H instanceof HTMLElement)||!this.#V?.contains(H)||H.matches(this.#H.items)&&(this.#t=H,this.#L())};#i=C=>{if(C.defaultPrevented||C.ctrlKey||C.metaKey||C.altKey)return;let H=this.#H.orientation??"horizontal",V=H!=="vertical",e=H!=="horizontal",r=this.#r();if(!r.length)return;let t=C.composedPath()[0],o=Math.max(0,r.findIndex(a=>a===this.#t||t instanceof Node&&a.contains(t))),M;switch(C.key){case"ArrowLeft":if(!V)return;M=o-1;break;case"ArrowRight":if(!V)return;M=o+1;break;case"ArrowUp":if(!e)return;M=o-1;break;case"ArrowDown":if(!e)return;M=o+1;break;case"Home":M=0;break;case"End":M=r.length-1;break;default:return}C.preventDefault();let i=r[(M+r.length)%r.length];i&&(this.#t=i,this.#L(),i.focus())}};var Q3={accent:["--ms-accent","Highlight",[6,120,206]],onAccent:["--ms-on-accent","HighlightText",[255,255,255]],text:["--ms-text","CanvasText",[38,50,56]],quiet:["--ms-text-quiet","GrayText",[75,92,105]],plate:["--ms-surface-card","Canvas",[250,252,253]],roomFill:["--ms-surface-sunken","Canvas",[231,238,242]]},l7=L=>Math.max(0,Math.min(255,Math.round(L))),q3=L=>{let C=L.trim(),H=C.match(/^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i)?.[1];if(H){let a=H.length<=4?[H[0],H[1],H[2]].map(p=>Number.parseInt(`${p}${p}`,16)):[H.slice(0,2),H.slice(2,4),H.slice(4,6)].map(p=>Number.parseInt(p,16)),[n,A,s]=a;return n===void 0||A===void 0||s===void 0?null:[n,A,s]}let V=C.startsWith("color(srgb"),e=C.slice(C.indexOf("(")+1).match(/-?\d*\.?\d+/g);if(!e||e.length<3)return null;let r=V?255:1,t=e.slice(0,3).map(a=>l7(Number(a)*r)),[o,M,i]=t;return o===void 0||M===void 0||i===void 0||[o,M,i].some(a=>Number.isNaN(a))?null:[o,M,i]},B=(L,C)=>`rgba(${L[0]},${L[1]},${L[2]},${C})`,K3=L=>{let C=window.matchMedia?.("(forced-colors: active)").matches??!1;if(!C){let e=document.createElement("span"),r=document.createElement("canvas");r.width=1,r.height=1;let t=r.getContext("2d",{colorSpace:"srgb",willReadFrequently:!0});e.setAttribute("aria-hidden","true"),e.style.cssText="position:absolute;inline-size:0;block-size:0;overflow:hidden;visibility:hidden;pointer-events:none",L.append(e);let o=M=>{let[i,,a]=Q3[M];e.style.color=`var(${i}, transparent)`;let n=getComputedStyle(e).color;if(t){t.clearRect(0,0,1,1),t.fillStyle="transparent",t.fillStyle=n,t.fillRect(0,0,1,1);let[A,s,p,u]=t.getImageData(0,0,1,1).data;if(A!==void 0&&s!==void 0&&p!==void 0&&u!==void 0&&u!==0)return[A,s,p]}return q3(n)??a};try{return{accent:o("accent"),onAccent:o("onAccent"),text:o("text"),quiet:o("quiet"),plate:o("plate"),roomFill:o("roomFill"),forced:C}}finally{e.remove()}}let H=document.createElement("span");H.setAttribute("aria-hidden","true"),H.style.cssText="position:absolute;inline-size:0;block-size:0;overflow:hidden;visibility:hidden;pointer-events:none",L.append(H);let V=e=>{let[,r,t]=Q3[e];return H.style.color=r,q3(getComputedStyle(H).color)??t};try{return{accent:V("accent"),onAccent:V("onAccent"),text:V("text"),quiet:V("quiet"),plate:V("plate"),roomFill:V("roomFill"),forced:C}}finally{H.remove()}};var X3=(L,C)=>Math.hypot(L.x-C.x,L.y-C.y),Y3=(L,C)=>({x:(L.x+C.x)/2,y:(L.y+C.y)/2}),j3=(L,C)=>Math.atan2(C.y-L.y,C.x-L.x),s7=L=>{let C=L;for(;C>Math.PI;)C-=Math.PI*2;for(;C<-Math.PI;)C+=Math.PI*2;return C},A1=(L,C,H)=>Math.max(C,Math.min(H,L)),U2=L=>L.map(C=>({...C})),d7="button, input, select, textarea, a, [role='button'], [role='menuitem'], [data-map-control]",S1=L=>L.composedPath().some(C=>C instanceof Element&&C.matches(d7)),C2=class{#C;#H;#V;#t=new Map;#r=!1;#L="idle";#a=[];#i=[];#l=null;#e=0;#h=null;#f=0;#u=null;#d=null;#n=null;#p=0;#o=null;#m=!1;#S=null;#s=!1;constructor(C,H,V){this.#C=C,this.#H=H,this.#V=V,C.addEventListener("pointerdown",this.#M),C.addEventListener("pointermove",this.#x),C.addEventListener("pointerup",this.#v),C.addEventListener("pointercancel",this.#v),C.addEventListener("wheel",this.#c,{passive:!1}),C.addEventListener("gesturestart",this.#Z,{passive:!1}),C.addEventListener("gesturechange",this.#y,{passive:!1}),C.addEventListener("gestureend",this.#T,{passive:!1}),C.addEventListener("dblclick",this.#k),C.addEventListener("contextmenu",this.#P),C.addEventListener("keydown",this.#w),C.addEventListener("keyup",this.#R),C.addEventListener("blur",this.#O)}#M=C=>{if(this.#s||!C.isPrimary&&C.pointerType==="mouse"||S1(C))return;this.#C.focus({preventScroll:!0}),this.#_();let H=performance.now(),V={id:C.pointerId,type:C.pointerType,startX:C.clientX,startY:C.clientY,x:C.clientX,y:C.clientY,lastX:C.clientX,lastY:C.clientY,lastTime:H,velocityX:0,velocityY:0};if(this.#t.set(C.pointerId,V),this.#C.setPointerCapture?.(C.pointerId),this.#t.size>=2){this.#b(),(this.#L==="paint"||this.#L==="erase")&&(this.#i=U2(this.#a),this.#V.onCircles(this.#i,!1)),this.#L="pinch",this.#C.classList.add("navigating"),this.#m=!0;let[o,M]=[...this.#t.values()];o&&M&&(this.#e=Math.max(1,X3(o,M)),this.#h=Y3(o,M),this.#f=j3(o,M),this.#u=this.#H.camera),C.preventDefault();return}let e=this.#V.state(),r=e.workflow==="draw"&&e.map.available&&!e.floor.readOnly;this.#m||this.#r||C.button===1||C.button===2||e.draw.tool==="pan"?(this.#L="pan",this.#d=this.#H.camera):r&&(e.draw.tool==="paint"||e.draw.tool==="erase")?(this.#a=U2(e.draw.circles),this.#i=U2(e.draw.circles),C.pointerType==="touch"?(this.#L="idle",this.#S=window.setTimeout(()=>{if(this.#S=null,this.#t.size!==1||this.#m)return;this.#L=e.draw.tool;let o=this.#t.get(C.pointerId);o&&this.#A(o.x,o.y)},110)):(this.#L=e.draw.tool,this.#A(C.clientX,C.clientY))):(this.#L=e.view==="three"&&!C.shiftKey?"orbit":"pan",this.#d=this.#H.camera),(this.#L==="pan"||this.#L==="orbit")&&this.#C.classList.add("navigating"),C.preventDefault()};#x=C=>{let H=this.#t.get(C.pointerId);if(!H){let a=this.#H.screenToMap(C.clientX,C.clientY);this.#H.setCursor(a);return}let e=(C.getCoalescedEvents?.()||[]).at(-1)||C,r=performance.now(),t=Math.max(1,r-H.lastTime),o=(e.clientX-H.lastX)/t,M=(e.clientY-H.lastY)/t;if(H.velocityX=H.velocityX*.62+o*.38,H.velocityY=H.velocityY*.62+M*.38,H.lastX=e.clientX,H.lastY=e.clientY,H.lastTime=r,H.x=e.clientX,H.y=e.clientY,this.#L==="pinch"&&this.#t.size>=2){let[a,n]=[...this.#t.values()];if(!a||!n)return;let A=Math.max(1,X3(a,n)),s=Y3(a,n),p=j3(a,n),u=this.#u;if(u&&this.#h){let h={...u,distance:u.distance*this.#e/A,yaw:u.yaw+s7(p-this.#f),pitch:u.orthographic?u.pitch:u.pitch-(s.y-this.#h.y)*.0035};this.#H.setCamera(this.#H.cameraAfterPan(h,s.x-this.#h.x,s.y-this.#h.y))}C.preventDefault();return}this.#L==="paint"||this.#L==="erase"?this.#A(C.clientX,C.clientY):this.#L==="pan"?this.#d&&this.#H.setCamera(this.#H.cameraAfterPan(this.#d,e.clientX-H.startX,e.clientY-H.startY)):this.#L==="orbit"&&this.#d&&this.#H.setCamera({...this.#d,yaw:this.#d.yaw+(e.clientX-H.startX)*.0045,pitch:this.#d.pitch-(e.clientY-H.startY)*.004});let i=this.#H.screenToMap(e.clientX,e.clientY);this.#H.setCursor(i),C.preventDefault()};#v=C=>{let H=this.#t.get(C.pointerId);if(!H)return;let V=this.#L;if(this.#t.delete(C.pointerId),this.#C.releasePointerCapture?.(C.pointerId),this.#b(),(this.#L==="paint"||this.#L==="erase")&&JSON.stringify(this.#i)!==JSON.stringify(this.#a))this.#V.onCircles(this.#i,!0,this.#a);else if(this.#L!=="pinch"&&!this.#m&&Math.hypot(H.x-H.startX,H.y-H.startY)<7&&this.#V.state().workflow==="rooms"){let e=this.#H.roomAt(H.x,H.y);e&&this.#V.onRoom(e)}if(this.#t.size===0)this.#L="idle",this.#C.classList.remove("navigating"),this.#m=!1,this.#h=null,this.#u=null,this.#d=null,this.#l=null,(V==="pan"||V==="orbit")&&H.type!=="mouse"&&this.#B(H.velocityX,H.velocityY,V);else if(this.#L==="pinch"){this.#L="pan",this.#m=!0;let e=this.#t.values().next().value;e&&(e.startX=e.x,e.startY=e.y,e.velocityX=0,e.velocityY=0),this.#d=this.#H.camera,this.#u=null}C.preventDefault()};#A(C,H){let V=this.#H.screenToMap(C,H);if(!V)return;let r=this.#V.state().draw.brushMeters/2;if(this.#L==="erase")this.#i=this.#i.filter(t=>Math.hypot(t.x-V.x,t.y-V.y)>t.radius+r);else{if(!this.#H.containsMapPoint(V))return;let t=Math.max(.04,r*.55),o=this.#l||V,M=Math.hypot(V.x-o.x,V.y-o.y),i=Math.max(1,Math.ceil(M/t));for(let a=0;a<=i&&this.#i.length<512;a+=1){let n=a/i,A={x:o.x+(V.x-o.x)*n,y:o.y+(V.y-o.y)*n};this.#i.some(s=>Math.hypot(s.x-A.x,s.y-A.y)<Math.max(.025,r*.28))||this.#i.push({x:Math.round(A.x*1e4)/1e4,y:Math.round(A.y*1e4)/1e4,radius:Math.round(r*100)/100})}}this.#l=V,this.#V.onCircles(this.#i,!1)}#c=C=>{if(S1(C))return;C.preventDefault(),this.#C.focus({preventScroll:!0}),this.#_();let H=C.deltaMode===WheelEvent.DOM_DELTA_LINE?16:C.deltaMode===WheelEvent.DOM_DELTA_PAGE?Math.max(1,this.#C.clientHeight):1,V=C.deltaX*H,e=C.deltaY*H;if(C.ctrlKey||C.metaKey){this.#H.zoomAt(Math.exp(A1(-e*.008,-.28,.28)),C.clientX,C.clientY);return}if(C.altKey&&this.#V.state().view==="three"){this.#H.orbitBy(0,A1(e,-80,80)*.75);return}if(C.deltaMode!==WheelEvent.DOM_DELTA_PIXEL||Math.abs(V)<.5&&Math.abs(e)>=50){this.#H.zoomAt(Math.exp(A1(-e*.0025,-.28,.28)),C.clientX,C.clientY);return}this.#H.panBy(-A1(V,-80,80),-A1(e,-80,80))};#Z=C=>{this.#s||S1(C)||(this.#C.focus({preventScroll:!0}),this.#_(),this.#C.classList.add("navigating"),this.#n=this.#H.camera,this.#p=Number.isFinite(C.rotation)?C.rotation:0,C.preventDefault())};#y=C=>{if(this.#s||S1(C))return;let H=this.#n;if(!H||this.#t.size>=2)return;let V=Number.isFinite(C.scale)&&C.scale>0?Math.max(.1,C.scale):1,e=Number.isFinite(C.rotation)?C.rotation:0;this.#H.setCamera({...H,distance:H.distance/V,yaw:H.yaw+(e-this.#p)*Math.PI/180}),C.preventDefault()};#T=C=>{this.#n=null,this.#p=0,this.#C.classList.remove("navigating"),C.preventDefault()};#w=C=>{if(C.defaultPrevented||C.ctrlKey||C.metaKey||C.altKey)return;if(C.code==="Space"){this.#r=!0,C.preventDefault();return}this.#_();let H=this.#V.state(),V=C.key.toLocaleLowerCase();if(C.key==="+"||C.key==="=")this.#H.zoomAt(1.25);else if(C.key==="-")this.#H.zoomAt(.8);else if(C.key==="0")this.#H.fit();else if(V==="3")this.#g({type:"set-view",view:"three"});else if(V==="t")this.#g({type:"set-view",view:"top"});else if(C.key==="[")this.#H.orbitBy(-40,0);else if(C.key==="]")this.#H.orbitBy(40,0);else if(C.key==="PageUp")this.#H.orbitBy(0,-30);else if(C.key==="PageDown")this.#H.orbitBy(0,30);else if(V==="d"&&H.workflow==="draw")this.#g({type:"set-draw-tool",tool:"paint"});else if(V==="e"&&H.workflow==="draw")this.#g({type:"set-draw-tool",tool:"erase"});else if(["arrowleft","arrowright","arrowup","arrowdown"].includes(V))if(H.view==="three"&&!C.shiftKey){let e=V==="arrowleft"?-24:V==="arrowright"?24:0,r=V==="arrowup"?-20:V==="arrowdown"?20:0;this.#H.orbitBy(e,r)}else{let e=V==="arrowleft"?30:V==="arrowright"?-30:0,r=V==="arrowup"?30:V==="arrowdown"?-30:0;this.#H.panBy(e,r)}else if(H.workflow!=="draw"&&["w","a","s","d"].includes(V))this.#H.panBy(V==="a"?34:V==="d"?-34:0,V==="w"?34:V==="s"?-34:0);else if(H.workflow!=="draw"&&(V==="q"||V==="e"))this.#H.orbitBy(V==="q"?-30:30,0);else return;C.preventDefault()};#R=C=>{C.code==="Space"&&(this.#r=!1)};#O=()=>{this.#r=!1,this.#b(),this.#H.setCursor(null),this.#C.classList.remove("navigating")};#k=C=>{S1(C)||(this.#_(),this.#H.zoomAt(C.shiftKey?1/1.6:1.6,C.clientX,C.clientY),C.preventDefault())};#P=C=>{S1(C)||C.preventDefault()};#g(C){this.#C.dispatchEvent(new CustomEvent("matic-workspace-intent",{detail:C,bubbles:!0,composed:!0}))}#B(C,H,V){if(window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;let e=A1(C,-.55,.55),r=A1(H,-.55,.55);if(Math.hypot(e,r)<.02)return;let t=performance.now(),o=M=>{let i=Math.min(32,M-t);t=M,V==="orbit"?this.#H.orbitBy(e*i,r*i):this.#H.panBy(e*i,r*i);let a=.9**(i/16);e*=a,r*=a,Math.hypot(e,r)>=.01?this.#o=window.requestAnimationFrame(o):this.#o=null};this.#o=window.requestAnimationFrame(o)}#_(){this.#o!==null&&window.cancelAnimationFrame(this.#o),this.#o=null}#b(){this.#S!==null&&window.clearTimeout(this.#S),this.#S=null}dispose(){this.#s||(this.#s=!0,this.#b(),this.#_(),this.#C.removeEventListener("pointerdown",this.#M),this.#C.removeEventListener("pointermove",this.#x),this.#C.removeEventListener("pointerup",this.#v),this.#C.removeEventListener("pointercancel",this.#v),this.#C.removeEventListener("wheel",this.#c),this.#C.removeEventListener("gesturestart",this.#Z),this.#C.removeEventListener("gesturechange",this.#y),this.#C.removeEventListener("gestureend",this.#T),this.#C.removeEventListener("dblclick",this.#k),this.#C.removeEventListener("contextmenu",this.#P),this.#C.removeEventListener("keydown",this.#w),this.#C.removeEventListener("keyup",this.#R),this.#C.removeEventListener("blur",this.#O),this.#t.clear())}};var _=(L,C,H)=>Math.max(C,Math.min(H,L)),E1=L=>{let C=L;for(;C>Math.PI;)C-=Math.PI*2;for(;C<-Math.PI;)C+=Math.PI*2;return C},p7=L=>{switch(L){case"efficient":return .35;case"balanced":return .65;case"maximum":case"auto":return 1}},m7={accent:[6,120,206],onAccent:[255,255,255],text:[38,50,56],quiet:[75,92,105],plate:[250,252,253],roomFill:[231,238,242],forced:!1},C0=Math.PI/3.15,v7=1.08,c7=(L,C)=>{let H=C0/2,V=Math.atan(Math.tan(H)*Math.max(.2,C));return L/Math.sin(Math.min(H,V))*v7},u7=(L,C)=>{let H=new Float32Array(16);for(let V=0;V<4;V+=1)for(let e=0;e<4;e+=1){let r=0;for(let t=0;t<4;t+=1)r+=(L[t*4+e]??0)*(C[V*4+t]??0);H[V*4+e]=r}return H},x7=(L,C,H,V)=>{let e=1/Math.tan(L/2),r=new Float32Array(16);return r[0]=e/C,r[5]=e,r[10]=(V+H)/(H-V),r[11]=-1,r[14]=2*V*H/(H-V),r},Z7=(L,C,H,V,e,r)=>{let t=new Float32Array(16);return t[0]=2/(C-L),t[5]=2/(V-H),t[10]=-2/(r-e),t[12]=-(C+L)/(C-L),t[13]=-(V+H)/(V-H),t[14]=-(r+e)/(r-e),t[15]=1,t},h7=(L,C)=>{let H=Math.hypot((L[0]??0)-(C[0]??0),(L[1]??0)-(C[1]??0),(L[2]??0)-(C[2]??0))||1,V=[((L[0]??0)-(C[0]??0))/H,((L[1]??0)-(C[1]??0))/H,((L[2]??0)-(C[2]??0))/H],e=Math.hypot(V[2]??0,V[0]??0)||1,r=[(V[2]??0)/e,0,-(V[0]??0)/e],t=[(V[1]??0)*(r[2]??0),(V[2]??0)*(r[0]??0)-(V[0]??0)*(r[2]??0),-(V[1]??0)*(r[0]??0)];return new Float32Array([r[0]??0,t[0]??0,V[0]??0,0,r[1]??0,t[1]??0,V[1]??0,0,r[2]??0,t[2]??0,V[2]??0,0,-((r[0]??0)*(L[0]??0)+(r[1]??0)*(L[1]??0)+(r[2]??0)*(L[2]??0)),-((t[0]??0)*(L[0]??0)+(t[1]??0)*(L[1]??0)+(t[2]??0)*(L[2]??0)),-((V[0]??0)*(L[0]??0)+(V[1]??0)*(L[1]??0)+(V[2]??0)*(L[2]??0)),1])},J3=(L,C,H)=>{let V=!1,e=H.at(-1);if(!e)return!1;for(let r of H){let[t,o]=r,[M,i]=e;o>C!=i>C&&L<(M-t)*(C-o)/(i-o)+t&&(V=!V),e=r}return V},H2=class{#C;#H;#V;#t=null;#r=null;#L=null;#a=null;#i=null;#l=null;#e=null;#h=null;#f=null;#u=null;#d=null;#n=null;#p=null;#o=null;#m=null;#S=null;#s;#M={yaw:-Math.PI/4,pitch:.82,distance:12,targetX:0,targetZ:0,orthographic:!1};#x=12;#v=8;#A=4;#c=new Float32Array(16);#Z=null;#y="unavailable";#T=0;#w=0;#R=0;#O=0;#k=1;#P={width:1,height:1,left:0,top:0};#g=!0;#B=!1;#_=m7;constructor(C,H,V={}){this.#C=C,this.#H=H,this.#V=V,this.#r=H.getContext("2d",{alpha:!0}),this.#C.addEventListener("webglcontextlost",this.#r1),this.#C.addEventListener("webglcontextrestored",this.#t1),this.#W(),this.#s=new ResizeObserver(()=>{let e=this.#x,r=this.#v;this.#N(),this.#g&&(e!==this.#x||r!==this.#v)?this.fit(!1):this.requestRender()}),this.#s.observe(C)}get camera(){return{...this.#M}}#b(){return{minimum:Math.max(.2,this.#A*.04),maximum:this.#A*8}}#I(){let C=this.#o?.metadata.span,H=this.#o?.metadata.metersPerCell;return!C||H===void 0?{x:this.#A,z:this.#A}:{x:Math.max(.5,C[0]*H*.55),z:Math.max(.5,C[1]*H*.55)}}setCamera(C,H=!0){let V=this.#b(),e=this.#I();this.#M={yaw:E1(C.yaw),pitch:C.orthographic?Math.PI/2-.018:_(C.pitch,.18,1.38),distance:_(C.distance,V.minimum,V.maximum),targetX:_(C.targetX,-e.x,e.x),targetZ:_(C.targetZ,-e.z,e.z),orthographic:C.orthographic},this.#g=!1,this.requestRender(),H&&this.#q()}cameraAfterPan(C,H,V){let e=this.#E(),r=C.distance*1.75/Math.max(200,e.height),t=Math.cos(C.yaw),o=-Math.sin(C.yaw),M=-Math.sin(C.yaw),i=-Math.cos(C.yaw),a=this.#I();return{...C,targetX:_(C.targetX-H*r*t+V*r*M,-a.x,a.x),targetZ:_(C.targetZ-H*r*o+V*r*i,-a.z,a.z)}}setState(C){if(this.#B)return;let H=this.#p;this.#p=C;let V=C.resources.scene.value;V!==this.#o&&(this.#o=V,this.#V1(V)),(!H||H.quality!==C.quality)&&(this.#k=p7(C.quality),this.#O=0);let e=H?.workflow!=="draw"&&C.workflow==="draw",r=H?.workflow==="draw"&&C.workflow!=="draw";if(!H||H.view!==C.view||e||r){let t=C.workflow==="draw"?"top":C.view;this.#M=this.#C1(t,C),this.#g=this.#H1(t,C)}C.workflow==="draw"&&H?.draw.zoomPercent!==C.draw.zoomPercent&&(this.#M={...this.#M,orthographic:!0,pitch:Math.PI/2-.018,distance:this.#v*100/C.draw.zoomPercent},this.#g=C.draw.zoomPercent===100&&Math.abs(this.#M.targetX)<.001&&Math.abs(this.#M.targetZ)<.001&&Math.abs(E1(this.#M.yaw))<.001),this.requestRender()}#C1(C,H){let V=C==="top",e=V?this.#v:this.#x,r=H.cameras[C];return r?{yaw:r.yaw,pitch:V?Math.PI/2-.018:r.pitch,distance:_(e/_(r.zoom,.01,100),Math.max(.2,this.#A*.04),this.#A*8),targetX:_(r.targetX,-this.#A,this.#A),targetZ:_(r.targetZ,-this.#A,this.#A),orthographic:V}:V?{yaw:0,pitch:Math.PI/2-.018,distance:e,targetX:0,targetZ:0,orthographic:!0}:{yaw:-Math.PI/4,pitch:.82,distance:e,targetX:0,targetZ:0,orthographic:!1}}#H1(C,H){let V=H.cameras[C];if(!V)return!0;let e=C==="top";return Math.abs(V.zoom-1)<.001&&Math.abs(V.targetX)<.001&&Math.abs(V.targetZ)<.001&&Math.abs(E1(V.yaw-(e?0:-Math.PI/4)))<.001&&(e||Math.abs(V.pitch-.82)<.001)}#K(C,H){let V=this.#t;if(!V)throw new Error("webgl-unavailable");let e=V.createShader(C);if(!e)throw new Error("shader-unavailable");if(V.shaderSource(e,H),V.compileShader(e),!V.getShaderParameter(e,V.COMPILE_STATUS))throw V.deleteShader(e),new Error("shader-failed");return e}#W(){try{this.#t=this.#C.getContext("webgl2",{alpha:!0,antialias:!0,depth:!0,powerPreference:"high-performance"});let C=this.#t;if(!C)throw new Error("webgl2-unavailable");let H=this.#K(C.VERTEX_SHADER,`#version 300 es
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
      `),V=this.#K(C.FRAGMENT_SHADER,`#version 300 es
        precision highp float;
        in vec3 vColor;
        out vec4 outColor;
        void main() {
          vec2 point = gl_PointCoord * 2.0 - 1.0;
          if (dot(point, point) > 1.0) discard;
          float edge = smoothstep(1.0, 0.72, dot(point, point));
          outColor = vec4(pow(vColor, vec3(0.94)), edge);
        }
      `),e=C.createProgram();if(!e)throw new Error("program-unavailable");if(C.attachShader(e,H),C.attachShader(e,V),C.linkProgram(e),C.deleteShader(H),C.deleteShader(V),!C.getProgramParameter(e,C.LINK_STATUS))throw new Error("program-failed");this.#i=e,this.#h=C.getUniformLocation(e,"uViewProjection"),this.#f=C.getUniformLocation(e,"uCenter"),this.#u=C.getUniformLocation(e,"uMetersPerCell"),this.#d=C.getUniformLocation(e,"uPointPixels"),this.#n=C.getUniformLocation(e,"uMaxPointPixels"),this.#l=C.createBuffer(),this.#e=C.createVertexArray(),C.bindVertexArray(this.#e),C.bindBuffer(C.ARRAY_BUFFER,this.#l),C.enableVertexAttribArray(0),C.vertexAttribIPointer(0,2,C.UNSIGNED_SHORT,8,0),C.enableVertexAttribArray(1),C.vertexAttribIPointer(1,1,C.UNSIGNED_BYTE,8,4),C.enableVertexAttribArray(2),C.vertexAttribPointer(2,3,C.UNSIGNED_BYTE,!0,8,5),C.bindVertexArray(null),C.enable(C.DEPTH_TEST),C.depthFunc(C.LEQUAL),C.enable(C.BLEND),C.blendFunc(C.SRC_ALPHA,C.ONE_MINUS_SRC_ALPHA),this.#y="webgl2",this.#T+=1,this.#o&&this.#X(this.#o)}catch{this.#J(),this.#Y()}}#V1(C){if(this.#z(),!C){this.#w=0,this.requestRender();return}let[H,V]=C.metadata.span,e=C.metadata.metersPerCell,r=H*e,t=V*e;this.#A=Math.max(1,Math.hypot(r,t)/2),this.#N(),this.fit(!1),this.#y==="webgl2"?this.#X(C):this.#F(C)}#N(){let C=this.#o;if(!C)return;let[H,V]=C.metadata.span,e=C.metadata.metersPerCell,r=H*e,t=V*e,o=this.#E(),M=Math.max(.2,o.width/Math.max(1,o.height));this.#x=c7(this.#A,M),this.#v=Math.max(t/2,r/(2*M))*1.12}#X(C){let H=this.#t;if(!H||!this.#l)return;let V=new Uint8Array(C.buffer,C.pointOffset,C.total*8);H.bindBuffer(H.ARRAY_BUFFER,this.#l),H.bufferData(H.ARRAY_BUFFER,V,H.STATIC_DRAW),this.#w=C.total}#Y(){this.#y="canvas2d",this.#a=document.createElement("canvas"),this.#a.width=1024,this.#a.height=1024,this.#L=this.#a.getContext("2d",{alpha:!0}),this.#L?this.#o&&this.#F(this.#o):(this.#y="unavailable",this.#V.onProblem?.("renderer-unavailable"))}#F(C){let H=this.#L;if(!H||!this.#a)return;H.clearRect(0,0,this.#a.width,this.#a.height);let V=new DataView(C.buffer,C.pointOffset,C.total*8),e=Math.min(C.total,5e4),r=Math.max(1,Math.ceil(C.total/e)),t=0,o=0,M=()=>{if(this.#B||C!==this.#o||!this.#a)return;let i=Math.min(C.total,t+r*4e3);for(;t<i;t+=r){let a=t*8,n=V.getUint16(a,!0)/Math.max(1,C.metadata.span[0])*this.#a.width,A=V.getUint16(a+2,!0)/Math.max(1,C.metadata.span[1])*this.#a.height,s=V.getUint8(a+5),p=V.getUint8(a+6),u=V.getUint8(a+7);H.fillStyle=`rgb(${s} ${p} ${u})`,H.fillRect(n,A,1.5,1.5),o+=1}this.#w=o,this.requestRender(),t<C.total?this.#S=window.setTimeout(M,0):this.#S=null};M()}#z(){this.#S!==null&&window.clearTimeout(this.#S),this.#S=null}#E(){let C=this.#C.getBoundingClientRect();return this.#P={width:C.width,height:C.height,left:C.left,top:C.top},this.#P}#D(){let C=this.#E(),H=Math.min(window.devicePixelRatio||1,3),V=Math.max(1,Math.round(C.width*H)),e=Math.max(1,Math.round(C.height*H));for(let r of[this.#C,this.#H])(r.width!==V||r.height!==e)&&(r.width=V,r.height=e)}#U(){let C=this.#P,H=Math.max(.2,C.width/Math.max(1,C.height)),V=Math.cos(this.#M.pitch)*this.#M.distance,e=[this.#M.targetX+Math.sin(this.#M.yaw)*V,Math.sin(this.#M.pitch)*this.#M.distance,this.#M.targetZ+Math.cos(this.#M.yaw)*V],r=[this.#M.targetX,0,this.#M.targetZ],t=h7(e,r),o=this.#M.orthographic?Z7(-this.#M.distance*H,this.#M.distance*H,-this.#M.distance,this.#M.distance,-this.#A*4,this.#A*4):x7(C0,H,.02,Math.max(60,this.#A*12));return u7(o,t)}requestRender(){this.#m!==null||this.#B||(this.#m=window.requestAnimationFrame(()=>{this.#m=null,this.#G()}))}#G(){let C=performance.now();this.#D(),this.#c=this.#U(),this.#y==="webgl2"?this.#L1():this.#e1(),this.#M1(),this.#R=performance.now()-C,this.#R>18?(this.#O+=1,this.#O>=3&&this.#p?.quality==="auto"&&(this.#k=Math.max(.25,this.#k*.75))):this.#O=Math.max(0,this.#O-1)}#L1(){let C=this.#t,H=this.#o;if(!C||(C.viewport(0,0,this.#C.width,this.#C.height),C.clearColor(0,0,0,0),C.clear(C.COLOR_BUFFER_BIT|C.DEPTH_BUFFER_BIT),!H||!this.#i||!this.#e))return;if(this.#p?.view==="top"&&this.#p.appearance==="rooms"){this.#w=0;return}C.useProgram(this.#i),C.bindVertexArray(this.#e),C.uniformMatrix4fv(this.#h,!1,this.#c),C.uniform2f(this.#f,(H.metadata.span[0]-1)/2,(H.metadata.span[1]-1)/2),C.uniform1f(this.#u,H.metadata.metersPerCell);let V=Math.min(window.devicePixelRatio||1,3),e=Math.max(1,Math.floor(H.total*this.#k)),r=Math.min(H.floorCount,e),t=Math.min(H.surfaceCount,Math.max(0,e-r));C.uniform1f(this.#d,this.#C.height*.038),C.uniform1f(this.#n,4.5*V),C.drawArrays(C.POINTS,0,r),C.uniform1f(this.#d,this.#C.height*.05),C.uniform1f(this.#n,7*V),C.drawArrays(C.POINTS,H.floorCount,t),C.bindVertexArray(null),this.#w=r+t}#e1(){}#j(C,H,V=0){let e=this.#o;return e?[-(C-(e.metadata.span[0]-1)/2)*e.metadata.metersPerCell,V*e.metadata.metersPerCell,(H-(e.metadata.span[1]-1)/2)*e.metadata.metersPerCell]:null}#Q(C,H,V=0,e=!0){let r=this.#j(C,H,V);if(!r)return null;let[t,o,M]=r,i=this.#c,a=(i[0]??0)*t+(i[4]??0)*o+(i[8]??0)*M+(i[12]??0),n=(i[1]??0)*t+(i[5]??0)*o+(i[9]??0)*M+(i[13]??0),A=(i[3]??0)*t+(i[7]??0)*o+(i[11]??0)*M+(i[15]??0);if(A<=.001)return null;let s=a/A,p=n/A;if(!Number.isFinite(s)||!Number.isFinite(p)||e&&(Math.abs(s)>1.15||Math.abs(p)>1.15))return null;let u=this.#P;return{x:(s*.5+.5)*u.width,y:(-p*.5+.5)*u.height}}#$(C,H,V=0){let e=this.#o;if(!e)return null;let r=C/e.metadata.metersPerCell-e.metadata.origin[0],t=H/e.metadata.metersPerCell-e.metadata.origin[1];return this.#Q(r,t,V)}#M1(){let C=this.#r,H=this.#o,V=this.#p;if(!C)return;let e=Math.min(window.devicePixelRatio||1,3),r=this.#P;if(C.setTransform(e,0,0,e,0,0),C.clearRect(0,0,r.width,r.height),!H||!V)return;let t=this.#_;if(this.#y==="canvas2d"&&this.#a&&!(V.view==="top"&&V.appearance==="rooms")){let a=this.#v/this.#M.distance,n=r.width*a,A=r.height*a,s=(r.width-n)/2-this.#M.targetX*32*a,p=(r.height-A)/2-this.#M.targetZ*32*a;C.drawImage(this.#a,s,p,n,A)}let o=this.#o1(V);if(V.labelsVisible||V.view==="top"&&V.appearance==="rooms"){C.lineWidth=1.5,C.font="600 12px system-ui, sans-serif",C.textAlign="center",C.textBaseline="middle";let a=[];for(let n of H.metadata.rooms){let A=o.has(n.name.toLocaleLowerCase());C.strokeStyle=A?B(t.accent,1):B(t.quiet,.7),C.fillStyle=A?B(t.accent,.26):V.view==="top"&&V.appearance==="rooms"?B(t.roomFill,.94):B(t.plate,.04),C.beginPath();let s=Math.max(1,Math.ceil(n.boundary.length/512)),p=!1;for(let f=0;f<n.boundary.length;f+=s){let S=n.boundary[f];if(!S)continue;let g=this.#Q(S[0],S[1],.2,!1);g&&(p?C.lineTo(g.x,g.y):C.moveTo(g.x,g.y),p=!0)}if(p&&(C.closePath(),C.fill(),C.stroke()),!V.labelsVisible)continue;let u=this.#Q(n.center[0],n.center[1],1);if(!u)continue;let h=C.measureText(n.name).width,x=new DOMRect(u.x-h/2-6,u.y-10,h+12,20);a.some(f=>x.left<f.right+8&&x.right+8>f.left&&x.top<f.bottom+4&&x.bottom+4>f.top)||(a.push(x),C.fillStyle=B(t.plate,.88),C.fillRect(x.x,x.y,x.width,x.height),C.fillStyle=B(t.text,1),C.fillText(n.name,u.x,u.y))}}let M=V.draw.circles;if((V.workflow==="draw"||V.workflow==="areaReview")&&M.length){C.fillStyle=B(t.accent,.22),C.strokeStyle=B(t.accent,.92),C.lineWidth=1.5;for(let a of M)this.#i1(C,a)}if(this.#Z&&V.workflow==="draw"&&V.draw.tool!=="pan"){let a=this.#$(this.#Z.x,this.#Z.y),n=this.#$(this.#Z.x+V.draw.brushMeters/2,this.#Z.y);a&&n&&(C.beginPath(),C.arc(a.x,a.y,Math.max(2,Math.hypot(n.x-a.x,n.y-a.y)),0,Math.PI*2),C.strokeStyle=B(t.accent,1),C.lineWidth=2,C.stroke())}let i=V.resources.pose.value;if(V.map.exactPose&&i?.position&&V.dataMode==="live"){let a=this.#$(i.position[0],i.position[1],3);a&&(C.beginPath(),C.arc(a.x,a.y,7,0,Math.PI*2),C.fillStyle=B(t.accent,1),C.fill(),C.strokeStyle=B(t.onAccent,1),C.lineWidth=3,C.stroke())}}#o1(C){let H=C.resources.plans.value?.rooms||C.resources.areas.value?.rooms||[];return new Set(H.filter(V=>C.selection.roomIds.includes(V.roomId)).map(V=>V.name.toLocaleLowerCase()))}#i1(C,H){let V=this.#$(H.x,H.y),e=this.#$(H.x+H.radius,H.y);!V||!e||(C.beginPath(),C.arc(V.x,V.y,Math.max(1,Math.hypot(e.x-V.x,e.y-V.y)),0,Math.PI*2),C.fill(),C.stroke())}setPalette(C){this.#_=C,this.requestRender()}setCursor(C){this.#Z=C,this.requestRender()}screenToMap(C,H){let V=this.#o;if(!V||!this.#M.orthographic)return null;let e=this.#E();if(!e.width||!e.height)return null;let r=this.#M.distance*2/e.height,t=this.#M.targetX+(C-e.left-e.width/2)*r,o=this.#M.targetZ+(H-e.top-e.height/2)*r,M=-t/V.metadata.metersPerCell+(V.metadata.span[0]-1)/2,i=o/V.metadata.metersPerCell+(V.metadata.span[1]-1)/2;return{x:(M+V.metadata.origin[0])*V.metadata.metersPerCell,y:(i+V.metadata.origin[1])*V.metadata.metersPerCell}}roomAt(C,H){let V=this.screenToMap(C,H),e=this.#o,r=this.#p;if(!V||!e||!r)return null;let t=V.x/e.metadata.metersPerCell-e.metadata.origin[0],o=V.y/e.metadata.metersPerCell-e.metadata.origin[1],M=e.metadata.rooms.find(i=>J3(t,o,i.boundary));return M?this.#a1(M,r):null}containsMapPoint(C){let H=this.#o;if(!H)return!1;let V=C.x/H.metadata.metersPerCell-H.metadata.origin[0],e=C.y/H.metadata.metersPerCell-H.metadata.origin[1];return H.metadata.rooms.some(r=>J3(V,e,r.boundary))}#a1(C,H){return(H.resources.plans.value?.rooms||H.resources.areas.value?.rooms||[]).find(e=>e.name.localeCompare(C.name,void 0,{sensitivity:"base"})===0)?.roomId||C.id}selectRoomAt(C,H){let V=this.roomAt(C,H);V&&this.#V.onRoom?.(V)}fit(C=!0){let H=this.#p?.view==="top"||this.#p?.workflow==="draw";this.#M=H?{yaw:0,pitch:Math.PI/2-.018,distance:this.#v,targetX:0,targetZ:0,orthographic:!0}:{yaw:-Math.PI/4,pitch:.82,distance:this.#x,targetX:0,targetZ:0,orthographic:!1},this.#g=!0,this.requestRender(),C&&this.#q()}zoomAt(C,H,V){let e=H===void 0||V===void 0?null:this.screenToMap(H,V),r=this.#b();if(this.#M={...this.#M,distance:_(this.#M.distance/C,r.minimum,r.maximum)},this.#g=!1,e&&H!==void 0&&V!==void 0){let t=this.screenToMap(H,V);t&&(this.#M={...this.#M,targetX:this.#M.targetX-(e.x-t.x),targetZ:this.#M.targetZ+(e.y-t.y)})}this.requestRender(),this.#q(H,V)}panBy(C,H){this.setCamera(this.cameraAfterPan(this.#M,C,H))}orbitBy(C,H){if(this.#M.orthographic){this.panBy(C,H);return}this.#M={...this.#M,yaw:E1(this.#M.yaw+C*.006),pitch:_(this.#M.pitch-H*.004,.18,1.38)},this.#g=!1,this.requestRender(),this.#q()}rotateBy(C){this.#M={...this.#M,yaw:E1(this.#M.yaw+C)},this.#g=!1,this.requestRender(),this.#q()}#q(C,H){let V=this.#M.orthographic?this.#v:this.#x,e=C===void 0||H===void 0?this.#P:this.#E(),r=C===void 0||H===void 0||!e.width||!e.height?void 0:{xPercent:_((C-e.left)/e.width*100,0,100),yPercent:_((H-e.top)/e.height*100,0,100)};this.#V.onCamera?.(this.camera,Math.round(V/this.#M.distance*100),r)}diagnostics(){return{mode:this.#y,contextGeneration:this.#T,sceneRevision:this.#o?.revision??null,sourcePoints:this.#o?.total??0,renderedPoints:this.#w,lastFrameMs:Math.round(this.#R*100)/100,slowFrames:this.#O,cameraDistance:this.#M.distance,fitDistance:this.#M.orthographic?this.#v:this.#x,fitActive:this.#g}}#r1=C=>{C.preventDefault(),this.#J(),this.#Y(),this.requestRender()};#t1=()=>{this.#J(),this.#W(),this.requestRender()};#J(){let C=this.#t;C&&(this.#l&&C.deleteBuffer(this.#l),this.#e&&C.deleteVertexArray(this.#e),this.#i&&C.deleteProgram(this.#i)),this.#l=null,this.#e=null,this.#i=null,this.#t=null}dispose(){this.#B||(this.#B=!0,this.#s.disconnect(),this.#C.removeEventListener("webglcontextlost",this.#r1),this.#C.removeEventListener("webglcontextrestored",this.#t1),this.#m!==null&&window.cancelAnimationFrame(this.#m),this.#m=null,this.#z(),this.#J(),this.#a=null,this.#L=null,this.#r=null,this.#o=null,this.#p=null)}};var H0="component.matic_robot.common.",T=(L,C,H,V)=>{let e=V?{...V}:void 0,r=L?.(`${H0}${C}`,e);return r&&r!==`${H0}${C}`?r:V?Object.entries(V).reduce((t,[o,M])=>t.replaceAll(`{${o}}`,String(M)),H):H};var H1="matic-workspace-intent",V2="matic-workspace-action",V0="navigation-help",L0=(L,C)=>{let H=(e,r,t)=>T(C,e,r,t);if(L.dataMode==="history")return L.map.available?H("v4_saved_map_description","Saved read-only map for {floor}. Live robot position is hidden.",{floor:L.floor.displayName}):L.resources.scene.status==="loading"?H("v4_saved_map_loading_description","The saved map is loading."):H("v4_saved_map_unavailable_description","This saved map is unavailable.");if(!c1(L))return H("v4_private_map_unavailable","The current private map is not available.");let V=A5(L)?H("v4_robot_position_verified","The robot position is verified."):H("v4_robot_position_hidden","The robot position is not shown.");return H("v4_live_map_description","Live map for {floor}. {pose}",{floor:L.floor.displayName,pose:V})},G2=class extends O{constructor(){super();this.state=k();this.narrow=!1;this.#C=null;this.#H=null;this.#V=null;this.#t=!1;this.#r=!1;this.#L=null;this.#a=[];this.#i=null;this.#l=null;this.#d=()=>{this.#f()};new J1(this,{container:()=>this.renderRoot?.querySelector(".camera-steps")??null,items:"button"})}static{this.properties={state:{attribute:!1},localize:{attribute:!1},narrow:{type:Boolean,reflect:!0}}}static{this.styles=[D,$,C1,b`
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
      inset: calc((100% - var(--map-sheet-offset, 0px)) / 2) auto auto 50%;
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

/* Four labelled buttons span most of the map at desktop width; icons with tooltips keep the rail a narrow column. */
.map-tools .ms-btn__label { position: absolute; overflow: hidden; inline-size: 1px; block-size: 1px; margin: -1px; padding: 0; border: 0; clip-path: inset(50%); white-space: nowrap; }
@container (max-width: 29rem) {
.map-tools button, .map-dock .draw-tools button { padding-inline: 0; inline-size: var(--ms-control); }
/* Collapse the label to assistive text, never display:none. Hiding it would
   delete the accessible name and break every getByRole({ name }) query at
   narrow widths -- which is what the previous font-size:0 plus ::first-letter
   trick did, while also rendering the toolbar as "P E M U R D". */
.map-dock .draw-tools .ms-btn__label { position: absolute; overflow: hidden; inline-size: 1px; block-size: 1px; margin: -1px; padding: 0; border: 0; clip-path: inset(50%); white-space: nowrap; }
}
@media (forced-colors: active) {
/* The map is painted to canvas, so the UA would otherwise invert it. The
   previous block here targeted the mock-map layer that the renderer replaced,
   which meant the map had no forced-colors treatment at all. */
.scene-canvas, .overlay-canvas { forced-color-adjust: none; }
.map-root { border: 1px solid CanvasText; }
}
  `]}#C;#H;#V;#t;#r;#L;#a;#i;#l;#e(H,V,e){return T(this.localize,H,V,e)}connectedCallback(){super.connectedCallback(),this.#n()}firstUpdated(){let H=this.renderRoot.querySelector(".map-root"),V=this.renderRoot.querySelector(".scene-canvas"),e=this.renderRoot.querySelector(".overlay-canvas");!H||!V||!e||(this.#H=new H2(V,e,{onCamera:(r,t,o)=>{this.#o({type:"set-camera",view:this.state.workflow==="draw"?"top":this.state.view,camera:{yaw:r.yaw,pitch:r.pitch,zoom:t/100,targetX:r.targetX,targetZ:r.targetZ}}),this.state.workflow==="draw"&&t!==this.state.draw.zoomPercent&&this.#o({type:"set-zoom",value:t,...o?{originX:o.xPercent,originY:o.yPercent}:{}})},onRoom:r=>this.#o({type:"toggle-room",roomId:r}),onProblem:()=>this.#m("renderer-problem")}),this.#V=new C2(H,this.#H,{state:()=>this.state,onCircles:(r,t,o)=>this.#o({type:"set-draft-circles",circles:r,record:t,...o?{previous:o}:{}}),onRoom:r=>this.#o({type:"toggle-room",roomId:r})}),this.#H.setState(this.state),this.#f())}disconnectedCallback(){this.#p(),this.#V?.dispose(),this.#V=null,this.#H?.dispose(),this.#H=null,super.disconnectedCallback()}updated(H){this.#r&&(this.#r=!1,this.renderRoot.querySelector(".navigation-help button")?.focus()),H.has("state")&&this.#H?.setState(this.state)}#h(){let H=this.renderRoot?.querySelector(".map-root");!H||!this.#H||this.#H.setPalette(K3(H))}#f(){this.#u(),this.#i=window.requestAnimationFrame(()=>{this.#i=null,this.#l=window.setTimeout(()=>{this.#l=null,this.#h()},0)})}#u(){this.#i!==null&&window.cancelAnimationFrame(this.#i),this.#l!==null&&window.clearTimeout(this.#l),this.#i=null,this.#l=null}#d;#n(){if(!(typeof document>"u"||this.#L)&&(this.#L=new MutationObserver(this.#d),this.#L.observe(document.documentElement,{attributes:!0,attributeFilter:["style","class"]}),typeof window.matchMedia=="function")){this.#a=[window.matchMedia("(prefers-color-scheme: dark)"),window.matchMedia("(forced-colors: active)")];for(let H of this.#a)H.addEventListener("change",this.#d)}}#p(){this.#u(),this.#L?.disconnect(),this.#L=null;for(let H of this.#a)H.removeEventListener("change",this.#d);this.#a=[]}#o(H){this.dispatchEvent(new CustomEvent(H1,{detail:H,bubbles:!0,composed:!0}))}#m(H){this.dispatchEvent(new CustomEvent(V2,{detail:{id:H},bubbles:!0,composed:!0}))}#S(H){this.#C=H.currentTarget,this.#t=!this.#t,this.#r=this.#t,this.requestUpdate()}#s(){if(!this.#t)return;this.#t=!1,this.requestUpdate();let H=this.#C;H?.isConnected&&H.focus()}#M(){for(let H of this.state.selection.roomIds)this.#o({type:"toggle-room",roomId:H})}#x(H,V){this.#H?.orbitBy(H,V)}#v(H){if(!(H.ctrlKey||H.metaKey||H.altKey)&&H.key==="Escape"){if(H.preventDefault(),this.#t){this.#s();return}this.#o({type:"dismiss-top-layer"});return}}rendererDiagnostics(){return this.#H?.diagnostics()??null}canvasIdentity(){return{scene:this.renderRoot.querySelector(".scene-canvas"),overlay:this.renderRoot.querySelector(".overlay-canvas")}}#A(){return this.state.host.connected?this.state.host.administrator?this.state.host.robotCount===0?{title:this.#e("v4_no_robot","No Matic robot set up"),detail:this.#e("v4_no_robot_detail","Set up a robot before opening its map.")}:this.state.dataMode==="history"?!this.state.map.available&&this.state.resources.scene.status==="loading"?{title:this.#e("v4_loading_saved_map","Loading saved map"),detail:this.#e("v4_loading_saved_map_detail","This read-only snapshot is still preparing.")}:this.state.map.available?null:{title:this.#e("v4_saved_map_unavailable","Saved map unavailable"),detail:this.#e("v4_saved_map_unavailable_detail","Choose another snapshot or return to the live map.")}:this.state.host.robotConnected?this.state.coherence==="verifying"||this.state.coherence==="booting"?{title:this.#e("v4_locating_map","Locating the current map"),detail:this.#e("v4_locating_map_detail","Map controls will return after the floor is verified.")}:!this.state.map.available&&this.state.resources.scene.status==="loading"?{title:this.#e("v4_loading_verified_map","Loading the verified map"),detail:this.#e("v4_loading_verified_map_detail","The current floor is verified. The private scene is still preparing.")}:this.state.map.available?this.state.activity==="problem"?{title:this.#e("v4_robot_attention","Robot needs attention"),detail:this.#e("v4_robot_attention_detail","Check the robot before starting another task.")}:null:{title:this.#e("v4_map_unavailable","Map unavailable"),detail:this.#e("v4_map_unavailable_detail","The private scene is not ready. No map data is shown until it is verified.")}:{title:this.#e("v4_robot_offline","Robot offline"),detail:this.#e("v4_robot_offline_detail","The last verified map stays read only and has no live position.")}:{title:this.#e("v4_admin_required","Administrator access required"),detail:this.#e("v4_private_map_hidden","Private map data is hidden.")}:{title:this.#e("v4_reconnecting","Reconnecting"),detail:this.#e("v4_reconnecting_detail","The verified map is read only until Home Assistant reconnects.")}}#c(H,V){let e=this.state,r=this.narrow,t=e.workflow==="draw",o=this.#e("v4_how_to_move","How to move the map"),M=H&&!t,i=M&&!r&&e.view==="top",a=M&&e.view==="three",n=!V,A=!r&&!t;return!M&&!n?l:d`
      <div class="map-rail" data-map-control>
        ${M?d`
          <div class="view-switch ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#e("map_view_label","Map view")}>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(e.view==="three")}
              @click=${()=>this.#o({type:"set-view",view:"three"})}
            >${this.#e("map_view_3d","3D")}</button>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(e.view==="top")}
              @click=${()=>this.#o({type:"set-view",view:"top"})}
            >${this.#e("map_view_top","2D")}</button>
          </div>
        `:l}

        ${i?d`
          <div class="appearance-switch ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#e("map_style_label","Map style")}>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(e.appearance==="photo")}
              @click=${()=>this.#o({type:"set-appearance",appearance:"photo"})}
            >${this.#e("map_style_photo","Photo")}</button>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(e.appearance==="rooms")}
              @click=${()=>this.#o({type:"set-appearance",appearance:"rooms"})}
            >${this.#e("map_style_room_colours","Floor plan")}</button>
          </div>
        `:l}

        ${a?d`
          <div class="camera-steps ms-surface ms-surface--floating ms-segment" role="toolbar" aria-orientation="horizontal" aria-label=${this.#e("map_camera_controls","Map camera controls")}>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#e("map_rotate_left","Rotate left")} aria-keyshortcuts="[" @click=${()=>this.#x(-52,0)}>${Z(k3)}</button>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#e("map_tilt_down","Lower viewing angle")} aria-keyshortcuts="PageDown" @click=${()=>this.#x(0,30)}>${Z(y3)}</button>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#e("map_tilt_up","Raise viewing angle")} aria-keyshortcuts="PageUp" @click=${()=>this.#x(0,-30)}>${Z(g3)}</button>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#e("map_rotate_right","Rotate right")} aria-keyshortcuts="]" @click=${()=>this.#x(52,0)}>${Z(P3)}</button>
          </div>
        `:l}

        ${n?d`
          <div class="map-tools ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#e("v4_map_tools","Map tools")}>
            ${V?l:d`
              <button
                class="fit ms-btn"
                type="button"
                aria-label=${this.#e("v4_fit_map_hint","Fit the whole map on screen")}
                @click=${()=>{this.#H?.fit(),this.#o({type:"fit-map"})}}
                title=${this.#e("v4_fit_map","Fit map")}
              >${Z(b3)}<span class="ms-btn__label">${this.#e("v4_fit_map","Fit map")}</span></button>
            `}
            ${!V&&A?d`
              <button
                class="labels ms-btn"
                type="button"
                aria-pressed=${String(e.labelsVisible)}
                @click=${()=>this.#o({type:"toggle-labels"})}
                title=${this.#e("v4_room_names","Room names")}
              >${Z(O3)}<span class="ms-btn__label">${this.#e("v4_room_names","Room names")}</span></button>
              <button
                class="help ms-btn ms-btn--icon"
                type="button"
                aria-label=${o}
                aria-expanded=${String(this.#t)}
                aria-controls=${V0}
                @click=${this.#S}
                title=${o}
              >${Z(w3)}</button>
            `:l}
          </div>
        `:l}

        ${this.#t&&H&&A?d`
          <div
            id=${V0}
            class="navigation-help ms-surface ms-surface--floating"
            role="dialog"
            aria-modal="false"
            aria-label=${o}
          >
            <header>
              <h3>${o}</h3>
              <button class="ms-btn ms-btn--sm" type="button" @click=${()=>this.#s()}>${this.#e("v4_close","Close")}</button>
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
    `}#Z(H){let V=this.state;if(!H)return l;if(V.workflow==="draw"&&!this.narrow)return d`
        <div class="map-dock ms-surface ms-surface--floating" data-map-control>
          ${j1(V,{intent:r=>this.#o(r),openBrush:()=>this.#o({type:"set-precision-open",value:!V.precisionOpen}),t:(r,t)=>this.#e(r,t)},"row")}
        </div>
      `;let e=V.selection.roomIds.length;return V.workflow==="rooms"&&e>0&&!this.narrow?d`
        <div class="map-dock ms-surface ms-surface--floating" data-map-control>
          <div class="selection-chip ms-surface ms-surface--floating" data-map-control>
            <span>${this.#e("v4_rooms_selected","{count} rooms selected").replace("{count}",String(e))}</span>
            <button class="ms-btn ms-btn--sm" type="button" @click=${()=>this.#M()}>${this.#e("v4_clear","Clear")}</button>
          </div>
        </div>
      `:l}render(){let H=this.state,V=p5(H),e=this.#A(),r=H.map.available&&(c1(H)||H.dataMode==="history"),t=H.workflow==="draw"&&r,o=H.coherence==="verifying"||H.coherence==="booting";return d`
      <section
        class="map-root"
        tabindex="0"
        aria-label=${this.#e("map_viewport_aria","Interactive Matic 3D map")}
        data-full-map=${String(H.fullMap)}
        data-workflow=${H.workflow}
        data-draw-tool=${H.draw.tool}
        data-narrow=${this.narrow?"true":l}
        @keydown=${this.#v}
      >
        ${this.#c(r,o)}

        <div
          class="scene-window"
          data-renderer-key="persistent-canvas-v4"
          ?hidden=${!r}
          role="img"
          aria-label=${L0(H,this.localize)}
        >
          <canvas class="scene-canvas"></canvas>
          <canvas class="overlay-canvas"></canvas>
        </div>

        ${t?d`
          <div class="map-scale" aria-label=${`Scale ${V.label}`}>
            <span class="scale-line" style=${`--scale-width:${V.pixels}px`}></span>
            <span>${V.label}</span>
          </div>
        `:l}

        ${this.#Z(r)}

        ${e&&!(H.fullMap&&(o||!H.host.administrator))?d`
          <div class="map-message ms-surface ms-surface--floating" role="status">
            <strong>${e.title}</strong>
            <span>${e.detail}</span>
          </div>
        `:l}
        <div class="sr-only" aria-live="polite" aria-atomic="true">
          ${L0(H,this.localize)}
        </div>
      </section>
    `}};customElements.get(i1)||customElements.define(i1,G2);var Q2=class extends O{constructor(){super(...arguments);this.state=k();this.compact=!1;this.inline=!1}static{this.properties={state:{attribute:!1},localize:{attribute:!1},compact:{type:Boolean,reflect:!0},inline:{type:Boolean,reflect:!0}}}static{this.styles=[D,$,C1,b`
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
`]}#C(H,V){return T(this.localize,H,V)}#H(H){this.dispatchEvent(new CustomEvent(H1,{detail:H,bubbles:!0,composed:!0}))}#V(H){let V=H.currentTarget.valueAsNumber;Number.isFinite(V)&&this.#H({type:"set-brush",value:V})}render(){let{draw:H}=this.state;return d`
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
    `}};customElements.get(F1)||customElements.define(F1,Q2);var q2=["vacuum","mop","vacuum_and_mop"],K2=["quick","standard","heavy_duty"],I=L=>L.currentTarget.value,e0=L=>L.currentTarget.checked,X2=class extends O{constructor(){super(...arguments);this.state=k();this._copyStatus="idle"}static{this.properties={state:{attribute:!1},localize:{attribute:!1},_copyStatus:{state:!0}}}static{this.styles=[D,$,C1,b`
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
.copy-status { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
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
.plan-option input { inline-size: 1.2rem; block-size: 1.2rem; margin: 0.1rem 0 0; accent-color: var(--ms-accent); }
.plan-option-copy, .plan-threshold-copy { display: grid; gap: var(--ms-space-1); min-inline-size: 0; }
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
.diagnostics { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--ms-space-2) var(--ms-space-3); margin: 0; font-size: var(--ms-t-xs); }
.diagnostics dt { color: var(--ms-text-quiet); }
.diagnostics dd { margin: 0; font-weight: var(--ms-w-medium); }
@media (max-width: 25rem) { .split { grid-template-columns: 1fr; } }
@container (max-width: 38rem) { .plan-meta { grid-template-columns: 1fr; } }
`]}#C;disconnectedCallback(){this.#C!==void 0&&clearTimeout(this.#C),this.#C=void 0,super.disconnectedCallback()}#H(H,V,e){return T(this.localize,H,V,e)}#V(H){return H==="vacuum"?this.#H("vacuum","Vacuum"):H==="mop"?this.#H("mop","Mop"):this.#H("vacuum_and_mop","Vacuum + mop")}#t(H){return H==="quick"?this.#H("quick","Quick"):H==="standard"?this.#H("standard","Optimal"):this.#H("heavy_duty","Heavy Duty")}#r(H){this.dispatchEvent(new CustomEvent(H1,{detail:H,bubbles:!0,composed:!0}))}#L(){return this.state.notice?d`
      <div class="notice" data-tone=${this.state.notice.tone} role=${this.state.notice.tone==="error"?"alert":"status"}>
        ${this.state.notice.text}
      </div>
    `:l}#a(){switch(this.state.workflow){case"rooms":case"plan":return{loading:this.#H("v4_loading_rooms_plans","Loading rooms and plans\u2026"),unavailable:this.#H("v4_rooms_plans_unavailable","Rooms and plans are unavailable right now."),empty:this.#H("v4_no_rooms_plans","No rooms or plans are available yet.")};case"draw":case"areaReview":return{loading:this.#H("v4_loading_areas","Loading saved areas\u2026"),unavailable:this.#H("v4_areas_unavailable","Saved areas are unavailable right now."),empty:this.#H("v4_no_saved_areas","No saved areas yet. Draw one on the map.")};case"history":return{loading:this.#H("v4_loading_history","Loading map history\u2026"),unavailable:this.#H("v4_history_unavailable","Map history is unavailable right now."),empty:this.#H("v4_no_map_history","No saved map snapshots yet.")};default:return{loading:this.#H("map_loading","Loading\u2026"),unavailable:this.#H("v4_workspace_unavailable","This workspace is unavailable right now."),empty:this.#H("v4_nothing_saved","Nothing saved yet.")}}}#i(H,V,e){let r=this.#a();if(H==="loading"||H==="idle")return d`<div class="loading" role="status">${r.loading}</div>`;if(H==="error"){let t=this.state.workflow;return d`
        <div class="stack">
          <div class="problem" role="alert">${r.unavailable} ${V==="request-failed"?this.#H("v4_try_again","Try again shortly."):this.#H("v4_return_live_retry","Return to the live map and retry.")}</div>
          <div class="toolbar">
            <button class="ms-btn ms-btn--secondary" type="button" @click=${()=>this.#r({type:"open-workflow",workflow:t})}>${this.#H("v4_retry","Try again")}</button>
          </div>
        </div>
      `}return H==="empty"?d`<div class="empty">${r.empty}</div>`:e}#l(){let H=this.state.resources.plans;return this.#i(H.status,H.problem,d`
      <div class="stack">
        <h3 class="group-heading" id="rooms-heading">${this.#H("v4_rooms_to_clean","Rooms to clean")}</h3>
        <div class="list" role="group" aria-labelledby="rooms-heading">
          ${(H.value?.rooms||[]).map(V=>{let e=this.state.selection.roomIds.includes(V.roomId);return d`
              <div class="room ms-row ms-row--stack" data-selected=${String(e)}>
                <label class="room-choice">
                  <input
                    type="checkbox"
                    .checked=${e}
                    @change=${()=>this.#r({type:"toggle-room",roomId:V.roomId})}
                  >
                  <strong>${V.name}</strong>
                  ${e?d`<small>${this.#H("v4_room_ready","Ready")}</small>`:l}
                </label>
                ${e?this.#e(V.roomId,this.state.selection.roomSettings.find(r=>r.roomId===V.roomId)||{roomId:V.roomId,cleaningMode:"vacuum",coverageSetting:"standard"}):l}
              </div>
            `})}
        </div>
        <p class="subtle">${this.#H("v4_room_selection_hint","Select rooms here or directly on the map. The map and list stay in sync.")}</p>
        ${this.#L()}
      </div>
    `)}#e(H,V){let e=this.state.resources.plans.value?.rooms.find(r=>r.roomId===H)?.name||this.#H("v4_room","Room");return d`
      <div class="split room-settings">
        <label class="field ms-field">${this.#H("v4_cleaning_system","Cleaning system")}
          <select
            aria-label=${this.#H("v4_room_cleaning_system_named","Cleaning system for {room}",{room:e})}
            .value=${V.cleaningMode}
            @change=${r=>this.#r({type:"patch-room-settings",roomId:H,cleaningMode:I(r)})}
          >${q2.map(r=>d`<option value=${r} ?selected=${r===V.cleaningMode}>${this.#V(r)}</option>`)}</select>
        </label>
        <label class="field ms-field">${this.#H("cleaning_mode","Cleaning mode")}
          <select
            aria-label=${this.#H("v4_room_cleaning_mode_named","Cleaning mode for {room}",{room:e})}
            .value=${V.coverageSetting}
            @change=${r=>this.#r({type:"patch-room-settings",roomId:H,coverageSetting:I(r)})}
          >${K2.map(r=>d`<option value=${r} ?selected=${r===V.coverageSetting}>${this.#t(r)}</option>`)}</select>
        </label>
      </div>
    `}#h(H){let V=this.state.planDraft.rooms,r=V.find(t=>t.roomId===H)?V.filter(t=>t.roomId!==H):[...V,{roomId:H,cleaningMode:"vacuum",coverageSetting:"standard"}];this.#r({type:"patch-plan-draft",patch:{rooms:r}})}#f(H,V){let e=this.state.planDraft.rooms.map((r,t)=>t===H?{...r,...V}:r);this.#r({type:"patch-plan-draft",patch:{rooms:e}})}#u(H,V){let e=H+V,r=[...this.state.planDraft.rooms];if(e<0||e>=r.length)return;let[t]=r.splice(H,1);t&&(r.splice(e,0,t),this.#r({type:"patch-plan-draft",patch:{rooms:r}}))}#d(){let H=this.state.resources.plans,V=H.value,e=this.state.planDraft,r=e.rooms.map(M=>({room:M,label:V?.rooms.find(i=>i.roomId===M.roomId)?.name||"Room",selected:!0})),t=(V?.rooms||[]).filter(M=>!e.rooms.some(i=>i.roomId===M.roomId)).map(M=>({room:{roomId:M.roomId,cleaningMode:"vacuum",coverageSetting:"standard"},label:M.name,selected:!1})),o=[...r,...t];return this.#i(H.status,H.problem,d`
      <div class="stack">
        <div class="split">
          <label class="field ms-field">${this.#H("v4_saved_plan","Saved plan")}
            <select
              name="saved-plan"
              .value=${this.state.selection.planId||""}
              @change=${M=>this.#r({type:"select-plan",planId:I(M)||null})}
            >
              <option value="" ?selected=${!this.state.selection.planId}>${this.#H("plan_new","New plan")}</option>
              ${(V?.plans||[]).map(M=>d`<option value=${M.id} ?selected=${M.id===this.state.selection.planId}>${M.enabled?M.name:`${M.name} \xB7 ${this.#H("v4_paused","paused")}`}</option>`)}
            </select>
          </label>
          <button class="ms-btn ms-btn--secondary" type="button" @click=${()=>this.#r({type:"select-plan",planId:null})}>${Z(D3)}<span class="ms-btn__label">${this.#H("plan_new","New plan")}</span></button>
        </div>
        <label class="field ms-field">${this.#H("plan_name","Plan name")}
          <input
            maxlength="128"
            autocomplete="off"
            .value=${e.name}
            @input=${M=>this.#r({type:"patch-plan-draft",patch:{name:I(M)}})}
          >
        </label>
        <div class="split plan-meta">
          <label class="field ms-field">${this.#H("plan_run_behavior","Cleaning order")}
            <select
              .value=${e.runBehavior}
              @change=${M=>this.#r({type:"patch-plan-draft",patch:{runBehavior:I(M)==="ordered"?"ordered":"intelligent"}})}
            >
              <option value="intelligent">${this.#H("plan_intelligent","Intelligent rotation")}</option>
              <option value="ordered">${this.#H("plan_ordered","Saved order")}</option>
            </select>
          </label>
          <div class="ms-row plan-active" data-active=${String(e.enabled)}>
            <div class="ms-row__body">
              <strong id="plan-active-title">${this.#H("v4_plan_can_run","Plan enabled")}</strong>
              <small id="plan-active-desc">${e.enabled?this.#H("v4_plan_can_run_on","Available from Run a plan, automations, and Home Assistant services."):this.#H("v4_plan_can_run_off","Paused. Turn this on to make the plan available.")}</small>
            </div>
            <button
              class="ms-switch"
              type="button"
              role="switch"
              aria-checked=${String(e.enabled)}
              aria-labelledby="plan-active-title"
              aria-describedby="plan-active-desc"
              @click=${()=>this.#r({type:"patch-plan-draft",patch:{enabled:!e.enabled}})}
            ></button>
          </div>
        </div>
        <h3 class="group-heading" id="plan-rooms-heading">${this.#H("plan_rooms","Plan rooms")}</h3>
        <div class="list" role="group" aria-labelledby="plan-rooms-heading">
          ${o.map(({room:M,label:i,selected:a})=>{let n=a?e.rooms.findIndex(A=>A.roomId===M.roomId):-1;return d`
              <div class="room plan-room ms-row ms-row--stack" data-selected=${String(a)}>
                <div class="room-choice">
                  <label class="plan-room-label">
                  <input type="checkbox" .checked=${a} @change=${()=>this.#h(M.roomId)}>
                  <strong>${a?`${n+1}. `:""}${i}</strong>
                  </label>
                  ${a?d`
                    <span>
                      <button class="icon-button ms-btn ms-btn--icon" type="button" aria-label=${this.#H("move_room_up","Move {room} earlier",{room:i})} ?disabled=${n===0} @click=${A=>{A.preventDefault(),this.#u(n,-1)}}>${Z($3)}</button>
                      <button class="icon-button ms-btn ms-btn--icon" type="button" aria-label=${this.#H("move_room_down","Move {room} later",{room:i})} ?disabled=${n===e.rooms.length-1} @click=${A=>{A.preventDefault(),this.#u(n,1)}}>${Z(I3)}</button>
                    </span>
                  `:l}
                </div>
                ${a?d`
                  <div class="split room-settings">
                    <label class="field ms-field">${this.#H("v4_cleaning_system","Cleaning system")}
                      <select aria-label=${this.#H("v4_room_cleaning_system_named","Cleaning system for {room}",{room:i})} .value=${M.cleaningMode} @change=${A=>this.#f(n,{cleaningMode:I(A)})}>${q2.map(A=>d`<option value=${A} ?selected=${A===M.cleaningMode}>${this.#V(A)}</option>`)}</select>
                    </label>
                    <label class="field ms-field">${this.#H("cleaning_mode","Cleaning mode")}
                      <select aria-label=${this.#H("v4_room_cleaning_mode_named","Cleaning mode for {room}",{room:i})} .value=${M.coverageSetting} @change=${A=>this.#f(n,{coverageSetting:I(A)})}>${K2.map(A=>d`<option value=${A} ?selected=${A===M.coverageSetting}>${this.#t(A)}</option>`)}</select>
                    </label>
                  </div>
                `:l}
              </div>
            `})}
        </div>
        <h3 class="group-heading" id="completion-heading">${this.#H("v4_completion_options","When a run ends")}</h3>
        <div class="plan-options" role="group" aria-labelledby="completion-heading">
          <label class="plan-option">
            <input type="checkbox" .checked=${e.returnToBase} @change=${M=>this.#r({type:"patch-plan-draft",patch:{returnToBase:e0(M)}})}>
            <span class="plan-option-copy">
              <strong>${this.#H("plan_return_to_base","Return to the dock when finished")}</strong>
              <small>${this.#H("plan_return_to_base_hint","After the last selected room, the robot returns to the dock.")}</small>
            </span>
          </label>
          <label class="plan-option">
            <input type="checkbox" .checked=${e.finishCurrentRoom} @change=${M=>this.#r({type:"patch-plan-draft",patch:{finishCurrentRoom:e0(M)}})}>
            <span class="plan-option-copy">
              <strong>${this.#H("plan_finish_room","Finish the current room after Stop")}</strong>
              <small>${this.#H("plan_finish_room_hint","When enough of the room is complete, finish it before docking. Never start another room.")}</small>
            </span>
          </label>
          ${e.finishCurrentRoom?d`
            <label class="plan-threshold ms-field">
              <span class="plan-threshold-copy">
                <strong>${this.#H("plan_threshold","Minimum room progress")}</strong>
                <small>${this.#H("plan_threshold_hint","When Stop is requested, the robot checks this progress: below it stops now; at or above it finishes this room before docking.")}</small>
              </span>
              <span class="threshold-value">${e.finishCurrentRoomThreshold}%</span>
              <input type="range" min="0" max="100" step="5" .value=${String(e.finishCurrentRoomThreshold)} aria-label=${this.#H("plan_threshold","Minimum room progress")} @input=${M=>this.#r({type:"patch-plan-draft",patch:{finishCurrentRoomThreshold:Number(I(M))}})}>
            </label>
          `:l}
        </div>
        <div class="toolbar">
          ${e.id?d`
            <button
              class="danger ms-btn ms-btn--secondary ms-btn--danger"
              type="button"
              aria-label=${this.#H("plan_delete","Delete plan")}
              data-dialog-launcher="confirmDeletePlan"
              @click=${()=>this.#r({type:"open-dialog",dialog:"confirmDeletePlan"})}
            >${this.#H("plan_delete","Delete")}</button>
          `:l}
        </div>
        ${this.#L()}
      </div>
    `)}#n(){let H=this.state.resources.areas;return d`
      <div class="stack">
        <p class="subtle">${this.#H("v4_draw_floor_hint","Paint only on the mapped floor. Zoom and pan never change the saved outline.")}</p>
        ${this.#i(H.status,H.problem,d`
          <div class="group">
            <h3 class="group-heading" id="areas-heading">${this.#H("area_workspace_title","Saved custom areas")}</h3>
            <div class="list" role="group" aria-labelledby="areas-heading">
            <button class="list-button ms-row ms-row" type="button" @click=${()=>this.#r({type:"select-area",areaId:null})}>\uff0b ${this.#H("area_new","New outline")}</button>
            ${(H.value?.areas||[]).map(V=>d`
              <button class="list-button ms-row ms-row" type="button" @click=${()=>{this.#r({type:"select-area",areaId:V.id}),this.#r({type:"open-workflow",workflow:"areaReview"})}}>
                <span>${V.name}</span>
                <small>${V.status==="current"?this.#H("area_workspace_ready","Ready"):this.#H("v4_review","Review")}</small>
              </button>
            `)}
            </div>
          </div>
        `)}
      </div>
    `}#p(){let H=this.state.areaDraft,V=H.canRebind||H.status==="review",e=H.status==="stale"||H.status==="unknown";return d`
      <div class="stack">
        ${V?d`<div class="notice" data-tone="warning" role="status">${this.#H("area_review_required","Review the saved outline on this current map, then confirm it.")}</div>`:l}
        ${e?d`<div class="problem" role="alert">${this.#H("area_redraw_required","This outline no longer matches the current room map. Redraw it before saving.")}</div>`:l}
        <label class="field ms-field">${this.#H("area_name","Area name")}
          <input maxlength="128" autocomplete="off" .value=${H.name} @input=${r=>this.#r({type:"patch-area-draft",patch:{name:I(r)}})}>
        </label>
        <div class="split">
          <label class="field ms-field">${this.#H("v4_cleaning_system","Cleaning system")}
            <select .value=${H.cleaningMode} @change=${r=>this.#r({type:"patch-area-draft",patch:{cleaningMode:I(r)}})}>${q2.map(r=>d`<option value=${r} ?selected=${r===H.cleaningMode}>${this.#V(r)}</option>`)}</select>
          </label>
          <label class="field ms-field">${this.#H("cleaning_mode","Cleaning mode")}
            <select .value=${H.coverageSetting} @change=${r=>this.#r({type:"patch-area-draft",patch:{coverageSetting:I(r)}})}>${K2.map(r=>d`<option value=${r} ?selected=${r===H.coverageSetting}>${this.#t(r)}</option>`)}</select>
          </label>
        </div>
        <p class="subtle">${this.#H("v4_private_marks","{count} map-space marks. The outline stays private and floor-bound.",{count:this.state.draw.circles.length})}</p>
        <div class="toolbar">
          <button class="ms-btn ms-btn--secondary" type="button" @click=${()=>this.#r({type:"open-workflow",workflow:"draw"})}>${this.#H("v4_edit_outline","Edit outline")}</button>
          ${H.id?d`
            <button
              class="danger ms-btn ms-btn--secondary ms-btn--danger"
              type="button"
              aria-label=${this.#H("area_delete","Delete area")}
              data-dialog-launcher="confirmDeleteArea"
              @click=${()=>this.#r({type:"open-dialog",dialog:"confirmDeleteArea"})}
            >${this.#H("area_delete","Delete")}</button>
          `:l}
        </div>
        ${this.#L()}
      </div>
    `}#o(){let H=this.state.resources.history,V=H.value,e=V?.floors.find(i=>i.id===this.state.selection.floorId)||V?.floors.find(i=>i.active)||V?.floors[0],r=e?.snapshots||[],t=this.state.selection.historyId?Math.max(0,r.findIndex(i=>i.id===this.state.selection.historyId)):r.length,o=e?.active?this.#H("map_timeline_live_action","Live"):this.#H("v4_return_current_floor","Return to current floor"),M=r[t];return this.#i(H.status,H.problem,d`
      <div class="stack">
        ${(V?.floors.length||0)>1?d`
          <div class="group">
            <h3 class="group-heading" id="floors-heading">${this.#H("v4_mapped_floors","Mapped floors")}</h3>
            <div class="list" role="group" aria-labelledby="floors-heading">
            ${(V?.floors||[]).map((i,a)=>d`
              <button
                class="floor ms-row ms-row"
                type="button"
                aria-current=${String(i.id===e?.id)}
                @click=${()=>this.#r({type:"set-floor",floorId:i.id})}
              >
                <span>${i.label||(i.active?this.#H("v4_current_floor","Current floor"):this.#H("v4_saved_floor","Saved floor {number}",{number:i.ordinal??a}))}</span>
                <small>${i.active?this.#H("map_timeline_live_action","Live"):this.#H("v4_read_only","Read only")}</small>
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
              aria-valuetext=${M?this.#m(M.createdAt):o}
              ?disabled=${!r.length}
              @input=${i=>{let a=Number(I(i));this.#r({type:"set-history",historyId:a===r.length?null:r[a]?.id||null})}}
            >
          </label>
          <div class="list">
            <button class="snapshot ms-row ms-row" type="button" aria-current=${String(!this.state.selection.historyId&&!!e?.active)} @click=${()=>this.#r({type:"set-history",historyId:null})}><span>${o}</span><small>${this.#H("v4_current","Current")}</small></button>
            ${r.map((i,a)=>d`
              <button class="snapshot ms-row ms-row" type="button" aria-current=${String(i.id===this.state.selection.historyId)} @click=${()=>this.#r({type:"set-history",historyId:i.id})}>
                <span>${this.#m(i.createdAt)}</span><small>${a+1} of ${r.length}</small>
              </button>
            `)}
          </div>
        </div>
        <p class="subtle">${this.#H("v4_history_privacy","Saved maps are floor-scoped and never show a live robot position.")}</p>
      </div>
    `)}#m(H){try{return new Intl.DateTimeFormat(this.state.locale,{dateStyle:"medium",timeStyle:"short"}).format(new Date(H))}catch{return this.#H("v4_saved_map","Saved map")}}#S(){let H=this.state.resources.entry,V=this.#H("v4_yes","Yes"),e=this.#H("v4_no","No"),r=this.#H("v4_seen","Seen"),t=this.#H("v4_not_seen","Not seen"),o=this.#H("v4_unknown","Unknown");return[[this.#H("v4_connection","Connection"),this.state.host.connected?this.#H("v4_connected","Connected"):this.#H("v4_offline","Offline")],[this.#H("v4_map_state","Map state"),String(this.state.coherence)],[this.#H("v4_floor_verified","Floor verified"),this.state.map.floorCoherent?V:e],[this.#H("v4_session_verified","Session verified"),this.state.map.sessionVerified?V:e],[this.#H("v4_map_complete","Map complete"),this.state.map.complete?V:e],[this.#H("v4_map_health","Map health"),H?.health||o],[this.#H("v4_blocked_by","Blocked by"),H?.mapBlockReason?.replaceAll("_"," ")||this.#H("v4_nothing","Nothing")],[this.#H("v4_startup_map","Startup map check"),H?.bootstrapState?.replaceAll("_"," ")||o],[this.#H("v4_startup_photo","Startup photo layer"),H?.bootstrapPhotoSeen?r:t],[this.#H("v4_startup_structure","Startup structure layer"),H?.bootstrapStructureSeen?r:t],[this.#H("v4_startup_failures","Startup failures"),String(H?.bootstrapFailures||0)],[this.#H("v4_stream_failures","Stream failures"),String(H?.streamFailures||0)],[this.#H("v4_saved_floor_count","Saved floor count"),String(this.state.floor.classifiedCount)]]}#s(H){this.#C!==void 0&&clearTimeout(this.#C),this.#C=void 0,this._copyStatus=H,H==="copied"&&(this.#C=setTimeout(()=>{this.#C=void 0,this._copyStatus="idle"},2e3))}#M(H,V){if(typeof document>"u"||typeof document.execCommand!="function")return!1;let e=V??(document.activeElement instanceof HTMLElement?document.activeElement:null),r=document.createElement("textarea");r.value=H,r.readOnly=!0,r.setAttribute("aria-hidden","true"),r.style.cssText="position:fixed;inset-block-start:-1000px;inline-size:1px;block-size:1px;opacity:0",document.body.append(r),r.select(),r.setSelectionRange(0,H.length);try{return document.execCommand("copy")}catch{return!1}finally{r.remove(),e?.focus({preventScroll:!0})}}async#x(H){let V=this.#S().map(([r,t])=>`${r}: ${t}`).join(`
`),e=typeof navigator>"u"?void 0:navigator.clipboard;if(e&&typeof e.writeText=="function")try{await e.writeText(V),this.#s("copied");return}catch{}this.#s(this.#M(V,H instanceof HTMLElement?H:null)?"copied":"failed")}#v(){let H=this.#S(),V=this._copyStatus==="copied"?this.#H("v4_copied","Copied"):this._copyStatus==="failed"?this.#H("v4_copy_failed","The summary could not be copied. Select the text to copy it by hand."):"";return d`
      <div class="stack">
        <p class="subtle">${this.#H("v4_support_privacy","This summary contains no map, coordinates, room or floor names, device identifiers, addresses, or credentials.")}</p>
        <dl class="diagnostics">
          ${H.map(([e,r])=>d`<dt>${e}</dt><dd>${r}</dd>`)}
        </dl>
        <div class="toolbar">
          <button class="ms-btn ms-btn--secondary" type="button" @click=${e=>{this.#x(e.currentTarget)}}>${Z(W3)}<span>${this.#H("v4_copy_summary","Copy summary")}</span></button>
        </div>
        <p class="copy-status" role="status" aria-live="polite">${V}</p>
      </div>
    `}render(){return d`<fieldset class="workflow-fields" ?disabled=${this.state.command==="pending"}>${this.#A()}</fieldset>`}#A(){switch(this.state.workflow){case"rooms":return this.#l();case"plan":return this.#d();case"draw":return this.#n();case"areaReview":return this.#p();case"history":return this.#o();case"support":return this.#v();case"none":return l}}};customElements.get(a1)||customElements.define(a1,X2);var r0=J(i1),L2=J(F1),t0=J(a1),i0=L=>L.dataMode==="history"||L.floor.readOnly,S7=(L,C)=>{let H=(e,r,t)=>T(C,e,r,t);if(!L.host.connected)return{title:H("v4_reconnecting","Reconnecting"),detail:H("v4_ha_offline","Home Assistant is offline"),icon:h1,notable:!0};if(!L.host.administrator)return{title:H("v4_access_required","Access required"),detail:H("v4_admin_only","Administrator only"),icon:h1,notable:!0};if(L.host.robotCount===0)return{title:H("v4_no_robot_short","No robot"),detail:H("v4_set_up_robot","Set up a Matic robot"),icon:h1,notable:!0};if(!L.host.robotConnected)return{title:H("v4_robot_offline","Robot offline"),detail:H("v4_last_map_read_only","Last verified map \xB7 read only"),icon:h1,notable:!0};if(L.activity==="problem")return{title:H("v4_needs_attention","Needs attention"),detail:H("v4_check_robot","Check the robot"),icon:h1,notable:!0};if(L.dataMode==="history"){let e=L.resources.history.value?.floors.find(o=>o.id===L.selection.floorId),r=e?.snapshots.findIndex(o=>o.id===L.selection.historyId)??-1,t=e?.snapshots.length??0;return{title:H("v4_saved_map","Saved map"),detail:r>=0?H("v4_read_only_position","Read only \xB7 {position} of {count}",{position:r+1,count:t}):H("v4_read_only","Read only"),icon:W2,notable:!1}}if(L.coherence==="verifying"||L.coherence==="booting")return{title:H("v4_locating","Locating"),detail:H("v4_finding_map","Finding the current map"),icon:Y1,notable:!0};if(L.activity==="cleaning")return{title:H("v4_cleaning","Cleaning"),detail:H("v4_cleaning_progress","Cleaning in progress"),icon:N2,notable:!0};if(L.activity==="recharging"){let e=L.batteryPercent===null?H("v4_recharging_detail","Will resume automatically when ready"):H("v4_recharging_battery","Charging to resume \xB7 {percent}% battery",{percent:L.batteryPercent});return{title:H("v4_recharging","Charging to resume"),detail:e,icon:G3,notable:!0}}if(L.activity==="paused")return{title:H("v4_paused","Paused"),detail:H("v4_can_resume","Cleaning can resume"),icon:z2,notable:!0};if(L.activity==="returning")return{title:H("v4_returning","Returning"),detail:H("v4_going_dock","Going to the dock"),icon:N2,notable:!0};if(L.activity==="stopping")return{title:H("v4_stopping","Stopping"),detail:H("v4_waiting_robot","Waiting for the robot"),icon:z2,notable:!0};let V=L.batteryPercent===null?H("v4_ready","Ready"):H("v4_battery","{percent}% battery",{percent:L.batteryPercent});return{title:L.activity==="docked"?H("v4_docked","Docked"):H("v4_ready","Ready"),detail:V,icon:Y1,notable:!1}},M0=(L,C)=>{let H=(V,e)=>T(C,V,e);switch(L.workflow){case"rooms":return{title:H("v4_choose_rooms","Choose rooms"),description:H("v4_choose_rooms_detail","Select on the map or from the list.")};case"draw":return{title:H("v4_draw_area","Draw an area"),description:H("v4_draw_area_detail","Paint on the verified map, then review the details.")};case"plan":return{title:H("v4_cleaning_plan","Cleaning plan"),description:H("v4_plan_detail","Review rooms and cleaning settings.")};case"areaReview":return{title:H("v4_name_this_area","Name this area"),description:H("area_details_hint","Name the area and choose cleaning settings.")};case"history":return{title:H("v4_map_history","Map history"),description:H("v4_map_history_detail","Saved maps are floor-scoped and read only.")};case"support":return{title:H("v4_map_diagnostics","Map diagnostics"),description:H("v4_map_support_detail","Private geometry is never included.")};case"none":return i0(L)?{title:H("v4_saved_map_read_only_title","Saved map is read only"),description:H("v4_saved_map_read_only_detail","Return to the live map to choose rooms, run a plan, or draw a custom area.")}:{title:H("v4_what_to_clean","What should the robot clean?"),description:H("v4_clean_detail","Choose rooms, a saved plan, or a custom area.")}}},V1=["peek","half","full"],o0={none:"half",rooms:"peek",draw:"peek",plan:"full",areaReview:"half",history:"half",support:"full"},f7=.5,g7=100,y7=6,b7=48,O7=["button:not(:disabled)","a[href]","input:not(:disabled)","select:not(:disabled)","textarea:not(:disabled)","[tabindex]:not([tabindex='-1'])"].join(", "),w7=(L,C,H=!1)=>{let V=(e,r)=>T(C,e,r);switch(L){case"discardDraft":return{title:H?V("v4_discard_plan","Discard plan changes?"):V("v4_discard_area","Discard area changes?"),detail:H?V("v4_discard_plan_detail","Your plan changes have not been saved. Keep editing or discard them."):V("v4_discard_area_detail","Your area changes have not been saved. Keep editing or discard them."),cancelLabel:V("v4_keep_area_editing","Keep editing"),confirmLabel:V("v4_discard","Discard"),action:"discard"};case"confirmDeletePlan":return{title:V("v4_delete_plan","Delete this plan?"),detail:V("v4_delete_plan_detail","This removes the saved plan from Home Assistant. The robot will not move."),cancelLabel:V("v4_cancel","Cancel"),confirmLabel:V("plan_delete","Delete plan"),action:"delete-plan"};case"confirmDeleteArea":return{title:V("v4_delete_area","Delete this area?"),detail:V("v4_delete_area_detail","This removes the saved outline from Home Assistant. The robot will not move."),cancelLabel:V("v4_cancel","Cancel"),confirmLabel:V("area_delete","Delete area"),action:"delete-area"};case"confirmStop":return{title:V("v4_stop_cleaning","Stop cleaning?"),detail:V("v4_stop_cleaning_detail","The robot may take a moment to settle before another action is available."),cancelLabel:V("v4_keep_cleaning","Keep cleaning"),confirmLabel:V("v4_stop","Stop"),action:"stop"};case"error":return{title:V("v4_error","Something went wrong"),detail:V("v4_error_detail","No action was started. Close this message and try again when the map is ready."),cancelLabel:V("v4_close","Close"),confirmLabel:V("v4_close","Close"),action:null};case null:return null}},k7=(L=document)=>{let C=L.activeElement;for(;C?.shadowRoot?.activeElement;)C=C.shadowRoot.activeElement;return C},Y2=L=>!!(L&&L.isConnected&&L.offsetParent!==null),j2=class extends O{constructor(){super(...arguments);this.state=k();this._measuredNarrow=!1;this._sheetOffset=0;this._overflowOpen=!1;this._helpOpen=!1;this._browserFullscreen=!1;this._sheetDetent="half";this._announcement="";this.#H=null;this.#V=null;this.#t=null;this.#r=null;this.#L=null;this.#a=null;this.#i=null;this.#l=null;this.#e=null;this.#h=()=>{this._browserFullscreen=document.fullscreenElement===this.renderRoot.querySelector(".app")};this.#f=H=>{if(!this._overflowOpen)return;let V=this.renderRoot.querySelector(".overflow-wrap");(!V||!H.composedPath().includes(V))&&(this._overflowOpen=!1)}}static{this.properties={state:{attribute:!1},localize:{attribute:!1},_measuredNarrow:{state:!0},_sheetOffset:{state:!0},_overflowOpen:{state:!0},_helpOpen:{state:!0},_browserFullscreen:{state:!0},_sheetDetent:{state:!0},_announcement:{state:!0}}}static{this.styles=U5}#C(H,V,e){return T(this.localize,H,V,e)}#H;#V;#t;#r;#L;#a;#i;#l;#e;#h;#f;connectedCallback(){super.connectedCallback(),this.#H=new ResizeObserver(([H])=>{if(!H)return;let V=H.contentRect.width<768||H.contentRect.height<480;V!==this._measuredNarrow&&(this._measuredNarrow=V)}),this.#H.observe(this),window.addEventListener("pointerdown",this.#f,!0),document.addEventListener("fullscreenchange",this.#h),this.#V=new ResizeObserver(([H])=>{if(!H)return;let V=Math.ceil(H.target.getBoundingClientRect().height);V!==this._sheetOffset&&(this._sheetOffset=V)})}disconnectedCallback(){this.#H?.disconnect(),this.#H=null,this.#V?.disconnect(),this.#V=null,this.#t=null,window.removeEventListener("pointerdown",this.#f,!0),document.removeEventListener("fullscreenchange",this.#h),super.disconnectedCallback()}updated(H){let V=H,e=this.renderRoot.querySelector(".mobile-sheet");if(e!==this.#t&&(this.#V?.disconnect(),this.#t=e,e?this.#V?.observe(e):this._sheetOffset!==0&&(this._sheetOffset=0)),V.has("_overflowOpen")&&this._overflowOpen&&this.updateComplete.then(()=>{this.renderRoot.querySelector("#map-options select, #map-options button")?.focus()}),V.has("_helpOpen")){if(this._helpOpen)this.updateComplete.then(()=>{this.renderRoot.querySelector(".help-dialog [data-dialog-initial-focus]")?.focus()});else if(V.get("_helpOpen")){let r=this.#a;this.#a=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>r?.focus({preventScroll:!0}))})}}if(H.has("state")){let r=H.get("state");if(r?.precisionOpen&&!this.state.precisionOpen&&this.#d()?.focus(),r?.fullMap&&!this.state.fullMap){let t=this.#L;this.#L=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>{(this.renderRoot.querySelector(".workspace-toggle")??this.renderRoot.querySelector(".nav--menu")??(t?.isConnected?t:null))?.focus({preventScroll:!0})})})}if(!r?.dialog&&this.state.dialog){let t=k7(this.shadowRoot||document);t?.hasAttribute("data-dialog-launcher")&&(this.#r=t),this.updateComplete.then(()=>{(this.renderRoot.querySelector(".dialog [data-dialog-initial-focus]")??this.renderRoot.querySelector(".dialog button"))?.focus()})}else if(r?.dialog&&!this.state.dialog){r.dialog==="discardDraft"&&(this.#i=null,this.#s());let t=this.#r?.isConnected&&this.#r.hasAttribute("data-dialog-launcher")?this.#r:this.#W(r.dialog);this.#r=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>t?.focus({preventScroll:!0}))})}r?r.workflow!==this.state.workflow&&(this._sheetDetent=o0[this.state.workflow],this.updateComplete.then(()=>this.#u())):this._sheetDetent=o0[this.state.workflow]}}#u(){let H=this.renderRoot.querySelector(".panel-heading h2");if(Y2(H)){H.focus({preventScroll:!0});return}let V=this.renderRoot.querySelector(".action-bar .ms-btn--primary");Y2(V)&&V.focus({preventScroll:!0})}#d(){let H=this.renderRoot.querySelector(".draw-brush");return Y2(H)?H:this.renderRoot.querySelector(i1)?.shadowRoot?.querySelector(".draw-brush")??null}#n(H){if(e1(this.state,H)){this.#i=H,this.#n({type:"open-dialog",dialog:"discardDraft"});return}this.dispatchEvent(new CustomEvent(H1,{detail:H,bubbles:!0,composed:!0}))}#p(H){if(H.enabled){if(H.id==="return-live"){this.#n({type:"set-history",historyId:null});return}if(H.id==="clear-draft"){this.#n({type:"clear-draft"});return}this.#x(H.id)}}#o(H){this.#n({type:"open-workflow",workflow:H})}#m(){let H=this.#i;this.#i=null,H?.type==="select-plan"||H?.type==="select-area"?(this.#n({type:"patch-plan-draft",patch:{dirty:!1}}),this.#n({type:"patch-area-draft",patch:{dirty:!1}}),this.#n({type:"dismiss-top-layer"})):this.#n({type:"discard-draft"}),H&&queueMicrotask(()=>this.dispatchEvent(new CustomEvent(H1,{detail:H,bubbles:!0,composed:!0})))}#S(){this.#i=null,this.#M(),this.#s()}#s(){this.updateComplete.then(()=>{let H=this.renderRoot.querySelector(".floor-switcher");H&&(H.value=this.state.selection.floorId);let V=this.renderRoot.querySelector(".robot-switcher");V&&(V.value=this.state.selection.entryId??"");let r=this.renderRoot.querySelector(a1)?.shadowRoot?.querySelector('[name="saved-plan"]');r&&(r.value=this.state.selection.planId??"")})}#M(){let H=this.state.dialog,V=H&&this.#r?.isConnected&&this.#r.hasAttribute("data-dialog-launcher")?this.#r:H?this.#W(H):null;this.#n({type:"dismiss-top-layer"}),V&&requestAnimationFrame(()=>V.focus({preventScroll:!0}))}#x(H){this.dispatchEvent(new CustomEvent(V2,{detail:{id:H},bubbles:!0,composed:!0}))}#v(H){this.#n({type:"dismiss-top-layer"}),this.#x(H)}#A(H){if(H.action==="discard"){this.#m();return}if(H.action==="delete-plan"||H.action==="delete-area"){this.#v(H.action);return}this.#n({type:"dismiss-top-layer"}),H.action==="stop"&&this.#x("stop")}#c(H){H!==this._sheetDetent&&(this._sheetDetent=H,this._announcement=this.#C("v4_workspace_height","Map workspace, {height} height",{height:H}))}#Z(H,V=!1){let r=V1.indexOf(this._sheetDetent)+H;V&&r>=V1.length&&(r=0),r=Math.max(0,Math.min(V1.length-1,r)),this.#c(V1[r]??this._sheetDetent)}#y(H){let V=this.renderRoot.querySelector(".workspace")?.clientHeight??H.parentElement?.clientHeight??H.offsetHeight,e=parseFloat(getComputedStyle(this).fontSize)||16,r=[".sheet-grip",".sheet-tools",".action-bar"].map(M=>H.querySelector(M)?.offsetHeight??0).reduce((M,i)=>M+i,0)+e*.75,t=Math.min(V*.92,V-e*4),o=Math.min(V*.48,e*26,t);return{peek:Math.min(r,o),half:o,full:t}}#T(){return this.renderRoot.querySelector(".mobile-sheet")}#w(H){if(H.pointerType==="mouse"&&H.button!==0||H.target?.closest("button, select, input, a"))return;let V=this.#T();!V||this.#l||(this.#l={pointerId:H.pointerId,startY:H.clientY,startHeight:V.offsetHeight,heights:this.#y(V),samples:[{y:H.clientY,t:H.timeStamp}],moved:!1},H.currentTarget.setPointerCapture(H.pointerId),V.classList.add("dragging"))}#R(H){let V=this.#l;if(!V||H.pointerId!==V.pointerId)return;let e=this.#T();if(!e)return;let r=H.clientY-V.startY;for(!V.moved&&Math.abs(r)>y7&&(V.moved=!0),V.samples.push({y:H.clientY,t:H.timeStamp});V.samples.length>2&&H.timeStamp-(V.samples[1]?.t??0)>g7;)V.samples.shift();if(!V.moved)return;let t=V.startHeight-V.heights.full,o=V.startHeight-V.heights.peek,M=Math.max(t,Math.min(o,r));e.style.transform=`translateY(${M}px)`}#O(H){let V=this.#l;if(!V||H.pointerId!==V.pointerId)return;this.#l=null;let e=this.#T();if(e&&(e.style.transform="",e.classList.remove("dragging")),H.type==="pointercancel")return;if(!V.moved){this.#Z(1,!0);return}let r=H.clientY-V.startY,t=V1.indexOf(this._sheetDetent),o=V.samples[0],M=V.samples[V.samples.length-1],i=o&&M&&M!==o?(M.y-o.y)/Math.max(1,M.t-o.t):0;if(Math.abs(i)>f7){let s=Math.max(0,Math.min(V1.length-1,t+(i<0?1:-1)));this.#c(V1[s]??this._sheetDetent);return}let a=V.startHeight-r,n=this._sheetDetent,A=Number.POSITIVE_INFINITY;for(let s of V1){let p=Math.abs(V.heights[s]-a);p<A&&(A=p,n=s)}this.#c(n)}#k(H){if(H.pointerType==="mouse")return;let V=H.currentTarget;this.#e={pointerId:H.pointerId,startY:H.clientY,atTop:V.scrollTop===0,consumed:!1}}#P(H){let V=this.#e;if(!V||V.consumed||!V.atTop||H.pointerId!==V.pointerId)return;if(H.currentTarget.scrollTop>0){this.#e=null;return}H.clientY-V.startY<b7||(V.consumed=!0,this.#Z(-1))}#g(){this.#e=null}#B(){this.dispatchEvent(new CustomEvent("hass-toggle-menu",{bubbles:!0,composed:!0}))}#_(H){this.#L=H.currentTarget,this.#n({type:this.state.fullMap?"exit-full-map":"enter-full-map"})}#b(H){this._overflowOpen=!1,H&&this.updateComplete.then(()=>{this.renderRoot.querySelector(".overflow")?.focus()})}#I(H){if(this.#b(H==="fullscreen"),H==="support"){this.#o("support");return}if(H==="fullscreen"){let V=this.renderRoot.querySelector(".app");document.fullscreenElement?document.exitFullscreen():V?.requestFullscreen();return}this.dispatchEvent(new CustomEvent(V2,{detail:{id:"use-classic"},bubbles:!0,composed:!0}))}#C1(){this.#n({type:"set-precision-open",value:!this.state.precisionOpen})}#H1(H){this.#a=H.currentTarget,this._helpOpen=!0}#K(H){let V=H;if(!d1(V.detail))return;if(e1(this.state,V.detail)){H.stopPropagation(),this.#n(V.detail);return}if(V.detail?.type!=="open-dialog")return;let e=V.composedPath().find(r=>r instanceof HTMLElement&&r.hasAttribute("data-dialog-launcher"));e instanceof HTMLElement&&(this.#r=e)}#W(H){return this.renderRoot.querySelector(a1)?.shadowRoot?.querySelector(`[data-dialog-launcher="${H}"]`)??null}#V1(H){if(!(H.defaultPrevented||H.ctrlKey||H.metaKey||H.altKey)&&H.key==="Escape"){if(H.preventDefault(),this._overflowOpen){this.#b(!0);return}if(this._helpOpen){this._helpOpen=!1;return}if(this.state.dialog==="discardDraft"){this.#S();return}this.#n({type:"dismiss-top-layer"})}}#N(H){if(H.key!=="Tab")return;let e=[...H.currentTarget.querySelectorAll(O7)],r=e[0],t=e.at(-1);if(!r||!t)return;let o=this.shadowRoot?.activeElement;H.shiftKey&&o===r?(H.preventDefault(),t.focus()):!H.shiftKey&&o===t&&(H.preventDefault(),r.focus())}#X(){let H=this.renderRoot.querySelector(i1);(H?.shadowRoot?.querySelector(".map-root")??H)?.focus()}#Y(){this._sheetDetent==="peek"&&this.#T()&&this.#c("half"),this.updateComplete.then(()=>this.#u())}#F(H,V,e){if(H.id==="choose-cleaning")return l;let r=H.labelKey?this.#C(H.labelKey,H.label):H.label,t=!H.enabled&&H.reason?H.reasonKey?this.#C(H.reasonKey,H.reason):H.reason:null,o=H.id==="stop";return c`
      <button
        class=${`${V} ${H.kind==="danger"?"ms-btn--danger":""}`}
        type="button"
        aria-disabled=${H.enabled?l:"true"}
        aria-describedby=${t?e:l}
        aria-label=${o?this.#C("v4_stop_cleaning_label","Stop cleaning"):l}
        @click=${()=>this.#p(H)}
      >${r}</button>
      ${t?c`<p class="action-reason" id=${e}>${t}</p>`:l}
    `}#z(H){let V=H.resources.plans.value?.rooms??H.resources.areas.value?.rooms??[];return H.selection.roomIds.map(e=>V.find(r=>r.roomId===e)?.name??e)}#E(H,V,e){let r=V?.enabled&&H.workflow==="rooms"&&V.id==="clean-rooms"?[this.#z(H).join(", "),H.planDraft.returnToBase?this.#C("v4_returns_to_dock","returns to the dock"):""].filter(Boolean).join(" \xB7 "):"";return c`
      <div class="action-bar">
        ${r?c`<p class="action-summary">${r}</p>`:l}
        ${V?this.#F(V,"ms-btn ms-btn--block ms-btn--lg ms-btn--primary","primary-reason"):l}
        ${e?this.#F(e,"ms-btn ms-btn--block ms-btn--lg ms-btn--secondary","secondary-reason"):l}
      </div>
    `}#D(H,V,e=l){return c`
      <div class="host-state">
        <h3>${H}</h3>
        <p>${V}</p>
        ${e}
      </div>
    `}#U(H,V,e,r,t=!1){return c`
      <button
        class="ms-row"
        type="button"
        aria-disabled=${t?"true":l}
        @click=${()=>{t||e()}}
      >
        <span class="ms-row__lead">${Z(V)}</span>
        <span class="ms-row__body"><strong>${H}</strong>${r?c`<small>${r}</small>`:l}</span>
        <span class="ms-row__trail">${Z(X1)}</span>
      </button>
    `}#G(H){let V=H.resources.history.value?.floors||[],e=V.length?V.map((r,t)=>({id:r.active?"current":r.id,label:`${r.label||(r.active?this.#C("v4_current_floor","Current floor"):this.#C("v4_saved_floor","Saved floor {number}",{number:r.ordinal??t+1}))}${!r.active&&r.snapshots.length===0?` \xB7 ${this.#C("v4_floor_not_captured","Visit floor to capture")}`:""}`,disabled:!r.active&&r.snapshots.length===0})):[{id:H.selection.floorId,label:H.floor.displayName,disabled:!1}];return c`
      <select
        class="ms-select context-switcher floor-switcher"
        name="map-floor"
        aria-label=${this.#C("v4_choose_floor","Choose floor")}
        ?disabled=${e.length<=1}
        .value=${H.selection.floorId}
        @change=${r=>this.#n({type:"set-floor",floorId:r.currentTarget.value})}
      >${e.map(r=>c`
        <option value=${r.id} ?disabled=${r.disabled}>${r.label}</option>
      `)}</select>
    `}#L1(H,V){let e=(S,g,P)=>this.#C(S,g,P),r=this.#U(e("v4_map_history","Map history"),W2,()=>this.#o("history"),e("v4_map_history_detail","Saved maps are floor-scoped and read only.")),t=this.#U(e("v4_map_diagnostics","Map diagnostics"),U3,()=>this.#o("support"),e("v4_map_support_detail","Private geometry is never included.")),{host:o}=H;if(!o.connected)return this.#D(e("v4_reconnecting_title","Reconnecting to Home Assistant"),e("v4_reconnecting_body","The last verified map stays read-only until the connection returns."));if(!o.administrator)return this.#D(e("v4_admin_title","Administrator access required"),e("v4_admin_body","Ask a Home Assistant administrator to open this map."));if(o.robotCount===0)return this.#D(e("v4_no_robot_title","No Matic robot set up"),e("v4_no_robot_body","Add the Matic integration to see a map here."),c`<a class="ms-btn ms-btn--secondary" href="/config/integrations/integration/matic_robot">${e("v4_open_integration","Open the Matic integration")}</a>`);if(!o.robotConnected)return c`
        ${this.#D(e("v4_robot_offline_title","Robot offline"),e("v4_robot_offline_body","Showing the last verified map. Cleaning is unavailable until the robot reconnects."))}
        <h3 class="shelf-heading">${e("v4_more","Map tools")}</h3>
        <div class="shelf">${r}${t}</div>
      `;if(i0(H))return c`
        ${this.#D(e("v4_saved_map_read_only_notice","Cleaning is unavailable on a saved map"),e("v4_saved_map_read_only_notice_detail","Saved maps are view only. Return to the live map below to choose rooms, run a plan, or draw a custom area."))}
        <h3 class="shelf-heading">${e("v4_more","Map tools")}</h3>
        <div class="shelf">
          ${r}
          ${t}
          ${V?this.#G(H):l}
        </div>
      `;let M=H.coherence==="verifying"||H.coherence==="booting",i=H.resources.plans,a=i.value,n=a!==null&&a.rooms.length===0,A=a?.plans.length??0,s=i.status==="loading",p=i.status==="error",u=M||n,h=M?e("v4_reason_locating","Waiting for the robot to confirm which floor it is on."):n?e("v4_no_rooms_reason","This floor has no named rooms yet."):null,x=M?e("v4_reason_locating","Waiting for the robot to confirm which floor it is on."):null,f=M?e("v4_reason_locating","Waiting for the robot to confirm which floor it is on."):e("v4_areas_quick_detail","Sketch a one-time zone on the map");return c`
      ${H.activity==="problem"?this.#D(e("v4_attention_title","The robot needs attention"),e("v4_attention_body","Check the robot, then start a new task.")):c`
          <div class="quick-actions" aria-label=${e("v4_cleaning_choices","Cleaning choices")}>
            <button
              class="ms-row ms-row--card ms-row--featured"
              type="button"
              aria-disabled=${u?"true":l}
              @click=${()=>{u||this.#o("rooms")}}
            >
              <span class="ms-row__lead">${Z(Y1)}</span>
              <span class="ms-row__body">
                <strong>${e("v4_clean_rooms","One-time clean")}</strong>
                <small>${h??e("v4_clean_rooms_hint","Choose rooms for this run")}</small>
              </span>
              <span class="ms-row__trail">${Z(X1)}</span>
            </button>
            <button
              class="ms-row ms-row--card"
              type="button"
              aria-disabled=${M?"true":l}
              @click=${()=>{M||this.#o("plan")}}
            >
              <span class="ms-row__lead">${Z(z3)}</span>
              <span class="ms-row__body">
                <strong>${s?e("v4_plans_loading","Checking saved plans"):p?e("v4_plans_unavailable","Plans unavailable"):A?e("v4_run_a_plan","Run a plan"):e("v4_create_plan","Create a plan")}</strong>
                <small>${x??(s?e("v4_plans_loading_hint","Reading routines for this floor"):p?e("v4_plans_unavailable_hint","Try again to load saved routines"):A?A===1?e("v4_saved_routine","1 saved routine"):e("v4_saved_routines","{count} saved routines",{count:A}):e("v4_no_plans_hint","Save a room routine you can repeat"))}</small>
              </span>
              <span class="ms-row__trail">${Z(X1)}</span>
            </button>
          </div>
        `}
      <h3 class="shelf-heading">${e("v4_more","Map tools")}</h3>
      <div class="shelf">
        ${this.#U(e("v4_custom_areas","Clean a custom area"),N3,()=>this.#o("draw"),f,M)}
        ${r}
        ${V?this.#G(H):l}
      </div>
      ${V?c`
        <h3 class="shelf-heading" id="map-display-heading">${e("v4_map_display","Map display")}</h3>
        <div class="map-display">
          <div class="ms-segment" role="group" aria-labelledby="map-display-heading">
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(H.appearance==="photo")}
              @click=${()=>this.#n({type:"set-appearance",appearance:"photo"})}
            >${e("map_style_photo","Photo")}</button>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(H.appearance==="rooms")}
              @click=${()=>this.#n({type:"set-appearance",appearance:"rooms"})}
            >${e("v4_room_colours","Floor plan")}</button>
          </div>
          <label class="ms-checkbox">
            <input type="checkbox" .checked=${H.labelsVisible} @change=${()=>this.#n({type:"toggle-labels"})}>
            ${e("v4_room_names","Room names")}
          </label>
          <button
            class="ms-btn ms-btn--secondary help-launcher"
            type="button"
            aria-haspopup="dialog"
            aria-expanded=${String(this._helpOpen)}
            @click=${this.#H1}
          >${e("v4_how_to_move","How to move the map")}</button>
        </div>
      `:l}
    `}#e1(H,V){return H.workflow==="none"?this.#L1(H,V):c`<${t0}
      .state=${H}
      .localize=${this.localize}
      @matic-workspace-intent=${this.#K}
    ></${t0}>`}#j(H,V){let e=M0(H,this.localize);return c`
      <div class="panel-heading">
        ${H.workflow!=="none"?c`
          <button
            class="panel-back ms-btn ms-btn--secondary"
            type="button"
            aria-label=${this.#C("v4_back_to_all_tasks","Back to all tasks")}
            @click=${()=>this.#o(H.workflow==="areaReview"?"draw":"none")}
          >${Z(I2)}<span class="ms-btn__label">${this.#C("v4_all_tasks","All tasks")}</span></button>
        `:l}
        <h2 tabindex="-1">${e.title}</h2>
      </div>
      <p class="panel-description">${e.description}</p>
      ${this.#e1(H,V)}
    `}#Q(H,V){let r=M0(H,this.localize).title;return H.workflow==="rooms"&&H.selection.roomIds.length&&(r=`${this.#C("v4_rooms_selected","{count} rooms selected",{count:H.selection.roomIds.length})} \xB7 ${this.#z(H).join(", ")}`),this._sheetDetent!=="peek"?V.detail?`${V.title} \xB7 ${V.detail}`:V.title:V.notable?`${V.title} \xB7 ${r}`:r}#$(){let H=(V,e)=>this.#C(V,e);return c`
      <div class="dialog-backdrop" @click=${V=>{V.target===V.currentTarget&&(this._helpOpen=!1)}}>
        <section
          class="dialog help-dialog ms-surface ms-surface--overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-title"
          @keydown=${this.#N}
        >
          <h2 id="help-title">${H("v4_how_to_move","How to move the map")}</h2>
          <dl>
            <dt>${H("v4_touch","Touch")}</dt>
            <dd>${H("v4_touch_help","Drag to explore \xB7 pinch to zoom \xB7 twist two fingers to rotate")}</dd>
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
    `}render(){let H=this.state,V=H.narrowHint||this._measuredNarrow,e=S7(H,this.localize),r=s5({...H,narrowHint:V}),t=d5(H),o=!V&&r.id==="stop"?r:!V&&t?.id==="stop"?t:null,M=o&&o===r?null:r,i=H.workflow==="draw"&&H.dataMode==="live"?{id:"clear-draft",label:"Clear drawing",labelKey:"v4_clear_drawing",kind:"neutral",enabled:H.draw.circles.length>0}:null,a=o&&o===t?null:t??i,n=H.fullMap&&(H.coherence==="verifying"||H.coherence==="booting"),A=H.fullMap||H.host.administrator&&H.host.robotCount>0&&H.map.available,s=w7(H.dialog,this.localize,H.workflow==="plan"),p=V&&!H.fullMap?`--map-sheet-offset:${this._sheetOffset}px`:"--map-sheet-offset:0px",u=V&&H.workflow==="draw",h=H.precisionOpen&&H.workflow==="draw";return c`
      <div class=${`root ${V?"narrow":"wide"}`} @keydown=${this.#V1}>
        <button class="skip-link ms-btn ms-btn--primary" type="button" @click=${this.#X}>${this.#C("v4_skip_to_map","Skip to the map")}</button>
        <button class="skip-link ms-btn ms-btn--primary" type="button" @click=${this.#Y}>${this.#C("v4_skip_to_workspace","Skip to the map workspace")}</button>
        <div class="app" ?inert=${!!s||this._helpOpen}>
          <header class="app-bar">
            ${H.precisionOpen?c`
              <button
                class="nav ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#C("v4_back","Back")}
                @click=${()=>this.#n({type:"dismiss-top-layer"})}
              >${Z(I2)}</button>
            `:l}
            <h1 class="title">${this.#C("map_studio_title","Matic Map")}</h1>
            ${H.robots.length>1?c`
              <select
                class="ms-select context-switcher robot-switcher"
                name="matic-robot"
                aria-label=${this.#C("v4_choose_robot","Choose robot")}
                .value=${H.selection.entryId||""}
                @change=${x=>this.#n({type:"select-entry",entryId:x.currentTarget.value})}
              >${H.robots.map(x=>c`
                <option value=${x.entryId}>${x.label}</option>
              `)}</select>
            `:l}
            ${V?l:this.#G(H)}
            <span class="spacer"></span>
            ${A?c`
              <button
                class="workspace-toggle ms-btn ms-btn--icon"
                type="button"
                aria-label=${H.fullMap?this.#C("v4_show_workspace","Show workspace"):this.#C("v4_hide_workspace","Hide workspace")}
                aria-controls="map-workspace"
                aria-expanded=${String(!H.fullMap)}
                title=${H.fullMap?this.#C("v4_show_workspace","Show workspace"):this.#C("v4_hide_workspace","Hide workspace")}
                @click=${this.#_}
              >${Z(h3)}</button>
            `:l}
            ${H.precisionOpen?l:c`
              <button
                class="nav nav--menu ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#C("v4_open_navigation","Open navigation")}
                title=${this.#C("v4_open_navigation","Open navigation")}
                @click=${this.#B}
              >${Z(Z3)}</button>
            `}
            <div class="overflow-wrap">
              <button
                class="overflow ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#C("v4_map_options","Map options")}
                aria-expanded=${String(this._overflowOpen)}
                aria-controls="map-options"
                @click=${()=>{this._overflowOpen=!this._overflowOpen}}
              >${Z(x3)}</button>
              ${this._overflowOpen?c`
                <div id="map-options" class="overflow-menu ms-surface ms-surface--overlay">
                  <label class="overflow-field ms-field">${this.#C("map_quality_label","Scene detail")}
                    <select
                      aria-label=${this.#C("map_quality_label","Scene detail")}
                      .value=${H.quality}
                      @change=${x=>this.#n({type:"set-quality",quality:x.currentTarget.value})}
                    >
                      <option value="auto">${this.#C("map_quality_auto","Auto detail")}</option>
                      <option value="efficient">${this.#C("map_quality_efficient","Efficient")}</option>
                      <option value="balanced">${this.#C("map_quality_balanced","Balanced")}</option>
                      <option value="maximum">${this.#C("map_quality_maximum","Maximum")}</option>
                    </select>
                  </label>
                  <button class="ms-row ms-row--menu" type="button" @click=${()=>this.#I("support")}>${this.#C("v4_map_diagnostics","Map diagnostics")}</button>
                  <button class="ms-row ms-row--menu" type="button" @click=${()=>this.#I("classic")}>${this.#C("v4_switch_classic","Open classic map view")}</button>
                  <button class="ms-row ms-row--menu" type="button" @click=${()=>this.#I("fullscreen")}>${this._browserFullscreen?this.#C("v4_leave_full_screen","Leave full screen"):this.#C("v4_full_screen","Full screen")}</button>
                </div>
              `:l}
            </div>
          </header>

          <main class=${`workspace ${H.fullMap?"full-map":""}`} style=${p}>
            <div class="canvas">
              <${r0}
                class="map-canvas"
                style=${p}
                .state=${H}
                .localize=${this.localize}
                .narrow=${V}
              ></${r0}>
              ${!V&&h?c`
                <div class="precision-popover">
                  <${L2} compact .state=${H} .localize=${this.localize}></${L2}>
                </div>
              `:l}
            </div>

            ${V&&!H.fullMap&&this._sheetDetent==="full"?c`
              <button
                class="sheet-scrim"
                type="button"
                aria-label=${this.#C("v4_collapse_sheet","Collapse the map workspace")}
                @click=${()=>this.#c("peek")}
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
              id="map-workspace"
              class=${V?"inspector mobile-sheet":"inspector"}
              data-detent=${V?this._sheetDetent:l}
              data-workflow=${H.workflow}
              aria-label="Map workspace"
            >
              ${V?c`
                <div
                  class="sheet-grip"
                  @pointerdown=${this.#w}
                  @pointermove=${this.#R}
                  @pointerup=${this.#O}
                  @pointercancel=${this.#O}
                >
                  <span class="sheet-handle" role="presentation"></span>
                  <span class="sheet-status">${this.#Q(H,e)}</span>
                  <button
                    class="ms-btn ms-btn--icon ms-btn--sm"
                    type="button"
                    aria-label=${this.#C("v4_show_more","Show more of the map workspace")}
                    aria-controls="sheet-body"
                    aria-disabled=${this._sheetDetent==="full"?"true":l}
                    @click=${()=>this.#Z(1)}
                  >${Z(S3)}</button>
                  <button
                    class="ms-btn ms-btn--icon ms-btn--sm"
                    type="button"
                    aria-label=${this.#C("v4_show_less","Show less of the map workspace")}
                    aria-controls="sheet-body"
                    aria-disabled=${this._sheetDetent==="peek"?"true":l}
                    @click=${()=>this.#Z(-1)}
                  >${Z(f3)}</button>
                </div>
                ${u?c`
                  <div class="sheet-tools">
                    ${j1(H,{intent:x=>this.#n(x),openBrush:()=>this.#C1(),t:(x,f)=>this.#C(x,f)},"grid")}
                    ${h?c`
                      <div class="precision-popover">
                        <${L2} compact inline .state=${H} .localize=${this.localize}></${L2}>
                      </div>
                    `:l}
                  </div>
                `:l}
                <div
                  class="sheet-body"
                  id="sheet-body"
                  @pointerdown=${this.#k}
                  @pointermove=${this.#P}
                  @pointerup=${this.#g}
                  @pointercancel=${this.#g}
                >
                  ${this.#j(H,V)}
                </div>
                ${this.#E(H,M,a)}
              `:c`
                <div class="status-strip">
                  <span class="status-icon" aria-hidden="true">${Z(e.icon)}</span>
                  <span class="status-copy"><strong>${e.title}</strong><small>${e.detail}</small></span>
                  ${o?this.#F(o,"status-action ms-btn ms-btn--secondary","status-reason"):l}
                </div>
                <section class="workflow">
                  <div class="workflow-body">${this.#j(H,V)}</div>
                  ${this.#E(H,M,a)}
                </section>
              `}
            </aside>

            ${H.fullMap?c`
              <section
                class=${`full-map-hud ms-surface ms-surface--floating ${t?"has-secondary":""} ${!V&&(H.workflow==="draw"||H.workflow==="rooms"&&H.selection.roomIds.length>0)?"above-dock":""}`}
                aria-label="Robot status and action"
              >
                <span class="hud-copy"><strong>${e.title}</strong><small>${e.detail}</small></span>
                ${n?l:this.#F(r,"ms-btn ms-btn--lg ms-btn--primary","hud-reason")}
                ${!n&&t?this.#F(t,"ms-btn ms-btn--lg ms-btn--secondary","hud-secondary-reason"):l}
              </section>
            `:l}
          </main>
        </div>

        <div class="sr-only" aria-live="polite" aria-atomic="true">${[this._announcement,H.notice?.text??""].filter(Boolean).join(" ")}</div>

        ${this._helpOpen?this.#$():l}

        ${s?c`
          <div class="dialog-backdrop">
            <section
              class="dialog ms-surface ms-surface--overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="dialog-title"
              aria-describedby="dialog-detail"
              @keydown=${this.#N}
            >
              <h2 id="dialog-title">${s.title}</h2>
              <p id="dialog-detail">${s.detail}</p>
              <div class="dialog-actions">
                <button
                  class="ms-btn ms-btn--secondary"
                  type="button"
                  data-dialog-initial-focus
                  @click=${H.dialog==="discardDraft"?this.#S:this.#M}
                >${s.cancelLabel}</button>
                ${s.action===null?l:c`
                  <button
                    class="discard ms-btn ms-btn--primary ms-btn--danger"
                    type="button"
                    @click=${()=>this.#A(s)}
                  >${s.confirmLabel}</button>
                `}
              </div>
            </section>
          </div>
        `:l}
      </div>
    `}};customElements.get(n1)||customElements.define(n1,j2);var a0=J(n1),J2=class extends O{constructor(){super(...arguments);this.scenario="ready";this.narrow=!1;this.controls=!0;this._workspace=Z2("ready");this.#C=new v1(this._workspace);this.#H=null}static{this.properties={scenario:{type:String,reflect:!0},narrow:{type:Boolean,reflect:!0},controls:{type:Boolean,reflect:!0},_workspace:{state:!0}}}static{this.styles=[D,$,b`
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
  `]}#C;#H;connectedCallback(){super.connectedCallback(),this.#H=this.#C.subscribe(H=>{this._workspace=H})}disconnectedCallback(){this.#H?.(),this.#H=null,super.disconnectedCallback()}willUpdate(H){H.has("scenario")?this.#C.replace({...Z2(this.scenario),narrowHint:this.narrow}):H.has("narrow")&&this.#C.dispatch({type:"set-narrow-hint",value:this.narrow})}setScenario(H){h2.includes(H)&&(this.scenario=H)}getWorkspaceSnapshot(){return structuredClone(this.#C.value)}replaceWorkspaceState(H){this.#C.replace(structuredClone(H))}#V(H){d1(H.detail)&&(H.stopPropagation(),this.#C.dispatch(H.detail))}render(){return c`
      ${this.controls?c`
        <nav class="gallery-controls" aria-label="Map Studio states">
          ${h2.map(H=>c`
            <button
              type="button"
              aria-pressed=${String(this.scenario===H)}
              @click=${()=>{this.scenario=H}}
            >${H}</button>
          `)}
        </nav>
      `:null}
      <div class="stage">
        <${a0}
          class="shell"
          .state=${this._workspace}
          @matic-workspace-intent=${this.#V}
        ></${a0}>
      </div>
    `}};customElements.get("matic-map-studio-gallery-v0-4-0")||customElements.define("matic-map-studio-gallery-v0-4-0",J2);var n0="/api/matic_robot/slam_entries";var m=class extends Error{constructor(C){super(C),this.name="ContractError",this.code=C}},R=(L,C)=>{if(!L||typeof L!="object"||Array.isArray(L))throw new m(C);return L},w=(L,C,H)=>{if(typeof L!="string")throw new m(H);let V=L.trim();if(!V||Array.from(V).length>C||/[\u0000-\u001f\u007f]/u.test(V))throw new m(H);return V},P7=L=>{if(L==null||L==="")return null;try{return w(L,128,"invalid-floor-label")}catch{return null}},f1=(L,C,H,V)=>{if(typeof L!="number"||!Number.isFinite(L)||L<C||L>H)throw new m(V);return L},z=(L,C,H,V)=>{let e=f1(L,C,H,V);if(!Number.isInteger(e))throw new m(V);return e},C5=(L,C)=>L==null?null:z(L,1,C,"invalid-floor-ordinal"),y=(L,C)=>{if(typeof L!="boolean")throw new m(C);return L},_7=(L,C)=>L===null?null:y(L,C),A0=L=>{if(L==null)return null;let C=w(L,64,"invalid-map-session-key");if(!/^[0-9a-f]{64}$/u.test(C))throw new m("invalid-map-session-key");return C},T7=L=>{if(L==null)return null;if(L==="bootstrap_empty"||L==="map_session_unverified"||L==="floor_plan_unavailable"||L==="floor_plan_mismatch")return L;throw new m("invalid-map-block-reason")},B7=L=>{if(L===void 0)return"not_started";if(L==="not_started"||L==="running"||L==="complete"||L==="partial"||L==="failed")return L;throw new m("invalid-bootstrap-state")},X=(L,C)=>{let H=w(L,512,C);if(!H.startsWith("/")||H.startsWith("//")||H.includes("\\"))throw new m(C);return H},R7=L=>{let C=typeof L.map_health=="string"?L.map_health.toLowerCase():"",H=typeof L.stream_state=="string"?L.stream_state.toLowerCase():"",V=typeof L.invalid_tiles=="number"?L.invalid_tiles:0;return C.includes("error")||C.includes("fail")||C.includes("degrad")||V>0?"problem":L.map_truncated===!0||C.includes("truncat")||C.includes("limit")?"limited":L.map_complete===!0?"ready":H.includes("connect")||H.includes("collect")||H.includes("run")?"building":"unknown"},l0=L=>{let C=R(L,"invalid-catalog");if(!Array.isArray(C.entries)||C.entries.length>64)throw new m("invalid-catalog-entries");return C.entries.map(H=>{let V=R(H,"invalid-catalog-entry"),e=z(V.map_revision,0,Number.MAX_SAFE_INTEGER,"invalid-map-revision");return{entryId:w(V.entry_id,128,"invalid-entry-id"),sceneUrl:X(V.scene_url,"invalid-scene-url"),deltaUrl:V.delta_url===void 0||V.delta_url===null?null:X(V.delta_url,"invalid-delta-url"),poseUrl:X(V.pose_url,"invalid-pose-url"),historyUrl:X(V.history_url,"invalid-history-url"),areasUrl:X(V.areas_url,"invalid-areas-url"),plansUrl:X(V.plans_url,"invalid-plans-url"),mapRevision:e,mapFloorCoherent:y(V.map_floor_coherent,"invalid-floor-coherence"),mapSessionVerified:y(V.map_session_verified,"invalid-session-state"),mapSessionKey:A0(V.map_session_key),mapBlockReason:T7(V.map_block_reason),runnerLocked:y(V.runner_locked,"invalid-runner-lock"),stopSettlePending:y(V.stop_settle_pending,"invalid-stop-settle"),activePlan:y(V.active_plan,"invalid-active-plan"),nativeReconciliationPending:y(V.native_reconciliation_pending,"invalid-native-reconciliation"),nativeSessionActive:_7(V.native_session_active,"invalid-native-session"),mapComplete:y(V.map_complete,"invalid-map-complete"),mapTruncated:y(V.map_truncated,"invalid-map-truncated"),selectedFloorOrdinal:C5(V.selected_floor_ordinal,128),mapFloorOrdinal:C5(V.map_floor_ordinal,128),historyCount:z(V.history_count,0,12,"invalid-history-count"),historyFloorCount:z(V.history_floor_count,0,128,"invalid-floor-count"),health:R7(V),streamFailures:z(V.stream_failures,0,Number.MAX_SAFE_INTEGER,"invalid-stream-failures"),bootstrapState:B7(V.bootstrap_state),bootstrapPhotoSeen:V.bootstrap_photo_seen===void 0?!1:y(V.bootstrap_photo_seen,"invalid-bootstrap-photo"),bootstrapStructureSeen:V.bootstrap_structure_seen===void 0?!1:y(V.bootstrap_structure_seen,"invalid-bootstrap-structure"),bootstrapFailures:V.bootstrap_failures===void 0?0:z(V.bootstrap_failures,0,2,"invalid-bootstrap-failures")}})},s0=(L,C)=>{if(!Array.isArray(L)||L.length!==2)throw new m(C);return[f1(L[0],-1e6,1e6,C),f1(L[1],-1e6,1e6,C)]},F7=(L,C)=>{if(!Array.isArray(L)||L.length<3||L.length>8192)throw new m(C);return L.map(H=>s0(H,C))},d0=(L,C)=>{if(!Array.isArray(L)||L.length>256)throw new m("invalid-rooms");return L.map(H=>{let V=R(H,"invalid-room");return{roomId:w(V.room_id,128,"invalid-room-id"),name:w(V.name,128,"invalid-room-name"),boundary:C?F7(V.boundary,"invalid-room-boundary"):[]}})},E7=L=>{let C=R(L,"invalid-history-snapshot"),H=w(C.created_at,64,"invalid-history-time");if(!Number.isFinite(Date.parse(H)))throw new m("invalid-history-time");return{id:w(C.id,128,"invalid-history-id"),createdAt:H,revision:z(C.revision,0,Number.MAX_SAFE_INTEGER,"invalid-history-revision"),pointCount:z(C.point_count,1,15e5,"invalid-history-points"),sceneUrl:X(C.scene_url,"invalid-history-scene-url")}},p0=L=>{let C=R(L,"invalid-history");if(!Array.isArray(C.floors)||C.floors.length<1||C.floors.length>128)throw new m("invalid-history-floors");return{entryId:w(C.entry_id,128,"invalid-history-entry"),liveAvailable:y(C.live_available,"invalid-history-live"),floors:C.floors.map(H=>{let V=R(H,"invalid-history-floor");if(!Array.isArray(V.snapshots)||V.snapshots.length>12)throw new m("invalid-history-snapshots");return{id:w(V.id,128,"invalid-history-floor-id"),active:y(V.active,"invalid-history-floor-active"),readOnly:y(V.read_only,"invalid-history-floor-read-only"),liveAvailable:V.live_available===void 0?!1:y(V.live_available,"invalid-history-floor-live"),label:P7(V.label),ordinal:V.ordinal===void 0?null:C5(V.ordinal,128),snapshots:V.snapshots.map(E7)}})}},m0=L=>{if(L==="vacuum"||L==="mop"||L==="vacuum_and_mop")return L;throw new m("invalid-cleaning-mode")},v0=L=>{if(L==="quick"||L==="standard"||L==="heavy_duty")return L;throw new m("invalid-coverage-setting")},D7=L=>{let C=R(L,"invalid-area-circle");return{x:f1(C.x,-1e6,1e6,"invalid-area-circle"),y:f1(C.y,-1e6,1e6,"invalid-area-circle"),radius:f1(C.radius,.05,2.5,"invalid-area-circle")}},$7=L=>L==="current"||L==="review"||L==="stale"?L:"unknown",c0=L=>{let C=R(L,"invalid-areas");if(!Array.isArray(C.areas)||C.areas.length>256)throw new m("invalid-area-list");return{sceneUrl:X(C.scene_url,"invalid-area-scene-url"),rooms:d0(C.rooms,!0),areas:C.areas.map(H=>{let V=R(H,"invalid-area");if(!Array.isArray(V.circles)||V.circles.length>512)throw new m("invalid-area-circles");return{id:w(V.id,128,"invalid-area-id"),name:w(V.name,128,"invalid-area-name"),circles:V.circles.map(D7),cleaningMode:m0(V.cleaning_mode),coverageSetting:v0(V.coverage_setting),status:$7(V.status),canRebind:y(V.can_rebind,"invalid-area-rebind")}})}},u0=L=>{let C=R(L,"invalid-plans");if(!Array.isArray(C.plans)||C.plans.length>256)throw new m("invalid-plan-list");return{rooms:d0(C.rooms,!1).map(({roomId:V,name:e})=>({roomId:V,name:e})),selectedPlan:C.selected_plan===null||C.selected_plan===void 0?null:w(C.selected_plan,128,"invalid-selected-plan"),plans:C.plans.map(V=>{let e=R(V,"invalid-plan");if(!Array.isArray(e.rooms)||e.rooms.length>256||!Array.isArray(e.room_order))throw new m("invalid-plan-rooms");let r=e.run_behavior;if(r!=="intelligent"&&r!=="ordered")throw new m("invalid-run-behavior");return{id:w(e.id,128,"invalid-plan-id"),name:w(e.name,128,"invalid-plan-name"),enabled:y(e.enabled,"invalid-plan-enabled"),runBehavior:r,rooms:e.rooms.map(t=>{let o=R(t,"invalid-plan-room");return{roomId:w(o.room_id,128,"invalid-plan-room-id"),cleaningMode:m0(o.cleaning_mode),coverageSetting:v0(o.coverage_setting)}}),roomOrder:e.room_order.slice(0,256).map(t=>w(t,128,"invalid-room-order")),returnToBase:y(e.return_to_base,"invalid-return-to-base"),finishCurrentRoom:y(e.finish_current_room,"invalid-finish-room"),finishCurrentRoomThreshold:z(e.finish_current_room_threshold,0,100,"invalid-finish-threshold")}})}},x0=L=>{let C=R(L,"invalid-pose"),H=C.position,V=H===null?null:s0(H,"invalid-pose-position"),e=C.pose_freshness;if(e!=="live"&&e!=="coordinator_fallback")throw new m("invalid-pose-freshness");return{position:V,source:w(C.source,64,"invalid-pose-source"),revision:z(C.revision,0,Number.MAX_SAFE_INTEGER,"invalid-pose-revision"),poseRevision:z(C.pose_revision,0,Number.MAX_SAFE_INTEGER,"invalid-pose-sequence"),floorCoherent:y(C.map_floor_coherent,"invalid-pose-floor"),mapSessionKey:A0(C.map_session_key),freshness:e}},Z0=L=>{try{return X(L,"invalid-private-path"),!0}catch{return!1}};var h0=L=>{let r=()=>{throw new Error("invalid-scene")};(!(L instanceof ArrayBuffer)||L.byteLength<24||L.byteLength>16777216)&&r();let t=new DataView(L),o=new Uint8Array(L,0,8),M=String.fromCharCode(...o),i=t.getUint16(8,!0),a=t.getUint16(10,!0),n=t.getUint32(12,!0),A=t.getUint32(16,!0),s=t.getUint32(20,!0),p=A+s,u=24+n;(M!=="MATIC3D\0"||i!==1||a!==8||n>1024*1024||p<1||p>15e5||u+p*a!==L.byteLength)&&r();let h;try{h=JSON.parse(new TextDecoder("utf-8",{fatal:!0}).decode(new Uint8Array(L,24,n)))}catch{r()}(!h||typeof h!="object"||Array.isArray(h))&&r();let x=h,f=x.meters_per_cell,S=x.origin_cells,g=x.span_cells;(typeof f!="number"||!Number.isFinite(f)||f<.001||f>.1||!Array.isArray(S)||S.length!==2||!S.every(E=>typeof E=="number"&&Number.isFinite(E))||!Array.isArray(g)||g.length!==2||!g.every(E=>typeof E=="number"&&Number.isFinite(E)&&E>=1&&E<=65536))&&r();let I1=(Array.isArray(x.rooms)?x.rooms.slice(0,128):[]).flatMap((E,$0)=>{if(!E||typeof E!="object"||Array.isArray(E))return[];let L1=E,W1=typeof L1.name=="string"?L1.name.trim():"";if(!W1||Array.from(W1).length>128||/[\u0000-\u001f\u007f]/u.test(W1))return[];if(!Array.isArray(L1.boundary)||L1.boundary.length<3||L1.boundary.length>8192)return[];let o5=L1.boundary.flatMap(s2=>{if(!Array.isArray(s2)||s2.length!==2)return[];let[d2,p2]=s2;return typeof d2=="number"&&Number.isFinite(d2)&&typeof p2=="number"&&Number.isFinite(p2)?[[d2,p2]]:[]}),n2=L1.center;if(o5.length<3||!Array.isArray(n2)||n2.length!==2)return[];let[A2,l2]=n2;return typeof A2!="number"||!Number.isFinite(A2)||typeof l2!="number"||!Number.isFinite(l2)?[]:[{id:`scene-room-${$0+1}`,name:W1,boundary:o5,center:[A2,l2]}]}),D0=typeof x.sample_step=="number"&&Number.isInteger(x.sample_step)?Math.max(1,Math.min(15e5,x.sample_step)):1,t5=S,M5=g;return{buffer:L,pointOffset:u,floorCount:A,surfaceCount:s,total:p,metadata:{metersPerCell:f,origin:[t5[0],t5[1]],span:[M5[0],M5[1]],sampleStep:D0,rooms:I1}}},z7=L=>{if(L.byteLength>16777216||L.byteLength<24||!1||!1)throw new m("invalid-scene");try{return h0(L)}catch{throw new m("invalid-scene")}},U7=()=>`
  const parseTransfer = ${h0.toString()};
  self.onmessage = (event) => {
    const { id, buffer } = event.data;
    try {
      const parsed = parseTransfer(buffer);
      self.postMessage({ id, ok: true, parsed }, [parsed.buffer]);
    } catch (_) {
      self.postMessage({ id, ok: false, problem: "invalid-scene" });
    }
  };
`,e2=class{#C=null;#H=null;#V=0;#t=new Map;constructor(){if(!(typeof Worker!="function"||typeof URL?.createObjectURL!="function"))try{this.#H=URL.createObjectURL(new Blob([U7()],{type:"text/javascript"})),this.#C=new Worker(this.#H),this.#C.onmessage=C=>{let H=this.#t.get(C.data.id);H&&(this.#t.delete(C.data.id),C.data.ok&&C.data.parsed?H.resolve(C.data.parsed):H.reject(new m(C.data.problem||"invalid-scene")))},this.#C.onerror=()=>this.#r("scene-worker-failed")}catch{this.#C=null,this.#H&&URL.revokeObjectURL(this.#H),this.#H=null}}async parse(C,H){if(H?.aborted)throw new DOMException("Aborted","AbortError");if(!this.#C){if(await new Promise(e=>window.setTimeout(e,0)),H?.aborted)throw new DOMException("Aborted","AbortError");return z7(C)}let V=++this.#V;return new Promise((e,r)=>{let t=()=>{this.#t.delete(V),r(new DOMException("Aborted","AbortError"))};H?.addEventListener("abort",t,{once:!0}),this.#t.set(V,{resolve:o=>{H?.removeEventListener("abort",t),e(o)},reject:o=>{H?.removeEventListener("abort",t),r(o)}}),this.#C?.postMessage({id:V,buffer:C},[C])})}#r(C){for(let H of this.#t.values())H.reject(new m(C));this.#t.clear(),this.#C?.terminate(),this.#C=null}dispose(){this.#r("scene-parser-disposed"),this.#H&&URL.revokeObjectURL(this.#H),this.#H=null}};var Y={catalog:1e4,scene:6e4,delta:35e3,pose:1e4,history:15e3,workflow:15e3,mutation:2e4},F=class extends Error{constructor(C,H=null){super(C),this.name="BackendError",this.code=C,this.status=H}},D1=36,g1=16*1024*1024,S0=(L,C)=>{let H=Number(L);if(!Number.isSafeInteger(H)||H<0)throw new m(C);return H},f0=(L,C)=>{let H=L.headers.get("X-Matic-Revision");if(H===null)return C;let V=Number(H);if(!Number.isSafeInteger(V)||V<0)throw new m("invalid-scene-revision");return V},g0=(L,C)=>{let H=L.headers.get("X-Matic-Floor-Coherent");if(H===null)return C;if(H==="1")return!0;if(H==="0")return!1;throw new m("invalid-scene-floor-header")},r2=class{#C;#H=new e2;constructor(C){this.#C=C}async#V(C,H,V,e){if(!Z0(C))throw new F("invalid-private-path");if(e?.aborted)throw new DOMException("Aborted","AbortError");let r=new AbortController,t=()=>r.abort();e?.addEventListener("abort",t,{once:!0});let o=!1,M=window.setTimeout(()=>{o=!0,r.abort()},V);try{let i=this.#C(),a=new Headers(H.headers),n={...H,cache:"no-store",credentials:"same-origin",headers:Object.fromEntries(a.entries()),signal:r.signal};if(typeof i?.fetchWithAuth=="function")return await i.fetchWithAuth(C,n);let A=i?.auth?.accessToken||i?.auth?.data?.access_token;A&&a.set("Authorization",`Bearer ${A}`);let s=typeof i?.hassUrl=="function"?i.hassUrl(C):C;return await fetch(s,{...n,headers:a})}catch(i){throw o&&!e?.aborted?new F("request-timeout"):r.signal.aborted?new DOMException("Aborted","AbortError"):i}finally{window.clearTimeout(M),e?.removeEventListener("abort",t)}}async#t(C,H,V,e={}){let r=await this.#V(C,{...e,headers:{Accept:"application/json",...e.headers||{}}},H,V);if(!r.ok){let t=r.headers.get("X-Matic-Plans-Conflict");throw new F(t==="map-rechecking"?"map-rechecking":"request-failed",r.status)}try{return await r.json()}catch{throw new m("invalid-json-response")}}async catalog(C){return l0(await this.#t(n0,Y.catalog,C))}async scene(C,H,V,e,r,t){let o=new Headers({Accept:"application/vnd.matic.slam-scene"});e==="live"&&o.set("X-Matic-Prefer-Cached","1"),t&&o.set("If-None-Match",t);let M=await this.#V(C,{headers:o},Y.scene,r),i=f0(M,H),a=g0(M,V);if(M.status===304)return{scene:null,floorCoherent:a,revision:i,notModified:!0};if(!M.ok)throw new F("scene-request-failed",M.status);if(M.headers.get("Content-Type")?.split(";",1)[0]!=="application/vnd.matic.slam-scene")throw new m("invalid-scene-content-type");return{scene:{...await this.#H.parse(await M.arrayBuffer(),r),revision:i,etag:M.headers.get("ETag"),source:e},floorCoherent:a,revision:i,notModified:!1}}async#r(C,H,V){if(!Number.isSafeInteger(H)||H<1||H>g1||typeof DecompressionStream!="function")throw new m("invalid-scene-delta");let r=new Blob([C]).stream().pipeThrough(new DecompressionStream("deflate")).getReader(),t=new Uint8Array(H),o=0,M=()=>{r.cancel()};V?.addEventListener("abort",M,{once:!0});try{for(;;){if(V?.aborted)throw new DOMException("Aborted","AbortError");let{done:i,value:a}=await r.read();if(i)break;if(!(a instanceof Uint8Array)||o+a.byteLength>H)throw new m("invalid-scene-delta");t.set(a,o),o+=a.byteLength}}finally{V?.removeEventListener("abort",M),r.releaseLock()}if(o!==H)throw new m("invalid-scene-delta");return t}async#L(C,H,V){if(C.byteLength<D1||C.byteLength>D1+g1||H.buffer.byteLength>g1)throw new m("invalid-scene-delta");let e=new DataView(C),r=new TextDecoder().decode(new Uint8Array(C,0,8)),t=e.getUint16(8,!0),o=e.getUint16(10,!0),M=S0(e.getBigUint64(12,!0),"invalid-scene-delta"),i=S0(e.getBigUint64(20,!0),"invalid-scene-delta"),a=e.getUint32(28,!0),n=e.getUint32(32,!0);if(r!=="MATICDLT"||t!==1||o!==1||M!==H.revision||i<=H.revision||a<24||a>g1||n>g1||n+D1!==C.byteLength)throw new m("invalid-scene-delta");let A=new Uint8Array(C,D1,n),s=new Uint8Array(H.buffer),u=(await this.#r(A,Math.max(s.byteLength,a),V)).slice(),h=1024*1024;for(let S=0;S<s.byteLength;S+=h){if(V?.aborted)throw new DOMException("Aborted","AbortError");let g=Math.min(s.byteLength,S+h);for(let P=S;P<g;P+=1)u[P]=(u[P]??0)^(s[P]??0);g<s.byteLength&&await new Promise(P=>window.setTimeout(P,0))}let x=u.slice(0,a).buffer;return{parsed:{...await this.#H.parse(x,V),revision:i,etag:null,source:"live"},revision:i}}async sceneDelta(C,H,V,e){let r=C.includes("?")?"&":"?",t=await this.#V(`${C}${r}since=${encodeURIComponent(H.revision)}`,{headers:{Accept:"application/vnd.matic.slam-delta, application/vnd.matic.slam-scene"}},Y.delta,e),o=f0(t,H.revision),M=g0(t,V);if(t.status===204){if(o!==H.revision)throw new m("invalid-scene-delta-revision");return{scene:null,floorCoherent:M,revision:o,notModified:!0}}if(!t.ok)throw new F("delta-request-failed",t.status);if(o<=H.revision)throw new m("invalid-scene-delta-revision");let i=Number(t.headers.get("Content-Length"));if(Number.isFinite(i)&&i>D1+g1)throw new m("invalid-scene-delta-size");let a=t.headers.get("Content-Type")?.split(";",1)[0],n=await t.arrayBuffer();if(a==="application/vnd.matic.slam-delta"){let s=Number(t.headers.get("X-Matic-Base-Revision"));if(!Number.isSafeInteger(s)||s!==H.revision)throw new m("invalid-scene-delta-base");let p=await this.#L(n,H,e);if(p.revision!==o)throw new m("invalid-scene-delta-revision");return{scene:{...p.parsed,etag:t.headers.get("ETag")},floorCoherent:M,revision:o,notModified:!1}}if(a!=="application/vnd.matic.slam-scene")throw new m("invalid-scene-delta-content-type");return{scene:{...await this.#H.parse(n,e),revision:o,etag:t.headers.get("ETag"),source:"live"},floorCoherent:M,revision:o,notModified:!1}}async pose(C,H){return x0(await this.#t(C,Y.pose,H))}async history(C,H){return p0(await this.#t(C,Y.history,H))}async plans(C,H){return u0(await this.#t(C,Y.workflow,H))}async areas(C,H){return c0(await this.#t(C,Y.workflow,H))}async saveArea(C,H,V){let e=await this.#t(C,Y.mutation,V,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...H.areaId?{area_id:H.areaId}:{},name:H.name,circles:H.circles,cleaning_mode:H.cleaningMode,coverage_setting:H.coverageSetting})});if(!e||typeof e!="object"||typeof e.id!="string")throw new m("invalid-area-save-response");return e.id}async deleteArea(C,H,V){let e=await this.#V(`${C}?area_id=${encodeURIComponent(H)}`,{method:"DELETE",headers:{Accept:"application/json"}},Y.mutation,V);if(!e.ok)throw new F("area-delete-failed",e.status)}async service(C,H,V,e){let r=this.#C();if(typeof r?.callService!="function")throw new F("service-unavailable");await r.callService(C,H,V,{entity_id:e})}dispose(){this.#H.dispose()}};var b0=()=>({version:4,view:"top",appearance:"photo",labels:!0,quality:"auto",cameras:{}}),$1=(L,C,H)=>Math.max(C,Math.min(H,L)),O0=L=>L.replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",V5=(L,C=4)=>`matic-map-studio:v${C}:${O0(L)}`,G7=L=>{if(!L||typeof L!="object")return null;let C=L;return["yaw","pitch","zoom","targetX","targetZ"].every(V=>typeof C[V]=="number"&&Number.isFinite(C[V]))?{yaw:$1(C.yaw,-Math.PI,Math.PI),pitch:$1(C.pitch,.18,Math.PI/2-.018),zoom:$1(C.zoom,.01,100),targetX:$1(C.targetX,-1e4,1e4),targetZ:$1(C.targetZ,-1e4,1e4)}:null},y0=L=>{let C=b0();if(!L||typeof L!="object")return C;let H=L,V=H.view==="three"||H.view==="top"||H.view==="rooms"?H.view:C.view,e=V==="rooms"?"top":V,r=H.quality==="auto"||H.quality==="efficient"||H.quality==="balanced"||H.quality==="maximum"?H.quality:C.quality,t=H.cameras&&typeof H.cameras=="object"?H.cameras:{},o={};for(let M of["three","top"]){let i=G7(t[M]);i&&(o[M]=i)}return{version:4,view:e,appearance:H.appearance==="rooms"||H.appearance==="photo"?H.appearance:C.appearance,labels:typeof H.labels=="boolean"?H.labels:C.labels,quality:r,cameras:o}},t2=class{#C="local-user";#H=null;load(C){this.#C=O0(C);try{let H=window.localStorage.getItem(V5(this.#C));if(H)return y0(JSON.parse(H));for(let V of[3,2]){let e=window.localStorage.getItem(V5(this.#C,V));if(e)return y0(JSON.parse(e))}}catch{}return b0()}schedule(C){this.#H!==null&&window.clearTimeout(this.#H),this.#H=window.setTimeout(()=>{this.#H=null;try{window.localStorage.setItem(V5(this.#C),JSON.stringify(C))}catch{}},250)}dispose(){this.#H!==null&&window.clearTimeout(this.#H),this.#H=null}},w0="matic-map-studio:preferred-frontend",k0=()=>{try{return window.localStorage.getItem(w0)==="v3"?"v3":"v4"}catch{return"v4"}},L5=L=>{try{return window.localStorage.setItem(w0,L),!0}catch{return!1}};var v=(L,C,H=null)=>({status:L,value:C,problem:H}),U=L=>L instanceof DOMException&&L.name==="AbortError",l1=(L,C)=>L instanceof F||L&&typeof L=="object"&&"code"in L&&typeof L.code=="string"?L.code:C,M2=L=>[L.selectedFloorOrdinal??"none",L.mapFloorOrdinal??"none",L.mapFloorCoherent?"coherent":"transition"].join(":"),o2=L=>[L.mapFloorOrdinal??"none",L.mapSessionVerified?"verified":"unverified",L.mapSessionKey??"no-session"].join(":"),G=L=>[L.entryId,L.selectedFloorOrdinal??"none",L.mapFloorOrdinal??"none"].join("|"),P0=L=>[L.entryId,M2(L),o2(L),L.mapRevision].join("|"),_0=L=>L.runnerLocked||L.stopSettlePending||L.activePlan||L.nativeReconciliationPending||L.nativeSessionActive===!0,Q7=(L,C)=>L.entryKey===C.entryKey&&L.generation===C.generation&&L.floorKey===C.floorKey&&L.missionKey===C.missionKey,T0="Live map updates paused while the current map is rechecked.",B0="Reconnecting. The last verified map remains read only.",q7=1e3,K7=["rooms","plan","draw","areaReview"],e5=(L,C)=>L.label?L.label:L.active?"Current floor":`Saved floor ${L.ordinal??C}`,i2=class{#C;#H=new N1;#V;#t=new t2;#r=new Map;#L=null;#a;#i=null;#l=null;#e=null;#h=!1;#f=!1;#u=!1;#d=Promise.resolve();#n=!1;#p=!1;#o="";#m=0;#S="";#s=!1;#M=!0;constructor(C,H){this.#C=C,this.#V=H}sync(C,H){if(this.#s)return;let V=this.#M;if(this.#M=C.host.connected,this.#L=C,this.#a=H,this.#C.patch({host:C.host,activity:C.activity,batteryPercent:C.batteryPercent,robotLabel:C.robotLabel,robots:C.robots,locale:C.language}),C.userKey!==this.#S){this.#S=C.userKey;let e=this.#t.load(C.userKey);this.#C.patch({view:e.view,appearance:e.appearance,labelsVisible:e.labels,quality:e.quality,cameras:e.cameras})}if(!C.host.administrator){this.#v(),this.#y("access-required");return}if(!C.host.connected){this.#v(),this.#u=!1,this.#p=!1;let e=this.#r.has("area-mutation")&&this.#C.value.command==="pending";this.#Z();let r=this.#C.value,t=r.resources.scene.value;this.#C.patch({command:e?"idle":r.command,coherence:t?"degraded":"unavailable",resources:{...r.resources,catalog:r.resources.catalog.status==="loading"?v("idle",r.resources.catalog.value):r.resources.catalog,plans:r.resources.plans.status==="loading"?v("idle",r.resources.plans.value):r.resources.plans,areas:r.resources.areas.status==="loading"?v("idle",r.resources.areas.value):r.resources.areas,pose:v("idle",null)},map:{...r.map,available:t!==null,exactPose:!1},notice:t?{tone:"warning",text:B0}:r.notice});return}if(C.host.robotCount===0){this.#v(),this.#y("map-unavailable");return}if(this.#x(),!V){this.#C.value.notice?.text===B0&&this.#C.patch({notice:null}),this.refreshCatalog(!0);return}(this.#C.value.resources.catalog.status==="idle"||C.entryKey&&C.entryKey!==this.#C.value.selection.entryId)&&this.refreshCatalog(!0)}schedulePreferences(C){this.#t.schedule(C)}#x(){this.#i===null&&(this.#i=window.setInterval(()=>{document.visibilityState==="visible"&&this.refreshCatalog()},5e3)),this.#l===null&&(this.#l=window.setInterval(()=>{document.visibilityState==="visible"&&this.refreshPose()},q7))}#v(){this.#i!==null&&window.clearInterval(this.#i),this.#l!==null&&window.clearInterval(this.#l),this.#i=null,this.#l=null}#A(C){this.#r.get(C)?.abort();let H=new AbortController;return this.#r.set(C,H),H}#c(C,H){this.#r.get(C)===H&&this.#r.delete(C)}#Z(C=[]){for(let[H,V]of this.#r)C.includes(H)||(V.abort(),this.#r.delete(H))}#y(C){this.#Z(),this.#H.invalidate(),this.#o="";let H=this.#C.value;this.#C.patch({generation:this.#H.generation,coherence:H.host.administrator?"unavailable":"blocked",fullMap:!1,precisionOpen:!1,resources:{catalog:v("error",null,C),entry:null,scene:v("idle",null),pose:v("idle",null),history:v("idle",null),plans:v("idle",null),areas:v("idle",null)},map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1},selection:{...H.selection,entryId:null,floorId:"current",historyId:null}})}async refreshCatalog(C=!1){if(this.#s||!this.#L?.host.administrator||!this.#L.host.connected||this.#L.host.robotCount===0)return;if(this.#h)return C&&!this.#f&&(this.#u=!0,this.#r.get("catalog")?.abort()),this.#d;this.#h=!0,this.#f=C;let H;this.#d=new Promise(r=>{H=r});let V=this.#A("catalog"),e=this.#C.value.resources.catalog.value;this.#C.patch({resources:{...this.#C.value.resources,catalog:v("loading",e)}});try{let r=await this.#V.catalog(V.signal);if(V.signal.aborted||this.#s)return;let t=this.#a?.config?.entry_id,o=typeof t=="string"?t:null,M=r.find(n=>n.entryId===this.#L?.entryKey)||r.find(n=>n.entryId===o)||r[0]||null,i=this.#C.value.resources.entry;if(M&&i&&G(M)===G(i)&&M2(M)===M2(i)&&o2(M)===o2(i)&&M.mapRevision<i.mapRevision&&(M={...M,mapRevision:i.mapRevision}),this.#C.patch({managedLock:M?_0(M):!1,resources:{...this.#C.value.resources,catalog:v(r.length?"ready":"empty",r),entry:M}}),!M){this.#y("no-loaded-robot");return}if(this.#C.value.selection.floorId!=="current"&&!C)return;let a=P0(M);if(!C&&a===this.#o){let n=this.#C.value,A=M.mapFloorCoherent&&M.mapSessionVerified,s=M.health==="problem"||M.health==="limited";this.#C.patch({coherence:A?s?"degraded":"current":"verifying",map:{...n.map,available:A&&n.resources.scene.value!==null,complete:M.mapComplete&&!M.mapTruncated,floorCoherent:M.mapFloorCoherent,sessionVerified:M.mapSessionVerified,exactPose:A?n.map.exactPose:!1},floor:{...n.floor,classifiedCount:Math.max(1,M.historyFloorCount)}}),A&&this.#C.value.resources.plans.problem==="map-rechecking"&&this.loadPlans();return}this.#o=a,this.#T(M)}catch(r){if(U(r))return;this.#C.patch({coherence:this.#C.value.resources.scene.value?"degraded":"unavailable",resources:{...this.#C.value.resources,catalog:v("error",e,l1(r,"catalog-unavailable"))}})}finally{this.#c("catalog",V),this.#h=!1;let r=this.#u;this.#f=!1;try{r&&!this.#s&&(this.#u=!1,await this.refreshCatalog(!0))}finally{H()}}}#T(C){let H=this.#C.value,V=H.resources.entry,e=!!(V&&G(V)===G(C)),r=C.mapFloorCoherent&&C.mapSessionVerified;this.#Z(e?["catalog","plans","areas","plan-mutation","area-mutation"]:["catalog"]);let t=e?H.resources.scene.value:null,o=H.resources.pose.value,M=e&&r&&C.mapSessionKey!==null&&o?.position&&o.mapSessionKey===C.mapSessionKey?o:null,i=this.#H.begin(C.entryId,M2(C),o2(C),C.mapRevision),a=C.health==="problem"||C.health==="limited",n=this.#C.value;this.#C.patch({managedLock:_0(C),generation:i.generation,coherence:r?a?"degraded":"current":"verifying",dataMode:"live",resources:{...n.resources,entry:C,scene:v(r?"loading":"idle",t),pose:v(r?"loading":"idle",M),history:v("loading",n.resources.history.value),plans:e?n.resources.plans:v("idle",null),areas:e?n.resources.areas:v("idle",null)},map:{available:r&&t!==null,complete:C.mapComplete&&!C.mapTruncated,floorCoherent:C.mapFloorCoherent,sessionVerified:C.mapSessionVerified,exactPose:r&&M!==null},floor:{classifiedCount:Math.max(1,C.historyFloorCount),displayName:C.selectedFloorOrdinal?`Floor ${C.selectedFloorOrdinal}`:"Current floor",readOnly:!1},selection:{...n.selection,entryId:C.entryId,floorId:"current",historyId:null,roomIds:e?n.selection.roomIds:[],planId:e?n.selection.planId:null,areaId:e?n.selection.areaId:null}}),this.#O(C,i),r&&this.#C.value.resources.plans.status==="idle"&&this.loadPlans(),r&&(this.#w(C,i),this.#k(C,i))}async#w(C,H){let V=this.#A("scene");try{let e=await this.#V.scene(C.sceneUrl,C.mapRevision,C.mapFloorCoherent,"live",V.signal);if(!this.#H.accepts(H)||e.revision!==H.revision||!e.floorCoherent||!e.scene)return;let r=this.#C.value;this.#C.patch({resources:{...r.resources,scene:v("ready",e.scene)},map:{...r.map,available:!0},notice:r.notice?.text===T0?null:r.notice});let t=this.#C.value.resources.plans;if((t.status==="idle"||t.problem==="map-rechecking")&&this.loadPlans(),C.deltaUrl){let o=++this.#m;this.#R(C,H,e.scene,o)}}catch(e){if(U(e)||!this.#H.accepts(H))return;if(e instanceof F&&e.code==="request-timeout"){let M=this.#C.value;this.#C.patch({resources:{...M.resources,scene:v("loading",M.resources.scene.value,"scene-building")}}),window.setTimeout(()=>{this.#s||!this.#H.accepts(H)||this.#C.value.selection.floorId!=="current"||this.#w(C,H)},250);return}let r=this.#C.value,t=r.resources.pose.value,o=r.resources.scene.value!==null&&C.mapSessionKey!==null&&t?.position!==null&&t?.mapSessionKey===C.mapSessionKey;this.#C.patch({coherence:"degraded",resources:{...r.resources,scene:v("error",r.resources.scene.value,l1(e,"scene-unavailable"))},map:{...r.map,available:r.resources.scene.value!==null,exactPose:o}})}finally{this.#c("scene",V)}}async#R(C,H,V,e){if(!C.deltaUrl||typeof DecompressionStream!="function")return;let r=C.deltaUrl,t=C,o=H,M=V;try{for(;!this.#s&&e===this.#m&&this.#H.accepts(o)&&this.#C.value.selection.floorId==="current";){let i=this.#A("delta");try{let a=await this.#V.sceneDelta(r,M,t.mapFloorCoherent,i.signal);if(i.signal.aborted||this.#s||e!==this.#m||!this.#H.accepts(o))return;if(!a.floorCoherent){this.#C.patch({coherence:"verifying",map:{...this.#C.value.map,available:!1,floorCoherent:!1,exactPose:!1},resources:{...this.#C.value.resources,pose:v("idle",null)}}),this.#o="",this.refreshCatalog(!0);return}if(a.notModified||!a.scene){await new Promise(s=>window.setTimeout(s,100));continue}let n=this.#H.advance(o,a.revision);if(!n)return;o=n,M=a.scene,t={...t,mapRevision:a.revision},this.#o=P0(t);let A=this.#C.value;this.#C.patch({resources:{...A.resources,entry:t,scene:v("ready",M)},map:{...A.map,available:!0,floorCoherent:!0}}),this.#k(t,o)}finally{this.#c("delta",i)}}}catch(i){if(U(i)||this.#s||e!==this.#m||!this.#H.accepts(o))return;this.#C.patch({coherence:"degraded",notice:{tone:"warning",text:T0}}),this.#o="",this.refreshCatalog(!0)}}async#O(C,H){let V=this.#A("history");try{let e=await this.#V.history(C.historyUrl,V.signal);if(!this.#H.accepts(H)||e.entryId!==C.entryId)return;let r=this.#C.value,t=e.floors.find(i=>i.id===r.selection.floorId),o=!r.selection.historyId||t?.snapshots.some(i=>i.id===r.selection.historyId),M=r.dataMode==="live"?e.floors.find(i=>i.active):t;if(this.#C.patch({resources:{...this.#C.value.resources,history:v("ready",e)},floor:{...this.#C.value.floor,classifiedCount:e.floors.length,...M?{displayName:e5(M,1)}:{}}}),r.dataMode==="history"&&(!t||!o)){let i=t||e.floors.find(n=>n.active)||e.floors[0],a=this.selectFloor(i?.id||"current");!this.#s&&r.workflow==="history"&&this.#C.dispatch({type:"open-workflow",workflow:"history"}),await a}}catch(e){if(U(e)||!this.#H.accepts(H))return;this.#C.patch({resources:{...this.#C.value.resources,history:v("error",null,l1(e,"history-unavailable"))}})}finally{this.#c("history",V)}}async refreshPose(){let C=this.#C.value.resources.entry,H=this.#H.current();!C||!H||this.#C.value.selection.floorId!=="current"||!C.mapFloorCoherent||!C.mapSessionVerified||await this.#k(C,H)}async#k(C,H){if(this.#s||!this.#M||!this.#L?.host.connected)return;if(this.#n){this.#p=!0;return}this.#n=!0;let V=this.#A("pose");try{let e=await this.#V.pose(C.poseUrl,V.signal),r=this.#H.current(),t=this.#C.value.resources.entry;if(!r||!Q7(H,r)||!t||!e.floorCoherent)return;if(e.mapSessionKey===null||e.mapSessionKey!==t.mapSessionKey){this.#C.patch({map:{...this.#C.value.map,exactPose:!1}}),this.#o="",this.refreshCatalog(!0);return}let o=this.#C.value,M=o.resources.pose.value,i=!!(o.map.exactPose&&M?.position&&M.mapSessionKey===t.mapSessionKey);if(e.position===null&&i){this.#C.patch({resources:{...o.resources,pose:v("ready",M)}});return}this.#C.patch({resources:{...o.resources,pose:v("ready",e)},map:{...o.map,exactPose:e.position!==null}})}catch(e){if(U(e)||!this.#H.accepts(H))return;let r=this.#C.value,t=r.resources.pose.value,o=!!(r.map.exactPose&&t?.position&&t.mapSessionKey===r.resources.entry?.mapSessionKey);this.#C.patch({resources:{...r.resources,pose:v("error",o?t:null,l1(e,"pose-unavailable"))},map:{...r.map,exactPose:o}})}finally{if(this.#c("pose",V),this.#n=!1,this.#p&&!this.#s&&this.#M&&this.#L?.host.connected&&this.#L.host.administrator&&this.#L.host.robotCount>0){this.#p=!1;let e=this.#C.value.resources.entry,r=this.#H.current();e&&r&&this.#k(e,r)}else this.#p=!1}}async selectFloor(C){let H=this.#C.value.resources.history.value,V=this.#C.value.resources.entry;if(!H||!V)return;let e=H.floors.find(M=>M.id===C);if(!e&&C!=="current")return;let r=this.#C.value;if(r.workflow==="draw"&&(r.draw.dirty||r.areaDraft.dirty)||r.workflow==="areaReview"&&(r.draw.dirty||r.areaDraft.dirty))return;if(!e||e.active){this.#o="";let M=this.#C.value;this.#C.patch({resources:{...M.resources,plans:v("idle",null),areas:v("idle",null),scene:v("idle",null),pose:v("idle",null)},map:{...M.map,available:!1,exactPose:!1},coherence:"verifying",floor:{...M.floor,readOnly:!1,displayName:"Current floor"},workflow:"none",precisionOpen:!1}),this.#C.dispatch({type:"set-floor",floorId:"current"}),await this.refreshCatalog(!0);return}let t=e.snapshots.at(-1);this.#Z(["catalog"]);let o=this.#H.begin(V.entryId,e.id,t?.id||e.id,t?.revision||0);this.#C.patch({generation:o.generation,coherence:"current",dataMode:"history",floor:{classifiedCount:H.floors.length,displayName:e5(e,H.floors.indexOf(e)+1),readOnly:!0},selection:{...this.#C.value.selection,floorId:e.id,historyId:t?.id||null},resources:{...this.#C.value.resources,scene:v(t?"loading":"empty",null),pose:v("idle",null),plans:v("idle",null),areas:v("idle",null)},workflow:"none",precisionOpen:!1,map:{available:!1,complete:!0,floorCoherent:!0,sessionVerified:!0,exactPose:!1}}),t&&await this.#P(t,o)}async selectHistory(C){let H=this.#C.value.resources.history.value,V=this.#C.value.resources.entry;if(!H||!V)return;if(!C){await this.selectFloor("current");return}let e=H.floors.find(o=>o.snapshots.some(M=>M.id===C)),r=e?.snapshots.find(o=>o.id===C);if(!e||!r)return;let t=this.#H.begin(V.entryId,e.id,r.id,r.revision);this.#Z(["catalog"]),this.#C.patch({generation:t.generation,dataMode:"history",floor:{classifiedCount:H.floors.length,displayName:e5(e,H.floors.indexOf(e)+1),readOnly:!0},selection:{...this.#C.value.selection,floorId:e.id,historyId:r.id},resources:{...this.#C.value.resources,scene:v("loading",null),pose:v("idle",null)},map:{...this.#C.value.map,available:!1,exactPose:!1}}),await this.#P(r,t)}async#P(C,H){let V=this.#A("history-scene");try{let e=await this.#V.scene(C.sceneUrl,C.revision,!0,"history",V.signal);if(!this.#H.accepts(H)||!e.scene)return;this.#C.patch({resources:{...this.#C.value.resources,scene:v("ready",e.scene)},map:{...this.#C.value.map,available:!0,exactPose:!1}})}catch(e){if(U(e)||!this.#H.accepts(H))return;this.#C.patch({resources:{...this.#C.value.resources,scene:v("error",null,l1(e,"history-scene-unavailable"))}})}finally{this.#c("history-scene",V)}}async openWorkflow(C){let H=this.#C.value;if((H.dataMode==="history"||H.floor.readOnly)&&K7.includes(C))return;let V=this.#C.value.workflow;if(C==="draw"&&V!=="draw"&&V!=="areaReview"&&this.selectArea(null),this.#C.dispatch({type:"open-workflow",workflow:C}),C==="history"){let e=this.#C.value.resources.entry,r=this.#H.current();e&&r&&(this.#C.patch({resources:{...this.#C.value.resources,history:v("loading",this.#C.value.resources.history.value)}}),await this.#O(e,r))}(C==="plan"||C==="rooms")&&await this.loadPlans(),(C==="draw"||C==="areaReview")&&await this.loadAreas()}async loadPlans(){let C=this.#C.value.resources.entry;if(!C||!this.#H.current()||!v2(this.#C.value)||this.#C.value.resources.plans.status==="loading")return;let H=G(C),V=this.#A("plans");this.#C.patch({resources:{...this.#C.value.resources,plans:v("loading",null)}});try{let e=await this.#V.plans(C.plansUrl,V.signal),r=this.#C.value.resources.entry;if(!r||G(r)!==H)return;if(this.#C.value.planDraft.dirty){this.#C.patch({resources:{...this.#C.value.resources,plans:v("ready",e)}});return}let t=e.selectedPlan||e.plans[0]?.id||null,o=e.plans.find(M=>M.id===t);this.#C.patch({resources:{...this.#C.value.resources,plans:v("ready",e)},selection:{...this.#C.value.selection,planId:t},planDraft:o?this.#g(o):{...this.#C.value.planDraft,id:null,name:"",rooms:[],dirty:!1}})}catch(e){let r=this.#C.value.resources.entry;if(U(e)||!r||G(r)!==H)return;let t=e instanceof F&&e.code==="map-rechecking"?"map-rechecking":l1(e,"plans-unavailable");this.#C.patch({resources:{...this.#C.value.resources,plans:v("error",null,t)}})}finally{this.#c("plans",V)}}selectPlan(C){let H=this.#C.value.resources.plans.value?.plans.find(V=>V.id===C);this.#C.patch({selection:{...this.#C.value.selection,planId:C},planDraft:H?this.#g(H):{...this.#C.value.planDraft,id:null,name:"",rooms:[],dirty:!1}})}#g(C){return{id:C.id,name:C.name,enabled:C.enabled,runBehavior:C.runBehavior,rooms:(C.roomOrder.length?C.roomOrder.flatMap(H=>{let V=C.rooms.find(e=>e.roomId===H);return V?[V]:[]}):C.rooms).map(H=>({...H})),returnToBase:C.returnToBase,finishCurrentRoom:C.finishCurrentRoom,finishCurrentRoomThreshold:C.finishCurrentRoomThreshold,dirty:!1}}async loadAreas(){let C=this.#C.value.resources.entry;if(!C||!this.#H.current()||!v2(this.#C.value))return;let H=G(C),V=this.#A("areas");this.#C.patch({resources:{...this.#C.value.resources,areas:v("loading",null)}});try{let e=await this.#V.areas(C.areasUrl,V.signal),r=this.#C.value.resources.entry;if(!r||G(r)!==H||e.sceneUrl!==r.sceneUrl)return;this.#C.patch({resources:{...this.#C.value.resources,areas:v("ready",e)}});let t=this.#C.value.selection.areaId,o=this.#C.value;(t!==null||!o.draw.dirty&&!o.areaDraft.dirty)&&this.selectArea(e.areas.some(M=>M.id===t)?t:null)}catch(e){let r=this.#C.value.resources.entry;if(U(e)||!r||G(r)!==H)return;this.#C.patch({resources:{...this.#C.value.resources,areas:v("error",null,l1(e,"areas-unavailable"))}})}finally{this.#c("areas",V)}}selectArea(C){let H=this.#C.value.resources.areas.value?.areas.find(e=>e.id===C),V=this.#C.value;this.#C.patch({selection:{...V.selection,areaId:C},areaDraft:H?this.#B(H):{id:null,name:"",cleaningMode:"vacuum",coverageSetting:"standard",status:"new",canRebind:!1,dirty:!1},draw:{...V.draw,circles:H?.circles||[],undo:[],redo:[],dirty:!1,strokeCount:0}})}#B(C){return{id:C.id,name:C.name,cleaningMode:C.cleaningMode,coverageSetting:C.coverageSetting,status:C.status,canRebind:C.canRebind,dirty:!1}}async saveArea(){let C=this.#C.value,H=C.resources.entry,V=C.areaDraft;if(!H||!q(C)||!V.name.trim()||!C.draw.circles.length)return;let e=this.#A("area-mutation");this.#C.patch({command:"pending",notice:{tone:"info",text:"Saving area\u2026"}});try{let r=await this.#V.saveArea(H.areasUrl,{areaId:V.id,name:V.name.trim(),circles:C.draw.circles,cleaningMode:V.cleaningMode,coverageSetting:V.coverageSetting},e.signal);this.#C.patch({command:"idle",notice:{tone:"success",text:"Area saved"}}),await this.loadAreas(),this.selectArea(r)}catch(r){if(U(r))return;this.#C.patch({command:"failed",notice:{tone:"error",text:"Area could not be saved"}})}finally{this.#c("area-mutation",e)}}async deleteArea(){let C=this.#C.value.resources.entry,H=this.#C.value.selection.areaId;if(!C||!H||!q(this.#C.value))return;let V=this.#A("area-mutation");try{await this.#V.deleteArea(C.areasUrl,H,V.signal),this.#C.patch({notice:{tone:"success",text:"Area deleted"}}),await this.loadAreas()}catch(e){U(e)||this.#C.patch({notice:{tone:"error",text:"Area could not be deleted"}})}finally{this.#c("area-mutation",V)}}async savePlan(){let C=this.#C.value,H=C.planDraft,V=C.resources.plans.value;if(!V||!H.name.trim()||!H.rooms.length||!q(C))return;let e=H.rooms;await this.#_("save_plan",{...H.id?{plan_id:H.id}:{},name:H.name.trim(),enabled:H.enabled,run_behavior:H.runBehavior,rooms:e.map(t=>({room:V.rooms.find(o=>o.roomId===t.roomId)?.name,cleaning_mode:t.cleaningMode,coverage_setting:t.coverageSetting})).filter(t=>t.room),return_to_base:H.returnToBase,finish_current_room:H.finishCurrentRoom,finish_current_room_threshold:H.finishCurrentRoomThreshold,select:!H.id||V.selectedPlan===H.id},"Plan saved","Plan could not be saved")&&(this.#C.patch({planDraft:{...this.#C.value.planDraft,dirty:!1}}),await this.loadPlans())}async deletePlan(){let C=this.#C.value.selection.planId,H=this.#C.value.selection.entryId;if(!C)return;await this.#_("delete_plan",{plan:C},"Plan deleted","Plan could not be deleted")&&(this.#C.value.selection.entryId===H&&this.#C.value.planDraft.id===C&&this.selectPlan(null),await this.loadPlans())}async executeAction(C){switch(C){case"recheck-status":{let H=this.#C.value.selection.entryId;await this.refreshCatalog(!0);let V=this.#C.value;!this.#s&&V.selection.entryId===H&&V.resources.catalog.status==="ready"&&V.host.connected&&V.host.robotConnected&&V.coherence==="current"&&V.command==="failed"&&this.#C.patch({command:"idle",notice:{tone:"info",text:"Status refreshed. Review the robot state before trying again."}});return}case"stop":await this.#b("matic_robot","stop_intelligent_cleaning",{include_unmanaged:!0});return;case"resume":await this.#b("vacuum","start",{});return;case"run-plan":{let H=this.#C.value.selection.planId||this.#C.value.resources.plans.value?.selectedPlan;H&&await this.#b("matic_robot","run_selected_plan",{plan:H});return}case"clean-rooms":{let H=this.#C.value.resources.plans.value,e=this.#C.value.selection.roomSettings.map(r=>({room:H?.rooms.find(t=>t.roomId===r.roomId)?.name,cleaning_mode:r.cleaningMode,coverage_setting:r.coverageSetting})).filter(r=>r.room);e.length&&await this.#b("matic_robot","clean_room_sequence",{rooms:e,return_to_base:!0});return}case"run-area":{let H=this.#C.value.selection.areaId;H&&await this.#b("matic_robot","clean_area",{area:H});return}case"review-area":this.#C.dispatch({type:"open-workflow",workflow:"areaReview"});return;case"save-area":await this.saveArea();return;case"save-plan":await this.savePlan();return;case"delete-plan":await this.deletePlan();return;case"delete-area":await this.deleteArea();return}}async#_(C,H,V,e){let r=this.#L?.vacuumEntityId;if(!r||!q(this.#C.value)||this.#C.value.command==="pending")return!1;this.#C.patch({command:"pending",notice:{tone:"info",text:"Saving\u2026"}});try{return await this.#V.service("matic_robot",C,H,r),this.#C.patch({command:"idle",notice:{tone:"success",text:V}}),!0}catch{return this.#C.patch({command:"failed",notice:{tone:"error",text:e}}),!1}}async#b(C,H,V){let e=this.#C.value,r=this.#L?.vacuumEntityId,t=H==="stop_intelligent_cleaning"||C==="vacuum"&&H==="return_to_base";if(!(!r||(t?!c2(e):!m1(e)))){this.#C.patch({command:"pending",notice:null});try{await this.#V.service(C,H,V,r);let o=t?"settling":"starting";this.#C.patch({command:o}),this.#e!==null&&window.clearTimeout(this.#e),this.#e=window.setTimeout(()=>{this.#e=null,this.#C.value.command===o&&this.#C.patch({command:"idle"})},15e3)}catch{this.#C.patch({command:"failed",notice:{tone:"error",text:"The action could not be confirmed. Check the robot status before trying again."}})}}}updateDraftCircles(C,H=!0,V){this.#C.dispatch({type:"set-draft-circles",circles:C,record:H,...V?{previous:V}:{}}),this.#C.dispatch({type:"patch-area-draft",patch:{dirty:!0}})}dispose(){this.#s||(this.#s=!0,this.#v(),this.#Z(),this.#e!==null&&window.clearTimeout(this.#e),this.#e=null,this.#t.dispose(),this.#V.dispose(),this.#H.invalidate())}};var R0=L=>(L.workflow==="none"?0:1)+(L.fullMap?1:0)+(L.precisionOpen?1:0)+(L.dialog?1:0),F0=L=>{if(!L||typeof L!="object")return null;let C=L.maticMapLayer;if(!C||typeof C!="object")return null;let H=C.owner,V=C.depth;return typeof H=="string"&&Number.isInteger(V)&&Number(V)>=0?{owner:H,depth:Number(V)}:null},a2=class{#C;#H=`matic-map-${crypto.randomUUID?.()||Math.random().toString(36).slice(2)}`;#V=0;#t=null;#r=!1;#L=!1;constructor(C){this.#C=C}start(){this.#t||(this.#V=R0(this.#C.value),this.#t=this.#C.subscribe(C=>this.#a(C)),window.addEventListener("popstate",this.#i))}#a(C){let H=R0(C);if(this.#r){this.#r=!1,this.#V=H;return}if(H<this.#V){let V=F0(history.state);if(V?.owner===this.#H&&V.depth===this.#V){let e=H-this.#V;this.#V=H,this.#L=!0,history.go(e);return}}if(H>this.#V)for(let V=this.#V+1;V<=H;V+=1){let e=history.state&&typeof history.state=="object"?history.state:{};history.pushState({...e,maticMapLayer:{owner:this.#H,depth:V}},"",window.location.href)}this.#V=H}#i=()=>{if(this.#L){this.#L=!1;return}if(!(this.#V<1)){if(e1(this.#C.value,{type:"dismiss-top-layer"})){let C=history.state&&typeof history.state=="object"?history.state:{};history.pushState({...C,maticMapLayer:{owner:this.#H,depth:this.#V}},"",window.location.href),this.#C.dispatch({type:"open-dialog",dialog:"discardDraft"});return}this.#r=!0,this.#C.dispatch({type:"dismiss-top-layer"})}};dismissTop(){if(this.#V<1)return!1;let C=F0(history.state);return C?.owner===this.#H&&C.depth===this.#V?history.back():this.#C.dispatch({type:"dismiss-top-layer"}),!0}dispose(){this.#t?.(),this.#t=null,window.removeEventListener("popstate",this.#i),this.#V=0,this.#L=!1}};var E0=J(n1),r5=class extends O{constructor(){super(...arguments);this.narrow=!1;this._workspace=k();this._classic=!1;this.entryOverride=null;this.#C=new U1;this.#H=new v1(this._workspace);this.#V=null;this.#t=null;this.#r=null;this.#L=null;this.#a=null;this.#i=""}static{this.styles=[D,$,b`
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
`]}static{this.properties={hass:{attribute:!1},narrow:{type:Boolean},route:{attribute:!1},panel:{attribute:!1},_workspace:{state:!0},_classic:{state:!0},entryOverride:{state:!0}}}#C;#H;#V;#t;#r;#L;#a;#i;connectedCallback(){super.connectedCallback(),this._classic=k0()==="v3",this.#t=this.#H.subscribe(H=>{this._workspace=H,this.#h(H)}),this._classic||this.#l()}disconnectedCallback(){this.#t?.(),this.#t=null,this.#e(),super.disconnectedCallback()}#l(){if(!this.#L&&(this.#V=this.#C.project(this.hass,this.panel,this.entryOverride),this.#r=new r2(()=>this.hass),this.#L=new i2(this.#H,this.#r),this.#a=new a2(this.#H),this.#a.start(),this.#V)){this.#L.sync(this.#V,this.panel);let{host:H}=this.#V;H.connected&&H.administrator&&H.robotCount>0&&this.#L.refreshCatalog(this.#H.value.selection.floorId==="current")}}#e(){this.#a?.dispose(),this.#a=null,this.#L?.dispose(),this.#L=null,this.#r=null}#h(H){if(!this.#L)return;let V={version:4,view:H.view,appearance:H.appearance,labels:H.labelsVisible,quality:H.quality,cameras:H.cameras},e=JSON.stringify(V);e!==this.#i&&(this.#i=e,this.#L.schedulePreferences(V))}willUpdate(H){if(H.has("hass")||H.has("panel")||H.has("entryOverride")){let V=this.#C.project(this.hass,this.panel,this.entryOverride);if(V!==this.#V){this.#V=V;let e=V.host.connected?V.host.robotCount===0?"unavailable":V.host.administrator?"verifying":"blocked":"degraded";this.#H.replace({...this.#H.value,coherence:e,activity:V.activity,batteryPercent:V.batteryPercent,host:V.host,fullMap:V.host.administrator&&V.host.robotCount>0&&this.#H.value.fullMap,robotLabel:V.robotLabel,robots:V.robots,locale:V.language})}this._classic||this.#L?.sync(V,this.panel)}H.has("narrow")&&this.#H.value.narrowHint!==this.narrow&&this.#H.dispatch({type:"set-narrow-hint",value:this.narrow})}#f(H){if(!d1(H.detail))return;H.stopPropagation();let V=H.detail;if(V.type==="dismiss-top-layer"||V.type==="exit-full-map"){this.#a?.dismissTop()||this.#H.dispatch(V);return}if(V.type==="open-workflow"&&V.workflow!=="none"){this.#L?.openWorkflow(V.workflow);return}if(V.type==="set-floor"){this.#L?.selectFloor(V.floorId);return}if(V.type==="select-entry"){if(!this._workspace.robots.some(e=>e.entryId===V.entryId))return;this.entryOverride=V.entryId;return}if(V.type==="set-history"){this.#L?.selectHistory(V.historyId);return}if(V.type==="select-plan"){this.#L?.selectPlan(V.planId);return}if(V.type==="select-area"){this.#L?.selectArea(V.areaId);return}this.#H.dispatch(V)}#u(H){if(H.stopPropagation(),typeof H.detail?.id=="string"){if(H.detail.id==="use-classic"){L5("v3")&&(this.#e(),this._classic=!0);return}this.#L?.executeAction(H.detail.id),this.dispatchEvent(new CustomEvent("matic-map-v4-action-requested",{detail:{id:H.detail.id},bubbles:!0,composed:!0}))}}#d(){L5("v4")&&(this._classic=!1,this.#l(),this.requestUpdate())}updated(){if(!this._classic)return;let H=this.renderRoot.querySelector("matic-map-panel-v0-3-1");H&&(H.hass=this.hass,H.narrow=this.narrow,H.route=this.route,H.panel=this.panel)}getWorkspaceSnapshot(){return this.#H.value}render(){return this._classic?c`
        <div class="classic">
          <button class="return-v4" type="button" @click=${this.#d}>${T(this.hass?.localize,"v4_use_new","Use Map Studio 0.4")}</button>
          <matic-map-panel-v0-3-1></matic-map-panel-v0-3-1>
        </div>
      `:c`
      <${E0}
        .state=${this._workspace}
        .localize=${this.hass?.localize}
        @matic-workspace-intent=${this.#f}
        @matic-workspace-action=${this.#u}
      ></${E0}>
    `}};customElements.get(E2)||customElements.define(E2,r5);export{N1 as CoherenceMachine,b1 as DRAW_BRUSH_MAX_METERS,s1 as DRAW_BRUSH_MIN_METERS,h2 as GALLERY_SCENARIOS,U1 as HassAdapter,m2 as MAP_PIXELS_PER_METER_AT_100,i5 as MAP_ZOOM_MAX,y1 as MAP_ZOOM_MIN,E2 as MATIC_MAP_PANEL_TAG,r5 as MaticMapPanelV4,J2 as MaticMapStudioGalleryV4,v1 as WorkspaceStore,C4 as brushCursorPixels,q as canEditCoordinates,v2 as canReadFloorResources,A5 as canShowExactPose,c1 as canShowLiveMap,m1 as canStartMotion,c2 as canStopMotion,H4 as commandState,Z2 as createGalleryState,k as initialWorkspaceState,d1 as isWorkspaceIntent,p5 as mapScale,N0 as normalizeBrush,a5 as normalizeZoom,z0 as reduceWorkspace,d5 as selectPausedSecondaryAction,s5 as selectPrimaryAction};
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
