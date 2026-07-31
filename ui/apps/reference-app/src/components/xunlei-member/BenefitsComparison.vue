<script setup lang="ts">
import BenefitsHeading from './BenefitsHeading'
import BenefitLabelsColumn from './BenefitLabelsColumn'
import CloudBenefitsColumn from './CloudBenefitsColumn'
import PlatinumBenefitsColumn from './PlatinumBenefitsColumn'
</script>
<template><view class="semantic-region" data-region-id="benefits-comparison" aria-label="Membership benefits comparison">
    <BenefitsHeading />
    <BenefitLabelsColumn />
    <CloudBenefitsColumn />
    <PlatinumBenefitsColumn />
</view></template>
<style scoped lang="scss">.semantic-region{position:absolute;box-sizing:border-box;left:38.46153846153846rpx;top:813.4615384615385rpx;width:680.7692307692308rpx;height:523.0769230769231rpx;background:var(--ui-color-surface)}
.content-node{position:absolute;box-sizing:border-box}
</style>
