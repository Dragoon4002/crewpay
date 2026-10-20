/** Deterministic initials avatar for an address */

const PALETTE = [
  '#0B1437', '#1a6fa8', '#166534', '#7c2d12',
  '#3730a3', '#065f46', '#831843', '#1e3a5f',
]

function addrColor(addr: string): string {
  let hash = 0
  for (let i = 0; i < addr.length; i++) {
    hash = (hash * 31 + addr.charCodeAt(i)) >>> 0
  }
  return PALETTE[hash % PALETTE.length]
}

function initials(addr: string): string {
  if (!addr || addr.length < 6) return '??'
  return `${addr[2]}${addr[3]}`.toUpperCase()
}

interface AvatarProps {
  address: string
  size?: number
  className?: string
}

export function Avatar({ address, size = 32, className = '' }: AvatarProps) {
  return (
    <span
      className={`avatar ${className}`}
      style={{
        width: size, height: size, fontSize: size * 0.38,
        background: addrColor(address),
      }}
    >
      {initials(address)}
    </span>
  )
}
