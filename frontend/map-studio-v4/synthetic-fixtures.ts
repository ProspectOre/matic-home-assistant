import type {
  AreasCatalog,
  HistoryCatalog,
  MapEntry,
  PlansCatalog,
  PoseModel,
  SceneModel,
} from "./backend-contracts";

const SYNTHETIC_MAP_SESSION_KEY = "a".repeat(64);

const rooms = [
  { roomId: "room-a", name: "Kitchen", boundary: [[0.5, 0.5], [4, 0.5], [4, 3], [0.5, 3]] as const },
  { roomId: "room-b", name: "Living room", boundary: [[4.2, 0.5], [8.5, 0.5], [8.5, 3.4], [4.2, 3.4]] as const },
  { roomId: "room-c", name: "Office", boundary: [[0.5, 3.2], [3.8, 3.2], [3.8, 6.5], [0.5, 6.5]] as const },
  { roomId: "room-d", name: "Bedroom", boundary: [[4, 3.6], [8.5, 3.6], [8.5, 6.5], [4, 6.5]] as const },
] as const;

export const syntheticScene = (): SceneModel => {
  const span = [180, 140] as const;
  const metadata = {
    meters_per_cell: 0.05,
    origin_cells: [0, 0],
    span_cells: span,
    sample_step: 1,
    rooms: rooms.map((room) => {
      const boundary = room.boundary.map(([x, y]) => [x / 0.05, y / 0.05] as const);
      const center = [
        boundary.reduce((sum, [x]) => sum + x, 0) / boundary.length,
        boundary.reduce((sum, [, y]) => sum + y, 0) / boundary.length,
      ] as const;
      return { name: room.name, boundary, boundary_closed: true, center };
    }),
  };
  const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata));
  const points: number[][] = [];
  for (let y = 10; y < 130; y += 2) {
    for (let x = 10; x < 170; x += 2) {
      const roomBand = x < 80 ? (y < 65 ? 0 : 2) : (y < 72 ? 1 : 3);
      const colors = [[185, 219, 224], [201, 211, 233], [210, 226, 194], [232, 207, 207]][roomBand] || [190, 205, 215];
      points.push([x, y, 0, ...colors]);
    }
  }
  const surfaceCount = 500;
  for (let index = 0; index < surfaceCount; index += 1) {
    const edge = index % 4;
    const position = (index * 7) % 120;
    const x = edge < 2 ? (edge === 0 ? 10 : 168) : 10 + position;
    const y = edge >= 2 ? (edge === 2 ? 10 : 128) : 10 + position;
    points.push([x, y, 10 + index % 18, 104, 122, 137]);
  }
  const floorCount = points.length - surfaceCount;
  const buffer = new ArrayBuffer(24 + metadataBytes.byteLength + points.length * 8);
  const header = new DataView(buffer);
  new Uint8Array(buffer, 0, 8).set(new TextEncoder().encode("MATIC3D\u0000"));
  header.setUint16(8, 1, true);
  header.setUint16(10, 8, true);
  header.setUint32(12, metadataBytes.byteLength, true);
  header.setUint32(16, floorCount, true);
  header.setUint32(20, surfaceCount, true);
  new Uint8Array(buffer, 24, metadataBytes.byteLength).set(metadataBytes);
  const view = new DataView(buffer, 24 + metadataBytes.byteLength);
  points.forEach(([x = 0, y = 0, z = 0, red = 0, green = 0, blue = 0], index) => {
    const offset = index * 8;
    view.setUint16(offset, x, true);
    view.setUint16(offset + 2, y, true);
    view.setUint8(offset + 4, z);
    view.setUint8(offset + 5, red);
    view.setUint8(offset + 6, green);
    view.setUint8(offset + 7, blue);
  });
  return {
    buffer,
    pointOffset: 24 + metadataBytes.byteLength,
    floorCount,
    surfaceCount,
    total: points.length,
    revision: 7,
    etag: '"synthetic-scene"',
    source: "live",
    metadata: {
      metersPerCell: 0.05,
      origin: [0, 0],
      span,
      sampleStep: 1,
      rooms: metadata.rooms.map((room, index) => ({
        id: rooms[index]?.roomId || `room-${index}`,
        name: room.name,
        boundary: room.boundary,
        center: room.center,
      })),
    },
  };
};

