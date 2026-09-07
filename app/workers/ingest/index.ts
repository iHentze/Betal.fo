import { drainPendingDeliveries, processDelivery } from "~/lib/ingest/handler";
import type { Env, IngestMessage } from "~/lib/db/types";

/**
 * Ingest worker: queue consumer and scheduled drain.
 *
 * Deployed separately from the Astro app so webhook projection cannot be delayed by
 * app traffic, and so a bad deploy of the UI cannot stall the data feed. Both share
 * the same D1 database and the same projection code.
 */

interface QueueMessage<T> {
  body: T;
  ack(): void;
  retry(): void;
}

interface MessageBatch<T> {
  messages: QueueMessage<T>[];
}

export default {
  /**
   * Projects queued deliveries. Every projection statement is an upsert, so retrying a
   * message is safe and a partially processed batch converges on the same state.
   */
  async queue(batch: MessageBatch<IngestMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      const result = await processDelivery({ db: env.DB }, message.body.deliveryId);
      if (result.processed || !result.error) {
        // Already processed, or nothing to do. Either way the message is done.
        message.ack();
      } else {
        // Leave it to the queue's own retry and eventually the dead-letter queue; the
        // scheduled drain is the backstop.
        message.retry();
      }
    }
  },

  /**
   * Catches deliveries the queue never handled: a missing binding, a failed send, or a
   * message that exhausted its retries. Without this a transient queue problem would
   * silently lose data that ePay will not redeliver.
   */
  async scheduled(_event: unknown, env: Env): Promise<void> {
    await drainPendingDeliveries({ db: env.DB }, 200);
  },
};
