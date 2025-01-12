import mongoose from 'mongoose';

const CommentSchema = new mongoose.Schema({
    author: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true  // Add this for better query performance
    },
    recipe: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Recipe', 
        required: true,
        index: true  // Add this for better query performance
    },
    content: {
        type: String,
        required: true,
        trim: true,
        maxlength: 1000,
        minlength: 1  // Consider adding this
    },
    likes: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    parentComment: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Comment',
        default: null,
        index: true  // Add this for better nested queries
    },
    isEdited: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

// Add compound index for common queries
CommentSchema.index({ recipe: 1, createdAt: -1 });

export default mongoose.model('Comment', CommentSchema);
