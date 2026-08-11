<script setup lang="ts">
import { ref, watch } from "vue";
import type { Store } from "../state.js";

const props = defineProps<{ store: Store }>();

const baseUrl = ref("");
const modelName = ref("");
const apiKey = ref("");

watch(() => props.store.configDialogOpen.value, open => {
  if (!open) return;
  baseUrl.value = props.store.modelConfig.value?.baseUrl ?? "";
  modelName.value = props.store.modelConfig.value?.model ?? "";
  apiKey.value = "";
}, { immediate: true });

const formValue = () => ({
  baseUrl: baseUrl.value.trim(),
  model: modelName.value.trim(),
  apiKey: apiKey.value === "" ? undefined : apiKey.value,
});
</script>

<template>
  <div v-if="props.store.configDialogOpen.value" class="backdrop" @click.self="props.store.closeConfigDialog()">
    <div class="dialog">
      <h3>模型配置</h3>

      <label>
        <span>Base URL</span>
        <input v-model="baseUrl" data-test="base-url" placeholder="http://127.0.0.1:11434/v1" />
      </label>

      <label>
        <span>模型名</span>
        <input v-model="modelName" data-test="model-name" placeholder="qwen2.5-vl" />
      </label>

      <label>
        <span>API Key</span>
        <input
          v-model="apiKey"
          data-test="api-key"
          type="password"
          :placeholder="props.store.modelConfig.value?.apiKeyMask || '本地模型可留空'"
        />
      </label>
      <p class="hint">已保存的 Key 不会回传，留空表示保持不变。</p>

      <p
        v-if="props.store.configTestResult.value"
        data-test="test-result"
        :class="props.store.configTestResult.value.ok ? 'ok' : 'fail'"
      >
        {{ props.store.configTestResult.value.ok
          ? "连接成功"
          : `连接失败：${props.store.configTestResult.value.error ?? "未知错误"}` }}
      </p>

      <div class="actions">
        <button data-test="test" @click="props.store.testModelConfig(formValue())">测试连接</button>
        <span class="spacer" />
        <button data-test="cancel" @click="props.store.closeConfigDialog()">取消</button>
        <button data-test="save" @click="props.store.saveModelConfig(formValue())">保存</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed; inset: 0; background: #00000055;
  display: flex; align-items: center; justify-content: center; z-index: 10;
}
.dialog {
  background: #fff; border-radius: 10px; padding: 20px; width: 420px;
  display: flex; flex-direction: column; gap: 10px;
}
h3 { margin: 0 0 4px; }
label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
input { padding: 6px 8px; border: 1px solid #ccc; border-radius: 6px; }
.hint { margin: 0; font-size: 12px; color: #888; }
.ok { color: #22a06b; margin: 0; }
.fail { color: #d0454c; margin: 0; word-break: break-all; }
.actions { display: flex; gap: 8px; margin-top: 6px; }
.spacer { flex: 1; }
</style>
