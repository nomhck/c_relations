import { describe, it, expect } from "vitest";
import {
  makeTask,
  makeDep,
  computeCpm,
  validateDoc,
  seedDemo,
} from "../../src/domain";
import { deriveInsights, weightedProgress } from "../../src/domain/insights";
import { normalizeTaskPatch } from "../../src/domain/taskEditing";
import { showcaseDoc } from "../../src/domain/showcase";
describe("Project overview decisions", () => {
  it("weights progress by duration and excludes milestone weight", () => {
    expect(
      weightedProgress([
        makeTask({ durationDays: 10, progress: 50 }),
        makeTask({ durationDays: 30, status: "DONE" }),
        makeTask({ isMilestone: true, progress: 0 }),
      ]),
    ).toBe(88);
    expect(weightedProgress([])).toBe(0);
  });
  it("distinguishes pending critical tasks, holds and genuinely ready work", () => {
    const a = makeTask({ status: "DONE" }),
      b = makeTask({ status: "ON_HOLD" }),
      c = makeTask();
    const tasks = [a, b, c],
      deps = [makeDep(a.id, b.id), makeDep(b.id, c.id)],
      cpm = computeCpm(tasks, deps, "2026-09-01");
    const result = deriveInsights(tasks, deps, cpm);
    expect(result.critical.map((t) => t.id)).toEqual([b.id, c.id]);
    expect(result.attention.map((t) => t.id)).toEqual([b.id]);
    expect(result.ready).toHaveLength(0);
  });
  it("a duration change moves the dependent completion date without mutating the source", () => {
    const a = makeTask({ durationDays: 3 }),
      b = makeTask({ durationDays: 2 }),
      deps = [makeDep(a.id, b.id)];
    const baseline = computeCpm([a, b], deps, "2026-09-01");
    const scenario = computeCpm(
      [{ ...a, durationDays: 8 }, b],
      deps,
      "2026-09-01",
    );
    expect(scenario.projectEnd - baseline.projectEnd).toBe(5);
    expect(a.durationDays).toBe(3);
  });
  it("the new example is valid, has milestones and real dependency-derived critical work", () => {
    const doc = showcaseDoc();
    expect(validateDoc(doc).ok).toBe(true);
    const cpm = computeCpm(
      doc.tasks,
      doc.dependencies,
      doc.project.dataDate,
      doc.calendars[0],
    );
    const result = deriveInsights(doc.tasks, doc.dependencies, cpm);
    expect(result.milestones).toHaveLength(5);
    expect(result.attention).toHaveLength(1);
    expect(result.critical.length).toBeGreaterThan(3);
    expect(cpm.projectEnd).toBeGreaterThan(60);
  });
  it("handles a 4,000-task overview without a quadratic dependency scan", () => {
    const doc = seedDemo();
    const cpm = computeCpm(doc.tasks, doc.dependencies, doc.project.dataDate);
    const start = performance.now();
    const result = deriveInsights(doc.tasks, doc.dependencies, cpm);
    expect(result.groups.reduce((n, g) => n + g.tasks.length, 0)).toBe(4000);
    expect(performance.now() - start).toBeLessThan(100);
  });
});
describe("Consistent task editing", () => {
  it("completing sets progress, reopening clears 100%, and milestone durations stay zero", () => {
    expect(normalizeTaskPatch(makeTask(), { status: "DONE" })).toMatchObject({
      status: "DONE",
      progress: 100,
    });
    expect(
      normalizeTaskPatch(makeTask({ status: "DONE", progress: 100 }), {
        status: "IN_PROGRESS",
      }),
    ).toMatchObject({ progress: 0 });
    expect(
      normalizeTaskPatch(makeTask({ isMilestone: true }), { durationDays: 5 }),
    ).toMatchObject({ durationDays: 0 });
  });
  it("clamps invalid values and translates progress into an appropriate status", () => {
    expect(normalizeTaskPatch(makeTask(), { progress: 55 })).toMatchObject({
      progress: 55,
      status: "IN_PROGRESS",
    });
    expect(
      normalizeTaskPatch(makeTask(), { durationDays: -4, progress: 120 }),
    ).toMatchObject({ durationDays: 0, progress: 100, status: "DONE" });
    expect(
      normalizeTaskPatch(makeTask({ status: "ON_HOLD" }), { progress: 30 }),
    ).not.toHaveProperty("status");
  });
});
