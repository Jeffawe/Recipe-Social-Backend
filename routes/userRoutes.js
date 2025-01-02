import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
    getUserProfile,
    getUserCreatedRecipes,
    getUserSavedRecipes,
    updateUserProfile,
    authController
  } from '../controllers/userController.js';

const router = express.Router();

router.post('/google', authController.googleAuth);

router.post('/register', authController.register);

router.post('/login', authController.login);

router.get('/verify', authenticateToken, authController.verify);

router.get('/:id', getUserProfile);

router.get('/:id/recipes/created', getUserCreatedRecipes);

router.get('/:id/recipes/saved', getUserSavedRecipes);

// Protected routes (require authentication)
router.patch('/:id', authenticateToken, updateUserProfile);

export default router;