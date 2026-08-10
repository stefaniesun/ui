import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initPage } from "./init.js";
let root = ""; afterEach(() => root && rmSync(root, { recursive: true, force: true }));
describe("initPage", () => {
  it("creates a page reference and manifest", () => { root = mkdtempSync(join(tmpdir(), "uir-cli-")); const image = join(root, "shot.png"); writeFileSync(image, "png-bytes"); const { pageDir } = initPage({ pageId: "member", imagePath: image, scale: 3, pagesRoot: join(root, "pages") }); expect(existsSync(join(pageDir, "reference", "default.png"))).toBe(true); expect(existsSync(join(pageDir, "manifest.yaml"))).toBe(true); });
  it("rejects path traversal page ids", () => { root = mkdtempSync(join(tmpdir(), "uir-cli-")); const image = join(root, "shot.png"); writeFileSync(image, "x"); expect(() => initPage({ pageId: "../outside", imagePath: image, scale: 2, pagesRoot: root })).toThrow("invalid"); });
});
