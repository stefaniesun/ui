import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ModelConfigStore } from "./model-config.js";

const freshPath = () => join(mkdtempSync(join(tmpdir(), "rs-cfg-")), "region-split.config.json");

function withFile(contents: string, env: Record<string, string | undefined> = {}) {
  const path = freshPath();
  writeFileSync(path, contents, "utf8");
  return new ModelConfigStore(path, env);
}

describe("ModelConfigStore", () => {
  it("reads the project config file", () => {
    const store = withFile(JSON.stringify({
      baseUrl: "http://127.0.0.1:11434/v1", apiKey: "sk-abcdefghijkl", model: "qwen2.5-vl",
    }));
    expect(store.read()).toEqual({
      baseUrl: "http://127.0.0.1:11434/v1", apiKey: "sk-abcdefghijkl", model: "qwen2.5-vl",
    });
    expect(store.isConfigured()).toBe(true);
  });

  it("treats apiKey as optional so local models can omit it", () => {
    const store = withFile(JSON.stringify({ baseUrl: "http://local/v1", model: "llava" }));
    expect(store.read()).toEqual({ baseUrl: "http://local/v1", apiKey: "", model: "llava" });
    expect(store.isConfigured()).toBe(true);
  });

  it("prefers the config file over environment variables", () => {
    const store = withFile(
      JSON.stringify({ baseUrl: "http://file/v1", apiKey: "filekey", model: "file-model" }),
      { UIR_MODEL_BASE_URL: "http://env/v1", UIR_MODEL_NAME: "env-model" },
    );
    expect(store.read()).toMatchObject({ baseUrl: "http://file/v1", model: "file-model" });
  });

  it("falls back to environment variables when the file is absent", () => {
    const store = new ModelConfigStore(freshPath(), {
      UIR_MODEL_BASE_URL: "http://env/v1", UIR_MODEL_API_KEY: "envkey", UIR_MODEL_NAME: "env-model",
    });
    expect(store.read()).toEqual({ baseUrl: "http://env/v1", apiKey: "envkey", model: "env-model" });
    expect(store.isConfigured()).toBe(true);
  });

  it("reports not configured when neither file nor env provides anything", () => {
    const store = new ModelConfigStore(freshPath(), {});
    expect(store.read()).toEqual({ baseUrl: "", apiKey: "", model: "" });
    expect(store.isConfigured()).toBe(false);
  });

  it("falls back instead of throwing when the file is unreadable", () => {
    const env = { UIR_MODEL_BASE_URL: "http://env/v1", UIR_MODEL_NAME: "env-model" };
    expect(withFile("{ not json", env).read()).toMatchObject({ baseUrl: "http://env/v1" });
    expect(withFile(JSON.stringify({ baseUrl: 123 }), env).read()).toMatchObject({ baseUrl: "http://env/v1" });
  });

  it("never exposes the raw key through view(), and points at the config file", () => {
    const store = withFile(JSON.stringify({
      baseUrl: "http://a/v1", apiKey: "sk-abcdefghijkl", model: "m",
    }));
    const view = store.view();
    expect(view).toEqual({
      baseUrl: "http://a/v1", model: "m", hasApiKey: true, configPath: store.path,
    });
    expect(JSON.stringify(view)).not.toContain("abcdefgh");
  });

  it("carries an optional timeout override through to the model client", () => {
    const store = withFile(JSON.stringify({
      baseUrl: "http://slow/v1", model: "m", timeoutMs: 300000,
    }));
    expect(store.read().timeoutMs).toBe(300000);
    // 没写就交给 model.ts 的默认值决定
    expect(withFile(JSON.stringify({ baseUrl: "http://a/v1", model: "m" })).read().timeoutMs).toBeUndefined();
  });

  it("picks up edits to the file without restarting", () => {
    const path = freshPath();
    writeFileSync(path, JSON.stringify({ baseUrl: "http://a/v1", model: "m1" }), "utf8");
    const store = new ModelConfigStore(path, {});
    expect(store.read().model).toBe("m1");
    writeFileSync(path, JSON.stringify({ baseUrl: "http://a/v1", model: "m2" }), "utf8");
    expect(store.read().model).toBe("m2");
  });
});
