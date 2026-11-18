<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { Account } from './accounts'
import type { Employee } from './api'
import AccountAvatar from './AccountAvatar.vue'
import AddAccountForm from './AddAccountForm.vue'
import ChangeTokenForm from './ChangeTokenForm.vue'

const props = defineProps<{
  open: boolean
  accounts: Account[]
  activeId: string | null
  employees: Employee[]
  kioskTitle: string
  addAccount: (name: string, token: string) => Promise<void>
  changeToken: (id: string, token: string) => Promise<void>
  refreshInfo: (id: string) => Promise<boolean>
}>()

const emit = defineEmits<{
  close: []
  select: [id: string]
  rename: [id: string, name: string]
  toggleHidden: [employeeId: string]
  delete: [id: string]
  'update:kioskTitle': [title: string]
}>()

const view = ref<'company' | 'add'>('company')
const confirmingDelete = ref(false)
const infoStatus = ref<'idle' | 'busy' | 'failed'>('idle')
const addButton = ref<HTMLButtonElement | null>(null)
const addView = ref<HTMLElement | null>(null)

const activeAccount = computed(() => props.accounts.find(a => a.id === props.activeId) ?? null)
const hiddenIds = computed(() => new Set(activeAccount.value?.hiddenEmployeeIds ?? []))

function select(id: string) {
  view.value = 'company'
  emit('select', id)
}

async function openAdd() {
  view.value = 'add'
  await nextTick()
  addView.value?.querySelector('input')?.focus()
}

async function cancelAdd() {
  view.value = 'company'
  await nextTick()
  addButton.value?.focus()
}

async function onAdd(name: string, token: string) {
  await props.addAccount(name, token)
  view.value = 'company'
}

function onRename(id: string, event: Event) {
  const input = event.target as HTMLInputElement
  emit('rename', id, input.value)
  input.value = props.accounts.find(a => a.id === id)?.name ?? ''
}

async function onRefreshInfo(id: string) {
  infoStatus.value = 'busy'
  infoStatus.value = (await props.refreshInfo(id)) ? 'idle' : 'failed'
}

function onDelete(id: string) {
  confirmingDelete.value = false
  emit('delete', id)
}

watch(
  () => props.activeId,
  () => {
    confirmingDelete.value = false
    infoStatus.value = 'idle'
  }
)

watch(
  () => props.open,
  open => {
    if (!open) view.value = 'company'
  }
)
</script>

<template>
  <div
    :class="['fixed top-0 right-0 h-full bg-white shadow-xl z-50 transform transition-transform duration-300 ease-in-out w-80 p-6 overflow-y-auto', open ? 'translate-x-0' : 'translate-x-full']"
  >
    <h3 class="text-xl font-semibold mb-4">Configuración</h3>

    <div class="flex flex-wrap items-center gap-2 mb-6">
      <div role="tablist" aria-label="Empresas" class="contents">
        <button
          v-for="account in accounts"
          :key="account.id"
          type="button"
          role="tab"
          :aria-selected="view === 'company' && account.id === activeId"
          :title="account.name"
          :class="[
            'flex min-h-10 min-w-0 max-w-full items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm',
            view === 'company' && account.id === activeId
              ? 'bg-blue-50 text-gray-900 ring-[3px] ring-inset ring-blue-600'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          ]"
          @click="select(account.id)"
        >
          <span class="h-8 w-8 flex-shrink-0"><AccountAvatar :account="account" /></span>
          <span class="truncate">{{ account.name }}</span>
        </button>
        <button
          ref="addButton"
          type="button"
          role="tab"
          aria-label="Añadir empresa"
          title="Añadir empresa"
          :aria-selected="view === 'add'"
          :class="[
            'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full',
            view === 'add' ? 'bg-blue-600 text-white ring-[3px] ring-inset ring-blue-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          ]"
          @click="openAdd"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </button>
      </div>
    </div>

    <section v-if="view === 'add'" ref="addView" aria-label="Añadir empresa">
      <h4 class="text-lg font-semibold text-gray-800 mb-2">Añadir empresa</h4>
      <p class="text-sm text-gray-500 mb-3">
        Obtén el token en
        <a href="https://developers.holded.com/reference/api-key-1" target="_blank" class="text-blue-500 hover:underline">
          Ajustes &gt; API
        </a>
      </p>
      <AddAccountForm id-prefix="settings" submit-label="Añadir empresa" :submit="onAdd" />
      <button
        type="button"
        class="mt-3 min-h-10 w-full px-3 py-2 text-sm rounded bg-gray-200 hover:bg-gray-300 text-gray-800"
        @click="cancelAdd"
      >
        Cancelar
      </button>
    </section>

    <template v-else>
      <section v-if="activeAccount" :key="activeAccount.id" aria-label="Configuración de la empresa" class="mb-6">

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
              @click="emit('toggleHidden', emp.id)"
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
            @click="onDelete(activeAccount.id)"
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
          :value="kioskTitle"
          type="text"
          class="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-600 focus:border-blue-600"
          @input="emit('update:kioskTitle', ($event.target as HTMLInputElement).value)"
        />
      </section>
    </template>

    <button
      type="button"
      aria-label="Cerrar configuración"
      @click="emit('close')"
      class="absolute top-4 right-4 text-gray-500 hover:text-gray-700"
    >
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  </div>
</template>
