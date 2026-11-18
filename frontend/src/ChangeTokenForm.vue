<script setup lang="ts">
import { ref } from 'vue'
import { describeError } from './api'

const props = defineProps<{
  accountName: string
  submit: (token: string) => Promise<void>
}>()

const token = ref('')
const busy = ref(false)
const error = ref('')

async function onSubmit() {
  const trimmed = token.value.trim()
  if (!trimmed) {
    error.value = 'Introduce el nuevo token.'
    return
  }

  busy.value = true
  error.value = ''
  try {
    await props.submit(trimmed)
    token.value = ''
  } catch (e) {
    error.value = `Token inválido o error de red: ${describeError(e)}`
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="mt-2 flex gap-2" @submit.prevent="onSubmit">
    <input
      v-model="token"
      type="password"
      autocomplete="off"
      :aria-label="`Nuevo token de ${accountName}`"
      class="min-w-0 flex-1 p-2 border border-gray-300 rounded-md"
    />
    <button
      type="submit"
      class="px-3 py-2 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60"
      :disabled="busy"
    >
      {{ busy ? 'Verificando...' : 'Cambiar token' }}
    </button>
  </form>
  <p v-if="error" class="text-red-600 mt-2 text-sm" role="alert">{{ error }}</p>
</template>
