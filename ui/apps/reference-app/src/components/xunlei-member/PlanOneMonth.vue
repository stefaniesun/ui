<script setup lang="ts">
import { assets } from '../../assets/registry'
</script>
<template><view class="semantic-region" data-region-id="plan-one-month" aria-label="One month plan">
    <image class="content-node content-asset content-one-month-background" data-content-id="one-month-background" :src="assets.backgroundPlanGold" alt="已选套餐金色背景" mode="scaleToFill" />
    <button class="content-node content-control content-one-month-plan-control" data-content-id="one-month-plan-control" aria-label="1个月，¥18"></button>
    <text class="content-node content-text content-one-month-term" data-content-id="one-month-term">1个月</text>
    <text class="content-node content-text content-one-month-price" data-content-id="one-month-price">¥18</text>
</view></template>
<style scoped lang="scss">.semantic-region{position:absolute;box-sizing:border-box;left:38.46153846153846rpx;top:357.6923076923077rpx;width:251.92307692307693rpx;height:292.3076923076923rpx;background:var(--ui-color-surface)}
.content-node{position:absolute;box-sizing:border-box}
.content-control{appearance:none;margin:0;padding:0;border:0;background:transparent;color:transparent;font-size:0}
.content-one-month-background{left:0rpx;top:0rpx;width:251.92307692307693rpx;height:292.3076923076923rpx}
.content-one-month-plan-control{left:0rpx;top:0rpx;width:251.92307692307693rpx;height:292.3076923076923rpx}
.content-one-month-term{left:88.46153846153845rpx;top:55.76923076923077rpx;width:75rpx;height:44.23076923076923rpx;color:var(--ui-color-text-brown);font-size:30.76923076923077rpx;font-weight:500;line-height:44.23076923076923rpx}
.content-one-month-price{left:73.07692307692308rpx;top:103.84615384615385rpx;width:109.61538461538461rpx;height:92.3076923076923rpx;color:var(--ui-color-text-brown);font-size:80.76923076923077rpx;font-weight:700;line-height:92.3076923076923rpx}</style>
