import { html, nothing, type TemplateResult } from "lit";
import type { MapZoneOverlay, SceneModel } from "./backend-contracts";
import type { DateFormat, Localize, NoticePlaceholders, WorkspaceIntent, WorkspaceState } from "./contracts";
import { icon, iconClose } from "./icons";
import { formatDuration, formatList } from "./localize";
import type { MapPoint } from "./renderer-camera";
import { roomAt } from "./renderer-hit-test";
import { pointInPolygon } from "./renderer-math";
import { trailVisible } from "./renderer-overlays";
import { statusCopy } from "./shell-presentation";
import { canFollowRobot, canSelectRooms, canShowExactPose, selectGlobalPrimaryAction } from "./state";
import { rgba, type CanvasPalette } from "./theme-probe";

type Translate = (key: string, fallback: string, placeholders?: NoticePlaceholders) => string;
type Polygon = readonly (readonly [number, number])[];

/** What a tap on the live map picked; the panel reads its details from the state each render. */
export type Inspected =
  | { readonly kind: "robot" }
  | { readonly kind: "room"; readonly roomId: string; readonly at: MapPoint }
  | { readonly kind: "zone"; readonly zone: MapZoneOverlay; readonly at: MapPoint }
  | { readonly kind: "trail"; readonly segment: number; readonly index: number };

/** Taps inspect the live map on home and in Cleaning history; the other workflows use them to pick. */
export const canInspect = (state: WorkspaceState): boolean =>
  state.dataMode === "live" && state.selection.floorId === "current" && !state.floor.readOnly
  && state.map.available && !state.comparisonActive && (state.workflow === "none" || state.workflow === "runs");

// How far from a tap, in CSS pixels, the robot or a trail point still counts as hit.
const REACH_PIXELS = 22;

const insideZone = (zone: MapZoneOverlay, { x, y }: MapPoint): boolean =>
  pointInPolygon(x, y, zone.outline) && !zone.holes.some((hole) => pointInPolygon(x, y, hole));

/**
 * The topmost thing under a map point: the robot, then a trail point, a
 * robot zone and a room. `toScreen` projects a map point to CSS pixels.
 */
export const inspectAt = (
  state: WorkspaceState,
  scene: SceneModel,
  at: MapPoint,
  toScreen: (point: MapPoint) => MapPoint | null,
): Inspected | null => {
  if (!canInspect(state)) return null;
  // The map's scale at the tap: the mean of a metre east and a metre north.
  // Without one, as when a metre away falls behind the camera, only zones and
  // rooms can be hit.
  const here = toScreen(at);
  const scales = [{ x: at.x + 1, y: at.y }, { x: at.x, y: at.y + 1 }].flatMap((point) => {
    const there = toScreen(point);
    return here && there ? [Math.hypot(there.x - here.x, there.y - here.y)] : [];
  });
  const pixels = scales.reduce((sum, value) => sum + value, 0);
  const reach = pixels > 0 ? REACH_PIXELS * scales.length / pixels : 0;
  const position = canShowExactPose(state) ? state.resources.pose.value?.position : null;
  if (position && Math.hypot(position[0] - at.x, position[1] - at.y) < reach) return { kind: "robot" };
  if (trailVisible(state)) {
    let nearest: Inspected | null = null;
    let best = reach;
    for (const [segment, points] of state.trail!.segments.entries()) {
      for (const [index, [x, y]] of points.entries()) {
        const distance = Math.hypot(x - at.x, y - at.y);
        if (distance < best) [nearest, best] = [{ kind: "trail", segment, index }, distance];
      }
    }
    if (nearest) return nearest;
  }
  const zone = state.resources.areas.value?.zones.find((candidate) => insideZone(candidate, at));
  if (zone) return { kind: "zone", zone, at };
  const { metersPerCell, origin } = scene.metadata;
  const cellX = at.x / metersPerCell - origin[0];
  const cellY = at.y / metersPerCell - origin[1];
  const rooms = scene.metadata.rooms.filter((room) => pointInPolygon(cellX, cellY, room.boundary));
  return rooms.length === 1 ? { kind: "room", roomId: rooms[0]!.id, at } : null;
};

/** The trail point on show, or null once the trail no longer has it. */
const trailPoint = (state: WorkspaceState, inspected: Inspected) =>
  inspected.kind === "trail" && trailVisible(state)
    ? state.trail!.segments[inspected.segment]?.[inspected.index] ?? null : null;

/** The map point the inspect marker rings: a trail point only, since the rest name themselves. */
export const inspectMarker = (state: WorkspaceState, inspected: Inspected | null): MapPoint | null => {
  const point = inspected && trailPoint(state, inspected);
  return point ? { x: point[0], y: point[1] } : null;
};

/** False once what was inspected left the map, so the panel closes. */
export const stillInspectable = (state: WorkspaceState, inspected: Inspected): boolean => {
  if (!canInspect(state)) return false;
  switch (inspected.kind) {
    case "robot": return canShowExactPose(state) && !!state.resources.pose.value?.position;
    case "room": return !!state.resources.scene.value?.metadata.rooms.some((room) => room.id === inspected.roomId);
    case "zone": return !!state.resources.areas.value?.zones.includes(inspected.zone);
    case "trail": return trailPoint(state, inspected) !== null;
  }
};

