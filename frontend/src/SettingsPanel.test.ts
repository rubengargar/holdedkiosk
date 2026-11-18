// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import SettingsPanel from './SettingsPanel.vue'

type Kiosk = ReturnType<typeof import('./kiosk').useKiosk>

const reply = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

async function fakeFetch(input: string): Promise<Response> {
  const path = new URL(input).pathname
  if (path === '/api/account') return reply({ name: 'Nueva SL', logoUrl: null })
  if (path === '/api/seal') return reply({ token: 'sealed.new', employees: [{ id: 'e1', name: 'Ana' }] })
  if (path === '/api/employees') return reply([{ id: 'e1', name: 'Ana' }])
  return reply([])
}

function memoryStorage() {
  const items = new Map<string, string>()
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key)
  }
}

let wrappers: VueWrapper[]

async function mountPanel(...ids: string[]) {
  const accounts = ids.map(id => ({ id, name: `Empresa ${id}`, token: `sealed.${id}`, hiddenEmployeeIds: [], logo: null, refreshMinutes: 30 }))
  localStorage.setItem('kiosk_accounts', JSON.stringify(accounts))
  const { useKiosk } = await import('./kiosk')
  let kiosk!: Kiosk
  const wrapper = mount(
    defineComponent({
      setup() {
        kiosk = useKiosk()
        return () =>
          h(SettingsPanel, {
            open: true,
            accounts: kiosk.accounts.value,
            activeId: kiosk.activeId.value,
            employees: kiosk.activeState.value?.employees ?? [],
            kioskTitle: 'Portal',
            addAccount: kiosk.addAccount,
            changeToken: kiosk.changeToken,
            refreshInfo: kiosk.refreshInfo,
            onSelect: kiosk.setActive,
            onRename: kiosk.renameAccount,
            onSetRefresh: kiosk.setRefreshMinutes,
            onToggleHidden: kiosk.toggleHidden,
            onDelete: kiosk.deleteAccount
          })
      }
    }),
    { attachTo: document.body }
  )
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, kiosk: () => kiosk }
}

const tabs = (w: VueWrapper) => w.findAll('[role="tab"]')
const selectedTabs = (w: VueWrapper) => tabs(w).filter(t => t.attributes('aria-selected') === 'true')
const addTab = (w: VueWrapper) => w.get('button[aria-label="Añadir empresa"]')
const companySettings = (w: VueWrapper) => w.find('section[aria-label="Configuración de la empresa"]')

beforeEach(() => {
  vi.stubEnv('VITE_WORKER_BASE', 'https://worker.test')
  vi.resetModules()
  vi.stubGlobal('fetch', fakeFetch)
  vi.stubGlobal('localStorage', memoryStorage())
  wrappers = []
})

