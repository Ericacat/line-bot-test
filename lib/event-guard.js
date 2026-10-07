import { isFreshEvent, ProtectionError } from './cost-policy.js';

// Best-effort duplicate suppression only. Google owns the durable daily quota.
// A process-local cache cannot guarantee exactly-once across Vercel instances.
export function createEventGuard({ now = Date.now, maxEntries = 10000 } = {}) {
    const seen = new Map();
    return {
        claim(event) {
            const current = now();
            if (!isFreshEvent(event, current) || event.deliveryContext?.isRedelivery === true) return null;
            for (const [id, expiresAt] of seen) if (expiresAt <= current) seen.delete(id);
            if (seen.has(event.webhookEventId)) return null;
            // Do not evict fresh claims and reopen duplicate events under load.
            if (seen.size >= maxEntries) throw new ProtectionError('BUSY', '目前請求過多，請稍後再試。');
            seen.set(event.webhookEventId, event.timestamp + 600001);
            return { eventId: event.webhookEventId, timestamp: event.timestamp };
        },
    };
}
