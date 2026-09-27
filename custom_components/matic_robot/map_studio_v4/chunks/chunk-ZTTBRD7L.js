import{a as we,b as se,c as ie,d as ae,e as Je,f as At,g as zt,h as Wt,i as Ht,j as ce,k as rt}from"./chunk-BVU35OR2.js";import{A as xt,B as Pt,C as Ct,G as j,H as be,I as Mt,J as Et,L as _,N as Y,O as X,P as G,Q as _e,R as le,S as ke,T as It,U as $t,V as Tt,W as Se,X as Lt,Y as Ot,c as re,d as Ve,e as je,f as Ye,h as ye,i as V,l as D,m as _t,n as Xe,o as Ge,oa as Dt,pa as Ze,q as kt,qa as et,r as St,ra as qt,sa as tt,ta as nt,u as oe,ua as Nt,va as Q,wa as A,x as Qe,xa as z,y as ge,z as Rt}from"./chunk-IKRUJEMU.js";var Dn=(s,t)=>{if(t?.recharge_and_resume===!0&&t?.charging===!0)return"recharging";switch(s){case"cleaning":return"cleaning";case"paused":return"paused";case"returning":return"returning";case"docked":return"docked";case"idle":return"idle";case"error":return"problem";default:return"unknown"}},qn=s=>typeof s!="number"||!Number.isFinite(s)?null:Math.round(Math.max(0,Math.min(100,s))),Nn=s=>{let t=s.attributes?.matic_entry_id;return typeof t=="string"&&t.length>0?t:null},zn=s=>String(s||"local-user").replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",Ft=s=>{if(typeof s!="string")return"Matic robot";let t=s.trim();return t&&Array.from(t).length<=128&&!/[\u0000-\u001f\u007f]/u.test(t)?t:"Matic robot"},Re=class{#e="";#t=null;project(t,e,n=null){let r=t?.states??{},o=e?.config?.entry_id,i=typeof o=="string"?o:null,a=null,l=null,c=null,d=new Map;for(let[g,M]of Object.entries(r)){let x=Nn(M);if(!x||!g.startsWith("vacuum."))continue;d.set(x,{entryId:x,label:Ft(M.attributes?.friendly_name)});let O=n||i;(!a||O&&x===O)&&(a=M,l=g,c=x)}let u={connected:t?.connected!==!1,administrator:t?.user?.is_admin===!0,robotConnected:a!==null&&a.state!=="unavailable"&&a.state!=="unknown",robotCount:d.size},p=a?Dn(a.state,a.attributes):"unknown",h=qn(a?.attributes?.battery_level),v=t?.selectedLanguage||t?.language||"en",y=zn(t?.user?.id),w=Ft(a?.attributes?.friendly_name),k=[...d.values()].sort((g,M)=>g.label.localeCompare(M.label,v,{sensitivity:"base"})),S=[u.connected,u.administrator,u.robotConnected,u.robotCount,p,h??"none",v,y,l??"none",c??"none",w,k.map(g=>`${g.entryId}:${g.label}`).join(",")].join("|");return S===this.#e&&this.#t?this.#t:(this.#e=S,this.#t={host:u,activity:p,batteryPercent:h,language:v,userKey:y,vacuumEntityId:l,entryKey:c,robotLabel:w,robots:k},this.#t)}};var Bt=Symbol.for(""),Wn=s=>{if(s?.r===Bt)return s?._$litStatic$},J=s=>({_$litStatic$:s,r:Bt});var Kt=new Map,ot=s=>(t,...e)=>{let n=e.length,r,o,i=[],a=[],l,c=0,d=!1;for(;c<n;){for(l=t[c];c<n&&(o=e[c],(r=Wn(o))!==void 0);)l+=r+t[++c],d=!0;c!==n&&a.push(o),i.push(l),c++}if(c===n&&i.push(t[n]),d){let u=i.join("$$lit$$");(t=Kt.get(u))===void 0&&(i.raw=i,Kt.set(u,t=i)),e=a}return s(t,...e)},b=ot(be),_r=ot(Mt),kr=ot(Et);var Ut="/api/matic_robot/slam_entries",Ce=24,Vt=8,it=15e5,jt=16*1024*1024,m=class extends Error{constructor(t){super(t),this.name="ContractError",this.code=t}},C=(s,t)=>{if(!s||typeof s!="object"||Array.isArray(s))throw new m(t);return s},R=(s,t,e)=>{if(typeof s!="string")throw new m(e);let n=s.trim();if(!n||Array.from(n).length>t||/[\u0000-\u001f\u007f]/u.test(n))throw new m(e);return n},Hn=s=>{if(s==null||s==="")return null;try{return R(s,128,"invalid-floor-label")}catch{return null}},Z=(s,t,e,n)=>{if(typeof s!="number"||!Number.isFinite(s)||s<t||s>e)throw new m(n);return s},I=(s,t,e,n)=>{let r=Z(s,t,e,n);if(!Number.isInteger(r))throw new m(n);return r},st=(s,t)=>s==null?null:I(s,1,t,"invalid-floor-ordinal"),P=(s,t)=>{if(typeof s!="boolean")throw new m(t);return s},xe=(s,t)=>s===void 0?!1:P(s,t),Fn=(s,t)=>s===null?null:P(s,t),Yt=s=>{if(s==null)return null;let t=R(s,64,"invalid-map-session-key");if(!/^[0-9a-f]{64}$/u.test(t))throw new m("invalid-map-session-key");return t},Kn=s=>{if(s==null)return null;if(s==="bootstrap_empty"||s==="map_session_unverified"||s==="floor_plan_unavailable"||s==="floor_plan_mismatch")return s;throw new m("invalid-map-block-reason")},Bn=s=>{if(s===void 0)return"not_started";if(s==="not_started"||s==="running"||s==="complete"||s==="partial"||s==="failed")return s;throw new m("invalid-bootstrap-state")},W=(s,t)=>{let e=R(s,512,t);if(!e.startsWith("/")||e.startsWith("//")||e.includes("\\"))throw new m(t);return e},Un=s=>{let t=typeof s.map_health=="string"?s.map_health.toLowerCase():"",e=typeof s.stream_state=="string"?s.stream_state.toLowerCase():"",n=typeof s.invalid_tiles=="number"?s.invalid_tiles:0;return t.includes("error")||t.includes("fail")||t.includes("degrad")||n>0?"problem":s.map_truncated===!0||t.includes("truncat")||t.includes("limit")?"limited":s.map_complete===!0?"ready":e.includes("connect")||e.includes("collect")||e.includes("run")?"building":"unknown"},Me=s=>{let t=C(s,"invalid-catalog");if(!Array.isArray(t.entries)||t.entries.length>64)throw new m("invalid-catalog-entries");return t.entries.map(e=>{let n=C(e,"invalid-catalog-entry"),r=I(n.map_revision,0,Number.MAX_SAFE_INTEGER,"invalid-map-revision");return{entryId:R(n.entry_id,128,"invalid-entry-id"),sceneUrl:W(n.scene_url,"invalid-scene-url"),deltaUrl:n.delta_url===void 0||n.delta_url===null?null:W(n.delta_url,"invalid-delta-url"),poseUrl:W(n.pose_url,"invalid-pose-url"),historyUrl:W(n.history_url,"invalid-history-url"),areasUrl:W(n.areas_url,"invalid-areas-url"),plansUrl:W(n.plans_url,"invalid-plans-url"),mapRevision:r,mapFloorCoherent:P(n.map_floor_coherent,"invalid-floor-coherence"),mapSessionVerified:P(n.map_session_verified,"invalid-session-state"),mapSessionKey:Yt(n.map_session_key),mapBlockReason:Kn(n.map_block_reason),runnerLocked:P(n.runner_locked,"invalid-runner-lock"),stopSettlePending:P(n.stop_settle_pending,"invalid-stop-settle"),activePlan:P(n.active_plan,"invalid-active-plan"),nativeReconciliationPending:P(n.native_reconciliation_pending,"invalid-native-reconciliation"),nativeSessionActive:Fn(n.native_session_active,"invalid-native-session"),mapComplete:P(n.map_complete,"invalid-map-complete"),mapTruncated:P(n.map_truncated,"invalid-map-truncated"),selectedFloorOrdinal:st(n.selected_floor_ordinal,128),mapFloorOrdinal:st(n.map_floor_ordinal,128),historyCount:I(n.history_count,0,12,"invalid-history-count"),historyFloorCount:I(n.history_floor_count,0,128,"invalid-floor-count"),health:Un(n),streamFailures:I(n.stream_failures,0,Number.MAX_SAFE_INTEGER,"invalid-stream-failures"),bootstrapState:Bn(n.bootstrap_state),bootstrapPhotoSeen:n.bootstrap_photo_seen===void 0?!1:P(n.bootstrap_photo_seen,"invalid-bootstrap-photo"),bootstrapStructureSeen:n.bootstrap_structure_seen===void 0?!1:P(n.bootstrap_structure_seen,"invalid-bootstrap-structure"),bootstrapFailures:n.bootstrap_failures===void 0?0:I(n.bootstrap_failures,0,2,"invalid-bootstrap-failures")}})},Xt=(s,t)=>{if(!Array.isArray(s)||s.length!==2)throw new m(t);return[Z(s[0],-1e6,1e6,t),Z(s[1],-1e6,1e6,t)]},Vn=(s,t)=>{if(!Array.isArray(s)||s.length<3||s.length>8192)throw new m(t);return s.map(e=>Xt(e,t))},Gt=(s,t)=>{if(!Array.isArray(s)||s.length>256)throw new m("invalid-rooms");return s.map(e=>{let n=C(e,"invalid-room");return{roomId:R(n.room_id,128,"invalid-room-id"),name:R(n.name,128,"invalid-room-name"),boundary:t?Vn(n.boundary,"invalid-room-boundary"):[]}})},jn=s=>{let t=C(s,"invalid-history-snapshot"),e=R(t.created_at,64,"invalid-history-time");if(!Number.isFinite(Date.parse(e)))throw new m("invalid-history-time");return{id:R(t.id,128,"invalid-history-id"),createdAt:e,revision:I(t.revision,0,Number.MAX_SAFE_INTEGER,"invalid-history-revision"),pointCount:I(t.point_count,1,it,"invalid-history-points"),sceneUrl:W(t.scene_url,"invalid-history-scene-url")}},Qt=s=>{let t=C(s,"invalid-history");if(!Array.isArray(t.floors)||t.floors.length<1||t.floors.length>128)throw new m("invalid-history-floors");return{entryId:R(t.entry_id,128,"invalid-history-entry"),liveAvailable:P(t.live_available,"invalid-history-live"),floors:t.floors.map(e=>{let n=C(e,"invalid-history-floor");if(!Array.isArray(n.snapshots)||n.snapshots.length>12)throw new m("invalid-history-snapshots");return{id:R(n.id,128,"invalid-history-floor-id"),active:P(n.active,"invalid-history-floor-active"),readOnly:P(n.read_only,"invalid-history-floor-read-only"),liveAvailable:n.live_available===void 0?!1:P(n.live_available,"invalid-history-floor-live"),label:Hn(n.label),ordinal:n.ordinal===void 0?null:st(n.ordinal,128),snapshots:n.snapshots.map(jn)}})}},Ee=s=>{if(s==="vacuum"||s==="mop"||s==="vacuum_and_mop")return s;throw new m("invalid-cleaning-mode")},de=s=>{if(s==="quick"||s==="standard"||s==="heavy_duty")return s;throw new m("invalid-coverage-setting")},Pe=(s,t)=>s==null?null:I(s,1,100,t),Ae=s=>{if(s==null)return[];let t=["mop_due","coverage_due","room_not_on_current_map","identity_changed","shared_schedule_unavailable","invalid_cadence_policy"];if(!Array.isArray(s)||s.length>t.length||s.some(e=>!t.includes(e)))throw new m("invalid-cadence-reasons");return[...new Set(s)]},Jt=s=>{if(s==null)return;let t=C(s,"invalid-room-cadence"),e=t.scope===void 0?"plan":t.scope;if(e!=="plan"&&e!=="shared")throw new m("invalid-room-cadence-scope");let n=t.periodic_coverage_setting;return{scope:e,mopEveryN:Pe(t.mop_every_n,"invalid-mop-interval"),coverageEveryN:Pe(t.coverage_every_n,"invalid-coverage-interval"),periodicCoverageSetting:n==null?null:de(n),doMopNext:xe(t.do_mop_next,"invalid-do-mop-next"),doCoverageNext:xe(t.do_coverage_next,"invalid-do-coverage-next")}},at=(s,t)=>{if(s==null)return;let e=C(s,"invalid-room-cadence-progress"),n=e.effective_cleaning_mode,r=e.effective_coverage_setting,o=Ae(t??e.cadence_reasons);return{mopProgress:I(e.mop_progress??0,0,100,"invalid-mop-progress"),coverageProgress:I(e.coverage_progress??0,0,100,"invalid-coverage-progress"),mopDue:xe(e.mop_due,"invalid-mop-due"),coverageDue:xe(e.coverage_due,"invalid-coverage-due"),nextMopIn:Pe(e.next_mop_in,"invalid-next-mop"),nextCoverageIn:Pe(e.next_coverage_in,"invalid-next-coverage"),reasons:o,...n===void 0?{}:{effectiveCleaningMode:Ee(n)},...r===void 0?{}:{effectiveCoverageSetting:de(r)}}},Yn=s=>{let t=C(s,"invalid-plan-room"),e=Jt(t.cadence),n=at(t.cadence_progress,t.cadence_reasons),r=Ae(t.cadence_reasons);return{roomId:R(t.room_id,128,"invalid-plan-room-id"),cleaningMode:Ee(t.cleaning_mode),coverageSetting:de(t.coverage_setting),...e===void 0?{}:{cadence:e},...n===void 0?{}:{cadenceProgress:n},...r.length?{cadenceReasons:r}:{}}},Zt=s=>{if(s==null)return;let t=C(s,"invalid-plan-preview");if(!Array.isArray(t.rooms)||t.rooms.length>100||!Array.isArray(t.mission_boundaries)||t.mission_boundaries.length>99)throw new m("invalid-plan-preview");let e=t.rooms.map(a=>{let l=C(a,"invalid-plan-preview-room");return{roomId:R(l.room_id,128,"invalid-plan-preview-room-id"),name:R(l.name,128,"invalid-plan-preview-room-name"),cleaningMode:Ee(l.cleaning_mode),coverageSetting:de(l.coverage_setting),cadenceReasons:Ae(l.cadence_reasons)}}),n=t.mission_boundaries.map(a=>I(a,1,Math.max(1,e.length-1),"invalid-plan-preview-boundary"));if(n.some((a,l)=>a>=e.length||a<=(n[l-1]??0)))throw new m("invalid-plan-preview-boundary-order");let r=["cadence_identity_unavailable","preview_unavailable","plan_disabled","plan_has_no_rooms","plan_room_limit","cadence_identity_changed","shared_schedule_unavailable","invalid_cadence_policy","invalid_plan"],o=t.blocker;if(o!==null&&!r.includes(o))throw new m("invalid-plan-preview-blocker");if(o===null&&e.length===0)throw new m("empty-plan-preview");let i=t.preview_token;if(i!==void 0&&(typeof i!="string"||!/^[0-9a-f]{64}$/u.test(i)))throw new m("invalid-plan-preview-token");return{rooms:e,missionBoundaries:n,blocker:o,...typeof i=="string"?{previewToken:i}:{}}},en=s=>{let t=C(s,"invalid-room-sequence-preview"),e=R(t.entry_id,128,"invalid-room-sequence-preview-entry"),n=R(t.floor_token,128,"invalid-room-sequence-preview-floor"),r=R(t.preview_token,64,"invalid-room-sequence-preview-token");if(!/^[0-9a-f]{64}$/u.test(n)||!/^[0-9a-f]{64}$/u.test(r))throw new m("invalid-room-sequence-preview-token");let o=Zt({rooms:t.rooms,mission_boundaries:t.mission_boundaries,blocker:t.blocker});if(!o)throw new m("invalid-room-sequence-preview");let i=t.rooms;if(!Array.isArray(i))throw new m("invalid-room-sequence-preview-rooms");let a=o.rooms.map((l,c)=>{let d=C(i[c],"invalid-room-sequence-preview-room"),u=at(d.cadence_progress,d.cadence_reasons);return{...l,...u===void 0?{}:{cadenceProgress:u}}});return{entryId:e,floorToken:n,previewToken:r,rooms:a,missionBoundaries:o.missionBoundaries,blocker:o.blocker}},Xn=s=>{if(s==null)return null;if(!Array.isArray(s)||s.length<3||s.length>64)throw new m("invalid-area-outline");let t={closed:!0,points:s.map(e=>{let n=C(e,"invalid-area-outline");if(typeof n.x!="number"||typeof n.y!="number")throw new m("invalid-area-outline");return{x:n.x,y:n.y}})};if(!At(t))throw new m("invalid-area-outline");return t},Gn=s=>{let t=C(s,"invalid-area-circle");return{x:Z(t.x,-1e6,1e6,"invalid-area-circle"),y:Z(t.y,-1e6,1e6,"invalid-area-circle"),radius:Z(t.radius,.05,2.5,"invalid-area-circle")}},Qn=s=>s==="current"||s==="review"||s==="stale"?s:"unknown",tn=s=>{let t=C(s,"invalid-areas");if(!Array.isArray(t.areas)||t.areas.length>256)throw new m("invalid-area-list");return{sceneUrl:W(t.scene_url,"invalid-area-scene-url"),rooms:Gt(t.rooms,!0),areas:t.areas.map(e=>{let n=C(e,"invalid-area");if(!Array.isArray(n.circles)||n.circles.length>512)throw new m("invalid-area-circles");return{id:R(n.id,128,"invalid-area-id"),name:R(n.name,128,"invalid-area-name"),circles:n.circles.map(Gn),outline:Xn(n.outline),cleaningMode:Ee(n.cleaning_mode),coverageSetting:de(n.coverage_setting),status:Qn(n.status),canRebind:P(n.can_rebind,"invalid-area-rebind")}})}},nn=s=>{let t=C(s,"invalid-plans");if(!Array.isArray(t.plans)||t.plans.length>256)throw new m("invalid-plan-list");let e=t.rooms;return{rooms:Gt(e,!1).map((r,o)=>{let i=Array.isArray(e)?e[o]:void 0,a=C(i,"invalid-room"),l=Jt(a.shared_cadence),c=at(a.shared_cadence_progress,a.shared_cadence_reasons),d=Ae(a.shared_cadence_reasons);return{roomId:r.roomId,name:r.name,...l===void 0?{}:{sharedCadence:l},...c===void 0?{}:{sharedCadenceProgress:c},...d.length?{sharedCadenceReasons:d}:{}}}),selectedPlan:t.selected_plan===null||t.selected_plan===void 0?null:R(t.selected_plan,128,"invalid-selected-plan"),plans:t.plans.map(r=>{let o=C(r,"invalid-plan");if(!Array.isArray(o.rooms)||o.rooms.length>256||!Array.isArray(o.room_order))throw new m("invalid-plan-rooms");let i=o.run_behavior;if(i!=="intelligent"&&i!=="ordered")throw new m("invalid-run-behavior");let a=Zt(o.next_run_preview);return{id:R(o.id,128,"invalid-plan-id"),name:R(o.name,128,"invalid-plan-name"),enabled:P(o.enabled,"invalid-plan-enabled"),runBehavior:i,rooms:o.rooms.map(l=>Yn(l)),roomOrder:o.room_order.slice(0,256).map(l=>R(l,128,"invalid-room-order")),returnToBase:P(o.return_to_base,"invalid-return-to-base"),finishCurrentRoom:P(o.finish_current_room,"invalid-finish-room"),finishCurrentRoomThreshold:I(o.finish_current_room_threshold,0,100,"invalid-finish-threshold"),...a===void 0?{}:{nextRunPreview:a}}})}},rn=s=>{let t=C(s,"invalid-pose"),e=t.position,n=e===null?null:Xt(e,"invalid-pose-position"),r=t.pose_freshness;if(r!=="live"&&r!=="coordinator_fallback")throw new m("invalid-pose-freshness");return{position:n,source:R(t.source,64,"invalid-pose-source"),revision:I(t.revision,0,Number.MAX_SAFE_INTEGER,"invalid-pose-revision"),poseRevision:I(t.pose_revision,0,Number.MAX_SAFE_INTEGER,"invalid-pose-sequence"),floorCoherent:P(t.map_floor_coherent,"invalid-pose-floor"),mapSessionKey:Yt(t.map_session_key),freshness:r}},on=s=>{try{return W(s,"invalid-private-path"),!0}catch{return!1}};var sn=s=>{let o=()=>{throw new Error("invalid-scene")};(!(s instanceof ArrayBuffer)||s.byteLength<24||s.byteLength>16777216)&&o();let i=new DataView(s),a=new Uint8Array(s,0,8),l=String.fromCharCode(...a),c=i.getUint16(8,!0),d=i.getUint16(10,!0),u=i.getUint32(12,!0),p=i.getUint32(16,!0),h=i.getUint32(20,!0),v=p+h,y=24+u;(l!=="MATIC3D\0"||c!==1||d!==8||u>1024*1024||v<1||v>15e5||y+v*d!==s.byteLength)&&o();let w;try{w=JSON.parse(new TextDecoder("utf-8",{fatal:!0}).decode(new Uint8Array(s,24,u)))}catch{o()}(!w||typeof w!="object"||Array.isArray(w))&&o();let k=w,S=k.meters_per_cell,g=k.origin_cells,M=k.span_cells;(typeof S!="number"||!Number.isFinite(S)||S<.001||S>.1||!Array.isArray(g)||g.length!==2||!g.every(T=>typeof T=="number"&&Number.isFinite(T))||!Array.isArray(M)||M.length!==2||!M.every(T=>typeof T=="number"&&Number.isFinite(T)&&T>=1&&T<=65536))&&o();let O=(Array.isArray(k.rooms)?k.rooms.slice(0,128):[]).flatMap((T,On)=>{if(!T||typeof T!="object"||Array.isArray(T))return[];let B=T,ve=typeof B.name=="string"?B.name.trim():"";if(!ve||Array.from(ve).length>128||/[\u0000-\u001f\u007f]/u.test(ve))return[];if(!Array.isArray(B.boundary)||B.boundary.length<3||B.boundary.length>8192)return[];let wt=B.boundary.flatMap(Ke=>{if(!Array.isArray(Ke)||Ke.length!==2)return[];let[Be,Ue]=Ke;return typeof Be=="number"&&Number.isFinite(Be)&&typeof Ue=="number"&&Number.isFinite(Ue)?[[Be,Ue]]:[]}),We=B.center;if(wt.length<3||!Array.isArray(We)||We.length!==2)return[];let[He,Fe]=We;return typeof He!="number"||!Number.isFinite(He)||typeof Fe!="number"||!Number.isFinite(Fe)?[]:[{id:`scene-room-${On+1}`,name:ve,boundary:wt,center:[He,Fe]}]}),Ln=typeof k.sample_step=="number"&&Number.isInteger(k.sample_step)?Math.max(1,Math.min(15e5,k.sample_step)):1,gt=g,bt=M;return{buffer:s,pointOffset:y,floorCount:p,surfaceCount:h,total:v,metadata:{metersPerCell:S,origin:[gt[0],gt[1]],span:[bt[0],bt[1]],sampleStep:Ln,rooms:O}}},Jn=s=>{if(s.byteLength>jt||s.byteLength<Ce||Vt!==8||it!==15e5)throw new m("invalid-scene");try{return sn(s)}catch{throw new m("invalid-scene")}},Zn=()=>`
  const parseTransfer = ${sn.toString()};
  self.onmessage = (event) => {
    const { id, buffer } = event.data;
    try {
      const parsed = parseTransfer(buffer);
      self.postMessage({ id, ok: true, parsed }, [parsed.buffer]);
    } catch (_) {
      self.postMessage({ id, ok: false, problem: "invalid-scene" });
    }
  };
