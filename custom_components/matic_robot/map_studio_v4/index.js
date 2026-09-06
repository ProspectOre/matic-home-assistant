var _1=100,g5=1e3,v1=.2,T1=2.5,B2=64,u1=L=>!L||typeof L!="object"?!1:typeof L.type=="string";var C1=(L,C)=>{let H=L.workflow==="plan"&&L.planDraft.dirty,V=(L.workflow==="draw"||L.workflow==="areaReview")&&(L.draw.dirty||L.areaDraft.dirty);if(!H&&!V)return!1;switch(C.type){case"open-workflow":return H?C.workflow!=="plan":C.workflow!=="draw"&&C.workflow!=="areaReview";case"select-plan":return H;case"select-area":return V;case"set-floor":return C.floorId!==L.selection.floorId;case"select-entry":return C.entryId!==L.selection.entryId;case"set-history":return!0;case"dismiss-top-layer":return!L.dialog&&!L.precisionOpen&&!L.fullMap;default:return!1}};var x1=()=>({status:"idle",value:null,problem:null}),b5=new Set(["rooms","plan","draw","areaReview"]),l7=L=>L.dataMode==="history"||L.floor.readOnly,Q=(L,C,H)=>Math.max(C,Math.min(H,L)),A7=L=>({yaw:Q(Number.isFinite(L.yaw)?L.yaw:0,-Math.PI,Math.PI),pitch:Q(Number.isFinite(L.pitch)?L.pitch:Math.PI/2-.018,.18,Math.PI/2-.018),zoom:Q(Number.isFinite(L.zoom)?L.zoom:1,.01,100),targetX:Q(Number.isFinite(L.targetX)?L.targetX:0,-1e4,1e4),targetZ:Q(Number.isFinite(L.targetZ)?L.targetZ:0,-1e4,1e4)}),y5=L=>Math.round(Q(Number.isFinite(L)?L:100,100,1e3)),s7=L=>Math.round(Q(Number.isFinite(L)?L:.2,.2,2.5)*100)/100,y=()=>({owner:null,draftFloorOrdinal:null,generation:0,coherence:"verifying",dataMode:"live",activity:"unknown",workflow:"none",command:"idle",fullMap:!1,precisionOpen:!1,dialog:null,narrowHint:!1,view:"top",appearance:"photo",labelsVisible:!0,quality:"auto",cameras:{},managedLock:!1,batteryPercent:null,floor:{classifiedCount:1,displayName:"Current floor",readOnly:!1},map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1},host:{connected:!0,administrator:!0,robotConnected:!1,robotCount:0},draw:{zoomPercent:100,zoomOriginX:50,zoomOriginY:50,brushMeters:.6,tool:"paint",dirty:!1,strokeCount:0,circles:[],undo:[],redo:[]},resources:{catalog:x1(),entry:null,scene:x1(),pose:x1(),history:x1(),plans:x1(),areas:x1()},selection:{entryId:null,floorId:"current",historyId:null,roomIds:[],roomSettings:[],cleaningMode:"vacuum",coverageSetting:"standard",planId:null,areaId:null},planDraft:{id:null,name:"",enabled:!0,runBehavior:"intelligent",rooms:[],returnToBase:!0,finishCurrentRoom:!1,finishCurrentRoomThreshold:50,dirty:!1},areaDraft:{id:null,name:"",cleaningMode:"vacuum",coverageSetting:"standard",status:"new",canRebind:!1,dirty:!1},notice:null,robotLabel:"Matic robot",robots:[],locale:"en"}),z=(L,C)=>({...L,draw:{...L.draw,...C}}),d7=(L,C)=>{switch(C.type){case"set-host":return{...L,host:C.host,fullMap:C.host.administrator&&C.host.robotCount>0?L.fullMap:!1};case"set-operational-state":return{...L,coherence:C.coherence,activity:C.activity,command:C.command??L.command};case"set-narrow-hint":return{...L,narrowHint:C.value};case"set-view":return{...L,view:C.view};case"set-appearance":return{...L,appearance:C.appearance};case"set-quality":return{...L,quality:C.quality};case"set-camera":return{...L,cameras:{...L.cameras,[C.view]:A7(C.camera)}};case"toggle-labels":return{...L,labelsVisible:!L.labelsVisible};case"open-workflow":return l7(L)&&b5.has(C.workflow)?L:{...L,workflow:C.workflow,precisionOpen:!1};case"enter-full-map":return L.host.administrator&&L.host.robotCount>0&&L.map.available?{...L,fullMap:!0}:L;case"exit-full-map":return{...L,fullMap:!1,precisionOpen:!1};case"set-precision-open":return{...L,precisionOpen:C.value};case"set-zoom":return z(L,{zoomPercent:y5(C.value),...C.originX===void 0?{}:{zoomOriginX:Q(C.originX,0,100)},...C.originY===void 0?{}:{zoomOriginY:Q(C.originY,0,100)}});case"step-zoom":return z(L,{zoomPercent:y5(L.draw.zoomPercent*C.factor)});case"fit-map":return z(L,{zoomPercent:100,zoomOriginX:50,zoomOriginY:50});case"set-brush":return z(L,{brushMeters:s7(C.value)});case"set-draw-tool":return z(L,{tool:C.tool});case"mark-draft":{let H=Math.max(0,L.draw.strokeCount+C.strokeDelta);return z(L,{dirty:H>0,strokeCount:H})}case"undo-draft":{let H=L.draw.undo.at(-1);return H?z(L,{circles:H,outline:L.draw.outlineUndo?.at(-1)??null,outlineUndo:L.draw.outlineUndo?.slice(0,-1)??[],outlineRedo:[...L.draw.outlineRedo??[],L.draw.outline??null],undo:L.draw.undo.slice(0,-1),redo:[...L.draw.redo,L.draw.circles],dirty:!0,strokeCount:Math.max(0,L.draw.strokeCount-1)}):L}case"clear-draft":return!L.draw.circles.length&&!L.draw.outline?.points.length?L:z(L,{circles:[],outline:null,outlineUndo:[...(L.draw.outlineUndo??[]).slice(-99),L.draw.outline??null],outlineRedo:[],undo:[...L.draw.undo.slice(-99),L.draw.circles],redo:[],dirty:!0,strokeCount:L.draw.strokeCount+1});case"redo-draft":{let H=L.draw.redo.at(-1);return H?z(L,{circles:H,outline:L.draw.outlineRedo?.at(-1)??null,outlineUndo:[...L.draw.outlineUndo??[],L.draw.outline??null],outlineRedo:L.draw.outlineRedo?.slice(0,-1)??[],undo:[...L.draw.undo,L.draw.circles],redo:L.draw.redo.slice(0,-1),dirty:!0,strokeCount:L.draw.strokeCount+1}):L}case"set-draft-circles":{let H=C.circles.slice(0,512).map(e=>({...e})),V=C.record!==!1;return z(L,{circles:H,outline:C.outline??null,outlineUndo:V?[...(L.draw.outlineUndo??[]).slice(-99),C.previousOutline!==void 0?C.previousOutline:L.draw.outline??null]:L.draw.outlineUndo??[],outlineRedo:V?[]:L.draw.outlineRedo??[],undo:V?[...L.draw.undo.slice(-99),C.previous??L.draw.circles]:L.draw.undo,redo:V?[]:L.draw.redo,dirty:!0,strokeCount:V?L.draw.strokeCount+1:L.draw.strokeCount})}case"discard-draft":return L.workflow==="plan"?{...L,planDraft:y().planDraft,selection:{...L.selection,planId:null},dialog:null,workflow:"none",precisionOpen:!1}:{...z(L,{dirty:!1,strokeCount:0,circles:[],outline:null,outlineUndo:[],outlineRedo:[],undo:[],redo:[]}),areaDraft:y().areaDraft,selection:{...L.selection,areaId:null},dialog:null,workflow:"none",precisionOpen:!1};case"toggle-room":{let H=L.selection.roomIds.includes(C.roomId);return{...L,selection:{...L.selection,roomIds:H?L.selection.roomIds.filter(V=>V!==C.roomId):[...L.selection.roomIds,C.roomId],roomSettings:H?L.selection.roomSettings.filter(V=>V.roomId!==C.roomId):[...L.selection.roomSettings,{roomId:C.roomId,cleaningMode:"vacuum",coverageSetting:"standard"}]}}}case"patch-room-settings":return{...L,selection:{...L.selection,roomSettings:L.selection.roomSettings.map(H=>H.roomId===C.roomId?{...H,...C.cleaningMode?{cleaningMode:C.cleaningMode}:{},...C.coverageSetting?{coverageSetting:C.coverageSetting}:{}}:H)}};case"set-floor":return{...L,dataMode:C.floorId==="current"?"live":"history",selection:{...L.selection,floorId:C.floorId,historyId:null}};case"select-entry":return L;case"set-history":return{...L,dataMode:C.historyId?"history":"live",selection:{...L.selection,historyId:C.historyId}};case"select-plan":return{...L,selection:{...L.selection,planId:C.planId}};case"select-area":return{...L,selection:{...L.selection,areaId:C.areaId},workflow:C.workflow==="areaReview"?"areaReview":L.workflow};case"patch-plan-draft":return{...L,planDraft:{...L.planDraft,...C.patch,dirty:C.patch.dirty??!0}};case"patch-area-draft":return{...L,areaDraft:{...L.areaDraft,...C.patch,dirty:C.patch.dirty??!0}};case"set-notice":return{...L,notice:C.notice};case"open-dialog":return{...L,dialog:C.dialog};case"dismiss-top-layer":return C1(L,C)?{...L,dialog:"discardDraft"}:L.dialog?{...L,dialog:null}:L.precisionOpen?{...L,precisionOpen:!1}:L.fullMap?{...L,fullMap:!1}:L.workflow!=="none"?{...L,workflow:"none",precisionOpen:!1}:L;case"return-live":return{...L,dataMode:"live",workflow:"none",floor:{...L.floor,readOnly:!1}}}},Z1=class{#C=new Set;#H;constructor(C=y()){this.#H=C}get value(){return this.#H}dispatch(C){let H=d7(this.#H,C);if(H===this.#H)return H;this.#H=H;for(let V of this.#C)V(H);return H}replace(C){if(C!==this.#H){this.#H=C;for(let H of this.#C)H(C)}}patch(C){let H={...this.#H,...C};return this.replace(H),H}subscribe(C){return this.#C.add(C),C(this.#H),()=>this.#C.delete(C)}},X1=class{#C=null;#H=0;get generation(){return this.#H}begin(C,H,V,e){return this.#H+=1,this.#C={entryKey:C,generation:this.#H,floorKey:H,missionKey:V,revision:e},this.#C}current(){return this.#C}accepts(C){let H=this.#C;return!!(H&&C.entryKey===H.entryKey&&C.generation===H.generation&&C.floorKey===H.floorKey&&C.missionKey===H.missionKey&&C.revision===H.revision)}advance(C,H){return!this.accepts(C)||!Number.isSafeInteger(H)||H<=C.revision?null:(this.#C={...C,revision:H},this.#C)}invalidate(){return this.#H+=1,this.#C=null,this.#H}},S1=L=>L.dataMode==="live"&&L.map.available&&(L.coherence==="current"||L.coherence==="degraded")&&L.host.administrator,O5=L=>S1(L)&&(L.coherence==="current"||L.coherence==="degraded")&&L.map.floorCoherent&&L.map.sessionVerified&&L.map.exactPose&&L.host.connected&&L.host.robotConnected,_=L=>S1(L)&&L.coherence==="current"&&L.map.complete&&L.map.floorCoherent&&L.map.sessionVerified&&L.host.connected&&L.host.robotConnected&&!L.floor.readOnly,R2=L=>S1(L)&&L.coherence==="current"&&L.map.floorCoherent&&L.map.sessionVerified&&L.host.connected&&L.host.robotConnected&&!L.floor.readOnly,h1=L=>_(L)&&!L.managedLock&&L.command==="idle"&&(L.activity==="idle"||L.activity==="docked"),E2=L=>_(L)&&L.command==="idle"&&L.activity==="paused"&&L.resources.entry?.stopSettlePending!==!0,N=(L,C,H,V,e)=>({id:L,label:C,labelKey:V,kind:"neutral",enabled:!1,reason:H,reasonKey:e}),F2=L=>L.command==="starting"||L.activity==="cleaning"||L.activity==="paused"||L.activity==="returning"||L.activity==="recharging"||L.resources.entry?.runnerLocked===!0||L.resources.entry?.activePlan===!0||L.resources.entry?.nativeSessionActive===!0,D2=L=>L.host.connected&&L.host.administrator&&L.host.robotConnected&&(L.command==="idle"||L.command==="failed"||L.command==="starting")&&F2(L),w5=L=>{let C=D2(L);return{id:"stop",label:"Stop",labelKey:"v4_action_stop",kind:"danger",enabled:C,...C?{}:{reason:"The robot is already stopping.",reasonKey:"v4_reason_stop"}}},$2=L=>{if(L.dataMode==="history")return{id:"return-live",label:"Return to the live map",labelKey:"v4_action_return_live",kind:"primary",enabled:!0};if(L.floor.readOnly&&b5.has(L.workflow))return N("read-only","Live map required","Return to the live map to edit cleaning tasks.","v4_action_live_map_required","v4_reason_live_map_required");if(L.activity!=="paused"&&F2(L))return w5(L);let C=L.workflow==="plan"&&L.planDraft.dirty||(L.workflow==="draw"||L.workflow==="areaReview")&&(L.draw.dirty||L.areaDraft.dirty);if(L.command==="failed"&&!C)return{id:"recheck-status",label:"Check robot status",labelKey:"v4_recheck_robot",kind:"primary",enabled:L.host.connected&&L.host.administrator&&L.host.robotConnected,reason:"Refresh the robot state before trying the action again.",reasonKey:"v4_recheck_robot_reason"};if(L.activity==="stopping"||L.command==="settling")return N("stopping","Stopping","Waiting for the robot to settle.","v4_action_stopping","v4_reason_stopping");if(L.command==="starting")return N("starting","Starting","Waiting for the robot to begin.","v4_action_starting","v4_reason_starting");if(L.activity==="paused")return{id:"resume",label:"Resume cleaning",labelKey:"v4_action_resume",kind:"primary",enabled:E2(L)};if(!L.host.connected)return N("reconnecting","Reconnecting","Home Assistant is offline.","v4_action_reconnecting","v4_reason_reconnecting");if(!L.host.administrator)return N("administrator","Administrator access required","Ask a Home Assistant administrator to open this map.","v4_action_administrator","v4_reason_administrator");if(L.host.robotCount===0)return N("setup","Set up a Matic robot","Add the Matic integration to get started.","v4_set_up_robot","v4_setup_reason");if(L.activity==="problem")return N("problem","Check the robot","Resolve the robot's problem before starting another task.","v4_check_robot","v4_problem_reason");if(!L.host.robotConnected)return N("robot-offline","Robot offline","Reconnect the robot to start cleaning.","v4_action_robot_offline","v4_reason_robot_offline");if(L.coherence==="unavailable"||L.coherence==="blocked")return N("map-unavailable","Map unavailable","Open Map diagnostics to check why the map is unavailable.","v4_map_unavailable","v4_map_unavailable_reason");if(L.coherence!=="current")return N("locating","Finding the map","Waiting for the robot to confirm which floor it is on.","v4_action_locating","v4_reason_locating");if((L.workflow==="plan"||L.workflow==="rooms")&&L.resources.plans.status!=="ready"){let H=L.resources.plans.status==="error"||L.resources.plans.status==="empty";return N("plans-unavailable",H?"Rooms and plans unavailable":"Loading rooms and plans\u2026","Load the room and plan list before choosing a cleaning action.",H?"v4_plans_unavailable_action":"v4_loading_rooms_plans","v4_plans_required_reason")}if(L.workflow==="draw"){let H={reason:"Draw the area first.",reasonKey:"v4_reason_save_area_draw"},V=L.draw.circles.length>0&&(!L.draw.outline||L.draw.outline.closed);return{id:"review-area",label:"Name and save",labelKey:"v4_action_review_area",kind:"primary",enabled:V&&_(L),...V?{}:H}}if(L.workflow==="rooms"){let H=L.selection.roomIds.length,V=h1(L)&&H>0;return{id:"clean-rooms",label:H?`Clean ${H} room${H===1?"":"s"}`:"Clean selected rooms",...H?{}:{labelKey:"v4_action_clean_rooms"},kind:"primary",enabled:V,...V?{}:H?{reason:"Waiting for the current map to be verified.",reasonKey:"v4_reason_clean_rooms_verification"}:{reason:"Select at least one room to clean.",reasonKey:"v4_reason_clean_rooms_empty"}}}if(L.workflow==="plan"){if(L.planDraft.dirty||!L.planDraft.id){let H=_(L)&&L.planDraft.name.trim().length>0&&L.planDraft.rooms.length>0;return{id:"save-plan",label:"Save plan",labelKey:"v4_action_save_plan",kind:"primary",enabled:H,...H?{}:{reason:"Add a plan name and at least one room.",reasonKey:"v4_reason_save_plan"}}}return{id:"run-plan",label:"Run this plan",labelKey:"v4_action_run_plan",kind:"primary",enabled:h1(L)&&L.planDraft.enabled,...h1(L)?L.planDraft.enabled?{}:{reason:"This plan is paused. Enable it to run.",reasonKey:"v4_reason_run_plan_paused"}:{reason:"Waiting for the current map to be verified.",reasonKey:"v4_reason_run_plan"}}}if(L.workflow==="areaReview"){if(L.areaDraft.dirty||L.draw.dirty||!L.areaDraft.id||L.areaDraft.canRebind){let V=_(L)&&L.areaDraft.name.trim().length>0&&L.draw.circles.length>0;return{id:"save-area",label:L.areaDraft.canRebind?"Confirm on this map":"Save area",labelKey:L.areaDraft.canRebind?"v4_action_save_area_confirm":"v4_action_save_area",kind:"primary",enabled:V,...V?{}:{reason:"Add an area name and at least one mark.",reasonKey:"v4_reason_save_area_details"}}}let H=L.areaDraft.status==="current";return{id:"run-area",label:"Clean this area",labelKey:"v4_action_run_area",kind:"primary",enabled:H&&h1(L),...H?{}:{reason:"Confirm this outline on the current map first.",reasonKey:"v4_reason_run_area"}}}return{id:"choose-cleaning",label:"Choose what to clean",labelKey:"v4_action_choose_cleaning",kind:"neutral",enabled:!1,reason:"Choose rooms, a plan, or a custom area.",reasonKey:"v4_reason_choose_cleaning"}},k5=L=>F2(L)&&$2(L).id!=="stop"?w5(L):null,S4=L=>L.draw.brushMeters*64*(L.draw.zoomPercent/100),p7=[2,1,.5,.25,.1,.05],P5=L=>{let C=64*(L.draw.zoomPercent/100),H=p7.reduce((V,e)=>{let r=Math.abs(e*C-64),t=Math.abs(V*C-64);return r<t?e:V});return{meters:H,pixels:H*C,label:H<1?`${Math.round(H*100)} cm`:`${H} m`}},f4=(L,C)=>({...L,command:C});var _5="a".repeat(64),f1=[{roomId:"room-a",name:"Kitchen",boundary:[[.5,.5],[4,.5],[4,3],[.5,3]]},{roomId:"room-b",name:"Living room",boundary:[[4.2,.5],[8.5,.5],[8.5,3.4],[4.2,3.4]]},{roomId:"room-c",name:"Office",boundary:[[.5,3.2],[3.8,3.2],[3.8,6.5],[.5,6.5]]},{roomId:"room-d",name:"Bedroom",boundary:[[4,3.6],[8.5,3.6],[8.5,6.5],[4,6.5]]}],T5=()=>{let L=[180,140],C={meters_per_cell:.05,origin_cells:[0,0],span_cells:L,sample_step:1,rooms:f1.map(i=>{let a=i.boundary.map(([l,A])=>[l/.05,A/.05]),n=[a.reduce((l,[A])=>l+A,0)/a.length,a.reduce((l,[,A])=>l+A,0)/a.length];return{name:i.name,boundary:a,boundary_closed:!0,center:n}})},H=new TextEncoder().encode(JSON.stringify(C)),V=[];for(let i=10;i<130;i+=2)for(let a=10;a<170;a+=2){let n=a<80?i<65?0:2:i<72?1:3,l=[[185,219,224],[201,211,233],[210,226,194],[232,207,207]][n]||[190,205,215];V.push([a,i,0,...l])}let e=500;for(let i=0;i<e;i+=1){let a=i%4,n=i*7%120,l=a<2?a===0?10:168:10+n,A=a>=2?a===2?10:128:10+n;V.push([l,A,10+i%18,104,122,137])}let r=V.length-e,t=new ArrayBuffer(24+H.byteLength+V.length*8),M=new DataView(t);new Uint8Array(t,0,8).set(new TextEncoder().encode("MATIC3D\0")),M.setUint16(8,1,!0),M.setUint16(10,8,!0),M.setUint32(12,H.byteLength,!0),M.setUint32(16,r,!0),M.setUint32(20,e,!0),new Uint8Array(t,24,H.byteLength).set(H);let o=new DataView(t,24+H.byteLength);return V.forEach(([i=0,a=0,n=0,l=0,A=0,d=0],m)=>{let u=m*8;o.setUint16(u,i,!0),o.setUint16(u+2,a,!0),o.setUint8(u+4,n),o.setUint8(u+5,l),o.setUint8(u+6,A),o.setUint8(u+7,d)}),{buffer:t,pointOffset:24+H.byteLength,floorCount:r,surfaceCount:e,total:V.length,revision:7,etag:'"synthetic-scene"',source:"live",metadata:{metersPerCell:.05,origin:[0,0],span:L,sampleStep:1,rooms:C.rooms.map((i,a)=>({id:f1[a]?.roomId||`room-${a}`,name:i.name,boundary:i.boundary,center:i.center}))}}},Y1=()=>({entryId:"synthetic-entry",sceneUrl:"/api/matic_robot/slam_scene/synthetic",deltaUrl:"/api/matic_robot/slam_delta/synthetic",poseUrl:"/api/matic_robot/slam_pose/synthetic",historyUrl:"/api/matic_robot/slam_history/synthetic",areasUrl:"/api/matic_robot/areas/synthetic",plansUrl:"/api/matic_robot/plans/synthetic",mapRevision:7,mapFloorCoherent:!0,mapSessionVerified:!0,mapSessionKey:_5,mapBlockReason:null,runnerLocked:!1,stopSettlePending:!1,activePlan:!1,nativeReconciliationPending:!1,nativeSessionActive:!1,mapComplete:!0,mapTruncated:!1,selectedFloorOrdinal:1,mapFloorOrdinal:1,historyCount:2,historyFloorCount:2,health:"ready",streamFailures:0,bootstrapState:"complete",bootstrapPhotoSeen:!0,bootstrapStructureSeen:!0,bootstrapFailures:0}),I2=()=>({rooms:f1.map(({roomId:L,name:C})=>({roomId:L,name:C})),selectedPlan:"daily",plans:[{id:"daily",name:"Daily clean",enabled:!0,runBehavior:"intelligent",rooms:f1.slice(0,3).map(({roomId:L})=>({roomId:L,cleaningMode:"vacuum",coverageSetting:"standard"})),roomOrder:f1.slice(0,3).map(({roomId:L})=>L),returnToBase:!0,finishCurrentRoom:!1,finishCurrentRoomThreshold:50}]}),W2=()=>({sceneUrl:Y1().sceneUrl,rooms:f1.map(L=>({...L,boundary:L.boundary.map(C=>[...C])})),areas:[{id:"entryway",name:"Entryway",circles:[{x:1.5,y:1.4,radius:.3},{x:1.9,y:1.6,radius:.3}],cleaningMode:"vacuum",coverageSetting:"standard",status:"current",canRebind:!1}]}),B5=()=>({entryId:"synthetic-entry",liveAvailable:!0,floors:[{id:"current",active:!0,readOnly:!1,liveAvailable:!0,label:"House",ordinal:null,snapshots:[{id:"current-old",createdAt:"2026-08-29T14:00:00Z",revision:6,pointCount:5300,sceneUrl:"/synthetic-history-current-old"},{id:"current-new",createdAt:"2026-08-29T16:12:00Z",revision:7,pointCount:5300,sceneUrl:"/synthetic-history-current-new"}]},{id:"saved-1",active:!1,readOnly:!0,liveAvailable:!1,label:"Shed",ordinal:2,snapshots:[{id:"saved-one",createdAt:"2026-08-28T11:30:00Z",revision:3,pointCount:3100,sceneUrl:"/synthetic-history-saved"}]},{id:"saved-2",active:!1,readOnly:!0,liveAvailable:!1,label:"Annex",ordinal:3,snapshots:[]}]}),R5=()=>({position:[4.475,3.475],source:"latest_pose",revision:7,poseRevision:4,floorCoherent:!0,mapSessionKey:_5,freshness:"live"});var m7=()=>({...y(),coherence:"current",activity:"docked",batteryPercent:92,robots:[{entryId:"synthetic-entry",label:"Matic robot"}],host:{connected:!0,administrator:!0,robotConnected:!0,robotCount:1},floor:{classifiedCount:2,displayName:"House",readOnly:!1},map:{available:!0,complete:!0,floorCoherent:!0,sessionVerified:!0,exactPose:!0},resources:{catalog:{status:"ready",value:[Y1()],problem:null},entry:Y1(),scene:{status:"ready",value:T5(),problem:null},pose:{status:"ready",value:R5(),problem:null},history:{status:"ready",value:B5(),problem:null},plans:{status:"ready",value:I2(),problem:null},areas:{status:"ready",value:W2(),problem:null}},selection:{...y().selection,entryId:"synthetic-entry",planId:"daily"},planDraft:{...y().planDraft,id:"daily",name:"Daily clean",rooms:I2().plans[0]?.rooms||[]}}),z2=L=>{let C=m7();switch(L){case"ready":return C;case"cleaning":return{...C,activity:"cleaning"};case"paused":return{...C,activity:"paused"};case"returning":return{...C,activity:"returning"};case"recharging":return{...C,activity:"recharging",batteryPercent:18};case"rooms":return{...C,workflow:"rooms"};case"draw":return{...C,workflow:"draw",areaDraft:{...C.areaDraft,id:"entryway",name:"Entryway",status:"current"},selection:{...C.selection,areaId:"entryway"},draw:{...C.draw,dirty:!0,strokeCount:3,circles:W2().areas[0]?.circles||[]}};case"history":return{...C,dataMode:"history",workflow:"history",floor:{...C.floor,readOnly:!0},map:{...C.map,exactPose:!1},selection:{...C.selection,floorId:"saved-1",historyId:"saved-one"}};case"transition":return{...C,coherence:"verifying",activity:"unknown",map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1}};case"problem":return{...C,activity:"problem",coherence:"blocked"};case"ha-offline":return{...C,coherence:"degraded",host:{...C.host,connected:!1},map:{...C.map,exactPose:!1}};case"robot-offline":return{...C,coherence:"degraded",host:{...C.host,robotConnected:!1},map:{...C.map,exactPose:!1}};case"access":return{...C,coherence:"blocked",host:{...C.host,administrator:!1},map:{...C.map,available:!1,exactPose:!1}};case"empty":return{...C,coherence:"unavailable",host:{...C.host,robotConnected:!1,robotCount:0},map:{...C.map,available:!1,exactPose:!1}};case"unsupported":return{...C,coherence:"blocked",map:{...C.map,available:!1,exactPose:!1}};case"multi-robot":return{...C,host:{...C.host,robotCount:2},robots:[{entryId:"synthetic-entry",label:"Matic robot"},{entryId:"synthetic-entry-two",label:"Second robot"}]}}},N2=["ready","cleaning","paused","returning","recharging","rooms","draw","history","transition","problem","ha-offline","robot-offline","access","empty","unsupported","multi-robot"];var c7=(L,C)=>{if(C?.recharge_and_resume===!0&&C?.charging===!0)return"recharging";switch(L){case"cleaning":return"cleaning";case"paused":return"paused";case"returning":return"returning";case"docked":return"docked";case"idle":return"idle";case"error":return"problem";default:return"unknown"}},v7=L=>typeof L!="number"||!Number.isFinite(L)?null:Math.round(Math.max(0,Math.min(100,L))),u7=L=>{let C=L.attributes?.matic_entry_id;return typeof C=="string"&&C.length>0?C:null},x7=L=>String(L||"local-user").replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",E5=L=>{if(typeof L!="string")return"Matic robot";let C=L.trim();return C&&Array.from(C).length<=128&&!/[\u0000-\u001f\u007f]/u.test(C)?C:"Matic robot"},j1=class{#C="";#H=null;project(C,H,V=null){let e=C?.states??{},r=H?.config?.entry_id,t=typeof r=="string"?r:null,M=null,o=null,i=null,a=new Map;for(let[S,O]of Object.entries(e)){let g=u7(O);if(!g||!S.startsWith("vacuum."))continue;a.set(g,{entryId:g,label:E5(O.attributes?.friendly_name)});let Q1=V||t;(!M||Q1&&g===Q1)&&(M=O,o=S,i=g)}let n={connected:C?.connected!==!1,administrator:C?.user?.is_admin===!0,robotConnected:M!==null&&M.state!=="unavailable"&&M.state!=="unknown",robotCount:a.size},l=M?c7(M.state,M.attributes):"unknown",A=v7(M?.attributes?.battery_level),d=C?.selectedLanguage||C?.language||"en",m=x7(C?.user?.id),u=E5(M?.attributes?.friendly_name),h=[...a.values()].sort((S,O)=>S.label.localeCompare(O.label,d,{sensitivity:"base"})),f=[n.connected,n.administrator,n.robotConnected,n.robotCount,l,A??"none",d,m,o??"none",i??"none",u,h.map(S=>`${S.entryId}:${S.label}`).join(",")].join("|");return f===this.#C&&this.#H?this.#H:(this.#C=f,this.#H={host:n,activity:l,batteryPercent:A,language:d,userKey:m,vacuumEntityId:o,entryKey:i,robotLabel:u,robots:h},this.#H)}};var J1=globalThis,C2=J1.ShadowRoot&&(J1.ShadyCSS===void 0||J1.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,U2=Symbol(),F5=new WeakMap,B1=class{constructor(C,H,V){if(this._$cssResult$=!0,V!==U2)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=C,this.t=H}get styleSheet(){let C=this.o,H=this.t;if(C2&&C===void 0){let V=H!==void 0&&H.length===1;V&&(C=F5.get(H)),C===void 0&&((this.o=C=new CSSStyleSheet).replaceSync(this.cssText),V&&F5.set(H,C))}return C}toString(){return this.cssText}},D5=L=>new B1(typeof L=="string"?L:L+"",void 0,U2),w=(L,...C)=>{let H=L.length===1?L[0]:C.reduce((V,e,r)=>V+(t=>{if(t._$cssResult$===!0)return t.cssText;if(typeof t=="number")return t;throw Error("Value passed to 'css' function must be a 'css' function result: "+t+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(e)+L[r+1],L[0]);return new B1(H,L,U2)},$5=(L,C)=>{if(C2)L.adoptedStyleSheets=C.map(H=>H instanceof CSSStyleSheet?H:H.styleSheet);else for(let H of C){let V=document.createElement("style"),e=J1.litNonce;e!==void 0&&V.setAttribute("nonce",e),V.textContent=H.cssText,L.appendChild(V)}},G2=C2?L=>L:L=>L instanceof CSSStyleSheet?(C=>{let H="";for(let V of C.cssRules)H+=V.cssText;return D5(H)})(L):L;var{is:h7,defineProperty:Z7,getOwnPropertyDescriptor:S7,getOwnPropertyNames:f7,getOwnPropertySymbols:g7,getPrototypeOf:y7}=Object,H2=globalThis,I5=H2.trustedTypes,b7=I5?I5.emptyScript:"",O7=H2.reactiveElementPolyfillSupport,R1=(L,C)=>L,K2={toAttribute(L,C){switch(C){case Boolean:L=L?b7:null;break;case Object:case Array:L=L==null?L:JSON.stringify(L)}return L},fromAttribute(L,C){let H=L;switch(C){case Boolean:H=L!==null;break;case Number:H=L===null?null:Number(L);break;case Object:case Array:try{H=JSON.parse(L)}catch{H=null}}return H}},z5=(L,C)=>!h7(L,C),W5={attribute:!0,type:String,converter:K2,reflect:!1,useDefault:!1,hasChanged:z5};Symbol.metadata??=Symbol("metadata"),H2.litPropertyMetadata??=new WeakMap;var q=class extends HTMLElement{static addInitializer(C){this._$Ei(),(this.l??=[]).push(C)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(C,H=W5){if(H.state&&(H.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(C)&&((H=Object.create(H)).wrapped=!0),this.elementProperties.set(C,H),!H.noAccessor){let V=Symbol(),e=this.getPropertyDescriptor(C,V,H);e!==void 0&&Z7(this.prototype,C,e)}}static getPropertyDescriptor(C,H,V){let{get:e,set:r}=S7(this.prototype,C)??{get(){return this[H]},set(t){this[H]=t}};return{get:e,set(t){let M=e?.call(this);r?.call(this,t),this.requestUpdate(C,M,V)},configurable:!0,enumerable:!0}}static getPropertyOptions(C){return this.elementProperties.get(C)??W5}static _$Ei(){if(this.hasOwnProperty(R1("elementProperties")))return;let C=y7(this);C.finalize(),C.l!==void 0&&(this.l=[...C.l]),this.elementProperties=new Map(C.elementProperties)}static finalize(){if(this.hasOwnProperty(R1("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(R1("properties"))){let H=this.properties,V=[...f7(H),...g7(H)];for(let e of V)this.createProperty(e,H[e])}let C=this[Symbol.metadata];if(C!==null){let H=litPropertyMetadata.get(C);if(H!==void 0)for(let[V,e]of H)this.elementProperties.set(V,e)}this._$Eh=new Map;for(let[H,V]of this.elementProperties){let e=this._$Eu(H,V);e!==void 0&&this._$Eh.set(e,H)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(C){let H=[];if(Array.isArray(C)){let V=new Set(C.flat(1/0).reverse());for(let e of V)H.unshift(G2(e))}else C!==void 0&&H.push(G2(C));return H}static _$Eu(C,H){let V=H.attribute;return V===!1?void 0:typeof V=="string"?V:typeof C=="string"?C.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){this._$ES=new Promise(C=>this.enableUpdating=C),this._$AL=new Map,this._$E_(),this.requestUpdate(),this.constructor.l?.forEach(C=>C(this))}addController(C){(this._$EO??=new Set).add(C),this.renderRoot!==void 0&&this.isConnected&&C.hostConnected?.()}removeController(C){this._$EO?.delete(C)}_$E_(){let C=new Map,H=this.constructor.elementProperties;for(let V of H.keys())this.hasOwnProperty(V)&&(C.set(V,this[V]),delete this[V]);C.size>0&&(this._$Ep=C)}createRenderRoot(){let C=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return $5(C,this.constructor.elementStyles),C}connectedCallback(){this.renderRoot??=this.createRenderRoot(),this.enableUpdating(!0),this._$EO?.forEach(C=>C.hostConnected?.())}enableUpdating(C){}disconnectedCallback(){this._$EO?.forEach(C=>C.hostDisconnected?.())}attributeChangedCallback(C,H,V){this._$AK(C,V)}_$ET(C,H){let V=this.constructor.elementProperties.get(C),e=this.constructor._$Eu(C,V);if(e!==void 0&&V.reflect===!0){let r=(V.converter?.toAttribute!==void 0?V.converter:K2).toAttribute(H,V.type);this._$Em=C,r==null?this.removeAttribute(e):this.setAttribute(e,r),this._$Em=null}}_$AK(C,H){let V=this.constructor,e=V._$Eh.get(C);if(e!==void 0&&this._$Em!==e){let r=V.getPropertyOptions(e),t=typeof r.converter=="function"?{fromAttribute:r.converter}:r.converter?.fromAttribute!==void 0?r.converter:K2;this._$Em=e;let M=t.fromAttribute(H,r.type);this[e]=M??this._$Ej?.get(e)??M,this._$Em=null}}requestUpdate(C,H,V,e=!1,r){if(C!==void 0){let t=this.constructor;if(e===!1&&(r=this[C]),V??=t.getPropertyOptions(C),!((V.hasChanged??z5)(r,H)||V.useDefault&&V.reflect&&r===this._$Ej?.get(C)&&!this.hasAttribute(t._$Eu(C,V))))return;this.C(C,H,V)}this.isUpdatePending===!1&&(this._$ES=this._$EP())}C(C,H,{useDefault:V,reflect:e,wrapped:r},t){V&&!(this._$Ej??=new Map).has(C)&&(this._$Ej.set(C,t??H??this[C]),r!==!0||t!==void 0)||(this._$AL.has(C)||(this.hasUpdated||V||(H=void 0),this._$AL.set(C,H)),e===!0&&this._$Em!==C&&(this._$Eq??=new Set).add(C))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(H){Promise.reject(H)}let C=this.scheduleUpdate();return C!=null&&await C,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??=this.createRenderRoot(),this._$Ep){for(let[e,r]of this._$Ep)this[e]=r;this._$Ep=void 0}let V=this.constructor.elementProperties;if(V.size>0)for(let[e,r]of V){let{wrapped:t}=r,M=this[e];t!==!0||this._$AL.has(e)||M===void 0||this.C(e,void 0,r,M)}}let C=!1,H=this._$AL;try{C=this.shouldUpdate(H),C?(this.willUpdate(H),this._$EO?.forEach(V=>V.hostUpdate?.()),this.update(H)):this._$EM()}catch(V){throw C=!1,this._$EM(),V}C&&this._$AE(H)}willUpdate(C){}_$AE(C){this._$EO?.forEach(H=>H.hostUpdated?.()),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(C)),this.updated(C)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(C){return!0}update(C){this._$Eq&&=this._$Eq.forEach(H=>this._$ET(H,this[H])),this._$EM()}updated(C){}firstUpdated(C){}};q.elementStyles=[],q.shadowRootOptions={mode:"open"},q[R1("elementProperties")]=new Map,q[R1("finalized")]=new Map,O7?.({ReactiveElement:q}),(H2.reactiveElementVersions??=[]).push("2.1.2");var q2=globalThis,N5=L=>L,V2=q2.trustedTypes,U5=V2?V2.createPolicy("lit-html",{createHTML:L=>L}):void 0,X2="$lit$",X=`lit$${Math.random().toFixed(9).slice(2)}$`,Y2="?"+X,w7=`<${Y2}>`,a1=document,F1=()=>a1.createComment(""),D1=L=>L===null||typeof L!="object"&&typeof L!="function",j2=Array.isArray,Y5=L=>j2(L)||typeof L?.[Symbol.iterator]=="function",Q2=`[ \t\n\f\r]`,E1=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,G5=/-->/g,K5=/>/g,o1=RegExp(`>|${Q2}(?:([^\\s"'>=/]+)(${Q2}*=${Q2}*(?:[^ \t\n\f\r"'\`<>=]|("|')|))|$)`,"g"),Q5=/'/g,q5=/"/g,j5=/^(?:script|style|textarea|title)$/i,J2=L=>(C,...H)=>({_$litType$:L,strings:C,values:H}),p=J2(1),J5=J2(2),C3=J2(3),Y=Symbol.for("lit-noChange"),s=Symbol.for("lit-nothing"),X5=new WeakMap,i1=a1.createTreeWalker(a1,129);function H3(L,C){if(!j2(L)||!L.hasOwnProperty("raw"))throw Error("invalid template strings array");return U5!==void 0?U5.createHTML(C):C}var V3=(L,C)=>{let H=L.length-1,V=[],e,r=C===2?"<svg>":C===3?"<math>":"",t=E1;for(let M=0;M<H;M++){let o=L[M],i,a,n=-1,l=0;for(;l<o.length&&(t.lastIndex=l,a=t.exec(o),a!==null);)l=t.lastIndex,t===E1?a[1]==="!--"?t=G5:a[1]!==void 0?t=K5:a[2]!==void 0?(j5.test(a[2])&&(e=RegExp("</"+a[2],"g")),t=o1):a[3]!==void 0&&(t=o1):t===o1?a[0]===">"?(t=e??E1,n=-1):a[1]===void 0?n=-2:(n=t.lastIndex-a[2].length,i=a[1],t=a[3]===void 0?o1:a[3]==='"'?q5:Q5):t===q5||t===Q5?t=o1:t===G5||t===K5?t=E1:(t=o1,e=void 0);let A=t===o1&&L[M+1].startsWith("/>")?" ":"";r+=t===E1?o+w7:n>=0?(V.push(i),o.slice(0,n)+X2+o.slice(n)+X+A):o+X+(n===-2?M:A)}return[H3(L,r+(L[H]||"<?>")+(C===2?"</svg>":C===3?"</math>":"")),V]},$1=class L{constructor({strings:C,_$litType$:H},V){let e;this.parts=[];let r=0,t=0,M=C.length-1,o=this.parts,[i,a]=V3(C,H);if(this.el=L.createElement(i,V),i1.currentNode=this.el.content,H===2||H===3){let n=this.el.content.firstChild;n.replaceWith(...n.childNodes)}for(;(e=i1.nextNode())!==null&&o.length<M;){if(e.nodeType===1){if(e.hasAttributes())for(let n of e.getAttributeNames())if(n.endsWith(X2)){let l=a[t++],A=e.getAttribute(n).split(X),d=/([.?@])?(.*)/.exec(l);o.push({type:1,index:r,name:d[2],strings:A,ctor:d[1]==="."?e2:d[1]==="?"?r2:d[1]==="@"?t2:l1}),e.removeAttribute(n)}else n.startsWith(X)&&(o.push({type:6,index:r}),e.removeAttribute(n));if(j5.test(e.tagName)){let n=e.textContent.split(X),l=n.length-1;if(l>0){e.textContent=V2?V2.emptyScript:"";for(let A=0;A<l;A++)e.append(n[A],F1()),i1.nextNode(),o.push({type:2,index:++r});e.append(n[l],F1())}}}else if(e.nodeType===8)if(e.data===Y2)o.push({type:2,index:r});else{let n=-1;for(;(n=e.data.indexOf(X,n+1))!==-1;)o.push({type:7,index:r}),n+=X.length-1}r++}}static createElement(C,H){let V=a1.createElement("template");return V.innerHTML=C,V}};function n1(L,C,H=L,V){if(C===Y)return C;let e=V!==void 0?H._$Co?.[V]:H._$Cl,r=D1(C)?void 0:C._$litDirective$;return e?.constructor!==r&&(e?._$AO?.(!1),r===void 0?e=void 0:(e=new r(L),e._$AT(L,H,V)),V!==void 0?(H._$Co??=[])[V]=e:H._$Cl=e),e!==void 0&&(C=n1(L,e._$AS(L,C.values),e,V)),C}var L2=class{constructor(C,H){this._$AV=[],this._$AN=void 0,this._$AD=C,this._$AM=H}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(C){let{el:{content:H},parts:V}=this._$AD,e=(C?.creationScope??a1).importNode(H,!0);i1.currentNode=e;let r=i1.nextNode(),t=0,M=0,o=V[0];for(;o!==void 0;){if(t===o.index){let i;o.type===2?i=new g1(r,r.nextSibling,this,C):o.type===1?i=new o.ctor(r,o.name,o.strings,this,C):o.type===6&&(i=new M2(r,this,C)),this._$AV.push(i),o=V[++M]}t!==o?.index&&(r=i1.nextNode(),t++)}return i1.currentNode=a1,e}p(C){let H=0;for(let V of this._$AV)V!==void 0&&(V.strings!==void 0?(V._$AI(C,V,H),H+=V.strings.length-2):V._$AI(C[H])),H++}},g1=class L{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(C,H,V,e){this.type=2,this._$AH=s,this._$AN=void 0,this._$AA=C,this._$AB=H,this._$AM=V,this.options=e,this._$Cv=e?.isConnected??!0}get parentNode(){let C=this._$AA.parentNode,H=this._$AM;return H!==void 0&&C?.nodeType===11&&(C=H.parentNode),C}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(C,H=this){C=n1(this,C,H),D1(C)?C===s||C==null||C===""?(this._$AH!==s&&this._$AR(),this._$AH=s):C!==this._$AH&&C!==Y&&this._(C):C._$litType$!==void 0?this.$(C):C.nodeType!==void 0?this.T(C):Y5(C)?this.k(C):this._(C)}O(C){return this._$AA.parentNode.insertBefore(C,this._$AB)}T(C){this._$AH!==C&&(this._$AR(),this._$AH=this.O(C))}_(C){this._$AH!==s&&D1(this._$AH)?this._$AA.nextSibling.data=C:this.T(a1.createTextNode(C)),this._$AH=C}$(C){let{values:H,_$litType$:V}=C,e=typeof V=="number"?this._$AC(C):(V.el===void 0&&(V.el=$1.createElement(H3(V.h,V.h[0]),this.options)),V);if(this._$AH?._$AD===e)this._$AH.p(H);else{let r=new L2(e,this),t=r.u(this.options);r.p(H),this.T(t),this._$AH=r}}_$AC(C){let H=X5.get(C.strings);return H===void 0&&X5.set(C.strings,H=new $1(C)),H}k(C){j2(this._$AH)||(this._$AH=[],this._$AR());let H=this._$AH,V,e=0;for(let r of C)e===H.length?H.push(V=new L(this.O(F1()),this.O(F1()),this,this.options)):V=H[e],V._$AI(r),e++;e<H.length&&(this._$AR(V&&V._$AB.nextSibling,e),H.length=e)}_$AR(C=this._$AA.nextSibling,H){for(this._$AP?.(!1,!0,H);C!==this._$AB;){let V=N5(C).nextSibling;N5(C).remove(),C=V}}setConnected(C){this._$AM===void 0&&(this._$Cv=C,this._$AP?.(C))}},l1=class{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(C,H,V,e,r){this.type=1,this._$AH=s,this._$AN=void 0,this.element=C,this.name=H,this._$AM=e,this.options=r,V.length>2||V[0]!==""||V[1]!==""?(this._$AH=Array(V.length-1).fill(new String),this.strings=V):this._$AH=s}_$AI(C,H=this,V,e){let r=this.strings,t=!1;if(r===void 0)C=n1(this,C,H,0),t=!D1(C)||C!==this._$AH&&C!==Y,t&&(this._$AH=C);else{let M=C,o,i;for(C=r[0],o=0;o<r.length-1;o++)i=n1(this,M[V+o],H,o),i===Y&&(i=this._$AH[o]),t||=!D1(i)||i!==this._$AH[o],i===s?C=s:C!==s&&(C+=(i??"")+r[o+1]),this._$AH[o]=i}t&&!e&&this.j(C)}j(C){C===s?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,C??"")}},e2=class extends l1{constructor(){super(...arguments),this.type=3}j(C){this.element[this.name]=C===s?void 0:C}},r2=class extends l1{constructor(){super(...arguments),this.type=4}j(C){this.element.toggleAttribute(this.name,!!C&&C!==s)}},t2=class extends l1{constructor(C,H,V,e,r){super(C,H,V,e,r),this.type=5}_$AI(C,H=this){if((C=n1(this,C,H,0)??s)===Y)return;let V=this._$AH,e=C===s&&V!==s||C.capture!==V.capture||C.once!==V.once||C.passive!==V.passive,r=C!==s&&(V===s||e);e&&this.element.removeEventListener(this.name,this,V),r&&this.element.addEventListener(this.name,this,C),this._$AH=C}handleEvent(C){typeof this._$AH=="function"?this._$AH.call(this.options?.host??this.element,C):this._$AH.handleEvent(C)}},M2=class{constructor(C,H,V){this.element=C,this.type=6,this._$AN=void 0,this._$AM=H,this.options=V}get _$AU(){return this._$AM._$AU}_$AI(C){n1(this,C)}},L3={M:X2,P:X,A:Y2,C:1,L:V3,R:L2,D:Y5,V:n1,I:g1,H:l1,N:r2,U:t2,B:e2,F:M2},k7=q2.litHtmlPolyfillSupport;k7?.($1,g1),(q2.litHtmlVersions??=[]).push("3.3.3");var e3=(L,C,H)=>{let V=H?.renderBefore??C,e=V._$litPart$;if(e===void 0){let r=H?.renderBefore??null;V._$litPart$=e=new g1(C.insertBefore(F1(),r),r,void 0,H??{})}return e._$AI(L),e};var C5=globalThis,k=class extends q{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){let C=super.createRenderRoot();return this.renderOptions.renderBefore??=C.firstChild,C}update(C){let H=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(C),this._$Do=e3(H,this.renderRoot,this.renderOptions)}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(!0)}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(!1)}render(){return Y}};k._$litElement$=!0,k.finalized=!0,C5.litElementHydrateSupport?.({LitElement:k});var P7=C5.litElementPolyfillSupport;P7?.({LitElement:k});(C5.litElementVersions??=[]).push("4.2.2");var $=w`
:host {
--ms-accent: var(--primary-color, #0678ce);
--ms-on-accent: var(--text-primary-color, #fff);
--ms-danger: var(--error-color, #b3261e);
--ms-warning: var(--warning-color, #8a5b00);
--ms-success: var(--success-color, #2e7d4f);
--ms-surface-app: var(--primary-background-color, #f3f6f8);
--ms-surface-card: var(--card-background-color, #fff);
--ms-surface-sunken: var(--secondary-background-color, #eef2f4);
--ms-surface-bar: var(--app-header-background-color, var(--ms-surface-card));
--ms-bar-text: var(--app-header-text-color, var(--ms-text));
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
--ms-on-accent: var(--text-primary-color, #102234);
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
--ms-bar-text: CanvasText;
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
`,I=w`
*, *::before, *::after { box-sizing: border-box; }
button, input, select, textarea { font: inherit; }
.ms-icon { display: block; flex: none; inline-size: var(--ms-icon); block-size: var(--ms-icon); }
.ms-icon--sm { inline-size: var(--ms-icon-sm); block-size: var(--ms-icon-sm); }
`;var t3=Symbol.for(""),_7=L=>{if(L?.r===t3)return L?._$litStatic$},H1=L=>({_$litStatic$:L,r:t3});var r3=new Map,H5=L=>(C,...H)=>{let V=H.length,e,r,t=[],M=[],o,i=0,a=!1;for(;i<V;){for(o=C[i];i<V&&(r=H[i],(e=_7(r))!==void 0);)o+=e+C[++i],a=!0;i!==V&&M.push(r),t.push(o),i++}if(i===V&&t.push(C[V]),a){let n=t.join("$$lit$$");(C=r3.get(n))===void 0&&(t.raw=t,r3.set(n,C=t)),H=M}return L(C,...H)},x=H5(p),Y4=H5(J5),j4=H5(C3);var M3=import.meta.url.match(/\/matic_robot\/[^/]+-([a-f0-9]{12})\/map-studio-v4(?:\/|$)/u)?.[1]??"dev",I1=M3==="dev"?"":`-${M3}`,A1=`matic-map-canvas-v4${I1}`,W1=`matic-precision-controls-v4${I1}`,s1=`matic-map-workflow-v4${I1}`,d1=`matic-map-shell-v4${I1}`,V5=`matic-map-panel-v0-4-0${I1}`;var V1=w`
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
`;var o3=[$,I,V1,w`
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
      color: var(--ms-bar-text);
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

    .app-bar > .ms-btn, .app-bar > .overflow-wrap > .ms-btn { color: var(--ms-bar-text); }
    .app-bar > .ms-btn:focus-visible, .app-bar > .overflow-wrap > .ms-btn:focus-visible { outline-color: var(--ms-bar-text); }

    .context-switcher { max-inline-size: 9rem; inline-size: auto; text-overflow: ellipsis; }
    .floor-switcher { appearance: none; block-size: 44px; padding-inline-end: 1.8rem; background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%); background-position: calc(100% - 15px) 50%, calc(100% - 10px) 50%; background-size: 5px 5px; background-repeat: no-repeat; }
    .floor-switcher:dir(rtl) { background-position: 10px 50%, 15px 50%; }


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
    .narrow .mobile-sheet[data-detent="full"] { block-size: min(92%, calc(100% - 9rem)); }
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
    .narrow .sheet-grip:has(.sheet-back) { grid-template-columns: auto minmax(0, 1fr) auto auto; }
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
      grid-template-columns: repeat(12, minmax(0, 1fr));
      gap: var(--ms-space-1);
      padding: 0;
    }
    .narrow .draw-tools--grid .ms-btn {
      grid-column: span 4;
      flex-direction: column;
      gap: var(--ms-space-1);
      min-inline-size: 0;
      min-block-size: var(--ms-control);
      padding: var(--ms-space-1) var(--ms-space-2);
      border-color: var(--ms-line);
      font-size: var(--ms-t-xs);
      white-space: normal;
    }
    .narrow .draw-tools--grid .ms-btn[data-tool] { grid-column: span 3; padding-inline: 3px; }
    .narrow .draw-tools--grid[data-zone="true"] .ms-btn:not([data-tool]) { grid-column: span 6; }
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
      z-index: 3;
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
  `];var i3="M11,4H13V16L18.5,10.5L19.92,11.92L12,19.84L4.08,11.92L5.5,10.5L11,16V4Z";var a3="M9.5,13.09L10.91,14.5L6.41,19H10V21H3V14H5V17.59L9.5,13.09M10.91,9.5L9.5,10.91L5,6.41V10H3V3H10V5H6.41L10.91,9.5M14.5,13.09L19,17.59V14H21V21H14V19H17.59L13.09,14.5L14.5,13.09M13.09,9.5L17.59,5H14V3H21V10H19V6.41L14.5,10.91L13.09,9.5Z";var n3="M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z";var l3="M13,20H11V8L5.5,13.5L4.08,12.08L12,4.16L19.92,12.08L18.5,13.5L13,8V20Z";var A3="M23,11H20V4L15,14H18V22M12,13H4V6H12M12.67,4H11V2H5V4H3.33A1.33,1.33 0 0,0 2,5.33V20.67C2,21.4 2.6,22 3.33,22H12.67C13.4,22 14,21.4 14,20.67V5.33A1.33,1.33 0 0,0 12.67,4Z";var s3="M20.71,4.63L19.37,3.29C19,2.9 18.35,2.9 17.96,3.29L9,12.25L11.75,15L20.71,6.04C21.1,5.65 21.1,5 20.71,4.63M7,14A3,3 0 0,0 4,17C4,18.31 2.84,19 2,19C2.92,20.22 4.5,21 6,21A4,4 0 0,0 10,17A3,3 0 0,0 7,14Z";var L5="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z";var d3="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z";var e5="M7.41,15.41L12,10.83L16.59,15.41L18,14L12,8L6,14L7.41,15.41Z";var p3="M12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z";var m3="M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z";var c3="M13,6V11H18V7.75L22.25,12L18,16.25V13H13V18H16.25L12,22.25L7.75,18H11V13H6V16.25L1.75,12L6,7.75V11H11V6H7.75L12,1.75L16.25,6H13Z";var v3="M20 4H4A2 2 0 0 0 2 6V18A2 2 0 0 0 4 20H20A2 2 0 0 0 22 18V6A2 2 0 0 0 20 4M15 18H4V6H15Z";var u3="M12,16A2,2 0 0,1 14,18A2,2 0 0,1 12,20A2,2 0 0,1 10,18A2,2 0 0,1 12,16M12,10A2,2 0 0,1 14,12A2,2 0 0,1 12,14A2,2 0 0,1 10,12A2,2 0 0,1 12,10M12,4A2,2 0 0,1 14,6A2,2 0 0,1 12,8A2,2 0 0,1 10,6A2,2 0 0,1 12,4Z";var x3="M16.24,3.56L21.19,8.5C21.97,9.29 21.97,10.55 21.19,11.34L12,20.53C10.44,22.09 7.91,22.09 6.34,20.53L2.81,17C2.03,16.21 2.03,14.95 2.81,14.16L13.41,3.56C14.2,2.78 15.46,2.78 16.24,3.56M4.22,15.58L7.76,19.11C8.54,19.9 9.8,19.9 10.59,19.11L14.12,15.58L9.17,10.63L4.22,15.58Z";var h3="M18.5,4L19.66,8.35L18.7,8.61C18.25,7.74 17.79,6.87 17.26,6.43C16.73,6 16.11,6 15.5,6H13V16.5C13,17 13,17.5 13.33,17.75C13.67,18 14.33,18 15,18V19H9V18C9.67,18 10.33,18 10.67,17.75C11,17.5 11,17 11,16.5V6H8.5C7.89,6 7.27,6 6.74,6.43C6.21,6.87 5.75,7.74 5.3,8.61L4.34,8.35L5.5,4H18.5Z";var Z3="M11,18H13V16H11V18M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M12,6A4,4 0 0,0 8,10H10A2,2 0 0,1 12,8A2,2 0 0,1 14,10C14,12 11,11.75 11,15H13C13,12.75 16,12.5 16,10A4,4 0 0,0 12,6Z";var S3="M13.5,8H12V13L16.28,15.54L17,14.33L13.5,12.25V8M13,3A9,9 0 0,0 4,12H1L4.96,16.03L9,12H6A7,7 0 0,1 13,5A7,7 0 0,1 20,12A7,7 0 0,1 13,19C11.07,19 9.32,18.21 8.06,16.94L6.64,18.36C8.27,20 10.5,21 13,21A9,9 0 0,0 22,12A9,9 0 0,0 13,3";var f3="M11,9H13V7H11M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M11,17H13V11H11V17Z";var g3="M16.37,16.1L11.75,11.47L11.64,11.36L3.27,3L2,4.27L5.18,7.45C5.06,7.95 5,8.46 5,9C5,14.25 12,22 12,22C12,22 13.67,20.15 15.37,17.65L18.73,21L20,19.72M12,6.5A2.5,2.5 0 0,1 14.5,9C14.5,9.73 14.17,10.39 13.67,10.85L17.3,14.5C18.28,12.62 19,10.68 19,9A7,7 0 0,0 12,2C10,2 8.24,2.82 6.96,4.14L10.15,7.33C10.61,6.82 11.26,6.5 12,6.5Z";var y3="M3,6H21V8H3V6M3,11H21V13H3V11M3,16H21V18H3V16Z";var b3="M14,19H18V5H14M6,19H10V5H6V19Z";var O3="M8,5.14V19.14L19,12.14L8,5.14Z";var w3="M14 10H3V12H14V10M14 6H3V8H14V6M3 16H10V14H3V16M21.5 11.5L23 13L16 20L11.5 15.5L13 14L16 17L21.5 11.5Z";var k3="M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z";var P3="M18.4,10.6C16.55,9 14.15,8 11.5,8C6.85,8 2.92,11.03 1.54,15.22L3.9,16C4.95,12.81 7.95,10.5 11.5,10.5C13.45,10.5 15.23,11.22 16.62,12.38L13,16H22V7L18.4,10.6Z";var _3="M13,4.07V1L8.45,5.55L13,10V6.09C15.84,6.57 18,9.03 18,12C18,14.97 15.84,17.43 13,17.91V19.93C16.95,19.44 20,16.08 20,12C20,7.92 16.95,4.56 13,4.07M7.1,18.32C8.26,19.22 9.61,19.76 11,19.93V17.9C10.13,17.75 9.29,17.41 8.54,16.87L7.1,18.32M6.09,13H4.07C4.24,14.39 4.79,15.73 5.69,16.89L7.1,15.47C6.58,14.72 6.23,13.88 6.09,13M7.11,8.53L5.7,7.11C4.8,8.27 4.24,9.61 4.07,11H6.09C6.23,10.13 6.58,9.28 7.11,8.53Z";var T3="M16.89,15.5L18.31,16.89C19.21,15.73 19.76,14.39 19.93,13H17.91C17.77,13.87 17.43,14.72 16.89,15.5M13,17.9V19.92C14.39,19.75 15.74,19.21 16.9,18.31L15.46,16.87C14.71,17.41 13.87,17.76 13,17.9M19.93,11C19.76,9.61 19.21,8.27 18.31,7.11L16.89,8.53C17.43,9.28 17.77,10.13 17.91,11M15.55,5.55L11,1V4.07C7.06,4.56 4,7.92 4,12C4,16.08 7.05,19.44 11,19.93V17.91C8.16,17.43 6,14.97 6,12C6,9.03 8.16,6.57 11,6.09V10L15.55,5.55Z";var B3="M17,15.7V13H19V17L10,21L3,14L7,5H11V7H8.3L5.4,13.6L10.4,18.6L17,15.7M22,5V7H19V10H17V7H14V5H17V2H19V5H22Z";var R3="M12.5,8C9.85,8 7.45,9 5.6,10.6L2,7V16H11L7.38,12.38C8.77,11.22 10.54,10.5 12.5,10.5C16.04,10.5 19.05,12.81 20.1,16L22.47,15.22C21.08,11.03 17.15,8 12.5,8Z";var y1="M8.2 6.2H22.6Q23 6.2 23 6.6V7.7H7.86V6.6Q7.86 6.2 8.2 6.2ZM7.86 8.4H23V14.35Q23 16.1 21.3 16.1H16.2A5.3 5.3 0 0 0 7.86 9.65ZM11.7 8.72A4.53 4.53 0 1 0 11.7 17.78A4.53 4.53 0 1 0 11.7 8.72ZM11.7 10.02A3.23 3.23 0 1 1 11.7 16.48A3.23 3.23 0 1 1 11.7 10.02ZM2.2 11.5H5.5Q7.2 11.5 7.2 13V15Q7.2 16.1 5.5 16.1H2.3Q1 16.1 1 14.8V13Q1 11.5 2.2 11.5ZM19.8 16.1H22.3L22 17.3H21Z";var o2=n3,E3=u3,F3=y3,D3=v3,i2=d3,$3=e5,I3=L5,W3=e5,z3=L5,N3=a3,U3=h3,G3=Z3,K3=_3,Q3=T3,q3=R3,X3=P3,Y3=s3,j3=p3,J3=x3,C0=c3;var H0=k3;var V0=l3,L0=i3,e0=m3,a2=B3,r5=S3,t5=w3,r0=f3,M5=O3,o5=b3,t0=A3,b1=g3,Z=L=>p`<svg
  class="ms-icon"
  viewBox="0 0 24 24"
  fill="currentColor"
  aria-hidden="true"
  focusable="false"
><path d=${L}></path></svg>`;var T7=["outline","paint","erase","pan"],n2=(L,C,H)=>{let{draw:V}=L,e=`${V.brushMeters.toFixed(2)} m`;return p`
    <div
      class=${`draw-tools draw-tools--${H} ms-segment`}
      data-zone=${String(V.tool==="outline")}
      role="toolbar"
      aria-label=${C.t("v4_draw_tools","Draw area tools")}
      data-map-control
    >
      ${T7.map(r=>p`
        <button
          class="ms-btn"
          type="button"
          aria-pressed=${String(V.tool===r)}
          data-tool=${r}
          @click=${()=>C.intent({type:"set-draw-tool",tool:r})}
        >${Z(r==="outline"?a2:r==="paint"?Y3:r==="erase"?J3:C0)}<span class="ms-btn__label">${r==="outline"?C.t("v4_zone_tool","Zone"):r==="paint"?C.t("area_paint","Paint"):r==="erase"?C.t("area_erase","Erase"):C.t("move_map","Move map")}</span></button>
      `)}
      <button
        class="ms-btn"
        type="button"
        ?disabled=${V.strokeCount===0}
        @click=${()=>C.intent({type:"undo-draft"})}
      >${Z(q3)}<span class="ms-btn__label">${C.t("undo","Undo")}</span></button>
      <button
        class="ms-btn"
        type="button"
        ?disabled=${V.redo.length===0}
        @click=${()=>C.intent({type:"redo-draft"})}
      >${Z(X3)}<span class="ms-btn__label">${C.t("redo","Redo")}</span></button>
      ${V.tool!=="outline"?p`<button
        class="ms-btn draw-brush"
        type="button"
        aria-label=${C.t("v4_brush_button","Brush width, {brush}. Opens brush settings.").replace("{brush}",e)}
        aria-expanded=${String(L.precisionOpen)}
        aria-haspopup="dialog"
        @click=${C.openBrush}
      >${Z(j3)}<span class="ms-btn__label">${C.t("v4_brush","Brush {brush}").replace("{brush}",e)}</span></button>`:s}
    </div>
  `};var M0=(L,C)=>Math.hypot(L.x-C.x,L.y-C.y),o0=(L,C)=>({x:(L.x+C.x)/2,y:(L.y+C.y)/2}),i0=(L,C)=>Math.atan2(C.y-L.y,C.x-L.x),B7=L=>{let C=L;for(;C>Math.PI;)C-=Math.PI*2;for(;C<-Math.PI;)C+=Math.PI*2;return C},p1=(L,C,H)=>Math.max(C,Math.min(H,L)),z1=L=>L.map(C=>({...C})),R7="button, input, select, textarea, a, [contenteditable='true'], [role='button'], [role='menuitem'], [data-map-control]",L1=L=>L.composedPath().some(C=>C instanceof Element&&C.matches(R7)),A2=L=>L.composedPath().some(C=>C instanceof Element&&C.matches("select")),l2=class{#C;#H;#V;#e=new Map;#r=!1;#L="idle";#o=[];#i=null;#a=[];#A=null;#u=0;#M=null;#y=0;#h=null;#n=null;#v=null;#l=0;#p=null;#s=!1;#S=null;#t=!1;constructor(C,H,V){this.#C=C,this.#H=H,this.#V=V,C.addEventListener("pointerdown",this.#x),C.addEventListener("pointermove",this.#f),C.addEventListener("pointerup",this.#d),C.addEventListener("pointercancel",this.#d),C.addEventListener("wheel",this.#c,{passive:!1}),C.addEventListener("gesturestart",this.#Z,{passive:!1}),C.addEventListener("gesturechange",this.#w,{passive:!1}),C.addEventListener("gestureend",this.#O,{passive:!1}),C.addEventListener("dblclick",this.#g),C.addEventListener("contextmenu",this.#T),C.addEventListener("keydown",this.#k),C.addEventListener("keyup",this.#R),C.addEventListener("blur",this.#P)}#x=C=>{if(this.#t||!C.isPrimary&&C.pointerType==="mouse"||L1(C))return;this.#C.focus({preventScroll:!0}),this.#b(),C.pointerType==="touch"&&!C.isPrimary&&this.#e.size===0&&this.#V.state().draw.tool==="outline"&&(this.#s=!0);let H=performance.now(),V={id:C.pointerId,type:C.pointerType,startX:C.clientX,startY:C.clientY,x:C.clientX,y:C.clientY,lastX:C.clientX,lastY:C.clientY,lastTime:H,velocityX:0,velocityY:0};if(this.#e.set(C.pointerId,V),this.#C.setPointerCapture?.(C.pointerId),this.#e.size>=2){this.#_(),(this.#L==="paint"||this.#L==="erase")&&(this.#a=z1(this.#o),this.#V.onCircles(this.#a,!1,this.#o,this.#i)),this.#L="pinch",this.#C.classList.add("navigating"),this.#s=!0;let[M,o]=[...this.#e.values()];M&&o&&(this.#u=Math.max(1,M0(M,o)),this.#M=o0(M,o),this.#y=i0(M,o),this.#h=this.#H.camera),C.preventDefault();return}let e=this.#V.state(),r=e.workflow==="draw"&&e.map.available&&!e.floor.readOnly;this.#s||this.#r||C.button===1||C.button===2||e.draw.tool==="pan"?(this.#L="pan",this.#n=this.#H.camera):r&&e.draw.tool==="outline"&&_(e)?this.#L="outline":r&&(e.draw.tool==="paint"||e.draw.tool==="erase")?(this.#o=z1(e.draw.circles),this.#i=e.draw.outline??null,this.#a=z1(e.draw.circles),C.pointerType==="touch"?(this.#L="idle",this.#S=window.setTimeout(()=>{if(this.#S=null,this.#e.size!==1||this.#s)return;this.#L=e.draw.tool;let M=this.#e.get(C.pointerId);M&&this.#m(M.x,M.y)},110)):(this.#L=e.draw.tool,this.#m(C.clientX,C.clientY))):(this.#L=e.view==="three"&&!C.shiftKey?"orbit":"pan",this.#n=this.#H.camera),(this.#L==="pan"||this.#L==="orbit")&&this.#C.classList.add("navigating"),C.preventDefault()};#f=C=>{let H=this.#e.get(C.pointerId);if(!H){let a=this.#H.screenToMap(C.clientX,C.clientY);this.#H.setCursor(a);return}let e=(C.getCoalescedEvents?.()||[]).at(-1)||C,r=performance.now(),t=Math.max(1,r-H.lastTime),M=(e.clientX-H.lastX)/t,o=(e.clientY-H.lastY)/t;if(H.velocityX=H.velocityX*.62+M*.38,H.velocityY=H.velocityY*.62+o*.38,H.lastX=e.clientX,H.lastY=e.clientY,H.lastTime=r,H.x=e.clientX,H.y=e.clientY,this.#L==="pinch"&&this.#e.size>=2){let[a,n]=[...this.#e.values()];if(!a||!n)return;let l=Math.max(1,M0(a,n)),A=o0(a,n),d=i0(a,n),m=this.#h;if(m&&this.#M){let u={...m,distance:m.distance*this.#u/l,yaw:m.yaw+B7(d-this.#y),pitch:m.orthographic?m.pitch:m.pitch-(A.y-this.#M.y)*.0035};this.#H.setCamera(this.#H.cameraAfterPan(u,A.x-this.#M.x,A.y-this.#M.y))}C.preventDefault();return}this.#L==="paint"||this.#L==="erase"?this.#m(C.clientX,C.clientY):this.#L==="pan"?this.#n&&this.#H.setCamera(this.#H.cameraAfterPan(this.#n,e.clientX-H.startX,e.clientY-H.startY)):this.#L==="orbit"&&this.#n&&this.#H.setCamera({...this.#n,yaw:this.#n.yaw+(e.clientX-H.startX)*.0045,pitch:this.#n.pitch-(e.clientY-H.startY)*.004});let i=this.#H.screenToMap(e.clientX,e.clientY);this.#H.setCursor(i),C.preventDefault()};#d=C=>{let H=this.#e.get(C.pointerId);if(!H)return;let V=this.#L;if(this.#e.delete(C.pointerId),this.#C.releasePointerCapture?.(C.pointerId),this.#_(),this.#L==="outline"&&C.type!=="pointercancel"&&Math.hypot(H.x-H.startX,H.y-H.startY)<7){let e=this.#H.screenToMap(H.x,H.y);e&&this.#V.onOutlinePoint?.(e)}if((this.#L==="paint"||this.#L==="erase")&&JSON.stringify(this.#a)!==JSON.stringify(this.#o))this.#V.onCircles(this.#a,!0,this.#o,this.#i);else if(this.#L!=="pinch"&&!this.#s&&Math.hypot(H.x-H.startX,H.y-H.startY)<7&&this.#V.state().workflow==="rooms"){let e=this.#H.roomAt(H.x,H.y);e&&this.#V.onRoom(e)}if(this.#e.size===0)this.#L="idle",this.#C.classList.remove("navigating"),this.#s=!1,this.#M=null,this.#h=null,this.#n=null,this.#A=null,(V==="pan"||V==="orbit")&&H.type!=="mouse"&&this.#F(H.velocityX,H.velocityY,V);else if(this.#L==="pinch"){this.#L="pan",this.#s=!0;let e=this.#e.values().next().value;e&&(e.startX=e.x,e.startY=e.y,e.velocityX=0,e.velocityY=0),this.#n=this.#H.camera,this.#h=null}C.preventDefault()};#m(C,H,V=!0){let e=this.#H.screenToMap(C,H);if(!e)return;let r=this.#V.state(),t=r.draw.brushMeters/2;if(this.#L==="erase")this.#a=this.#a.filter(M=>Math.hypot(M.x-e.x,M.y-e.y)>M.radius+t);else{if(!this.#H.containsMapPoint(e))return;let M=Math.max(.04,t*.55),o=this.#A||e,i=Math.hypot(e.x-o.x,e.y-o.y),a=Math.max(1,Math.ceil(i/M));for(let n=0;n<=a&&this.#a.length<512;n+=1){let l=n/a,A={x:o.x+(e.x-o.x)*l,y:o.y+(e.y-o.y)*l};this.#a.some(d=>Math.hypot(d.x-A.x,d.y-A.y)<Math.max(.025,t*.28))||this.#a.push({x:Math.round(A.x*1e4)/1e4,y:Math.round(A.y*1e4)/1e4,radius:Math.round(t*100)/100})}}this.#A=e,V&&JSON.stringify(this.#a)!==JSON.stringify(r.draw.circles)&&this.#V.onCircles(this.#a,!1)}#c=C=>{if(L1(C))return;C.preventDefault(),this.#C.focus({preventScroll:!0}),this.#b();let H=C.deltaMode===WheelEvent.DOM_DELTA_LINE?16:C.deltaMode===WheelEvent.DOM_DELTA_PAGE?Math.max(1,this.#C.clientHeight):1,V=C.deltaX*H,e=C.deltaY*H;if(C.ctrlKey||C.metaKey){this.#H.zoomAt(Math.exp(p1(-e*.008,-.28,.28)),C.clientX,C.clientY);return}if(C.altKey&&this.#V.state().view==="three"){this.#H.orbitBy(0,p1(e,-80,80)*.75);return}if(C.deltaMode!==WheelEvent.DOM_DELTA_PIXEL||Math.abs(V)<.5&&Math.abs(e)>=50){this.#H.zoomAt(Math.exp(p1(-e*.0025,-.28,.28)),C.clientX,C.clientY);return}this.#H.panBy(-p1(V,-80,80),-p1(e,-80,80))};#Z=C=>{this.#t||L1(C)||(this.#C.focus({preventScroll:!0}),this.#b(),this.#C.classList.add("navigating"),this.#v=this.#H.camera,this.#l=Number.isFinite(C.rotation)?C.rotation:0,C.preventDefault())};#w=C=>{if(this.#t||L1(C))return;let H=this.#v;if(!H||this.#e.size>=2)return;let V=Number.isFinite(C.scale)&&C.scale>0?Math.max(.1,C.scale):1,e=Number.isFinite(C.rotation)?C.rotation:0;this.#H.setCamera({...H,distance:H.distance/V,yaw:H.yaw+(e-this.#l)*Math.PI/180}),C.preventDefault()};#O=C=>{let H=this.#v!==null;this.#v=null,this.#l=0,this.#C.classList.remove("navigating"),H&&!L1(C)&&C.preventDefault()};#E(C){let H=this.#V.state();if(C.repeat||this.#t||this.#e.size||C.composedPath()[0]!==this.#C||!this.#C.matches(":focus")||H.workflow!=="draw"||!_(H)||H.command!=="idle"&&H.command!=="failed"||H.draw.tool!=="paint"&&H.draw.tool!=="erase"&&H.draw.tool!=="outline")return;let e=this.#C.querySelector(".scene-canvas")?.getBoundingClientRect();if(!(!e?.width||!e.height)){if(C.preventDefault(),this.#b(),H.draw.tool==="outline"){let r=this.#H.screenToMap(e.left+e.width/2,e.top+e.height/2);r&&this.#V.onOutlinePoint?.(r);return}this.#o=z1(H.draw.circles),this.#i=H.draw.outline??null,this.#a=z1(H.draw.circles),this.#A=null,this.#L=H.draw.tool,this.#m(e.left+e.width/2,e.top+e.height/2,!1),this.#L="idle",this.#A=null,JSON.stringify(this.#a)!==JSON.stringify(this.#o)&&this.#V.onCircles(this.#a,!0,this.#o,this.#i)}}#k=C=>{if(L1(C)||C.defaultPrevented||C.ctrlKey||C.metaKey||C.altKey)return;if(C.key==="Enter"){this.#E(C);return}if(C.code==="Space"){this.#r=!0,C.preventDefault();return}this.#b();let H=this.#V.state(),V=C.key.toLocaleLowerCase();if(C.key==="+"||C.key==="=")this.#H.zoomAt(1.25);else if(C.key==="-")this.#H.zoomAt(.8);else if(C.key==="0")this.#H.fit();else if(V==="3")this.#B({type:"set-view",view:"three"});else if(V==="t")this.#B({type:"set-view",view:"top"});else if(C.key==="[")this.#H.orbitBy(-40,0);else if(C.key==="]")this.#H.orbitBy(40,0);else if(C.key==="PageUp")this.#H.orbitBy(0,-30);else if(C.key==="PageDown")this.#H.orbitBy(0,30);else if(V==="d"&&H.workflow==="draw")this.#B({type:"set-draw-tool",tool:"paint"});else if(V==="e"&&H.workflow==="draw")this.#B({type:"set-draw-tool",tool:"erase"});else if(["arrowleft","arrowright","arrowup","arrowdown"].includes(V))if(H.view==="three"&&!C.shiftKey){let e=V==="arrowleft"?-24:V==="arrowright"?24:0,r=V==="arrowup"?-20:V==="arrowdown"?20:0;this.#H.orbitBy(e,r)}else{let e=V==="arrowleft"?30:V==="arrowright"?-30:0,r=V==="arrowup"?30:V==="arrowdown"?-30:0;this.#H.panBy(e,r)}else if(H.workflow!=="draw"&&["w","a","s","d"].includes(V))this.#H.panBy(V==="a"?34:V==="d"?-34:0,V==="w"?34:V==="s"?-34:0);else if(H.workflow!=="draw"&&(V==="q"||V==="e"))this.#H.orbitBy(V==="q"?-30:30,0);else return;C.preventDefault()};#R=C=>{C.code==="Space"&&(this.#r=!1)};#P=()=>{this.#r=!1,this.#_(),this.#H.setCursor(null),this.#C.classList.remove("navigating")};#g=C=>{L1(C)||(this.#b(),this.#H.zoomAt(C.shiftKey?1/1.6:1.6,C.clientX,C.clientY),C.preventDefault())};#T=C=>{L1(C)||C.preventDefault()};#B(C){this.#C.dispatchEvent(new CustomEvent("matic-workspace-intent",{detail:C,bubbles:!0,composed:!0}))}#F(C,H,V){if(window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;let e=p1(C,-.55,.55),r=p1(H,-.55,.55);if(Math.hypot(e,r)<.02)return;let t=performance.now(),M=o=>{let i=Math.min(32,o-t);t=o,V==="orbit"?this.#H.orbitBy(e*i,r*i):this.#H.panBy(e*i,r*i);let a=.9**(i/16);e*=a,r*=a,Math.hypot(e,r)>=.01?this.#p=window.requestAnimationFrame(M):this.#p=null};this.#p=window.requestAnimationFrame(M)}#b(){this.#p!==null&&window.cancelAnimationFrame(this.#p),this.#p=null}#_(){this.#S!==null&&window.clearTimeout(this.#S),this.#S=null}dispose(){this.#t||(this.#t=!0,this.#_(),this.#b(),this.#C.removeEventListener("pointerdown",this.#x),this.#C.removeEventListener("pointermove",this.#f),this.#C.removeEventListener("pointerup",this.#d),this.#C.removeEventListener("pointercancel",this.#d),this.#C.removeEventListener("wheel",this.#c),this.#C.removeEventListener("gesturestart",this.#Z),this.#C.removeEventListener("gesturechange",this.#w),this.#C.removeEventListener("gestureend",this.#O),this.#C.removeEventListener("dblclick",this.#g),this.#C.removeEventListener("contextmenu",this.#T),this.#C.removeEventListener("keydown",this.#k),this.#C.removeEventListener("keyup",this.#R),this.#C.removeEventListener("blur",this.#P),this.#e.clear())}};var E7=L=>L.matches(":disabled, [aria-disabled='true']"),m1=class{#C;#H;#V=null;#e=null;constructor(C,H){this.#C=C,this.#H=H,C.addController(this)}hostConnected(){this.#C.addEventListener("focusin",this.#o)}hostDisconnected(){this.#C.removeEventListener("focusin",this.#o),this.#V?.removeEventListener("keydown",this.#i),this.#V=null,this.#e=null}hostUpdated(){let C=this.#H.container();C!==this.#V&&(this.#V?.removeEventListener("keydown",this.#i),C?.addEventListener("keydown",this.#i),this.#V=C),this.#L()}#r(){let C=this.#V;return C?[...C.querySelectorAll(this.#H.items)].filter(H=>!E7(H)):[]}#L(){let C=this.#r(),H=(this.#e&&C.includes(this.#e)?this.#e:null)??C.find(e=>e.matches("[aria-pressed='true'], [aria-checked='true']"))??C[0]??null;this.#e=H;let V=this.#V?.querySelectorAll(this.#H.items)??[];for(let e of V)e.tabIndex=e===H?0:-1}#o=C=>{let H=C.composedPath()[0];!(H instanceof HTMLElement)||!this.#V?.contains(H)||H.matches(this.#H.items)&&(this.#e=H,this.#L())};#i=C=>{if(C.defaultPrevented||C.ctrlKey||C.metaKey||C.altKey)return;let H=this.#H.orientation??"horizontal",V=H!=="vertical",e=H!=="horizontal",r=this.#r();if(!r.length)return;let t=C.composedPath()[0],M=Math.max(0,r.findIndex(a=>a===this.#e||t instanceof Node&&a.contains(t))),o;switch(C.key){case"ArrowLeft":if(!V)return;o=M-1;break;case"ArrowRight":if(!V)return;o=M+1;break;case"ArrowUp":if(!e)return;o=M-1;break;case"ArrowDown":if(!e)return;o=M+1;break;case"Home":o=0;break;case"End":o=r.length-1;break;default:return}C.preventDefault();let i=r[(o+r.length)%r.length];i&&(this.#e=i,this.#L(),i.focus())}};var N1=(L,C,H)=>{let V=H.x-C.x,e=H.y-C.y,r=Math.max(0,Math.min(1,((L.x-C.x)*V+(L.y-C.y)*e)/(V*V+e*e||1)));return Math.hypot(L.x-C.x-r*V,L.y-C.y-r*e)},F7=(L,C)=>{let H=!1;for(let V=0,e=C.length-1;V<C.length;e=V++){let r=C[V],t=C[e];r.y>L.y!=t.y>L.y&&L.x<(t.x-r.x)*(L.y-r.y)/(t.y-r.y)+r.x&&(H=!H)}return H},s2=(L,C,H)=>(C.x-L.x)*(H.y-L.y)-(C.y-L.y)*(H.x-L.x),O1=({points:L,closed:C})=>{if(L.length>64||C&&L.length<3||L.some(V=>!Number.isFinite(V.x)||!Number.isFinite(V.y)||Math.abs(V.x)>1e4||Math.abs(V.y)>1e4))return!1;let H=C?L.length:L.length-1;for(let V=0;V<H;V++){let e=L[V],r=L[(V+1)%L.length];if(Math.hypot(e.x-r.x,e.y-r.y)<.01)return!1;for(let t=V+2;t<H;t++){if(C&&V===0&&t===H-1)continue;let M=L[t],o=L[(t+1)%L.length];if(Math.min(N1(e,M,o),N1(r,M,o),N1(M,e,r),N1(o,e,r))<1e-5||s2(e,r,M)*s2(e,r,o)<0&&s2(M,o,e)*s2(M,o,r)<0)return!1}}return!C||Math.abs(L.reduce((V,e,r)=>{let t=L[(r+1)%L.length];return V+e.x*t.y-t.x*e.y},0))>.01},a0=(L,C)=>{if(!L.closed||!O1(L))return[];let{points:H}=L,V=Math.min(...H.map(i=>i.x)),e=Math.max(...H.map(i=>i.x)),r=Math.min(...H.map(i=>i.y)),t=Math.max(...H.map(i=>i.y)),M=[];for(let i=0;i<32;i++)for(let a=0;a<32;a++){let n={x:Math.round((V+(a+.5)*(e-V)/32)*1e4)/1e4,y:Math.round((r+(i+.5)*(t-r)/32)*1e4)/1e4};if(!F7(n,H)||!C(n))continue;let l=Math.min(...H.map((d,m)=>N1(n,d,H[(m+1)%H.length]))),A=Math.floor(Math.min(2.5,l-1e-4)*1e4)/1e4;A>=.05&&M.push({...n,radius:A})}M.sort((i,a)=>a.radius-i.radius);let o=[];for(let i of M){if(o.length>=512)break;o.some(a=>Math.hypot(a.x-i.x,a.y-i.y)+i.radius*.5<=a.radius)||o.push(i)}return o};var d2=class{constructor(C,H,V,e,r,t){this.state=C;this.renderer=H;this.intent=V;this.update=e;this.t=r;this.focusPoint=t}#C=null;#H="";#V=null;#e(){let C=this.state();return!C.dialog&&C.workflow==="draw"&&C.draw.tool==="outline"&&_(C)&&(C.command==="idle"||C.command==="failed")}#r(C){if(!this.#e())return;if(!O1(C)){this.#H=this.t("v4_zone_invalid","Keep the outline from crossing itself."),this.update();return}let H=a0(C,V=>this.renderer()?.containsMapPoint(V)??!1);if(C.closed&&!H.length){this.#H=this.t("v4_zone_empty","Make the zone wider and keep it on mapped floor."),this.update();return}this.#H="",this.intent({type:"set-draft-circles",circles:H,outline:C})}addPoint(C){if(!this.#e()||!this.renderer()?.containsMapPoint(C))return;let H=this.state().draw.outline??{points:[],closed:!1};H.closed||H.points.length>=64||this.#r({points:[...H.points,C],closed:!1})}#L(){let C=this.state().draw.outline;C&&C.points.length>=3&&this.#r({...C,closed:!0})}#o(C){let H=this.state().draw.outline;if(!H)return;this.#V=null;let V=H.points.filter((e,r)=>r!==C);this.#r({points:V,closed:H.closed&&V.length>=3}),this.focusPoint(Math.min(C,V.length-1))}#i(C){let H=this.state().draw.outline;if(!H||H.points.length>=64)return;let V=H.points[C],e=H.points[(C+1)%H.points.length];if(!V||!e||!H.closed&&C===H.points.length-1)return;let r={x:(V.x+e.x)/2,y:(V.y+e.y)/2};this.#r({...H,points:[...H.points.slice(0,C+1),r,...H.points.slice(C+1)]}),this.focusPoint(C+1)}#a(C,H){if(!this.#e()||C.button!==0||this.#C||C.pointerType==="touch"&&!C.isPrimary)return;this.#V=H,this.update();let V=this.state().draw.outline;if(!V)return;C.stopPropagation(),C.preventDefault();let e=C.currentTarget;e.focus({preventScroll:!0}),e.setPointerCapture(C.pointerId),this.#C={index:H,pointer:C.pointerId,baseline:V,preview:V,target:e}}#A(C){let H=this.#C;if(!H||H.pointer!==C.pointerId)return;if(C.stopPropagation(),C.preventDefault(),!this.#e()||this.state().draw.outline!==H.baseline){this.cancel();return}let V=this.renderer()?.screenToMap(C.clientX,C.clientY);!V||!this.renderer()?.containsMapPoint(V)||(H.preview={...H.baseline,points:H.baseline.points.map((e,r)=>r===H.index?V:e)},this.update())}#u(C){let H=this.#C;!H||H.pointer!==C.pointerId||(C.stopPropagation(),C.preventDefault(),this.#C=null,H.target.releasePointerCapture(C.pointerId),this.state().draw.outline===H.baseline&&this.#e()&&(H.preview!==H.baseline?this.#r(H.preview):H.index===0&&!H.baseline.closed&&this.#L()),this.update())}cancel(){let C=this.#C;C&&(this.#C=null,C.target.hasPointerCapture(C.pointer)&&C.target.releasePointerCapture(C.pointer),this.update())}#M(C,H){if(C.ctrlKey||C.altKey||C.metaKey)return;if(C.key==="Escape"){C.stopPropagation(),this.cancel();return}let V=this.state().draw.outline;if(!V||!this.#e())return;if(C.key==="Delete"||C.key==="Backspace"){C.preventDefault(),C.stopPropagation(),this.#o(H);return}let e=C.shiftKey?.1:.02,r=C.key==="ArrowLeft"?-e:C.key==="ArrowRight"?e:0,t=C.key==="ArrowUp"?-e:C.key==="ArrowDown"?e:0;if(!r&&!t)return;C.preventDefault(),C.stopPropagation();let M=V.points[H],o=this.renderer()?.offsetMapPoint(M,r,t);o&&this.renderer()?.containsMapPoint(o)&&this.#r({...V,points:V.points.map((i,a)=>a===H?o:i)})}render(){if(!this.#e())return s;let C=this.#C?.preview??this.state().draw.outline,H=C?.points??[],V=H.map(t=>this.renderer()?.mapToScreen(t)),e=V.map((t,M)=>t?`${M?"L":"M"}${t.x},${t.y}`:"").join(" "),r=!C||O1(C);return p`
      <div class="zone-overlay">
        <svg aria-hidden="true"><path d=${e+(C?.closed?" Z":"")} class=${r?"":"invalid"} fill=${C?.closed?"var(--ms-accent)":"none"}></path></svg>
        ${V.map((t,M)=>t?p`
          <button class="zone-point" type="button" data-zone-index=${M} data-selected=${String(this.#V===M)} data-map-control style=${`left:${t.x}px;top:${t.y}px`}
            aria-label=${`${this.t("v4_zone_point","Zone point")} ${M+1}`} aria-describedby="zone-handle-help"
            title=${this.t("v4_zone_point_help","Drag to move. Arrow keys adjust; Delete removes.")}
            @pointerdown=${o=>this.#a(o,M)} @pointermove=${o=>this.#A(o)}
            @pointerup=${o=>this.#u(o)} @pointercancel=${()=>this.cancel()}
            @lostpointercapture=${()=>{this.#C&&this.cancel()}}
            @focus=${()=>{this.#V=M,this.update()}}
            @keydown=${o=>this.#M(o,M)}
            @click=${o=>{o.detail===0&&M===0&&!C?.closed&&this.#L()}}
          >${M+1}</button>
        `:s)}
        ${H.map((t,M)=>{let o=H[(M+1)%H.length];if(!o||!C?.closed&&M===H.length-1||H.length>=64)return s;let i={x:(t.x+o.x)/2,y:(t.y+o.y)/2},a=this.renderer()?.mapToScreen(i),n=V[M],l=V[(M+1)%V.length];return a&&n&&l&&Math.hypot(n.x-l.x,n.y-l.y)>=100?p`<button class="zone-point zone-midpoint" type="button" data-map-control
            style=${`left:${a.x}px;top:${a.y}px`} aria-label=${`${this.t("v4_zone_add_point","Add point after")} ${M+1}`}
            @click=${()=>this.#i(M)}>+</button>`:s})}
        <div class="zone-help ms-surface" data-map-control>
          <span id="zone-handle-help" class="sr-only">${this.t("v4_zone_point_help","Drag to move. Arrow keys adjust; Delete removes.")}</span>
          <span>${C?.closed?this.t("v4_zone_edit_help","Drag points to reshape. + adds a point."):this.t("v4_zone_create_help","Place points. Select the first to close.")}</span>
          ${H.length>=3&&!C?.closed?p`<button class="ms-btn" type="button" @click=${()=>this.#L()}>${this.t("v4_zone_close","Close zone")}</button>`:s}
          ${this.#V!==null&&this.#V<H.length?p`
            ${H.length<64&&(C?.closed||this.#V<H.length-1)?p`<button class="ms-btn" type="button" @click=${()=>this.#i(this.#V)}>${this.t("v4_zone_insert_point","Insert point")}</button>`:s}
            <button class="ms-btn" type="button" @click=${()=>this.#o(this.#V)}>${this.t("v4_zone_delete_point","Delete point")} ${this.#V+1}</button>`:s}
          <span role="status">${this.#H}</span>
        </div>
      </div>
    `}};var n0={accent:["--ms-accent","Highlight",[6,120,206]],onAccent:["--ms-on-accent","HighlightText",[255,255,255]],text:["--ms-text","CanvasText",[38,50,56]],quiet:["--ms-text-quiet","GrayText",[75,92,105]],plate:["--ms-surface-card","Canvas",[250,252,253]],roomFill:["--ms-surface-sunken","Canvas",[231,238,242]]},D7=L=>Math.max(0,Math.min(255,Math.round(L))),l0=L=>{let C=L.trim(),H=C.match(/^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i)?.[1];if(H){let a=H.length<=4?[H[0],H[1],H[2]].map(d=>Number.parseInt(`${d}${d}`,16)):[H.slice(0,2),H.slice(2,4),H.slice(4,6)].map(d=>Number.parseInt(d,16)),[n,l,A]=a;return n===void 0||l===void 0||A===void 0?null:[n,l,A]}let V=C.startsWith("color(srgb"),e=C.slice(C.indexOf("(")+1).match(/-?\d*\.?\d+/g);if(!e||e.length<3)return null;let r=V?255:1,t=e.slice(0,3).map(a=>D7(Number(a)*r)),[M,o,i]=t;return M===void 0||o===void 0||i===void 0||[M,o,i].some(a=>Number.isNaN(a))?null:[M,o,i]},T=(L,C)=>`rgba(${L[0]},${L[1]},${L[2]},${C})`,A0=L=>{let C=window.matchMedia?.("(forced-colors: active)").matches??!1;if(!C){let e=document.createElement("span"),r=document.createElement("canvas");r.width=1,r.height=1;let t=r.getContext("2d",{colorSpace:"srgb",willReadFrequently:!0});e.setAttribute("aria-hidden","true"),e.style.cssText="position:absolute;inline-size:0;block-size:0;overflow:hidden;visibility:hidden;pointer-events:none",L.append(e);let M=o=>{let[i,,a]=n0[o];e.style.color=`var(${i}, transparent)`;let n=getComputedStyle(e).color;if(t){t.clearRect(0,0,1,1),t.fillStyle="transparent",t.fillStyle=n,t.fillRect(0,0,1,1);let[l,A,d,m]=t.getImageData(0,0,1,1).data;if(l!==void 0&&A!==void 0&&d!==void 0&&m!==void 0&&m!==0)return[l,A,d]}return l0(n)??a};try{return{accent:M("accent"),onAccent:M("onAccent"),text:M("text"),quiet:M("quiet"),plate:M("plate"),roomFill:M("roomFill"),forced:C}}finally{e.remove()}}let H=document.createElement("span");H.setAttribute("aria-hidden","true"),H.style.cssText="position:absolute;inline-size:0;block-size:0;overflow:hidden;visibility:hidden;pointer-events:none",L.append(H);let V=e=>{let[,r,t]=n0[e];return H.style.color=r,l0(getComputedStyle(H).color)??t};try{return{accent:V("accent"),onAccent:V("onAccent"),text:V("text"),quiet:V("quiet"),plate:V("plate"),roomFill:V("roomFill"),forced:C}}finally{H.remove()}};var B=(L,C,H)=>Math.max(C,Math.min(H,L)),U1=L=>{let C=L;for(;C>Math.PI;)C-=Math.PI*2;for(;C<-Math.PI;)C+=Math.PI*2;return C},$7=L=>{switch(L){case"efficient":return .35;case"balanced":return .65;case"maximum":case"auto":return 1}},I7={accent:[6,120,206],onAccent:[255,255,255],text:[38,50,56],quiet:[75,92,105],plate:[250,252,253],roomFill:[231,238,242],forced:!1},d0=Math.PI/3.15,W7=1.08,z7=(L,C)=>{let H=d0/2,V=Math.atan(Math.tan(H)*Math.max(.2,C));return L/Math.sin(Math.min(H,V))*W7},N7=(L,C)=>{let H=new Float32Array(16);for(let V=0;V<4;V+=1)for(let e=0;e<4;e+=1){let r=0;for(let t=0;t<4;t+=1)r+=(L[t*4+e]??0)*(C[V*4+t]??0);H[V*4+e]=r}return H},U7=(L,C,H,V)=>{let e=1/Math.tan(L/2),r=new Float32Array(16);return r[0]=e/C,r[5]=e,r[10]=(V+H)/(H-V),r[11]=-1,r[14]=2*V*H/(H-V),r},G7=(L,C,H,V,e,r)=>{let t=new Float32Array(16);return t[0]=2/(C-L),t[5]=2/(V-H),t[10]=-2/(r-e),t[12]=-(C+L)/(C-L),t[13]=-(V+H)/(V-H),t[14]=-(r+e)/(r-e),t[15]=1,t},K7=(L,C)=>{let H=Math.hypot((L[0]??0)-(C[0]??0),(L[1]??0)-(C[1]??0),(L[2]??0)-(C[2]??0))||1,V=[((L[0]??0)-(C[0]??0))/H,((L[1]??0)-(C[1]??0))/H,((L[2]??0)-(C[2]??0))/H],e=Math.hypot(V[2]??0,V[0]??0)||1,r=[(V[2]??0)/e,0,-(V[0]??0)/e],t=[(V[1]??0)*(r[2]??0),(V[2]??0)*(r[0]??0)-(V[0]??0)*(r[2]??0),-(V[1]??0)*(r[0]??0)];return new Float32Array([r[0]??0,t[0]??0,V[0]??0,0,r[1]??0,t[1]??0,V[1]??0,0,r[2]??0,t[2]??0,V[2]??0,0,-((r[0]??0)*(L[0]??0)+(r[1]??0)*(L[1]??0)+(r[2]??0)*(L[2]??0)),-((t[0]??0)*(L[0]??0)+(t[1]??0)*(L[1]??0)+(t[2]??0)*(L[2]??0)),-((V[0]??0)*(L[0]??0)+(V[1]??0)*(L[1]??0)+(V[2]??0)*(L[2]??0)),1])},s0=(L,C,H)=>{let V=!1,e=H.at(-1);if(!e)return!1;for(let r of H){let[t,M]=r,[o,i]=e;M>C!=i>C&&L<(o-t)*(C-M)/(i-M)+t&&(V=!V),e=r}return V},p2=class{#C;#H;#V;#e=null;#r=null;#L=null;#o=null;#i=null;#a=null;#A=null;#u=null;#M=null;#y=null;#h=null;#n=null;#v=null;#l=null;#p=null;#s=null;#S;#t={yaw:-Math.PI/4,pitch:.82,distance:12,targetX:0,targetZ:0,orthographic:!1};#x=12;#f=8;#d=4;#m=new Float32Array(16);#c=null;#Z="unavailable";#w=0;#O=0;#E=0;#k=0;#R=1;#P={width:1,height:1,left:0,top:0};#g=!0;#T=!1;#B=I7;constructor(C,H,V={}){this.#C=C,this.#H=H,this.#V=V,this.#r=H.getContext("2d",{alpha:!0}),this.#C.addEventListener("webglcontextlost",this.#t1),this.#C.addEventListener("webglcontextrestored",this.#M1),this.#N(),this.#S=new ResizeObserver(()=>{let e=this.#x,r=this.#f;this.#U(),this.#g&&(e!==this.#x||r!==this.#f)?this.fit(!1):this.requestRender()}),this.#S.observe(C)}get camera(){return{...this.#t}}#F(){return{minimum:Math.max(.2,this.#d*.04),maximum:this.#d*8}}#b(){let C=this.#l?.metadata.span,H=this.#l?.metadata.metersPerCell;return!C||H===void 0?{x:this.#d,z:this.#d}:{x:Math.max(.5,C[0]*H*.55),z:Math.max(.5,C[1]*H*.55)}}setCamera(C,H=!0){let V=this.#F(),e=this.#b();this.#t={yaw:U1(C.yaw),pitch:C.orthographic?Math.PI/2-.018:B(C.pitch,.18,1.38),distance:B(C.distance,V.minimum,V.maximum),targetX:B(C.targetX,-e.x,e.x),targetZ:B(C.targetZ,-e.z,e.z),orthographic:C.orthographic},this.#g=!1,this.requestRender(),H&&this.#Q()}cameraAfterPan(C,H,V){let e=this.#D(),r=C.distance*1.75/Math.max(200,e.height),t=Math.cos(C.yaw),M=-Math.sin(C.yaw),o=-Math.sin(C.yaw),i=-Math.cos(C.yaw),a=this.#b();return{...C,targetX:B(C.targetX-H*r*t+V*r*o,-a.x,a.x),targetZ:B(C.targetZ-H*r*M+V*r*i,-a.z,a.z)}}setState(C){if(this.#T)return;let H=this.#v;this.#v=C;let V=C.resources.scene.value;V!==this.#l&&(this.#l=V,this.#H1(V)),(!H||H.quality!==C.quality)&&(this.#R=$7(C.quality),this.#k=0);let e=H?.workflow!=="draw"&&C.workflow==="draw",r=H?.workflow==="draw"&&C.workflow!=="draw";if(!H||H.view!==C.view||e||r){let t=C.workflow==="draw"?"top":C.view;this.#t=this.#_(t,C),this.#g=this.#C1(t,C)}C.workflow==="draw"&&H?.draw.zoomPercent!==C.draw.zoomPercent&&(this.#t={...this.#t,orthographic:!0,pitch:Math.PI/2-.018,distance:this.#f*100/C.draw.zoomPercent},this.#g=C.draw.zoomPercent===100&&Math.abs(this.#t.targetX)<.001&&Math.abs(this.#t.targetZ)<.001&&Math.abs(U1(this.#t.yaw))<.001),this.requestRender()}#_(C,H){let V=C==="top",e=V?this.#f:this.#x,r=H.cameras[C];return r?{yaw:r.yaw,pitch:V?Math.PI/2-.018:r.pitch,distance:B(e/B(r.zoom,.01,100),Math.max(.2,this.#d*.04),this.#d*8),targetX:B(r.targetX,-this.#d,this.#d),targetZ:B(r.targetZ,-this.#d,this.#d),orthographic:V}:V?{yaw:0,pitch:Math.PI/2-.018,distance:e,targetX:0,targetZ:0,orthographic:!0}:{yaw:-Math.PI/4,pitch:.82,distance:e,targetX:0,targetZ:0,orthographic:!1}}#C1(C,H){let V=H.cameras[C];if(!V)return!0;let e=C==="top";return Math.abs(V.zoom-1)<.001&&Math.abs(V.targetX)<.001&&Math.abs(V.targetZ)<.001&&Math.abs(U1(V.yaw-(e?0:-Math.PI/4)))<.001&&(e||Math.abs(V.pitch-.82)<.001)}#q(C,H){let V=this.#e;if(!V)throw new Error("webgl-unavailable");let e=V.createShader(C);if(!e)throw new Error("shader-unavailable");if(V.shaderSource(e,H),V.compileShader(e),!V.getShaderParameter(e,V.COMPILE_STATUS))throw V.deleteShader(e),new Error("shader-failed");return e}#N(){try{this.#e=this.#C.getContext("webgl2",{alpha:!0,antialias:!0,depth:!0,powerPreference:"high-performance"});let C=this.#e;if(!C)throw new Error("webgl2-unavailable");let H=this.#q(C.VERTEX_SHADER,`#version 300 es
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
      `),V=this.#q(C.FRAGMENT_SHADER,`#version 300 es
        precision highp float;
        in vec3 vColor;
        out vec4 outColor;
        void main() {
          vec2 point = gl_PointCoord * 2.0 - 1.0;
          if (dot(point, point) > 1.0) discard;
          float edge = smoothstep(1.0, 0.72, dot(point, point));
          outColor = vec4(pow(vColor, vec3(0.94)), edge);
        }
      `),e=C.createProgram();if(!e)throw new Error("program-unavailable");if(C.attachShader(e,H),C.attachShader(e,V),C.linkProgram(e),C.deleteShader(H),C.deleteShader(V),!C.getProgramParameter(e,C.LINK_STATUS))throw new Error("program-failed");this.#i=e,this.#u=C.getUniformLocation(e,"uViewProjection"),this.#M=C.getUniformLocation(e,"uCenter"),this.#y=C.getUniformLocation(e,"uMetersPerCell"),this.#h=C.getUniformLocation(e,"uPointPixels"),this.#n=C.getUniformLocation(e,"uMaxPointPixels"),this.#a=C.createBuffer(),this.#A=C.createVertexArray(),C.bindVertexArray(this.#A),C.bindBuffer(C.ARRAY_BUFFER,this.#a),C.enableVertexAttribArray(0),C.vertexAttribIPointer(0,2,C.UNSIGNED_SHORT,8,0),C.enableVertexAttribArray(1),C.vertexAttribIPointer(1,1,C.UNSIGNED_BYTE,8,4),C.enableVertexAttribArray(2),C.vertexAttribPointer(2,3,C.UNSIGNED_BYTE,!0,8,5),C.bindVertexArray(null),C.enable(C.DEPTH_TEST),C.depthFunc(C.LEQUAL),C.enable(C.BLEND),C.blendFunc(C.SRC_ALPHA,C.ONE_MINUS_SRC_ALPHA),this.#Z="webgl2",this.#w+=1,this.#l&&this.#X(this.#l)}catch{this.#J(),this.#Y()}}#H1(C){if(this.#G(),!C){this.#O=0,this.requestRender();return}let[H,V]=C.metadata.span,e=C.metadata.metersPerCell,r=H*e,t=V*e;this.#d=Math.max(1,Math.hypot(r,t)/2),this.#U(),this.fit(!1),this.#Z==="webgl2"?this.#X(C):this.#I(C)}#U(){let C=this.#l;if(!C)return;let[H,V]=C.metadata.span,e=C.metadata.metersPerCell,r=H*e,t=V*e,M=this.#D(),o=Math.max(.2,M.width/Math.max(1,M.height));this.#x=z7(this.#d,o),this.#f=Math.max(t/2,r/(2*o))*1.12}#X(C){let H=this.#e;if(!H||!this.#a)return;let V=new Uint8Array(C.buffer,C.pointOffset,C.total*8);H.bindBuffer(H.ARRAY_BUFFER,this.#a),H.bufferData(H.ARRAY_BUFFER,V,H.STATIC_DRAW),this.#O=C.total}#Y(){this.#Z="canvas2d",this.#o=document.createElement("canvas"),this.#o.width=1024,this.#o.height=1024,this.#L=this.#o.getContext("2d",{alpha:!0}),this.#L?this.#l&&this.#I(this.#l):(this.#Z="unavailable",this.#V.onProblem?.("renderer-unavailable"))}#I(C){let H=this.#L;if(!H||!this.#o)return;H.clearRect(0,0,this.#o.width,this.#o.height);let V=new DataView(C.buffer,C.pointOffset,C.total*8),e=Math.min(C.total,5e4),r=Math.max(1,Math.ceil(C.total/e)),t=0,M=0,o=()=>{if(this.#T||C!==this.#l||!this.#o)return;let i=Math.min(C.total,t+r*4e3);for(;t<i;t+=r){let a=t*8,n=V.getUint16(a,!0)/Math.max(1,C.metadata.span[0])*this.#o.width,l=V.getUint16(a+2,!0)/Math.max(1,C.metadata.span[1])*this.#o.height,A=V.getUint8(a+5),d=V.getUint8(a+6),m=V.getUint8(a+7);H.fillStyle=`rgb(${A} ${d} ${m})`,H.fillRect(n,l,1.5,1.5),M+=1}this.#O=M,this.requestRender(),t<C.total?this.#s=window.setTimeout(o,0):this.#s=null};o()}#G(){this.#s!==null&&window.clearTimeout(this.#s),this.#s=null}#D(){let C=this.#C.getBoundingClientRect();return this.#P={width:C.width,height:C.height,left:C.left,top:C.top},this.#P}#W(){let C=!1,H=this.#D(),V=Math.min(window.devicePixelRatio||1,3),e=Math.max(1,Math.round(H.width*V)),r=Math.max(1,Math.round(H.height*V));for(let t of[this.#C,this.#H])(t.width!==e||t.height!==r)&&(t.width=e,t.height=r,C=!0);C&&this.#V.onViewport?.()}#z(){let C=this.#P,H=Math.max(.2,C.width/Math.max(1,C.height)),V=Math.cos(this.#t.pitch)*this.#t.distance,e=[this.#t.targetX+Math.sin(this.#t.yaw)*V,Math.sin(this.#t.pitch)*this.#t.distance,this.#t.targetZ+Math.cos(this.#t.yaw)*V],r=[this.#t.targetX,0,this.#t.targetZ],t=K7(e,r),M=this.#t.orthographic?G7(-this.#t.distance*H,this.#t.distance*H,-this.#t.distance,this.#t.distance,-this.#d*4,this.#d*4):U7(d0,H,.02,Math.max(60,this.#d*12));return N7(M,t)}requestRender(){this.#p!==null||this.#T||(this.#p=window.requestAnimationFrame(()=>{this.#p=null,this.#V1()}))}#V1(){let C=performance.now();this.#W(),this.#m=this.#z(),this.#Z==="webgl2"?this.#L1():this.#e1(),this.#o1(),this.#E=performance.now()-C,this.#E>18?(this.#k+=1,this.#k>=3&&this.#v?.quality==="auto"&&(this.#R=Math.max(.25,this.#R*.75))):this.#k=Math.max(0,this.#k-1)}#L1(){let C=this.#e,H=this.#l;if(!C||(C.viewport(0,0,this.#C.width,this.#C.height),C.clearColor(0,0,0,0),C.clear(C.COLOR_BUFFER_BIT|C.DEPTH_BUFFER_BIT),!H||!this.#i||!this.#A))return;if(this.#v?.view==="top"&&this.#v.appearance==="rooms"){this.#O=0;return}C.useProgram(this.#i),C.bindVertexArray(this.#A),C.uniformMatrix4fv(this.#u,!1,this.#m),C.uniform2f(this.#M,(H.metadata.span[0]-1)/2,(H.metadata.span[1]-1)/2),C.uniform1f(this.#y,H.metadata.metersPerCell);let V=Math.min(window.devicePixelRatio||1,3),e=Math.max(1,Math.floor(H.total*this.#R)),r=Math.min(H.floorCount,e),t=Math.min(H.surfaceCount,Math.max(0,e-r));C.uniform1f(this.#h,this.#C.height*.038),C.uniform1f(this.#n,4.5*V),C.drawArrays(C.POINTS,0,r),C.uniform1f(this.#h,this.#C.height*.05),C.uniform1f(this.#n,7*V),C.drawArrays(C.POINTS,H.floorCount,t),C.bindVertexArray(null),this.#O=r+t}#e1(){}#j(C,H,V=0){let e=this.#l;return e?[-(C-(e.metadata.span[0]-1)/2)*e.metadata.metersPerCell,V*e.metadata.metersPerCell,(H-(e.metadata.span[1]-1)/2)*e.metadata.metersPerCell]:null}#K(C,H,V=0,e=!0,r=this.#m){let t=this.#j(C,H,V);if(!t)return null;let[M,o,i]=t,a=(r[0]??0)*M+(r[4]??0)*o+(r[8]??0)*i+(r[12]??0),n=(r[1]??0)*M+(r[5]??0)*o+(r[9]??0)*i+(r[13]??0),l=(r[3]??0)*M+(r[7]??0)*o+(r[11]??0)*i+(r[15]??0);if(l<=.001)return null;let A=a/l,d=n/l;if(!Number.isFinite(A)||!Number.isFinite(d)||e&&(Math.abs(A)>1.15||Math.abs(d)>1.15))return null;let m=this.#P;return{x:(A*.5+.5)*m.width,y:(-d*.5+.5)*m.height}}#$(C,H,V=0,e=!0,r=this.#m){let t=this.#l;if(!t)return null;let M=C/t.metadata.metersPerCell-t.metadata.origin[0],o=H/t.metadata.metersPerCell-t.metadata.origin[1];return this.#K(M,o,V,e,r)}#o1(){let C=this.#r,H=this.#l,V=this.#v;if(!C)return;let e=Math.min(window.devicePixelRatio||1,3),r=this.#P;if(C.setTransform(e,0,0,e,0,0),C.clearRect(0,0,r.width,r.height),!H||!V)return;let t=this.#B;if(this.#Z==="canvas2d"&&this.#o&&!(V.view==="top"&&V.appearance==="rooms")){let n=this.#f/this.#t.distance,l=r.width*n,A=r.height*n,d=(r.width-l)/2-this.#t.targetX*32*n,m=(r.height-A)/2-this.#t.targetZ*32*n;C.drawImage(this.#o,d,m,l,A)}let M=this.#i1(V);if(V.labelsVisible||V.view==="top"&&V.appearance==="rooms"){C.lineWidth=1.5,C.font="600 12px system-ui, sans-serif",C.textAlign="center",C.textBaseline="middle";let n=[];for(let l of H.metadata.rooms){let A=M.has(l.name.toLocaleLowerCase());C.strokeStyle=A?T(t.accent,1):T(t.quiet,.7),C.fillStyle=A?T(t.accent,.26):V.view==="top"&&V.appearance==="rooms"?T(t.roomFill,.94):T(t.plate,.04),C.beginPath();let d=Math.max(1,Math.ceil(l.boundary.length/512)),m=!1;for(let S=0;S<l.boundary.length;S+=d){let O=l.boundary[S];if(!O)continue;let g=this.#K(O[0],O[1],.2,!1);g&&(m?C.lineTo(g.x,g.y):C.moveTo(g.x,g.y),m=!0)}if(m&&(C.closePath(),C.fill(),C.stroke()),!V.labelsVisible)continue;let u=this.#K(l.center[0],l.center[1],1);if(!u)continue;let h=C.measureText(l.name).width,f=new DOMRect(u.x-h/2-6,u.y-10,h+12,20);n.some(S=>f.left<S.right+8&&f.right+8>S.left&&f.top<S.bottom+4&&f.bottom+4>S.top)||(n.push(f),C.fillStyle=T(t.plate,.88),C.fillRect(f.x,f.y,f.width,f.height),C.fillStyle=T(t.text,1),C.fillText(l.name,u.x,u.y))}}let o=V.draw.circles;if((V.workflow==="draw"||V.workflow==="areaReview")&&o.length)if(C.fillStyle=T(t.accent,.22),C.strokeStyle=T(t.accent,.92),C.lineWidth=1.5,V.draw.outline?.closed){C.beginPath();for(let n of o)this.#r1(C,n,!1);C.fill()}else for(let n of o)this.#r1(C,n);let i=V.draw.outline;if(i&&(V.workflow==="draw"||V.workflow==="areaReview")&&!(V.workflow==="draw"&&V.draw.tool==="outline")&&(C.beginPath(),i.points.forEach((n,l)=>{let A=this.#$(n.x,n.y,0,!1);A&&(l===0?C.moveTo(A.x,A.y):C.lineTo(A.x,A.y))}),i.closed&&C.closePath(),C.strokeStyle=T(t.accent,1),C.lineWidth=2,C.stroke()),this.#c&&V.workflow==="draw"&&(V.draw.tool==="paint"||V.draw.tool==="erase")){let n=this.#$(this.#c.x,this.#c.y),l=this.#$(this.#c.x+V.draw.brushMeters/2,this.#c.y);n&&l&&(C.beginPath(),C.arc(n.x,n.y,Math.max(2,Math.hypot(l.x-n.x,l.y-n.y)),0,Math.PI*2),C.strokeStyle=T(t.accent,1),C.lineWidth=2,C.stroke())}let a=V.resources.pose.value;if(V.map.exactPose&&a?.position&&V.dataMode==="live"){let n=this.#$(a.position[0],a.position[1],3);n&&(C.beginPath(),C.arc(n.x,n.y,7,0,Math.PI*2),C.fillStyle=T(t.accent,1),C.fill(),C.strokeStyle=T(t.onAccent,1),C.lineWidth=3,C.stroke())}}#i1(C){let H=C.resources.plans.value?.rooms||C.resources.areas.value?.rooms||[];return new Set(H.filter(V=>C.selection.roomIds.includes(V.roomId)).map(V=>V.name.toLocaleLowerCase()))}#r1(C,H,V=!0){let e=this.#$(H.x,H.y),r=this.#$(H.x+H.radius,H.y);if(!e||!r)return;let t=Math.max(1,Math.hypot(r.x-e.x,r.y-e.y));V&&C.beginPath(),C.moveTo(e.x+t,e.y),C.arc(e.x,e.y,t,0,Math.PI*2),V&&(C.fill(),C.stroke())}setPalette(C){this.#B=C,this.requestRender()}setCursor(C){this.#c=C,this.requestRender()}mapToScreen(C){if(!this.#l||!this.#t.orthographic)return null;let H=this.#D();return!H.width||!H.height?null:this.#$(C.x,C.y,0,!1,this.#z())}offsetMapPoint(C,H,V){let e=this.mapToScreen(C);if(!e)return null;let r=this.#P,t=this.#t.distance*2/r.height;return this.screenToMap(r.left+e.x+H/t,r.top+e.y+V/t)}screenToMap(C,H){let V=this.#l;if(!V||!this.#t.orthographic)return null;let e=this.#D();if(!e.width||!e.height)return null;let r=this.#z(),t=r[0],M=r[8],o=r[1],i=r[9],a=t*i-M*o;if(!Number.isFinite(a)||Math.abs(a)<1e-12)return null;let n=(C-e.left)/e.width*2-1-r[12],l=1-(H-e.top)/e.height*2-r[13],A=(n*i-M*l)/a,d=(t*l-n*o)/a,m=-A/V.metadata.metersPerCell+(V.metadata.span[0]-1)/2,u=d/V.metadata.metersPerCell+(V.metadata.span[1]-1)/2;return{x:(m+V.metadata.origin[0])*V.metadata.metersPerCell,y:(u+V.metadata.origin[1])*V.metadata.metersPerCell}}roomAt(C,H){let V=this.screenToMap(C,H),e=this.#l,r=this.#v;if(!V||!e||!r)return null;let t=V.x/e.metadata.metersPerCell-e.metadata.origin[0],M=V.y/e.metadata.metersPerCell-e.metadata.origin[1],o=e.metadata.rooms.find(i=>s0(t,M,i.boundary));return o?this.#a1(o,r):null}containsMapPoint(C){let H=this.#l;if(!H)return!1;let V=C.x/H.metadata.metersPerCell-H.metadata.origin[0],e=C.y/H.metadata.metersPerCell-H.metadata.origin[1];return H.metadata.rooms.some(r=>s0(V,e,r.boundary))}#a1(C,H){return(H.resources.plans.value?.rooms||H.resources.areas.value?.rooms||[]).find(e=>e.name.localeCompare(C.name,void 0,{sensitivity:"base"})===0)?.roomId||C.id}selectRoomAt(C,H){let V=this.roomAt(C,H);V&&this.#V.onRoom?.(V)}fit(C=!0){let H=this.#v?.view==="top"||this.#v?.workflow==="draw";this.#t=H?{yaw:0,pitch:Math.PI/2-.018,distance:this.#f,targetX:0,targetZ:0,orthographic:!0}:{yaw:-Math.PI/4,pitch:.82,distance:this.#x,targetX:0,targetZ:0,orthographic:!1},this.#g=!0,this.requestRender(),C&&this.#Q()}zoomAt(C,H,V){let e=H===void 0||V===void 0?null:this.screenToMap(H,V),r=this.#F();if(this.#t={...this.#t,distance:B(this.#t.distance/C,r.minimum,r.maximum)},this.#g=!1,e&&H!==void 0&&V!==void 0){let t=this.screenToMap(H,V);t&&(this.#t={...this.#t,targetX:this.#t.targetX-(e.x-t.x),targetZ:this.#t.targetZ+(e.y-t.y)})}this.requestRender(),this.#Q(H,V)}panBy(C,H){this.setCamera(this.cameraAfterPan(this.#t,C,H))}orbitBy(C,H){if(this.#t.orthographic){this.panBy(C,H);return}this.#t={...this.#t,yaw:U1(this.#t.yaw+C*.006),pitch:B(this.#t.pitch-H*.004,.18,1.38)},this.#g=!1,this.requestRender(),this.#Q()}rotateBy(C){this.#t={...this.#t,yaw:U1(this.#t.yaw+C)},this.#g=!1,this.requestRender(),this.#Q()}#Q(C,H){let V=this.#t.orthographic?this.#f:this.#x,e=C===void 0||H===void 0?this.#P:this.#D(),r=C===void 0||H===void 0||!e.width||!e.height?void 0:{xPercent:B((C-e.left)/e.width*100,0,100),yPercent:B((H-e.top)/e.height*100,0,100)};this.#V.onCamera?.(this.camera,Math.round(V/this.#t.distance*100),r)}diagnostics(){return{mode:this.#Z,contextGeneration:this.#w,sceneRevision:this.#l?.revision??null,sourcePoints:this.#l?.total??0,renderedPoints:this.#O,lastFrameMs:Math.round(this.#E*100)/100,slowFrames:this.#k,cameraDistance:this.#t.distance,fitDistance:this.#t.orthographic?this.#f:this.#x,fitActive:this.#g}}#t1=C=>{C.preventDefault(),this.#J(),this.#Y(),this.requestRender()};#M1=()=>{this.#J(),this.#N(),this.requestRender()};#J(){let C=this.#e;C&&(this.#a&&C.deleteBuffer(this.#a),this.#A&&C.deleteVertexArray(this.#A),this.#i&&C.deleteProgram(this.#i)),this.#a=null,this.#A=null,this.#i=null,this.#e=null}dispose(){this.#T||(this.#T=!0,this.#S.disconnect(),this.#C.removeEventListener("webglcontextlost",this.#t1),this.#C.removeEventListener("webglcontextrestored",this.#M1),this.#p!==null&&window.cancelAnimationFrame(this.#p),this.#p=null,this.#G(),this.#J(),this.#o=null,this.#L=null,this.#r=null,this.#l=null,this.#v=null)}};var p0="component.matic_robot.common.",R=(L,C,H,V)=>{let e=V?{...V}:void 0,r=L?.(`${p0}${C}`,e);return r&&r!==`${p0}${C}`?r:V?Object.entries(V).reduce((t,[M,o])=>t.replaceAll(`{${M}}`,String(o)),H):H};var e1="matic-workspace-intent",m2="matic-workspace-action",m0="navigation-help",c0=(L,C)=>{let H=(e,r,t)=>R(C,e,r,t);if(L.dataMode==="history")return L.map.available?H("v4_saved_map_description","Saved read-only map for {floor}. Live robot position is hidden.",{floor:L.floor.displayName}):L.resources.scene.status==="loading"?H("v4_saved_map_loading_description","The saved map is loading."):H("v4_saved_map_unavailable_description","This saved map is unavailable.");if(!S1(L))return H("v4_private_map_unavailable","The current private map is not available.");let V=O5(L)?H("v4_robot_position_verified","The robot position is verified."):H("v4_robot_position_hidden","The robot position is not shown.");return H("v4_live_map_description","Live map for {floor}. {pose}",{floor:L.floor.displayName,pose:V})},i5=class extends k{constructor(){super();this.state=y();this.narrow=!1;this.#C=null;this.#H=null;this.#V=null;this.#e=!1;this.#r=!1;this.#L=null;this.#o=[];this.#i=null;this.#a=null;this.#A={capture:!0,handleEvent:H=>{H.pointerType==="touch"&&!H.isPrimary&&this.#u.cancel()}};this.#u=new d2(()=>this.state,()=>this.#H,H=>this.#s(H),()=>this.requestUpdate(),(H,V)=>this.#M(H,V),H=>{this.updateComplete.then(()=>{(this.renderRoot.querySelector(`[data-zone-index="${H}"]`)??this.renderRoot.querySelector(".map-root"))?.focus({preventScroll:!0})})});this.#v=()=>{this.#h()};new m1(this,{container:()=>this.renderRoot?.querySelector(".camera-steps")??null,items:"button"}),new m1(this,{container:()=>this.renderRoot?.querySelector(".draw-tools")??null,items:"button"})}static{this.properties={state:{attribute:!1},localize:{attribute:!1},narrow:{type:Boolean,reflect:!0}}}static{this.styles=[$,I,V1,w`
    :host {
      display: block;
      min-width: 0;
      min-height: 0;
      block-size: 100%;
      color: var(--ms-text);
    }


    button, input { font: inherit; }

    .map-root {
      position: relative;
      overflow: hidden;
      min-block-size: 22rem;
      block-size: 100%;
      outline: none;
      isolation: isolate;
      --ms-local: var(--ms-surface-sunken);
      background: var(--ms-local);
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

    /* Navigation has stable corners; only orbit controls follow the sheet. */
    .map-rail { --help-top: calc(44px + 2 * var(--ms-space-2)); --help-bottom: 116px; position: absolute; inset: 0.75rem; z-index: 4; pointer-events: none; }
    .map-rail > * { pointer-events: auto; }
    slot[name="scrim"] { display: contents; pointer-events: none; }
    ::slotted(.sheet-scrim) { pointer-events: auto; }
    .map-context { position: absolute; inset-block-start: 0; inset-inline-start: 0; display: flex; gap: var(--ms-space-2); align-items: center; max-inline-size: calc(100% - 60px); }
    ::slotted(.floor-switcher) { min-inline-size: 0; inline-size: 9rem; min-block-size: 44px; background-color: var(--ms-surface-card); color: var(--ms-text); }
    .view-switch { flex: none; }
    .map-tools { position: absolute; inset-block-start: 0; inset-inline-end: 0; }
    .map-extras { position: absolute; inset-block-end: calc(var(--map-sheet-offset, 0px) + 52px); inset-inline-end: 0; display: flex; }
    .appearance-switch { position: absolute; inset-block-start: calc(44px + 2 * var(--ms-space-2)); inset-inline-start: 0; }
    .camera-steps { position: absolute; inset-block-end: var(--map-sheet-offset, 0px); inset-inline-end: 0; }
    .map-root:has(.selection-chip) .camera-steps { inset-block-end: calc(var(--map-sheet-offset, 0px) + 4rem); }
    .map-root:has(.selection-chip) .map-extras { inset-block-end: calc(var(--map-sheet-offset, 0px) + 4rem + 52px); }
    .map-rail:has(.appearance-switch) { --help-top: calc(88px + 4 * var(--ms-space-2)); }
    .map-root:has(.selection-chip) .map-rail { --help-bottom: calc(116px + 4rem); }
    .navigation-help { position: absolute; inset-block-start: var(--help-top); inset-inline-end: 0; max-block-size: calc(100% - var(--help-top) - var(--help-bottom)); overflow: auto; box-sizing: border-box; }
    :host([narrow]) .map-context { max-inline-size: calc(100% - 52px); gap: var(--ms-space-1); }
    :host([narrow]) ::slotted(.floor-switcher) { inline-size: 7rem; }
    :host([narrow]) .fit { min-inline-size: 44px; padding-inline: var(--ms-space-2); }
    :host([narrow]) .fit .ms-btn__label { display: none; }

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
    .navigation-help dd { margin: 0; color: var(--ms-text-quiet); }

    .zone-overlay { position: absolute; inset: 0; z-index: 4; pointer-events: none; overflow: hidden; }
    .zone-overlay svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
    .zone-overlay path { stroke: var(--ms-accent); stroke-width: 2; fill-opacity: .08; }
    .zone-overlay path.invalid { stroke: var(--error-color, #b3261e); }
    .zone-point { position: absolute; translate: -50% -50%; width: 44px; height: 44px; border: 0; border-radius: 50%; background: transparent; color: var(--ms-accent); pointer-events: auto; touch-action: none; cursor: grab; font: 700 12px system-ui; isolation: isolate; }
    .zone-point::before { content: ""; position: absolute; inset: 10px; z-index: -1; border-radius: 50%; background: var(--ms-surface-card); border: 2px solid var(--ms-accent); box-shadow: 0 1px 4px #0008; }
    .zone-point[data-selected="true"] { color: var(--ms-on-accent); }
    .zone-point[data-selected="true"]::before { background: var(--ms-accent); border-color: var(--ms-surface-card); }
    .zone-point:focus-visible { outline: 3px solid var(--ms-accent); outline-offset: 0; }
    .zone-midpoint { font-size: 18px; }
    .zone-midpoint::before { inset: 13px; background: var(--ms-surface-card); }
    .zone-midpoint { color: var(--ms-accent); }
    .zone-help { position: absolute; inset: auto auto 88px 100px; max-width: min(380px, calc(100% - 112px)); padding: 8px 12px; border-radius: 12px; font-size: 12px; pointer-events: auto; }
    .zone-help span[role="status"] { display: block; color: var(--error-color, #b3261e); }
    .map-root[data-narrow="true"] .zone-help { bottom: 12px; left: 12px; max-width: calc(100% - 24px); }
    .keyboard-aim { display: none; position: absolute; z-index: 3; inset: 50% auto auto 50%; inline-size: 20px; block-size: 20px; translate: -50% -50%; border: 2px solid white; outline: 2px solid #111; border-radius: 50%; pointer-events: none; }
    .keyboard-aim::after { content: "+"; position: absolute; inset: 50% auto auto 50%; translate: -50% -50%; color: #111; font: bold 20px/1 sans-serif; text-shadow: 0 0 2px white; }
    .map-root:focus-visible .keyboard-aim { display: block; }
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
      color: var(--ms-text-quiet);
      font-size: 0.7rem;
      font-weight: 650;
    }

    .map-root[data-draw-tool="outline"] .map-scale { inset-block-end: auto; inset-block-start: 76px; }

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
    .map-message span { color: var(--ms-text-quiet); font-size: 0.82rem; }

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
  `]}#C;#H;#V;#e;#r;#L;#o;#i;#a;#A;#u;#M(H,V,e){return R(this.localize,H,V,e)}connectedCallback(){super.connectedCallback(),this.#l()}firstUpdated(){let H=this.renderRoot.querySelector(".map-root"),V=this.renderRoot.querySelector(".scene-canvas"),e=this.renderRoot.querySelector(".overlay-canvas");!H||!V||!e||(this.#H=new p2(V,e,{onViewport:()=>{this.#u.cancel(),this.requestUpdate()},onCamera:(r,t,M)=>{this.#s({type:"set-camera",view:this.state.workflow==="draw"?"top":this.state.view,camera:{yaw:r.yaw,pitch:r.pitch,zoom:t/100,targetX:r.targetX,targetZ:r.targetZ}}),this.state.workflow==="draw"&&t!==this.state.draw.zoomPercent&&this.#s({type:"set-zoom",value:t,...M?{originX:M.xPercent,originY:M.yPercent}:{}})},onRoom:r=>this.#s({type:"toggle-room",roomId:r}),onProblem:()=>this.#S("renderer-problem")}),this.#V=new l2(H,this.#H,{state:()=>this.state,onOutlinePoint:r=>this.#u.addPoint(r),onCircles:(r,t,M,o)=>this.#s({type:"set-draft-circles",circles:r,record:t,...M?{previous:M,previousOutline:o??null}:{},...!t&&M?{outline:o??null}:{}}),onRoom:r=>this.#s({type:"toggle-room",roomId:r})}),this.#H.setState(this.state),this.#h())}disconnectedCallback(){this.#p(),this.#u.cancel(),this.#V?.dispose(),this.#V=null,this.#H?.dispose(),this.#H=null,super.disconnectedCallback()}updated(H){this.#r&&(this.#r=!1,this.renderRoot.querySelector(".navigation-help button")?.focus()),H.has("state")&&(this.#H?.setState(this.state),this.state.draw.tool==="outline"&&this.requestUpdate())}#y(){let H=this.renderRoot?.querySelector(".map-root");!H||!this.#H||this.#H.setPalette(A0(H))}#h(){this.#n(),this.#i=window.requestAnimationFrame(()=>{this.#i=null,this.#a=window.setTimeout(()=>{this.#a=null,this.#y()},0)})}#n(){this.#i!==null&&window.cancelAnimationFrame(this.#i),this.#a!==null&&window.clearTimeout(this.#a),this.#i=null,this.#a=null}#v;#l(){if(!(typeof document>"u"||this.#L)&&(this.#L=new MutationObserver(this.#v),this.#L.observe(document.documentElement,{attributes:!0,attributeFilter:["style","class"]}),typeof window.matchMedia=="function")){this.#o=[window.matchMedia("(prefers-color-scheme: dark)"),window.matchMedia("(forced-colors: active)")];for(let H of this.#o)H.addEventListener("change",this.#v)}}#p(){this.#n(),this.#L?.disconnect(),this.#L=null;for(let H of this.#o)H.removeEventListener("change",this.#v);this.#o=[]}#s(H){this.dispatchEvent(new CustomEvent(e1,{detail:H,bubbles:!0,composed:!0}))}#S(H){this.dispatchEvent(new CustomEvent(m2,{detail:{id:H},bubbles:!0,composed:!0}))}#t(H){this.#C=H.currentTarget,this.#e=!this.#e,this.#r=this.#e,this.requestUpdate()}#x(){if(!this.#e)return;this.#e=!1,this.requestUpdate();let H=this.#C;H?.isConnected&&H.focus()}#f(){for(let H of this.state.selection.roomIds)this.#s({type:"toggle-room",roomId:H})}#d(H,V){this.#H?.orbitBy(H,V)}#m(H){if(!A2(H)&&!(H.ctrlKey||H.metaKey||H.altKey)&&H.key==="Escape"){if(H.preventDefault(),this.#e){this.#x();return}this.#s({type:"dismiss-top-layer"});return}}rendererDiagnostics(){return this.#H?.diagnostics()??null}canvasIdentity(){return{scene:this.renderRoot.querySelector(".scene-canvas"),overlay:this.renderRoot.querySelector(".overlay-canvas")}}#c(){return this.state.host.connected?this.state.host.administrator?this.state.host.robotCount===0?{title:this.#M("v4_no_robot","No Matic robot set up"),detail:this.#M("v4_no_robot_detail","Set up a robot before opening its map.")}:this.state.dataMode==="history"?!this.state.map.available&&this.state.resources.scene.status==="loading"?{title:this.#M("v4_loading_saved_map","Loading saved map"),detail:this.#M("v4_loading_saved_map_detail","This read-only snapshot is still preparing.")}:this.state.map.available?null:{title:this.#M("v4_saved_map_unavailable","Saved map unavailable"),detail:this.#M("v4_saved_map_unavailable_detail","Choose another snapshot or return to the live map.")}:this.state.host.robotConnected?this.state.coherence==="verifying"||this.state.coherence==="booting"?{title:this.#M("v4_locating_map","Locating the current map"),detail:this.#M("v4_locating_map_detail","Map controls will return after the floor is verified.")}:!this.state.map.available&&this.state.resources.scene.status==="loading"?{title:this.#M("v4_loading_verified_map","Loading the verified map"),detail:this.#M("v4_loading_verified_map_detail","The current floor is verified. The private scene is still preparing.")}:this.state.map.available?this.state.activity==="problem"?{title:this.#M("v4_robot_attention","Robot needs attention"),detail:this.#M("v4_robot_attention_detail","Check the robot before starting another task.")}:null:{title:this.#M("v4_map_unavailable","Map unavailable"),detail:this.#M("v4_map_unavailable_detail","The private scene is not ready. No map data is shown until it is verified.")}:{title:this.#M("v4_robot_offline","Robot offline"),detail:this.#M("v4_robot_offline_detail","The last verified map stays read only and has no live position.")}:{title:this.#M("v4_admin_required","Administrator access required"),detail:this.#M("v4_private_map_hidden","Private map data is hidden.")}:{title:this.#M("v4_reconnecting","Reconnecting"),detail:this.#M("v4_reconnecting_detail","The verified map is read only until Home Assistant reconnects.")}}#Z(H,V){let e=this.state,r=this.narrow,t=e.workflow==="draw",M=this.#M("v4_how_to_move","How to move the map"),o=H&&!t,i=o&&!r&&e.view==="top",a=o&&e.view==="three",n=!V,l=!r&&!t;return p`
      <div class="map-rail" data-map-control>
        <div class="map-context"><slot name="floor"></slot>
        ${o?p`
          <div class="view-switch ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#M("map_view_label","Map view")}>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(e.view==="three")}
              @click=${()=>this.#s({type:"set-view",view:"three"})}
            >${this.#M("map_view_3d","3D")}</button>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(e.view==="top")}
              @click=${()=>this.#s({type:"set-view",view:"top"})}
            >${this.#M("map_view_top","2D")}</button>
          </div>
        `:s}

        </div>
        ${i?p`
          <div class="appearance-switch ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#M("map_style_label","Map style")}>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(e.appearance==="photo")}
              @click=${()=>this.#s({type:"set-appearance",appearance:"photo"})}
            >${this.#M("map_style_photo","Photo")}</button>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(e.appearance==="rooms")}
              @click=${()=>this.#s({type:"set-appearance",appearance:"rooms"})}
            >${this.#M("map_style_room_colours","Floor plan")}</button>
          </div>
        `:s}

        ${a?p`
          <div class="camera-steps ms-surface ms-surface--floating ms-segment" role="toolbar" aria-orientation="horizontal" aria-label=${this.#M("map_camera_controls","Map camera controls")}>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#M("map_rotate_left","Rotate left")} aria-keyshortcuts="[" @click=${()=>this.#d(-52,0)}>${Z(K3)}</button>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#M("map_tilt_down","Lower viewing angle")} aria-keyshortcuts="PageDown" @click=${()=>this.#d(0,30)}>${Z(z3)}</button>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#M("map_tilt_up","Raise viewing angle")} aria-keyshortcuts="PageUp" @click=${()=>this.#d(0,-30)}>${Z(W3)}</button>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#M("map_rotate_right","Rotate right")} aria-keyshortcuts="]" @click=${()=>this.#d(52,0)}>${Z(Q3)}</button>
          </div>
        `:s}

        ${n?p`
          <div class="map-tools ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#M("v4_map_tools","Map tools")}>
            ${V?s:p`
              <button
                class="fit ms-btn"
                type="button"
                aria-label=${this.#M("v4_fit_map_hint","Fit the whole map on screen")}
                @click=${()=>{this.#H?.fit(),this.#s({type:"fit-map"})}}
                title=${this.#M("v4_fit_map","Fit map")}
              >${Z(N3)}<span class="ms-btn__label">${this.#M("v4_fit_map","Fit map")}</span></button>
            `}
          </div>
        `:s}
        ${!V&&l?p`
          <div class="map-extras ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#M("v4_map_display","Map display")}>
              <button
                class="labels ms-btn"
                type="button"
                aria-pressed=${String(e.labelsVisible)}
                @click=${()=>this.#s({type:"toggle-labels"})}
                title=${this.#M("v4_room_names","Room names")}
              >${Z(U3)}<span class="ms-btn__label">${this.#M("v4_room_names","Room names")}</span></button>
              <button
                class="help ms-btn ms-btn--icon"
                type="button"
                aria-label=${M}
                aria-expanded=${String(this.#e)}
                aria-controls=${m0}
                @click=${this.#t}
                title=${M}
              >${Z(G3)}</button>
          </div>
        `:s}

        ${this.#e&&H&&l?p`
          <div
            id=${m0}
            class="navigation-help ms-surface ms-surface--floating"
            role="dialog"
            aria-modal="false"
            aria-label=${M}
          >
            <header>
              <h3>${M}</h3>
              <button class="ms-btn ms-btn--sm" type="button" @click=${()=>this.#x()}>${this.#M("v4_close","Close")}</button>
            </header>
            <dl>
              <dt>${this.#M("v4_trackpad","Trackpad")}</dt>
              <dd>${this.#M("v4_trackpad_help","Scroll to pan \xB7 pinch to zoom \xB7 twist to rotate")}</dd>
              <dt>${this.#M("v4_mouse","Mouse")}</dt>
              <dd>${this.#M("v4_mouse_help","Drag to orbit \xB7 Shift, middle, or right drag to pan \xB7 wheel to zoom")}</dd>
              <dt>${this.#M("v4_keyboard","Keyboard")}</dt>
              <dd>${this.#M("v4_keyboard_help","WASD to move \xB7 Q/E or arrows to orbit \xB7 +/\u2212 to zoom \xB7 0 to fit")}</dd>
            </dl>
          </div>
        `:s}
      </div>
    `}#w(H){let V=this.state;if(!H)return s;if(V.workflow==="draw"&&!this.narrow)return p`
        <div class="map-dock ms-surface ms-surface--floating" data-map-control>
          ${n2(V,{intent:r=>this.#s(r),openBrush:()=>this.#s({type:"set-precision-open",value:!V.precisionOpen}),t:(r,t)=>this.#M(r,t)},"row")}
        </div>
      `;let e=V.selection.roomIds.length;return V.workflow==="rooms"&&e>0&&!this.narrow?p`
        <div class="map-dock ms-surface ms-surface--floating" data-map-control>
          <div class="selection-chip ms-surface ms-surface--floating" data-map-control>
            <span>${this.#M("v4_rooms_selected","Rooms selected: {count}").replace("{count}",String(e))}</span>
            <button class="ms-btn ms-btn--sm" type="button" @click=${()=>this.#f()}>${this.#M("v4_clear","Clear")}</button>
          </div>
        </div>
      `:s}render(){let H=this.state,V=P5(H),e=this.#c(),r=H.map.available&&(S1(H)||H.dataMode==="history"),t=H.workflow==="draw"&&r,M=H.coherence==="verifying"||H.coherence==="booting";return p`
      <section
        class="map-root"
        tabindex="0"
        aria-label=${this.#M("map_viewport_aria","Interactive Matic 3D map")}
        aria-describedby=${t?H.draw.tool==="outline"?"zone-keyboard-help":"keyboard-draw-help":s}
        data-full-map=${String(H.fullMap)}
        data-workflow=${H.workflow}
        data-draw-tool=${H.draw.tool}
        data-narrow=${this.narrow?"true":s}
        @keydown=${this.#m}
        @pointerdown=${this.#A}
      >
        ${this.#Z(r,M)}
        <slot name="scrim"></slot>

        <div
          class="scene-window"
          data-renderer-key="persistent-canvas-v4"
          ?hidden=${!r}
          role=${t?"group":"img"}
          aria-label=${c0(H,this.localize)}
        >
          ${t?p`<span class="keyboard-aim" aria-hidden="true"></span>`:s}
          <canvas class="scene-canvas"></canvas>
          <canvas class="overlay-canvas"></canvas>
          ${t?this.#u.render():s}
        </div>

        ${t?p`
          <p id="zone-keyboard-help" class="sr-only">${this.#M("v4_zone_keyboard_help","Focus the map, aim with arrow keys, and press Enter to place points. Select the first point to close. Tab to a point; arrows move it, Delete removes it, and Escape cancels a drag.")}</p>
          <p id="keyboard-draw-help" class="sr-only">${this.#M("v4_keyboard_draw_help","Keyboard: focus the map, use arrow keys to aim, then Enter to paint or erase at the crosshair. D selects Paint; E selects Erase.")}</p>
          <div class="map-scale" aria-label=${`Scale ${V.label}`}>
            <span class="scale-line" style=${`--scale-width:${V.pixels}px`}></span>
            <span>${V.label}</span>
          </div>
        `:s}

        ${this.#w(r)}

        ${e&&!(H.fullMap&&(M||!H.host.administrator))?p`
          <div class="map-message ms-surface ms-surface--floating" role="status">
            <strong>${e.title}</strong>
            <span>${e.detail}</span>
          </div>
        `:s}
        <div class="sr-only" aria-live="polite" aria-atomic="true">
          ${c0(H,this.localize)}
        </div>
      </section>
    `}};customElements.get(A1)||customElements.define(A1,i5);var a5=class extends k{constructor(){super(...arguments);this.state=y();this.compact=!1;this.inline=!1}static{this.properties={state:{attribute:!1},localize:{attribute:!1},compact:{type:Boolean,reflect:!0},inline:{type:Boolean,reflect:!0}}}static{this.styles=[$,I,V1,w`
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
`]}#C(H,V){return R(this.localize,H,V)}#H(H){this.dispatchEvent(new CustomEvent(e1,{detail:H,bubbles:!0,composed:!0}))}#V(H){let V=H.currentTarget.valueAsNumber;Number.isFinite(V)&&this.#H({type:"set-brush",value:V})}render(){let{draw:H}=this.state;return p`
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
    `}};customElements.get(W1)||customElements.define(W1,a5);var v0={ATTRIBUTE:1,CHILD:2,PROPERTY:3,BOOLEAN_ATTRIBUTE:4,EVENT:5,ELEMENT:6},u0=L=>(...C)=>({_$litDirective$:L,values:C}),c2=class{constructor(C){}get _$AU(){return this._$AM._$AU}_$AT(C,H,V){this._$Ct=C,this._$AM=H,this._$Ci=V}_$AS(C,H){return this.update(C,H)}update(C,H){return this.render(...H)}};var{I:Q7}=L3,x0=L=>L;var h0=()=>document.createComment(""),w1=(L,C,H)=>{let V=L._$AA.parentNode,e=C===void 0?L._$AB:C._$AA;if(H===void 0){let r=V.insertBefore(h0(),e),t=V.insertBefore(h0(),e);H=new Q7(r,t,L,L.options)}else{let r=H._$AB.nextSibling,t=H._$AM,M=t!==L;if(M){let o;H._$AQ?.(L),H._$AM=L,H._$AP!==void 0&&(o=L._$AU)!==t._$AU&&H._$AP(o)}if(r!==e||M){let o=H._$AA;for(;o!==r;){let i=x0(o).nextSibling;x0(V).insertBefore(o,e),o=i}}}return H},r1=(L,C,H=L)=>(L._$AI(C,H),L),q7={},Z0=(L,C=q7)=>L._$AH=C,S0=L=>L._$AH,v2=L=>{L._$AR(),L._$AA.remove()};var f0=(L,C,H)=>{let V=new Map;for(let e=C;e<=H;e++)V.set(L[e],e);return V},g0=u0(class extends c2{constructor(L){if(super(L),L.type!==v0.CHILD)throw Error("repeat() can only be used in text expressions")}dt(L,C,H){let V;H===void 0?H=C:C!==void 0&&(V=C);let e=[],r=[],t=0;for(let M of L)e[t]=V?V(M,t):t,r[t]=H(M,t),t++;return{values:r,keys:e}}render(L,C,H){return this.dt(L,C,H).values}update(L,[C,H,V]){let e=S0(L),{values:r,keys:t}=this.dt(C,H,V);if(!Array.isArray(e))return this.ut=t,r;let M=this.ut??=[],o=[],i,a,n=0,l=e.length-1,A=0,d=r.length-1;for(;n<=l&&A<=d;)if(e[n]===null)n++;else if(e[l]===null)l--;else if(M[n]===t[A])o[A]=r1(e[n],r[A]),n++,A++;else if(M[l]===t[d])o[d]=r1(e[l],r[d]),l--,d--;else if(M[n]===t[d])o[d]=r1(e[n],r[d]),w1(L,o[d+1],e[n]),n++,d--;else if(M[l]===t[A])o[A]=r1(e[l],r[A]),w1(L,e[n],e[l]),l--,A++;else if(i===void 0&&(i=f0(t,A,d),a=f0(M,n,l)),i.has(M[n]))if(i.has(M[l])){let m=a.get(t[A]),u=m!==void 0?e[m]:null;if(u===null){let h=w1(L,e[n]);r1(h,r[A]),o[A]=h}else o[A]=r1(u,r[A]),w1(L,e[n],u),e[m]=null;A++}else v2(e[l]),l--;else v2(e[n]),n++;for(;A<=d;){let m=w1(L,o[d+1]);r1(m,r[A]),o[A++]=m}for(;n<=l;){let m=e[n++];m!==null&&v2(m)}return this.ut=t,Z0(L,o),Y}});var n5=["vacuum","mop","vacuum_and_mop"],l5=["quick","standard","heavy_duty"],W=L=>L.currentTarget.value,y0=L=>L.currentTarget.checked,A5=class extends k{constructor(){super(...arguments);this.state=y();this._copyStatus="idle"}static{this.properties={state:{attribute:!1},localize:{attribute:!1},_copyStatus:{state:!0}}}static{this.styles=[$,I,V1,w`
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
`]}#C;disconnectedCallback(){this.#C!==void 0&&clearTimeout(this.#C),this.#C=void 0,super.disconnectedCallback()}#H(H,V,e){return R(this.localize,H,V,e)}#V(H){return H==="vacuum"?this.#H("vacuum","Vacuum"):H==="mop"?this.#H("mop","Mop"):this.#H("vacuum_and_mop","Vacuum + mop")}#e(H){return H==="quick"?this.#H("quick","Quick"):H==="standard"?this.#H("standard","Optimal"):this.#H("heavy_duty","Heavy Duty")}#r(H){this.dispatchEvent(new CustomEvent(e1,{detail:H,bubbles:!0,composed:!0}))}#L(){return this.state.notice?p`
      <div class="notice" data-tone=${this.state.notice.tone} role=${this.state.notice.tone==="error"?"alert":"status"}>
        ${this.state.notice.text}
      </div>
    `:s}#o(){switch(this.state.workflow){case"rooms":case"plan":return{loading:this.#H("v4_loading_rooms_plans","Loading rooms and plans\u2026"),unavailable:this.#H("v4_rooms_plans_unavailable","Rooms and plans are unavailable right now."),empty:this.#H("v4_no_rooms_plans","No rooms or plans are available yet.")};case"draw":case"areaReview":return{loading:this.#H("v4_loading_areas","Loading saved areas\u2026"),unavailable:this.#H("v4_areas_unavailable","Saved areas are unavailable right now."),empty:this.#H("v4_no_saved_areas","No saved areas yet. Draw one on the map.")};case"history":return{loading:this.#H("v4_loading_history","Loading map history\u2026"),unavailable:this.#H("v4_history_unavailable","Map history is unavailable right now."),empty:this.#H("v4_no_map_history","No saved map snapshots yet.")};default:return{loading:this.#H("map_loading","Loading\u2026"),unavailable:this.#H("v4_workspace_unavailable","This workspace is unavailable right now."),empty:this.#H("v4_nothing_saved","Nothing saved yet.")}}}#i(H,V,e){let r=this.#o();if(H==="loading"||H==="idle")return p`<div class="loading" role="status">${r.loading}</div>`;if(H==="error"){let t=this.state.workflow;return p`
        <div class="stack">
          <div class="problem" role="alert">${r.unavailable} ${V==="request-failed"?this.#H("v4_try_again","Try again shortly."):this.#H("v4_return_live_retry","Return to the live map and retry.")}</div>
          <div class="toolbar">
            <button class="ms-btn ms-btn--secondary" type="button" @click=${()=>this.#r({type:"open-workflow",workflow:t})}>${this.#H("v4_retry","Try again")}</button>
          </div>
        </div>
      `}return H==="empty"?p`<div class="empty">${r.empty}</div>`:e}#a(){let H=this.state.resources.plans;return this.#i(H.status,H.problem,p`
      <div class="stack">
        <h3 class="group-heading" id="rooms-heading">${this.#H("v4_rooms_to_clean","Rooms to clean")}</h3>
        <div class="list" role="group" aria-labelledby="rooms-heading">
          ${(H.value?.rooms||[]).map(V=>{let e=this.state.selection.roomIds.includes(V.roomId);return p`
              <div class="room ms-row ms-row--stack" data-selected=${String(e)}>
                <label class="room-choice">
                  <input
                    type="checkbox"
                    .checked=${e}
                    @change=${()=>this.#r({type:"toggle-room",roomId:V.roomId})}
                  >
                  <strong>${V.name}</strong>
                  ${e?p`<small>${this.#H("v4_room_ready","Ready")}</small>`:s}
                </label>
                ${e?this.#A(V.roomId,this.state.selection.roomSettings.find(r=>r.roomId===V.roomId)||{roomId:V.roomId,cleaningMode:"vacuum",coverageSetting:"standard"}):s}
              </div>
            `})}
        </div>
        <p class="subtle">${this.#H("v4_room_selection_hint","Select rooms here or directly on the map. The map and list stay in sync.")}</p>
        ${this.#L()}
      </div>
    `)}#A(H,V){let e=this.state.resources.plans.value?.rooms.find(r=>r.roomId===H)?.name||this.#H("v4_room","Room");return p`
      <div class="split room-settings">
        <label class="field ms-field">${this.#H("v4_cleaning_system","Cleaning system")}
          <select
            aria-label=${this.#H("v4_room_cleaning_system_named","Cleaning system for {room}",{room:e})}
            .value=${V.cleaningMode}
            @change=${r=>this.#r({type:"patch-room-settings",roomId:H,cleaningMode:W(r)})}
          >${n5.map(r=>p`<option value=${r} ?selected=${r===V.cleaningMode}>${this.#V(r)}</option>`)}</select>
        </label>
        <label class="field ms-field">${this.#H("cleaning_mode","Cleaning mode")}
          <select
            aria-label=${this.#H("v4_room_cleaning_mode_named","Cleaning mode for {room}",{room:e})}
            .value=${V.coverageSetting}
            @change=${r=>this.#r({type:"patch-room-settings",roomId:H,coverageSetting:W(r)})}
          >${l5.map(r=>p`<option value=${r} ?selected=${r===V.coverageSetting}>${this.#e(r)}</option>`)}</select>
        </label>
      </div>
    `}#u(H){let V=this.state.planDraft.rooms,r=V.find(t=>t.roomId===H)?V.filter(t=>t.roomId!==H):[...V,{roomId:H,cleaningMode:"vacuum",coverageSetting:"standard"}];this.#r({type:"patch-plan-draft",patch:{rooms:r}})}#M(H,V){let e=this.state.planDraft.rooms.map((r,t)=>t===H?{...r,...V}:r);this.#r({type:"patch-plan-draft",patch:{rooms:e}})}#y(H,V){let e=H+V,r=[...this.state.planDraft.rooms];if(e<0||e>=r.length)return;let[t]=r.splice(H,1);t&&(r.splice(e,0,t),this.#r({type:"patch-plan-draft",patch:{rooms:r}}))}#h(){let H=this.state.resources.plans,V=H.value,e=this.state.planDraft,r=e.rooms.map(i=>({room:i,label:V?.rooms.find(a=>a.roomId===i.roomId)?.name||"Room",selected:!0})),t=(V?.rooms||[]).filter(i=>!e.rooms.some(a=>a.roomId===i.roomId)).map(i=>({room:{roomId:i.roomId,cleaningMode:"vacuum",coverageSetting:"standard"},label:i.name,selected:!1})),M=[...r,...t],o=new Set(e.rooms.map(i=>`${i.cleaningMode}:${i.coverageSetting}`)).size>1;return this.#i(H.status,H.problem,p`
      <div class="stack">
        <div class="split">
          <label class="field ms-field">${this.#H("v4_saved_plan","Saved plan")}
            <select
              name="saved-plan"
              .value=${this.state.selection.planId||""}
              @change=${i=>this.#r({type:"select-plan",planId:W(i)||null})}
            >
              <option value="" ?selected=${!this.state.selection.planId}>${this.#H("plan_new","New plan")}</option>
              ${(V?.plans||[]).map(i=>p`<option value=${i.id} ?selected=${i.id===this.state.selection.planId}>${i.enabled?i.name:`${i.name} \xB7 ${this.#H("v4_paused","paused")}`}</option>`)}
            </select>
          </label>
          <button class="ms-btn ms-btn--secondary" type="button" @click=${()=>this.#r({type:"select-plan",planId:null})}>${Z(H0)}<span class="ms-btn__label">${this.#H("plan_new","New plan")}</span></button>
        </div>
        <label class="field ms-field">${this.#H("plan_name","Plan name")}
          <input
            maxlength="128"
            autocomplete="off"
            .value=${e.name}
            @input=${i=>this.#r({type:"patch-plan-draft",patch:{name:W(i)}})}
          >
        </label>
        <div class="split plan-meta">
          <label class="field ms-field">${this.#H("plan_run_behavior","Cleaning order")}
            <select
              .value=${e.runBehavior}
              @change=${i=>this.#r({type:"patch-plan-draft",patch:{runBehavior:W(i)==="ordered"?"ordered":"intelligent"}})}
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
        ${o?p`
          <p class="subtle plan-transition-hint">${this.#H("v4_plan_mixed_settings","Rooms with different cleaning settings may need separate missions and dock visits.")}
            ${e.runBehavior==="ordered"?this.#H("v4_plan_group_settings","Placing rooms with matching settings together can reduce transitions."):this.#H("v4_plan_rotation_settings","Intelligent rotation determines the room order.")}
          </p>
        `:s}
        <div class="list" role="group" aria-labelledby="plan-rooms-heading">
          ${g0(M,({room:i})=>i.roomId,({room:i,label:a,selected:n})=>{let l=n?e.rooms.findIndex(A=>A.roomId===i.roomId):-1;return p`
              <div class="room plan-room ms-row ms-row--stack" data-selected=${String(n)}>
                <div class="room-choice">
                  <label class="plan-room-label">
                  <input type="checkbox" .checked=${n} @change=${()=>this.#u(i.roomId)}>
                  <strong>${n?`${l+1}. `:""}${a}</strong>
                  </label>
                  ${n?p`
                    <span>
                      <button class="icon-button ms-btn ms-btn--icon" type="button" aria-label=${this.#H("move_room_up","Move {room} earlier",{room:a})} ?disabled=${l===0} @click=${A=>{A.preventDefault(),this.#y(l,-1)}}>${Z(V0)}</button>
                      <button class="icon-button ms-btn ms-btn--icon" type="button" aria-label=${this.#H("move_room_down","Move {room} later",{room:a})} ?disabled=${l===e.rooms.length-1} @click=${A=>{A.preventDefault(),this.#y(l,1)}}>${Z(L0)}</button>
                    </span>
                  `:s}
                </div>
                ${n?p`
                  <div class="split room-settings">
                    <label class="field ms-field">${this.#H("v4_cleaning_system","Cleaning system")}
                      <select aria-label=${this.#H("v4_room_cleaning_system_named","Cleaning system for {room}",{room:a})} .value=${i.cleaningMode} @change=${A=>this.#M(l,{cleaningMode:W(A)})}>${n5.map(A=>p`<option value=${A} ?selected=${A===i.cleaningMode}>${this.#V(A)}</option>`)}</select>
                    </label>
                    <label class="field ms-field">${this.#H("cleaning_mode","Cleaning mode")}
                      <select aria-label=${this.#H("v4_room_cleaning_mode_named","Cleaning mode for {room}",{room:a})} .value=${i.coverageSetting} @change=${A=>this.#M(l,{coverageSetting:W(A)})}>${l5.map(A=>p`<option value=${A} ?selected=${A===i.coverageSetting}>${this.#e(A)}</option>`)}</select>
                    </label>
                  </div>
                `:s}
              </div>
            `})}
        </div>
        <h3 class="group-heading" id="completion-heading">${this.#H("v4_completion_options","When a run ends")}</h3>
        <div class="plan-options" role="group" aria-labelledby="completion-heading">
          <label class="plan-option">
            <input type="checkbox" .checked=${e.returnToBase} @change=${i=>this.#r({type:"patch-plan-draft",patch:{returnToBase:y0(i)}})}>
            <span class="plan-option-copy">
              <strong>${this.#H("plan_return_to_base","Return to the dock when finished")}</strong>
              <small>${this.#H("plan_return_to_base_hint","After the last selected room, the robot returns to the dock.")}</small>
            </span>
          </label>
          <label class="plan-option">
            <input type="checkbox" .checked=${e.finishCurrentRoom} @change=${i=>this.#r({type:"patch-plan-draft",patch:{finishCurrentRoom:y0(i)}})}>
            <span class="plan-option-copy">
              <strong>${this.#H("plan_finish_room","Finish the current room after Stop")}</strong>
              <small>${this.#H("plan_finish_room_hint","When enough of the room is complete, finish it before docking. Never start another room.")}</small>
            </span>
          </label>
          ${e.finishCurrentRoom?p`
            <label class="plan-threshold ms-field">
              <span class="plan-threshold-copy">
                <strong>${this.#H("plan_threshold","Minimum room progress")}</strong>
                <small>${this.#H("plan_threshold_hint","When Stop is requested, the robot checks this progress: below it stops now; at or above it finishes this room before docking.")}</small>
              </span>
              <span class="threshold-value">${e.finishCurrentRoomThreshold}%</span>
              <input type="range" min="0" max="100" step="5" .value=${String(e.finishCurrentRoomThreshold)} aria-label=${this.#H("plan_threshold","Minimum room progress")} @input=${i=>this.#r({type:"patch-plan-draft",patch:{finishCurrentRoomThreshold:Number(W(i))}})}>
            </label>
          `:s}
        </div>
        <div class="toolbar">
          ${e.id?p`
            <button
              class="danger ms-btn ms-btn--secondary ms-btn--danger"
              type="button"
              aria-label=${this.#H("plan_delete","Delete plan")}
              data-dialog-launcher="confirmDeletePlan"
              @click=${()=>this.#r({type:"open-dialog",dialog:"confirmDeletePlan"})}
            >${this.#H("plan_delete","Delete")}</button>
          `:s}
        </div>
        ${this.#L()}
      </div>
    `)}#n(){let H=this.state.resources.areas;return p`
      <div class="stack">
        <p class="subtle">${this.state.draw.tool==="outline"?this.#H("v4_zone_coverage","Place points around the zone. Shading shows cleaning coverage inside the perimeter; narrow edges may remain uncovered."):this.#H("v4_draw_floor_hint","Paint only on the mapped floor. Zoom and pan never change the saved outline.")}</p>
        ${this.state.draw.tool!=="outline"?p`<p class="subtle">${this.#H("v4_keyboard_draw_help","Keyboard: focus the map, use arrow keys to aim, then Enter to paint or erase at the crosshair. D selects Paint; E selects Erase.")}</p>`:s}
        ${this.#i(H.status,H.problem,p`
          <div class="group">
            <h3 class="group-heading" id="areas-heading">${this.#H("area_workspace_title","Saved custom areas")}</h3>
            <div class="list" role="group" aria-labelledby="areas-heading">
            <button class="list-button ms-row ms-row" type="button" @click=${()=>this.#r({type:"select-area",areaId:null})}>\uff0b ${this.#H("area_new","New outline")}</button>
            ${(H.value?.areas||[]).map(V=>p`
              <button class="list-button ms-row ms-row" type="button" @click=${()=>{this.#r({type:"select-area",areaId:V.id,workflow:"areaReview"})}}>
                <span>${V.name}</span>
                <small>${V.status==="current"?this.#H("area_workspace_ready","Ready"):this.#H("v4_review","Review")}</small>
              </button>
            `)}
            </div>
          </div>
        `)}
      </div>
    `}#v(){let H=this.state.areaDraft,V=H.canRebind||H.status==="review",e=!V&&(H.status==="stale"||H.status==="unknown");return p`
      <div class="stack">
        ${V?p`<div class="notice" data-tone="warning" role="status">${this.#H("area_review_required","Review the saved outline on this current map, then confirm it.")}</div>`:s}
        ${e?p`<div class="problem" role="alert">${this.#H("area_redraw_required","This outline no longer matches the current room map. Redraw it before saving.")}</div>`:s}
        <label class="field ms-field">${this.#H("area_name","Area name")}
          <input maxlength="128" autocomplete="off" .value=${H.name} @input=${r=>this.#r({type:"patch-area-draft",patch:{name:W(r)}})}>
        </label>
        <div class="split">
          <label class="field ms-field">${this.#H("v4_cleaning_system","Cleaning system")}
            <select .value=${H.cleaningMode} @change=${r=>this.#r({type:"patch-area-draft",patch:{cleaningMode:W(r)}})}>${n5.map(r=>p`<option value=${r} ?selected=${r===H.cleaningMode}>${this.#V(r)}</option>`)}</select>
          </label>
          <label class="field ms-field">${this.#H("cleaning_mode","Cleaning mode")}
            <select .value=${H.coverageSetting} @change=${r=>this.#r({type:"patch-area-draft",patch:{coverageSetting:W(r)}})}>${l5.map(r=>p`<option value=${r} ?selected=${r===H.coverageSetting}>${this.#e(r)}</option>`)}</select>
          </label>
        </div>
        <p class="subtle">${this.#H("v4_private_marks","{count} map-space marks. The outline stays private and floor-bound.",{count:this.state.draw.circles.length})}</p>
        <div class="toolbar">
          <button class="ms-btn ms-btn--secondary" type="button" @click=${()=>this.#r({type:"open-workflow",workflow:"draw"})}>${this.#H("v4_edit_outline","Edit outline")}</button>
          ${H.id?p`
            <button
              class="danger ms-btn ms-btn--secondary ms-btn--danger"
              type="button"
              aria-label=${this.#H("area_delete","Delete area")}
              data-dialog-launcher="confirmDeleteArea"
              @click=${()=>this.#r({type:"open-dialog",dialog:"confirmDeleteArea"})}
            >${this.#H("area_delete","Delete")}</button>
          `:s}
        </div>
        ${this.#L()}
      </div>
    `}#l(){let H=this.state.resources.history,V=H.value,e=V?.floors.find(i=>i.id===this.state.selection.floorId)||V?.floors.find(i=>i.active)||V?.floors[0],r=e?.snapshots||[],t=this.state.selection.historyId?Math.max(0,r.findIndex(i=>i.id===this.state.selection.historyId)):r.length,M=e?.active?this.#H("map_timeline_live_action","Live"):this.#H("v4_return_current_floor","Return to current floor"),o=r[t];return this.#i(H.status,H.problem,p`
      <div class="stack">
        ${(V?.floors.length||0)>1?p`
          <div class="group">
            <h3 class="group-heading" id="floors-heading">${this.#H("v4_mapped_floors","Mapped floors")}</h3>
            <div class="list" role="group" aria-labelledby="floors-heading">
            ${(V?.floors||[]).map((i,a)=>p`
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
        `:s}
        <div class="timeline">
          <label class="field ms-field">${this.#H("map_timeline_label","Map timeline")}
            <input
              type="range"
              min="0"
              max=${String(r.length)}
              step="1"
              .value=${String(t)}
              aria-valuetext=${o?this.#p(o.createdAt):M}
              ?disabled=${!r.length}
              @input=${i=>{let a=Number(W(i));this.#r({type:"set-history",historyId:a===r.length?null:r[a]?.id||null})}}
            >
          </label>
          <div class="list">
            <button class="snapshot ms-row ms-row" type="button" aria-current=${String(!this.state.selection.historyId&&!!e?.active)} @click=${()=>this.#r({type:"set-history",historyId:null})}><span>${M}</span><small>${this.#H("v4_current","Current")}</small></button>
            ${r.map((i,a)=>p`
              <button class="snapshot ms-row ms-row" type="button" aria-current=${String(i.id===this.state.selection.historyId)} @click=${()=>this.#r({type:"set-history",historyId:i.id})}>
                <span>${this.#p(i.createdAt)}</span><small>${a+1} of ${r.length}</small>
              </button>
            `)}
          </div>
        </div>
        <p class="subtle">${this.#H("v4_history_privacy","Saved maps are floor-scoped and never show a live robot position.")}</p>
      </div>
    `)}#p(H){try{return new Intl.DateTimeFormat(this.state.locale,{dateStyle:"medium",timeStyle:"short"}).format(new Date(H))}catch{return this.#H("v4_saved_map","Saved map")}}#s(){let H=this.state.resources.entry,V=this.#H("v4_yes","Yes"),e=this.#H("v4_no","No"),r=this.#H("v4_seen","Seen"),t=this.#H("v4_not_seen","Not seen"),M=this.#H("v4_unknown","Unknown");return[[this.#H("v4_connection","Connection"),this.state.host.connected?this.#H("v4_connected","Connected"):this.#H("v4_offline","Offline")],[this.#H("v4_map_state","Map state"),String(this.state.coherence)],[this.#H("v4_floor_verified","Floor verified"),this.state.map.floorCoherent?V:e],[this.#H("v4_session_verified","Session verified"),this.state.map.sessionVerified?V:e],[this.#H("v4_map_complete","Map complete"),this.state.map.complete?V:e],[this.#H("v4_map_health","Map health"),H?.health||M],[this.#H("v4_blocked_by","Blocked by"),H?.mapBlockReason?.replaceAll("_"," ")||this.#H("v4_nothing","Nothing")],[this.#H("v4_startup_map","Startup map check"),H?.bootstrapState?.replaceAll("_"," ")||M],[this.#H("v4_startup_photo","Startup photo layer"),H?.bootstrapPhotoSeen?r:t],[this.#H("v4_startup_structure","Startup structure layer"),H?.bootstrapStructureSeen?r:t],[this.#H("v4_startup_failures","Startup failures"),String(H?.bootstrapFailures||0)],[this.#H("v4_stream_failures","Stream failures"),String(H?.streamFailures||0)],[this.#H("v4_saved_floor_count","Saved floor count"),String(this.state.floor.classifiedCount)]]}#S(H){this.#C!==void 0&&clearTimeout(this.#C),this.#C=void 0,this._copyStatus=H,H==="copied"&&(this.#C=setTimeout(()=>{this.#C=void 0,this._copyStatus="idle"},2e3))}#t(H,V){if(typeof document>"u"||typeof document.execCommand!="function")return!1;let e=V??(document.activeElement instanceof HTMLElement?document.activeElement:null),r=document.createElement("textarea");r.value=H,r.readOnly=!0,r.setAttribute("aria-hidden","true"),r.style.cssText="position:fixed;inset-block-start:-1000px;inline-size:1px;block-size:1px;opacity:0",document.body.append(r),r.select(),r.setSelectionRange(0,H.length);try{return document.execCommand("copy")}catch{return!1}finally{r.remove(),e?.focus({preventScroll:!0})}}async#x(H){let V=this.#s().map(([r,t])=>`${r}: ${t}`).join(`
`),e=typeof navigator>"u"?void 0:navigator.clipboard;if(e&&typeof e.writeText=="function")try{await e.writeText(V),this.#S("copied");return}catch{}this.#S(this.#t(V,H instanceof HTMLElement?H:null)?"copied":"failed")}#f(){let H=this.#s(),V=this._copyStatus==="copied"?this.#H("v4_copied","Copied"):this._copyStatus==="failed"?this.#H("v4_copy_failed","The summary could not be copied. Select the text to copy it by hand."):"";return p`
      <div class="stack">
        <p class="subtle">${this.#H("v4_support_privacy","This summary contains no map, coordinates, room or floor names, device identifiers, addresses, or credentials.")}</p>
        <dl class="diagnostics">
          ${H.map(([e,r])=>p`<dt>${e}</dt><dd>${r}</dd>`)}
        </dl>
        <div class="toolbar">
          <button class="ms-btn ms-btn--secondary" type="button" @click=${e=>{this.#x(e.currentTarget)}}>${Z(e0)}<span>${this.#H("v4_copy_summary","Copy summary")}</span></button>
        </div>
        <p class="copy-status" role="status" aria-live="polite">${V}</p>
      </div>
    `}render(){return p`<fieldset class="workflow-fields" ?disabled=${this.state.command!=="idle"&&this.state.command!=="failed"}>${this.#d()}</fieldset>`}#d(){switch(this.state.workflow){case"rooms":return this.#a();case"plan":return this.#h();case"draw":return this.#n();case"areaReview":return this.#v();case"history":return this.#l();case"support":return this.#f();case"none":return s}}};customElements.get(s1)||customElements.define(s1,A5);var b0=H1(A1),u2=H1(W1),O0=H1(s1),P0=L=>L.dataMode==="history"||L.floor.readOnly,X7=(L,C)=>{let H=(e,r,t)=>R(C,e,r,t);if(!L.host.connected)return{title:H("v4_reconnecting","Reconnecting"),detail:H("v4_ha_offline","Home Assistant is offline"),icon:b1,notable:!0};if(!L.host.administrator)return{title:H("v4_access_required","Access required"),detail:H("v4_admin_only","Administrator only"),icon:b1,notable:!0};if(L.host.robotCount===0)return{title:H("v4_no_robot_short","No robot"),detail:H("v4_set_up_robot","Set up a Matic robot"),icon:b1,notable:!0};if(!L.host.robotConnected)return{title:H("v4_robot_offline","Robot offline"),detail:H("v4_last_map_read_only","Last verified map \xB7 read only"),icon:b1,notable:!0};if(L.activity==="problem")return{title:H("v4_needs_attention","Needs attention"),detail:H("v4_check_robot","Check the robot"),icon:b1,notable:!0};if(L.dataMode==="history"){let e=L.resources.history.value?.floors.find(M=>M.id===L.selection.floorId),r=e?.snapshots.findIndex(M=>M.id===L.selection.historyId)??-1,t=e?.snapshots.length??0;return{title:H("v4_saved_map","Saved map"),detail:r>=0?H("v4_read_only_position","Read only \xB7 {position} of {count}",{position:r+1,count:t}):H("v4_read_only","Read only"),icon:r5,notable:!1}}if(L.coherence==="verifying"||L.coherence==="booting")return{title:H("v4_locating","Locating"),detail:H("v4_finding_map","Finding the current map"),icon:y1,notable:!0};if((L.resources.entry?.activePlan||L.resources.entry?.runnerLocked)&&(L.activity==="idle"||L.activity==="docked"))return{title:H("v4_task_in_progress","Task in progress"),detail:L.activity==="docked"?H("v4_task_docked","Robot docked; the cleaning task has not finished."):H("v4_task_waiting","Waiting for the cleaning task to continue or finish."),icon:t5,notable:!0};if(L.command==="starting"&&(L.activity==="idle"||L.activity==="docked"))return{title:H("v4_action_starting","Starting"),detail:H("v4_action_starting_detail","Waiting for the robot to begin"),icon:y1,notable:!0};if(L.activity==="cleaning")return{title:H("v4_cleaning","Cleaning"),detail:H("v4_cleaning_progress","Cleaning in progress"),icon:M5,notable:!0};if(L.activity==="recharging"){let e=L.batteryPercent===null?H("v4_recharging_detail","Will resume automatically when ready"):H("v4_recharging_battery","Charging to resume \xB7 {percent}% battery",{percent:L.batteryPercent});return{title:H("v4_recharging","Charging to resume"),detail:e,icon:t0,notable:!0}}if(L.activity==="paused")return{title:H("v4_paused","Paused"),detail:H("v4_can_resume","Cleaning can resume"),icon:o5,notable:!0};if(L.activity==="returning")return{title:H("v4_returning","Returning"),detail:H("v4_going_dock","Going to the dock"),icon:M5,notable:!0};if(L.activity==="stopping")return{title:H("v4_stopping","Stopping"),detail:H("v4_waiting_robot","Waiting for the robot"),icon:o5,notable:!0};let V=L.batteryPercent===null?H("v4_ready","Ready"):H("v4_battery","{percent}% battery",{percent:L.batteryPercent});return{title:L.activity==="docked"?H("v4_docked","Docked"):H("v4_ready","Ready"),detail:V,icon:y1,notable:!1}},w0=(L,C)=>{let H=(V,e)=>R(C,V,e);switch(L.workflow){case"rooms":return{title:H("v4_choose_rooms","Choose rooms"),description:H("v4_choose_rooms_detail","Select on the map or from the list.")};case"draw":return{title:H("v4_draw_area","Draw an area"),description:H("v4_draw_area_detail","Outline or paint the area, then review it before saving.")};case"plan":return{title:H("v4_cleaning_plan","Cleaning plan"),description:H("v4_plan_detail","Review rooms and cleaning settings.")};case"areaReview":return{title:H("v4_name_this_area","Name this area"),description:H("area_details_hint","Name the area and choose cleaning settings.")};case"history":return{title:H("v4_map_history","Map history"),description:H("v4_map_history_detail","Saved maps are floor-scoped and read only.")};case"support":return{title:H("v4_map_diagnostics","Map diagnostics"),description:H("v4_map_support_detail","Private geometry is never included.")};case"none":return P0(L)?{title:H("v4_saved_map_read_only_title","Saved map is read only"),description:H("v4_saved_map_read_only_detail","Return to the live map to choose rooms, run a plan, or draw a custom area.")}:{title:H("v4_what_to_clean","What should the robot clean?"),description:H("v4_clean_detail","Choose rooms, a saved plan, or a custom area.")}}},t1=["peek","half","full"],k0={none:"half",rooms:"half",draw:"peek",plan:"full",areaReview:"half",history:"half",support:"full"},Y7=.5,j7=100,J7=6,C4=48,H4=["button:not(:disabled)","a[href]","input:not(:disabled)","select:not(:disabled)","textarea:not(:disabled)","[tabindex]:not([tabindex='-1'])"].join(", "),V4=(L,C,H=!1)=>{let V=(e,r)=>R(C,e,r);switch(L){case"discardDraft":return{title:H?V("v4_discard_plan","Discard plan changes?"):V("v4_discard_area","Discard area changes?"),detail:H?V("v4_discard_plan_detail","Your plan changes have not been saved. Keep editing or discard them."):V("v4_discard_area_detail","Your area changes have not been saved. Keep editing or discard them."),cancelLabel:V("v4_keep_area_editing","Keep editing"),confirmLabel:V("v4_discard","Discard"),action:"discard"};case"confirmDeletePlan":return{title:V("v4_delete_plan","Delete this plan?"),detail:V("v4_delete_plan_detail","This removes the saved plan from Home Assistant. The robot will not move."),cancelLabel:V("v4_cancel","Cancel"),confirmLabel:V("plan_delete","Delete plan"),action:"delete-plan"};case"confirmDeleteArea":return{title:V("v4_delete_area","Delete this area?"),detail:V("v4_delete_area_detail","This removes the saved outline from Home Assistant. The robot will not move."),cancelLabel:V("v4_cancel","Cancel"),confirmLabel:V("area_delete","Delete area"),action:"delete-area"};case"confirmStop":return{title:V("v4_stop_cleaning","Stop cleaning?"),detail:V("v4_stop_cleaning_detail","The robot may take a moment to settle before another action is available."),cancelLabel:V("v4_keep_cleaning","Keep cleaning"),confirmLabel:V("v4_stop","Stop"),action:"stop"};case"error":return{title:V("v4_error","Something went wrong"),detail:V("v4_error_detail","No action was started. Close this message and try again when the map is ready."),cancelLabel:V("v4_close","Close"),confirmLabel:V("v4_close","Close"),action:null};case null:return null}},L4=(L=document)=>{let C=L.activeElement;for(;C?.shadowRoot?.activeElement;)C=C.shadowRoot.activeElement;return C},s5=L=>!!(L&&L.isConnected&&L.offsetParent!==null),d5=class extends k{constructor(){super();this.state=y();this._measuredNarrow=!1;this._sheetOffset=0;this._overflowOpen=!1;this._helpOpen=!1;this._browserFullscreen=!1;this._sheetDetent="half";this._announcement="";this.#H=null;this.#V=null;this.#e=null;this.#r=null;this.#L=null;this.#o=null;this.#i=null;this.#a=null;this.#A=null;this.#u=()=>{this._browserFullscreen=document.fullscreenElement===this.renderRoot.querySelector(".app")};this.#M=H=>{if(!this._overflowOpen)return;let V=this.renderRoot.querySelector(".overflow-wrap");(!V||!H.composedPath().includes(V))&&(this._overflowOpen=!1)};new m1(this,{container:()=>this.renderRoot?.querySelector(".draw-tools")??null,items:"button"})}static{this.properties={state:{attribute:!1},localize:{attribute:!1},_measuredNarrow:{state:!0},_sheetOffset:{state:!0},_overflowOpen:{state:!0},_helpOpen:{state:!0},_browserFullscreen:{state:!0},_sheetDetent:{state:!0},_announcement:{state:!0}}}static{this.styles=o3}#C(H,V,e){return R(this.localize,H,V,e)}#H;#V;#e;#r;#L;#o;#i;#a;#A;#u;#M;connectedCallback(){super.connectedCallback(),this.#H=new ResizeObserver(([H])=>{if(!H)return;let V=H.contentRect.width<1024||H.contentRect.height<480;V!==this._measuredNarrow&&(this._measuredNarrow=V)}),this.#H.observe(this),window.addEventListener("pointerdown",this.#M,!0),document.addEventListener("fullscreenchange",this.#u),this.#V=new ResizeObserver(([H])=>{if(!H)return;let V=Math.ceil(H.target.getBoundingClientRect().height);V!==this._sheetOffset&&(this._sheetOffset=V)})}disconnectedCallback(){this.#H?.disconnect(),this.#H=null,this.#V?.disconnect(),this.#V=null,this.#e=null,window.removeEventListener("pointerdown",this.#M,!0),document.removeEventListener("fullscreenchange",this.#u),super.disconnectedCallback()}updated(H){let V=H,e=this.renderRoot.querySelector(".mobile-sheet");if(e!==this.#e&&(this.#V?.disconnect(),this.#e=e,e?this.#V?.observe(e):this._sheetOffset!==0&&(this._sheetOffset=0)),V.has("_overflowOpen")&&this._overflowOpen&&this.updateComplete.then(()=>{this.renderRoot.querySelector("#map-options select, #map-options button")?.focus()}),V.has("_helpOpen")){if(this._helpOpen)this.updateComplete.then(()=>{this.renderRoot.querySelector(".help-dialog [data-dialog-initial-focus]")?.focus()});else if(V.get("_helpOpen")){let r=this.#o;this.#o=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>r?.focus({preventScroll:!0}))})}}if(H.has("state")){let r=H.get("state");if(r?.precisionOpen&&!this.state.precisionOpen&&this.#h()?.focus(),r?.fullMap&&!this.state.fullMap){let t=this.#L;this.#L=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>{(this.renderRoot.querySelector(".workspace-toggle")??this.renderRoot.querySelector(".nav--menu")??(t?.isConnected?t:null))?.focus({preventScroll:!0})})})}if(!r?.dialog&&this.state.dialog){let t=L4(this.shadowRoot||document);t?.hasAttribute("data-dialog-launcher")&&(this.#r=t),this.updateComplete.then(()=>{(this.renderRoot.querySelector(".dialog [data-dialog-initial-focus]")??this.renderRoot.querySelector(".dialog button"))?.focus()})}else if(r?.dialog&&!this.state.dialog){r.dialog==="discardDraft"&&(this.#i=null,this.#S());let t=this.#r?.isConnected&&this.#r.hasAttribute("data-dialog-launcher")?this.#r:this.#N(r.dialog);this.#r=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>t?.focus({preventScroll:!0}))})}r?r.workflow!==this.state.workflow&&(this._sheetDetent=k0[this.state.workflow],this.updateComplete.then(()=>this.#y())):this._sheetDetent=k0[this.state.workflow]}}#y(){let H=this.renderRoot.querySelector(".panel-heading h2");if(s5(H)){H.focus({preventScroll:!0});return}let V=this.renderRoot.querySelector(".action-bar .ms-btn--primary");s5(V)&&V.focus({preventScroll:!0})}#h(){let H=this.renderRoot.querySelector(".draw-brush");return s5(H)?H:this.renderRoot.querySelector(A1)?.shadowRoot?.querySelector(".draw-brush")??null}#n(H){if(C1(this.state,H)){this.#i=H,this.#n({type:"open-dialog",dialog:"discardDraft"});return}this.dispatchEvent(new CustomEvent(e1,{detail:H,bubbles:!0,composed:!0}))}#v(H){if(H.enabled){if(H.id==="return-live"){this.#n({type:"set-history",historyId:null});return}if(H.id==="clear-draft"){this.#n({type:"clear-draft"});return}this.#x(H.id)}}#l(H,V){let e={type:"open-workflow",workflow:H};V instanceof HTMLElement&&C1(this.state,e)&&(this.#r=V),this.#n(e)}#p(){let H=this.#i;this.#i=null,H?.type==="select-plan"||H?.type==="select-area"?(this.#n({type:"patch-plan-draft",patch:{dirty:!1}}),this.#n({type:"patch-area-draft",patch:{dirty:!1}}),this.#n({type:"dismiss-top-layer"})):this.#n({type:"discard-draft"}),H&&queueMicrotask(()=>this.dispatchEvent(new CustomEvent(e1,{detail:H,bubbles:!0,composed:!0})))}#s(){this.#i=null,this.#t(),this.#S()}#S(){this.updateComplete.then(()=>{let H=this.renderRoot.querySelector(".floor-switcher");H&&(H.value=this.state.selection.floorId);let V=this.renderRoot.querySelector(".robot-switcher");V&&(V.value=this.state.selection.entryId??"");let r=this.renderRoot.querySelector(s1)?.shadowRoot?.querySelector('[name="saved-plan"]');r&&(r.value=this.state.selection.planId??"")})}#t(){let H=this.state.dialog,V=H&&this.#r?.isConnected&&this.#r.hasAttribute("data-dialog-launcher")?this.#r:H?this.#N(H):null;this.#n({type:"dismiss-top-layer"}),V&&requestAnimationFrame(()=>V.focus({preventScroll:!0}))}#x(H){this.dispatchEvent(new CustomEvent(m2,{detail:{id:H},bubbles:!0,composed:!0}))}#f(H){this.#n({type:"dismiss-top-layer"}),this.#x(H)}#d(H){if(H.action==="discard"){this.#p();return}if(H.action==="delete-plan"||H.action==="delete-area"){this.#f(H.action);return}this.#n({type:"dismiss-top-layer"}),H.action==="stop"&&this.#x("stop")}#m(H){H!==this._sheetDetent&&(this._sheetDetent=H,this._announcement=this.#C("v4_workspace_height","Map workspace, {height} height",{height:H}))}#c(H,V=!1){let r=t1.indexOf(this._sheetDetent)+H;V&&r>=t1.length&&(r=0),r=Math.max(0,Math.min(t1.length-1,r)),this.#m(t1[r]??this._sheetDetent)}#Z(H){let V=this.renderRoot.querySelector(".workspace")?.clientHeight??H.parentElement?.clientHeight??H.offsetHeight,e=parseFloat(getComputedStyle(this).fontSize)||16,r=[".sheet-grip",".sheet-tools",".action-bar"].map(o=>H.querySelector(o)?.offsetHeight??0).reduce((o,i)=>o+i,0)+e*.75,t=Math.min(V*.92,V-e*9),M=Math.min(V*.48,e*26,t);return{peek:Math.min(r,M),half:M,full:t}}#w(){return this.renderRoot.querySelector(".mobile-sheet")}#O(H){if(H.pointerType==="mouse"&&H.button!==0||H.target?.closest("button, select, input, a"))return;let V=this.#w();!V||this.#a||(this.#a={pointerId:H.pointerId,startY:H.clientY,startHeight:V.offsetHeight,heights:this.#Z(V),samples:[{y:H.clientY,t:H.timeStamp}],moved:!1},H.currentTarget.setPointerCapture(H.pointerId),V.classList.add("dragging"))}#E(H){let V=this.#a;if(!V||H.pointerId!==V.pointerId)return;let e=this.#w();if(!e)return;let r=H.clientY-V.startY;for(!V.moved&&Math.abs(r)>J7&&(V.moved=!0),V.samples.push({y:H.clientY,t:H.timeStamp});V.samples.length>2&&H.timeStamp-(V.samples[1]?.t??0)>j7;)V.samples.shift();if(!V.moved)return;let t=V.startHeight-V.heights.full,M=V.startHeight-V.heights.peek,o=Math.max(t,Math.min(M,r));e.style.transform=`translateY(${o}px)`}#k(H){let V=this.#a;if(!V||H.pointerId!==V.pointerId)return;this.#a=null;let e=this.#w();if(e&&(e.style.transform="",e.classList.remove("dragging")),H.type==="pointercancel")return;if(!V.moved){this.#c(1,!0);return}let r=H.clientY-V.startY,t=t1.indexOf(this._sheetDetent),M=V.samples[0],o=V.samples[V.samples.length-1],i=M&&o&&o!==M?(o.y-M.y)/Math.max(1,o.t-M.t):0;if(Math.abs(i)>Y7){let A=Math.max(0,Math.min(t1.length-1,t+(i<0?1:-1)));this.#m(t1[A]??this._sheetDetent);return}let a=V.startHeight-r,n=this._sheetDetent,l=Number.POSITIVE_INFINITY;for(let A of t1){let d=Math.abs(V.heights[A]-a);d<l&&(l=d,n=A)}this.#m(n)}#R(H){if(H.pointerType==="mouse")return;let V=H.currentTarget;this.#A={pointerId:H.pointerId,startY:H.clientY,atTop:V.scrollTop===0,consumed:!1}}#P(H){let V=this.#A;if(!V||V.consumed||!V.atTop||H.pointerId!==V.pointerId)return;if(H.currentTarget.scrollTop>0){this.#A=null;return}H.clientY-V.startY<C4||(V.consumed=!0,this.#c(-1))}#g(){this.#A=null}#T(){this.dispatchEvent(new CustomEvent("hass-toggle-menu",{bubbles:!0,composed:!0}))}#B(H){this.#L=H.currentTarget,this.#n({type:this.state.fullMap?"exit-full-map":"enter-full-map"})}#F(H){this._overflowOpen=!1,H&&this.updateComplete.then(()=>{this.renderRoot.querySelector(".overflow")?.focus()})}#b(H){if(this.#F(H==="fullscreen"),H==="support"){this.#l("support");return}if(H==="fullscreen"){let V=this.renderRoot.querySelector(".app");document.fullscreenElement?document.exitFullscreen():V?.requestFullscreen();return}this.dispatchEvent(new CustomEvent(m2,{detail:{id:"use-classic"},bubbles:!0,composed:!0}))}#_(){this.#n({type:"set-precision-open",value:!this.state.precisionOpen})}#C1(H){this.#o=H.currentTarget,this._helpOpen=!0}#q(H){let V=H;if(!u1(V.detail))return;if(C1(this.state,V.detail)){H.stopPropagation(),this.#n(V.detail);return}if(V.detail?.type!=="open-dialog")return;let e=V.composedPath().find(r=>r instanceof HTMLElement&&r.hasAttribute("data-dialog-launcher"));e instanceof HTMLElement&&(this.#r=e)}#N(H){return this.renderRoot.querySelector(s1)?.shadowRoot?.querySelector(`[data-dialog-launcher="${H}"]`)??null}#H1(H){if(!A2(H)&&!(H.defaultPrevented||H.ctrlKey||H.metaKey||H.altKey)&&H.key==="Escape"){if(H.preventDefault(),this._overflowOpen){this.#F(!0);return}if(this._helpOpen){this._helpOpen=!1;return}if(this.state.dialog==="discardDraft"){this.#s();return}this.#n({type:"dismiss-top-layer"})}}#U(H){if(H.key!=="Tab")return;let e=[...H.currentTarget.querySelectorAll(H4)],r=e[0],t=e.at(-1);if(!r||!t)return;let M=this.shadowRoot?.activeElement;H.shiftKey&&M===r?(H.preventDefault(),t.focus()):!H.shiftKey&&M===t&&(H.preventDefault(),r.focus())}#X(){let H=this.renderRoot.querySelector(A1);(H?.shadowRoot?.querySelector(".map-root")??H)?.focus()}#Y(){this._sheetDetent==="peek"&&this.#w()&&this.#m("half"),this.updateComplete.then(()=>this.#y())}#I(H,V,e){if(H.id==="choose-cleaning")return s;let r=H.labelKey?this.#C(H.labelKey,H.label):H.label,t=!H.enabled&&H.reason?H.reasonKey?this.#C(H.reasonKey,H.reason):H.reason:null,M=H.id==="stop";return x`
      <button
        class=${`${V} ${H.kind==="danger"?"ms-btn--danger":""}`}
        type="button"
        aria-disabled=${H.enabled?s:"true"}
        aria-describedby=${t?e:s}
        aria-label=${M?this.#C("v4_stop_cleaning_label","Stop cleaning"):s}
        @click=${()=>this.#v(H)}
      >${r}</button>
      ${t?x`<p class="action-reason" id=${e}>${t}</p>`:s}
    `}#G(H){let V=H.resources.plans.value?.rooms??H.resources.areas.value?.rooms??[];return H.selection.roomIds.map(e=>V.find(r=>r.roomId===e)?.name??e)}#D(H,V,e){let r=V?.enabled&&H.workflow==="rooms"&&V.id==="clean-rooms"?[this.#G(H).join(", "),H.planDraft.returnToBase?this.#C("v4_returns_to_dock","returns to the dock"):""].filter(Boolean).join(" \xB7 "):"";return x`
      <div class="action-bar">
        ${r?x`<p class="action-summary">${r}</p>`:s}
        ${V?this.#I(V,"ms-btn ms-btn--block ms-btn--lg ms-btn--primary","primary-reason"):s}
        ${e?this.#I(e,"ms-btn ms-btn--block ms-btn--lg ms-btn--secondary","secondary-reason"):s}
      </div>
    `}#W(H,V,e=s){return x`
      <div class="host-state">
        <h3>${H}</h3>
        <p>${V}</p>
        ${e}
      </div>
    `}#z(H,V,e,r,t=!1){return x`
      <button
        class="ms-row"
        type="button"
        aria-disabled=${t?"true":s}
        @click=${()=>{t||e()}}
      >
        <span class="ms-row__lead">${Z(V)}</span>
        <span class="ms-row__body"><strong>${H}</strong>${r?x`<small>${r}</small>`:s}</span>
        <span class="ms-row__trail">${Z(i2)}</span>
      </button>
    `}#V1(H){let V=H.resources.history.value?.floors||[],e=V.length?V.map((r,t)=>({id:r.active?"current":r.id,label:`${r.label||(r.active?this.#C("v4_current_floor","Current floor"):this.#C("v4_saved_floor","Saved floor {number}",{number:r.ordinal??t+1}))}${!r.active&&r.snapshots.length===0?` \xB7 ${this.#C("v4_floor_not_captured","Visit floor to capture")}`:""}`,disabled:!r.active&&r.snapshots.length===0})):[{id:H.selection.floorId,label:H.floor.displayName,disabled:!1}];return x`
      <select
        class="ms-select context-switcher floor-switcher"
        slot="floor"
        data-map-control
        name="map-floor"
        aria-label=${this.#C("v4_choose_floor","Choose floor")}
        ?disabled=${e.length<=1}
        .value=${H.selection.floorId}
        @change=${r=>this.#n({type:"set-floor",floorId:r.currentTarget.value})}
      >${e.map(r=>x`
        <option value=${r.id} ?selected=${r.id===H.selection.floorId} ?disabled=${r.disabled}>${r.label}</option>
      `)}</select>
    `}#L1(H,V){let e=(S,O,g)=>this.#C(S,O,g),r=this.#z(e("v4_map_history","Map history"),r5,()=>this.#l("history"),e("v4_map_history_detail","Saved maps are floor-scoped and read only.")),t=this.#z(e("v4_map_diagnostics","Map diagnostics"),r0,()=>this.#l("support"),e("v4_map_support_detail","Private geometry is never included.")),{host:M}=H;if(!M.connected)return this.#W(e("v4_reconnecting_title","Reconnecting to Home Assistant"),e("v4_reconnecting_body","The last verified map stays read-only until the connection returns."));if(!M.administrator)return this.#W(e("v4_admin_title","Administrator access required"),e("v4_admin_body","Ask a Home Assistant administrator to open this map."));if(M.robotCount===0)return this.#W(e("v4_no_robot_title","No Matic robot set up"),e("v4_no_robot_body","Add the Matic integration to see a map here."),x`<a class="ms-btn ms-btn--secondary" href="/config/integrations/integration/matic_robot">${e("v4_open_integration","Open the Matic integration")}</a>`);if(!M.robotConnected)return x`
        ${this.#W(e("v4_robot_offline_title","Robot offline"),e("v4_robot_offline_body","Showing the last verified map. Cleaning is unavailable until the robot reconnects."))}
        <h3 class="shelf-heading">${e("v4_more","Map tools")}</h3>
        <div class="shelf">${r}${t}</div>
      `;if(P0(H))return x`
        ${this.#W(e("v4_saved_map_read_only_notice","Cleaning is unavailable on a saved map"),e("v4_saved_map_read_only_notice_detail","Saved maps are view only. Return to the live map below to choose rooms, run a plan, or draw a custom area."))}
        <h3 class="shelf-heading">${e("v4_more","Map tools")}</h3>
        <div class="shelf">
          ${r}
          ${t}

        </div>
      `;let o=H.coherence==="verifying"||H.coherence==="booting",i=H.resources.plans,a=i.value,n=a!==null&&a.rooms.length===0,l=a?.plans.length??0,A=i.status==="loading",d=i.status==="error",m=o||n,u=o?e("v4_reason_locating","Waiting for the robot to confirm which floor it is on."):n?e("v4_no_rooms_reason","This floor has no named rooms yet."):null,h=o?e("v4_reason_locating","Waiting for the robot to confirm which floor it is on."):null,f=o?e("v4_reason_locating","Waiting for the robot to confirm which floor it is on."):e("v4_areas_quick_detail","Sketch a one-time zone on the map");return x`
      ${H.activity==="problem"?this.#W(e("v4_attention_title","The robot needs attention"),e("v4_attention_body","Check the robot, then start a new task.")):x`
          <div class="quick-actions" aria-label=${e("v4_cleaning_choices","Cleaning choices")}>
            <button
              class="ms-row ms-row--card ms-row--featured"
              type="button"
              aria-disabled=${m?"true":s}
              @click=${()=>{m||this.#l("rooms")}}
            >
              <span class="ms-row__lead">${Z(y1)}</span>
              <span class="ms-row__body">
                <strong>${e("v4_clean_rooms","One-time clean")}</strong>
                <small>${u??e("v4_clean_rooms_hint","Choose rooms for this run")}</small>
              </span>
              <span class="ms-row__trail">${Z(i2)}</span>
            </button>
            <button
              class="ms-row ms-row--card"
              type="button"
              aria-disabled=${o?"true":s}
              @click=${()=>{o||this.#l("plan")}}
            >
              <span class="ms-row__lead">${Z(t5)}</span>
              <span class="ms-row__body">
                <strong>${A?e("v4_plans_loading","Checking saved plans"):d?e("v4_plans_unavailable","Plans unavailable"):l?e("v4_run_a_plan","Run a plan"):e("v4_create_plan","Create a plan")}</strong>
                <small>${h??(A?e("v4_plans_loading_hint","Reading routines for this floor"):d?e("v4_plans_unavailable_hint","Try again to load saved routines"):l?l===1?e("v4_saved_routine","1 saved routine"):e("v4_saved_routines","{count} saved routines",{count:l}):e("v4_no_plans_hint","Save a room routine you can repeat"))}</small>
              </span>
              <span class="ms-row__trail">${Z(i2)}</span>
            </button>
          </div>
        `}
      <h3 class="shelf-heading">${e("v4_more","Map tools")}</h3>
      <div class="shelf">
        ${this.#z(e("v4_custom_areas","Clean a custom area"),a2,()=>this.#l("draw"),f,o)}
        ${r}

      </div>
      ${V?x`
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
            @click=${this.#C1}
          >${e("v4_how_to_move","How to move the map")}</button>
        </div>
      `:s}
    `}#e1(H,V){return H.workflow==="none"?this.#L1(H,V):x`<${O0}
      .state=${H}
      .localize=${this.localize}
      @matic-workspace-intent=${this.#q}
    ></${O0}>`}#j(H,V){let e=w0(H,this.localize);return x`
      <div class="panel-heading">
        ${H.workflow!=="none"?x`
          <button
            class="panel-back ms-btn ms-btn--secondary"
            type="button"
            aria-label=${this.#C("v4_back_to_all_tasks","Back to all tasks")}
            data-dialog-launcher="discardDraft"
            @click=${r=>this.#l("none",r.currentTarget)}
          >${Z(o2)}<span class="ms-btn__label">${this.#C("v4_all_tasks","All tasks")}</span></button>
        `:s}
        <h2 tabindex="-1">${e.title}</h2>
      </div>
      <p class="panel-description">${e.description}</p>
      ${this.#e1(H,V)}
    `}#K(H,V){let r=w0(H,this.localize).title;return H.workflow==="rooms"&&H.selection.roomIds.length&&(r=`${this.#C("v4_rooms_selected","Rooms selected: {count}",{count:H.selection.roomIds.length})} \xB7 ${this.#G(H).join(", ")}`),this._sheetDetent!=="peek"?V.detail?`${V.title} \xB7 ${V.detail}`:V.title:V.notable?`${V.title} \xB7 ${r}`:r}#$(){let H=(V,e)=>this.#C(V,e);return x`
      <div class="dialog-backdrop" @click=${V=>{V.target===V.currentTarget&&(this._helpOpen=!1)}}>
        <section
          class="dialog help-dialog ms-surface ms-surface--overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-title"
          @keydown=${this.#U}
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
    `}render(){let H=this.state,V=H.narrowHint||this._measuredNarrow,e=X7(H,this.localize),r=$2({...H,narrowHint:V}),t=k5(H),M=!V&&r.id==="stop"?r:!V&&t?.id==="stop"?t:null,o=M&&M===r?null:r,i=H.workflow==="draw"&&H.dataMode==="live"?{id:"clear-draft",label:"Clear drawing",labelKey:"v4_clear_drawing",kind:"neutral",enabled:H.draw.circles.length>0}:null,a=M&&M===t?null:t??i,n=H.fullMap&&(H.coherence==="verifying"||H.coherence==="booting"),l=H.fullMap||H.host.administrator&&H.host.robotCount>0&&H.map.available,A=V4(H.dialog,this.localize,H.workflow==="plan"),d=V&&!H.fullMap?`--map-sheet-offset:${this._sheetOffset}px`:"--map-sheet-offset:0px",m=V&&H.workflow==="draw",u=H.precisionOpen&&H.workflow==="draw";return x`
      <div class=${`root ${V?"narrow":"wide"}`} @keydown=${this.#H1}>
        <button class="skip-link ms-btn ms-btn--primary" type="button" @click=${this.#X}>${this.#C("v4_skip_to_map","Skip to the map")}</button>
        <button class="skip-link ms-btn ms-btn--primary" type="button" @click=${this.#Y}>${this.#C("v4_skip_to_workspace","Skip to the map workspace")}</button>
        <div class="app" ?inert=${!!A||this._helpOpen}>
          <header class="app-bar">
            ${H.precisionOpen?x`
              <button
                class="nav ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#C("v4_back","Back")}
                @click=${()=>this.#n({type:"dismiss-top-layer"})}
              >${Z(o2)}</button>
            `:s}
            <h1 class="title">${this.#C("map_studio_title","Matic Map")}</h1>
            ${H.robots.length>1?x`
              <select
                class="ms-select context-switcher robot-switcher"
                name="matic-robot"
                aria-label=${this.#C("v4_choose_robot","Choose robot")}
                .value=${H.selection.entryId||""}
                @change=${h=>this.#n({type:"select-entry",entryId:h.currentTarget.value})}
              >${H.robots.map(h=>x`
                <option value=${h.entryId} ?selected=${h.entryId===H.selection.entryId}>${h.label}</option>
              `)}</select>
            `:s}

            <span class="spacer"></span>
            ${l?x`
              <button
                class="workspace-toggle ms-btn ms-btn--icon"
                type="button"
                aria-label=${H.fullMap?this.#C("v4_show_workspace","Show workspace"):this.#C("v4_hide_workspace","Hide workspace")}
                aria-controls="map-workspace"
                aria-expanded=${String(!H.fullMap)}
                title=${H.fullMap?this.#C("v4_show_workspace","Show workspace"):this.#C("v4_hide_workspace","Hide workspace")}
                @click=${this.#B}
              >${Z(D3)}</button>
            `:s}
            ${H.precisionOpen?s:x`
              <button
                class="nav nav--menu ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#C("v4_open_navigation","Open navigation")}
                title=${this.#C("v4_open_navigation","Open navigation")}
                @click=${this.#T}
              >${Z(F3)}</button>
            `}
            <div class="overflow-wrap">
              <button
                class="overflow ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#C("v4_map_options","Map options")}
                aria-expanded=${String(this._overflowOpen)}
                aria-controls="map-options"
                @click=${()=>{this._overflowOpen=!this._overflowOpen}}
              >${Z(E3)}</button>
              ${this._overflowOpen?x`
                <div id="map-options" class="overflow-menu ms-surface ms-surface--overlay">
                  <label class="overflow-field ms-field">${this.#C("map_quality_label","Scene detail")}
                    <select
                      aria-label=${this.#C("map_quality_label","Scene detail")}
                      .value=${H.quality}
                      @change=${h=>this.#n({type:"set-quality",quality:h.currentTarget.value})}
                    >
                      <option value="auto">${this.#C("map_quality_auto","Auto detail")}</option>
                      <option value="efficient">${this.#C("map_quality_efficient","Efficient")}</option>
                      <option value="balanced">${this.#C("map_quality_balanced","Balanced")}</option>
                      <option value="maximum">${this.#C("map_quality_maximum","Maximum")}</option>
                    </select>
                  </label>
                  <button class="ms-row ms-row--menu" type="button" @click=${()=>this.#b("support")}>${this.#C("v4_map_diagnostics","Map diagnostics")}</button>
                  <button class="ms-row ms-row--menu" type="button" @click=${()=>this.#b("classic")}>${this.#C("v4_switch_classic","Open classic map view")}</button>
                  <button class="ms-row ms-row--menu" type="button" @click=${()=>this.#b("fullscreen")}>${this._browserFullscreen?this.#C("v4_leave_full_screen","Leave full screen"):this.#C("v4_full_screen","Full screen")}</button>
                </div>
              `:s}
            </div>
          </header>

          <main class=${`workspace ${H.fullMap?"full-map":""}`} style=${d}>
            <div class="canvas">
              <${b0}
                class="map-canvas"
                style=${d}
                .state=${H}
                .localize=${this.localize}
                .narrow=${V}
              >${this.#V1(H)}
                ${V&&!H.fullMap&&this._sheetDetent==="full"?x`
                  <button
                    class="sheet-scrim"
                    slot="scrim"
                    data-map-control
                    type="button"
                    aria-label=${this.#C("v4_collapse_sheet","Collapse the map workspace")}
                    @click=${()=>this.#m("peek")}
                  ></button>
                `:s}
              </${b0}>
              ${!V&&u?x`
                <div class="precision-popover">
                  <${u2} compact .state=${H} .localize=${this.localize}></${u2}>
                </div>
              `:s}
            </div>

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
              data-detent=${V?this._sheetDetent:s}
              data-workflow=${H.workflow}
              aria-label="Map workspace"
            >
              ${V?x`
                <div
                  class="sheet-grip"
                  @pointerdown=${this.#O}
                  @pointermove=${this.#E}
                  @pointerup=${this.#k}
                  @pointercancel=${this.#k}
                >
                  <span class="sheet-handle" role="presentation"></span>
                  ${H.workflow!=="none"&&this._sheetDetent==="peek"?x`
                    <button
                      class="sheet-back ms-btn ms-btn--icon ms-btn--sm"
                      type="button"
                      aria-label=${this.#C("v4_back_to_all_tasks","Back to all tasks")}
                      title=${this.#C("v4_back_to_all_tasks","Back to all tasks")}
                      data-dialog-launcher="discardDraft"
                      @click=${h=>this.#l("none",h.currentTarget)}
                    >${Z(o2)}</button>
                  `:s}
                  <span class="sheet-status">${this.#K(H,e)}</span>
                  <button
                    class="ms-btn ms-btn--icon ms-btn--sm"
                    type="button"
                    aria-label=${this.#C("v4_show_more","Show more of the map workspace")}
                    aria-controls="sheet-body"
                    aria-disabled=${this._sheetDetent==="full"?"true":s}
                    @click=${()=>this.#c(1)}
                  >${Z($3)}</button>
                  <button
                    class="ms-btn ms-btn--icon ms-btn--sm"
                    type="button"
                    aria-label=${this.#C("v4_show_less","Show less of the map workspace")}
                    aria-controls="sheet-body"
                    aria-disabled=${this._sheetDetent==="peek"?"true":s}
                    @click=${()=>this.#c(-1)}
                  >${Z(I3)}</button>
                </div>
                ${m?x`
                  <div class="sheet-tools">
                    ${n2(H,{intent:h=>this.#n(h),openBrush:()=>this.#_(),t:(h,f)=>this.#C(h,f)},"grid")}
                    ${u?x`
                      <div class="precision-popover">
                        <${u2} compact inline .state=${H} .localize=${this.localize}></${u2}>
                      </div>
                    `:s}
                  </div>
                `:s}
                <div
                  class="sheet-body"
                  id="sheet-body"
                  @pointerdown=${this.#R}
                  @pointermove=${this.#P}
                  @pointerup=${this.#g}
                  @pointercancel=${this.#g}
                >
                  ${this.#j(H,V)}
                </div>
                ${this.#D(H,o,a)}
              `:x`
                <div class="status-strip">
                  <span class="status-icon" aria-hidden="true">${Z(e.icon)}</span>
                  <span class="status-copy"><strong>${e.title}</strong><small>${e.detail}</small></span>
                  ${M?this.#I(M,"status-action ms-btn ms-btn--secondary","status-reason"):s}
                </div>
                <section class="workflow">
                  <div class="workflow-body">${this.#j(H,V)}</div>
                  ${this.#D(H,o,a)}
                </section>
              `}
            </aside>

            ${H.fullMap?x`
              <section
                class=${`full-map-hud ms-surface ms-surface--floating ${t?"has-secondary":""} ${!V&&(H.workflow==="draw"||H.workflow==="rooms"&&H.selection.roomIds.length>0)?"above-dock":""}`}
                aria-label="Robot status and action"
              >
                <span class="hud-copy"><strong>${e.title}</strong><small>${e.detail}</small></span>
                ${n&&r.id!=="stop"?s:this.#I(r,"ms-btn ms-btn--lg ms-btn--primary","hud-reason")}
                ${t&&(!n||t.id==="stop")?this.#I(t,"ms-btn ms-btn--lg ms-btn--secondary","hud-secondary-reason"):s}
              </section>
            `:s}
          </main>
        </div>

        <div class="sr-only" aria-live="polite" aria-atomic="true">${[this._announcement,H.notice?.text??""].filter(Boolean).join(" ")}</div>

        ${this._helpOpen?this.#$():s}

        ${A?x`
          <div class="dialog-backdrop">
            <section
              class="dialog ms-surface ms-surface--overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="dialog-title"
              aria-describedby="dialog-detail"
              @keydown=${this.#U}
            >
              <h2 id="dialog-title">${A.title}</h2>
              <p id="dialog-detail">${A.detail}</p>
              <div class="dialog-actions">
                <button
                  class="ms-btn ms-btn--secondary"
                  type="button"
                  data-dialog-initial-focus
                  @click=${H.dialog==="discardDraft"?this.#s:this.#t}
                >${A.cancelLabel}</button>
                ${A.action===null?s:x`
                  <button
                    class="discard ms-btn ms-btn--primary ms-btn--danger"
                    type="button"
                    @click=${()=>this.#d(A)}
                  >${A.confirmLabel}</button>
                `}
              </div>
            </section>
          </div>
        `:s}
      </div>
    `}};customElements.get(d1)||customElements.define(d1,d5);var _0=H1(d1),p5=class extends k{constructor(){super(...arguments);this.scenario="ready";this.narrow=!1;this.controls=!0;this._workspace=z2("ready");this.#C=new Z1(this._workspace);this.#H=null}static{this.properties={scenario:{type:String,reflect:!0},narrow:{type:Boolean,reflect:!0},controls:{type:Boolean,reflect:!0},_workspace:{state:!0}}}static{this.styles=[$,I,w`
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
  `]}#C;#H;connectedCallback(){super.connectedCallback(),this.#H=this.#C.subscribe(H=>{this._workspace=H})}disconnectedCallback(){this.#H?.(),this.#H=null,super.disconnectedCallback()}willUpdate(H){H.has("scenario")?this.#C.replace({...z2(this.scenario),narrowHint:this.narrow}):H.has("narrow")&&this.#C.dispatch({type:"set-narrow-hint",value:this.narrow})}setScenario(H){N2.includes(H)&&(this.scenario=H)}getWorkspaceSnapshot(){return structuredClone(this.#C.value)}replaceWorkspaceState(H){this.#C.replace(structuredClone(H))}#V(H){u1(H.detail)&&(H.stopPropagation(),this.#C.dispatch(H.detail))}render(){return x`
      ${this.controls?x`
        <nav class="gallery-controls" aria-label="Map Studio states">
          ${N2.map(H=>x`
            <button
              type="button"
              aria-pressed=${String(this.scenario===H)}
              @click=${()=>{this.scenario=H}}
            >${H}</button>
          `)}
        </nav>
      `:null}
      <div class="stage">
        <${_0}
          class="shell"
          .state=${this._workspace}
          @matic-workspace-intent=${this.#V}
        ></${_0}>
      </div>
    `}};customElements.get("matic-map-studio-gallery-v0-4-0")||customElements.define("matic-map-studio-gallery-v0-4-0",p5);var T0="/api/matic_robot/slam_entries",x2=24,B0=8,c5=15e5,R0=16*1024*1024,c=class extends Error{constructor(C){super(C),this.name="ContractError",this.code=C}},E=(L,C)=>{if(!L||typeof L!="object"||Array.isArray(L))throw new c(C);return L},P=(L,C,H)=>{if(typeof L!="string")throw new c(H);let V=L.trim();if(!V||Array.from(V).length>C||/[\u0000-\u001f\u007f]/u.test(V))throw new c(H);return V},e4=L=>{if(L==null||L==="")return null;try{return P(L,128,"invalid-floor-label")}catch{return null}},k1=(L,C,H,V)=>{if(typeof L!="number"||!Number.isFinite(L)||L<C||L>H)throw new c(V);return L},U=(L,C,H,V)=>{let e=k1(L,C,H,V);if(!Number.isInteger(e))throw new c(V);return e},m5=(L,C)=>L==null?null:U(L,1,C,"invalid-floor-ordinal"),b=(L,C)=>{if(typeof L!="boolean")throw new c(C);return L},r4=(L,C)=>L===null?null:b(L,C),E0=L=>{if(L==null)return null;let C=P(L,64,"invalid-map-session-key");if(!/^[0-9a-f]{64}$/u.test(C))throw new c("invalid-map-session-key");return C},t4=L=>{if(L==null)return null;if(L==="bootstrap_empty"||L==="map_session_unverified"||L==="floor_plan_unavailable"||L==="floor_plan_mismatch")return L;throw new c("invalid-map-block-reason")},M4=L=>{if(L===void 0)return"not_started";if(L==="not_started"||L==="running"||L==="complete"||L==="partial"||L==="failed")return L;throw new c("invalid-bootstrap-state")},j=(L,C)=>{let H=P(L,512,C);if(!H.startsWith("/")||H.startsWith("//")||H.includes("\\"))throw new c(C);return H},o4=L=>{let C=typeof L.map_health=="string"?L.map_health.toLowerCase():"",H=typeof L.stream_state=="string"?L.stream_state.toLowerCase():"",V=typeof L.invalid_tiles=="number"?L.invalid_tiles:0;return C.includes("error")||C.includes("fail")||C.includes("degrad")||V>0?"problem":L.map_truncated===!0||C.includes("truncat")||C.includes("limit")?"limited":L.map_complete===!0?"ready":H.includes("connect")||H.includes("collect")||H.includes("run")?"building":"unknown"},F0=L=>{let C=E(L,"invalid-catalog");if(!Array.isArray(C.entries)||C.entries.length>64)throw new c("invalid-catalog-entries");return C.entries.map(H=>{let V=E(H,"invalid-catalog-entry"),e=U(V.map_revision,0,Number.MAX_SAFE_INTEGER,"invalid-map-revision");return{entryId:P(V.entry_id,128,"invalid-entry-id"),sceneUrl:j(V.scene_url,"invalid-scene-url"),deltaUrl:V.delta_url===void 0||V.delta_url===null?null:j(V.delta_url,"invalid-delta-url"),poseUrl:j(V.pose_url,"invalid-pose-url"),historyUrl:j(V.history_url,"invalid-history-url"),areasUrl:j(V.areas_url,"invalid-areas-url"),plansUrl:j(V.plans_url,"invalid-plans-url"),mapRevision:e,mapFloorCoherent:b(V.map_floor_coherent,"invalid-floor-coherence"),mapSessionVerified:b(V.map_session_verified,"invalid-session-state"),mapSessionKey:E0(V.map_session_key),mapBlockReason:t4(V.map_block_reason),runnerLocked:b(V.runner_locked,"invalid-runner-lock"),stopSettlePending:b(V.stop_settle_pending,"invalid-stop-settle"),activePlan:b(V.active_plan,"invalid-active-plan"),nativeReconciliationPending:b(V.native_reconciliation_pending,"invalid-native-reconciliation"),nativeSessionActive:r4(V.native_session_active,"invalid-native-session"),mapComplete:b(V.map_complete,"invalid-map-complete"),mapTruncated:b(V.map_truncated,"invalid-map-truncated"),selectedFloorOrdinal:m5(V.selected_floor_ordinal,128),mapFloorOrdinal:m5(V.map_floor_ordinal,128),historyCount:U(V.history_count,0,12,"invalid-history-count"),historyFloorCount:U(V.history_floor_count,0,128,"invalid-floor-count"),health:o4(V),streamFailures:U(V.stream_failures,0,Number.MAX_SAFE_INTEGER,"invalid-stream-failures"),bootstrapState:M4(V.bootstrap_state),bootstrapPhotoSeen:V.bootstrap_photo_seen===void 0?!1:b(V.bootstrap_photo_seen,"invalid-bootstrap-photo"),bootstrapStructureSeen:V.bootstrap_structure_seen===void 0?!1:b(V.bootstrap_structure_seen,"invalid-bootstrap-structure"),bootstrapFailures:V.bootstrap_failures===void 0?0:U(V.bootstrap_failures,0,2,"invalid-bootstrap-failures")}})},D0=(L,C)=>{if(!Array.isArray(L)||L.length!==2)throw new c(C);return[k1(L[0],-1e6,1e6,C),k1(L[1],-1e6,1e6,C)]},i4=(L,C)=>{if(!Array.isArray(L)||L.length<3||L.length>8192)throw new c(C);return L.map(H=>D0(H,C))},$0=(L,C)=>{if(!Array.isArray(L)||L.length>256)throw new c("invalid-rooms");return L.map(H=>{let V=E(H,"invalid-room");return{roomId:P(V.room_id,128,"invalid-room-id"),name:P(V.name,128,"invalid-room-name"),boundary:C?i4(V.boundary,"invalid-room-boundary"):[]}})},a4=L=>{let C=E(L,"invalid-history-snapshot"),H=P(C.created_at,64,"invalid-history-time");if(!Number.isFinite(Date.parse(H)))throw new c("invalid-history-time");return{id:P(C.id,128,"invalid-history-id"),createdAt:H,revision:U(C.revision,0,Number.MAX_SAFE_INTEGER,"invalid-history-revision"),pointCount:U(C.point_count,1,c5,"invalid-history-points"),sceneUrl:j(C.scene_url,"invalid-history-scene-url")}},I0=L=>{let C=E(L,"invalid-history");if(!Array.isArray(C.floors)||C.floors.length<1||C.floors.length>128)throw new c("invalid-history-floors");return{entryId:P(C.entry_id,128,"invalid-history-entry"),liveAvailable:b(C.live_available,"invalid-history-live"),floors:C.floors.map(H=>{let V=E(H,"invalid-history-floor");if(!Array.isArray(V.snapshots)||V.snapshots.length>12)throw new c("invalid-history-snapshots");return{id:P(V.id,128,"invalid-history-floor-id"),active:b(V.active,"invalid-history-floor-active"),readOnly:b(V.read_only,"invalid-history-floor-read-only"),liveAvailable:V.live_available===void 0?!1:b(V.live_available,"invalid-history-floor-live"),label:e4(V.label),ordinal:V.ordinal===void 0?null:m5(V.ordinal,128),snapshots:V.snapshots.map(a4)}})}},W0=L=>{if(L==="vacuum"||L==="mop"||L==="vacuum_and_mop")return L;throw new c("invalid-cleaning-mode")},z0=L=>{if(L==="quick"||L==="standard"||L==="heavy_duty")return L;throw new c("invalid-coverage-setting")},n4=L=>{if(L==null)return null;if(!Array.isArray(L)||L.length<3||L.length>64)throw new c("invalid-area-outline");let C={closed:!0,points:L.map(H=>{let V=E(H,"invalid-area-outline");if(typeof V.x!="number"||typeof V.y!="number")throw new c("invalid-area-outline");return{x:V.x,y:V.y}})};if(!O1(C))throw new c("invalid-area-outline");return C},l4=L=>{let C=E(L,"invalid-area-circle");return{x:k1(C.x,-1e6,1e6,"invalid-area-circle"),y:k1(C.y,-1e6,1e6,"invalid-area-circle"),radius:k1(C.radius,.05,2.5,"invalid-area-circle")}},A4=L=>L==="current"||L==="review"||L==="stale"?L:"unknown",N0=L=>{let C=E(L,"invalid-areas");if(!Array.isArray(C.areas)||C.areas.length>256)throw new c("invalid-area-list");return{sceneUrl:j(C.scene_url,"invalid-area-scene-url"),rooms:$0(C.rooms,!0),areas:C.areas.map(H=>{let V=E(H,"invalid-area");if(!Array.isArray(V.circles)||V.circles.length>512)throw new c("invalid-area-circles");return{id:P(V.id,128,"invalid-area-id"),name:P(V.name,128,"invalid-area-name"),circles:V.circles.map(l4),outline:n4(V.outline),cleaningMode:W0(V.cleaning_mode),coverageSetting:z0(V.coverage_setting),status:A4(V.status),canRebind:b(V.can_rebind,"invalid-area-rebind")}})}},U0=L=>{let C=E(L,"invalid-plans");if(!Array.isArray(C.plans)||C.plans.length>256)throw new c("invalid-plan-list");return{rooms:$0(C.rooms,!1).map(({roomId:V,name:e})=>({roomId:V,name:e})),selectedPlan:C.selected_plan===null||C.selected_plan===void 0?null:P(C.selected_plan,128,"invalid-selected-plan"),plans:C.plans.map(V=>{let e=E(V,"invalid-plan");if(!Array.isArray(e.rooms)||e.rooms.length>256||!Array.isArray(e.room_order))throw new c("invalid-plan-rooms");let r=e.run_behavior;if(r!=="intelligent"&&r!=="ordered")throw new c("invalid-run-behavior");return{id:P(e.id,128,"invalid-plan-id"),name:P(e.name,128,"invalid-plan-name"),enabled:b(e.enabled,"invalid-plan-enabled"),runBehavior:r,rooms:e.rooms.map(t=>{let M=E(t,"invalid-plan-room");return{roomId:P(M.room_id,128,"invalid-plan-room-id"),cleaningMode:W0(M.cleaning_mode),coverageSetting:z0(M.coverage_setting)}}),roomOrder:e.room_order.slice(0,256).map(t=>P(t,128,"invalid-room-order")),returnToBase:b(e.return_to_base,"invalid-return-to-base"),finishCurrentRoom:b(e.finish_current_room,"invalid-finish-room"),finishCurrentRoomThreshold:U(e.finish_current_room_threshold,0,100,"invalid-finish-threshold")}})}},G0=L=>{let C=E(L,"invalid-pose"),H=C.position,V=H===null?null:D0(H,"invalid-pose-position"),e=C.pose_freshness;if(e!=="live"&&e!=="coordinator_fallback")throw new c("invalid-pose-freshness");return{position:V,source:P(C.source,64,"invalid-pose-source"),revision:U(C.revision,0,Number.MAX_SAFE_INTEGER,"invalid-pose-revision"),poseRevision:U(C.pose_revision,0,Number.MAX_SAFE_INTEGER,"invalid-pose-sequence"),floorCoherent:b(C.map_floor_coherent,"invalid-pose-floor"),mapSessionKey:E0(C.map_session_key),freshness:e}},K0=L=>{try{return j(L,"invalid-private-path"),!0}catch{return!1}};var Q0=L=>{let r=()=>{throw new Error("invalid-scene")};(!(L instanceof ArrayBuffer)||L.byteLength<24||L.byteLength>16777216)&&r();let t=new DataView(L),M=new Uint8Array(L,0,8),o=String.fromCharCode(...M),i=t.getUint16(8,!0),a=t.getUint16(10,!0),n=t.getUint32(12,!0),l=t.getUint32(16,!0),A=t.getUint32(20,!0),d=l+A,m=24+n;(o!=="MATIC3D\0"||i!==1||a!==8||n>1024*1024||d<1||d>15e5||m+d*a!==L.byteLength)&&r();let u;try{u=JSON.parse(new TextDecoder("utf-8",{fatal:!0}).decode(new Uint8Array(L,24,n)))}catch{r()}(!u||typeof u!="object"||Array.isArray(u))&&r();let h=u,f=h.meters_per_cell,S=h.origin_cells,O=h.span_cells;(typeof f!="number"||!Number.isFinite(f)||f<.001||f>.1||!Array.isArray(S)||S.length!==2||!S.every(D=>typeof D=="number"&&Number.isFinite(D))||!Array.isArray(O)||O.length!==2||!O.every(D=>typeof D=="number"&&Number.isFinite(D)&&D>=1&&D<=65536))&&r();let Q1=(Array.isArray(h.rooms)?h.rooms.slice(0,128):[]).flatMap((D,n7)=>{if(!D||typeof D!="object"||Array.isArray(D))return[];let M1=D,q1=typeof M1.name=="string"?M1.name.trim():"";if(!q1||Array.from(q1).length>128||/[\u0000-\u001f\u007f]/u.test(q1))return[];if(!Array.isArray(M1.boundary)||M1.boundary.length<3||M1.boundary.length>8192)return[];let f5=M1.boundary.flatMap(P2=>{if(!Array.isArray(P2)||P2.length!==2)return[];let[_2,T2]=P2;return typeof _2=="number"&&Number.isFinite(_2)&&typeof T2=="number"&&Number.isFinite(T2)?[[_2,T2]]:[]}),O2=M1.center;if(f5.length<3||!Array.isArray(O2)||O2.length!==2)return[];let[w2,k2]=O2;return typeof w2!="number"||!Number.isFinite(w2)||typeof k2!="number"||!Number.isFinite(k2)?[]:[{id:`scene-room-${n7+1}`,name:q1,boundary:f5,center:[w2,k2]}]}),a7=typeof h.sample_step=="number"&&Number.isInteger(h.sample_step)?Math.max(1,Math.min(15e5,h.sample_step)):1,Z5=S,S5=O;return{buffer:L,pointOffset:m,floorCount:l,surfaceCount:A,total:d,metadata:{metersPerCell:f,origin:[Z5[0],Z5[1]],span:[S5[0],S5[1]],sampleStep:a7,rooms:Q1}}},s4=L=>{if(L.byteLength>R0||L.byteLength<x2||B0!==8||c5!==15e5)throw new c("invalid-scene");try{return Q0(L)}catch{throw new c("invalid-scene")}},d4=()=>`
  const parseTransfer = ${Q0.toString()};
  self.onmessage = (event) => {
    const { id, buffer } = event.data;
    try {
      const parsed = parseTransfer(buffer);
      self.postMessage({ id, ok: true, parsed }, [parsed.buffer]);
    } catch (_) {
      self.postMessage({ id, ok: false, problem: "invalid-scene" });
    }
  };
`,h2=class{#C=null;#H=null;#V=0;#e=new Map;constructor(){if(!(typeof Worker!="function"||typeof URL?.createObjectURL!="function"))try{this.#H=URL.createObjectURL(new Blob([d4()],{type:"text/javascript"})),this.#C=new Worker(this.#H),this.#C.onmessage=C=>{let H=this.#e.get(C.data.id);H&&(this.#e.delete(C.data.id),C.data.ok&&C.data.parsed?H.resolve(C.data.parsed):H.reject(new c(C.data.problem||"invalid-scene")))},this.#C.onerror=()=>this.#r("scene-worker-failed")}catch{this.#C=null,this.#H&&URL.revokeObjectURL(this.#H),this.#H=null}}async parse(C,H){if(H?.aborted)throw new DOMException("Aborted","AbortError");if(!this.#C){if(await new Promise(e=>window.setTimeout(e,0)),H?.aborted)throw new DOMException("Aborted","AbortError");return s4(C)}let V=++this.#V;return new Promise((e,r)=>{let t=()=>{this.#e.delete(V),r(new DOMException("Aborted","AbortError"))};H?.addEventListener("abort",t,{once:!0}),this.#e.set(V,{resolve:M=>{H?.removeEventListener("abort",t),e(M)},reject:M=>{H?.removeEventListener("abort",t),r(M)}}),this.#C?.postMessage({id:V,buffer:C},[C])})}#r(C){for(let H of this.#e.values())H.reject(new c(C));this.#e.clear(),this.#C?.terminate(),this.#C=null}dispose(){this.#r("scene-parser-disposed"),this.#H&&URL.revokeObjectURL(this.#H),this.#H=null}};var J={catalog:1e4,scene:6e4,delta:35e3,pose:1e4,history:15e3,workflow:15e3,mutation:2e4},F=class extends Error{constructor(C,H=null){super(C),this.name="BackendError",this.code=C,this.status=H}},G1=36,P1=16*1024*1024,q0=(L,C)=>{let H=Number(L);if(!Number.isSafeInteger(H)||H<0)throw new c(C);return H},X0=(L,C)=>{let H=L.headers.get("X-Matic-Revision");if(H===null)return C;let V=Number(H);if(!Number.isSafeInteger(V)||V<0)throw new c("invalid-scene-revision");return V},Y0=(L,C)=>{let H=L.headers.get("X-Matic-Floor-Coherent");if(H===null)return C;if(H==="1")return!0;if(H==="0")return!1;throw new c("invalid-scene-floor-header")},Z2=class{#C;#H=new h2;constructor(C){this.#C=C}async#V(C,H){let V=C.body?.getReader();if(!V)return new ArrayBuffer(0);let e=()=>{V.cancel().catch(()=>{})};H.addEventListener("abort",e,{once:!0});try{if(H.aborted)throw e(),new DOMException("Aborted","AbortError");let r=[],t=0;for(;;){let i=await V.read();if(H.aborted)throw new DOMException("Aborted","AbortError");if(i.done)break;r.push(i.value),t+=i.value.byteLength}let M=new Uint8Array(t),o=0;for(let i of r)M.set(i,o),o+=i.byteLength;return M.buffer}finally{H.removeEventListener("abort",e),V.releaseLock()}}async#e(C,H,V,e,r){if(!K0(C))throw new F("invalid-private-path");if(e?.aborted)throw new DOMException("Aborted","AbortError");let t=new AbortController,M=()=>{},o=new Promise((l,A)=>{M=A}),i=()=>{t.abort(),M(new DOMException("Aborted","AbortError"))};e?.addEventListener("abort",i,{once:!0});let a=!1,n=window.setTimeout(()=>{a=!0,i()},V);try{let l=this.#C(),A=new Headers(H.headers),d={...H,cache:"no-store",credentials:"same-origin",headers:Object.fromEntries(A.entries()),signal:t.signal},m=async()=>{let u;if(typeof l?.fetchWithAuth=="function")u=await l.fetchWithAuth(C,d);else{let h=l?.auth?.accessToken||l?.auth?.data?.access_token;h&&A.set("Authorization",`Bearer ${h}`);let f=typeof l?.hassUrl=="function"?l.hassUrl(C):C;u=await fetch(f,{...d,headers:A})}try{if(t.signal.aborted)throw new DOMException("Aborted","AbortError");return await r(u,t.signal)}finally{u.body&&!u.body.locked&&u.body.cancel().catch(()=>{})}};return await Promise.race([m(),o])}catch(l){throw a&&!e?.aborted?new F("request-timeout"):t.signal.aborted?new DOMException("Aborted","AbortError"):l}finally{window.clearTimeout(n),e?.removeEventListener("abort",i)}}async#r(C,H,V,e={}){return this.#e(C,{...e,headers:{Accept:"application/json",...e.headers||{}}},H,V,async(r,t)=>{if(!r.ok){let M=r.headers.get("X-Matic-Plans-Conflict");throw new F(M==="map-rechecking"?"map-rechecking":"request-failed",r.status)}try{return JSON.parse(new TextDecoder().decode(await this.#V(r,t)))}catch{throw new c("invalid-json-response")}})}async catalog(C){return F0(await this.#r(T0,J.catalog,C))}async scene(C,H,V,e,r,t){let M=new Headers({Accept:"application/vnd.matic.slam-scene"});return e==="live"&&M.set("X-Matic-Prefer-Cached","1"),t&&M.set("If-None-Match",t),this.#e(C,{headers:M},J.scene,r,async(o,i)=>{let a=X0(o,H),n=Y0(o,V);if(o.status===304)return{scene:null,floorCoherent:n,revision:a,notModified:!0};if(!o.ok)throw new F("scene-request-failed",o.status);if(o.headers.get("Content-Type")?.split(";",1)[0]!=="application/vnd.matic.slam-scene")throw new c("invalid-scene-content-type");return{scene:{...await this.#H.parse(await this.#V(o,i),i),revision:a,etag:o.headers.get("ETag"),source:e},floorCoherent:n,revision:a,notModified:!1}})}async#L(C,H,V){if(!Number.isSafeInteger(H)||H<1||H>P1||typeof DecompressionStream!="function")throw new c("invalid-scene-delta");let r=new Blob([C]).stream().pipeThrough(new DecompressionStream("deflate")).getReader(),t=new Uint8Array(H),M=0,o=()=>{r.cancel()};V?.addEventListener("abort",o,{once:!0});try{for(;;){if(V?.aborted)throw new DOMException("Aborted","AbortError");let{done:i,value:a}=await r.read();if(i)break;if(!(a instanceof Uint8Array)||M+a.byteLength>H)throw new c("invalid-scene-delta");t.set(a,M),M+=a.byteLength}}finally{V?.removeEventListener("abort",o),r.releaseLock()}if(M!==H)throw new c("invalid-scene-delta");return t}async#o(C,H,V){if(C.byteLength<G1||C.byteLength>G1+P1||H.buffer.byteLength>P1)throw new c("invalid-scene-delta");let e=new DataView(C),r=new TextDecoder().decode(new Uint8Array(C,0,8)),t=e.getUint16(8,!0),M=e.getUint16(10,!0),o=q0(e.getBigUint64(12,!0),"invalid-scene-delta"),i=q0(e.getBigUint64(20,!0),"invalid-scene-delta"),a=e.getUint32(28,!0),n=e.getUint32(32,!0);if(r!=="MATICDLT"||t!==1||M!==1||o!==H.revision||i<=H.revision||a<x2||a>P1||n>P1||n+G1!==C.byteLength)throw new c("invalid-scene-delta");let l=new Uint8Array(C,G1,n),A=new Uint8Array(H.buffer),m=(await this.#L(l,Math.max(A.byteLength,a),V)).slice(),u=1024*1024;for(let S=0;S<A.byteLength;S+=u){if(V?.aborted)throw new DOMException("Aborted","AbortError");let O=Math.min(A.byteLength,S+u);for(let g=S;g<O;g+=1)m[g]=(m[g]??0)^(A[g]??0);O<A.byteLength&&await new Promise(g=>window.setTimeout(g,0))}let h=m.slice(0,a).buffer;return{parsed:{...await this.#H.parse(h,V),revision:i,etag:null,source:"live"},revision:i}}async sceneDelta(C,H,V,e){let r=C.includes("?")?"&":"?";return this.#e(`${C}${r}since=${encodeURIComponent(H.revision)}`,{headers:{Accept:"application/vnd.matic.slam-delta, application/vnd.matic.slam-scene"}},J.delta,e,async(t,M)=>{let o=X0(t,H.revision),i=Y0(t,V);if(t.status===204){if(o!==H.revision)throw new c("invalid-scene-delta-revision");return{scene:null,floorCoherent:i,revision:o,notModified:!0}}if(!t.ok)throw new F("delta-request-failed",t.status);if(o<=H.revision)throw new c("invalid-scene-delta-revision");let a=Number(t.headers.get("Content-Length"));if(Number.isFinite(a)&&a>G1+P1)throw new c("invalid-scene-delta-size");let n=t.headers.get("Content-Type")?.split(";",1)[0],l=await this.#V(t,M);if(n==="application/vnd.matic.slam-delta"){let d=Number(t.headers.get("X-Matic-Base-Revision"));if(!Number.isSafeInteger(d)||d!==H.revision)throw new c("invalid-scene-delta-base");let m=await this.#o(l,H,M);if(m.revision!==o)throw new c("invalid-scene-delta-revision");return{scene:{...m.parsed,etag:t.headers.get("ETag")},floorCoherent:i,revision:o,notModified:!1}}if(n!=="application/vnd.matic.slam-scene")throw new c("invalid-scene-delta-content-type");return{scene:{...await this.#H.parse(l,M),revision:o,etag:t.headers.get("ETag"),source:"live"},floorCoherent:i,revision:o,notModified:!1}})}async pose(C,H){return G0(await this.#r(C,J.pose,H))}async history(C,H){return I0(await this.#r(C,J.history,H))}async plans(C,H){return U0(await this.#r(C,J.workflow,H))}async areas(C,H){return N0(await this.#r(C,J.workflow,H))}async saveArea(C,H,V){let e=await this.#r(C,J.mutation,V,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...H.areaId?{area_id:H.areaId}:{},name:H.name,circles:H.circles,...H.outline?.closed?{outline:H.outline.points}:{},cleaning_mode:H.cleaningMode,coverage_setting:H.coverageSetting})});if(!e||typeof e!="object"||typeof e.id!="string")throw new c("invalid-area-save-response");return e.id}async deleteArea(C,H,V){await this.#e(`${C}?area_id=${encodeURIComponent(H)}`,{method:"DELETE",headers:{Accept:"application/json"}},J.mutation,V,async e=>{if(!e.ok)throw new F("area-delete-failed",e.status)})}async service(C,H,V,e){let r=this.#C();if(typeof r?.callService!="function")throw new F("service-unavailable");await r.callService(C,H,V,{entity_id:e})}dispose(){this.#H.dispose()}};var J0=()=>({version:4,view:"top",appearance:"photo",labels:!0,quality:"auto",cameras:{}}),K1=(L,C,H)=>Math.max(C,Math.min(H,L)),C7=L=>L.replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",v5=(L,C=4)=>`matic-map-studio:v${C}:${C7(L)}`,p4=L=>{if(!L||typeof L!="object")return null;let C=L;return["yaw","pitch","zoom","targetX","targetZ"].every(V=>typeof C[V]=="number"&&Number.isFinite(C[V]))?{yaw:K1(C.yaw,-Math.PI,Math.PI),pitch:K1(C.pitch,.18,Math.PI/2-.018),zoom:K1(C.zoom,.01,100),targetX:K1(C.targetX,-1e4,1e4),targetZ:K1(C.targetZ,-1e4,1e4)}:null},j0=L=>{let C=J0();if(!L||typeof L!="object")return C;let H=L,V=H.view==="three"||H.view==="top"||H.view==="rooms"?H.view:C.view,e=V==="rooms"?"top":V,r=H.quality==="auto"||H.quality==="efficient"||H.quality==="balanced"||H.quality==="maximum"?H.quality:C.quality,t=H.cameras&&typeof H.cameras=="object"?H.cameras:{},M={};for(let o of["three","top"]){let i=p4(t[o]);i&&(M[o]=i)}return{version:4,view:e,appearance:H.appearance==="rooms"||H.appearance==="photo"?H.appearance:C.appearance,labels:typeof H.labels=="boolean"?H.labels:C.labels,quality:r,cameras:M}},S2=class{#C="local-user";#H=null;#V=null;load(C){this.#e(),this.#C=C7(C);try{let H=window.localStorage.getItem(v5(this.#C));if(H)return j0(JSON.parse(H));for(let V of[3,2]){let e=window.localStorage.getItem(v5(this.#C,V));if(e)return j0(JSON.parse(e))}}catch{}return J0()}schedule(C){this.#H!==null&&window.clearTimeout(this.#H),this.#V={key:v5(this.#C),value:C},this.#H=window.setTimeout(()=>this.#e(),250)}#e(){this.#H!==null&&window.clearTimeout(this.#H),this.#H=null;let C=this.#V;if(this.#V=null,!!C)try{window.localStorage.setItem(C.key,JSON.stringify(C.value))}catch{}}dispose(){this.#e()}},H7="matic-map-studio:preferred-frontend",V7=()=>{try{return window.localStorage.getItem(H7)==="v3"?"v3":"v4"}catch{return"v4"}},u5=L=>{try{return window.localStorage.setItem(H7,L),!0}catch{return!1}};var v=(L,C,H=null)=>({status:L,value:C,problem:H}),G=L=>L instanceof DOMException&&L.name==="AbortError",c1=(L,C)=>L instanceof F||L&&typeof L=="object"&&"code"in L&&typeof L.code=="string"?L.code:C,f2=L=>[L.selectedFloorOrdinal??"none",L.mapFloorOrdinal??"none",L.mapFloorCoherent?"coherent":"transition"].join(":"),g2=L=>[L.mapFloorOrdinal??"none",L.mapSessionVerified?"verified":"unverified",L.mapSessionKey??"no-session"].join(":"),K=L=>[L.entryId,L.selectedFloorOrdinal??"none",L.mapFloorOrdinal??"none"].join("|"),L7=L=>[L.entryId,f2(L),g2(L),L.mapRevision].join("|"),e7=L=>L.runnerLocked||L.stopSettlePending||L.activePlan||L.nativeReconciliationPending||L.nativeSessionActive===!0,m4=(L,C)=>L.entryKey===C.entryKey&&L.generation===C.generation&&L.floorKey===C.floorKey&&L.missionKey===C.missionKey,r7="Live map updates paused while the current map is rechecked.",t7="Reconnecting. The last verified map remains read only.",c4=1e3,v4=["rooms","plan","draw","areaReview"],x5=(L,C)=>L.label?L.label:L.active?"Current floor":`Saved floor ${L.ordinal??C}`,y2=class{#C;#H=new X1;#V;#e=new S2;#r=new Map;#L=null;#o;#i=null;#a=null;#A=null;#u=0;#M=!1;#y=!1;#h=!1;#n=Promise.resolve();#v=!1;#l=!1;#p="";#s=0;#S="";#t=!1;#x=!0;constructor(C,H){this.#C=C,this.#V=H}sync(C,H){if(this.#t)return;let V=this.#C.value.owner;V&&(V.entryKey!==C.entryKey||V.userKey!==C.userKey)&&(this.#O("context-changed"),this.#M&&(this.#h=!0));let e=this.#x;if(this.#x=C.host.connected,this.#L=C,this.#o=H,this.#C.patch({owner:{userKey:C.userKey,entryKey:C.entryKey},host:C.host,activity:C.activity,batteryPercent:C.batteryPercent,robotLabel:C.robotLabel,robots:C.robots,locale:C.language}),C.userKey!==this.#S){this.#S=C.userKey;let r=this.#e.load(C.userKey);this.#C.patch({view:r.view,appearance:r.appearance,labelsVisible:r.labels,quality:r.quality,cameras:r.cameras})}if(!C.host.administrator){this.#d(),this.#O("access-required");return}if(!C.host.connected){this.#d(),this.#h=!1,this.#l=!1,this.#Z();let r=this.#C.value,t=r.resources.scene.value;this.#C.patch({coherence:t?"degraded":"unavailable",resources:{...r.resources,catalog:r.resources.catalog.status==="loading"?v("idle",r.resources.catalog.value):r.resources.catalog,plans:r.resources.plans.status==="loading"?v("idle",r.resources.plans.value):r.resources.plans,areas:r.resources.areas.status==="loading"?v("idle",r.resources.areas.value):r.resources.areas,pose:v("idle",null)},map:{...r.map,available:t!==null,exactPose:!1},notice:t?{tone:"warning",text:t7}:r.notice});return}if(C.host.robotCount===0){this.#d(),this.#O("map-unavailable");return}if(this.#f(),!e){this.#C.value.notice?.text===t7&&this.#C.patch({notice:null}),this.refreshCatalog(!0);return}(this.#C.value.resources.catalog.status==="idle"||C.entryKey&&C.entryKey!==this.#C.value.selection.entryId)&&this.refreshCatalog(!0)}schedulePreferences(C){this.#e.schedule(C)}#f(){this.#i===null&&(this.#i=window.setInterval(()=>{document.visibilityState==="visible"&&this.refreshCatalog()},5e3)),this.#a===null&&(this.#a=window.setInterval(()=>{document.visibilityState==="visible"&&this.refreshPose()},c4))}#d(){this.#i!==null&&window.clearInterval(this.#i),this.#a!==null&&window.clearInterval(this.#a),this.#i=null,this.#a=null}#m(C){this.#r.get(C)?.abort();let H=new AbortController;return this.#r.set(C,H),H}#c(C,H){this.#r.get(C)===H&&this.#r.delete(C)}#Z(C=[]){let H=!1;for(let[V,e]of this.#r)C.includes(V)||(H||=V==="plan-mutation"||V==="area-mutation",e.abort(),this.#r.delete(V));H&&this.#C.value.command==="pending"&&this.#C.patch({command:"idle",notice:null})}#w(){this.#u+=1,this.#A!==null&&window.clearTimeout(this.#A),this.#A=null}#O(C){this.#w(),this.#Z(),this.#H.invalidate(),this.#p="";let H=this.#C.value,V=y();this.#C.patch({command:"idle",dataMode:V.dataMode,floor:V.floor,managedLock:!1,workflow:"none",dialog:null,notice:null,draftFloorOrdinal:null,draw:V.draw,planDraft:V.planDraft,areaDraft:V.areaDraft,generation:this.#H.generation,coherence:H.host.administrator?"unavailable":"blocked",fullMap:!1,precisionOpen:!1,resources:{catalog:v("error",null,C),entry:null,scene:v("idle",null),pose:v("idle",null),history:v("idle",null),plans:v("idle",null),areas:v("idle",null)},map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1},selection:{...V.selection,entryId:null,floorId:"current",historyId:null}})}async refreshCatalog(C=!1){if(this.#t||!this.#L?.host.administrator||!this.#L.host.connected||this.#L.host.robotCount===0)return;if(this.#M)return C&&!this.#y&&(this.#h=!0,this.#r.get("catalog")?.abort()),this.#n;this.#M=!0,this.#y=C;let H;this.#n=new Promise(r=>{H=r});let V=this.#m("catalog"),e=this.#C.value.resources.catalog.value;this.#C.patch({resources:{...this.#C.value.resources,catalog:v("loading",e)}});try{let r=await this.#V.catalog(V.signal);if(V.signal.aborted||this.#t)return;let t=this.#o?.config?.entry_id,M=typeof t=="string"?t:null,o=r.find(n=>n.entryId===this.#L?.entryKey)||r.find(n=>n.entryId===M)||r[0]||null,i=this.#C.value.resources.entry;if(o&&i&&K(o)===K(i)&&f2(o)===f2(i)&&g2(o)===g2(i)&&o.mapRevision<i.mapRevision&&(o={...o,mapRevision:i.mapRevision}),this.#C.patch({managedLock:o?e7(o):!1,resources:{...this.#C.value.resources,catalog:v(r.length?"ready":"empty",r),entry:o}}),!o){this.#O("no-loaded-robot");return}if(this.#C.value.selection.floorId!=="current"&&!C)return;let a=L7(o);if(!C&&a===this.#p){let n=this.#C.value,l=o.mapFloorCoherent&&o.mapSessionVerified,A=o.health==="problem"||o.health==="limited";this.#C.patch({coherence:l?A?"degraded":"current":"verifying",map:{...n.map,available:l&&n.resources.scene.value!==null,complete:o.mapComplete&&!o.mapTruncated,floorCoherent:o.mapFloorCoherent,sessionVerified:o.mapSessionVerified,exactPose:l?n.map.exactPose:!1},floor:{...n.floor,classifiedCount:Math.max(1,o.historyFloorCount)}}),l&&this.#C.value.resources.plans.problem==="map-rechecking"&&this.loadPlans();return}this.#p=a,this.#E(o,i)}catch(r){if(G(r))return;this.#C.patch({coherence:this.#C.value.resources.scene.value?"degraded":"unavailable",resources:{...this.#C.value.resources,catalog:v("error",e,c1(r,"catalog-unavailable"))}})}finally{this.#c("catalog",V),this.#M=!1;let r=this.#h;this.#y=!1;try{r&&!this.#t&&(this.#h=!1,await this.refreshCatalog(!0))}finally{H()}}}#E(C,H){let V=this.#C.value,e=!!(H&&K(H)===K(C)),r=C.mapFloorCoherent&&C.mapSessionVerified;this.#Z(e?["catalog","plans","areas","plan-mutation","area-mutation"]:["catalog"]);let t=e?V.resources.scene.value:null,M=V.resources.pose.value,o=e&&r&&C.mapSessionKey!==null&&M?.position&&M.mapSessionKey===C.mapSessionKey?M:null,i=this.#H.begin(C.entryId,f2(C),g2(C),C.mapRevision),a=V.draftFloorOrdinal??(H?.mapFloorCoherent&&H.mapSessionVerified?H.mapFloorOrdinal:null),n=r?C.mapFloorOrdinal:null,l=H!==null&&H.entryId!==C.entryId||a!==null&&n!==null&&a!==n;l&&this.#w();let A=y(),d=C.health==="problem"||C.health==="limited",m=this.#C.value;this.#C.patch({...l?{command:"idle",workflow:"none",dialog:null,precisionOpen:!1,fullMap:!1,draw:A.draw,planDraft:A.planDraft,areaDraft:A.areaDraft,notice:{tone:"info",text:"The active map changed. Choose a task on this map."}}:{},draftFloorOrdinal:n??a,managedLock:e7(C),generation:i.generation,coherence:r?d?"degraded":"current":"verifying",dataMode:"live",resources:{...m.resources,entry:C,scene:v(r?"loading":"idle",t),pose:v(r?"loading":"idle",o),history:v("loading",m.resources.history.value),plans:e?m.resources.plans:v("idle",null),areas:e?m.resources.areas:v("idle",null)},map:{available:r&&t!==null,complete:C.mapComplete&&!C.mapTruncated,floorCoherent:C.mapFloorCoherent,sessionVerified:C.mapSessionVerified,exactPose:r&&o!==null},floor:{classifiedCount:Math.max(1,C.historyFloorCount),displayName:C.selectedFloorOrdinal?`Floor ${C.selectedFloorOrdinal}`:"Current floor",readOnly:!1},selection:{...m.selection,entryId:C.entryId,floorId:"current",historyId:null,roomIds:l?[]:m.selection.roomIds,roomSettings:l?[]:m.selection.roomSettings,planId:l?null:m.selection.planId,areaId:l?null:m.selection.areaId}}),this.#P(C,i),r&&this.#C.value.resources.plans.status==="idle"&&this.loadPlans(),r&&(this.#k(C,i),this.#g(C,i))}async#k(C,H){let V=this.#m("scene");try{let e=await this.#V.scene(C.sceneUrl,C.mapRevision,C.mapFloorCoherent,"live",V.signal);if(!this.#H.accepts(H)||e.revision!==H.revision||!e.floorCoherent||!e.scene)return;let r=this.#C.value;this.#C.patch({resources:{...r.resources,scene:v("ready",e.scene)},map:{...r.map,available:!0},notice:r.notice?.text===r7?null:r.notice});let t=this.#C.value.resources.plans;if((t.status==="idle"||t.problem==="map-rechecking")&&this.loadPlans(),C.deltaUrl){let M=++this.#s;this.#R(C,H,e.scene,M)}}catch(e){if(G(e)||!this.#H.accepts(H))return;if(e instanceof F&&e.code==="request-timeout"){let o=this.#C.value;this.#C.patch({resources:{...o.resources,scene:v("loading",o.resources.scene.value,"scene-building")}}),window.setTimeout(()=>{this.#t||!this.#H.accepts(H)||this.#C.value.selection.floorId!=="current"||this.#k(C,H)},250);return}let r=this.#C.value,t=r.resources.pose.value,M=r.resources.scene.value!==null&&C.mapSessionKey!==null&&t?.position!==null&&t?.mapSessionKey===C.mapSessionKey;this.#C.patch({coherence:"degraded",resources:{...r.resources,scene:v("error",r.resources.scene.value,c1(e,"scene-unavailable"))},map:{...r.map,available:r.resources.scene.value!==null,exactPose:M}})}finally{this.#c("scene",V)}}async#R(C,H,V,e){if(!C.deltaUrl||typeof DecompressionStream!="function")return;let r=C.deltaUrl,t=C,M=H,o=V;try{for(;!this.#t&&e===this.#s&&this.#H.accepts(M)&&this.#C.value.selection.floorId==="current";){let i=this.#m("delta");try{let a=await this.#V.sceneDelta(r,o,t.mapFloorCoherent,i.signal);if(i.signal.aborted||this.#t||e!==this.#s||!this.#H.accepts(M))return;if(!a.floorCoherent){this.#C.patch({coherence:"verifying",map:{...this.#C.value.map,available:!1,floorCoherent:!1,exactPose:!1},resources:{...this.#C.value.resources,pose:v("idle",null)}}),this.#p="",this.refreshCatalog(!0);return}if(a.notModified||!a.scene){await new Promise(A=>window.setTimeout(A,100));continue}let n=this.#H.advance(M,a.revision);if(!n)return;M=n,o=a.scene,t={...t,mapRevision:a.revision},this.#p=L7(t);let l=this.#C.value;this.#C.patch({resources:{...l.resources,entry:t,scene:v("ready",o)},map:{...l.map,available:!0,floorCoherent:!0}}),this.#g(t,M)}finally{this.#c("delta",i)}}}catch(i){if(G(i)||this.#t||e!==this.#s||!this.#H.accepts(M))return;this.#C.patch({coherence:"degraded",notice:{tone:"warning",text:r7}}),this.#p="",this.refreshCatalog(!0)}}async#P(C,H){let V=this.#m("history");try{let e=await this.#V.history(C.historyUrl,V.signal);if(!this.#H.accepts(H)||e.entryId!==C.entryId)return;let r=this.#C.value,t=e.floors.find(i=>i.id===r.selection.floorId),M=!r.selection.historyId||t?.snapshots.some(i=>i.id===r.selection.historyId),o=r.dataMode==="live"?e.floors.find(i=>i.active):t;if(this.#C.patch({resources:{...this.#C.value.resources,history:v("ready",e)},floor:{...this.#C.value.floor,classifiedCount:e.floors.length,...o?{displayName:x5(o,1)}:{}}}),r.dataMode==="history"&&(!t||!M)){let i=t||e.floors.find(n=>n.active)||e.floors[0],a=this.selectFloor(i?.id||"current");!this.#t&&r.workflow==="history"&&this.#C.dispatch({type:"open-workflow",workflow:"history"}),await a}}catch(e){if(G(e)||!this.#H.accepts(H))return;this.#C.patch({resources:{...this.#C.value.resources,history:v("error",null,c1(e,"history-unavailable"))}})}finally{this.#c("history",V)}}async refreshPose(){let C=this.#C.value.resources.entry,H=this.#H.current();!C||!H||this.#C.value.selection.floorId!=="current"||!C.mapFloorCoherent||!C.mapSessionVerified||await this.#g(C,H)}async#g(C,H){if(this.#t||!this.#x||!this.#L?.host.connected)return;if(this.#v){this.#l=!0;return}this.#v=!0;let V=this.#m("pose");try{let e=await this.#V.pose(C.poseUrl,V.signal),r=this.#H.current(),t=this.#C.value.resources.entry;if(!r||!m4(H,r)||!t||!e.floorCoherent)return;if(e.mapSessionKey===null||e.mapSessionKey!==t.mapSessionKey){this.#C.patch({resources:{...this.#C.value.resources,pose:v("idle",null)},map:{...this.#C.value.map,exactPose:!1}}),this.#p="",this.refreshCatalog(!0);return}let M=this.#C.value,o=M.resources.pose.value,i=!!(M.map.exactPose&&o?.position&&o.mapSessionKey===t.mapSessionKey);if(e.position===null&&i){this.#C.patch({resources:{...M.resources,pose:v("ready",o)}});return}this.#C.patch({resources:{...M.resources,pose:v("ready",e)},map:{...M.map,exactPose:e.position!==null}})}catch(e){if(G(e)||!this.#H.accepts(H))return;let r=this.#C.value,t=r.resources.pose.value,M=!!(r.map.exactPose&&t?.position&&t.mapSessionKey===r.resources.entry?.mapSessionKey);this.#C.patch({resources:{...r.resources,pose:v("error",M?t:null,c1(e,"pose-unavailable"))},map:{...r.map,exactPose:M}})}finally{if(this.#c("pose",V),this.#v=!1,this.#l&&!this.#t&&this.#x&&this.#L?.host.connected&&this.#L.host.administrator&&this.#L.host.robotCount>0){this.#l=!1;let e=this.#C.value.resources.entry,r=this.#H.current();e&&r&&this.#g(e,r)}else this.#l=!1}}async selectFloor(C){let H=this.#C.value.resources.history.value,V=this.#C.value.resources.entry;if(!H||!V)return;let e=H.floors.find(o=>o.id===C);if(!e&&C!=="current")return;let r=this.#C.value;if(r.workflow==="draw"&&(r.draw.dirty||r.areaDraft.dirty)||r.workflow==="areaReview"&&(r.draw.dirty||r.areaDraft.dirty))return;if(!e||e.active){this.#p="";let o=this.#C.value;this.#C.patch({resources:{...o.resources,plans:v("idle",null),areas:v("idle",null),scene:v("idle",null),pose:v("idle",null)},map:{...o.map,available:!1,exactPose:!1},coherence:"verifying",floor:{...o.floor,readOnly:!1,displayName:"Current floor"},workflow:"none",precisionOpen:!1}),this.#C.dispatch({type:"set-floor",floorId:"current"}),await this.refreshCatalog(!0);return}let t=e.snapshots.at(-1);this.#Z(["catalog"]);let M=this.#H.begin(V.entryId,e.id,t?.id||e.id,t?.revision||0);this.#C.patch({generation:M.generation,coherence:"current",dataMode:"history",floor:{classifiedCount:H.floors.length,displayName:x5(e,H.floors.indexOf(e)+1),readOnly:!0},selection:{...this.#C.value.selection,floorId:e.id,historyId:t?.id||null},resources:{...this.#C.value.resources,scene:v(t?"loading":"empty",null),pose:v("idle",null),plans:v("idle",null),areas:v("idle",null)},workflow:"none",precisionOpen:!1,map:{available:!1,complete:!0,floorCoherent:!0,sessionVerified:!0,exactPose:!1}}),t&&await this.#T(t,M)}async selectHistory(C){let H=this.#C.value.resources.history.value,V=this.#C.value.resources.entry;if(!H||!V)return;if(!C){await this.selectFloor("current");return}let e=H.floors.find(M=>M.snapshots.some(o=>o.id===C)),r=e?.snapshots.find(M=>M.id===C);if(!e||!r)return;let t=this.#H.begin(V.entryId,e.id,r.id,r.revision);this.#Z(["catalog"]),this.#C.patch({generation:t.generation,dataMode:"history",floor:{classifiedCount:H.floors.length,displayName:x5(e,H.floors.indexOf(e)+1),readOnly:!0},selection:{...this.#C.value.selection,floorId:e.id,historyId:r.id},resources:{...this.#C.value.resources,scene:v("loading",null),pose:v("idle",null)},map:{...this.#C.value.map,available:!1,exactPose:!1}}),await this.#T(r,t)}async#T(C,H){let V=this.#m("history-scene");try{let e=await this.#V.scene(C.sceneUrl,C.revision,!0,"history",V.signal);if(!this.#H.accepts(H)||!e.scene)return;this.#C.patch({resources:{...this.#C.value.resources,scene:v("ready",e.scene)},map:{...this.#C.value.map,available:!0,exactPose:!1}})}catch(e){if(G(e)||!this.#H.accepts(H))return;this.#C.patch({resources:{...this.#C.value.resources,scene:v("error",null,c1(e,"history-scene-unavailable"))}})}finally{this.#c("history-scene",V)}}async openWorkflow(C){let H=this.#C.value;if((H.dataMode==="history"||H.floor.readOnly)&&v4.includes(C))return;let V=this.#C.value.workflow;if(C==="draw"&&V!=="draw"&&V!=="areaReview"&&this.selectArea(null),this.#C.dispatch({type:"open-workflow",workflow:C}),C==="history"){let e=this.#C.value.resources.entry,r=this.#H.current();e&&r&&(this.#C.patch({resources:{...this.#C.value.resources,history:v("loading",this.#C.value.resources.history.value)}}),await this.#P(e,r))}(C==="plan"||C==="rooms")&&await this.loadPlans(),(C==="draw"||C==="areaReview")&&await this.loadAreas()}async loadPlans(){let C=this.#C.value.resources.entry;if(!C||!this.#H.current()||!R2(this.#C.value)||this.#C.value.resources.plans.status==="loading")return;let H=K(C),V=this.#m("plans");this.#C.patch({resources:{...this.#C.value.resources,plans:v("loading",null)}});try{let e=await this.#V.plans(C.plansUrl,V.signal),r=this.#C.value.resources.entry;if(V.signal.aborted||this.#t||!r||K(r)!==H)return;if(this.#C.value.planDraft.dirty){this.#C.patch({resources:{...this.#C.value.resources,plans:v("ready",e)}});return}let t=e.selectedPlan||e.plans[0]?.id||null,M=e.plans.find(o=>o.id===t);this.#C.patch({resources:{...this.#C.value.resources,plans:v("ready",e)},selection:{...this.#C.value.selection,planId:t},planDraft:M?this.#B(M):{...this.#C.value.planDraft,id:null,name:"",rooms:[],dirty:!1}})}catch(e){let r=this.#C.value.resources.entry;if(G(e)||V.signal.aborted||this.#t||!r||K(r)!==H)return;let t=e instanceof F&&e.code==="map-rechecking"?"map-rechecking":c1(e,"plans-unavailable");this.#C.patch({resources:{...this.#C.value.resources,plans:v("error",null,t)}})}finally{this.#c("plans",V)}}selectPlan(C){let H=this.#C.value.resources.plans.value?.plans.find(V=>V.id===C);this.#C.patch({selection:{...this.#C.value.selection,planId:C},planDraft:H?this.#B(H):{...this.#C.value.planDraft,id:null,name:"",rooms:[],dirty:!1}})}#B(C){return{id:C.id,name:C.name,enabled:C.enabled,runBehavior:C.runBehavior,rooms:(C.roomOrder.length?C.roomOrder.flatMap(H=>{let V=C.rooms.find(e=>e.roomId===H);return V?[V]:[]}):C.rooms).map(H=>({...H})),returnToBase:C.returnToBase,finishCurrentRoom:C.finishCurrentRoom,finishCurrentRoomThreshold:C.finishCurrentRoomThreshold,dirty:!1}}async loadAreas(){let C=this.#C.value.resources.entry;if(!C||!this.#H.current()||!R2(this.#C.value))return;let H=K(C),V=this.#m("areas");this.#C.patch({resources:{...this.#C.value.resources,areas:v("loading",null)}});try{let e=await this.#V.areas(C.areasUrl,V.signal),r=this.#C.value.resources.entry;if(V.signal.aborted||this.#t||!r||K(r)!==H||e.sceneUrl!==r.sceneUrl)return;this.#C.patch({resources:{...this.#C.value.resources,areas:v("ready",e)}});let t=this.#C.value.selection.areaId,M=this.#C.value,o=e.areas.some(i=>i.id===t);(!M.draw.dirty&&!M.areaDraft.dirty||t!==null&&!o)&&this.selectArea(o?t:null)}catch(e){let r=this.#C.value.resources.entry;if(G(e)||V.signal.aborted||this.#t||!r||K(r)!==H)return;this.#C.patch({resources:{...this.#C.value.resources,areas:v("error",null,c1(e,"areas-unavailable"))}})}finally{this.#c("areas",V)}}selectArea(C){let H=this.#C.value.resources.areas.value?.areas.find(e=>e.id===C),V=this.#C.value;this.#C.patch({selection:{...V.selection,areaId:C},areaDraft:H?this.#F(H):{id:null,name:"",cleaningMode:"vacuum",coverageSetting:"standard",status:"new",canRebind:!1,dirty:!1},draw:{...V.draw,circles:H?.circles||[],outline:H?.outline??null,outlineUndo:[],outlineRedo:[],tool:!H||H.outline?"outline":"paint",undo:[],redo:[],dirty:!1,strokeCount:0}})}#F(C){return{id:C.id,name:C.name,cleaningMode:C.cleaningMode,coverageSetting:C.coverageSetting,status:C.status,canRebind:C.canRebind,dirty:!1}}async saveArea(){let C=this.#C.value,H=C.resources.entry,V=C.areaDraft;if(!H||C.command==="pending"||!_(C)||!V.name.trim()||!C.draw.circles.length)return;let e=this.#m("area-mutation"),r=()=>!this.#t&&!e.signal.aborted;this.#C.patch({command:"pending",notice:{tone:"info",text:"Saving area\u2026"}});try{let t=await this.#V.saveArea(H.areasUrl,{areaId:V.id,name:V.name.trim(),circles:C.draw.circles,outline:C.draw.outline??null,cleaningMode:V.cleaningMode,coverageSetting:V.coverageSetting},e.signal);if(!r())return;this.#C.patch({command:"idle",notice:{tone:"success",text:"Area saved"}}),await this.loadAreas(),r()&&this.selectArea(t)}catch(t){if(G(t)||!r())return;this.#C.patch({command:"failed",notice:{tone:"error",text:"Area could not be saved"}})}finally{this.#c("area-mutation",e)}}async deleteArea(){let C=this.#C.value.resources.entry,H=this.#C.value.selection.areaId;if(!C||!H||this.#C.value.command==="pending"||!_(this.#C.value))return;let V=this.#m("area-mutation"),e=()=>!this.#t&&!V.signal.aborted;this.#C.patch({command:"pending",notice:null});try{if(await this.#V.deleteArea(C.areasUrl,H,V.signal),!e())return;this.#C.patch({command:"idle",notice:{tone:"success",text:"Area deleted"}}),await this.loadAreas()}catch(r){!G(r)&&e()&&this.#C.patch({command:"failed",notice:{tone:"error",text:"Area could not be deleted"}})}finally{this.#c("area-mutation",V)}}async savePlan(){let C=this.#C.value,H=C.planDraft,V=C.resources.plans.value;if(!V||!H.name.trim()||!H.rooms.length||!_(C))return;let e=H.rooms;await this.#b("save_plan",{...H.id?{plan_id:H.id}:{},name:H.name.trim(),enabled:H.enabled,run_behavior:H.runBehavior,rooms:e.map(t=>({room:t.roomId,cleaning_mode:t.cleaningMode,coverage_setting:t.coverageSetting})),return_to_base:H.returnToBase,finish_current_room:H.finishCurrentRoom,finish_current_room_threshold:H.finishCurrentRoomThreshold,select:!H.id||V.selectedPlan===H.id},"Plan saved","Plan could not be saved")&&(this.#C.patch({planDraft:{...this.#C.value.planDraft,dirty:!1}}),await this.loadPlans())}async deletePlan(){let C=this.#C.value.selection.planId,H=this.#C.value.selection.entryId;if(!C)return;await this.#b("delete_plan",{plan:C},"Plan deleted","Plan could not be deleted")&&(this.#C.value.selection.entryId===H&&this.#C.value.planDraft.id===C&&this.selectPlan(null),await this.loadPlans())}async executeAction(C){switch(C){case"recheck-status":{let H=this.#C.value.selection.entryId;await this.refreshCatalog(!0);let V=this.#C.value;!this.#t&&V.selection.entryId===H&&V.resources.catalog.status==="ready"&&V.host.connected&&V.host.robotConnected&&V.coherence==="current"&&V.command==="failed"&&this.#C.patch({command:"idle",notice:{tone:"info",text:"Status refreshed. Review the robot state before trying again."}});return}case"stop":await this.#_("matic_robot","stop_intelligent_cleaning",{include_unmanaged:!0});return;case"resume":await this.#_("vacuum","send_command",{command:"resume"});return;case"run-plan":{let H=this.#C.value.selection.planId||this.#C.value.resources.plans.value?.selectedPlan;H&&await this.#_("matic_robot","run_selected_plan",{plan:H});return}case"clean-rooms":{let V=this.#C.value.selection.roomSettings.map(e=>({room:e.roomId,cleaning_mode:e.cleaningMode,coverage_setting:e.coverageSetting}));V.length&&await this.#_("matic_robot","clean_room_sequence",{rooms:V,return_to_base:!0});return}case"run-area":{let H=this.#C.value.selection.areaId;H&&await this.#_("matic_robot","clean_area",{area:H});return}case"review-area":this.#C.dispatch({type:"open-workflow",workflow:"areaReview"});return;case"save-area":await this.saveArea();return;case"save-plan":await this.savePlan();return;case"delete-plan":await this.deletePlan();return;case"delete-area":await this.deleteArea();return}}async#b(C,H,V,e){let r=this.#L?.vacuumEntityId;if(!r||!_(this.#C.value)||this.#C.value.command==="pending")return!1;let t=this.#m("plan-mutation"),M=this.#L?.entryKey,o=this.#L?.userKey,i=()=>!this.#t&&!t.signal.aborted&&M===this.#L?.entryKey&&o===this.#L?.userKey;this.#C.patch({command:"pending",notice:{tone:"info",text:"Saving\u2026"}});try{return await this.#V.service("matic_robot",C,H,r),i()?(this.#C.patch({command:"idle",notice:{tone:"success",text:V}}),!0):!1}catch{return i()&&this.#C.patch({command:"failed",notice:{tone:"error",text:e}}),!1}finally{this.#c("plan-mutation",t)}}async#_(C,H,V){let e=this.#C.value,r=this.#L?.vacuumEntityId,t=H==="stop_intelligent_cleaning"||C==="vacuum"&&H==="return_to_base",M=C==="vacuum"&&H==="send_command"&&V.command==="resume";if(!r||e.selection.entryId!==this.#L?.entryKey||(t?!D2(e):M?!E2(e):!h1(e)))return;let o=++this.#u,i=this.#L?.entryKey,a=()=>!this.#t&&o===this.#u&&i===this.#L?.entryKey,n=t?"settling":"starting";this.#A!==null&&window.clearTimeout(this.#A),this.#A=null,this.#C.patch({command:n,notice:null});try{if(await this.#V.service(C,H,V,r),!a())return;if(C==="matic_robot"&&(H==="clean_room_sequence"||H==="run_selected_plan")){this.#C.patch({command:"idle"}),this.refreshCatalog(!0);return}this.#C.patch({command:n}),this.#A!==null&&window.clearTimeout(this.#A),this.#A=window.setTimeout(()=>{this.#A=null,a()&&this.#C.value.command===n&&this.#C.patch({command:"idle"})},15e3)}catch{if(!a())return;this.#C.patch({command:"failed",notice:{tone:"error",text:"The action could not be confirmed. Check the robot status before trying again."}})}}updateDraftCircles(C,H=!0,V){this.#C.dispatch({type:"set-draft-circles",circles:C,record:H,...V?{previous:V}:{}}),this.#C.dispatch({type:"patch-area-draft",patch:{dirty:!0}})}dispose(){this.#t||(this.#t=!0,this.#d(),this.#Z(),this.#A!==null&&window.clearTimeout(this.#A),this.#A=null,this.#e.dispose(),this.#V.dispose(),this.#H.invalidate())}};var M7=L=>(L.workflow==="none"?0:1)+(L.fullMap?1:0)+(L.precisionOpen?1:0)+(L.dialog?1:0),o7=L=>{if(!L||typeof L!="object")return null;let C=L.maticMapLayer;if(!C||typeof C!="object")return null;let H=C.owner,V=C.depth;return typeof H=="string"&&Number.isInteger(V)&&Number(V)>=0?{owner:H,depth:Number(V)}:null},b2=class{#C;#H=`matic-map-${crypto.randomUUID?.()||Math.random().toString(36).slice(2)}`;#V=0;#e=null;#r=!1;#L=!1;constructor(C){this.#C=C}start(){this.#e||(this.#V=M7(this.#C.value),this.#e=this.#C.subscribe(C=>this.#o(C)),window.addEventListener("popstate",this.#i))}#o(C){let H=M7(C);if(this.#r){this.#r=!1,this.#V=H;return}if(H<this.#V){let V=o7(history.state);if(V?.owner===this.#H&&V.depth===this.#V){let e=H-this.#V;this.#V=H,this.#L=!0,history.go(e);return}}if(H>this.#V)for(let V=this.#V+1;V<=H;V+=1){let e=history.state&&typeof history.state=="object"?history.state:{};history.pushState({...e,maticMapLayer:{owner:this.#H,depth:V}},"",window.location.href)}this.#V=H}#i=()=>{if(this.#L){this.#L=!1;return}if(!(this.#V<1)){if(C1(this.#C.value,{type:"dismiss-top-layer"})){let C=history.state&&typeof history.state=="object"?history.state:{};history.pushState({...C,maticMapLayer:{owner:this.#H,depth:this.#V}},"",window.location.href),this.#C.dispatch({type:"open-dialog",dialog:"discardDraft"});return}this.#r=!0,this.#C.dispatch({type:"dismiss-top-layer"})}};dismissTop(){if(this.#V<1)return!1;let C=o7(history.state);return C?.owner===this.#H&&C.depth===this.#V?history.back():this.#C.dispatch({type:"dismiss-top-layer"}),!0}dispose(){this.#e?.(),this.#e=null,window.removeEventListener("popstate",this.#i),this.#V=0,this.#L=!1}};var i7=H1(d1),h5=class extends k{constructor(){super(...arguments);this.narrow=!1;this._workspace=y();this._classic=!1;this.entryOverride=null;this.#C=new j1;this.#H=new Z1(this._workspace);this.#V=null;this.#e=null;this.#r=null;this.#L=null;this.#o=null;this.#i=""}static{this.styles=[$,I,w`
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
`]}static{this.properties={hass:{attribute:!1},narrow:{type:Boolean},route:{attribute:!1},panel:{attribute:!1},_workspace:{state:!0},_classic:{state:!0},entryOverride:{state:!0}}}#C;#H;#V;#e;#r;#L;#o;#i;connectedCallback(){super.connectedCallback(),this._classic=V7()==="v3",this.#e=this.#H.subscribe(H=>{this._workspace=H,this.#u(H)}),this._classic||this.#a()}disconnectedCallback(){this.#e?.(),this.#e=null,this.#A(),super.disconnectedCallback()}#a(){if(!this.#L&&(this.#V=this.#C.project(this.hass,this.panel,this.entryOverride),this.#r=new Z2(()=>this.hass),this.#L=new y2(this.#H,this.#r),this.#o=new b2(this.#H),this.#o.start(),this.#V)){this.#L.sync(this.#V,this.panel);let{host:H}=this.#V;H.connected&&H.administrator&&H.robotCount>0&&this.#L.refreshCatalog(this.#H.value.selection.floorId==="current")}}#A(){this.#o?.dispose(),this.#o=null,this.#L?.dispose(),this.#L=null,this.#r=null}#u(H){if(!this.#L)return;let V={version:4,view:H.view,appearance:H.appearance,labels:H.labelsVisible,quality:H.quality,cameras:H.cameras},e=JSON.stringify(V);e!==this.#i&&(this.#i=e,this.#L.schedulePreferences(V))}willUpdate(H){if(H.has("hass")||H.has("panel")||H.has("entryOverride")){let V=this.#C.project(this.hass,this.panel,this.entryOverride);if(V!==this.#V){this.#V=V;let e=V.host.connected?V.host.robotCount===0?"unavailable":V.host.administrator?"verifying":"blocked":"degraded";this.#H.replace({...this.#H.value,coherence:e,activity:V.activity,batteryPercent:V.batteryPercent,host:V.host,fullMap:V.host.administrator&&V.host.robotCount>0&&this.#H.value.fullMap,robotLabel:V.robotLabel,robots:V.robots,locale:V.language})}this._classic||this.#L?.sync(V,this.panel)}H.has("narrow")&&this.#H.value.narrowHint!==this.narrow&&this.#H.dispatch({type:"set-narrow-hint",value:this.narrow})}#M(H){if(!u1(H.detail))return;H.stopPropagation();let V=H.detail;if(V.type==="dismiss-top-layer"||V.type==="exit-full-map"){this.#o?.dismissTop()||this.#H.dispatch(V);return}if(V.type==="open-workflow"&&V.workflow!=="none"){this.#L?.openWorkflow(V.workflow);return}if(V.type==="set-floor"){this.#L?.selectFloor(V.floorId);return}if(V.type==="select-entry"){if(!this._workspace.robots.some(e=>e.entryId===V.entryId))return;this.entryOverride=V.entryId;return}if(V.type==="set-history"){this.#L?.selectHistory(V.historyId);return}if(V.type==="select-plan"){this.#L?.selectPlan(V.planId);return}if(V.type==="select-area"){this.#L?.selectArea(V.areaId),V.workflow==="areaReview"&&this.#L?.openWorkflow("areaReview");return}this.#H.dispatch(V)}#y(H){if(H.stopPropagation(),typeof H.detail?.id=="string"){if(H.detail.id==="use-classic"){u5("v3")&&(this.#A(),this._classic=!0);return}this.#L?.executeAction(H.detail.id),this.dispatchEvent(new CustomEvent("matic-map-v4-action-requested",{detail:{id:H.detail.id},bubbles:!0,composed:!0}))}}#h(){u5("v4")&&(this._classic=!1,this.#a(),this.requestUpdate())}updated(){if(!this._classic)return;let H=this.renderRoot.querySelector("matic-map-panel-v0-3-1");H&&(H.hass=this.hass,H.narrow=this.narrow,H.route=this.route,H.panel=this.panel)}getWorkspaceSnapshot(){return this.#H.value}render(){return this._classic?x`
        <div class="classic">
          <button class="return-v4" type="button" @click=${this.#h}>${R(this.hass?.localize,"v4_use_new","Use Map Studio 0.4")}</button>
          <matic-map-panel-v0-3-1></matic-map-panel-v0-3-1>
        </div>
      `:x`
      <${i7}
        .state=${this._workspace}
        .localize=${this.hass?.localize}
        @matic-workspace-intent=${this.#M}
        @matic-workspace-action=${this.#y}
      ></${i7}>
    `}};customElements.get(V5)||customElements.define(V5,h5);export{X1 as CoherenceMachine,T1 as DRAW_BRUSH_MAX_METERS,v1 as DRAW_BRUSH_MIN_METERS,N2 as GALLERY_SCENARIOS,j1 as HassAdapter,B2 as MAP_PIXELS_PER_METER_AT_100,g5 as MAP_ZOOM_MAX,_1 as MAP_ZOOM_MIN,V5 as MATIC_MAP_PANEL_TAG,h5 as MaticMapPanelV4,p5 as MaticMapStudioGalleryV4,Z1 as WorkspaceStore,S4 as brushCursorPixels,_ as canEditCoordinates,R2 as canReadFloorResources,E2 as canResumeMotion,O5 as canShowExactPose,S1 as canShowLiveMap,h1 as canStartMotion,D2 as canStopMotion,f4 as commandState,z2 as createGalleryState,y as initialWorkspaceState,u1 as isWorkspaceIntent,P5 as mapScale,s7 as normalizeBrush,y5 as normalizeZoom,d7 as reduceWorkspace,$2 as selectPrimaryAction,k5 as selectStopSecondaryAction};
/*! Material Design Icons geometry: Apache-2.0. Original robot geometry: MIT. */
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
lit-html/directive.js:
lit-html/directives/repeat.js:
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
lit-html/directive-helpers.js:
  (**
   * @license
   * Copyright 2020 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/
