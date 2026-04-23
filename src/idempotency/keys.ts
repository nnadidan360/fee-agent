import { createHash } from 'crypto';
import type { TimeInterval } from '../types/index.js';

export function makeEventIdempotencyKey(eventId: string, ruleId: string): string {
  return createHash('sha256').update(`${eventId}:${ruleId}`).digest('hex');
}

export function makeTimeIdempotencyKey(ruleId: string, intervalBoundary: Date): string {
  return createHash('sha256').update(`${ruleId}:${intervalBoundary.toISOString()}`).digest('hex');
}

export function floorToInterval(date: Date, interval: TimeInterval): Date {
  const d = new Date(date);
  if (interval === 'hourly') {
    d.setUTCMinutes(0, 0, 0);
  } else if (interval === 'daily') {
    d.setUTCHours(0, 0, 0, 0);
  } else if (interval === 'weekly') {
    // Floor to Monday 00:00:00 UTC
    // getUTCDay(): 0=Sun, 1=Mon, ..., 6=Sat
    const day = d.getUTCDay();
    const daysFromMonday = day === 0 ? 6 : day - 1;
    d.setUTCDate(d.getUTCDate() - daysFromMonday);
    d.setUTCHours(0, 0, 0, 0);
  }
  return d;
}
