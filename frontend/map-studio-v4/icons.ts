/*! Material Design Icons geometry: Apache-2.0. Original robot geometry: MIT. */
import { html, type TemplateResult } from "lit";
import {
  mdiAlert,
  mdiAlertCircle,
  mdiArrowDown,
  mdiArrowExpandAll,
  mdiArrowLeft,
  mdiArrowUp,
  mdiBatteryCharging50,
  mdiCalendarCheck,
  mdiCheck,
  mdiChevronDown,
  mdiChevronRight,
  mdiChevronUp,
  mdiClose,
  mdiDotsVertical,
  mdiFullscreen,
  mdiFullscreenExit,
  mdiFormatText,
  mdiHelpCircleOutline,
  mdiHistory,
  mdiInformationOutline,
  mdiMapMarkerOff,
  mdiMenu,
  mdiMinus,
  mdiPause,
  mdiPlaylistCheck,
  mdiPlay,
  mdiPlus,
  mdiRotateLeft,
  mdiRotateRight,
  mdiShapePolygonPlus,
} from "@mdi/js";

// Re-exported one const at a time rather than as a lookup object: esbuild drops
// unreferenced top-level bindings but keeps every property of an object
// literal, so a map would ship all of them.
//
// Sourced from @mdi/js at build time instead of pasted here, so the geometry is
// the canonical shape and a typo cannot silently render a wrong glyph. The
// dependency is dev-only; the bundle inlines just the paths named above.
export const iconBack = mdiArrowLeft;
export const iconOverflow = mdiDotsVertical;
export const iconMenu = mdiMenu;
export const iconFullMap = mdiFullscreen;
export const iconExitFullMap = mdiFullscreenExit;
export const iconChevronRight = mdiChevronRight;
export const iconChevronUp = mdiChevronUp;
export const iconChevronDown = mdiChevronDown;
export const iconTiltUp = mdiChevronUp;
export const iconTiltDown = mdiChevronDown;
export const iconFit = mdiArrowExpandAll;
export const iconRoomNames = mdiFormatText;
export const iconHelp = mdiHelpCircleOutline;
export const iconOrbitLeft = mdiRotateLeft;
export const iconOrbitRight = mdiRotateRight;
export const iconDone = mdiCheck;
export const iconPlus = mdiPlus;
export const iconMinus = mdiMinus;
export const iconMoveUp = mdiArrowUp;
export const iconMoveDown = mdiArrowDown;
export const iconNewArea = mdiShapePolygonPlus;
export const iconHistory = mdiHistory;
export const iconPlan = mdiPlaylistCheck;
export const iconDiagnostics = mdiInformationOutline;
export { iconRobot } from "./robot-icon";
export const iconCleaning = mdiPlay;
export const iconPaused = mdiPause;
export const iconCharging = mdiBatteryCharging50;
export const iconOffline = mdiMapMarkerOff;
export const iconClose = mdiClose;
// Due work (design-system.md §5: the due glyph).
export const iconDue = mdiCalendarCheck;
// Notice tones (design-system.md .ms-notice): info reuses iconDiagnostics.
export const iconNoticeSuccess = mdiCheck;
export const iconNoticeWarning = mdiAlert;
export const iconNoticeError = mdiAlertCircle;

// Sized by CSS (.ms-icon), never by width/height attributes -- an SVG geometry
// attribute cannot take rem units. `d` is bound, so Lit prepares one template
// and only swaps the attribute however many icons the tree contains.
// A directional icon (Undo, Redo, Back) mirrors under RTL (design-system.md §4).
export const icon = (path: string, options?: { readonly directional?: boolean }): TemplateResult => html`<svg
  class=${options?.directional ? "ms-icon ms-icon--dir" : "ms-icon"}
  viewBox="0 0 24 24"
  fill="currentColor"
  aria-hidden="true"
  focusable="false"
><path d=${path}></path></svg>`;
