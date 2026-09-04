/*! Icon geometry from Material Design Icons. SPDX-License-Identifier: Apache-2.0 */
import { html, type TemplateResult } from "lit";
import {
  mdiArrowDown,
  mdiArrowExpandAll,
  mdiArrowLeft,
  mdiArrowUp,
  mdiBatteryCharging50,
  mdiBrush,
  mdiCheck,
  mdiChevronDown,
  mdiChevronRight,
  mdiChevronUp,
  mdiCircleOutline,
  mdiContentCopy,
  mdiCursorMove,
  mdiDotsVertical,
  mdiDockRight,
  mdiEraser,
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
  mdiRedo,
  mdiRobotVacuum,
  mdiRotateLeft,
  mdiRotateRight,
  mdiShapePolygonPlus,
  mdiUndo,
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
export const iconWorkspace = mdiDockRight;
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
export const iconUndo = mdiUndo;
export const iconRedo = mdiRedo;
export const iconPaint = mdiBrush;
export const iconBrush = mdiCircleOutline;
export const iconErase = mdiEraser;
export const iconMoveMap = mdiCursorMove;
export const iconDone = mdiCheck;
export const iconPlus = mdiPlus;
export const iconMinus = mdiMinus;
export const iconMoveUp = mdiArrowUp;
export const iconMoveDown = mdiArrowDown;
export const iconCopy = mdiContentCopy;
export const iconNewArea = mdiShapePolygonPlus;
export const iconHistory = mdiHistory;
export const iconPlan = mdiPlaylistCheck;
export const iconDiagnostics = mdiInformationOutline;
export const iconRobot = mdiRobotVacuum;
export const iconCleaning = mdiPlay;
export const iconPaused = mdiPause;
export const iconCharging = mdiBatteryCharging50;
export const iconOffline = mdiMapMarkerOff;

// Sized by CSS (.ms-icon), never by width/height attributes -- an SVG geometry
// attribute cannot take rem units. `d` is bound, so Lit prepares one template
// and only swaps the attribute however many icons the tree contains.
export const icon = (path: string): TemplateResult => html`<svg
  class="ms-icon"
  viewBox="0 0 24 24"
  fill="currentColor"
  aria-hidden="true"
  focusable="false"
><path d=${path}></path></svg>`;
