import{a as we,b as ae,c as le,d as ce,e as Ze,f as At,g as zt,h as Wt,i as Ht,j as ue,k as Ft}from"./chunk-4RNU25SG.js";import{A as xt,B as Ct,C as Pt,G as j,H as be,I as Et,J as Mt,L as _,N as Y,O as X,P as G,Q as _e,R as de,S as ke,T as It,U as Tt,V as $t,W as Se,X as Lt,Y as Ot,c as se,d as je,e as Ye,f as Xe,h as ye,i as V,l as D,m as _t,n as Ge,o as Qe,oa as Dt,pa as et,q as kt,qa as tt,r as St,ra as qt,sa as nt,ta as rt,u as ie,ua as Nt,va as Q,wa as A,x as Je,xa as U,y as ge,z as Rt}from"./chunk-EOKDEAMO.js";var Dn=(s,t)=>{if(t?.recharge_and_resume===!0&&t?.charging===!0)return"recharging";switch(s){case"cleaning":return"cleaning";case"paused":return"paused";case"returning":return"returning";case"docked":return"docked";case"idle":return"idle";case"error":return"problem";default:return"unknown"}},qn=s=>typeof s!="number"||!Number.isFinite(s)?null:Math.round(Math.max(0,Math.min(100,s))),Nn=s=>{let t=s.attributes?.matic_entry_id;return typeof t=="string"&&t.length>0?t:null},zn=s=>String(s||"local-user").replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",Kt=s=>{if(typeof s!="string")return"Matic robot";let t=s.trim();return t&&Array.from(t).length<=128&&!/[\u0000-\u001f\u007f]/u.test(t)?t:"Matic robot"},Re=class{#e="";#t=null;project(t,e,n=null){let r=t?.states??{},o=e?.config?.entry_id,i=typeof o=="string"?o:null,a=null,c=null,l=null,d=new Map;for(let[y,S]of Object.entries(r)){let C=Nn(S);if(!C||!y.startsWith("vacuum."))continue;d.set(C,{entryId:C,label:Kt(S.attributes?.friendly_name)});let O=n||i;(!a||O&&C===O)&&(a=S,c=y,l=C)}let u={connected:t?.connected!==!1,administrator:t?.user?.is_admin===!0,robotConnected:a!==null&&a.state!=="unavailable"&&a.state!=="unknown",robotCount:d.size},h=a?Dn(a.state,a.attributes):"unknown",m=qn(a?.attributes?.battery_level),v=t?.selectedLanguage||t?.language||"en",g=zn(t?.user?.id),k=Kt(a?.attributes?.friendly_name),b=[...d.values()].sort((y,S)=>y.label.localeCompare(S.label,v,{sensitivity:"base"})),R=[u.connected,u.administrator,u.robotConnected,u.robotCount,h,m??"none",v,g,c??"none",l??"none",k,b.map(y=>`${y.entryId}:${y.label}`).join(",")].join("|");return R===this.#e&&this.#t?this.#t:(this.#e=R,this.#t={host:u,activity:h,batteryPercent:m,language:v,userKey:g,vacuumEntityId:c,entryKey:l,robotLabel:k,robots:b},this.#t)}};var Ut=Symbol.for(""),Wn=s=>{if(s?.r===Ut)return s?._$litStatic$},J=s=>({_$litStatic$:s,r:Ut});var Bt=new Map,ot=s=>(t,...e)=>{let n=e.length,r,o,i=[],a=[],c,l=0,d=!1;for(;l<n;){for(c=t[l];l<n&&(o=e[l],(r=Wn(o))!==void 0);)c+=r+t[++l],d=!0;l!==n&&a.push(o),i.push(c),l++}if(l===n&&i.push(t[n]),d){let u=i.join("$$lit$$");(t=Bt.get(u))===void 0&&(i.raw=i,Bt.set(u,t=i)),e=a}return s(t,...e)},w=ot(be),Sr=ot(Et),Rr=ot(Mt);var Vt="/api/matic_robot/slam_entries",Pe=24,jt=8,it=15e5,Yt=16*1024*1024,f=class extends Error{constructor(t){super(t),this.name="ContractError",this.code=t}},E=(s,t)=>{if(!s||typeof s!="object"||Array.isArray(s))throw new f(t);return s},x=(s,t,e)=>{if(typeof s!="string")throw new f(e);let n=s.trim();if(!n||Array.from(n).length>t||/[\u0000-\u001f\u007f]/u.test(n))throw new f(e);return n},Hn=s=>{if(s==null||s==="")return null;try{return x(s,128,"invalid-floor-label")}catch{return null}},Z=(s,t,e,n)=>{if(typeof s!="number"||!Number.isFinite(s)||s<t||s>e)throw new f(n);return s},I=(s,t,e,n)=>{let r=Z(s,t,e,n);if(!Number.isInteger(r))throw new f(n);return r},st=(s,t)=>s==null?null:I(s,1,t,"invalid-floor-ordinal"),P=(s,t)=>{if(typeof s!="boolean")throw new f(t);return s},xe=(s,t)=>s===void 0?!1:P(s,t),Fn=(s,t)=>s===null?null:P(s,t),Xt=s=>{if(s==null)return null;let t=x(s,64,"invalid-map-session-key");if(!/^[0-9a-f]{64}$/u.test(t))throw new f("invalid-map-session-key");return t},Kn=s=>{if(s==null)return null;if(s==="bootstrap_empty"||s==="map_session_unverified"||s==="floor_plan_unavailable"||s==="floor_plan_mismatch")return s;throw new f("invalid-map-block-reason")},Bn=s=>{if(s===void 0)return"not_started";if(s==="not_started"||s==="running"||s==="complete"||s==="partial"||s==="failed")return s;throw new f("invalid-bootstrap-state")},z=(s,t)=>{let e=x(s,512,t);if(!e.startsWith("/")||e.startsWith("//")||e.includes("\\"))throw new f(t);return e},Un=s=>{let t=typeof s.map_health=="string"?s.map_health.toLowerCase():"",e=typeof s.stream_state=="string"?s.stream_state.toLowerCase():"",n=typeof s.invalid_tiles=="number"?s.invalid_tiles:0;return t.includes("error")||t.includes("fail")||t.includes("degrad")||n>0?"problem":s.map_truncated===!0||t.includes("truncat")||t.includes("limit")?"limited":s.map_complete===!0?"ready":e.includes("connect")||e.includes("collect")||e.includes("run")?"building":"unknown"},Ee=s=>{let t=E(s,"invalid-catalog");if(!Array.isArray(t.entries)||t.entries.length>64)throw new f("invalid-catalog-entries");return t.entries.map(e=>{let n=E(e,"invalid-catalog-entry"),r=I(n.map_revision,0,Number.MAX_SAFE_INTEGER,"invalid-map-revision");return{entryId:x(n.entry_id,128,"invalid-entry-id"),sceneUrl:z(n.scene_url,"invalid-scene-url"),deltaUrl:n.delta_url===void 0||n.delta_url===null?null:z(n.delta_url,"invalid-delta-url"),poseUrl:z(n.pose_url,"invalid-pose-url"),historyUrl:z(n.history_url,"invalid-history-url"),areasUrl:z(n.areas_url,"invalid-areas-url"),plansUrl:z(n.plans_url,"invalid-plans-url"),mapRevision:r,mapFloorCoherent:P(n.map_floor_coherent,"invalid-floor-coherence"),mapSessionVerified:P(n.map_session_verified,"invalid-session-state"),mapSessionKey:Xt(n.map_session_key),mapBlockReason:Kn(n.map_block_reason),runnerLocked:P(n.runner_locked,"invalid-runner-lock"),stopSettlePending:P(n.stop_settle_pending,"invalid-stop-settle"),activePlan:P(n.active_plan,"invalid-active-plan"),nativeReconciliationPending:P(n.native_reconciliation_pending,"invalid-native-reconciliation"),nativeSessionActive:Fn(n.native_session_active,"invalid-native-session"),mapComplete:P(n.map_complete,"invalid-map-complete"),mapTruncated:P(n.map_truncated,"invalid-map-truncated"),selectedFloorOrdinal:st(n.selected_floor_ordinal,128),mapFloorOrdinal:st(n.map_floor_ordinal,128),historyCount:I(n.history_count,0,12,"invalid-history-count"),historyFloorCount:I(n.history_floor_count,0,128,"invalid-floor-count"),health:Un(n),streamFailures:I(n.stream_failures,0,Number.MAX_SAFE_INTEGER,"invalid-stream-failures"),bootstrapState:Bn(n.bootstrap_state),bootstrapPhotoSeen:n.bootstrap_photo_seen===void 0?!1:P(n.bootstrap_photo_seen,"invalid-bootstrap-photo"),bootstrapStructureSeen:n.bootstrap_structure_seen===void 0?!1:P(n.bootstrap_structure_seen,"invalid-bootstrap-structure"),bootstrapFailures:n.bootstrap_failures===void 0?0:I(n.bootstrap_failures,0,2,"invalid-bootstrap-failures")}})},Gt=(s,t)=>{if(!Array.isArray(s)||s.length!==2)throw new f(t);return[Z(s[0],-1e6,1e6,t),Z(s[1],-1e6,1e6,t)]},Vn=(s,t)=>{if(!Array.isArray(s)||s.length<3||s.length>8192)throw new f(t);return s.map(e=>Gt(e,t))},Qt=(s,t)=>{if(!Array.isArray(s)||s.length>256)throw new f("invalid-rooms");return s.map(e=>{let n=E(e,"invalid-room");return{roomId:x(n.room_id,128,"invalid-room-id"),name:x(n.name,128,"invalid-room-name"),boundary:t?Vn(n.boundary,"invalid-room-boundary"):[]}})},jn=s=>{let t=E(s,"invalid-history-snapshot"),e=x(t.created_at,64,"invalid-history-time");if(!Number.isFinite(Date.parse(e)))throw new f("invalid-history-time");return{id:x(t.id,128,"invalid-history-id"),createdAt:e,revision:I(t.revision,0,Number.MAX_SAFE_INTEGER,"invalid-history-revision"),pointCount:I(t.point_count,1,it,"invalid-history-points"),sceneUrl:z(t.scene_url,"invalid-history-scene-url")}},Jt=s=>{let t=E(s,"invalid-history");if(!Array.isArray(t.floors)||t.floors.length<1||t.floors.length>128)throw new f("invalid-history-floors");return{entryId:x(t.entry_id,128,"invalid-history-entry"),liveAvailable:P(t.live_available,"invalid-history-live"),floors:t.floors.map(e=>{let n=E(e,"invalid-history-floor");if(!Array.isArray(n.snapshots)||n.snapshots.length>12)throw new f("invalid-history-snapshots");return{id:x(n.id,128,"invalid-history-floor-id"),active:P(n.active,"invalid-history-floor-active"),readOnly:P(n.read_only,"invalid-history-floor-read-only"),liveAvailable:n.live_available===void 0?!1:P(n.live_available,"invalid-history-floor-live"),label:Hn(n.label),ordinal:n.ordinal===void 0?null:st(n.ordinal,128),snapshots:n.snapshots.map(jn)}})}},Me=s=>{if(s==="vacuum"||s==="mop"||s==="vacuum_and_mop")return s;throw new f("invalid-cleaning-mode")},he=s=>{if(s==="quick"||s==="standard"||s==="heavy_duty")return s;throw new f("invalid-coverage-setting")},Ce=(s,t)=>s==null?null:I(s,1,100,t),Ae=s=>{if(s==null)return[];let t=["mop_due","coverage_due","room_not_on_current_map","identity_changed","shared_schedule_unavailable","mop_progress_unverified","coverage_progress_unverified","invalid_cadence_policy"];if(!Array.isArray(s)||s.length>t.length||s.some(e=>!t.includes(e)))throw new f("invalid-cadence-reasons");return[...new Set(s)]},Zt=s=>{if(s==null)return;let t=E(s,"invalid-room-cadence"),e=t.scope===void 0?"plan":t.scope;if(e!=="plan"&&e!=="shared")throw new f("invalid-room-cadence-scope");let n=t.periodic_coverage_setting;return{scope:e,mopEveryN:Ce(t.mop_every_n,"invalid-mop-interval"),coverageEveryN:Ce(t.coverage_every_n,"invalid-coverage-interval"),periodicCoverageSetting:n==null?null:he(n),doMopNext:xe(t.do_mop_next,"invalid-do-mop-next"),doCoverageNext:xe(t.do_coverage_next,"invalid-do-coverage-next")}},at=(s,t)=>{if(s==null)return;let e=E(s,"invalid-room-cadence-progress"),n=e.effective_cleaning_mode,r=e.effective_coverage_setting,o=Ae(t??e.cadence_reasons);return{mopProgress:I(e.mop_progress??0,0,100,"invalid-mop-progress"),coverageProgress:I(e.coverage_progress??0,0,100,"invalid-coverage-progress"),mopDue:xe(e.mop_due,"invalid-mop-due"),coverageDue:xe(e.coverage_due,"invalid-coverage-due"),nextMopIn:Ce(e.next_mop_in,"invalid-next-mop"),nextCoverageIn:Ce(e.next_coverage_in,"invalid-next-coverage"),reasons:o,...n===void 0?{}:{effectiveCleaningMode:Me(n)},...r===void 0?{}:{effectiveCoverageSetting:he(r)}}},Yn=s=>{let t=E(s,"invalid-plan-room"),e=Zt(t.cadence),n=at(t.cadence_progress,t.cadence_reasons),r=Ae(t.cadence_reasons);return{roomId:x(t.room_id,128,"invalid-plan-room-id"),cleaningMode:Me(t.cleaning_mode),coverageSetting:he(t.coverage_setting),...e===void 0?{}:{cadence:e},...n===void 0?{}:{cadenceProgress:n},...r.length?{cadenceReasons:r}:{}}},en=s=>{if(s==null)return;let t=E(s,"invalid-plan-preview");if(!Array.isArray(t.rooms)||t.rooms.length>100||!Array.isArray(t.mission_boundaries)||t.mission_boundaries.length>99)throw new f("invalid-plan-preview");let e=t.rooms.map(a=>{let c=E(a,"invalid-plan-preview-room");return{roomId:x(c.room_id,128,"invalid-plan-preview-room-id"),name:x(c.name,128,"invalid-plan-preview-room-name"),cleaningMode:Me(c.cleaning_mode),coverageSetting:he(c.coverage_setting),cadenceReasons:Ae(c.cadence_reasons)}}),n=t.mission_boundaries.map(a=>I(a,1,Math.max(1,e.length-1),"invalid-plan-preview-boundary"));if(n.some((a,c)=>a>=e.length||a<=(n[c-1]??0)))throw new f("invalid-plan-preview-boundary-order");let r=["cadence_identity_unavailable","preview_unavailable","plan_disabled","plan_has_no_rooms","plan_room_limit","cadence_identity_changed","shared_schedule_unavailable","cadence_progress_unverified","invalid_cadence_policy","invalid_plan"],o=t.blocker;if(o!==null&&!r.includes(o))throw new f("invalid-plan-preview-blocker");if(o===null&&e.length===0)throw new f("empty-plan-preview");let i=t.preview_token;if(i!==void 0&&(typeof i!="string"||!/^[0-9a-f]{64}$/u.test(i)))throw new f("invalid-plan-preview-token");return{rooms:e,missionBoundaries:n,blocker:o,...typeof i=="string"?{previewToken:i}:{}}},tn=s=>{let t=E(s,"invalid-room-sequence-preview"),e=x(t.entry_id,128,"invalid-room-sequence-preview-entry"),n=x(t.floor_token,128,"invalid-room-sequence-preview-floor"),r=x(t.preview_token,64,"invalid-room-sequence-preview-token");if(!/^[0-9a-f]{64}$/u.test(n)||!/^[0-9a-f]{64}$/u.test(r))throw new f("invalid-room-sequence-preview-token");let o=en({rooms:t.rooms,mission_boundaries:t.mission_boundaries,blocker:t.blocker});if(!o)throw new f("invalid-room-sequence-preview");let i=t.rooms;if(!Array.isArray(i))throw new f("invalid-room-sequence-preview-rooms");let a=o.rooms.map((c,l)=>{let d=E(i[l],"invalid-room-sequence-preview-room"),u=at(d.cadence_progress,d.cadence_reasons);return{...c,...u===void 0?{}:{cadenceProgress:u}}});return{entryId:e,floorToken:n,previewToken:r,rooms:a,missionBoundaries:o.missionBoundaries,blocker:o.blocker}},Xn=s=>{if(s==null)return null;if(!Array.isArray(s)||s.length<3||s.length>64)throw new f("invalid-area-outline");let t={closed:!0,points:s.map(e=>{let n=E(e,"invalid-area-outline");if(typeof n.x!="number"||typeof n.y!="number")throw new f("invalid-area-outline");return{x:n.x,y:n.y}})};if(!At(t))throw new f("invalid-area-outline");return t},Gn=s=>{let t=E(s,"invalid-area-circle");return{x:Z(t.x,-1e6,1e6,"invalid-area-circle"),y:Z(t.y,-1e6,1e6,"invalid-area-circle"),radius:Z(t.radius,.05,2.5,"invalid-area-circle")}},Qn=s=>s==="current"||s==="review"||s==="stale"?s:"unknown",nn=s=>{let t=E(s,"invalid-areas");if(!Array.isArray(t.areas)||t.areas.length>256)throw new f("invalid-area-list");return{sceneUrl:z(t.scene_url,"invalid-area-scene-url"),rooms:Qt(t.rooms,!0),areas:t.areas.map(e=>{let n=E(e,"invalid-area");if(!Array.isArray(n.circles)||n.circles.length>512)throw new f("invalid-area-circles");return{id:x(n.id,128,"invalid-area-id"),name:x(n.name,128,"invalid-area-name"),circles:n.circles.map(Gn),outline:Xn(n.outline),cleaningMode:Me(n.cleaning_mode),coverageSetting:he(n.coverage_setting),status:Qn(n.status),canRebind:P(n.can_rebind,"invalid-area-rebind")}})}},rn=s=>{let t=E(s,"invalid-plans");if(!Array.isArray(t.plans)||t.plans.length>256)throw new f("invalid-plan-list");let e=t.rooms;return{rooms:Qt(e,!1).map((r,o)=>{let i=Array.isArray(e)?e[o]:void 0,a=E(i,"invalid-room"),c=Zt(a.shared_cadence),l=at(a.shared_cadence_progress,a.shared_cadence_reasons),d=Ae(a.shared_cadence_reasons);return{roomId:r.roomId,name:r.name,...c===void 0?{}:{sharedCadence:c},...l===void 0?{}:{sharedCadenceProgress:l},...d.length?{sharedCadenceReasons:d}:{}}}),selectedPlan:t.selected_plan===null||t.selected_plan===void 0?null:x(t.selected_plan,128,"invalid-selected-plan"),plans:t.plans.map(r=>{let o=E(r,"invalid-plan");if(!Array.isArray(o.rooms)||o.rooms.length>256||!Array.isArray(o.room_order))throw new f("invalid-plan-rooms");let i=o.run_behavior;if(i!=="intelligent"&&i!=="ordered")throw new f("invalid-run-behavior");let a=en(o.next_run_preview);return{id:x(o.id,128,"invalid-plan-id"),name:x(o.name,128,"invalid-plan-name"),enabled:P(o.enabled,"invalid-plan-enabled"),runBehavior:i,rooms:o.rooms.map(c=>Yn(c)),roomOrder:o.room_order.slice(0,256).map(c=>x(c,128,"invalid-room-order")),returnToBase:P(o.return_to_base,"invalid-return-to-base"),finishCurrentRoom:P(o.finish_current_room,"invalid-finish-room"),finishCurrentRoomThreshold:I(o.finish_current_room_threshold,0,100,"invalid-finish-threshold"),...a===void 0?{}:{nextRunPreview:a}}})}},on=s=>{let t=E(s,"invalid-pose"),e=t.position,n=e===null?null:Gt(e,"invalid-pose-position"),r=t.pose_freshness;if(r!=="live"&&r!=="coordinator_fallback")throw new f("invalid-pose-freshness");return{position:n,source:x(t.source,64,"invalid-pose-source"),revision:I(t.revision,0,Number.MAX_SAFE_INTEGER,"invalid-pose-revision"),poseRevision:I(t.pose_revision,0,Number.MAX_SAFE_INTEGER,"invalid-pose-sequence"),floorCoherent:P(t.map_floor_coherent,"invalid-pose-floor"),mapSessionKey:Xt(t.map_session_key),freshness:r}},sn=s=>{try{return z(s,"invalid-private-path"),!0}catch{return!1}};var an=s=>{let o=()=>{throw new Error("invalid-scene")};(!(s instanceof ArrayBuffer)||s.byteLength<24||s.byteLength>16777216)&&o();let i=new DataView(s),a=new Uint8Array(s,0,8),c=String.fromCharCode(...a),l=i.getUint16(8,!0),d=i.getUint16(10,!0),u=i.getUint32(12,!0),h=i.getUint32(16,!0),m=i.getUint32(20,!0),v=h+m,g=24+u;(c!=="MATIC3D\0"||l!==1||d!==8||u>1024*1024||v<1||v>15e5||g+v*d!==s.byteLength)&&o();let k;try{k=JSON.parse(new TextDecoder("utf-8",{fatal:!0}).decode(new Uint8Array(s,24,u)))}catch{o()}(!k||typeof k!="object"||Array.isArray(k))&&o();let b=k,R=b.meters_per_cell,y=b.origin_cells,S=b.span_cells;(typeof R!="number"||!Number.isFinite(R)||R<.001||R>.1||!Array.isArray(y)||y.length!==2||!y.every($=>typeof $=="number"&&Number.isFinite($))||!Array.isArray(S)||S.length!==2||!S.every($=>typeof $=="number"&&Number.isFinite($)&&$>=1&&$<=65536))&&o();let O=(Array.isArray(b.rooms)?b.rooms.slice(0,128):[]).flatMap(($,On)=>{if(!$||typeof $!="object"||Array.isArray($))return[];let B=$,ve=typeof B.name=="string"?B.name.trim():"";if(!ve||Array.from(ve).length>128||/[\u0000-\u001f\u007f]/u.test(ve))return[];if(!Array.isArray(B.boundary)||B.boundary.length<3||B.boundary.length>8192)return[];let wt=B.boundary.flatMap(Be=>{if(!Array.isArray(Be)||Be.length!==2)return[];let[Ue,Ve]=Be;return typeof Ue=="number"&&Number.isFinite(Ue)&&typeof Ve=="number"&&Number.isFinite(Ve)?[[Ue,Ve]]:[]}),He=B.center;if(wt.length<3||!Array.isArray(He)||He.length!==2)return[];let[Fe,Ke]=He;return typeof Fe!="number"||!Number.isFinite(Fe)||typeof Ke!="number"||!Number.isFinite(Ke)?[]:[{id:`scene-room-${On+1}`,name:ve,boundary:wt,center:[Fe,Ke]}]}),Ln=typeof b.sample_step=="number"&&Number.isInteger(b.sample_step)?Math.max(1,Math.min(15e5,b.sample_step)):1,gt=y,bt=S;return{buffer:s,pointOffset:g,floorCount:h,surfaceCount:m,total:v,metadata:{metersPerCell:R,origin:[gt[0],gt[1]],span:[bt[0],bt[1]],sampleStep:Ln,rooms:O}}},Jn=s=>{if(s.byteLength>Yt||s.byteLength<Pe||jt!==8||it!==15e5)throw new f("invalid-scene");try{return an(s)}catch{throw new f("invalid-scene")}},Zn=()=>`
  const parseTransfer = ${an.toString()};
  self.onmessage = (event) => {
    const { id, buffer } = event.data;
    try {
      const parsed = parseTransfer(buffer);
      self.postMessage({ id, ok: true, parsed }, [parsed.buffer]);
    } catch (_) {
      self.postMessage({ id, ok: false, problem: "invalid-scene" });
    }
  };
