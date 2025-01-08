import express from 'express';
import { authenticateToken, isAdmin } from '../middleware/auth.js'; 
import {
    createTemplate,
    getAllTemplates,
    getUserTemplate,
    getUserTemplates,
    updateTemplate,
    deleteTemplate,
    saveTemplate,
    getEverySingleTemplates
} from '../controllers/templateController.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Create a new template
router.post('/', createTemplate);

router.put('/:id', getUserTemplate);

router.get('/public', isAdmin, getAllTemplates);

router.get('/admin/templates', authenticateToken, isAdmin, getEverySingleTemplates);

// Get logged-in user's templates (both private and public)
router.get('/user/:id', isAdmin, getUserTemplates);

router.post('/save', saveTemplate);

// Update a template
router.put('/update/:id/', isAdmin, updateTemplate);

// Delete a template
router.delete('/:id', isAdmin, deleteTemplate);

export default router;