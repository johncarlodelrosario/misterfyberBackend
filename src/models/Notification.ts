import mongoose, { Schema, Document } from 'mongoose';

export interface INotification extends Document {
    userId: mongoose.Types.ObjectId;
    type: 'email' | 'sms' | 'push' | 'system';
    title: string;
    message: string;
    data: any;
    isRead: boolean;
    priority: 'low' | 'normal' | 'high' | 'urgent';
    sentAt: Date;
    readAt: Date;
    createdAt: Date;
}

const NotificationSchema: Schema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { 
        type: String, 
        enum: ['email', 'sms', 'push', 'system'],
        required: true 
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    data: { type: Schema.Types.Mixed },
    isRead: { type: Boolean, default: false },
    priority: { 
        type: String, 
        enum: ['low', 'normal', 'high', 'urgent'],
        default: 'normal'
    },
    sentAt: { type: Date, default: Date.now },
    readAt: { type: Date }
}, {
    timestamps: true
});

export default mongoose.model<INotification>('Notification', NotificationSchema);