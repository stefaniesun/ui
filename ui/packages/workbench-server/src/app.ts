import Fastify, { type FastifyInstance } from "fastify";
import type { ColorSample, NormalizationInfo, TextItem } from "@ui-rebuild/workbench-contracts";
import type { AnnotationModel } from "./model-client.js";
import type { PageStore } from "./store.js";
import { registerAnnotationRoutes } from "./routes/annotation.js";
import { registerMeasurementRoutes } from "./routes/measurement.js";
import { registerReferenceRoutes } from "./routes/reference.js";

export interface AppDeps {
  store: PageStore;
  measure: {
    normalize(input: { imagePath: string; scale: number; statusBarHeightPx?: number; outPath: string }): Promise<NormalizationInfo>;
    ocr(imagePath: string): Promise<TextItem[]>;
    colors(imagePath: string, items: TextItem[]): Promise<ColorSample[]>;
  };
  model: AnnotationModel;
}
export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify();
  registerMeasurementRoutes(app, deps);
  registerAnnotationRoutes(app, deps);
  registerReferenceRoutes(app, deps);
  return app;
}
