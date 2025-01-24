import { uploadImagesToS3, getPresignedUrl, enhanceRecipeWithUrls } from './services/s3services.js';
import Recipe from '../models/Recipe.js';
import User from '../models/User.js';
import Template from '../models/Template.js';
import { cacheUtils, CACHE_DURATIONS } from '../cache/cacheconfig.js'
import { scrapeSitesInternal } from './scraperController.js';

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
                $push: { recipeCount: savedRecipe._id }
            });
        }

        const recipeWithUrls = await enhanceRecipeWithUrls(savedRecipe);
        await cacheUtils.setCache(
            `recipe:${savedRecipe._id}`,
            recipeWithUrls,
            CACHE_DURATIONS.SINGLE_RECIPE
        );

        // Clear list caches
        await Promise.all([
            cacheUtils.deleteCache(`user:${req.user.userId}:createdRecipes`),
            cacheUtils.clearCachePattern('recipes:*'),
            cacheUtils.deleteCache(`user:${req.user.userId}`),
            cacheUtils.clearCachePattern('latest:*'),
            cacheUtils.clearCachePattern(`category:${req.body.category}:*`),
            cacheUtils.clearCachePattern('search:*')
        ]);

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
            category,
            search
        } = req.query;

        const cacheKey = `recipes:${page}:${limit}:${featured}:${popular}:${latest}:${category}`;

        const cachedData = await cacheUtils.getCache(cacheKey);
        if (cachedData) {
            const parsedData = cachedData;

            // Fetch likes for cached recipes
            const recipeIds = parsedData.recipes.map((recipe) => recipe._id);
            const recipeLikeKeys = recipeIds.map((id) => `recipe-likes:${id}`);
            const cachedLikes = await cacheUtils.mget(recipeLikeKeys);

            if(!cachedLikes){
                return res.json(cachedData)
            }
            // Integrate likes into recipes
            parsedData.recipes = parsedData.recipes.map((recipe, index) => ({
                ...recipe,
                likes: cachedLikes[index]
                    ? JSON.parse(cachedLikes[index]) // Parse array of likes
                    : recipe.likes
            }));

            return res.json(parsedData);
        }

        const filter = {};
        if (category) filter.category = category;
        if (featured === 'true') filter.featured = true;
        if (popular === 'true') filter.popular = true;

        const search_data = {};

        if (search) {
            filter.$or = [
                { title: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } }
            ];

            search_data['title'] = search;
        }

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

        const recipeIds = recipes.map((recipe) => recipe._id);

        // Fetch likes for the recipes from Redis
        const recipeLikeKeys = recipeIds.map((id) => `recipe-likes:${id}`);
        const cachedLikes = await cacheUtils.mget(recipeLikeKeys);

        // Integrate likes into recipes
        const recipesWithLikes = await Promise.all(
            recipes.map(async (recipe, index) => {
                const imagesWithUrls = await Promise.all(
                    recipe.images.map(async (image) => {
                        const url = await getPresignedUrl(image.fileName);
                        return { ...image.toObject(), url };
                    })
                );

                return {
                    ...recipe.toObject(),
                    images: imagesWithUrls,
                    likes: cachedLikes[index]
                        ? JSON.parse(cachedLikes[index]) // Parse array of likes
                        : recipe.likes
                };
            })
        );

        // const recipesWithUrls = await Promise.all(
        //     recipes.map(async (recipe) => {
        //         const imagesWithUrls = await Promise.all(
        //             recipe.images.map(async (image) => {
        //                 const url = await getPresignedUrl(image.fileName);
        //                 return { ...image.toObject(), url };
        //             })
        //         );
        //         return { ...recipe.toObject(), images: imagesWithUrls };
        //     })
        // );

        if (search) {
            try {
                const additionalData = await scrapeSitesInternal(search_data, 0.3);
                
                if (additionalData && additionalData.success && additionalData.data.results) {
                    const externalRecipes = additionalData.data.results.map(result => ({
                        title: result.title,
                        pageURL: result.url,
                        images: [{
                            url: result.imageURL
                        }],
                        external: true,
                        author: mongoose.Types.ObjectId(), // Placeholder author
                        ingredients: [], // Empty ingredients
                        description: '', // Empty description
                        category: 'Uncategorized',
                        likes: []
                    }));

                    // Combine existing and external recipes
                    recipesWithLikes = [...recipesWithLikes, ...externalRecipes];
                    total += externalRecipes.length;
                }
            } catch (externalSearchError) {
                console.error('External search error:', externalSearchError);
            }
        }

        const response = {
            recipesWithLikes,
            totalPages: Math.ceil(total / limit),
            currentPage: page
        };

        // Cache the response
        await cacheUtils.setCache(
            cacheKey,
            response,
            latest === 'true' ? CACHE_DURATIONS.LATEST_RECIPES : CACHE_DURATIONS.RECIPE_LIST
        );

        res.json(response);
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
        const cacheKey = `recipe:${req.params.id}`;

        const cachedRecipe = await cacheUtils.getCache(cacheKey);
        if (cachedRecipe) {
            return res.json(cachedRecipe);
        }

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

        const response = { ...recipe.toObject(), images: imagesWithUrls };

        // Cache the response
        await cacheUtils.setCache(cacheKey, response, CACHE_DURATIONS.SINGLE_RECIPE);

        res.json(response);
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
            if (!req.isAdmin) {
                return res.status(403).json({ message: 'Not authorized to update this recipe' });
            }
        }

        const author = (req.isAdmin) ? recipe.author : req.user.userId

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
            author: author,

            updatedAt: Date.now()
        };


        const updatedRecipe = await Recipe.findByIdAndUpdate(
            req.params.id,
            { $set: updatedData },
            { new: true } // Return the updated document
        );

        const oldTemplateId = recipe.templateID;
        const newTemplateId = req.body.templateID;

        // Handle template changes
        if (oldTemplateId && oldTemplateId.toString() !== newTemplateId?.toString()) {
            await Template.findByIdAndUpdate(oldTemplateId, {
                $pull: { recipeCount: recipe.user_id }  // assuming recipe.user_id is the user's ID
            });

            // Remove private templates with empty recipeCount array
            await Template.deleteMany({
                public: false,
                recipeCount: { $size: 0 }  // checks if array is empty
            });
        }

        if (newTemplateId && oldTemplateId?.toString() !== newTemplateId.toString()) {
            await Template.findByIdAndUpdate(newTemplateId, {
                $addToSet: { recipeCount: recipe.user_id }  // using addToSet to prevent duplicates
            });
        }

        const recipeWithUrls = await enhanceRecipeWithUrls(updatedRecipe);
        await Promise.all([
            cacheUtils.setCache(
                `recipe:${req.params.id}`,
                recipeWithUrls,
                CACHE_DURATIONS.SINGLE_RECIPE
            ),
            cacheUtils.deleteCache(`user:${req.user.userId}`),
            cacheUtils.deleteCache(`user:${req.user.userId}:createdRecipes`),
            cacheUtils.clearCachePattern('recipes:*'),
            cacheUtils.clearCachePattern(`user:${author}:*`),
            cacheUtils.clearCachePattern('latest:*'),
            cacheUtils.clearCachePattern(`category:${updatedData.category}:*`),
            cacheUtils.clearCachePattern('search:*')
        ]);

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
            if (!req.isAdmin) {
                return res.status(403).json({ message: 'Not authorized to update this recipe' });
            }
        }

        const templateId = recipe.templateID;

        // Remove recipe
        await Recipe.findByIdAndDelete(req.params.id);

        if (templateId) {
            // Remove this user's ID from the template's recipeCount array
            await Template.findByIdAndUpdate(templateId, {
                $pull: { recipeCount: recipe.user_id }  // assuming recipe.user_id is the user's ID
            });

            // Remove private templates that have no users
            await Template.deleteMany({
                public: false,
                recipeCount: { $size: 0 }  // checks if array is empty
            });
        }

        await Promise.all([
            cacheUtils.deleteCache(`recipe:${req.params.id}`),
            cacheUtils.clearCachePattern('recipes:*'),
            cacheUtils.deleteCache(`user:${req.user.userId}`),
            cacheUtils.clearCachePattern('latest:*'),
            cacheUtils.clearCachePattern(`category:${category}:*`),
            cacheUtils.clearCachePattern('search:*')
        ]);

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
        const cacheKey = `search:${query}`;

        // Check cache first
        const cachedResults = await cacheUtils.getCache(cacheKey);
        if (cachedResults) {
            return res.json(cachedResults);
        }

        // Perform text search
        const recipes = await Recipe.find(
            { $text: { $search: query } },
            { score: { $meta: "textScore" } }
        )
            .sort({ score: { $meta: "textScore" } })
            .limit(10);

        await cacheUtils.setCache(cacheKey, recipes, CACHE_DURATIONS.RECIPE_LIST);
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
        const recipeId = req.params.id;
        const userId = req.user.userId;

        // Check if the user has already liked the recipe
        const userLikesKey = `recipe-user-likes:${userId}`;
        const userLikedRecipes = await cacheUtils.getCache(userLikesKey) || [];
        const hasLiked = userLikedRecipes.includes(recipeId);

        // Get current like count from cache
        const recipeLikesKey = `recipe-likes:${recipeId}`;
        const recipeLikes = (await cacheUtils.getCache(recipeLikesKey)) || [];

        if (hasLiked) {
            // Unlike the recipe
            const currentRecipeLikes = recipeLikes.filter((id) => id !== userId);
            const updatedUserLikes = userLikedRecipes.filter((id) => id !== recipeId);
            await Promise.all([
                cacheUtils.setCache(userLikesKey, updatedUserLikes, CACHE_DURATIONS.LIKE_STATUS),
                cacheUtils.setCache(recipeLikesKey, currentRecipeLikes, CACHE_DURATIONS.RECIPE_LIKE_COUNT),
                likeQueue.add(recipeId, userId, 'remove') // Add DB update task to queue
            ]);
        } else {
            // Like the recipe
            const currentRecipeLikes = [...recipeLikes, userId];
            const updatedUserLikes = [...userLikedRecipes, recipeId];
            await Promise.all([
                cacheUtils.setCache(userLikesKey, updatedUserLikes, CACHE_DURATIONS.USER_LIKE_STATUS),
                cacheUtils.setCache(recipeLikesKey, currentRecipeLikes, CACHE_DURATIONS.RECIPE_LIKE_COUNT),
                likeQueue.add(recipeId, userId, 'add') // Add DB update task to queue
            ]);
        }

        res.json({
            success: true,
            likes: currentLikes,
            isLiked: !hasLiked
        });
    } catch (error) {
        console.error('Like Recipe Error:', error);
        res.status(500).json({ message: error.message });
    }
};

