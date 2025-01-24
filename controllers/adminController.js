import { getOrCreateDeletedUser } from './userController.js'
import { cacheUtils } from '../cache/cacheconfig.js'
import { StatusError } from './utils/Error.js';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

export const verifyAdmin = async (req, res) => {
    try {
        const { password } = req.body;

        if (password != process.env.SYSTEM_PASSWORD) {
            res.status(500).json({
                message: 'Error verifying admin',
                error: error.message
            });
        }

        const deletedUser = await getOrCreateDeletedUser();

        if (!process.env.JWT_SECRET) {
            throw new Error('JWT_SECRET is not defined in environment variables');
        }
        if (!deletedUser) {
            throw new Error('Failed to retrieve or create the deleted user');
        }

        const jwtToken = jwt.sign(
            { userId: deletedUser._id, isSystem: deletedUser.isSystem },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );


        res.json({ token: jwtToken, deletedUser });
    } catch (error) {
        res.status(500).json({
            message: 'Error verifying admin',
            error: error.message
        });
    }
};

export const clearCache = async (req, res) => {
    try {
        if (!req.isAdmin) {
            throw new StatusError('Unauthorized access', 403);
        }

        const { key } = req.query;

        if (!key) {
            // If no specific key, clear all recipe-related caches
            await cacheUtils.clearCachePattern('recipes:*');
            return res.json({ message: 'All recipe caches cleared' });
        }else{
            await cacheUtils.clearCachePattern(`${key}:*`);
        }

        res.json({ message: `Cache cleared for key: ${key}` });
    } catch (error) {
        res.status(500).json({
            message: 'Error clearing cache',
            error: error.message
        });
    }
};