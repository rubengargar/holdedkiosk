<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  clockIn,
  clockOut,
  getEmployeeDashboard,
  pauseEmployee,
  unpauseEmployee,
  type EmployeeDashboard
} from './api'

type LoadingAction = 'clock' | 'pause' | null

interface Employee extends EmployeeDashboard {
  loadingAction: LoadingAction
}

const tokenInput = ref('')
const configuredToken = ref<string | null>(null)
const employees = ref<Employee[]>([])
const loading = ref(false)
const refreshing = ref(false)
const error = ref('')

const kioskTitle = ref(localStorage.getItem('kiosk_title') || 'Portal de fichado')
const searchTerm = ref('')
const showSettingsPanel = ref(false)
const hiddenEmployeeIds = ref<Set<string>>(new Set(JSON.parse(localStorage.getItem('hidden_employee_ids') || '[]')))
const currentDate = ref(new Date())

const avatarColors = [
  'bg-sky-500', 'bg-emerald-500', 'bg-rose-500',
  'bg-amber-500', 'bg-violet-500', 'bg-lime-500',
  'bg-red-500', 'bg-teal-500', 'bg-fuchsia-500',
  'bg-blue-600', 'bg-orange-500', 'bg-pink-500',
  'bg-green-500', 'bg-indigo-500', 'bg-yellow-500',
  'bg-purple-500', 'bg-cyan-500'
]

let clockIntervalId: number | undefined
let refreshIntervalId: number | undefined

const greeting = computed(() => (currentDate.value.getHours() < 12 ? 'Buenos días' : 'Buenas tardes'))

