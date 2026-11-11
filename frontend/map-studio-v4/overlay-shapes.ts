import type { SceneModel } from "./backend-contracts";
import type { WorkspaceState } from "./contracts";
import type { CanvasPalette, Channel } from "./theme-probe";
import { selectedRoomNames } from "./renderer-hit-test";
import { roomColours, trailVisible } from "./renderer-overlays";
import { ROOM_PALETTE, roomSlots } from "./room-palette";
import { wifiSurface } from "./wifi-surface";

/** Floor-plane vertices as world [x, z] pairs, in metres from the scene centre. */
export type Ring = Float32Array;

interface Paint {
  readonly rings: readonly Ring[];
  readonly colour: Channel;
  readonly alpha: number;
  /** Metres above the floor plane. */
  readonly height: number;
}

/** Rings filled together with the even-odd rule, so an inner ring is a hole. */
export interface FillShape extends Paint {
  readonly kind: "fill";
}

export interface StrokeShape extends Paint {
  readonly kind: "stroke";
  readonly closed: boolean;
  /** CSS pixels, constant on screen at every zoom. */
  readonly width: number;
  readonly dashed: boolean;
}

/**
 * The Wi-Fi estimate on the floor plane: per texel, premultiplied
 * [dBm × opacity, opacity]. `corners` holds world [x, z] of its first texel's
 * outer corner, then of the far ends of its first row and its first column.
 */
export interface SurfaceShape {
  readonly kind: "surface";
  readonly values: Float32Array<ArrayBuffer>;
  readonly columns: number;
  readonly rows: number;
  readonly corners: Ring;
  readonly height: number;
}

export type OverlayShape = FillShape | StrokeShape | SurfaceShape;

// Neighbouring rooms never share a colour (room-palette.ts); names and
// outlines tell apart rooms that do. A fifth of the theme's room fill tones
// the palette down on a dark map.
const roomColor = (slot: number, palette: CanvasPalette): Channel => palette.forced ? palette.roomFill
  : ROOM_PALETTE[slot]!.map((value, channel) => Math.round(value * .8
    + (palette.roomFill[channel] ?? 0) * .2)) as unknown as Channel;

const hsl = (hue: number, saturation: number, lightness: number): Channel => {
  const amplitude = saturation * Math.min(lightness, 1 - lightness);
  const channel = (offset: number): number => {
    const position = (offset + hue / 30) % 12;
    return Math.round((lightness - amplitude * Math.max(-1, Math.min(position - 3, 9 - position, 1))) * 255);
  };
  return [channel(0), channel(8), channel(4)];
};
export const CARPET = hsl(28, .55, .42);
export const VENT = hsl(205, .8, .5);

/** A map point in metres; a trail point may carry its time third. */
type MapMetres = readonly [number, number, number?];

// Chevrons along the trail point the way the robot went: one every
// CHEVRON_SPACING metres of path, with arms CHEVRON_ARM metres long.
const CHEVRON_SPACING = 1.2;
const CHEVRON_ARM = 0.16;
const CHEVRON_COS = Math.cos(Math.PI / 5);
const CHEVRON_SIN = Math.sin(Math.PI / 5);

/** Each chevron as [wing, tip, wing] in map metres, in travel order. */
export const chevrons = (points: readonly MapMetres[]): [number, number][][] => {
  const result: [number, number][][] = [];
  let next = CHEVRON_SPACING / 2;
  let travelled = 0;
  for (let index = 1; index < points.length; index += 1) {
    const [fromX, fromY] = points[index - 1]!;
    const [toX, toY] = points[index]!;
    const length = Math.hypot(toX - fromX, toY - fromY);
    if (!length) continue;
    const [alongX, alongY] = [(toX - fromX) / length, (toY - fromY) / length];
    for (; next <= travelled + length; next += CHEVRON_SPACING) {
      const tipX = fromX + alongX * (next - travelled);
      const tipY = fromY + alongY * (next - travelled);
      const wing = (side: number): [number, number] => [
        tipX - CHEVRON_ARM * (alongX * CHEVRON_COS - side * alongY * CHEVRON_SIN),
        tipY - CHEVRON_ARM * (alongY * CHEVRON_COS + side * alongX * CHEVRON_SIN),
      ];
      result.push([wing(1), [tipX, tipY], wing(-1)]);
    }
    travelled += length;
  }
  return result;
};

/**
 * Everything drawn on the floor plane, in paint order: rooms, floor types,
 * Wi-Fi signal, zones, then the travel path.
 */
