const MATIC_SCENE_HEADER_BYTES = 24;
const MATIC_SCENE_POINT_STRIDE = 8;
const MATIC_SCENE_MAX_POINTS = 1500000;
const MATIC_MAP_CATALOG_URL = "/api/matic_robot/slam_entries";
const MATIC_MAP_PREFERENCES_VERSION = 3;
const MATIC_CATALOG_REQUEST_TIMEOUT_MS = 10000;
const MATIC_SCENE_REQUEST_TIMEOUT_MS = 20000;
const MATIC_DELTA_REQUEST_TIMEOUT_MS = 30000;
const MATIC_HISTORY_REQUEST_TIMEOUT_MS = 15000;
const MATIC_POSE_REQUEST_TIMEOUT_MS = 10000;
const MATIC_FALLBACK_IMAGE_TIMEOUT_MS = 15000;
const MATIC_MAP_QUALITY_BUDGETS = Object.freeze({
  efficient: 300000,
  balanced: 750000,
  maximum: MATIC_SCENE_MAX_POINTS,
});
const MATIC_CAMERA_STORED_ZOOM_MIN = 0.01;
const MATIC_CAMERA_STORED_ZOOM_MAX = 100;

function maticClamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function maticAngleDelta(value) {
  let angle = value;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function maticRoomBoundaryPoints(points) {
  const boundary = [];
  for (const point of points) {
    if (
      !Array.isArray(point)
      || point.length !== 2
      || !point.every(Number.isFinite)
    ) continue;
    const previous = boundary.at(-1);
    if (previous?.[0] === point[0] && previous?.[1] === point[1]) continue;
    boundary.push([point[0], point[1]]);
  }
  return boundary;
}

function maticSparseRoomBoundary(points) {
  const boundary = maticRoomBoundaryPoints(points);
  if (boundary.length < 4) return boundary;

  const orientation = (first, second, third) =>
    (second[0] - first[0]) * (third[1] - first[1])
    - (second[1] - first[1]) * (third[0] - first[0]);
  const crosses = (first, second, third, fourth) => {
    const one = orientation(first, second, third);
    const two = orientation(first, second, fourth);
    const three = orientation(third, fourth, first);
    const four = orientation(third, fourth, second);
    return one * two < -1e-9 && three * four < -1e-9;
  };

  const maximumPasses = boundary.length * boundary.length;
  for (let pass = 0; pass < maximumPasses; pass += 1) {
    let repaired = false;
    for (let first = 0; first < boundary.length; first += 1) {
      const firstNext = (first + 1) % boundary.length;
      for (let second = first + 2; second < boundary.length; second += 1) {
        const secondNext = (second + 1) % boundary.length;
        if (first === 0 && secondNext === 0) continue;
        if (!crosses(
          boundary[first],
          boundary[firstNext],
          boundary[second],
          boundary[secondNext],
        )) continue;
        const replacement = boundary
          .slice(firstNext, second + 1)
          .reverse();
        boundary.splice(firstNext, replacement.length, ...replacement);
        repaired = true;
        break;
      }
      if (repaired) break;
    }
    if (!repaired) break;
  }
  return boundary;
}

function maticRoomContours(points, closed = false) {
  const boundary = maticRoomBoundaryPoints(points);
  if (boundary.length < 3) return [];
  if (closed) return [{ points: boundary, closed: true }];
  if (boundary.length <= 64) {
    return [{ points: maticSparseRoomBoundary(boundary), closed: true }];
  }

  const distances = boundary.slice(1).map((point, index) =>
    Math.hypot(
      point[0] - boundary[index][0],
      point[1] - boundary[index][1],
    )).filter((distance) => distance > 1e-9).sort((left, right) => left - right);
  const typicalDistance = distances[Math.floor(distances.length / 2)] || 1;
  const maximumContinuousDistance = Math.max(3, typicalDistance * 4);
  const contours = [];
  let current = [boundary[0]];
  for (let index = 1; index < boundary.length; index += 1) {
    const point = boundary[index];
    const previous = boundary[index - 1];
    if (
      Math.hypot(point[0] - previous[0], point[1] - previous[1])
      > maximumContinuousDistance
    ) {
      if (current.length >= 3) contours.push(current);
      current = [point];
    } else {
      current.push(point);
    }
  }
  if (current.length >= 3) contours.push(current);
  return contours.map((contour) => ({
    points: contour,
    closed: Math.hypot(
      contour[0][0] - contour.at(-1)[0],
      contour[0][1] - contour.at(-1)[1],
    ) <= maximumContinuousDistance,
  }));
}

function maticEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function maticMat4Multiply(left, right) {
  const result = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let index = 0; index < 4; index += 1) {
        value += left[index * 4 + row] * right[column * 4 + index];
      }
      result[column * 4 + row] = value;
    }
  }
  return result;
}

function maticPerspective(fieldOfView, aspect, near, far) {
  const focal = 1 / Math.tan(fieldOfView / 2);
  const result = new Float32Array(16);
  result[0] = focal / aspect;
  result[5] = focal;
  result[10] = (far + near) / (near - far);
  result[11] = -1;
  result[14] = (2 * far * near) / (near - far);
  return result;
}

function maticOrthographic(left, right, bottom, top, near, far) {
  const result = new Float32Array(16);
  result[0] = 2 / (right - left);
  result[5] = 2 / (top - bottom);
  result[10] = -2 / (far - near);
  result[12] = -(right + left) / (right - left);
  result[13] = -(top + bottom) / (top - bottom);
  result[14] = -(far + near) / (far - near);
  result[15] = 1;
  return result;
}

function maticLookAt(eye, target) {
  const forwardLength = Math.hypot(
    eye[0] - target[0],
    eye[1] - target[1],
    eye[2] - target[2],
  ) || 1;
  const z = [
    (eye[0] - target[0]) / forwardLength,
    (eye[1] - target[1]) / forwardLength,
    (eye[2] - target[2]) / forwardLength,
  ];
  const rightLength = Math.hypot(z[2], z[0]) || 1;
  const x = [z[2] / rightLength, 0, -z[0] / rightLength];
  const y = [
    z[1] * x[2],
    z[2] * x[0] - z[0] * x[2],
    -z[1] * x[0],
  ];
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]),
    -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]),
    -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]),
    1,
  ]);
}

