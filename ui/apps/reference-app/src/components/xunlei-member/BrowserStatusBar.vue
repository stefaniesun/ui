<script setup lang="ts">
import StatusTime from './StatusTime'
import BrowserAddressPill from './BrowserAddressPill'
import SystemStatusIndicators from './SystemStatusIndicators'
</script>
<template><view class="semantic-region" data-region-id="browser-status-bar" aria-label="Browser and System Status Bar">
    <StatusTime />
    <BrowserAddressPill />
    <SystemStatusIndicators />
</view></template>
<style scoped lang="scss">.semantic-region{position:absolute;box-sizing:border-box;left:0rpx;top:0rpx;width:750rpx;height:103.84615384615385rpx;background:var(--ui-color-surface)}</style>
