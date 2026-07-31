<script setup lang="ts">
import MembershipTabs from './MembershipTabs'
import PlanCarousel from './PlanCarousel'
</script>
<template><view class="semantic-region" data-region-id="membership-selector" aria-label="Membership type and plan selector">
    <MembershipTabs />
    <PlanCarousel />
</view></template>
<style scoped lang="scss">.semantic-region{position:absolute;box-sizing:border-box;left:0rpx;top:313.46153846153845rpx;width:750rpx;height:444.2307692307692rpx;background:var(--ui-color-surface)}
.content-node{position:absolute;box-sizing:border-box}
</style>
