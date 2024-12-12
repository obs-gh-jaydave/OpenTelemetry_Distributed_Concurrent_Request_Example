FROM node:18-alpine

# Set working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (if present)
COPY package.json /usr/src/app/

# Install dependencies
RUN npm install

# Copy artillery.yml and run.sh into the container
COPY artillery.yml /usr/src/app/
COPY run.sh /usr/src/app/
RUN chmod +x /usr/src/app/run.sh

# Default command to run the load test
ENTRYPOINT ["./run.sh"]