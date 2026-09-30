import{a as ke,b as ae,c as le,d as ce,e as rt,f as $t,g as Ft,h as Kt,i as Bt,j as ue,k as Ut}from"./chunk-4VY5WUMQ.js";import{A as Pt,B as Et,C as Mt,D as At,H as Y,I as _e,J as It,K as Tt,M as _,O as X,P as G,Q,R as Se,S as de,T as Re,U as Lt,V as Ot,W as Dt,X as Ce,Y as qt,Z as Nt,c as se,d as Qe,e as Je,f as Ze,h as ge,i as j,l as q,m as Rt,n as et,o as tt,pa as zt,q as Ct,qa as ot,r as xt,ra as st,sa as Wt,t as be,ta as it,ua as at,v as ie,va as Ht,wa as F,xa as I,y as nt,ya as V,z as we}from"./chunk-OTYJ26W5.js";var Hn=(s,t)=>{if(t?.recharge_and_resume===!0&&t?.charging===!0)return"recharging";switch(s){case"cleaning":return"cleaning";case"paused":return"paused";case"returning":return"returning";case"docked":return"docked";case"idle":return"idle";case"error":return"problem";default:return"unknown"}},Fn=s=>typeof s!="number"||!Number.isFinite(s)?null:Math.round(Math.max(0,Math.min(100,s))),Kn=s=>{let t=s.attributes?.matic_entry_id;return typeof t=="string"&&t.length>0?t:null},Bn=s=>String(s||"local-user").replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",Vt=s=>{if(typeof s!="string")return"Matic robot";let t=s.trim();return t&&Array.from(t).length<=128&&!/[\u0000-\u001f\u007f]/u.test(t)?t:"Matic robot"},xe=class{#e="";#t=null;project(t,e,n=null){let r=t?.states??{},o=e?.config?.entry_id,a=n||(typeof o=="string"?o:null),l=null,d=null,c=a,u=new Map;for(let[y,C]of Object.entries(r)){let $=Kn(C);$&&y.startsWith("vacuum.")&&(u.set($,{entryId:$,label:Vt(C.attributes?.friendly_name)}),(a?$===a:!l)&&(l=C,d=y,c=$))}let h={connected:t?.connected!==!1,administrator:t?.user?.is_admin===!0,robotConnected:l!==null&&l.state!=="unavailable"&&l.state!=="unknown",robotCount:u.size},m=l?Hn(l.state,l.attributes):"unknown",v=Fn(l?.attributes?.battery_level),k=t?.selectedLanguage||t?.language||"en",g=Bn(t?.user?.id),b=Vt(l?.attributes?.friendly_name),R=[...u.values()].sort((y,C)=>y.label.localeCompare(C.label,k,{sensitivity:"base"})),S=[h.connected,h.administrator,h.robotConnected,h.robotCount,m,v??"none",k,g,d??"none",c??"none",b,R.map(y=>`${y.entryId}:${y.label}`).join(",")].join("|");return S===this.#e&&this.#t?this.#t:(this.#e=S,this.#t={host:h,activity:m,batteryPercent:v,language:k,userKey:g,vacuumEntityId:d,entryKey:c,robotLabel:b,robots:R},this.#t)}};var Yt=Symbol.for(""),Un=s=>{if(s?.r===Yt)return s?._$litStatic$},J=s=>({_$litStatic$:s,r:Yt});var jt=new Map,lt=s=>(t,...e)=>{let n=e.length,r,o,i=[],a=[],l,d=0,c=!1;for(;d<n;){for(l=t[d];d<n&&(o=e[d],(r=Un(o))!==void 0);)l+=r+t[++d],c=!0;d!==n&&a.push(o),i.push(l),d++}if(d===n&&i.push(t[n]),c){let u=i.join("$$lit$$");(t=jt.get(u))===void 0&&(i.raw=i,jt.set(u,t=i)),e=a}return s(t,...e)},w=lt(_e),Mr=lt(It),Ar=lt(Tt);var Xt="/api/matic_robot/slam_entries",Me=24,Gt=8,dt=15e5,Qt=16*1024*1024,f=class extends Error{constructor(t){super(t),this.name="ContractError",this.code=t}},P=(s,t)=>{if(!s||typeof s!="object"||Array.isArray(s))throw new f(t);return s},x=(s,t,e)=>{if(typeof s!="string")throw new f(e);let n=s.trim();if(!n||Array.from(n).length>t||/[\u0000-\u001f\u007f]/u.test(n))throw new f(e);return n},Vn=s=>{if(s==null||s==="")return null;try{return x(s,128,"invalid-floor-label")}catch{return null}},Z=(s,t,e,n)=>{if(typeof s!="number"||!Number.isFinite(s)||s<t||s>e)throw new f(n);return s},T=(s,t,e,n)=>{let r=Z(s,t,e,n);if(!Number.isInteger(r))throw new f(n);return r},ct=(s,t)=>s==null?null:T(s,1,t,"invalid-floor-ordinal"),M=(s,t)=>{if(typeof s!="boolean")throw new f(t);return s},Pe=(s,t)=>s===void 0?!1:M(s,t),jn=(s,t)=>s===null?null:M(s,t),Jt=s=>{if(s==null)return null;let t=x(s,64,"invalid-map-session-key");if(!/^[0-9a-f]{64}$/u.test(t))throw new f("invalid-map-session-key");return t},Yn=s=>{if(s==null)return null;if(s==="bootstrap_empty"||s==="map_session_unverified"||s==="floor_plan_unavailable"||s==="floor_plan_mismatch")return s;throw new f("invalid-map-block-reason")},Xn=s=>{if(s===void 0)return"not_started";if(s==="not_started"||s==="running"||s==="complete"||s==="partial"||s==="failed")return s;throw new f("invalid-bootstrap-state")},W=(s,t)=>{let e=x(s,512,t);if(!e.startsWith("/")||e.startsWith("//")||e.includes("\\"))throw new f(t);return e},Gn=s=>{let t=typeof s.map_health=="string"?s.map_health.toLowerCase():"",e=typeof s.stream_state=="string"?s.stream_state.toLowerCase():"",n=typeof s.invalid_tiles=="number"?s.invalid_tiles:0;return t.includes("error")||t.includes("fail")||t.includes("degrad")||n>0?"problem":s.map_truncated===!0||t.includes("truncat")||t.includes("limit")?"limited":s.map_complete===!0?"ready":e.includes("connect")||e.includes("collect")||e.includes("run")?"building":"unknown"},Ae=s=>{let t=P(s,"invalid-catalog");if(!Array.isArray(t.entries)||t.entries.length>64)throw new f("invalid-catalog-entries");return t.entries.map(e=>{let n=P(e,"invalid-catalog-entry"),r=T(n.map_revision,0,Number.MAX_SAFE_INTEGER,"invalid-map-revision");return{entryId:x(n.entry_id,128,"invalid-entry-id"),sceneUrl:W(n.scene_url,"invalid-scene-url"),deltaUrl:n.delta_url===void 0||n.delta_url===null?null:W(n.delta_url,"invalid-delta-url"),poseUrl:W(n.pose_url,"invalid-pose-url"),historyUrl:W(n.history_url,"invalid-history-url"),areasUrl:W(n.areas_url,"invalid-areas-url"),plansUrl:W(n.plans_url,"invalid-plans-url"),mapRevision:r,mapFloorCoherent:M(n.map_floor_coherent,"invalid-floor-coherence"),mapSessionVerified:M(n.map_session_verified,"invalid-session-state"),mapSessionKey:Jt(n.map_session_key),mapBlockReason:Yn(n.map_block_reason),runnerLocked:M(n.runner_locked,"invalid-runner-lock"),stopSettlePending:M(n.stop_settle_pending,"invalid-stop-settle"),activePlan:M(n.active_plan,"invalid-active-plan"),nativeReconciliationPending:M(n.native_reconciliation_pending,"invalid-native-reconciliation"),nativeSessionActive:jn(n.native_session_active,"invalid-native-session"),mapComplete:M(n.map_complete,"invalid-map-complete"),mapTruncated:M(n.map_truncated,"invalid-map-truncated"),selectedFloorOrdinal:ct(n.selected_floor_ordinal,128),mapFloorOrdinal:ct(n.map_floor_ordinal,128),historyCount:T(n.history_count,0,12,"invalid-history-count"),historyFloorCount:T(n.history_floor_count,0,128,"invalid-floor-count"),health:Gn(n),streamFailures:T(n.stream_failures,0,Number.MAX_SAFE_INTEGER,"invalid-stream-failures"),bootstrapState:Xn(n.bootstrap_state),bootstrapPhotoSeen:n.bootstrap_photo_seen===void 0?!1:M(n.bootstrap_photo_seen,"invalid-bootstrap-photo"),bootstrapStructureSeen:n.bootstrap_structure_seen===void 0?!1:M(n.bootstrap_structure_seen,"invalid-bootstrap-structure"),bootstrapFailures:n.bootstrap_failures===void 0?0:T(n.bootstrap_failures,0,2,"invalid-bootstrap-failures")}})},Zt=(s,t)=>{if(!Array.isArray(s)||s.length!==2)throw new f(t);return[Z(s[0],-1e6,1e6,t),Z(s[1],-1e6,1e6,t)]},Qn=(s,t)=>{if(!Array.isArray(s)||s.length<3||s.length>8192)throw new f(t);return s.map(e=>Zt(e,t))},en=(s,t)=>{if(!Array.isArray(s)||s.length>256)throw new f("invalid-rooms");return s.map(e=>{let n=P(e,"invalid-room");return{roomId:x(n.room_id,128,"invalid-room-id"),name:x(n.name,128,"invalid-room-name"),boundary:t?Qn(n.boundary,"invalid-room-boundary"):[]}})},Jn=s=>{let t=P(s,"invalid-history-snapshot"),e=x(t.created_at,64,"invalid-history-time");if(!Number.isFinite(Date.parse(e)))throw new f("invalid-history-time");return{id:x(t.id,128,"invalid-history-id"),createdAt:e,revision:T(t.revision,0,Number.MAX_SAFE_INTEGER,"invalid-history-revision"),pointCount:T(t.point_count,1,dt,"invalid-history-points"),sceneUrl:W(t.scene_url,"invalid-history-scene-url")}},tn=s=>{let t=P(s,"invalid-history");if(!Array.isArray(t.floors)||t.floors.length<1||t.floors.length>128)throw new f("invalid-history-floors");return{entryId:x(t.entry_id,128,"invalid-history-entry"),liveAvailable:M(t.live_available,"invalid-history-live"),floors:t.floors.map(e=>{let n=P(e,"invalid-history-floor");if(!Array.isArray(n.snapshots)||n.snapshots.length>12)throw new f("invalid-history-snapshots");return{id:x(n.id,128,"invalid-history-floor-id"),active:M(n.active,"invalid-history-floor-active"),readOnly:M(n.read_only,"invalid-history-floor-read-only"),liveAvailable:n.live_available===void 0?!1:M(n.live_available,"invalid-history-floor-live"),label:Vn(n.label),ordinal:n.ordinal===void 0?null:ct(n.ordinal,128),snapshots:n.snapshots.map(Jn)}})}},Ie=s=>{if(s==="vacuum"||s==="mop"||s==="vacuum_and_mop")return s;throw new f("invalid-cleaning-mode")},he=s=>{if(s==="quick"||s==="standard"||s==="heavy_duty")return s;throw new f("invalid-coverage-setting")},Ee=(s,t)=>s==null?null:T(s,1,100,t),Te=s=>{if(s==null)return[];let t=["mop_due","coverage_due","room_not_on_current_map","identity_changed","shared_schedule_unavailable","mop_progress_unverified","coverage_progress_unverified","invalid_cadence_policy"];if(!Array.isArray(s)||s.length>t.length||s.some(e=>!t.includes(e)))throw new f("invalid-cadence-reasons");return[...new Set(s)]},nn=s=>{if(s==null)return;let t=P(s,"invalid-room-cadence"),e=t.scope===void 0?"plan":t.scope;if(e!=="plan"&&e!=="shared")throw new f("invalid-room-cadence-scope");let n=t.periodic_coverage_setting;return{scope:e,mopEveryN:Ee(t.mop_every_n,"invalid-mop-interval"),coverageEveryN:Ee(t.coverage_every_n,"invalid-coverage-interval"),periodicCoverageSetting:n==null?null:he(n),doMopNext:Pe(t.do_mop_next,"invalid-do-mop-next"),doCoverageNext:Pe(t.do_coverage_next,"invalid-do-coverage-next")}},ut=(s,t)=>{if(s==null)return;let e=P(s,"invalid-room-cadence-progress"),n=e.effective_cleaning_mode,r=e.effective_coverage_setting,o=Te(t??e.cadence_reasons);return{mopProgress:T(e.mop_progress??0,0,100,"invalid-mop-progress"),coverageProgress:T(e.coverage_progress??0,0,100,"invalid-coverage-progress"),mopDue:Pe(e.mop_due,"invalid-mop-due"),coverageDue:Pe(e.coverage_due,"invalid-coverage-due"),nextMopIn:Ee(e.next_mop_in,"invalid-next-mop"),nextCoverageIn:Ee(e.next_coverage_in,"invalid-next-coverage"),reasons:o,...n===void 0?{}:{effectiveCleaningMode:Ie(n)},...r===void 0?{}:{effectiveCoverageSetting:he(r)}}},Zn=s=>{let t=P(s,"invalid-plan-room"),e=nn(t.cadence),n=ut(t.cadence_progress,t.cadence_reasons),r=Te(t.cadence_reasons);return{roomId:x(t.room_id,128,"invalid-plan-room-id"),cleaningMode:Ie(t.cleaning_mode),coverageSetting:he(t.coverage_setting),...e===void 0?{}:{cadence:e},...n===void 0?{}:{cadenceProgress:n},...r.length?{cadenceReasons:r}:{}}},rn=s=>{if(s==null)return;let t=P(s,"invalid-plan-preview");if(!Array.isArray(t.rooms)||t.rooms.length>100||!Array.isArray(t.mission_boundaries)||t.mission_boundaries.length>99)throw new f("invalid-plan-preview");let e=t.rooms.map(a=>{let l=P(a,"invalid-plan-preview-room");return{roomId:x(l.room_id,128,"invalid-plan-preview-room-id"),name:x(l.name,128,"invalid-plan-preview-room-name"),cleaningMode:Ie(l.cleaning_mode),coverageSetting:he(l.coverage_setting),cadenceReasons:Te(l.cadence_reasons)}}),n=t.mission_boundaries.map(a=>T(a,1,Math.max(1,e.length-1),"invalid-plan-preview-boundary"));if(n.some((a,l)=>a>=e.length||a<=(n[l-1]??0)))throw new f("invalid-plan-preview-boundary-order");let r=["cadence_identity_unavailable","preview_unavailable","plan_disabled","plan_has_no_rooms","plan_room_limit","cadence_identity_changed","shared_schedule_unavailable","cadence_progress_unverified","invalid_cadence_policy","invalid_plan"],o=t.blocker;if(o!==null&&!r.includes(o))throw new f("invalid-plan-preview-blocker");if(o===null&&e.length===0)throw new f("empty-plan-preview");let i=t.preview_token;if(i!==void 0&&(typeof i!="string"||!/^[0-9a-f]{64}$/u.test(i)))throw new f("invalid-plan-preview-token");return{rooms:e,missionBoundaries:n,blocker:o,...typeof i=="string"?{previewToken:i}:{}}},on=s=>{let t=P(s,"invalid-room-sequence-preview"),e=x(t.entry_id,128,"invalid-room-sequence-preview-entry"),n=x(t.floor_token,128,"invalid-room-sequence-preview-floor"),r=x(t.preview_token,64,"invalid-room-sequence-preview-token");if(!/^[0-9a-f]{64}$/u.test(n)||!/^[0-9a-f]{64}$/u.test(r))throw new f("invalid-room-sequence-preview-token");let o=rn({rooms:t.rooms,mission_boundaries:t.mission_boundaries,blocker:t.blocker});if(!o)throw new f("invalid-room-sequence-preview");let i=t.rooms;if(!Array.isArray(i))throw new f("invalid-room-sequence-preview-rooms");let a=o.rooms.map((l,d)=>{let c=P(i[d],"invalid-room-sequence-preview-room"),u=ut(c.cadence_progress,c.cadence_reasons);return{...l,...u===void 0?{}:{cadenceProgress:u}}});return{entryId:e,floorToken:n,previewToken:r,rooms:a,missionBoundaries:o.missionBoundaries,blocker:o.blocker}},er=s=>{if(s==null)return null;if(!Array.isArray(s)||s.length<3||s.length>64)throw new f("invalid-area-outline");let t={closed:!0,points:s.map(e=>{let n=P(e,"invalid-area-outline");if(typeof n.x!="number"||typeof n.y!="number")throw new f("invalid-area-outline");return{x:n.x,y:n.y}})};if(!$t(t))throw new f("invalid-area-outline");return t},tr=s=>{let t=P(s,"invalid-area-circle");return{x:Z(t.x,-1e6,1e6,"invalid-area-circle"),y:Z(t.y,-1e6,1e6,"invalid-area-circle"),radius:Z(t.radius,.05,2.5,"invalid-area-circle")}},nr=s=>s==="current"||s==="review"||s==="stale"?s:"unknown",sn=s=>{let t=P(s,"invalid-areas");if(!Array.isArray(t.areas)||t.areas.length>256)throw new f("invalid-area-list");return{sceneUrl:W(t.scene_url,"invalid-area-scene-url"),rooms:en(t.rooms,!0),areas:t.areas.map(e=>{let n=P(e,"invalid-area");if(!Array.isArray(n.circles)||n.circles.length>512)throw new f("invalid-area-circles");return{id:x(n.id,128,"invalid-area-id"),name:x(n.name,128,"invalid-area-name"),circles:n.circles.map(tr),outline:er(n.outline),cleaningMode:Ie(n.cleaning_mode),coverageSetting:he(n.coverage_setting),status:nr(n.status),canRebind:M(n.can_rebind,"invalid-area-rebind")}})}},an=s=>{let t=P(s,"invalid-plan-save-response"),e=P(t.response,"invalid-plan-save-response"),n=P(e.plan,"invalid-plan-save-response");return x(n.id,128,"invalid-plan-save-response")},ln=s=>{let t=P(s,"invalid-plans");if(!Array.isArray(t.plans)||t.plans.length>256)throw new f("invalid-plan-list");let e=t.rooms;return{rooms:en(e,!1).map((r,o)=>{let i=Array.isArray(e)?e[o]:void 0,a=P(i,"invalid-room"),l=nn(a.shared_cadence),d=ut(a.shared_cadence_progress,a.shared_cadence_reasons),c=Te(a.shared_cadence_reasons);return{roomId:r.roomId,name:r.name,...l===void 0?{}:{sharedCadence:l},...d===void 0?{}:{sharedCadenceProgress:d},...c.length?{sharedCadenceReasons:c}:{}}}),selectedPlan:t.selected_plan===null||t.selected_plan===void 0?null:x(t.selected_plan,128,"invalid-selected-plan"),plans:t.plans.map(r=>{let o=P(r,"invalid-plan");if(!Array.isArray(o.rooms)||o.rooms.length>256||!Array.isArray(o.room_order))throw new f("invalid-plan-rooms");let i=o.run_behavior;if(i!=="intelligent"&&i!=="ordered")throw new f("invalid-run-behavior");let a=rn(o.next_run_preview);return{id:x(o.id,128,"invalid-plan-id"),name:x(o.name,128,"invalid-plan-name"),enabled:M(o.enabled,"invalid-plan-enabled"),runBehavior:i,rooms:o.rooms.map(l=>Zn(l)),roomOrder:o.room_order.slice(0,256).map(l=>x(l,128,"invalid-room-order")),returnToBase:M(o.return_to_base,"invalid-return-to-base"),finishCurrentRoom:M(o.finish_current_room,"invalid-finish-room"),finishCurrentRoomThreshold:T(o.finish_current_room_threshold,0,100,"invalid-finish-threshold"),...a===void 0?{}:{nextRunPreview:a}}})}},cn=s=>{let t=P(s,"invalid-pose"),e=t.position,n=e===null?null:Zt(e,"invalid-pose-position"),r=t.pose_freshness;if(r!=="live"&&r!=="coordinator_fallback")throw new f("invalid-pose-freshness");return{position:n,source:x(t.source,64,"invalid-pose-source"),revision:T(t.revision,0,Number.MAX_SAFE_INTEGER,"invalid-pose-revision"),poseRevision:T(t.pose_revision,0,Number.MAX_SAFE_INTEGER,"invalid-pose-sequence"),floorCoherent:M(t.map_floor_coherent,"invalid-pose-floor"),mapSessionKey:Jt(t.map_session_key),freshness:r}},dn=s=>{try{return W(s,"invalid-private-path"),!0}catch{return!1}};var un=s=>{let o=()=>{throw new Error("invalid-scene")};(!(s instanceof ArrayBuffer)||s.byteLength<24||s.byteLength>16777216)&&o();let i=new DataView(s),a=new Uint8Array(s,0,8),l=String.fromCharCode(...a),d=i.getUint16(8,!0),c=i.getUint16(10,!0),u=i.getUint32(12,!0),h=i.getUint32(16,!0),m=i.getUint32(20,!0),v=h+m,k=24+u;(l!=="MATIC3D\0"||d!==1||c!==8||u>1024*1024||v<1||v>15e5||k+v*c!==s.byteLength)&&o();let g;try{g=JSON.parse(new TextDecoder("utf-8",{fatal:!0}).decode(new Uint8Array(s,24,u)))}catch{o()}(!g||typeof g!="object"||Array.isArray(g))&&o();let b=g,R=b.meters_per_cell,S=b.origin_cells,y=b.span_cells;(typeof R!="number"||!Number.isFinite(R)||R<.001||R>.1||!Array.isArray(S)||S.length!==2||!S.every(O=>typeof O=="number"&&Number.isFinite(O))||!Array.isArray(y)||y.length!==2||!y.every(O=>typeof O=="number"&&Number.isFinite(O)&&O>=1&&O<=65536))&&o();let $=(Array.isArray(b.rooms)?b.rooms.slice(0,128):[]).flatMap((O,Wn)=>{if(!O||typeof O!="object"||Array.isArray(O))return[];let U=O,ye=typeof U.name=="string"?U.name.trim():"";if(!ye||Array.from(ye).length>128||/[\u0000-\u001f\u007f]/u.test(ye))return[];if(!Array.isArray(U.boundary)||U.boundary.length<3||U.boundary.length>8192)return[];let St=U.boundary.flatMap(Ye=>{if(!Array.isArray(Ye)||Ye.length!==2)return[];let[Xe,Ge]=Ye;return typeof Xe=="number"&&Number.isFinite(Xe)&&typeof Ge=="number"&&Number.isFinite(Ge)?[[Xe,Ge]]:[]}),Ue=U.center;if(St.length<3||!Array.isArray(Ue)||Ue.length!==2)return[];let[Ve,je]=Ue;return typeof Ve!="number"||!Number.isFinite(Ve)||typeof je!="number"||!Number.isFinite(je)?[]:[{id:`scene-room-${Wn+1}`,name:ye,boundary:St,center:[Ve,je]}]}),zn=typeof b.sample_step=="number"&&Number.isInteger(b.sample_step)?Math.max(1,Math.min(15e5,b.sample_step)):1,_t=S,kt=y;return{buffer:s,pointOffset:k,floorCount:h,surfaceCount:m,total:v,metadata:{metersPerCell:R,origin:[_t[0],_t[1]],span:[kt[0],kt[1]],sampleStep:zn,rooms:$}}},rr=s=>{if(s.byteLength>Qt||s.byteLength<Me||Gt!==8||dt!==15e5)throw new f("invalid-scene");try{return un(s)}catch{throw new f("invalid-scene")}},or=()=>`
  const parseTransfer = ${un.toString()};
  self.onmessage = (event) => {
    const { id, buffer } = event.data;
    try {
      const parsed = parseTransfer(buffer);
      self.postMessage({ id, ok: true, parsed }, [parsed.buffer]);
    } catch (_) {
      self.postMessage({ id, ok: false, problem: "invalid-scene" });
    }
  };
