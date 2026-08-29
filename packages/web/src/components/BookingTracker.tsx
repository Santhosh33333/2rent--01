import { useEffect, useState } from 'react';
import { useBookingTracking } from '../hooks/useSocket';
import { MapPin, Clock, AlertCircle } from 'lucide-react';
import { GlassCard } from './GlassCard';

interface BookingTrackerProps {
  bookingId: string;
  partnerName?: string;
  startLocation: string;
  endLocation: string;
}

interface LocationData {
  latitude: number;
  longitude: number;
  heading?: number;
  speed?: number;
  timestamp: number;
}

interface ETAData {
  eta: number;
  distance: number;
  timestamp: number;
}

export function BookingTracker({
  bookingId,
  partnerName = 'Partner',
  startLocation,
  endLocation,
}: BookingTrackerProps) {
  const [currentLocation, setCurrentLocation] = useState<LocationData | null>(null);
  const [eta, setETA] = useState<ETAData | null>(null);
  const [status, setStatus] = useState<string>('IN_PROGRESS');
  const [error, setError] = useState<string | null>(null);

  const {
    listenToLocationUpdates,
    listenToStatusChanges,
    listenToETAUpdates,
    requestETA,
  } = useBookingTracking(bookingId);

  // Listen to location updates
  useEffect(() => {
    const unsubscribe = listenToLocationUpdates((data) => {
      setCurrentLocation({
        latitude: data.latitude,
        longitude: data.longitude,
        heading: data.heading,
        speed: data.speed,
        timestamp: data.timestamp ?? Date.now(),
      });
      setError(null);
    });

    return unsubscribe;
  }, [listenToLocationUpdates]);

  // Listen to status changes
  useEffect(() => {
    const unsubscribe = listenToStatusChanges((data) => {
      setStatus(data.status);
    });

    return unsubscribe;
  }, [listenToStatusChanges]);

  // Listen to ETA updates
  useEffect(() => {
    const unsubscribe = listenToETAUpdates((data) => {
      setETA({
        eta: data.eta ?? 0,
        distance: data.distance ?? 0,
        timestamp: data.timestamp ?? Date.now(),
      });
    });

    return unsubscribe;
  }, [listenToETAUpdates]);

  // Request ETA every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      requestETA();
    }, 30000);

    return () => clearInterval(interval);
  }, [requestETA]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'IN_PROGRESS':
        return 'text-blue-600';
      case 'COMPLETED':
        return 'text-green-600';
      case 'CANCELLED':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'IN_PROGRESS':
        return '🚗';
      case 'COMPLETED':
        return '✓';
      case 'CANCELLED':
        return '✗';
      default:
        return '○';
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <GlassCard variant="elevated" padding="md">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-surface-900 dark:text-white">
              {partnerName}
            </h3>
            <p className="text-sm text-surface-500">Booking ID: {bookingId.slice(0, 8)}...</p>
          </div>
          <span className={`text-2xl ${getStatusColor(status)}`}>
            {getStatusIcon(status)}
          </span>
        </div>
      </GlassCard>

      {/* Route Information */}
      <GlassCard variant="default" padding="md">
        <div className="space-y-3">
          <div className="flex gap-3">
            <MapPin className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-surface-500">From</p>
              <p className="font-medium text-surface-900 dark:text-white truncate">
                {startLocation}
              </p>
            </div>
          </div>

          <div className="h-1 mx-8 bg-gradient-to-r from-emerald-400 via-emerald-500 to-transparent rounded-full"></div>

          <div className="flex gap-3">
            <MapPin className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-surface-500">To</p>
              <p className="font-medium text-surface-900 dark:text-white truncate">
                {endLocation}
              </p>
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Live Location & ETA */}
      {currentLocation && (
        <GlassCard variant="default" padding="md">
          <div className="space-y-3">
            {/* Current Location */}
            <div>
              <p className="text-xs text-surface-500 mb-1">Current Location</p>
              <p className="font-mono text-sm text-surface-700 dark:text-surface-300">
                {currentLocation.latitude.toFixed(4)}, {currentLocation.longitude.toFixed(4)}
              </p>
              {currentLocation.speed !== undefined && (
                <p className="text-xs text-surface-500 mt-1">
                  Speed: {currentLocation.speed.toFixed(1)} km/h
                </p>
              )}
            </div>

            {/* ETA */}
            {eta && (
              <div className="pt-2 border-t border-surface-200 dark:border-surface-700">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-amber-500" />
                    <span className="text-sm text-surface-700 dark:text-surface-300">
                      ETA: {eta.eta} min
                    </span>
                  </div>
                  <span className="text-sm text-surface-500">
                    {eta.distance.toFixed(1)} km away
                  </span>
                </div>
              </div>
            )}
          </div>
        </GlassCard>
      )}

      {/* Error State */}
      {error && (
        <GlassCard variant="default" padding="md" className="bg-red-50 dark:bg-red-900/10">
          <div className="flex items-center gap-2 text-red-600">
            <AlertCircle className="w-4 h-4" />
            <p className="text-sm">{error}</p>
          </div>
        </GlassCard>
      )}

      {/* Status Badge */}
      <GlassCard variant="default" padding="sm" className="text-center">
        <span
          className={`inline-px text-xs font-semibold px-3 py-1 rounded-full ${
            status === 'IN_PROGRESS'
              ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
              : status === 'COMPLETED'
                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
          }`}
        >
          {status === 'IN_PROGRESS' && 'In Progress'}
          {status === 'COMPLETED' && 'Completed'}
          {status === 'CANCELLED' && 'Cancelled'}
        </span>
      </GlassCard>
    </div>
  );
}
