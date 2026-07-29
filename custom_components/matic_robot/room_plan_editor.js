class MaticRoomPlanEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._selector = {};
    this._value = [];
    this._draggedRoomId = undefined;
  }

  set hass(value) {
    const hadHass = this._hass !== undefined;
    const previousLanguage = this._hass?.locale?.language;
    this._hass = value;
    const languageChanged =
      hadHass && previousLanguage !== value?.locale?.language;
    if (!hadHass || languageChanged || !this.shadowRoot?.hasChildNodes()) {
      this._render();
      return;
    }
    this.shadowRoot.querySelectorAll("ha-selector").forEach((field) => {
      field.hass = value;
    });
  }

  set selector(value) {
    this._selector = value || {};
    this._render();
  }

  set value(value) {
    this._value = Array.isArray(value) ? value.map((row) => ({ ...row })) : [];
    this._render();
  }

  get value() {
    return this._value;
  }

  set disabled(value) {
    this._disabled = Boolean(value);
    this._render();
  }

  set required(value) {
    this._required = Boolean(value);
  }

  connectedCallback() {
    this._render();
  }

  reportValidity() {
    return true;
  }

  _rooms() {
    return (
      this._selector?.rooms ||
      this._selector?.["matic-room-plan"]?.rooms ||
      []
    );
  }

  _rows() {
    const configured = new Map(this._rooms().map((room) => [room.room_id, room]));
    const rows = this._value
      .filter((row) => configured.has(row.room_id))
      .map((row) => ({
        room_id: row.room_id,
        included: Boolean(row.included),
        cleaning_mode: row.cleaning_mode || "vacuum",
        coverage_setting: row.coverage_setting || "standard",
      }));
    const present = new Set(rows.map((row) => row.room_id));
    for (const room of this._rooms()) {
      if (!present.has(room.room_id)) {
        rows.push({
          room_id: room.room_id,
          included: false,
          cleaning_mode: "vacuum",
          coverage_setting: "standard",
        });
      }
    }
    return rows;
  }

  _setRows(rows) {
    this._value = rows;
    this.dispatchEvent(
      new CustomEvent("value-changed", {
        detail: { value: rows.map((row) => ({ ...row })) },
        bubbles: true,
        composed: true,
      }),
    );
    this._render();
  }

  _update(roomId, changes) {
    this._setRows(
      this._rows().map((row) =>
        row.room_id === roomId ? { ...row, ...changes } : row,
      ),
    );
  }

  _move(roomId, offset) {
    const rows = this._rows();
    const from = rows.findIndex((row) => row.room_id === roomId);
    const to = Math.max(0, Math.min(rows.length - 1, from + offset));
    if (from === to) return;
    const [row] = rows.splice(from, 1);
    rows.splice(to, 0, row);
    this._setRows(rows);
  }

  _drop(targetRoomId, after) {
    if (!this._draggedRoomId || this._draggedRoomId === targetRoomId) return;
    const rows = this._rows();
    const from = rows.findIndex((row) => row.room_id === this._draggedRoomId);
    const [row] = rows.splice(from, 1);
    let to = rows.findIndex((candidate) => candidate.room_id === targetRoomId);
    if (after) to += 1;
    rows.splice(to, 0, row);
    this._draggedRoomId = undefined;
    this._setRows(rows);
  }

  _select(value, options, onChange) {
    const field = document.createElement("ha-selector");
    field.hass = this._hass;
    field.selector = { select: { options, mode: "dropdown" } };
    field.value = value;
    field.disabled = this._disabled;
    field.addEventListener("value-changed", (event) => {
      // The config form also listens for this generic event. Let only the
      // editor's list-valued event escape or the scalar selection replaces the
      // entire room list and makes every room appear excluded.
      event.stopPropagation();
      onChange(event.detail.value);
    });
    return field;
  }

  _iconButton(icon, label, disabled, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "icon-button";
    button.disabled = Boolean(this._disabled || disabled);
    button.setAttribute("aria-label", label);
    button.title = label;
    const glyph = document.createElement("ha-icon");
    glyph.icon = icon;
    button.append(glyph);
    button.addEventListener("click", onClick);
    return button;
  }

  _localize(key, fallback, placeholders) {
    return (
      this._hass?.localize(
        `component.matic_robot.common.${key}`,
        placeholders,
      ) || fallback
    );
  }

  _render() {
    if (!this.isConnected || !this.shadowRoot) return;
    const rows = this._rows();
    const roomNames = new Map(this._rooms().map((room) => [room.room_id, room.name]));
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .intro { color: var(--secondary-text-color); margin: 4px 0 12px; }
        .list { border: 1px solid var(--divider-color); border-radius: 16px; }
        .room { padding: 14px 12px; background: var(--card-background-color); transition: background .15s ease; }
        .room:first-child { border-radius: 15px 15px 0 0; }
        .room:last-child { border-radius: 0 0 15px 15px; }
        .room:only-child { border-radius: 15px; }
        .room:hover { background: var(--secondary-background-color); }
        .room + .room { border-top: 1px solid var(--divider-color); }
        .room.dragging { opacity: .55; }
        .header { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto auto; align-items: center; gap: 4px; }
        .name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .room.off .name { color: var(--secondary-text-color); font-weight: 400; }
        .icon-button { display: inline-grid; place-items: center; width: 38px; height: 38px; border: 0; border-radius: 50%; color: var(--secondary-text-color); background: transparent; cursor: pointer; }
        .icon-button:hover:not(:disabled) { background: var(--secondary-background-color); }
        .icon-button:disabled { opacity: .3; cursor: default; }
        .drag { cursor: grab; touch-action: none; }
        .switch { position: relative; width: 50px; height: 30px; margin-left: 6px; cursor: pointer; }
        .switch input { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
        .switch-track { position: absolute; inset: 0; border: 1px solid color-mix(in srgb, var(--primary-text-color) 24%, transparent); border-radius: 999px; background: color-mix(in srgb, var(--primary-text-color) 14%, transparent); transition: border-color .16s ease, background .16s ease; }
        .switch-track::after { content: ""; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: var(--primary-background-color, #fff); box-shadow: 0 1px 4px rgba(0, 0, 0, .28); transition: transform .16s ease; }
        .switch input:checked + .switch-track { border-color: var(--primary-color); background: var(--primary-color); }
        .switch input:checked + .switch-track::after { transform: translateX(20px); }
        .switch input:focus-visible + .switch-track { outline: 2px solid var(--primary-color); outline-offset: 2px; }
        .switch input:disabled + .switch-track { opacity: .42; cursor: default; }
        .settings { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 12px 4px 2px 42px; }
        .field-label { color: var(--secondary-text-color); font-size: 12px; margin-bottom: 4px; }
        @media (max-width: 600px) {
          .settings { grid-template-columns: 1fr; margin-left: 4px; }
        }
      </style>
      <div class="intro">${this._localize("room_editor_intro", "Turn on rooms to include them. Drag or use the arrows to set the cleaning order.")}</div>
      <div class="list" role="list"></div>
    `;
    const list = this.shadowRoot.querySelector(".list");
    rows.forEach((row, index) => {
      const container = document.createElement("div");
      container.className = row.included ? "room" : "room off";
      container.setAttribute("role", "listitem");
      container.addEventListener("dragover", (event) => event.preventDefault());
      container.addEventListener("drop", (event) => {
        event.preventDefault();
        const bounds = container.getBoundingClientRect();
        this._drop(row.room_id, event.clientY > bounds.top + bounds.height / 2);
      });

      const header = document.createElement("div");
      header.className = "header";
      const roomName = roomNames.get(row.room_id) || row.room_id;
      const drag = this._iconButton(
        "mdi:drag",
        this._localize("drag_room", `Drag ${roomName}`, { room: roomName }),
        false,
        () => {},
      );
      drag.classList.add("drag");
      drag.tabIndex = -1;
      drag.draggable = !this._disabled;
      drag.addEventListener("dragstart", (event) => {
        this._draggedRoomId = row.room_id;
        container.classList.add("dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", row.room_id);
      });
      drag.addEventListener("dragend", () => {
        this._draggedRoomId = undefined;
        container.classList.remove("dragging");
      });
      const name = document.createElement("div");
      name.className = "name";
      name.textContent = roomName;
      header.append(
        drag,
        name,
        this._iconButton("mdi:chevron-up", this._localize("move_room_up", `Move ${roomName} up`, { room: roomName }), index === 0, () => this._move(row.room_id, -1)),
        this._iconButton("mdi:chevron-down", this._localize("move_room_down", `Move ${roomName} down`, { room: roomName }), index === rows.length - 1, () => this._move(row.room_id, 1)),
      );
      header.children[2].classList.add("move");
      header.children[3].classList.add("move");
      const switchLabel = document.createElement("label");
      switchLabel.className = "switch";
      const enabled = document.createElement("input");
      enabled.type = "checkbox";
      enabled.checked = row.included;
      enabled.disabled = this._disabled;
      enabled.setAttribute(
        "aria-label",
        this._localize("include_room", `Include ${roomName}`, { room: roomName }),
      );
      enabled.addEventListener("change", (event) => {
        event.stopPropagation();
        this._update(row.room_id, { included: enabled.checked });
      });
      const switchTrack = document.createElement("span");
      switchTrack.className = "switch-track";
      switchTrack.setAttribute("aria-hidden", "true");
      switchLabel.append(enabled, switchTrack);
      header.append(switchLabel);
      container.append(header);

      if (row.included) {
        const settings = document.createElement("div");
        settings.className = "settings";
        const mode = document.createElement("div");
        mode.innerHTML = `<div class="field-label">${this._localize("cleaning_mode", "Cleaning mode")}</div>`;
        mode.append(
          this._select(
            row.cleaning_mode,
            [
              { value: "vacuum", label: this._localize("vacuum", "Vacuum") },
              { value: "mop", label: this._localize("mop", "Mop") },
              { value: "vacuum_and_mop", label: this._localize("vacuum_and_mop", "Vacuum + mop") },
            ],
            (cleaning_mode) => this._update(row.room_id, { cleaning_mode }),
          ),
        );
        const coverage = document.createElement("div");
        coverage.innerHTML = `<div class="field-label">${this._localize("coverage", "Coverage")}</div>`;
        coverage.append(
          this._select(
            row.coverage_setting,
            [
              { value: "quick", label: this._localize("quick", "Quick") },
              { value: "standard", label: this._localize("standard", "Standard") },
            ],
            (coverage_setting) => this._update(row.room_id, { coverage_setting }),
          ),
        );
        settings.append(mode, coverage);
        container.append(settings);
      }
      list.append(container);
    });
  }
}

if (!customElements.get("ha-selector-matic-room-plan")) {
  customElements.define("ha-selector-matic-room-plan", MaticRoomPlanEditor);
}

class MaticAreaEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._selector = {};
    this._value = [];
    this._radius = 0.3;
    this._tool = "draw";
    this._viewBox = undefined;
    this._baseViewBox = undefined;
    this._panStart = undefined;
    this._draftStroke = undefined;
    this._draftBaseValue = undefined;
    this._draftEraseValue = undefined;
    this._lastBrushPoint = undefined;
    this._activePointerId = undefined;
    this._pointers = new Map();
    this._pinch = undefined;
    this._expanded = true;
    this._undoStack = [];
    this._redoStack = [];
    this._spacePressed = false;
    this._mapLayer = "photo";
    this._preferredMapLayer = "photo";
    this._photoAbortController = undefined;
    this._photoLoadGeneration = 0;
    this._photoObjectUrl = undefined;
    this._photoRooms = undefined;
    this._labelFrame = undefined;
    this._focusedRoomId = undefined;
    this._previousBodyOverflow = undefined;
    this._onKeyDown = (event) => this._handleKeyDown(event);
    this._onKeyUp = (event) => {
      if (event.code === "Space") this._spacePressed = false;
    };
  }

  set hass(value) {
    const hadHass = this._hass !== undefined;
    const previousLanguage = this._hass?.locale?.language;
    this._hass = value;
    const languageChanged =
      hadHass && previousLanguage !== value?.locale?.language;
    if (!hadHass || languageChanged || !this.shadowRoot?.hasChildNodes()) {
      this._render();
    }
  }

  set selector(value) {
    const previousRooms = JSON.stringify(this._rooms());
    const previousSceneUrl = this._sceneUrl();
    this._selector = value || {};
    const roomsChanged = previousRooms !== JSON.stringify(this._rooms());
    if (
      roomsChanged
      || previousSceneUrl !== this._sceneUrl()
      || !this.shadowRoot?.hasChildNodes()
    ) this._render();
  }

  set value(value) {
    const next = Array.isArray(value)
      ? value.map((circle) => ({ ...circle }))
      : [];
    const unchanged =
      next.length === this._value.length &&
      next.every((circle, index) =>
        ["x", "y", "radius"].every(
          (key) => Number(circle[key]) === Number(this._value[index]?.[key]),
        ),
      );
    if (unchanged) return;
    this._value = next;
    if (this.isConnected && this.shadowRoot?.hasChildNodes()) {
      this._syncMarks();
      this._updateControls();
    }
  }

  get value() {
    return this._value;
  }

  set disabled(value) {
    const disabled = Boolean(value);
    if (disabled === this._disabled) return;
    this._disabled = disabled;
    if (this.isConnected) this._updateControls();
  }

  set required(value) {
    this._required = Boolean(value);
  }

  connectedCallback() {
    if (!this.shadowRoot.hasChildNodes()) this._render();
    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);
    this._syncFullscreen();
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
    this._photoAbortController?.abort();
    if (this._labelFrame !== undefined) {
      window.cancelAnimationFrame(this._labelFrame);
      this._labelFrame = undefined;
    }
    this._releasePhotoObjectUrl();
    this._restorePageScroll();
  }

  reportValidity() {
    return !this._required || this._value.length > 0;
  }

  _rooms() {
    return this._selector?.rooms || this._selector?.["matic-area"]?.rooms || [];
  }

  _sceneUrl() {
    const url = this._selector?.scene_url
      || this._selector?.["matic-area"]?.scene_url;
    return typeof url === "string"
      && /^\/api\/matic_robot\/slam_scene\/[A-Za-z0-9]+$/.test(url)
      ? url
      : undefined;
  }

  _embedded() {
    return Boolean(
      this._selector?.embedded
      || this._selector?.["matic-area"]?.embedded,
    );
  }

  _localize(key, fallback) {
    return this._hass?.localize(`component.matic_robot.common.${key}`) || fallback;
  }

  _authenticatedFetch(path, init = {}) {
    if (typeof this._hass?.fetchWithAuth === "function") {
      return this._hass.fetchWithAuth(path, init);
    }
    const token = this._hass?.auth?.accessToken
      || this._hass?.auth?.data?.access_token;
    const url = this._hass?.hassUrl ? this._hass.hassUrl(path) : path;
    return fetch(url, {
      ...init,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers || {}),
      },
    });
  }

  _releasePhotoObjectUrl() {
    if (!this._photoObjectUrl) return;
    URL.revokeObjectURL(this._photoObjectUrl);
    this._photoObjectUrl = undefined;
  }

  _setPhotoStatus(state, message) {
    const status = this.shadowRoot?.querySelector(".photo-status");
    if (!status) return;
    status.dataset.state = state;
    status.textContent = message;
  }

  _parsePhotoScene(buffer) {
    const headerBytes = 24;
    const pointStride = 8;
    const maximumPoints = 2_000_000;
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < headerBytes) {
      throw new Error("scene header is incomplete");
    }
    const bytes = new Uint8Array(buffer, 0, 8);
    const view = new DataView(buffer);
    const magic = new TextDecoder().decode(bytes);
    const metadataBytes = view.getUint32(12, true);
    const floorCount = view.getUint32(16, true);
    const surfaceCount = view.getUint32(20, true);
    const pointCount = floorCount + surfaceCount;
    const pointOffset = headerBytes + metadataBytes;
    if (
      magic !== "MATIC3D\u0000"
      || view.getUint16(8, true) !== 1
      || view.getUint16(10, true) !== pointStride
      || metadataBytes > 1024 * 1024
      || floorCount < 1
      || pointCount > maximumPoints
      || pointOffset + pointCount * pointStride !== buffer.byteLength
    ) {
      throw new Error("scene payload is invalid");
    }
    const metadata = JSON.parse(new TextDecoder().decode(
      new Uint8Array(buffer, headerBytes, metadataBytes),
    ));
    const metersPerCell = Number(metadata?.meters_per_cell);
    const origin = Array.isArray(metadata?.origin_cells)
      ? metadata.origin_cells.map(Number)
      : [];
    const span = Array.isArray(metadata?.span_cells)
      ? metadata.span_cells.map(Number)
      : [];
    if (
      !Number.isFinite(metersPerCell)
      || metersPerCell < 0.001
      || metersPerCell > 0.1
      || origin.length !== 2
      || origin.some((value) => !Number.isFinite(value))
      || span.length !== 2
      || span.some((value) =>
        !Number.isInteger(value) || value < 1 || value > 65536)
    ) {
      throw new Error("scene metadata is invalid");
    }
    const roomMetadata = Array.isArray(metadata.rooms) ? metadata.rooms : undefined;
    const rooms = roomMetadata?.slice(0, 128).flatMap((room) => {
      if (typeof room?.name !== "string" || !Array.isArray(room.boundary)) return [];
      const boundary = room.boundary.slice(0, 8192).flatMap((point) => {
        if (!Array.isArray(point) || point.length !== 2) return [];
        const localX = Number(point[0]);
        const localY = Number(point[1]);
        if (
          !Number.isFinite(localX)
          || !Number.isFinite(localY)
          || localX < 0
          || localY < 0
          || localX > span[0]
          || localY > span[1]
        ) return [];
        return [[
          (localX + origin[0]) * metersPerCell,
          (localY + origin[1]) * metersPerCell,
        ]];
      });
      return boundary.length >= 3
        ? [{ name: room.name.slice(0, 128), boundary }]
        : [];
    });
    return {
      buffer,
      floorCount,
      pointOffset,
      pointStride,
      metersPerCell,
      origin,
      span,
      sampleStep: Math.max(1, Number(metadata.sample_step) || 1),
      rooms,
    };
  }

  async _photoSceneObjectUrl(scene) {
    const maximumDimension = 4096;
    const scale = Math.min(
      1,
      maximumDimension / scene.span[0],
      maximumDimension / scene.span[1],
    );
    const width = Math.max(1, Math.ceil(scene.span[0] * scale));
    const height = Math.max(1, Math.ceil(scene.span[1] * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("2D map rendering is unavailable");
    const image = context.createImageData(width, height);
    const pixels = image.data;
    const view = new DataView(scene.buffer);
    const pointSize = Math.max(
      1,
      Math.min(4, Math.ceil(Math.sqrt(scene.sampleStep) * scale)),
    );
    for (let index = 0; index < scene.floorCount; index += 1) {
      const offset = scene.pointOffset + index * scene.pointStride;
      const pointX = Math.min(
        width - 1,
        Math.floor(view.getUint16(offset, true) * scale),
      );
      const pointY = Math.max(
        0,
        height - 1 - Math.floor(view.getUint16(offset + 2, true) * scale),
      );
      for (let deltaY = 0; deltaY < pointSize; deltaY += 1) {
        for (let deltaX = 0; deltaX < pointSize; deltaX += 1) {
          const x = pointX + deltaX;
          const y = pointY - deltaY;
          if (x >= width || y < 0) continue;
          const pixel = (y * width + x) * 4;
          pixels[pixel] = view.getUint8(offset + 5);
          pixels[pixel + 1] = view.getUint8(offset + 6);
          pixels[pixel + 2] = view.getUint8(offset + 7);
          pixels[pixel + 3] = 255;
        }
      }
    }
    context.putImageData(image, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("photo map encoding failed");
    return URL.createObjectURL(blob);
  }

  async _loadPhotoMap() {
    const url = this._sceneUrl();
    const image = this.shadowRoot?.querySelector(".photo-map");
    if (!image) return;
    this._photoAbortController?.abort();
    const generation = ++this._photoLoadGeneration;
    if (!url) {
      image.removeAttribute("href");
      this._photoRooms = undefined;
      this._setMapLayer("rooms", { remember: false });
      this._setPhotoStatus(
        "unavailable",
        this._localize("area_photo_unavailable", "Photo map unavailable · showing rooms"),
      );
      return;
    }
    const controller = new AbortController();
    this._photoAbortController = controller;
    this._setPhotoStatus(
      "loading",
      this._localize("area_photo_loading", "Loading private photo map…"),
    );
    try {
      const response = await this._authenticatedFetch(url, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`scene request failed: ${response.status}`);
      const scene = this._parsePhotoScene(await response.arrayBuffer());
      const objectUrl = await this._photoSceneObjectUrl(scene);
      if (generation !== this._photoLoadGeneration || !this.isConnected) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      this._releasePhotoObjectUrl();
      this._photoObjectUrl = objectUrl;
      image.setAttribute("href", objectUrl);
      image.setAttribute(
        "x",
        Number((scene.origin[0] * scene.metersPerCell).toFixed(6)),
      );
      image.setAttribute(
        "y",
        Number((
          -(scene.origin[1] + scene.span[1]) * scene.metersPerCell
        ).toFixed(6)),
      );
      image.setAttribute(
        "width",
        Number((scene.span[0] * scene.metersPerCell).toFixed(6)),
      );
      image.setAttribute(
        "height",
        Number((scene.span[1] * scene.metersPerCell).toFixed(6)),
      );
      this._photoRooms = scene.rooms;
      this._setPhotoStatus(
        "ready",
        this._localize("area_photo_ready", "Private photo map"),
      );
      this._setMapLayer(this._preferredMapLayer, { remember: false });
    } catch (error) {
      if (error?.name === "AbortError" || generation !== this._photoLoadGeneration) {
        return;
      }
      image.removeAttribute("href");
      this._photoRooms = undefined;
      this._setMapLayer("rooms", { remember: false });
      this._setPhotoStatus(
        "unavailable",
        this._localize("area_photo_unavailable", "Photo map unavailable · showing rooms"),
      );
    }
  }

  _setMapLayer(layer, { remember = true } = {}) {
    if (remember) this._preferredMapLayer = layer;
    const available = Boolean(this._photoObjectUrl);
    this._mapLayer = available || layer === "rooms" ? layer : "rooms";
    const svg = this.shadowRoot?.querySelector(".map");
    if (svg) svg.dataset.layer = this._mapLayer;
    this._syncRoomGeometry();
    for (const button of this.shadowRoot?.querySelectorAll("[data-layer]") || []) {
      const selected = button.dataset.layer === this._mapLayer;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    }
  }

  _roomKey(name) {
    return String(name || "").trim().toLocaleLowerCase();
  }

  _syncRoomGeometry() {
    const polygons = this.shadowRoot?.querySelectorAll(".room") || [];
    const labels = this.shadowRoot?.querySelectorAll(".room-label") || [];
    const usePhotoGeometry = this._mapLayer !== "rooms"
      && Array.isArray(this._photoRooms);
    const photoRooms = new Map();
    for (const room of this._photoRooms || []) {
      const key = this._roomKey(room.name);
      const matches = photoRooms.get(key) || [];
      matches.push(room);
      photoRooms.set(key, matches);
    }
    this._rooms().forEach((room, index) => {
      const polygon = polygons[index];
      const label = labels[index];
      if (!polygon || !label) return;
      const matches = photoRooms.get(this._roomKey(room.name));
      const photoRoom = usePhotoGeometry ? matches?.shift() : undefined;
      const boundary = photoRoom?.boundary || room.boundary || [];
      const hidden = usePhotoGeometry && !photoRoom;
      label.dataset.geometryVisible = hidden ? "false" : "true";
      label.dataset.roomArea = String(this._roomArea(boundary));
      polygon.setAttribute("visibility", hidden ? "hidden" : "visible");
      label.setAttribute("visibility", hidden ? "hidden" : "visible");
      if (hidden) return;
      polygon.setAttribute(
        "points",
        boundary.map((point) => `${point[0]},${-point[1]}`).join(" "),
      );
      const center = this._roomCenter(boundary);
      label.setAttribute("x", center.x);
      label.setAttribute("y", -center.y);
    });
    this._scheduleRoomLabelLayout();
  }

  _cloneValue(circles = this._value) {
    return circles.map((circle) => ({ ...circle }));
  }

  _setValue(circles, { record = true } = {}) {
    const next = circles.slice(0, 512).map((circle) => ({ ...circle }));
    if (record) {
      this._undoStack.push(this._cloneValue());
      this._undoStack = this._undoStack.slice(-100);
      this._redoStack = [];
    }
    this._value = next;
    this.dispatchEvent(
      new CustomEvent("value-changed", {
        detail: { value: this._cloneValue() },
        bubbles: true,
        composed: true,
      }),
    );
    this._syncMarks();
    this._updateControls();
  }

  _undo() {
    if (!this._undoStack.length) return;
    this._redoStack.push(this._cloneValue());
    const previous = this._undoStack.pop();
    this._setValue(previous, { record: false });
  }

  _redo() {
    if (!this._redoStack.length) return;
    this._undoStack.push(this._cloneValue());
    const next = this._redoStack.pop();
    this._setValue(next, { record: false });
  }

  _mapBounds() {
    const points = this._rooms().flatMap((room) => room.boundary || []);
    if (!points.length) return { minX: 0, minY: 0, width: 1, height: 1 };
    const xs = points.map((point) => Number(point[0]));
    const ys = points.map((point) => Number(point[1]));
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const padding = Math.max(0.4, Math.max(maxX - minX, maxY - minY) * 0.04);
    return {
      minX: minX - padding,
      minY: minY - padding,
      width: Math.max(0.1, maxX - minX + 2 * padding),
      height: Math.max(0.1, maxY - minY + 2 * padding),
    };
  }

  _roomCenter(boundary) {
    if (!boundary?.length) return { x: 0, y: 0 };
    let twiceArea = 0;
    let centerX = 0;
    let centerY = 0;
    for (let index = 0; index < boundary.length; index += 1) {
      const current = boundary[index];
      const next = boundary[(index + 1) % boundary.length];
      const cross = Number(current[0]) * Number(next[1]) -
        Number(next[0]) * Number(current[1]);
      twiceArea += cross;
      centerX += (Number(current[0]) + Number(next[0])) * cross;
      centerY += (Number(current[1]) + Number(next[1])) * cross;
    }
    if (Math.abs(twiceArea) > 1e-8) {
      return {
        x: centerX / (3 * twiceArea),
        y: centerY / (3 * twiceArea),
      };
    }
    return {
      x: boundary.reduce((sum, point) => sum + Number(point[0]), 0) / boundary.length,
      y: boundary.reduce((sum, point) => sum + Number(point[1]), 0) / boundary.length,
    };
  }

  _roomArea(boundary) {
    let twiceArea = 0;
    for (let index = 0; index < boundary.length; index += 1) {
      const current = boundary[index];
      const next = boundary[(index + 1) % boundary.length];
      twiceArea += Number(current[0]) * Number(next[1])
        - Number(next[0]) * Number(current[1]);
    }
    return Math.abs(twiceArea) / 2;
  }

  _scheduleRoomLabelLayout() {
    if (!this.isConnected || !this._baseViewBox || !this._viewBox) return;
    if (this._labelFrame !== undefined) {
      window.cancelAnimationFrame(this._labelFrame);
    }
    this._labelFrame = window.requestAnimationFrame(() => {
      this._labelFrame = undefined;
      const zoom = this._baseViewBox.width / this._viewBox.width;
      const labels = [...this.shadowRoot.querySelectorAll(".room-label")]
        .filter((label) => label.dataset.geometryVisible !== "false");
      for (const label of labels) {
        const baseSize = Number(label.dataset.baseSize);
        label.setAttribute("font-size", baseSize / Math.max(1, zoom));
        label.setAttribute("visibility", "visible");
      }
      labels.sort((first, second) => {
        const firstFocused = first.dataset.roomId === this._focusedRoomId;
        const secondFocused = second.dataset.roomId === this._focusedRoomId;
        if (firstFocused !== secondFocused) return firstFocused ? -1 : 1;
        return Number(second.dataset.roomArea) - Number(first.dataset.roomArea);
      });
      const occupied = [];
      for (const label of labels) {
        const bounds = label.getBoundingClientRect();
        const collides = occupied.some((other) =>
          bounds.left < other.right + 14
          && bounds.right + 14 > other.left
          && bounds.top < other.bottom + 5
          && bounds.bottom + 5 > other.top);
        label.setAttribute("visibility", collides ? "hidden" : "visible");
        if (!collides) occupied.push(bounds);
      }
    });
  }

  _setViewBox(svg, viewBox) {
    const base = this._baseViewBox;
    const width = Math.max(base.width * 0.1, Math.min(base.width, viewBox.width));
    const height = Math.max(base.height * 0.1, Math.min(base.height, viewBox.height));
    const overflowX = base.width * 0.15;
    const overflowY = base.height * 0.15;
    this._viewBox = {
      x: Math.max(
        base.x - overflowX,
        Math.min(base.x + base.width + overflowX - width, viewBox.x),
      ),
      y: Math.max(
        base.y - overflowY,
        Math.min(base.y + base.height + overflowY - height, viewBox.y),
      ),
      width,
      height,
    };
    svg.setAttribute(
      "viewBox",
      `${this._viewBox.x} ${this._viewBox.y} ${this._viewBox.width} ${this._viewBox.height}`,
    );
    this._updateZoomButtons();
    this._scheduleRoomLabelLayout();
  }

  _zoom(svg, factor, center) {
    const current = this._viewBox;
    const focus = center || {
      x: current.x + current.width / 2,
      y: current.y + current.height / 2,
    };
    const width = current.width * factor;
    const height = current.height * factor;
    const ratioX = (focus.x - current.x) / current.width;
    const ratioY = (focus.y - current.y) / current.height;
    this._setViewBox(svg, {
      x: focus.x - width * ratioX,
      y: focus.y - height * ratioY,
      width,
      height,
    });
  }

  _isMouseWheel(event, deltaX, deltaY) {
    return event.deltaMode !== 0
      || (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) >= 50);
  }

  _panByPixels(svg, deltaX, deltaY, viewBox = this._viewBox) {
    const bounds = svg.getBoundingClientRect();
    this._setViewBox(svg, {
      ...viewBox,
      x: viewBox.x - deltaX * viewBox.width / Math.max(1, bounds.width),
      y: viewBox.y - deltaY * viewBox.height / Math.max(1, bounds.height),
    });
  }

  _fitMap(svg) {
    this._setViewBox(svg, { ...this._baseViewBox });
  }

  _focusRoom(svg, roomId) {
    this._focusedRoomId = roomId || undefined;
    if (!roomId) {
      this._fitMap(svg);
      return;
    }
    const room = this._rooms().find((candidate) => candidate.room_id === roomId);
    const boundary = room?.boundary || [];
    if (!boundary.length) return;
    const xs = boundary.map((point) => Number(point[0]));
    const ys = boundary.map((point) => -Number(point[1]));
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const padding = Math.max(0.25, Math.max(maxX - minX, maxY - minY) * 0.35);
    this._setViewBox(svg, {
      x: minX - padding,
      y: minY - padding,
      width: Math.max(0.5, maxX - minX + padding * 2),
      height: Math.max(0.5, maxY - minY + padding * 2),
    });
  }

  _toggleExpanded() {
    if (this._embedded()) return;
    this._expanded = !this._expanded;
    const workspace = this.shadowRoot.querySelector(".workspace");
    workspace.classList.toggle("expanded", this._expanded);
    this.shadowRoot.querySelector(".launcher").hidden = this._expanded;
    const expand = this.shadowRoot.querySelector(".expand");
    expand.textContent = this._expanded
      ? this._localize("done_editing", "Done editing")
      : this._localize("expand_map", "Open full-screen editor");
    expand.setAttribute("aria-expanded", this._expanded ? "true" : "false");
    this._syncFullscreen();
    if (this._expanded) {
      window.requestAnimationFrame(() => this.shadowRoot.querySelector(".map")?.focus());
    }
  }

  _syncFullscreen() {
    if (!this.isConnected) return;
    const workspace = this.shadowRoot.querySelector(".workspace");
    if (!workspace) return;
    if (this._embedded()) {
      this._restorePageScroll();
      return;
    }
    if (this._expanded) {
      if (this._previousBodyOverflow === undefined) {
        this._previousBodyOverflow = document.body.style.overflow;
      }
      document.body.style.overflow = "hidden";
      if (!workspace.open) workspace.showModal();
    } else {
      if (workspace.open) workspace.close();
      this._restorePageScroll();
    }
  }

  _restorePageScroll() {
    if (this._previousBodyOverflow === undefined) return;
    document.body.style.overflow = this._previousBodyOverflow;
    this._previousBodyOverflow = undefined;
  }

  _setTool(tool) {
    if (!["draw", "erase", "pan"].includes(tool)) return;
    this._tool = tool;
    this._panStart = undefined;
    const svg = this.shadowRoot.querySelector(".map");
    svg.dataset.tool = tool;
    this.shadowRoot.querySelector(".workspace").dataset.tool = tool;
    for (const button of this.shadowRoot.querySelectorAll("[data-tool]")) {
      const selected = button.dataset.tool === tool;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    }
    const help = tool === "draw"
      ? this._localize(
        "area_draw_help",
        "Paint over the floor to clean. Tap for a spot or drag for a path.",
      )
      : tool === "erase"
        ? this._localize(
          "area_erase_help",
          "Brush over the highlight to remove it.",
        )
        : this._localize(
          "area_pan_help",
          "Drag to move the map. Scroll or pinch to zoom.",
        );
    this.shadowRoot.querySelector(".map-help").textContent = help;
  }

  _guardButton(button, onAction) {
    button.addEventListener("pointerdown", (event) => {
      if (button.disabled || event.button !== 0) return;
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled) return;
      onAction(event);
    });
  }

  _pointInPolygon(x, y, boundary) {
    let inside = false;
    for (let index = 0, previous = boundary.length - 1; index < boundary.length; previous = index, index += 1) {
      const currentX = Number(boundary[index][0]);
      const currentY = Number(boundary[index][1]);
      const previousX = Number(boundary[previous][0]);
      const previousY = Number(boundary[previous][1]);
      const cross = (x - previousX) * (currentY - previousY) -
        (y - previousY) * (currentX - previousX);
      const dot = (x - previousX) * (currentX - previousX) +
        (y - previousY) * (currentY - previousY);
      const squaredLength = (currentX - previousX) ** 2 +
        (currentY - previousY) ** 2;
      if (Math.abs(cross) <= 1e-8 && dot >= -1e-8 && dot <= squaredLength + 1e-8) {
        return true;
      }
      const crosses = currentY > y !== previousY > y &&
        x < ((previousX - currentX) * (y - currentY)) /
          (previousY - currentY || Number.EPSILON) + currentX;
      if (crosses) inside = !inside;
    }
    return inside;
  }

  _pointIsMapped(x, y) {
    return this._rooms().some((room) =>
      this._pointInPolygon(x, y, room.boundary || []));
  }

  _mapPoint(svg, event, matrix = svg.getScreenCTM().inverse()) {
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(matrix);
  }

  _showDraft(circles) {
    const preview = this.shadowRoot.querySelector(".preview");
    if (!preview) return;
    preview.replaceChildren();
    if (!circles?.length) {
      preview.setAttribute("visibility", "hidden");
      return;
    }
    const namespace = "http://www.w3.org/2000/svg";
    for (const circle of circles) {
      const mark = document.createElementNS(namespace, "circle");
      mark.setAttribute("cx", circle.x);
      mark.setAttribute("cy", -circle.y);
      mark.setAttribute("r", circle.radius);
      preview.append(mark);
    }
    preview.setAttribute("visibility", "visible");
  }

  _brushPoint(svg, event) {
    const point = this._mapPoint(svg, event);
    return {
      x: Number(point.x.toFixed(4)),
      y: Number((-point.y).toFixed(4)),
    };
  }

  _sampleBrushSegment(start, end, callback) {
    const distance = start ? Math.hypot(end.x - start.x, end.y - start.y) : 0;
    const spacing = Math.max(0.04, this._radius * 0.55);
    const steps = start ? Math.max(1, Math.ceil(distance / spacing)) : 1;
    for (let index = 1; index <= steps; index += 1) {
      const progress = index / steps;
      callback({
        x: Number((start ? start.x + (end.x - start.x) * progress : end.x).toFixed(4)),
        y: Number((start ? start.y + (end.y - start.y) * progress : end.y).toFixed(4)),
      });
    }
  }

  _extendBrush(point) {
    const start = this._lastBrushPoint;
    this._sampleBrushSegment(start, point, (sample) => {
      if (!this._pointIsMapped(sample.x, sample.y)) return;
      if (this._tool === "erase") {
        this._draftEraseValue = this._draftEraseValue.filter((circle) =>
          Math.hypot(circle.x - sample.x, circle.y - sample.y)
          > this._radius + Number(circle.radius),
        );
        return;
      }
      if (this._draftBaseValue.length + this._draftStroke.length >= 512) return;
      const previous = this._draftStroke.at(-1);
      if (
        previous
        && Math.hypot(previous.x - sample.x, previous.y - sample.y)
          < Math.max(0.025, this._radius * 0.28)
      ) return;
      this._draftStroke.push({
        x: sample.x,
        y: sample.y,
        radius: Number(this._radius.toFixed(2)),
      });
    });
    this._lastBrushPoint = point;
    if (this._tool === "erase") this._syncMarks(this._draftEraseValue);
    else this._showDraft(this._draftStroke);
  }

  _commitDraft() {
    const base = this._draftBaseValue;
    if (!base) return;
    const next = this._tool === "erase"
      ? this._draftEraseValue
      : [...base, ...(this._draftStroke || [])];
    const changed = JSON.stringify(next) !== JSON.stringify(base);
    this._draftStroke = undefined;
    this._draftBaseValue = undefined;
    this._draftEraseValue = undefined;
    this._lastBrushPoint = undefined;
    this._showDraft(undefined);
    if (!changed) {
      this._syncMarks();
      this._announce(this._localize("area_outside_map", "Paint inside a mapped room."));
      return;
    }
    this._setValue(next);
    this._announce(this._localize("area_added", "Cleaning area updated."));
  }

  _syncMarks(circles = this._value) {
    const group = this.shadowRoot.querySelector(".marks");
    if (!group) return;
    group.replaceChildren();
    const namespace = "http://www.w3.org/2000/svg";
    for (const circle of circles) {
      const mark = document.createElementNS(namespace, "circle");
      mark.setAttribute("class", "drawn");
      mark.setAttribute("cx", circle.x);
      mark.setAttribute("cy", -circle.y);
      mark.setAttribute("r", circle.radius);
      group.append(mark);
    }
  }

  _updateControls() {
    const count = this.shadowRoot.querySelector(".count");
    if (!count) return;
    count.textContent = this._value.length
      ? this._localize("area_selected", "Area selected")
      : this._localize("area_not_selected", "Paint an area to continue");
    for (const control of this.shadowRoot.querySelectorAll("button, input, select")) {
      control.disabled = Boolean(this._disabled);
    }
    this.shadowRoot.querySelector(".undo").disabled =
      Boolean(this._disabled || !this._undoStack.length);
    this.shadowRoot.querySelector(".redo").disabled =
      Boolean(this._disabled || !this._redoStack.length);
    this.shadowRoot.querySelector(".clear").disabled =
      Boolean(this._disabled || !this._value.length);
    this._updateZoomButtons();
  }

  _announce(message) {
    const status = this.shadowRoot.querySelector(".announcement");
    if (status) status.textContent = message;
  }

  _updateZoomButtons() {
    if (!this._viewBox || !this._baseViewBox || !this.shadowRoot) return;
    const epsilon = this._baseViewBox.width * 0.001;
    this.shadowRoot.querySelector(".zoom-out").disabled =
      Boolean(this._disabled || this._viewBox.width >= this._baseViewBox.width - epsilon);
    this.shadowRoot.querySelector(".zoom-in").disabled =
      Boolean(this._disabled || this._viewBox.width <= this._baseViewBox.width * 0.1 + epsilon);
    const slider = this.shadowRoot.querySelector(".area-zoom-slider");
    const value = Math.round(this._baseViewBox.width / this._viewBox.width * 100);
    slider.value = String(Math.max(100, Math.min(1000, value)));
    this.shadowRoot.querySelector(".area-zoom-value").textContent = `${value}%`;
  }

  _handleKeyDown(event) {
    if (!this._expanded || event.defaultPrevented) return;
    const target = event.composedPath()[0];
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return;
    if (event.code === "Space") {
      this._spacePressed = true;
      event.preventDefault();
      return;
    }
    const svg = this.shadowRoot.querySelector(".map");
    if (!svg) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) this._redo();
      else this._undo();
    } else if (event.key === "Escape" && !this._embedded()) {
      event.preventDefault();
      this._toggleExpanded();
    } else if (event.key.toLowerCase() === "d") {
      this._setTool("draw");
    } else if (event.key.toLowerCase() === "e") {
      this._setTool("erase");
    } else if (event.key.toLowerCase() === "p" || event.key.toLowerCase() === "m") {
      this._setTool("pan");
    } else if (event.key === "+" || event.key === "=") {
      this._zoom(svg, 0.8);
    } else if (event.key === "-") {
      this._zoom(svg, 1.25);
    } else if (event.key === "0") {
      this._fitMap(svg);
    }
  }

  _render() {
    if (!this.isConnected || !this.shadowRoot) return;
    const bounds = this._mapBounds();
    const viewY = -(bounds.minY + bounds.height);
    this._baseViewBox = {
      x: bounds.minX,
      y: viewY,
      width: bounds.width,
      height: bounds.height,
    };
    if (!this._viewBox) this._viewBox = { ...this._baseViewBox };
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; min-width: 0; }
        .launcher { width: 100%; min-height: 58px; border: 1px solid var(--primary-color); border-radius: 16px; color: var(--primary-color); background: color-mix(in srgb, var(--primary-color) 10%, var(--card-background-color)); font-weight: 650; cursor: pointer; }
        .workspace { color: var(--primary-text-color); background: var(--card-background-color); }
        .workspace::backdrop { background: rgba(0, 0, 0, .68); backdrop-filter: blur(3px); }
        .workspace.expanded { position: fixed; inset: 0; width: 100vw; height: 100dvh; max-width: none; max-height: none; margin: 0; border: 0; padding: 0; box-sizing: border-box; background: #0b1118; overflow: hidden; }
        .workspace.embedded { position: relative; width: 100%; height: 100%; min-height: 0; max-width: none; max-height: none; border: 0; padding: 0; box-sizing: border-box; background: #0b1118; overflow: hidden; }
        .workspace.embedded .expand, .workspace.embedded .title-group { display: none; }
        .topbar { position: absolute; top: 14px; right: 14px; left: 14px; display: flex; gap: 10px; align-items: flex-start; pointer-events: none; z-index: 5; }
        .topbar > * { pointer-events: auto; }
        .title-group { display: grid; gap: 2px; margin-right: 8px; }
        .title { font-size: 18px; font-weight: 650; color: var(--primary-text-color); }
        .intro { color: var(--secondary-text-color); font-size: 12px; }
        .map-stage { position: absolute; inset: 0; min-height: 0; overflow: hidden; }
        .map-shell { position: relative; height: 100%; min-height: 0; }
        .map { display: block; width: 100%; height: 100%; min-height: 0; border: 0; border-radius: 0; background: radial-gradient(circle at 50% 40%, #182538, #0c131d 72%); touch-action: none; user-select: none; outline: none; }
        .map:focus-visible { border-color: var(--primary-color); box-shadow: inset 0 0 0 2px var(--primary-color); }
        .map[data-tool="draw"], .map[data-tool="erase"] { cursor: none; }
        .map[data-tool="pan"] { cursor: grab; }
        .map[data-tool="pan"].moving { cursor: grabbing; }
        .photo-map { pointer-events: none; transition: opacity .18s ease; }
        .map[data-layer="rooms"] .photo-map { opacity: 0; }
        .room { fill: rgba(76, 126, 204, .42); stroke: rgba(226, 238, 252, .82); stroke-width: 1px; vector-effect: non-scaling-stroke; transition: fill .18s ease; }
        .map[data-layer="photo"] .room { fill: transparent; stroke: rgba(255, 255, 255, .72); }
        .room-label { fill: #fff; font-weight: 650; text-anchor: middle; dominant-baseline: middle; paint-order: stroke; stroke: rgba(7, 12, 19, .94); stroke-width: .12; stroke-linejoin: round; pointer-events: none; }
        .marks { opacity: .5; pointer-events: none; }
        .drawn { fill: var(--primary-color, #03a9f4); stroke: none; pointer-events: none; }
        .preview { opacity: .34; pointer-events: none; }
        .preview circle { fill: #76d5ff; stroke: none; }
        .brush-cursor { fill: rgba(118, 213, 255, .16); stroke: #d8f4ff; stroke-width: 1.5px; vector-effect: non-scaling-stroke; pointer-events: none; }
        .map[data-tool="erase"] .brush-cursor { fill: rgba(255, 90, 90, .12); stroke: #ff8a80; }
        .map[data-tool="pan"] .brush-cursor { display: none; }
        .map-controls { width: 100%; display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
        .navigation-controls, .tool-picker { display: inline-flex; align-items: center; gap: 4px; padding: 4px; border: 1px solid color-mix(in srgb, var(--primary-text-color) 14%, transparent); border-radius: 14px; background: color-mix(in srgb, var(--card-background-color) 88%, transparent); box-shadow: 0 10px 30px rgba(0,0,0,.24); backdrop-filter: blur(20px) saturate(1.18); }
        .navigation-controls button, .tool-picker button, .map-options > summary { min-width: 40px; min-height: 40px; padding: 0 11px; border: 0; border-radius: 10px; background: transparent; }
        .tool-picker button.selected { color: var(--text-primary-color, #fff); background: var(--primary-color); }
        .zoom-control { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 8px; }
        .zoom-control ha-icon { width: 19px; height: 19px; color: var(--secondary-text-color); }
        .area-zoom-slider { width: 118px; accent-color: var(--primary-color); }
        .area-zoom-value { min-width: 42px; color: var(--secondary-text-color); font-size: 12px; font-variant-numeric: tabular-nums; text-align: right; }
        .map-options { position: relative; }
        .map-options-panel { position: absolute; top: calc(100% + 9px); left: 0; width: 240px; display: grid; gap: 8px; padding: 10px; border: 1px solid color-mix(in srgb, var(--primary-text-color) 14%, transparent); border-radius: 14px; background: color-mix(in srgb, var(--card-background-color) 95%, transparent); box-shadow: 0 16px 38px rgba(0,0,0,.3); }
        .spacer { flex: 1 1 auto; }
        .room-focus { min-height: 46px; max-width: 190px; padding: 0 34px 0 12px; border: 1px solid var(--divider-color); border-radius: 12px; background: var(--card-background-color); color: var(--primary-text-color); }
        .layer-picker { display: inline-flex; padding: 3px; border: 1px solid var(--divider-color); border-radius: 14px; background: color-mix(in srgb, var(--card-background-color) 88%, #0b1118); }
        .layer-picker button { min-height: 38px; min-width: auto; padding: 0 11px; border: 0; border-radius: 10px; background: transparent; }
        .layer-picker button.selected { background: var(--card-background-color); box-shadow: 0 1px 5px rgba(0, 0, 0, .3); }
        .photo-status { color: var(--secondary-text-color); font-size: 12px; white-space: nowrap; }
        .photo-status[data-state="ready"]::before { content: ""; display: inline-block; width: 7px; height: 7px; margin-right: 6px; border-radius: 50%; background: #44d17a; }
        .map-help { position: absolute; left: 16px; bottom: 82px; max-width: min(520px, calc(100% - 32px)); padding: 8px 11px; border-radius: 10px; color: #d8e4f2; background: rgba(5, 10, 16, .72); backdrop-filter: blur(10px); font-size: 12px; pointer-events: none; }
        .footer { position: absolute; left: 16px; bottom: 16px; display: flex; gap: 6px; align-items: center; max-width: calc(100% - 460px); padding: 5px; border: 1px solid color-mix(in srgb, var(--primary-text-color) 14%, transparent); border-radius: 14px; background: color-mix(in srgb, var(--card-background-color) 88%, transparent); box-shadow: 0 10px 30px rgba(0,0,0,.24); backdrop-filter: blur(20px) saturate(1.18); z-index: 5; }
        .radius { display: grid; gap: 4px; color: var(--secondary-text-color); font-size: 12px; }
        .workspace[data-tool="pan"] .radius { visibility: hidden; }
        .radius input[type=range] { width: 150px; }
        button { min-height: 46px; min-width: 46px; padding: 0 15px; border: 1px solid var(--divider-color); border-radius: 12px; background: var(--card-background-color); color: var(--primary-text-color); cursor: pointer; touch-action: manipulation; }
        button.selected { border-color: var(--primary-color); color: var(--primary-color); background: color-mix(in srgb, var(--primary-color) 14%, transparent); }
        button.primary { border-color: var(--primary-color); background: var(--primary-color); color: var(--text-primary-color, #fff); font-weight: 650; }
        button.zoom { min-width: 42px; padding: 0 11px; font-size: 20px; }
        button:disabled { opacity: .4; cursor: default; }
        .count { max-width: 150px; overflow: hidden; color: var(--secondary-text-color); font-size: 12px; font-variant-numeric: tabular-nums; text-overflow: ellipsis; white-space: nowrap; }
        .announcement { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
        .visually-hidden { position: absolute !important; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
        @media (max-width: 820px) {
          .topbar { top: 8px; right: 8px; left: 8px; gap: 6px; }
          .title-group { width: 100%; }
          .photo-status { display: none; }
          .room-focus { flex: 1 1 140px; max-width: none; }
          button { min-height: 42px; padding: 0 10px; }
          .map { min-height: 260px; }
          .map-help { display: none; }
          .footer { right: 8px; bottom: 8px; left: 8px; max-width: none; overflow-x: auto; }
          .radius input[type=range] { width: 110px; }
          .area-zoom-slider { width: 76px; }
          .area-zoom-value { display: none; }
          .tool-picker .tool-label { display: none; }
          .count { display: none; }
        }
      </style>
      <button class="launcher" type="button" ${this._expanded || this._embedded() ? "hidden" : ""}>${this._localize("expand_map", "Open full-screen editor")}</button>
      <dialog class="workspace ${this._embedded() ? "embedded" : (this._expanded ? "expanded" : "")}" ${this._embedded() ? "open" : ""}>
        <div class="topbar">
          <div class="title-group">
            <span class="title">${this._localize("area_editor_title", "Custom area studio")}</span>
            <span class="intro">${this._localize("area_editor_intro", "Paint over the floor you want the robot to clean.")}</span>
          </div>
          <div class="map-controls" role="toolbar" aria-label="${this._localize("area_map_controls", "Map controls")}">
            <div class="navigation-controls">
              <button class="fit" type="button" aria-label="${this._localize("fit_map", "Fit map")}" title="${this._localize("fit_map", "Fit map")}"><ha-icon icon="mdi:fit-to-screen-outline" aria-hidden="true"></ha-icon></button>
              <label class="zoom-control"><ha-icon icon="mdi:magnify" aria-hidden="true"></ha-icon><input class="area-zoom-slider" type="range" min="100" max="1000" step="10" value="100" aria-label="${this._localize("map_scene_zoom", "Map zoom")}"><span class="area-zoom-value">100%</span></label>
              <details class="map-options"><summary aria-label="${this._localize("map_more", "Map options")}" title="${this._localize("map_more", "Map options")}"><ha-icon icon="mdi:tune-variant" aria-hidden="true"></ha-icon></summary><div class="map-options-panel">
                <div class="layer-picker" role="group" aria-label="${this._localize("area_map_layer", "Map appearance")}">
                  <button data-layer="photo" class="selected" type="button" aria-pressed="true">${this._localize("area_layer_photo", "Photo")}</button>
                  <button data-layer="rooms" type="button" aria-pressed="false">${this._localize("area_layer_rooms", "Rooms")}</button>
                </div>
                <select class="room-focus" aria-label="${this._localize("focus_room", "Focus room")}"></select>
                <span class="photo-status" data-state="loading" role="status" aria-live="polite">${this._localize("area_photo_loading", "Loading private photo map…")}</span>
                <button class="refresh-photo" type="button">${this._localize("area_photo_refresh", "Refresh photo map")}</button>
                <span class="visually-hidden"><button class="zoom zoom-out" type="button" aria-label="${this._localize("zoom_out", "Zoom out")}">−</button><button class="zoom zoom-in" type="button" aria-label="${this._localize("zoom_in", "Zoom in")}">+</button></span>
              </div></details>
            </div>
            <div class="tool-picker" role="group">
              <button class="tool selected" data-tool="draw" type="button" aria-pressed="true" aria-keyshortcuts="D"><ha-icon icon="mdi:brush" aria-hidden="true"></ha-icon><span class="tool-label">${this._localize("area_paint", "Paint")}</span></button>
              <button class="tool" data-tool="erase" type="button" aria-pressed="false" aria-keyshortcuts="E"><ha-icon icon="mdi:eraser" aria-hidden="true"></ha-icon><span class="tool-label">${this._localize("area_erase", "Erase")}</span></button>
              <button class="tool" data-tool="pan" type="button" aria-pressed="false" aria-keyshortcuts="P"><ha-icon icon="mdi:hand-back-right-outline" aria-hidden="true"></ha-icon><span class="tool-label">${this._localize("move_map", "Move")}</span></button>
            </div>
            <button class="expand primary" type="button" aria-expanded="${this._expanded ? "true" : "false"}">${this._expanded ? this._localize("done_editing", "Done editing") : this._localize("expand_map", "Open full-screen editor")}</button>
          </div>
        </div>
        <div class="map-stage">
          <div class="map-shell">
            <svg class="map" tabindex="0" data-tool="${this._tool}" data-layer="${this._mapLayer}" role="application" aria-label="${this._localize("area_map", "Custom cleaning area map")}" viewBox="${this._viewBox.x} ${this._viewBox.y} ${this._viewBox.width} ${this._viewBox.height}" preserveAspectRatio="xMidYMid meet">
              <image class="photo-map" preserveAspectRatio="none"></image><g class="rooms"></g><g class="marks"></g><g class="preview" visibility="hidden"></g><g class="labels"></g><circle class="brush-cursor" visibility="hidden" r="${this._radius}"></circle>
            </svg>
          </div>
          <div class="map-help"></div>
        </div>
        <div class="footer">
        <label class="radius">${this._localize("brush_size", "Brush width")} · <span class="radius-value">${(this._radius * 2).toFixed(2)} m</span><input type="range" min="0.10" max="1.25" step="0.05" value="${this._radius}" ${this._disabled ? "disabled" : ""}></label>
        <span class="count">${this._value.length ? this._localize("area_selected", "Area selected") : this._localize("area_not_selected", "Paint an area to continue")}</span>
        <button class="undo" type="button" disabled>${this._localize("undo", "Undo")}</button>
        <button class="redo" type="button" disabled>${this._localize("redo", "Redo")}</button>
        <button class="clear" type="button" ${this._disabled || !this._value.length ? "disabled" : ""}>${this._localize("clear", "Clear")}</button>
        </div>
        <div class="announcement" aria-live="polite"></div>
      </dialog>
    `;
    const svg = this.shadowRoot.querySelector(".map");
    const workspace = this.shadowRoot.querySelector(".workspace");
    const namespace = "http://www.w3.org/2000/svg";
    const roomsGroup = this.shadowRoot.querySelector(".rooms");
    const labelsGroup = this.shadowRoot.querySelector(".labels");
    const labelSize = Math.max(0.18, Math.min(bounds.width, bounds.height) * 0.025);
    for (const room of this._rooms()) {
      const polygon = document.createElementNS(namespace, "polygon");
      polygon.setAttribute("class", "room");
      polygon.setAttribute(
        "points",
        (room.boundary || []).map((point) => `${point[0]},${-point[1]}`).join(" "),
      );
      roomsGroup.append(polygon);
      const center = this._roomCenter(room.boundary || []);
      const label = document.createElementNS(namespace, "text");
      label.setAttribute("class", "room-label");
      label.setAttribute("x", center.x);
      label.setAttribute("y", -center.y);
      label.setAttribute("font-size", labelSize);
      label.dataset.baseSize = String(labelSize);
      label.dataset.roomId = room.room_id;
      label.textContent = room.name;
      labelsGroup.append(label);
    }
    this._syncRoomGeometry();
    const focus = this.shadowRoot.querySelector(".room-focus");
    const allRooms = document.createElement("option");
    allRooms.value = "";
    allRooms.textContent = this._localize("all_rooms", "All rooms");
    focus.append(allRooms);
    for (const room of this._rooms()) {
      const option = document.createElement("option");
      option.value = room.room_id;
      option.textContent = room.name;
      focus.append(option);
    }
    focus.addEventListener("change", (event) => {
      event.stopPropagation();
      this._focusRoom(svg, event.target.value);
    });
    this._syncMarks();
    const cancelDraft = () => {
      this._draftStroke = undefined;
      this._draftBaseValue = undefined;
      this._draftEraseValue = undefined;
      this._lastBrushPoint = undefined;
      this._showDraft(undefined);
      this._syncMarks();
    };
    svg.addEventListener("pointerdown", (event) => {
      if (
        this._disabled ||
        (event.pointerType === "mouse" && ![0, 1].includes(event.button))
      ) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      svg.focus({ preventScroll: true });
      try {
        svg.setPointerCapture(event.pointerId);
      } catch (_error) {
        return;
      }
      this._pointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      if (this._pointers.size === 2) {
        cancelDraft();
        this._activePointerId = undefined;
        this._panStart = undefined;
        const [first, second] = [...this._pointers.values()];
        const centerX = (first.x + second.x) / 2;
        const centerY = (first.y + second.y) / 2;
        const point = svg.createSVGPoint();
        point.x = centerX;
        point.y = centerY;
        this._pinch = {
          distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
          centerX,
          centerY,
          focus: point.matrixTransform(svg.getScreenCTM().inverse()),
          viewBox: { ...this._viewBox },
        };
        svg.classList.add("moving");
        return;
      }
      if (this._pointers.size > 2) return;
      this._activePointerId = event.pointerId;
      if (this._tool === "pan" || event.button === 1 || this._spacePressed) {
        this._panStart = {
          x: event.clientX,
          y: event.clientY,
          viewBox: { ...this._viewBox },
        };
        svg.classList.add("moving");
      } else {
        if (this._tool === "draw" && this._value.length >= 512) {
          this._activePointerId = undefined;
          svg.releasePointerCapture(event.pointerId);
          return;
        }
        this._draftBaseValue = this._cloneValue();
        this._draftStroke = [];
        this._draftEraseValue = this._cloneValue();
        this._lastBrushPoint = undefined;
        this._extendBrush(this._brushPoint(svg, event));
      }
    });
    svg.addEventListener("pointermove", (event) => {
      if (this._pointers.has(event.pointerId)) {
        this._pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }
      const brushCursor = this.shadowRoot.querySelector(".brush-cursor");
      if (
        event.pointerId !== this._activePointerId
        && this._tool !== "pan"
        && this._pointers.size === 0
      ) {
        const point = this._brushPoint(svg, event);
        brushCursor.setAttribute("cx", point.x);
        brushCursor.setAttribute("cy", -point.y);
        brushCursor.setAttribute("r", this._radius);
        brushCursor.setAttribute("visibility", "visible");
      }
      if (this._pinch && this._pointers.size >= 2) {
        event.preventDefault();
        const [first, second] = [...this._pointers.values()];
        const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
        const centerX = (first.x + second.x) / 2;
        const centerY = (first.y + second.y) / 2;
        const start = this._pinch;
        const factor = start.distance / distance;
        const width = start.viewBox.width * factor;
        const height = start.viewBox.height * factor;
        const ratioX = (start.focus.x - start.viewBox.x) / start.viewBox.width;
        const ratioY = (start.focus.y - start.viewBox.y) / start.viewBox.height;
        const bounds = svg.getBoundingClientRect();
        this._setViewBox(svg, {
          x: start.focus.x - width * ratioX
            - (centerX - start.centerX) * width / Math.max(1, bounds.width),
          y: start.focus.y - height * ratioY
            - (centerY - start.centerY) * height / Math.max(1, bounds.height),
          width,
          height,
        });
        return;
      }
      if (event.pointerId !== this._activePointerId) return;
      if (this._draftBaseValue) {
        event.preventDefault();
        this._extendBrush(this._brushPoint(svg, event));
      } else if (this._panStart) {
        event.preventDefault();
        this._panByPixels(
          svg,
          event.clientX - this._panStart.x,
          event.clientY - this._panStart.y,
          this._panStart.viewBox,
        );
      }
    });
    svg.addEventListener("pointerleave", () => {
      if (this._activePointerId === undefined) {
        this.shadowRoot.querySelector(".brush-cursor")
          .setAttribute("visibility", "hidden");
      }
    });
    const finishPointer = (event) => {
      if (event.pointerId === this._activePointerId) this._commitDraft();
      this._pointers.delete(event.pointerId);
      if (this._pointers.size < 2) this._pinch = undefined;
      if (this._pointers.size === 0) {
        this._panStart = undefined;
        this._activePointerId = undefined;
        svg.classList.remove("moving");
      }
      if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    };
    const cancelPointer = (event) => {
      cancelDraft();
      this._pointers.delete(event.pointerId);
      if (this._pointers.size < 2) this._pinch = undefined;
      if (this._pointers.size === 0) {
        this._panStart = undefined;
        this._activePointerId = undefined;
        svg.classList.remove("moving");
      }
      if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    };
    svg.addEventListener("pointerup", finishPointer);
    svg.addEventListener("pointercancel", cancelPointer);
    svg.addEventListener("wheel", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const unit = event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? Math.max(1, svg.clientHeight)
          : 1;
      const deltaX = event.deltaX * unit;
      const deltaY = event.deltaY * unit;
      if (event.ctrlKey || event.metaKey || this._isMouseWheel(event, deltaX, deltaY)) {
        const point = svg.createSVGPoint();
        point.x = event.clientX;
        point.y = event.clientY;
        const center = point.matrixTransform(svg.getScreenCTM().inverse());
        const factor = Math.exp(Math.max(-0.28, Math.min(0.28, deltaY * 0.0025)));
        this._zoom(svg, factor, center);
      } else {
        this._panByPixels(
          svg,
          -Math.max(-80, Math.min(80, deltaX)),
          -Math.max(-80, Math.min(80, deltaY)),
        );
      }
    }, { passive: false });
    const range = this.shadowRoot.querySelector(".radius input[type=range]");
    range.addEventListener("input", (event) => {
      event.stopPropagation();
      this._radius = Number(event.target.value);
      this.shadowRoot.querySelector(".radius-value").textContent =
        `${(this._radius * 2).toFixed(2)} m`;
      this.shadowRoot.querySelector(".brush-cursor")
        .setAttribute("r", this._radius);
    });
    this.shadowRoot.querySelector(".area-zoom-slider").addEventListener(
      "input",
      (event) => {
        event.stopPropagation();
        const scale = Number(event.target.value) / 100;
        const center = {
          x: this._viewBox.x + this._viewBox.width / 2,
          y: this._viewBox.y + this._viewBox.height / 2,
        };
        this._zoom(
          svg,
          (this._baseViewBox.width / scale) / this._viewBox.width,
          center,
        );
      },
    );
    this._guardButton(this.shadowRoot.querySelector("[data-tool=draw]"), () =>
      this._setTool("draw"));
    this._guardButton(this.shadowRoot.querySelector("[data-tool=erase]"), () =>
      this._setTool("erase"));
    this._guardButton(this.shadowRoot.querySelector("[data-tool=pan]"), () =>
      this._setTool("pan"));
    for (const button of this.shadowRoot.querySelectorAll("[data-layer]")) {
      this._guardButton(button, () => this._setMapLayer(button.dataset.layer));
    }
    this._guardButton(this.shadowRoot.querySelector(".refresh-photo"), () =>
      this._loadPhotoMap());
    this._guardButton(this.shadowRoot.querySelector(".zoom-out"), () =>
      this._zoom(svg, 1.15));
    this._guardButton(this.shadowRoot.querySelector(".zoom-in"), () =>
      this._zoom(svg, 0.85));
    this._guardButton(this.shadowRoot.querySelector(".fit"), () =>
      this._fitMap(svg));
    this._guardButton(this.shadowRoot.querySelector(".expand"), () =>
      this._toggleExpanded());
    this._guardButton(this.shadowRoot.querySelector(".launcher"), () =>
      this._toggleExpanded());
    this._guardButton(this.shadowRoot.querySelector(".undo"), () => {
      this._undo();
    });
    this._guardButton(this.shadowRoot.querySelector(".redo"), () => {
      this._redo();
    });
    this._guardButton(this.shadowRoot.querySelector(".clear"), () => {
      this._setValue([]);
    });
    this._setTool(this._tool);
    this._setMapLayer(this._preferredMapLayer, { remember: false });
    this._updateControls();
    this._updateZoomButtons();
    workspace.addEventListener("cancel", (event) => {
      event.preventDefault();
      if (this._expanded) this._toggleExpanded();
    });
    this._syncFullscreen();
    this._loadPhotoMap();
  }
}

if (!customElements.get("ha-selector-matic-area")) {
  customElements.define("ha-selector-matic-area", MaticAreaEditor);
}
