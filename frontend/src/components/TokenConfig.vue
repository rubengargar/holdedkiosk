<template>
  <div class="flex flex-col items-center justify-center h-screen">
    <h1 class="text-2xl font-bold mb-4">Configura tu token de Holded</h1>
    <input
      v-model="token"
      type="password"
      placeholder="Introduce tu token"
      class="p-2 border rounded w-80 mb-4"
    />
    <button @click="saveToken" class="bg-blue-600 text-white px-4 py-2 rounded">
      Guardar token
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'

const token = ref('')
const router = useRouter()

function saveToken() {
  if (token.value.trim()) {
    localStorage.setItem('holded_token', token.value.trim())
    router.push('/panel')
  }
}
</script>
