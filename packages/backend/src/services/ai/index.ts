/**
 * AI Service Architecture Stubs
 *
 * These define the integration interfaces for future AI/ML features.
 * Each service exports a typed interface that controllers can import
 * and call. Implementations will be swapped in when the models are ready.
 *
 * Phase 50: Smart Pricing / Partner Matching
 * Phase 63: Fraud Detection / Predictive Analytics
 */

export interface MatchScore {
  partnerId: string;
  score: number;       // 0–100
  reasons: string[];
}

export interface PricingSuggestion {
  basePrice: number;
  surgeMultiplier: number;  // 1.0 = normal, >1.0 = surge
  confidence: number;       // 0–1
  factors: string[];
}

export interface FraudSignal {
  riskLevel: 'low' | 'medium' | 'high';
  score: number;            // 0–1
  flags: string[];
  recommendation: 'allow' | 'review' | 'block';
}

export interface PredictionResult {
  metric: string;
  value: number;
  confidence: number;
  horizon: string;          // e.g. '7d', '30d'
}

/**
 * Partner matching — scores partners for a given booking request.
 * Uses distance, rating, completion rate, response time, availability.
 */
export async function scorePartners(
  _bookingRequest: { serviceType: string; startLat: number; startLng: number; scheduledAt: string },
  _candidatePartnerIds: string[]
): Promise<MatchScore[]> {
  // Stub: return unsorted candidates with neutral score
  return _candidatePartnerIds.map(id => ({
    partnerId: id,
    score: 50,
    reasons: ['AI matching not yet implemented'],
  }));
}

/**
 * Dynamic pricing — suggests price based on demand, supply, time, weather.
 */
export async function suggestPrice(
  _params: { serviceType: string; lat: number; lng: number; scheduledAt: string; durationMinutes: number }
): Promise<PricingSuggestion> {
  // Stub: return base price with no surge
  return {
    basePrice: 100,
    surgeMultiplier: 1.0,
    confidence: 0.5,
    factors: ['AI pricing not yet implemented — using base rate'],
  };
}

/**
 * Fraud detection — analyzes a booking/payment for suspicious patterns.
 */
export async function analyzeFraudRisk(
  _params: { userId: string; action: string; metadata: Record<string, any> }
): Promise<FraudSignal> {
  // Stub: always allow
  return {
    riskLevel: 'low',
    score: 0.1,
    flags: [],
    recommendation: 'allow',
  };
}

/**
 * Predictive analytics — forecasts metrics like churn, demand, earnings.
 */
export async function predict(
  _metric: string,
  _params: { userId?: string; serviceType?: string; horizon: string }
): Promise<PredictionResult> {
  // Stub: return neutral prediction
  return {
    metric: _metric,
    value: 0,
    confidence: 0,
    horizon: _params.horizon,
  };
}
