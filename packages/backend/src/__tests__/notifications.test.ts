import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/database', () => ({
  prisma: {
    notification: { findMany: vi.fn(), count: vi.fn() },
  },
}));

import { inferNotificationType } from '../controllers/notificationController';

describe('inferNotificationType', () => {
  it('routes OTP codes to BOOKING_OTP', () => {
    expect(inferNotificationType('Service Start Code', 'Your start code is 482731.')).toBe('BOOKING_OTP');
    expect(inferNotificationType('Completion', 'Enter the completion code.')).toBe('BOOKING_OTP');
  });

  it('routes arrival and job events to BOOKING', () => {
    expect(inferNotificationType('Your partner has arrived', 'Your partner is at the location.')).toBe('BOOKING');
    expect(inferNotificationType('Partner assigned', 'You can now chat.')).toBe('BOOKING');
  });

  it('routes money events to PAYMENT and safety to SOS', () => {
    expect(inferNotificationType('Payment Successful', 'Paid.')).toBe('PAYMENT');
    expect(inferNotificationType('Cash Confirmed', 'Receipt of cash.')).toBe('PAYMENT');
    expect(inferNotificationType('SOS', 'Emergency.')).toBe('SOS');
  });

  it('routes community and chat, defaults to GENERAL', () => {
    expect(inferNotificationType('New comment on your post', 'Nice!')).toBe('COMMUNITY');
    expect(inferNotificationType('New message', 'Hi')).toBe('MESSAGE');
    expect(inferNotificationType('Hello', 'Just saying hi.')).toBe('GENERAL');
  });

  it('never throws on empty input', () => {
    expect(inferNotificationType('', '')).toBe('GENERAL');
  });
});
