<script setup lang="ts">
import { ref, onMounted, computed } from 'vue' // Added computed
import { getEmployees, getEmployeeTimes, clockIn, clockOut } from './api'


interface Employee {
  id: string
  name: string
  isClockedIn: boolean
  loading: boolean;
  trackedTimeToday: string;
}

const tokenInput = ref('')
const configuredToken = ref<string | null>(null)
const employees = ref<Employee[]>([])
const loading = ref(false)
const error = ref('')

const kioskTitle = ref(localStorage.getItem('kiosk_title') || 'Portal de fichado'); // AÑADIDO: Título del Kiosk

// AÑADIDO: Lista de colores para los avatares (reorganizada para mayor aleatoriedad)
const avatarColors = [
  'bg-sky-500', 'bg-emerald-500', 'bg-rose-500', 
  'bg-amber-500', 'bg-violet-500', 'bg-lime-500', 
  'bg-red-500', 'bg-teal-500', 'bg-fuchsia-500', 
  'bg-blue-600', 'bg-orange-500', 'bg-pink-500', 
  'bg-green-500', 'bg-indigo-500', 'bg-yellow-500', 
  'bg-purple-500', 'bg-cyan-500'
];

const searchTerm = ref('');
const showSettingsPanel = ref(false);
const hiddenEmployeeIds = ref<Set<string>>(new Set(JSON.parse(localStorage.getItem('hidden_employee_ids') || '[]')));
const currentDate = ref(new Date());

console.log('Script setup: Initializing refs')


const greeting = computed(() => {
  const hour = currentDate.value.getHours();
  if (hour < 12) {
    return 'Buenos días';
  } else {
    return 'Buenas tardes';
  }
});

const currentFormattedDate = computed(() => {
  return currentDate.value.toLocaleDateString('es-ES', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
});

const getInitials = (name: string) => {
  if (!name) return '??';
  const parts = name.split(' ');
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + (parts[parts.length - 1][0] || '')).toUpperCase();
};

const visibleEmployees = computed(() => {
  return employees.value.filter(emp => !hiddenEmployeeIds.value.has(emp.id));
});

const filteredAndVisibleEmployees = computed(() => {
  return visibleEmployees.value.filter(emp =>
    emp.name.toLowerCase().includes(searchTerm.value.toLowerCase())
  );
});

const totalVisibleEmployees = computed(() => filteredAndVisibleEmployees.value.length);
const clockedInCount = computed(() => filteredAndVisibleEmployees.value.filter(emp => emp.isClockedIn).length);
const clockedOutCount = computed(() => filteredAndVisibleEmployees.value.filter(emp => !emp.isClockedIn).length);


const toggleSettingsPanel = () => {
  showSettingsPanel.value = !showSettingsPanel.value;
};

const toggleEmployeeVisibility = (employeeId: string) => {
  if (hiddenEmployeeIds.value.has(employeeId)) {
    hiddenEmployeeIds.value.delete(employeeId);
  } else {
    hiddenEmployeeIds.value.add(employeeId);
  }
  localStorage.setItem('hidden_employee_ids', JSON.stringify(Array.from(hiddenEmployeeIds.value)));
};

const isEmployeeHidden = (employeeId: string) => {
  return hiddenEmployeeIds.value.has(employeeId);
};

const saveKioskTitle = () => { 
  localStorage.setItem('kiosk_title', kioskTitle.value);
};