/** A ring around the inspected point, on the 2D overlay above the trail. */
export const drawInspectMarker = (
  context: CanvasRenderingContext2D,
  point: MapPoint,
  palette: CanvasPalette,
  project: (x: number, y: number) => MapPoint | null,
): void => {
  const at = project(point.x, point.y);
  if (!at) return;
  context.beginPath();
  context.arc(at.x, at.y, 9, 0, Math.PI * 2);
  context.lineWidth = 5;
  context.strokeStyle = rgba(palette.onAccent, 1);
  context.stroke();
  context.lineWidth = 2.5;
  context.strokeStyle = rgba(palette.text, 1);
  context.stroke();
};

/** Shoelace area of a ring, in the square of its units. */
const ringArea = (ring: Polygon): number =>
  Math.abs(ring.reduce((sum, [x, y], index) => {
    const [nextX, nextY] = ring[(index + 1) % ring.length]!;
    return sum + x * nextY - nextX * y;
  }, 0)) / 2;

export interface InspectContext {
  readonly state: WorkspaceState;
  readonly scene: SceneModel;
  readonly inspected: Inspected;
  readonly t: Translate;
  readonly localize: Localize | undefined;
  readonly dates: DateFormat | undefined;
  readonly intent: (intent: WorkspaceIntent) => void;
  /** Sends a workspace action by id, as the sheet's buttons do. */
  readonly action: (id: string) => void;
  readonly inspect: (inspected: Inspected) => void;
  readonly close: () => void;
}

interface Details {
  readonly title: string;
  readonly rows: readonly (readonly [string, string])[];
  readonly note?: string;
  readonly actions: readonly TemplateResult[];
}

const button = (label: string, onClick: () => void, disabled = false) =>
  html`<button class="ms-btn ms-btn--sm" type="button" ?disabled=${disabled} @click=${onClick}>${label}</button>`;

const roomKey = (name: string | null | undefined): string => name?.toLocaleLowerCase().trim() ?? "";

const size = ({ state, t }: InspectContext, squareMetres: number): readonly [string, string] =>
  [t("v4_inspect_size", "Size"), t("v4_inspect_square_metres", "{area} m²", {
    area: new Intl.NumberFormat(state.locale, { maximumFractionDigits: squareMetres < 10 ? 1 : 0 }).format(squareMetres),
  })];

const roomDetails = (context: InspectContext, inspected: Extract<Inspected, { kind: "room" }>): Details | null => {
  const { state, scene, t, intent } = context;
  const room = scene.metadata.rooms.find(({ id }) => id === inspected.roomId);
  if (!room) return null;
  const rows: (readonly [string, string])[] = [size(context, ringArea(room.boundary) * scene.metadata.metersPerCell ** 2)];
  const floorTypes = state.floorTypes?.status === "ready" ? state.floorTypes : null;
  const on = (outlines: readonly Polygon[] | undefined) => outlines?.some((ring) => pointInPolygon(inspected.at.x, inspected.at.y, ring));
  const floor = on(floorTypes?.vent) ? t("v4_key_vent", "Floor vent") : on(floorTypes?.carpet) ? t("v4_key_carpet", "Carpet") : null;
  if (floor) rows.push([t("v4_inspect_here", "Where you tapped"), floor]);
  if (state.currentArea && roomKey(state.currentArea) === roomKey(room.name)) {
    rows.push([t("v4_inspect_robot", "Robot"), t("v4_inspect_robot_here", "In this room")]);
  }
  const roomId = state.workflow === "none" && canSelectRooms(state) ? roomAt(scene, state, inspected.at) : null;
  return {
    title: room.name,
    rows,
    actions: roomId ? [button(t("v4_inspect_choose_room", "Choose for a clean"), () => {
      intent({ type: "open-workflow", workflow: "rooms" });
      if (!state.selection.roomIds.includes(roomId)) intent({ type: "toggle-room", roomId });
    })] : [],
  };
};

const zoneDetails = (context: InspectContext, { zone }: Extract<Inspected, { kind: "zone" }>): Details => {
  const { state, t } = context;
  const names = new Map([...state.resources.plans.value?.rooms ?? [], ...state.resources.areas.value?.rooms ?? []]
    .map((room) => [room.roomId, room.name]));
  const rooms = [...new Set(zone.roomIds.flatMap((id) => names.get(id) ?? []))];
  const area = ringArea(zone.outline) - zone.holes.reduce((sum, hole) => sum + ringArea(hole), 0);
  return {
    title: zone.kind === "no_go" ? t("v4_key_no_go", "No-go zone") : t("v4_key_robot_zone", "Robot zone, purpose unknown"),
    rows: [size(context, area), ...rooms.length
      ? [[t("v4_inspect_rooms", "Rooms"), formatList(state.locale, rooms)] as const] : []],
    actions: [],
  };
};

