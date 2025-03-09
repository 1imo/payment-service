import { Pool } from 'pg';
import { Payment } from '../interfaces/Payment';

export class PaymentRepository {
    constructor(private readonly db: Pool) { }

    async create(payment: Omit<Payment, 'id'>): Promise<Payment> {
        const result = await this.db.query(
            'INSERT INTO payments (invoice_id, amount, currency, status, stripe_payment_intent_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [payment.invoiceId, payment.amount, payment.currency, payment.status, payment.stripePaymentIntentId]
        );
        return result.rows[0];
    }

    async findById(id: string): Promise<Payment | null> {
        const result = await this.db.query('SELECT * FROM payments WHERE id = $1', [id]);
        return result.rows[0] || null;
    }

    async findByInvoiceId(invoiceId: string): Promise<Payment | null> {
        const result = await this.db.query('SELECT * FROM payments WHERE invoice_id = $1', [invoiceId]);
        return result.rows[0] || null;
    }

    async updateStatus(id: string, status: Payment['status']): Promise<Payment> {
        const result = await this.db.query(
            'UPDATE payments SET status = $1 WHERE id = $2 RETURNING *',
            [status, id]
        );
        return result.rows[0];
    }
} 