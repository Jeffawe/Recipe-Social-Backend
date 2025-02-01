import axios from 'axios';
import { getOrCreateDeletedUser } from './userController.js';
import { generateShortUniqueId } from './utils/Error.js';
import { CACHE_DURATIONS, cacheUtils } from '../cache/cacheconfig.js';

const BASE_URL = 'http://127.0.0.1:8000';

export const generateCSV = async (req, res) => {
    try {
        if (!req.isAdmin) {
            throw new StatusError('Unauthorized access', 403);
        }
        const response = await axios.post(`${BASE_URL}/search/create`);
        res.status(200).json({
            success: true,
            data: response.data
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

const createCacheKey = (data) => {
    const { search_data = {}, threshold = '' } = data;

    // Extract title and ingredients, set to empty string if not defined
    const title = search_data.title || '';
    const ingredients = (search_data.ingredients || []).join(',');

    // Create the string
    return `search_data[title:${title}][ingredients:${ingredients}][threshold:${threshold}]`;
};


export const scrapeSites = async (req, res) => {
    try {
        if (!req.body || typeof req.body !== 'object') {
            return res.status(400).json({ success: false, error: 'Invalid request body' });
        }

        const cacheKey = createCacheKey(req.body)
        const cachedUsers = await cacheUtils.getCache(cacheKey);

        if (cachedUsers) {
            return res.json(cachedUsers);
        }

        const response = await axios.post(
            `${BASE_URL}/search/recipe`,
            req.body,
            {
                headers: { 'Content-Type': 'application/json' }
            }
        ).catch(error => {
            throw error.response?.data || error.message || 'External API call failed';
        });

        if (!response || !response.data?.results) {
            throw new Error("No results received from external API");
        }

        let uniqueExternalRecipes;
        const deletedUser = await getOrCreateDeletedUser();

        if (response && response.data.results) {
            const externalRecipes = response.data.results.map(result => ({
                _id: generateShortUniqueId(result.title, result.url),
                title: result.title,
                pageURL: result.url,
                images: [{
                    url: result.imageURL
                }],
                external: true,
                author: deletedUser._id || null, // Placeholder author
                ingredients: [], // Empty ingredients
                description: '', // Empty description
                category: 'Uncategorized',
                likes: []
            }));

            uniqueExternalRecipes = externalRecipes.filter((value, index, self) =>
                index === self.findIndex((t) => (
                    t.pageURL === value.pageURL // Compare by pageURL to remove duplicates
                ))
            );
        } else {
            throw new Error("Can't Convert Results")
        }

        const responseVal = {
            success: true,
            data: uniqueExternalRecipes
        }

        await cacheUtils.setCache(cacheKey, responseVal, CACHE_DURATIONS.RECIPE_LIST)

        res.status(200).json(responseVal);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.response?.data || error.message
        });
    }
};

export const scrapeSitesInternal = async (searchData, threshold = 0.3, page = 1, limit = 10) => {
    try {
        const cacheKey = createCacheKey({"search_Data": searchData, "threshold":threshold, "page":page, "limit":limit})
        const cachedUsers = await cacheUtils.getCache(cacheKey);

        if (cachedUsers) {
            return cachedUsers;
        }

        const response = await axios.post(
            `${BASE_URL}/search/recipe`,
            {"search_Data": searchData, "threshold":threshold, "page":page, "limit":limit},
            {
                headers: { 'Content-Type': 'application/json' }
            }
        ).catch(error => {
            throw error.response?.data || error.message || 'External API call failed';
        });

        if (!response || !response.data?.results) {
            throw new Error("No results received from external API");
        }

        let uniqueExternalRecipes;
        const deletedUser = await getOrCreateDeletedUser();

        if (response && response.data.results) {
            const externalRecipes = response.data.results.map(result => ({
                _id: generateShortUniqueId(result.title, result.url),
                title: result.title,
                pageURL: result.url,
                images: [{
                    url: result.imageURL
                }],
                external: true,
                author: deletedUser._id || null, // Placeholder author
                ingredients: [], 
                description: '',
                category: 'Uncategorized',
                likes: []
            }));

            uniqueExternalRecipes = externalRecipes.filter((value, index, self) =>
                index === self.findIndex((t) => (
                    t.pageURL === value.pageURL // Compare by pageURL to remove duplicates
                ))
            );
        } else {
            throw new Error("Can't Find Results")
        }

        const responseVal = {
            success: true,
            data: uniqueExternalRecipes
        }

        await cacheUtils.setCache(cacheKey, responseVal, CACHE_DURATIONS.RECIPE_LIST)

        return responseVal;
    } catch (error) {
        throw error
    }
};

// Optional error handling utility
export const handleApiError = (error, res) => {
    if (error.response) {
        res.status(error.response.status).json({
            success: false,
            error: error.response.data.error || 'API request failed'
        });
    } else if (error.request) {
        res.status(500).json({
            success: false,
            error: 'No response received from server'
        });
    } else {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};