import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

export interface ModelConfig { baseUrl: string; apiKey: string; model: string }

/** 给前端看的只读状态，永不含明文 apiKey。 */
export interface ModelConfigView {
  baseUrl: string; model: string; hasApiKey: boolean; configPath: string;
}

const modelConfigSchema = z.object({
  baseUrl: z.string(),
  apiKey: z.string().optional().default(""),
  model: z.string(),
});

/**
 * 模型配置只从项目配置文件和环境变量读取，服务不提供写入接口——
 * 改配置就是编辑文件，改完重启服务（或直接生效，因为每次请求都重读）。
 */
export class ModelConfigStore {
  constructor(
    private filePath: string,
    private env: Record<string, string | undefined> = process.env,
  ) {}

  get path(): string { return this.filePath; }

  read(): ModelConfig {
    if (existsSync(this.filePath)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
      } catch {
        // 文件内容坏了就当没配，让用户能从错误提示里看出要去改哪个文件；
        // 真正的 I/O 异常（权限等）仍然向上抛。
        return this.envDefaults();
      }
      const result = modelConfigSchema.safeParse(parsed);
      if (!result.success) return this.envDefaults();
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

  view(): ModelConfigView {
    const config = this.read();
    return {
      baseUrl: config.baseUrl,
      model: config.model,
      hasApiKey: config.apiKey !== "",
      configPath: this.filePath,
    };
  }

  isConfigured(): boolean {
    const config = this.read();
    return config.baseUrl !== "" && config.model !== "";
  }
}
