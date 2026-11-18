export const avatarColors = [
  'bg-sky-500', 'bg-emerald-500', 'bg-rose-500',
  'bg-amber-500', 'bg-violet-500', 'bg-lime-500',
  'bg-red-500', 'bg-teal-500', 'bg-fuchsia-500',
  'bg-blue-600', 'bg-orange-500', 'bg-pink-500',
  'bg-green-500', 'bg-indigo-500', 'bg-yellow-500',
  'bg-purple-500', 'bg-cyan-500'
]

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '??'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

export function colorForId(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return avatarColors[hash % avatarColors.length]
}
