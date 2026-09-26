import{a as ge,b as re,c as oe,d as se,e as Xe,f as Pt,g as Ot,h as Dt,i as qt,j as ie,k as et}from"./chunk-GJKPKQJ6.js";import{C as V,D as ye,E as Rt,F as xt,H as k,J as j,K as Y,L as X,M as be,N as ae,O as we,P as Ct,Q as Mt,R as Et,S as _e,T as At,U as It,c as Be,d as Ue,f as fe,g as U,j as O,k as yt,ka as $t,l as Ve,la as Ge,m as je,ma as Je,na as Tt,o as gt,oa as Qe,p as bt,pa as Ze,qa as Lt,ra as G,s as ne,sa as A,t as Ye,ta as z,u as ve,v as wt,w as _t,x as kt,y as St}from"./chunk-A6PCQKJI.js";var In=(s,t)=>{if(t?.recharge_and_resume===!0&&t?.charging===!0)return"recharging";switch(s){case"cleaning":return"cleaning";case"paused":return"paused";case"returning":return"returning";case"docked":return"docked";case"idle":return"idle";case"error":return"problem";default:return"unknown"}},$n=s=>typeof s!="number"||!Number.isFinite(s)?null:Math.round(Math.max(0,Math.min(100,s))),Tn=s=>{let t=s.attributes?.matic_entry_id;return typeof t=="string"&&t.length>0?t:null},Ln=s=>String(s||"local-user").replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",zt=s=>{if(typeof s!="string")return"Matic robot";let t=s.trim();return t&&Array.from(t).length<=128&&!/[\u0000-\u001f\u007f]/u.test(t)?t:"Matic robot"},ke=class{#e="";#t=null;project(t,e,n=null){let r=t?.states??{},o=e?.config?.entry_id,a=typeof o=="string"?o:null,i=null,l=null,d=null,c=new Map;for(let[y,M]of Object.entries(r)){let E=Tn(M);if(!E||!y.startsWith("vacuum."))continue;c.set(E,{entryId:E,label:zt(M.attributes?.friendly_name)});let pe=n||a;(!i||pe&&E===pe)&&(i=M,l=y,d=E)}let u={connected:t?.connected!==!1,administrator:t?.user?.is_admin===!0,robotConnected:i!==null&&i.state!=="unavailable"&&i.state!=="unknown",robotCount:c.size},p=i?In(i.state,i.attributes):"unknown",h=$n(i?.attributes?.battery_level),g=t?.selectedLanguage||t?.language||"en",v=Ln(t?.user?.id),w=zt(i?.attributes?.friendly_name),S=[...c.values()].sort((y,M)=>y.label.localeCompare(M.label,g,{sensitivity:"base"})),_=[u.connected,u.administrator,u.robotConnected,u.robotCount,p,h??"none",g,v,l??"none",d??"none",w,S.map(y=>`${y.entryId}:${y.label}`).join(",")].join("|");return _===this.#e&&this.#t?this.#t:(this.#e=_,this.#t={host:u,activity:p,batteryPercent:h,language:g,userKey:v,vacuumEntityId:l,entryKey:d,robotLabel:w,robots:S},this.#t)}};var Wt=Symbol.for(""),On=s=>{if(s?.r===Wt)return s?._$litStatic$},J=s=>({_$litStatic$:s,r:Wt});var Nt=new Map,tt=s=>(t,...e)=>{let n=e.length,r,o,a=[],i=[],l,d=0,c=!1;for(;d<n;){for(l=t[d];d<n&&(o=e[d],(r=On(o))!==void 0);)l+=r+t[++d],c=!0;d!==n&&i.push(o),a.push(l),d++}if(d===n&&a.push(t[n]),c){let u=a.join("$$lit$$");(t=Nt.get(u))===void 0&&(a.raw=a,Nt.set(u,t=a)),e=i}return s(t,...e)},b=tt(ye),vr=tt(Rt),yr=tt(xt);var Ht="/api/matic_robot/slam_entries",xe=24,Ft=8,rt=15e5,Kt=16*1024*1024,m=class extends Error{constructor(t){super(t),this.name="ContractError",this.code=t}},P=(s,t)=>{if(!s||typeof s!="object"||Array.isArray(s))throw new m(t);return s},R=(s,t,e)=>{if(typeof s!="string")throw new m(e);let n=s.trim();if(!n||Array.from(n).length>t||/[\u0000-\u001f\u007f]/u.test(n))throw new m(e);return n},Dn=s=>{if(s==null||s==="")return null;try{return R(s,128,"invalid-floor-label")}catch{return null}},Q=(s,t,e,n)=>{if(typeof s!="number"||!Number.isFinite(s)||s<t||s>e)throw new m(n);return s},I=(s,t,e,n)=>{let r=Q(s,t,e,n);if(!Number.isInteger(r))throw new m(n);return r},nt=(s,t)=>s==null?null:I(s,1,t,"invalid-floor-ordinal"),x=(s,t)=>{if(typeof s!="boolean")throw new m(t);return s},Se=(s,t)=>s===void 0?!1:x(s,t),qn=(s,t)=>s===null?null:x(s,t),Bt=s=>{if(s==null)return null;let t=R(s,64,"invalid-map-session-key");if(!/^[0-9a-f]{64}$/u.test(t))throw new m("invalid-map-session-key");return t},zn=s=>{if(s==null)return null;if(s==="bootstrap_empty"||s==="map_session_unverified"||s==="floor_plan_unavailable"||s==="floor_plan_mismatch")return s;throw new m("invalid-map-block-reason")},Nn=s=>{if(s===void 0)return"not_started";if(s==="not_started"||s==="running"||s==="complete"||s==="partial"||s==="failed")return s;throw new m("invalid-bootstrap-state")},N=(s,t)=>{let e=R(s,512,t);if(!e.startsWith("/")||e.startsWith("//")||e.includes("\\"))throw new m(t);return e},Wn=s=>{let t=typeof s.map_health=="string"?s.map_health.toLowerCase():"",e=typeof s.stream_state=="string"?s.stream_state.toLowerCase():"",n=typeof s.invalid_tiles=="number"?s.invalid_tiles:0;return t.includes("error")||t.includes("fail")||t.includes("degrad")||n>0?"problem":s.map_truncated===!0||t.includes("truncat")||t.includes("limit")?"limited":s.map_complete===!0?"ready":e.includes("connect")||e.includes("collect")||e.includes("run")?"building":"unknown"},Pe=s=>{let t=P(s,"invalid-catalog");if(!Array.isArray(t.entries)||t.entries.length>64)throw new m("invalid-catalog-entries");return t.entries.map(e=>{let n=P(e,"invalid-catalog-entry"),r=I(n.map_revision,0,Number.MAX_SAFE_INTEGER,"invalid-map-revision");return{entryId:R(n.entry_id,128,"invalid-entry-id"),sceneUrl:N(n.scene_url,"invalid-scene-url"),deltaUrl:n.delta_url===void 0||n.delta_url===null?null:N(n.delta_url,"invalid-delta-url"),poseUrl:N(n.pose_url,"invalid-pose-url"),historyUrl:N(n.history_url,"invalid-history-url"),areasUrl:N(n.areas_url,"invalid-areas-url"),plansUrl:N(n.plans_url,"invalid-plans-url"),mapRevision:r,mapFloorCoherent:x(n.map_floor_coherent,"invalid-floor-coherence"),mapSessionVerified:x(n.map_session_verified,"invalid-session-state"),mapSessionKey:Bt(n.map_session_key),mapBlockReason:zn(n.map_block_reason),runnerLocked:x(n.runner_locked,"invalid-runner-lock"),stopSettlePending:x(n.stop_settle_pending,"invalid-stop-settle"),activePlan:x(n.active_plan,"invalid-active-plan"),nativeReconciliationPending:x(n.native_reconciliation_pending,"invalid-native-reconciliation"),nativeSessionActive:qn(n.native_session_active,"invalid-native-session"),mapComplete:x(n.map_complete,"invalid-map-complete"),mapTruncated:x(n.map_truncated,"invalid-map-truncated"),selectedFloorOrdinal:nt(n.selected_floor_ordinal,128),mapFloorOrdinal:nt(n.map_floor_ordinal,128),historyCount:I(n.history_count,0,12,"invalid-history-count"),historyFloorCount:I(n.history_floor_count,0,128,"invalid-floor-count"),health:Wn(n),streamFailures:I(n.stream_failures,0,Number.MAX_SAFE_INTEGER,"invalid-stream-failures"),bootstrapState:Nn(n.bootstrap_state),bootstrapPhotoSeen:n.bootstrap_photo_seen===void 0?!1:x(n.bootstrap_photo_seen,"invalid-bootstrap-photo"),bootstrapStructureSeen:n.bootstrap_structure_seen===void 0?!1:x(n.bootstrap_structure_seen,"invalid-bootstrap-structure"),bootstrapFailures:n.bootstrap_failures===void 0?0:I(n.bootstrap_failures,0,2,"invalid-bootstrap-failures")}})},Ut=(s,t)=>{if(!Array.isArray(s)||s.length!==2)throw new m(t);return[Q(s[0],-1e6,1e6,t),Q(s[1],-1e6,1e6,t)]},Hn=(s,t)=>{if(!Array.isArray(s)||s.length<3||s.length>8192)throw new m(t);return s.map(e=>Ut(e,t))},Vt=(s,t)=>{if(!Array.isArray(s)||s.length>256)throw new m("invalid-rooms");return s.map(e=>{let n=P(e,"invalid-room");return{roomId:R(n.room_id,128,"invalid-room-id"),name:R(n.name,128,"invalid-room-name"),boundary:t?Hn(n.boundary,"invalid-room-boundary"):[]}})},Fn=s=>{let t=P(s,"invalid-history-snapshot"),e=R(t.created_at,64,"invalid-history-time");if(!Number.isFinite(Date.parse(e)))throw new m("invalid-history-time");return{id:R(t.id,128,"invalid-history-id"),createdAt:e,revision:I(t.revision,0,Number.MAX_SAFE_INTEGER,"invalid-history-revision"),pointCount:I(t.point_count,1,rt,"invalid-history-points"),sceneUrl:N(t.scene_url,"invalid-history-scene-url")}},jt=s=>{let t=P(s,"invalid-history");if(!Array.isArray(t.floors)||t.floors.length<1||t.floors.length>128)throw new m("invalid-history-floors");return{entryId:R(t.entry_id,128,"invalid-history-entry"),liveAvailable:x(t.live_available,"invalid-history-live"),floors:t.floors.map(e=>{let n=P(e,"invalid-history-floor");if(!Array.isArray(n.snapshots)||n.snapshots.length>12)throw new m("invalid-history-snapshots");return{id:R(n.id,128,"invalid-history-floor-id"),active:x(n.active,"invalid-history-floor-active"),readOnly:x(n.read_only,"invalid-history-floor-read-only"),liveAvailable:n.live_available===void 0?!1:x(n.live_available,"invalid-history-floor-live"),label:Dn(n.label),ordinal:n.ordinal===void 0?null:nt(n.ordinal,128),snapshots:n.snapshots.map(Fn)}})}},Ce=s=>{if(s==="vacuum"||s==="mop"||s==="vacuum_and_mop")return s;throw new m("invalid-cleaning-mode")},le=s=>{if(s==="quick"||s==="standard"||s==="heavy_duty")return s;throw new m("invalid-coverage-setting")},Re=(s,t)=>s==null?null:I(s,1,100,t),Me=s=>{if(s==null)return[];let t=["mop_due","coverage_due","room_not_on_current_map","identity_changed","shared_schedule_unavailable","invalid_cadence_policy"];if(!Array.isArray(s)||s.length>t.length||s.some(e=>!t.includes(e)))throw new m("invalid-cadence-reasons");return[...new Set(s)]},Yt=s=>{if(s==null)return;let t=P(s,"invalid-room-cadence"),e=t.scope===void 0?"plan":t.scope;if(e!=="plan"&&e!=="shared")throw new m("invalid-room-cadence-scope");let n=t.periodic_coverage_setting;return{scope:e,mopEveryN:Re(t.mop_every_n,"invalid-mop-interval"),coverageEveryN:Re(t.coverage_every_n,"invalid-coverage-interval"),periodicCoverageSetting:n==null?null:le(n),doMopNext:Se(t.do_mop_next,"invalid-do-mop-next"),doCoverageNext:Se(t.do_coverage_next,"invalid-do-coverage-next")}},ot=(s,t)=>{if(s==null)return;let e=P(s,"invalid-room-cadence-progress"),n=e.effective_cleaning_mode,r=e.effective_coverage_setting,o=Me(t??e.cadence_reasons);return{mopProgress:I(e.mop_progress??0,0,100,"invalid-mop-progress"),coverageProgress:I(e.coverage_progress??0,0,100,"invalid-coverage-progress"),mopDue:Se(e.mop_due,"invalid-mop-due"),coverageDue:Se(e.coverage_due,"invalid-coverage-due"),nextMopIn:Re(e.next_mop_in,"invalid-next-mop"),nextCoverageIn:Re(e.next_coverage_in,"invalid-next-coverage"),reasons:o,...n===void 0?{}:{effectiveCleaningMode:Ce(n)},...r===void 0?{}:{effectiveCoverageSetting:le(r)}}},Kn=s=>{let t=P(s,"invalid-plan-room"),e=Yt(t.cadence),n=ot(t.cadence_progress,t.cadence_reasons),r=Me(t.cadence_reasons);return{roomId:R(t.room_id,128,"invalid-plan-room-id"),cleaningMode:Ce(t.cleaning_mode),coverageSetting:le(t.coverage_setting),...e===void 0?{}:{cadence:e},...n===void 0?{}:{cadenceProgress:n},...r.length?{cadenceReasons:r}:{}}},Xt=s=>{if(s==null)return;let t=P(s,"invalid-plan-preview");if(!Array.isArray(t.rooms)||t.rooms.length>256||!Array.isArray(t.mission_boundaries)||t.mission_boundaries.length>255)throw new m("invalid-plan-preview");let e=t.rooms.map(i=>{let l=P(i,"invalid-plan-preview-room");return{roomId:R(l.room_id,128,"invalid-plan-preview-room-id"),name:R(l.name,128,"invalid-plan-preview-room-name"),cleaningMode:Ce(l.cleaning_mode),coverageSetting:le(l.coverage_setting),cadenceReasons:Me(l.cadence_reasons)}}),n=t.mission_boundaries.map(i=>I(i,1,Math.max(1,e.length-1),"invalid-plan-preview-boundary"));if(n.some((i,l)=>i>=e.length||i<=(n[l-1]??0)))throw new m("invalid-plan-preview-boundary-order");let r=["cadence_identity_unavailable","preview_unavailable","plan_disabled","plan_has_no_rooms","cadence_identity_changed","shared_schedule_unavailable","invalid_cadence_policy","invalid_plan"],o=t.blocker;if(o!==null&&!r.includes(o))throw new m("invalid-plan-preview-blocker");if(o===null&&e.length===0)throw new m("empty-plan-preview");let a=t.preview_token;if(a!==void 0&&(typeof a!="string"||!/^[0-9a-f]{64}$/u.test(a)))throw new m("invalid-plan-preview-token");return{rooms:e,missionBoundaries:n,blocker:o,...typeof a=="string"?{previewToken:a}:{}}},Gt=s=>{let t=P(s,"invalid-room-sequence-preview"),e=R(t.entry_id,128,"invalid-room-sequence-preview-entry"),n=R(t.floor_token,128,"invalid-room-sequence-preview-floor"),r=R(t.preview_token,64,"invalid-room-sequence-preview-token");if(!/^[0-9a-f]{64}$/u.test(n)||!/^[0-9a-f]{64}$/u.test(r))throw new m("invalid-room-sequence-preview-token");let o=Xt({rooms:t.rooms,mission_boundaries:t.mission_boundaries,blocker:t.blocker});if(!o)throw new m("invalid-room-sequence-preview");let a=t.rooms;if(!Array.isArray(a))throw new m("invalid-room-sequence-preview-rooms");let i=o.rooms.map((l,d)=>{let c=P(a[d],"invalid-room-sequence-preview-room"),u=ot(c.cadence_progress,c.cadence_reasons);return{...l,...u===void 0?{}:{cadenceProgress:u}}});return{entryId:e,floorToken:n,previewToken:r,rooms:i,missionBoundaries:o.missionBoundaries,blocker:o.blocker}},Bn=s=>{if(s==null)return null;if(!Array.isArray(s)||s.length<3||s.length>64)throw new m("invalid-area-outline");let t={closed:!0,points:s.map(e=>{let n=P(e,"invalid-area-outline");if(typeof n.x!="number"||typeof n.y!="number")throw new m("invalid-area-outline");return{x:n.x,y:n.y}})};if(!Pt(t))throw new m("invalid-area-outline");return t},Un=s=>{let t=P(s,"invalid-area-circle");return{x:Q(t.x,-1e6,1e6,"invalid-area-circle"),y:Q(t.y,-1e6,1e6,"invalid-area-circle"),radius:Q(t.radius,.05,2.5,"invalid-area-circle")}},Vn=s=>s==="current"||s==="review"||s==="stale"?s:"unknown",Jt=s=>{let t=P(s,"invalid-areas");if(!Array.isArray(t.areas)||t.areas.length>256)throw new m("invalid-area-list");return{sceneUrl:N(t.scene_url,"invalid-area-scene-url"),rooms:Vt(t.rooms,!0),areas:t.areas.map(e=>{let n=P(e,"invalid-area");if(!Array.isArray(n.circles)||n.circles.length>512)throw new m("invalid-area-circles");return{id:R(n.id,128,"invalid-area-id"),name:R(n.name,128,"invalid-area-name"),circles:n.circles.map(Un),outline:Bn(n.outline),cleaningMode:Ce(n.cleaning_mode),coverageSetting:le(n.coverage_setting),status:Vn(n.status),canRebind:x(n.can_rebind,"invalid-area-rebind")}})}},Qt=s=>{let t=P(s,"invalid-plans");if(!Array.isArray(t.plans)||t.plans.length>256)throw new m("invalid-plan-list");let e=t.rooms;return{rooms:Vt(e,!1).map((r,o)=>{let a=Array.isArray(e)?e[o]:void 0,i=P(a,"invalid-room"),l=Yt(i.shared_cadence),d=ot(i.shared_cadence_progress,i.shared_cadence_reasons),c=Me(i.shared_cadence_reasons);return{roomId:r.roomId,name:r.name,...l===void 0?{}:{sharedCadence:l},...d===void 0?{}:{sharedCadenceProgress:d},...c.length?{sharedCadenceReasons:c}:{}}}),selectedPlan:t.selected_plan===null||t.selected_plan===void 0?null:R(t.selected_plan,128,"invalid-selected-plan"),plans:t.plans.map(r=>{let o=P(r,"invalid-plan");if(!Array.isArray(o.rooms)||o.rooms.length>256||!Array.isArray(o.room_order))throw new m("invalid-plan-rooms");let a=o.run_behavior;if(a!=="intelligent"&&a!=="ordered")throw new m("invalid-run-behavior");let i=Xt(o.next_run_preview);return{id:R(o.id,128,"invalid-plan-id"),name:R(o.name,128,"invalid-plan-name"),enabled:x(o.enabled,"invalid-plan-enabled"),runBehavior:a,rooms:o.rooms.map(l=>Kn(l)),roomOrder:o.room_order.slice(0,256).map(l=>R(l,128,"invalid-room-order")),returnToBase:x(o.return_to_base,"invalid-return-to-base"),finishCurrentRoom:x(o.finish_current_room,"invalid-finish-room"),finishCurrentRoomThreshold:I(o.finish_current_room_threshold,0,100,"invalid-finish-threshold"),...i===void 0?{}:{nextRunPreview:i}}})}},Zt=s=>{let t=P(s,"invalid-pose"),e=t.position,n=e===null?null:Ut(e,"invalid-pose-position"),r=t.pose_freshness;if(r!=="live"&&r!=="coordinator_fallback")throw new m("invalid-pose-freshness");return{position:n,source:R(t.source,64,"invalid-pose-source"),revision:I(t.revision,0,Number.MAX_SAFE_INTEGER,"invalid-pose-revision"),poseRevision:I(t.pose_revision,0,Number.MAX_SAFE_INTEGER,"invalid-pose-sequence"),floorCoherent:x(t.map_floor_coherent,"invalid-pose-floor"),mapSessionKey:Bt(t.map_session_key),freshness:r}},en=s=>{try{return N(s,"invalid-private-path"),!0}catch{return!1}};var tn=s=>{let o=()=>{throw new Error("invalid-scene")};(!(s instanceof ArrayBuffer)||s.byteLength<24||s.byteLength>16777216)&&o();let a=new DataView(s),i=new Uint8Array(s,0,8),l=String.fromCharCode(...i),d=a.getUint16(8,!0),c=a.getUint16(10,!0),u=a.getUint32(12,!0),p=a.getUint32(16,!0),h=a.getUint32(20,!0),g=p+h,v=24+u;(l!=="MATIC3D\0"||d!==1||c!==8||u>1024*1024||g<1||g>15e5||v+g*c!==s.byteLength)&&o();let w;try{w=JSON.parse(new TextDecoder("utf-8",{fatal:!0}).decode(new Uint8Array(s,24,u)))}catch{o()}(!w||typeof w!="object"||Array.isArray(w))&&o();let S=w,_=S.meters_per_cell,y=S.origin_cells,M=S.span_cells;(typeof _!="number"||!Number.isFinite(_)||_<.001||_>.1||!Array.isArray(y)||y.length!==2||!y.every(T=>typeof T=="number"&&Number.isFinite(T))||!Array.isArray(M)||M.length!==2||!M.every(T=>typeof T=="number"&&Number.isFinite(T)&&T>=1&&T<=65536))&&o();let pe=(Array.isArray(S.rooms)?S.rooms.slice(0,128):[]).flatMap((T,An)=>{if(!T||typeof T!="object"||Array.isArray(T))return[];let K=T,me=typeof K.name=="string"?K.name.trim():"";if(!me||Array.from(me).length>128||/[\u0000-\u001f\u007f]/u.test(me))return[];if(!Array.isArray(K.boundary)||K.boundary.length<3||K.boundary.length>8192)return[];let vt=K.boundary.flatMap(He=>{if(!Array.isArray(He)||He.length!==2)return[];let[Fe,Ke]=He;return typeof Fe=="number"&&Number.isFinite(Fe)&&typeof Ke=="number"&&Number.isFinite(Ke)?[[Fe,Ke]]:[]}),ze=K.center;if(vt.length<3||!Array.isArray(ze)||ze.length!==2)return[];let[Ne,We]=ze;return typeof Ne!="number"||!Number.isFinite(Ne)||typeof We!="number"||!Number.isFinite(We)?[]:[{id:`scene-room-${An+1}`,name:me,boundary:vt,center:[Ne,We]}]}),En=typeof S.sample_step=="number"&&Number.isInteger(S.sample_step)?Math.max(1,Math.min(15e5,S.sample_step)):1,mt=y,ft=M;return{buffer:s,pointOffset:v,floorCount:p,surfaceCount:h,total:g,metadata:{metersPerCell:_,origin:[mt[0],mt[1]],span:[ft[0],ft[1]],sampleStep:En,rooms:pe}}},jn=s=>{if(s.byteLength>Kt||s.byteLength<xe||Ft!==8||rt!==15e5)throw new m("invalid-scene");try{return tn(s)}catch{throw new m("invalid-scene")}},Yn=()=>`
  const parseTransfer = ${tn.toString()};
  self.onmessage = (event) => {
    const { id, buffer } = event.data;
    try {
      const parsed = parseTransfer(buffer);
      self.postMessage({ id, ok: true, parsed }, [parsed.buffer]);
    } catch (_) {
      self.postMessage({ id, ok: false, problem: "invalid-scene" });
    }
  };
