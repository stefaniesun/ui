import { describe, expect, it } from "vitest";
import { medianOf, mergeByGap, runsFromOccupancy, type Run } from "./element-runs.js";

/** 用 [起点, 长度] 描述游程，和实测数据的记法一致 */
function fromSpans(spans: [number, number][]): Run[] {
  return spans.map(([start, length]) => ({ start, end: start + length }));
}

describe("runsFromOccupancy", () => {
  it("returns half open spans of true", () => {
    expect(runsFromOccupancy([false, true, true, false, true])).toEqual([
      { start: 1, end: 3 }, { start: 4, end: 5 },
    ]);
  });

  it("closes a run that reaches the end", () => {
    expect(runsFromOccupancy([false, true, true])).toEqual([{ start: 1, end: 3 }]);
  });

  it("drops runs shorter than the minimum length", () => {
    expect(runsFromOccupancy([true, false, true, true, true, true], 4))
      .toEqual([{ start: 2, end: 6 }]);
  });

  it("returns nothing for an empty input", () => {
    expect(runsFromOccupancy([])).toEqual([]);
  });

  it("returns nothing when nothing is occupied", () => {
    expect(runsFromOccupancy([false, false])).toEqual([]);
  });
});

describe("mergeByGap", () => {
  // 实测常用服务卡片的列游程：间隙呈双峰（单元内 2–3，单元间 77–115），
  // 阈值取本层最大间隙的一半就能自适应地还原出 5 个格子。
  it("recovers five grid cells from the measured column runs", () => {
    const runs = fromSpans([
      [38, 122], [162, 18], [257, 34], [294, 69], [365, 33],
      [496, 103], [714, 103], [915, 33], [950, 70], [1022, 34],
    ]);
    const merged = mergeByGap(runs);
    expect(merged).toHaveLength(5);
    expect(merged.map(run => run.end - run.start)).toEqual([142, 141, 103, 103, 141]);
  });

  it("leaves a single run untouched", () => {
    expect(mergeByGap([{ start: 3, end: 9 }])).toEqual([{ start: 3, end: 9 }]);
  });

  it("returns an empty list unchanged", () => {
    expect(mergeByGap([])).toEqual([]);
  });

  // 间隙全相等时不合并是对的：实测分类胶囊行间隙恒为 24，
  // 那是 5 个并列单元，并成一块就错了。双峰判据只在真有两个峰时才动手。
  it("keeps evenly spaced cells separate", () => {
    const merged = mergeByGap(fromSpans([
      [36, 216], [276, 216], [516, 252], [792, 180], [996, 138],
    ]));
    expect(merged).toHaveLength(5);
    expect(merged.map(run => run.end - run.start)).toEqual([216, 216, 252, 180, 138]);
  });

  it("does not mutate its input", () => {
    const runs = fromSpans([[0, 10], [11, 10], [100, 10]]);
    mergeByGap(runs);
    expect(runs).toEqual(fromSpans([[0, 10], [11, 10], [100, 10]]));
  });
});

describe("medianOf", () => {
  it("returns the middle value of an odd list", () => {
    expect(medianOf([9, 1, 5])).toBe(5);
  });

  it("averages the two middle values of an even list", () => {
    expect(medianOf([1, 3, 5, 9])).toBe(4);
  });

  it("returns zero for an empty list", () => {
    expect(medianOf([])).toBe(0);
  });

  it("does not mutate its input", () => {
    const values = [9, 1, 5];
    medianOf(values);
    expect(values).toEqual([9, 1, 5]);
  });
});
