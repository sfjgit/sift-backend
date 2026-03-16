# Use Node 20 to match Prisma & deps
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files first (to cache npm install)
COPY package*.json ./

# Copy prisma schema BEFORE install (needed for prisma generate)
COPY prisma ./prisma

# Install dependencies (this will also install prisma as a dev dep)
RUN npm install

# Copy all other source files
COPY . .

# Generate Prisma client explicitly
RUN npx prisma generate

# Build your TS code
RUN npm run build

# Expose the app port
EXPOSE 8080

# Start your app
CMD ["npm", "start"]
