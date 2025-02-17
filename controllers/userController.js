import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { StatusError } from './utils/Error.js';
import { getPresignedUrl } from './services/s3services.js';
import Template from '../models/Template.js';
import { cacheUtils, CACHE_DURATIONS } from '../cache/cacheconfig.js';

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const USERNAME = process.env.SYSTEM_USERNAME;
const EMAIL = process.env.SYSTEM_EMAIL;


export const authController = {
  async googleAuth(req, res) {
    try {
      const { token } = req.body;

      // Get user info from Google
      const response = await fetch(
        `https://www.googleapis.com/oauth2/v3/userinfo?access_token=${token}`
      );

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Google API error:', errorData); // Add this to debug
        throw new Error('Failed to get user info from Google');
      }

      const userData = await response.json();

      // Find or create user
      let user = await User.findOne({ email: userData.email });

      if (!user) {
        user = await User.create({
          email: userData.email,
          username: userData.name,
          googleId: userData.sub,
          profilePicture: userData.picture,
          password: Math.random().toString(36), // Random password for Google users
        });
      }

      // Create JWT token
      const jwtToken = jwt.sign(
        { userId: user._id },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      await Promise.all([
        cacheUtils.deleteCache(`user:${user._id}`),
        cacheUtils.clearCachePattern('userlist:*')
      ]);

      res.json({ token: jwtToken, user });

    } catch (error) {
      console.error('Google auth error:', error);
      res.status(401).json({ error: error.message });
    }
  },

  // Add this new verify endpoint
  async verify(req, res) {
    try {
      const userId = req.user.userId;
      const cachedUser = await cacheUtils.getCache(`user:${userId}`);

      if (cachedUser) {
        return res.json(cachedUser); // Return cached user
      }

      const user = await User.findById(userId)
        .select('-password -isSystem -isTestUser'); // Exclude password from the response

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Cache the user data
      await cacheUtils.setCache(`user:${userId}`, user, CACHE_DURATIONS.USER_PROFILE);

      res.json(user);
    } catch (error) {
      console.error('Verification error:', error);
      res.status(401).json({ error: 'Invalid token' });
    }
  },

  // Regular email/password registration
  async register(req, res) {
    try {
      const { email, password, username } = req.body;

      // Check if user exists
      const existingUser = await User.findOne({
        $or: [{ email }, { username }]
      });

      if (existingUser) {
        // If user exists, verify password and log them in
        const isValid = await existingUser.comparePassword(password);
        if (!isValid) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Create JWT token for existing user
        const token = jwt.sign(
          { userId: existingUser._id },
          process.env.JWT_SECRET,
          { expiresIn: '7d' }
        );

        return res.json({ token, user: existingUser });
      }

      // Create new user
      const user = await User.create({
        email,
        password,
        username
      });

      // Create JWT token
      const token = jwt.sign(
        { userId: user._id },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      await Promise.all([
        cacheUtils.deleteCache(`user:${user._id}`),
        cacheUtils.clearCachePattern('userlist:*')
      ]);

      res.status(201).json({ token, user });

    } catch (error) {
      console.error('Registration error:', error);
      res.status(400).json({ error: error.message });
    }
  },

  // Regular email/password login
  async login(req, res) {
    try {
      const { email, password } = req.body;

      // Find user
      const user = await User.findOne({ email });
      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Check password
      const isValid = await user.comparePassword(password);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Create JWT token
      const token = jwt.sign(
        { userId: user._id },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.json({ token, user });

    } catch (error) {
      console.error('Login error:', error);
      res.status(401).json({ error: 'Authentication failed' });
    }
  }
};

export const getUserProfile = async (req, res, next) => {
  try {
    const userId = req.params.id;
    const cachedUser = await cacheUtils.getCache(`user:${userId}`);

    if (cachedUser) {
      return res.json(cachedUser);
    }

    const user = await User.findById(userId)
      .select('-password -isTestUser -__v') // Exclude sensitive fields
      .lean();

    if (!user) {
      throw new StatusError('User not found', 404);
    }

    await cacheUtils.setCache(`user:${userId}`, user, CACHE_DURATIONS.USER_PROFILE);
    res.json(user);
  } catch (error) {
    next(error);
  }
};


export const getUserCreatedRecipes = async (req, res, next) => {
  try {
    const userId = req.params.id;
    const cachedRecipes = await cacheUtils.getCache(`user:${userId}:createdRecipes`);

    if (cachedRecipes) {
      return res.json(cachedRecipes); // Return cached recipes
    }

    const user = await User.findById(userId)
      .populate({
        path: 'createdRecipes',
        select: 'title description images cookingTime difficulty createdAt',
        options: { sort: { createdAt: -1 } }
      })
      .select('createdRecipes')
      .lean();

    if (!user) {
      throw new StatusError('User not found', 404);
    }

    const updatedRecipes = user.createdRecipes && user.createdRecipes.length > 0
      ? await Promise.all(
        user.createdRecipes.map(async (recipe) => {
          // Add pre-signed URLs for each image
          if (recipe.images && recipe.images.length > 0) {
            recipe.images = await Promise.all(
              recipe.images.map(async (image) => ({
                ...image,
                url: await getPresignedUrl(image.fileName),
              }))
            );
          }
          return recipe;
        })
      )
      : [];

    // Cache the updated recipes
    await cacheUtils.setCache(`user:${userId}:createdRecipes`, updatedRecipes, CACHE_DURATIONS.RECIPE_LIST);
    res.json(updatedRecipes);
  } catch (error) {
    next(error);
  }
};

export const getUserSavedRecipes = async (req, res, next) => {
  try {
    const userId = req.params.id;
    const cachedRecipes = await cacheUtils.getCache(`user:${userId}:savedRecipes`);

    if (cachedRecipes) {
      return res.json(cachedRecipes); // Return cached saved recipes
    }

    const user = await User.findById(userId)
      .populate({
        path: 'savedRecipes',
        select: 'title description images cookingTime createdAt',
        options: { sort: { createdAt: -1 } }
      })
      .select('savedRecipes')
      .lean();

    if (!user) {
      throw new StatusError('User not found', 404);
    }

    const updatedRecipes = user.savedRecipes && user.savedRecipes.length > 0
      ? await Promise.all(
        user.savedRecipes.map(async (recipe) => {
          // Add pre-signed URLs for each image
          if (recipe.images && recipe.images.length > 0) {
            recipe.images = await Promise.all(
              recipe.images.map(async (image) => ({
                ...image,
                url: await getPresignedUrl(image.fileName),
              }))
            );
          }
          return recipe;
        })
      )
      : [];

    // Cache the updated saved recipes
    await cacheUtils.setCache(`user:${userId}:savedRecipes`, updatedRecipes, CACHE_DURATIONS.RECIPE_LIST);
    res.json(updatedRecipes);
  } catch (error) {
    next(error);
  }
};

export const updateUserProfile = async (req, res, next) => {
  try {
    // Only allow updating specific fields
    const allowedUpdates = ['username', 'bio'];
    const updates = Object.keys(req.body)
      .filter(key => allowedUpdates.includes(key))
      .reduce((obj, key) => {
        obj[key] = req.body[key];
        return obj;
      }, {});

    // Make sure user can only update their own profile
    if (req.user.userId !== req.params.id) {
      throw new StatusError('Not authorized to update this profile', 403);
    }

    // Use findOneAndUpdate to check `isSystem` and update in a single query
    const updatedUser = await User.findOneAndUpdate(
      { _id: req.params.id, isSystem: { $ne: true } }, // Check for isSystem: false
      { $set: updates },
      { new: true, runValidators: true }
    ).select('-password -isTestUser -__v');

    if (!updatedUser) {
      throw new StatusError('User not found or is a system user', 403);
    }

    await cacheUtils.deleteCache(`user:${req.params.id}`);

    res.json(updatedUser);
  } catch (error) {
    next(error);
  }
};

export const getOrCreateDeletedUser = async () => {
  try {
    const cacheKey = 'deletedUser'
    const cachedUser = await cacheUtils.getCache(cacheKey);

    if (cachedUser) {
      return cachedUser; 
    }

    
    let deletedUser = await User.findOne({
      isSystem: true,
      username: process.env.SYSTEM_USERNAME
    });

    if (!deletedUser) {
      deletedUser = await User.create({
        email: process.env.SYSTEM_EMAIL,
        username: process.env.SYSTEM_USERNAME,
        password: Math.random().toString(36),
        isSystem: true,
        bio: 'This account represents content from deleted users.',
        profilePicture: 'default-profile.png'
      });
    }

    await cacheUtils.setCache(cacheKey, deletedUser, CACHE_DURATIONS.USER_PROFILE);
    return deletedUser;
  } catch (error) {
    console.error('Error managing deleted user:', error);
    throw error;
  }
};

export const deleteUserAccount = async (req, res, next) => {
  try {
    // Verify the user is deleting their own account
    if (req.user.userId !== req.params.id) {
      throw new StatusError('Not authorized to delete this account', 403);
    }

    // Find the user first to make sure they exist
    const user = await User.findById(req.params.id);

    if (!user) {
      throw new StatusError('User not found', 404);
    }

    // Get or create the deleted user account
    const deletedUser = await getOrCreateDeletedUser();

    // Transfer recipes to deleted user instead of deleting them
    if (user.createdRecipes && user.createdRecipes.length > 0) {
      await Recipe.updateMany(
        { _id: { $in: user.createdRecipes } },
        {
          $set: {
            author: deletedUser._id,
            // Add a note that this was from a deleted user
            description: '[From a deleted user]\n\n' + '$description'
          }
        }
      );
    }

    // For public templates, reassign to Deleted User
    await Template.updateMany(
      { author: user._id, public: true },
      { $set: { author: deletedUser._id } }
    );

    // For private templates, delete them entirely
    await Template.deleteMany({ author: user._id, public: false });

    await User.findByIdAndUpdate(user._id, {
      $set: { savedRecipes: [] }
    });

    // Finally, delete the user
    await User.findByIdAndDelete(req.params.id);

    await Promise.all([
      cacheUtils.deleteCache('deletedUser'),
      cacheUtils.deleteCache(`user:${req.params.id}`),
      cacheUtils.clearCachePattern('userlist:*')
    ]);

    res.status(200).json({
      message: 'Account successfully deleted',
      success: true
    });

  } catch (error) {
    next(error);
  }
};

export const getAllUsers = async (req, res, next) => {
  try {
    if (!req.isAdmin) {
      throw new StatusError('Unauthorized access', 403);
    }

    // Parse query parameters with defaults
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const sortBy = req.query.sortBy || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const search = req.query.search || '';

    const cacheKey = `userlist:${JSON.stringify({
      page,
      limit,
      sortBy,
      sortOrder,
      search
    })}`;
    const cachedUsers = await cacheUtils.getCache(cacheKey);

    if (cachedUsers) {
      return res.json(cachedUsers);
    }

    // Build filter object
    const filter = { };

    // Add search functionality if search term provided
    if (search) {
      filter.$or = [
        { username: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    // Calculate skip value for pagination
    const skip = (page - 1) * limit;

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder;

    // Get total count for pagination
    const totalUsers = await User.countDocuments(filter);

    // Get users with pagination
    const users = await User.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .select('-password -__v') // Exclude sensitive fields
      .lean();

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalUsers / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    const response = {
      users,
      pagination: {
        currentPage: page,
        totalPages,
        totalUsers,
        hasNextPage,
        hasPrevPage,
        limit
      },
      sortInfo: {
        sortBy,
        sortOrder: sortOrder === 1 ? 'asc' : 'desc'
      }
    }

    await cacheUtils.setCache(cacheKey, response, CACHE_DURATIONS.USER_PROFILE);

    res.json(response);

  } catch (error) {
    next(error);
  }
};