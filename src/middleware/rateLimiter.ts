import rateLimit from 'express-rate-limit';
import { Request } from 'express';

// Rate limiter for creating payment intents
export const createPaymentIntentLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each service to 100 requests per windowMs
    message: { error: 'Too many payment intent requests, please try again later' },
    keyGenerator: (req: Request) => req.get('X-Service-Name') ?? req.ip ?? 'unknown',
    standardHeaders: true,
    legacyHeaders: false,
});

// Rate limiter for payment page access
export const paymentPageLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 300, // Limit to 300 payment page accesses per hour
    message: { error: 'Too many payment page requests, please try again later' },
    keyGenerator: (req: Request) => req.get('X-Service-Name') ?? req.ip ?? 'unknown',
    standardHeaders: true,
    legacyHeaders: false,
});

// Webhook endpoints should not be rate limited as they come from Stripe 