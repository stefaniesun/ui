<script setup lang="ts">
import { assets } from '../../assets/registry'
</script>
<template><view class="semantic-region" data-region-id="cloud-benefits-column" aria-label="Cloud member benefits">
    <view class="content-node content-decoration content-cloud-benefits-surface" data-content-id="cloud-benefits-surface" aria-hidden="true" />
    <image class="content-node content-asset content-cloud-member-badge-image" data-content-id="cloud-member-badge-image" :src="assets.cloudMemberBadge" alt="Cloud member badge" mode="aspectFit" />
    <text class="content-node content-text content-cloud-member-header-text" data-content-id="cloud-member-header-text">云盘会员</text>
    <image class="content-node content-asset content-cloud-speed-checkmark-image" data-content-id="cloud-speed-checkmark-image" :src="assets.benefitCheckmark" alt="Included benefit checkmark" mode="aspectFit" />
    <text class="content-node content-text content-cloud-storage-text" data-content-id="cloud-storage-text">10TB</text>
    <text class="content-node content-text content-cloud-add-limit-text" data-content-id="cloud-add-limit-text">500次/天</text>
    <text class="content-node content-text content-cloud-playback-text" data-content-id="cloud-playback-text">支持所有</text>
</view></template>
<style scoped lang="scss">.semantic-region{position:absolute;box-sizing:border-box;left:225rpx;top:78.84615384615385rpx;width:228.84615384615384rpx;height:440.3846153846154rpx;background:var(--ui-color-surface)}
.content-node{position:absolute;box-sizing:border-box}
.content-cloud-benefits-surface{left:0rpx;top:0rpx;width:228.84615384615384rpx;height:440.3846153846154rpx;background:var(--ui-color-surface-subtle);border-radius:23.076923076923077rpx}
.content-cloud-member-badge-image{left:55.76923076923077rpx;top:32.69230769230769rpx;width:26.923076923076923rpx;height:26.923076923076923rpx}
.content-cloud-member-header-text{left:90.38461538461539rpx;top:30.76923076923077rpx;width:90.38461538461539rpx;height:38.46153846153846rpx;color:var(--ui-color-text-cloud);font-size:26.923076923076923rpx;font-weight:600;line-height:38.46153846153846rpx}
.content-cloud-speed-checkmark-image{left:103.84615384615385rpx;top:123.07692307692308rpx;width:25rpx;height:21.153846153846153rpx}
.content-cloud-storage-text{left:86.53846153846155rpx;top:209.6153846153846rpx;width:55.769230769230774rpx;height:38.46153846153846rpx;color:var(--ui-color-text-secondary);font-size:25rpx;font-weight:400;line-height:36.53846153846154rpx}
.content-cloud-add-limit-text{left:61.53846153846154rpx;top:298.07692307692304rpx;width:105.76923076923077rpx;height:38.46153846153846rpx;color:var(--ui-color-text-secondary);font-size:25rpx;font-weight:400;line-height:36.53846153846154rpx}
.content-cloud-playback-text{left:69.23076923076924rpx;top:386.5384615384615rpx;width:90.38461538461539rpx;height:38.46153846153846rpx;color:var(--ui-color-text-disabled);font-size:25rpx;font-weight:400;line-height:36.53846153846154rpx}</style>
