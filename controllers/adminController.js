import { getOrCreateDeletedUser } from './userController.js'
import jwt from 'jsonwebtoken';

export const verifyAdmin = async (req, res) => {
    try {
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