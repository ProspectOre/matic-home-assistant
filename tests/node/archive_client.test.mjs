import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  stdin: { contents: 'export * from "./archive-contracts"; export * from "./archive-client"; export * from "./archive-actions";',
    resolveDir: fileURLToPath(new URL("../../frontend/map-studio-v4", import.meta.url)), loader: "ts" },
  bundle: true, write: false, platform: "node", format: "esm", target: "es2022",
});
const { ArchiveClient, parseArchiveCatalog, parseArchiveEnvelope, archiveMutationBody, prepareArchiveConfirmation,
  confirmArchiveAction, archiveErrorMessage, ARCHIVE_MAX_FILE_BYTES } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
const id = (index) => index.toString(16).padStart(32, "0");
const contentId = "a".repeat(24);
const wireRow = (index, retention = "automatic") => ({
  id: id(index), content_id: contentId, created_at: "2026-10-31T10:00:00Z", revision: 1, point_count: 100,
  scene_url: retention === "trash" ? null : `/api/matic_robot/slam_history/entry/${id(index)}`,
  name: `Map ${index}`, retention, deleted_until: retention === "trash" ? "2026-11-01T10:00:00Z" : null,
  imported: false, comparison_group: "b".repeat(64), frame: null, compressed_bytes: 50,
});
const wireCatalog = () => ({ generation: 7, capture_paused: false, capacity_blocked: false,
  records: [wireRow(1), wireRow(2, "kept"), wireRow(3, "trash")],
  usage: { record_count: 3, automatic_count: 1, kept_count: 1, trash_count: 1, compressed_bytes: 150,
    active_compressed_bytes: 100, trash_compressed_bytes: 50, reserved_bytes: 0, reserved_count: 0 } });
const envelope = () => ({ format: "matic-map-archive", version: 1, records: [{ source_id: id(1), created_at: "2026-10-31T10:00:00Z", name: null, sha256: "a".repeat(64), scene_zlib_base64: "eA==", frame: null }] });

test("catalog parsing separates record identity, content, retention and entry-wide usage", () => {
  const catalog = parseArchiveCatalog(wireCatalog());
  assert.equal(catalog.generation, 7);
  assert.equal(catalog.capacityBlocked, false);
  assert.equal(catalog.records[0].id, id(1));
  assert.equal(catalog.records[0].contentId, contentId);
  assert.equal(catalog.records[2].sceneUrl, null);
  assert.equal(catalog.usage.trashCompressedBytes, 50);
  for (const mutate of [
    (v) => { v.records.push(v.records[0]); },
    (v) => { v.records[0].scene_url = "https://other.invalid/map"; },
    (v) => { v.records[0].id = "saved-1"; },
    (v) => { v.records[0].content_id = "a".repeat(23); },
    (v) => { v.records[0].comparison_group = "b".repeat(24); },
    (v) => { v.capacity_blocked = "yes"; },
    (v) => { v.usage.record_count = 13; },
    (v) => { v.records[2].scene_url = "/api/matic_robot/map"; },
  ]) { const value = wireCatalog(); mutate(value); assert.throws(() => parseArchiveCatalog(value)); }
  const blocked = wireCatalog(); blocked.capacity_blocked = true;
  assert.equal(parseArchiveCatalog(blocked).capacityBlocked, true);
  const missing = wireCatalog(); delete missing.capacity_blocked;
  assert.throws(() => parseArchiveCatalog(missing));
});

test("delete confirmation pins generation and exact selection, and requires explicit kept inclusion", () => {
  const catalog = parseArchiveCatalog(wireCatalog());
  const confirmation = prepareArchiveConfirmation(catalog, "delete", [id(1), id(2)], "delete-1");
  assert.throws(() => confirmArchiveAction(confirmation, catalog, false), /kept-confirmation/);
  assert.deepEqual(confirmArchiveAction(confirmation, catalog, true), {
    action: "delete", recordIds: [id(1), id(2)], expectedGeneration: 7, requestId: "delete-1", allowKept: true,
  });
  assert.throws(() => confirmArchiveAction(confirmation, { ...catalog, generation: 8 }, true), /selection-changed/);
  assert.throws(() => confirmArchiveAction(confirmation, { ...catalog, records: [catalog.records[0]] }, true), /selection-changed/);
  assert.throws(() => prepareArchiveConfirmation(catalog, "permanent_delete", [id(1)], "delete-2"));
  const permanent = prepareArchiveConfirmation(catalog, "permanent_delete", [id(3)], "delete-3");
  assert.deepEqual(confirmArchiveAction(permanent, catalog, false).recordIds, [id(3)]);
  assert.equal(catalog.records.length, 3, "preparing or canceling confirmation does not mutate resources");
});

