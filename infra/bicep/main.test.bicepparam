using 'main.bicep'

param namePrefix = 'erudozadev'
param location = 'eastus'
param publicOrigin = 'https://erudoza.com'

// The password is a non-production placeholder for `az bicep lint` / build validation only.
param sqlAdminPassword = 'ValidationOnly!234'
param databaseConnectionString = 'Server=tcp:erudozadevsql.database.windows.net,1433;Database=erudoza;User ID=validationonly;Password=ValidationOnly!234;Encrypt=True;TrustServerCertificate=False;'
