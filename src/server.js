import dotenv from 'dotenv';
dotenv.config();

import express, { json } from 'express';
import { connect } from 'mongoose';
import cors from 'cors';
import helmet from "helmet";
import rateLimit from 'express-rate-limit';

import recipeRoutes from '../routes/recipeRoutes.js';
import userRoutes from '../routes/userRoutes.js';
import templateRoutes from '../routes/templateRoutes.js';
import adminRoutes from '../routes/adminRoutes.js'
import candfRoutes from '../routes/candfRoutes.js'

import { likeQueue } from '../cache/cacheconfig.js';
import { verifyApiKey } from '../middleware/apiKey.js';

const app = express();

// Middleware
app.use(helmet());
app.use(cors()); // Enable CORS
app.use(json()); // Parse JSON bodies
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // Limit each IP to 100 requests per windowMs
});
app.use(limiter);

if (!process.env.MONGODB_URI || !process.env.API_KEY) {
  console.error('Missing required environment variables.');
  process.exit(1);
}

// Database Connection
connect(process.env.MONGODB_URI, {
  useNewUrlParser: true
})
  .then(() => console.log('MongoDB connected successfully'))
  .catch((err) => console.error('MongoDB connection error:', err));

app.get('/', (req, res) => {
  res.send('Welcome to the Recipe Social API');
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP' });
});

// Routes
app.use('/api/recipes', verifyApiKey, recipeRoutes);
app.use('/api/auth', verifyApiKey, userRoutes);
app.use('/api/templates', verifyApiKey, templateRoutes);
app.use('/api/admin', verifyApiKey, adminRoutes)
app.use('/api/cf', verifyApiKey, candfRoutes)

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

setInterval(async () => {
  try {
    await likeQueue.processQueue();
    console.log('Queue processed successfully');
  } catch (err) {
    console.error('Error processing queue:', err);
  }
}, 5 * 60 * 1000);