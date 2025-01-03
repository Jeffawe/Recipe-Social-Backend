import mongoose from 'mongoose';

// FAQ Schema
const FAQSchema = new mongoose.Schema({
    question: {
        type: String,
        required: true,
        trim: true
    },
    answer: {
        type: String,
        required: true,
        trim: true
    }
}, {
    timestamps: true
});

export default mongoose.model('FAQ', FAQSchema);
