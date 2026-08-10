import { resolve } from "node:path";
import sharp from "sharp";
import { buildApp } from "./app.js";
import { createOpenAiAnnotationModel } from "./model-client.js";
import { PageStore } from "./store.js";
import { normalizeReference, sampleMedianColor } from "@ui-rebuild/workbench-measurement";

const root = resolve(process.env.WORKBENCH_PAGES_ROOT ?? "pages");
const app = buildApp({
  store: new PageStore(root),
  model: createOpenAiAnnotationModel({ baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1", apiKey: process.env.OPENAI_API_KEY ?? "", model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini" }),
  measure: {
    normalize: async ({ imagePath, scale, statusBarHeightPx, outPath }) => {
      const metadata = await sharp(imagePath).metadata();
      if (!metadata.width || !metadata.height) throw new Error("invalid reference image");
      const crop = statusBarHeightPx
        ? { x: 0, y: statusBarHeightPx, w: metadata.width, h: metadata.height - statusBarHeightPx }
        : undefined;
      return normalizeReference(imagePath, { outputPath: outPath, logicalWidth: Math.round(metadata.width / scale), statusBarCrop: crop });
    },
    ocr: async () => [],
    colors: async (imagePath) => [await sampleMedianColor(imagePath, { x: 0, y: 0, w: 8, h: 8 }, "background")],
  },
});
await app.listen({ host: "127.0.0.1", port: Number(process.env.PORT ?? 4174) });
