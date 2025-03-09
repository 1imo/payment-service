import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { stripe } from './config/stripe';
import { pool } from './config/database';
import { PaymentRepository } from './repositories/PaymentRepository';
import { PaymentService } from './services/PaymentService';

dotenv.config();

const app = express();

app.use(express.json());
app.use(cors());

// Initialize dependencies
const paymentRepository = new PaymentRepository(pool);
const paymentService = new PaymentService(paymentRepository);

// API Endpoints
app.post('/api/payments', async (req, res) => {
    try {
        const payment = await paymentService.createPaymentIntent({
            invoiceId: req.body.invoiceId,
            amount: req.body.amount,
            currency: req.body.currency
        });
        res.status(201).json(payment);
    } catch (error) {
        res.status(500).json({ error: 'Failed to create payment' });
    }
});

app.get('/api/payments/:id', async (req, res) => {
    try {
        const payment = await paymentRepository.findById(req.params.id);
        if (!payment) {
            return res.status(404).json({ error: 'Payment not found' });
        }
        res.json(payment);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch payment' });
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

        await paymentService.handleWebhook(event);
        res.json({ received: true });
    } catch (error) {
        res.status(400).json({ error: 'Webhook signature verification failed' });
    }
});

// Payment page route
app.get('/pay/:invoiceId', async (req, res) => {
    try {
        // Here you would typically render a payment page
        // For now, we'll just return payment details
        const payment = await paymentRepository.findByInvoiceId(req.params.invoiceId);
        if (!payment) {
            return res.status(404).json({ error: 'Payment not found' });
        }
        res.json(payment);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch payment details' });
    }
});

export default app; 