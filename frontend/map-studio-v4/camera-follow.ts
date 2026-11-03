import type { PoseModel } from "./backend-contracts";
import type { WorkspaceState } from "./contracts";
import { clamp } from "./shared-primitives";

interface CameraState {
  readonly yaw: number;
  readonly pitch: number;
  readonly distance: number;
  readonly targetX: number;
  readonly targetZ: number;
  readonly orthographic: boolean;
}

interface CameraFollowHost {
  readonly state: () => WorkspaceState | null;
  readonly camera: () => CameraState;
  readonly setCamera: (camera: CameraState) => void;
  readonly fitActive: () => boolean;
  readonly worldForMeters: (x: number, y: number) => readonly [number, number] | null;
  readonly radius: () => number;
  readonly setFitActive: (active: boolean) => void;
  readonly requestRender: () => void;
  readonly notifyCamera: () => void;
  readonly disposed: () => boolean;
}

const angle = (value: number): number => {
  let result = value;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
};

/** Camera following loads only after the user enables Follow or Ride. */
export class CameraFollowController {
  readonly #host: CameraFollowHost;
  #mode: "off" | "follow" | "ride" = "off";
  #beforeFollow: { readonly camera: CameraState; readonly fitActive: boolean } | null = null;
  #frame: number | null = null;
  #lastTime = 0;
  #target: CameraState | null = null;

  constructor(host: CameraFollowHost) {
    this.#host = host;
  }

  update(pose: PoseModel | null, mode: "off" | "follow" | "ride", reducedMotion: boolean): void {
    if (mode === "off") {
      if (this.#mode !== "off") this.cancel(true);
      return;
    }
    const state = this.#host.state();
    const entry = state?.resources.entry;
    const admitted = Boolean(state && state.dataMode === "live" && state.map.exactPose
      && state.map.floorCoherent && state.map.sessionVerified
      && state.resources.scene.value?.source === "live"
      && pose && pose.position && pose.freshness === "live" && pose.floorCoherent
      && pose.mapSessionKey !== null && pose.mapSessionKey === entry?.mapSessionKey
      && (mode !== "ride" || (typeof pose.heading === "number" && Number.isFinite(pose.heading))));
    if (!admitted || !pose?.position) {
      if (this.#mode !== "off") this.cancel(false);
      return;
    }
    if (!state || !state.pageActive) {
      this.cancel(false);
      return;
    }
    let camera = this.#host.camera();
    if (this.#mode === "off") {
      this.#beforeFollow = { camera, fitActive: this.#host.fitActive() };
    }
    else if (this.#mode === "ride" && mode === "follow" && this.#beforeFollow) {
      camera = this.#beforeFollow.camera;
      this.#host.setCamera(camera);
      this.#host.setFitActive(false);
    }
    this.#mode = mode;
    const world = this.#host.worldForMeters(pose.position[0], pose.position[1]);
    if (!world) {
      this.cancel(false);
      return;
    }
    const deadZone = Math.max(0.35, camera.distance * (mode === "ride" ? 0.025 : 0.1));
    const dx = world[0] - camera.targetX;
    const dz = world[1] - camera.targetZ;
    let yaw = camera.yaw;
    let pitch = camera.pitch;
    let distance = camera.distance;
    if (mode === "ride") {
      // Map heading 0 faces -world-X; positive heading rotates toward +world-Z.
      yaw = angle(pose.heading! + Math.PI / 2);
      pitch = 1.04;
      const radius = this.#host.radius();
      distance = clamp(Math.min(4.5, radius * 0.22), Math.max(1.2, radius * 0.04), radius * 8);
    }
    this.#target = {
      yaw,
      pitch,
      distance,
      targetX: Math.hypot(dx, dz) > deadZone ? world[0] : camera.targetX,
      targetZ: Math.hypot(dx, dz) > deadZone ? world[1] : camera.targetZ,
      orthographic: mode === "ride" ? false : camera.orthographic,
    };
    if (reducedMotion) {
      this.#host.setCamera(this.#target);
      this.#host.setFitActive(false);
      this.#host.requestRender();
      return;
    }
    this.#scheduleFrame();
  }

  /** Gesture cancellation keeps the camera where the user took control. */
  cancel(restore: boolean): void {
    if (this.#frame !== null) window.cancelAnimationFrame(this.#frame);
    this.#frame = null;
    this.#lastTime = 0;
    this.#target = null;
    this.#mode = "off";
    if (restore && this.#beforeFollow) {
      this.#host.setCamera(this.#beforeFollow.camera);
      this.#host.setFitActive(this.#beforeFollow.fitActive);
      this.#host.requestRender();
      this.#host.notifyCamera();
    }
    this.#beforeFollow = null;
  }

  dispose(): void {
    this.cancel(false);
  }

  #scheduleFrame(): void {
    if (this.#frame !== null || this.#host.disposed()) return;
    this.#frame = window.requestAnimationFrame((time) => {
      this.#frame = null;
      const target = this.#target;
      if (!target || this.#mode === "off" || !this.#host.state()?.pageActive) return;
      const current = this.#host.camera();
      const elapsed = this.#lastTime ? Math.min(64, Math.max(0, time - this.#lastTime)) : 16;
      this.#lastTime = time;
      const alpha = 1 - Math.exp(-elapsed / 150);
      const remaining = Math.max(Math.abs(target.targetX - current.targetX),
        Math.abs(target.targetZ - current.targetZ), Math.abs(angle(target.yaw - current.yaw)) * 2,
        Math.abs(target.pitch - current.pitch), Math.abs(target.distance - current.distance));
      this.#host.setCamera({
        ...target,
        yaw: angle(current.yaw + angle(target.yaw - current.yaw) * alpha),
        pitch: current.pitch + (target.pitch - current.pitch) * alpha,
        distance: current.distance + (target.distance - current.distance) * alpha,
        targetX: current.targetX + (target.targetX - current.targetX) * alpha,
        targetZ: current.targetZ + (target.targetZ - current.targetZ) * alpha,
      });
      this.#host.setFitActive(false);
      this.#host.requestRender();
      if (remaining > 0.01) this.#scheduleFrame();
    });
  }
}
