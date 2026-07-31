<script setup lang="ts">
import { assets } from '../../assets/registry'
</script>
<template><view class="semantic-region" data-region-id="account-summary" aria-label="Account summary">
    <image class="content-node content-asset content-account-avatar" data-content-id="account-avatar" :src="assets.avatarDesignerMx" alt="设计师mx头像" mode="aspectFill" />
    <text class="content-node content-text content-account-name-prefix" data-content-id="account-name-prefix">设计师mx（1</text>
    <text class="content-node content-text content-account-login" data-content-id="account-login">登录）</text>
    <text class="content-node content-text content-account-membership-status" data-content-id="account-membership-status">您还不是白金会员，开通立享特权</text>
</view></template>
<style scoped lang="scss">.semantic-region{position:absolute;box-sizing:border-box;left:38.46153846153846rpx;top:117.3076923076923rpx;width:532.6923076923077rpx;height:75rpx;background:var(--ui-color-surface)}
.content-node{position:absolute;box-sizing:border-box}
.content-control{appearance:none;margin:0;padding:0;border:0;background:transparent;color:transparent;font-size:0}
.content-account-avatar{left:0rpx;top:1.9230769230769231rpx;width:69.23076923076923rpx;height:69.23076923076923rpx}
.content-account-name-prefix{left:90.38461538461539rpx;top:5.769230769230769rpx;width:171.15384615384616rpx;height:42.30769230769231rpx;color:var(--ui-color-text-brown);font-size:30.76923076923077rpx;font-weight:500;line-height:42.30769230769231rpx}
.content-account-login{left:394.2307692307692rpx;top:7.6923076923076925rpx;width:69.23076923076923rpx;height:36.53846153846154rpx;color:var(--ui-color-text-brown);font-size:25rpx;font-weight:400;line-height:36.53846153846154rpx}
.content-account-membership-status{left:90.38461538461539rpx;top:48.07692307692307rpx;width:442.3076923076923rpx;height:36.53846153846154rpx;color:var(--ui-color-text-brown);font-size:25rpx;font-weight:400;line-height:36.53846153846154rpx}</style>
