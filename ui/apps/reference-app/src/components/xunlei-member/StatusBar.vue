<script setup lang="ts">
import StatusTime from './StatusTime'
import BrowserOrigin from './BrowserOrigin'
import StatusConnectivity from './StatusConnectivity'
</script>
<template><view class="semantic-region" data-region-id="status-bar" aria-label="Browser status bar">
    <StatusTime />
    <BrowserOrigin />
    <StatusConnectivity />
</view></template>
<style scoped lang="scss">.semantic-region{position:absolute;box-sizing:border-box;left:38.46153846153846rpx;top:15.384615384615385rpx;width:673.0769230769231rpx;height:51.92307692307693rpx;background:var(--ui-color-surface)}
.content-node{position:absolute;box-sizing:border-box}
</style>
