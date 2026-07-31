<script setup lang="ts">
import BackButton from './BackButton'
import PageTitle from './PageTitle'
import MemberProfileSummary from './MemberProfileSummary'
</script>
<template><view class="semantic-region" data-region-id="member-hero" aria-label="Membership Hero Header">
    <BackButton />
    <PageTitle />
    <MemberProfileSummary />
</view></template>
<style scoped lang="scss">.semantic-region{position:absolute;box-sizing:border-box;left:0rpx;top:103.84615384615385rpx;width:750rpx;height:209.6153846153846rpx;background:var(--ui-color-surface)}</style>
