import { computed, ref, shallowRef } from "vue";
import { replaceElementSubtree, type ElementTree, type Rect, type RefactorDiffItem, type RefactorSessionResponse } from "@region-split/core/browser";
import type { ElementRefactorApi } from "./element-refactor-api.js";

export type RefactorView = "original" | "candidate";
export function createElementRefactorStore(deps: {
  api: ElementRefactorApi;
  replaceAppliedTree: (tree: ElementTree, version: string, candidateRootId: string) => void;
}) {
  const session = shallowRef<RefactorSessionResponse | null>(null);
  const originalTree = shallowRef<ElementTree | null>(null);
  const rootId = ref<string | null>(null);
  const projectId = ref("");
  const region = shallowRef<Rect | null>(null);
  const treeVersion = ref("");
  const view = ref<RefactorView>("candidate");
  const busy = ref(false);
  const error = ref("");
  const messages = ref<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const diffs = computed<RefactorDiffItem[]>(() => session.value?.diff ?? []);
  const previewTree = computed(() => {
    if (!originalTree.value || !rootId.value || view.value === "original" || !session.value) return originalTree.value;
    return replaceElementSubtree(originalTree.value, rootId.value, session.value.candidate);
  });

  function open(input: { projectId: string; region: Rect; tree: ElementTree; treeVersion: string; rootId: string }) {
    projectId.value = input.projectId; region.value = input.region; originalTree.value = structuredClone(input.tree);
    treeVersion.value = input.treeVersion; rootId.value = input.rootId; session.value = null; messages.value = []; error.value = "";
  }
  async function send(instruction: string) {
    if (!instruction.trim() || !rootId.value || !region.value || busy.value) return;
    busy.value = true; error.value = "";
    try {
      const next = session.value
        ? await deps.api.sendMessage(projectId.value, session.value.sessionId, { candidateVersion: session.value.candidateVersion, instruction })
        : await deps.api.createSession(projectId.value, { region: region.value, rootId: rootId.value, treeVersion: treeVersion.value, instruction });
      session.value = next; messages.value = [...messages.value, { role: "user", content: instruction }, { role: "assistant", content: next.explanation }]; view.value = "candidate";
    } catch (cause) { error.value = (cause as Error).message; }
    finally { busy.value = false; }
  }
  async function apply() {
    if (!session.value || busy.value) return;
    busy.value = true; error.value = "";
    try {
      const candidateRootId = session.value.candidate.rootId;
      const result = await deps.api.apply(projectId.value, session.value.sessionId, { candidateVersion: session.value.candidateVersion, treeVersion: treeVersion.value });
      deps.replaceAppliedTree(result.tree, result.treeVersion, candidateRootId); discard();
    } catch (cause) { error.value = (cause as Error).message; }
    finally { busy.value = false; }
  }
  function reset() { session.value = null; messages.value = [...messages.value, { role: "assistant", content: "候选已重置，请重新描述。" }]; }
  function discard() { session.value = null; originalTree.value = null; rootId.value = null; region.value = null; messages.value = []; error.value = ""; }
  return { session, originalTree, previewTree, rootId, view, busy, error, messages, diffs, open, send, apply, reset, discard };
}
