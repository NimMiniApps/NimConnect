<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{ modelValue: string[]; suggestions: string[] }>()
const emit = defineEmits<{ 'update:modelValue': [tags: string[]] }>()
const draft = ref('')

const available = computed(() =>
  props.suggestions.filter(s => !props.modelValue.includes(s)),
)

function addTag(tag: string) {
  const t = tag.trim()
  if (t && !props.modelValue.includes(t)) emit('update:modelValue', [...props.modelValue, t])
  draft.value = ''
}

function removeTag(tag: string) {
  emit('update:modelValue', props.modelValue.filter(t => t !== tag))
}
</script>

<template>
  <div class="tags">
    <div class="chips">
      <button v-for="t in modelValue" :key="t" type="button" class="chip active" @click="removeTag(t)">
        {{ t }} ✕
      </button>
    </div>
    <input
      v-model="draft"
      class="tag-input"
      placeholder="Add tag…"
      @keydown.enter.prevent="addTag(draft)"
      @blur="addTag(draft)"
    />
    <div v-if="available.length" class="chips">
      <button v-for="s in available" :key="s" type="button" class="chip" @click="addTag(s)">{{ s }}</button>
    </div>
  </div>
</template>

<style scoped>
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
.chip {
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--text-2);
  border-radius: var(--nimiq-radius-pill);
  padding: 6px 12px;
  min-height: 32px;
  cursor: pointer;
}
.chip.active { background: var(--nimiq-blue-bg); color: var(--nimiq-white); border-color: transparent; }
.tag-input {
  width: 100%; height: 44px; padding: 0 12px; font: inherit;
  border: 1px solid var(--border); border-radius: var(--nimiq-radius-input);
  background: var(--card); color: var(--text);
}
</style>
