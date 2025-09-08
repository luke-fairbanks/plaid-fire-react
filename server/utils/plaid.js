const { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } = require('plaid');

// Plaid configuration
const PLAID_ENV = process.env.PLAID_ENV || 'sandbox';
const configuration = new Configuration({
  basePath: PlaidEnvironments[PLAID_ENV],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});

const plaidClient = new PlaidApi(configuration);

module.exports = {
  plaidClient,
  Products,
  CountryCode
};
