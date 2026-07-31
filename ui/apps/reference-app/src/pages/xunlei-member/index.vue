<script setup lang="ts">
import MemberPage from '../../components/xunlei-member/MemberPage'
import MemberHero from '../../components/xunlei-member/MemberHero'
import PageHeader from '../../components/xunlei-member/PageHeader'
import AccountSummary from '../../components/xunlei-member/AccountSummary'
import PlanSelection from '../../components/xunlei-member/PlanSelection'
import MembershipTierTabs from '../../components/xunlei-member/MembershipTierTabs'
import PlanOneMonth from '../../components/xunlei-member/PlanOneMonth'
import PlanThreeMonths from '../../components/xunlei-member/PlanThreeMonths'
import PlanTwelveMonths from '../../components/xunlei-member/PlanTwelveMonths'
import PlanSectionDivider from '../../components/xunlei-member/PlanSectionDivider'
import BenefitsHeading from '../../components/xunlei-member/BenefitsHeading'
import BenefitsComparison from '../../components/xunlei-member/BenefitsComparison'
import PaymentAction from '../../components/xunlei-member/PaymentAction'
import MembershipAgreement from '../../components/xunlei-member/MembershipAgreement'
</script>
<template><view class="page-xunlei-member">
    <MemberPage />
    <MemberHero />
    <PageHeader />
    <AccountSummary />
    <PlanSelection />
    <MembershipTierTabs />
    <PlanOneMonth />
    <PlanThreeMonths />
    <PlanTwelveMonths />
    <PlanSectionDivider />
    <BenefitsHeading />
    <BenefitsComparison />
    <PaymentAction />
    <MembershipAgreement />
</view></template>
<style scoped lang="scss">.page-xunlei-member{position:relative;width:100vw;min-height:100vh;overflow:hidden;background:var(--ui-color-page)}</style>
