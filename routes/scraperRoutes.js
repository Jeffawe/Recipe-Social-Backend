import express from 'express';
import { scrapeSites } from '../controllers/scraperController.js';
import { authenticateToken, isAdmin } from '../middleware/auth.js';

const router = express.Router();

router.post('/', scrapeSites);