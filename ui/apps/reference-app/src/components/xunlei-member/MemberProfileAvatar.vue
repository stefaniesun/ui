<script setup lang="ts">
import { assets } from '../../assets/registry'
</script>
<template><view class="semantic-region" data-region-id="member-profile-avatar" aria-label="Member avatar">
    <image class="content-node content-asset content-designer-avatar-image" data-content-id="designer-avatar-image" :src="assets.designerAvatar" alt="Designer mx avatar" mode="aspectFill" />
</view></template>
<style scoped lang="scss">.semantic-region{position:absolute;box-sizing:border-box;left:0rpx;top:75rpx;width:69.23076923076923rpx;height:69.23076923076923rpx;background:var(--ui-color-surface)}
.content-node{position:absolute;box-sizing:border-box}
.content-designer-avatar-image{left:0rpx;top:0rpx;width:69.23076923076923rpx;height:69.23076923076923rpx}</style>
