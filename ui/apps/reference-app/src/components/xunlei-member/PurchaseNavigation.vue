<script setup lang="ts">
import { assets } from '../../assets/registry'
</script>
<template><view class="semantic-region" data-region-id="purchase-navigation" aria-label="Purchase navigation">
    <image class="content-node content-asset content-back-arrow-image" data-content-id="back-arrow-image" :src="assets.backArrow" alt="Back arrow" mode="aspectFit" />
    <button class="content-node content-control content-back-control" data-content-id="back-control">返回</button>
    <text class="content-node content-text content-purchase-title-text" data-content-id="purchase-title-text">购买会员</text>
</view></template>
<style scoped lang="scss">.semantic-region{position:absolute;box-sizing:border-box;left:0rpx;top:0rpx;width:673.0769230769231rpx;height:40.38461538461539rpx;background:var(--ui-color-surface)}
.content-node{position:absolute;box-sizing:border-box}
.content-back-arrow-image{left:0rpx;top:3.8461538461538463rpx;width:34.61538461538461rpx;height:28.846153846153847rpx}
.content-back-control{left:-7.6923076923076925rpx;top:-9.615384615384615rpx;width:61.53846153846154rpx;height:57.69230769230769rpx}
.content-purchase-title-text{left:271.15384615384613rpx;top:1.9230769230769231rpx;width:130.76923076923077rpx;height:46.15384615384615rpx;color:var(--ui-color-text-header);font-size:32.69230769230769rpx;font-weight:600;line-height:46.15384615384615rpx}</style>
