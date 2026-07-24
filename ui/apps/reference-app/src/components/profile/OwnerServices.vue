<script setup lang="ts">
import { assetRegistry } from '../../assets/registry'
const items=[{id:'refuel',label:'特惠加油',asset:assetRegistry['service.refuel']},{id:'more',label:'更多服务',asset:assetRegistry['icon.notice']}] as const
</script>
<template><view class="region-card" data-region-id="owner-services" aria-label="车主服务区"><view v-for="item in items" :key="item.id" class="region-card__item"><image :src="item.asset" class="region-card__icon" mode="aspectFit"/><text>{{item.label}}</text></view></view></template>
<style scoped lang="scss">.region-card{display:grid;grid-template-columns:repeat(4,1fr);gap:var(--ui-space-page);background:var(--ui-color-surface)}.region-card__item{display:flex;flex-direction:column;align-items:center}.region-card__icon{width:80rpx;height:80rpx}</style>
