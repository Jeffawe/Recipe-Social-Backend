import express from 'express';
import { authenticateToken, isAdmin } from '../middleware/auth.js';
import {
    getUserProfile,
    getUserCreatedRecipes,
    getUserSavedRecipes,
    updateUserProfile,
    authController,
    deleteUserAccount,
    getAllUsers
  } from '../controllers/userController.js';

const router = express.Router();

router.post('/google', authController.googleAuth);

router.post('/register', authController.register);

router.post('/login', authController.login);

router.get('/verify', authenticateToken, authController.verify);

router.get('/get/:id', getUserProfile);

router.get('/:id/recipes/created', getUserCreatedRecipes);

router.get('/users', authenticateToken, getAllUsers);

router.get('/:id/recipes/saved', authenticateToken, getUserSavedRecipes);

router.delete('/delete/:id', authenticateToken, isAdmin, deleteUserAccount)

router.patch('/:id', authenticateToken, updateUserProfile);

export default router;