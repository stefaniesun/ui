import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

export interface ModelConfig { baseUrl: string; apiKey: string; model: string }
export interface ModelConfigView {
  baseUrl: string; model: string; hasApiKey: boolean; apiKeyMask: string;
}

const modelConfigSchema = z.object({
  baseUrl: z.string(), apiKey: z.string(), model: z.string(),
});

export function maskApiKey(key: string): string {
  if (key === "") return "";
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 3)}••••${key.slice(-4)}`;
}

export class ModelConfigStore {
  constructor(
    private filePath: string,
    private env: Record<string, string | undefined> = process.env,
  ) {}

  read(): ModelConfig {
    if (existsSync(this.filePath)) {
      const raw = readFileSync(this.filePath, "utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return this.envDefaults();
      }
      const result = modelConfigSchema.safeParse(parsed);
      if (!result.success) {
        return this.envDefaults();
      }
      return result.data;
    }
    return this.envDefaults();
  }

  private envDefaults(): ModelConfig {
    return {
      baseUrl: this.env.UIR_MODEL_BASE_URL ?? "",
      apiKey: this.env.UIR_MODEL_API_KEY ?? "",
      model: this.env.UIR_MODEL_NAME ?? "",
    };
  }

  write(input: { baseUrl: string; model: string; apiKey?: string }): ModelConfig {
    const previous = this.read();
    const next: ModelConfig = {
      baseUrl: input.baseUrl,
      model: input.model,
      apiKey: input.apiKey && input.apiKey !== "" ? input.apiKey : previous.apiKey,
    };
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(next, null, 2) + "\n", "utf8");
    return next;
  }

  view(): ModelConfigView {
    const config = this.read();
    return {
      baseUrl: config.baseUrl,
      model: config.model,
      hasApiKey: config.apiKey !== "",
      apiKeyMask: maskApiKey(config.apiKey),
    };
  }

  isConfigured(): boolean {
    const config = this.read();
    return config.baseUrl !== "" && config.model !== "";
  }
}
