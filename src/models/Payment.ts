import mongoose, { Schema, Document } from 'mongoose';

export interface IPayment extends Document {
    userId: mongoose.Types.ObjectId;
    amount: number;
    currency: string;
    paymentMethod: 'paymongo' | 'dragonpay' | 'gcash' | 'maya' | 'card' | 'bank_transfer';
    paymentType: 'subscription' | 'installation' | 'others';
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'refunded';
    transactionId: string;
    referenceNumber: string;
    paymentDetails: {
        gateway: string;
        gatewayResponse: any;
        paymentIntentId?: string;
        paymentMethodId?: string;
    };
    billingId: mongoose.Types.ObjectId;
    metadata: any;
    paidAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

const PaymentSchema: Schema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'PHP' },
    paymentMethod: { 
        type: String, 
        enum: ['paymongo', 'dragonpay', 'gcash', 'maya', 'card', 'bank_transfer'],
        required: true 
    },
    paymentType: { 
        type: String, 
        enum: ['subscription', 'installation', 'others'],
        default: 'subscription'
    },
    status: { 
        type: String, 
        enum: ['pending', 'processing', 'completed', 'failed', 'refunded'],
        default: 'pending'
    },
    transactionId: { type: String },
    referenceNumber: { type: String, unique: true },
    paymentDetails: {
        gateway: { type: String },
        gatewayResponse: { type: Schema.Types.Mixed },
        paymentIntentId: { type: String },
        paymentMethodId: { type: String }
    },
    billingId: { type: Schema.Types.ObjectId, ref: 'Billing' },
    metadata: { type: Schema.Types.Mixed },
    paidAt: { type: Date }
}, {
    timestamps: true
});

// Generate reference number before saving
PaymentSchema.pre('save', function(next) {
    if (!this.referenceNumber) {
        const timestamp = Date.now().toString(36).toUpperCase();
        const random = Math.random().toString(36).substring(2, 8).toUpperCase();
        this.referenceNumber = `PAY-${timestamp}-${random}`;
    }
    next();
});

export default mongoose.model<IPayment>('Payment', PaymentSchema);