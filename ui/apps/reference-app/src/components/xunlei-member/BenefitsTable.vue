<script setup lang="ts">
import BenefitLabelColumn from './BenefitLabelColumn'
import CloudBenefitColumn from './CloudBenefitColumn'
import PlatinumBenefitColumn from './PlatinumBenefitColumn'
</script>
<template><view class="semantic-region" data-region-id="benefits-table" aria-label="Membership Benefits Table">
    <BenefitLabelColumn />
    <CloudBenefitColumn />
    <PlatinumBenefitColumn />
</view></template>
<style scoped lang="scss">.semantic-region{position:absolute;box-sizing:border-box;left:0rpx;top:75rpx;width:680.7692307692308rpx;height:469.2307692307692rpx;background:var(--ui-color-surface)}</style>
