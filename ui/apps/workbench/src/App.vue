<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { MeasurementDoc, Rect } from "@ui-rebuild/workbench-contracts";
import { api } from "./api";
import { dragRect, screenToLogical } from "./geometry";

const pageId = ref(new URLSearchParams(location.search).get("page") ?? "member");
const doc = ref<MeasurementDoc | null>(null); const error = ref(""); const busy = ref(false);
const selected = ref<{ type: "textItems" | "colorSamples" | "ignoreMasks"; index: number } | null>(null);
const dragStart = ref<{ x: number; y: number } | null>(null); const selection = ref<Rect | null>(null);
const instruction = ref(""); const proposal = ref<{ id: string; allowed: Array<{ path: string; explanation: string; value?: unknown }> } | null>(null);
const pickedOps = ref<number[]>([]); const lowConfidence = computed(() => doc.value ? [...doc.value.payload.textItems, ...doc.value.payload.colorSamples].filter((item) => item.confidence < .85 && !item.reviewed) : []);
const canvasSize = computed(() => doc.value?.payload.normalization?.logicalSize ?? { w: 375, h: 812 });
const imageUrl = computed(() => `/api/pages/${encodeURIComponent(pageId.value)}/reference/${encodeURIComponent(doc.value?.payload.normalization?.referenceImage ?? "default.norm.png")}`);

async function run(work: () => Promise<{ doc: MeasurementDoc } | { doc: MeasurementDoc; fingerprint: string }>) { busy.value = true; error.value = ""; try { doc.value = (await work()).doc; } catch (cause) { error.value = (cause as Error).message; } finally { busy.value = false; } }
const load = () => run(() => api.get(pageId.value));
async function patch(path: string, value: unknown) { await run(() => api.patch(pageId.value, [{ op: "replace", path, value }])); }
async function setReviewed(type: string, index: number) { await patch(`/payload/${type}/${index}/reviewed`, true); }
function point(event: PointerEvent) { const box = (event.currentTarget as HTMLElement).getBoundingClientRect(); return screenToLogical(event.clientX, event.clientY, box, canvasSize.value.w); }
function down(event: PointerEvent) { dragStart.value = point(event); selection.value = { ...dragStart.value, w: 0, h: 0 }; (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); }
function move(event: PointerEvent) { if (dragStart.value) selection.value = dragRect(dragStart.value, point(event)); }
function up() { dragStart.value = null; }
async function annotate() { if (!selection.value || !instruction.value.trim()) return; busy.value = true; try { proposal.value = (await api.annotate(pageId.value, selection.value, instruction.value)).changeSet; pickedOps.value = proposal.value.allowed.map((_, index) => index); } catch (cause) { error.value = (cause as Error).message; } finally { busy.value = false; } }
async function accept() { if (!proposal.value) return; await run(() => api.accept(pageId.value, proposal.value!.id, pickedOps.value)); proposal.value = null; }
onMounted(load);
</script>

<template>
  <main>
    <header class="topbar"><div><strong>UI Restoration Workbench</strong><span>阶段 ① / 测量</span></div><div class="actions"><input v-model="pageId" aria-label="页面 ID"><button @click="load">打开</button><button :disabled="busy" @click="run(() => api.analyze(pageId, 2))">重新分析</button><button @click="run(() => api.action(pageId, 'undo'))">撤销</button><button @click="run(() => api.action(pageId, 'redo'))">重做</button><button v-if="doc?.status !== 'confirmed'" class="primary" @click="run(() => api.action(pageId, 'confirm'))">确认冻结</button><button v-else @click="run(() => api.action(pageId, 'unfreeze'))">解冻</button></div></header>
    <div v-if="error" class="error">{{ error }}</div>
    <section v-if="doc" class="workspace">
      <aside class="panel review"><h2>审阅队列 <b>{{ lowConfidence.length }}</b></h2><p v-if="!lowConfidence.length" class="muted">没有待审低置信度条目</p><button v-for="item in lowConfidence" :key="item.id" @click="selected = { type: 'text' in item ? 'textItems' : 'colorSamples', index: 'text' in item ? doc.payload.textItems.indexOf(item as never) : doc.payload.colorSamples.indexOf(item as never) }"><span>{{ item.id }}</span><small>{{ Math.round(item.confidence * 100) }}%</small></button></aside>
      <section class="stage"><div class="stage-head"><span class="pill" :class="doc.status">{{ doc.status }}</span><span>{{ canvasSize.w }} × {{ canvasSize.h }} logical px</span></div><div class="canvas-shell"><div class="canvas" :style="{ aspectRatio: `${canvasSize.w}/${canvasSize.h}` }" @pointerdown="down" @pointermove="move" @pointerup="up"><img :src="imageUrl" draggable="false"><div v-for="(item, index) in doc.payload.textItems" :key="item.id" class="box text-box" :class="{ active: selected?.type === 'textItems' && selected.index === index }" :style="{ left: `${item.bounds.x / canvasSize.w * 100}%`, top: `${item.bounds.y / canvasSize.h * 100}%`, width: `${item.bounds.w / canvasSize.w * 100}%`, height: `${item.bounds.h / canvasSize.h * 100}%` }"></div><div v-if="selection" class="box selection" :style="{ left: `${selection.x / canvasSize.w * 100}%`, top: `${selection.y / canvasSize.h * 100}%`, width: `${selection.w / canvasSize.w * 100}%`, height: `${selection.h / canvasSize.h * 100}%` }"></div></div></div></section>
      <aside class="panel inspector"><h2>检查器</h2><template v-if="selected && selected.type === 'textItems'"><label>文字<input :value="doc.payload.textItems[selected.index]?.text" @change="patch(`/payload/textItems/${selected!.index}/text`, ($event.target as HTMLInputElement).value)"></label><pre>{{ doc.payload.textItems[selected.index]?.bounds }}</pre><button @click="setReviewed('textItems', selected.index)">标记已复核</button></template><p v-else class="muted">从审阅队列选择条目，或在画布拖出标注区域。</p><hr><h3>区域标注</h3><p class="coords">{{ selection ? `${selection.x.toFixed(1)}, ${selection.y.toFixed(1)}, ${selection.w.toFixed(1)} × ${selection.h.toFixed(1)}` : '在画布上拖动' }}</p><textarea v-model="instruction" placeholder="例如：这里应识别为 ¥128"></textarea><button class="primary wide" :disabled="!selection || !instruction" @click="annotate">生成修正提案</button><div v-if="proposal" class="proposal"><h3>ChangeSet</h3><label v-for="(op, index) in proposal.allowed" :key="index"><input v-model="pickedOps" type="checkbox" :value="index"><code>{{ op.path }}</code><small>{{ op.explanation }}</small></label><button class="primary wide" @click="accept">接受所选</button></div></aside>
    </section>
  </main>
</template>
