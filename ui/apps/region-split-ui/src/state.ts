import { computed, ref, shallowRef } from "vue";
import type { ModelConfigView, RegionSplitDoc } from "@region-split/core/browser";
import type { StoreApi } from "./api.js";

export type { StoreApi };

export function createStore(api: StoreApi) {
  const projectId = ref("");
  const doc = shallowRef<RegionSplitDoc | null>(null);
  const busyLabel = ref("");
  const busy = computed(() => busyLabel.value !== "");
  const error = ref("");
  const modelConfig = ref<ModelConfigView | null>(null);

  function setDoc(next: RegionSplitDoc, id?: string) {
    doc.value = next;
    if (id) projectId.value = id;
  }

  return {
    api, projectId, doc, busy, busyLabel, error, modelConfig,

    async setFontStack(fontStack: string) {
      if (!projectId.value || doc.value?.fontStack === fontStack) return;
      error.value = "";
      try { setDoc((await api.putFontStack(projectId.value, fontStack)).doc); }
      catch (err) { error.value = (err as Error).message; }
    },

    async loadModelConfig() {
      error.value = "";
      try { modelConfig.value = await api.getModelConfig(); }
      catch (err) { error.value = (err as Error).message; }
    },

    async uploadImage(file: File) {
      busyLabel.value = "上传并预处理中…";
      error.value = "";
      try {
        const result = await api.upload(file);
        setDoc(result.doc, result.projectId);
      } catch (err) { error.value = (err as Error).message; }
      finally { busyLabel.value = ""; }
    },

    async load(id: string) {
      busyLabel.value = "载入中…";
      error.value = "";
      try {
        const result = await api.getProject(id);
        setDoc(result.doc, result.projectId);
      } catch (err) { error.value = (err as Error).message; }
      finally { busyLabel.value = ""; }
    },

    async analyze() {
      if (busy.value || !projectId.value) return;
      busyLabel.value = "AI 分析中…";
      error.value = "";
      try { setDoc((await api.analyze(projectId.value)).doc); }
      catch (err) { error.value = (err as Error).message; }
      finally { busyLabel.value = ""; }
    },
  };
}

export type Store = ReturnType<typeof createStore>;
