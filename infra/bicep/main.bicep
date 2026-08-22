targetScope = 'resourceGroup'

@description('Globally unique short prefix for Erudoza resources. Keep this out of Filosage resource groups.')
@minLength(3)
@maxLength(12)
param namePrefix string = take('eru${uniqueString(resourceGroup().id)}', 12)

@description('Azure region. Defaults to the Erudoza resource group location.')
param location string = resourceGroup().location

@description('Public origin for cookies and CORS. Leave empty to use the App Service https URL. Set to https://erudoza.com after DNS exists.')
param publicOrigin string = ''

@secure()
@description('OpenAI API key. Passed at deploy time, never committed. Stored only in App Service application settings.')
param openAiApiKey string = ''

@description('Project tag used to keep Erudoza resources distinguishable from Filosage.')
param projectTag string = 'erudoza'

var suffix = take(uniqueString(resourceGroup().id), 6)
var sqlName = toLower('${namePrefix}${suffix}')
var apiName = toLower('${namePrefix}${suffix}-api')
var planName = '${namePrefix}-plan'
var tags = {
  project: projectTag
  application: 'erudoza'
}
var resolvedOrigin = empty(publicOrigin) ? 'https://${api.properties.defaultHostName}' : publicOrigin

resource sqlServer 'Microsoft.Sql/servers@2023-08-01' = {
  name: sqlName
  location: location
  tags: tags
  properties: {
    version: '12.0'
    minimalTlsVersion: '1.2'
    administrators: {
      administratorType: 'ActiveDirectory'
      principalType: 'Application'
      login: apiName
      sid: api.identity.principalId
      tenantId: subscription().tenantId
      azureADOnlyAuthentication: true
    }
  }
}

resource sqlDatabase 'Microsoft.Sql/servers/databases@2023-08-01' = {
  parent: sqlServer
  name: 'erudoza'
  location: location
  tags: tags
  sku: {
    name: 'Basic'
    tier: 'Basic'
  }
  properties: {
    collation: 'SQL_Latin1_General_CP1_CI_AS'
    maxSizeBytes: 2147483648
  }
}

resource sqlFirewallAzure 'Microsoft.Sql/servers/firewallRules@2023-08-01' = {
  parent: sqlServer
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource appPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: planName
  location: location
  tags: tags
  sku: {
    name: 'B1'
    tier: 'Basic'
  }
  kind: 'linux'
  properties: {
    reserved: true
  }
}

resource api 'Microsoft.Web/sites@2023-12-01' = {
  name: apiName
  location: location
  tags: union(tags, { 'azd-service-name': 'api' })
  kind: 'app,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appPlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'DOTNETCORE|10.0'
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      healthCheckPath: '/api/v1/health'
    }
  }
}

resource apiAppSettings 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: api
  name: 'appsettings'
  properties: {
    PUBLIC_ORIGIN: resolvedOrigin
    Database__Provider: 'SqlServer'
    Database__ConnectionString: 'Server=tcp:${sqlServer.properties.fullyQualifiedDomainName},1433;Initial Catalog=${sqlDatabase.name};Authentication=Active Directory Managed Identity;Encrypt=True;TrustServerCertificate=False;'
    Database__ApplySchema: 'true'
    Blob__Provider: 'Disabled'
    OpenAI__Enabled: empty(openAiApiKey) ? 'false' : 'true'
    OpenAI__ApiKey: openAiApiKey
    OpenAI__Model: 'gpt-4.1-mini'
    Seed__Enabled: 'true'
    ExposeDebugAnswers: 'false'
    WEBSITE_RUN_FROM_PACKAGE: '1'
    ASPNETCORE_ENVIRONMENT: 'Production'
  }
}

output apiHostname string = api.properties.defaultHostName
output apiSiteName string = api.name
output apiUrl string = resolvedOrigin
output sqlServerName string = sqlServer.name
output sqlDatabaseName string = sqlDatabase.name
output appServicePrincipalId string = api.identity.principalId
output resourceGroupName string = resourceGroup().name
