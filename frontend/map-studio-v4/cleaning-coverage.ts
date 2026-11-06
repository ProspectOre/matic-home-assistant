import { ContractError } from "./backend-contracts";
import type { CleaningCoverageLayer } from "./contracts";

/** Validate the bounded native page runs before drawing them. */
export function parseCleaningCoverage(value: unknown): CleaningCoverageLayer {
  if (!value || typeof value !== "object") throw new ContractError("invalid-cleaning-coverage");
  const root = value as Record<string, unknown>;
  if (typeof root.active !== "boolean" || typeof root.truncated !== "boolean"
    || typeof root.cell_size !== "number" || !Number.isFinite(root.cell_size)
    || root.cell_size <= 0 || root.cell_size > 1 || !Array.isArray(root.runs)
    || root.runs.length > 20_000
    || (root.ownership_unverified !== undefined && typeof root.ownership_unverified !== "boolean")
    || (root.ownership_unverified === true && root.runs.length !== 0)
    || (root.coverage_basis !== undefined && root.coverage_basis !== "observed_changes")
    || (root.ownership_unverified === true && root.coverage_basis !== undefined)
    || (root.active === false && root.runs.length !== 0)
    || (root.coverage_basis === "observed_changes" && (root.active !== true || root.truncated !== true))) {
    throw new ContractError("invalid-cleaning-coverage");
  }
  const mapSessionKey = root.map_session_key;
  if (root.active && (typeof mapSessionKey !== "string" || !/^[a-f0-9]{64}$/u.test(mapSessionKey))) {
    throw new ContractError("invalid-cleaning-coverage");
  }
  const runs = root.runs.map((run): readonly [number, number, number, number] => {
    if (!Array.isArray(run) || run.length !== 4
      || !run.every((part) => typeof part === "number" && Number.isSafeInteger(part))
      || Math.abs(run[0]) > 131_104 || Math.abs(run[1]) > 131_104
      || run[2] < 1 || run[2] > 32 || run[3] < 1 || run[3] > 3) {
      throw new ContractError("invalid-cleaning-coverage");
    }
    return [run[0], run[1], run[2], run[3]];
  });
  return { active: root.active, mapSessionKey: root.active ? mapSessionKey as string : null,
    frameKey: "", cellSize: root.cell_size, runs, truncated: root.truncated,
    ownershipUnverified: root.ownership_unverified === true,
    coverageBasis: root.coverage_basis === "observed_changes" ? "observed_changes" : null };
}
