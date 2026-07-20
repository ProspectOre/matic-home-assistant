class MaticRoomPlanEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._selector = {};
    this._value = [];
    this._draggedRoomId = undefined;
  }

  set hass(value) {
    this._hass = value;
    this._render();
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
    field.addEventListener("value-changed", (event) =>
      onChange(event.detail.value),
    );
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
        .list { border: 1px solid var(--divider-color); border-radius: 16px; overflow: hidden; }
        .room { padding: 14px 12px; background: var(--card-background-color); transition: background .15s ease; }
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