const trailDetails = (context: InspectContext, inspected: Extract<Inspected, { kind: "trail" }>): Details | null => {
  const { state, t, dates, inspect } = context;
  const segments = state.trail!.segments;
  const points = segments.flat();
  const position = segments.slice(0, inspected.segment).reduce((sum, list) => sum + list.length, 0) + inspected.index;
  const point = points[position];
  if (!point) return null;
  const at = point[2];
  const first = points.find((candidate) => candidate[2] !== undefined)?.[2];
  const time = at === undefined ? t("v4_inspect_time_unknown", "Not recorded")
    : new Intl.DateTimeFormat(dates?.language ?? state.locale, { dateStyle: "medium", timeStyle: "medium", timeZone: dates?.timeZone })
      .format(at * 1000);
  const step = (offset: number) => {
    let next = position + offset;
    for (const [segment, list] of segments.entries()) {
      if (next < list.length) return inspect({ kind: "trail", segment, index: next });
      next -= list.length;
    }
  };
  return {
    title: t("v4_inspect_trail_point", "Trail point"),
    rows: [
      [t("v4_inspect_time", "Robot here at"), time],
      ...at !== undefined && first !== undefined && at > first
        ? [[t("v4_inspect_into_clean", "Into the clean"), formatDuration(state.locale, at - first)] as const] : [],
      [t("v4_inspect_point", "Point"), t("v4_inspect_point_of", "{number} of {count}", { number: position + 1, count: points.length })],
    ],
    note: t("v4_inspect_trail_note", "Times come from the robot. Arrows on the trail point the way it went."),
    actions: [
      button(t("v4_inspect_earlier", "Earlier point"), () => step(-1), position === 0),
      button(t("v4_inspect_later", "Later point"), () => step(1), position === points.length - 1),
    ],
  };
};

// The robot's own actions are the sheet's: Stop, Stop now & dock, or Resume.
const ROBOT_ACTIONS = new Set(["stop", "stop-now", "resume"]);

const robotDetails = (context: InspectContext): Details => {
  const { state, t, localize, dates, intent, action } = context;
  const status = statusCopy(state, localize, dates);
  const primary = selectGlobalPrimaryAction(state);
  const actions: TemplateResult[] = [];
  if (primary && "label" in primary && ROBOT_ACTIONS.has(primary.id)) {
    actions.push(button(primary.labelKey ? t(primary.labelKey, primary.label) : primary.label, () => action(primary.id), !primary.enabled));
  }
  if (state.followMode === "off" && canFollowRobot(state, "follow")) {
    actions.push(button(t("v4_inspect_follow", "Follow the robot"), () => intent({ type: "set-follow-mode", mode: "follow" })));
  }
  return {
    title: t("v4_inspect_robot", "Robot"),
    rows: [[t("v4_inspect_status", "Status"), status.title]],
    ...status.detail ? { note: status.detail } : {},
    actions,
  };
};

/** The details card for what was tapped, with the actions that fit the robot's state. */
export const inspectPanel = (context: InspectContext) => {
  const { inspected, t, close } = context;
  const details = inspected.kind === "robot" ? robotDetails(context)
    : inspected.kind === "room" ? roomDetails(context, inspected)
      : inspected.kind === "zone" ? zoneDetails(context, inspected)
        : trailDetails(context, inspected);
  if (!details) return nothing;
  return html`
    <style>
      .inspect { padding: var(--ms-space-2) var(--ms-space-3); font-size: var(--ms-t-sm); }
      .inspect header { display: flex; align-items: center; justify-content: space-between; gap: var(--ms-space-2); }
      .inspect h2 { margin: 0; font-size: var(--ms-t-sm); font-weight: var(--ms-w-bold); overflow-wrap: anywhere; }
      .inspect dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.125rem var(--ms-space-2); margin: var(--ms-space-1) 0 0; }
      .inspect dt { color: var(--ms-text-quiet); }
      .inspect dd { margin: 0; overflow-wrap: anywhere; }
      .inspect p { margin: var(--ms-space-1) 0 0; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); }
      .inspect-actions { display: flex; flex-wrap: wrap; gap: var(--ms-space-1); margin-block-start: var(--ms-space-2); }
      .inspect-actions:empty { display: none; }
    </style>
    <section class="inspect ms-surface ms-surface--floating" data-inspect=${inspected.kind} aria-labelledby="inspect-title">
      <header>
        <h2 id="inspect-title" aria-live="polite">${details.title}</h2>
        <button class="ms-btn ms-btn--icon" type="button" aria-label=${t("v4_inspect_close", "Close details")}
          title=${t("v4_inspect_close", "Close details")} @click=${close}>${icon(iconClose)}</button>
      </header>
      <dl aria-live="polite">${details.rows.map(([term, detail]) => html`<dt>${term}</dt><dd>${detail}</dd>`)}</dl>
      ${details.note ? html`<p>${details.note}</p>` : nothing}
      <div class="inspect-actions">${details.actions}</div>
    </section>
  `;
};
