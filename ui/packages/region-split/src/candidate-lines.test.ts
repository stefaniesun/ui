import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { candidatesFromRows, detectCandidateLines, rowStats, type RowStat } from "./candidate-lines.js";

const uniform = (gray: number): RowStat => ({ mean: [gray, gray, gray], variance: 1 });
const busy = (gray: number): RowStat => ({ mean: [gray, gray, gray], variance: 60 });

describe("candidatesFromRows", () => {
  it("returns the middle of a blank band", () => {
    // 0-9 内容，10-19 背景留白，20-29 内容；背景中位数落在白色
    const rows = [
      ...Array.from({ length: 10 }, () => busy(255)),
      ...Array.from({ length: 10 }, () => uniform(255)),
      ...Array.from({ length: 10 }, () => busy(255)),
    ];
    const found = candidatesFromRows(rows);
    expect(found.some(line => Math.abs(line.y - 14) <= 1)).toBe(true);
  });

  it("gives taller blank bands a higher strength", () => {
    const short = candidatesFromRows([
      ...Array.from({ length: 10 }, () => busy(255)),
      ...Array.from({ length: 6 }, () => uniform(255)),
      ...Array.from({ length: 10 }, () => busy(255)),
    ]);
    const tall = candidatesFromRows([
      ...Array.from({ length: 10 }, () => busy(255)),
      ...Array.from({ length: 24 }, () => uniform(255)),
      ...Array.from({ length: 10 }, () => busy(255)),
    ]);
    expect(tall[0]!.strength).toBeGreaterThan(short[0]!.strength);
  });

  it("detects an abrupt background change", () => {
    const rows = [
      ...Array.from({ length: 20 }, () => busy(255)),
      ...Array.from({ length: 20 }, () => busy(120)),
    ];
    const found = candidatesFromRows(rows);
    expect(found.some(line => Math.abs(line.y - 20) <= 1)).toBe(true);
  });

  it("keeps only the stronger of two candidates closer than 4px", () => {
    const rows = [
      ...Array.from({ length: 20 }, () => busy(255)),
      busy(120), busy(255),
      ...Array.from({ length: 20 }, () => busy(255)),
    ];
    const found = candidatesFromRows(rows);
    const near = found.filter(line => line.y >= 18 && line.y <= 24);
    expect(near).toHaveLength(1);
  });

  it("finds nothing in a completely flat image", () => {
    expect(candidatesFromRows(Array.from({ length: 40 }, () => uniform(255)))).toHaveLength(0);
  });
});

describe("rowStats and detectCandidateLines", () => {
  it("reads per-row statistics from a real image", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rs-cl-"));
    const path = join(dir, "two-tone.png");
    await sharp({ create: { width: 40, height: 60, channels: 3, background: "#ffffff" } })
      .composite([{
        input: { create: { width: 40, height: 30, channels: 3, background: "#303030" } },
        top: 30, left: 0,
      }])
      .png().toFile(path);

    const rows = await rowStats(path);
    expect(rows).toHaveLength(60);
    expect(rows[0]!.mean[0]).toBeCloseTo(255, 0);
    expect(rows[59]!.mean[0]).toBeCloseTo(48, 0);

    const lines = await detectCandidateLines(path);
    expect(lines.some(line => Math.abs(line.y - 30) <= 1)).toBe(true);
  });
});
