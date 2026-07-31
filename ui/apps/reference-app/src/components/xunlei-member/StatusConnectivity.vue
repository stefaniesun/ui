<script setup lang="ts">
import { assets } from '../../assets/registry'
</script>
<template><view class="semantic-region" data-region-id="status-connectivity" aria-label="Connectivity and battery indicators">
    <image class="content-node content-asset content-cellular-indicator-image" data-content-id="cellular-indicator-image" :src="assets.cellularIndicator" alt="Cellular signal indicator" mode="aspectFit" />
    <image class="content-node content-asset content-wifi-indicator-image" data-content-id="wifi-indicator-image" :src="assets.wifiIndicator" alt="Wi-Fi indicator" mode="aspectFit" />
    <image class="content-node content-asset content-battery-indicator-image" data-content-id="battery-indicator-image" :src="assets.batteryIndicator" alt="Battery indicator" mode="aspectFit" />
</view></template>
<style scoped lang="scss">.semantic-region{position:absolute;box-sizing:border-box;left:509.61538461538464rpx;top:19.23076923076923rpx;width:151.92307692307693rpx;height:28.846153846153847rpx;background:var(--ui-color-surface)}
.content-node{position:absolute;box-sizing:border-box}
.content-cellular-indicator-image{left:0rpx;top:19.23076923076923rpx;width:38.46153846153846rpx;height:7.6923076923076925rpx}
.content-wifi-indicator-image{left:51.92307692307693rpx;top:1.9230769230769231rpx;width:34.61538461538461rpx;height:25rpx}
.content-battery-indicator-image{left:98.07692307692308rpx;top:1.9230769230769231rpx;width:53.84615384615385rpx;height:25rpx}</style>