`,Ie=class{#e=null;#t=null;#n=0;#s=new Map;constructor(){if(!(typeof Worker!="function"||typeof URL?.createObjectURL!="function"))try{this.#t=URL.createObjectURL(new Blob([Zn()],{type:"text/javascript"})),this.#e=new Worker(this.#t),this.#e.onmessage=t=>{let e=this.#s.get(t.data.id);e&&(this.#s.delete(t.data.id),t.data.ok&&t.data.parsed?e.resolve(t.data.parsed):e.reject(new m(t.data.problem||"invalid-scene")))},this.#e.onerror=()=>this.#o("scene-worker-failed")}catch{this.#e=null,this.#t&&URL.revokeObjectURL(this.#t),this.#t=null}}async parse(t,e){if(e?.aborted)throw new DOMException("Aborted","AbortError");if(!this.#e){if(await new Promise(r=>window.setTimeout(r,0)),e?.aborted)throw new DOMException("Aborted","AbortError");return Jn(t)}let n=++this.#n;return new Promise((r,o)=>{let i=()=>{this.#s.delete(n),o(new DOMException("Aborted","AbortError"))};e?.addEventListener("abort",i,{once:!0}),this.#s.set(n,{resolve:a=>{e?.removeEventListener("abort",i),r(a)},reject:a=>{e?.removeEventListener("abort",i),o(a)}}),this.#e?.postMessage({id:n,buffer:t},[t])})}#o(t){for(let e of this.#s.values())e.reject(new m(t));this.#s.clear(),this.#e?.terminate(),this.#e=null}dispose(){this.#o("scene-parser-disposed"),this.#t&&URL.revokeObjectURL(this.#t),this.#t=null}};var q={catalog:1e4,scene:6e4,delta:35e3,pose:1e4,history:15e3,workflow:15e3,mutation:2e4,roomPreview:15e3},er=2,ue=new WeakMap,E=class extends Error{constructor(t,e=null){super(t),this.name="BackendError",this.code=t,this.status=e}},he=36,ee=16*1024*1024,an=(s,t)=>{let e=Number(s);if(!Number.isSafeInteger(e)||e<0)throw new m(t);return e},ln=(s,t)=>{let e=s.headers.get("X-Matic-Revision");if(e===null)return t;let n=Number(e);if(!Number.isSafeInteger(n)||n<0)throw new m("invalid-scene-revision");return n},cn=(s,t)=>{let e=s.headers.get("X-Matic-Floor-Coherent");if(e===null)return t;if(e==="1")return!0;if(e==="0")return!1;throw new m("invalid-scene-floor-header")},$e=class{#e;#t=new Ie;#n=new WeakMap;constructor(t){this.#e=t}async#s(t,e){let n=t.body?.getReader();if(!n)return new ArrayBuffer(0);let r=()=>{n.cancel().catch(()=>{})};e.addEventListener("abort",r,{once:!0});try{if(e.aborted)throw r(),new DOMException("Aborted","AbortError");let o=[],i=0;for(;;){let c=await n.read();if(e.aborted)throw new DOMException("Aborted","AbortError");if(c.done)break;o.push(c.value),i+=c.value.byteLength}let a=new Uint8Array(i),l=0;for(let c of o)a.set(c,l),l+=c.byteLength;return a.buffer}finally{e.removeEventListener("abort",r),n.releaseLock()}}async#o(t,e,n,r,o){if(!on(t))throw new E("invalid-private-path");if(r?.aborted)throw new DOMException("Aborted","AbortError");let i=new AbortController,a=()=>{},l=new Promise((p,h)=>{a=h}),c=()=>{i.abort(),a(new DOMException("Aborted","AbortError"))};r?.addEventListener("abort",c,{once:!0});let d=!1,u=window.setTimeout(()=>{d=!0,c()},n);try{let p=this.#e(),h=new Headers(e.headers),v={...e,cache:"no-store",credentials:"same-origin",headers:Object.fromEntries(h.entries()),signal:i.signal},y=async()=>{let w;if(typeof p?.fetchWithAuth=="function")w=await p.fetchWithAuth(t,v);else{let k=p?.auth?.accessToken||p?.auth?.data?.access_token;k&&h.set("Authorization",`Bearer ${k}`);let S=typeof p?.hassUrl=="function"?p.hassUrl(t):t;w=await fetch(S,{...v,headers:h})}try{if(i.signal.aborted)throw new DOMException("Aborted","AbortError");return await o(w,i.signal)}finally{w.body&&!w.body.locked&&w.body.cancel().catch(()=>{})}};return await Promise.race([y(),l])}catch(p){throw d&&!r?.aborted?new E("request-timeout"):i.signal.aborted?new DOMException("Aborted","AbortError"):p}finally{window.clearTimeout(u),r?.removeEventListener("abort",c)}}async#r(t,e,n,r={}){return this.#o(t,{...r,headers:{Accept:"application/json",...r.headers||{}}},e,n,async(o,i)=>{if(!o.ok){let a=o.headers.get("X-Matic-Plans-Conflict");throw new E(a==="map-rechecking"?"map-rechecking":"request-failed",o.status)}try{return JSON.parse(new TextDecoder().decode(await this.#s(o,i)))}catch{throw new m("invalid-json-response")}})}async catalog(t){return Me(await this.#r(Ut,q.catalog,t))}async scene(t,e,n,r,o,i){let a=new Headers({Accept:"application/vnd.matic.slam-scene"});return r==="live"&&a.set("X-Matic-Prefer-Cached","1"),i&&a.set("If-None-Match",i),this.#o(t,{headers:a},q.scene,o,async(l,c)=>{let d=ln(l,e),u=cn(l,n);if(l.status===304)return{scene:null,floorCoherent:u,revision:d,notModified:!0};if(!l.ok)throw new E("scene-request-failed",l.status);if(l.headers.get("Content-Type")?.split(";",1)[0]!=="application/vnd.matic.slam-scene")throw new m("invalid-scene-content-type");return{scene:{...await this.#t.parse(await this.#s(l,c),c),revision:d,etag:l.headers.get("ETag"),source:r},floorCoherent:u,revision:d,notModified:!1}})}async#d(t,e,n){if(!Number.isSafeInteger(e)||e<1||e>ee||typeof DecompressionStream!="function")throw new m("invalid-scene-delta");let o=new Blob([t]).stream().pipeThrough(new DecompressionStream("deflate")).getReader(),i=new Uint8Array(e),a=0,l=()=>{o.cancel()};n?.addEventListener("abort",l,{once:!0});try{for(;;){if(n?.aborted)throw new DOMException("Aborted","AbortError");let{done:c,value:d}=await o.read();if(c)break;if(!(d instanceof Uint8Array)||a+d.byteLength>e)throw new m("invalid-scene-delta");i.set(d,a),a+=d.byteLength}}finally{n?.removeEventListener("abort",l),o.releaseLock()}if(a!==e)throw new m("invalid-scene-delta");return i}async#u(t,e,n){if(t.byteLength<he||t.byteLength>he+ee||e.buffer.byteLength>ee)throw new m("invalid-scene-delta");let r=new DataView(t),o=new TextDecoder().decode(new Uint8Array(t,0,8)),i=r.getUint16(8,!0),a=r.getUint16(10,!0),l=an(r.getBigUint64(12,!0),"invalid-scene-delta"),c=an(r.getBigUint64(20,!0),"invalid-scene-delta"),d=r.getUint32(28,!0),u=r.getUint32(32,!0);if(o!=="MATICDLT"||i!==1||a!==1||l!==e.revision||c<=e.revision||d<Ce||d>ee||u>ee||u+he!==t.byteLength)throw new m("invalid-scene-delta");let p=new Uint8Array(t,he,u),h=new Uint8Array(e.buffer),y=(await this.#d(p,Math.max(h.byteLength,d),n)).slice(),w=1024*1024;for(let g=0;g<h.byteLength;g+=w){if(n?.aborted)throw new DOMException("Aborted","AbortError");let M=Math.min(h.byteLength,g+w);for(let x=g;x<M;x+=1)y[x]=(y[x]??0)^(h[x]??0);M<h.byteLength&&await new Promise(x=>window.setTimeout(x,0))}let k=y.slice(0,d).buffer;return{parsed:{...await this.#t.parse(k,n),revision:c,etag:null,source:"live"},revision:c}}async sceneDelta(t,e,n,r){let o=t.includes("?")?"&":"?";return this.#o(`${t}${o}since=${encodeURIComponent(e.revision)}`,{headers:{Accept:"application/vnd.matic.slam-delta, application/vnd.matic.slam-scene"}},q.delta,r,async(i,a)=>{let l=ln(i,e.revision),c=cn(i,n);if(i.status===204){if(l!==e.revision)throw new m("invalid-scene-delta-revision");return{scene:null,floorCoherent:c,revision:l,notModified:!0}}if(!i.ok)throw new E("delta-request-failed",i.status);if(l<=e.revision)throw new m("invalid-scene-delta-revision");let d=Number(i.headers.get("Content-Length"));if(Number.isFinite(d)&&d>he+ee)throw new m("invalid-scene-delta-size");let u=i.headers.get("Content-Type")?.split(";",1)[0],p=await this.#s(i,a);if(u==="application/vnd.matic.slam-delta"){let v=Number(i.headers.get("X-Matic-Base-Revision"));if(!Number.isSafeInteger(v)||v!==e.revision)throw new m("invalid-scene-delta-base");let y=await this.#u(p,e,a);if(y.revision!==l)throw new m("invalid-scene-delta-revision");return{scene:{...y.parsed,etag:i.headers.get("ETag")},floorCoherent:c,revision:l,notModified:!1}}if(u!=="application/vnd.matic.slam-scene")throw new m("invalid-scene-delta-content-type");return{scene:{...await this.#t.parse(p,a),revision:l,etag:i.headers.get("ETag"),source:"live"},floorCoherent:c,revision:l,notModified:!1}})}async pose(t,e){return rn(await this.#r(t,q.pose,e))}async history(t,e){return Qt(await this.#r(t,q.history,e))}async plans(t,e){return nn(await this.#r(t,q.workflow,e))}async areas(t,e){return tn(await this.#r(t,q.workflow,e))}async previewRoomSequence(t,e,n,r){if(!t||t.length>255||e.length<1||e.length>100)throw new m("invalid-room-sequence-preview-request");if(r?.aborted)throw new DOMException("Aborted","AbortError");let o=this.#e()?.connection;if(!o?.sendMessagePromise)throw new E("preview-unavailable");let i=null,a=()=>{},l=new Promise((k,S)=>{a=S}),c=this.#n.get(o),d,u=new Promise(k=>{d=k});this.#n.set(o,u);let p=!1,h=()=>{p||(p=!0,d(),this.#n.get(o)===u&&this.#n.delete(o))},v=!1,y=()=>{a(new DOMException("Aborted","AbortError")),v&&(h(),i!==null&&window.clearTimeout(i),i=null)};r?.addEventListener("abort",y,{once:!0});let w=new Promise((k,S)=>{i=window.setTimeout(()=>{i=null,S(new E("preview-timeout"))},q.roomPreview)});w.catch(()=>{v&&h()});try{if(c&&(await Promise.race([c,l,w]),r?.aborted))throw new DOMException("Aborted","AbortError");let k=ue.get(o)??0;if(k>=er)throw new E("preview-unavailable");let S=o.sendMessagePromise({type:"call_service",domain:"matic_robot",service:"preview_room_sequence",target:{entity_id:t},service_data:{rooms:e.map(O=>({room:O.room,cleaning_mode:O.cleaning_mode,coverage_setting:O.coverage_setting})),use_room_schedule:!0,override_room_schedule:n},return_response:!0});ue.set(o,k+1),v=!0;let g=!1,M=()=>{if(!g){g=!0;let O=(ue.get(o)??1)-1;O===0?ue.delete(o):ue.set(o,O)}h(),i!==null&&window.clearTimeout(i),i=null};S.then(M,M);let x=await Promise.race([S,l,w]);if(r?.aborted)throw new DOMException("Aborted","AbortError");if(!x||typeof x!="object"||Array.isArray(x)||!("response"in x))throw new m("invalid-room-sequence-preview-envelope");return en(x.response)}finally{v||(c?c.then(h,h):h(),i!==null&&window.clearTimeout(i),i=null),r?.removeEventListener("abort",y)}}async saveArea(t,e,n){let r=await this.#r(t,q.mutation,n,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...e.areaId?{area_id:e.areaId}:{},name:e.name,circles:e.circles,...e.outline?.closed?{outline:e.outline.points}:{},cleaning_mode:e.cleaningMode,coverage_setting:e.coverageSetting})});if(!r||typeof r!="object"||typeof r.id!="string")throw new m("invalid-area-save-response");return r.id}async deleteArea(t,e,n){await this.#o(`${t}?area_id=${encodeURIComponent(e)}`,{method:"DELETE",headers:{Accept:"application/json"}},q.mutation,n,async r=>{if(!r.ok)throw new E("area-delete-failed",r.status)})}async service(t,e,n,r){let o=this.#e();if(typeof o?.callService!="function")throw new E("service-unavailable");await o.callService(t,e,n,{entity_id:r})}dispose(){this.#t.dispose()}};var un=()=>({version:4,view:"top",appearance:"photo",labels:!0,quality:"auto",cameras:{}}),pe=(s,t,e)=>Math.max(t,Math.min(e,s)),hn=s=>s.replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",lt=(s,t=4)=>`matic-map-studio:v${t}:${hn(s)}`,tr=s=>{if(!s||typeof s!="object")return null;let t=s;return["yaw","pitch","zoom","targetX","targetZ"].every(n=>typeof t[n]=="number"&&Number.isFinite(t[n]))?{yaw:pe(t.yaw,-Math.PI,Math.PI),pitch:pe(t.pitch,.18,Math.PI/2-.018),zoom:pe(t.zoom,.01,100),targetX:pe(t.targetX,-1e4,1e4),targetZ:pe(t.targetZ,-1e4,1e4)}:null},dn=s=>{let t=un();if(!s||typeof s!="object")return t;let e=s,n=e.view==="three"||e.view==="top"||e.view==="rooms"?e.view:t.view,r=n==="rooms"?"top":n,o=e.quality==="auto"||e.quality==="efficient"||e.quality==="balanced"||e.quality==="maximum"?e.quality:t.quality,i=e.cameras&&typeof e.cameras=="object"?e.cameras:{},a={};for(let l of["three","top"]){let c=tr(i[l]);c&&(a[l]=c)}return{version:4,view:r,appearance:e.appearance==="rooms"||e.appearance==="photo"?e.appearance:t.appearance,labels:typeof e.labels=="boolean"?e.labels:t.labels,quality:o,cameras:a}},Te=class{#e="local-user";#t=null;#n=null;load(t){this.#s(),this.#e=hn(t);try{let e=window.localStorage.getItem(lt(this.#e));if(e)return dn(JSON.parse(e));for(let n of[3,2]){let r=window.localStorage.getItem(lt(this.#e,n));if(r)return dn(JSON.parse(r))}}catch{}return un()}schedule(t){this.#t!==null&&window.clearTimeout(this.#t),this.#n={key:lt(this.#e),value:t},this.#t=window.setTimeout(()=>this.#s(),250)}#s(){this.#t!==null&&window.clearTimeout(this.#t),this.#t=null;let t=this.#n;if(this.#n=null,!!t)try{window.localStorage.setItem(t.key,JSON.stringify(t.value))}catch{}}dispose(){this.#s()}},pn="matic-map-studio:preferred-frontend",mn=()=>{try{return window.localStorage.getItem(pn)==="v3"?"v3":"v4"}catch{return"v4"}},ct=s=>{try{return window.localStorage.setItem(pn,s),!0}catch{return!1}};var ut=1,te=Number.MAX_SAFE_INTEGER,bn=Number.MAX_SAFE_INTEGER,fn=64,dt=4,vn=16*1024,nr=250,rr=4e3,yn=3e4;function L(s){return s!==null&&typeof s=="object"&&!Array.isArray(s)?s:null}function F(s,t){return typeof s=="number"&&Number.isSafeInteger(s)&&s>=0&&s<=t}function wn(s){let t=L(s);if(!t)return null;let e={};for(let[n,r]of Object.entries(t)){if(n.length===0||n.length>128||!F(r,bn))return null;e[n]=r}return e}function or(s){let t=L(s);if(!t||Object.keys(t).length>128)return null;let e={};for(let[n,r]of Object.entries(t)){if(n.length===0||n.length>128||!F(r,bn))return null;e[n]=r}return e}function _n(s){return typeof s=="string"&&s.length>0&&s.length<=256?s:F(s,te)?String(s):null}function sr(s){let t=L(s),e=_n(t?.epoch);if(!t||t.schema!==ut||e===null)return null;let n=or(t.capabilities),r=wn(t.revisions);return!n||!r||!F(t.sequence,te)||!F(t.coherence_generation,te)||t.coherence_generation===0?null:{schema:t.schema,capabilities:n,epoch:e,sequence:t.sequence,coherence_generation:t.coherence_generation,revisions:r}}function gn(s,t){let e=L(s),n=sr(e?.snapshot??s);if(!n)return null;let r=L(e?.snapshot??s);if(!r||!("payload"in r))return null;let o=r.entry_id,i=L(r.identity),a=L(r.status),l=L(r.payload),c=a?a.reason===null?null:kn(a.reason):null,d=l?.available,u=null;if(l?.entry!==void 0&&l.entry!==null){if((()=>{try{return JSON.stringify(l.entry).length}catch{return vn+1}})()>vn)return null;try{u=Me({entries:[l.entry]})[0]??null}catch{return null}}let p=a?.state;return typeof o!="string"||o.length===0||o.length>128||t!==void 0&&o!==t||!i||i.entry_id!==o||i.floor_mission_id!==null&&!F(i.floor_mission_id,te)||typeof i.floor_verified!="boolean"||i.floor_verified!==(i.floor_mission_id!==null)||!a||p!=="ready"&&p!=="stale"&&p!=="unavailable"||a.reason!==null&&c===null||typeof a.retryable!="boolean"||typeof d!="boolean"||u!==null&&u.entryId!==o||p==="ready"&&(c!==null||a.retryable||!d)||(p==="stale"||p==="unavailable")&&(c===null||d)||c==="authorization"&&a.retryable?null:{...n,entry_id:o,identity:{entry_id:o,floor_mission_id:i.floor_mission_id,floor_verified:i.floor_verified},status:{state:p,reason:c,retryable:a.retryable},payload:{available:d,entry:u}}}function ir(s){let t=L(s),e=_n(t?.epoch),n=wn(t?.revisions),r=t?.resources;return e===null||!n||!F(t?.sequence,te)||!F(t?.coherence_generation,te)||t.coherence_generation===0||!Array.isArray(r)||r.length>128||!r.every(o=>typeof o=="string"&&o.length<=128)?null:{epoch:e,sequence:t.sequence,coherence_generation:t.coherence_generation,revisions:n,resources:r}}var ar=["gap","overflow","reconnect","invalid_message","server_request","restart","entry_removed","authorization","snapshot_required"];function kn(s){return typeof s=="string"&&ar.includes(s)?s:null}var Le=class{#e;#t;#n;#s=null;#o=!1;#r=!1;#d=!1;#u=!1;#m=0;#c=!1;#g=!1;#R=!1;#x=!1;#l=null;#b=null;#i=0;#E=!1;#p=null;#v=-1;#w=new Map;#L=!1;#a=!1;#k=null;#h=[];constructor(t,e){this.#e=t,this.#t=e,this.#n=Math.max(1,Math.min(fn,e.maxPendingInvalidations??fn))}async start(){if(!(this.#o||this.#a)){this.#a=!0;try{await this.#$(!1)}catch(t){this.#z(t),this.#y("reconnect")}}}notifyReconnect(){this.#i=0,this.#c=!1,this.#u=!1,this.#l!==null&&window.clearTimeout(this.#l),this.#l=null,this.requestResync("reconnect"),this.#d&&this.#C(0,!0)}requestResync(t="server_request"){this.#y(t,!0)}dispose(){this.#o||(this.#o=!0,this.#l!==null&&window.clearTimeout(this.#l),this.#l=null,this.#d=!1,this.#s?.(),this.#s=null,this.#w.clear(),this.#h=[])}#A(t){if(this.#o)return;let e=L(t),n=L(e?.event)??e,r=n?.type;if(r==="resync"){let i=kn(n?.reason);if(!i){this.#y("invalid_message");return}if(i==="entry_removed"){this.#t.onEvent({type:"resync",reason:i}),this.dispose();return}this.#y(i);return}let o=r==="snapshot"?gn(n?.snapshot??n,this.#t.entryId):r==="invalidate"?ir(n?.invalidation??n):null;if(!o){this.#y("invalid_message");return}if(r==="snapshot"){let i=o;if(this.#d)return;if(this.#p!==null&&i.epoch!==this.#p){this.#y("restart");return}this.#f(i);return}this.#M(o)}#f(t){this.#p===t.epoch&&t.sequence<this.#v||(this.#p=t.epoch,this.#v=t.sequence,this.#w.clear(),this.#t.onEvent({type:"snapshot",snapshot:t}))}#I(t){let e=this.#h;if(this.#h=[],this.#f(t),this.#o)return;let n=t.sequence+1;for(let r of e)if(r.epoch===t.epoch&&!(r.sequence<=t.sequence)&&!(r.sequence<n)){if(r.sequence!==n){this.#h=e.filter(o=>o.epoch===t.epoch&&o.sequence>=n),this.#y("gap");return}this.#M(r),n+=1}}#M(t){if(this.#d){this.#P(t);return}if(this.#p===null){this.#P(t);return}if(this.#p!==t.epoch){this.#P(t),this.#y("reconnect");return}if(!(t.sequence<=this.#v)){if(t.sequence!==this.#v+1){this.#P(t),this.#y("gap");return}this.#v=t.sequence;for(let e of t.resources)this.#w.set(e,t);if(this.#w.size>this.#n){this.#w.clear(),this.#y("overflow");return}this.#L||(this.#L=!0,queueMicrotask(()=>this.#H()))}}#P(t){this.#h.length>=this.#n?(this.#h=[],this.#E=!0,this.#y("overflow")):this.#h.push(t)}#H(){if(this.#L=!1,this.#o||this.#w.size===0)return;let t=[...this.#w.values()];this.#w.clear();let e=t.reduce((r,o)=>!r||o.sequence>r.sequence?o:r,null);if(!e)return;let n=[...new Set(t.flatMap(r=>r.resources))];this.#t.onEvent({type:"invalidation",invalidation:{...e,resources:n}})}#y(t,e=!1){if(!this.#o){if(t==="authorization"){this.#D(),this.#t.onEvent({type:"resync",reason:t});return}if(!this.#u&&(this.#r||(this.#r=!0,this.#t.onEvent({type:"resync",reason:t}),queueMicrotask(()=>{this.#r=!1})),t!=="entry_removed")){let n=e&&!this.#c;if(n&&(this.#c=!0),n&&this.#l!==null&&(window.clearTimeout(this.#l),this.#l=null),this.#R){if(this.#x){n&&this.#C(0,!0);return}this.#x=!0,this.#O(n);return}if(e&&this.#d){n&&(this.#g=!0);return}let r=this.#i>=dt?yn:0;this.#C(n?0:r,n)}}}#C(t,e=!1){if(!this.#o){if(this.#l!==null){if(!e)return;window.clearTimeout(this.#l),this.#l=null}if(this.#d){this.#b=e?t:Math.max(this.#b??0,t);return}this.#l=window.setTimeout(()=>{this.#l=null,this.#$(!0)},t)}}#O(t=!1){let e=this.#i>=dt?yn:Math.min(nr*2**this.#i,rr);this.#i<dt&&(this.#i+=1),this.#C(t?0:e,t)}async#$(t){if(this.#o||this.#d)return;let e=this.#m;this.#d=!0;try{if(t&&await this.#N(),this.#o||this.#u||e!==this.#m)return;let n=await this.#e.sendMessagePromise({type:"matic_robot/workspace_snapshot",version:ut,entry_id:this.#t.entryId});if(this.#o||this.#u||e!==this.#m)return;let r=gn(n,this.#t.entryId);if(!r)throw new Error("invalid-workspace-snapshot");if(r.status.reason==="authorization"){this.#D(),this.#t.onEvent({type:"snapshot",snapshot:r});return}if(r.status.state!=="ready"&&r.status.retryable)throw new Error("workspace-snapshot-retryable");this.#d=!1,this.#R=!0,this.#x=!1;try{t?this.#X(r):this.#I(r)}finally{this.#R=!1}this.#x?this.#g&&(this.#g=!1,this.#C(0,!0)):(this.#i=0,this.#c=!1,this.#g=!1),!t&&!this.#o&&await this.#N(),this.#E&&(this.#E=!1,this.#y("overflow"))}catch(n){if(this.#o||this.#u||e!==this.#m)return;if(this.#z(n),this.#G(n))this.#D(),this.#t.onEvent({type:"resync",reason:"authorization"});else{let r=this.#g;this.#g=!1,this.#O(r)}}finally{this.#d=!1;let n=this.#b;this.#b=null,n!==null&&this.#C(n)}}async#N(){if(this.#o||this.#s)return;if(this.#k)return this.#k;let t=(async()=>{let e=await this.#e.subscribeMessage(n=>this.#A(n),{type:"matic_robot/workspace_subscribe",version:ut,entry_id:this.#t.entryId});this.#o?e():this.#s=e})();this.#k=t;try{await t}finally{this.#k===t&&(this.#k=null)}}#X(t){let e=this.#h;if(this.#h=[],this.#p===t.epoch&&t.sequence<this.#v){this.#h=e,this.#y("snapshot_required");return}if(this.#f(t),this.#o)return;let n=t.sequence+1;for(let r of e)if(r.epoch===t.epoch&&!(r.sequence<=t.sequence)&&!(r.sequence<n)){if(r.sequence!==n){this.#h=e.filter(o=>o.sequence>=n),this.#y("gap");return}this.#M(r),n+=1}}#G(t){let e=L(t),n=e?.code,r=e?.status??e?.statusCode;return n==="unauthorized"||n==="not_authorized"||n==="auth_invalid"||r===401||r===403}#D(){this.#m+=1,this.#u=!0,this.#l!==null&&window.clearTimeout(this.#l),this.#l=null,this.#h=[],this.#E=!1,this.#b=null,this.#i=0,this.#c=!1,this.#g=!1}#z(t){this.#t.onError?.(t instanceof Error?t:new Error("Workspace transport failed"))}};var lr=!1,f=(s,t,e=null)=>({status:s,value:t,problem:e}),$=s=>s instanceof DOMException&&s.name==="AbortError",H=(s,t)=>s instanceof E||s&&typeof s=="object"&&"code"in s&&typeof s.code=="string"?s.code:t,me=s=>[s.selectedFloorOrdinal??"none",s.mapFloorOrdinal??"none",s.mapFloorCoherent?"coherent":"transition"].join(":"),fe=s=>[s.mapFloorOrdinal??"none",s.mapSessionVerified?"verified":"unverified",s.mapSessionKey??"no-session"].join(":"),N=s=>[s.entryId,s.selectedFloorOrdinal??"none",s.mapFloorOrdinal??"none"].join("|"),U=s=>[s.entryId,me(s),fe(s),s.mapRevision].join("|"),ht=s=>s.runnerLocked||s.stopSettlePending||s.activePlan||s.nativeReconciliationPending||s.nativeSessionActive===!0,Oe=(s,t)=>s.entryKey===t.entryKey&&s.generation===t.generation&&s.floorKey===t.floorKey&&s.missionKey===t.missionKey,ne="Live map updates paused while the current map is rechecked.",Sn="Saved map from ",pt="Reconnecting. The last verified map remains read only.",cr=1e3,dr=["rooms","plans","plan","draw","areaReview"],Rn=s=>JSON.stringify({...s,previewToken:void 0}),De=(s,t)=>s.label?s.label:s.active?"Current floor":`Saved floor ${s.ordinal??t}`,qe=class{#e;#t=new St;#n;#s=new Te;#o=new Map;#r=null;#d;#u=null;#m=null;#c=null;#g=0;#R=!1;#x=!1;#l=!1;#b=!1;#i=Promise.resolve();#E=!1;#p=!1;#v="";#w=0;#L="";#a=!1;#k=!0;#h=null;#A=null;#f=null;#I=null;#M="";#P=!1;#H;#y;constructor(t,e,n=null,r=lr){this.#e=t,this.#n=e,this.#H=n,this.#y=r,this.#I=t.subscribe(()=>this.#N())}#C(t){let e=_t(t),n=t.resources.entry,r=this.#r?.vacuumEntityId;if(!e||!n||!r||!t.selection.entryId||t.workflow!=="rooms"||t.dataMode!=="live"||t.floor.readOnly||t.coherence!=="current"||!t.host.connected||!t.host.administrator||!t.host.robotConnected||t.command!=="idle"||t.resources.plans.status!=="ready")return null;let o=t.selection.roomIds.map(i=>{let a=t.selection.roomSettings.find(l=>l.roomId===i);return a?{room:i,cleaning_mode:a.cleaningMode,coverage_setting:a.coverageSetting}:null});return o.some(i=>i===null)?null:{key:e,generation:t.generation,retryRevision:t.manualRoomPreviewRetry,floorKey:me(n),missionKey:fe(n),entryId:t.selection.entryId,entityId:r,rooms:o,overrideRoomSchedule:!t.selection.useRoomSchedule}}#O(t){return JSON.stringify([t.key,t.generation,t.retryRevision,t.floorKey,t.missionKey,t.entryId,t.entityId])}#$(t){let e=this.#C(this.#e.value);return!this.#a&&e!==null&&this.#O(e)===this.#O(t)}#N(){if(this.#a||!this.#r)return;let t=this.#e.value,e=this.#C(t);if(!e){this.#o.get("room-preview")?.abort(),this.#o.delete("room-preview"),this.#M="",(t.manualRoomPreview.status!=="idle"||t.manualRoomPreview.value!==null)&&this.#e.patch({manualRoomPreview:f("idle",null)});return}let n=this.#O(e),r=Xe(t);if(r&&r.key===e.key&&r.generation===e.generation&&r.floorKey===e.floorKey&&r.missionKey===e.missionKey&&r.preview.entryId===e.entryId){this.#M=n;return}if(this.#M===n)return;this.#o.get("room-preview")?.abort(),this.#M=n;let o=this.#_("room-preview");this.#e.patch({manualRoomPreview:f("loading",null)}),this.#X(e,o)}async#X(t,e){try{let n=await this.#n.previewRoomSequence(t.entityId,t.rooms,t.overrideRoomSchedule,e.signal);return!this.#$(t)||e.signal.aborted||n.entryId!==t.entryId?null:(this.#e.patch({manualRoomPreview:f("ready",{key:t.key,generation:t.generation,floorKey:t.floorKey,missionKey:t.missionKey,preview:n})}),n)}catch(n){return $(n)||e.signal.aborted||!this.#$(t)||this.#e.patch({manualRoomPreview:f("error",null,H(n,"preview-unavailable"))}),null}finally{this.#S("room-preview",e)}}sync(t,e){if(this.#a)return;let n=this.#e.value.owner;n&&(n.entryKey!==t.entryKey||n.userKey!==t.userKey)&&(this.#F("context-changed"),this.#R&&(this.#l=!0,this.#b=!1));let r=this.#k;if(this.#k=t.host.connected,this.#r=t,this.#d=e,this.#G(t),this.#e.patch({owner:{userKey:t.userKey,entryKey:t.entryKey},host:t.host,activity:t.activity,batteryPercent:t.batteryPercent,robotLabel:t.robotLabel,robots:t.robots,locale:t.language}),t.userKey!==this.#L){this.#L=t.userKey;let o=this.#s.load(t.userKey);this.#e.patch({view:o.view,appearance:o.appearance,labelsVisible:o.labels,quality:o.quality,cameras:o.cameras})}if(!t.host.administrator){this.#U(),this.#F("access-required");return}if(!t.host.connected){this.#U(),this.#l=!1,this.#b=!1,this.#p=!1,this.#q();let o=this.#e.value,i=o.resources.scene.value;this.#e.patch({coherence:i?"degraded":"unavailable",resources:{...o.resources,catalog:o.resources.catalog.status==="loading"?f("idle",o.resources.catalog.value):o.resources.catalog,plans:o.resources.plans.status==="loading"?f("idle",o.resources.plans.value):o.resources.plans,areas:o.resources.areas.status==="loading"?f("idle",o.resources.areas.value):o.resources.areas,pose:f("idle",null)},map:{...o.map,available:i!==null,exactPose:!1},notice:i?{tone:"warning",text:pt}:o.notice});return}if(t.host.robotCount===0){this.#U(),this.#F("map-unavailable");return}if(this.#ee(),!r){this.#e.value.notice?.text===pt&&this.#e.patch({notice:null}),this.refreshCatalog(!0);return}(this.#e.value.resources.catalog.status==="idle"||t.entryKey&&t.entryKey!==this.#e.value.selection.entryId)&&this.refreshCatalog(!0)}#G(t){let e=t.entryKey;if(!this.#y||!this.#H||!t.host.administrator||!t.host.connected||!e){this.#h?.dispose(),this.#h=null,this.#A=null,this.#f=null;return}if(this.#h&&this.#A===e)return;this.#h?.dispose(),this.#f=null;let n=new Le(this.#H,{entryId:e,onEvent:r=>{if(!(this.#a||this.#h!==n||this.#A!==e||this.#r?.entryKey!==e)){if(r.type==="resync"&&r.reason==="entry_removed"){n.dispose(),this.#h===n&&(this.#h=null,this.#A=null,this.#f=null);return}if(r.type==="snapshot"){let{snapshot:o}=r,i=this.#e.value.resources.entry,a=o.payload.entry;if(o.entry_id!==e||o.identity.entry_id!==e)return;if(a&&(a.entryId!==e||o.identity.floor_verified!==(a.mapFloorCoherent&&a.mapSessionVerified))){n.requestResync("invalid_message");return}let l=!a&&i?.entryId===e&&o.identity.floor_verified!==(i.mapFloorCoherent&&i.mapSessionVerified);if(o.status.reason==="authorization"){this.#f=null;return}let c=this.#f,d=[],u=c!==null&&c.epoch!==o.epoch;if(c&&c.epoch===o.epoch){let y=new Set([...Object.keys(c.revisions),...Object.keys(o.revisions)]),w=[...y].some(k=>(o.revisions[k]??-1)<(c.revisions[k]??-1));if(o.coherence_generation<c.coherenceGeneration||o.coherence_generation===c.coherenceGeneration&&w){n.requestResync("restart");return}d=[...y].filter(k=>(o.revisions[k]??-1)>(c.revisions[k]??-1))}u&&(d=["plans","areas","history"]);let p=c!==null&&(c.epoch!==o.epoch||c.coherenceGeneration!==o.coherence_generation),h=!!(i&&a&&i.entryId===e&&U(i)!==U(a));if(this.#f={entryId:o.entry_id,epoch:o.epoch,sequence:o.sequence,coherenceGeneration:o.coherence_generation,revisions:o.revisions},l){this.#B(e,["plans","areas","history"]);return}if(p||h){this.#B(e,d);return}let v=a!==null&&i?.entryId===e&&this.#z(a);if(c&&d.length){if(o.sequence<=c.sequence){n.requestResync("invalid_message");return}this.#f=c,this.#D({epoch:o.epoch,sequence:o.sequence,coherence_generation:o.coherence_generation,revisions:o.revisions,resources:d},e,n,v)}return}if(r.type==="resync"){this.#f=null,r.reason!=="authorization"&&this.#B(e,["plans","areas","history"]);return}this.#D(r.invalidation,e,n)}},onError:()=>this.#e.patch({notice:{tone:"warning",text:pt}})});this.#h=n,this.#A=e,n.start()}#D(t,e,n,r=!1){let o=this.#f;if(!o||o.entryId!==e||this.#h!==n||t.epoch!==o.epoch||t.sequence<=o.sequence)return;let i=t.coherence_generation!==o.coherenceGeneration,l=[...new Set([...Object.keys(o.revisions),...Object.keys(t.revisions)])].some(h=>(t.revisions[h]??-1)<(o.revisions[h]??-1));if(t.coherence_generation<o.coherenceGeneration||!i&&l){n.requestResync("restart");return}let c=new Set(t.resources),d=[...c].some(h=>(t.revisions[h]??-1)>(o.revisions[h]??-1));if(this.#f={...o,sequence:t.sequence,coherenceGeneration:t.coherence_generation,revisions:t.revisions},!d&&!i)return;if(i||c.has("scene")){this.#B(e,t.resources);return}let u=this.#e.value.resources.entry,p=this.#t.current();!u||u.entryId!==e||!p||this.#Z(u,p,c,!r)}#z(t){let e=this.#e.value,n=e.resources.entry;if(!n||U(n)!==U(t))return!1;let r=e.resources.catalog,o=r.value?.map(l=>l.entryId===t.entryId?t:l),i=t.mapFloorCoherent&&t.mapSessionVerified,a=t.health==="problem"||t.health==="limited";return this.#e.patch({managedLock:ht(t),coherence:i?a?"degraded":"current":"verifying",map:{...e.map,available:e.resources.scene.value!==null,complete:t.mapComplete&&!t.mapTruncated,floorCoherent:t.mapFloorCoherent,sessionVerified:t.mapSessionVerified,exactPose:i?e.map.exactPose:!1},floor:{...e.floor,classifiedCount:Math.max(1,t.historyFloorCount)},resources:{...e.resources,entry:t,...o?{catalog:{...r,value:o}}:{}}}),!0}#oe(){let t=this.#t.invalidate(),e=this.#e.value;this.#e.patch({generation:t,coherence:e.resources.scene.value?"verifying":"unavailable",map:{...e.map,exactPose:!1}}),this.#q(["catalog"]),this.#v=""}#B(t,e=[]){this.#oe(),this.refreshCatalog(!0,!0).then(()=>{if(this.#a||this.#r?.entryKey!==t||!this.#r.host.administrator||!this.#r.host.connected)return;let n=this.#e.value.resources.entry,r=this.#t.current();if(!n||n.entryId!==t||!r)return;let o=new Set(e);o.delete("history"),this.#Z(n,r,o,!1)})}#Z(t,e,n,r=!0){(n.has("plans")||n.has("plan_state"))&&this.loadPlans(),n.has("areas")&&this.loadAreas(),n.has("history")&&this.#V(t,e),r&&["status","robot_state","activity","plan_state"].some(o=>n.has(o))&&this.refreshCatalog(!0,!0,!0)}schedulePreferences(t){this.#s.schedule(t)}#ee(){this.#u===null&&(this.#u=window.setInterval(()=>{document.visibilityState==="visible"&&this.refreshCatalog()},5e3)),this.#m===null&&(this.#m=window.setInterval(()=>{document.visibilityState==="visible"&&this.refreshPose()},cr))}#U(){this.#u!==null&&window.clearInterval(this.#u),this.#m!==null&&window.clearInterval(this.#m),this.#u=null,this.#m=null}#_(t){this.#o.get(t)?.abort();let e=new AbortController;return this.#o.set(t,e),e}#S(t,e){this.#o.get(t)===e&&this.#o.delete(t)}#q(t=[]){let e=!1;for(let[n,r]of this.#o)t.includes(n)||(e||=n==="plan-mutation"||n==="area-mutation",r.abort(),this.#o.delete(n));e&&this.#e.value.command==="pending"&&this.#e.patch({command:"idle",notice:null})}#W(){this.#g+=1,this.#c!==null&&window.clearTimeout(this.#c),this.#c=null}#F(t){this.#W(),this.#q(),this.#t.invalidate(),this.#v="";let e=this.#e.value,n=D();this.#e.patch({command:"idle",dataMode:n.dataMode,floor:n.floor,managedLock:!1,workflow:"none",dialog:null,notice:null,draftFloorOrdinal:null,draw:n.draw,planDraft:n.planDraft,areaDraft:n.areaDraft,generation:this.#t.generation,coherence:e.host.administrator?"unavailable":"blocked",fullMap:!1,precisionOpen:!1,resources:{catalog:f("error",null,t),entry:null,scene:f("idle",null),pose:f("idle",null),history:f("idle",null),plans:f("idle",null),areas:f("idle",null)},manualRoomPreview:f("idle",null),map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1},selection:{...n.selection,entryId:null,floorId:"current",historyId:null}})}async refreshCatalog(t=!1,e=!1,n=!1){if(this.#a||!this.#r?.host.administrator||!this.#r.host.connected||this.#r.host.robotCount===0)return;if(this.#R)return t&&(this.#x?e&&(this.#l?this.#b&&=n:this.#b=n,this.#l=!0):(this.#l?this.#b&&=n:this.#b=n,this.#l=!0,this.#o.get("catalog")?.abort())),this.#i;this.#R=!0,this.#x=t;let r;this.#i=new Promise(a=>{r=a});let o=this.#_("catalog"),i=this.#e.value.resources.catalog.value;this.#e.patch({resources:{...this.#e.value.resources,catalog:f("loading",i)}});try{let a=await this.#n.catalog(o.signal);if(o.signal.aborted||this.#a)return;let l=this.#d?.config?.entry_id,c=typeof l=="string"?l:null,d=a.find(h=>h.entryId===this.#r?.entryKey)||a.find(h=>h.entryId===c)||a[0]||null,u=this.#e.value.resources.entry;if(d&&u&&N(d)===N(u)&&me(d)===me(u)&&fe(d)===fe(u)&&(d.mapRevision<u.mapRevision||!t&&this.#o.has("scene"))&&(d={...d,mapRevision:u.mapRevision}),this.#e.patch({managedLock:d?ht(d):!1,resources:{...this.#e.value.resources,catalog:f(a.length?"ready":"empty",a),entry:d}}),!d){this.#F("no-loaded-robot");return}if(this.#e.value.selection.floorId!=="current"&&!t)return;let p=U(d);if((!t||n)&&p===this.#v){let h=this.#e.value,v=d.mapFloorCoherent&&d.mapSessionVerified,y=d.health==="problem"||d.health==="limited";this.#e.patch({coherence:v?y?"degraded":"current":"verifying",map:{...h.map,available:h.resources.scene.value!==null,complete:d.mapComplete&&!d.mapTruncated,floorCoherent:d.mapFloorCoherent,sessionVerified:d.mapSessionVerified,exactPose:v?h.map.exactPose:!1},floor:{...h.floor,classifiedCount:Math.max(1,d.historyFloorCount)}}),v&&this.#e.value.resources.plans.problem==="map-rechecking"&&this.loadPlans(),this.#Y();let w=this.#t.current();w&&!h.resources.scene.value&&!this.#o.has("history")&&this.#V(d,w),v&&w&&(h.resources.scene.status==="error"||h.floor.readOnly)&&!this.#o.has("scene")&&this.#T(d,w);return}this.#v=p,this.#te(d,u)}catch(a){if($(a))return;this.#e.patch({coherence:this.#e.value.resources.scene.value?"degraded":"unavailable",resources:{...this.#e.value.resources,catalog:f("error",i,H(a,"catalog-unavailable"))}})}finally{this.#S("catalog",o),this.#R=!1;let a=this.#l,l=this.#b;this.#x=!1;try{a&&!this.#a&&(this.#l=!1,this.#b=!1,await this.refreshCatalog(!0,!1,l))}finally{r()}}}#te(t,e){let n=this.#e.value,r=!!(e&&N(e)===N(t)),o=t.mapFloorCoherent&&t.mapSessionVerified;this.#q(r?["catalog","plans","areas","plan-mutation","area-mutation"]:["catalog"]);let i=e?.entryId===t.entryId?n.resources.scene.value:null,a=i!==null&&(n.floor.readOnly||!r||!o||e?.mapSessionKey!==t.mapSessionKey),l=n.resources.pose.value,c=r&&o&&t.mapSessionKey!==null&&l?.position&&l.mapSessionKey===t.mapSessionKey?l:null,d=this.#t.begin(t.entryId,me(t),fe(t),t.mapRevision),u=n.draftFloorOrdinal??(e?.mapFloorCoherent&&e.mapSessionVerified?e.mapFloorOrdinal:null),p=n.draftMapSessionKey??(e?.mapFloorCoherent&&e.mapSessionVerified?e.mapSessionKey:null),h=o?t.mapFloorOrdinal:null,v=o?t.mapSessionKey:null,y=e!==null&&e.entryId!==t.entryId||u!==null&&h!==null&&u!==h||p!==null&&v!==null&&p!==v;y&&this.#W();let w=D(),k=t.health==="problem"||t.health==="limited",S=this.#e.value;this.#e.patch({...y?{command:"idle",workflow:"none",dialog:null,precisionOpen:!1,fullMap:!1,draw:w.draw,planDraft:w.planDraft,areaDraft:w.areaDraft,notice:{tone:"info",text:"The active map changed. Choose a task on this map."}}:{},draftFloorOrdinal:h??u,draftMapSessionKey:v??p,managedLock:ht(t),generation:d.generation,coherence:o?k?"degraded":"current":"verifying",dataMode:"live",...!o&&i?{notice:{tone:"warning",text:ne}}:{},resources:{...S.resources,entry:t,scene:f(o?"loading":"idle",i),pose:f(o?"loading":"idle",c),history:f("loading",S.resources.history.value),plans:r?S.resources.plans:f("idle",null),areas:r?S.resources.areas:f("idle",null)},map:{available:i!==null,complete:t.mapComplete&&!t.mapTruncated,floorCoherent:t.mapFloorCoherent,sessionVerified:t.mapSessionVerified,exactPose:o&&c!==null&&!a},floor:{classifiedCount:Math.max(1,t.historyFloorCount),displayName:a?n.floor.displayName:t.selectedFloorOrdinal?`Floor ${t.selectedFloorOrdinal}`:"Current floor",readOnly:a},selection:{...S.selection,entryId:t.entryId,floorId:"current",historyId:null,roomIds:y?[]:S.selection.roomIds,roomSettings:y?[]:S.selection.roomSettings,planId:y?null:S.selection.planId,areaId:y?null:S.selection.areaId}}),this.#V(t,d),o&&this.#e.value.resources.plans.status==="idle"&&this.loadPlans(),this.#Y(),o&&(this.#T(t,d),this.#j(t,d))}async#T(t,e){let n=this.#_("scene");try{let r=await this.#n.scene(t.sceneUrl,t.mapRevision,t.mapFloorCoherent,"live",n.signal);if(!this.#t.accepts(e))return;if(!r.floorCoherent){let c=this.#e.value;this.#e.patch({coherence:"verifying",resources:{...c.resources,scene:f("error",c.resources.scene.value,"map-rechecking"),pose:f("idle",null)},map:{...c.map,available:c.resources.scene.value!==null,floorCoherent:!1,exactPose:!1},floor:{...c.floor,readOnly:c.resources.scene.value!==null},notice:{tone:"warning",text:ne}});return}if(r.revision<e.revision||!r.scene)throw new E("scene-unavailable");let o=r.revision===e.revision?e:this.#t.advance(e,r.revision);if(!o)throw new E("scene-unavailable");let i=this.#e.value,a={...i.resources.entry??t,mapRevision:r.revision};this.#v=U(a),this.#e.patch({resources:{...i.resources,entry:a,scene:f("ready",r.scene)},map:{...i.map,available:!0},floor:{...i.floor,readOnly:!1,displayName:i.resources.history.value?.floors.find(c=>c.active)?.label||(a.selectedFloorOrdinal?`Floor ${a.selectedFloorOrdinal}`:"Current floor")},notice:i.notice?.text===ne||i.notice?.text.startsWith(Sn)?null:i.notice});let l=this.#e.value.resources.plans;if((l.status==="idle"||l.problem==="map-rechecking")&&this.loadPlans(),this.#Y(),t.deltaUrl){let c=++this.#w;this.#Q(a,o,r.scene,c)}}catch(r){if($(r)||!this.#t.accepts(e))return;if(r instanceof E&&r.code==="request-timeout"){let l=this.#e.value;this.#e.patch({resources:{...l.resources,scene:f("loading",l.resources.scene.value,"scene-building")}}),window.setTimeout(()=>{this.#a||!this.#t.accepts(e)||this.#e.value.selection.floorId!=="current"||this.#T(t,e)},250);return}let o=this.#e.value,i=o.resources.pose.value,a=o.resources.scene.value!==null&&t.mapSessionKey!==null&&i?.position!==null&&i?.mapSessionKey===t.mapSessionKey;this.#e.patch({coherence:"degraded",resources:{...o.resources,scene:f("error",o.resources.scene.value,H(r,"scene-unavailable"))},map:{...o.map,available:o.resources.scene.value!==null,exactPose:a}})}finally{this.#S("scene",n)}}async#Q(t,e,n,r){if(!t.deltaUrl||typeof DecompressionStream!="function")return;let o=t.deltaUrl,i=t,a=e,l=n;try{for(;!this.#a&&r===this.#w&&this.#t.accepts(a)&&this.#e.value.selection.floorId==="current";){let c=this.#_("delta");try{let d=await this.#n.sceneDelta(o,l,i.mapFloorCoherent,c.signal);if(c.signal.aborted||this.#a||r!==this.#w||!this.#t.accepts(a))return;if(!d.floorCoherent){let h=this.#e.value;this.#e.patch({coherence:"verifying",map:{...h.map,available:h.resources.scene.value!==null,floorCoherent:!1,exactPose:!1},floor:{...h.floor,readOnly:h.resources.scene.value!==null},resources:{...h.resources,scene:f("error",h.resources.scene.value,"map-rechecking"),pose:f("idle",null)},notice:{tone:"warning",text:ne}}),this.#v="",this.refreshCatalog(!0);return}if(d.notModified||!d.scene){await new Promise(h=>window.setTimeout(h,100));continue}let u=this.#t.advance(a,d.revision);if(!u)return;a=u,l=d.scene,i={...i,mapRevision:d.revision},this.#v=U(i);let p=this.#e.value;this.#e.patch({resources:{...p.resources,entry:i,scene:f("ready",l)},map:{...p.map,available:!0,floorCoherent:!0}}),this.#j(i,a)}finally{this.#S("delta",c)}}}catch(c){if($(c)||this.#a||r!==this.#w||!this.#t.accepts(a))return;this.#e.patch({coherence:"degraded",notice:{tone:"warning",text:ne}}),this.#v="",this.refreshCatalog(!0)}}async#V(t,e){let n=this.#_("history");try{let r=await this.#n.history(t.historyUrl,n.signal),o=this.#t.current();if(n.signal.aborted||!o||!Oe(e,o)||r.entryId!==t.entryId)return;let i=this.#e.value,a=r.floors.find(d=>d.id===i.selection.floorId),l=!i.selection.historyId||a?.snapshots.some(d=>d.id===i.selection.historyId),c=i.dataMode==="live"?r.floors.find(d=>d.active):a;if(this.#e.patch({resources:{...this.#e.value.resources,history:f("ready",r)},floor:{...this.#e.value.floor,classifiedCount:r.floors.length,...c&&!(i.dataMode==="live"&&i.floor.readOnly)?{displayName:De(c,1)}:{}}}),i.dataMode==="live"&&!i.resources.scene.value){let d=r.floors.flatMap(u=>u.snapshots.map(p=>({floor:u,snapshot:p}))).sort((u,p)=>Date.parse(p.snapshot.createdAt)-Date.parse(u.snapshot.createdAt));for(let u of d){let p;try{p=await this.#n.scene(u.snapshot.sceneUrl,u.snapshot.revision,!0,"history",n.signal)}catch(y){if($(y)||n.signal.aborted)return;continue}let h=this.#t.current();if(n.signal.aborted||!h||!Oe(e,h)||this.#e.value.resources.scene.value)return;if(!p.scene)continue;let v=this.#e.value;this.#e.patch({floor:{...v.floor,readOnly:!0,displayName:De(u.floor,1)},resources:{...v.resources,scene:f("ready",p.scene),pose:f("idle",null)},map:{...v.map,available:!0,exactPose:!1},notice:{tone:"warning",text:`${Sn}${new Date(u.snapshot.createdAt).toLocaleString()}. Live position is unavailable.`}});break}}if(i.dataMode==="history"&&(!a||!l)){let d=a||r.floors.find(p=>p.active)||r.floors[0],u=this.selectFloor(d?.id||"current");!this.#a&&i.workflow==="history"&&this.#e.dispatch({type:"open-workflow",workflow:"history"}),await u}}catch(r){let o=this.#t.current();if($(r)||n.signal.aborted||!o||!Oe(e,o))return;this.#e.patch({resources:{...this.#e.value.resources,history:f("error",null,H(r,"history-unavailable"))}})}finally{this.#S("history",n)}}async refreshPose(){let t=this.#e.value.resources.entry,e=this.#t.current();!t||!e||this.#e.value.selection.floorId!=="current"||!t.mapFloorCoherent||!t.mapSessionVerified||await this.#j(t,e)}async#j(t,e){if(this.#a||!this.#k||!this.#r?.host.connected)return;if(this.#E){this.#p=!0;return}this.#E=!0;let n=this.#_("pose");try{let r=await this.#n.pose(t.poseUrl,n.signal),o=this.#t.current(),i=this.#e.value.resources.entry;if(!o||!Oe(e,o)||!i||!this.#e.value.map.floorCoherent||!r.floorCoherent)return;if(r.mapSessionKey===null||r.mapSessionKey!==i.mapSessionKey){this.#e.patch({resources:{...this.#e.value.resources,pose:f("idle",null)},map:{...this.#e.value.map,exactPose:!1}}),this.#v="",this.refreshCatalog(!0);return}let a=this.#e.value,l=a.resources.pose.value,c=!!(a.map.exactPose&&l?.position&&l.mapSessionKey===i.mapSessionKey);if(r.position===null&&c){this.#e.patch({resources:{...a.resources,pose:f("ready",l)}});return}this.#e.patch({resources:{...a.resources,pose:f("ready",r)},map:{...a.map,exactPose:r.position!==null}})}catch(r){if($(r)||!this.#t.accepts(e))return;let o=this.#e.value,i=o.resources.pose.value,a=!!(o.map.exactPose&&i?.position&&i.mapSessionKey===o.resources.entry?.mapSessionKey);this.#e.patch({resources:{...o.resources,pose:f("error",a?i:null,H(r,"pose-unavailable"))},map:{...o.map,exactPose:a}})}finally{if(this.#S("pose",n),this.#E=!1,this.#p&&!this.#a&&this.#k&&this.#r?.host.connected&&this.#r.host.administrator&&this.#r.host.robotCount>0){this.#p=!1;let r=this.#e.value.resources.entry,o=this.#t.current();r&&o&&this.#j(r,o)}else this.#p=!1}}async selectFloor(t){let e=this.#e.value.resources.history.value,n=this.#e.value.resources.entry;if(!e||!n)return;let r=e.floors.find(l=>l.id===t);if(!r&&t!=="current")return;let o=this.#e.value;if(o.workflow==="draw"&&(o.draw.dirty||o.areaDraft.dirty)||o.workflow==="areaReview"&&(o.draw.dirty||o.areaDraft.dirty))return;if(!r||r.active){this.#v="";let l=this.#e.value;this.#e.patch({resources:{...l.resources,plans:f("idle",null),areas:f("idle",null),scene:f("idle",l.resources.scene.value),pose:f("idle",null)},map:{...l.map,available:l.resources.scene.value!==null,exactPose:!1},coherence:"verifying",floor:{...l.floor,readOnly:l.resources.scene.value!==null},notice:l.resources.scene.value?{tone:"warning",text:ne}:l.notice,workflow:"none",precisionOpen:!1}),this.#e.dispatch({type:"set-floor",floorId:"current"}),await this.refreshCatalog(!0);return}let i=r.snapshots.at(-1);this.#q(["catalog"]);let a=this.#t.begin(n.entryId,r.id,i?.id||r.id,i?.revision||0);this.#e.patch({generation:a.generation,coherence:"current",dataMode:"history",floor:{classifiedCount:e.floors.length,displayName:De(r,e.floors.indexOf(r)+1),readOnly:!0},selection:{...this.#e.value.selection,floorId:r.id,historyId:i?.id||null},resources:{...this.#e.value.resources,scene:f(i?"loading":"empty",null),pose:f("idle",null),plans:f("idle",null),areas:f("idle",null)},workflow:"none",precisionOpen:!1,map:{available:!1,complete:!0,floorCoherent:!0,sessionVerified:!0,exactPose:!1}}),i&&await this.#ne(i,a)}async selectHistory(t){let e=this.#e.value.resources.history.value,n=this.#e.value.resources.entry;if(!e||!n)return;if(!t){await this.selectFloor("current");return}let r=e.floors.find(a=>a.snapshots.some(l=>l.id===t)),o=r?.snapshots.find(a=>a.id===t);if(!r||!o)return;let i=this.#t.begin(n.entryId,r.id,o.id,o.revision);this.#q(["catalog"]),this.#e.patch({generation:i.generation,dataMode:"history",floor:{classifiedCount:e.floors.length,displayName:De(r,e.floors.indexOf(r)+1),readOnly:!0},selection:{...this.#e.value.selection,floorId:r.id,historyId:o.id},resources:{...this.#e.value.resources,scene:f("loading",null),pose:f("idle",null)},map:{...this.#e.value.map,available:!1,exactPose:!1}}),await this.#ne(o,i)}async#ne(t,e){let n=this.#_("history-scene");try{let r=await this.#n.scene(t.sceneUrl,t.revision,!0,"history",n.signal);if(!this.#t.accepts(e)||!r.scene)return;this.#e.patch({resources:{...this.#e.value.resources,scene:f("ready",r.scene)},map:{...this.#e.value.map,available:!0,exactPose:!1}})}catch(r){if($(r)||!this.#t.accepts(e))return;this.#e.patch({resources:{...this.#e.value.resources,scene:f("error",null,H(r,"history-scene-unavailable"))}})}finally{this.#S("history-scene",n)}}async openWorkflow(t){let e=this.#e.value;if((e.dataMode==="history"||e.floor.readOnly)&&dr.includes(t))return;let n=this.#e.value.workflow;if(t==="draw"&&n!=="draw"&&n!=="areaReview"&&this.selectArea(null),this.#e.dispatch({type:"open-workflow",workflow:t}),t==="history"){let r=this.#e.value.resources.entry,o=this.#t.current();r&&o&&(this.#e.patch({resources:{...this.#e.value.resources,history:f("loading",this.#e.value.resources.history.value)}}),await this.#V(r,o))}(t==="plans"||t==="plan"||t==="rooms")&&await this.loadPlans(),(t==="draw"||t==="areaReview")&&await this.loadAreas()}async loadPlans(){let t=this.#e.value.resources.entry;if(!t||!this.#t.current()||!Qe(this.#e.value)||this.#e.value.resources.plans.status==="loading")return;let e=N(t),n=this.#_("plans");this.#e.patch({resources:{...this.#e.value.resources,plans:f("loading",null)}});try{let r=await this.#n.plans(t.plansUrl,n.signal),o=this.#e.value.resources.entry;if(n.signal.aborted||this.#a||!o||N(o)!==e)return;if(this.#e.value.planDraft.dirty||this.#e.value.workflow==="plan"){this.#e.patch({resources:{...this.#e.value.resources,plans:f("ready",r)}});return}let i=r.selectedPlan||r.plans[0]?.id||null,a=r.plans.find(l=>l.id===i);this.#e.patch({resources:{...this.#e.value.resources,plans:f("ready",r)},selection:{...this.#e.value.selection,planId:i},planDraft:a?Ge(a):{...this.#e.value.planDraft,id:null,name:"",rooms:[],dirty:!1}})}catch(r){let o=this.#e.value.resources.entry;if($(r)||n.signal.aborted||this.#a||!o||N(o)!==e)return;let i=r instanceof E&&r.code==="map-rechecking"?"map-rechecking":H(r,"plans-unavailable");this.#e.patch({resources:{...this.#e.value.resources,plans:f("error",null,i)}})}finally{this.#S("plans",n)}}selectPlan(t,e=!1){let n=this.#e.value.resources.plans.value?.plans.find(r=>r.id===t);this.#e.patch({workflow:"plan",notice:!e&&this.#e.value.notice?.tone==="success"?null:this.#e.value.notice,selection:{...this.#e.value.selection,planId:t},planDraft:n?Ge(n):{...D().planDraft}})}#Y(){let t=this.#e.value;(t.workflow==="draw"||t.workflow==="areaReview")&&t.resources.areas.status==="idle"&&this.loadAreas()}async loadAreas({reconcileDraft:t=!0}={}){let e=this.#e.value.resources.entry;if(!e||!this.#t.current()||!Qe(this.#e.value))return;let n=N(e),r=this.#_("areas");this.#e.patch({resources:{...this.#e.value.resources,areas:f("loading",null)}});try{let o=await this.#n.areas(e.areasUrl,r.signal),i=this.#e.value.resources.entry;if(r.signal.aborted||this.#a||!i||N(i)!==n)return;if(o.sceneUrl!==i.sceneUrl)throw new E("areas-unavailable");this.#e.patch({resources:{...this.#e.value.resources,areas:f("ready",o)}});let a=this.#e.value.selection.areaId,l=this.#e.value,c=o.areas.some(d=>d.id===a);t&&(!l.draw.dirty&&!l.areaDraft.dirty||a!==null&&!c)&&this.selectArea(c?a:null)}catch(o){let i=this.#e.value.resources.entry;if($(o)||r.signal.aborted||this.#a||!i||N(i)!==n)return;this.#e.patch({resources:{...this.#e.value.resources,areas:f("error",null,H(o,"areas-unavailable"))}})}finally{this.#S("areas",r)}}selectArea(t){let e=this.#e.value.resources.areas.value?.areas.find(r=>r.id===t),n=this.#e.value;this.#e.patch({selection:{...n.selection,areaId:t},areaDraft:e?this.#se(e):{id:null,name:"",cleaningMode:"vacuum",coverageSetting:"standard",status:"new",canRebind:!1,dirty:!1},draw:{...n.draw,circles:e?.circles||[],outline:e?.outline??null,outlineUndo:[],outlineRedo:[],tool:!e||e.outline?"outline":"paint",undo:[],redo:[],dirty:!1,strokeCount:0}})}#se(t){return{id:t.id,name:t.name,cleaningMode:t.cleaningMode,coverageSetting:t.coverageSetting,status:t.status,canRebind:t.canRebind,dirty:!1}}async saveArea(){let t=this.#e.value,e=t.resources.entry,n=t.areaDraft;if(!e||t.command==="pending"||!oe(t)||!n.name.trim()||!t.draw.circles.length)return;let r=this.#_("area-mutation"),o=()=>!this.#a&&!r.signal.aborted;this.#e.patch({command:"pending",notice:{tone:"info",text:"Saving area\u2026"}});try{let i=await this.#n.saveArea(e.areasUrl,{areaId:n.id,name:n.name.trim(),circles:t.draw.circles,outline:t.draw.outline??null,cleaningMode:n.cleaningMode,coverageSetting:n.coverageSetting},r.signal);if(!o())return;let a=this.#e.value,c=a.areaDraft===n&&a.draw.circles===t.draw.circles&&a.draw.outline===t.draw.outline&&a.selection.entryId===t.selection.entryId&&(a.workflow==="draw"||a.workflow==="areaReview")?{...n,id:i,name:n.name.trim(),status:"current",canRebind:!1,dirty:!1}:null;this.#e.patch({command:"idle",notice:{tone:"success",text:"Area saved"},...c?{dialog:a.dialog==="discardDraft"?null:a.dialog,selection:{...a.selection,areaId:i},areaDraft:c,draw:{...a.draw,dirty:!1,strokeCount:0,undo:[],redo:[],outlineUndo:[],outlineRedo:[]}}:{}}),await this.loadAreas({reconcileDraft:!1});let d=this.#e.value;o()&&c&&d.areaDraft===c&&!d.draw.dirty&&(d.workflow==="draw"||d.workflow==="areaReview")&&d.selection.entryId===t.selection.entryId&&d.resources.areas.value?.areas.some(u=>u.id===i)&&this.selectArea(i)}catch(i){if($(i)||!o())return;this.#e.patch({command:"failed",notice:{tone:"error",text:"Area could not be saved"}})}finally{this.#S("area-mutation",r)}}async deleteArea(){let t=this.#e.value.resources.entry,e=this.#e.value.selection.areaId;if(!t||!e||this.#e.value.command==="pending"||!oe(this.#e.value))return;let n=this.#_("area-mutation"),r=()=>!this.#a&&!n.signal.aborted;this.#e.patch({command:"pending",notice:null});try{if(await this.#n.deleteArea(t.areasUrl,e,n.signal),!r())return;this.#e.patch({command:"idle",notice:{tone:"success",text:"Area deleted"}}),await this.loadAreas()}catch(o){!$(o)&&r()&&this.#e.patch({command:"failed",notice:{tone:"error",text:"Area could not be deleted"}})}finally{this.#S("area-mutation",n)}}async savePlan(){let t=this.#e.value,e=t.planDraft,n=t.resources.plans.value;if(!n||!e.name.trim()||!e.rooms.length||!oe(t))return;let r=e.rooms;if(await this.#J("save_plan",{...e.id?{plan_id:e.id}:{},name:e.name.trim(),enabled:e.enabled,run_behavior:e.runBehavior,rooms:r.map(i=>({room:i.roomId,cleaning_mode:i.cleaningMode,coverage_setting:i.coverageSetting,...i.cadence?{cadence:{scope:i.cadence.scope,mop_every_n:i.cadence.mopEveryN,coverage_every_n:i.cadence.coverageEveryN,periodic_coverage_setting:i.cadence.periodicCoverageSetting,do_mop_next:i.cadence.doMopNext,do_coverage_next:i.cadence.doCoverageNext}}:{}})),return_to_base:e.returnToBase,finish_current_room:e.finishCurrentRoom,finish_current_room_threshold:e.finishCurrentRoomThreshold,select:!e.id||n.selectedPlan===e.id},"Plan saved","Plan could not be saved")){let i=this.#e.value.workflow==="plan"&&this.#e.value.planDraft===e?{...e,dirty:!1}:null;if(i&&this.#e.patch({planDraft:i}),await this.loadPlans(),i&&this.#e.value.workflow==="plan"&&this.#e.value.planDraft===i&&this.#e.value.selection.entryId===t.selection.entryId){let a=this.#e.value.resources.plans.value,l=e.id||a?.selectedPlan;l&&a?.plans.some(c=>c.id===l)&&this.selectPlan(l,!0)}}}async deletePlan(){let t=this.#e.value.selection.planId,e=this.#e.value.selection.entryId;if(!t)return;if(await this.#J("delete_plan",{plan:t},"Plan deleted","Plan could not be deleted")){let r=this.#e.value;r.selection.entryId===e&&r.planDraft.id===t&&(this.#e.patch({selection:{...r.selection,planId:null},planDraft:D().planDraft}),r.workflow==="plan"&&this.#e.patch({workflow:"plans",precisionOpen:!1})),await this.loadPlans()}}async executeAction(t){switch(typeof t=="string"?t:t.id){case"recheck-status":{let n=this.#e.value.selection.entryId;await this.refreshCatalog(!0);let r=this.#e.value;!this.#a&&r.selection.entryId===n&&r.resources.catalog.status==="ready"&&r.host.connected&&r.host.robotConnected&&r.coherence==="current"&&r.command==="failed"&&this.#e.patch({command:"idle",notice:{tone:"info",text:"Status refreshed. Review the robot state before trying again."}});return}case"stop":await this.#K("matic_robot","stop_intelligent_cleaning",{include_unmanaged:!0});return;case"resume":await this.#K("vacuum","send_command",{command:"resume"});return;case"run-plan":{let n=this.#e.value,r=n.selection.planId||n.resources.plans.value?.selectedPlan;if(!r||n.workflow!=="plan"||!n.planDraft.enabled||n.resources.plans.status!=="ready"||n.command!=="idle"||!ge(n))return;let o=n.selection.entryId,i=n.generation,a=n.selection.planId,l=n.planDraft,c=n.resources.plans.value?.plans.find(h=>h.id===r)?.nextRunPreview;if(!c||!/^[0-9a-f]{64}$/u.test(c.previewToken??"")){this.#e.patch({notice:{tone:"warning",text:"A verified next-run preview is unavailable. Refresh the saved plan before starting it."}});return}this.#e.patch({command:"pending",notice:null}),await this.loadPlans();let d=this.#e.value,u=()=>{let h=this.#e.value;!this.#a&&h.selection.entryId===o&&h.generation===i&&h.command==="pending"&&this.#e.patch({command:"idle"})};if(this.#a||d.selection.entryId!==o||d.generation!==i||d.workflow!=="plan"||d.selection.planId!==a||(d.selection.planId||d.resources.plans.value?.selectedPlan)!==r||d.planDraft!==l){u();return}if(d.resources.plans.status!=="ready"){u(),this.#e.patch({notice:{tone:"warning",text:"Plan preview could not be refreshed. Check the plan and try again."}});return}let p=d.resources.plans.value?.plans.find(h=>h.id===r)?.nextRunPreview;if(!p||p.blocker||!/^[0-9a-f]{64}$/u.test(p.previewToken??"")){u(),this.#e.patch({notice:{tone:"warning",text:"This plan has no valid next-run preview. Review its rooms and schedule."}});return}if(!c||JSON.stringify(c)!==JSON.stringify(p)){u(),this.#e.patch({notice:{tone:"info",text:"The next-run preview changed. Review the updated settings before starting."}});return}u(),await this.#K("matic_robot","run_selected_plan",{plan:r,preview_token:p.previewToken});return}case"clean-rooms":{await this.#re();return}case"run-area":{let n=this.#e.value.selection.areaId;n&&await this.#K("matic_robot","clean_area",{area:n});return}case"review-area":this.#e.dispatch({type:"open-workflow",workflow:"areaReview"});return;case"save-area":await this.saveArea();return;case"save-plan":await this.savePlan();return;case"delete-plan":await this.deletePlan();return;case"delete-area":await this.deleteArea();return;case"reset-room-cadence":{if(typeof t=="string")return;let n=this.#e.value;if(n.selection.planId!==t.planId||n.planDraft.dirty||n.dataMode!=="live"||n.command!=="idle"||n.activity!=="idle"&&n.activity!=="docked"||!await this.#J("reset_room_cadence",{plan:t.planId,room_id:t.roomId,modes:[t.mode]},t.mode==="mop"?"Mopping progress reset":"Coverage progress reset",t.mode==="mop"?"Mopping progress could not be reset":"Coverage progress could not be reset"))return;await this.loadPlans();let o=this.#e.value;!this.#a&&o.selection.entryId===n.selection.entryId&&o.selection.planId===t.planId&&!o.planDraft.dirty&&this.selectPlan(t.planId,!0);return}}}async#re(){if(this.#P)return;let t=this.#e.value,e=this.#C(t),n=Xe(t);if(!e||!n||n.key!==e.key||n.generation!==e.generation||n.floorKey!==e.floorKey||n.missionKey!==e.missionKey||n.preview.entryId!==e.entryId||n.preview.blocker||n.preview.rooms.length===0)return;this.#P=!0;let r=this.#_("room-preview");this.#M=this.#O(e),this.#e.patch({manualRoomPreview:f("loading",null),notice:null});try{let o=await this.#n.previewRoomSequence(e.entityId,e.rooms,e.overrideRoomSchedule,r.signal);if(r.signal.aborted||!this.#$(e)||o.entryId!==e.entryId)return;let i={key:e.key,generation:e.generation,floorKey:e.floorKey,missionKey:e.missionKey,preview:o};if(o.blocker||o.rooms.length===0){this.#e.patch({manualRoomPreview:f("ready",i),notice:{tone:"warning",text:"The room preview is blocked. Review the current map and schedule before starting."}});return}if(Rn(n.preview)!==Rn(o)){this.#e.patch({manualRoomPreview:f("ready",i),notice:{tone:"info",text:"The room preview changed. Review the updated settings before starting."}});return}if(this.#e.patch({manualRoomPreview:f("ready",i),notice:null}),!this.#$(e)||!ge(this.#e.value))return;await this.#K("matic_robot","clean_room_sequence",{rooms:e.rooms,use_room_schedule:!0,override_room_schedule:e.overrideRoomSchedule,return_to_base:!0,preview_token:o.previewToken})}catch(o){!$(o)&&!r.signal.aborted&&this.#$(e)&&this.#e.patch({manualRoomPreview:f("error",null,H(o,"preview-unavailable")),notice:{tone:"warning",text:"The room preview could not be refreshed. No cleaning was started."}})}finally{this.#S("room-preview",r),this.#P=!1,this.#N()}}async#J(t,e,n,r){let o=this.#r?.vacuumEntityId;if(!o||!oe(this.#e.value)||this.#e.value.command==="pending")return!1;let i=this.#_("plan-mutation"),a=this.#r?.entryKey,l=this.#r?.userKey,c=()=>!this.#a&&!i.signal.aborted&&a===this.#r?.entryKey&&l===this.#r?.userKey;this.#e.patch({command:"pending",notice:{tone:"info",text:"Saving\u2026"}});try{return await this.#n.service("matic_robot",t,e,o),c()?(this.#e.patch({command:"idle",notice:{tone:"success",text:n}}),!0):!1}catch{return c()&&this.#e.patch({command:"failed",notice:{tone:"error",text:r}}),!1}finally{this.#S("plan-mutation",i)}}async#K(t,e,n){let r=this.#e.value,o=this.#r?.vacuumEntityId,i=e==="stop_intelligent_cleaning"||t==="vacuum"&&e==="return_to_base",a=t==="vacuum"&&e==="send_command"&&n.command==="resume";if(!o||r.selection.entryId!==this.#r?.entryKey||(i?!xt(r):a?!Rt(r):!ge(r)))return;let l=++this.#g,c=this.#r?.entryKey,d=()=>!this.#a&&l===this.#g&&c===this.#r?.entryKey,u=i?"settling":"starting";this.#c!==null&&window.clearTimeout(this.#c),this.#c=null,this.#e.patch({command:u,notice:null});try{if(await this.#n.service(t,e,n,o),!d())return;if(t==="matic_robot"&&(e==="clean_room_sequence"||e==="run_selected_plan")){this.#e.patch({command:"idle"}),this.refreshCatalog(!0);return}this.#e.patch({command:u}),this.#c!==null&&window.clearTimeout(this.#c),this.#c=window.setTimeout(()=>{this.#c=null,d()&&this.#e.value.command===u&&this.#e.patch({command:"idle"})},15e3)}catch{if(!d())return;this.#e.patch({command:"failed",notice:{tone:"error",text:"The action could not be confirmed. Check the robot status before trying again."}})}}dispose(){this.#a||(this.#a=!0,this.#I?.(),this.#I=null,this.#e.patch({manualRoomPreview:f("idle",null)}),this.#U(),this.#q(),this.#c!==null&&window.clearTimeout(this.#c),this.#c=null,this.#s.dispose(),this.#h?.dispose(),this.#h=null,this.#A=null,this.#n.dispose(),this.#t.invalidate())}};var xn=s=>(s.workflow==="none"?0:s.workflow==="plan"?2:1)+(s.fullMap?1:0)+(s.precisionOpen?1:0)+(s.dialog?1:0),Pn=s=>{if(!s||typeof s!="object")return null;let t=s.maticMapLayer;if(!t||typeof t!="object")return null;let e=t.owner,n=t.depth;return typeof e=="string"&&Number.isInteger(n)&&Number(n)>=0?{owner:e,depth:Number(n)}:null},Ne=class{#e;#t=`matic-map-${crypto.randomUUID?.()||Math.random().toString(36).slice(2)}`;#n=0;#s=null;#o=!1;#r=!1;constructor(t){this.#e=t}start(){this.#s||(this.#n=xn(this.#e.value),this.#s=this.#e.subscribe(t=>this.#d(t)),window.addEventListener("popstate",this.#u))}#d(t){let e=xn(t);if(this.#o){this.#o=!1,this.#n=e;return}if(e<this.#n){let n=Pn(history.state);if(n?.owner===this.#t&&n.depth===this.#n){let r=e-this.#n;this.#n=e,this.#r=!0,history.go(r);return}}if(e>this.#n)for(let n=this.#n+1;n<=e;n+=1){let r=history.state&&typeof history.state=="object"?history.state:{};history.pushState({...r,maticMapLayer:{owner:this.#t,depth:n}},"",window.location.href)}this.#n=e}#u=()=>{if(this.#r){this.#r=!1;return}if(!(this.#n<1)){if(V(this.#e.value,{type:"dismiss-top-layer"})){let t=history.state&&typeof history.state=="object"?history.state:{};history.pushState({...t,maticMapLayer:{owner:this.#t,depth:this.#n}},"",window.location.href),this.#e.dispatch({type:"open-dialog",dialog:"discardDraft"});return}this.#o=!0,this.#e.dispatch({type:"dismiss-top-layer"})}};dismissTop(){if(this.#n<1)return!1;let t=Pn(history.state);return t?.owner===this.#t&&t.depth===this.#n?history.back():this.#e.dispatch({type:"dismiss-top-layer"}),!0}dispose(){this.#s?.(),this.#s=null,window.removeEventListener("popstate",this.#u),this.#n=0,this.#r=!1}};var Cn=[X,G,_e,j`
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
  `];var mt=class extends Y{constructor(){super(...arguments);this.state=D();this.compact=!1;this.inline=!1}static{this.properties={state:{attribute:!1},localize:{attribute:!1},compact:{type:Boolean,reflect:!0},inline:{type:Boolean,reflect:!0}}}static{this.styles=[X,G,_e,j`
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
`]}#e(e,n){return z(this.localize,e,n)}#t(e){this.dispatchEvent(new CustomEvent(ce,{detail:e,bubbles:!0,composed:!0}))}#n(e){let n=e.currentTarget.valueAsNumber;Number.isFinite(n)&&this.#t({type:"set-brush",value:n})}render(){let{draw:e}=this.state;return be`
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
    `}};customElements.get(se)||customElements.define(se,mt);var Mn=J(we),ze=J(se),En=J(ie),$n=s=>s.dataMode==="history"||s.floor.readOnly,ur=(s,t)=>{let e=(r,o,i)=>z(t,r,o,i);if(!s.host.connected)return{title:e("v4_reconnecting","Reconnecting"),detail:e("v4_ha_offline","Home Assistant is offline"),icon:Q,notable:!0};if(!s.host.administrator)return{title:e("v4_access_required","Access required"),detail:e("v4_admin_only","Administrator only"),icon:Q,notable:!0};if(s.host.robotCount===0)return{title:e("v4_no_robot_short","No robot"),detail:e("v4_set_up_robot","Set up a Matic robot"),icon:Q,notable:!0};if(!s.host.robotConnected)return{title:e("v4_robot_offline","Robot offline"),detail:e("v4_last_map_read_only","Last verified map \xB7 read only"),icon:Q,notable:!0};if(s.activity==="problem")return{title:e("v4_needs_attention","Needs attention"),detail:e("v4_check_robot","Check the robot"),icon:Q,notable:!0};if(s.dataMode==="history"){let r=s.resources.history.value?.floors.find(a=>a.id===s.selection.floorId),o=r?.snapshots.findIndex(a=>a.id===s.selection.historyId)??-1,i=r?.snapshots.length??0;return{title:e("v4_saved_map","Saved map"),detail:o>=0?e("v4_read_only_position","Read only \xB7 {position} of {count}",{position:o+1,count:i}):e("v4_read_only","Read only"),icon:Ze,notable:!1}}if(s.coherence==="verifying"||s.coherence==="booting")return{title:e("v4_locating","Locating"),detail:e("v4_finding_map","Finding the current map"),icon:le,notable:!0};if((s.resources.entry?.activePlan||s.resources.entry?.runnerLocked)&&(s.activity==="idle"||s.activity==="docked"))return{title:e("v4_task_in_progress","Task in progress"),detail:s.activity==="docked"?e("v4_task_docked","Robot docked; the cleaning task has not finished."):e("v4_task_waiting","Waiting for the cleaning task to continue or finish."),icon:et,notable:!0};if(s.command==="starting"&&(s.activity==="idle"||s.activity==="docked"))return{title:e("v4_action_starting","Starting"),detail:e("v4_action_starting_detail","Waiting for the robot to begin"),icon:le,notable:!0};if(s.activity==="cleaning")return{title:e("v4_cleaning","Cleaning"),detail:e("v4_cleaning_progress","Cleaning in progress"),icon:tt,notable:!0};if(s.activity==="recharging"){let r=s.batteryPercent===null?e("v4_recharging_detail","Will resume automatically when ready"):e("v4_recharging_battery","Charging to resume \xB7 {percent}% battery",{percent:s.batteryPercent});return{title:e("v4_recharging","Charging to resume"),detail:r,icon:Nt,notable:!0}}if(s.activity==="paused")return{title:e("v4_paused","Paused"),detail:e("v4_can_resume","Cleaning can resume"),icon:nt,notable:!0};if(s.activity==="returning")return{title:e("v4_returning","Returning"),detail:e("v4_going_dock","Going to the dock"),icon:tt,notable:!0};if(s.activity==="stopping")return{title:e("v4_stopping","Stopping"),detail:e("v4_waiting_robot","Waiting for the robot"),icon:nt,notable:!0};let n=s.batteryPercent===null?e("v4_ready","Ready"):e("v4_battery","{percent}% battery",{percent:s.batteryPercent});return{title:s.activity==="docked"?e("v4_docked","Docked"):e("v4_ready","Ready"),detail:n,icon:le,notable:!1}},An=(s,t)=>{let e=(n,r)=>z(t,n,r);switch(s.workflow){case"rooms":return{title:e("v4_choose_rooms","Choose rooms"),description:e("v4_choose_rooms_detail","Select on the map or from the list.")};case"draw":return{title:e("v4_draw_area","Draw an area"),description:e("v4_draw_area_detail","Outline or paint the area, then review it before saving.")};case"plans":return{title:e("v4_your_plans","Your plans"),description:e("v4_choose_plan_detail","Choose a plan to edit or run, or create a new one.")};case"plan":return{title:s.planDraft.id?e("v4_edit_plan","Edit plan"):e("v4_create_plan","Create a plan"),description:e("v4_plan_detail","Review rooms and cleaning settings.")};case"areaReview":return{title:e("v4_name_this_area","Name this area"),description:e("area_details_hint","Name the area and choose cleaning settings.")};case"history":return{title:e("v4_map_history","Map history"),description:e("v4_map_history_detail","Saved maps are floor-scoped and read only.")};case"support":return{title:e("v4_map_diagnostics","Map diagnostics"),description:e("v4_map_support_detail","Private geometry is never included.")};case"none":return $n(s)?{title:e("v4_saved_map_read_only_title","Saved map is read only"),description:s.dataMode==="live"?e("v4_map_recovery_automatic","Cleaning controls return automatically when the live map is verified."):e("v4_saved_map_read_only_detail","Return to the live map to choose rooms, run a plan, or draw a custom area.")}:{title:e("v4_what_to_clean","What should the robot clean?"),description:e("v4_clean_detail","Choose rooms, a saved plan, or a custom area.")}}},K=["peek","half","full"],In={none:"half",rooms:"half",draw:"peek",plan:"full",plans:"full",areaReview:"half",history:"half",support:"full"},hr=.5,pr=100,mr=6,fr=48,vr=["button:not(:disabled)","a[href]","input:not(:disabled)","select:not(:disabled)","textarea:not(:disabled)","[tabindex]:not([tabindex='-1'])"].join(", "),yr=(s,t,e=!1,n="room",r=!1,o="mop")=>{let i=(a,l,c)=>z(t,a,l,c);switch(s){case"discardDraft":return{title:e?i("v4_discard_plan","Discard plan changes?"):i("v4_discard_area","Discard area changes?"),detail:e?i("v4_discard_plan_detail","Your plan changes have not been saved. Keep editing or discard them."):i("v4_discard_area_detail","Your area changes have not been saved. Keep editing or discard them."),cancelLabel:i("v4_keep_area_editing","Keep editing"),confirmLabel:i("v4_discard","Discard"),action:"discard"};case"confirmDeletePlan":return{title:i("v4_delete_plan","Delete this plan?"),detail:i("v4_delete_plan_detail","This removes the saved plan from Home Assistant. The robot will not move."),cancelLabel:i("v4_cancel","Cancel"),confirmLabel:i("plan_delete","Delete plan"),action:"delete-plan"};case"confirmDeleteArea":return{title:i("v4_delete_area","Delete this area?"),detail:i("v4_delete_area_detail","This removes the saved outline from Home Assistant. The robot will not move."),cancelLabel:i("v4_cancel","Cancel"),confirmLabel:i("area_delete","Delete area"),action:"delete-area"};case"confirmResetCadence":return{title:o==="mop"?i("v4_reset_mop_cadence_title","Reset mopping progress for {room}?",{room:n}):i("v4_reset_coverage_cadence_title","Reset coverage progress for {room}?",{room:n}),detail:r?o==="mop"?i("v4_reset_shared_mop_cadence_detail","This clears shared mopping progress for {room} across plans that use its shared schedule. Coverage progress and saved cleaning history stay unchanged.",{room:n}):i("v4_reset_shared_coverage_cadence_detail","This clears shared coverage progress for {room} across plans that use its shared schedule. Mopping progress and saved cleaning history stay unchanged.",{room:n}):o==="mop"?i("v4_reset_private_mop_cadence_detail","This clears mopping progress for {room} in this plan. Coverage progress and saved cleaning history stay unchanged.",{room:n}):i("v4_reset_private_coverage_cadence_detail","This clears coverage progress for {room} in this plan. Mopping progress and saved cleaning history stay unchanged.",{room:n}),cancelLabel:i("v4_cancel","Cancel"),confirmLabel:o==="mop"?i("v4_reset_mop_cadence_confirm","Reset mopping progress"):i("v4_reset_coverage_cadence_confirm","Reset coverage progress"),action:"reset-room-cadence"};case"confirmStop":return{title:i("v4_stop_cleaning","Stop cleaning?"),detail:i("v4_stop_cleaning_detail","The robot may take a moment to settle before another action is available."),cancelLabel:i("v4_keep_cleaning","Keep cleaning"),confirmLabel:i("v4_stop","Stop"),action:"stop"};case"error":return{title:i("v4_error","Something went wrong"),detail:i("v4_error_detail","No action was started. Close this message and try again when the map is ready."),cancelLabel:i("v4_close","Close"),confirmLabel:i("v4_close","Close"),action:null};case null:return null}},gr=(s=document)=>{let t=s.activeElement;for(;t?.shadowRoot?.activeElement;)t=t.shadowRoot.activeElement;return t},ft=s=>!!(s&&s.isConnected&&s.offsetParent!==null),vt=class extends Y{constructor(){super();this.state=D();this._measuredNarrow=!1;this._sheetOffset=0;this._overflowOpen=!1;this._helpOpen=!1;this._browserFullscreen=!1;this._sheetDetent="half";this._announcement="";this._workflowLoadFailed=!1;this.#t=null;this.#n=null;this.#s=null;this.#o=null;this.#r=null;this.#d=null;this.#u=null;this.#m=null;this.#c=null;this.#g=null;this.#R=()=>{this._browserFullscreen=document.fullscreenElement===this.renderRoot.querySelector(".app")};this.#x=e=>{if(!this._overflowOpen)return;let n=this.renderRoot.querySelector(".overflow-wrap");(!n||!e.composedPath().includes(n))&&(this._overflowOpen=!1)};this.#se=()=>{this._workflowLoadFailed=!1,this.#Y()};new Ht(this,{container:()=>this.renderRoot?.querySelector(".draw-tools")??null,items:"button"})}static{this.properties={state:{attribute:!1},localize:{attribute:!1},_measuredNarrow:{state:!0},_sheetOffset:{state:!0},_overflowOpen:{state:!0},_helpOpen:{state:!0},_browserFullscreen:{state:!0},_sheetDetent:{state:!0},_announcement:{state:!0},_workflowLoadFailed:{state:!0}}}static{this.styles=Cn}#e(e,n,r){return z(this.localize,e,n,r)}#t;#n;#s;#o;#r;#d;#u;#m;#c;#g;#R;#x;connectedCallback(){super.connectedCallback(),this.#t=new ResizeObserver(([e])=>{if(!e)return;let n=e.contentRect.width<1024||e.contentRect.height<480;n!==this._measuredNarrow&&(this._measuredNarrow=n)}),this.#t.observe(this),window.addEventListener("pointerdown",this.#x,!0),document.addEventListener("fullscreenchange",this.#R),this.#n=new ResizeObserver(([e])=>{if(!e)return;let n=Math.ceil(e.target.getBoundingClientRect().height);n!==this._sheetOffset&&(this._sheetOffset=n)})}disconnectedCallback(){this.#t?.disconnect(),this.#t=null,this.#n?.disconnect(),this.#n=null,this.#s=null,window.removeEventListener("pointerdown",this.#x,!0),document.removeEventListener("fullscreenchange",this.#R),super.disconnectedCallback()}updated(e){let n=e,r=this.renderRoot.querySelector(".mobile-sheet");if(r!==this.#s&&(this.#n?.disconnect(),this.#s=r,r?this.#n?.observe(r):this._sheetOffset!==0&&(this._sheetOffset=0)),n.has("_overflowOpen")&&this._overflowOpen&&this.updateComplete.then(()=>{this.renderRoot.querySelector("#map-options select, #map-options button")?.focus()}),n.has("_helpOpen")){if(this._helpOpen)this.updateComplete.then(()=>{this.renderRoot.querySelector(".help-dialog [data-dialog-initial-focus]")?.focus()});else if(n.get("_helpOpen")){let o=this.#d;this.#d=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>o?.focus({preventScroll:!0}))})}}if(e.has("state")){let o=e.get("state");if(o?.precisionOpen&&!this.state.precisionOpen&&this.#b()?.focus(),o?.fullMap&&!this.state.fullMap){let i=this.#r;this.#r=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>{(this.renderRoot.querySelector(".workspace-toggle")??this.renderRoot.querySelector(".nav--menu")??(i?.isConnected?i:null))?.focus({preventScroll:!0})})})}if(!o?.dialog&&this.state.dialog){let i=gr(this.shadowRoot||document);i?.hasAttribute("data-dialog-launcher")&&(this.#o=i),this.updateComplete.then(()=>{(this.renderRoot.querySelector(".dialog [data-dialog-initial-focus]")??this.renderRoot.querySelector(".dialog button"))?.focus()})}else if(o?.dialog&&!this.state.dialog){o.dialog==="discardDraft"&&(this.#u=null,this.#L());let i=this.#o?.isConnected&&this.#o.hasAttribute("data-dialog-launcher")?this.#o:this.#ee(o.dialog);this.#o=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>i?.focus({preventScroll:!0}))})}o?o.workflow!==this.state.workflow&&(this._sheetDetent=In[this.state.workflow],this.updateComplete.then(()=>this.#l())):this._sheetDetent=In[this.state.workflow]}}#l(){let e=this.renderRoot.querySelector(".panel-heading h2");if(ft(e)){e.focus({preventScroll:!0});return}let n=this.renderRoot.querySelector(".action-bar .ms-btn--primary");ft(n)&&n.focus({preventScroll:!0})}#b(){let e=this.renderRoot.querySelector(".draw-brush");return ft(e)?e:this.renderRoot.querySelector(we)?.shadowRoot?.querySelector(".draw-brush")??null}#i(e){if(V(this.state,e)){this.#u=e,this.#i({type:"open-dialog",dialog:"discardDraft"});return}this.dispatchEvent(new CustomEvent(ce,{detail:e,bubbles:!0,composed:!0}))}#E(e){if(e.enabled){if(e.id==="return-live"){this.#i({type:"set-history",historyId:null});return}if(e.id==="clear-draft"){this.#i({type:"clear-draft"});return}this.#k(e.id)}}#p(e,n){let r={type:"open-workflow",workflow:e};n instanceof HTMLElement&&V(this.state,r)&&(this.#o=n),this.#i(r)}#v(){let e=this.#u;this.#u=null,e?.type==="select-plan"||e?.type==="select-area"?(this.#i({type:"patch-plan-draft",patch:{dirty:!1}}),this.#i({type:"patch-area-draft",patch:{dirty:!1}}),this.#i({type:"dismiss-top-layer"})):this.#i({type:"discard-draft"}),e&&e.type!=="dismiss-top-layer"&&queueMicrotask(()=>this.dispatchEvent(new CustomEvent(ce,{detail:e,bubbles:!0,composed:!0})))}#w(){this.#u=null,this.#a(),this.#L()}#L(){this.updateComplete.then(()=>{let e=this.renderRoot.querySelector(".floor-switcher");e&&(e.value=this.state.selection.floorId);let n=this.renderRoot.querySelector(".robot-switcher");n&&(n.value=this.state.selection.entryId??"")})}#a(){let e=this.state.dialog,n=e&&this.#o?.isConnected&&this.#o.hasAttribute("data-dialog-launcher")?this.#o:e?this.#ee(e):null;this.#i({type:"dismiss-top-layer"}),n&&requestAnimationFrame(()=>n.focus({preventScroll:!0}))}#k(e){this.dispatchEvent(new CustomEvent(rt,{detail:typeof e=="string"?{id:e}:e,bubbles:!0,composed:!0}))}#h(e){this.#i({type:"dismiss-top-layer"}),this.#k(e)}#A(e){if(e.action==="discard"){this.#v();return}if(e.action==="delete-plan"||e.action==="delete-area"){this.#h(e.action);return}if(e.action==="reset-room-cadence"){let n=this.state.cadenceResetRequest;this.#i({type:"dismiss-top-layer"}),n&&this.#k({id:"reset-room-cadence",planId:n.planId,roomId:n.roomId,mode:n.mode});return}this.#i({type:"dismiss-top-layer"}),e.action==="stop"&&this.#k("stop")}#f(e){e!==this._sheetDetent&&(this._sheetDetent=e,this._announcement=this.#e("v4_workspace_height","Map workspace, {height} height",{height:e}))}#I(e,n=!1){let o=K.indexOf(this._sheetDetent)+e;n&&o>=K.length&&(o=0),o=Math.max(0,Math.min(K.length-1,o)),this.#f(K[o]??this._sheetDetent)}#M(e){let n=this.renderRoot.querySelector(".workspace")?.clientHeight??e.parentElement?.clientHeight??e.offsetHeight,r=parseFloat(getComputedStyle(this).fontSize)||16,o=[".sheet-grip",".sheet-tools",".action-bar"].map(l=>e.querySelector(l)?.offsetHeight??0).reduce((l,c)=>l+c,0)+r*.75,i=Math.min(n*.92,n-r*9),a=Math.min(n*.48,r*26,i);return{peek:Math.min(o,a),half:a,full:i}}#P(){return this.renderRoot.querySelector(".mobile-sheet")}#H(e){if(e.pointerType==="mouse"&&e.button!==0||e.target?.closest("button, select, input, a"))return;let n=this.#P();!n||this.#c||(this.#c={pointerId:e.pointerId,startY:e.clientY,startHeight:n.offsetHeight,heights:this.#M(n),samples:[{y:e.clientY,t:e.timeStamp}],moved:!1},e.currentTarget.setPointerCapture(e.pointerId),n.classList.add("dragging"))}#y(e){let n=this.#c;if(!n||e.pointerId!==n.pointerId)return;let r=this.#P();if(!r)return;let o=e.clientY-n.startY;for(!n.moved&&Math.abs(o)>mr&&(n.moved=!0),n.samples.push({y:e.clientY,t:e.timeStamp});n.samples.length>2&&e.timeStamp-(n.samples[1]?.t??0)>pr;)n.samples.shift();if(!n.moved)return;let i=n.startHeight-n.heights.full,a=n.startHeight-n.heights.peek,l=Math.max(i,Math.min(a,o));r.style.transform=`translateY(${l}px)`}#C(e){let n=this.#c;if(!n||e.pointerId!==n.pointerId)return;this.#c=null;let r=this.#P();if(r&&(r.style.transform="",r.classList.remove("dragging")),e.type==="pointercancel")return;if(!n.moved){this.#I(1,!0);return}let o=e.clientY-n.startY,i=K.indexOf(this._sheetDetent),a=n.samples[0],l=n.samples[n.samples.length-1],c=a&&l&&l!==a?(l.y-a.y)/Math.max(1,l.t-a.t):0;if(Math.abs(c)>hr){let h=Math.max(0,Math.min(K.length-1,i+(c<0?1:-1)));this.#f(K[h]??this._sheetDetent);return}let d=n.startHeight-o,u=this._sheetDetent,p=Number.POSITIVE_INFINITY;for(let h of K){let v=Math.abs(n.heights[h]-d);v<p&&(p=v,u=h)}this.#f(u)}#O(e){if(e.pointerType==="mouse")return;let n=e.currentTarget;this.#g={pointerId:e.pointerId,startY:e.clientY,atTop:n.scrollTop===0,consumed:!1}}#$(e){let n=this.#g;if(!n||n.consumed||!n.atTop||e.pointerId!==n.pointerId)return;if(e.currentTarget.scrollTop>0){this.#g=null;return}e.clientY-n.startY<fr||(n.consumed=!0,this.#I(-1))}#N(){this.#g=null}#X(){this.dispatchEvent(new CustomEvent("hass-toggle-menu",{bubbles:!0,composed:!0}))}#G(e){this.#r=e.currentTarget,this.#i({type:this.state.fullMap?"exit-full-map":"enter-full-map"})}#D(e){this._overflowOpen=!1,e&&this.updateComplete.then(()=>{this.renderRoot.querySelector(".overflow")?.focus()})}#z(e){if(this.#D(e==="fullscreen"),e==="support"){this.#p("support");return}if(e==="fullscreen"){let n=this.renderRoot.querySelector(".app");document.fullscreenElement?document.exitFullscreen():n?.requestFullscreen();return}this.dispatchEvent(new CustomEvent(rt,{detail:{id:"use-classic"},bubbles:!0,composed:!0}))}#oe(){this.#i({type:"set-precision-open",value:!this.state.precisionOpen})}#B(e){this.#d=e.currentTarget,this._helpOpen=!0}#Z(e){let n=e;if(!ye(n.detail))return;if(V(this.state,n.detail)){e.stopPropagation(),this.#i(n.detail);return}if(n.detail?.type!=="open-dialog")return;let r=n.composedPath().find(o=>o instanceof HTMLElement&&o.hasAttribute("data-dialog-launcher"));r instanceof HTMLElement&&(this.#o=r)}#ee(e){return this.renderRoot.querySelector(ie)?.shadowRoot?.querySelector(`[data-dialog-launcher="${e}"]`)??null}#U(e){if(!Wt(e)&&!(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey)&&e.key==="Escape"){if(e.preventDefault(),this._overflowOpen){this.#D(!0);return}if(this._helpOpen){this._helpOpen=!1;return}if(this.state.dialog==="discardDraft"){this.#w();return}this.#i({type:"dismiss-top-layer"})}}#_(e){if(e.key!=="Tab")return;let r=[...e.currentTarget.querySelectorAll(vr)],o=r[0],i=r.at(-1);if(!o||!i)return;let a=this.shadowRoot?.activeElement;e.shiftKey&&a===o?(e.preventDefault(),i.focus()):!e.shiftKey&&a===i&&(e.preventDefault(),o.focus())}#S(){let e=this.renderRoot.querySelector(we);(e?.shadowRoot?.querySelector(".map-root")??e)?.focus()}#q(){this._sheetDetent==="peek"&&this.#P()&&this.#f("half"),this.updateComplete.then(()=>this.#l())}#W(e,n,r){if(e.id==="choose-cleaning")return _;let o=e.labelKey?this.#e(e.labelKey,e.label):e.label,i=!e.enabled&&e.reason?e.reasonKey?this.#e(e.reasonKey,e.reason):e.reason:null,a=e.id==="stop";return b`
      <button
        class=${`${n} ${e.kind==="danger"?"ms-btn--danger":""}`}
        type="button"
        aria-disabled=${e.enabled?_:"true"}
        aria-describedby=${i?r:_}
        aria-label=${a?this.#e("v4_stop_cleaning_label","Stop cleaning"):_}
        @click=${()=>this.#E(e)}
      >${o}</button>
      ${i?b`<p class="action-reason" id=${r}>${i}</p>`:_}
    `}#F(e){let n=e.resources.plans.value?.rooms??e.resources.areas.value?.rooms??[];return e.selection.roomIds.map(r=>n.find(o=>o.roomId===r)?.name??r)}#te(e,n,r){let o=n?.enabled&&e.workflow==="rooms"&&n.id==="clean-rooms"?[this.#F(e).join(", "),e.planDraft.returnToBase?this.#e("v4_returns_to_dock","returns to the dock"):""].filter(Boolean).join(" \xB7 "):"";return b`
      <div class="action-bar">
        ${o?b`<p class="action-summary">${o}</p>`:_}
        ${n?this.#W(n,"ms-btn ms-btn--block ms-btn--lg ms-btn--primary","primary-reason"):_}
        ${r?this.#W(r,"ms-btn ms-btn--block ms-btn--lg ms-btn--secondary","secondary-reason"):_}
      </div>
    `}#T(e,n,r=_){return b`
      <div class="host-state">
        <h3>${e}</h3>
        <p>${n}</p>
        ${r}
      </div>
    `}#Q(e,n,r,o,i=!1){return b`
      <button
        class="ms-row"
        type="button"
        aria-disabled=${i?"true":_}
        @click=${()=>{i||r()}}
      >
        <span class="ms-row__lead">${A(n)}</span>
        <span class="ms-row__body"><strong>${e}</strong>${o?b`<small>${o}</small>`:_}</span>
        <span class="ms-row__trail">${A(Se)}</span>
      </button>
    `}#V(e){let n=e.resources.history.value?.floors||[],r=n.length?n.map((o,i)=>({id:o.active?"current":o.id,label:`${o.label||(o.active?this.#e("v4_current_floor","Current floor"):this.#e("v4_saved_floor","Saved floor {number}",{number:o.ordinal??i+1}))}${!o.active&&o.snapshots.length===0?` \xB7 ${this.#e("v4_floor_not_captured","Visit floor to capture")}`:""}`,disabled:!o.active&&o.snapshots.length===0})):[{id:e.selection.floorId,label:e.floor.displayName,disabled:!1}];return b`
      <select
        class="ms-select context-switcher floor-switcher"
        slot="floor"
        data-map-control
        name="map-floor"
        aria-label=${this.#e("v4_choose_floor","Choose floor")}
        ?disabled=${r.length<=1}
        .value=${e.selection.floorId}
        @change=${o=>this.#i({type:"set-floor",floorId:o.currentTarget.value})}
      >${r.map(o=>b`
        <option value=${o.id} ?selected=${o.id===e.selection.floorId} ?disabled=${o.disabled}>${o.label}</option>
      `)}</select>
    `}#j(e,n){let r=(g,M,x)=>this.#e(g,M,x),o=this.#Q(r("v4_map_history","Map history"),Ze,()=>this.#p("history"),r("v4_map_history_detail","Saved maps are floor-scoped and read only.")),i=this.#Q(r("v4_map_diagnostics","Map diagnostics"),qt,()=>this.#p("support"),r("v4_map_support_detail","Private geometry is never included.")),{host:a}=e;if(!a.connected)return this.#T(r("v4_reconnecting_title","Reconnecting to Home Assistant"),r("v4_reconnecting_body","The last verified map stays read-only until the connection returns."));if(!a.administrator)return this.#T(r("v4_admin_title","Administrator access required"),r("v4_admin_body","Ask a Home Assistant administrator to open this map."));if(a.robotCount===0)return this.#T(r("v4_no_robot_title","No Matic robot set up"),r("v4_no_robot_body","Add the Matic integration to see a map here."),b`<a class="ms-btn ms-btn--secondary" href="/config/integrations/integration/matic_robot">${r("v4_open_integration","Open the Matic integration")}</a>`);if(!a.robotConnected)return b`
        ${this.#T(r("v4_robot_offline_title","Robot offline"),r("v4_robot_offline_body","Showing the last verified map. Cleaning is unavailable until the robot reconnects."))}
        <h3 class="shelf-heading">${r("v4_more","Map tools")}</h3>
        <div class="shelf">${o}${i}</div>
      `;if($n(e))return b`
        ${this.#T(r("v4_saved_map_read_only_notice","Cleaning is unavailable on a saved map"),e.dataMode==="live"?r("v4_map_recovery_automatic","Cleaning controls return automatically when the live map is verified."):r("v4_saved_map_read_only_notice_detail","Saved maps are view only. Return to the live map below to choose rooms, run a plan, or draw a custom area."))}
        <h3 class="shelf-heading">${r("v4_more","Map tools")}</h3>
        <div class="shelf">
          ${o}
          ${i}

        </div>
      `;let l=e.coherence==="verifying"||e.coherence==="booting",c=e.resources.plans,d=c.value,u=d!==null&&d.rooms.length===0,p=d?.plans.length??0,h=c.status==="loading",v=c.status==="error",y=l||u,w=l?r("v4_reason_locating","Waiting for the robot to confirm which floor it is on."):u?r("v4_no_rooms_reason","This floor has no named rooms yet."):null,k=l?r("v4_reason_locating","Waiting for the robot to confirm which floor it is on."):null,S=l?r("v4_reason_locating","Waiting for the robot to confirm which floor it is on."):r("v4_areas_quick_detail","Create or choose a saved area");return b`
      ${e.activity==="problem"?this.#T(r("v4_attention_title","The robot needs attention"),r("v4_attention_body","Check the robot, then start a new task.")):b`
          <div class="quick-actions" aria-label=${r("v4_cleaning_choices","Cleaning choices")}>
            <button
              class="ms-row ms-row--card ms-row--featured"
              type="button"
              aria-disabled=${y?"true":_}
              @click=${()=>{y||this.#p("rooms")}}
            >
              <span class="ms-row__lead">${A(le)}</span>
              <span class="ms-row__body">
                <strong>${r("v4_clean_rooms","One-time clean")}</strong>
                <small>${w??r("v4_clean_rooms_hint","Choose rooms for this run")}</small>
              </span>
              <span class="ms-row__trail">${A(Se)}</span>
            </button>
            <button
              class="ms-row ms-row--card"
              type="button"
              aria-disabled=${l?"true":_}
              @click=${()=>{l||this.#p("plans")}}
            >
              <span class="ms-row__lead">${A(et)}</span>
              <span class="ms-row__body">
                <strong>${h?r("v4_plans_loading","Checking saved plans"):v?r("v4_plans_unavailable","Plans unavailable"):p?r("v4_run_a_plan","Run a plan"):r("v4_create_plan","Create a plan")}</strong>
                <small>${k??(h?r("v4_plans_loading_hint","Reading routines for this floor"):v?r("v4_plans_unavailable_hint","Try again to load saved routines"):p?p===1?r("v4_saved_routine","1 saved routine"):r("v4_saved_routines","{count} saved routines",{count:p}):r("v4_no_plans_hint","Save a room routine you can repeat"))}</small>
              </span>
              <span class="ms-row__trail">${A(Se)}</span>
            </button>
          </div>
        `}
      <h3 class="shelf-heading">${r("v4_more","Map tools")}</h3>
      <div class="shelf">
        ${this.#Q(r("v4_custom_areas","Clean a custom area"),Dt,()=>this.#p("draw"),S,l)}
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
              @click=${()=>this.#i({type:"set-appearance",appearance:"photo"})}
            >${r("map_style_photo","Photo")}</button>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(e.appearance==="rooms")}
              @click=${()=>this.#i({type:"set-appearance",appearance:"rooms"})}
            >${r("v4_room_colours","Floor plan")}</button>
          </div>
          <label class="ms-checkbox">
            <input type="checkbox" .checked=${e.labelsVisible} @change=${()=>this.#i({type:"toggle-labels"})}>
            ${r("v4_room_names","Room names")}
          </label>
          <button
            class="ms-btn ms-btn--secondary help-launcher"
            type="button"
            aria-haspopup="dialog"
            aria-expanded=${String(this._helpOpen)}
            @click=${this.#B}
          >${r("v4_how_to_move","How to move the map")}</button>
        </div>
      `:_}
    `}#ne(e,n){return e.workflow==="none"?this.#j(e,n):customElements.get(ie)?b`<${En}
      .state=${e}
      .localize=${this.localize}
      @matic-workspace-intent=${this.#Z}
    ></${En}>`:(this.#Y(),this._workflowLoadFailed?b`<div class="workflow-loading" role="alert">
          <p>${this.#e("v4_workflow_load_failed","Workspace tools could not be loaded.")}</p>
          <button class="ms-btn ms-btn--secondary" @click=${this.#se}>
            ${this.#e("v4_retry","Try again")}
          </button>
        </div>`:b`<div class="workflow-loading" role="status" aria-live="polite">
        ${this.#e("v4_workflow_loading","Loading workspace tools\u2026")}
      </div>`)}#Y(){this.#m||customElements.get(ie)||(this._workflowLoadFailed=!1,this.#m=import("./workflow-panel-XVDMHLZA.js").then(()=>{this.#m=null,this.requestUpdate()}).catch(()=>{this.#m=null,this._workflowLoadFailed=!0}))}#se;#re(e,n){let r=An(e,this.localize);return b`
      <div class="panel-heading">
        ${e.workflow!=="none"?b`
          <button
            class="panel-back ms-btn ms-btn--secondary"
            type="button"
            aria-label=${e.workflow==="plan"?this.#e("v4_back_to_plans","Back to plans"):this.#e("v4_back_to_all_tasks","Back to all tasks")}
            data-dialog-launcher="discardDraft"
            @click=${o=>this.#p(e.workflow==="plan"?"plans":"none",o.currentTarget)}
          >${A(ke)}<span class="ms-btn__label">${e.workflow==="plan"?this.#e("v4_your_plans","Your plans"):this.#e("v4_all_tasks","All tasks")}</span></button>
        `:_}
        <h2 tabindex="-1">${r.title}</h2>
      </div>
      <p class="panel-description">${r.description}</p>
      ${this.#ne(e,n)}
    `}#J(e,n){let o=An(e,this.localize).title;return e.workflow==="rooms"&&e.selection.roomIds.length&&(o=`${this.#e("v4_rooms_selected","Rooms selected: {count}",{count:e.selection.roomIds.length})} \xB7 ${this.#F(e).join(", ")}`),this._sheetDetent!=="peek"?n.detail?`${n.title} \xB7 ${n.detail}`:n.title:n.notable?`${n.title} \xB7 ${o}`:o}#K(){let e=(n,r)=>this.#e(n,r);return b`
      <div class="dialog-backdrop" @click=${n=>{n.target===n.currentTarget&&(this._helpOpen=!1)}}>
        <section
          class="dialog help-dialog ms-surface ms-surface--overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-title"
          @keydown=${this.#_}
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
    `}render(){let e=this.state,n=e.narrowHint||this._measuredNarrow,r=ur(e,this.localize),o=Pt({...e,narrowHint:n}),i=Ct(e),a=!n&&o.id==="stop"?o:!n&&i?.id==="stop"?i:null,l=a&&a===o?null:o,c=e.workflow==="draw"&&e.dataMode==="live"?{id:"clear-draft",label:"Clear drawing",labelKey:"v4_clear_drawing",kind:"neutral",enabled:e.draw.circles.length>0||!!e.draw.outline?.points.length}:null,d=a&&a===i?null:i??c,u=e.fullMap&&(e.coherence==="verifying"||e.coherence==="booting"),p=e.fullMap||e.host.administrator&&e.host.robotCount>0&&e.map.available,h=e.cadenceResetRequest?e.resources.plans.value?.rooms.find(g=>g.roomId===e.cadenceResetRequest?.roomId):void 0,v=e.cadenceResetRequest?e.resources.plans.value?.plans.find(g=>g.id===e.cadenceResetRequest?.planId)?.rooms.find(g=>g.roomId===e.cadenceResetRequest?.roomId):void 0,y=yr(e.dialog,this.localize,e.workflow==="plan",h?.name||e.cadenceResetRequest?.roomId||"room",v?.cadence?.scope==="shared",e.cadenceResetRequest?.mode),w=n&&!e.fullMap?`--map-sheet-offset:${this._sheetOffset}px`:"--map-sheet-offset:0px",k=n&&e.workflow==="draw",S=e.precisionOpen&&e.workflow==="draw";return b`
      <div class=${`root ${n?"narrow":"wide"}`} @keydown=${this.#U}>
        <button class="skip-link ms-btn ms-btn--primary" type="button" @click=${this.#S}>${this.#e("v4_skip_to_map","Skip to the map")}</button>
        <button class="skip-link ms-btn ms-btn--primary" type="button" @click=${this.#q}>${this.#e("v4_skip_to_workspace","Skip to the map workspace")}</button>
        <div class="app" ?inert=${!!y||this._helpOpen}>
          <header class="app-bar">
            ${e.precisionOpen?_:b`
              <button
                class="nav nav--menu ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#e("v4_open_navigation","Open Home Assistant sidebar")}
                title=${this.#e("v4_open_navigation","Open Home Assistant sidebar")}
                @click=${this.#X}
              >${A($t)}</button>
            `}

            ${e.precisionOpen?b`
              <button
                class="nav ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#e("v4_back","Back")}
                @click=${()=>this.#i({type:"dismiss-top-layer"})}
              >${A(ke)}</button>
            `:_}
            <h1 class="title">${this.#e("map_studio_title","Matic Map")}</h1>
            ${e.robots.length>1?b`
              <select
                class="ms-select context-switcher robot-switcher"
                name="matic-robot"
                aria-label=${this.#e("v4_choose_robot","Choose robot")}
                .value=${e.selection.entryId||""}
                @change=${g=>this.#i({type:"select-entry",entryId:g.currentTarget.value})}
              >${e.robots.map(g=>b`
                <option value=${g.entryId} ?selected=${g.entryId===e.selection.entryId}>${g.label}</option>
              `)}</select>
            `:_}

            <span class="spacer"></span>
            ${p?b`
              <button
                class="workspace-toggle ms-btn ms-btn--icon"
                type="button"
                aria-label=${e.fullMap?this.#e("v4_show_workspace","Show cleaning panel"):this.#e("v4_hide_workspace","Hide cleaning panel")}
                aria-controls="map-workspace"
                aria-expanded=${String(!e.fullMap)}
                title=${e.fullMap?this.#e("v4_show_workspace","Show cleaning panel"):this.#e("v4_hide_workspace","Hide cleaning panel")}
                @click=${this.#G}
              >${A(Tt)}</button>
            `:_}
            <div class="overflow-wrap">
              <button
                class="overflow ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#e("v4_map_options","Map options")}
                aria-expanded=${String(this._overflowOpen)}
                aria-controls="map-options"
                @click=${()=>{this._overflowOpen=!this._overflowOpen}}
              >${A(It)}</button>
              ${this._overflowOpen?b`
                <div id="map-options" class="overflow-menu ms-surface ms-surface--overlay">
                  <label class="overflow-field ms-field">${this.#e("map_quality_label","Scene detail")}
                    <select
                      aria-label=${this.#e("map_quality_label","Scene detail")}
                      .value=${e.quality}
                      @change=${g=>this.#i({type:"set-quality",quality:g.currentTarget.value})}
                    >
                      <option value="auto">${this.#e("map_quality_auto","Auto detail")}</option>
                      <option value="efficient">${this.#e("map_quality_efficient","Efficient")}</option>
                      <option value="balanced">${this.#e("map_quality_balanced","Balanced")}</option>
                      <option value="maximum">${this.#e("map_quality_maximum","Maximum")}</option>
                    </select>
                  </label>
                  <button class="ms-row ms-row--menu" type="button" @click=${()=>this.#z("support")}>${this.#e("v4_map_diagnostics","Map diagnostics")}</button>
                  <button class="ms-row ms-row--menu" type="button" @click=${()=>this.#z("classic")}>${this.#e("v4_switch_classic","Open classic map view")}</button>
                  <button class="ms-row ms-row--menu" type="button" @click=${()=>this.#z("fullscreen")}>${this._browserFullscreen?this.#e("v4_leave_full_screen","Leave full screen"):this.#e("v4_full_screen","Full screen")}</button>
                </div>
              `:_}
            </div>
          </header>

          <main class=${`workspace ${e.fullMap?"full-map":""}`} style=${w}>
            <div class="canvas">
              <${Mn}
                class="map-canvas"
                style=${w}
                .state=${e}
                .localize=${this.localize}
                .narrow=${n}
              >${this.#V(e)}
                ${n&&!e.fullMap&&this._sheetDetent==="full"?b`
                  <button
                    class="sheet-scrim"
                    slot="scrim"
                    data-map-control
                    type="button"
                    aria-label=${this.#e("v4_collapse_sheet","Collapse the map workspace")}
                    @click=${()=>this.#f("peek")}
                  ></button>
                `:_}
              </${Mn}>
              ${!n&&S?b`
                <div class="precision-popover">
                  <${ze} compact .state=${e} .localize=${this.localize}></${ze}>
                </div>
              `:_}
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
              data-detent=${n?this._sheetDetent:_}
              data-workflow=${e.workflow}
              aria-label="Map workspace"
            >
              ${n?b`
                <div
                  class="sheet-grip"
                  @pointerdown=${this.#H}
                  @pointermove=${this.#y}
                  @pointerup=${this.#C}
                  @pointercancel=${this.#C}
                >
                  <span class="sheet-handle" role="presentation"></span>
                  ${e.workflow!=="none"&&this._sheetDetent==="peek"?b`
                    <button
                      class="sheet-back ms-btn ms-btn--icon ms-btn--sm"
                      type="button"
                      aria-label=${e.workflow==="plan"?this.#e("v4_back_to_plans","Back to plans"):this.#e("v4_back_to_all_tasks","Back to all tasks")}
                      title=${e.workflow==="plan"?this.#e("v4_back_to_plans","Back to plans"):this.#e("v4_back_to_all_tasks","Back to all tasks")}
                      data-dialog-launcher="discardDraft"
                      @click=${g=>this.#p(e.workflow==="plan"?"plans":"none",g.currentTarget)}
                    >${A(ke)}</button>
                  `:_}
                  <span class="sheet-status">${this.#J(e,r)}</span>
                  <button
                    class="ms-btn ms-btn--icon ms-btn--sm"
                    type="button"
                    aria-label=${this.#e("v4_show_more","Show more of the map workspace")}
                    aria-controls="sheet-body"
                    aria-disabled=${this._sheetDetent==="full"?"true":_}
                    @click=${()=>this.#I(1)}
                  >${A(Lt)}</button>
                  <button
                    class="ms-btn ms-btn--icon ms-btn--sm"
                    type="button"
                    aria-label=${this.#e("v4_show_less","Show less of the map workspace")}
                    aria-controls="sheet-body"
                    aria-disabled=${this._sheetDetent==="peek"?"true":_}
                    @click=${()=>this.#I(-1)}
                  >${A(Ot)}</button>
                </div>
                ${k?b`
                  <div class="sheet-tools">
                    ${zt(e,{intent:g=>this.#i(g),openBrush:()=>this.#oe(),t:(g,M)=>this.#e(g,M)},"grid")}
                    ${S?b`
                      <div class="precision-popover">
                        <${ze} compact inline .state=${e} .localize=${this.localize}></${ze}>
                      </div>
                    `:_}
                  </div>
                `:_}
                <div
                  class="sheet-body"
                  id="sheet-body"
                  @pointerdown=${this.#O}
                  @pointermove=${this.#$}
                  @pointerup=${this.#N}
                  @pointercancel=${this.#N}
                >
                  ${this.#re(e,n)}
                </div>
                ${this.#te(e,l,d)}
              `:b`
                <div class="status-strip">
                  <span class="status-icon" aria-hidden="true">${A(r.icon)}</span>
                  <span class="status-copy"><strong>${r.title}</strong><small>${r.detail}</small></span>
                  ${a?this.#W(a,"status-action ms-btn ms-btn--secondary","status-reason"):_}
                </div>
                <section class="workflow">
                  <div class="workflow-body">${this.#re(e,n)}</div>
                  ${this.#te(e,l,d)}
                </section>
              `}
            </aside>

            ${e.fullMap?b`
              <section
                class=${`full-map-hud ms-surface ms-surface--floating ${i?"has-secondary":""} ${!n&&(e.workflow==="draw"||e.workflow==="rooms"&&e.selection.roomIds.length>0)?"above-dock":""}`}
                aria-label="Robot status and action"
              >
                <span class="hud-copy"><strong>${r.title}</strong><small>${r.detail}</small></span>
                ${u&&o.id!=="stop"?_:this.#W(o,"ms-btn ms-btn--lg ms-btn--primary","hud-reason")}
                ${i&&(!u||i.id==="stop")?this.#W(i,"ms-btn ms-btn--lg ms-btn--secondary","hud-secondary-reason"):_}
              </section>
            `:_}
          </main>
        </div>

        <div class="sr-only" aria-live="polite" aria-atomic="true">${[this._announcement,e.notice?.text??""].filter(Boolean).join(" ")}</div>

        ${this._helpOpen?this.#K():_}

        ${y?b`
          <div class="dialog-backdrop">
            <section
              class="dialog ms-surface ms-surface--overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="dialog-title"
              aria-describedby="dialog-detail"
              @keydown=${this.#_}
            >
              <h2 id="dialog-title">${y.title}</h2>
              <p id="dialog-detail">${y.detail}</p>
              <div class="dialog-actions">
                <button
                  class="ms-btn ms-btn--secondary"
                  type="button"
                  data-dialog-initial-focus
                  @click=${e.dialog==="discardDraft"?this.#w:this.#a}
                >${y.cancelLabel}</button>
                ${y.action===null?_:b`
                  <button
                    class="discard ms-btn ms-btn--primary ms-btn--danger"
                    type="button"
                    @click=${()=>this.#A(y)}
                  >${y.confirmLabel}</button>
                `}
              </div>
            </section>
          </div>
        `:_}
      </div>
    `}};customElements.get(ae)||customElements.define(ae,vt);var Tn=J(ae),yt=class extends Y{constructor(){super(...arguments);this.narrow=!1;this._workspace=D();this._classic=!1;this.entryOverride=null;this.#e=new Re;this.#t=new kt(this._workspace);this.#n=null;this.#s=null;this.#o=null;this.#r=null;this.#d=null;this.#u=""}static{this.styles=[X,G,j`
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
`]}static{this.properties={hass:{attribute:!1},narrow:{type:Boolean},route:{attribute:!1},panel:{attribute:!1},_workspace:{state:!0},_classic:{state:!0},entryOverride:{state:!0}}}#e;#t;#n;#s;#o;#r;#d;#u;shouldUpdate(e){if(this._classic||!e.has("hass")||[...e.keys()].some(r=>r!=="hass"))return!0;let n=e.get("hass");return n?.connection!==this.hass?.connection||n?.localize!==this.hass?.localize?!0:this.#e.project(this.hass,this.panel,this.entryOverride)!==this.#n}connectedCallback(){super.connectedCallback(),this._classic=mn()==="v3",this.#s=this.#t.subscribe(e=>{this._workspace=e,this.#g(e)}),this._classic||this.#m()}disconnectedCallback(){this.#s?.(),this.#s=null,this.#c(),super.disconnectedCallback()}#m(){if(!this.#r&&(this.#n=this.#e.project(this.hass,this.panel,this.entryOverride),this.#o=new $e(()=>this.hass),this.#r=new qe(this.#t,this.#o,this.hass?.connection??null),this.#d=new Ne(this.#t),this.#d.start(),this.#n)){this.#r.sync(this.#n,this.panel);let{host:e}=this.#n;e.connected&&e.administrator&&e.robotCount>0&&this.#r.refreshCatalog(this.#t.value.selection.floorId==="current")}}#c(){this.#d?.dispose(),this.#d=null,this.#r?.dispose(),this.#r=null,this.#o=null}#g(e){if(!this.#r)return;let n={version:4,view:e.view,appearance:e.appearance,labels:e.labelsVisible,quality:e.quality,cameras:e.cameras},r=JSON.stringify(n);r!==this.#u&&(this.#u=r,this.#r.schedulePreferences(n))}willUpdate(e){if(e.has("hass")||e.has("panel")||e.has("entryOverride")){let n=e.get("hass"),r=e.has("hass")&&n?.connection!==this.hass?.connection,o=this.#e.project(this.hass,this.panel,this.entryOverride),i=o!==this.#n;if(i){this.#n=o;let a=o.host.connected?o.host.robotCount===0?"unavailable":o.host.administrator?"verifying":"blocked":"degraded";this.#t.replace({...this.#t.value,coherence:a,activity:o.activity,batteryPercent:o.batteryPercent,host:o.host,fullMap:o.host.administrator&&o.host.robotCount>0&&this.#t.value.fullMap,robotLabel:o.robotLabel,robots:o.robots,locale:o.language})}!this._classic&&r?(this.#c(),this.#m()):!this._classic&&(i||e.has("panel")||e.has("entryOverride"))&&this.#r?.sync(o,this.panel)}e.has("narrow")&&this.#t.value.narrowHint!==this.narrow&&this.#t.dispatch({type:"set-narrow-hint",value:this.narrow})}#R(e){if(!ye(e.detail))return;e.stopPropagation();let n=e.detail;if(n.type==="dismiss-top-layer"||n.type==="exit-full-map"){this.#d?.dismissTop()||this.#t.dispatch(n);return}if(n.type==="open-workflow"&&n.workflow!=="none"){this.#r?.openWorkflow(n.workflow);return}if(n.type==="set-floor"){this.#r?.selectFloor(n.floorId);return}if(n.type==="select-entry"){if(!this._workspace.robots.some(r=>r.entryId===n.entryId))return;this.entryOverride=n.entryId;return}if(n.type==="set-history"){this.#r?.selectHistory(n.historyId);return}if(n.type==="select-plan"){this.#r?.selectPlan(n.planId);return}if(n.type==="select-area"){this.#r?.selectArea(n.areaId),n.workflow==="areaReview"&&this.#r?.openWorkflow("areaReview");return}this.#t.dispatch(n)}#x(e){if(e.stopPropagation(),typeof e.detail?.id=="string"){if(e.detail.id==="use-classic"){ct("v3")&&(this.#c(),this._classic=!0);return}e.detail.id==="reset-room-cadence"&&"planId"in e.detail&&"roomId"in e.detail&&"mode"in e.detail?this.#r?.executeAction(e.detail):this.#r?.executeAction(e.detail.id),this.dispatchEvent(new CustomEvent("matic-map-v4-action-requested",{detail:{id:e.detail.id},bubbles:!0,composed:!0}))}}#l(){ct("v4")&&(this._classic=!1,this.#m(),this.requestUpdate())}updated(){if(!this._classic)return;let e=this.renderRoot.querySelector("matic-map-panel-v0-3-1");e&&(e.hass=this.hass,e.narrow=this.narrow,e.route=this.route,e.panel=this.panel)}getWorkspaceSnapshot(){return this.#t.value}render(){return this._classic?b`
        <div class="classic">
          <button class="return-v4" type="button" @click=${this.#l}>${z(this.hass?.localize,"v4_use_new","Use Map Studio 0.4")}</button>
          <matic-map-panel-v0-3-1></matic-map-panel-v0-3-1>
        </div>
      `:b`
      <${Tn}
        .state=${this._workspace}
        .localize=${this.hass?.localize}
        @matic-workspace-intent=${this.#R}
        @matic-workspace-action=${this.#x}
      ></${Tn}>
    `}};customElements.get(Je)||customElements.define(Je,yt);export{Re as a,J as b,b as c,yt as d};
/*! Bundled license information:

lit-html/static.js:
  (**
   * @license
   * Copyright 2020 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/
