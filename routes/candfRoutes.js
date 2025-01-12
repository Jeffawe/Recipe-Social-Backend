import express from 'express';
import { commentController, faqController } from '../controllers/candfController.js';
import { authenticateToken } from '../middleware/auth.js';
const router = express.Router();

// Comment routes
router.post('/comments', authenticateToken, commentController.createComment);
router.get('/comments/:recipeId', commentController.getComments);
router.patch('/comments/:commentId', authenticateToken, commentController.updateComment);
router.delete('/comments/:commentId', authenticateToken, commentController.deleteComment);
router.post('/comments/:commentId/like', authenticateToken, commentController.toggleLike);

// FAQ routes (with admin protection for CUD operations)
router.post('/faqs', authenticateToken, faqController.createFAQ);
router.get('/faqs', faqController.getAllFAQs);
router.patch('/faqs/:faqId', authenticateToken, faqController.updateFAQ);
router.delete('/faqs/:faqId', authenticateToken, faqController.deleteFAQ);

export default router;