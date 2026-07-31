<script setup lang="ts">
import PurchaseNavigation from './PurchaseNavigation'
import MemberProfileAvatar from './MemberProfileAvatar'
import MemberProfileCopy from './MemberProfileCopy'
</script>
<template><view class="semantic-region" data-region-id="purchase-header" aria-label="Purchase header and member profile">
    <PurchaseNavigation />
    <MemberProfileAvatar />
    <MemberProfileCopy />
</view></template>
<style scoped lang="scss">.semantic-region{position:absolute;box-sizing:border-box;left:38.46153846153846rpx;top:126.92307692307692rpx;width:673.0769230769231rpx;height:153.84615384615384rpx;background:var(--ui-color-surface)}
.content-node{position:absolute;box-sizing:border-box}
</style>
