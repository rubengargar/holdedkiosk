<script setup lang="ts">
import { ref } from 'vue'
import { describeError } from './api'

const props = defineProps<{
  idPrefix: string
  submitLabel: string
  submit: (name: string, token: string) => Promise<void>
}>()

const name = ref('')
const token = ref('')
const busy = ref(false)
const error = ref('')

async function onSubmit() {
  const trimmedName = name.value.trim()
  const trimmedToken = token.value.trim()
  if (!trimmedName || !trimmedToken) {
    error.value = 'Introduce el nombre de la empresa y su token.'
    return
  }

  busy.value = true
  error.value = ''
  try {
    await props.submit(trimmedName, trimmedToken)
    name.value = ''
    token.value = ''
  } catch (e) {
    error.value = `Token inválido o error de red: ${describeError(e)}`
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form @submit.prevent="onSubmit">
    <label :for="`${idPrefix}-name`" class="block text-sm font-medium text-gray-700 mb-1">Nombre de la empresa</label>
    <input
      :id="`${idPrefix}-name`"
      v-model="name"
      type="text"
      autocomplete="off"
      class="border p-3 mb-3 w-full rounded-md focus:ring-2 focus:ring-blue-600 focus:border-transparent"
    />
    <label :for="`${idPrefix}-token`" class="block text-sm font-medium text-gray-700 mb-1">Token API de Holded</label>
    <input
      :id="`${idPrefix}-token`"
      v-model="token"
      type="password"
      autocomplete="off"
      class="border p-3 mb-3 w-full rounded-md focus:ring-2 focus:ring-blue-600 focus:border-transparent"
    />
    <button
      type="submit"
      class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-md w-full font-semibold transition-colors disabled:opacity-60"
      :disabled="busy"
    >
      {{ busy ? 'Verificando...' : submitLabel }}
    </button>
    <p v-if="error" class="text-red-600 mt-3 text-sm" role="alert">{{ error }}</p>
  </form>
</template>
