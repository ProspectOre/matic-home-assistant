const MATIC_SCENE_HEADER_BYTES = 24;
const MATIC_SCENE_POINT_STRIDE = 8;
const MATIC_SCENE_MAX_POINTS = 1500000;

function maticClamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function maticAngleDelta(value) {
  let angle = value;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
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
    this._scene = undefined;
    this._sceneRevision = undefined;
    this._sceneEtag = undefined;
    this._sceneLoading = false;
    this._pendingSceneRefresh = false;
    this._poseLoading = false;
    this._fallbackVersion = undefined;
    this._fallbackLoader = undefined;
    this._pointers = new Map();
    this._drag = undefined;
    this._pinch = undefined;
    this._gesture = undefined;
    this._labelsVisible = true;
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
      const button = this.shadowRoot.querySelector(".fullscreen");
      if (button) {
        button.textContent = document.fullscreenElement
          ? "Exit full screen"
          : "Full screen";
      }
      this._resizeCanvas();
      this._requestRender();
    };
  }

  set hass(value) {
    this._hass = value;
    if (!this.shadowRoot.hasChildNodes()) this._render();
    this._update();
  }

  set panel(value) {
    this._panel = value;
    if (this.isConnected && !this.shadowRoot.hasChildNodes()) this._render();
  }

  connectedCallback() {
    if (!this.shadowRoot.hasChildNodes()) this._render();
    document.addEventListener("fullscreenchange", this._fullscreenHandler);
    this._refreshTimer = window.setInterval(() => this._update(), 5000);
    this._helpTimer = window.setTimeout(() => {
      const help = this.shadowRoot.querySelector(".gesture-help");
      if (help) help.hidden = true;
    }, 9000);
    this._update(true);
  }

  disconnectedCallback() {
    window.clearInterval(this._refreshTimer);
    window.clearTimeout(this._helpTimer);
    window.cancelAnimationFrame(this._renderFrame);
    window.cancelAnimationFrame(this._inertiaFrame);
    window.cancelAnimationFrame(this._cameraAnimation);
    this._resizeObserver?.disconnect();
    if (this._fallbackLoader) this._fallbackLoader.src = "";
    document.removeEventListener("fullscreenchange", this._fullscreenHandler);
    if (this._gl) {
      if (this._pointBuffer) this._gl.deleteBuffer(this._pointBuffer);
      if (this._pointVertexArray) {
        this._gl.deleteVertexArray(this._pointVertexArray);
      }
      if (this._pointProgram) this._gl.deleteProgram(this._pointProgram);
    }
  }

  _entities() {
    const states = Object.entries(this._hass?.states || {});
    return {
      photo: states.find(([, state]) =>
        state.attributes?.source === "local_robot_slam"),
      rooms: states.find(([, state]) =>
        state.attributes?.robot_location_source),
    };
  }

  _guardButton(button, action) {
    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      action();
    });
  }

  _authHeaders() {
    const token = this._hass?.auth?.data?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
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
        const boundary = (Array.isArray(room?.boundary) ? room.boundary : [])
          .slice(0, 512)
          .filter((point) =>
            Array.isArray(point)
            && point.length === 2
            && point.every(Number.isFinite));
        const center = Array.isArray(room?.center)
          && room.center.length === 2
          && room.center.every(Number.isFinite)
          ? room.center
          : undefined;
        return {
          name: String(room?.name || "Room").slice(0, 128),
          boundary,
          center,
        };
      })
      .filter((room) => room.boundary.length >= 3 && room.center);
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

  _uploadScene(scene) {
    if (!this._gl) return;
    const pointBytes = new Uint8Array(
      scene.buffer,
      scene.pointOffset,
      scene.total * MATIC_SCENE_POINT_STRIDE,
    );
    this._gl.bindBuffer(this._gl.ARRAY_BUFFER, this._pointBuffer);
    this._gl.bufferData(this._gl.ARRAY_BUFFER, pointBytes, this._gl.STATIC_DRAW);
  }

  async _fetchScene(state, force = false) {
    const url = state?.attributes?.scene_url;
    const revision = state?.attributes?.map_revision;
    if (!url || !this._webglAvailable) return;
    if (!force && this._scene && revision === this._sceneRevision) return;
    if (this._sceneLoading) {
      this._pendingSceneRefresh = this._pendingSceneRefresh || force;
      return;
    }
    this._sceneLoading = true;
    this._setLoading(true);
    try {
      const headers = this._authHeaders();
      if (this._sceneEtag && !force) headers["If-None-Match"] = this._sceneEtag;
      const response = await fetch(this._absoluteUrl(url), {
        headers,
        cache: "no-store",
      });
      if (response.status === 304) {
        this._sceneRevision = revision;
        return;
      }
      if (!response.ok) throw new Error(`scene request failed (${response.status})`);
      const scene = this._parseScene(await response.arrayBuffer());
      this._scene = scene;
      this._sceneRevision = revision;
      this._sceneEtag = response.headers.get("ETag") || undefined;
      this._uploadScene(scene);
      this._rebuildOverlays();
      this._calculateHomeDistances();
      this._applyPreset(this._view === "top" ? "top" : "three", false);
      this._showSpatialScene();
      this._updateSceneStatus(state);
      this._requestRender();
    } catch (_error) {
      this._showFallback(
        this._entities().photo || this._entities().rooms,
        force,
      );
      this.shadowRoot.querySelector(".status").textContent =
        "3D scene is not ready · showing the local map";
    } finally {
      this._sceneLoading = false;
      this._setLoading(false);
      if (this._pendingSceneRefresh) {
        const pendingForce = this._pendingSceneRefresh;
        this._pendingSceneRefresh = false;
        this._fetchScene(state, pendingForce);
      }
    }
  }

  async _fetchPose(state) {
    const url = state?.attributes?.pose_url;
    if (!url || this._poseLoading || !this._scene) return;
    this._poseLoading = true;
    try {
      const response = await fetch(this._absoluteUrl(url), {
        headers: this._authHeaders(),
        cache: "no-store",
      });
      if (!response.ok) return;
      const payload = await response.json();
      const position = payload?.position;
      if (
        Array.isArray(position)
        && position.length === 2
        && position.every(Number.isFinite)
      ) {
        const metadata = this._scene.metadata;
        this._robot = {
          x: position[0] / metadata.metersPerCell - metadata.origin[0],
          y: position[1] / metadata.metersPerCell - metadata.origin[1],
          source: String(payload.source || "unavailable"),
        };
      } else {
        this._robot = undefined;
      }
      this._requestRender();
    } finally {
      this._poseLoading = false;
    }
  }

  _updateSceneStatus(state) {
    if (!this._scene) return;
    const points = this._scene.total.toLocaleString();
    const sampling = this._scene.metadata.sampleStep === 1
      ? "all captured samples"
      : `adaptive 1:${this._scene.metadata.sampleStep} detail`;
    const complete = state?.attributes?.map_complete === true;
    this.shadowRoot.querySelector(".status").textContent = complete
      ? `Full local 3D scene · ${points} points · ${sampling}`
      : `Building live 3D scene · ${points} points`;
    this.shadowRoot.querySelector(".resolution-value").textContent =
      `${(this._scene.total / 1000000).toFixed(2)}M pts · 1.5 cm`;
  }

  _update(force = false) {
    if (!this.shadowRoot.hasChildNodes()) return;
    const entities = this._entities();
    const photoState = entities.photo?.[1];
    if (this._view === "rooms") {
      this._showFallback(entities.rooms || entities.photo, force);
    } else if (photoState) {
      this._fetchScene(photoState, force);
      this._fetchPose(photoState);
      if (this._scene) {
        this._showSpatialScene();
        this._updateSceneStatus(photoState);
      }
    } else {
      this._showFallback(entities.rooms, force);
      this.shadowRoot.querySelector(".status").textContent =
        "No local map entity is available yet";
    }
  }

  _showFallback(selected, force = false) {
    const canvas = this.shadowRoot.querySelector(".scene-canvas");
    const overlays = this.shadowRoot.querySelector(".spatial-overlays");
    const image = this.shadowRoot.querySelector(".map-image");
    canvas.hidden = true;
    overlays.hidden = true;
    if (!selected) {
      image.hidden = true;
      this._setEmpty("The local map will appear when the Matic integration is ready.");
      return;
    }
    const [entityId, state] = selected;
    const version = `${entityId}:${state.last_updated}:${state.attributes?.map_revision || "rooms"}`;
    if (!force && version === this._fallbackVersion && image.naturalWidth > 0) {
      image.hidden = false;
      this._setEmpty();
      return;
    }
    const token = state.attributes?.access_token;
    const query = new URLSearchParams({
      width: "4096",
      height: "4096",
      t: String(Date.now()),
    });
    if (token) query.set("token", token);
    const loader = new Image();
    this._fallbackLoader = loader;
    this._setLoading(true);
    loader.addEventListener("load", () => {
      if (this._fallbackLoader !== loader) return;
      image.src = loader.src;
      image.hidden = false;
      this._fallbackVersion = version;
      this._fallbackLoader = undefined;
      this._setLoading(false);
      this._setEmpty();
      this.shadowRoot.querySelector(".resolution-value").textContent =
        `${loader.naturalWidth} × ${loader.naturalHeight}`;
    }, { once: true });
    loader.addEventListener("error", () => {
      if (this._fallbackLoader !== loader) return;
      this._fallbackLoader = undefined;
      this._setLoading(false);
      if (!(image.complete && image.naturalWidth > 0)) {
        image.hidden = true;
        this._setEmpty("The local map could not be loaded. Try Refresh after reconnecting.");
      }
    }, { once: true });
    loader.src = `/api/camera_proxy/${entityId}?${query}`;
    this.shadowRoot.querySelector(".status").textContent =
      this._view === "rooms" ? "Live labeled room map" : "Loading local 3D data…";
  }

  _showSpatialScene() {
    if (!this._scene || this._view === "rooms") return;
    this.shadowRoot.querySelector(".scene-canvas").hidden = false;
    this.shadowRoot.querySelector(".spatial-overlays").hidden = false;
    this.shadowRoot.querySelector(".map-image").hidden = true;
    this._setEmpty();
    this._requestRender();
  }

  _setEmpty(message) {
    const empty = this.shadowRoot.querySelector(".empty");
    empty.hidden = !message;
    if (message) empty.textContent = message;
  }

  _setLoading(loading) {
    this.shadowRoot.querySelector(".viewport").classList.toggle("loading", loading);
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
        yaw: -Math.PI / 4,
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
    const target = this._preset(view);
    this._cancelMotion();
    if (!animate) {
      this._camera = target;
      this._requestRender();
      return;
    }
    const start = { ...this._camera };
    const started = performance.now();
    this._camera.orthographic = target.orthographic;
    const step = (now) => {
      const progress = maticClamp((now - started) / 520, 0, 1);
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
    this._view = view;
    for (const button of this.shadowRoot.querySelectorAll("[data-view]")) {
      const selected = button.dataset.view === view;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    }
    const viewport = this.shadowRoot.querySelector(".viewport");
    viewport.classList.toggle("top-down", view === "top");
    viewport.classList.toggle("spatial", view !== "rooms");
    this.shadowRoot.querySelector(".spatial-controls").hidden = view === "rooms";
    if (view === "rooms") {
      this._cancelMotion();
      this._update(true);
    } else {
      this._showSpatialScene();
      this._applyPreset(view);
      this._update();
    }
  }

  _cancelMotion() {
    window.cancelAnimationFrame(this._cameraAnimation);
    window.cancelAnimationFrame(this._inertiaFrame);
    this._cameraAnimation = undefined;
    this._inertiaFrame = undefined;
  }

  _zoom(factor) {
    this._cancelMotion();
    this._camera.distance = maticClamp(
      this._camera.distance / factor,
      Math.max(0.3, this._radius * 0.08),
      this._radius * 8,
    );
    this._requestRender();
  }

  _maximumPitch() {
    return this._view === "three" ? 1.38 : Math.PI / 2 - 0.018;
  }

  _panValues(camera, deltaX, deltaY) {
    const viewport = this.shadowRoot.querySelector(".viewport");
    const worldPerPixel = camera.distance / Math.max(200, viewport.clientHeight) * 1.75;
    const rightX = Math.cos(camera.yaw);
    const rightZ = -Math.sin(camera.yaw);
    const forwardX = -Math.sin(camera.yaw);
    const forwardZ = -Math.cos(camera.yaw);
    return {
      targetX: camera.targetX
        - deltaX * worldPerPixel * rightX
        + deltaY * worldPerPixel * forwardX,
      targetZ: camera.targetZ
        - deltaX * worldPerPixel * rightZ
        + deltaY * worldPerPixel * forwardZ,
    };
  }

  _panBy(deltaX, deltaY) {
    const target = this._panValues(this._camera, deltaX, deltaY);
    this._camera.targetX = target.targetX;
    this._camera.targetZ = target.targetZ;
    this._requestRender();
  }

  _startInertia(velocityX, velocityY, mode) {
    this._cancelMotion();
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
        this._panBy(velocityX * elapsed, velocityY * elapsed);
      }
      const decay = 0.9 ** (elapsed / 16);
      velocityX *= decay;
      velocityY *= decay;
      this._requestRender();
      if (Math.hypot(velocityX, velocityY) >= 0.01) {
        this._inertiaFrame = window.requestAnimationFrame(step);
      } else {
        this._inertiaFrame = undefined;
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
    if (!this._gl || !this._scene || this._view === "rooms") return;
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
    this._gl.drawArrays(this._gl.POINTS, 0, this._scene.floorCount);
    this._gl.uniform1f(this._uniforms.pointPixels, canvas.height * 0.05);
    this._gl.uniform1f(this._uniforms.maxPointPixels, 7 * pixelRatio);
    this._gl.drawArrays(
      this._gl.POINTS,
      this._scene.floorCount,
      this._scene.surfaceCount,
    );
    this._gl.bindVertexArray(null);
    this._updateOverlays();
    const home = this._camera.orthographic
      ? this._homeTopDistance
      : this._homeThreeDistance;
    const zoom = Math.round(home / this._camera.distance * 100);
    this.shadowRoot.querySelector(".zoom-value").textContent = `${zoom}%`;
    this.shadowRoot.querySelector(".zoom-slider").value = String(
      maticClamp(zoom, 25, 400),
    );
    this.shadowRoot.querySelector(".angle-value").textContent =
      `${Math.round((maticAngleDelta(this._camera.yaw) * 180) / Math.PI)}° · ${Math.round((this._camera.pitch * 180) / Math.PI)}°`;
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
      const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      polygon.classList.add("room-boundary");
      svg.append(polygon);
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
    const polygons = svg.querySelectorAll(".room-boundary");
    const labels = this.shadowRoot.querySelectorAll(".room-label");
    this._scene.metadata.rooms.forEach((room, index) => {
      const projected = room.boundary.map(([x, y]) =>
        this._project(this._worldForCell(x, y, 0.2)));
      const valid = projected.every((point) => point?.visible);
      polygons[index].toggleAttribute("hidden", !valid || !this._labelsVisible);
      if (valid) {
        polygons[index].setAttribute(
          "points",
          projected.map((point) => `${point.x},${point.y}`).join(" "),
        );
      }
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
      marker.title = `Robot position · ${this._robot.source.replaceAll("_", " ")}`;
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
      this._requestRender();
    } else if (key === "r") this._update(true);
    else if (key === "f") {
      if (document.fullscreenElement) document.exitFullscreen();
      else this.shadowRoot.querySelector(".shell").requestFullscreen();
    } else if (event.key === "?") {
      const help = this.shadowRoot.querySelector(".gesture-help");
      help.hidden = !help.hidden;
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
      this._cancelMotion();
      if (event.ctrlKey || event.metaKey) {
        this._zoom(Math.exp(-event.deltaY * 0.012));
      } else if (event.altKey) {
        this._camera.pitch = maticClamp(
          this._camera.pitch - event.deltaY * 0.003,
          0.18,
          this._maximumPitch(),
        );
        this._requestRender();
      } else {
        this._panBy(-event.deltaX, -event.deltaY);
      }
    }, { passive: false });
    viewport.addEventListener("pointerdown", (event) => {
      if (this._view === "rooms") return;
      if (event.pointerType === "mouse" && ![0, 2].includes(event.button)) return;
      event.preventDefault();
      this._cancelMotion();
      viewport.setPointerCapture(event.pointerId);
      this._pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
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
          camera: { ...this._camera },
          mode: this._view === "top" || event.shiftKey || event.button === 2
            ? "pan"
            : "orbit",
        };
      } else if (this._pointers.size === 2) {
        const [first, second] = [...this._pointers.values()];
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
      this._pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this._pinch && this._pointers.size >= 2) {
        const [first, second] = [...this._pointers.values()];
        const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
        const angle = Math.atan2(second.y - first.y, second.x - first.x);
        const centerX = (first.x + second.x) / 2;
        const centerY = (first.y + second.y) / 2;
        const start = this._pinch.camera;
        this._camera.distance = maticClamp(
          start.distance * this._pinch.distance / distance,
          Math.max(0.3, this._radius * 0.08),
          this._radius * 8,
        );
        this._camera.yaw = maticAngleDelta(
          start.yaw + maticAngleDelta(angle - this._pinch.angle),
        );
        this._camera.pitch = maticClamp(
          start.pitch - (centerY - this._pinch.centerY) * 0.0035,
          0.18,
          this._maximumPitch(),
        );
        const panned = this._panValues(
          start,
          centerX - this._pinch.centerX,
          0,
        );
        this._camera.targetX = panned.targetX;
        this._camera.targetZ = panned.targetZ;
      } else if (event.pointerId === this._drag?.pointerId) {
        const drag = this._drag;
        const deltaX = event.clientX - drag.x;
        const deltaY = event.clientY - drag.y;
        const now = performance.now();
        const elapsed = Math.max(1, now - drag.lastTime);
        const velocityX = (event.clientX - drag.lastX) / elapsed;
        const velocityY = (event.clientY - drag.lastY) / elapsed;
        drag.velocityX = drag.velocityX * 0.6 + velocityX * 0.4;
        drag.velocityY = drag.velocityY * 0.6 + velocityY * 0.4;
        drag.lastX = event.clientX;
        drag.lastY = event.clientY;
        drag.lastTime = now;
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
          const target = this._panValues(drag.camera, deltaX, deltaY);
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
        camera: { ...this._camera },
        mode: this._view === "top" ? "pan" : "orbit",
      } : undefined;
      if (!remaining) {
        viewport.classList.remove("moving");
        if (!cancelled && !wasPinching && drag) {
          this._startInertia(drag.velocityX, drag.velocityY, drag.mode);
        }
      }
      if (viewport.hasPointerCapture(event.pointerId)) {
        viewport.releasePointerCapture(event.pointerId);
      }
    };
    viewport.addEventListener("pointerup", finish);
    viewport.addEventListener("pointercancel", (event) => finish(event, true));
    viewport.addEventListener("lostpointercapture", (event) => finish(event, true));
    viewport.addEventListener("gesturestart", (event) => {
      if (this._view === "rooms") return;
      event.preventDefault();
      this._cancelMotion();
      this._gesture = {
        camera: { ...this._camera },
        rotation: Number(event.rotation || 0),
      };
    }, { passive: false });
    viewport.addEventListener("gesturechange", (event) => {
      if (!this._gesture) return;
      event.preventDefault();
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
    }, { passive: false });
    viewport.addEventListener("dblclick", (event) => {
      if (this._view === "rooms") return;
      event.preventDefault();
      this._zoom(event.shiftKey ? 1 / 1.6 : 1.6);
    });
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; height: 100%; min-height: 0; color: var(--primary-text-color); background: #080d13; }
        .shell { height: 100dvh; min-height: 500px; display: grid; grid-template-rows: auto minmax(0, 1fr); overflow: hidden; background: #080d13; }
        header { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 16px; background: color-mix(in srgb, var(--card-background-color) 90%, transparent); border-bottom: 1px solid var(--divider-color); box-shadow: 0 8px 28px rgba(0, 0, 0, .2); backdrop-filter: blur(20px) saturate(1.3); z-index: 4; }
        .heading { display: grid; gap: 1px; margin-right: 10px; }
        h1 { margin: 0; font-size: 19px; line-height: 1.25; }
        .privacy { color: var(--secondary-text-color); font-size: 11px; }
        .spacer { flex: 1 1 auto; }
        button, a { min-height: 42px; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; padding: 0 12px; border: 1px solid var(--divider-color); border-radius: 12px; color: var(--primary-text-color); background: color-mix(in srgb, var(--card-background-color) 94%, transparent); text-decoration: none; cursor: pointer; touch-action: manipulation; transition: border-color .16s ease, background .16s ease, transform .16s ease; }
        button:hover, a:hover { border-color: color-mix(in srgb, var(--primary-color) 55%, var(--divider-color)); background: color-mix(in srgb, var(--primary-color) 9%, var(--card-background-color)); }
        button:active, a:active { transform: scale(.97); }
        button.selected { border-color: var(--primary-color); color: var(--primary-color); background: color-mix(in srgb, var(--primary-color) 15%, transparent); }
        .segmented, .spatial-controls { display: inline-flex; align-items: center; gap: 3px; padding: 3px; border: 1px solid var(--divider-color); border-radius: 14px; background: rgba(4, 10, 17, .25); }
        .segmented button, .spatial-controls button { min-height: 34px; border: 0; background: transparent; }
        .spatial-controls button { min-width: 36px; padding: 0 9px; font-size: 17px; }
        .zoom-slider { width: 96px; accent-color: var(--primary-color); touch-action: pan-x; }
        .zoom-value, .angle-value, .status, .resolution-value { color: var(--secondary-text-color); font-variant-numeric: tabular-nums; white-space: nowrap; }
        .zoom-value { min-width: 42px; text-align: center; }
        .angle-value { min-width: 72px; text-align: center; font-size: 11px; }
        .resolution-value { padding: 7px 10px; border-radius: 999px; background: rgba(4, 10, 17, .32); text-align: center; font-size: 11px; }
        .viewport { position: relative; min-height: 0; overflow: hidden; touch-action: none; overscroll-behavior: contain; cursor: grab; outline: none; contain: strict; background: radial-gradient(circle at 50% 30%, #223149, #080d13 68%); transition: background .38s ease; }
        .viewport.top-down { background-color: #efefeb; background-image: radial-gradient(#c9cac6 .7px, transparent .75px); background-size: 12px 12px; }
        .viewport:focus-visible { box-shadow: inset 0 0 0 2px var(--primary-color); }
        .viewport.moving { cursor: grabbing; }
        .scene-canvas, .map-image, .spatial-overlays { position: absolute; inset: 0; width: 100%; height: 100%; }
        .scene-canvas { display: block; }
        .map-image { object-fit: contain; user-select: none; -webkit-user-drag: none; }
        [hidden] { display: none !important; }
        .spatial-overlays { pointer-events: none; overflow: hidden; }
        .room-lines { display: none; position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
        .room-boundary { fill: color-mix(in srgb, var(--primary-color) 7%, transparent); stroke: rgba(224, 238, 252, .5); stroke-width: 1.25; vector-effect: non-scaling-stroke; }
        .top-down .room-boundary { fill: rgba(35, 93, 205, .035); stroke: rgba(31, 62, 94, .4); }
        .room-labels { position: absolute; inset: 0; }
        .room-label { position: absolute; top: 0; left: 0; max-width: 150px; overflow: hidden; text-overflow: ellipsis; padding: 4px 8px; border: 1px solid rgba(255,255,255,.22); border-radius: 999px; color: #f7fbff; background: rgba(5, 10, 16, .72); box-shadow: 0 4px 18px rgba(0,0,0,.18); backdrop-filter: blur(10px); font-size: 11px; white-space: nowrap; will-change: transform; }
        .top-down .room-label { color: #18212b; border-color: rgba(20,30,40,.18); background: rgba(255,255,255,.84); }
        .robot-marker { position: absolute; top: 0; left: 0; width: 16px; height: 16px; border: 3px solid #fff; border-radius: 50%; background: #101923; box-shadow: 0 0 0 8px rgba(255,255,255,.2), 0 5px 18px rgba(0,0,0,.35); will-change: transform; }
        .top-down .robot-marker { border-color: #fff; background: #1438d0; box-shadow: 0 0 0 7px rgba(20,56,208,.16), 0 5px 18px rgba(0,0,0,.25); }
        .viewport.loading::after { content: ""; position: absolute; top: 16px; right: 16px; width: 24px; height: 24px; border: 3px solid rgba(255,255,255,.25); border-top-color: var(--primary-color); border-radius: 50%; animation: spin .8s linear infinite; z-index: 3; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--secondary-text-color); font-size: 17px; text-align: center; padding: 40px; z-index: 2; }
        .gesture-help { position: absolute; left: 16px; bottom: 16px; max-width: min(680px, calc(100% - 32px)); padding: 10px 13px; border: 1px solid rgba(255,255,255,.14); border-radius: 12px; color: #e3edf8; background: rgba(5,10,16,.76); box-shadow: 0 8px 32px rgba(0,0,0,.25); backdrop-filter: blur(14px); font-size: 12px; pointer-events: none; z-index: 3; }
        .top-down .gesture-help { color: #202833; background: rgba(255,255,255,.86); border-color: rgba(20,30,40,.16); }
        @media (max-width: 1050px) { .heading { width: 100%; } .status { order: 10; width: 100%; } header { padding: 8px; gap: 6px; } }
        @media (max-width: 650px) { button, a { min-height: 40px; padding: 0 9px; } .resolution-value, .angle-value, .cleaning-areas { display: none; } .zoom-slider { width: 72px; } .gesture-help { font-size: 11px; } }
      </style>
      <div class="shell">
        <header>
          <div class="heading"><h1>Matic map studio</h1><span class="privacy">Full local SLAM · private inside Home Assistant</span></div>
          <span class="segmented">
            <button data-view="three" class="selected" aria-pressed="true">3D</button>
            <button data-view="top" aria-pressed="false">Top-down</button>
            <button data-view="rooms" aria-pressed="false">Rooms</button>
          </span>
          <span class="status">Loading local 3D scene…</span>
          <span class="spacer"></span>
          <span class="resolution-value">Loading…</span>
          <span class="spatial-controls">
            <button class="rotate-left" aria-label="Rotate left">↶</button>
            <button class="tilt-down" aria-label="Lower viewing angle">⌄</button>
            <input class="zoom-slider" type="range" min="25" max="400" step="5" value="100" aria-label="Scene zoom">
            <span class="zoom-value">100%</span>
            <button class="tilt-up" aria-label="Raise viewing angle">⌃</button>
            <button class="rotate-right" aria-label="Rotate right">↷</button>
            <span class="angle-value">−45° · 47°</span>
          </span>
          <button class="home-view">Home view</button>
          <button class="layers selected">Labels</button>
          <button class="refresh">Refresh</button>
          <button class="fullscreen">Full screen</button>
          <a class="cleaning-areas" href="/config/integrations/integration/matic_robot">Cleaning areas</a>
        </header>
        <div class="viewport spatial" tabindex="0" role="application" aria-label="Interactive Matic 3D map. Drag to orbit, Shift-drag or two-finger scroll to pan, pinch to zoom, twist to rotate, and move two fingers vertically to tilt.">
          <canvas class="scene-canvas" aria-label="Matic local 3D SLAM scene"></canvas>
          <img class="map-image" alt="Matic local fallback map" draggable="false" hidden>
          <div class="spatial-overlays">
            <svg class="room-lines" aria-hidden="true"></svg>
            <div class="room-labels"></div>
            <span class="robot-marker" hidden></span>
          </div>
          <div class="empty">Loading the private local map…</div>
          <div class="gesture-help">Drag to orbit · Shift-drag or scroll to pan · pinch to zoom · twist to rotate · move two fingers vertically to tilt · press T for top-down · 3 for 3D · ? for help</div>
        </div>
      </div>
    `;
    this._initWebGL();
    const viewport = this.shadowRoot.querySelector(".viewport");
    this._bindGestures(viewport);
    viewport.addEventListener("keydown", (event) => this._handleKeyDown(event));
    this._guardButton(this.shadowRoot.querySelector('[data-view="three"]'), () => this._setView("three"));
    this._guardButton(this.shadowRoot.querySelector('[data-view="top"]'), () => this._setView("top"));
    this._guardButton(this.shadowRoot.querySelector('[data-view="rooms"]'), () => this._setView("rooms"));
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
      this.shadowRoot.querySelector(".layers").classList.toggle("selected", this._labelsVisible);
      this._requestRender();
    });
    this._guardButton(this.shadowRoot.querySelector(".refresh"), () => this._update(true));
    this._guardButton(this.shadowRoot.querySelector(".fullscreen"), () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else this.shadowRoot.querySelector(".shell").requestFullscreen();
    });
    this.shadowRoot.querySelector(".zoom-slider").addEventListener("input", (event) => {
      const home = this._camera.orthographic
        ? this._homeTopDistance
        : this._homeThreeDistance;
      this._camera.distance = maticClamp(
        home / (Number(event.target.value) / 100),
        Math.max(0.3, this._radius * 0.08),
        this._radius * 8,
      );
      this._requestRender();
    });
    const canvas = this.shadowRoot.querySelector(".scene-canvas");
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this._webglAvailable = false;
      this._showFallback(this._entities().photo || this._entities().rooms);
    });
    canvas.addEventListener("webglcontextrestored", () => {
      this._initWebGL();
      if (this._scene) this._uploadScene(this._scene);
      this._showSpatialScene();
    });
    this._resizeObserver = new ResizeObserver(() => {
      this._resizeCanvas();
      this._requestRender();
    });
    this._resizeObserver.observe(viewport);
    this._resizeCanvas();
  }
}

if (!customElements.get("matic-map-panel-v0-3-0")) {
  customElements.define("matic-map-panel-v0-3-0", MaticMapStudio);
}
