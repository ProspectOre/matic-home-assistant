// Home Assistant's websocket as the workspace transport uses it: a ready
// snapshot, and the robot's pose pushed to each subscription that asks for it.
// Harnesses bundle this module into the page.
export function workspacePoseConnection() {
  const subscribers = new Set();
  return {
    subscribed: () => subscribers.size > 0,
    push(pose) {
      const wire = {
        heading: null, source: pose.position ? "exact_pose" : "current_area", scene_revision: null,
        scene_epoch: null, map_floor_coherent: true, map_session_key: null, pose_age_seconds: 0, ...pose,
      };
      for (const callback of subscribers) callback({ type: "pose", pose: wire });
    },
    subscribeMessage: async (callback, message) => {
      if (!message.poses) return () => {};
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },
    sendMessagePromise: async (message) => ({
      schema: 1, capabilities: { snapshot: 1 }, epoch: "epoch", sequence: 0, coherence_generation: 1,
      revisions: {}, entry_id: message.entry_id,
      identity: { entry_id: message.entry_id, floor_mission_id: 1, floor_verified: true },
      status: { state: "ready", reason: null, retryable: false },
      payload: { available: true, entry: null },
    }),
  };
}
