<script setup lang="ts">
import OneMonthPlan from './OneMonthPlan'
import ThreeMonthPlan from './ThreeMonthPlan'
import TwelveMonthPlan from './TwelveMonthPlan'
</script>
<template><view class="semantic-region" data-region-id="plan-carousel" aria-label="Scrollable membership plans">
    <OneMonthPlan />
    <ThreeMonthPlan />
    <TwelveMonthPlan />
</view></template>
<style scoped lang="scss">.semantic-region{position:absolute;box-sizing:border-box;left:0rpx;top:96.15384615384616rpx;width:750rpx;height:348.0769230769231rpx;background:var(--ui-color-surface)}
.content-node{position:absolute;box-sizing:border-box}
</style>
