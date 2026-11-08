import type { WorkspaceState } from "./contracts";
import type { WorkspaceStore } from "./state";

/** Admit after two map frames, with an optional bounded fallback (zero disables it). */
export const scheduleAfterMapAdmission = (
  store: WorkspaceStore,
  active: (state: WorkspaceState) => boolean,
  callback: () => void,
  timeoutMs = 2_000,
): (() => void) => {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  let generation = -1;
  let unsubscribe = () => {};
  const clearFrames = () => { if (frame) cancelAnimationFrame(frame); frame = 0; generation = -1; };
  const cancel = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = undefined;
    clearFrames();
    unsubscribe();
  };
  const finish = () => { cancel(); callback(); };
  const update = (state: WorkspaceState) => {
    if (stopped) return;
    if (!active(state)) {
      if (timer) clearTimeout(timer);
      timer = undefined;
      clearFrames();
      return;
    }
    if (!timer && timeoutMs > 0) timer = setTimeout(() => {
      timer = undefined;
      const current = store.value;
      if (active(current)) finish();
      else update(current);
    }, timeoutMs);
    if (!state.map.available || generation === state.generation) {
      if (!state.map.available) clearFrames();
      return;
    }
    clearFrames();
    generation = state.generation;
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        frame = 0;
        const current = store.value;
        if (active(current) && current.generation === generation && current.map.available) finish();
        else update(current);
      });
    });
  };
  unsubscribe = store.subscribe(update);
  return cancel;
};
