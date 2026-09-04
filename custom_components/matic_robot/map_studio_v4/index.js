var C1=100,E1=1e3,Z1=.2,D1=2.5,a2=64,$1=L=>!L||typeof L!="object"?!1:typeof L.type=="string";var a1=()=>({status:"idle",value:null,problem:null}),Q=(L,C,H)=>Math.max(C,Math.min(H,L)),K3=L=>({yaw:Q(Number.isFinite(L.yaw)?L.yaw:0,-Math.PI,Math.PI),pitch:Q(Number.isFinite(L.pitch)?L.pitch:Math.PI/2-.018,.18,Math.PI/2-.018),zoom:Q(Number.isFinite(L.zoom)?L.zoom:1,.01,100),targetX:Q(Number.isFinite(L.targetX)?L.targetX:0,-1e4,1e4),targetZ:Q(Number.isFinite(L.targetZ)?L.targetZ:0,-1e4,1e4)}),q2=L=>Math.round(Q(Number.isFinite(L)?L:100,100,1e3)),q3=L=>Math.round(Q(Number.isFinite(L)?L:.2,.2,2.5)*100)/100,w=()=>({generation:0,coherence:"verifying",dataMode:"live",activity:"unknown",workflow:"none",command:"idle",fullMap:!1,precisionOpen:!1,dialog:null,narrowHint:!1,view:"top",appearance:"photo",labelsVisible:!0,quality:"auto",cameras:{},managedLock:!1,batteryPercent:null,floor:{classifiedCount:1,displayName:"Current floor",readOnly:!1},map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1},host:{connected:!0,administrator:!0,robotConnected:!1,robotCount:0},draw:{zoomPercent:100,zoomOriginX:50,zoomOriginY:50,brushMeters:.6,tool:"paint",dirty:!1,strokeCount:0,circles:[],undo:[],redo:[]},resources:{catalog:a1(),entry:null,scene:a1(),pose:a1(),history:a1(),plans:a1(),areas:a1()},selection:{entryId:null,floorId:"current",historyId:null,roomIds:[],roomSettings:[],cleaningMode:"vacuum",coverageSetting:"standard",planId:null,areaId:null},planDraft:{id:null,name:"",enabled:!0,runBehavior:"intelligent",rooms:[],returnToBase:!0,finishCurrentRoom:!1,finishCurrentRoomThreshold:50,dirty:!1},areaDraft:{id:null,name:"",cleaningMode:"vacuum",coverageSetting:"standard",status:"new",canRebind:!1,dirty:!1},notice:null,robotLabel:"Matic robot",robots:[],locale:"en"}),W=(L,C)=>({...L,draw:{...L.draw,...C}}),X3=(L,C)=>{switch(C.type){case"set-host":return{...L,host:C.host,fullMap:C.host.administrator&&C.host.robotCount>0?L.fullMap:!1};case"set-operational-state":return{...L,coherence:C.coherence,activity:C.activity,command:C.command??L.command};case"set-narrow-hint":return{...L,narrowHint:C.value};case"set-view":return{...L,view:C.view};case"set-appearance":return{...L,appearance:C.appearance};case"set-quality":return{...L,quality:C.quality};case"set-camera":return{...L,cameras:{...L.cameras,[C.view]:K3(C.camera)}};case"toggle-labels":return{...L,labelsVisible:!L.labelsVisible};case"open-workflow":return{...L,workflow:C.workflow,precisionOpen:!1};case"enter-full-map":return L.host.administrator&&L.host.robotCount>0&&L.map.available?{...L,fullMap:!0}:L;case"exit-full-map":return{...L,fullMap:!1,precisionOpen:!1};case"set-precision-open":return{...L,precisionOpen:C.value};case"set-zoom":return W(L,{zoomPercent:q2(C.value),...C.originX===void 0?{}:{zoomOriginX:Q(C.originX,0,100)},...C.originY===void 0?{}:{zoomOriginY:Q(C.originY,0,100)}});case"step-zoom":return W(L,{zoomPercent:q2(L.draw.zoomPercent*C.factor)});case"fit-map":return W(L,{zoomPercent:100,zoomOriginX:50,zoomOriginY:50});case"set-brush":return W(L,{brushMeters:q3(C.value)});case"set-draw-tool":return W(L,{tool:C.tool});case"mark-draft":{let H=Math.max(0,L.draw.strokeCount+C.strokeDelta);return W(L,{dirty:H>0,strokeCount:H})}case"undo-draft":{let H=L.draw.undo.at(-1);return H?W(L,{circles:H,undo:L.draw.undo.slice(0,-1),redo:[...L.draw.redo,L.draw.circles],dirty:!0,strokeCount:Math.max(0,L.draw.strokeCount-1)}):L}case"clear-draft":return L.draw.circles.length?W(L,{circles:[],undo:[...L.draw.undo.slice(-99),L.draw.circles],redo:[],dirty:!0,strokeCount:L.draw.strokeCount+1}):L;case"redo-draft":{let H=L.draw.redo.at(-1);return H?W(L,{circles:H,undo:[...L.draw.undo,L.draw.circles],redo:L.draw.redo.slice(0,-1),dirty:!0,strokeCount:L.draw.strokeCount+1}):L}case"set-draft-circles":{let H=C.circles.slice(0,512).map(e=>({...e})),V=C.record!==!1;return W(L,{circles:H,undo:V?[...L.draw.undo.slice(-99),C.previous??L.draw.circles]:L.draw.undo,redo:V?[]:L.draw.redo,dirty:!0,strokeCount:V?L.draw.strokeCount+1:L.draw.strokeCount})}case"discard-draft":return{...W(L,{dirty:!1,strokeCount:0,circles:[],undo:[],redo:[]}),dialog:null,workflow:"none",precisionOpen:!1};case"toggle-room":{let H=L.selection.roomIds.includes(C.roomId);return{...L,selection:{...L.selection,roomIds:H?L.selection.roomIds.filter(V=>V!==C.roomId):[...L.selection.roomIds,C.roomId],roomSettings:H?L.selection.roomSettings.filter(V=>V.roomId!==C.roomId):[...L.selection.roomSettings,{roomId:C.roomId,cleaningMode:"vacuum",coverageSetting:"standard"}]}}}case"patch-room-settings":return{...L,selection:{...L.selection,roomSettings:L.selection.roomSettings.map(H=>H.roomId===C.roomId?{...H,...C.cleaningMode?{cleaningMode:C.cleaningMode}:{},...C.coverageSetting?{coverageSetting:C.coverageSetting}:{}}:H)}};case"set-floor":return{...L,dataMode:C.floorId==="current"?"live":"history",selection:{...L.selection,floorId:C.floorId,historyId:null}};case"select-entry":return L;case"set-history":return{...L,dataMode:C.historyId?"history":"live",selection:{...L.selection,historyId:C.historyId}};case"select-plan":return{...L,selection:{...L.selection,planId:C.planId}};case"select-area":return{...L,selection:{...L.selection,areaId:C.areaId}};case"patch-plan-draft":return{...L,planDraft:{...L.planDraft,...C.patch,dirty:C.patch.dirty??!0}};case"patch-area-draft":return{...L,areaDraft:{...L.areaDraft,...C.patch,dirty:C.patch.dirty??!0}};case"set-notice":return{...L,notice:C.notice};case"open-dialog":return{...L,dialog:C.dialog};case"dismiss-top-layer":return L.dialog?{...L,dialog:null}:L.precisionOpen?{...L,precisionOpen:!1}:L.fullMap?{...L,fullMap:!1}:L.workflow!=="none"?{...L,workflow:"none",precisionOpen:!1}:L;case"return-live":return{...L,dataMode:"live",workflow:"none",floor:{...L.floor,readOnly:!1}}}},A1=class{#C=new Set;#H;constructor(C=w()){this.#H=C}get value(){return this.#H}dispatch(C){let H=X3(this.#H,C);if(H===this.#H)return H;this.#H=H;for(let V of this.#C)V(H);return H}replace(C){if(C!==this.#H){this.#H=C;for(let H of this.#C)H(C)}}patch(C){let H={...this.#H,...C};return this.replace(H),H}subscribe(C){return this.#C.add(C),C(this.#H),()=>this.#C.delete(C)}},I1=class{#C=null;#H=0;get generation(){return this.#H}begin(C,H,V,e){return this.#H+=1,this.#C={entryKey:C,generation:this.#H,floorKey:H,missionKey:V,revision:e},this.#C}current(){return this.#C}accepts(C){let H=this.#C;return!!(H&&C.entryKey===H.entryKey&&C.generation===H.generation&&C.floorKey===H.floorKey&&C.missionKey===H.missionKey&&C.revision===H.revision)}advance(C,H){return!this.accepts(C)||!Number.isSafeInteger(H)||H<=C.revision?null:(this.#C={...C,revision:H},this.#C)}invalidate(){return this.#H+=1,this.#C=null,this.#H}},d1=L=>L.dataMode==="live"&&L.map.available&&(L.coherence==="current"||L.coherence==="degraded")&&L.host.administrator,X2=L=>d1(L)&&(L.coherence==="current"||L.coherence==="degraded")&&L.map.floorCoherent&&L.map.sessionVerified&&L.map.exactPose&&L.host.connected&&L.host.robotConnected,K=L=>d1(L)&&L.coherence==="current"&&L.map.complete&&L.map.floorCoherent&&L.map.sessionVerified&&L.host.connected&&L.host.robotConnected&&!L.floor.readOnly,n2=L=>d1(L)&&L.coherence==="current"&&L.map.floorCoherent&&L.map.sessionVerified&&L.host.connected&&L.host.robotConnected&&!L.floor.readOnly,n1=L=>K(L)&&!L.managedLock&&L.command==="idle"&&(L.activity==="idle"||L.activity==="docked"),S1=(L,C,H,V,e)=>({id:L,label:C,labelKey:V,kind:"neutral",enabled:!1,reason:H,reasonKey:e}),j2=L=>{let C=L.command==="idle";return{id:"stop",label:"Stop",labelKey:"v4_action_stop",kind:"danger",enabled:C,...C?{}:{reason:"The robot is already stopping.",reasonKey:"v4_reason_stop"}}},Y2=L=>{if(L.dataMode==="history")return{id:"return-live",label:"Return to the live map",labelKey:"v4_action_return_live",kind:"primary",enabled:!0};if(L.activity==="cleaning"||L.activity==="returning"||L.activity==="recharging")return j2(L);if(L.activity==="stopping"||L.command==="settling")return S1("stopping","Stopping","Waiting for the robot to settle.","v4_action_stopping","v4_reason_stopping");if(L.activity==="paused")return{id:"resume",label:"Resume cleaning",labelKey:"v4_action_resume",kind:"primary",enabled:L.command==="idle"};if(!L.host.connected)return S1("reconnecting","Reconnecting","Home Assistant is offline.","v4_action_reconnecting","v4_reason_reconnecting");if(!L.host.administrator)return S1("administrator","Administrator access required","Ask a Home Assistant administrator to open this map.","v4_action_administrator","v4_reason_administrator");if(!L.host.robotConnected)return S1("robot-offline","Robot offline","Reconnect the robot to start cleaning.","v4_action_robot_offline","v4_reason_robot_offline");if(L.coherence!=="current")return S1("locating","Finding the map","Waiting for the robot to confirm which floor it is on.","v4_action_locating","v4_reason_locating");if(L.workflow==="draw"){let C={reason:"Draw the area first.",reasonKey:"v4_reason_save_area_draw"};return L.fullMap||L.narrowHint?{id:"review-area",label:"Name and save",labelKey:"v4_action_review_area",kind:"primary",enabled:L.draw.dirty,...L.draw.dirty?{}:C}:{id:"save-area",label:"Save area",labelKey:"v4_action_save_area",kind:"primary",enabled:L.draw.dirty&&K(L),...L.draw.dirty?{}:C}}if(L.workflow==="rooms"){let C=L.selection.roomIds.length,H=n1(L)&&C>0;return{id:"clean-rooms",label:C?`Clean ${C} room${C===1?"":"s"}`:"Clean selected rooms",...C?{}:{labelKey:"v4_action_clean_rooms"},kind:"primary",enabled:H,...H?{}:C?{reason:"Waiting for the current map to be verified.",reasonKey:"v4_reason_clean_rooms_verification"}:{reason:"Select at least one room to clean.",reasonKey:"v4_reason_clean_rooms_empty"}}}if(L.workflow==="plan"){if(L.planDraft.dirty||!L.planDraft.id){let C=K(L)&&L.planDraft.name.trim().length>0&&L.planDraft.rooms.length>0;return{id:"save-plan",label:"Save plan",labelKey:"v4_action_save_plan",kind:"primary",enabled:C,...C?{}:{reason:"Add a plan name and at least one room.",reasonKey:"v4_reason_save_plan"}}}return{id:"run-plan",label:"Run this plan",labelKey:"v4_action_run_plan",kind:"primary",enabled:n1(L)&&L.planDraft.enabled,...n1(L)?{}:{reason:"Waiting for the current map to be verified.",reasonKey:"v4_reason_run_plan"}}}if(L.workflow==="areaReview"){if(L.areaDraft.dirty||L.draw.dirty||!L.areaDraft.id||L.areaDraft.canRebind){let H=K(L)&&L.areaDraft.name.trim().length>0&&L.draw.circles.length>0;return{id:"save-area",label:L.areaDraft.canRebind?"Confirm on this map":"Save area",labelKey:L.areaDraft.canRebind?"v4_action_save_area_confirm":"v4_action_save_area",kind:"primary",enabled:H,...H?{}:{reason:"Add an area name and at least one mark.",reasonKey:"v4_reason_save_area_details"}}}let C=L.areaDraft.status==="current";return{id:"run-area",label:"Clean this area",labelKey:"v4_action_run_area",kind:"primary",enabled:C&&n1(L),...C?{}:{reason:"Confirm this outline on the current map first.",reasonKey:"v4_reason_run_area"}}}return{id:"choose-cleaning",label:"Choose what to clean",labelKey:"v4_action_choose_cleaning",kind:"neutral",enabled:!1,reason:"Choose rooms, a plan, or a custom area.",reasonKey:"v4_reason_choose_cleaning"}},J2=L=>L.activity==="paused"?j2(L):null,j0=L=>L.draw.brushMeters*64*(L.draw.zoomPercent/100),j3=[2,1,.5,.25,.1,.05],C5=L=>{let C=64*(L.draw.zoomPercent/100),H=j3.reduce((V,e)=>{let r=Math.abs(e*C-64),M=Math.abs(V*C-64);return r<M?e:V});return{meters:H,pixels:H*C,label:H<1?`${Math.round(H*100)} cm`:`${H} m`}},Y0=(L,C)=>({...L,command:C});var H5="a".repeat(64),l1=[{roomId:"room-a",name:"Kitchen",boundary:[[.5,.5],[4,.5],[4,3],[.5,3]]},{roomId:"room-b",name:"Living room",boundary:[[4.2,.5],[8.5,.5],[8.5,3.4],[4.2,3.4]]},{roomId:"room-c",name:"Office",boundary:[[.5,3.2],[3.8,3.2],[3.8,6.5],[.5,6.5]]},{roomId:"room-d",name:"Bedroom",boundary:[[4,3.6],[8.5,3.6],[8.5,6.5],[4,6.5]]}],V5=()=>{let L=[180,140],C={meters_per_cell:.05,origin_cells:[0,0],span_cells:L,sample_step:1,rooms:l1.map(o=>{let a=o.boundary.map(([A,s])=>[A/.05,s/.05]),n=[a.reduce((A,[s])=>A+s,0)/a.length,a.reduce((A,[,s])=>A+s,0)/a.length];return{name:o.name,boundary:a,boundary_closed:!0,center:n}})},H=new TextEncoder().encode(JSON.stringify(C)),V=[];for(let o=10;o<130;o+=2)for(let a=10;a<170;a+=2){let n=a<80?o<65?0:2:o<72?1:3,A=[[185,219,224],[201,211,233],[210,226,194],[232,207,207]][n]||[190,205,215];V.push([a,o,0,...A])}let e=500;for(let o=0;o<e;o+=1){let a=o%4,n=o*7%120,A=a<2?a===0?10:168:10+n,s=a>=2?a===2?10:128:10+n;V.push([A,s,10+o%18,104,122,137])}let r=V.length-e,M=new ArrayBuffer(24+H.byteLength+V.length*8),t=new DataView(M);new Uint8Array(M,0,8).set(new TextEncoder().encode("MATIC3D\0")),t.setUint16(8,1,!0),t.setUint16(10,8,!0),t.setUint32(12,H.byteLength,!0),t.setUint32(16,r,!0),t.setUint32(20,e,!0),new Uint8Array(M,24,H.byteLength).set(H);let i=new DataView(M,24+H.byteLength);return V.forEach(([o=0,a=0,n=0,A=0,s=0,v=0],x)=>{let u=x*8;i.setUint16(u,o,!0),i.setUint16(u+2,a,!0),i.setUint8(u+4,n),i.setUint8(u+5,A),i.setUint8(u+6,s),i.setUint8(u+7,v)}),{buffer:M,pointOffset:24+H.byteLength,floorCount:r,surfaceCount:e,total:V.length,revision:7,etag:'"synthetic-scene"',source:"live",metadata:{metersPerCell:.05,origin:[0,0],span:L,sampleStep:1,rooms:C.rooms.map((o,a)=>({id:l1[a]?.roomId||`room-${a}`,name:o.name,boundary:o.boundary,center:o.center}))}}},W1=()=>({entryId:"synthetic-entry",sceneUrl:"/api/matic_robot/slam_scene/synthetic",deltaUrl:"/api/matic_robot/slam_delta/synthetic",poseUrl:"/api/matic_robot/slam_pose/synthetic",historyUrl:"/api/matic_robot/slam_history/synthetic",areasUrl:"/api/matic_robot/areas/synthetic",plansUrl:"/api/matic_robot/plans/synthetic",mapRevision:7,mapFloorCoherent:!0,mapSessionVerified:!0,mapSessionKey:H5,mapBlockReason:null,runnerLocked:!1,stopSettlePending:!1,activePlan:!1,nativeReconciliationPending:!1,nativeSessionActive:!1,mapComplete:!0,mapTruncated:!1,selectedFloorOrdinal:1,mapFloorOrdinal:1,historyCount:2,historyFloorCount:2,health:"ready",streamFailures:0,bootstrapState:"complete",bootstrapPhotoSeen:!0,bootstrapStructureSeen:!0,bootstrapFailures:0}),A2=()=>({rooms:l1.map(({roomId:L,name:C})=>({roomId:L,name:C})),selectedPlan:"daily",plans:[{id:"daily",name:"Daily clean",enabled:!0,runBehavior:"intelligent",rooms:l1.slice(0,3).map(({roomId:L})=>({roomId:L,cleaningMode:"vacuum",coverageSetting:"standard"})),roomOrder:l1.slice(0,3).map(({roomId:L})=>L),returnToBase:!0,finishCurrentRoom:!1,finishCurrentRoomThreshold:50}]}),d2=()=>({sceneUrl:W1().sceneUrl,rooms:l1.map(L=>({...L,boundary:L.boundary.map(C=>[...C])})),areas:[{id:"entryway",name:"Entryway",circles:[{x:1.5,y:1.4,radius:.3},{x:1.9,y:1.6,radius:.3}],cleaningMode:"vacuum",coverageSetting:"standard",status:"current",canRebind:!1}]}),L5=()=>({entryId:"synthetic-entry",liveAvailable:!0,floors:[{id:"current",active:!0,readOnly:!1,liveAvailable:!0,label:"House",ordinal:null,snapshots:[{id:"current-old",createdAt:"2026-08-29T14:00:00Z",revision:6,pointCount:5300,sceneUrl:"/synthetic-history-current-old"},{id:"current-new",createdAt:"2026-08-29T16:12:00Z",revision:7,pointCount:5300,sceneUrl:"/synthetic-history-current-new"}]},{id:"saved-1",active:!1,readOnly:!0,liveAvailable:!1,label:"Shed",ordinal:2,snapshots:[{id:"saved-one",createdAt:"2026-08-28T11:30:00Z",revision:3,pointCount:3100,sceneUrl:"/synthetic-history-saved"}]},{id:"saved-2",active:!1,readOnly:!0,liveAvailable:!1,label:"Annex",ordinal:3,snapshots:[]}]}),e5=()=>({position:[4.475,3.475],source:"latest_pose",revision:7,poseRevision:4,floorCoherent:!0,mapSessionKey:H5,freshness:"live"});var Y3=()=>({...w(),coherence:"current",activity:"docked",batteryPercent:92,robots:[{entryId:"synthetic-entry",label:"Matic robot"}],host:{connected:!0,administrator:!0,robotConnected:!0,robotCount:1},floor:{classifiedCount:2,displayName:"House",readOnly:!1},map:{available:!0,complete:!0,floorCoherent:!0,sessionVerified:!0,exactPose:!0},resources:{catalog:{status:"ready",value:[W1()],problem:null},entry:W1(),scene:{status:"ready",value:V5(),problem:null},pose:{status:"ready",value:e5(),problem:null},history:{status:"ready",value:L5(),problem:null},plans:{status:"ready",value:A2(),problem:null},areas:{status:"ready",value:d2(),problem:null}},selection:{...w().selection,entryId:"synthetic-entry",planId:"daily"},planDraft:{...w().planDraft,id:"daily",name:"Daily clean",rooms:A2().plans[0]?.rooms||[]}}),l2=L=>{let C=Y3();switch(L){case"ready":return C;case"cleaning":return{...C,activity:"cleaning"};case"paused":return{...C,activity:"paused"};case"returning":return{...C,activity:"returning"};case"recharging":return{...C,activity:"recharging",batteryPercent:18};case"rooms":return{...C,workflow:"rooms"};case"draw":return{...C,workflow:"draw",areaDraft:{...C.areaDraft,id:"entryway",name:"Entryway",status:"current"},selection:{...C.selection,areaId:"entryway"},draw:{...C.draw,dirty:!0,strokeCount:3,circles:d2().areas[0]?.circles||[]}};case"history":return{...C,dataMode:"history",workflow:"history",floor:{...C.floor,readOnly:!0},map:{...C.map,exactPose:!1},selection:{...C.selection,floorId:"saved-1",historyId:"saved-one"}};case"transition":return{...C,coherence:"verifying",activity:"unknown",map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1}};case"problem":return{...C,activity:"problem",coherence:"blocked"};case"ha-offline":return{...C,coherence:"degraded",host:{...C.host,connected:!1},map:{...C.map,exactPose:!1}};case"robot-offline":return{...C,coherence:"degraded",host:{...C.host,robotConnected:!1},map:{...C.map,exactPose:!1}};case"access":return{...C,coherence:"blocked",host:{...C.host,administrator:!1},map:{...C.map,available:!1,exactPose:!1}};case"empty":return{...C,coherence:"unavailable",host:{...C.host,robotConnected:!1,robotCount:0},map:{...C.map,available:!1,exactPose:!1}};case"unsupported":return{...C,coherence:"blocked",map:{...C.map,available:!1,exactPose:!1}};case"multi-robot":return{...C,host:{...C.host,robotCount:2},robots:[{entryId:"synthetic-entry",label:"Matic robot"},{entryId:"synthetic-entry-two",label:"Second robot"}]}}},s2=["ready","cleaning","paused","returning","recharging","rooms","draw","history","transition","problem","ha-offline","robot-offline","access","empty","unsupported","multi-robot"];var J3=(L,C)=>{if(C?.recharge_and_resume===!0&&C?.charging===!0)return"recharging";switch(L){case"cleaning":return"cleaning";case"paused":return"paused";case"returning":return"returning";case"docked":return"docked";case"idle":return"idle";case"error":return"problem";default:return"unknown"}},C0=L=>typeof L!="number"||!Number.isFinite(L)?null:Math.round(Math.max(0,Math.min(100,L))),H0=L=>{let C=L.attributes?.matic_entry_id;return typeof C=="string"&&C.length>0?C:null},V0=L=>String(L||"local-user").replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",r5=L=>{if(typeof L!="string")return"Matic robot";let C=L.trim();return C&&Array.from(C).length<=128&&!/[\u0000-\u001f\u007f]/u.test(C)?C:"Matic robot"},N1=class{#C="";#H=null;project(C,H,V=null){let e=C?.states??{},r=H?.config?.entry_id,M=typeof r=="string"?r:null,t=null,i=null,o=null,a=new Map;for(let[Z,f]of Object.entries(e)){let P=H0(f);if(!P||!Z.startsWith("vacuum."))continue;a.set(P,{entryId:P,label:r5(f.attributes?.friendly_name)});let _1=V||M;(!t||_1&&P===_1)&&(t=f,i=Z,o=P)}let n={connected:C?.connected!==!1,administrator:C?.user?.is_admin===!0,robotConnected:t!==null&&t.state!=="unavailable"&&t.state!=="unknown",robotCount:a.size},A=t?J3(t.state,t.attributes):"unknown",s=C0(t?.attributes?.battery_level),v=C?.selectedLanguage||C?.language||"en",x=V0(C?.user?.id),u=r5(t?.attributes?.friendly_name),m=[...a.values()].sort((Z,f)=>Z.label.localeCompare(f.label,v,{sensitivity:"base"})),S=[n.connected,n.administrator,n.robotConnected,n.robotCount,A,s??"none",v,x,i??"none",o??"none",u,m.map(Z=>`${Z.entryId}:${Z.label}`).join(",")].join("|");return S===this.#C&&this.#H?this.#H:(this.#C=S,this.#H={host:n,activity:A,batteryPercent:s,language:v,userKey:x,vacuumEntityId:i,entryKey:o,robotLabel:u,robots:m},this.#H)}};var z1=globalThis,U1=z1.ShadowRoot&&(z1.ShadyCSS===void 0||z1.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,p2=Symbol(),M5=new WeakMap,h1=class{constructor(C,H,V){if(this._$cssResult$=!0,V!==p2)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=C,this.t=H}get styleSheet(){let C=this.o,H=this.t;if(U1&&C===void 0){let V=H!==void 0&&H.length===1;V&&(C=M5.get(H)),C===void 0&&((this.o=C=new CSSStyleSheet).replaceSync(this.cssText),V&&M5.set(H,C))}return C}toString(){return this.cssText}},t5=L=>new h1(typeof L=="string"?L:L+"",void 0,p2),g=(L,...C)=>{let H=L.length===1?L[0]:C.reduce((V,e,r)=>V+(M=>{if(M._$cssResult$===!0)return M.cssText;if(typeof M=="number")return M;throw Error("Value passed to 'css' function must be a 'css' function result: "+M+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(e)+L[r+1],L[0]);return new h1(H,L,p2)},i5=(L,C)=>{if(U1)L.adoptedStyleSheets=C.map(H=>H instanceof CSSStyleSheet?H:H.styleSheet);else for(let H of C){let V=document.createElement("style"),e=z1.litNonce;e!==void 0&&V.setAttribute("nonce",e),V.textContent=H.cssText,L.appendChild(V)}},m2=U1?L=>L:L=>L instanceof CSSStyleSheet?(C=>{let H="";for(let V of C.cssRules)H+=V.cssText;return t5(H)})(L):L;var{is:L0,defineProperty:e0,getOwnPropertyDescriptor:r0,getOwnPropertyNames:M0,getOwnPropertySymbols:t0,getPrototypeOf:i0}=Object,G1=globalThis,o5=G1.trustedTypes,o0=o5?o5.emptyScript:"",a0=G1.reactiveElementPolyfillSupport,f1=(L,C)=>L,v2={toAttribute(L,C){switch(C){case Boolean:L=L?o0:null;break;case Object:case Array:L=L==null?L:JSON.stringify(L)}return L},fromAttribute(L,C){let H=L;switch(C){case Boolean:H=L!==null;break;case Number:H=L===null?null:Number(L);break;case Object:case Array:try{H=JSON.parse(L)}catch{H=null}}return H}},n5=(L,C)=>!L0(L,C),a5={attribute:!0,type:String,converter:v2,reflect:!1,useDefault:!1,hasChanged:n5};Symbol.metadata??=Symbol("metadata"),G1.litPropertyMetadata??=new WeakMap;var q=class extends HTMLElement{static addInitializer(C){this._$Ei(),(this.l??=[]).push(C)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(C,H=a5){if(H.state&&(H.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(C)&&((H=Object.create(H)).wrapped=!0),this.elementProperties.set(C,H),!H.noAccessor){let V=Symbol(),e=this.getPropertyDescriptor(C,V,H);e!==void 0&&e0(this.prototype,C,e)}}static getPropertyDescriptor(C,H,V){let{get:e,set:r}=r0(this.prototype,C)??{get(){return this[H]},set(M){this[H]=M}};return{get:e,set(M){let t=e?.call(this);r?.call(this,M),this.requestUpdate(C,t,V)},configurable:!0,enumerable:!0}}static getPropertyOptions(C){return this.elementProperties.get(C)??a5}static _$Ei(){if(this.hasOwnProperty(f1("elementProperties")))return;let C=i0(this);C.finalize(),C.l!==void 0&&(this.l=[...C.l]),this.elementProperties=new Map(C.elementProperties)}static finalize(){if(this.hasOwnProperty(f1("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(f1("properties"))){let H=this.properties,V=[...M0(H),...t0(H)];for(let e of V)this.createProperty(e,H[e])}let C=this[Symbol.metadata];if(C!==null){let H=litPropertyMetadata.get(C);if(H!==void 0)for(let[V,e]of H)this.elementProperties.set(V,e)}this._$Eh=new Map;for(let[H,V]of this.elementProperties){let e=this._$Eu(H,V);e!==void 0&&this._$Eh.set(e,H)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(C){let H=[];if(Array.isArray(C)){let V=new Set(C.flat(1/0).reverse());for(let e of V)H.unshift(m2(e))}else C!==void 0&&H.push(m2(C));return H}static _$Eu(C,H){let V=H.attribute;return V===!1?void 0:typeof V=="string"?V:typeof C=="string"?C.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){this._$ES=new Promise(C=>this.enableUpdating=C),this._$AL=new Map,this._$E_(),this.requestUpdate(),this.constructor.l?.forEach(C=>C(this))}addController(C){(this._$EO??=new Set).add(C),this.renderRoot!==void 0&&this.isConnected&&C.hostConnected?.()}removeController(C){this._$EO?.delete(C)}_$E_(){let C=new Map,H=this.constructor.elementProperties;for(let V of H.keys())this.hasOwnProperty(V)&&(C.set(V,this[V]),delete this[V]);C.size>0&&(this._$Ep=C)}createRenderRoot(){let C=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return i5(C,this.constructor.elementStyles),C}connectedCallback(){this.renderRoot??=this.createRenderRoot(),this.enableUpdating(!0),this._$EO?.forEach(C=>C.hostConnected?.())}enableUpdating(C){}disconnectedCallback(){this._$EO?.forEach(C=>C.hostDisconnected?.())}attributeChangedCallback(C,H,V){this._$AK(C,V)}_$ET(C,H){let V=this.constructor.elementProperties.get(C),e=this.constructor._$Eu(C,V);if(e!==void 0&&V.reflect===!0){let r=(V.converter?.toAttribute!==void 0?V.converter:v2).toAttribute(H,V.type);this._$Em=C,r==null?this.removeAttribute(e):this.setAttribute(e,r),this._$Em=null}}_$AK(C,H){let V=this.constructor,e=V._$Eh.get(C);if(e!==void 0&&this._$Em!==e){let r=V.getPropertyOptions(e),M=typeof r.converter=="function"?{fromAttribute:r.converter}:r.converter?.fromAttribute!==void 0?r.converter:v2;this._$Em=e;let t=M.fromAttribute(H,r.type);this[e]=t??this._$Ej?.get(e)??t,this._$Em=null}}requestUpdate(C,H,V,e=!1,r){if(C!==void 0){let M=this.constructor;if(e===!1&&(r=this[C]),V??=M.getPropertyOptions(C),!((V.hasChanged??n5)(r,H)||V.useDefault&&V.reflect&&r===this._$Ej?.get(C)&&!this.hasAttribute(M._$Eu(C,V))))return;this.C(C,H,V)}this.isUpdatePending===!1&&(this._$ES=this._$EP())}C(C,H,{useDefault:V,reflect:e,wrapped:r},M){V&&!(this._$Ej??=new Map).has(C)&&(this._$Ej.set(C,M??H??this[C]),r!==!0||M!==void 0)||(this._$AL.has(C)||(this.hasUpdated||V||(H=void 0),this._$AL.set(C,H)),e===!0&&this._$Em!==C&&(this._$Eq??=new Set).add(C))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(H){Promise.reject(H)}let C=this.scheduleUpdate();return C!=null&&await C,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??=this.createRenderRoot(),this._$Ep){for(let[e,r]of this._$Ep)this[e]=r;this._$Ep=void 0}let V=this.constructor.elementProperties;if(V.size>0)for(let[e,r]of V){let{wrapped:M}=r,t=this[e];M!==!0||this._$AL.has(e)||t===void 0||this.C(e,void 0,r,t)}}let C=!1,H=this._$AL;try{C=this.shouldUpdate(H),C?(this.willUpdate(H),this._$EO?.forEach(V=>V.hostUpdate?.()),this.update(H)):this._$EM()}catch(V){throw C=!1,this._$EM(),V}C&&this._$AE(H)}willUpdate(C){}_$AE(C){this._$EO?.forEach(H=>H.hostUpdated?.()),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(C)),this.updated(C)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(C){return!0}update(C){this._$Eq&&=this._$Eq.forEach(H=>this._$ET(H,this[H])),this._$EM()}updated(C){}firstUpdated(C){}};q.elementStyles=[],q.shadowRootOptions={mode:"open"},q[f1("elementProperties")]=new Map,q[f1("finalized")]=new Map,a0?.({ReactiveElement:q}),(G1.reactiveElementVersions??=[]).push("2.1.2");var f2=globalThis,A5=L=>L,Q1=f2.trustedTypes,d5=Q1?Q1.createPolicy("lit-html",{createHTML:L=>L}):void 0,c5="$lit$",Y=`lit$${Math.random().toFixed(9).slice(2)}$`,x5="?"+Y,n0=`<${x5}>`,L1=document,y1=()=>L1.createComment(""),b1=L=>L===null||typeof L!="object"&&typeof L!="function",g2=Array.isArray,A0=L=>g2(L)||typeof L?.[Symbol.iterator]=="function",c2=`[ \t\n\f\r]`,g1=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,l5=/-->/g,s5=/>/g,H1=RegExp(`>|${c2}(?:([^\\s"'>=/]+)(${c2}*=${c2}*(?:[^ \t\n\f\r"'\`<>=]|("|')|))|$)`,"g"),p5=/'/g,m5=/"/g,u5=/^(?:script|style|textarea|title)$/i,y2=L=>(C,...H)=>({_$litType$:L,strings:C,values:H}),O=y2(1),Z5=y2(2),S5=y2(3),e1=Symbol.for("lit-noChange"),l=Symbol.for("lit-nothing"),v5=new WeakMap,V1=L1.createTreeWalker(L1,129);function h5(L,C){if(!g2(L)||!L.hasOwnProperty("raw"))throw Error("invalid template strings array");return d5!==void 0?d5.createHTML(C):C}var d0=(L,C)=>{let H=L.length-1,V=[],e,r=C===2?"<svg>":C===3?"<math>":"",M=g1;for(let t=0;t<H;t++){let i=L[t],o,a,n=-1,A=0;for(;A<i.length&&(M.lastIndex=A,a=M.exec(i),a!==null);)A=M.lastIndex,M===g1?a[1]==="!--"?M=l5:a[1]!==void 0?M=s5:a[2]!==void 0?(u5.test(a[2])&&(e=RegExp("</"+a[2],"g")),M=H1):a[3]!==void 0&&(M=H1):M===H1?a[0]===">"?(M=e??g1,n=-1):a[1]===void 0?n=-2:(n=M.lastIndex-a[2].length,o=a[1],M=a[3]===void 0?H1:a[3]==='"'?m5:p5):M===m5||M===p5?M=H1:M===l5||M===s5?M=g1:(M=H1,e=void 0);let s=M===H1&&L[t+1].startsWith("/>")?" ":"";r+=M===g1?i+n0:n>=0?(V.push(o),i.slice(0,n)+c5+i.slice(n)+Y+s):i+Y+(n===-2?t:s)}return[h5(L,r+(L[H]||"<?>")+(C===2?"</svg>":C===3?"</math>":"")),V]},O1=class L{constructor({strings:C,_$litType$:H},V){let e;this.parts=[];let r=0,M=0,t=C.length-1,i=this.parts,[o,a]=d0(C,H);if(this.el=L.createElement(o,V),V1.currentNode=this.el.content,H===2||H===3){let n=this.el.content.firstChild;n.replaceWith(...n.childNodes)}for(;(e=V1.nextNode())!==null&&i.length<t;){if(e.nodeType===1){if(e.hasAttributes())for(let n of e.getAttributeNames())if(n.endsWith(c5)){let A=a[M++],s=e.getAttribute(n).split(Y),v=/([.?@])?(.*)/.exec(A);i.push({type:1,index:r,name:v[2],strings:s,ctor:v[1]==="."?u2:v[1]==="?"?Z2:v[1]==="@"?S2:p1}),e.removeAttribute(n)}else n.startsWith(Y)&&(i.push({type:6,index:r}),e.removeAttribute(n));if(u5.test(e.tagName)){let n=e.textContent.split(Y),A=n.length-1;if(A>0){e.textContent=Q1?Q1.emptyScript:"";for(let s=0;s<A;s++)e.append(n[s],y1()),V1.nextNode(),i.push({type:2,index:++r});e.append(n[A],y1())}}}else if(e.nodeType===8)if(e.data===x5)i.push({type:2,index:r});else{let n=-1;for(;(n=e.data.indexOf(Y,n+1))!==-1;)i.push({type:7,index:r}),n+=Y.length-1}r++}}static createElement(C,H){let V=L1.createElement("template");return V.innerHTML=C,V}};function s1(L,C,H=L,V){if(C===e1)return C;let e=V!==void 0?H._$Co?.[V]:H._$Cl,r=b1(C)?void 0:C._$litDirective$;return e?.constructor!==r&&(e?._$AO?.(!1),r===void 0?e=void 0:(e=new r(L),e._$AT(L,H,V)),V!==void 0?(H._$Co??=[])[V]=e:H._$Cl=e),e!==void 0&&(C=s1(L,e._$AS(L,C.values),e,V)),C}var x2=class{constructor(C,H){this._$AV=[],this._$AN=void 0,this._$AD=C,this._$AM=H}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(C){let{el:{content:H},parts:V}=this._$AD,e=(C?.creationScope??L1).importNode(H,!0);V1.currentNode=e;let r=V1.nextNode(),M=0,t=0,i=V[0];for(;i!==void 0;){if(M===i.index){let o;i.type===2?o=new w1(r,r.nextSibling,this,C):i.type===1?o=new i.ctor(r,i.name,i.strings,this,C):i.type===6&&(o=new h2(r,this,C)),this._$AV.push(o),i=V[++t]}M!==i?.index&&(r=V1.nextNode(),M++)}return V1.currentNode=L1,e}p(C){let H=0;for(let V of this._$AV)V!==void 0&&(V.strings!==void 0?(V._$AI(C,V,H),H+=V.strings.length-2):V._$AI(C[H])),H++}},w1=class L{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(C,H,V,e){this.type=2,this._$AH=l,this._$AN=void 0,this._$AA=C,this._$AB=H,this._$AM=V,this.options=e,this._$Cv=e?.isConnected??!0}get parentNode(){let C=this._$AA.parentNode,H=this._$AM;return H!==void 0&&C?.nodeType===11&&(C=H.parentNode),C}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(C,H=this){C=s1(this,C,H),b1(C)?C===l||C==null||C===""?(this._$AH!==l&&this._$AR(),this._$AH=l):C!==this._$AH&&C!==e1&&this._(C):C._$litType$!==void 0?this.$(C):C.nodeType!==void 0?this.T(C):A0(C)?this.k(C):this._(C)}O(C){return this._$AA.parentNode.insertBefore(C,this._$AB)}T(C){this._$AH!==C&&(this._$AR(),this._$AH=this.O(C))}_(C){this._$AH!==l&&b1(this._$AH)?this._$AA.nextSibling.data=C:this.T(L1.createTextNode(C)),this._$AH=C}$(C){let{values:H,_$litType$:V}=C,e=typeof V=="number"?this._$AC(C):(V.el===void 0&&(V.el=O1.createElement(h5(V.h,V.h[0]),this.options)),V);if(this._$AH?._$AD===e)this._$AH.p(H);else{let r=new x2(e,this),M=r.u(this.options);r.p(H),this.T(M),this._$AH=r}}_$AC(C){let H=v5.get(C.strings);return H===void 0&&v5.set(C.strings,H=new O1(C)),H}k(C){g2(this._$AH)||(this._$AH=[],this._$AR());let H=this._$AH,V,e=0;for(let r of C)e===H.length?H.push(V=new L(this.O(y1()),this.O(y1()),this,this.options)):V=H[e],V._$AI(r),e++;e<H.length&&(this._$AR(V&&V._$AB.nextSibling,e),H.length=e)}_$AR(C=this._$AA.nextSibling,H){for(this._$AP?.(!1,!0,H);C!==this._$AB;){let V=A5(C).nextSibling;A5(C).remove(),C=V}}setConnected(C){this._$AM===void 0&&(this._$Cv=C,this._$AP?.(C))}},p1=class{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(C,H,V,e,r){this.type=1,this._$AH=l,this._$AN=void 0,this.element=C,this.name=H,this._$AM=e,this.options=r,V.length>2||V[0]!==""||V[1]!==""?(this._$AH=Array(V.length-1).fill(new String),this.strings=V):this._$AH=l}_$AI(C,H=this,V,e){let r=this.strings,M=!1;if(r===void 0)C=s1(this,C,H,0),M=!b1(C)||C!==this._$AH&&C!==e1,M&&(this._$AH=C);else{let t=C,i,o;for(C=r[0],i=0;i<r.length-1;i++)o=s1(this,t[V+i],H,i),o===e1&&(o=this._$AH[i]),M||=!b1(o)||o!==this._$AH[i],o===l?C=l:C!==l&&(C+=(o??"")+r[i+1]),this._$AH[i]=o}M&&!e&&this.j(C)}j(C){C===l?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,C??"")}},u2=class extends p1{constructor(){super(...arguments),this.type=3}j(C){this.element[this.name]=C===l?void 0:C}},Z2=class extends p1{constructor(){super(...arguments),this.type=4}j(C){this.element.toggleAttribute(this.name,!!C&&C!==l)}},S2=class extends p1{constructor(C,H,V,e,r){super(C,H,V,e,r),this.type=5}_$AI(C,H=this){if((C=s1(this,C,H,0)??l)===e1)return;let V=this._$AH,e=C===l&&V!==l||C.capture!==V.capture||C.once!==V.once||C.passive!==V.passive,r=C!==l&&(V===l||e);e&&this.element.removeEventListener(this.name,this,V),r&&this.element.addEventListener(this.name,this,C),this._$AH=C}handleEvent(C){typeof this._$AH=="function"?this._$AH.call(this.options?.host??this.element,C):this._$AH.handleEvent(C)}},h2=class{constructor(C,H,V){this.element=C,this.type=6,this._$AN=void 0,this._$AM=H,this.options=V}get _$AU(){return this._$AM._$AU}_$AI(C){s1(this,C)}};var l0=f2.litHtmlPolyfillSupport;l0?.(O1,w1),(f2.litHtmlVersions??=[]).push("3.3.3");var f5=(L,C,H)=>{let V=H?.renderBefore??C,e=V._$litPart$;if(e===void 0){let r=H?.renderBefore??null;V._$litPart$=e=new w1(C.insertBefore(y1(),r),r,void 0,H??{})}return e._$AI(L),e};var b2=globalThis,y=class extends q{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){let C=super.createRenderRoot();return this.renderOptions.renderBefore??=C.firstChild,C}update(C){let H=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(C),this._$Do=f5(H,this.renderRoot,this.renderOptions)}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(!0)}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(!1)}render(){return e1}};y._$litElement$=!0,y.finalized=!0,b2.litElementHydrateSupport?.({LitElement:y});var s0=b2.litElementPolyfillSupport;s0?.({LitElement:y});(b2.litElementVersions??=[]).push("4.2.2");var E=g`
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
`,D=g`
*, *::before, *::after { box-sizing: border-box; }
button, input, select, textarea { font: inherit; }
.ms-icon { display: block; flex: none; inline-size: var(--ms-icon); block-size: var(--ms-icon); }
.ms-icon--sm { inline-size: var(--ms-icon-sm); block-size: var(--ms-icon-sm); }
`;var y5=Symbol.for(""),p0=L=>{if(L?.r===y5)return L?._$litStatic$},z=L=>({_$litStatic$:L,r:y5});var g5=new Map,O2=L=>(C,...H)=>{let V=H.length,e,r,M=[],t=[],i,o=0,a=!1;for(;o<V;){for(i=C[o];o<V&&(r=H[o],(e=p0(r))!==void 0);)i+=e+C[++o],a=!0;o!==V&&t.push(r),M.push(i),o++}if(o===V&&M.push(C[V]),a){let n=M.join("$$lit$$");(C=g5.get(n))===void 0&&(M.raw=M,g5.set(n,C=M)),H=t}return L(C,...H)},d=O2(O),h7=O2(Z5),f7=O2(S5);var b5=import.meta.url.match(/\/matic_robot\/[^/]+-([a-f0-9]{12})\/map-studio-v4(?:\/|$)/u)?.[1]??"dev",k1=b5==="dev"?"":`-${b5}`,P1=`matic-map-canvas-v4${k1}`,r1=`matic-precision-controls-v4${k1}`,m1=`matic-map-workflow-v4${k1}`,M1=`matic-map-shell-v4${k1}`,w2=`matic-map-panel-v0-4-0${k1}`;var v1=g`
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
`;var O5="M9.5,13.09L10.91,14.5L6.41,19H10V21H3V14H5V17.59L9.5,13.09M10.91,9.5L9.5,10.91L5,6.41V10H3V3H10V5H6.41L10.91,9.5M14.5,13.09L19,17.59V14H21V21H14V19H17.59L13.09,14.5L14.5,13.09M13.09,9.5L17.59,5H14V3H21V10H19V6.41L14.5,10.91L13.09,9.5Z";var w5="M20.71,4.63L19.37,3.29C19,2.9 18.35,2.9 17.96,3.29L9,12.25L11.75,15L20.71,6.04C21.1,5.65 21.1,5 20.71,4.63M7,14A3,3 0 0,0 4,17C4,18.31 2.84,19 2,19C2.92,20.22 4.5,21 6,21A4,4 0 0,0 10,17A3,3 0 0,0 7,14Z";var k5="M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z";var P5="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z";var B5="M7.41,15.41L12,10.83L16.59,15.41L18,14L12,8L6,14L7.41,15.41Z";var T5="M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z";var R5="M13,6V11H18V7.75L22.25,12L18,16.25V13H13V18H16.25L12,22.25L7.75,18H11V13H6V16.25L1.75,12L6,7.75V11H11V6H7.75L12,1.75L16.25,6H13Z";var _5="M16.24,3.56L21.19,8.5C21.97,9.29 21.97,10.55 21.19,11.34L12,20.53C10.44,22.09 7.91,22.09 6.34,20.53L2.81,17C2.03,16.21 2.03,14.95 2.81,14.16L13.41,3.56C14.2,2.78 15.46,2.78 16.24,3.56M4.22,15.58L7.76,19.11C8.54,19.9 9.8,19.9 10.59,19.11L14.12,15.58L9.17,10.63L4.22,15.58Z";var F5="M18.5,4L19.66,8.35L18.7,8.61C18.25,7.74 17.79,6.87 17.26,6.43C16.73,6 16.11,6 15.5,6H13V16.5C13,17 13,17.5 13.33,17.75C13.67,18 14.33,18 15,18V19H9V18C9.67,18 10.33,18 10.67,17.75C11,17.5 11,17 11,16.5V6H8.5C7.89,6 7.27,6 6.74,6.43C6.21,6.87 5.75,7.74 5.3,8.61L4.34,8.35L5.5,4H18.5Z";var E5="M5,5H10V7H7V10H5V5M14,5H19V10H17V7H14V5M17,14H19V19H14V17H17V14M10,17V19H5V14H7V17H10Z",D5="M14,14H19V16H16V19H14V14M5,14H10V19H8V16H5V14M8,5H10V10H5V8H8V5M19,8V10H14V5H16V8H19Z";var $5="M11,18H13V16H11V18M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M12,6A4,4 0 0,0 8,10H10A2,2 0 0,1 12,8A2,2 0 0,1 14,10C14,12 11,11.75 11,15H13C13,12.75 16,12.5 16,10A4,4 0 0,0 12,6Z";var I5="M18.4,10.6C16.55,9 14.15,8 11.5,8C6.85,8 2.92,11.03 1.54,15.22L3.9,16C4.95,12.81 7.95,10.5 11.5,10.5C13.45,10.5 15.23,11.22 16.62,12.38L13,16H22V7L18.4,10.6Z";var W5="M13,4.07V1L8.45,5.55L13,10V6.09C15.84,6.57 18,9.03 18,12C18,14.97 15.84,17.43 13,17.91V19.93C16.95,19.44 20,16.08 20,12C20,7.92 16.95,4.56 13,4.07M7.1,18.32C8.26,19.22 9.61,19.76 11,19.93V17.9C10.13,17.75 9.29,17.41 8.54,16.87L7.1,18.32M6.09,13H4.07C4.24,14.39 4.79,15.73 5.69,16.89L7.1,15.47C6.58,14.72 6.23,13.88 6.09,13M7.11,8.53L5.7,7.11C4.8,8.27 4.24,9.61 4.07,11H6.09C6.23,10.13 6.58,9.28 7.11,8.53Z";var N5="M16.89,15.5L18.31,16.89C19.21,15.73 19.76,14.39 19.93,13H17.91C17.77,13.87 17.43,14.72 16.89,15.5M13,17.9V19.92C14.39,19.75 15.74,19.21 16.9,18.31L15.46,16.87C14.71,17.41 13.87,17.76 13,17.9M19.93,11C19.76,9.61 19.21,8.27 18.31,7.11L16.89,8.53C17.43,9.28 17.77,10.13 17.91,11M15.55,5.55L11,1V4.07C7.06,4.56 4,7.92 4,12C4,16.08 7.05,19.44 11,19.93V17.91C8.16,17.43 6,14.97 6,12C6,9.03 8.16,6.57 11,6.09V10L15.55,5.55Z";var z5="M12.5,8C9.85,8 7.45,9 5.6,10.6L2,7V16H11L7.38,12.38C8.77,11.22 10.54,10.5 12.5,10.5C16.04,10.5 19.05,12.81 20.1,16L22.47,15.22C21.08,11.03 17.15,8 12.5,8Z";var U5=B5,G5=P5,Q5=O5,K5=F5,q5=$5,X5=E5,j5=D5,Y5=W5,J5=N5,C3=z5,H3=I5,V3=w5;var L3=_5,e3=R5,r3=k5;var M3=T5;var k=L=>O`<svg
  class="ms-icon"
  viewBox="0 0 24 24"
  fill="currentColor"
  aria-hidden="true"
  focusable="false"
><path d=${L}></path></svg>`;var t3=(L,C)=>Math.hypot(L.x-C.x,L.y-C.y),i3=(L,C)=>({x:(L.x+C.x)/2,y:(L.y+C.y)/2}),o3=(L,C)=>Math.atan2(C.y-L.y,C.x-L.x),m0=L=>{let C=L;for(;C>Math.PI;)C-=Math.PI*2;for(;C<-Math.PI;)C+=Math.PI*2;return C},t1=(L,C,H)=>Math.max(C,Math.min(H,L)),k2=L=>L.map(C=>({...C})),v0="button, input, select, textarea, a, [role='button'], [role='menuitem'], [data-map-control]",c1=L=>L.composedPath().some(C=>C instanceof Element&&C.matches(v0)),K1=class{#C;#H;#e;#M=new Map;#V=!1;#L="idle";#t=[];#a=[];#n=null;#o=0;#s=null;#m=0;#S=null;#A=null;#h=null;#p=0;#i=null;#c=!1;#u=null;#Z=!1;constructor(C,H,V){this.#C=C,this.#H=H,this.#e=V,C.addEventListener("pointerdown",this.#r),C.addEventListener("pointermove",this.#d),C.addEventListener("pointerup",this.#v),C.addEventListener("pointercancel",this.#v),C.addEventListener("wheel",this.#w,{passive:!1}),C.addEventListener("gesturestart",this.#g,{passive:!1}),C.addEventListener("gesturechange",this.#y,{passive:!1}),C.addEventListener("gestureend",this.#b,{passive:!1}),C.addEventListener("dblclick",this.#B),C.addEventListener("contextmenu",this.#O),C.addEventListener("keydown",this.#f),C.addEventListener("keyup",this.#P),C.addEventListener("blur",this.#k)}#r=C=>{if(this.#Z||!C.isPrimary&&C.pointerType==="mouse"||c1(C))return;this.#C.focus({preventScroll:!0}),this.#T();let H=performance.now(),V={id:C.pointerId,type:C.pointerType,startX:C.clientX,startY:C.clientY,x:C.clientX,y:C.clientY,lastX:C.clientX,lastY:C.clientY,lastTime:H,velocityX:0,velocityY:0};if(this.#M.set(C.pointerId,V),this.#C.setPointerCapture?.(C.pointerId),this.#M.size>=2){this.#_(),(this.#L==="paint"||this.#L==="erase")&&(this.#a=k2(this.#t),this.#e.onCircles(this.#a,!1)),this.#L="pinch",this.#C.classList.add("navigating"),this.#c=!0;let[t,i]=[...this.#M.values()];t&&i&&(this.#o=Math.max(1,t3(t,i)),this.#s=i3(t,i),this.#m=o3(t,i),this.#S=this.#H.camera),C.preventDefault();return}let e=this.#e.state(),r=e.workflow==="draw"&&e.map.available&&!e.floor.readOnly;this.#c||this.#V||C.button===1||C.button===2||e.draw.tool==="pan"?(this.#L="pan",this.#A=this.#H.camera):r&&(e.draw.tool==="paint"||e.draw.tool==="erase")?(this.#t=k2(e.draw.circles),this.#a=k2(e.draw.circles),C.pointerType==="touch"?(this.#L="idle",this.#u=window.setTimeout(()=>{if(this.#u=null,this.#M.size!==1||this.#c)return;this.#L=e.draw.tool;let t=this.#M.get(C.pointerId);t&&this.#l(t.x,t.y)},110)):(this.#L=e.draw.tool,this.#l(C.clientX,C.clientY))):(this.#L=e.view==="three"&&!C.shiftKey?"orbit":"pan",this.#A=this.#H.camera),(this.#L==="pan"||this.#L==="orbit")&&this.#C.classList.add("navigating"),C.preventDefault()};#d=C=>{let H=this.#M.get(C.pointerId);if(!H){let a=this.#H.screenToMap(C.clientX,C.clientY);this.#H.setCursor(a);return}let e=(C.getCoalescedEvents?.()||[]).at(-1)||C,r=performance.now(),M=Math.max(1,r-H.lastTime),t=(e.clientX-H.lastX)/M,i=(e.clientY-H.lastY)/M;if(H.velocityX=H.velocityX*.62+t*.38,H.velocityY=H.velocityY*.62+i*.38,H.lastX=e.clientX,H.lastY=e.clientY,H.lastTime=r,H.x=e.clientX,H.y=e.clientY,this.#L==="pinch"&&this.#M.size>=2){let[a,n]=[...this.#M.values()];if(!a||!n)return;let A=Math.max(1,t3(a,n)),s=i3(a,n),v=o3(a,n),x=this.#S;if(x&&this.#s){let u={...x,distance:x.distance*this.#o/A,yaw:x.yaw+m0(v-this.#m),pitch:x.orthographic?x.pitch:x.pitch-(s.y-this.#s.y)*.0035};this.#H.setCamera(this.#H.cameraAfterPan(u,s.x-this.#s.x,s.y-this.#s.y))}C.preventDefault();return}this.#L==="paint"||this.#L==="erase"?this.#l(C.clientX,C.clientY):this.#L==="pan"?this.#A&&this.#H.setCamera(this.#H.cameraAfterPan(this.#A,e.clientX-H.startX,e.clientY-H.startY)):this.#L==="orbit"&&this.#A&&this.#H.setCamera({...this.#A,yaw:this.#A.yaw+(e.clientX-H.startX)*.0045,pitch:this.#A.pitch-(e.clientY-H.startY)*.004});let o=this.#H.screenToMap(e.clientX,e.clientY);this.#H.setCursor(o),C.preventDefault()};#v=C=>{let H=this.#M.get(C.pointerId);if(!H)return;let V=this.#L;if(this.#M.delete(C.pointerId),this.#C.releasePointerCapture?.(C.pointerId),this.#_(),(this.#L==="paint"||this.#L==="erase")&&JSON.stringify(this.#a)!==JSON.stringify(this.#t))this.#e.onCircles(this.#a,!0,this.#t);else if(this.#L!=="pinch"&&!this.#c&&Math.hypot(H.x-H.startX,H.y-H.startY)<7&&this.#e.state().workflow==="rooms"){let e=this.#H.roomAt(H.x,H.y);e&&this.#e.onRoom(e)}if(this.#M.size===0)this.#L="idle",this.#C.classList.remove("navigating"),this.#c=!1,this.#s=null,this.#S=null,this.#A=null,this.#n=null,(V==="pan"||V==="orbit")&&H.type!=="mouse"&&this.#R(H.velocityX,H.velocityY,V);else if(this.#L==="pinch"){this.#L="pan",this.#c=!0;let e=this.#M.values().next().value;e&&(e.startX=e.x,e.startY=e.y,e.velocityX=0,e.velocityY=0),this.#A=this.#H.camera,this.#S=null}C.preventDefault()};#l(C,H){let V=this.#H.screenToMap(C,H);if(!V)return;let r=this.#e.state().draw.brushMeters/2;if(this.#L==="erase")this.#a=this.#a.filter(M=>Math.hypot(M.x-V.x,M.y-V.y)>M.radius+r);else{if(!this.#H.containsMapPoint(V))return;let M=Math.max(.04,r*.55),t=this.#n||V,i=Math.hypot(V.x-t.x,V.y-t.y),o=Math.max(1,Math.ceil(i/M));for(let a=0;a<=o&&this.#a.length<512;a+=1){let n=a/o,A={x:t.x+(V.x-t.x)*n,y:t.y+(V.y-t.y)*n};this.#a.some(s=>Math.hypot(s.x-A.x,s.y-A.y)<Math.max(.025,r*.28))||this.#a.push({x:Math.round(A.x*1e4)/1e4,y:Math.round(A.y*1e4)/1e4,radius:Math.round(r*100)/100})}}this.#n=V,this.#e.onCircles(this.#a,!1)}#w=C=>{if(c1(C))return;C.preventDefault(),this.#C.focus({preventScroll:!0}),this.#T();let H=C.deltaMode===WheelEvent.DOM_DELTA_LINE?16:C.deltaMode===WheelEvent.DOM_DELTA_PAGE?Math.max(1,this.#C.clientHeight):1,V=C.deltaX*H,e=C.deltaY*H;if(C.ctrlKey||C.metaKey){this.#H.zoomAt(Math.exp(t1(-e*.008,-.28,.28)),C.clientX,C.clientY);return}if(C.altKey&&this.#e.state().view==="three"){this.#H.orbitBy(0,t1(e,-80,80)*.75);return}if(C.deltaMode!==WheelEvent.DOM_DELTA_PIXEL||Math.abs(V)<.5&&Math.abs(e)>=50){this.#H.zoomAt(Math.exp(t1(-e*.0025,-.28,.28)),C.clientX,C.clientY);return}this.#H.panBy(-t1(V,-80,80),-t1(e,-80,80))};#g=C=>{this.#Z||c1(C)||(this.#C.focus({preventScroll:!0}),this.#T(),this.#C.classList.add("navigating"),this.#h=this.#H.camera,this.#p=Number.isFinite(C.rotation)?C.rotation:0,C.preventDefault())};#y=C=>{if(this.#Z||c1(C))return;let H=this.#h;if(!H||this.#M.size>=2)return;let V=Number.isFinite(C.scale)&&C.scale>0?Math.max(.1,C.scale):1,e=Number.isFinite(C.rotation)?C.rotation:0;this.#H.setCamera({...H,distance:H.distance/V,yaw:H.yaw+(e-this.#p)*Math.PI/180}),C.preventDefault()};#b=C=>{this.#h=null,this.#p=0,this.#C.classList.remove("navigating"),C.preventDefault()};#f=C=>{if(C.defaultPrevented||C.ctrlKey||C.metaKey||C.altKey)return;if(C.code==="Space"){this.#V=!0,C.preventDefault();return}this.#T();let H=this.#e.state(),V=C.key.toLocaleLowerCase();if(C.key==="+"||C.key==="=")this.#H.zoomAt(1.25);else if(C.key==="-")this.#H.zoomAt(.8);else if(C.key==="0")this.#H.fit();else if(V==="3")this.#x({type:"set-view",view:"three"});else if(V==="t")this.#x({type:"set-view",view:"top"});else if(C.key==="[")this.#H.orbitBy(-40,0);else if(C.key==="]")this.#H.orbitBy(40,0);else if(C.key==="PageUp")this.#H.orbitBy(0,-30);else if(C.key==="PageDown")this.#H.orbitBy(0,30);else if(V==="d"&&H.workflow==="draw")this.#x({type:"set-draw-tool",tool:"paint"});else if(V==="e"&&H.workflow==="draw")this.#x({type:"set-draw-tool",tool:"erase"});else if(["arrowleft","arrowright","arrowup","arrowdown"].includes(V))if(H.view==="three"&&!C.shiftKey){let e=V==="arrowleft"?-24:V==="arrowright"?24:0,r=V==="arrowup"?-20:V==="arrowdown"?20:0;this.#H.orbitBy(e,r)}else{let e=V==="arrowleft"?30:V==="arrowright"?-30:0,r=V==="arrowup"?30:V==="arrowdown"?-30:0;this.#H.panBy(e,r)}else if(H.workflow!=="draw"&&["w","a","s","d"].includes(V))this.#H.panBy(V==="a"?34:V==="d"?-34:0,V==="w"?34:V==="s"?-34:0);else if(H.workflow!=="draw"&&(V==="q"||V==="e"))this.#H.orbitBy(V==="q"?-30:30,0);else return;C.preventDefault()};#P=C=>{C.code==="Space"&&(this.#V=!1)};#k=()=>{this.#V=!1,this.#_(),this.#H.setCursor(null),this.#C.classList.remove("navigating")};#B=C=>{c1(C)||(this.#T(),this.#H.zoomAt(C.shiftKey?1/1.6:1.6,C.clientX,C.clientY),C.preventDefault())};#O=C=>{c1(C)||C.preventDefault()};#x(C){this.#C.dispatchEvent(new CustomEvent("matic-workspace-intent",{detail:C,bubbles:!0,composed:!0}))}#R(C,H,V){if(window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;let e=t1(C,-.55,.55),r=t1(H,-.55,.55);if(Math.hypot(e,r)<.02)return;let M=performance.now(),t=i=>{let o=Math.min(32,i-M);M=i,V==="orbit"?this.#H.orbitBy(e*o,r*o):this.#H.panBy(e*o,r*o);let a=.9**(o/16);e*=a,r*=a,Math.hypot(e,r)>=.01?this.#i=window.requestAnimationFrame(t):this.#i=null};this.#i=window.requestAnimationFrame(t)}#T(){this.#i!==null&&window.cancelAnimationFrame(this.#i),this.#i=null}#_(){this.#u!==null&&window.clearTimeout(this.#u),this.#u=null}dispose(){this.#Z||(this.#Z=!0,this.#_(),this.#T(),this.#C.removeEventListener("pointerdown",this.#r),this.#C.removeEventListener("pointermove",this.#d),this.#C.removeEventListener("pointerup",this.#v),this.#C.removeEventListener("pointercancel",this.#v),this.#C.removeEventListener("wheel",this.#w),this.#C.removeEventListener("gesturestart",this.#g),this.#C.removeEventListener("gesturechange",this.#y),this.#C.removeEventListener("gestureend",this.#b),this.#C.removeEventListener("dblclick",this.#B),this.#C.removeEventListener("contextmenu",this.#O),this.#C.removeEventListener("keydown",this.#f),this.#C.removeEventListener("keyup",this.#P),this.#C.removeEventListener("blur",this.#k),this.#M.clear())}};var R=(L,C)=>`rgba(${L[0]},${L[1]},${L[2]},${C})`;var B=(L,C,H)=>Math.max(C,Math.min(H,L)),B1=L=>{let C=L;for(;C>Math.PI;)C-=Math.PI*2;for(;C<-Math.PI;)C+=Math.PI*2;return C},c0=L=>{switch(L){case"efficient":return .35;case"balanced":return .65;case"maximum":case"auto":return 1}},x0={accent:[6,120,206],onAccent:[255,255,255],text:[38,50,56],quiet:[75,92,105],plate:[250,252,253],roomFill:[231,238,242],forced:!1},n3=Math.PI/3.15,u0=1.08,Z0=(L,C)=>{let H=n3/2,V=Math.atan(Math.tan(H)*Math.max(.2,C));return L/Math.sin(Math.min(H,V))*u0},S0=(L,C)=>{let H=new Float32Array(16);for(let V=0;V<4;V+=1)for(let e=0;e<4;e+=1){let r=0;for(let M=0;M<4;M+=1)r+=(L[M*4+e]??0)*(C[V*4+M]??0);H[V*4+e]=r}return H},h0=(L,C,H,V)=>{let e=1/Math.tan(L/2),r=new Float32Array(16);return r[0]=e/C,r[5]=e,r[10]=(V+H)/(H-V),r[11]=-1,r[14]=2*V*H/(H-V),r},f0=(L,C,H,V,e,r)=>{let M=new Float32Array(16);return M[0]=2/(C-L),M[5]=2/(V-H),M[10]=-2/(r-e),M[12]=-(C+L)/(C-L),M[13]=-(V+H)/(V-H),M[14]=-(r+e)/(r-e),M[15]=1,M},g0=(L,C)=>{let H=Math.hypot((L[0]??0)-(C[0]??0),(L[1]??0)-(C[1]??0),(L[2]??0)-(C[2]??0))||1,V=[((L[0]??0)-(C[0]??0))/H,((L[1]??0)-(C[1]??0))/H,((L[2]??0)-(C[2]??0))/H],e=Math.hypot(V[2]??0,V[0]??0)||1,r=[(V[2]??0)/e,0,-(V[0]??0)/e],M=[(V[1]??0)*(r[2]??0),(V[2]??0)*(r[0]??0)-(V[0]??0)*(r[2]??0),-(V[1]??0)*(r[0]??0)];return new Float32Array([r[0]??0,M[0]??0,V[0]??0,0,r[1]??0,M[1]??0,V[1]??0,0,r[2]??0,M[2]??0,V[2]??0,0,-((r[0]??0)*(L[0]??0)+(r[1]??0)*(L[1]??0)+(r[2]??0)*(L[2]??0)),-((M[0]??0)*(L[0]??0)+(M[1]??0)*(L[1]??0)+(M[2]??0)*(L[2]??0)),-((V[0]??0)*(L[0]??0)+(V[1]??0)*(L[1]??0)+(V[2]??0)*(L[2]??0)),1])},a3=(L,C,H)=>{let V=!1,e=H.at(-1);if(!e)return!1;for(let r of H){let[M,t]=r,[i,o]=e;t>C!=o>C&&L<(i-M)*(C-t)/(o-t)+M&&(V=!V),e=r}return V},q1=class{#C;#H;#e;#M=null;#V=null;#L=null;#t=null;#a=null;#n=null;#o=null;#s=null;#m=null;#S=null;#A=null;#h=null;#p=null;#i=null;#c=null;#u=null;#Z;#r={yaw:-Math.PI/4,pitch:.82,distance:12,targetX:0,targetZ:0,orthographic:!1};#d=12;#v=8;#l=4;#w=new Float32Array(16);#g=null;#y="unavailable";#b=0;#f=0;#P=0;#k=0;#B=1;#O={width:1,height:1,left:0,top:0};#x=!0;#R=!1;#T=x0;constructor(C,H,V={}){this.#C=C,this.#H=H,this.#e=V,this.#V=H.getContext("2d",{alpha:!0}),this.#C.addEventListener("webglcontextlost",this.#X),this.#C.addEventListener("webglcontextrestored",this.#j),this.#z(),this.#Z=new ResizeObserver(()=>{let e=this.#d,r=this.#v;this.#U(),this.#x&&(e!==this.#d||r!==this.#v)?this.fit(!1):this.requestRender()}),this.#Z.observe(C)}get camera(){return{...this.#r}}#_(){return{minimum:Math.max(.2,this.#l*.04),maximum:this.#l*8}}#W(){let C=this.#i?.metadata.span,H=this.#i?.metadata.metersPerCell;return!C||H===void 0?{x:this.#l,z:this.#l}:{x:Math.max(.5,C[0]*H*.55),z:Math.max(.5,C[1]*H*.55)}}setCamera(C,H=!0){let V=this.#_(),e=this.#W();this.#r={yaw:B1(C.yaw),pitch:C.orthographic?Math.PI/2-.018:B(C.pitch,.18,1.38),distance:B(C.distance,V.minimum,V.maximum),targetX:B(C.targetX,-e.x,e.x),targetZ:B(C.targetZ,-e.z,e.z),orthographic:C.orthographic},this.#x=!1,this.requestRender(),H&&this.#D()}cameraAfterPan(C,H,V){let e=this.#F(),r=C.distance*1.75/Math.max(200,e.height),M=Math.cos(C.yaw),t=-Math.sin(C.yaw),i=-Math.sin(C.yaw),o=-Math.cos(C.yaw),a=this.#W();return{...C,targetX:B(C.targetX-H*r*M+V*r*i,-a.x,a.x),targetZ:B(C.targetZ-H*r*t+V*r*o,-a.z,a.z)}}setState(C){if(this.#R)return;let H=this.#p;this.#p=C;let V=C.resources.scene.value;V!==this.#i&&(this.#i=V,this.#C1(V)),(!H||H.quality!==C.quality)&&(this.#B=c0(C.quality),this.#k=0);let e=H?.workflow!=="draw"&&C.workflow==="draw",r=H?.workflow==="draw"&&C.workflow!=="draw";if(!H||H.view!==C.view||e||r){let M=C.workflow==="draw"?"top":C.view;this.#r=this.#Y(M,C),this.#x=this.#J(M,C)}C.workflow==="draw"&&H?.draw.zoomPercent!==C.draw.zoomPercent&&(this.#r={...this.#r,orthographic:!0,pitch:Math.PI/2-.018,distance:this.#v*100/C.draw.zoomPercent},this.#x=C.draw.zoomPercent===100&&Math.abs(this.#r.targetX)<.001&&Math.abs(this.#r.targetZ)<.001&&Math.abs(B1(this.#r.yaw))<.001),this.requestRender()}#Y(C,H){let V=C==="top",e=V?this.#v:this.#d,r=H.cameras[C];return r?{yaw:r.yaw,pitch:V?Math.PI/2-.018:r.pitch,distance:B(e/B(r.zoom,.01,100),Math.max(.2,this.#l*.04),this.#l*8),targetX:B(r.targetX,-this.#l,this.#l),targetZ:B(r.targetZ,-this.#l,this.#l),orthographic:V}:V?{yaw:0,pitch:Math.PI/2-.018,distance:e,targetX:0,targetZ:0,orthographic:!0}:{yaw:-Math.PI/4,pitch:.82,distance:e,targetX:0,targetZ:0,orthographic:!1}}#J(C,H){let V=H.cameras[C];if(!V)return!0;let e=C==="top";return Math.abs(V.zoom-1)<.001&&Math.abs(V.targetX)<.001&&Math.abs(V.targetZ)<.001&&Math.abs(B1(V.yaw-(e?0:-Math.PI/4)))<.001&&(e||Math.abs(V.pitch-.82)<.001)}#N(C,H){let V=this.#M;if(!V)throw new Error("webgl-unavailable");let e=V.createShader(C);if(!e)throw new Error("shader-unavailable");if(V.shaderSource(e,H),V.compileShader(e),!V.getShaderParameter(e,V.COMPILE_STATUS))throw V.deleteShader(e),new Error("shader-failed");return e}#z(){try{this.#M=this.#C.getContext("webgl2",{alpha:!0,antialias:!0,depth:!0,powerPreference:"high-performance"});let C=this.#M;if(!C)throw new Error("webgl2-unavailable");let H=this.#N(C.VERTEX_SHADER,`#version 300 es
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
      `),V=this.#N(C.FRAGMENT_SHADER,`#version 300 es
        precision highp float;
        in vec3 vColor;
        out vec4 outColor;
        void main() {
          vec2 point = gl_PointCoord * 2.0 - 1.0;
          if (dot(point, point) > 1.0) discard;
          float edge = smoothstep(1.0, 0.72, dot(point, point));
          outColor = vec4(pow(vColor, vec3(0.94)), edge);
        }
      `),e=C.createProgram();if(!e)throw new Error("program-unavailable");if(C.attachShader(e,H),C.attachShader(e,V),C.linkProgram(e),C.deleteShader(H),C.deleteShader(V),!C.getProgramParameter(e,C.LINK_STATUS))throw new Error("program-failed");this.#a=e,this.#s=C.getUniformLocation(e,"uViewProjection"),this.#m=C.getUniformLocation(e,"uCenter"),this.#S=C.getUniformLocation(e,"uMetersPerCell"),this.#A=C.getUniformLocation(e,"uPointPixels"),this.#h=C.getUniformLocation(e,"uMaxPointPixels"),this.#n=C.createBuffer(),this.#o=C.createVertexArray(),C.bindVertexArray(this.#o),C.bindBuffer(C.ARRAY_BUFFER,this.#n),C.enableVertexAttribArray(0),C.vertexAttribIPointer(0,2,C.UNSIGNED_SHORT,8,0),C.enableVertexAttribArray(1),C.vertexAttribIPointer(1,1,C.UNSIGNED_BYTE,8,4),C.enableVertexAttribArray(2),C.vertexAttribPointer(2,3,C.UNSIGNED_BYTE,!0,8,5),C.bindVertexArray(null),C.enable(C.DEPTH_TEST),C.depthFunc(C.LEQUAL),C.enable(C.BLEND),C.blendFunc(C.SRC_ALPHA,C.ONE_MINUS_SRC_ALPHA),this.#y="webgl2",this.#b+=1,this.#i&&this.#G(this.#i)}catch{this.#$(),this.#Q()}}#C1(C){if(this.#q(),!C){this.#f=0,this.requestRender();return}let[H,V]=C.metadata.span,e=C.metadata.metersPerCell,r=H*e,M=V*e;this.#l=Math.max(1,Math.hypot(r,M)/2),this.#U(),this.fit(!1),this.#y==="webgl2"?this.#G(C):this.#K(C)}#U(){let C=this.#i;if(!C)return;let[H,V]=C.metadata.span,e=C.metadata.metersPerCell,r=H*e,M=V*e,t=this.#F(),i=Math.max(.2,t.width/Math.max(1,t.height));this.#d=Z0(this.#l,i),this.#v=Math.max(M/2,r/(2*i))*1.12}#G(C){let H=this.#M;if(!H||!this.#n)return;let V=new Uint8Array(C.buffer,C.pointOffset,C.total*8);H.bindBuffer(H.ARRAY_BUFFER,this.#n),H.bufferData(H.ARRAY_BUFFER,V,H.STATIC_DRAW),this.#f=C.total}#Q(){this.#y="canvas2d",this.#t=document.createElement("canvas"),this.#t.width=1024,this.#t.height=1024,this.#L=this.#t.getContext("2d",{alpha:!0}),this.#L?this.#i&&this.#K(this.#i):(this.#y="unavailable",this.#e.onProblem?.("renderer-unavailable"))}#K(C){let H=this.#L;if(!H||!this.#t)return;H.clearRect(0,0,this.#t.width,this.#t.height);let V=new DataView(C.buffer,C.pointOffset,C.total*8),e=Math.min(C.total,5e4),r=Math.max(1,Math.ceil(C.total/e)),M=0,t=0,i=()=>{if(this.#R||C!==this.#i||!this.#t)return;let o=Math.min(C.total,M+r*4e3);for(;M<o;M+=r){let a=M*8,n=V.getUint16(a,!0)/Math.max(1,C.metadata.span[0])*this.#t.width,A=V.getUint16(a+2,!0)/Math.max(1,C.metadata.span[1])*this.#t.height,s=V.getUint8(a+5),v=V.getUint8(a+6),x=V.getUint8(a+7);H.fillStyle=`rgb(${s} ${v} ${x})`,H.fillRect(n,A,1.5,1.5),t+=1}this.#f=t,this.requestRender(),M<C.total?this.#u=window.setTimeout(i,0):this.#u=null};i()}#q(){this.#u!==null&&window.clearTimeout(this.#u),this.#u=null}#F(){let C=this.#C.getBoundingClientRect();return this.#O={width:C.width,height:C.height,left:C.left,top:C.top},this.#O}#H1(){let C=this.#F(),H=Math.min(window.devicePixelRatio||1,3),V=Math.max(1,Math.round(C.width*H)),e=Math.max(1,Math.round(C.height*H));for(let r of[this.#C,this.#H])(r.width!==V||r.height!==e)&&(r.width=V,r.height=e)}#V1(){let C=this.#O,H=Math.max(.2,C.width/Math.max(1,C.height)),V=Math.cos(this.#r.pitch)*this.#r.distance,e=[this.#r.targetX+Math.sin(this.#r.yaw)*V,Math.sin(this.#r.pitch)*this.#r.distance,this.#r.targetZ+Math.cos(this.#r.yaw)*V],r=[this.#r.targetX,0,this.#r.targetZ],M=g0(e,r),t=this.#r.orthographic?f0(-this.#r.distance*H,this.#r.distance*H,-this.#r.distance,this.#r.distance,-this.#l*4,this.#l*4):h0(n3,H,.02,Math.max(60,this.#l*12));return S0(t,M)}requestRender(){this.#c!==null||this.#R||(this.#c=window.requestAnimationFrame(()=>{this.#c=null,this.#L1()}))}#L1(){let C=performance.now();this.#H1(),this.#w=this.#V1(),this.#y==="webgl2"?this.#e1():this.#r1(),this.#t1(),this.#P=performance.now()-C,this.#P>18?(this.#k+=1,this.#k>=3&&this.#p?.quality==="auto"&&(this.#B=Math.max(.25,this.#B*.75))):this.#k=Math.max(0,this.#k-1)}#e1(){let C=this.#M,H=this.#i;if(!C||(C.viewport(0,0,this.#C.width,this.#C.height),C.clearColor(0,0,0,0),C.clear(C.COLOR_BUFFER_BIT|C.DEPTH_BUFFER_BIT),!H||!this.#a||!this.#o))return;if(this.#p?.view==="top"&&this.#p.appearance==="rooms"){this.#f=0;return}C.useProgram(this.#a),C.bindVertexArray(this.#o),C.uniformMatrix4fv(this.#s,!1,this.#w),C.uniform2f(this.#m,(H.metadata.span[0]-1)/2,(H.metadata.span[1]-1)/2),C.uniform1f(this.#S,H.metadata.metersPerCell);let V=Math.min(window.devicePixelRatio||1,3),e=Math.max(1,Math.floor(H.total*this.#B)),r=Math.min(H.floorCount,e),M=Math.min(H.surfaceCount,Math.max(0,e-r));C.uniform1f(this.#A,this.#C.height*.038),C.uniform1f(this.#h,4.5*V),C.drawArrays(C.POINTS,0,r),C.uniform1f(this.#A,this.#C.height*.05),C.uniform1f(this.#h,7*V),C.drawArrays(C.POINTS,H.floorCount,M),C.bindVertexArray(null),this.#f=r+M}#r1(){}#M1(C,H,V=0){let e=this.#i;return e?[-(C-(e.metadata.span[0]-1)/2)*e.metadata.metersPerCell,V*e.metadata.metersPerCell,(H-(e.metadata.span[1]-1)/2)*e.metadata.metersPerCell]:null}#I(C,H,V=0,e=!0){let r=this.#M1(C,H,V);if(!r)return null;let[M,t,i]=r,o=this.#w,a=(o[0]??0)*M+(o[4]??0)*t+(o[8]??0)*i+(o[12]??0),n=(o[1]??0)*M+(o[5]??0)*t+(o[9]??0)*i+(o[13]??0),A=(o[3]??0)*M+(o[7]??0)*t+(o[11]??0)*i+(o[15]??0);if(A<=.001)return null;let s=a/A,v=n/A;if(!Number.isFinite(s)||!Number.isFinite(v)||e&&(Math.abs(s)>1.15||Math.abs(v)>1.15))return null;let x=this.#O;return{x:(s*.5+.5)*x.width,y:(-v*.5+.5)*x.height}}#E(C,H,V=0){let e=this.#i;if(!e)return null;let r=C/e.metadata.metersPerCell-e.metadata.origin[0],M=H/e.metadata.metersPerCell-e.metadata.origin[1];return this.#I(r,M,V)}#t1(){let C=this.#V,H=this.#i,V=this.#p;if(!C)return;let e=Math.min(window.devicePixelRatio||1,3),r=this.#O;if(C.setTransform(e,0,0,e,0,0),C.clearRect(0,0,r.width,r.height),!H||!V)return;let M=this.#T;if(this.#y==="canvas2d"&&this.#t&&!(V.view==="top"&&V.appearance==="rooms")){let a=this.#v/this.#r.distance,n=r.width*a,A=r.height*a,s=(r.width-n)/2-this.#r.targetX*32*a,v=(r.height-A)/2-this.#r.targetZ*32*a;C.drawImage(this.#t,s,v,n,A)}let t=this.#i1(V);if(V.labelsVisible||V.view==="top"&&V.appearance==="rooms"){C.lineWidth=1.5,C.font="600 12px system-ui, sans-serif",C.textAlign="center",C.textBaseline="middle";let a=[];for(let n of H.metadata.rooms){let A=t.has(n.name.toLocaleLowerCase());C.strokeStyle=A?R(M.accent,1):R(M.quiet,.7),C.fillStyle=A?R(M.accent,.26):V.view==="top"&&V.appearance==="rooms"?R(M.roomFill,.94):R(M.plate,.04),C.beginPath();let s=Math.max(1,Math.ceil(n.boundary.length/512)),v=!1;for(let S=0;S<n.boundary.length;S+=s){let Z=n.boundary[S];if(!Z)continue;let f=this.#I(Z[0],Z[1],.2,!1);f&&(v?C.lineTo(f.x,f.y):C.moveTo(f.x,f.y),v=!0)}if(v&&(C.closePath(),C.fill(),C.stroke()),!V.labelsVisible)continue;let x=this.#I(n.center[0],n.center[1],1);if(!x)continue;let u=C.measureText(n.name).width,m=new DOMRect(x.x-u/2-6,x.y-10,u+12,20);a.some(S=>m.left<S.right+8&&m.right+8>S.left&&m.top<S.bottom+4&&m.bottom+4>S.top)||(a.push(m),C.fillStyle=R(M.plate,.88),C.fillRect(m.x,m.y,m.width,m.height),C.fillStyle=R(M.text,1),C.fillText(n.name,x.x,x.y))}}let i=V.draw.circles;if((V.workflow==="draw"||V.workflow==="areaReview")&&i.length){C.fillStyle=R(M.accent,.22),C.strokeStyle=R(M.accent,.92),C.lineWidth=1.5;for(let a of i)this.#o1(C,a)}if(this.#g&&V.workflow==="draw"&&V.draw.tool!=="pan"){let a=this.#E(this.#g.x,this.#g.y),n=this.#E(this.#g.x+V.draw.brushMeters/2,this.#g.y);a&&n&&(C.beginPath(),C.arc(a.x,a.y,Math.max(2,Math.hypot(n.x-a.x,n.y-a.y)),0,Math.PI*2),C.strokeStyle=R(M.accent,1),C.lineWidth=2,C.stroke())}let o=V.resources.pose.value;if(V.map.exactPose&&o?.position&&V.dataMode==="live"){let a=this.#E(o.position[0],o.position[1],3);a&&(C.beginPath(),C.arc(a.x,a.y,7,0,Math.PI*2),C.fillStyle=R(M.accent,1),C.fill(),C.strokeStyle=R(M.onAccent,1),C.lineWidth=3,C.stroke())}}#i1(C){let H=C.resources.plans.value?.rooms||C.resources.areas.value?.rooms||[];return new Set(H.filter(V=>C.selection.roomIds.includes(V.roomId)).map(V=>V.name.toLocaleLowerCase()))}#o1(C,H){let V=this.#E(H.x,H.y),e=this.#E(H.x+H.radius,H.y);!V||!e||(C.beginPath(),C.arc(V.x,V.y,Math.max(1,Math.hypot(e.x-V.x,e.y-V.y)),0,Math.PI*2),C.fill(),C.stroke())}setPalette(C){this.#T=C,this.requestRender()}setCursor(C){this.#g=C,this.requestRender()}screenToMap(C,H){let V=this.#i;if(!V||!this.#r.orthographic)return null;let e=this.#F();if(!e.width||!e.height)return null;let r=this.#r.distance*2/e.height,M=this.#r.targetX+(C-e.left-e.width/2)*r,t=this.#r.targetZ+(H-e.top-e.height/2)*r,i=-M/V.metadata.metersPerCell+(V.metadata.span[0]-1)/2,o=t/V.metadata.metersPerCell+(V.metadata.span[1]-1)/2;return{x:(i+V.metadata.origin[0])*V.metadata.metersPerCell,y:(o+V.metadata.origin[1])*V.metadata.metersPerCell}}roomAt(C,H){let V=this.screenToMap(C,H),e=this.#i,r=this.#p;if(!V||!e||!r)return null;let M=V.x/e.metadata.metersPerCell-e.metadata.origin[0],t=V.y/e.metadata.metersPerCell-e.metadata.origin[1],i=e.metadata.rooms.find(o=>a3(M,t,o.boundary));return i?this.#a1(i,r):null}containsMapPoint(C){let H=this.#i;if(!H)return!1;let V=C.x/H.metadata.metersPerCell-H.metadata.origin[0],e=C.y/H.metadata.metersPerCell-H.metadata.origin[1];return H.metadata.rooms.some(r=>a3(V,e,r.boundary))}#a1(C,H){return(H.resources.plans.value?.rooms||H.resources.areas.value?.rooms||[]).find(e=>e.name.localeCompare(C.name,void 0,{sensitivity:"base"})===0)?.roomId||C.id}selectRoomAt(C,H){let V=this.roomAt(C,H);V&&this.#e.onRoom?.(V)}fit(C=!0){let H=this.#p?.view==="top"||this.#p?.workflow==="draw";this.#r=H?{yaw:0,pitch:Math.PI/2-.018,distance:this.#v,targetX:0,targetZ:0,orthographic:!0}:{yaw:-Math.PI/4,pitch:.82,distance:this.#d,targetX:0,targetZ:0,orthographic:!1},this.#x=!0,this.requestRender(),C&&this.#D()}zoomAt(C,H,V){let e=H===void 0||V===void 0?null:this.screenToMap(H,V),r=this.#_();if(this.#r={...this.#r,distance:B(this.#r.distance/C,r.minimum,r.maximum)},this.#x=!1,e&&H!==void 0&&V!==void 0){let M=this.screenToMap(H,V);M&&(this.#r={...this.#r,targetX:this.#r.targetX-(e.x-M.x),targetZ:this.#r.targetZ+(e.y-M.y)})}this.requestRender(),this.#D(H,V)}panBy(C,H){this.setCamera(this.cameraAfterPan(this.#r,C,H))}orbitBy(C,H){if(this.#r.orthographic){this.panBy(C,H);return}this.#r={...this.#r,yaw:B1(this.#r.yaw+C*.006),pitch:B(this.#r.pitch-H*.004,.18,1.38)},this.#x=!1,this.requestRender(),this.#D()}rotateBy(C){this.#r={...this.#r,yaw:B1(this.#r.yaw+C)},this.#x=!1,this.requestRender(),this.#D()}#D(C,H){let V=this.#r.orthographic?this.#v:this.#d,e=C===void 0||H===void 0?this.#O:this.#F(),r=C===void 0||H===void 0||!e.width||!e.height?void 0:{xPercent:B((C-e.left)/e.width*100,0,100),yPercent:B((H-e.top)/e.height*100,0,100)};this.#e.onCamera?.(this.camera,Math.round(V/this.#r.distance*100),r)}diagnostics(){return{mode:this.#y,contextGeneration:this.#b,sceneRevision:this.#i?.revision??null,sourcePoints:this.#i?.total??0,renderedPoints:this.#f,lastFrameMs:Math.round(this.#P*100)/100,slowFrames:this.#k,cameraDistance:this.#r.distance,fitDistance:this.#r.orthographic?this.#v:this.#d,fitActive:this.#x}}#X=C=>{C.preventDefault(),this.#$(),this.#Q(),this.requestRender()};#j=()=>{this.#$(),this.#z(),this.requestRender()};#$(){let C=this.#M;C&&(this.#n&&C.deleteBuffer(this.#n),this.#o&&C.deleteVertexArray(this.#o),this.#a&&C.deleteProgram(this.#a)),this.#n=null,this.#o=null,this.#a=null,this.#M=null}dispose(){this.#R||(this.#R=!0,this.#Z.disconnect(),this.#C.removeEventListener("webglcontextlost",this.#X),this.#C.removeEventListener("webglcontextrestored",this.#j),this.#c!==null&&window.cancelAnimationFrame(this.#c),this.#c=null,this.#q(),this.#$(),this.#t=null,this.#L=null,this.#V=null,this.#i=null,this.#p=null)}};var A3="component.matic_robot.common.",T=(L,C,H,V)=>{let e=V?{...V}:void 0,r=L?.(`${A3}${C}`,e);return r&&r!==`${A3}${C}`?r:V?Object.entries(V).reduce((M,[t,i])=>M.replaceAll(`{${t}}`,String(i)),H):H};var i1="matic-workspace-intent",X1="matic-workspace-action",d3=(L,C)=>{let H=(e,r,M)=>T(C,e,r,M);if(!d1(L))return H("v4_private_map_unavailable","The current private map is not available.");if(L.dataMode==="history")return H("v4_saved_map_description","Saved read-only map for {floor}. Live robot position is hidden.",{floor:L.floor.displayName});let V=X2(L)?H("v4_robot_position_verified","The robot position is verified."):H("v4_robot_position_hidden","The robot position is not shown.");return H("v4_live_map_description","Live map for {floor}. {pose}",{floor:L.floor.displayName,pose:V})},P2=class extends y{constructor(){super(...arguments);this.state=w();this.#C=null;this.#H=null;this.#e=null;this.#M=!1}static{this.properties={state:{attribute:!1},localize:{attribute:!1}}}static{this.styles=[E,D,v1,g`
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

.map-tools, .view-switch, .appearance-switch, .camera-steps, .draw-tools, .map-scale, .map-message { position: absolute; z-index: 4; }

.map-tools { inset-block-start: 0.75rem; inset-inline-end: 0.75rem; display: flex; }

    .navigation-help {
      position: absolute;
      z-index: 5;
      inset-block-start: 4.25rem;
      inset-inline-end: 0.75rem;
      inline-size: min(22rem, calc(100% - 1.5rem));
      padding: 0.8rem 0.9rem;
      border: 1px solid var(--divider-color, rgb(60 75 85 / 16%));
      border-radius: 0.8rem;
      color: var(--primary-text-color, #263238);
      background: var(--card-background-color, rgb(255 255 255 / 98%));
      box-shadow: 0 10px 26px rgb(31 41 51 / 18%);
      font-size: 0.74rem;
      line-height: 1.45;
    }
    .navigation-help dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.35rem 0.65rem; margin: 0; }
    .navigation-help dt { font-weight: 750; }
    .navigation-help dd { margin: 0; color: var(--secondary-text-color, #687984); }

.view-switch { inset-block-start: 4.25rem; inset-inline-end: 0.75rem; display: grid; grid-template-columns: 1fr 1fr; }
.appearance-switch, .camera-steps { position: absolute; z-index: 4; inset-block-start: 7.2rem; inset-inline-end: 0.75rem; display: grid; }
.appearance-switch { grid-template-columns: 1fr 1fr; }
.camera-steps { grid-template-columns: repeat(2, var(--ms-control)); }

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

.draw-tools {
inset-inline-start: 50%;
inset-block-end: calc(0.75rem + var(--map-sheet-offset, 0px));
translate: -50% 0;
display: grid;
grid-template-columns: repeat(6, minmax(var(--ms-control), auto));
max-inline-size: calc(100% - 1rem);
}
.draw-tools button { padding-inline: var(--ms-space-2); }

    .map-root[data-full-map="true"] .draw-tools { inset-block-end: 5.75rem; }
    .map-root[data-full-map="true"] .map-scale { inset-block-end: 10rem; }

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
.map-tools button, .draw-tools button { padding-inline: 0; inline-size: var(--ms-control); }
/* Collapse the label to assistive text, never display:none. Hiding it would
   delete the accessible name and break every getByRole({ name }) query at
   narrow widths -- which is what the previous font-size:0 plus ::first-letter
   trick did, while also rendering the toolbar as "P E M U R D". */
.ms-btn__label { position: absolute; overflow: hidden; inline-size: 1px; block-size: 1px; margin: -1px; padding: 0; border: 0; clip-path: inset(50%); white-space: nowrap; }
}
@media (forced-colors: active) {
/* The map is painted to canvas, so the UA would otherwise invert it. The
   previous block here targeted the mock-map layer that the renderer replaced,
   which meant the map had no forced-colors treatment at all. */
.scene-canvas, .overlay-canvas { forced-color-adjust: none; }
.map-root { border: 1px solid CanvasText; }
}
  `]}#C;#H;#e;#M;#V(H,V,e){return T(this.localize,H,V,e)}firstUpdated(){let H=this.renderRoot.querySelector(".map-root"),V=this.renderRoot.querySelector(".scene-canvas"),e=this.renderRoot.querySelector(".overlay-canvas");!H||!V||!e||(this.#H=new q1(V,e,{onCamera:(r,M,t)=>{this.#L({type:"set-camera",view:this.state.workflow==="draw"?"top":this.state.view,camera:{yaw:r.yaw,pitch:r.pitch,zoom:M/100,targetX:r.targetX,targetZ:r.targetZ}}),this.state.workflow==="draw"&&M!==this.state.draw.zoomPercent&&this.#L({type:"set-zoom",value:M,...t?{originX:t.xPercent,originY:t.yPercent}:{}})},onRoom:r=>this.#L({type:"toggle-room",roomId:r}),onProblem:()=>this.#t("renderer-problem")}),this.#e=new K1(H,this.#H,{state:()=>this.state,onCircles:(r,M,t)=>this.#L({type:"set-draft-circles",circles:r,record:M,...t?{previous:t}:{}}),onRoom:r=>this.#L({type:"toggle-room",roomId:r})}),this.#H.setState(this.state))}disconnectedCallback(){this.#e?.dispose(),this.#e=null,this.#H?.dispose(),this.#H=null,super.disconnectedCallback()}updated(H){if(!H.has("state"))return;H.get("state")?.fullMap&&!this.state.fullMap&&this.#C&&this.#C.focus(),this.#H?.setState(this.state)}#L(H){this.dispatchEvent(new CustomEvent(i1,{detail:H,bubbles:!0,composed:!0}))}#t(H){this.dispatchEvent(new CustomEvent(X1,{detail:{id:H},bubbles:!0,composed:!0}))}#a(H){this.#C=H.currentTarget,this.#L({type:this.state.fullMap?"exit-full-map":"enter-full-map"})}#n(H,V){this.#H?.orbitBy(H,V)}#o(H){if(!(H.ctrlKey||H.metaKey||H.altKey)&&H.key==="Escape"){if(H.preventDefault(),this.#M){this.#M=!1,this.requestUpdate();return}this.#L({type:"dismiss-top-layer"});return}}rendererDiagnostics(){return this.#H?.diagnostics()??null}canvasIdentity(){return{scene:this.renderRoot.querySelector(".scene-canvas"),overlay:this.renderRoot.querySelector(".overlay-canvas")}}#s(){return this.state.host.connected?this.state.host.administrator?this.state.host.robotCount===0?{title:this.#V("v4_no_robot","No Matic robot set up"),detail:this.#V("v4_no_robot_detail","Set up a robot before opening its map.")}:this.state.host.robotConnected?this.state.coherence==="verifying"||this.state.coherence==="booting"?{title:this.#V("v4_locating_map","Locating the current map"),detail:this.#V("v4_locating_map_detail","Map controls will return after the floor is verified.")}:!this.state.map.available&&this.state.resources.scene.status==="loading"?{title:this.#V("v4_loading_verified_map","Loading the verified map"),detail:this.#V("v4_loading_verified_map_detail","The current floor is verified. The private scene is still preparing.")}:this.state.map.available?this.state.activity==="problem"?{title:this.#V("v4_robot_attention","Robot needs attention"),detail:this.#V("v4_robot_attention_detail","Check the robot before starting another task.")}:null:{title:this.#V("v4_map_unavailable","Map unavailable"),detail:this.#V("v4_map_unavailable_detail","The private scene is not ready. No map data is shown until it is verified.")}:{title:this.#V("v4_robot_offline","Robot offline"),detail:this.#V("v4_robot_offline_detail","The last verified map stays read only and has no live position.")}:{title:this.#V("v4_admin_required","Administrator access required"),detail:this.#V("v4_private_map_hidden","Private map data is hidden.")}:{title:this.#V("v4_reconnecting","Reconnecting"),detail:this.#V("v4_reconnecting_detail","The verified map is read only until Home Assistant reconnects.")}}render(){let H=this.state,V=C5(H),e=this.#s(),r=H.map.available&&(d1(H)||H.dataMode==="history"),M=H.workflow==="draw"&&r,t=H.coherence==="verifying"||H.coherence==="booting";return O`
      <section
        class="map-root"
        tabindex="0"
        role="application"
        aria-label=${d3(H,this.localize)}
        data-full-map=${String(H.fullMap)}
        data-workflow=${H.workflow}
        data-draw-tool=${H.draw.tool}
        @keydown=${this.#o}
      >
        ${!t||H.fullMap?O`<nav class="map-tools ms-surface ms-surface--floating ms-segment" aria-label="Map tools">
          ${t?l:O`
            <button class="ms-btn" type="button" @click=${()=>{this.#H?.fit(),this.#L({type:"fit-map"})}}>${k(Q5)}<span class="ms-btn__label">${this.#V("map_home_view","Fit")}</span></button>
            <button
              class="labels ms-btn"
              type="button"
              aria-pressed=${String(H.labelsVisible)}
              @click=${()=>this.#L({type:"toggle-labels"})}
            >${k(K5)}<span class="ms-btn__label">${this.#V("map_labels","Labels")}</span></button>
            <button
              class="help ms-btn ms-btn--icon"
              type="button"
              aria-label=${this.#V("v4_navigation_help","Map navigation help")}
              aria-expanded=${String(this.#M)}
              @click=${()=>{this.#M=!this.#M,this.requestUpdate()}}
            >${k(q5)}</button>
          `}
          <button
            class="full-map ms-btn"
            type="button"
            aria-label=${this.#V("v4_full_map","Full map")}
            aria-pressed=${String(H.fullMap)}
            @click=${this.#a}
          >${k(H.fullMap?j5:X5)}<span class="ms-btn__label">${H.fullMap?this.#V("v4_close","Close"):this.#V("v4_full_map","Full map")}</span></button>
        </nav>`:l}

        ${this.#M&&r?O`
          <aside class="navigation-help" aria-label=${this.#V("v4_navigation_help","Map navigation help")}>
            <dl>
              <dt>${this.#V("v4_trackpad","Trackpad")}</dt>
              <dd>${this.#V("v4_trackpad_help","Scroll to pan \xB7 pinch to zoom \xB7 twist to rotate")}</dd>
              <dt>${this.#V("v4_mouse","Mouse")}</dt>
              <dd>${this.#V("v4_mouse_help","Drag to orbit \xB7 Shift, middle, or right drag to pan \xB7 wheel to zoom")}</dd>
              <dt>${this.#V("v4_keyboard","Keyboard")}</dt>
              <dd>${this.#V("v4_keyboard_help","WASD to move \xB7 Q/E or arrows to orbit \xB7 +/\u2212 to zoom \xB7 0 to fit")}</dd>
            </dl>
          </aside>
        `:l}

        ${H.workflow!=="draw"&&r?O`
          <div class="view-switch ms-surface ms-surface--floating ms-segment" aria-label="Map view">
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(H.view==="three")}
              @click=${()=>this.#L({type:"set-view",view:"three"})}
            >${this.#V("map_view_3d","3D")}</button>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(H.view==="top")}
              @click=${()=>this.#L({type:"set-view",view:"top"})}
            >${this.#V("map_view_top","2D")}</button>
          </div>
        `:l}

        ${H.view==="top"&&r?O`
          <div class="appearance-switch ms-surface ms-surface--floating ms-segment" aria-label=${this.#V("map_style_label","2D map style")}>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(H.appearance==="photo")}
              @click=${()=>this.#L({type:"set-appearance",appearance:"photo"})}
            >${this.#V("map_style_photo","Photo")}</button>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(H.appearance==="rooms")}
              @click=${()=>this.#L({type:"set-appearance",appearance:"rooms"})}
            >${this.#V("map_view_rooms","Rooms")}</button>
          </div>
        `:l}

        ${H.view==="three"&&r?O`
          <div class="camera-steps ms-surface ms-surface--floating ms-segment" role="toolbar" aria-label=${this.#V("map_camera_controls","Map camera controls")}>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#V("map_rotate_left","Rotate left")} aria-keyshortcuts="[" @click=${()=>this.#n(-52,0)}>${k(Y5)}</button>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#V("map_tilt_down","Lower viewing angle")} aria-keyshortcuts="PageDown" @click=${()=>this.#n(0,30)}>${k(G5)}</button>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#V("map_tilt_up","Raise viewing angle")} aria-keyshortcuts="PageUp" @click=${()=>this.#n(0,-30)}>${k(U5)}</button>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#V("map_rotate_right","Rotate right")} aria-keyshortcuts="]" @click=${()=>this.#n(52,0)}>${k(J5)}</button>
          </div>
        `:l}

        <div
          class="scene-window"
          data-renderer-key="persistent-canvas-v4"
          ?hidden=${!r}
          aria-hidden="true"
        >
          <canvas class="scene-canvas"></canvas>
          <canvas class="overlay-canvas"></canvas>
        </div>

        ${M?O`
          <div class="map-scale" aria-label=${`Scale ${V.label}`}>
            <span class="scale-line" style=${`--scale-width:${V.pixels}px`}></span>
            <span>${V.label}</span>
          </div>
          <div class="draw-tools ms-surface ms-surface--floating ms-segment" role="toolbar" aria-label="Draw area tools">
            ${["paint","erase","pan"].map(i=>O`
              <button
                class="ms-btn"
                type="button"
                role="radio"
                aria-checked=${String(H.draw.tool===i)}
                data-tool=${i}
                @click=${()=>this.#L({type:"set-draw-tool",tool:i})}
              >${k(i==="paint"?V3:i==="erase"?L3:e3)}<span class="ms-btn__label">${i==="paint"?this.#V("area_paint","Paint"):i==="erase"?this.#V("area_erase","Erase"):this.#V("move_map","Move map")}</span></button>
            `)}
            <button
              class="ms-btn"
              type="button"
              ?disabled=${H.draw.strokeCount===0}
              @click=${()=>this.#L({type:"undo-draft"})}
            >${k(C3)}<span class="ms-btn__label">${this.#V("undo","Undo")}</span></button>
            <button
              class="ms-btn"
              type="button"
              ?disabled=${H.draw.redo.length===0}
              @click=${()=>this.#L({type:"redo-draft"})}
            >${k(H3)}<span class="ms-btn__label">${this.#V("redo","Redo")}</span></button>
            <button class="ms-btn" type="button" @click=${()=>this.#t("review-area")}>${k(r3)}<span class="ms-btn__label">${this.#V("done_editing","Done editing")}</span></button>
          </div>
        `:l}

        ${e&&!(H.fullMap&&(t||!H.host.administrator))?O`
          <div class="map-message ms-surface ms-surface--floating" role="status">
            <strong>${e.title}</strong>
            <span>${e.detail}</span>
          </div>
        `:l}
        <div class="sr-only" aria-live="polite" aria-atomic="true">
          ${d3(H,this.localize)}
        </div>
      </section>
    `}};customElements.get(P1)||customElements.define(P1,P2);var B2=class extends y{constructor(){super(...arguments);this.state=w();this.compact=!1}static{this.properties={state:{attribute:!1},localize:{attribute:!1},compact:{type:Boolean,reflect:!0}}}static{this.styles=[E,D,v1,g`
:host { display: block; color: var(--ms-text); }
.controls { display: grid; gap: var(--ms-space-3); padding: var(--ms-space-3); }
.stepper { display: grid; grid-template-columns: var(--ms-control) minmax(0, 1fr) var(--ms-control); gap: var(--ms-space-1); align-items: stretch; }
.number { --ms-local: var(--ms-surface-card); display: flex; align-items: center; min-inline-size: 0; min-block-size: var(--ms-control); padding-inline: var(--ms-space-2); border: 1px solid var(--ms-line-strong); border-radius: var(--ms-radius-sm); background: var(--ms-local); }
.number:focus-within { outline: 2px solid var(--ms-accent); outline-offset: 1px; border-color: var(--ms-accent); }
input { min-inline-size: 0; inline-size: 100%; border: 0; outline: 0; color: inherit; background: transparent; text-align: end; font-size: var(--ms-t-sm); font-variant-numeric: tabular-nums; }
.unit { margin-inline-start: var(--ms-space-1); color: var(--ms-text-quiet); font-size: var(--ms-t-xs); }
.hint { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
:host([compact]) .controls {
position: absolute;
z-index: 8;
inset-block-start: calc(100% + var(--ms-space-1));
inset-inline-end: 0;
inline-size: min(18rem, calc(100vw - 1.5rem));
}
`]}#C(H,V){return T(this.localize,H,V)}#H(H){this.dispatchEvent(new CustomEvent(i1,{detail:H,bubbles:!0,composed:!0}))}#e(H,V){let e=H.currentTarget.valueAsNumber;Number.isFinite(e)&&this.#H(V==="zoom"?{type:"set-zoom",value:e}:{type:"set-brush",value:e})}render(){let{draw:H}=this.state;return O`
      <div class="controls ms-surface ms-surface--overlay" aria-label=${this.#C("v4_drawing_precision","Drawing precision")}>
        <div class="row ms-field">
          <label for="zoom">${this.#C("v4_map_zoom","Map zoom")}</label>
          <div class="stepper">
            <button
              class="ms-btn ms-btn--secondary ms-btn--icon"
              type="button"
              aria-label=${this.#C("zoom_out","Zoom out")}
              @click=${()=>this.#H({type:"step-zoom",factor:.8})}
            >\u2212</button>
            <span class="number">
              <input
                id="zoom"
                inputmode="numeric"
                type="number"
                min=${100}
                max=${1e3}
                step="1"
                .value=${String(H.zoomPercent)}
                @change=${V=>this.#e(V,"zoom")}
                aria-label=${this.#C("v4_map_zoom_percent","Map zoom percent")}
              />
              <span class="unit">%</span>
            </span>
            <button
              class="ms-btn ms-btn--secondary ms-btn--icon"
              type="button"
              aria-label=${this.#C("zoom_in","Zoom in")}
              @click=${()=>this.#H({type:"step-zoom",factor:1.25})}
            >+</button>
          </div>
        </div>

        <div class="row ms-field">
          <label for="brush">${this.#C("brush_size","Brush width")}</label>
          <div class="stepper">
            <button
              class="ms-btn ms-btn--secondary ms-btn--icon"
              type="button"
              aria-label=${this.#C("v4_narrower_brush","Narrower brush")}
              @click=${()=>this.#H({type:"set-brush",value:H.brushMeters/1.25})}
            >\u2212</button>
            <span class="number">
              <input
                id="brush"
                inputmode="decimal"
                type="number"
                min=${.2}
                max=${2.5}
                step="0.01"
                .value=${H.brushMeters.toFixed(2)}
                @change=${V=>this.#e(V,"brush")}
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
        </div>
        <p class="hint">${this.#C("v4_precision_hint","Strokes follow the verified map resolution. Zoom changes the view, not the saved outline.")}</p>
      </div>
    `}};customElements.get(r1)||customElements.define(r1,B2);var T2=["vacuum","mop","vacuum_and_mop"],R2=["quick","standard","heavy_duty"],$=L=>L.currentTarget.value,_2=L=>L.currentTarget.checked,l3=z(r1),F2=class extends y{constructor(){super(...arguments);this.state=w();this._copyStatus="idle"}static{this.properties={state:{attribute:!1},localize:{attribute:!1},_copyStatus:{state:!0}}}static{this.styles=[E,D,v1,g`
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
`]}#C;disconnectedCallback(){this.#C!==void 0&&clearTimeout(this.#C),this.#C=void 0,super.disconnectedCallback()}#H(H,V,e){return T(this.localize,H,V,e)}#e(H){return H==="vacuum"?this.#H("vacuum","Vacuum"):H==="mop"?this.#H("mop","Mop"):this.#H("vacuum_and_mop","Vacuum + mop")}#M(H){return H==="quick"?this.#H("quick","Quick"):H==="standard"?this.#H("standard","Optimal"):this.#H("heavy_duty","Heavy Duty")}#V(H){this.dispatchEvent(new CustomEvent(i1,{detail:H,bubbles:!0,composed:!0}))}#L(){return this.state.notice?d`
      <div class="notice" data-tone=${this.state.notice.tone} role=${this.state.notice.tone==="error"?"alert":"status"}>
        ${this.state.notice.text}
      </div>
    `:l}#t(H,V,e){if(H==="loading"||H==="idle")return d`<div class="loading" role="status">${this.#H("map_loading","Loading\u2026")}</div>`;if(H==="error"){let r=this.state.workflow;return d`
        <div class="stack">
          <div class="problem" role="alert">${this.#H("v4_workspace_unavailable","This workspace is unavailable right now.")} ${V==="request-failed"?this.#H("v4_try_again","Try again shortly."):this.#H("v4_return_live_retry","Return to the live map and retry.")}</div>
          <div class="toolbar">
            <button class="ms-btn ms-btn--secondary" type="button" @click=${()=>this.#V({type:"open-workflow",workflow:r})}>${this.#H("v4_retry","Try again")}</button>
          </div>
        </div>
      `}return H==="empty"?d`<div class="empty">${this.#H("v4_nothing_saved","Nothing saved yet.")}</div>`:e}#a(){let H=this.state.resources.plans;return this.#t(H.status,H.problem,d`
      <div class="stack">
        <h3 class="group-heading" id="rooms-heading">${this.#H("v4_rooms_to_clean","Rooms to clean")}</h3>
        <div class="list" role="group" aria-labelledby="rooms-heading">
          ${(H.value?.rooms||[]).map(V=>{let e=this.state.selection.roomIds.includes(V.roomId);return d`
              <div class="room ms-row ms-row--stack" data-selected=${String(e)}>
                <label class="room-choice">
                  <input
                    type="checkbox"
                    .checked=${e}
                    @change=${()=>this.#V({type:"toggle-room",roomId:V.roomId})}
                  >
                  <strong>${V.name}</strong>
                  ${e?d`<small>${this.#H("v4_room_ready","Ready")}</small>`:l}
                </label>
                ${e?this.#n(V.roomId,this.state.selection.roomSettings.find(r=>r.roomId===V.roomId)||{roomId:V.roomId,cleaningMode:"vacuum",coverageSetting:"standard"}):l}
              </div>
            `})}
        </div>
        <p class="subtle">${this.#H("v4_room_selection_hint","Select rooms here or directly on the map. The map and list stay in sync.")}</p>
        ${this.#L()}
      </div>
    `)}#n(H,V){return d`
      <div class="split room-settings">
        <label class="field ms-field">${this.#H("v4_cleaning_system","Cleaning system")}
          <select
            aria-label=${this.#H("v4_room_cleaning_system","Cleaning system for room")}
            .value=${V.cleaningMode}
            @change=${e=>this.#V({type:"patch-room-settings",roomId:H,cleaningMode:$(e)})}
          >${T2.map(e=>d`<option value=${e} ?selected=${e===V.cleaningMode}>${this.#e(e)}</option>`)}</select>
        </label>
        <label class="field ms-field">${this.#H("cleaning_mode","Cleaning mode")}
          <select
            aria-label=${this.#H("v4_room_cleaning_mode","Cleaning mode for room")}
            .value=${V.coverageSetting}
            @change=${e=>this.#V({type:"patch-room-settings",roomId:H,coverageSetting:$(e)})}
          >${R2.map(e=>d`<option value=${e} ?selected=${e===V.coverageSetting}>${this.#M(e)}</option>`)}</select>
        </label>
      </div>
    `}#o(H){let V=this.state.planDraft.rooms,r=V.find(M=>M.roomId===H)?V.filter(M=>M.roomId!==H):[...V,{roomId:H,cleaningMode:"vacuum",coverageSetting:"standard"}];this.#V({type:"patch-plan-draft",patch:{rooms:r}})}#s(H,V){let e=this.state.planDraft.rooms.map((r,M)=>M===H?{...r,...V}:r);this.#V({type:"patch-plan-draft",patch:{rooms:e}})}#m(H,V){let e=H+V,r=[...this.state.planDraft.rooms];if(e<0||e>=r.length)return;let[M]=r.splice(H,1);M&&(r.splice(e,0,M),this.#V({type:"patch-plan-draft",patch:{rooms:r}}))}#S(){let H=this.state.resources.plans,V=H.value,e=this.state.planDraft,r=e.rooms.map(i=>({room:i,label:V?.rooms.find(o=>o.roomId===i.roomId)?.name||"Room",selected:!0})),M=(V?.rooms||[]).filter(i=>!e.rooms.some(o=>o.roomId===i.roomId)).map(i=>({room:{roomId:i.roomId,cleaningMode:"vacuum",coverageSetting:"standard"},label:i.name,selected:!1})),t=[...r,...M];return this.#t(H.status,H.problem,d`
      <div class="stack">
        <div class="split">
          <label class="field ms-field">${this.#H("v4_saved_plan","Saved plan")}
            <select
              .value=${this.state.selection.planId||""}
              @change=${i=>this.#V({type:"select-plan",planId:$(i)||null})}
            >
              <option value="">${this.#H("plan_new","New plan")}</option>
              ${(V?.plans||[]).map(i=>d`<option value=${i.id}>${i.name}</option>`)}
            </select>
          </label>
          <button class="list-button ms-row ms-row" type="button" @click=${()=>this.#V({type:"select-plan",planId:null})}>\uff0b ${this.#H("plan_new","New plan")}</button>
        </div>
        <label class="field ms-field">${this.#H("plan_name","Plan name")}
          <input
            maxlength="128"
            autocomplete="off"
            .value=${e.name}
            @input=${i=>this.#V({type:"patch-plan-draft",patch:{name:$(i)}})}
          >
        </label>
        <div class="split">
          <label class="field ms-field">${this.#H("plan_run_behavior","Run order")}
            <select
              .value=${e.runBehavior}
              @change=${i=>this.#V({type:"patch-plan-draft",patch:{runBehavior:$(i)==="ordered"?"ordered":"intelligent"}})}
            >
              <option value="intelligent">${this.#H("plan_intelligent","Smart rotation")}</option>
              <option value="ordered">${this.#H("plan_ordered","Listed order")}</option>
            </select>
          </label>
          <label class="checkbox"><input type="checkbox" .checked=${e.enabled} @change=${i=>this.#V({type:"patch-plan-draft",patch:{enabled:_2(i)}})}>${this.#H("plan_enabled","Enabled")}</label>
        </div>
        <h3 class="group-heading" id="plan-rooms-heading">${this.#H("plan_rooms","Plan rooms")}</h3>
        <div class="list" role="group" aria-labelledby="plan-rooms-heading">
          ${t.map(({room:i,label:o,selected:a})=>{let n=a?e.rooms.findIndex(A=>A.roomId===i.roomId):-1;return d`
              <div class="room plan-room ms-row ms-row--stack" data-selected=${String(a)}>
                <label class="room-choice">
                  <input type="checkbox" .checked=${a} @change=${()=>this.#o(i.roomId)}>
                  <strong>${a?`${n+1}. `:""}${o}</strong>
                  ${a?d`
                    <span>
                      <button class="icon-button ms-btn ms-btn--icon ms-btn--sm" type="button" aria-label=${this.#H("move_room_up","Move {room} earlier",{room:o})} ?disabled=${n===0} @click=${A=>{A.preventDefault(),this.#m(n,-1)}}>\u2191</button>
                      <button class="icon-button ms-btn ms-btn--icon ms-btn--sm" type="button" aria-label=${this.#H("move_room_down","Move {room} later",{room:o})} ?disabled=${n===e.rooms.length-1} @click=${A=>{A.preventDefault(),this.#m(n,1)}}>\u2193</button>
                    </span>
                  `:l}
                </label>
                ${a?d`
                  <div class="split room-settings">
                    <label class="field ms-field">${this.#H("v4_cleaning_system","Cleaning system")}
                      <select .value=${i.cleaningMode} @change=${A=>this.#s(n,{cleaningMode:$(A)})}>${T2.map(A=>d`<option value=${A} ?selected=${A===i.cleaningMode}>${this.#e(A)}</option>`)}</select>
                    </label>
                    <label class="field ms-field">${this.#H("cleaning_mode","Cleaning mode")}
                      <select .value=${i.coverageSetting} @change=${A=>this.#s(n,{coverageSetting:$(A)})}>${R2.map(A=>d`<option value=${A} ?selected=${A===i.coverageSetting}>${this.#M(A)}</option>`)}</select>
                    </label>
                  </div>
                `:l}
              </div>
            `})}
        </div>
        <h3 class="group-heading" id="completion-heading">${this.#H("v4_completion_options","Completion options")}</h3>
        <div class="plan-options" role="group" aria-labelledby="completion-heading">
          <label class="checkbox"><input type="checkbox" .checked=${e.returnToBase} @change=${i=>this.#V({type:"patch-plan-draft",patch:{returnToBase:_2(i)}})}>${this.#H("plan_return_to_base","Return to the dock when finished")}</label>
          <label class="checkbox"><input type="checkbox" .checked=${e.finishCurrentRoom} @change=${i=>this.#V({type:"patch-plan-draft",patch:{finishCurrentRoom:_2(i)}})}>${this.#H("plan_finish_room","Finish the active room after Stop")}</label>
          ${e.finishCurrentRoom?d`<label class="field ms-field">${this.#H("plan_threshold","Finish threshold")} \u00b7 ${e.finishCurrentRoomThreshold}%<input type="range" min="0" max="100" step="5" .value=${String(e.finishCurrentRoomThreshold)} @input=${i=>this.#V({type:"patch-plan-draft",patch:{finishCurrentRoomThreshold:Number($(i))}})}></label>`:l}
        </div>
        <div class="toolbar">
          ${e.id?d`
            <button
              class="danger ms-btn ms-btn--secondary ms-btn--danger"
              type="button"
              aria-label=${this.#H("plan_delete","Delete plan")}
              data-dialog-launcher="confirmDeletePlan"
              @click=${()=>this.#V({type:"open-dialog",dialog:"confirmDeletePlan"})}
            >${this.#H("plan_delete","Delete")}</button>
          `:l}
        </div>
        ${this.#L()}
      </div>
    `)}#A(){let H=this.state.resources.areas;return d`
      <div class="stack">
        <${l3} .state=${this.state} .localize=${this.localize}></${l3}>
        <p class="subtle">${this.#H("v4_draw_floor_hint","Paint only on the mapped floor. Zoom and pan never change the saved outline.")}</p>
        <div class="toolbar">
          <button
            class="ms-btn ms-btn--secondary"
            type="button"
            ?disabled=${this.state.draw.circles.length===0}
            @click=${()=>this.#V({type:"clear-draft"})}
          >${this.#H("clear","Clear")}</button>
        </div>
        ${this.#t(H.status,H.problem,d`
          <div class="group">
            <h3 class="group-heading" id="areas-heading">${this.#H("area_workspace_title","Saved custom areas")}</h3>
            <div class="list" role="group" aria-labelledby="areas-heading">
            <button class="list-button ms-row ms-row" type="button" @click=${()=>this.#V({type:"select-area",areaId:null})}>\uff0b ${this.#H("area_new","New outline")}</button>
            ${(H.value?.areas||[]).map(V=>d`
              <button class="list-button ms-row ms-row" type="button" @click=${()=>{this.#V({type:"select-area",areaId:V.id}),this.#V({type:"open-workflow",workflow:"areaReview"})}}>
                <span>${V.name}</span>
                <small>${V.status==="current"?this.#H("area_workspace_ready","Ready"):this.#H("v4_review","Review")}</small>
              </button>
            `)}
            </div>
          </div>
        `)}
      </div>
    `}#h(){let H=this.state.areaDraft,V=H.canRebind||H.status==="review",e=H.status==="stale"||H.status==="unknown";return d`
      <div class="stack">
        ${V?d`<div class="notice" data-tone="warning" role="status">${this.#H("area_review_required","Review the saved outline on this current map, then confirm it.")}</div>`:l}
        ${e?d`<div class="problem" role="alert">${this.#H("area_redraw_required","This outline no longer matches the current room map. Redraw it before saving.")}</div>`:l}
        <label class="field ms-field">${this.#H("area_name","Area name")}
          <input maxlength="128" autocomplete="off" .value=${H.name} @input=${r=>this.#V({type:"patch-area-draft",patch:{name:$(r)}})}>
        </label>
        <div class="split">
          <label class="field ms-field">${this.#H("v4_cleaning_system","Cleaning system")}
            <select .value=${H.cleaningMode} @change=${r=>this.#V({type:"patch-area-draft",patch:{cleaningMode:$(r)}})}>${T2.map(r=>d`<option value=${r} ?selected=${r===H.cleaningMode}>${this.#e(r)}</option>`)}</select>
          </label>
          <label class="field ms-field">${this.#H("cleaning_mode","Cleaning mode")}
            <select .value=${H.coverageSetting} @change=${r=>this.#V({type:"patch-area-draft",patch:{coverageSetting:$(r)}})}>${R2.map(r=>d`<option value=${r} ?selected=${r===H.coverageSetting}>${this.#M(r)}</option>`)}</select>
          </label>
        </div>
        <p class="subtle">${this.#H("v4_private_marks","{count} map-space marks. The outline stays private and floor-bound.",{count:this.state.draw.circles.length})}</p>
        <div class="toolbar">
          <button class="ms-btn ms-btn--secondary" type="button" @click=${()=>this.#V({type:"open-workflow",workflow:"draw"})}>${this.#H("v4_edit_outline","Edit outline")}</button>
          ${H.id?d`
            <button
              class="danger ms-btn ms-btn--secondary ms-btn--danger"
              type="button"
              aria-label=${this.#H("area_delete","Delete area")}
              data-dialog-launcher="confirmDeleteArea"
              @click=${()=>this.#V({type:"open-dialog",dialog:"confirmDeleteArea"})}
            >${this.#H("area_delete","Delete")}</button>
          `:l}
        </div>
        ${this.#L()}
      </div>
    `}#p(){let H=this.state.resources.history,V=H.value,e=V?.floors.find(t=>t.id===this.state.selection.floorId)||V?.floors.find(t=>t.active)||V?.floors[0],r=e?.snapshots||[],M=this.state.selection.historyId?Math.max(0,r.findIndex(t=>t.id===this.state.selection.historyId)):r.length;return this.#t(H.status,H.problem,d`
      <div class="stack">
        ${(V?.floors.length||0)>1?d`
          <div class="group">
            <h3 class="group-heading" id="floors-heading">${this.#H("v4_mapped_floors","Mapped floors")}</h3>
            <div class="list" role="radiogroup" aria-labelledby="floors-heading">
            ${(V?.floors||[]).map((t,i)=>d`
              <button
                class="floor ms-row ms-row"
                type="button"
                role="radio"
                aria-checked=${String(t.id===e?.id)}
                @click=${()=>this.#V({type:"set-floor",floorId:t.id})}
              >
                <span>${t.label||(t.active?this.#H("v4_current_floor","Current floor"):this.#H("v4_saved_floor","Saved floor {number}",{number:t.ordinal??i}))}</span>
                <small>${t.active?this.#H("map_timeline_live_action","Live"):this.#H("v4_read_only","Read only")}</small>
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
              .value=${String(M)}
              ?disabled=${!r.length}
              @input=${t=>{let i=Number($(t));this.#V({type:"set-history",historyId:i===r.length?null:r[i]?.id||null})}}
            >
          </label>
          <div class="list">
            <button class="snapshot ms-row ms-row" type="button" aria-current=${String(!this.state.selection.historyId)} @click=${()=>this.#V({type:"set-history",historyId:null})}><span>${this.#H("map_timeline_live_action","Live")}</span><small>${this.#H("v4_current","Current")}</small></button>
            ${r.map((t,i)=>d`
              <button class="snapshot ms-row ms-row" type="button" aria-current=${String(t.id===this.state.selection.historyId)} @click=${()=>this.#V({type:"set-history",historyId:t.id})}>
                <span>${this.#i(t.createdAt)}</span><small>${i+1} of ${r.length}</small>
              </button>
            `)}
          </div>
        </div>
        <p class="subtle">${this.#H("v4_history_privacy","Saved maps are floor-scoped and never show a live robot position.")}</p>
      </div>
    `)}#i(H){try{return new Intl.DateTimeFormat(this.state.locale,{dateStyle:"medium",timeStyle:"short"}).format(new Date(H))}catch{return this.#H("v4_saved_map","Saved map")}}#c(){let H=this.state.resources.entry,V=this.#H("v4_yes","Yes"),e=this.#H("v4_no","No"),r=this.#H("v4_seen","Seen"),M=this.#H("v4_not_seen","Not seen"),t=this.#H("v4_unknown","Unknown");return[[this.#H("v4_connection","Connection"),this.state.host.connected?this.#H("v4_connected","Connected"):this.#H("v4_offline","Offline")],[this.#H("v4_map_state","Map state"),String(this.state.coherence)],[this.#H("v4_floor_verified","Floor verified"),this.state.map.floorCoherent?V:e],[this.#H("v4_session_verified","Session verified"),this.state.map.sessionVerified?V:e],[this.#H("v4_map_complete","Map complete"),this.state.map.complete?V:e],[this.#H("v4_map_health","Map health"),H?.health||t],[this.#H("v4_blocked_by","Blocked by"),H?.mapBlockReason?.replaceAll("_"," ")||this.#H("v4_nothing","Nothing")],[this.#H("v4_startup_map","Startup map check"),H?.bootstrapState?.replaceAll("_"," ")||t],[this.#H("v4_startup_photo","Startup photo layer"),H?.bootstrapPhotoSeen?r:M],[this.#H("v4_startup_structure","Startup structure layer"),H?.bootstrapStructureSeen?r:M],[this.#H("v4_startup_failures","Startup failures"),String(H?.bootstrapFailures||0)],[this.#H("v4_stream_failures","Stream failures"),String(H?.streamFailures||0)],[this.#H("v4_saved_floor_count","Saved floor count"),String(this.state.floor.classifiedCount)]]}#u(H){this.#C!==void 0&&clearTimeout(this.#C),this.#C=void 0,this._copyStatus=H,H==="copied"&&(this.#C=setTimeout(()=>{this.#C=void 0,this._copyStatus="idle"},2e3))}#Z(){let H=this.#c().map(([r,M])=>`${r}: ${M}`).join(`
`),V=typeof navigator>"u"?void 0:navigator.clipboard;if(!V||typeof V.writeText!="function"){this.#u("failed");return}let e;try{e=V.writeText(H)}catch{this.#u("failed");return}e.then(()=>this.#u("copied"),()=>this.#u("failed"))}#r(){let H=this.#c(),V=this._copyStatus==="copied"?this.#H("v4_copied","Copied"):this._copyStatus==="failed"?this.#H("v4_copy_failed","The summary could not be copied. Select the text to copy it by hand."):"";return d`
      <div class="stack">
        <p class="subtle">${this.#H("v4_support_privacy","This summary contains no map, coordinates, room or floor names, device identifiers, addresses, or credentials.")}</p>
        <dl class="diagnostics">
          ${H.map(([e,r])=>d`<dt>${e}</dt><dd>${r}</dd>`)}
        </dl>
        <div class="toolbar">
          <button class="ms-btn ms-btn--secondary" type="button" @click=${()=>this.#Z()}>${k(M3)}<span>${this.#H("v4_copy_summary","Copy summary")}</span></button>
        </div>
        <p class="copy-status" role="status" aria-live="polite">${V}</p>
      </div>
    `}render(){switch(this.state.workflow){case"rooms":return this.#a();case"plan":return this.#S();case"draw":return this.#A();case"areaReview":return this.#h();case"history":return this.#p();case"support":return this.#r();case"none":return l}}};customElements.get(m1)||customElements.define(m1,F2);var s3=z(P1),p3=z(r1),m3=z(m1),y0=(L,C)=>{let H=(e,r,M)=>T(C,e,r,M);if(!L.host.connected)return{title:H("v4_reconnecting","Reconnecting"),detail:H("v4_ha_offline","Home Assistant is offline")};if(!L.host.administrator)return{title:H("v4_access_required","Access required"),detail:H("v4_admin_only","Administrator only")};if(L.host.robotCount===0)return{title:H("v4_no_robot_short","No robot"),detail:H("v4_set_up_robot","Set up a Matic robot")};if(!L.host.robotConnected)return{title:H("v4_robot_offline","Robot offline"),detail:H("v4_last_map_read_only","Last verified map \xB7 read only")};if(L.activity==="problem")return{title:H("v4_needs_attention","Needs attention"),detail:H("v4_check_robot","Check the robot")};if(L.dataMode==="history"){let e=L.resources.history.value?.floors.find(t=>t.id===L.selection.floorId),r=e?.snapshots.findIndex(t=>t.id===L.selection.historyId)??-1,M=e?.snapshots.length??0;return{title:H("v4_saved_map","Saved map"),detail:r>=0?H("v4_read_only_position","Read only \xB7 {position} of {count}",{position:r+1,count:M}):H("v4_read_only","Read only")}}if(L.coherence==="verifying"||L.coherence==="booting")return{title:H("v4_locating","Locating"),detail:H("v4_finding_map","Finding the current map")};if(L.activity==="cleaning")return{title:H("v4_cleaning","Cleaning"),detail:H("v4_cleaning_progress","Cleaning in progress")};if(L.activity==="recharging"){let e=L.batteryPercent===null?H("v4_recharging_detail","Will resume automatically when ready"):H("v4_recharging_battery","Charging to resume \xB7 {percent}% battery",{percent:L.batteryPercent});return{title:H("v4_recharging","Charging to resume"),detail:e}}if(L.activity==="paused")return{title:H("v4_paused","Paused"),detail:H("v4_can_resume","Cleaning can resume")};if(L.activity==="returning")return{title:H("v4_returning","Returning"),detail:H("v4_going_dock","Going to the dock")};if(L.activity==="stopping")return{title:H("v4_stopping","Stopping"),detail:H("v4_waiting_robot","Waiting for the robot")};let V=L.batteryPercent===null?H("v4_ready","Ready"):H("v4_battery","{percent}% battery",{percent:L.batteryPercent});return{title:L.activity==="docked"?H("v4_docked","Docked"):H("v4_ready","Ready"),detail:V}},b0=(L,C)=>{let H=(V,e)=>T(C,V,e);switch(L.workflow){case"rooms":return{title:H("v4_choose_rooms","Choose rooms"),description:H("v4_choose_rooms_detail","Select on the map or from the list.")};case"draw":return{title:H("v4_draw_area","Draw an area"),description:H("v4_draw_area_detail","Paint on the verified map, then review the details.")};case"plan":return{title:H("v4_plan","Plan"),description:H("v4_plan_detail","Review rooms and cleaning settings.")};case"areaReview":return{title:H("area_details","Area details"),description:H("area_details_hint","Name the area and choose cleaning settings.")};case"history":return{title:H("v4_map_history","Map history"),description:H("v4_map_history_detail","Saved maps are floor-scoped and read only.")};case"support":return{title:H("v4_map_support","Map support"),description:H("v4_map_support_detail","Private geometry is never included.")};case"none":return{title:H("v4_clean","Start cleaning"),description:H("v4_clean_detail","Choose rooms, a saved plan, or a custom area.")}}},O0=(L,C)=>{let H=(V,e)=>T(C,V,e);switch(L){case"discardDraft":return{title:H("v4_discard_area","Discard this area?"),detail:H("v4_discard_area_detail","The outline has not been saved. You can keep drawing or discard it."),cancelLabel:H("v4_keep_drawing","Keep drawing"),confirmLabel:H("v4_discard","Discard"),action:"discard"};case"confirmDeletePlan":return{title:H("v4_delete_plan","Delete this plan?"),detail:H("v4_delete_plan_detail","This removes the saved plan from Home Assistant. The robot will not move."),cancelLabel:H("v4_cancel","Cancel"),confirmLabel:H("plan_delete","Delete plan"),action:"delete-plan"};case"confirmDeleteArea":return{title:H("v4_delete_area","Delete this area?"),detail:H("v4_delete_area_detail","This removes the saved outline from Home Assistant. The robot will not move."),cancelLabel:H("v4_cancel","Cancel"),confirmLabel:H("area_delete","Delete area"),action:"delete-area"};case"confirmStop":return{title:H("v4_stop_cleaning","Stop cleaning?"),detail:H("v4_stop_cleaning_detail","The robot may take a moment to settle before another action is available."),cancelLabel:H("v4_keep_cleaning","Keep cleaning"),confirmLabel:H("v4_stop","Stop"),action:"stop"};case"error":return{title:H("v4_error","Something went wrong"),detail:H("v4_error_detail","No action was started. Close this message and try again when the map is ready."),cancelLabel:H("v4_close","Close"),confirmLabel:H("v4_close","Close"),action:null};case null:return null}},w0=(L=document)=>{let C=L.activeElement;for(;C?.shadowRoot?.activeElement;)C=C.shadowRoot.activeElement;return C},E2=class extends y{constructor(){super(...arguments);this.state=w();this._measuredNarrow=!1;this._sheetOffset=0;this._overflowOpen=!1;this._browserFullscreen=!1;this._sheetDetent="half";this.#H=null;this.#e=null;this.#M=null;this.#V=null;this.#L=null;this.#t=null;this.#a=()=>{this._browserFullscreen=document.fullscreenElement===this.renderRoot.querySelector(".app")};this.#n=H=>{if(!this._overflowOpen)return;let V=this.renderRoot.querySelector(".overflow-wrap");(!V||!H.composedPath().includes(V))&&(this._overflowOpen=!1)}}static{this.properties={state:{attribute:!1},localize:{attribute:!1},_measuredNarrow:{state:!0},_sheetOffset:{state:!0},_overflowOpen:{state:!0},_browserFullscreen:{state:!0},_sheetDetent:{state:!0}}}static{this.styles=[E,D,g`
    :host {
      display: block;
      min-inline-size: 0;
      min-block-size: 0;
      block-size: 100%;
      color: var(--primary-text-color, #1f2933);
      background: var(--primary-background-color, #f5f7f8);
      container-type: size;
    }


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

    .nav, .overflow, .context-switcher {
      min-inline-size: 2.75rem;
      min-block-size: 2.75rem;
      border: 0;
      border-radius: 0.7rem;
      color: inherit;
      background: transparent;
      cursor: pointer;
    }

    select.context-switcher {
      max-inline-size: 9rem;
      padding-inline: 0.55rem;
      border: 1px solid var(--divider-color, rgb(60 75 85 / 16%));
      background: var(--card-background-color, #fff);
      text-overflow: ellipsis;
    }

    select.context-switcher:disabled {
      cursor: default;
      opacity: 0.82;
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
    .map-canvas { block-size: 100%; }

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
      grid-template-columns: 2.35rem minmax(0, 1fr) auto;
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
    .status-action, .workflow-back {
      min-block-size: 2.5rem;
      padding-inline: 0.75rem;
      border: 1px solid currentColor;
      border-radius: 0.65rem;
      color: var(--error-color, #b73535);
      background: transparent;
      cursor: pointer;
      font-weight: 700;
    }
    .status-action:disabled { cursor: default; opacity: 0.55; }

    .workflow {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-block-size: 0;
      padding: 1.15rem;
      overflow: auto;
    }

    .workflow-heading { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.6rem; align-items: center; }
    .workflow-heading h2 { margin: 0; font-size: 1.15rem; letter-spacing: -0.02em; }
    .workflow-back { min-inline-size: 2.75rem; padding-inline: 0.55rem; color: var(--primary-text-color, #1f2933); border-color: var(--divider-color, #c3ccd1); }
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
    .narrow .inspector { border-inline-start: 0; }
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
    .narrow .title { font-size: 0.95rem; }
    .narrow .context-switcher { max-inline-size: 6.5rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .narrow .full-map-hud { inset-block-end: max(0.75rem, env(safe-area-inset-bottom)); }
    .narrow .workspace.full-map .mobile-sheet { display: none; }

    @media (forced-colors: active) {
      .primary-action, .secondary-action, .dialog, .full-map-hud { border: 1px solid CanvasText; }
    }

    @media (prefers-reduced-motion: reduce) {
      .narrow .mobile-sheet { transition: none; }
    }
  `]}#C(H,V,e){return T(this.localize,H,V,e)}#H;#e;#M;#V;#L;#t;#a;#n;connectedCallback(){super.connectedCallback(),this.#H=new ResizeObserver(([H])=>{if(!H)return;let V=H.contentRect.width<768||H.contentRect.height<480;V!==this._measuredNarrow&&(this._measuredNarrow=V)}),this.#H.observe(this),window.addEventListener("pointerdown",this.#n,!0),document.addEventListener("fullscreenchange",this.#a),this.#e=new ResizeObserver(([H])=>{if(!H)return;let V=Math.ceil(H.target.getBoundingClientRect().height);V!==this._sheetOffset&&(this._sheetOffset=V)})}disconnectedCallback(){this.#H?.disconnect(),this.#H=null,this.#e?.disconnect(),this.#e=null,this.#M=null,window.removeEventListener("pointerdown",this.#n,!0),document.removeEventListener("fullscreenchange",this.#a),super.disconnectedCallback()}updated(H){let V=this.renderRoot.querySelector(".mobile-sheet");if(V!==this.#M&&(this.#e?.disconnect(),this.#M=V,V&&this.#e?.observe(V)),H.has("state")){let e=H.get("state");if(e?.precisionOpen&&!this.state.precisionOpen&&this.#V?.focus(),!e?.dialog&&this.state.dialog){let r=w0(this.shadowRoot||document);r?.hasAttribute("data-dialog-launcher")&&(this.#L=r),this.updateComplete.then(()=>{this.renderRoot.querySelector(".dialog button")?.focus()})}else if(e?.dialog&&!this.state.dialog){let r=this.#L?.isConnected&&this.#L.hasAttribute("data-dialog-launcher")?this.#L:this.#w(e.dialog);this.#L=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>r?.focus({preventScroll:!0}))})}(!e||e.workflow!==this.state.workflow)&&(this._sheetDetent="half")}}#o(H){this.dispatchEvent(new CustomEvent(i1,{detail:H,bubbles:!0,composed:!0}))}#s(H){if(H.enabled){if(H.id==="return-live"){this.#o({type:"set-history",historyId:null});return}this.#p(H.id)}}#m(H){if(this.state.workflow==="draw"&&this.state.draw.dirty&&H!=="draw"&&H!=="areaReview"){this.#t=H,this.#o({type:"open-dialog",dialog:"discardDraft"});return}this.#o({type:"open-workflow",workflow:H})}#S(){let H=this.#t;this.#t=null,this.#o({type:"discard-draft"}),H&&queueMicrotask(()=>this.#o({type:"open-workflow",workflow:H}))}#A(){this.#t=null,this.#h()}#h(){let H=this.state.dialog,V=H&&this.#L?.isConnected&&this.#L.hasAttribute("data-dialog-launcher")?this.#L:H?this.#w(H):null;this.#o({type:"dismiss-top-layer"}),V&&requestAnimationFrame(()=>V.focus({preventScroll:!0}))}#p(H){this.dispatchEvent(new CustomEvent(X1,{detail:{id:H},bubbles:!0,composed:!0}))}#i(H){this.#o({type:"dismiss-top-layer"}),this.#p(H)}#c(H){if(H.action==="discard"){this.#S();return}if(H.action==="delete-plan"||H.action==="delete-area"){this.#i(H.action);return}this.#o({type:"dismiss-top-layer"}),H.action==="stop"&&this.#p("stop")}#u(){this._sheetDetent=this._sheetDetent==="peek"?"half":this._sheetDetent==="half"?"full":"peek"}#Z(){if(this.state.precisionOpen||this.state.fullMap){this.#o({type:"dismiss-top-layer"});return}if(this.state.workflow!=="none"){this.#m("none");return}this.#r()}#r(){this.dispatchEvent(new CustomEvent("hass-toggle-menu",{bubbles:!0,composed:!0}))}#d(H){if(this._overflowOpen=!1,H==="support"){this.#m("support");return}if(H==="fullscreen"){let V=this.renderRoot.querySelector(".app");document.fullscreenElement?document.exitFullscreen():V?.requestFullscreen();return}this.dispatchEvent(new CustomEvent(X1,{detail:{id:"use-classic"},bubbles:!0,composed:!0}))}#v(H){this.#V=H.currentTarget,this.#o({type:"set-precision-open",value:!this.state.precisionOpen})}#l(H){let V=H;if(V.detail?.type!=="open-dialog")return;let e=V.composedPath().find(r=>r instanceof HTMLElement&&r.hasAttribute("data-dialog-launcher"));e instanceof HTMLElement&&(this.#L=e)}#w(H){return this.renderRoot.querySelector(m1)?.shadowRoot?.querySelector(`[data-dialog-launcher="${H}"]`)??null}#g(H){if(!(H.defaultPrevented||H.ctrlKey||H.metaKey||H.altKey)&&H.key==="Escape"){if(H.preventDefault(),this._overflowOpen){this._overflowOpen=!1;return}this.#o({type:"dismiss-top-layer"})}}#y(H){if(H.key!=="Tab")return;let V=[...this.renderRoot.querySelectorAll(".dialog button:not(:disabled)")],e=V[0],r=V.at(-1);!e||!r||(H.shiftKey&&this.shadowRoot?.activeElement===e?(H.preventDefault(),r.focus()):!H.shiftKey&&this.shadowRoot?.activeElement===r&&(H.preventDefault(),e.focus()))}#b(H,V="primary-action"){if(H.id==="choose-cleaning")return l;let r={stop:["v4_stop","Stop"],resume:["v4_resume","Resume"],"review-area":["v4_review_details","Review details"],"save-area":["area_save","Save area"],"run-area":["area_run","Clean area"],"save-plan":["plan_save","Save plan"],"run-plan":["plan_run","Run plan"]}[H.id],M=H.id==="clean-rooms"?H.label:r?this.#C(r[0],r[1]):H.label;return d`
      <button
        class=${`${V} ${H.kind==="danger"?"danger":""}`}
        type="button"
        ?disabled=${!H.enabled}
        title=${H.reason??""}
        @click=${()=>this.#s(H)}
      >${M}</button>
    `}#f(H){return H.workflow==="none"?d`
      <div class="quick-actions" aria-label=${this.#C("v4_cleaning_choices","Cleaning choices")}>
        <button class="featured" type="button" @click=${()=>this.#m("rooms")}>
          <span class="quick-copy"><strong>${this.#C("map_rooms","Rooms")}</strong><small>${this.#C("v4_rooms_quick_detail","Pick rooms and clean them now.")}</small></span><span class="quick-arrow" aria-hidden="true">\u203a</span>
        </button>
        <button type="button" @click=${()=>this.#m("plan")}>
          <span class="quick-copy"><strong>${this.#C("cleaning_workspace_plans","Plans")}</strong><small>${this.#C("v4_plans_quick_detail","Run or edit a saved routine.")}</small></span><span class="quick-arrow" aria-hidden="true">\u203a</span>
        </button>
        <button type="button" @click=${()=>this.#m("draw")}>
          <span class="quick-copy"><strong>${this.#C("area_workspace_title","Custom areas")}</strong><small>${this.#C("v4_areas_quick_detail","Use or draw a precise outline.")}</small></span><span class="quick-arrow" aria-hidden="true">\u203a</span>
        </button>
        <button type="button" @click=${()=>this.#m("history")}>
          <span class="quick-copy"><strong>${this.#C("map_timeline_history","History")}</strong><small>${this.#C("v4_history_quick_detail","Browse earlier floor maps.")}</small></span><span class="quick-arrow" aria-hidden="true">\u203a</span>
        </button>
      </div>
    `:d`<${m3}
      .state=${H}
      .localize=${this.localize}
      @matic-workspace-intent=${this.#l}
    ></${m3}>`}render(){let H=this.state,V=H.narrowHint||this._measuredNarrow,e=y0(H,this.localize),r=b0(H,this.localize),M=Y2({...H,narrowHint:V}),t=J2(H),i=!V&&M.id==="stop"?M:!V&&t?.id==="stop"?t:null,o=i===M?null:M,a=i===t?null:t,n=H.workflow==="draw"&&(V||H.fullMap),A=H.fullMap&&(H.coherence==="verifying"||H.coherence==="booting"),s=H.fullMap||H.precisionOpen,v=O0(H.dialog,this.localize),x=H.resources.history.value?.floors||[],u=x.length?x.map((m,S)=>({id:m.active?"current":m.id,label:`${m.label||(m.active?this.#C("v4_current_floor","Current floor"):this.#C("v4_saved_floor","Saved floor {number}",{number:m.ordinal??S+1}))}${!m.active&&m.snapshots.length===0?` \xB7 ${this.#C("v4_floor_not_captured","Visit floor to capture")}`:""}`,disabled:!m.active&&m.snapshots.length===0})):[{id:H.selection.floorId,label:H.floor.displayName,disabled:!1}];return d`
      <div class=${`root ${V?"narrow":"wide"}`} @keydown=${this.#g}>
        <div class="app">
          <header class="app-bar">
            <button
              class="nav"
              type="button"
              aria-label=${s?this.#C("v4_back","Back"):this.#C("v4_open_navigation","Open navigation")}
              @click=${this.#Z}
            >${s?"\u2190":"\u2630"}</button>
            <h1 class="title">${this.#C("map_studio_title","Matic Map")}</h1>
            ${H.robots.length>1?d`
              <select
                class="context-switcher robot-switcher"
                aria-label=${this.#C("v4_choose_robot","Choose robot")}
                .value=${H.selection.entryId||""}
                @change=${m=>this.#o({type:"select-entry",entryId:m.currentTarget.value})}
              >${H.robots.map(m=>d`
                <option value=${m.entryId}>${m.label}</option>
              `)}</select>
            `:l}
            <select
              class="context-switcher floor-switcher"
              aria-label=${this.#C("v4_choose_floor","Choose floor")}
              ?disabled=${u.length<=1}
              .value=${H.selection.floorId}
              @change=${m=>this.#o({type:"set-floor",floorId:m.currentTarget.value})}
            >${u.map(m=>d`
              <option value=${m.id} ?disabled=${m.disabled}>${m.label}</option>
            `)}</select>
            <span class="spacer"></span>
            <div class="overflow-wrap">
              <button
                class="overflow"
                type="button"
                aria-label=${this.#C("map_more","More map options")}
                aria-expanded=${String(this._overflowOpen)}
                @click=${()=>{this._overflowOpen=!this._overflowOpen}}
              >\u22ee</button>
              ${this._overflowOpen?d`
                <div class="overflow-menu" role="menu">
                  <label class="overflow-field">${this.#C("map_quality_label","Scene detail")}
                    <select
                      .value=${H.quality}
                      @change=${m=>this.#o({type:"set-quality",quality:m.currentTarget.value})}
                    >
                      <option value="auto">${this.#C("map_quality_auto","Auto detail")}</option>
                      <option value="efficient">${this.#C("map_quality_efficient","Efficient")}</option>
                      <option value="balanced">${this.#C("map_quality_balanced","Balanced")}</option>
                      <option value="maximum">${this.#C("map_quality_maximum","Maximum")}</option>
                    </select>
                  </label>
                  <button role="menuitem" type="button" @click=${()=>this.#d("fullscreen")}>${this._browserFullscreen?this.#C("exit_fullscreen","Exit full screen"):this.#C("expand_map","Browser full screen")}</button>
                  <button role="menuitem" type="button" @click=${()=>this.#d("support")}>${this.#C("v4_map_support","Map support")}</button>
                  <button role="menuitem" type="button" @click=${()=>this.#d("classic")}>${this.#C("v4_use_classic","Use classic Map Studio")}</button>
                </div>
              `:l}
            </div>
          </header>

          <main class=${`workspace ${H.fullMap?"full-map":""}`}>
            <div class="canvas">
              <${s3}
                class="map-canvas"
                style=${V&&!H.fullMap?`--map-sheet-offset:${this._sheetOffset}px`:"--map-sheet-offset:0px"}
                .state=${H}
                .localize=${this.localize}
              ></${s3}>
            </div>

            ${n?d`
              <div class="precision-popover">
                <button
                  class="precision-chip"
                  type="button"
                  aria-expanded=${String(H.precisionOpen)}
                  @click=${this.#v}
                >${H.draw.zoomPercent}% \u00b7 ${H.draw.brushMeters.toFixed(2)} m</button>
                <button
                  class="precision-chip"
                  type="button"
                  ?disabled=${H.draw.circles.length===0}
                  @click=${()=>this.#o({type:"clear-draft"})}
                >${this.#C("clear","Clear")}</button>
                ${H.precisionOpen?d`
                  <${p3} compact .state=${H} .localize=${this.localize}></${p3}>
                `:l}
              </div>
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
              aria-label="Map workspace"
            >
              ${V?d`
                <button
                  class="sheet-toggle"
                  type="button"
                  aria-label=${this.#C("v4_workspace_height","Map workspace, {height} height",{height:this._sheetDetent})}
                  aria-expanded=${String(this._sheetDetent!=="peek")}
                  @click=${this.#u}
                >
                  <span class="sheet-handle" aria-hidden="true"></span>
                  <span class="sheet-title">${r.title}</span>
                  <span class="sheet-description">${r.description}</span>
                </button>
                <div class="sheet-body">
                  <!--
                    Draw still omits the body on narrow. Restoring it puts two
                    "Clear" controls on screen at once -- the map's precision
                    chip and the panel's own -- so the saved-areas list stays
                    unreachable here until the sheet's per-workflow content
                    model decides which surface owns the drawing controls.
                  -->
                  ${H.workflow==="draw"?l:this.#f(H)}
                </div>
                <div class="primary-stack">
                  ${o?this.#b(o):l}
                  ${a?this.#b(a,"secondary-action"):l}
                </div>
              `:d`
                <div class="status-strip">
                  <span class="status-icon" aria-hidden="true">\u25c6</span>
                  <span><strong>${e.title}</strong><small>${e.detail}</small></span>
                  ${i?d`
                    <button
                      class="status-action"
                      type="button"
                      ?disabled=${!i.enabled}
                      title=${i.reason??""}
                      @click=${()=>this.#s(i)}
                    >${this.#C("v4_stop","Stop")}</button>
                  `:l}
                </div>
                <section class="workflow">
                  <div class="workflow-heading">
                    ${H.workflow!=="none"?d`
                      <button
                        class="workflow-back"
                        type="button"
                        aria-label=${this.#C("v4_back","Back")}
                        @click=${()=>this.#m("none")}
                      >\u2190</button>
                    `:l}
                    <h2 tabindex="-1">${r.title}</h2>
                  </div>
                  <p>${r.description}</p>
                  ${this.#f(H)}
                  <div class="primary-stack">
                    ${o?this.#b(o):l}
                    ${a?this.#b(a,"secondary-action"):l}
                  </div>
                </section>
              `}
            </aside>

            ${H.fullMap?d`
              <section
                class=${`full-map-hud ${t?"has-secondary":""}`}
                aria-label="Robot status and action"
              >
                <span class="hud-copy"><strong>${e.title}</strong><small>${e.detail}</small></span>
                ${A?l:this.#b(M)}
                ${!A&&t?this.#b(t,"secondary-action"):l}
              </section>
            `:l}
          </main>
        </div>

        ${v?d`
          <div class="dialog-backdrop">
            <section
              class="dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="dialog-title"
              @keydown=${this.#y}
            >
              <h2 id="dialog-title">${v.title}</h2>
              <p>${v.detail}</p>
              <div class="dialog-actions">
                <button
                  type="button"
                  @click=${H.dialog==="discardDraft"?this.#A:this.#h}
                >${v.cancelLabel}</button>
                ${v.action===null?l:d`
                  <button
                    class="discard"
                    type="button"
                    @click=${()=>this.#c(v)}
                  >${v.confirmLabel}</button>
                `}
              </div>
            </section>
          </div>
        `:l}
      </div>
    `}};customElements.get(M1)||customElements.define(M1,E2);var v3=z(M1),D2=class extends y{constructor(){super(...arguments);this.scenario="ready";this.narrow=!1;this.controls=!0;this._workspace=l2("ready");this.#C=new A1(this._workspace);this.#H=null}static{this.properties={scenario:{type:String,reflect:!0},narrow:{type:Boolean,reflect:!0},controls:{type:Boolean,reflect:!0},_workspace:{state:!0}}}static{this.styles=[E,D,g`
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
  `]}#C;#H;connectedCallback(){super.connectedCallback(),this.#H=this.#C.subscribe(H=>{this._workspace=H})}disconnectedCallback(){this.#H?.(),this.#H=null,super.disconnectedCallback()}willUpdate(H){H.has("scenario")?this.#C.replace({...l2(this.scenario),narrowHint:this.narrow}):H.has("narrow")&&this.#C.dispatch({type:"set-narrow-hint",value:this.narrow})}setScenario(H){s2.includes(H)&&(this.scenario=H)}getWorkspaceSnapshot(){return structuredClone(this.#C.value)}replaceWorkspaceState(H){this.#C.replace(structuredClone(H))}#e(H){$1(H.detail)&&(H.stopPropagation(),this.#C.dispatch(H.detail))}render(){return d`
      ${this.controls?d`
        <nav class="gallery-controls" aria-label="Map Studio states">
          ${s2.map(H=>d`
            <button
              type="button"
              aria-pressed=${String(this.scenario===H)}
              @click=${()=>{this.scenario=H}}
            >${H}</button>
          `)}
        </nav>
      `:null}
      <div class="stage">
        <${v3}
          class="shell"
          .state=${this._workspace}
          @matic-workspace-intent=${this.#e}
        ></${v3}>
      </div>
    `}};customElements.get("matic-map-studio-gallery-v0-4-0")||customElements.define("matic-map-studio-gallery-v0-4-0",D2);var c3="/api/matic_robot/slam_entries";var p=class extends Error{constructor(C){super(C),this.name="ContractError",this.code=C}},_=(L,C)=>{if(!L||typeof L!="object"||Array.isArray(L))throw new p(C);return L},b=(L,C,H)=>{if(typeof L!="string")throw new p(H);let V=L.trim();if(!V||Array.from(V).length>C||/[\u0000-\u001f\u007f]/u.test(V))throw new p(H);return V},k0=L=>{if(L==null||L==="")return null;try{return b(L,128,"invalid-floor-label")}catch{return null}},x1=(L,C,H,V)=>{if(typeof L!="number"||!Number.isFinite(L)||L<C||L>H)throw new p(V);return L},N=(L,C,H,V)=>{let e=x1(L,C,H,V);if(!Number.isInteger(e))throw new p(V);return e},$2=(L,C)=>L==null?null:N(L,1,C,"invalid-floor-ordinal"),h=(L,C)=>{if(typeof L!="boolean")throw new p(C);return L},P0=(L,C)=>L===null?null:h(L,C),x3=L=>{if(L==null)return null;let C=b(L,64,"invalid-map-session-key");if(!/^[0-9a-f]{64}$/u.test(C))throw new p("invalid-map-session-key");return C},B0=L=>{if(L==null)return null;if(L==="bootstrap_empty"||L==="map_session_unverified"||L==="floor_plan_unavailable"||L==="floor_plan_mismatch")return L;throw new p("invalid-map-block-reason")},T0=L=>{if(L===void 0)return"not_started";if(L==="not_started"||L==="running"||L==="complete"||L==="partial"||L==="failed")return L;throw new p("invalid-bootstrap-state")},X=(L,C)=>{let H=b(L,512,C);if(!H.startsWith("/")||H.startsWith("//")||H.includes("\\"))throw new p(C);return H},R0=L=>{let C=typeof L.map_health=="string"?L.map_health.toLowerCase():"",H=typeof L.stream_state=="string"?L.stream_state.toLowerCase():"",V=typeof L.invalid_tiles=="number"?L.invalid_tiles:0;return C.includes("error")||C.includes("fail")||C.includes("degrad")||V>0?"problem":L.map_truncated===!0||C.includes("truncat")||C.includes("limit")?"limited":L.map_complete===!0?"ready":H.includes("connect")||H.includes("collect")||H.includes("run")?"building":"unknown"},u3=L=>{let C=_(L,"invalid-catalog");if(!Array.isArray(C.entries)||C.entries.length>64)throw new p("invalid-catalog-entries");return C.entries.map(H=>{let V=_(H,"invalid-catalog-entry"),e=N(V.map_revision,0,Number.MAX_SAFE_INTEGER,"invalid-map-revision");return{entryId:b(V.entry_id,128,"invalid-entry-id"),sceneUrl:X(V.scene_url,"invalid-scene-url"),deltaUrl:V.delta_url===void 0||V.delta_url===null?null:X(V.delta_url,"invalid-delta-url"),poseUrl:X(V.pose_url,"invalid-pose-url"),historyUrl:X(V.history_url,"invalid-history-url"),areasUrl:X(V.areas_url,"invalid-areas-url"),plansUrl:X(V.plans_url,"invalid-plans-url"),mapRevision:e,mapFloorCoherent:h(V.map_floor_coherent,"invalid-floor-coherence"),mapSessionVerified:h(V.map_session_verified,"invalid-session-state"),mapSessionKey:x3(V.map_session_key),mapBlockReason:B0(V.map_block_reason),runnerLocked:h(V.runner_locked,"invalid-runner-lock"),stopSettlePending:h(V.stop_settle_pending,"invalid-stop-settle"),activePlan:h(V.active_plan,"invalid-active-plan"),nativeReconciliationPending:h(V.native_reconciliation_pending,"invalid-native-reconciliation"),nativeSessionActive:P0(V.native_session_active,"invalid-native-session"),mapComplete:h(V.map_complete,"invalid-map-complete"),mapTruncated:h(V.map_truncated,"invalid-map-truncated"),selectedFloorOrdinal:$2(V.selected_floor_ordinal,128),mapFloorOrdinal:$2(V.map_floor_ordinal,128),historyCount:N(V.history_count,0,12,"invalid-history-count"),historyFloorCount:N(V.history_floor_count,0,128,"invalid-floor-count"),health:R0(V),streamFailures:N(V.stream_failures,0,Number.MAX_SAFE_INTEGER,"invalid-stream-failures"),bootstrapState:T0(V.bootstrap_state),bootstrapPhotoSeen:V.bootstrap_photo_seen===void 0?!1:h(V.bootstrap_photo_seen,"invalid-bootstrap-photo"),bootstrapStructureSeen:V.bootstrap_structure_seen===void 0?!1:h(V.bootstrap_structure_seen,"invalid-bootstrap-structure"),bootstrapFailures:V.bootstrap_failures===void 0?0:N(V.bootstrap_failures,0,2,"invalid-bootstrap-failures")}})},Z3=(L,C)=>{if(!Array.isArray(L)||L.length!==2)throw new p(C);return[x1(L[0],-1e6,1e6,C),x1(L[1],-1e6,1e6,C)]},_0=(L,C)=>{if(!Array.isArray(L)||L.length<3||L.length>8192)throw new p(C);return L.map(H=>Z3(H,C))},S3=(L,C)=>{if(!Array.isArray(L)||L.length>256)throw new p("invalid-rooms");return L.map(H=>{let V=_(H,"invalid-room");return{roomId:b(V.room_id,128,"invalid-room-id"),name:b(V.name,128,"invalid-room-name"),boundary:C?_0(V.boundary,"invalid-room-boundary"):[]}})},F0=L=>{let C=_(L,"invalid-history-snapshot"),H=b(C.created_at,64,"invalid-history-time");if(!Number.isFinite(Date.parse(H)))throw new p("invalid-history-time");return{id:b(C.id,128,"invalid-history-id"),createdAt:H,revision:N(C.revision,0,Number.MAX_SAFE_INTEGER,"invalid-history-revision"),pointCount:N(C.point_count,1,15e5,"invalid-history-points"),sceneUrl:X(C.scene_url,"invalid-history-scene-url")}},h3=L=>{let C=_(L,"invalid-history");if(!Array.isArray(C.floors)||C.floors.length<1||C.floors.length>128)throw new p("invalid-history-floors");return{entryId:b(C.entry_id,128,"invalid-history-entry"),liveAvailable:h(C.live_available,"invalid-history-live"),floors:C.floors.map(H=>{let V=_(H,"invalid-history-floor");if(!Array.isArray(V.snapshots)||V.snapshots.length>12)throw new p("invalid-history-snapshots");return{id:b(V.id,128,"invalid-history-floor-id"),active:h(V.active,"invalid-history-floor-active"),readOnly:h(V.read_only,"invalid-history-floor-read-only"),liveAvailable:V.live_available===void 0?!1:h(V.live_available,"invalid-history-floor-live"),label:k0(V.label),ordinal:V.ordinal===void 0?null:$2(V.ordinal,128),snapshots:V.snapshots.map(F0)}})}},f3=L=>{if(L==="vacuum"||L==="mop"||L==="vacuum_and_mop")return L;throw new p("invalid-cleaning-mode")},g3=L=>{if(L==="quick"||L==="standard"||L==="heavy_duty")return L;throw new p("invalid-coverage-setting")},E0=L=>{let C=_(L,"invalid-area-circle");return{x:x1(C.x,-1e6,1e6,"invalid-area-circle"),y:x1(C.y,-1e6,1e6,"invalid-area-circle"),radius:x1(C.radius,.05,2.5,"invalid-area-circle")}},D0=L=>L==="current"||L==="review"||L==="stale"?L:"unknown",y3=L=>{let C=_(L,"invalid-areas");if(!Array.isArray(C.areas)||C.areas.length>256)throw new p("invalid-area-list");return{sceneUrl:X(C.scene_url,"invalid-area-scene-url"),rooms:S3(C.rooms,!0),areas:C.areas.map(H=>{let V=_(H,"invalid-area");if(!Array.isArray(V.circles)||V.circles.length>512)throw new p("invalid-area-circles");return{id:b(V.id,128,"invalid-area-id"),name:b(V.name,128,"invalid-area-name"),circles:V.circles.map(E0),cleaningMode:f3(V.cleaning_mode),coverageSetting:g3(V.coverage_setting),status:D0(V.status),canRebind:h(V.can_rebind,"invalid-area-rebind")}})}},b3=L=>{let C=_(L,"invalid-plans");if(!Array.isArray(C.plans)||C.plans.length>256)throw new p("invalid-plan-list");return{rooms:S3(C.rooms,!1).map(({roomId:V,name:e})=>({roomId:V,name:e})),selectedPlan:C.selected_plan===null||C.selected_plan===void 0?null:b(C.selected_plan,128,"invalid-selected-plan"),plans:C.plans.map(V=>{let e=_(V,"invalid-plan");if(!Array.isArray(e.rooms)||e.rooms.length>256||!Array.isArray(e.room_order))throw new p("invalid-plan-rooms");let r=e.run_behavior;if(r!=="intelligent"&&r!=="ordered")throw new p("invalid-run-behavior");return{id:b(e.id,128,"invalid-plan-id"),name:b(e.name,128,"invalid-plan-name"),enabled:h(e.enabled,"invalid-plan-enabled"),runBehavior:r,rooms:e.rooms.map(M=>{let t=_(M,"invalid-plan-room");return{roomId:b(t.room_id,128,"invalid-plan-room-id"),cleaningMode:f3(t.cleaning_mode),coverageSetting:g3(t.coverage_setting)}}),roomOrder:e.room_order.slice(0,256).map(M=>b(M,128,"invalid-room-order")),returnToBase:h(e.return_to_base,"invalid-return-to-base"),finishCurrentRoom:h(e.finish_current_room,"invalid-finish-room"),finishCurrentRoomThreshold:N(e.finish_current_room_threshold,0,100,"invalid-finish-threshold")}})}},O3=L=>{let C=_(L,"invalid-pose"),H=C.position,V=H===null?null:Z3(H,"invalid-pose-position"),e=C.pose_freshness;if(e!=="live"&&e!=="coordinator_fallback")throw new p("invalid-pose-freshness");return{position:V,source:b(C.source,64,"invalid-pose-source"),revision:N(C.revision,0,Number.MAX_SAFE_INTEGER,"invalid-pose-revision"),poseRevision:N(C.pose_revision,0,Number.MAX_SAFE_INTEGER,"invalid-pose-sequence"),floorCoherent:h(C.map_floor_coherent,"invalid-pose-floor"),mapSessionKey:x3(C.map_session_key),freshness:e}},w3=L=>{try{return X(L,"invalid-private-path"),!0}catch{return!1}};var k3=L=>{let r=()=>{throw new Error("invalid-scene")};(!(L instanceof ArrayBuffer)||L.byteLength<24||L.byteLength>16777216)&&r();let M=new DataView(L),t=new Uint8Array(L,0,8),i=String.fromCharCode(...t),o=M.getUint16(8,!0),a=M.getUint16(10,!0),n=M.getUint32(12,!0),A=M.getUint32(16,!0),s=M.getUint32(20,!0),v=A+s,x=24+n;(i!=="MATIC3D\0"||o!==1||a!==8||n>1024*1024||v<1||v>15e5||x+v*a!==L.byteLength)&&r();let u;try{u=JSON.parse(new TextDecoder("utf-8",{fatal:!0}).decode(new Uint8Array(L,24,n)))}catch{r()}(!u||typeof u!="object"||Array.isArray(u))&&r();let m=u,S=m.meters_per_cell,Z=m.origin_cells,f=m.span_cells;(typeof S!="number"||!Number.isFinite(S)||S<.001||S>.1||!Array.isArray(Z)||Z.length!==2||!Z.every(F=>typeof F=="number"&&Number.isFinite(F))||!Array.isArray(f)||f.length!==2||!f.every(F=>typeof F=="number"&&Number.isFinite(F)&&F>=1&&F<=65536))&&r();let _1=(Array.isArray(m.rooms)?m.rooms.slice(0,128):[]).flatMap((F,Q3)=>{if(!F||typeof F!="object"||Array.isArray(F))return[];let J=F,F1=typeof J.name=="string"?J.name.trim():"";if(!F1||Array.from(F1).length>128||/[\u0000-\u001f\u007f]/u.test(F1))return[];if(!Array.isArray(J.boundary)||J.boundary.length<3||J.boundary.length>8192)return[];let K2=J.boundary.flatMap(t2=>{if(!Array.isArray(t2)||t2.length!==2)return[];let[i2,o2]=t2;return typeof i2=="number"&&Number.isFinite(i2)&&typeof o2=="number"&&Number.isFinite(o2)?[[i2,o2]]:[]}),e2=J.center;if(K2.length<3||!Array.isArray(e2)||e2.length!==2)return[];let[r2,M2]=e2;return typeof r2!="number"||!Number.isFinite(r2)||typeof M2!="number"||!Number.isFinite(M2)?[]:[{id:`scene-room-${Q3+1}`,name:F1,boundary:K2,center:[r2,M2]}]}),G3=typeof m.sample_step=="number"&&Number.isInteger(m.sample_step)?Math.max(1,Math.min(15e5,m.sample_step)):1,G2=Z,Q2=f;return{buffer:L,pointOffset:x,floorCount:A,surfaceCount:s,total:v,metadata:{metersPerCell:S,origin:[G2[0],G2[1]],span:[Q2[0],Q2[1]],sampleStep:G3,rooms:_1}}},N0=L=>{if(L.byteLength>16777216||L.byteLength<24||!1||!1)throw new p("invalid-scene");try{return k3(L)}catch{throw new p("invalid-scene")}},z0=()=>`
  const parseTransfer = ${k3.toString()};
  self.onmessage = (event) => {
    const { id, buffer } = event.data;
    try {
      const parsed = parseTransfer(buffer);
      self.postMessage({ id, ok: true, parsed }, [parsed.buffer]);
    } catch (_) {
      self.postMessage({ id, ok: false, problem: "invalid-scene" });
    }
  };
`,j1=class{#C=null;#H=null;#e=0;#M=new Map;constructor(){if(!(typeof Worker!="function"||typeof URL?.createObjectURL!="function"))try{this.#H=URL.createObjectURL(new Blob([z0()],{type:"text/javascript"})),this.#C=new Worker(this.#H),this.#C.onmessage=C=>{let H=this.#M.get(C.data.id);H&&(this.#M.delete(C.data.id),C.data.ok&&C.data.parsed?H.resolve(C.data.parsed):H.reject(new p(C.data.problem||"invalid-scene")))},this.#C.onerror=()=>this.#V("scene-worker-failed")}catch{this.#C=null,this.#H&&URL.revokeObjectURL(this.#H),this.#H=null}}async parse(C,H){if(H?.aborted)throw new DOMException("Aborted","AbortError");if(!this.#C){if(await new Promise(e=>window.setTimeout(e,0)),H?.aborted)throw new DOMException("Aborted","AbortError");return N0(C)}let V=++this.#e;return new Promise((e,r)=>{let M=()=>{this.#M.delete(V),r(new DOMException("Aborted","AbortError"))};H?.addEventListener("abort",M,{once:!0}),this.#M.set(V,{resolve:t=>{H?.removeEventListener("abort",M),e(t)},reject:t=>{H?.removeEventListener("abort",M),r(t)}}),this.#C?.postMessage({id:V,buffer:C},[C])})}#V(C){for(let H of this.#M.values())H.reject(new p(C));this.#M.clear(),this.#C?.terminate(),this.#C=null}dispose(){this.#V("scene-parser-disposed"),this.#H&&URL.revokeObjectURL(this.#H),this.#H=null}};var j={catalog:1e4,scene:6e4,delta:35e3,pose:1e4,history:15e3,workflow:15e3,mutation:2e4},I=class extends Error{constructor(C,H=null){super(C),this.name="BackendError",this.code=C,this.status=H}},T1=36,u1=16*1024*1024,P3=(L,C)=>{let H=Number(L);if(!Number.isSafeInteger(H)||H<0)throw new p(C);return H},B3=(L,C)=>{let H=L.headers.get("X-Matic-Revision");if(H===null)return C;let V=Number(H);if(!Number.isSafeInteger(V)||V<0)throw new p("invalid-scene-revision");return V},T3=(L,C)=>{let H=L.headers.get("X-Matic-Floor-Coherent");if(H===null)return C;if(H==="1")return!0;if(H==="0")return!1;throw new p("invalid-scene-floor-header")},Y1=class{#C;#H=new j1;constructor(C){this.#C=C}async#e(C,H,V,e){if(!w3(C))throw new I("invalid-private-path");if(e?.aborted)throw new DOMException("Aborted","AbortError");let r=new AbortController,M=()=>r.abort();e?.addEventListener("abort",M,{once:!0});let t=!1,i=window.setTimeout(()=>{t=!0,r.abort()},V);try{let o=this.#C(),a=new Headers(H.headers),n={...H,cache:"no-store",credentials:"same-origin",headers:Object.fromEntries(a.entries()),signal:r.signal};if(typeof o?.fetchWithAuth=="function")return await o.fetchWithAuth(C,n);let A=o?.auth?.accessToken||o?.auth?.data?.access_token;A&&a.set("Authorization",`Bearer ${A}`);let s=typeof o?.hassUrl=="function"?o.hassUrl(C):C;return await fetch(s,{...n,headers:a})}catch(o){throw t&&!e?.aborted?new I("request-timeout"):r.signal.aborted?new DOMException("Aborted","AbortError"):o}finally{window.clearTimeout(i),e?.removeEventListener("abort",M)}}async#M(C,H,V,e={}){let r=await this.#e(C,{...e,headers:{Accept:"application/json",...e.headers||{}}},H,V);if(!r.ok)throw new I("request-failed",r.status);try{return await r.json()}catch{throw new p("invalid-json-response")}}async catalog(C){return u3(await this.#M(c3,j.catalog,C))}async scene(C,H,V,e,r,M){let t=new Headers({Accept:"application/vnd.matic.slam-scene"});e==="live"&&t.set("X-Matic-Prefer-Cached","1"),M&&t.set("If-None-Match",M);let i=await this.#e(C,{headers:t},j.scene,r),o=B3(i,H),a=T3(i,V);if(i.status===304)return{scene:null,floorCoherent:a,revision:o,notModified:!0};if(!i.ok)throw new I("scene-request-failed",i.status);if(i.headers.get("Content-Type")?.split(";",1)[0]!=="application/vnd.matic.slam-scene")throw new p("invalid-scene-content-type");return{scene:{...await this.#H.parse(await i.arrayBuffer(),r),revision:o,etag:i.headers.get("ETag"),source:e},floorCoherent:a,revision:o,notModified:!1}}async#V(C,H,V){if(!Number.isSafeInteger(H)||H<1||H>u1||typeof DecompressionStream!="function")throw new p("invalid-scene-delta");let r=new Blob([C]).stream().pipeThrough(new DecompressionStream("deflate")).getReader(),M=new Uint8Array(H),t=0,i=()=>{r.cancel()};V?.addEventListener("abort",i,{once:!0});try{for(;;){if(V?.aborted)throw new DOMException("Aborted","AbortError");let{done:o,value:a}=await r.read();if(o)break;if(!(a instanceof Uint8Array)||t+a.byteLength>H)throw new p("invalid-scene-delta");M.set(a,t),t+=a.byteLength}}finally{V?.removeEventListener("abort",i),r.releaseLock()}if(t!==H)throw new p("invalid-scene-delta");return M}async#L(C,H,V){if(C.byteLength<T1||C.byteLength>T1+u1||H.buffer.byteLength>u1)throw new p("invalid-scene-delta");let e=new DataView(C),r=new TextDecoder().decode(new Uint8Array(C,0,8)),M=e.getUint16(8,!0),t=e.getUint16(10,!0),i=P3(e.getBigUint64(12,!0),"invalid-scene-delta"),o=P3(e.getBigUint64(20,!0),"invalid-scene-delta"),a=e.getUint32(28,!0),n=e.getUint32(32,!0);if(r!=="MATICDLT"||M!==1||t!==1||i!==H.revision||o<=H.revision||a<24||a>u1||n>u1||n+T1!==C.byteLength)throw new p("invalid-scene-delta");let A=new Uint8Array(C,T1,n),s=new Uint8Array(H.buffer),x=(await this.#V(A,Math.max(s.byteLength,a),V)).slice(),u=1024*1024;for(let Z=0;Z<s.byteLength;Z+=u){if(V?.aborted)throw new DOMException("Aborted","AbortError");let f=Math.min(s.byteLength,Z+u);for(let P=Z;P<f;P+=1)x[P]=(x[P]??0)^(s[P]??0);f<s.byteLength&&await new Promise(P=>window.setTimeout(P,0))}let m=x.slice(0,a).buffer;return{parsed:{...await this.#H.parse(m,V),revision:o,etag:null,source:"live"},revision:o}}async sceneDelta(C,H,V,e){let r=C.includes("?")?"&":"?",M=await this.#e(`${C}${r}since=${encodeURIComponent(H.revision)}`,{headers:{Accept:"application/vnd.matic.slam-delta, application/vnd.matic.slam-scene"}},j.delta,e),t=B3(M,H.revision),i=T3(M,V);if(M.status===204){if(t!==H.revision)throw new p("invalid-scene-delta-revision");return{scene:null,floorCoherent:i,revision:t,notModified:!0}}if(!M.ok)throw new I("delta-request-failed",M.status);if(t<=H.revision)throw new p("invalid-scene-delta-revision");let o=Number(M.headers.get("Content-Length"));if(Number.isFinite(o)&&o>T1+u1)throw new p("invalid-scene-delta-size");let a=M.headers.get("Content-Type")?.split(";",1)[0],n=await M.arrayBuffer();if(a==="application/vnd.matic.slam-delta"){let s=Number(M.headers.get("X-Matic-Base-Revision"));if(!Number.isSafeInteger(s)||s!==H.revision)throw new p("invalid-scene-delta-base");let v=await this.#L(n,H,e);if(v.revision!==t)throw new p("invalid-scene-delta-revision");return{scene:{...v.parsed,etag:M.headers.get("ETag")},floorCoherent:i,revision:t,notModified:!1}}if(a!=="application/vnd.matic.slam-scene")throw new p("invalid-scene-delta-content-type");return{scene:{...await this.#H.parse(n,e),revision:t,etag:M.headers.get("ETag"),source:"live"},floorCoherent:i,revision:t,notModified:!1}}async pose(C,H){return O3(await this.#M(C,j.pose,H))}async history(C,H){return h3(await this.#M(C,j.history,H))}async plans(C,H){return b3(await this.#M(C,j.workflow,H))}async areas(C,H){return y3(await this.#M(C,j.workflow,H))}async saveArea(C,H,V){let e=await this.#M(C,j.mutation,V,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...H.areaId?{area_id:H.areaId}:{},name:H.name,circles:H.circles,cleaning_mode:H.cleaningMode,coverage_setting:H.coverageSetting})});if(!e||typeof e!="object"||typeof e.id!="string")throw new p("invalid-area-save-response");return e.id}async deleteArea(C,H,V){let e=await this.#e(`${C}?area_id=${encodeURIComponent(H)}`,{method:"DELETE",headers:{Accept:"application/json"}},j.mutation,V);if(!e.ok)throw new I("area-delete-failed",e.status)}async service(C,H,V,e){let r=this.#C();if(typeof r?.callService!="function")throw new I("service-unavailable");await r.callService(C,H,V,{entity_id:e})}dispose(){this.#H.dispose()}};var _3=()=>({version:4,view:"top",appearance:"photo",labels:!0,quality:"auto",cameras:{}}),R1=(L,C,H)=>Math.max(C,Math.min(H,L)),F3=L=>L.replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",W2=(L,C=4)=>`matic-map-studio:v${C}:${F3(L)}`,U0=L=>{if(!L||typeof L!="object")return null;let C=L;return["yaw","pitch","zoom","targetX","targetZ"].every(V=>typeof C[V]=="number"&&Number.isFinite(C[V]))?{yaw:R1(C.yaw,-Math.PI,Math.PI),pitch:R1(C.pitch,.18,Math.PI/2-.018),zoom:R1(C.zoom,.01,100),targetX:R1(C.targetX,-1e4,1e4),targetZ:R1(C.targetZ,-1e4,1e4)}:null},R3=L=>{let C=_3();if(!L||typeof L!="object")return C;let H=L,V=H.view==="three"||H.view==="top"||H.view==="rooms"?H.view:C.view,e=V==="rooms"?"top":V,r=H.quality==="auto"||H.quality==="efficient"||H.quality==="balanced"||H.quality==="maximum"?H.quality:C.quality,M=H.cameras&&typeof H.cameras=="object"?H.cameras:{},t={};for(let i of["three","top"]){let o=U0(M[i]);o&&(t[i]=o)}return{version:4,view:e,appearance:H.appearance==="rooms"||H.appearance==="photo"?H.appearance:C.appearance,labels:typeof H.labels=="boolean"?H.labels:C.labels,quality:r,cameras:t}},J1=class{#C="local-user";#H=null;load(C){this.#C=F3(C);try{let H=window.localStorage.getItem(W2(this.#C));if(H)return R3(JSON.parse(H));for(let V of[3,2]){let e=window.localStorage.getItem(W2(this.#C,V));if(e)return R3(JSON.parse(e))}}catch{}return _3()}schedule(C){this.#H!==null&&window.clearTimeout(this.#H),this.#H=window.setTimeout(()=>{this.#H=null;try{window.localStorage.setItem(W2(this.#C),JSON.stringify(C))}catch{}},250)}dispose(){this.#H!==null&&window.clearTimeout(this.#H),this.#H=null}},E3="matic-map-studio:preferred-frontend",D3=()=>{try{return window.localStorage.getItem(E3)==="v3"?"v3":"v4"}catch{return"v4"}},N2=L=>{try{return window.localStorage.setItem(E3,L),!0}catch{return!1}};var c=(L,C,H=null)=>({status:L,value:C,problem:H}),U=L=>L instanceof DOMException&&L.name==="AbortError",o1=(L,C)=>L instanceof I||L&&typeof L=="object"&&"code"in L&&typeof L.code=="string"?L.code:C,C2=L=>[L.selectedFloorOrdinal??"none",L.mapFloorOrdinal??"none",L.mapFloorCoherent?"coherent":"transition"].join(":"),H2=L=>[L.mapFloorOrdinal??"none",L.mapSessionVerified?"verified":"unverified",L.mapSessionKey??"no-session"].join(":"),G=L=>[L.entryId,L.selectedFloorOrdinal??"none",L.mapFloorOrdinal??"none"].join("|"),$3=L=>[L.entryId,C2(L),H2(L),L.mapRevision].join("|"),I3=L=>L.runnerLocked||L.stopSettlePending||L.activePlan||L.nativeReconciliationPending||L.nativeSessionActive===!0,G0=(L,C)=>L.entryKey===C.entryKey&&L.generation===C.generation&&L.floorKey===C.floorKey&&L.missionKey===C.missionKey,W3="Live map updates paused while the current map is rechecked.",N3="Reconnecting. The last verified map remains read only.",Q0=1e3,z2=(L,C)=>L.label?L.label:L.active?"Current floor":`Saved floor ${L.ordinal??C}`,V2=class{#C;#H=new I1;#e;#M=new J1;#V=new Map;#L=null;#t;#a=null;#n=null;#o=null;#s=!1;#m=!1;#S=!1;#A="";#h=0;#p="";#i=!1;#c=!0;constructor(C,H){this.#C=C,this.#e=H}sync(C,H){if(this.#i)return;let V=this.#c;if(this.#c=C.host.connected,this.#L=C,this.#t=H,this.#C.patch({host:C.host,activity:C.activity,batteryPercent:C.batteryPercent,robotLabel:C.robotLabel,robots:C.robots,locale:C.language}),C.userKey!==this.#p){this.#p=C.userKey;let e=this.#M.load(C.userKey);this.#C.patch({view:e.view,appearance:e.appearance,labelsVisible:e.labels,quality:e.quality,cameras:e.cameras})}if(!C.host.administrator){this.#Z(),this.#l("access-required");return}if(!C.host.connected){this.#Z();let e=this.#C.value,r=e.resources.scene.value;this.#C.patch({coherence:r?"degraded":"unavailable",resources:{...e.resources,pose:c("idle",null)},map:{...e.map,available:r!==null,exactPose:!1},notice:r?{tone:"warning",text:N3}:e.notice});return}if(C.host.robotCount===0){this.#Z(),this.#l("map-unavailable");return}if(this.#u(),!V){this.#C.value.notice?.text===N3&&this.#C.patch({notice:null}),this.refreshCatalog(!0);return}(this.#C.value.resources.catalog.status==="idle"||C.entryKey&&C.entryKey!==this.#C.value.selection.entryId)&&this.refreshCatalog(!0)}schedulePreferences(C){this.#M.schedule(C)}#u(){this.#a===null&&(this.#a=window.setInterval(()=>{document.visibilityState==="visible"&&this.refreshCatalog()},5e3)),this.#n===null&&(this.#n=window.setInterval(()=>{document.visibilityState==="visible"&&this.refreshPose()},Q0))}#Z(){this.#a!==null&&window.clearInterval(this.#a),this.#n!==null&&window.clearInterval(this.#n),this.#a=null,this.#n=null}#r(C){this.#V.get(C)?.abort();let H=new AbortController;return this.#V.set(C,H),H}#d(C,H){this.#V.get(C)===H&&this.#V.delete(C)}#v(C=[]){for(let[H,V]of this.#V)C.includes(H)||(V.abort(),this.#V.delete(H))}#l(C){this.#v(),this.#H.invalidate(),this.#A="";let H=this.#C.value;this.#C.patch({generation:this.#H.generation,coherence:H.host.administrator?"unavailable":"blocked",fullMap:!1,precisionOpen:!1,resources:{catalog:c("error",null,C),entry:null,scene:c("idle",null),pose:c("idle",null),history:c("idle",null),plans:c("idle",null),areas:c("idle",null)},map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1},selection:{...H.selection,entryId:null,floorId:"current",historyId:null}})}async refreshCatalog(C=!1){if(this.#i||this.#s||!this.#L?.host.administrator)return;this.#s=!0;let H=this.#r("catalog"),V=this.#C.value.resources.catalog.value;this.#C.patch({resources:{...this.#C.value.resources,catalog:c("loading",V)}});try{let e=await this.#e.catalog(H.signal);if(H.signal.aborted||this.#i)return;let r=this.#t?.config?.entry_id,M=typeof r=="string"?r:null,t=e.find(a=>a.entryId===this.#L?.entryKey)||e.find(a=>a.entryId===M)||e[0]||null,i=this.#C.value.resources.entry;if(t&&i&&G(t)===G(i)&&C2(t)===C2(i)&&H2(t)===H2(i)&&t.mapRevision<i.mapRevision&&(t={...t,mapRevision:i.mapRevision}),this.#C.patch({managedLock:t?I3(t):!1,resources:{...this.#C.value.resources,catalog:c(e.length?"ready":"empty",e),entry:t}}),!t){this.#l("no-loaded-robot");return}if(this.#C.value.selection.floorId!=="current"&&!C)return;let o=$3(t);if(!C&&o===this.#A){let a=this.#C.value,n=t.mapFloorCoherent&&t.mapSessionVerified,A=t.health==="problem"||t.health==="limited";this.#C.patch({coherence:n?A?"degraded":"current":"verifying",map:{...a.map,available:n&&a.resources.scene.value!==null,complete:t.mapComplete&&!t.mapTruncated,floorCoherent:t.mapFloorCoherent,sessionVerified:t.mapSessionVerified,exactPose:n?a.map.exactPose:!1},floor:{...a.floor,classifiedCount:Math.max(1,t.historyFloorCount)}});return}this.#A=o,this.#w(t)}catch(e){if(U(e))return;this.#C.patch({coherence:this.#C.value.resources.scene.value?"degraded":"unavailable",resources:{...this.#C.value.resources,catalog:c("error",V,o1(e,"catalog-unavailable"))}})}finally{this.#d("catalog",H),this.#s=!1}}#w(C){let H=this.#C.value,V=H.resources.entry,e=!!(V&&G(V)===G(C)),r=C.mapFloorCoherent&&C.mapSessionVerified;this.#v(e?["catalog","plans","areas","plan-mutation","area-mutation"]:["catalog"]);let M=e?H.resources.scene.value:null,t=H.resources.pose.value,i=e&&r&&C.mapSessionKey!==null&&t?.position&&t.mapSessionKey===C.mapSessionKey?t:null,o=this.#H.begin(C.entryId,C2(C),H2(C),C.mapRevision),a=C.health==="problem"||C.health==="limited",n=this.#C.value;this.#C.patch({managedLock:I3(C),generation:o.generation,coherence:r?a?"degraded":"current":"verifying",dataMode:"live",resources:{...n.resources,entry:C,scene:c(r?"loading":"idle",M),pose:c(r?"loading":"idle",i),history:c("loading",n.resources.history.value),plans:e?n.resources.plans:c("idle",null),areas:e?n.resources.areas:c("idle",null)},map:{available:r&&M!==null,complete:C.mapComplete&&!C.mapTruncated,floorCoherent:C.mapFloorCoherent,sessionVerified:C.mapSessionVerified,exactPose:r&&i!==null},floor:{classifiedCount:Math.max(1,C.historyFloorCount),displayName:C.selectedFloorOrdinal?`Floor ${C.selectedFloorOrdinal}`:"Current floor",readOnly:!1},selection:{...n.selection,entryId:C.entryId,floorId:"current",historyId:null,roomIds:e?n.selection.roomIds:[],planId:e?n.selection.planId:null,areaId:e?n.selection.areaId:null}}),this.#b(C,o),r&&(this.#g(C,o),this.#f(C,o))}async#g(C,H){let V=this.#r("scene");try{let e=await this.#e.scene(C.sceneUrl,C.mapRevision,C.mapFloorCoherent,"live",V.signal);if(!this.#H.accepts(H)||e.revision!==H.revision||!e.floorCoherent||!e.scene)return;let r=this.#C.value;if(this.#C.patch({resources:{...r.resources,scene:c("ready",e.scene)},map:{...r.map,available:!0},notice:r.notice?.text===W3?null:r.notice}),C.deltaUrl){let M=++this.#h;this.#y(C,H,e.scene,M)}}catch(e){if(U(e)||!this.#H.accepts(H))return;if(e instanceof I&&e.code==="request-timeout"){let i=this.#C.value;this.#C.patch({resources:{...i.resources,scene:c("loading",i.resources.scene.value,"scene-building")}}),window.setTimeout(()=>{this.#i||!this.#H.accepts(H)||this.#C.value.selection.floorId!=="current"||this.#g(C,H)},250);return}let r=this.#C.value,M=r.resources.pose.value,t=r.resources.scene.value!==null&&C.mapSessionKey!==null&&M?.position!==null&&M?.mapSessionKey===C.mapSessionKey;this.#C.patch({coherence:"degraded",resources:{...r.resources,scene:c("error",r.resources.scene.value,o1(e,"scene-unavailable"))},map:{...r.map,available:r.resources.scene.value!==null,exactPose:t}})}finally{this.#d("scene",V)}}async#y(C,H,V,e){if(!C.deltaUrl||typeof DecompressionStream!="function")return;let r=C.deltaUrl,M=C,t=H,i=V;try{for(;!this.#i&&e===this.#h&&this.#H.accepts(t)&&this.#C.value.selection.floorId==="current";){let o=this.#r("delta");try{let a=await this.#e.sceneDelta(r,i,M.mapFloorCoherent,o.signal);if(o.signal.aborted||this.#i||e!==this.#h||!this.#H.accepts(t))return;if(!a.floorCoherent){this.#C.patch({coherence:"verifying",map:{...this.#C.value.map,available:!1,floorCoherent:!1,exactPose:!1},resources:{...this.#C.value.resources,pose:c("idle",null)}}),this.#A="",this.refreshCatalog(!0);return}if(a.notModified||!a.scene){await new Promise(s=>window.setTimeout(s,100));continue}let n=this.#H.advance(t,a.revision);if(!n)return;t=n,i=a.scene,M={...M,mapRevision:a.revision},this.#A=$3(M);let A=this.#C.value;this.#C.patch({resources:{...A.resources,entry:M,scene:c("ready",i)},map:{...A.map,available:!0,floorCoherent:!0}}),this.#f(M,t)}finally{this.#d("delta",o)}}}catch(o){if(U(o)||this.#i||e!==this.#h||!this.#H.accepts(t))return;this.#C.patch({coherence:"degraded",notice:{tone:"warning",text:W3}}),this.#A="",this.refreshCatalog(!0)}}async#b(C,H){let V=this.#r("history");try{let e=await this.#e.history(C.historyUrl,V.signal);if(!this.#H.accepts(H)||e.entryId!==C.entryId)return;let r=e.floors.find(M=>M.active)||e.floors[0];if(!r)return;this.#C.patch({resources:{...this.#C.value.resources,history:c("ready",e)},floor:{...this.#C.value.floor,classifiedCount:e.floors.length,displayName:z2(r,1)}})}catch(e){if(U(e)||!this.#H.accepts(H))return;this.#C.patch({resources:{...this.#C.value.resources,history:c("error",null,o1(e,"history-unavailable"))}})}finally{this.#d("history",V)}}async refreshPose(){let C=this.#C.value.resources.entry,H=this.#H.current();!C||!H||this.#C.value.selection.floorId!=="current"||!C.mapFloorCoherent||!C.mapSessionVerified||await this.#f(C,H)}async#f(C,H){if(this.#m){this.#S=!0;return}this.#m=!0;let V=this.#r("pose");try{let e=await this.#e.pose(C.poseUrl,V.signal),r=this.#H.current(),M=this.#C.value.resources.entry;if(!r||!G0(H,r)||!M||!e.floorCoherent)return;if(e.mapSessionKey===null||e.mapSessionKey!==M.mapSessionKey){this.#C.patch({map:{...this.#C.value.map,exactPose:!1}}),this.#A="",this.refreshCatalog(!0);return}let t=this.#C.value,i=t.resources.pose.value,o=!!(t.map.exactPose&&i?.position&&i.mapSessionKey===M.mapSessionKey);if(e.position===null&&o){this.#C.patch({resources:{...t.resources,pose:c("ready",i)}});return}this.#C.patch({resources:{...t.resources,pose:c("ready",e)},map:{...t.map,exactPose:e.position!==null}})}catch(e){if(U(e)||!this.#H.accepts(H))return;let r=this.#C.value,M=r.resources.pose.value,t=!!(r.map.exactPose&&M?.position&&M.mapSessionKey===r.resources.entry?.mapSessionKey);this.#C.patch({resources:{...r.resources,pose:c("error",t?M:null,o1(e,"pose-unavailable"))},map:{...r.map,exactPose:t}})}finally{if(this.#d("pose",V),this.#m=!1,this.#S&&!this.#i){this.#S=!1;let e=this.#C.value.resources.entry,r=this.#H.current();e&&r&&this.#f(e,r)}}}async selectFloor(C){let H=this.#C.value.resources.history.value,V=this.#C.value.resources.entry;if(!H||!V)return;let e=H.floors.find(t=>t.id===C);if(!e)return;if(e.active){this.#A="",this.#C.dispatch({type:"set-floor",floorId:"current"}),await this.refreshCatalog(!0);return}let r=e.snapshots.at(-1);this.#v(["catalog"]);let M=this.#H.begin(V.entryId,e.id,r?.id||e.id,r?.revision||0);this.#C.patch({generation:M.generation,coherence:"current",dataMode:"history",floor:{classifiedCount:H.floors.length,displayName:z2(e,H.floors.indexOf(e)+1),readOnly:!0},selection:{...this.#C.value.selection,floorId:e.id,historyId:r?.id||null},resources:{...this.#C.value.resources,scene:c(r?"loading":"empty",null),pose:c("idle",null)},map:{available:!1,complete:!0,floorCoherent:!0,sessionVerified:!0,exactPose:!1}}),r&&await this.#P(r,M)}async selectHistory(C){let H=this.#C.value.resources.history.value,V=this.#C.value.resources.entry;if(!H||!V)return;if(!C){await this.selectFloor("current");return}let e=H.floors.find(t=>t.snapshots.some(i=>i.id===C)),r=e?.snapshots.find(t=>t.id===C);if(!e||!r)return;let M=this.#H.begin(V.entryId,e.id,r.id,r.revision);this.#v(["catalog"]),this.#C.patch({generation:M.generation,dataMode:"history",floor:{classifiedCount:H.floors.length,displayName:z2(e,H.floors.indexOf(e)+1),readOnly:!0},selection:{...this.#C.value.selection,floorId:e.id,historyId:r.id},resources:{...this.#C.value.resources,scene:c("loading",null),pose:c("idle",null)},map:{...this.#C.value.map,available:!1,exactPose:!1}}),await this.#P(r,M)}async#P(C,H){let V=this.#r("history-scene");try{let e=await this.#e.scene(C.sceneUrl,C.revision,!0,"history",V.signal);if(!this.#H.accepts(H)||!e.scene)return;this.#C.patch({resources:{...this.#C.value.resources,scene:c("ready",e.scene)},map:{...this.#C.value.map,available:!0,exactPose:!1}})}catch(e){if(U(e)||!this.#H.accepts(H))return;this.#C.patch({resources:{...this.#C.value.resources,scene:c("error",null,o1(e,"history-scene-unavailable"))}})}finally{this.#d("history-scene",V)}}async openWorkflow(C){this.#C.dispatch({type:"open-workflow",workflow:C}),(C==="plan"||C==="rooms")&&await this.loadPlans(),(C==="draw"||C==="areaReview")&&await this.loadAreas()}async loadPlans(){let C=this.#C.value.resources.entry;if(!C||!this.#H.current()||!n2(this.#C.value))return;let H=G(C),V=this.#r("plans");this.#C.patch({resources:{...this.#C.value.resources,plans:c("loading",null)}});try{let e=await this.#e.plans(C.plansUrl,V.signal),r=this.#C.value.resources.entry;if(!r||G(r)!==H)return;this.#C.patch({resources:{...this.#C.value.resources,plans:c("ready",e)},selection:{...this.#C.value.selection,planId:e.selectedPlan||e.plans[0]?.id||null}}),this.selectPlan(e.selectedPlan||e.plans[0]?.id||null)}catch(e){let r=this.#C.value.resources.entry;if(U(e)||!r||G(r)!==H)return;this.#C.patch({resources:{...this.#C.value.resources,plans:c("error",null,o1(e,"plans-unavailable"))}})}finally{this.#d("plans",V)}}selectPlan(C){let H=this.#C.value.resources.plans.value?.plans.find(V=>V.id===C);this.#C.patch({selection:{...this.#C.value.selection,planId:C},planDraft:H?this.#k(H):{...this.#C.value.planDraft,id:null,name:"",rooms:[],dirty:!1}})}#k(C){return{id:C.id,name:C.name,enabled:C.enabled,runBehavior:C.runBehavior,rooms:(C.roomOrder.length?C.roomOrder.flatMap(H=>{let V=C.rooms.find(e=>e.roomId===H);return V?[V]:[]}):C.rooms).map(H=>({...H})),returnToBase:C.returnToBase,finishCurrentRoom:C.finishCurrentRoom,finishCurrentRoomThreshold:C.finishCurrentRoomThreshold,dirty:!1}}async loadAreas(){let C=this.#C.value.resources.entry;if(!C||!this.#H.current()||!n2(this.#C.value))return;let H=G(C),V=this.#r("areas");this.#C.patch({resources:{...this.#C.value.resources,areas:c("loading",null)}});try{let e=await this.#e.areas(C.areasUrl,V.signal),r=this.#C.value.resources.entry;if(!r||G(r)!==H||e.sceneUrl!==r.sceneUrl)return;this.#C.patch({resources:{...this.#C.value.resources,areas:c("ready",e)}}),this.selectArea(e.areas[0]?.id||null)}catch(e){let r=this.#C.value.resources.entry;if(U(e)||!r||G(r)!==H)return;this.#C.patch({resources:{...this.#C.value.resources,areas:c("error",null,o1(e,"areas-unavailable"))}})}finally{this.#d("areas",V)}}selectArea(C){let H=this.#C.value.resources.areas.value?.areas.find(e=>e.id===C),V=this.#C.value;this.#C.patch({selection:{...V.selection,areaId:C},areaDraft:H?this.#B(H):{id:null,name:"",cleaningMode:"vacuum",coverageSetting:"standard",status:"new",canRebind:!1,dirty:!1},draw:{...V.draw,circles:H?.circles||[],undo:[],redo:[],dirty:!1,strokeCount:0}})}#B(C){return{id:C.id,name:C.name,cleaningMode:C.cleaningMode,coverageSetting:C.coverageSetting,status:C.status,canRebind:C.canRebind,dirty:!1}}async saveArea(){let C=this.#C.value,H=C.resources.entry,V=C.areaDraft;if(!H||!K(C)||!V.name.trim()||!C.draw.circles.length)return;let e=this.#r("area-mutation");this.#C.patch({command:"pending",notice:{tone:"info",text:"Saving area\u2026"}});try{let r=await this.#e.saveArea(H.areasUrl,{areaId:V.id,name:V.name.trim(),circles:C.draw.circles,cleaningMode:V.cleaningMode,coverageSetting:V.coverageSetting},e.signal);this.#C.patch({command:"idle",notice:{tone:"success",text:"Area saved"}}),await this.loadAreas(),this.selectArea(r)}catch(r){if(U(r))return;this.#C.patch({command:"failed",notice:{tone:"error",text:"Area could not be saved"}})}finally{this.#d("area-mutation",e)}}async deleteArea(){let C=this.#C.value.resources.entry,H=this.#C.value.selection.areaId;if(!C||!H||!K(this.#C.value))return;let V=this.#r("area-mutation");try{await this.#e.deleteArea(C.areasUrl,H,V.signal),this.#C.patch({notice:{tone:"success",text:"Area deleted"}}),await this.loadAreas()}catch(e){U(e)||this.#C.patch({notice:{tone:"error",text:"Area could not be deleted"}})}finally{this.#d("area-mutation",V)}}async savePlan(){let C=this.#C.value,H=C.planDraft,V=C.resources.plans.value;if(!V||!H.name.trim()||!H.rooms.length||!K(C))return;let e=H.rooms;await this.#O("save_plan",{...H.id?{plan_id:H.id}:{},name:H.name.trim(),enabled:H.enabled,run_behavior:H.runBehavior,rooms:e.map(r=>({room:V.rooms.find(M=>M.roomId===r.roomId)?.name,cleaning_mode:r.cleaningMode,coverage_setting:r.coverageSetting})).filter(r=>r.room),return_to_base:H.returnToBase,finish_current_room:H.finishCurrentRoom,finish_current_room_threshold:H.finishCurrentRoomThreshold,select:!H.id||V.selectedPlan===H.id},"Plan saved","Plan could not be saved"),await this.loadPlans()}async deletePlan(){let C=this.#C.value.selection.planId;C&&(await this.#O("delete_plan",{plan:C},"Plan deleted","Plan could not be deleted"),await this.loadPlans())}async executeAction(C){switch(C){case"stop":this.#C.value.resources.entry?.activePlan||this.#C.value.resources.entry?.runnerLocked?await this.#x("matic_robot","stop_intelligent_cleaning",{}):await this.#x("vacuum","return_to_base",{});return;case"resume":await this.#x("vacuum","start",{});return;case"run-plan":{let H=this.#C.value.selection.planId||this.#C.value.resources.plans.value?.selectedPlan;H&&await this.#x("matic_robot","run_selected_plan",{plan:H});return}case"clean-rooms":{let H=this.#C.value.resources.plans.value,e=this.#C.value.selection.roomSettings.map(r=>({room:H?.rooms.find(M=>M.roomId===r.roomId)?.name,cleaning_mode:r.cleaningMode,coverage_setting:r.coverageSetting})).filter(r=>r.room);e.length&&await this.#x("matic_robot","clean_room_sequence",{rooms:e,return_to_base:!0});return}case"run-area":{let H=this.#C.value.selection.areaId;H&&await this.#x("matic_robot","clean_area",{area:H});return}case"review-area":this.#C.dispatch({type:"open-workflow",workflow:"areaReview"});return;case"save-area":await this.saveArea();return;case"save-plan":await this.savePlan();return;case"delete-plan":await this.deletePlan();return;case"delete-area":await this.deleteArea();return}}async#O(C,H,V,e){let r=this.#L?.vacuumEntityId;if(!(!r||!K(this.#C.value)||this.#C.value.command==="pending")){this.#C.patch({command:"pending",notice:{tone:"info",text:"Saving\u2026"}});try{await this.#e.service("matic_robot",C,H,r),this.#C.patch({command:"idle",notice:{tone:"success",text:V}})}catch{this.#C.patch({command:"failed",notice:{tone:"error",text:e}})}}}async#x(C,H,V){let e=this.#C.value,r=this.#L?.vacuumEntityId,t=(H==="stop_intelligent_cleaning"||C==="vacuum"&&H==="return_to_base")&&e.command==="idle"&&(e.activity==="cleaning"||e.activity==="paused"||e.activity==="returning"||e.activity==="recharging");if(!(!r||!t&&!n1(e))){this.#C.patch({command:"pending",notice:null});try{await this.#e.service(C,H,V,r),this.#C.patch({command:"settling"}),this.#o!==null&&window.clearTimeout(this.#o),this.#o=window.setTimeout(()=>{this.#o=null,this.#C.value.command==="settling"&&this.#C.patch({command:"idle"})},15e3)}catch{this.#C.patch({command:"failed",notice:{tone:"error",text:"The robot did not accept that action"}})}}}updateDraftCircles(C,H=!0,V){this.#C.dispatch({type:"set-draft-circles",circles:C,record:H,...V?{previous:V}:{}}),this.#C.dispatch({type:"patch-area-draft",patch:{dirty:!0}})}dispose(){this.#i||(this.#i=!0,this.#Z(),this.#v(),this.#o!==null&&window.clearTimeout(this.#o),this.#o=null,this.#M.dispose(),this.#e.dispose(),this.#H.invalidate())}};var z3=L=>(L.workflow==="none"?0:1)+(L.fullMap?1:0)+(L.precisionOpen?1:0)+(L.dialog?1:0),K0=L=>{if(!L||typeof L!="object")return null;let C=L.maticMapLayer;if(!C||typeof C!="object")return null;let H=C.owner,V=C.depth;return typeof H=="string"&&Number.isInteger(V)&&Number(V)>=0?{owner:H,depth:Number(V)}:null},L2=class{#C;#H=`matic-map-${crypto.randomUUID?.()||Math.random().toString(36).slice(2)}`;#e=0;#M=null;#V=!1;constructor(C){this.#C=C}start(){this.#M||(this.#e=z3(this.#C.value),this.#M=this.#C.subscribe(C=>this.#L(C)),window.addEventListener("popstate",this.#t))}#L(C){let H=z3(C);if(this.#V){this.#V=!1,this.#e=H;return}if(H>this.#e)for(let V=this.#e+1;V<=H;V+=1){let e=history.state&&typeof history.state=="object"?history.state:{};history.pushState({...e,maticMapLayer:{owner:this.#H,depth:V}},"",window.location.href)}this.#e=H}#t=()=>{this.#e<1||(this.#V=!0,this.#C.dispatch({type:"dismiss-top-layer"}))};dismissTop(){if(this.#e<1)return!1;let C=K0(history.state);return C?.owner===this.#H&&C.depth===this.#e?history.back():this.#C.dispatch({type:"dismiss-top-layer"}),!0}dispose(){this.#M?.(),this.#M=null,window.removeEventListener("popstate",this.#t),this.#e=0}};var U3=z(M1),U2=class extends y{constructor(){super(...arguments);this.narrow=!1;this._workspace=w();this._classic=!1;this.entryOverride=null;this.#C=new N1;this.#H=new A1(this._workspace);this.#e=null;this.#M=null;this.#V=null;this.#L=null;this.#t=null;this.#a=""}static{this.styles=[E,D,g`
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
`]}static{this.properties={hass:{attribute:!1},narrow:{type:Boolean},route:{attribute:!1},panel:{attribute:!1},_workspace:{state:!0},_classic:{state:!0},entryOverride:{state:!0}}}#C;#H;#e;#M;#V;#L;#t;#a;connectedCallback(){super.connectedCallback(),this._classic=D3()==="v3",this.#M=this.#H.subscribe(H=>{this._workspace=H,this.#s(H)}),this._classic||this.#n()}disconnectedCallback(){this.#M?.(),this.#M=null,this.#o(),super.disconnectedCallback()}#n(){this.#L||(this.#V=new Y1(()=>this.hass),this.#L=new V2(this.#H,this.#V),this.#t=new L2(this.#H),this.#t.start(),this.#e&&this.#L.sync(this.#e,this.panel))}#o(){this.#t?.dispose(),this.#t=null,this.#L?.dispose(),this.#L=null,this.#V=null}#s(H){if(!this.#L)return;let V={version:4,view:H.view,appearance:H.appearance,labels:H.labelsVisible,quality:H.quality,cameras:H.cameras},e=JSON.stringify(V);e!==this.#a&&(this.#a=e,this.#L.schedulePreferences(V))}willUpdate(H){if(H.has("hass")||H.has("panel")||H.has("entryOverride")){let V=this.#C.project(this.hass,this.panel,this.entryOverride);if(V!==this.#e){this.#e=V;let e=V.host.connected?V.host.robotCount===0?"unavailable":V.host.administrator?"verifying":"blocked":"degraded";this.#H.replace({...this.#H.value,coherence:e,activity:V.activity,batteryPercent:V.batteryPercent,host:V.host,fullMap:V.host.administrator&&V.host.robotCount>0&&this.#H.value.fullMap,robotLabel:V.robotLabel,robots:V.robots,locale:V.language})}this._classic||this.#L?.sync(V,this.panel)}H.has("narrow")&&this.#H.value.narrowHint!==this.narrow&&this.#H.dispatch({type:"set-narrow-hint",value:this.narrow})}#m(H){if(!$1(H.detail))return;H.stopPropagation();let V=H.detail;if(V.type==="dismiss-top-layer"||V.type==="exit-full-map"){this.#t?.dismissTop()||this.#H.dispatch(V);return}if(V.type==="open-workflow"&&V.workflow!=="none"){this.#L?.openWorkflow(V.workflow);return}if(V.type==="set-floor"){this.#L?.selectFloor(V.floorId);return}if(V.type==="select-entry"){if(!this._workspace.robots.some(e=>e.entryId===V.entryId))return;this.entryOverride=V.entryId;return}if(V.type==="set-history"){this.#L?.selectHistory(V.historyId);return}if(V.type==="select-plan"){this.#L?.selectPlan(V.planId);return}if(V.type==="select-area"){this.#L?.selectArea(V.areaId);return}this.#H.dispatch(V)}#S(H){if(H.stopPropagation(),typeof H.detail?.id=="string"){if(H.detail.id==="use-classic"){N2("v3")&&(this.#o(),this._classic=!0);return}this.#L?.executeAction(H.detail.id),this.dispatchEvent(new CustomEvent("matic-map-v4-action-requested",{detail:{id:H.detail.id},bubbles:!0,composed:!0}))}}#A(){N2("v4")&&(this._classic=!1,this.#n(),this.requestUpdate())}updated(){if(!this._classic)return;let H=this.renderRoot.querySelector("matic-map-panel-v0-3-1");H&&(H.hass=this.hass,H.narrow=this.narrow,H.route=this.route,H.panel=this.panel)}getWorkspaceSnapshot(){return this.#H.value}render(){return this._classic?d`
        <div class="classic">
          <button class="return-v4" type="button" @click=${this.#A}>${T(this.hass?.localize,"v4_use_new","Use Map Studio 0.4")}</button>
          <matic-map-panel-v0-3-1></matic-map-panel-v0-3-1>
        </div>
      `:d`
      <${U3}
        .state=${this._workspace}
        .localize=${this.hass?.localize}
        @matic-workspace-intent=${this.#m}
        @matic-workspace-action=${this.#S}
      ></${U3}>
    `}};customElements.get(w2)||customElements.define(w2,U2);export{I1 as CoherenceMachine,D1 as DRAW_BRUSH_MAX_METERS,Z1 as DRAW_BRUSH_MIN_METERS,s2 as GALLERY_SCENARIOS,N1 as HassAdapter,a2 as MAP_PIXELS_PER_METER_AT_100,E1 as MAP_ZOOM_MAX,C1 as MAP_ZOOM_MIN,w2 as MATIC_MAP_PANEL_TAG,U2 as MaticMapPanelV4,D2 as MaticMapStudioGalleryV4,A1 as WorkspaceStore,j0 as brushCursorPixels,K as canEditCoordinates,n2 as canReadFloorResources,X2 as canShowExactPose,d1 as canShowLiveMap,n1 as canStartMotion,Y0 as commandState,l2 as createGalleryState,w as initialWorkspaceState,$1 as isWorkspaceIntent,C5 as mapScale,q3 as normalizeBrush,q2 as normalizeZoom,X3 as reduceWorkspace,J2 as selectPausedSecondaryAction,Y2 as selectPrimaryAction};
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
