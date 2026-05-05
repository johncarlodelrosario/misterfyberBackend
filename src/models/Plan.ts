import mongoose, { Schema, Document } from 'mongoose';

export interface IPlan extends Document {
    name: string;
    description: string;
    price: number;
    speed: {
        download: number;
        upload: number;
        unit: 'Mbps' | 'Gbps';
    };
    dataCap: number | null; // null for unlimited
    features: string[];
    mikrotikProfile: string;
    duration: number; // in days
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const PlanSchema: Schema = new Schema({
    name: { type: String, required: true },
    description: { type: String, required: true },
    price: { type: Number, required: true },
    speed: {
        download: { type: Number, required: true },
        upload: { type: Number, required: true },
        unit: { type: String, enum: ['Mbps', 'Gbps'], default: 'Mbps' }
    },
    dataCap: { type: Number, default: null },
    features: [{ type: String }],
    mikrotikProfile: { type: String, required: true },
    duration: { type: Number, default: 30 }, // 30 days by default
    isActive: { type: Boolean, default: true }
}, {
    timestamps: true
});

export default mongoose.model<IPlan>('Plan', PlanSchema);