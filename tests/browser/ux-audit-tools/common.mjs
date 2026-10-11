// Shared helpers for the Map Studio v4 UX audit measurement scripts. Mirrors the
// harness in tests/browser/map_studio_v4_ux_audit.spec.mjs (openScenario/settle)
// without importing it. Requires `node tests/browser/server.mjs` on port 4173.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

// Scripts print to stdout. The only files written are screenshots, and they go to
// the git-ignored tests/browser/.generated/ux-audit-tools/ directory.
export function outputPath(name) {
  const dir = fileURLToPath(new URL("../.generated/ux-audit-tools/", import.meta.url));
  mkdirSync(dir, { recursive: true });
  return dir + name;
}

export const BASE = "http://127.0.0.1:4173";
export const AUDIT_PAGE = "/map-studio-v4-audit";
export const GALLERY_TAG = "matic-map-studio-gallery-v0-4-0";
// The shell's own narrow rule (shell.ts ResizeObserver): width < 1024 || height < 480.
export const NARROW_BELOW_WIDTH = 1024;
export const NARROW_BELOW_HEIGHT = 480;

export async function launch() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: BASE });
  return { browser, context };
}

export async function openScenario(page, scenario, { width, height, theme = "light", dir = "ltr", forced = false, reduced = null, patch = null, touch = false }) {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({
    colorScheme: theme,
    forcedColors: forced ? "active" : "none",
    reducedMotion: reduced ?? (forced ? "reduce" : "no-preference"),
  });
  await page.goto(BASE + AUDIT_PAGE, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    (tag) => Boolean(document.querySelector(tag)?.shadowRoot?.querySelector(".stage")),
    GALLERY_TAG,
  );
  await page.addStyleTag({ content: "body > aside[role='note'] { display: none !important; }" });
  const narrow = width < NARROW_BELOW_WIDTH || height < NARROW_BELOW_HEIGHT;
  await page.evaluate(async ({ tag, scenario, narrow, dir, patch }) => {
    document.documentElement.dir = dir;
    // Same as the capture harness: swap in a fresh gallery whose full-size stage
    // is adopted before its first render, so the map fits once at final size.
    document.querySelector(tag).remove();
    const gallery = document.createElement(tag);
    gallery.controls = false;
    gallery.narrow = narrow;
    gallery.scenario = scenario;
    document.body.append(gallery);
    const stage = new CSSStyleSheet();
    stage.replaceSync(".stage{block-size:100dvh!important;min-block-size:0!important;max-inline-size:none!important}");
    gallery.shadowRoot.adoptedStyleSheets = [...gallery.shadowRoot.adoptedStyleSheets, stage];
    await gallery.updateComplete;
    if (patch) {
      gallery.replaceWorkspaceState({ ...gallery.getWorkspaceSnapshot(), ...patch });
      await gallery.updateComplete;
    }
  }, { tag: GALLERY_TAG, scenario, narrow, dir, patch });
  await settle(page);
}

export async function settle(page) {
  await page.evaluate(async (tag) => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const gallery = document.querySelector(tag);
    const shell = gallery.shadowRoot.querySelector(".stage").firstElementChild;
    for (let i = 0; i < 160; i += 1) {
      await gallery.updateComplete;
      await shell.updateComplete;
      const root = shell.shadowRoot;
      const workflow = [...root.querySelectorAll("*")].find((e) => e.localName.startsWith("matic-map-workflow-v4"));
      if (workflow) await workflow.updateComplete;
      const loading = Boolean(root.querySelector(".workflow-loading"))
        || (workflow?.shadowRoot?.querySelector(".loading")?.textContent ?? "").includes("Loading workspace tools");
      if (!loading) break;
      await wait(50);
    }
    await frame();
    await frame();
    const transitions = document.getAnimations({ subtree: true })
      .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.race([Promise.all(transitions.map((a) => a.finished.catch(() => undefined))), wait(2000)]);
    await frame();
  }, GALLERY_TAG);
}

// In-page helper source: deep (shadow-piercing) element walker + descriptor.
// Injected as a string so scripts can `page.evaluate` against it.
export const DEEP_HELPERS = `
window.__uxAudit = (() => {
  const gallery = () => document.querySelector("${GALLERY_TAG}");
  const shell = () => gallery().shadowRoot.querySelector(".stage").firstElementChild;
  const deepAll = (root, out = []) => {
    for (const el of root.querySelectorAll("*")) {
      out.push(el);
      if (el.shadowRoot) deepAll(el.shadowRoot, out);
    }
    return out;
  };
  const all = () => deepAll(shell().shadowRoot, []);
  const INTERACTIVE = 'button, a[href], input, select, textarea, summary, [role="button"], [role="checkbox"], [role="radio"], [role="switch"], [role="slider"], [role="tab"], [role="menuitem"], [role="option"], [tabindex]:not([tabindex="-1"])';
  const hostPath = (el) => {
    const parts = [];
    let node = el;
    for (let i = 0; i < 8 && node; i += 1) {
      const tag = node.localName + (node.classList && node.classList.length ? "." + [...node.classList].slice(0, 3).join(".") : "") + (node.id ? "#" + node.id : "");
      parts.unshift(tag);
      const root = node.getRootNode();
      node = node.parentElement || (root instanceof ShadowRoot ? root.host : null);
      if (node && node.localName === "${GALLERY_TAG}") break;
    }
    return parts.slice(-4).join(" > ");
  };
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    // sr-only clip pattern
    if (r.width <= 1 && r.height <= 1) return false;
    // inert subtree or clipped by ancestors with overflow hidden is not tested here
    return true;
  };
  const name = (el) => {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria;
    const lab = el.labels && el.labels[0];
    if (lab) return lab.textContent.trim().replace(/\\s+/g, " ").slice(0, 50);
    return (el.textContent || el.value || el.getAttribute("title") || "").trim().replace(/\\s+/g, " ").slice(0, 50);
  };
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
  };
  const describe = (el) => {
    const r = rect(el);
    const label = el.closest ? el.closest("label") : null;
    const lr = label ? rect(label) : null;
    return {
      tag: el.localName, type: el.getAttribute("type") || "", role: el.getAttribute("role") || "",
      name: name(el), path: hostPath(el), w: r.w, h: r.h, x: r.x, y: r.y,
      labelW: lr ? lr.w : null, labelH: lr ? lr.h : null,
      ariaDisabled: el.getAttribute("aria-disabled") === "true" || el.disabled === true,
    };
  };
  return { gallery, shell, deepAll, all, INTERACTIVE, hostPath, visible, name, rect, describe };
})();
`;

export async function inject(page) {
  await page.evaluate(DEEP_HELPERS);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
