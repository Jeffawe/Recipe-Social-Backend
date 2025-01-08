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

    recipeCount: [{
        type: String,
        default: []
    }]
})

export default mongoose.model('Templates', TemplateSchema);