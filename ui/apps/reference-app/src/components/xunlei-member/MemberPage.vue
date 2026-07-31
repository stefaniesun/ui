<script setup lang="ts">
import BrowserStatusBar from './BrowserStatusBar'
import MemberHero from './MemberHero'
import MembershipSelector from './MembershipSelector'
import MembershipDivider from './MembershipDivider'
import BenefitsSection from './BenefitsSection'
import PurchaseFooter from './PurchaseFooter'
import HomeIndicator from './HomeIndicator'
</script>
<template><view class="semantic-region" data-region-id="member-page" aria-label="Member Purchase Page">
    <BrowserStatusBar />
    <MemberHero />
    <MembershipSelector />
    <MembershipDivider />
    <BenefitsSection />
    <PurchaseFooter />
    <HomeIndicator />
</view></template>
<style scoped lang="scss">.semantic-region{position:absolute;box-sizing:border-box;left:0rpx;top:0rpx;width:750rpx;height:1623.076923076923rpx;background:var(--ui-color-surface)}</style>
