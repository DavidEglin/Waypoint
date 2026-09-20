import { describe, expect, it } from 'vitest';
import { isValidDate, isValidTime, todayIn, zonedToUtc } from '../src/timezone.js';

describe('zonedToUtc', () => {
  it('converts Sydney standard time (UTC+10)', () => {
    expect(zonedToUtc('2026-09-23', '23:59', 'Australia/Sydney').toISOString()).toBe('2026-09-23T13:59:00.000Z');
  });

  it('uses daylight time after the changeover (first Sunday of October)', () => {
    expect(zonedToUtc('2026-10-05', '09:00', 'Australia/Sydney').toISOString()).toBe('2026-10-04T22:00:00.000Z');
    expect(zonedToUtc('2026-10-03', '09:00', 'Australia/Sydney').toISOString()).toBe('2026-10-02T23:00:00.000Z');
  });

  it('handles zones west of UTC and UTC itself', () => {
    expect(zonedToUtc('2026-01-15', '08:30', 'America/Los_Angeles').toISOString()).toBe('2026-01-15T16:30:00.000Z');
    expect(zonedToUtc('2026-06-01', '12:00', 'UTC').toISOString()).toBe('2026-06-01T12:00:00.000Z');
  });
});

describe('validation', () => {
  it('rejects impossible dates and times', () => {
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2028-02-29')).toBe(true);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('23/09/2026')).toBe(false);
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('23:59')).toBe(true);
    expect(isValidTime('9:00')).toBe(false);
  });

  it('finds today in the student\'s zone, not UTC', () => {
    const lateUtc = new Date('2026-09-19T20:00:00Z'); // already the 20th in Sydney
    expect(todayIn('Australia/Sydney', lateUtc)).toBe('2026-09-20');
    expect(todayIn('UTC', lateUtc)).toBe('2026-09-19');
  });
});
