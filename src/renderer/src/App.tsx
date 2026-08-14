import { useEffect, useState } from 'react'
import SettingsView from './views/SettingsView'
import OverlayView from './views/OverlayView'

/** Which window role this renderer instance is playing, from the location hash. */
function routeFromHash(hash: string): 'settings' | 'overlay' {
  return hash.startsWith('#/overlay') ? 'overlay' : 'settings'
}

export default function App(): JSX.Element {
  const [route, setRoute] = useState(() => routeFromHash(window.location.hash))

  useEffect(() => {
    const onHashChange = (): void => setRoute(routeFromHash(window.location.hash))
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return route === 'overlay' ? <OverlayView /> : <SettingsView />
}
