import { describe, expect, it } from "vitest";
import { pagePreviewDocument } from "./page-preview.js";

const base = {
  css: ".region { background: #fff; }",
  assets: [{ path: "assets/abc.png", contentBase64: "AAAA" }],
};

describe("pagePreviewDocument", () => {
  it("swaps a relative asset reference for a data url", () => {
    const doc = pagePreviewDocument({ ...base, html: '<img src="assets/abc.png">' });
    expect(doc).toContain('src="data:image/png;base64,AAAA"');
    expect(doc).not.toContain('src="assets/abc.png"');
  });
  it("swaps every occurrence of the same asset", () => {
    const doc = pagePreviewDocument({ ...base, html: '<img src="assets/abc.png"><img src="assets/abc.png">' });
    expect(doc.match(/data:image\/png;base64,AAAA/g)).toHaveLength(2);
  });
  it("leaves an unknown reference alone rather than blanking it", () => {
    const doc = pagePreviewDocument({ ...base, html: '<img src="assets/missing.png">' });
    expect(doc).toContain('src="assets/missing.png"');
  });
  it("inlines the stylesheet and removes the external delivery link", () => {
    const doc = pagePreviewDocument({ ...base, html: '<link rel="stylesheet" href="style.css"><div></div>' });
    expect(doc).toContain(".region { background: #fff; }");
    expect(doc).not.toContain('href="style.css"');
  });
  it("zeroes the document margins", () => {
    const doc = pagePreviewDocument({ ...base, html: "<div></div>" });
    expect(doc).toContain("margin:0");
    expect(doc).toContain("padding:0");
  });
  it("does not replace matching text outside resource attributes", () => {
    const doc = pagePreviewDocument({ ...base, html: '<p>assets/abc.png</p><img src="assets/abc.png">' });
    expect(doc).toContain("<p>assets/abc.png</p>");
  });
  it("blocks remote resource urls and escaped style endings", () => {
    const doc = pagePreviewDocument({ html: '<img src="https://example.com/a.png">', css: '</style><img src="https://example.com/b.png">', assets: [] });
    expect(doc).not.toContain("https://example.com");
    expect(doc).toContain("<\\/style><img");
    expect(doc.match(/<\/style>/g)).toHaveLength(1);
  });
  it("handles an asset path with regex metacharacters", () => {
    const doc = pagePreviewDocument({
      html: '<img src="assets/a+b(1).png">', css: "",
      assets: [{ path: "assets/a+b(1).png", contentBase64: "BBBB" }],
    });
    expect(doc).toContain("data:image/png;base64,BBBB");
  });
});
