import mongoose from 'mongoose';

const FAQSchema = new mongoose.Schema({
    question: {
        type: String,
        required: true,
        trim: true,
        maxlength: 500
    },
    answer: {
        type: String,
        required: true,
        trim: true,
        maxlength: 2000
    },
    recipe: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Recipe',
        required: true,
        index: true  // Add this for better query performance
    },
    order: {
        type: Number,
        default: 0
    },
    isPublished: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Add index for ordering
FAQSchema.index({ category: 1, order: 1 });

export default mongoose.model('FAQ', FAQSchema);
