import express from 'express';
import multer from 'multer';
import { 
  createRecipe, 
  getAllRecipes, 
  getSingleRecipe, 
  updateRecipe, 
  deleteRecipe, 
  searchRecipes ,
  likeRecipe,
  saveRecipe,
  getImages
} from '../controllers/recipeController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Configure multer
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024  // 5MB limit per file
    }
});

// Route to get all recipes
router.get('/', getAllRecipes);

// Route to get a single recipe
router.get('/:id', getSingleRecipe);

// Route to create a new recipe
router.post('/', authenticateToken, upload.array('images', 5), createRecipe);

router.post('/:id/like', authenticateToken, likeRecipe);

router.post('/:id/save', authenticateToken, saveRecipe);

router.get(':id/images', authenticateToken, getImages)

// Route to search recipes
router.get('/search', searchRecipes);

// Route to update a recipe
router.put('/:id', authenticateToken, updateRecipe);

// Route to delete a recipe
router.delete('/:id', authenticateToken, deleteRecipe);

export default router;