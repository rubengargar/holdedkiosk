// ... existing code ...
const tokenInput = ref('') // Para el campo de entrada del token
const configuredToken = ref<string | null>(localStorage.getItem('holded_token')) // Token validado y almacenado
console.log('Initial configuredToken:', configuredToken.value)

const employees = ref<Employee[]>([])
async function loadEmployeesWithConfiguredToken() {
  if (!configuredToken.value) {
    error.value = 'Token no configurado.'
    console.log('loadEmployeesWithConfiguredToken: configuredToken is null or empty, returning.')
    return
  }
  console.log('loadEmployeesWithConfiguredToken: trying to load with token', configuredToken.value)
  loading.value = true
  try {
    const emps = await getEmployees()
    console.log('getEmployees() succeeded. Response:', emps)
    configuredToken.value = tokenInput.value.trim()
    console.log('configuredToken set to', configuredToken.value)
  } catch (e: any) {
    error.value = `Error cargando empleados: ${e.message}. Verifique su token.`
    console.error('Error in loadEmployeesWithConfiguredToken:', e)
    localStorage.removeItem('holded_token') // Limpiar token inválido
    configuredToken.value = null // Actualizar estado para mostrar formulario de token
    console.log('loadEmployeesWithConfiguredToken: set configuredToken to null due to error.')
    employees.value = [] // Limpiar lista de empleados
  } finally {
    loading.value = false
  }
}

async function handleTokenSubmission() {
  console.log('handleTokenSubmission called. Current tokenInput:', tokenInput.value)
  if (!tokenInput.value.trim()) {
    error.value = 'Introduce un token válido.'
    return
  }
  loading.value = true
  error.value = ''
  
  localStorage.setItem('holded_token', tokenInput.value.trim())
  console.log('handleTokenSubmission: localStorage set with', tokenInput.value.trim())
  
  try {
    console.log('handleTokenSubmission: calling getEmployees()')
    const emps = await getEmployees() 
    console.log('handleTokenSubmission: getEmployees() succeeded. Response:', emps)
    
    configuredToken.value = tokenInput.value.trim()
    console.log('handleTokenSubmission: configuredToken set to', configuredToken.value)
    
  } catch (e: any) {
    error.value = `Token inválido o error de red: ${e.message}`
    console.error('Error in handleTokenSubmission (getEmployees failed):', e)
    localStorage.removeItem('holded_token') 
    configuredToken.value = null
    console.log('handleTokenSubmission: configuredToken set to null due to error.')
    employees.value = []
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  console.log('Component onMounted. configuredToken:', configuredToken.value)
  if (configuredToken.value) {
    loadEmployeesWithConfiguredToken()
  }
})
</script>

<template>
  <div class="p-4 max-w-md mx-auto">
    <!-- {{ console.log('Template rendering. configuredToken:', configuredToken) }} --> <!-- También puedes poner logs en el template para ver cuándo se re-renderiza -->
    <div v-if="!configuredToken">
      <h2 class="text-xl mb-2">Configura tu token Holded</h2>
// ... existing code ...