var b=100,d1=1e3,j=.2,m1=2.5,X=64,D2=C=>!C||typeof C!="object"?!1:typeof C.type=="string";var p1=(C,H)=>{let V=C.workflow==="plan"&&C.planDraft.dirty,L=(C.workflow==="draw"||C.workflow==="areaReview")&&(C.draw.dirty||C.areaDraft.dirty);if(!V&&!L)return!1;switch(H.type){case"open-workflow":return V?H.workflow!=="plan":H.workflow!=="draw"&&H.workflow!=="areaReview";case"select-plan":return V;case"select-area":return L;case"set-floor":return H.floorId!==C.selection.floorId;case"select-entry":return H.entryId!==C.selection.entryId;case"set-history":return!0;case"dismiss-top-layer":return!C.dialog&&!C.precisionOpen&&!C.fullMap;default:return!1}};var S=()=>({status:"idle",value:null,problem:null}),x1=new Set(["rooms","plan","plans","draw","areaReview"]),p2=C=>C.dataMode==="history"||C.floor.readOnly,l=(C,H,V)=>Math.max(H,Math.min(V,C)),n2=C=>({yaw:l(Number.isFinite(C.yaw)?C.yaw:0,-Math.PI,Math.PI),pitch:l(Number.isFinite(C.pitch)?C.pitch:Math.PI/2-.018,.18,Math.PI/2-.018),zoom:l(Number.isFinite(C.zoom)?C.zoom:1,.01,100),targetX:l(Number.isFinite(C.targetX)?C.targetX:0,-1e4,1e4),targetZ:l(Number.isFinite(C.targetZ)?C.targetZ:0,-1e4,1e4)}),n1=C=>Math.round(l(Number.isFinite(C)?C:100,100,1e3)),l2=C=>Math.round(l(Number.isFinite(C)?C:.2,.2,2.5)*100)/100,I=()=>({owner:null,draftFloorOrdinal:null,draftMapSessionKey:null,generation:0,coherence:"verifying",dataMode:"live",activity:"unknown",workflow:"none",command:"idle",fullMap:!1,precisionOpen:!1,dialog:null,cadenceResetRequest:null,narrowHint:!1,view:"top",appearance:"photo",labelsVisible:!0,quality:"auto",cameras:{},managedLock:!1,batteryPercent:null,floor:{classifiedCount:1,displayName:"Current floor",readOnly:!1},map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1},host:{connected:!0,administrator:!0,robotConnected:!1,robotCount:0},draw:{zoomPercent:100,zoomOriginX:50,zoomOriginY:50,brushMeters:.6,tool:"paint",dirty:!1,strokeCount:0,circles:[],undo:[],redo:[]},resources:{catalog:S(),entry:null,scene:S(),pose:S(),history:S(),plans:S(),areas:S()},manualRoomPreview:S(),manualRoomPreviewRetry:0,selection:{entryId:null,floorId:"current",historyId:null,roomIds:[],roomSettings:[],useRoomSchedule:!0,cleaningMode:"vacuum",coverageSetting:"standard",planId:null,areaId:null},planDraft:{id:null,name:"",enabled:!0,runBehavior:"intelligent",rooms:[],returnToBase:!0,finishCurrentRoom:!1,finishCurrentRoomThreshold:50,dirty:!1},areaDraft:{id:null,name:"",cleaningMode:"vacuum",coverageSetting:"standard",status:"new",canRebind:!1,dirty:!1},notice:null,robotLabel:"Matic robot",robots:[],locale:"en"}),v2=C=>{let H=C.resources.entry,V=C.selection.entryId;if(!H||!V||H.entryId!==V||C.selection.roomIds.length===0)return null;let L=C.selection.roomIds.map(M=>{let r=C.selection.roomSettings.find(e=>e.roomId===M);return r?[M,r.cleaningMode,r.coverageSetting]:null});return L.some(M=>M===null)?null:JSON.stringify([V,C.dataMode,C.selection.floorId,C.selection.historyId,C.draftFloorOrdinal,C.draftMapSessionKey,H.selectedFloorOrdinal,H.mapFloorOrdinal,H.mapFloorCoherent,H.mapSessionVerified,H.mapSessionKey,C.selection.useRoomSchedule,L])},x2=C=>{let H=C.manualRoomPreview.status==="ready"?C.manualRoomPreview.value:null,V=C.resources.entry;return!H||!V||H.key!==v2(C)||H.generation!==C.generation||H.preview.entryId!==C.selection.entryId||H.floorKey!==[V.selectedFloorOrdinal??"none",V.mapFloorOrdinal??"none",V.mapFloorCoherent?"coherent":"transition"].join(":")||H.missionKey!==[V.mapFloorOrdinal??"none",V.mapSessionVerified?"verified":"unverified",V.mapSessionKey??"no-session"].join(":")?null:H},m=(C,H)=>({...C,draw:{...C.draw,...H}}),Z2=C=>({id:C.id,name:C.name,enabled:C.enabled,runBehavior:C.runBehavior,rooms:(C.roomOrder.length?C.roomOrder.flatMap(H=>{let V=C.rooms.find(L=>L.roomId===H);return V?[V]:[]}):C.rooms).map(H=>({...H})),returnToBase:C.returnToBase,finishCurrentRoom:C.finishCurrentRoom,finishCurrentRoomThreshold:C.finishCurrentRoomThreshold,dirty:!1}),S2=(C,H)=>{switch(H.type){case"set-host":return{...C,host:H.host,fullMap:H.host.administrator&&H.host.robotCount>0?C.fullMap:!1};case"set-operational-state":return{...C,coherence:H.coherence,activity:H.activity,command:H.command??C.command};case"set-narrow-hint":return{...C,narrowHint:H.value};case"set-view":return{...C,view:H.view};case"set-appearance":return{...C,appearance:H.appearance};case"set-quality":return{...C,quality:H.quality};case"set-camera":return{...C,cameras:{...C.cameras,[H.view]:n2(H.camera)}};case"toggle-labels":return{...C,labelsVisible:!C.labelsVisible};case"open-workflow":return p2(C)&&x1.has(H.workflow)?C:{...C,workflow:H.workflow,notice:C.notice?.tone==="success"?null:C.notice,precisionOpen:!1};case"enter-full-map":return C.host.administrator&&C.host.robotCount>0&&C.map.available?{...C,fullMap:!0}:C;case"exit-full-map":return{...C,fullMap:!1,precisionOpen:!1};case"set-precision-open":return{...C,precisionOpen:H.value};case"set-zoom":return m(C,{zoomPercent:n1(H.value),...H.originX===void 0?{}:{zoomOriginX:l(H.originX,0,100)},...H.originY===void 0?{}:{zoomOriginY:l(H.originY,0,100)}});case"step-zoom":return m(C,{zoomPercent:n1(C.draw.zoomPercent*H.factor)});case"fit-map":return m(C,{zoomPercent:100,zoomOriginX:50,zoomOriginY:50});case"set-brush":return m(C,{brushMeters:l2(H.value)});case"set-draw-tool":return m(C,{tool:H.tool});case"mark-draft":{let V=Math.max(0,C.draw.strokeCount+H.strokeDelta);return m(C,{dirty:V>0,strokeCount:V})}case"undo-draft":{let V=C.draw.undo.at(-1);return V?m(C,{circles:V,outline:C.draw.outlineUndo?.at(-1)??null,outlineUndo:C.draw.outlineUndo?.slice(0,-1)??[],outlineRedo:[...C.draw.outlineRedo??[],C.draw.outline??null],undo:C.draw.undo.slice(0,-1),redo:[...C.draw.redo,C.draw.circles],dirty:!0,strokeCount:Math.max(0,C.draw.strokeCount-1)}):C}case"clear-draft":return!C.draw.circles.length&&!C.draw.outline?.points.length?C:m(C,{circles:[],outline:null,outlineUndo:[...(C.draw.outlineUndo??[]).slice(-99),C.draw.outline??null],outlineRedo:[],undo:[...C.draw.undo.slice(-99),C.draw.circles],redo:[],dirty:!0,strokeCount:C.draw.strokeCount+1});case"redo-draft":{let V=C.draw.redo.at(-1);return V?m(C,{circles:V,outline:C.draw.outlineRedo?.at(-1)??null,outlineUndo:[...C.draw.outlineUndo??[],C.draw.outline??null],outlineRedo:C.draw.outlineRedo?.slice(0,-1)??[],undo:[...C.draw.undo,C.draw.circles],redo:C.draw.redo.slice(0,-1),dirty:!0,strokeCount:C.draw.strokeCount+1}):C}case"set-draft-circles":{let V=H.circles.slice(0,512).map(M=>({...M})),L=H.record!==!1;return m(C,{circles:V,outline:H.outline??null,outlineUndo:L?[...(C.draw.outlineUndo??[]).slice(-99),H.previousOutline!==void 0?H.previousOutline:C.draw.outline??null]:C.draw.outlineUndo??[],outlineRedo:L?[]:C.draw.outlineRedo??[],undo:L?[...C.draw.undo.slice(-99),H.previous??C.draw.circles]:C.draw.undo,redo:L?[]:C.draw.redo,dirty:!0,strokeCount:L?C.draw.strokeCount+1:C.draw.strokeCount})}case"discard-draft":return C.workflow==="plan"?{...C,planDraft:I().planDraft,selection:{...C.selection,planId:null},dialog:null,workflow:"plans",precisionOpen:!1}:{...m(C,{dirty:!1,strokeCount:0,circles:[],outline:null,outlineUndo:[],outlineRedo:[],undo:[],redo:[]}),areaDraft:I().areaDraft,selection:{...C.selection,areaId:null},dialog:null,workflow:"none",precisionOpen:!1};case"toggle-room":{if(C.workflow==="plan"){let L=C.planDraft.rooms;return{...C,planDraft:{...C.planDraft,dirty:!0,rooms:L.some(M=>M.roomId===H.roomId)?L.filter(M=>M.roomId!==H.roomId):[...L,{roomId:H.roomId,cleaningMode:"vacuum",coverageSetting:"standard"}]}}}let V=C.selection.roomIds.includes(H.roomId);return{...C,selection:{...C.selection,roomIds:V?C.selection.roomIds.filter(L=>L!==H.roomId):[...C.selection.roomIds,H.roomId],roomSettings:V?C.selection.roomSettings.filter(L=>L.roomId!==H.roomId):[...C.selection.roomSettings,{roomId:H.roomId,cleaningMode:"vacuum",coverageSetting:"standard"}]}}}case"patch-room-settings":return{...C,selection:{...C.selection,roomSettings:C.selection.roomSettings.map(V=>V.roomId===H.roomId?{...V,...H.cleaningMode?{cleaningMode:H.cleaningMode}:{},...H.coverageSetting?{coverageSetting:H.coverageSetting}:{}}:V)}};case"set-use-room-schedule":return{...C,selection:{...C.selection,useRoomSchedule:H.value}};case"retry-room-preview":return{...C,manualRoomPreviewRetry:C.manualRoomPreviewRetry+1};case"request-room-cadence-reset":return C.planDraft.id!==H.planId||C.planDraft.dirty?C:{...C,dialog:"confirmResetCadence",cadenceResetRequest:{planId:H.planId,roomId:H.roomId,mode:H.mode}};case"set-floor":return{...C,dataMode:H.floorId==="current"?"live":"history",selection:{...C.selection,floorId:H.floorId,historyId:null}};case"select-entry":return C;case"set-history":return{...C,dataMode:H.historyId?"history":"live",selection:{...C.selection,historyId:H.historyId}};case"select-plan":{let V=C.resources.plans.value?.plans.find(L=>L.id===H.planId);return{...C,workflow:"plan",notice:C.notice?.tone==="success"?null:C.notice,selection:{...C.selection,planId:H.planId},planDraft:V?Z2(V):I().planDraft}}case"select-area":return{...C,selection:{...C.selection,areaId:H.areaId},workflow:H.workflow==="areaReview"?"areaReview":C.workflow};case"patch-plan-draft":return{...C,planDraft:{...C.planDraft,...H.patch,dirty:H.patch.dirty??!0}};case"patch-area-draft":return{...C,areaDraft:{...C.areaDraft,...H.patch,dirty:H.patch.dirty??!0}};case"set-notice":return{...C,notice:H.notice};case"open-dialog":return{...C,dialog:H.dialog};case"dismiss-top-layer":return C.dialog==="confirmResetCadence"?{...C,dialog:null,cadenceResetRequest:null}:p1(C,H)?{...C,dialog:"discardDraft"}:C.dialog?{...C,dialog:null}:C.precisionOpen?{...C,precisionOpen:!1}:C.fullMap?{...C,fullMap:!1}:C.workflow!=="none"?{...C,workflow:C.workflow==="plan"?"plans":"none",precisionOpen:!1}:C;case"return-live":return{...C,dataMode:"live",workflow:"none",floor:{...C.floor,readOnly:!1}}}},l1=class{#H=new Set;#C;constructor(H=I()){this.#C=H}get value(){return this.#C}dispatch(H){let V=S2(this.#C,H);if(V===this.#C)return V;this.#C=V;for(let L of this.#H)L(V);return V}replace(H){if(H!==this.#C){this.#C=H;for(let V of this.#H)V(H)}}patch(H){let V={...this.#C,...H};return this.replace(V),V}subscribe(H){return this.#H.add(H),H(this.#C),()=>this.#H.delete(H)}},v1=class{#H=null;#C=0;get generation(){return this.#C}begin(H,V,L,M){return this.#C+=1,this.#H={entryKey:H,generation:this.#C,floorKey:V,missionKey:L,revision:M},this.#H}current(){return this.#H}accepts(H){let V=this.#H;return!!(V&&H.entryKey===V.entryKey&&H.generation===V.generation&&H.floorKey===V.floorKey&&H.missionKey===V.missionKey&&H.revision===V.revision)}advance(H,V){return!this.accepts(H)||!Number.isSafeInteger(V)||V<=H.revision?null:(this.#H={...H,revision:V},this.#H)}invalidate(){return this.#C+=1,this.#H=null,this.#C}},Y=C=>C.dataMode==="live"&&C.map.available&&(C.coherence==="current"||C.coherence==="degraded"||C.coherence==="verifying")&&C.host.administrator,_2=C=>Y(C)&&!C.floor.readOnly&&(C.coherence==="current"||C.coherence==="degraded")&&C.map.floorCoherent&&C.map.sessionVerified&&C.map.exactPose&&C.host.connected&&C.host.robotConnected,B=C=>Y(C)&&C.coherence==="current"&&C.map.complete&&C.map.floorCoherent&&C.map.sessionVerified&&C.host.connected&&C.host.robotConnected&&!C.floor.readOnly,U2=C=>Y(C)&&C.coherence==="current"&&C.map.floorCoherent&&C.map.sessionVerified&&C.host.connected&&C.host.robotConnected&&!C.floor.readOnly,w=C=>B(C)&&!C.managedLock&&C.command==="idle"&&(C.activity==="idle"||C.activity==="docked"),u2=C=>B(C)&&C.command==="idle"&&C.activity==="paused"&&C.resources.entry?.stopSettlePending!==!0,p=(C,H,V,L,M)=>({id:C,label:H,labelKey:L,kind:"neutral",enabled:!1,reason:V,reasonKey:M}),J=C=>C.command==="starting"||C.activity==="cleaning"||C.activity==="paused"||C.activity==="returning"||C.activity==="recharging"||C.resources.entry?.runnerLocked===!0||C.resources.entry?.activePlan===!0||C.resources.entry?.nativeSessionActive===!0,s2=C=>C.host.connected&&C.host.administrator&&C.host.robotConnected&&(C.command==="idle"||C.command==="failed"||C.command==="starting")&&J(C),Z1=C=>{let H=s2(C);return{id:"stop",label:"Stop",labelKey:"v4_action_stop",kind:"danger",enabled:H,...H?{}:{reason:"The robot is already stopping.",reasonKey:"v4_reason_stop"}}},c2=C=>{if(C.dataMode==="history")return{id:"return-live",label:"Return to the live map",labelKey:"v4_action_return_live",kind:"primary",enabled:!0};if(C.floor.readOnly&&x1.has(C.workflow))return p("read-only","Live map required","Return to the live map to edit cleaning tasks.","v4_action_live_map_required","v4_reason_live_map_required");if(C.activity!=="paused"&&J(C))return Z1(C);let H=C.workflow==="plan"&&C.planDraft.dirty||(C.workflow==="draw"||C.workflow==="areaReview")&&(C.draw.dirty||C.areaDraft.dirty);if(C.command==="failed"&&!H)return{id:"recheck-status",label:"Check robot status",labelKey:"v4_recheck_robot",kind:"primary",enabled:C.host.connected&&C.host.administrator&&C.host.robotConnected,reason:"Refresh the robot state before trying the action again.",reasonKey:"v4_recheck_robot_reason"};if(C.activity==="stopping"||C.command==="settling")return p("stopping","Stopping","Waiting for the robot to settle.","v4_action_stopping","v4_reason_stopping");if(C.command==="starting")return p("starting","Starting","Waiting for the robot to begin.","v4_action_starting","v4_reason_starting");if(C.activity==="paused")return{id:"resume",label:"Resume cleaning",labelKey:"v4_action_resume",kind:"primary",enabled:u2(C)};if(!C.host.connected)return p("reconnecting","Reconnecting","Home Assistant is offline.","v4_action_reconnecting","v4_reason_reconnecting");if(!C.host.administrator)return p("administrator","Administrator access required","Ask a Home Assistant administrator to open this map.","v4_action_administrator","v4_reason_administrator");if(C.host.robotCount===0)return p("setup","Set up a Matic robot","Add the Matic integration to get started.","v4_set_up_robot","v4_setup_reason");if(C.activity==="problem")return p("problem","Check the robot","Resolve the robot's problem before starting another task.","v4_check_robot","v4_problem_reason");if(!C.host.robotConnected)return p("robot-offline","Robot offline","Reconnect the robot to start cleaning.","v4_action_robot_offline","v4_reason_robot_offline");if(C.coherence==="unavailable"||C.coherence==="blocked")return p("map-unavailable","Map unavailable","Open Map diagnostics to check why the map is unavailable.","v4_map_unavailable","v4_map_unavailable_reason");if(C.coherence!=="current")return p("locating","Finding the map","Waiting for the robot to confirm which floor it is on.","v4_action_locating","v4_reason_locating");if((C.workflow==="plan"||C.workflow==="rooms")&&C.resources.plans.status!=="ready"){let V=C.resources.plans.status==="error"||C.resources.plans.status==="empty";return p("plans-unavailable",V?"Rooms and plans unavailable":"Loading rooms and plans\u2026","Load the room and plan list before choosing a cleaning action.",V?"v4_plans_unavailable_action":"v4_loading_rooms_plans","v4_plans_required_reason")}if(C.workflow==="draw"){let V={reason:"Draw the area first.",reasonKey:"v4_reason_save_area_draw"},L=C.draw.circles.length>0&&(!C.draw.outline||C.draw.outline.closed);return{id:"review-area",label:"Name and save",labelKey:"v4_action_review_area",kind:"primary",enabled:L&&B(C),...L?{}:V}}if(C.workflow==="rooms"){let V=C.selection.roomIds.length,L=x2(C),M=L!==null,r=M&&!L.preview.blocker&&L.preview.rooms.length>0,e=w(C)&&V>0&&r;return{id:"clean-rooms",label:V?`Clean ${V} room${V===1?"":"s"}`:"Clean selected rooms",...V?{}:{labelKey:"v4_action_clean_rooms"},kind:"primary",enabled:e,...e?{}:V?w(C)?C.manualRoomPreview.status==="error"?{reason:"The room settings preview could not be verified.",reasonKey:"v4_reason_room_preview_unavailable"}:M&&L.preview.blocker?{reason:"The room preview is blocked. Review the map and shared schedule.",reasonKey:"v4_reason_room_preview_blocked"}:{reason:"Verifying the selected room settings\u2026",reasonKey:"v4_reason_room_preview_loading"}:{reason:"Waiting for the current map to be verified.",reasonKey:"v4_reason_clean_rooms_verification"}:{reason:"Select at least one room to clean.",reasonKey:"v4_reason_clean_rooms_empty"}}}if(C.workflow==="plan"){if(C.planDraft.dirty||!C.planDraft.id){let M=B(C)&&C.planDraft.name.trim().length>0&&C.planDraft.rooms.length>0;return{id:"save-plan",label:"Save plan",labelKey:"v4_action_save_plan",kind:"primary",enabled:M,...M?{}:{reason:"Add a plan name and at least one room.",reasonKey:"v4_reason_save_plan"}}}let V=C.resources.plans.value?.plans.find(M=>M.id===C.planDraft.id),L=!!(V?.nextRunPreview&&!V.nextRunPreview.blocker&&/^[0-9a-f]{64}$/u.test(V.nextRunPreview.previewToken??""));return{id:"run-plan",label:"Run this plan",labelKey:"v4_action_run_plan",kind:"primary",enabled:w(C)&&C.planDraft.enabled&&L,...w(C)?C.planDraft.enabled?L?{}:{reason:"A valid next-run preview is required before starting.",reasonKey:"v4_reason_run_plan_preview"}:{reason:"This plan is paused. Enable it to run.",reasonKey:"v4_reason_run_plan_paused"}:{reason:"Waiting for the current map to be verified.",reasonKey:"v4_reason_run_plan"}}}if(C.workflow==="areaReview"){if(C.areaDraft.dirty||C.draw.dirty||!C.areaDraft.id||C.areaDraft.canRebind){let L=B(C)&&C.areaDraft.name.trim().length>0&&C.draw.circles.length>0;return{id:"save-area",label:C.areaDraft.canRebind?"Confirm on this map":"Save area",labelKey:C.areaDraft.canRebind?"v4_action_save_area_confirm":"v4_action_save_area",kind:"primary",enabled:L,...L?{}:{reason:"Add an area name and at least one mark.",reasonKey:"v4_reason_save_area_details"}}}let V=C.areaDraft.status==="current";return{id:"run-area",label:"Clean this area",labelKey:"v4_action_run_area",kind:"primary",enabled:V&&w(C),...V?{}:{reason:"Confirm this outline on the current map first.",reasonKey:"v4_reason_run_area"}}}return{id:"choose-cleaning",label:"Choose what to clean",labelKey:"v4_action_choose_cleaning",kind:"neutral",enabled:!1,reason:"Choose rooms, a plan, or a custom area.",reasonKey:"v4_reason_choose_cleaning"}},Q2=C=>J(C)&&c2(C).id!=="stop"?Z1(C):null,G2=C=>C.draw.brushMeters*64*(C.draw.zoomPercent/100),O2=[2,1,.5,.25,.1,.05],z2=C=>{let H=64*(C.draw.zoomPercent/100),V=O2.reduce((L,M)=>{let r=Math.abs(M*H-64),e=Math.abs(L*H-64);return r<e?M:L});return{meters:V,pixels:V*H,label:V<1?`${Math.round(V*100)} cm`:`${V} m`}},$2=(C,H)=>({...C,command:H});var N=globalThis,_=N.ShadowRoot&&(N.ShadyCSS===void 0||N.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,C1=Symbol(),S1=new WeakMap,P=class{constructor(H,V,L){if(this._$cssResult$=!0,L!==C1)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=H,this.t=V}get styleSheet(){let H=this.o,V=this.t;if(_&&H===void 0){let L=V!==void 0&&V.length===1;L&&(H=S1.get(V)),H===void 0&&((this.o=H=new CSSStyleSheet).replaceSync(this.cssText),L&&S1.set(V,H))}return H}toString(){return this.cssText}},u1=C=>new P(typeof C=="string"?C:C+"",void 0,C1),f=(C,...H)=>{let V=C.length===1?C[0]:H.reduce((L,M,r)=>L+(e=>{if(e._$cssResult$===!0)return e.cssText;if(typeof e=="number")return e;throw Error("Value passed to 'css' function must be a 'css' function result: "+e+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(M)+C[r+1],C[0]);return new P(V,C,C1)},s1=(C,H)=>{if(_)C.adoptedStyleSheets=H.map(V=>V instanceof CSSStyleSheet?V:V.styleSheet);else for(let V of H){let L=document.createElement("style"),M=N.litNonce;M!==void 0&&L.setAttribute("nonce",M),L.textContent=V.cssText,C.appendChild(L)}},H1=_?C=>C:C=>C instanceof CSSStyleSheet?(H=>{let V="";for(let L of H.cssRules)V+=L.cssText;return u1(V)})(C):C;var{is:h2,defineProperty:g2,getOwnPropertyDescriptor:f2,getOwnPropertyNames:k2,getOwnPropertySymbols:y2,getPrototypeOf:b2}=Object,U=globalThis,c1=U.trustedTypes,w2=c1?c1.emptyScript:"",B2=U.reactiveElementPolyfillSupport,T=(C,H)=>C,V1={toAttribute(C,H){switch(H){case Boolean:C=C?w2:null;break;case Object:case Array:C=C==null?C:JSON.stringify(C)}return C},fromAttribute(C,H){let V=C;switch(H){case Boolean:V=C!==null;break;case Number:V=C===null?null:Number(C);break;case Object:case Array:try{V=JSON.parse(C)}catch{V=null}}return V}},h1=(C,H)=>!h2(C,H),O1={attribute:!0,type:String,converter:V1,reflect:!1,useDefault:!1,hasChanged:h1};Symbol.metadata??=Symbol("metadata"),U.litPropertyMetadata??=new WeakMap;var v=class extends HTMLElement{static addInitializer(H){this._$Ei(),(this.l??=[]).push(H)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(H,V=O1){if(V.state&&(V.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(H)&&((V=Object.create(V)).wrapped=!0),this.elementProperties.set(H,V),!V.noAccessor){let L=Symbol(),M=this.getPropertyDescriptor(H,L,V);M!==void 0&&g2(this.prototype,H,M)}}static getPropertyDescriptor(H,V,L){let{get:M,set:r}=f2(this.prototype,H)??{get(){return this[V]},set(e){this[V]=e}};return{get:M,set(e){let i=M?.call(this);r?.call(this,e),this.requestUpdate(H,i,L)},configurable:!0,enumerable:!0}}static getPropertyOptions(H){return this.elementProperties.get(H)??O1}static _$Ei(){if(this.hasOwnProperty(T("elementProperties")))return;let H=b2(this);H.finalize(),H.l!==void 0&&(this.l=[...H.l]),this.elementProperties=new Map(H.elementProperties)}static finalize(){if(this.hasOwnProperty(T("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(T("properties"))){let V=this.properties,L=[...k2(V),...y2(V)];for(let M of L)this.createProperty(M,V[M])}let H=this[Symbol.metadata];if(H!==null){let V=litPropertyMetadata.get(H);if(V!==void 0)for(let[L,M]of V)this.elementProperties.set(L,M)}this._$Eh=new Map;for(let[V,L]of this.elementProperties){let M=this._$Eu(V,L);M!==void 0&&this._$Eh.set(M,V)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(H){let V=[];if(Array.isArray(H)){let L=new Set(H.flat(1/0).reverse());for(let M of L)V.unshift(H1(M))}else H!==void 0&&V.push(H1(H));return V}static _$Eu(H,V){let L=V.attribute;return L===!1?void 0:typeof L=="string"?L:typeof H=="string"?H.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){this._$ES=new Promise(H=>this.enableUpdating=H),this._$AL=new Map,this._$E_(),this.requestUpdate(),this.constructor.l?.forEach(H=>H(this))}addController(H){(this._$EO??=new Set).add(H),this.renderRoot!==void 0&&this.isConnected&&H.hostConnected?.()}removeController(H){this._$EO?.delete(H)}_$E_(){let H=new Map,V=this.constructor.elementProperties;for(let L of V.keys())this.hasOwnProperty(L)&&(H.set(L,this[L]),delete this[L]);H.size>0&&(this._$Ep=H)}createRenderRoot(){let H=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return s1(H,this.constructor.elementStyles),H}connectedCallback(){this.renderRoot??=this.createRenderRoot(),this.enableUpdating(!0),this._$EO?.forEach(H=>H.hostConnected?.())}enableUpdating(H){}disconnectedCallback(){this._$EO?.forEach(H=>H.hostDisconnected?.())}attributeChangedCallback(H,V,L){this._$AK(H,L)}_$ET(H,V){let L=this.constructor.elementProperties.get(H),M=this.constructor._$Eu(H,L);if(M!==void 0&&L.reflect===!0){let r=(L.converter?.toAttribute!==void 0?L.converter:V1).toAttribute(V,L.type);this._$Em=H,r==null?this.removeAttribute(M):this.setAttribute(M,r),this._$Em=null}}_$AK(H,V){let L=this.constructor,M=L._$Eh.get(H);if(M!==void 0&&this._$Em!==M){let r=L.getPropertyOptions(M),e=typeof r.converter=="function"?{fromAttribute:r.converter}:r.converter?.fromAttribute!==void 0?r.converter:V1;this._$Em=M;let i=e.fromAttribute(V,r.type);this[M]=i??this._$Ej?.get(M)??i,this._$Em=null}}requestUpdate(H,V,L,M=!1,r){if(H!==void 0){let e=this.constructor;if(M===!1&&(r=this[H]),L??=e.getPropertyOptions(H),!((L.hasChanged??h1)(r,V)||L.useDefault&&L.reflect&&r===this._$Ej?.get(H)&&!this.hasAttribute(e._$Eu(H,L))))return;this.C(H,V,L)}this.isUpdatePending===!1&&(this._$ES=this._$EP())}C(H,V,{useDefault:L,reflect:M,wrapped:r},e){L&&!(this._$Ej??=new Map).has(H)&&(this._$Ej.set(H,e??V??this[H]),r!==!0||e!==void 0)||(this._$AL.has(H)||(this.hasUpdated||L||(V=void 0),this._$AL.set(H,V)),M===!0&&this._$Em!==H&&(this._$Eq??=new Set).add(H))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(V){Promise.reject(V)}let H=this.scheduleUpdate();return H!=null&&await H,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??=this.createRenderRoot(),this._$Ep){for(let[M,r]of this._$Ep)this[M]=r;this._$Ep=void 0}let L=this.constructor.elementProperties;if(L.size>0)for(let[M,r]of L){let{wrapped:e}=r,i=this[M];e!==!0||this._$AL.has(M)||i===void 0||this.C(M,void 0,r,i)}}let H=!1,V=this._$AL;try{H=this.shouldUpdate(V),H?(this.willUpdate(V),this._$EO?.forEach(L=>L.hostUpdate?.()),this.update(V)):this._$EM()}catch(L){throw H=!1,this._$EM(),L}H&&this._$AE(V)}willUpdate(H){}_$AE(H){this._$EO?.forEach(V=>V.hostUpdated?.()),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(H)),this.updated(H)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(H){return!0}update(H){this._$Eq&&=this._$Eq.forEach(V=>this._$ET(V,this[V])),this._$EM()}updated(H){}firstUpdated(H){}};v.elementStyles=[],v.shadowRootOptions={mode:"open"},v[T("elementProperties")]=new Map,v[T("finalized")]=new Map,B2?.({ReactiveElement:v}),(U.reactiveElementVersions??=[]).push("2.1.2");var M1=globalThis,g1=C=>C,Q=M1.trustedTypes,f1=Q?Q.createPolicy("lit-html",{createHTML:C=>C}):void 0,r1="$lit$",x=`lit$${Math.random().toFixed(9).slice(2)}$`,e1="?"+x,P2=`<${e1}>`,c=document,F=()=>c.createComment(""),D=C=>C===null||typeof C!="object"&&typeof C!="function",t1=Array.isArray,P1=C=>t1(C)||typeof C?.[Symbol.iterator]=="function",L1=`[ \t\n\f\r]`,R=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,k1=/-->/g,y1=/>/g,u=RegExp(`>|${L1}(?:([^\\s"'>=/]+)(${L1}*=${L1}*(?:[^ \t\n\f\r"'\`<>=]|("|')|))|$)`,"g"),b1=/'/g,w1=/"/g,T1=/^(?:script|style|textarea|title)$/i,o1=C=>(H,...V)=>({_$litType$:C,strings:H,values:V}),R1=o1(1),J2=o1(2),C5=o1(3),O=Symbol.for("lit-noChange"),a=Symbol.for("lit-nothing"),B1=new WeakMap,s=c.createTreeWalker(c,129);function F1(C,H){if(!t1(C)||!C.hasOwnProperty("raw"))throw Error("invalid template strings array");return f1!==void 0?f1.createHTML(H):H}var D1=(C,H)=>{let V=C.length-1,L=[],M,r=H===2?"<svg>":H===3?"<math>":"",e=R;for(let i=0;i<V;i++){let t=C[i],A,d,o=-1,n=0;for(;n<t.length&&(e.lastIndex=n,d=e.exec(t),d!==null);)n=e.lastIndex,e===R?d[1]==="!--"?e=k1:d[1]!==void 0?e=y1:d[2]!==void 0?(T1.test(d[2])&&(M=RegExp("</"+d[2],"g")),e=u):d[3]!==void 0&&(e=u):e===u?d[0]===">"?(e=M??R,o=-1):d[1]===void 0?o=-2:(o=e.lastIndex-d[2].length,A=d[1],e=d[3]===void 0?u:d[3]==='"'?w1:b1):e===w1||e===b1?e=u:e===k1||e===y1?e=R:(e=u,M=void 0);let Z=e===u&&C[i+1].startsWith("/>")?" ":"";r+=e===R?t+P2:o>=0?(L.push(A),t.slice(0,o)+r1+t.slice(o)+x+Z):t+x+(o===-2?i:Z)}return[F1(C,r+(C[V]||"<?>")+(H===2?"</svg>":H===3?"</math>":"")),L]},E=class C{constructor({strings:H,_$litType$:V},L){let M;this.parts=[];let r=0,e=0,i=H.length-1,t=this.parts,[A,d]=D1(H,V);if(this.el=C.createElement(A,L),s.currentNode=this.el.content,V===2||V===3){let o=this.el.content.firstChild;o.replaceWith(...o.childNodes)}for(;(M=s.nextNode())!==null&&t.length<i;){if(M.nodeType===1){if(M.hasAttributes())for(let o of M.getAttributeNames())if(o.endsWith(r1)){let n=d[e++],Z=M.getAttribute(o).split(x),W=/([.?@])?(.*)/.exec(n);t.push({type:1,index:r,name:W[2],strings:Z,ctor:W[1]==="."?z:W[1]==="?"?$:W[1]==="@"?K:g}),M.removeAttribute(o)}else o.startsWith(x)&&(t.push({type:6,index:r}),M.removeAttribute(o));if(T1.test(M.tagName)){let o=M.textContent.split(x),n=o.length-1;if(n>0){M.textContent=Q?Q.emptyScript:"";for(let Z=0;Z<n;Z++)M.append(o[Z],F()),s.nextNode(),t.push({type:2,index:++r});M.append(o[n],F())}}}else if(M.nodeType===8)if(M.data===e1)t.push({type:2,index:r});else{let o=-1;for(;(o=M.data.indexOf(x,o+1))!==-1;)t.push({type:7,index:r}),o+=x.length-1}r++}}static createElement(H,V){let L=c.createElement("template");return L.innerHTML=H,L}};function h(C,H,V=C,L){if(H===O)return H;let M=L!==void 0?V._$Co?.[L]:V._$Cl,r=D(H)?void 0:H._$litDirective$;return M?.constructor!==r&&(M?._$AO?.(!1),r===void 0?M=void 0:(M=new r(C),M._$AT(C,V,L)),L!==void 0?(V._$Co??=[])[L]=M:V._$Cl=M),M!==void 0&&(H=h(C,M._$AS(C,H.values),M,L)),H}var G=class{constructor(H,V){this._$AV=[],this._$AN=void 0,this._$AD=H,this._$AM=V}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(H){let{el:{content:V},parts:L}=this._$AD,M=(H?.creationScope??c).importNode(V,!0);s.currentNode=M;let r=s.nextNode(),e=0,i=0,t=L[0];for(;t!==void 0;){if(e===t.index){let A;t.type===2?A=new k(r,r.nextSibling,this,H):t.type===1?A=new t.ctor(r,t.name,t.strings,this,H):t.type===6&&(A=new q(r,this,H)),this._$AV.push(A),t=L[++i]}e!==t?.index&&(r=s.nextNode(),e++)}return s.currentNode=c,M}p(H){let V=0;for(let L of this._$AV)L!==void 0&&(L.strings!==void 0?(L._$AI(H,L,V),V+=L.strings.length-2):L._$AI(H[V])),V++}},k=class C{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(H,V,L,M){this.type=2,this._$AH=a,this._$AN=void 0,this._$AA=H,this._$AB=V,this._$AM=L,this.options=M,this._$Cv=M?.isConnected??!0}get parentNode(){let H=this._$AA.parentNode,V=this._$AM;return V!==void 0&&H?.nodeType===11&&(H=V.parentNode),H}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(H,V=this){H=h(this,H,V),D(H)?H===a||H==null||H===""?(this._$AH!==a&&this._$AR(),this._$AH=a):H!==this._$AH&&H!==O&&this._(H):H._$litType$!==void 0?this.$(H):H.nodeType!==void 0?this.T(H):P1(H)?this.k(H):this._(H)}O(H){return this._$AA.parentNode.insertBefore(H,this._$AB)}T(H){this._$AH!==H&&(this._$AR(),this._$AH=this.O(H))}_(H){this._$AH!==a&&D(this._$AH)?this._$AA.nextSibling.data=H:this.T(c.createTextNode(H)),this._$AH=H}$(H){let{values:V,_$litType$:L}=H,M=typeof L=="number"?this._$AC(H):(L.el===void 0&&(L.el=E.createElement(F1(L.h,L.h[0]),this.options)),L);if(this._$AH?._$AD===M)this._$AH.p(V);else{let r=new G(M,this),e=r.u(this.options);r.p(V),this.T(e),this._$AH=r}}_$AC(H){let V=B1.get(H.strings);return V===void 0&&B1.set(H.strings,V=new E(H)),V}k(H){t1(this._$AH)||(this._$AH=[],this._$AR());let V=this._$AH,L,M=0;for(let r of H)M===V.length?V.push(L=new C(this.O(F()),this.O(F()),this,this.options)):L=V[M],L._$AI(r),M++;M<V.length&&(this._$AR(L&&L._$AB.nextSibling,M),V.length=M)}_$AR(H=this._$AA.nextSibling,V){for(this._$AP?.(!1,!0,V);H!==this._$AB;){let L=g1(H).nextSibling;g1(H).remove(),H=L}}setConnected(H){this._$AM===void 0&&(this._$Cv=H,this._$AP?.(H))}},g=class{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(H,V,L,M,r){this.type=1,this._$AH=a,this._$AN=void 0,this.element=H,this.name=V,this._$AM=M,this.options=r,L.length>2||L[0]!==""||L[1]!==""?(this._$AH=Array(L.length-1).fill(new String),this.strings=L):this._$AH=a}_$AI(H,V=this,L,M){let r=this.strings,e=!1;if(r===void 0)H=h(this,H,V,0),e=!D(H)||H!==this._$AH&&H!==O,e&&(this._$AH=H);else{let i=H,t,A;for(H=r[0],t=0;t<r.length-1;t++)A=h(this,i[L+t],V,t),A===O&&(A=this._$AH[t]),e||=!D(A)||A!==this._$AH[t],A===a?H=a:H!==a&&(H+=(A??"")+r[t+1]),this._$AH[t]=A}e&&!M&&this.j(H)}j(H){H===a?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,H??"")}},z=class extends g{constructor(){super(...arguments),this.type=3}j(H){this.element[this.name]=H===a?void 0:H}},$=class extends g{constructor(){super(...arguments),this.type=4}j(H){this.element.toggleAttribute(this.name,!!H&&H!==a)}},K=class extends g{constructor(H,V,L,M,r){super(H,V,L,M,r),this.type=5}_$AI(H,V=this){if((H=h(this,H,V,0)??a)===O)return;let L=this._$AH,M=H===a&&L!==a||H.capture!==L.capture||H.once!==L.once||H.passive!==L.passive,r=H!==a&&(L===a||M);M&&this.element.removeEventListener(this.name,this,L),r&&this.element.addEventListener(this.name,this,H),this._$AH=H}handleEvent(H){typeof this._$AH=="function"?this._$AH.call(this.options?.host??this.element,H):this._$AH.handleEvent(H)}},q=class{constructor(H,V,L){this.element=H,this.type=6,this._$AN=void 0,this._$AM=V,this.options=L}get _$AU(){return this._$AM._$AU}_$AI(H){h(this,H)}},H5={M:r1,P:x,A:e1,C:1,L:D1,R:G,D:P1,V:h,I:k,H:g,N:$,U:K,B:z,F:q},T2=M1.litHtmlPolyfillSupport;T2?.(E,k),(M1.litHtmlVersions??=[]).push("3.3.3");var E1=(C,H,V)=>{let L=V?.renderBefore??H,M=L._$litPart$;if(M===void 0){let r=V?.renderBefore??null;L._$litPart$=M=new k(H.insertBefore(F(),r),r,void 0,V??{})}return M._$AI(C),M};var i1=globalThis,y=class extends v{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){let H=super.createRenderRoot();return this.renderOptions.renderBefore??=H.firstChild,H}update(H){let V=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(H),this._$Do=E1(V,this.renderRoot,this.renderOptions)}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(!0)}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(!1)}render(){return O}};y._$litElement$=!0,y.finalized=!0,i1.litElementHydrateSupport?.({LitElement:y});var R2=i1.litElementPolyfillSupport;R2?.({LitElement:y});(i1.litElementVersions??=[]).push("4.2.2");var n5=f`
:host {
--ms-safe-top: var(--safe-area-inset-top, env(safe-area-inset-top, 0px));
--ms-safe-right: var(--safe-area-inset-right, env(safe-area-inset-right, 0px));
--ms-safe-bottom: var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px));
--ms-safe-left: var(--safe-area-inset-left, env(safe-area-inset-left, 0px));
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
`,l5=f`
*, *::before, *::after { box-sizing: border-box; }
button, input, select, textarea { font: inherit; }
.ms-icon { display: block; flex: none; inline-size: var(--ms-icon); block-size: var(--ms-icon); }
.ms-icon--sm { inline-size: var(--ms-icon-sm); block-size: var(--ms-icon-sm); }
`;var Z5=f`
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
`;var W1="M11,4H13V16L18.5,10.5L19.92,11.92L12,19.84L4.08,11.92L5.5,10.5L11,16V4Z";var I1="M9.5,13.09L10.91,14.5L6.41,19H10V21H3V14H5V17.59L9.5,13.09M10.91,9.5L9.5,10.91L5,6.41V10H3V3H10V5H6.41L10.91,9.5M14.5,13.09L19,17.59V14H21V21H14V19H17.59L13.09,14.5L14.5,13.09M13.09,9.5L17.59,5H14V3H21V10H19V6.41L14.5,10.91L13.09,9.5Z";var N1="M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z";var _1="M13,20H11V8L5.5,13.5L4.08,12.08L12,4.16L19.92,12.08L18.5,13.5L13,8V20Z";var U1="M23,11H20V4L15,14H18V22M12,13H4V6H12M12.67,4H11V2H5V4H3.33A1.33,1.33 0 0,0 2,5.33V20.67C2,21.4 2.6,22 3.33,22H12.67C13.4,22 14,21.4 14,20.67V5.33A1.33,1.33 0 0,0 12.67,4Z";var Q1="M20.71,4.63L19.37,3.29C19,2.9 18.35,2.9 17.96,3.29L9,12.25L11.75,15L20.71,6.04C21.1,5.65 21.1,5 20.71,4.63M7,14A3,3 0 0,0 4,17C4,18.31 2.84,19 2,19C2.92,20.22 4.5,21 6,21A4,4 0 0,0 10,17A3,3 0 0,0 7,14Z";var A1="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z";var G1="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z";var a1="M7.41,15.41L12,10.83L16.59,15.41L18,14L12,8L6,14L7.41,15.41Z";var z1="M12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z";var $1="M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z";var K1="M13,6V11H18V7.75L22.25,12L18,16.25V13H13V18H16.25L12,22.25L7.75,18H11V13H6V16.25L1.75,12L6,7.75V11H11V6H7.75L12,1.75L16.25,6H13Z";var q1="M20 4H4A2 2 0 0 0 2 6V18A2 2 0 0 0 4 20H20A2 2 0 0 0 22 18V6A2 2 0 0 0 20 4M15 18H4V6H15Z";var j1="M12,16A2,2 0 0,1 14,18A2,2 0 0,1 12,20A2,2 0 0,1 10,18A2,2 0 0,1 12,16M12,10A2,2 0 0,1 14,12A2,2 0 0,1 12,14A2,2 0 0,1 10,12A2,2 0 0,1 12,10M12,4A2,2 0 0,1 14,6A2,2 0 0,1 12,8A2,2 0 0,1 10,6A2,2 0 0,1 12,4Z";var X1="M16.24,3.56L21.19,8.5C21.97,9.29 21.97,10.55 21.19,11.34L12,20.53C10.44,22.09 7.91,22.09 6.34,20.53L2.81,17C2.03,16.21 2.03,14.95 2.81,14.16L13.41,3.56C14.2,2.78 15.46,2.78 16.24,3.56M4.22,15.58L7.76,19.11C8.54,19.9 9.8,19.9 10.59,19.11L14.12,15.58L9.17,10.63L4.22,15.58Z";var Y1="M18.5,4L19.66,8.35L18.7,8.61C18.25,7.74 17.79,6.87 17.26,6.43C16.73,6 16.11,6 15.5,6H13V16.5C13,17 13,17.5 13.33,17.75C13.67,18 14.33,18 15,18V19H9V18C9.67,18 10.33,18 10.67,17.75C11,17.5 11,17 11,16.5V6H8.5C7.89,6 7.27,6 6.74,6.43C6.21,6.87 5.75,7.74 5.3,8.61L4.34,8.35L5.5,4H18.5Z";var J1="M11,18H13V16H11V18M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M12,6A4,4 0 0,0 8,10H10A2,2 0 0,1 12,8A2,2 0 0,1 14,10C14,12 11,11.75 11,15H13C13,12.75 16,12.5 16,10A4,4 0 0,0 12,6Z";var C2="M13.5,8H12V13L16.28,15.54L17,14.33L13.5,12.25V8M13,3A9,9 0 0,0 4,12H1L4.96,16.03L9,12H6A7,7 0 0,1 13,5A7,7 0 0,1 20,12A7,7 0 0,1 13,19C11.07,19 9.32,18.21 8.06,16.94L6.64,18.36C8.27,20 10.5,21 13,21A9,9 0 0,0 22,12A9,9 0 0,0 13,3";var H2="M11,9H13V7H11M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M11,17H13V11H11V17Z";var V2="M16.37,16.1L11.75,11.47L11.64,11.36L3.27,3L2,4.27L5.18,7.45C5.06,7.95 5,8.46 5,9C5,14.25 12,22 12,22C12,22 13.67,20.15 15.37,17.65L18.73,21L20,19.72M12,6.5A2.5,2.5 0 0,1 14.5,9C14.5,9.73 14.17,10.39 13.67,10.85L17.3,14.5C18.28,12.62 19,10.68 19,9A7,7 0 0,0 12,2C10,2 8.24,2.82 6.96,4.14L10.15,7.33C10.61,6.82 11.26,6.5 12,6.5Z";var L2="M3,6H21V8H3V6M3,11H21V13H3V11M3,16H21V18H3V16Z";var M2="M14,19H18V5H14M6,19H10V5H6V19Z";var r2="M8,5.14V19.14L19,12.14L8,5.14Z";var e2="M14 10H3V12H14V10M14 6H3V8H14V6M3 16H10V14H3V16M21.5 11.5L23 13L16 20L11.5 15.5L13 14L16 17L21.5 11.5Z";var t2="M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z";var o2="M18.4,10.6C16.55,9 14.15,8 11.5,8C6.85,8 2.92,11.03 1.54,15.22L3.9,16C4.95,12.81 7.95,10.5 11.5,10.5C13.45,10.5 15.23,11.22 16.62,12.38L13,16H22V7L18.4,10.6Z";var i2="M13,4.07V1L8.45,5.55L13,10V6.09C15.84,6.57 18,9.03 18,12C18,14.97 15.84,17.43 13,17.91V19.93C16.95,19.44 20,16.08 20,12C20,7.92 16.95,4.56 13,4.07M7.1,18.32C8.26,19.22 9.61,19.76 11,19.93V17.9C10.13,17.75 9.29,17.41 8.54,16.87L7.1,18.32M6.09,13H4.07C4.24,14.39 4.79,15.73 5.69,16.89L7.1,15.47C6.58,14.72 6.23,13.88 6.09,13M7.11,8.53L5.7,7.11C4.8,8.27 4.24,9.61 4.07,11H6.09C6.23,10.13 6.58,9.28 7.11,8.53Z";var A2="M16.89,15.5L18.31,16.89C19.21,15.73 19.76,14.39 19.93,13H17.91C17.77,13.87 17.43,14.72 16.89,15.5M13,17.9V19.92C14.39,19.75 15.74,19.21 16.9,18.31L15.46,16.87C14.71,17.41 13.87,17.76 13,17.9M19.93,11C19.76,9.61 19.21,8.27 18.31,7.11L16.89,8.53C17.43,9.28 17.77,10.13 17.91,11M15.55,5.55L11,1V4.07C7.06,4.56 4,7.92 4,12C4,16.08 7.05,19.44 11,19.93V17.91C8.16,17.43 6,14.97 6,12C6,9.03 8.16,6.57 11,6.09V10L15.55,5.55Z";var a2="M17,15.7V13H19V17L10,21L3,14L7,5H11V7H8.3L5.4,13.6L10.4,18.6L17,15.7M22,5V7H19V10H17V7H14V5H17V2H19V5H22Z";var d2="M12.5,8C9.85,8 7.45,9 5.6,10.6L2,7V16H11L7.38,12.38C8.77,11.22 10.54,10.5 12.5,10.5C16.04,10.5 19.05,12.81 20.1,16L22.47,15.22C21.08,11.03 17.15,8 12.5,8Z";var F2="M8.2 6.2H22.6Q23 6.2 23 6.6V7.7H7.86V6.6Q7.86 6.2 8.2 6.2ZM7.86 8.4H23V14.35Q23 16.1 21.3 16.1H16.2A5.3 5.3 0 0 0 7.86 9.65ZM11.7 8.72A4.53 4.53 0 1 0 11.7 17.78A4.53 4.53 0 1 0 11.7 8.72ZM11.7 10.02A3.23 3.23 0 1 1 11.7 16.48A3.23 3.23 0 1 1 11.7 10.02ZM2.2 11.5H5.5Q7.2 11.5 7.2 13V15Q7.2 16.1 5.5 16.1H2.3Q1 16.1 1 14.8V13Q1 11.5 2.2 11.5ZM19.8 16.1H22.3L22 17.3H21Z";var f5=N1,k5=j1,y5=L2,b5=q1,w5=G1,B5=a1,P5=A1,T5=a1,R5=A1,F5=I1,D5=Y1,E5=J1,W5=i2,I5=A2,N5=d2,_5=o2,U5=Q1,Q5=z1,G5=X1,z5=K1;var $5=t2;var K5=_1,q5=W1,j5=$1,X5=a2,Y5=C2,J5=e2,C3=H2,H3=r2,V3=M2,L3=U1,M3=V2,r3=C=>R1`<svg
  class="ms-icon"
  viewBox="0 0 24 24"
  fill="currentColor"
  aria-hidden="true"
  focusable="false"
