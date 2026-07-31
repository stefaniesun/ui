<script setup lang="ts">
import { assets } from '../../assets/registry'
</script>
<template><view class="semantic-region" data-region-id="page-header" aria-label="Page header">
    <button class="content-node content-control content-back-control" data-content-id="back-control" aria-label="返回"></button>
    <image class="content-node content-asset content-back-icon" data-content-id="back-icon" :src="assets.iconBack" alt="返回" mode="aspectFit" />
    <text class="content-node content-text content-page-title" data-content-id="page-title">购买会员</text>
</view></template>
<style scoped lang="scss">.semantic-region{position:absolute;box-sizing:border-box;left:30.76923076923077rpx;top:38.46153846153846rpx;width:688.4615384615385rpx;height:71.15384615384616rpx;background:transparent}
.content-node{position:absolute;box-sizing:border-box}
.content-control{appearance:none;margin:0;padding:0;border:0;background:transparent;color:transparent;font-size:0}
.content-back-control{left:0rpx;top:0rpx;width:53.84615384615385rpx;height:51.92307692307693rpx}
.content-back-icon{left:7.6923076923076925rpx;top:9.615384615384615rpx;width:34.61538461538461rpx;height:28.846153846153847rpx}
.content-page-title{left:278.84615384615387rpx;top:7.6923076923076925rpx;width:130.76923076923077rpx;height:48.07692307692308rpx;color:var(--ui-color-text-brown);font-size:34.61538461538461rpx;font-weight:600;line-height:48.07692307692308rpx}</style>
