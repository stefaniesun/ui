import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Region } from "@region-split/core/browser";
import PipelineCanvas from "./PipelineCanvas.vue";
import { regionColor } from "../region-visual.js";

const region = (id: string, y: number): Region => ({
  id, displayName: id, type: "other", bounds: { x: 0, y, w: 400, h: 200 },
  confidence: 1, scrollX: false, scrollY: false,
});

function mounted(regions = [region("a", 0), region("b", 200)]) {
  return mount(PipelineCanvas, {
    props: {
      regions,
      projectId: "p1",
      getRegionAnchor: (id: string) => id === "a" ? { x: 300, y: 100 } : { x: 300, y: 160 },
      createElementStore: () => ({ marker: Math.random() }) as never,
    },
    slots: {
      default: "workspace",
      detail: '<template #detail="slotProps"><div class="detail-slot">{{ slotProps.region.id }}</div></template>',
    },
    global: { stubs: { PipelineNode: false } },
  });
}

describe("PipelineCanvas dynamic details", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 1200, height: 800, right: 1200, bottom: 800 }),
    });
  });

  it("opens each region once and closes independently", async () => {
    const wrapper = mounted();
    expect(wrapper.findAll('[data-node-id^="detail:"]')).toHaveLength(0);
    (wrapper.vm as unknown as { openDetail(id: string): void }).openDetail("a");
    await wrapper.vm.$nextTick();
    (wrapper.vm as unknown as { openDetail(id: string): void }).openDetail("a");
    (wrapper.vm as unknown as { openDetail(id: string): void }).openDetail("b");
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll('[data-node-id^="detail:"]')).toHaveLength(2);
    await wrapper.find('[data-node-id="detail:a"] [data-test="close-node"]').trigger("click");
    expect(wrapper.find('[data-node-id="detail:a"]').exists()).toBe(false);
    expect(wrapper.find('[data-node-id="detail:b"]').exists()).toBe(true);
  });

  it("draws one connection per opened region", async () => {
    const wrapper = mounted();
    (wrapper.vm as unknown as { openDetail(id: string): void }).openDetail("a");
    (wrapper.vm as unknown as { openDetail(id: string): void }).openDetail("b");
    await wrapper.vm.$nextTick();
    (wrapper.vm as unknown as { refreshConnections(): void }).refreshConnections();
    await wrapper.vm.$nextTick();
    const paths = wrapper.findAll(".links path");
    expect(paths).toHaveLength(2);
    expect(paths[0]!.attributes("stroke")).toBe(regionColor("a"));
    expect(paths[1]!.attributes("stroke")).toBe(regionColor("b"));
  });

  it("removes details whose regions disappear", async () => {
    const wrapper = mounted();
    (wrapper.vm as unknown as { openDetail(id: string): void }).openDetail("a");
    await wrapper.vm.$nextTick();
    await wrapper.setProps({ regions: [region("b", 200)] });
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-node-id="detail:a"]').exists()).toBe(false);
  });
});
