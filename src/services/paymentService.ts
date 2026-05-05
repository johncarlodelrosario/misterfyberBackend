import axios from 'axios';
import Payment from '../models/Payment';
import Billing from '../models/Billing';
import User from '../models/User';
import logger from '../utils/logger';

interface PayMongoResponse {
    data: {
        id: string;
        type: string;
        attributes: {
            amount: number;
            status: string;
            checkout_url?: string;
            redirect?: {
                checkout_url: string;
            };
            payment_intent?: {
                id: string;
            };
        };
    };
}

interface DragonPayResponse {
    transactionId: string;
    checkoutUrl: string;
    status: string;
}

class PaymentService {
    private paymongoApi: string;
    private dragonpayApi: string;
    private mayaApi: string;

    constructor() {
        this.paymongoApi = 'https://api.paymongo.com/v1';
        this.dragonpayApi = 'https://api.dragonpay.ph';
        this.mayaApi = 'https://pg-sandbox.paymaya.com';
    }

    private getPayMongoAuthHeader(): { [key: string]: string } {
        const secretKey = process.env.PAYMONGO_SECRET_KEY;
        if (!secretKey) {
            throw new Error('PAYMONGO_SECRET_KEY is not defined');
        }
        const auth = `Basic ${Buffer.from(secretKey).toString('base64')}`;
        return {
            'Authorization': auth,
            'Content-Type': 'application/json'
        };
    }

    async createPayMongoPayment(amount: number, description: string, metadata: any): Promise<PayMongoResponse> {
        try {
            const response = await axios.post(
                `${this.paymongoApi}/checkout_sessions`,
                {
                    data: {
                        attributes: {
                            amount: amount * 100, // Convert to cents
                            currency: 'PHP',
                            description,
                            metadata,
                            payment_method_types: ['card', 'gcash', 'paymaya']
                        }
                    }
                },
                { headers: this.getPayMongoAuthHeader() }
            );

            return response.data;
        } catch (error) {
            logger.error('PayMongo payment creation error:', error);
            throw error;
        }
    }

    async createDragonPayPayment(amount: number, description: string, user: any): Promise<DragonPayResponse> {
        try {
            const merchantId = process.env.DRAGONPAY_MERCHANT_ID;
            const password = process.env.DRAGONPAY_PASSWORD;
            
            if (!merchantId || !password) {
                throw new Error('DragonPay credentials not configured');
            }

            const transactionId = `TXN${Date.now()}${Math.floor(Math.random() * 1000)}`;
            
            // Construct DragonPay URL
            const baseUrl = process.env.DRAGONPAY_API_URL || 'https://gw.dragonpay.ph';
            const checkoutUrl = `${baseUrl}/Pay.aspx?merchantid=${merchantId}&txnid=${transactionId}&amount=${amount}&ccy=PHP&description=${encodeURIComponent(description)}&email=${user.email}&param1=${user._id}`;

            return {
                transactionId,
                checkoutUrl,
                status: 'pending'
            };
        } catch (error) {
            logger.error('DragonPay payment creation error:', error);
            throw error;
        }
    }

    async createGCashPayment(amount: number, description: string, userId: string): Promise<any> {
        try {
            const response = await axios.post(
                `${this.paymongoApi}/sources`,
                {
                    data: {
                        attributes: {
                            amount: amount * 100,
                            type: 'gcash',
                            currency: 'PHP',
                            redirect: {
                                success: `${process.env.FRONTEND_URL}/payment/success`,
                                failed: `${process.env.FRONTEND_URL}/payment/failed`
                            },
                            metadata: {
                                description,
                                userId
                            }
                        }
                    }
                },
                { headers: this.getPayMongoAuthHeader() }
            );

            return response.data;
        } catch (error) {
            logger.error('GCash payment creation error:', error);
            throw error;
        }
    }

    async createMayaPayment(amount: number, description: string, userId: string): Promise<any> {
        try {
            const response = await axios.post(
                `${this.paymongoApi}/sources`,
                {
                    data: {
                        attributes: {
                            amount: amount * 100,
                            type: 'paymaya',
                            currency: 'PHP',
                            redirect: {
                                success: `${process.env.FRONTEND_URL}/payment/success`,
                                failed: `${process.env.FRONTEND_URL}/payment/failed`
                            },
                            metadata: {
                                description,
                                userId
                            }
                        }
                    }
                },
                { headers: this.getPayMongoAuthHeader() }
            );

            return response.data;
        } catch (error) {
            logger.error('Maya payment creation error:', error);
            throw error;
        }
    }

    async verifyPayment(reference: string): Promise<any> {
        try {
            const response = await axios.get(
                `${this.paymongoApi}/checkout_sessions/${reference}`,
                { headers: this.getPayMongoAuthHeader() }
            );

            const paymentData = response.data;
            
            // Update payment status in database
            await Payment.findOneAndUpdate(
                { transactionId: reference },
                { 
                    status: paymentData.data.attributes.status === 'paid' ? 'completed' : 'pending',
                    paymentDetails: paymentData
                }
            );

            return paymentData;
        } catch (error) {
            logger.error('Payment verification error:', error);
            throw error;
        }
    }

    async processPaymentWebhook(webhookData: any, gateway: string): Promise<any> {
        try {
            logger.info(`Processing ${gateway} webhook:`, webhookData);

            let paymentId, status;

            switch (gateway) {
                case 'paymongo':
                    paymentId = webhookData.data.attributes.data.id;
                    status = webhookData.data.attributes.data.attributes.status;
                    break;
                case 'dragonpay':
                    paymentId = webhookData.txnid;
                    status = webhookData.status;
                    break;
                default:
                    throw new Error('Unsupported gateway');
            }

            // Update payment status
            const payment = await Payment.findOneAndUpdate(
                { transactionId: paymentId },
                {
                    status: status === 'success' || status === 'paid' ? 'completed' : 'failed',
                    paymentDetails: webhookData
                },
                { new: true }
            );

            if (payment && (status === 'success' || status === 'paid')) {
                // Update billing if exists
                if (payment.billingId) {
                    await Billing.findByIdAndUpdate(payment.billingId, {
                        status: 'paid',
                        paidAt: new Date()
                    });
                }

                // Update user balance or status if needed
                await User.findByIdAndUpdate(payment.userId, {
                    $inc: { balance: -payment.amount }
                });
            }

            return payment;
        } catch (error) {
            logger.error('Webhook processing error:', error);
            throw error;
        }
    }

    async refundPayment(paymentId: string, reason: string): Promise<any> {
        try {
            const payment = await Payment.findById(paymentId);

            if (!payment) {
                throw new Error('Payment not found');
            }

            // Implement refund logic based on gateway
            if (payment.paymentMethod === 'paymongo') {
                const response = await axios.post(
                    `${this.paymongoApi}/refunds`,
                    {
                        data: {
                            attributes: {
                                amount: payment.amount * 100,
                                payment_id: payment.transactionId,
                                reason
                            }
                        }
                    },
                    { headers: this.getPayMongoAuthHeader() }
                );

                payment.status = 'refunded';
                await payment.save();

                return response.data;
            }

            throw new Error('Refund not supported for this payment method');
        } catch (error) {
            logger.error('Refund processing error:', error);
            throw error;
        }
    }
}

export default new PaymentService();