class MaticMapStudio extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._view = "three";
    this._planView = "top";
    this._quality = "maximum";
    this._scene = undefined;
    this._sceneUrl = undefined;
    this._sceneIdentity = undefined;
    this._sceneRevision = undefined;
    this._sceneEtag = undefined;
    this._sceneLoading = false;
    this._sceneAbortController = undefined;
    this._sceneRequestKey = undefined;
    this._sceneRequestUrl = undefined;
    this._latestSceneKey = undefined;
    this._latestSceneState = undefined;
    this._pendingSceneRefresh = false;
    this._pendingSceneForce = false;
    this._deltaAbortController = undefined;
    this._deltaGeneration = 0;
    this._deltaUrl = undefined;
    this._deltaRunning = false;
    this._poseLoading = false;
    this._poseAbortController = undefined;
    this._poseRequestUrl = undefined;
    this._latestPoseState = undefined;
    this._pendingPoseRefresh = false;
    this._fallbackVersion = undefined;
    this._fallbackLoader = undefined;
    this._fallbackLoadingVersion = undefined;
    this._fallbackLoadTimer = undefined;
    this._catalogEntries = [];
    this._catalogLoading = false;
    this._catalogReady = false;
    this._catalogAbortController = undefined;
    this._observedFloorCoherent = undefined;
    this._floorCoherenceGeneration = 0;
    this._areasAbortController = undefined;
    this._areas = [];
    this._areasPayload = undefined;
    this._selectedAreaId = undefined;
    this._deleteAreaConfirmation = undefined;
    this._areaBaseline = undefined;
    this._cleaningView = "plans";
    this._plansAbortController = undefined;
    this._plans = [];
    this._plansPayload = undefined;
    this._selectedPlanId = undefined;
    this._deletePlanConfirmation = undefined;
    this._planBaseline = undefined;
    this._history = [];
    this._historyUrl = undefined;
    this._historyIdentity = undefined;
    this._historyLoading = false;
    this._historyAbortController = undefined;
    this._historyRequestUrl = undefined;
    this._historyEntryId = undefined;
    this._historySceneAbortController = undefined;
    this._floors = [];
    this._selectedFloorId = "current";
    this._selectedHistoryId = undefined;
    this._stableLiveSnapshotId = undefined;
    this._stableLiveSourceIdentity = undefined;
    this._stableLiveSourceUrl = undefined;
    this._pointers = new Map();
    this._drag = undefined;
    this._pinch = undefined;
    this._gesture = undefined;
    this._lastTouchTap = undefined;
    this._doubleTapZoom = undefined;
    this._handledTouchDoubleTapAt = undefined;
    this._labelsVisible = true;
    this._preferencesIdentity = undefined;
    this._preferencesSaveTimer = undefined;
    this._savedCameras = {};
    this._viewCameras = {};
    this._cameraRestored = false;
    this._reducedMotionQuery = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    );
    this._reducedMotion = Boolean(this._reducedMotionQuery?.matches);
    this._reducedMotionHandler = (event) => {
      this._reducedMotion = event.matches;
      if (event.matches) this._cancelMotion();
    };
    this._camera = {
      yaw: -Math.PI / 4,
      pitch: 0.82,
      distance: 12,
      targetX: 0,
      targetZ: 0,
      orthographic: false,
    };
    this._radius = 8;
    this._homeThreeDistance = 12;
    this._homeTopDistance = 8;
    this._cameraAnimation = undefined;
    this._inertiaFrame = undefined;
    this._renderFrame = undefined;
    this._viewProjection = undefined;
    this._fullscreenHandler = () => {
      this._syncFullscreenLabel();
      this._resizeCanvas();
      this._requestRender();
    };
  }

  set hass(value) {
    const previousLanguage = this._hass?.language;
    const previousIdentity = this._hass?.user?.id;
    this._hass = value;
    this._loadPreferences();
    const languageChanged = previousLanguage !== undefined
      && previousLanguage !== value?.language;
    const identityChanged = previousIdentity !== undefined
      && previousIdentity !== value?.user?.id;
    if (!this.shadowRoot.hasChildNodes() || languageChanged || identityChanged) {
      try {
        this._render();
      } catch (_error) {
        // Keep the map usable if an optional browser surface aborts the full
        // render pass.  The recovery binding below still exposes the core
        // view and cleaning controls.
      }
    }
    this._bindCriticalControls();
    this._update();
  }

  set panel(value) {
    const previousEntry = this._panel?.config?.entry_id;
    this._panel = value;
    if (this.isConnected && !this.shadowRoot.hasChildNodes()) this._render();
    if (
      this.isConnected
      && previousEntry !== value?.config?.entry_id
    ) this._update();
  }

  connectedCallback() {
    this._loadPreferences();
    if (!this.shadowRoot.hasChildNodes()) {
      try {
        this._render();
      } catch (_error) {
        // See set hass(): a partial render can still be recovered below.
      }
    }
    this._bindCriticalControls();
    const viewport = this.shadowRoot.querySelector(".viewport");
    if (!this._gl) {
      this._initWebGL();
      if (this._scene) this._uploadScene(this._scene);
    }
    if (viewport) this._resizeObserver?.observe(viewport);
    document.addEventListener("fullscreenchange", this._fullscreenHandler);
    this._reducedMotionQuery?.addEventListener?.(
      "change",
      this._reducedMotionHandler,
    );
    this._refreshTimer = window.setInterval(() => this._update(), 5000);
    this._helpTimer = window.setTimeout(() => {
      const help = this.shadowRoot.querySelector(".gesture-help");
      if (help) help.hidden = true;
      this.shadowRoot.querySelector(".help")?.setAttribute(
        "aria-expanded",
        "false",
      );
    }, 9000);
    this._update(true);
  }

  disconnectedCallback() {
    window.clearInterval(this._refreshTimer);
    window.clearTimeout(this._helpTimer);
    window.cancelAnimationFrame(this._renderFrame);
    window.cancelAnimationFrame(this._inertiaFrame);
    window.cancelAnimationFrame(this._cameraAnimation);
    window.clearTimeout(this._preferencesSaveTimer);
    this._savePreferences();
    this._resizeObserver?.disconnect();
    this._cancelFallbackLoad();
    this._catalogAbortController?.abort();
    this._catalogAbortController = undefined;
    this._areasAbortController?.abort();
    this._areasAbortController = undefined;
    this._pendingSceneRefresh = false;
    this._pendingSceneForce = false;
    this._sceneAbortController?.abort();
    this._sceneAbortController = undefined;
    this._stopDeltaStream();
    this._historyAbortController?.abort();
    this._historyAbortController = undefined;
    this._historySceneAbortController?.abort();
    this._historySceneAbortController = undefined;
    this._pendingPoseRefresh = false;
    this._poseAbortController?.abort();
    this._poseAbortController = undefined;
    document.removeEventListener("fullscreenchange", this._fullscreenHandler);
    this._reducedMotionQuery?.removeEventListener?.(
      "change",
      this._reducedMotionHandler,
    );
    if (this._gl) {
      if (this._pointBuffer) this._gl.deleteBuffer(this._pointBuffer);
      if (this._pointVertexArray) {
        this._gl.deleteVertexArray(this._pointVertexArray);
      }
      if (this._pointProgram) this._gl.deleteProgram(this._pointProgram);
    }
    this._gl = undefined;
    this._webglAvailable = false;
  }

  _entities(entryId = undefined) {
    const states = Object.entries(this._hass?.states || {});
    const scoped = entryId
      ? states.filter(([, state]) =>
        state.attributes?.matic_entry_id === entryId)
      : states;
    return {
      photo: scoped.find(([, state]) =>
        state.attributes?.source === "local_robot_slam"),
      rooms: scoped.find(([, state]) =>
        state.attributes?.source === "local_room_map"),
      vacuum: scoped.find(([entityId]) => entityId.startsWith("vacuum.")),
    };
  }

  _localize(key, fallback, placeholders = undefined) {
    const translated = this._hass?.localize?.(
      `component.matic_robot.common.${key}`,
      placeholders,
    );
    if (translated) return translated;
    let result = fallback;
    for (const [name, value] of Object.entries(placeholders || {})) {
      result = result.replaceAll(`{${name}}`, String(value));
    }
    return result;
  }

  _preferencesKey() {
    const identity = String(this._hass?.user?.id || "local-user")
      .replaceAll(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 128);
    return `matic-map-studio:v${MATIC_MAP_PREFERENCES_VERSION}:${identity}`;
  }

  _legacyPreferencesKey() {
    const identity = String(this._hass?.user?.id || "local-user")
      .replaceAll(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 128);
    return `matic-map-studio:v2:${identity}`;
  }

  _loadPreferences() {
    const identity = this._preferencesKey();
    if (identity === this._preferencesIdentity) return;
    this._preferencesIdentity = identity;
    this._view = "three";
    this._planView = "top";
    this._labelsVisible = true;
    this._quality = "maximum";
    this._savedCameras = {};
    this._viewCameras = {};
    this._cameraRestored = false;
    this._camera = {
      yaw: -Math.PI / 4,
      pitch: 0.82,
      distance: 12,
      targetX: 0,
      targetZ: 0,
      orthographic: false,
    };
    try {
      const current = window.localStorage.getItem(identity);
      const parsed = JSON.parse(
        current || window.localStorage.getItem(this._legacyPreferencesKey()) || "null",
      );
      if (!parsed || typeof parsed !== "object") return;
      if (["three", "top", "rooms"].includes(parsed.view)) {
        this._view = parsed.view;
        if (["top", "rooms"].includes(parsed.view)) this._planView = parsed.view;
      }
      if (typeof parsed.labels === "boolean") {
        this._labelsVisible = parsed.labels;
      }
      if (["auto", ...Object.keys(MATIC_MAP_QUALITY_BUDGETS)].includes(
        parsed.quality,
      )) {
        this._quality = parsed.quality;
      }
      if (current) {
        for (const view of ["three", "top"]) {
          const camera = parsed.cameras?.[view];
          if (
            camera
            && ["yaw", "pitch", "zoom", "targetX", "targetZ"]
              .every((key) => Number.isFinite(camera[key]))
          ) {
            this._savedCameras[view] = {
              yaw: maticAngleDelta(camera.yaw),
              pitch: maticClamp(camera.pitch, 0.18, Math.PI / 2 - 0.018),
              zoom: maticClamp(
                camera.zoom,
                MATIC_CAMERA_STORED_ZOOM_MIN,
                MATIC_CAMERA_STORED_ZOOM_MAX,
              ),
              targetX: maticClamp(camera.targetX, -10000, 10000),
              targetZ: maticClamp(camera.targetZ, -10000, 10000),
            };
          }
        }
      }
    } catch (_error) {
      // Browsers can deny storage in private or hardened contexts.
    }
  }

  _savePreferences() {
    if (!this._preferencesIdentity) return;
    if (["three", "top"].includes(this._view)) {
      this._viewCameras[this._view] = { ...this._camera };
    }
    const cameras = {};
    for (const view of ["three", "top"]) {
      const camera = this._viewCameras[view];
      if (!camera) continue;
      const home = view === "top"
        ? this._homeTopDistance
        : this._homeThreeDistance;
      cameras[view] = {
        yaw: camera.yaw,
        pitch: camera.pitch,
        zoom: maticClamp(
          home / camera.distance,
          MATIC_CAMERA_STORED_ZOOM_MIN,
          MATIC_CAMERA_STORED_ZOOM_MAX,
        ),
        targetX: camera.targetX,
        targetZ: camera.targetZ,
      };
    }
    try {
      window.localStorage.setItem(
        this._preferencesIdentity,
        JSON.stringify({
          view: this._view,
          labels: this._labelsVisible,
          quality: this._quality,
          cameras,
        }),
      );
    } catch (_error) {
      // The map continues to work when storage is full or unavailable.
    }
  }

  _schedulePreferencesSave() {
    window.clearTimeout(this._preferencesSaveTimer);
    this._preferencesSaveTimer = window.setTimeout(
      () => this._savePreferences(),
      250,
    );
  }

  async _fetchCatalog() {
    if (this._catalogLoading) return;
    this._catalogLoading = true;
    const floorCoherenceGeneration = this._floorCoherenceGeneration;
    const controller = new AbortController();
    this._catalogAbortController = controller;
    const aborted = new Promise((_resolve, reject) => {
      controller.signal.addEventListener("abort", () => {
        reject(new DOMException("Catalog request aborted", "AbortError"));
      }, { once: true });
    });
    const timeout = window.setTimeout(
      () => controller.abort(),
      MATIC_CATALOG_REQUEST_TIMEOUT_MS,
    );
    try {
      const response = await Promise.race([
        this._authenticatedFetch(MATIC_MAP_CATALOG_URL, {
          cache: "no-store",
          signal: controller.signal,
        }),
        aborted,
      ]);
      if (!response.ok) return;
      const payload = await response.json();
      const entries = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.entries)
          ? payload.entries
          : payload?.entry_id
            ? [payload]
            : [];
      if (floorCoherenceGeneration !== this._floorCoherenceGeneration) return;
      this._catalogEntries = entries
        .filter((entry) => entry && typeof entry === "object")
        .slice(0, 64);
      this._catalogReady = true;
    } catch (_error) {
      // Older integration builds do not provide the private admin catalog.
    } finally {
      window.clearTimeout(timeout);
      if (this._catalogAbortController === controller) {
        this._catalogAbortController = undefined;
      }
      this._catalogLoading = false;
    }
  }

  _catalogState() {
    const requestedEntry = this._panel?.config?.entry_id;
    const entry = this._catalogEntries.find(
      (candidate) => candidate.entry_id === requestedEntry,
    ) || this._catalogEntries[0];
    if (!entry?.scene_url) return undefined;
    return {
      last_updated: entry.updated_at || entry.last_updated,
      attributes: {
        ...entry,
        map_revision: entry.map_revision ?? entry.revision,
      },
    };
  }

  _observeFloorCoherence(state) {
    const coherent = state?.attributes?.map_floor_coherent;
    if (typeof coherent !== "boolean") return;
    if (this._observedFloorCoherent === undefined) {
      this._observedFloorCoherent = coherent;
    } else if (coherent !== this._observedFloorCoherent) {
      this._observedFloorCoherent = coherent;
      this._floorCoherenceGeneration += 1;
    }
  }

  async _fetchHistory(state, force = false) {
    const url = state?.attributes?.history_url;
    const entryId = state?.attributes?.entry_id;
    const identity = [
      url || "",
      state?.attributes?.history_count ?? "",
      state?.attributes?.history_floor_count ?? "",
      state?.attributes?.map_revision ?? "",
      state?.attributes?.map_floor_coherent ?? "",
    ].join(":");
    if (!url) return;
    if (entryId !== this._historyEntryId) {
      this._historyAbortController?.abort();
      this._historySceneAbortController?.abort();
      this._history = [];
      this._historyUrl = undefined;
      this._historyIdentity = undefined;
      this._historyEntryId = entryId;
      this._floors = [];
      this._selectedFloorId = "current";
      this._selectedHistoryId = undefined;
      this._stableLiveSnapshotId = undefined;
      this._stableLiveSourceIdentity = undefined;
      this._stableLiveSourceUrl = undefined;
      this._syncTimeline();
    }
    if (!force && this._historyIdentity === identity) return;
    if (this._historyLoading) {
      if (!force && this._historyRequestUrl === url) return;
      this._historyAbortController?.abort();
    }
    this._historyLoading = true;
    const controller = new AbortController();
    this._historyAbortController = controller;
    this._historyRequestUrl = url;
    const timeout = window.setTimeout(
      () => controller.abort(),
      MATIC_HISTORY_REQUEST_TIMEOUT_MS,
    );
    try {
      const response = await this._authenticatedFetch(url, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) return;
      const payload = await response.json();
      if (controller.signal.aborted) return;
      const selectedWasSaved = this._selectedFloor()?.readOnly === true;
      const selectedSnapshotId = this._selectedHistoryId;
      this._floors = this._normaliseHistoryFloors(
        payload,
        state?.attributes?.map_floor_coherent !== false,
      );
      const retainedSavedFloor = selectedWasSaved && selectedSnapshotId
        ? this._floors.find((floor) =>
          floor.readOnly
          && floor.snapshots.some(
            (snapshot) => snapshot.id === selectedSnapshotId,
          ))
        : undefined;
      if (selectedWasSaved && !retainedSavedFloor) {
        this._selectedFloorId = "current";
        this._selectedHistoryId = undefined;
      } else if (retainedSavedFloor) {
        this._selectedFloorId = retainedSavedFloor.id;
      } else if (
        !this._floors.some((floor) => floor.id === this._selectedFloorId)
      ) {
        this._selectedFloorId = "current";
      }
      const selectedFloor = this._selectedFloor();
      this._history = selectedFloor?.snapshots || [];
      this._historyUrl = url;
      this._historyIdentity = identity;
      if (
        this._selectedHistoryId
        && !this._history.some(
          (snapshot) => snapshot.id === this._selectedHistoryId,
        )
      ) {
        this._selectedHistoryId = selectedFloor?.active
          ? undefined
          : this._history.at(-1)?.id;
      }
      this._syncTimeline();
      if (!selectedFloor?.active && this._selectedHistoryId) {
        const snapshot = this._history.find(
          (candidate) => candidate.id === this._selectedHistoryId,
        );
        if (snapshot && this._sceneIdentity !== `history:${snapshot.id}`) {
          this._loadHistoricalScene(snapshot);
        }
      }
    } catch (_error) {
      // The live scene remains available when timeline storage cannot be read.
    } finally {
      window.clearTimeout(timeout);
      if (this._historyAbortController === controller) {
        this._historyAbortController = undefined;
        this._historyRequestUrl = undefined;
        this._historyLoading = false;
      }
    }
  }

  _formatHistoryTime(value) {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return "";
    return new Intl.DateTimeFormat(this._hass?.language, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(timestamp);
  }

  _validHistorySnapshots(value) {
    return (Array.isArray(value) ? value : [])
      .filter((snapshot) =>
        snapshot
        && typeof snapshot.id === "string"
        && typeof snapshot.scene_url === "string"
        && snapshot.scene_url.startsWith("/")
        && Number.isFinite(Date.parse(snapshot.created_at)))
      .slice(-12);
  }

  _normaliseHistoryFloors(payload, catalogFloorCoherent = true) {
    const liveAvailable = catalogFloorCoherent
      && payload?.live_available !== false;
    const fallbackCurrent = {
      id: "current",
      active: true,
      readOnly: false,
      liveAvailable,
      ordinal: 0,
      snapshots: this._validHistorySnapshots(payload?.snapshots),
    };
    if (!Array.isArray(payload?.floors)) return [fallbackCurrent];
    let current = fallbackCurrent;
    const saved = [];
    const seen = new Set(["current"]);
    for (const candidate of payload.floors.slice(0, 12)) {
      if (!candidate || typeof candidate !== "object") continue;
      if (candidate.id === "current" && candidate.active === true) {
        current = {
          ...fallbackCurrent,
          liveAvailable: liveAvailable
            && candidate.live_available !== false,
          snapshots: this._validHistorySnapshots(candidate.snapshots),
        };
        continue;
      }
      if (
        typeof candidate.id !== "string"
        || !/^saved-[a-zA-Z0-9_-]{1,64}$/.test(candidate.id)
        || seen.has(candidate.id)
        || candidate.active !== false
        || candidate.read_only !== true
        || !Number.isInteger(candidate.ordinal)
        || candidate.ordinal < 1
        || candidate.ordinal > 12
      ) continue;
      const snapshots = this._validHistorySnapshots(candidate.snapshots);
      if (!snapshots.length) continue;
      seen.add(candidate.id);
      saved.push({
        id: candidate.id,
        active: false,
        readOnly: true,
        ordinal: candidate.ordinal,
        snapshots,
      });
    }
    return [current, ...saved];
  }

  _selectedFloor() {
    return this._floors.find((floor) => floor.id === this._selectedFloorId)
      || this._floors.find((floor) => floor.active)
      || this._floors[0];
  }

  _floorLabel(floor) {
    return floor?.active
      ? this._localize("map_floor_current", "Current floor")
      : this._localize(
        "map_floor_saved",
        "Saved floor {number}",
        { number: floor?.ordinal || 1 },
      );
  }

  _syncFloorSelector() {
    const control = this.shadowRoot.querySelector(".floor-control");
    const select = this.shadowRoot.querySelector(".floor-select");
    if (!control || !select) return;
    control.hidden = this._floors.length <= 1 || this._view === "rooms";
    select.replaceChildren();
    for (const floor of this._floors) {
      const option = document.createElement("option");
      option.value = floor.id;
      option.textContent = floor.readOnly
        ? this._localize(
          "map_floor_saved_read_only",
          "Saved floor {number} · read only",
          { number: floor.ordinal },
        )
        : floor.liveAvailable === false
        ? this._localize(
          "map_floor_current_settling",
          "Current floor · map settling",
        )
        : this._floorLabel(floor);
      option.disabled = floor.active && floor.liveAvailable === false;
      option.selected = floor.id === this._selectedFloorId;
      select.append(option);
    }
  }

  _selectFloor(floorId) {
    const floor = this._floors.find((candidate) => candidate.id === floorId);
    if (!floor || floor.id === this._selectedFloorId) return;
    this._selectedFloorId = floor.id;
    this._history = floor.snapshots;
    this._historySceneAbortController?.abort();
    if (floor.active) {
      this._selectedHistoryId = undefined;
      this._syncTimeline();
      const state = this._catalogState();
      if (state) this._fetchScene(state, true);
      return;
    }
    const snapshot = this._history.at(-1);
    this._selectedHistoryId = snapshot?.id;
    this._setPoseStatus("unavailable");
    this._syncTimeline();
    if (snapshot) this._loadHistoricalScene(snapshot);
  }

  _syncTimeline() {
    const timeline = this.shadowRoot.querySelector(".timeline");
    if (!timeline) return;
    const floor = this._selectedFloor();
    const hasLive = floor?.active === true && floor.liveAvailable !== false;
    const hasHistory = this._history.length > 0;
    timeline.hidden = this._view === "rooms";
    this._syncFloorSelector();
    const panel = timeline.querySelector(".timeline-panel");
    panel.dataset.empty = String(!hasHistory);
    timeline.querySelector(".timeline-empty").hidden = hasHistory;
    const range = timeline.querySelector(".timeline-range");
    const livePosition = hasLive
      ? this._history.length
      : Math.max(0, this._history.length - 1);
    const selectedIndex = this._history.findIndex(
      (snapshot) => snapshot.id === this._selectedHistoryId,
    );
    const position = selectedIndex >= 0 ? selectedIndex : livePosition;
    range.max = String(livePosition);
    range.value = String(position);
    range.disabled = !hasHistory;
    timeline.querySelector(".timeline-earlier").disabled = position <= 0;
    timeline.querySelector(".timeline-later").disabled = position >= livePosition;
    const live = timeline.querySelector(".timeline-live");
    const isLive = hasLive && position === livePosition;
    live.hidden = !hasLive;
    live.classList.toggle("selected", isLive);
    live.setAttribute("aria-pressed", String(isLive));
    timeline.dataset.live = String(isLive);
    for (const selector of [".cleaning-plans", ".cleaning-areas"]) {
      const button = this.shadowRoot.querySelector(selector);
      if (button) button.disabled = !isLive;
    }
    const label = timeline.querySelector(".timeline-label");
    const value = isLive
      ? this._localize("map_timeline_live", "Live map")
      : this._formatHistoryTime(this._history[position]?.created_at);
    label.textContent = value;
    timeline.querySelector(".timeline-summary-label").textContent = value;
  }

  _markCurrentFloorAvailable() {
    let currentFloor = this._floors.find((floor) => floor.active);
    if (!currentFloor) {
      currentFloor = {
        id: "current",
        active: true,
        readOnly: false,
        liveAvailable: true,
        snapshots: [],
      };
      this._floors = [currentFloor, ...this._floors];
    } else {
      currentFloor.liveAvailable = true;
    }
    this._syncTimeline();
  }

  _selectTimelinePosition(position) {
    const selectedFloor = this._selectedFloor();
    const hasLive = selectedFloor?.active === true
      && selectedFloor?.liveAvailable !== false;
    const maximum = hasLive
      ? this._history.length
      : Math.max(0, this._history.length - 1);
    const bounded = maticClamp(
      Math.round(Number(position) || 0),
      0,
      maximum,
    );
    if (hasLive && bounded === this._history.length) {
      this._selectedHistoryId = undefined;
      this._historySceneAbortController?.abort();
      this._syncTimeline();
      const state = this._catalogState();
      if (state) this._fetchScene(state, true);
      return;
    }
    const snapshot = this._history[bounded];
    if (!snapshot || snapshot.id === this._selectedHistoryId) return;
    this._selectedHistoryId = snapshot.id;
    this._syncTimeline();
    this._loadHistoricalScene(snapshot);
  }

  async _loadHistoricalScene(snapshot) {
    this._setPoseStatus("unavailable");
    if (!snapshot.scene_url.startsWith("/")) return;
    this._stableLiveSnapshotId = undefined;
    this._stableLiveSourceIdentity = undefined;
    this._stableLiveSourceUrl = undefined;
    this._stopDeltaStream();
    this._sceneAbortController?.abort();
    this._historySceneAbortController?.abort();
    const controller = new AbortController();
    this._historySceneAbortController = controller;
    const timeout = window.setTimeout(
      () => controller.abort(),
      MATIC_HISTORY_REQUEST_TIMEOUT_MS,
    );
    this._setLoading(true);
    try {
      const response = await this._authenticatedFetch(snapshot.scene_url, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("historical scene request failed");
      const scene = this._parseScene(await response.arrayBuffer());
      if (
        controller.signal.aborted
        || this._selectedHistoryId !== snapshot.id
      ) return;
      this._scene = scene;
      this._sceneUrl = snapshot.scene_url;
      this._sceneIdentity = `history:${snapshot.id}`;
      this._sceneRevision = snapshot.revision;
      this._sceneEtag = response.headers.get("ETag") || undefined;
      this._robot = undefined;
      this._uploadScene(scene);
      this._rebuildOverlays();
      this._calculateHomeDistances();
      this._showSpatialScene();
      this._setStatus(
        this._historicalStatus(snapshot),
      );
      this._requestRender();
    } catch (_error) {
      if (
        !controller.signal.aborted
        && this._selectedHistoryId === snapshot.id
      ) {
        this._setStatus(
          this._localize(
            "map_status_history_unavailable",
            "This map checkpoint is unavailable",
          ),
          "error",
        );
      }
    } finally {
      window.clearTimeout(timeout);
      if (this._historySceneAbortController === controller) {
        this._historySceneAbortController = undefined;
        this._setLoading(false);
      }
    }
  }

  _historicalStatus(snapshot) {
    const floor = this._selectedFloor();
    if (floor?.readOnly) {
      return this._localize(
        "map_status_saved_floor",
        "Saved floor {number} · captured {time} · read only",
        {
          number: floor.ordinal,
          time: this._formatHistoryTime(snapshot.created_at),
        },
      );
    }
    return this._localize(
      "map_status_historical",
      "Map captured {time}",
      { time: this._formatHistoryTime(snapshot.created_at) },
    );
  }

  _guardButton(button, action) {
    if (!button || button.dataset.maticGuardButton === "true") return;
    button.dataset.maticGuardButton = "true";
    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      action();
    });
  }

  _bindCriticalControls() {
    if (!this.shadowRoot) return;
    const bind = (selector, action) => this._guardButton(
      this.shadowRoot.querySelector(selector),
      action,
    );
    bind('[data-view="three"]', () => this._setView("three"));
    bind('[data-view="top"]', () => this._setView(this._planView));
    bind(".cleaning-plans", () => this._openCleaningWorkspace("plans"));
    bind(".cleaning-areas", () => this._openCleaningWorkspace("areas"));
    bind(".areas-close", () => this._closeAreasWorkspace());
    for (const button of this.shadowRoot.querySelectorAll(
      "[data-cleaning-view]",
    )) {
      this._guardButton(button, () => this._setCleaningView(
        button.dataset.cleaningView,
      ));
    }
    bind(".plan-new", () => this._selectPlan(undefined));
    bind(".plan-save", () => this._savePlan());
    bind(".plan-delete", () => this._deletePlan());
    bind(".plan-select", () => this._selectCurrentPlan());
    bind(".plan-run", () => this._runPlan());
    bind(".area-new", () => this._selectArea(undefined));
    bind(".area-sheet-toggle", () => this._toggleAreaSheet());
    bind(".area-save", () => this._saveArea());
    bind(".area-delete", () => this._deleteArea());
    bind(".area-run", () => this._runArea());
  }

  _clearPrivateMap() {
    this._pendingSceneRefresh = false;
    this._pendingSceneForce = false;
    this._latestSceneKey = undefined;
    this._latestSceneState = undefined;
    this._sceneAbortController?.abort();
    this._stopDeltaStream();
    this._historyAbortController?.abort();
    this._historySceneAbortController?.abort();
    this._pendingPoseRefresh = false;
    this._latestPoseState = undefined;
    this._poseAbortController?.abort();
    this._scene = undefined;
    this._sceneUrl = undefined;
    this._sceneIdentity = undefined;
    this._sceneRevision = undefined;
    this._sceneEtag = undefined;
    this._history = [];
    this._historyUrl = undefined;
    this._historyIdentity = undefined;
    this._historyRequestUrl = undefined;
    this._historyEntryId = undefined;
    this._floors = [];
    this._selectedFloorId = "current";
    this._selectedHistoryId = undefined;
    this._stableLiveSnapshotId = undefined;
    this._stableLiveSourceIdentity = undefined;
    this._stableLiveSourceUrl = undefined;
    this._robot = undefined;
    this._setPoseStatus("unavailable");
    this._renderFloorCount = undefined;
    this._renderSurfaceCount = undefined;
    this._renderPointCount = undefined;
    this._cancelFallbackLoad();
    this._fallbackVersion = undefined;
    this.shadowRoot.querySelector(".map-image")?.removeAttribute("src");
    const marker = this.shadowRoot.querySelector(".robot-marker");
    if (marker) marker.hidden = true;
    const resolution = this.shadowRoot.querySelector(".resolution-value");
    if (resolution) resolution.textContent = "—";
    this._syncTimeline();
    this._rebuildOverlays();
    if (this._gl && this._pointBuffer) {
      this._gl.bindBuffer(this._gl.ARRAY_BUFFER, this._pointBuffer);
      this._gl.bufferData(this._gl.ARRAY_BUFFER, 0, this._gl.STATIC_DRAW);
      this._gl.clearColor(0, 0, 0, 0);
      this._gl.clear(this._gl.COLOR_BUFFER_BIT | this._gl.DEPTH_BUFFER_BIT);
    }
  }

  _authHeaders() {
    const token = this._hass?.auth?.accessToken
      || this._hass?.auth?.data?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  _authenticatedFetch(path, init = {}) {
    if (typeof this._hass?.fetchWithAuth === "function") {
      // Home Assistant prepends its own base URL and refreshes expired tokens.
      // Passing hassUrl(path) would create a malformed double URL instead of
      // using that supported authenticated request path.
      return this._hass.fetchWithAuth(path, init);
    }
    const url = this._absoluteUrl(path);
    return fetch(url, {
      ...init,
      headers: {
        ...this._authHeaders(),
        ...(init.headers || {}),
      },
    });
  }

  _absoluteUrl(path) {
    return this._hass?.hassUrl ? this._hass.hassUrl(path) : path;
  }

  _compileShader(type, source) {
    const shader = this._gl.createShader(type);
    this._gl.shaderSource(shader, source);
    this._gl.compileShader(shader);
    if (!this._gl.getShaderParameter(shader, this._gl.COMPILE_STATUS)) {
      const reason = this._gl.getShaderInfoLog(shader) || "shader compilation failed";
      this._gl.deleteShader(shader);
      throw new Error(reason);
    }
    return shader;
  }

  _initWebGL() {
    const canvas = this.shadowRoot.querySelector(".scene-canvas");
    try {
      this._gl = canvas.getContext("webgl2", {
        alpha: true,
        antialias: true,
        depth: true,
        powerPreference: "high-performance",
      });
      if (!this._gl) throw new Error("WebGL 2 is unavailable");
      const vertex = this._compileShader(this._gl.VERTEX_SHADER, `#version 300 es
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
          gl_PointSize = clamp(uPointPixels / max(0.18, clip.w), 1.25, uMaxPointPixels);
          vColor = aColor;
        }
      `);
      const fragment = this._compileShader(this._gl.FRAGMENT_SHADER, `#version 300 es
        precision highp float;
        in vec3 vColor;
        out vec4 outColor;
        void main() {
          vec2 point = gl_PointCoord * 2.0 - 1.0;
          if (dot(point, point) > 1.0) discard;
          float edge = smoothstep(1.0, 0.72, dot(point, point));
          outColor = vec4(pow(vColor, vec3(0.94)), edge);
        }
      `);
      this._pointProgram = this._gl.createProgram();
      this._gl.attachShader(this._pointProgram, vertex);
      this._gl.attachShader(this._pointProgram, fragment);
      this._gl.linkProgram(this._pointProgram);
      this._gl.deleteShader(vertex);
      this._gl.deleteShader(fragment);
      if (!this._gl.getProgramParameter(this._pointProgram, this._gl.LINK_STATUS)) {
        throw new Error(this._gl.getProgramInfoLog(this._pointProgram));
      }
      this._uniforms = {
        viewProjection: this._gl.getUniformLocation(
          this._pointProgram,
          "uViewProjection",
        ),
        center: this._gl.getUniformLocation(this._pointProgram, "uCenter"),
        meters: this._gl.getUniformLocation(
          this._pointProgram,
          "uMetersPerCell",
        ),
        pointPixels: this._gl.getUniformLocation(
          this._pointProgram,
          "uPointPixels",
        ),
        maxPointPixels: this._gl.getUniformLocation(
          this._pointProgram,
          "uMaxPointPixels",
        ),
      };
      this._pointBuffer = this._gl.createBuffer();
      this._pointVertexArray = this._gl.createVertexArray();
      this._gl.bindVertexArray(this._pointVertexArray);
      this._gl.bindBuffer(this._gl.ARRAY_BUFFER, this._pointBuffer);
      this._gl.enableVertexAttribArray(0);
      this._gl.vertexAttribIPointer(
        0,
        2,
        this._gl.UNSIGNED_SHORT,
        MATIC_SCENE_POINT_STRIDE,
        0,
      );
      this._gl.enableVertexAttribArray(1);
      this._gl.vertexAttribIPointer(
        1,
        1,
        this._gl.UNSIGNED_BYTE,
        MATIC_SCENE_POINT_STRIDE,
        4,
      );
      this._gl.enableVertexAttribArray(2);
      this._gl.vertexAttribPointer(
        2,
        3,
        this._gl.UNSIGNED_BYTE,
        true,
        MATIC_SCENE_POINT_STRIDE,
        5,
      );
      this._gl.bindVertexArray(null);
      this._gl.enable(this._gl.DEPTH_TEST);
      this._gl.depthFunc(this._gl.LEQUAL);
      this._gl.enable(this._gl.BLEND);
      this._gl.blendFunc(this._gl.SRC_ALPHA, this._gl.ONE_MINUS_SRC_ALPHA);
      this._webglAvailable = true;
    } catch (_error) {
      this._webglAvailable = false;
      this._gl = undefined;
    }
  }

  _normaliseMetadata(metadata) {
    const meters = Number(metadata?.meters_per_cell);
    const span = Array.isArray(metadata?.span_cells)
      ? metadata.span_cells.map(Number)
      : [];
    const origin = Array.isArray(metadata?.origin_cells)
      ? metadata.origin_cells.map(Number)
      : [];
    if (
      !Number.isFinite(meters)
      || meters < 0.001
      || meters > 0.1
      || span.length !== 2
      || origin.length !== 2
      || span.some((value) => !Number.isFinite(value) || value < 1 || value > 65536)
      || origin.some((value) => !Number.isFinite(value))
    ) {
      throw new Error("invalid scene metadata");
    }
    const rooms = (Array.isArray(metadata.rooms) ? metadata.rooms : [])
      .slice(0, 128)
      .map((room) => {
        const contours = maticRoomContours(
          (Array.isArray(room?.boundary) ? room.boundary : []).slice(0, 8192),
          room?.boundary_closed === true,
        );
        const boundary = contours.flatMap((contour) => contour.points);
        const center = Array.isArray(room?.center)
          && room.center.length === 2
          && room.center.every(Number.isFinite)
          ? room.center
          : undefined;
        return {
          name: String(
            room?.name || this._localize("map_room_default", "Room"),
          ).slice(0, 128),
          boundary,
          contours,
          center,
        };
      })
      .filter((room) => room.contours.length > 0 && room.center);
    return {
      metersPerCell: meters,
      origin,
      span,
      sampleStep: Math.max(1, Number(metadata.sample_step) || 1),
      rooms,
    };
  }

  _parseScene(buffer) {
    if (buffer.byteLength < MATIC_SCENE_HEADER_BYTES) {
      throw new Error("scene header is incomplete");
    }
    const bytes = new Uint8Array(buffer, 0, 8);
    const magic = new TextDecoder().decode(bytes);
    const view = new DataView(buffer);
    const version = view.getUint16(8, true);
    const stride = view.getUint16(10, true);
    const metadataBytes = view.getUint32(12, true);
    const floorCount = view.getUint32(16, true);
    const surfaceCount = view.getUint32(20, true);
    const total = floorCount + surfaceCount;
    const pointOffset = MATIC_SCENE_HEADER_BYTES + metadataBytes;
    if (
      magic !== "MATIC3D\u0000"
      || version !== 1
      || stride !== MATIC_SCENE_POINT_STRIDE
      || metadataBytes > 1024 * 1024
      || total < 1
      || total > MATIC_SCENE_MAX_POINTS
      || pointOffset + total * stride !== buffer.byteLength
    ) {
      throw new Error("scene payload is invalid");
    }
    const metadataText = new TextDecoder().decode(
      new Uint8Array(buffer, MATIC_SCENE_HEADER_BYTES, metadataBytes),
    );
    return {
      buffer,
      pointOffset,
      floorCount,
      surfaceCount,
      total,
      metadata: this._normaliseMetadata(JSON.parse(metadataText)),
    };
  }

  async _inflateSceneDelta(compressed, expectedLength) {
    if (
      !Number.isSafeInteger(expectedLength)
      || expectedLength < 1
      || expectedLength > 16 * 1024 * 1024
    ) {
      throw new Error("scene delta expands beyond its bounds");
    }
    const stream = new Blob([compressed])
      .stream()
      .pipeThrough(new DecompressionStream("deflate"));
    const reader = stream.getReader();
    const difference = new Uint8Array(expectedLength);
    let offset = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!(value instanceof Uint8Array) || offset + value.byteLength > expectedLength) {
          await reader.cancel();
          throw new Error("scene delta expands beyond its bounds");
        }
        difference.set(value, offset);
        offset += value.byteLength;
      }
    } finally {
      reader.releaseLock();
    }
    if (offset !== expectedLength) {
      throw new Error("scene delta does not match its declared length");
    }
    return difference;
  }

  async _applySceneDelta(buffer) {
    if (buffer.byteLength < 36 || !this._scene) {
      throw new Error("scene delta is incomplete");
    }
    const view = new DataView(buffer);
    const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, 8));
    const version = view.getUint16(8, true);
    const flags = view.getUint16(10, true);
    const baseRevision = Number(view.getBigUint64(12, true));
    const revision = Number(view.getBigUint64(20, true));
    const sceneLength = view.getUint32(28, true);
    const compressedLength = view.getUint32(32, true);
    if (
      magic !== "MATICDLT"
      || version !== 1
      || flags !== 1
      || !Number.isSafeInteger(baseRevision)
      || !Number.isSafeInteger(revision)
      || baseRevision !== Number(this._sceneRevision)
      || sceneLength > 16 * 1024 * 1024
      || compressedLength > 16 * 1024 * 1024
      || compressedLength + 36 !== buffer.byteLength
      || typeof DecompressionStream !== "function"
    ) {
      throw new Error("scene delta is invalid");
    }
    const compressed = new Uint8Array(buffer, 36);
    const base = new Uint8Array(this._scene.buffer);
    const difference = await this._inflateSceneDelta(
      compressed,
      Math.max(base.byteLength, sceneLength),
    );
    const result = difference.slice();
    const chunkBytes = 1024 * 1024;
    for (let start = 0; start < base.length; start += chunkBytes) {
      const end = Math.min(base.length, start + chunkBytes);
      for (let index = start; index < end; index += 1) {
        result[index] ^= base[index];
      }
      if (end < base.length) {
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
    }
    return {
      scene: this._parseScene(result.buffer.slice(0, sceneLength)),
      revision,
    };
  }

  _installLiveScene(scene, state, revision, etag) {
    const url = state?.attributes?.scene_url;
    this._stableLiveSnapshotId = undefined;
    this._stableLiveSourceIdentity = undefined;
    this._stableLiveSourceUrl = undefined;
    this._scene = scene;
    this._sceneUrl = url;
    this._sceneIdentity = this._sceneRequestIdentity(state);
    this._sceneRevision = revision;
    this._sceneEtag = etag || undefined;
    this._uploadScene(scene);
    this._rebuildOverlays();
    this._calculateHomeDistances();
    if (this._cameraRestored) {
      this._camera.distance = maticClamp(
        this._camera.distance,
        Math.max(0.3, this._radius * 0.08),
        this._radius * 8,
      );
      this._constrainCameraTarget(this._camera);
    }
    if (!this._cameraRestored) this._restoreSavedCamera();
    this._showSpatialScene();
    this._updateSceneStatus(state);
    this._fetchPose(state);
    this._requestRender();
    this._startDeltaStream(state);
  }

  _latestHistorySnapshot() {
    return this._history[this._history.length - 1];
  }

  _isStableLiveScene(state) {
    return Boolean(
      this._stableLiveSnapshotId
      && this._scene
      && state?.attributes?.scene_url === this._stableLiveSourceUrl,
    );
  }

  async _loadStableLiveScene(snapshot, state, requestKey) {
    if (!snapshot?.scene_url?.startsWith("/") || this._selectedHistoryId) {
      return false;
    }
    if (
      this._stableLiveSnapshotId === snapshot.id
      && this._sceneUrl === snapshot.scene_url
      && this._scene
    ) {
      this._stableLiveSourceIdentity = requestKey;
      this._stableLiveSourceUrl = state?.attributes?.scene_url;
      this._showSpatialScene();
      this._updateStableLiveStatus(state);
      this._fetchPose(state);
      return true;
    }

    this._stopDeltaStream();
    this._historySceneAbortController?.abort();
    const controller = new AbortController();
    this._historySceneAbortController = controller;
    const timeout = window.setTimeout(
      () => controller.abort(),
      MATIC_HISTORY_REQUEST_TIMEOUT_MS,
    );
    try {
      const response = await this._authenticatedFetch(snapshot.scene_url, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) return false;
      const scene = this._parseScene(await response.arrayBuffer());
      if (
        controller.signal.aborted
        || this._selectedHistoryId
        || this._latestSceneKey !== requestKey
      ) return false;
      this._scene = scene;
      this._sceneUrl = snapshot.scene_url;
      this._sceneIdentity = `stable-live:${snapshot.id}`;
      this._sceneRevision = snapshot.revision;
      this._sceneEtag = response.headers.get("ETag") || undefined;
      this._stableLiveSnapshotId = snapshot.id;
      this._stableLiveSourceIdentity = requestKey;
      this._stableLiveSourceUrl = state?.attributes?.scene_url;
      this._uploadScene(scene);
      this._rebuildOverlays();
      this._calculateHomeDistances();
      if (this._cameraRestored) {
        this._camera.distance = maticClamp(
          this._camera.distance,
          Math.max(0.3, this._radius * 0.08),
          this._radius * 8,
        );
        this._constrainCameraTarget(this._camera);
      }
      if (!this._cameraRestored) this._restoreSavedCamera();
      this._showSpatialScene();
      this._updateStableLiveStatus(state);
      this._fetchPose(state);
      this._requestRender();
      return true;
    } catch (_error) {
      return false;
    } finally {
      window.clearTimeout(timeout);
      if (this._historySceneAbortController === controller) {
        this._historySceneAbortController = undefined;
      }
    }
  }

  _stopDeltaStream() {
    this._deltaGeneration += 1;
    this._deltaAbortController?.abort();
    this._deltaAbortController = undefined;
    this._deltaUrl = undefined;
    this._deltaRunning = false;
  }

  _startDeltaStream(state) {
    const url = state?.attributes?.delta_url;
    if (
      !url
      || this._selectedHistoryId
      || !this._scene
      || this._sceneUrl !== state?.attributes?.scene_url
      || typeof DecompressionStream !== "function"
    ) return;
    if (this._deltaRunning && this._deltaUrl === url) return;
    this._stopDeltaStream();
    const generation = this._deltaGeneration;
    this._deltaRunning = true;
    this._deltaUrl = url;
    this._runDeltaStream(state, generation);
  }

  async _runDeltaStream(state, generation) {
    try {
      while (
        this.isConnected
        && generation === this._deltaGeneration
        && !this._selectedHistoryId
      ) {
        const controller = new AbortController();
        this._deltaAbortController = controller;
        const timeout = window.setTimeout(
          () => controller.abort(),
          MATIC_DELTA_REQUEST_TIMEOUT_MS,
        );
        try {
          const separator = this._deltaUrl.includes("?") ? "&" : "?";
          const response = await this._authenticatedFetch(
            `${this._deltaUrl}${separator}since=${encodeURIComponent(this._sceneRevision)}`,
            { cache: "no-store", signal: controller.signal },
          );
          if (this._rejectIncoherentLiveResponse(response, state)) return;
          if (response.status === 204) continue;
          if (!response.ok) throw new Error("scene delta request failed");
          const contentType = response.headers.get("Content-Type") || "";
          let scene;
          let revision = Number(response.headers.get("X-Matic-Revision"));
          if (contentType.includes("application/vnd.matic.slam-delta")) {
            const decoded = await this._applySceneDelta(
              await response.arrayBuffer(),
            );
            scene = decoded.scene;
            revision = decoded.revision;
          } else if (contentType.includes("application/vnd.matic.slam-scene")) {
            scene = this._parseScene(await response.arrayBuffer());
          } else {
            throw new Error("scene update has an unsupported content type");
          }
          if (
            generation !== this._deltaGeneration
            || this._selectedHistoryId
            || !Number.isSafeInteger(revision)
          ) return;
          const latest = this._catalogState() || state;
          this._installLiveScene(
            scene,
            latest,
            revision,
            response.headers.get("ETag"),
          );
        } catch (_error) {
          if (
            controller.signal.aborted
            || generation !== this._deltaGeneration
            || !this.isConnected
          ) return;
          this._deltaRunning = false;
          this._fetchScene(this._catalogState() || state, true);
          return;
        } finally {
          window.clearTimeout(timeout);
          if (this._deltaAbortController === controller) {
            this._deltaAbortController = undefined;
          }
        }
      }
    } finally {
      if (generation === this._deltaGeneration) {
        this._deltaRunning = false;
      }
    }
  }

  _uploadScene(scene) {
    if (!this._gl) return;
    const source = new Uint8Array(
      scene.buffer,
      scene.pointOffset,
      scene.total * MATIC_SCENE_POINT_STRIDE,
    );
    const pointBudget = this._pointBudget(scene.total);
    const floorBudget = Math.min(
      scene.floorCount,
      Math.round(pointBudget * scene.floorCount / scene.total),
    );
    const surfaceBudget = Math.min(
      scene.surfaceCount,
      pointBudget - floorBudget,
    );
    let pointBytes = source;
    if (floorBudget + surfaceBudget < scene.total) {
      pointBytes = new Uint8Array(
        (floorBudget + surfaceBudget) * MATIC_SCENE_POINT_STRIDE,
      );
      this._samplePoints(
        source,
        0,
        scene.floorCount,
        floorBudget,
        pointBytes,
        0,
      );
      this._samplePoints(
        source,
        scene.floorCount,
        scene.surfaceCount,
        surfaceBudget,
        pointBytes,
        floorBudget,
      );
    }
    this._renderFloorCount = floorBudget;
    this._renderSurfaceCount = surfaceBudget;
    this._renderPointCount = floorBudget + surfaceBudget;
    this._gl.bindBuffer(this._gl.ARRAY_BUFFER, this._pointBuffer);
    this._gl.bufferData(this._gl.ARRAY_BUFFER, pointBytes, this._gl.STATIC_DRAW);
  }

  _pointBudget(total) {
    if (this._quality !== "auto") {
      return Math.min(total, MATIC_MAP_QUALITY_BUDGETS[this._quality]);
    }
    const cores = Number(navigator.hardwareConcurrency) || 8;
    const memory = Number(navigator.deviceMemory) || 8;
    if (cores <= 4 || memory <= 4) return Math.min(total, 450000);
    if (cores <= 6 || memory <= 6) return Math.min(total, 900000);
    return total;
  }

  _samplePoints(source, start, count, targetCount, destination, targetStart) {
    if (targetCount < 1 || count < 1) return;
    for (let index = 0; index < targetCount; index += 1) {
      const sourceIndex = start + Math.floor(index * count / targetCount);
      const sourceOffset = sourceIndex * MATIC_SCENE_POINT_STRIDE;
      const targetOffset = (targetStart + index) * MATIC_SCENE_POINT_STRIDE;
      destination.set(
        source.subarray(
          sourceOffset,
          sourceOffset + MATIC_SCENE_POINT_STRIDE,
        ),
        targetOffset,
      );
    }
  }

  _sceneRequestIdentity(state) {
    const url = String(state?.attributes?.scene_url || "");
    const version = state?.attributes?.map_revision
      ?? state?.last_updated
      ?? "";
    return `${url}\u0000${String(version)}`;
  }

  _rejectIncoherentLiveResponse(response, state) {
    if (response.headers.get("X-Matic-Floor-Coherent") !== "0") return false;
    this._showFloorTransition({
      ...state,
      attributes: {
        ...(state?.attributes || {}),
        map_floor_coherent: false,
      },
    });
    return true;
  }

  async _validateCatalogOnlyFloor(state, controller) {
    const response = await this._authenticatedFetch(
      state?.attributes?.scene_url,
      { cache: "no-store", signal: controller.signal },
    );
    if (
      !response.ok
      || response.headers.get("X-Matic-Floor-Coherent") !== "1"
    ) {
      this._showFloorTransition({
        ...state,
        attributes: {
          ...(state?.attributes || {}),
          map_floor_coherent: false,
        },
      });
      return false;
    }
    await response.body?.cancel();
    return true;
  }

  async _fetchScene(state, force = false) {
    const url = state?.attributes?.scene_url;
    const revision = state?.attributes?.map_revision;
    if (!url || !this._webglAvailable || this._selectedHistoryId) return;
    const requestKey = this._sceneRequestIdentity(state);
    this._latestSceneState = state;
    this._latestSceneKey = requestKey;
    const entryId = state?.attributes?.entry_id
      || state?.attributes?.matic_entry_id;
    const entities = this._entities(entryId);
    const entityBackedCoherence = Boolean(entities.rooms || entities.photo);
    const stableSnapshot = state?.attributes?.map_complete === true
      || state?.attributes?.map_floor_coherent === false
      ? undefined
      : this._latestHistorySnapshot();
    if (
      !force
      && this._isStableLiveScene(state)
      && this._stableLiveSourceIdentity === requestKey
    ) {
      this._updateStableLiveStatus(state);
      this._fetchPose(state);
      return;
    }
    if (!force && !stableSnapshot && this._scene && this._sceneUrl === url) {
      this._startDeltaStream(state);
      if (
        state?.attributes?.delta_url
        && typeof DecompressionStream === "function"
        && requestKey === this._sceneIdentity
      ) {
        return;
      }
      if (requestKey === this._sceneIdentity) return;
    }
    if (force) this._stopDeltaStream();
    if (this._sceneLoading) {
      const changed = requestKey !== this._sceneRequestKey;
      if (force || changed) {
        this._pendingSceneRefresh = true;
        this._pendingSceneForce ||= force;
        if (force || url !== this._sceneRequestUrl) {
          this._sceneAbortController?.abort();
          if (!this._selectedHistoryId) {
            this._historySceneAbortController?.abort();
          }
        }
      }
      return;
    }
    this._sceneLoading = true;
    this._sceneRequestKey = requestKey;
    this._sceneRequestUrl = url;
    this._setLoading(true);
    const controller = new AbortController();
    this._sceneAbortController = controller;
    const timeout = window.setTimeout(
      () => controller.abort(),
      MATIC_SCENE_REQUEST_TIMEOUT_MS,
    );
    try {
      if (
        stableSnapshot
        && !entityBackedCoherence
        && !(await this._validateCatalogOnlyFloor(state, controller))
      ) return;
      if (
        stableSnapshot
        && await this._loadStableLiveScene(stableSnapshot, state, requestKey)
      ) return;
      if (
        this._latestSceneKey !== requestKey
        || this._selectedHistoryId
      ) return;
      const headers = {};
      if (this._sceneEtag && this._sceneUrl === url && !force) {
        headers["If-None-Match"] = this._sceneEtag;
      }
      const response = await this._authenticatedFetch(url, {
        headers,
        cache: "no-store",
        signal: controller.signal,
      });
      if (this._rejectIncoherentLiveResponse(response, state)) return;
      if (response.status === 304) {
        if (this._latestSceneKey !== requestKey) return;
        this._sceneIdentity = requestKey;
        this._sceneRevision = Number(
          response.headers.get("X-Matic-Revision") ?? revision,
        );
        this._startDeltaStream(state);
        return;
      }
      if (!response.ok) {
        const error = new Error(`scene request failed (${response.status})`);
        error.status = response.status;
        throw error;
      }
      const scene = this._parseScene(await response.arrayBuffer());
      if (this._latestSceneKey !== requestKey) return;
      const responseRevision = Number(
        response.headers.get("X-Matic-Revision") ?? revision,
      );
      this._installLiveScene(
        scene,
        state,
        Number.isSafeInteger(responseRevision) ? responseRevision : revision,
        response.headers.get("ETag"),
      );
    } catch (error) {
      if (!this.isConnected) return;
      const superseded = this._latestSceneKey !== requestKey
        || (controller.signal.aborted && this._pendingSceneRefresh);
      if (
        !superseded
        && this._scene
        && this._sceneUrl === url
      ) {
        this._showRetainedScene();
      } else if (!superseded) {
        const entryId = state?.attributes?.entry_id
          || state?.attributes?.matic_entry_id;
        const entities = this._entities(entryId);
        const fallbackAvailable = this._showFallback(
          entities.rooms || entities.photo,
          force,
        );
        const health = String(state?.attributes?.map_health || "").toLowerCase();
        const collecting = error?.status === 409
          && ["empty", "collecting", "incomplete"].includes(health);
        if (fallbackAvailable) {
          this._setStatus(collecting
            ? this._localize(
              "map_status_scene_collecting",
              "Building local 3D scene · showing the local map",
            )
            : this._localize(
              "map_status_scene_fallback",
              "3D scene is not ready · showing the local map",
            ), collecting ? "normal" : "error");
        }
      }
    } finally {
      window.clearTimeout(timeout);
      if (this._sceneAbortController === controller) {
        this._sceneAbortController = undefined;
      }
      if (this._sceneRequestKey === requestKey) {
        this._sceneRequestKey = undefined;
        this._sceneRequestUrl = undefined;
      }
      this._sceneLoading = false;
      this._setLoading(false);
      if (this._pendingSceneRefresh && this.isConnected) {
        const pendingForce = this._pendingSceneForce;
        this._pendingSceneRefresh = false;
        this._pendingSceneForce = false;
        this._fetchScene(this._latestSceneState || state, pendingForce);
      }
    }
  }

  async _fetchPose(state) {
    if (this._selectedHistoryId) {
      this._setPoseStatus("unavailable");
      return;
    }
    const url = state?.attributes?.pose_url;
    const sceneUrl = state?.attributes?.scene_url;
    if (!url) return;
    this._latestPoseState = state;
    if (this._poseLoading) {
      if (url !== this._poseRequestUrl) {
        this._pendingPoseRefresh = true;
        this._poseAbortController?.abort();
      }
      return;
    }
    if (
      !this._scene
      || (sceneUrl !== this._sceneUrl && !this._isStableLiveScene(state))
    ) return;
    this._poseLoading = true;
    this._poseRequestUrl = url;
    const controller = new AbortController();
    this._poseAbortController = controller;
    const timeout = window.setTimeout(
      () => controller.abort(),
      MATIC_POSE_REQUEST_TIMEOUT_MS,
    );
    try {
      const response = await this._authenticatedFetch(url, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) return;
      const payload = await response.json();
      if (payload?.map_floor_coherent === false) {
        this._showFloorTransition({
          ...state,
          attributes: {
            ...(state?.attributes || {}),
            map_floor_coherent: false,
          },
        });
        return;
      }
      if (
        controller.signal.aborted
        || this._latestPoseState?.attributes?.pose_url !== url
        || (
          sceneUrl !== this._sceneUrl
          && !this._isStableLiveScene(state)
        )
      ) return;
      const position = payload?.position;
      const source = String(payload?.source || "unavailable");
      this._setPoseStatus(source);
      if (
        source === "exact_pose"
        && Array.isArray(position)
        && position.length === 2
        && position.every(Number.isFinite)
      ) {
        const metadata = this._scene.metadata;
        this._robot = {
          x: position[0] / metadata.metersPerCell - metadata.origin[0],
          y: position[1] / metadata.metersPerCell - metadata.origin[1],
          source,
        };
      } else {
        this._robot = undefined;
      }
      this._requestRender();
    } catch (_error) {
      // Pose is an optional overlay; the scene stays usable while it retries.
    } finally {
      window.clearTimeout(timeout);
      if (this._poseAbortController === controller) {
        this._poseAbortController = undefined;
      }
      if (this._poseRequestUrl === url) this._poseRequestUrl = undefined;
      this._poseLoading = false;
      if (this._pendingPoseRefresh && this.isConnected) {
        this._pendingPoseRefresh = false;
        this._fetchPose(this._latestPoseState || state);
      }
    }
  }

  _setPoseStatus(source) {
    const status = this.shadowRoot.querySelector(".pose-status");
    if (!status) return;
    const roomOnly = source === "current_area" && !this._selectedHistoryId;
    status.hidden = !roomOnly;
    status.textContent = roomOnly
      ? this._localize(
        "map_robot_room_presence",
        "Robot is in the current room · exact position unavailable",
      )
      : "";
  }

  _updateSceneStatus(state) {
    if (!this._scene) return;
    const points = new Intl.NumberFormat(this._hass?.language).format(
      this._scene.total,
    );
    const sampling = this._scene.metadata.sampleStep === 1
      ? this._localize("map_sampling_all", "full capture")
      : this._localize(
        "map_sampling_adaptive",
        "adaptive 1:{step} sampling",
        { step: this._scene.metadata.sampleStep },
      );
    const complete = state?.attributes?.map_complete === true;
    const coherent = state?.attributes?.map_floor_coherent !== false;
    this._setStatus(
      !coherent
          ? this._localize(
            "map_status_floor_transition",
            "Floor transition detected · map paused until localization completes",
          )
        : complete
        ? this._localize(
          "map_status_full_scene",
          "{points} points · {sampling}",
          { points, sampling },
        )
        : this._localize(
          "map_status_building_scene",
          "Building local map · {points} points",
          { points },
        ),
    );
    this._updateResolution();
    this._updateHealth(state);
  }

  _updateStableLiveStatus(state) {
    if (!this._scene) return;
    this._setStatus(
      this._localize(
        "map_status_stable_live",
        "Live robot position · showing the last complete map while new map data builds",
      ),
    );
    this._updateResolution();
    this._updateHealth(state);
  }

  _updateResolution() {
    if (!this._scene) return;
    const points = new Intl.NumberFormat(this._hass?.language).format(
      this._scene.total,
    );
    const rendered = this._renderPointCount || this._scene.total;
    const detail = rendered < this._scene.total
      ? this._localize(
        "map_resolution_sampled",
        "{rendered} of {total} pts · 1.5 cm",
        {
          rendered: new Intl.NumberFormat(this._hass?.language).format(rendered),
          total: points,
        },
      )
      : this._localize(
        "map_resolution_full",
        "{points} pts · 1.5 cm",
        { points },
      );
    this.shadowRoot.querySelector(".resolution-value").textContent = detail;
  }

  async _update(force = false) {
    if (!this.shadowRoot.hasChildNodes()) return;
    const configuredEntryId = this._panel?.config?.entry_id;
    const initialEntities = this._entities(configuredEntryId);
    const initialLiveMap = initialEntities.rooms?.[1]
      || initialEntities.photo?.[1];
    const initialFloorIncoherent =
      initialLiveMap?.attributes?.map_floor_coherent === false;
    this._observeFloorCoherence(initialLiveMap);
    if (
      (this._view === "rooms" || !this._selectedHistoryId)
      && initialFloorIncoherent
    ) {
      this._showFloorTransition(initialLiveMap);
    }
    await this._fetchCatalog();
    const catalogState = this._catalogState();
    const entryId = catalogState?.attributes?.entry_id
      || this._panel?.config?.entry_id;
    const entities = this._entities(entryId);
    const liveEntityState = entities.rooms?.[1] || entities.photo?.[1];
    const photoState = catalogState || entities.photo?.[1];
    const entityFloorIncoherent = liveEntityState
      ? liveEntityState.attributes?.map_floor_coherent === false
      : initialFloorIncoherent;
    const catalogFloorIncoherent =
      photoState?.attributes?.map_floor_coherent === false;
    const liveSelection = this._view === "rooms" || !this._selectedHistoryId;
    if (
      liveSelection
      && (entityFloorIncoherent || catalogFloorIncoherent)
    ) {
      this._showFloorTransition(
        liveEntityState || initialLiveMap || photoState,
      );
      return;
    }
    if (this._catalogReady && this._catalogEntries.length === 0) {
      this._clearPrivateMap();
      this._showFallback(undefined);
      this._setStatus(
        this._localize(
          "map_status_no_map",
          "No local map data is available yet",
        ),
      );
      return;
    }
    if (!entityFloorIncoherent && !catalogFloorIncoherent) {
      this._markCurrentFloorAvailable();
    }
    if (photoState) await this._fetchHistory(photoState, force);
    // History is asynchronous and a newer update may have observed a floor
    // transition while this one was waiting. Re-read live inputs so an older
    // coherent snapshot cannot start a stale scene request afterward.
    const refreshedCatalogState = this._catalogState();
    const refreshedEntryId = refreshedCatalogState?.attributes?.entry_id
      || this._panel?.config?.entry_id;
    const refreshedEntities = this._entities(refreshedEntryId);
    const refreshedLiveMap = refreshedEntities.rooms?.[1]
      || refreshedEntities.photo?.[1];
    const refreshedPhotoState = refreshedCatalogState
      || refreshedEntities.photo?.[1];
    const refreshedEntityFloorIncoherent = refreshedLiveMap
      ? refreshedLiveMap.attributes?.map_floor_coherent === false
      : initialFloorIncoherent;
    this._observeFloorCoherence(refreshedLiveMap);
    const refreshedCatalogFloorIncoherent =
      refreshedPhotoState?.attributes?.map_floor_coherent === false;
    const refreshedLiveSelection =
      this._view === "rooms" || !this._selectedHistoryId;
    if (
      refreshedLiveSelection
      && (
        refreshedEntityFloorIncoherent
        || refreshedCatalogFloorIncoherent
      )
    ) {
      this._showFloorTransition(
        refreshedLiveMap || initialLiveMap || refreshedPhotoState,
      );
    } else {
      if (
        !refreshedEntityFloorIncoherent
        && !refreshedCatalogFloorIncoherent
      ) {
        this._markCurrentFloorAvailable();
      }
      if (this._view === "rooms") {
        this._showFallback(
          refreshedEntities.rooms || refreshedEntities.photo,
          force,
        );
      } else if (this._selectedHistoryId && this._scene) {
        this._showSpatialScene();
        const snapshot = this._history.find(
          (candidate) => candidate.id === this._selectedHistoryId,
        );
        if (snapshot) {
          this._setStatus(this._historicalStatus(snapshot));
        }
      } else if (refreshedPhotoState) {
        if (!this._webglAvailable) {
          this._showRenderingFallback(
            refreshedEntities.rooms || refreshedEntities.photo,
            force,
          );
        } else {
          this._fetchScene(refreshedPhotoState, force);
          this._fetchPose(refreshedPhotoState);
          if (
            this._scene
            && (
              this._sceneUrl === refreshedPhotoState.attributes?.scene_url
              || this._isStableLiveScene(refreshedPhotoState)
            )
          ) {
            this._showSpatialScene();
            if (this._isStableLiveScene(refreshedPhotoState)) {
              this._updateStableLiveStatus(refreshedPhotoState);
            } else {
              this._updateSceneStatus(refreshedPhotoState);
            }
          } else {
            this._robot = undefined;
            if (this._showFallback(entities.rooms || entities.photo, force)) {
              this._setStatus(
                this._localize(
                  "map_status_loading_scene",
                  "Loading local 3D scene…",
                ),
              );
            }
          }
        }
      } else if (this._scene) {
        this._showRetainedScene();
      } else {
        const roomMap = entities.rooms;
        if (this._showFallback(roomMap, force) && !roomMap) {
          this._setStatus(
            this._localize(
              "map_status_no_map",
              "No local map data is available yet",
            ),
          );
        }
      }
    }
  }

  _showFallback(selected, force = false) {
    const canvas = this.shadowRoot.querySelector(".scene-canvas");
    const overlays = this.shadowRoot.querySelector(".spatial-overlays");
    const image = this.shadowRoot.querySelector(".map-image");
    canvas.hidden = true;
    overlays.hidden = true;
    if (!selected) {
      this._setPoseStatus("unavailable");
      this._cancelFallbackLoad();
      this._setLoading(false);
      image.hidden = true;
      this._setEmpty(
        this._localize(
          "map_empty_waiting",
          "The local map will appear when the Matic integration is ready.",
        ),
      );
      return true;
    }
    const [entityId, state] = selected;
    const coherent = state.attributes?.map_floor_coherent !== false;
    this._setPoseStatus(
      coherent ? state.attributes?.robot_location_source : "unavailable",
    );
    if (!coherent) {
      return this._showFloorTransition(state);
    }
    const version = `${entityId}:${state.last_updated}:${state.attributes?.map_revision || "rooms"}`;
    const viewport = this.shadowRoot.querySelector(".viewport");
    const pixelRatio = maticClamp(window.devicePixelRatio || 1, 1, 2);
    const requestedWidth = maticClamp(
      Math.ceil(viewport.clientWidth * pixelRatio),
      1024,
      2048,
    );
    const requestedHeight = maticClamp(
      Math.ceil(viewport.clientHeight * pixelRatio),
      1024,
      2048,
    );
    const loadingVersion = `${version}:${requestedWidth}x${requestedHeight}`;
    if (!force && version === this._fallbackVersion && image.naturalWidth > 0) {
      image.hidden = false;
      this._setLoading(false);
      this._setEmpty();
      return true;
    }
    if (
      this._fallbackLoader
      && loadingVersion === this._fallbackLoadingVersion
    ) {
      return true;
    }
    this._cancelFallbackLoad();
    const token = state.attributes?.access_token;
    const query = new URLSearchParams({
      width: String(requestedWidth),
      height: String(requestedHeight),
      t: String(Date.now()),
    });
    if (token) query.set("token", token);
    const loader = new Image();
    this._fallbackLoader = loader;
    this._fallbackLoadingVersion = loadingVersion;
    this._setLoading(true);
    loader.addEventListener("load", () => {
      if (this._fallbackLoader !== loader) return;
      window.clearTimeout(this._fallbackLoadTimer);
      this._fallbackLoadTimer = undefined;
      image.src = loader.src;
      image.hidden = false;
      this._fallbackVersion = version;
      this._fallbackLoader = undefined;
      this._fallbackLoadingVersion = undefined;
      this._setLoading(false);
      this._setEmpty();
      this.shadowRoot.querySelector(".resolution-value").textContent =
        `${loader.naturalWidth} × ${loader.naturalHeight}`;
    }, { once: true });
    loader.addEventListener("error", () => {
      this._handleFallbackLoadFailure(loader, image);
    }, { once: true });
    this._fallbackLoadTimer = window.setTimeout(
      () => this._handleFallbackLoadFailure(loader, image),
      MATIC_FALLBACK_IMAGE_TIMEOUT_MS,
    );
    loader.src = `/api/camera_proxy/${entityId}?${query}`;
    this._setStatus(
      this._view === "rooms"
        ? this._localize("map_status_room_map", "Live labeled room map")
        : this._localize(
          "map_status_loading_data",
          "Loading local 3D data…",
        ),
    );
    this._updateHealth(state);
    return true;
  }

  _showFloorTransition(state) {
    this._latestSceneKey = undefined;
    this._latestSceneState = undefined;
    this._pendingSceneRefresh = false;
    this._pendingSceneForce = false;
    this._stopDeltaStream();
    this._sceneAbortController?.abort();
    this._historySceneAbortController?.abort();
    this._poseAbortController?.abort();
    this._scene = undefined;
    this._sceneUrl = undefined;
    this._sceneIdentity = undefined;
    this._sceneRevision = undefined;
    this._sceneEtag = undefined;
    this._stableLiveSnapshotId = undefined;
    this._stableLiveSourceIdentity = undefined;
    this._stableLiveSourceUrl = undefined;
    this._robot = undefined;
    this._setPoseStatus("unavailable");
    const currentFloor = this._floors.find((floor) => floor.active);
    if (currentFloor) currentFloor.liveAvailable = false;
    if (!this._selectedHistoryId) {
      this._selectedFloorId = currentFloor?.id || "current";
      this._history = currentFloor?.snapshots || [];
    }
    this._syncTimeline();
    this._cancelFallbackLoad();
    this._setLoading(false);
    const canvas = this.shadowRoot.querySelector(".scene-canvas");
    const overlays = this.shadowRoot.querySelector(".spatial-overlays");
    const image = this.shadowRoot.querySelector(".map-image");
    if (canvas) canvas.hidden = true;
    if (overlays) overlays.hidden = true;
    if (image) image.hidden = true;
    const message = this._localize(
      "map_status_floor_transition",
      "Floor transition detected · map paused until localization completes",
    );
    this._setEmpty(message);
    this._setStatus(message, "warning");
    this._updateHealth(state);
    return false;
  }

  _showSpatialScene() {
    if (!this._scene || !this._webglAvailable || this._view === "rooms") return;
    this._cancelFallbackLoad();
    this._setLoading(false);
    this.shadowRoot.querySelector(".scene-canvas").hidden = false;
    this.shadowRoot.querySelector(".spatial-overlays").hidden = false;
    this.shadowRoot.querySelector(".map-image").hidden = true;
    this._setEmpty();
    this._requestRender();
  }

  _showRenderingFallback(selected, force = false) {
    if (!this._showFallback(selected, force)) return;
    this._setStatus(
      this._localize(
        "map_status_rendering_fallback",
        "3D rendering paused · showing the local map",
      ),
      "warning",
    );
  }

  _showRetainedScene() {
    this._showSpatialScene();
    this._setStatus(
      this._localize(
        "map_status_scene_retained",
        "Showing the last local 3D scene · reconnecting…",
      ),
      "warning",
    );
  }

  _cancelFallbackLoad() {
    window.clearTimeout(this._fallbackLoadTimer);
    this._fallbackLoadTimer = undefined;
    const loader = this._fallbackLoader;
    this._fallbackLoader = undefined;
    this._fallbackLoadingVersion = undefined;
    if (loader) loader.src = "";
  }

  _handleFallbackLoadFailure(loader, image) {
    if (this._fallbackLoader !== loader) return;
    window.clearTimeout(this._fallbackLoadTimer);
    this._fallbackLoadTimer = undefined;
    this._fallbackLoader = undefined;
    this._fallbackLoadingVersion = undefined;
    loader.src = "";
    this._setLoading(false);
    const retained = Boolean(
      (this._fallbackVersion && image.getAttribute("src"))
      || (image.complete && image.naturalWidth > 0),
    );
    if (retained) {
      image.hidden = false;
      this._setEmpty();
      this._setStatus(
        this._localize(
          "map_status_image_retained",
          "Showing the last local map · reconnecting…",
        ),
        "warning",
      );
      return;
    }
    image.hidden = true;
    this._setEmpty(
      this._localize(
        "map_empty_load_error",
        "The local map could not be loaded. Try Refresh after reconnecting.",
      ),
    );
    this._setStatus(
      this._localize(
        "map_status_image_unavailable",
        "Local map image is unavailable",
      ),
      "error",
    );
  }

  _setEmpty(message) {
    const empty = this.shadowRoot.querySelector(".empty");
    empty.hidden = !message;
    if (message) empty.textContent = message;
  }

  _setLoading(loading) {
    this.shadowRoot.querySelector(".viewport").classList.toggle("loading", loading);
    this.shadowRoot.querySelector(".viewport").setAttribute(
      "aria-busy",
      String(loading),
    );
  }

  _setStatus(message, tone = "normal") {
    const status = this.shadowRoot.querySelector(".status");
    if (!status) return;
    status.dataset.tone = tone;
    status.setAttribute("aria-live", tone === "error" ? "assertive" : "polite");
    status.textContent = message;
  }

  _updateHealth(state) {
    const badge = this.shadowRoot.querySelector(".health-value");
    if (!badge) return;
    const attributes = state?.attributes || {};
    const mapHealth = String(
      attributes.map_health
      || attributes.stream_health
      || attributes.health?.status
      || "",
    ).toLowerCase();
    const streamState = String(
      attributes.stream_state
      || attributes.collector_state
      || "",
    ).toLowerCase();
    const failures = Number(
      attributes.stream_failures
      ?? attributes.failure_count
      ?? 0,
    );
    const invalidTiles = Number(attributes.invalid_tiles ?? 0);
    const truncated = attributes.map_truncated === true
      || attributes.truncated === true
      || mapHealth.includes("truncat")
      || mapHealth.includes("limit");
    const streamHealthy = streamState.includes("connect")
      || streamState.includes("collect")
      || streamState.includes("run");
    const failed = mapHealth.includes("degrad")
      || invalidTiles > 0
      || mapHealth.includes("error")
      || mapHealth.includes("fail")
      || streamState.includes("retry")
      || streamState.includes("error")
      || streamState.includes("fail")
      || (failures > 0 && !streamHealthy);
    let text;
    let tone = "normal";
    if (failed) {
      text = this._localize(
        "map_health_error",
        "Map stream needs attention",
      );
      tone = "error";
    } else if (truncated) {
      text = this._localize(
        "map_health_limited",
        "Map cache limit reached",
      );
      tone = "warning";
    } else if (streamHealthy) {
      text = this._localize("map_health_live", "Live");
      tone = "live";
    } else {
      const freshness = attributes.updated_at
        || attributes.last_map_update
        || attributes.last_stream_update
        || state?.last_updated;
      const timestamp = freshness ? Date.parse(freshness) : Number.NaN;
      if (Number.isFinite(timestamp)) {
        const elapsedSeconds = Math.round((timestamp - Date.now()) / 1000);
        const [amount, unit] = Math.abs(elapsedSeconds) < 90
          ? [elapsedSeconds, "second"]
          : Math.abs(elapsedSeconds) < 5400
            ? [Math.round(elapsedSeconds / 60), "minute"]
            : [Math.round(elapsedSeconds / 3600), "hour"];
        const relative = new Intl.RelativeTimeFormat(
          this._hass?.language,
          { numeric: "auto" },
        ).format(amount, unit);
        text = this._localize(
          "map_health_updated",
          "Updated {relative}",
          { relative },
        );
      } else if (attributes.map_complete === true) {
        text = this._localize("map_health_ready", "Ready");
      } else {
        text = this._localize("map_health_building", "Map building");
        tone = "live";
      }
    }
    badge.dataset.tone = tone;
    badge.setAttribute("aria-live", tone === "error" ? "assertive" : "polite");
    badge.textContent = text;
    badge.hidden = false;
  }

  _restoreSavedCamera() {
    const view = this._view === "top" ? "top" : "three";
    const saved = this._savedCameras[view];
    if (!saved) {
      this._applyPreset(view, false);
      this._viewCameras[view] = { ...this._camera };
      this._cameraRestored = true;
      return;
    }
    const home = view === "top"
      ? this._homeTopDistance
      : this._homeThreeDistance;
    this._camera = {
      yaw: maticAngleDelta(saved.yaw),
      pitch: view === "top"
        ? Math.PI / 2 - 0.018
        : maticClamp(saved.pitch, 0.18, this._maximumPitch()),
      distance: maticClamp(
        home / saved.zoom,
        Math.max(0.3, this._radius * 0.08),
        this._radius * 8,
      ),
      targetX: saved.targetX,
      targetZ: saved.targetZ,
      orthographic: view === "top",
    };
    this._constrainCameraTarget(this._camera);
    this._viewCameras[view] = { ...this._camera };
    this._cameraRestored = true;
    this._requestRender();
  }

  _syncFullscreenLabel() {
    const button = this.shadowRoot.querySelector(".fullscreen");
    if (!button) return;
    const fullscreen = Boolean(document.fullscreenElement);
    const label = fullscreen
      ? this._localize("exit_fullscreen", "Exit full screen")
      : this._localize("expand_map", "Full screen");
    const controlLabel = button.querySelector(".control-label");
    if (controlLabel) controlLabel.textContent = label;
    const icon = button.querySelector("ha-icon");
    if (icon) {
      icon.setAttribute(
        "icon",
        fullscreen ? "mdi:fullscreen-exit" : "mdi:fullscreen",
      );
    }
    button.setAttribute("aria-label", label);
    button.title = label;
  }

  _syncViewPresentation() {
    const viewport = this.shadowRoot.querySelector(".viewport");
    const help = this.shadowRoot.querySelector(".gesture-help");
    if (!viewport || !help) return;
    if (this._view === "top") {
      viewport.setAttribute(
        "aria-label",
        this._localize(
          "map_viewport_aria_top",
          "Interactive top-down Matic map",
        ),
      );
      help.textContent = this._localize(
        "map_gesture_help_top",
        "Drag to pan · scroll or pinch to zoom · twist to rotate · 0 fits map",
      );
    } else if (this._view === "rooms") {
      viewport.setAttribute(
        "aria-label",
        this._localize("map_viewport_aria_rooms", "Matic labeled room map"),
      );
      help.textContent = this._localize(
        "map_gesture_help_rooms",
        "Use Refresh for the newest room map · F enters full screen",
      );
    } else {
      viewport.setAttribute(
        "aria-label",
        this._localize("map_viewport_aria", "Interactive Matic 3D map"),
      );
      help.textContent = this._localize(
        "map_gesture_help",
        "Drag to orbit · Shift-drag to pan · scroll or pinch to zoom · 0 fits map",
      );
    }
  }

  _calculateHomeDistances() {
    if (!this._scene) return;
    const [spanX, spanY] = this._scene.metadata.span;
    const meters = this._scene.metadata.metersPerCell;
    const worldWidth = spanX * meters;
    const worldDepth = spanY * meters;
    this._radius = Math.max(1, Math.hypot(worldWidth, worldDepth) / 2);
    this._homeThreeDistance = this._radius * 1.72;
    const viewport = this.shadowRoot.querySelector(".viewport");
    const aspect = Math.max(0.2, viewport.clientWidth / Math.max(1, viewport.clientHeight));
    this._homeTopDistance = Math.max(
      worldDepth / 2,
      worldWidth / (2 * aspect),
    ) * 1.12;
  }

  _preset(view) {
    return view === "top"
      ? {
        yaw: 0,
        pitch: Math.PI / 2 - 0.018,
        distance: this._homeTopDistance,
        targetX: 0,
        targetZ: 0,
        orthographic: true,
      }
      : {
        yaw: -Math.PI / 4,
        pitch: 0.82,
        distance: this._homeThreeDistance,
        targetX: 0,
        targetZ: 0,
        orthographic: false,
      };
  }

  _applyPreset(view, animate = true) {
    this._applyCamera(this._preset(view), animate);
  }

  _applyCamera(target, animate = true, duration = 520) {
    this._cancelMotion();
    if (!animate || this._reducedMotion) {
      this._camera = { ...target };
      this._requestRender();
      return;
    }
    const start = { ...this._camera };
    const started = performance.now();
    this._camera.orthographic = target.orthographic;
    const step = (now) => {
      const progress = maticClamp((now - started) / duration, 0, 1);
      const eased = 1 - (1 - progress) ** 3;
      const yawDelta = maticAngleDelta(target.yaw - start.yaw);
      this._camera = {
        yaw: maticAngleDelta(start.yaw + yawDelta * eased),
        pitch: start.pitch + (target.pitch - start.pitch) * eased,
        distance: start.distance + (target.distance - start.distance) * eased,
        targetX: start.targetX + (target.targetX - start.targetX) * eased,
        targetZ: start.targetZ + (target.targetZ - start.targetZ) * eased,
        orthographic: target.orthographic,
      };
      this._requestRender();
      if (progress < 1) this._cameraAnimation = window.requestAnimationFrame(step);
      else this._cameraAnimation = undefined;
    };
    this._cameraAnimation = window.requestAnimationFrame(step);
  }

  _setView(view) {
    if (!["three", "top", "rooms"].includes(view)) return;
    if (["three", "top"].includes(this._view)) {
      this._viewCameras[this._view] = { ...this._camera };
    }
    this._view = view;
    if (["top", "rooms"].includes(view)) this._planView = view;
    if (view === "rooms" && this._selectedHistoryId) {
      this._historySceneAbortController?.abort();
      this._selectedFloorId = "current";
      this._selectedHistoryId = undefined;
      this._history = this._selectedFloor()?.snapshots || [];
    }
    for (const button of this.shadowRoot.querySelectorAll("[data-view]")) {
      const selected = button.dataset.view === view
        || (button.dataset.view === "top" && view === "rooms");
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    }
    const mapStyle = this.shadowRoot.querySelector(".map-style");
    if (mapStyle) mapStyle.value = this._planView;
    const viewport = this.shadowRoot.querySelector(".viewport");
    viewport.classList.toggle("top-down", view === "top");
    viewport.classList.toggle("spatial", view !== "rooms");
    this.shadowRoot.querySelector(".spatial-controls").hidden = view === "rooms";
    this.shadowRoot.querySelector(".layers").hidden = view === "rooms";
    this._syncViewPresentation();
    this._syncTimeline();
    this._schedulePreferencesSave();
    if (view === "rooms") {
      this._cancelMotion();
      this._update(true);
    } else {
      this._showSpatialScene();
      this._applyCamera(
        this._viewCameras[view] || this._preset(view),
      );
      this._update();
    }
  }

  _cancelMotion() {
    window.cancelAnimationFrame(this._cameraAnimation);
    window.cancelAnimationFrame(this._inertiaFrame);
    this._cameraAnimation = undefined;
    this._inertiaFrame = undefined;
  }

  _cameraDistanceBounds() {
    return {
      minimum: Math.max(0.3, this._radius * 0.08),
      maximum: this._radius * 8,
    };
  }

  _elasticClamp(value, minimum, maximum, maximumOvershoot) {
    if (value < minimum) {
      return minimum - Math.min(maximumOvershoot, (minimum - value) * 0.24);
    }
    if (value > maximum) {
      return maximum + Math.min(maximumOvershoot, (value - maximum) * 0.24);
    }
    return value;
  }

  _constrainCameraDistance(value, { elastic = false } = {}) {
    const bounds = this._cameraDistanceBounds();
    return elastic
      ? this._elasticClamp(
        value,
        bounds.minimum,
        bounds.maximum,
        (bounds.maximum - bounds.minimum) * 0.08,
      )
      : maticClamp(value, bounds.minimum, bounds.maximum);
  }

  _zoomPercentageBounds(home) {
    const distance = this._cameraDistanceBounds();
    return {
      minimum: Math.max(1, Math.round(home / distance.maximum * 100)),
      maximum: Math.max(1, Math.round(home / distance.minimum * 100)),
    };
  }

  _zoom(factor) {
    this._cancelMotion();
    const distance = this._cameraDistanceBounds();
    this._camera.distance = maticClamp(
      this._camera.distance / factor,
      distance.minimum,
      distance.maximum,
    );
    this._requestRender();
  }

  _cameraTargetBounds() {
    if (!this._scene) return { x: this._radius, z: this._radius };
    const [spanX, spanY] = this._scene.metadata.span;
    const meters = this._scene.metadata.metersPerCell;
    return {
      x: Math.max(0.5, spanX * meters * 0.45),
      z: Math.max(0.5, spanY * meters * 0.45),
    };
  }

  _constrainCameraTarget(camera, { elastic = false } = {}) {
    const bounds = this._cameraTargetBounds();
    camera.targetX = elastic
      ? this._elasticClamp(camera.targetX, -bounds.x, bounds.x, bounds.x * 0.1)
      : maticClamp(camera.targetX, -bounds.x, bounds.x);
    camera.targetZ = elastic
      ? this._elasticClamp(camera.targetZ, -bounds.z, bounds.z, bounds.z * 0.1)
      : maticClamp(camera.targetZ, -bounds.z, bounds.z);
    return camera;
  }

  _settleCamera() {
    const target = this._constrainCameraTarget({
      ...this._camera,
      distance: this._constrainCameraDistance(this._camera.distance),
    });
    const displacement = Math.max(
      Math.abs(target.distance - this._camera.distance),
      Math.abs(target.targetX - this._camera.targetX),
      Math.abs(target.targetZ - this._camera.targetZ),
    );
    if (displacement > 0.0001) this._applyCamera(target, true, 220);
  }

  _isMouseWheel(event, deltaX, deltaY) {
    return event.deltaMode !== 0
      || (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) >= 50);
  }

  _maximumPitch() {
    return this._view === "three" ? 1.38 : Math.PI / 2 - 0.018;
  }

  _panValues(camera, deltaX, deltaY, options = {}) {
    const viewport = this.shadowRoot.querySelector(".viewport");
    const worldPerPixel = camera.distance / Math.max(200, viewport.clientHeight) * 1.75;
    const rightX = Math.cos(camera.yaw);
    const rightZ = -Math.sin(camera.yaw);
    const forwardX = -Math.sin(camera.yaw);
    const forwardZ = -Math.cos(camera.yaw);
    return this._constrainCameraTarget({
      targetX: camera.targetX
        - deltaX * worldPerPixel * rightX
        + deltaY * worldPerPixel * forwardX,
      targetZ: camera.targetZ
        - deltaX * worldPerPixel * rightZ
        + deltaY * worldPerPixel * forwardZ,
    }, options);
  }

  _panBy(deltaX, deltaY, options = {}) {
    const target = this._panValues(this._camera, deltaX, deltaY, options);
    this._camera.targetX = target.targetX;
    this._camera.targetZ = target.targetZ;
    this._requestRender();
  }

  _startInertia(velocityX, velocityY, mode) {
    this._cancelMotion();
    if (this._reducedMotion) return;
    velocityX = maticClamp(velocityX, -0.55, 0.55);
    velocityY = maticClamp(velocityY, -0.55, 0.55);
    if (Math.hypot(velocityX, velocityY) < 0.02) return;
    let last = performance.now();
    const step = (now) => {
      const elapsed = Math.min(32, now - last);
      last = now;
      if (mode === "orbit") {
        this._camera.yaw = maticAngleDelta(
          this._camera.yaw + velocityX * elapsed * 0.006,
        );
        this._camera.pitch = maticClamp(
          this._camera.pitch - velocityY * elapsed * 0.004,
          0.18,
          this._maximumPitch(),
        );
      } else {
        this._panBy(velocityX * elapsed, velocityY * elapsed, { elastic: true });
      }
      const decay = 0.9 ** (elapsed / 16);
      velocityX *= decay;
      velocityY *= decay;
      this._requestRender();
      if (Math.hypot(velocityX, velocityY) >= 0.01) {
        this._inertiaFrame = window.requestAnimationFrame(step);
      } else {
        this._inertiaFrame = undefined;
        this._settleCamera();
      }
    };
    this._inertiaFrame = window.requestAnimationFrame(step);
  }

  _cameraMatrices() {
    const viewport = this.shadowRoot.querySelector(".viewport");
    const aspect = Math.max(0.2, viewport.clientWidth / Math.max(1, viewport.clientHeight));
    const horizontal = Math.cos(this._camera.pitch) * this._camera.distance;
    const eye = [
      this._camera.targetX + Math.sin(this._camera.yaw) * horizontal,
      Math.sin(this._camera.pitch) * this._camera.distance,
      this._camera.targetZ + Math.cos(this._camera.yaw) * horizontal,
    ];
    const target = [this._camera.targetX, 0, this._camera.targetZ];
    const view = maticLookAt(eye, target);
    const projection = this._camera.orthographic
      ? maticOrthographic(
        -this._camera.distance * aspect,
        this._camera.distance * aspect,
        -this._camera.distance,
        this._camera.distance,
        -this._radius * 4,
        this._radius * 4,
      )
      : maticPerspective(
        Math.PI / 3.15,
        aspect,
        0.02,
        Math.max(60, this._radius * 12),
      );
    return maticMat4Multiply(projection, view);
  }

  _resizeCanvas() {
    const canvas = this.shadowRoot.querySelector(".scene-canvas");
    if (!canvas) return;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
    const width = Math.max(1, Math.round(canvas.clientWidth * pixelRatio));
    const height = Math.max(1, Math.round(canvas.clientHeight * pixelRatio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      this._calculateHomeDistances();
    }
  }

  _requestRender() {
    if (this._renderFrame) return;
    this._renderFrame = window.requestAnimationFrame(() => {
      this._renderFrame = undefined;
      this._renderScene();
    });
  }

  _renderScene() {
    if (
      !this._webglAvailable
      || !this._gl
      || !this._scene
      || this._view === "rooms"
    ) return;
    this._resizeCanvas();
    const canvas = this.shadowRoot.querySelector(".scene-canvas");
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
    this._viewProjection = this._cameraMatrices();
    this._gl.viewport(0, 0, canvas.width, canvas.height);
    this._gl.clearColor(0, 0, 0, 0);
    this._gl.clear(this._gl.COLOR_BUFFER_BIT | this._gl.DEPTH_BUFFER_BIT);
    this._gl.useProgram(this._pointProgram);
    this._gl.bindVertexArray(this._pointVertexArray);
    this._gl.uniformMatrix4fv(
      this._uniforms.viewProjection,
      false,
      this._viewProjection,
    );
    this._gl.uniform2f(
      this._uniforms.center,
      (this._scene.metadata.span[0] - 1) / 2,
      (this._scene.metadata.span[1] - 1) / 2,
    );
    this._gl.uniform1f(
      this._uniforms.meters,
      this._scene.metadata.metersPerCell,
    );
    const perspectiveScale = canvas.height * 0.038;
    this._gl.uniform1f(this._uniforms.pointPixels, perspectiveScale);
    this._gl.uniform1f(this._uniforms.maxPointPixels, 4.5 * pixelRatio);
    this._gl.drawArrays(
      this._gl.POINTS,
      0,
      this._renderFloorCount ?? this._scene.floorCount,
    );
    this._gl.uniform1f(this._uniforms.pointPixels, canvas.height * 0.05);
    this._gl.uniform1f(this._uniforms.maxPointPixels, 7 * pixelRatio);
    this._gl.drawArrays(
      this._gl.POINTS,
      this._renderFloorCount ?? this._scene.floorCount,
      this._renderSurfaceCount ?? this._scene.surfaceCount,
    );
    this._gl.bindVertexArray(null);
    this._updateOverlays();
    const home = this._camera.orthographic
      ? this._homeTopDistance
      : this._homeThreeDistance;
    const zoom = Math.round(home / this._camera.distance * 100);
    const zoomBounds = this._zoomPercentageBounds(home);
    this.shadowRoot.querySelector(".zoom-value").textContent = `${zoom}%`;
    const zoomSlider = this.shadowRoot.querySelector(".zoom-slider");
    zoomSlider.min = String(zoomBounds.minimum);
    zoomSlider.max = String(zoomBounds.maximum);
    zoomSlider.value = String(maticClamp(
      zoom,
      zoomBounds.minimum,
      zoomBounds.maximum,
    ));
    this.shadowRoot.querySelector(".angle-value").textContent =
      `${Math.round((maticAngleDelta(this._camera.yaw) * 180) / Math.PI)}° · ${Math.round((this._camera.pitch * 180) / Math.PI)}°`;
    this._schedulePreferencesSave();
  }

  _worldForCell(x, y, height = 0) {
    const metadata = this._scene.metadata;
    return [
      -(x - (metadata.span[0] - 1) / 2) * metadata.metersPerCell,
      height * metadata.metersPerCell,
      (y - (metadata.span[1] - 1) / 2) * metadata.metersPerCell,
    ];
  }

  _project(world) {
    if (!this._viewProjection) return undefined;
    const matrix = this._viewProjection;
    const x = world[0];
    const y = world[1];
    const z = world[2];
    const clipX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
    const clipY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
    const clipW = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
    if (clipW <= 0.001) return undefined;
    const viewport = this.shadowRoot.querySelector(".viewport");
    return {
      x: (clipX / clipW * 0.5 + 0.5) * viewport.clientWidth,
      y: (-clipY / clipW * 0.5 + 0.5) * viewport.clientHeight,
      visible: Math.abs(clipX / clipW) <= 1.08 && Math.abs(clipY / clipW) <= 1.08,
    };
  }

  _rebuildOverlays() {
    const svg = this.shadowRoot.querySelector(".room-lines");
    const labels = this.shadowRoot.querySelector(".room-labels");
    svg.replaceChildren();
    labels.replaceChildren();
    for (const room of this._scene?.metadata?.rooms || []) {
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.classList.add("room-boundary");
      for (const contour of room.contours) {
        const shape = document.createElementNS(
          "http://www.w3.org/2000/svg",
          contour.closed ? "polygon" : "polyline",
        );
        shape.classList.add("room-boundary-shape");
        group.append(shape);
      }
      svg.append(group);
      const label = document.createElement("span");
      label.className = "room-label";
      label.textContent = room.name;
      labels.append(label);
    }
  }

  _updateOverlays() {
    if (!this._scene) return;
    const viewport = this.shadowRoot.querySelector(".viewport");
    const svg = this.shadowRoot.querySelector(".room-lines");
    svg.setAttribute("viewBox", `0 0 ${viewport.clientWidth} ${viewport.clientHeight}`);
    const boundaries = svg.querySelectorAll(".room-boundary");
    const labels = this.shadowRoot.querySelectorAll(".room-label");
    this._scene.metadata.rooms.forEach((room, index) => {
      const boundary = boundaries[index];
      boundary.toggleAttribute("hidden", !this._labelsVisible);
      const shapes = boundary.querySelectorAll(".room-boundary-shape");
      room.contours.forEach((contour, contourIndex) => {
        const projected = contour.points.map(([x, y]) =>
          this._project(this._worldForCell(x, y, 0.2)));
        const valid = projected.every((point) => point?.visible);
        shapes[contourIndex].toggleAttribute(
          "hidden",
          !valid || !this._labelsVisible,
        );
        if (valid) {
          shapes[contourIndex].setAttribute(
            "points",
            projected.map((point) => `${point.x},${point.y}`).join(" "),
          );
        }
      });
      const center = this._project(this._worldForCell(...room.center, 1));
      labels[index].hidden = !center?.visible || !this._labelsVisible;
      if (center?.visible) {
        labels[index].style.transform = `translate(${center.x}px, ${center.y}px) translate(-50%, -50%)`;
      }
    });
    const marker = this.shadowRoot.querySelector(".robot-marker");
    if (!this._robot) {
      marker.hidden = true;
      return;
    }
    const point = this._project(this._worldForCell(this._robot.x, this._robot.y, 3));
    marker.hidden = !point?.visible;
    if (point?.visible) {
      marker.style.transform = `translate(${point.x}px, ${point.y}px) translate(-50%, -50%)`;
      const source = this._robot.source.replaceAll("_", " ");
      marker.title = this._localize(
        "map_robot_position",
        "Robot position · {source}",
        { source },
      );
      marker.setAttribute("aria-label", marker.title);
    }
  }

  _handleKeyDown(event) {
    if (event.defaultPrevented) return;
    const key = event.key.toLowerCase();
    if (event.key === "+" || event.key === "=") this._zoom(1.2);
    else if (event.key === "-") this._zoom(1 / 1.2);
    else if (key === "3") this._setView("three");
    else if (key === "t") this._setView("top");
    else if (key === "m") this._setView("rooms");
    else if (key === "h" || event.key === "0") this._applyPreset(this._view);
    else if (key === "l") {
      this._labelsVisible = !this._labelsVisible;
      const button = this.shadowRoot.querySelector(".layers");
      button.classList.toggle("selected", this._labelsVisible);
      button.setAttribute("aria-pressed", String(this._labelsVisible));
      this._schedulePreferencesSave();
      this._requestRender();
    } else if (key === "r") this._update(true);
    else if (key === "f") {
      if (document.fullscreenElement) document.exitFullscreen();
      else this.shadowRoot.querySelector(".shell").requestFullscreen();
    } else if (event.key === "?") {
      const help = this.shadowRoot.querySelector(".gesture-help");
      help.hidden = !help.hidden;
      this.shadowRoot.querySelector(".help").setAttribute(
        "aria-expanded",
        String(!help.hidden),
      );
    } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      if (event.shiftKey || this._view === "top") {
        const horizontal = event.key === "ArrowLeft" ? 30 : event.key === "ArrowRight" ? -30 : 0;
        const vertical = event.key === "ArrowUp" ? 30 : event.key === "ArrowDown" ? -30 : 0;
        this._panBy(horizontal, vertical);
      } else {
        if (event.key === "ArrowLeft") {
          this._camera.yaw = maticAngleDelta(this._camera.yaw - 0.12);
        }
        if (event.key === "ArrowRight") {
          this._camera.yaw = maticAngleDelta(this._camera.yaw + 0.12);
        }
        if (event.key === "ArrowUp") this._camera.pitch += 0.08;
        if (event.key === "ArrowDown") this._camera.pitch -= 0.08;
        this._camera.pitch = maticClamp(
          this._camera.pitch,
          0.18,
          this._maximumPitch(),
        );
        this._requestRender();
      }
    } else return;
    event.preventDefault();
  }

  _bindGestures(viewport) {
    viewport.addEventListener("contextmenu", (event) => event.preventDefault());
    viewport.addEventListener("wheel", (event) => {
      if (this._view === "rooms") return;
      event.preventDefault();
      viewport.focus({ preventScroll: true });
      this._cancelMotion();
      const unit = event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? Math.max(1, viewport.clientHeight)
          : 1;
      const deltaX = event.deltaX * unit;
      const deltaY = event.deltaY * unit;
      if (event.ctrlKey || event.metaKey) {
        this._zoom(Math.exp(maticClamp(-deltaY * 0.008, -0.28, 0.28)));
      } else if (event.altKey && this._view === "three") {
        this._camera.pitch = maticClamp(
          this._camera.pitch - deltaY * 0.003,
          0.18,
          this._maximumPitch(),
        );
        this._requestRender();
      } else if (this._isMouseWheel(event, deltaX, deltaY)) {
        this._zoom(Math.exp(maticClamp(-deltaY * 0.0025, -0.28, 0.28)));
      } else {
        this._panBy(
          -maticClamp(deltaX, -80, 80),
          -maticClamp(deltaY, -80, 80),
        );
      }
    }, { passive: false });
    viewport.addEventListener("pointerdown", (event) => {
      if (this._view === "rooms") return;
      if (event.pointerType === "mouse" && ![0, 1, 2].includes(event.button)) return;
      event.preventDefault();
      viewport.focus({ preventScroll: true });
      this._cancelMotion();
      try {
        viewport.setPointerCapture(event.pointerId);
      } catch (_error) {
        return;
      }
      const now = performance.now();
      const lastTap = this._lastTouchTap;
      const isDoubleTap = event.pointerType === "touch"
        && this._pointers.size === 0
        && lastTap
        && now - lastTap.time <= 320
        && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) <= 28;
      this._pointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
        pointerType: event.pointerType,
      });
      if (isDoubleTap) {
        const bounds = viewport.getBoundingClientRect();
        const focused = this._panValues(
          this._camera,
          (bounds.left + bounds.width / 2 - event.clientX) * 0.55,
          (bounds.top + bounds.height / 2 - event.clientY) * 0.55,
        );
        this._doubleTapZoom = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
          camera: {
            ...this._camera,
            targetX: focused.targetX,
            targetZ: focused.targetZ,
          },
        };
        this._handledTouchDoubleTapAt = now;
        this._lastTouchTap = undefined;
        this._drag = undefined;
        viewport.classList.add("moving");
        return;
      }
      if (lastTap && now - lastTap.time > 320) this._lastTouchTap = undefined;
      if (this._pointers.size === 1) {
        this._drag = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          lastX: event.clientX,
          lastY: event.clientY,
          lastTime: performance.now(),
          velocityX: 0,
          velocityY: 0,
          startTime: now,
          moved: 0,
          pointerType: event.pointerType,
          camera: { ...this._camera },
          mode: this._view === "top" || event.shiftKey || [1, 2].includes(event.button)
            ? "pan"
            : "orbit",
        };
      } else if (this._pointers.size === 2) {
        const [first, second] = [...this._pointers.values()];
        this._lastTouchTap = undefined;
        this._doubleTapZoom = undefined;
        this._drag = undefined;
        this._pinch = {
          distance: Math.hypot(second.x - first.x, second.y - first.y),
          angle: Math.atan2(second.y - first.y, second.x - first.x),
          centerX: (first.x + second.x) / 2,
          centerY: (first.y + second.y) / 2,
          camera: { ...this._camera },
        };
      }
      viewport.classList.add("moving");
    });
    viewport.addEventListener("pointermove", (event) => {
      if (!this._pointers.has(event.pointerId)) return;
      event.preventDefault();
      const samples = event.getCoalescedEvents?.() || [];
      const sample = samples[samples.length - 1] || event;
      this._pointers.set(
        event.pointerId,
        {
          ...this._pointers.get(event.pointerId),
          x: sample.clientX,
          y: sample.clientY,
          pointerType: event.pointerType,
        },
      );
      if (this._doubleTapZoom?.pointerId === event.pointerId) {
        const gesture = this._doubleTapZoom;
        const deltaY = sample.clientY - gesture.startY;
        gesture.moved ||= Math.hypot(
          sample.clientX - gesture.startX,
          deltaY,
        ) > 5;
        this._camera = {
          ...gesture.camera,
          distance: this._constrainCameraDistance(
            gesture.camera.distance * Math.exp(
              maticClamp(deltaY * 0.009, -2.2, 2.2),
            ),
            { elastic: true },
          ),
        };
        this._requestRender();
        return;
      }
      if (this._pinch && this._pointers.size >= 2) {
        const [first, second] = [...this._pointers.values()];
        const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
        const angle = Math.atan2(second.y - first.y, second.x - first.x);
        const centerX = (first.x + second.x) / 2;
        const centerY = (first.y + second.y) / 2;
        const start = this._pinch.camera;
        this._camera.distance = this._constrainCameraDistance(
          start.distance * this._pinch.distance / distance,
          { elastic: true },
        );
        this._camera.yaw = maticAngleDelta(
          start.yaw + maticAngleDelta(angle - this._pinch.angle),
        );
        this._camera.pitch = this._view === "top"
          ? Math.PI / 2 - 0.018
          : maticClamp(
            start.pitch - (centerY - this._pinch.centerY) * 0.0035,
            0.18,
            this._maximumPitch(),
          );
        const panned = this._panValues(
          start,
          centerX - this._pinch.centerX,
          0,
          { elastic: true },
        );
        this._camera.targetX = panned.targetX;
        this._camera.targetZ = panned.targetZ;
      } else if (event.pointerId === this._drag?.pointerId) {
        const drag = this._drag;
        const deltaX = sample.clientX - drag.x;
        const deltaY = sample.clientY - drag.y;
        const now = performance.now();
        const elapsed = Math.max(1, now - drag.lastTime);
        const velocityX = (sample.clientX - drag.lastX) / elapsed;
        const velocityY = (sample.clientY - drag.lastY) / elapsed;
        drag.velocityX = drag.velocityX * 0.6 + velocityX * 0.4;
        drag.velocityY = drag.velocityY * 0.6 + velocityY * 0.4;
        drag.lastX = sample.clientX;
        drag.lastY = sample.clientY;
        drag.lastTime = now;
        drag.moved = Math.max(drag.moved, Math.hypot(deltaX, deltaY));
        if (drag.mode === "orbit") {
          this._camera.yaw = maticAngleDelta(
            drag.camera.yaw + deltaX * 0.0045,
          );
          this._camera.pitch = maticClamp(
            drag.camera.pitch - deltaY * 0.004,
            0.18,
            this._maximumPitch(),
          );
        } else {
          const target = this._panValues(
            drag.camera,
            deltaX,
            deltaY,
            { elastic: true },
          );
          this._camera.targetX = target.targetX;
          this._camera.targetZ = target.targetZ;
        }
      }
      this._requestRender();
    });
    const finish = (event, cancelled = false) => {
      if (!this._pointers.has(event.pointerId)) return;
      const drag = this._drag;
      const wasPinching = Boolean(this._pinch);
      const wasDoubleTapZoom = this._doubleTapZoom?.pointerId === event.pointerId;
      if (wasDoubleTapZoom) {
        const gesture = this._doubleTapZoom;
        this._doubleTapZoom = undefined;
        if (!cancelled && !gesture.moved) {
          const distance = this._cameraDistanceBounds();
          this._applyCamera({
            ...gesture.camera,
            distance: maticClamp(
              gesture.camera.distance / 1.6,
              distance.minimum,
              distance.maximum,
            ),
          });
        } else if (!cancelled) {
          this._settleCamera();
        }
      }
      this._pointers.delete(event.pointerId);
      this._pinch = undefined;
      const remaining = [...this._pointers.entries()][0];
      this._drag = remaining ? {
        pointerId: remaining[0],
        x: remaining[1].x,
        y: remaining[1].y,
        lastX: remaining[1].x,
        lastY: remaining[1].y,
        lastTime: performance.now(),
        velocityX: 0,
        velocityY: 0,
        startTime: performance.now(),
        moved: 0,
        fromPinch: wasPinching,
        pointerType: remaining[1].pointerType,
        camera: { ...this._camera },
        mode: this._view === "top" ? "pan" : "orbit",
      } : undefined;
      if (!remaining) {
        viewport.classList.remove("moving");
        const isTap = !cancelled
          && !wasPinching
          && !wasDoubleTapZoom
          && drag?.pointerType === "touch"
          && !drag.fromPinch
          && drag.moved <= 8
          && performance.now() - drag.startTime <= 350;
        this._lastTouchTap = isTap
          ? {
            time: performance.now(),
            x: event.clientX,
            y: event.clientY,
          }
          : undefined;
        if (
          !cancelled
          && !wasPinching
          && !wasDoubleTapZoom
          && drag
          && drag.pointerType !== "mouse"
        ) {
          this._startInertia(drag.velocityX, drag.velocityY, drag.mode);
        } else if (!cancelled && !wasDoubleTapZoom) {
          this._settleCamera();
        } else if (cancelled) {
          this._settleCamera();
        }
      }
      if (viewport.hasPointerCapture(event.pointerId)) {
        try {
          viewport.releasePointerCapture(event.pointerId);
        } catch (_error) {
          // Safari can release capture before dispatching pointercancel.
        }
      }
      this._schedulePreferencesSave();
    };
    viewport.addEventListener("pointerup", finish);
    viewport.addEventListener("pointercancel", (event) => finish(event, true));
    viewport.addEventListener("lostpointercapture", (event) => finish(event, true));
    viewport.addEventListener("gesturestart", (event) => {
      if (this._view === "rooms") return;
      event.preventDefault();
      if (this._pointers.size >= 2) {
        this._gesture = undefined;
        return;
      }
      this._cancelMotion();
      this._gesture = {
        camera: { ...this._camera },
        rotation: Number(event.rotation || 0),
      };
    }, { passive: false });
    viewport.addEventListener("gesturechange", (event) => {
      event.preventDefault();
      if (!this._gesture || this._pointers.size >= 2) return;
      const start = this._gesture.camera;
      this._camera.distance = maticClamp(
        start.distance / Math.max(0.1, Number(event.scale || 1)),
        Math.max(0.3, this._radius * 0.08),
        this._radius * 8,
      );
      this._camera.yaw = maticAngleDelta(
        start.yaw
          + (Number(event.rotation || 0) - this._gesture.rotation) * Math.PI / 180,
      );
      this._requestRender();
    }, { passive: false });
    viewport.addEventListener("gestureend", (event) => {
      event.preventDefault();
      this._gesture = undefined;
      this._schedulePreferencesSave();
    }, { passive: false });
    viewport.addEventListener("dblclick", (event) => {
      if (this._view === "rooms") return;
      event.preventDefault();
      if (
        this._handledTouchDoubleTapAt !== undefined
        && performance.now() - this._handledTouchDoubleTapAt < 500
      ) return;
      this._zoom(event.shiftKey ? 1 / 1.6 : 1.6);
    });
  }

  async _openCleaningWorkspace(view) {
    const workspace = this.shadowRoot.querySelector(".areas-workspace");
    if (!workspace.open) {
      // Some embedded HA browser surfaces expose <dialog> without the
      // HTMLDialogElement showModal()/close() methods.  The open attribute
      // still gives the workspace its native dialog presentation and keeps
      // the editor usable there.
      if (typeof workspace.showModal === "function") workspace.showModal();
      else workspace.setAttribute("open", "");
    }
    try {
      await this._ensureAreaEditor();
      await this._setCleaningView(view);
    } catch {
      this._setAreaWorkspaceStatus(
        this._localize("cleaning_workspace_unavailable", "Cleaning workspace is unavailable"),
        "error",
      );
    }
  }

  async _setCleaningView(view) {
    if (view !== "plans" && view !== "areas") return;
    this._cleaningView = view;
    for (const button of this.shadowRoot.querySelectorAll("[data-cleaning-view]")) {
      const selected = button.dataset.cleaningView === view;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-selected", String(selected));
    }
    this.shadowRoot.querySelector(".plan-detail").hidden = view !== "plans";
    this.shadowRoot.querySelector(".area-detail").hidden = view !== "areas";
    this.shadowRoot.querySelector(".plans-toolbar").hidden = view !== "plans";
    this.shadowRoot.querySelector(".areas-toolbar").hidden = view !== "areas";
    if (view === "plans") await this._fetchPlans();
    else await this._fetchAreas();
  }

  async _ensureAreaEditor() {
    if (customElements.get("ha-selector-matic-area")) return;
    if (!this._areaEditorModulePromise) {
      const url = this._catalogState()?.attributes?.area_editor_url;
      if (
        typeof url !== "string"
        || !/^\/matic_robot\/[A-Za-z0-9._-]+\/room-plan-editor\.js$/.test(url)
      ) {
        throw new Error("area editor module URL is unavailable");
      }
      this._areaEditorModulePromise = import(url).catch((error) => {
        this._areaEditorModulePromise = undefined;
        throw error;
      });
    }
    await this._areaEditorModulePromise;
    await customElements.whenDefined("ha-selector-matic-area");
  }

  _closeAreasWorkspace() {
    this._areasAbortController?.abort();
    this._areasAbortController = undefined;
    this._plansAbortController?.abort();
    this._plansAbortController = undefined;
    const workspace = this.shadowRoot.querySelector(".areas-workspace");
    if (!workspace) return;
    if (typeof workspace.close === "function") workspace.close();
    else workspace.removeAttribute("open");
  }

  _setAreaWorkspaceStatus(message, tone = "normal") {
    const status = this.shadowRoot.querySelector(".areas-status");
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
  }

  _setAreaActionStatus(message, tone = "normal") {
    const status = this.shadowRoot.querySelector(".area-feedback");
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
    const sheet = this.shadowRoot.querySelector(".area-fields");
    if (sheet) sheet.dataset.tone = message ? tone : "normal";
    this._syncAreaSheet();
  }

  _syncAreaSheet() {
    const title = this.shadowRoot.querySelector(".area-sheet-title");
    const summary = this.shadowRoot.querySelector(".area-sheet-summary");
    if (!title || !summary) return;
    const name = this.shadowRoot.querySelector(".area-name")?.value.trim();
    const mode = this.shadowRoot.querySelector(".area-mode")?.selectedOptions?.[0]?.text;
    const coverage = this.shadowRoot.querySelector(".area-coverage")
      ?.selectedOptions?.[0]?.text;
    const feedback = this.shadowRoot.querySelector(".area-feedback")?.textContent.trim();
    title.textContent = name || this._localize("area_details", "Area details");
    summary.textContent = feedback || [mode, coverage].filter(Boolean).join(" · ")
      || this._localize("area_details_hint", "Name and cleaning settings");
  }

  _toggleAreaSheet(force = undefined) {
    const sheet = this.shadowRoot.querySelector(".area-fields");
    const toggle = this.shadowRoot.querySelector(".area-sheet-toggle");
    if (!sheet || !toggle) return;
    const expanded = force ?? sheet.dataset.expanded !== "true";
    sheet.dataset.expanded = String(expanded);
    toggle.setAttribute("aria-expanded", String(expanded));
  }

  _resetAreaSavePresentation() {
    const save = this.shadowRoot.querySelector(".area-save");
    if (!save) return;
    const area = this._areas.find(
      (candidate) => candidate.id === this._selectedAreaId,
    );
    save.textContent = area?.can_rebind
      ? this._localize("area_confirm_current", "Confirm on current map")
      : this._localize("area_save", "Save area");
    save.removeAttribute("aria-busy");
  }

  _setPlanActionStatus(message, tone = "normal") {
    const status = this.shadowRoot.querySelector(".plan-feedback");
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
  }

  _resetPlanSavePresentation() {
    const save = this.shadowRoot.querySelector(".plan-save");
    if (!save) return;
    save.textContent = this._localize("plan_save", "Save plan");
    save.removeAttribute("aria-busy");
  }

  async _fetchPlans(selectedId = this._selectedPlanId) {
    const url = this._catalogState()?.attributes?.plans_url;
    if (typeof url !== "string" || !url.startsWith("/")) {
      this._setAreaWorkspaceStatus(
        this._localize("plan_workspace_unavailable", "Plans are unavailable"),
        "error",
      );
      return;
    }
    this._plansAbortController?.abort();
    const controller = new AbortController();
    this._plansAbortController = controller;
    this._setAreaWorkspaceStatus(
      this._localize("plan_workspace_loading", "Loading plans…"),
    );
    try {
      const response = await this._authenticatedFetch(url, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`plan request failed: ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload?.rooms) || !Array.isArray(payload?.plans)) {
        throw new Error("plan payload is invalid");
      }
      this._plansPayload = payload;
      this._plans = payload.plans.slice(0, 256);
      this._renderPlanList();
      const nextId = selectedId && this._plans.some((plan) => plan.id === selectedId)
        ? selectedId
        : (
          this._plans.some((plan) => plan.id === payload.selected_plan)
            ? payload.selected_plan
            : this._plans[0]?.id
        );
      this._selectPlan(nextId);
      this._setAreaWorkspaceStatus(
        this._localize("plan_workspace_count", "{count} saved plans", {
          count: this._plans.length,
        }),
      );
    } catch (error) {
      if (error?.name === "AbortError") return;
      this._setAreaWorkspaceStatus(
        this._localize("plan_workspace_unavailable", "Plans are unavailable"),
        "error",
      );
    } finally {
      if (this._plansAbortController === controller) {
        this._plansAbortController = undefined;
      }
    }
  }

  _renderPlanList() {
    const picker = this.shadowRoot.querySelector(".plans-list");
    picker.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = this._localize("plan_new", "New plan");
    picker.append(placeholder);
    for (const plan of this._plans) {
      const option = document.createElement("option");
      option.value = String(plan.id);
      option.textContent = String(plan.name || plan.id);
      picker.append(option);
    }
    picker.value = this._selectedPlanId || "";
  }

  _planEditorValue(plan) {
    const configured = this._plansPayload?.rooms || [];
    const savedRooms = new Map(
      (plan?.rooms || []).map((room) => [String(room.room_id), room]),
    );
    const orderedIds = [];
    for (const roomId of plan?.room_order || []) {
      const id = String(roomId);
      if (!orderedIds.includes(id)) orderedIds.push(id);
    }
    for (const room of plan?.rooms || []) {
      const id = String(room.room_id);
      if (!orderedIds.includes(id)) orderedIds.push(id);
    }
    for (const room of configured) {
      const id = String(room.room_id);
      if (!orderedIds.includes(id)) orderedIds.push(id);
    }
    return orderedIds.map((roomId) => {
      const saved = savedRooms.get(roomId);
      return {
        room_id: roomId,
        included: Boolean(saved),
        cleaning_mode: saved?.cleaning_mode || "vacuum",
        coverage_setting: saved?.coverage_setting || "standard",
      };
    });
  }

  _planDraft() {
    const editor = this.shadowRoot.querySelector("ha-selector-matic-room-plan");
    const rows = Array.isArray(editor?.value) ? editor.value : [];
    return {
      name: this.shadowRoot.querySelector(".plan-name")?.value.trim() || "",
      enabled: Boolean(this.shadowRoot.querySelector(".plan-enabled")?.checked),
      run_behavior: this.shadowRoot.querySelector(".plan-behavior")?.value
        || "intelligent",
      rooms: rows.filter((room) => room.included).map((room) => ({
        room: String(room.room_id),
        cleaning_mode: room.cleaning_mode || "vacuum",
        coverage_setting: room.coverage_setting || "standard",
      })),
      return_to_base: Boolean(
        this.shadowRoot.querySelector(".plan-return")?.checked,
      ),
      finish_current_room: Boolean(
        this.shadowRoot.querySelector(".plan-finish-room")?.checked,
      ),
      finish_current_room_threshold: Number(
        this.shadowRoot.querySelector(".plan-threshold")?.value || 50,
      ),
    };
  }

  _syncPlanActions() {
    const draft = this._planDraft();
    const valid = Boolean(draft.name && draft.rooms.length);
    const dirty = JSON.stringify(draft) !== this._planBaseline;
    const saved = this._plans.find((plan) => plan.id === this._selectedPlanId);
    const save = this.shadowRoot.querySelector(".plan-save");
    const run = this.shadowRoot.querySelector(".plan-run");
    const select = this.shadowRoot.querySelector(".plan-select");
    if (save) save.disabled = !valid || !dirty;
    if (run) run.disabled = !saved || dirty || !draft.enabled;
    if (select) {
      select.hidden = !saved || this._plansPayload?.selected_plan === saved.id;
      select.disabled = dirty;
    }
    const threshold = this.shadowRoot.querySelector(".plan-threshold");
    if (threshold) threshold.disabled = !draft.finish_current_room;
  }

  _selectPlan(planId) {
    this._selectedPlanId = planId;
    this._deletePlanConfirmation = undefined;
    this._setPlanActionStatus("");
    this._resetPlanSavePresentation();
    const plan = this._plans.find((candidate) => candidate.id === planId);
    this.shadowRoot.querySelector(".plans-list").value = planId || "";
    this.shadowRoot.querySelector(".plan-name").value = plan?.name || "";
    this.shadowRoot.querySelector(".plan-behavior").value =
      plan?.run_behavior || "intelligent";
    this.shadowRoot.querySelector(".plan-enabled").checked =
      plan?.enabled ?? true;
    this.shadowRoot.querySelector(".plan-return").checked =
      plan?.return_to_base ?? true;
    this.shadowRoot.querySelector(".plan-finish-room").checked =
      plan?.finish_current_room ?? false;
    this.shadowRoot.querySelector(".plan-threshold").value = String(
      plan?.finish_current_room_threshold ?? 50,
    );
    const deleteButton = this.shadowRoot.querySelector(".plan-delete");
    deleteButton.hidden = !plan;
    deleteButton.textContent = this._localize("plan_delete", "Delete");
    this.shadowRoot.querySelector(".plan-run").hidden = !plan;
    const host = this.shadowRoot.querySelector(".plan-room-editor-host");
    host.replaceChildren();
    if (!this._plansPayload) return;
    const editor = document.createElement("ha-selector-matic-room-plan");
    editor.hass = this._hass;
    editor.selector = { rooms: this._plansPayload.rooms };
    editor.value = this._planEditorValue(plan);
    editor.addEventListener("value-changed", () => {
      this._setPlanActionStatus("");
      this._resetPlanSavePresentation();
      this._syncPlanActions();
    });
    host.append(editor);
    this._planBaseline = JSON.stringify(this._planDraft());
    this._syncPlanActions();
  }

  async _savePlan() {
    const draft = this._planDraft();
    if (!draft.name || !draft.rooms.length) {
      this._setPlanActionStatus(
        this._localize("plan_workspace_incomplete", "Add a name and at least one room"),
        "error",
      );
      return;
    }
    const entityId = this._entities(this._catalogState()?.attributes?.entry_id)
      .vacuum?.[0];
    if (!entityId) {
      this._setPlanActionStatus(
        this._localize("plan_workspace_unavailable", "Plans are unavailable"),
        "error",
      );
      return;
    }
    const save = this.shadowRoot.querySelector(".plan-save");
    save.disabled = true;
    save.setAttribute("aria-busy", "true");
    save.textContent = this._localize("plan_workspace_saving", "Saving plan…");
    this._setPlanActionStatus("");
    try {
      await this._hass.callService(
        "matic_robot",
        "save_plan",
        {
          ...(this._selectedPlanId ? { plan_id: this._selectedPlanId } : {}),
          ...draft,
          select: !this._selectedPlanId
            || this._plansPayload?.selected_plan === this._selectedPlanId,
        },
        { entity_id: entityId },
      );
      const selectedId = this._selectedPlanId;
      await this._fetchPlans(selectedId);
      this._resetPlanSavePresentation();
      this._setPlanActionStatus(
        this._localize("plan_workspace_saved", "Plan saved"),
        "success",
      );
    } catch (_error) {
      this._resetPlanSavePresentation();
      this._setPlanActionStatus(
        this._localize("plan_workspace_save_failed", "Plan could not be saved"),
        "error",
      );
      this._syncPlanActions();
    }
  }

  async _deletePlan() {
    if (!this._selectedPlanId) return;
    const button = this.shadowRoot.querySelector(".plan-delete");
    if (this._deletePlanConfirmation !== this._selectedPlanId) {
      this._deletePlanConfirmation = this._selectedPlanId;
      button.textContent = this._localize("plan_confirm_delete", "Confirm delete");
      return;
    }
    const entityId = this._entities(this._catalogState()?.attributes?.entry_id)
      .vacuum?.[0];
    try {
      await this._hass.callService(
        "matic_robot",
        "delete_plan",
        { plan: this._selectedPlanId },
        { entity_id: entityId },
      );
      this._selectedPlanId = undefined;
      await this._fetchPlans();
    } catch (_error) {
      this._setPlanActionStatus(
        this._localize("plan_workspace_delete_failed", "Plan could not be deleted"),
        "error",
      );
    }
  }

  async _selectCurrentPlan() {
    if (!this._selectedPlanId) return;
    const entityId = this._entities(this._catalogState()?.attributes?.entry_id)
      .vacuum?.[0];
    try {
      await this._hass.callService(
        "matic_robot",
        "select_plan",
        { plan: this._selectedPlanId },
        { entity_id: entityId },
      );
      await this._fetchPlans(this._selectedPlanId);
      this._setPlanActionStatus(
        this._localize("plan_workspace_selected", "Default plan updated"),
        "success",
      );
    } catch (_error) {
      this._setPlanActionStatus(
        this._localize("plan_workspace_select_failed", "Default plan could not be updated"),
        "error",
      );
    }
  }

  async _runPlan() {
    if (!this._selectedPlanId) return;
    const entityId = this._entities(this._catalogState()?.attributes?.entry_id)
      .vacuum?.[0];
    try {
      await this._hass.callService(
        "matic_robot",
        "run_selected_plan",
        { plan: this._selectedPlanId },
        { entity_id: entityId },
      );
      this._setPlanActionStatus(
        this._localize("plan_workspace_started", "Plan started"),
        "success",
      );
    } catch (_error) {
      this._setPlanActionStatus(
        this._localize("plan_workspace_run_failed", "Plan could not be started"),
        "error",
      );
    }
  }

  async _fetchAreas(selectedId = this._selectedAreaId) {
    const state = this._catalogState();
    const url = state?.attributes?.areas_url;
    if (state?.attributes?.map_floor_coherent === false) {
      this._clearAreaWorkspace();
      this._setAreaWorkspaceStatus(
        this._localize(
          "area_workspace_floor_transition",
          "Custom areas are paused while the active floor changes",
        ),
        "error",
      );
      return;
    }
    if (typeof url !== "string" || !url.startsWith("/")) {
      this._setAreaWorkspaceStatus(
        this._localize("area_workspace_unavailable", "Custom cleaning areas are unavailable"),
        "error",
      );
      return;
    }
    this._areasAbortController?.abort();
    const controller = new AbortController();
    this._areasAbortController = controller;
    this._setAreaWorkspaceStatus(
      this._localize("area_workspace_loading", "Loading custom cleaning areas…"),
    );
    try {
      const response = await this._authenticatedFetch(url, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`area request failed: ${response.status}`);
      const payload = await response.json();
      if (
        !Array.isArray(payload?.rooms)
        || !Array.isArray(payload?.areas)
        || typeof payload?.scene_url !== "string"
      ) throw new Error("area payload is invalid");
      this._areasPayload = payload;
      this._areas = payload.areas.slice(0, 256);
      this._renderAreaList();
      const nextId = selectedId
        && this._areas.some((area) => area.id === selectedId)
        ? selectedId
        : this._areas[0]?.id;
      this._selectArea(nextId);
      this._setAreaWorkspaceStatus(
        this._localize(
          "area_workspace_count",
          "{count} saved areas",
          { count: this._areas.length },
        ),
      );
    } catch (error) {
      if (error?.name === "AbortError") return;
      this._clearAreaWorkspace();
      this._setAreaWorkspaceStatus(
        this._localize("area_workspace_unavailable", "Custom cleaning areas are unavailable"),
        "error",
      );
    } finally {
      if (this._areasAbortController === controller) {
        this._areasAbortController = undefined;
      }
    }
  }

  _clearAreaWorkspace() {
    this._areasPayload = undefined;
    this._areas = [];
    this._selectedAreaId = undefined;
    this._renderAreaList();
    this._selectArea(undefined);
  }

  _renderAreaList() {
    const picker = this.shadowRoot.querySelector(".areas-list");
    picker.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = this._localize("area_new", "New area");
    picker.append(placeholder);
    for (const area of this._areas) {
      const option = document.createElement("option");
      option.value = String(area.id);
      option.textContent = `${area.status === "current" ? "" : "⚠ "}${String(area.name || area.id)}`;
      picker.append(option);
    }
    picker.value = this._selectedAreaId || "";
  }

  _areaDraft() {
    const editor = this.shadowRoot.querySelector("ha-selector-matic-area");
    return {
      name: this.shadowRoot.querySelector(".area-name")?.value.trim() || "",
      cleaning_mode: this.shadowRoot.querySelector(".area-mode")?.value || "vacuum",
      coverage_setting: this.shadowRoot.querySelector(".area-coverage")?.value
        || "standard",
      circles: Array.isArray(editor?.value)
        ? editor.value.map((circle) => ({ ...circle }))
        : [],
    };
  }

  _syncAreaActions() {
    const draft = this._areaDraft();
    const valid = Boolean(draft.name && draft.circles.length);
    const dirty = JSON.stringify(draft) !== this._areaBaseline;
    const area = this._areas.find(
      (candidate) => candidate.id === this._selectedAreaId,
    );
    const save = this.shadowRoot.querySelector(".area-save");
    const run = this.shadowRoot.querySelector(".area-run");
    if (save) save.disabled = !valid || (!dirty && !area?.can_rebind);
    if (run && !run.hidden) run.disabled = dirty;
  }

  _selectArea(areaId) {
    this._selectedAreaId = areaId;
    this._deleteAreaConfirmation = undefined;
    this._setAreaActionStatus("");
    this._resetAreaSavePresentation();
    const area = this._areas.find((candidate) => candidate.id === areaId);
    this.shadowRoot.querySelector(".areas-list").value = areaId || "";
    this.shadowRoot.querySelector(".area-name").value = area?.name || "";
    this.shadowRoot.querySelector(".area-mode").value =
      area?.cleaning_mode || "vacuum";
    this.shadowRoot.querySelector(".area-coverage").value =
      area?.coverage_setting || "standard";
    const deleteButton = this.shadowRoot.querySelector(".area-delete");
    const runButton = this.shadowRoot.querySelector(".area-run");
    deleteButton.hidden = !area;
    deleteButton.textContent = this._localize("area_delete", "Delete");
    runButton.hidden = !area || area.status !== "current";
    const host = this.shadowRoot.querySelector(".area-editor-host");
    host.replaceChildren();
    if (!this._areasPayload) return;
    const editor = document.createElement("ha-selector-matic-area");
    editor.hass = this._hass;
    editor.selector = {
      rooms: this._areasPayload.rooms,
      scene_url: this._areasPayload.scene_url,
      embedded: true,
    };
    editor.value = area?.circles || [];
    editor.addEventListener("value-changed", () => {
      this._setAreaActionStatus("");
      this._syncAreaActions();
    });
    host.append(editor);
    this._areaBaseline = JSON.stringify(this._areaDraft());
    if (area?.can_rebind) {
      this._setAreaActionStatus(
        this._localize(
          "area_review_required",
          "Review the saved outline, then confirm it on the current map.",
        ),
      );
    } else if (area && area.status !== "current") {
      this._setAreaActionStatus(
        this._localize(
          "area_redraw_required",
          "Redraw this area on the current map before saving.",
        ),
        "error",
      );
    }
    this._syncAreaActions();
    this._syncAreaSheet();
  }

  async _saveArea() {
    const editor = this.shadowRoot.querySelector("ha-selector-matic-area");
    const name = this.shadowRoot.querySelector(".area-name").value.trim();
    if (!name || !editor?.reportValidity()) {
      this._setAreaActionStatus(
        this._localize("area_workspace_incomplete", "Add a name and at least one mark"),
        "error",
      );
      return;
    }
    const url = this._catalogState()?.attributes?.areas_url;
    const save = this.shadowRoot.querySelector(".area-save");
    const saving = this._localize("area_workspace_saving", "Saving area…");
    save.disabled = true;
    save.setAttribute("aria-busy", "true");
    save.textContent = saving;
    this._setAreaActionStatus("");
    try {
      const response = await this._authenticatedFetch(url, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(this._selectedAreaId ? { area_id: this._selectedAreaId } : {}),
          name,
          circles: editor.value,
          cleaning_mode: this.shadowRoot.querySelector(".area-mode").value,
          coverage_setting: this.shadowRoot.querySelector(".area-coverage").value,
        }),
      });
      if (!response.ok) throw new Error(`area save failed: ${response.status}`);
      const result = await response.json();
      await this._fetchAreas(result.id);
      const saved = this._localize("area_workspace_saved", "Area saved");
      this._resetAreaSavePresentation();
      this._setAreaActionStatus(saved, "success");
    } catch (_error) {
      this._resetAreaSavePresentation();
      this._setAreaActionStatus(
        this._localize("area_workspace_save_failed", "Area could not be saved"),
        "error",
      );
      this._syncAreaActions();
    }
  }

  async _deleteArea() {
    if (!this._selectedAreaId) return;
    const button = this.shadowRoot.querySelector(".area-delete");
    if (this._deleteAreaConfirmation !== this._selectedAreaId) {
      this._deleteAreaConfirmation = this._selectedAreaId;
      button.textContent = this._localize("area_confirm_delete", "Confirm delete");
      return;
    }
    const url = this._catalogState()?.attributes?.areas_url;
    try {
      const response = await this._authenticatedFetch(
        `${url}?area_id=${encodeURIComponent(this._selectedAreaId)}`,
        { method: "DELETE", cache: "no-store" },
      );
      if (!response.ok) throw new Error(`area delete failed: ${response.status}`);
      this._selectedAreaId = undefined;
      await this._fetchAreas();
    } catch (_error) {
      this._setAreaWorkspaceStatus(
        this._localize("area_workspace_delete_failed", "Area could not be deleted"),
        "error",
      );
    }
  }

  async _runArea() {
    if (!this._selectedAreaId) return;
    const entryId = this._catalogState()?.attributes?.entry_id;
    const vacuumEntityId = this._entities(entryId).vacuum?.[0];
    if (!vacuumEntityId) {
      this._setAreaWorkspaceStatus(
        this._localize("area_workspace_run_failed", "Robot is unavailable"),
        "error",
      );
      return;
    }
    try {
      await this._hass.callService(
        "matic_robot",
        "clean_area",
        { area: this._selectedAreaId },
        { entity_id: vacuumEntityId },
      );
      this._setAreaWorkspaceStatus(
        this._localize("area_workspace_started", "Area cleaning started"),
      );
    } catch (_error) {
      this._setAreaWorkspaceStatus(
        this._localize("area_workspace_run_failed", "Robot is unavailable"),
        "error",
      );
    }
  }

  _render() {
    this._resizeObserver?.disconnect();
    if (this._gl) {
      if (this._pointBuffer) this._gl.deleteBuffer(this._pointBuffer);
      if (this._pointVertexArray) {
        this._gl.deleteVertexArray(this._pointVertexArray);
      }
      if (this._pointProgram) this._gl.deleteProgram(this._pointProgram);
    }
    this._gl = undefined;
    const text = (key, fallback, placeholders = undefined) => maticEscape(
      this._localize(key, fallback, placeholders),
    );
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; height: 100%; min-height: 0; color: var(--primary-text-color); background: var(--primary-background-color, #080d13); color-scheme: light dark; }
        .shell { height: 100dvh; min-height: 500px; display: grid; grid-template-rows: 64px minmax(0, 1fr); overflow: hidden; background: var(--primary-background-color, #080d13); }
        header { display: flex; flex-wrap: nowrap; gap: 12px; align-items: center; min-width: 0; padding: 8px 16px; border-bottom: 1px solid var(--divider-color); background: color-mix(in srgb, var(--primary-background-color, #080d13) 92%, transparent); backdrop-filter: blur(20px) saturate(1.2); -webkit-backdrop-filter: blur(20px) saturate(1.2); z-index: 6; }
        .heading { display: grid; flex: 0 1 auto; min-width: 140px; gap: 1px; }
        h1 { overflow: hidden; margin: 0; font-size: 18px; font-weight: 650; line-height: 1.25; text-overflow: ellipsis; white-space: nowrap; }
        .privacy { overflow: hidden; color: var(--secondary-text-color); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
        .spacer { flex: 1 1 auto; }
        button, a, select { min-height: 44px; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; padding: 0 12px; border: 1px solid var(--divider-color); border-radius: 12px; color: var(--primary-text-color); background: color-mix(in srgb, var(--card-background-color) 94%, transparent); font: inherit; text-decoration: none; cursor: pointer; touch-action: manipulation; transition: border-color .16s ease, background .16s ease, color .16s ease, transform .16s ease; }
        button:hover, a:hover { border-color: color-mix(in srgb, var(--primary-color) 55%, var(--divider-color)); background: color-mix(in srgb, var(--primary-color) 9%, var(--card-background-color)); }
        button:active, a:active { transform: scale(.97); }
        button:disabled { opacity: .42; cursor: default; transform: none; }
        button:focus-visible, a:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
        button.selected { border-color: var(--primary-color); color: var(--primary-color); background: color-mix(in srgb, var(--primary-color) 15%, transparent); }
        .segmented { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 2px; padding: 3px; border: 1px solid var(--divider-color); border-radius: 13px; background: color-mix(in srgb, var(--card-background-color) 75%, transparent); }
        .segmented button { min-height: 34px; padding: 0 13px; border: 0; border-radius: 9px; background: transparent; }
        .segmented button.selected { color: var(--primary-text-color); background: color-mix(in srgb, var(--primary-color) 18%, var(--card-background-color)); box-shadow: 0 1px 3px rgba(0,0,0,.18); }
        .floor-control { min-width: 0; display: inline-flex; flex: 0 1 auto; align-items: center; gap: 7px; color: var(--secondary-text-color); }
        .floor-control ha-icon { width: 19px; height: 19px; flex: 0 0 auto; }
        .floor-control-label { font-size: 11px; font-weight: 600; }
        .floor-select { min-width: 116px; max-width: 190px; min-height: 38px; overflow: hidden; padding: 0 28px 0 10px; border-radius: 10px; text-overflow: ellipsis; white-space: nowrap; }
        .scene-summary { display: flex; flex: 0 1 auto; min-width: 0; align-items: center; gap: 8px; }
        .status { overflow: hidden; max-width: 420px; text-overflow: ellipsis; }
        .zoom-slider { width: 96px; accent-color: var(--primary-color); touch-action: pan-x; }
        .zoom-value, .angle-value, .status, .resolution-value { color: var(--secondary-text-color); font-variant-numeric: tabular-nums; white-space: nowrap; }
        .status[data-tone="error"] { color: var(--error-color); }
        .health-value { padding: 6px 9px; border-radius: 999px; color: var(--secondary-text-color); background: color-mix(in srgb, var(--card-background-color) 82%, transparent); font-size: 11px; white-space: nowrap; }
        .health-value[data-tone="live"]::before { content: ""; display: inline-block; width: 7px; height: 7px; margin-right: 6px; border-radius: 50%; background: #35c759; box-shadow: 0 0 0 3px rgba(53,199,89,.15); }
        .health-value[data-tone="warning"] { color: var(--warning-color, #ff9f0a); }
        .health-value[data-tone="error"] { color: var(--error-color); }
        .quality-control { display: inline-flex; align-items: center; }
        .quality-control select { min-height: 36px; max-width: 126px; border-radius: 10px; }
        .zoom-value { min-width: 42px; text-align: center; }
        .angle-value { min-width: 72px; text-align: center; font-size: 11px; }
        .resolution-value { padding: 7px 10px; border-radius: 999px; background: color-mix(in srgb, var(--card-background-color) 82%, transparent); text-align: center; font-size: 11px; }
        .viewport { position: relative; min-height: 0; overflow: hidden; touch-action: none; overscroll-behavior: contain; cursor: grab; outline: none; contain: strict; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; background: radial-gradient(circle at 50% 30%, #223149, #080d13 68%); transition: background .32s ease; }
        .viewport.top-down { background-color: color-mix(in srgb, var(--primary-background-color, #080d13) 91%, var(--primary-color) 9%); background-image: radial-gradient(color-mix(in srgb, var(--primary-text-color) 14%, transparent) .7px, transparent .8px); background-size: 14px 14px; }
        .viewport:focus-visible { box-shadow: inset 0 0 0 2px var(--primary-color); }
        .viewport.moving { cursor: grabbing; }
        .floating-controls { position: absolute; z-index: 5; border: 1px solid color-mix(in srgb, var(--primary-text-color) 12%, transparent); background: color-mix(in srgb, var(--card-background-color) 78%, transparent); box-shadow: 0 8px 24px rgba(0,0,0,.18); backdrop-filter: blur(20px) saturate(1.15); -webkit-backdrop-filter: blur(20px) saturate(1.15); }
        .spatial-controls { top: 14px; left: 14px; display: inline-flex; align-items: center; gap: 4px; padding: 4px; border-radius: 14px; }
        .spatial-controls > button, .camera-options > summary { width: 38px; min-width: 38px; min-height: 38px; padding: 0; border: 0; border-radius: 10px; background: transparent; }
        .spatial-controls ha-icon { width: 19px; height: 19px; }
        .zoom-control { height: 38px; display: inline-flex; align-items: center; gap: 8px; padding: 0 7px 0 6px; border-left: 1px solid color-mix(in srgb, var(--primary-text-color) 10%, transparent); border-right: 1px solid color-mix(in srgb, var(--primary-text-color) 10%, transparent); }
        .zoom-control .zoom-slider { width: 104px; }
        .zoom-control .zoom-value { min-width: 36px; font-size: 12px; }
        details > summary { list-style: none; cursor: pointer; }
        details > summary::-webkit-details-marker { display: none; }
        .camera-options { position: relative; }
        .camera-options > summary { display: inline-flex; align-items: center; justify-content: center; }
        .camera-options[open] > summary { color: var(--primary-color); background: color-mix(in srgb, var(--primary-color) 13%, transparent); }
        .camera-advanced { position: absolute; top: calc(100% + 10px); left: 0; width: 218px; display: grid; grid-template-columns: repeat(4, 40px); justify-content: space-between; gap: 6px; padding: 10px; border: 1px solid color-mix(in srgb, var(--primary-text-color) 13%, transparent); border-radius: 14px; background: color-mix(in srgb, var(--card-background-color) 94%, transparent); box-shadow: 0 14px 34px rgba(0,0,0,.26); backdrop-filter: blur(22px) saturate(1.2); }
        .camera-advanced button { width: 40px; min-width: 40px; min-height: 40px; padding: 0; border: 0; border-radius: 10px; background: color-mix(in srgb, var(--primary-text-color) 5%, transparent); font-size: 17px; }
        .camera-advanced .angle-value { grid-column: 1 / -1; min-width: 0; padding-top: 2px; text-align: center; }
        .map-command-bar { position: absolute; z-index: 5; top: 14px; right: 14px; display: flex; align-items: center; gap: 10px; }
        .map-command-bar .floating-controls { position: relative; }
        .cleaning-actions { display: inline-flex; align-items: center; gap: 3px; padding: 4px; border-radius: 14px; }
        .cleaning-actions button { min-height: 38px; gap: 7px; padding: 0 12px; border: 0; border-radius: 10px; background: transparent; font-weight: 600; }
        .cleaning-actions button:hover { background: color-mix(in srgb, var(--primary-color) 10%, transparent); }
        .cleaning-actions .cleaning-areas { color: var(--text-primary-color, #fff); background: var(--primary-color); box-shadow: 0 5px 16px color-mix(in srgb, var(--primary-color) 26%, transparent); }
        .cleaning-actions .cleaning-areas:hover { color: var(--text-primary-color, #fff); background: color-mix(in srgb, var(--primary-color) 86%, white); box-shadow: 0 7px 20px color-mix(in srgb, var(--primary-color) 34%, transparent); transform: translateY(-1px); }
        .cleaning-actions ha-icon { width: 20px; height: 20px; --mdc-icon-size: 20px; }
        .map-actions { display: inline-flex; align-items: center; gap: 4px; padding: 4px; border-radius: 14px; }
        .map-actions > button, .map-more > summary { min-width: 38px; min-height: 38px; padding: 0 9px; border: 0; border-radius: 10px; background: transparent; }
        .map-actions > button { width: 38px; }
        .map-actions .layers { width: auto; gap: 7px; padding-inline: 11px; }
        .map-actions ha-icon { width: 20px; height: 20px; }
        .map-more { position: relative; }
        .map-more > summary { display: inline-flex; align-items: center; justify-content: center; }
        .map-more[open] > summary { color: var(--primary-color); background: color-mix(in srgb, var(--primary-color) 13%, transparent); }
        .map-menu { position: absolute; top: calc(100% + 10px); right: 0; width: 210px; display: grid; gap: 3px; padding: 7px; border: 1px solid color-mix(in srgb, var(--primary-text-color) 13%, transparent); border-radius: 14px; background: color-mix(in srgb, var(--card-background-color) 96%, transparent); box-shadow: 0 16px 38px rgba(0,0,0,.28); backdrop-filter: blur(22px) saturate(1.2); }
        .map-menu button { width: 100%; min-height: 40px; justify-content: flex-start; gap: 10px; padding: 0 10px; border: 0; border-radius: 9px; background: transparent; }
        .map-menu button:hover { background: color-mix(in srgb, var(--primary-color) 9%, transparent); }
        .menu-divider { height: 1px; margin: 4px 3px; background: color-mix(in srgb, var(--primary-text-color) 10%, transparent); }
        .menu-field { display: grid; gap: 5px; padding: 7px 7px 5px; color: var(--secondary-text-color); font-size: 11px; }
        .menu-field select { width: 100%; min-height: 40px; }
        .viewport:not(.spatial) .spatial-controls, .viewport:not(.spatial) .layers { display: none; }
        .top-down .tilt-control, .top-down .angle-value { display: none; }
        .scene-canvas, .map-image, .spatial-overlays { position: absolute; inset: 0; width: 100%; height: 100%; }
        .scene-canvas { display: block; }
        .map-image { object-fit: contain; user-select: none; -webkit-user-drag: none; }
        [hidden] { display: none !important; }
        .spatial-overlays { pointer-events: none; overflow: hidden; }
        .room-lines { display: block; position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
        .room-boundary-shape { fill: color-mix(in srgb, var(--primary-color) 7%, transparent); stroke: rgba(224, 238, 252, .5); stroke-width: 1.25; vector-effect: non-scaling-stroke; }
        polyline.room-boundary-shape { fill: none; }
        .top-down .room-boundary-shape { fill: color-mix(in srgb, var(--primary-color) 6%, transparent); stroke: color-mix(in srgb, var(--primary-text-color) 44%, transparent); }
        .top-down polyline.room-boundary-shape { fill: none; }
        .room-labels { position: absolute; inset: 0; }
        .room-label { position: absolute; top: 0; left: 0; max-width: 150px; overflow: hidden; text-overflow: ellipsis; padding: 3px 7px; border: 1px solid rgba(255,255,255,.14); border-radius: 999px; color: #f7fbff; background: rgba(5, 10, 16, .56); box-shadow: 0 3px 12px rgba(0,0,0,.16); backdrop-filter: blur(9px); font-size: 10px; font-weight: 520; white-space: nowrap; will-change: transform; }
        .top-down .room-label { color: var(--primary-text-color); border-color: color-mix(in srgb, var(--primary-text-color) 18%, transparent); background: color-mix(in srgb, var(--card-background-color) 84%, transparent); }
        .robot-marker { position: absolute; top: 0; left: 0; width: 14px; height: 14px; border: 2px solid #fff; border-radius: 50%; background: #101923; box-shadow: 0 0 0 5px rgba(255,255,255,.16), 0 4px 14px rgba(0,0,0,.3); will-change: transform; }
        .top-down .robot-marker { border-color: #fff; background: #1438d0; box-shadow: 0 0 0 7px rgba(20,56,208,.16), 0 5px 18px rgba(0,0,0,.25); }
        .pose-status { position: absolute; z-index: 4; top: 68px; left: 16px; max-width: min(360px, calc(100% - 32px)); padding: 7px 11px; border: 1px solid color-mix(in srgb, var(--primary-text-color) 16%, transparent); border-radius: 999px; color: var(--primary-text-color); background: color-mix(in srgb, var(--card-background-color) 88%, transparent); box-shadow: 0 6px 20px rgba(0,0,0,.18); backdrop-filter: blur(18px) saturate(1.15); font-size: 12px; line-height: 1.35; pointer-events: none; }
        .viewport.loading::after { content: ""; position: absolute; top: 16px; right: 16px; width: 24px; height: 24px; border: 3px solid rgba(255,255,255,.25); border-top-color: var(--primary-color); border-radius: 50%; animation: spin .8s linear infinite; z-index: 3; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--secondary-text-color); font-size: 17px; text-align: center; padding: 40px; z-index: 2; }
        .timeline { position: absolute; left: 50%; bottom: 16px; width: auto; max-width: calc(100% - 28px); overflow: visible; border: 1px solid rgba(255,255,255,.14); border-radius: 14px; color: #e3edf8; background: rgba(5,10,16,.76); box-shadow: 0 10px 30px rgba(0,0,0,.24); backdrop-filter: blur(20px) saturate(1.18); transform: translateX(-50%); z-index: 4; }
        .timeline > summary { min-width: 164px; min-height: 42px; display: flex; align-items: center; justify-content: center; gap: 7px; padding: 0 11px; border-radius: 13px; font-size: 12px; white-space: nowrap; }
        .timeline > summary:hover { background: rgba(255,255,255,.06); }
        .timeline > summary ha-icon { width: 18px; height: 18px; }
        .timeline-summary-title { font-weight: 650; }
        .timeline-summary-label { max-width: 160px; overflow: hidden; color: color-mix(in srgb, currentColor 72%, transparent); text-overflow: ellipsis; }
        .timeline-chevron { margin-left: 2px; transition: transform .16s ease; transform: rotate(180deg); }
        .timeline[open] .timeline-chevron { transform: rotate(0); }
        .timeline-live-dot { width: 7px; height: 7px; border-radius: 50%; background: #35c759; box-shadow: 0 0 0 3px rgba(53,199,89,.13); }
        .timeline:not([data-live="true"]) .timeline-live-dot { background: var(--primary-color); box-shadow: none; }
        .timeline-panel { position: absolute; left: 50%; bottom: calc(100% + 9px); width: min(500px, calc(100vw - 44px)); display: grid; grid-template-columns: auto minmax(150px, 1fr) auto auto; gap: 7px; align-items: center; padding: 9px; border: 1px solid rgba(255,255,255,.14); border-radius: 14px; background: rgba(5,10,16,.9); box-shadow: 0 14px 36px rgba(0,0,0,.3); backdrop-filter: blur(20px) saturate(1.18); transform: translateX(-50%); }
        .timeline-panel[data-empty="true"] { width: min(360px, calc(100vw - 44px)); display: block; }
        .timeline-panel[data-empty="true"] > :not(.timeline-empty) { display: none; }
        .timeline-empty { display: flex; align-items: center; gap: 9px; padding: 4px 5px; color: color-mix(in srgb, currentColor 76%, transparent); font-size: 12px; line-height: 1.35; }
        .timeline-empty ha-icon { width: 19px; height: 19px; flex: 0 0 auto; }
        .timeline button { min-width: 38px; min-height: 36px; padding: 0 9px; color: inherit; border-color: rgba(255,255,255,.13); background: rgba(255,255,255,.05); }
        .timeline button:disabled { opacity: .38; cursor: default; transform: none; }
        .timeline-track { min-width: 0; display: grid; gap: 3px; }
        .timeline-range { width: 100%; accent-color: var(--primary-color); cursor: pointer; }
        .timeline-label { overflow: hidden; text-overflow: ellipsis; font-size: 11px; font-variant-numeric: tabular-nums; text-align: center; white-space: nowrap; }
        .top-down .timeline { color: var(--primary-text-color); background: color-mix(in srgb, var(--card-background-color) 84%, transparent); border-color: color-mix(in srgb, var(--primary-text-color) 14%, transparent); }
        .top-down .timeline button { border-color: color-mix(in srgb, var(--primary-text-color) 14%, transparent); background: color-mix(in srgb, var(--primary-text-color) 4%, transparent); }
        .top-down .timeline-panel { border-color: color-mix(in srgb, var(--primary-text-color) 14%, transparent); background: color-mix(in srgb, var(--card-background-color) 94%, transparent); }
        .gesture-help { position: absolute; left: 16px; bottom: 82px; max-width: min(680px, calc(100% - 32px)); padding: 10px 13px; border: 1px solid rgba(255,255,255,.14); border-radius: 12px; color: #e3edf8; background: rgba(5,10,16,.76); box-shadow: 0 8px 32px rgba(0,0,0,.25); backdrop-filter: blur(14px); font-size: 12px; pointer-events: none; z-index: 3; }
        .top-down .gesture-help { color: var(--primary-text-color); background: color-mix(in srgb, var(--card-background-color) 86%, transparent); border-color: color-mix(in srgb, var(--primary-text-color) 16%, transparent); }
        .visually-hidden { position: absolute !important; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
        .areas-workspace { width: 100vw; height: 100dvh; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; color: var(--primary-text-color); background: #0b1118; }
        .areas-workspace::backdrop { background: rgba(0, 0, 0, .72); backdrop-filter: blur(5px); }
        .areas-shell { height: 100%; display: grid; grid-template-rows: 64px minmax(0, 1fr); overflow: hidden; }
        .areas-header { display: flex; align-items: center; gap: 12px; padding: 9px 16px; border-bottom: 1px solid color-mix(in srgb, var(--primary-text-color) 10%, transparent); background: color-mix(in srgb, var(--card-background-color) 94%, transparent); z-index: 8; }
        .areas-back { min-width: 40px; padding-inline: 10px; border: 0; background: transparent; font-size: 20px; }
        .areas-heading { min-width: 0; display: grid; gap: 1px; }
        .areas-header h2 { margin: 0; font-size: 17px; line-height: 1.2; }
        .areas-status { color: var(--secondary-text-color); font-size: 12px; }
        .areas-status[data-tone="error"] { color: var(--error-color); }
        .cleaning-tabs { display: inline-flex; align-items: center; gap: 3px; padding: 3px; border: 1px solid color-mix(in srgb, var(--primary-text-color) 12%, transparent); border-radius: 12px; background: color-mix(in srgb, var(--primary-text-color) 5%, transparent); }
        .cleaning-tabs button { min-height: 36px; padding: 0 15px; border: 0; border-radius: 9px; color: var(--secondary-text-color); background: transparent; }
        .cleaning-tabs button.selected { color: var(--primary-text-color); background: color-mix(in srgb, var(--primary-text-color) 11%, transparent); box-shadow: 0 1px 4px rgba(0,0,0,.18); }
        .plans-toolbar, .areas-toolbar { display: flex; align-items: center; gap: 8px; }
        .plans-list,
        .areas-list { width: min(240px, 26vw); min-height: 40px; padding: 0 34px 0 11px; border: 1px solid color-mix(in srgb, var(--primary-text-color) 14%, transparent); border-radius: 11px; color: var(--primary-text-color); background: var(--card-background-color); }
        .plan-new,
        .area-new { min-height: 40px; }
        .plan-detail { min-width: 0; min-height: 0; overflow: auto; background: radial-gradient(circle at 50% 0, color-mix(in srgb, var(--primary-color) 5%, transparent), transparent 38%); }
        .plan-form { width: min(960px, calc(100% - 40px)); display: grid; gap: 22px; margin: 0 auto; padding: 32px 0 80px; }
        .plan-intro { display: grid; gap: 5px; }
        .plan-intro h3 { margin: 0; font-size: 24px; font-weight: 620; letter-spacing: -.02em; }
        .plan-intro p { max-width: 680px; margin: 0; color: var(--secondary-text-color); font-size: 13px; line-height: 1.5; }
        .plan-primary-fields { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(220px, .8fr); gap: 12px; }
        .plan-form label { min-width: 0; display: grid; gap: 6px; color: var(--secondary-text-color); font-size: 12px; }
        .plan-form input[type="text"], .plan-form input[type="number"], .plan-form select { min-height: 46px; padding: 0 12px; border: 1px solid color-mix(in srgb, var(--primary-text-color) 14%, transparent); border-radius: 11px; color: var(--primary-text-color); background: var(--card-background-color); font: inherit; }
        .plan-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; overflow: hidden; border: 1px solid color-mix(in srgb, var(--primary-text-color) 11%, transparent); border-radius: 15px; background: color-mix(in srgb, var(--primary-text-color) 9%, transparent); }
        .plan-option { min-height: 64px; display: flex !important; align-items: center; gap: 12px !important; padding: 10px 14px; color: var(--primary-text-color) !important; background: color-mix(in srgb, var(--card-background-color) 96%, transparent); cursor: pointer; }
        .plan-option input[type="checkbox"] { width: 20px; height: 20px; flex: 0 0 auto; margin: 0; accent-color: var(--primary-color); }
        .plan-option-copy { min-width: 0; display: grid; gap: 2px; }
        .plan-option-copy strong { font-size: 13px; font-weight: 560; }
        .plan-option-copy span { color: var(--secondary-text-color); font-size: 11px; line-height: 1.35; }
        .plan-threshold-field { min-height: 64px; display: grid !important; grid-template-columns: minmax(0, 1fr) 88px; align-items: center; gap: 12px !important; padding: 10px 14px; color: var(--primary-text-color) !important; background: color-mix(in srgb, var(--card-background-color) 96%, transparent); }
        .plan-threshold-field input { width: 100%; box-sizing: border-box; }
        .plan-rooms { display: grid; gap: 10px; }
        .plan-section-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
        .plan-section-heading h3 { margin: 0; font-size: 16px; font-weight: 600; }
        .plan-section-heading span { color: var(--secondary-text-color); font-size: 12px; }
        .plan-room-editor-host { min-height: 150px; overflow: hidden; border: 1px solid color-mix(in srgb, var(--primary-text-color) 11%, transparent); border-radius: 15px; background: color-mix(in srgb, var(--card-background-color) 96%, transparent); }
        .plan-room-editor-host ha-selector-matic-room-plan { display: block; }
        .plan-actions { position: sticky; bottom: 14px; display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 10px; border: 1px solid color-mix(in srgb, var(--primary-text-color) 13%, transparent); border-radius: 15px; background: color-mix(in srgb, var(--card-background-color) 88%, transparent); box-shadow: 0 14px 36px rgba(0,0,0,.28); backdrop-filter: blur(22px) saturate(1.18); z-index: 4; }
        .plan-feedback { min-width: 0; margin-right: auto; padding-left: 4px; color: var(--secondary-text-color); font-size: 12px; }
        .plan-feedback[data-tone="success"] { color: #35c759; }
        .plan-feedback[data-tone="error"] { color: var(--error-color); }
        .plan-save { border-color: var(--primary-color); color: var(--text-primary-color, #fff); background: var(--primary-color); }
        .plan-run { border-color: #35c759; color: #fff; background: #16883a; }
        .plan-delete { color: var(--error-color); }
        .area-detail { position: relative; min-width: 0; min-height: 0; overflow: hidden; }
        .area-fields { position: absolute; right: 16px; bottom: 16px; width: min(410px, calc(100% - 32px)); padding: 12px; border: 1px solid color-mix(in srgb, var(--primary-text-color) 14%, transparent); border-radius: 16px; background: color-mix(in srgb, var(--card-background-color) 90%, transparent); box-shadow: 0 18px 48px rgba(0,0,0,.34); backdrop-filter: blur(22px) saturate(1.18); -webkit-backdrop-filter: blur(22px) saturate(1.18); z-index: 7; }
        .area-sheet-toggle { display: none; }
        .area-sheet-content { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; }
        .area-fields label { min-width: 0; display: grid; gap: 4px; color: var(--secondary-text-color); font-size: 11px; }
        .area-fields input, .area-fields select { min-height: 44px; padding: 0 11px; border: 1px solid var(--divider-color); border-radius: 11px; color: var(--primary-text-color); background: var(--card-background-color); font: inherit; }
        .area-name-label { grid-column: 1 / -1; }
        .area-settings { grid-column: 1 / -1; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding-top: 10px; border-top: 1px solid color-mix(in srgb, var(--primary-text-color) 10%, transparent); }
        .area-actions { grid-column: 1 / -1; display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
        .area-feedback { min-width: 0; margin-right: auto; color: var(--secondary-text-color); font-size: 12px; line-height: 1.3; }
        .area-feedback[data-tone="success"] { color: #35c759; }
        .area-feedback[data-tone="error"] { color: var(--error-color); }
        .area-editor-host { position: absolute; inset: 0; overflow: hidden; }
        .area-editor-host ha-selector-matic-area { height: 100%; }
        .area-save { border-color: var(--primary-color); color: var(--text-primary-color, #fff); background: var(--primary-color); }
        .area-run { border-color: #35c759; color: #fff; background: #16883a; }
        .area-delete { color: var(--error-color); }
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .001ms !important; animation-duration: .001ms !important; animation-iteration-count: 1 !important; }
        }
        @media (max-width: 1050px) { .privacy, .status, .resolution-value, .floor-control-label { display: none; } .heading { min-width: 0; } header { gap: 8px; padding-inline: 10px; } }
        @media (max-width: 760px) { .areas-shell { grid-template-rows: auto minmax(0, 1fr); } .areas-header { flex-wrap: wrap; gap: 7px; padding: 7px 9px; } .areas-heading { flex: 1 1 auto; } .areas-heading .areas-status { display: none; } .cleaning-tabs { order: 3; width: 100%; } .cleaning-tabs button { flex: 1 1 50%; } .plans-toolbar, .areas-toolbar { margin-left: auto; } .plans-list, .areas-list { width: min(210px, 42vw); } .plan-form { width: min(100% - 24px, 960px); padding: 22px 0 70px; } .plan-primary-fields, .plan-options { grid-template-columns: 1fr; } .plan-actions { flex-wrap: wrap; } .plan-feedback { flex: 1 1 100%; padding: 0 4px 2px; } }
        @media (max-width: 650px) {
          .shell { grid-template-rows: 56px minmax(0, 1fr); }
          header { padding-right: max(10px, env(safe-area-inset-right)); padding-left: max(10px, env(safe-area-inset-left)); }
          h1 { font-size: 16px; }
          .privacy { display: none; }
          .heading { flex: 1 1 auto; min-width: 0; }
          .segmented button { min-height: 36px; padding: 0 10px; }
          .floor-control ha-icon { display: none; }
          .floor-select { min-width: 0; width: min(112px, 29vw); padding-left: 8px; }
          .scene-summary { flex: 0 0 auto; }
          .status, .resolution-value { display: none; }
          .health-value { max-width: 72px; overflow: hidden; text-overflow: ellipsis; }
          .camera-options, .spatial-controls .zoom-control { display: none; }
          .spatial-controls { top: max(10px, env(safe-area-inset-top)); left: max(10px, env(safe-area-inset-left)); padding: 3px; border-radius: 13px; }
          .spatial-controls > button { width: 44px; min-width: 44px; min-height: 44px; }
          .map-command-bar { position: static; display: contents; }
          .map-command-bar .floating-controls { position: absolute; }
          .map-actions { top: max(10px, env(safe-area-inset-top)); right: max(10px, env(safe-area-inset-right)); padding: 3px; border-radius: 13px; }
          .map-actions > button, .map-more > summary { width: 44px; min-width: 44px; min-height: 44px; }
          .map-actions .layers { width: 44px; padding-inline: 0; }
          .room-overlay-label { display: none; }
          .cleaning-actions { left: 50%; bottom: calc(64px + max(10px, env(safe-area-inset-bottom))); gap: 2px; padding: 3px; border-radius: 15px; transform: translateX(-50%); }
          .cleaning-actions button { min-height: 46px; gap: 6px; padding-inline: 12px; white-space: nowrap; }
          .cleaning-actions ha-icon { width: 19px; height: 19px; --mdc-icon-size: 19px; }
          .timeline { bottom: max(10px, env(safe-area-inset-bottom)); }
          .timeline > summary { min-width: 142px; min-height: 44px; }
          .timeline-panel { width: min(430px, calc(100vw - 24px)); grid-template-columns: auto minmax(100px, 1fr) auto; gap: 5px; }
          .timeline-live { grid-column: 1 / -1; min-height: 38px !important; }
          .gesture-help { right: 10px; bottom: calc(126px + env(safe-area-inset-bottom)); max-width: none; font-size: 11px; }
          .areas-shell { grid-template-rows: auto minmax(0, 1fr); }
          .areas-header { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; gap: 6px; padding: max(6px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) 6px max(8px, env(safe-area-inset-left)); }
          .areas-back { width: 44px; min-width: 44px; min-height: 44px; padding: 0; }
          .areas-heading { display: none; }
          .areas-header > .spacer { display: none; }
          .cleaning-tabs { grid-column: 1 / -1; grid-row: 2; order: initial; width: auto; padding: 2px; }
          .cleaning-tabs button { min-height: 38px; flex: 1 1 50%; padding-inline: 8px; }
          .plans-toolbar, .areas-toolbar { grid-column: 2 / 4; grid-row: 1; min-width: 0; margin: 0; }
          .plans-list, .areas-list { flex: 1 1 auto; width: auto; min-width: 0; min-height: 44px; }
          .plan-new, .area-new { width: 44px; min-width: 44px; min-height: 44px; overflow: hidden; padding: 0; font-size: 0; }
          .plan-new::before, .area-new::before { content: "+"; font-size: 24px; font-weight: 350; line-height: 1; }
          .plan-form { width: min(100% - 20px, 960px); padding: 18px 0 calc(72px + env(safe-area-inset-bottom)); }
          .area-fields { right: max(8px, env(safe-area-inset-right)); bottom: max(8px, env(safe-area-inset-bottom)); left: max(8px, env(safe-area-inset-left)); width: auto; max-height: min(62dvh, 520px); box-sizing: border-box; overflow: hidden auto; padding: 5px 10px calc(10px + env(safe-area-inset-bottom)); border-radius: 20px; overscroll-behavior: contain; transition: max-height .2s ease, background .2s ease; }
          .area-sheet-toggle { position: relative; width: 100%; min-height: 54px; display: grid; grid-template-columns: minmax(0, 1fr) 28px; align-items: center; gap: 8px; padding: 6px 0 0; border: 0; background: transparent; text-align: left; transform: none !important; }
          .area-sheet-grabber { position: absolute; top: 1px; left: 50%; width: 30px; height: 4px; border-radius: 999px; background: color-mix(in srgb, var(--primary-text-color) 30%, transparent); transform: translateX(-50%); }
          .area-sheet-copy { min-width: 0; display: grid; gap: 1px; }
          .area-sheet-title { overflow: hidden; color: var(--primary-text-color); font-size: 14px; font-weight: 620; text-overflow: ellipsis; white-space: nowrap; }
          .area-sheet-summary { overflow: hidden; color: var(--secondary-text-color); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
          .area-sheet-toggle ha-icon { width: 22px; height: 22px; color: var(--secondary-text-color); transition: transform .2s ease; }
          .area-fields[data-expanded="true"] .area-sheet-toggle ha-icon { transform: rotate(180deg); }
          .area-sheet-content { display: none; grid-template-columns: minmax(0, 1fr); gap: 10px; padding: 5px 2px 2px; }
          .area-fields[data-expanded="true"] .area-sheet-content { display: grid; }
          .area-name-label, .area-settings, .area-actions { grid-column: 1; }
          .area-settings { grid-template-columns: 1fr 1fr; }
          .area-actions { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; }
          .area-feedback { grid-column: 1 / -1; min-height: 0; margin: 0; text-align: center; }
          .area-feedback:empty { display: none; }
          .area-fields[data-tone="success"] .area-sheet-summary { color: #35c759; }
          .area-fields[data-tone="error"] .area-sheet-summary { color: var(--error-color); }
          .area-delete { grid-column: 1 / -1; grid-row: 3; border: 0; background: transparent; }
          .area-run, .area-save { width: 100%; min-height: 48px; }
          .area-run[hidden] + .area-save { grid-column: 1 / -1; }
        }
      </style>
      <div class="shell">
        <header>
          <div class="heading"><h1>${text("map_studio_title", "Matic map studio")}</h1><span class="privacy">${text("map_studio_privacy", "Full local SLAM · private inside Home Assistant")}</span></div>
          <span class="segmented" role="group" aria-label="${text("map_view_label", "Map view")}">
            <button data-view="three" class="${this._view === "three" ? "selected" : ""}" aria-pressed="${this._view === "three"}">${text("map_view_3d", "3D")}</button>
            <button data-view="top" class="${this._view !== "three" ? "selected" : ""}" aria-pressed="${this._view !== "three"}">${text("map_view_top", "2D")}</button>
          </span>
          <label class="floor-control" hidden><ha-icon icon="mdi:layers-triple-outline" aria-hidden="true"></ha-icon><span class="floor-control-label">${text("map_floor_label", "Floor")}</span><select class="floor-select" aria-label="${text("map_floor_label", "Floor")}"></select></label>
          <span class="spacer"></span>
          <span class="scene-summary">
            <span class="status" role="status" aria-live="polite" aria-atomic="true">${text("map_status_loading_scene", "Loading local map…")}</span>
            <span class="health-value" role="status" aria-live="polite" aria-atomic="true" hidden></span>
            <span class="resolution-value">${text("map_loading", "Loading…")}</span>
          </span>
        </header>
        <div class="viewport ${this._view === "top" ? "top-down" : ""} ${this._view !== "rooms" ? "spatial" : ""}" tabindex="0" role="region" aria-busy="true" aria-describedby="map-gesture-help" aria-label="${text("map_viewport_aria", "Interactive Matic map")}">
          <canvas class="scene-canvas" aria-label="${text("map_canvas_aria", "Matic local 3D SLAM scene")}"></canvas>
          <img class="map-image" alt="${text("map_fallback_alt", "Matic local fallback map")}" draggable="false" hidden>
          <div class="spatial-overlays">
            <svg class="room-lines" aria-hidden="true"></svg>
            <div class="room-labels"></div>
            <span class="robot-marker" role="img" hidden></span>
          </div>
          <span class="pose-status" role="status" aria-live="polite" hidden></span>
          <div class="empty">${text("map_empty_loading", "Loading the private local map…")}</div>
          <div class="spatial-controls floating-controls" role="toolbar" aria-label="${text("map_camera_controls", "Map camera controls")}">
            <button class="home-view" aria-label="${text("map_home_view", "Fit map")}" title="${text("map_home_view", "Fit map")}"><ha-icon icon="mdi:fit-to-screen-outline" aria-hidden="true"></ha-icon><span class="control-label visually-hidden">${text("map_home_view", "Fit map")}</span></button>
            <label class="zoom-control">
              <ha-icon icon="mdi:magnify" aria-hidden="true"></ha-icon>
              <input class="zoom-slider" type="range" min="1" max="400" step="1" value="100" aria-label="${text("map_scene_zoom", "Scene zoom")}">
              <span class="zoom-value">100%</span>
            </label>
            <details class="camera-options">
              <summary aria-label="${text("map_camera_controls", "Map camera controls")}" title="${text("map_camera_controls", "Map camera controls")}"><ha-icon icon="mdi:tune-variant" aria-hidden="true"></ha-icon></summary>
              <div class="camera-advanced">
                <button class="rotate-left camera-step" aria-label="${text("map_rotate_left", "Rotate left")}" title="${text("map_rotate_left", "Rotate left")}">↶</button>
                <button class="tilt-down tilt-control camera-step" aria-label="${text("map_tilt_down", "Lower viewing angle")}" title="${text("map_tilt_down", "Lower viewing angle")}">⌄</button>
                <button class="tilt-up tilt-control camera-step" aria-label="${text("map_tilt_up", "Raise viewing angle")}" title="${text("map_tilt_up", "Raise viewing angle")}">⌃</button>
                <button class="rotate-right camera-step" aria-label="${text("map_rotate_right", "Rotate right")}" title="${text("map_rotate_right", "Rotate right")}">↷</button>
                <span class="angle-value">−45° · 47°</span>
              </div>
            </details>
          </div>
          <div class="map-command-bar">
            <nav class="cleaning-actions floating-controls" aria-label="${text("cleaning_workspace_title", "Cleaning")}">
              <button class="cleaning-plans" title="${text("cleaning_workspace_plans", "Plans")}"><ha-icon icon="mdi:format-list-checks" aria-hidden="true"></ha-icon><span class="control-label">${text("cleaning_workspace_plans", "Plans")}</span></button>
              <button class="cleaning-areas" title="${text("cleaning_workspace_areas", "Custom areas")}"><ha-icon icon="mdi:vector-square-edit" aria-hidden="true"></ha-icon><span class="control-label">${text("cleaning_workspace_areas", "Custom areas")}</span></button>
            </nav>
            <div class="map-actions floating-controls" role="toolbar" aria-label="${text("map_actions_label", "Map actions")}">
              <button class="layers ${this._labelsVisible ? "selected" : ""}" aria-label="${text("map_labels", "Room overlay")}" title="${text("map_labels", "Room overlay")}" aria-pressed="${this._labelsVisible}"><ha-icon icon="mdi:vector-polygon" aria-hidden="true"></ha-icon><span class="control-label room-overlay-label">${text("map_rooms", "Rooms")}</span></button>
              <details class="map-more">
              <summary aria-label="${text("map_more", "More map options")}" title="${text("map_more", "More map options")}"><ha-icon icon="mdi:dots-horizontal" aria-hidden="true"></ha-icon></summary>
              <div class="map-menu" role="menu">
                <button class="refresh" role="menuitem"><ha-icon icon="mdi:refresh" aria-hidden="true"></ha-icon><span class="control-label">${text("map_refresh", "Refresh map")}</span></button>
                <button class="fullscreen" role="menuitem"><ha-icon icon="mdi:fullscreen" aria-hidden="true"></ha-icon><span class="control-label">${text("expand_map", "Full screen")}</span></button>
                <button class="help" role="menuitem" aria-expanded="false"><ha-icon icon="mdi:help-circle-outline" aria-hidden="true"></ha-icon><span class="control-label">${text("map_help", "Map help")}</span></button>
                <div class="menu-divider"></div>
                <label class="map-style-control menu-field">
                  <span>${text("map_style_label", "2D map style")}</span>
                  <select class="map-style" aria-label="${text("map_style_label", "2D map style")}">
                    <option value="top" ${this._planView === "top" ? "selected" : ""}>${text("map_style_photo", "Photo map")}</option>
                    <option value="rooms" ${this._planView === "rooms" ? "selected" : ""}>${text("map_view_rooms", "Room map")}</option>
                  </select>
                </label>
                <label class="quality-control menu-field">
                  <span>${text("map_quality_label", "Scene detail")}</span>
                  <select class="quality" aria-label="${text("map_quality_label", "Scene detail")}">
                    <option value="auto" ${this._quality === "auto" ? "selected" : ""}>${text("map_quality_auto", "Auto detail")}</option>
                    <option value="efficient" ${this._quality === "efficient" ? "selected" : ""}>${text("map_quality_efficient", "Efficient")}</option>
                    <option value="balanced" ${this._quality === "balanced" ? "selected" : ""}>${text("map_quality_balanced", "Balanced")}</option>
                    <option value="maximum" ${this._quality === "maximum" ? "selected" : ""}>${text("map_quality_maximum", "Maximum")}</option>
                  </select>
                </label>
              </div>
              </details>
            </div>
          </div>
          <details class="timeline floating-controls" aria-label="${text("map_timeline_label", "Map timeline")}" data-live="true" hidden>
            <summary class="timeline-summary" title="${text("map_timeline_label", "Map timeline")}"><span class="timeline-live-dot"></span><ha-icon icon="mdi:history" aria-hidden="true"></ha-icon><span class="timeline-summary-title">${text("map_timeline_history", "History")}</span><span aria-hidden="true">·</span><span class="timeline-summary-label" aria-live="polite">${text("map_timeline_live_action", "Live")}</span><ha-icon class="timeline-chevron" icon="mdi:chevron-up" aria-hidden="true"></ha-icon></summary>
            <div class="timeline-panel" role="group">
              <div class="timeline-empty" hidden><ha-icon icon="mdi:history" aria-hidden="true"></ha-icon><span>${text("map_timeline_empty", "No saved map snapshots yet. The live map is current.")}</span></div>
              <button class="timeline-earlier" aria-label="${text("map_timeline_earlier", "Earlier map")}">←</button>
              <label class="timeline-track">
                <span class="timeline-label">${text("map_timeline_live", "Live map")}</span>
                <input class="timeline-range" type="range" min="0" max="0" step="1" value="0" aria-label="${text("map_timeline_position", "Map point in time")}">
              </label>
              <button class="timeline-later" aria-label="${text("map_timeline_later", "Later map")}">→</button>
              <button class="timeline-live selected" aria-pressed="true">${text("map_timeline_live_action", "Live")}</button>
            </div>
          </details>
          <div id="map-gesture-help" class="gesture-help">${text("map_gesture_help", "Drag to explore · scroll or pinch to zoom · 0 fits map · ? toggles help")}</div>
        </div>
        <dialog class="areas-workspace">
          <div class="areas-shell">
            <div class="areas-header">
              <button class="areas-close areas-back" aria-label="${text("cleaning_workspace_close", "Back to map")}" title="${text("cleaning_workspace_close", "Back to map")}">←</button>
              <div class="areas-heading"><h2>${text("cleaning_workspace_title", "Cleaning")}</h2><span class="areas-status" role="status" aria-live="polite"></span></div>
              <div class="cleaning-tabs" role="tablist" aria-label="${text("cleaning_workspace_title", "Cleaning")}">
                <button class="cleaning-tab-plans selected" data-cleaning-view="plans" role="tab" aria-selected="true">${text("cleaning_workspace_plans", "Plans")}</button>
                <button class="cleaning-tab-areas" data-cleaning-view="areas" role="tab" aria-selected="false">${text("cleaning_workspace_areas", "Custom areas")}</button>
              </div>
              <span class="spacer"></span>
              <div class="plans-toolbar">
                <select class="plans-list" aria-label="${text("cleaning_workspace_plans", "Plans")}"></select>
                <button class="plan-new">${text("plan_new", "New plan")}</button>
              </div>
              <div class="areas-toolbar" hidden>
                <select class="areas-list" aria-label="${text("area_workspace_title", "Custom cleaning areas")}"></select>
                <button class="area-new">${text("area_new", "New area")}</button>
              </div>
            </div>
            <section class="plan-detail">
              <div class="plan-form">
                <div class="plan-intro">
                  <h3>${text("plan_editor_title", "Cleaning plan")}</h3>
                  <p>${text("plan_editor_intro", "Choose the rooms, order, and stop behavior for this plan.")}</p>
                </div>
                <div class="plan-primary-fields">
                  <label>${text("plan_name", "Plan name")}<input class="plan-name" type="text" maxlength="128" autocomplete="off"></label>
                  <label>${text("plan_run_behavior", "Cleaning order")}<select class="plan-behavior"><option value="intelligent">${text("plan_intelligent", "Intelligent rotation")}</option><option value="ordered">${text("plan_ordered", "Saved order")}</option></select></label>
                </div>
                <div class="plan-options">
                  <label class="plan-option"><input class="plan-enabled" type="checkbox" checked><span class="plan-option-copy"><strong>${text("plan_enabled", "Plan enabled")}</strong><span>${text("plan_enabled_hint", "Allow this plan to run from Home Assistant.")}</span></span></label>
                  <label class="plan-option"><input class="plan-return" type="checkbox" checked><span class="plan-option-copy"><strong>${text("plan_return_to_base", "Return to dock when finished")}</strong><span>${text("plan_return_to_base_hint", "Dock after the last selected room.")}</span></span></label>
                  <label class="plan-option"><input class="plan-finish-room" type="checkbox"><span class="plan-option-copy"><strong>${text("plan_finish_room", "Finish current room when stopping")}</strong><span>${text("plan_finish_room_hint", "Never starts another room after a stop request.")}</span></span></label>
                  <label class="plan-threshold-field"><span class="plan-option-copy"><strong>${text("plan_threshold", "Finish threshold")}</strong><span>${text("plan_threshold_hint", "Finish only when estimated progress reaches this percentage.")}</span></span><input class="plan-threshold" type="number" min="0" max="100" step="5" value="50" inputmode="numeric" aria-label="${text("plan_threshold", "Finish threshold")}"></label>
                </div>
                <div class="plan-rooms">
                  <div class="plan-section-heading"><h3>${text("plan_rooms", "Rooms")}</h3><span>${text("plan_rooms_hint", "Turn rooms on, then drag to set saved order.")}</span></div>
                  <div class="plan-room-editor-host"></div>
                </div>
                <div class="plan-actions"><span class="plan-feedback" role="status" aria-live="polite" aria-atomic="true"></span><button class="plan-delete" hidden>${text("plan_delete", "Delete")}</button><button class="plan-select" hidden>${text("plan_select", "Set as default")}</button><button class="plan-run" hidden>${text("plan_run", "Run now")}</button><button class="plan-save" disabled>${text("plan_save", "Save plan")}</button></div>
              </div>
            </section>
            <section class="area-detail" hidden>
              <div class="area-editor-host"></div>
              <div class="area-fields" data-expanded="false">
                <button class="area-sheet-toggle" type="button" aria-expanded="false" aria-controls="area-sheet-content">
                  <span class="area-sheet-grabber" aria-hidden="true"></span>
                  <span class="area-sheet-copy"><strong class="area-sheet-title">${text("area_details", "Area details")}</strong><span class="area-sheet-summary">${text("area_details_hint", "Name and cleaning settings")}</span></span>
                  <ha-icon icon="mdi:chevron-up" aria-hidden="true"></ha-icon>
                </button>
                <div class="area-sheet-content" id="area-sheet-content">
                  <label class="area-name-label">${text("area_name", "Area name")}<input class="area-name" maxlength="128" autocomplete="off"></label>
                  <div class="area-settings">
                    <label>${text("cleaning_mode", "Cleaning mode")}<select class="area-mode"><option value="vacuum">${text("vacuum", "Vacuum")}</option><option value="mop">${text("mop", "Mop")}</option><option value="vacuum_and_mop">${text("vacuum_and_mop", "Vacuum + mop")}</option></select></label>
                    <label>${text("coverage", "Coverage")}<select class="area-coverage"><option value="quick">${text("quick", "Quick")}</option><option value="standard">${text("standard", "Optimal")}</option><option value="heavy_duty">${text("heavy_duty", "Heavy Duty")}</option></select></label>
                  </div>
                  <div class="area-actions"><span class="area-feedback" role="status" aria-live="polite" aria-atomic="true"></span><button class="area-delete" hidden>${text("area_delete", "Delete")}</button><button class="area-run" hidden>${text("area_run", "Clean now")}</button><button class="area-save">${text("area_save", "Save area")}</button></div>
                </div>
              </div>
            </section>
          </div>
        </dialog>
      </div>
    `;
    this._initWebGL();
    const viewport = this.shadowRoot.querySelector(".viewport");
    this.shadowRoot.querySelector(".spatial-controls").hidden =
      this._view === "rooms";
    this.shadowRoot.querySelector(".layers").hidden = this._view === "rooms";
    this._syncViewPresentation();
    this._bindGestures(viewport);
    for (const control of this.shadowRoot.querySelectorAll(".floating-controls")) {
      control.addEventListener("pointerdown", (event) => event.stopPropagation());
      control.addEventListener("wheel", (event) => event.stopPropagation(), {
        passive: true,
      });
    }
    viewport.addEventListener("pointerdown", (event) => {
      if (event.target.closest(".floating-controls")) return;
      this.shadowRoot.querySelector(".camera-options").open = false;
      this.shadowRoot.querySelector(".map-more").open = false;
    });
    viewport.addEventListener("keydown", (event) => this._handleKeyDown(event));
    this._guardButton(this.shadowRoot.querySelector('[data-view="three"]'), () => this._setView("three"));
    this._guardButton(this.shadowRoot.querySelector('[data-view="top"]'), () => this._setView(this._planView));
    this._guardButton(this.shadowRoot.querySelector(".rotate-left"), () => {
      this._camera.yaw = maticAngleDelta(this._camera.yaw - Math.PI / 12);
      this._requestRender();
    });
    this._guardButton(this.shadowRoot.querySelector(".rotate-right"), () => {
      this._camera.yaw = maticAngleDelta(this._camera.yaw + Math.PI / 12);
      this._requestRender();
    });
    this._guardButton(this.shadowRoot.querySelector(".tilt-down"), () => {
      this._camera.pitch = maticClamp(
        this._camera.pitch - 0.12,
        0.18,
        this._maximumPitch(),
      );
      this._requestRender();
    });
    this._guardButton(this.shadowRoot.querySelector(".tilt-up"), () => {
      this._camera.pitch = maticClamp(
        this._camera.pitch + 0.12,
        0.18,
        this._maximumPitch(),
      );
      this._requestRender();
    });
    this._guardButton(this.shadowRoot.querySelector(".home-view"), () => this._applyPreset(this._view));
    this._guardButton(this.shadowRoot.querySelector(".layers"), () => {
      this._labelsVisible = !this._labelsVisible;
      const button = this.shadowRoot.querySelector(".layers");
      button.classList.toggle("selected", this._labelsVisible);
      button.setAttribute("aria-pressed", String(this._labelsVisible));
      this._schedulePreferencesSave();
      this._requestRender();
    });
    const closeMapMenu = () => {
      this.shadowRoot.querySelector(".map-more").open = false;
    };
    this.shadowRoot.querySelector(".map-style").addEventListener("change", (event) => {
      event.stopPropagation();
      this._setView(event.target.value);
      closeMapMenu();
    });
    this._guardButton(this.shadowRoot.querySelector(".refresh"), () => {
      closeMapMenu();
      this._update(true);
    });
    this._guardButton(this.shadowRoot.querySelector(".cleaning-plans"), () =>
      this._openCleaningWorkspace("plans"));
    this._guardButton(this.shadowRoot.querySelector(".cleaning-areas"), () =>
      this._openCleaningWorkspace("areas"));
    this._guardButton(this.shadowRoot.querySelector(".areas-close"), () =>
      this._closeAreasWorkspace());
    for (const button of this.shadowRoot.querySelectorAll("[data-cleaning-view]")) {
      this._guardButton(button, () => this._setCleaningView(
        button.dataset.cleaningView,
      ));
    }
    this._guardButton(this.shadowRoot.querySelector(".plan-new"), () =>
      this._selectPlan(undefined));
    this.shadowRoot.querySelector(".plans-list").addEventListener(
      "change",
      (event) => this._selectPlan(event.target.value || undefined),
    );
    this._guardButton(this.shadowRoot.querySelector(".plan-save"), () =>
      this._savePlan());
    this._guardButton(this.shadowRoot.querySelector(".plan-delete"), () =>
      this._deletePlan());
    this._guardButton(this.shadowRoot.querySelector(".plan-select"), () =>
      this._selectCurrentPlan());
    this._guardButton(this.shadowRoot.querySelector(".plan-run"), () =>
      this._runPlan());
    for (const field of this.shadowRoot.querySelectorAll(
      ".plan-name, .plan-behavior, .plan-enabled, .plan-return, .plan-finish-room, .plan-threshold",
    )) {
      field.addEventListener(
        field.matches('input[type="text"], input[type="number"]')
          ? "input"
          : "change",
        () => {
          this._setPlanActionStatus("");
          this._resetPlanSavePresentation();
          this._syncPlanActions();
        },
      );
    }
    this._guardButton(this.shadowRoot.querySelector(".area-new"), () =>
      this._selectArea(undefined));
    this._guardButton(this.shadowRoot.querySelector(".area-sheet-toggle"), () =>
      this._toggleAreaSheet());
    this.shadowRoot.querySelector(".areas-list").addEventListener(
      "change",
      (event) => this._selectArea(event.target.value || undefined),
    );
    this._guardButton(this.shadowRoot.querySelector(".area-save"), () =>
      this._saveArea());
    this._guardButton(this.shadowRoot.querySelector(".area-delete"), () =>
      this._deleteArea());
    this._guardButton(this.shadowRoot.querySelector(".area-run"), () =>
      this._runArea());
    for (const field of this.shadowRoot.querySelectorAll(
      ".area-name, .area-mode, .area-coverage",
    )) {
      field.addEventListener(
        field.matches("input") ? "input" : "change",
        () => {
          this._setAreaActionStatus("");
          this._resetAreaSavePresentation();
          this._syncAreaActions();
          this._syncAreaSheet();
        },
      );
    }
    this.shadowRoot.querySelector(".areas-workspace").addEventListener(
      "cancel",
      (event) => {
        event.preventDefault();
        this._closeAreasWorkspace();
      },
    );
    this._guardButton(this.shadowRoot.querySelector(".help"), () => {
      closeMapMenu();
      window.clearTimeout(this._helpTimer);
      const help = this.shadowRoot.querySelector(".gesture-help");
      help.hidden = !help.hidden;
      this.shadowRoot.querySelector(".help").setAttribute(
        "aria-expanded",
        String(!help.hidden),
      );
    });
    this.shadowRoot.querySelector(".floor-select").addEventListener(
      "change",
      (event) => this._selectFloor(event.target.value),
    );
    const timelineRange = this.shadowRoot.querySelector(".timeline-range");
    this._guardButton(this.shadowRoot.querySelector(".timeline-earlier"), () => {
      this._selectTimelinePosition(Number(timelineRange.value) - 1);
    });
    this._guardButton(this.shadowRoot.querySelector(".timeline-later"), () => {
      this._selectTimelinePosition(Number(timelineRange.value) + 1);
    });
    this._guardButton(this.shadowRoot.querySelector(".timeline-live"), () => {
      this._selectTimelinePosition(this._history.length);
    });
    timelineRange.addEventListener("input", (event) => {
      const position = Number(event.target.value);
      const label = this.shadowRoot.querySelector(".timeline-label");
      label.textContent = position === this._history.length
        ? this._localize("map_timeline_live", "Live map")
        : this._formatHistoryTime(this._history[position]?.created_at);
    });
    timelineRange.addEventListener("change", (event) => {
      this._selectTimelinePosition(event.target.value);
    });
    this._guardButton(this.shadowRoot.querySelector(".fullscreen"), () => {
      closeMapMenu();
      if (document.fullscreenElement) document.exitFullscreen();
      else this.shadowRoot.querySelector(".shell").requestFullscreen();
    });
    this.shadowRoot.querySelector(".quality").addEventListener(
      "change",
      (event) => {
        const quality = event.target.value;
        if (!["auto", ...Object.keys(MATIC_MAP_QUALITY_BUDGETS)].includes(
          quality,
        )) return;
        this._quality = quality;
        if (this._scene) {
          this._uploadScene(this._scene);
          const catalogState = this._catalogState();
          const entryId = catalogState?.attributes?.entry_id
            || this._panel?.config?.entry_id;
          const selectedState = catalogState
            || this._entities(entryId).photo?.[1];
          if (selectedState?.attributes?.scene_url === this._sceneUrl) {
            this._updateSceneStatus(selectedState);
          }
          this._requestRender();
        }
        this._schedulePreferencesSave();
      },
    );
    this.shadowRoot.querySelector(".zoom-slider").addEventListener("input", (event) => {
      const home = this._camera.orthographic
        ? this._homeTopDistance
        : this._homeThreeDistance;
      const distance = this._cameraDistanceBounds();
      this._camera.distance = maticClamp(
        home / (Number(event.target.value) / 100),
        distance.minimum,
        distance.maximum,
      );
      this._requestRender();
    });
    const canvas = this.shadowRoot.querySelector(".scene-canvas");
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this._cancelMotion();
      window.cancelAnimationFrame(this._renderFrame);
      this._renderFrame = undefined;
      this._webglAvailable = false;
      this._gl = undefined;
      const entryId = this._catalogState()?.attributes?.entry_id
        || this._panel?.config?.entry_id;
      const entities = this._entities(entryId);
      this._showRenderingFallback(entities.rooms || entities.photo);
    });
    canvas.addEventListener("webglcontextrestored", () => {
      this._initWebGL();
      const entryId = this._catalogState()?.attributes?.entry_id
        || this._panel?.config?.entry_id;
      const entities = this._entities(entryId);
      if (!this._webglAvailable) {
        this._showRenderingFallback(entities.rooms || entities.photo);
        return;
      }
      if (this._view === "rooms") {
        this._showFallback(entities.rooms || entities.photo, true);
        return;
      }
      const selectedState = this._catalogState() || entities.photo?.[1];
      if (
        !this._scene
        || selectedState?.attributes?.scene_url !== this._sceneUrl
      ) {
        this._update(true);
        return;
      }
      this._uploadScene(this._scene);
      this._rebuildOverlays();
      this._resizeCanvas();
      this._showSpatialScene();
      this._updateSceneStatus(selectedState);
    });
    this._resizeObserver = new ResizeObserver(() => {
      this._resizeCanvas();
      this._requestRender();
    });
    this._resizeObserver.observe(viewport);
    this._resizeCanvas();
    this._syncFullscreenLabel();
    this._syncTimeline();
    if (this._scene && this._webglAvailable) {
      this._uploadScene(this._scene);
      this._rebuildOverlays();
      this._showSpatialScene();
    }
  }
}

// Register the current Home Assistant panel first, then keep the previous tag
// as a standalone-test/backward-compatibility alias with its own constructor.
if (!customElements.get("matic-map-panel-v0-3-1")) {
  customElements.define("matic-map-panel-v0-3-1", MaticMapStudio);
}
if (!customElements.get("matic-map-panel-v0-3-0")) {
  class MaticMapStudioV030 extends MaticMapStudio {}
  customElements.define("matic-map-panel-v0-3-0", MaticMapStudioV030);
}
