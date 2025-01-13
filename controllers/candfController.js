import Comment from '../models/Comment.js';
import FAQ from '../models/FAQ.js';
import { cacheUtils, CACHE_DURATIONS } from '../cache/cacheconfig.js'

const COMMENTS_PER_PAGE = 10;

export const commentController = {
    // Create a new comment
    createComment: async (req, res) => {
        try {
            const { content, recipeId, parentCommentId } = req.body;
            const comment = new Comment({
                content,
                author: req.user._id,  // Assuming you have auth middleware
                recipe: recipeId,
                parentComment: parentCommentId || null
            });
            await comment.save();

            // Populate author details for immediate return
            await comment.populate('author', 'username');
            await cacheUtils.deleteCache(`comment:${comment.recipe}`)
            res.status(201).json(comment);
        } catch (error) {
            res.status(400).json({ message: error.message });
        }
    },

    // Get comments for a recipe (paginated)
    getComments: async (req, res) => {
        try {
            const { recipeId } = req.params;
            const cacheKey = `comment:${recipeId}`;

            const cachedRecipe = await cacheUtils.getCache(cacheKey);
            if (cachedRecipe) {
                return res.json(cachedRecipe);
            }

            const page = parseInt(req.query.page) || 1;
            const skip = (page - 1) * COMMENTS_PER_PAGE;

            const comments = await Comment.find({
                recipe: recipeId,
                parentComment: null
            })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(COMMENTS_PER_PAGE)
                .populate('author', 'username')
                .populate({
                    path: 'likes',
                    select: 'username'
                });

            const totalComments = await Comment.countDocuments({
                recipe: recipeId,
                parentComment: null
            });

            const response = {
                comments,
                hasMore: totalComments > skip + comments.length
            }

            // Cache the response
            await cacheUtils.setCache(cacheKey, response, CACHE_DURATIONS.SINGLE_RECIPE);
            res.json(response);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    },

    updateComment: async (req, res) => {
        try {
            const { commentId } = req.params;
            const { content } = req.body;

            const comment = await Comment.findById(commentId);
            if (!comment) {
                return res.status(404).json({ message: 'Comment not found' });
            }

            // Check if user is the author
            if (comment.author.toString() !== req.user._id.toString()) {
                return res.status(403).json({ message: 'Unauthorized' });
            }

            comment.content = content;
            comment.isEdited = true;
            await comment.save();
            await cacheUtils.deleteCache(`comment:${comment.recipe}`)
            res.json(comment);
        } catch (error) {
            res.status(400).json({ message: error.message });
        }
    },

    // Delete a comment
    deleteComment: async (req, res) => {
        try {
            const { commentId } = req.params;
            const comment = await Comment.findById(commentId);

            if (!comment) {
                return res.status(404).json({ message: 'Comment not found' });
            }

            // Check if user is the author
            if (comment.author.toString() !== req.user._id.toString()) {
                return res.status(403).json({ message: 'Unauthorized' });
            }

            await comment.deleteOne();
            await cacheUtils.deleteCache(`comment:${comment.recipe}`)
            res.json({ message: 'Comment deleted' });
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    },

    toggleLike: async (req, res) => {
        try {
            const { commentId } = req.params;
            const userId = req.user._id;

            const comment = await Comment.findById(commentId);
            if (!comment) {
                return res.status(404).json({ message: 'Comment not found' });
            }

            const likeIndex = comment.likes.indexOf(userId);
            if (likeIndex === -1) {
                comment.likes.push(userId);
            } else {
                comment.likes.splice(likeIndex, 1);
            }

            await comment.save();
            res.json(comment);
        } catch (error) {
            res.status(400).json({ message: error.message });
        }
    }
};

export const faqController = {
    createFAQ: async (req, res) => {
        try {
            const { question, answer, recipeId } = req.body;
            const faq = new FAQ({ question, answer, recipe: recipeId });
            await faq.save();
            await cacheUtils.deleteCache(`faq:${faq.recipe}`)
            res.status(201).json(faq);
        } catch (error) {
            res.status(400).json({ message: error.message });
        }
    },

    getAllFAQs: async (req, res) => {
        try {
            const recipeId = req.params.id;
            const cacheKey = `faq:${recipeId}`;

            const cachedRecipe = await cacheUtils.getCache(cacheKey);
            if (cachedRecipe) {
                return res.json(cachedRecipe);
            }
            const faqs = await FAQ.find({recipe: recipeId})
                .sort({ createdAt: -1 })
                .limit(10);  // Limit to 10 FAQs

            await cacheUtils.setCache(cacheKey, faqs, CACHE_DURATIONS.SINGLE_RECIPE)
            res.json(faqs);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    },

    updateFAQ: async (req, res) => {
        try {
            const { faqId } = req.params;
            const { question, answer } = req.body;

            const faq = await FAQ.findByIdAndUpdate(
                faqId,
                { question, answer },
                { new: true }
            );

            if (!faq) {
                return res.status(404).json({ message: 'FAQ not found' });
            }

            await cacheUtils.deleteCache(`faq:${faq.recipe}`)
            res.json(faq);
        } catch (error) {
            res.status(400).json({ message: error.message });
        }
    },

    deleteFAQ: async (req, res) => {
        try {
            const { faqId } = req.params;
            const faq = await FAQ.findByIdAndDelete(faqId);

            if (!faq) {
                return res.status(404).json({ message: 'FAQ not found' });
            }
            
            await cacheUtils.deleteCache(`faq:${faq.recipe}`)
            res.json({ message: 'FAQ deleted' });
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }
};