export const syntheticEntry = (): MapEntry => ({
  entryId: "synthetic-entry",
  sceneUrl: "/api/matic_robot/slam_scene/synthetic",
  deltaUrl: "/api/matic_robot/slam_delta/synthetic",
  poseUrl: "/api/matic_robot/slam_pose/synthetic",
  historyUrl: "/api/matic_robot/slam_history/synthetic",
  areasUrl: "/api/matic_robot/areas/synthetic",
  plansUrl: "/api/matic_robot/plans/synthetic",
  mapRevision: 7,
  mapFloorCoherent: true,
  mapSessionVerified: true,
  mapSessionKey: SYNTHETIC_MAP_SESSION_KEY,
  mapBlockReason: null,
  runnerLocked: false,
  stopSettlePending: false,
  activePlan: false,
  nativeReconciliationPending: false,
  nativeSessionActive: false,
  mapComplete: true,
  mapTruncated: false,
  selectedFloorOrdinal: 1,
  mapFloorOrdinal: 1,
  historyCount: 2,
  historyFloorCount: 2,
  health: "ready",
  streamFailures: 0,
  bootstrapState: "complete",
  bootstrapPhotoSeen: true,
  bootstrapStructureSeen: true,
  bootstrapFailures: 0,
});

export const syntheticPlans = (): PlansCatalog => ({
  rooms: rooms.map(({ roomId, name }) => ({ roomId, name })),
  selectedPlan: "daily",
  plans: [{
    id: "daily",
    name: "Daily clean",
    enabled: true,
    runBehavior: "intelligent",
    rooms: rooms.slice(0, 3).map(({ roomId }) => ({
      roomId,
      cleaningMode: "vacuum",
      coverageSetting: "standard",
    })),
    roomOrder: rooms.slice(0, 3).map(({ roomId }) => roomId),
    returnToBase: true,
    finishCurrentRoom: false,
    finishCurrentRoomThreshold: 50,
  }],
});

export const syntheticAreas = (): AreasCatalog => ({
  sceneUrl: syntheticEntry().sceneUrl,
  rooms: rooms.map((room) => ({ ...room, boundary: room.boundary.map((point) => [...point] as const) })),
  areas: [{
    id: "entryway",
    name: "Entryway",
    circles: [{ x: 1.5, y: 1.4, radius: 0.3 }, { x: 1.9, y: 1.6, radius: 0.3 }],
    cleaningMode: "vacuum",
    coverageSetting: "standard",
    status: "current",
    canRebind: false,
  }],
});

export const syntheticHistory = (): HistoryCatalog => ({
  entryId: "synthetic-entry",
  liveAvailable: true,
  floors: [
    {
      id: "current",
      active: true,
      readOnly: false,
      liveAvailable: true,
      label: "House",
      ordinal: null,
      snapshots: [
        { id: "current-old", createdAt: "2026-08-29T14:00:00Z", revision: 6, pointCount: 5_300, sceneUrl: "/synthetic-history-current-old" },
        { id: "current-new", createdAt: "2026-08-29T16:12:00Z", revision: 7, pointCount: 5_300, sceneUrl: "/synthetic-history-current-new" },
      ],
    },
    {
      id: "saved-1",
      active: false,
      readOnly: true,
      liveAvailable: false,
      label: "Shed",
      ordinal: 2,
      snapshots: [
        { id: "saved-one", createdAt: "2026-08-28T11:30:00Z", revision: 3, pointCount: 3_100, sceneUrl: "/synthetic-history-saved" },
      ],
    },
  ],
});

export const syntheticPose = (): PoseModel => ({
  // The pose API returns map meters, not scene-cell coordinates. This point is
  // the exact center of the synthetic scene after applying its origin.
  position: [4.475, 3.475],
  source: "latest_pose",
  revision: 7,
  poseRevision: 4,
  floorCoherent: true,
  mapSessionKey: SYNTHETIC_MAP_SESSION_KEY,
  freshness: "live",
});
