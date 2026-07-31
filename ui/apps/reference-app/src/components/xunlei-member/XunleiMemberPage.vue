<script setup lang="ts">
import HeaderBackground from './HeaderBackground'
import StatusBar from './StatusBar'
import PurchaseHeader from './PurchaseHeader'
import MembershipSelector from './MembershipSelector'
import SectionDivider from './SectionDivider'
import BenefitsComparison from './BenefitsComparison'
import Checkout from './Checkout'
import HomeIndicator from './HomeIndicator'
</script>
<template><view class="semantic-region" data-region-id="xunlei-member-page" aria-label="Xunlei member purchase page">
    <HeaderBackground />
    <StatusBar />
    <PurchaseHeader />
    <MembershipSelector />
    <SectionDivider />
    <BenefitsComparison />
    <Checkout />
    <HomeIndicator />
</view></template>
<style scoped lang="scss">.semantic-region{position:absolute;box-sizing:border-box;left:0rpx;top:0rpx;width:750rpx;height:1623.076923076923rpx;background:var(--ui-color-surface)}
.content-node{position:absolute;box-sizing:border-box}
</style>
