import type { WorkspaceState } from "./contracts";

/**
 * Rooms in a running clean can be skipped, moved or redone while the robot
 * cleans one (queue-changes.md). A clean started here keeps `command` at
 * "starting" until its service call returns at the end of the run, so that
 * counts too once the robot reports cleaning.
 */
export const canChangeQueue = (state: WorkspaceState): boolean =>
  state.pageActive && state.host.connected && state.host.administrator && state.host.robotConnected
  && state.dataMode === "live" && state.activity === "cleaning" && state.smartStop === null
  && (state.command === "idle" || state.command === "failed" || state.command === "starting")
  && !state.queuePending && state.queueUncertainToken === null;
