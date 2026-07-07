<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import Identicons from '@nimiq/identicons/dist/identicons.bundle.min.js'

const props = withDefaults(defineProps<{ address: string; size?: number }>(), { size: 44 })
const src = ref(Identicons.placeholderToDataUrl('#bbb'))

watchEffect(async () => {
  if (!props.address) return
  src.value = await Identicons.toDataUrl(props.address)
})
</script>

<template>
  <img :src="src" :width="size" :height="size" alt="" class="identicon" />
</template>

<style scoped>
.identicon { display: block; }
</style>
