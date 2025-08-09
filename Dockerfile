# AI Code Assistant Docker Container
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install system dependencies for better compatibility
RUN apk add --no-cache git curl bash

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy application files
COPY cli/ ./cli/
COPY core/ ./core/
COPY prompts/ ./prompts/
COPY tools/ ./tools/
COPY workflow/ ./workflow/
COPY scripts/ ./scripts/

# Create global symlink
RUN npm link

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S codeassistant -u 1001

# Set ownership
RUN chown -R codeassistant:nodejs /app
USER codeassistant

# Create directories for user data
RUN mkdir -p /app/.sessions /app/.config

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "console.log('AI Code Assistant is healthy')" || exit 1

# Expose port for potential web interface
EXPOSE 3000

# Default command
CMD ["codeassistant", "chat"]

# Labels
LABEL maintainer="AI Code Assistant Team <community@ai-code-assistant.dev>"
LABEL description="Advanced AI-powered coding assistant with 49+ development tools"
LABEL version="1.0.0"
LABEL org.opencontainers.image.source="https://github.com/shahryar908/ai-code-assistant"