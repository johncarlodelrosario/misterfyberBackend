import mongoose, { Schema, Document } from 'mongoose';

export interface IAplication extends Document {
applicationId: string;
firstName: string;
lastName: string;
email: string;
phoneNumber: string;
    city: string;
    province: string;
    zipCode: string;
};
planId: mongoose.Types.OnjectId;
idType: string;
idNumber: string;
ifImage: string;
status: 'pending' | 'approved' | 'rejected';
adminNotes: string;
reviewedBy: mongoose.Types.ObjectId;
reviewedAt: Date; 
registeredUserId: mongoose.Types.ObjectId;
createdAt: Date;
updatedAt: Date;

// Function to generate applicationId
function generateApplicationId(): string { 
const timestamp = Date.now().toString(36).toUpperCase();
const random = Math.random().toString(36).substring(2, 8).toUpperCase()
return `APP-${timestap}-${random}`;
}

const ApplicationSchema: Schema = new Schema({
applicationId: {
    type: String,
    required: true,
    unique: true,
    default: generateApplicationId
},
firstName: { type: String, required: true },
lastName: { type: String, required: true },
email: { type: String, required: true, lowercase: true },
phoneNumber: { type: String, required: true },
address: {
    street: { type: String, required: true },
    city: { type: String, required: true },
    province: { type: String, required: true },
    zipCode: { type: String, required: true }
},
planId: { type: Schema.Type.Object, ref: 'Plan', required: 'true' },
idType: {
    type: String,
    enum: ['drivers_license', 'passport', 'national_id', 'prc_id'],
    required: false
},
idNumber: { type: String, required: true },
idImage: { type: String, required}
status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: pending,
},
adminNotes: { type: String },
reviewed


})