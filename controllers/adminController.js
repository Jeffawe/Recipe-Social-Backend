import { getOrCreateDeletedUser } from './userController.js'
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

export const verifyAdmin = async (req, res) => {
    try {
        const { password } = req.body;

        if(password != process.env.SYSTEM_PASSWORD){
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