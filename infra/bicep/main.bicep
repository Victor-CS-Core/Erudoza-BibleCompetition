targetScope = 'resourceGroup'

@description('Globally unique prefix for Erudoza resources.')
@minLength(3)
@maxLength(12)
param namePrefix string

@description('Azure region.')
param location string = resourceGroup().location

@secure()
@description('SQL administrator password. Supplied at deploy time, never committed.')
param sqlAdminPassword string

@secure()
@description('Complete encrypted SQL Server connection string for a dedicated runtime principal. Inject from a secret store; never commit. Must target the database provisioned here.')
param databaseConnectionString string

@description('Explicit approved API outbound IPv4 addresses and migration-runner addresses. Determine these before enabling database traffic; never use 0.0.0.0 to allow all Azure services.')
param sqlAllowedIpAddresses array = []

@description('Public origin for the SPA.')
param publicOrigin string = 'https://erudoza.com'

var sqlName = '${namePrefix}sql'
var apiName = '${namePrefix}api'
var storageName = take('eru${replace(namePrefix, '-', '')}data', 24)
var insightsName = '${namePrefix}insights'
var vaultName = '${namePrefix}kv'

resource sqlServer 'Microsoft.Sql/servers@2023-08-01' = {
  name: sqlName
  location: location
  properties: {
    administratorLogin: 'erudozaadmin'
    administratorLoginPassword: sqlAdminPassword
    version: '12.0'
    minimalTlsVersion: '1.2'
  }
}

resource sqlDatabase 'Microsoft.Sql/servers/databases@2023-08-01' = {
  parent: sqlServer
  name: 'erudoza'
  location: location
  sku: {
    name: 'S0'
    tier: 'Standard'
  }
}

resource sqlFirewallRules 'Microsoft.Sql/servers/firewallRules@2023-08-01' = [for (address, index) in sqlAllowedIpAddresses: {
  parent: sqlServer
  name: 'approved-egress-${index}'
  properties: {
    startIpAddress: address
    endIpAddress: address
  }
}]

resource sqlBackupRetention 'Microsoft.Sql/servers/databases/backupShortTermRetentionPolicies@2023-08-01' = {
  parent: sqlDatabase
  name: 'default'
  properties: {
    retentionDays: 14
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: toLower(storageName)
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
  }
}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: '${namePrefix}-logs'
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: insightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: take(vaultName, 24)
  location: location
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
  }
}

resource appPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${namePrefix}-plan'
  location: location
  sku: {
    name: 'B1'
    tier: 'Basic'
    capacity: 1 // Practice timing and room coordination have one authoritative process.
  }
  kind: 'linux'
  properties: {
    reserved: true
  }
}

resource api 'Microsoft.Web/sites@2023-12-01' = {
  name: apiName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appPlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'DOTNETCORE|10.0'
      alwaysOn: true
      webSocketsEnabled: true
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      healthCheckPath: '/api/v1/health'
      appSettings: [
        {
          name: 'ASPNETCORE_ENVIRONMENT'
          value: 'Production'
        }
        {
          name: 'PUBLIC_ORIGIN'
          value: publicOrigin
        }
        {
          name: 'Database__Provider'
          value: 'SqlServer'
        }
        {
          name: 'Database__ConnectionString'
          value: databaseConnectionString
        }
        {
          name: 'Database__ApplySchema'
          value: 'false'
        }
        {
          name: 'Seed__Enabled'
          value: 'false'
        }
        {
          name: 'ExposeDebugAnswers'
          value: 'false'
        }
        {
          name: 'DataProtection__KeyPath'
          value: '/home/erudoza/keys'
        }
        {
          name: 'WEBSITES_ENABLE_APP_SERVICE_STORAGE'
          value: 'true'
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: insights.properties.ConnectionString
        }
      ]
    }
  }
}

output apiHostname string = api.properties.defaultHostName
output sqlServerName string = sqlServer.name
output storageAccountName string = storage.name
output keyVaultName string = keyVault.name
