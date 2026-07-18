<script setup lang="ts">
import { computed } from 'vue'
import { insideNimiqPay } from '../services/nimiq'
import { isDesktopBrowser } from '../utils/device'
import MyProfilePage from './MyProfilePage.vue'
import DesktopIdentityPage from './desktop/DesktopIdentityPage.vue'

const useDesktop = computed(() => isDesktopBrowser() && !insideNimiqPay.value)
</script>

<template>
  <DesktopIdentityPage v-if="useDesktop" />
  <MyProfilePage v-else />
</template>
