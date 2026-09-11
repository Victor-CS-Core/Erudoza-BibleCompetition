using 'main.bicep'

// Supply these through an approved secret-aware deployment runner. This file
// intentionally selects no subscription/resource group and contains no credentials.
param namePrefix = readEnvironmentVariable('ERUDOZA_RESOURCE_PREFIX')
param location = readEnvironmentVariable('ERUDOZA_AZURE_LOCATION')
param publicOrigin = readEnvironmentVariable('ERUDOZA_PUBLIC_ORIGIN')
param sqlAdminPassword = readEnvironmentVariable('ERUDOZA_SQL_ADMIN_PASSWORD')
param databaseConnectionString = readEnvironmentVariable('ERUDOZA_DATABASE_CONNECTION_STRING')
param sqlAllowedIpAddresses = json(readEnvironmentVariable('ERUDOZA_SQL_ALLOWED_IPS_JSON', '[]'))
