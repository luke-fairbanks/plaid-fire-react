# Plaid Budget App - Server

This is a simple Express server that handles Plaid API integration for the budget app.

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Firebase Service Account Key:**
   - Go to Firebase Console → Project Settings → Service Accounts
   - Click "Generate new private key"
   - Download the JSON file and save it as `firebase-key.json` in this server directory

3. **Environment Variables:**
   - Copy the `.env` file and update the values:
   ```bash
   PLAID_CLIENT_ID=your_client_id
   PLAID_SECRET=your_secret
   PLAID_ENV=sandbox  # or production
   PORT=3005
   ```

4. **Start the server:**
   ```bash
   npm start
   # or for development with auto-restart:
   npm run dev
   ```

The server will run on `http://localhost:3005`

## API Endpoints

- `POST /create-link-token` - Creates a Plaid Link token
- `POST /exchange-public-token` - Exchanges public token for access token
- `POST /sync-transactions` - Syncs transaction data
- `POST /get-accounts` - Gets account information

All endpoints require Firebase authentication via Bearer token in the Authorization header.

## Security Note

This server is for development purposes. In production, you should:
- Use environment variables for all secrets
- Implement proper authentication/authorization
- Use HTTPS
- Rate limiting
- Input validation