const currentFormattedDate = computed(() => {
  return currentDate.value.toLocaleDateString('es-ES', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
})

const visibleEmployees = computed(() => {
  return employees.value.filter(emp => !hiddenEmployeeIds.value.has(emp.id))
})

const filteredAndVisibleEmployees = computed(() => {
  return visibleEmployees.value.filter(emp =>
    emp.name.toLowerCase().includes(searchTerm.value.toLowerCase())
  )
})

const totalVisibleEmployees = computed(() => filteredAndVisibleEmployees.value.length)
const clockedInCount = computed(() => filteredAndVisibleEmployees.value.filter(emp => emp.isClockedIn).length)
const clockedOutCount = computed(() => filteredAndVisibleEmployees.value.filter(emp => !emp.isClockedIn).length)

function getInitials(name: string) {
  if (!name) return '??'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase()
}

function toggleSettingsPanel() {
  showSettingsPanel.value = !showSettingsPanel.value
}

function toggleEmployeeVisibility(employeeId: string) {
  if (hiddenEmployeeIds.value.has(employeeId)) {
    hiddenEmployeeIds.value.delete(employeeId)
  } else {
    hiddenEmployeeIds.value.add(employeeId)
  }

  localStorage.setItem('hidden_employee_ids', JSON.stringify(Array.from(hiddenEmployeeIds.value)))
}

function isEmployeeHidden(employeeId: string) {
  return hiddenEmployeeIds.value.has(employeeId)
}

function saveKioskTitle() {
  localStorage.setItem('kiosk_title', kioskTitle.value)
}

function upsertEmployees(nextEmployees: EmployeeDashboard[]) {
  const existingById = new Map(employees.value.map(employee => [employee.id, employee]))

  employees.value = nextEmployees.map((employee) => ({
    ...employee,
    loadingAction: existingById.get(employee.id)?.loadingAction || null
  }))
}

function updateEmployee(updatedEmployee: EmployeeDashboard) {
  employees.value = employees.value.map((employee) =>
    employee.id === updatedEmployee.id
      ? { ...employee, ...updatedEmployee, loadingAction: null }
      : employee
  )
}

async function loadDashboard(forceRefresh = false, silent = false) {
  if (!configuredToken.value) {
    error.value = 'Token no configurado.'
    return
  }

  if (silent) {
    refreshing.value = true
  } else {
    loading.value = true
  }

  error.value = ''

  try {
    const dashboard = await getEmployeeDashboard(forceRefresh)
    upsertEmployees(dashboard)
    employees.value.sort((a, b) => a.name.localeCompare(b.name))
  } catch (e: any) {
    error.value = `Error al cargar datos: ${e.message}.`
  } finally {
    if (silent) {
      refreshing.value = false
    } else {
      loading.value = false
    }
  }
}

async function handleTokenSubmission() {
  if (!tokenInput.value.trim()) {
    error.value = 'Introduce un token válido.'
    return
  }

  loading.value = true
  error.value = ''
  const currentTokenToTest = tokenInput.value.trim()
  localStorage.setItem('holded_token', currentTokenToTest)
  configuredToken.value = currentTokenToTest

  try {
    const dashboard = await getEmployeeDashboard(true)
    upsertEmployees(dashboard)
    employees.value.sort((a, b) => a.name.localeCompare(b.name))
    tokenInput.value = ''
  } catch (e: any) {
    error.value = `Token inválido o error de red: ${e.message}`
    localStorage.removeItem('holded_token')
    configuredToken.value = null
    employees.value = []
  } finally {
    loading.value = false
  }
}

async function refreshAllEmployeeStatuses(forceRefresh = false) {
  if (!configuredToken.value || loading.value || refreshing.value) {
    return
  }

  await loadDashboard(forceRefresh, true)
}

async function toggleFichaje(employee: Employee) {
  employee.loadingAction = 'clock'

  try {
    const updatedEmployee = employee.isClockedIn
      ? await clockOut(employee.id)
      : await clockIn(employee.id)
    updateEmployee(updatedEmployee)
  } catch (e: any) {
    employee.loadingAction = null
    alert(`Error al fichar para ${employee.name}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

async function togglePause(employee: Employee) {
  if (!employee.isClockedIn) {
    return
  }

  employee.loadingAction = 'pause'

  try {
    const updatedEmployee = employee.isPaused
      ? await unpauseEmployee(employee.id)
      : await pauseEmployee(employee.id)
    updateEmployee(updatedEmployee)
  } catch (e: any) {
    employee.loadingAction = null
    alert(`Error al actualizar la pausa para ${employee.name}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function clearTokenAndShowForm() {
  localStorage.removeItem('holded_token')
  configuredToken.value = null
  employees.value = []
  error.value = ''
  tokenInput.value = ''
}

onMounted(() => {
  const storedToken = localStorage.getItem('holded_token')
  if (storedToken) {
    configuredToken.value = storedToken
    loadDashboard()
  }

  clockIntervalId = window.setInterval(() => {
    currentDate.value = new Date()
  }, 60000)

  refreshIntervalId = window.setInterval(() => {
    refreshAllEmployeeStatuses()
  }, 1800000)
})

onBeforeUnmount(() => {
  if (clockIntervalId) window.clearInterval(clockIntervalId)
  if (refreshIntervalId) window.clearInterval(refreshIntervalId)
})
</script>

<template>
  <div class="min-h-screen bg-gray-100">
    <div
      v-if="showSettingsPanel"
      class="fixed inset-0 bg-black bg-opacity-50 z-40"
      @click="toggleSettingsPanel"
    ></div>

    <div
      :class="['fixed top-0 right-0 h-full bg-white shadow-xl z-50 transform transition-transform duration-300 ease-in-out w-80 p-6', showSettingsPanel ? 'translate-x-0' : 'translate-x-full']"
    >
      <h3 class="text-xl font-semibold mb-6">Configuración</h3>

      <div class="mb-6">
        <label for="kioskTitleInput" class="block text-sm font-medium text-gray-700 mb-1">Título del Kiosk</label>
        <input
          id="kioskTitleInput"
          v-model="kioskTitle"
          type="text"
          class="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-600 focus:border-blue-600"
          @input="saveKioskTitle"
        />
      </div>

      <h4 class="text-lg font-medium mb-2">Ocultar/Mostrar Usuarios</h4>
      <div class="max-h-60 overflow-y-auto mb-6 border rounded-md p-2">
        <div v-for="emp in employees" :key="`setting-${emp.id}`" class="flex items-center justify-between py-2">
          <span>{{ emp.name }}</span>
          <button
            @click="toggleEmployeeVisibility(emp.id)"
            :class="['px-3 py-1 text-xs rounded', isEmployeeHidden(emp.id) ? 'bg-gray-200 text-gray-700' : 'bg-blue-600 hover:bg-blue-700 text-white']"
          >
            {{ isEmployeeHidden(emp.id) ? 'Mostrar' : 'Ocultar' }}
          </button>
        </div>
        <p v-if="employees.length === 0" class="text-sm text-gray-500">No hay empleados para mostrar.</p>
      </div>

      <h4 class="text-lg font-medium mb-2">Holded Token API</h4>
      <p class="text-sm text-gray-500 mb-2">
        Introduce tu token de API de Holded para cargar los empleados activos. Obtenla en
        <a href="https://developers.holded.com/reference/api-key-1" target="_blank" class="text-blue-500 hover:underline">
          Ajustes &gt; API
        </a>
      </p>
      <button
        @click="() => { clearTokenAndShowForm(); toggleSettingsPanel(); }"
        class="w-full bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded text-sm"
      >
        Cambiar Token de Holded
      </button>

      <button @click="toggleSettingsPanel" class="absolute top-4 right-4 text-gray-500 hover:text-gray-700">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <div class="p-4 max-w-2xl mx-auto">
      <div v-if="!configuredToken">
        <div class="bg-white p-6 rounded-lg shadow-md">
          <h2 class="text-2xl font-bold mb-4 text-center text-gray-700">Configura tu Kiosk</h2>
          <p class="text-sm text-gray-500 mb-2">
            Introduce tu token de API de Holded para cargar los empleados activos. <br> Obtenla en
            <a href="https://developers.holded.com/reference/api-key-1" target="_blank" class="text-blue-500 hover:underline">
              Ajustes &gt; API
            </a>
          </p>
          <input
            v-model="tokenInput"
            type="password"
            placeholder="Introduce token Holded"
            class="border p-3 mb-3 w-full rounded-md focus:ring-2 focus:ring-blue-600 focus:border-transparent"
            @keyup.enter="handleTokenSubmission"
          />
          <button
            @click="handleTokenSubmission"
            class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-md w-full font-semibold transition-colors"
            :disabled="loading"
          >
            {{ loading && !error ? 'Verificando...' : 'Guardar y Verificar Token' }}
          </button>
          <p v-if="error" class="text-red-600 mt-3 text-sm">{{ error }}</p>
        </div>
      </div>

      <div v-else>
        <header class="flex justify-center items-center mb-3 pt-1">
          <h1 class="text-sm font-medium tracking-wide text-gray-500 text-center uppercase">{{ kioskTitle }}</h1>
          <button @click="toggleSettingsPanel" class="text-gray-600 hover:text-gray-800 absolute right-4 top-4">
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
            <p class="text-base font-bold text-gray-700">{{ totalVisibleEmployees }}</p>
          </div>
          <div class="bg-white p-1 rounded-lg shadow text-center">
            <p class="text-xs text-gray-500 uppercase">Dentro</p>
            <p class="text-base font-bold text-green-600">{{ clockedInCount }}</p>
          </div>
          <div class="bg-white p-1 rounded-lg shadow text-center">
            <p class="text-xs text-gray-500 uppercase">Fuera</p>
            <p class="text-base font-bold text-red-600">{{ clockedOutCount }}</p>
          </div>
        </div>

        <div class="mb-4 flex gap-2">
          <input
            v-model="searchTerm"
            type="text"
            placeholder="Buscar un miembro de la organización..."
            class="w-full p-2 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-blue-600 focus:border-transparent"
          />
          <button
            @click="refreshAllEmployeeStatuses(true)"
            :disabled="refreshing || loading"
            class="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-800 text-white text-sm font-medium disabled:opacity-60"
          >
            {{ refreshing ? 'Sync...' : 'Actualizar' }}
          </button>
        </div>

        <p v-if="loading && employees.length === 0" class="text-center py-2">Cargando empleados...</p>
        <p v-if="error && !loading" class="text-red-600 mt-1 text-sm">{{ error }}</p>

        <ul v-if="!loading && filteredAndVisibleEmployees.length > 0" class="space-y-2">
          <li
            v-for="(emp, index) in filteredAndVisibleEmployees"
            :key="emp.id"
            class="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow"
          >
            <div class="flex items-center">
              <div :class="['flex-shrink-0 h-8 w-8 rounded-full text-white flex items-center justify-center text-xs font-semibold mr-3', avatarColors[index % avatarColors.length]]">
                {{ getInitials(emp.name) }}
              </div>
              <div>
                <span class="font-medium text-gray-800 text-sm">{{ emp.name }}</span>
                <span class="text-xs text-gray-500 block">
                  {{ emp.isPaused ? 'En pausa' : (emp.isClockedIn ? 'Fichado' : 'Sin fichar') }}
                </span>
              </div>
            </div>

            <div class="flex items-center">
              <span class="text-xs text-gray-600 mr-3">{{ emp.trackedTimeToday }}</span>
              <button
                @click="togglePause(emp)"
                :disabled="!!emp.loadingAction || !emp.isClockedIn"
                :class="[
                  'w-20 h-8 mr-2 flex items-center justify-center rounded-md text-xs font-medium transition-colors disabled:opacity-60',
                  emp.isPaused ? 'bg-sky-200 hover:bg-sky-300 text-sky-900' : 'bg-slate-200 hover:bg-slate-300 text-slate-800'
                ]"
              >
                {{ emp.loadingAction === 'pause' ? '...' : (emp.isPaused ? 'Reanudar' : 'Pausa') }}
              </button>
              <button
                @click="toggleFichaje(emp)"
                :disabled="!!emp.loadingAction"
                :class="[
                  'w-20 h-8 flex items-center justify-center rounded-md text-xs font-medium transition-colors disabled:opacity-60',
                  emp.isClockedIn ? 'bg-yellow-400 hover:bg-yellow-500 text-yellow-900' : 'bg-green-600 hover:bg-green-700 text-white'
                ]"
              >
                {{ emp.loadingAction === 'clock' ? '...' : (emp.isClockedIn ? 'Salida' : 'Entrada') }}
              </button>
            </div>
          </li>
        </ul>

        <p v-if="!loading && filteredAndVisibleEmployees.length === 0 && configuredToken && searchTerm" class="text-center text-gray-500 py-2">
          No se encontraron empleados con "{{ searchTerm }}".
        </p>
        <p v-if="!loading && employees.length === 0 && !error && configuredToken && !searchTerm" class="text-center text-gray-500 py-2">
          No se encontraron empleados. Verifica la configuración o el token.
        </p>
        <p v-if="!loading && visibleEmployees.length === 0 && employees.length > 0 && !error && configuredToken" class="text-center text-gray-500 py-2">
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
