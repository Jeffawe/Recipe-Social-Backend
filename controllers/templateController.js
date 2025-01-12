import { CACHE_DURATIONS, cacheUtils } from '../cache/cacheconfig.js';
import Template from '../models/Template.js';

export const createTemplate = async (req, res) => {
    try {
        const { template, public: isPublic } = req.body;
        const author = req.user.userId; // Assuming you have auth middleware setting req.user

        const newTemplate = new Template({
            template,
            author,
            public: isPublic
        });

        await newTemplate.save();
        const promises = [
            cacheUtils.deleteCache(`user-templates:${req.user.userId}`),
            cacheUtils.deleteCache(`user-template:${req.user.userId}`),
            cacheUtils.clearCachePattern('templates:*')
        ];
        
        if (isPublic) {
            promises.push(cacheUtils.deleteCache('public-templates'));
        }
        
        await Promise.all(promises);
        res.status(201).json(newTemplate);
    } catch (error) {
        res.status(500).json({ message: 'Error creating template', error });
    }
};

export const saveTemplate = async (req, res) => {
    try {
        const { template, public: isPublic } = req.body;
        const author = req.user.userId;

        // Try to find existing template by content
        const existingTemplate = await Template.findOne({
            template,
            author
        });

        if (existingTemplate) {
            // Update existing
            const updatedTemplate = await Template.findOneAndUpdate(
                { _id: existingTemplate._id },
                { public: isPublic },
                { new: true }
            );
            return res.json(updatedTemplate);
        }

        // Create new if doesn't exist
        const newTemplate = new Template({
            template,
            author,
            public: isPublic
        });

        await newTemplate.save();
        const promises = [
            cacheUtils.deleteCache(`user-templates:${req.user.userId}`),
            cacheUtils.deleteCache(`user-template:${req.user.userId}`),
            cacheUtils.clearCachePattern('templates:*')
        ];
        
        if (isPublic) {
            promises.push(cacheUtils.deleteCache('public-templates'));
        }
        
        await Promise.all(promises);
        
        res.status(201).json(newTemplate);
    } catch (error) {
        res.status(500).json({ message: 'Error saving template', error });
    }
};

export const getAllTemplates = async (req, res) => {
    try {
        const cacheKey = 'public-templates';
        const cachedRecipes = await cacheUtils.getCache(cacheKey);

        if (cachedRecipes) {
            return res.json(cachedRecipes); // Return cached saved recipes
        }

        const templates = await Template.find({ public: true })
            .populate('author', 'username');

        await cacheUtils.setCache(cacheKey, templates, CACHE_DURATIONS.TEMPLATES)
        res.json(templates);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching templates', error });
    }
};

export const getEverySingleTemplates = async (req, res) => {
    try {
        if (!req.isAdmin) {
            return res.status(500).json({ message: 'Not an Admin' });
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const sortBy = req.query.sortBy || 'createdAt';
        const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
        const search = req.query.search || '';

        const cacheKey = `templates:${JSON.stringify({
            page,
            limit,
            sortBy,
            sortOrder,
            search
        })}`;
        const cachedRecipes = await cacheUtils.getCache(cacheKey);

        if (cachedRecipes) {
            return res.json(cachedRecipes); // Return cached saved recipes
        }

        // Build filter object
        const filter = {};

        if (search) {
            filter.template = { $regex: search, $options: 'i' };
        }

        // Calculate skip value for pagination
        const skip = (page - 1) * limit;

        // Build sort object
        const sort = {};
        sort[sortBy] = sortOrder;

        // Get total count for pagination
        const totalTemplates = await Template.countDocuments(filter);

        // Get templates with pagination
        const templates = await Template.find(filter)
            .populate('author', 'username email')
            .populate('recipeCount')
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .lean();

        // Calculate pagination metadata
        const totalPages = Math.ceil(totalTemplates / limit);
        const hasNextPage = page < totalPages;
        const hasPrevPage = page > 1;

        const response = {
            templates,
            pagination: {
                currentPage: page,
                totalPages,
                totalTemplates,
                hasNextPage,
                hasPrevPage,
                limit
            },
            sortInfo: {
                sortBy,
                sortOrder: sortOrder === 1 ? 'asc' : 'desc'
            }
        }

        await cacheUtils.setCache(cacheKey, response, CACHE_DURATIONS.TEMPLATES)

        return res.json(response);

    } catch (error) {
        return res.status(500).json({
            message: 'Error fetching templates',
            error: error.message
        });
    }
};

export const getUserTemplates = async (req, res) => {
    try {
        const userId = req.user.userId;

        const cacheKey = `user-templates:${userId}`;
        const cachedRecipes = await cacheUtils.getCache(cacheKey);

        if (cachedRecipes) {
            return res.json(cachedRecipes); // Return cached saved recipes
        }

        const templates = await Template.find({
            author: userId
        }).populate('author', 'username');

        await cacheUtils.setCache(cacheKey, templates, CACHE_DURATIONS.TEMPLATES)
        res.json(templates);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching templates', error });
    }
};

export const getUserTemplate = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.userId;

        const cacheKey = `user-template:${userId}`;
        const cachedRecipes = await cacheUtils.getCache(cacheKey);

        if (cachedRecipes) {
            return res.json(cachedRecipes); // Return cached saved recipes
        }


        const template = await Template.findOne({
            _id: id,
            author: userId
        }).populate('author', 'username');

        if (!template) {
            return res.status(404).json({ message: 'Template not found or unauthorized' });
        }
        await cacheUtils.setCache(cacheKey, template, CACHE_DURATIONS.TEMPLATES)
        res.json(template);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching template', error });
    }
};

export const updateTemplate = async (req, res) => {
    try {
        const { id } = req.params;
        const { template, public: isPublic } = req.body;
        const userId = req.user.userId;

        const duplicateTemplate = await Template.findOne({
            template,
            author: userId,
            _id: { $ne: id } // Exclude the current template
        });

        if (duplicateTemplate) {
            return res.status(400).json({ message: 'A template with the same content already exists.' });
        }

        const updatedTemplate = await Template.findOneAndUpdate(
            { _id: id, author: userId }, // Ensure user owns the template
            { template, public: isPublic },
            { new: true }
        );

        if (!updatedTemplate) {
            return res.status(404).json({ message: 'Template not found or unauthorized' });
        }

        res.json(updatedTemplate);
    } catch (error) {
        res.status(500).json({ message: 'Error updating template', error });
    }
};

export const deleteTemplate = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.userId;

        const deletedTemplate = await Template.findOneAndDelete({
            _id: id,
            author: userId // Ensure user owns the template
        });

        if (!deletedTemplate) {
            return res.status(404).json({ message: 'Template not found or unauthorized' });
        }

        await Promise.all([
            cacheUtils.deleteCache(`user-templates:${req.user.userId}`),
            cacheUtils.deleteCache(`user-template:${req.user.userId}`),
            cacheUtils.deleteCache('public-templates'),
            cacheUtils.clearCachePattern('templates:*'),
        ]);

        res.json({ message: 'Template deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting template', error });
    }
};