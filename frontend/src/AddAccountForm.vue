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
  const trimmedToken = token.value.trim()
  if (!trimmedToken) {
    error.value = 'Introduce el token de Holded.'
    return
  }

  const typedName = name.value.trim()
  token.value = ''
  busy.value = true
  error.value = ''
  try {
    await props.submit(typedName, trimmedToken)
    name.value = ''
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
      placeholder="Si lo dejas vacío, se toma de Holded"
      class="border p-3 mb-3 w-full rounded-md focus:ring-2 focus:ring-blue-600 focus:border-transparent"
    />
    <label :for="`${idPrefix}-token`" class="block text-sm font-medium text-gray-700 mb-1">Token API de Holded</label>
    <input
      :id="`${idPrefix}-token`"
      v-model="token"
      type="password"
      autocomplete="off"
      :aria-describedby="`${idPrefix}-scopes`"
      class="border p-3 mb-2 w-full rounded-md focus:ring-2 focus:ring-blue-600 focus:border-transparent"
    />
    <div :id="`${idPrefix}-scopes`" class="text-xs text-gray-500 mb-3">
      <p class="mb-1">El token necesita estos permisos (scopes) en Holded:</p>
      <ul class="space-y-0.5">
        <li><code class="text-gray-700">team:employees.read</code> — listar empleados</li>
        <li><code class="text-gray-700">team:time-tracking.read</code> — ver fichajes del día</li>
        <li><code class="text-gray-700">team:time-tracking.write</code> — fichar entrada, salida y pausas</li>
      </ul>
      <p class="mt-2 mb-1">Permiso opcional:</p>
      <ul>
        <li><code class="text-gray-700">account:info.read</code> — opcional: nombre y logo de la empresa</li>
      </ul>
      <p class="mt-1">No hace falta ningún otro permiso. Sin el opcional, la empresa se muestra con sus iniciales.</p>
    </div>
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
