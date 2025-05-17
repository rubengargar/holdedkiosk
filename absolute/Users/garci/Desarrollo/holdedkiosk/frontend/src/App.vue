<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { getEmployees, getEmployeeTimes, clockIn, clockOut } from './api'

interface Employee {
  id: string
  name: string
  isClockedIn: boolean
  loading: boolean
  // statusError?: string; // Opcional: para errores por empleado
}

const tokenInput = ref('') // Para el campo de entrada del token
const configuredToken = ref<string | null>(localStorage.getItem('holded_token')) // Token validado y almacenado

const employees = ref<Employee[]>([])
const loading = ref(false)
const error = ref('') // Para errores generales (token, carga inicial)

async function fetchEmployeeStatus(employee: Employee) {
  try {
    const timesData = await getEmployeeTimes(employee.id)
    const hasActiveClockIn = timesData?.data?.some((t: any) => !t.clockOut)
    employee.isClockedIn = !!hasActiveClockIn
  } catch (err) {
    console.error(`Error fetching status for employee ${employee.id}:`, err)
    employee.isClockedIn = false // Estado por defecto en caso de error
  }
}

async function loadEmployeesWithConfiguredToken() {
  if (!configuredToken.value) {
    error.value = 'Token no configurado.'
    return
  }
  loading.value = true
  error.value = ''
  try {
    // api.ts usa localStorage.getItem('holded_token') internamente
    const emps = await getEmployees()
    employees.value = emps.map((e: any) => ({
      id: e.id,
      name: e.name || e.fullName || e.firstName || 'Empleado Desconocido',
      isClockedIn: false,
      loading: false
    }))
    await Promise.all(employees.value.map(emp => fetchEmployeeStatus(emp)))
  } catch (e: any) {
    error.value = `Error cargando empleados: ${e.message}. Verifique su token.`
    localStorage.removeItem('holded_token') // Limpiar token inválido
    configuredToken.value = null // Actualizar estado para mostrar formulario de token
    employees.value = [] // Limpiar lista de empleados
  } finally {
    loading.value = false
  }
}

async function handleTokenSubmission() {
  if (!tokenInput.value.trim()) {
    error.value = 'Introduce un token válido.'
    return
  }
  loading.value = true
  error.value = ''
  
  // Guardar temporalmente el token para la validación
  localStorage.setItem('holded_token', tokenInput.value.trim())
  
  try {
    // Intentar obtener empleados para validar el token
    const emps = await getEmployees() // Usa el token recién guardado en localStorage
    
    // Si la llamada anterior fue exitosa, el token es válido
    configuredToken.value = tokenInput.value.trim()
    // localStorage ya está actualizado
    
    employees.value = emps.map((e: any) => ({
      id: e.id,
      name: e.name || e.fullName || e.firstName || 'Empleado Desconocido',
      isClockedIn: false,
      loading: false
    }))
    await Promise.all(employees.value.map(emp => fetchEmployeeStatus(emp)))
    
    tokenInput.value = '' // Limpiar campo de entrada
  } catch (e: any) {
    error.value = `Token inválido o error de red: ${e.message}`
    localStorage.removeItem('holded_token') // Limpiar token si la validación falla
    configuredToken.value = null
    employees.value = []
  } finally {
    loading.value = false
  }
}

async function toggleFichaje(employee: Employee) {
  employee.loading = true
  try {
    if (employee.isClockedIn) {
      await clockOut(employee.id)
      employee.isClockedIn = false
    } else {
      await clockIn(employee.id)
      employee.isClockedIn = true
    }
  } catch (e: any) {
    alert(`Error al fichar para ${employee.name}: ${(e instanceof Error ? e.message : String(e))}`)
  } finally {
    employee.loading = false
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
  if (configuredToken.value) {
    loadEmployeesWithConfiguredToken()
  }
})
</script>

<template>
  <div class="p-4 max-w-md mx-auto">
    <div v-if="!configuredToken">
      <h2 class="text-xl mb-2">Configura tu token Holded</h2>
      <input 
        v-model="tokenInput" 
        type="password" 
        placeholder="Introduce token Holded" 
        class="border p-2 mb-2 w-full" 
        @keyup.enter="handleTokenSubmission"
      />
      <button 
        @click="handleTokenSubmission" 
        class="bg-blue-600 text-white px-4 py-2 rounded w-full" 
        :disabled="loading"
      >
        {{ loading ? 'Verificando...' : 'Guardar y Verificar Token' }}
      </button>
      <p v-if="error" class="text-red-600 mt-2">{{ error }}</p>
    </div>

    <div v-else>
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-xl">Panel de Fichaje</h2>
        <button 
          @click="clearTokenAndShowForm" 
          class="bg-gray-500 hover:bg-gray-600 text-white px-3 py-1 rounded text-sm"
        >
          Cambiar Token
        </button>
      </div>
      
      <p v-if="loading">Cargando empleados...</p>
      <p v-if="error && !loading" class="text-red-600">{{ error }}</p>

      <ul v-if="!loading && employees.length > 0">
        <li v-for="emp in employees" :key="emp.id" class="flex justify-between items-center mb-2 p-2 border rounded">
          <span>{{ emp.name }}</span>
          <button
            @click="toggleFichaje(emp)"
            :disabled="emp.loading"
            :class="[emp.isClockedIn ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-green-600 hover:bg-green-700', 'text-white px-3 py-1 rounded disabled:opacity-50']"
          >
            {{ emp.loading ? '...' : (emp.isClockedIn ? 'Fichar salida' : 'Fichar entrada') }}
          </button>
        </li>
      </ul>
      <p v-if="!loading && employees.length === 0 && !error && configuredToken">
        No se encontraron empleados o no se pudo verificar el token.
      </p>
    </div>
  </div>
</template>

<style scoped>
button:disabled {
  cursor: not-allowed;
}
/* Puedes añadir más estilos aquí si es necesario */
</style>