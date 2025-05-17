import { createRouter, createWebHistory } from 'vue-router'
import TokenConfig from './components/TokenConfig.vue'
import EmployeeCard from './components/EmployeeCard.vue'

function hasToken(): boolean {
  return !!localStorage.getItem('holded_token')
}

const routes = [
  {
    path: '/',
    redirect: () => (hasToken() ? '/panel' : '/config')
  },
  {
    path: '/config',
    component: TokenConfig
  },
  {
    path: '/panel',
    component: EmployeeCard
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router