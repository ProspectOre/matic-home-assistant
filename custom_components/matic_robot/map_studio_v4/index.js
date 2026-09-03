var J=100,F1=1e3,u1=.2,E1=2.5,o2=64,D1=L=>!L||typeof L!="object"?!1:typeof L.type=="string";var o1=()=>({status:"idle",value:null,problem:null}),G=(L,C,H)=>Math.max(C,Math.min(H,L)),z3=L=>({yaw:G(Number.isFinite(L.yaw)?L.yaw:0,-Math.PI,Math.PI),pitch:G(Number.isFinite(L.pitch)?L.pitch:Math.PI/2-.018,.18,Math.PI/2-.018),zoom:G(Number.isFinite(L.zoom)?L.zoom:1,.01,100),targetX:G(Number.isFinite(L.targetX)?L.targetX:0,-1e4,1e4),targetZ:G(Number.isFinite(L.targetZ)?L.targetZ:0,-1e4,1e4)}),q2=L=>Math.round(G(Number.isFinite(L)?L:100,100,1e3)),U3=L=>Math.round(G(Number.isFinite(L)?L:.2,.2,2.5)*100)/100,O=()=>({generation:0,coherence:"verifying",dataMode:"live",activity:"unknown",workflow:"none",command:"idle",fullMap:!1,precisionOpen:!1,dialog:null,narrowHint:!1,view:"top",appearance:"photo",labelsVisible:!0,quality:"auto",cameras:{},managedLock:!1,batteryPercent:null,floor:{classifiedCount:1,displayName:"Current floor",readOnly:!1},map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1},host:{connected:!0,administrator:!0,robotConnected:!1,robotCount:0},draw:{zoomPercent:100,zoomOriginX:50,zoomOriginY:50,brushMeters:.6,tool:"paint",dirty:!1,strokeCount:0,circles:[],undo:[],redo:[]},resources:{catalog:o1(),entry:null,scene:o1(),pose:o1(),history:o1(),plans:o1(),areas:o1()},selection:{entryId:null,floorId:"current",historyId:null,roomIds:[],roomSettings:[],cleaningMode:"vacuum",coverageSetting:"standard",planId:null,areaId:null},planDraft:{id:null,name:"",enabled:!0,runBehavior:"intelligent",rooms:[],returnToBase:!0,finishCurrentRoom:!1,finishCurrentRoomThreshold:50,dirty:!1},areaDraft:{id:null,name:"",cleaningMode:"vacuum",coverageSetting:"standard",status:"new",canRebind:!1,dirty:!1},notice:null,robotLabel:"Matic robot",robots:[],locale:"en"}),I=(L,C)=>({...L,draw:{...L.draw,...C}}),G3=(L,C)=>{switch(C.type){case"set-host":return{...L,host:C.host,fullMap:C.host.administrator&&C.host.robotCount>0?L.fullMap:!1};case"set-operational-state":return{...L,coherence:C.coherence,activity:C.activity,command:C.command??L.command};case"set-narrow-hint":return{...L,narrowHint:C.value};case"set-view":return{...L,view:C.view};case"set-appearance":return{...L,appearance:C.appearance};case"set-quality":return{...L,quality:C.quality};case"set-camera":return{...L,cameras:{...L.cameras,[C.view]:z3(C.camera)}};case"toggle-labels":return{...L,labelsVisible:!L.labelsVisible};case"open-workflow":return{...L,workflow:C.workflow,precisionOpen:!1};case"enter-full-map":return L.host.administrator&&L.host.robotCount>0&&L.map.available?{...L,fullMap:!0}:L;case"exit-full-map":return{...L,fullMap:!1,precisionOpen:!1};case"set-precision-open":return{...L,precisionOpen:C.value};case"set-zoom":return I(L,{zoomPercent:q2(C.value),...C.originX===void 0?{}:{zoomOriginX:G(C.originX,0,100)},...C.originY===void 0?{}:{zoomOriginY:G(C.originY,0,100)}});case"step-zoom":return I(L,{zoomPercent:q2(L.draw.zoomPercent*C.factor)});case"fit-map":return I(L,{zoomPercent:100,zoomOriginX:50,zoomOriginY:50});case"set-brush":return I(L,{brushMeters:U3(C.value)});case"set-draw-tool":return I(L,{tool:C.tool});case"mark-draft":{let H=Math.max(0,L.draw.strokeCount+C.strokeDelta);return I(L,{dirty:H>0,strokeCount:H})}case"undo-draft":{let H=L.draw.undo.at(-1);return H?I(L,{circles:H,undo:L.draw.undo.slice(0,-1),redo:[...L.draw.redo,L.draw.circles],dirty:!0,strokeCount:Math.max(0,L.draw.strokeCount-1)}):L}case"clear-draft":return L.draw.circles.length?I(L,{circles:[],undo:[...L.draw.undo.slice(-99),L.draw.circles],redo:[],dirty:!0,strokeCount:L.draw.strokeCount+1}):L;case"redo-draft":{let H=L.draw.redo.at(-1);return H?I(L,{circles:H,undo:[...L.draw.undo,L.draw.circles],redo:L.draw.redo.slice(0,-1),dirty:!0,strokeCount:L.draw.strokeCount+1}):L}case"set-draft-circles":{let H=C.circles.slice(0,512).map(e=>({...e})),V=C.record!==!1;return I(L,{circles:H,undo:V?[...L.draw.undo.slice(-99),C.previous??L.draw.circles]:L.draw.undo,redo:V?[]:L.draw.redo,dirty:!0,strokeCount:V?L.draw.strokeCount+1:L.draw.strokeCount})}case"discard-draft":return{...I(L,{dirty:!1,strokeCount:0,circles:[],undo:[],redo:[]}),dialog:null,workflow:"none",precisionOpen:!1};case"toggle-room":{let H=L.selection.roomIds.includes(C.roomId);return{...L,selection:{...L.selection,roomIds:H?L.selection.roomIds.filter(V=>V!==C.roomId):[...L.selection.roomIds,C.roomId],roomSettings:H?L.selection.roomSettings.filter(V=>V.roomId!==C.roomId):[...L.selection.roomSettings,{roomId:C.roomId,cleaningMode:"vacuum",coverageSetting:"standard"}]}}}case"patch-room-settings":return{...L,selection:{...L.selection,roomSettings:L.selection.roomSettings.map(H=>H.roomId===C.roomId?{...H,...C.cleaningMode?{cleaningMode:C.cleaningMode}:{},...C.coverageSetting?{coverageSetting:C.coverageSetting}:{}}:H)}};case"set-floor":return{...L,dataMode:C.floorId==="current"?"live":"history",selection:{...L.selection,floorId:C.floorId,historyId:null}};case"select-entry":return L;case"set-history":return{...L,dataMode:C.historyId?"history":"live",selection:{...L.selection,historyId:C.historyId}};case"select-plan":return{...L,selection:{...L.selection,planId:C.planId}};case"select-area":return{...L,selection:{...L.selection,areaId:C.areaId}};case"patch-plan-draft":return{...L,planDraft:{...L.planDraft,...C.patch,dirty:C.patch.dirty??!0}};case"patch-area-draft":return{...L,areaDraft:{...L.areaDraft,...C.patch,dirty:C.patch.dirty??!0}};case"set-notice":return{...L,notice:C.notice};case"open-dialog":return{...L,dialog:C.dialog};case"dismiss-top-layer":return L.dialog?{...L,dialog:null}:L.precisionOpen?{...L,precisionOpen:!1}:L.fullMap?{...L,fullMap:!1}:L.workflow!=="none"?{...L,workflow:"none",precisionOpen:!1}:L;case"return-live":return{...L,dataMode:"live",workflow:"none",floor:{...L.floor,readOnly:!1}}}},A1=class{#C=new Set;#H;constructor(C=O()){this.#H=C}get value(){return this.#H}dispatch(C){let H=G3(this.#H,C);if(H===this.#H)return H;this.#H=H;for(let V of this.#C)V(H);return H}replace(C){if(C!==this.#H){this.#H=C;for(let H of this.#C)H(C)}}patch(C){let H={...this.#H,...C};return this.replace(H),H}subscribe(C){return this.#C.add(C),C(this.#H),()=>this.#C.delete(C)}},$1=class{#C=null;#H=0;get generation(){return this.#H}begin(C,H,V,e){return this.#H+=1,this.#C={entryKey:C,generation:this.#H,floorKey:H,missionKey:V,revision:e},this.#C}current(){return this.#C}accepts(C){let H=this.#C;return!!(H&&C.entryKey===H.entryKey&&C.generation===H.generation&&C.floorKey===H.floorKey&&C.missionKey===H.missionKey&&C.revision===H.revision)}advance(C,H){return!this.accepts(C)||!Number.isSafeInteger(H)||H<=C.revision?null:(this.#C={...C,revision:H},this.#C)}invalidate(){return this.#H+=1,this.#C=null,this.#H}},n1=L=>L.dataMode==="live"&&L.map.available&&(L.coherence==="current"||L.coherence==="degraded")&&L.host.administrator,K2=L=>n1(L)&&(L.coherence==="current"||L.coherence==="degraded")&&L.map.floorCoherent&&L.map.sessionVerified&&L.map.exactPose&&L.host.connected&&L.host.robotConnected,Q=L=>n1(L)&&L.coherence==="current"&&L.map.complete&&L.map.floorCoherent&&L.map.sessionVerified&&L.host.connected&&L.host.robotConnected&&!L.floor.readOnly,a2=L=>n1(L)&&L.coherence==="current"&&L.map.floorCoherent&&L.map.sessionVerified&&L.host.connected&&L.host.robotConnected&&!L.floor.readOnly,a1=L=>Q(L)&&!L.managedLock&&L.command==="idle"&&(L.activity==="idle"||L.activity==="docked"),Z1=(L,C,H)=>({id:L,label:C,kind:"neutral",enabled:!1,reason:H}),X2=L=>{if(L.dataMode==="history")return{id:"return-live",label:"Return to Live",kind:"primary",enabled:!0};if(L.activity==="cleaning"||L.activity==="returning"||L.activity==="recharging")return{id:"stop",label:"Stop",kind:"danger",enabled:L.command==="idle"};if(L.activity==="stopping"||L.command==="settling")return Z1("stopping","Stopping\u2026","Waiting for the robot to settle");if(L.activity==="paused")return{id:"resume",label:"Resume",kind:"primary",enabled:L.command==="idle"};if(!L.host.connected)return Z1("reconnecting","Reconnecting\u2026","Home Assistant is offline");if(!L.host.administrator)return Z1("administrator","Administrator required","This map is private");if(!L.host.robotConnected)return Z1("robot-offline","Robot offline","Reconnect the robot first");if(L.coherence!=="current")return Z1("locating","Locating\u2026","Waiting for the current map");if(L.workflow==="draw")return L.fullMap||L.narrowHint?{id:"review-area",label:"Review details",kind:"primary",enabled:L.draw.dirty,...L.draw.dirty?{}:{reason:"Draw an area first"}}:{id:"save-area",label:"Save area",kind:"primary",enabled:L.draw.dirty&&Q(L),...L.draw.dirty?{}:{reason:"Draw an area first"}};if(L.workflow==="rooms"){let C=a1(L)&&L.selection.roomIds.length>0;return{id:"clean-rooms",label:L.selection.roomIds.length?`Clean ${L.selection.roomIds.length} room${L.selection.roomIds.length===1?"":"s"}`:"Choose rooms",kind:"primary",enabled:C,...C?{}:{reason:L.selection.roomIds.length?"Map verification is required":"Select at least one room"}}}if(L.workflow==="plan"){if(L.planDraft.dirty||!L.planDraft.id){let C=Q(L)&&L.planDraft.name.trim().length>0&&L.planDraft.rooms.length>0;return{id:"save-plan",label:"Save plan",kind:"primary",enabled:C,...C?{}:{reason:"Add a name and at least one room"}}}return{id:"run-plan",label:"Run plan",kind:"primary",enabled:a1(L)&&L.planDraft.enabled,...a1(L)?{}:{reason:"Map verification is required"}}}if(L.workflow==="areaReview"){if(L.areaDraft.dirty||L.draw.dirty||!L.areaDraft.id||L.areaDraft.canRebind){let H=Q(L)&&L.areaDraft.name.trim().length>0&&L.draw.circles.length>0;return{id:"save-area",label:L.areaDraft.canRebind?"Confirm on this map":"Save area",kind:"primary",enabled:H,...H?{}:{reason:"Add a name and at least one mark"}}}let C=L.areaDraft.status==="current";return{id:"run-area",label:"Clean area",kind:"primary",enabled:C&&a1(L),...C?{}:{reason:"Review or redraw this area first"}}}return{id:"choose-cleaning",label:"Choose what to clean",kind:"neutral",enabled:!1,reason:"Choose rooms, a plan, or a custom area"}},j2=L=>L.activity==="paused"?{id:"stop",label:"Stop",kind:"danger",enabled:L.command==="idle"}:null,U0=L=>L.draw.brushMeters*64*(L.draw.zoomPercent/100),Q3=[2,1,.5,.25,.1,.05],Y2=L=>{let C=64*(L.draw.zoomPercent/100),H=Q3.reduce((V,e)=>{let r=Math.abs(e*C-64),M=Math.abs(V*C-64);return r<M?e:V});return{meters:H,pixels:H*C,label:H<1?`${Math.round(H*100)} cm`:`${H} m`}},G0=(L,C)=>({...L,command:C});var J2="a".repeat(64),d1=[{roomId:"room-a",name:"Kitchen",boundary:[[.5,.5],[4,.5],[4,3],[.5,3]]},{roomId:"room-b",name:"Living room",boundary:[[4.2,.5],[8.5,.5],[8.5,3.4],[4.2,3.4]]},{roomId:"room-c",name:"Office",boundary:[[.5,3.2],[3.8,3.2],[3.8,6.5],[.5,6.5]]},{roomId:"room-d",name:"Bedroom",boundary:[[4,3.6],[8.5,3.6],[8.5,6.5],[4,6.5]]}],C5=()=>{let L=[180,140],C={meters_per_cell:.05,origin_cells:[0,0],span_cells:L,sample_step:1,rooms:d1.map(o=>{let a=o.boundary.map(([n,d])=>[n/.05,d/.05]),A=[a.reduce((n,[d])=>n+d,0)/a.length,a.reduce((n,[,d])=>n+d,0)/a.length];return{name:o.name,boundary:a,boundary_closed:!0,center:A}})},H=new TextEncoder().encode(JSON.stringify(C)),V=[];for(let o=10;o<130;o+=2)for(let a=10;a<170;a+=2){let A=a<80?o<65?0:2:o<72?1:3,n=[[185,219,224],[201,211,233],[210,226,194],[232,207,207]][A]||[190,205,215];V.push([a,o,0,...n])}let e=500;for(let o=0;o<e;o+=1){let a=o%4,A=o*7%120,n=a<2?a===0?10:168:10+A,d=a>=2?a===2?10:128:10+A;V.push([n,d,10+o%18,104,122,137])}let r=V.length-e,M=new ArrayBuffer(24+H.byteLength+V.length*8),t=new DataView(M);new Uint8Array(M,0,8).set(new TextEncoder().encode("MATIC3D\0")),t.setUint16(8,1,!0),t.setUint16(10,8,!0),t.setUint32(12,H.byteLength,!0),t.setUint32(16,r,!0),t.setUint32(20,e,!0),new Uint8Array(M,24,H.byteLength).set(H);let i=new DataView(M,24+H.byteLength);return V.forEach(([o=0,a=0,A=0,n=0,d=0,v=0],u)=>{let x=u*8;i.setUint16(x,o,!0),i.setUint16(x+2,a,!0),i.setUint8(x+4,A),i.setUint8(x+5,n),i.setUint8(x+6,d),i.setUint8(x+7,v)}),{buffer:M,pointOffset:24+H.byteLength,floorCount:r,surfaceCount:e,total:V.length,revision:7,etag:'"synthetic-scene"',source:"live",metadata:{metersPerCell:.05,origin:[0,0],span:L,sampleStep:1,rooms:C.rooms.map((o,a)=>({id:d1[a]?.roomId||`room-${a}`,name:o.name,boundary:o.boundary,center:o.center}))}}},I1=()=>({entryId:"synthetic-entry",sceneUrl:"/api/matic_robot/slam_scene/synthetic",deltaUrl:"/api/matic_robot/slam_delta/synthetic",poseUrl:"/api/matic_robot/slam_pose/synthetic",historyUrl:"/api/matic_robot/slam_history/synthetic",areasUrl:"/api/matic_robot/areas/synthetic",plansUrl:"/api/matic_robot/plans/synthetic",mapRevision:7,mapFloorCoherent:!0,mapSessionVerified:!0,mapSessionKey:J2,mapBlockReason:null,runnerLocked:!1,stopSettlePending:!1,activePlan:!1,nativeReconciliationPending:!1,nativeSessionActive:!1,mapComplete:!0,mapTruncated:!1,selectedFloorOrdinal:1,mapFloorOrdinal:1,historyCount:2,historyFloorCount:2,health:"ready",streamFailures:0,bootstrapState:"complete",bootstrapPhotoSeen:!0,bootstrapStructureSeen:!0,bootstrapFailures:0}),A2=()=>({rooms:d1.map(({roomId:L,name:C})=>({roomId:L,name:C})),selectedPlan:"daily",plans:[{id:"daily",name:"Daily clean",enabled:!0,runBehavior:"intelligent",rooms:d1.slice(0,3).map(({roomId:L})=>({roomId:L,cleaningMode:"vacuum",coverageSetting:"standard"})),roomOrder:d1.slice(0,3).map(({roomId:L})=>L),returnToBase:!0,finishCurrentRoom:!1,finishCurrentRoomThreshold:50}]}),n2=()=>({sceneUrl:I1().sceneUrl,rooms:d1.map(L=>({...L,boundary:L.boundary.map(C=>[...C])})),areas:[{id:"entryway",name:"Entryway",circles:[{x:1.5,y:1.4,radius:.3},{x:1.9,y:1.6,radius:.3}],cleaningMode:"vacuum",coverageSetting:"standard",status:"current",canRebind:!1}]}),H5=()=>({entryId:"synthetic-entry",liveAvailable:!0,floors:[{id:"current",active:!0,readOnly:!1,liveAvailable:!0,label:"House",ordinal:null,snapshots:[{id:"current-old",createdAt:"2026-08-29T14:00:00Z",revision:6,pointCount:5300,sceneUrl:"/synthetic-history-current-old"},{id:"current-new",createdAt:"2026-08-29T16:12:00Z",revision:7,pointCount:5300,sceneUrl:"/synthetic-history-current-new"}]},{id:"saved-1",active:!1,readOnly:!0,liveAvailable:!1,label:"Shed",ordinal:2,snapshots:[{id:"saved-one",createdAt:"2026-08-28T11:30:00Z",revision:3,pointCount:3100,sceneUrl:"/synthetic-history-saved"}]},{id:"saved-2",active:!1,readOnly:!0,liveAvailable:!1,label:"Annex",ordinal:3,snapshots:[]}]}),V5=()=>({position:[4.475,3.475],source:"latest_pose",revision:7,poseRevision:4,floorCoherent:!0,mapSessionKey:J2,freshness:"live"});var q3=()=>({...O(),coherence:"current",activity:"docked",batteryPercent:92,robots:[{entryId:"synthetic-entry",label:"Matic robot"}],host:{connected:!0,administrator:!0,robotConnected:!0,robotCount:1},floor:{classifiedCount:2,displayName:"House",readOnly:!1},map:{available:!0,complete:!0,floorCoherent:!0,sessionVerified:!0,exactPose:!0},resources:{catalog:{status:"ready",value:[I1()],problem:null},entry:I1(),scene:{status:"ready",value:C5(),problem:null},pose:{status:"ready",value:V5(),problem:null},history:{status:"ready",value:H5(),problem:null},plans:{status:"ready",value:A2(),problem:null},areas:{status:"ready",value:n2(),problem:null}},selection:{...O().selection,entryId:"synthetic-entry",planId:"daily"},planDraft:{...O().planDraft,id:"daily",name:"Daily clean",rooms:A2().plans[0]?.rooms||[]}}),d2=L=>{let C=q3();switch(L){case"ready":return C;case"cleaning":return{...C,activity:"cleaning"};case"paused":return{...C,activity:"paused"};case"returning":return{...C,activity:"returning"};case"recharging":return{...C,activity:"recharging",batteryPercent:18};case"rooms":return{...C,workflow:"rooms"};case"draw":return{...C,workflow:"draw",areaDraft:{...C.areaDraft,id:"entryway",name:"Entryway",status:"current"},selection:{...C.selection,areaId:"entryway"},draw:{...C.draw,dirty:!0,strokeCount:3,circles:n2().areas[0]?.circles||[]}};case"history":return{...C,dataMode:"history",workflow:"history",floor:{...C.floor,readOnly:!0},map:{...C.map,exactPose:!1},selection:{...C.selection,floorId:"saved-1",historyId:"saved-one"}};case"transition":return{...C,coherence:"verifying",activity:"unknown",map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1}};case"problem":return{...C,activity:"problem",coherence:"blocked"};case"ha-offline":return{...C,coherence:"degraded",host:{...C.host,connected:!1},map:{...C.map,exactPose:!1}};case"robot-offline":return{...C,coherence:"degraded",host:{...C.host,robotConnected:!1},map:{...C.map,exactPose:!1}};case"access":return{...C,coherence:"blocked",host:{...C.host,administrator:!1},map:{...C.map,available:!1,exactPose:!1}};case"empty":return{...C,coherence:"unavailable",host:{...C.host,robotConnected:!1,robotCount:0},map:{...C.map,available:!1,exactPose:!1}};case"unsupported":return{...C,coherence:"blocked",map:{...C.map,available:!1,exactPose:!1}};case"multi-robot":return{...C,host:{...C.host,robotCount:2},robots:[{entryId:"synthetic-entry",label:"Matic robot"},{entryId:"synthetic-entry-two",label:"Second robot"}]}}},l2=["ready","cleaning","paused","returning","recharging","rooms","draw","history","transition","problem","ha-offline","robot-offline","access","empty","unsupported","multi-robot"];var K3=(L,C)=>{if(C?.recharge_and_resume===!0&&C?.charging===!0)return"recharging";switch(L){case"cleaning":return"cleaning";case"paused":return"paused";case"returning":return"returning";case"docked":return"docked";case"idle":return"idle";case"error":return"problem";default:return"unknown"}},X3=L=>typeof L!="number"||!Number.isFinite(L)?null:Math.round(Math.max(0,Math.min(100,L))),j3=L=>{let C=L.attributes?.matic_entry_id;return typeof C=="string"&&C.length>0?C:null},Y3=L=>String(L||"local-user").replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",L5=L=>{if(typeof L!="string")return"Matic robot";let C=L.trim();return C&&Array.from(C).length<=128&&!/[\u0000-\u001f\u007f]/u.test(C)?C:"Matic robot"},W1=class{#C="";#H=null;project(C,H,V=null){let e=C?.states??{},r=H?.config?.entry_id,M=typeof r=="string"?r:null,t=null,i=null,o=null,a=new Map;for(let[Z,B]of Object.entries(e)){let w=j3(B);if(!w||!Z.startsWith("vacuum."))continue;a.set(w,{entryId:w,label:L5(B.attributes?.friendly_name)});let R1=V||M;(!t||R1&&w===R1)&&(t=B,i=Z,o=w)}let A={connected:C?.connected!==!1,administrator:C?.user?.is_admin===!0,robotConnected:t!==null&&t.state!=="unavailable"&&t.state!=="unknown",robotCount:a.size},n=t?K3(t.state,t.attributes):"unknown",d=X3(t?.attributes?.battery_level),v=C?.selectedLanguage||C?.language||"en",u=Y3(C?.user?.id),x=L5(t?.attributes?.friendly_name),m=[...a.values()].sort((Z,B)=>Z.label.localeCompare(B.label,v,{sensitivity:"base"})),b=[A.connected,A.administrator,A.robotConnected,A.robotCount,n,d??"none",v,u,i??"none",o??"none",x,m.map(Z=>`${Z.entryId}:${Z.label}`).join(",")].join("|");return b===this.#C&&this.#H?this.#H:(this.#C=b,this.#H={host:A,activity:n,batteryPercent:d,language:v,userKey:u,vacuumEntityId:i,entryKey:o,robotLabel:x,robots:m},this.#H)}};var N1=globalThis,z1=N1.ShadowRoot&&(N1.ShadyCSS===void 0||N1.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,s2=Symbol(),e5=new WeakMap,S1=class{constructor(C,H,V){if(this._$cssResult$=!0,V!==s2)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=C,this.t=H}get styleSheet(){let C=this.o,H=this.t;if(z1&&C===void 0){let V=H!==void 0&&H.length===1;V&&(C=e5.get(H)),C===void 0&&((this.o=C=new CSSStyleSheet).replaceSync(this.cssText),V&&e5.set(H,C))}return C}toString(){return this.cssText}},r5=L=>new S1(typeof L=="string"?L:L+"",void 0,s2),h=(L,...C)=>{let H=L.length===1?L[0]:C.reduce((V,e,r)=>V+(M=>{if(M._$cssResult$===!0)return M.cssText;if(typeof M=="number")return M;throw Error("Value passed to 'css' function must be a 'css' function result: "+M+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(e)+L[r+1],L[0]);return new S1(H,L,s2)},M5=(L,C)=>{if(z1)L.adoptedStyleSheets=C.map(H=>H instanceof CSSStyleSheet?H:H.styleSheet);else for(let H of C){let V=document.createElement("style"),e=N1.litNonce;e!==void 0&&V.setAttribute("nonce",e),V.textContent=H.cssText,L.appendChild(V)}},p2=z1?L=>L:L=>L instanceof CSSStyleSheet?(C=>{let H="";for(let V of C.cssRules)H+=V.cssText;return r5(H)})(L):L;var{is:J3,defineProperty:C0,getOwnPropertyDescriptor:H0,getOwnPropertyNames:V0,getOwnPropertySymbols:L0,getPrototypeOf:e0}=Object,U1=globalThis,t5=U1.trustedTypes,r0=t5?t5.emptyScript:"",M0=U1.reactiveElementPolyfillSupport,h1=(L,C)=>L,m2={toAttribute(L,C){switch(C){case Boolean:L=L?r0:null;break;case Object:case Array:L=L==null?L:JSON.stringify(L)}return L},fromAttribute(L,C){let H=L;switch(C){case Boolean:H=L!==null;break;case Number:H=L===null?null:Number(L);break;case Object:case Array:try{H=JSON.parse(L)}catch{H=null}}return H}},o5=(L,C)=>!J3(L,C),i5={attribute:!0,type:String,converter:m2,reflect:!1,useDefault:!1,hasChanged:o5};Symbol.metadata??=Symbol("metadata"),U1.litPropertyMetadata??=new WeakMap;var q=class extends HTMLElement{static addInitializer(C){this._$Ei(),(this.l??=[]).push(C)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(C,H=i5){if(H.state&&(H.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(C)&&((H=Object.create(H)).wrapped=!0),this.elementProperties.set(C,H),!H.noAccessor){let V=Symbol(),e=this.getPropertyDescriptor(C,V,H);e!==void 0&&C0(this.prototype,C,e)}}static getPropertyDescriptor(C,H,V){let{get:e,set:r}=H0(this.prototype,C)??{get(){return this[H]},set(M){this[H]=M}};return{get:e,set(M){let t=e?.call(this);r?.call(this,M),this.requestUpdate(C,t,V)},configurable:!0,enumerable:!0}}static getPropertyOptions(C){return this.elementProperties.get(C)??i5}static _$Ei(){if(this.hasOwnProperty(h1("elementProperties")))return;let C=e0(this);C.finalize(),C.l!==void 0&&(this.l=[...C.l]),this.elementProperties=new Map(C.elementProperties)}static finalize(){if(this.hasOwnProperty(h1("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(h1("properties"))){let H=this.properties,V=[...V0(H),...L0(H)];for(let e of V)this.createProperty(e,H[e])}let C=this[Symbol.metadata];if(C!==null){let H=litPropertyMetadata.get(C);if(H!==void 0)for(let[V,e]of H)this.elementProperties.set(V,e)}this._$Eh=new Map;for(let[H,V]of this.elementProperties){let e=this._$Eu(H,V);e!==void 0&&this._$Eh.set(e,H)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(C){let H=[];if(Array.isArray(C)){let V=new Set(C.flat(1/0).reverse());for(let e of V)H.unshift(p2(e))}else C!==void 0&&H.push(p2(C));return H}static _$Eu(C,H){let V=H.attribute;return V===!1?void 0:typeof V=="string"?V:typeof C=="string"?C.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){this._$ES=new Promise(C=>this.enableUpdating=C),this._$AL=new Map,this._$E_(),this.requestUpdate(),this.constructor.l?.forEach(C=>C(this))}addController(C){(this._$EO??=new Set).add(C),this.renderRoot!==void 0&&this.isConnected&&C.hostConnected?.()}removeController(C){this._$EO?.delete(C)}_$E_(){let C=new Map,H=this.constructor.elementProperties;for(let V of H.keys())this.hasOwnProperty(V)&&(C.set(V,this[V]),delete this[V]);C.size>0&&(this._$Ep=C)}createRenderRoot(){let C=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return M5(C,this.constructor.elementStyles),C}connectedCallback(){this.renderRoot??=this.createRenderRoot(),this.enableUpdating(!0),this._$EO?.forEach(C=>C.hostConnected?.())}enableUpdating(C){}disconnectedCallback(){this._$EO?.forEach(C=>C.hostDisconnected?.())}attributeChangedCallback(C,H,V){this._$AK(C,V)}_$ET(C,H){let V=this.constructor.elementProperties.get(C),e=this.constructor._$Eu(C,V);if(e!==void 0&&V.reflect===!0){let r=(V.converter?.toAttribute!==void 0?V.converter:m2).toAttribute(H,V.type);this._$Em=C,r==null?this.removeAttribute(e):this.setAttribute(e,r),this._$Em=null}}_$AK(C,H){let V=this.constructor,e=V._$Eh.get(C);if(e!==void 0&&this._$Em!==e){let r=V.getPropertyOptions(e),M=typeof r.converter=="function"?{fromAttribute:r.converter}:r.converter?.fromAttribute!==void 0?r.converter:m2;this._$Em=e;let t=M.fromAttribute(H,r.type);this[e]=t??this._$Ej?.get(e)??t,this._$Em=null}}requestUpdate(C,H,V,e=!1,r){if(C!==void 0){let M=this.constructor;if(e===!1&&(r=this[C]),V??=M.getPropertyOptions(C),!((V.hasChanged??o5)(r,H)||V.useDefault&&V.reflect&&r===this._$Ej?.get(C)&&!this.hasAttribute(M._$Eu(C,V))))return;this.C(C,H,V)}this.isUpdatePending===!1&&(this._$ES=this._$EP())}C(C,H,{useDefault:V,reflect:e,wrapped:r},M){V&&!(this._$Ej??=new Map).has(C)&&(this._$Ej.set(C,M??H??this[C]),r!==!0||M!==void 0)||(this._$AL.has(C)||(this.hasUpdated||V||(H=void 0),this._$AL.set(C,H)),e===!0&&this._$Em!==C&&(this._$Eq??=new Set).add(C))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(H){Promise.reject(H)}let C=this.scheduleUpdate();return C!=null&&await C,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??=this.createRenderRoot(),this._$Ep){for(let[e,r]of this._$Ep)this[e]=r;this._$Ep=void 0}let V=this.constructor.elementProperties;if(V.size>0)for(let[e,r]of V){let{wrapped:M}=r,t=this[e];M!==!0||this._$AL.has(e)||t===void 0||this.C(e,void 0,r,t)}}let C=!1,H=this._$AL;try{C=this.shouldUpdate(H),C?(this.willUpdate(H),this._$EO?.forEach(V=>V.hostUpdate?.()),this.update(H)):this._$EM()}catch(V){throw C=!1,this._$EM(),V}C&&this._$AE(H)}willUpdate(C){}_$AE(C){this._$EO?.forEach(H=>H.hostUpdated?.()),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(C)),this.updated(C)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(C){return!0}update(C){this._$Eq&&=this._$Eq.forEach(H=>this._$ET(H,this[H])),this._$EM()}updated(C){}firstUpdated(C){}};q.elementStyles=[],q.shadowRootOptions={mode:"open"},q[h1("elementProperties")]=new Map,q[h1("finalized")]=new Map,M0?.({ReactiveElement:q}),(U1.reactiveElementVersions??=[]).push("2.1.2");var h2=globalThis,a5=L=>L,G1=h2.trustedTypes,A5=G1?G1.createPolicy("lit-html",{createHTML:L=>L}):void 0,m5="$lit$",j=`lit$${Math.random().toFixed(9).slice(2)}$`,v5="?"+j,t0=`<${v5}>`,V1=document,g1=()=>V1.createComment(""),y1=L=>L===null||typeof L!="object"&&typeof L!="function",f2=Array.isArray,i0=L=>f2(L)||typeof L?.[Symbol.iterator]=="function",v2=`[ \t\n\f\r]`,f1=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,n5=/-->/g,d5=/>/g,C1=RegExp(`>|${v2}(?:([^\\s"'>=/]+)(${v2}*=${v2}*(?:[^ \t\n\f\r"'\`<>=]|("|')|))|$)`,"g"),l5=/'/g,s5=/"/g,c5=/^(?:script|style|textarea|title)$/i,g2=L=>(C,...H)=>({_$litType$:L,strings:C,values:H}),y=g2(1),x5=g2(2),u5=g2(3),L1=Symbol.for("lit-noChange"),l=Symbol.for("lit-nothing"),p5=new WeakMap,H1=V1.createTreeWalker(V1,129);function Z5(L,C){if(!f2(L)||!L.hasOwnProperty("raw"))throw Error("invalid template strings array");return A5!==void 0?A5.createHTML(C):C}var o0=(L,C)=>{let H=L.length-1,V=[],e,r=C===2?"<svg>":C===3?"<math>":"",M=f1;for(let t=0;t<H;t++){let i=L[t],o,a,A=-1,n=0;for(;n<i.length&&(M.lastIndex=n,a=M.exec(i),a!==null);)n=M.lastIndex,M===f1?a[1]==="!--"?M=n5:a[1]!==void 0?M=d5:a[2]!==void 0?(c5.test(a[2])&&(e=RegExp("</"+a[2],"g")),M=C1):a[3]!==void 0&&(M=C1):M===C1?a[0]===">"?(M=e??f1,A=-1):a[1]===void 0?A=-2:(A=M.lastIndex-a[2].length,o=a[1],M=a[3]===void 0?C1:a[3]==='"'?s5:l5):M===s5||M===l5?M=C1:M===n5||M===d5?M=f1:(M=C1,e=void 0);let d=M===C1&&L[t+1].startsWith("/>")?" ":"";r+=M===f1?i+t0:A>=0?(V.push(o),i.slice(0,A)+m5+i.slice(A)+j+d):i+j+(A===-2?t:d)}return[Z5(L,r+(L[H]||"<?>")+(C===2?"</svg>":C===3?"</math>":"")),V]},b1=class L{constructor({strings:C,_$litType$:H},V){let e;this.parts=[];let r=0,M=0,t=C.length-1,i=this.parts,[o,a]=o0(C,H);if(this.el=L.createElement(o,V),H1.currentNode=this.el.content,H===2||H===3){let A=this.el.content.firstChild;A.replaceWith(...A.childNodes)}for(;(e=H1.nextNode())!==null&&i.length<t;){if(e.nodeType===1){if(e.hasAttributes())for(let A of e.getAttributeNames())if(A.endsWith(m5)){let n=a[M++],d=e.getAttribute(A).split(j),v=/([.?@])?(.*)/.exec(n);i.push({type:1,index:r,name:v[2],strings:d,ctor:v[1]==="."?x2:v[1]==="?"?u2:v[1]==="@"?Z2:s1}),e.removeAttribute(A)}else A.startsWith(j)&&(i.push({type:6,index:r}),e.removeAttribute(A));if(c5.test(e.tagName)){let A=e.textContent.split(j),n=A.length-1;if(n>0){e.textContent=G1?G1.emptyScript:"";for(let d=0;d<n;d++)e.append(A[d],g1()),H1.nextNode(),i.push({type:2,index:++r});e.append(A[n],g1())}}}else if(e.nodeType===8)if(e.data===v5)i.push({type:2,index:r});else{let A=-1;for(;(A=e.data.indexOf(j,A+1))!==-1;)i.push({type:7,index:r}),A+=j.length-1}r++}}static createElement(C,H){let V=V1.createElement("template");return V.innerHTML=C,V}};function l1(L,C,H=L,V){if(C===L1)return C;let e=V!==void 0?H._$Co?.[V]:H._$Cl,r=y1(C)?void 0:C._$litDirective$;return e?.constructor!==r&&(e?._$AO?.(!1),r===void 0?e=void 0:(e=new r(L),e._$AT(L,H,V)),V!==void 0?(H._$Co??=[])[V]=e:H._$Cl=e),e!==void 0&&(C=l1(L,e._$AS(L,C.values),e,V)),C}var c2=class{constructor(C,H){this._$AV=[],this._$AN=void 0,this._$AD=C,this._$AM=H}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(C){let{el:{content:H},parts:V}=this._$AD,e=(C?.creationScope??V1).importNode(H,!0);H1.currentNode=e;let r=H1.nextNode(),M=0,t=0,i=V[0];for(;i!==void 0;){if(M===i.index){let o;i.type===2?o=new O1(r,r.nextSibling,this,C):i.type===1?o=new i.ctor(r,i.name,i.strings,this,C):i.type===6&&(o=new S2(r,this,C)),this._$AV.push(o),i=V[++t]}M!==i?.index&&(r=H1.nextNode(),M++)}return H1.currentNode=V1,e}p(C){let H=0;for(let V of this._$AV)V!==void 0&&(V.strings!==void 0?(V._$AI(C,V,H),H+=V.strings.length-2):V._$AI(C[H])),H++}},O1=class L{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(C,H,V,e){this.type=2,this._$AH=l,this._$AN=void 0,this._$AA=C,this._$AB=H,this._$AM=V,this.options=e,this._$Cv=e?.isConnected??!0}get parentNode(){let C=this._$AA.parentNode,H=this._$AM;return H!==void 0&&C?.nodeType===11&&(C=H.parentNode),C}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(C,H=this){C=l1(this,C,H),y1(C)?C===l||C==null||C===""?(this._$AH!==l&&this._$AR(),this._$AH=l):C!==this._$AH&&C!==L1&&this._(C):C._$litType$!==void 0?this.$(C):C.nodeType!==void 0?this.T(C):i0(C)?this.k(C):this._(C)}O(C){return this._$AA.parentNode.insertBefore(C,this._$AB)}T(C){this._$AH!==C&&(this._$AR(),this._$AH=this.O(C))}_(C){this._$AH!==l&&y1(this._$AH)?this._$AA.nextSibling.data=C:this.T(V1.createTextNode(C)),this._$AH=C}$(C){let{values:H,_$litType$:V}=C,e=typeof V=="number"?this._$AC(C):(V.el===void 0&&(V.el=b1.createElement(Z5(V.h,V.h[0]),this.options)),V);if(this._$AH?._$AD===e)this._$AH.p(H);else{let r=new c2(e,this),M=r.u(this.options);r.p(H),this.T(M),this._$AH=r}}_$AC(C){let H=p5.get(C.strings);return H===void 0&&p5.set(C.strings,H=new b1(C)),H}k(C){f2(this._$AH)||(this._$AH=[],this._$AR());let H=this._$AH,V,e=0;for(let r of C)e===H.length?H.push(V=new L(this.O(g1()),this.O(g1()),this,this.options)):V=H[e],V._$AI(r),e++;e<H.length&&(this._$AR(V&&V._$AB.nextSibling,e),H.length=e)}_$AR(C=this._$AA.nextSibling,H){for(this._$AP?.(!1,!0,H);C!==this._$AB;){let V=a5(C).nextSibling;a5(C).remove(),C=V}}setConnected(C){this._$AM===void 0&&(this._$Cv=C,this._$AP?.(C))}},s1=class{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(C,H,V,e,r){this.type=1,this._$AH=l,this._$AN=void 0,this.element=C,this.name=H,this._$AM=e,this.options=r,V.length>2||V[0]!==""||V[1]!==""?(this._$AH=Array(V.length-1).fill(new String),this.strings=V):this._$AH=l}_$AI(C,H=this,V,e){let r=this.strings,M=!1;if(r===void 0)C=l1(this,C,H,0),M=!y1(C)||C!==this._$AH&&C!==L1,M&&(this._$AH=C);else{let t=C,i,o;for(C=r[0],i=0;i<r.length-1;i++)o=l1(this,t[V+i],H,i),o===L1&&(o=this._$AH[i]),M||=!y1(o)||o!==this._$AH[i],o===l?C=l:C!==l&&(C+=(o??"")+r[i+1]),this._$AH[i]=o}M&&!e&&this.j(C)}j(C){C===l?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,C??"")}},x2=class extends s1{constructor(){super(...arguments),this.type=3}j(C){this.element[this.name]=C===l?void 0:C}},u2=class extends s1{constructor(){super(...arguments),this.type=4}j(C){this.element.toggleAttribute(this.name,!!C&&C!==l)}},Z2=class extends s1{constructor(C,H,V,e,r){super(C,H,V,e,r),this.type=5}_$AI(C,H=this){if((C=l1(this,C,H,0)??l)===L1)return;let V=this._$AH,e=C===l&&V!==l||C.capture!==V.capture||C.once!==V.once||C.passive!==V.passive,r=C!==l&&(V===l||e);e&&this.element.removeEventListener(this.name,this,V),r&&this.element.addEventListener(this.name,this,C),this._$AH=C}handleEvent(C){typeof this._$AH=="function"?this._$AH.call(this.options?.host??this.element,C):this._$AH.handleEvent(C)}},S2=class{constructor(C,H,V){this.element=C,this.type=6,this._$AN=void 0,this._$AM=H,this.options=V}get _$AU(){return this._$AM._$AU}_$AI(C){l1(this,C)}};var a0=h2.litHtmlPolyfillSupport;a0?.(b1,O1),(h2.litHtmlVersions??=[]).push("3.3.3");var S5=(L,C,H)=>{let V=H?.renderBefore??C,e=V._$litPart$;if(e===void 0){let r=H?.renderBefore??null;V._$litPart$=e=new O1(C.insertBefore(g1(),r),r,void 0,H??{})}return e._$AI(L),e};var y2=globalThis,f=class extends q{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){let C=super.createRenderRoot();return this.renderOptions.renderBefore??=C.firstChild,C}update(C){let H=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(C),this._$Do=S5(H,this.renderRoot,this.renderOptions)}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(!0)}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(!1)}render(){return L1}};f._$litElement$=!0,f.finalized=!0,y2.litElementHydrateSupport?.({LitElement:f});var A0=y2.litElementPolyfillSupport;A0?.({LitElement:f});(y2.litElementVersions??=[]).push("4.2.2");var F=h`
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
`,E=h`
*, *::before, *::after { box-sizing: border-box; }
button, input, select, textarea { font: inherit; }
.ms-icon { display: block; flex: none; inline-size: var(--ms-icon); block-size: var(--ms-icon); }
.ms-icon--sm { inline-size: var(--ms-icon-sm); block-size: var(--ms-icon-sm); }
`;var f5=Symbol.for(""),n0=L=>{if(L?.r===f5)return L?._$litStatic$},N=L=>({_$litStatic$:L,r:f5});var h5=new Map,b2=L=>(C,...H)=>{let V=H.length,e,r,M=[],t=[],i,o=0,a=!1;for(;o<V;){for(i=C[o];o<V&&(r=H[o],(e=n0(r))!==void 0);)i+=e+C[++o],a=!0;o!==V&&t.push(r),M.push(i),o++}if(o===V&&M.push(C[V]),a){let A=M.join("$$lit$$");(C=h5.get(A))===void 0&&(M.raw=M,h5.set(A,C=M)),H=t}return L(C,...H)},s=b2(y),v7=b2(x5),c7=b2(u5);var g5=import.meta.url.match(/\/matic_robot\/[^/]+-([a-f0-9]{12})\/map-studio-v4(?:\/|$)/u)?.[1]??"dev",w1=g5==="dev"?"":`-${g5}`,k1=`matic-map-canvas-v4${w1}`,e1=`matic-precision-controls-v4${w1}`,p1=`matic-map-workflow-v4${w1}`,r1=`matic-map-shell-v4${w1}`,O2=`matic-map-panel-v0-4-0${w1}`;var m1=h`
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
`;var y5="M9.5,13.09L10.91,14.5L6.41,19H10V21H3V14H5V17.59L9.5,13.09M10.91,9.5L9.5,10.91L5,6.41V10H3V3H10V5H6.41L10.91,9.5M14.5,13.09L19,17.59V14H21V21H14V19H17.59L13.09,14.5L14.5,13.09M13.09,9.5L17.59,5H14V3H21V10H19V6.41L14.5,10.91L13.09,9.5Z";var b5="M20.71,4.63L19.37,3.29C19,2.9 18.35,2.9 17.96,3.29L9,12.25L11.75,15L20.71,6.04C21.1,5.65 21.1,5 20.71,4.63M7,14A3,3 0 0,0 4,17C4,18.31 2.84,19 2,19C2.92,20.22 4.5,21 6,21A4,4 0 0,0 10,17A3,3 0 0,0 7,14Z";var O5="M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z";var w5="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z";var k5="M7.41,15.41L12,10.83L16.59,15.41L18,14L12,8L6,14L7.41,15.41Z";var P5="M13,6V11H18V7.75L22.25,12L18,16.25V13H13V18H16.25L12,22.25L7.75,18H11V13H6V16.25L1.75,12L6,7.75V11H11V6H7.75L12,1.75L16.25,6H13Z";var B5="M16.24,3.56L21.19,8.5C21.97,9.29 21.97,10.55 21.19,11.34L12,20.53C10.44,22.09 7.91,22.09 6.34,20.53L2.81,17C2.03,16.21 2.03,14.95 2.81,14.16L13.41,3.56C14.2,2.78 15.46,2.78 16.24,3.56M4.22,15.58L7.76,19.11C8.54,19.9 9.8,19.9 10.59,19.11L14.12,15.58L9.17,10.63L4.22,15.58Z";var T5="M18.5,4L19.66,8.35L18.7,8.61C18.25,7.74 17.79,6.87 17.26,6.43C16.73,6 16.11,6 15.5,6H13V16.5C13,17 13,17.5 13.33,17.75C13.67,18 14.33,18 15,18V19H9V18C9.67,18 10.33,18 10.67,17.75C11,17.5 11,17 11,16.5V6H8.5C7.89,6 7.27,6 6.74,6.43C6.21,6.87 5.75,7.74 5.3,8.61L4.34,8.35L5.5,4H18.5Z";var R5="M5,5H10V7H7V10H5V5M14,5H19V10H17V7H14V5M17,14H19V19H14V17H17V14M10,17V19H5V14H7V17H10Z",_5="M14,14H19V16H16V19H14V14M5,14H10V19H8V16H5V14M8,5H10V10H5V8H8V5M19,8V10H14V5H16V8H19Z";var F5="M11,18H13V16H11V18M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M12,6A4,4 0 0,0 8,10H10A2,2 0 0,1 12,8A2,2 0 0,1 14,10C14,12 11,11.75 11,15H13C13,12.75 16,12.5 16,10A4,4 0 0,0 12,6Z";var E5="M18.4,10.6C16.55,9 14.15,8 11.5,8C6.85,8 2.92,11.03 1.54,15.22L3.9,16C4.95,12.81 7.95,10.5 11.5,10.5C13.45,10.5 15.23,11.22 16.62,12.38L13,16H22V7L18.4,10.6Z";var D5="M13,4.07V1L8.45,5.55L13,10V6.09C15.84,6.57 18,9.03 18,12C18,14.97 15.84,17.43 13,17.91V19.93C16.95,19.44 20,16.08 20,12C20,7.92 16.95,4.56 13,4.07M7.1,18.32C8.26,19.22 9.61,19.76 11,19.93V17.9C10.13,17.75 9.29,17.41 8.54,16.87L7.1,18.32M6.09,13H4.07C4.24,14.39 4.79,15.73 5.69,16.89L7.1,15.47C6.58,14.72 6.23,13.88 6.09,13M7.11,8.53L5.7,7.11C4.8,8.27 4.24,9.61 4.07,11H6.09C6.23,10.13 6.58,9.28 7.11,8.53Z";var $5="M16.89,15.5L18.31,16.89C19.21,15.73 19.76,14.39 19.93,13H17.91C17.77,13.87 17.43,14.72 16.89,15.5M13,17.9V19.92C14.39,19.75 15.74,19.21 16.9,18.31L15.46,16.87C14.71,17.41 13.87,17.76 13,17.9M19.93,11C19.76,9.61 19.21,8.27 18.31,7.11L16.89,8.53C17.43,9.28 17.77,10.13 17.91,11M15.55,5.55L11,1V4.07C7.06,4.56 4,7.92 4,12C4,16.08 7.05,19.44 11,19.93V17.91C8.16,17.43 6,14.97 6,12C6,9.03 8.16,6.57 11,6.09V10L15.55,5.55Z";var I5="M12.5,8C9.85,8 7.45,9 5.6,10.6L2,7V16H11L7.38,12.38C8.77,11.22 10.54,10.5 12.5,10.5C16.04,10.5 19.05,12.81 20.1,16L22.47,15.22C21.08,11.03 17.15,8 12.5,8Z";var W5=k5,N5=w5,z5=y5,U5=T5,G5=F5,Q5=R5,q5=_5,K5=D5,X5=$5,j5=I5,Y5=E5,J5=b5,C3=B5,H3=P5,V3=O5;var T=L=>y`<svg
  class="ms-icon"
  viewBox="0 0 24 24"
  fill="currentColor"
  aria-hidden="true"
  focusable="false"
><path d=${L}></path></svg>`;var L3=(L,C)=>Math.hypot(L.x-C.x,L.y-C.y),e3=(L,C)=>({x:(L.x+C.x)/2,y:(L.y+C.y)/2}),r3=(L,C)=>Math.atan2(C.y-L.y,C.x-L.x),d0=L=>{let C=L;for(;C>Math.PI;)C-=Math.PI*2;for(;C<-Math.PI;)C+=Math.PI*2;return C},M1=(L,C,H)=>Math.max(C,Math.min(H,L)),w2=L=>L.map(C=>({...C})),v1=L=>L instanceof Element&&!!L.closest("button, input, select, textarea, a, [role='button'], [role='menuitem']"),Q1=class{#C;#H;#r;#V=new Map;#e=!1;#L="idle";#o=[];#a=[];#A=null;#t=0;#s=null;#v=0;#u=null;#n=null;#Z=null;#p=0;#i=null;#x=!1;#f=null;#h=!1;constructor(C,H,V){this.#C=C,this.#H=H,this.#r=V,C.addEventListener("pointerdown",this.#M),C.addEventListener("pointermove",this.#d),C.addEventListener("pointerup",this.#m),C.addEventListener("pointercancel",this.#m),C.addEventListener("wheel",this.#w,{passive:!1}),C.addEventListener("gesturestart",this.#g,{passive:!1}),C.addEventListener("gesturechange",this.#y,{passive:!1}),C.addEventListener("gestureend",this.#b,{passive:!1}),C.addEventListener("dblclick",this.#B),C.addEventListener("contextmenu",this.#O),C.addEventListener("keydown",this.#S),C.addEventListener("keyup",this.#P),C.addEventListener("blur",this.#k)}#M=C=>{if(this.#h||!C.isPrimary&&C.pointerType==="mouse"||v1(C.target))return;this.#C.focus({preventScroll:!0}),this.#T();let H=performance.now(),V={id:C.pointerId,type:C.pointerType,startX:C.clientX,startY:C.clientY,x:C.clientX,y:C.clientY,lastX:C.clientX,lastY:C.clientY,lastTime:H,velocityX:0,velocityY:0};if(this.#V.set(C.pointerId,V),this.#C.setPointerCapture?.(C.pointerId),this.#V.size>=2){this.#_(),(this.#L==="paint"||this.#L==="erase")&&(this.#a=w2(this.#o),this.#r.onCircles(this.#a,!1)),this.#L="pinch",this.#C.classList.add("navigating"),this.#x=!0;let[t,i]=[...this.#V.values()];t&&i&&(this.#t=Math.max(1,L3(t,i)),this.#s=e3(t,i),this.#v=r3(t,i),this.#u=this.#H.camera),C.preventDefault();return}let e=this.#r.state(),r=e.workflow==="draw"&&e.map.available&&!e.floor.readOnly;this.#x||this.#e||C.button===1||C.button===2||e.draw.tool==="pan"?(this.#L="pan",this.#n=this.#H.camera):r&&(e.draw.tool==="paint"||e.draw.tool==="erase")?(this.#o=w2(e.draw.circles),this.#a=w2(e.draw.circles),C.pointerType==="touch"?(this.#L="idle",this.#f=window.setTimeout(()=>{if(this.#f=null,this.#V.size!==1||this.#x)return;this.#L=e.draw.tool;let t=this.#V.get(C.pointerId);t&&this.#l(t.x,t.y)},110)):(this.#L=e.draw.tool,this.#l(C.clientX,C.clientY))):(this.#L=e.view==="three"&&!C.shiftKey?"orbit":"pan",this.#n=this.#H.camera),(this.#L==="pan"||this.#L==="orbit")&&this.#C.classList.add("navigating"),C.preventDefault()};#d=C=>{let H=this.#V.get(C.pointerId);if(!H){let a=this.#H.screenToMap(C.clientX,C.clientY);this.#H.setCursor(a);return}let e=(C.getCoalescedEvents?.()||[]).at(-1)||C,r=performance.now(),M=Math.max(1,r-H.lastTime),t=(e.clientX-H.lastX)/M,i=(e.clientY-H.lastY)/M;if(H.velocityX=H.velocityX*.62+t*.38,H.velocityY=H.velocityY*.62+i*.38,H.lastX=e.clientX,H.lastY=e.clientY,H.lastTime=r,H.x=e.clientX,H.y=e.clientY,this.#L==="pinch"&&this.#V.size>=2){let[a,A]=[...this.#V.values()];if(!a||!A)return;let n=Math.max(1,L3(a,A)),d=e3(a,A),v=r3(a,A),u=this.#u;if(u&&this.#s){let x={...u,distance:u.distance*this.#t/n,yaw:u.yaw+d0(v-this.#v),pitch:u.orthographic?u.pitch:u.pitch-(d.y-this.#s.y)*.0035};this.#H.setCamera(this.#H.cameraAfterPan(x,d.x-this.#s.x,d.y-this.#s.y))}C.preventDefault();return}this.#L==="paint"||this.#L==="erase"?this.#l(C.clientX,C.clientY):this.#L==="pan"?this.#n&&this.#H.setCamera(this.#H.cameraAfterPan(this.#n,e.clientX-H.startX,e.clientY-H.startY)):this.#L==="orbit"&&this.#n&&this.#H.setCamera({...this.#n,yaw:this.#n.yaw+(e.clientX-H.startX)*.0045,pitch:this.#n.pitch-(e.clientY-H.startY)*.004});let o=this.#H.screenToMap(e.clientX,e.clientY);this.#H.setCursor(o),C.preventDefault()};#m=C=>{let H=this.#V.get(C.pointerId);if(!H)return;let V=this.#L;if(this.#V.delete(C.pointerId),this.#C.releasePointerCapture?.(C.pointerId),this.#_(),(this.#L==="paint"||this.#L==="erase")&&JSON.stringify(this.#a)!==JSON.stringify(this.#o))this.#r.onCircles(this.#a,!0,this.#o);else if(this.#L!=="pinch"&&!this.#x&&Math.hypot(H.x-H.startX,H.y-H.startY)<7&&this.#r.state().workflow==="rooms"){let e=this.#H.roomAt(H.x,H.y);e&&this.#r.onRoom(e)}if(this.#V.size===0)this.#L="idle",this.#C.classList.remove("navigating"),this.#x=!1,this.#s=null,this.#u=null,this.#n=null,this.#A=null,(V==="pan"||V==="orbit")&&H.type!=="mouse"&&this.#R(H.velocityX,H.velocityY,V);else if(this.#L==="pinch"){this.#L="pan",this.#x=!0;let e=this.#V.values().next().value;e&&(e.startX=e.x,e.startY=e.y,e.velocityX=0,e.velocityY=0),this.#n=this.#H.camera,this.#u=null}C.preventDefault()};#l(C,H){let V=this.#H.screenToMap(C,H);if(!V)return;let r=this.#r.state().draw.brushMeters/2;if(this.#L==="erase")this.#a=this.#a.filter(M=>Math.hypot(M.x-V.x,M.y-V.y)>M.radius+r);else{if(!this.#H.containsMapPoint(V))return;let M=Math.max(.04,r*.55),t=this.#A||V,i=Math.hypot(V.x-t.x,V.y-t.y),o=Math.max(1,Math.ceil(i/M));for(let a=0;a<=o&&this.#a.length<512;a+=1){let A=a/o,n={x:t.x+(V.x-t.x)*A,y:t.y+(V.y-t.y)*A};this.#a.some(d=>Math.hypot(d.x-n.x,d.y-n.y)<Math.max(.025,r*.28))||this.#a.push({x:Math.round(n.x*1e4)/1e4,y:Math.round(n.y*1e4)/1e4,radius:Math.round(r*100)/100})}}this.#A=V,this.#r.onCircles(this.#a,!1)}#w=C=>{if(v1(C.target))return;C.preventDefault(),this.#C.focus({preventScroll:!0}),this.#T();let H=C.deltaMode===WheelEvent.DOM_DELTA_LINE?16:C.deltaMode===WheelEvent.DOM_DELTA_PAGE?Math.max(1,this.#C.clientHeight):1,V=C.deltaX*H,e=C.deltaY*H;if(C.ctrlKey||C.metaKey){this.#H.zoomAt(Math.exp(M1(-e*.008,-.28,.28)),C.clientX,C.clientY);return}if(C.altKey&&this.#r.state().view==="three"){this.#H.orbitBy(0,M1(e,-80,80)*.75);return}if(C.deltaMode!==WheelEvent.DOM_DELTA_PIXEL||Math.abs(V)<.5&&Math.abs(e)>=50){this.#H.zoomAt(Math.exp(M1(-e*.0025,-.28,.28)),C.clientX,C.clientY);return}this.#H.panBy(-M1(V,-80,80),-M1(e,-80,80))};#g=C=>{this.#h||v1(C.target)||(this.#C.focus({preventScroll:!0}),this.#T(),this.#C.classList.add("navigating"),this.#Z=this.#H.camera,this.#p=Number.isFinite(C.rotation)?C.rotation:0,C.preventDefault())};#y=C=>{if(this.#h||v1(C.target))return;let H=this.#Z;if(!H||this.#V.size>=2)return;let V=Number.isFinite(C.scale)&&C.scale>0?Math.max(.1,C.scale):1,e=Number.isFinite(C.rotation)?C.rotation:0;this.#H.setCamera({...H,distance:H.distance/V,yaw:H.yaw+(e-this.#p)*Math.PI/180}),C.preventDefault()};#b=C=>{this.#Z=null,this.#p=0,this.#C.classList.remove("navigating"),C.preventDefault()};#S=C=>{if(C.defaultPrevented||C.ctrlKey||C.metaKey||C.altKey)return;if(C.code==="Space"){this.#e=!0,C.preventDefault();return}this.#T();let H=this.#r.state(),V=C.key.toLocaleLowerCase();if(C.key==="+"||C.key==="=")this.#H.zoomAt(1.25);else if(C.key==="-")this.#H.zoomAt(.8);else if(C.key==="0")this.#H.fit();else if(V==="3")this.#c({type:"set-view",view:"three"});else if(V==="t")this.#c({type:"set-view",view:"top"});else if(C.key==="[")this.#H.orbitBy(-40,0);else if(C.key==="]")this.#H.orbitBy(40,0);else if(C.key==="PageUp")this.#H.orbitBy(0,-30);else if(C.key==="PageDown")this.#H.orbitBy(0,30);else if(V==="d"&&H.workflow==="draw")this.#c({type:"set-draw-tool",tool:"paint"});else if(V==="e"&&H.workflow==="draw")this.#c({type:"set-draw-tool",tool:"erase"});else if(["arrowleft","arrowright","arrowup","arrowdown"].includes(V))if(H.view==="three"&&!C.shiftKey){let e=V==="arrowleft"?-24:V==="arrowright"?24:0,r=V==="arrowup"?-20:V==="arrowdown"?20:0;this.#H.orbitBy(e,r)}else{let e=V==="arrowleft"?30:V==="arrowright"?-30:0,r=V==="arrowup"?30:V==="arrowdown"?-30:0;this.#H.panBy(e,r)}else if(H.workflow!=="draw"&&["w","a","s","d"].includes(V))this.#H.panBy(V==="a"?34:V==="d"?-34:0,V==="w"?34:V==="s"?-34:0);else if(H.workflow!=="draw"&&(V==="q"||V==="e"))this.#H.orbitBy(V==="q"?-30:30,0);else return;C.preventDefault()};#P=C=>{C.code==="Space"&&(this.#e=!1)};#k=()=>{this.#e=!1,this.#_(),this.#H.setCursor(null),this.#C.classList.remove("navigating")};#B=C=>{v1(C.target)||(this.#T(),this.#H.zoomAt(C.shiftKey?1/1.6:1.6,C.clientX,C.clientY),C.preventDefault())};#O=C=>{v1(C.target)||C.preventDefault()};#c(C){this.#C.dispatchEvent(new CustomEvent("matic-workspace-intent",{detail:C,bubbles:!0,composed:!0}))}#R(C,H,V){if(window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;let e=M1(C,-.55,.55),r=M1(H,-.55,.55);if(Math.hypot(e,r)<.02)return;let M=performance.now(),t=i=>{let o=Math.min(32,i-M);M=i,V==="orbit"?this.#H.orbitBy(e*o,r*o):this.#H.panBy(e*o,r*o);let a=.9**(o/16);e*=a,r*=a,Math.hypot(e,r)>=.01?this.#i=window.requestAnimationFrame(t):this.#i=null};this.#i=window.requestAnimationFrame(t)}#T(){this.#i!==null&&window.cancelAnimationFrame(this.#i),this.#i=null}#_(){this.#f!==null&&window.clearTimeout(this.#f),this.#f=null}dispose(){this.#h||(this.#h=!0,this.#_(),this.#T(),this.#C.removeEventListener("pointerdown",this.#M),this.#C.removeEventListener("pointermove",this.#d),this.#C.removeEventListener("pointerup",this.#m),this.#C.removeEventListener("pointercancel",this.#m),this.#C.removeEventListener("wheel",this.#w),this.#C.removeEventListener("gesturestart",this.#g),this.#C.removeEventListener("gesturechange",this.#y),this.#C.removeEventListener("gestureend",this.#b),this.#C.removeEventListener("dblclick",this.#B),this.#C.removeEventListener("contextmenu",this.#O),this.#C.removeEventListener("keydown",this.#S),this.#C.removeEventListener("keyup",this.#P),this.#C.removeEventListener("blur",this.#k),this.#V.clear())}};var k=(L,C,H)=>Math.max(C,Math.min(H,L)),P1=L=>{let C=L;for(;C>Math.PI;)C-=Math.PI*2;for(;C<-Math.PI;)C+=Math.PI*2;return C},l0=L=>{switch(L){case"efficient":return .35;case"balanced":return .65;case"maximum":case"auto":return 1}},t3=Math.PI/3.15,s0=1.08,p0=(L,C)=>{let H=t3/2,V=Math.atan(Math.tan(H)*Math.max(.2,C));return L/Math.sin(Math.min(H,V))*s0},m0=(L,C)=>{let H=new Float32Array(16);for(let V=0;V<4;V+=1)for(let e=0;e<4;e+=1){let r=0;for(let M=0;M<4;M+=1)r+=(L[M*4+e]??0)*(C[V*4+M]??0);H[V*4+e]=r}return H},v0=(L,C,H,V)=>{let e=1/Math.tan(L/2),r=new Float32Array(16);return r[0]=e/C,r[5]=e,r[10]=(V+H)/(H-V),r[11]=-1,r[14]=2*V*H/(H-V),r},c0=(L,C,H,V,e,r)=>{let M=new Float32Array(16);return M[0]=2/(C-L),M[5]=2/(V-H),M[10]=-2/(r-e),M[12]=-(C+L)/(C-L),M[13]=-(V+H)/(V-H),M[14]=-(r+e)/(r-e),M[15]=1,M},x0=(L,C)=>{let H=Math.hypot((L[0]??0)-(C[0]??0),(L[1]??0)-(C[1]??0),(L[2]??0)-(C[2]??0))||1,V=[((L[0]??0)-(C[0]??0))/H,((L[1]??0)-(C[1]??0))/H,((L[2]??0)-(C[2]??0))/H],e=Math.hypot(V[2]??0,V[0]??0)||1,r=[(V[2]??0)/e,0,-(V[0]??0)/e],M=[(V[1]??0)*(r[2]??0),(V[2]??0)*(r[0]??0)-(V[0]??0)*(r[2]??0),-(V[1]??0)*(r[0]??0)];return new Float32Array([r[0]??0,M[0]??0,V[0]??0,0,r[1]??0,M[1]??0,V[1]??0,0,r[2]??0,M[2]??0,V[2]??0,0,-((r[0]??0)*(L[0]??0)+(r[1]??0)*(L[1]??0)+(r[2]??0)*(L[2]??0)),-((M[0]??0)*(L[0]??0)+(M[1]??0)*(L[1]??0)+(M[2]??0)*(L[2]??0)),-((V[0]??0)*(L[0]??0)+(V[1]??0)*(L[1]??0)+(V[2]??0)*(L[2]??0)),1])},M3=(L,C,H)=>{let V=!1,e=H.at(-1);if(!e)return!1;for(let r of H){let[M,t]=r,[i,o]=e;t>C!=o>C&&L<(i-M)*(C-t)/(o-t)+M&&(V=!V),e=r}return V},q1=class{#C;#H;#r;#V=null;#e=null;#L=null;#o=null;#a=null;#A=null;#t=null;#s=null;#v=null;#u=null;#n=null;#Z=null;#p=null;#i=null;#x=null;#f=null;#h;#M={yaw:-Math.PI/4,pitch:.82,distance:12,targetX:0,targetZ:0,orthographic:!1};#d=12;#m=8;#l=4;#w=new Float32Array(16);#g=null;#y="unavailable";#b=0;#S=0;#P=0;#k=0;#B=1;#O={width:1,height:1,left:0,top:0};#c=!0;#R=!1;constructor(C,H,V={}){this.#C=C,this.#H=H,this.#r=V,this.#e=H.getContext("2d",{alpha:!0}),this.#C.addEventListener("webglcontextlost",this.#K),this.#C.addEventListener("webglcontextrestored",this.#X),this.#N(),this.#h=new ResizeObserver(()=>{let e=this.#d,r=this.#m;this.#z(),this.#c&&(e!==this.#d||r!==this.#m)?this.fit(!1):this.requestRender()}),this.#h.observe(C)}get camera(){return{...this.#M}}#T(){return{minimum:Math.max(.2,this.#l*.04),maximum:this.#l*8}}#_(){let C=this.#i?.metadata.span,H=this.#i?.metadata.metersPerCell;return!C||H===void 0?{x:this.#l,z:this.#l}:{x:Math.max(.5,C[0]*H*.55),z:Math.max(.5,C[1]*H*.55)}}setCamera(C,H=!0){let V=this.#T(),e=this.#_();this.#M={yaw:P1(C.yaw),pitch:C.orthographic?Math.PI/2-.018:k(C.pitch,.18,1.38),distance:k(C.distance,V.minimum,V.maximum),targetX:k(C.targetX,-e.x,e.x),targetZ:k(C.targetZ,-e.z,e.z),orthographic:C.orthographic},this.#c=!1,this.requestRender(),H&&this.#D()}cameraAfterPan(C,H,V){let e=this.#F(),r=C.distance*1.75/Math.max(200,e.height),M=Math.cos(C.yaw),t=-Math.sin(C.yaw),i=-Math.sin(C.yaw),o=-Math.cos(C.yaw),a=this.#_();return{...C,targetX:k(C.targetX-H*r*M+V*r*i,-a.x,a.x),targetZ:k(C.targetZ-H*r*t+V*r*o,-a.z,a.z)}}setState(C){if(this.#R)return;let H=this.#p;this.#p=C;let V=C.resources.scene.value;V!==this.#i&&(this.#i=V,this.#J(V)),(!H||H.quality!==C.quality)&&(this.#B=l0(C.quality),this.#k=0);let e=H?.workflow!=="draw"&&C.workflow==="draw",r=H?.workflow==="draw"&&C.workflow!=="draw";if(!H||H.view!==C.view||e||r){let M=C.workflow==="draw"?"top":C.view;this.#M=this.#j(M,C),this.#c=this.#Y(M,C)}C.workflow==="draw"&&H?.draw.zoomPercent!==C.draw.zoomPercent&&(this.#M={...this.#M,orthographic:!0,pitch:Math.PI/2-.018,distance:this.#m*100/C.draw.zoomPercent},this.#c=C.draw.zoomPercent===100&&Math.abs(this.#M.targetX)<.001&&Math.abs(this.#M.targetZ)<.001&&Math.abs(P1(this.#M.yaw))<.001),this.requestRender()}#j(C,H){let V=C==="top",e=V?this.#m:this.#d,r=H.cameras[C];return r?{yaw:r.yaw,pitch:V?Math.PI/2-.018:r.pitch,distance:k(e/k(r.zoom,.01,100),Math.max(.2,this.#l*.04),this.#l*8),targetX:k(r.targetX,-this.#l,this.#l),targetZ:k(r.targetZ,-this.#l,this.#l),orthographic:V}:V?{yaw:0,pitch:Math.PI/2-.018,distance:e,targetX:0,targetZ:0,orthographic:!0}:{yaw:-Math.PI/4,pitch:.82,distance:e,targetX:0,targetZ:0,orthographic:!1}}#Y(C,H){let V=H.cameras[C];if(!V)return!0;let e=C==="top";return Math.abs(V.zoom-1)<.001&&Math.abs(V.targetX)<.001&&Math.abs(V.targetZ)<.001&&Math.abs(P1(V.yaw-(e?0:-Math.PI/4)))<.001&&(e||Math.abs(V.pitch-.82)<.001)}#W(C,H){let V=this.#V;if(!V)throw new Error("webgl-unavailable");let e=V.createShader(C);if(!e)throw new Error("shader-unavailable");if(V.shaderSource(e,H),V.compileShader(e),!V.getShaderParameter(e,V.COMPILE_STATUS))throw V.deleteShader(e),new Error("shader-failed");return e}#N(){try{this.#V=this.#C.getContext("webgl2",{alpha:!0,antialias:!0,depth:!0,powerPreference:"high-performance"});let C=this.#V;if(!C)throw new Error("webgl2-unavailable");let H=this.#W(C.VERTEX_SHADER,`#version 300 es
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
      `),V=this.#W(C.FRAGMENT_SHADER,`#version 300 es
        precision highp float;
        in vec3 vColor;
        out vec4 outColor;
        void main() {
          vec2 point = gl_PointCoord * 2.0 - 1.0;
          if (dot(point, point) > 1.0) discard;
          float edge = smoothstep(1.0, 0.72, dot(point, point));
          outColor = vec4(pow(vColor, vec3(0.94)), edge);
        }
      `),e=C.createProgram();if(!e)throw new Error("program-unavailable");if(C.attachShader(e,H),C.attachShader(e,V),C.linkProgram(e),C.deleteShader(H),C.deleteShader(V),!C.getProgramParameter(e,C.LINK_STATUS))throw new Error("program-failed");this.#a=e,this.#s=C.getUniformLocation(e,"uViewProjection"),this.#v=C.getUniformLocation(e,"uCenter"),this.#u=C.getUniformLocation(e,"uMetersPerCell"),this.#n=C.getUniformLocation(e,"uPointPixels"),this.#Z=C.getUniformLocation(e,"uMaxPointPixels"),this.#A=C.createBuffer(),this.#t=C.createVertexArray(),C.bindVertexArray(this.#t),C.bindBuffer(C.ARRAY_BUFFER,this.#A),C.enableVertexAttribArray(0),C.vertexAttribIPointer(0,2,C.UNSIGNED_SHORT,8,0),C.enableVertexAttribArray(1),C.vertexAttribIPointer(1,1,C.UNSIGNED_BYTE,8,4),C.enableVertexAttribArray(2),C.vertexAttribPointer(2,3,C.UNSIGNED_BYTE,!0,8,5),C.bindVertexArray(null),C.enable(C.DEPTH_TEST),C.depthFunc(C.LEQUAL),C.enable(C.BLEND),C.blendFunc(C.SRC_ALPHA,C.ONE_MINUS_SRC_ALPHA),this.#y="webgl2",this.#b+=1,this.#i&&this.#U(this.#i)}catch{this.#$(),this.#G()}}#J(C){if(this.#q(),!C){this.#S=0,this.requestRender();return}let[H,V]=C.metadata.span,e=C.metadata.metersPerCell,r=H*e,M=V*e;this.#l=Math.max(1,Math.hypot(r,M)/2),this.#z(),this.fit(!1),this.#y==="webgl2"?this.#U(C):this.#Q(C)}#z(){let C=this.#i;if(!C)return;let[H,V]=C.metadata.span,e=C.metadata.metersPerCell,r=H*e,M=V*e,t=this.#F(),i=Math.max(.2,t.width/Math.max(1,t.height));this.#d=p0(this.#l,i),this.#m=Math.max(M/2,r/(2*i))*1.12}#U(C){let H=this.#V;if(!H||!this.#A)return;let V=new Uint8Array(C.buffer,C.pointOffset,C.total*8);H.bindBuffer(H.ARRAY_BUFFER,this.#A),H.bufferData(H.ARRAY_BUFFER,V,H.STATIC_DRAW),this.#S=C.total}#G(){this.#y="canvas2d",this.#o=document.createElement("canvas"),this.#o.width=1024,this.#o.height=1024,this.#L=this.#o.getContext("2d",{alpha:!0}),this.#L?this.#i&&this.#Q(this.#i):(this.#y="unavailable",this.#r.onProblem?.("renderer-unavailable"))}#Q(C){let H=this.#L;if(!H||!this.#o)return;H.clearRect(0,0,this.#o.width,this.#o.height);let V=new DataView(C.buffer,C.pointOffset,C.total*8),e=Math.min(C.total,5e4),r=Math.max(1,Math.ceil(C.total/e)),M=0,t=0,i=()=>{if(this.#R||C!==this.#i||!this.#o)return;let o=Math.min(C.total,M+r*4e3);for(;M<o;M+=r){let a=M*8,A=V.getUint16(a,!0)/Math.max(1,C.metadata.span[0])*this.#o.width,n=V.getUint16(a+2,!0)/Math.max(1,C.metadata.span[1])*this.#o.height,d=V.getUint8(a+5),v=V.getUint8(a+6),u=V.getUint8(a+7);H.fillStyle=`rgb(${d} ${v} ${u})`,H.fillRect(A,n,1.5,1.5),t+=1}this.#S=t,this.requestRender(),M<C.total?this.#f=window.setTimeout(i,0):this.#f=null};i()}#q(){this.#f!==null&&window.clearTimeout(this.#f),this.#f=null}#F(){let C=this.#C.getBoundingClientRect();return this.#O={width:C.width,height:C.height,left:C.left,top:C.top},this.#O}#C1(){let C=this.#F(),H=Math.min(window.devicePixelRatio||1,3),V=Math.max(1,Math.round(C.width*H)),e=Math.max(1,Math.round(C.height*H));for(let r of[this.#C,this.#H])(r.width!==V||r.height!==e)&&(r.width=V,r.height=e)}#H1(){let C=this.#O,H=Math.max(.2,C.width/Math.max(1,C.height)),V=Math.cos(this.#M.pitch)*this.#M.distance,e=[this.#M.targetX+Math.sin(this.#M.yaw)*V,Math.sin(this.#M.pitch)*this.#M.distance,this.#M.targetZ+Math.cos(this.#M.yaw)*V],r=[this.#M.targetX,0,this.#M.targetZ],M=x0(e,r),t=this.#M.orthographic?c0(-this.#M.distance*H,this.#M.distance*H,-this.#M.distance,this.#M.distance,-this.#l*4,this.#l*4):v0(t3,H,.02,Math.max(60,this.#l*12));return m0(t,M)}requestRender(){this.#x!==null||this.#R||(this.#x=window.requestAnimationFrame(()=>{this.#x=null,this.#V1()}))}#V1(){let C=performance.now();this.#C1(),this.#w=this.#H1(),this.#y==="webgl2"?this.#L1():this.#e1(),this.#M1(),this.#P=performance.now()-C,this.#P>18?(this.#k+=1,this.#k>=3&&this.#p?.quality==="auto"&&(this.#B=Math.max(.25,this.#B*.75))):this.#k=Math.max(0,this.#k-1)}#L1(){let C=this.#V,H=this.#i;if(!C||(C.viewport(0,0,this.#C.width,this.#C.height),C.clearColor(0,0,0,0),C.clear(C.COLOR_BUFFER_BIT|C.DEPTH_BUFFER_BIT),!H||!this.#a||!this.#t))return;if(this.#p?.view==="top"&&this.#p.appearance==="rooms"){this.#S=0;return}C.useProgram(this.#a),C.bindVertexArray(this.#t),C.uniformMatrix4fv(this.#s,!1,this.#w),C.uniform2f(this.#v,(H.metadata.span[0]-1)/2,(H.metadata.span[1]-1)/2),C.uniform1f(this.#u,H.metadata.metersPerCell);let V=Math.min(window.devicePixelRatio||1,3),e=Math.max(1,Math.floor(H.total*this.#B)),r=Math.min(H.floorCount,e),M=Math.min(H.surfaceCount,Math.max(0,e-r));C.uniform1f(this.#n,this.#C.height*.038),C.uniform1f(this.#Z,4.5*V),C.drawArrays(C.POINTS,0,r),C.uniform1f(this.#n,this.#C.height*.05),C.uniform1f(this.#Z,7*V),C.drawArrays(C.POINTS,H.floorCount,M),C.bindVertexArray(null),this.#S=r+M}#e1(){}#r1(C,H,V=0){let e=this.#i;return e?[-(C-(e.metadata.span[0]-1)/2)*e.metadata.metersPerCell,V*e.metadata.metersPerCell,(H-(e.metadata.span[1]-1)/2)*e.metadata.metersPerCell]:null}#I(C,H,V=0,e=!0){let r=this.#r1(C,H,V);if(!r)return null;let[M,t,i]=r,o=this.#w,a=(o[0]??0)*M+(o[4]??0)*t+(o[8]??0)*i+(o[12]??0),A=(o[1]??0)*M+(o[5]??0)*t+(o[9]??0)*i+(o[13]??0),n=(o[3]??0)*M+(o[7]??0)*t+(o[11]??0)*i+(o[15]??0);if(n<=.001)return null;let d=a/n,v=A/n;if(!Number.isFinite(d)||!Number.isFinite(v)||e&&(Math.abs(d)>1.15||Math.abs(v)>1.15))return null;let u=this.#O;return{x:(d*.5+.5)*u.width,y:(-v*.5+.5)*u.height}}#E(C,H,V=0){let e=this.#i;if(!e)return null;let r=C/e.metadata.metersPerCell-e.metadata.origin[0],M=H/e.metadata.metersPerCell-e.metadata.origin[1];return this.#I(r,M,V)}#M1(){let C=this.#e,H=this.#i,V=this.#p;if(!C)return;let e=Math.min(window.devicePixelRatio||1,3),r=this.#O;if(C.setTransform(e,0,0,e,0,0),C.clearRect(0,0,r.width,r.height),!H||!V)return;if(this.#y==="canvas2d"&&this.#o&&!(V.view==="top"&&V.appearance==="rooms")){let o=this.#m/this.#M.distance,a=r.width*o,A=r.height*o,n=(r.width-a)/2-this.#M.targetX*32*o,d=(r.height-A)/2-this.#M.targetZ*32*o;C.drawImage(this.#o,n,d,a,A)}let M=this.#t1(V);if(V.labelsVisible||V.view==="top"&&V.appearance==="rooms"){C.lineWidth=1.5,C.font="600 12px system-ui, sans-serif",C.textAlign="center",C.textBaseline="middle";let o=[];for(let a of H.metadata.rooms){let A=M.has(a.name.toLocaleLowerCase());C.strokeStyle=A?"#0678ce":"rgba(75, 92, 105, .7)",C.fillStyle=A?"rgba(6, 120, 206, .26)":V.view==="top"&&V.appearance==="rooms"?"rgba(231, 238, 242, .94)":"rgba(255, 255, 255, .04)",C.beginPath();let n=Math.max(1,Math.ceil(a.boundary.length/512)),d=!1;for(let m=0;m<a.boundary.length;m+=n){let b=a.boundary[m];if(!b)continue;let Z=this.#I(b[0],b[1],.2,!1);Z&&(d?C.lineTo(Z.x,Z.y):C.moveTo(Z.x,Z.y),d=!0)}if(d&&(C.closePath(),C.fill(),C.stroke()),!V.labelsVisible)continue;let v=this.#I(a.center[0],a.center[1],1);if(!v)continue;let u=C.measureText(a.name).width,x=new DOMRect(v.x-u/2-6,v.y-10,u+12,20);o.some(m=>x.left<m.right+8&&x.right+8>m.left&&x.top<m.bottom+4&&x.bottom+4>m.top)||(o.push(x),C.fillStyle="rgba(250, 252, 253, .88)",C.fillRect(x.x,x.y,x.width,x.height),C.fillStyle="#263238",C.fillText(a.name,v.x,v.y))}}let t=V.draw.circles;if((V.workflow==="draw"||V.workflow==="areaReview")&&t.length){C.fillStyle="rgba(6, 120, 206, .22)",C.strokeStyle="rgba(6, 120, 206, .92)",C.lineWidth=1.5;for(let o of t)this.#i1(C,o)}if(this.#g&&V.workflow==="draw"&&V.draw.tool!=="pan"){let o=this.#E(this.#g.x,this.#g.y),a=this.#E(this.#g.x+V.draw.brushMeters/2,this.#g.y);o&&a&&(C.beginPath(),C.arc(o.x,o.y,Math.max(2,Math.hypot(a.x-o.x,a.y-o.y)),0,Math.PI*2),C.strokeStyle="#0678ce",C.lineWidth=2,C.stroke())}let i=V.resources.pose.value;if(V.map.exactPose&&i?.position&&V.dataMode==="live"){let o=this.#E(i.position[0],i.position[1],3);o&&(C.beginPath(),C.arc(o.x,o.y,7,0,Math.PI*2),C.fillStyle="#0678ce",C.fill(),C.strokeStyle="#fff",C.lineWidth=3,C.stroke())}}#t1(C){let H=C.resources.plans.value?.rooms||C.resources.areas.value?.rooms||[];return new Set(H.filter(V=>C.selection.roomIds.includes(V.roomId)).map(V=>V.name.toLocaleLowerCase()))}#i1(C,H){let V=this.#E(H.x,H.y),e=this.#E(H.x+H.radius,H.y);!V||!e||(C.beginPath(),C.arc(V.x,V.y,Math.max(1,Math.hypot(e.x-V.x,e.y-V.y)),0,Math.PI*2),C.fill(),C.stroke())}setCursor(C){this.#g=C,this.requestRender()}screenToMap(C,H){let V=this.#i;if(!V||!this.#M.orthographic)return null;let e=this.#F();if(!e.width||!e.height)return null;let r=this.#M.distance*2/e.height,M=this.#M.targetX+(C-e.left-e.width/2)*r,t=this.#M.targetZ+(H-e.top-e.height/2)*r,i=-M/V.metadata.metersPerCell+(V.metadata.span[0]-1)/2,o=t/V.metadata.metersPerCell+(V.metadata.span[1]-1)/2;return{x:(i+V.metadata.origin[0])*V.metadata.metersPerCell,y:(o+V.metadata.origin[1])*V.metadata.metersPerCell}}roomAt(C,H){let V=this.screenToMap(C,H),e=this.#i,r=this.#p;if(!V||!e||!r)return null;let M=V.x/e.metadata.metersPerCell-e.metadata.origin[0],t=V.y/e.metadata.metersPerCell-e.metadata.origin[1],i=e.metadata.rooms.find(o=>M3(M,t,o.boundary));return i?this.#o1(i,r):null}containsMapPoint(C){let H=this.#i;if(!H)return!1;let V=C.x/H.metadata.metersPerCell-H.metadata.origin[0],e=C.y/H.metadata.metersPerCell-H.metadata.origin[1];return H.metadata.rooms.some(r=>M3(V,e,r.boundary))}#o1(C,H){return(H.resources.plans.value?.rooms||H.resources.areas.value?.rooms||[]).find(e=>e.name.localeCompare(C.name,void 0,{sensitivity:"base"})===0)?.roomId||C.id}selectRoomAt(C,H){let V=this.roomAt(C,H);V&&this.#r.onRoom?.(V)}fit(C=!0){let H=this.#p?.view==="top"||this.#p?.workflow==="draw";this.#M=H?{yaw:0,pitch:Math.PI/2-.018,distance:this.#m,targetX:0,targetZ:0,orthographic:!0}:{yaw:-Math.PI/4,pitch:.82,distance:this.#d,targetX:0,targetZ:0,orthographic:!1},this.#c=!0,this.requestRender(),C&&this.#D()}zoomAt(C,H,V){let e=H===void 0||V===void 0?null:this.screenToMap(H,V),r=this.#T();if(this.#M={...this.#M,distance:k(this.#M.distance/C,r.minimum,r.maximum)},this.#c=!1,e&&H!==void 0&&V!==void 0){let M=this.screenToMap(H,V);M&&(this.#M={...this.#M,targetX:this.#M.targetX-(e.x-M.x),targetZ:this.#M.targetZ+(e.y-M.y)})}this.requestRender(),this.#D(H,V)}panBy(C,H){this.setCamera(this.cameraAfterPan(this.#M,C,H))}orbitBy(C,H){if(this.#M.orthographic){this.panBy(C,H);return}this.#M={...this.#M,yaw:P1(this.#M.yaw+C*.006),pitch:k(this.#M.pitch-H*.004,.18,1.38)},this.#c=!1,this.requestRender(),this.#D()}rotateBy(C){this.#M={...this.#M,yaw:P1(this.#M.yaw+C)},this.#c=!1,this.requestRender(),this.#D()}#D(C,H){let V=this.#M.orthographic?this.#m:this.#d,e=C===void 0||H===void 0?this.#O:this.#F(),r=C===void 0||H===void 0||!e.width||!e.height?void 0:{xPercent:k((C-e.left)/e.width*100,0,100),yPercent:k((H-e.top)/e.height*100,0,100)};this.#r.onCamera?.(this.camera,Math.round(V/this.#M.distance*100),r)}diagnostics(){return{mode:this.#y,contextGeneration:this.#b,sceneRevision:this.#i?.revision??null,sourcePoints:this.#i?.total??0,renderedPoints:this.#S,lastFrameMs:Math.round(this.#P*100)/100,slowFrames:this.#k,cameraDistance:this.#M.distance,fitDistance:this.#M.orthographic?this.#m:this.#d,fitActive:this.#c}}#K=C=>{C.preventDefault(),this.#$(),this.#G(),this.requestRender()};#X=()=>{this.#$(),this.#N(),this.requestRender()};#$(){let C=this.#V;C&&(this.#A&&C.deleteBuffer(this.#A),this.#t&&C.deleteVertexArray(this.#t),this.#a&&C.deleteProgram(this.#a)),this.#A=null,this.#t=null,this.#a=null,this.#V=null}dispose(){this.#R||(this.#R=!0,this.#h.disconnect(),this.#C.removeEventListener("webglcontextlost",this.#K),this.#C.removeEventListener("webglcontextrestored",this.#X),this.#x!==null&&window.cancelAnimationFrame(this.#x),this.#x=null,this.#q(),this.#$(),this.#o=null,this.#L=null,this.#e=null,this.#i=null,this.#p=null)}};var i3="component.matic_robot.common.",P=(L,C,H,V)=>{let e=V?{...V}:void 0,r=L?.(`${i3}${C}`,e);return r&&r!==`${i3}${C}`?r:V?Object.entries(V).reduce((M,[t,i])=>M.replaceAll(`{${t}}`,String(i)),H):H};var t1="matic-workspace-intent",K1="matic-workspace-action",o3=(L,C)=>{let H=(e,r,M)=>P(C,e,r,M);if(!n1(L))return H("v4_private_map_unavailable","The current private map is not available.");if(L.dataMode==="history")return H("v4_saved_map_description","Saved read-only map for {floor}. Live robot position is hidden.",{floor:L.floor.displayName});let V=K2(L)?H("v4_robot_position_verified","The robot position is verified."):H("v4_robot_position_hidden","The robot position is not shown.");return H("v4_live_map_description","Live map for {floor}. {pose}",{floor:L.floor.displayName,pose:V})},k2=class extends f{constructor(){super(...arguments);this.state=O();this.#C=null;this.#H=null;this.#r=null;this.#V=!1}static{this.properties={state:{attribute:!1},localize:{attribute:!1}}}static{this.styles=[F,E,m1,h`
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
  `]}#C;#H;#r;#V;#e(H,V,e){return P(this.localize,H,V,e)}firstUpdated(){let H=this.renderRoot.querySelector(".map-root"),V=this.renderRoot.querySelector(".scene-canvas"),e=this.renderRoot.querySelector(".overlay-canvas");!H||!V||!e||(this.#H=new q1(V,e,{onCamera:(r,M,t)=>{this.#L({type:"set-camera",view:this.state.workflow==="draw"?"top":this.state.view,camera:{yaw:r.yaw,pitch:r.pitch,zoom:M/100,targetX:r.targetX,targetZ:r.targetZ}}),this.state.workflow==="draw"&&M!==this.state.draw.zoomPercent&&this.#L({type:"set-zoom",value:M,...t?{originX:t.xPercent,originY:t.yPercent}:{}})},onRoom:r=>this.#L({type:"toggle-room",roomId:r}),onProblem:()=>this.#o("renderer-problem")}),this.#r=new Q1(H,this.#H,{state:()=>this.state,onCircles:(r,M,t)=>this.#L({type:"set-draft-circles",circles:r,record:M,...t?{previous:t}:{}}),onRoom:r=>this.#L({type:"toggle-room",roomId:r})}),this.#H.setState(this.state))}disconnectedCallback(){this.#r?.dispose(),this.#r=null,this.#H?.dispose(),this.#H=null,super.disconnectedCallback()}updated(H){if(!H.has("state"))return;H.get("state")?.fullMap&&!this.state.fullMap&&this.#C&&this.#C.focus(),this.#H?.setState(this.state)}#L(H){this.dispatchEvent(new CustomEvent(t1,{detail:H,bubbles:!0,composed:!0}))}#o(H){this.dispatchEvent(new CustomEvent(K1,{detail:{id:H},bubbles:!0,composed:!0}))}#a(H){this.#C=H.currentTarget,this.#L({type:this.state.fullMap?"exit-full-map":"enter-full-map"})}#A(H,V){this.#H?.orbitBy(H,V)}#t(H){if(!(H.ctrlKey||H.metaKey||H.altKey)&&H.key==="Escape"){if(H.preventDefault(),this.#V){this.#V=!1,this.requestUpdate();return}this.#L({type:"dismiss-top-layer"});return}}rendererDiagnostics(){return this.#H?.diagnostics()??null}canvasIdentity(){return{scene:this.renderRoot.querySelector(".scene-canvas"),overlay:this.renderRoot.querySelector(".overlay-canvas")}}#s(){return this.state.host.connected?this.state.host.administrator?this.state.host.robotCount===0?{title:this.#e("v4_no_robot","No Matic robot set up"),detail:this.#e("v4_no_robot_detail","Set up a robot before opening its map.")}:this.state.host.robotConnected?this.state.coherence==="verifying"||this.state.coherence==="booting"?{title:this.#e("v4_locating_map","Locating the current map"),detail:this.#e("v4_locating_map_detail","Map controls will return after the floor is verified.")}:!this.state.map.available&&this.state.resources.scene.status==="loading"?{title:this.#e("v4_loading_verified_map","Loading the verified map"),detail:this.#e("v4_loading_verified_map_detail","The current floor is verified. The private scene is still preparing.")}:this.state.map.available?this.state.activity==="problem"?{title:this.#e("v4_robot_attention","Robot needs attention"),detail:this.#e("v4_robot_attention_detail","Check the robot before starting another task.")}:null:{title:this.#e("v4_map_unavailable","Map unavailable"),detail:this.#e("v4_map_unavailable_detail","The private scene is not ready. No map data is shown until it is verified.")}:{title:this.#e("v4_robot_offline","Robot offline"),detail:this.#e("v4_robot_offline_detail","The last verified map stays read only and has no live position.")}:{title:this.#e("v4_admin_required","Administrator access required"),detail:this.#e("v4_private_map_hidden","Private map data is hidden.")}:{title:this.#e("v4_reconnecting","Reconnecting"),detail:this.#e("v4_reconnecting_detail","The verified map is read only until Home Assistant reconnects.")}}render(){let H=this.state,V=Y2(H),e=this.#s(),r=H.map.available&&(n1(H)||H.dataMode==="history"),M=H.workflow==="draw"&&r,t=H.coherence==="verifying"||H.coherence==="booting";return y`
      <section
        class="map-root"
        tabindex="0"
        role="application"
        aria-label=${o3(H,this.localize)}
        data-full-map=${String(H.fullMap)}
        data-workflow=${H.workflow}
        data-draw-tool=${H.draw.tool}
        @keydown=${this.#t}
      >
        ${!t||H.fullMap?y`<nav class="map-tools ms-surface ms-surface--floating ms-segment" aria-label="Map tools">
          ${t?l:y`
            <button class="ms-btn" type="button" @click=${()=>{this.#H?.fit(),this.#L({type:"fit-map"})}}>${T(z5)}<span class="ms-btn__label">${this.#e("map_home_view","Fit")}</span></button>
            <button
              class="labels ms-btn"
              type="button"
              aria-pressed=${String(H.labelsVisible)}
              @click=${()=>this.#L({type:"toggle-labels"})}
            >${T(U5)}<span class="ms-btn__label">${this.#e("map_labels","Labels")}</span></button>
            <button
              class="help ms-btn ms-btn--icon"
              type="button"
              aria-label=${this.#e("v4_navigation_help","Map navigation help")}
              aria-expanded=${String(this.#V)}
              @click=${()=>{this.#V=!this.#V,this.requestUpdate()}}
            >${T(G5)}</button>
          `}
          <button
            class="full-map ms-btn"
            type="button"
            aria-label=${this.#e("v4_full_map","Full map")}
            aria-pressed=${String(H.fullMap)}
            @click=${this.#a}
          >${T(H.fullMap?q5:Q5)}<span class="ms-btn__label">${H.fullMap?this.#e("v4_close","Close"):this.#e("v4_full_map","Full map")}</span></button>
        </nav>`:l}

        ${this.#V&&r?y`
          <aside class="navigation-help" aria-label=${this.#e("v4_navigation_help","Map navigation help")}>
            <dl>
              <dt>${this.#e("v4_trackpad","Trackpad")}</dt>
              <dd>${this.#e("v4_trackpad_help","Scroll to pan \xB7 pinch to zoom \xB7 twist to rotate")}</dd>
              <dt>${this.#e("v4_mouse","Mouse")}</dt>
              <dd>${this.#e("v4_mouse_help","Drag to orbit \xB7 Shift, middle, or right drag to pan \xB7 wheel to zoom")}</dd>
              <dt>${this.#e("v4_keyboard","Keyboard")}</dt>
              <dd>${this.#e("v4_keyboard_help","WASD to move \xB7 Q/E or arrows to orbit \xB7 +/\u2212 to zoom \xB7 0 to fit")}</dd>
            </dl>
          </aside>
        `:l}

        ${H.workflow!=="draw"&&r?y`
          <div class="view-switch ms-surface ms-surface--floating ms-segment" aria-label="Map view">
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(H.view==="three")}
              @click=${()=>this.#L({type:"set-view",view:"three"})}
            >${this.#e("map_view_3d","3D")}</button>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(H.view==="top")}
              @click=${()=>this.#L({type:"set-view",view:"top"})}
            >${this.#e("map_view_top","2D")}</button>
          </div>
        `:l}

        ${H.view==="top"&&r?y`
          <div class="appearance-switch ms-surface ms-surface--floating ms-segment" aria-label=${this.#e("map_style_label","2D map style")}>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(H.appearance==="photo")}
              @click=${()=>this.#L({type:"set-appearance",appearance:"photo"})}
            >${this.#e("map_style_photo","Photo")}</button>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(H.appearance==="rooms")}
              @click=${()=>this.#L({type:"set-appearance",appearance:"rooms"})}
            >${this.#e("map_view_rooms","Rooms")}</button>
          </div>
        `:l}

        ${H.view==="three"&&r?y`
          <div class="camera-steps ms-surface ms-surface--floating ms-segment" role="toolbar" aria-label=${this.#e("map_camera_controls","Map camera controls")}>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#e("map_rotate_left","Rotate left")} aria-keyshortcuts="[" @click=${()=>this.#A(-52,0)}>${T(K5)}</button>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#e("map_tilt_down","Lower viewing angle")} aria-keyshortcuts="PageDown" @click=${()=>this.#A(0,30)}>${T(N5)}</button>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#e("map_tilt_up","Raise viewing angle")} aria-keyshortcuts="PageUp" @click=${()=>this.#A(0,-30)}>${T(W5)}</button>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#e("map_rotate_right","Rotate right")} aria-keyshortcuts="]" @click=${()=>this.#A(52,0)}>${T(X5)}</button>
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

        ${M?y`
          <div class="map-scale" aria-label=${`Scale ${V.label}`}>
            <span class="scale-line" style=${`--scale-width:${V.pixels}px`}></span>
            <span>${V.label}</span>
          </div>
          <div class="draw-tools ms-surface ms-surface--floating ms-segment" role="toolbar" aria-label="Draw area tools">
            ${["paint","erase","pan"].map(i=>y`
              <button
                class="ms-btn"
                type="button"
                role="radio"
                aria-checked=${String(H.draw.tool===i)}
                data-tool=${i}
                @click=${()=>this.#L({type:"set-draw-tool",tool:i})}
              >${T(i==="paint"?J5:i==="erase"?C3:H3)}<span class="ms-btn__label">${i==="paint"?this.#e("area_paint","Paint"):i==="erase"?this.#e("area_erase","Erase"):this.#e("move_map","Move map")}</span></button>
            `)}
            <button
              class="ms-btn"
              type="button"
              ?disabled=${H.draw.strokeCount===0}
              @click=${()=>this.#L({type:"undo-draft"})}
            >${T(j5)}<span class="ms-btn__label">${this.#e("undo","Undo")}</span></button>
            <button
              class="ms-btn"
              type="button"
              ?disabled=${H.draw.redo.length===0}
              @click=${()=>this.#L({type:"redo-draft"})}
            >${T(Y5)}<span class="ms-btn__label">${this.#e("redo","Redo")}</span></button>
            <button class="ms-btn" type="button" @click=${()=>this.#o("review-area")}>${T(V3)}<span class="ms-btn__label">${this.#e("done_editing","Done editing")}</span></button>
          </div>
        `:l}

        ${e&&!(H.fullMap&&(t||!H.host.administrator))?y`
          <div class="map-message ms-surface ms-surface--floating" role="status">
            <strong>${e.title}</strong>
            <span>${e.detail}</span>
          </div>
        `:l}
        <div class="sr-only" aria-live="polite" aria-atomic="true">
          ${o3(H,this.localize)}
        </div>
      </section>
    `}};customElements.get(k1)||customElements.define(k1,k2);var P2=class extends f{constructor(){super(...arguments);this.state=O();this.compact=!1}static{this.properties={state:{attribute:!1},localize:{attribute:!1},compact:{type:Boolean,reflect:!0}}}static{this.styles=[F,E,m1,h`
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
`]}#C(H,V){return P(this.localize,H,V)}#H(H){this.dispatchEvent(new CustomEvent(t1,{detail:H,bubbles:!0,composed:!0}))}#r(H,V){let e=H.currentTarget.valueAsNumber;Number.isFinite(e)&&this.#H(V==="zoom"?{type:"set-zoom",value:e}:{type:"set-brush",value:e})}render(){let{draw:H}=this.state;return y`
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
                @change=${V=>this.#r(V,"zoom")}
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
                @change=${V=>this.#r(V,"brush")}
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
    `}};customElements.get(e1)||customElements.define(e1,P2);var B2=["vacuum","mop","vacuum_and_mop"],T2=["quick","standard","heavy_duty"],D=L=>L.currentTarget.value,R2=L=>L.currentTarget.checked,a3=N(e1),_2=class extends f{constructor(){super(...arguments);this.state=O()}static{this.properties={state:{attribute:!1},localize:{attribute:!1}}}static{this.styles=[F,E,m1,h`
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
`]}#C(H,V,e){return P(this.localize,H,V,e)}#H(H){return H==="vacuum"?this.#C("vacuum","Vacuum"):H==="mop"?this.#C("mop","Mop"):this.#C("vacuum_and_mop","Vacuum + mop")}#r(H){return H==="quick"?this.#C("quick","Quick"):H==="standard"?this.#C("standard","Optimal"):this.#C("heavy_duty","Heavy Duty")}#V(H){this.dispatchEvent(new CustomEvent(t1,{detail:H,bubbles:!0,composed:!0}))}#e(){return this.state.notice?s`
      <div class="notice" data-tone=${this.state.notice.tone} role=${this.state.notice.tone==="error"?"alert":"status"}>
        ${this.state.notice.text}
      </div>
    `:l}#L(H,V,e){return H==="loading"||H==="idle"?s`<div class="loading" role="status">${this.#C("map_loading","Loading\u2026")}</div>`:H==="error"?s`<div class="problem" role="alert">${this.#C("v4_workspace_unavailable","This workspace is unavailable right now.")} ${V==="request-failed"?this.#C("v4_try_again","Try again shortly."):this.#C("v4_return_live_retry","Return to the live map and retry.")}</div>`:H==="empty"?s`<div class="empty">${this.#C("v4_nothing_saved","Nothing saved yet.")}</div>`:e}#o(){let H=this.state.resources.plans;return this.#L(H.status,H.problem,s`
      <div class="stack">
        <div class="list" role="group" aria-label=${this.#C("v4_rooms_to_clean","Rooms to clean")}>
          ${(H.value?.rooms||[]).map(V=>{let e=this.state.selection.roomIds.includes(V.roomId);return s`
              <div class="room ms-row ms-row--stack" data-selected=${String(e)}>
                <label class="room-choice">
                  <input
                    type="checkbox"
                    .checked=${e}
                    @change=${()=>this.#V({type:"toggle-room",roomId:V.roomId})}
                  >
                  <strong>${V.name}</strong>
                  ${e?s`<small>${this.#C("v4_room_ready","Ready")}</small>`:l}
                </label>
                ${e?this.#a(V.roomId,this.state.selection.roomSettings.find(r=>r.roomId===V.roomId)||{roomId:V.roomId,cleaningMode:"vacuum",coverageSetting:"standard"}):l}
              </div>
            `})}
        </div>
        <p class="subtle">${this.#C("v4_room_selection_hint","Select rooms here or directly on the map. The map and list stay in sync.")}</p>
        ${this.#e()}
      </div>
    `)}#a(H,V){return s`
      <div class="split room-settings">
        <label class="field ms-field">${this.#C("v4_cleaning_system","Cleaning system")}
          <select
            aria-label=${this.#C("v4_room_cleaning_system","Cleaning system for room")}
            .value=${V.cleaningMode}
            @change=${e=>this.#V({type:"patch-room-settings",roomId:H,cleaningMode:D(e)})}
          >${B2.map(e=>s`<option value=${e} ?selected=${e===V.cleaningMode}>${this.#H(e)}</option>`)}</select>
        </label>
        <label class="field ms-field">${this.#C("cleaning_mode","Cleaning mode")}
          <select
            aria-label=${this.#C("v4_room_cleaning_mode","Cleaning mode for room")}
            .value=${V.coverageSetting}
            @change=${e=>this.#V({type:"patch-room-settings",roomId:H,coverageSetting:D(e)})}
          >${T2.map(e=>s`<option value=${e} ?selected=${e===V.coverageSetting}>${this.#r(e)}</option>`)}</select>
        </label>
      </div>
    `}#A(H){let V=this.state.planDraft.rooms,r=V.find(M=>M.roomId===H)?V.filter(M=>M.roomId!==H):[...V,{roomId:H,cleaningMode:"vacuum",coverageSetting:"standard"}];this.#V({type:"patch-plan-draft",patch:{rooms:r}})}#t(H,V){let e=this.state.planDraft.rooms.map((r,M)=>M===H?{...r,...V}:r);this.#V({type:"patch-plan-draft",patch:{rooms:e}})}#s(H,V){let e=H+V,r=[...this.state.planDraft.rooms];if(e<0||e>=r.length)return;let[M]=r.splice(H,1);M&&(r.splice(e,0,M),this.#V({type:"patch-plan-draft",patch:{rooms:r}}))}#v(){let H=this.state.resources.plans,V=H.value,e=this.state.planDraft,r=e.rooms.map(i=>({room:i,label:V?.rooms.find(o=>o.roomId===i.roomId)?.name||"Room",selected:!0})),M=(V?.rooms||[]).filter(i=>!e.rooms.some(o=>o.roomId===i.roomId)).map(i=>({room:{roomId:i.roomId,cleaningMode:"vacuum",coverageSetting:"standard"},label:i.name,selected:!1})),t=[...r,...M];return this.#L(H.status,H.problem,s`
      <div class="stack">
        <div class="split">
          <label class="field ms-field">${this.#C("v4_saved_plan","Saved plan")}
            <select
              .value=${this.state.selection.planId||""}
              @change=${i=>this.#V({type:"select-plan",planId:D(i)||null})}
            >
              <option value="">${this.#C("plan_new","New plan")}</option>
              ${(V?.plans||[]).map(i=>s`<option value=${i.id}>${i.name}</option>`)}
            </select>
          </label>
          <button class="list-button ms-row ms-row" type="button" @click=${()=>this.#V({type:"select-plan",planId:null})}>\uff0b ${this.#C("plan_new","New plan")}</button>
        </div>
        <label class="field ms-field">${this.#C("plan_name","Plan name")}
          <input
            maxlength="128"
            autocomplete="off"
            .value=${e.name}
            @input=${i=>this.#V({type:"patch-plan-draft",patch:{name:D(i)}})}
          >
        </label>
        <div class="split">
          <label class="field ms-field">${this.#C("plan_run_behavior","Run order")}
            <select
              .value=${e.runBehavior}
              @change=${i=>this.#V({type:"patch-plan-draft",patch:{runBehavior:D(i)==="ordered"?"ordered":"intelligent"}})}
            >
              <option value="intelligent">${this.#C("plan_intelligent","Smart rotation")}</option>
              <option value="ordered">${this.#C("plan_ordered","Listed order")}</option>
            </select>
          </label>
          <label class="checkbox"><input type="checkbox" .checked=${e.enabled} @change=${i=>this.#V({type:"patch-plan-draft",patch:{enabled:R2(i)}})}>${this.#C("plan_enabled","Enabled")}</label>
        </div>
        <div class="plan-options" aria-label=${this.#C("v4_completion_options","Completion options")}>
          <label class="checkbox"><input type="checkbox" .checked=${e.returnToBase} @change=${i=>this.#V({type:"patch-plan-draft",patch:{returnToBase:R2(i)}})}>${this.#C("plan_return_to_base","Return to the dock when finished")}</label>
          <label class="checkbox"><input type="checkbox" .checked=${e.finishCurrentRoom} @change=${i=>this.#V({type:"patch-plan-draft",patch:{finishCurrentRoom:R2(i)}})}>${this.#C("plan_finish_room","Finish the active room after Stop")}</label>
          ${e.finishCurrentRoom?s`<label class="field ms-field">${this.#C("plan_threshold","Finish threshold")} \u00b7 ${e.finishCurrentRoomThreshold}%<input type="range" min="0" max="100" step="5" .value=${String(e.finishCurrentRoomThreshold)} @input=${i=>this.#V({type:"patch-plan-draft",patch:{finishCurrentRoomThreshold:Number(D(i))}})}></label>`:l}
        </div>
        <div class="list" aria-label=${this.#C("plan_rooms","Plan rooms")}>
          ${t.map(({room:i,label:o,selected:a})=>{let A=a?e.rooms.findIndex(n=>n.roomId===i.roomId):-1;return s`
              <div class="room plan-room ms-row ms-row--stack" data-selected=${String(a)}>
                <label class="room-choice">
                  <input type="checkbox" .checked=${a} @change=${()=>this.#A(i.roomId)}>
                  <strong>${a?`${A+1}. `:""}${o}</strong>
                  ${a?s`
                    <span>
                      <button class="icon-button ms-btn ms-btn--icon ms-btn--sm" type="button" aria-label=${this.#C("move_room_up","Move {room} earlier",{room:o})} ?disabled=${A===0} @click=${n=>{n.preventDefault(),this.#s(A,-1)}}>\u2191</button>
                      <button class="icon-button ms-btn ms-btn--icon ms-btn--sm" type="button" aria-label=${this.#C("move_room_down","Move {room} later",{room:o})} ?disabled=${A===e.rooms.length-1} @click=${n=>{n.preventDefault(),this.#s(A,1)}}>\u2193</button>
                    </span>
                  `:l}
                </label>
                ${a?s`
                  <div class="split room-settings">
                    <label class="field ms-field">${this.#C("v4_cleaning_system","Cleaning system")}
                      <select .value=${i.cleaningMode} @change=${n=>this.#t(A,{cleaningMode:D(n)})}>${B2.map(n=>s`<option value=${n} ?selected=${n===i.cleaningMode}>${this.#H(n)}</option>`)}</select>
                    </label>
                    <label class="field ms-field">${this.#C("cleaning_mode","Cleaning mode")}
                      <select .value=${i.coverageSetting} @change=${n=>this.#t(A,{coverageSetting:D(n)})}>${T2.map(n=>s`<option value=${n} ?selected=${n===i.coverageSetting}>${this.#r(n)}</option>`)}</select>
                    </label>
                  </div>
                `:l}
              </div>
            `})}
        </div>
        <div class="toolbar">
          ${e.id?s`
            <button
              class="danger ms-btn ms-btn--secondary ms-btn--danger"
              type="button"
              aria-label=${this.#C("plan_delete","Delete plan")}
              data-dialog-launcher="confirmDeletePlan"
              @click=${()=>this.#V({type:"open-dialog",dialog:"confirmDeletePlan"})}
            >${this.#C("plan_delete","Delete")}</button>
          `:l}
        </div>
        ${this.#e()}
      </div>
    `)}#u(){let H=this.state.resources.areas;return s`
      <div class="stack">
        <${a3} .state=${this.state} .localize=${this.localize}></${a3}>
        <p class="subtle">${this.#C("v4_draw_floor_hint","Paint only on the mapped floor. Zoom and pan never change the saved outline.")}</p>
        <div class="toolbar">
          <button
            class="ms-btn ms-btn--secondary"
            type="button"
            ?disabled=${this.state.draw.circles.length===0}
            @click=${()=>this.#V({type:"clear-draft"})}
          >${this.#C("clear","Clear")}</button>
        </div>
        ${this.#L(H.status,H.problem,s`
          <div class="list" aria-label=${this.#C("area_workspace_title","Saved custom areas")}>
            <button class="list-button ms-row ms-row" type="button" @click=${()=>this.#V({type:"select-area",areaId:null})}>\uff0b ${this.#C("area_new","New outline")}</button>
            ${(H.value?.areas||[]).map(V=>s`
              <button class="list-button ms-row ms-row" type="button" @click=${()=>{this.#V({type:"select-area",areaId:V.id}),this.#V({type:"open-workflow",workflow:"areaReview"})}}>
                <span>${V.name}</span>
                <small>${V.status==="current"?this.#C("area_workspace_ready","Ready"):this.#C("v4_review","Review")}</small>
              </button>
            `)}
          </div>
        `)}
      </div>
    `}#n(){let H=this.state.areaDraft,V=H.canRebind||H.status==="review",e=H.status==="stale"||H.status==="unknown";return s`
      <div class="stack">
        ${V?s`<div class="notice" data-tone="warning" role="status">${this.#C("area_review_required","Review the saved outline on this current map, then confirm it.")}</div>`:l}
        ${e?s`<div class="problem" role="alert">${this.#C("area_redraw_required","This outline no longer matches the current room map. Redraw it before saving.")}</div>`:l}
        <label class="field ms-field">${this.#C("area_name","Area name")}
          <input maxlength="128" autocomplete="off" .value=${H.name} @input=${r=>this.#V({type:"patch-area-draft",patch:{name:D(r)}})}>
        </label>
        <div class="split">
          <label class="field ms-field">${this.#C("v4_cleaning_system","Cleaning system")}
            <select .value=${H.cleaningMode} @change=${r=>this.#V({type:"patch-area-draft",patch:{cleaningMode:D(r)}})}>${B2.map(r=>s`<option value=${r} ?selected=${r===H.cleaningMode}>${this.#H(r)}</option>`)}</select>
          </label>
          <label class="field ms-field">${this.#C("cleaning_mode","Cleaning mode")}
            <select .value=${H.coverageSetting} @change=${r=>this.#V({type:"patch-area-draft",patch:{coverageSetting:D(r)}})}>${T2.map(r=>s`<option value=${r} ?selected=${r===H.coverageSetting}>${this.#r(r)}</option>`)}</select>
          </label>
        </div>
        <p class="subtle">${this.#C("v4_private_marks","{count} map-space marks. The outline stays private and floor-bound.",{count:this.state.draw.circles.length})}</p>
        <div class="toolbar">
          <button class="ms-btn ms-btn--secondary" type="button" @click=${()=>this.#V({type:"open-workflow",workflow:"draw"})}>${this.#C("v4_edit_outline","Edit outline")}</button>
          ${H.id?s`
            <button
              class="danger ms-btn ms-btn--secondary ms-btn--danger"
              type="button"
              aria-label=${this.#C("area_delete","Delete area")}
              data-dialog-launcher="confirmDeleteArea"
              @click=${()=>this.#V({type:"open-dialog",dialog:"confirmDeleteArea"})}
            >${this.#C("area_delete","Delete")}</button>
          `:l}
        </div>
        ${this.#e()}
      </div>
    `}#Z(){let H=this.state.resources.history,V=H.value,e=V?.floors.find(t=>t.id===this.state.selection.floorId)||V?.floors.find(t=>t.active)||V?.floors[0],r=e?.snapshots||[],M=this.state.selection.historyId?Math.max(0,r.findIndex(t=>t.id===this.state.selection.historyId)):r.length;return this.#L(H.status,H.problem,s`
      <div class="stack">
        ${(V?.floors.length||0)>1?s`
          <div class="list" role="listbox" aria-label=${this.#C("v4_mapped_floors","Mapped floors")}>
            ${(V?.floors||[]).map((t,i)=>s`
              <button
                class="floor ms-row ms-row"
                type="button"
                role="option"
                aria-selected=${String(t.id===e?.id)}
                aria-pressed=${String(t.id===e?.id)}
                @click=${()=>this.#V({type:"set-floor",floorId:t.id})}
              >
                <span>${t.label||(t.active?this.#C("v4_current_floor","Current floor"):this.#C("v4_saved_floor","Saved floor {number}",{number:t.ordinal??i}))}</span>
                <small>${t.active?this.#C("map_timeline_live_action","Live"):this.#C("v4_read_only","Read only")}</small>
              </button>
            `)}
          </div>
        `:l}
        <div class="timeline">
          <label class="field ms-field">${this.#C("map_timeline_label","Map timeline")}
            <input
              type="range"
              min="0"
              max=${String(r.length)}
              step="1"
              .value=${String(M)}
              ?disabled=${!r.length}
              @input=${t=>{let i=Number(D(t));this.#V({type:"set-history",historyId:i===r.length?null:r[i]?.id||null})}}
            >
          </label>
          <div class="list">
            <button class="snapshot ms-row ms-row" type="button" aria-current=${String(!this.state.selection.historyId)} @click=${()=>this.#V({type:"set-history",historyId:null})}><span>${this.#C("map_timeline_live_action","Live")}</span><small>${this.#C("v4_current","Current")}</small></button>
            ${r.map((t,i)=>s`
              <button class="snapshot ms-row ms-row" type="button" aria-current=${String(t.id===this.state.selection.historyId)} @click=${()=>this.#V({type:"set-history",historyId:t.id})}>
                <span>${this.#p(t.createdAt)}</span><small>${i+1} of ${r.length}</small>
              </button>
            `)}
          </div>
        </div>
        <p class="subtle">${this.#C("v4_history_privacy","Saved maps are floor-scoped and never show a live robot position.")}</p>
      </div>
    `)}#p(H){try{return new Intl.DateTimeFormat(this.state.locale,{dateStyle:"medium",timeStyle:"short"}).format(new Date(H))}catch{return this.#C("v4_saved_map","Saved map")}}#i(){let H=this.state.resources.entry;return s`
      <div class="stack">
        <p class="subtle">${this.#C("v4_support_privacy","This summary contains no map, coordinates, room or floor names, device identifiers, addresses, or credentials.")}</p>
        <dl class="diagnostics">
          <dt>${this.#C("v4_connection","Connection")}</dt><dd>${this.state.host.connected?this.#C("v4_connected","Connected"):this.#C("v4_offline","Offline")}</dd>
          <dt>${this.#C("v4_map_state","Map state")}</dt><dd>${this.state.coherence}</dd>
          <dt>${this.#C("v4_floor_verified","Floor verified")}</dt><dd>${this.state.map.floorCoherent?this.#C("v4_yes","Yes"):this.#C("v4_no","No")}</dd>
          <dt>${this.#C("v4_session_verified","Session verified")}</dt><dd>${this.state.map.sessionVerified?this.#C("v4_yes","Yes"):this.#C("v4_no","No")}</dd>
          <dt>${this.#C("v4_map_complete","Map complete")}</dt><dd>${this.state.map.complete?this.#C("v4_yes","Yes"):this.#C("v4_no","No")}</dd>
          <dt>${this.#C("v4_map_health","Map health")}</dt><dd>${H?.health||this.#C("v4_unknown","Unknown")}</dd>
          <dt>${this.#C("v4_blocked_by","Blocked by")}</dt><dd>${H?.mapBlockReason?.replaceAll("_"," ")||this.#C("v4_nothing","Nothing")}</dd>
          <dt>${this.#C("v4_startup_map","Startup map check")}</dt><dd>${H?.bootstrapState?.replaceAll("_"," ")||this.#C("v4_unknown","Unknown")}</dd>
          <dt>${this.#C("v4_startup_photo","Startup photo layer")}</dt><dd>${H?.bootstrapPhotoSeen?this.#C("v4_seen","Seen"):this.#C("v4_not_seen","Not seen")}</dd>
          <dt>${this.#C("v4_startup_structure","Startup structure layer")}</dt><dd>${H?.bootstrapStructureSeen?this.#C("v4_seen","Seen"):this.#C("v4_not_seen","Not seen")}</dd>
          <dt>${this.#C("v4_startup_failures","Startup failures")}</dt><dd>${H?.bootstrapFailures||0}</dd>
          <dt>${this.#C("v4_stream_failures","Stream failures")}</dt><dd>${H?.streamFailures||0}</dd>
          <dt>${this.#C("v4_saved_floor_count","Saved floor count")}</dt><dd>${this.state.floor.classifiedCount}</dd>
        </dl>
      </div>
    `}render(){switch(this.state.workflow){case"rooms":return this.#o();case"plan":return this.#v();case"draw":return this.#u();case"areaReview":return this.#n();case"history":return this.#Z();case"support":return this.#i();case"none":return l}}};customElements.get(p1)||customElements.define(p1,_2);var A3=N(k1),n3=N(e1),d3=N(p1),u0=(L,C)=>{let H=(e,r,M)=>P(C,e,r,M);if(!L.host.connected)return{title:H("v4_reconnecting","Reconnecting"),detail:H("v4_ha_offline","Home Assistant is offline")};if(!L.host.administrator)return{title:H("v4_access_required","Access required"),detail:H("v4_admin_only","Administrator only")};if(L.host.robotCount===0)return{title:H("v4_no_robot_short","No robot"),detail:H("v4_set_up_robot","Set up a Matic robot")};if(!L.host.robotConnected)return{title:H("v4_robot_offline","Robot offline"),detail:H("v4_last_map_read_only","Last verified map \xB7 read only")};if(L.activity==="problem")return{title:H("v4_needs_attention","Needs attention"),detail:H("v4_check_robot","Check the robot")};if(L.dataMode==="history"){let e=L.resources.history.value?.floors.find(t=>t.id===L.selection.floorId),r=e?.snapshots.findIndex(t=>t.id===L.selection.historyId)??-1,M=e?.snapshots.length??0;return{title:H("v4_saved_map","Saved map"),detail:r>=0?H("v4_read_only_position","Read only \xB7 {position} of {count}",{position:r+1,count:M}):H("v4_read_only","Read only")}}if(L.coherence==="verifying"||L.coherence==="booting")return{title:H("v4_locating","Locating"),detail:H("v4_finding_map","Finding the current map")};if(L.activity==="cleaning")return{title:H("v4_cleaning","Cleaning"),detail:H("v4_cleaning_progress","Cleaning in progress")};if(L.activity==="recharging"){let e=L.batteryPercent===null?H("v4_recharging_detail","Will resume automatically when ready"):H("v4_recharging_battery","Charging to resume \xB7 {percent}% battery",{percent:L.batteryPercent});return{title:H("v4_recharging","Charging to resume"),detail:e}}if(L.activity==="paused")return{title:H("v4_paused","Paused"),detail:H("v4_can_resume","Cleaning can resume")};if(L.activity==="returning")return{title:H("v4_returning","Returning"),detail:H("v4_going_dock","Going to the dock")};if(L.activity==="stopping")return{title:H("v4_stopping","Stopping"),detail:H("v4_waiting_robot","Waiting for the robot")};let V=L.batteryPercent===null?H("v4_ready","Ready"):H("v4_battery","{percent}% battery",{percent:L.batteryPercent});return{title:L.activity==="docked"?H("v4_docked","Docked"):H("v4_ready","Ready"),detail:V}},Z0=(L,C)=>{let H=(V,e)=>P(C,V,e);switch(L.workflow){case"rooms":return{title:H("v4_choose_rooms","Choose rooms"),description:H("v4_choose_rooms_detail","Select on the map or from the list.")};case"draw":return{title:H("v4_draw_area","Draw an area"),description:H("v4_draw_area_detail","Paint on the verified map, then review the details.")};case"plan":return{title:H("v4_plan","Plan"),description:H("v4_plan_detail","Review rooms and cleaning settings.")};case"areaReview":return{title:H("area_details","Area details"),description:H("area_details_hint","Name the area and choose cleaning settings.")};case"history":return{title:H("v4_map_history","Map history"),description:H("v4_map_history_detail","Saved maps are floor-scoped and read only.")};case"support":return{title:H("v4_map_support","Map support"),description:H("v4_map_support_detail","Private geometry is never included.")};case"none":return{title:H("v4_clean","Start cleaning"),description:H("v4_clean_detail","Choose rooms, a saved plan, or a custom area.")}}},S0=(L,C)=>{let H=(V,e)=>P(C,V,e);switch(L){case"discardDraft":return{title:H("v4_discard_area","Discard this area?"),detail:H("v4_discard_area_detail","The outline has not been saved. You can keep drawing or discard it."),cancelLabel:H("v4_keep_drawing","Keep drawing"),confirmLabel:H("v4_discard","Discard"),action:"discard"};case"confirmDeletePlan":return{title:H("v4_delete_plan","Delete this plan?"),detail:H("v4_delete_plan_detail","This removes the saved plan from Home Assistant. The robot will not move."),cancelLabel:H("v4_cancel","Cancel"),confirmLabel:H("plan_delete","Delete plan"),action:"delete-plan"};case"confirmDeleteArea":return{title:H("v4_delete_area","Delete this area?"),detail:H("v4_delete_area_detail","This removes the saved outline from Home Assistant. The robot will not move."),cancelLabel:H("v4_cancel","Cancel"),confirmLabel:H("area_delete","Delete area"),action:"delete-area"};case"confirmStop":return{title:H("v4_stop_cleaning","Stop cleaning?"),detail:H("v4_stop_cleaning_detail","The robot may take a moment to settle before another action is available."),cancelLabel:H("v4_keep_cleaning","Keep cleaning"),confirmLabel:H("v4_stop","Stop"),action:"stop"};case"error":return{title:H("v4_error","Something went wrong"),detail:H("v4_error_detail","No action was started. Close this message and try again when the map is ready."),cancelLabel:H("v4_close","Close"),confirmLabel:H("v4_close","Close"),action:null};case null:return null}},h0=(L=document)=>{let C=L.activeElement;for(;C?.shadowRoot?.activeElement;)C=C.shadowRoot.activeElement;return C},F2=class extends f{constructor(){super(...arguments);this.state=O();this._measuredNarrow=!1;this._sheetOffset=0;this._overflowOpen=!1;this._browserFullscreen=!1;this._sheetDetent="half";this.#H=null;this.#r=null;this.#V=null;this.#e=null;this.#L=null;this.#o=null;this.#a=()=>{this._browserFullscreen=document.fullscreenElement===this.renderRoot.querySelector(".app")};this.#A=H=>{if(!this._overflowOpen)return;let V=this.renderRoot.querySelector(".overflow-wrap");(!V||!H.composedPath().includes(V))&&(this._overflowOpen=!1)}}static{this.properties={state:{attribute:!1},localize:{attribute:!1},_measuredNarrow:{state:!0},_sheetOffset:{state:!0},_overflowOpen:{state:!0},_browserFullscreen:{state:!0},_sheetDetent:{state:!0}}}static{this.styles=[F,E,h`
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
  `]}#C(H,V,e){return P(this.localize,H,V,e)}#H;#r;#V;#e;#L;#o;#a;#A;connectedCallback(){super.connectedCallback(),this.#H=new ResizeObserver(([H])=>{if(!H)return;let V=H.contentRect.width<768||H.contentRect.height<480;V!==this._measuredNarrow&&(this._measuredNarrow=V)}),this.#H.observe(this),window.addEventListener("pointerdown",this.#A,!0),document.addEventListener("fullscreenchange",this.#a),this.#r=new ResizeObserver(([H])=>{if(!H)return;let V=Math.ceil(H.target.getBoundingClientRect().height);V!==this._sheetOffset&&(this._sheetOffset=V)})}disconnectedCallback(){this.#H?.disconnect(),this.#H=null,this.#r?.disconnect(),this.#r=null,this.#V=null,window.removeEventListener("pointerdown",this.#A,!0),document.removeEventListener("fullscreenchange",this.#a),super.disconnectedCallback()}updated(H){let V=this.renderRoot.querySelector(".mobile-sheet");if(V!==this.#V&&(this.#r?.disconnect(),this.#V=V,V&&this.#r?.observe(V)),H.has("state")){let e=H.get("state");if(e?.precisionOpen&&!this.state.precisionOpen&&this.#e?.focus(),!e?.dialog&&this.state.dialog){let r=h0(this.shadowRoot||document);r?.hasAttribute("data-dialog-launcher")&&(this.#L=r),this.updateComplete.then(()=>{this.renderRoot.querySelector(".dialog button")?.focus()})}else if(e?.dialog&&!this.state.dialog){let r=this.#L?.isConnected&&this.#L.hasAttribute("data-dialog-launcher")?this.#L:this.#w(e.dialog);this.#L=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>r?.focus({preventScroll:!0}))})}(!e||e.workflow!==this.state.workflow)&&(this._sheetDetent="half")}}#t(H){this.dispatchEvent(new CustomEvent(t1,{detail:H,bubbles:!0,composed:!0}))}#s(H){if(H.enabled){if(H.id==="return-live"){this.#t({type:"set-history",historyId:null});return}this.#p(H.id)}}#v(H){if(this.state.workflow==="draw"&&this.state.draw.dirty&&H!=="draw"&&H!=="areaReview"){this.#o=H,this.#t({type:"open-dialog",dialog:"discardDraft"});return}this.#t({type:"open-workflow",workflow:H})}#u(){let H=this.#o;this.#o=null,this.#t({type:"discard-draft"}),H&&queueMicrotask(()=>this.#t({type:"open-workflow",workflow:H}))}#n(){this.#o=null,this.#Z()}#Z(){let H=this.state.dialog,V=H&&this.#L?.isConnected&&this.#L.hasAttribute("data-dialog-launcher")?this.#L:H?this.#w(H):null;this.#t({type:"dismiss-top-layer"}),V&&requestAnimationFrame(()=>V.focus({preventScroll:!0}))}#p(H){this.dispatchEvent(new CustomEvent(K1,{detail:{id:H},bubbles:!0,composed:!0}))}#i(H){this.#t({type:"dismiss-top-layer"}),this.#p(H)}#x(H){if(H.action==="discard"){this.#u();return}if(H.action==="delete-plan"||H.action==="delete-area"){this.#i(H.action);return}this.#t({type:"dismiss-top-layer"}),H.action==="stop"&&this.#p("stop")}#f(){this._sheetDetent=this._sheetDetent==="peek"?"half":this._sheetDetent==="half"?"full":"peek"}#h(){if(this.state.precisionOpen||this.state.fullMap){this.#t({type:"dismiss-top-layer"});return}if(this.state.workflow!=="none"){this.#v("none");return}this.#M()}#M(){this.dispatchEvent(new CustomEvent("hass-toggle-menu",{bubbles:!0,composed:!0}))}#d(H){if(this._overflowOpen=!1,H==="support"){this.#v("support");return}if(H==="fullscreen"){let V=this.renderRoot.querySelector(".app");document.fullscreenElement?document.exitFullscreen():V?.requestFullscreen();return}this.dispatchEvent(new CustomEvent(K1,{detail:{id:"use-classic"},bubbles:!0,composed:!0}))}#m(H){this.#e=H.currentTarget,this.#t({type:"set-precision-open",value:!this.state.precisionOpen})}#l(H){let V=H;if(V.detail?.type!=="open-dialog")return;let e=V.composedPath().find(r=>r instanceof HTMLElement&&r.hasAttribute("data-dialog-launcher"));e instanceof HTMLElement&&(this.#L=e)}#w(H){return this.renderRoot.querySelector(p1)?.shadowRoot?.querySelector(`[data-dialog-launcher="${H}"]`)??null}#g(H){if(!(H.defaultPrevented||H.ctrlKey||H.metaKey||H.altKey)&&H.key==="Escape"){if(H.preventDefault(),this._overflowOpen){this._overflowOpen=!1;return}this.#t({type:"dismiss-top-layer"})}}#y(H){if(H.key!=="Tab")return;let V=[...this.renderRoot.querySelectorAll(".dialog button:not(:disabled)")],e=V[0],r=V.at(-1);!e||!r||(H.shiftKey&&this.shadowRoot?.activeElement===e?(H.preventDefault(),r.focus()):!H.shiftKey&&this.shadowRoot?.activeElement===r&&(H.preventDefault(),e.focus()))}#b(H,V="primary-action"){if(H.id==="choose-cleaning")return l;let r={stop:["v4_stop","Stop"],resume:["v4_resume","Resume"],"review-area":["v4_review_details","Review details"],"save-area":["area_save","Save area"],"run-area":["area_run","Clean area"],"save-plan":["plan_save","Save plan"],"run-plan":["plan_run","Run plan"]}[H.id],M=H.id==="clean-rooms"?H.label:r?this.#C(r[0],r[1]):H.label;return s`
      <button
        class=${`${V} ${H.kind==="danger"?"danger":""}`}
        type="button"
        ?disabled=${!H.enabled}
        title=${H.reason??""}
        @click=${()=>this.#s(H)}
      >${M}</button>
    `}#S(H){return H.workflow==="none"?s`
      <div class="quick-actions" aria-label=${this.#C("v4_cleaning_choices","Cleaning choices")}>
        <button class="featured" type="button" @click=${()=>this.#v("rooms")}>
          <span class="quick-copy"><strong>${this.#C("map_rooms","Rooms")}</strong><small>${this.#C("v4_rooms_quick_detail","Pick rooms and clean them now.")}</small></span><span class="quick-arrow" aria-hidden="true">\u203a</span>
        </button>
        <button type="button" @click=${()=>this.#v("plan")}>
          <span class="quick-copy"><strong>${this.#C("cleaning_workspace_plans","Plans")}</strong><small>${this.#C("v4_plans_quick_detail","Run or edit a saved routine.")}</small></span><span class="quick-arrow" aria-hidden="true">\u203a</span>
        </button>
        <button type="button" @click=${()=>this.#v("draw")}>
          <span class="quick-copy"><strong>${this.#C("area_workspace_title","Custom areas")}</strong><small>${this.#C("v4_areas_quick_detail","Use or draw a precise outline.")}</small></span><span class="quick-arrow" aria-hidden="true">\u203a</span>
        </button>
        <button type="button" @click=${()=>this.#v("history")}>
          <span class="quick-copy"><strong>${this.#C("map_timeline_history","History")}</strong><small>${this.#C("v4_history_quick_detail","Browse earlier floor maps.")}</small></span><span class="quick-arrow" aria-hidden="true">\u203a</span>
        </button>
      </div>
    `:s`<${d3}
      .state=${H}
      .localize=${this.localize}
      @matic-workspace-intent=${this.#l}
    ></${d3}>`}render(){let H=this.state,V=H.narrowHint||this._measuredNarrow,e=u0(H,this.localize),r=Z0(H,this.localize),M=X2({...H,narrowHint:V}),t=j2(H),i=!V&&M.id==="stop"?M:!V&&t?.id==="stop"?t:null,o=i===M?null:M,a=i===t?null:t,A=H.workflow==="draw"&&(V||H.fullMap),n=H.fullMap&&(H.coherence==="verifying"||H.coherence==="booting"),d=H.fullMap||H.precisionOpen,v=S0(H.dialog,this.localize),u=H.resources.history.value?.floors||[],x=u.length?u.map((m,b)=>({id:m.active?"current":m.id,label:`${m.label||(m.active?this.#C("v4_current_floor","Current floor"):this.#C("v4_saved_floor","Saved floor {number}",{number:m.ordinal??b+1}))}${!m.active&&m.snapshots.length===0?` \xB7 ${this.#C("v4_floor_not_captured","Visit floor to capture")}`:""}`,disabled:!m.active&&m.snapshots.length===0})):[{id:H.selection.floorId,label:H.floor.displayName,disabled:!1}];return s`
      <div class=${`root ${V?"narrow":"wide"}`} @keydown=${this.#g}>
        <div class="app">
          <header class="app-bar">
            <button
              class="nav"
              type="button"
              aria-label=${d?this.#C("v4_back","Back"):this.#C("v4_open_navigation","Open navigation")}
              @click=${this.#h}
            >${d?"\u2190":"\u2630"}</button>
            <h1 class="title">${this.#C("map_studio_title","Matic Map")}</h1>
            ${H.robots.length>1?s`
              <select
                class="context-switcher robot-switcher"
                aria-label=${this.#C("v4_choose_robot","Choose robot")}
                .value=${H.selection.entryId||""}
                @change=${m=>this.#t({type:"select-entry",entryId:m.currentTarget.value})}
              >${H.robots.map(m=>s`
                <option value=${m.entryId}>${m.label}</option>
              `)}</select>
            `:l}
            <select
              class="context-switcher floor-switcher"
              aria-label=${this.#C("v4_choose_floor","Choose floor")}
              ?disabled=${x.length<=1}
              .value=${H.selection.floorId}
              @change=${m=>this.#t({type:"set-floor",floorId:m.currentTarget.value})}
            >${x.map(m=>s`
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
              ${this._overflowOpen?s`
                <div class="overflow-menu" role="menu">
                  <label class="overflow-field">${this.#C("map_quality_label","Scene detail")}
                    <select
                      .value=${H.quality}
                      @change=${m=>this.#t({type:"set-quality",quality:m.currentTarget.value})}
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
              <${A3}
                class="map-canvas"
                style=${V&&!H.fullMap?`--map-sheet-offset:${this._sheetOffset}px`:"--map-sheet-offset:0px"}
                .state=${H}
                .localize=${this.localize}
              ></${A3}>
            </div>

            ${A?s`
              <div class="precision-popover">
                <button
                  class="precision-chip"
                  type="button"
                  aria-expanded=${String(H.precisionOpen)}
                  @click=${this.#m}
                >${H.draw.zoomPercent}% \u00b7 ${H.draw.brushMeters.toFixed(2)} m</button>
                <button
                  class="precision-chip"
                  type="button"
                  ?disabled=${H.draw.circles.length===0}
                  @click=${()=>this.#t({type:"clear-draft"})}
                >${this.#C("clear","Clear")}</button>
                ${H.precisionOpen?s`
                  <${n3} compact .state=${H} .localize=${this.localize}></${n3}>
                `:l}
              </div>
            `:l}

            <aside class="inspector" aria-label="Map workspace">
              <div class="status-strip">
                <span class="status-icon" aria-hidden="true">\u25c6</span>
                <span><strong>${e.title}</strong><small>${e.detail}</small></span>
                ${i?s`
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
                  ${H.workflow!=="none"?s`
                    <button
                      class="workflow-back"
                      type="button"
                      aria-label=${this.#C("v4_back","Back")}
                      @click=${()=>this.#v("none")}
                    >\u2190</button>
                  `:l}
                  <h2 tabindex="-1">${r.title}</h2>
                </div>
                <p>${r.description}</p>
                ${this.#S(H)}
                <div class="primary-stack">
                  ${o?this.#b(o):l}
                  ${a?this.#b(a,"secondary-action"):l}
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
                aria-label=${this.#C("v4_workspace_height","Map workspace, {height} height",{height:this._sheetDetent})}
                aria-expanded=${String(this._sheetDetent!=="peek")}
                @click=${this.#f}
              >
                <span class="sheet-handle" aria-hidden="true"></span>
                <span class="sheet-title">${r.title}</span>
                <span class="sheet-description">${r.description}</span>
              </button>
              <div class="sheet-body">
                ${H.workflow==="draw"?l:this.#S(H)}
              </div>
              <div class="primary-stack">
                ${o?this.#b(o):l}
                ${a?this.#b(a,"secondary-action"):l}
              </div>
            </section>

            ${H.fullMap?s`
              <section
                class=${`full-map-hud ${t?"has-secondary":""}`}
                aria-label="Robot status and action"
              >
                <span class="hud-copy"><strong>${e.title}</strong><small>${e.detail}</small></span>
                ${n?l:this.#b(M)}
                ${!n&&t?this.#b(t,"secondary-action"):l}
              </section>
            `:l}
          </main>
        </div>

        ${v?s`
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
                  @click=${H.dialog==="discardDraft"?this.#n:this.#Z}
                >${v.cancelLabel}</button>
                ${v.action===null?l:s`
                  <button
                    class="discard"
                    type="button"
                    @click=${()=>this.#x(v)}
                  >${v.confirmLabel}</button>
                `}
              </div>
            </section>
          </div>
        `:l}
      </div>
    `}};customElements.get(r1)||customElements.define(r1,F2);var l3=N(r1),E2=class extends f{constructor(){super(...arguments);this.scenario="ready";this.narrow=!1;this.controls=!0;this._workspace=d2("ready");this.#C=new A1(this._workspace);this.#H=null}static{this.properties={scenario:{type:String,reflect:!0},narrow:{type:Boolean,reflect:!0},controls:{type:Boolean,reflect:!0},_workspace:{state:!0}}}static{this.styles=[F,E,h`
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
  `]}#C;#H;connectedCallback(){super.connectedCallback(),this.#H=this.#C.subscribe(H=>{this._workspace=H})}disconnectedCallback(){this.#H?.(),this.#H=null,super.disconnectedCallback()}willUpdate(H){H.has("scenario")?this.#C.replace({...d2(this.scenario),narrowHint:this.narrow}):H.has("narrow")&&this.#C.dispatch({type:"set-narrow-hint",value:this.narrow})}setScenario(H){l2.includes(H)&&(this.scenario=H)}getWorkspaceSnapshot(){return structuredClone(this.#C.value)}replaceWorkspaceState(H){this.#C.replace(structuredClone(H))}#r(H){D1(H.detail)&&(H.stopPropagation(),this.#C.dispatch(H.detail))}render(){return s`
      ${this.controls?s`
        <nav class="gallery-controls" aria-label="Map Studio states">
          ${l2.map(H=>s`
            <button
              type="button"
              aria-pressed=${String(this.scenario===H)}
              @click=${()=>{this.scenario=H}}
            >${H}</button>
          `)}
        </nav>
      `:null}
      <div class="stage">
        <${l3}
          class="shell"
          .state=${this._workspace}
          @matic-workspace-intent=${this.#r}
        ></${l3}>
      </div>
    `}};customElements.get("matic-map-studio-gallery-v0-4-0")||customElements.define("matic-map-studio-gallery-v0-4-0",E2);var s3="/api/matic_robot/slam_entries";var p=class extends Error{constructor(C){super(C),this.name="ContractError",this.code=C}},R=(L,C)=>{if(!L||typeof L!="object"||Array.isArray(L))throw new p(C);return L},g=(L,C,H)=>{if(typeof L!="string")throw new p(H);let V=L.trim();if(!V||Array.from(V).length>C||/[\u0000-\u001f\u007f]/u.test(V))throw new p(H);return V},f0=L=>{if(L==null||L==="")return null;try{return g(L,128,"invalid-floor-label")}catch{return null}},c1=(L,C,H,V)=>{if(typeof L!="number"||!Number.isFinite(L)||L<C||L>H)throw new p(V);return L},W=(L,C,H,V)=>{let e=c1(L,C,H,V);if(!Number.isInteger(e))throw new p(V);return e},D2=(L,C)=>L==null?null:W(L,1,C,"invalid-floor-ordinal"),S=(L,C)=>{if(typeof L!="boolean")throw new p(C);return L},g0=(L,C)=>L===null?null:S(L,C),p3=L=>{if(L==null)return null;let C=g(L,64,"invalid-map-session-key");if(!/^[0-9a-f]{64}$/u.test(C))throw new p("invalid-map-session-key");return C},y0=L=>{if(L==null)return null;if(L==="bootstrap_empty"||L==="map_session_unverified"||L==="floor_plan_unavailable"||L==="floor_plan_mismatch")return L;throw new p("invalid-map-block-reason")},b0=L=>{if(L===void 0)return"not_started";if(L==="not_started"||L==="running"||L==="complete"||L==="partial"||L==="failed")return L;throw new p("invalid-bootstrap-state")},K=(L,C)=>{let H=g(L,512,C);if(!H.startsWith("/")||H.startsWith("//")||H.includes("\\"))throw new p(C);return H},O0=L=>{let C=typeof L.map_health=="string"?L.map_health.toLowerCase():"",H=typeof L.stream_state=="string"?L.stream_state.toLowerCase():"",V=typeof L.invalid_tiles=="number"?L.invalid_tiles:0;return C.includes("error")||C.includes("fail")||C.includes("degrad")||V>0?"problem":L.map_truncated===!0||C.includes("truncat")||C.includes("limit")?"limited":L.map_complete===!0?"ready":H.includes("connect")||H.includes("collect")||H.includes("run")?"building":"unknown"},m3=L=>{let C=R(L,"invalid-catalog");if(!Array.isArray(C.entries)||C.entries.length>64)throw new p("invalid-catalog-entries");return C.entries.map(H=>{let V=R(H,"invalid-catalog-entry"),e=W(V.map_revision,0,Number.MAX_SAFE_INTEGER,"invalid-map-revision");return{entryId:g(V.entry_id,128,"invalid-entry-id"),sceneUrl:K(V.scene_url,"invalid-scene-url"),deltaUrl:V.delta_url===void 0||V.delta_url===null?null:K(V.delta_url,"invalid-delta-url"),poseUrl:K(V.pose_url,"invalid-pose-url"),historyUrl:K(V.history_url,"invalid-history-url"),areasUrl:K(V.areas_url,"invalid-areas-url"),plansUrl:K(V.plans_url,"invalid-plans-url"),mapRevision:e,mapFloorCoherent:S(V.map_floor_coherent,"invalid-floor-coherence"),mapSessionVerified:S(V.map_session_verified,"invalid-session-state"),mapSessionKey:p3(V.map_session_key),mapBlockReason:y0(V.map_block_reason),runnerLocked:S(V.runner_locked,"invalid-runner-lock"),stopSettlePending:S(V.stop_settle_pending,"invalid-stop-settle"),activePlan:S(V.active_plan,"invalid-active-plan"),nativeReconciliationPending:S(V.native_reconciliation_pending,"invalid-native-reconciliation"),nativeSessionActive:g0(V.native_session_active,"invalid-native-session"),mapComplete:S(V.map_complete,"invalid-map-complete"),mapTruncated:S(V.map_truncated,"invalid-map-truncated"),selectedFloorOrdinal:D2(V.selected_floor_ordinal,128),mapFloorOrdinal:D2(V.map_floor_ordinal,128),historyCount:W(V.history_count,0,12,"invalid-history-count"),historyFloorCount:W(V.history_floor_count,0,128,"invalid-floor-count"),health:O0(V),streamFailures:W(V.stream_failures,0,Number.MAX_SAFE_INTEGER,"invalid-stream-failures"),bootstrapState:b0(V.bootstrap_state),bootstrapPhotoSeen:V.bootstrap_photo_seen===void 0?!1:S(V.bootstrap_photo_seen,"invalid-bootstrap-photo"),bootstrapStructureSeen:V.bootstrap_structure_seen===void 0?!1:S(V.bootstrap_structure_seen,"invalid-bootstrap-structure"),bootstrapFailures:V.bootstrap_failures===void 0?0:W(V.bootstrap_failures,0,2,"invalid-bootstrap-failures")}})},v3=(L,C)=>{if(!Array.isArray(L)||L.length!==2)throw new p(C);return[c1(L[0],-1e6,1e6,C),c1(L[1],-1e6,1e6,C)]},w0=(L,C)=>{if(!Array.isArray(L)||L.length<3||L.length>8192)throw new p(C);return L.map(H=>v3(H,C))},c3=(L,C)=>{if(!Array.isArray(L)||L.length>256)throw new p("invalid-rooms");return L.map(H=>{let V=R(H,"invalid-room");return{roomId:g(V.room_id,128,"invalid-room-id"),name:g(V.name,128,"invalid-room-name"),boundary:C?w0(V.boundary,"invalid-room-boundary"):[]}})},k0=L=>{let C=R(L,"invalid-history-snapshot"),H=g(C.created_at,64,"invalid-history-time");if(!Number.isFinite(Date.parse(H)))throw new p("invalid-history-time");return{id:g(C.id,128,"invalid-history-id"),createdAt:H,revision:W(C.revision,0,Number.MAX_SAFE_INTEGER,"invalid-history-revision"),pointCount:W(C.point_count,1,15e5,"invalid-history-points"),sceneUrl:K(C.scene_url,"invalid-history-scene-url")}},x3=L=>{let C=R(L,"invalid-history");if(!Array.isArray(C.floors)||C.floors.length<1||C.floors.length>128)throw new p("invalid-history-floors");return{entryId:g(C.entry_id,128,"invalid-history-entry"),liveAvailable:S(C.live_available,"invalid-history-live"),floors:C.floors.map(H=>{let V=R(H,"invalid-history-floor");if(!Array.isArray(V.snapshots)||V.snapshots.length>12)throw new p("invalid-history-snapshots");return{id:g(V.id,128,"invalid-history-floor-id"),active:S(V.active,"invalid-history-floor-active"),readOnly:S(V.read_only,"invalid-history-floor-read-only"),liveAvailable:V.live_available===void 0?!1:S(V.live_available,"invalid-history-floor-live"),label:f0(V.label),ordinal:V.ordinal===void 0?null:D2(V.ordinal,128),snapshots:V.snapshots.map(k0)}})}},u3=L=>{if(L==="vacuum"||L==="mop"||L==="vacuum_and_mop")return L;throw new p("invalid-cleaning-mode")},Z3=L=>{if(L==="quick"||L==="standard"||L==="heavy_duty")return L;throw new p("invalid-coverage-setting")},P0=L=>{let C=R(L,"invalid-area-circle");return{x:c1(C.x,-1e6,1e6,"invalid-area-circle"),y:c1(C.y,-1e6,1e6,"invalid-area-circle"),radius:c1(C.radius,.05,2.5,"invalid-area-circle")}},B0=L=>L==="current"||L==="review"||L==="stale"?L:"unknown",S3=L=>{let C=R(L,"invalid-areas");if(!Array.isArray(C.areas)||C.areas.length>256)throw new p("invalid-area-list");return{sceneUrl:K(C.scene_url,"invalid-area-scene-url"),rooms:c3(C.rooms,!0),areas:C.areas.map(H=>{let V=R(H,"invalid-area");if(!Array.isArray(V.circles)||V.circles.length>512)throw new p("invalid-area-circles");return{id:g(V.id,128,"invalid-area-id"),name:g(V.name,128,"invalid-area-name"),circles:V.circles.map(P0),cleaningMode:u3(V.cleaning_mode),coverageSetting:Z3(V.coverage_setting),status:B0(V.status),canRebind:S(V.can_rebind,"invalid-area-rebind")}})}},h3=L=>{let C=R(L,"invalid-plans");if(!Array.isArray(C.plans)||C.plans.length>256)throw new p("invalid-plan-list");return{rooms:c3(C.rooms,!1).map(({roomId:V,name:e})=>({roomId:V,name:e})),selectedPlan:C.selected_plan===null||C.selected_plan===void 0?null:g(C.selected_plan,128,"invalid-selected-plan"),plans:C.plans.map(V=>{let e=R(V,"invalid-plan");if(!Array.isArray(e.rooms)||e.rooms.length>256||!Array.isArray(e.room_order))throw new p("invalid-plan-rooms");let r=e.run_behavior;if(r!=="intelligent"&&r!=="ordered")throw new p("invalid-run-behavior");return{id:g(e.id,128,"invalid-plan-id"),name:g(e.name,128,"invalid-plan-name"),enabled:S(e.enabled,"invalid-plan-enabled"),runBehavior:r,rooms:e.rooms.map(M=>{let t=R(M,"invalid-plan-room");return{roomId:g(t.room_id,128,"invalid-plan-room-id"),cleaningMode:u3(t.cleaning_mode),coverageSetting:Z3(t.coverage_setting)}}),roomOrder:e.room_order.slice(0,256).map(M=>g(M,128,"invalid-room-order")),returnToBase:S(e.return_to_base,"invalid-return-to-base"),finishCurrentRoom:S(e.finish_current_room,"invalid-finish-room"),finishCurrentRoomThreshold:W(e.finish_current_room_threshold,0,100,"invalid-finish-threshold")}})}},f3=L=>{let C=R(L,"invalid-pose"),H=C.position,V=H===null?null:v3(H,"invalid-pose-position"),e=C.pose_freshness;if(e!=="live"&&e!=="coordinator_fallback")throw new p("invalid-pose-freshness");return{position:V,source:g(C.source,64,"invalid-pose-source"),revision:W(C.revision,0,Number.MAX_SAFE_INTEGER,"invalid-pose-revision"),poseRevision:W(C.pose_revision,0,Number.MAX_SAFE_INTEGER,"invalid-pose-sequence"),floorCoherent:S(C.map_floor_coherent,"invalid-pose-floor"),mapSessionKey:p3(C.map_session_key),freshness:e}},g3=L=>{try{return K(L,"invalid-private-path"),!0}catch{return!1}};var y3=L=>{let r=()=>{throw new Error("invalid-scene")};(!(L instanceof ArrayBuffer)||L.byteLength<24||L.byteLength>16777216)&&r();let M=new DataView(L),t=new Uint8Array(L,0,8),i=String.fromCharCode(...t),o=M.getUint16(8,!0),a=M.getUint16(10,!0),A=M.getUint32(12,!0),n=M.getUint32(16,!0),d=M.getUint32(20,!0),v=n+d,u=24+A;(i!=="MATIC3D\0"||o!==1||a!==8||A>1024*1024||v<1||v>15e5||u+v*a!==L.byteLength)&&r();let x;try{x=JSON.parse(new TextDecoder("utf-8",{fatal:!0}).decode(new Uint8Array(L,24,A)))}catch{r()}(!x||typeof x!="object"||Array.isArray(x))&&r();let m=x,b=m.meters_per_cell,Z=m.origin_cells,B=m.span_cells;(typeof b!="number"||!Number.isFinite(b)||b<.001||b>.1||!Array.isArray(Z)||Z.length!==2||!Z.every(_=>typeof _=="number"&&Number.isFinite(_))||!Array.isArray(B)||B.length!==2||!B.every(_=>typeof _=="number"&&Number.isFinite(_)&&_>=1&&_<=65536))&&r();let R1=(Array.isArray(m.rooms)?m.rooms.slice(0,128):[]).flatMap((_,N3)=>{if(!_||typeof _!="object"||Array.isArray(_))return[];let Y=_,_1=typeof Y.name=="string"?Y.name.trim():"";if(!_1||Array.from(_1).length>128||/[\u0000-\u001f\u007f]/u.test(_1))return[];if(!Array.isArray(Y.boundary)||Y.boundary.length<3||Y.boundary.length>8192)return[];let Q2=Y.boundary.flatMap(M2=>{if(!Array.isArray(M2)||M2.length!==2)return[];let[t2,i2]=M2;return typeof t2=="number"&&Number.isFinite(t2)&&typeof i2=="number"&&Number.isFinite(i2)?[[t2,i2]]:[]}),L2=Y.center;if(Q2.length<3||!Array.isArray(L2)||L2.length!==2)return[];let[e2,r2]=L2;return typeof e2!="number"||!Number.isFinite(e2)||typeof r2!="number"||!Number.isFinite(r2)?[]:[{id:`scene-room-${N3+1}`,name:_1,boundary:Q2,center:[e2,r2]}]}),W3=typeof m.sample_step=="number"&&Number.isInteger(m.sample_step)?Math.max(1,Math.min(15e5,m.sample_step)):1,U2=Z,G2=B;return{buffer:L,pointOffset:u,floorCount:n,surfaceCount:d,total:v,metadata:{metersPerCell:b,origin:[U2[0],U2[1]],span:[G2[0],G2[1]],sampleStep:W3,rooms:R1}}},F0=L=>{if(L.byteLength>16777216||L.byteLength<24||!1||!1)throw new p("invalid-scene");try{return y3(L)}catch{throw new p("invalid-scene")}},E0=()=>`
  const parseTransfer = ${y3.toString()};
  self.onmessage = (event) => {
    const { id, buffer } = event.data;
    try {
      const parsed = parseTransfer(buffer);
      self.postMessage({ id, ok: true, parsed }, [parsed.buffer]);
    } catch (_) {
      self.postMessage({ id, ok: false, problem: "invalid-scene" });
    }
  };
`,X1=class{#C=null;#H=null;#r=0;#V=new Map;constructor(){if(!(typeof Worker!="function"||typeof URL?.createObjectURL!="function"))try{this.#H=URL.createObjectURL(new Blob([E0()],{type:"text/javascript"})),this.#C=new Worker(this.#H),this.#C.onmessage=C=>{let H=this.#V.get(C.data.id);H&&(this.#V.delete(C.data.id),C.data.ok&&C.data.parsed?H.resolve(C.data.parsed):H.reject(new p(C.data.problem||"invalid-scene")))},this.#C.onerror=()=>this.#e("scene-worker-failed")}catch{this.#C=null,this.#H&&URL.revokeObjectURL(this.#H),this.#H=null}}async parse(C,H){if(H?.aborted)throw new DOMException("Aborted","AbortError");if(!this.#C){if(await new Promise(e=>window.setTimeout(e,0)),H?.aborted)throw new DOMException("Aborted","AbortError");return F0(C)}let V=++this.#r;return new Promise((e,r)=>{let M=()=>{this.#V.delete(V),r(new DOMException("Aborted","AbortError"))};H?.addEventListener("abort",M,{once:!0}),this.#V.set(V,{resolve:t=>{H?.removeEventListener("abort",M),e(t)},reject:t=>{H?.removeEventListener("abort",M),r(t)}}),this.#C?.postMessage({id:V,buffer:C},[C])})}#e(C){for(let H of this.#V.values())H.reject(new p(C));this.#V.clear(),this.#C?.terminate(),this.#C=null}dispose(){this.#e("scene-parser-disposed"),this.#H&&URL.revokeObjectURL(this.#H),this.#H=null}};var X={catalog:1e4,scene:6e4,delta:35e3,pose:1e4,history:15e3,workflow:15e3,mutation:2e4},$=class extends Error{constructor(C,H=null){super(C),this.name="BackendError",this.code=C,this.status=H}},B1=36,x1=16*1024*1024,b3=(L,C)=>{let H=Number(L);if(!Number.isSafeInteger(H)||H<0)throw new p(C);return H},O3=(L,C)=>{let H=L.headers.get("X-Matic-Revision");if(H===null)return C;let V=Number(H);if(!Number.isSafeInteger(V)||V<0)throw new p("invalid-scene-revision");return V},w3=(L,C)=>{let H=L.headers.get("X-Matic-Floor-Coherent");if(H===null)return C;if(H==="1")return!0;if(H==="0")return!1;throw new p("invalid-scene-floor-header")},j1=class{#C;#H=new X1;constructor(C){this.#C=C}async#r(C,H,V,e){if(!g3(C))throw new $("invalid-private-path");if(e?.aborted)throw new DOMException("Aborted","AbortError");let r=new AbortController,M=()=>r.abort();e?.addEventListener("abort",M,{once:!0});let t=!1,i=window.setTimeout(()=>{t=!0,r.abort()},V);try{let o=this.#C(),a=new Headers(H.headers),A={...H,cache:"no-store",credentials:"same-origin",headers:Object.fromEntries(a.entries()),signal:r.signal};if(typeof o?.fetchWithAuth=="function")return await o.fetchWithAuth(C,A);let n=o?.auth?.accessToken||o?.auth?.data?.access_token;n&&a.set("Authorization",`Bearer ${n}`);let d=typeof o?.hassUrl=="function"?o.hassUrl(C):C;return await fetch(d,{...A,headers:a})}catch(o){throw t&&!e?.aborted?new $("request-timeout"):r.signal.aborted?new DOMException("Aborted","AbortError"):o}finally{window.clearTimeout(i),e?.removeEventListener("abort",M)}}async#V(C,H,V,e={}){let r=await this.#r(C,{...e,headers:{Accept:"application/json",...e.headers||{}}},H,V);if(!r.ok)throw new $("request-failed",r.status);try{return await r.json()}catch{throw new p("invalid-json-response")}}async catalog(C){return m3(await this.#V(s3,X.catalog,C))}async scene(C,H,V,e,r,M){let t=new Headers({Accept:"application/vnd.matic.slam-scene"});e==="live"&&t.set("X-Matic-Prefer-Cached","1"),M&&t.set("If-None-Match",M);let i=await this.#r(C,{headers:t},X.scene,r),o=O3(i,H),a=w3(i,V);if(i.status===304)return{scene:null,floorCoherent:a,revision:o,notModified:!0};if(!i.ok)throw new $("scene-request-failed",i.status);if(i.headers.get("Content-Type")?.split(";",1)[0]!=="application/vnd.matic.slam-scene")throw new p("invalid-scene-content-type");return{scene:{...await this.#H.parse(await i.arrayBuffer(),r),revision:o,etag:i.headers.get("ETag"),source:e},floorCoherent:a,revision:o,notModified:!1}}async#e(C,H,V){if(!Number.isSafeInteger(H)||H<1||H>x1||typeof DecompressionStream!="function")throw new p("invalid-scene-delta");let r=new Blob([C]).stream().pipeThrough(new DecompressionStream("deflate")).getReader(),M=new Uint8Array(H),t=0,i=()=>{r.cancel()};V?.addEventListener("abort",i,{once:!0});try{for(;;){if(V?.aborted)throw new DOMException("Aborted","AbortError");let{done:o,value:a}=await r.read();if(o)break;if(!(a instanceof Uint8Array)||t+a.byteLength>H)throw new p("invalid-scene-delta");M.set(a,t),t+=a.byteLength}}finally{V?.removeEventListener("abort",i),r.releaseLock()}if(t!==H)throw new p("invalid-scene-delta");return M}async#L(C,H,V){if(C.byteLength<B1||C.byteLength>B1+x1||H.buffer.byteLength>x1)throw new p("invalid-scene-delta");let e=new DataView(C),r=new TextDecoder().decode(new Uint8Array(C,0,8)),M=e.getUint16(8,!0),t=e.getUint16(10,!0),i=b3(e.getBigUint64(12,!0),"invalid-scene-delta"),o=b3(e.getBigUint64(20,!0),"invalid-scene-delta"),a=e.getUint32(28,!0),A=e.getUint32(32,!0);if(r!=="MATICDLT"||M!==1||t!==1||i!==H.revision||o<=H.revision||a<24||a>x1||A>x1||A+B1!==C.byteLength)throw new p("invalid-scene-delta");let n=new Uint8Array(C,B1,A),d=new Uint8Array(H.buffer),u=(await this.#e(n,Math.max(d.byteLength,a),V)).slice(),x=1024*1024;for(let Z=0;Z<d.byteLength;Z+=x){if(V?.aborted)throw new DOMException("Aborted","AbortError");let B=Math.min(d.byteLength,Z+x);for(let w=Z;w<B;w+=1)u[w]=(u[w]??0)^(d[w]??0);B<d.byteLength&&await new Promise(w=>window.setTimeout(w,0))}let m=u.slice(0,a).buffer;return{parsed:{...await this.#H.parse(m,V),revision:o,etag:null,source:"live"},revision:o}}async sceneDelta(C,H,V,e){let r=C.includes("?")?"&":"?",M=await this.#r(`${C}${r}since=${encodeURIComponent(H.revision)}`,{headers:{Accept:"application/vnd.matic.slam-delta, application/vnd.matic.slam-scene"}},X.delta,e),t=O3(M,H.revision),i=w3(M,V);if(M.status===204){if(t!==H.revision)throw new p("invalid-scene-delta-revision");return{scene:null,floorCoherent:i,revision:t,notModified:!0}}if(!M.ok)throw new $("delta-request-failed",M.status);if(t<=H.revision)throw new p("invalid-scene-delta-revision");let o=Number(M.headers.get("Content-Length"));if(Number.isFinite(o)&&o>B1+x1)throw new p("invalid-scene-delta-size");let a=M.headers.get("Content-Type")?.split(";",1)[0],A=await M.arrayBuffer();if(a==="application/vnd.matic.slam-delta"){let d=Number(M.headers.get("X-Matic-Base-Revision"));if(!Number.isSafeInteger(d)||d!==H.revision)throw new p("invalid-scene-delta-base");let v=await this.#L(A,H,e);if(v.revision!==t)throw new p("invalid-scene-delta-revision");return{scene:{...v.parsed,etag:M.headers.get("ETag")},floorCoherent:i,revision:t,notModified:!1}}if(a!=="application/vnd.matic.slam-scene")throw new p("invalid-scene-delta-content-type");return{scene:{...await this.#H.parse(A,e),revision:t,etag:M.headers.get("ETag"),source:"live"},floorCoherent:i,revision:t,notModified:!1}}async pose(C,H){return f3(await this.#V(C,X.pose,H))}async history(C,H){return x3(await this.#V(C,X.history,H))}async plans(C,H){return h3(await this.#V(C,X.workflow,H))}async areas(C,H){return S3(await this.#V(C,X.workflow,H))}async saveArea(C,H,V){let e=await this.#V(C,X.mutation,V,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...H.areaId?{area_id:H.areaId}:{},name:H.name,circles:H.circles,cleaning_mode:H.cleaningMode,coverage_setting:H.coverageSetting})});if(!e||typeof e!="object"||typeof e.id!="string")throw new p("invalid-area-save-response");return e.id}async deleteArea(C,H,V){let e=await this.#r(`${C}?area_id=${encodeURIComponent(H)}`,{method:"DELETE",headers:{Accept:"application/json"}},X.mutation,V);if(!e.ok)throw new $("area-delete-failed",e.status)}async service(C,H,V,e){let r=this.#C();if(typeof r?.callService!="function")throw new $("service-unavailable");await r.callService(C,H,V,{entity_id:e})}dispose(){this.#H.dispose()}};var P3=()=>({version:4,view:"top",appearance:"photo",labels:!0,quality:"auto",cameras:{}}),T1=(L,C,H)=>Math.max(C,Math.min(H,L)),B3=L=>L.replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",I2=(L,C=4)=>`matic-map-studio:v${C}:${B3(L)}`,D0=L=>{if(!L||typeof L!="object")return null;let C=L;return["yaw","pitch","zoom","targetX","targetZ"].every(V=>typeof C[V]=="number"&&Number.isFinite(C[V]))?{yaw:T1(C.yaw,-Math.PI,Math.PI),pitch:T1(C.pitch,.18,Math.PI/2-.018),zoom:T1(C.zoom,.01,100),targetX:T1(C.targetX,-1e4,1e4),targetZ:T1(C.targetZ,-1e4,1e4)}:null},k3=L=>{let C=P3();if(!L||typeof L!="object")return C;let H=L,V=H.view==="three"||H.view==="top"||H.view==="rooms"?H.view:C.view,e=V==="rooms"?"top":V,r=H.quality==="auto"||H.quality==="efficient"||H.quality==="balanced"||H.quality==="maximum"?H.quality:C.quality,M=H.cameras&&typeof H.cameras=="object"?H.cameras:{},t={};for(let i of["three","top"]){let o=D0(M[i]);o&&(t[i]=o)}return{version:4,view:e,appearance:H.appearance==="rooms"||H.appearance==="photo"?H.appearance:C.appearance,labels:typeof H.labels=="boolean"?H.labels:C.labels,quality:r,cameras:t}},Y1=class{#C="local-user";#H=null;load(C){this.#C=B3(C);try{let H=window.localStorage.getItem(I2(this.#C));if(H)return k3(JSON.parse(H));for(let V of[3,2]){let e=window.localStorage.getItem(I2(this.#C,V));if(e)return k3(JSON.parse(e))}}catch{}return P3()}schedule(C){this.#H!==null&&window.clearTimeout(this.#H),this.#H=window.setTimeout(()=>{this.#H=null;try{window.localStorage.setItem(I2(this.#C),JSON.stringify(C))}catch{}},250)}dispose(){this.#H!==null&&window.clearTimeout(this.#H),this.#H=null}},T3="matic-map-studio:preferred-frontend",R3=()=>{try{return window.localStorage.getItem(T3)==="v3"?"v3":"v4"}catch{return"v4"}},W2=L=>{try{return window.localStorage.setItem(T3,L),!0}catch{return!1}};var c=(L,C,H=null)=>({status:L,value:C,problem:H}),z=L=>L instanceof DOMException&&L.name==="AbortError",i1=(L,C)=>L instanceof $||L&&typeof L=="object"&&"code"in L&&typeof L.code=="string"?L.code:C,J1=L=>[L.selectedFloorOrdinal??"none",L.mapFloorOrdinal??"none",L.mapFloorCoherent?"coherent":"transition"].join(":"),C2=L=>[L.mapFloorOrdinal??"none",L.mapSessionVerified?"verified":"unverified",L.mapSessionKey??"no-session"].join(":"),U=L=>[L.entryId,L.selectedFloorOrdinal??"none",L.mapFloorOrdinal??"none"].join("|"),_3=L=>[L.entryId,J1(L),C2(L),L.mapRevision].join("|"),F3=L=>L.runnerLocked||L.stopSettlePending||L.activePlan||L.nativeReconciliationPending||L.nativeSessionActive===!0,$0=(L,C)=>L.entryKey===C.entryKey&&L.generation===C.generation&&L.floorKey===C.floorKey&&L.missionKey===C.missionKey,E3="Live map updates paused while the current map is rechecked.",D3="Reconnecting. The last verified map remains read only.",I0=1e3,N2=(L,C)=>L.label?L.label:L.active?"Current floor":`Saved floor ${L.ordinal??C}`,H2=class{#C;#H=new $1;#r;#V=new Y1;#e=new Map;#L=null;#o;#a=null;#A=null;#t=null;#s=!1;#v=!1;#u=!1;#n="";#Z=0;#p="";#i=!1;#x=!0;constructor(C,H){this.#C=C,this.#r=H}sync(C,H){if(this.#i)return;let V=this.#x;if(this.#x=C.host.connected,this.#L=C,this.#o=H,this.#C.patch({host:C.host,activity:C.activity,batteryPercent:C.batteryPercent,robotLabel:C.robotLabel,robots:C.robots,locale:C.language}),C.userKey!==this.#p){this.#p=C.userKey;let e=this.#V.load(C.userKey);this.#C.patch({view:e.view,appearance:e.appearance,labelsVisible:e.labels,quality:e.quality,cameras:e.cameras})}if(!C.host.administrator){this.#h(),this.#l("access-required");return}if(!C.host.connected){this.#h();let e=this.#C.value,r=e.resources.scene.value;this.#C.patch({coherence:r?"degraded":"unavailable",resources:{...e.resources,pose:c("idle",null)},map:{...e.map,available:r!==null,exactPose:!1},notice:r?{tone:"warning",text:D3}:e.notice});return}if(C.host.robotCount===0){this.#h(),this.#l("map-unavailable");return}if(this.#f(),!V){this.#C.value.notice?.text===D3&&this.#C.patch({notice:null}),this.refreshCatalog(!0);return}(this.#C.value.resources.catalog.status==="idle"||C.entryKey&&C.entryKey!==this.#C.value.selection.entryId)&&this.refreshCatalog(!0)}schedulePreferences(C){this.#V.schedule(C)}#f(){this.#a===null&&(this.#a=window.setInterval(()=>{document.visibilityState==="visible"&&this.refreshCatalog()},5e3)),this.#A===null&&(this.#A=window.setInterval(()=>{document.visibilityState==="visible"&&this.refreshPose()},I0))}#h(){this.#a!==null&&window.clearInterval(this.#a),this.#A!==null&&window.clearInterval(this.#A),this.#a=null,this.#A=null}#M(C){this.#e.get(C)?.abort();let H=new AbortController;return this.#e.set(C,H),H}#d(C,H){this.#e.get(C)===H&&this.#e.delete(C)}#m(C=[]){for(let[H,V]of this.#e)C.includes(H)||(V.abort(),this.#e.delete(H))}#l(C){this.#m(),this.#H.invalidate(),this.#n="";let H=this.#C.value;this.#C.patch({generation:this.#H.generation,coherence:H.host.administrator?"unavailable":"blocked",fullMap:!1,precisionOpen:!1,resources:{catalog:c("error",null,C),entry:null,scene:c("idle",null),pose:c("idle",null),history:c("idle",null),plans:c("idle",null),areas:c("idle",null)},map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1},selection:{...H.selection,entryId:null,floorId:"current",historyId:null}})}async refreshCatalog(C=!1){if(this.#i||this.#s||!this.#L?.host.administrator)return;this.#s=!0;let H=this.#M("catalog"),V=this.#C.value.resources.catalog.value;this.#C.patch({resources:{...this.#C.value.resources,catalog:c("loading",V)}});try{let e=await this.#r.catalog(H.signal);if(H.signal.aborted||this.#i)return;let r=this.#o?.config?.entry_id,M=typeof r=="string"?r:null,t=e.find(a=>a.entryId===this.#L?.entryKey)||e.find(a=>a.entryId===M)||e[0]||null,i=this.#C.value.resources.entry;if(t&&i&&U(t)===U(i)&&J1(t)===J1(i)&&C2(t)===C2(i)&&t.mapRevision<i.mapRevision&&(t={...t,mapRevision:i.mapRevision}),this.#C.patch({managedLock:t?F3(t):!1,resources:{...this.#C.value.resources,catalog:c(e.length?"ready":"empty",e),entry:t}}),!t){this.#l("no-loaded-robot");return}if(this.#C.value.selection.floorId!=="current"&&!C)return;let o=_3(t);if(!C&&o===this.#n){let a=this.#C.value,A=t.mapFloorCoherent&&t.mapSessionVerified,n=t.health==="problem"||t.health==="limited";this.#C.patch({coherence:A?n?"degraded":"current":"verifying",map:{...a.map,available:A&&a.resources.scene.value!==null,complete:t.mapComplete&&!t.mapTruncated,floorCoherent:t.mapFloorCoherent,sessionVerified:t.mapSessionVerified,exactPose:A?a.map.exactPose:!1},floor:{...a.floor,classifiedCount:Math.max(1,t.historyFloorCount)}});return}this.#n=o,this.#w(t)}catch(e){if(z(e))return;this.#C.patch({coherence:this.#C.value.resources.scene.value?"degraded":"unavailable",resources:{...this.#C.value.resources,catalog:c("error",V,i1(e,"catalog-unavailable"))}})}finally{this.#d("catalog",H),this.#s=!1}}#w(C){let H=this.#C.value,V=H.resources.entry,e=!!(V&&U(V)===U(C)),r=C.mapFloorCoherent&&C.mapSessionVerified;this.#m(e?["catalog","plans","areas","plan-mutation","area-mutation"]:["catalog"]);let M=e?H.resources.scene.value:null,t=H.resources.pose.value,i=e&&r&&C.mapSessionKey!==null&&t?.position&&t.mapSessionKey===C.mapSessionKey?t:null,o=this.#H.begin(C.entryId,J1(C),C2(C),C.mapRevision),a=C.health==="problem"||C.health==="limited",A=this.#C.value;this.#C.patch({managedLock:F3(C),generation:o.generation,coherence:r?a?"degraded":"current":"verifying",dataMode:"live",resources:{...A.resources,entry:C,scene:c(r?"loading":"idle",M),pose:c(r?"loading":"idle",i),history:c("loading",A.resources.history.value),plans:e?A.resources.plans:c("idle",null),areas:e?A.resources.areas:c("idle",null)},map:{available:r&&M!==null,complete:C.mapComplete&&!C.mapTruncated,floorCoherent:C.mapFloorCoherent,sessionVerified:C.mapSessionVerified,exactPose:r&&i!==null},floor:{classifiedCount:Math.max(1,C.historyFloorCount),displayName:C.selectedFloorOrdinal?`Floor ${C.selectedFloorOrdinal}`:"Current floor",readOnly:!1},selection:{...A.selection,entryId:C.entryId,floorId:"current",historyId:null,roomIds:e?A.selection.roomIds:[],planId:e?A.selection.planId:null,areaId:e?A.selection.areaId:null}}),this.#b(C,o),r&&(this.#g(C,o),this.#S(C,o))}async#g(C,H){let V=this.#M("scene");try{let e=await this.#r.scene(C.sceneUrl,C.mapRevision,C.mapFloorCoherent,"live",V.signal);if(!this.#H.accepts(H)||e.revision!==H.revision||!e.floorCoherent||!e.scene)return;let r=this.#C.value;if(this.#C.patch({resources:{...r.resources,scene:c("ready",e.scene)},map:{...r.map,available:!0},notice:r.notice?.text===E3?null:r.notice}),C.deltaUrl){let M=++this.#Z;this.#y(C,H,e.scene,M)}}catch(e){if(z(e)||!this.#H.accepts(H))return;if(e instanceof $&&e.code==="request-timeout"){let i=this.#C.value;this.#C.patch({resources:{...i.resources,scene:c("loading",i.resources.scene.value,"scene-building")}}),window.setTimeout(()=>{this.#i||!this.#H.accepts(H)||this.#C.value.selection.floorId!=="current"||this.#g(C,H)},250);return}let r=this.#C.value,M=r.resources.pose.value,t=r.resources.scene.value!==null&&C.mapSessionKey!==null&&M?.position!==null&&M?.mapSessionKey===C.mapSessionKey;this.#C.patch({coherence:"degraded",resources:{...r.resources,scene:c("error",r.resources.scene.value,i1(e,"scene-unavailable"))},map:{...r.map,available:r.resources.scene.value!==null,exactPose:t}})}finally{this.#d("scene",V)}}async#y(C,H,V,e){if(!C.deltaUrl||typeof DecompressionStream!="function")return;let r=C.deltaUrl,M=C,t=H,i=V;try{for(;!this.#i&&e===this.#Z&&this.#H.accepts(t)&&this.#C.value.selection.floorId==="current";){let o=this.#M("delta");try{let a=await this.#r.sceneDelta(r,i,M.mapFloorCoherent,o.signal);if(o.signal.aborted||this.#i||e!==this.#Z||!this.#H.accepts(t))return;if(!a.floorCoherent){this.#C.patch({coherence:"verifying",map:{...this.#C.value.map,available:!1,floorCoherent:!1,exactPose:!1},resources:{...this.#C.value.resources,pose:c("idle",null)}}),this.#n="",this.refreshCatalog(!0);return}if(a.notModified||!a.scene){await new Promise(d=>window.setTimeout(d,100));continue}let A=this.#H.advance(t,a.revision);if(!A)return;t=A,i=a.scene,M={...M,mapRevision:a.revision},this.#n=_3(M);let n=this.#C.value;this.#C.patch({resources:{...n.resources,entry:M,scene:c("ready",i)},map:{...n.map,available:!0,floorCoherent:!0}}),this.#S(M,t)}finally{this.#d("delta",o)}}}catch(o){if(z(o)||this.#i||e!==this.#Z||!this.#H.accepts(t))return;this.#C.patch({coherence:"degraded",notice:{tone:"warning",text:E3}}),this.#n="",this.refreshCatalog(!0)}}async#b(C,H){let V=this.#M("history");try{let e=await this.#r.history(C.historyUrl,V.signal);if(!this.#H.accepts(H)||e.entryId!==C.entryId)return;let r=e.floors.find(M=>M.active)||e.floors[0];if(!r)return;this.#C.patch({resources:{...this.#C.value.resources,history:c("ready",e)},floor:{...this.#C.value.floor,classifiedCount:e.floors.length,displayName:N2(r,1)}})}catch(e){if(z(e)||!this.#H.accepts(H))return;this.#C.patch({resources:{...this.#C.value.resources,history:c("error",null,i1(e,"history-unavailable"))}})}finally{this.#d("history",V)}}async refreshPose(){let C=this.#C.value.resources.entry,H=this.#H.current();!C||!H||this.#C.value.selection.floorId!=="current"||!C.mapFloorCoherent||!C.mapSessionVerified||await this.#S(C,H)}async#S(C,H){if(this.#v){this.#u=!0;return}this.#v=!0;let V=this.#M("pose");try{let e=await this.#r.pose(C.poseUrl,V.signal),r=this.#H.current(),M=this.#C.value.resources.entry;if(!r||!$0(H,r)||!M||!e.floorCoherent)return;if(e.mapSessionKey===null||e.mapSessionKey!==M.mapSessionKey){this.#C.patch({map:{...this.#C.value.map,exactPose:!1}}),this.#n="",this.refreshCatalog(!0);return}let t=this.#C.value,i=t.resources.pose.value,o=!!(t.map.exactPose&&i?.position&&i.mapSessionKey===M.mapSessionKey);if(e.position===null&&o){this.#C.patch({resources:{...t.resources,pose:c("ready",i)}});return}this.#C.patch({resources:{...t.resources,pose:c("ready",e)},map:{...t.map,exactPose:e.position!==null}})}catch(e){if(z(e)||!this.#H.accepts(H))return;let r=this.#C.value,M=r.resources.pose.value,t=!!(r.map.exactPose&&M?.position&&M.mapSessionKey===r.resources.entry?.mapSessionKey);this.#C.patch({resources:{...r.resources,pose:c("error",t?M:null,i1(e,"pose-unavailable"))},map:{...r.map,exactPose:t}})}finally{if(this.#d("pose",V),this.#v=!1,this.#u&&!this.#i){this.#u=!1;let e=this.#C.value.resources.entry,r=this.#H.current();e&&r&&this.#S(e,r)}}}async selectFloor(C){let H=this.#C.value.resources.history.value,V=this.#C.value.resources.entry;if(!H||!V)return;let e=H.floors.find(t=>t.id===C);if(!e)return;if(e.active){this.#n="",this.#C.dispatch({type:"set-floor",floorId:"current"}),await this.refreshCatalog(!0);return}let r=e.snapshots.at(-1);this.#m(["catalog"]);let M=this.#H.begin(V.entryId,e.id,r?.id||e.id,r?.revision||0);this.#C.patch({generation:M.generation,coherence:"current",dataMode:"history",floor:{classifiedCount:H.floors.length,displayName:N2(e,H.floors.indexOf(e)+1),readOnly:!0},selection:{...this.#C.value.selection,floorId:e.id,historyId:r?.id||null},resources:{...this.#C.value.resources,scene:c(r?"loading":"empty",null),pose:c("idle",null)},map:{available:!1,complete:!0,floorCoherent:!0,sessionVerified:!0,exactPose:!1}}),r&&await this.#P(r,M)}async selectHistory(C){let H=this.#C.value.resources.history.value,V=this.#C.value.resources.entry;if(!H||!V)return;if(!C){await this.selectFloor("current");return}let e=H.floors.find(t=>t.snapshots.some(i=>i.id===C)),r=e?.snapshots.find(t=>t.id===C);if(!e||!r)return;let M=this.#H.begin(V.entryId,e.id,r.id,r.revision);this.#m(["catalog"]),this.#C.patch({generation:M.generation,dataMode:"history",floor:{classifiedCount:H.floors.length,displayName:N2(e,H.floors.indexOf(e)+1),readOnly:!0},selection:{...this.#C.value.selection,floorId:e.id,historyId:r.id},resources:{...this.#C.value.resources,scene:c("loading",null),pose:c("idle",null)},map:{...this.#C.value.map,available:!1,exactPose:!1}}),await this.#P(r,M)}async#P(C,H){let V=this.#M("history-scene");try{let e=await this.#r.scene(C.sceneUrl,C.revision,!0,"history",V.signal);if(!this.#H.accepts(H)||!e.scene)return;this.#C.patch({resources:{...this.#C.value.resources,scene:c("ready",e.scene)},map:{...this.#C.value.map,available:!0,exactPose:!1}})}catch(e){if(z(e)||!this.#H.accepts(H))return;this.#C.patch({resources:{...this.#C.value.resources,scene:c("error",null,i1(e,"history-scene-unavailable"))}})}finally{this.#d("history-scene",V)}}async openWorkflow(C){this.#C.dispatch({type:"open-workflow",workflow:C}),(C==="plan"||C==="rooms")&&await this.loadPlans(),(C==="draw"||C==="areaReview")&&await this.loadAreas()}async loadPlans(){let C=this.#C.value.resources.entry;if(!C||!this.#H.current()||!a2(this.#C.value))return;let H=U(C),V=this.#M("plans");this.#C.patch({resources:{...this.#C.value.resources,plans:c("loading",null)}});try{let e=await this.#r.plans(C.plansUrl,V.signal),r=this.#C.value.resources.entry;if(!r||U(r)!==H)return;this.#C.patch({resources:{...this.#C.value.resources,plans:c("ready",e)},selection:{...this.#C.value.selection,planId:e.selectedPlan||e.plans[0]?.id||null}}),this.selectPlan(e.selectedPlan||e.plans[0]?.id||null)}catch(e){let r=this.#C.value.resources.entry;if(z(e)||!r||U(r)!==H)return;this.#C.patch({resources:{...this.#C.value.resources,plans:c("error",null,i1(e,"plans-unavailable"))}})}finally{this.#d("plans",V)}}selectPlan(C){let H=this.#C.value.resources.plans.value?.plans.find(V=>V.id===C);this.#C.patch({selection:{...this.#C.value.selection,planId:C},planDraft:H?this.#k(H):{...this.#C.value.planDraft,id:null,name:"",rooms:[],dirty:!1}})}#k(C){return{id:C.id,name:C.name,enabled:C.enabled,runBehavior:C.runBehavior,rooms:(C.roomOrder.length?C.roomOrder.flatMap(H=>{let V=C.rooms.find(e=>e.roomId===H);return V?[V]:[]}):C.rooms).map(H=>({...H})),returnToBase:C.returnToBase,finishCurrentRoom:C.finishCurrentRoom,finishCurrentRoomThreshold:C.finishCurrentRoomThreshold,dirty:!1}}async loadAreas(){let C=this.#C.value.resources.entry;if(!C||!this.#H.current()||!a2(this.#C.value))return;let H=U(C),V=this.#M("areas");this.#C.patch({resources:{...this.#C.value.resources,areas:c("loading",null)}});try{let e=await this.#r.areas(C.areasUrl,V.signal),r=this.#C.value.resources.entry;if(!r||U(r)!==H||e.sceneUrl!==r.sceneUrl)return;this.#C.patch({resources:{...this.#C.value.resources,areas:c("ready",e)}}),this.selectArea(e.areas[0]?.id||null)}catch(e){let r=this.#C.value.resources.entry;if(z(e)||!r||U(r)!==H)return;this.#C.patch({resources:{...this.#C.value.resources,areas:c("error",null,i1(e,"areas-unavailable"))}})}finally{this.#d("areas",V)}}selectArea(C){let H=this.#C.value.resources.areas.value?.areas.find(e=>e.id===C),V=this.#C.value;this.#C.patch({selection:{...V.selection,areaId:C},areaDraft:H?this.#B(H):{id:null,name:"",cleaningMode:"vacuum",coverageSetting:"standard",status:"new",canRebind:!1,dirty:!1},draw:{...V.draw,circles:H?.circles||[],undo:[],redo:[],dirty:!1,strokeCount:0}})}#B(C){return{id:C.id,name:C.name,cleaningMode:C.cleaningMode,coverageSetting:C.coverageSetting,status:C.status,canRebind:C.canRebind,dirty:!1}}async saveArea(){let C=this.#C.value,H=C.resources.entry,V=C.areaDraft;if(!H||!Q(C)||!V.name.trim()||!C.draw.circles.length)return;let e=this.#M("area-mutation");this.#C.patch({command:"pending",notice:{tone:"info",text:"Saving area\u2026"}});try{let r=await this.#r.saveArea(H.areasUrl,{areaId:V.id,name:V.name.trim(),circles:C.draw.circles,cleaningMode:V.cleaningMode,coverageSetting:V.coverageSetting},e.signal);this.#C.patch({command:"idle",notice:{tone:"success",text:"Area saved"}}),await this.loadAreas(),this.selectArea(r)}catch(r){if(z(r))return;this.#C.patch({command:"failed",notice:{tone:"error",text:"Area could not be saved"}})}finally{this.#d("area-mutation",e)}}async deleteArea(){let C=this.#C.value.resources.entry,H=this.#C.value.selection.areaId;if(!C||!H||!Q(this.#C.value))return;let V=this.#M("area-mutation");try{await this.#r.deleteArea(C.areasUrl,H,V.signal),this.#C.patch({notice:{tone:"success",text:"Area deleted"}}),await this.loadAreas()}catch(e){z(e)||this.#C.patch({notice:{tone:"error",text:"Area could not be deleted"}})}finally{this.#d("area-mutation",V)}}async savePlan(){let C=this.#C.value,H=C.planDraft,V=C.resources.plans.value;if(!V||!H.name.trim()||!H.rooms.length||!Q(C))return;let e=H.rooms;await this.#O("save_plan",{...H.id?{plan_id:H.id}:{},name:H.name.trim(),enabled:H.enabled,run_behavior:H.runBehavior,rooms:e.map(r=>({room:V.rooms.find(M=>M.roomId===r.roomId)?.name,cleaning_mode:r.cleaningMode,coverage_setting:r.coverageSetting})).filter(r=>r.room),return_to_base:H.returnToBase,finish_current_room:H.finishCurrentRoom,finish_current_room_threshold:H.finishCurrentRoomThreshold,select:!H.id||V.selectedPlan===H.id},"Plan saved","Plan could not be saved"),await this.loadPlans()}async deletePlan(){let C=this.#C.value.selection.planId;C&&(await this.#O("delete_plan",{plan:C},"Plan deleted","Plan could not be deleted"),await this.loadPlans())}async executeAction(C){switch(C){case"stop":this.#C.value.resources.entry?.activePlan||this.#C.value.resources.entry?.runnerLocked?await this.#c("matic_robot","stop_intelligent_cleaning",{}):await this.#c("vacuum","return_to_base",{});return;case"resume":await this.#c("vacuum","start",{});return;case"run-plan":{let H=this.#C.value.selection.planId||this.#C.value.resources.plans.value?.selectedPlan;H&&await this.#c("matic_robot","run_selected_plan",{plan:H});return}case"clean-rooms":{let H=this.#C.value.resources.plans.value,e=this.#C.value.selection.roomSettings.map(r=>({room:H?.rooms.find(M=>M.roomId===r.roomId)?.name,cleaning_mode:r.cleaningMode,coverage_setting:r.coverageSetting})).filter(r=>r.room);e.length&&await this.#c("matic_robot","clean_room_sequence",{rooms:e,return_to_base:!0});return}case"run-area":{let H=this.#C.value.selection.areaId;H&&await this.#c("matic_robot","clean_area",{area:H});return}case"review-area":this.#C.dispatch({type:"open-workflow",workflow:"areaReview"});return;case"save-area":await this.saveArea();return;case"save-plan":await this.savePlan();return;case"delete-plan":await this.deletePlan();return;case"delete-area":await this.deleteArea();return}}async#O(C,H,V,e){let r=this.#L?.vacuumEntityId;if(!(!r||!Q(this.#C.value)||this.#C.value.command==="pending")){this.#C.patch({command:"pending",notice:{tone:"info",text:"Saving\u2026"}});try{await this.#r.service("matic_robot",C,H,r),this.#C.patch({command:"idle",notice:{tone:"success",text:V}})}catch{this.#C.patch({command:"failed",notice:{tone:"error",text:e}})}}}async#c(C,H,V){let e=this.#C.value,r=this.#L?.vacuumEntityId,t=(H==="stop_intelligent_cleaning"||C==="vacuum"&&H==="return_to_base")&&e.command==="idle"&&(e.activity==="cleaning"||e.activity==="paused"||e.activity==="returning"||e.activity==="recharging");if(!(!r||!t&&!a1(e))){this.#C.patch({command:"pending",notice:null});try{await this.#r.service(C,H,V,r),this.#C.patch({command:"settling"}),this.#t!==null&&window.clearTimeout(this.#t),this.#t=window.setTimeout(()=>{this.#t=null,this.#C.value.command==="settling"&&this.#C.patch({command:"idle"})},15e3)}catch{this.#C.patch({command:"failed",notice:{tone:"error",text:"The robot did not accept that action"}})}}}updateDraftCircles(C,H=!0,V){this.#C.dispatch({type:"set-draft-circles",circles:C,record:H,...V?{previous:V}:{}}),this.#C.dispatch({type:"patch-area-draft",patch:{dirty:!0}})}dispose(){this.#i||(this.#i=!0,this.#h(),this.#m(),this.#t!==null&&window.clearTimeout(this.#t),this.#t=null,this.#V.dispose(),this.#r.dispose(),this.#H.invalidate())}};var $3=L=>(L.workflow==="none"?0:1)+(L.fullMap?1:0)+(L.precisionOpen?1:0)+(L.dialog?1:0),W0=L=>{if(!L||typeof L!="object")return null;let C=L.maticMapLayer;if(!C||typeof C!="object")return null;let H=C.owner,V=C.depth;return typeof H=="string"&&Number.isInteger(V)&&Number(V)>=0?{owner:H,depth:Number(V)}:null},V2=class{#C;#H=`matic-map-${crypto.randomUUID?.()||Math.random().toString(36).slice(2)}`;#r=0;#V=null;#e=!1;constructor(C){this.#C=C}start(){this.#V||(this.#r=$3(this.#C.value),this.#V=this.#C.subscribe(C=>this.#L(C)),window.addEventListener("popstate",this.#o))}#L(C){let H=$3(C);if(this.#e){this.#e=!1,this.#r=H;return}if(H>this.#r)for(let V=this.#r+1;V<=H;V+=1){let e=history.state&&typeof history.state=="object"?history.state:{};history.pushState({...e,maticMapLayer:{owner:this.#H,depth:V}},"",window.location.href)}this.#r=H}#o=()=>{this.#r<1||(this.#e=!0,this.#C.dispatch({type:"dismiss-top-layer"}))};dismissTop(){if(this.#r<1)return!1;let C=W0(history.state);return C?.owner===this.#H&&C.depth===this.#r?history.back():this.#C.dispatch({type:"dismiss-top-layer"}),!0}dispose(){this.#V?.(),this.#V=null,window.removeEventListener("popstate",this.#o),this.#r=0}};var I3=N(r1),z2=class extends f{constructor(){super(...arguments);this.narrow=!1;this._workspace=O();this._classic=!1;this.entryOverride=null;this.#C=new W1;this.#H=new A1(this._workspace);this.#r=null;this.#V=null;this.#e=null;this.#L=null;this.#o=null;this.#a=""}static{this.styles=[F,E,h`
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
`]}static{this.properties={hass:{attribute:!1},narrow:{type:Boolean},route:{attribute:!1},panel:{attribute:!1},_workspace:{state:!0},_classic:{state:!0},entryOverride:{state:!0}}}#C;#H;#r;#V;#e;#L;#o;#a;connectedCallback(){super.connectedCallback(),this._classic=R3()==="v3",this.#V=this.#H.subscribe(H=>{this._workspace=H,this.#s(H)}),this._classic||this.#A()}disconnectedCallback(){this.#V?.(),this.#V=null,this.#t(),super.disconnectedCallback()}#A(){this.#L||(this.#e=new j1(()=>this.hass),this.#L=new H2(this.#H,this.#e),this.#o=new V2(this.#H),this.#o.start(),this.#r&&this.#L.sync(this.#r,this.panel))}#t(){this.#o?.dispose(),this.#o=null,this.#L?.dispose(),this.#L=null,this.#e=null}#s(H){if(!this.#L)return;let V={version:4,view:H.view,appearance:H.appearance,labels:H.labelsVisible,quality:H.quality,cameras:H.cameras},e=JSON.stringify(V);e!==this.#a&&(this.#a=e,this.#L.schedulePreferences(V))}willUpdate(H){if(H.has("hass")||H.has("panel")||H.has("entryOverride")){let V=this.#C.project(this.hass,this.panel,this.entryOverride);if(V!==this.#r){this.#r=V;let e=V.host.connected?V.host.robotCount===0?"unavailable":V.host.administrator?"verifying":"blocked":"degraded";this.#H.replace({...this.#H.value,coherence:e,activity:V.activity,batteryPercent:V.batteryPercent,host:V.host,fullMap:V.host.administrator&&V.host.robotCount>0&&this.#H.value.fullMap,robotLabel:V.robotLabel,robots:V.robots,locale:V.language})}this._classic||this.#L?.sync(V,this.panel)}H.has("narrow")&&this.#H.value.narrowHint!==this.narrow&&this.#H.dispatch({type:"set-narrow-hint",value:this.narrow})}#v(H){if(!D1(H.detail))return;H.stopPropagation();let V=H.detail;if(V.type==="dismiss-top-layer"||V.type==="exit-full-map"){this.#o?.dismissTop()||this.#H.dispatch(V);return}if(V.type==="open-workflow"&&V.workflow!=="none"){this.#L?.openWorkflow(V.workflow);return}if(V.type==="set-floor"){this.#L?.selectFloor(V.floorId);return}if(V.type==="select-entry"){if(!this._workspace.robots.some(e=>e.entryId===V.entryId))return;this.entryOverride=V.entryId;return}if(V.type==="set-history"){this.#L?.selectHistory(V.historyId);return}if(V.type==="select-plan"){this.#L?.selectPlan(V.planId);return}if(V.type==="select-area"){this.#L?.selectArea(V.areaId);return}this.#H.dispatch(V)}#u(H){if(H.stopPropagation(),typeof H.detail?.id=="string"){if(H.detail.id==="use-classic"){W2("v3")&&(this.#t(),this._classic=!0);return}this.#L?.executeAction(H.detail.id),this.dispatchEvent(new CustomEvent("matic-map-v4-action-requested",{detail:{id:H.detail.id},bubbles:!0,composed:!0}))}}#n(){W2("v4")&&(this._classic=!1,this.#A(),this.requestUpdate())}updated(){if(!this._classic)return;let H=this.renderRoot.querySelector("matic-map-panel-v0-3-1");H&&(H.hass=this.hass,H.narrow=this.narrow,H.route=this.route,H.panel=this.panel)}getWorkspaceSnapshot(){return this.#H.value}render(){return this._classic?s`
        <div class="classic">
          <button class="return-v4" type="button" @click=${this.#n}>${P(this.hass?.localize,"v4_use_new","Use Map Studio 0.4")}</button>
          <matic-map-panel-v0-3-1></matic-map-panel-v0-3-1>
        </div>
      `:s`
      <${I3}
        .state=${this._workspace}
        .localize=${this.hass?.localize}
        @matic-workspace-intent=${this.#v}
        @matic-workspace-action=${this.#u}
      ></${I3}>
    `}};customElements.get(O2)||customElements.define(O2,z2);export{$1 as CoherenceMachine,E1 as DRAW_BRUSH_MAX_METERS,u1 as DRAW_BRUSH_MIN_METERS,l2 as GALLERY_SCENARIOS,W1 as HassAdapter,o2 as MAP_PIXELS_PER_METER_AT_100,F1 as MAP_ZOOM_MAX,J as MAP_ZOOM_MIN,O2 as MATIC_MAP_PANEL_TAG,z2 as MaticMapPanelV4,E2 as MaticMapStudioGalleryV4,A1 as WorkspaceStore,U0 as brushCursorPixels,Q as canEditCoordinates,a2 as canReadFloorResources,K2 as canShowExactPose,n1 as canShowLiveMap,a1 as canStartMotion,G0 as commandState,d2 as createGalleryState,O as initialWorkspaceState,D1 as isWorkspaceIntent,Y2 as mapScale,U3 as normalizeBrush,q2 as normalizeZoom,G3 as reduceWorkspace,j2 as selectPausedSecondaryAction,X2 as selectPrimaryAction};
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
