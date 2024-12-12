FROM node:18-alpine

# Install necessary tools
RUN apk add --no-cache bash curl

# Set the working directory
WORKDIR /app

# Copy application files
COPY package.json tsconfig.json ./
RUN npm install
COPY src src

# Expose port (if needed)
EXPOSE 3000

# Command to start the app
CMD ["npm", "run", "start"]