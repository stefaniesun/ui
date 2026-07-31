<script setup lang="ts">
import { assets } from '../../assets/registry'
</script>
<template><view class="semantic-region" data-region-id="benefits-comparison" aria-label="Benefits comparison table">
    <view class="content-node content-decoration content-benefit-label-column-surface" data-content-id="benefit-label-column-surface" aria-hidden="true" />
    <view class="content-node content-decoration content-cloud-benefit-column-surface" data-content-id="cloud-benefit-column-surface" aria-hidden="true" />
    <view class="content-node content-decoration content-platinum-benefit-column-surface" data-content-id="platinum-benefit-column-surface" aria-hidden="true" />
    <text class="content-node content-text content-benefit-column-heading" data-content-id="benefit-column-heading">权益</text>
    <image class="content-node content-asset content-cloud-member-icon" data-content-id="cloud-member-icon" :src="assets.iconCloudMember" alt="云盘会员图标" mode="aspectFit" />
    <text class="content-node content-text content-cloud-column-heading" data-content-id="cloud-column-heading">云盘会员</text>
    <image class="content-node content-asset content-platinum-member-icon" data-content-id="platinum-member-icon" :src="assets.iconPlatinumMember" alt="白金会员图标" mode="aspectFit" />
    <text class="content-node content-text content-platinum-column-heading" data-content-id="platinum-column-heading">白金会员</text>
    <text class="content-node content-text content-acceleration-label" data-content-id="acceleration-label">会员加速</text>
    <image class="content-node content-asset content-cloud-acceleration-check" data-content-id="cloud-acceleration-check" :src="assets.iconCheck" alt="支持" mode="aspectFit" />
    <text class="content-node content-text content-platinum-acceleration-value" data-content-id="platinum-acceleration-value">最高 +20MB/s</text>
    <text class="content-node content-text content-cloud-storage-label" data-content-id="cloud-storage-label">云盘空间</text>
    <text class="content-node content-text content-cloud-storage-value" data-content-id="cloud-storage-value">10TB</text>
    <text class="content-node content-text content-platinum-storage-value" data-content-id="platinum-storage-value">3TB</text>
    <text class="content-node content-text content-cloud-add-count-label" data-content-id="cloud-add-count-label">云添加次数</text>
    <text class="content-node content-text content-cloud-add-count-value" data-content-id="cloud-add-count-value">500次/天</text>
    <text class="content-node content-text content-platinum-add-count-value" data-content-id="platinum-add-count-value">100次/天</text>
    <text class="content-node content-text content-playback-quality-label" data-content-id="playback-quality-label">播放清晰度</text>
    <text class="content-node content-text content-cloud-playback-quality-value" data-content-id="cloud-playback-quality-value">支持所有</text>
    <text class="content-node content-text content-platinum-playback-quality-value" data-content-id="platinum-playback-quality-value">720P/480P</text>