async function fetchEmployeeStatus(employee: Employee) {
  console.log(`fetchEmployeeStatus: Fetching status for employee ${employee.id}`)
  try {
    const timesResponse = await getEmployeeTimes(employee.id);
    const timeEntries = timesResponse?.employeesTimeTracking;

    let isActiveClockInToday = false;
    let totalTrackedMsToday = 0;
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);

    if (timeEntries && Array.isArray(timeEntries)) {
      for (const entry of timeEntries) {
        const clockInTimestamp = entry.start * 1000;
        const clockInDate = new Date(clockInTimestamp);
        clockInDate.setHours(0, 0, 0, 0);

        if (clockInDate.getTime() === todayDate.getTime()) {
          let clockOutTimestamp;
          if (entry.end === 0 || entry.status === 'running') {
            isActiveClockInToday = true;
            clockOutTimestamp = Date.now();
          } else {
            clockOutTimestamp = entry.end * 1000;
          }
          totalTrackedMsToday += (clockOutTimestamp - clockInTimestamp);
        }
      }
    }
    
    employee.isClockedIn = isActiveClockInToday;
    console.log(`fetchEmployeeStatus: Status for ${employee.id} - isClockedIn: ${employee.isClockedIn}`)

    const hours = Math.floor(totalTrackedMsToday / (1000 * 60 * 60));
    const minutes = Math.floor((totalTrackedMsToday % (1000 * 60 * 60)) / (1000 * 60));
    employee.trackedTimeToday = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    console.log(`fetchEmployeeStatus: Tracked time today for ${employee.id}: ${employee.trackedTimeToday}`);

  } catch (err) {
    console.error(`fetchEmployeeStatus: Error fetching status for employee ${employee.id}:`, err)
    employee.isClockedIn = false
    employee.trackedTimeToday = 'Error';
  }
}

async function refreshAllEmployeeStatuses() {
  if (!configuredToken.value || loading.value || visibleEmployees.value.length === 0) {
    // No refrescar si no hay token, si hay una carga inicial en progreso,
    // o si no hay empleados visibles.
    return;
  }

  // Crear promesas para actualizar el estado de cada empleado visible.
  // visibleEmployees ya está filtrado para no incluir empleados ocultos.
  const refreshPromises = visibleEmployees.value.map(emp => fetchEmployeeStatus(emp));

  try {
    await Promise.all(refreshPromises);
  } catch (err) {
    console.error("Error during periodic refresh of employee statuses:", err);
    // Opcionalmente, se podría mostrar un error no intrusivo al usuario.
  }
}

async function loadDataForConfiguredToken() {
  if (!configuredToken.value) {
    error.value = 'Token no configurado.'
    console.log('loadDataForConfiguredToken: No configured token, returning.')
    return
  }
  console.log('loadDataForConfiguredToken: Loading data with token', configuredToken.value)
  loading.value = true
  error.value = ''
  // No limpiamos employees.value aquí para que la UI no parpadee si es un error temporal
  // y los datos anteriores aún son visibles. Se limpiarán si la carga es exitosa con nuevos datos.

  try {
    const emps = await getEmployees()
    console.log('loadDataForConfiguredToken: getEmployees() succeeded. Response:', emps)

    if (emps && emps.length > 0) {
      const activeEmployees = emps.filter(e => {
        const isTerminated = e.terminated !== null && e.terminated !== undefined && e.terminated !== '';
        const hasValidContract = e.currentContract && typeof e.currentContract === 'object' && !Array.isArray(e.currentContract);
        return !isTerminated && hasValidContract;
      });
      console.log('loadDataForConfiguredToken: Active employees after filter:', activeEmployees);
      
      employees.value = activeEmployees.map((e: any) => ({
        id: e.id,
        name: `${e.name || ''} ${e.lastName || ''}`.trim() || 'Empleado Desconocido',
        isClockedIn: false,
        loading: false,
        trackedTimeToday: '00:00'
      }))
      await Promise.all(employees.value.map(emp => fetchEmployeeStatus(emp)))
      employees.value.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      console.log('loadDataForConfiguredToken: No employees found or empty response.')
      employees.value = [] // Limpiar si la respuesta es vacía pero exitosa
    }
  } catch (e: any) {
    // MODIFICADO: No eliminamos el token aquí si ya estaba configurado.
    // Esto permite reintentos si fue un error de red temporal.
    // El usuario puede cambiar el token manualmente si es realmente incorrecto.
    error.value = `Error al cargar datos: ${e.message}. Verifique su conexión o el token.`;
    console.error('Error in loadDataForConfiguredToken:', e)
    // No limpiamos configuredToken.value ni localStorage aquí.
    // employees.value no se limpia para mantener los datos anteriores si es un error temporal.
  } finally {
    loading.value = false
    console.log('loadDataForConfiguredToken: Finished loading.')
  }
}

