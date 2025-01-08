import { getOrCreateDeletedUser } from './userController.js'
import jwt from 'jsonwebtoken';

export const verifyAdmin = async (req, res) => {
    try {
        const deletedUser = await getOrCreateDeletedUser();

        const jwtToken = jwt.sign(
            { userId: deletedUser._id },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({ token: jwtToken, deletedUser });
    } catch (error) {
        res.status(500).json({
            message: 'Error fetching recipe',
            error: error.message
        });
    }
};