test("mutation request bounds reject malformed or expanding policy targets before network", () => {
  const valid = { action: "rename", recordIds: [id(1)], expectedGeneration: 7, requestId: "rename-1", name: "Kitchen" };
  assert.equal(archiveMutationBody(valid).name, "Kitchen");
  for (const changes of [{ recordIds: [id(1), id(1)] }, { name: "x".repeat(129) }, { expectedGeneration: -1 }, { action: "pause_capture" }, { requestId: "" }]) {
    assert.throws(() => archiveMutationBody({ ...valid, ...changes }));
  }
});

test("client preserves exact generation, IDs and request identity; mismatched acknowledgements fail", async () => {
  const calls = [];
  const client = new ArchiveClient({ archiveRequest: async (...args) => {
    calls.push(args);
    return args[2] === undefined ? wireCatalog() : { generation: 8, request_id: args[2].request_id };
  } });
  assert.equal((await client.catalog("entry")).generation, 7);
  const request = { action: "delete", recordIds: [id(1)], expectedGeneration: 7, requestId: "delete-1", allowKept: false };
  assert.equal((await client.mutate("entry", request)).generation, 8);
  assert.deepEqual(calls[1][2], { action: "delete", record_ids: [id(1)], expected_generation: 7, request_id: "delete-1", allow_kept: false });
  const wrong = new ArchiveClient({ archiveRequest: async () => ({ generation: 9, request_id: "another-operation" }) });
  await assert.rejects(wrong.mutate("entry", request), /invalid-map-archive/);
});

test("backend-shaped 24-character content IDs make archive storage management available", async () => {
  const client = new ArchiveClient({ archiveRequest: async () => wireCatalog() });
  const catalog = await client.catalog("entry");
  assert.equal(catalog.records.length, 3);
  assert.equal(catalog.records[0].contentId, contentId);
  assert.equal(catalog.records[0].comparisonGroup, "b".repeat(64));
});

test("import rejects oversized, canceled and invalid archives before posting; valid import retains no caller IDs as local IDs", async () => {
  const calls = [];
  const client = new ArchiveClient({ archiveRequest: async (...args) => {
    calls.push(args); return { generation: 8, request_id: args[2].request_id, record_ids: [id(9)] };
  } });
  await assert.rejects(client.importArchive("entry", { size: ARCHIVE_MAX_FILE_BYTES + 1, text: async () => { throw new Error("must not read"); } }, 7, "import-1"), /too-large/);
  await assert.rejects(client.importArchive("entry", "not json", 7, "import-1"), /invalid-map-archive/);
  await assert.rejects(client.importArchive("entry", JSON.stringify(envelope()), 7, "import-1", AbortSignal.abort()), /Aborted/);
  assert.equal(calls.length, 0);
  const result = await client.importArchive("entry", JSON.stringify(envelope()), 7, "import-1");
  assert.deepEqual(result.recordIds, [id(9)]);
  assert.equal(calls[0][2].archive.records[0].source_id, id(1));
  assert.equal(calls[0][2].expected_generation, 7);
  assert.throws(() => parseArchiveEnvelope({ ...envelope(), version: 2 }));
  assert.throws(() => parseArchiveEnvelope({ ...envelope(), records: Array(13).fill(envelope().records[0]) }));
});

test("export is read-only and scoped; user errors never echo server text", async () => {
  const calls = [];
  const client = new ArchiveClient({ archiveRequest: async (...args) => { calls.push(args); return envelope(); } });
  assert.equal((await client.exportArchive("entry", [id(1)], 7)).format, "matic-map-archive");
  assert.deepEqual(calls[0].slice(0, 3), ["entry", "export", { record_ids: [id(1)], expected_generation: 7 }]);
  await assert.rejects(client.exportArchive("entry", [], 7));
  assert.match(archiveErrorMessage({ status: 409 }), /Saved maps changed/);
  assert.match(archiveErrorMessage({ status: 403 }), /Administrator/);
  assert.match(archiveErrorMessage({ status: 400, code: "history-quota-exceeded" }), /storage is full/);
  assert.match(archiveErrorMessage({ status: 400, code: "history-trash-expired" }), /restore period has ended/);
  assert.doesNotMatch(archiveErrorMessage(new Error("private geometry")), /private geometry/);
});


test("archive errors use Home Assistant translations without exposing server details", () => {
  const keys = [];
  const localize = (key) => { keys.push(key); return `translated:${key}`; };
  assert.equal(archiveErrorMessage({ status: 403, code: "private details" }, localize),
    "translated:component.matic_robot.common.v4_archive_access_required");
  assert.equal(archiveErrorMessage(new Error("private geometry"), localize),
    "translated:component.matic_robot.common.v4_archive_unconfirmed_error");
  assert.equal(keys.length, 2);
  assert.match(archiveErrorMessage({ status: 409 }, (key) => key), /Saved maps changed/);
});
