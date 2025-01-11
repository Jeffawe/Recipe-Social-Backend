import Redis from 'ioredis';

// Cache durations in seconds
export const CACHE_DURATIONS = {
    SINGLE_RECIPE: 3600,      // 1 hour
    RECIPE_LIST: 1800,        // 30 minutes
    LATEST_RECIPES: 300,      // 5 minutes
    CATEGORY_LIST: 3600,      // 1 hour
    USER_PROFILE: 1800,       // 30 minutes
};

const createRedisClient = () => {
    // For local development
    if (process.env.NODE_ENV === 'development') {
        return new Redis({
            host: 'localhost',
            port: 6379,
            retryStrategy: (times) => {
                const delay = Math.min(times * 50, 2000);
                return delay;
            }
        });
    }
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

export default redisClient;