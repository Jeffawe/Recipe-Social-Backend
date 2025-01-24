import axios from 'axios';

const BASE_URL = 'http://127.0.0.1:8000';

export const generateCSV = async (req, res) => {
    try {
        if (!req.isAdmin) {
            throw new StatusError('Unauthorized access', 403);
        }
        const response = await axios.post(`${BASE_URL}/search/create`);
        res.status(200).json({
            success: true,
            data: response.data
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};


export const scrapeSites = async (req, res) => {
    try {
        const { searchData, threshold = 0.3 } = req.body;

        const response = await axios.post(`${BASE_URL}/search/recipe`, {
            search_data: searchData,
            threshold
        });

        res.status(200).json({
            success: true,
            data: response.data
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.response?.data || error.message 
        });
    }
};

// Optional error handling utility
export const handleApiError = (error, res) => {
    if (error.response) {
        res.status(error.response.status).json({
            success: false,
            error: error.response.data.error || 'API request failed'
        });
    } else if (error.request) {
        res.status(500).json({
            success: false,
            error: 'No response received from server'
        });
    } else {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};