`,$e=class{#e=null;#t=null;#r=0;#o=new Map;constructor(){if(!(typeof Worker!="function"||typeof URL?.createObjectURL!="function"))try{this.#t=URL.createObjectURL(new Blob([or()],{type:"text/javascript"})),this.#e=new Worker(this.#t),this.#e.onmessage=t=>{let e=this.#o.get(t.data.id);e&&(this.#o.delete(t.data.id),t.data.ok&&t.data.parsed?e.resolve(t.data.parsed):e.reject(new f(t.data.problem||"invalid-scene")))},this.#e.onerror=()=>this.#s("scene-worker-failed")}catch{this.#e=null,this.#t&&URL.revokeObjectURL(this.#t),this.#t=null}}async parse(t,e){if(e?.aborted)throw new DOMException("Aborted","AbortError");if(!this.#e){if(await new Promise(r=>window.setTimeout(r,0)),e?.aborted)throw new DOMException("Aborted","AbortError");return rr(t)}let n=++this.#r;return new Promise((r,o)=>{let i=()=>{this.#o.delete(n),o(new DOMException("Aborted","AbortError"))};e?.addEventListener("abort",i,{once:!0}),this.#o.set(n,{resolve:a=>{e?.removeEventListener("abort",i),r(a)},reject:a=>{e?.removeEventListener("abort",i),o(a)}}),this.#e?.postMessage({id:n,buffer:t},[t])})}#s(t){for(let e of this.#o.values())e.reject(new f(t));this.#o.clear(),this.#e?.terminate(),this.#e=null}dispose(){this.#s("scene-parser-disposed"),this.#t&&URL.revokeObjectURL(this.#t),this.#t=null}};var N={catalog:1e4,scene:6e4,delta:35e3,pose:1e4,history:15e3,workflow:15e3,mutation:2e4,roomPreview:15e3},sr=2,pe=new WeakMap,hn={coverage_identity_unavailable:"Could not verify the current cleaning task. Check the robot status, then try again.",coverage_activity_unavailable:"Could not verify whether the robot is cleaning. Check the robot status, then try again.",coverage_native_session_active:"The robot already has a cleaning task. Wait for it to finish before starting another cleaning task.",coverage_identity_changed:"The cleaning task changed during setup. Check the robot status, then try again."},ir=(s,t)=>{if(!s||typeof s!="object")return null;let e=s;if(e.translation_domain!=="matic_robot"||typeof e.translation_key!="string"||!Object.hasOwn(hn,e.translation_key))return null;let n=e.translation_key,r=hn[n];try{let o=t?.(`component.matic_robot.exceptions.${n}.message`);o&&o!==`component.matic_robot.exceptions.${n}.message`&&(r=o)}catch{}return new E(n,null,r)},E=class extends Error{constructor(t,e=null,n=null){super(n??t),this.name="BackendError",this.code=t,this.status=e,this.recoveryMessage=n}},me=36,ee=16*1024*1024,pn=(s,t)=>{let e=Number(s);if(!Number.isSafeInteger(e)||e<0)throw new f(t);return e},mn=(s,t)=>{let e=s.headers.get("X-Matic-Revision");if(e===null)return t;let n=Number(e);if(!Number.isSafeInteger(n)||n<0)throw new f("invalid-scene-revision");return n},fn=(s,t)=>{let e=s.headers.get("X-Matic-Floor-Coherent");if(e===null)return t;if(e==="1")return!0;if(e==="0")return!1;throw new f("invalid-scene-floor-header")},Le=class{#e;#t=new $e;#r=new WeakMap;#o=new Set;#s=!1;constructor(t){this.#e=t}async#l(t,e){let n=t.body?.getReader();if(!n)return new ArrayBuffer(0);let r=()=>{n.cancel().catch(()=>{})};e.addEventListener("abort",r,{once:!0});try{if(e.aborted)throw r(),new DOMException("Aborted","AbortError");let o=[],i=0;for(;;){let d=await n.read();if(e.aborted)throw new DOMException("Aborted","AbortError");if(d.done)break;o.push(d.value),i+=d.value.byteLength}let a=new Uint8Array(i),l=0;for(let d of o)a.set(d,l),l+=d.byteLength;return a.buffer}finally{e.removeEventListener("abort",r),n.releaseLock()}}async#a(t,e,n,r,o){if(!dn(t))throw new E("invalid-private-path");if(r?.aborted)throw new DOMException("Aborted","AbortError");let i=new AbortController,a=()=>{},l=new Promise((h,m)=>{a=m}),d=()=>{i.abort(),a(new DOMException("Aborted","AbortError"))};r?.addEventListener("abort",d,{once:!0});let c=!1,u=window.setTimeout(()=>{c=!0,d()},n);try{let h=this.#e(),m=new Headers(e.headers),v={...e,cache:"no-store",credentials:"same-origin",headers:Object.fromEntries(m.entries()),signal:i.signal},k=async()=>{let g;if(typeof h?.fetchWithAuth=="function")g=await h.fetchWithAuth(t,v);else{let b=h?.auth?.accessToken||h?.auth?.data?.access_token;b&&m.set("Authorization",`Bearer ${b}`);let R=typeof h?.hassUrl=="function"?h.hassUrl(t):t;g=await fetch(R,{...v,headers:m})}try{if(i.signal.aborted)throw new DOMException("Aborted","AbortError");return await o(g,i.signal)}finally{g.body&&!g.body.locked&&g.body.cancel().catch(()=>{})}};return await Promise.race([k(),l])}catch(h){throw c&&!r?.aborted?new E("request-timeout"):i.signal.aborted?new DOMException("Aborted","AbortError"):h}finally{window.clearTimeout(u),r?.removeEventListener("abort",d)}}async#n(t,e,n,r={}){return this.#a(t,{...r,headers:{Accept:"application/json",...r.headers||{}}},e,n,async(o,i)=>{if(!o.ok){let a=o.headers.get("X-Matic-Plans-Conflict");throw new E(a==="map-rechecking"?"map-rechecking":"request-failed",o.status)}try{return JSON.parse(new TextDecoder().decode(await this.#l(o,i)))}catch{throw new f("invalid-json-response")}})}async catalog(t){return Ae(await this.#n(Xt,N.catalog,t))}async scene(t,e,n,r,o,i){let a=new Headers({Accept:"application/vnd.matic.slam-scene"});return r==="live"&&a.set("X-Matic-Prefer-Cached","1"),i&&a.set("If-None-Match",i),this.#a(t,{headers:a},N.scene,o,async(l,d)=>{let c=mn(l,e),u=fn(l,n);if(l.status===304)return{scene:null,floorCoherent:u,revision:c,notModified:!0};if(!l.ok)throw new E("scene-request-failed",l.status);if(l.headers.get("Content-Type")?.split(";",1)[0]!=="application/vnd.matic.slam-scene")throw new f("invalid-scene-content-type");return{scene:{...await this.#t.parse(await this.#l(l,d),d),revision:c,etag:l.headers.get("ETag"),source:r},floorCoherent:u,revision:c,notModified:!1}})}async#p(t,e,n){if(!Number.isSafeInteger(e)||e<1||e>ee||typeof DecompressionStream!="function")throw new f("invalid-scene-delta");let o=new Blob([t]).stream().pipeThrough(new DecompressionStream("deflate")).getReader(),i=new Uint8Array(e),a=0,l=()=>{o.cancel()};n?.addEventListener("abort",l,{once:!0});try{for(;;){if(n?.aborted)throw new DOMException("Aborted","AbortError");let{done:d,value:c}=await o.read();if(d)break;if(!(c instanceof Uint8Array)||a+c.byteLength>e)throw new f("invalid-scene-delta");i.set(c,a),a+=c.byteLength}}finally{n?.removeEventListener("abort",l),o.releaseLock()}if(a!==e)throw new f("invalid-scene-delta");return i}async#m(t,e,n){if(t.byteLength<me||t.byteLength>me+ee||e.buffer.byteLength>ee)throw new f("invalid-scene-delta");let r=new DataView(t),o=new TextDecoder().decode(new Uint8Array(t,0,8)),i=r.getUint16(8,!0),a=r.getUint16(10,!0),l=pn(r.getBigUint64(12,!0),"invalid-scene-delta"),d=pn(r.getBigUint64(20,!0),"invalid-scene-delta"),c=r.getUint32(28,!0),u=r.getUint32(32,!0);if(o!=="MATICDLT"||i!==1||a!==1||l!==e.revision||d<=e.revision||c<Me||c>ee||u>ee||u+me!==t.byteLength)throw new f("invalid-scene-delta");let h=new Uint8Array(t,me,u),m=new Uint8Array(e.buffer),k=(await this.#p(h,Math.max(m.byteLength,c),n)).slice(),g=1024*1024;for(let S=0;S<m.byteLength;S+=g){if(n?.aborted)throw new DOMException("Aborted","AbortError");let y=Math.min(m.byteLength,S+g);for(let C=S;C<y;C+=1)k[C]=(k[C]??0)^(m[C]??0);y<m.byteLength&&await new Promise(C=>window.setTimeout(C,0))}let b=k.slice(0,c).buffer;return{parsed:{...await this.#t.parse(b,n),revision:d,etag:null,source:"live"},revision:d}}async sceneDelta(t,e,n,r){let o=t.includes("?")?"&":"?";return this.#a(`${t}${o}since=${encodeURIComponent(e.revision)}`,{headers:{Accept:"application/vnd.matic.slam-delta, application/vnd.matic.slam-scene"}},N.delta,r,async(i,a)=>{let l=mn(i,e.revision),d=fn(i,n);if(i.status===204){if(l!==e.revision)throw new f("invalid-scene-delta-revision");return{scene:null,floorCoherent:d,revision:l,notModified:!0}}if(!i.ok)throw new E("delta-request-failed",i.status);if(l<=e.revision)throw new f("invalid-scene-delta-revision");let c=Number(i.headers.get("Content-Length"));if(Number.isFinite(c)&&c>me+ee)throw new f("invalid-scene-delta-size");let u=i.headers.get("Content-Type")?.split(";",1)[0],h=await this.#l(i,a);if(u==="application/vnd.matic.slam-delta"){let v=Number(i.headers.get("X-Matic-Base-Revision"));if(!Number.isSafeInteger(v)||v!==e.revision)throw new f("invalid-scene-delta-base");let k=await this.#m(h,e,a);if(k.revision!==l)throw new f("invalid-scene-delta-revision");return{scene:{...k.parsed,etag:i.headers.get("ETag")},floorCoherent:d,revision:l,notModified:!1}}if(u!=="application/vnd.matic.slam-scene")throw new f("invalid-scene-delta-content-type");return{scene:{...await this.#t.parse(h,a),revision:l,etag:i.headers.get("ETag"),source:"live"},floorCoherent:d,revision:l,notModified:!1}})}async pose(t,e){return cn(await this.#n(t,N.pose,e))}async history(t,e){return tn(await this.#n(t,N.history,e))}async plans(t,e){return ln(await this.#n(t,N.workflow,e))}async areas(t,e){return sn(await this.#n(t,N.workflow,e))}async previewRoomSequence(t,e,n,r){if(!t||t.length>255||e.length<1||e.length>100)throw new f("invalid-room-sequence-preview-request");if(r?.aborted)throw new DOMException("Aborted","AbortError");let o=this.#e()?.connection;if(!o?.sendMessagePromise)throw new E("preview-unavailable");let i=null,a=()=>{},l=new Promise((b,R)=>{a=R}),d=this.#r.get(o),c,u=new Promise(b=>{c=b});this.#r.set(o,u);let h=!1,m=()=>{h||(h=!0,c(),this.#r.get(o)===u&&this.#r.delete(o))},v=!1,k=()=>{a(new DOMException("Aborted","AbortError")),v&&(m(),i!==null&&window.clearTimeout(i),i=null)};r?.addEventListener("abort",k,{once:!0});let g=new Promise((b,R)=>{i=window.setTimeout(()=>{i=null,R(new E("preview-timeout"))},N.roomPreview)});g.catch(()=>{v&&m()});try{if(d&&(await Promise.race([d,l,g]),r?.aborted))throw new DOMException("Aborted","AbortError");let b=pe.get(o)??0;if(b>=sr)throw new E("preview-unavailable");let R=o.sendMessagePromise({type:"call_service",domain:"matic_robot",service:"preview_room_sequence",target:{entity_id:t},service_data:{rooms:e.map($=>({room:$.room,cleaning_mode:$.cleaning_mode,coverage_setting:$.coverage_setting})),use_room_schedule:!0,override_room_schedule:n},return_response:!0});pe.set(o,b+1),v=!0;let S=!1,y=()=>{if(!S){S=!0;let $=(pe.get(o)??1)-1;$===0?pe.delete(o):pe.set(o,$)}m(),i!==null&&window.clearTimeout(i),i=null};R.then(y,y);let C=await Promise.race([R,l,g]);if(r?.aborted)throw new DOMException("Aborted","AbortError");if(!C||typeof C!="object"||Array.isArray(C)||!("response"in C))throw new f("invalid-room-sequence-preview-envelope");return on(C.response)}finally{v||(d?d.then(m,m):m(),i!==null&&window.clearTimeout(i),i=null),r?.removeEventListener("abort",k)}}async saveArea(t,e,n){let r=await this.#n(t,N.mutation,n,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...e.areaId?{area_id:e.areaId}:{},name:e.name,circles:e.circles,...e.outline?.closed?{outline:e.outline.points}:{},cleaning_mode:e.cleaningMode,coverage_setting:e.coverageSetting})});if(!r||typeof r!="object"||typeof r.id!="string")throw new f("invalid-area-save-response");return r.id}async deleteArea(t,e,n){await this.#a(`${t}?area_id=${encodeURIComponent(e)}`,{method:"DELETE",headers:{Accept:"application/json"}},N.mutation,n,async r=>{if(!r.ok)throw new E("area-delete-failed",r.status)})}async service(t,e,n,r,o={}){let i=this.#e();if(this.#s||typeof i?.callService!="function")throw new E("service-unavailable");let a=null,l=null;try{let d=o.returnResponse?i.callService(t,e,n,{entity_id:r},!0,!0):i.callService(t,e,n,{entity_id:r});return!o.returnResponse&&!o.acknowledgementTimeout?await d:await Promise.race([d,new Promise((c,u)=>{l=()=>{a!==null&&window.clearTimeout(a),a=null,u(new DOMException("Aborted","AbortError"))},this.#o.add(l),a=window.setTimeout(()=>u(new E("mutation-timeout")),N.mutation)})])}catch(d){throw ir(d,i.localize)??d}finally{a!==null&&window.clearTimeout(a),l&&this.#o.delete(l)}}dispose(){if(!this.#s){this.#s=!0;for(let t of this.#o)t();this.#o.clear(),this.#t.dispose()}}};var yn=()=>({version:4,view:"top",appearance:"photo",labels:!0,quality:"auto",cameras:{}}),fe=(s,t,e)=>Math.max(t,Math.min(e,s)),gn=s=>s.replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",ht=(s,t=4)=>`matic-map-studio:v${t}:${gn(s)}`,ar=s=>{if(!s||typeof s!="object")return null;let t=s;return["yaw","pitch","zoom","targetX","targetZ"].every(n=>typeof t[n]=="number"&&Number.isFinite(t[n]))?{yaw:fe(t.yaw,-Math.PI,Math.PI),pitch:fe(t.pitch,.18,Math.PI/2-.018),zoom:fe(t.zoom,.01,100),targetX:fe(t.targetX,-1e4,1e4),targetZ:fe(t.targetZ,-1e4,1e4)}:null},vn=s=>{let t=yn();if(!s||typeof s!="object")return t;let e=s,n=e.view==="three"||e.view==="top"||e.view==="rooms"?e.view:t.view,r=n==="rooms"?"top":n,o=e.quality==="auto"||e.quality==="efficient"||e.quality==="balanced"||e.quality==="maximum"?e.quality:t.quality,i=e.cameras&&typeof e.cameras=="object"?e.cameras:{},a={};for(let l of["three","top"]){let d=ar(i[l]);d&&(a[l]=d)}return{version:4,view:r,appearance:e.appearance==="rooms"||e.appearance==="photo"?e.appearance:t.appearance,labels:typeof e.labels=="boolean"?e.labels:t.labels,quality:o,cameras:a}},Oe=class{#e="local-user";#t=null;#r=null;load(t){this.#o(),this.#e=gn(t);try{let e=window.localStorage.getItem(ht(this.#e));if(e)return vn(JSON.parse(e));for(let n of[3,2]){let r=window.localStorage.getItem(ht(this.#e,n));if(r)return vn(JSON.parse(r))}}catch{}return yn()}schedule(t){this.#t!==null&&window.clearTimeout(this.#t),this.#r={key:ht(this.#e),value:t},this.#t=window.setTimeout(()=>this.#o(),250)}#o(){this.#t!==null&&window.clearTimeout(this.#t),this.#t=null;let t=this.#r;if(this.#r=null,!!t)try{window.localStorage.setItem(t.key,JSON.stringify(t.value))}catch{}}dispose(){this.#o()}};var mt=1,te=Number.MAX_SAFE_INTEGER,Sn=Number.MAX_SAFE_INTEGER,bn=64,pt=4,wn=16*1024,lr=250,cr=4e3,De=3e4;function D(s){return s!==null&&typeof s=="object"&&!Array.isArray(s)?s:null}function K(s,t){return typeof s=="number"&&Number.isSafeInteger(s)&&s>=0&&s<=t}function Rn(s){let t=D(s);if(!t)return null;let e={};for(let[n,r]of Object.entries(t)){if(n.length===0||n.length>128||!K(r,Sn))return null;e[n]=r}return e}function dr(s){let t=D(s);if(!t||Object.keys(t).length>128)return null;let e={};for(let[n,r]of Object.entries(t)){if(n.length===0||n.length>128||!K(r,Sn))return null;e[n]=r}return e}function Cn(s){return typeof s=="string"&&s.length>0&&s.length<=256?s:K(s,te)?String(s):null}function ur(s){let t=D(s),e=Cn(t?.epoch);if(!t||t.schema!==mt||e===null)return null;let n=dr(t.capabilities),r=Rn(t.revisions);return!n||!r||!K(t.sequence,te)||!K(t.coherence_generation,te)||t.coherence_generation===0?null:{schema:t.schema,capabilities:n,epoch:e,sequence:t.sequence,coherence_generation:t.coherence_generation,revisions:r}}function _n(s,t){let e=D(s),n=ur(e?.snapshot??s);if(!n)return null;let r=D(e?.snapshot??s);if(!r||!("payload"in r))return null;let o=r.entry_id,i=D(r.identity),a=D(r.status),l=D(r.payload),d=a?a.reason===null?null:xn(a.reason):null,c=l?.available,u=null;if(l?.entry!==void 0&&l.entry!==null){if((()=>{try{return JSON.stringify(l.entry).length}catch{return wn+1}})()>wn)return null;try{u=Ae({entries:[l.entry]})[0]??null}catch{return null}}let h=a?.state;return typeof o!="string"||o.length===0||o.length>128||t!==void 0&&o!==t||!i||i.entry_id!==o||i.floor_mission_id!==null&&!K(i.floor_mission_id,te)||typeof i.floor_verified!="boolean"||i.floor_verified!==(i.floor_mission_id!==null)||!a||h!=="ready"&&h!=="stale"&&h!=="unavailable"||a.reason!==null&&d===null||typeof a.retryable!="boolean"||typeof c!="boolean"||u!==null&&u.entryId!==o||h==="ready"&&(d!==null||a.retryable||!c)||(h==="stale"||h==="unavailable")&&(d===null||c)||d==="authorization"&&a.retryable?null:{...n,entry_id:o,identity:{entry_id:o,floor_mission_id:i.floor_mission_id,floor_verified:i.floor_verified},status:{state:h,reason:d,retryable:a.retryable},payload:{available:c,entry:u}}}function kn(s){let t=D(s),e=Cn(t?.epoch),n=Rn(t?.revisions),r=t?.resources;return e===null||!n||!K(t?.sequence,te)||!K(t?.coherence_generation,te)||t.coherence_generation===0||!Array.isArray(r)||r.length>128||!r.every(o=>typeof o=="string"&&o.length<=128)?null:{epoch:e,sequence:t.sequence,coherence_generation:t.coherence_generation,revisions:n,resources:r}}var hr=["gap","overflow","reconnect","invalid_message","server_request","restart","entry_removed","authorization","snapshot_required"];function xn(s){return typeof s=="string"&&hr.includes(s)?s:null}var qe=class{#e;#t;#r;#o=null;#s=!1;#l=!1;#a=!1;#n=!1;#p=!1;#m=!1;#u=0;#E=!1;#C=!1;#z=!1;#y=!1;#c=null;#_=null;#d=0;#$=!1;#f=null;#b=-1;#h=new Map;#x=!1;#L=!1;#M=null;#i=[];constructor(t,e){this.#e=t,this.#t=e,this.#r=Math.max(1,Math.min(bn,e.maxPendingInvalidations??bn))}async start(){if(!(this.#s||this.#L)){this.#L=!0;try{await this.#j(!1)}catch(t){this.#F(t),this.#g("reconnect")}}}notifyReconnect(){(this.#n||this.#m)&&(this.#u+=1),this.#d=0,this.#E=!1,this.#n=!1,this.#p=!1,this.#c!==null&&window.clearTimeout(this.#c),this.#c=null,this.requestResync("reconnect"),this.#a&&this.#I(0,!0)}requestResync(t="server_request"){this.#g(t,!0)}dispose(){this.#s||(this.#s=!0,this.#c!==null&&window.clearTimeout(this.#c),this.#c=null,this.#a=!1,this.#o?.(),this.#o=null,this.#h.clear(),this.#i=[])}#W(t){if(this.#s)return;let e=D(t),n=D(e?.event)??e,r=n?.type;if(r==="resync"){let i=xn(n?.reason);if(!i){this.#g("invalid_message");return}if(i==="entry_removed"){this.#t.onEvent({type:"resync",reason:i}),this.dispose();return}this.#g(i);return}if(this.#n){if(r==="invalidate"){let i=kn(n?.invalidation??n);i?this.#P(i):(this.#i=[],this.#$=!0)}return}let o=r==="snapshot"?_n(n?.snapshot??n,this.#t.entryId):r==="invalidate"?kn(n?.invalidation??n):null;if(!o){this.#g("invalid_message");return}if(r==="snapshot"){let i=o;if(this.#a)return;if(this.#f!==null&&i.epoch!==this.#f){this.#g("restart");return}this.#v(i);return}this.#S(o)}#v(t){this.#f===t.epoch&&t.sequence<this.#b||(this.#f=t.epoch,this.#b=t.sequence,this.#h.clear(),this.#t.onEvent({type:"snapshot",snapshot:t}))}#A(t){let e=this.#i;if(this.#i=[],this.#v(t),this.#s)return;let n=t.sequence+1;for(let r of e)if(r.epoch===t.epoch&&!(r.sequence<=t.sequence)&&!(r.sequence<n)){if(r.sequence!==n){this.#i=e.filter(o=>o.epoch===t.epoch&&o.sequence>=n),this.#g("gap");return}this.#S(r),n+=1}}#S(t){if(this.#a){this.#P(t);return}if(this.#f===null){this.#P(t);return}if(this.#f!==t.epoch){this.#P(t),this.#g("reconnect");return}if(!(t.sequence<=this.#b)){if(t.sequence!==this.#b+1){this.#P(t),this.#g("gap");return}this.#b=t.sequence;for(let e of t.resources)this.#h.set(e,t);if(this.#h.size>this.#r){this.#h.clear(),this.#g("overflow");return}this.#x||(this.#x=!0,queueMicrotask(()=>this.#D()))}}#P(t){this.#i.length>=this.#r?(this.#i=[],this.#$=!0,this.#g("overflow")):this.#i.push(t)}#D(){if(this.#x=!1,this.#s||this.#n||this.#h.size===0){this.#n&&this.#h.clear();return}let t=[...this.#h.values()];this.#h.clear();let e=t.reduce((r,o)=>!r||o.sequence>r.sequence?o:r,null);if(!e)return;let n=[...new Set(t.flatMap(r=>r.resources))];this.#t.onEvent({type:"invalidation",invalidation:{...e,resources:n}})}#g(t,e=!1){if(!this.#s){if(t==="authorization"){this.#q(),this.#t.onEvent({type:"resync",reason:t});return}if(!this.#n&&(this.#l||(this.#l=!0,this.#t.onEvent({type:"resync",reason:t}),queueMicrotask(()=>{this.#l=!1})),t!=="entry_removed")){let n=e&&!this.#E;if(n&&(this.#E=!0),n&&this.#c!==null&&(window.clearTimeout(this.#c),this.#c=null),this.#z){if(this.#y){n&&this.#I(0,!0);return}this.#y=!0,this.#H(n);return}if(e&&this.#a){n&&(this.#C=!0);return}let r=this.#d>=pt?De:0;this.#I(n?0:r,n)}}}#I(t,e=!1){if(!this.#s){if(this.#c!==null){if(!e)return;window.clearTimeout(this.#c),this.#c=null}if(this.#a){this.#_=e?t:Math.max(this.#_??0,t);return}this.#c=window.setTimeout(()=>{this.#c=null,this.#j(!0)},t)}}#H(t=!1){let e=this.#d>=pt?De:Math.min(lr*2**this.#d,cr);this.#d<pt&&(this.#d+=1),this.#I(t?0:e,t)}async#j(t,e=!1){if(this.#s||this.#a)return;let n=this.#u;this.#a=!0,this.#m=e;try{if(t&&await this.#G(),this.#s||this.#n&&!e||n!==this.#u)return;let r=await this.#e.sendMessagePromise({type:"matic_robot/workspace_snapshot",version:mt,entry_id:this.#t.entryId});if(this.#s||this.#n&&!e||n!==this.#u)return;let o=_n(r,this.#t.entryId);if(!o)throw new Error("invalid-workspace-snapshot");if(o.status.reason==="authorization"){this.#q(),this.#t.onEvent({type:"snapshot",snapshot:o});return}if(o.status.state!=="ready"&&o.status.retryable)throw new Error("workspace-snapshot-retryable");e&&(this.#n=!1,this.#p=!1,this.#c!==null&&window.clearTimeout(this.#c),this.#c=null),this.#a=!1,this.#z=!0,this.#y=!1;try{t?this.#Q(o):this.#A(o)}finally{this.#z=!1}this.#y?this.#C&&(this.#C=!1,this.#I(0,!0)):(this.#d=0,this.#E=!1,this.#C=!1),!t&&!this.#s&&await this.#G(),this.#$&&(this.#$=!1,this.#g("overflow"))}catch(r){if(this.#s||this.#n&&!e||n!==this.#u)return;if(this.#F(r),this.#Y(r))this.#q(),this.#t.onEvent({type:"resync",reason:"authorization"});else if(!e){let o=this.#C;this.#C=!1,this.#H(o)}}finally{this.#a=!1,this.#m=!1,this.#p?(this.#p=!1,this.#T(0)):e&&this.#n&&this.#T(De);let r=this.#_;this.#_=null,r!==null&&this.#I(r)}}async#G(){if(this.#s||this.#o)return;if(this.#M)return this.#M;let t=(async()=>{let e=await this.#e.subscribeMessage(n=>this.#W(n),{type:"matic_robot/workspace_subscribe",version:mt,entry_id:this.#t.entryId});this.#s?e():this.#o=e})();this.#M=t;try{await t}finally{this.#M===t&&(this.#M=null)}}#Q(t){let e=this.#i;if(this.#i=[],this.#f===t.epoch&&t.sequence<this.#b){this.#i=e,this.#g("snapshot_required");return}if(this.#v(t),this.#s)return;let n=t.sequence+1;for(let r of e)if(r.epoch===t.epoch&&!(r.sequence<=t.sequence)&&!(r.sequence<n)){if(r.sequence!==n){this.#i=e.filter(o=>o.sequence>=n),this.#g("gap");return}this.#S(r),n+=1}}#Y(t){let e=D(t),n=e?.code,r=e?.status??e?.statusCode;return n==="unauthorized"||n==="not_authorized"||n==="auth_invalid"||r===401||r===403}#q(){this.#u+=1,this.#n||(this.#n=!0,this.#c!==null&&window.clearTimeout(this.#c),this.#c=null,this.#p=!1),this.#h.clear(),this.#i=[],this.#$=!1,this.#_=null,this.#d=0,this.#E=!1,this.#C=!1,this.#m||this.#T(De)}#T(t){this.#s||this.#c!==null||this.#p||(this.#c=window.setTimeout(()=>{if(this.#c=null,!this.#s){if(this.#a){this.#p=!0;return}this.#j(!0,!0)}},t))}#F(t){this.#t.onError?.(t instanceof Error?t:new Error("Workspace transport failed"))}};var Ne=class{#e;#t;#r=document.visibilityState!=="hidden";#o=!1;#s=!1;#l=!1;constructor({onSuspend:t,onResume:e}){this.#e=t,this.#t=e}get active(){return this.#r}start(){this.#o||this.#s||(this.#o=!0,window.addEventListener("pagehide",this.#a),window.addEventListener("pageshow",this.#n),document.addEventListener("visibilitychange",this.#p),document.visibilityState==="hidden"&&(this.#r?this.#u(!1):this.#e()))}dispose(){this.#s||(this.#s=!0,this.#o&&(window.removeEventListener("pagehide",this.#a),window.removeEventListener("pageshow",this.#n),document.removeEventListener("visibilitychange",this.#p)))}#a=()=>{this.#l=!0,this.#u(!1)};#n=t=>{if(this.#l=!1,t.persisted){document.visibilityState==="hidden"?this.#u(!1):(this.#u(!1),this.#u(!0));return}this.#m()};#p=()=>{this.#m()};#m(){if(this.#l||document.visibilityState==="hidden"){this.#u(!1);return}this.#u(!0)}#u(t){this.#r===t||this.#s||(this.#r=t,t?this.#t():this.#e())}};var pr=!1,p=(s,t,e=null)=>({status:s,value:t,problem:e}),ve=s=>s.status==="loading"?p("idle",s.value):s,L=s=>s instanceof DOMException&&s.name==="AbortError",H=(s,t)=>s instanceof E||s&&typeof s=="object"&&"code"in s&&typeof s.code=="string"?s.code:t,mr=s=>s instanceof E?s.recoveryMessage:null,re=s=>[s.selectedFloorOrdinal??"none",s.mapFloorOrdinal??"none",s.mapFloorCoherent?"coherent":"transition"].join(":"),oe=s=>[s.mapFloorOrdinal??"none",s.mapSessionVerified?"verified":"unverified",s.mapSessionKey??"no-session"].join(":"),z=s=>[s.entryId,s.selectedFloorOrdinal??"none",s.mapFloorOrdinal??"none"].join("|"),A=s=>[s.entryId,re(s),oe(s)].join("|"),ft=s=>[A(s),s.mapRevision].join("|"),ze=s=>s.runnerLocked||s.stopSettlePending||s.activePlan||s.nativeReconciliationPending||s.nativeSessionActive===!0,We=(s,t)=>s.entryKey===t.entryKey&&s.generation===t.generation&&s.floorKey===t.floorKey&&s.missionKey===t.missionKey,ne="Live map updates paused while the current map is rechecked.",Pn="Saved map from ",vt="Reconnecting. The last verified map remains read only.",fr=1e3,vr=5e3,yr=["rooms","plans","plan","draw","areaReview"],En=["plan-mutation","area-mutation"],Mn=s=>JSON.stringify({...s,previewToken:void 0}),He=(s,t)=>s.label?s.label:s.active?"Current floor":`Saved floor ${s.ordinal??t}`,Fe=class{#e;#t;#r;#o;#s=new Oe;#l=null;#a=new Map;#n=null;#p=null;#m=null;#u=null;#E=0;#C=!1;#z=!1;#y=!1;#c=!1;#_=null;#d=Promise.resolve();#$=!1;#f=!1;#b="";#h=null;#x=0;#L=null;#M="";#i=!1;#W=!0;#v=null;#A=null;#S=null;#P=null;#D="";#g=!1;#I;#H;constructor(t,e,n=null,r=pr){this.#e=t,this.#t=new xt(t.value.generation),this.#r=e,this.#I=n,this.#H=r,this.#o=new Ne({onSuspend:()=>this.#j(),onResume:()=>{this.#G()}}),this.#e.patch({pageActive:this.#o.active}),this.#P=t.subscribe(o=>{this.#Q(o),this.#F()}),this.#o.start()}#j(){this.#K(!1,En),this.#N(),this.#O(En),this.#y=!1,this.#c=!1,this.#_=null,this.#f=!1,this.#ye();let t=this.#e.value;this.#e.patch({resources:{...t.resources,catalog:ve(t.resources.catalog),scene:ve(t.resources.scene),history:ve(t.resources.history),plans:ve(t.resources.plans),areas:ve(t.resources.areas),pose:p("idle",null)}})}async#G(){if(this.#i||!this.#o.active)return;this.#e.patch({pageActive:!0});let t=this.#n;if(this.#i||!this.#o.active||!t?.host.connected||!t.host.administrator||!t.host.robotConnected||t.host.robotCount===0)return;let e=this.#e.value;this.#J(),this.#ae(t),await this.refreshCatalog(!0,!0);let n=this.#e.value,r=n.resources.entry;if(this.#i||!this.#o.active||e.dataMode!=="history"||n.generation!==e.generation||n.dataMode!=="history"||n.selection.entryId!==e.selection.entryId||n.selection.floorId!==e.selection.floorId||n.selection.historyId!==e.selection.historyId||n.resources.catalog.status!=="ready"||!r||r.entryId!==n.selection.entryId)return;let o=n.resources.history.value?.floors.find(u=>u.id===n.selection.floorId),i=o?.snapshots.find(u=>u.id===n.selection.historyId);if(!o)return;let a=this.#t.begin(r.entryId,o.id,i?.id??o.id,i?.revision??0);if(this.#e.patch({generation:a.generation}),await this.#se(r,a),!this.#t.accepts(a)||!this.#o.active||this.#e.value.resources.history.status!=="ready")return;let l=this.#e.value,d=l.resources.history.value?.floors.find(u=>u.id===o.id),c=d?.snapshots.find(u=>u.id===i?.id);!d||i&&!c||(c&&c.revision!==a.revision&&(a=this.#t.begin(r.entryId,o.id,c.id,c.revision)),this.#e.patch({generation:a.generation,coherence:"current"}),c&&(!l.resources.scene.value||c.revision!==i?.revision)&&await this.#me(c,a))}#Q(t){if(!t.owner)return;let e={version:4,view:t.view,appearance:t.appearance,labels:t.labelsVisible,quality:t.quality,cameras:t.cameras},n=this.#l;this.#l=e,!(!n||n.view===e.view&&n.appearance===e.appearance&&n.labels===e.labels&&n.quality===e.quality&&n.cameras===e.cameras)&&this.#s.schedule(e)}#Y(t){let e=Rt(t),n=t.resources.entry,r=this.#n?.vacuumEntityId;if(!e||!n||!r||!t.selection.entryId||t.workflow!=="rooms"||t.dataMode!=="live"||t.floor.readOnly||t.coherence!=="current"||!t.host.connected||!t.host.administrator||!t.host.robotConnected||t.command!=="idle"||t.resources.plans.status!=="ready")return null;let o=t.selection.roomIds.map(i=>{let a=t.selection.roomSettings.find(l=>l.roomId===i);return a?{room:i,cleaning_mode:a.cleaningMode,coverage_setting:a.coverageSetting}:null});return o.some(i=>i===null)?null:{key:e,generation:t.generation,retryRevision:t.manualRoomPreviewRetry,floorKey:re(n),missionKey:oe(n),entryId:t.selection.entryId,entityId:r,rooms:o,overrideRoomSchedule:!t.selection.useRoomSchedule}}#q(t){return JSON.stringify([t.key,t.generation,t.retryRevision,t.floorKey,t.missionKey,t.entryId,t.entityId])}#T(t){let e=this.#Y(this.#e.value);return!this.#i&&e!==null&&this.#q(e)===this.#q(t)}#F(){if(this.#i||!this.#n)return;let t=this.#e.value,e=this.#Y(t);if(!e){this.#a.get("room-preview")?.abort(),this.#a.delete("room-preview"),this.#D="",(t.manualRoomPreview.status!=="idle"||t.manualRoomPreview.value!==null)&&this.#e.patch({manualRoomPreview:p("idle",null)});return}let n=this.#q(e),r=et(t);if(r&&r.key===e.key&&r.generation===e.generation&&r.floorKey===e.floorKey&&r.missionKey===e.missionKey&&r.preview.entryId===e.entryId){this.#D=n;return}if(this.#D===n)return;this.#a.get("room-preview")?.abort(),this.#D=n;let o=this.#k("room-preview");this.#e.patch({manualRoomPreview:p("loading",null)}),this.#he(e,o)}async#he(t,e){try{let n=await this.#r.previewRoomSequence(t.entityId,t.rooms,t.overrideRoomSchedule,e.signal);return!this.#T(t)||e.signal.aborted||n.entryId!==t.entryId?null:(this.#e.patch({manualRoomPreview:p("ready",{key:t.key,generation:t.generation,floorKey:t.floorKey,missionKey:t.missionKey,preview:n})}),n)}catch(n){return L(n)||e.signal.aborted||!this.#T(t)||this.#e.patch({manualRoomPreview:p("error",null,H(n,"preview-unavailable"))}),null}finally{this.#R("room-preview",e)}}sync(t){if(this.#i)return;let e=this.#v,n=this.#n?.host.robotConnected??null,r=this.#n?.host.administrator===!1&&t.host.administrator,o=this.#n!==null&&!this.#n.host.robotConnected&&t.host.robotConnected,i=this.#e.value.owner,a=i!==null&&(i.entryKey!==t.entryKey||i.userKey!==t.userKey);a&&(this.#oe("context-changed",t.entryKey),this.#C&&(this.#y=!0,this.#c=!1,this.#_=null));let l=this.#W;this.#W=t.host.connected,this.#n=t,this.#ae(t),o&&e&&e===this.#v&&e.notifyReconnect();let d=t.userKey!==this.#M?this.#s.load(t.userKey):null;if(d&&(this.#M=t.userKey,this.#l=d),this.#e.patch({owner:{userKey:t.userKey,entryKey:t.entryKey},host:t.host,activity:t.activity,batteryPercent:t.batteryPercent,robotLabel:t.robotLabel,robots:t.robots,locale:t.language,selection:{...this.#e.value.selection,entryId:t.entryKey},...d?{view:d.view,appearance:d.appearance,labelsVisible:d.labels,quality:d.quality,cameras:d.cameras}:{}}),!t.host.administrator){this.#N(),this.#oe("access-required",t.entryKey);return}if(!t.host.connected){l&&(this.#e.patch({generation:this.#t.invalidate()}),this.#U(),this.#b=""),this.#N(),this.#y=!1,this.#c=!1,this.#_=null,this.#f=!1,this.#O();let c=this.#e.value,u=c.resources.scene.value;this.#e.patch({coherence:u?"degraded":"unavailable",resources:{...c.resources,catalog:c.resources.catalog.status==="loading"?p("idle",c.resources.catalog.value):c.resources.catalog,plans:c.resources.plans.status==="loading"?p("idle",c.resources.plans.value):c.resources.plans,areas:c.resources.areas.status==="loading"?p("idle",c.resources.areas.value):c.resources.areas,pose:p("idle",null)},map:{...c.map,available:u!==null,exactPose:!1},notice:u?{tone:"warning",text:vt}:c.notice});return}if(t.host.robotCount===0){this.#N(),this.#oe("map-unavailable",t.entryKey);return}if(t.entryKey&&!t.vacuumEntityId){this.#N(),this.#oe("no-loaded-robot",t.entryKey);return}if(!t.host.robotConnected){n!==!1&&(this.#K(),this.#O(),this.#y=!1,this.#c=!1,this.#_=null,this.#f=!1),this.#N();let c=this.#e.value,u=c.resources.scene.value;this.#e.patch({coherence:u?"degraded":"unavailable",resources:{...c.resources,catalog:c.resources.catalog.status==="loading"?p("idle",c.resources.catalog.value):c.resources.catalog,scene:c.resources.scene.status==="loading"?p("idle",u):c.resources.scene,pose:p("idle",null)},map:{...c.map,available:u!==null,exactPose:!1}});return}if(this.#o.active){if(this.#J(),!l||o||r){this.#e.value.notice?.text===vt&&this.#e.patch({notice:null}),this.refreshCatalog(!0,!0);return}(a||this.#e.value.resources.catalog.status==="idle"||t.entryKey&&t.entryKey!==this.#e.value.selection.entryId)&&this.refreshCatalog(!0)}}#ae(t){let e=t.entryKey;if(!this.#H||!this.#I||!t.host.administrator||!t.host.connected||!t.vacuumEntityId||!e||!this.#o.active){this.#ye();return}if(this.#v&&this.#A===e)return;this.#v?.dispose(),this.#S=null;let n=new qe(this.#I,{entryId:e,onEvent:r=>{if(!(this.#i||!this.#o.active||this.#v!==n||this.#A!==e||this.#n?.entryKey!==e)){if(r.type==="resync"&&r.reason==="entry_removed"){n.dispose(),this.#v===n&&(this.#v=null,this.#A=null,this.#S=null);return}if(r.type==="snapshot"){let{snapshot:o}=r,i=this.#e.value.resources.entry,a=o.payload.entry;if(o.entry_id!==e||o.identity.entry_id!==e)return;if(a&&(a.entryId!==e||o.identity.floor_verified!==(a.mapFloorCoherent&&a.mapSessionVerified))){n.requestResync("invalid_message");return}let l=!a&&i?.entryId===e&&o.identity.floor_verified!==(i.mapFloorCoherent&&i.mapSessionVerified);if(o.status.reason==="authorization"){this.#S=null,this.#B(e,["plans","areas","history"]);return}let d=this.#S,c=[],u=d!==null&&d.epoch!==o.epoch;if(d&&d.epoch===o.epoch){let k=new Set([...Object.keys(d.revisions),...Object.keys(o.revisions)]),g=[...k].some(b=>(o.revisions[b]??-1)<(d.revisions[b]??-1));if(o.coherence_generation<d.coherenceGeneration||o.coherence_generation===d.coherenceGeneration&&g){n.requestResync("restart");return}c=[...k].filter(b=>(o.revisions[b]??-1)>(d.revisions[b]??-1))}u&&(c=["plans","areas","history"]);let h=d!==null&&(d.epoch!==o.epoch||d.coherenceGeneration!==o.coherence_generation),m=!!(i&&a&&i.entryId===e&&A(i)!==A(a));if(this.#S={entryId:o.entry_id,epoch:o.epoch,sequence:o.sequence,coherenceGeneration:o.coherence_generation,revisions:o.revisions},l){this.#B(e,["plans","areas","history"]);return}if(h||m){this.#B(e,c);return}let v=a!==null&&i?.entryId===e&&this.#ce(a);if(d&&c.length){if(o.sequence<=d.sequence){n.requestResync("invalid_message");return}this.#S=d,this.#le({epoch:o.epoch,sequence:o.sequence,coherence_generation:o.coherence_generation,revisions:o.revisions,resources:c},e,n,v)}return}if(r.type==="resync"){this.#S=null,r.reason!=="authorization"&&this.#B(e,["plans","areas","history"]);return}this.#le(r.invalidation,e,n)}},onError:()=>this.#e.patch({notice:{tone:"warning",text:vt}})});this.#v=n,this.#A=e,n.start()}#le(t,e,n,r=!1){let o=this.#S;if(!o||o.entryId!==e||this.#v!==n||t.epoch!==o.epoch||t.sequence<=o.sequence)return;let i=t.coherence_generation!==o.coherenceGeneration,l=[...new Set([...Object.keys(o.revisions),...Object.keys(t.revisions)])].some(m=>(t.revisions[m]??-1)<(o.revisions[m]??-1));if(t.coherence_generation<o.coherenceGeneration||!i&&l){n.requestResync("restart");return}let d=new Set(t.resources),c=[...d].some(m=>(t.revisions[m]??-1)>(o.revisions[m]??-1));if(this.#S={...o,sequence:t.sequence,coherenceGeneration:t.coherence_generation,revisions:t.revisions},!c&&!i)return;if(i){this.#B(e,t.resources);return}d.has("scene")&&d.delete("scene");let u=this.#e.value.resources.entry,h=this.#t.current();!u||u.entryId!==e||!h||d.size&&this.#V(u,h,d,!r)}#ce(t){let e=this.#e.value,n=e.resources.entry;if(!n||A(n)!==A(t))return!1;let r=t.mapRevision===n.mapRevision?t:{...t,mapRevision:n.mapRevision},o=e.resources.catalog,i=o.value?.map(u=>u.entryId===r.entryId?r:u),a=r.mapFloorCoherent&&r.mapSessionVerified,l=r.health==="problem"||r.health==="limited",d=this.#h,c=d?.key===A(r)&&this.#ee(d)&&(d.attempt!==null||d.retryTimer!==null);return this.#e.patch({managedLock:ze(r),coherence:c?"verifying":a?l?"degraded":"current":"verifying",map:{...e.map,available:e.resources.scene.value!==null,complete:r.mapComplete&&!r.mapTruncated,floorCoherent:r.mapFloorCoherent,sessionVerified:r.mapSessionVerified,exactPose:a&&!c?e.map.exactPose:!1},floor:{...e.floor,classifiedCount:Math.max(1,r.historyFloorCount),...c&&e.resources.scene.value?{readOnly:!0}:{}},resources:{...e.resources,entry:r,...i?{catalog:{...o,value:i}}:{}}}),!0}#K(t=this.#e.value.pageActive,e=[]){let n=this.#t.invalidate();this.#U();let r=this.#e.value;this.#e.patch({generation:n,pageActive:t,coherence:r.resources.scene.value?"verifying":"unavailable",floor:{...r.floor,readOnly:r.floor.readOnly||r.resources.scene.value!==null},map:{...r.map,exactPose:!1}}),this.#O(["catalog",...e]),this.#b=""}#B(t,e=[]){this.#w(),this.#K(),this.refreshCatalog(!0,!0).then(()=>{if(this.#i||this.#n?.entryKey!==t||!this.#n.host.administrator||!this.#n.host.connected)return;let n=this.#e.value.resources.entry,r=this.#t.current();if(!n||n.entryId!==t||!r)return;let o=new Set(e);o.delete("history"),this.#V(n,r,o,!1)})}#U(){this.#x+=1,this.#L=null}#pe(t){let e=this.#L,n=this.#t.current();return!!(e&&n&&e.generation===this.#x&&e.stamp.generation===n.generation&&e.entryId===t.entryId&&e.coherenceIdentity===A(t)&&e.deltaUrl===t.deltaUrl&&n.entryKey===t.entryId&&n.floorKey===re(t)&&n.missionKey===oe(t)&&t.mapFloorCoherent&&t.mapSessionVerified&&this.#e.value.dataMode==="live"&&this.#e.value.selection.floorId==="current"&&this.#n?.host.connected&&this.#n.host.robotConnected&&this.#n.host.administrator)}#V(t,e,n,r=!0){(n.has("plans")||n.has("plan_state"))&&this.loadPlans(),n.has("areas")&&this.loadAreas(),n.has("history")&&this.#se(t,e),r&&["status","robot_state","activity","plan_state"].some(o=>n.has(o))&&this.refreshCatalog(!0,!0,!0)}#J(){this.#o.active&&(this.#p===null&&(this.#p=window.setInterval(()=>{this.refreshCatalog()},5e3)),this.#m===null&&(this.#m=window.setInterval(()=>{this.refreshPose()},fr)))}#N(){this.#p!==null&&window.clearInterval(this.#p),this.#m!==null&&window.clearInterval(this.#m),this.#p=null,this.#m=null,this.#w()}#w(){let t=this.#h;if(this.#h=null,!t)return;t.retryTimer!==null&&window.clearTimeout(t.retryTimer);let e=t.attempt?.controller,n=!!(e&&e===this.#a.get("catalog")&&this.#e.value.resources.catalog.status==="loading");if(e?.abort(),n){let r=this.#e.value.resources;this.#e.patch({resources:{...r,catalog:p("idle",r.catalog.value)}})}this.#_?.state===t&&(this.#y=!1,this.#c=!1,this.#_=null)}#X(t,e){let n=this.#h;n?.key===A(e)&&(n.failedKinds.delete(t),n.failedKinds.size===0&&this.#w())}#Z(t,e){let n=A(e),r=this.#h;r?.key!==n&&(this.#w(),r={key:n,failedKinds:new Set,retryTimer:null,attempt:null},this.#h=r),r.failedKinds.add(t),this.#ee(r)&&this.#t.current()&&this.#K(),!r.attempt&&r.retryTimer===null&&(r.failedKinds.size===1&&r.failedKinds.has(t)?this.#ne(r):this.#te(r))}#ee(t){let e=this.#e.value;return t.failedKinds.has("pose")||e.floor.readOnly||!e.map.floorCoherent||!e.map.sessionVerified}#te(t){t.retryTimer!==null||t.failedKinds.size===0||(t.retryTimer=window.setTimeout(()=>{t.retryTimer=null;let e=this.#e.value.resources.entry,n=this.#n?.host;if(this.#h!==t||this.#i||!e||A(e)!==t.key||this.#e.value.dataMode!=="live"||this.#e.value.selection.floorId!=="current"||!n?.connected||!n.administrator||!n.robotConnected||n.robotCount===0){this.#h===t&&this.#w();return}this.#ne(t)},vr))}async#ne(t){if(this.#i||this.#h!==t||t.attempt)return;let e=this.#e.value.resources.entry,n=this.#n?.host;if(!e||A(e)!==t.key||this.#e.value.dataMode!=="live"||this.#e.value.selection.floorId!=="current"||!n?.connected||!n.administrator||!n.robotConnected||n.robotCount===0){this.#h===t&&this.#w();return}if(this.#a.has("scene")){this.#te(t);return}let r=this.#ee(t);r?this.#t.current()&&this.#K():(this.#U(),this.#a.get("delta")?.abort());let o={generation:this.#t.generation,controller:null};t.attempt=o;let i={state:t,attempt:o};try{await this.refreshCatalog(!0,!1,!r,i)}finally{if(this.#h!==t||t.attempt!==o)return;t.attempt=null,t.failedKinds.size>0&&this.#te(t)}}#re(t){let e=this.#e.value,n=this.#n?.host;return!this.#i&&this.#o.active&&this.#h===t.state&&t.state.attempt===t.attempt&&t.attempt.generation===this.#t.generation&&e.generation===this.#t.generation&&e.dataMode==="live"&&e.selection.floorId==="current"&&e.resources.entry!==null&&A(e.resources.entry)===t.state.key&&!!(n?.connected&&n.administrator&&n.robotConnected&&n.robotCount>0)}#k(t){this.#a.get(t)?.abort();let e=new AbortController;return this.#a.set(t,e),e}#R(t,e){this.#a.get(t)===e&&this.#a.delete(t)}#O(t=[]){let e=!1;for(let[n,r]of this.#a)t.includes(n)||(e||=n==="plan-mutation"||n==="area-mutation"||n==="plan-preflight",r.abort(),this.#a.delete(n));e&&this.#e.value.command==="pending"&&this.#e.patch({command:"idle",notice:null})}#ge(){this.#E+=1,this.#u!==null&&window.clearTimeout(this.#u),this.#u=null}#oe(t,e=null){this.#w(),this.#ge(),this.#t.invalidate(),this.#U(),this.#b="";let n=this.#t.generation;this.#O();let r=this.#e.value,o=q();this.#e.patch({command:"idle",dataMode:o.dataMode,floor:o.floor,managedLock:!1,workflow:"none",dialog:null,notice:null,draftFloorOrdinal:null,draw:o.draw,planDraft:o.planDraft,areaDraft:o.areaDraft,generation:n,coherence:r.host.administrator?"unavailable":"blocked",fullMap:!1,precisionOpen:!1,resources:{catalog:p("error",null,t),entry:null,scene:p("idle",null),pose:p("idle",null),history:p("idle",null),plans:p("idle",null),areas:p("idle",null)},manualRoomPreview:p("idle",null),map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1},selection:{...o.selection,entryId:e,entrySource:r.selection.entrySource,floorId:"current",historyId:null}})}async refreshCatalog(t=!1,e=!1,n=!1,r=null){if(this.#i||!this.#o.active||!this.#n?.host.administrator||!this.#n.host.connected||this.#n.host.robotCount===0||r&&(!this.#n.host.robotConnected||!this.#re(r)))return;if(this.#C)return t&&(this.#z?e&&(this.#y?this.#c&&=n:this.#c=n,this.#y=!0):(this.#y?this.#c&&=n:this.#c=n,this.#y=!0,this.#a.get("catalog")?.abort()),r&&(this.#_=r,this.#c=!1,this.#y=!0)),this.#d;this.#C=!0,this.#z=t;let o;this.#d=new Promise(l=>{o=l});let i=this.#k("catalog");r&&(r.attempt.controller=i);let a=this.#e.value.resources.catalog.value;this.#e.patch({resources:{...this.#e.value.resources,catalog:p("loading",a)}});try{let l=await this.#r.catalog(i.signal);if(i.signal.aborted||this.#i||r&&!this.#re(r))return;let d=this.#n?.entryKey,c=d?l.find(g=>g.entryId===d)??null:l[0]??null,u=this.#e.value.resources.entry;if(c&&this.#h?.key===A(c)&&(this.#h.attempt!==null||this.#h.retryTimer!==null)&&(!r||!this.#re(r))){this.#e.patch({managedLock:ze(c),resources:{...this.#e.value.resources,catalog:p(l.length?"ready":"empty",l),entry:u}});return}let h=!!(c&&u&&A(c)===A(u)&&this.#pe(u));if(c&&u&&z(c)===z(u)&&re(c)===re(u)&&oe(c)===oe(u)&&(h||c.mapRevision<u.mapRevision||!t&&this.#a.has("scene"))&&(c={...c,mapRevision:u.mapRevision}),this.#e.patch({managedLock:c?ze(c):!1,resources:{...this.#e.value.resources,catalog:p(l.length?"ready":"empty",l),entry:c}}),!c){this.#oe("no-loaded-robot",this.#n?.entryKey??null);return}if(this.#e.value.selection.floorId!=="current"||this.#e.value.dataMode!=="live")return;let m=ft(c),v=this.#t.current(),k=!!(v&&u&&A(c)===A(u)&&c.mapFloorCoherent&&c.mapSessionVerified);if((!t||n)&&(m===this.#b||k)){let g=this.#e.value,b=c.mapFloorCoherent&&c.mapSessionVerified,R=c.health==="problem"||c.health==="limited";this.#e.patch({coherence:b?R?"degraded":"current":"verifying",map:{...g.map,available:g.resources.scene.value!==null,complete:c.mapComplete&&!c.mapTruncated,floorCoherent:c.mapFloorCoherent,sessionVerified:c.mapSessionVerified,exactPose:b?g.map.exactPose:!1},floor:{...g.floor,classifiedCount:Math.max(1,c.historyFloorCount)}}),b&&this.#e.value.resources.plans.problem==="map-rechecking"&&this.loadPlans(),this.#fe();let S=v;if(S&&k&&(c.mapRevision>S.revision||r!==null)&&(c.mapRevision>S.revision&&(S=this.#t.advance(S,c.mapRevision)),S)){this.#b=m,this.#U();let y=this.#e.value.resources;this.#e.patch({resources:{...y,scene:p("loading",y.scene.value)}}),this.#de(c,S)}S&&!g.resources.scene.value&&!this.#a.has("history")&&this.#se(c,S),b&&S&&(g.resources.scene.status==="error"||g.floor.readOnly)&&!this.#a.has("scene")&&this.#de(c,S);return}this.#b=m,this.#be(c,u)}catch(l){if(L(l)||i.signal.aborted||this.#i)return;this.#e.patch({coherence:this.#e.value.resources.scene.value?"degraded":"unavailable",resources:{...this.#e.value.resources,catalog:p("error",a,H(l,"catalog-unavailable"))}})}finally{this.#R("catalog",i),r?.attempt.controller===i&&(r.attempt.controller=null),this.#C=!1;let l=this.#y,d=this.#c,c=this.#_;this.#z=!1;try{l&&!this.#i&&(this.#y=!1,this.#c=!1,this.#_=null,await this.refreshCatalog(!0,!1,d,c))}finally{o()}}}#be(t,e){this.#h!==null&&this.#h.key!==A(t)&&this.#w();let n=this.#e.value,r=!!(e&&z(e)===z(t)),o=t.mapFloorCoherent&&t.mapSessionVerified,i=n.draftMapSessionKey??(e?.mapFloorCoherent&&e.mapSessionVerified?e.mapSessionKey:null),a=n.draftFloorOrdinal??(e?.mapFloorCoherent&&e.mapSessionVerified?e.mapFloorOrdinal:null),l=o?t.mapFloorOrdinal:null,d=o?t.mapSessionKey:null,c=e!==null&&e.entryId!==t.entryId||a!==null&&l!==null&&a!==l||i!==null&&d!==null&&i!==d,u=r&&o&&a===t.mapFloorOrdinal&&i===t.mapSessionKey,h=["catalog"];r&&!c&&h.push("plans","areas"),u&&h.push("plan-mutation","area-mutation");let m=this.#t.begin(t.entryId,re(t),oe(t),t.mapRevision);this.#h?.key===A(t)&&this.#h.attempt&&(this.#h.attempt.generation=m.generation),this.#U(),this.#O(h);let v=e?.entryId===t.entryId?n.resources.scene.value:null,k=v!==null&&(n.floor.readOnly||!r||!o||e?.mapSessionKey!==t.mapSessionKey),g=n.resources.pose.value,b=r&&o&&t.mapSessionKey!==null&&g?.position&&g.mapSessionKey===t.mapSessionKey?g:null;c&&this.#ge();let R=q(),S=t.health==="problem"||t.health==="limited",y=this.#e.value;this.#e.patch({...c?{command:"idle",workflow:"none",dialog:null,precisionOpen:!1,fullMap:!1,draw:R.draw,planDraft:R.planDraft,areaDraft:R.areaDraft,notice:{tone:"info",text:"The active map changed. Choose a task on this map."}}:{},draftFloorOrdinal:l??a,draftMapSessionKey:d??i,managedLock:ze(t),generation:m.generation,coherence:o?S?"degraded":k?"verifying":"current":"verifying",dataMode:"live",...!o&&v?{notice:{tone:"warning",text:ne}}:{},resources:{...y.resources,entry:t,scene:p(o?"loading":"idle",v),pose:p(o?"loading":"idle",b),history:p("loading",y.resources.history.value),plans:r&&!c?y.resources.plans:p("idle",null),areas:r&&!c?y.resources.areas:p("idle",null)},map:{available:v!==null,complete:t.mapComplete&&!t.mapTruncated,floorCoherent:t.mapFloorCoherent,sessionVerified:t.mapSessionVerified,exactPose:o&&b!==null&&!k},floor:{classifiedCount:Math.max(1,t.historyFloorCount),displayName:k?n.floor.displayName:t.selectedFloorOrdinal?`Floor ${t.selectedFloorOrdinal}`:"Current floor",readOnly:k},selection:{...y.selection,entryId:t.entryId,floorId:"current",historyId:null,roomIds:c?[]:y.selection.roomIds,roomSettings:c?[]:y.selection.roomSettings,planId:c?null:y.selection.planId,areaId:c?null:y.selection.areaId}}),this.#se(t,m),o&&this.#e.value.resources.plans.status==="idle"&&this.loadPlans(),this.#fe(),o&&(this.#de(t,m),this.#ue(t,m))}async#de(t,e){if(!this.#o.active)return;let n=this.#k("scene");try{let r=await this.#r.scene(t.sceneUrl,t.mapRevision,t.mapFloorCoherent,"live",n.signal);if(!this.#t.accepts(e))return;if(!r.floorCoherent){let d=this.#e.value;this.#e.patch({coherence:"verifying",resources:{...d.resources,scene:p("error",d.resources.scene.value,"map-rechecking"),pose:p("idle",null)},map:{...d.map,available:d.resources.scene.value!==null,floorCoherent:!1,exactPose:!1},floor:{...d.floor,readOnly:d.resources.scene.value!==null},notice:{tone:"warning",text:ne}});return}if(r.revision<e.revision||!r.scene)throw new E("scene-unavailable");let o=r.revision===e.revision?e:this.#t.advance(e,r.revision);if(!o)throw new E("scene-unavailable");let i=this.#e.value,a={...i.resources.entry??t,mapRevision:r.revision};this.#b=ft(a),this.#e.patch({coherence:a.health==="problem"||a.health==="limited"?"degraded":"current",resources:{...i.resources,entry:a,scene:p("ready",r.scene)},map:{...i.map,available:!0},floor:{...i.floor,readOnly:!1,displayName:i.resources.history.value?.floors.find(d=>d.active)?.label||(a.selectedFloorOrdinal?`Floor ${a.selectedFloorOrdinal}`:"Current floor")},notice:i.notice?.text===ne||i.notice?.text.startsWith(Pn)?null:i.notice});let l=this.#e.value.resources.plans;if((l.status==="idle"||l.problem==="map-rechecking")&&this.loadPlans(),this.#fe(),t.deltaUrl){let d=++this.#x;this.#we(a,o,r.scene,d)}}catch(r){if(L(r)||!this.#t.accepts(e))return;if(r instanceof E&&r.code==="request-timeout"){let l=this.#e.value;this.#e.patch({resources:{...l.resources,scene:p("loading",l.resources.scene.value,"scene-building")}}),window.setTimeout(()=>{this.#i||!this.#t.accepts(e)||this.#e.value.selection.floorId!=="current"||this.#de(t,e)},250);return}let o=this.#e.value,i=o.resources.pose.value,a=o.resources.scene.value!==null&&t.mapSessionKey!==null&&i?.position!==null&&i?.mapSessionKey===t.mapSessionKey;this.#e.patch({coherence:"degraded",resources:{...o.resources,scene:p("error",o.resources.scene.value,H(r,"scene-unavailable"))},map:{...o.map,available:o.resources.scene.value!==null,exactPose:a}})}finally{this.#R("scene",n)}}async#we(t,e,n,r){if(!t.deltaUrl||typeof DecompressionStream!="function")return;let o=t.deltaUrl,i={generation:r,stamp:e,entryId:t.entryId,coherenceIdentity:A(t),deltaUrl:o};if(r!==this.#x||!this.#t.accepts(e))return;this.#L=i;let a=t,l=e,d=n;try{for(;!this.#i&&this.#o.active&&r===this.#x&&this.#t.accepts(l)&&this.#e.value.selection.floorId==="current";){let c=this.#k("delta");try{let u=await this.#r.sceneDelta(o,d,a.mapFloorCoherent,c.signal);if(c.signal.aborted||this.#i||r!==this.#x||!this.#t.accepts(l))return;if(!u.floorCoherent){let v=this.#e.value;this.#e.patch({coherence:"verifying",map:{...v.map,available:v.resources.scene.value!==null,floorCoherent:!1,exactPose:!1},floor:{...v.floor,readOnly:v.resources.scene.value!==null},resources:{...v.resources,scene:p("error",v.resources.scene.value,"map-rechecking"),pose:p("idle",null)},notice:{tone:"warning",text:ne}}),this.#Z("delta",a);return}if(u.notModified||!u.scene){this.#X("delta",a),await new Promise(v=>window.setTimeout(v,100));continue}let h=this.#t.advance(l,u.revision);if(!h)return;l=h,i.stamp=h,d=u.scene,a={...a,mapRevision:u.revision},this.#X("delta",a),this.#b=ft(a);let m=this.#e.value;this.#e.patch({resources:{...m.resources,entry:a,scene:p("ready",d)},map:{...m.map,available:!0,floorCoherent:!0}}),this.#ue(a,l)}finally{this.#R("delta",c)}}}catch(c){if(L(c)||this.#i||r!==this.#x||!this.#t.accepts(l))return;this.#e.patch({notice:{tone:"warning",text:ne}}),this.#Z("delta",a)}finally{this.#L===i&&(this.#L=null)}}async#se(t,e){if(!this.#o.active)return;let n=this.#k("history");try{let r=await this.#r.history(t.historyUrl,n.signal),o=this.#t.current();if(n.signal.aborted||!o||!We(e,o)||r.entryId!==t.entryId)return;let i=this.#e.value,a=r.floors.find(c=>c.id===i.selection.floorId),l=!i.selection.historyId||a?.snapshots.some(c=>c.id===i.selection.historyId),d=i.dataMode==="live"?r.floors.find(c=>c.active):a;if(this.#e.patch({resources:{...this.#e.value.resources,history:p("ready",r)},floor:{...this.#e.value.floor,classifiedCount:r.floors.length,...d&&!(i.dataMode==="live"&&i.floor.readOnly)?{displayName:He(d,1)}:{}}}),i.dataMode==="live"&&!i.resources.scene.value){let c=r.floors.flatMap(u=>u.snapshots.map(h=>({floor:u,snapshot:h}))).sort((u,h)=>Date.parse(h.snapshot.createdAt)-Date.parse(u.snapshot.createdAt));for(let u of c){let h;try{h=await this.#r.scene(u.snapshot.sceneUrl,u.snapshot.revision,!0,"history",n.signal)}catch(k){if(L(k)||n.signal.aborted)return;continue}let m=this.#t.current();if(n.signal.aborted||!m||!We(e,m)||this.#e.value.resources.scene.value)return;if(!h.scene)continue;let v=this.#e.value;this.#e.patch({floor:{...v.floor,readOnly:!0,displayName:He(u.floor,1)},resources:{...v.resources,scene:p("ready",h.scene),pose:p("idle",null)},map:{...v.map,available:!0,exactPose:!1},notice:{tone:"warning",text:`${Pn}${new Date(u.snapshot.createdAt).toLocaleString()}. Live position is unavailable.`}});break}}if(i.dataMode==="history"&&(!a||!l)){let c=a||r.floors.find(h=>h.active)||r.floors[0],u=this.selectFloor(c?.id||"current");!this.#i&&i.workflow==="history"&&this.#e.dispatch({type:"open-workflow",workflow:"history"}),await u}}catch(r){let o=this.#t.current();if(L(r)||n.signal.aborted||!o||!We(e,o))return;this.#e.patch({resources:{...this.#e.value.resources,history:p("error",null,H(r,"history-unavailable"))}})}finally{this.#R("history",n)}}async refreshPose(){let t=this.#e.value.resources.entry,e=this.#t.current();!t||!e||this.#e.value.selection.floorId!=="current"||!t.mapFloorCoherent||!t.mapSessionVerified||await this.#ue(t,e)}async#ue(t,e){if(this.#i||!this.#o.active||!this.#W||!this.#n?.host.connected)return;if(this.#$){this.#f=!0;return}this.#$=!0;let n=this.#k("pose");try{let r=await this.#r.pose(t.poseUrl,n.signal),o=this.#t.current(),i=this.#e.value.resources.entry;if(!o||!We(e,o)||!i||!this.#e.value.map.floorCoherent)return;if(!r.floorCoherent||r.mapSessionKey===null||r.mapSessionKey!==i.mapSessionKey){this.#e.patch({resources:{...this.#e.value.resources,pose:p("idle",null)},map:{...this.#e.value.map,exactPose:!1}}),this.#Z("pose",i);return}this.#X("pose",i);let a=this.#e.value,l=a.resources.pose.value,d=!!(a.map.exactPose&&l?.position&&l.mapSessionKey===i.mapSessionKey);if(r.position===null&&d){this.#e.patch({resources:{...a.resources,pose:p("ready",l)}});return}this.#e.patch({resources:{...a.resources,pose:p("ready",r)},map:{...a.map,exactPose:r.position!==null}})}catch(r){if(L(r)||!this.#t.accepts(e))return;let o=this.#e.value,i=o.resources.pose.value,a=!!(o.map.exactPose&&i?.position&&i.mapSessionKey===o.resources.entry?.mapSessionKey);this.#e.patch({resources:{...o.resources,pose:p("error",a?i:null,H(r,"pose-unavailable"))},map:{...o.map,exactPose:a}})}finally{if(this.#R("pose",n),this.#$=!1,this.#f&&!this.#i&&this.#W&&this.#n?.host.connected&&this.#n.host.administrator&&this.#n.host.robotCount>0){this.#f=!1;let r=this.#e.value.resources.entry,o=this.#t.current();r&&o&&this.#ue(r,o)}else this.#f=!1}}async selectFloor(t){let e=this.#e.value.resources.history.value,n=this.#e.value.resources.entry;if(!e||!n)return;let r=e.floors.find(l=>l.id===t);if(!r&&t!=="current")return;let o=this.#e.value;if(o.workflow==="draw"&&(o.draw.dirty||o.areaDraft.dirty)||o.workflow==="areaReview"&&(o.draw.dirty||o.areaDraft.dirty))return;if(!r||r.active){this.#w(),this.#b="";let l=this.#e.value;this.#e.patch({resources:{...l.resources,plans:p("idle",null),areas:p("idle",null),scene:p("idle",l.resources.scene.value),pose:p("idle",null)},map:{...l.map,available:l.resources.scene.value!==null,exactPose:!1},coherence:"verifying",floor:{...l.floor,readOnly:l.resources.scene.value!==null},notice:l.resources.scene.value?{tone:"warning",text:ne}:l.notice,workflow:"none",precisionOpen:!1}),this.#e.dispatch({type:"set-floor",floorId:"current"}),await this.refreshCatalog(!0);return}this.#w();let i=r.snapshots.at(-1),a=this.#t.begin(n.entryId,r.id,i?.id||r.id,i?.revision||0);this.#O(["catalog"]),this.#e.patch({generation:a.generation,coherence:"current",dataMode:"history",floor:{classifiedCount:e.floors.length,displayName:He(r,e.floors.indexOf(r)+1),readOnly:!0},selection:{...this.#e.value.selection,floorId:r.id,historyId:i?.id||null},resources:{...this.#e.value.resources,scene:p(i?"loading":"empty",null),pose:p("idle",null),plans:p("idle",null),areas:p("idle",null)},workflow:"none",precisionOpen:!1,map:{available:!1,complete:!0,floorCoherent:!0,sessionVerified:!0,exactPose:!1}}),i&&await this.#me(i,a)}async selectHistory(t){let e=this.#e.value.resources.history.value,n=this.#e.value.resources.entry;if(!e||!n)return;if(!t){await this.selectFloor("current");return}let r=e.floors.find(a=>a.snapshots.some(l=>l.id===t)),o=r?.snapshots.find(a=>a.id===t);if(!r||!o)return;this.#w();let i=this.#t.begin(n.entryId,r.id,o.id,o.revision);this.#O(["catalog"]),this.#e.patch({generation:i.generation,dataMode:"history",floor:{classifiedCount:e.floors.length,displayName:He(r,e.floors.indexOf(r)+1),readOnly:!0},selection:{...this.#e.value.selection,floorId:r.id,historyId:o.id},resources:{...this.#e.value.resources,scene:p("loading",null),pose:p("idle",null)},map:{...this.#e.value.map,available:!1,exactPose:!1}}),await this.#me(o,i)}async#me(t,e){if(!this.#o.active)return;let n=this.#k("history-scene");try{let r=await this.#r.scene(t.sceneUrl,t.revision,!0,"history",n.signal);if(!this.#t.accepts(e)||!r.scene)return;this.#e.patch({resources:{...this.#e.value.resources,scene:p("ready",r.scene)},map:{...this.#e.value.map,available:!0,exactPose:!1}})}catch(r){if(L(r)||!this.#t.accepts(e))return;this.#e.patch({resources:{...this.#e.value.resources,scene:p("error",null,H(r,"history-scene-unavailable"))}})}finally{this.#R("history-scene",n)}}async openWorkflow(t){let e=this.#e.value;if((e.dataMode==="history"||e.floor.readOnly)&&yr.includes(t))return;let n=this.#e.value.workflow;if(t==="draw"&&n!=="draw"&&n!=="areaReview"&&this.selectArea(null),this.#e.dispatch({type:"open-workflow",workflow:t}),t==="history"){let r=this.#e.value.resources.entry,o=this.#t.current();r&&o&&(this.#e.patch({resources:{...this.#e.value.resources,history:p("loading",this.#e.value.resources.history.value)}}),await this.#se(r,o))}(t==="plans"||t==="plan"||t==="rooms")&&await this.loadPlans(),(t==="draw"||t==="areaReview")&&await this.loadAreas()}async loadPlans({force:t=!1}={}){if(!this.#o.active){this.#a.get("plans")?.abort();let o=this.#e.value.resources;return this.#e.patch({resources:{...o,plans:p("idle",o.plans.value)}}),null}let e=this.#e.value.resources.entry;if(!e||!this.#t.current()||!nt(this.#e.value)||!t&&this.#e.value.resources.plans.status==="loading")return null;let n=z(e),r=this.#k("plans");this.#e.patch({resources:{...this.#e.value.resources,plans:p("loading",null)}});try{let o=await this.#r.plans(e.plansUrl,r.signal),i=this.#e.value.resources.entry;if(r.signal.aborted||this.#i||!i||z(i)!==n)return null;let a=this.#e.value;if(a.planDraft.dirty||a.workflow==="plan"&&(!a.planDraft.id||a.command==="pending"))return this.#e.patch({resources:{...this.#e.value.resources,plans:p("ready",o)}}),o;let l=a.workflow==="plan"?a.selection.planId:o.selectedPlan||o.plans[0]?.id||null,d=o.plans.find(c=>c.id===l);return this.#e.patch({resources:{...this.#e.value.resources,plans:p("ready",o)},selection:{...this.#e.value.selection,planId:l},planDraft:d?tt(d):{...this.#e.value.planDraft,id:null,name:"",rooms:[],dirty:!1}}),o}catch(o){let i=this.#e.value.resources.entry;if(L(o)||r.signal.aborted||this.#i||!i||z(i)!==n)return null;let a=o instanceof E&&o.code==="map-rechecking"?"map-rechecking":H(o,"plans-unavailable");return this.#e.patch({resources:{...this.#e.value.resources,plans:p("error",null,a)}}),null}finally{this.#R("plans",r)}}selectPlan(t,e=!1){let n=this.#e.value.resources.plans.value?.plans.find(r=>r.id===t);this.#e.patch({workflow:"plan",notice:!e&&this.#e.value.notice?.tone==="success"?null:this.#e.value.notice,selection:{...this.#e.value.selection,planId:t},planDraft:n?tt(n):{...q().planDraft}})}#fe(){let t=this.#e.value;(t.workflow==="draw"||t.workflow==="areaReview")&&t.resources.areas.status==="idle"&&this.loadAreas()}async loadAreas({reconcileDraft:t=!0}={}){if(!this.#o.active){this.#a.get("areas")?.abort();let o=this.#e.value.resources;return this.#e.patch({resources:{...o,areas:p("idle",o.areas.value)}}),null}let e=this.#e.value.resources.entry;if(!e||!this.#t.current()||!nt(this.#e.value))return null;let n=z(e),r=this.#k("areas");this.#e.patch({resources:{...this.#e.value.resources,areas:p("loading",null)}});try{let o=await this.#r.areas(e.areasUrl,r.signal),i=this.#e.value.resources.entry;if(r.signal.aborted||this.#i||!i||z(i)!==n)return null;if(o.sceneUrl!==i.sceneUrl)throw new E("areas-unavailable");this.#e.patch({resources:{...this.#e.value.resources,areas:p("ready",o)}});let a=this.#e.value.selection.areaId,l=this.#e.value,d=o.areas.some(c=>c.id===a);return t&&(!l.draw.dirty&&!l.areaDraft.dirty||a!==null&&!d)&&this.selectArea(d?a:null),o}catch(o){let i=this.#e.value.resources.entry;return L(o)||r.signal.aborted||this.#i||!i||z(i)!==n||this.#e.patch({resources:{...this.#e.value.resources,areas:p("error",null,H(o,"areas-unavailable"))}}),null}finally{this.#R("areas",r)}}selectArea(t){let e=this.#e.value.resources.areas.value?.areas.find(r=>r.id===t),n=this.#e.value;this.#e.patch({selection:{...n.selection,areaId:t},areaDraft:e?this.#_e(e):{id:null,name:"",cleaningMode:"vacuum",coverageSetting:"standard",status:"new",canRebind:!1,dirty:!1},draw:{...n.draw,circles:e?.circles||[],outline:e?.outline??null,outlineUndo:[],outlineRedo:[],tool:!e||e.outline?"outline":"paint",undo:[],redo:[],dirty:!1,strokeCount:0}})}#_e(t){return{id:t.id,name:t.name,cleaningMode:t.cleaningMode,coverageSetting:t.coverageSetting,status:t.status,canRebind:t.canRebind,dirty:!1}}async saveArea(){let t=this.#e.value,e=t.resources.entry,n=t.areaDraft;if(!e||t.command==="pending"||!ie(t)||!n.name.trim()||!t.draw.circles.length)return;let r=this.#k("area-mutation"),o=()=>!this.#i&&!r.signal.aborted;this.#e.patch({command:"pending",notice:{tone:"info",text:"Saving area\u2026"}});try{let i=await this.#r.saveArea(e.areasUrl,{areaId:n.id,name:n.name.trim(),circles:t.draw.circles,outline:t.draw.outline??null,cleaningMode:n.cleaningMode,coverageSetting:n.coverageSetting},r.signal);if(!o())return;let a=this.#e.value,d=a.areaDraft===n&&a.draw.circles===t.draw.circles&&a.draw.outline===t.draw.outline&&a.selection.entryId===t.selection.entryId&&(a.workflow==="draw"||a.workflow==="areaReview")?{...n,id:i,name:n.name.trim(),status:"current",canRebind:!1,dirty:!1}:null;this.#e.patch({command:"idle",notice:{tone:"success",text:"Area saved"},...d?{dialog:a.dialog==="discardDraft"?null:a.dialog,selection:{...a.selection,areaId:i},areaDraft:d,draw:{...a.draw,dirty:!1,strokeCount:0,undo:[],redo:[],outlineUndo:[],outlineRedo:[]}}:{}});let c=await this.loadAreas({reconcileDraft:!1}),u=this.#e.value;o()&&d&&u.areaDraft===d&&!u.draw.dirty&&(u.workflow==="draw"||u.workflow==="areaReview")&&u.selection.entryId===t.selection.entryId&&c&&u.resources.areas.value===c&&c.areas.some(h=>h.id===i)&&this.selectArea(i)}catch(i){if(L(i)||!o())return;this.#e.patch({command:"failed",notice:{tone:"error",text:"Area could not be saved"}})}finally{this.#R("area-mutation",r)}}async deleteArea(){let t=this.#e.value.resources.entry,e=this.#e.value.selection.areaId;if(!t||!e||this.#e.value.command==="pending"||!ie(this.#e.value))return;let n=this.#k("area-mutation"),r=()=>!this.#i&&!n.signal.aborted;this.#e.patch({command:"pending",notice:null});try{if(await this.#r.deleteArea(t.areasUrl,e,n.signal),!r())return;this.#e.patch({command:"idle",notice:{tone:"success",text:"Area deleted"}}),await this.loadAreas()}catch(o){!L(o)&&r()&&this.#e.patch({command:"failed",notice:{tone:"error",text:"Area could not be deleted"}})}finally{this.#R("area-mutation",n)}}async savePlan(){let t=this.#e.value,e=t.planDraft,n=t.resources.plans.value;if(!n||!e.name.trim()||!e.rooms.length||!ie(t))return;let r=e.rooms,o=e.id;if(await this.#ve("save_plan",{...e.id?{plan_id:e.id}:{},name:e.name.trim(),enabled:e.enabled,run_behavior:e.runBehavior,rooms:r.map(a=>({room:a.roomId,cleaning_mode:a.cleaningMode,coverage_setting:a.coverageSetting,...a.cadence?{cadence:{scope:a.cadence.scope,mop_every_n:a.cadence.mopEveryN,coverage_every_n:a.cadence.coverageEveryN,periodic_coverage_setting:a.cadence.periodicCoverageSetting,do_mop_next:a.cadence.doMopNext,do_coverage_next:a.cadence.doCoverageNext}}:{}})),return_to_base:e.returnToBase,finish_current_room:e.finishCurrentRoom,finish_current_room_threshold:e.finishCurrentRoomThreshold,select:!e.id||n.selectedPlan===e.id},"Plan saved","Plan save could not be confirmed. Check saved plans before trying again.",a=>{let l=a===void 0&&e.id?e.id:an(a);if(e.id&&l!==e.id)throw new E("invalid-plan-save-response");o=l})){let a=this.#e.value.workflow==="plan"&&this.#e.value.planDraft===e?{...e,id:o,dirty:!1}:null;a&&this.#e.patch({planDraft:a,selection:{...this.#e.value.selection,planId:o}});let l=await this.loadPlans({force:!0});a&&this.#e.value.workflow==="plan"&&this.#e.value.planDraft===a&&this.#e.value.selection.entryId===t.selection.entryId&&l&&this.#e.value.resources.plans.value===l&&o&&l.plans.some(d=>d.id===o)&&this.selectPlan(o,!0)}}async deletePlan(){let t=this.#e.value.selection.planId,e=this.#e.value.selection.entryId;if(!t)return;if(await this.#ve("delete_plan",{plan:t},"Plan deleted","Plan could not be deleted")){let r=this.#e.value;r.selection.entryId===e&&r.planDraft.id===t&&(this.#e.patch({selection:{...r.selection,planId:null},planDraft:q().planDraft}),r.workflow==="plan"&&this.#e.patch({workflow:"plans",precisionOpen:!1})),await this.loadPlans({force:!0})}}async executeAction(t){switch(typeof t=="string"?t:t.id){case"recheck-status":{let n=this.#e.value.selection.entryId;await this.refreshCatalog(!0);let r=this.#e.value;!this.#i&&r.selection.entryId===n&&r.resources.catalog.status==="ready"&&r.host.connected&&r.host.robotConnected&&r.coherence==="current"&&r.command==="failed"&&this.#e.patch({command:"idle",notice:{tone:"info",text:"Status refreshed. Review the robot state before trying again."}});return}case"stop":await this.#ie("matic_robot","stop_intelligent_cleaning",{include_unmanaged:!0});return;case"resume":await this.#ie("vacuum","send_command",{command:"resume"});return;case"run-plan":{let n=this.#e.value,r=n.selection.planId||n.resources.plans.value?.selectedPlan;if(!r||n.workflow!=="plan"||!n.planDraft.enabled||n.resources.plans.status!=="ready"||n.command!=="idle"||!we(n))return;let o=n.selection.entryId,i=n.generation,a=n.selection.planId,l=n.planDraft,d=n.resources.plans.value?.plans.find(v=>v.id===r)?.nextRunPreview;if(!d||!/^[0-9a-f]{64}$/u.test(d.previewToken??"")){this.#e.patch({notice:{tone:"warning",text:"A verified next-run preview is unavailable. Refresh the saved plan before starting it."}});return}this.#e.patch({command:"pending",notice:null});let c=this.#k("plan-preflight");try{await this.loadPlans()}finally{this.#R("plan-preflight",c)}let u=this.#e.value,h=()=>{let v=this.#e.value;!this.#i&&v.selection.entryId===o&&v.generation===i&&v.command==="pending"&&this.#e.patch({command:"idle"})};if(c.signal.aborted||this.#i||u.selection.entryId!==o||u.generation!==i||u.workflow!=="plan"||u.selection.planId!==a||(u.selection.planId||u.resources.plans.value?.selectedPlan)!==r||u.planDraft!==l){h();return}if(u.resources.plans.status!=="ready"){h(),this.#e.patch({notice:{tone:"warning",text:"Plan preview could not be refreshed. Check the plan and try again."}});return}let m=u.resources.plans.value?.plans.find(v=>v.id===r)?.nextRunPreview;if(!m||m.blocker||!/^[0-9a-f]{64}$/u.test(m.previewToken??"")){h(),this.#e.patch({notice:{tone:"warning",text:"This plan has no valid next-run preview. Review its rooms and schedule."}});return}if(!d||JSON.stringify(d)!==JSON.stringify(m)){h(),this.#e.patch({notice:{tone:"info",text:"The next-run preview changed. Review the updated settings before starting."}});return}h(),await this.#ie("matic_robot","run_selected_plan",{plan:r,preview_token:m.previewToken});return}case"clean-rooms":{await this.#ke();return}case"run-area":{let n=this.#e.value.selection.areaId;n&&await this.#ie("matic_robot","clean_area",{area:n});return}case"review-area":this.#e.dispatch({type:"open-workflow",workflow:"areaReview"});return;case"save-area":await this.saveArea();return;case"save-plan":await this.savePlan();return;case"delete-plan":await this.deletePlan();return;case"delete-area":await this.deleteArea();return;case"reset-room-cadence":{if(typeof t=="string")return;let n=this.#e.value;if(n.selection.planId!==t.planId||n.planDraft.dirty||n.dataMode!=="live"||n.command!=="idle"||n.activity!=="idle"&&n.activity!=="docked"||!await this.#ve("reset_room_cadence",{plan:t.planId,room_id:t.roomId,modes:[t.mode]},t.mode==="mop"?"Mopping progress reset":"Coverage progress reset",t.mode==="mop"?"Mopping progress could not be reset":"Coverage progress could not be reset"))return;let o=await this.loadPlans({force:!0}),i=this.#e.value;!this.#i&&i.selection.entryId===n.selection.entryId&&i.selection.planId===t.planId&&!i.planDraft.dirty&&o&&i.resources.plans.value===o&&this.selectPlan(t.planId,!0);return}}}async#ke(){if(this.#g)return;let t=this.#e.value,e=this.#Y(t),n=et(t);if(!e||!n||n.key!==e.key||n.generation!==e.generation||n.floorKey!==e.floorKey||n.missionKey!==e.missionKey||n.preview.entryId!==e.entryId||n.preview.blocker||n.preview.rooms.length===0)return;this.#g=!0;let r=this.#k("room-preview");this.#D=this.#q(e),this.#e.patch({manualRoomPreview:p("loading",null),notice:null});try{let o=await this.#r.previewRoomSequence(e.entityId,e.rooms,e.overrideRoomSchedule,r.signal);if(r.signal.aborted||!this.#T(e)||o.entryId!==e.entryId)return;let i={key:e.key,generation:e.generation,floorKey:e.floorKey,missionKey:e.missionKey,preview:o};if(o.blocker||o.rooms.length===0){this.#e.patch({manualRoomPreview:p("ready",i),notice:{tone:"warning",text:"The room preview is blocked. Review the current map and schedule before starting."}});return}if(Mn(n.preview)!==Mn(o)){this.#e.patch({manualRoomPreview:p("ready",i),notice:{tone:"info",text:"The room preview changed. Review the updated settings before starting."}});return}if(this.#e.patch({manualRoomPreview:p("ready",i),notice:null}),!this.#T(e)||!we(this.#e.value))return;await this.#ie("matic_robot","clean_room_sequence",{rooms:e.rooms,use_room_schedule:!0,override_room_schedule:e.overrideRoomSchedule,return_to_base:!0,preview_token:o.previewToken})}catch(o){!L(o)&&!r.signal.aborted&&this.#T(e)&&this.#e.patch({manualRoomPreview:p("error",null,H(o,"preview-unavailable")),notice:{tone:"warning",text:"The room preview could not be refreshed. No cleaning was started."}})}finally{this.#R("room-preview",r),this.#g=!1,this.#F()}}async#ve(t,e,n,r,o){let i=this.#n?.vacuumEntityId;if(!i||!ie(this.#e.value)||this.#e.value.command==="pending")return!1;let a=this.#k("plan-mutation"),l=this.#n?.entryKey,d=this.#n?.userKey,c=()=>!this.#i&&!a.signal.aborted&&l===this.#n?.entryKey&&d===this.#n?.userKey;this.#e.patch({command:"pending",notice:{tone:"info",text:"Saving\u2026"}});try{let u=await this.#r.service("matic_robot",t,e,i,{acknowledgementTimeout:"mutation",...o?{returnResponse:!0}:{}});return c()?(o?.(u),this.#e.patch({command:"idle",notice:{tone:"success",text:n}}),!0):!1}catch{return c()&&this.#e.patch({command:"failed",notice:{tone:"error",text:r}}),!1}finally{this.#R("plan-mutation",a)}}async#ie(t,e,n){let r=this.#e.value,o=this.#n?.vacuumEntityId,i=e==="stop_intelligent_cleaning"||t==="vacuum"&&e==="return_to_base",a=t==="vacuum"&&e==="send_command"&&n.command==="resume";if(!o||r.selection.entryId!==this.#n?.entryKey||(i?!Et(r):a?!Pt(r):!we(r)))return;let l=++this.#E,d=this.#n?.entryKey,c=()=>!this.#i&&l===this.#E&&d===this.#n?.entryKey,u=i?"settling":"starting";this.#u!==null&&window.clearTimeout(this.#u),this.#u=null,this.#e.patch({command:u,notice:null});try{if(await this.#r.service(t,e,n,o),!c())return;if(t==="matic_robot"&&(e==="clean_room_sequence"||e==="run_selected_plan")){this.#e.patch({command:"idle"}),this.refreshCatalog(!0);return}this.#e.patch({command:u}),this.#u!==null&&window.clearTimeout(this.#u),this.#u=window.setTimeout(()=>{this.#u=null,c()&&this.#e.value.command===u&&this.#e.patch({command:"idle"})},15e3)}catch(h){if(!c())return;this.#e.patch({command:"failed",notice:{tone:"error",text:mr(h)??"The action could not be confirmed. Check the robot status before trying again."}})}}dispose(){this.#i||(this.#i=!0,this.#o.dispose(),this.#K(!1),this.#P?.(),this.#P=null,this.#e.patch({manualRoomPreview:p("idle",null)}),this.#N(),this.#O(),this.#u!==null&&window.clearTimeout(this.#u),this.#u=null,this.#s.dispose(),this.#ye(),this.#r.dispose())}#ye(){this.#v?.dispose(),this.#v=null,this.#A=null,this.#S=null}};var An=s=>(s.workflow==="none"?0:s.workflow==="plan"?2:1)+(s.fullMap?1:0)+(s.precisionOpen?1:0)+(s.dialog?1:0),In=s=>{if(!s||typeof s!="object")return null;let t=s.maticMapLayer;if(!t||typeof t!="object")return null;let e=t.owner,n=t.depth;return typeof e=="string"&&Number.isInteger(n)&&Number(n)>=0?{owner:e,depth:Number(n)}:null},Ke=class{#e;#t=`matic-map-${crypto.randomUUID?.()||Math.random().toString(36).slice(2)}`;#r=0;#o=null;#s=!1;#l=!1;constructor(t){this.#e=t}start(){this.#o||(this.#r=An(this.#e.value),this.#o=this.#e.subscribe(t=>this.#a(t)),window.addEventListener("popstate",this.#n))}#a(t){let e=An(t);if(this.#s){this.#s=!1,this.#r=e;return}if(e<this.#r){let n=In(history.state);if(n?.owner===this.#t&&n.depth===this.#r){let r=e-this.#r;this.#r=e,this.#l=!0,history.go(r);return}}if(e>this.#r)for(let n=this.#r+1;n<=e;n+=1){let r=history.state&&typeof history.state=="object"?history.state:{};history.pushState({...r,maticMapLayer:{owner:this.#t,depth:n}},"",window.location.href)}this.#r=e}#n=()=>{if(this.#l){this.#l=!1;return}if(!(this.#r<1)){if(j(this.#e.value,{type:"dismiss-top-layer"})){let t=history.state&&typeof history.state=="object"?history.state:{};history.pushState({...t,maticMapLayer:{owner:this.#t,depth:this.#r}},"",window.location.href),this.#e.dispatch({type:"open-dialog",dialog:"discardDraft"});return}this.#s=!0,this.#e.dispatch({type:"dismiss-top-layer"})}};dismissTop(){if(this.#r<1)return!1;let t=In(history.state);return t?.owner===this.#t&&t.depth===this.#r?history.back():this.#e.dispatch({type:"dismiss-top-layer"}),!0}dispose(){this.#o?.(),this.#o=null,window.removeEventListener("popstate",this.#n),this.#r=0,this.#l=!1}};var Tn=[G,Q,Se,Y`
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
  `];var yt=class extends X{constructor(){super(...arguments);this.state=q();this.compact=!1;this.inline=!1}static{this.properties={state:{attribute:!1},localize:{attribute:!1},compact:{type:Boolean,reflect:!0},inline:{type:Boolean,reflect:!0}}}static{this.styles=[G,Q,Se,Y`
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
`]}#e(e,n){return V(this.localize,e,n)}#t(e){this.dispatchEvent(new CustomEvent(ue,{detail:e,bubbles:!0,composed:!0}))}#r(e){let n=e.currentTarget.valueAsNumber;Number.isFinite(n)&&this.#t({type:"set-brush",value:n})}render(){let{draw:e}=this.state;return _e`
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
                @change=${this.#r}
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
            @input=${this.#r}
            aria-label=${this.#e("v4_brush_width_slider","Brush width slider")}
            aria-valuetext=${`${e.brushMeters.toFixed(2)} m`}
          />
        </div>
        <p class="hint">${this.#e("v4_precision_hint","Strokes follow the verified map resolution. Zoom changes the view, not the saved outline.")}</p>
      </div>
    `}};customElements.get(ae)||customElements.define(ae,yt);var $n=J(ke),Be=J(ae),Ln=J(le),qn=s=>s.dataMode==="history"||s.floor.readOnly,gr=(s,t)=>{let e=(a,l,d)=>V(t,a,l,d);if(!s.host.connected)return{title:e("v4_reconnecting","Reconnecting"),detail:e("v4_ha_offline","Home Assistant is offline"),icon:F,notable:!0};if(!s.host.administrator)return{title:e("v4_access_required","Access required"),detail:e("v4_admin_only","Administrator only"),icon:F,notable:!0};if(s.host.robotCount===0)return{title:e("v4_no_robot_short","No robot"),detail:e("v4_set_up_robot","Set up a Matic robot"),icon:F,notable:!0};if(be(s))return{title:e("v4_selected_robot_unavailable","Selected robot unavailable"),detail:e("v4_choose_another_robot","Choose another robot to open its map."),icon:F,notable:!0};if(!s.host.robotConnected)return{title:e("v4_robot_offline","Robot offline"),detail:e("v4_last_map_read_only","Last verified map \xB7 read only"),icon:F,notable:!0};if(s.activity==="problem")return{title:e("v4_needs_attention","Needs attention"),detail:e("v4_check_robot","Check the robot"),icon:F,notable:!0};if(s.dataMode==="history"){let a=s.resources.history.value?.floors.find(c=>c.id===s.selection.floorId),l=a?.snapshots.findIndex(c=>c.id===s.selection.historyId)??-1,d=a?.snapshots.length??0;return{title:e("v4_saved_map","Saved map"),detail:l>=0?e("v4_read_only_position","Read only \xB7 {position} of {count}",{position:l+1,count:d}):e("v4_read_only","Read only"),icon:ot,notable:!1}}if(s.coherence==="verifying"||s.coherence==="booting")return{title:e("v4_locating","Locating"),detail:e("v4_finding_map","Finding the current map"),icon:de,notable:!0};if((s.resources.entry?.activePlan||s.resources.entry?.runnerLocked)&&(s.activity==="idle"||s.activity==="docked"))return{title:e("v4_task_in_progress","Task in progress"),detail:s.coherence==="unavailable"||s.coherence==="blocked"?e("v4_task_map_unavailable","The live map is unavailable; the current task remains in progress."):s.activity==="docked"?e("v4_task_docked","Robot docked; the cleaning task has not finished."):e("v4_task_waiting","Waiting for the cleaning task to continue or finish."),icon:st,notable:!0};if(s.command==="starting"&&(s.activity==="idle"||s.activity==="docked"))return{title:e("v4_action_starting","Starting"),detail:e("v4_action_starting_detail","Waiting for the robot to begin"),icon:de,notable:!0};let n=s.coherence==="unavailable"||s.coherence==="blocked",r=e("v4_active_map_unavailable","The live map is unavailable; new cleaning is disabled."),o=a=>n?`${a} \xB7 ${r}`:a;if(s.activity==="cleaning")return{title:e("v4_cleaning","Cleaning"),detail:o(e("v4_cleaning_progress","Cleaning in progress")),icon:it,notable:!0};if(s.activity==="recharging"){let a=s.batteryPercent===null?e("v4_recharging_detail","Will resume automatically when ready"):e("v4_recharging_battery","Charging to resume \xB7 {percent}% battery",{percent:s.batteryPercent});return{title:e("v4_recharging","Charging to resume"),detail:o(a),icon:Ht,notable:!0}}if(s.activity==="paused")return{title:e("v4_paused","Paused"),detail:o(e("v4_can_resume","Cleaning can resume")),icon:at,notable:!0};if(s.activity==="returning")return{title:e("v4_returning","Returning"),detail:o(e("v4_going_dock","Going to the dock")),icon:it,notable:!0};if(s.activity==="stopping")return{title:e("v4_stopping","Stopping"),detail:o(e("v4_waiting_robot","Waiting for the robot")),icon:at,notable:!0};if(n)return{title:e("v4_map_unavailable","Map unavailable"),detail:e("v4_map_unavailable_status","New cleaning is disabled until the live map is verified."),icon:F,notable:!0};let i=s.batteryPercent===null?e("v4_ready","Ready"):e("v4_battery","{percent}% battery",{percent:s.batteryPercent});return{title:s.activity==="docked"?e("v4_docked","Docked"):e("v4_ready","Ready"),detail:i,icon:de,notable:!1}},On=(s,t)=>{let e=(n,r)=>V(t,n,r);switch(s.workflow){case"rooms":return{title:e("v4_choose_rooms","Choose rooms"),description:e("v4_choose_rooms_detail","Select on the map or from the list.")};case"draw":return{title:e("v4_draw_area","Draw an area"),description:e("v4_draw_area_detail","Outline or paint the area, then review it before saving.")};case"plans":return{title:e("v4_your_plans","Your plans"),description:e("v4_choose_plan_detail","Choose a plan to edit or run, or create a new one.")};case"plan":return{title:s.planDraft.id?e("v4_edit_plan","Edit plan"):e("v4_create_plan","Create a plan"),description:e("v4_plan_detail","Review rooms and cleaning settings.")};case"areaReview":return{title:e("v4_name_this_area","Name this area"),description:e("area_details_hint","Name the area and choose cleaning settings.")};case"history":return{title:e("v4_map_history","Map history"),description:e("v4_map_history_detail","Saved maps are floor-scoped and read only.")};case"support":return{title:e("v4_map_diagnostics","Map diagnostics"),description:e("v4_map_support_detail","Private geometry is never included.")};case"none":return qn(s)?{title:e("v4_saved_map_read_only_title","Saved map is read only"),description:s.dataMode==="live"?e("v4_map_recovery_automatic","Cleaning controls return automatically when the live map is verified."):e("v4_saved_map_read_only_detail","Return to the live map to choose rooms, run a plan, or draw a custom area.")}:{title:e("v4_what_to_clean","What should the robot clean?"),description:e("v4_clean_detail","Choose rooms, a saved plan, or a custom area.")}}},B=["peek","half","full"],Dn={none:"half",rooms:"half",draw:"peek",plan:"full",plans:"full",areaReview:"half",history:"half",support:"full"},br=.5,wr=100,_r=6,kr=48,Sr=["a[href]","button","input","label","select","textarea","summary",'[contenteditable]:not([contenteditable="false"])','[role="button"]','[role="link"]','[role="slider"]','[role="checkbox"]','[role="radio"]','[role="switch"]','[role="tab"]','[role="menuitem"]','[tabindex]:not([tabindex="-1"])'].join(","),Rr=["button:not(:disabled)","a[href]","input:not(:disabled)","select:not(:disabled)","textarea:not(:disabled)","[tabindex]:not([tabindex='-1'])"].join(", "),Cr=(s,t,e=!1,n="room",r=!1,o="mop")=>{let i=(a,l,d)=>V(t,a,l,d);switch(s){case"discardDraft":return{title:e?i("v4_discard_plan","Discard plan changes?"):i("v4_discard_area","Discard area changes?"),detail:e?i("v4_discard_plan_detail","Your plan changes have not been saved. Keep editing or discard them."):i("v4_discard_area_detail","Your area changes have not been saved. Keep editing or discard them."),cancelLabel:i("v4_keep_area_editing","Keep editing"),confirmLabel:i("v4_discard","Discard"),action:"discard"};case"confirmDeletePlan":return{title:i("v4_delete_plan","Delete this plan?"),detail:i("v4_delete_plan_detail","This removes the saved plan from Home Assistant. The robot will not move."),cancelLabel:i("v4_cancel","Cancel"),confirmLabel:i("plan_delete","Delete plan"),action:"delete-plan"};case"confirmDeleteArea":return{title:i("v4_delete_area","Delete this area?"),detail:i("v4_delete_area_detail","This removes the saved outline from Home Assistant. The robot will not move."),cancelLabel:i("v4_cancel","Cancel"),confirmLabel:i("area_delete","Delete area"),action:"delete-area"};case"confirmResetCadence":return{title:o==="mop"?i("v4_reset_mop_cadence_title","Reset mopping progress for {room}?",{room:n}):i("v4_reset_coverage_cadence_title","Reset coverage progress for {room}?",{room:n}),detail:r?o==="mop"?i("v4_reset_shared_mop_cadence_detail","This clears shared mopping progress for {room} across plans that use its shared schedule. Coverage progress and saved cleaning history stay unchanged.",{room:n}):i("v4_reset_shared_coverage_cadence_detail","This clears shared coverage progress for {room} across plans that use its shared schedule. Mopping progress and saved cleaning history stay unchanged.",{room:n}):o==="mop"?i("v4_reset_private_mop_cadence_detail","This clears mopping progress for {room} in this plan. Coverage progress and saved cleaning history stay unchanged.",{room:n}):i("v4_reset_private_coverage_cadence_detail","This clears coverage progress for {room} in this plan. Mopping progress and saved cleaning history stay unchanged.",{room:n}),cancelLabel:i("v4_cancel","Cancel"),confirmLabel:o==="mop"?i("v4_reset_mop_cadence_confirm","Reset mopping progress"):i("v4_reset_coverage_cadence_confirm","Reset coverage progress"),action:"reset-room-cadence"};case"confirmStop":return{title:i("v4_stop_cleaning","Stop cleaning?"),detail:i("v4_stop_cleaning_detail","The robot may take a moment to settle before another action is available."),cancelLabel:i("v4_keep_cleaning","Keep cleaning"),confirmLabel:i("v4_stop","Stop"),action:"stop"};case"error":return{title:i("v4_error","Something went wrong"),detail:i("v4_error_detail","No action was started. Close this message and try again when the map is ready."),cancelLabel:i("v4_close","Close"),confirmLabel:i("v4_close","Close"),action:null};case null:return null}},xr=(s=document)=>{let t=s.activeElement;for(;t?.shadowRoot?.activeElement;)t=t.shadowRoot.activeElement;return t},gt=s=>!!(s&&s.isConnected&&s.offsetParent!==null),bt=class extends X{constructor(){super();this.state=q();this._measuredNarrow=!1;this._sheetOffset=0;this._overflowOpen=!1;this._helpOpen=!1;this._browserFullscreen=!1;this._sheetDetent="half";this._announcement="";this._workflowLoadFailed=!1;this.#t=null;this.#r=null;this.#o=null;this.#s=null;this.#l=null;this.#a=null;this.#n=null;this.#p=null;this.#m=null;this.#u=null;this.#C=()=>{this._browserFullscreen=this.#z()};this.#y=e=>{if(!this._overflowOpen)return;let n=this.renderRoot.querySelector(".overflow-wrap");(!n||!e.composedPath().includes(n))&&(this._overflowOpen=!1)};this.#re=()=>{this._workflowLoadFailed=!1,this.#ne()};new Bt(this,{container:()=>this.renderRoot?.querySelector(".draw-tools")??null,items:"button"})}static{this.properties={state:{attribute:!1},localize:{attribute:!1},_measuredNarrow:{state:!0},_sheetOffset:{state:!0},_overflowOpen:{state:!0},_helpOpen:{state:!0},_browserFullscreen:{state:!0},_sheetDetent:{state:!0},_announcement:{state:!0},_workflowLoadFailed:{state:!0}}}static{this.styles=Tn}#e(e,n,r){return V(this.localize,e,n,r)}#t;#r;#o;#s;#l;#a;#n;#p;#m;#u;#E(){let e=this.renderRoot;return e instanceof ShadowRoot?e.fullscreenElement??document.fullscreenElement:document.fullscreenElement}#C;#z(){let e=this.renderRoot,n=e.querySelector(".app"),r=e instanceof ShadowRoot?e.fullscreenElement:null;if(r)return r===n;let o=document.fullscreenElement;for(let i=this;i;){if(i===o)return!0;let a=i.getRootNode();i=a instanceof ShadowRoot?a.host:null}return!1}#y;connectedCallback(){super.connectedCallback(),this.#t=new ResizeObserver(([e])=>{if(!e)return;let n=e.contentRect.width<1024||e.contentRect.height<480;n!==this._measuredNarrow&&(this._measuredNarrow=n)}),this.#t.observe(this),window.addEventListener("pointerdown",this.#y,!0),document.addEventListener("fullscreenchange",this.#C),this.#r=new ResizeObserver(([e])=>{if(!e)return;let n=Math.ceil(e.target.getBoundingClientRect().height);n!==this._sheetOffset&&(this._sheetOffset=n)})}disconnectedCallback(){this.#t?.disconnect(),this.#t=null,this.#r?.disconnect(),this.#r=null,this.#o=null,window.removeEventListener("pointerdown",this.#y,!0),document.removeEventListener("fullscreenchange",this.#C),super.disconnectedCallback()}updated(e){let n=e,r=this.renderRoot.querySelector(".mobile-sheet");if(r!==this.#o&&(this.#r?.disconnect(),this.#o=r,r?this.#r?.observe(r):this._sheetOffset!==0&&(this._sheetOffset=0)),n.has("_overflowOpen")&&this._overflowOpen&&this.updateComplete.then(()=>{this.renderRoot.querySelector("#map-options select, #map-options button")?.focus()}),n.has("_helpOpen")){if(this._helpOpen)this.updateComplete.then(()=>{this.renderRoot.querySelector(".help-dialog [data-dialog-initial-focus]")?.focus()});else if(n.get("_helpOpen")){let o=this.#a;this.#a=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>o?.focus({preventScroll:!0}))})}}if(e.has("state")){let o=e.get("state");if(o?.precisionOpen&&!this.state.precisionOpen&&this.#_()?.focus(),o?.fullMap&&!this.state.fullMap){let i=this.#l;this.#l=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>{(this.renderRoot.querySelector(".workspace-toggle")??this.renderRoot.querySelector(".nav--menu")??(i?.isConnected?i:null))?.focus({preventScroll:!0})})})}if(o&&!o.fullMap&&this.state.fullMap&&this.updateComplete.then(()=>{let i=this.#l;requestAnimationFrame(()=>{(this.renderRoot.querySelector(".workspace-toggle")??(i?.isConnected?i:null))?.focus({preventScroll:!0})})}),!o?.dialog&&this.state.dialog){let i=xr(this.shadowRoot||document);i?.hasAttribute("data-dialog-launcher")&&(this.#s=i),this.updateComplete.then(()=>{(this.renderRoot.querySelector(".dialog [data-dialog-initial-focus]")??this.renderRoot.querySelector(".dialog button"))?.focus()})}else if(o?.dialog&&!this.state.dialog){o.dialog==="discardDraft"&&(this.#n=null,this.#x());let i=this.#s?.isConnected&&this.#s.hasAttribute("data-dialog-launcher")?this.#s:this.#ce(o.dialog);this.#s=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>i?.focus({preventScroll:!0}))})}o?o.workflow!==this.state.workflow&&(this._sheetDetent=Dn[this.state.workflow],this.updateComplete.then(()=>this.#c())):this._sheetDetent=Dn[this.state.workflow]}}#c(){let e=this.renderRoot.querySelector(".panel-heading h2");if(gt(e)){e.focus({preventScroll:!0});return}let n=this.renderRoot.querySelector(".action-bar .ms-btn--primary");gt(n)&&n.focus({preventScroll:!0})}#_(){let e=this.renderRoot.querySelector(".draw-brush");return gt(e)?e:this.renderRoot.querySelector(ke)?.shadowRoot?.querySelector(".draw-brush")??null}#d(e){if(j(this.state,e)){this.#n=e,this.#d({type:"open-dialog",dialog:"discardDraft"});return}this.dispatchEvent(new CustomEvent(ue,{detail:e,bubbles:!0,composed:!0}))}#$(e){if(e.enabled){if(e.id==="return-live"){this.#d({type:"set-history",historyId:null});return}if(e.id==="clear-draft"){this.#d({type:"clear-draft"});return}this.#M(e.id)}}#f(e,n){let r={type:"open-workflow",workflow:e};n instanceof HTMLElement&&j(this.state,r)&&(this.#s=n),this.#d(r)}#b(){let e=this.#n;this.#n=null,e?.type==="select-plan"||e?.type==="select-area"?(this.#d({type:"patch-plan-draft",patch:{dirty:!1}}),this.#d({type:"patch-area-draft",patch:{dirty:!1}}),this.#d({type:"dismiss-top-layer"})):this.#d({type:"discard-draft"}),e&&e.type!=="dismiss-top-layer"&&queueMicrotask(()=>this.dispatchEvent(new CustomEvent(ue,{detail:e,bubbles:!0,composed:!0})))}#h(){this.#n=null,this.#L(),this.#x()}#x(){this.updateComplete.then(()=>{let e=this.renderRoot.querySelector(".floor-switcher");e&&(e.value=this.state.selection.floorId);let n=this.renderRoot.querySelector(".robot-switcher");n&&(n.value=this.state.selection.entryId??"")})}#L(){let e=this.state.dialog,n=e&&this.#s?.isConnected&&this.#s.hasAttribute("data-dialog-launcher")?this.#s:e?this.#ce(e):null;this.#d({type:"dismiss-top-layer"}),n&&requestAnimationFrame(()=>n.focus({preventScroll:!0}))}#M(e){this.dispatchEvent(new CustomEvent(Ut,{detail:typeof e=="string"?{id:e}:e,bubbles:!0,composed:!0}))}#i(e){this.#d({type:"dismiss-top-layer"}),this.#M(e)}#W(e){if(e.action==="discard"){this.#b();return}if(e.action==="delete-plan"||e.action==="delete-area"){this.#i(e.action);return}if(e.action==="reset-room-cadence"){let n=this.state.cadenceResetRequest;this.#d({type:"dismiss-top-layer"}),n&&this.#M({id:"reset-room-cadence",planId:n.planId,roomId:n.roomId,mode:n.mode});return}this.#d({type:"dismiss-top-layer"}),e.action==="stop"&&this.#M("stop")}#v(e){e!==this._sheetDetent&&(this._sheetDetent=e,this._announcement=this.#e("v4_workspace_height","Map workspace, {height} height",{height:e}))}#A(e,n=!1){let o=B.indexOf(this._sheetDetent)+e;n&&o>=B.length&&(o=0),o=Math.max(0,Math.min(B.length-1,o)),this.#v(B[o]??this._sheetDetent)}#S(e){let n=this.renderRoot.querySelector(".workspace")?.clientHeight??e.parentElement?.clientHeight??e.offsetHeight,r=parseFloat(getComputedStyle(this).fontSize)||16,o=[".sheet-grip",".sheet-tools",".action-bar"].map(l=>e.querySelector(l)?.offsetHeight??0).reduce((l,d)=>l+d,0)+r*.75,i=Math.min(n*.92,n-r*9),a=Math.min(n*.48,r*26,i);return{peek:Math.min(o,a),half:a,full:i}}#P(){return this.renderRoot.querySelector(".mobile-sheet")}#D(e){let n=e.currentTarget;for(let r of e.composedPath()){if(r===n)return!1;if(r instanceof Element&&r.matches(Sr))return!0}return!1}#g(e){if(e.pointerType==="mouse"&&e.button!==0||this.#D(e))return;let n=this.#P();!n||this.#m||(this.#m={pointerId:e.pointerId,startY:e.clientY,startHeight:n.offsetHeight,heights:this.#S(n),samples:[{y:e.clientY,t:e.timeStamp}],moved:!1},e.currentTarget.setPointerCapture(e.pointerId),n.classList.add("dragging"))}#I(e){let n=this.#m;if(!n||e.pointerId!==n.pointerId)return;let r=this.#P();if(!r)return;let o=e.clientY-n.startY;for(!n.moved&&Math.abs(o)>_r&&(n.moved=!0),n.samples.push({y:e.clientY,t:e.timeStamp});n.samples.length>2&&e.timeStamp-(n.samples[1]?.t??0)>wr;)n.samples.shift();if(!n.moved)return;let i=n.startHeight-n.heights.full,a=n.startHeight-n.heights.peek,l=Math.max(i,Math.min(a,o));r.style.transform=`translateY(${l}px)`}#H(e){let n=this.#m;if(!n||e.pointerId!==n.pointerId)return;this.#m=null;let r=this.#P();if(r&&(r.style.transform="",r.classList.remove("dragging")),e.type==="pointercancel")return;if(!n.moved){this.#A(1,!0);return}let o=e.clientY-n.startY,i=B.indexOf(this._sheetDetent),a=n.samples[0],l=n.samples[n.samples.length-1],d=a&&l&&l!==a?(l.y-a.y)/Math.max(1,l.t-a.t):0;if(Math.abs(d)>br){let m=Math.max(0,Math.min(B.length-1,i+(d<0?1:-1)));this.#v(B[m]??this._sheetDetent);return}let c=n.startHeight-o,u=this._sheetDetent,h=Number.POSITIVE_INFINITY;for(let m of B){let v=Math.abs(n.heights[m]-c);v<h&&(h=v,u=m)}this.#v(u)}#j(e){if(e.pointerType==="mouse"||this.#D(e))return;let n=e.currentTarget;this.#u={pointerId:e.pointerId,startY:e.clientY,atTop:n.scrollTop===0,consumed:!1}}#G(e){let n=this.#u;if(!n||n.consumed||!n.atTop||e.pointerId!==n.pointerId)return;if(e.currentTarget.scrollTop>0){this.#u=null;return}e.clientY-n.startY<kr||(n.consumed=!0,this.#A(-1))}#Q(){this.#u=null}#Y(){this.dispatchEvent(new CustomEvent("hass-toggle-menu",{bubbles:!0,composed:!0}))}#q(e){this.#l=e.currentTarget,this.#d({type:this.state.fullMap?"exit-full-map":"enter-full-map"})}#T(e){this._overflowOpen=!1,e&&this.updateComplete.then(()=>{this.renderRoot.querySelector(".overflow")?.focus()})}#F(e){if(this.#T(e==="fullscreen"),e==="support"){this.#f("support");return}let n=this.renderRoot.querySelector(".app");this.#E()?document.exitFullscreen():n?.requestFullscreen()}#he(){this.#d({type:"set-precision-open",value:!this.state.precisionOpen})}#ae(e){this.#a=e.currentTarget,this._helpOpen=!0}#le(e){let n=e;if(!ge(n.detail))return;if(j(this.state,n.detail)){e.stopPropagation(),this.#d(n.detail);return}if(n.detail?.type!=="open-dialog")return;let r=n.composedPath().find(o=>o instanceof HTMLElement&&o.hasAttribute("data-dialog-launcher"));r instanceof HTMLElement&&(this.#s=r)}#ce(e){return this.renderRoot.querySelector(le)?.shadowRoot?.querySelector(`[data-dialog-launcher="${e}"]`)??null}#K(e){if(!Kt(e)&&!(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey)&&e.key==="Escape"){if(e.preventDefault(),this._overflowOpen){this.#T(!0);return}if(this._helpOpen){this._helpOpen=!1;return}if(this.state.dialog==="discardDraft"){this.#h();return}this.#d({type:"dismiss-top-layer"})}}#B(e){if(e.key!=="Tab")return;let r=[...e.currentTarget.querySelectorAll(Rr)],o=r[0],i=r.at(-1);if(!o||!i)return;let a=this.shadowRoot?.activeElement;e.shiftKey&&a===o?(e.preventDefault(),i.focus()):!e.shiftKey&&a===i&&(e.preventDefault(),o.focus())}#U(){let e=this.renderRoot.querySelector(ke);(e?.shadowRoot?.querySelector(".map-root")??e)?.focus()}#pe(){this._sheetDetent==="peek"&&this.#P()&&this.#v("half"),this.updateComplete.then(()=>this.#c())}#V(e,n,r){if(e.id==="choose-cleaning")return _;let o=e.labelKey?this.#e(e.labelKey,e.label):e.label,i=!e.enabled&&e.reason?e.reasonKey?this.#e(e.reasonKey,e.reason):e.reason:null,a=e.id==="stop";return w`
      <button
        class=${`${n} ${e.kind==="danger"?"ms-btn--danger":""}`}
        type="button"
        aria-disabled=${e.enabled?_:"true"}
        aria-describedby=${i?r:_}
        aria-label=${a?this.#e("v4_stop_cleaning_label","Stop cleaning"):_}
        @click=${()=>this.#$(e)}
      >${o}</button>
      ${i?w`<p class="action-reason" id=${r}>${i}</p>`:_}
    `}#J(e){let n=e.resources.plans.value?.rooms??e.resources.areas.value?.rooms??[];return e.selection.roomIds.map(r=>n.find(o=>o.roomId===r)?.name??r)}#N(e,n,r){let o=n?.enabled&&e.workflow==="rooms"&&n.id==="clean-rooms"?[this.#J(e).join(", "),e.planDraft.returnToBase?this.#e("v4_returns_to_dock","returns to the dock"):""].filter(Boolean).join(" \xB7 "):"";return w`
      <div class="action-bar">
        ${o?w`<p class="action-summary">${o}</p>`:_}
        ${n?this.#V(n,"ms-btn ms-btn--block ms-btn--lg ms-btn--primary","primary-reason"):_}
        ${r?this.#V(r,"ms-btn ms-btn--block ms-btn--lg ms-btn--secondary","secondary-reason"):_}
      </div>
    `}#w(e,n,r=_){return w`
      <div class="host-state">
        <h3>${e}</h3>
        <p>${n}</p>
        ${r}
      </div>
    `}#X(e,n,r,o,i=!1){return w`
      <button
        class="ms-row"
        type="button"
        aria-disabled=${i?"true":_}
        @click=${()=>{i||r()}}
      >
        <span class="ms-row__lead">${I(n)}</span>
        <span class="ms-row__body"><strong>${e}</strong>${o?w`<small>${o}</small>`:_}</span>
        <span class="ms-row__trail">${I(Ce)}</span>
      </button>
    `}#Z(e){let n=e.resources.history.value?.floors||[],r=n.length?n.map((o,i)=>({id:o.active?"current":o.id,label:`${o.label||(o.active?this.#e("v4_current_floor","Current floor"):this.#e("v4_saved_floor","Saved floor {number}",{number:o.ordinal??i+1}))}${!o.active&&o.snapshots.length===0?` \xB7 ${this.#e("v4_floor_not_captured","Visit floor to capture")}`:""}`,disabled:!o.active&&o.snapshots.length===0})):[{id:e.selection.floorId,label:e.floor.displayName,disabled:!1}];return w`
      <select
        class="ms-select context-switcher floor-switcher"
        slot="floor"
        data-map-control
        name="map-floor"
        aria-label=${this.#e("v4_choose_floor","Choose floor")}
        ?disabled=${r.length<=1}
        .value=${e.selection.floorId}
        @change=${o=>this.#d({type:"set-floor",floorId:o.currentTarget.value})}
      >${r.map(o=>w`
        <option value=${o.id} ?selected=${o.id===e.selection.floorId} ?disabled=${o.disabled}>${o.label}</option>
      `)}</select>
    `}#ee(e,n){let r=(S,y,C)=>this.#e(S,y,C),o=this.#X(r("v4_map_history","Map history"),ot,()=>this.#f("history"),r("v4_map_history_detail","Saved maps are floor-scoped and read only.")),i=this.#X(r("v4_map_diagnostics","Map diagnostics"),Wt,()=>this.#f("support"),r("v4_map_support_detail","Private geometry is never included.")),{host:a}=e;if(!a.connected)return this.#w(r("v4_reconnecting_title","Reconnecting to Home Assistant"),r("v4_reconnecting_body","The last verified map stays read-only until the connection returns."));if(!a.administrator)return this.#w(r("v4_admin_title","Administrator access required"),r("v4_admin_body","Ask a Home Assistant administrator to open this map."));if(a.robotCount===0)return this.#w(r("v4_no_robot_title","No Matic robot set up"),r("v4_no_robot_body","Add the Matic integration to see a map here."),w`<a class="ms-btn ms-btn--secondary" href="/config/integrations/integration/matic_robot">${r("v4_open_integration","Open the Matic integration")}</a>`);if(be(e))return this.#w(r("v4_selected_robot_unavailable","Selected robot unavailable"),r("v4_choose_another_robot","Choose another robot to open its map."));if(!a.robotConnected)return w`
        ${this.#w(r("v4_robot_offline_title","Robot offline"),r("v4_robot_offline_body","Showing the last verified map. Cleaning is unavailable until the robot reconnects."))}
        <h3 class="shelf-heading">${r("v4_more","Map tools")}</h3>
        <div class="shelf">${o}${i}</div>
      `;if(qn(e))return w`
        <h3 class="shelf-heading">${r("v4_more","Map tools")}</h3>
        <div class="shelf">
          ${o}
          ${i}
        </div>
      `;let l=e.coherence==="verifying"||e.coherence==="booting",d=e.resources.plans,c=d.value,u=c!==null&&c.rooms.length===0,h=c?.plans.length??0,m=d.status==="loading",v=d.status==="error",k=l||u,g=l?r("v4_reason_locating","Waiting for the robot to confirm which floor it is on."):u?r("v4_no_rooms_reason","This floor has no named rooms yet."):null,b=l?r("v4_reason_locating","Waiting for the robot to confirm which floor it is on."):null,R=l?r("v4_reason_locating","Waiting for the robot to confirm which floor it is on."):r("v4_areas_quick_detail","Create or choose a saved area");return w`
      ${e.activity==="problem"?this.#w(r("v4_attention_title","The robot needs attention"),r("v4_attention_body","Check the robot, then start a new task.")):w`
          <div class="quick-actions" aria-label=${r("v4_cleaning_choices","Cleaning choices")}>
            <button
              class="ms-row ms-row--card ms-row--featured"
              type="button"
              aria-disabled=${k?"true":_}
              @click=${()=>{k||this.#f("rooms")}}
            >
              <span class="ms-row__lead">${I(de)}</span>
              <span class="ms-row__body">
                <strong>${r("v4_clean_rooms","One-time clean")}</strong>
                <small>${g??r("v4_clean_rooms_hint","Choose rooms for this run")}</small>
              </span>
              <span class="ms-row__trail">${I(Ce)}</span>
            </button>
            <button
              class="ms-row ms-row--card"
              type="button"
              aria-disabled=${l?"true":_}
              @click=${()=>{l||this.#f("plans")}}
            >
              <span class="ms-row__lead">${I(st)}</span>
              <span class="ms-row__body">
                <strong>${m?r("v4_plans_loading","Checking saved plans"):v?r("v4_plans_unavailable","Plans unavailable"):h?r("v4_run_a_plan","Run a plan"):r("v4_create_plan","Create a plan")}</strong>
                <small>${b??(m?r("v4_plans_loading_hint","Reading routines for this floor"):v?r("v4_plans_unavailable_hint","Try again to load saved routines"):h?h===1?r("v4_saved_routine","1 saved routine"):r("v4_saved_routines","{count} saved routines",{count:h}):r("v4_no_plans_hint","Save a room routine you can repeat"))}</small>
              </span>
              <span class="ms-row__trail">${I(Ce)}</span>
            </button>
          </div>
        `}
      <h3 class="shelf-heading">${r("v4_more","Map tools")}</h3>
      <div class="shelf">
        ${this.#X(r("v4_custom_areas","Clean a custom area"),zt,()=>this.#f("draw"),R,l)}
        ${o}

      </div>
      ${n?w`
        <h3 class="shelf-heading" id="map-display-heading">${r("v4_map_display","Map display")}</h3>
        <div class="map-display">
          <div class="ms-segment" role="group" aria-labelledby="map-display-heading">
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(e.appearance==="photo")}
              @click=${()=>this.#d({type:"set-appearance",appearance:"photo"})}
            >${r("map_style_photo","Photo")}</button>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(e.appearance==="rooms")}
              @click=${()=>this.#d({type:"set-appearance",appearance:"rooms"})}
            >${r("v4_room_colours","Floor plan")}</button>
          </div>
          <label class="ms-checkbox">
            <input type="checkbox" .checked=${e.labelsVisible} @change=${()=>this.#d({type:"toggle-labels"})}>
            ${r("v4_room_names","Room names")}
          </label>
          <button
            class="ms-btn ms-btn--secondary help-launcher"
            type="button"
            aria-haspopup="dialog"
            aria-expanded=${String(this._helpOpen)}
            @click=${this.#ae}
          >${r("v4_how_to_move","How to move the map")}</button>
        </div>
      `:_}
    `}#te(e,n){return e.workflow==="none"?this.#ee(e,n):customElements.get(le)?w`<${Ln}
      .state=${e}
      .localize=${this.localize}
      @matic-workspace-intent=${this.#le}
    ></${Ln}>`:(this.#ne(),this._workflowLoadFailed?w`<div class="workflow-loading" role="alert">
          <p>${this.#e("v4_workflow_load_failed","Workspace tools could not be loaded.")}</p>
          <button class="ms-btn ms-btn--secondary" @click=${this.#re}>
            ${this.#e("v4_retry","Try again")}
          </button>
        </div>`:w`<div class="workflow-loading" role="status" aria-live="polite">
        ${this.#e("v4_workflow_loading","Loading workspace tools\u2026")}
      </div>`)}#ne(){this.#p||customElements.get(le)||(this._workflowLoadFailed=!1,this.#p=import("./workflow-panel-BWKZTZN2.js").then(()=>{this.#p=null,this.requestUpdate()}).catch(()=>{this.#p=null,this._workflowLoadFailed=!0}))}#re;#k(e,n){let r=On(e,this.localize);return w`
      <div class="panel-heading">
        ${e.workflow!=="none"?w`
          <button
            class="panel-back ms-btn ms-btn--secondary"
            type="button"
            aria-label=${e.workflow==="plan"?this.#e("v4_back_to_plans","Back to plans"):this.#e("v4_back_to_all_tasks","Back to all tasks")}
            data-dialog-launcher="discardDraft"
            @click=${o=>this.#f(e.workflow==="plan"?"plans":"none",o.currentTarget)}
          >${I(Re)}<span class="ms-btn__label">${e.workflow==="plan"?this.#e("v4_your_plans","Your plans"):this.#e("v4_all_tasks","All tasks")}</span></button>
        `:_}
        <h2 tabindex="-1">${r.title}</h2>
      </div>
      <p class="panel-description">${r.description}</p>
      ${this.#te(e,n)}
    `}#R(e,n){let o=On(e,this.localize).title;return e.workflow==="rooms"&&e.selection.roomIds.length&&(o=`${this.#e("v4_rooms_selected","Rooms selected: {count}",{count:e.selection.roomIds.length})} \xB7 ${this.#J(e).join(", ")}`),this._sheetDetent!=="peek"?n.detail?`${n.title} \xB7 ${n.detail}`:n.title:n.notable?`${n.title} \xB7 ${o}`:o}#O(){let e=(n,r)=>this.#e(n,r);return w`
      <div class="dialog-backdrop" @click=${n=>{n.target===n.currentTarget&&(this._helpOpen=!1)}}>
        <section
          class="dialog help-dialog ms-surface ms-surface--overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-title"
          @keydown=${this.#B}
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
    `}render(){let e=this.state,n=e.narrowHint||this._measuredNarrow,r=gr(e,this.localize),o=be(e),i=Mt({...e,narrowHint:n}),a=At(e),l=!n&&i.id==="stop"?i:!n&&a?.id==="stop"?a:null,d=l&&l===i?null:i,c=e.workflow==="draw"&&e.dataMode==="live"?{id:"clear-draft",label:"Clear drawing",labelKey:"v4_clear_drawing",kind:"neutral",enabled:e.draw.circles.length>0||!!e.draw.outline?.points.length}:null,u=l&&l===a?null:a??c,h=e.fullMap&&(e.coherence==="verifying"||e.coherence==="booting"),m=e.fullMap||e.host.administrator&&e.host.robotCount>0&&e.map.available,v=e.cadenceResetRequest?e.resources.plans.value?.rooms.find(y=>y.roomId===e.cadenceResetRequest?.roomId):void 0,k=e.cadenceResetRequest?e.resources.plans.value?.plans.find(y=>y.id===e.cadenceResetRequest?.planId)?.rooms.find(y=>y.roomId===e.cadenceResetRequest?.roomId):void 0,g=Cr(e.dialog,this.localize,e.workflow==="plan",v?.name||e.cadenceResetRequest?.roomId||"room",k?.cadence?.scope==="shared",e.cadenceResetRequest?.mode),b=n&&!e.fullMap?`--map-sheet-offset:${this._sheetOffset}px`:"--map-sheet-offset:0px",R=n&&e.workflow==="draw",S=e.precisionOpen&&e.workflow==="draw";return w`
      <div class=${`root ${n?"narrow":"wide"}`} @keydown=${this.#K}>
        <button class="skip-link ms-btn ms-btn--primary" type="button" @click=${this.#U}>${this.#e("v4_skip_to_map","Skip to the map")}</button>
        <button class="skip-link ms-btn ms-btn--primary" type="button" @click=${this.#pe}>${this.#e("v4_skip_to_workspace","Skip to the map workspace")}</button>
        <div class="app" ?inert=${!!g||this._helpOpen}>
          <header class="app-bar">
            ${e.precisionOpen?_:w`
              <button
                class="nav nav--menu ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#e("v4_open_navigation","Open Home Assistant sidebar")}
                title=${this.#e("v4_open_navigation","Open Home Assistant sidebar")}
                @click=${this.#Y}
              >${I(Ot)}</button>
            `}

            ${e.precisionOpen?w`
              <button
                class="nav ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#e("v4_back","Back")}
                @click=${()=>this.#d({type:"dismiss-top-layer"})}
              >${I(Re)}</button>
            `:_}
            <h1 class="title">${this.#e("map_studio_title","Matic Map")}</h1>
            ${e.robots.length>1||o?w`
              <select
                class="ms-select context-switcher robot-switcher"
                name="matic-robot"
                aria-label=${this.#e("v4_choose_robot","Choose robot")}
                .value=${e.selection.entryId||""}
                @change=${y=>this.#d({type:"select-entry",entryId:y.currentTarget.value})}
              >${o?w`
                <option value=${e.selection.entryId||""} selected disabled>${this.#e("v4_selected_robot_unavailable","Selected robot unavailable")}</option>
              `:_}${e.robots.map(y=>w`
                <option value=${y.entryId} ?selected=${y.entryId===e.selection.entryId}>${y.label}</option>
              `)}</select>
            `:_}

            <span class="spacer"></span>
            ${m?w`
              <button
                class="workspace-toggle ms-btn ms-btn--icon"
                type="button"
                aria-label=${e.fullMap?this.#e("v4_show_workspace","Show cleaning panel"):this.#e("v4_hide_workspace","Hide cleaning panel")}
                aria-controls="map-workspace"
                aria-expanded=${String(!e.fullMap)}
                title=${e.fullMap?this.#e("v4_show_workspace","Show cleaning panel"):this.#e("v4_hide_workspace","Hide cleaning panel")}
                @click=${this.#q}
              >${I(Dt)}</button>
            `:_}
            <div class="overflow-wrap">
              <button
                class="overflow ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#e("v4_map_options","Map options")}
                aria-expanded=${String(this._overflowOpen)}
                aria-controls="map-options"
                @click=${()=>{this._overflowOpen=!this._overflowOpen}}
              >${I(Lt)}</button>
              ${this._overflowOpen?w`
                <div id="map-options" class="overflow-menu ms-surface ms-surface--overlay">
                  <label class="overflow-field ms-field">${this.#e("map_quality_label","Scene detail")}
                    <select
                      aria-label=${this.#e("map_quality_label","Scene detail")}
                      .value=${e.quality}
                      @change=${y=>this.#d({type:"set-quality",quality:y.currentTarget.value})}
                    >
                      <option value="auto">${this.#e("map_quality_auto","Auto detail")}</option>
                      <option value="efficient">${this.#e("map_quality_efficient","Efficient")}</option>
                      <option value="balanced">${this.#e("map_quality_balanced","Balanced")}</option>
                      <option value="maximum">${this.#e("map_quality_maximum","Maximum")}</option>
                    </select>
                  </label>
                  <button class="ms-row ms-row--menu" type="button" @click=${()=>this.#F("support")}>${this.#e("v4_map_diagnostics","Map diagnostics")}</button>
                  <button class="ms-row ms-row--menu" type="button" @click=${()=>this.#F("fullscreen")}>${this._browserFullscreen?this.#e("v4_leave_full_screen","Leave full screen"):this.#e("v4_full_screen","Full screen")}</button>
                </div>
              `:_}
            </div>
          </header>

          <main class=${`workspace ${e.fullMap?"full-map":""}`} style=${b}>
            <div class="canvas">
              <${$n}
                class="map-canvas"
                style=${b}
                .state=${e}
                .localize=${this.localize}
                .narrow=${n}
              >${this.#Z(e)}
                ${n&&!e.fullMap&&this._sheetDetent==="full"?w`
                  <button
                    class="sheet-scrim"
                    slot="scrim"
                    data-map-control
                    type="button"
                    aria-label=${this.#e("v4_collapse_sheet","Collapse the map workspace")}
                    @click=${()=>this.#v("peek")}
                  ></button>
                `:_}
              </${$n}>
              ${!n&&S?w`
                <div class="precision-popover">
                  <${Be} compact .state=${e} .localize=${this.localize}></${Be}>
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
              ${n?w`
                <div
                  class="sheet-grip"
                  @pointerdown=${this.#g}
                  @pointermove=${this.#I}
                  @pointerup=${this.#H}
                  @pointercancel=${this.#H}
                >
                  <span class="sheet-handle" role="presentation"></span>
                  ${e.workflow!=="none"&&this._sheetDetent==="peek"?w`
                    <button
                      class="sheet-back ms-btn ms-btn--icon ms-btn--sm"
                      type="button"
                      aria-label=${e.workflow==="plan"?this.#e("v4_back_to_plans","Back to plans"):this.#e("v4_back_to_all_tasks","Back to all tasks")}
                      title=${e.workflow==="plan"?this.#e("v4_back_to_plans","Back to plans"):this.#e("v4_back_to_all_tasks","Back to all tasks")}
                      data-dialog-launcher="discardDraft"
                      @click=${y=>this.#f(e.workflow==="plan"?"plans":"none",y.currentTarget)}
                    >${I(Re)}</button>
                  `:_}
                  <span class="sheet-status">${this.#R(e,r)}</span>
                  <button
                    class="ms-btn ms-btn--icon ms-btn--sm"
                    type="button"
                    aria-label=${this.#e("v4_show_more","Show more of the map workspace")}
                    aria-controls="sheet-body"
                    aria-disabled=${this._sheetDetent==="full"?"true":_}
                    @click=${()=>this.#A(1)}
                  >${I(qt)}</button>
                  <button
                    class="ms-btn ms-btn--icon ms-btn--sm"
                    type="button"
                    aria-label=${this.#e("v4_show_less","Show less of the map workspace")}
                    aria-controls="sheet-body"
                    aria-disabled=${this._sheetDetent==="peek"?"true":_}
                    @click=${()=>this.#A(-1)}
                  >${I(Nt)}</button>
                </div>
                ${R?w`
                  <div class="sheet-tools">
                    ${Ft(e,{intent:y=>this.#d(y),openBrush:()=>this.#he(),t:(y,C)=>this.#e(y,C)},"grid")}
                    ${S?w`
                      <div class="precision-popover">
                        <${Be} compact inline .state=${e} .localize=${this.localize}></${Be}>
                      </div>
                    `:_}
                  </div>
                `:_}
                <div
                  class="sheet-body"
                  id="sheet-body"
                  @pointerdown=${this.#j}
                  @pointermove=${this.#G}
                  @pointerup=${this.#Q}
                  @pointercancel=${this.#Q}
                >
                  ${this.#k(e,n)}
                </div>
                ${this.#N(e,d,u)}
              `:w`
                <div class="status-strip">
                  <span class="status-icon" aria-hidden="true">${I(r.icon)}</span>
                  <span class="status-copy"><strong>${r.title}</strong><small>${r.detail}</small></span>
                  ${l?this.#V(l,"status-action ms-btn ms-btn--secondary","status-reason"):_}
                </div>
                <section class="workflow">
                  <div class="workflow-body">${this.#k(e,n)}</div>
                  ${this.#N(e,d,u)}
                </section>
              `}
            </aside>

            ${e.fullMap?w`
              <section
                class=${`full-map-hud ms-surface ms-surface--floating ${a?"has-secondary":""} ${!n&&(e.workflow==="draw"||e.workflow==="rooms"&&e.selection.roomIds.length>0)?"above-dock":""}`}
                aria-label="Robot status and action"
              >
                <span class="hud-copy"><strong>${r.title}</strong><small>${r.detail}</small></span>
                ${h&&i.id!=="stop"?_:this.#V(i,"ms-btn ms-btn--lg ms-btn--primary","hud-reason")}
                ${a&&(!h||a.id==="stop")?this.#V(a,"ms-btn ms-btn--lg ms-btn--secondary","hud-secondary-reason"):_}
              </section>
            `:_}
          </main>
        </div>

        <div class="sr-only" aria-live="polite" aria-atomic="true">${[this._announcement,e.notice?.text??""].filter(Boolean).join(" ")}</div>

        ${this._helpOpen?this.#O():_}

        ${g?w`
          <div class="dialog-backdrop">
            <section
              class="dialog ms-surface ms-surface--overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="dialog-title"
              aria-describedby="dialog-detail"
              @keydown=${this.#B}
            >
              <h2 id="dialog-title">${g.title}</h2>
              <p id="dialog-detail">${g.detail}</p>
              <div class="dialog-actions">
                <button
                  class="ms-btn ms-btn--secondary"
                  type="button"
                  data-dialog-initial-focus
                  @click=${e.dialog==="discardDraft"?this.#h:this.#L}
                >${g.cancelLabel}</button>
                ${g.action===null?_:w`
                  <button
                    class="discard ms-btn ms-btn--primary ms-btn--danger"
                    type="button"
                    @click=${()=>this.#W(g)}
                  >${g.confirmLabel}</button>
                `}
              </div>
            </section>
          </div>
        `:_}
      </div>
    `}};customElements.get(ce)||customElements.define(ce,bt);var Nn=J(ce),wt=class extends X{constructor(){super(...arguments);this.narrow=!1;this._workspace=q();this.#e=new xe;this.#t=new Ct(this._workspace);this.#r=null;this.#o=null;this.#s=null;this.#l=null;this.#a=null}static{this.styles=[G,Q,Y`
:host { display: block; block-size: 100%; }
`]}static{this.properties={hass:{attribute:!1},narrow:{type:Boolean},route:{attribute:!1},panel:{attribute:!1},_workspace:{state:!0}}}#e;#t;#r;#o;#s;#l;#a;#n(e=this.hass,n=this.panel){let r=this.#t.value.selection;return r.entrySource==="user"?this.#e.project(e,n,r.entryId):this.#e.project(e,n)}shouldUpdate(e){if(!e.has("hass")||[...e.keys()].some(r=>r!=="hass"))return!0;let n=e.get("hass");return n?.connection!==this.hass?.connection||n?.localize!==this.hass?.localize?!0:this.#n()!==this.#r}connectedCallback(){super.connectedCallback(),this.#o=this.#t.subscribe(e=>{if(this._workspace=e,e.selection.entryId!==this.#r?.entryKey){let n=this.#n();n!==this.#r&&(this.#r=n,this.#l?.sync(n))}}),this.#p()}disconnectedCallback(){this.#o?.(),this.#o=null,this.#m(),super.disconnectedCallback()}#p(){if(!(!this.isConnected||this.#l)&&(this.#r=this.#n(),this.#s=new Le(()=>this.hass),this.#l=new Fe(this.#t,this.#s,this.hass?.connection??null),this.#a=new Ke(this.#t),this.#a.start(),this.#r)){this.#l.sync(this.#r);let{host:e}=this.#r;e.connected&&e.administrator&&e.robotCount>0&&this.#l.refreshCatalog(this.#t.value.selection.floorId==="current")}}#m(){this.#a?.dispose(),this.#a=null,this.#l?.dispose(),this.#l=null,this.#s=null}willUpdate(e){if(e.has("hass")||e.has("panel")){let n=e.get("hass"),r=e.has("hass")&&n?.connection!==this.hass?.connection,o=this.#n(),i=o!==this.#r;i&&(this.#r=o),r?(this.#m(),this.#p()):(i||e.has("panel"))&&this.#l?.sync(o)}e.has("narrow")&&this.#t.value.narrowHint!==this.narrow&&this.#t.dispatch({type:"set-narrow-hint",value:this.narrow})}#u(e){if(!ge(e.detail))return;e.stopPropagation();let n=e.detail;if(n.type==="dismiss-top-layer"||n.type==="exit-full-map"){this.#a?.dismissTop()||this.#t.dispatch(n);return}if(n.type==="open-workflow"&&n.workflow!=="none"){this.#l?.openWorkflow(n.workflow);return}if(n.type==="set-floor"){this.#l?.selectFloor(n.floorId);return}if(n.type==="select-entry"){if(!this._workspace.robots.some(r=>r.entryId===n.entryId)||this.#e.project(this.hass,this.panel,n.entryId).entryKey!==n.entryId)return;this.#t.dispatch(n);return}if(n.type==="set-history"){this.#l?.selectHistory(n.historyId);return}if(n.type==="select-plan"){this.#l?.selectPlan(n.planId);return}if(n.type==="select-area"){this.#l?.selectArea(n.areaId),n.workflow==="areaReview"&&this.#l?.openWorkflow("areaReview");return}this.#t.dispatch(n)}#E(e){e.stopPropagation(),typeof e.detail?.id=="string"&&(e.detail.id==="reset-room-cadence"&&"planId"in e.detail&&"roomId"in e.detail&&"mode"in e.detail?this.#l?.executeAction(e.detail):this.#l?.executeAction(e.detail.id),this.dispatchEvent(new CustomEvent("matic-map-v4-action-requested",{detail:{id:e.detail.id},bubbles:!0,composed:!0})))}getWorkspaceSnapshot(){return this.#t.value}render(){return w`
      <${Nn}
        .state=${this._workspace}
        .localize=${this.hass?.localize}
        @matic-workspace-intent=${this.#u}
        @matic-workspace-action=${this.#E}
      ></${Nn}>
    `}};customElements.get(rt)||customElements.define(rt,wt);export{xe as a,J as b,w as c,wt as d};
/*! Bundled license information:

lit-html/static.js:
  (**
   * @license
   * Copyright 2020 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/
