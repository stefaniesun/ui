<script setup lang="ts">
import { assets } from '../../assets/registry'
</script>
<template><view class="semantic-region" data-region-id="platinum-benefits-column" aria-label="Platinum member benefits">
    <view class="content-node content-decoration content-platinum-benefits-surface" data-content-id="platinum-benefits-surface" aria-hidden="true" />
    <image class="content-node content-asset content-platinum-diamond-image" data-content-id="platinum-diamond-image" :src="assets.platinumMemberDiamond" alt="Platinum member diamond" mode="aspectFit" />
    <text class="content-node content-text content-platinum-member-header-text" data-content-id="platinum-member-header-text">白金会员</text>
    <text class="content-node content-text content-platinum-speed-text" data-content-id="platinum-speed-text">最高 +20MB/s</text>
    <text class="content-node content-text content-platinum-storage-text" data-content-id="platinum-storage-text">3TB</text>
    <text class="content-node content-text content-platinum-add-limit-text" data-content-id="platinum-add-limit-text">100次/天</text>
    <text class="content-node content-text content-platinum-playback-text" data-content-id="platinum-playback-text">720P/480P</text>
</view></template>
<style scoped lang="scss">.semantic-region{position:absolute;box-sizing:border-box;left:453.84615384615387rpx;top:71.15384615384616rpx;width:226.92307692307693rpx;height:448.0769230769231rpx;background:var(--ui-color-surface)}
.content-node{position:absolute;box-sizing:border-box}
.content-platinum-benefits-surface{left:0rpx;top:0rpx;width:226.92307692307693rpx;height:448.0769230769231rpx;background:var(--ui-color-surface-platinum-column);border-radius:23.076923076923077rpx}
.content-platinum-diamond-image{left:46.15384615384615rpx;top:38.46153846153846rpx;width:28.846153846153847rpx;height:28.846153846153847rpx}
.content-platinum-member-header-text{left:84.61538461538461rpx;top:38.46153846153846rpx;width:100rpx;height:38.46153846153846rpx;color:var(--ui-color-text-platinum);font-size:26.923076923076923rpx;font-weight:600;line-height:38.46153846153846rpx}
.content-platinum-speed-text{left:32.69230769230769rpx;top:128.84615384615384rpx;width:159.6153846153846rpx;height:38.46153846153846rpx;color:var(--ui-color-text-platinum);font-size:25rpx;font-weight:600;line-height:36.53846153846154rpx}
.content-platinum-storage-text{left:88.46153846153845rpx;top:217.30769230769232rpx;width:51.92307692307693rpx;height:38.46153846153846rpx;color:var(--ui-color-text-platinum);font-size:25rpx;font-weight:600;line-height:36.53846153846154rpx}
.content-platinum-add-limit-text{left:57.69230769230769rpx;top:305.7692307692308rpx;width:111.53846153846155rpx;height:38.46153846153846rpx;color:var(--ui-color-text-platinum);font-size:25rpx;font-weight:600;line-height:36.53846153846154rpx}
.content-platinum-playback-text{left:46.15384615384615rpx;top:394.2307692307692rpx;width:134.6153846153846rpx;height:38.46153846153846rpx;color:var(--ui-color-text-disabled);font-size:25rpx;font-weight:600;line-height:36.53846153846154rpx}</style>
