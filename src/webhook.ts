/**
 * Webhook Notification Service
 * 
 * Sends system events to external services (Slack, Discord, IFTTT, etc.)
 * via HTTP POST requests.
 */

import { WEBHOOK } from './config.js';
import { logger } from './logger.js';

interface WebhookPayload {
    event: string;
    message: string;
    timestamp: string;
    data?: any;
}

/**
 * Send a notification to the configured webhook URL.
 */
export async function sendWebhookNotification(
    event: string,
    message: string,
    data?: any,
): Promise<void> {
    if (!WEBHOOK.ENABLED || !WEBHOOK.URL) {
        return;
    }

    // Check if event is enabled
    if (!WEBHOOK.EVENTS.includes(event) && !WEBHOOK.EVENTS.includes('*')) {
        return;
    }

    const payload: WebhookPayload = {
        event,
        message,
        timestamp: new Date().toISOString(),
        data,
    };

    try {
        const response = await fetch(WEBHOOK.URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            throw new Error(`Webhook failed with status ${response.status}`);
        }

        logger.info({ event }, 'Webhook notification sent');
    } catch (err) {
        logger.error({ err, event }, 'Failed to send webhook notification');
    }
}
