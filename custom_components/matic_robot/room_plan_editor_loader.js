let implementationPromise;
let implementationAttempt = 0;

const loadImplementation = () => {
  if (!implementationPromise) {
    const url = new URL("./room-plan-editor.js", import.meta.url);
    url.searchParams.set("load_attempt", String(++implementationAttempt));
    implementationPromise = import(url.href).then(() => Promise.all([
      customElements.whenDefined("matic-room-plan-editor-impl"),
      customElements.whenDefined("matic-area-editor-impl"),
    ])).catch((error) => {
      implementationPromise = undefined;
      throw error;
    });
  }
  return implementationPromise;
};

class MaticLazySelector extends HTMLElement {
  constructor(implementationTag) {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>:host { display: block; min-width: 0; }</style>
      <div id="content"></div>
    `;
    this._content = this.shadowRoot.querySelector("#content");
    this._implementationTag = implementationTag;
    this._hass = undefined;
    this._selector = {};
    this._value = undefined;
    this._disabled = false;
    this._required = false;
    this._implementation = null;
    this._loadGeneration = 0;
    this._retry = () => this._ensureImplementation();
  }

  set hass(value) {
    this._hass = value;
    this._sync("hass");
  }

  get hass() {
    return this._hass;
  }

  set selector(value) {
    this._selector = value || {};
    this._sync("selector");
  }

  get selector() {
    return this._selector;
  }

  set value(value) {
    this._value = value;
    this._sync("value");
  }

  get value() {
    return this._implementation ? this._implementation.value : this._value;
  }

  set disabled(value) {
    this._disabled = Boolean(value);
    this._sync("disabled");
  }

  get disabled() {
    return this._disabled;
  }

  set required(value) {
    this._required = Boolean(value);
    this._sync("required");
  }

  get required() {
    return this._required;
  }

  connectedCallback() {
    // HA may set properties on an unknown custom tag before this module has
    // registered it. Replay those own properties through the real setters.
    for (const property of ["hass", "selector", "value", "disabled", "required"]) {
      if (!Object.prototype.hasOwnProperty.call(this, property)) continue;
      const value = this[property];
      delete this[property];
      this[property] = value;
    }
    this._ensureImplementation();
  }

  disconnectedCallback() {
    this._loadGeneration += 1;
    if (this._implementation) {
      this._value = this._implementation.value;
    }
  }

  reportValidity() {
    // Preserve optional config fields while loading or after an asset failure.
    return this._implementation ? this._implementation.reportValidity() : !this._required;
  }

  _sync(property) {
    if (this._implementation) this._implementation[property] = this[`_${property}`];
  }

  async _ensureImplementation() {
    if (!this.isConnected) return;
    if (this._implementation) {
      if (this._implementation.parentNode !== this._content) {
        this._content.replaceChildren(this._implementation);
      }
      return;
    }
    const generation = ++this._loadGeneration;
    this._showStatus(this._localize("room_editor_loading", "Loading editor…"), false);
    try {
      await loadImplementation();
      if (!this.isConnected || generation !== this._loadGeneration) return;
      const implementation = document.createElement(this._implementationTag);
      implementation.addEventListener("value-changed", this._onValueChanged);
      for (const property of ["hass", "selector", "value", "disabled", "required"]) {
        const value = this[`_${property}`];
        if (value !== undefined) implementation[property] = value;
      }
      this._content.replaceChildren(implementation);
      this._implementation = implementation;
      this._value = implementation.value;
    } catch {
      if (!this.isConnected || generation !== this._loadGeneration) return;
      this._showStatus(this._localize("room_editor_load_failed", "Editor could not load."), true);
    }
  }

  _showStatus(message, retry) {
    const status = document.createElement("div");
    status.setAttribute("role", retry ? "alert" : "status");
    status.setAttribute("aria-live", retry ? "assertive" : "polite");
    status.textContent = message;
    const contents = [status];
    if (retry) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = this._localize("room_editor_retry", "Retry");
      button.addEventListener("click", this._retry, { once: true });
      contents.push(button);
    }
    this._content.replaceChildren(...contents);
  }

  _localize(key, fallback) {
    return this._hass?.localize?.(`component.matic_robot.common.${key}`) || fallback;
  }

  _onValueChanged = (event) => {
    event.stopPropagation();
    this._value = event.detail?.value;
    this.dispatchEvent(new CustomEvent("value-changed", {
      detail: event.detail,
      bubbles: true,
      composed: true,
    }));
  };
}

if (!customElements.get("ha-selector-matic-room-plan")) {
  customElements.define("ha-selector-matic-room-plan", class extends MaticLazySelector {
    constructor() { super("matic-room-plan-editor-impl"); }
  });
}

if (!customElements.get("ha-selector-matic-area")) {
  customElements.define("ha-selector-matic-area", class extends MaticLazySelector {
    constructor() { super("matic-area-editor-impl"); }
  });
}
