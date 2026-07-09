<script setup lang="ts">
defineProps<{ modelValue: string; placeholder?: string }>()
defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <input
    class="search"
    type="search"
    :value="modelValue"
    :placeholder="placeholder ?? 'Search name, address, tag…'"
    @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>

<style scoped>
.search {
  width: 100%;
  height: 44px;
  padding: 0 16px;
  border: 1px solid var(--border);
  border-radius: var(--nimiq-radius-pill);
  background: var(--card);
  color: var(--text);
  font: inherit;
  outline: none;
}
.search:focus { border-color: var(--nq-gold); }
</style>
