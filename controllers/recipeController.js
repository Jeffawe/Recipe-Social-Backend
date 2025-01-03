import { uploadImagesToS3, getPresignedUrl } from './services/s3services.js';
import Recipe from '../models/Recipe.js';
import User from '../models/User.js';
import Template from '../models/Template.js';

export const createRecipe = async (req, res) => {
    try {
        let uploadedImages = [];
        if (req.files && req.files.length > 0) {
            uploadedImages = await uploadImagesToS3(req.files);
        }

        const ingredients = JSON.parse(req.body.ingredients);
        const directions = JSON.parse(req.body.directions);

        const newRecipe = new Recipe({
            title: req.body.title,
            description: req.body.description,
            ingredients,
            directions,
            images: uploadedImages,
            cookingTime: JSON.parse(req.body.cookingTime),
            nutrition: JSON.parse(req.body.nutrition),
            category: req.body.category,
            author: req.user.userId,
            featured: false,
            latest: false,
            popular: false,
            templateID: req.body.templateID || null,
            templateString: req.body.templateString[1] || ''
        });

        const savedRecipe = await newRecipe.save();

        // Update the user's createdRecipes array
        await User.findByIdAndUpdate(
            req.user.userId,
            {
                $push: { createdRecipes: savedRecipe._id }
            },
            { new: true }
        );

        if (req.body.templateID) {
            await Template.findByIdAndUpdate(req.body.templateID, {
                $inc: { recipeCount: 1 }
            });
        }

        res.status(201).json(savedRecipe);
    } catch (error) {
        res.status(500).json({
            message: 'Error creating recipe',
            error: error.message
        });
    }
}

// Get all recipes with filtering and pagination
export const getAllRecipes = async (req, res) => {
    try {
        // Extract query parameters
        const {
            page = 1,
            limit = 10,
            category
        } = req.query;

        const filter = {};
        if (category) filter.category = category;

        // Find recipes with filtering, pagination, and population
        const recipes = await Recipe.find(filter)
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .populate('author', 'username') // Get author's username
            .sort({ createdAt: -1 }); // Sort by most recent first

        // Count total recipes for pagination
        const total = await Recipe.countDocuments(filter);

        const recipesWithUrls = await Promise.all(
            recipes.map(async (recipe) => {
                const imagesWithUrls = await Promise.all(
                    recipe.images.map(async (image) => {
                        const url = await getPresignedUrl(image.fileName);
                        return { ...image.toObject(), url };
                    })
                );
                return { ...recipe.toObject(), images: imagesWithUrls };
            })
        );

        res.json({
            recipes: recipesWithUrls,
            totalPages: Math.ceil(total / limit),
            currentPage: page
        });
    } catch (error) {
        res.status(500).json({
            message: 'Error fetching recipes',
            error: error.message
        });
    }
};

// Get a single recipe by ID
export const getSingleRecipe = async (req, res) => {
    try {
        // Find recipe by ID and populate related data
        const recipe = await Recipe.findById(req.params.id)
            .populate('author', 'username email');

        // Check if recipe exists
        if (!recipe) {
            return res.status(404).json({ message: 'Recipe not found' });
        }

        const imagesWithUrls = await Promise.all(
            recipe.images.map(async (image) => {
                const url = await getPresignedUrl(image.fileName);
                return { ...image.toObject(), url };
            })
        );

        res.json({ ...recipe.toObject(), images: imagesWithUrls });
    } catch (error) {
        res.status(500).json({
            message: 'Error fetching recipe',
            error: error.message
        });
    }
};

