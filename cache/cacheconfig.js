import Redis from 'ioredis';
import Recipe from '../models/Recipe.js';

// Cache durations in seconds
export const CACHE_DURATIONS = {
    SINGLE_RECIPE: 3600,      // 1 hour
    RECIPE_LIST: 1800,        // 30 minutes
    LATEST_RECIPES: 300,      // 5 minutes
    CATEGORY_LIST: 3600,      // 1 hour
    USER_PROFILE: 1800,       // 30 minutes
    LIKE_STATUS: 300,         // 5 minutes
    SAVE_STATUS: 300,         // 5 minutes
    SEARCH_RESULTS: 900,       // 15 minutes
    TEMPLATES: 1800
};

// Create Redis client
const createRedisClient = () => {
    const redisConfig = {
        retryStrategy: (times) => {
            const delay = Math.min(times * 50, 2000);
            return delay;
        },
    };

    if (process.env.NODE_ENV === 'development') {
        // Local development Redis configuration
        redisConfig.host = '127.0.0.1';
        redisConfig.port = 6379;
    } else {
        // Production Redis configuration
        redisConfig.host = process.env.REDIS_HOST;
        redisConfig.port = process.env.REDIS_PORT || 6379;
        redisConfig.password = process.env.REDIS_PASSWORD || undefined; // If your Redis instance requires a password
        redisConfig.tls = process.env.REDIS_TLS === 'true' ? {} : undefined; // Enable TLS for secure Redis connections
    }

    return new Redis(redisConfig);
};

// Create Redis client
const redisClient = createRedisClient();

// Event handlers
redisClient.on('error', (err) => {
    console.error('Redis Client Error:', err);
});

redisClient.on('connect', () => {
    console.log('Redis Client Connected');
});

// Cache utility functions
export const cacheUtils = {
    // Set cache with expiry
    setCache: async (key, data, duration) => {
        try {
            await redisClient.setex(key, duration, JSON.stringify(data));
        } catch (error) {
            console.error('Cache Set Error:', error);
        }
    },

    // Get cached data
    getCache: async (key) => {
        try {
            const data = await redisClient.get(key);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            console.error('Cache Get Error:', error);
            return null;
        }
    },

    // Delete specific cache
    deleteCache: async (key) => {
        try {
            await redisClient.del(key);
        } catch (error) {
            console.error('Cache Delete Error:', error);
        }
    },

    clearCachePattern: async (pattern) => {
        try {
            const keys = await redisClient.keys(pattern);
            if (keys.length > 0) {
                await redisClient.del(keys);
            }
        } catch (error) {
            console.error('Cache Clear Pattern Error:', error);
        }
    }
};

// Optional: Middleware for route caching
export const cacheMiddleware = (duration) => {
    return async (req, res, next) => {
        if (process.env.NODE_ENV === 'test') return next();

        try {
            const key = `route:${req.originalUrl}`;
            const cachedData = await cacheUtils.getCache(key);

            if (cachedData) {
                return res.json(cachedData);
            }

            // Store the original res.json function
            const originalJson = res.json;
            res.json = function(data) {
                cacheUtils.setCache(key, data, duration);
                return originalJson.call(this, data);
            };

            next();
        } catch (error) {
            console.error('Cache Middleware Error:', error);
            next();
        }
    };
};

// In your Redis config, add these methods
export const likeQueue = {
    add: async (recipeId, userId, action) => {
        const key = 'like_queue';
        await redisClient.hset(key, `${recipeId}:${userId}`, action);
    },
    
    getLikeCount: async (recipeId) => {
        const key = `recipe:${recipeId}:likes`;
        return parseInt(await redisClient.get(key) || '0');
    },
    
    processQueue: async () => {
        const key = 'like_queue';
        const batch = await redisClient.hgetall(key);
        
        if (!batch || Object.keys(batch).length === 0) return;
        
        try {
            // Group by recipe for efficient updates
            const updates = {};
            for (const [key, action] of Object.entries(batch)) {
                const [recipeId, userId] = key.split(':');
                if (!updates[recipeId]) updates[recipeId] = { add: [], remove: [] };
                updates[recipeId][action].push(userId);
            }
            
            // Update DB in transaction
            const session = await mongoose.startSession();
            await session.withTransaction(async () => {
                for (const [recipeId, actions] of Object.entries(updates)) {
                    await Recipe.findByIdAndUpdate(recipeId, {
                        $addToSet: { likes: { $each: actions.add } },
                        $pull: { likes: { $in: actions.remove } }
                    });
                }
                
                // Clear processed items from Redis
                await redisClient.del(key);
            });
            
            session.endSession();
        } catch (error) {
            console.error('Error processing like queue:', error);
            // Important: Don't clear Redis queue on error
        }
    }
};

export default redisClient;