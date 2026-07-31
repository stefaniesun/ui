<script setup lang="ts">
import ProfileAvatar from './ProfileAvatar'
import ProfileIdentity from './ProfileIdentity'
import MembershipStatusMessage from './MembershipStatusMessage'
</script>
<template><view class="semantic-region" data-region-id="member-profile-summary" aria-label="Member Profile Summary">
    <ProfileAvatar />
    <ProfileIdentity />
    <MembershipStatusMessage />
</view></template>
<style scoped lang="scss">.semantic-region{position:absolute;box-sizing:border-box;left:38.46153846153846rpx;top:96.15384615384616rpx;width:673.0769230769231rpx;height:75rpx;background:var(--ui-color-surface)}</style>
