import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { stripe } from './config/stripe';
import { PaymentRepository } from './repositories/PaymentRepository';
import { serviceAuth } from './middleware/serviceAuth';
import { pool, authPool, orderingPool } from './config/database';
import { createPaymentIntentLimiter, paymentPageLimiter } from './middleware/rateLimiter';

dotenv.config();

const app = express();

app.use(express.json());
app.use(cors());

// Initialize dependencies
const paymentRepository = new PaymentRepository(pool, authPool, orderingPool);

// API Endpoints
app.post('/api/payments',
    serviceAuth(),
    createPaymentIntentLimiter,
    async (req, res) => {
        try {
            const success = await paymentRepository.createPaymentIntent({
                invoiceId: req.body.invoiceId,
                amount: req.body.amount,
                currency: req.body.currency,
                successUrl: req.body.successUrl,
                cancelUrl: req.body.cancelUrl,
                companyId: req.body.companyId
            });

            if (success) {
                res.status(201).json({ success: true });
            } else {
                res.status(500).json({ success: false, error: 'Failed to create payment intent' });
            }
        } catch (error) {
            console.error('Payment creation failed:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to create payment',
                details: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });

// Stripe webhook handler
app.post('/api/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];

    try {
        const event = stripe.webhooks.constructEvent(
            req.body,
            sig ?? '',
            process.env.STRIPE_WEBHOOK_SECRET ?? ''
        );

        const redirectUrl = await paymentRepository.handleWebhook(event);
        if (redirectUrl) {
            res.redirect(redirectUrl);
        } else {
            res.status(400).json({ error: 'No redirect URL found' });
        }
    } catch (error) {
        res.status(400).json({ error: 'Webhook signature verification failed' });
    }
});

// Payment page endpoint
app.get('/api/pay/:invoiceId',
    paymentPageLimiter,
    async (req, res) => {
        try {
            console.log(req.params.invoiceId)
            const result = await paymentRepository.getPaymentPage(req.params.invoiceId);
            if (result.redirectUrl) {
                res.redirect(result.redirectUrl);
            } else {
                res.status(404).json({ error: 'Payment not found' });
            }
        } catch (error) {
            console.error('Error getting payment page:', error);
            res.status(500).json({ error: 'Failed to get payment page' });
        }
    });

app.listen(process.env.PORT, () => {
    console.log("Payment Service running at port", process.env.PORT)
});