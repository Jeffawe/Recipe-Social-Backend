import { PythonShell } from 'python-shell';
import path from 'path';

export const scrapeSites = async (req, res) => {
    try {
        if (!['train', 'predict'].includes(mode)) {
            return res.status(400).json({
                success: false,
                message: "Invalid mode. Allowed values are 'train' or 'predict'."
            });
        }
        
        let options = {
            mode: 'text',
            pythonPath: 'python3',
            scriptPath: path.join(__dirname, '../python')
        };

        const pythonProcess = new PythonShell('recipe_scraper.py', options);
        
        // Handle Python script output
        pythonProcess.on('message', function (message) {
            console.log('Python output:', message);
        });

        // Handle completion
        pythonProcess.end((err, code, signal) => {
            if (err) {
                console.error('Error completing Python process:', err);
                return res.status(500).json({ 
                    success: false, 
                    message: 'Error during scraping',
                    error: err.message 
                });
            }
        
            res.json({ 
                success: true, 
                message: 'Scraping completed successfully',
                code,
                signal 
            });
        });

    } catch (error) {
        console.error('Scraping error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
}