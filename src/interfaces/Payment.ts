export interface Payment {
    id: string;
    invoiceId: string;
    amount: number;
    currency: string;
    status: 'pending' | 'completed' | 'failed';
    stripePaymentIntentId: string;
} 