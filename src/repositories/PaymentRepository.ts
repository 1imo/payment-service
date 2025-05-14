import { Pool } from 'pg';
import Stripe from 'stripe';

interface PaymentIntent {
    invoiceId: string;
    amount: number;
    currency: string;
    companyId: string;
    successUrl: string;  // URL to redirect on successful payment
    cancelUrl: string;   // URL to redirect on cancelled/failed payment
    referrerUrl?: string; // Optional referrer URL for cancel URL fallback
}

export class PaymentRepository {
    constructor(
        private readonly db: Pool,
        private readonly authDb: Pool,
        private readonly orderingDb: Pool
    ) { }

    private async getStripeCredentials(companyId: string): Promise<Stripe> {
        const result = await this.authDb.query(
            'SELECT password FROM credentials WHERE name = $1 AND type = $2',
            [`${companyId}`, 'stripe']
        );
        const check = await this.authDb.query(
            'SELECT * FROM credentials'
        );

        console.log(check.rows, companyId)

        console.log(result.rows)

        if (!result.rows[0]) {
            throw new Error('Stripe credentials not found for company');
        }

        return new Stripe(result.rows[0].password, {
            apiVersion: '2022-11-15'
        });
    }

    private convertCurrencySymbolToCode(symbol: string): string {
        const currencyMap: { [key: string]: string } = {
            '£': 'gbp',
            '$': 'usd',
            '€': 'eur',
            // Add more currencies as needed
        };

        return currencyMap[symbol] || 'gbp'; // Default to GBP if symbol not found
    }

    private convertAmountToCents(amount: number): number {
        console.log(Math.round(amount * 100))
        return Math.round(amount * 100); // Convert pounds to pence
    }

    async createPaymentIntent(data: PaymentIntent): Promise<boolean> {
        try {
            console.log('Creating payment intent with data:', data);

            const stripe = await this.getStripeCredentials(data.companyId);
            const stripeIntent = await stripe.paymentIntents.create({
                amount: data.amount,
                currency: data.currency.toLowerCase(),
                metadata: {
                    invoiceId: data.invoiceId,
                    successUrl: data.successUrl,
                    cancelUrl: data.cancelUrl
                }
            });

            // Update the invoice with the payment intent ID
            await this.db.query(
                'UPDATE invoices SET payment_intent_id = $1 WHERE id = $2',
                [stripeIntent.id, data.invoiceId]
            );

            console.log('Stripe payment intent created:', stripeIntent.id);
            return true;

        } catch (error) {
            console.error('Error creating payment intent:', error);
            return false;
        }
    }

    async handleWebhook(event: any): Promise<string | null> {
        if (event.type === 'payment_intent.succeeded') {
            const paymentIntent = event.data.object;
            await this.db.query(
                'UPDATE invoices SET status = $1 WHERE payment_intent_id = $2',
                ['paid', paymentIntent.id]
            );
            console.log('Payment succeeded for invoice with payment_intent_id:', paymentIntent.id);

            // Return success URL
            return paymentIntent.metadata.successUrl || null;

        } else if (event.type === 'payment_intent.payment_failed') {
            const paymentIntent = event.data.object;
            await this.db.query(
                'UPDATE invoices SET status = $1 WHERE payment_intent_id = $2',
                ['failed', paymentIntent.id]
            );
            console.log('Payment failed for invoice with payment_intent_id:', paymentIntent.id);

            // Return cancel URL
            return paymentIntent.metadata.cancelUrl || null;
        }

        return null;
    }

    async getPaymentPage(invoiceId: string, referrerUrl?: string): Promise<{ redirectUrl: string | null }> {
        try {
            // Get invoice details
            const result = await this.db.query(
                'SELECT payment_intent_id, amount, currency, order_batch_id, company_id FROM invoices WHERE id = $1',
                [invoiceId]
            );

            const check = await this.db.query(
                'SELECT payment_intent_id, amount, currency, order_batch_id, company_id FROM invoices'
            );

            console.log("HERE", invoiceId, check.rows)

            if (!result.rows[0]) {
                console.log("returning")
                return { redirectUrl: null };
            }

            const invoice = result.rows[0];
            console.log(invoice, "INVOICE")
            const currencyCode = this.convertCurrencySymbolToCode(invoice.currency);
            console.log(currencyCode,)

            // Get products from order batch
            const productIds = await this.orderingDb.query(
                'SELECT DISTINCT product_id FROM "order" WHERE batch_id = $1',
                [invoice.order_batch_id]
            );

            console.log(productIds.rows, 'Product IDs')

            const products = await this.orderingDb.query(
                'SELECT DISTINCT * FROM product WHERE id = ANY($1)',
                [productIds.rows.map(row => row.product_id)]
            );

            console.log(products.rows, "Products")

            // Get company-specific Stripe instance
            const stripe = await this.getStripeCredentials(invoice.company_id);

            // Get the payment intent to access the metadata
            const paymentIntent = await stripe.paymentIntents.retrieve(invoice.payment_intent_id);

            console.log(paymentIntent, "Payment Intent")

            let discountAmount = 0;
            const lineItems = products.rows
                .map(product => {
                    if (product.price < 0) {
                        discountAmount += Math.abs(product.price);
                        return undefined;
                    }
                    
                    const item: Stripe.Checkout.SessionCreateParams.LineItem = {
                        price_data: {
                            currency: currencyCode,
                            product_data: {
                                name: product.name,
                                ...(product.description && { description: product.description })
                            },
                            unit_amount: this.convertAmountToCents(product.price),
                        },
                        quantity: result.rows.find(item => item.name === product.name)?.quantity || 1
                    };
                    return item;
                })
                .filter((item): item is Stripe.Checkout.SessionCreateParams.LineItem => 
                    item !== undefined
                ) as Stripe.Checkout.SessionCreateParams.LineItem[];

            // Create a Checkout Session with line items and discount
            const session = await stripe.checkout.sessions.create({
                line_items: lineItems,
                mode: 'payment',
                success_url: paymentIntent.metadata.successUrl,
                cancel_url: referrerUrl || paymentIntent.metadata.cancelUrl,
                discounts: discountAmount > 0 ? [{
                    coupon: await this.createDiscountCoupon(stripe, discountAmount, currencyCode)
                }] : undefined,
                metadata: {
                    invoiceId: invoiceId,
                    companyId: invoice.company_id,
                    returnUrl: referrerUrl || null
                }
            });

            console.log('Created checkout session with products for company:', invoice.company_id);
            return { redirectUrl: session.url };
        } catch (error) {
            console.error('Error creating checkout session:', error);
            throw error;
        }
    }

    private async createDiscountCoupon(stripe: Stripe, amount: number, currency: string): Promise<string> {
        const coupon = await stripe.coupons.create({
            amount_off: this.convertAmountToCents(amount),
            currency: currency,
            duration: 'once'
        });
        
        return coupon.id;
    }
} 