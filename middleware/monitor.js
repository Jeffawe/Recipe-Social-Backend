import dotenv from 'dotenv';
import { WebhookClient } from 'discord.js';
import os from 'os';
dotenv.config();

const webhookClient = new WebhookClient({ 
    url: process.env.DISCORD_WEBHOOK_URL 
});

export const monitorSystem = async () => {
    try {
        const memoryUsage = (os.freemem() / os.totalmem() * 100).toFixed(2);
        const loadAverage = os.loadavg()[0].toFixed(2);
        const uptime = (os.uptime() / 3600).toFixed(1); // hours
        
        // Create a nice formatted message
        await webhookClient.send({
            username: 'System Monitor',
            embeds: [{
                color: memoryUsage < 10 ? 0xFF0000 : 0x00FF00, // Red if low memory, green if ok
                title: '🖥️ System Status Update',
                fields: [
                    {
                        name: '💾 Memory Usage',
                        value: `${memoryUsage}% free`,
                        inline: true
                    },
                    {
                        name: '⚡ Load Average',
                        value: `${loadAverage}`,
                        inline: true
                    },
                    {
                        name: '⏰ Uptime',
                        value: `${uptime} hours`,
                        inline: true
                    }
                ],
                timestamp: new Date()
            }]
        });
    } catch (error) {
        console.error('Discord webhook error:', error);
    }
};

export const sendAlert = async (message) => {
    try {
        await webhookClient.send({
            username: 'System Alert',
            embeds: [{
                color: 0xFF0000,
                title: '🚨 Alert',
                description: message,
                timestamp: new Date()
            }]
        });
    } catch (error) {
        console.error('Discord alert error:', error);
    }
};