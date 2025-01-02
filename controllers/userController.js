import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { StatusError } from './utils/Error.js';
import { getPresignedUrl } from './services/s3services.js';

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

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
      // The user's token will be available in req.user 
      // because of your auth middleware
      const user = await User.findById(req.user.userId)
        .select('-password'); // Exclude password from the response

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
    const allowedUpdates = ['username', 'bio', 'profilePicture'];
    const updates = Object.keys(req.body)
      .filter(key => allowedUpdates.includes(key))
      .reduce((obj, key) => {
        obj[key] = req.body[key];
        return obj;
      }, {});

    // Make sure user can only update their own profile
    if (req.user.id !== req.params.id) {
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