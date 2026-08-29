import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface MapPoint {
  lat: number;
  lng: number;
}

export interface ExtraMarker {
  lat: number;
  lng: number;
  color?: string;
  label?: string;
}

interface LiveMapProps {
  partner?: MapPoint | null;
  user?: MapPoint | null;
  start?: MapPoint | null;
  end?: MapPoint | null;
  trail?: MapPoint[] | null;
  markers?: ExtraMarker[] | null;
  height?: number | string;
}

const partnerIcon = L.divIcon({
  className: '',
  html: '<div style="background:#10b981;width:18px;height:18px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 3px #10b98155;"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const userIcon = L.divIcon({
  className: '',
  html: '<div style="background:#0ea5e9;width:18px;height:18px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 3px #0ea5e955;"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const startIcon = L.divIcon({
  className: '',
  html: '<div style="background:#64748b;width:14px;height:14px;border-radius:50%;border:2px solid #fff;"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const endIcon = L.divIcon({
  className: '',
  html: '<div style="background:#ef4444;width:14px;height:14px;border-radius:50%;border:2px solid #fff;"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

export function LiveMap({ partner, user, start, end, trail, markers, height = 320 }: LiveMapProps) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const partnerMarker = useRef<L.Marker | null>(null);
  const userMarker = useRef<L.Marker | null>(null);
  const startMarker = useRef<L.Marker | null>(null);
  const endMarker = useRef<L.Marker | null>(null);
  const lineRef = useRef<L.Polyline | null>(null);
  const trailRef = useRef<L.Polyline | null>(null);
  const extraRef = useRef<L.Marker[]>([]);

  // Init map once
  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const initial = partner || user || start || end || (markers && markers[0]) || { lat: 20.5937, lng: 78.9629 };
    const map = L.map(elRef.current, { zoomControl: true, attributionControl: true }).setView(
      [initial.lat, initial.lng],
      13
    );
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 200);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update markers whenever points change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const setMarker = (ref: MutableRefObject<L.Marker | null>, point: MapPoint | null | undefined, icon: L.DivIcon, label: string) => {
      if (point && Number.isFinite(point.lat) && Number.isFinite(point.lng)) {
        if (ref.current) {
          ref.current.setLatLng([point.lat, point.lng]);
        } else {
          ref.current = L.marker([point.lat, point.lng], { icon, title: label }).addTo(map);
        }
      } else if (ref.current) {
        ref.current.remove();
        ref.current = null;
      }
    };

    setMarker(partnerMarker, partner, partnerIcon, 'Partner');
    setMarker(userMarker, user, userIcon, 'User');
    setMarker(startMarker, start, startIcon, 'Start');
    setMarker(endMarker, end, endIcon, 'End');

    const live: [number, number][] = [];
    if (partner) live.push([partner.lat, partner.lng]);
    if (user) live.push([user.lat, user.lng]);
    if (lineRef.current) {
      lineRef.current.setLatLngs(live);
    } else if (live.length) {
      lineRef.current = L.polyline(live, { color: '#10b981', weight: 3, dashArray: '6 6', opacity: 0.9 }).addTo(map);
    }

    // Movement trail ("where he goes")
    if (trail && trail.length) {
      const tpts = trail
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
        .map((p) => [p.lat, p.lng] as [number, number]);
      if (trailRef.current) {
        trailRef.current.setLatLngs(tpts);
      } else if (tpts.length) {
        trailRef.current = L.polyline(tpts, { color: '#34d399', weight: 4, opacity: 0.7 }).addTo(map);
      }
    }

    // Extra static markers (e.g. all active partners on the global board)
    if (markers) {
      extraRef.current.forEach((m) => m.remove());
      extraRef.current = [];
      markers
        .filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng))
        .forEach((m) => {
          const color = m.color || '#f59e0b';
          const icon = L.divIcon({
            className: '',
            html: `<div style="background:${color};width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 3px ${color}55;"></div>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7],
          });
          const mk = L.marker([m.lat, m.lng], { icon, title: m.label || 'Partner' }).addTo(map);
          extraRef.current.push(mk);
        });
    }

    const all = [partner, user, start, end, ...(trail || []), ...(markers || [])].filter(
      (p): p is MapPoint => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng)
    );
    if (all.length > 0) {
      const bounds = L.latLngBounds(all.map((p) => [p.lat, p.lng] as [number, number]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    }
  }, [partner, user, start, end, trail, markers]);

  const hasAny = !!(partner || user || start || end || (markers && markers.length) || (trail && trail.length));

  return (
    <div className="relative w-full h-full rounded-xl overflow-hidden border border-gray-800" style={{ height }}>
      <div ref={elRef} className="w-full h-full" />
      {!hasAny && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-600 text-sm pointer-events-none">
          Waiting for live location…
        </div>
      )}
    </div>
  );
}
