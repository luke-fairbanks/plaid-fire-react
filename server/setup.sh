#!/bin/bash

echo "Setting up Firebase service account key..."
echo ""
echo "1. Go to: https://console.firebase.google.com/project/plaid-fire-react/settings/serviceaccounts/adminsdk"
echo "2. Click 'Generate new private key'"
echo "3. Download the JSON file"
echo "4. Save it as 'firebase-key.json' in the server directory"
echo ""
echo "Press Enter when you've downloaded the file..."
read

if [ -f "firebase-key.json" ]; then
    echo "✅ Firebase key found!"
    echo ""
    echo "Starting server..."
    npm start
else
    echo "❌ firebase-key.json not found in current directory"
    echo "Please save the downloaded file as 'firebase-key.json' in the server directory"
fi
