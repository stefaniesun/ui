<script setup lang="ts">
import PaymentAction from './PaymentAction'
import MembershipAgreement from './MembershipAgreement'
</script>
<template><view class="semantic-region" data-region-id="checkout" aria-label="Payment and agreement controls">
    <PaymentAction />
    <MembershipAgreement />
</view></template>
<style scoped lang="scss">.semantic-region{position:absolute;box-sizing:border-box;left:38.46153846153846rpx;top:1396.1538461538462rpx;width:673.0769230769231rpx;height:176.92307692307693rpx;background:var(--ui-color-surface)}
.content-node{position:absolute;box-sizing:border-box}
</style>
