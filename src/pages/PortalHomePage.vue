<script setup lang="ts">
import { computed } from 'vue'
import { insideNimiqPay } from '../services/nimiq'
import { isDesktopBrowser } from '../utils/device'
import HomePage from './HomePage.vue'
import DesktopHomePage from './desktop/DesktopHomePage.vue'

const useDesktop = computed(() => isDesktopBrowser() && !insideNimiqPay.value)
</script>

<template>
  <DesktopHomePage v-if="useDesktop" />
  <HomePage v-else />
</template>
