/** Coordinates cancellation and ownership for named workspace reads and writes. */
export class ResourceRequests {
  readonly #active = new Map<string, AbortController>();

  begin(name: string): AbortController {
    this.#active.get(name)?.abort();
    const controller = new AbortController();
    this.#active.set(name, controller);
    return controller;
  }

  current(name: string): AbortController | undefined {
    return this.#active.get(name);
  }

  has(name: string): boolean {
    return this.#active.has(name);
  }

  release(name: string, controller: AbortController): void {
    if (this.#active.get(name) === controller) this.#active.delete(name);
  }

  cancel(name: string): void {
    const controller = this.#active.get(name);
    if (!controller) return;
    this.#active.delete(name);
    controller.abort();
  }

  abort(except: readonly string[]): boolean {
    let mutationCancelled = false;
    for (const [name, controller] of this.#active) {
      if (except.includes(name)) continue;
      mutationCancelled ||= name === "plan-mutation"
        || name === "area-mutation"
        || name === "setting-mutation"
        || name === "plan-preflight";
      controller.abort();
      this.#active.delete(name);
    }
    return mutationCancelled;
  }
}
