import { describe, expect, it } from "vitest";
import {
  medianOf, mergeByGap, repairMissedMerge, runsFromOccupancy, type Run,
} from "./element-runs.js";

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

describe("repairMissedMerge", () => {
  // 实测订单状态卡片：末段是两项粘连，间距序列 219 / 220 / 324.5 里那个
  // 324.5 就是漏合并的信号。边界不从间距反推，而是回到原始游程里最大的间隙。
  const original = fromSpans([
    [57, 10], [68, 94],                                  // 第 1 项
    [277, 103],                                          // 第 2 项
    [496, 10], [507, 94],                                // 第 3 项
    [688, 34], [724, 86],                                // 第 4 项
    [877, 18], [917, 34], [953, 70], [1026, 32],         // 第 5 项
  ]);

  it("splits an over merged run at the widest internal gap", () => {
    const merged = fromSpans([[57, 105], [277, 103], [496, 105], [688, 370]]);
    const repaired = repairMissedMerge(merged, original);
    expect(repaired).not.toBeNull();
    expect(repaired!).toHaveLength(5);
    // 第 4 项止于 810（724+86），第 5 项起于 877——正是那道最宽的间隙
    expect(repaired![3]).toEqual({ start: 57 + 631, end: 810 });
    expect(repaired![4]).toEqual({ start: 877, end: 1058 });
  });

  it("returns null when every pitch is already even", () => {
    const merged = fromSpans([[0, 100], [220, 100], [440, 100]]);
    expect(repairMissedMerge(merged, merged)).toBeNull();
  });

  it("returns null when more than one run is oversized", () => {
    const merged = fromSpans([[0, 300], [400, 60], [800, 300]]);
    expect(repairMissedMerge(merged, merged)).toBeNull();
  });

  it("returns null with fewer than three runs", () => {
    const merged = fromSpans([[0, 100], [220, 300]]);
    expect(repairMissedMerge(merged, merged)).toBeNull();
  });

  it("returns null when the oversized run has no internal gap to use", () => {
    const merged = fromSpans([[0, 100], [220, 100], [440, 400]]);
    expect(repairMissedMerge(merged, fromSpans([[0, 100], [220, 100], [440, 400]]))).toBeNull();
  });
});