><path d=${C}></path></svg>`;var m2="component.matic_robot.common.",o3=(C,H,V,L)=>{let M=L?{...L}:void 0,r=C?.(`${m2}${H}`,M);return r&&r!==`${m2}${H}`?r:L?Object.entries(L).reduce((e,[i,t])=>e.replaceAll(`{${i}}`,String(t)),V):V};export{b as a,d1 as b,j as c,m1 as d,X as e,D2 as f,p1 as g,n1 as h,l2 as i,I as j,v2 as k,x2 as l,Z2 as m,S2 as n,l1 as o,v1 as p,Y as q,_2 as r,B as s,U2 as t,w as u,u2 as v,s2 as w,c2 as x,Q2 as y,G2 as z,z2 as A,$2 as B,f as C,R1 as D,J2 as E,C5 as F,O as G,a as H,H5 as I,y as J,n5 as K,l5 as L,Z5 as M,F2 as N,f5 as O,k5 as P,y5 as Q,b5 as R,w5 as S,B5 as T,P5 as U,T5 as V,R5 as W,F5 as X,D5 as Y,E5 as Z,W5 as _,I5 as $,N5 as aa,_5 as ba,U5 as ca,Q5 as da,G5 as ea,z5 as fa,$5 as ga,K5 as ha,q5 as ia,j5 as ja,X5 as ka,Y5 as la,J5 as ma,C3 as na,H3 as oa,V3 as pa,L3 as qa,M3 as ra,r3 as sa,o3 as ta};
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
