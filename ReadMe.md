# Recipe Social - Backend

## Overview

This backend powers the Recipe Community Social app. It allows users to share, discover, and interact with recipes in a social community setting. The app is built using **Node.js** and **Express**, with **MongoDB Atlas** as the database.

## Tools & Technologies Used

- **Node.js** - Server-side JavaScript runtime.
- **Express** - Web framework for Node.js.
- **MongoDB Atlas** - Managed cloud database for storing user, recipe, and template data.
- **AWS S3** - Integration for storing images and other assets.

## Project Structure

- **models/** - Contains Mongoose models for `User`, `Recipe`, and `Template`.
- **routes/** - Defines the routes for handling HTTP requests.
- **controllers/** - Contains logic for handling requests and interacting with the models.
- **server.js** - The main entry point to start the Express server and connect to the database.
