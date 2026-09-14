import dynamic from 'next/dynamic';

/**
 * Leaflet requires the browser DOM and cannot run on the server.
 * `{ ssr: false }` tells Next.js to skip server-rendering MapView entirely.
 *
 * A simple spinner is shown while the client bundle loads.
 */
const MapView = dynamic(() => import('@/components/MapView'), {
  ssr: false,
  loading: () => (
    <div className="w-screen h-screen flex items-center justify-center bg-gray-900 text-white">
      <div className="text-center space-y-3">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-sm text-gray-400">Loading map…</p>
      </div>
    </div>
  ),
});

export default function Home() {
  return (
    <main className="w-screen h-screen">
      <MapView />
    </main>
  );
}