async function handleTokenSubmission() {
  console.log('handleTokenSubmission: Called. Current tokenInput:', tokenInput.value)
  if (!tokenInput.value.trim()) {
    error.value = 'Introduce un token válido.'
    console.log('handleTokenSubmission: Token input is empty.')
    return
  }

  loading.value = true
  error.value = ''
  const currentTokenToTest = tokenInput.value.trim()
  
  // Guardamos temporalmente en localStorage para probarlo
  localStorage.setItem('holded_token', currentTokenToTest)
  console.log('handleTokenSubmission: localStorage set with token for testing:', currentTokenToTest)
  
  try {
    console.log('handleTokenSubmission: Calling getEmployees() to validate token.')
    const emps = await getEmployees() 
    console.log('handleTokenSubmission: getEmployees() succeeded for validation. Response:', emps)
    
    // Si getEmployees() es exitoso, el token es válido y lo configuramos permanentemente.
    configuredToken.value = currentTokenToTest 
    
    if (emps && emps.length > 0) {
      const activeEmployees = emps.filter(e => {
        const isTerminated = e.terminated !== null && e.terminated !== undefined && e.terminated !== '';
        const hasValidContract = e.currentContract && typeof e.currentContract === 'object' && !Array.isArray(e.currentContract);
        return !isTerminated && hasValidContract; 
      });
      console.log('handleTokenSubmission: Active employees after filter:', activeEmployees);

      employees.value = activeEmployees.map((e: any) => ({
        id: e.id,
        name: `${e.name || ''} ${e.lastName || ''}`.trim() || 'Empleado Desconocido',
        isClockedIn: false,
        loading: false,
        trackedTimeToday: '00:00'
      }))
      await Promise.all(employees.value.map(emp => fetchEmployeeStatus(emp)))
      employees.value.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      console.log('handleTokenSubmission: No employees found after token validation, but token seems valid.')
      employees.value = []
    }
    
    tokenInput.value = '' // Limpiar input solo si el token es válido
  } catch (e: any) {
    error.value = `Token inválido o error de red: ${e.message}`
    console.error('Error in handleTokenSubmission (getEmployees failed for validation):', e)
    // Si falla la validación del NUEVO token, lo eliminamos de localStorage y reseteamos configuredToken.
    localStorage.removeItem('holded_token')
    configuredToken.value = null
    employees.value = []
  } finally {
    loading.value = false
    console.log('handleTokenSubmission: Finished.')
  }
}

async function toggleFichaje(employee: Employee) {
  console.log(`toggleFichaje: Called for employee ${employee.name}, current state: ${employee.isClockedIn ? 'ClockedIn' : 'ClockedOut'}`)
  employee.loading = true
  try {
    if (employee.isClockedIn) {
      await clockOut(employee.id)
      employee.isClockedIn = false
      console.log(`toggleFichaje: ${employee.name} clocked out.`)
    } else {
      await clockIn(employee.id)
      employee.isClockedIn = true
      console.log(`toggleFichaje: ${employee.name} clocked in.`)
    }
    // Después de fichar, actualizamos el estado y el tiempo trackeado
    await fetchEmployeeStatus(employee);
  } catch (e: any) {
    alert(`Error al fichar para ${employee.name}: ${(e instanceof Error ? e.message : String(e))}`)
    console.error(`toggleFichaje: Error for ${employee.name}`, e)
  } finally {
    employee.loading = false
  }
}

function clearTokenAndShowForm() {
  console.log('clearTokenAndShowForm: Clearing token and resetting UI.')
  localStorage.removeItem('holded_token')
  configuredToken.value = null
  employees.value = []
  error.value = ''
  tokenInput.value = ''
}

onMounted(() => {
  console.log('onMounted: Component mounted.')
  const storedToken = localStorage.getItem('holded_token')
  console.log('onMounted: Token from localStorage:', storedToken)
  if (storedToken) {
    configuredToken.value = storedToken
    console.log('onMounted: configuredToken set from localStorage. Attempting to load data.')
    loadDataForConfiguredToken()
  } else {
    console.log('onMounted: No token found in localStorage.')
  }
  // Actualizar la hora cada minuto
  setInterval(() => {
    currentDate.value = new Date();
  }, 60000);
  // Refresco automático de estados de empleados cada 2 minutos
  setInterval(() => {
    refreshAllEmployeeStatuses();
  }, 120000); // 120,000 ms = 2 minutos
})
</script>

