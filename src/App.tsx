import { useEffect, useState } from 'react'
import { Header } from './components/Header'
import { HomePage } from './pages/HomePage'
import { CreatePage } from './pages/CreatePage'
import { MilestonePage } from './pages/MilestonePage'
import { DEFAULT_CHAIN_ID } from './lib/contract'

type Route =
  | { page: 'home' }
  | { page: 'create' }
  | { page: 'milestone'; chainId: number; id: bigint }

function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, '')
  if (path === 'create') return { page: 'create' }

  // /#/m/<chainId>/<id>
  const m2 = path.match(/^m\/(\d+)\/(\d+)$/)
  if (m2) return { page: 'milestone', chainId: Number(m2[1]), id: BigInt(m2[2]) }

  // /#/m/<id>  — legacy: default chain
  const m1 = path.match(/^m\/(\d+)$/)
  if (m1) return { page: 'milestone', chainId: DEFAULT_CHAIN_ID, id: BigInt(m1[1]) }

  return { page: 'home' }
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return (
    <div className="min-h-dvh" style={{ background: 'var(--bg)' }}>
      <Header />
      <main className="pb-32">
        {route.page === 'home'      && <HomePage />}
        {route.page === 'create'    && <CreatePage />}
        {route.page === 'milestone' && <MilestonePage chainId={route.chainId} id={route.id} />}
      </main>
    </div>
  )
}
