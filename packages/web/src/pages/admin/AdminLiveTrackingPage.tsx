import { useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { Radio, MapPin, User as UserIcon, Navigation, RefreshCw, Siren } from 'lucide-react';
import { api } from '../../lib/api';
import { useBookingTracking } from '../../hooks/useSocket';
import { GlassCard } from '../../components/GlassCard';
import { LiveMap, MapPoint } from '../../components/LiveMap';

interface ActiveBooking {
  id: string;
  serviceType: string;
  status: string;
  user?: { fullName?: string; phone?: string };
  partner?: { user?: { fullName?: string } };
  partnerLocation?: { latitude: number; longitude: number; updatedAt?: string } | null;
  startLocation?: string;
  endLocation?: string;
}

const ACTIVE = ['PARTNER_ACCEPTED', 'OTP_GENERATED', 'IN_PROGRESS'];

interface SosAlert { bookingId: string; message: string; latitude?: number | null; longitude?: number | null; timestamp: number }

export function AdminLiveTrackingPage() {
  const [bookings, setBookings] = useState<ActiveBooking[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sosByBooking, setSosByBooking] = useState<Record<string, SosAlert>>({});

  const load = useCallback(async () => {
    try {
      const res = await api.get('/admin/bookings');
      const data = res.data?.data ?? res.data?.bookings ?? res.data ?? [];
      const arr: ActiveBooking[] = Array.isArray(data) ? data : data.items ?? [];
      setBookings(arr.filter((b: ActiveBooking) => ACTIVE.includes(b.status)));
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, [load]);

  const globalMarkers = bookings
    .filter((b) => b.partnerLocation && Number.isFinite(b.partnerLocation.latitude))
    .map((b) => ({
      lat: b.partnerLocation!.latitude,
      lng: b.partnerLocation!.longitude,
      label: b.partner?.user?.fullName || 'Partner',
      color: '#34d399',
    }));

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Radio className="w-6 h-6 text-emerald-400" />
          <div>
            <h1 className="text-2xl font-bold text-white">Live Tracking</h1>
            <p className="text-gray-400 text-sm mt-1">
              Monitor user &amp; partner live locations for active bookings (safety)
            </p>
          </div>
          <button onClick={load} className="ml-auto p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300" title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-1 space-y-2">
            {loading && <p className="text-gray-500 text-sm">Loading…</p>}
            {!loading && bookings.length === 0 && (
              <p className="text-gray-500 text-sm">No active bookings to monitor.</p>
            )}
            {bookings.map((b) => {
              const sos = sosByBooking[b.id];
              return (
                <button
                  key={b.id}
                  onClick={() => setSelectedId(b.id)}
                  className={`w-full text-left p-3 rounded-xl border transition ${
                    selectedId === b.id
                      ? 'bg-emerald-900/30 border-emerald-600'
                      : 'bg-gray-900 border-gray-800 hover:border-gray-700'
                  }`}
                >
                  <p className="text-white text-sm font-medium">
                    {b.serviceType} · <span className="text-emerald-400">{b.status}</span>
                  </p>
                  <p className="text-gray-400 text-xs mt-1 truncate">
                    User: {b.user?.fullName ?? b.user?.phone ?? '—'} → Partner: {b.partner?.user?.fullName ?? '—'}
                  </p>
                  {sos && (
                    <p className="mt-1 text-xs text-red-400 flex items-center gap-1">
                      <Siren className="w-3 h-3" /> SOS: {sos.message}
                    </p>
                  )}
                  <p className="text-gray-500 text-[11px] mt-1 font-mono">{b.id.slice(0, 8)}…</p>
                </button>
              );
            })}
          </div>

          <div className="lg:col-span-2">
            {selectedId ? (
              <LiveTrack
                key={selectedId}
                bookingId={selectedId}
                initialPartner={
                  bookings.find((b) => b.id === selectedId)?.partnerLocation
                    ? {
                        lat: bookings.find((b) => b.id === selectedId)!.partnerLocation!.latitude,
                        lng: bookings.find((b) => b.id === selectedId)!.partnerLocation!.longitude,
                      }
                    : null
                }
                onSos={(a) => setSosByBooking((s) => ({ ...s, [a.bookingId]: a }))}
              />
            ) : (
              <GlassCard className="p-10 text-center text-gray-500">
                Select an active booking on the left to view the partner's live location.
                {globalMarkers.length > 0 && (
                  <div className="mt-4">
                    <LiveMap markers={globalMarkers} height={300} />
                    <p className="text-xs text-gray-500 mt-2">
                      {globalMarkers.length} active partner(s) shown from last-known GPS.
                    </p>
                  </div>
                )}
              </GlassCard>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface Pt { lat: number; lng: number; t: number }

function LiveTrack({ bookingId, initialPartner, onSos }: { bookingId: string; initialPartner?: { lat: number; lng: number } | null; onSos: (a: SosAlert) => void }) {
  const { listenToLocationUpdates, listenToUserLocationUpdates, listenToETAUpdates, requestETA, listenToSOSAlerts } =
    useBookingTracking(bookingId);
  const [partner, setPartner] = useState<Pt | null>(initialPartner ? { ...initialPartner, t: Date.now() } : null);
  const [user, setUser] = useState<Pt | null>(null);
  const [trail, setTrail] = useState<Pt[]>(initialPartner ? [{ ...initialPartner, t: Date.now() }] : []);
  const [eta, setEta] = useState<{ eta: number | null; distance: number | null } | null>(null);
  const [sos, setSos] = useState<SosAlert | null>(null);

  useEffect(() => {
    const u1 = listenToLocationUpdates((d: any) => {
      const p = { lat: d.latitude, lng: d.longitude, t: d.timestamp };
      setPartner(p);
      setTrail((prev) => {
        const next = [...prev, p];
        // keep at most ~60 points (~2 min of history) to bound memory
        return next.length > 60 ? next.slice(next.length - 60) : next;
      });
    });
    const u2 = listenToUserLocationUpdates((d: any) => setUser({ lat: d.latitude, lng: d.longitude, t: d.timestamp }));
    const u3 = listenToETAUpdates((d: any) =>
      setEta({ eta: d.eta ?? null, distance: d.distance ?? null })
    );
    const u4 = listenToSOSAlerts((a: any) => {
      const alert: SosAlert = {
        bookingId: a.bookingId,
        message: a.message,
        latitude: a.latitude,
        longitude: a.longitude,
        timestamp: a.timestamp,
      };
      setSos(alert);
      onSos(alert);
    });
    return () => { u1?.(); u2?.(); u3?.(); u4?.(); };
  }, [listenToLocationUpdates, listenToUserLocationUpdates, listenToETAUpdates, listenToSOSAlerts, onSos]);

  useEffect(() => {
    requestETA();
    const iv = setInterval(requestETA, 15000);
    return () => clearInterval(iv);
  }, [requestETA]);

  const toPoint = (p: Pt | null): MapPoint | null => (p ? { lat: p.lat, lng: p.lng } : null);

  return (
    <div className="space-y-3">
      {sos && (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-red-900/40 border border-red-600 text-red-200">
          <Siren className="w-5 h-5 animate-pulse" />
          <div>
            <p className="font-semibold">SOS ALERT</p>
            <p className="text-sm">{sos.message}</p>
            <p className="text-xs text-red-300/80">
              {new Date(sos.timestamp).toLocaleTimeString('en-IN')}
              {sos.latitude != null && sos.longitude != null
                ? ` · ${sos.latitude.toFixed(5)}, ${sos.longitude.toFixed(5)}`
                : ''}
            </p>
          </div>
        </div>
      )}

      <GlassCard className="p-3">
        <LiveMap partner={toPoint(partner)} user={toPoint(user)} trail={trail.map((p) => ({ lat: p.lat, lng: p.lng }))} height={360} />
      </GlassCard>

      <div className="grid grid-cols-3 gap-3">
        <InfoCard
          icon={<Navigation className="w-4 h-4 text-emerald-400" />}
          title="Partner"
          point={partner}
        />
        <InfoCard icon={<UserIcon className="w-4 h-4 text-sky-400" />} title="User" point={user} />
        <div className="p-3 rounded-xl bg-gray-900 border border-gray-800">
          <div className="flex items-center gap-2 mb-1">
            <MapPin className="w-4 h-4 text-amber-400" />
            <span className="text-xs text-gray-300">ETA</span>
          </div>
          {eta && eta.eta != null ? (
            <>
              <p className="text-white font-mono text-sm">{eta.eta} min</p>
              <p className="text-[11px] text-gray-500">
                {eta.distance != null ? `${eta.distance.toFixed(2)} km away` : ''}
              </p>
            </>
          ) : (
            <p className="text-gray-600 text-xs">—</p>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoCard({ icon, title, point }: { icon: ReactNode; title: string; point: Pt | null }) {
  return (
    <div className="p-3 rounded-xl bg-gray-900 border border-gray-800">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs text-gray-300">{title}</span>
      </div>
      {point ? (
        <>
          <p className="text-white font-mono text-sm">
            {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
          </p>
          <p className="text-[11px] text-gray-500">updated {new Date(point.t).toLocaleTimeString('en-IN')}</p>
        </>
      ) : (
        <p className="text-gray-600 text-xs">No signal</p>
      )}
    </div>
  );
}
