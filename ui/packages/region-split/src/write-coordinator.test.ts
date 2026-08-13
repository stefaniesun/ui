import { describe, expect, it } from "vitest";
import { ProjectWriteCoordinator } from "./write-coordinator.js";

describe("ProjectWriteCoordinator", () => {
  it("serializes writes for one project and clears the queue", async () => {
    const coordinator = new ProjectWriteCoordinator();
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const first = coordinator.run("a", async () => { events.push("first-start"); await gate; events.push("first-end"); });
    const second = coordinator.run("a", () => { events.push("second"); });
    await Promise.resolve();
    expect(events).toEqual(["first-start"]);
    release();
    await Promise.all([first, second]);
    expect(events).toEqual(["first-start", "first-end", "second"]);
    expect(coordinator.pendingProjectCount).toBe(0);
  });
});
