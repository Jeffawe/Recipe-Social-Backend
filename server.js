import dotenv from 'dotenv';
import express, { json } from 'express';
import { connect } from 'mongoose';
import cors from 'cors';

import recipeRoutes from './routes/recipeRoutes.js';
import userRoutes from './routes/userRoutes.js';
import templateRoutes from './routes/templateRoutes.js';

// Create Express application
const app = express();
dotenv.config();

// Middleware
app.use(cors()); // Enable CORS
app.use(json()); // Parse JSON bodies

// Database Connection
connect(process.env.MONGODB_URI, {
  useNewUrlParser: true
})
.then(() => console.log('MongoDB connected successfully'))
.catch((err) => console.error('MongoDB connection error:', err));

app.get('/', (req, res) => {
  res.send('Welcome to the Recipe Social API');
});

// Routes
app.use('/api/recipes', recipeRoutes);
app.use('/api/auth', userRoutes);
app.use('/api/templates', templateRoutes);

// Global error handler (basic)
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});