<template>
  <div class="min-h-screen bg-gray-100">
    <!-- Panel de Configuración Lateral -->
    <div 
      v-if="showSettingsPanel" 
      class="fixed inset-0 bg-black bg-opacity-50 z-40"
      @click="toggleSettingsPanel"
    ></div>
    <div 
      :class="['fixed top-0 right-0 h-full bg-white shadow-xl z-50 transform transition-transform duration-300 ease-in-out w-80 p-6', showSettingsPanel ? 'translate-x-0' : 'translate-x-full']"
    >
      <h3 class="text-xl font-semibold mb-6">Configuración</h3>
      
      <!-- AÑADIDO: Configuración del título del Kiosk -->
      <div class="mb-6"> 
        <label for="kioskTitleInput" class="block text-sm font-medium text-gray-700 mb-1">Título del Kiosk</label>
        <input 
          type="text" 
          id="kioskTitleInput"
          v-model="kioskTitle" 
          @input="saveKioskTitle" 
          class="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-600 focus:border-blue-600"
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
          Ajustes > API
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

    <!-- Contenido Principal -->
    <div class="p-4 max-w-2xl mx-auto">
      <div v-if="!configuredToken">
        <div class="bg-white p-6 rounded-lg shadow-md">
          <h2 class="text-2xl font-bold mb-4 text-center text-gray-700">Configura tu Kiosk</h2>
            <p class="text-sm text-gray-500 mb-2">
          Introduce tu token de API de Holded para cargar los empleados activos. <br> Obtenla en
          <a href="https://developers.holded.com/reference/api-key-1" target="_blank" class="text-blue-500 hover:underline">
            Ajustes > API
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
        <!-- Cabecera -->
        <header class="flex justify-center items-center mb-4 pt-1"> <!-- MODIFICADO: justify-between a justify-center, mb-6 a mb-4, pt-2 a pt-1 -->
          <h1 class="text-xl font-bold text-gray-800 text-center">{{ kioskTitle }}</h1> <!-- MODIFICADO: text-2xl a text-xl, añadido text-center -->
          <button @click="toggleSettingsPanel" class="text-gray-600 hover:text-gray-800 absolute right-4 top-4"> <!-- MODIFICADO: Posicionamiento absoluto para el botón de config -->
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6"> <!-- MODIFICADO: w-7 h-7 a w-6 h-6 -->
              <path stroke-linecap="round" stroke-linejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.108 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.45.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.78.93l-.15.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.149-.894c-.07-.424-.384-.764-.78-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.506-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.107-1.204l-.527-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.93l.15-.894z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </header>

        <!-- Saludo y Fecha -->
        <div class="mb-4 p-3 bg-white rounded-lg shadow text-center"> <!-- MODIFICADO: mb-6 a mb-4, p-4 a p-3, añadido text-center -->
          <h2 class="text-2xl font-semibold text-gray-700">{{ greeting }}</h2> <!-- MODIFICADO: text-3xl a text-2xl -->
          <p class="text-sm text-gray-500">{{ currentFormattedDate }}</p> <!-- MODIFICADO: quitado text-gray-500, añadido text-sm -->
        </div>
        
        <!-- Buscador -->
        <div class="mb-4"> <!-- MODIFICADO: mb-6 a mb-4 -->
          <input 
            v-model="searchTerm"
            type="text"
            placeholder="Buscar un miembro de la organización..."
            class="w-full p-2 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-blue-600 focus:border-transparent" 
          /> <!-- MODIFICADO: p-3 a p-2 (comment moved here) -->
        </div>

        <!-- Resumen de Fichajes -->
        <div class="grid grid-cols-3 gap-2 mb-4"> <!-- MODIFICADO: gap-3 a gap-2, mb-6 a mb-4 -->
          <div class="bg-white p-1 rounded-lg shadow text-center"> <!-- MODIFICADO: p-2 a p-1 -->
            <p class="text-xs text-gray-500 uppercase">Todo</p>
            <p class="text-base font-bold text-gray-700">{{ totalVisibleEmployees }}</p> <!-- MODIFICADO: text-xl a text-base -->
          </div>
          <div class="bg-white p-1 rounded-lg shadow text-center"> <!-- MODIFICADO: p-2 a p-1 -->
            <p class="text-xs text-gray-500 uppercase">Dentro</p>
            <p class="text-base font-bold text-green-600">{{ clockedInCount }}</p> <!-- MODIFICADO: text-xl a text-base -->
          </div>
          <div class="bg-white p-1 rounded-lg shadow text-center"> <!-- MODIFICADO: p-2 a p-1 -->
            <p class="text-xs text-gray-500 uppercase">Fuera</p>
            <p class="text-base font-bold text-red-600">{{ clockedOutCount }}</p> <!-- MODIFICADO: text-xl a text-base -->
          </div>
        </div>
        
        <p v-if="loading && employees.length === 0" class="text-center py-2">Cargando empleados...</p> <!-- MODIFICADO: py-4 a py-2 -->
        <p v-if="error && !loading" class="text-red-600 mt-1 text-sm">{{ error }}</p> <!-- MODIFICADO: mt-2 a mt-1 -->

        <ul v-if="!loading && filteredAndVisibleEmployees.length > 0" class="space-y-2"> <!-- MODIFICADO: space-y-3 a space-y-2 -->
          <li v-for="(emp, index) in filteredAndVisibleEmployees" :key="emp.id" 
              class="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow"> <!-- MODIFICADO: p-4 a p-3 -->
            <div class="flex items-center">
              <div :class="['flex-shrink-0 h-8 w-8 rounded-full text-white flex items-center justify-center text-xs font-semibold mr-3', avatarColors[index % avatarColors.length]]"> <!-- MODIFICADO: Color de avatar dinámico y se mantiene bg-blue-600 como fallback si algo falla o para el panel de config -->
                {{ getInitials(emp.name) }}
              </div>
              <div>
                <span class="font-medium text-gray-800 text-sm">{{ emp.name }}</span> <!-- MODIFICADO: añadido text-sm -->
                <!-- ELIMINADO: <span class="text-xs text-gray-500 block">Hoy: {{ emp.trackedTimeToday }}</span> -->
              </div>
            </div>
            <div class="flex items-center"> <!-- AÑADIDO: Contenedor para tiempo y botón -->
              <span class="text-xs text-gray-600 mr-3">{{ emp.trackedTimeToday }}</span> <!-- AÑADIDO: Tiempo fichado -->
              <button
                @click="toggleFichaje(emp)"
                :disabled="emp.loading"
                :class="[
                  'w-20 h-8 flex items-center justify-center rounded-md text-xs font-medium transition-colors disabled:opacity-60', // MODIFICADO: Ancho y alto fijos, flex para centrar
                  emp.isClockedIn ? 'bg-yellow-400 hover:bg-yellow-500 text-yellow-900' : 'bg-green-600 hover:bg-green-700 text-white'
                ]"
              >
                {{ emp.loading ? '...' : (emp.isClockedIn ? 'Salida' : 'Entrada') }} <!-- MODIFICADO: Textos más cortos -->
              </button>
            </div>
          </li>
        </ul>
        <p v-if="!loading && filteredAndVisibleEmployees.length === 0 && configuredToken && searchTerm" class="text-center text-gray-500 py-2"> <!-- MODIFICADO: py-4 a py-2 -->
          No se encontraron empleados con "{{ searchTerm }}".
        </p>
        <p v-if="!loading && employees.length === 0 && !error && configuredToken && !searchTerm" class="text-center text-gray-500 py-2"> <!-- MODIFICADO: py-4 a py-2 -->
          No se encontraron empleados. Verifica la configuración o el token.
        </p>
         <p v-if="!loading && visibleEmployees.length === 0 && employees.length > 0 && !error && configuredToken" class="text-center text-gray-500 py-2"> <!-- MODIFICADO: py-4 a py-2 -->
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


.fixed.inset-0.bg-black.bg-opacity-50 { /* Overlay */
  transition: opacity 0.3s ease-in-out;
}
</style>
