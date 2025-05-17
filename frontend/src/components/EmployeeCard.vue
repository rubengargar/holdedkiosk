<template>
  <div>
    <h1>Panel de Fichaje</h1>
    <div v-if="loading">Cargando empleados...</div>
    <div v-else>
      <div v-for="emp in employees" :key="emp.id" class="employee-card">
        <span>{{ emp.name }}</span>
        <button @click="toggleFichaje(emp)" :disabled="emp.loading">
          {{ emp.isClockedIn ? 'Fichar salida' : 'Fichar entrada' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { getEmployees, getEmployeeTimes, clockIn, clockOut } from '../api'

interface Employee {
  id: string
  name: string
  isClockedIn: boolean
  loading: boolean
}

const employees = ref<Employee[]>([])
const loading = ref(true)

async function fetchEmployeeStatus(employee: Employee) {
  try {
    const timesData = await getEmployeeTimes(employee.id)
    // timesData puede ser un array de registros de fichajes.
    // Por ejemplo, buscamos si hay algún registro abierto (sin clock-out)
    // Según docs: cada registro puede tener clockIn y clockOut timestamps

    const hasActiveClockIn = timesData.data.some((t: any) => !t.clockOut)
    employee.isClockedIn = hasActiveClockIn
  } catch {
    employee.isClockedIn = false
  }
}

async function loadEmployees() {
  loading.value = true
  try {
    const emps = await getEmployees()
    employees.value = emps.map((e: any) => ({
      id: e.id,
      name: e.name || e.fullName || e.firstName || 'Empleado',
      isClockedIn: false,
      loading: false
    }))

    // Por cada empleado, consultamos estado de fichaje
    await Promise.all(employees.value.map(e => fetchEmployeeStatus(e)))
  } catch (e) {
    console.error('Error cargando empleados', e)
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
  } catch (e) {
    alert(`Error al fichar: ${e.message}`)
  } finally {
    employee.loading = false
  }
}

onMounted(loadEmployees)
</script>

<style scoped>
.employee-card {
  margin-bottom: 1rem;
}
button {
  margin-left: 1rem;
}
</style>
