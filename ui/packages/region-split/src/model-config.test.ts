import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { maskApiKey, ModelConfigStore } from "./model-config.js";

const freshPath = () => join(mkdtempSync(join(tmpdir(), "rs-cfg-")), "model-config.json");

describe("maskApiKey", () => {
  it("masks by length", () => {
    expect(maskApiKey("")).toBe("");
    expect(maskApiKey("short")).toBe("••••");
    expect(maskApiKey("sk-abcdefghijkl")).toBe("sk-••••ijkl");
  });
});

describe("ModelConfigStore", () => {
  it("falls back to environment variables when no file exists", () => {
    const store = new ModelConfigStore(freshPath(), {
      UIR_MODEL_BASE_URL: "http://env/v1", UIR_MODEL_API_KEY: "envkey123456", UIR_MODEL_NAME: "env-model",
    });
    expect(store.read()).toEqual({ baseUrl: "http://env/v1", apiKey: "envkey123456", model: "env-model" });
    expect(store.isConfigured()).toBe(true);
  });

  it("returns empty config when neither file nor env is set", () => {
    const store = new ModelConfigStore(freshPath(), {});
    expect(store.read()).toEqual({ baseUrl: "", apiKey: "", model: "" });
    expect(store.isConfigured()).toBe(false);
  });

  it("prefers the saved file over environment variables", () => {
    const store = new ModelConfigStore(freshPath(), { UIR_MODEL_BASE_URL: "http://env/v1", UIR_MODEL_NAME: "env-model" });
    store.write({ baseUrl: "http://file/v1", model: "file-model", apiKey: "filekey12345" });
    expect(store.read()).toEqual({ baseUrl: "http://file/v1", apiKey: "filekey12345", model: "file-model" });
  });

  it("keeps the existing api key when the new one is empty", () => {
    const store = new ModelConfigStore(freshPath(), {});
    store.write({ baseUrl: "http://a/v1", model: "m", apiKey: "originalkey1" });
    store.write({ baseUrl: "http://b/v1", model: "m2" });
    expect(store.read()).toEqual({ baseUrl: "http://b/v1", apiKey: "originalkey1", model: "m2" });
  });

  it("never exposes the raw key through view()", () => {
    const store = new ModelConfigStore(freshPath(), {});
    store.write({ baseUrl: "http://a/v1", model: "m", apiKey: "sk-abcdefghijkl" });
    expect(store.view()).toEqual({
      baseUrl: "http://a/v1", model: "m", hasApiKey: true, apiKeyMask: "sk-••••ijkl",
    });
  });

  it("falls back to environment defaults when the config file contains invalid JSON", () => {
    const path = freshPath();
    writeFileSync(path, "{ not json", "utf8");
    const store = new ModelConfigStore(path, {
      UIR_MODEL_BASE_URL: "http://env/v1", UIR_MODEL_API_KEY: "envkey123456", UIR_MODEL_NAME: "env-model",
    });

    expect(store.read()).toEqual({ baseUrl: "http://env/v1", apiKey: "envkey123456", model: "env-model" });

    store.write({ baseUrl: "http://fixed/v1", model: "fixed-model", apiKey: "fixedkey1234" });
    expect(store.read()).toEqual({ baseUrl: "http://fixed/v1", apiKey: "fixedkey1234", model: "fixed-model" });
  });

  it("falls back to environment defaults when the config file has an invalid schema", () => {
    const path = freshPath();
    writeFileSync(path, JSON.stringify({ baseUrl: 123 }), "utf8");
    const store = new ModelConfigStore(path, {
      UIR_MODEL_BASE_URL: "http://env/v1", UIR_MODEL_API_KEY: "envkey123456", UIR_MODEL_NAME: "env-model",
    });

    expect(store.read()).toEqual({ baseUrl: "http://env/v1", apiKey: "envkey123456", model: "env-model" });

    store.write({ baseUrl: "http://fixed/v1", model: "fixed-model", apiKey: "fixedkey1234" });
    expect(store.read()).toEqual({ baseUrl: "http://fixed/v1", apiKey: "fixedkey1234", model: "fixed-model" });
  });
});