`,Ie=class{#e=null;#t=null;#n=0;#a=new Map;constructor(){if(!(typeof Worker!="function"||typeof URL?.createObjectURL!="function"))try{this.#t=URL.createObjectURL(new Blob([Zn()],{type:"text/javascript"})),this.#e=new Worker(this.#t),this.#e.onmessage=t=>{let e=this.#a.get(t.data.id);e&&(this.#a.delete(t.data.id),t.data.ok&&t.data.parsed?e.resolve(t.data.parsed):e.reject(new f(t.data.problem||"invalid-scene")))},this.#e.onerror=()=>this.#s("scene-worker-failed")}catch{this.#e=null,this.#t&&URL.revokeObjectURL(this.#t),this.#t=null}}async parse(t,e){if(e?.aborted)throw new DOMException("Aborted","AbortError");if(!this.#e){if(await new Promise(r=>window.setTimeout(r,0)),e?.aborted)throw new DOMException("Aborted","AbortError");return Jn(t)}let n=++this.#n;return new Promise((r,o)=>{let i=()=>{this.#a.delete(n),o(new DOMException("Aborted","AbortError"))};e?.addEventListener("abort",i,{once:!0}),this.#a.set(n,{resolve:a=>{e?.removeEventListener("abort",i),r(a)},reject:a=>{e?.removeEventListener("abort",i),o(a)}}),this.#e?.postMessage({id:n,buffer:t},[t])})}#s(t){for(let e of this.#a.values())e.reject(new f(t));this.#a.clear(),this.#e?.terminate(),this.#e=null}dispose(){this.#s("scene-parser-disposed"),this.#t&&URL.revokeObjectURL(this.#t),this.#t=null}};var q={catalog:1e4,scene:6e4,delta:35e3,pose:1e4,history:15e3,workflow:15e3,mutation:2e4,roomPreview:15e3},er=2,pe=new WeakMap,ln={coverage_identity_unavailable:"Could not verify the current cleaning task. Check the robot status, then try again.",coverage_activity_unavailable:"Could not verify whether the robot is cleaning. Check the robot status, then try again.",coverage_native_session_active:"The robot already has a cleaning task. Wait for it to finish before starting another cleaning task.",coverage_identity_changed:"The cleaning task changed during setup. Check the robot status, then try again."},tr=(s,t)=>{if(!s||typeof s!="object")return null;let e=s;if(e.translation_domain!=="matic_robot"||typeof e.translation_key!="string"||!Object.hasOwn(ln,e.translation_key))return null;let n=e.translation_key,r=ln[n];try{let o=t?.(`component.matic_robot.exceptions.${n}.message`);o&&o!==`component.matic_robot.exceptions.${n}.message`&&(r=o)}catch{}return new M(n,null,r)},M=class extends Error{constructor(t,e=null,n=null){super(n??t),this.name="BackendError",this.code=t,this.status=e,this.recoveryMessage=n}},me=36,ee=16*1024*1024,cn=(s,t)=>{let e=Number(s);if(!Number.isSafeInteger(e)||e<0)throw new f(t);return e},dn=(s,t)=>{let e=s.headers.get("X-Matic-Revision");if(e===null)return t;let n=Number(e);if(!Number.isSafeInteger(n)||n<0)throw new f("invalid-scene-revision");return n},un=(s,t)=>{let e=s.headers.get("X-Matic-Floor-Coherent");if(e===null)return t;if(e==="1")return!0;if(e==="0")return!1;throw new f("invalid-scene-floor-header")},Te=class{#e;#t=new Ie;#n=new WeakMap;constructor(t){this.#e=t}async#a(t,e){let n=t.body?.getReader();if(!n)return new ArrayBuffer(0);let r=()=>{n.cancel().catch(()=>{})};e.addEventListener("abort",r,{once:!0});try{if(e.aborted)throw r(),new DOMException("Aborted","AbortError");let o=[],i=0;for(;;){let l=await n.read();if(e.aborted)throw new DOMException("Aborted","AbortError");if(l.done)break;o.push(l.value),i+=l.value.byteLength}let a=new Uint8Array(i),c=0;for(let l of o)a.set(l,c),c+=l.byteLength;return a.buffer}finally{e.removeEventListener("abort",r),n.releaseLock()}}async#s(t,e,n,r,o){if(!sn(t))throw new M("invalid-private-path");if(r?.aborted)throw new DOMException("Aborted","AbortError");let i=new AbortController,a=()=>{},c=new Promise((h,m)=>{a=m}),l=()=>{i.abort(),a(new DOMException("Aborted","AbortError"))};r?.addEventListener("abort",l,{once:!0});let d=!1,u=window.setTimeout(()=>{d=!0,l()},n);try{let h=this.#e(),m=new Headers(e.headers),v={...e,cache:"no-store",credentials:"same-origin",headers:Object.fromEntries(m.entries()),signal:i.signal},g=async()=>{let k;if(typeof h?.fetchWithAuth=="function")k=await h.fetchWithAuth(t,v);else{let b=h?.auth?.accessToken||h?.auth?.data?.access_token;b&&m.set("Authorization",`Bearer ${b}`);let R=typeof h?.hassUrl=="function"?h.hassUrl(t):t;k=await fetch(R,{...v,headers:m})}try{if(i.signal.aborted)throw new DOMException("Aborted","AbortError");return await o(k,i.signal)}finally{k.body&&!k.body.locked&&k.body.cancel().catch(()=>{})}};return await Promise.race([g(),c])}catch(h){throw d&&!r?.aborted?new M("request-timeout"):i.signal.aborted?new DOMException("Aborted","AbortError"):h}finally{window.clearTimeout(u),r?.removeEventListener("abort",l)}}async#o(t,e,n,r={}){return this.#s(t,{...r,headers:{Accept:"application/json",...r.headers||{}}},e,n,async(o,i)=>{if(!o.ok){let a=o.headers.get("X-Matic-Plans-Conflict");throw new M(a==="map-rechecking"?"map-rechecking":"request-failed",o.status)}try{return JSON.parse(new TextDecoder().decode(await this.#a(o,i)))}catch{throw new f("invalid-json-response")}})}async catalog(t){return Ee(await this.#o(Vt,q.catalog,t))}async scene(t,e,n,r,o,i){let a=new Headers({Accept:"application/vnd.matic.slam-scene"});return r==="live"&&a.set("X-Matic-Prefer-Cached","1"),i&&a.set("If-None-Match",i),this.#s(t,{headers:a},q.scene,o,async(c,l)=>{let d=dn(c,e),u=un(c,n);if(c.status===304)return{scene:null,floorCoherent:u,revision:d,notModified:!0};if(!c.ok)throw new M("scene-request-failed",c.status);if(c.headers.get("Content-Type")?.split(";",1)[0]!=="application/vnd.matic.slam-scene")throw new f("invalid-scene-content-type");return{scene:{...await this.#t.parse(await this.#a(c,l),l),revision:d,etag:c.headers.get("ETag"),source:r},floorCoherent:u,revision:d,notModified:!1}})}async#r(t,e,n){if(!Number.isSafeInteger(e)||e<1||e>ee||typeof DecompressionStream!="function")throw new f("invalid-scene-delta");let o=new Blob([t]).stream().pipeThrough(new DecompressionStream("deflate")).getReader(),i=new Uint8Array(e),a=0,c=()=>{o.cancel()};n?.addEventListener("abort",c,{once:!0});try{for(;;){if(n?.aborted)throw new DOMException("Aborted","AbortError");let{done:l,value:d}=await o.read();if(l)break;if(!(d instanceof Uint8Array)||a+d.byteLength>e)throw new f("invalid-scene-delta");i.set(d,a),a+=d.byteLength}}finally{n?.removeEventListener("abort",c),o.releaseLock()}if(a!==e)throw new f("invalid-scene-delta");return i}async#d(t,e,n){if(t.byteLength<me||t.byteLength>me+ee||e.buffer.byteLength>ee)throw new f("invalid-scene-delta");let r=new DataView(t),o=new TextDecoder().decode(new Uint8Array(t,0,8)),i=r.getUint16(8,!0),a=r.getUint16(10,!0),c=cn(r.getBigUint64(12,!0),"invalid-scene-delta"),l=cn(r.getBigUint64(20,!0),"invalid-scene-delta"),d=r.getUint32(28,!0),u=r.getUint32(32,!0);if(o!=="MATICDLT"||i!==1||a!==1||c!==e.revision||l<=e.revision||d<Pe||d>ee||u>ee||u+me!==t.byteLength)throw new f("invalid-scene-delta");let h=new Uint8Array(t,me,u),m=new Uint8Array(e.buffer),g=(await this.#r(h,Math.max(m.byteLength,d),n)).slice(),k=1024*1024;for(let y=0;y<m.byteLength;y+=k){if(n?.aborted)throw new DOMException("Aborted","AbortError");let S=Math.min(m.byteLength,y+k);for(let C=y;C<S;C+=1)g[C]=(g[C]??0)^(m[C]??0);S<m.byteLength&&await new Promise(C=>window.setTimeout(C,0))}let b=g.slice(0,d).buffer;return{parsed:{...await this.#t.parse(b,n),revision:l,etag:null,source:"live"},revision:l}}async sceneDelta(t,e,n,r){let o=t.includes("?")?"&":"?";return this.#s(`${t}${o}since=${encodeURIComponent(e.revision)}`,{headers:{Accept:"application/vnd.matic.slam-delta, application/vnd.matic.slam-scene"}},q.delta,r,async(i,a)=>{let c=dn(i,e.revision),l=un(i,n);if(i.status===204){if(c!==e.revision)throw new f("invalid-scene-delta-revision");return{scene:null,floorCoherent:l,revision:c,notModified:!0}}if(!i.ok)throw new M("delta-request-failed",i.status);if(c<=e.revision)throw new f("invalid-scene-delta-revision");let d=Number(i.headers.get("Content-Length"));if(Number.isFinite(d)&&d>me+ee)throw new f("invalid-scene-delta-size");let u=i.headers.get("Content-Type")?.split(";",1)[0],h=await this.#a(i,a);if(u==="application/vnd.matic.slam-delta"){let v=Number(i.headers.get("X-Matic-Base-Revision"));if(!Number.isSafeInteger(v)||v!==e.revision)throw new f("invalid-scene-delta-base");let g=await this.#d(h,e,a);if(g.revision!==c)throw new f("invalid-scene-delta-revision");return{scene:{...g.parsed,etag:i.headers.get("ETag")},floorCoherent:l,revision:c,notModified:!1}}if(u!=="application/vnd.matic.slam-scene")throw new f("invalid-scene-delta-content-type");return{scene:{...await this.#t.parse(h,a),revision:c,etag:i.headers.get("ETag"),source:"live"},floorCoherent:l,revision:c,notModified:!1}})}async pose(t,e){return on(await this.#o(t,q.pose,e))}async history(t,e){return Jt(await this.#o(t,q.history,e))}async plans(t,e){return rn(await this.#o(t,q.workflow,e))}async areas(t,e){return nn(await this.#o(t,q.workflow,e))}async previewRoomSequence(t,e,n,r){if(!t||t.length>255||e.length<1||e.length>100)throw new f("invalid-room-sequence-preview-request");if(r?.aborted)throw new DOMException("Aborted","AbortError");let o=this.#e()?.connection;if(!o?.sendMessagePromise)throw new M("preview-unavailable");let i=null,a=()=>{},c=new Promise((b,R)=>{a=R}),l=this.#n.get(o),d,u=new Promise(b=>{d=b});this.#n.set(o,u);let h=!1,m=()=>{h||(h=!0,d(),this.#n.get(o)===u&&this.#n.delete(o))},v=!1,g=()=>{a(new DOMException("Aborted","AbortError")),v&&(m(),i!==null&&window.clearTimeout(i),i=null)};r?.addEventListener("abort",g,{once:!0});let k=new Promise((b,R)=>{i=window.setTimeout(()=>{i=null,R(new M("preview-timeout"))},q.roomPreview)});k.catch(()=>{v&&m()});try{if(l&&(await Promise.race([l,c,k]),r?.aborted))throw new DOMException("Aborted","AbortError");let b=pe.get(o)??0;if(b>=er)throw new M("preview-unavailable");let R=o.sendMessagePromise({type:"call_service",domain:"matic_robot",service:"preview_room_sequence",target:{entity_id:t},service_data:{rooms:e.map(O=>({room:O.room,cleaning_mode:O.cleaning_mode,coverage_setting:O.coverage_setting})),use_room_schedule:!0,override_room_schedule:n},return_response:!0});pe.set(o,b+1),v=!0;let y=!1,S=()=>{if(!y){y=!0;let O=(pe.get(o)??1)-1;O===0?pe.delete(o):pe.set(o,O)}m(),i!==null&&window.clearTimeout(i),i=null};R.then(S,S);let C=await Promise.race([R,c,k]);if(r?.aborted)throw new DOMException("Aborted","AbortError");if(!C||typeof C!="object"||Array.isArray(C)||!("response"in C))throw new f("invalid-room-sequence-preview-envelope");return tn(C.response)}finally{v||(l?l.then(m,m):m(),i!==null&&window.clearTimeout(i),i=null),r?.removeEventListener("abort",g)}}async saveArea(t,e,n){let r=await this.#o(t,q.mutation,n,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...e.areaId?{area_id:e.areaId}:{},name:e.name,circles:e.circles,...e.outline?.closed?{outline:e.outline.points}:{},cleaning_mode:e.cleaningMode,coverage_setting:e.coverageSetting})});if(!r||typeof r!="object"||typeof r.id!="string")throw new f("invalid-area-save-response");return r.id}async deleteArea(t,e,n){await this.#s(`${t}?area_id=${encodeURIComponent(e)}`,{method:"DELETE",headers:{Accept:"application/json"}},q.mutation,n,async r=>{if(!r.ok)throw new M("area-delete-failed",r.status)})}async service(t,e,n,r){let o=this.#e();if(typeof o?.callService!="function")throw new M("service-unavailable");try{await o.callService(t,e,n,{entity_id:r})}catch(i){throw tr(i,o.localize)??i}}dispose(){this.#t.dispose()}};var pn=()=>({version:4,view:"top",appearance:"photo",labels:!0,quality:"auto",cameras:{}}),fe=(s,t,e)=>Math.max(t,Math.min(e,s)),mn=s=>s.replaceAll(/[^a-zA-Z0-9_-]/g,"").slice(0,128)||"local-user",lt=(s,t=4)=>`matic-map-studio:v${t}:${mn(s)}`,nr=s=>{if(!s||typeof s!="object")return null;let t=s;return["yaw","pitch","zoom","targetX","targetZ"].every(n=>typeof t[n]=="number"&&Number.isFinite(t[n]))?{yaw:fe(t.yaw,-Math.PI,Math.PI),pitch:fe(t.pitch,.18,Math.PI/2-.018),zoom:fe(t.zoom,.01,100),targetX:fe(t.targetX,-1e4,1e4),targetZ:fe(t.targetZ,-1e4,1e4)}:null},hn=s=>{let t=pn();if(!s||typeof s!="object")return t;let e=s,n=e.view==="three"||e.view==="top"||e.view==="rooms"?e.view:t.view,r=n==="rooms"?"top":n,o=e.quality==="auto"||e.quality==="efficient"||e.quality==="balanced"||e.quality==="maximum"?e.quality:t.quality,i=e.cameras&&typeof e.cameras=="object"?e.cameras:{},a={};for(let c of["three","top"]){let l=nr(i[c]);l&&(a[c]=l)}return{version:4,view:r,appearance:e.appearance==="rooms"||e.appearance==="photo"?e.appearance:t.appearance,labels:typeof e.labels=="boolean"?e.labels:t.labels,quality:o,cameras:a}},$e=class{#e="local-user";#t=null;#n=null;load(t){this.#a(),this.#e=mn(t);try{let e=window.localStorage.getItem(lt(this.#e));if(e)return hn(JSON.parse(e));for(let n of[3,2]){let r=window.localStorage.getItem(lt(this.#e,n));if(r)return hn(JSON.parse(r))}}catch{}return pn()}schedule(t){this.#t!==null&&window.clearTimeout(this.#t),this.#n={key:lt(this.#e),value:t},this.#t=window.setTimeout(()=>this.#a(),250)}#a(){this.#t!==null&&window.clearTimeout(this.#t),this.#t=null;let t=this.#n;if(this.#n=null,!!t)try{window.localStorage.setItem(t.key,JSON.stringify(t.value))}catch{}}dispose(){this.#a()}};var dt=1,te=Number.MAX_SAFE_INTEGER,bn=Number.MAX_SAFE_INTEGER,fn=64,ct=4,vn=16*1024,rr=250,or=4e3,Le=3e4;function L(s){return s!==null&&typeof s=="object"&&!Array.isArray(s)?s:null}function F(s,t){return typeof s=="number"&&Number.isSafeInteger(s)&&s>=0&&s<=t}function wn(s){let t=L(s);if(!t)return null;let e={};for(let[n,r]of Object.entries(t)){if(n.length===0||n.length>128||!F(r,bn))return null;e[n]=r}return e}function sr(s){let t=L(s);if(!t||Object.keys(t).length>128)return null;let e={};for(let[n,r]of Object.entries(t)){if(n.length===0||n.length>128||!F(r,bn))return null;e[n]=r}return e}function _n(s){return typeof s=="string"&&s.length>0&&s.length<=256?s:F(s,te)?String(s):null}function ir(s){let t=L(s),e=_n(t?.epoch);if(!t||t.schema!==dt||e===null)return null;let n=sr(t.capabilities),r=wn(t.revisions);return!n||!r||!F(t.sequence,te)||!F(t.coherence_generation,te)||t.coherence_generation===0?null:{schema:t.schema,capabilities:n,epoch:e,sequence:t.sequence,coherence_generation:t.coherence_generation,revisions:r}}function yn(s,t){let e=L(s),n=ir(e?.snapshot??s);if(!n)return null;let r=L(e?.snapshot??s);if(!r||!("payload"in r))return null;let o=r.entry_id,i=L(r.identity),a=L(r.status),c=L(r.payload),l=a?a.reason===null?null:kn(a.reason):null,d=c?.available,u=null;if(c?.entry!==void 0&&c.entry!==null){if((()=>{try{return JSON.stringify(c.entry).length}catch{return vn+1}})()>vn)return null;try{u=Ee({entries:[c.entry]})[0]??null}catch{return null}}let h=a?.state;return typeof o!="string"||o.length===0||o.length>128||t!==void 0&&o!==t||!i||i.entry_id!==o||i.floor_mission_id!==null&&!F(i.floor_mission_id,te)||typeof i.floor_verified!="boolean"||i.floor_verified!==(i.floor_mission_id!==null)||!a||h!=="ready"&&h!=="stale"&&h!=="unavailable"||a.reason!==null&&l===null||typeof a.retryable!="boolean"||typeof d!="boolean"||u!==null&&u.entryId!==o||h==="ready"&&(l!==null||a.retryable||!d)||(h==="stale"||h==="unavailable")&&(l===null||d)||l==="authorization"&&a.retryable?null:{...n,entry_id:o,identity:{entry_id:o,floor_mission_id:i.floor_mission_id,floor_verified:i.floor_verified},status:{state:h,reason:l,retryable:a.retryable},payload:{available:d,entry:u}}}function gn(s){let t=L(s),e=_n(t?.epoch),n=wn(t?.revisions),r=t?.resources;return e===null||!n||!F(t?.sequence,te)||!F(t?.coherence_generation,te)||t.coherence_generation===0||!Array.isArray(r)||r.length>128||!r.every(o=>typeof o=="string"&&o.length<=128)?null:{epoch:e,sequence:t.sequence,coherence_generation:t.coherence_generation,revisions:n,resources:r}}var ar=["gap","overflow","reconnect","invalid_message","server_request","restart","entry_removed","authorization","snapshot_required"];function kn(s){return typeof s=="string"&&ar.includes(s)?s:null}var Oe=class{#e;#t;#n;#a=null;#s=!1;#o=!1;#r=!1;#d=!1;#m=!1;#b=!1;#p=0;#P=!1;#k=!1;#q=!1;#w=!1;#l=null;#A=null;#i=0;#x=!1;#h=null;#_=-1;#v=new Map;#N=!1;#c=!1;#S=null;#u=[];constructor(t,e){this.#e=t,this.#t=e,this.#n=Math.max(1,Math.min(fn,e.maxPendingInvalidations??fn))}async start(){if(!(this.#s||this.#c)){this.#c=!0;try{await this.#L(!1)}catch(t){this.#B(t),this.#y("reconnect")}}}notifyReconnect(){(this.#d||this.#b)&&(this.#p+=1),this.#i=0,this.#P=!1,this.#d=!1,this.#m=!1,this.#l!==null&&window.clearTimeout(this.#l),this.#l=null,this.requestResync("reconnect"),this.#r&&this.#$(0,!0)}requestResync(t="server_request"){this.#y(t,!0)}dispose(){this.#s||(this.#s=!0,this.#l!==null&&window.clearTimeout(this.#l),this.#l=null,this.#r=!1,this.#a?.(),this.#a=null,this.#v.clear(),this.#u=[])}#I(t){if(this.#s)return;let e=L(t),n=L(e?.event)??e,r=n?.type;if(r==="resync"){let i=kn(n?.reason);if(!i){this.#y("invalid_message");return}if(i==="entry_removed"){this.#t.onEvent({type:"resync",reason:i}),this.dispose();return}this.#y(i);return}if(this.#d){if(r==="invalidate"){let i=gn(n?.invalidation??n);i?this.#C(i):(this.#u=[],this.#x=!0)}return}let o=r==="snapshot"?yn(n?.snapshot??n,this.#t.entryId):r==="invalidate"?gn(n?.invalidation??n):null;if(!o){this.#y("invalid_message");return}if(r==="snapshot"){let i=o;if(this.#r)return;if(this.#h!==null&&i.epoch!==this.#h){this.#y("restart");return}this.#f(i);return}this.#E(o)}#f(t){this.#h===t.epoch&&t.sequence<this.#_||(this.#h=t.epoch,this.#_=t.sequence,this.#v.clear(),this.#t.onEvent({type:"snapshot",snapshot:t}))}#T(t){let e=this.#u;if(this.#u=[],this.#f(t),this.#s)return;let n=t.sequence+1;for(let r of e)if(r.epoch===t.epoch&&!(r.sequence<=t.sequence)&&!(r.sequence<n)){if(r.sequence!==n){this.#u=e.filter(o=>o.epoch===t.epoch&&o.sequence>=n),this.#y("gap");return}this.#E(r),n+=1}}#E(t){if(this.#r){this.#C(t);return}if(this.#h===null){this.#C(t);return}if(this.#h!==t.epoch){this.#C(t),this.#y("reconnect");return}if(!(t.sequence<=this.#_)){if(t.sequence!==this.#_+1){this.#C(t),this.#y("gap");return}this.#_=t.sequence;for(let e of t.resources)this.#v.set(e,t);if(this.#v.size>this.#n){this.#v.clear(),this.#y("overflow");return}this.#N||(this.#N=!0,queueMicrotask(()=>this.#H()))}}#C(t){this.#u.length>=this.#n?(this.#u=[],this.#x=!0,this.#y("overflow")):this.#u.push(t)}#H(){if(this.#N=!1,this.#s||this.#d||this.#v.size===0){this.#d&&this.#v.clear();return}let t=[...this.#v.values()];this.#v.clear();let e=t.reduce((r,o)=>!r||o.sequence>r.sequence?o:r,null);if(!e)return;let n=[...new Set(t.flatMap(r=>r.resources))];this.#t.onEvent({type:"invalidation",invalidation:{...e,resources:n}})}#y(t,e=!1){if(!this.#s){if(t==="authorization"){this.#K(),this.#t.onEvent({type:"resync",reason:t});return}if(!this.#d&&(this.#o||(this.#o=!0,this.#t.onEvent({type:"resync",reason:t}),queueMicrotask(()=>{this.#o=!1})),t!=="entry_removed")){let n=e&&!this.#P;if(n&&(this.#P=!0),n&&this.#l!==null&&(window.clearTimeout(this.#l),this.#l=null),this.#q){if(this.#w){n&&this.#$(0,!0);return}this.#w=!0,this.#z(n);return}if(e&&this.#r){n&&(this.#k=!0);return}let r=this.#i>=ct?Le:0;this.#$(n?0:r,n)}}}#$(t,e=!1){if(!this.#s){if(this.#l!==null){if(!e)return;window.clearTimeout(this.#l),this.#l=null}if(this.#r){this.#A=e?t:Math.max(this.#A??0,t);return}this.#l=window.setTimeout(()=>{this.#l=null,this.#L(!0)},t)}}#z(t=!1){let e=this.#i>=ct?Le:Math.min(rr*2**this.#i,or);this.#i<ct&&(this.#i+=1),this.#$(t?0:e,t)}async#L(t,e=!1){if(this.#s||this.#r)return;let n=this.#p;this.#r=!0,this.#b=e;try{if(t&&await this.#O(),this.#s||this.#d&&!e||n!==this.#p)return;let r=await this.#e.sendMessagePromise({type:"matic_robot/workspace_snapshot",version:dt,entry_id:this.#t.entryId});if(this.#s||this.#d&&!e||n!==this.#p)return;let o=yn(r,this.#t.entryId);if(!o)throw new Error("invalid-workspace-snapshot");if(o.status.reason==="authorization"){this.#K(),this.#t.onEvent({type:"snapshot",snapshot:o});return}if(o.status.state!=="ready"&&o.status.retryable)throw new Error("workspace-snapshot-retryable");e&&(this.#d=!1,this.#m=!1,this.#l!==null&&window.clearTimeout(this.#l),this.#l=null),this.#r=!1,this.#q=!0,this.#w=!1;try{t?this.#F(o):this.#T(o)}finally{this.#q=!1}this.#w?this.#k&&(this.#k=!1,this.#$(0,!0)):(this.#i=0,this.#P=!1,this.#k=!1),!t&&!this.#s&&await this.#O(),this.#x&&(this.#x=!1,this.#y("overflow"))}catch(r){if(this.#s||this.#d&&!e||n!==this.#p)return;if(this.#B(r),this.#Q(r))this.#K(),this.#t.onEvent({type:"resync",reason:"authorization"});else if(!e){let o=this.#k;this.#k=!1,this.#z(o)}}finally{this.#r=!1,this.#b=!1,this.#m?(this.#m=!1,this.#W(0)):e&&this.#d&&this.#W(Le);let r=this.#A;this.#A=null,r!==null&&this.#$(r)}}async#O(){if(this.#s||this.#a)return;if(this.#S)return this.#S;let t=(async()=>{let e=await this.#e.subscribeMessage(n=>this.#I(n),{type:"matic_robot/workspace_subscribe",version:dt,entry_id:this.#t.entryId});this.#s?e():this.#a=e})();this.#S=t;try{await t}finally{this.#S===t&&(this.#S=null)}}#F(t){let e=this.#u;if(this.#u=[],this.#h===t.epoch&&t.sequence<this.#_){this.#u=e,this.#y("snapshot_required");return}if(this.#f(t),this.#s)return;let n=t.sequence+1;for(let r of e)if(r.epoch===t.epoch&&!(r.sequence<=t.sequence)&&!(r.sequence<n)){if(r.sequence!==n){this.#u=e.filter(o=>o.sequence>=n),this.#y("gap");return}this.#E(r),n+=1}}#Q(t){let e=L(t),n=e?.code,r=e?.status??e?.statusCode;return n==="unauthorized"||n==="not_authorized"||n==="auth_invalid"||r===401||r===403}#K(){this.#p+=1,this.#d||(this.#d=!0,this.#l!==null&&window.clearTimeout(this.#l),this.#l=null,this.#m=!1),this.#v.clear(),this.#u=[],this.#x=!1,this.#A=null,this.#i=0,this.#P=!1,this.#k=!1,this.#b||this.#W(Le)}#W(t){this.#s||this.#l!==null||this.#m||(this.#l=window.setTimeout(()=>{if(this.#l=null,!this.#s){if(this.#r){this.#m=!0;return}this.#L(!0,!0)}},t))}#B(t){this.#t.onError?.(t instanceof Error?t:new Error("Workspace transport failed"))}};var lr=!1,p=(s,t,e=null)=>({status:s,value:t,problem:e}),T=s=>s instanceof DOMException&&s.name==="AbortError",W=(s,t)=>s instanceof M||s&&typeof s=="object"&&"code"in s&&typeof s.code=="string"?s.code:t,cr=s=>s instanceof M?s.recoveryMessage:null,re=s=>[s.selectedFloorOrdinal??"none",s.mapFloorOrdinal??"none",s.mapFloorCoherent?"coherent":"transition"].join(":"),oe=s=>[s.mapFloorOrdinal??"none",s.mapSessionVerified?"verified":"unverified",s.mapSessionKey??"no-session"].join(":"),N=s=>[s.entryId,s.selectedFloorOrdinal??"none",s.mapFloorOrdinal??"none"].join("|"),H=s=>[s.entryId,re(s),oe(s)].join("|"),ut=s=>[H(s),s.mapRevision].join("|"),ht=s=>s.runnerLocked||s.stopSettlePending||s.activePlan||s.nativeReconciliationPending||s.nativeSessionActive===!0,De=(s,t)=>s.entryKey===t.entryKey&&s.generation===t.generation&&s.floorKey===t.floorKey&&s.missionKey===t.missionKey,ne="Live map updates paused while the current map is rechecked.",Sn="Saved map from ",pt="Reconnecting. The last verified map remains read only.",dr=1e3,ur=["rooms","plans","plan","draw","areaReview"],Rn=s=>JSON.stringify({...s,previewToken:void 0}),qe=(s,t)=>s.label?s.label:s.active?"Current floor":`Saved floor ${s.ordinal??t}`,Ne=class{#e;#t;#n;#a=new $e;#s=null;#o=new Map;#r=null;#d;#m=null;#b=null;#p=null;#P=0;#k=!1;#q=!1;#w=!1;#l=!1;#A=Promise.resolve();#i=!1;#x=!1;#h="";#_=0;#v=null;#N="";#c=!1;#S=!0;#u=null;#I=null;#f=null;#T=null;#E="";#C=!1;#H;#y;constructor(t,e,n=null,r=lr){this.#e=t,this.#t=new St(t.value.generation),this.#n=e,this.#H=n,this.#y=r,this.#T=t.subscribe(o=>{this.#$(o),this.#F()})}#$(t){if(!t.owner)return;let e={version:4,view:t.view,appearance:t.appearance,labels:t.labelsVisible,quality:t.quality,cameras:t.cameras},n=this.#s;this.#s=e,!(!n||n.view===e.view&&n.appearance===e.appearance&&n.labels===e.labels&&n.quality===e.quality&&n.cameras===e.cameras)&&this.#a.schedule(e)}#z(t){let e=_t(t),n=t.resources.entry,r=this.#r?.vacuumEntityId;if(!e||!n||!r||!t.selection.entryId||t.workflow!=="rooms"||t.dataMode!=="live"||t.floor.readOnly||t.coherence!=="current"||!t.host.connected||!t.host.administrator||!t.host.robotConnected||t.command!=="idle"||t.resources.plans.status!=="ready")return null;let o=t.selection.roomIds.map(i=>{let a=t.selection.roomSettings.find(c=>c.roomId===i);return a?{room:i,cleaning_mode:a.cleaningMode,coverage_setting:a.coverageSetting}:null});return o.some(i=>i===null)?null:{key:e,generation:t.generation,retryRevision:t.manualRoomPreviewRetry,floorKey:re(n),missionKey:oe(n),entryId:t.selection.entryId,entityId:r,rooms:o,overrideRoomSchedule:!t.selection.useRoomSchedule}}#L(t){return JSON.stringify([t.key,t.generation,t.retryRevision,t.floorKey,t.missionKey,t.entryId,t.entityId])}#O(t){let e=this.#z(this.#e.value);return!this.#c&&e!==null&&this.#L(e)===this.#L(t)}#F(){if(this.#c||!this.#r)return;let t=this.#e.value,e=this.#z(t);if(!e){this.#o.get("room-preview")?.abort(),this.#o.delete("room-preview"),this.#E="",(t.manualRoomPreview.status!=="idle"||t.manualRoomPreview.value!==null)&&this.#e.patch({manualRoomPreview:p("idle",null)});return}let n=this.#L(e),r=Ge(t);if(r&&r.key===e.key&&r.generation===e.generation&&r.floorKey===e.floorKey&&r.missionKey===e.missionKey&&r.preview.entryId===e.entryId){this.#E=n;return}if(this.#E===n)return;this.#o.get("room-preview")?.abort(),this.#E=n;let o=this.#R("room-preview");this.#e.patch({manualRoomPreview:p("loading",null)}),this.#Q(e,o)}async#Q(t,e){try{let n=await this.#n.previewRoomSequence(t.entityId,t.rooms,t.overrideRoomSchedule,e.signal);return!this.#O(t)||e.signal.aborted||n.entryId!==t.entryId?null:(this.#e.patch({manualRoomPreview:p("ready",{key:t.key,generation:t.generation,floorKey:t.floorKey,missionKey:t.missionKey,preview:n})}),n)}catch(n){return T(n)||e.signal.aborted||!this.#O(t)||this.#e.patch({manualRoomPreview:p("error",null,W(n,"preview-unavailable"))}),null}finally{this.#g("room-preview",e)}}sync(t,e){if(this.#c)return;let n=this.#u,r=this.#r?.host.robotConnected??null,o=this.#r!==null&&!this.#r.host.robotConnected&&t.host.robotConnected,i=this.#e.value.owner;i&&(i.entryKey!==t.entryKey||i.userKey!==t.userKey)&&(this.#D("context-changed"),this.#k&&(this.#w=!0,this.#l=!1));let a=this.#S;this.#S=t.host.connected,this.#r=t,this.#d=e,this.#K(t),o&&n&&n===this.#u&&n.notifyReconnect();let c=t.userKey!==this.#N?this.#a.load(t.userKey):null;if(c&&(this.#N=t.userKey,this.#s=c),this.#e.patch({owner:{userKey:t.userKey,entryKey:t.entryKey},host:t.host,activity:t.activity,batteryPercent:t.batteryPercent,robotLabel:t.robotLabel,robots:t.robots,locale:t.language,...c?{view:c.view,appearance:c.appearance,labelsVisible:c.labels,quality:c.quality,cameras:c.cameras}:{}}),!t.host.administrator){this.#V(),this.#D("access-required");return}if(!t.host.connected){a&&(this.#e.patch({generation:this.#t.invalidate()}),this.#Y(),this.#h=""),this.#V(),this.#w=!1,this.#l=!1,this.#x=!1,this.#M();let l=this.#e.value,d=l.resources.scene.value;this.#e.patch({coherence:d?"degraded":"unavailable",resources:{...l.resources,catalog:l.resources.catalog.status==="loading"?p("idle",l.resources.catalog.value):l.resources.catalog,plans:l.resources.plans.status==="loading"?p("idle",l.resources.plans.value):l.resources.plans,areas:l.resources.areas.status==="loading"?p("idle",l.resources.areas.value):l.resources.areas,pose:p("idle",null)},map:{...l.map,available:d!==null,exactPose:!1},notice:d?{tone:"warning",text:pt}:l.notice});return}if(t.host.robotCount===0){this.#V(),this.#D("map-unavailable");return}if(!t.host.robotConnected){r!==!1&&(this.#J(),this.#M(),this.#w=!1,this.#l=!1,this.#x=!1),this.#V();let l=this.#e.value,d=l.resources.scene.value;this.#e.patch({coherence:d?"degraded":"unavailable",resources:{...l.resources,catalog:l.resources.catalog.status==="loading"?p("idle",l.resources.catalog.value):l.resources.catalog,scene:l.resources.scene.status==="loading"?p("idle",d):l.resources.scene,pose:p("idle",null)},map:{...l.map,available:d!==null,exactPose:!1}});return}if(this.#se(),!a||o){this.#e.value.notice?.text===pt&&this.#e.patch({notice:null}),this.refreshCatalog(!0,!0);return}(this.#e.value.resources.catalog.status==="idle"||t.entryKey&&t.entryKey!==this.#e.value.selection.entryId)&&this.refreshCatalog(!0)}#K(t){let e=t.entryKey;if(!this.#y||!this.#H||!t.host.administrator||!t.host.connected||!e){this.#u?.dispose(),this.#u=null,this.#I=null,this.#f=null;return}if(this.#u&&this.#I===e)return;this.#u?.dispose(),this.#f=null;let n=new Oe(this.#H,{entryId:e,onEvent:r=>{if(!(this.#c||this.#u!==n||this.#I!==e||this.#r?.entryKey!==e)){if(r.type==="resync"&&r.reason==="entry_removed"){n.dispose(),this.#u===n&&(this.#u=null,this.#I=null,this.#f=null);return}if(r.type==="snapshot"){let{snapshot:o}=r,i=this.#e.value.resources.entry,a=o.payload.entry;if(o.entry_id!==e||o.identity.entry_id!==e)return;if(a&&(a.entryId!==e||o.identity.floor_verified!==(a.mapFloorCoherent&&a.mapSessionVerified))){n.requestResync("invalid_message");return}let c=!a&&i?.entryId===e&&o.identity.floor_verified!==(i.mapFloorCoherent&&i.mapSessionVerified);if(o.status.reason==="authorization"){this.#f=null,this.#U(e,["plans","areas","history"]);return}let l=this.#f,d=[],u=l!==null&&l.epoch!==o.epoch;if(l&&l.epoch===o.epoch){let g=new Set([...Object.keys(l.revisions),...Object.keys(o.revisions)]),k=[...g].some(b=>(o.revisions[b]??-1)<(l.revisions[b]??-1));if(o.coherence_generation<l.coherenceGeneration||o.coherence_generation===l.coherenceGeneration&&k){n.requestResync("restart");return}d=[...g].filter(b=>(o.revisions[b]??-1)>(l.revisions[b]??-1))}u&&(d=["plans","areas","history"]);let h=l!==null&&(l.epoch!==o.epoch||l.coherenceGeneration!==o.coherence_generation),m=!!(i&&a&&i.entryId===e&&H(i)!==H(a));if(this.#f={entryId:o.entry_id,epoch:o.epoch,sequence:o.sequence,coherenceGeneration:o.coherence_generation,revisions:o.revisions},c){this.#U(e,["plans","areas","history"]);return}if(h||m){this.#U(e,d);return}let v=a!==null&&i?.entryId===e&&this.#B(a);if(l&&d.length){if(o.sequence<=l.sequence){n.requestResync("invalid_message");return}this.#f=l,this.#W({epoch:o.epoch,sequence:o.sequence,coherence_generation:o.coherence_generation,revisions:o.revisions,resources:d},e,n,v)}return}if(r.type==="resync"){this.#f=null,r.reason!=="authorization"&&this.#U(e,["plans","areas","history"]);return}this.#W(r.invalidation,e,n)}},onError:()=>this.#e.patch({notice:{tone:"warning",text:pt}})});this.#u=n,this.#I=e,n.start()}#W(t,e,n,r=!1){let o=this.#f;if(!o||o.entryId!==e||this.#u!==n||t.epoch!==o.epoch||t.sequence<=o.sequence)return;let i=t.coherence_generation!==o.coherenceGeneration,c=[...new Set([...Object.keys(o.revisions),...Object.keys(t.revisions)])].some(m=>(t.revisions[m]??-1)<(o.revisions[m]??-1));if(t.coherence_generation<o.coherenceGeneration||!i&&c){n.requestResync("restart");return}let l=new Set(t.resources),d=[...l].some(m=>(t.revisions[m]??-1)>(o.revisions[m]??-1));if(this.#f={...o,sequence:t.sequence,coherenceGeneration:t.coherence_generation,revisions:t.revisions},!d&&!i)return;if(i){this.#U(e,t.resources);return}l.has("scene")&&l.delete("scene");let u=this.#e.value.resources.entry,h=this.#t.current();!u||u.entryId!==e||!h||l.size&&this.#oe(u,h,l,!r)}#B(t){let e=this.#e.value,n=e.resources.entry;if(!n||H(n)!==H(t))return!1;let r=t.mapRevision===n.mapRevision?t:{...t,mapRevision:n.mapRevision},o=e.resources.catalog,i=o.value?.map(l=>l.entryId===r.entryId?r:l),a=r.mapFloorCoherent&&r.mapSessionVerified,c=r.health==="problem"||r.health==="limited";return this.#e.patch({managedLock:ht(r),coherence:a?c?"degraded":"current":"verifying",map:{...e.map,available:e.resources.scene.value!==null,complete:r.mapComplete&&!r.mapTruncated,floorCoherent:r.mapFloorCoherent,sessionVerified:r.mapSessionVerified,exactPose:a?e.map.exactPose:!1},floor:{...e.floor,classifiedCount:Math.max(1,r.historyFloorCount)},resources:{...e.resources,entry:r,...i?{catalog:{...o,value:i}}:{}}}),!0}#J(){let t=this.#t.invalidate();this.#Y();let e=this.#e.value;this.#e.patch({generation:t,coherence:e.resources.scene.value?"verifying":"unavailable",map:{...e.map,exactPose:!1}}),this.#M(["catalog"]),this.#h=""}#U(t,e=[]){this.#J(),this.refreshCatalog(!0,!0).then(()=>{if(this.#c||this.#r?.entryKey!==t||!this.#r.host.administrator||!this.#r.host.connected)return;let n=this.#e.value.resources.entry,r=this.#t.current();if(!n||n.entryId!==t||!r)return;let o=new Set(e);o.delete("history"),this.#oe(n,r,o,!1)})}#Y(){this.#_+=1,this.#v=null}#re(t){let e=this.#v,n=this.#t.current();return!!(e&&n&&e.generation===this.#_&&e.stamp.generation===n.generation&&e.entryId===t.entryId&&e.coherenceIdentity===H(t)&&e.deltaUrl===t.deltaUrl&&n.entryKey===t.entryId&&n.floorKey===re(t)&&n.missionKey===oe(t)&&t.mapFloorCoherent&&t.mapSessionVerified&&this.#e.value.dataMode==="live"&&this.#e.value.selection.floorId==="current"&&this.#r?.host.connected&&this.#r.host.robotConnected&&this.#r.host.administrator)}#oe(t,e,n,r=!0){(n.has("plans")||n.has("plan_state"))&&this.loadPlans(),n.has("areas")&&this.loadAreas(),n.has("history")&&this.#X(t,e),r&&["status","robot_state","activity","plan_state"].some(o=>n.has(o))&&this.refreshCatalog(!0,!0,!0)}#se(){this.#m===null&&(this.#m=window.setInterval(()=>{document.visibilityState==="visible"&&this.refreshCatalog()},5e3)),this.#b===null&&(this.#b=window.setInterval(()=>{document.visibilityState==="visible"&&this.refreshPose()},dr))}#V(){this.#m!==null&&window.clearInterval(this.#m),this.#b!==null&&window.clearInterval(this.#b),this.#m=null,this.#b=null}#R(t){this.#o.get(t)?.abort();let e=new AbortController;return this.#o.set(t,e),e}#g(t,e){this.#o.get(t)===e&&this.#o.delete(t)}#M(t=[]){let e=!1;for(let[n,r]of this.#o)t.includes(n)||(e||=n==="plan-mutation"||n==="area-mutation",r.abort(),this.#o.delete(n));e&&this.#e.value.command==="pending"&&this.#e.patch({command:"idle",notice:null})}#Z(){this.#P+=1,this.#p!==null&&window.clearTimeout(this.#p),this.#p=null}#D(t){this.#Z(),this.#t.invalidate(),this.#Y(),this.#h="";let e=this.#t.generation;this.#M();let n=this.#e.value,r=D();this.#e.patch({command:"idle",dataMode:r.dataMode,floor:r.floor,managedLock:!1,workflow:"none",dialog:null,notice:null,draftFloorOrdinal:null,draw:r.draw,planDraft:r.planDraft,areaDraft:r.areaDraft,generation:e,coherence:n.host.administrator?"unavailable":"blocked",fullMap:!1,precisionOpen:!1,resources:{catalog:p("error",null,t),entry:null,scene:p("idle",null),pose:p("idle",null),history:p("idle",null),plans:p("idle",null),areas:p("idle",null)},manualRoomPreview:p("idle",null),map:{available:!1,complete:!1,floorCoherent:!1,sessionVerified:!1,exactPose:!1},selection:{...r.selection,entryId:null,floorId:"current",historyId:null}})}async refreshCatalog(t=!1,e=!1,n=!1){if(this.#c||!this.#r?.host.administrator||!this.#r.host.connected||this.#r.host.robotCount===0)return;if(this.#k)return t&&(this.#q?e&&(this.#w?this.#l&&=n:this.#l=n,this.#w=!0):(this.#w?this.#l&&=n:this.#l=n,this.#w=!0,this.#o.get("catalog")?.abort())),this.#A;this.#k=!0,this.#q=t;let r;this.#A=new Promise(a=>{r=a});let o=this.#R("catalog"),i=this.#e.value.resources.catalog.value;this.#e.patch({resources:{...this.#e.value.resources,catalog:p("loading",i)}});try{let a=await this.#n.catalog(o.signal);if(o.signal.aborted||this.#c)return;let c=this.#d?.config?.entry_id,l=typeof c=="string"?c:null,d=a.find(v=>v.entryId===this.#r?.entryKey)||a.find(v=>v.entryId===l)||a[0]||null,u=this.#e.value.resources.entry,h=!!(d&&u&&H(d)===H(u)&&this.#re(u));if(d&&u&&N(d)===N(u)&&re(d)===re(u)&&oe(d)===oe(u)&&(h||d.mapRevision<u.mapRevision||!t&&this.#o.has("scene"))&&(d={...d,mapRevision:u.mapRevision}),this.#e.patch({managedLock:d?ht(d):!1,resources:{...this.#e.value.resources,catalog:p(a.length?"ready":"empty",a),entry:d}}),!d){this.#D("no-loaded-robot");return}if(this.#e.value.selection.floorId!=="current"&&!t)return;let m=ut(d);if((!t||n)&&m===this.#h){let v=this.#e.value,g=d.mapFloorCoherent&&d.mapSessionVerified,k=d.health==="problem"||d.health==="limited";this.#e.patch({coherence:g?k?"degraded":"current":"verifying",map:{...v.map,available:v.resources.scene.value!==null,complete:d.mapComplete&&!d.mapTruncated,floorCoherent:d.mapFloorCoherent,sessionVerified:d.mapSessionVerified,exactPose:g?v.map.exactPose:!1},floor:{...v.floor,classifiedCount:Math.max(1,d.historyFloorCount)}}),g&&this.#e.value.resources.plans.problem==="map-rechecking"&&this.loadPlans(),this.#G();let b=this.#t.current();b&&!v.resources.scene.value&&!this.#o.has("history")&&this.#X(d,b),g&&b&&(v.resources.scene.status==="error"||v.floor.readOnly)&&!this.#o.has("scene")&&this.#te(d,b);return}this.#h=m,this.#ee(d,u)}catch(a){if(T(a)||o.signal.aborted||this.#c)return;this.#e.patch({coherence:this.#e.value.resources.scene.value?"degraded":"unavailable",resources:{...this.#e.value.resources,catalog:p("error",i,W(a,"catalog-unavailable"))}})}finally{this.#g("catalog",o),this.#k=!1;let a=this.#w,c=this.#l;this.#q=!1;try{a&&!this.#c&&(this.#w=!1,this.#l=!1,await this.refreshCatalog(!0,!1,c))}finally{r()}}}#ee(t,e){let n=this.#e.value,r=!!(e&&N(e)===N(t)),o=t.mapFloorCoherent&&t.mapSessionVerified,i=n.draftMapSessionKey??(e?.mapFloorCoherent&&e.mapSessionVerified?e.mapSessionKey:null),a=n.draftFloorOrdinal??(e?.mapFloorCoherent&&e.mapSessionVerified?e.mapFloorOrdinal:null),c=o?t.mapFloorOrdinal:null,l=o?t.mapSessionKey:null,d=e!==null&&e.entryId!==t.entryId||a!==null&&c!==null&&a!==c||i!==null&&l!==null&&i!==l,u=r&&o&&a===t.mapFloorOrdinal&&i===t.mapSessionKey,h=["catalog"];r&&!d&&h.push("plans","areas"),u&&h.push("plan-mutation","area-mutation");let m=this.#t.begin(t.entryId,re(t),oe(t),t.mapRevision);this.#Y(),this.#M(h);let v=e?.entryId===t.entryId?n.resources.scene.value:null,g=v!==null&&(n.floor.readOnly||!r||!o||e?.mapSessionKey!==t.mapSessionKey),k=n.resources.pose.value,b=r&&o&&t.mapSessionKey!==null&&k?.position&&k.mapSessionKey===t.mapSessionKey?k:null;d&&this.#Z();let R=D(),y=t.health==="problem"||t.health==="limited",S=this.#e.value;this.#e.patch({...d?{command:"idle",workflow:"none",dialog:null,precisionOpen:!1,fullMap:!1,draw:R.draw,planDraft:R.planDraft,areaDraft:R.areaDraft,notice:{tone:"info",text:"The active map changed. Choose a task on this map."}}:{},draftFloorOrdinal:c??a,draftMapSessionKey:l??i,managedLock:ht(t),generation:m.generation,coherence:o?y?"degraded":"current":"verifying",dataMode:"live",...!o&&v?{notice:{tone:"warning",text:ne}}:{},resources:{...S.resources,entry:t,scene:p(o?"loading":"idle",v),pose:p(o?"loading":"idle",b),history:p("loading",S.resources.history.value),plans:r&&!d?S.resources.plans:p("idle",null),areas:r&&!d?S.resources.areas:p("idle",null)},map:{available:v!==null,complete:t.mapComplete&&!t.mapTruncated,floorCoherent:t.mapFloorCoherent,sessionVerified:t.mapSessionVerified,exactPose:o&&b!==null&&!g},floor:{classifiedCount:Math.max(1,t.historyFloorCount),displayName:g?n.floor.displayName:t.selectedFloorOrdinal?`Floor ${t.selectedFloorOrdinal}`:"Current floor",readOnly:g},selection:{...S.selection,entryId:t.entryId,floorId:"current",historyId:null,roomIds:d?[]:S.selection.roomIds,roomSettings:d?[]:S.selection.roomSettings,planId:d?null:S.selection.planId,areaId:d?null:S.selection.areaId}}),this.#X(t,m),o&&this.#e.value.resources.plans.status==="idle"&&this.loadPlans(),this.#G(),o&&(this.#te(t,m),this.#j(t,m))}async#te(t,e){let n=this.#R("scene");try{let r=await this.#n.scene(t.sceneUrl,t.mapRevision,t.mapFloorCoherent,"live",n.signal);if(!this.#t.accepts(e))return;if(!r.floorCoherent){let l=this.#e.value;this.#e.patch({coherence:"verifying",resources:{...l.resources,scene:p("error",l.resources.scene.value,"map-rechecking"),pose:p("idle",null)},map:{...l.map,available:l.resources.scene.value!==null,floorCoherent:!1,exactPose:!1},floor:{...l.floor,readOnly:l.resources.scene.value!==null},notice:{tone:"warning",text:ne}});return}if(r.revision<e.revision||!r.scene)throw new M("scene-unavailable");let o=r.revision===e.revision?e:this.#t.advance(e,r.revision);if(!o)throw new M("scene-unavailable");let i=this.#e.value,a={...i.resources.entry??t,mapRevision:r.revision};this.#h=ut(a),this.#e.patch({resources:{...i.resources,entry:a,scene:p("ready",r.scene)},map:{...i.map,available:!0},floor:{...i.floor,readOnly:!1,displayName:i.resources.history.value?.floors.find(l=>l.active)?.label||(a.selectedFloorOrdinal?`Floor ${a.selectedFloorOrdinal}`:"Current floor")},notice:i.notice?.text===ne||i.notice?.text.startsWith(Sn)?null:i.notice});let c=this.#e.value.resources.plans;if((c.status==="idle"||c.problem==="map-rechecking")&&this.loadPlans(),this.#G(),t.deltaUrl){let l=++this.#_;this.#ae(a,o,r.scene,l)}}catch(r){if(T(r)||!this.#t.accepts(e))return;if(r instanceof M&&r.code==="request-timeout"){let c=this.#e.value;this.#e.patch({resources:{...c.resources,scene:p("loading",c.resources.scene.value,"scene-building")}}),window.setTimeout(()=>{this.#c||!this.#t.accepts(e)||this.#e.value.selection.floorId!=="current"||this.#te(t,e)},250);return}let o=this.#e.value,i=o.resources.pose.value,a=o.resources.scene.value!==null&&t.mapSessionKey!==null&&i?.position!==null&&i?.mapSessionKey===t.mapSessionKey;this.#e.patch({coherence:"degraded",resources:{...o.resources,scene:p("error",o.resources.scene.value,W(r,"scene-unavailable"))},map:{...o.map,available:o.resources.scene.value!==null,exactPose:a}})}finally{this.#g("scene",n)}}async#ae(t,e,n,r){if(!t.deltaUrl||typeof DecompressionStream!="function")return;let o=t.deltaUrl,i={generation:r,stamp:e,entryId:t.entryId,coherenceIdentity:H(t),deltaUrl:o};if(r!==this.#_||!this.#t.accepts(e))return;this.#v=i;let a=t,c=e,l=n;try{for(;!this.#c&&r===this.#_&&this.#t.accepts(c)&&this.#e.value.selection.floorId==="current";){let d=this.#R("delta");try{let u=await this.#n.sceneDelta(o,l,a.mapFloorCoherent,d.signal);if(d.signal.aborted||this.#c||r!==this.#_||!this.#t.accepts(c))return;if(!u.floorCoherent){let v=this.#e.value;this.#e.patch({coherence:"verifying",map:{...v.map,available:v.resources.scene.value!==null,floorCoherent:!1,exactPose:!1},floor:{...v.floor,readOnly:v.resources.scene.value!==null},resources:{...v.resources,scene:p("error",v.resources.scene.value,"map-rechecking"),pose:p("idle",null)},notice:{tone:"warning",text:ne}}),this.#h="",this.refreshCatalog(!0);return}if(u.notModified||!u.scene){await new Promise(v=>window.setTimeout(v,100));continue}let h=this.#t.advance(c,u.revision);if(!h)return;c=h,i.stamp=h,l=u.scene,a={...a,mapRevision:u.revision},this.#h=ut(a);let m=this.#e.value;this.#e.patch({resources:{...m.resources,entry:a,scene:p("ready",l)},map:{...m.map,available:!0,floorCoherent:!0}}),this.#j(a,c)}finally{this.#g("delta",d)}}}catch(d){if(T(d)||this.#c||r!==this.#_||!this.#t.accepts(c))return;this.#e.patch({coherence:"degraded",notice:{tone:"warning",text:ne}}),this.#h="",this.refreshCatalog(!0)}finally{this.#v===i&&(this.#v=null)}}async#X(t,e){let n=this.#R("history");try{let r=await this.#n.history(t.historyUrl,n.signal),o=this.#t.current();if(n.signal.aborted||!o||!De(e,o)||r.entryId!==t.entryId)return;let i=this.#e.value,a=r.floors.find(d=>d.id===i.selection.floorId),c=!i.selection.historyId||a?.snapshots.some(d=>d.id===i.selection.historyId),l=i.dataMode==="live"?r.floors.find(d=>d.active):a;if(this.#e.patch({resources:{...this.#e.value.resources,history:p("ready",r)},floor:{...this.#e.value.floor,classifiedCount:r.floors.length,...l&&!(i.dataMode==="live"&&i.floor.readOnly)?{displayName:qe(l,1)}:{}}}),i.dataMode==="live"&&!i.resources.scene.value){let d=r.floors.flatMap(u=>u.snapshots.map(h=>({floor:u,snapshot:h}))).sort((u,h)=>Date.parse(h.snapshot.createdAt)-Date.parse(u.snapshot.createdAt));for(let u of d){let h;try{h=await this.#n.scene(u.snapshot.sceneUrl,u.snapshot.revision,!0,"history",n.signal)}catch(g){if(T(g)||n.signal.aborted)return;continue}let m=this.#t.current();if(n.signal.aborted||!m||!De(e,m)||this.#e.value.resources.scene.value)return;if(!h.scene)continue;let v=this.#e.value;this.#e.patch({floor:{...v.floor,readOnly:!0,displayName:qe(u.floor,1)},resources:{...v.resources,scene:p("ready",h.scene),pose:p("idle",null)},map:{...v.map,available:!0,exactPose:!1},notice:{tone:"warning",text:`${Sn}${new Date(u.snapshot.createdAt).toLocaleString()}. Live position is unavailable.`}});break}}if(i.dataMode==="history"&&(!a||!c)){let d=a||r.floors.find(h=>h.active)||r.floors[0],u=this.selectFloor(d?.id||"current");!this.#c&&i.workflow==="history"&&this.#e.dispatch({type:"open-workflow",workflow:"history"}),await u}}catch(r){let o=this.#t.current();if(T(r)||n.signal.aborted||!o||!De(e,o))return;this.#e.patch({resources:{...this.#e.value.resources,history:p("error",null,W(r,"history-unavailable"))}})}finally{this.#g("history",n)}}async refreshPose(){let t=this.#e.value.resources.entry,e=this.#t.current();!t||!e||this.#e.value.selection.floorId!=="current"||!t.mapFloorCoherent||!t.mapSessionVerified||await this.#j(t,e)}async#j(t,e){if(this.#c||!this.#S||!this.#r?.host.connected)return;if(this.#i){this.#x=!0;return}this.#i=!0;let n=this.#R("pose");try{let r=await this.#n.pose(t.poseUrl,n.signal),o=this.#t.current(),i=this.#e.value.resources.entry;if(!o||!De(e,o)||!i||!this.#e.value.map.floorCoherent||!r.floorCoherent)return;if(r.mapSessionKey===null||r.mapSessionKey!==i.mapSessionKey){this.#e.patch({resources:{...this.#e.value.resources,pose:p("idle",null)},map:{...this.#e.value.map,exactPose:!1}}),this.#h="",this.refreshCatalog(!0);return}let a=this.#e.value,c=a.resources.pose.value,l=!!(a.map.exactPose&&c?.position&&c.mapSessionKey===i.mapSessionKey);if(r.position===null&&l){this.#e.patch({resources:{...a.resources,pose:p("ready",c)}});return}this.#e.patch({resources:{...a.resources,pose:p("ready",r)},map:{...a.map,exactPose:r.position!==null}})}catch(r){if(T(r)||!this.#t.accepts(e))return;let o=this.#e.value,i=o.resources.pose.value,a=!!(o.map.exactPose&&i?.position&&i.mapSessionKey===o.resources.entry?.mapSessionKey);this.#e.patch({resources:{...o.resources,pose:p("error",a?i:null,W(r,"pose-unavailable"))},map:{...o.map,exactPose:a}})}finally{if(this.#g("pose",n),this.#i=!1,this.#x&&!this.#c&&this.#S&&this.#r?.host.connected&&this.#r.host.administrator&&this.#r.host.robotCount>0){this.#x=!1;let r=this.#e.value.resources.entry,o=this.#t.current();r&&o&&this.#j(r,o)}else this.#x=!1}}async selectFloor(t){let e=this.#e.value.resources.history.value,n=this.#e.value.resources.entry;if(!e||!n)return;let r=e.floors.find(c=>c.id===t);if(!r&&t!=="current")return;let o=this.#e.value;if(o.workflow==="draw"&&(o.draw.dirty||o.areaDraft.dirty)||o.workflow==="areaReview"&&(o.draw.dirty||o.areaDraft.dirty))return;if(!r||r.active){this.#h="";let c=this.#e.value;this.#e.patch({resources:{...c.resources,plans:p("idle",null),areas:p("idle",null),scene:p("idle",c.resources.scene.value),pose:p("idle",null)},map:{...c.map,available:c.resources.scene.value!==null,exactPose:!1},coherence:"verifying",floor:{...c.floor,readOnly:c.resources.scene.value!==null},notice:c.resources.scene.value?{tone:"warning",text:ne}:c.notice,workflow:"none",precisionOpen:!1}),this.#e.dispatch({type:"set-floor",floorId:"current"}),await this.refreshCatalog(!0);return}let i=r.snapshots.at(-1),a=this.#t.begin(n.entryId,r.id,i?.id||r.id,i?.revision||0);this.#M(["catalog"]),this.#e.patch({generation:a.generation,coherence:"current",dataMode:"history",floor:{classifiedCount:e.floors.length,displayName:qe(r,e.floors.indexOf(r)+1),readOnly:!0},selection:{...this.#e.value.selection,floorId:r.id,historyId:i?.id||null},resources:{...this.#e.value.resources,scene:p(i?"loading":"empty",null),pose:p("idle",null),plans:p("idle",null),areas:p("idle",null)},workflow:"none",precisionOpen:!1,map:{available:!1,complete:!0,floorCoherent:!0,sessionVerified:!0,exactPose:!1}}),i&&await this.#ie(i,a)}async selectHistory(t){let e=this.#e.value.resources.history.value,n=this.#e.value.resources.entry;if(!e||!n)return;if(!t){await this.selectFloor("current");return}let r=e.floors.find(a=>a.snapshots.some(c=>c.id===t)),o=r?.snapshots.find(a=>a.id===t);if(!r||!o)return;let i=this.#t.begin(n.entryId,r.id,o.id,o.revision);this.#M(["catalog"]),this.#e.patch({generation:i.generation,dataMode:"history",floor:{classifiedCount:e.floors.length,displayName:qe(r,e.floors.indexOf(r)+1),readOnly:!0},selection:{...this.#e.value.selection,floorId:r.id,historyId:o.id},resources:{...this.#e.value.resources,scene:p("loading",null),pose:p("idle",null)},map:{...this.#e.value.map,available:!1,exactPose:!1}}),await this.#ie(o,i)}async#ie(t,e){let n=this.#R("history-scene");try{let r=await this.#n.scene(t.sceneUrl,t.revision,!0,"history",n.signal);if(!this.#t.accepts(e)||!r.scene)return;this.#e.patch({resources:{...this.#e.value.resources,scene:p("ready",r.scene)},map:{...this.#e.value.map,available:!0,exactPose:!1}})}catch(r){if(T(r)||!this.#t.accepts(e))return;this.#e.patch({resources:{...this.#e.value.resources,scene:p("error",null,W(r,"history-scene-unavailable"))}})}finally{this.#g("history-scene",n)}}async openWorkflow(t){let e=this.#e.value;if((e.dataMode==="history"||e.floor.readOnly)&&ur.includes(t))return;let n=this.#e.value.workflow;if(t==="draw"&&n!=="draw"&&n!=="areaReview"&&this.selectArea(null),this.#e.dispatch({type:"open-workflow",workflow:t}),t==="history"){let r=this.#e.value.resources.entry,o=this.#t.current();r&&o&&(this.#e.patch({resources:{...this.#e.value.resources,history:p("loading",this.#e.value.resources.history.value)}}),await this.#X(r,o))}(t==="plans"||t==="plan"||t==="rooms")&&await this.loadPlans(),(t==="draw"||t==="areaReview")&&await this.loadAreas()}async loadPlans(){let t=this.#e.value.resources.entry;if(!t||!this.#t.current()||!Je(this.#e.value)||this.#e.value.resources.plans.status==="loading")return;let e=N(t),n=this.#R("plans");this.#e.patch({resources:{...this.#e.value.resources,plans:p("loading",null)}});try{let r=await this.#n.plans(t.plansUrl,n.signal),o=this.#e.value.resources.entry;if(n.signal.aborted||this.#c||!o||N(o)!==e)return;if(this.#e.value.planDraft.dirty||this.#e.value.workflow==="plan"){this.#e.patch({resources:{...this.#e.value.resources,plans:p("ready",r)}});return}let i=r.selectedPlan||r.plans[0]?.id||null,a=r.plans.find(c=>c.id===i);this.#e.patch({resources:{...this.#e.value.resources,plans:p("ready",r)},selection:{...this.#e.value.selection,planId:i},planDraft:a?Qe(a):{...this.#e.value.planDraft,id:null,name:"",rooms:[],dirty:!1}})}catch(r){let o=this.#e.value.resources.entry;if(T(r)||n.signal.aborted||this.#c||!o||N(o)!==e)return;let i=r instanceof M&&r.code==="map-rechecking"?"map-rechecking":W(r,"plans-unavailable");this.#e.patch({resources:{...this.#e.value.resources,plans:p("error",null,i)}})}finally{this.#g("plans",n)}}selectPlan(t,e=!1){let n=this.#e.value.resources.plans.value?.plans.find(r=>r.id===t);this.#e.patch({workflow:"plan",notice:!e&&this.#e.value.notice?.tone==="success"?null:this.#e.value.notice,selection:{...this.#e.value.selection,planId:t},planDraft:n?Qe(n):{...D().planDraft}})}#G(){let t=this.#e.value;(t.workflow==="draw"||t.workflow==="areaReview")&&t.resources.areas.status==="idle"&&this.loadAreas()}async loadAreas({reconcileDraft:t=!0}={}){let e=this.#e.value.resources.entry;if(!e||!this.#t.current()||!Je(this.#e.value))return;let n=N(e),r=this.#R("areas");this.#e.patch({resources:{...this.#e.value.resources,areas:p("loading",null)}});try{let o=await this.#n.areas(e.areasUrl,r.signal),i=this.#e.value.resources.entry;if(r.signal.aborted||this.#c||!i||N(i)!==n)return;if(o.sceneUrl!==i.sceneUrl)throw new M("areas-unavailable");this.#e.patch({resources:{...this.#e.value.resources,areas:p("ready",o)}});let a=this.#e.value.selection.areaId,c=this.#e.value,l=o.areas.some(d=>d.id===a);t&&(!c.draw.dirty&&!c.areaDraft.dirty||a!==null&&!l)&&this.selectArea(l?a:null)}catch(o){let i=this.#e.value.resources.entry;if(T(o)||r.signal.aborted||this.#c||!i||N(i)!==n)return;this.#e.patch({resources:{...this.#e.value.resources,areas:p("error",null,W(o,"areas-unavailable"))}})}finally{this.#g("areas",r)}}selectArea(t){let e=this.#e.value.resources.areas.value?.areas.find(r=>r.id===t),n=this.#e.value;this.#e.patch({selection:{...n.selection,areaId:t},areaDraft:e?this.#le(e):{id:null,name:"",cleaningMode:"vacuum",coverageSetting:"standard",status:"new",canRebind:!1,dirty:!1},draw:{...n.draw,circles:e?.circles||[],outline:e?.outline??null,outlineUndo:[],outlineRedo:[],tool:!e||e.outline?"outline":"paint",undo:[],redo:[],dirty:!1,strokeCount:0}})}#le(t){return{id:t.id,name:t.name,cleaningMode:t.cleaningMode,coverageSetting:t.coverageSetting,status:t.status,canRebind:t.canRebind,dirty:!1}}async saveArea(){let t=this.#e.value,e=t.resources.entry,n=t.areaDraft;if(!e||t.command==="pending"||!ie(t)||!n.name.trim()||!t.draw.circles.length)return;let r=this.#R("area-mutation"),o=()=>!this.#c&&!r.signal.aborted;this.#e.patch({command:"pending",notice:{tone:"info",text:"Saving area\u2026"}});try{let i=await this.#n.saveArea(e.areasUrl,{areaId:n.id,name:n.name.trim(),circles:t.draw.circles,outline:t.draw.outline??null,cleaningMode:n.cleaningMode,coverageSetting:n.coverageSetting},r.signal);if(!o())return;let a=this.#e.value,l=a.areaDraft===n&&a.draw.circles===t.draw.circles&&a.draw.outline===t.draw.outline&&a.selection.entryId===t.selection.entryId&&(a.workflow==="draw"||a.workflow==="areaReview")?{...n,id:i,name:n.name.trim(),status:"current",canRebind:!1,dirty:!1}:null;this.#e.patch({command:"idle",notice:{tone:"success",text:"Area saved"},...l?{dialog:a.dialog==="discardDraft"?null:a.dialog,selection:{...a.selection,areaId:i},areaDraft:l,draw:{...a.draw,dirty:!1,strokeCount:0,undo:[],redo:[],outlineUndo:[],outlineRedo:[]}}:{}}),await this.loadAreas({reconcileDraft:!1});let d=this.#e.value;o()&&l&&d.areaDraft===l&&!d.draw.dirty&&(d.workflow==="draw"||d.workflow==="areaReview")&&d.selection.entryId===t.selection.entryId&&d.resources.areas.value?.areas.some(u=>u.id===i)&&this.selectArea(i)}catch(i){if(T(i)||!o())return;this.#e.patch({command:"failed",notice:{tone:"error",text:"Area could not be saved"}})}finally{this.#g("area-mutation",r)}}async deleteArea(){let t=this.#e.value.resources.entry,e=this.#e.value.selection.areaId;if(!t||!e||this.#e.value.command==="pending"||!ie(this.#e.value))return;let n=this.#R("area-mutation"),r=()=>!this.#c&&!n.signal.aborted;this.#e.patch({command:"pending",notice:null});try{if(await this.#n.deleteArea(t.areasUrl,e,n.signal),!r())return;this.#e.patch({command:"idle",notice:{tone:"success",text:"Area deleted"}}),await this.loadAreas()}catch(o){!T(o)&&r()&&this.#e.patch({command:"failed",notice:{tone:"error",text:"Area could not be deleted"}})}finally{this.#g("area-mutation",n)}}async savePlan(){let t=this.#e.value,e=t.planDraft,n=t.resources.plans.value;if(!n||!e.name.trim()||!e.rooms.length||!ie(t))return;let r=e.rooms;if(await this.#de("save_plan",{...e.id?{plan_id:e.id}:{},name:e.name.trim(),enabled:e.enabled,run_behavior:e.runBehavior,rooms:r.map(i=>({room:i.roomId,cleaning_mode:i.cleaningMode,coverage_setting:i.coverageSetting,...i.cadence?{cadence:{scope:i.cadence.scope,mop_every_n:i.cadence.mopEveryN,coverage_every_n:i.cadence.coverageEveryN,periodic_coverage_setting:i.cadence.periodicCoverageSetting,do_mop_next:i.cadence.doMopNext,do_coverage_next:i.cadence.doCoverageNext}}:{}})),return_to_base:e.returnToBase,finish_current_room:e.finishCurrentRoom,finish_current_room_threshold:e.finishCurrentRoomThreshold,select:!e.id||n.selectedPlan===e.id},"Plan saved","Plan could not be saved")){let i=this.#e.value.workflow==="plan"&&this.#e.value.planDraft===e?{...e,dirty:!1}:null;if(i&&this.#e.patch({planDraft:i}),await this.loadPlans(),i&&this.#e.value.workflow==="plan"&&this.#e.value.planDraft===i&&this.#e.value.selection.entryId===t.selection.entryId){let a=this.#e.value.resources.plans.value,c=e.id||a?.selectedPlan;c&&a?.plans.some(l=>l.id===c)&&this.selectPlan(c,!0)}}}async deletePlan(){let t=this.#e.value.selection.planId,e=this.#e.value.selection.entryId;if(!t)return;if(await this.#de("delete_plan",{plan:t},"Plan deleted","Plan could not be deleted")){let r=this.#e.value;r.selection.entryId===e&&r.planDraft.id===t&&(this.#e.patch({selection:{...r.selection,planId:null},planDraft:D().planDraft}),r.workflow==="plan"&&this.#e.patch({workflow:"plans",precisionOpen:!1})),await this.loadPlans()}}async executeAction(t){switch(typeof t=="string"?t:t.id){case"recheck-status":{let n=this.#e.value.selection.entryId;await this.refreshCatalog(!0);let r=this.#e.value;!this.#c&&r.selection.entryId===n&&r.resources.catalog.status==="ready"&&r.host.connected&&r.host.robotConnected&&r.coherence==="current"&&r.command==="failed"&&this.#e.patch({command:"idle",notice:{tone:"info",text:"Status refreshed. Review the robot state before trying again."}});return}case"stop":await this.#ne("matic_robot","stop_intelligent_cleaning",{include_unmanaged:!0});return;case"resume":await this.#ne("vacuum","send_command",{command:"resume"});return;case"run-plan":{let n=this.#e.value,r=n.selection.planId||n.resources.plans.value?.selectedPlan;if(!r||n.workflow!=="plan"||!n.planDraft.enabled||n.resources.plans.status!=="ready"||n.command!=="idle"||!ge(n))return;let o=n.selection.entryId,i=n.generation,a=n.selection.planId,c=n.planDraft,l=n.resources.plans.value?.plans.find(m=>m.id===r)?.nextRunPreview;if(!l||!/^[0-9a-f]{64}$/u.test(l.previewToken??"")){this.#e.patch({notice:{tone:"warning",text:"A verified next-run preview is unavailable. Refresh the saved plan before starting it."}});return}this.#e.patch({command:"pending",notice:null}),await this.loadPlans();let d=this.#e.value,u=()=>{let m=this.#e.value;!this.#c&&m.selection.entryId===o&&m.generation===i&&m.command==="pending"&&this.#e.patch({command:"idle"})};if(this.#c||d.selection.entryId!==o||d.generation!==i||d.workflow!=="plan"||d.selection.planId!==a||(d.selection.planId||d.resources.plans.value?.selectedPlan)!==r||d.planDraft!==c){u();return}if(d.resources.plans.status!=="ready"){u(),this.#e.patch({notice:{tone:"warning",text:"Plan preview could not be refreshed. Check the plan and try again."}});return}let h=d.resources.plans.value?.plans.find(m=>m.id===r)?.nextRunPreview;if(!h||h.blocker||!/^[0-9a-f]{64}$/u.test(h.previewToken??"")){u(),this.#e.patch({notice:{tone:"warning",text:"This plan has no valid next-run preview. Review its rooms and schedule."}});return}if(!l||JSON.stringify(l)!==JSON.stringify(h)){u(),this.#e.patch({notice:{tone:"info",text:"The next-run preview changed. Review the updated settings before starting."}});return}u(),await this.#ne("matic_robot","run_selected_plan",{plan:r,preview_token:h.previewToken});return}case"clean-rooms":{await this.#ce();return}case"run-area":{let n=this.#e.value.selection.areaId;n&&await this.#ne("matic_robot","clean_area",{area:n});return}case"review-area":this.#e.dispatch({type:"open-workflow",workflow:"areaReview"});return;case"save-area":await this.saveArea();return;case"save-plan":await this.savePlan();return;case"delete-plan":await this.deletePlan();return;case"delete-area":await this.deleteArea();return;case"reset-room-cadence":{if(typeof t=="string")return;let n=this.#e.value;if(n.selection.planId!==t.planId||n.planDraft.dirty||n.dataMode!=="live"||n.command!=="idle"||n.activity!=="idle"&&n.activity!=="docked"||!await this.#de("reset_room_cadence",{plan:t.planId,room_id:t.roomId,modes:[t.mode]},t.mode==="mop"?"Mopping progress reset":"Coverage progress reset",t.mode==="mop"?"Mopping progress could not be reset":"Coverage progress could not be reset"))return;await this.loadPlans();let o=this.#e.value;!this.#c&&o.selection.entryId===n.selection.entryId&&o.selection.planId===t.planId&&!o.planDraft.dirty&&this.selectPlan(t.planId,!0);return}}}async#ce(){if(this.#C)return;let t=this.#e.value,e=this.#z(t),n=Ge(t);if(!e||!n||n.key!==e.key||n.generation!==e.generation||n.floorKey!==e.floorKey||n.missionKey!==e.missionKey||n.preview.entryId!==e.entryId||n.preview.blocker||n.preview.rooms.length===0)return;this.#C=!0;let r=this.#R("room-preview");this.#E=this.#L(e),this.#e.patch({manualRoomPreview:p("loading",null),notice:null});try{let o=await this.#n.previewRoomSequence(e.entityId,e.rooms,e.overrideRoomSchedule,r.signal);if(r.signal.aborted||!this.#O(e)||o.entryId!==e.entryId)return;let i={key:e.key,generation:e.generation,floorKey:e.floorKey,missionKey:e.missionKey,preview:o};if(o.blocker||o.rooms.length===0){this.#e.patch({manualRoomPreview:p("ready",i),notice:{tone:"warning",text:"The room preview is blocked. Review the current map and schedule before starting."}});return}if(Rn(n.preview)!==Rn(o)){this.#e.patch({manualRoomPreview:p("ready",i),notice:{tone:"info",text:"The room preview changed. Review the updated settings before starting."}});return}if(this.#e.patch({manualRoomPreview:p("ready",i),notice:null}),!this.#O(e)||!ge(this.#e.value))return;await this.#ne("matic_robot","clean_room_sequence",{rooms:e.rooms,use_room_schedule:!0,override_room_schedule:e.overrideRoomSchedule,return_to_base:!0,preview_token:o.previewToken})}catch(o){!T(o)&&!r.signal.aborted&&this.#O(e)&&this.#e.patch({manualRoomPreview:p("error",null,W(o,"preview-unavailable")),notice:{tone:"warning",text:"The room preview could not be refreshed. No cleaning was started."}})}finally{this.#g("room-preview",r),this.#C=!1,this.#F()}}async#de(t,e,n,r){let o=this.#r?.vacuumEntityId;if(!o||!ie(this.#e.value)||this.#e.value.command==="pending")return!1;let i=this.#R("plan-mutation"),a=this.#r?.entryKey,c=this.#r?.userKey,l=()=>!this.#c&&!i.signal.aborted&&a===this.#r?.entryKey&&c===this.#r?.userKey;this.#e.patch({command:"pending",notice:{tone:"info",text:"Saving\u2026"}});try{return await this.#n.service("matic_robot",t,e,o),l()?(this.#e.patch({command:"idle",notice:{tone:"success",text:n}}),!0):!1}catch{return l()&&this.#e.patch({command:"failed",notice:{tone:"error",text:r}}),!1}finally{this.#g("plan-mutation",i)}}async#ne(t,e,n){let r=this.#e.value,o=this.#r?.vacuumEntityId,i=e==="stop_intelligent_cleaning"||t==="vacuum"&&e==="return_to_base",a=t==="vacuum"&&e==="send_command"&&n.command==="resume";if(!o||r.selection.entryId!==this.#r?.entryKey||(i?!xt(r):a?!Rt(r):!ge(r)))return;let c=++this.#P,l=this.#r?.entryKey,d=()=>!this.#c&&c===this.#P&&l===this.#r?.entryKey,u=i?"settling":"starting";this.#p!==null&&window.clearTimeout(this.#p),this.#p=null,this.#e.patch({command:u,notice:null});try{if(await this.#n.service(t,e,n,o),!d())return;if(t==="matic_robot"&&(e==="clean_room_sequence"||e==="run_selected_plan")){this.#e.patch({command:"idle"}),this.refreshCatalog(!0);return}this.#e.patch({command:u}),this.#p!==null&&window.clearTimeout(this.#p),this.#p=window.setTimeout(()=>{this.#p=null,d()&&this.#e.value.command===u&&this.#e.patch({command:"idle"})},15e3)}catch(h){if(!d())return;this.#e.patch({command:"failed",notice:{tone:"error",text:cr(h)??"The action could not be confirmed. Check the robot status before trying again."}})}}dispose(){this.#c||(this.#c=!0,this.#J(),this.#T?.(),this.#T=null,this.#e.patch({manualRoomPreview:p("idle",null)}),this.#V(),this.#M(),this.#p!==null&&window.clearTimeout(this.#p),this.#p=null,this.#a.dispose(),this.#u?.dispose(),this.#u=null,this.#I=null,this.#n.dispose())}};var xn=s=>(s.workflow==="none"?0:s.workflow==="plan"?2:1)+(s.fullMap?1:0)+(s.precisionOpen?1:0)+(s.dialog?1:0),Cn=s=>{if(!s||typeof s!="object")return null;let t=s.maticMapLayer;if(!t||typeof t!="object")return null;let e=t.owner,n=t.depth;return typeof e=="string"&&Number.isInteger(n)&&Number(n)>=0?{owner:e,depth:Number(n)}:null},ze=class{#e;#t=`matic-map-${crypto.randomUUID?.()||Math.random().toString(36).slice(2)}`;#n=0;#a=null;#s=!1;#o=!1;constructor(t){this.#e=t}start(){this.#a||(this.#n=xn(this.#e.value),this.#a=this.#e.subscribe(t=>this.#r(t)),window.addEventListener("popstate",this.#d))}#r(t){let e=xn(t);if(this.#s){this.#s=!1,this.#n=e;return}if(e<this.#n){let n=Cn(history.state);if(n?.owner===this.#t&&n.depth===this.#n){let r=e-this.#n;this.#n=e,this.#o=!0,history.go(r);return}}if(e>this.#n)for(let n=this.#n+1;n<=e;n+=1){let r=history.state&&typeof history.state=="object"?history.state:{};history.pushState({...r,maticMapLayer:{owner:this.#t,depth:n}},"",window.location.href)}this.#n=e}#d=()=>{if(this.#o){this.#o=!1;return}if(!(this.#n<1)){if(V(this.#e.value,{type:"dismiss-top-layer"})){let t=history.state&&typeof history.state=="object"?history.state:{};history.pushState({...t,maticMapLayer:{owner:this.#t,depth:this.#n}},"",window.location.href),this.#e.dispatch({type:"open-dialog",dialog:"discardDraft"});return}this.#s=!0,this.#e.dispatch({type:"dismiss-top-layer"})}};dismissTop(){if(this.#n<1)return!1;let t=Cn(history.state);return t?.owner===this.#t&&t.depth===this.#n?history.back():this.#e.dispatch({type:"dismiss-top-layer"}),!0}dispose(){this.#a?.(),this.#a=null,window.removeEventListener("popstate",this.#d),this.#n=0,this.#o=!1}};var Pn=[X,G,_e,j`
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
`]}#e(e,n){return U(this.localize,e,n)}#t(e){this.dispatchEvent(new CustomEvent(ue,{detail:e,bubbles:!0,composed:!0}))}#n(e){let n=e.currentTarget.valueAsNumber;Number.isFinite(n)&&this.#t({type:"set-brush",value:n})}render(){let{draw:e}=this.state;return be`
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
    `}};customElements.get(ae)||customElements.define(ae,mt);var En=J(we),We=J(ae),Mn=J(le),Tn=s=>s.dataMode==="history"||s.floor.readOnly,hr=(s,t)=>{let e=(r,o,i)=>U(t,r,o,i);if(!s.host.connected)return{title:e("v4_reconnecting","Reconnecting"),detail:e("v4_ha_offline","Home Assistant is offline"),icon:Q,notable:!0};if(!s.host.administrator)return{title:e("v4_access_required","Access required"),detail:e("v4_admin_only","Administrator only"),icon:Q,notable:!0};if(s.host.robotCount===0)return{title:e("v4_no_robot_short","No robot"),detail:e("v4_set_up_robot","Set up a Matic robot"),icon:Q,notable:!0};if(!s.host.robotConnected)return{title:e("v4_robot_offline","Robot offline"),detail:e("v4_last_map_read_only","Last verified map \xB7 read only"),icon:Q,notable:!0};if(s.activity==="problem")return{title:e("v4_needs_attention","Needs attention"),detail:e("v4_check_robot","Check the robot"),icon:Q,notable:!0};if(s.dataMode==="history"){let r=s.resources.history.value?.floors.find(a=>a.id===s.selection.floorId),o=r?.snapshots.findIndex(a=>a.id===s.selection.historyId)??-1,i=r?.snapshots.length??0;return{title:e("v4_saved_map","Saved map"),detail:o>=0?e("v4_read_only_position","Read only \xB7 {position} of {count}",{position:o+1,count:i}):e("v4_read_only","Read only"),icon:et,notable:!1}}if(s.coherence==="verifying"||s.coherence==="booting")return{title:e("v4_locating","Locating"),detail:e("v4_finding_map","Finding the current map"),icon:de,notable:!0};if((s.resources.entry?.activePlan||s.resources.entry?.runnerLocked)&&(s.activity==="idle"||s.activity==="docked"))return{title:e("v4_task_in_progress","Task in progress"),detail:s.activity==="docked"?e("v4_task_docked","Robot docked; the cleaning task has not finished."):e("v4_task_waiting","Waiting for the cleaning task to continue or finish."),icon:tt,notable:!0};if(s.command==="starting"&&(s.activity==="idle"||s.activity==="docked"))return{title:e("v4_action_starting","Starting"),detail:e("v4_action_starting_detail","Waiting for the robot to begin"),icon:de,notable:!0};if(s.activity==="cleaning")return{title:e("v4_cleaning","Cleaning"),detail:e("v4_cleaning_progress","Cleaning in progress"),icon:nt,notable:!0};if(s.activity==="recharging"){let r=s.batteryPercent===null?e("v4_recharging_detail","Will resume automatically when ready"):e("v4_recharging_battery","Charging to resume \xB7 {percent}% battery",{percent:s.batteryPercent});return{title:e("v4_recharging","Charging to resume"),detail:r,icon:Nt,notable:!0}}if(s.activity==="paused")return{title:e("v4_paused","Paused"),detail:e("v4_can_resume","Cleaning can resume"),icon:rt,notable:!0};if(s.activity==="returning")return{title:e("v4_returning","Returning"),detail:e("v4_going_dock","Going to the dock"),icon:nt,notable:!0};if(s.activity==="stopping")return{title:e("v4_stopping","Stopping"),detail:e("v4_waiting_robot","Waiting for the robot"),icon:rt,notable:!0};let n=s.batteryPercent===null?e("v4_ready","Ready"):e("v4_battery","{percent}% battery",{percent:s.batteryPercent});return{title:s.activity==="docked"?e("v4_docked","Docked"):e("v4_ready","Ready"),detail:n,icon:de,notable:!1}},An=(s,t)=>{let e=(n,r)=>U(t,n,r);switch(s.workflow){case"rooms":return{title:e("v4_choose_rooms","Choose rooms"),description:e("v4_choose_rooms_detail","Select on the map or from the list.")};case"draw":return{title:e("v4_draw_area","Draw an area"),description:e("v4_draw_area_detail","Outline or paint the area, then review it before saving.")};case"plans":return{title:e("v4_your_plans","Your plans"),description:e("v4_choose_plan_detail","Choose a plan to edit or run, or create a new one.")};case"plan":return{title:s.planDraft.id?e("v4_edit_plan","Edit plan"):e("v4_create_plan","Create a plan"),description:e("v4_plan_detail","Review rooms and cleaning settings.")};case"areaReview":return{title:e("v4_name_this_area","Name this area"),description:e("area_details_hint","Name the area and choose cleaning settings.")};case"history":return{title:e("v4_map_history","Map history"),description:e("v4_map_history_detail","Saved maps are floor-scoped and read only.")};case"support":return{title:e("v4_map_diagnostics","Map diagnostics"),description:e("v4_map_support_detail","Private geometry is never included.")};case"none":return Tn(s)?{title:e("v4_saved_map_read_only_title","Saved map is read only"),description:s.dataMode==="live"?e("v4_map_recovery_automatic","Cleaning controls return automatically when the live map is verified."):e("v4_saved_map_read_only_detail","Return to the live map to choose rooms, run a plan, or draw a custom area.")}:{title:e("v4_what_to_clean","What should the robot clean?"),description:e("v4_clean_detail","Choose rooms, a saved plan, or a custom area.")}}},K=["peek","half","full"],In={none:"half",rooms:"half",draw:"peek",plan:"full",plans:"full",areaReview:"half",history:"half",support:"full"},pr=.5,mr=100,fr=6,vr=48,yr=["a[href]","button","input","label","select","textarea","summary",'[contenteditable]:not([contenteditable="false"])','[role="button"]','[role="link"]','[role="slider"]','[role="checkbox"]','[role="radio"]','[role="switch"]','[role="tab"]','[role="menuitem"]','[tabindex]:not([tabindex="-1"])'].join(","),gr=["button:not(:disabled)","a[href]","input:not(:disabled)","select:not(:disabled)","textarea:not(:disabled)","[tabindex]:not([tabindex='-1'])"].join(", "),br=(s,t,e=!1,n="room",r=!1,o="mop")=>{let i=(a,c,l)=>U(t,a,c,l);switch(s){case"discardDraft":return{title:e?i("v4_discard_plan","Discard plan changes?"):i("v4_discard_area","Discard area changes?"),detail:e?i("v4_discard_plan_detail","Your plan changes have not been saved. Keep editing or discard them."):i("v4_discard_area_detail","Your area changes have not been saved. Keep editing or discard them."),cancelLabel:i("v4_keep_area_editing","Keep editing"),confirmLabel:i("v4_discard","Discard"),action:"discard"};case"confirmDeletePlan":return{title:i("v4_delete_plan","Delete this plan?"),detail:i("v4_delete_plan_detail","This removes the saved plan from Home Assistant. The robot will not move."),cancelLabel:i("v4_cancel","Cancel"),confirmLabel:i("plan_delete","Delete plan"),action:"delete-plan"};case"confirmDeleteArea":return{title:i("v4_delete_area","Delete this area?"),detail:i("v4_delete_area_detail","This removes the saved outline from Home Assistant. The robot will not move."),cancelLabel:i("v4_cancel","Cancel"),confirmLabel:i("area_delete","Delete area"),action:"delete-area"};case"confirmResetCadence":return{title:o==="mop"?i("v4_reset_mop_cadence_title","Reset mopping progress for {room}?",{room:n}):i("v4_reset_coverage_cadence_title","Reset coverage progress for {room}?",{room:n}),detail:r?o==="mop"?i("v4_reset_shared_mop_cadence_detail","This clears shared mopping progress for {room} across plans that use its shared schedule. Coverage progress and saved cleaning history stay unchanged.",{room:n}):i("v4_reset_shared_coverage_cadence_detail","This clears shared coverage progress for {room} across plans that use its shared schedule. Mopping progress and saved cleaning history stay unchanged.",{room:n}):o==="mop"?i("v4_reset_private_mop_cadence_detail","This clears mopping progress for {room} in this plan. Coverage progress and saved cleaning history stay unchanged.",{room:n}):i("v4_reset_private_coverage_cadence_detail","This clears coverage progress for {room} in this plan. Mopping progress and saved cleaning history stay unchanged.",{room:n}),cancelLabel:i("v4_cancel","Cancel"),confirmLabel:o==="mop"?i("v4_reset_mop_cadence_confirm","Reset mopping progress"):i("v4_reset_coverage_cadence_confirm","Reset coverage progress"),action:"reset-room-cadence"};case"confirmStop":return{title:i("v4_stop_cleaning","Stop cleaning?"),detail:i("v4_stop_cleaning_detail","The robot may take a moment to settle before another action is available."),cancelLabel:i("v4_keep_cleaning","Keep cleaning"),confirmLabel:i("v4_stop","Stop"),action:"stop"};case"error":return{title:i("v4_error","Something went wrong"),detail:i("v4_error_detail","No action was started. Close this message and try again when the map is ready."),cancelLabel:i("v4_close","Close"),confirmLabel:i("v4_close","Close"),action:null};case null:return null}},wr=(s=document)=>{let t=s.activeElement;for(;t?.shadowRoot?.activeElement;)t=t.shadowRoot.activeElement;return t},ft=s=>!!(s&&s.isConnected&&s.offsetParent!==null),vt=class extends Y{constructor(){super();this.state=D();this._measuredNarrow=!1;this._sheetOffset=0;this._overflowOpen=!1;this._helpOpen=!1;this._browserFullscreen=!1;this._sheetDetent="half";this._announcement="";this._workflowLoadFailed=!1;this.#t=null;this.#n=null;this.#a=null;this.#s=null;this.#o=null;this.#r=null;this.#d=null;this.#m=null;this.#b=null;this.#p=null;this.#k=()=>{this._browserFullscreen=this.#q()};this.#w=e=>{if(!this._overflowOpen)return;let n=this.renderRoot.querySelector(".overflow-wrap");(!n||!e.composedPath().includes(n))&&(this._overflowOpen=!1)};this.#ie=()=>{this._workflowLoadFailed=!1,this.#j()};new Ht(this,{container:()=>this.renderRoot?.querySelector(".draw-tools")??null,items:"button"})}static{this.properties={state:{attribute:!1},localize:{attribute:!1},_measuredNarrow:{state:!0},_sheetOffset:{state:!0},_overflowOpen:{state:!0},_helpOpen:{state:!0},_browserFullscreen:{state:!0},_sheetDetent:{state:!0},_announcement:{state:!0},_workflowLoadFailed:{state:!0}}}static{this.styles=Pn}#e(e,n,r){return U(this.localize,e,n,r)}#t;#n;#a;#s;#o;#r;#d;#m;#b;#p;#P(){let e=this.renderRoot;return e instanceof ShadowRoot?e.fullscreenElement??document.fullscreenElement:document.fullscreenElement}#k;#q(){let e=this.renderRoot,n=e.querySelector(".app"),r=e instanceof ShadowRoot?e.fullscreenElement:null;if(r)return r===n;let o=document.fullscreenElement;for(let i=this;i;){if(i===o)return!0;let a=i.getRootNode();i=a instanceof ShadowRoot?a.host:null}return!1}#w;connectedCallback(){super.connectedCallback(),this.#t=new ResizeObserver(([e])=>{if(!e)return;let n=e.contentRect.width<1024||e.contentRect.height<480;n!==this._measuredNarrow&&(this._measuredNarrow=n)}),this.#t.observe(this),window.addEventListener("pointerdown",this.#w,!0),document.addEventListener("fullscreenchange",this.#k),this.#n=new ResizeObserver(([e])=>{if(!e)return;let n=Math.ceil(e.target.getBoundingClientRect().height);n!==this._sheetOffset&&(this._sheetOffset=n)})}disconnectedCallback(){this.#t?.disconnect(),this.#t=null,this.#n?.disconnect(),this.#n=null,this.#a=null,window.removeEventListener("pointerdown",this.#w,!0),document.removeEventListener("fullscreenchange",this.#k),super.disconnectedCallback()}updated(e){let n=e,r=this.renderRoot.querySelector(".mobile-sheet");if(r!==this.#a&&(this.#n?.disconnect(),this.#a=r,r?this.#n?.observe(r):this._sheetOffset!==0&&(this._sheetOffset=0)),n.has("_overflowOpen")&&this._overflowOpen&&this.updateComplete.then(()=>{this.renderRoot.querySelector("#map-options select, #map-options button")?.focus()}),n.has("_helpOpen")){if(this._helpOpen)this.updateComplete.then(()=>{this.renderRoot.querySelector(".help-dialog [data-dialog-initial-focus]")?.focus()});else if(n.get("_helpOpen")){let o=this.#r;this.#r=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>o?.focus({preventScroll:!0}))})}}if(e.has("state")){let o=e.get("state");if(o?.precisionOpen&&!this.state.precisionOpen&&this.#A()?.focus(),o?.fullMap&&!this.state.fullMap){let i=this.#o;this.#o=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>{(this.renderRoot.querySelector(".workspace-toggle")??this.renderRoot.querySelector(".nav--menu")??(i?.isConnected?i:null))?.focus({preventScroll:!0})})})}if(o&&!o.fullMap&&this.state.fullMap&&this.updateComplete.then(()=>{let i=this.#o;requestAnimationFrame(()=>{(this.renderRoot.querySelector(".workspace-toggle")??(i?.isConnected?i:null))?.focus({preventScroll:!0})})}),!o?.dialog&&this.state.dialog){let i=wr(this.shadowRoot||document);i?.hasAttribute("data-dialog-launcher")&&(this.#s=i),this.updateComplete.then(()=>{(this.renderRoot.querySelector(".dialog [data-dialog-initial-focus]")??this.renderRoot.querySelector(".dialog button"))?.focus()})}else if(o?.dialog&&!this.state.dialog){o.dialog==="discardDraft"&&(this.#d=null,this.#N());let i=this.#s?.isConnected&&this.#s.hasAttribute("data-dialog-launcher")?this.#s:this.#re(o.dialog);this.#s=null,this.updateComplete.then(()=>{requestAnimationFrame(()=>i?.focus({preventScroll:!0}))})}o?o.workflow!==this.state.workflow&&(this._sheetDetent=In[this.state.workflow],this.updateComplete.then(()=>this.#l())):this._sheetDetent=In[this.state.workflow]}}#l(){let e=this.renderRoot.querySelector(".panel-heading h2");if(ft(e)){e.focus({preventScroll:!0});return}let n=this.renderRoot.querySelector(".action-bar .ms-btn--primary");ft(n)&&n.focus({preventScroll:!0})}#A(){let e=this.renderRoot.querySelector(".draw-brush");return ft(e)?e:this.renderRoot.querySelector(we)?.shadowRoot?.querySelector(".draw-brush")??null}#i(e){if(V(this.state,e)){this.#d=e,this.#i({type:"open-dialog",dialog:"discardDraft"});return}this.dispatchEvent(new CustomEvent(ue,{detail:e,bubbles:!0,composed:!0}))}#x(e){if(e.enabled){if(e.id==="return-live"){this.#i({type:"set-history",historyId:null});return}if(e.id==="clear-draft"){this.#i({type:"clear-draft"});return}this.#S(e.id)}}#h(e,n){let r={type:"open-workflow",workflow:e};n instanceof HTMLElement&&V(this.state,r)&&(this.#s=n),this.#i(r)}#_(){let e=this.#d;this.#d=null,e?.type==="select-plan"||e?.type==="select-area"?(this.#i({type:"patch-plan-draft",patch:{dirty:!1}}),this.#i({type:"patch-area-draft",patch:{dirty:!1}}),this.#i({type:"dismiss-top-layer"})):this.#i({type:"discard-draft"}),e&&e.type!=="dismiss-top-layer"&&queueMicrotask(()=>this.dispatchEvent(new CustomEvent(ue,{detail:e,bubbles:!0,composed:!0})))}#v(){this.#d=null,this.#c(),this.#N()}#N(){this.updateComplete.then(()=>{let e=this.renderRoot.querySelector(".floor-switcher");e&&(e.value=this.state.selection.floorId);let n=this.renderRoot.querySelector(".robot-switcher");n&&(n.value=this.state.selection.entryId??"")})}#c(){let e=this.state.dialog,n=e&&this.#s?.isConnected&&this.#s.hasAttribute("data-dialog-launcher")?this.#s:e?this.#re(e):null;this.#i({type:"dismiss-top-layer"}),n&&requestAnimationFrame(()=>n.focus({preventScroll:!0}))}#S(e){this.dispatchEvent(new CustomEvent(Ft,{detail:typeof e=="string"?{id:e}:e,bubbles:!0,composed:!0}))}#u(e){this.#i({type:"dismiss-top-layer"}),this.#S(e)}#I(e){if(e.action==="discard"){this.#_();return}if(e.action==="delete-plan"||e.action==="delete-area"){this.#u(e.action);return}if(e.action==="reset-room-cadence"){let n=this.state.cadenceResetRequest;this.#i({type:"dismiss-top-layer"}),n&&this.#S({id:"reset-room-cadence",planId:n.planId,roomId:n.roomId,mode:n.mode});return}this.#i({type:"dismiss-top-layer"}),e.action==="stop"&&this.#S("stop")}#f(e){e!==this._sheetDetent&&(this._sheetDetent=e,this._announcement=this.#e("v4_workspace_height","Map workspace, {height} height",{height:e}))}#T(e,n=!1){let o=K.indexOf(this._sheetDetent)+e;n&&o>=K.length&&(o=0),o=Math.max(0,Math.min(K.length-1,o)),this.#f(K[o]??this._sheetDetent)}#E(e){let n=this.renderRoot.querySelector(".workspace")?.clientHeight??e.parentElement?.clientHeight??e.offsetHeight,r=parseFloat(getComputedStyle(this).fontSize)||16,o=[".sheet-grip",".sheet-tools",".action-bar"].map(c=>e.querySelector(c)?.offsetHeight??0).reduce((c,l)=>c+l,0)+r*.75,i=Math.min(n*.92,n-r*9),a=Math.min(n*.48,r*26,i);return{peek:Math.min(o,a),half:a,full:i}}#C(){return this.renderRoot.querySelector(".mobile-sheet")}#H(e){let n=e.currentTarget;for(let r of e.composedPath()){if(r===n)return!1;if(r instanceof Element&&r.matches(yr))return!0}return!1}#y(e){if(e.pointerType==="mouse"&&e.button!==0||this.#H(e))return;let n=this.#C();!n||this.#b||(this.#b={pointerId:e.pointerId,startY:e.clientY,startHeight:n.offsetHeight,heights:this.#E(n),samples:[{y:e.clientY,t:e.timeStamp}],moved:!1},e.currentTarget.setPointerCapture(e.pointerId),n.classList.add("dragging"))}#$(e){let n=this.#b;if(!n||e.pointerId!==n.pointerId)return;let r=this.#C();if(!r)return;let o=e.clientY-n.startY;for(!n.moved&&Math.abs(o)>fr&&(n.moved=!0),n.samples.push({y:e.clientY,t:e.timeStamp});n.samples.length>2&&e.timeStamp-(n.samples[1]?.t??0)>mr;)n.samples.shift();if(!n.moved)return;let i=n.startHeight-n.heights.full,a=n.startHeight-n.heights.peek,c=Math.max(i,Math.min(a,o));r.style.transform=`translateY(${c}px)`}#z(e){let n=this.#b;if(!n||e.pointerId!==n.pointerId)return;this.#b=null;let r=this.#C();if(r&&(r.style.transform="",r.classList.remove("dragging")),e.type==="pointercancel")return;if(!n.moved){this.#T(1,!0);return}let o=e.clientY-n.startY,i=K.indexOf(this._sheetDetent),a=n.samples[0],c=n.samples[n.samples.length-1],l=a&&c&&c!==a?(c.y-a.y)/Math.max(1,c.t-a.t):0;if(Math.abs(l)>pr){let m=Math.max(0,Math.min(K.length-1,i+(l<0?1:-1)));this.#f(K[m]??this._sheetDetent);return}let d=n.startHeight-o,u=this._sheetDetent,h=Number.POSITIVE_INFINITY;for(let m of K){let v=Math.abs(n.heights[m]-d);v<h&&(h=v,u=m)}this.#f(u)}#L(e){if(e.pointerType==="mouse"||this.#H(e))return;let n=e.currentTarget;this.#p={pointerId:e.pointerId,startY:e.clientY,atTop:n.scrollTop===0,consumed:!1}}#O(e){let n=this.#p;if(!n||n.consumed||!n.atTop||e.pointerId!==n.pointerId)return;if(e.currentTarget.scrollTop>0){this.#p=null;return}e.clientY-n.startY<vr||(n.consumed=!0,this.#T(-1))}#F(){this.#p=null}#Q(){this.dispatchEvent(new CustomEvent("hass-toggle-menu",{bubbles:!0,composed:!0}))}#K(e){this.#o=e.currentTarget,this.#i({type:this.state.fullMap?"exit-full-map":"enter-full-map"})}#W(e){this._overflowOpen=!1,e&&this.updateComplete.then(()=>{this.renderRoot.querySelector(".overflow")?.focus()})}#B(e){if(this.#W(e==="fullscreen"),e==="support"){this.#h("support");return}let n=this.renderRoot.querySelector(".app");this.#P()?document.exitFullscreen():n?.requestFullscreen()}#J(){this.#i({type:"set-precision-open",value:!this.state.precisionOpen})}#U(e){this.#r=e.currentTarget,this._helpOpen=!0}#Y(e){let n=e;if(!ye(n.detail))return;if(V(this.state,n.detail)){e.stopPropagation(),this.#i(n.detail);return}if(n.detail?.type!=="open-dialog")return;let r=n.composedPath().find(o=>o instanceof HTMLElement&&o.hasAttribute("data-dialog-launcher"));r instanceof HTMLElement&&(this.#s=r)}#re(e){return this.renderRoot.querySelector(le)?.shadowRoot?.querySelector(`[data-dialog-launcher="${e}"]`)??null}#oe(e){if(!Wt(e)&&!(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey)&&e.key==="Escape"){if(e.preventDefault(),this._overflowOpen){this.#W(!0);return}if(this._helpOpen){this._helpOpen=!1;return}if(this.state.dialog==="discardDraft"){this.#v();return}this.#i({type:"dismiss-top-layer"})}}#se(e){if(e.key!=="Tab")return;let r=[...e.currentTarget.querySelectorAll(gr)],o=r[0],i=r.at(-1);if(!o||!i)return;let a=this.shadowRoot?.activeElement;e.shiftKey&&a===o?(e.preventDefault(),i.focus()):!e.shiftKey&&a===i&&(e.preventDefault(),o.focus())}#V(){let e=this.renderRoot.querySelector(we);(e?.shadowRoot?.querySelector(".map-root")??e)?.focus()}#R(){this._sheetDetent==="peek"&&this.#C()&&this.#f("half"),this.updateComplete.then(()=>this.#l())}#g(e,n,r){if(e.id==="choose-cleaning")return _;let o=e.labelKey?this.#e(e.labelKey,e.label):e.label,i=!e.enabled&&e.reason?e.reasonKey?this.#e(e.reasonKey,e.reason):e.reason:null,a=e.id==="stop";return w`
      <button
        class=${`${n} ${e.kind==="danger"?"ms-btn--danger":""}`}
        type="button"
        aria-disabled=${e.enabled?_:"true"}
        aria-describedby=${i?r:_}
        aria-label=${a?this.#e("v4_stop_cleaning_label","Stop cleaning"):_}
        @click=${()=>this.#x(e)}
      >${o}</button>
      ${i?w`<p class="action-reason" id=${r}>${i}</p>`:_}
    `}#M(e){let n=e.resources.plans.value?.rooms??e.resources.areas.value?.rooms??[];return e.selection.roomIds.map(r=>n.find(o=>o.roomId===r)?.name??r)}#Z(e,n,r){let o=n?.enabled&&e.workflow==="rooms"&&n.id==="clean-rooms"?[this.#M(e).join(", "),e.planDraft.returnToBase?this.#e("v4_returns_to_dock","returns to the dock"):""].filter(Boolean).join(" \xB7 "):"";return w`
      <div class="action-bar">
        ${o?w`<p class="action-summary">${o}</p>`:_}
        ${n?this.#g(n,"ms-btn ms-btn--block ms-btn--lg ms-btn--primary","primary-reason"):_}
        ${r?this.#g(r,"ms-btn ms-btn--block ms-btn--lg ms-btn--secondary","secondary-reason"):_}
      </div>
    `}#D(e,n,r=_){return w`
      <div class="host-state">
        <h3>${e}</h3>
        <p>${n}</p>
        ${r}
      </div>
    `}#ee(e,n,r,o,i=!1){return w`
      <button
        class="ms-row"
        type="button"
        aria-disabled=${i?"true":_}
        @click=${()=>{i||r()}}
      >
        <span class="ms-row__lead">${A(n)}</span>
        <span class="ms-row__body"><strong>${e}</strong>${o?w`<small>${o}</small>`:_}</span>
        <span class="ms-row__trail">${A(Se)}</span>
      </button>
    `}#te(e){let n=e.resources.history.value?.floors||[],r=n.length?n.map((o,i)=>({id:o.active?"current":o.id,label:`${o.label||(o.active?this.#e("v4_current_floor","Current floor"):this.#e("v4_saved_floor","Saved floor {number}",{number:o.ordinal??i+1}))}${!o.active&&o.snapshots.length===0?` \xB7 ${this.#e("v4_floor_not_captured","Visit floor to capture")}`:""}`,disabled:!o.active&&o.snapshots.length===0})):[{id:e.selection.floorId,label:e.floor.displayName,disabled:!1}];return w`
      <select
        class="ms-select context-switcher floor-switcher"
        slot="floor"
        data-map-control
        name="map-floor"
        aria-label=${this.#e("v4_choose_floor","Choose floor")}
        ?disabled=${r.length<=1}
        .value=${e.selection.floorId}
        @change=${o=>this.#i({type:"set-floor",floorId:o.currentTarget.value})}
      >${r.map(o=>w`
        <option value=${o.id} ?selected=${o.id===e.selection.floorId} ?disabled=${o.disabled}>${o.label}</option>
      `)}</select>
    `}#ae(e,n){let r=(y,S,C)=>this.#e(y,S,C),o=this.#ee(r("v4_map_history","Map history"),et,()=>this.#h("history"),r("v4_map_history_detail","Saved maps are floor-scoped and read only.")),i=this.#ee(r("v4_map_diagnostics","Map diagnostics"),qt,()=>this.#h("support"),r("v4_map_support_detail","Private geometry is never included.")),{host:a}=e;if(!a.connected)return this.#D(r("v4_reconnecting_title","Reconnecting to Home Assistant"),r("v4_reconnecting_body","The last verified map stays read-only until the connection returns."));if(!a.administrator)return this.#D(r("v4_admin_title","Administrator access required"),r("v4_admin_body","Ask a Home Assistant administrator to open this map."));if(a.robotCount===0)return this.#D(r("v4_no_robot_title","No Matic robot set up"),r("v4_no_robot_body","Add the Matic integration to see a map here."),w`<a class="ms-btn ms-btn--secondary" href="/config/integrations/integration/matic_robot">${r("v4_open_integration","Open the Matic integration")}</a>`);if(!a.robotConnected)return w`
        ${this.#D(r("v4_robot_offline_title","Robot offline"),r("v4_robot_offline_body","Showing the last verified map. Cleaning is unavailable until the robot reconnects."))}
        <h3 class="shelf-heading">${r("v4_more","Map tools")}</h3>
        <div class="shelf">${o}${i}</div>
      `;if(Tn(e))return w`
        <h3 class="shelf-heading">${r("v4_more","Map tools")}</h3>
        <div class="shelf">
          ${o}
          ${i}
        </div>
      `;let c=e.coherence==="verifying"||e.coherence==="booting",l=e.resources.plans,d=l.value,u=d!==null&&d.rooms.length===0,h=d?.plans.length??0,m=l.status==="loading",v=l.status==="error",g=c||u,k=c?r("v4_reason_locating","Waiting for the robot to confirm which floor it is on."):u?r("v4_no_rooms_reason","This floor has no named rooms yet."):null,b=c?r("v4_reason_locating","Waiting for the robot to confirm which floor it is on."):null,R=c?r("v4_reason_locating","Waiting for the robot to confirm which floor it is on."):r("v4_areas_quick_detail","Create or choose a saved area");return w`
      ${e.activity==="problem"?this.#D(r("v4_attention_title","The robot needs attention"),r("v4_attention_body","Check the robot, then start a new task.")):w`
          <div class="quick-actions" aria-label=${r("v4_cleaning_choices","Cleaning choices")}>
            <button
              class="ms-row ms-row--card ms-row--featured"
              type="button"
              aria-disabled=${g?"true":_}
              @click=${()=>{g||this.#h("rooms")}}
            >
              <span class="ms-row__lead">${A(de)}</span>
              <span class="ms-row__body">
                <strong>${r("v4_clean_rooms","One-time clean")}</strong>
                <small>${k??r("v4_clean_rooms_hint","Choose rooms for this run")}</small>
              </span>
              <span class="ms-row__trail">${A(Se)}</span>
            </button>
            <button
              class="ms-row ms-row--card"
              type="button"
              aria-disabled=${c?"true":_}
              @click=${()=>{c||this.#h("plans")}}
            >
              <span class="ms-row__lead">${A(tt)}</span>
              <span class="ms-row__body">
                <strong>${m?r("v4_plans_loading","Checking saved plans"):v?r("v4_plans_unavailable","Plans unavailable"):h?r("v4_run_a_plan","Run a plan"):r("v4_create_plan","Create a plan")}</strong>
                <small>${b??(m?r("v4_plans_loading_hint","Reading routines for this floor"):v?r("v4_plans_unavailable_hint","Try again to load saved routines"):h?h===1?r("v4_saved_routine","1 saved routine"):r("v4_saved_routines","{count} saved routines",{count:h}):r("v4_no_plans_hint","Save a room routine you can repeat"))}</small>
              </span>
              <span class="ms-row__trail">${A(Se)}</span>
            </button>
          </div>
        `}
      <h3 class="shelf-heading">${r("v4_more","Map tools")}</h3>
      <div class="shelf">
        ${this.#ee(r("v4_custom_areas","Clean a custom area"),Dt,()=>this.#h("draw"),R,c)}
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
            @click=${this.#U}
          >${r("v4_how_to_move","How to move the map")}</button>
        </div>
      `:_}
    `}#X(e,n){return e.workflow==="none"?this.#ae(e,n):customElements.get(le)?w`<${Mn}
      .state=${e}
      .localize=${this.localize}
      @matic-workspace-intent=${this.#Y}
    ></${Mn}>`:(this.#j(),this._workflowLoadFailed?w`<div class="workflow-loading" role="alert">
          <p>${this.#e("v4_workflow_load_failed","Workspace tools could not be loaded.")}</p>
          <button class="ms-btn ms-btn--secondary" @click=${this.#ie}>
            ${this.#e("v4_retry","Try again")}
          </button>
        </div>`:w`<div class="workflow-loading" role="status" aria-live="polite">
        ${this.#e("v4_workflow_loading","Loading workspace tools\u2026")}
      </div>`)}#j(){this.#m||customElements.get(le)||(this._workflowLoadFailed=!1,this.#m=import("./workflow-panel-XUUBUCQJ.js").then(()=>{this.#m=null,this.requestUpdate()}).catch(()=>{this.#m=null,this._workflowLoadFailed=!0}))}#ie;#G(e,n){let r=An(e,this.localize);return w`
      <div class="panel-heading">
        ${e.workflow!=="none"?w`
          <button
            class="panel-back ms-btn ms-btn--secondary"
            type="button"
            aria-label=${e.workflow==="plan"?this.#e("v4_back_to_plans","Back to plans"):this.#e("v4_back_to_all_tasks","Back to all tasks")}
            data-dialog-launcher="discardDraft"
            @click=${o=>this.#h(e.workflow==="plan"?"plans":"none",o.currentTarget)}
          >${A(ke)}<span class="ms-btn__label">${e.workflow==="plan"?this.#e("v4_your_plans","Your plans"):this.#e("v4_all_tasks","All tasks")}</span></button>
        `:_}
        <h2 tabindex="-1">${r.title}</h2>
      </div>
      <p class="panel-description">${r.description}</p>
      ${this.#X(e,n)}
    `}#le(e,n){let o=An(e,this.localize).title;return e.workflow==="rooms"&&e.selection.roomIds.length&&(o=`${this.#e("v4_rooms_selected","Rooms selected: {count}",{count:e.selection.roomIds.length})} \xB7 ${this.#M(e).join(", ")}`),this._sheetDetent!=="peek"?n.detail?`${n.title} \xB7 ${n.detail}`:n.title:n.notable?`${n.title} \xB7 ${o}`:o}#ce(){let e=(n,r)=>this.#e(n,r);return w`
      <div class="dialog-backdrop" @click=${n=>{n.target===n.currentTarget&&(this._helpOpen=!1)}}>
        <section
          class="dialog help-dialog ms-surface ms-surface--overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-title"
          @keydown=${this.#se}
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
    `}render(){let e=this.state,n=e.narrowHint||this._measuredNarrow,r=hr(e,this.localize),o=Ct({...e,narrowHint:n}),i=Pt(e),a=!n&&o.id==="stop"?o:!n&&i?.id==="stop"?i:null,c=a&&a===o?null:o,l=e.workflow==="draw"&&e.dataMode==="live"?{id:"clear-draft",label:"Clear drawing",labelKey:"v4_clear_drawing",kind:"neutral",enabled:e.draw.circles.length>0||!!e.draw.outline?.points.length}:null,d=a&&a===i?null:i??l,u=e.fullMap&&(e.coherence==="verifying"||e.coherence==="booting"),h=e.fullMap||e.host.administrator&&e.host.robotCount>0&&e.map.available,m=e.cadenceResetRequest?e.resources.plans.value?.rooms.find(y=>y.roomId===e.cadenceResetRequest?.roomId):void 0,v=e.cadenceResetRequest?e.resources.plans.value?.plans.find(y=>y.id===e.cadenceResetRequest?.planId)?.rooms.find(y=>y.roomId===e.cadenceResetRequest?.roomId):void 0,g=br(e.dialog,this.localize,e.workflow==="plan",m?.name||e.cadenceResetRequest?.roomId||"room",v?.cadence?.scope==="shared",e.cadenceResetRequest?.mode),k=n&&!e.fullMap?`--map-sheet-offset:${this._sheetOffset}px`:"--map-sheet-offset:0px",b=n&&e.workflow==="draw",R=e.precisionOpen&&e.workflow==="draw";return w`
      <div class=${`root ${n?"narrow":"wide"}`} @keydown=${this.#oe}>
        <button class="skip-link ms-btn ms-btn--primary" type="button" @click=${this.#V}>${this.#e("v4_skip_to_map","Skip to the map")}</button>
        <button class="skip-link ms-btn ms-btn--primary" type="button" @click=${this.#R}>${this.#e("v4_skip_to_workspace","Skip to the map workspace")}</button>
        <div class="app" ?inert=${!!g||this._helpOpen}>
          <header class="app-bar">
            ${e.precisionOpen?_:w`
              <button
                class="nav nav--menu ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#e("v4_open_navigation","Open Home Assistant sidebar")}
                title=${this.#e("v4_open_navigation","Open Home Assistant sidebar")}
                @click=${this.#Q}
              >${A(Tt)}</button>
            `}

            ${e.precisionOpen?w`
              <button
                class="nav ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#e("v4_back","Back")}
                @click=${()=>this.#i({type:"dismiss-top-layer"})}
              >${A(ke)}</button>
            `:_}
            <h1 class="title">${this.#e("map_studio_title","Matic Map")}</h1>
            ${e.robots.length>1?w`
              <select
                class="ms-select context-switcher robot-switcher"
                name="matic-robot"
                aria-label=${this.#e("v4_choose_robot","Choose robot")}
                .value=${e.selection.entryId||""}
                @change=${y=>this.#i({type:"select-entry",entryId:y.currentTarget.value})}
              >${e.robots.map(y=>w`
                <option value=${y.entryId} ?selected=${y.entryId===e.selection.entryId}>${y.label}</option>
              `)}</select>
            `:_}

            <span class="spacer"></span>
            ${h?w`
              <button
                class="workspace-toggle ms-btn ms-btn--icon"
                type="button"
                aria-label=${e.fullMap?this.#e("v4_show_workspace","Show cleaning panel"):this.#e("v4_hide_workspace","Hide cleaning panel")}
                aria-controls="map-workspace"
                aria-expanded=${String(!e.fullMap)}
                title=${e.fullMap?this.#e("v4_show_workspace","Show cleaning panel"):this.#e("v4_hide_workspace","Hide cleaning panel")}
                @click=${this.#K}
              >${A($t)}</button>
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
              ${this._overflowOpen?w`
                <div id="map-options" class="overflow-menu ms-surface ms-surface--overlay">
                  <label class="overflow-field ms-field">${this.#e("map_quality_label","Scene detail")}
                    <select
                      aria-label=${this.#e("map_quality_label","Scene detail")}
                      .value=${e.quality}
                      @change=${y=>this.#i({type:"set-quality",quality:y.currentTarget.value})}
                    >
                      <option value="auto">${this.#e("map_quality_auto","Auto detail")}</option>
                      <option value="efficient">${this.#e("map_quality_efficient","Efficient")}</option>
                      <option value="balanced">${this.#e("map_quality_balanced","Balanced")}</option>
                      <option value="maximum">${this.#e("map_quality_maximum","Maximum")}</option>
                    </select>
                  </label>
                  <button class="ms-row ms-row--menu" type="button" @click=${()=>this.#B("support")}>${this.#e("v4_map_diagnostics","Map diagnostics")}</button>
                  <button class="ms-row ms-row--menu" type="button" @click=${()=>this.#B("fullscreen")}>${this._browserFullscreen?this.#e("v4_leave_full_screen","Leave full screen"):this.#e("v4_full_screen","Full screen")}</button>
                </div>
              `:_}
            </div>
          </header>

          <main class=${`workspace ${e.fullMap?"full-map":""}`} style=${k}>
            <div class="canvas">
              <${En}
                class="map-canvas"
                style=${k}
                .state=${e}
                .localize=${this.localize}
                .narrow=${n}
              >${this.#te(e)}
                ${n&&!e.fullMap&&this._sheetDetent==="full"?w`
                  <button
                    class="sheet-scrim"
                    slot="scrim"
                    data-map-control
                    type="button"
                    aria-label=${this.#e("v4_collapse_sheet","Collapse the map workspace")}
                    @click=${()=>this.#f("peek")}
                  ></button>
                `:_}
              </${En}>
              ${!n&&R?w`
                <div class="precision-popover">
                  <${We} compact .state=${e} .localize=${this.localize}></${We}>
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
                  @pointerdown=${this.#y}
                  @pointermove=${this.#$}
                  @pointerup=${this.#z}
                  @pointercancel=${this.#z}
                >
                  <span class="sheet-handle" role="presentation"></span>
                  ${e.workflow!=="none"&&this._sheetDetent==="peek"?w`
                    <button
                      class="sheet-back ms-btn ms-btn--icon ms-btn--sm"
                      type="button"
                      aria-label=${e.workflow==="plan"?this.#e("v4_back_to_plans","Back to plans"):this.#e("v4_back_to_all_tasks","Back to all tasks")}
                      title=${e.workflow==="plan"?this.#e("v4_back_to_plans","Back to plans"):this.#e("v4_back_to_all_tasks","Back to all tasks")}
                      data-dialog-launcher="discardDraft"
                      @click=${y=>this.#h(e.workflow==="plan"?"plans":"none",y.currentTarget)}
                    >${A(ke)}</button>
                  `:_}
                  <span class="sheet-status">${this.#le(e,r)}</span>
                  <button
                    class="ms-btn ms-btn--icon ms-btn--sm"
                    type="button"
                    aria-label=${this.#e("v4_show_more","Show more of the map workspace")}
                    aria-controls="sheet-body"
                    aria-disabled=${this._sheetDetent==="full"?"true":_}
                    @click=${()=>this.#T(1)}
                  >${A(Lt)}</button>
                  <button
                    class="ms-btn ms-btn--icon ms-btn--sm"
                    type="button"
                    aria-label=${this.#e("v4_show_less","Show less of the map workspace")}
                    aria-controls="sheet-body"
                    aria-disabled=${this._sheetDetent==="peek"?"true":_}
                    @click=${()=>this.#T(-1)}
                  >${A(Ot)}</button>
                </div>
                ${b?w`
                  <div class="sheet-tools">
                    ${zt(e,{intent:y=>this.#i(y),openBrush:()=>this.#J(),t:(y,S)=>this.#e(y,S)},"grid")}
                    ${R?w`
                      <div class="precision-popover">
                        <${We} compact inline .state=${e} .localize=${this.localize}></${We}>
                      </div>
                    `:_}
                  </div>
                `:_}
                <div
                  class="sheet-body"
                  id="sheet-body"
                  @pointerdown=${this.#L}
                  @pointermove=${this.#O}
                  @pointerup=${this.#F}
                  @pointercancel=${this.#F}
                >
                  ${this.#G(e,n)}
                </div>
                ${this.#Z(e,c,d)}
              `:w`
                <div class="status-strip">
                  <span class="status-icon" aria-hidden="true">${A(r.icon)}</span>
                  <span class="status-copy"><strong>${r.title}</strong><small>${r.detail}</small></span>
                  ${a?this.#g(a,"status-action ms-btn ms-btn--secondary","status-reason"):_}
                </div>
                <section class="workflow">
                  <div class="workflow-body">${this.#G(e,n)}</div>
                  ${this.#Z(e,c,d)}
                </section>
              `}
            </aside>

            ${e.fullMap?w`
              <section
                class=${`full-map-hud ms-surface ms-surface--floating ${i?"has-secondary":""} ${!n&&(e.workflow==="draw"||e.workflow==="rooms"&&e.selection.roomIds.length>0)?"above-dock":""}`}
                aria-label="Robot status and action"
              >
                <span class="hud-copy"><strong>${r.title}</strong><small>${r.detail}</small></span>
                ${u&&o.id!=="stop"?_:this.#g(o,"ms-btn ms-btn--lg ms-btn--primary","hud-reason")}
                ${i&&(!u||i.id==="stop")?this.#g(i,"ms-btn ms-btn--lg ms-btn--secondary","hud-secondary-reason"):_}
              </section>
            `:_}
          </main>
        </div>

        <div class="sr-only" aria-live="polite" aria-atomic="true">${[this._announcement,e.notice?.text??""].filter(Boolean).join(" ")}</div>

        ${this._helpOpen?this.#ce():_}

        ${g?w`
          <div class="dialog-backdrop">
            <section
              class="dialog ms-surface ms-surface--overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="dialog-title"
              aria-describedby="dialog-detail"
              @keydown=${this.#se}
            >
              <h2 id="dialog-title">${g.title}</h2>
              <p id="dialog-detail">${g.detail}</p>
              <div class="dialog-actions">
                <button
                  class="ms-btn ms-btn--secondary"
                  type="button"
                  data-dialog-initial-focus
                  @click=${e.dialog==="discardDraft"?this.#v:this.#c}
                >${g.cancelLabel}</button>
                ${g.action===null?_:w`
                  <button
                    class="discard ms-btn ms-btn--primary ms-btn--danger"
                    type="button"
                    @click=${()=>this.#I(g)}
                  >${g.confirmLabel}</button>
                `}
              </div>
            </section>
          </div>
        `:_}
      </div>
    `}};customElements.get(ce)||customElements.define(ce,vt);var $n=J(ce),yt=class extends Y{constructor(){super(...arguments);this.narrow=!1;this._workspace=D();this.entryOverride=null;this.#e=new Re;this.#t=new kt(this._workspace);this.#n=null;this.#a=null;this.#s=null;this.#o=null;this.#r=null}static{this.styles=[X,G,j`
:host { display: block; block-size: 100%; }
`]}static{this.properties={hass:{attribute:!1},narrow:{type:Boolean},route:{attribute:!1},panel:{attribute:!1},_workspace:{state:!0},entryOverride:{state:!0}}}#e;#t;#n;#a;#s;#o;#r;shouldUpdate(e){if(!e.has("hass")||[...e.keys()].some(r=>r!=="hass"))return!0;let n=e.get("hass");return n?.connection!==this.hass?.connection||n?.localize!==this.hass?.localize?!0:this.#e.project(this.hass,this.panel,this.entryOverride)!==this.#n}connectedCallback(){super.connectedCallback(),this.#a=this.#t.subscribe(e=>{this._workspace=e}),this.#d()}disconnectedCallback(){this.#a?.(),this.#a=null,this.#m(),super.disconnectedCallback()}#d(){if(!(!this.isConnected||this.#o)&&(this.#n=this.#e.project(this.hass,this.panel,this.entryOverride),this.#s=new Te(()=>this.hass),this.#o=new Ne(this.#t,this.#s,this.hass?.connection??null),this.#r=new ze(this.#t),this.#r.start(),this.#n)){this.#o.sync(this.#n,this.panel);let{host:e}=this.#n;e.connected&&e.administrator&&e.robotCount>0&&this.#o.refreshCatalog(this.#t.value.selection.floorId==="current")}}#m(){this.#r?.dispose(),this.#r=null,this.#o?.dispose(),this.#o=null,this.#s=null}willUpdate(e){if(e.has("hass")||e.has("panel")||e.has("entryOverride")){let n=e.get("hass"),r=e.has("hass")&&n?.connection!==this.hass?.connection,o=this.#e.project(this.hass,this.panel,this.entryOverride),i=o!==this.#n;i&&(this.#n=o),r?(this.#m(),this.#d()):(i||e.has("panel")||e.has("entryOverride"))&&this.#o?.sync(o,this.panel)}e.has("narrow")&&this.#t.value.narrowHint!==this.narrow&&this.#t.dispatch({type:"set-narrow-hint",value:this.narrow})}#b(e){if(!ye(e.detail))return;e.stopPropagation();let n=e.detail;if(n.type==="dismiss-top-layer"||n.type==="exit-full-map"){this.#r?.dismissTop()||this.#t.dispatch(n);return}if(n.type==="open-workflow"&&n.workflow!=="none"){this.#o?.openWorkflow(n.workflow);return}if(n.type==="set-floor"){this.#o?.selectFloor(n.floorId);return}if(n.type==="select-entry"){if(!this._workspace.robots.some(r=>r.entryId===n.entryId))return;this.entryOverride=n.entryId;return}if(n.type==="set-history"){this.#o?.selectHistory(n.historyId);return}if(n.type==="select-plan"){this.#o?.selectPlan(n.planId);return}if(n.type==="select-area"){this.#o?.selectArea(n.areaId),n.workflow==="areaReview"&&this.#o?.openWorkflow("areaReview");return}this.#t.dispatch(n)}#p(e){e.stopPropagation(),typeof e.detail?.id=="string"&&(e.detail.id==="reset-room-cadence"&&"planId"in e.detail&&"roomId"in e.detail&&"mode"in e.detail?this.#o?.executeAction(e.detail):this.#o?.executeAction(e.detail.id),this.dispatchEvent(new CustomEvent("matic-map-v4-action-requested",{detail:{id:e.detail.id},bubbles:!0,composed:!0})))}getWorkspaceSnapshot(){return this.#t.value}render(){return w`
      <${$n}
        .state=${this._workspace}
        .localize=${this.hass?.localize}
        @matic-workspace-intent=${this.#b}
        @matic-workspace-action=${this.#p}
      ></${$n}>
    `}};customElements.get(Ze)||customElements.define(Ze,yt);export{Re as a,J as b,w as c,yt as d};
/*! Bundled license information:

lit-html/static.js:
  (**
   * @license
   * Copyright 2020 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/
