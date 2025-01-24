import express from 'express';
import { scrapeSites, generateCSV } from '../controllers/scraperController.js';
import { isAdmin } from '../middleware/auth.js';

const router = express.Router();

router.post('/', scrapeSites);

router.post('/generate', isAdmin, generateCSV)