<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AccountAvatar from './AccountAvatar.vue'
import AddAccountForm from './AddAccountForm.vue'
import ChangeTokenForm from './ChangeTokenForm.vue'
import { avatarColors, getInitials } from './avatar'
import { formatHHMM, trackedMs } from './board'
import { useKiosk } from './kiosk'

const {
  accounts,
  activeId,
  activeAccount,
  activeState,
  statuses,
  now,
  addAccount,
  changeToken,
  renameAccount,
  refreshInfo,
  deleteAccount,
  setActive,
  toggleHidden,
  clock,
  dismissActionError,
  refresh
} = useKiosk()

const kioskTitle = ref(localStorage.getItem('kiosk_title') || 'Portal de fichado')
const searchTerm = ref('')
const showSettingsPanel = ref(false)
const confirmingDelete = ref(false)
const infoStatus = ref<'idle' | 'busy' | 'failed'>('idle')

const greeting = computed(() => (new Date(now.value).getHours() < 12 ? 'Buenos días' : 'Buenas tardes'))

const currentFormattedDate = computed(() =>
  new Date(now.value).toLocaleDateString('es-ES', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
)

const employees = computed(() => activeState.value?.employees ?? [])
const hiddenIds = computed(() => new Set(activeAccount.value?.hiddenEmployeeIds ?? []))
const visibleEmployees = computed(() => employees.value.filter(emp => !hiddenIds.value.has(emp.id)))

const rows = computed(() => {
  const term = searchTerm.value.toLowerCase()
  return visibleEmployees.value
    .filter(emp => emp.name.toLowerCase().includes(term))
    .map(emp => {
      const status = statuses.value.get(emp.id)
      return {
        ...emp,
        isClockedIn: status?.runningSince != null,
        isPaused: status?.paused === true,
        tracked: formatHHMM(trackedMs(status, now.value)),
        busy: activeState.value?.clocking[emp.id] === true
      }
    })
})

const clockedInCount = computed(() => rows.value.filter(row => row.isClockedIn).length)

function saveKioskTitle() {
  localStorage.setItem('kiosk_title', kioskTitle.value)
}

function onRename(id: string, event: Event) {
  const input = event.target as HTMLInputElement
  renameAccount(id, input.value)
  input.value = accounts.value.find(a => a.id === id)?.name ?? ''
}

async function onRefreshInfo(id: string) {
  infoStatus.value = 'busy'
  infoStatus.value = (await refreshInfo(id)) ? 'idle' : 'failed'
}

function confirmDelete(id: string) {
  deleteAccount(id)
  confirmingDelete.value = false
  if (accounts.value.length === 0) showSettingsPanel.value = false
}

watch(activeId, () => {
  searchTerm.value = ''
  confirmingDelete.value = false
  infoStatus.value = 'idle'
})
</script>

<template>
  <div class="min-h-screen bg-gray-100">
    <div
      v-if="showSettingsPanel"
      class="fixed inset-0 bg-black bg-opacity-50 z-40"
      @click="showSettingsPanel = false"
    ></div>

    <div
      :class="['fixed top-0 right-0 h-full bg-white shadow-xl z-50 transform transition-transform duration-300 ease-in-out w-80 p-6 overflow-y-auto', showSettingsPanel ? 'translate-x-0' : 'translate-x-full']"
    >
      <h3 class="text-xl font-semibold mb-6">Configuración</h3>

      <section v-if="activeAccount" :key="activeAccount.id" aria-label="Configuración de la empresa" class="mb-6">
        <div class="flex items-center gap-3 mb-4">
          <div class="h-10 w-10 flex-shrink-0">
            <AccountAvatar :account="activeAccount" />
          </div>
          <h4 class="text-lg font-semibold text-gray-800 truncate">{{ activeAccount.name }}</h4>
        </div>

        <label for="accountNameInput" class="block text-sm font-medium text-gray-700 mb-1">Nombre de la empresa</label>
        <input
          id="accountNameInput"
          :value="activeAccount.name"
          type="text"
          class="w-full p-2 border border-gray-300 rounded-md shadow-sm"
          @change="onRename(activeAccount.id, $event)"
        />

        <button
          type="button"
          class="mt-4 min-h-10 px-3 py-2 text-sm rounded bg-gray-200 hover:bg-gray-300 text-gray-800 disabled:opacity-60"
          :disabled="infoStatus === 'busy'"
          @click="onRefreshInfo(activeAccount.id)"
        >
          {{ infoStatus === 'busy' ? 'Actualizando...' : 'Actualizar datos de Holded' }}
        </button>
        <p v-if="infoStatus === 'failed'" class="text-red-600 mt-2 text-sm" role="alert">
          No se pudieron obtener los datos. Comprueba que el token tenga el permiso account:info.read.
        </p>

        <p class="text-sm font-medium text-gray-700 mt-4 -mb-1">Token</p>
        <ChangeTokenForm :account-name="activeAccount.name" :submit="token => changeToken(activeAccount!.id, token)" />

        <h5 class="text-sm font-medium text-gray-700 mt-4 mb-1">Ocultar/Mostrar usuarios</h5>
        <div class="max-h-60 overflow-y-auto border rounded-md p-2">
          <div v-for="emp in employees" :key="`setting-${emp.id}`" class="flex items-center justify-between py-1">
            <span>{{ emp.name }}</span>
            <button
              type="button"
              @click="toggleHidden(emp.id)"
              :class="['min-h-10 px-3 text-xs rounded', hiddenIds.has(emp.id) ? 'bg-gray-200 text-gray-700' : 'bg-blue-600 hover:bg-blue-700 text-white']"
            >
              {{ hiddenIds.has(emp.id) ? 'Mostrar' : 'Ocultar' }}
            </button>
          </div>
          <p v-if="employees.length === 0" class="text-sm text-gray-500">No hay empleados para mostrar.</p>
        </div>

        <div v-if="confirmingDelete" class="mt-4 flex items-center gap-2">
          <span class="text-sm text-gray-700 flex-1">¿Eliminar {{ activeAccount.name }}?</span>
          <button
            type="button"
            class="min-h-10 px-3 py-2 text-sm rounded bg-red-500 hover:bg-red-600 text-white"
            @click="confirmDelete(activeAccount.id)"
          >
            Confirmar
          </button>
          <button
            type="button"
            class="min-h-10 px-3 py-2 text-sm rounded bg-gray-200 hover:bg-gray-300 text-gray-800"
            @click="confirmingDelete = false"
          >
            Cancelar
          </button>
        </div>
        <button
          v-else
          type="button"
          class="mt-4 min-h-10 px-3 py-2 text-sm rounded bg-gray-200 hover:bg-gray-300 text-gray-800"
          @click="confirmingDelete = true"
        >
          Eliminar empresa
        </button>
      </section>

      <section aria-label="Kiosko" class="border-t pt-6">
        <h4 class="text-lg font-semibold text-gray-800 mb-4">Kiosko</h4>
        <label for="kioskTitleInput" class="block text-sm font-medium text-gray-700 mb-1">Título del Kiosk</label>
        <input
          id="kioskTitleInput"
          v-model="kioskTitle"
          type="text"
          class="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-600 focus:border-blue-600 mb-6"
          @input="saveKioskTitle"
        />

        <h5 class="text-sm font-medium text-gray-700 mb-1">Añadir empresa</h5>
        <p class="text-sm text-gray-500 mb-2">
          Obtén el token en
          <a href="https://developers.holded.com/reference/api-key-1" target="_blank" class="text-blue-500 hover:underline">
            Ajustes &gt; API
          </a>
        </p>
        <AddAccountForm id-prefix="settings" submit-label="Añadir empresa" :submit="addAccount" />
      </section>

      <button
        type="button"
        aria-label="Cerrar configuración"
        @click="showSettingsPanel = false"
        class="absolute top-4 right-4 text-gray-500 hover:text-gray-700"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <div class="p-4 max-w-2xl mx-auto">
      <div v-if="accounts.length === 0">
        <div class="bg-white p-6 rounded-lg shadow-md">
          <h2 class="text-2xl font-bold mb-4 text-center text-gray-700">Configura tu Kiosk</h2>
          <p class="text-sm text-gray-500 mb-4">
            Introduce el nombre de tu empresa y su token de API de Holded para cargar los empleados activos. <br> Obtén el token en
            <a href="https://developers.holded.com/reference/api-key-1" target="_blank" class="text-blue-500 hover:underline">
              Ajustes &gt; API
            </a>
          </p>
          <AddAccountForm id-prefix="first-run" submit-label="Guardar y Verificar Token" :submit="addAccount" />
        </div>
      </div>

      <div v-else-if="activeAccount && activeState">
        <header class="grid grid-cols-[1fr_auto_1fr] items-center gap-2 mb-3">
          <div role="tablist" aria-label="Empresas" class="flex min-w-0 gap-2 overflow-x-auto">
            <button
              v-for="account in accounts"
              :key="account.id"
              type="button"
              role="tab"
              :aria-selected="account.id === activeId"
              :aria-label="account.name"
              :title="account.name"
              :class="['relative h-10 w-10 flex-shrink-0 rounded-full transition-opacity', account.id === activeId ? '' : 'opacity-60 hover:opacity-100']"
              @click="setActive(account.id)"
            >
              <AccountAvatar :account="account" />
              <span
                v-if="account.id === activeId"
                class="pointer-events-none absolute inset-0 rounded-full ring-[3px] ring-inset ring-blue-600"
              ></span>
            </button>
          </div>
          <h1 class="text-sm font-medium tracking-wide text-gray-500 text-center uppercase truncate">{{ kioskTitle }}</h1>
          <button
            type="button"
            aria-label="Abrir configuración"
            @click="showSettingsPanel = true"
            class="justify-self-end h-10 w-10 flex items-center justify-center text-gray-600 hover:text-gray-800"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.108 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.45.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.78.93l-.15.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.149-.894c-.07-.424-.384-.764-.78-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.506-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.107-1.204l-.527-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.93l.15-.894z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </header>

        <div class="mb-4 p-3 bg-white rounded-lg shadow text-center">
          <h2 class="text-2xl font-semibold text-gray-700">{{ greeting }}</h2>
          <p class="text-sm text-gray-500">{{ currentFormattedDate }}</p>
        </div>

        <div class="grid grid-cols-3 gap-2 mb-4">
          <div class="bg-white p-1 rounded-lg shadow text-center">
            <p class="text-xs text-gray-500 uppercase">Todo</p>
            <p class="text-base font-bold text-gray-700">{{ rows.length }}</p>
          </div>
          <div class="bg-white p-1 rounded-lg shadow text-center">
            <p class="text-xs text-gray-500 uppercase">Dentro</p>
            <p class="text-base font-bold text-green-600">{{ clockedInCount }}</p>
          </div>
          <div class="bg-white p-1 rounded-lg shadow text-center">
            <p class="text-xs text-gray-500 uppercase">Fuera</p>
            <p class="text-base font-bold text-red-600">{{ rows.length - clockedInCount }}</p>
          </div>
        </div>

        <div class="mb-4 flex gap-2">
          <input
            v-model="searchTerm"
            type="text"
            aria-label="Buscar empleado"
            placeholder="Buscar un miembro de la organización..."
            class="w-full p-2 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-blue-600 focus:border-transparent"
          />
          <button
            type="button"
            @click="refresh"
            :disabled="activeState.loading"
            class="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-800 text-white text-sm font-medium disabled:opacity-60"
          >
            {{ activeState.loading ? 'Sync...' : 'Actualizar' }}
          </button>
        </div>

        <p v-if="activeState.loading && employees.length === 0" class="text-center py-2">Cargando empleados...</p>
        <p v-if="activeState.error" class="text-red-600 mb-2 text-sm" role="status">{{ activeState.error }}</p>
        <div
          v-if="activeState.actionError"
          class="flex items-start gap-2 mb-2 p-2 rounded-md bg-red-50 text-red-700 text-sm"
          role="alert"
        >
          <span class="flex-1">{{ activeState.actionError }}</span>
          <button type="button" aria-label="Cerrar aviso" class="text-red-700 hover:text-red-900" @click="dismissActionError">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <ul v-if="rows.length > 0" class="space-y-2">
          <li
            v-for="(emp, index) in rows"
            :key="emp.id"
            class="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow"
          >
            <div class="flex items-center">
              <div :class="['flex-shrink-0 h-8 w-8 rounded-full text-white flex items-center justify-center text-xs font-semibold mr-3', avatarColors[index % avatarColors.length]]">
                {{ getInitials(emp.name) }}
              </div>
              <div>
                <span class="font-medium text-gray-800 text-sm">{{ emp.name }}</span>
                <span class="text-xs text-gray-500 block">{{ emp.isPaused ? 'En pausa' : (emp.isClockedIn ? 'Fichado' : 'Sin fichar') }}</span>
              </div>
            </div>

            <div class="flex items-center">
              <span class="text-xs text-gray-600 mr-3">{{ emp.tracked }}</span>
              <button
                v-if="emp.isClockedIn"
                type="button"
                @click="clock(emp, emp.isPaused ? 'unpause' : 'pause')"
                :disabled="emp.busy"
                :class="[
                  'w-20 h-8 mr-2 flex items-center justify-center rounded-md text-xs font-medium transition-colors disabled:opacity-60',
                  emp.isPaused ? 'bg-sky-200 hover:bg-sky-300 text-sky-900' : 'bg-slate-200 hover:bg-slate-300 text-slate-800'
                ]"
              >
                {{ emp.busy ? '...' : (emp.isPaused ? 'Reanudar' : 'Pausa') }}
              </button>
              <button
                type="button"
                @click="clock(emp, emp.isClockedIn ? 'clock-out' : 'clock-in')"
                :disabled="emp.busy"
                :class="[
                  'w-20 h-8 flex items-center justify-center rounded-md text-xs font-medium transition-colors disabled:opacity-60',
                  emp.isClockedIn ? 'bg-yellow-400 hover:bg-yellow-500 text-yellow-900' : 'bg-green-600 hover:bg-green-700 text-white'
                ]"
              >
                {{ emp.busy ? '...' : (emp.isClockedIn ? 'Salida' : 'Entrada') }}
              </button>
            </div>
          </li>
        </ul>

        <p v-if="rows.length === 0 && searchTerm" class="text-center text-gray-500 py-2">
          No se encontraron empleados con "{{ searchTerm }}".
        </p>
        <p
          v-if="employees.length === 0 && !activeState.loading && !activeState.error && !searchTerm"
          class="text-center text-gray-500 py-2"
        >
          No se encontraron empleados. Verifica la configuración o el token.
        </p>
        <p
          v-if="visibleEmployees.length === 0 && employees.length > 0 && !searchTerm"
          class="text-center text-gray-500 py-2"
        >
          Todos los empleados están ocultos. Ajusta la configuración para verlos.
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
button:disabled {
  cursor: not-allowed;
}

.fixed.inset-0.bg-black.bg-opacity-50 {
  transition: opacity 0.3s ease-in-out;
}
</style>
