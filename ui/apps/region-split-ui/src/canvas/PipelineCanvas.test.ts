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

  it("restores every connection after a temporarily missing anchor", async () => {
    let secondAnchorReady = false;
    const getRegionAnchor = vi.fn((id: string) => {
      if (id === "b" && !secondAnchorReady) return null;
      return id === "a" ? { x: 300, y: 100 } : { x: 300, y: 160 };
    });
    const wrapper = mount(PipelineCanvas, {
      props: {
        regions: [region("a", 0), region("b", 200)],
        projectId: "p1",
        getRegionAnchor,
        createElementStore: () => ({ marker: Math.random() }) as never,
      },
      global: { stubs: { PipelineNode: false } },
    });
    const vm = wrapper.vm as unknown as {
      openDetail(id: string): void;
      refreshConnections(): void;
    };
    vm.openDetail("a");
    vm.openDetail("b");
    await wrapper.vm.$nextTick();
    vm.refreshConnections();
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll(".links path")).toHaveLength(1);

    secondAnchorReady = true;
    vm.refreshConnections();
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll(".links path")).toHaveLength(2);

    getRegionAnchor.mockClear();
    await wrapper.get('[data-node-id="workspace"] .node-header').trigger("pointerdown", {
      button: 0, clientX: 0, clientY: 0,
    });
    const move = new Event("pointermove") as PointerEvent;
    Object.assign(move, { clientX: 20, clientY: 20 });
    window.dispatchEvent(move);
    expect(getRegionAnchor).toHaveBeenCalled();
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
