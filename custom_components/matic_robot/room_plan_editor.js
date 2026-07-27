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
        .switch { margin-left: 6px; }
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
      const enabled = document.createElement("ha-switch");
      enabled.className = "switch";
      enabled.checked = row.included;
      enabled.disabled = this._disabled;
      enabled.setAttribute(
        "aria-label",
        this._localize("include_room", `Include ${roomName}`, { room: roomName }),
      );
      enabled.addEventListener("change", (event) =>
        this._update(row.room_id, { included: event.target.checked }),
      );
      header.append(enabled);
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
    this._radius = 0.35;
    this._tool = "draw";
    this._viewBox = undefined;
    this._baseViewBox = undefined;
    this._panStart = undefined;
    this._draftCircle = undefined;
    this._activePointerId = undefined;
    this._expanded = true;
    this._undoStack = [];
    this._redoStack = [];
    this._spacePressed = false;
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
    this._selector = value || {};
    const roomsChanged = previousRooms !== JSON.stringify(this._rooms());
    if (roomsChanged || !this.shadowRoot?.hasChildNodes()) this._render();
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
    this._restorePageScroll();
  }

  reportValidity() {
    return !this._required || this._value.length > 0;
  }

  _rooms() {
    return this._selector?.rooms || this._selector?.["matic-area"]?.rooms || [];
  }

  _localize(key, fallback) {
    return this._hass?.localize(`component.matic_robot.common.${key}`) || fallback;
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

  _fitMap(svg) {
    this._setViewBox(svg, { ...this._baseViewBox });
  }

  _focusRoom(svg, roomId) {
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
    this._tool = tool;
    this._panStart = undefined;
    const svg = this.shadowRoot.querySelector(".map");
    svg.dataset.tool = tool;
    for (const button of this.shadowRoot.querySelectorAll("[data-tool]")) {
      const selected = button.dataset.tool === tool;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    }
    this.shadowRoot.querySelector(".map-help").textContent =
      tool === "draw"
        ? this._localize("area_draw_help", "Drag from the center to the edge of the area. Add more circles if needed.")
        : this._localize("area_pan_help", "Drag the map to move around. Use + and − to zoom.");
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

  _showDraft(circle) {
    const preview = this.shadowRoot.querySelector(".preview");
    if (!circle) {
      preview.setAttribute("visibility", "hidden");
      return;
    }
    preview.setAttribute("cx", circle.x);
    preview.setAttribute("cy", -circle.y);
    preview.setAttribute("r", circle.radius);
    preview.setAttribute("visibility", "visible");
  }

  _updateDraft(svg, event) {
    if (!this._draftCircle) return;
    const point = this._mapPoint(svg, event);
    const distance = Math.hypot(
      point.x - this._draftCircle.x,
      -point.y - this._draftCircle.y,
    );
    const pixelDistance = Math.hypot(
      event.clientX - this._draftCircle.clientX,
      event.clientY - this._draftCircle.clientY,
    );
    this._draftCircle.radius = Number(
      (pixelDistance < 5 ? this._radius : Math.max(0.1, Math.min(2.5, distance)))
        .toFixed(2),
    );
    this._showDraft(this._draftCircle);
  }

  _commitDraft() {
    if (!this._draftCircle) return;
    const circle = {
      x: this._draftCircle.x,
      y: this._draftCircle.y,
      radius: this._draftCircle.radius,
    };
    this._draftCircle = undefined;
    this._showDraft(undefined);
    if (!this._pointIsMapped(circle.x, circle.y)) {
      this._announce(this._localize("area_outside_map", "Start the circle inside a mapped room."));
      return;
    }
    this._setValue([...this._value, circle]);
    this._announce(this._localize("area_added", "Cleaning area added."));
  }

  _syncMarks() {
    const group = this.shadowRoot.querySelector(".marks");
    if (!group) return;
    group.replaceChildren();
    const namespace = "http://www.w3.org/2000/svg";
    for (const circle of this._value) {
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
    const totalArea = this._value.reduce(
      (sum, circle) => sum + Math.PI * Number(circle.radius) ** 2,
      0,
    );
    count.textContent = `${this._value.length} ${this._localize("area_marks", "area marks")} · ${totalArea.toFixed(1)} m²`;
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
    } else if (event.key === "Escape") {
      event.preventDefault();
      this._toggleExpanded();
    } else if (event.key.toLowerCase() === "d") {
      this._setTool("draw");
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
        .workspace.expanded { width: 100vw; height: 100dvh; max-width: none; max-height: none; margin: 0; border: 0; padding: 0; box-sizing: border-box; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; background: #0b1118; overflow: hidden; }
        .topbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 12px 16px; background: color-mix(in srgb, var(--card-background-color) 94%, transparent); border-bottom: 1px solid var(--divider-color); z-index: 3; }
        .title-group { display: grid; gap: 2px; margin-right: 8px; }
        .title { font-size: 18px; font-weight: 650; color: var(--primary-text-color); }
        .intro { color: var(--secondary-text-color); font-size: 12px; }
        .map-stage { position: relative; min-height: 0; overflow: hidden; padding: 12px; }
        .map-shell { position: relative; height: 100%; min-height: 420px; }
        .map { display: block; width: 100%; height: 100%; min-height: 420px; border: 1px solid rgba(143, 171, 202, .3); border-radius: 18px; background: radial-gradient(circle at 50% 40%, #182538, #0c131d 72%); touch-action: none; user-select: none; outline: none; }
        .map:focus-visible { border-color: var(--primary-color); box-shadow: inset 0 0 0 2px var(--primary-color); }
        .map[data-tool="draw"] { cursor: crosshair; }
        .map[data-tool="pan"] { cursor: grab; }
        .map[data-tool="pan"].moving { cursor: grabbing; }
        .room { fill: rgba(76, 126, 204, .42); stroke: rgba(226, 238, 252, .7); stroke-width: 1px; vector-effect: non-scaling-stroke; }
        .room-label { fill: #fff; font-weight: 650; text-anchor: middle; dominant-baseline: middle; paint-order: stroke; stroke: rgba(7, 12, 19, .94); stroke-width: .12; stroke-linejoin: round; pointer-events: none; }
        .drawn { fill: rgba(255, 193, 7, .46); stroke: #ffd54f; stroke-width: .025; vector-effect: non-scaling-stroke; pointer-events: none; }
        .preview { fill: rgba(255, 213, 79, .28); stroke: #fff176; stroke-width: 2px; stroke-dasharray: 6 5; vector-effect: non-scaling-stroke; pointer-events: none; }
        .map-controls { display: contents; }
        .spacer { flex: 1 1 auto; }
        .room-focus { min-height: 46px; max-width: 190px; padding: 0 34px 0 12px; border: 1px solid var(--divider-color); border-radius: 12px; background: var(--card-background-color); color: var(--primary-text-color); }
        .map-help { position: absolute; left: 26px; bottom: 26px; max-width: min(520px, calc(100% - 52px)); padding: 8px 11px; border-radius: 10px; color: #d8e4f2; background: rgba(5, 10, 16, .78); backdrop-filter: blur(8px); font-size: 12px; pointer-events: none; }
        .footer { display: grid; grid-template-columns: minmax(180px, 1fr) auto auto auto auto; gap: 10px; align-items: center; padding: 10px 16px 14px; background: color-mix(in srgb, var(--card-background-color) 94%, transparent); border-top: 1px solid var(--divider-color); }
        .radius { display: grid; gap: 4px; color: var(--secondary-text-color); font-size: 12px; }
        input[type=range] { width: 100%; }
        button { min-height: 46px; min-width: 46px; padding: 0 15px; border: 1px solid var(--divider-color); border-radius: 12px; background: var(--card-background-color); color: var(--primary-text-color); cursor: pointer; touch-action: manipulation; }
        button.selected { border-color: var(--primary-color); color: var(--primary-color); background: color-mix(in srgb, var(--primary-color) 14%, transparent); }
        button.primary { border-color: var(--primary-color); background: var(--primary-color); color: var(--text-primary-color, #fff); font-weight: 650; }
        button.zoom { min-width: 42px; padding: 0 11px; font-size: 20px; }
        button:disabled { opacity: .4; cursor: default; }
        .count { color: var(--secondary-text-color); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .announcement { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
        @media (max-width: 820px) {
          .workspace.expanded { grid-template-rows: auto minmax(0, 1fr) auto; }
          .topbar { padding: 8px; gap: 6px; }
          .title-group { width: 100%; }
          .room-focus { flex: 1 1 140px; max-width: none; }
          button { min-height: 42px; padding: 0 10px; }
          .map-stage { padding: 6px; }
          .map { border-radius: 12px; min-height: 260px; }
          .map-help { left: 14px; bottom: 14px; max-width: calc(100% - 28px); }
          .footer { grid-template-columns: 1fr auto auto auto; padding: 8px; gap: 6px; }
          .radius { grid-column: 1 / -1; }
          .count { display: none; }
        }
      </style>
      <button class="launcher" type="button" ${this._expanded ? "hidden" : ""}>${this._localize("expand_map", "Open full-screen editor")}</button>
      <dialog class="workspace ${this._expanded ? "expanded" : ""}">
        <div class="topbar">
          <div class="title-group">
            <span class="title">${this._localize("area_editor_title", "Custom area studio")}</span>
            <span class="intro">${this._localize("area_editor_intro", "Draw one or more cleaning circles over the map.")}</span>
          </div>
          <div class="map-controls" role="toolbar" aria-label="${this._localize("area_map_controls", "Map controls")}">
            <button class="tool selected" data-tool="draw" type="button" aria-pressed="true">${this._localize("draw", "Draw")}</button>
            <button class="tool" data-tool="pan" type="button" aria-pressed="false">${this._localize("move_map", "Pan")}</button>
            <select class="room-focus" aria-label="${this._localize("focus_room", "Focus room")}"></select>
            <span class="spacer"></span>
            <button class="zoom zoom-out" type="button" aria-label="${this._localize("zoom_out", "Zoom out")}" title="${this._localize("zoom_out", "Zoom out")}">−</button>
            <button class="zoom zoom-in" type="button" aria-label="${this._localize("zoom_in", "Zoom in")}" title="${this._localize("zoom_in", "Zoom in")}">+</button>
            <button class="fit" type="button">${this._localize("fit_map", "Fit")}</button>
            <button class="expand primary" type="button" aria-expanded="${this._expanded ? "true" : "false"}">${this._expanded ? this._localize("done_editing", "Done editing") : this._localize("expand_map", "Open full-screen editor")}</button>
          </div>
        </div>
        <div class="map-stage">
          <div class="map-shell">
            <svg class="map" tabindex="0" data-tool="${this._tool}" role="application" aria-label="${this._localize("area_map", "Custom cleaning area map")}" viewBox="${this._viewBox.x} ${this._viewBox.y} ${this._viewBox.width} ${this._viewBox.height}" preserveAspectRatio="xMidYMid meet">
              <g class="rooms"></g><g class="marks"></g><circle class="preview" visibility="hidden"></circle><g class="labels"></g>
            </svg>
          </div>
          <div class="map-help"></div>
        </div>
        <div class="footer">
        <label class="radius">${this._localize("brush_size", "Tap size")} · <span class="radius-value">${this._radius.toFixed(2)} m</span><input type="range" min="0.10" max="2.50" step="0.05" value="${this._radius}" ${this._disabled ? "disabled" : ""}></label>
        <span class="count">${this._value.length} ${this._localize("area_marks", "area marks")}</span>
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
      label.textContent = room.name;
      labelsGroup.append(label);
    }
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
    svg.addEventListener("pointerdown", (event) => {
      if (
        this._disabled ||
        ![0, 1].includes(event.button) ||
        event.isPrimary === false ||
        this._activePointerId !== undefined
      ) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this._activePointerId = event.pointerId;
      svg.setPointerCapture(event.pointerId);
      if (this._tool === "pan" || event.button === 1 || this._spacePressed) {
        const matrix = svg.getScreenCTM().inverse();
        this._panStart = {
          point: this._mapPoint(svg, event, matrix),
          matrix,
          viewBox: { ...this._viewBox },
        };
        svg.classList.add("moving");
      } else {
        if (this._value.length >= 512) {
          this._activePointerId = undefined;
          svg.releasePointerCapture(event.pointerId);
          return;
        }
        const point = this._mapPoint(svg, event);
        this._draftCircle = {
          x: Number(point.x.toFixed(4)),
          y: Number((-point.y).toFixed(4)),
          radius: this._radius,
          clientX: event.clientX,
          clientY: event.clientY,
        };
        this._showDraft(this._draftCircle);
      }
    });
    svg.addEventListener("pointermove", (event) => {
      if (event.pointerId !== this._activePointerId) return;
      if (this._draftCircle) {
        event.preventDefault();
        this._updateDraft(svg, event);
      } else if (this._panStart) {
        event.preventDefault();
        const point = this._mapPoint(svg, event, this._panStart.matrix);
        this._setViewBox(svg, {
          ...this._panStart.viewBox,
          x: this._panStart.viewBox.x + this._panStart.point.x - point.x,
          y: this._panStart.viewBox.y + this._panStart.point.y - point.y,
        });
      }
    });
    const finishPointer = (event) => {
      if (event.pointerId !== this._activePointerId) return;
      this._commitDraft();
      this._panStart = undefined;
      this._activePointerId = undefined;
      svg.classList.remove("moving");
      if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    };
    const cancelPointer = (event) => {
      if (event.pointerId !== this._activePointerId) return;
      this._draftCircle = undefined;
      this._showDraft(undefined);
      this._panStart = undefined;
      this._activePointerId = undefined;
      svg.classList.remove("moving");
      if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    };
    svg.addEventListener("pointerup", finishPointer);
    svg.addEventListener("pointercancel", cancelPointer);
    svg.addEventListener("wheel", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const center = point.matrixTransform(svg.getScreenCTM().inverse());
      const factor = Math.max(0.85, Math.min(1.15, Math.exp(event.deltaY * 0.001)));
      this._zoom(svg, factor, center);
    }, { passive: false });
    const range = this.shadowRoot.querySelector("input[type=range]");
    range.addEventListener("input", (event) => {
      event.stopPropagation();
      this._radius = Number(event.target.value);
      this.shadowRoot.querySelector(".radius-value").textContent =
        `${this._radius.toFixed(2)} m`;
    });
    this._guardButton(this.shadowRoot.querySelector("[data-tool=draw]"), () =>
      this._setTool("draw"));
    this._guardButton(this.shadowRoot.querySelector("[data-tool=pan]"), () =>
      this._setTool("pan"));
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
    this._updateControls();
    this._updateZoomButtons();
    workspace.addEventListener("cancel", (event) => {
      event.preventDefault();
      if (this._expanded) this._toggleExpanded();
    });
    this._syncFullscreen();
  }
}

if (!customElements.get("ha-selector-matic-area")) {
  customElements.define("ha-selector-matic-area", MaticAreaEditor);
}