// export const likeRecipe = async (req, res) => {
//     try {
//         const user = req.user.userId;

//         // Cache keys
//         const likeCacheKey = `like:${req.params.id}:${user}`;
//         const likeCountKey = `likeCount:${req.params.id}`

//         const isLiked = recipe.likes.includes(user);
//         const update = isLiked
//             ? { $pull: { likes: user } }
//             : { $addToSet: { likes: user } };

//         const updatedRecipe = await Recipe.findByIdAndUpdate(
//             req.params.id,
//             update,
//             { new: true }
//         );

//         res.json({
//             success: true,
//             likes: updatedRecipe.likes.length,
//             isLiked: !isLiked
//         });
//     } catch (error) {
//         res.status(500).json({ message: error.message });
//     }
// };

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
    try {
        const recipeId = req.params.id;
        const cacheKey = `images:${recipeId}`;
        const cachedImages = await cacheUtils.getCache(cacheKey);
        if (cachedImages) {
            return res.json(cachedImages);
        }

        const recipe = await Recipe.findById(recipeId);
        if (!recipe) {
            return res.status(404).json({ message: 'Recipe not found' });
        }
        const imagesWithUrls = await Promise.all(
            recipe.images.map(async (image) => {
                const url = await getPresignedUrl(image.fileName);
                return { ...image.toObject(), url };
            })
        );

        // Cache the images with URLs
        await cacheUtils.setCache(cacheKey, imagesWithUrls, CACHE_DURATIONS.SINGLE_RECIPE);

        return res.json(imagesWithUrls);
    } catch (error) {
        console.error('Error fetching images:', error);
        res.status(500).json({ message: 'Server error' });
    }
};