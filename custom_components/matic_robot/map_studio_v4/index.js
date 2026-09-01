var j=100,Ie=1e3,be=.2,Le=2.5,nt=64,Te=o=>!o||typeof o!="object"?!1:typeof o.type=="string";var ie=()=>({status:"idle",value:null,problem:null}),B=(o,e,t)=>Math.max(e,Math.min(t,o)),co=o=>({yaw:B(Number.isFinite(o.yaw)?o.yaw:0,-Math.PI,Math.PI),pitch:B(Number.isFinite(o.pitch)?o.pitch:Math.PI/2-.018,.18,Math.PI/2-.018),zoom:B(Number.isFinite(o.zoom)?o.zoom:1,.01,100),targetX:B(Number.isFinite(o.targetX)?o.targetX:0,-1e4,1e4),targetZ:B(Number.isFinite(o.targetZ)?o.targetZ:0,-1e4,1e4)}),qt=o=>Math.round(B(Number.isFinite(o)?o:100,100,1e3)),uo=o=>Math.round(B(Number.isFinite(o)?o:.2,.2,2.5)*100)/100,M=()=>({generation:0,coherence:"verifying",dataMode:"live",activity:"unknown",workflow:"none",command:"idle",fullMap:!1,precisionOpen:!1,dialog:null,narrowHint:!1,view:"top",appearance:"photo",labelsVisible:!0,quality:"auto",cameras:{},managedLock:!1,batteryPercent:null,floor:{classifiedCount:1,displayName:"Current floor",readOnly:!1},map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1},host:{connected:!0,administrator:!0,robotConnected:!1,robotCount:0},draw:{zoomPercent:100,zoomOriginX:50,zoomOriginY:50,brushMeters:.6,tool:"paint",dirty:!1,strokeCount:0,circles:[],undo:[],redo:[]},resources:{catalog:ie(),entry:null,scene:ie(),pose:ie(),history:ie(),plans:ie(),areas:ie()},selection:{entryId:null,floorId:"current",historyId:null,roomIds:[],roomSettings:[],cleaningMode:"vacuum",coverageSetting:"standard",planId:null,areaId:null},planDraft:{id:null,name:"",enabled:!0,runBehavior:"intelligent",rooms:[],returnToBase:!0,finishCurrentRoom:!1,finishCurrentRoomThreshold:50,dirty:!1},areaDraft:{id:null,name:"",cleaningMode:"vacuum",coverageSetting:"standard",status:"new",canRebind:!1,dirty:!1},notice:null,robotLabel:"Matic robot",robots:[],locale:"en"}),O=(o,e)=>({...o,draw:{...o.draw,...e}}),ho=(o,e)=>{switch(e.type){case"set-host":return{...o,host:e.host,fullMap:e.host.administrator&&e.host.robotCount>0?o.fullMap:!1};case"set-operational-state":return{...o,coherence:e.coherence,activity:e.activity,command:e.command??o.command};case"set-narrow-hint":return{...o,narrowHint:e.value};case"set-view":return{...o,view:e.view};case"set-appearance":return{...o,appearance:e.appearance};case"set-quality":return{...o,quality:e.quality};case"set-camera":return{...o,cameras:{...o.cameras,[e.view]:co(e.camera)}};case"toggle-labels":return{...o,labelsVisible:!o.labelsVisible};case"open-workflow":return{...o,workflow:e.workflow,precisionOpen:!1};case"enter-full-map":return o.host.administrator&&o.host.robotCount>0&&o.map.available?{...o,fullMap:!0}:o;case"exit-full-map":return{...o,fullMap:!1,precisionOpen:!1};case"set-precision-open":return{...o,precisionOpen:e.value};case"set-zoom":return O(o,{zoomPercent:qt(e.value),...e.originX===void 0?{}:{zoomOriginX:B(e.originX,0,100)},...e.originY===void 0?{}:{zoomOriginY:B(e.originY,0,100)}});case"step-zoom":return O(o,{zoomPercent:qt(o.draw.zoomPercent*e.factor)});case"fit-map":return O(o,{zoomPercent:100,zoomOriginX:50,zoomOriginY:50});case"set-brush":return O(o,{brushMeters:uo(e.value)});case"set-draw-tool":return O(o,{tool:e.tool});case"mark-draft":{let t=Math.max(0,o.draw.strokeCount+e.strokeDelta);return O(o,{dirty:t>0,strokeCount:t})}case"undo-draft":{let t=o.draw.undo.at(-1);return t?O(o,{circles:t,undo:o.draw.undo.slice(0,-1),redo:[...o.draw.redo,o.draw.circles],dirty:!0,strokeCount:Math.max(0,o.draw.strokeCount-1)}):o}case"clear-draft":return o.draw.circles.length?O(o,{circles:[],undo:[...o.draw.undo.slice(-99),o.draw.circles],redo:[],dirty:!0,strokeCount:o.draw.strokeCount+1}):o;case"redo-draft":{let t=o.draw.redo.at(-1);return t?O(o,{circles:t,undo:[...o.draw.undo,o.draw.circles],redo:o.draw.redo.slice(0,-1),dirty:!0,strokeCount:o.draw.strokeCount+1}):o}case"set-draft-circles":{let t=e.circles.slice(0,512).map(n=>({...n})),r=e.record!==!1;return O(o,{circles:t,undo:r?[...o.draw.undo.slice(-99),e.previous??o.draw.circles]:o.draw.undo,redo:r?[]:o.draw.redo,dirty:!0,strokeCount:r?o.draw.strokeCount+1:o.draw.strokeCount})}case"discard-draft":return{...O(o,{dirty:!1,strokeCount:0,circles:[],undo:[],redo:[]}),dialog:null,workflow:"none",precisionOpen:!1};case"toggle-room":{let t=o.selection.roomIds.includes(e.roomId);return{...o,selection:{...o.selection,roomIds:t?o.selection.roomIds.filter(r=>r!==e.roomId):[...o.selection.roomIds,e.roomId],roomSettings:t?o.selection.roomSettings.filter(r=>r.roomId!==e.roomId):[...o.selection.roomSettings,{roomId:e.roomId,cleaningMode:"vacuum",coverageSetting:"standard"}]}}}case"patch-room-settings":return{...o,selection:{...o.selection,roomSettings:o.selection.roomSettings.map(t=>t.roomId===e.roomId?{...t,...e.cleaningMode?{cleaningMode:e.cleaningMode}:{},...e.coverageSetting?{coverageSetting:e.coverageSetting}:{}}:t)}};case"set-floor":return{...o,dataMode:e.floorId==="current"?"live":"history",selection:{...o.selection,floorId:e.floorId,historyId:null}};case"select-entry":return o;case"set-history":return{...o,dataMode:e.historyId?"history":"live",selection:{...o.selection,historyId:e.historyId}};case"select-plan":return{...o,selection:{...o.selection,planId:e.planId}};case"select-area":return{...o,selection:{...o.selection,areaId:e.areaId}};case"patch-plan-draft":return{...o,planDraft:{...o.planDraft,...e.patch,dirty:e.patch.dirty??!0}};case"patch-area-draft":return{...o,areaDraft:{...o.areaDraft,...e.patch,dirty:e.patch.dirty??!0}};case"set-notice":return{...o,notice:e.notice};case"open-dialog":return{...o,dialog:e.dialog};case"dismiss-top-layer":return o.dialog?{...o,dialog:null}:o.precisionOpen?{...o,precisionOpen:!1}:o.fullMap?{...o,fullMap:!1}:o.workflow!=="none"?{...o,workflow:"none",precisionOpen:!1}:o;case"return-live":return{...o,dataMode:"live",workflow:"none",floor:{...o.floor,readOnly:!1}}}},le=class{#e=new Set;#t;constructor(e=M()){this.#t=e}get value(){return this.#t}dispatch(e){let t=ho(this.#t,e);if(t===this.#t)return t;this.#t=t;for(let r of this.#e)r(t);return t}replace(e){if(e!==this.#t){this.#t=e;for(let t of this.#e)t(e)}}patch(e){let t={...this.#t,...e};return this.replace(t),t}subscribe(e){return this.#e.add(e),e(this.#t),()=>this.#e.delete(e)}},ze=class{#e=null;#t=0;get generation(){return this.#t}begin(e,t,r,n){return this.#t+=1,this.#e={entryKey:e,generation:this.#t,floorKey:t,missionKey:r,revision:n},this.#e}current(){return this.#e}accepts(e){let t=this.#e;return!!(t&&e.entryKey===t.entryKey&&e.generation===t.generation&&e.floorKey===t.floorKey&&e.missionKey===t.missionKey&&e.revision===t.revision)}advance(e,t){return!this.accepts(e)||!Number.isSafeInteger(t)||t<=e.revision?null:(this.#e={...e,revision:t},this.#e)}invalidate(){return this.#t+=1,this.#e=null,this.#t}},ce=o=>o.dataMode==="live"&&o.map.available&&(o.coherence==="current"||o.coherence==="degraded")&&o.host.administrator,Xt=o=>ce(o)&&(o.coherence==="current"||o.coherence==="degraded")&&o.map.floorCoherent&&o.map.sessionVerified&&o.map.exactPose&&o.host.connected&&o.host.robotConnected,q=o=>ce(o)&&o.coherence==="current"&&o.map.complete&&o.map.floorCoherent&&o.map.sessionVerified&&o.host.connected&&o.host.robotConnected&&!o.floor.readOnly,at=o=>ce(o)&&o.coherence==="current"&&o.map.floorCoherent&&o.map.sessionVerified&&o.host.connected&&o.host.robotConnected&&!o.floor.readOnly,se=o=>q(o)&&!o.managedLock&&o.command==="idle"&&(o.activity==="idle"||o.activity==="docked"),ge=(o,e,t)=>({id:o,label:e,kind:"neutral",enabled:!1,reason:t}),Vt=o=>{if(o.dataMode==="history")return{id:"return-live",label:"Return to Live",kind:"primary",enabled:!0};if(o.activity==="cleaning"||o.activity==="returning"||o.activity==="recharging")return{id:"stop",label:"Stop",kind:"danger",enabled:o.command==="idle"};if(o.activity==="stopping"||o.command==="settling")return ge("stopping","Stopping\u2026","Waiting for the robot to settle");if(o.activity==="paused")return{id:"resume",label:"Resume",kind:"primary",enabled:o.command==="idle"};if(!o.host.connected)return ge("reconnecting","Reconnecting\u2026","Home Assistant is offline");if(!o.host.administrator)return ge("administrator","Administrator required","This map is private");if(!o.host.robotConnected)return ge("robot-offline","Robot offline","Reconnect the robot first");if(o.coherence!=="current")return ge("locating","Locating\u2026","Waiting for the current map");if(o.workflow==="draw")return o.fullMap||o.narrowHint?{id:"review-area",label:"Review details",kind:"primary",enabled:o.draw.dirty,...o.draw.dirty?{}:{reason:"Draw an area first"}}:{id:"save-area",label:"Save area",kind:"primary",enabled:o.draw.dirty&&q(o),...o.draw.dirty?{}:{reason:"Draw an area first"}};if(o.workflow==="rooms"){let e=se(o)&&o.selection.roomIds.length>0;return{id:"clean-rooms",label:o.selection.roomIds.length?`Clean ${o.selection.roomIds.length} room${o.selection.roomIds.length===1?"":"s"}`:"Choose rooms",kind:"primary",enabled:e,...e?{}:{reason:o.selection.roomIds.length?"Map verification is required":"Select at least one room"}}}if(o.workflow==="plan"){if(o.planDraft.dirty||!o.planDraft.id){let e=q(o)&&o.planDraft.name.trim().length>0&&o.planDraft.rooms.length>0;return{id:"save-plan",label:"Save plan",kind:"primary",enabled:e,...e?{}:{reason:"Add a name and at least one room"}}}return{id:"run-plan",label:"Run plan",kind:"primary",enabled:se(o)&&o.planDraft.enabled,...se(o)?{}:{reason:"Map verification is required"}}}if(o.workflow==="areaReview"){if(o.areaDraft.dirty||o.draw.dirty||!o.areaDraft.id||o.areaDraft.canRebind){let t=q(o)&&o.areaDraft.name.trim().length>0&&o.draw.circles.length>0;return{id:"save-area",label:o.areaDraft.canRebind?"Confirm on this map":"Save area",kind:"primary",enabled:t,...t?{}:{reason:"Add a name and at least one mark"}}}let e=o.areaDraft.status==="current";return{id:"run-area",label:"Clean area",kind:"primary",enabled:e&&se(o),...e?{}:{reason:"Review or redraw this area first"}}}return{id:"choose-cleaning",label:"Choose what to clean",kind:"neutral",enabled:!1,reason:"Choose rooms, a plan, or a custom area"}},Kt=o=>o.activity==="paused"?{id:"stop",label:"Stop",kind:"danger",enabled:o.command==="idle"}:null,dn=o=>o.draw.brushMeters*64*(o.draw.zoomPercent/100),po=[2,1,.5,.25,.1,.05],Yt=o=>{let e=64*(o.draw.zoomPercent/100),t=po.reduce((r,n)=>{let a=Math.abs(n*e-64),i=Math.abs(r*e-64);return a<i?n:r});return{meters:t,pixels:t*e,label:t<1?`${Math.round(t*100)} cm`:`${t} m`}},un=(o,e)=>({...o,command:e});var Gt="a".repeat(64),de=[{roomId:"room-a",name:"Kitchen",boundary:[[.5,.5],[4,.5],[4,3],[.5,3]]},{roomId:"room-b",name:"Living room",boundary:[[4.2,.5],[8.5,.5],[8.5,3.4],[4.2,3.4]]},{roomId:"room-c",name:"Office",boundary:[[.5,3.2],[3.8,3.2],[3.8,6.5],[.5,6.5]]},{roomId:"room-d",name:"Bedroom",boundary:[[4,3.6],[8.5,3.6],[8.5,6.5],[4,6.5]]}],jt=()=>{let o=[180,140],e={meters_per_cell:.05,origin_cells:[0,0],span_cells:o,sample_step:1,rooms:de.map(c=>{let d=c.boundary.map(([h,p])=>[h/.05,p/.05]),u=[d.reduce((h,[p])=>h+p,0)/d.length,d.reduce((h,[,p])=>h+p,0)/d.length];return{name:c.name,boundary:d,boundary_closed:!0,center:u}})},t=new TextEncoder().encode(JSON.stringify(e)),r=[];for(let c=10;c<130;c+=2)for(let d=10;d<170;d+=2){let u=d<80?c<65?0:2:c<72?1:3,h=[[185,219,224],[201,211,233],[210,226,194],[232,207,207]][u]||[190,205,215];r.push([d,c,0,...h])}let n=500;for(let c=0;c<n;c+=1){let d=c%4,u=c*7%120,h=d<2?d===0?10:168:10+u,p=d>=2?d===2?10:128:10+u;r.push([h,p,10+c%18,104,122,137])}let a=r.length-n,i=new ArrayBuffer(24+t.byteLength+r.length*8),s=new DataView(i);new Uint8Array(i,0,8).set(new TextEncoder().encode("MATIC3D\0")),s.setUint16(8,1,!0),s.setUint16(10,8,!0),s.setUint32(12,t.byteLength,!0),s.setUint32(16,a,!0),s.setUint32(20,n,!0),new Uint8Array(i,24,t.byteLength).set(t);let l=new DataView(i,24+t.byteLength);return r.forEach(([c=0,d=0,u=0,h=0,p=0,g=0],_)=>{let w=_*8;l.setUint16(w,c,!0),l.setUint16(w+2,d,!0),l.setUint8(w+4,u),l.setUint8(w+5,h),l.setUint8(w+6,p),l.setUint8(w+7,g)}),{buffer:i,pointOffset:24+t.byteLength,floorCount:a,surfaceCount:n,total:r.length,revision:7,etag:'"synthetic-scene"',source:"live",metadata:{metersPerCell:.05,origin:[0,0],span:o,sampleStep:1,rooms:e.rooms.map((c,d)=>({id:de[d]?.roomId||`room-${d}`,name:c.name,boundary:c.boundary,center:c.center}))}}},De=()=>({entryId:"synthetic-entry",sceneUrl:"/api/matic_robot/slam_scene/synthetic",deltaUrl:"/api/matic_robot/slam_delta/synthetic",poseUrl:"/api/matic_robot/slam_pose/synthetic",historyUrl:"/api/matic_robot/slam_history/synthetic",areasUrl:"/api/matic_robot/areas/synthetic",plansUrl:"/api/matic_robot/plans/synthetic",mapRevision:7,mapFloorCoherent:!0,mapSessionVerified:!0,mapSessionKey:Gt,mapBlockReason:null,runnerLocked:!1,stopSettlePending:!1,activePlan:!1,nativeReconciliationPending:!1,nativeSessionActive:!1,mapComplete:!0,mapTruncated:!1,selectedFloorOrdinal:1,mapFloorOrdinal:1,historyCount:2,historyFloorCount:2,health:"ready",streamFailures:0,bootstrapState:"complete",bootstrapPhotoSeen:!0,bootstrapStructureSeen:!0,bootstrapFailures:0}),it=()=>({rooms:de.map(({roomId:o,name:e})=>({roomId:o,name:e})),selectedPlan:"daily",plans:[{id:"daily",name:"Daily clean",enabled:!0,runBehavior:"intelligent",rooms:de.slice(0,3).map(({roomId:o})=>({roomId:o,cleaningMode:"vacuum",coverageSetting:"standard"})),roomOrder:de.slice(0,3).map(({roomId:o})=>o),returnToBase:!0,finishCurrentRoom:!1,finishCurrentRoomThreshold:50}]}),st=()=>({sceneUrl:De().sceneUrl,rooms:de.map(o=>({...o,boundary:o.boundary.map(e=>[...e])})),areas:[{id:"entryway",name:"Entryway",circles:[{x:1.5,y:1.4,radius:.3},{x:1.9,y:1.6,radius:.3}],cleaningMode:"vacuum",coverageSetting:"standard",status:"current",canRebind:!1}]}),Zt=()=>({entryId:"synthetic-entry",liveAvailable:!0,floors:[{id:"current",active:!0,readOnly:!1,liveAvailable:!0,label:"House",ordinal:null,snapshots:[{id:"current-old",createdAt:"2026-08-29T14:00:00Z",revision:6,pointCount:5300,sceneUrl:"/synthetic-history-current-old"},{id:"current-new",createdAt:"2026-08-29T16:12:00Z",revision:7,pointCount:5300,sceneUrl:"/synthetic-history-current-new"}]},{id:"saved-1",active:!1,readOnly:!0,liveAvailable:!1,label:"Shed",ordinal:2,snapshots:[{id:"saved-one",createdAt:"2026-08-28T11:30:00Z",revision:3,pointCount:3100,sceneUrl:"/synthetic-history-saved"}]},{id:"saved-2",active:!1,readOnly:!0,liveAvailable:!1,label:"Annex",ordinal:3,snapshots:[]}]}),Qt=()=>({position:[4.475,3.475],source:"latest_pose",revision:7,poseRevision:4,floorCoherent:!0,mapSessionKey:Gt,freshness:"live"});var mo=()=>({...M(),coherence:"current",activity:"docked",batteryPercent:92,robots:[{entryId:"synthetic-entry",label:"Matic robot"}],host:{connected:!0,administrator:!0,robotConnected:!0,robotCount:1},floor:{classifiedCount:2,displayName:"House",readOnly:!1},map:{available:!0,complete:!0,floorCoherent:!0,sessionVerified:!0,exactPose:!0},resources:{catalog:{status:"ready",value:[De()],problem:null},entry:De(),scene:{status:"ready",value:jt(),problem:null},pose:{status:"ready",value:Qt(),problem:null},history:{status:"ready",value:Zt(),problem:null},plans:{status:"ready",value:it(),problem:null},areas:{status:"ready",value:st(),problem:null}},selection:{...M().selection,entryId:"synthetic-entry",planId:"daily"},planDraft:{...M().planDraft,id:"daily",name:"Daily clean",rooms:it().plans[0]?.rooms||[]}}),lt=o=>{let e=mo();switch(o){case"ready":return e;case"cleaning":return{...e,activity:"cleaning"};case"paused":return{...e,activity:"paused"};case"returning":return{...e,activity:"returning"};case"recharging":return{...e,activity:"recharging",batteryPercent:18};case"rooms":return{...e,workflow:"rooms"};case"draw":return{...e,workflow:"draw",areaDraft:{...e.areaDraft,id:"entryway",name:"Entryway",status:"current"},selection:{...e.selection,areaId:"entryway"},draw:{...e.draw,dirty:!0,strokeCount:3,circles:st().areas[0]?.circles||[]}};case"history":return{...e,dataMode:"history",workflow:"history",floor:{...e.floor,readOnly:!0},map:{...e.map,exactPose:!1},selection:{...e.selection,floorId:"saved-1",historyId:"saved-one"}};case"transition":return{...e,coherence:"verifying",activity:"unknown",map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1}};case"problem":return{...e,activity:"problem",coherence:"blocked"};case"ha-offline":return{...e,coherence:"degraded",host:{...e.host,connected:!1},map:{...e.map,exactPose:!1}};case"robot-offline":return{...e,coherence:"degraded",host:{...e.host,robotConnected:!1},map:{...e.map,exactPose:!1}};case"access":return{...e,coherence:"blocked",host:{...e.host,administrator:!1},map:{...e.map,available:!1,exactPose:!1}};case"empty":return{...e,coherence:"unavailable",host:{...e.host,robotConnected:!1,robotCount:0},map:{...e.map,available:!1,exactPose:!1}};case"unsupported":return{...e,coherence:"blocked",map:{...e.map,available:!1,exactPose:!1}};case"multi-robot":return{...e,host:{...e.host,robotCount:2},robots:[{entryId:"synthetic-entry",label:"Matic robot"},{entryId:"synthetic-entry-two",label:"Second robot"}]}}},ct=["ready","cleaning","paused","returning","recharging","rooms","draw","history","transition","problem","ha-offline","robot-offline","access","empty","unsupported","multi-robot"];var fo=(o,e)=>{if(e?.recharge_and_resume===!0&&e?.charging===!0)return"recharging";switch(o){case"cleaning":return"cleaning";case"paused":return"paused";case"returning":return"returning";case"docked":return"docked";case"idle":return"idle";case"error":return"problem";default:return"unknown"}},yo=o=>typeof o!="number"||!Number.isFinite(o)?null:Math.round(Math.max(0,Math.min(100,o))),bo=o=>{let e=o.attributes?.matic_entry_id;return typeof e=="string"&&e.length>0?e:null},go=o=>String(o||"local-user").replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",Jt=o=>{if(typeof o!="string")return"Matic robot";let e=o.trim();return e&&Array.from(e).length<=128&&!/[\u0000-\u001f\u007f]/u.test(e)?e:"Matic robot"},Oe=class{#e="";#t=null;project(e,t,r=null){let n=e?.states??{},a=t?.config?.entry_id,i=typeof a=="string"?a:null,s=null,l=null,c=null,d=new Map;for(let[k,I]of Object.entries(n)){let P=bo(I);if(!P||!k.startsWith("vacuum."))continue;d.set(P,{entryId:P,label:Jt(I.attributes?.friendly_name)});let Ee=r||i;(!s||Ee&&P===Ee)&&(s=I,l=k,c=P)}let u={connected:e?.connected!==!1,administrator:e?.user?.is_admin===!0,robotConnected:s!==null&&s.state!=="unavailable"&&s.state!=="unknown",robotCount:d.size},h=s?fo(s.state,s.attributes):"unknown",p=yo(s?.attributes?.battery_level),g=e?.selectedLanguage||e?.language||"en",_=go(e?.user?.id),w=Jt(s?.attributes?.friendly_name),b=[...d.values()].sort((k,I)=>k.label.localeCompare(I.label,g,{sensitivity:"base"})),C=[u.connected,u.administrator,u.robotConnected,u.robotCount,h,p??"none",g,_,l??"none",c??"none",w,b.map(k=>`${k.entryId}:${k.label}`).join(",")].join("|");return C===this.#e&&this.#t?this.#t:(this.#e=C,this.#t={host:u,activity:h,batteryPercent:p,language:g,userKey:_,vacuumEntityId:l,entryKey:c,robotLabel:w,robots:b},this.#t)}};var Ne=globalThis,We=Ne.ShadowRoot&&(Ne.ShadyCSS===void 0||Ne.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,dt=Symbol(),er=new WeakMap,ve=class{constructor(e,t,r){if(this._$cssResult$=!0,r!==dt)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=e,this.t=t}get styleSheet(){let e=this.o,t=this.t;if(We&&e===void 0){let r=t!==void 0&&t.length===1;r&&(e=er.get(t)),e===void 0&&((this.o=e=new CSSStyleSheet).replaceSync(this.cssText),r&&er.set(t,e))}return e}toString(){return this.cssText}},tr=o=>new ve(typeof o=="string"?o:o+"",void 0,dt),N=(o,...e)=>{let t=o.length===1?o[0]:e.reduce((r,n,a)=>r+(i=>{if(i._$cssResult$===!0)return i.cssText;if(typeof i=="number")return i;throw Error("Value passed to 'css' function must be a 'css' function result: "+i+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(n)+o[a+1],o[0]);return new ve(t,o,dt)},rr=(o,e)=>{if(We)o.adoptedStyleSheets=e.map(t=>t instanceof CSSStyleSheet?t:t.styleSheet);else for(let t of e){let r=document.createElement("style"),n=Ne.litNonce;n!==void 0&&r.setAttribute("nonce",n),r.textContent=t.cssText,o.appendChild(r)}},ut=We?o=>o:o=>o instanceof CSSStyleSheet?(e=>{let t="";for(let r of e.cssRules)t+=r.cssText;return tr(t)})(o):o;var{is:vo,defineProperty:wo,getOwnPropertyDescriptor:_o,getOwnPropertyNames:ko,getOwnPropertySymbols:So,getPrototypeOf:xo}=Object,Ue=globalThis,or=Ue.trustedTypes,$o=or?or.emptyScript:"",Co=Ue.reactiveElementPolyfillSupport,we=(o,e)=>o,ht={toAttribute(o,e){switch(e){case Boolean:o=o?$o:null;break;case Object:case Array:o=o==null?o:JSON.stringify(o)}return o},fromAttribute(o,e){let t=o;switch(e){case Boolean:t=o!==null;break;case Number:t=o===null?null:Number(o);break;case Object:case Array:try{t=JSON.parse(o)}catch{t=null}}return t}},ar=(o,e)=>!vo(o,e),nr={attribute:!0,type:String,converter:ht,reflect:!1,useDefault:!1,hasChanged:ar};Symbol.metadata??=Symbol("metadata"),Ue.litPropertyMetadata??=new WeakMap;var X=class extends HTMLElement{static addInitializer(e){this._$Ei(),(this.l??=[]).push(e)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(e,t=nr){if(t.state&&(t.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(e)&&((t=Object.create(t)).wrapped=!0),this.elementProperties.set(e,t),!t.noAccessor){let r=Symbol(),n=this.getPropertyDescriptor(e,r,t);n!==void 0&&wo(this.prototype,e,n)}}static getPropertyDescriptor(e,t,r){let{get:n,set:a}=_o(this.prototype,e)??{get(){return this[t]},set(i){this[t]=i}};return{get:n,set(i){let s=n?.call(this);a?.call(this,i),this.requestUpdate(e,s,r)},configurable:!0,enumerable:!0}}static getPropertyOptions(e){return this.elementProperties.get(e)??nr}static _$Ei(){if(this.hasOwnProperty(we("elementProperties")))return;let e=xo(this);e.finalize(),e.l!==void 0&&(this.l=[...e.l]),this.elementProperties=new Map(e.elementProperties)}static finalize(){if(this.hasOwnProperty(we("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(we("properties"))){let t=this.properties,r=[...ko(t),...So(t)];for(let n of r)this.createProperty(n,t[n])}let e=this[Symbol.metadata];if(e!==null){let t=litPropertyMetadata.get(e);if(t!==void 0)for(let[r,n]of t)this.elementProperties.set(r,n)}this._$Eh=new Map;for(let[t,r]of this.elementProperties){let n=this._$Eu(t,r);n!==void 0&&this._$Eh.set(n,t)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(e){let t=[];if(Array.isArray(e)){let r=new Set(e.flat(1/0).reverse());for(let n of r)t.unshift(ut(n))}else e!==void 0&&t.push(ut(e));return t}static _$Eu(e,t){let r=t.attribute;return r===!1?void 0:typeof r=="string"?r:typeof e=="string"?e.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){this._$ES=new Promise(e=>this.enableUpdating=e),this._$AL=new Map,this._$E_(),this.requestUpdate(),this.constructor.l?.forEach(e=>e(this))}addController(e){(this._$EO??=new Set).add(e),this.renderRoot!==void 0&&this.isConnected&&e.hostConnected?.()}removeController(e){this._$EO?.delete(e)}_$E_(){let e=new Map,t=this.constructor.elementProperties;for(let r of t.keys())this.hasOwnProperty(r)&&(e.set(r,this[r]),delete this[r]);e.size>0&&(this._$Ep=e)}createRenderRoot(){let e=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return rr(e,this.constructor.elementStyles),e}connectedCallback(){this.renderRoot??=this.createRenderRoot(),this.enableUpdating(!0),this._$EO?.forEach(e=>e.hostConnected?.())}enableUpdating(e){}disconnectedCallback(){this._$EO?.forEach(e=>e.hostDisconnected?.())}attributeChangedCallback(e,t,r){this._$AK(e,r)}_$ET(e,t){let r=this.constructor.elementProperties.get(e),n=this.constructor._$Eu(e,r);if(n!==void 0&&r.reflect===!0){let a=(r.converter?.toAttribute!==void 0?r.converter:ht).toAttribute(t,r.type);this._$Em=e,a==null?this.removeAttribute(n):this.setAttribute(n,a),this._$Em=null}}_$AK(e,t){let r=this.constructor,n=r._$Eh.get(e);if(n!==void 0&&this._$Em!==n){let a=r.getPropertyOptions(n),i=typeof a.converter=="function"?{fromAttribute:a.converter}:a.converter?.fromAttribute!==void 0?a.converter:ht;this._$Em=n;let s=i.fromAttribute(t,a.type);this[n]=s??this._$Ej?.get(n)??s,this._$Em=null}}requestUpdate(e,t,r,n=!1,a){if(e!==void 0){let i=this.constructor;if(n===!1&&(a=this[e]),r??=i.getPropertyOptions(e),!((r.hasChanged??ar)(a,t)||r.useDefault&&r.reflect&&a===this._$Ej?.get(e)&&!this.hasAttribute(i._$Eu(e,r))))return;this.C(e,t,r)}this.isUpdatePending===!1&&(this._$ES=this._$EP())}C(e,t,{useDefault:r,reflect:n,wrapped:a},i){r&&!(this._$Ej??=new Map).has(e)&&(this._$Ej.set(e,i??t??this[e]),a!==!0||i!==void 0)||(this._$AL.has(e)||(this.hasUpdated||r||(t=void 0),this._$AL.set(e,t)),n===!0&&this._$Em!==e&&(this._$Eq??=new Set).add(e))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(t){Promise.reject(t)}let e=this.scheduleUpdate();return e!=null&&await e,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??=this.createRenderRoot(),this._$Ep){for(let[n,a]of this._$Ep)this[n]=a;this._$Ep=void 0}let r=this.constructor.elementProperties;if(r.size>0)for(let[n,a]of r){let{wrapped:i}=a,s=this[n];i!==!0||this._$AL.has(n)||s===void 0||this.C(n,void 0,a,s)}}let e=!1,t=this._$AL;try{e=this.shouldUpdate(t),e?(this.willUpdate(t),this._$EO?.forEach(r=>r.hostUpdate?.()),this.update(t)):this._$EM()}catch(r){throw e=!1,this._$EM(),r}e&&this._$AE(t)}willUpdate(e){}_$AE(e){this._$EO?.forEach(t=>t.hostUpdated?.()),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(e)),this.updated(e)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(e){return!0}update(e){this._$Eq&&=this._$Eq.forEach(t=>this._$ET(t,this[t])),this._$EM()}updated(e){}firstUpdated(e){}};X.elementStyles=[],X.shadowRootOptions={mode:"open"},X[we("elementProperties")]=new Map,X[we("finalized")]=new Map,Co?.({ReactiveElement:X}),(Ue.reactiveElementVersions??=[]).push("2.1.2");var vt=globalThis,ir=o=>o,He=vt.trustedTypes,sr=He?He.createPolicy("lit-html",{createHTML:o=>o}):void 0,pr="$lit$",Y=`lit$${Math.random().toFixed(9).slice(2)}$`,mr="?"+Y,Mo=`<${mr}>`,J=document,ke=()=>J.createComment(""),Se=o=>o===null||typeof o!="object"&&typeof o!="function",wt=Array.isArray,Ao=o=>wt(o)||typeof o?.[Symbol.iterator]=="function",pt=`[ \t\n\f\r]`,_e=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,lr=/-->/g,cr=/>/g,Z=RegExp(`>|${pt}(?:([^\\s"'>=/]+)(${pt}*=${pt}*(?:[^ \t\n\f\r"'\`<>=]|("|')|))|$)`,"g"),dr=/'/g,ur=/"/g,fr=/^(?:script|style|textarea|title)$/i,_t=o=>(e,...t)=>({_$litType$:o,strings:e,values:t}),A=_t(1),yr=_t(2),br=_t(3),ee=Symbol.for("lit-noChange"),m=Symbol.for("lit-nothing"),hr=new WeakMap,Q=J.createTreeWalker(J,129);function gr(o,e){if(!wt(o)||!o.hasOwnProperty("raw"))throw Error("invalid template strings array");return sr!==void 0?sr.createHTML(e):e}var Po=(o,e)=>{let t=o.length-1,r=[],n,a=e===2?"<svg>":e===3?"<math>":"",i=_e;for(let s=0;s<t;s++){let l=o[s],c,d,u=-1,h=0;for(;h<l.length&&(i.lastIndex=h,d=i.exec(l),d!==null);)h=i.lastIndex,i===_e?d[1]==="!--"?i=lr:d[1]!==void 0?i=cr:d[2]!==void 0?(fr.test(d[2])&&(n=RegExp("</"+d[2],"g")),i=Z):d[3]!==void 0&&(i=Z):i===Z?d[0]===">"?(i=n??_e,u=-1):d[1]===void 0?u=-2:(u=i.lastIndex-d[2].length,c=d[1],i=d[3]===void 0?Z:d[3]==='"'?ur:dr):i===ur||i===dr?i=Z:i===lr||i===cr?i=_e:(i=Z,n=void 0);let p=i===Z&&o[s+1].startsWith("/>")?" ":"";a+=i===_e?l+Mo:u>=0?(r.push(c),l.slice(0,u)+pr+l.slice(u)+Y+p):l+Y+(u===-2?s:p)}return[gr(o,a+(o[t]||"<?>")+(e===2?"</svg>":e===3?"</math>":"")),r]},xe=class o{constructor({strings:e,_$litType$:t},r){let n;this.parts=[];let a=0,i=0,s=e.length-1,l=this.parts,[c,d]=Po(e,t);if(this.el=o.createElement(c,r),Q.currentNode=this.el.content,t===2||t===3){let u=this.el.content.firstChild;u.replaceWith(...u.childNodes)}for(;(n=Q.nextNode())!==null&&l.length<s;){if(n.nodeType===1){if(n.hasAttributes())for(let u of n.getAttributeNames())if(u.endsWith(pr)){let h=d[i++],p=n.getAttribute(u).split(Y),g=/([.?@])?(.*)/.exec(h);l.push({type:1,index:a,name:g[2],strings:p,ctor:g[1]==="."?ft:g[1]==="?"?yt:g[1]==="@"?bt:he}),n.removeAttribute(u)}else u.startsWith(Y)&&(l.push({type:6,index:a}),n.removeAttribute(u));if(fr.test(n.tagName)){let u=n.textContent.split(Y),h=u.length-1;if(h>0){n.textContent=He?He.emptyScript:"";for(let p=0;p<h;p++)n.append(u[p],ke()),Q.nextNode(),l.push({type:2,index:++a});n.append(u[h],ke())}}}else if(n.nodeType===8)if(n.data===mr)l.push({type:2,index:a});else{let u=-1;for(;(u=n.data.indexOf(Y,u+1))!==-1;)l.push({type:7,index:a}),u+=Y.length-1}a++}}static createElement(e,t){let r=J.createElement("template");return r.innerHTML=e,r}};function ue(o,e,t=o,r){if(e===ee)return e;let n=r!==void 0?t._$Co?.[r]:t._$Cl,a=Se(e)?void 0:e._$litDirective$;return n?.constructor!==a&&(n?._$AO?.(!1),a===void 0?n=void 0:(n=new a(o),n._$AT(o,t,r)),r!==void 0?(t._$Co??=[])[r]=n:t._$Cl=n),n!==void 0&&(e=ue(o,n._$AS(o,e.values),n,r)),e}var mt=class{constructor(e,t){this._$AV=[],this._$AN=void 0,this._$AD=e,this._$AM=t}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(e){let{el:{content:t},parts:r}=this._$AD,n=(e?.creationScope??J).importNode(t,!0);Q.currentNode=n;let a=Q.nextNode(),i=0,s=0,l=r[0];for(;l!==void 0;){if(i===l.index){let c;l.type===2?c=new $e(a,a.nextSibling,this,e):l.type===1?c=new l.ctor(a,l.name,l.strings,this,e):l.type===6&&(c=new gt(a,this,e)),this._$AV.push(c),l=r[++s]}i!==l?.index&&(a=Q.nextNode(),i++)}return Q.currentNode=J,n}p(e){let t=0;for(let r of this._$AV)r!==void 0&&(r.strings!==void 0?(r._$AI(e,r,t),t+=r.strings.length-2):r._$AI(e[t])),t++}},$e=class o{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(e,t,r,n){this.type=2,this._$AH=m,this._$AN=void 0,this._$AA=e,this._$AB=t,this._$AM=r,this.options=n,this._$Cv=n?.isConnected??!0}get parentNode(){let e=this._$AA.parentNode,t=this._$AM;return t!==void 0&&e?.nodeType===11&&(e=t.parentNode),e}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(e,t=this){e=ue(this,e,t),Se(e)?e===m||e==null||e===""?(this._$AH!==m&&this._$AR(),this._$AH=m):e!==this._$AH&&e!==ee&&this._(e):e._$litType$!==void 0?this.$(e):e.nodeType!==void 0?this.T(e):Ao(e)?this.k(e):this._(e)}O(e){return this._$AA.parentNode.insertBefore(e,this._$AB)}T(e){this._$AH!==e&&(this._$AR(),this._$AH=this.O(e))}_(e){this._$AH!==m&&Se(this._$AH)?this._$AA.nextSibling.data=e:this.T(J.createTextNode(e)),this._$AH=e}$(e){let{values:t,_$litType$:r}=e,n=typeof r=="number"?this._$AC(e):(r.el===void 0&&(r.el=xe.createElement(gr(r.h,r.h[0]),this.options)),r);if(this._$AH?._$AD===n)this._$AH.p(t);else{let a=new mt(n,this),i=a.u(this.options);a.p(t),this.T(i),this._$AH=a}}_$AC(e){let t=hr.get(e.strings);return t===void 0&&hr.set(e.strings,t=new xe(e)),t}k(e){wt(this._$AH)||(this._$AH=[],this._$AR());let t=this._$AH,r,n=0;for(let a of e)n===t.length?t.push(r=new o(this.O(ke()),this.O(ke()),this,this.options)):r=t[n],r._$AI(a),n++;n<t.length&&(this._$AR(r&&r._$AB.nextSibling,n),t.length=n)}_$AR(e=this._$AA.nextSibling,t){for(this._$AP?.(!1,!0,t);e!==this._$AB;){let r=ir(e).nextSibling;ir(e).remove(),e=r}}setConnected(e){this._$AM===void 0&&(this._$Cv=e,this._$AP?.(e))}},he=class{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(e,t,r,n,a){this.type=1,this._$AH=m,this._$AN=void 0,this.element=e,this.name=t,this._$AM=n,this.options=a,r.length>2||r[0]!==""||r[1]!==""?(this._$AH=Array(r.length-1).fill(new String),this.strings=r):this._$AH=m}_$AI(e,t=this,r,n){let a=this.strings,i=!1;if(a===void 0)e=ue(this,e,t,0),i=!Se(e)||e!==this._$AH&&e!==ee,i&&(this._$AH=e);else{let s=e,l,c;for(e=a[0],l=0;l<a.length-1;l++)c=ue(this,s[r+l],t,l),c===ee&&(c=this._$AH[l]),i||=!Se(c)||c!==this._$AH[l],c===m?e=m:e!==m&&(e+=(c??"")+a[l+1]),this._$AH[l]=c}i&&!n&&this.j(e)}j(e){e===m?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,e??"")}},ft=class extends he{constructor(){super(...arguments),this.type=3}j(e){this.element[this.name]=e===m?void 0:e}},yt=class extends he{constructor(){super(...arguments),this.type=4}j(e){this.element.toggleAttribute(this.name,!!e&&e!==m)}},bt=class extends he{constructor(e,t,r,n,a){super(e,t,r,n,a),this.type=5}_$AI(e,t=this){if((e=ue(this,e,t,0)??m)===ee)return;let r=this._$AH,n=e===m&&r!==m||e.capture!==r.capture||e.once!==r.once||e.passive!==r.passive,a=e!==m&&(r===m||n);n&&this.element.removeEventListener(this.name,this,r),a&&this.element.addEventListener(this.name,this,e),this._$AH=e}handleEvent(e){typeof this._$AH=="function"?this._$AH.call(this.options?.host??this.element,e):this._$AH.handleEvent(e)}},gt=class{constructor(e,t,r){this.element=e,this.type=6,this._$AN=void 0,this._$AM=t,this.options=r}get _$AU(){return this._$AM._$AU}_$AI(e){ue(this,e)}};var Eo=vt.litHtmlPolyfillSupport;Eo?.(xe,$e),(vt.litHtmlVersions??=[]).push("3.3.3");var vr=(o,e,t)=>{let r=t?.renderBefore??e,n=r._$litPart$;if(n===void 0){let a=t?.renderBefore??null;r._$litPart$=n=new $e(e.insertBefore(ke(),a),a,void 0,t??{})}return n._$AI(o),n};var kt=globalThis,x=class extends X{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){let e=super.createRenderRoot();return this.renderOptions.renderBefore??=e.firstChild,e}update(e){let t=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(e),this._$Do=vr(t,this.renderRoot,this.renderOptions)}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(!0)}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(!1)}render(){return ee}};x._$litElement$=!0,x.finalized=!0,kt.litElementHydrateSupport?.({LitElement:x});var Ro=kt.litElementPolyfillSupport;Ro?.({LitElement:x});(kt.litElementVersions??=[]).push("4.2.2");var _r=Symbol.for(""),Io=o=>{if(o?.r===_r)return o?._$litStatic$},U=o=>({_$litStatic$:o,r:_r});var wr=new Map,St=o=>(e,...t)=>{let r=t.length,n,a,i=[],s=[],l,c=0,d=!1;for(;c<r;){for(l=e[c];c<r&&(a=t[c],(n=Io(a))!==void 0);)l+=n+e[++c],d=!0;c!==r&&s.push(a),i.push(l),c++}if(c===r&&i.push(e[r]),d){let u=i.join("$$lit$$");(e=wr.get(u))===void 0&&(i.raw=i,wr.set(u,e=i)),t=s}return o(e,...t)},f=St(A),zn=St(yr),Dn=St(br);var kr=import.meta.url.match(/\/matic_robot\/[^/]+-([a-f0-9]{12})\/map-studio-v4(?:\/|$)/u)?.[1]??"dev",Ce=kr==="dev"?"":`-${kr}`,Me=`matic-map-canvas-v4${Ce}`,te=`matic-precision-controls-v4${Ce}`,pe=`matic-map-workflow-v4${Ce}`,re=`matic-map-shell-v4${Ce}`,xt=`matic-map-panel-v0-4-0${Ce}`;var Sr=(o,e)=>Math.hypot(o.x-e.x,o.y-e.y),xr=(o,e)=>({x:(o.x+e.x)/2,y:(o.y+e.y)/2}),$r=(o,e)=>Math.atan2(e.y-o.y,e.x-o.x),Lo=o=>{let e=o;for(;e>Math.PI;)e-=Math.PI*2;for(;e<-Math.PI;)e+=Math.PI*2;return e},oe=(o,e,t)=>Math.max(e,Math.min(t,o)),$t=o=>o.map(e=>({...e})),me=o=>o instanceof Element&&!!o.closest("button, input, select, textarea, a, [role='button'], [role='menuitem']"),Fe=class{#e;#t;#a;#r=new Map;#n=!1;#o="idle";#c=[];#d=[];#u=null;#s=0;#m=null;#b=0;#w=null;#h=null;#_=null;#f=0;#l=null;#v=!1;#$=null;#x=!1;constructor(e,t,r){this.#e=e,this.#t=t,this.#a=r,e.addEventListener("pointerdown",this.#i),e.addEventListener("pointermove",this.#y),e.addEventListener("pointerup",this.#g),e.addEventListener("pointercancel",this.#g),e.addEventListener("wheel",this.#E,{passive:!1}),e.addEventListener("gesturestart",this.#C,{passive:!1}),e.addEventListener("gesturechange",this.#M,{passive:!1}),e.addEventListener("gestureend",this.#A,{passive:!1}),e.addEventListener("dblclick",this.#L),e.addEventListener("contextmenu",this.#P),e.addEventListener("keydown",this.#k),e.addEventListener("keyup",this.#I),e.addEventListener("blur",this.#R)}#i=e=>{if(this.#x||!e.isPrimary&&e.pointerType==="mouse"||me(e.target))return;this.#e.focus({preventScroll:!0}),this.#T();let t=performance.now(),r={id:e.pointerId,type:e.pointerType,startX:e.clientX,startY:e.clientY,x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,lastTime:t,velocityX:0,velocityY:0};if(this.#r.set(e.pointerId,r),this.#e.setPointerCapture?.(e.pointerId),this.#r.size>=2){this.#z(),(this.#o==="paint"||this.#o==="erase")&&(this.#d=$t(this.#c),this.#a.onCircles(this.#d,!1)),this.#o="pinch",this.#e.classList.add("navigating"),this.#v=!0;let[s,l]=[...this.#r.values()];s&&l&&(this.#s=Math.max(1,Sr(s,l)),this.#m=xr(s,l),this.#b=$r(s,l),this.#w=this.#t.camera),e.preventDefault();return}let n=this.#a.state(),a=n.workflow==="draw"&&n.map.available&&!n.floor.readOnly;this.#v||this.#n||e.button===1||e.button===2||n.draw.tool==="pan"?(this.#o="pan",this.#h=this.#t.camera):a&&(n.draw.tool==="paint"||n.draw.tool==="erase")?(this.#c=$t(n.draw.circles),this.#d=$t(n.draw.circles),e.pointerType==="touch"?(this.#o="idle",this.#$=window.setTimeout(()=>{if(this.#$=null,this.#r.size!==1||this.#v)return;this.#o=n.draw.tool;let s=this.#r.get(e.pointerId);s&&this.#p(s.x,s.y)},110)):(this.#o=n.draw.tool,this.#p(e.clientX,e.clientY))):(this.#o=n.view==="three"&&!e.shiftKey?"orbit":"pan",this.#h=this.#t.camera),(this.#o==="pan"||this.#o==="orbit")&&this.#e.classList.add("navigating"),e.preventDefault()};#y=e=>{let t=this.#r.get(e.pointerId);if(!t){let d=this.#t.screenToMap(e.clientX,e.clientY);this.#t.setCursor(d);return}let n=(e.getCoalescedEvents?.()||[]).at(-1)||e,a=performance.now(),i=Math.max(1,a-t.lastTime),s=(n.clientX-t.lastX)/i,l=(n.clientY-t.lastY)/i;if(t.velocityX=t.velocityX*.62+s*.38,t.velocityY=t.velocityY*.62+l*.38,t.lastX=n.clientX,t.lastY=n.clientY,t.lastTime=a,t.x=n.clientX,t.y=n.clientY,this.#o==="pinch"&&this.#r.size>=2){let[d,u]=[...this.#r.values()];if(!d||!u)return;let h=Math.max(1,Sr(d,u)),p=xr(d,u),g=$r(d,u),_=this.#w;if(_&&this.#m){let w={..._,distance:_.distance*this.#s/h,yaw:_.yaw+Lo(g-this.#b),pitch:_.orthographic?_.pitch:_.pitch-(p.y-this.#m.y)*.0035};this.#t.setCamera(this.#t.cameraAfterPan(w,p.x-this.#m.x,p.y-this.#m.y))}e.preventDefault();return}this.#o==="paint"||this.#o==="erase"?this.#p(e.clientX,e.clientY):this.#o==="pan"?this.#h&&this.#t.setCamera(this.#t.cameraAfterPan(this.#h,n.clientX-t.startX,n.clientY-t.startY)):this.#o==="orbit"&&this.#h&&this.#t.setCamera({...this.#h,yaw:this.#h.yaw+(n.clientX-t.startX)*.0045,pitch:this.#h.pitch-(n.clientY-t.startY)*.004});let c=this.#t.screenToMap(n.clientX,n.clientY);this.#t.setCursor(c),e.preventDefault()};#g=e=>{let t=this.#r.get(e.pointerId);if(!t)return;let r=this.#o;if(this.#r.delete(e.pointerId),this.#e.releasePointerCapture?.(e.pointerId),this.#z(),(this.#o==="paint"||this.#o==="erase")&&JSON.stringify(this.#d)!==JSON.stringify(this.#c))this.#a.onCircles(this.#d,!0,this.#c);else if(this.#o!=="pinch"&&!this.#v&&Math.hypot(t.x-t.startX,t.y-t.startY)<7&&this.#a.state().workflow==="rooms"){let n=this.#t.roomAt(t.x,t.y);n&&this.#a.onRoom(n)}if(this.#r.size===0)this.#o="idle",this.#e.classList.remove("navigating"),this.#v=!1,this.#m=null,this.#w=null,this.#h=null,this.#u=null,(r==="pan"||r==="orbit")&&t.type!=="mouse"&&this.#W(t.velocityX,t.velocityY,r);else if(this.#o==="pinch"){this.#o="pan",this.#v=!0;let n=this.#r.values().next().value;n&&(n.startX=n.x,n.startY=n.y,n.velocityX=0,n.velocityY=0),this.#h=this.#t.camera,this.#w=null}e.preventDefault()};#p(e,t){let r=this.#t.screenToMap(e,t);if(!r)return;let a=this.#a.state().draw.brushMeters/2;if(this.#o==="erase")this.#d=this.#d.filter(i=>Math.hypot(i.x-r.x,i.y-r.y)>i.radius+a);else{if(!this.#t.containsMapPoint(r))return;let i=Math.max(.04,a*.55),s=this.#u||r,l=Math.hypot(r.x-s.x,r.y-s.y),c=Math.max(1,Math.ceil(l/i));for(let d=0;d<=c&&this.#d.length<512;d+=1){let u=d/c,h={x:s.x+(r.x-s.x)*u,y:s.y+(r.y-s.y)*u};this.#d.some(p=>Math.hypot(p.x-h.x,p.y-h.y)<Math.max(.025,a*.28))||this.#d.push({x:Math.round(h.x*1e4)/1e4,y:Math.round(h.y*1e4)/1e4,radius:Math.round(a*100)/100})}}this.#u=r,this.#a.onCircles(this.#d,!1)}#E=e=>{if(me(e.target))return;e.preventDefault(),this.#e.focus({preventScroll:!0}),this.#T();let t=e.deltaMode===WheelEvent.DOM_DELTA_LINE?16:e.deltaMode===WheelEvent.DOM_DELTA_PAGE?Math.max(1,this.#e.clientHeight):1,r=e.deltaX*t,n=e.deltaY*t;if(e.ctrlKey||e.metaKey){this.#t.zoomAt(Math.exp(oe(-n*.008,-.28,.28)),e.clientX,e.clientY);return}if(e.altKey&&this.#a.state().view==="three"){this.#t.orbitBy(0,oe(n,-80,80)*.75);return}if(e.deltaMode!==WheelEvent.DOM_DELTA_PIXEL||Math.abs(r)<.5&&Math.abs(n)>=50){this.#t.zoomAt(Math.exp(oe(-n*.0025,-.28,.28)),e.clientX,e.clientY);return}this.#t.panBy(-oe(r,-80,80),-oe(n,-80,80))};#C=e=>{this.#x||me(e.target)||(this.#e.focus({preventScroll:!0}),this.#T(),this.#e.classList.add("navigating"),this.#_=this.#t.camera,this.#f=Number.isFinite(e.rotation)?e.rotation:0,e.preventDefault())};#M=e=>{if(this.#x||me(e.target))return;let t=this.#_;if(!t||this.#r.size>=2)return;let r=Number.isFinite(e.scale)&&e.scale>0?Math.max(.1,e.scale):1,n=Number.isFinite(e.rotation)?e.rotation:0;this.#t.setCamera({...t,distance:t.distance/r,yaw:t.yaw+(n-this.#f)*Math.PI/180}),e.preventDefault()};#A=e=>{this.#_=null,this.#f=0,this.#e.classList.remove("navigating"),e.preventDefault()};#k=e=>{if(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey)return;if(e.code==="Space"){this.#n=!0,e.preventDefault();return}this.#T();let t=this.#a.state(),r=e.key.toLocaleLowerCase();if(e.key==="+"||e.key==="=")this.#t.zoomAt(1.25);else if(e.key==="-")this.#t.zoomAt(.8);else if(e.key==="0")this.#t.fit();else if(r==="3")this.#S({type:"set-view",view:"three"});else if(r==="t")this.#S({type:"set-view",view:"top"});else if(e.key==="[")this.#t.orbitBy(-40,0);else if(e.key==="]")this.#t.orbitBy(40,0);else if(e.key==="PageUp")this.#t.orbitBy(0,-30);else if(e.key==="PageDown")this.#t.orbitBy(0,30);else if(r==="d"&&t.workflow==="draw")this.#S({type:"set-draw-tool",tool:"paint"});else if(r==="e"&&t.workflow==="draw")this.#S({type:"set-draw-tool",tool:"erase"});else if(["arrowleft","arrowright","arrowup","arrowdown"].includes(r))if(t.view==="three"&&!e.shiftKey){let n=r==="arrowleft"?-24:r==="arrowright"?24:0,a=r==="arrowup"?-20:r==="arrowdown"?20:0;this.#t.orbitBy(n,a)}else{let n=r==="arrowleft"?30:r==="arrowright"?-30:0,a=r==="arrowup"?30:r==="arrowdown"?-30:0;this.#t.panBy(n,a)}else if(t.workflow!=="draw"&&["w","a","s","d"].includes(r))this.#t.panBy(r==="a"?34:r==="d"?-34:0,r==="w"?34:r==="s"?-34:0);else if(t.workflow!=="draw"&&(r==="q"||r==="e"))this.#t.orbitBy(r==="q"?-30:30,0);else return;e.preventDefault()};#I=e=>{e.code==="Space"&&(this.#n=!1)};#R=()=>{this.#n=!1,this.#z(),this.#t.setCursor(null),this.#e.classList.remove("navigating")};#L=e=>{me(e.target)||(this.#T(),this.#t.zoomAt(e.shiftKey?1/1.6:1.6,e.clientX,e.clientY),e.preventDefault())};#P=e=>{me(e.target)||e.preventDefault()};#S(e){this.#e.dispatchEvent(new CustomEvent("matic-workspace-intent",{detail:e,bubbles:!0,composed:!0}))}#W(e,t,r){if(window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;let n=oe(e,-.55,.55),a=oe(t,-.55,.55);if(Math.hypot(n,a)<.02)return;let i=performance.now(),s=l=>{let c=Math.min(32,l-i);i=l,r==="orbit"?this.#t.orbitBy(n*c,a*c):this.#t.panBy(n*c,a*c);let d=.9**(c/16);n*=d,a*=d,Math.hypot(n,a)>=.01?this.#l=window.requestAnimationFrame(s):this.#l=null};this.#l=window.requestAnimationFrame(s)}#T(){this.#l!==null&&window.cancelAnimationFrame(this.#l),this.#l=null}#z(){this.#$!==null&&window.clearTimeout(this.#$),this.#$=null}dispose(){this.#x||(this.#x=!0,this.#z(),this.#T(),this.#e.removeEventListener("pointerdown",this.#i),this.#e.removeEventListener("pointermove",this.#y),this.#e.removeEventListener("pointerup",this.#g),this.#e.removeEventListener("pointercancel",this.#g),this.#e.removeEventListener("wheel",this.#E),this.#e.removeEventListener("gesturestart",this.#C),this.#e.removeEventListener("gesturechange",this.#M),this.#e.removeEventListener("gestureend",this.#A),this.#e.removeEventListener("dblclick",this.#L),this.#e.removeEventListener("contextmenu",this.#P),this.#e.removeEventListener("keydown",this.#k),this.#e.removeEventListener("keyup",this.#I),this.#e.removeEventListener("blur",this.#R),this.#r.clear())}};var E=(o,e,t)=>Math.max(e,Math.min(t,o)),Ct=o=>{let e=o;for(;e>Math.PI;)e-=Math.PI*2;for(;e<-Math.PI;)e+=Math.PI*2;return e},To=o=>{switch(o){case"efficient":return .35;case"balanced":return .65;case"maximum":case"auto":return 1}},zo=(o,e)=>{let t=new Float32Array(16);for(let r=0;r<4;r+=1)for(let n=0;n<4;n+=1){let a=0;for(let i=0;i<4;i+=1)a+=(o[i*4+n]??0)*(e[r*4+i]??0);t[r*4+n]=a}return t},Do=(o,e,t,r)=>{let n=1/Math.tan(o/2),a=new Float32Array(16);return a[0]=n/e,a[5]=n,a[10]=(r+t)/(t-r),a[11]=-1,a[14]=2*r*t/(t-r),a},Oo=(o,e,t,r,n,a)=>{let i=new Float32Array(16);return i[0]=2/(e-o),i[5]=2/(r-t),i[10]=-2/(a-n),i[12]=-(e+o)/(e-o),i[13]=-(r+t)/(r-t),i[14]=-(a+n)/(a-n),i[15]=1,i},No=(o,e)=>{let t=Math.hypot((o[0]??0)-(e[0]??0),(o[1]??0)-(e[1]??0),(o[2]??0)-(e[2]??0))||1,r=[((o[0]??0)-(e[0]??0))/t,((o[1]??0)-(e[1]??0))/t,((o[2]??0)-(e[2]??0))/t],n=Math.hypot(r[2]??0,r[0]??0)||1,a=[(r[2]??0)/n,0,-(r[0]??0)/n],i=[(r[1]??0)*(a[2]??0),(r[2]??0)*(a[0]??0)-(r[0]??0)*(a[2]??0),-(r[1]??0)*(a[0]??0)];return new Float32Array([a[0]??0,i[0]??0,r[0]??0,0,a[1]??0,i[1]??0,r[1]??0,0,a[2]??0,i[2]??0,r[2]??0,0,-((a[0]??0)*(o[0]??0)+(a[1]??0)*(o[1]??0)+(a[2]??0)*(o[2]??0)),-((i[0]??0)*(o[0]??0)+(i[1]??0)*(o[1]??0)+(i[2]??0)*(o[2]??0)),-((r[0]??0)*(o[0]??0)+(r[1]??0)*(o[1]??0)+(r[2]??0)*(o[2]??0)),1])},Cr=(o,e,t)=>{let r=!1,n=t.at(-1);if(!n)return!1;for(let a of t){let[i,s]=a,[l,c]=n;s>e!=c>e&&o<(l-i)*(e-s)/(c-s)+i&&(r=!r),n=a}return r},Be=class{#e;#t;#a;#r=null;#n=null;#o=null;#c=null;#d=null;#u=null;#s=null;#m=null;#b=null;#w=null;#h=null;#_=null;#f=null;#l=null;#v=null;#$=null;#x;#i={yaw:-Math.PI/4,pitch:.82,distance:12,targetX:0,targetZ:0,orthographic:!1};#y=12;#g=8;#p=4;#E=new Float32Array(16);#C=null;#M="unavailable";#A=0;#k=0;#I=0;#R=0;#L=1;#P={width:1,height:1,left:0,top:0};#S=!1;constructor(e,t,r={}){this.#e=e,this.#t=t,this.#a=r,this.#n=t.getContext("2d",{alpha:!0}),this.#e.addEventListener("webglcontextlost",this.#Y),this.#e.addEventListener("webglcontextrestored",this.#G),this.#B(),this.#x=new ResizeObserver(()=>{this.requestRender()}),this.#x.observe(e)}get camera(){return{...this.#i}}#W(){return{minimum:Math.max(.2,this.#p*.04),maximum:this.#p*8}}#T(){let e=this.#l?.metadata.span,t=this.#l?.metadata.metersPerCell;return!e||t===void 0?{x:this.#p,z:this.#p}:{x:Math.max(.5,e[0]*t*.55),z:Math.max(.5,e[1]*t*.55)}}setCamera(e,t=!0){let r=this.#W(),n=this.#T();this.#i={yaw:Ct(e.yaw),pitch:e.orthographic?Math.PI/2-.018:E(e.pitch,.18,1.38),distance:E(e.distance,r.minimum,r.maximum),targetX:E(e.targetX,-n.x,n.x),targetZ:E(e.targetZ,-n.z,n.z),orthographic:e.orthographic},this.requestRender(),t&&this.#N()}cameraAfterPan(e,t,r){let n=this.#D(),a=e.distance*1.75/Math.max(200,n.height),i=Math.cos(e.yaw),s=-Math.sin(e.yaw),l=-Math.sin(e.yaw),c=-Math.cos(e.yaw),d=this.#T();return{...e,targetX:E(e.targetX-t*a*i+r*a*l,-d.x,d.x),targetZ:E(e.targetZ-t*a*s+r*a*c,-d.z,d.z)}}setState(e){if(this.#S)return;let t=this.#f;this.#f=e;let r=e.resources.scene.value;r!==this.#l&&(this.#l=r,this.#j(r)),(!t||t.quality!==e.quality)&&(this.#L=To(e.quality),this.#R=0);let n=t?.workflow!=="draw"&&e.workflow==="draw",a=t?.workflow==="draw"&&e.workflow!=="draw";(!t||t.view!==e.view||n||a)&&(this.#i=this.#z(e.workflow==="draw"?"top":e.view,e)),e.workflow==="draw"&&t?.draw.zoomPercent!==e.draw.zoomPercent&&(this.#i={...this.#i,orthographic:!0,pitch:Math.PI/2-.018,distance:this.#g*100/e.draw.zoomPercent}),this.requestRender()}#z(e,t){let r=e==="top",n=r?this.#g:this.#y,a=t.cameras[e];return a?{yaw:a.yaw,pitch:r?Math.PI/2-.018:a.pitch,distance:E(n/E(a.zoom,.01,100),Math.max(.2,this.#p*.04),this.#p*8),targetX:E(a.targetX,-this.#p,this.#p),targetZ:E(a.targetZ,-this.#p,this.#p),orthographic:r}:r?{yaw:0,pitch:Math.PI/2-.018,distance:n,targetX:0,targetZ:0,orthographic:!0}:{yaw:-Math.PI/4,pitch:.82,distance:n,targetX:0,targetZ:0,orthographic:!1}}#F(e,t){let r=this.#r;if(!r)throw new Error("webgl-unavailable");let n=r.createShader(e);if(!n)throw new Error("shader-unavailable");if(r.shaderSource(n,t),r.compileShader(n),!r.getShaderParameter(n,r.COMPILE_STATUS))throw r.deleteShader(n),new Error("shader-failed");return n}#B(){try{this.#r=this.#e.getContext("webgl2",{alpha:!0,antialias:!0,depth:!0,powerPreference:"high-performance"});let e=this.#r;if(!e)throw new Error("webgl2-unavailable");let t=this.#F(e.VERTEX_SHADER,`#version 300 es
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
      `),r=this.#F(e.FRAGMENT_SHADER,`#version 300 es
        precision highp float;
        in vec3 vColor;
        out vec4 outColor;
        void main() {
          vec2 point = gl_PointCoord * 2.0 - 1.0;
          if (dot(point, point) > 1.0) discard;
          float edge = smoothstep(1.0, 0.72, dot(point, point));
          outColor = vec4(pow(vColor, vec3(0.94)), edge);
        }
      `),n=e.createProgram();if(!n)throw new Error("program-unavailable");if(e.attachShader(n,t),e.attachShader(n,r),e.linkProgram(n),e.deleteShader(t),e.deleteShader(r),!e.getProgramParameter(n,e.LINK_STATUS))throw new Error("program-failed");this.#d=n,this.#m=e.getUniformLocation(n,"uViewProjection"),this.#b=e.getUniformLocation(n,"uCenter"),this.#w=e.getUniformLocation(n,"uMetersPerCell"),this.#h=e.getUniformLocation(n,"uPointPixels"),this.#_=e.getUniformLocation(n,"uMaxPointPixels"),this.#u=e.createBuffer(),this.#s=e.createVertexArray(),e.bindVertexArray(this.#s),e.bindBuffer(e.ARRAY_BUFFER,this.#u),e.enableVertexAttribArray(0),e.vertexAttribIPointer(0,2,e.UNSIGNED_SHORT,8,0),e.enableVertexAttribArray(1),e.vertexAttribIPointer(1,1,e.UNSIGNED_BYTE,8,4),e.enableVertexAttribArray(2),e.vertexAttribPointer(2,3,e.UNSIGNED_BYTE,!0,8,5),e.bindVertexArray(null),e.enable(e.DEPTH_TEST),e.depthFunc(e.LEQUAL),e.enable(e.BLEND),e.blendFunc(e.SRC_ALPHA,e.ONE_MINUS_SRC_ALPHA),this.#M="webgl2",this.#A+=1,this.#l&&this.#q(this.#l)}catch{this.#U(),this.#X()}}#j(e){if(this.#K(),!e){this.#k=0,this.requestRender();return}let[t,r]=e.metadata.span,n=e.metadata.metersPerCell,a=t*n,i=r*n;this.#p=Math.max(1,Math.hypot(a,i)/2),this.#y=this.#p*1.72;let s=this.#D(),l=Math.max(.2,s.width/Math.max(1,s.height));this.#g=Math.max(i/2,a/(2*l))*1.12,this.fit(!1),this.#M==="webgl2"?this.#q(e):this.#V(e)}#q(e){let t=this.#r;if(!t||!this.#u)return;let r=new Uint8Array(e.buffer,e.pointOffset,e.total*8);t.bindBuffer(t.ARRAY_BUFFER,this.#u),t.bufferData(t.ARRAY_BUFFER,r,t.STATIC_DRAW),this.#k=e.total}#X(){this.#M="canvas2d",this.#c=document.createElement("canvas"),this.#c.width=1024,this.#c.height=1024,this.#o=this.#c.getContext("2d",{alpha:!0}),this.#o?this.#l&&this.#V(this.#l):(this.#M="unavailable",this.#a.onProblem?.("renderer-unavailable"))}#V(e){let t=this.#o;if(!t||!this.#c)return;t.clearRect(0,0,this.#c.width,this.#c.height);let r=new DataView(e.buffer,e.pointOffset,e.total*8),n=Math.min(e.total,5e4),a=Math.max(1,Math.ceil(e.total/n)),i=0,s=0,l=()=>{if(this.#S||e!==this.#l||!this.#c)return;let c=Math.min(e.total,i+a*4e3);for(;i<c;i+=a){let d=i*8,u=r.getUint16(d,!0)/Math.max(1,e.metadata.span[0])*this.#c.width,h=r.getUint16(d+2,!0)/Math.max(1,e.metadata.span[1])*this.#c.height,p=r.getUint8(d+5),g=r.getUint8(d+6),_=r.getUint8(d+7);t.fillStyle=`rgb(${p} ${g} ${_})`,t.fillRect(u,h,1.5,1.5),s+=1}this.#k=s,this.requestRender(),i<e.total?this.#$=window.setTimeout(l,0):this.#$=null};l()}#K(){this.#$!==null&&window.clearTimeout(this.#$),this.#$=null}#D(){let e=this.#e.getBoundingClientRect();return this.#P={width:e.width,height:e.height,left:e.left,top:e.top},this.#P}#Z(){let e=this.#D(),t=Math.min(window.devicePixelRatio||1,3),r=Math.max(1,Math.round(e.width*t)),n=Math.max(1,Math.round(e.height*t));for(let a of[this.#e,this.#t])(a.width!==r||a.height!==n)&&(a.width=r,a.height=n)}#Q(){let e=this.#P,t=Math.max(.2,e.width/Math.max(1,e.height)),r=Math.cos(this.#i.pitch)*this.#i.distance,n=[this.#i.targetX+Math.sin(this.#i.yaw)*r,Math.sin(this.#i.pitch)*this.#i.distance,this.#i.targetZ+Math.cos(this.#i.yaw)*r],a=[this.#i.targetX,0,this.#i.targetZ],i=No(n,a),s=this.#i.orthographic?Oo(-this.#i.distance*t,this.#i.distance*t,-this.#i.distance,this.#i.distance,-this.#p*4,this.#p*4):Do(Math.PI/3.15,t,.02,Math.max(60,this.#p*12));return zo(s,i)}requestRender(){this.#v!==null||this.#S||(this.#v=window.requestAnimationFrame(()=>{this.#v=null,this.#J()}))}#J(){let e=performance.now();this.#Z(),this.#E=this.#Q(),this.#M==="webgl2"?this.#ee():this.#te(),this.#oe(),this.#I=performance.now()-e,this.#I>18?(this.#R+=1,this.#R>=3&&this.#f?.quality==="auto"&&(this.#L=Math.max(.25,this.#L*.75))):this.#R=Math.max(0,this.#R-1)}#ee(){let e=this.#r,t=this.#l;if(!e||(e.viewport(0,0,this.#e.width,this.#e.height),e.clearColor(0,0,0,0),e.clear(e.COLOR_BUFFER_BIT|e.DEPTH_BUFFER_BIT),!t||!this.#d||!this.#s))return;if(this.#f?.view==="top"&&this.#f.appearance==="rooms"){this.#k=0;return}e.useProgram(this.#d),e.bindVertexArray(this.#s),e.uniformMatrix4fv(this.#m,!1,this.#E),e.uniform2f(this.#b,(t.metadata.span[0]-1)/2,(t.metadata.span[1]-1)/2),e.uniform1f(this.#w,t.metadata.metersPerCell);let r=Math.min(window.devicePixelRatio||1,3),n=Math.max(1,Math.floor(t.total*this.#L)),a=Math.min(t.floorCount,n),i=Math.min(t.surfaceCount,Math.max(0,n-a));e.uniform1f(this.#h,this.#e.height*.038),e.uniform1f(this.#_,4.5*r),e.drawArrays(e.POINTS,0,a),e.uniform1f(this.#h,this.#e.height*.05),e.uniform1f(this.#_,7*r),e.drawArrays(e.POINTS,t.floorCount,i),e.bindVertexArray(null),this.#k=a+i}#te(){}#re(e,t,r=0){let n=this.#l;return n?[-(e-(n.metadata.span[0]-1)/2)*n.metadata.metersPerCell,r*n.metadata.metersPerCell,(t-(n.metadata.span[1]-1)/2)*n.metadata.metersPerCell]:null}#H(e,t,r=0){let n=this.#re(e,t,r);if(!n)return null;let[a,i,s]=n,l=this.#E,c=(l[0]??0)*a+(l[4]??0)*i+(l[8]??0)*s+(l[12]??0),d=(l[1]??0)*a+(l[5]??0)*i+(l[9]??0)*s+(l[13]??0),u=(l[3]??0)*a+(l[7]??0)*i+(l[11]??0)*s+(l[15]??0);if(u<=.001)return null;let h=c/u,p=d/u;if(Math.abs(h)>1.15||Math.abs(p)>1.15)return null;let g=this.#P;return{x:(h*.5+.5)*g.width,y:(-p*.5+.5)*g.height}}#O(e,t,r=0){let n=this.#l;if(!n)return null;let a=e/n.metadata.metersPerCell-n.metadata.origin[0],i=t/n.metadata.metersPerCell-n.metadata.origin[1];return this.#H(a,i,r)}#oe(){let e=this.#n,t=this.#l,r=this.#f;if(!e)return;let n=Math.min(window.devicePixelRatio||1,3),a=this.#P;if(e.setTransform(n,0,0,n,0,0),e.clearRect(0,0,a.width,a.height),!t||!r)return;if(this.#M==="canvas2d"&&this.#c&&!(r.view==="top"&&r.appearance==="rooms")){let c=this.#g/this.#i.distance,d=a.width*c,u=a.height*c,h=(a.width-d)/2-this.#i.targetX*32*c,p=(a.height-u)/2-this.#i.targetZ*32*c;e.drawImage(this.#c,h,p,d,u)}let i=this.#ne(r);if(r.labelsVisible||r.view==="top"&&r.appearance==="rooms"){e.lineWidth=1.5,e.font="600 12px system-ui, sans-serif",e.textAlign="center",e.textBaseline="middle";let c=[];for(let d of t.metadata.rooms){let u=i.has(d.name.toLocaleLowerCase());e.strokeStyle=u?"#0678ce":"rgba(75, 92, 105, .7)",e.fillStyle=u?"rgba(6, 120, 206, .26)":r.view==="top"&&r.appearance==="rooms"?"rgba(231, 238, 242, .94)":"rgba(255, 255, 255, .04)",e.beginPath();let h=Math.max(1,Math.ceil(d.boundary.length/512)),p=!1;for(let b=0;b<d.boundary.length;b+=h){let C=d.boundary[b];if(!C)continue;let k=this.#H(C[0],C[1],.2);k&&(p?e.lineTo(k.x,k.y):e.moveTo(k.x,k.y),p=!0)}if(p&&(e.closePath(),e.fill(),e.stroke()),!r.labelsVisible)continue;let g=this.#H(d.center[0],d.center[1],1);if(!g)continue;let _=e.measureText(d.name).width,w=new DOMRect(g.x-_/2-6,g.y-10,_+12,20);c.some(b=>w.left<b.right+8&&w.right+8>b.left&&w.top<b.bottom+4&&w.bottom+4>b.top)||(c.push(w),e.fillStyle="rgba(250, 252, 253, .88)",e.fillRect(w.x,w.y,w.width,w.height),e.fillStyle="#263238",e.fillText(d.name,g.x,g.y))}}let s=r.draw.circles;if((r.workflow==="draw"||r.workflow==="areaReview")&&s.length){e.fillStyle="rgba(6, 120, 206, .22)",e.strokeStyle="rgba(6, 120, 206, .92)",e.lineWidth=1.5;for(let c of s)this.#ae(e,c)}if(this.#C&&r.workflow==="draw"&&r.draw.tool!=="pan"){let c=this.#O(this.#C.x,this.#C.y),d=this.#O(this.#C.x+r.draw.brushMeters/2,this.#C.y);c&&d&&(e.beginPath(),e.arc(c.x,c.y,Math.max(2,Math.hypot(d.x-c.x,d.y-c.y)),0,Math.PI*2),e.strokeStyle="#0678ce",e.lineWidth=2,e.stroke())}let l=r.resources.pose.value;if(r.map.exactPose&&l?.position&&r.dataMode==="live"){let c=this.#O(l.position[0],l.position[1],3);c&&(e.beginPath(),e.arc(c.x,c.y,7,0,Math.PI*2),e.fillStyle="#0678ce",e.fill(),e.strokeStyle="#fff",e.lineWidth=3,e.stroke())}}#ne(e){let t=e.resources.plans.value?.rooms||e.resources.areas.value?.rooms||[];return new Set(t.filter(r=>e.selection.roomIds.includes(r.roomId)).map(r=>r.name.toLocaleLowerCase()))}#ae(e,t){let r=this.#O(t.x,t.y),n=this.#O(t.x+t.radius,t.y);!r||!n||(e.beginPath(),e.arc(r.x,r.y,Math.max(1,Math.hypot(n.x-r.x,n.y-r.y)),0,Math.PI*2),e.fill(),e.stroke())}setCursor(e){this.#C=e,this.requestRender()}screenToMap(e,t){let r=this.#l;if(!r||!this.#i.orthographic)return null;let n=this.#D();if(!n.width||!n.height)return null;let a=this.#i.distance*2/n.height,i=this.#i.targetX+(e-n.left-n.width/2)*a,s=this.#i.targetZ+(t-n.top-n.height/2)*a,l=-i/r.metadata.metersPerCell+(r.metadata.span[0]-1)/2,c=s/r.metadata.metersPerCell+(r.metadata.span[1]-1)/2;return{x:(l+r.metadata.origin[0])*r.metadata.metersPerCell,y:(c+r.metadata.origin[1])*r.metadata.metersPerCell}}roomAt(e,t){let r=this.screenToMap(e,t),n=this.#l,a=this.#f;if(!r||!n||!a)return null;let i=r.x/n.metadata.metersPerCell-n.metadata.origin[0],s=r.y/n.metadata.metersPerCell-n.metadata.origin[1],l=n.metadata.rooms.find(c=>Cr(i,s,c.boundary));return l?this.#ie(l,a):null}containsMapPoint(e){let t=this.#l;if(!t)return!1;let r=e.x/t.metadata.metersPerCell-t.metadata.origin[0],n=e.y/t.metadata.metersPerCell-t.metadata.origin[1];return t.metadata.rooms.some(a=>Cr(r,n,a.boundary))}#ie(e,t){return(t.resources.plans.value?.rooms||t.resources.areas.value?.rooms||[]).find(n=>n.name.localeCompare(e.name,void 0,{sensitivity:"base"})===0)?.roomId||e.id}selectRoomAt(e,t){let r=this.roomAt(e,t);r&&this.#a.onRoom?.(r)}fit(e=!0){let t=this.#f?.view==="top"||this.#f?.workflow==="draw";this.#i=t?{yaw:0,pitch:Math.PI/2-.018,distance:this.#g,targetX:0,targetZ:0,orthographic:!0}:{yaw:-Math.PI/4,pitch:.82,distance:this.#y,targetX:0,targetZ:0,orthographic:!1},this.requestRender(),e&&this.#N()}zoomAt(e,t,r){let n=t===void 0||r===void 0?null:this.screenToMap(t,r),a=this.#W();if(this.#i={...this.#i,distance:E(this.#i.distance/e,a.minimum,a.maximum)},n&&t!==void 0&&r!==void 0){let i=this.screenToMap(t,r);i&&(this.#i={...this.#i,targetX:this.#i.targetX-(n.x-i.x),targetZ:this.#i.targetZ+(n.y-i.y)})}this.requestRender(),this.#N(t,r)}panBy(e,t){this.setCamera(this.cameraAfterPan(this.#i,e,t))}orbitBy(e,t){if(this.#i.orthographic){this.panBy(e,t);return}this.#i={...this.#i,yaw:Ct(this.#i.yaw+e*.006),pitch:E(this.#i.pitch-t*.004,.18,1.38)},this.requestRender(),this.#N()}rotateBy(e){this.#i={...this.#i,yaw:Ct(this.#i.yaw+e)},this.requestRender(),this.#N()}#N(e,t){let r=this.#i.orthographic?this.#g:this.#y,n=e===void 0||t===void 0?this.#P:this.#D(),a=e===void 0||t===void 0||!n.width||!n.height?void 0:{xPercent:E((e-n.left)/n.width*100,0,100),yPercent:E((t-n.top)/n.height*100,0,100)};this.#a.onCamera?.(this.camera,Math.round(r/this.#i.distance*100),a)}diagnostics(){return{mode:this.#M,contextGeneration:this.#A,sceneRevision:this.#l?.revision??null,sourcePoints:this.#l?.total??0,renderedPoints:this.#k,lastFrameMs:Math.round(this.#I*100)/100,slowFrames:this.#R}}#Y=e=>{e.preventDefault(),this.#U(),this.#X(),this.requestRender()};#G=()=>{this.#U(),this.#B(),this.requestRender()};#U(){let e=this.#r;e&&(this.#u&&e.deleteBuffer(this.#u),this.#s&&e.deleteVertexArray(this.#s),this.#d&&e.deleteProgram(this.#d)),this.#u=null,this.#s=null,this.#d=null,this.#r=null}dispose(){this.#S||(this.#S=!0,this.#x.disconnect(),this.#e.removeEventListener("webglcontextlost",this.#Y),this.#e.removeEventListener("webglcontextrestored",this.#G),this.#v!==null&&window.cancelAnimationFrame(this.#v),this.#v=null,this.#K(),this.#U(),this.#c=null,this.#o=null,this.#n=null,this.#l=null,this.#f=null)}};var Mr="component.matic_robot.common.",R=(o,e,t,r)=>{let n=r?{...r}:void 0,a=o?.(`${Mr}${e}`,n);return a&&a!==`${Mr}${e}`?a:r?Object.entries(r).reduce((i,[s,l])=>i.replaceAll(`{${s}}`,String(l)),t):t};var ne="matic-workspace-intent",qe="matic-workspace-action",Ar=(o,e)=>{let t=(n,a,i)=>R(e,n,a,i);if(!ce(o))return t("v4_private_map_unavailable","The current private map is not available.");if(o.dataMode==="history")return t("v4_saved_map_description","Saved read-only map for {floor}. Live robot position is hidden.",{floor:o.floor.displayName});let r=Xt(o)?t("v4_robot_position_verified","The robot position is verified."):t("v4_robot_position_hidden","The robot position is not shown.");return t("v4_live_map_description","Live map for {floor}. {pose}",{floor:o.floor.displayName,pose:r})},Mt=class extends x{constructor(){super(...arguments);this.state=M();this.#e=null;this.#t=null;this.#a=null;this.#r=!1}static{this.properties={state:{attribute:!1},localize:{attribute:!1}}}static{this.styles=N`
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

    .map-tools {
      inset-block-start: 0.75rem;
      inset-inline-end: 0.75rem;
      display: flex;
      gap: 0.2rem;
      padding: 0.2rem;
      border-radius: 0.85rem;
    }

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
  `}#e;#t;#a;#r;#n(t,r,n){return R(this.localize,t,r,n)}firstUpdated(){let t=this.renderRoot.querySelector(".map-root"),r=this.renderRoot.querySelector(".scene-canvas"),n=this.renderRoot.querySelector(".overlay-canvas");!t||!r||!n||(this.#t=new Be(r,n,{onCamera:(a,i,s)=>{this.#o({type:"set-camera",view:this.state.workflow==="draw"?"top":this.state.view,camera:{yaw:a.yaw,pitch:a.pitch,zoom:i/100,targetX:a.targetX,targetZ:a.targetZ}}),this.state.workflow==="draw"&&i!==this.state.draw.zoomPercent&&this.#o({type:"set-zoom",value:i,...s?{originX:s.xPercent,originY:s.yPercent}:{}})},onRoom:a=>this.#o({type:"toggle-room",roomId:a}),onProblem:()=>this.#c("renderer-problem")}),this.#a=new Fe(t,this.#t,{state:()=>this.state,onCircles:(a,i,s)=>this.#o({type:"set-draft-circles",circles:a,record:i,...s?{previous:s}:{}}),onRoom:a=>this.#o({type:"toggle-room",roomId:a})}),this.#t.setState(this.state))}disconnectedCallback(){this.#a?.dispose(),this.#a=null,this.#t?.dispose(),this.#t=null,super.disconnectedCallback()}updated(t){if(!t.has("state"))return;t.get("state")?.fullMap&&!this.state.fullMap&&this.#e&&this.#e.focus(),this.#t?.setState(this.state)}#o(t){this.dispatchEvent(new CustomEvent(ne,{detail:t,bubbles:!0,composed:!0}))}#c(t){this.dispatchEvent(new CustomEvent(qe,{detail:{id:t},bubbles:!0,composed:!0}))}#d(t){this.#e=t.currentTarget,this.#o({type:this.state.fullMap?"exit-full-map":"enter-full-map"})}#u(t,r){this.#t?.orbitBy(t,r)}#s(t){if(!(t.ctrlKey||t.metaKey||t.altKey)&&t.key==="Escape"){if(t.preventDefault(),this.#r){this.#r=!1,this.requestUpdate();return}this.#o({type:"dismiss-top-layer"});return}}rendererDiagnostics(){return this.#t?.diagnostics()??null}canvasIdentity(){return{scene:this.renderRoot.querySelector(".scene-canvas"),overlay:this.renderRoot.querySelector(".overlay-canvas")}}#m(){return this.state.host.connected?this.state.host.administrator?this.state.host.robotCount===0?{title:this.#n("v4_no_robot","No Matic robot set up"),detail:this.#n("v4_no_robot_detail","Set up a robot before opening its map.")}:this.state.host.robotConnected?this.state.coherence==="verifying"||this.state.coherence==="booting"?{title:this.#n("v4_locating_map","Locating the current map"),detail:this.#n("v4_locating_map_detail","Map controls will return after the floor is verified.")}:!this.state.map.available&&this.state.resources.scene.status==="loading"?{title:this.#n("v4_loading_verified_map","Loading the verified map"),detail:this.#n("v4_loading_verified_map_detail","The current floor is verified. The private scene is still preparing.")}:this.state.map.available?this.state.activity==="problem"?{title:this.#n("v4_robot_attention","Robot needs attention"),detail:this.#n("v4_robot_attention_detail","Check the robot before starting another task.")}:null:{title:this.#n("v4_map_unavailable","Map unavailable"),detail:this.#n("v4_map_unavailable_detail","The private scene is not ready. No map data is shown until it is verified.")}:{title:this.#n("v4_robot_offline","Robot offline"),detail:this.#n("v4_robot_offline_detail","The last verified map stays read only and has no live position.")}:{title:this.#n("v4_admin_required","Administrator access required"),detail:this.#n("v4_private_map_hidden","Private map data is hidden.")}:{title:this.#n("v4_reconnecting","Reconnecting"),detail:this.#n("v4_reconnecting_detail","The verified map is read only until Home Assistant reconnects.")}}render(){let t=this.state,r=Yt(t),n=this.#m(),a=t.map.available&&(ce(t)||t.dataMode==="history"),i=t.workflow==="draw"&&a,s=t.coherence==="verifying"||t.coherence==="booting";return A`
      <section
        class="map-root"
        tabindex="0"
        role="application"
        aria-label=${Ar(t,this.localize)}
        data-full-map=${String(t.fullMap)}
        data-workflow=${t.workflow}
        data-draw-tool=${t.draw.tool}
        @keydown=${this.#s}
      >
        ${!s||t.fullMap?A`<nav class="map-tools" aria-label="Map tools">
          ${s?m:A`
            <button type="button" @click=${()=>{this.#t?.fit(),this.#o({type:"fit-map"})}}>${this.#n("map_home_view","Fit")}</button>
            <button
              class="labels"
              type="button"
              aria-pressed=${String(t.labelsVisible)}
              @click=${()=>this.#o({type:"toggle-labels"})}
            >${this.#n("map_labels","Labels")}</button>
            <button
              class="help"
              type="button"
              aria-label=${this.#n("v4_navigation_help","Map navigation help")}
              aria-expanded=${String(this.#r)}
              @click=${()=>{this.#r=!this.#r,this.requestUpdate()}}
            >?</button>
          `}
          <button
            class="full-map"
            type="button"
            aria-label=${this.#n("v4_full_map","Full map")}
            aria-pressed=${String(t.fullMap)}
            @click=${this.#d}
          >${t.fullMap?this.#n("v4_close","Close"):this.#n("v4_full_map","Full map")}</button>
        </nav>`:m}

        ${this.#r&&a?A`
          <aside class="navigation-help" aria-label=${this.#n("v4_navigation_help","Map navigation help")}>
            <dl>
              <dt>${this.#n("v4_trackpad","Trackpad")}</dt>
              <dd>${this.#n("v4_trackpad_help","Scroll to pan \xB7 pinch to zoom \xB7 twist to rotate")}</dd>
              <dt>${this.#n("v4_mouse","Mouse")}</dt>
              <dd>${this.#n("v4_mouse_help","Drag to orbit \xB7 Shift, middle, or right drag to pan \xB7 wheel to zoom")}</dd>
              <dt>${this.#n("v4_keyboard","Keyboard")}</dt>
              <dd>${this.#n("v4_keyboard_help","WASD to move \xB7 Q/E or arrows to orbit \xB7 +/\u2212 to zoom \xB7 0 to fit")}</dd>
            </dl>
          </aside>
        `:m}

        ${t.workflow!=="draw"&&a?A`
          <div class="view-switch" aria-label="Map view">
            <button
              type="button"
              aria-pressed=${String(t.view==="three")}
              @click=${()=>this.#o({type:"set-view",view:"three"})}
            >${this.#n("map_view_3d","3D")}</button>
            <button
              type="button"
              aria-pressed=${String(t.view==="top")}
              @click=${()=>this.#o({type:"set-view",view:"top"})}
            >${this.#n("map_view_top","2D")}</button>
          </div>
        `:m}

        ${t.view==="top"&&a?A`
          <div class="appearance-switch" aria-label=${this.#n("map_style_label","2D map style")}>
            <button
              type="button"
              aria-pressed=${String(t.appearance==="photo")}
              @click=${()=>this.#o({type:"set-appearance",appearance:"photo"})}
            >${this.#n("map_style_photo","Photo")}</button>
            <button
              type="button"
              aria-pressed=${String(t.appearance==="rooms")}
              @click=${()=>this.#o({type:"set-appearance",appearance:"rooms"})}
            >${this.#n("map_view_rooms","Rooms")}</button>
          </div>
        `:m}

        ${t.view==="three"&&a?A`
          <div class="camera-steps" role="toolbar" aria-label=${this.#n("map_camera_controls","Map camera controls")}>
            <button type="button" aria-label=${this.#n("map_rotate_left","Rotate left")} aria-keyshortcuts="[" @click=${()=>this.#u(-52,0)}>↶</button>
            <button type="button" aria-label=${this.#n("map_tilt_down","Lower viewing angle")} aria-keyshortcuts="PageDown" @click=${()=>this.#u(0,30)}>⌄</button>
            <button type="button" aria-label=${this.#n("map_tilt_up","Raise viewing angle")} aria-keyshortcuts="PageUp" @click=${()=>this.#u(0,-30)}>⌃</button>
            <button type="button" aria-label=${this.#n("map_rotate_right","Rotate right")} aria-keyshortcuts="]" @click=${()=>this.#u(52,0)}>↷</button>
          </div>
        `:m}

        <div
          class="scene-window"
          data-renderer-key="persistent-canvas-v4"
          ?hidden=${!a}
          aria-hidden="true"
        >
          <canvas class="scene-canvas"></canvas>
          <canvas class="overlay-canvas"></canvas>
        </div>

        ${i?A`
          <div class="map-scale" aria-label=${`Scale ${r.label}`}>
            <span class="scale-line" style=${`--scale-width:${r.pixels}px`}></span>
            <span>${r.label}</span>
          </div>
          <div class="draw-tools" role="toolbar" aria-label="Draw area tools">
            ${["paint","erase","pan"].map(l=>A`
              <button
                type="button"
                role="radio"
                aria-checked=${String(t.draw.tool===l)}
                data-tool=${l}
                @click=${()=>this.#o({type:"set-draw-tool",tool:l})}
              >${l==="paint"?`\u270E ${this.#n("area_paint","Paint")}`:l==="erase"?`\u232B ${this.#n("area_erase","Erase")}`:`\u2725 ${this.#n("move_map","Move map")}`}</button>
            `)}
            <button
              type="button"
              ?disabled=${t.draw.strokeCount===0}
              @click=${()=>this.#o({type:"undo-draft"})}
            >↶ ${this.#n("undo","Undo")}</button>
            <button
              type="button"
              ?disabled=${t.draw.redo.length===0}
              @click=${()=>this.#o({type:"redo-draft"})}
            >↷ ${this.#n("redo","Redo")}</button>
            <button type="button" @click=${()=>this.#c("review-area")}>✓ ${this.#n("done_editing","Done editing")}</button>
          </div>
        `:m}

        ${n&&!(t.fullMap&&(s||!t.host.administrator))?A`
          <div class="map-message" role="status">
            <strong>${n.title}</strong>
            <span>${n.detail}</span>
          </div>
        `:m}
        <div class="sr-only" aria-live="polite" aria-atomic="true">
          ${Ar(t,this.localize)}
        </div>
      </section>
    `}};customElements.get(Me)||customElements.define(Me,Mt);var At=class extends x{constructor(){super(...arguments);this.state=M();this.compact=!1}static{this.properties={state:{attribute:!1},localize:{attribute:!1},compact:{type:Boolean,reflect:!0}}}static{this.styles=N`
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
  `}#e(t,r){return R(this.localize,t,r)}#t(t){this.dispatchEvent(new CustomEvent(ne,{detail:t,bubbles:!0,composed:!0}))}#a(t,r){let n=t.currentTarget.valueAsNumber;Number.isFinite(n)&&this.#t(r==="zoom"?{type:"set-zoom",value:n}:{type:"set-brush",value:n})}render(){let{draw:t}=this.state;return A`
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
                @change=${r=>this.#a(r,"zoom")}
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
                @change=${r=>this.#a(r,"brush")}
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
    `}};customElements.get(te)||customElements.define(te,At);var Pt=["vacuum","mop","vacuum_and_mop"],Et=["quick","standard","heavy_duty"],z=o=>o.currentTarget.value,Rt=o=>o.currentTarget.checked,Pr=U(te),It=class extends x{constructor(){super(...arguments);this.state=M()}static{this.properties={state:{attribute:!1},localize:{attribute:!1}}}static{this.styles=N`
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
    .room { display: grid; gap: 0.5rem; padding: 0.55rem 0.65rem; }
    .room[data-selected="true"] {
      border-color: color-mix(in srgb, var(--primary-color, #0678ce) 62%, transparent);
      background: color-mix(in srgb, var(--primary-color, #0678ce) 8%, var(--secondary-background-color, #f5f7f8));
    }
    .room-choice { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 0.6rem; min-block-size: 2.1rem; }
    .room-choice input { inline-size: 1.2rem; block-size: 1.2rem; }
    .room-settings { padding-block-start: 0.1rem; padding-inline-start: 1.8rem; }
    .plan-options {
      display: grid;
      gap: 0.55rem;
      padding: 0.7rem;
      border: 1px solid var(--divider-color, #d1d8dc);
      border-radius: 0.7rem;
      background: var(--secondary-background-color, #f5f7f8);
    }
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
  `}#e(t,r,n){return R(this.localize,t,r,n)}#t(t){return t==="vacuum"?this.#e("vacuum","Vacuum"):t==="mop"?this.#e("mop","Mop"):this.#e("vacuum_and_mop","Vacuum + mop")}#a(t){return t==="quick"?this.#e("quick","Quick"):t==="standard"?this.#e("standard","Optimal"):this.#e("heavy_duty","Heavy Duty")}#r(t){this.dispatchEvent(new CustomEvent(ne,{detail:t,bubbles:!0,composed:!0}))}#n(){return this.state.notice?f`
      <div class="notice" data-tone=${this.state.notice.tone} role=${this.state.notice.tone==="error"?"alert":"status"}>
        ${this.state.notice.text}
      </div>
    `:m}#o(t,r,n){return t==="loading"||t==="idle"?f`<div class="loading" role="status">${this.#e("map_loading","Loading\u2026")}</div>`:t==="error"?f`<div class="problem" role="alert">${this.#e("v4_workspace_unavailable","This workspace is unavailable right now.")} ${r==="request-failed"?this.#e("v4_try_again","Try again shortly."):this.#e("v4_return_live_retry","Return to the live map and retry.")}</div>`:t==="empty"?f`<div class="empty">${this.#e("v4_nothing_saved","Nothing saved yet.")}</div>`:n}#c(){let t=this.state.resources.plans;return this.#o(t.status,t.problem,f`
      <div class="stack">
        <div class="list" role="group" aria-label=${this.#e("v4_rooms_to_clean","Rooms to clean")}>
          ${(t.value?.rooms||[]).map(r=>{let n=this.state.selection.roomIds.includes(r.roomId);return f`
              <div class="room" data-selected=${String(n)}>
                <label class="room-choice">
                  <input
                    type="checkbox"
                    .checked=${n}
                    @change=${()=>this.#r({type:"toggle-room",roomId:r.roomId})}
                  >
                  <strong>${r.name}</strong>
                  ${n?f`<small>${this.#e("v4_room_ready","Ready")}</small>`:m}
                </label>
                ${n?this.#d(r.roomId,this.state.selection.roomSettings.find(a=>a.roomId===r.roomId)||{roomId:r.roomId,cleaningMode:"vacuum",coverageSetting:"standard"}):m}
              </div>
            `})}
        </div>
        <p class="subtle">${this.#e("v4_room_selection_hint","Select rooms here or directly on the map. The map and list stay in sync.")}</p>
        ${this.#n()}
      </div>
    `)}#d(t,r){return f`
      <div class="split room-settings">
        <label class="field">${this.#e("v4_cleaning_system","Cleaning system")}
          <select
            aria-label=${this.#e("v4_room_cleaning_system","Cleaning system for room")}
            .value=${r.cleaningMode}
            @change=${n=>this.#r({type:"patch-room-settings",roomId:t,cleaningMode:z(n)})}
          >${Pt.map(n=>f`<option value=${n} ?selected=${n===r.cleaningMode}>${this.#t(n)}</option>`)}</select>
        </label>
        <label class="field">${this.#e("cleaning_mode","Cleaning mode")}
          <select
            aria-label=${this.#e("v4_room_cleaning_mode","Cleaning mode for room")}
            .value=${r.coverageSetting}
            @change=${n=>this.#r({type:"patch-room-settings",roomId:t,coverageSetting:z(n)})}
          >${Et.map(n=>f`<option value=${n} ?selected=${n===r.coverageSetting}>${this.#a(n)}</option>`)}</select>
        </label>
      </div>
    `}#u(t){let r=this.state.planDraft.rooms,a=r.find(i=>i.roomId===t)?r.filter(i=>i.roomId!==t):[...r,{roomId:t,cleaningMode:"vacuum",coverageSetting:"standard"}];this.#r({type:"patch-plan-draft",patch:{rooms:a}})}#s(t,r){let n=this.state.planDraft.rooms.map((a,i)=>i===t?{...a,...r}:a);this.#r({type:"patch-plan-draft",patch:{rooms:n}})}#m(t,r){let n=t+r,a=[...this.state.planDraft.rooms];if(n<0||n>=a.length)return;let[i]=a.splice(t,1);i&&(a.splice(n,0,i),this.#r({type:"patch-plan-draft",patch:{rooms:a}}))}#b(){let t=this.state.resources.plans,r=t.value,n=this.state.planDraft,a=n.rooms.map(l=>({room:l,label:r?.rooms.find(c=>c.roomId===l.roomId)?.name||"Room",selected:!0})),i=(r?.rooms||[]).filter(l=>!n.rooms.some(c=>c.roomId===l.roomId)).map(l=>({room:{roomId:l.roomId,cleaningMode:"vacuum",coverageSetting:"standard"},label:l.name,selected:!1})),s=[...a,...i];return this.#o(t.status,t.problem,f`
      <div class="stack">
        <div class="split">
          <label class="field">${this.#e("v4_saved_plan","Saved plan")}
            <select
              .value=${this.state.selection.planId||""}
              @change=${l=>this.#r({type:"select-plan",planId:z(l)||null})}
            >
              <option value="">${this.#e("plan_new","New plan")}</option>
              ${(r?.plans||[]).map(l=>f`<option value=${l.id}>${l.name}</option>`)}
            </select>
          </label>
          <button class="list-button" type="button" @click=${()=>this.#r({type:"select-plan",planId:null})}>＋ ${this.#e("plan_new","New plan")}</button>
        </div>
        <label class="field">${this.#e("plan_name","Plan name")}
          <input
            maxlength="128"
            autocomplete="off"
            .value=${n.name}
            @input=${l=>this.#r({type:"patch-plan-draft",patch:{name:z(l)}})}
          >
        </label>
        <div class="split">
          <label class="field">${this.#e("plan_run_behavior","Run order")}
            <select
              .value=${n.runBehavior}
              @change=${l=>this.#r({type:"patch-plan-draft",patch:{runBehavior:z(l)==="ordered"?"ordered":"intelligent"}})}
            >
              <option value="intelligent">${this.#e("plan_intelligent","Smart rotation")}</option>
              <option value="ordered">${this.#e("plan_ordered","Listed order")}</option>
            </select>
          </label>
          <label class="checkbox"><input type="checkbox" .checked=${n.enabled} @change=${l=>this.#r({type:"patch-plan-draft",patch:{enabled:Rt(l)}})}>${this.#e("plan_enabled","Enabled")}</label>
        </div>
        <div class="plan-options" aria-label=${this.#e("v4_completion_options","Completion options")}>
          <label class="checkbox"><input type="checkbox" .checked=${n.returnToBase} @change=${l=>this.#r({type:"patch-plan-draft",patch:{returnToBase:Rt(l)}})}>${this.#e("plan_return_to_base","Return to the dock when finished")}</label>
          <label class="checkbox"><input type="checkbox" .checked=${n.finishCurrentRoom} @change=${l=>this.#r({type:"patch-plan-draft",patch:{finishCurrentRoom:Rt(l)}})}>${this.#e("plan_finish_room","Finish the active room after Stop")}</label>
          ${n.finishCurrentRoom?f`<label class="field">${this.#e("plan_threshold","Finish threshold")} · ${n.finishCurrentRoomThreshold}%<input type="range" min="0" max="100" step="5" .value=${String(n.finishCurrentRoomThreshold)} @input=${l=>this.#r({type:"patch-plan-draft",patch:{finishCurrentRoomThreshold:Number(z(l))}})}></label>`:m}
        </div>
        <div class="list" aria-label=${this.#e("plan_rooms","Plan rooms")}>
          ${s.map(({room:l,label:c,selected:d})=>{let u=d?n.rooms.findIndex(h=>h.roomId===l.roomId):-1;return f`
              <div class="room plan-room" data-selected=${String(d)}>
                <label class="room-choice">
                  <input type="checkbox" .checked=${d} @change=${()=>this.#u(l.roomId)}>
                  <strong>${d?`${u+1}. `:""}${c}</strong>
                  ${d?f`
                    <span>
                      <button class="icon-button" type="button" aria-label=${this.#e("move_room_up","Move {room} earlier",{room:c})} ?disabled=${u===0} @click=${h=>{h.preventDefault(),this.#m(u,-1)}}>↑</button>
                      <button class="icon-button" type="button" aria-label=${this.#e("move_room_down","Move {room} later",{room:c})} ?disabled=${u===n.rooms.length-1} @click=${h=>{h.preventDefault(),this.#m(u,1)}}>↓</button>
                    </span>
                  `:m}
                </label>
                ${d?f`
                  <div class="split room-settings">
                    <label class="field">${this.#e("v4_cleaning_system","Cleaning system")}
                      <select .value=${l.cleaningMode} @change=${h=>this.#s(u,{cleaningMode:z(h)})}>${Pt.map(h=>f`<option value=${h} ?selected=${h===l.cleaningMode}>${this.#t(h)}</option>`)}</select>
                    </label>
                    <label class="field">${this.#e("cleaning_mode","Cleaning mode")}
                      <select .value=${l.coverageSetting} @change=${h=>this.#s(u,{coverageSetting:z(h)})}>${Et.map(h=>f`<option value=${h} ?selected=${h===l.coverageSetting}>${this.#a(h)}</option>`)}</select>
                    </label>
                  </div>
                `:m}
              </div>
            `})}
        </div>
        <div class="toolbar">
          ${n.id?f`
            <button
              class="danger"
              type="button"
              aria-label=${this.#e("plan_delete","Delete plan")}
              data-dialog-launcher="confirmDeletePlan"
              @click=${()=>this.#r({type:"open-dialog",dialog:"confirmDeletePlan"})}
            >${this.#e("plan_delete","Delete")}</button>
          `:m}
        </div>
        ${this.#n()}
      </div>
    `)}#w(){let t=this.state.resources.areas;return f`
      <div class="stack">
        <${Pr} .state=${this.state} .localize=${this.localize}></${Pr}>
        <p class="subtle">${this.#e("v4_draw_floor_hint","Paint only on the mapped floor. Zoom and pan never change the saved outline.")}</p>
        <div class="toolbar">
          <button
            type="button"
            ?disabled=${this.state.draw.circles.length===0}
            @click=${()=>this.#r({type:"clear-draft"})}
          >${this.#e("clear","Clear")}</button>
        </div>
        ${this.#o(t.status,t.problem,f`
          <div class="list" aria-label=${this.#e("area_workspace_title","Saved custom areas")}>
            <button class="list-button" type="button" @click=${()=>this.#r({type:"select-area",areaId:null})}>＋ ${this.#e("area_new","New outline")}</button>
            ${(t.value?.areas||[]).map(r=>f`
              <button class="list-button" type="button" @click=${()=>{this.#r({type:"select-area",areaId:r.id}),this.#r({type:"open-workflow",workflow:"areaReview"})}}>
                <span>${r.name}</span>
                <small>${r.status==="current"?this.#e("area_workspace_ready","Ready"):this.#e("v4_review","Review")}</small>
              </button>
            `)}
          </div>
        `)}
      </div>
    `}#h(){let t=this.state.areaDraft,r=t.canRebind||t.status==="review",n=t.status==="stale"||t.status==="unknown";return f`
      <div class="stack">
        ${r?f`<div class="notice" data-tone="warning" role="status">${this.#e("area_review_required","Review the saved outline on this current map, then confirm it.")}</div>`:m}
        ${n?f`<div class="problem" role="alert">${this.#e("area_redraw_required","This outline no longer matches the current room map. Redraw it before saving.")}</div>`:m}
        <label class="field">${this.#e("area_name","Area name")}
          <input maxlength="128" autocomplete="off" .value=${t.name} @input=${a=>this.#r({type:"patch-area-draft",patch:{name:z(a)}})}>
        </label>
        <div class="split">
          <label class="field">${this.#e("v4_cleaning_system","Cleaning system")}
            <select .value=${t.cleaningMode} @change=${a=>this.#r({type:"patch-area-draft",patch:{cleaningMode:z(a)}})}>${Pt.map(a=>f`<option value=${a} ?selected=${a===t.cleaningMode}>${this.#t(a)}</option>`)}</select>
          </label>
          <label class="field">${this.#e("cleaning_mode","Cleaning mode")}
            <select .value=${t.coverageSetting} @change=${a=>this.#r({type:"patch-area-draft",patch:{coverageSetting:z(a)}})}>${Et.map(a=>f`<option value=${a} ?selected=${a===t.coverageSetting}>${this.#a(a)}</option>`)}</select>
          </label>
        </div>
        <p class="subtle">${this.#e("v4_private_marks","{count} map-space marks. The outline stays private and floor-bound.",{count:this.state.draw.circles.length})}</p>
        <div class="toolbar">
          <button type="button" @click=${()=>this.#r({type:"open-workflow",workflow:"draw"})}>${this.#e("v4_edit_outline","Edit outline")}</button>
          ${t.id?f`
            <button
              class="danger"
              type="button"
              aria-label=${this.#e("area_delete","Delete area")}
              data-dialog-launcher="confirmDeleteArea"
              @click=${()=>this.#r({type:"open-dialog",dialog:"confirmDeleteArea"})}
            >${this.#e("area_delete","Delete")}</button>
          `:m}
        </div>
        ${this.#n()}
      </div>
    `}#_(){let t=this.state.resources.history,r=t.value,n=r?.floors.find(s=>s.id===this.state.selection.floorId)||r?.floors.find(s=>s.active)||r?.floors[0],a=n?.snapshots||[],i=this.state.selection.historyId?Math.max(0,a.findIndex(s=>s.id===this.state.selection.historyId)):a.length;return this.#o(t.status,t.problem,f`
      <div class="stack">
        ${(r?.floors.length||0)>1?f`
          <div class="list" role="listbox" aria-label=${this.#e("v4_mapped_floors","Mapped floors")}>
            ${(r?.floors||[]).map((s,l)=>f`
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
              max=${String(a.length)}
              step="1"
              .value=${String(i)}
              ?disabled=${!a.length}
              @input=${s=>{let l=Number(z(s));this.#r({type:"set-history",historyId:l===a.length?null:a[l]?.id||null})}}
            >
          </label>
          <div class="list">
            <button class="snapshot" type="button" aria-current=${String(!this.state.selection.historyId)} @click=${()=>this.#r({type:"set-history",historyId:null})}><span>${this.#e("map_timeline_live_action","Live")}</span><small>${this.#e("v4_current","Current")}</small></button>
            ${a.map((s,l)=>f`
              <button class="snapshot" type="button" aria-current=${String(s.id===this.state.selection.historyId)} @click=${()=>this.#r({type:"set-history",historyId:s.id})}>
                <span>${this.#f(s.createdAt)}</span><small>${l+1} of ${a.length}</small>
              </button>
            `)}
          </div>
        </div>
        <p class="subtle">${this.#e("v4_history_privacy","Saved maps are floor-scoped and never show a live robot position.")}</p>
      </div>
    `)}#f(t){try{return new Intl.DateTimeFormat(this.state.locale,{dateStyle:"medium",timeStyle:"short"}).format(new Date(t))}catch{return this.#e("v4_saved_map","Saved map")}}#l(){let t=this.state.resources.entry;return f`
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
    `}render(){switch(this.state.workflow){case"rooms":return this.#c();case"plan":return this.#b();case"draw":return this.#w();case"areaReview":return this.#h();case"history":return this.#_();case"support":return this.#l();case"none":return m}}};customElements.get(pe)||customElements.define(pe,It);var Er=U(Me),Rr=U(te),Ir=U(pe),Wo=(o,e)=>{let t=(n,a,i)=>R(e,n,a,i);if(!o.host.connected)return{title:t("v4_reconnecting","Reconnecting"),detail:t("v4_ha_offline","Home Assistant is offline")};if(!o.host.administrator)return{title:t("v4_access_required","Access required"),detail:t("v4_admin_only","Administrator only")};if(o.host.robotCount===0)return{title:t("v4_no_robot_short","No robot"),detail:t("v4_set_up_robot","Set up a Matic robot")};if(!o.host.robotConnected)return{title:t("v4_robot_offline","Robot offline"),detail:t("v4_last_map_read_only","Last verified map \xB7 read only")};if(o.activity==="problem")return{title:t("v4_needs_attention","Needs attention"),detail:t("v4_check_robot","Check the robot")};if(o.dataMode==="history"){let n=o.resources.history.value?.floors.find(s=>s.id===o.selection.floorId),a=n?.snapshots.findIndex(s=>s.id===o.selection.historyId)??-1,i=n?.snapshots.length??0;return{title:t("v4_saved_map","Saved map"),detail:a>=0?t("v4_read_only_position","Read only \xB7 {position} of {count}",{position:a+1,count:i}):t("v4_read_only","Read only")}}if(o.coherence==="verifying"||o.coherence==="booting")return{title:t("v4_locating","Locating"),detail:t("v4_finding_map","Finding the current map")};if(o.activity==="cleaning")return{title:t("v4_cleaning","Cleaning"),detail:t("v4_cleaning_progress","Cleaning in progress")};if(o.activity==="recharging"){let n=o.batteryPercent===null?t("v4_recharging_detail","Will resume automatically when ready"):t("v4_recharging_battery","Charging to resume \xB7 {percent}% battery",{percent:o.batteryPercent});return{title:t("v4_recharging","Charging to resume"),detail:n}}if(o.activity==="paused")return{title:t("v4_paused","Paused"),detail:t("v4_can_resume","Cleaning can resume")};if(o.activity==="returning")return{title:t("v4_returning","Returning"),detail:t("v4_going_dock","Going to the dock")};if(o.activity==="stopping")return{title:t("v4_stopping","Stopping"),detail:t("v4_waiting_robot","Waiting for the robot")};let r=o.batteryPercent===null?t("v4_ready","Ready"):t("v4_battery","{percent}% battery",{percent:o.batteryPercent});return{title:o.activity==="docked"?t("v4_docked","Docked"):t("v4_ready","Ready"),detail:r}},Uo=(o,e)=>{let t=(r,n)=>R(e,r,n);switch(o.workflow){case"rooms":return{title:t("v4_choose_rooms","Choose rooms"),description:t("v4_choose_rooms_detail","Select on the map or from the list.")};case"draw":return{title:t("v4_draw_area","Draw an area"),description:t("v4_draw_area_detail","Paint on the verified map, then review the details.")};case"plan":return{title:t("v4_plan","Plan"),description:t("v4_plan_detail","Review rooms and cleaning settings.")};case"areaReview":return{title:t("area_details","Area details"),description:t("area_details_hint","Name the area and choose cleaning settings.")};case"history":return{title:t("v4_map_history","Map history"),description:t("v4_map_history_detail","Saved maps are floor-scoped and read only.")};case"support":return{title:t("v4_map_support","Map support"),description:t("v4_map_support_detail","Private geometry is never included.")};case"none":return{title:t("v4_clean","Start cleaning"),description:t("v4_clean_detail","Choose rooms, a saved plan, or a custom area.")}}},Ho=(o,e)=>{let t=(r,n)=>R(e,r,n);switch(o){case"discardDraft":return{title:t("v4_discard_area","Discard this area?"),detail:t("v4_discard_area_detail","The outline has not been saved. You can keep drawing or discard it."),cancelLabel:t("v4_keep_drawing","Keep drawing"),confirmLabel:t("v4_discard","Discard"),action:"discard"};case"confirmDeletePlan":return{title:t("v4_delete_plan","Delete this plan?"),detail:t("v4_delete_plan_detail","This removes the saved plan from Home Assistant. The robot will not move."),cancelLabel:t("v4_cancel","Cancel"),confirmLabel:t("plan_delete","Delete plan"),action:"delete-plan"};case"confirmDeleteArea":return{title:t("v4_delete_area","Delete this area?"),detail:t("v4_delete_area_detail","This removes the saved outline from Home Assistant. The robot will not move."),cancelLabel:t("v4_cancel","Cancel"),confirmLabel:t("area_delete","Delete area"),action:"delete-area"};case"confirmStop":return{title:t("v4_stop_cleaning","Stop cleaning?"),detail:t("v4_stop_cleaning_detail","The robot may take a moment to settle before another action is available."),cancelLabel:t("v4_keep_cleaning","Keep cleaning"),confirmLabel:t("v4_stop","Stop"),action:"stop"};case"error":return{title:t("v4_error","Something went wrong"),detail:t("v4_error_detail","No action was started. Close this message and try again when the map is ready."),cancelLabel:t("v4_close","Close"),confirmLabel:t("v4_close","Close"),action:null};case null:return null}},Fo=(o=document)=>{let e=o.activeElement;for(;e?.shadowRoot?.activeElement;)e=e.shadowRoot.activeElement;return e},Lt=class extends x{constructor(){super(...arguments);this.state=M();this._measuredNarrow=!1;this._sheetOffset=0;this._overflowOpen=!1;this._browserFullscreen=!1;this._sheetDetent="half";this.#t=null;this.#a=null;this.#r=null;this.#n=null;this.#o=null;this.#c=null;this.#d=()=>{this._browserFullscreen=document.fullscreenElement===this.renderRoot.querySelector(".app")};this.#u=t=>{if(!this._overflowOpen)return;let r=this.renderRoot.querySelector(".overflow-wrap");(!r||!t.composedPath().includes(r))&&(this._overflowOpen=!1)}}static{this.properties={state:{attribute:!1},localize:{attribute:!1},_measuredNarrow:{state:!0},_sheetOffset:{state:!0},_overflowOpen:{state:!0},_browserFullscreen:{state:!0},_sheetDetent:{state:!0}}}static{this.styles=N`
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
  `}#e(t,r,n){return R(this.localize,t,r,n)}#t;#a;#r;#n;#o;#c;#d;#u;connectedCallback(){super.connectedCallback(),this.#t=new ResizeObserver(([t])=>{if(!t)return;let r=t.contentRect.width<768||t.contentRect.height<480;r!==this._measuredNarrow&&(this._measuredNarrow=r)}),this.#t.observe(this),window.addEventListener("pointerdown",this.#u,!0),document.addEventListener("fullscreenchange",this.#d),this.#a=new ResizeObserver(([t])=>{if(!t)return;let r=Math.ceil(t.target.getBoundingClientRect().height);r!==this._sheetOffset&&(this._sheetOffset=r)})}disconnectedCallback(){this.#t?.disconnect(),this.#t=null,this.#a?.disconnect(),this.#a=null,this.#r=null,window.removeEventListener("pointerdown",this.#u,!0),document.removeEventListener("fullscreenchange",this.#d),super.disconnectedCallback()}updated(t){let r=this.renderRoot.querySelector(".mobile-sheet");if(r!==this.#r&&(this.#a?.disconnect(),this.#r=r,r&&this.#a?.observe(r)),t.has("state")){let n=t.get("state");if(n?.precisionOpen&&!this.state.precisionOpen&&this.#n?.focus(),!n?.dialog&&this.state.dialog){let a=Fo(this.shadowRoot||document);a?.hasAttribute("data-dialog-launcher")&&(this.#o=a),this.updateComplete.then(()=>{this.renderRoot.querySelector(".dialog button")?.focus()})}else if(n?.dialog&&!this.state.dialog){let a=this.#o?.isConnected&&this.#o.hasAttribute("data-dialog-launcher")?this.#o:this.#E(n.dialog);this.#o=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>a?.focus({preventScroll:!0}))})}(!n||n.workflow!==this.state.workflow)&&(this._sheetDetent="half")}}#s(t){this.dispatchEvent(new CustomEvent(ne,{detail:t,bubbles:!0,composed:!0}))}#m(t){if(t.enabled){if(t.id==="return-live"){this.#s({type:"set-history",historyId:null});return}this.#f(t.id)}}#b(t){if(this.state.workflow==="draw"&&this.state.draw.dirty&&t!=="draw"&&t!=="areaReview"){this.#c=t,this.#s({type:"open-dialog",dialog:"discardDraft"});return}this.#s({type:"open-workflow",workflow:t})}#w(){let t=this.#c;this.#c=null,this.#s({type:"discard-draft"}),t&&queueMicrotask(()=>this.#s({type:"open-workflow",workflow:t}))}#h(){this.#c=null,this.#_()}#_(){let t=this.state.dialog,r=t&&this.#o?.isConnected&&this.#o.hasAttribute("data-dialog-launcher")?this.#o:t?this.#E(t):null;this.#s({type:"dismiss-top-layer"}),r&&requestAnimationFrame(()=>r.focus({preventScroll:!0}))}#f(t){this.dispatchEvent(new CustomEvent(qe,{detail:{id:t},bubbles:!0,composed:!0}))}#l(t){this.#s({type:"dismiss-top-layer"}),this.#f(t)}#v(t){if(t.action==="discard"){this.#w();return}if(t.action==="delete-plan"||t.action==="delete-area"){this.#l(t.action);return}this.#s({type:"dismiss-top-layer"}),t.action==="stop"&&this.#f("stop")}#$(){this._sheetDetent=this._sheetDetent==="peek"?"half":this._sheetDetent==="half"?"full":"peek"}#x(){if(this.state.precisionOpen||this.state.fullMap){this.#s({type:"dismiss-top-layer"});return}if(this.state.workflow!=="none"){this.#b("none");return}this.#i()}#i(){this.dispatchEvent(new CustomEvent("hass-toggle-menu",{bubbles:!0,composed:!0}))}#y(t){if(this._overflowOpen=!1,t==="support"){this.#b("support");return}if(t==="fullscreen"){let r=this.renderRoot.querySelector(".app");document.fullscreenElement?document.exitFullscreen():r?.requestFullscreen();return}this.dispatchEvent(new CustomEvent(qe,{detail:{id:"use-classic"},bubbles:!0,composed:!0}))}#g(t){this.#n=t.currentTarget,this.#s({type:"set-precision-open",value:!this.state.precisionOpen})}#p(t){let r=t;if(r.detail?.type!=="open-dialog")return;let n=r.composedPath().find(a=>a instanceof HTMLElement&&a.hasAttribute("data-dialog-launcher"));n instanceof HTMLElement&&(this.#o=n)}#E(t){return this.renderRoot.querySelector(pe)?.shadowRoot?.querySelector(`[data-dialog-launcher="${t}"]`)??null}#C(t){if(!(t.defaultPrevented||t.ctrlKey||t.metaKey||t.altKey)&&t.key==="Escape"){if(t.preventDefault(),this._overflowOpen){this._overflowOpen=!1;return}this.#s({type:"dismiss-top-layer"})}}#M(t){if(t.key!=="Tab")return;let r=[...this.renderRoot.querySelectorAll(".dialog button:not(:disabled)")],n=r[0],a=r.at(-1);!n||!a||(t.shiftKey&&this.shadowRoot?.activeElement===n?(t.preventDefault(),a.focus()):!t.shiftKey&&this.shadowRoot?.activeElement===a&&(t.preventDefault(),n.focus()))}#A(t,r="primary-action"){if(t.id==="choose-cleaning")return m;let a={stop:["v4_stop","Stop"],resume:["v4_resume","Resume"],"review-area":["v4_review_details","Review details"],"save-area":["area_save","Save area"],"run-area":["area_run","Clean area"],"save-plan":["plan_save","Save plan"],"run-plan":["plan_run","Run plan"]}[t.id],i=t.id==="clean-rooms"?t.label:a?this.#e(a[0],a[1]):t.label;return f`
      <button
        class=${`${r} ${t.kind==="danger"?"danger":""}`}
        type="button"
        ?disabled=${!t.enabled}
        title=${t.reason??""}
        @click=${()=>this.#m(t)}
      >${i}</button>
    `}#k(t){return t.workflow==="none"?f`
      <div class="quick-actions" aria-label=${this.#e("v4_cleaning_choices","Cleaning choices")}>
        <button class="featured" type="button" @click=${()=>this.#b("rooms")}>
          <span class="quick-copy"><strong>${this.#e("map_rooms","Rooms")}</strong><small>${this.#e("v4_rooms_quick_detail","Pick rooms and clean them now.")}</small></span><span class="quick-arrow" aria-hidden="true">›</span>
        </button>
        <button type="button" @click=${()=>this.#b("plan")}>
          <span class="quick-copy"><strong>${this.#e("cleaning_workspace_plans","Plans")}</strong><small>${this.#e("v4_plans_quick_detail","Run or edit a saved routine.")}</small></span><span class="quick-arrow" aria-hidden="true">›</span>
        </button>
        <button type="button" @click=${()=>this.#b("draw")}>
          <span class="quick-copy"><strong>${this.#e("area_workspace_title","Custom areas")}</strong><small>${this.#e("v4_areas_quick_detail","Use or draw a precise outline.")}</small></span><span class="quick-arrow" aria-hidden="true">›</span>
        </button>
        <button type="button" @click=${()=>this.#b("history")}>
          <span class="quick-copy"><strong>${this.#e("map_timeline_history","History")}</strong><small>${this.#e("v4_history_quick_detail","Browse earlier floor maps.")}</small></span><span class="quick-arrow" aria-hidden="true">›</span>
        </button>
      </div>
    `:f`<${Ir}
      .state=${t}
      .localize=${this.localize}
      @matic-workspace-intent=${this.#p}
    ></${Ir}>`}render(){let t=this.state,r=t.narrowHint||this._measuredNarrow,n=Wo(t,this.localize),a=Uo(t,this.localize),i=Vt({...t,narrowHint:r}),s=Kt(t),l=!r&&i.id==="stop"?i:!r&&s?.id==="stop"?s:null,c=l===i?null:i,d=l===s?null:s,u=t.workflow==="draw"&&(r||t.fullMap),h=t.fullMap&&(t.coherence==="verifying"||t.coherence==="booting"),p=t.fullMap||t.precisionOpen,g=Ho(t.dialog,this.localize),_=t.resources.history.value?.floors||[],w=_.length?_.map((b,C)=>({id:b.active?"current":b.id,label:`${b.label||(b.active?this.#e("v4_current_floor","Current floor"):this.#e("v4_saved_floor","Saved floor {number}",{number:b.ordinal??C+1}))}${!b.active&&b.snapshots.length===0?` \xB7 ${this.#e("v4_floor_not_captured","Visit floor to capture")}`:""}`,disabled:!b.active&&b.snapshots.length===0})):[{id:t.selection.floorId,label:t.floor.displayName,disabled:!1}];return f`
      <div class=${`root ${r?"narrow":"wide"}`} @keydown=${this.#C}>
        <div class="app">
          <header class="app-bar">
            <button
              class="nav"
              type="button"
              aria-label=${p?this.#e("v4_back","Back"):this.#e("v4_open_navigation","Open navigation")}
              @click=${this.#x}
            >${p?"\u2190":"\u2630"}</button>
            <h1 class="title">${this.#e("map_studio_title","Matic Map")}</h1>
            ${t.robots.length>1?f`
              <select
                class="context-switcher robot-switcher"
                aria-label=${this.#e("v4_choose_robot","Choose robot")}
                .value=${t.selection.entryId||""}
                @change=${b=>this.#s({type:"select-entry",entryId:b.currentTarget.value})}
              >${t.robots.map(b=>f`
                <option value=${b.entryId}>${b.label}</option>
              `)}</select>
            `:m}
            <select
              class="context-switcher floor-switcher"
              aria-label=${this.#e("v4_choose_floor","Choose floor")}
              ?disabled=${w.length<=1}
              .value=${t.selection.floorId}
              @change=${b=>this.#s({type:"set-floor",floorId:b.currentTarget.value})}
            >${w.map(b=>f`
              <option value=${b.id} ?disabled=${b.disabled}>${b.label}</option>
            `)}</select>
            <span class="spacer"></span>
            <div class="overflow-wrap">
              <button
                class="overflow"
                type="button"
                aria-label=${this.#e("map_more","More map options")}
                aria-expanded=${String(this._overflowOpen)}
                @click=${()=>{this._overflowOpen=!this._overflowOpen}}
              >⋮</button>
              ${this._overflowOpen?f`
                <div class="overflow-menu" role="menu">
                  <label class="overflow-field">${this.#e("map_quality_label","Scene detail")}
                    <select
                      .value=${t.quality}
                      @change=${b=>this.#s({type:"set-quality",quality:b.currentTarget.value})}
                    >
                      <option value="auto">${this.#e("map_quality_auto","Auto detail")}</option>
                      <option value="efficient">${this.#e("map_quality_efficient","Efficient")}</option>
                      <option value="balanced">${this.#e("map_quality_balanced","Balanced")}</option>
                      <option value="maximum">${this.#e("map_quality_maximum","Maximum")}</option>
                    </select>
                  </label>
                  <button role="menuitem" type="button" @click=${()=>this.#y("fullscreen")}>${this._browserFullscreen?this.#e("exit_fullscreen","Exit full screen"):this.#e("expand_map","Browser full screen")}</button>
                  <button role="menuitem" type="button" @click=${()=>this.#y("support")}>${this.#e("v4_map_support","Map support")}</button>
                  <button role="menuitem" type="button" @click=${()=>this.#y("classic")}>${this.#e("v4_use_classic","Use classic Map Studio")}</button>
                </div>
              `:m}
            </div>
          </header>

          <main class=${`workspace ${t.fullMap?"full-map":""}`}>
            <div class="canvas">
              <${Er}
                class="map-canvas"
                style=${r&&!t.fullMap?`--map-sheet-offset:${this._sheetOffset}px`:"--map-sheet-offset:0px"}
                .state=${t}
                .localize=${this.localize}
              ></${Er}>
            </div>

            ${u?f`
              <div class="precision-popover">
                <button
                  class="precision-chip"
                  type="button"
                  aria-expanded=${String(t.precisionOpen)}
                  @click=${this.#g}
                >${t.draw.zoomPercent}% · ${t.draw.brushMeters.toFixed(2)} m</button>
                <button
                  class="precision-chip"
                  type="button"
                  ?disabled=${t.draw.circles.length===0}
                  @click=${()=>this.#s({type:"clear-draft"})}
                >${this.#e("clear","Clear")}</button>
                ${t.precisionOpen?f`
                  <${Rr} compact .state=${t} .localize=${this.localize}></${Rr}>
                `:m}
              </div>
            `:m}

            <aside class="inspector" aria-label="Map workspace">
              <div class="status-strip">
                <span class="status-icon" aria-hidden="true">◆</span>
                <span><strong>${n.title}</strong><small>${n.detail}</small></span>
                ${l?f`
                  <button
                    class="status-action"
                    type="button"
                    ?disabled=${!l.enabled}
                    title=${l.reason??""}
                    @click=${()=>this.#m(l)}
                  >${this.#e("v4_stop","Stop")}</button>
                `:m}
              </div>
              <section class="workflow">
                <div class="workflow-heading">
                  ${t.workflow!=="none"?f`
                    <button
                      class="workflow-back"
                      type="button"
                      aria-label=${this.#e("v4_back","Back")}
                      @click=${()=>this.#b("none")}
                    >←</button>
                  `:m}
                  <h2 tabindex="-1">${a.title}</h2>
                </div>
                <p>${a.description}</p>
                ${this.#k(t)}
                <div class="primary-stack">
                  ${c?this.#A(c):m}
                  ${d?this.#A(d,"secondary-action"):m}
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
                @click=${this.#$}
              >
                <span class="sheet-handle" aria-hidden="true"></span>
                <span class="sheet-title">${a.title}</span>
                <span class="sheet-description">${a.description}</span>
              </button>
              <div class="sheet-body">
                ${t.workflow==="draw"?m:this.#k(t)}
              </div>
              <div class="primary-stack">
                ${c?this.#A(c):m}
                ${d?this.#A(d,"secondary-action"):m}
              </div>
            </section>

            ${t.fullMap?f`
              <section
                class=${`full-map-hud ${s?"has-secondary":""}`}
                aria-label="Robot status and action"
              >
                <span class="hud-copy"><strong>${n.title}</strong><small>${n.detail}</small></span>
                ${h?m:this.#A(i)}
                ${!h&&s?this.#A(s,"secondary-action"):m}
              </section>
            `:m}
          </main>
        </div>

        ${g?f`
          <div class="dialog-backdrop">
            <section
              class="dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="dialog-title"
              @keydown=${this.#M}
            >
              <h2 id="dialog-title">${g.title}</h2>
              <p>${g.detail}</p>
              <div class="dialog-actions">
                <button
                  type="button"
                  @click=${t.dialog==="discardDraft"?this.#h:this.#_}
                >${g.cancelLabel}</button>
                ${g.action===null?m:f`
                  <button
                    class="discard"
                    type="button"
                    @click=${()=>this.#v(g)}
                  >${g.confirmLabel}</button>
                `}
              </div>
            </section>
          </div>
        `:m}
      </div>
    `}};customElements.get(re)||customElements.define(re,Lt);var Lr=U(re),Tt=class extends x{constructor(){super(...arguments);this.scenario="ready";this.narrow=!1;this.controls=!0;this._workspace=lt("ready");this.#e=new le(this._workspace);this.#t=null}static{this.properties={scenario:{type:String,reflect:!0},narrow:{type:Boolean,reflect:!0},controls:{type:Boolean,reflect:!0},_workspace:{state:!0}}}static{this.styles=N`
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
    .shell { block-size: 100%; }
  `}#e;#t;connectedCallback(){super.connectedCallback(),this.#t=this.#e.subscribe(t=>{this._workspace=t})}disconnectedCallback(){this.#t?.(),this.#t=null,super.disconnectedCallback()}willUpdate(t){t.has("scenario")?this.#e.replace({...lt(this.scenario),narrowHint:this.narrow}):t.has("narrow")&&this.#e.dispatch({type:"set-narrow-hint",value:this.narrow})}setScenario(t){ct.includes(t)&&(this.scenario=t)}getWorkspaceSnapshot(){return structuredClone(this.#e.value)}replaceWorkspaceState(t){this.#e.replace(structuredClone(t))}#a(t){Te(t.detail)&&(t.stopPropagation(),this.#e.dispatch(t.detail))}render(){return f`
      ${this.controls?f`
        <nav class="gallery-controls" aria-label="Map Studio states">
          ${ct.map(t=>f`
            <button
              type="button"
              aria-pressed=${String(this.scenario===t)}
              @click=${()=>{this.scenario=t}}
            >${t}</button>
          `)}
        </nav>
      `:null}
      <div class="stage">
        <${Lr}
          class="shell"
          .state=${this._workspace}
          @matic-workspace-intent=${this.#a}
        ></${Lr}>
      </div>
    `}};customElements.get("matic-map-studio-gallery-v0-4-0")||customElements.define("matic-map-studio-gallery-v0-4-0",Tt);var Tr="/api/matic_robot/slam_entries";var y=class extends Error{constructor(e){super(e),this.name="ContractError",this.code=e}},L=(o,e)=>{if(!o||typeof o!="object"||Array.isArray(o))throw new y(e);return o},$=(o,e,t)=>{if(typeof o!="string")throw new y(t);let r=o.trim();if(!r||Array.from(r).length>e||/[\u0000-\u001f\u007f]/u.test(r))throw new y(t);return r},Bo=o=>{if(o==null||o==="")return null;try{return $(o,128,"invalid-floor-label")}catch{return null}},fe=(o,e,t,r)=>{if(typeof o!="number"||!Number.isFinite(o)||o<e||o>t)throw new y(r);return o},W=(o,e,t,r)=>{let n=fe(o,e,t,r);if(!Number.isInteger(n))throw new y(r);return n},zt=(o,e)=>o==null?null:W(o,1,e,"invalid-floor-ordinal"),S=(o,e)=>{if(typeof o!="boolean")throw new y(e);return o},qo=(o,e)=>o===null?null:S(o,e),zr=o=>{if(o==null)return null;let e=$(o,64,"invalid-map-session-key");if(!/^[0-9a-f]{64}$/u.test(e))throw new y("invalid-map-session-key");return e},Xo=o=>{if(o==null)return null;if(o==="bootstrap_empty"||o==="map_session_unverified"||o==="floor_plan_unavailable"||o==="floor_plan_mismatch")return o;throw new y("invalid-map-block-reason")},Vo=o=>{if(o===void 0)return"not_started";if(o==="not_started"||o==="running"||o==="complete"||o==="partial"||o==="failed")return o;throw new y("invalid-bootstrap-state")},V=(o,e)=>{let t=$(o,512,e);if(!t.startsWith("/")||t.startsWith("//")||t.includes("\\"))throw new y(e);return t},Ko=o=>{let e=typeof o.map_health=="string"?o.map_health.toLowerCase():"",t=typeof o.stream_state=="string"?o.stream_state.toLowerCase():"",r=typeof o.invalid_tiles=="number"?o.invalid_tiles:0;return e.includes("error")||e.includes("fail")||e.includes("degrad")||r>0?"problem":o.map_truncated===!0||e.includes("truncat")||e.includes("limit")?"limited":o.map_complete===!0?"ready":t.includes("connect")||t.includes("collect")||t.includes("run")?"building":"unknown"},Dr=o=>{let e=L(o,"invalid-catalog");if(!Array.isArray(e.entries)||e.entries.length>64)throw new y("invalid-catalog-entries");return e.entries.map(t=>{let r=L(t,"invalid-catalog-entry"),n=W(r.map_revision,0,Number.MAX_SAFE_INTEGER,"invalid-map-revision");return{entryId:$(r.entry_id,128,"invalid-entry-id"),sceneUrl:V(r.scene_url,"invalid-scene-url"),deltaUrl:r.delta_url===void 0||r.delta_url===null?null:V(r.delta_url,"invalid-delta-url"),poseUrl:V(r.pose_url,"invalid-pose-url"),historyUrl:V(r.history_url,"invalid-history-url"),areasUrl:V(r.areas_url,"invalid-areas-url"),plansUrl:V(r.plans_url,"invalid-plans-url"),mapRevision:n,mapFloorCoherent:S(r.map_floor_coherent,"invalid-floor-coherence"),mapSessionVerified:S(r.map_session_verified,"invalid-session-state"),mapSessionKey:zr(r.map_session_key),mapBlockReason:Xo(r.map_block_reason),runnerLocked:S(r.runner_locked,"invalid-runner-lock"),stopSettlePending:S(r.stop_settle_pending,"invalid-stop-settle"),activePlan:S(r.active_plan,"invalid-active-plan"),nativeReconciliationPending:S(r.native_reconciliation_pending,"invalid-native-reconciliation"),nativeSessionActive:qo(r.native_session_active,"invalid-native-session"),mapComplete:S(r.map_complete,"invalid-map-complete"),mapTruncated:S(r.map_truncated,"invalid-map-truncated"),selectedFloorOrdinal:zt(r.selected_floor_ordinal,128),mapFloorOrdinal:zt(r.map_floor_ordinal,128),historyCount:W(r.history_count,0,12,"invalid-history-count"),historyFloorCount:W(r.history_floor_count,0,128,"invalid-floor-count"),health:Ko(r),streamFailures:W(r.stream_failures,0,Number.MAX_SAFE_INTEGER,"invalid-stream-failures"),bootstrapState:Vo(r.bootstrap_state),bootstrapPhotoSeen:r.bootstrap_photo_seen===void 0?!1:S(r.bootstrap_photo_seen,"invalid-bootstrap-photo"),bootstrapStructureSeen:r.bootstrap_structure_seen===void 0?!1:S(r.bootstrap_structure_seen,"invalid-bootstrap-structure"),bootstrapFailures:r.bootstrap_failures===void 0?0:W(r.bootstrap_failures,0,2,"invalid-bootstrap-failures")}})},Or=(o,e)=>{if(!Array.isArray(o)||o.length!==2)throw new y(e);return[fe(o[0],-1e6,1e6,e),fe(o[1],-1e6,1e6,e)]},Yo=(o,e)=>{if(!Array.isArray(o)||o.length<3||o.length>8192)throw new y(e);return o.map(t=>Or(t,e))},Nr=(o,e)=>{if(!Array.isArray(o)||o.length>256)throw new y("invalid-rooms");return o.map(t=>{let r=L(t,"invalid-room");return{roomId:$(r.room_id,128,"invalid-room-id"),name:$(r.name,128,"invalid-room-name"),boundary:e?Yo(r.boundary,"invalid-room-boundary"):[]}})},Go=o=>{let e=L(o,"invalid-history-snapshot"),t=$(e.created_at,64,"invalid-history-time");if(!Number.isFinite(Date.parse(t)))throw new y("invalid-history-time");return{id:$(e.id,128,"invalid-history-id"),createdAt:t,revision:W(e.revision,0,Number.MAX_SAFE_INTEGER,"invalid-history-revision"),pointCount:W(e.point_count,1,15e5,"invalid-history-points"),sceneUrl:V(e.scene_url,"invalid-history-scene-url")}},Wr=o=>{let e=L(o,"invalid-history");if(!Array.isArray(e.floors)||e.floors.length<1||e.floors.length>128)throw new y("invalid-history-floors");return{entryId:$(e.entry_id,128,"invalid-history-entry"),liveAvailable:S(e.live_available,"invalid-history-live"),floors:e.floors.map(t=>{let r=L(t,"invalid-history-floor");if(!Array.isArray(r.snapshots)||r.snapshots.length>12)throw new y("invalid-history-snapshots");return{id:$(r.id,128,"invalid-history-floor-id"),active:S(r.active,"invalid-history-floor-active"),readOnly:S(r.read_only,"invalid-history-floor-read-only"),liveAvailable:r.live_available===void 0?!1:S(r.live_available,"invalid-history-floor-live"),label:Bo(r.label),ordinal:r.ordinal===void 0?null:zt(r.ordinal,128),snapshots:r.snapshots.map(Go)}})}},Ur=o=>{if(o==="vacuum"||o==="mop"||o==="vacuum_and_mop")return o;throw new y("invalid-cleaning-mode")},Hr=o=>{if(o==="quick"||o==="standard"||o==="heavy_duty")return o;throw new y("invalid-coverage-setting")},jo=o=>{let e=L(o,"invalid-area-circle");return{x:fe(e.x,-1e6,1e6,"invalid-area-circle"),y:fe(e.y,-1e6,1e6,"invalid-area-circle"),radius:fe(e.radius,.05,2.5,"invalid-area-circle")}},Zo=o=>o==="current"||o==="review"||o==="stale"?o:"unknown",Fr=o=>{let e=L(o,"invalid-areas");if(!Array.isArray(e.areas)||e.areas.length>256)throw new y("invalid-area-list");return{sceneUrl:V(e.scene_url,"invalid-area-scene-url"),rooms:Nr(e.rooms,!0),areas:e.areas.map(t=>{let r=L(t,"invalid-area");if(!Array.isArray(r.circles)||r.circles.length>512)throw new y("invalid-area-circles");return{id:$(r.id,128,"invalid-area-id"),name:$(r.name,128,"invalid-area-name"),circles:r.circles.map(jo),cleaningMode:Ur(r.cleaning_mode),coverageSetting:Hr(r.coverage_setting),status:Zo(r.status),canRebind:S(r.can_rebind,"invalid-area-rebind")}})}},Br=o=>{let e=L(o,"invalid-plans");if(!Array.isArray(e.plans)||e.plans.length>256)throw new y("invalid-plan-list");return{rooms:Nr(e.rooms,!1).map(({roomId:r,name:n})=>({roomId:r,name:n})),selectedPlan:e.selected_plan===null||e.selected_plan===void 0?null:$(e.selected_plan,128,"invalid-selected-plan"),plans:e.plans.map(r=>{let n=L(r,"invalid-plan");if(!Array.isArray(n.rooms)||n.rooms.length>256||!Array.isArray(n.room_order))throw new y("invalid-plan-rooms");let a=n.run_behavior;if(a!=="intelligent"&&a!=="ordered")throw new y("invalid-run-behavior");return{id:$(n.id,128,"invalid-plan-id"),name:$(n.name,128,"invalid-plan-name"),enabled:S(n.enabled,"invalid-plan-enabled"),runBehavior:a,rooms:n.rooms.map(i=>{let s=L(i,"invalid-plan-room");return{roomId:$(s.room_id,128,"invalid-plan-room-id"),cleaningMode:Ur(s.cleaning_mode),coverageSetting:Hr(s.coverage_setting)}}),roomOrder:n.room_order.slice(0,256).map(i=>$(i,128,"invalid-room-order")),returnToBase:S(n.return_to_base,"invalid-return-to-base"),finishCurrentRoom:S(n.finish_current_room,"invalid-finish-room"),finishCurrentRoomThreshold:W(n.finish_current_room_threshold,0,100,"invalid-finish-threshold")}})}},qr=o=>{let e=L(o,"invalid-pose"),t=e.position,r=t===null?null:Or(t,"invalid-pose-position"),n=e.pose_freshness;if(n!=="live"&&n!=="coordinator_fallback")throw new y("invalid-pose-freshness");return{position:r,source:$(e.source,64,"invalid-pose-source"),revision:W(e.revision,0,Number.MAX_SAFE_INTEGER,"invalid-pose-revision"),poseRevision:W(e.pose_revision,0,Number.MAX_SAFE_INTEGER,"invalid-pose-sequence"),floorCoherent:S(e.map_floor_coherent,"invalid-pose-floor"),mapSessionKey:zr(e.map_session_key),freshness:n}},Xr=o=>{try{return V(o,"invalid-private-path"),!0}catch{return!1}};var Vr=o=>{let a=()=>{throw new Error("invalid-scene")};(!(o instanceof ArrayBuffer)||o.byteLength<24||o.byteLength>16777216)&&a();let i=new DataView(o),s=new Uint8Array(o,0,8),l=String.fromCharCode(...s),c=i.getUint16(8,!0),d=i.getUint16(10,!0),u=i.getUint32(12,!0),h=i.getUint32(16,!0),p=i.getUint32(20,!0),g=h+p,_=24+u;(l!=="MATIC3D\0"||c!==1||d!==8||u>1024*1024||g<1||g>15e5||_+g*d!==o.byteLength)&&a();let w;try{w=JSON.parse(new TextDecoder("utf-8",{fatal:!0}).decode(new Uint8Array(o,24,u)))}catch{a()}(!w||typeof w!="object"||Array.isArray(w))&&a();let b=w,C=b.meters_per_cell,k=b.origin_cells,I=b.span_cells;(typeof C!="number"||!Number.isFinite(C)||C<.001||C>.1||!Array.isArray(k)||k.length!==2||!k.every(T=>typeof T=="number"&&Number.isFinite(T))||!Array.isArray(I)||I.length!==2||!I.every(T=>typeof T=="number"&&Number.isFinite(T)&&T>=1&&T<=65536))&&a();let Ee=(Array.isArray(b.rooms)?b.rooms.slice(0,128):[]).flatMap((T,lo)=>{if(!T||typeof T!="object"||Array.isArray(T))return[];let G=T,Re=typeof G.name=="string"?G.name.trim():"";if(!Re||Array.from(Re).length>128||/[\u0000-\u001f\u007f]/u.test(Re))return[];if(!Array.isArray(G.boundary)||G.boundary.length<3||G.boundary.length>8192)return[];let Bt=G.boundary.flatMap(tt=>{if(!Array.isArray(tt)||tt.length!==2)return[];let[rt,ot]=tt;return typeof rt=="number"&&Number.isFinite(rt)&&typeof ot=="number"&&Number.isFinite(ot)?[[rt,ot]]:[]}),Qe=G.center;if(Bt.length<3||!Array.isArray(Qe)||Qe.length!==2)return[];let[Je,et]=Qe;return typeof Je!="number"||!Number.isFinite(Je)||typeof et!="number"||!Number.isFinite(et)?[]:[{id:`scene-room-${lo+1}`,name:Re,boundary:Bt,center:[Je,et]}]}),so=typeof b.sample_step=="number"&&Number.isInteger(b.sample_step)?Math.max(1,Math.min(15e5,b.sample_step)):1,Ht=k,Ft=I;return{buffer:o,pointOffset:_,floorCount:h,surfaceCount:p,total:g,metadata:{metersPerCell:C,origin:[Ht[0],Ht[1]],span:[Ft[0],Ft[1]],sampleStep:so,rooms:Ee}}},tn=o=>{if(o.byteLength>16777216||o.byteLength<24||!1||!1)throw new y("invalid-scene");try{return Vr(o)}catch{throw new y("invalid-scene")}},rn=()=>`
  const parseTransfer = ${Vr.toString()};
  self.onmessage = (event) => {
    const { id, buffer } = event.data;
    try {
      const parsed = parseTransfer(buffer);
      self.postMessage({ id, ok: true, parsed }, [parsed.buffer]);
    } catch (_) {
      self.postMessage({ id, ok: false, problem: "invalid-scene" });
    }
  };
`,Xe=class{#e=null;#t=null;#a=0;#r=new Map;constructor(){if(!(typeof Worker!="function"||typeof URL?.createObjectURL!="function"))try{this.#t=URL.createObjectURL(new Blob([rn()],{type:"text/javascript"})),this.#e=new Worker(this.#t),this.#e.onmessage=e=>{let t=this.#r.get(e.data.id);t&&(this.#r.delete(e.data.id),e.data.ok&&e.data.parsed?t.resolve(e.data.parsed):t.reject(new y(e.data.problem||"invalid-scene")))},this.#e.onerror=()=>this.#n("scene-worker-failed")}catch{this.#e=null,this.#t&&URL.revokeObjectURL(this.#t),this.#t=null}}async parse(e,t){if(t?.aborted)throw new DOMException("Aborted","AbortError");if(!this.#e){if(await new Promise(n=>window.setTimeout(n,0)),t?.aborted)throw new DOMException("Aborted","AbortError");return tn(e)}let r=++this.#a;return new Promise((n,a)=>{let i=()=>{this.#r.delete(r),a(new DOMException("Aborted","AbortError"))};t?.addEventListener("abort",i,{once:!0}),this.#r.set(r,{resolve:s=>{t?.removeEventListener("abort",i),n(s)},reject:s=>{t?.removeEventListener("abort",i),a(s)}}),this.#e?.postMessage({id:r,buffer:e},[e])})}#n(e){for(let t of this.#r.values())t.reject(new y(e));this.#r.clear(),this.#e?.terminate(),this.#e=null}dispose(){this.#n("scene-parser-disposed"),this.#t&&URL.revokeObjectURL(this.#t),this.#t=null}};var K={catalog:1e4,scene:6e4,delta:35e3,pose:1e4,history:15e3,workflow:15e3,mutation:2e4},D=class extends Error{constructor(e,t=null){super(e),this.name="BackendError",this.code=e,this.status=t}},Ae=36,ye=16*1024*1024,Kr=(o,e)=>{let t=Number(o);if(!Number.isSafeInteger(t)||t<0)throw new y(e);return t},Yr=(o,e)=>{let t=o.headers.get("X-Matic-Revision");if(t===null)return e;let r=Number(t);if(!Number.isSafeInteger(r)||r<0)throw new y("invalid-scene-revision");return r},Gr=(o,e)=>{let t=o.headers.get("X-Matic-Floor-Coherent");if(t===null)return e;if(t==="1")return!0;if(t==="0")return!1;throw new y("invalid-scene-floor-header")},Ve=class{#e;#t=new Xe;constructor(e){this.#e=e}async#a(e,t,r,n){if(!Xr(e))throw new D("invalid-private-path");if(n?.aborted)throw new DOMException("Aborted","AbortError");let a=new AbortController,i=()=>a.abort();n?.addEventListener("abort",i,{once:!0});let s=!1,l=window.setTimeout(()=>{s=!0,a.abort()},r);try{let c=this.#e(),d=new Headers(t.headers),u={...t,cache:"no-store",credentials:"same-origin",headers:Object.fromEntries(d.entries()),signal:a.signal};if(typeof c?.fetchWithAuth=="function")return await c.fetchWithAuth(e,u);let h=c?.auth?.accessToken||c?.auth?.data?.access_token;h&&d.set("Authorization",`Bearer ${h}`);let p=typeof c?.hassUrl=="function"?c.hassUrl(e):e;return await fetch(p,{...u,headers:d})}catch(c){throw s&&!n?.aborted?new D("request-timeout"):a.signal.aborted?new DOMException("Aborted","AbortError"):c}finally{window.clearTimeout(l),n?.removeEventListener("abort",i)}}async#r(e,t,r,n={}){let a=await this.#a(e,{...n,headers:{Accept:"application/json",...n.headers||{}}},t,r);if(!a.ok)throw new D("request-failed",a.status);try{return await a.json()}catch{throw new y("invalid-json-response")}}async catalog(e){return Dr(await this.#r(Tr,K.catalog,e))}async scene(e,t,r,n,a,i){let s=new Headers({Accept:"application/vnd.matic.slam-scene"});n==="live"&&s.set("X-Matic-Prefer-Cached","1"),i&&s.set("If-None-Match",i);let l=await this.#a(e,{headers:s},K.scene,a),c=Yr(l,t),d=Gr(l,r);if(l.status===304)return{scene:null,floorCoherent:d,revision:c,notModified:!0};if(!l.ok)throw new D("scene-request-failed",l.status);if(l.headers.get("Content-Type")?.split(";",1)[0]!=="application/vnd.matic.slam-scene")throw new y("invalid-scene-content-type");return{scene:{...await this.#t.parse(await l.arrayBuffer(),a),revision:c,etag:l.headers.get("ETag"),source:n},floorCoherent:d,revision:c,notModified:!1}}async#n(e,t,r){if(!Number.isSafeInteger(t)||t<1||t>ye||typeof DecompressionStream!="function")throw new y("invalid-scene-delta");let a=new Blob([e]).stream().pipeThrough(new DecompressionStream("deflate")).getReader(),i=new Uint8Array(t),s=0,l=()=>{a.cancel()};r?.addEventListener("abort",l,{once:!0});try{for(;;){if(r?.aborted)throw new DOMException("Aborted","AbortError");let{done:c,value:d}=await a.read();if(c)break;if(!(d instanceof Uint8Array)||s+d.byteLength>t)throw new y("invalid-scene-delta");i.set(d,s),s+=d.byteLength}}finally{r?.removeEventListener("abort",l),a.releaseLock()}if(s!==t)throw new y("invalid-scene-delta");return i}async#o(e,t,r){if(e.byteLength<Ae||e.byteLength>Ae+ye||t.buffer.byteLength>ye)throw new y("invalid-scene-delta");let n=new DataView(e),a=new TextDecoder().decode(new Uint8Array(e,0,8)),i=n.getUint16(8,!0),s=n.getUint16(10,!0),l=Kr(n.getBigUint64(12,!0),"invalid-scene-delta"),c=Kr(n.getBigUint64(20,!0),"invalid-scene-delta"),d=n.getUint32(28,!0),u=n.getUint32(32,!0);if(a!=="MATICDLT"||i!==1||s!==1||l!==t.revision||c<=t.revision||d<24||d>ye||u>ye||u+Ae!==e.byteLength)throw new y("invalid-scene-delta");let h=new Uint8Array(e,Ae,u),p=new Uint8Array(t.buffer),_=(await this.#n(h,Math.max(p.byteLength,d),r)).slice(),w=1024*1024;for(let k=0;k<p.byteLength;k+=w){if(r?.aborted)throw new DOMException("Aborted","AbortError");let I=Math.min(p.byteLength,k+w);for(let P=k;P<I;P+=1)_[P]=(_[P]??0)^(p[P]??0);I<p.byteLength&&await new Promise(P=>window.setTimeout(P,0))}let b=_.slice(0,d).buffer;return{parsed:{...await this.#t.parse(b,r),revision:c,etag:null,source:"live"},revision:c}}async sceneDelta(e,t,r,n){let a=e.includes("?")?"&":"?",i=await this.#a(`${e}${a}since=${encodeURIComponent(t.revision)}`,{headers:{Accept:"application/vnd.matic.slam-delta, application/vnd.matic.slam-scene"}},K.delta,n),s=Yr(i,t.revision),l=Gr(i,r);if(i.status===204){if(s!==t.revision)throw new y("invalid-scene-delta-revision");return{scene:null,floorCoherent:l,revision:s,notModified:!0}}if(!i.ok)throw new D("delta-request-failed",i.status);if(s<=t.revision)throw new y("invalid-scene-delta-revision");let c=Number(i.headers.get("Content-Length"));if(Number.isFinite(c)&&c>Ae+ye)throw new y("invalid-scene-delta-size");let d=i.headers.get("Content-Type")?.split(";",1)[0],u=await i.arrayBuffer();if(d==="application/vnd.matic.slam-delta"){let p=Number(i.headers.get("X-Matic-Base-Revision"));if(!Number.isSafeInteger(p)||p!==t.revision)throw new y("invalid-scene-delta-base");let g=await this.#o(u,t,n);if(g.revision!==s)throw new y("invalid-scene-delta-revision");return{scene:{...g.parsed,etag:i.headers.get("ETag")},floorCoherent:l,revision:s,notModified:!1}}if(d!=="application/vnd.matic.slam-scene")throw new y("invalid-scene-delta-content-type");return{scene:{...await this.#t.parse(u,n),revision:s,etag:i.headers.get("ETag"),source:"live"},floorCoherent:l,revision:s,notModified:!1}}async pose(e,t){return qr(await this.#r(e,K.pose,t))}async history(e,t){return Wr(await this.#r(e,K.history,t))}async plans(e,t){return Br(await this.#r(e,K.workflow,t))}async areas(e,t){return Fr(await this.#r(e,K.workflow,t))}async saveArea(e,t,r){let n=await this.#r(e,K.mutation,r,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...t.areaId?{area_id:t.areaId}:{},name:t.name,circles:t.circles,cleaning_mode:t.cleaningMode,coverage_setting:t.coverageSetting})});if(!n||typeof n!="object"||typeof n.id!="string")throw new y("invalid-area-save-response");return n.id}async deleteArea(e,t,r){let n=await this.#a(`${e}?area_id=${encodeURIComponent(t)}`,{method:"DELETE",headers:{Accept:"application/json"}},K.mutation,r);if(!n.ok)throw new D("area-delete-failed",n.status)}async service(e,t,r,n){let a=this.#e();if(typeof a?.callService!="function")throw new D("service-unavailable");await a.callService(e,t,r,{entity_id:n})}dispose(){this.#t.dispose()}};var Zr=()=>({version:4,view:"top",appearance:"photo",labels:!0,quality:"auto",cameras:{}}),Pe=(o,e,t)=>Math.max(e,Math.min(t,o)),Qr=o=>o.replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",Ot=(o,e=4)=>`matic-map-studio:v${e}:${Qr(o)}`,on=o=>{if(!o||typeof o!="object")return null;let e=o;return["yaw","pitch","zoom","targetX","targetZ"].every(r=>typeof e[r]=="number"&&Number.isFinite(e[r]))?{yaw:Pe(e.yaw,-Math.PI,Math.PI),pitch:Pe(e.pitch,.18,Math.PI/2-.018),zoom:Pe(e.zoom,.01,100),targetX:Pe(e.targetX,-1e4,1e4),targetZ:Pe(e.targetZ,-1e4,1e4)}:null},jr=o=>{let e=Zr();if(!o||typeof o!="object")return e;let t=o,r=t.view==="three"||t.view==="top"||t.view==="rooms"?t.view:e.view,n=r==="rooms"?"top":r,a=t.quality==="auto"||t.quality==="efficient"||t.quality==="balanced"||t.quality==="maximum"?t.quality:e.quality,i=t.cameras&&typeof t.cameras=="object"?t.cameras:{},s={};for(let l of["three","top"]){let c=on(i[l]);c&&(s[l]=c)}return{version:4,view:n,appearance:t.appearance==="rooms"||t.appearance==="photo"?t.appearance:e.appearance,labels:typeof t.labels=="boolean"?t.labels:e.labels,quality:a,cameras:s}},Ke=class{#e="local-user";#t=null;load(e){this.#e=Qr(e);try{let t=window.localStorage.getItem(Ot(this.#e));if(t)return jr(JSON.parse(t));for(let r of[3,2]){let n=window.localStorage.getItem(Ot(this.#e,r));if(n)return jr(JSON.parse(n))}}catch{}return Zr()}schedule(e){this.#t!==null&&window.clearTimeout(this.#t),this.#t=window.setTimeout(()=>{this.#t=null;try{window.localStorage.setItem(Ot(this.#e),JSON.stringify(e))}catch{}},250)}dispose(){this.#t!==null&&window.clearTimeout(this.#t),this.#t=null}},Jr="matic-map-studio:preferred-frontend",eo=()=>{try{return window.localStorage.getItem(Jr)==="v3"?"v3":"v4"}catch{return"v4"}},Nt=o=>{try{return window.localStorage.setItem(Jr,o),!0}catch{return!1}};var v=(o,e,t=null)=>({status:o,value:e,problem:t}),H=o=>o instanceof DOMException&&o.name==="AbortError",ae=(o,e)=>o instanceof D||o&&typeof o=="object"&&"code"in o&&typeof o.code=="string"?o.code:e,Ye=o=>[o.selectedFloorOrdinal??"none",o.mapFloorOrdinal??"none",o.mapFloorCoherent?"coherent":"transition"].join(":"),Ge=o=>[o.mapFloorOrdinal??"none",o.mapSessionVerified?"verified":"unverified",o.mapSessionKey??"no-session"].join(":"),F=o=>[o.entryId,o.selectedFloorOrdinal??"none",o.mapFloorOrdinal??"none"].join("|"),to=o=>[o.entryId,Ye(o),Ge(o),o.mapRevision].join("|"),ro=o=>o.runnerLocked||o.stopSettlePending||o.activePlan||o.nativeReconciliationPending||o.nativeSessionActive===!0,nn=(o,e)=>o.entryKey===e.entryKey&&o.generation===e.generation&&o.floorKey===e.floorKey&&o.missionKey===e.missionKey,oo="Live map updates paused while the current map is rechecked.",no="Reconnecting. The last verified map remains read only.",an=1e3,Wt=(o,e)=>o.label?o.label:o.active?"Current floor":`Saved floor ${o.ordinal??e}`,je=class{#e;#t=new ze;#a;#r=new Ke;#n=new Map;#o=null;#c;#d=null;#u=null;#s=null;#m=!1;#b=!1;#w=!1;#h="";#_=0;#f="";#l=!1;#v=!0;constructor(e,t){this.#e=e,this.#a=t}sync(e,t){if(this.#l)return;let r=this.#v;if(this.#v=e.host.connected,this.#o=e,this.#c=t,this.#e.patch({host:e.host,activity:e.activity,batteryPercent:e.batteryPercent,robotLabel:e.robotLabel,robots:e.robots,locale:e.language}),e.userKey!==this.#f){this.#f=e.userKey;let n=this.#r.load(e.userKey);this.#e.patch({view:n.view,appearance:n.appearance,labelsVisible:n.labels,quality:n.quality,cameras:n.cameras})}if(!e.host.administrator){this.#x(),this.#p("access-required");return}if(!e.host.connected){this.#x();let n=this.#e.value,a=n.resources.scene.value;this.#e.patch({coherence:a?"degraded":"unavailable",resources:{...n.resources,pose:v("idle",null)},map:{...n.map,available:a!==null,exactPose:!1},notice:a?{tone:"warning",text:no}:n.notice});return}if(e.host.robotCount===0){this.#x(),this.#p("map-unavailable");return}if(this.#$(),!r){this.#e.value.notice?.text===no&&this.#e.patch({notice:null}),this.refreshCatalog(!0);return}(this.#e.value.resources.catalog.status==="idle"||e.entryKey&&e.entryKey!==this.#e.value.selection.entryId)&&this.refreshCatalog(!0)}schedulePreferences(e){this.#r.schedule(e)}#$(){this.#d===null&&(this.#d=window.setInterval(()=>{document.visibilityState==="visible"&&this.refreshCatalog()},5e3)),this.#u===null&&(this.#u=window.setInterval(()=>{document.visibilityState==="visible"&&this.refreshPose()},an))}#x(){this.#d!==null&&window.clearInterval(this.#d),this.#u!==null&&window.clearInterval(this.#u),this.#d=null,this.#u=null}#i(e){this.#n.get(e)?.abort();let t=new AbortController;return this.#n.set(e,t),t}#y(e,t){this.#n.get(e)===t&&this.#n.delete(e)}#g(e=[]){for(let[t,r]of this.#n)e.includes(t)||(r.abort(),this.#n.delete(t))}#p(e){this.#g(),this.#t.invalidate(),this.#h="";let t=this.#e.value;this.#e.patch({generation:this.#t.generation,coherence:t.host.administrator?"unavailable":"blocked",fullMap:!1,precisionOpen:!1,resources:{catalog:v("error",null,e),entry:null,scene:v("idle",null),pose:v("idle",null),history:v("idle",null),plans:v("idle",null),areas:v("idle",null)},map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1},selection:{...t.selection,entryId:null,floorId:"current",historyId:null}})}async refreshCatalog(e=!1){if(this.#l||this.#m||!this.#o?.host.administrator)return;this.#m=!0;let t=this.#i("catalog"),r=this.#e.value.resources.catalog.value;this.#e.patch({resources:{...this.#e.value.resources,catalog:v("loading",r)}});try{let n=await this.#a.catalog(t.signal);if(t.signal.aborted||this.#l)return;let a=this.#c?.config?.entry_id,i=typeof a=="string"?a:null,s=n.find(d=>d.entryId===this.#o?.entryKey)||n.find(d=>d.entryId===i)||n[0]||null,l=this.#e.value.resources.entry;if(s&&l&&F(s)===F(l)&&Ye(s)===Ye(l)&&Ge(s)===Ge(l)&&s.mapRevision<l.mapRevision&&(s={...s,mapRevision:l.mapRevision}),this.#e.patch({managedLock:s?ro(s):!1,resources:{...this.#e.value.resources,catalog:v(n.length?"ready":"empty",n),entry:s}}),!s){this.#p("no-loaded-robot");return}if(this.#e.value.selection.floorId!=="current"&&!e)return;let c=to(s);if(!e&&c===this.#h){let d=this.#e.value,u=s.mapFloorCoherent&&s.mapSessionVerified,h=s.health==="problem"||s.health==="limited";this.#e.patch({coherence:u?h?"degraded":"current":"verifying",map:{...d.map,available:u&&d.resources.scene.value!==null,complete:s.mapComplete&&!s.mapTruncated,floorCoherent:s.mapFloorCoherent,sessionVerified:s.mapSessionVerified,exactPose:u?d.map.exactPose:!1},floor:{...d.floor,classifiedCount:Math.max(1,s.historyFloorCount)}});return}this.#h=c,this.#E(s)}catch(n){if(H(n))return;this.#e.patch({coherence:this.#e.value.resources.scene.value?"degraded":"unavailable",resources:{...this.#e.value.resources,catalog:v("error",r,ae(n,"catalog-unavailable"))}})}finally{this.#y("catalog",t),this.#m=!1}}#E(e){let t=this.#e.value,r=t.resources.entry,n=!!(r&&F(r)===F(e)),a=e.mapFloorCoherent&&e.mapSessionVerified;this.#g(n?["catalog","plans","areas","plan-mutation","area-mutation"]:["catalog"]);let i=n?t.resources.scene.value:null,s=t.resources.pose.value,l=n&&a&&e.mapSessionKey!==null&&s?.position&&s.mapSessionKey===e.mapSessionKey?s:null,c=this.#t.begin(e.entryId,Ye(e),Ge(e),e.mapRevision),d=e.health==="problem"||e.health==="limited",u=this.#e.value;this.#e.patch({managedLock:ro(e),generation:c.generation,coherence:a?d?"degraded":"current":"verifying",dataMode:"live",resources:{...u.resources,entry:e,scene:v(a?"loading":"idle",i),pose:v(a?"loading":"idle",l),history:v("loading",u.resources.history.value),plans:n?u.resources.plans:v("idle",null),areas:n?u.resources.areas:v("idle",null)},map:{available:a&&i!==null,complete:e.mapComplete&&!e.mapTruncated,floorCoherent:e.mapFloorCoherent,sessionVerified:e.mapSessionVerified,exactPose:a&&l!==null},floor:{classifiedCount:Math.max(1,e.historyFloorCount),displayName:e.selectedFloorOrdinal?`Floor ${e.selectedFloorOrdinal}`:"Current floor",readOnly:!1},selection:{...u.selection,entryId:e.entryId,floorId:"current",historyId:null,roomIds:n?u.selection.roomIds:[],planId:n?u.selection.planId:null,areaId:n?u.selection.areaId:null}}),this.#A(e,c),a&&(this.#C(e,c),this.#k(e,c))}async#C(e,t){let r=this.#i("scene");try{let n=await this.#a.scene(e.sceneUrl,e.mapRevision,e.mapFloorCoherent,"live",r.signal);if(!this.#t.accepts(t)||n.revision!==t.revision||!n.floorCoherent||!n.scene)return;let a=this.#e.value;if(this.#e.patch({resources:{...a.resources,scene:v("ready",n.scene)},map:{...a.map,available:!0},notice:a.notice?.text===oo?null:a.notice}),e.deltaUrl){let i=++this.#_;this.#M(e,t,n.scene,i)}}catch(n){if(H(n)||!this.#t.accepts(t))return;if(n instanceof D&&n.code==="request-timeout"){let l=this.#e.value;this.#e.patch({resources:{...l.resources,scene:v("loading",l.resources.scene.value,"scene-building")}}),window.setTimeout(()=>{this.#l||!this.#t.accepts(t)||this.#e.value.selection.floorId!=="current"||this.#C(e,t)},250);return}let a=this.#e.value,i=a.resources.pose.value,s=a.resources.scene.value!==null&&e.mapSessionKey!==null&&i?.position!==null&&i?.mapSessionKey===e.mapSessionKey;this.#e.patch({coherence:"degraded",resources:{...a.resources,scene:v("error",a.resources.scene.value,ae(n,"scene-unavailable"))},map:{...a.map,available:a.resources.scene.value!==null,exactPose:s}})}finally{this.#y("scene",r)}}async#M(e,t,r,n){if(!e.deltaUrl||typeof DecompressionStream!="function")return;let a=e.deltaUrl,i=e,s=t,l=r;try{for(;!this.#l&&n===this.#_&&this.#t.accepts(s)&&this.#e.value.selection.floorId==="current";){let c=this.#i("delta");try{let d=await this.#a.sceneDelta(a,l,i.mapFloorCoherent,c.signal);if(c.signal.aborted||this.#l||n!==this.#_||!this.#t.accepts(s))return;if(!d.floorCoherent){this.#e.patch({coherence:"verifying",map:{...this.#e.value.map,available:!1,floorCoherent:!1,exactPose:!1},resources:{...this.#e.value.resources,pose:v("idle",null)}}),this.#h="",this.refreshCatalog(!0);return}if(d.notModified||!d.scene){await new Promise(p=>window.setTimeout(p,100));continue}let u=this.#t.advance(s,d.revision);if(!u)return;s=u,l=d.scene,i={...i,mapRevision:d.revision},this.#h=to(i);let h=this.#e.value;this.#e.patch({resources:{...h.resources,entry:i,scene:v("ready",l)},map:{...h.map,available:!0,floorCoherent:!0}}),this.#k(i,s)}finally{this.#y("delta",c)}}}catch(c){if(H(c)||this.#l||n!==this.#_||!this.#t.accepts(s))return;this.#e.patch({coherence:"degraded",notice:{tone:"warning",text:oo}}),this.#h="",this.refreshCatalog(!0)}}async#A(e,t){let r=this.#i("history");try{let n=await this.#a.history(e.historyUrl,r.signal);if(!this.#t.accepts(t)||n.entryId!==e.entryId)return;let a=n.floors.find(i=>i.active)||n.floors[0];if(!a)return;this.#e.patch({resources:{...this.#e.value.resources,history:v("ready",n)},floor:{...this.#e.value.floor,classifiedCount:n.floors.length,displayName:Wt(a,1)}})}catch(n){if(H(n)||!this.#t.accepts(t))return;this.#e.patch({resources:{...this.#e.value.resources,history:v("error",null,ae(n,"history-unavailable"))}})}finally{this.#y("history",r)}}async refreshPose(){let e=this.#e.value.resources.entry,t=this.#t.current();!e||!t||this.#e.value.selection.floorId!=="current"||!e.mapFloorCoherent||!e.mapSessionVerified||await this.#k(e,t)}async#k(e,t){if(this.#b){this.#w=!0;return}this.#b=!0;let r=this.#i("pose");try{let n=await this.#a.pose(e.poseUrl,r.signal),a=this.#t.current(),i=this.#e.value.resources.entry;if(!a||!nn(t,a)||!i||!n.floorCoherent)return;if(n.mapSessionKey===null||n.mapSessionKey!==i.mapSessionKey){this.#e.patch({map:{...this.#e.value.map,exactPose:!1}}),this.#h="",this.refreshCatalog(!0);return}let s=this.#e.value,l=s.resources.pose.value,c=!!(s.map.exactPose&&l?.position&&l.mapSessionKey===i.mapSessionKey);if(n.position===null&&c){this.#e.patch({resources:{...s.resources,pose:v("ready",l)}});return}this.#e.patch({resources:{...s.resources,pose:v("ready",n)},map:{...s.map,exactPose:n.position!==null}})}catch(n){if(H(n)||!this.#t.accepts(t))return;let a=this.#e.value,i=a.resources.pose.value,s=!!(a.map.exactPose&&i?.position&&i.mapSessionKey===a.resources.entry?.mapSessionKey);this.#e.patch({resources:{...a.resources,pose:v("error",s?i:null,ae(n,"pose-unavailable"))},map:{...a.map,exactPose:s}})}finally{if(this.#y("pose",r),this.#b=!1,this.#w&&!this.#l){this.#w=!1;let n=this.#e.value.resources.entry,a=this.#t.current();n&&a&&this.#k(n,a)}}}async selectFloor(e){let t=this.#e.value.resources.history.value,r=this.#e.value.resources.entry;if(!t||!r)return;let n=t.floors.find(s=>s.id===e);if(!n)return;if(n.active){this.#h="",this.#e.dispatch({type:"set-floor",floorId:"current"}),await this.refreshCatalog(!0);return}let a=n.snapshots.at(-1);this.#g(["catalog"]);let i=this.#t.begin(r.entryId,n.id,a?.id||n.id,a?.revision||0);this.#e.patch({generation:i.generation,coherence:"current",dataMode:"history",floor:{classifiedCount:t.floors.length,displayName:Wt(n,t.floors.indexOf(n)+1),readOnly:!0},selection:{...this.#e.value.selection,floorId:n.id,historyId:a?.id||null},resources:{...this.#e.value.resources,scene:v(a?"loading":"empty",null),pose:v("idle",null)},map:{available:!1,complete:!0,floorCoherent:!0,sessionVerified:!0,exactPose:!1}}),a&&await this.#I(a,i)}async selectHistory(e){let t=this.#e.value.resources.history.value,r=this.#e.value.resources.entry;if(!t||!r)return;if(!e){await this.selectFloor("current");return}let n=t.floors.find(s=>s.snapshots.some(l=>l.id===e)),a=n?.snapshots.find(s=>s.id===e);if(!n||!a)return;let i=this.#t.begin(r.entryId,n.id,a.id,a.revision);this.#g(["catalog"]),this.#e.patch({generation:i.generation,dataMode:"history",floor:{classifiedCount:t.floors.length,displayName:Wt(n,t.floors.indexOf(n)+1),readOnly:!0},selection:{...this.#e.value.selection,floorId:n.id,historyId:a.id},resources:{...this.#e.value.resources,scene:v("loading",null),pose:v("idle",null)},map:{...this.#e.value.map,available:!1,exactPose:!1}}),await this.#I(a,i)}async#I(e,t){let r=this.#i("history-scene");try{let n=await this.#a.scene(e.sceneUrl,e.revision,!0,"history",r.signal);if(!this.#t.accepts(t)||!n.scene)return;this.#e.patch({resources:{...this.#e.value.resources,scene:v("ready",n.scene)},map:{...this.#e.value.map,available:!0,exactPose:!1}})}catch(n){if(H(n)||!this.#t.accepts(t))return;this.#e.patch({resources:{...this.#e.value.resources,scene:v("error",null,ae(n,"history-scene-unavailable"))}})}finally{this.#y("history-scene",r)}}async openWorkflow(e){this.#e.dispatch({type:"open-workflow",workflow:e}),(e==="plan"||e==="rooms")&&await this.loadPlans(),(e==="draw"||e==="areaReview")&&await this.loadAreas()}async loadPlans(){let e=this.#e.value.resources.entry;if(!e||!this.#t.current()||!at(this.#e.value))return;let t=F(e),r=this.#i("plans");this.#e.patch({resources:{...this.#e.value.resources,plans:v("loading",null)}});try{let n=await this.#a.plans(e.plansUrl,r.signal),a=this.#e.value.resources.entry;if(!a||F(a)!==t)return;this.#e.patch({resources:{...this.#e.value.resources,plans:v("ready",n)},selection:{...this.#e.value.selection,planId:n.selectedPlan||n.plans[0]?.id||null}}),this.selectPlan(n.selectedPlan||n.plans[0]?.id||null)}catch(n){let a=this.#e.value.resources.entry;if(H(n)||!a||F(a)!==t)return;this.#e.patch({resources:{...this.#e.value.resources,plans:v("error",null,ae(n,"plans-unavailable"))}})}finally{this.#y("plans",r)}}selectPlan(e){let t=this.#e.value.resources.plans.value?.plans.find(r=>r.id===e);this.#e.patch({selection:{...this.#e.value.selection,planId:e},planDraft:t?this.#R(t):{...this.#e.value.planDraft,id:null,name:"",rooms:[],dirty:!1}})}#R(e){return{id:e.id,name:e.name,enabled:e.enabled,runBehavior:e.runBehavior,rooms:(e.roomOrder.length?e.roomOrder.flatMap(t=>{let r=e.rooms.find(n=>n.roomId===t);return r?[r]:[]}):e.rooms).map(t=>({...t})),returnToBase:e.returnToBase,finishCurrentRoom:e.finishCurrentRoom,finishCurrentRoomThreshold:e.finishCurrentRoomThreshold,dirty:!1}}async loadAreas(){let e=this.#e.value.resources.entry;if(!e||!this.#t.current()||!at(this.#e.value))return;let t=F(e),r=this.#i("areas");this.#e.patch({resources:{...this.#e.value.resources,areas:v("loading",null)}});try{let n=await this.#a.areas(e.areasUrl,r.signal),a=this.#e.value.resources.entry;if(!a||F(a)!==t||n.sceneUrl!==a.sceneUrl)return;this.#e.patch({resources:{...this.#e.value.resources,areas:v("ready",n)}}),this.selectArea(n.areas[0]?.id||null)}catch(n){let a=this.#e.value.resources.entry;if(H(n)||!a||F(a)!==t)return;this.#e.patch({resources:{...this.#e.value.resources,areas:v("error",null,ae(n,"areas-unavailable"))}})}finally{this.#y("areas",r)}}selectArea(e){let t=this.#e.value.resources.areas.value?.areas.find(n=>n.id===e),r=this.#e.value;this.#e.patch({selection:{...r.selection,areaId:e},areaDraft:t?this.#L(t):{id:null,name:"",cleaningMode:"vacuum",coverageSetting:"standard",status:"new",canRebind:!1,dirty:!1},draw:{...r.draw,circles:t?.circles||[],undo:[],redo:[],dirty:!1,strokeCount:0}})}#L(e){return{id:e.id,name:e.name,cleaningMode:e.cleaningMode,coverageSetting:e.coverageSetting,status:e.status,canRebind:e.canRebind,dirty:!1}}async saveArea(){let e=this.#e.value,t=e.resources.entry,r=e.areaDraft;if(!t||!q(e)||!r.name.trim()||!e.draw.circles.length)return;let n=this.#i("area-mutation");this.#e.patch({command:"pending",notice:{tone:"info",text:"Saving area\u2026"}});try{let a=await this.#a.saveArea(t.areasUrl,{areaId:r.id,name:r.name.trim(),circles:e.draw.circles,cleaningMode:r.cleaningMode,coverageSetting:r.coverageSetting},n.signal);this.#e.patch({command:"idle",notice:{tone:"success",text:"Area saved"}}),await this.loadAreas(),this.selectArea(a)}catch(a){if(H(a))return;this.#e.patch({command:"failed",notice:{tone:"error",text:"Area could not be saved"}})}finally{this.#y("area-mutation",n)}}async deleteArea(){let e=this.#e.value.resources.entry,t=this.#e.value.selection.areaId;if(!e||!t||!q(this.#e.value))return;let r=this.#i("area-mutation");try{await this.#a.deleteArea(e.areasUrl,t,r.signal),this.#e.patch({notice:{tone:"success",text:"Area deleted"}}),await this.loadAreas()}catch(n){H(n)||this.#e.patch({notice:{tone:"error",text:"Area could not be deleted"}})}finally{this.#y("area-mutation",r)}}async savePlan(){let e=this.#e.value,t=e.planDraft,r=e.resources.plans.value;if(!r||!t.name.trim()||!t.rooms.length||!q(e))return;let n=t.rooms;await this.#P("save_plan",{...t.id?{plan_id:t.id}:{},name:t.name.trim(),enabled:t.enabled,run_behavior:t.runBehavior,rooms:n.map(a=>({room:r.rooms.find(i=>i.roomId===a.roomId)?.name,cleaning_mode:a.cleaningMode,coverage_setting:a.coverageSetting})).filter(a=>a.room),return_to_base:t.returnToBase,finish_current_room:t.finishCurrentRoom,finish_current_room_threshold:t.finishCurrentRoomThreshold,select:!t.id||r.selectedPlan===t.id},"Plan saved","Plan could not be saved"),await this.loadPlans()}async deletePlan(){let e=this.#e.value.selection.planId;e&&(await this.#P("delete_plan",{plan:e},"Plan deleted","Plan could not be deleted"),await this.loadPlans())}async executeAction(e){switch(e){case"stop":this.#e.value.resources.entry?.activePlan||this.#e.value.resources.entry?.runnerLocked?await this.#S("matic_robot","stop_intelligent_cleaning",{}):await this.#S("vacuum","return_to_base",{});return;case"resume":await this.#S("vacuum","start",{});return;case"run-plan":{let t=this.#e.value.selection.planId||this.#e.value.resources.plans.value?.selectedPlan;t&&await this.#S("matic_robot","run_selected_plan",{plan:t});return}case"clean-rooms":{let t=this.#e.value.resources.plans.value,n=this.#e.value.selection.roomSettings.map(a=>({room:t?.rooms.find(i=>i.roomId===a.roomId)?.name,cleaning_mode:a.cleaningMode,coverage_setting:a.coverageSetting})).filter(a=>a.room);n.length&&await this.#S("matic_robot","clean_room_sequence",{rooms:n,return_to_base:!0});return}case"run-area":{let t=this.#e.value.selection.areaId;t&&await this.#S("matic_robot","clean_area",{area:t});return}case"review-area":this.#e.dispatch({type:"open-workflow",workflow:"areaReview"});return;case"save-area":await this.saveArea();return;case"save-plan":await this.savePlan();return;case"delete-plan":await this.deletePlan();return;case"delete-area":await this.deleteArea();return}}async#P(e,t,r,n){let a=this.#o?.vacuumEntityId;if(!(!a||!q(this.#e.value)||this.#e.value.command==="pending")){this.#e.patch({command:"pending",notice:{tone:"info",text:"Saving\u2026"}});try{await this.#a.service("matic_robot",e,t,a),this.#e.patch({command:"idle",notice:{tone:"success",text:r}})}catch{this.#e.patch({command:"failed",notice:{tone:"error",text:n}})}}}async#S(e,t,r){let n=this.#e.value,a=this.#o?.vacuumEntityId,s=(t==="stop_intelligent_cleaning"||e==="vacuum"&&t==="return_to_base")&&n.command==="idle"&&(n.activity==="cleaning"||n.activity==="paused"||n.activity==="returning"||n.activity==="recharging");if(!(!a||!s&&!se(n))){this.#e.patch({command:"pending",notice:null});try{await this.#a.service(e,t,r,a),this.#e.patch({command:"settling"}),this.#s!==null&&window.clearTimeout(this.#s),this.#s=window.setTimeout(()=>{this.#s=null,this.#e.value.command==="settling"&&this.#e.patch({command:"idle"})},15e3)}catch{this.#e.patch({command:"failed",notice:{tone:"error",text:"The robot did not accept that action"}})}}}updateDraftCircles(e,t=!0,r){this.#e.dispatch({type:"set-draft-circles",circles:e,record:t,...r?{previous:r}:{}}),this.#e.dispatch({type:"patch-area-draft",patch:{dirty:!0}})}dispose(){this.#l||(this.#l=!0,this.#x(),this.#g(),this.#s!==null&&window.clearTimeout(this.#s),this.#s=null,this.#r.dispose(),this.#a.dispose(),this.#t.invalidate())}};var ao=o=>(o.workflow==="none"?0:1)+(o.fullMap?1:0)+(o.precisionOpen?1:0)+(o.dialog?1:0),sn=o=>{if(!o||typeof o!="object")return null;let e=o.maticMapLayer;if(!e||typeof e!="object")return null;let t=e.owner,r=e.depth;return typeof t=="string"&&Number.isInteger(r)&&Number(r)>=0?{owner:t,depth:Number(r)}:null},Ze=class{#e;#t=`matic-map-${crypto.randomUUID?.()||Math.random().toString(36).slice(2)}`;#a=0;#r=null;#n=!1;constructor(e){this.#e=e}start(){this.#r||(this.#a=ao(this.#e.value),this.#r=this.#e.subscribe(e=>this.#o(e)),window.addEventListener("popstate",this.#c))}#o(e){let t=ao(e);if(this.#n){this.#n=!1,this.#a=t;return}if(t>this.#a)for(let r=this.#a+1;r<=t;r+=1){let n=history.state&&typeof history.state=="object"?history.state:{};history.pushState({...n,maticMapLayer:{owner:this.#t,depth:r}},"",window.location.href)}this.#a=t}#c=()=>{this.#a<1||(this.#n=!0,this.#e.dispatch({type:"dismiss-top-layer"}))};dismissTop(){if(this.#a<1)return!1;let e=sn(history.state);return e?.owner===this.#t&&e.depth===this.#a?history.back():this.#e.dispatch({type:"dismiss-top-layer"}),!0}dispose(){this.#r?.(),this.#r=null,window.removeEventListener("popstate",this.#c),this.#a=0}};var io=U(re),Ut=class extends x{constructor(){super(...arguments);this.narrow=!1;this._workspace=M();this._classic=!1;this.entryOverride=null;this.#e=new Oe;this.#t=new le(this._workspace);this.#a=null;this.#r=null;this.#n=null;this.#o=null;this.#c=null;this.#d=""}static{this.properties={hass:{attribute:!1},narrow:{type:Boolean},route:{attribute:!1},panel:{attribute:!1},_workspace:{state:!0},_classic:{state:!0},entryOverride:{state:!0}}}#e;#t;#a;#r;#n;#o;#c;#d;connectedCallback(){super.connectedCallback(),this._classic=eo()==="v3",this.#r=this.#t.subscribe(t=>{this._workspace=t,this.#m(t)}),this._classic||this.#u()}disconnectedCallback(){this.#r?.(),this.#r=null,this.#s(),super.disconnectedCallback()}#u(){this.#o||(this.#n=new Ve(()=>this.hass),this.#o=new je(this.#t,this.#n),this.#c=new Ze(this.#t),this.#c.start(),this.#a&&this.#o.sync(this.#a,this.panel))}#s(){this.#c?.dispose(),this.#c=null,this.#o?.dispose(),this.#o=null,this.#n=null}#m(t){if(!this.#o)return;let r={version:4,view:t.view,appearance:t.appearance,labels:t.labelsVisible,quality:t.quality,cameras:t.cameras},n=JSON.stringify(r);n!==this.#d&&(this.#d=n,this.#o.schedulePreferences(r))}willUpdate(t){if(t.has("hass")||t.has("panel")||t.has("entryOverride")){let r=this.#e.project(this.hass,this.panel,this.entryOverride);if(r!==this.#a){this.#a=r;let n=r.host.connected?r.host.robotCount===0?"unavailable":r.host.administrator?"verifying":"blocked":"degraded";this.#t.replace({...this.#t.value,coherence:n,activity:r.activity,batteryPercent:r.batteryPercent,host:r.host,fullMap:r.host.administrator&&r.host.robotCount>0&&this.#t.value.fullMap,robotLabel:r.robotLabel,robots:r.robots,locale:r.language})}this._classic||this.#o?.sync(r,this.panel)}t.has("narrow")&&this.#t.value.narrowHint!==this.narrow&&this.#t.dispatch({type:"set-narrow-hint",value:this.narrow})}#b(t){if(!Te(t.detail))return;t.stopPropagation();let r=t.detail;if(r.type==="dismiss-top-layer"||r.type==="exit-full-map"){this.#c?.dismissTop()||this.#t.dispatch(r);return}if(r.type==="open-workflow"&&r.workflow!=="none"){this.#o?.openWorkflow(r.workflow);return}if(r.type==="set-floor"){this.#o?.selectFloor(r.floorId);return}if(r.type==="select-entry"){if(!this._workspace.robots.some(n=>n.entryId===r.entryId))return;this.entryOverride=r.entryId;return}if(r.type==="set-history"){this.#o?.selectHistory(r.historyId);return}if(r.type==="select-plan"){this.#o?.selectPlan(r.planId);return}if(r.type==="select-area"){this.#o?.selectArea(r.areaId);return}this.#t.dispatch(r)}#w(t){if(t.stopPropagation(),typeof t.detail?.id=="string"){if(t.detail.id==="use-classic"){Nt("v3")&&(this.#s(),this._classic=!0);return}this.#o?.executeAction(t.detail.id),this.dispatchEvent(new CustomEvent("matic-map-v4-action-requested",{detail:{id:t.detail.id},bubbles:!0,composed:!0}))}}#h(){Nt("v4")&&(this._classic=!1,this.#u(),this.requestUpdate())}updated(){if(!this._classic)return;let t=this.renderRoot.querySelector("matic-map-panel-v0-3-1");t&&(t.hass=this.hass,t.narrow=this.narrow,t.route=this.route,t.panel=this.panel)}getWorkspaceSnapshot(){return this.#t.value}render(){return this._classic?f`
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
          <button class="return-v4" type="button" @click=${this.#h}>${R(this.hass?.localize,"v4_use_new","Use Map Studio 0.4")}</button>
          <matic-map-panel-v0-3-1></matic-map-panel-v0-3-1>
        </div>
      `:f`
      <${io}
        .state=${this._workspace}
        .localize=${this.hass?.localize}
        @matic-workspace-intent=${this.#b}
        @matic-workspace-action=${this.#w}
      ></${io}>
    `}};customElements.get(xt)||customElements.define(xt,Ut);export{ze as CoherenceMachine,Le as DRAW_BRUSH_MAX_METERS,be as DRAW_BRUSH_MIN_METERS,ct as GALLERY_SCENARIOS,Oe as HassAdapter,nt as MAP_PIXELS_PER_METER_AT_100,Ie as MAP_ZOOM_MAX,j as MAP_ZOOM_MIN,xt as MATIC_MAP_PANEL_TAG,Ut as MaticMapPanelV4,Tt as MaticMapStudioGalleryV4,le as WorkspaceStore,dn as brushCursorPixels,q as canEditCoordinates,at as canReadFloorResources,Xt as canShowExactPose,ce as canShowLiveMap,se as canStartMotion,un as commandState,lt as createGalleryState,M as initialWorkspaceState,Te as isWorkspaceIntent,Yt as mapScale,uo as normalizeBrush,qt as normalizeZoom,ho as reduceWorkspace,Kt as selectPausedSecondaryAction,Vt as selectPrimaryAction};
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
