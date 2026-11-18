<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Account } from './accounts'
import { colorForId, getInitials } from './avatar'

const props = defineProps<{ account: Pick<Account, 'id' | 'name' | 'logo'> }>()

const failedLogo = ref<string | null>(null)
const logo = computed(() => (props.account.logo && props.account.logo !== failedLogo.value ? props.account.logo : null))
</script>

<template>
  <span
    :class="[
      'flex h-full w-full items-center justify-center overflow-hidden rounded-full text-sm font-semibold text-white',
      logo ? 'bg-white' : colorForId(account.id)
    ]"
  >
    <img
      v-if="logo"
      :src="logo"
      alt=""
      referrerpolicy="no-referrer"
      loading="lazy"
      class="h-full w-full object-contain"
      @error="failedLogo = logo"
    />
    <template v-else>{{ getInitials(account.name) }}</template>
  </span>
</template>