export const overlayShapes = (scene: SceneModel, state: WorkspaceState, palette: CanvasPalette): OverlayShape[] => {
  const { metersPerCell: meters, origin, span } = scene.metadata;
  const worldX = (cell: number): number => -(cell - (span[0] - 1) / 2) * meters;
  const worldZ = (cell: number): number => (cell - (span[1] - 1) / 2) * meters;
  const fromCells = (points: readonly (readonly [number, number])[], step: number): Ring => {
    const ring = new Float32Array(Math.ceil(points.length / step) * 2);
    for (let index = 0, write = 0; index < points.length; index += step, write += 2) {
      ring[write] = worldX(points[index]![0]);
      ring[write + 1] = worldZ(points[index]![1]);
    }
    return ring;
  };
  const fromMeters = (points: readonly MapMetres[]): Ring => {
    const ring = new Float32Array(points.length * 2);
    points.forEach(([x, y], index) => {
      ring[index * 2] = worldX(x / meters - origin[0]);
      ring[index * 2 + 1] = worldZ(y / meters - origin[1]);
    });
    return ring;
  };
  const shapes: OverlayShape[] = [];
  const outline = (rings: readonly Ring[], colour: Channel, alpha: number, width: number, height: number, dashed = false): void => {
    shapes.push({ kind: "stroke", rings, closed: true, colour, alpha, width, dashed, height });
  };

  const colours = roomColours(state);
  const selectedNames = selectedRoomNames(state);
  // Every room draws with Room names on or in Room colors; otherwise only
  // the selected ones (home-rooms.md §5 Parity, R9).
  const allRooms = state.labelsVisible || colours;
  if (allRooms || selectedNames.size) {
    const slots = colours ? roomSlots(scene.metadata.rooms, meters) : null;
    const height = 0.2 * meters;
    for (const room of scene.metadata.rooms) {
      const selected = selectedNames.has(room.name.toLocaleLowerCase());
      if (!allRooms && !selected) continue;
      const rings = [fromCells(room.boundary, Math.max(1, Math.ceil(room.boundary.length / 512)))];
      shapes.push(colours
        ? { kind: "fill", rings, colour: roomColor(slots?.get(room.id) ?? 0, palette), alpha: .94, height }
        : selected ? { kind: "fill", rings, colour: palette.accent, alpha: .26, height }
          : { kind: "fill", rings, colour: palette.plate, alpha: .04, height });
      if (selected) outline(rings, palette.accent, 1, 3, height);
      else if (colours || palette.forced) outline(rings, palette.text, 1, colours ? 2 : 1.5, height);
      else outline(rings, palette.quiet, .7, 1.5, height);
    }
  }

  // A retained scene stays read-only until the live one is admitted, so its
  // geometry may belong to another floor or frame.
  if (state.dataMode === "live" && !state.floor.readOnly && state.selection.floorId === "current") {
    if (state.floorTypes?.status === "ready") {
      for (const [outlines, colour] of [[state.floorTypes.carpet, CARPET], [state.floorTypes.vent, VENT]] as const) {
        if (!outlines.length) continue;
        const rings = outlines.map(fromMeters);
        shapes.push({ kind: "fill", rings, colour, alpha: .35, height: 0.05 * meters });
        outline(rings, colour, .8, 1.25, 0.05 * meters);
      }
    }
    const surface = state.wifiSignal?.status === "ready"
      ? wifiSurface(state.wifiSignal.cells, scene.metadata, Date.now() / 1000) : null;
    if (surface) {
      const { x, y, texel, width, height, values } = surface;
      shapes.push({ kind: "surface", values, columns: width, rows: height, height: 0.1 * meters,
        corners: fromMeters([[x, y], [x + width * texel, y], [x, y + height * texel]]) });
      if (surface.deadZones.length) outline(surface.deadZones.map(fromMeters), palette.text, .9, 1.5, 0.1 * meters);
    }
  }

  // Zones describe the robot's current map, so a saved history map leaves them out.
  if (state.dataMode === "live" && state.selection.floorId === "current") {
    // Read-only: no-go zones are shaded and outlined; zones the robot made
    // itself, whose meaning is not known, get only a dashed outline.
    for (const zone of state.resources.areas.value?.zones ?? []) {
      const rings = [zone.outline, ...zone.holes].map(fromMeters);
      const noGo = zone.kind === "no_go";
      if (noGo) shapes.push({ kind: "fill", rings, colour: palette.text, alpha: .22, height: 0 });
      outline(rings, palette.text, noGo ? .9 : .6, 1.5, 0, !noGo);
    }
  }

  const trail = trailVisible(state) ? state.trail : null;
  if (trail) {
    const rings: Ring[] = [];
    for (const segment of trail.segments) {
      let start = 0;
      for (let index = 1; index <= segment.length; index += 1) {
        const [x, y] = segment[index] ?? [Infinity, Infinity];
        const [previousX, previousY] = segment[index - 1]!;
        // A long gap contains no evidence of the path between observations;
        // an observation with no neighbour within a metre is drawn as a dot.
        if (Math.hypot(x - previousX, y - previousY) <= 1) continue;
        const run = segment.slice(start, index);
        rings.push(fromMeters(run));
        for (const chevron of chevrons(run)) rings.push(fromMeters(chevron));
        start = index;
      }
    }
    for (const [colour, width] of [[palette.onAccent, 4], [palette.accent, 2]] as const) {
      shapes.push({ kind: "stroke", rings, closed: false, colour, alpha: 1, width, dashed: false, height: 0 });
    }
  }
  return shapes;
};
