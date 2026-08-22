using 'main.bicep'

param namePrefix = 'erudozadev'
param location = 'eastus'
param publicOrigin = 'https://erudoza.com'

// The password is a non-production placeholder for `az bicep lint` / build validation only.
param sqlAdminPassword = 'ValidationOnly!234'
