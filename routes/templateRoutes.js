import express from 'express';
import { authenticateToken } from '../middleware/auth.js'; 
import {
    createTemplate,
    getAllTemplates,
    getUserTemplate,
    getUserTemplates,
    updateTemplate,
    deleteTemplate,
    saveTemplate
} from '../controllers/templateController.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Create a new template
router.post('/', createTemplate);

router.put('/:id', getUserTemplate);

router.get('/public', getAllTemplates);

// Get logged-in user's templates (both private and public)
router.get('/user/:id', getUserTemplates);

router.post('/save', saveTemplate);

// Update a template
router.put('/:id', updateTemplate);

// Delete a template
router.delete('/:id', deleteTemplate);

export default router;