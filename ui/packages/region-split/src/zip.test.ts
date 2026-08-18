import { describe, expect, it } from "vitest";
import { createZip } from "./zip.js";

function entryNames(zip: Buffer): string[] {
  const names: string[] = [];
  let offset = 0;
  while (offset + 4 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    const size = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    names.push(zip.subarray(offset + 30, offset + 30 + nameLength).toString("utf8"));
    offset += 30 + nameLength + extraLength + size;
  }
  return names;
}

describe("createZip", () => {
  it("preserves the page delivery directory structure", () => {
    const zip = createZip([
      { name: "index.html", content: "<html></html>" },
      { name: "style.css", content: "body{}" },
      { name: "assets/a.png", content: Uint8Array.from([1, 2, 3]) },
    ]);
    expect(entryNames(zip)).toEqual(["index.html", "style.css", "assets/a.png"]);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
  });

  it("rejects unsafe entry names", () => {
    expect(() => createZip([{ name: "../secret", content: "x" }])).toThrow("invalid zip entry name");
  });
});
