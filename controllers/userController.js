import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { StatusError } from './utils/Error.js';
import { getPresignedUrl } from './services/s3services.js';
import Template from '../models/Template.js';

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const SYSTEM_USERNAME = 'Deleted User';
const SYSTEM_EMAIL = 'deleted@system.internal';

export const authController = {
  async googleAuth(req, res) {
    try {
      const { token } = req.body;
      console.log('Received token:', token); // Add this to debug

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
      console.log('Google user data:', userData); // Add this to debug

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

      res.json({ token: jwtToken, user });

    } catch (error) {
      console.error('Google auth error:', error);
      res.status(401).json({ error: error.message });
    }
  },

  // Add this new verify endpoint
  async verify(req, res) {
    try {
      const user = await User.findById(req.user.userId)
        .select('-password -isSystem -isTestUser'); // Exclude password from the response

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

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
    const user = await User.findById(req.params.id)
      .select('-password -isTestUser -__v') // Exclude sensitive fields
      .lean();

    if (!user) {
      throw new StatusError('User not found', 404);
    }

    res.json(user);
  } catch (error) {
    next(error);
  }
};


export const getUserCreatedRecipes = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id)
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

    res.json(updatedRecipes);
  } catch (error) {
    next(error);
  }
};

export const getUserSavedRecipes = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id)
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
      console.log
      throw new StatusError('Not authorized to update this profile', 403);
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true }
    ).select('-password -isTestUser -__v');

    if (!user) {
      throw new StatusError('User not found', 404);
    }

    res.json(user);
  } catch (error) {
    next(error);
  }
};

export const getOrCreateDeletedUser = async () => {
  try {
    let deletedUser = await User.findOne({
      isSystem: true,
      username: SYSTEM_USERNAME
    });

    if (!deletedUser) {
      deletedUser = await User.create({
        email: SYSTEM_EMAIL,
        username: SYSTEM_USERNAME,
        password: Math.random().toString(36),
        isSystem: true,
        bio: 'This account represents content from deleted users.',
        profilePicture: 'default-profile.png'
      });
    }

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
    // Parse query parameters with defaults
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const sortBy = req.query.sortBy || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const search = req.query.search || '';

    // Build filter object
    const filter = {
      isSystem: { $ne: false },
      isTestUser: { $ne: false }
    };

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

    res.json({
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
    });

  } catch (error) {
    next(error);
  }
};