import mongoose from 'mongoose';

// Define the schema for a Recipe
const TemplateSchema = new mongoose.Schema({
    template: {
        type: String,
        required: true,
        trim: true
    },

    // User who created the recipe
    author: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    public: {
        type: Boolean,
        required: true
    },
    recipeCount: {
        type: Number,
        default: 0 // Initialize to 0
    }
})

export default mongoose.model('Templates', TemplateSchema);