`,Ee=class{#e=null;#t=null;#n=0;#s=new Map;constructor(){if(!(typeof Worker!="function"||typeof URL?.createObjectURL!="function"))try{this.#t=URL.createObjectURL(new Blob([Yn()],{type:"text/javascript"})),this.#e=new Worker(this.#t),this.#e.onmessage=t=>{let e=this.#s.get(t.data.id);e&&(this.#s.delete(t.data.id),t.data.ok&&t.data.parsed?e.resolve(t.data.parsed):e.reject(new m(t.data.problem||"invalid-scene")))},this.#e.onerror=()=>this.#o("scene-worker-failed")}catch{this.#e=null,this.#t&&URL.revokeObjectURL(this.#t),this.#t=null}}async parse(t,e){if(e?.aborted)throw new DOMException("Aborted","AbortError");if(!this.#e){if(await new Promise(r=>window.setTimeout(r,0)),e?.aborted)throw new DOMException("Aborted","AbortError");return jn(t)}let n=++this.#n;return new Promise((r,o)=>{let a=()=>{this.#s.delete(n),o(new DOMException("Aborted","AbortError"))};e?.addEventListener("abort",a,{once:!0}),this.#s.set(n,{resolve:i=>{e?.removeEventListener("abort",a),r(i)},reject:i=>{e?.removeEventListener("abort",a),o(i)}}),this.#e?.postMessage({id:n,buffer:t},[t])})}#o(t){for(let e of this.#s.values())e.reject(new m(t));this.#s.clear(),this.#e?.terminate(),this.#e=null}dispose(){this.#o("scene-parser-disposed"),this.#t&&URL.revokeObjectURL(this.#t),this.#t=null}};var D={catalog:1e4,scene:6e4,delta:35e3,pose:1e4,history:15e3,workflow:15e3,mutation:2e4,roomPreview:15e3},C=class extends Error{constructor(t,e=null){super(t),this.name="BackendError",this.code=t,this.status=e}},ce=36,Z=16*1024*1024,nn=(s,t)=>{let e=Number(s);if(!Number.isSafeInteger(e)||e<0)throw new m(t);return e},rn=(s,t)=>{let e=s.headers.get("X-Matic-Revision");if(e===null)return t;let n=Number(e);if(!Number.isSafeInteger(n)||n<0)throw new m("invalid-scene-revision");return n},on=(s,t)=>{let e=s.headers.get("X-Matic-Floor-Coherent");if(e===null)return t;if(e==="1")return!0;if(e==="0")return!1;throw new m("invalid-scene-floor-header")},Ae=class{#e;#t=new Ee;#n=new WeakMap;constructor(t){this.#e=t}async#s(t,e){let n=t.body?.getReader();if(!n)return new ArrayBuffer(0);let r=()=>{n.cancel().catch(()=>{})};e.addEventListener("abort",r,{once:!0});try{if(e.aborted)throw r(),new DOMException("Aborted","AbortError");let o=[],a=0;for(;;){let d=await n.read();if(e.aborted)throw new DOMException("Aborted","AbortError");if(d.done)break;o.push(d.value),a+=d.value.byteLength}let i=new Uint8Array(a),l=0;for(let d of o)i.set(d,l),l+=d.byteLength;return i.buffer}finally{e.removeEventListener("abort",r),n.releaseLock()}}async#o(t,e,n,r,o){if(!en(t))throw new C("invalid-private-path");if(r?.aborted)throw new DOMException("Aborted","AbortError");let a=new AbortController,i=()=>{},l=new Promise((p,h)=>{i=h}),d=()=>{a.abort(),i(new DOMException("Aborted","AbortError"))};r?.addEventListener("abort",d,{once:!0});let c=!1,u=window.setTimeout(()=>{c=!0,d()},n);try{let p=this.#e(),h=new Headers(e.headers),g={...e,cache:"no-store",credentials:"same-origin",headers:Object.fromEntries(h.entries()),signal:a.signal},v=async()=>{let w;if(typeof p?.fetchWithAuth=="function")w=await p.fetchWithAuth(t,g);else{let S=p?.auth?.accessToken||p?.auth?.data?.access_token;S&&h.set("Authorization",`Bearer ${S}`);let _=typeof p?.hassUrl=="function"?p.hassUrl(t):t;w=await fetch(_,{...g,headers:h})}try{if(a.signal.aborted)throw new DOMException("Aborted","AbortError");return await o(w,a.signal)}finally{w.body&&!w.body.locked&&w.body.cancel().catch(()=>{})}};return await Promise.race([v(),l])}catch(p){throw c&&!r?.aborted?new C("request-timeout"):a.signal.aborted?new DOMException("Aborted","AbortError"):p}finally{window.clearTimeout(u),r?.removeEventListener("abort",d)}}async#r(t,e,n,r={}){return this.#o(t,{...r,headers:{Accept:"application/json",...r.headers||{}}},e,n,async(o,a)=>{if(!o.ok){let i=o.headers.get("X-Matic-Plans-Conflict");throw new C(i==="map-rechecking"?"map-rechecking":"request-failed",o.status)}try{return JSON.parse(new TextDecoder().decode(await this.#s(o,a)))}catch{throw new m("invalid-json-response")}})}async catalog(t){return Pe(await this.#r(Ht,D.catalog,t))}async scene(t,e,n,r,o,a){let i=new Headers({Accept:"application/vnd.matic.slam-scene"});return r==="live"&&i.set("X-Matic-Prefer-Cached","1"),a&&i.set("If-None-Match",a),this.#o(t,{headers:i},D.scene,o,async(l,d)=>{let c=rn(l,e),u=on(l,n);if(l.status===304)return{scene:null,floorCoherent:u,revision:c,notModified:!0};if(!l.ok)throw new C("scene-request-failed",l.status);if(l.headers.get("Content-Type")?.split(";",1)[0]!=="application/vnd.matic.slam-scene")throw new m("invalid-scene-content-type");return{scene:{...await this.#t.parse(await this.#s(l,d),d),revision:c,etag:l.headers.get("ETag"),source:r},floorCoherent:u,revision:c,notModified:!1}})}async#u(t,e,n){if(!Number.isSafeInteger(e)||e<1||e>Z||typeof DecompressionStream!="function")throw new m("invalid-scene-delta");let o=new Blob([t]).stream().pipeThrough(new DecompressionStream("deflate")).getReader(),a=new Uint8Array(e),i=0,l=()=>{o.cancel()};n?.addEventListener("abort",l,{once:!0});try{for(;;){if(n?.aborted)throw new DOMException("Aborted","AbortError");let{done:d,value:c}=await o.read();if(d)break;if(!(c instanceof Uint8Array)||i+c.byteLength>e)throw new m("invalid-scene-delta");a.set(c,i),i+=c.byteLength}}finally{n?.removeEventListener("abort",l),o.releaseLock()}if(i!==e)throw new m("invalid-scene-delta");return a}async#d(t,e,n){if(t.byteLength<ce||t.byteLength>ce+Z||e.buffer.byteLength>Z)throw new m("invalid-scene-delta");let r=new DataView(t),o=new TextDecoder().decode(new Uint8Array(t,0,8)),a=r.getUint16(8,!0),i=r.getUint16(10,!0),l=nn(r.getBigUint64(12,!0),"invalid-scene-delta"),d=nn(r.getBigUint64(20,!0),"invalid-scene-delta"),c=r.getUint32(28,!0),u=r.getUint32(32,!0);if(o!=="MATICDLT"||a!==1||i!==1||l!==e.revision||d<=e.revision||c<xe||c>Z||u>Z||u+ce!==t.byteLength)throw new m("invalid-scene-delta");let p=new Uint8Array(t,ce,u),h=new Uint8Array(e.buffer),v=(await this.#u(p,Math.max(h.byteLength,c),n)).slice(),w=1024*1024;for(let y=0;y<h.byteLength;y+=w){if(n?.aborted)throw new DOMException("Aborted","AbortError");let M=Math.min(h.byteLength,y+w);for(let E=y;E<M;E+=1)v[E]=(v[E]??0)^(h[E]??0);M<h.byteLength&&await new Promise(E=>window.setTimeout(E,0))}let S=v.slice(0,c).buffer;return{parsed:{...await this.#t.parse(S,n),revision:d,etag:null,source:"live"},revision:d}}async sceneDelta(t,e,n,r){let o=t.includes("?")?"&":"?";return this.#o(`${t}${o}since=${encodeURIComponent(e.revision)}`,{headers:{Accept:"application/vnd.matic.slam-delta, application/vnd.matic.slam-scene"}},D.delta,r,async(a,i)=>{let l=rn(a,e.revision),d=on(a,n);if(a.status===204){if(l!==e.revision)throw new m("invalid-scene-delta-revision");return{scene:null,floorCoherent:d,revision:l,notModified:!0}}if(!a.ok)throw new C("delta-request-failed",a.status);if(l<=e.revision)throw new m("invalid-scene-delta-revision");let c=Number(a.headers.get("Content-Length"));if(Number.isFinite(c)&&c>ce+Z)throw new m("invalid-scene-delta-size");let u=a.headers.get("Content-Type")?.split(";",1)[0],p=await this.#s(a,i);if(u==="application/vnd.matic.slam-delta"){let g=Number(a.headers.get("X-Matic-Base-Revision"));if(!Number.isSafeInteger(g)||g!==e.revision)throw new m("invalid-scene-delta-base");let v=await this.#d(p,e,i);if(v.revision!==l)throw new m("invalid-scene-delta-revision");return{scene:{...v.parsed,etag:a.headers.get("ETag")},floorCoherent:d,revision:l,notModified:!1}}if(u!=="application/vnd.matic.slam-scene")throw new m("invalid-scene-delta-content-type");return{scene:{...await this.#t.parse(p,i),revision:l,etag:a.headers.get("ETag"),source:"live"},floorCoherent:d,revision:l,notModified:!1}})}async pose(t,e){return Zt(await this.#r(t,D.pose,e))}async history(t,e){return jt(await this.#r(t,D.history,e))}async plans(t,e){return Qt(await this.#r(t,D.workflow,e))}async areas(t,e){return Jt(await this.#r(t,D.workflow,e))}async previewRoomSequence(t,e,n,r){if(!t||t.length>255||e.length<1||e.length>256)throw new m("invalid-room-sequence-preview-request");if(r?.aborted)throw new DOMException("Aborted","AbortError");let o=this.#e()?.connection;if(!o?.sendMessagePromise)throw new C("preview-unavailable");let a=null,i=()=>{},l=new Promise((S,_)=>{i=_}),d=()=>i(new DOMException("Aborted","AbortError"));r?.addEventListener("abort",d,{once:!0});let c=new Promise((S,_)=>{a=window.setTimeout(()=>_(new C("preview-timeout")),D.roomPreview)}),u=this.#n.get(o),p,h=new Promise(S=>{p=S});this.#n.set(o,h);let g=!1,v=()=>{g||(g=!0,p(),this.#n.get(o)===h&&this.#n.delete(o))},w=!1;try{if(u&&(await Promise.race([u,l,c]),r?.aborted))throw new DOMException("Aborted","AbortError");let S=o.sendMessagePromise({type:"call_service",domain:"matic_robot",service:"preview_room_sequence",target:{entity_id:t},service_data:{rooms:e.map(y=>({room:y.room,cleaning_mode:y.cleaning_mode,coverage_setting:y.coverage_setting})),use_room_schedule:!0,override_room_schedule:n},return_response:!0});w=!0,S.then(v,v);let _=await Promise.race([S,l,c]);if(r?.aborted)throw new DOMException("Aborted","AbortError");if(!_||typeof _!="object"||Array.isArray(_)||!("response"in _))throw new m("invalid-room-sequence-preview-envelope");return Gt(_.response)}finally{w||(u?u.then(v,v):v()),a!==null&&window.clearTimeout(a),r?.removeEventListener("abort",d)}}async saveArea(t,e,n){let r=await this.#r(t,D.mutation,n,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...e.areaId?{area_id:e.areaId}:{},name:e.name,circles:e.circles,...e.outline?.closed?{outline:e.outline.points}:{},cleaning_mode:e.cleaningMode,coverage_setting:e.coverageSetting})});if(!r||typeof r!="object"||typeof r.id!="string")throw new m("invalid-area-save-response");return r.id}async deleteArea(t,e,n){await this.#o(`${t}?area_id=${encodeURIComponent(e)}`,{method:"DELETE",headers:{Accept:"application/json"}},D.mutation,n,async r=>{if(!r.ok)throw new C("area-delete-failed",r.status)})}async service(t,e,n,r){let o=this.#e();if(typeof o?.callService!="function")throw new C("service-unavailable");await o.callService(t,e,n,{entity_id:r})}dispose(){this.#t.dispose()}};var an=()=>({version:4,view:"top",appearance:"photo",labels:!0,quality:"auto",cameras:{}}),de=(s,t,e)=>Math.max(t,Math.min(e,s)),ln=s=>s.replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",st=(s,t=4)=>`matic-map-studio:v${t}:${ln(s)}`,Xn=s=>{if(!s||typeof s!="object")return null;let t=s;return["yaw","pitch","zoom","targetX","targetZ"].every(n=>typeof t[n]=="number"&&Number.isFinite(t[n]))?{yaw:de(t.yaw,-Math.PI,Math.PI),pitch:de(t.pitch,.18,Math.PI/2-.018),zoom:de(t.zoom,.01,100),targetX:de(t.targetX,-1e4,1e4),targetZ:de(t.targetZ,-1e4,1e4)}:null},sn=s=>{let t=an();if(!s||typeof s!="object")return t;let e=s,n=e.view==="three"||e.view==="top"||e.view==="rooms"?e.view:t.view,r=n==="rooms"?"top":n,o=e.quality==="auto"||e.quality==="efficient"||e.quality==="balanced"||e.quality==="maximum"?e.quality:t.quality,a=e.cameras&&typeof e.cameras=="object"?e.cameras:{},i={};for(let l of["three","top"]){let d=Xn(a[l]);d&&(i[l]=d)}return{version:4,view:r,appearance:e.appearance==="rooms"||e.appearance==="photo"?e.appearance:t.appearance,labels:typeof e.labels=="boolean"?e.labels:t.labels,quality:o,cameras:i}},Ie=class{#e="local-user";#t=null;#n=null;load(t){this.#s(),this.#e=ln(t);try{let e=window.localStorage.getItem(st(this.#e));if(e)return sn(JSON.parse(e));for(let n of[3,2]){let r=window.localStorage.getItem(st(this.#e,n));if(r)return sn(JSON.parse(r))}}catch{}return an()}schedule(t){this.#t!==null&&window.clearTimeout(this.#t),this.#n={key:st(this.#e),value:t},this.#t=window.setTimeout(()=>this.#s(),250)}#s(){this.#t!==null&&window.clearTimeout(this.#t),this.#t=null;let t=this.#n;if(this.#n=null,!!t)try{window.localStorage.setItem(t.key,JSON.stringify(t.value))}catch{}}dispose(){this.#s()}},cn="matic-map-studio:preferred-frontend",dn=()=>{try{return window.localStorage.getItem(cn)==="v3"?"v3":"v4"}catch{return"v4"}},at=s=>{try{return window.localStorage.setItem(cn,s),!0}catch{return!1}};var it=1,ee=Number.MAX_SAFE_INTEGER,mn=Number.MAX_SAFE_INTEGER,un=64,Gn=4,hn=16*1024,Jn=250,Qn=4e3;function L(s){return s!==null&&typeof s=="object"&&!Array.isArray(s)?s:null}function H(s,t){return typeof s=="number"&&Number.isSafeInteger(s)&&s>=0&&s<=t}function fn(s){let t=L(s);if(!t)return null;let e={};for(let[n,r]of Object.entries(t)){if(n.length===0||n.length>128||!H(r,mn))return null;e[n]=r}return e}function Zn(s){let t=L(s);if(!t||Object.keys(t).length>128)return null;let e={};for(let[n,r]of Object.entries(t)){if(n.length===0||n.length>128||!H(r,mn))return null;e[n]=r}return e}function vn(s){return typeof s=="string"&&s.length>0&&s.length<=256?s:H(s,ee)?String(s):null}function er(s){let t=L(s),e=vn(t?.epoch);if(!t||t.schema!==it||e===null)return null;let n=Zn(t.capabilities),r=fn(t.revisions);return!n||!r||!H(t.sequence,ee)||!H(t.coherence_generation,ee)||t.coherence_generation===0?null:{schema:t.schema,capabilities:n,epoch:e,sequence:t.sequence,coherence_generation:t.coherence_generation,revisions:r}}function pn(s,t){let e=L(s),n=er(e?.snapshot??s);if(!n)return null;let r=L(e?.snapshot??s);if(!r||!("payload"in r))return null;let o=r.entry_id,a=L(r.identity),i=L(r.status),l=L(r.payload),d=i?i.reason===null?null:yn(i.reason):null,c=l?.available,u=null;if(l?.entry!==void 0&&l.entry!==null){if((()=>{try{return JSON.stringify(l.entry).length}catch{return hn+1}})()>hn)return null;try{u=Pe({entries:[l.entry]})[0]??null}catch{return null}}let p=i?.state;return typeof o!="string"||o.length===0||o.length>128||t!==void 0&&o!==t||!a||a.entry_id!==o||a.floor_mission_id!==null&&!H(a.floor_mission_id,ee)||typeof a.floor_verified!="boolean"||a.floor_verified!==(a.floor_mission_id!==null)||!i||p!=="ready"&&p!=="stale"&&p!=="unavailable"||i.reason!==null&&d===null||typeof i.retryable!="boolean"||typeof c!="boolean"||u!==null&&u.entryId!==o||p==="ready"&&(d!==null||i.retryable||!c)||(p==="stale"||p==="unavailable")&&(d===null||c)||d==="authorization"&&i.retryable?null:{...n,entry_id:o,identity:{entry_id:o,floor_mission_id:a.floor_mission_id,floor_verified:a.floor_verified},status:{state:p,reason:d,retryable:i.retryable},payload:{available:c,entry:u}}}function tr(s){let t=L(s),e=vn(t?.epoch),n=fn(t?.revisions),r=t?.resources;return e===null||!n||!H(t?.sequence,ee)||!H(t?.coherence_generation,ee)||t.coherence_generation===0||!Array.isArray(r)||r.length>128||!r.every(o=>typeof o=="string"&&o.length<=128)?null:{epoch:e,sequence:t.sequence,coherence_generation:t.coherence_generation,revisions:n,resources:r}}var nr=["gap","overflow","reconnect","invalid_message","server_request","restart","entry_removed","authorization","snapshot_required"];function yn(s){return typeof s=="string"&&nr.includes(s)?s:null}var $e=class{#e;#t;#n;#s=null;#o=!1;#r=!1;#u=!1;#d=null;#f=null;#i=0;#_=!1;#v=null;#g=-1;#p=new Map;#k=!1;#l=!1;#x=null;#c=[];constructor(t,e){this.#e=t,this.#t=e,this.#n=Math.max(1,Math.min(un,e.maxPendingInvalidations??un))}async start(){if(!(this.#o||this.#l)){this.#l=!0;try{await this.#C(!1)}catch(t){this.#O(t),this.#h("reconnect")}}}notifyReconnect(){this.requestResync("reconnect")}requestResync(t="server_request"){this.#h(t)}dispose(){this.#o||(this.#o=!0,this.#d!==null&&window.clearTimeout(this.#d),this.#d=null,this.#u=!1,this.#s?.(),this.#s=null,this.#p.clear(),this.#c=[])}#S(t){if(this.#o)return;let e=L(t),n=L(e?.event)??e,r=n?.type;if(r==="resync"){let a=yn(n?.reason);if(!a){this.#h("invalid_message");return}if(a==="entry_removed"){this.#t.onEvent({type:"resync",reason:a}),this.dispose();return}this.#h(a);return}let o=r==="snapshot"?pn(n?.snapshot??n,this.#t.entryId):r==="invalidate"?tr(n?.invalidation??n):null;if(!o){this.#h("invalid_message");return}if(r==="snapshot"){let a=o;if(this.#u)return;if(this.#v!==null&&a.epoch!==this.#v){this.#h("restart");return}this.#P(a);return}this.#a(o)}#P(t){this.#v===t.epoch&&t.sequence<this.#g||(this.#v=t.epoch,this.#g=t.sequence,this.#p.clear(),this.#t.onEvent({type:"snapshot",snapshot:t}))}#T(t){let e=this.#c;if(this.#c=[],this.#P(t),this.#o)return;let n=t.sequence+1;for(let r of e)if(r.epoch===t.epoch&&!(r.sequence<=t.sequence)&&!(r.sequence<n)){if(r.sequence!==n){this.#c=e.filter(o=>o.epoch===t.epoch&&o.sequence>=n),this.#h("gap");return}this.#a(r),n+=1}}#a(t){if(this.#u){this.#R(t);return}if(this.#v===null){this.#R(t);return}if(this.#v!==t.epoch){this.#R(t),this.#h("reconnect");return}if(!(t.sequence<=this.#g)){if(t.sequence!==this.#g+1){this.#R(t),this.#h("gap");return}this.#g=t.sequence;for(let e of t.resources)this.#p.set(e,t);if(this.#p.size>this.#n){this.#p.clear(),this.#h("overflow");return}this.#k||(this.#k=!0,queueMicrotask(()=>this.#b()))}}#R(t){this.#c.length>=this.#n?(this.#c=[],this.#_=!0,this.#h("overflow")):this.#c.push(t)}#b(){if(this.#k=!1,this.#o||this.#p.size===0)return;let t=[...this.#p.values()];this.#p.clear();let e=t.reduce((r,o)=>!r||o.sequence>r.sequence?o:r,null);if(!e)return;let n=[...new Set(t.flatMap(r=>r.resources))];this.#t.onEvent({type:"invalidation",invalidation:{...e,resources:n}})}#h(t){this.#o||this.#r||(this.#r=!0,this.#t.onEvent({type:"resync",reason:t}),queueMicrotask(()=>{this.#r=!1}),t!=="authorization"&&t!=="entry_removed"&&this.#m(0))}#m(t){if(!(this.#o||this.#d!==null)){if(this.#u){this.#f=t;return}this.#d=window.setTimeout(()=>{this.#d=null,this.#C(!0)},t)}}async#C(t){if(!(this.#o||this.#u)){this.#u=!0;try{if(t&&await this.#M(),this.#o)return;let e=await this.#e.sendMessagePromise({type:"matic_robot/workspace_snapshot",version:it,entry_id:this.#t.entryId});if(this.#o)return;let n=pn(e,this.#t.entryId);if(!n)throw new Error("invalid-workspace-snapshot");if(n.status.reason==="authorization"){this.#t.onEvent({type:"snapshot",snapshot:n}),this.#i=0,this.#c=[];return}if(n.status.state!=="ready"&&n.status.retryable)throw new Error("workspace-snapshot-retryable");this.#u=!1,t?this.#E(n):this.#T(n),!t&&!this.#o&&await this.#M(),this.#i=0,this.#_&&(this.#_=!1,this.#h("overflow"))}catch(e){if(this.#o)return;if(this.#O(e),this.#L(e))this.#t.onEvent({type:"resync",reason:"authorization"}),this.#c=[],this.#i=0;else if(this.#i<Gn){let n=Math.min(Jn*2**this.#i,Qn);this.#i+=1,this.#m(n)}}finally{this.#u=!1;let e=this.#f;this.#f=null,e!==null&&this.#m(e)}}}async#M(){if(this.#o||this.#s)return;if(this.#x)return this.#x;let t=(async()=>{let e=await this.#e.subscribeMessage(n=>this.#S(n),{type:"matic_robot/workspace_subscribe",version:it,entry_id:this.#t.entryId});this.#o?e():this.#s=e})();this.#x=t;try{await t}finally{this.#x===t&&(this.#x=null)}}#E(t){let e=this.#c;if(this.#c=[],this.#v===t.epoch&&t.sequence<this.#g){this.#c=e,this.#h("snapshot_required");return}if(this.#P(t),this.#o)return;let n=t.sequence+1;for(let r of e)if(r.epoch===t.epoch&&!(r.sequence<=t.sequence)&&!(r.sequence<n)){if(r.sequence!==n){this.#c=e.filter(o=>o.sequence>=n),this.#h("gap");return}this.#a(r),n+=1}}#L(t){let e=L(t),n=e?.code,r=e?.status??e?.statusCode;return n==="unauthorized"||n==="not_authorized"||n==="auth_invalid"||r===401||r===403}#O(t){this.#t.onError?.(t instanceof Error?t:new Error("Workspace transport failed"))}};var rr=!1,f=(s,t,e=null)=>({status:s,value:t,problem:e}),$=s=>s instanceof DOMException&&s.name==="AbortError",W=(s,t)=>s instanceof C||s&&typeof s=="object"&&"code"in s&&typeof s.code=="string"?s.code:t,ue=s=>[s.selectedFloorOrdinal??"none",s.mapFloorOrdinal??"none",s.mapFloorCoherent?"coherent":"transition"].join(":"),he=s=>[s.mapFloorOrdinal??"none",s.mapSessionVerified?"verified":"unverified",s.mapSessionKey??"no-session"].join(":"),q=s=>[s.entryId,s.selectedFloorOrdinal??"none",s.mapFloorOrdinal??"none"].join("|"),B=s=>[s.entryId,ue(s),he(s),s.mapRevision].join("|"),lt=s=>s.runnerLocked||s.stopSettlePending||s.activePlan||s.nativeReconciliationPending||s.nativeSessionActive===!0,Te=(s,t)=>s.entryKey===t.entryKey&&s.generation===t.generation&&s.floorKey===t.floorKey&&s.missionKey===t.missionKey,te="Live map updates paused while the current map is rechecked.",gn="Saved map from ",ct="Reconnecting. The last verified map remains read only.",or=1e3,sr=["rooms","plans","plan","draw","areaReview"],bn=s=>JSON.stringify({...s,previewToken:void 0}),Le=(s,t)=>s.label?s.label:s.active?"Current floor":`Saved floor ${s.ordinal??t}`,Oe=class{#e;#t=new bt;#n;#s=new Ie;#o=new Map;#r=null;#u;#d=null;#f=null;#i=null;#_=0;#v=!1;#g=!1;#p=!1;#k=!1;#l=Promise.resolve();#x=!1;#c=!1;#S="";#P=0;#T="";#a=!1;#R=!0;#b=null;#h=null;#m=null;#C=null;#M="";#E=!1;#L;#O;constructor(t,e,n=null,r=rr){this.#e=t,this.#n=e,this.#L=n,this.#O=r,this.#C=t.subscribe(()=>this.#U())}#N(t){let e=yt(t),n=t.resources.entry,r=this.#r?.vacuumEntityId;if(!e||!n||!r||!t.selection.entryId||t.workflow!=="rooms"||t.dataMode!=="live"||t.floor.readOnly||t.coherence!=="current"||!t.host.connected||!t.host.administrator||!t.host.robotConnected||t.command!=="idle"||t.resources.plans.status!=="ready")return null;let o=t.selection.roomIds.map(a=>{let i=t.selection.roomSettings.find(l=>l.roomId===a);return i?{room:a,cleaning_mode:i.cleaningMode,coverage_setting:i.coverageSetting}:null});return o.some(a=>a===null)?null:{key:e,generation:t.generation,retryRevision:t.manualRoomPreviewRetry,floorKey:ue(n),missionKey:he(n),entryId:t.selection.entryId,entityId:r,rooms:o,overrideRoomSchedule:!t.selection.useRoomSchedule}}#W(t){return JSON.stringify([t.key,t.generation,t.retryRevision,t.floorKey,t.missionKey,t.entryId,t.entityId])}#D(t){let e=this.#N(this.#e.value);return!this.#a&&e!==null&&this.#W(e)===this.#W(t)}#U(){if(this.#a||!this.#r)return;let t=this.#e.value,e=this.#N(t);if(!e){this.#o.get("room-preview")?.abort(),this.#o.delete("room-preview"),this.#M="",(t.manualRoomPreview.status!=="idle"||t.manualRoomPreview.value!==null)&&this.#e.patch({manualRoomPreview:f("idle",null)});return}let n=this.#W(e),r=Ve(t);if(r&&r.key===e.key&&r.generation===e.generation&&r.floorKey===e.floorKey&&r.missionKey===e.missionKey&&r.preview.entryId===e.entryId){this.#M=n;return}if(this.#M===n)return;this.#o.get("room-preview")?.abort(),this.#M=n;let o=this.#y("room-preview");this.#e.patch({manualRoomPreview:f("loading",null)}),this.#ne(e,o)}async#ne(t,e){try{let n=await this.#n.previewRoomSequence(t.entityId,t.rooms,t.overrideRoomSchedule,e.signal);return!this.#D(t)||e.signal.aborted||n.entryId!==t.entryId?null:(this.#e.patch({manualRoomPreview:f("ready",{key:t.key,generation:t.generation,floorKey:t.floorKey,missionKey:t.missionKey,preview:n})}),n)}catch(n){return $(n)||e.signal.aborted||!this.#D(t)||this.#e.patch({manualRoomPreview:f("error",null,W(n,"preview-unavailable"))}),null}finally{this.#w("room-preview",e)}}sync(t,e){if(this.#a)return;let n=this.#e.value.owner;n&&(n.entryKey!==t.entryKey||n.userKey!==t.userKey)&&(this.#q("context-changed"),this.#v&&(this.#p=!0,this.#k=!1));let r=this.#R;if(this.#R=t.host.connected,this.#r=t,this.#u=e,this.#re(t),this.#e.patch({owner:{userKey:t.userKey,entryKey:t.entryKey},host:t.host,activity:t.activity,batteryPercent:t.batteryPercent,robotLabel:t.robotLabel,robots:t.robots,locale:t.language}),t.userKey!==this.#T){this.#T=t.userKey;let o=this.#s.load(t.userKey);this.#e.patch({view:o.view,appearance:o.appearance,labelsVisible:o.labels,quality:o.quality,cameras:o.cameras})}if(!t.host.administrator){this.#H(),this.#q("access-required");return}if(!t.host.connected){this.#H(),this.#p=!1,this.#k=!1,this.#c=!1,this.#I();let o=this.#e.value,a=o.resources.scene.value;this.#e.patch({coherence:a?"degraded":"unavailable",resources:{...o.resources,catalog:o.resources.catalog.status==="loading"?f("idle",o.resources.catalog.value):o.resources.catalog,plans:o.resources.plans.status==="loading"?f("idle",o.resources.plans.value):o.resources.plans,areas:o.resources.areas.status==="loading"?f("idle",o.resources.areas.value):o.resources.areas,pose:f("idle",null)},map:{...o.map,available:a!==null,exactPose:!1},notice:a?{tone:"warning",text:ct}:o.notice});return}if(t.host.robotCount===0){this.#H(),this.#q("map-unavailable");return}if(this.#Q(),!r){this.#e.value.notice?.text===ct&&this.#e.patch({notice:null}),this.refreshCatalog(!0);return}(this.#e.value.resources.catalog.status==="idle"||t.entryKey&&t.entryKey!==this.#e.value.selection.entryId)&&this.refreshCatalog(!0)}#re(t){let e=t.entryKey;if(!this.#O||!this.#L||!t.host.administrator||!t.host.connected||!e){this.#b?.dispose(),this.#b=null,this.#h=null,this.#m=null;return}if(this.#b&&this.#h===e)return;this.#b?.dispose(),this.#m=null;let n=new $e(this.#L,{entryId:e,onEvent:r=>{if(!(this.#a||this.#b!==n||this.#h!==e||this.#r?.entryKey!==e)){if(r.type==="resync"&&r.reason==="entry_removed"){n.dispose(),this.#b===n&&(this.#b=null,this.#h=null,this.#m=null);return}if(r.type==="snapshot"){let{snapshot:o}=r,a=this.#e.value.resources.entry,i=o.payload.entry;if(o.entry_id!==e||o.identity.entry_id!==e)return;if(i&&(i.entryId!==e||o.identity.floor_verified!==(i.mapFloorCoherent&&i.mapSessionVerified))){n.requestResync("invalid_message");return}if(!i&&a?.entryId===e&&o.identity.floor_verified!==(a.mapFloorCoherent&&a.mapSessionVerified))return;if(o.status.reason==="authorization"){this.#m=null;return}let l=this.#m,d=[],c=l!==null&&l.epoch!==o.epoch;if(l&&l.epoch===o.epoch){let g=new Set([...Object.keys(l.revisions),...Object.keys(o.revisions)]),v=[...g].some(w=>(o.revisions[w]??-1)<(l.revisions[w]??-1));if(o.coherence_generation<l.coherenceGeneration||o.coherence_generation===l.coherenceGeneration&&v){n.requestResync("restart");return}d=[...g].filter(w=>(o.revisions[w]??-1)>(l.revisions[w]??-1))}c&&(d=["plans","areas","history"]);let u=l!==null&&(l.epoch!==o.epoch||l.coherenceGeneration!==o.coherence_generation),p=!!(a&&i&&a.entryId===e&&B(a)!==B(i));if(this.#m={entryId:o.entry_id,epoch:o.epoch,sequence:o.sequence,coherenceGeneration:o.coherence_generation,revisions:o.revisions},u||p){this.#Y(e,d);return}let h=i!==null&&a?.entryId===e&&this.#j(i);if(l&&d.length){if(o.sequence<=l.sequence){n.requestResync("invalid_message");return}this.#m=l,this.#V({epoch:o.epoch,sequence:o.sequence,coherence_generation:o.coherence_generation,revisions:o.revisions,resources:d},e,n,h)}return}if(r.type==="resync"){this.#m=null,r.reason!=="authorization"&&this.#Y(e,["plans","areas","history"]);return}this.#V(r.invalidation,e,n)}},onError:()=>this.#e.patch({notice:{tone:"warning",text:ct}})});this.#b=n,this.#h=e,n.start()}#V(t,e,n,r=!1){let o=this.#m;if(!o||o.entryId!==e||this.#b!==n||t.epoch!==o.epoch||t.sequence<=o.sequence)return;let a=t.coherence_generation!==o.coherenceGeneration,l=[...new Set([...Object.keys(o.revisions),...Object.keys(t.revisions)])].some(h=>(t.revisions[h]??-1)<(o.revisions[h]??-1));if(t.coherence_generation<o.coherenceGeneration||!a&&l){n.requestResync("restart");return}let d=new Set(t.resources),c=[...d].some(h=>(t.revisions[h]??-1)>(o.revisions[h]??-1));if(this.#m={...o,sequence:t.sequence,coherenceGeneration:t.coherence_generation,revisions:t.revisions},!c&&!a)return;if(a||d.has("scene")){this.#Y(e,t.resources);return}let u=this.#e.value.resources.entry,p=this.#t.current();!u||u.entryId!==e||!p||this.#J(u,p,d,!r)}#j(t){let e=this.#e.value,n=e.resources.entry;if(!n||B(n)!==B(t))return!1;let r=e.resources.catalog,o=r.value?.map(l=>l.entryId===t.entryId?t:l),a=t.mapFloorCoherent&&t.mapSessionVerified,i=t.health==="problem"||t.health==="limited";return this.#e.patch({managedLock:lt(t),coherence:a?i?"degraded":"current":"verifying",map:{...e.map,available:e.resources.scene.value!==null,complete:t.mapComplete&&!t.mapTruncated,floorCoherent:t.mapFloorCoherent,sessionVerified:t.mapSessionVerified,exactPose:a?e.map.exactPose:!1},floor:{...e.floor,classifiedCount:Math.max(1,t.historyFloorCount)},resources:{...e.resources,entry:t,...o?{catalog:{...r,value:o}}:{}}}),!0}#oe(){let t=this.#t.invalidate(),e=this.#e.value;this.#e.patch({generation:t,coherence:e.resources.scene.value?"verifying":"unavailable",map:{...e.map,exactPose:!1}}),this.#I(["catalog"]),this.#S=""}#Y(t,e=[]){this.#oe(),this.refreshCatalog(!0,!0).then(()=>{if(this.#a||this.#r?.entryKey!==t||!this.#r.host.administrator||!this.#r.host.connected)return;let n=this.#e.value.resources.entry,r=this.#t.current();if(!n||n.entryId!==t||!r)return;let o=new Set(e);o.delete("history"),this.#J(n,r,o,!1)})}#J(t,e,n,r=!0){(n.has("plans")||n.has("plan_state"))&&this.loadPlans(),n.has("areas")&&this.loadAreas(),n.has("history")&&this.#F(t,e),r&&["status","robot_state","activity","plan_state"].some(o=>n.has(o))&&this.refreshCatalog(!0,!0,!0)}schedulePreferences(t){this.#s.schedule(t)}#Q(){this.#d===null&&(this.#d=window.setInterval(()=>{document.visibilityState==="visible"&&this.refreshCatalog()},5e3)),this.#f===null&&(this.#f=window.setInterval(()=>{document.visibilityState==="visible"&&this.refreshPose()},or))}#H(){this.#d!==null&&window.clearInterval(this.#d),this.#f!==null&&window.clearInterval(this.#f),this.#d=null,this.#f=null}#y(t){this.#o.get(t)?.abort();let e=new AbortController;return this.#o.set(t,e),e}#w(t,e){this.#o.get(t)===e&&this.#o.delete(t)}#I(t=[]){let e=!1;for(let[n,r]of this.#o)t.includes(n)||(e||=n==="plan-mutation"||n==="area-mutation",r.abort(),this.#o.delete(n));e&&this.#e.value.command==="pending"&&this.#e.patch({command:"idle",notice:null})}#$(){this.#_+=1,this.#i!==null&&window.clearTimeout(this.#i),this.#i=null}#q(t){this.#$(),this.#I(),this.#t.invalidate(),this.#S="";let e=this.#e.value,n=O();this.#e.patch({command:"idle",dataMode:n.dataMode,floor:n.floor,managedLock:!1,workflow:"none",dialog:null,notice:null,draftFloorOrdinal:null,draw:n.draw,planDraft:n.planDraft,areaDraft:n.areaDraft,generation:this.#t.generation,coherence:e.host.administrator?"unavailable":"blocked",fullMap:!1,precisionOpen:!1,resources:{catalog:f("error",null,t),entry:null,scene:f("idle",null),pose:f("idle",null),history:f("idle",null),plans:f("idle",null),areas:f("idle",null)},manualRoomPreview:f("idle",null),map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1},selection:{...n.selection,entryId:null,floorId:"current",historyId:null}})}async refreshCatalog(t=!1,e=!1,n=!1){if(this.#a||!this.#r?.host.administrator||!this.#r.host.connected||this.#r.host.robotCount===0)return;if(this.#v)return t&&(this.#g?e&&(this.#p?this.#k&&=n:this.#k=n,this.#p=!0):(this.#p?this.#k&&=n:this.#k=n,this.#p=!0,this.#o.get("catalog")?.abort())),this.#l;this.#v=!0,this.#g=t;let r;this.#l=new Promise(i=>{r=i});let o=this.#y("catalog"),a=this.#e.value.resources.catalog.value;this.#e.patch({resources:{...this.#e.value.resources,catalog:f("loading",a)}});try{let i=await this.#n.catalog(o.signal);if(o.signal.aborted||this.#a)return;let l=this.#u?.config?.entry_id,d=typeof l=="string"?l:null,c=i.find(h=>h.entryId===this.#r?.entryKey)||i.find(h=>h.entryId===d)||i[0]||null,u=this.#e.value.resources.entry;if(c&&u&&q(c)===q(u)&&ue(c)===ue(u)&&he(c)===he(u)&&(c.mapRevision<u.mapRevision||!t&&this.#o.has("scene"))&&(c={...c,mapRevision:u.mapRevision}),this.#e.patch({managedLock:c?lt(c):!1,resources:{...this.#e.value.resources,catalog:f(i.length?"ready":"empty",i),entry:c}}),!c){this.#q("no-loaded-robot");return}if(this.#e.value.selection.floorId!=="current"&&!t)return;let p=B(c);if((!t||n)&&p===this.#S){let h=this.#e.value,g=c.mapFloorCoherent&&c.mapSessionVerified,v=c.health==="problem"||c.health==="limited";this.#e.patch({coherence:g?v?"degraded":"current":"verifying",map:{...h.map,available:h.resources.scene.value!==null,complete:c.mapComplete&&!c.mapTruncated,floorCoherent:c.mapFloorCoherent,sessionVerified:c.mapSessionVerified,exactPose:g?h.map.exactPose:!1},floor:{...h.floor,classifiedCount:Math.max(1,c.historyFloorCount)}}),g&&this.#e.value.resources.plans.problem==="map-rechecking"&&this.loadPlans(),this.#B();let w=this.#t.current();w&&!h.resources.scene.value&&!this.#o.has("history")&&this.#F(c,w),g&&w&&(h.resources.scene.status==="error"||h.floor.readOnly)&&!this.#o.has("scene")&&this.#A(c,w);return}this.#S=p,this.#Z(c,u)}catch(i){if($(i))return;this.#e.patch({coherence:this.#e.value.resources.scene.value?"degraded":"unavailable",resources:{...this.#e.value.resources,catalog:f("error",a,W(i,"catalog-unavailable"))}})}finally{this.#w("catalog",o),this.#v=!1;let i=this.#p,l=this.#k;this.#g=!1;try{i&&!this.#a&&(this.#p=!1,this.#k=!1,await this.refreshCatalog(!0,!1,l))}finally{r()}}}#Z(t,e){let n=this.#e.value,r=!!(e&&q(e)===q(t)),o=t.mapFloorCoherent&&t.mapSessionVerified;this.#I(r?["catalog","plans","areas","plan-mutation","area-mutation"]:["catalog"]);let a=e?.entryId===t.entryId?n.resources.scene.value:null,i=a!==null&&(n.floor.readOnly||!r||!o||e?.mapSessionKey!==t.mapSessionKey),l=n.resources.pose.value,d=r&&o&&t.mapSessionKey!==null&&l?.position&&l.mapSessionKey===t.mapSessionKey?l:null,c=this.#t.begin(t.entryId,ue(t),he(t),t.mapRevision),u=n.draftFloorOrdinal??(e?.mapFloorCoherent&&e.mapSessionVerified?e.mapFloorOrdinal:null),p=n.draftMapSessionKey??(e?.mapFloorCoherent&&e.mapSessionVerified?e.mapSessionKey:null),h=o?t.mapFloorOrdinal:null,g=o?t.mapSessionKey:null,v=e!==null&&e.entryId!==t.entryId||u!==null&&h!==null&&u!==h||p!==null&&g!==null&&p!==g;v&&this.#$();let w=O(),S=t.health==="problem"||t.health==="limited",_=this.#e.value;this.#e.patch({...v?{command:"idle",workflow:"none",dialog:null,precisionOpen:!1,fullMap:!1,draw:w.draw,planDraft:w.planDraft,areaDraft:w.areaDraft,notice:{tone:"info",text:"The active map changed. Choose a task on this map."}}:{},draftFloorOrdinal:h??u,draftMapSessionKey:g??p,managedLock:lt(t),generation:c.generation,coherence:o?S?"degraded":"current":"verifying",dataMode:"live",...!o&&a?{notice:{tone:"warning",text:te}}:{},resources:{..._.resources,entry:t,scene:f(o?"loading":"idle",a),pose:f(o?"loading":"idle",d),history:f("loading",_.resources.history.value),plans:r?_.resources.plans:f("idle",null),areas:r?_.resources.areas:f("idle",null)},map:{available:a!==null,complete:t.mapComplete&&!t.mapTruncated,floorCoherent:t.mapFloorCoherent,sessionVerified:t.mapSessionVerified,exactPose:o&&d!==null&&!i},floor:{classifiedCount:Math.max(1,t.historyFloorCount),displayName:i?n.floor.displayName:t.selectedFloorOrdinal?`Floor ${t.selectedFloorOrdinal}`:"Current floor",readOnly:i},selection:{..._.selection,entryId:t.entryId,floorId:"current",historyId:null,roomIds:v?[]:_.selection.roomIds,roomSettings:v?[]:_.selection.roomSettings,planId:v?null:_.selection.planId,areaId:v?null:_.selection.areaId}}),this.#F(t,c),o&&this.#e.value.resources.plans.status==="idle"&&this.loadPlans(),this.#B(),o&&(this.#A(t,c),this.#K(t,c))}async#A(t,e){let n=this.#y("scene");try{let r=await this.#n.scene(t.sceneUrl,t.mapRevision,t.mapFloorCoherent,"live",n.signal);if(!this.#t.accepts(e))return;if(!r.floorCoherent){let d=this.#e.value;this.#e.patch({coherence:"verifying",resources:{...d.resources,scene:f("error",d.resources.scene.value,"map-rechecking"),pose:f("idle",null)},map:{...d.map,available:d.resources.scene.value!==null,floorCoherent:!1,exactPose:!1},floor:{...d.floor,readOnly:d.resources.scene.value!==null},notice:{tone:"warning",text:te}});return}if(r.revision<e.revision||!r.scene)throw new C("scene-unavailable");let o=r.revision===e.revision?e:this.#t.advance(e,r.revision);if(!o)throw new C("scene-unavailable");let a=this.#e.value,i={...a.resources.entry??t,mapRevision:r.revision};this.#S=B(i),this.#e.patch({resources:{...a.resources,entry:i,scene:f("ready",r.scene)},map:{...a.map,available:!0},floor:{...a.floor,readOnly:!1,displayName:a.resources.history.value?.floors.find(d=>d.active)?.label||(i.selectedFloorOrdinal?`Floor ${i.selectedFloorOrdinal}`:"Current floor")},notice:a.notice?.text===te||a.notice?.text.startsWith(gn)?null:a.notice});let l=this.#e.value.resources.plans;if((l.status==="idle"||l.problem==="map-rechecking")&&this.loadPlans(),this.#B(),t.deltaUrl){let d=++this.#P;this.#X(i,o,r.scene,d)}}catch(r){if($(r)||!this.#t.accepts(e))return;if(r instanceof C&&r.code==="request-timeout"){let l=this.#e.value;this.#e.patch({resources:{...l.resources,scene:f("loading",l.resources.scene.value,"scene-building")}}),window.setTimeout(()=>{this.#a||!this.#t.accepts(e)||this.#e.value.selection.floorId!=="current"||this.#A(t,e)},250);return}let o=this.#e.value,a=o.resources.pose.value,i=o.resources.scene.value!==null&&t.mapSessionKey!==null&&a?.position!==null&&a?.mapSessionKey===t.mapSessionKey;this.#e.patch({coherence:"degraded",resources:{...o.resources,scene:f("error",o.resources.scene.value,W(r,"scene-unavailable"))},map:{...o.map,available:o.resources.scene.value!==null,exactPose:i}})}finally{this.#w("scene",n)}}async#X(t,e,n,r){if(!t.deltaUrl||typeof DecompressionStream!="function")return;let o=t.deltaUrl,a=t,i=e,l=n;try{for(;!this.#a&&r===this.#P&&this.#t.accepts(i)&&this.#e.value.selection.floorId==="current";){let d=this.#y("delta");try{let c=await this.#n.sceneDelta(o,l,a.mapFloorCoherent,d.signal);if(d.signal.aborted||this.#a||r!==this.#P||!this.#t.accepts(i))return;if(!c.floorCoherent){let h=this.#e.value;this.#e.patch({coherence:"verifying",map:{...h.map,available:h.resources.scene.value!==null,floorCoherent:!1,exactPose:!1},floor:{...h.floor,readOnly:h.resources.scene.value!==null},resources:{...h.resources,scene:f("error",h.resources.scene.value,"map-rechecking"),pose:f("idle",null)},notice:{tone:"warning",text:te}}),this.#S="",this.refreshCatalog(!0);return}if(c.notModified||!c.scene){await new Promise(h=>window.setTimeout(h,100));continue}let u=this.#t.advance(i,c.revision);if(!u)return;i=u,l=c.scene,a={...a,mapRevision:c.revision},this.#S=B(a);let p=this.#e.value;this.#e.patch({resources:{...p.resources,entry:a,scene:f("ready",l)},map:{...p.map,available:!0,floorCoherent:!0}}),this.#K(a,i)}finally{this.#w("delta",d)}}}catch(d){if($(d)||this.#a||r!==this.#P||!this.#t.accepts(i))return;this.#e.patch({coherence:"degraded",notice:{tone:"warning",text:te}}),this.#S="",this.refreshCatalog(!0)}}async#F(t,e){let n=this.#y("history");try{let r=await this.#n.history(t.historyUrl,n.signal),o=this.#t.current();if(n.signal.aborted||!o||!Te(e,o)||r.entryId!==t.entryId)return;let a=this.#e.value,i=r.floors.find(c=>c.id===a.selection.floorId),l=!a.selection.historyId||i?.snapshots.some(c=>c.id===a.selection.historyId),d=a.dataMode==="live"?r.floors.find(c=>c.active):i;if(this.#e.patch({resources:{...this.#e.value.resources,history:f("ready",r)},floor:{...this.#e.value.floor,classifiedCount:r.floors.length,...d&&!(a.dataMode==="live"&&a.floor.readOnly)?{displayName:Le(d,1)}:{}}}),a.dataMode==="live"&&!a.resources.scene.value){let c=r.floors.flatMap(u=>u.snapshots.map(p=>({floor:u,snapshot:p}))).sort((u,p)=>Date.parse(p.snapshot.createdAt)-Date.parse(u.snapshot.createdAt));for(let u of c){let p;try{p=await this.#n.scene(u.snapshot.sceneUrl,u.snapshot.revision,!0,"history",n.signal)}catch(v){if($(v)||n.signal.aborted)return;continue}let h=this.#t.current();if(n.signal.aborted||!h||!Te(e,h)||this.#e.value.resources.scene.value)return;if(!p.scene)continue;let g=this.#e.value;this.#e.patch({floor:{...g.floor,readOnly:!0,displayName:Le(u.floor,1)},resources:{...g.resources,scene:f("ready",p.scene),pose:f("idle",null)},map:{...g.map,available:!0,exactPose:!1},notice:{tone:"warning",text:`${gn}${new Date(u.snapshot.createdAt).toLocaleString()}. Live position is unavailable.`}});break}}if(a.dataMode==="history"&&(!i||!l)){let c=i||r.floors.find(p=>p.active)||r.floors[0],u=this.selectFloor(c?.id||"current");!this.#a&&a.workflow==="history"&&this.#e.dispatch({type:"open-workflow",workflow:"history"}),await u}}catch(r){let o=this.#t.current();if($(r)||n.signal.aborted||!o||!Te(e,o))return;this.#e.patch({resources:{...this.#e.value.resources,history:f("error",null,W(r,"history-unavailable"))}})}finally{this.#w("history",n)}}async refreshPose(){let t=this.#e.value.resources.entry,e=this.#t.current();!t||!e||this.#e.value.selection.floorId!=="current"||!t.mapFloorCoherent||!t.mapSessionVerified||await this.#K(t,e)}async#K(t,e){if(this.#a||!this.#R||!this.#r?.host.connected)return;if(this.#x){this.#c=!0;return}this.#x=!0;let n=this.#y("pose");try{let r=await this.#n.pose(t.poseUrl,n.signal),o=this.#t.current(),a=this.#e.value.resources.entry;if(!o||!Te(e,o)||!a||!this.#e.value.map.floorCoherent||!r.floorCoherent)return;if(r.mapSessionKey===null||r.mapSessionKey!==a.mapSessionKey){this.#e.patch({resources:{...this.#e.value.resources,pose:f("idle",null)},map:{...this.#e.value.map,exactPose:!1}}),this.#S="",this.refreshCatalog(!0);return}let i=this.#e.value,l=i.resources.pose.value,d=!!(i.map.exactPose&&l?.position&&l.mapSessionKey===a.mapSessionKey);if(r.position===null&&d){this.#e.patch({resources:{...i.resources,pose:f("ready",l)}});return}this.#e.patch({resources:{...i.resources,pose:f("ready",r)},map:{...i.map,exactPose:r.position!==null}})}catch(r){if($(r)||!this.#t.accepts(e))return;let o=this.#e.value,a=o.resources.pose.value,i=!!(o.map.exactPose&&a?.position&&a.mapSessionKey===o.resources.entry?.mapSessionKey);this.#e.patch({resources:{...o.resources,pose:f("error",i?a:null,W(r,"pose-unavailable"))},map:{...o.map,exactPose:i}})}finally{if(this.#w("pose",n),this.#x=!1,this.#c&&!this.#a&&this.#R&&this.#r?.host.connected&&this.#r.host.administrator&&this.#r.host.robotCount>0){this.#c=!1;let r=this.#e.value.resources.entry,o=this.#t.current();r&&o&&this.#K(r,o)}else this.#c=!1}}async selectFloor(t){let e=this.#e.value.resources.history.value,n=this.#e.value.resources.entry;if(!e||!n)return;let r=e.floors.find(l=>l.id===t);if(!r&&t!=="current")return;let o=this.#e.value;if(o.workflow==="draw"&&(o.draw.dirty||o.areaDraft.dirty)||o.workflow==="areaReview"&&(o.draw.dirty||o.areaDraft.dirty))return;if(!r||r.active){this.#S="";let l=this.#e.value;this.#e.patch({resources:{...l.resources,plans:f("idle",null),areas:f("idle",null),scene:f("idle",l.resources.scene.value),pose:f("idle",null)},map:{...l.map,available:l.resources.scene.value!==null,exactPose:!1},coherence:"verifying",floor:{...l.floor,readOnly:l.resources.scene.value!==null},notice:l.resources.scene.value?{tone:"warning",text:te}:l.notice,workflow:"none",precisionOpen:!1}),this.#e.dispatch({type:"set-floor",floorId:"current"}),await this.refreshCatalog(!0);return}let a=r.snapshots.at(-1);this.#I(["catalog"]);let i=this.#t.begin(n.entryId,r.id,a?.id||r.id,a?.revision||0);this.#e.patch({generation:i.generation,coherence:"current",dataMode:"history",floor:{classifiedCount:e.floors.length,displayName:Le(r,e.floors.indexOf(r)+1),readOnly:!0},selection:{...this.#e.value.selection,floorId:r.id,historyId:a?.id||null},resources:{...this.#e.value.resources,scene:f(a?"loading":"empty",null),pose:f("idle",null),plans:f("idle",null),areas:f("idle",null)},workflow:"none",precisionOpen:!1,map:{available:!1,complete:!0,floorCoherent:!0,sessionVerified:!0,exactPose:!1}}),a&&await this.#ee(a,i)}async selectHistory(t){let e=this.#e.value.resources.history.value,n=this.#e.value.resources.entry;if(!e||!n)return;if(!t){await this.selectFloor("current");return}let r=e.floors.find(i=>i.snapshots.some(l=>l.id===t)),o=r?.snapshots.find(i=>i.id===t);if(!r||!o)return;let a=this.#t.begin(n.entryId,r.id,o.id,o.revision);this.#I(["catalog"]),this.#e.patch({generation:a.generation,dataMode:"history",floor:{classifiedCount:e.floors.length,displayName:Le(r,e.floors.indexOf(r)+1),readOnly:!0},selection:{...this.#e.value.selection,floorId:r.id,historyId:o.id},resources:{...this.#e.value.resources,scene:f("loading",null),pose:f("idle",null)},map:{...this.#e.value.map,available:!1,exactPose:!1}}),await this.#ee(o,a)}async#ee(t,e){let n=this.#y("history-scene");try{let r=await this.#n.scene(t.sceneUrl,t.revision,!0,"history",n.signal);if(!this.#t.accepts(e)||!r.scene)return;this.#e.patch({resources:{...this.#e.value.resources,scene:f("ready",r.scene)},map:{...this.#e.value.map,available:!0,exactPose:!1}})}catch(r){if($(r)||!this.#t.accepts(e))return;this.#e.patch({resources:{...this.#e.value.resources,scene:f("error",null,W(r,"history-scene-unavailable"))}})}finally{this.#w("history-scene",n)}}async openWorkflow(t){let e=this.#e.value;if((e.dataMode==="history"||e.floor.readOnly)&&sr.includes(t))return;let n=this.#e.value.workflow;if(t==="draw"&&n!=="draw"&&n!=="areaReview"&&this.selectArea(null),this.#e.dispatch({type:"open-workflow",workflow:t}),t==="history"){let r=this.#e.value.resources.entry,o=this.#t.current();r&&o&&(this.#e.patch({resources:{...this.#e.value.resources,history:f("loading",this.#e.value.resources.history.value)}}),await this.#F(r,o))}(t==="plans"||t==="plan"||t==="rooms")&&await this.loadPlans(),(t==="draw"||t==="areaReview")&&await this.loadAreas()}async loadPlans(){let t=this.#e.value.resources.entry;if(!t||!this.#t.current()||!Ye(this.#e.value)||this.#e.value.resources.plans.status==="loading")return;let e=q(t),n=this.#y("plans");this.#e.patch({resources:{...this.#e.value.resources,plans:f("loading",null)}});try{let r=await this.#n.plans(t.plansUrl,n.signal),o=this.#e.value.resources.entry;if(n.signal.aborted||this.#a||!o||q(o)!==e)return;if(this.#e.value.planDraft.dirty||this.#e.value.workflow==="plan"){this.#e.patch({resources:{...this.#e.value.resources,plans:f("ready",r)}});return}let a=r.selectedPlan||r.plans[0]?.id||null,i=r.plans.find(l=>l.id===a);this.#e.patch({resources:{...this.#e.value.resources,plans:f("ready",r)},selection:{...this.#e.value.selection,planId:a},planDraft:i?je(i):{...this.#e.value.planDraft,id:null,name:"",rooms:[],dirty:!1}})}catch(r){let o=this.#e.value.resources.entry;if($(r)||n.signal.aborted||this.#a||!o||q(o)!==e)return;let a=r instanceof C&&r.code==="map-rechecking"?"map-rechecking":W(r,"plans-unavailable");this.#e.patch({resources:{...this.#e.value.resources,plans:f("error",null,a)}})}finally{this.#w("plans",n)}}selectPlan(t,e=!1){let n=this.#e.value.resources.plans.value?.plans.find(r=>r.id===t);this.#e.patch({workflow:"plan",notice:!e&&this.#e.value.notice?.tone==="success"?null:this.#e.value.notice,selection:{...this.#e.value.selection,planId:t},planDraft:n?je(n):{...O().planDraft}})}#B(){let t=this.#e.value;(t.workflow==="draw"||t.workflow==="areaReview")&&t.resources.areas.status==="idle"&&this.loadAreas()}async loadAreas({reconcileDraft:t=!0}={}){let e=this.#e.value.resources.entry;if(!e||!this.#t.current()||!Ye(this.#e.value))return;let n=q(e),r=this.#y("areas");this.#e.patch({resources:{...this.#e.value.resources,areas:f("loading",null)}});try{let o=await this.#n.areas(e.areasUrl,r.signal),a=this.#e.value.resources.entry;if(r.signal.aborted||this.#a||!a||q(a)!==n)return;if(o.sceneUrl!==a.sceneUrl)throw new C("areas-unavailable");this.#e.patch({resources:{...this.#e.value.resources,areas:f("ready",o)}});let i=this.#e.value.selection.areaId,l=this.#e.value,d=o.areas.some(c=>c.id===i);t&&(!l.draw.dirty&&!l.areaDraft.dirty||i!==null&&!d)&&this.selectArea(d?i:null)}catch(o){let a=this.#e.value.resources.entry;if($(o)||r.signal.aborted||this.#a||!a||q(a)!==n)return;this.#e.patch({resources:{...this.#e.value.resources,areas:f("error",null,W(o,"areas-unavailable"))}})}finally{this.#w("areas",r)}}selectArea(t){let e=this.#e.value.resources.areas.value?.areas.find(r=>r.id===t),n=this.#e.value;this.#e.patch({selection:{...n.selection,areaId:t},areaDraft:e?this.#se(e):{id:null,name:"",cleaningMode:"vacuum",coverageSetting:"standard",status:"new",canRebind:!1,dirty:!1},draw:{...n.draw,circles:e?.circles||[],outline:e?.outline??null,outlineUndo:[],outlineRedo:[],tool:!e||e.outline?"outline":"paint",undo:[],redo:[],dirty:!1,strokeCount:0}})}#se(t){return{id:t.id,name:t.name,cleaningMode:t.cleaningMode,coverageSetting:t.coverageSetting,status:t.status,canRebind:t.canRebind,dirty:!1}}async saveArea(){let t=this.#e.value,e=t.resources.entry,n=t.areaDraft;if(!e||t.command==="pending"||!ne(t)||!n.name.trim()||!t.draw.circles.length)return;let r=this.#y("area-mutation"),o=()=>!this.#a&&!r.signal.aborted;this.#e.patch({command:"pending",notice:{tone:"info",text:"Saving area\u2026"}});try{let a=await this.#n.saveArea(e.areasUrl,{areaId:n.id,name:n.name.trim(),circles:t.draw.circles,outline:t.draw.outline??null,cleaningMode:n.cleaningMode,coverageSetting:n.coverageSetting},r.signal);if(!o())return;let i=this.#e.value,d=i.areaDraft===n&&i.draw.circles===t.draw.circles&&i.draw.outline===t.draw.outline&&i.selection.entryId===t.selection.entryId&&(i.workflow==="draw"||i.workflow==="areaReview")?{...n,id:a,name:n.name.trim(),status:"current",canRebind:!1,dirty:!1}:null;this.#e.patch({command:"idle",notice:{tone:"success",text:"Area saved"},...d?{dialog:i.dialog==="discardDraft"?null:i.dialog,selection:{...i.selection,areaId:a},areaDraft:d,draw:{...i.draw,dirty:!1,strokeCount:0,undo:[],redo:[],outlineUndo:[],outlineRedo:[]}}:{}}),await this.loadAreas({reconcileDraft:!1});let c=this.#e.value;o()&&d&&c.areaDraft===d&&!c.draw.dirty&&(c.workflow==="draw"||c.workflow==="areaReview")&&c.selection.entryId===t.selection.entryId&&c.resources.areas.value?.areas.some(u=>u.id===a)&&this.selectArea(a)}catch(a){if($(a)||!o())return;this.#e.patch({command:"failed",notice:{tone:"error",text:"Area could not be saved"}})}finally{this.#w("area-mutation",r)}}async deleteArea(){let t=this.#e.value.resources.entry,e=this.#e.value.selection.areaId;if(!t||!e||this.#e.value.command==="pending"||!ne(this.#e.value))return;let n=this.#y("area-mutation"),r=()=>!this.#a&&!n.signal.aborted;this.#e.patch({command:"pending",notice:null});try{if(await this.#n.deleteArea(t.areasUrl,e,n.signal),!r())return;this.#e.patch({command:"idle",notice:{tone:"success",text:"Area deleted"}}),await this.loadAreas()}catch(o){!$(o)&&r()&&this.#e.patch({command:"failed",notice:{tone:"error",text:"Area could not be deleted"}})}finally{this.#w("area-mutation",n)}}async savePlan(){let t=this.#e.value,e=t.planDraft,n=t.resources.plans.value;if(!n||!e.name.trim()||!e.rooms.length||!ne(t))return;let r=e.rooms;if(await this.#G("save_plan",{...e.id?{plan_id:e.id}:{},name:e.name.trim(),enabled:e.enabled,run_behavior:e.runBehavior,rooms:r.map(a=>({room:a.roomId,cleaning_mode:a.cleaningMode,coverage_setting:a.coverageSetting,...a.cadence?{cadence:{scope:a.cadence.scope,mop_every_n:a.cadence.mopEveryN,coverage_every_n:a.cadence.coverageEveryN,periodic_coverage_setting:a.cadence.periodicCoverageSetting,do_mop_next:a.cadence.doMopNext,do_coverage_next:a.cadence.doCoverageNext}}:{}})),return_to_base:e.returnToBase,finish_current_room:e.finishCurrentRoom,finish_current_room_threshold:e.finishCurrentRoomThreshold,select:!e.id||n.selectedPlan===e.id},"Plan saved","Plan could not be saved")){let a=this.#e.value.workflow==="plan"&&this.#e.value.planDraft===e?{...e,dirty:!1}:null;if(a&&this.#e.patch({planDraft:a}),await this.loadPlans(),a&&this.#e.value.workflow==="plan"&&this.#e.value.planDraft===a&&this.#e.value.selection.entryId===t.selection.entryId){let i=this.#e.value.resources.plans.value,l=e.id||i?.selectedPlan;l&&i?.plans.some(d=>d.id===l)&&this.selectPlan(l,!0)}}}async deletePlan(){let t=this.#e.value.selection.planId,e=this.#e.value.selection.entryId;if(!t)return;if(await this.#G("delete_plan",{plan:t},"Plan deleted","Plan could not be deleted")){let r=this.#e.value;r.selection.entryId===e&&r.planDraft.id===t&&(this.#e.patch({selection:{...r.selection,planId:null},planDraft:O().planDraft}),r.workflow==="plan"&&this.#e.patch({workflow:"plans",precisionOpen:!1})),await this.loadPlans()}}async executeAction(t){switch(typeof t=="string"?t:t.id){case"recheck-status":{let n=this.#e.value.selection.entryId;await this.refreshCatalog(!0);let r=this.#e.value;!this.#a&&r.selection.entryId===n&&r.resources.catalog.status==="ready"&&r.host.connected&&r.host.robotConnected&&r.coherence==="current"&&r.command==="failed"&&this.#e.patch({command:"idle",notice:{tone:"info",text:"Status refreshed. Review the robot state before trying again."}});return}case"stop":await this.#z("matic_robot","stop_intelligent_cleaning",{include_unmanaged:!0});return;case"resume":await this.#z("vacuum","send_command",{command:"resume"});return;case"run-plan":{let n=this.#e.value,r=n.selection.planId||n.resources.plans.value?.selectedPlan;if(!r||n.workflow!=="plan"||!n.planDraft.enabled||n.resources.plans.status!=="ready"||n.command!=="idle"||!ve(n))return;let o=n.selection.entryId,a=n.generation,i=n.selection.planId,l=n.planDraft,d=n.resources.plans.value?.plans.find(h=>h.id===r)?.nextRunPreview;if(!d||!/^[0-9a-f]{64}$/u.test(d.previewToken??"")){this.#e.patch({notice:{tone:"warning",text:"A verified next-run preview is unavailable. Refresh the saved plan before starting it."}});return}this.#e.patch({command:"pending",notice:null}),await this.loadPlans();let c=this.#e.value,u=()=>{let h=this.#e.value;!this.#a&&h.selection.entryId===o&&h.generation===a&&h.command==="pending"&&this.#e.patch({command:"idle"})};if(this.#a||c.selection.entryId!==o||c.generation!==a||c.workflow!=="plan"||c.selection.planId!==i||(c.selection.planId||c.resources.plans.value?.selectedPlan)!==r||c.planDraft!==l){u();return}if(c.resources.plans.status!=="ready"){u(),this.#e.patch({notice:{tone:"warning",text:"Plan preview could not be refreshed. Check the plan and try again."}});return}let p=c.resources.plans.value?.plans.find(h=>h.id===r)?.nextRunPreview;if(!p||p.blocker||!/^[0-9a-f]{64}$/u.test(p.previewToken??"")){u(),this.#e.patch({notice:{tone:"warning",text:"This plan has no valid next-run preview. Review its rooms and schedule."}});return}if(!d||JSON.stringify(d)!==JSON.stringify(p)){u(),this.#e.patch({notice:{tone:"info",text:"The next-run preview changed. Review the updated settings before starting."}});return}u(),await this.#z("matic_robot","run_selected_plan",{plan:r,preview_token:p.previewToken});return}case"clean-rooms":{await this.#te();return}case"run-area":{let n=this.#e.value.selection.areaId;n&&await this.#z("matic_robot","clean_area",{area:n});return}case"review-area":this.#e.dispatch({type:"open-workflow",workflow:"areaReview"});return;case"save-area":await this.saveArea();return;case"save-plan":await this.savePlan();return;case"delete-plan":await this.deletePlan();return;case"delete-area":await this.deleteArea();return;case"reset-room-cadence":{if(typeof t=="string")return;let n=this.#e.value;if(n.selection.planId!==t.planId||n.planDraft.dirty||n.dataMode!=="live"||n.command!=="idle"||n.activity!=="idle"&&n.activity!=="docked"||!await this.#G("reset_room_cadence",{plan:t.planId,room_id:t.roomId,modes:[t.mode]},t.mode==="mop"?"Mopping progress reset":"Coverage progress reset",t.mode==="mop"?"Mopping progress could not be reset":"Coverage progress could not be reset"))return;await this.loadPlans();let o=this.#e.value;!this.#a&&o.selection.entryId===n.selection.entryId&&o.selection.planId===t.planId&&!o.planDraft.dirty&&this.selectPlan(t.planId,!0);return}}}async#te(){if(this.#E)return;let t=this.#e.value,e=this.#N(t),n=Ve(t);if(!e||!n||n.key!==e.key||n.generation!==e.generation||n.floorKey!==e.floorKey||n.missionKey!==e.missionKey||n.preview.entryId!==e.entryId||n.preview.blocker||n.preview.rooms.length===0)return;this.#E=!0;let r=this.#y("room-preview");this.#M=this.#W(e),this.#e.patch({manualRoomPreview:f("loading",null),notice:null});try{let o=await this.#n.previewRoomSequence(e.entityId,e.rooms,e.overrideRoomSchedule,r.signal);if(r.signal.aborted||!this.#D(e)||o.entryId!==e.entryId)return;let a={key:e.key,generation:e.generation,floorKey:e.floorKey,missionKey:e.missionKey,preview:o};if(o.blocker||o.rooms.length===0){this.#e.patch({manualRoomPreview:f("ready",a),notice:{tone:"warning",text:"The room preview is blocked. Review the current map and schedule before starting."}});return}if(bn(n.preview)!==bn(o)){this.#e.patch({manualRoomPreview:f("ready",a),notice:{tone:"info",text:"The room preview changed. Review the updated settings before starting."}});return}if(this.#e.patch({manualRoomPreview:f("ready",a),notice:null}),!this.#D(e)||!ve(this.#e.value))return;await this.#z("matic_robot","clean_room_sequence",{rooms:e.rooms,use_room_schedule:!0,override_room_schedule:e.overrideRoomSchedule,return_to_base:!0,preview_token:o.previewToken})}catch(o){!$(o)&&!r.signal.aborted&&this.#D(e)&&this.#e.patch({manualRoomPreview:f("error",null,W(o,"preview-unavailable")),notice:{tone:"warning",text:"The room preview could not be refreshed. No cleaning was started."}})}finally{this.#w("room-preview",r),this.#E=!1,this.#U()}}async#G(t,e,n,r){let o=this.#r?.vacuumEntityId;if(!o||!ne(this.#e.value)||this.#e.value.command==="pending")return!1;let a=this.#y("plan-mutation"),i=this.#r?.entryKey,l=this.#r?.userKey,d=()=>!this.#a&&!a.signal.aborted&&i===this.#r?.entryKey&&l===this.#r?.userKey;this.#e.patch({command:"pending",notice:{tone:"info",text:"Saving\u2026"}});try{return await this.#n.service("matic_robot",t,e,o),d()?(this.#e.patch({command:"idle",notice:{tone:"success",text:n}}),!0):!1}catch{return d()&&this.#e.patch({command:"failed",notice:{tone:"error",text:r}}),!1}finally{this.#w("plan-mutation",a)}}async#z(t,e,n){let r=this.#e.value,o=this.#r?.vacuumEntityId,a=e==="stop_intelligent_cleaning"||t==="vacuum"&&e==="return_to_base",i=t==="vacuum"&&e==="send_command"&&n.command==="resume";if(!o||r.selection.entryId!==this.#r?.entryKey||(a?!_t(r):i?!wt(r):!ve(r)))return;let l=++this.#_,d=this.#r?.entryKey,c=()=>!this.#a&&l===this.#_&&d===this.#r?.entryKey,u=a?"settling":"starting";this.#i!==null&&window.clearTimeout(this.#i),this.#i=null,this.#e.patch({command:u,notice:null});try{if(await this.#n.service(t,e,n,o),!c())return;if(t==="matic_robot"&&(e==="clean_room_sequence"||e==="run_selected_plan")){this.#e.patch({command:"idle"}),this.refreshCatalog(!0);return}this.#e.patch({command:u}),this.#i!==null&&window.clearTimeout(this.#i),this.#i=window.setTimeout(()=>{this.#i=null,c()&&this.#e.value.command===u&&this.#e.patch({command:"idle"})},15e3)}catch{if(!c())return;this.#e.patch({command:"failed",notice:{tone:"error",text:"The action could not be confirmed. Check the robot status before trying again."}})}}updateDraftCircles(t,e=!0,n){this.#e.dispatch({type:"set-draft-circles",circles:t,record:e,...n?{previous:n}:{}}),this.#e.dispatch({type:"patch-area-draft",patch:{dirty:!0}})}dispose(){this.#a||(this.#a=!0,this.#C?.(),this.#C=null,this.#e.patch({manualRoomPreview:f("idle",null)}),this.#H(),this.#I(),this.#i!==null&&window.clearTimeout(this.#i),this.#i=null,this.#s.dispose(),this.#b?.dispose(),this.#b=null,this.#h=null,this.#n.dispose(),this.#t.invalidate())}};var wn=s=>(s.workflow==="none"?0:s.workflow==="plan"?2:1)+(s.fullMap?1:0)+(s.precisionOpen?1:0)+(s.dialog?1:0),_n=s=>{if(!s||typeof s!="object")return null;let t=s.maticMapLayer;if(!t||typeof t!="object")return null;let e=t.owner,n=t.depth;return typeof e=="string"&&Number.isInteger(n)&&Number(n)>=0?{owner:e,depth:Number(n)}:null},De=class{#e;#t=`matic-map-${crypto.randomUUID?.()||Math.random().toString(36).slice(2)}`;#n=0;#s=null;#o=!1;#r=!1;constructor(t){this.#e=t}start(){this.#s||(this.#n=wn(this.#e.value),this.#s=this.#e.subscribe(t=>this.#u(t)),window.addEventListener("popstate",this.#d))}#u(t){let e=wn(t);if(this.#o){this.#o=!1,this.#n=e;return}if(e<this.#n){let n=_n(history.state);if(n?.owner===this.#t&&n.depth===this.#n){let r=e-this.#n;this.#n=e,this.#r=!0,history.go(r);return}}if(e>this.#n)for(let n=this.#n+1;n<=e;n+=1){let r=history.state&&typeof history.state=="object"?history.state:{};history.pushState({...r,maticMapLayer:{owner:this.#t,depth:n}},"",window.location.href)}this.#n=e}#d=()=>{if(this.#r){this.#r=!1;return}if(!(this.#n<1)){if(U(this.#e.value,{type:"dismiss-top-layer"})){let t=history.state&&typeof history.state=="object"?history.state:{};history.pushState({...t,maticMapLayer:{owner:this.#t,depth:this.#n}},"",window.location.href),this.#e.dispatch({type:"open-dialog",dialog:"discardDraft"});return}this.#o=!0,this.#e.dispatch({type:"dismiss-top-layer"})}};dismissTop(){if(this.#n<1)return!1;let t=_n(history.state);return t?.owner===this.#t&&t.depth===this.#n?history.back():this.#e.dispatch({type:"dismiss-top-layer"}),!0}dispose(){this.#s?.(),this.#s=null,window.removeEventListener("popstate",this.#d),this.#n=0,this.#r=!1}};var kn=[Y,X,be,V`
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
      inset-block-start: calc(var(--ms-space-2) + var(--ms-safe-top));
      inset-inline-start: var(--ms-space-2);
    }

    .app {
      display: grid;
      grid-template-rows: calc(3.5rem + var(--ms-safe-top)) minmax(0, 1fr);
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
      padding-block-start: var(--ms-safe-top);
      padding-inline: max(var(--ms-space-3), var(--ms-safe-left)) max(var(--ms-space-3), var(--ms-safe-right));
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
      inset-block-end: max(var(--ms-space-3), var(--ms-safe-bottom));
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
      padding: max(var(--ms-space-4), var(--ms-safe-top)) max(var(--ms-space-4), var(--ms-safe-right)) max(var(--ms-space-4), var(--ms-safe-bottom)) max(var(--ms-space-4), var(--ms-safe-left));
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
    .narrow .app { grid-template-rows: calc(3.35rem + var(--ms-safe-top)) minmax(0, 1fr); min-block-size: 28rem; }
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
      padding: 0 max(var(--ms-space-3), var(--ms-safe-right)) max(var(--ms-space-3), var(--ms-safe-bottom)) max(var(--ms-space-3), var(--ms-safe-left));
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
    .narrow .full-map-hud { inset-block-end: max(var(--ms-space-3), var(--ms-safe-bottom)); }
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
  `];var dt=class extends j{constructor(){super(...arguments);this.state=O();this.compact=!1;this.inline=!1}static{this.properties={state:{attribute:!1},localize:{attribute:!1},compact:{type:Boolean,reflect:!0},inline:{type:Boolean,reflect:!0}}}static{this.styles=[Y,X,be,V`
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
`]}#e(e,n){return z(this.localize,e,n)}#t(e){this.dispatchEvent(new CustomEvent(ie,{detail:e,bubbles:!0,composed:!0}))}#n(e){let n=e.currentTarget.valueAsNumber;Number.isFinite(n)&&this.#t({type:"set-brush",value:n})}render(){let{draw:e}=this.state;return ye`
      <div class="controls ms-surface ms-surface--overlay" aria-label=${this.#e("v4_drawing_precision","Drawing precision")}>
        <div class="row ms-field">
          <label for="brush">${this.#e("brush_size","Brush width")}</label>
          <div class="stepper">
            <button
              class="ms-btn ms-btn--secondary ms-btn--icon"
              type="button"
              aria-label=${this.#e("v4_narrower_brush","Narrower brush")}
              @click=${()=>this.#t({type:"set-brush",value:e.brushMeters/1.25})}
            >&minus;</button>
            <span class="number">
              <input
                id="brush"
                inputmode="decimal"
                type="number"
                min=${.2}
                max=${2.5}
                step="0.01"
                .value=${e.brushMeters.toFixed(2)}
                @change=${this.#n}
                aria-label=${this.#e("v4_brush_width_meters","Brush width in meters")}
              />
              <span class="unit">m</span>
            </span>
            <button
              class="ms-btn ms-btn--secondary ms-btn--icon"
              type="button"
              aria-label=${this.#e("v4_wider_brush","Wider brush")}
              @click=${()=>this.#t({type:"set-brush",value:e.brushMeters*1.25})}
            >+</button>
          </div>
          <input
            class="slider"
            type="range"
            min=${.2}
            max=${2.5}
            step="0.01"
            .value=${e.brushMeters.toFixed(2)}
            @input=${this.#n}
            aria-label=${this.#e("v4_brush_width_slider","Brush width slider")}
            aria-valuetext=${`${e.brushMeters.toFixed(2)} m`}
          />
        </div>
        <p class="hint">${this.#e("v4_precision_hint","Strokes follow the verified map resolution. Zoom changes the view, not the saved outline.")}</p>
      </div>
    `}};customElements.get(re)||customElements.define(re,dt);var Sn=J(ge),qe=J(re),Rn=J(oe),Cn=s=>s.dataMode==="history"||s.floor.readOnly,ar=(s,t)=>{let e=(r,o,a)=>z(t,r,o,a);if(!s.host.connected)return{title:e("v4_reconnecting","Reconnecting"),detail:e("v4_ha_offline","Home Assistant is offline"),icon:G,notable:!0};if(!s.host.administrator)return{title:e("v4_access_required","Access required"),detail:e("v4_admin_only","Administrator only"),icon:G,notable:!0};if(s.host.robotCount===0)return{title:e("v4_no_robot_short","No robot"),detail:e("v4_set_up_robot","Set up a Matic robot"),icon:G,notable:!0};if(!s.host.robotConnected)return{title:e("v4_robot_offline","Robot offline"),detail:e("v4_last_map_read_only","Last verified map \xB7 read only"),icon:G,notable:!0};if(s.activity==="problem")return{title:e("v4_needs_attention","Needs attention"),detail:e("v4_check_robot","Check the robot"),icon:G,notable:!0};if(s.dataMode==="history"){let r=s.resources.history.value?.floors.find(i=>i.id===s.selection.floorId),o=r?.snapshots.findIndex(i=>i.id===s.selection.historyId)??-1,a=r?.snapshots.length??0;return{title:e("v4_saved_map","Saved map"),detail:o>=0?e("v4_read_only_position","Read only \xB7 {position} of {count}",{position:o+1,count:a}):e("v4_read_only","Read only"),icon:Ge,notable:!1}}if(s.coherence==="verifying"||s.coherence==="booting")return{title:e("v4_locating","Locating"),detail:e("v4_finding_map","Finding the current map"),icon:ae,notable:!0};if((s.resources.entry?.activePlan||s.resources.entry?.runnerLocked)&&(s.activity==="idle"||s.activity==="docked"))return{title:e("v4_task_in_progress","Task in progress"),detail:s.activity==="docked"?e("v4_task_docked","Robot docked; the cleaning task has not finished."):e("v4_task_waiting","Waiting for the cleaning task to continue or finish."),icon:Je,notable:!0};if(s.command==="starting"&&(s.activity==="idle"||s.activity==="docked"))return{title:e("v4_action_starting","Starting"),detail:e("v4_action_starting_detail","Waiting for the robot to begin"),icon:ae,notable:!0};if(s.activity==="cleaning")return{title:e("v4_cleaning","Cleaning"),detail:e("v4_cleaning_progress","Cleaning in progress"),icon:Qe,notable:!0};if(s.activity==="recharging"){let r=s.batteryPercent===null?e("v4_recharging_detail","Will resume automatically when ready"):e("v4_recharging_battery","Charging to resume \xB7 {percent}% battery",{percent:s.batteryPercent});return{title:e("v4_recharging","Charging to resume"),detail:r,icon:Lt,notable:!0}}if(s.activity==="paused")return{title:e("v4_paused","Paused"),detail:e("v4_can_resume","Cleaning can resume"),icon:Ze,notable:!0};if(s.activity==="returning")return{title:e("v4_returning","Returning"),detail:e("v4_going_dock","Going to the dock"),icon:Qe,notable:!0};if(s.activity==="stopping")return{title:e("v4_stopping","Stopping"),detail:e("v4_waiting_robot","Waiting for the robot"),icon:Ze,notable:!0};let n=s.batteryPercent===null?e("v4_ready","Ready"):e("v4_battery","{percent}% battery",{percent:s.batteryPercent});return{title:s.activity==="docked"?e("v4_docked","Docked"):e("v4_ready","Ready"),detail:n,icon:ae,notable:!1}},xn=(s,t)=>{let e=(n,r)=>z(t,n,r);switch(s.workflow){case"rooms":return{title:e("v4_choose_rooms","Choose rooms"),description:e("v4_choose_rooms_detail","Select on the map or from the list.")};case"draw":return{title:e("v4_draw_area","Draw an area"),description:e("v4_draw_area_detail","Outline or paint the area, then review it before saving.")};case"plans":return{title:e("v4_your_plans","Your plans"),description:e("v4_choose_plan_detail","Choose a plan to edit or run, or create a new one.")};case"plan":return{title:s.planDraft.id?e("v4_edit_plan","Edit plan"):e("v4_create_plan","Create a plan"),description:e("v4_plan_detail","Review rooms and cleaning settings.")};case"areaReview":return{title:e("v4_name_this_area","Name this area"),description:e("area_details_hint","Name the area and choose cleaning settings.")};case"history":return{title:e("v4_map_history","Map history"),description:e("v4_map_history_detail","Saved maps are floor-scoped and read only.")};case"support":return{title:e("v4_map_diagnostics","Map diagnostics"),description:e("v4_map_support_detail","Private geometry is never included.")};case"none":return Cn(s)?{title:e("v4_saved_map_read_only_title","Saved map is read only"),description:s.dataMode==="live"?e("v4_map_recovery_automatic","Cleaning controls return automatically when the live map is verified."):e("v4_saved_map_read_only_detail","Return to the live map to choose rooms, run a plan, or draw a custom area.")}:{title:e("v4_what_to_clean","What should the robot clean?"),description:e("v4_clean_detail","Choose rooms, a saved plan, or a custom area.")}}},F=["peek","half","full"],Pn={none:"half",rooms:"half",draw:"peek",plan:"full",plans:"full",areaReview:"half",history:"half",support:"full"},ir=.5,lr=100,cr=6,dr=48,ur=["button:not(:disabled)","a[href]","input:not(:disabled)","select:not(:disabled)","textarea:not(:disabled)","[tabindex]:not([tabindex='-1'])"].join(", "),hr=(s,t,e=!1,n="room",r=!1,o="mop")=>{let a=(i,l,d)=>z(t,i,l,d);switch(s){case"discardDraft":return{title:e?a("v4_discard_plan","Discard plan changes?"):a("v4_discard_area","Discard area changes?"),detail:e?a("v4_discard_plan_detail","Your plan changes have not been saved. Keep editing or discard them."):a("v4_discard_area_detail","Your area changes have not been saved. Keep editing or discard them."),cancelLabel:a("v4_keep_area_editing","Keep editing"),confirmLabel:a("v4_discard","Discard"),action:"discard"};case"confirmDeletePlan":return{title:a("v4_delete_plan","Delete this plan?"),detail:a("v4_delete_plan_detail","This removes the saved plan from Home Assistant. The robot will not move."),cancelLabel:a("v4_cancel","Cancel"),confirmLabel:a("plan_delete","Delete plan"),action:"delete-plan"};case"confirmDeleteArea":return{title:a("v4_delete_area","Delete this area?"),detail:a("v4_delete_area_detail","This removes the saved outline from Home Assistant. The robot will not move."),cancelLabel:a("v4_cancel","Cancel"),confirmLabel:a("area_delete","Delete area"),action:"delete-area"};case"confirmResetCadence":return{title:o==="mop"?a("v4_reset_mop_cadence_title","Reset mopping progress for {room}?",{room:n}):a("v4_reset_coverage_cadence_title","Reset coverage progress for {room}?",{room:n}),detail:r?o==="mop"?a("v4_reset_shared_mop_cadence_detail","This clears shared mopping progress for {room} across plans that use its shared schedule. Coverage progress and saved cleaning history stay unchanged.",{room:n}):a("v4_reset_shared_coverage_cadence_detail","This clears shared coverage progress for {room} across plans that use its shared schedule. Mopping progress and saved cleaning history stay unchanged.",{room:n}):o==="mop"?a("v4_reset_private_mop_cadence_detail","This clears mopping progress for {room} in this plan. Coverage progress and saved cleaning history stay unchanged.",{room:n}):a("v4_reset_private_coverage_cadence_detail","This clears coverage progress for {room} in this plan. Mopping progress and saved cleaning history stay unchanged.",{room:n}),cancelLabel:a("v4_cancel","Cancel"),confirmLabel:o==="mop"?a("v4_reset_mop_cadence_confirm","Reset mopping progress"):a("v4_reset_coverage_cadence_confirm","Reset coverage progress"),action:"reset-room-cadence"};case"confirmStop":return{title:a("v4_stop_cleaning","Stop cleaning?"),detail:a("v4_stop_cleaning_detail","The robot may take a moment to settle before another action is available."),cancelLabel:a("v4_keep_cleaning","Keep cleaning"),confirmLabel:a("v4_stop","Stop"),action:"stop"};case"error":return{title:a("v4_error","Something went wrong"),detail:a("v4_error_detail","No action was started. Close this message and try again when the map is ready."),cancelLabel:a("v4_close","Close"),confirmLabel:a("v4_close","Close"),action:null};case null:return null}},pr=(s=document)=>{let t=s.activeElement;for(;t?.shadowRoot?.activeElement;)t=t.shadowRoot.activeElement;return t},ut=s=>!!(s&&s.isConnected&&s.offsetParent!==null),ht=class extends j{constructor(){super();this.state=O();this._measuredNarrow=!1;this._sheetOffset=0;this._overflowOpen=!1;this._helpOpen=!1;this._browserFullscreen=!1;this._sheetDetent="half";this._announcement="";this._workflowLoadFailed=!1;this.#t=null;this.#n=null;this.#s=null;this.#o=null;this.#r=null;this.#u=null;this.#d=null;this.#f=null;this.#i=null;this.#_=null;this.#v=()=>{this._browserFullscreen=document.fullscreenElement===this.renderRoot.querySelector(".app")};this.#g=e=>{if(!this._overflowOpen)return;let n=this.renderRoot.querySelector(".overflow-wrap");(!n||!e.composedPath().includes(n))&&(this._overflowOpen=!1)};this.#se=()=>{this._workflowLoadFailed=!1,this.#B()};new qt(this,{container:()=>this.renderRoot?.querySelector(".draw-tools")??null,items:"button"})}static{this.properties={state:{attribute:!1},localize:{attribute:!1},_measuredNarrow:{state:!0},_sheetOffset:{state:!0},_overflowOpen:{state:!0},_helpOpen:{state:!0},_browserFullscreen:{state:!0},_sheetDetent:{state:!0},_announcement:{state:!0},_workflowLoadFailed:{state:!0}}}static{this.styles=kn}#e(e,n,r){return z(this.localize,e,n,r)}#t;#n;#s;#o;#r;#u;#d;#f;#i;#_;#v;#g;connectedCallback(){super.connectedCallback(),this.#t=new ResizeObserver(([e])=>{if(!e)return;let n=e.contentRect.width<1024||e.contentRect.height<480;n!==this._measuredNarrow&&(this._measuredNarrow=n)}),this.#t.observe(this),window.addEventListener("pointerdown",this.#g,!0),document.addEventListener("fullscreenchange",this.#v),this.#n=new ResizeObserver(([e])=>{if(!e)return;let n=Math.ceil(e.target.getBoundingClientRect().height);n!==this._sheetOffset&&(this._sheetOffset=n)})}disconnectedCallback(){this.#t?.disconnect(),this.#t=null,this.#n?.disconnect(),this.#n=null,this.#s=null,window.removeEventListener("pointerdown",this.#g,!0),document.removeEventListener("fullscreenchange",this.#v),super.disconnectedCallback()}updated(e){let n=e,r=this.renderRoot.querySelector(".mobile-sheet");if(r!==this.#s&&(this.#n?.disconnect(),this.#s=r,r?this.#n?.observe(r):this._sheetOffset!==0&&(this._sheetOffset=0)),n.has("_overflowOpen")&&this._overflowOpen&&this.updateComplete.then(()=>{this.renderRoot.querySelector("#map-options select, #map-options button")?.focus()}),n.has("_helpOpen")){if(this._helpOpen)this.updateComplete.then(()=>{this.renderRoot.querySelector(".help-dialog [data-dialog-initial-focus]")?.focus()});else if(n.get("_helpOpen")){let o=this.#u;this.#u=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>o?.focus({preventScroll:!0}))})}}if(e.has("state")){let o=e.get("state");if(o?.precisionOpen&&!this.state.precisionOpen&&this.#k()?.focus(),o?.fullMap&&!this.state.fullMap){let a=this.#r;this.#r=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>{(this.renderRoot.querySelector(".workspace-toggle")??this.renderRoot.querySelector(".nav--menu")??(a?.isConnected?a:null))?.focus({preventScroll:!0})})})}if(!o?.dialog&&this.state.dialog){let a=pr(this.shadowRoot||document);a?.hasAttribute("data-dialog-launcher")&&(this.#o=a),this.updateComplete.then(()=>{(this.renderRoot.querySelector(".dialog [data-dialog-initial-focus]")??this.renderRoot.querySelector(".dialog button"))?.focus()})}else if(o?.dialog&&!this.state.dialog){o.dialog==="discardDraft"&&(this.#d=null,this.#T());let a=this.#o?.isConnected&&this.#o.hasAttribute("data-dialog-launcher")?this.#o:this.#Q(o.dialog);this.#o=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>a?.focus({preventScroll:!0}))})}o?o.workflow!==this.state.workflow&&(this._sheetDetent=Pn[this.state.workflow],this.updateComplete.then(()=>this.#p())):this._sheetDetent=Pn[this.state.workflow]}}#p(){let e=this.renderRoot.querySelector(".panel-heading h2");if(ut(e)){e.focus({preventScroll:!0});return}let n=this.renderRoot.querySelector(".action-bar .ms-btn--primary");ut(n)&&n.focus({preventScroll:!0})}#k(){let e=this.renderRoot.querySelector(".draw-brush");return ut(e)?e:this.renderRoot.querySelector(ge)?.shadowRoot?.querySelector(".draw-brush")??null}#l(e){if(U(this.state,e)){this.#d=e,this.#l({type:"open-dialog",dialog:"discardDraft"});return}this.dispatchEvent(new CustomEvent(ie,{detail:e,bubbles:!0,composed:!0}))}#x(e){if(e.enabled){if(e.id==="return-live"){this.#l({type:"set-history",historyId:null});return}if(e.id==="clear-draft"){this.#l({type:"clear-draft"});return}this.#R(e.id)}}#c(e,n){let r={type:"open-workflow",workflow:e};n instanceof HTMLElement&&U(this.state,r)&&(this.#o=n),this.#l(r)}#S(){let e=this.#d;this.#d=null,e?.type==="select-plan"||e?.type==="select-area"?(this.#l({type:"patch-plan-draft",patch:{dirty:!1}}),this.#l({type:"patch-area-draft",patch:{dirty:!1}}),this.#l({type:"dismiss-top-layer"})):this.#l({type:"discard-draft"}),e&&e.type!=="dismiss-top-layer"&&queueMicrotask(()=>this.dispatchEvent(new CustomEvent(ie,{detail:e,bubbles:!0,composed:!0})))}#P(){this.#d=null,this.#a(),this.#T()}#T(){this.updateComplete.then(()=>{let e=this.renderRoot.querySelector(".floor-switcher");e&&(e.value=this.state.selection.floorId);let n=this.renderRoot.querySelector(".robot-switcher");n&&(n.value=this.state.selection.entryId??"")})}#a(){let e=this.state.dialog,n=e&&this.#o?.isConnected&&this.#o.hasAttribute("data-dialog-launcher")?this.#o:e?this.#Q(e):null;this.#l({type:"dismiss-top-layer"}),n&&requestAnimationFrame(()=>n.focus({preventScroll:!0}))}#R(e){this.dispatchEvent(new CustomEvent(et,{detail:typeof e=="string"?{id:e}:e,bubbles:!0,composed:!0}))}#b(e){this.#l({type:"dismiss-top-layer"}),this.#R(e)}#h(e){if(e.action==="discard"){this.#S();return}if(e.action==="delete-plan"||e.action==="delete-area"){this.#b(e.action);return}if(e.action==="reset-room-cadence"){let n=this.state.cadenceResetRequest;this.#l({type:"dismiss-top-layer"}),n&&this.#R({id:"reset-room-cadence",planId:n.planId,roomId:n.roomId,mode:n.mode});return}this.#l({type:"dismiss-top-layer"}),e.action==="stop"&&this.#R("stop")}#m(e){e!==this._sheetDetent&&(this._sheetDetent=e,this._announcement=this.#e("v4_workspace_height","Map workspace, {height} height",{height:e}))}#C(e,n=!1){let o=F.indexOf(this._sheetDetent)+e;n&&o>=F.length&&(o=0),o=Math.max(0,Math.min(F.length-1,o)),this.#m(F[o]??this._sheetDetent)}#M(e){let n=this.renderRoot.querySelector(".workspace")?.clientHeight??e.parentElement?.clientHeight??e.offsetHeight,r=parseFloat(getComputedStyle(this).fontSize)||16,o=[".sheet-grip",".sheet-tools",".action-bar"].map(l=>e.querySelector(l)?.offsetHeight??0).reduce((l,d)=>l+d,0)+r*.75,a=Math.min(n*.92,n-r*9),i=Math.min(n*.48,r*26,a);return{peek:Math.min(o,i),half:i,full:a}}#E(){return this.renderRoot.querySelector(".mobile-sheet")}#L(e){if(e.pointerType==="mouse"&&e.button!==0||e.target?.closest("button, select, input, a"))return;let n=this.#E();!n||this.#i||(this.#i={pointerId:e.pointerId,startY:e.clientY,startHeight:n.offsetHeight,heights:this.#M(n),samples:[{y:e.clientY,t:e.timeStamp}],moved:!1},e.currentTarget.setPointerCapture(e.pointerId),n.classList.add("dragging"))}#O(e){let n=this.#i;if(!n||e.pointerId!==n.pointerId)return;let r=this.#E();if(!r)return;let o=e.clientY-n.startY;for(!n.moved&&Math.abs(o)>cr&&(n.moved=!0),n.samples.push({y:e.clientY,t:e.timeStamp});n.samples.length>2&&e.timeStamp-(n.samples[1]?.t??0)>lr;)n.samples.shift();if(!n.moved)return;let a=n.startHeight-n.heights.full,i=n.startHeight-n.heights.peek,l=Math.max(a,Math.min(i,o));r.style.transform=`translateY(${l}px)`}#N(e){let n=this.#i;if(!n||e.pointerId!==n.pointerId)return;this.#i=null;let r=this.#E();if(r&&(r.style.transform="",r.classList.remove("dragging")),e.type==="pointercancel")return;if(!n.moved){this.#C(1,!0);return}let o=e.clientY-n.startY,a=F.indexOf(this._sheetDetent),i=n.samples[0],l=n.samples[n.samples.length-1],d=i&&l&&l!==i?(l.y-i.y)/Math.max(1,l.t-i.t):0;if(Math.abs(d)>ir){let h=Math.max(0,Math.min(F.length-1,a+(d<0?1:-1)));this.#m(F[h]??this._sheetDetent);return}let c=n.startHeight-o,u=this._sheetDetent,p=Number.POSITIVE_INFINITY;for(let h of F){let g=Math.abs(n.heights[h]-c);g<p&&(p=g,u=h)}this.#m(u)}#W(e){if(e.pointerType==="mouse")return;let n=e.currentTarget;this.#_={pointerId:e.pointerId,startY:e.clientY,atTop:n.scrollTop===0,consumed:!1}}#D(e){let n=this.#_;if(!n||n.consumed||!n.atTop||e.pointerId!==n.pointerId)return;if(e.currentTarget.scrollTop>0){this.#_=null;return}e.clientY-n.startY<dr||(n.consumed=!0,this.#C(-1))}#U(){this.#_=null}#ne(){this.dispatchEvent(new CustomEvent("hass-toggle-menu",{bubbles:!0,composed:!0}))}#re(e){this.#r=e.currentTarget,this.#l({type:this.state.fullMap?"exit-full-map":"enter-full-map"})}#V(e){this._overflowOpen=!1,e&&this.updateComplete.then(()=>{this.renderRoot.querySelector(".overflow")?.focus()})}#j(e){if(this.#V(e==="fullscreen"),e==="support"){this.#c("support");return}if(e==="fullscreen"){let n=this.renderRoot.querySelector(".app");document.fullscreenElement?document.exitFullscreen():n?.requestFullscreen();return}this.dispatchEvent(new CustomEvent(et,{detail:{id:"use-classic"},bubbles:!0,composed:!0}))}#oe(){this.#l({type:"set-precision-open",value:!this.state.precisionOpen})}#Y(e){this.#u=e.currentTarget,this._helpOpen=!0}#J(e){let n=e;if(!fe(n.detail))return;if(U(this.state,n.detail)){e.stopPropagation(),this.#l(n.detail);return}if(n.detail?.type!=="open-dialog")return;let r=n.composedPath().find(o=>o instanceof HTMLElement&&o.hasAttribute("data-dialog-launcher"));r instanceof HTMLElement&&(this.#o=r)}#Q(e){return this.renderRoot.querySelector(oe)?.shadowRoot?.querySelector(`[data-dialog-launcher="${e}"]`)??null}#H(e){if(!Dt(e)&&!(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey)&&e.key==="Escape"){if(e.preventDefault(),this._overflowOpen){this.#V(!0);return}if(this._helpOpen){this._helpOpen=!1;return}if(this.state.dialog==="discardDraft"){this.#P();return}this.#l({type:"dismiss-top-layer"})}}#y(e){if(e.key!=="Tab")return;let r=[...e.currentTarget.querySelectorAll(ur)],o=r[0],a=r.at(-1);if(!o||!a)return;let i=this.shadowRoot?.activeElement;e.shiftKey&&i===o?(e.preventDefault(),a.focus()):!e.shiftKey&&i===a&&(e.preventDefault(),o.focus())}#w(){let e=this.renderRoot.querySelector(ge);(e?.shadowRoot?.querySelector(".map-root")??e)?.focus()}#I(){this._sheetDetent==="peek"&&this.#E()&&this.#m("half"),this.updateComplete.then(()=>this.#p())}#$(e,n,r){if(e.id==="choose-cleaning")return k;let o=e.labelKey?this.#e(e.labelKey,e.label):e.label,a=!e.enabled&&e.reason?e.reasonKey?this.#e(e.reasonKey,e.reason):e.reason:null,i=e.id==="stop";return b`
      <button
        class=${`${n} ${e.kind==="danger"?"ms-btn--danger":""}`}
        type="button"
        aria-disabled=${e.enabled?k:"true"}
        aria-describedby=${a?r:k}
        aria-label=${i?this.#e("v4_stop_cleaning_label","Stop cleaning"):k}
        @click=${()=>this.#x(e)}
      >${o}</button>
      ${a?b`<p class="action-reason" id=${r}>${a}</p>`:k}
    `}#q(e){let n=e.resources.plans.value?.rooms??e.resources.areas.value?.rooms??[];return e.selection.roomIds.map(r=>n.find(o=>o.roomId===r)?.name??r)}#Z(e,n,r){let o=n?.enabled&&e.workflow==="rooms"&&n.id==="clean-rooms"?[this.#q(e).join(", "),e.planDraft.returnToBase?this.#e("v4_returns_to_dock","returns to the dock"):""].filter(Boolean).join(" \xB7 "):"";return b`
      <div class="action-bar">
        ${o?b`<p class="action-summary">${o}</p>`:k}
        ${n?this.#$(n,"ms-btn ms-btn--block ms-btn--lg ms-btn--primary","primary-reason"):k}
        ${r?this.#$(r,"ms-btn ms-btn--block ms-btn--lg ms-btn--secondary","secondary-reason"):k}
      </div>
    `}#A(e,n,r=k){return b`
      <div class="host-state">
        <h3>${e}</h3>
        <p>${n}</p>
        ${r}
      </div>
    `}#X(e,n,r,o,a=!1){return b`
      <button
        class="ms-row"
        type="button"
        aria-disabled=${a?"true":k}
        @click=${()=>{a||r()}}
      >
        <span class="ms-row__lead">${A(n)}</span>
        <span class="ms-row__body"><strong>${e}</strong>${o?b`<small>${o}</small>`:k}</span>
        <span class="ms-row__trail">${A(_e)}</span>
      </button>
    `}#F(e){let n=e.resources.history.value?.floors||[],r=n.length?n.map((o,a)=>({id:o.active?"current":o.id,label:`${o.label||(o.active?this.#e("v4_current_floor","Current floor"):this.#e("v4_saved_floor","Saved floor {number}",{number:o.ordinal??a+1}))}${!o.active&&o.snapshots.length===0?` \xB7 ${this.#e("v4_floor_not_captured","Visit floor to capture")}`:""}`,disabled:!o.active&&o.snapshots.length===0})):[{id:e.selection.floorId,label:e.floor.displayName,disabled:!1}];return b`
      <select
        class="ms-select context-switcher floor-switcher"
        slot="floor"
        data-map-control
        name="map-floor"
        aria-label=${this.#e("v4_choose_floor","Choose floor")}
        ?disabled=${r.length<=1}
        .value=${e.selection.floorId}
        @change=${o=>this.#l({type:"set-floor",floorId:o.currentTarget.value})}
      >${r.map(o=>b`
        <option value=${o.id} ?selected=${o.id===e.selection.floorId} ?disabled=${o.disabled}>${o.label}</option>
      `)}</select>
    `}#K(e,n){let r=(y,M,E)=>this.#e(y,M,E),o=this.#X(r("v4_map_history","Map history"),Ge,()=>this.#c("history"),r("v4_map_history_detail","Saved maps are floor-scoped and read only.")),a=this.#X(r("v4_map_diagnostics","Map diagnostics"),Tt,()=>this.#c("support"),r("v4_map_support_detail","Private geometry is never included.")),{host:i}=e;if(!i.connected)return this.#A(r("v4_reconnecting_title","Reconnecting to Home Assistant"),r("v4_reconnecting_body","The last verified map stays read-only until the connection returns."));if(!i.administrator)return this.#A(r("v4_admin_title","Administrator access required"),r("v4_admin_body","Ask a Home Assistant administrator to open this map."));if(i.robotCount===0)return this.#A(r("v4_no_robot_title","No Matic robot set up"),r("v4_no_robot_body","Add the Matic integration to see a map here."),b`<a class="ms-btn ms-btn--secondary" href="/config/integrations/integration/matic_robot">${r("v4_open_integration","Open the Matic integration")}</a>`);if(!i.robotConnected)return b`
        ${this.#A(r("v4_robot_offline_title","Robot offline"),r("v4_robot_offline_body","Showing the last verified map. Cleaning is unavailable until the robot reconnects."))}
        <h3 class="shelf-heading">${r("v4_more","Map tools")}</h3>
        <div class="shelf">${o}${a}</div>
      `;if(Cn(e))return b`
        ${this.#A(r("v4_saved_map_read_only_notice","Cleaning is unavailable on a saved map"),e.dataMode==="live"?r("v4_map_recovery_automatic","Cleaning controls return automatically when the live map is verified."):r("v4_saved_map_read_only_notice_detail","Saved maps are view only. Return to the live map below to choose rooms, run a plan, or draw a custom area."))}
        <h3 class="shelf-heading">${r("v4_more","Map tools")}</h3>
        <div class="shelf">
          ${o}
          ${a}

        </div>
      `;let l=e.coherence==="verifying"||e.coherence==="booting",d=e.resources.plans,c=d.value,u=c!==null&&c.rooms.length===0,p=c?.plans.length??0,h=d.status==="loading",g=d.status==="error",v=l||u,w=l?r("v4_reason_locating","Waiting for the robot to confirm which floor it is on."):u?r("v4_no_rooms_reason","This floor has no named rooms yet."):null,S=l?r("v4_reason_locating","Waiting for the robot to confirm which floor it is on."):null,_=l?r("v4_reason_locating","Waiting for the robot to confirm which floor it is on."):r("v4_areas_quick_detail","Create or choose a saved area");return b`
      ${e.activity==="problem"?this.#A(r("v4_attention_title","The robot needs attention"),r("v4_attention_body","Check the robot, then start a new task.")):b`
          <div class="quick-actions" aria-label=${r("v4_cleaning_choices","Cleaning choices")}>
            <button
              class="ms-row ms-row--card ms-row--featured"
              type="button"
              aria-disabled=${v?"true":k}
              @click=${()=>{v||this.#c("rooms")}}
            >
              <span class="ms-row__lead">${A(ae)}</span>
              <span class="ms-row__body">
                <strong>${r("v4_clean_rooms","One-time clean")}</strong>
                <small>${w??r("v4_clean_rooms_hint","Choose rooms for this run")}</small>
              </span>
              <span class="ms-row__trail">${A(_e)}</span>
            </button>
            <button
              class="ms-row ms-row--card"
              type="button"
              aria-disabled=${l?"true":k}
              @click=${()=>{l||this.#c("plans")}}
            >
              <span class="ms-row__lead">${A(Je)}</span>
              <span class="ms-row__body">
                <strong>${h?r("v4_plans_loading","Checking saved plans"):g?r("v4_plans_unavailable","Plans unavailable"):p?r("v4_run_a_plan","Run a plan"):r("v4_create_plan","Create a plan")}</strong>
                <small>${S??(h?r("v4_plans_loading_hint","Reading routines for this floor"):g?r("v4_plans_unavailable_hint","Try again to load saved routines"):p?p===1?r("v4_saved_routine","1 saved routine"):r("v4_saved_routines","{count} saved routines",{count:p}):r("v4_no_plans_hint","Save a room routine you can repeat"))}</small>
              </span>
              <span class="ms-row__trail">${A(_e)}</span>
            </button>
          </div>
        `}
      <h3 class="shelf-heading">${r("v4_more","Map tools")}</h3>
      <div class="shelf">
        ${this.#X(r("v4_custom_areas","Clean a custom area"),$t,()=>this.#c("draw"),_,l)}
        ${o}

      </div>
      ${n?b`
        <h3 class="shelf-heading" id="map-display-heading">${r("v4_map_display","Map display")}</h3>
        <div class="map-display">
          <div class="ms-segment" role="group" aria-labelledby="map-display-heading">
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(e.appearance==="photo")}
              @click=${()=>this.#l({type:"set-appearance",appearance:"photo"})}
            >${r("map_style_photo","Photo")}</button>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(e.appearance==="rooms")}
              @click=${()=>this.#l({type:"set-appearance",appearance:"rooms"})}
            >${r("v4_room_colours","Floor plan")}</button>
          </div>
          <label class="ms-checkbox">
            <input type="checkbox" .checked=${e.labelsVisible} @change=${()=>this.#l({type:"toggle-labels"})}>
            ${r("v4_room_names","Room names")}
          </label>
          <button
            class="ms-btn ms-btn--secondary help-launcher"
            type="button"
            aria-haspopup="dialog"
            aria-expanded=${String(this._helpOpen)}
            @click=${this.#Y}
          >${r("v4_how_to_move","How to move the map")}</button>
        </div>
      `:k}
    `}#ee(e,n){return e.workflow==="none"?this.#K(e,n):customElements.get(oe)?b`<${Rn}
      .state=${e}
      .localize=${this.localize}
      @matic-workspace-intent=${this.#J}
    ></${Rn}>`:(this.#B(),this._workflowLoadFailed?b`<div class="workflow-loading" role="alert">
          <p>${this.#e("v4_workflow_load_failed","Workspace tools could not be loaded.")}</p>
          <button class="ms-btn ms-btn--secondary" @click=${this.#se}>
            ${this.#e("v4_retry","Try again")}
          </button>
        </div>`:b`<div class="workflow-loading" role="status" aria-live="polite">
        ${this.#e("v4_workflow_loading","Loading workspace tools\u2026")}
      </div>`)}#B(){this.#f||customElements.get(oe)||(this._workflowLoadFailed=!1,this.#f=import("./workflow-panel-LUL3SDND.js").then(()=>{this.#f=null,this.requestUpdate()}).catch(()=>{this.#f=null,this._workflowLoadFailed=!0}))}#se;#te(e,n){let r=xn(e,this.localize);return b`
      <div class="panel-heading">
        ${e.workflow!=="none"?b`
          <button
            class="panel-back ms-btn ms-btn--secondary"
            type="button"
            aria-label=${e.workflow==="plan"?this.#e("v4_back_to_plans","Back to plans"):this.#e("v4_back_to_all_tasks","Back to all tasks")}
            data-dialog-launcher="discardDraft"
            @click=${o=>this.#c(e.workflow==="plan"?"plans":"none",o.currentTarget)}
          >${A(we)}<span class="ms-btn__label">${e.workflow==="plan"?this.#e("v4_your_plans","Your plans"):this.#e("v4_all_tasks","All tasks")}</span></button>
        `:k}
        <h2 tabindex="-1">${r.title}</h2>
      </div>
      <p class="panel-description">${r.description}</p>
      ${this.#ee(e,n)}
    `}#G(e,n){let o=xn(e,this.localize).title;return e.workflow==="rooms"&&e.selection.roomIds.length&&(o=`${this.#e("v4_rooms_selected","Rooms selected: {count}",{count:e.selection.roomIds.length})} \xB7 ${this.#q(e).join(", ")}`),this._sheetDetent!=="peek"?n.detail?`${n.title} \xB7 ${n.detail}`:n.title:n.notable?`${n.title} \xB7 ${o}`:o}#z(){let e=(n,r)=>this.#e(n,r);return b`
      <div class="dialog-backdrop" @click=${n=>{n.target===n.currentTarget&&(this._helpOpen=!1)}}>
        <section
          class="dialog help-dialog ms-surface ms-surface--overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-title"
          @keydown=${this.#y}
        >
          <h2 id="help-title">${e("v4_how_to_move","How to move the map")}</h2>
          <dl>
            <dt>${e("v4_touch","Touch")}</dt>
            <dd>${e("v4_touch_help","Drag to explore \xB7 pinch to zoom \xB7 twist two fingers to rotate")}</dd>
            <dt>${e("v4_trackpad","Trackpad")}</dt>
            <dd>${e("v4_trackpad_help","Scroll to pan \xB7 pinch to zoom \xB7 twist to rotate")}</dd>
            <dt>${e("v4_mouse","Mouse")}</dt>
            <dd>${e("v4_mouse_help","Drag to orbit \xB7 Shift, middle, or right drag to pan \xB7 wheel to zoom")}</dd>
            <dt>${e("v4_keyboard","Keyboard")}</dt>
            <dd>${e("v4_keyboard_help","WASD to move \xB7 Q/E or arrows to orbit \xB7 +/\u2212 to zoom \xB7 0 to fit")}</dd>
          </dl>
          <div class="dialog-actions">
            <button
              class="ms-btn ms-btn--secondary"
              type="button"
              data-dialog-initial-focus
              @click=${()=>{this._helpOpen=!1}}
            >${e("v4_close","Close")}</button>
          </div>
        </section>
      </div>
    `}render(){let e=this.state,n=e.narrowHint||this._measuredNarrow,r=ar(e,this.localize),o=kt({...e,narrowHint:n}),a=St(e),i=!n&&o.id==="stop"?o:!n&&a?.id==="stop"?a:null,l=i&&i===o?null:o,d=e.workflow==="draw"&&e.dataMode==="live"?{id:"clear-draft",label:"Clear drawing",labelKey:"v4_clear_drawing",kind:"neutral",enabled:e.draw.circles.length>0||!!e.draw.outline?.points.length}:null,c=i&&i===a?null:a??d,u=e.fullMap&&(e.coherence==="verifying"||e.coherence==="booting"),p=e.fullMap||e.host.administrator&&e.host.robotCount>0&&e.map.available,h=e.cadenceResetRequest?e.resources.plans.value?.rooms.find(y=>y.roomId===e.cadenceResetRequest?.roomId):void 0,g=e.cadenceResetRequest?e.resources.plans.value?.plans.find(y=>y.id===e.cadenceResetRequest?.planId)?.rooms.find(y=>y.roomId===e.cadenceResetRequest?.roomId):void 0,v=hr(e.dialog,this.localize,e.workflow==="plan",h?.name||e.cadenceResetRequest?.roomId||"room",g?.cadence?.scope==="shared",e.cadenceResetRequest?.mode),w=n&&!e.fullMap?`--map-sheet-offset:${this._sheetOffset}px`:"--map-sheet-offset:0px",S=n&&e.workflow==="draw",_=e.precisionOpen&&e.workflow==="draw";return b`
      <div class=${`root ${n?"narrow":"wide"}`} @keydown=${this.#H}>
        <button class="skip-link ms-btn ms-btn--primary" type="button" @click=${this.#w}>${this.#e("v4_skip_to_map","Skip to the map")}</button>
        <button class="skip-link ms-btn ms-btn--primary" type="button" @click=${this.#I}>${this.#e("v4_skip_to_workspace","Skip to the map workspace")}</button>
        <div class="app" ?inert=${!!v||this._helpOpen}>
          <header class="app-bar">
            ${e.precisionOpen?k:b`
              <button
                class="nav nav--menu ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#e("v4_open_navigation","Open Home Assistant sidebar")}
                title=${this.#e("v4_open_navigation","Open Home Assistant sidebar")}
                @click=${this.#ne}
              >${A(Mt)}</button>
            `}

            ${e.precisionOpen?b`
              <button
                class="nav ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#e("v4_back","Back")}
                @click=${()=>this.#l({type:"dismiss-top-layer"})}
              >${A(we)}</button>
            `:k}
            <h1 class="title">${this.#e("map_studio_title","Matic Map")}</h1>
            ${e.robots.length>1?b`
              <select
                class="ms-select context-switcher robot-switcher"
                name="matic-robot"
                aria-label=${this.#e("v4_choose_robot","Choose robot")}
                .value=${e.selection.entryId||""}
                @change=${y=>this.#l({type:"select-entry",entryId:y.currentTarget.value})}
              >${e.robots.map(y=>b`
                <option value=${y.entryId} ?selected=${y.entryId===e.selection.entryId}>${y.label}</option>
              `)}</select>
            `:k}

            <span class="spacer"></span>
            ${p?b`
              <button
                class="workspace-toggle ms-btn ms-btn--icon"
                type="button"
                aria-label=${e.fullMap?this.#e("v4_show_workspace","Show cleaning panel"):this.#e("v4_hide_workspace","Hide cleaning panel")}
                aria-controls="map-workspace"
                aria-expanded=${String(!e.fullMap)}
                title=${e.fullMap?this.#e("v4_show_workspace","Show cleaning panel"):this.#e("v4_hide_workspace","Hide cleaning panel")}
                @click=${this.#re}
              >${A(Et)}</button>
            `:k}
            <div class="overflow-wrap">
              <button
                class="overflow ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#e("v4_map_options","Map options")}
                aria-expanded=${String(this._overflowOpen)}
                aria-controls="map-options"
                @click=${()=>{this._overflowOpen=!this._overflowOpen}}
              >${A(Ct)}</button>
              ${this._overflowOpen?b`
                <div id="map-options" class="overflow-menu ms-surface ms-surface--overlay">
                  <label class="overflow-field ms-field">${this.#e("map_quality_label","Scene detail")}
                    <select
                      aria-label=${this.#e("map_quality_label","Scene detail")}
                      .value=${e.quality}
                      @change=${y=>this.#l({type:"set-quality",quality:y.currentTarget.value})}
                    >
                      <option value="auto">${this.#e("map_quality_auto","Auto detail")}</option>
                      <option value="efficient">${this.#e("map_quality_efficient","Efficient")}</option>
                      <option value="balanced">${this.#e("map_quality_balanced","Balanced")}</option>
                      <option value="maximum">${this.#e("map_quality_maximum","Maximum")}</option>
                    </select>
                  </label>
                  <button class="ms-row ms-row--menu" type="button" @click=${()=>this.#j("support")}>${this.#e("v4_map_diagnostics","Map diagnostics")}</button>
                  <button class="ms-row ms-row--menu" type="button" @click=${()=>this.#j("classic")}>${this.#e("v4_switch_classic","Open classic map view")}</button>
                  <button class="ms-row ms-row--menu" type="button" @click=${()=>this.#j("fullscreen")}>${this._browserFullscreen?this.#e("v4_leave_full_screen","Leave full screen"):this.#e("v4_full_screen","Full screen")}</button>
                </div>
              `:k}
            </div>
          </header>

          <main class=${`workspace ${e.fullMap?"full-map":""}`} style=${w}>
            <div class="canvas">
              <${Sn}
                class="map-canvas"
                style=${w}
                .state=${e}
                .localize=${this.localize}
                .narrow=${n}
              >${this.#F(e)}
                ${n&&!e.fullMap&&this._sheetDetent==="full"?b`
                  <button
                    class="sheet-scrim"
                    slot="scrim"
                    data-map-control
                    type="button"
                    aria-label=${this.#e("v4_collapse_sheet","Collapse the map workspace")}
                    @click=${()=>this.#m("peek")}
                  ></button>
                `:k}
              </${Sn}>
              ${!n&&_?b`
                <div class="precision-popover">
                  <${qe} compact .state=${e} .localize=${this.localize}></${qe}>
                </div>
              `:k}
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
              class=${n?"inspector mobile-sheet":"inspector"}
              data-detent=${n?this._sheetDetent:k}
              data-workflow=${e.workflow}
              aria-label="Map workspace"
            >
              ${n?b`
                <div
                  class="sheet-grip"
                  @pointerdown=${this.#L}
                  @pointermove=${this.#O}
                  @pointerup=${this.#N}
                  @pointercancel=${this.#N}
                >
                  <span class="sheet-handle" role="presentation"></span>
                  ${e.workflow!=="none"&&this._sheetDetent==="peek"?b`
                    <button
                      class="sheet-back ms-btn ms-btn--icon ms-btn--sm"
                      type="button"
                      aria-label=${e.workflow==="plan"?this.#e("v4_back_to_plans","Back to plans"):this.#e("v4_back_to_all_tasks","Back to all tasks")}
                      title=${e.workflow==="plan"?this.#e("v4_back_to_plans","Back to plans"):this.#e("v4_back_to_all_tasks","Back to all tasks")}
                      data-dialog-launcher="discardDraft"
                      @click=${y=>this.#c(e.workflow==="plan"?"plans":"none",y.currentTarget)}
                    >${A(we)}</button>
                  `:k}
                  <span class="sheet-status">${this.#G(e,r)}</span>
                  <button
                    class="ms-btn ms-btn--icon ms-btn--sm"
                    type="button"
                    aria-label=${this.#e("v4_show_more","Show more of the map workspace")}
                    aria-controls="sheet-body"
                    aria-disabled=${this._sheetDetent==="full"?"true":k}
                    @click=${()=>this.#C(1)}
                  >${A(At)}</button>
                  <button
                    class="ms-btn ms-btn--icon ms-btn--sm"
                    type="button"
                    aria-label=${this.#e("v4_show_less","Show less of the map workspace")}
                    aria-controls="sheet-body"
                    aria-disabled=${this._sheetDetent==="peek"?"true":k}
                    @click=${()=>this.#C(-1)}
                  >${A(It)}</button>
                </div>
                ${S?b`
                  <div class="sheet-tools">
                    ${Ot(e,{intent:y=>this.#l(y),openBrush:()=>this.#oe(),t:(y,M)=>this.#e(y,M)},"grid")}
                    ${_?b`
                      <div class="precision-popover">
                        <${qe} compact inline .state=${e} .localize=${this.localize}></${qe}>
                      </div>
                    `:k}
                  </div>
                `:k}
                <div
                  class="sheet-body"
                  id="sheet-body"
                  @pointerdown=${this.#W}
                  @pointermove=${this.#D}
                  @pointerup=${this.#U}
                  @pointercancel=${this.#U}
                >
                  ${this.#te(e,n)}
                </div>
                ${this.#Z(e,l,c)}
              `:b`
                <div class="status-strip">
                  <span class="status-icon" aria-hidden="true">${A(r.icon)}</span>
                  <span class="status-copy"><strong>${r.title}</strong><small>${r.detail}</small></span>
                  ${i?this.#$(i,"status-action ms-btn ms-btn--secondary","status-reason"):k}
                </div>
                <section class="workflow">
                  <div class="workflow-body">${this.#te(e,n)}</div>
                  ${this.#Z(e,l,c)}
                </section>
              `}
            </aside>

            ${e.fullMap?b`
              <section
                class=${`full-map-hud ms-surface ms-surface--floating ${a?"has-secondary":""} ${!n&&(e.workflow==="draw"||e.workflow==="rooms"&&e.selection.roomIds.length>0)?"above-dock":""}`}
                aria-label="Robot status and action"
              >
                <span class="hud-copy"><strong>${r.title}</strong><small>${r.detail}</small></span>
                ${u&&o.id!=="stop"?k:this.#$(o,"ms-btn ms-btn--lg ms-btn--primary","hud-reason")}
                ${a&&(!u||a.id==="stop")?this.#$(a,"ms-btn ms-btn--lg ms-btn--secondary","hud-secondary-reason"):k}
              </section>
            `:k}
          </main>
        </div>

        <div class="sr-only" aria-live="polite" aria-atomic="true">${[this._announcement,e.notice?.text??""].filter(Boolean).join(" ")}</div>

        ${this._helpOpen?this.#z():k}

        ${v?b`
          <div class="dialog-backdrop">
            <section
              class="dialog ms-surface ms-surface--overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="dialog-title"
              aria-describedby="dialog-detail"
              @keydown=${this.#y}
            >
              <h2 id="dialog-title">${v.title}</h2>
              <p id="dialog-detail">${v.detail}</p>
              <div class="dialog-actions">
                <button
                  class="ms-btn ms-btn--secondary"
                  type="button"
                  data-dialog-initial-focus
                  @click=${e.dialog==="discardDraft"?this.#P:this.#a}
                >${v.cancelLabel}</button>
                ${v.action===null?k:b`
                  <button
                    class="discard ms-btn ms-btn--primary ms-btn--danger"
                    type="button"
                    @click=${()=>this.#h(v)}
                  >${v.confirmLabel}</button>
                `}
              </div>
            </section>
          </div>
        `:k}
      </div>
    `}};customElements.get(se)||customElements.define(se,ht);var Mn=J(se),pt=class extends j{constructor(){super(...arguments);this.narrow=!1;this._workspace=O();this._classic=!1;this.entryOverride=null;this.#e=new ke;this.#t=new gt(this._workspace);this.#n=null;this.#s=null;this.#o=null;this.#r=null;this.#u=null;this.#d=""}static{this.styles=[Y,X,V`
:host { display: block; block-size: 100%; }
.classic { position: relative; block-size: 100%; }
.return-v4 {
  position: absolute;
  z-index: 100;
  inset-block-start: max(0.65rem, var(--ms-safe-top));
  inset-inline-end: max(0.65rem, var(--ms-safe-right));
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
`]}static{this.properties={hass:{attribute:!1},narrow:{type:Boolean},route:{attribute:!1},panel:{attribute:!1},_workspace:{state:!0},_classic:{state:!0},entryOverride:{state:!0}}}#e;#t;#n;#s;#o;#r;#u;#d;shouldUpdate(e){if(this._classic||!e.has("hass")||[...e.keys()].some(r=>r!=="hass"))return!0;let n=e.get("hass");return n?.connection!==this.hass?.connection||n?.localize!==this.hass?.localize?!0:this.#e.project(this.hass,this.panel,this.entryOverride)!==this.#n}connectedCallback(){super.connectedCallback(),this._classic=dn()==="v3",this.#s=this.#t.subscribe(e=>{this._workspace=e,this.#_(e)}),this._classic||this.#f()}disconnectedCallback(){this.#s?.(),this.#s=null,this.#i(),super.disconnectedCallback()}#f(){if(!this.#r&&(this.#n=this.#e.project(this.hass,this.panel,this.entryOverride),this.#o=new Ae(()=>this.hass),this.#r=new Oe(this.#t,this.#o,this.hass?.connection??null),this.#u=new De(this.#t),this.#u.start(),this.#n)){this.#r.sync(this.#n,this.panel);let{host:e}=this.#n;e.connected&&e.administrator&&e.robotCount>0&&this.#r.refreshCatalog(this.#t.value.selection.floorId==="current")}}#i(){this.#u?.dispose(),this.#u=null,this.#r?.dispose(),this.#r=null,this.#o=null}#_(e){if(!this.#r)return;let n={version:4,view:e.view,appearance:e.appearance,labels:e.labelsVisible,quality:e.quality,cameras:e.cameras},r=JSON.stringify(n);r!==this.#d&&(this.#d=r,this.#r.schedulePreferences(n))}willUpdate(e){if(e.has("hass")||e.has("panel")||e.has("entryOverride")){let n=e.get("hass"),r=e.has("hass")&&n?.connection!==this.hass?.connection,o=this.#e.project(this.hass,this.panel,this.entryOverride),a=o!==this.#n;if(a){this.#n=o;let i=o.host.connected?o.host.robotCount===0?"unavailable":o.host.administrator?"verifying":"blocked":"degraded";this.#t.replace({...this.#t.value,coherence:i,activity:o.activity,batteryPercent:o.batteryPercent,host:o.host,fullMap:o.host.administrator&&o.host.robotCount>0&&this.#t.value.fullMap,robotLabel:o.robotLabel,robots:o.robots,locale:o.language})}!this._classic&&r?(this.#i(),this.#f()):!this._classic&&(a||e.has("panel")||e.has("entryOverride"))&&this.#r?.sync(o,this.panel)}e.has("narrow")&&this.#t.value.narrowHint!==this.narrow&&this.#t.dispatch({type:"set-narrow-hint",value:this.narrow})}#v(e){if(!fe(e.detail))return;e.stopPropagation();let n=e.detail;if(n.type==="dismiss-top-layer"||n.type==="exit-full-map"){this.#u?.dismissTop()||this.#t.dispatch(n);return}if(n.type==="open-workflow"&&n.workflow!=="none"){this.#r?.openWorkflow(n.workflow);return}if(n.type==="set-floor"){this.#r?.selectFloor(n.floorId);return}if(n.type==="select-entry"){if(!this._workspace.robots.some(r=>r.entryId===n.entryId))return;this.entryOverride=n.entryId;return}if(n.type==="set-history"){this.#r?.selectHistory(n.historyId);return}if(n.type==="select-plan"){this.#r?.selectPlan(n.planId);return}if(n.type==="select-area"){this.#r?.selectArea(n.areaId),n.workflow==="areaReview"&&this.#r?.openWorkflow("areaReview");return}this.#t.dispatch(n)}#g(e){if(e.stopPropagation(),typeof e.detail?.id=="string"){if(e.detail.id==="use-classic"){at("v3")&&(this.#i(),this._classic=!0);return}e.detail.id==="reset-room-cadence"&&"planId"in e.detail&&"roomId"in e.detail&&"mode"in e.detail?this.#r?.executeAction(e.detail):this.#r?.executeAction(e.detail.id),this.dispatchEvent(new CustomEvent("matic-map-v4-action-requested",{detail:{id:e.detail.id},bubbles:!0,composed:!0}))}}#p(){at("v4")&&(this._classic=!1,this.#f(),this.requestUpdate())}updated(){if(!this._classic)return;let e=this.renderRoot.querySelector("matic-map-panel-v0-3-1");e&&(e.hass=this.hass,e.narrow=this.narrow,e.route=this.route,e.panel=this.panel)}getWorkspaceSnapshot(){return this.#t.value}render(){return this._classic?b`
        <div class="classic">
          <button class="return-v4" type="button" @click=${this.#p}>${z(this.hass?.localize,"v4_use_new","Use Map Studio 0.4")}</button>
          <matic-map-panel-v0-3-1></matic-map-panel-v0-3-1>
        </div>
      `:b`
      <${Mn}
        .state=${this._workspace}
        .localize=${this.hass?.localize}
        @matic-workspace-intent=${this.#v}
        @matic-workspace-action=${this.#g}
      ></${Mn}>
    `}};customElements.get(Xe)||customElements.define(Xe,pt);export{ke as a,J as b,b as c,pt as d};
/*! Bundled license information:

lit-html/static.js:
  (**
   * @license
   * Copyright 2020 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/
