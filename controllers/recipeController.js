import { uploadImagesToS3, getPresignedUrl } from './services/s3services.js';
import Recipe from '../models/Recipe.js';
import User from '../models/User.js';
import Template from '../models/Template.js';

export const createRecipe = async (req, res) => {
    try {
        const ingredients = JSON.parse(req.body.ingredients);
        const directions = JSON.parse(req.body.directions);

        // Function to normalize ingredient for comparison
        const normalizeIngredient = (ing) => ({
            name: ing.name.toLowerCase().trim(),
            quantity: ing.quantity.toString(),
            unit: ing.unit ? ing.unit.toLowerCase() : ''
        });

        // Function to normalize direction for comparison
        const normalizeDirection = (dir) => ({
            instruction: dir.instruction.toLowerCase().trim()
        });

        // Check for existing recipe with same title, ingredients, and directions
        const existingRecipe = await Recipe.findOne({
            $and: [
                { title: { $regex: new RegExp('^' + req.body.title.trim() + '$', 'i') } },
                {
                    $expr: {
                        $eq: [
                            { $size: '$ingredients' },
                            ingredients.length
                        ]
                    }
                },
                {
                    $expr: {
                        $eq: [
                            { $size: '$directions' },
                            directions.length
                        ]
                    }
                }
            ]
        });

        if (existingRecipe) {
            // If we found a potential match, do detailed comparison
            const normalizedNewIngredients = ingredients.map(normalizeIngredient);
            const normalizedNewDirections = directions.map(normalizeDirection);

            const normalizedExistingIngredients = existingRecipe.ingredients.map(normalizeIngredient);
            const normalizedExistingDirections = existingRecipe.directions.map(normalizeDirection);

            const ingredientsMatch = JSON.stringify(normalizedNewIngredients.sort((a, b) =>
                a.name.localeCompare(b.name))) === JSON.stringify(normalizedExistingIngredients.sort((a, b) =>
                    a.name.localeCompare(b.name)));

            const directionsMatch = JSON.stringify(normalizedNewDirections) ===
                JSON.stringify(normalizedExistingDirections);

            if (ingredientsMatch && directionsMatch) {
                return res.status(400).json({
                    message: 'A similar recipe already exists',
                    existingRecipeId: existingRecipe._id
                });
            }
        }
        let uploadedImages = [];
        if (req.files && req.files.length > 0) {
            uploadedImages = await uploadImagesToS3(req.files);
        }

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
            featured,
            popular,
            latest,
            category
        } = req.query;

        const filter = {};
        if (category) filter.category = category;
        if (featured === 'true') filter.featured = true;
        if (popular === 'true') filter.popular = true;

        let recipes;
        let total;

        if (latest === 'true') {
            // Get latest recipes using the helper function
            const { recipes: latestRecipes, total: latestTotal } = await getLatestRecipes(filter, page, limit);
            recipes = latestRecipes;
            total = latestTotal;
        } else {
            // Find recipes with filtering, pagination, and population
            recipes = await Recipe.find(filter)
                .limit(limit * 1)
                .skip((page - 1) * limit)
                .populate('author', 'username')
                .sort({ createdAt: -1 });

            // Count total recipes for pagination
            total = await Recipe.countDocuments(filter);
        }

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

const getLatestRecipes = async (filter, page, limit) => {
    const timeAgo = new Date();
    timeAgo.setDate(timeAgo.getDate() - 7); // Last 7 days

    // Combine the date filter with any existing filters
    const dateFilter = {
        ...filter,
        createdAt: { $gte: timeAgo }
    };

    const recipes = await Recipe.find(dateFilter)
        .limit(limit * 1)
        .skip((page - 1) * limit)
        .populate('author', 'username')
        .sort({ createdAt: -1 });

    // Count total recipes for pagination
    const total = await Recipe.countDocuments(dateFilter);

    return { recipes, total };
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
        const recipe = await Recipe.findById(req.params.id);

        if (!recipe) {
            return res.status(404).json({ message: 'Recipe not found' });
        }

        if (recipe.author.toString() !== req.user.userId.toString()) {
            return res.status(403).json({ message: 'Not authorized to update this recipe' });
        }

        let uploadedImages = [];
        let existingImages = [];

        // Handle existing images
        try {
            existingImages = req.body.existingImages ? JSON.parse(req.body.existingImages) : [];
        } catch (error) {
            console.error('Error parsing existingImages:', error);
            existingImages = [];
        }

        if (req.files && req.files.length > 0) {
            uploadedImages = await uploadImagesToS3(req.files);
        }

        const updatedImages = [...existingImages, ...uploadedImages];

        const oldTemplateId = recipe.templateID;
        const newTemplateId = req.body.templateID;

        const updatedData = {
            title: req.body.title || recipe.title,
            description: req.body.description || recipe.description,

            ingredients: req.body.ingredients
                ? JSON.parse(req.body.ingredients)
                : recipe.ingredients,

            directions: req.body.directions
                ? JSON.parse(req.body.directions)
                : recipe.directions,

            images: updatedImages.length > 0
                ? updatedImages
                : recipe.images,

            // Cooking Time
            cookingTime: req.body.cookingTime
                ? JSON.parse(req.body.cookingTime)
                : recipe.cookingTime,

            // Nutritional Information
            nutrition: req.body.nutrition
                ? JSON.parse(req.body.nutrition)
                : recipe.nutrition,

            category: req.body.category || recipe.category,

            comments: recipe.comments,
            faqs: recipe.faqs,
            likes: recipe.likes,

            // Metadata Flags
            featured: req.body.featured !== undefined
                ? req.body.featured
                : recipe.featured,
            latest: req.body.latest !== undefined
                ? req.body.latest
                : recipe.latest,
            popular: req.body.popular !== undefined
                ? req.body.popular
                : recipe.popular,

            // Template Information
            templateID: req.body.templateID || recipe.templateID,
            templateString: req.body.templateString[1] || recipe.templateString,

            // Author is kept as the current user
            author: req.user.userId,

            updatedAt: Date.now()
        };


        const updatedRecipe = await Recipe.findByIdAndUpdate(
            req.params.id,
            { $set: updatedData },
            { new: true } // Return the updated document
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