export const updateRecipe = async (req, res) => {
    try {
        console.log(req.body)
        const recipe = await Recipe.findById(req.params.id);

        if (!recipe) {
            return res.status(404).json({ message: 'Recipe not found' });
        }

        if (recipe.author.toString() !== req.user.userId.toString()) {
            return res.status(403).json({ message: 'Not authorized to update this recipe' });
        }

        const { existingImages } = req.body;
        let uploadedImages = [];

        // Upload new images if files are provided
        if (req.files && req.files.length > 0) {
            uploadedImages = await uploadImagesToS3(req.files);
        }

        const updatedImages = [
            ...(existingImages ? JSON.parse(existingImages) : []), // Parse JSON string from frontend
            ...uploadedImages,
        ];

        console.log(uploadedImages)

        const oldTemplateId = recipe.templateID;
        const newTemplateId = req.body.templateID;

        return;

        // Update recipe with new data
        const updatedRecipe = await Recipe.findByIdAndUpdate(
            req.params.id,
            {
                ...req.body,
                images: updatedImages,
            },
            { new: true, runValidators: true }
        );

        // Handle template changes
        if (oldTemplateId && oldTemplateId.toString() !== newTemplateId?.toString()) {
            // Decrement count for old template
            await Template.findByIdAndUpdate(oldTemplateId, { $inc: { recipeCount: -1 } });

            // Remove private templates with 0 recipes
            await Template.deleteMany({ public: false, recipeCount: { $lte: 0 } });
        }

        if (newTemplateId && oldTemplateId?.toString() !== newTemplateId.toString()) {
            // Increment count for new template
            await Template.findByIdAndUpdate(newTemplateId, { $inc: { recipeCount: 1 } });
        }

        res.json({
            message: 'Recipe updated successfully',
            recipe: updatedRecipe
        });
    } catch (error) {
        res.status(400).json({
            message: 'Error updating recipe',
            error: error.message
        });
    }
};

// Delete a recipe
export const deleteRecipe = async (req, res) => {
    try {
        const recipe = await Recipe.findById(req.params.id);

        if (!recipe) {
            return res.status(404).json({ message: 'Recipe not found' });
        }

        if (recipe.author.toString() !== req.user.userId.toString()) {
            return res.status(403).json({ message: 'Not authorized to delete this recipe' });
        }

        const templateId = recipe.templateID;

        // Remove recipe
        await Recipe.findByIdAndDelete(req.params.id);

        if (templateId) {
            // Decrement count for the associated template
            await Template.findByIdAndUpdate(templateId, { $inc: { recipeCount: -1 } });

            // Remove private templates with 0 recipes
            await Template.deleteMany({ public: false, recipeCount: { $lte: 0 } });
        }

        res.json({ message: 'Recipe deleted successfully' });
    } catch (error) {
        res.status(500).json({
            message: 'Error deleting recipe',
            error: error.message
        });
    }
};

// Search recipes (basic implementation)
export const searchRecipes = async (req, res) => {
    try {
        const { query } = req.query;

        // Perform text search
        const recipes = await Recipe.find(
            { $text: { $search: query } },
            { score: { $meta: "textScore" } }
        )
            .sort({ score: { $meta: "textScore" } })
            .limit(10);

        res.json(recipes);
    } catch (error) {
        res.status(500).json({
            message: 'Error searching recipes',
            error: error.message
        });
    }
};

export const likeRecipe = async (req, res) => {
    try {
        const recipe = await Recipe.findById(req.params.id);
        const user = req.user.userId;

        const isLiked = recipe.likes.includes(user);
        const update = isLiked
            ? { $pull: { likes: user } }
            : { $addToSet: { likes: user } };

        const updatedRecipe = await Recipe.findByIdAndUpdate(
            req.params.id,
            update,
            { new: true }
        );

        res.json({
            success: true,
            likes: updatedRecipe.likes.length,
            isLiked: !isLiked
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const saveRecipe = async (req, res) => {
    try {
        const user = await User.findById(req.user.userId);
        const recipeId = req.params.id;

        const isSaved = user.savedRecipes.includes(recipeId);
        const update = isSaved
            ? { $pull: { savedRecipes: recipeId } }
            : { $addToSet: { savedRecipes: recipeId } };

        await User.findByIdAndUpdate(req.user.userId, update);

        res.json({
            success: true,
            isSaved: !isSaved
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const getImages = async (req, res) => {
    const recipeId = req.params.id;

    try {
      const recipe = await Recipe.findById(recipeId);
      if (!recipe) {
        return res.status(404).json({ message: 'Recipe not found' });
      }
      return res.json(recipe.images);  // Return the images array
    } catch (error) {
      console.error('Error fetching images:', error);
      res.status(500).json({ message: 'Server error' });
    }
};