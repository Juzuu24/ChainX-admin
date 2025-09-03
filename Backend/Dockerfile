# Use Node Alpine base image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy all source code
COPY . .

# Install nodemon globally
RUN npm install -g nodemon

# Install bash and curl, download wait-for-it.sh and make it executable
RUN apk add --no-cache bash curl && \
    curl -o wait-for-it.sh https://raw.githubusercontent.com/vishnubob/wait-for-it/master/wait-for-it.sh && \
    chmod +x wait-for-it.sh

# Expose the backend port
EXPOSE 4100

# Start the app with wait-for-it to wait for the DB
CMD ["./wait-for-it.sh", "db:3306", "--", "npx", "nodemon", "app.js"]
