import { afterEach, describe, expect, it, vi } from "vitest";
import { createSnapshotRuntime } from "../src/web/snapshotRuntime.ts";

/** Stands in for the browser Worker, so a test can drive both event streams by hand. */
class FakeWorker {
  static latest: FakeWorker | null = null;
  readonly posted: { id: number; kind: string }[] = [];
  readonly #listeners = new Map<string, ((event: unknown) => void)[]>();

  constructor(_url: URL, _options?: unknown) {
    FakeWorker.latest = this;
  }

  addEventListener(type: string, handler: (event: unknown) => void): void {
    const held = this.#listeners.get(type) ?? [];
    held.push(handler);
    this.#listeners.set(type, held);
  }

  postMessage(message: { id: number; kind: string }): void {
    this.posted.push(message);
  }

  emit(type: string, event: unknown): void {
    for (const handler of this.#listeners.get(type) ?? []) handler(event);
  }
}

function settled(promise: Promise<unknown>, withinMs: number): Promise<string> {
  return Promise.race([
    promise.then(() => "resolved", (cause: unknown) => `rejected: ${(cause as Error).message}`),
    new Promise<string>((resolve) => setTimeout(() => resolve("still pending"), withinMs)),
  ]);
}

describe("the snapshot runtime", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeWorker.latest = null;
  });

  function openRuntime(): { runtime: ReturnType<typeof createSnapshotRuntime>; worker: FakeWorker } {
    vi.stubGlobal("Worker", FakeWorker);
    const runtime = createSnapshotRuntime();
    return { runtime, worker: FakeWorker.latest! };
  }

  it("answers a request from the worker's response", async () => {
    const { runtime, worker } = openRuntime();
    const spine = runtime.fetchSpine();
    expect(worker.posted).toHaveLength(1);
    worker.emit("message", { data: { id: worker.posted[0]!.id, ok: true, value: null } });
    await expect(spine).resolves.toBeNull();
  });

  it("turns a worker error message into a rejection", async () => {
    const { runtime, worker } = openRuntime();
    const source = runtime.fetchSource("a.ts");
    worker.emit("message", { data: { id: worker.posted[0]!.id, ok: false, error: "no such file" } });
    await expect(source).rejects.toThrow("no such file");
  });

  it("rejects the requests that were pending when the worker died", async () => {
    const { runtime, worker } = openRuntime();
    const spine = runtime.fetchSpine();
    worker.emit("error", { message: "worker chunk failed to load" });
    await expect(spine).rejects.toThrow("worker chunk failed to load");
  });

  it("rejects a request issued after the worker died instead of hanging", async () => {
    const { runtime, worker } = openRuntime();
    worker.emit("error", { message: "worker chunk failed to load" });
    const outcome = await settled(runtime.fetchSpine(), 200);
    expect(outcome).toBe("rejected: worker chunk failed to load");
  });

  it("aborts a view request through its signal", async () => {
    const { runtime } = openRuntime();
    const abort = new AbortController();
    const view = runtime.fetchView({} as never, abort.signal);
    abort.abort();
    await expect(view).rejects.toThrow(/aborted/);
  });
});
