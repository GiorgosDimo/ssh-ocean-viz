import dynamic from 'next/dynamic';

// Leaflet requires the browser DOM — skip SSR for MapView.
const MapView = dynamic(() => import('@/components/MapView'), {
  ssr: false,
  loading: () => (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111827', color: 'white' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 40, height: 40, border: '4px solid #3b82f6', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
        <p style={{ fontSize: 14, color: '#9ca3af', margin: 0 }}>Loading map…</p>
      </div>
    </div>
  ),
});

export default function Home() {
  return (
    <main style={{ width: '100vw', height: '100vh' }}>
      <MapView />
    </main>
  );
}