</view></template>
<style scoped lang="scss">.semantic-region{position:absolute;box-sizing:border-box;left:38.46153846153846rpx;top:809.6153846153846rpx;width:673.0769230769231rpx;height:461.53846153846155rpx;background:var(--ui-color-surface)}
.content-node{position:absolute;box-sizing:border-box}
.content-control{appearance:none;margin:0;padding:0;border:0;background:transparent;color:transparent;font-size:0}
.content-benefit-label-column-surface{left:0rpx;top:0rpx;width:225rpx;height:461.53846153846155rpx;background:var(--ui-color-surface-subtle);border-radius:21.153846153846153rpx}
.content-cloud-benefit-column-surface{left:226.9230769230769rpx;top:0rpx;width:228.84615384615384rpx;height:461.53846153846155rpx;background:var(--ui-color-surface-primary);border-radius:15.384615384615385rpx}
.content-platinum-benefit-column-surface{left:455.7692307692307rpx;top:-7.6923076923076925rpx;width:225rpx;height:469.2307692307692rpx;background:var(--ui-color-surface-gold);border-radius:21.153846153846153rpx}
.content-benefit-column-heading{left:88.46153846153845rpx;top:30.76923076923077rpx;width:50rpx;height:36.53846153846154rpx;color:var(--ui-color-text-secondary);font-size:25rpx;font-weight:600;line-height:36.53846153846154rpx}
.content-cloud-member-icon{left:280.7692307692308rpx;top:32.69230769230769rpx;width:25rpx;height:25rpx}
.content-cloud-column-heading{left:313.46153846153845rpx;top:30.76923076923077rpx;width:100rpx;height:36.53846153846154rpx;color:var(--ui-color-text-purple);font-size:25rpx;font-weight:600;line-height:36.53846153846154rpx}
.content-platinum-member-icon{left:501.9230769230769rpx;top:30.76923076923077rpx;width:26.923076923076923rpx;height:25rpx}
.content-platinum-column-heading{left:536.5384615384615rpx;top:30.76923076923077rpx;width:100rpx;height:36.53846153846154rpx;color:var(--ui-color-text-gold);font-size:25rpx;font-weight:600;line-height:36.53846153846154rpx}
.content-acceleration-label{left:65.38461538461539rpx;top:119.23076923076923rpx;width:100rpx;height:36.53846153846154rpx;color:var(--ui-color-text-primary);font-size:25rpx;font-weight:400;line-height:36.53846153846154rpx}
.content-cloud-acceleration-check{left:326.9230769230769rpx;top:123.07692307692308rpx;width:25rpx;height:19.23076923076923rpx}
.content-platinum-acceleration-value{left:486.53846153846155rpx;top:119.23076923076923rpx;width:165.3846153846154rpx;height:36.53846153846154rpx;color:var(--ui-color-text-brown);font-size:25rpx;font-weight:600;line-height:36.53846153846154rpx}
.content-cloud-storage-label{left:65.38461538461539rpx;top:209.6153846153846rpx;width:100rpx;height:36.53846153846154rpx;color:var(--ui-color-text-primary);font-size:25rpx;font-weight:400;line-height:36.53846153846154rpx}
.content-cloud-storage-value{left:311.53846153846155rpx;top:209.6153846153846rpx;width:57.69230769230769rpx;height:36.53846153846154rpx;color:var(--ui-color-text-primary);font-size:25rpx;font-weight:400;line-height:36.53846153846154rpx}
.content-platinum-storage-value{left:544.2307692307692rpx;top:209.6153846153846rpx;width:48.07692307692308rpx;height:36.53846153846154rpx;color:var(--ui-color-text-brown);font-size:25rpx;font-weight:600;line-height:36.53846153846154rpx}
.content-cloud-add-count-label{left:51.92307692307693rpx;top:300rpx;width:125rpx;height:36.53846153846154rpx;color:var(--ui-color-text-primary);font-size:25rpx;font-weight:400;line-height:36.53846153846154rpx}
.content-cloud-add-count-value{left:286.53846153846155rpx;top:300rpx;width:105.76923076923077rpx;height:36.53846153846154rpx;color:var(--ui-color-text-primary);font-size:25rpx;font-weight:400;line-height:36.53846153846154rpx}
.content-platinum-add-count-value{left:511.53846153846155rpx;top:300rpx;width:111.53846153846155rpx;height:36.53846153846154rpx;color:var(--ui-color-text-brown);font-size:25rpx;font-weight:600;line-height:36.53846153846154rpx}
.content-playback-quality-label{left:51.92307692307693rpx;top:388.4615384615385rpx;width:125rpx;height:36.53846153846154rpx;color:var(--ui-color-text-muted);font-size:25rpx;font-weight:400;line-height:36.53846153846154rpx}
.content-cloud-playback-quality-value{left:292.3076923076923rpx;top:388.4615384615385rpx;width:100rpx;height:36.53846153846154rpx;color:var(--ui-color-text-muted);font-size:25rpx;font-weight:400;line-height:36.53846153846154rpx}
.content-platinum-playback-quality-value{left:500rpx;top:388.4615384615385rpx;width:138.46153846153845rpx;height:36.53846153846154rpx;color:var(--ui-color-text-muted);font-size:25rpx;font-weight:600;line-height:36.53846153846154rpx}</style>
