import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

// Function to generate SHA256 hash of an uploaded file buffer
const generateFileHash = (fileBuffer) => {
    const hash = crypto.createHash('sha256');
    hash.update(fileBuffer);  // Feed the file buffer into the hash function
    return hash.digest('hex');  // Return the hash as a hex string
};

const s3 = new S3Client({
    region: process.env.AWS_REGION
});

export const uploadImagesToS3 = async (files, folder = 'recipes') => {
    try {
        const uploadPromises = files.map(async (file) => {
            const fileHash = generateFileHash(file.buffer);
            const fileName = `${folder}/${fileHash}`;
            const params = {
                Bucket: process.env.S3_BUCKET_NAME,
                Key: fileName,
                Body: file.buffer,
                ContentType: file.mimetype
            };

            const command = new PutObjectCommand(params);
            await s3.send(command);

            return {
                fileName: fileName,
                size: file.size
            };
        });

        const uploadedFiles = await Promise.all(uploadPromises);
        return uploadedFiles;
    } catch (error) {
        throw new Error('Error uploading images to S3: ' + error.message);
    }
};

export const getPresignedUrl = async (fileName) => {
    try {
        const command = new GetObjectCommand({
            Bucket: process.env.S3_BUCKET_NAME,
            Key: fileName,
        });

        const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 }); // Expires in 1 hour
        return signedUrl;
    } catch (error) {
        console.error("Error generating pre-signed URL:", error);
        throw new Error("Could not generate pre-signed URL");
    }
};

export const enhanceRecipeWithUrls = async (recipe) => {
    const imagesWithUrls = await Promise.all(
        recipe.images.map(async (image) => {
            const url = await getPresignedUrl(image.fileName);
            return { ...image.toObject(), url };
        })
    );
    return { ...recipe.toObject(), images: imagesWithUrls };
}