afterEach(() => {
  wrappers.forEach(w => w.unmount())
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('settings panel', () => {
  it('lists one selectable tab per company plus the add button, with the active one selected', async () => {
    const { wrapper } = await mountPanel('a', 'b')

    expect(tabs(wrapper)).toHaveLength(3)
    expect(tabs(wrapper).every(t => t.element.tagName === 'BUTTON')).toBe(true)
    expect(selectedTabs(wrapper).map(t => t.attributes('title'))).toEqual(['Empresa a'])
    expect(companySettings(wrapper).exists()).toBe(true)
  })

  it('selecting a company makes it active and shows its settings', async () => {
    const { wrapper, kiosk } = await mountPanel('a', 'b')

    await tabs(wrapper)[1].trigger('click')

    expect(kiosk().activeId.value).toBe('b')
    expect(selectedTabs(wrapper).map(t => t.attributes('title'))).toEqual(['Empresa b'])
    expect((wrapper.get('#accountNameInput').element as HTMLInputElement).value).toBe('Empresa b')
  })

  it('shows the four refresh options with the estimate, and choosing one saves it for that company', async () => {
    const { wrapper, kiosk } = await mountPanel('a', 'b')
    const radios = () => wrapper.findAll('[role="radio"]')

    expect(radios().map(r => r.text())).toEqual(['15 min', '30 min', '60 min', 'Solo manual'])
    expect(radios().filter(r => r.attributes('aria-checked') === 'true').map(r => r.text())).toEqual(['30 min'])
    expect(companySettings(wrapper).text()).toContain('Unas 440 llamadas al mes')

    await radios()[3].trigger('click')

    expect(kiosk().accounts.value.map(a => a.refreshMinutes)).toEqual([0, 30])
    expect(companySettings(wrapper).text()).toContain('Unas 0 llamadas al mes')
    expect(companySettings(wrapper).text()).toContain('unas 22 de la lista de empleados')
  })

  it('the plus button swaps company settings for the add form and focuses its first input', async () => {
    const { wrapper } = await mountPanel('a')

    await addTab(wrapper).trigger('click')

    expect(companySettings(wrapper).exists()).toBe(false)
    expect(wrapper.find('section[aria-label="Kiosko"]').exists()).toBe(false)
    expect(wrapper.get('h4').text()).toBe('Añadir empresa')
    expect(wrapper.text()).toContain('Obtén el token en')
    expect(wrapper.find('#settings-token').exists()).toBe(true)
    expect(selectedTabs(wrapper).map(t => t.attributes('title'))).toEqual(['Añadir empresa'])
    expect(document.activeElement).toBe(wrapper.get('#settings-name').element)
  })

  it('cancel returns to the selected company and focuses the plus button', async () => {
    const { wrapper } = await mountPanel('a')
    await addTab(wrapper).trigger('click')

    const cancel = wrapper.findAll('button').find(b => b.text() === 'Cancelar')!
    await cancel.trigger('click')

    expect(companySettings(wrapper).exists()).toBe(true)
    expect(selectedTabs(wrapper).map(t => t.attributes('title'))).toEqual(['Empresa a'])
    expect(document.activeElement).toBe(addTab(wrapper).element)
  })

  it('selecting a company while adding leaves the add view', async () => {
    const { wrapper, kiosk } = await mountPanel('a', 'b')
    await addTab(wrapper).trigger('click')

    await tabs(wrapper)[1].trigger('click')

    expect(kiosk().activeId.value).toBe('b')
    expect(wrapper.find('#settings-token').exists()).toBe(false)
    expect(selectedTabs(wrapper).map(t => t.attributes('title'))).toEqual(['Empresa b'])
  })

  it('a successful add returns to the company view with the new company selected', async () => {
    const { wrapper, kiosk } = await mountPanel('a')
    await addTab(wrapper).trigger('click')

    await wrapper.get('#settings-token').setValue('new-token')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(kiosk().accounts.value).toHaveLength(2)
    expect(kiosk().activeAccount.value?.name).toBe('Nueva SL')
    expect(companySettings(wrapper).exists()).toBe(true)
    expect(wrapper.find('#settings-token').exists()).toBe(false)
    expect(selectedTabs(wrapper).map(t => t.attributes('title'))).toEqual(['Nueva SL'])
  })

  it('clears the key input as soon as the form is submitted', async () => {
    const { wrapper } = await mountPanel('a')
    let release: () => void = () => {}
    vi.stubGlobal('fetch', () => new Promise<Response>(resolve => (release = () => resolve(reply({ error: 'x' })))))
    await addTab(wrapper).trigger('click')

    await wrapper.get('#settings-token').setValue('key-typed')
    await wrapper.get('form').trigger('submit')

    expect((wrapper.get('#settings-token').element as HTMLInputElement).value).toBe('')
    release()
    await flushPromises()
  })

  it('a failed add stays in the add view', async () => {
    const { wrapper } = await mountPanel('a')
    vi.stubGlobal('fetch', async () => new Response('{"error":"x"}', { status: 401 }))
    await addTab(wrapper).trigger('click')

    await wrapper.get('#settings-token').setValue('bad')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('#settings-token').exists()).toBe(true)
    expect(wrapper.get('[role="alert"]').text()).toContain('Token inválido')
  })

  it('has no always-visible add form in the company view', async () => {
    const { wrapper } = await mountPanel('a')

    expect(wrapper.find('#settings-token').exists()).toBe(false)
    expect(wrapper.find('#settings-name').exists()).toBe(false)
    expect(wrapper.find('section[aria-label="Kiosko"]').exists()).toBe(true)
  })
})
