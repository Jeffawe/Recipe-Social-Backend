import express from 'express';
import { verifyAdmin, clearCache } from '../controllers/adminController.js';
import { authenticateToken, isAdmin } from '../middleware/auth.js';

const router = express.Router();

router.post('/', verifyAdmin);

router.delete('/clear', authenticateToken, isAdmin, clearCache);

export default router;