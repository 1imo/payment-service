import { Payment } from '../interfaces/Payment';
import { PaymentRepository } from '../repositories/PaymentRepository';
import { stripe } from '../config/stripe';

export class PaymentService {
    constructor(private readonly repository: PaymentRepository) { }

    async createPaymentIntent(payment: Omit<Payment, 'id' | 'stripePaymentIntentId' | 'status'>): Promise<Payment> {
        const stripeIntent = await stripe.paymentIntents.create({
            amount: payment.amount,
            currency: payment.currency,
            metadata: {
                invoiceId: payment.invoiceId
            }
        });

        return this.repository.create({
            ...payment,
            status: 'pending',
            stripePaymentIntentId: stripeIntent.id
        } as Payment);
    }

    async handleWebhook(event: any): Promise<void> {
        // Handle different webhook events
        if (event.type === 'payment_intent.succeeded') {
            const paymentIntent = event.data.object;
            await this.repository.updateStatus(paymentIntent.metadata.invoiceId, 'completed');
        }
    }
} 