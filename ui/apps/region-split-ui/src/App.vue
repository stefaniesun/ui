<script setup lang="ts">
import { httpApi } from "./api.js";
import ImageCanvas from "./components/ImageCanvas.vue";
import { createStore } from "./state.js";

const store = createStore(httpApi);
</script>

<template>
  <div class="layout">
    <header>工具栏（Task 9）</header>
    <main><ImageCanvas :store="store" /></main>
    <aside>区域列表（Task 9）</aside>
  </div>
</template>

<style>
html, body, #app { height: 100%; margin: 0; font-family: system-ui, sans-serif; }
.layout { display: grid; grid-template-columns: 1fr 300px; grid-template-rows: auto 1fr; height: 100%; }
header { grid-column: 1 / -1; border-bottom: 1px solid #ddd; }
main { overflow: auto; background: #f0f1f3; }
aside { border-left: 1px solid #ddd; overflow: auto; }
</style>
