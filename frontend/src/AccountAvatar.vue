<script setup lang="ts">
import type { Account } from './accounts'
import { colorForId, getInitials } from './avatar'

defineProps<{ account: Pick<Account, 'id' | 'name' | 'logo'> }>()
</script>

<template>
  <span
    :class="[
      'flex h-full w-full items-center justify-center overflow-hidden rounded-full text-sm font-semibold text-white',
      account.logo ? 'bg-white' : colorForId(account.id)
    ]"
  >
    <img v-if="account.logo" :src="account.logo" alt="" class="h-full w-full object-contain" />
    <template v-else>{{ getInitials(account.name) }}</template>
  </span>
</template>
