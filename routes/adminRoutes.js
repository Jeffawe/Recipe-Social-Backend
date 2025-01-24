import express from 'express';
import { verifyAdmin, clearCache } from '../controllers/adminController.js';
import { isAdmin } from '../middleware/auth.js';

const router = express.Router();

router.post('/', verifyAdmin);

router.delete('/clear', isAdmin, clearCache);

export default router;