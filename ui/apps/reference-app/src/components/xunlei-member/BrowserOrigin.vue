<script setup lang="ts">
import { assets } from '../../assets/registry'
</script>
<template><view class="semantic-region" data-region-id="browser-origin" aria-label="Browser origin pill">
    <view class="content-node content-decoration content-browser-origin-surface" data-content-id="browser-origin-surface" aria-hidden="true" />
    <image class="content-node content-asset content-site-mark-image" data-content-id="site-mark-image" :src="assets.siteMark" alt="uinotes site mark" mode="aspectFit" />
    <text class="content-node content-text content-browser-domain-text" data-content-id="browser-domain-text">uinotes.com</text>
</view></template>
<style scoped lang="scss">.semantic-region{position:absolute;box-sizing:border-box;left:242.30769230769232rpx;top:0rpx;width:188.46153846153845rpx;height:48.07692307692308rpx;background:var(--ui-color-surface)}
.content-node{position:absolute;box-sizing:border-box}
.content-browser-origin-surface{left:0rpx;top:0rpx;width:188.46153846153845rpx;height:48.07692307692308rpx;background:var(--ui-color-surface-browser-pill);border-radius:46.15384615384615rpx}
.content-site-mark-image{left:11.538461538461538rpx;top:11.538461538461538rpx;width:25rpx;height:25rpx}
.content-browser-domain-text{left:42.30769230769231rpx;top:11.538461538461538rpx;width:132.6923076923077rpx;height:26.923076923076923rpx;color:var(--ui-color-text-primary);font-size:23.076923076923077rpx;font-weight:700;line-height:30.76923076923077rpx}</style>
