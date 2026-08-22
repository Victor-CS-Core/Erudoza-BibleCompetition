using 'main.bicep'

param namePrefix = 'erudozadev'
param location = 'eastus'
param publicOrigin = 'https://erudoza.com'
param projectTag = 'erudoza'

// OpenAI key is optional for `az bicep lint` / compile validation only.
param openAiApiKey = ''
