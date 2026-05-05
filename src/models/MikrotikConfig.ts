import mongoose, { Schema, Document } from 'mongoose';

export interface IMikrotikConfig extends Document {
    host: string;
    port: number;
    username: string;
    password: string;
    useSSL: boolean;
    isActive: boolean;
    settings: {
        hotspotEnabled: boolean;
        pppoeEnabled: boolean;
        dhcpEnabled: boolean;
        queueTree: string;
        defaultProfile: string;
    };
    lastSync: Date;
    status: 'connected' | 'disconnected' | 'error';
    createdAt: Date;
    updatedAt: Date;
}

const MikrotikConfigSchema: Schema = new Schema({
    host: { type: String, required: true },
    port: { type: Number, default: 8728 },
    username: { type: String, required: true },
    password: { type: String, required: true },
    useSSL: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    settings: {
        hotspotEnabled: { type: Boolean, default: false },
        pppoeEnabled: { type: Boolean, default: true },
        dhcpEnabled: { type: Boolean, default: true },
        queueTree: { type: String, default: 'simple' },
        defaultProfile: { type: String, default: 'default' }
    },
    lastSync: { type: Date },
    status: { 
        type: String, 
        enum: ['connected', 'disconnected', 'error'],
        default: 'disconnected'
    }
}, {
    timestamps: true
});

export default mongoose.model<IMikrotikConfig>('MikrotikConfig', MikrotikConfigSchema);