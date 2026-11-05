/** Upper bound on deliveries re-enqueued by one bulk replay request (DL-09). */
export const MAX_BULK_REPLAY = 50

/** Delivery statuses an operator may replay. */
export const REPLAYABLE_DELIVERY_STATUSES = ['failed', 'dead'] as const
export type ReplayableDeliveryStatus = (typeof REPLAYABLE_DELIVERY_STATUSES)[number]
