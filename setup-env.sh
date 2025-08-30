#!/bin/bash

# Setup script for Cornell Trading Competition environment variables

echo "Setting up environment variables for Cornell Trading Competition..."

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    cat > .env << EOF
# Database Configuration
DB_PASSWORD=devpassword

# Development settings
ALLOW_ANY_API_KEY=true

# API Configuration  
NEXT_PUBLIC_API_URL=http://localhost/api/v1
NEXT_PUBLIC_WS_URL=/ws/v1/market-data
EOF
    echo "✅ Created .env file with default values"
else
    echo "ℹ️  .env file already exists"
fi

# Make sure the script is executable
chmod +x setup-env.sh

echo "✅ Environment setup complete!"
echo ""
echo "You can now run: docker-compose up"
echo ""
echo "To customize settings, edit the .env file."
